/**
 * De-personalization inventory — read-only, for the public-flip audit (W3).
 *
 * Counts, per class and per file, everything in the TRACKED tree (and, with
 * `--commits`, in every commit message on every ref) that identifies the owner,
 * their machine, their sessions, or a private individual. It does not decide
 * anything; the verdicts live in `docs/launch/repo-public-audit.md`. Classes are
 * deliberately over-broad — a false positive costs a line in the report, a false
 * negative ships someone's name.
 *
 * Usage:
 *   bun tools/audit/scan-personal.ts            # tracked files
 *   bun tools/audit/scan-personal.ts --commits  # commit messages + author idents
 *   bun tools/audit/scan-personal.ts --list X   # print every hit line for class X
 */

interface Klass {
  name: string;
  re: RegExp;
  why: string;
}

const CLASSES: readonly Klass[] = [
  {
    name: "owner-handle",
    re: /\bmlapeter\b/gi,
    why: "The owner's GitHub handle / macOS username.",
  },
  {
    name: "owner-name",
    re: /\bLaPeter\b|\bMike\b(?!\s*Lapeter)/g,
    why: "The owner's name. Fine as authorship, not as an anecdote subject.",
  },
  {
    name: "owner-email",
    re: /[A-Za-z0-9._%+-]+@(?:gmail|icloud|me|hotmail|yahoo|outlook)\.com/gi,
    why: "A personal mailbox.",
  },
  {
    name: "owner-site",
    re: /\bmikelapeter\.com\b/gi,
    why: "The owner's own public site — usually SHIP, listed for completeness.",
  },
  {
    name: "absolute-home-path",
    re: /\/Users\/[A-Za-z0-9._-]+/g,
    why: "Reveals the machine's user account and layout.",
  },
  {
    name: "tilde-path",
    re: /(?<![A-Za-z0-9])~\/[A-Za-z0-9._@/-]+/g,
    why: "Reveals home-directory layout (live stores, donors, run dirs).",
  },
  {
    name: "live-store-path",
    re: /~?\/?\.(?:bansai|counterparts|claude-engram|memory-ab)\b|counterparts-parallel-run|counterparts-backups/g,
    why: "Names the owner's live/off-limits stores.",
  },
  {
    name: "uuid-session-id",
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    why: "Claude Code session ids are UUIDs; they index the owner's transcripts.",
  },
  {
    name: "short-session-id",
    re: /\bsession[ _-]?(?:id)?[ :=]+["'`]?([0-9a-f]{8})\b/gi,
    why: "The 8-hex short session id form (`0a1b2c3d`-style).",
  },
  {
    name: "run-id",
    re: /\brun_[0-9a-f]{8,}\b/g,
    why: "Parallel-run / replay record ids from the owner's instrument output.",
  },
  {
    name: "scratchpad-path",
    re: /claude-501|\/private\/tmp\/claude-/g,
    why: "Host scratchpad paths — machine-specific, and carry session UUIDs.",
  },
  {
    name: "claude-projects-path",
    re: /\.claude\/projects\/[^\s`)"']+/g,
    why: "Transcript locations on the owner's machine.",
  },
];

function sh(cmd: string[]): string {
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", maxBuffer: 1 << 28 });
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout.toString();
}

interface Row {
  klass: string;
  file: string;
  line: number;
  text: string;
  match: string;
}

const rows: Row[] = [];

function scan(file: string, text: string) {
  const lines = text.split("\n");
  for (const k of CLASSES) {
    for (let i = 0; i < lines.length; i++) {
      const re = new RegExp(k.re.source, k.re.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(lines[i]!)) !== null) {
        rows.push({
          klass: k.name,
          file,
          line: i + 1,
          text: lines[i]!.trim().slice(0, 160),
          match: m[0],
        });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  }
}

const commitsMode = process.argv.includes("--commits");
const listIdx = process.argv.indexOf("--list");
const listClass = listIdx >= 0 ? process.argv[listIdx + 1] : undefined;

if (commitsMode) {
  const log = sh(["git", "log", "--all", "--format=%H%x01%an <%ae>%x01%cn <%ce>%x01%B%x02"]);
  for (const rec of log.split("\u0002")) {
    const [sha, an, cn, body] = rec.split("\u0001");
    if (!sha) continue;
    scan(`commit ${sha.trim().slice(0, 8)}`, `${an}\n${cn}\n${body ?? ""}`);
  }
} else {
  // The scanners and the audit report quote these patterns by necessity — the report
  // has to say *what* it found. Excluded so a re-run measures the repo, not the audit.
  // (The report is also DROP-from-the-public-tree for exactly that reason.)
  const SELF = [
    "tools/audit/scan-personal.ts",
    "tools/audit/scan-history.ts",
    "docs/launch/repo-public-audit.md",
  ];
  for (const f of sh(["git", "ls-files"]).split("\n").filter(Boolean)) {
    if (SELF.includes(f)) continue;
    let text: string;
    try {
      text = Bun.file(f).text ? await Bun.file(f).text() : "";
    } catch {
      continue;
    }
    scan(f, text);
  }
}

if (listClass) {
  for (const r of rows.filter((r) => r.klass === listClass)) {
    console.log(`${r.file}:${r.line}  [${r.match}]  ${r.text}`);
  }
  console.log(`\n${rows.filter((r) => r.klass === listClass).length} hits`);
} else {
  const byClass = new Map<string, { n: number; files: Set<string> }>();
  for (const r of rows) {
    const e = byClass.get(r.klass) ?? { n: 0, files: new Set<string>() };
    e.n++;
    e.files.add(r.file);
    byClass.set(r.klass, e);
  }
  console.log(commitsMode ? "== COMMIT MESSAGES + IDENTS ==" : "== TRACKED FILES ==");
  console.log("class".padEnd(24), "hits".padEnd(7), "files");
  let total = 0;
  for (const k of CLASSES) {
    const e = byClass.get(k.name);
    if (!e) continue;
    total += e.n;
    console.log(k.name.padEnd(24), String(e.n).padEnd(7), e.files.size);
  }
  console.log("-".repeat(40));
  console.log("TOTAL".padEnd(24), String(total).padEnd(7), new Set(rows.map((r) => r.file)).size);
  console.log("\ntop files:");
  const byFile = new Map<string, number>();
  for (const r of rows) byFile.set(r.file, (byFile.get(r.file) ?? 0) + 1);
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${String(n).padStart(4)}  ${f}`);
  }
}

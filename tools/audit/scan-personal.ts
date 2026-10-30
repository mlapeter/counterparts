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
 *   bun tools/audit/scan-personal.ts --tarball new.tgz --against old.tgz
 *                                               # the release's package scan
 *
 * `--tarball` is the one mode that decides, and it runs in a public CI log, so it
 * prints classes, counts and file paths and NEVER a matched string or a line of text.
 * It compares a packed tarball with the previous release's and exits 1 on what should
 * stop a release: a file that doesn't belong, or a new hit in a HARD class or for a
 * key. A hit is new when the last release didn't have that string in that file (for a
 * key, that line), so a swap that leaves the count alone is still new. New files, gone
 * files, sizes, exports and new hits in the SOFT classes are listed for the release
 * agent to read. The soft classes can't fail: `~/.counterparts`
 * is the product's own path and the owner's name is all over the comments (0.3.41:
 * 478 and 405 hits), so an absolute rule would be red every release. It knows only
 * the owner's name: a list of other people's names can't live in a public repository.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { scanSecrets } from "../../src/core/encode/secrets.js";

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

// ------------------------------------------------------------ the package scan

/** A new hit in one of these stops the release. The rest are listed and read. */
const HARD_CLASSES: ReadonlySet<string> = new Set([
  "owner-email",
  "absolute-home-path",
  "uuid-session-id",
  "short-session-id",
  "run-id",
  "scratchpad-path",
  "claude-projects-path",
]);

/** Paths inside the package that don't belong in it (RELEASING §2). */
const STOWAWAY =
  /^(?:test|hooks|commands|dist|hosted|scratch[^/]*|\.claude[^/]*|\.github|docs\/harvest)\/|^tools\/(?!install-loop\/)|\.(?:sqlite3?|db)(?:-wal|-shm)?$|(?:^|\/)\.(?:env(?:\.[^/]*)?|npmrc)$|\.(?:tgz|tar|gz|zip)$/;

/** What a failed scan tells the release agent. Plain words only: the log is public. */
const WHEN_IT_FAILS = `What to do. Nothing was uploaded, and fetch-tarball.sh stops on this run. A rerun packs the
same commit and fails the same way, so don't rerun it.
1. Read each line named above in your own checkout of this commit. This log never prints them.
2. A real key, mailbox, path or id: it's already public on this pushed branch. Take it out of
   the source, tell the owner, and if it's a key, have it replaced.
3. Not a real one (an example, or code that only looks like one): reword the line until it stops
   matching, with a placeholder like <session id>. There's no list of exceptions. A moved file
   counts as new hits at its new path, so its old lines need the same rewording.
4. A file that doesn't belong: drop it from "files" in package.json, or delete it.
5. Commit and push the release branch. The new commit gets its own run.`;

interface Unpacked {
  /** Path inside the package -> size in bytes. */
  files: Map<string, number>;
  bytes: number;
  /**
   * `class|file` (or `key:family|file`) -> what hit -> the lines it's on. What hit is
   * the matched string, or a key's whole line (the scan gives only a family and count).
   * It stays in this process: nothing that prints reads the keys of the inner map.
   */
  hits: Map<string, Map<string, number[]>>;
  exports: string;
}

function unpack(tarball: string): Unpacked {
  const dir = mkdtempSync(join(tmpdir(), "package-scan-"));
  try {
    sh(["tar", "-xzf", tarball, "-C", dir]);
    const root = join(dir, "package");
    const files = new Map<string, number>();
    const hits = new Map<string, Map<string, number[]>>();
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const path = join(d, name);
        const st = statSync(path);
        if (st.isDirectory()) {
          walk(path);
          continue;
        }
        const file = relative(root, path);
        files.set(file, st.size);
        const text = readFileSync(path, "utf8");
        const lines = text.split("\n");
        const hit = (key: string, what: string, line: number) => {
          const whats = hits.get(key) ?? new Map<string, number[]>();
          whats.set(what, [...(whats.get(what) ?? []), line]);
          hits.set(key, whats);
        };
        for (const k of CLASSES) {
          if (!new RegExp(k.re.source, k.re.flags).test(text)) continue;
          lines.forEach((line, i) => {
            for (const m of line.match(new RegExp(k.re.source, k.re.flags)) ?? []) hit(`${k.name}|${file}`, m, i + 1);
          });
        }
        const keys = scanSecrets(text).findings;
        if (keys.length > 0) {
          lines.forEach((line, i) => {
            for (const f of scanSecrets(line).findings) hit(`key:${f.family}|${file}`, line, i + 1);
          });
          // A key the line-by-line pass can't see (a block over several lines, a copy
          // that's one only beside its first mention) still counts, with no line to name.
          for (const f of keys) {
            const seen = [...(hits.get(`key:${f.family}|${file}`)?.values() ?? [])].reduce((sum, at) => sum + at.length, 0);
            for (let i = seen; i < f.count; i++) hit(`key:${f.family}|${file}`, `(whole file) ${i}`, 0);
          }
        }
      }
    };
    walk(root);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;
    return {
      files,
      bytes: statSync(tarball).size,
      hits,
      exports: JSON.stringify({ exports: pkg["exports"], bin: pkg["bin"], dependencies: pkg["dependencies"] }),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function packageScan(tarball: string, against: string): number {
  const now = unpack(tarball);
  const was = unpack(against);
  const lines: string[] = [];
  const say = (line = "") => lines.push(line);
  const name = (p: string) => p.split("/").pop() ?? p;

  say(`package scan: ${name(tarball)} against ${name(against)}`);
  const signed = now.bytes - was.bytes;
  say(`files ${now.files.size} (was ${was.files.size}); tarball ${now.bytes} bytes (was ${was.bytes}, ${signed >= 0 ? "+" : ""}${signed})`);

  const added = [...now.files.keys()].filter((f) => !was.files.has(f)).sort();
  const gone = [...was.files.keys()].filter((f) => !now.files.has(f)).sort();
  say(`new files, each should have a reason (${added.length})${added.length ? ":" : ""}`);
  for (const f of added) say(`  + ${f}`);
  say(`gone files, each should have a reason (${gone.length})${gone.length ? ":" : ""}`);
  for (const f of gone) say(`  - ${f}`);
  say(`exports, bin, dependencies: ${now.exports === was.exports ? "the same" : "CHANGED, read package.json"}`);

  const stowaways = [...now.files.keys()].filter((f) => STOWAWAY.test(f)).sort();
  const newHits = [...now.hits]
    .map(([key, whats]) => {
      const before = was.hits.get(key);
      const lines = [...whats].flatMap(([what, at]) => at.slice(before?.get(what)?.length ?? 0));
      return { key, lines: lines.sort((a, b) => a - b) };
    })
    .filter((h) => h.lines.length > 0)
    .map((h) => {
      const [klass, file] = h.key.split("|") as [string, string];
      return { klass, file, more: h.lines.length, lines: h.lines, hard: klass.startsWith("key:") || HARD_CLASSES.has(klass) };
    })
    .sort((a, b) => a.klass.localeCompare(b.klass) || a.file.localeCompare(b.file));
  const at = (h: { lines: number[] }) => {
    const known = [...new Set(h.lines)].filter((n) => n > 0);
    return known.length > 0 ? `  line ${known.slice(0, 20).join(", ")}${known.length > 20 ? ", ..." : ""}` : "";
  };

  const totals = (u: Unpacked, klass: string) =>
    [...u.hits]
      .filter(([key]) => key.startsWith(`${klass}|`))
      .reduce((sum, [, whats]) => sum + [...whats.values()].reduce((n, lines) => n + lines.length, 0), 0);
  const families = [...new Set([...now.hits.keys(), ...was.hits.keys()].map((k) => k.split("|")[0]!).filter((k) => k.startsWith("key:")))];
  say();
  say(`${"class".padEnd(28)}${"now".padStart(6)}${"was".padStart(6)}  on a new hit`);
  for (const klass of [...CLASSES.map((k) => k.name), ...families]) {
    const hard = klass.startsWith("key:") || HARD_CLASSES.has(klass);
    say(`${klass.padEnd(28)}${String(totals(now, klass)).padStart(6)}${String(totals(was, klass)).padStart(6)}  ${hard ? "stops" : "read"}`);
  }

  const soft = newHits.filter((h) => !h.hard);
  const hard = newHits.filter((h) => h.hard);
  say();
  say(`new hits to read (${soft.length}):`);
  for (const h of soft) say(`  ${h.klass} +${h.more}  ${h.file}${at(h)}`);
  say(`new hits that stop the release (${hard.length}):`);
  for (const h of hard) say(`  ${h.klass} +${h.more}  ${h.file}${at(h)}`);
  say(`files that don't belong (${stowaways.length}):`);
  for (const f of stowaways) say(`  ${f}`);

  const pass = hard.length === 0 && stowaways.length === 0;
  say();
  say(`PACKAGE SCAN: ${pass ? "PASS" : "FAIL"}`);
  if (!pass) {
    say();
    say(WHEN_IT_FAILS);
  }

  const text = lines.join("\n");
  console.log(text);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) appendFileSync(summary, `### Package scan\n\n\`\`\`\n${text}\n\`\`\`\n`);
  return pass ? 0 : 1;
}

const tarballIdx = process.argv.indexOf("--tarball");
if (tarballIdx >= 0) {
  const tarball = process.argv[tarballIdx + 1];
  const againstIdx = process.argv.indexOf("--against");
  const against = againstIdx >= 0 ? process.argv[againstIdx + 1] : undefined;
  if (!tarball || !against) {
    console.error("usage: scan-personal.ts --tarball <new.tgz> --against <previous release.tgz>");
    process.exit(2);
  }
  process.exit(packageScan(tarball, against));
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

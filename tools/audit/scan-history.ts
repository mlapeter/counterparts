/**
 * Full git-history secret scan — read-only, for the public-flip audit (W3).
 *
 * Enumerates every blob reachable from EVERY ref (local heads, remote branches,
 * and `refs/remotes/origin/pr/...` fetched from `refs/pull/N/head` — GitHub keeps
 * PR heads alive after the source branch is deleted, so a scan that skips them
 * has a hole), plus dangling objects, and runs three detectors over each:
 *
 *   1. `scanSecrets` from `src/core/encode/secrets.ts` — the repo's own gate.
 *   2. An extra literal/prefix set the gate does not cover (Voyage `pa-` keys,
 *      env-var assignment forms, any `-----BEGIN` block, npmrc auth lines).
 *   3. A Shannon-entropy check over `[A-Za-z0-9+/=_-]{32,}` runs (> 4.0 bits per
 *      character), which is how a token with no recognizable prefix gets caught.
 *
 * Nothing is written to the repo and nothing is executed against a store. Output
 * is JSON on stdout; secret VALUES are never printed in full — only a 4-char
 * head, the length, and the location, so the report itself is not a leak.
 *
 * Usage:  bun tools/audit/scan-history.ts [--worktree] > report.json
 *   --worktree   scan the checked-out working tree instead of history
 */

import { scanSecrets } from "../../src/core/encode/secrets.js";

// ---------------------------------------------------------------- extra rules

interface ExtraRule {
  family: string;
  re: RegExp;
  why: string;
}

const EXTRA_RULES: readonly ExtraRule[] = [
  {
    family: "x:begin-block",
    re: /-----BEGIN [A-Z0-9 ]+-----/g,
    why: "Any PEM-ish armored block, not only PRIVATE KEY (certs, EC params, PGP).",
  },
  {
    family: "x:voyage-key",
    re: /\bpa-[A-Za-z0-9_-]{20,}/g,
    why: "Voyage AI API keys are `pa-` prefixed; the repo's embed client uses Voyage.",
  },
  {
    family: "x:api-key-envvar",
    re: /\b(?:ANTHROPIC_API_KEY|VOYAGE_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|NPM_TOKEN|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["']?([^\s"'\n]{8,})/g,
    why: "Named credential env vars with a value attached.",
  },
  {
    family: "x:npmrc-auth",
    re: /_authToken\s*=\s*\S{8,}/g,
    why: "`.npmrc` publish token.",
  },
  {
    family: "x:ssh-pubkey",
    re: /\bssh-(?:rsa|ed25519|dss)\s+AAAA[A-Za-z0-9+/=]{40,}/g,
    why: "Not secret by itself, but identifies the machine/owner — flagged for the de-personalization pass.",
  },
];

/** Noisy-but-required keyword sweep: counted per blob, never listed per hit. */
const KEYWORD_RE = /\b(password|passwd|secret|token|credential|api[_-]?key)\b/gi;

// ------------------------------------------------------------------- entropy

const HIGH_ENTROPY_RUN = /[A-Za-z0-9+/=_-]{32,}/g;

function shannon(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Shapes that are high-entropy by construction and are NOT credentials. Kept as
 * an explicit, named list so the report can say why each was dropped rather than
 * silently suppressing it.
 */
const ENTROPY_BENIGN: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "git-sha40", re: /^[0-9a-f]{40}$/ },
  { name: "git-sha64", re: /^[0-9a-f]{64}$/ },
  { name: "sha512-integrity", re: /^sha512-/ },
  { name: "sha256-integrity", re: /^sha256-/ },
  { name: "lowercase-hex-run", re: /^[0-9a-f]{32,}$/ },
  { name: "base64-of-hex", re: /^[0-9a-f-]{32,}$/ },
  { name: "dotted-identifier", re: /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+){2,}$/ },
];

// ---------------------------------------------------------------- git plumbing

function sh(cmd: string[], maxBuffer = 1 << 28): string {
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", maxBuffer });
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout.toString();
}

interface BlobRef {
  sha: string;
  paths: Set<string>;
  reachable: "published" | "local-only";
}

/** Refs that a `--visibility public` flip actually exposes. */
function publishedRefs(): string[] {
  return sh(["git", "for-each-ref", "--format=%(refname)"])
    .split("\n")
    .filter((r) => r.startsWith("refs/remotes/origin/"));
}

function localOnlyRefs(): string[] {
  return sh(["git", "for-each-ref", "--format=%(refname)"])
    .split("\n")
    .filter((r) => r.startsWith("refs/heads/"));
}

function collectBlobs(refs: string[], reachable: BlobRef["reachable"], into: Map<string, BlobRef>) {
  if (refs.length === 0) return;
  const out = sh(["git", "rev-list", "--objects", ...refs]);
  for (const line of out.split("\n")) {
    if (!line) continue;
    const sp = line.indexOf(" ");
    if (sp < 0) continue; // commit or root tree, no path
    const sha = line.slice(0, sp);
    const path = line.slice(sp + 1);
    let e = into.get(sha);
    if (!e) {
      e = { sha, paths: new Set(), reachable };
      into.set(sha, e);
    }
    // "published" always wins: a blob in both buckets ships.
    if (reachable === "published") e.reachable = "published";
    e.paths.add(path);
  }
}

function danglingBlobs(into: Map<string, BlobRef>) {
  const p = Bun.spawnSync(["git", "fsck", "--lost-found", "--dangling"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const lines = (p.stdout.toString() + p.stderr.toString()).split("\n");
  for (const l of lines) {
    const m = /^dangling (blob|commit) ([0-9a-f]{40})$/.exec(l.trim());
    if (!m) continue;
    if (m[1] === "blob") {
      if (!into.has(m[2]!)) {
        into.set(m[2]!, { sha: m[2]!, paths: new Set(["<dangling blob>"]), reachable: "local-only" });
      }
    } else {
      // A dangling commit's whole tree is unreachable-but-present locally.
      try {
        const out = sh(["git", "rev-list", "--objects", m[2]!]);
        for (const line of out.split("\n")) {
          const sp = line.indexOf(" ");
          if (sp < 0) continue;
          const sha = line.slice(0, sp);
          if (into.has(sha)) continue;
          into.set(sha, {
            sha,
            paths: new Set([`<dangling ${m[2]!.slice(0, 8)}>:${line.slice(sp + 1)}`]),
            reachable: "local-only",
          });
        }
      } catch {
        /* a dangling commit whose parents are gone: skip */
      }
    }
  }
}

/** One `git cat-file --batch` stream for N shas — not a spawn per blob. */
function readBlobs(shas: string[]): Map<string, { type: string; body: Buffer }> {
  const res = new Map<string, { type: string; body: Buffer }>();
  const CHUNK = 400;
  for (let i = 0; i < shas.length; i += CHUNK) {
    const batch = shas.slice(i, i + CHUNK);
    const p = Bun.spawnSync(["git", "cat-file", "--batch"], {
      stdin: Buffer.from(batch.join("\n") + "\n"),
      stdout: "pipe",
      stderr: "pipe",
      maxBuffer: 1 << 29,
    });
    const buf = Buffer.from(p.stdout);
    let off = 0;
    while (off < buf.length) {
      const nl = buf.indexOf(0x0a, off);
      if (nl < 0) break;
      const header = buf.toString("utf8", off, nl);
      const [sha, type, sizeStr] = header.split(" ");
      if (!sha || !type || sizeStr === undefined) break;
      const size = Number(sizeStr);
      const start = nl + 1;
      res.set(sha, { type, body: buf.subarray(start, start + size) });
      off = start + size + 1; // trailing \n
    }
  }
  return res;
}

// -------------------------------------------------------------------- scanning

interface Hit {
  detector: "gate" | "extra" | "entropy";
  family: string;
  count: number;
  /** First 4 chars + length. Never the value. */
  sample: string;
  line?: number;
}

function lineOf(text: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function isBinary(b: Buffer): boolean {
  const n = Math.min(b.length, 8192);
  for (let i = 0; i < n; i++) if (b[i] === 0) return true;
  return false;
}

function scanText(text: string): { hits: Hit[]; keywords: number } {
  const hits: Hit[] = [];

  // (1) the repo's own gate
  const gate = scanSecrets(text);
  for (const f of gate.findings) {
    const fam = SECRET_FAMILY_RE[f.family];
    let sample = "?";
    let line: number | undefined;
    if (fam) {
      const re = new RegExp(fam.source, fam.flags);
      const m = re.exec(text);
      if (m) {
        sample = `${m[0].slice(0, 4)}…(${m[0].length}ch)`;
        line = lineOf(text, m.index);
      }
    }
    hits.push({ detector: "gate", family: f.family, count: f.count, sample, line });
  }

  // (2) extra rules
  for (const r of EXTRA_RULES) {
    const re = new RegExp(r.re.source, r.re.flags);
    let m: RegExpExecArray | null;
    let count = 0;
    let sample = "";
    let line: number | undefined;
    while ((m = re.exec(text)) !== null) {
      count++;
      if (count === 1) {
        sample = `${m[0].slice(0, 8)}…(${m[0].length}ch)`;
        line = lineOf(text, m.index);
      }
      if (m[0].length === 0) re.lastIndex++;
      if (count > 500) break;
    }
    if (count > 0) hits.push({ detector: "extra", family: r.family, count, sample, line });
  }

  // (3) entropy
  const er = new RegExp(HIGH_ENTROPY_RUN.source, HIGH_ENTROPY_RUN.flags);
  let m: RegExpExecArray | null;
  const buckets = new Map<string, { count: number; sample: string; line: number }>();
  while ((m = er.exec(text)) !== null) {
    const run = m[0];
    if (run.length > 4096) continue;
    const benign = ENTROPY_BENIGN.find((b) => b.re.test(run));
    const h = shannon(run);
    if (h <= 4.0) continue;
    const key = benign ? `entropy:benign:${benign.name}` : "entropy:unclassified";
    const b = buckets.get(key);
    if (b) b.count++;
    else
      buckets.set(key, {
        count: 1,
        sample: `${run.slice(0, 6)}…(${run.length}ch, H=${h.toFixed(2)})`,
        line: lineOf(text, m.index),
      });
  }
  for (const [family, b] of buckets) {
    hits.push({ detector: "entropy", family, count: b.count, sample: b.sample, line: b.line });
  }

  const kw = text.match(new RegExp(KEYWORD_RE.source, KEYWORD_RE.flags));
  return { hits, keywords: kw ? kw.length : 0 };
}

/** Family -> the gate's own regex, so a hit can report a location. */
const SECRET_FAMILY_RE: Record<string, RegExp> = {};
{
  // Imported lazily to keep the gate module the single source of the patterns.
  const mod = await import("../../src/core/encode/secrets.js");
  for (const p of mod.SECRET_FAMILIES) SECRET_FAMILY_RE[p.family] = p.re;
}

// ------------------------------------------------------------------------ main

const worktreeMode = process.argv.includes("--worktree");

interface BlobReport {
  sha: string;
  paths: string[];
  reachable: string;
  bytes: number;
  hits: Hit[];
  keywords: number;
  commits?: string[];
}

const reports: BlobReport[] = [];
let scannedBlobs = 0;
let scannedBytes = 0;
let skippedBinary = 0;

if (worktreeMode) {
  const files = sh(["git", "ls-files"]).split("\n").filter(Boolean);
  for (const f of files) {
    const body = Buffer.from(await Bun.file(f).arrayBuffer());
    scannedBlobs++;
    scannedBytes += body.length;
    if (isBinary(body)) {
      skippedBinary++;
      continue;
    }
    const { hits, keywords } = scanText(body.toString("utf8"));
    if (hits.length > 0 || keywords > 0) {
      reports.push({ sha: "worktree", paths: [f], reachable: "worktree", bytes: body.length, hits, keywords });
    }
  }
} else {
  const blobs = new Map<string, BlobRef>();
  collectBlobs(publishedRefs(), "published", blobs);
  collectBlobs(localOnlyRefs(), "local-only", blobs);
  danglingBlobs(blobs);

  const all = [...blobs.values()];
  const bodies = readBlobs(all.map((b) => b.sha));

  for (const b of all) {
    const got = bodies.get(b.sha);
    if (!got || got.type !== "blob") continue;
    scannedBlobs++;
    scannedBytes += got.body.length;
    if (isBinary(got.body)) {
      skippedBinary++;
      continue;
    }
    const { hits, keywords } = scanText(got.body.toString("utf8"));
    if (hits.length === 0 && keywords === 0) continue;
    reports.push({
      sha: b.sha,
      paths: [...b.paths],
      reachable: b.reachable,
      bytes: got.body.length,
      hits,
      keywords,
    });
  }

  // Attribute the interesting blobs to commits (only those with non-keyword hits,
  // so this stays a handful of `git log` calls rather than one per blob).
  for (const r of reports) {
    if (r.hits.length === 0) continue;
    try {
      const out = sh(["git", "log", "--all", "--format=%h", `--find-object=${r.sha}`]);
      r.commits = out.split("\n").filter(Boolean).slice(0, 6);
    } catch {
      r.commits = [];
    }
  }
}

console.log(
  JSON.stringify(
    {
      mode: worktreeMode ? "worktree" : "history",
      scannedBlobs,
      scannedBytes,
      skippedBinary,
      blobsWithFindings: reports.length,
      reports,
    },
    null,
    2,
  ),
);

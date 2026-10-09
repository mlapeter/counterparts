/**
 * COLD START OF `hook` MODE (spike, 2026-10-09 — docs/notes/single-binary-spike.md).
 *
 *   ~/.bun/bin/bun tools/single-binary/coldstart.ts <binary> [<binary> …] [--runs 25] [--node <node exe>]
 *
 * One temp HOME, store and configuration (made by the first binary, then
 * seeded with notes so a prompt has candidates), and the same payloads run
 * through every launcher, interleaved round by round so drift hits all of them
 * alike: today's npm hook command (`bun run hook.ts`), today's plugin launcher
 * target (`bun hook.mjs`), Node through `node-hooks.mjs`, and each binary.
 * Wall time of the whole process, spawn to exit, measured from here. Every
 * process gets an empty environment but HOME, PATH, TMPDIR and
 * COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1. The temp directory is removed at the end.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../..");
const BUN = process.execPath;
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const RUNS = Number(opt("--runs") ?? "25");
const NODE = opt("--node");
const BINARIES = args.map((b) => resolve(b));
if (BINARIES.length === 0) throw new Error("usage: coldstart.ts <binary> [<binary> …] [--runs N] [--node <exe>]");

const WORK = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "single-binary-coldstart-"));
if (WORK.startsWith(`${process.env["HOME"]}/`)) throw new Error(`refused: ${WORK} is inside the real home`);
const HOME = join(WORK, "home");
const CFG = join(HOME, "cp", "claude-code.json");
const STORE = join(HOME, "cp", "store");
const PROJECT = join(HOME, "project");
mkdirSync(PROJECT, { recursive: true });
const ENV = { HOME, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TMPDIR: WORK, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };

function sh(cmd: string, argv: string[], input?: string, extraEnv: Record<string, string> = {}): { ms: number; code: number | null; out: string; err: string } {
  const t0 = performance.now();
  const r = spawnSync(cmd, argv, { cwd: PROJECT, env: { ...ENV, ...extraEnv }, input: input ?? "", encoding: "utf8" });
  return { ms: performance.now() - t0, code: r.status, out: r.stdout, err: r.stderr };
}

try {
  const first = BINARIES[0] as string;
  const inst = sh(first, ["cli", "install", "--config", CFG, "--name", "Cold Start", "--no-connect"]);
  if (!existsSync(CFG)) throw new Error(`install failed: ${inst.err}${inst.out}`);
  const facts = [
    "The espresso machine in the kitchen is a Rancilio Silvia.",
    "The release checklist lives in docs/RELEASE.md and ends with npm publish.",
    "Mike prefers decisions made in conversation rather than in long documents.",
    "The dashboard runs on port 4747 by default.",
    "Hooks must return quickly; heavy work runs in a detached worker.",
    "The store is SQLite in WAL mode with a five second busy timeout.",
    "Recall by meaning uses a local static embedding table, potion-base-8M.",
    "The nightly run dreams with claude -p under a watchdog.",
  ];
  for (let i = 0; i < 40; i++) {
    const r = sh(first, ["cli", "note", `${facts[i % facts.length] as string} (seed ${String(i)})`, "--dir", STORE, "--config", CFG]);
    if (r.code !== 0) throw new Error(`note failed: ${r.err}`);
  }
  const session = "coldstart";
  const payload = (event: string, extra = ""): string =>
    `{"hook_event_name":"${event}","session_id":"${session}","cwd":"${PROJECT}","transcript_path":"${PROJECT}/t.jsonl"${extra}}`;
  sh(first, ["hook", "--config", CFG], payload("SessionStart", ',"source":"startup"'));

  type Launcher = { name: string; cmd: string; argv: (rest: string[]) => string[] };
  const launchers: Launcher[] = [
    { name: "bun run hook.ts (npm hook command)", cmd: BUN, argv: (r) => ["run", join(REPO, "src/adapters/claude-code/bin/hook.ts"), ...r] },
    { name: "bun hook.mjs (plugin-run.sh today)", cmd: BUN, argv: (r) => [join(REPO, "src/adapters/claude-code/bin/hook.mjs"), ...r] },
    ...(NODE === undefined
      ? []
      : [{ name: `node ${spawnSync(NODE, ["--version"], { encoding: "utf8" }).stdout.trim()} --import node-hooks.mjs hook.ts`, cmd: NODE, argv: (r: string[]) => ["--import", join(REPO, "src/adapters/node-hooks.mjs"), join(REPO, "src/adapters/claude-code/bin/hook.ts"), ...r] }]),
    ...BINARIES.map((b) => ({ name: `binary ${b.split("/").slice(-2).join("/")}`, cmd: b, argv: (r: string[]) => ["hook", ...r] })),
  ];
  const cases = [
    { label: "UserPromptSubmit", input: payload("UserPromptSubmit", ',"prompt":"Which coffee maker is in the kitchen, and where is the release checklist?"') },
    { label: "SessionStart", input: payload("SessionStart", ',"source":"startup"') },
  ];
  const versionLaunchers: Launcher[] = [
    { name: "bun counterparts.mjs --version", cmd: BUN, argv: () => [join(REPO, "src/adapters/cli/bin/counterparts.mjs"), "--version"] },
    ...BINARIES.map((b) => ({ name: `binary ${b.split("/").slice(-2).join("/")} cli --version`, cmd: b, argv: () => ["cli", "--version"] })),
  ];

  const stat = (xs: number[]): string => {
    const s = [...xs].sort((a, b) => a - b);
    const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] as number;
    return `median ${q(0.5).toFixed(0).padStart(4)} ms   p95 ${q(0.95).toFixed(0).padStart(4)} ms   min ${(s[0] as number).toFixed(0).padStart(4)} ms`;
  };
  const measure = (title: string, ls: Launcher[], input: string, rest: string[]): void => {
    const times = ls.map(() => [] as number[]);
    for (let round = -3; round < RUNS; round++) {
      ls.forEach((l, i) => {
        const r = sh(l.cmd, l.argv(rest), input);
        if (r.code !== 0) throw new Error(`${l.name} exited ${String(r.code)}: ${r.err}`);
        if (round >= 0) times[i]?.push(r.ms);
      });
    }
    process.stdout.write(`\n${title} (${String(RUNS)} runs each, 3 warm-ups discarded, interleaved)\n`);
    ls.forEach((l, i) => process.stdout.write(`  ${l.name.padEnd(58)} ${stat(times[i] ?? [])}\n`));
  };
  for (const c of cases) measure(`hook ${c.label}`, launchers, c.input, ["--config", CFG]);
  measure("startup only: --version", versionLaunchers, "", []);
} finally {
  // Give a detached worker a moment, then remove everything this made.
  spawnSync("sleep", ["2"]);
  rmSync(WORK, { recursive: true, force: true });
}

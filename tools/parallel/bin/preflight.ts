#!/usr/bin/env bun
/**
 * `parallel-preflight` — CONTRACT §5 Phase 0, from a terminal.
 *
 * EVERY REAL PATH IS A FLAG. The defaults below name the live locations because
 * that is where the run actually happens, and this file is the ONLY place in
 * the tool that resolves a home directory. Nothing in the suite ever reaches
 * them: `runPreflight` is a function of its arguments, and the test harness
 * always passes temp directories (CLAUDE.md's hermetic rule, kept by
 * construction rather than by discipline).
 *
 * Exits 1 on `ready: false`. A preflight that prints a red table and exits 0 is
 * a document, and the CONTRACT's whole point is that this is a gate.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { preflightArtifacts, readBars, runPreflight } from "../preflight.js";
import type { RunPhase } from "../types.js";
import { RunDir } from "../writer.js";

interface Args {
  runDir: string;
  v1Dir: string;
  v2DataDir: string;
  v2Config: string;
  engramDir: string;
  abDir: string;
  replayOut: string | null;
  transcripts: string[];
  phase: RunPhase;
  today: string;
}

function usage(): never {
  process.stderr.write(
    [
      "usage: parallel-preflight --run-dir <dir> [options]",
      "",
      "  --run-dir <dir>       the run directory. The ONLY thing this tool writes.",
      "  --v1-dir <dir>        v1's data dir (read-only).      default ~/.bansai",
      "  --v2-data-dir <dir>   v2's data dir (read-only).      default ~/.counterparts",
      "  --v2-config <file>    v2's adapter config JSON.",
      "  --engram-dir <dir>    the third store, for disjointness. default ~/.claude-engram",
      "  --ab-dir <dir>        the primacy assignment dir.     default ~/.memory-ab",
      "  --replay-out <dir>    the replay run's --out dir (holds pass-record.json).",
      "  --transcripts <path>  a transcript file or directory. Repeatable.",
      "  --phase <0|S|P>       which phase's gates to enforce. default 0.",
      "  --today <YYYY-MM-DD>  seat-expiry clock. default: today.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): Args {
  const home = homedir();
  const args: Args = {
    runDir: "",
    v1Dir: join(home, ".bansai"),
    v2DataDir: join(home, ".counterparts"),
    v2Config: "",
    engramDir: join(home, ".claude-engram"),
    // v1's own resolution order: the environment override first, so the
    // preflight measures the file the hooks would actually read.
    abDir: process.env["MEMORY_AB_DIR"] ?? join(home, ".memory-ab"),
    replayOut: null,
    transcripts: [],
    phase: "0",
    today: new Date().toISOString().slice(0, 10),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined) break;
    // A value that begins with `--` is a MISSING value, not a path.
    if (!flag.startsWith("--") || value === undefined || value.startsWith("--")) usage();
    i += 1;
    switch (flag) {
      case "--run-dir":
        args.runDir = value;
        break;
      case "--v1-dir":
        args.v1Dir = value;
        break;
      case "--v2-data-dir":
        args.v2DataDir = value;
        break;
      case "--v2-config":
        args.v2Config = value;
        break;
      case "--engram-dir":
        args.engramDir = value;
        break;
      case "--ab-dir":
        args.abDir = value;
        break;
      case "--replay-out":
        args.replayOut = value;
        break;
      case "--transcripts":
        args.transcripts.push(value);
        break;
      case "--phase":
        if (value !== "0" && value !== "S" && value !== "P") usage();
        args.phase = value;
        break;
      case "--today":
        args.today = value;
        break;
      default:
        usage();
    }
  }
  if (args.runDir.length === 0) usage();
  return args;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

const MARK: Record<string, string> = {
  pass: "PASS",
  fail: "FAIL",
  "not-exercised": "N/EX",
};

function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  // The env var's PRESENCE is the defect the CONTRACT names (scar §2.13). This
  // process can only observe its own environment, so the same answer is
  // reported for both hook processes and the record says so rather than
  // pretending two were sampled.
  const abDirEnvSet = process.env["MEMORY_AB_DIR"] !== undefined;
  const report = runPreflight({
    runDir: args.runDir,
    v1Dir: args.v1Dir,
    v2DataDir: args.v2DataDir,
    v2ConfigPath: args.v2Config,
    engramDir: args.engramDir,
    replayOut: args.replayOut,
    transcripts: args.transcripts,
    envs: [
      { name: "v1-hooks", abDir: args.abDir, abDirEnvSet },
      { name: "v2-hooks", abDir: args.abDir, abDirEnvSet },
    ],
    today: args.today,
    phase: args.phase,
  });

  // THE RUN DIRECTORY IS CHECKED BEFORE IT IS CREATED. `RunDir.open` refuses a
  // run dir that overlaps any live store, in either direction, by realpath — so
  // a mistyped `--run-dir` cannot mkdir the instrument's one write target
  // inside the subject it observes (CONTRACT §5 G1, scar §2.13).
  const run = RunDir.open(args.runDir, {
    v1Dir: args.v1Dir,
    v2DataDir: args.v2DataDir,
    engramDir: args.engramDir,
    abDir: args.abDir,
  });
  for (const [rel, value] of Object.entries(preflightArtifacts(report, readBars(args.runDir)))) {
    run.writeJson(rel, value);
  }

  const out: string[] = [];
  out.push(`COUNTERPARTS PARALLEL-RUN PREFLIGHT — phase ${report.phase}`);
  out.push("=".repeat(78));
  out.push(`run dir  ${report.runDir}`);
  out.push(`at       ${report.at}`);
  out.push("");
  for (const check of report.checks) {
    out.push(`  ${pad(MARK[check.status] ?? check.status, 6)}${pad(check.id, 24)}${check.detail}`);
  }
  out.push("");
  if (report.deferred.length > 0) {
    out.push(`deferred to the S→P flip: ${report.deferred.join(", ")}`);
  }
  out.push(
    report.ready
      ? "READY — every check gating this phase passed."
      : "NOT READY — a check gating this phase did not pass. Day 1 does not start.",
  );
  process.stdout.write(`${out.join("\n")}\n`);
  return report.ready ? 0 : 1;
}

/** A named refusal prints its sentence and exits 2, never a stack trace. */
function run(argv: readonly string[]): number {
  try {
    return main(argv);
  } catch (err) {
    const named = err as { name?: unknown; message?: unknown };
    if (named?.name === "WriterError" || named?.name === "RecordError" || named?.name === "ReaderError") {
      process.stderr.write(`REFUSED — ${String(named.message)}\n`);
      return 2;
    }
    throw err;
  }
}

process.exit(run(process.argv.slice(2)));

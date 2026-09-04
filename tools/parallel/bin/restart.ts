#!/usr/bin/env bun
/**
 * `parallel-restart` — the phase clock restarts, and says why.
 *
 * CONTRACT §5 G12: a behavior-changing fix landing mid-run restarts the phase.
 * The rule existed with no command behind it, so the seven-day count carried on
 * through changes that were supposed to reset it. This is the command.
 *
 * Same doctrine as the other two bins: every real path is a flag, the tool
 * writes ONLY the run directory, and a refusal is a named sentence with exit 2.
 * The live-store defaults are here because this is where a human types a path —
 * and they are here so the overlap guard has something real to refuse.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { restartArtifacts } from "../restart.js";
import type { RunPhase } from "../types.js";
import { RunDir } from "../writer.js";

interface Args {
  runDir: string;
  date: string;
  reason: string;
  phase: RunPhase | null;
  v1Dir: string;
  v2DataDir: string;
  engramDir: string;
  abDir: string;
}

function usage(): never {
  process.stderr.write(
    [
      'usage: parallel-restart --run-dir <dir> --date <YYYY-MM-DD> --reason "<text>"',
      "",
      "  --run-dir <dir>       the run directory. The ONLY thing this tool writes.",
      "  --date <YYYY-MM-DD>   the FIRST day of the restarted clock. Days before it",
      "                        stay in days/ as history and stop counting.",
      '  --reason "<text>"     what landed, in one line (§5 G12 records the class).',
      "  --phase <0|P>         the phase whose clock restarts. Default: run.json's.",
      "  --v1-dir <dir>        v1's data dir — the run dir must be disjoint from it.",
      "  --v2-data-dir <dir>   v2's data dir.                default ~/.counterparts",
      "  --engram-dir <dir>    the third store.              default ~/.claude-engram",
      "  --ab-dir <dir>        the primacy assignment dir.   default ~/.memory-ab",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): Args {
  const home = homedir();
  const args: Args = {
    runDir: "",
    date: "",
    reason: "",
    phase: null,
    v1Dir: join(home, ".bansai"),
    v2DataDir: join(home, ".counterparts"),
    engramDir: join(home, ".claude-engram"),
    abDir: process.env["MEMORY_AB_DIR"] ?? join(home, ".memory-ab"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined) break;
    // A value that starts with `--` is a MISSING value, not a value (the same
    // guard the daily carries: `--date --phase P` otherwise records a day
    // literally named `--phase`).
    if (!flag.startsWith("--") || value === undefined || value.startsWith("--")) usage();
    i += 1;
    switch (flag) {
      case "--run-dir":
        args.runDir = value;
        break;
      case "--date":
        args.date = value;
        break;
      case "--reason":
        args.reason = value;
        break;
      case "--phase":
        if (value !== "0" && value !== "P") usage();
        args.phase = value;
        break;
      case "--v1-dir":
        args.v1Dir = value;
        break;
      case "--v2-data-dir":
        args.v2DataDir = value;
        break;
      case "--engram-dir":
        args.engramDir = value;
        break;
      case "--ab-dir":
        args.abDir = value;
        break;
      default:
        usage();
    }
  }
  if (args.runDir.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) usage();
  if (args.reason.trim().length === 0) usage();
  return args;
}

function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  // BEFORE ANYTHING ELSE: a run directory that overlaps a live store is refused
  // outright, the same guard the other two bins open with (§5 G1).
  const run = RunDir.open(args.runDir, {
    v1Dir: args.v1Dir,
    v2DataDir: args.v2DataDir,
    engramDir: args.engramDir,
    abDir: args.abDir,
  });
  const artifacts = restartArtifacts({
    runDir: args.runDir,
    date: args.date,
    reason: args.reason,
    ...(args.phase === null ? {} : { phase: args.phase }),
  });
  for (const [rel, value] of Object.entries(artifacts.json)) run.writeJson(rel, value);
  for (const [rel, text] of Object.entries(artifacts.files)) run.writeText(rel, text);

  const e = artifacts.entry;
  const cleared = Object.entries(e.clearedActiveDays)
    .map(([p, n]) => `${p}=${n}`)
    .join(", ");
  const now = Object.entries(artifacts.run.activeDays)
    .map(([p, n]) => `${p}=${n}`)
    .join(", ");
  process.stdout.write(
    [
      `PHASE CLOCK RESTARTED — phase ${e.phase}, first counting day ${e.date}`,
      "=".repeat(78),
      `  reason        ${e.reason}`,
      `  active days   was {${cleared}} · now {${now}}`,
      `  surfaceSet    ${e.surfaceSet} (G12's hash as of this restart)`,
      `  history       ${artifacts.run.days.length} day(s) kept in days/ — a restarted clock is not a deleted history`,
      `  recorded      run.json (phaseRestart) and restarts.jsonl, in ${run.root}`,
      "",
    ].join("\n"),
  );
  return 0;
}

/**
 * A NAMED REFUSAL IS AN ANSWER, not a crash — exit 2, as the other bins use it.
 */
function runMain(argv: readonly string[]): number {
  try {
    return main(argv);
  } catch (err) {
    const named = err as { name?: unknown; message?: unknown };
    if (
      named?.name === "WriterError" ||
      named?.name === "RecordError" ||
      named?.name === "RestartError" ||
      named?.name === "ReaderError"
    ) {
      process.stderr.write(`REFUSED — ${String(named.message)}\n`);
      return 2;
    }
    throw err;
  }
}

process.exit(runMain(process.argv.slice(2)));

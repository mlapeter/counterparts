#!/usr/bin/env bun
/**
 * `parallel-daily` — one lived day, classified, metered and recorded.
 *
 * Same doctrine as the preflight bin: every real path is a flag, the tool
 * writes only the run directory, and a RED-LINE exits non-zero. §5 G10 —
 * "red-lines halt and preserve" — is not a paragraph the operator is asked to
 * remember; it is this process's exit code.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { AUTHORSHIP_ASK } from "../../../src/adapters/claude-code/index.js";
import { dailyRecord } from "../record.js";
import type { Primacy, RunPhase } from "../types.js";
import { RunDir } from "../writer.js";

interface Args {
  runDir: string;
  date: string;
  v1Dir: string;
  v2DataDir: string;
  engramDir: string;
  abDir: string;
  v2Config: string | null;
  assignment: string | null;
  v1Wake: string | null;
  v2Wake: string | null;
  v1Ritual: string | null;
  phase: RunPhase | null;
  primacy: Primacy | null;
  seat: string | null;
  vectors: string | null;
  livedDay: number | null;
}

function usage(): never {
  process.stderr.write(
    [
      "usage: parallel-daily --run-dir <dir> --date <YYYY-MM-DD> [options]",
      "",
      "  --run-dir <dir>       the run directory. The ONLY thing this tool writes.",
      "  --date <YYYY-MM-DD>   the lived day to record.",
      "  --v1-dir <dir>        v1's data dir (read-only).      default ~/.bansai",
      "  --v2-data-dir <dir>   v2's data dir (read-only).      default ~/.counterparts",
      "  --engram-dir <dir>    the third store — the run dir must be disjoint from it.",
      "  --ab-dir <dir>        the primacy assignment dir.     default ~/.memory-ab",
      "  --v2-config <file>    v2's adapter config JSON — hashed into run.json.",
      "  --assignment <file>   the primacy assignment file — hashed into run.json.",
      "  --v1-wake <file>      v1's rendered wake for the day (cross-encoding probe).",
      "  --v2-wake <file>      v2's rendered wake for the day (the other direction).",
      "  --v1-ritual <file>    v1's ritual ask text, one probe per line. v2's own asks",
      "                        are taken from the adapter's AUTHORSHIP_ASK constant.",
      "  --phase <0|S|P>       overrides run.json.",
      "  --primacy <v1|v2>     overrides run.json.",
      "  --seat <id>           the acting seat, pinned into run.json.",
      "  --vectors <id>        the pinned vector generation.",
      "  --lived-day <n>       the store's lived day for this date, when known.",
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
    v1Dir: join(home, ".bansai"),
    v2DataDir: join(home, ".counterparts"),
    engramDir: join(home, ".claude-engram"),
    abDir: process.env["MEMORY_AB_DIR"] ?? join(home, ".memory-ab"),
    v2Config: null,
    assignment: null,
    v1Wake: null,
    v2Wake: null,
    v1Ritual: null,
    phase: null,
    primacy: null,
    seat: null,
    vectors: null,
    livedDay: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined) break;
    if (!flag.startsWith("--") || value === undefined) usage();
    i += 1;
    switch (flag) {
      case "--run-dir":
        args.runDir = value;
        break;
      case "--date":
        args.date = value;
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
      case "--v2-config":
        args.v2Config = value;
        break;
      case "--assignment":
        args.assignment = value;
        break;
      case "--v1-wake":
        args.v1Wake = value;
        break;
      case "--v2-wake":
        args.v2Wake = value;
        break;
      case "--v1-ritual":
        args.v1Ritual = value;
        break;
      case "--phase":
        if (value !== "0" && value !== "S" && value !== "P") usage();
        args.phase = value;
        break;
      case "--primacy":
        if (value !== "v1" && value !== "v2") usage();
        args.primacy = value;
        break;
      case "--seat":
        args.seat = value;
        break;
      case "--vectors":
        args.vectors = value;
        break;
      case "--lived-day": {
        const n = Number.parseInt(value, 10);
        if (!Number.isFinite(n)) usage();
        args.livedDay = n;
        break;
      }
      default:
        usage();
    }
  }
  if (args.runDir.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) usage();
  return args;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

/** A probe file, or the empty string. Read-only; an unreadable file is no probe. */
function readTextOr(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  // BEFORE ANY READ OR ANY MKDIR: a run directory that overlaps a live store is
  // refused outright (CONTRACT §5 G1). Opening it first also means a refusal
  // costs nothing — no directory is created, no store is opened.
  const run = RunDir.open(args.runDir, {
    v1Dir: args.v1Dir,
    v2DataDir: args.v2DataDir,
    engramDir: args.engramDir,
    abDir: args.abDir,
  });
  const artifacts = dailyRecord({
    runDir: args.runDir,
    date: args.date,
    v1Dir: args.v1Dir,
    v2DataDir: args.v2DataDir,
    ...(args.v2Config === null ? {} : { v2ConfigPath: args.v2Config }),
    ...(args.assignment === null ? {} : { assignmentPath: args.assignment }),
    ...(args.phase === null ? {} : { phase: args.phase }),
    ...(args.primacy === null ? {} : { primacy: args.primacy }),
    ...(args.seat === null ? {} : { seat: args.seat }),
    ...(args.vectors === null ? {} : { vectors: args.vectors }),
    ...(args.livedDay === null ? {} : { livedDay: args.livedDay }),
    v1WakeFile: args.v1Wake,
    v2WakeFile: args.v2Wake,
    ...(args.v1Ritual === null ? {} : { v1Ritual: [readTextOr(args.v1Ritual)] }),
    // v2's asks are CONSTANTS in the adapter, so the meter's v2->v1 direction
    // takes them from there rather than from a second copy — the same
    // one-recognizer-list rule `FOREIGN_MARKERS` follows. Without probes this
    // direction would print 0/0, which reads clean when it means unmeasured.
    v2Ritual: [AUTHORSHIP_ASK],
  });

  for (const [rel, value] of Object.entries(artifacts.json)) run.writeJson(rel, value);
  for (const [rel, text] of Object.entries(artifacts.files)) run.writeText(rel, text);

  const r = artifacts.record;
  const m = r.crossEncoding;
  const out: string[] = [];
  out.push(`COUNTERPARTS PARALLEL RUN — ${r.date} (phase ${r.phase}, primacy ${r.primacy})`);
  out.push("=".repeat(78));
  out.push(`  ${pad("class", 18)}${r.class.toUpperCase()}  [flags: ${r.flags.join(", ")}]`);
  out.push(`  ${pad("why", 18)}${r.why}`);
  out.push(`  ${pad("turns", 18)}${r.turns} (floor K=${r.turnFloor})`);
  out.push(
    `  ${pad("v1", 18)}lines ${r.v1.lines} · wake ${r.v1.wakeRendered}/${r.v1.wakeDelivered} · inject ${r.v1.surfaceInject} · asked ${r.v1.episodeAsked} · sessions ${r.v1.sessionStart}/${r.v1.sessionEnd}`,
  );
  out.push(
    `  ${pad("v1 ab.muted", 18)}${Object.entries(r.mute.v1AbMutedByHook).map(([h, n]) => `${h}=${n}`).join(", ") || "none"}`,
  );
  out.push(
    `  ${pad("v2 primacy", 18)}deliver ${JSON.stringify(r.mute.v2DeliverByHook)} · standdown ${JSON.stringify(r.mute.v2StanddownByHook)}`,
  );
  out.push(
    `  ${pad("v2 store", 18)}read-only proof ${String(r.v2.readOnlyProof)} · memories ${r.v2.memories.total} · created ${r.tally.v2.created} · exited ${r.tally.v2.exited}`,
  );
  out.push(`  ${pad("v2 not durable", 18)}${r.v2.nonDurable.join(", ")}`);
  if (r.v2.truncated) {
    out.push(
      `  ${pad("v2 events", 18)}TRUNCATED at ${r.v2.eventRowsRead} rows — every v2 count on this day is a FLOOR, not a total`,
    );
  }
  // `0/0` reads clean when it means UNMEASURED, so it never prints as a ratio.
  const shown = (d: typeof m.v1IntoV2): string =>
    d.measured ? `${d.hits}/${d.probes}` : "UNMEASURED (no probe offered)";
  out.push(
    `  ${pad("cross-encoding", 18)}v1→v2 ${shown(m.v1IntoV2)} · v2→v1 ${shown(m.v2IntoV1)} · bar ${m.bar} · exposure denominator ${m.exposureDenominator}`,
  );
  out.push(`  ${pad("v1 log copy", 18)}${r.v1LogCopy ?? "no detector lines on this day"}`);
  out.push("");
  out.push(
    m.redLine
      ? "RED-LINE — cross-encoding is above its committed bar. The run stops counting days; both stores and this run directory are the evidence (§5 G10)."
      : "no red-line on this day.",
  );
  process.stdout.write(`${out.join("\n")}\n`);
  return m.redLine ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));

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

// THE LEAF MODULE, not the barrel. `adapters/claude-code/index.js` re-exports
// `Counterpart` and `Store`, so importing the ask through it pulled both
// systems-under-test into the instrument's process — the independent-scorer
// rule's whole point ([v1] §17.2, replay G5). `hooks.js` is where the constant
// lives; nothing else comes with it.
import { stopAsk } from "../../../src/adapters/claude-code/hooks.js";
import { primacyFromAssignment } from "../assignment.js";
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
      "                        are taken from the adapter's own stopAsk().",
      "  --phase <0|P>         overrides run.json. P from day 1.",
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
    // A VALUE THAT STARTS WITH `--` IS A MISSING VALUE. `--date --v1-dir /x`
    // otherwise silently recorded a day literally named `--v1-dir`, and every
    // path flag would swallow the next flag as its argument.
    if (!flag.startsWith("--") || value === undefined || value.startsWith("--")) usage();
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
        if (value !== "0" && value !== "P") usage();
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
        // `parseInt("3abc")` is 3 and `Number.isFinite` is happy with it, so the
        // guard is on the SPELLING, not on the parse.
        if (!/^\d+$/.test(value)) usage();
        const n = Number.parseInt(value, 10);
        if (!Number.isSafeInteger(n)) usage();
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
    // The assignment file is what both resolvers actually read; when the
    // operator points at one, `--primacy` is checked against it (§5 G3).
    ...(args.assignment === null
      ? {}
      : { assignmentOverride: primacyFromAssignment(args.assignment) }),
    v1WakeFile: args.v1Wake,
    v2WakeFile: args.v2Wake,
    ...(args.v1Ritual === null ? {} : { v1Ritual: [readTextOr(args.v1Ritual)] }),
    // v2's asks are RENDERED by the adapter, so the meter's v2->v1 direction
    // takes them from there rather than from a second copy — the same
    // one-recognizer-list rule `FOREIGN_MARKERS` follows. Without probes this
    // direction would print 0/0, which reads clean when it means unmeasured.
    // The probe unit is a LINE, and the authorship ask now carries the session
    // id on two of its lines (`hooks.ts#stopAsk`): those lines are
    // session-specific and will not match, the rest are the recognizer.
    v2Ritual: [stopAsk("<session>", 1)],
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
  out.push(
    `  ${pad("quarantine", 18)}${
      r.quarantine.present
        ? `${r.quarantine.lines} span(s) across ${r.quarantine.files} scope ledger(s) (remember.span.quarantined, recomputed)`
        : "no spans/ directory — nothing to recompute"
    }`,
  );
  if (r.v2.truncated) {
    out.push(
      `  ${pad("v2 events", 18)}TRUNCATED at ${r.v2.eventRowsRead} rows — every v2 count on this day is a FLOOR, not a total`,
    );
  }
  // `0/0` reads clean when it means UNMEASURED, so it never prints as a ratio.
  const shown = (d: typeof m.v1IntoV2): string =>
    d.measured ? `${d.hits}/${d.probes}` : "UNMEASURED (no probe offered)";
  out.push(
    `  ${pad("cross-encoding", 18)}v1→v2 ${shown(m.v1IntoV2)} · v2→v1 ${shown(m.v2IntoV1)} · bar ${m.bar} · ` +
      `probe floor ${m.minLineChars} chars · exposure denominator ${m.exposureDenominator ?? "UNREAD"}`,
  );
  out.push(
    `  ${pad("meter rule", 18)}${m.ratioNote}${m.ratio === null ? "" : ` — ratio ${m.ratio.toFixed(4)} of ${m.ratioDenominator}`}`,
  );
  out.push(`  ${pad("v1 log copy", 18)}${r.v1LogCopy ?? "no detector lines on this day"}`);
  out.push("");
  // ── EVERY RED-LINE EXITS NONZERO, not only the meter's ───────────────────
  //
  // §5 G10 is "red-lines halt and preserve", and the exit code is how this
  // process says so. A day whose store could not be proved read-only, whose
  // event read errored or capped, or which was classified `contaminated` is
  // every bit as much a halt as a cross-encoding breach — and each of them used
  // to print in the table above and exit 0.
  const halts: string[] = [];
  if (m.redLine) {
    halts.push(
      m.phase !== "P"
        ? `cross-encoding recorded a verbatim hit before the flip, where the bar is zero in both directions (${m.ratioNote})`
        : m.v1IntoV2.hits > 0
          ? `cross-encoding found ${m.v1IntoV2.hits} v1 line(s) in v2's capture — the v1→v2 bar is ZERO in every phase, so the host's own exclusion has changed (§5 G8)`
          : `cross-encoding is above the committed ${m.ratioBar} share of v1's daily mints (${m.ratioNote})`,
    );
  }
  if (r.v2.present && r.v2.readOnlyProof !== true) {
    halts.push("v2's store was not proved read-only through the handle this instrument used");
  }
  if (r.v2.readErrors.length > 0) {
    halts.push(`${r.v2.readErrors.length} sqlite read error(s): ${r.v2.readErrors.join(" | ")}`);
  }
  if (r.v2.truncated) {
    halts.push(`the event read capped at ${r.v2.eventRowsRead} rows — every v2 count is a floor`);
  }
  if (r.class === "contaminated") {
    halts.push(`the day is CONTAMINATED: ${r.why}`);
  }
  if (m.namedFinding) {
    out.push(
      `  ${pad("finding", 18)}cross-encoding recorded ${m.total} hit(s) at or below the v2→v1 ratio — a NAMED FINDING, not a halt (${m.ratioNote})`,
    );
  }
  out.push("");
  out.push(
    halts.length === 0
      ? "no red-line on this day."
      : `RED-LINE — the run stops counting days; both stores and this run directory are the evidence (§5 G10):\n  - ${halts.join("\n  - ")}`,
  );
  process.stdout.write(`${out.join("\n")}\n`);
  return halts.length === 0 ? 0 : 1;
}

/**
 * A NAMED REFUSAL IS AN ANSWER, not a crash. `RunDir.open`, `readRunRecord` and
 * `dailyRecord` all throw rather than record past a problem — an overlapping
 * run directory, a corrupt run record, uncommitted bars, an unmetered day, a
 * primacy that disagrees with the assignment file, a store that is not provably
 * read-only. Each of those is the tool working; the operator should see the
 * sentence, not a stack trace. Exit 2, distinct from the red-line's 1.
 */
function run(argv: readonly string[]): number {
  try {
    return main(argv);
  } catch (err) {
    const named = err as { name?: unknown; code?: unknown; message?: unknown };
    if (named?.name === "WriterError" || named?.name === "RecordError" || named?.name === "ReaderError") {
      process.stderr.write(`REFUSED — ${String(named.message)}\n`);
      return 2;
    }
    throw err;
  }
}

process.exit(run(process.argv.slice(2)));

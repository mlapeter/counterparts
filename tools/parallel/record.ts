/**
 * `tools/parallel/record.ts` — one lived day, classified and metered.
 *
 * CONTRACT §5 Outputs: "a run record per lived day (its class; primacy, seat,
 * vector generation, both systems' config hashes, mute evidence, isolation
 * meters) with that day's relevant v1 log lines copied in, read-only — G2's
 * evidence must not depend on v1's 30-day log retention."
 *
 * THE CLASSES ARE NOT A LADDER OF SEVERITY, they are diagnoses, and a day can
 * match more than one. So every match is kept in `flags` and ONE is chosen for
 * `class` by a stated precedence — `mixed` before `contaminated`, because a
 * straddling session's later `ab.muted` IS the flip rather than a revived
 * instrument, and calling it contamination would misname the one day the run
 * knows it created (§5 G3).
 *
 * Nothing here writes; `dailyRecord` returns the record and the artifacts, and
 * the caller hands them to `writer.ts` (G1).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { contentAddress } from "../replay/corpus.js";

import { readBars } from "./preflight.js";
import { surfaceSetHash } from "./surface.js";
import {
  V1_CREATED_EVENT,
  V1_DETECTOR_TYPES,
  V1_EXITED_EVENT,
  dateOf,
  fileHash,
  filesUnder,
  jsonlFiles,
  proseRows,
  readQuarantineLines,
  readV1Day,
  readV1Lines,
  readV2Day,
  realpathOr,
} from "./readers.js";
import type {
  Bars,
  ContaminationDetectors,
  CreatedExited,
  CrossEncodingDirection,
  CrossEncodingMeter,
  DailyRecord,
  DayClass,
  Primacy,
  RunPhase,
  RunRecord,
} from "./types.js";

// ---------------------------------------------------------------------------
// The cross-encoding meter (§5 G7)
// ---------------------------------------------------------------------------

/**
 * ONE CONTENT-ADDRESS FUNCTION JOINS THE CORPORA ([v1] §17.1, CONTRACT §3), and
 * here it takes its second duty: detecting one system's ritual text minted into
 * the other's store. It is `tools/replay/corpus.ts`'s `contentAddress` — the
 * same 16-hex prefix `store/prose.ts#hashText` computes — imported rather than
 * re-derived, so the two cannot agree by accident.
 *
 * The unit is a LINE, not a document: a wake bundle re-minted whole is rare, a
 * single sentence of it surviving into the other side's prose is the real
 * shape. Empty and whitespace-only lines are dropped — they would match
 * everything.
 */
export function addressLines(text: string, minChars = 0): {
  addresses: Set<string>;
  rejectedShort: number;
} {
  const addresses = new Set<string>();
  let rejectedShort = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // A MARKDOWN RULE IS NOT A PROBE. `---` is both the frontmatter fence and
    // an ordinary horizontal rule inside a body, so it addresses identically in
    // every prose file in the store: offered as a probe it hits everything, and
    // sitting in the corpus it makes every `---` probe hit. It is dropped on
    // both sides, before the floor, because it is structure rather than text.
    if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed) || /^_{3,}$/.test(trimmed)) continue;
    // THE COMMITTED FLOOR. Without one, `## Notes`, `Yes.` and `---` are
    // probes: short, structural lines that recur in every store by coincidence
    // and manufacture verbatim "hits" that mean nothing. The floor is a
    // pre-committed number in `bars.json`, dated like every other bar (§5 G15),
    // never a default this file chooses after seeing the data.
    if (trimmed.length < minChars) {
      rejectedShort += 1;
      continue;
    }
    addresses.add(contentAddress(trimmed));
  }
  return { addresses, rejectedShort };
}

interface Corpus {
  /** Address → how many receiving-side LINES carry it (the OQ4 numerator counts lines). */
  addresses: Map<string, number>;
  scanned: number;
  rejectedShort: number;
  /** Lines whose own date could not be read. Included, and SAID (see below). */
  undated: number;
}

const EMPTY_CORPUS = (): Corpus => ({
  addresses: new Map<string, number>(),
  scanned: 0,
  rejectedShort: 0,
  undated: 0,
});

/** Every qualifying line of every file, addressed. Read-only, never throws. */
function addressFiles(
  files: readonly string[],
  extract: (raw: string) => { texts: string[]; undated: number },
  minChars: number,
): Corpus {
  const out = EMPTY_CORPUS();
  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const got = extract(raw);
    out.undated += got.undated;
    for (const text of got.texts) {
      const { addresses, rejectedShort } = addressLines(text, minChars);
      out.rejectedShort += rejectedShort;
      for (const address of addresses) {
        out.addresses.set(address, (out.addresses.get(address) ?? 0) + 1);
        out.scanned += 1;
      }
    }
  }
  return out;
}

/**
 * THE DAY THIS LINE BELONGS TO, off the line itself.
 *
 * v2 spans carry `at` (epoch ms) and `day` (the lived day); v1's buffer lines
 * carry an ISO `ts`. One reader, both shapes — and `day` is deliberately NOT
 * used, because it is the lived day, not the calendar day the record is about.
 */
function lineDate(o: Record<string, unknown>): string | null {
  for (const key of ["ts", "timestamp", "at"] as const) {
    const v = o[key];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    if (typeof v === "number" && Number.isFinite(v)) return dateOf(v);
  }
  return null;
}

/**
 * A `.jsonl` of spans: the `text` of every line that belongs to THIS DAY.
 *
 * The meter used to scan the whole store on every run, so one legitimate hit
 * kept re-firing for the rest of the run and the number said nothing about the
 * day it was printed beside. A line whose date cannot be read is INCLUDED and
 * counted as `undated`: for a red-line, failing toward detection is the right
 * direction, and the count rides on the record so the number stays legible.
 */
function spanTextsFor(date: string): (raw: string) => { texts: string[]; undated: number } {
  return (raw: string) => {
    const texts: string[] = [];
    let undated = 0;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const o = JSON.parse(trimmed) as Record<string, unknown>;
        // v2's own span shape, then v1's (`spanText`) — one reader, both sides.
        const text = o["text"] ?? o["spanText"];
        if (typeof text !== "string" || text.length === 0) continue;
        const on = lineDate(o);
        if (on === null) undated += 1;
        else if (on !== date) continue;
        texts.push(text);
      } catch {
        continue;
      }
    }
    return { texts, undated };
  };
}

const FENCE = "---";

/** A prose file's BODY. Frontmatter is the instrument's own metadata, not text. */
function proseBodyOf(raw: string): string {
  const lines = raw.split("\n");
  if (lines[0] !== FENCE) return raw;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === FENCE) return lines.slice(i + 1).join("\n");
  }
  return raw;
}

/**
 * The durable records that mean V2 SPOKE into a session. `adapter.wake.injected`
 * and `adapter.recall` are the two injection channels; `adapter.episode.ask` is
 * the ritual. `adapter.wake.delivered` is deliberately absent — it records the
 * ARRIVAL of the previous session's wake on this turn, not a delivery into this
 * session (scar §2.3: render and delivery are two events, and this list is
 * about the speaking end).
 */
const DELIVERY_RECORDS: readonly string[] = [
  "adapter.wake.injected",
  "adapter.recall",
  "adapter.episode.ask",
];

/**
 * Every phase a day can be stamped with, so the counts below are total. TWO,
 * since the owner dropped the shadow phase (RULED 2026-09-03): `0` is day 0,
 * before the flip, and no minimum counts it; `P` is the run.
 */
const RUN_PHASES: readonly RunPhase[] = ["0", "P"];

export interface MeterSide {
  /** The addresses this side INJECTED — the probes. */
  readonly probes: Set<string>;
}

/**
 * Scan one side's store for the other side's injected addresses.
 *
 * `migrated` rows are excluded BY CONSTRUCTION (PR-2 doctrine, §5 G7):
 * v1-origin text in v2's store is the migration, not contamination.
 */
function meterInto(
  probes: { addresses: Set<string>; rejectedShort: number },
  corpus: Corpus,
  side: { excludedMigrated: number; readErrors: readonly string[]; missingOnDisk: number },
): CrossEncodingDirection {
  // `hits` counts receiving-side LINES, not probes (delta N2): OQ4's ratio is
  // "v1 mints carrying a verbatim v2 line over v1's mints that day", and a
  // probe-count numerator is bounded by the v2 wake's line count, unrelated to
  // v1's volume — every v1 mint carrying the same ask line would read as 1.
  const hitAddresses: string[] = [];
  let lineHits = 0;
  for (const probe of probes.addresses) {
    const n = corpus.addresses.get(probe);
    if (n !== undefined && n > 0) {
      hitAddresses.push(probe);
      lineHits += n;
    }
  }
  hitAddresses.sort();
  return {
    probes: probes.addresses.size,
    hits: lineHits,
    distinctHits: hitAddresses.length,
    measured: probes.addresses.size > 0 && side.readErrors.length === 0,
    hitAddresses,
    excludedMigrated: side.excludedMigrated,
    readErrors: [...side.readErrors],
    missingOnDisk: side.missingOnDisk,
    scanned: corpus.scanned,
    probesRejectedShort: probes.rejectedShort,
    corpusRejectedShort: corpus.rejectedShort,
    undatedScanned: corpus.undated,
  };
}

export interface CrossEncodingInput {
  readonly v2DataDir: string;
  readonly v1Dir: string;
  /** THE DAY. The corpus is scoped to it on both sides; there is no default. */
  readonly date: string;
  /** Which phase's rule applies (OQ4, RULED 2026-09-03). See below. */
  readonly phase: RunPhase;
  /** The v1→v2 bar. ZERO by rule in every phase; `readBars` refuses any other. */
  readonly bar: number;
  /** The committed probe floor: `bars.json#crossEncodingMinLineChars`. */
  readonly minLineChars: number;
  /** Phase P's red-line ratio: `bars.json#crossEncodingRatioBar` (0.10). */
  readonly ratioBar: number;
  /** v1's mints on THIS day — the Phase-P ratio's denominator. Null if unread. */
  readonly v1CreatedThatDay?: number | null;
  /** v1's rendered wake for the day, as a file the owner points the tool at. */
  readonly v1WakeFile?: string | null;
  /** v1's ritual prompt strings — the asks that go into a real context. */
  readonly v1Ritual?: readonly string[];
  /** v2's rendered wake for the day, when one was captured. */
  readonly v2WakeFile?: string | null;
  /** v2's ritual prompt strings (its two asks). */
  readonly v2Ritual?: readonly string[];
  /** How much recall the primary actually delivered — G7's exposure denominator. */
  readonly exposureDenominator?: number | null;
}

export function crossEncoding(input: CrossEncodingInput): CrossEncodingMeter {
  const readText = (path: string | null | undefined): string => {
    if (path === null || path === undefined) return "";
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
  };
  const min = input.minLineChars;

  const probesOf = (file: string | null | undefined, texts: readonly string[]) => {
    const addresses = new Set<string>();
    let rejectedShort = 0;
    for (const text of [readText(file), ...texts]) {
      const got = addressLines(text, min);
      rejectedShort += got.rejectedShort;
      for (const a of got.addresses) addresses.add(a);
    }
    return { addresses, rejectedShort };
  };
  const v1Probes = probesOf(input.v1WakeFile, input.v1Ritual ?? []);
  const v2Probes = probesOf(input.v2WakeFile, input.v2Ritual ?? []);

  // ── the v2 side of the corpus: THIS DAY's spans + THIS DAY's prose ────────
  const spanFiles = jsonlFiles(join(input.v2DataDir, "spans"));
  const spanCorpus = addressFiles(spanFiles, spanTextsFor(input.date), min);

  const prose = nonMigratedProse(input.v2DataDir, input.date);
  const { paths: prosePaths, excludedMigrated } = prose;
  const proseCorpus = addressFiles(
    prosePaths,
    (raw) => ({ texts: [proseBodyOf(raw)], undated: 0 }),
    min,
  );
  const v2Corpus: Corpus = {
    addresses: [...spanCorpus.addresses, ...proseCorpus.addresses].reduce(
      (acc, [address, n]) => acc.set(address, (acc.get(address) ?? 0) + n),
      new Map<string, number>(),
    ),
    scanned: spanCorpus.scanned + proseCorpus.scanned,
    rejectedShort: spanCorpus.rejectedShort + proseCorpus.rejectedShort,
    undated: spanCorpus.undated + proseCorpus.undated,
  };

  // ── the v1 side: its buffer, read the same way, scoped to the same day ────
  // v1 archives its buffer into a per-DATE directory, so the path carries the
  // day for archived files; live buffer lines carry their own `ts`. Files whose
  // path names another date are dropped before they are opened.
  const v1Files = [
    ...jsonlFiles(join(input.v1Dir, "buffer")),
    ...jsonlFiles(join(input.v1Dir, "buffer-archive")),
  ].filter((p) => !hasOtherDate(relative(input.v1Dir, p), input.date));
  const v1Corpus = addressFiles(v1Files, spanTextsFor(input.date), min);

  const v1IntoV2 = meterInto(v1Probes, v2Corpus, {
    excludedMigrated,
    readErrors: prose.readErrors,
    missingOnDisk: prose.missingOnDisk,
  });
  const v2IntoV1 = meterInto(v2Probes, v1Corpus, { excludedMigrated: 0, readErrors: [], missingOnDisk: 0 });
  const total = v1IntoV2.hits + v2IntoV1.hits;

  // ── OQ4's rules, RULED 2026-09-03, now BY DIRECTION ──────────────────────
  //
  // With the shadow phase dropped there is one running phase, and the two rules
  // OQ4 gave to two phases belong to the two DIRECTIONS — which is what they
  // were always about:
  //
  //   v1 → v2 (v1's ritual text found in v2's capture): ZERO, in every phase.
  //     That exclusion is carried by the HOST's transcript shape, not by v2
  //     (§5 G8), so a hit means the host changed. No ratio can buy it down.
  //
  //   v2 → v1 (v2's injected text found in v1's buffer): OQ4's accepted cost.
  //     v1 keeps injected text in its capture buffer BY DESIGN (§4: no v1-side
  //     code changes), so while v2 is primary a nonzero count is expected —
  //     a NAMED FINDING at or below `ratioBar` of v1's mints that day, a
  //     red-line above it.
  //
  // Phase 0 is before the flip: v2 delivers nothing, so it can inject nothing,
  // and BOTH directions are the host-shape zero. `readBars` refuses a nonzero
  // `crossEncodingBar`, so the committed file cannot loosen the zero (delta N1).
  const running = input.phase === "P";
  const denominator = input.v1CreatedThatDay ?? null;
  const ratio =
    denominator === null || denominator === 0 ? null : v2IntoV1.hits / denominator;
  // Phase P with NO denominator: the ratio rule cannot be evaluated, and an
  // unmeasurable meter with hits on it is a halt, not a pass (§5 G10; delta
  // N7) — `null` ratio + hits ⇒ red-line.
  const v2IntoV1RedLine = ratio === null ? v2IntoV1.hits > 0 : ratio > input.ratioBar;
  const redLine = running
    ? v1IntoV2.hits > 0 || v2IntoV1RedLine
    : total > 0;
  const namedFinding = running && total > 0 && !redLine;

  return {
    phase: input.phase,
    bar: input.bar,
    minLineChars: min,
    ratioBar: input.ratioBar,
    v1IntoV2,
    v2IntoV1,
    total,
    redLine,
    namedFinding,
    ratio,
    ratioDenominator: denominator,
    ratioNote: !running
      ? `Phase 0 (before the flip, v2 delivering nothing): ZERO hits in either direction is the bar (§9 OQ4, RULED 2026-09-03) — the host's transcript shape carries v1's exclusion, so any hit means the host changed`
      : `Phase P, BY DIRECTION: v1→v2 ${v1IntoV2.hits} hit(s), where the bar is ZERO in every phase (host shape, §5 G8); ` +
        (denominator === null
          ? `v2→v1 ${v2IntoV1.hits} hit(s) with NO denominator — v1's mints for this day could not be read, so the ratio rule cannot be evaluated and any hit is a RED-LINE until it can (§5 G10)`
          : `v2→v1 ${v2IntoV1.hits} v1 line(s) carrying a verbatim v2 line against ${denominator} v1 mint(s) that day — red-line above ${input.ratioBar} (OQ4: v1 keeps v2's text by design)`),
    exposureDenominator: input.exposureDenominator ?? null,
  };
}

/**
 * True when a path names a `YYYY-MM-DD` that is NOT the day being metered.
 *
 * RELATIVE TO THE v1 DIRECTORY, always. Given an absolute path this would read
 * the dates in the ROOT — a `--v1-dir` of `~/.bansai-2026-08-15` (an ordinary
 * dated backup someone points the tool at) would silently drop every buffer
 * file in it as "another date", and the v2→v1 direction would meter nothing
 * while reporting a clean zero. The caller passes the relative path.
 */
function hasOtherDate(relPath: string, date: string): boolean {
  const found = relPath.match(/\d{4}-\d{2}-\d{2}/g);
  return found !== null && found.length > 0 && !found.includes(date);
}

/**
 * Every prose file v2 minted that is NOT a migrated row. The `memories` table
 * is the authority on mint source (`source`), so the exclusion is by ROW, not
 * by path convention — a migrated row's prose lives beside an authored one,
 * and v1-origin text in v2's store is the migration, not contamination
 * (PR-2 doctrine, §5 G7). `readers.ts` owns every sqlite handle in this tool;
 * this asks it for the rows rather than opening a second one.
 */
function nonMigratedProse(
  dataDir: string,
  date: string,
): { paths: string[]; excludedMigrated: number; readErrors: readonly string[]; missingOnDisk: number } {
  // THE DAY'S ROWS, not the whole store. `memories.learned_on` is the created
  // date, so the corpus is the prose v2 minted ON this day — otherwise one
  // legitimate hit re-fires every day for the rest of the run.
  //
  // REALPATH ON BOTH SIDES. The store records one spelling of a path and a
  // directory walk produces another (on macOS anything under `/var`), so the
  // migrated-row exclusion is done on realpaths (scar §2.13).
  const read = proseRows(dataDir);
  const rows = read.rows.filter((r) => r.learnedOn === date);
  const onDisk = new Set(
    filesUnder(join(dataDir, "prose"), (n) => n.endsWith(".md")).map((p) => realpathOr(p)),
  );
  const present = rows.filter((r) => onDisk.has(r.realpath));
  const kept = present.filter((r) => r.source !== "migrated");
  return {
    paths: kept.map((r) => r.realpath),
    excludedMigrated: present.length - kept.length,
    // A locked or drifted store must not read as an empty corpus (delta N3):
    // the errors ride out and the direction reads UNMEASURED, never a clean 0.
    readErrors: read.readErrors ?? [],
    // Rows whose prose file is not on disk: counted, not silently dropped (N10).
    missingOnDisk: rows.length - present.length,
  };
}

// ---------------------------------------------------------------------------
// The day's class
// ---------------------------------------------------------------------------

export interface DailyOptions {
  readonly runDir: string;
  readonly date: string;
  readonly v1Dir: string;
  readonly v2DataDir: string;
  readonly v2ConfigPath?: string;
  readonly assignmentPath?: string;
  /** Overrides `run.json`. Absent, the run record's own phase/primacy is used. */
  readonly phase?: RunPhase;
  readonly primacy?: Primacy;
  readonly bars?: Bars;
  readonly seat?: string;
  readonly vectors?: string;
  readonly startDate?: string;
  readonly v1WakeFile?: string | null;
  readonly v1Ritual?: readonly string[];
  readonly v2WakeFile?: string | null;
  readonly v2Ritual?: readonly string[];
  /**
   * The assignment file's `override`, read through `primacy.ts`. When given it
   * is CROSS-CHECKED against `primacy` and a disagreement is fatal — the file
   * is what both resolvers actually read (§5 G3).
   */
  readonly assignmentOverride?: string | null;
  /** The store's lived day for this date, when the caller knows it. */
  readonly livedDay?: number;
  /** The event read's row cap. A day that hits it cannot be classified. */
  readonly eventLimit?: number;
  readonly at?: string;
}

/** The written artifacts, keyed by run-relative path. The caller writes them. */
export interface DailyArtifacts {
  readonly record: DailyRecord;
  readonly run: RunRecord;
  readonly files: Readonly<Record<string, string>>;
  readonly json: Readonly<Record<string, unknown>>;
}


export class RecordError extends Error {
  readonly code: string;
  readonly detail: Readonly<Record<string, string>>;
  constructor(code: string, detail: Record<string, string> = {}) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "RecordError";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * The run record, or null when there is not one yet — and a THROW when there is
 * one that cannot be read.
 *
 * The old `catch { return null }` could not tell "no run has started" from "the
 * run record is corrupt", so a truncated `run.json` silently restarted the
 * phase clock: the day count, the class list and both config hashes reset, and
 * the scorecard rendered off a run that had lost its own history. A corrupt
 * record is evidence (§5 G10, "red-lines halt and PRESERVE"); the operator is
 * told, and the file is left exactly as it was found.
 */
export function readRunRecord(runDir: string): RunRecord | null {
  const path = join(runDir, "run.json");
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new RecordError("RUN_RECORD_UNREADABLE", {
      path,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new RecordError("RUN_RECORD_CORRUPT", {
      path,
      detail: err instanceof Error ? err.message : String(err),
      remedy: "the run record is preserved as evidence; repair or move it deliberately, never by re-running",
    });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RecordError("RUN_RECORD_CORRUPT", { path, detail: "not a JSON object" });
  }
  return parsed as RunRecord;
}

export function dailyRecord(opts: DailyOptions): DailyArtifacts {
  const prior = readRunRecord(opts.runDir);
  // A FRESH RUN IS AT PHASE 0, not at the running phase: day 0 exists before
  // the flip (the migration, the throwaway session, the first daily that writes
  // G12's baseline hash), and its primacy is still v1's. `--phase P` on day 1
  // is what starts the run, and every later day inherits it from `run.json`.
  const phase = opts.phase ?? prior?.phase ?? "0";
  const primacy: Primacy = opts.primacy ?? prior?.primacy ?? (phase === "P" ? "v2" : "v1");

  // BARS ARE REQUIRED, never defaulted. `DEFAULT_BARS` fabricated
  // `activeDayTurnFloor: 0`, under which EVERY lived day clears the floor and
  // the active-day count — the run's central number — is meaningless. §5 G15
  // commits the bars in the run directory, dated, at day 0 before the flip; the
  // instrument's job is to refuse to run without them, not to invent them.
  const bars = opts.bars ?? readBars(opts.runDir);
  if (bars === null) {
    throw new RecordError("BARS_NOT_COMMITTED", {
      runDir: opts.runDir,
      remedy:
        "write bars.json with activeDayTurnFloor, crossEncodingBar, crossEncodingMinLineChars, crossEncodingRatioBar, committedAt and preconditionDropDead before day 0 (§5 G7, G15)",
    });
  }

  // THE CROSS-ENCODING METER NEEDS A v1 PROBE, and reads 0 without one.
  // `UNMEASURED` on the direction was not enough: the daily record is the run's
  // evidence, and a day recorded with the v1→v2 direction never asked is a day
  // whose isolation was never metered at all (§5 G7: metered CONTINUOUSLY).
  const v1Ritual = (opts.v1Ritual ?? []).filter((t) => t.trim().length > 0);
  const wakeFile = opts.v1WakeFile ?? "";
  const hasV1Probe = v1Ritual.length > 0 || (wakeFile.length > 0 && existsSync(wakeFile));
  if (!hasV1Probe) {
    throw new RecordError("NO_V1_CROSS_ENCODING_PROBE", {
      date: opts.date,
      remedy:
        "pass --v1-wake <file> and/or --v1-ritual <file>. Without one the v1->v2 direction reads zero and the day's isolation is unmetered (§5 G7)",
    });
  }

  // THE OPERATOR'S `--primacy` AGAINST THE FILE THAT ACTUALLY DECIDES. v1 and
  // v2 both resolve primacy from the assignment file's `override` at every
  // hook; a record stamped with the operator's belief instead would misattribute
  // every contamination verdict on the day (§5 G3). Disagreement is fatal.
  const declared = opts.assignmentOverride ?? null;
  if (declared !== null) {
    const fromFile: Primacy | null =
      declared === "engram" ? "v2" : declared === "bansai" ? "v1" : null;
    if (fromFile === null || fromFile !== primacy) {
      throw new RecordError("PRIMACY_DISAGREES_WITH_ASSIGNMENT", {
        declared: primacy,
        assignmentOverride: declared,
        resolved: fromFile ?? "neither bansai nor engram",
        remedy:
          "the assignment file is what both resolvers read; fix the file or the flag, never record past the disagreement (§5 G3)",
      });
    }
  }

  const v1 = readV1Day(opts.v1Dir, opts.date);
  const v2 = readV2Day(opts.v2DataDir, opts.date, {
    ...(opts.livedDay === undefined ? {} : { livedDay: opts.livedDay }),
    ...(opts.eventLimit === undefined ? {} : { limit: opts.eventLimit }),
  });

  const deliverHooks = v2.primacyByHook.deliver;
  const v2Delivered = Object.values(deliverHooks).reduce((n, x) => n + x, 0);
  const v2StoodDown = Object.values(v2.primacyByHook.standdown).reduce((n, x) => n + x, 0);

  // ── G4: contamination, per channel, by named detector ─────────────────────
  // The muted side is the one that must be silent. v2's detectors are the four
  // delivery records, durable since 2026-09-03 (`adapter.wake.injected`,
  // `adapter.recall`, `adapter.episode.ask`, each with `date` and `session` in
  // its payload), counted by name out of box 2; `adapter.primacy.deliver` by
  // hook is the second, independent witness — either one on a muted day is
  // contamination.
  const v1Muted = primacy === "v2";
  const v2Muted = primacy === "v1";

  // v1's `wake.delivered` fires at its RENDER site despite the name — on v1's
  // side the two events are one, so the channel counts the render and says so
  // wherever it is cited (§5 G4's closing note), never sums them into a double.
  // A DAY WITH NO v1 LOG IS NOT A DAY v1 WAS SILENT. `{0, 0, 0}` off an absent
  // file reads as positive evidence that the muted side stayed muted, which is
  // the one thing an unread log cannot show (scar §2.4, §5 G4). v1's 30-day
  // retention makes this a real case, not a hypothetical.
  // v1's wake channel: `wake.delivered` ONLY. `wake.rendered` is the RUNNER
  // re-rendering the wake file after every consolidation (session-less, 5–17 a
  // day) and delivers to nobody — counting it flagged the first muted day as
  // contaminated on five runner renders (day 0, 2026-09-03; scar §2.3: render
  // is not delivery). `wake.delivered` fires in v1's session-start hook at the
  // moment the bundle is injected, which IS the delivery.
  const v1Detectors: ContaminationDetectors = v1.present
    ? {
        wake: v1.wakeDelivered,
        recall: v1.surfaceInject,
        ritual: v1.episodeAsked,
      }
    : { wake: null, recall: null, ritual: null };
  // A READ THAT FAILED IS NOT A DAY THAT WAS QUIET (review blocker 9). When the
  // event read errored, or capped, every count under it is a floor of unknown
  // depth — so the detectors read `null`, exactly as `ContaminationDetectors`
  // says they must, and the day cannot be classified `active` below.
  const v2Unreadable = v2.readErrors.length > 0 || v2.truncated;
  const v2Detectors: ContaminationDetectors = v2Unreadable
    ? { wake: null, recall: null, ritual: null }
    : {
        wake: v2.byNameForDate["adapter.wake.injected"] ?? 0,
        recall: v2.byNameForDate["adapter.recall"] ?? 0,
        ritual: v2.byNameForDate["adapter.episode.ask"] ?? 0,
      };

  const v1Signal =
    v1Detectors.wake === null
      ? null
      : v1Detectors.wake + (v1Detectors.recall ?? 0) + (v1Detectors.ritual ?? 0);
  const v1Contaminated = v1Muted && (v1Signal ?? 0) > 0;
  const v2Signal =
    v2Detectors.wake === null ? null : v2Detectors.wake + (v2Detectors.recall ?? 0) + (v2Detectors.ritual ?? 0);
  const v2Contaminated = v2Muted && !v2Unreadable && (v2Delivered > 0 || (v2Signal ?? 0) > 0);

  // ── the classes ───────────────────────────────────────────────────────────
  const straddled = v1.sessions.filter((s) => s.straddled);

  // SILENT IS A PER-SESSION JOIN, not a difference of counts.
  //
  // The old approximation subtracted M v2 session-start deliveries from N v1
  // muted sessions, which cancels: v2 speaking into session A while nobody
  // spoke into session B reads as zero silent sessions. The join exists after
  // all — every adapter record carries `session: input.sessionId`
  // (`hooks.ts#deliveryVerdict` and `#record`).
  //
  // THE ASSUMPTION, ASSERTED RATHER THAN ASSUMED: v1's `session` field and v2's
  // `input.sessionId` are the SAME host session id. Both systems are hooks of
  // one host and both stamp the id the host hands them; nothing derives or
  // re-mints it. The suite pins this on a fixture that uses one id on both
  // sides and asserts the join lands — if the host ever changes what it hands
  // one of them, that test goes red rather than this number going quietly wrong.
  const spokeInto = (session: string): boolean => {
    const row = v2.bySessionForDate[session];
    if (row === undefined) return false;
    // A DELIVERY into that session, by any channel: the session-start primacy
    // record, or any of the durable delivery records. A stand-down is not
    // speaking — it is the mute working, and the session is still silent.
    return Object.entries(row).some(
      ([key, n]) => n > 0 && (key.startsWith("deliver:") || DELIVERY_RECORDS.includes(key)),
    );
  };
  const mutedAtStart = v1.mutedAtSessionStart.length;
  const v2SessionStarts = deliverHooks["session-start"] ?? 0;
  // IS THE JOIN AVAILABLE AT ALL? Zero v2 rows for the date is a real answer —
  // v2 spoke nowhere, so every muted session was silent. Rows that carry no
  // `session` are NOT: that is a payload this instrument cannot join, and
  // declaring silence from it would be inventing the very evidence the class
  // is supposed to rest on. Unreadable counts are the same case.
  const v2DateRows = Object.values(v2.byNameForDate).reduce((n, x) => n + x, 0);
  const sessionsSeen = Object.keys(v2.bySessionForDate).length;
  const joinAvailable = !v2Unreadable && (v2DateRows === 0 || sessionsSeen > 0);
  const silentSessionIds = joinAvailable
    ? v1.mutedAtSessionStart.filter((session) => !spokeInto(session))
    : [];
  const silentSessions = silentSessionIds.length;

  const turns = v1.turns;
  // v2's DURABLE boundary evidence, three witnesses: a primacy record from the
  // `stop` hook, the episode-ask record, and — since 2026-09-03 — the boundary's
  // own `adapter.boundary` row, which every session-ending path leaves
  // (`session-end` and `pre-compact` included), so no path is unevidenced.
  const v2StopBoundaries = (deliverHooks["stop"] ?? 0) + (v2.primacyByHook.standdown["stop"] ?? 0);
  // The episode ask only fires on a session-ending path, so its durable record
  // is second-hand boundary evidence where the primacy row is absent.
  const v2AskBoundaries = v2.byNameForDate["adapter.episode.ask"] ?? 0;
  // And the boundary's own durable row (every session-ending path leaves one,
  // `session-end` and `pre-compact` included), so a day whose sessions never
  // passed through `stop` is still evidenced.
  const v2BoundaryRows = v2.byNameForDate["adapter.boundary"] ?? 0;
  const v2Boundaries = v2StopBoundaries + v2AskBoundaries + v2BoundaryRows;
  const bothReachedBoundary = v1.sessionEnd > 0 && v2Boundaries > 0;

  const flags: DayClass[] = [];
  if (straddled.length > 0) flags.push("mixed");
  if (v2Unreadable) flags.push("unreadable");
  if (v1Contaminated || v2Contaminated) flags.push("contaminated");
  if (silentSessions > 0) flags.push("silent");
  if (turns < bars.activeDayTurnFloor || !bothReachedBoundary) flags.push("thin");
  if (flags.length === 0) flags.push("active");

  // PRECEDENCE, stated: mixed first (the flip is the run's own act, not a
  // revived instrument), then UNREADABLE (a day whose evidence could not be
  // read is not a day with a diagnosis), then contamination, then silence,
  // then the floor. Every match stays in `flags` either way.
  const order: DayClass[] = ["mixed", "unreadable", "contaminated", "silent", "thin", "active"];
  const dayClass = (order.find((c) => flags.includes(c)) ?? "thin") as DayClass;

  const why = whyOf(dayClass, {
    turns,
    floor: bars.activeDayTurnFloor,
    bothReachedBoundary,
    straddled: straddled.length,
    silent: silentSessions,
    silentSessions: silentSessionIds.length,
    mutedAtStart,
    v2SessionStarts,
    v1Contaminated,
    v2Contaminated,
    v2Present: v2.present,
    readErrors: v2.readErrors.length,
    truncated: v2.truncated,
    v2StopBoundaries,
    v2AskBoundaries,
    joinAvailable,
    v2DateRows,
  });

  // ── the created-vs-exited tally, per kind, per system ─────────────────────
  const tallyV1: CreatedExited = {
    created: v1.byType[V1_CREATED_EVENT] ?? 0,
    exited: v1.byType[V1_EXITED_EVENT] ?? 0,
    byKind: {},
    bySource: {},
    attributable: v1.present,
    note: `v1 has no per-kind breakdown in its log; \`${V1_CREATED_EVENT}\` is an UPPER BOUND on creations (archive-on-overwrite fires it too) and \`${V1_EXITED_EVENT}\` is its only exit path in the audited window`,
  };
  const tallyV2: CreatedExited = {
    created: v2.memories.createdOnDate,
    exited: v2.memories.exitedOnDate,
    byKind: v2.memories.createdByKind,
    bySource: v2.memories.createdBySource,
    attributable: v2.present,
    note: `created by \`memories.learned_on\`; exited by ${v2.memories.exitedNote}`,
  };

  // ── the cross-encoding meter ──────────────────────────────────────────────
  const meter = crossEncoding({
    v2DataDir: opts.v2DataDir,
    v1Dir: opts.v1Dir,
    date: opts.date,
    phase,
    bar: bars.crossEncodingBar,
    minLineChars: bars.crossEncodingMinLineChars,
    ratioBar: bars.crossEncodingRatioBar,
    // Phase P's denominator: v1's mints on THIS day, from v1's own log. Null
    // when the log is absent, and the meter then says the ratio has none.
    v1CreatedThatDay: tallyV1.attributable ? tallyV1.created : null,
    v1WakeFile: opts.v1WakeFile ?? null,
    v1Ritual,
    v2WakeFile: opts.v2WakeFile ?? null,
    v2Ritual: opts.v2Ritual ?? [],
    // §5 G7's named blind spot: the semantic path this meter cannot see is
    // bounded by the recall volume the PRIMARY delivered. That is the number
    // the meter must be read beside, so it rides in the same object.
    exposureDenominator: primacy === "v1" ? v1Detectors.recall : v2Detectors.recall,
  });

  // ── the day's v1 log lines, copied (G2: off v1's 30-day retention clock) ──
  const { lines } = readV1Lines(opts.v1Dir, opts.date);
  const copied = lines.filter((l) => V1_DETECTOR_TYPES.includes(l.type));
  const logCopyPath = `v1-log-copies/events-${opts.date}.jsonl`;

  const record: DailyRecord = {
    date: opts.date,
    phase,
    primacy,
    class: dayClass,
    flags,
    why,
    turnFloor: bars.activeDayTurnFloor,
    turns,
    v1,
    v2,
    mute: {
      v1AbMutedByHook: v1.abMutedByHook,
      v2StanddownByHook: v2.primacyByHook.standdown,
      v2DeliverByHook: v2.primacyByHook.deliver,
    },
    contamination: {
      v1: v1Detectors,
      v2: v2Detectors,
    },
    tally: { v1: tallyV1, v2: tallyV2 },
    // `remember.span.quarantined`, recomputed rather than named as absent: the
    // F8 bound writes each given-up span into its scope's `quarantine.jsonl`,
    // so the line count is the number. Lines, never a line.
    quarantine: readQuarantineLines(opts.v2DataDir),
    crossEncoding: meter,
    v1LogCopy: copied.length > 0 ? logCopyPath : null,
  };

  // ── run.json, maintained ──────────────────────────────────────────────────
  //
  // EVERY DAY CARRIES ITS OWN PHASE, and the per-phase counts are recomputed
  // from that field on every write. The old line counted EVERY active day in
  // the run into whichever phase happened to be running, so a day lived before
  // the flip could clear a minimum it was never part of (review blocker 5). A
  // phase minimum counted from the wrong phase's days is the run's central
  // number being wrong — and with one running phase left, `activeDays.P` IS
  // that number: ≥7, a minimum before a verdict rather than a cap.
  const days = [
    ...(prior?.days ?? []).filter((d) => d.date !== opts.date),
    { date: opts.date, class: dayClass, phase },
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const activeDays: Record<string, number> = {};
  for (const p of RUN_PHASES) {
    activeDays[p] = days.filter((d) => d.class === "active" && d.phase === p).length;
  }

  const run: RunRecord = {
    startDate: opts.startDate ?? prior?.startDate ?? opts.date,
    phase,
    primacy,
    activeDays,
    days,
    configHashes: {
      v2Config: opts.v2ConfigPath === undefined ? (prior?.configHashes.v2Config ?? null) : fileHash(opts.v2ConfigPath),
      assignment:
        opts.assignmentPath === undefined
          ? (prior?.configHashes.assignment ?? null)
          : fileHash(opts.assignmentPath),
    },
    seat: opts.seat ?? prior?.seat ?? "",
    vectors: opts.vectors ?? prior?.vectors ?? "",
    // G12's carry-forward hash, written on every day so a mid-run change has
    // something from BEFORE it to be compared against (precondition 9).
    surfaceSet: surfaceSetHash(),
    updatedAt: opts.at ?? new Date().toISOString(),
  };

  return {
    record,
    run,
    files:
      copied.length > 0
        ? { [logCopyPath]: `${copied.map((l) => l.raw).join("\n")}\n` }
        : {},
    json: { [`days/${opts.date}.json`]: record, "run.json": run },
  };
}

interface WhyFacts {
  turns: number;
  floor: number;
  bothReachedBoundary: boolean;
  straddled: number;
  silent: number;
  silentSessions: number;
  mutedAtStart: number;
  v2SessionStarts: number;
  v1Contaminated: boolean;
  v2Contaminated: boolean;
  v2Present: boolean;
  readErrors: number;
  truncated: boolean;
  v2StopBoundaries: number;
  v2AskBoundaries: number;
  joinAvailable: boolean;
  v2DateRows: number;
}

function whyOf(cls: DayClass, f: WhyFacts): string {
  switch (cls) {
    case "mixed":
      return `${f.straddled} v1 session(s) carried a delivery event and a LATER ab.muted: the flip straddled a live session, which is two voices in one context (§5 G3)`;
    case "unreadable":
      return `v2's durable read did not complete — ${f.readErrors} sqlite read error(s)${f.truncated ? " and the event read hit its cap" : ""}. Every v2 count for this day is a floor of unknown depth, so the contamination detectors read null and the day is NOT classified. A read that failed is not a day that was quiet (scar §2.4).`;
    case "contaminated":
      return f.v1Contaminated
        ? "the MUTED v1 side emitted a wake, an inject-phase surface decision, or an episode ask (§5 G4)"
        : "the MUTED v2 side recorded a durable adapter.primacy.deliver or delivery record (§5 G4)";
    case "silent":
      return `${f.mutedAtStart} v1 session(s) were muted at session start and ${f.silentSessions} of them carry NO v2 delivery record for that same session id — nobody spoke into them. The state G4 cannot see by counting extra voices, so it is counted by its absence. PER-SESSION JOIN: v2's durable adapter payloads carry \`session\`, the host session id v1 stamps too, so this is a join rather than a difference of counts. A stand-down is not speaking.`;
    case "thin":
      if (f.bothReachedBoundary) {
        return `${f.turns} conversational turn(s) is below the committed floor of ${f.floor}`;
      }
      if (!f.v2Present) {
        return "no v2 store was found at the given data dir, so v2 reached no boundary this instrument can see";
      }
      if (f.v2StopBoundaries + f.v2AskBoundaries === 0) {
        return "one of the two systems reached no session boundary on this day (v2's evidence: a `stop` primacy record, an episode-ask record, or the durable `adapter.boundary` row every session-ending path leaves).";
      }
      return "one of the two systems reached no session boundary on this day";
    case "active":
      return (
        `both systems reached a boundary (v2 by ${f.v2StopBoundaries} stop-hook primacy record(s) and ${f.v2AskBoundaries} episode-ask record(s)) and the day carried ${f.turns} turn(s), at or above the committed floor of ${f.floor}` +
        (f.joinAvailable
          ? ""
          : ` — NOTE: the silent-session join was UNAVAILABLE (${f.v2DateRows} v2 row(s) for this date, none carrying a session id), so this day is not evidence that nobody was left unspoken to`)
      );
  }
}

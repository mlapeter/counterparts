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
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { contentAddress } from "../replay/corpus.js";

import { readBars } from "./preflight.js";
import {
  V1_CREATED_EVENT,
  V1_DETECTOR_TYPES,
  V1_EXITED_EVENT,
  fileHash,
  filesUnder,
  jsonlFiles,
  migratedProse,
  readV1Day,
  readV1Lines,
  readV2Day,
} from "./readers.js";
import type {
  Bars,
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
export function addressLines(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    out.add(contentAddress(trimmed));
  }
  return out;
}

/** Every non-empty line of every file, addressed. Read-only, never throws. */
function addressFiles(files: readonly string[], extract: (raw: string) => string[]): {
  addresses: Set<string>;
  scanned: number;
} {
  const addresses = new Set<string>();
  let scanned = 0;
  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const text of extract(raw)) {
      for (const address of addressLines(text)) {
        addresses.add(address);
        scanned += 1;
      }
    }
  }
  return { addresses, scanned };
}

/** A `.jsonl` of v2 spans: every `text` field. Nothing else leaves the file. */
function spanTexts(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const o = JSON.parse(trimmed) as Record<string, unknown>;
      // v2's own span shape, then v1's (`spanText`) — one reader, both sides.
      const text = o["text"] ?? o["spanText"];
      if (typeof text === "string" && text.length > 0) out.push(text);
    } catch {
      continue;
    }
  }
  return out;
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
  probes: ReadonlySet<string>,
  corpus: { addresses: Set<string>; scanned: number },
  excludedMigrated: number,
): CrossEncodingDirection {
  const hitAddresses: string[] = [];
  for (const probe of probes) {
    if (corpus.addresses.has(probe)) hitAddresses.push(probe);
  }
  hitAddresses.sort();
  return {
    probes: probes.size,
    hits: hitAddresses.length,
    measured: probes.size > 0,
    hitAddresses,
    excludedMigrated,
    scanned: corpus.scanned,
  };
}

export interface CrossEncodingInput {
  readonly v2DataDir: string;
  readonly v1Dir: string;
  readonly bar: number;
  /** v1's rendered wake for the day, as a file the owner points the tool at. */
  readonly v1WakeFile?: string | null;
  /** v1's ritual prompt strings — the asks that go into a real context. */
  readonly v1Ritual?: readonly string[];
  /** v2's rendered wake for the day, when one was captured. */
  readonly v2WakeFile?: string | null;
  /** v2's ritual prompt strings (its two asks). */
  readonly v2Ritual?: readonly string[];
  /** How much recall the primary actually delivered — G7's exposure denominator. */
  readonly exposureDenominator?: number;
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

  const v1Probes = new Set<string>();
  for (const a of addressLines(readText(input.v1WakeFile))) v1Probes.add(a);
  for (const text of input.v1Ritual ?? []) for (const a of addressLines(text)) v1Probes.add(a);

  const v2Probes = new Set<string>();
  for (const a of addressLines(readText(input.v2WakeFile))) v2Probes.add(a);
  for (const text of input.v2Ritual ?? []) for (const a of addressLines(text)) v2Probes.add(a);

  // ── the v2 side of the corpus: captured spans + non-migrated prose ────────
  const spanFiles = jsonlFiles(join(input.v2DataDir, "spans"));
  const spanCorpus = addressFiles(spanFiles, spanTexts);

  const { paths: prosePaths, excludedMigrated } = nonMigratedProse(input.v2DataDir);
  const proseCorpus = addressFiles(prosePaths, (raw) => [proseBodyOf(raw)]);
  const v2Corpus = {
    addresses: new Set<string>([...spanCorpus.addresses, ...proseCorpus.addresses]),
    scanned: spanCorpus.scanned + proseCorpus.scanned,
  };

  // ── the v1 side: its buffer, read the same way ────────────────────────────
  const v1Files = [
    ...jsonlFiles(join(input.v1Dir, "buffer")),
    ...jsonlFiles(join(input.v1Dir, "buffer-archive")),
  ];
  const v1Corpus = addressFiles(v1Files, spanTexts);

  const v1IntoV2 = meterInto(v1Probes, v2Corpus, excludedMigrated);
  const v2IntoV1 = meterInto(v2Probes, v1Corpus, 0);
  const total = v1IntoV2.hits + v2IntoV1.hits;

  return {
    bar: input.bar,
    v1IntoV2,
    v2IntoV1,
    total,
    redLine: total > input.bar,
    exposureDenominator: input.exposureDenominator ?? 0,
  };
}

/**
 * Every prose file v2 minted that is NOT a migrated row. The `memories` table
 * is the authority on mint source (`source`), so the exclusion is by ROW, not
 * by path convention — a migrated row's prose lives beside an authored one,
 * and v1-origin text in v2's store is the migration, not contamination
 * (PR-2 doctrine, §5 G7). `readers.ts` owns every sqlite handle in this tool;
 * this asks it for the rows rather than opening a second one.
 */
function nonMigratedProse(dataDir: string): { paths: string[]; excludedMigrated: number } {
  const all = filesUnder(join(dataDir, "prose"), (n) => n.endsWith(".md"));
  const migrated = new Set(migratedProse(dataDir));
  if (migrated.size === 0) return { paths: all, excludedMigrated: 0 };
  const paths = all.filter((p) => !migrated.has(p));
  return { paths, excludedMigrated: all.length - paths.length };
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
  /** The store's lived day for this date, when the caller knows it. */
  readonly livedDay?: number;
  readonly at?: string;
}

/** The written artifacts, keyed by run-relative path. The caller writes them. */
export interface DailyArtifacts {
  readonly record: DailyRecord;
  readonly run: RunRecord;
  readonly files: Readonly<Record<string, string>>;
  readonly json: Readonly<Record<string, unknown>>;
}

const DEFAULT_BARS: Bars = {
  activeDayTurnFloor: 0,
  crossEncodingBar: 0,
  committedAt: "",
};

export function readRunRecord(runDir: string): RunRecord | null {
  try {
    const raw = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as RunRecord;
    return typeof raw === "object" && raw !== null ? raw : null;
  } catch {
    return null;
  }
}

export function dailyRecord(opts: DailyOptions): DailyArtifacts {
  const prior = readRunRecord(opts.runDir);
  const phase = opts.phase ?? prior?.phase ?? "S";
  const primacy: Primacy = opts.primacy ?? prior?.primacy ?? (phase === "P" ? "v2" : "v1");
  const bars = opts.bars ?? readBars(opts.runDir) ?? DEFAULT_BARS;

  const v1 = readV1Day(opts.v1Dir, opts.date);
  const v2 = readV2Day(opts.v2DataDir, opts.date, opts.livedDay === undefined ? {} : { livedDay: opts.livedDay });

  const deliverHooks = v2.primacyByHook.deliver;
  const v2Delivered = Object.values(deliverHooks).reduce((n, x) => n + x, 0);
  const v2StoodDown = Object.values(v2.primacyByHook.standdown).reduce((n, x) => n + x, 0);

  // ── G4: contamination, per channel, by named detector ─────────────────────
  // The muted side is the one that must be silent. `null` on the v2 side is
  // NOT zero: those detectors are ephemeral (see readers.ts), so the honest
  // reading is "not durably observable", and the only positive v2 delivery
  // evidence box 2 carries is `adapter.primacy.deliver`, by hook.
  const v1Muted = primacy === "v2";
  const v2Muted = primacy === "v1";

  // v1's `wake.delivered` fires at its RENDER site despite the name — on v1's
  // side the two events are one, so the channel counts the render and says so
  // wherever it is cited (§5 G4's closing note), never sums them into a double.
  const v1Detectors = {
    wake: Math.max(v1.wakeRendered, v1.wakeDelivered),
    recall: v1.surfaceInject,
    ritual: v1.episodeAsked,
  };
  const v2Detectors = {
    wake: deliverHooks["session-start"] ?? 0,
    recall: deliverHooks["user-prompt-submit"] ?? 0,
    ritual: deliverHooks["stop"] ?? 0,
  };

  const v1Contaminated = v1Muted && (v1Detectors.wake + v1Detectors.recall + v1Detectors.ritual) > 0;
  const v2Contaminated = v2Muted && v2Delivered > 0;

  // ── the classes ───────────────────────────────────────────────────────────
  const straddled = v1.sessions.filter((s) => s.straddled);

  // SILENT is a per-SESSION state — v1 muted at session start and v2 delivering
  // nothing into that same session — and the join it needs does not exist:
  // `deliveryVerdict`'s durable payload is `{hook, reason, system, date}` and
  // carries NO session id, so a v2 record cannot be matched to a v1 session.
  // The honest approximation is the count difference, and it is named as one
  // rather than dressed up as a join: N v1 sessions muted at start against M
  // v2 session-start deliveries leaves N-M sessions nobody spoke into. It
  // under-detects only when v2 delivered into a session v1 never muted, which
  // is the CONTAMINATED case and is caught by its own detector.
  const mutedAtStart = v1.mutedAtSessionStart.length;
  const v2SessionStarts = deliverHooks["session-start"] ?? 0;
  const silentSessions = Math.max(0, mutedAtStart - v2SessionStarts);

  const turns = v1.turns;
  // v2's only DURABLE boundary evidence is a primacy record from the `stop`
  // hook: `sessionEnd` and `pre-compaction` never call `deliveryVerdict`, so a
  // session-start record is not a boundary and must not be read as one.
  const v2Boundaries = (deliverHooks["stop"] ?? 0) + (v2.primacyByHook.standdown["stop"] ?? 0);
  const bothReachedBoundary = v1.sessionEnd > 0 && v2Boundaries > 0;

  const flags: DayClass[] = [];
  if (straddled.length > 0) flags.push("mixed");
  if (v1Contaminated || v2Contaminated) flags.push("contaminated");
  if (silentSessions > 0) flags.push("silent");
  if (turns < bars.activeDayTurnFloor || !bothReachedBoundary) flags.push("thin");
  if (flags.length === 0) flags.push("active");

  // PRECEDENCE, stated: mixed first (the flip is the run's own act, not a
  // revived instrument), then contamination, then silence, then the floor.
  const order: DayClass[] = ["mixed", "contaminated", "silent", "thin", "active"];
  const dayClass = (order.find((c) => flags.includes(c)) ?? "thin") as DayClass;

  const why = whyOf(dayClass, {
    turns,
    floor: bars.activeDayTurnFloor,
    bothReachedBoundary,
    straddled: straddled.length,
    silent: silentSessions,
    mutedAtStart,
    v2SessionStarts,
    v1Contaminated,
    v2Contaminated,
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
    note: "created by `memories.learned_on`; exited by an archived row's `versions.archived_at` on this UTC date — the schema keeps no archived-at on the row itself",
  };

  // ── the cross-encoding meter ──────────────────────────────────────────────
  const meter = crossEncoding({
    v2DataDir: opts.v2DataDir,
    v1Dir: opts.v1Dir,
    bar: bars.crossEncodingBar,
    v1WakeFile: opts.v1WakeFile ?? null,
    v1Ritual: opts.v1Ritual ?? [],
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
      // The three v2 channels box 2 CANNOT carry read `null`, not `0`.
      v2: { wake: null, recall: null, ritual: null },
    },
    tally: { v1: tallyV1, v2: tallyV2 },
    crossEncoding: meter,
    v1LogCopy: copied.length > 0 ? logCopyPath : null,
  };

  // ── run.json, maintained ──────────────────────────────────────────────────
  const days = [...(prior?.days ?? []).filter((d) => d.date !== opts.date), { date: opts.date, class: dayClass }].sort(
    (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
  );
  const activeDays: Record<string, number> = { ...(prior?.activeDays ?? {}) };
  activeDays[phase] = days.filter((d) => d.class === "active").length;

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

function whyOf(
  cls: DayClass,
  f: {
    turns: number;
    floor: number;
    bothReachedBoundary: boolean;
    straddled: number;
    silent: number;
    mutedAtStart: number;
    v2SessionStarts: number;
    v1Contaminated: boolean;
    v2Contaminated: boolean;
  },
): string {
  switch (cls) {
    case "mixed":
      return `${f.straddled} v1 session(s) carried a delivery event and a LATER ab.muted: the flip straddled a live session, which is two voices in one context (§5 G3)`;
    case "contaminated":
      return f.v1Contaminated
        ? "the MUTED v1 side emitted a wake, an inject-phase surface decision, or an episode ask (§5 G4)"
        : "the MUTED v2 side recorded a durable adapter.primacy.deliver (§5 G4)";
    case "silent":
      return `${f.mutedAtStart} v1 session(s) muted at session start against ${f.v2SessionStarts} v2 session-start deliver record(s): ${f.silent} session(s) nobody spoke into — the state G4 cannot see by counting extra voices, so it is counted by its absence. COUNT-LEVEL: v2's durable primacy payload carries no session id, so this is a difference of counts, not a per-session join.`;
    case "thin":
      return f.bothReachedBoundary
        ? `${f.turns} conversational turn(s) is below the committed floor of ${f.floor}`
        : "one of the two systems reached no session boundary on this day";
    case "active":
      return `both systems reached a boundary and the day carried ${f.turns} turn(s), at or above the committed floor of ${f.floor}`;
  }
}

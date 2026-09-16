/**
 * `tools/parallel/` — the instrument, tested against its own CONTRACT.
 *
 * HERMETIC BY CONSTRUCTION, twice over. Every test makes a fresh temp tree in
 * `beforeEach` and removes exactly that path in `afterEach`; and the tool takes
 * every real path as a PARAMETER, so no test here can reach `~/.bansai`,
 * `~/.memory-ab`, `~/.claude-engram`, `~/.counterparts` or `~/.claude/projects`
 * even by accident. All fixture text is synthetic — no line of it came from a
 * real memory, a real transcript or a real log.
 *
 * The two guarantees that are structural rather than behavioural get structural
 * tests: §5 G1 ("the instrument writes nothing but its own run directory") is a
 * BYTE-IDENTITY manifest across a whole preflight-plus-daily run, plus a
 * source-scan that fails the suite if a filesystem write API appears in any
 * module but the writer.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Store } from "../src/core/store/index.js";
import { DATA_DIR_ENV, FORBIDDEN_ROOT_NAMES, explicitDirMalformedRefusal } from "../src/core/store/index.js";
import { v2DataDirGate, v2DataDirNotice, v2DataDirRefusal } from "../tools/parallel/live-stores.js";
import { AB_DIR_ENV } from "../src/adapters/claude-code/index.js";
import { PRIMACY_DELIVER_EVENT, PRIMACY_STANDDOWN_EVENT } from "../src/core/counterpart.js";
import { METRICS } from "../tools/replay/baselines.js";

import {
  KNOWN_NOT_EXERCISED,
  NOT_APPLICABLE_TO_RUN,
  PARALLEL_EXERCISABLE,
  RATER_DEFERRED,
  WIRING_ALIVE,
  parallelGateOpen,
  parseGateRecord,
} from "../tools/parallel/gate.js";
import {
  addressLines,
  crossEncoding,
  dailyRecord,
  gradeReinforced,
} from "../tools/parallel/record.js";
import { TUNABLES as PHYSICS } from "../src/core/physics/index.js";
import {
  hookModel,
  overlaps,
  probeReadOnly,
  readAssignmentAs,
  readSchemaBytes,
  readV1Day,
  readV2Day,
  realpathOr,
  scanTranscripts,
  transcriptFiles,
} from "../tools/parallel/readers.js";
import { preflightArtifacts, readBars, runPreflight } from "../tools/parallel/preflight.js";
import { surfaceSetComponents, surfaceSetHash } from "../tools/parallel/surface.js";
import { surfaceSetFields } from "../src/core/counterpart.js";
import { readRunRecord } from "../tools/parallel/record.js";
import { primacyFromAssignment, primacyReading } from "../tools/parallel/assignment.js";
import { restartArtifacts } from "../tools/parallel/restart.js";
import { RunDir } from "../tools/parallel/writer.js";
import type { LiveStores } from "../tools/parallel/writer.js";
import type { GateEntry, GateReadableRecord } from "../tools/parallel/gate.js";

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures — all synthetic
// ═══════════════════════════════════════════════════════════════════════════

let root: string;
let priorData: string | undefined;
let priorAb: string | undefined;
const opened: Store[] = [];

beforeEach(() => {
  priorData = process.env[DATA_DIR_ENV];
  priorAb = process.env[AB_DIR_ENV];
  root = mkdtempSync(join(tmpdir(), "counterparts-parallel-"));
});

afterEach(() => {
  for (const s of opened.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  if (priorData === undefined) delete process.env[DATA_DIR_ENV];
  else process.env[DATA_DIR_ENV] = priorData;
  if (priorAb === undefined) delete process.env[AB_DIR_ENV];
  else process.env[AB_DIR_ENV] = priorAb;
  rmSync(root, { recursive: true, force: true });
});

function at(...parts: string[]): string {
  const p = join(root, ...parts);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

function dir(...parts: string[]): string {
  const p = join(root, ...parts);
  mkdirSync(p, { recursive: true });
  return p;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** A v1 log line, shaped exactly as v1 writes one. */
interface V1Ev {
  ts?: string;
  seq?: number;
  session?: string | null;
  type: string;
  hook?: string;
  phase?: string;
}

function v1Log(v1Dir: string, date: string, events: readonly V1Ev[]): void {
  const lines = events.map((e, i) =>
    JSON.stringify({
      ts: e.ts ?? `${date}T09:0${Math.min(9, i)}:00.000Z`,
      seq: e.seq ?? i,
      session: e.session ?? null,
      ...e,
    }),
  );
  const path = join(v1Dir, "logs", `events-${date}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

/** The same, but writing EXACTLY the given fields — no `seq` is invented. */
function v1LogRaw(v1Dir: string, date: string, events: readonly Record<string, unknown>[]): void {
  const path = join(v1Dir, "logs", `events-${date}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
}

/** A REAL v2 store, built with the store's own API, then read back read-only. */
/**
 * `now` is the store's PROVENANCE clock (`StoreOptions.now`), and a test that
 * needs an event stamped on a particular calendar date has to set it: `events.at`
 * reads this and nothing else. Absent, it is the ambient wall clock, exactly as
 * every caller before it had.
 */
function buildStore(dataDir: string, build: (s: Store) => void, now?: () => number): void {
  const prior = process.env[DATA_DIR_ENV];
  process.env[DATA_DIR_ENV] = dataDir;
  try {
    const s = Store.open(now === undefined ? { dir: dataDir } : { dir: dataDir, now });
    try {
      build(s);
    } finally {
      s.close();
    }
  } finally {
    if (prior === undefined) delete process.env[DATA_DIR_ENV];
    else process.env[DATA_DIR_ENV] = prior;
  }
}

/**
 * `RunDir.open` takes the live stores it must stay clear of. A test that names
 * none is asserting the run directory alone, which is why the empty set is
 * spelled out rather than defaulted inside the writer — a default there would
 * be the fail-open this check exists to close.
 */
const NO_STORES: LiveStores = { v1Dir: "", v2DataDir: "", engramDir: "", abDir: "" };

/**
 * The committed bars, in the shape `bars.json` must carry. Every field is
 * required — there is no default anywhere in the tool, which is the point:
 * `activeDayTurnFloor: 0` would let every lived day clear the floor, and a
 * probe floor chosen after seeing the data is not a bar (§5 G7, G15).
 */
const BARS = (activeDayTurnFloor = 3) => ({
  activeDayTurnFloor,
  crossEncodingBar: 0,
  crossEncodingMinLineChars: 12,
  crossEncodingRatioBar: 0.1,
  committedAt: "2026-09-03",
  preconditionDropDead: "2026-09-08",
});

const STORES = (f: {
  v1Dir: string;
  v2Dir: string;
  engramDir: string;
  abDir: string;
}): LiveStores => ({
  v1Dir: f.v1Dir,
  v2DataDir: f.v2Dir,
  engramDir: f.engramDir,
  abDir: f.abDir,
});

/** Every file under a tree, with its size and content hash. The G1 instrument. */
function manifest(base: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!st.isFile()) continue;
      out[relative(base, full).split(sep).join("/")] =
        `${st.size}:${createHash("sha256").update(readFileSync(full)).digest("hex")}`;
    }
  };
  if (existsSync(base)) walk(base);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// The replay gate — CONTRACT §5 precondition 1
// ═══════════════════════════════════════════════════════════════════════════

const CLEAN: GateReadableRecord = {
  runId: "replay-2026-09-04",
  readOnlyProof: true,
  totalityOk: true,
  sample: false,
  counts: { pass: 31, fail: 0, "needs-rater": 2, "not-exercised": 23, watch: 0 },
  verdicts: {},
};

/** The three WIRING_ALIVE channels, alive — the shape a live record carries. */
const WIRED: Record<string, GateEntry> = {
  "preselect.meanSchemasShown": { verdict: "pass", value: 0.54 },
  "preselect.blindRate": { verdict: "pass", value: 0.22 },
  "gate.refusalMix": { verdict: "pass", value: 0.31 },
};

function record(over: Partial<GateReadableRecord> = {}): GateReadableRecord {
  const verdicts: Record<string, GateEntry> = { ...WIRED };
  for (const id of KNOWN_NOT_EXERCISED) verdicts[id] = { verdict: "not-exercised", value: null };
  for (const id of RATER_DEFERRED) verdicts[id] = { verdict: "needs-rater", value: null };
  verdicts["gate.chunkBlockRate"] = { verdict: "pass", value: 0.1 };
  return { ...CLEAN, verdicts, ...over };
}

describe("parallelGateOpen — precondition 1, branch by branch", () => {
  test("a clean, non-sample record opens the gate with no reasons", () => {
    expect(parallelGateOpen(record())).toEqual({ open: true, reasons: [] });
  });

  test("BAND FAILURES DO NOT SHUT IT — the run re-earns v1's numbers (RULED 2026-09-03)", () => {
    // `counts.fail === 0` was the old regime's other half, and it made the
    // owner's own ruled sample route unsatisfiable. §5 G15: v1's numbers are
    // "calibration to re-earn, not inherited law". The rows and the header must
    // still AGREE — that is a record-integrity check, not a bar.
    const r = record();
    const verdicts = { ...r.verdicts, "gate.chunkBlockRate": { verdict: "fail" as const, value: 0.9 } };
    const v = parallelGateOpen({ ...r, verdicts, counts: { ...CLEAN.counts, fail: 1 } });
    expect(v).toEqual({ open: true, reasons: [] });
  });

  test("readOnlyProof false and totalityOk false each name themselves", () => {
    const v = parallelGateOpen(record({ readOnlyProof: false, totalityOk: false }));
    expect(v.open).toBe(false);
    expect(v.reasons.length).toBe(2);
    expect(v.reasons[0]).toContain("readOnlyProof");
    expect(v.reasons[1]).toContain("totalityOk");
  });

  test("a not-exercised id on NEITHER enumerated set shuts the gate, by name", () => {
    const r = record();
    const verdicts = { ...r.verdicts, "interpret.mintsPerChunk": { verdict: "not-exercised" as const, value: null } };
    const v = parallelGateOpen({ ...r, verdicts });
    expect(v.open).toBe(false);
    expect(v.reasons.join(" ")).toContain("interpret.mintsPerChunk");
    expect(v.reasons.join(" ")).toContain("not-exercised outside");
  });

  test("a needs-rater id outside RATER_DEFERRED shuts the gate, by name", () => {
    const r = record();
    const verdicts = { ...r.verdicts, "briefing.overBudgetRate": { verdict: "needs-rater" as const, value: null } };
    const v = parallelGateOpen({ ...r, verdicts });
    expect(v.open).toBe(false);
    expect(v.reasons.join(" ")).toContain("needs-rater outside RATER_DEFERRED: briefing.overBudgetRate");
  });

  // ── RULED 2026-09-03: no waiver; the wiring-alive predicate replaces it ──
  test("sample: true opens the gate on the SAME terms as a full re-run — no signature", () => {
    // The owner: "I'm not sure our intent was to require signing things to
    // change them." A sample whose channels are alive is a sample this gate
    // accepts; nothing about it is waived, because nothing about it is excused.
    expect(parallelGateOpen(record({ sample: true }))).toEqual({ open: true, reasons: [] });
  });

  test("THE OWNER'S OWN SAMPLE RECORD opens the gate — 11 band failures and all", () => {
    // `run_6530ad2ee770`, the queued `--days 7 --embed` sample read on
    // 2026-09-03 (docs/PARALLEL-RUN-STATUS.md): 15 pass / 11 fail / 2
    // needs-rater / 23 not-exercised, cards climbing to a 0.54 aggregate that
    // passes its band, a 60% blind rate that fails one, refusal mix computed.
    // This test is the ruling pinned to the record it was made for: the wiring
    // is alive, the bands are the run's to re-earn.
    const verdicts: Record<string, GateEntry> = {
      "preselect.meanSchemasShown": { verdict: "pass", value: 0.54 },
      "preselect.blindRate": { verdict: "fail", value: 0.6 },
      "gate.refusalMix": { verdict: "pass", value: 0.31 },
    };
    for (const id of KNOWN_NOT_EXERCISED) verdicts[id] = { verdict: "not-exercised", value: null };
    for (const id of RATER_DEFERRED) verdicts[id] = { verdict: "needs-rater", value: null };
    // Ten more band failures on ids that are nobody's wiring, to reach 11.
    const alsoFailing = METRICS.map((m) => m.id)
      .filter((id) => verdicts[id] === undefined)
      .slice(0, 10);
    for (const id of alsoFailing) verdicts[id] = { verdict: "fail", value: 1 };
    expect(alsoFailing.length).toBe(10);
    const sample: GateReadableRecord = {
      runId: "run_6530ad2ee770",
      readOnlyProof: true,
      totalityOk: true,
      sample: true,
      counts: { pass: 15, fail: 11, "needs-rater": 2, "not-exercised": 23, watch: 5 },
      verdicts,
    };
    expect(parallelGateOpen(sample)).toEqual({ open: true, reasons: [] });
  });

  test("a DEAD cards channel shuts it: meanSchemasShown not passing", () => {
    const r = record();
    // The first replay run's reading: `applySweep` passed no schema slice, so
    // preselection had nothing to select from and every chunk read blind. That
    // record must never open this gate, sample or not.
    const verdicts = {
      ...r.verdicts,
      "preselect.meanSchemasShown": { verdict: "fail" as const, value: 0 },
    };
    const v = parallelGateOpen({ ...r, verdicts, counts: { ...CLEAN.counts, fail: 1 } });
    expect(v.open).toBe(false);
    expect(v.reasons.join(" ")).toContain("no schema cards reached the chunk gate");
  });

  test("a blind rate of 1.0 shuts it — every chunk encoded blind is the dead wire", () => {
    const r = record();
    const verdicts = { ...r.verdicts, "preselect.blindRate": { verdict: "fail" as const, value: 1 } };
    const v = parallelGateOpen({ ...r, verdicts, counts: { ...CLEAN.counts, fail: 1 } });
    expect(v.open).toBe(false);
    expect(v.reasons.join(" ")).toContain("EVERY gated chunk encoded blind");
    // And 0.999 — a bad number on a live wire — does not: this predicate asks
    // whether the channel exists, never whether it is good (§5 G15).
    const nearly = { ...r.verdicts, "preselect.blindRate": { verdict: "fail" as const, value: 0.999 } };
    expect(parallelGateOpen({ ...r, verdicts: nearly, counts: { ...CLEAN.counts, fail: 1 } }).open).toBe(true);
  });

  test("gate.refusalMix `not-exercised` shuts it — a mix never computed is not a live gate", () => {
    const r = record();
    const verdicts = {
      ...r.verdicts,
      "gate.refusalMix": { verdict: "not-exercised" as const, value: null },
    };
    const v = parallelGateOpen({ ...r, verdicts });
    expect(v.open).toBe(false);
    expect(v.reasons.join(" ")).toContain("gate.refusalMix is not-exercised");
    // `gate.refusalMix` is not on any enumerated set, so the stray-row check
    // fires too — and BOTH reasons are named, never just the first.
    expect(v.reasons.join(" ")).toContain("not-exercised outside");
  });

  test("a wiring row that is ABSENT is refused — a row not there is not a live channel", () => {
    const r = record();
    for (const check of WIRING_ALIVE) {
      const verdicts = { ...r.verdicts };
      delete verdicts[check.id];
      const v = parallelGateOpen({ ...r, verdicts });
      expect(`${check.id}:${v.open}`).toBe(`${check.id}:false`);
      expect(v.reasons.join(" ")).toContain(`${check.id} is absent from the record's verdicts`);
    }
  });

  test("a wiring row with NO observed value is refused, never read as zero", () => {
    const r = record();
    const verdicts = { ...r.verdicts, "preselect.blindRate": { verdict: "pass" as const, value: null } };
    const v = parallelGateOpen({ ...r, verdicts });
    expect(v.open).toBe(false);
    expect(v.reasons.join(" ")).toContain("carries no observed value");
  });

  // ── review blocker 1: the three fields that used to fail OPEN ─────────────
  test("a record with `sample` OMITTED is refused — absent is not a full re-run", () => {
    const r = record();
    const { sample: _dropped, ...withoutSample } = r;
    const v = parallelGateOpen(withoutSample as GateReadableRecord);
    expect(v.open).toBe(false);
    expect(v.reasons.join(" ")).toContain("sample is absent");
  });

  test("`counts: {}` is refused — an absent failure count is not zero failures", () => {
    const v = parallelGateOpen(record({ counts: {} }));
    expect(v.open).toBe(false);
    expect(v.reasons.join(" ")).toContain("counts.fail is absent");
  });

  test("an UNKNOWN verdict string is refused, not cast into the vocabulary", () => {
    const r = record();
    const verdicts = {
      ...r.verdicts,
      "gate.chunkBlockRate": {
        verdict: "green" as unknown as GateEntry["verdict"],
        value: null,
      },
    };
    const v = parallelGateOpen({ ...r, verdicts });
    expect(v.open).toBe(false);
    expect(v.reasons.join(" ")).toContain("outside the replay vocabulary");
    expect(v.reasons.join(" ")).toContain("gate.chunkBlockRate");
  });

  test("a fail COUNT that disagrees with the fail VERDICTS shuts the gate", () => {
    const r = record();
    // The header says zero failures; a row says otherwise. Which half is wrong
    // is not for the gate to decide — it refuses to read the record at all.
    const verdicts = { ...r.verdicts, "gate.chunkBlockRate": { verdict: "fail" as const, value: 0.9 } };
    const v = parallelGateOpen({ ...r, verdicts });
    expect(v.open).toBe(false);
    expect(v.reasons.join(" ")).toContain("the summary and the rows disagree");

    // And when they AGREE the record is readable and the gate OPENS on it: the
    // failure is a band the run re-earns, not a refusal (RULED 2026-09-03). So
    // the assertion above is passing on the disagreement, not on the fail.
    const agreed = parallelGateOpen({ ...r, verdicts, counts: { ...CLEAN.counts, fail: 1 } });
    expect(agreed).toEqual({ open: true, reasons: [] });
  });
});

describe("the enumerated sets are the registry's, not a guess", () => {
  test("PARALLEL_EXERCISABLE ∪ NOT_APPLICABLE_TO_RUN is EXACTLY the registry's not-exercised rows", () => {
    const structural = METRICS.filter(
      (m) => m.grading.kind === "not-computable" || m.grading.kind === "not-comparable",
    ).map((m) => m.id);
    expect(structural.length).toBe(23);
    expect([...KNOWN_NOT_EXERCISED].sort()).toEqual([...structural].sort());
    // And the two halves are disjoint — an id cannot be both the run's charter
    // and out of scope for it.
    expect(PARALLEL_EXERCISABLE.filter((id) => NOT_APPLICABLE_TO_RUN.includes(id))).toEqual([]);
  });

  test("RATER_DEFERRED is EXACTLY the registry's rater rows", () => {
    const rater = METRICS.filter((m) => m.grading.kind === "rater").map((m) => m.id);
    expect(rater.length).toBe(2);
    expect([...RATER_DEFERRED].sort()).toEqual([...rater].sort());
  });

  test("every enumerated id actually exists in the registry", () => {
    const known = new Set(METRICS.map((m) => m.id));
    for (const id of [...KNOWN_NOT_EXERCISED, ...RATER_DEFERRED]) {
      expect(`${id}:${known.has(id)}`).toBe(`${id}:true`);
    }
  });

  /**
   * THE DEVIATION, EVIDENCED. The CONTRACT's precondition-1 sentence names two
   * sets. Read strictly — accepting ONLY `PARALLEL_EXERCISABLE` — the owner's
   * own ruled route (§5 P1, RULED 2026-09-03: the `--days 5..7` sample, judged
   * on the wiring-alive predicate) can never open the gate, because ten
   * registry rows are `not-exercised` for reasons no run can move. That is why
   * `NOT_APPLICABLE_TO_RUN` exists, under §5 G13's own word. This test is the
   * argument, so it cannot rot into prose.
   */
  test("the strict two-set reading shuts the gate on the owner's own sample route", () => {
    const r = record({ sample: true });
    // The CONTRACT's sentence, evaluated literally against the record the ruled
    // route produces: every not-exercised id ∈ PARALLEL_EXERCISABLE.
    const strictlyOpen = Object.entries(r.verdicts)
      .filter(([, v]) => v.verdict === "not-exercised")
      .every(([id]) => PARALLEL_EXERCISABLE.includes(id));
    expect(strictlyOpen).toBe(false);
    const strictlyStray = Object.entries(r.verdicts)
      .filter(([, v]) => v.verdict === "not-exercised")
      .map(([id]) => id)
      .filter((id) => !PARALLEL_EXERCISABLE.includes(id));
    expect(strictlyStray.length).toBe(10);
    expect([...strictlyStray].sort()).toEqual([...NOT_APPLICABLE_TO_RUN].sort());
    // With the third set the same record opens — which is the whole deviation.
    expect(parallelGateOpen(r).open).toBe(true);
  });
});

describe("reading the record off disk", () => {
  test("pass-record.json is the file that carries per-id verdicts", () => {
    // The shape `tools/replay/report.ts#passRecord` writes, verbatim.
    const parsed = parseGateRecord({
      runId: "r1",
      readOnlyProof: true,
      totalityOk: true,
      sample: false,
      counts: { pass: 1, fail: 0 },
      verdicts: { "gate.chunkBlockRate": { verdict: "pass", reason: null, value: 0.5 } },
    });
    expect(typeof parsed).not.toBe("string");
    expect((parsed as GateReadableRecord).verdicts["gate.chunkBlockRate"]?.verdict).toBe("pass");
  });

  test("the fail cross-check agrees with the REAL passRecord shape, not just a fixture", () => {
    // The cross-check is only safe because `report.ts#passRecord` derives BOTH
    // halves from one array: `counts` is tallied over `scoreRun`'s `results`
    // and `verdicts` is built from `scorecard.metrics`, which IS that array.
    // If they ever came from different row sets this predicate would refuse
    // every genuine replay record and the gate would be permanently shut — so
    // the invariant is asserted here rather than reasoned about in a comment.
    const verdicts: Record<string, GateEntry> = {};
    const counts: Record<string, number> = { pass: 0, fail: 0, "needs-rater": 0, "not-exercised": 0, watch: 0 };
    for (const id of KNOWN_NOT_EXERCISED) {
      verdicts[id] = { verdict: "not-exercised", value: null };
      counts["not-exercised"] = (counts["not-exercised"] ?? 0) + 1;
    }
    for (const id of RATER_DEFERRED) {
      verdicts[id] = { verdict: "needs-rater", value: null };
      counts["needs-rater"] = (counts["needs-rater"] ?? 0) + 1;
    }
    for (const m of METRICS) {
      if (verdicts[m.id] !== undefined) continue;
      // The wiring rows carry their observed numbers, because one of the three
      // checks reads a value rather than a verdict.
      verdicts[m.id] = { verdict: "pass", value: WIRED[m.id]?.value ?? null };
      counts["pass"] = (counts["pass"] ?? 0) + 1;
    }
    // Every metric in the registry is accounted for, tallied the way `scoreRun`
    // tallies — and the gate opens.
    expect(Object.keys(verdicts).length).toBe(METRICS.length);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(METRICS.length);
    expect(parallelGateOpen({ ...CLEAN, counts, verdicts })).toEqual({ open: true, reasons: [] });
    // And every WIRING_ALIVE id is a REAL registry id, so a rename of one of
    // them shows up here rather than as a gate that quietly never opens again.
    const known = new Set(METRICS.map((m) => m.id));
    for (const check of WIRING_ALIVE) expect(`${check.id}:${known.has(check.id)}`).toBe(`${check.id}:true`);
  });

  test("a record with no verdicts block is refused with a reason, never defaulted", () => {
    expect(parseGateRecord({ runId: "r1", counts: {} })).toContain("no per-metric verdicts");
    expect(parseGateRecord({ counts: {}, verdicts: {} })).toContain("no runId");
    expect(parseGateRecord("nope")).toContain("not a JSON object");
  });

  test("the OBSERVED VALUE is parsed off the record, and a non-number reads null", () => {
    // `passRecord` writes `value: m.observed === null ? null : m.observed.value`.
    // The wiring checks read that number, so a string or a missing field must
    // become `null` — a refusal — rather than being coerced into a reading.
    const parsed = parseGateRecord({
      runId: "r1",
      readOnlyProof: true,
      totalityOk: true,
      sample: true,
      counts: { fail: 0 },
      verdicts: {
        "preselect.blindRate": { verdict: "pass", value: 0.22 },
        "preselect.meanSchemasShown": { verdict: "pass", value: null },
        "gate.refusalMix": { verdict: "pass", value: "0.31" },
      },
    }) as GateReadableRecord;
    expect(parsed.verdicts["preselect.blindRate"]?.value).toBe(0.22);
    expect(parsed.verdicts["preselect.meanSchemasShown"]?.value).toBeNull();
    expect(parsed.verdicts["gate.refusalMix"]?.value).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The assignment file — §5 G3
// ═══════════════════════════════════════════════════════════════════════════

describe("assignment health, read through primacy.ts in a named environment", () => {
  function assign(abDir: string, value: unknown): void {
    writeJson(join(abDir, "assignment.json"), value);
  }

  test("override `engram` and `bansai` are the only healthy readings", () => {
    const ab = dir("ab");
    for (const override of ["engram", "bansai"]) {
      assign(ab, { mode: "alternate-day", anchor: "2026-07-17", override });
      const r = readAssignmentAs({ name: "v1-hooks", abDir: ab });
      expect({ override, healthy: r.health.healthy }).toEqual({ override, healthy: true });
    }
    for (const override of [null, "none", "counterparts"]) {
      assign(ab, { mode: "alternate-day", override });
      const r = readAssignmentAs({ name: "v1-hooks", abDir: ab });
      expect({ override, healthy: r.health.healthy }).toEqual({ override, healthy: false });
    }
  });

  test("mode rides along ADVISORY and never decides health", () => {
    const ab = dir("ab");
    assign(ab, { mode: "alternate-day", override: "engram" });
    const r = readAssignmentAs({ name: "v1-hooks", abDir: ab });
    expect(r.health.healthy).toBe(true);
    expect(r.health.mode).toBe("alternate-day");
  });

  test("reading as an environment RESTORES the process environment afterwards", () => {
    const ab = dir("ab");
    assign(ab, { override: "engram" });
    delete process.env[AB_DIR_ENV];
    readAssignmentAs({ name: "v1-hooks", abDir: ab });
    expect(process.env[AB_DIR_ENV]).toBeUndefined();
    process.env[AB_DIR_ENV] = "/sentinel";
    readAssignmentAs({ name: "v1-hooks", abDir: ab });
    expect(process.env[AB_DIR_ENV]).toBe("/sentinel");
  });

  test("a missing file is a named refusal, not a default", () => {
    const r = readAssignmentAs({ name: "v1-hooks", abDir: join(root, "nowhere") });
    expect(r.health.healthy).toBe(false);
    expect(r.health.reason).toBe("file-missing");
    expect(r.realpath).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Data-dir disjointness — §5 G6, scar §2.13
// ═══════════════════════════════════════════════════════════════════════════

describe("realpath disjointness", () => {
  test("three sibling directories are disjoint", () => {
    const [a, b, c] = [dir("v1"), dir("v2"), dir("engram")];
    expect(overlaps(realpathOr(a), realpathOr(b))).toBe(false);
    expect(overlaps(realpathOr(b), realpathOr(c))).toBe(false);
  });

  test("a NESTED directory is caught in both directions", () => {
    const parent = dir("outer");
    const child = dir("outer", "inner");
    expect(overlaps(realpathOr(parent), realpathOr(child))).toBe(true);
    expect(overlaps(realpathOr(child), realpathOr(parent))).toBe(true);
  });

  test("a SYMLINK pointing at the other store is caught — realpath, not spelling", () => {
    const real = dir("real-store");
    const link = join(root, "link-store");
    symlinkSync(real, link);
    // Lexically different, the same directory. This is the scar §2.13 case.
    expect(real).not.toBe(link);
    expect(overlaps(realpathOr(real), realpathOr(link))).toBe(true);
  });

  test("a path that does not exist yet still compares in the SAME spelling of the filesystem", () => {
    // On macOS the temp root is /var/folders -> /private/var/folders. An
    // existing store realpaths to one spelling while a not-yet-created child
    // keeps the other, and the nested pair would read as DISJOINT. This is the
    // case that would have let a typo'd nested data dir through the gate.
    const existing = dir("v1");
    const ghost = join(existing, "nested-v2");
    expect(existsSync(ghost)).toBe(false);
    expect(realpathOr(ghost).startsWith(realpathOr(existing))).toBe(true);
    expect(overlaps(realpathOr(existing), realpathOr(ghost))).toBe(true);
    // And a wholly nonexistent tree still compares against itself.
    const nowhere = join(root, "does-not-exist");
    expect(overlaps(realpathOr(nowhere), realpathOr(join(nowhere, "inner")))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The transcript canary — §5 G6, G8
// ═══════════════════════════════════════════════════════════════════════════

describe("the transcript canary", () => {
  function transcript(name: string, entries: readonly unknown[]): string {
    const path = at("transcripts", name);
    writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
    return path;
  }

  test("a WAKE/RECALL marker in a CONVERSATION block is a hit, addressed not quoted", () => {
    const file = transcript("hit.jsonl", [
      { message: { role: "user", content: "What did we decide about the buffer?" } },
      { message: { role: "user", content: "<bansai-memory>three memories bear on this turn.</bansai-memory>" } },
    ]);
    const scan = scanTranscripts([file]);
    expect(scan.conversationHits.length).toBe(1);
    expect(scan.conversationHits[0]?.role).toBe("user");
    expect(scan.conversationHits[0]?.marker).toBe(2);
    // Content-by-reference: the hit carries no text (scar §2.20).
    expect(JSON.stringify(scan.conversationHits)).not.toContain("bansai-memory");
  });

  // ── review blocker 6: the episode ask is the DESIGN, not a breach ─────────
  test("v1's EPISODE ASK in a user-role block is the design working, not a red-line", () => {
    // §5 G8: "the one channel that DOES land as a user-role message — v1's
    // episode ask, `Stop hook feedback:` + `[bansai] …` — is the `foreign`
    // case." Red-lining it would have halted the run on day 1 for the mechanism
    // doing exactly what it was built to do.
    const file = transcript("ask.jsonl", [
      { message: { role: "user", content: "Stop hook feedback:\n- [bansai] what did you learn?" } },
      { message: { role: "user", content: "[bansai] one more, in the bare shape." } },
    ]);
    const scan = scanTranscripts([file]);
    expect(scan.conversationHits).toEqual([]);
    expect(scan.byDesignHits.length).toBe(2);
    expect(scan.byDesignHits.map((h) => h.marker).sort()).toEqual([0, 1]);
    // The guarantee those hits buy: `transcript.ts` calls the text `foreign`,
    // which is what makes `remember/`'s `enters()` refuse it.
    expect(scan.recognizerDrift).toEqual([]);
    expect(scan.markersSeen).toBe(2);
  });

  test("an entry with NO message role is a host-carried attachment, reported separately", () => {
    const file = transcript("attach.jsonl", [
      { type: "attachment", content: "<bansai-memory>\nthe standing bundle\n</bansai-memory>" },
      { message: { role: "user", content: "ordinary conversation" } },
    ]);
    const scan = scanTranscripts([file]);
    expect(scan.conversationHits).toEqual([]);
    expect(scan.attachmentHits).toBe(1);
  });

  test("a tool_result carrying a foreign marker is EXCLUDED from conversation hits", () => {
    const file = transcript("tool.jsonl", [
      {
        message: {
          role: "user",
          content: [
            { type: "tool_result", text: "[bansai] recall: pasted into a tool result" },
            { type: "text", text: "the user's actual question" },
          ],
        },
      },
    ]);
    const scan = scanTranscripts([file]);
    expect(scan.conversationHits).toEqual([]);
    expect(scan.attachmentHits).toBe(1);
  });

  test("every FOREIGN_MARKER shape is recognised, and graded by its CLASS", () => {
    const file = transcript("all.jsonl", [
      { message: { role: "user", content: "Stop hook feedback:\n- [bansai] what did you learn?" } },
      { message: { role: "user", content: "[bansai] recall: one memory." } },
      { message: { role: "assistant", content: "<bansai-memory>bundle</bansai-memory>" } },
      { message: { role: "user", content: "The following is your standing self-model (bansai), as of today." } },
      { message: { role: "user", content: "bansai: your persistent memory is initializing." } },
    ]);
    const all = scanTranscripts([file]);
    // 0–1 are the episode ask (by design); 2–4 are wake/recall (the red-line).
    expect(all.byDesignHits.map((h) => h.marker)).toEqual([0, 1]);
    expect(all.conversationHits.map((h) => h.marker)).toEqual([2, 3, 4]);
    expect(all.markersSeen).toBe(5);

    const clean = transcript("clean.jsonl", [
      { message: { role: "user", content: "Nothing foreign here at all." } },
      { message: { role: "assistant", content: "Agreed — clean." } },
    ]);
    const scan = scanTranscripts([clean]);
    expect(scan.conversationHits).toEqual([]);
    expect(scan.attachmentHits).toBe(0);
    expect(scan.entries).toBe(2);
    // Clean traffic scores zero — and `markersSeen: 0` is what the preflight
    // reads as `not-exercised`, because it cannot tell clean from empty.
    expect(scan.markersSeen).toBe(0);
  });

  test("unparseable lines are counted, never swallowed", () => {
    const path = at("transcripts", "corrupt.jsonl");
    writeFileSync(path, `{"message":{"role":"user","content":"fine"}}\nnot json\n`, "utf8");
    expect(scanTranscripts([path]).corrupt).toBe(1);
  });

  test("a directory of transcripts is walked, a single file is taken as itself", () => {
    transcript("a.jsonl", [{ message: { role: "user", content: "one" } }]);
    transcript("b.jsonl", [{ message: { role: "user", content: "two" } }]);
    writeFileSync(at("transcripts", "ignored.txt"), "not a transcript", "utf8");
    expect(transcriptFiles(join(root, "transcripts")).length).toBe(2);
    expect(transcriptFiles(join(root, "transcripts", "a.jsonl")).length).toBe(1);
    expect(transcriptFiles(join(root, "nope"))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The host's hook execution model — scar §2.18
// ═══════════════════════════════════════════════════════════════════════════

describe("hook execution model, measured", () => {
  const rec = (
    hookEvent: string,
    hookName: string,
    at: number,
    durationMs: number,
    session = "session-a.jsonl",
  ) => ({ session, hookEvent, hookName, at, durationMs });

  test("OVERLAPPING windows for the same event read PARALLEL", () => {
    // Two hooks, both finishing near t=1000, each 400ms long: they were running
    // at the same time, so two per-turn races do NOT stack.
    const report = hookModel([
      rec("SessionStart", "bansai", 1_000, 400),
      rec("SessionStart", "counterparts", 1_050, 400),
    ]);
    expect(report.model).toBe("parallel");
    expect(report.overlaps).toBe(1);
  });

  test("BACK-TO-BACK windows read SEQUENTIAL — the case that stacks the races", () => {
    const report = hookModel([
      rec("SessionStart", "bansai", 1_000, 400),
      rec("SessionStart", "counterparts", 1_500, 400),
    ]);
    expect(report.model).toBe("sequential");
    expect(report.overlaps).toBe(0);
  });

  test("one hook alone is UNKNOWN, not sequential — absence of evidence is named", () => {
    expect(hookModel([rec("SessionStart", "bansai", 1_000, 400)]).model).toBe("unknown");
    expect(hookModel([]).model).toBe("unknown");
  });

  test("per-hook durations report min, median and max", () => {
    const report = hookModel([
      rec("Stop", "counterparts", 1_000, 100),
      rec("Stop", "counterparts", 2_000, 300),
      rec("Stop", "counterparts", 3_000, 200),
      rec("Stop", "bansai", 3_100, 50),
    ]);
    const cp = report.perHook.find((p) => p.hookName === "counterparts");
    expect({ min: cp?.minMs, median: cp?.medianMs, max: cp?.maxMs, n: cp?.count }).toEqual({
      min: 100,
      median: 200,
      max: 300,
      n: 3,
    });
  });

  test("the SessionEnd budget is SHARED: sequential hooks sum, parallel hooks take the max", () => {
    // Sequential: 900 + 800 = 1700ms against the host's 1500ms — OVER.
    const seq = hookModel([
      rec("SessionEnd", "bansai", 1_000, 900),
      rec("SessionEnd", "counterparts", 1_900, 800),
    ]);
    expect(seq.model).toBe("sequential");
    expect(seq.sessionEndBudgetMs).toBe(1_500);
    expect(seq.sessionEndWorstMs).toBe(1_700);
    expect(seq.sessionEndOk).toBe(false);

    // The same two hooks run concurrently cost 900ms — inside the budget.
    const par = hookModel([
      rec("SessionEnd", "bansai", 1_000, 900),
      rec("SessionEnd", "counterparts", 1_050, 800),
    ]);
    expect(par.model).toBe("parallel");
    expect(par.sessionEndWorstMs).toBe(900);
    expect(par.sessionEndOk).toBe(true);
  });

  // ── review should-fix: the model and the budget are PER SESSION ──────────
  test("hooks in DIFFERENT sessions cannot have raced — no overlap is manufactured", () => {
    // Identical windows, two different transcripts. Pooled, these read as one
    // overlapping pair and the host was declared `parallel` on a coincidence.
    const report = hookModel([
      rec("SessionStart", "bansai", 1_000, 400, "session-a.jsonl"),
      rec("SessionStart", "counterparts", 1_050, 400, "session-b.jsonl"),
    ]);
    expect(report.overlaps).toBe(0);
    // And with no contested event inside ANY one session, there is no
    // measurement at all — which is `unknown`, not `sequential`.
    expect(report.model).toBe("unknown");

    // The same two records inside ONE session still read parallel, so the
    // grouping is not simply suppressing every overlap.
    expect(
      hookModel([
        rec("SessionStart", "bansai", 1_000, 400, "one.jsonl"),
        rec("SessionStart", "counterparts", 1_050, 400, "one.jsonl"),
      ]).model,
    ).toBe("parallel");
  });

  test("the SessionEnd budget is the WORST SESSION's, not the whole corpus summed", () => {
    // Three sessions, 900ms each. Summed across the corpus that is 2700ms and
    // reads OVER a 1500ms budget that no single session ever had to meet.
    const report = hookModel([
      rec("SessionEnd", "bansai", 1_000, 900, "a.jsonl"),
      rec("SessionEnd", "counterparts", 1_900, 400, "a.jsonl"),
      rec("SessionEnd", "bansai", 1_000, 900, "b.jsonl"),
      rec("SessionEnd", "bansai", 1_000, 900, "c.jsonl"),
    ]);
    expect(report.sessionEndSessions).toBe(3);
    // Session a: 900 + 400 = 1300 sequential. b and c: 900 each.
    expect(report.sessionEndWorstMs).toBe(1_300);
    expect(report.worstSession).toBe("a.jsonl");
    expect(report.sessionEndOk).toBe(true);
  });

  test("`Stop` is NOT SessionEnd — a different event with a different budget", () => {
    // Stop fires at every turn end; folding it into SessionEnd's shared budget
    // measured a cost no single budget has to cover.
    const report = hookModel([
      rec("Stop", "bansai", 1_000, 1_400, "a.jsonl"),
      rec("Stop", "counterparts", 2_500, 1_400, "a.jsonl"),
    ]);
    expect(report.sessionEndWorstMs).toBeNull();
    expect(report.sessionEndOk).toBeNull();
    expect(report.sessionEndSessions).toBe(0);
  });

  test("hook_success attachments in a real transcript feed the model", () => {
    const path = at("transcripts", "hooks.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({
          type: "attachment",
          timestamp: "2026-09-04T09:00:01.000Z",
          attachment: { type: "hook_success", hookEvent: "SessionStart", hookName: "bansai", durationMs: 400 },
        }),
        JSON.stringify({
          type: "attachment",
          timestamp: "2026-09-04T09:00:01.050Z",
          attachment: { type: "hook_success", hookEvent: "SessionStart", hookName: "counterparts", durationMs: 400 },
        }),
      ].join("\n"),
      "utf8",
    );
    const scan = scanTranscripts([path]);
    expect(scan.hooks.records).toBe(2);
    expect(scan.hooks.model).toBe("parallel");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The v1 and v2 readers
// ═══════════════════════════════════════════════════════════════════════════

describe("the v1 log reader", () => {
  test("counts by type, splits ab.muted by hook, and is tolerant of malformed lines", () => {
    const v1 = dir("v1");
    const path = join(v1, "logs", "events-2026-09-04.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      [
        JSON.stringify({ ts: "2026-09-04T09:00:00.000Z", seq: 0, session: "s1", type: "ab.muted", hook: "session_start" }),
        JSON.stringify({ ts: "2026-09-04T09:01:00.000Z", seq: 1, session: "s1", type: "ab.muted", hook: "user_prompt_submit" }),
        "{ not json",
        JSON.stringify({ ts: "2026-09-04T09:02:00.000Z", seq: 2, session: null, type: "store.write" }),
        JSON.stringify({ ts: "2026-09-04T09:03:00.000Z", seq: 3 }),
      ].join("\n"),
      "utf8",
    );
    const day = readV1Day(v1, "2026-09-04");
    expect(day.present).toBe(true);
    expect(day.malformed).toBe(2);
    expect(day.abMutedByHook).toEqual({ session_start: 1, user_prompt_submit: 1 });
    expect(day.byType["store.write"]).toBe(1);
    expect(day.mutedAtSessionStart).toEqual(["s1"]);
  });

  test("an absent day is `present: false`, never an empty day that looks lived", () => {
    expect(readV1Day(dir("v1"), "2026-01-01").present).toBe(false);
  });

  test("a surface.decision only counts as recall INJECTION at phase inject", () => {
    const v1 = dir("v1");
    v1Log(v1, "2026-09-04", [
      { type: "surface.decision", session: "s1", phase: "consider" },
      { type: "surface.decision", session: "s1", phase: "inject" },
    ]);
    const day = readV1Day(v1, "2026-09-04");
    expect(day.byType["surface.decision"]).toBe(2);
    expect(day.surfaceInject).toBe(1);
  });
});

describe("the v2 store reader", () => {
  test("opens READ-ONLY and proves it: the write probe is refused", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      s.put({ type: "memory", kind: "fact", body: "A synthetic fixture memory." });
    });
    const day = readV2Day(data, "2026-09-04");
    expect(day.present).toBe(true);
    expect(day.readOnlyProof).toBe(true);
  });

  test("adapter events are attributed by their PAYLOAD date, not by the lived-day column", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      for (const hook of ["session-start", "user-prompt-submit", "stop"]) {
        s.appendEvent({
          name: PRIMACY_STANDDOWN_EVENT,
          day: 0,
          payload: { hook, reason: "override-bansai", system: "v1", date: "2026-09-04" },
        });
      }
      s.appendEvent({
        name: PRIMACY_DELIVER_EVENT,
        day: 0,
        payload: { hook: "session-start", reason: "override-engram", system: "v2", date: "2026-09-05" },
      });
    });
    const day = readV2Day(data, "2026-09-04");
    expect(day.primacyByHook.standdown).toEqual({
      "session-start": 1,
      "user-prompt-submit": 1,
      stop: 1,
    });
    // The 09-05 row belongs to another day even though its `day` column is 0.
    expect(day.primacyByHook.deliver).toEqual({});
    expect(readV2Day(data, "2026-09-05").primacyByHook.deliver).toEqual({ "session-start": 1 });
  });

  test("detectors box 2 CANNOT carry are named, never reported as zero — and the four delivery records now CAN", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      s.put({ type: "memory", kind: "fact", body: "A synthetic fixture memory." });
      // The four delivery records became durable on 2026-09-03 (adapter G4/G2):
      // each carries the calendar date and the session in its payload.
      s.appendEvent({
        name: "adapter.wake.injected",
        day: 0,
        payload: { ok: true, reason: "ok", bytes: 1200, budget: 9000, sentinel: true, date: "2026-09-04", session: "s1" },
      });
      s.appendEvent({
        name: "adapter.recall",
        day: 0,
        payload: { reason: "ok", surfaced: 2, footnotes: 1, bytes: 800, budget: 9000, observer: false, date: "2026-09-05", session: "s1" },
      });
    });
    const day = readV2Day(data, "2026-09-04");
    // Recomputed read-only, not rows: named, never a zero.
    expect(day.nonDurable).toContain("self.schema.tripped");
    expect(day.nonDurable).toContain("sleep.symmetry");
    expect(day.nonDurable).not.toContain("adapter.wake.injected");
    expect(day.nonDurable).not.toContain("adapter.recall");
    // Counted by the payload's date, like the primacy pair.
    expect(day.byNameForDate["adapter.wake.injected"]).toBe(1);
    expect(day.byNameForDate["adapter.recall"]).toBeUndefined();
    expect(readV2Day(data, "2026-09-05").byNameForDate["adapter.recall"]).toBe(1);
  });

  test("memory rows count by kind and by MINT SOURCE, with the day's creations split out", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      s.put({ type: "memory", kind: "fact", body: "old fact", source: "migrated", learnedOn: "2026-08-01" });
      s.put({ type: "memory", kind: "fact", body: "new fact", source: "authored", learnedOn: "2026-09-04" });
      s.put({ type: "memory", kind: "person", body: "swept row", source: "fallback", learnedOn: "2026-09-04" });
    });
    const day = readV2Day(data, "2026-09-04");
    expect(day.memories.total).toBe(3);
    expect(day.memories.bySource).toEqual({ migrated: 1, authored: 1, fallback: 1 });
    expect(day.memories.createdOnDate).toBe(2);
    expect(day.memories.createdByKind).toEqual({ fact: 1, person: 1 });
    expect(day.memories.createdBySource).toEqual({ authored: 1, fallback: 1 });
  });

  // ── the U9 rows and the reason splits (G47(a)) ───────────────────────────
  test("sleep.cycle and self.briefing rows are counted by their payload DATE", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      s.appendEvent({
        name: "sleep.cycle",
        day: 7,
        payload: { reason: "ran", date: "2026-09-14", day: 7, phases: [], failed: 0 },
      });
      s.appendEvent({
        name: "sleep.cycle",
        day: 8,
        payload: { reason: "ran", date: "2026-09-15", day: 8, phases: [], failed: 0 },
      });
      s.appendEvent({
        name: "self.briefing",
        day: 7,
        payload: { reason: "rendered", date: "2026-09-14", day: 7, bytes: 800, trimmedTotal: 2 },
      });
    });
    const day = readV2Day(data, "2026-09-14");
    expect(day.byNameForDate["sleep.cycle"]).toBe(1);
    expect(day.byNameForDate["self.briefing"]).toBe(1);
    expect(readV2Day(data, "2026-09-15").byNameForDate["sleep.cycle"]).toBe(1);
    expect(readV2Day(data, "2026-09-15").byNameForDate["self.briefing"]).toBeUndefined();
  });

  /**
   * WHICH CODE RAN THAT DAY. The hooks are invoked by absolute path, so the
   * install tree's working state is the code that produced every other number on
   * the day record — and that tree has both sat on a peer session's unmerged
   * branch and, after a merge, stayed at the old sha for half an hour. Every
   * reason but `master` lands in the one split an operator scans for.
   */
  test("adapter.checkout:off-master counts every reason but master, and the total counts them all", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      for (const reason of ["master", "behind", "branch", "dirty"]) {
        s.appendEvent({
          name: "adapter.checkout",
          day: 7,
          payload: { reason, branch: "x", head: `sha${reason}`, dirty: 0, date: "2026-09-14" },
        });
      }
      s.appendEvent({
        name: "adapter.checkout",
        day: 8,
        payload: { reason: "master", branch: "master", head: "abc", dirty: 0, date: "2026-09-15" },
      });
    });
    const day = readV2Day(data, "2026-09-14");
    expect(day.byNameForDate["adapter.checkout"]).toBe(4);
    expect(day.byNameForDate["adapter.checkout:off-master"]).toBe(3);
    // A day that never left origin/master contributes no split at all.
    expect(readV2Day(data, "2026-09-15").byNameForDate["adapter.checkout:off-master"]).toBeUndefined();
  });

  test("sweep.gate:no-credential counts ONLY the keyless runs, and the total still counts them all", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      for (const reason of ["ran", "no-credential", "no-credential"]) {
        s.appendEvent({
          name: "sweep.gate",
          day: 7,
          payload: { reason, scopes: 0, ran: 0, date: "2026-09-14" },
        });
      }
      // A different day's keyless run must not leak into this one's split.
      s.appendEvent({
        name: "sweep.gate",
        day: 8,
        payload: { reason: "no-credential", scopes: 0, ran: 0, date: "2026-09-15" },
      });
    });
    const day = readV2Day(data, "2026-09-14");
    expect(day.byNameForDate["sweep.gate"]).toBe(3);
    expect(day.byNameForDate["sweep.gate:no-credential"]).toBe(2);
    // I32's whole point: a day of nothing but keyless runs is DISTINGUISHABLE
    // from a day of healthy quiet sweeps, in the numbers the daily prints.
    expect(readV2Day(data, "2026-09-15").byNameForDate["sweep.gate:no-credential"]).toBe(1);
    // A SPLIT COUNTS ROWS THE TOTAL ALREADY COUNTS, so anything summing the map
    // has to skip the ":" keys or it counts those rows twice. Three rows landed
    // on this date, and three is what a row count must read.
    const rows = Object.entries(day.byNameForDate)
      .filter(([name]) => !name.includes(":"))
      .reduce((n, [, x]) => n + x, 0);
    expect(rows).toBe(3);
    expect(Object.values(day.byNameForDate).reduce((n, x) => n + x, 0)).toBe(5);
  });

  test("sweep.gate:refused splits on the REASON MAP, and a pre-G48 row raises nothing", () => {
    const data = dir("v2");
    const quiet = { NO_CRASHED_SESSION: 5, NOTHING_TO_SWEEP: 2, NOTHING_UNCLAIMED: 0, BELOW_MIN_CLAIM: 0, IO_FAILED: 0, OBSERVER: 0, SWEPT: 0 };
    buildStore(data, (s) => {
      // An ordinary day: seven scopes refused, every one of them quiet. The
      // reading G48 replaced — `otherRefusals` — would have read 2 here and
      // called it a bad day.
      s.appendEvent({
        name: "sweep.gate",
        day: 7,
        payload: { reason: "ran", scopes: 7, ran: 0, otherRefusals: 2, refusals: quiet, date: "2026-09-14" },
      });
      // One scope whose claim the filesystem refused: never a normal day, not
      // even once, so this is the row that raises the split.
      s.appendEvent({
        name: "sweep.gate",
        day: 7,
        payload: {
          reason: "ran",
          scopes: 7,
          ran: 0,
          otherRefusals: 3,
          refusals: { ...quiet, NOTHING_TO_SWEEP: 1, IO_FAILED: 1 },
          date: "2026-09-14",
        },
      });
      // And one whose buffer never reaches its minimum. It raises NOTHING here:
      // the leftover is restored and the crashed session is never forgotten, so
      // the refusal repeats for good, and a day counter that took it would read
      // "refused" every day forever — the false signal G48 was filed about,
      // wearing a new name. `chronicCandidates` on the row is where it lives.
      s.appendEvent({
        name: "sweep.gate",
        day: 7,
        payload: {
          reason: "ran",
          scopes: 7,
          ran: 0,
          otherRefusals: 3,
          chronicCandidates: 1,
          refusals: { ...quiet, NOTHING_TO_SWEEP: 1, BELOW_MIN_CLAIM: 1 },
          date: "2026-09-14",
        },
      });
      // A row written BEFORE the map existed. Its `otherRefusals` cannot tell a
      // stuck buffer from a retired crashed session, so it contributes nothing:
      // counting it would rebuild exactly the false signal G48 was filed about.
      s.appendEvent({
        name: "sweep.gate",
        day: 7,
        payload: { reason: "ran", scopes: 7, ran: 0, otherRefusals: 6, date: "2026-09-14" },
      });
    });

    const day = readV2Day(data, "2026-09-14");
    expect(day.byNameForDate["sweep.gate"]).toBe(4);
    // ONE of the four: the IO_FAILED row. Not the quiet one, not the
    // BELOW_MIN_CLAIM one, and not the pre-G48 one.
    expect(day.byNameForDate["sweep.gate:refused"]).toBe(1);
    // Beside the total, never instead of it: the row count still reads 4.
    const rows = Object.entries(day.byNameForDate)
      .filter(([name]) => !name.includes(":"))
      .reduce((n, [, x]) => n + x, 0);
    expect(rows).toBe(4);
  });

  test("sleep.cycle:failed splits on the COUNT, not the reason — a degraded cycle still reads `ran`", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      s.appendEvent({
        name: "sleep.cycle",
        day: 7,
        payload: { reason: "ran", date: "2026-09-14", day: 7, failed: 0, phases: [] },
      });
      s.appendEvent({
        name: "sleep.cycle",
        day: 7,
        payload: {
          reason: "ran",
          date: "2026-09-14",
          day: 7,
          failed: 2,
          phases: [{ phase: "dedup", status: "failed", reason: "failed", code: "BOOM" }],
        },
      });
    });
    const day = readV2Day(data, "2026-09-14");
    expect(day.byNameForDate["sleep.cycle"]).toBe(2);
    expect(day.byNameForDate["sleep.cycle:failed"]).toBe(1);
  });

  test("sleep.cycle:failed also counts the cycles that THREW and the ones whose clock would not advance", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      // A cycle that died: `failed` is the count among the phases it finished,
      // which can be 0 — and a bad night that reads as no bad night at all is
      // exactly what this split exists to prevent.
      s.appendEvent({
        name: "sleep.cycle",
        day: 7,
        payload: { reason: "threw", code: "DISK_FULL", date: "2026-09-14", day: 7, failed: 0, promoted: null, phases: [] },
      });
      s.appendEvent({
        name: "sleep.cycle",
        day: 7,
        payload: { reason: "clock-failed", code: "CLOCK_TORN", date: "2026-09-14", day: 7, failed: 1, phases: [] },
      });
      s.appendEvent({
        name: "sleep.cycle",
        day: 7,
        payload: { reason: "ran", date: "2026-09-14", day: 7, failed: 0, phases: [] },
      });
    });
    const day = readV2Day(data, "2026-09-14");
    expect(day.byNameForDate["sleep.cycle"]).toBe(3);
    expect(day.byNameForDate["sleep.cycle:failed"]).toBe(2);
  });

  test("recall.credit splits by reason — credited, failed and budget-exceeded, beside the total", () => {
    const data = dir("v2");
    const row = (reason: string, n: number): void => {
      buildStore(data, (s) => {
        for (let i = 0; i < n; i += 1) {
          s.appendEvent({
            name: "recall.credit",
            day: 7,
            payload: {
              reason,
              date: "2026-09-14",
              day: 7,
              session: `s${i}`,
              considered: 3,
              credited: reason === "credited" ? 1 : 0,
              ids: [],
              idsTotal: 0,
            },
          });
        }
      });
    };
    row("credited", 2);
    row("nothing-to-credit", 3);
    row("failed", 1);
    row("budget-exceeded", 1);

    const day = readV2Day(data, "2026-09-14");
    expect(day.byNameForDate["recall.credit"]).toBe(7);
    expect(day.byNameForDate["recall.credit:credited"]).toBe(2);
    expect(day.byNameForDate["recall.credit:failed"]).toBe(1);
    expect(day.byNameForDate["recall.credit:budget-exceeded"]).toBe(1);
    // An ordinary quiet reason gets no key of its own: it lives in the total.
    expect(day.byNameForDate["recall.credit:nothing-to-credit"]).toBeUndefined();
  });

  // ── `memory.reinforced`: the first watch that can go red (U10) ───────────
  //
  // Three fixture stores, read through `readV2Day` and graded through the
  // watch's own rule, so the test exercises the reader and the grader together
  // rather than hand-building a `postLaunch` reading the reader might not
  // produce.
  describe("the memory.reinforced watch", () => {
    /** Walk the store's clock forward `days` lived days and return the last. */
    function ageBy(s: Store, days: number): number {
      let day = s.livedDay();
      for (let i = 1; i <= days; i += 1) {
        day = s.advanceClock(`2026-09-${String(10 + i).padStart(2, "0")}`);
      }
      return day;
    }

    test("PASS when a post-launch row carries reinforced_days >= 1", () => {
      const data = dir("v2");
      let day = 0;
      buildStore(data, (s) => {
        const id = s.put({ type: "memory", kind: "fact", body: "A row this store minted itself.", source: "authored" });
        day = ageBy(s, PHYSICS.N_PROMOTION_DAYS + 1);
        expect(s.reinforce(id, day).credited).toBe(true);
      });
      const post = readV2Day(data, "2026-09-14").memories.postLaunch;
      expect(post.rows).toBe(1);
      expect(post.reinforced).toBe(1);
      const w = gradeReinforced(post, day);
      expect(w.value).toBe("pass");
      expect(w.reason).toContain("reinforced_days");
    });

    test("FAIL when post-launch rows are old enough to have been reinforced and none has been", () => {
      const data = dir("v2");
      let day = 0;
      buildStore(data, (s) => {
        s.put({ type: "memory", kind: "fact", body: "One this store minted and never used.", source: "authored" });
        s.put({ type: "memory", kind: "fact", body: "A swept one, equally untouched.", source: "fallback" });
        // Imported rows are NOT post-launch, however reinforced they are.
        s.put({ type: "memory", kind: "fact", body: "An imported row from v1.", source: "migrated" });
        day = ageBy(s, PHYSICS.N_PROMOTION_DAYS + 1);
      });
      const post = readV2Day(data, "2026-09-14").memories.postLaunch;
      expect(post.rows).toBe(2);
      expect(post.reinforced).toBe(0);
      const w = gradeReinforced(post, day);
      expect(w.value).toBe("fail");
      // The reason names the counts and points at the entry that opened it.
      expect(w.reason).toContain("2 post-launch rows");
      expect(w.reason).toContain("IMPROVEMENTS U10");
    });

    test("NOT-EXERCISED when the oldest post-launch row is younger than N_PROMOTION_DAYS", () => {
      const data = dir("v2");
      let day = 0;
      buildStore(data, (s) => {
        s.put({ type: "memory", kind: "fact", body: "Minted this morning, and nothing has had a chance.", source: "authored" });
        day = ageBy(s, PHYSICS.N_PROMOTION_DAYS - 1);
      });
      const post = readV2Day(data, "2026-09-14").memories.postLaunch;
      expect(post.rows).toBe(1);
      const w = gradeReinforced(post, day);
      expect(w.value).toBe("not-exercised");
      expect(w.reason).toContain("N_PROMOTION_DAYS");
    });

    test("NOT-EXERCISED when nothing post-launch exists at all — a migrated-only store", () => {
      const data = dir("v2");
      buildStore(data, (s) => {
        s.put({ type: "memory", kind: "fact", body: "Everything here came from v1.", source: "migrated" });
      });
      const post = readV2Day(data, "2026-09-14").memories.postLaunch;
      expect(post.rows).toBe(0);
      expect(gradeReinforced(post, 9).value).toBe("not-exercised");
    });

    test("the AGE test reads the OLDEST post-launch row, not the newest — a store that mints daily must still be gradeable", () => {
      const data = dir("v2");
      let day = 0;
      buildStore(data, (s) => {
        s.put({ type: "memory", kind: "fact", body: "An old untouched row this store minted.", source: "authored" });
        day = ageBy(s, PHYSICS.N_PROMOTION_DAYS + 2);
        // Today's mint. On a newest-row rule this single row would hold the
        // watch at not-exercised forever, on every live store, every day.
        s.put({ type: "memory", kind: "fact", body: "And one minted today.", source: "authored" });
      });
      const post = readV2Day(data, "2026-09-14").memories.postLaunch;
      expect(post.newestBirthDay).toBe(day);
      expect(post.oldestBirthDay).toBeLessThan(day);
      expect(gradeReinforced(post, day).value).toBe("fail");
    });

    test("the predicate the reading counted travels WITH the reading", () => {
      const data = dir("v2");
      buildStore(data, (s) => {
        s.put({ type: "memory", kind: "fact", body: "A row.", source: "authored" });
      });
      const post = readV2Day(data, "2026-09-14").memories.postLaunch;
      expect(post.predicate).toContain("migrated");
      expect(post.predicate).toContain("archived = 0");
    });
  });

  test("an absent store reads absent — never a store that happens to be empty", () => {
    const day = readV2Day(join(root, "no-such-store"), "2026-09-04");
    expect(day.present).toBe(false);
    expect(day.memories.total).toBe(0);
    // NOT `true`. Nothing was opened, so nothing was proved (review blocker 2).
    expect(day.readOnlyProof).toBeNull();
  });

  // ── review blocker 2: the write probe, and what it must never leave ────────
  test("a WRITABLE handle makes the probe report NOT refused, and leaves no table behind", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      s.put({ type: "memory", kind: "fact", body: "A synthetic fixture memory." });
    });
    const path = join(data, "operational.sqlite");
    const before = createHash("sha256").update(readFileSync(path)).digest("hex");

    const writable = new Database(path);
    const schemaOf = (db: Database): string[] =>
      (db.prepare("SELECT name FROM sqlite_master ORDER BY name").all() as { name: string }[]).map(
        (r) => r.name,
      );
    const schemaBefore = schemaOf(writable);
    const verdict = probeReadOnly(writable);
    // The probe DID write — that is the point: a handle that accepts one is not
    // read-only, whatever flag it was opened with.
    expect(verdict.verdict).toBe("writable");
    expect(verdict.verdict).not.toBe("refused");
    // And it rolled back: the schema is exactly what it was, probe table absent.
    expect(schemaOf(writable)).toEqual(schemaBefore);
    expect(schemaOf(writable).some((n) => n.includes("__parallel_probe"))).toBe(false);
    writable.close();
    expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(before);

    // The ordinary read-only handle reaches the other verdict, so the assertion
    // above is not passing because the probe always says "writable".
    const readonly = new Database(path, { readonly: true });
    expect(probeReadOnly(readonly).verdict).toBe("refused");
    readonly.close();
  });

  test("the READER REFUSES a handle that can write — it throws rather than reporting", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      s.put({ type: "memory", kind: "fact", body: "A synthetic fixture memory." });
    });
    // The seam exists for exactly this: sqlite's own read-only flag is what the
    // probe distrusts, so the only way to test the refusal is to hand the
    // reader a handle that really can write.
    expect(() => readV2Day(data, "2026-09-04", { open: (p) => new Database(p) })).toThrow(
      /STORE_NOT_PROVED_READ_ONLY/,
    );
    // And the store is untouched by the attempt.
    const path = join(data, "operational.sqlite");
    const db = new Database(path, { readonly: true });
    const names = (db.prepare("SELECT name FROM sqlite_master").all() as { name: string }[]).map(
      (r) => r.name,
    );
    db.close();
    expect(names.some((n) => n.includes("__parallel_probe"))).toBe(false);
  });

  // ── review blocker 9: a read that FAILS is not a day that was quiet ────────
  test("a sqlite read ERROR is carried, never swallowed into a zero", () => {
    const data = dir("v2");
    // A store file with a `meta` table and nothing else: every other read fails.
    const db = new Database(join(data, "operational.sqlite"), { create: true });
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
    db.exec("INSERT INTO meta VALUES ('livedDay', '4')");
    db.close();

    const day = readV2Day(data, "2026-09-04");
    expect(day.present).toBe(true);
    expect(day.readErrors.length).toBeGreaterThan(0);
    expect(day.readErrors.join(" ")).toContain("events");
    // The counts beside the error are empty — and that is exactly why they may
    // not be read as evidence of silence.
    expect(day.byNameForDate).toEqual({});
  });

  // ── review blocker 8: the exit path is the durable events, not `versions` ──
  test("EXITS count the durable memory.pruned / memory.merged rows, by lived day", () => {
    const data = dir("v2");
    let pruned = "";
    let merged = "";
    buildStore(data, (s) => {
      pruned = s.put({ type: "memory", kind: "fact", body: "A fact that will be let go." });
      merged = s.put({ type: "memory", kind: "person", body: "A duplicate that will merge." });
      s.put({ type: "memory", kind: "fact", body: "A fact that stays." });
      // The shape `sleep/prune.ts` and `sleep/dedup.ts` write: the memory id in
      // `ref`, the store's LIVED day in `day`, and no calendar date anywhere.
      s.appendEvent({ name: "memory.pruned", day: 7, ref: pruned, payload: { event: "memory.pruned" } });
      s.appendEvent({ name: "memory.merged", day: 7, ref: merged, payload: { event: "memory.merged" } });
      s.appendEvent({ name: "memory.pruned", day: 6, ref: "other", payload: { event: "memory.pruned" } });
      s.archive(pruned, "pruned");
      s.archive(merged, "merged");
    });

    const withDay = readV2Day(data, "2026-09-04", { livedDay: 7 });
    expect(withDay.memories.exitedOnDate).toBe(2);
    expect(withDay.memories.exitedByKind).toEqual({ fact: 1, person: 1 });

    // `Store.archive()` writes no versions row, so the old join could only ever
    // return zero — which is why the number was never a measurement.
    const roDb = new Database(join(data, "operational.sqlite"), { readonly: true });
    const versions = roDb.prepare("SELECT COUNT(*) AS n FROM versions").all() as { n: number }[];
    roDb.close();
    expect(versions[0]?.n).toBe(0);

    // Without a lived day there is nothing to attribute the rows to: NULL, and
    // the reason travels with it. A zero here would read as "nothing left".
    const without = readV2Day(data, "2026-09-04");
    expect(without.memories.exitedOnDate).toBeNull();
    expect(without.memories.exitedNote).toContain("not-exercised");
  });

  test("hitting the row cap is REPORTED — a counter that quietly caps is a lie", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      for (let i = 0; i < 5; i += 1) {
        s.appendEvent({
          name: PRIMACY_DELIVER_EVENT,
          day: 0,
          payload: { hook: "stop", reason: "override-engram", system: "v2", date: "2026-09-04" },
        });
      }
    });
    const capped = readV2Day(data, "2026-09-04", { limit: 3 });
    expect(capped.truncated).toBe(true);
    expect(capped.eventRowsRead).toBe(3);
    const whole = readV2Day(data, "2026-09-04", { limit: 500 });
    expect(whole.truncated).toBe(false);
    expect(whole.primacyByHook.deliver["stop"]).toBe(5);
  });
});

describe("the schemaBytes reading, reproduced read-only", () => {
  test("weighs identity-band and self-kind prose bodies, and quarantines fallback self rows", () => {
    const data = dir("v2");
    const body = "x".repeat(500);
    buildStore(data, (s) => {
      s.put({ type: "memory", kind: "self", body, source: "authored" });
      s.put({ type: "memory", kind: "self", body, source: "fallback" }); // F8 quarantine
      s.put({ type: "memory", kind: "fact", body, source: "authored" }); // not weighed
    });
    const reading = readSchemaBytes(data);
    expect(reading.present).toBe(true);
    expect(reading.empty).toBe(false);
    expect(reading.elements).toBe(1);
    expect(reading.bytes).toBe(500);
    expect(reading.quarantined).toBe(1);
  });

  test("an EMPTY store is `empty`, so the preflight can say not-exercised honestly", () => {
    const data = dir("v2");
    buildStore(data, () => {
      /* nothing put */
    });
    expect(readSchemaBytes(data).empty).toBe(true);
  });

  test("readBars refuses a ratio bar outside (0, 1] — a committed 1.5 would disarm the v2→v1 direction", () => {
    const runDir = dir("run");
    writeJson(join(runDir, "bars.json"), { ...BARS(3), crossEncodingRatioBar: 1.5 });
    expect(readBars(runDir)).toBeNull();
    writeJson(join(runDir, "bars.json"), { ...BARS(3), crossEncodingRatioBar: 0 });
    expect(readBars(runDir)).toBeNull();
  });

  test("a PROTECTED episode is weighed — the exclusion carries the identity/protected guard (PR-9 NEW-1)", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      const id = s.put({ type: "episode", kind: "self", body: `Protected chapter. ${"p".repeat(2_000)}` });
      s.updatePhysics(id, { protected: true });
    });
    const reading = readSchemaBytes(data);
    expect(reading.elements).toBe(1);
    expect(reading.episodes).toBe(0);
    expect(reading.bytes).toBeGreaterThan(2_000);
  });

  test("the reader weighs the SELF SCHEMA only — episodes and migrated self rows are counted, not weighed (mirrors self/identity.ts)", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      s.put({ type: "memory", kind: "self", body: `A real identity statement. ${"x".repeat(300)}` });
      s.put({ type: "episode", kind: "self", body: `Chapter. ${"e".repeat(3_000)}`, source: "migrated" });
      s.put({ type: "memory", kind: "self", body: `Imported self trace. ${"m".repeat(3_000)}`, source: "migrated" });
    });
    const reading = readSchemaBytes(data);
    expect(reading.elements).toBe(1);
    expect(reading.bytes).toBeLessThan(1_000);
    expect(reading.episodes).toBe(1);
    expect(reading.migrated).toBe(1);
  });

  test("a failed memories read is NOT a 0-byte reading — readErrors ride out (delta N5)", () => {
    const data = dir("v2");
    mkdirSync(data, { recursive: true });
    const db = new Database(join(data, "operational.sqlite"));
    db.exec("CREATE TABLE events (seq INTEGER PRIMARY KEY, name TEXT, day INTEGER, ref TEXT, dedup_key TEXT, payload TEXT, at INTEGER)");
    db.close();
    const reading = readSchemaBytes(data);
    expect(reading.present).toBe(true);
    expect(reading.readErrors.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The cross-encoding meter — §5 G7
// ═══════════════════════════════════════════════════════════════════════════

describe("the cross-encoding meter", () => {
  const RITUAL = "Before this session closes, what did you learn that is worth keeping?";
  const DAY = "2026-09-04";
  const AT = Date.parse(`${DAY}T09:00:00.000Z`);

  /** The committed bars every reading is taken against. No defaults anywhere. */
  const METER = {
    date: DAY,
    phase: "0" as const,
    bar: 0,
    minLineChars: 12,
    ratioBar: 0.1,
  };

  function v2WithSpan(text: string, at = AT): string {
    const data = dir("v2");
    const spanFile = join(data, "spans", "scopekey", "buffer.jsonl");
    mkdirSync(dirname(spanFile), { recursive: true });
    writeFileSync(
      spanFile,
      `${JSON.stringify({ hash: "h", session: "s", scope: "p", kind: "conversation", text, at, day: 0, from: 0, to: 1 })}\n`,
      "utf8",
    );
    return data;
  }

  test("a VERBATIM injected line found in v2's captured spans is a hit", () => {
    const data = v2WithSpan(`Some ordinary turn.\n${RITUAL}\nAnd more.`);
    const meter = crossEncoding({
      ...METER,
      v2DataDir: data,
      v1Dir: dir("v1"),
      v1Ritual: [RITUAL],
    });
    expect(meter.v1IntoV2.hits).toBe(1);
    expect(meter.v1IntoV2.hitAddresses).toEqual([...addressLines(RITUAL).addresses]);
    expect(meter.redLine).toBe(true);
  });

  test("PHASE 0: the bar is ZERO by rule — a committed bar of 1 still red-lines on one hit (delta N1)", () => {
    const data = v2WithSpan(RITUAL);
    // §9 OQ4 rules the pre-flip day at zero. A committed number cannot loosen it, and
    // `readBars` refuses a nonzero `crossEncodingBar` so the file agrees.
    expect(crossEncoding({ ...METER, v2DataDir: data, v1Dir: dir("v1"), bar: 1, v1Ritual: [RITUAL] }).redLine).toBe(true);
    expect(crossEncoding({ ...METER, v2DataDir: data, v1Dir: dir("v1"), v1Ritual: [RITUAL] }).redLine).toBe(true);
  });

  test("the OQ4 numerator counts receiving-side LINES, not distinct probes (delta N2)", () => {
    // Three v2 spans carrying the same v1 line: three lines carry it, one
    // address hit. A probe-count numerator would read 1 however many mints
    // carried the text — bounded by the wake's line count, not by v1's volume.
    const data = dir("v2");
    const spanFile = join(data, "spans", "scopekey", "buffer.jsonl");
    mkdirSync(dirname(spanFile), { recursive: true });
    writeFileSync(
      spanFile,
      [1, 2, 3].map((i) => JSON.stringify({ at: AT + i, day: 0, text: RITUAL, hash: `h${i}` })).join("\n") + "\n",
      "utf8",
    );
    const meter = crossEncoding({ ...METER, v2DataDir: data, v1Dir: dir("v1"), v1Ritual: [RITUAL] });
    expect(meter.v1IntoV2.hits).toBe(3);
    expect(meter.v1IntoV2.distinctHits).toBe(1);
  });

  test("a v1 wake path that does not exist is NOT a probe — unmeasured here, refused by the daily (delta N4)", () => {
    const data = v2WithSpan(RITUAL);
    const missing = join(dir("v1"), "render", "wake.md");
    const meter = crossEncoding({ ...METER, v2DataDir: data, v1Dir: dir("v1"), v1WakeFile: missing });
    expect(meter.v1IntoV2.probes).toBe(0);
    expect(meter.v1IntoV2.measured).toBe(false);
  });

  test("a MIGRATED row is excluded by construction — the migration is not contamination", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      s.put({ type: "memory", kind: "fact", body: RITUAL, source: "migrated", learnedOn: DAY });
    });
    const meter = crossEncoding({ ...METER, v2DataDir: data, v1Dir: dir("v1"), v1Ritual: [RITUAL] });
    expect(meter.v1IntoV2.hits).toBe(0);
    expect(meter.v1IntoV2.excludedMigrated).toBe(1);
    expect(meter.redLine).toBe(false);
  });

  test("the SAME line in a non-migrated row IS a hit — the exclusion is by row, not by text", () => {
    const data = dir("v2");
    buildStore(data, (s) => {
      s.put({ type: "memory", kind: "fact", body: RITUAL, source: "authored", learnedOn: DAY });
    });
    const meter = crossEncoding({ ...METER, v2DataDir: data, v1Dir: dir("v1"), v1Ritual: [RITUAL] });
    expect(meter.v1IntoV2.hits).toBe(1);
    expect(meter.v1IntoV2.excludedMigrated).toBe(0);
  });

  test("the v2→v1 direction reads v1's buffer the same way", () => {
    const v1 = dir("v1");
    const buffer = join(v1, "buffer-archive", DAY, "scope.1.jsonl");
    mkdirSync(dirname(buffer), { recursive: true });
    const V2_ASK = "Write what you learned, in your own words, while you still have the pen.";
    writeFileSync(buffer, `${JSON.stringify({ ts: "2026-09-04T09:00:00Z", sessionId: "s", spanText: V2_ASK, project: "p" })}\n`, "utf8");
    const meter = crossEncoding({ ...METER, v2DataDir: dir("v2"), v1Dir: v1, v2Ritual: [V2_ASK] });
    expect(meter.v2IntoV1.hits).toBe(1);
    expect(meter.total).toBe(1);
  });

  test("a wake FILE is addressed line by line, and blank lines match nothing", () => {
    const wake = at("wake", "v1-wake-2026-09-04.txt");
    writeFileSync(wake, `\n\n${RITUAL}\n   \n`, "utf8");
    const data = v2WithSpan(RITUAL);
    const meter = crossEncoding({ ...METER, v2DataDir: data, v1Dir: dir("v1"), v1WakeFile: wake });
    expect(meter.v1IntoV2.probes).toBe(1);
    expect(meter.v1IntoV2.hits).toBe(1);
  });

  test("no probe offered reads UNMEASURED, never a clean 0/0", () => {
    const meter = crossEncoding({ ...METER, v2DataDir: dir("v2"), v1Dir: dir("v1") });
    expect(meter.v1IntoV2.measured).toBe(false);
    expect(meter.v2IntoV1.measured).toBe(false);
    expect(meter.v1IntoV2.probes).toBe(0);
    // One probe, no hit, is a real measurement of zero — a different fact.
    const measured = crossEncoding({ ...METER, v2DataDir: dir("v2"), v1Dir: dir("v1"), v1Ritual: [RITUAL] });
    expect(measured.v1IntoV2.measured).toBe(true);
    expect(measured.v1IntoV2.hits).toBe(0);
  });

  // ── review blocker 7a: the probe floor, committed ────────────────────────
  test("SHORT structural lines are not probes — `---` and `## Notes` are rejected", () => {
    const data = v2WithSpan(`---\n## Notes\nYes.\n${RITUAL}`);
    const meter = crossEncoding({
      ...METER,
      v2DataDir: data,
      v1Dir: dir("v1"),
      v1Ritual: [`---\n## Notes\nYes.\n${RITUAL}`],
    });
    // Only the ritual line survives the floor. Without one, `---` addresses
    // identically in every store and every day reads as a verbatim hit.
    expect(meter.v1IntoV2.probes).toBe(1);
    expect(meter.v1IntoV2.probesRejectedShort).toBe(2);
    expect(meter.v1IntoV2.hits).toBe(1);
    expect(meter.minLineChars).toBe(12);
  });

  test("a frontmatter RULE inside a body is structure, never a probe", () => {
    // `---` is dropped before the floor is even applied, so raising the floor
    // is not what saves it — it is not text.
    const zeroFloor = crossEncoding({
      ...METER,
      minLineChars: 1,
      v2DataDir: v2WithSpan("---"),
      v1Dir: dir("v1"),
      v1Ritual: ["---"],
    });
    expect(zeroFloor.v1IntoV2.probes).toBe(0);
    expect(zeroFloor.v1IntoV2.hits).toBe(0);
    expect(zeroFloor.redLine).toBe(false);
  });

  // ── review blocker 7b: the corpus is THE DAY, not the whole store ────────
  test("a span from ANOTHER day is not in this day's corpus", () => {
    const yesterday = Date.parse("2026-09-03T09:00:00.000Z");
    const data = v2WithSpan(RITUAL, yesterday);
    const meter = crossEncoding({
      ...METER,
      v2DataDir: data,
      v1Dir: dir("v1"),
      v1Ritual: [RITUAL],
    });
    // Scanning the whole store made one legitimate hit re-fire every day for
    // the rest of the run, and the number said nothing about the day it was
    // printed beside.
    expect(meter.v1IntoV2.hits).toBe(0);
    // The same span ON the day is a hit, so the filter is not simply blind.
    expect(
      crossEncoding({
        ...METER,
        v2DataDir: v2WithSpan(RITUAL, AT),
        v1Dir: dir("v1"),
        v1Ritual: [RITUAL],
      }).v1IntoV2.hits,
    ).toBe(1);
  });

  test("prose is scoped by its CREATED date, and v1's buffer by the day's files", () => {
    const data = dir("v2");
    buildStore(data, (store) => {
      store.put({ type: "memory", kind: "fact", body: RITUAL, source: "authored", learnedOn: "2026-08-01" });
    });
    expect(
      crossEncoding({ ...METER, v2DataDir: data, v1Dir: dir("v1"), v1Ritual: [RITUAL] }).v1IntoV2.hits,
    ).toBe(0);

    const v1 = dir("v1");
    const V2_ASK = "Write what you learned, in your own words, while you have the pen.";
    for (const day of ["2026-09-03", DAY]) {
      const buffer = join(v1, "buffer-archive", day, "scope.1.jsonl");
      mkdirSync(dirname(buffer), { recursive: true });
      writeFileSync(
        buffer,
        `${JSON.stringify({ ts: `${day}T09:00:00Z`, sessionId: "s", spanText: V2_ASK })}\n`,
        "utf8",
      );
    }
    const meter = crossEncoding({ ...METER, v2DataDir: dir("v2"), v1Dir: v1, v2Ritual: [V2_ASK] });
    // One hit, not two: yesterday's archive directory names another date.
    expect(meter.v2IntoV1.hits).toBe(1);
    expect(meter.v2IntoV1.scanned).toBe(1);
  });

  test("a DATED v1 directory does not swallow its own buffer files", () => {
    // `--v1-dir ~/.bansai-2026-08-15` is an ordinary dated backup. Matching
    // dates in the absolute path would drop every file in it as "another day"
    // and the direction would meter nothing while reporting a clean zero.
    const v1 = dir("bansai-2026-08-15");
    const V2_ASK = "Write what you learned, in your own words, while you have the pen.";
    const buffer = join(v1, "buffer", "scope.1.jsonl");
    mkdirSync(dirname(buffer), { recursive: true });
    writeFileSync(
      buffer,
      `${JSON.stringify({ ts: `${DAY}T09:00:00Z`, sessionId: "s", spanText: V2_ASK })}\n`,
      "utf8",
    );
    const meter = crossEncoding({ ...METER, v2DataDir: dir("v2"), v1Dir: v1, v2Ritual: [V2_ASK] });
    expect(meter.v2IntoV1.scanned).toBe(1);
    expect(meter.v2IntoV1.hits).toBe(1);
  });

  // ── review blocker 7c: OQ4's two rules, by phase ─────────────────────────
  test("PHASE 0 (before the flip) red-lines on ANY hit — the host's exclusion is what changed", () => {
    const data = v2WithSpan(RITUAL);
    const meter = crossEncoding({
      ...METER,
      phase: "0",
      v2DataDir: data,
      v1Dir: dir("v1"),
      v1Ritual: [RITUAL],
      v1CreatedThatDay: 1_000,
    });
    expect(meter.redLine).toBe(true);
    // Even a vast denominator cannot buy it down: phase 0 has no ratio.
    expect(meter.ratioNote).toContain("ZERO hits in either direction");
  });

  test("PHASE P: a hit is a NAMED FINDING, and a red-line only above the ratio", () => {
    const v1 = dir("v1");
    const V2_ASK = "Write what you learned, in your own words, while you have the pen.";
    const buffer = join(v1, "buffer-archive", DAY, "scope.1.jsonl");
    mkdirSync(dirname(buffer), { recursive: true });
    writeFileSync(
      buffer,
      `${JSON.stringify({ ts: `${DAY}T09:00:00Z`, sessionId: "s", spanText: V2_ASK })}\n`,
      "utf8",
    );
    const meter = (v1CreatedThatDay: number | null) =>
      crossEncoding({
        ...METER,
        phase: "P",
        v2DataDir: dir("v2"),
        v1Dir: v1,
        v2Ritual: [V2_ASK],
        v1CreatedThatDay,
      });

    // 1 hit against 40 v1 mints = 2.5%: v1 keeps v2's injected text BY DESIGN
    // (§9 OQ4, accept-and-meter), so this is a finding, not a halt.
    const under = meter(40);
    expect(under.v2IntoV1.hits).toBe(1);
    expect(under.redLine).toBe(false);
    expect(under.namedFinding).toBe(true);
    expect(under.ratio).toBeCloseTo(0.025, 5);
    expect(under.ratioDenominator).toBe(40);

    // 1 hit against 5 mints = 20%, above the committed 10% — a red-line.
    const over = meter(5);
    expect(over.redLine).toBe(true);
    expect(over.namedFinding).toBe(false);
    expect(over.ratio).toBeCloseTo(0.2, 5);
    expect(over.ratioNote).toContain("red-line above 0.1");

    // No denominator: the rule cannot be evaluated. An unmeasurable meter with
    // hits on it is a HALT, not a pass (§5 G10; delta N7) — the day is not
    // credited on a number nobody could compute.
    const none = meter(null);
    expect(none.ratio).toBeNull();
    expect(none.redLine).toBe(true);
    expect(none.namedFinding).toBe(false);
    expect(none.ratioNote).toContain("NO denominator");
  });

  // ── the single-phase ruling: the two rules are BY DIRECTION, not by phase ──
  test("PHASE P, v1 -> v2: ANY hit red-lines, and no denominator can buy it down", () => {
    // v1's ritual text inside v2's capture. That exclusion is carried by the
    // HOST's transcript shape (§5 G8), not by v2 and not by the mute, so it is
    // the same zero bar in every phase — the ratio belongs to the other
    // direction, where v1 keeps v2's text by design.
    const data = v2WithSpan(RITUAL);
    const meter = crossEncoding({
      ...METER,
      phase: "P",
      v2DataDir: data,
      v1Dir: dir("v1"),
      v1Ritual: [RITUAL],
      v1CreatedThatDay: 1_000,
    });
    expect(meter.v1IntoV2.hits).toBe(1);
    expect(meter.redLine).toBe(true);
    expect(meter.namedFinding).toBe(false);
    // The ratio is computed and is far under the bar — and is not what decided.
    expect(meter.ratio).toBe(0);
    expect(meter.ratioNote).toContain("v1→v2 1 hit(s), where the bar is ZERO in every phase");
  });

  test("PHASE P: a v2 -> v1 hit under the ratio is a finding UNTIL a v1 -> v2 hit lands", () => {
    const v1 = dir("v1");
    const V2_ASK = "Write what you learned, in your own words, while you have the pen.";
    const buffer = join(v1, "buffer-archive", DAY, "scope.1.jsonl");
    mkdirSync(dirname(buffer), { recursive: true });
    writeFileSync(
      buffer,
      `${JSON.stringify({ ts: `${DAY}T09:00:00Z`, sessionId: "s", spanText: V2_ASK })}\n`,
      "utf8",
    );
    // v2's ask in v1's buffer: 1 hit against 40 mints, the accepted cost.
    const finding = crossEncoding({
      ...METER,
      phase: "P",
      v2DataDir: dir("v2-clean"),
      v1Dir: v1,
      v2Ritual: [V2_ASK],
      v1CreatedThatDay: 40,
    });
    expect(finding.redLine).toBe(false);
    expect(finding.namedFinding).toBe(true);

    // The same day, plus one v1 line in v2's capture: the host-shape breach
    // halts the day whatever the other direction's ratio says.
    const both = crossEncoding({
      ...METER,
      phase: "P",
      v2DataDir: v2WithSpan(RITUAL),
      v1Dir: v1,
      v1Ritual: [RITUAL],
      v2Ritual: [V2_ASK],
      v1CreatedThatDay: 40,
    });
    expect(both.v1IntoV2.hits).toBe(1);
    expect(both.v2IntoV1.hits).toBe(1);
    expect(both.redLine).toBe(true);
    expect(both.namedFinding).toBe(false);
  });

  test("a receiving side that cannot be READ is unmeasured, never a clean zero (delta N3)", () => {
    // A store whose operational.sqlite lacks the memories table: the prose read
    // fails, and the v1→v2 direction must say so rather than report 0 hits.
    const data = dir("v2");
    mkdirSync(data, { recursive: true });
    const db = new Database(join(data, "operational.sqlite"));
    db.exec("CREATE TABLE events (seq INTEGER PRIMARY KEY, name TEXT, day INTEGER, ref TEXT, dedup_key TEXT, payload TEXT, at INTEGER)");
    db.close();
    const meter = crossEncoding({ ...METER, v2DataDir: data, v1Dir: dir("v1"), v1Ritual: [RITUAL] });
    expect(meter.v1IntoV2.readErrors.length).toBeGreaterThan(0);
    expect(meter.v1IntoV2.measured).toBe(false);
    expect(meter.v1IntoV2.hits).toBe(0);
  });

  test("the meter carries addresses, never the line", () => {
    const data = v2WithSpan(RITUAL);
    const meter = crossEncoding({ ...METER, v2DataDir: data, v1Dir: dir("v1"), v1Ritual: [RITUAL] });
    expect(JSON.stringify(meter)).not.toContain("worth keeping");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The daily record's day classes — CONTRACT §5 "What counts as a day"
// ═══════════════════════════════════════════════════════════════════════════

describe("day classes", () => {
  const DATE = "2026-09-04";

  interface Scene {
    runDir: string;
    v1Dir: string;
    v2Dir: string;
  }

  /**
   * v1's ritual text, as the operator supplies it. The daily record REFUSES to
   * run without a v1 probe (review blocker 7d): without one the v1->v2
   * direction silently reads zero and the day's isolation is unmetered.
   */
  const V1_RITUAL = "What did you learn in this session that is worth keeping?";

  function scene(k = 3): Scene {
    const runDir = dir("run");
    writeJson(join(runDir, "bars.json"), BARS(k));
    return { runDir, v1Dir: dir("v1"), v2Dir: dir("v2") };
  }

  /** v1's side of an ordinary Phase-P day: muted at every hook, boundary reached. */
  function v1Muted(s: Scene, extra: readonly V1Ev[] = []): void {
    v1Log(s.v1Dir, DATE, [
      { seq: 0, session: "s1", type: "session.start" },
      { seq: 1, session: "s1", type: "ab.muted", hook: "session_start" },
      { seq: 2, session: "s1", type: "buffer.append" },
      { seq: 3, session: "s1", type: "buffer.append" },
      { seq: 4, session: "s1", type: "buffer.append" },
      { seq: 5, session: "s1", type: "ab.muted", hook: "user_prompt_submit" },
      { seq: 6, session: "s1", type: "session.end" },
      ...extra,
    ]);
  }

  /**
   * v2 delivering into ONE session. The payload is the real one
   * (`hooks.ts#deliveryVerdict`): `session` is `input.sessionId`, the HOST's
   * session id — the same id v1 stamps on its own log lines, which is what
   * makes the `silent` class a join rather than a difference of counts.
   */
  function v2Delivering(
    s: Scene,
    hooks: readonly string[] = ["session-start", "user-prompt-submit", "stop"],
    session = "s1",
  ): void {
    buildStore(s.v2Dir, (store) => {
      for (const hook of hooks) {
        store.appendEvent({
          name: PRIMACY_DELIVER_EVENT,
          day: 0,
          payload: { hook, reason: "override-engram", system: "v2", date: DATE, session },
        });
      }
    });
  }

  function classOf(s: Scene, over: Partial<Parameters<typeof dailyRecord>[0]> = {}) {
    return dailyRecord({
      runDir: s.runDir,
      date: DATE,
      v1Dir: s.v1Dir,
      v2DataDir: s.v2Dir,
      phase: "P",
      primacy: "v2",
      v1Ritual: [V1_RITUAL],
      ...over,
    }).record;
  }

  test("ACTIVE: both systems reached a boundary and the day cleared the floor", () => {
    const s = scene(3);
    v1Muted(s);
    v2Delivering(s);
    const r = classOf(s);
    expect(r.class).toBe("active");
    expect(r.turns).toBe(3);
    expect(r.why).toContain("at or above the committed floor of 3");
  });

  test("THIN: below the committed turn floor, and it is NOT counted toward the phase", () => {
    const s = scene(10);
    v1Muted(s);
    v2Delivering(s);
    const artifacts = dailyRecord({
      runDir: s.runDir,
      date: DATE,
      v1Dir: s.v1Dir,
      v2DataDir: s.v2Dir,
      v1Ritual: [V1_RITUAL],
      phase: "P",
      primacy: "v2",
    });
    expect(artifacts.record.class).toBe("thin");
    expect(artifacts.record.why).toContain("below the committed floor of 10");
    expect(artifacts.run.activeDays["P"]).toBe(0);
  });

  // ── day 1's own defect (measured 2026-09-04): the muted side's boundary ───
  //
  // A muted v1 logs `ab.muted` at session_start and user_prompt_submit and
  // NOTHING at Stop, so on a clean v2-primary day its log holds no
  // `session.end` at all. Requiring one classed every such day `thin` — the
  // instrument reading the mute working as the mute broken, on a run where no
  // day could then ever count.
  /** v1's side of a REAL Phase-P day: muted, alive, and no Stop row anywhere. */
  function v1MutedNoStop(s: Scene): void {
    v1Log(s.v1Dir, DATE, [
      { seq: 0, session: "s1", type: "session.start" },
      { seq: 1, session: "s1", type: "ab.muted", hook: "session_start" },
      { seq: 2, session: "s1", type: "buffer.append" },
      { seq: 3, session: "s1", type: "ab.muted", hook: "user_prompt_submit" },
      { seq: 4, session: "s1", type: "buffer.append" },
      { seq: 5, session: "s1", type: "buffer.append" },
    ]);
  }

  test("MUTED-CONSISTENT: a muted v1 that reached no Stop is not THIN — the day is graded on the PRIMARY's boundary", () => {
    const s = scene(3);
    v1MutedNoStop(s);
    v2Delivering(s);
    const r = classOf(s);
    expect(r.class).toBe("active");
    expect(r.flags).not.toContain("thin");
    // Its own named value, never folded into a pass (§5 G13).
    expect(r.boundaries.v1).toBe("muted-consistent");
    expect(r.boundaries.v2).toBe("pass");
    expect(r.boundaries.primary).toBe("v2");
    expect(r.boundaries.ok).toBe(true);
    expect(r.boundaries.note).toContain("Stop hook logs no ab.muted");
    expect(r.why).toContain("muted-consistent");
  });

  // ── G38's defect (measured 2026-09-14): the referee went quiet ───────────
  //
  // The turn floor was committed against v1's per-turn capture row, written by
  // bansai's Stop hook. G38 (2026-09-10) removed that hook to stop bansai's
  // encoding; from 2026-09-11 every day read "0 conversational turns" against
  // dozens of v2 boundaries, and the phase count could never move. Owner ruling
  // 2026-09-14: when v1 is muted-consistent and logged no per-turn row, count
  // v2's one durable row per user prompt, and say so on the record.
  /** v1 after G38: muted, alive, and NO per-turn row anywhere. */
  function v1MutedNoTurns(s: Scene): void {
    v1Log(s.v1Dir, DATE, [
      { seq: 0, session: "s1", type: "session.start" },
      { seq: 1, session: "s1", type: "ab.muted", hook: "session_start" },
      { seq: 2, session: "s1", type: "ab.muted", hook: "user_prompt_submit" },
      { seq: 3, session: "s1", type: "ab.muted", hook: "user_prompt_submit" },
    ]);
  }
  /** v2's per-prompt recall row, the fallback's unit: one per user prompt. */
  function v2Recall(s: Scene, n: number, date = DATE): void {
    buildStore(s.v2Dir, (store) => {
      for (let i = 0; i < n; i++) {
        store.appendEvent({
          name: "adapter.recall",
          day: 0,
          payload: { reason: "ok", surfaced: 0, footnotes: 1, bytes: 300, budget: 9000, observer: false, date, session: "s1" },
        });
      }
    });
  }

  test("TURN SOURCE: a muted v1 with no per-turn row hands the floor to v2's per-prompt row, named on the record", () => {
    const s = scene(3);
    v1MutedNoTurns(s);
    v2Delivering(s);
    v2Recall(s, 4);
    const r = classOf(s);
    expect(r.boundaries.v1).toBe("muted-consistent");
    expect(r.turnSource).toBe("v2:adapter.recall");
    expect(r.turns).toBe(4);
    expect(r.class).toBe("active");
    expect(r.why).toContain("counted from v2:adapter.recall");
  });

  test("TURN SOURCE: the fallback still applies the floor — three prompts under K=5 is THIN", () => {
    const s = scene(5);
    v1MutedNoTurns(s);
    v2Delivering(s);
    v2Recall(s, 3);
    const r = classOf(s);
    expect(r.turnSource).toBe("v2:adapter.recall");
    expect(r.turns).toBe(3);
    expect(r.class).toBe("thin");
    expect(r.why).toContain("3 conversational turn(s) (counted from v2:adapter.recall) is below the committed floor of 5");
  });

  test("TURN SOURCE: one v1 per-turn row keeps v1 the referee — v2's rows are not added to it", () => {
    const s = scene(3);
    v1Log(s.v1Dir, DATE, [
      { seq: 0, session: "s1", type: "session.start" },
      { seq: 1, session: "s1", type: "ab.muted", hook: "session_start" },
      { seq: 2, session: "s1", type: "buffer.append" },
    ]);
    v2Delivering(s);
    v2Recall(s, 9);
    const r = classOf(s);
    expect(r.turnSource).toBe("v1:buffer.append");
    expect(r.turns).toBe(1);
    expect(r.class).toBe("thin");
  });

  test("TURN SOURCE: a v1 nobody can show was alive gets no substitute — an absent log stays not-exercised and the day sinks", () => {
    const s = scene(3);
    v2Delivering(s);
    v2Recall(s, 9);
    const r = classOf(s);
    expect(r.boundaries.v1).toBe("not-exercised");
    expect(r.turnSource).toBe("v1:buffer.append");
    expect(r.turns).toBe(0);
    expect(r.class).toBe("thin");
  });

  test("TURN SOURCE: only the date's own recall rows count", () => {
    const s = scene(3);
    v1MutedNoTurns(s);
    v2Delivering(s);
    v2Recall(s, 2);
    v2Recall(s, 5, "2026-09-05");
    const r = classOf(s);
    expect(r.turnSource).toBe("v2:adapter.recall");
    expect(r.turns).toBe(2);
    expect(r.class).toBe("thin");
  });

  test("and THIN still follows the PRIMARY: the same muted v1, but v2 reached no boundary", () => {
    const s = scene(3);
    v1MutedNoStop(s);
    // v2 speaks at session start only: no `stop` record, no episode ask, no
    // `adapter.boundary` row — nothing that evidences a session ending.
    v2Delivering(s, ["session-start", "user-prompt-submit"]);
    const r = classOf(s);
    expect(r.class).toBe("thin");
    expect(r.boundaries.primaryGrade).toBe("fail");
    expect(r.why).toContain("PRIMARY system (v2)");
  });

  test("the exception needs PROOF OF LIFE: a muted v1 with no ab.muted row at all is a fail, not a pass", () => {
    const s = scene(3);
    // A v1 that logged turns and never said it was muted. §7's same-day encode
    // pairing rests on v1 still encoding while muted, so "no evidence v1 ran"
    // is not the same state as "v1 ran, muted, and left no Stop row".
    v1Log(s.v1Dir, DATE, [
      { seq: 0, session: "s1", type: "session.start" },
      { seq: 1, session: "s1", type: "buffer.append" },
      { seq: 2, session: "s1", type: "buffer.append" },
      { seq: 3, session: "s1", type: "buffer.append" },
    ]);
    v2Delivering(s);
    const r = classOf(s);
    expect(r.boundaries.v1).toBe("fail");
    expect(r.class).toBe("thin");
    expect(r.why).toContain("MUTED side's boundary evidence graded fail");
  });

  test("the PRIMARY gets NO exception: a v1-primary day with no v1 boundary is thin", () => {
    const s = scene(3);
    // Day 0's shape: v1 holds the microphone and v2 stands down.
    v1Log(s.v1Dir, DATE, [
      { seq: 0, session: "s1", type: "session.start" },
      { seq: 1, session: "s1", type: "buffer.append" },
      { seq: 2, session: "s1", type: "buffer.append" },
      { seq: 3, session: "s1", type: "buffer.append" },
    ]);
    buildStore(s.v2Dir, (store) => {
      for (const hook of ["session-start", "stop"]) {
        store.appendEvent({
          name: PRIMACY_STANDDOWN_EVENT,
          day: 0,
          payload: { hook, reason: "override-bansai", system: "v1", date: DATE, session: "s1" },
        });
      }
    });
    const r = classOf(s, { phase: "0", primacy: "v1" });
    expect(r.boundaries.primary).toBe("v1");
    expect(r.boundaries.primaryGrade).toBe("fail");
    expect(r.class).toBe("thin");
  });

  test("an ABSENT v1 log reads not-exercised, never muted-consistent — an unread log shows nothing", () => {
    const s = scene(3);
    v2Delivering(s);
    const r = classOf(s);
    expect(r.boundaries.v1).toBe("not-exercised");
    expect(r.class).toBe("thin");
  });

  // ── the watches box 2 cannot carry: named values, never a bare list ──
  test("every non-durable watch renders a NAMED VALUE with a reason, and the four readingless ones can never pass", () => {
    const s = scene(3);
    v1MutedNoStop(s);
    v2Delivering(s);
    const r = classOf(s);
    // Total over the reader's own list — no watch may be silently dropped.
    expect(r.watches.map((w) => w.detector)).toEqual([...r.v2.nonDurable]);
    for (const w of r.watches) {
      // `memory.reinforced` is the FIFTH, and the only one with a reading of its
      // own: it can pass and it can fail. The other four hold no reading, so
      // green is unreachable for them by construction (§5 G13).
      if (w.detector !== "memory.reinforced") {
        // Named against the DETECTOR, so a failure says which watch went green.
        expect(`${w.detector}=${w.value}`).toBe(
          `${w.detector}=${w.value === "needs-rater" ? "needs-rater" : "not-exercised"}`,
        );
      }
      expect(w.reason.length).toBeGreaterThan(40);
    }
    const pressure = r.watches.find((w) => w.detector === "self.schema.pressure");
    expect(pressure?.value).toBe("not-exercised");
    expect(pressure?.reason).toContain("revision-pressure");
    // sleep.symmetry with no attributable transition: not-exercised, and it
    // says WHY there is nothing to read rather than printing a zero.
    const symmetry = r.watches.find((w) => w.detector === "sleep.symmetry");
    expect(symmetry?.value).toBe("not-exercised");
    expect(symmetry?.reason).toContain("--lived-day");
  });

  test("sleep.symmetry with band transitions on the lived day is NEEDS-RATER, and names its rater", () => {
    const s = scene(3);
    v1MutedNoStop(s);
    v2Delivering(s);
    buildStore(s.v2Dir, (store) => {
      store.appendEvent({ name: "band.transition", day: 7, payload: { from: "warm", to: "cool" } });
    });
    const r = classOf(s, { livedDay: 7 });
    const symmetry = r.watches.find((w) => w.detector === "sleep.symmetry");
    expect(symmetry?.value).toBe("needs-rater");
    expect(symmetry?.reason).toContain("symmetry consumer");
  });

  // ── self.schema.pressure: the watch READS the durable row (G55) ──────────
  //
  // It used to be hard-coded `not-exercised` with a reason asserting that no
  // durable revision-pressure row existed in this build. The schemas revision
  // path writes one on every credited challenge, and the first landed on the
  // live store on 2026-09-15 — so these three pin the reading rather than the
  // sentence.
  const NOON = Date.parse(`${DATE}T12:00:00.000Z`);

  /** One `revision.pressure` row exactly as `schemas/index.ts` writes it. */
  function pressureRow(
    s: Scene,
    row: {
      targetId: string;
      challengerId?: string;
      day?: number;
      force?: number;
      pressureAfter?: number;
      bar?: number;
    },
    at = NOON,
  ): void {
    buildStore(
      s.v2Dir,
      (store) => {
        const payload = {
          targetId: row.targetId,
          day: row.day ?? 41,
          challengerId: row.challengerId ?? "mem_challenger",
          force: row.force ?? 0.144,
          pressureAfter: row.pressureAfter ?? 0.144,
          bar: row.bar ?? 0,
        };
        store.appendEvent({
          name: "revision.pressure",
          day: payload.day,
          ref: row.targetId,
          dedupKey: `revision.pressure:${row.targetId}:${payload.day}:${payload.challengerId}`,
          payload,
        });
      },
      () => at,
    );
  }

  test("self.schema.pressure with no row ON THIS DATE is NOT-EXERCISED — and no longer claims the row cannot exist", () => {
    const s = scene(3);
    v1MutedNoStop(s);
    v2Delivering(s);
    // A real row, on the NEXT day: the date filter has to bite, or a watch that
    // reads the whole table would report yesterday's pressure forever.
    pressureRow(s, { targetId: "sch_elsewhere" }, Date.parse("2026-09-05T12:00:00.000Z"));
    const r = classOf(s);
    const pressure = r.watches.find((w) => w.detector === "self.schema.pressure");
    expect(pressure?.value).toBe("not-exercised");
    expect(pressure?.reason).toContain("attributable to this date");
    expect(pressure?.reason).toContain("The row EXISTS in this build");
    expect(pressure?.reason).not.toContain("being wired separately");
    expect(r.v2.revisionPressure.rows).toHaveLength(0);
    expect(r.v2.revisionPressure.targets).toHaveLength(0);
  });

  test("a revision.pressure row on the date reads NEEDS-RATER, carrying force and bar — a ZERO BAR is visible", () => {
    const s = scene(3);
    v1MutedNoStop(s);
    v2Delivering(s);
    buildStore(s.v2Dir, (store) => {
      store.put({
        id: "sch_belief",
        // A revision target is a SCHEMA element (`sch_`), which is a row in the
        // same `memories` table — the one this reader asks what became of it.
        type: "schema",
        kind: "fact",
        body: "a belief that took a credited challenge",
        learnedOn: DATE,
        source: "authored",
      });
    });
    pressureRow(s, { targetId: "sch_belief", force: 0.144, pressureAfter: 0.144, bar: 0 });
    const r = classOf(s);
    const pressure = r.watches.find((w) => w.detector === "self.schema.pressure");
    // needs-rater, never pass: the rows say a challenge was credited, not that
    // crediting it was right — this instrument reads rows (§5 G13).
    expect(pressure?.value).toBe("needs-rater");
    expect(pressure?.reason).toContain("force 0.144");
    expect(pressure?.reason).toContain("bar 0");
    expect(pressure?.reason).toContain("accumulated, bar not crossed");
    expect(pressure?.reason).toContain("does not recompute verdicts");
    expect(r.v2.revisionPressure.rows).toHaveLength(1);
    expect(r.v2.revisionPressure.rows[0]).toMatchObject({
      targetId: "sch_belief",
      challengerId: "mem_challenger",
      livedDay: 41,
      force: 0.144,
      bar: 0,
    });
    expect(r.v2.revisionPressure.targets).toHaveLength(1);
    expect(r.v2.revisionPressure.targets[0]).toMatchObject({
      targetId: "sch_belief",
      rows: 1,
      superseded: false,
      versionRows: 0,
      targetRowPresent: true,
    });
  });

  test("a target SUPERSEDED past the bar is read off the target row, not off the arithmetic", () => {
    const s = scene(3);
    v1MutedNoStop(s);
    v2Delivering(s);
    let successor = "";
    buildStore(s.v2Dir, (store) => {
      store.put({
        id: "sch_old",
        type: "schema",
        kind: "fact",
        body: "the belief that lost",
        learnedOn: DATE,
        source: "authored",
      });
      successor = store.supersede(
        "sch_old",
        {
          type: "schema",
          kind: "fact",
          body: "the belief that replaced it",
          learnedOn: DATE,
          source: "accommodation",
        },
        "revised-by-pressure",
      );
    });
    pressureRow(s, { targetId: "sch_old", force: 0.6, pressureAfter: 1.2, bar: 1 });
    const r = classOf(s);
    const pressure = r.watches.find((w) => w.detector === "self.schema.pressure");
    expect(pressure?.value).toBe("needs-rater");
    expect(pressure?.reason).toContain("1 superseded");
    expect(pressure?.reason).toContain(`SUPERSEDED by ${successor}`);
    expect(pressure?.reason).toContain("AS IT STANDS NOW");
    const target = r.v2.revisionPressure.targets[0];
    expect(target).toMatchObject({
      targetId: "sch_old",
      superseded: true,
      supersededBy: successor,
      archivedReason: "revised-by-pressure",
      versionRows: 1,
    });
  });

  test("a muted v1's RUNNER re-rendering its wake is not a delivery — `wake.rendered` on a muted day stays clean (scar §2.3)", () => {
    const s = scene(3);
    v1Muted(s, [
      { seq: 20, session: "runner", type: "wake.rendered" },
      { seq: 21, session: "runner", type: "wake.rendered" },
      { seq: 22, session: "runner", type: "wake.rendered" },
    ]);
    v2Delivering(s);
    const r = classOf(s);
    expect(r.contamination.v1.wake).toBe(0);
    expect(r.class).toBe("active");
    // And a real delivery on the muted side still contaminates.
    const s2 = scene(3);
    v1Muted(s2, [{ seq: 20, session: "s1", type: "wake.delivered" }]);
    v2Delivering(s2);
    expect(classOf(s2).class).toBe("contaminated");
  });

  test("CONTAMINATED: v1 delivered a wake on a Phase-P day, when it was the muted side", () => {
    const s = scene(3);
    v1Muted(s, [{ seq: 7, session: "s2", type: "wake.delivered" }]);
    v2Delivering(s);
    const r = classOf(s);
    expect(r.class).toBe("contaminated");
    expect(r.flags).toContain("contaminated");
    expect(r.contamination.v1.wake).toBe(1);
    expect(r.why).toContain("MUTED v1 side");
  });

  test("MIXED: a delivery and a LATER ab.muted in ONE v1 session — the flip straddled it", () => {
    const s = scene(3);
    v1Log(s.v1Dir, DATE, [
      { seq: 0, session: "s1", type: "session.start" },
      { seq: 1, session: "s1", type: "wake.delivered" },
      { seq: 2, session: "s1", type: "buffer.append" },
      { seq: 3, session: "s1", type: "buffer.append" },
      { seq: 4, session: "s1", type: "buffer.append" },
      { seq: 5, session: "s1", type: "ab.muted", hook: "user_prompt_submit" },
      { seq: 6, session: "s1", type: "session.end" },
    ]);
    v2Delivering(s);
    const r = classOf(s);
    expect(r.class).toBe("mixed");
    expect(r.v1.sessions[0]?.straddled).toBe(true);
    expect(r.why).toContain("two voices in one context");
  });

  test("the reverse order in one session is NOT mixed — a mute then a delivery is not a straddle", () => {
    const s = scene(3);
    v1Log(s.v1Dir, DATE, [
      { seq: 0, session: "s1", type: "ab.muted", hook: "session_start" },
      { seq: 1, session: "s1", type: "buffer.append" },
      { seq: 2, session: "s1", type: "buffer.append" },
      { seq: 3, session: "s1", type: "buffer.append" },
      { seq: 4, session: "s1", type: "wake.delivered" },
      { seq: 5, session: "s1", type: "session.end" },
    ]);
    v2Delivering(s);
    const r = classOf(s);
    expect(r.v1.sessions[0]?.straddled).toBe(false);
    expect(r.flags).not.toContain("mixed");
  });

  // ── review blocker 4: v1's `seq` restarts per hook process, `ts` does not ──
  test("MIXED is decided by the TIMESTAMP: a mute at seq 1 AFTER a delivery at seq 3", () => {
    const s = scene(3);
    // Every hook is a fresh v1 process and `seq` counts within one of them, so
    // this is the ordinary shape of a straddled session, not a contrived one:
    // the delivery hook got to 3, the later mute hook was on its first line.
    v1Log(s.v1Dir, DATE, [
      { seq: 0, ts: `${DATE}T09:00:00.000Z`, session: "s1", type: "session.start" },
      { seq: 3, ts: `${DATE}T09:01:00.000Z`, session: "s1", type: "wake.delivered" },
      { seq: 0, ts: `${DATE}T09:02:00.000Z`, session: "s1", type: "buffer.append" },
      { seq: 1, ts: `${DATE}T09:03:00.000Z`, session: "s1", type: "buffer.append" },
      { seq: 2, ts: `${DATE}T09:04:00.000Z`, session: "s1", type: "buffer.append" },
      { seq: 1, ts: `${DATE}T09:05:00.000Z`, session: "s1", type: "ab.muted", hook: "user_prompt_submit" },
      { seq: 0, ts: `${DATE}T09:06:00.000Z`, session: "s1", type: "session.end" },
    ]);
    v2Delivering(s);
    const r = classOf(s);
    expect(r.v1.sessions[0]?.straddled).toBe(true);
    expect(r.class).toBe("mixed");
  });

  test("with NO seq at all the TIMESTAMP still decides — file order does not", () => {
    const s = scene(3);
    // The discriminating case. With no `seq`, the old reader fell back to
    // `declared ?? ordinal` and compared FILE ORDER: the delivery at ordinal 1
    // and the mute at ordinal 5 read as a straddle. The clock says otherwise —
    // the mute happened at 09:05 and the delivery at 09:06 — and the clock is
    // what a hook actually stamps.
    v1LogRaw(s.v1Dir, DATE, [
      { ts: `${DATE}T09:00:00.000Z`, session: "s1", type: "session.start" },
      { ts: `${DATE}T09:06:00.000Z`, session: "s1", type: "wake.delivered" },
      { ts: `${DATE}T09:02:00.000Z`, session: "s1", type: "buffer.append" },
      { ts: `${DATE}T09:03:00.000Z`, session: "s1", type: "buffer.append" },
      { ts: `${DATE}T09:04:00.000Z`, session: "s1", type: "buffer.append" },
      { ts: `${DATE}T09:05:00.000Z`, session: "s1", type: "ab.muted", hook: "user_prompt_submit" },
      { ts: `${DATE}T09:07:00.000Z`, session: "s1", type: "session.end" },
    ]);
    v2Delivering(s);
    const r = classOf(s);
    expect(r.v1.sessions[0]?.straddled).toBe(false);
    expect(r.flags).not.toContain("mixed");
    // The ordinals really are in the order that used to fool it, so this is not
    // passing because the fixture is easy.
    expect(r.v1.sessions[0]?.firstDelivery).toBe(1);
    expect(r.v1.sessions[0]?.lastMuted).toBe(5);
    expect(r.v1.sessions[0]?.firstDeliveryAt).toBe(`${DATE}T09:06:00.000Z`);

    // And with the timestamps in the other order the SAME file IS a straddle.
    const other = scene(3);
    v1LogRaw(other.v1Dir, DATE, [
      { ts: `${DATE}T09:00:00.000Z`, session: "s1", type: "session.start" },
      { ts: `${DATE}T09:01:00.000Z`, session: "s1", type: "wake.delivered" },
      { ts: `${DATE}T09:02:00.000Z`, session: "s1", type: "buffer.append" },
      { ts: `${DATE}T09:03:00.000Z`, session: "s1", type: "buffer.append" },
      { ts: `${DATE}T09:04:00.000Z`, session: "s1", type: "buffer.append" },
      { ts: `${DATE}T09:05:00.000Z`, session: "s1", type: "ab.muted", hook: "user_prompt_submit" },
      { ts: `${DATE}T09:07:00.000Z`, session: "s1", type: "session.end" },
    ]);
    v2Delivering(other);
    expect(classOf(other).class).toBe("mixed");
  });

  test("SILENT: v1 muted at session start and v2 stood down — nobody spoke into it", () => {
    const s = scene(3);
    v1Muted(s);
    // v2 stood down instead of delivering: the state G4 cannot see by counting
    // extra voices, so it is counted by its absence. A stand-down is NOT
    // speaking, even though it is a durable row for that same session.
    buildStore(s.v2Dir, (store) => {
      for (const hook of ["session-start", "user-prompt-submit", "stop"]) {
        store.appendEvent({
          name: PRIMACY_STANDDOWN_EVENT,
          day: 0,
          payload: { hook, reason: "override-bansai", system: "v1", date: DATE, session: "s1" },
        });
      }
    });
    const r = classOf(s);
    expect(r.class).toBe("silent");
    expect(r.why).toContain("counted by its absence");
    expect(r.mute.v2StanddownByHook["session-start"]).toBe(1);
  });

  // ── review should-fix: `silent` is a PER-SESSION JOIN, not a difference ────
  test("SILENT joins BY SESSION: v2 speaking into s1 does not cover s2", () => {
    const s = scene(3);
    // Two sessions, both muted at session start; v2 delivered into s1 only.
    // The old count difference cancelled here — 2 muted minus 2 v2 rows — and
    // read zero silent sessions while s2 sat in silence the whole day.
    v1Log(s.v1Dir, DATE, [
      { seq: 0, session: "s1", type: "session.start" },
      { seq: 1, session: "s1", type: "ab.muted", hook: "session_start" },
      { seq: 2, session: "s2", type: "session.start" },
      { seq: 3, session: "s2", type: "ab.muted", hook: "session_start" },
      { seq: 4, session: "s1", type: "buffer.append" },
      { seq: 5, session: "s1", type: "buffer.append" },
      { seq: 6, session: "s1", type: "buffer.append" },
      { seq: 7, session: "s1", type: "session.end" },
    ]);
    v2Delivering(s, ["session-start", "stop"], "s1");
    const r = classOf(s);
    expect(r.class).toBe("silent");
    expect(r.why).toContain("1 of them carry NO v2 delivery record");
    expect(r.why).toContain("PER-SESSION JOIN");
  });

  test("v1's session id and v2's input.sessionId are the SAME host id — the join lands", () => {
    const s = scene(3);
    // The assumption the join rests on, pinned: one id, stamped by the host,
    // written by both systems. If a host upgrade ever splits them, this goes
    // red rather than the `silent` count going quietly wrong.
    const HOST_SESSION = "0c9a51f2-host-session";
    v1Log(s.v1Dir, DATE, [
      { seq: 0, session: HOST_SESSION, type: "session.start" },
      { seq: 1, session: HOST_SESSION, type: "ab.muted", hook: "session_start" },
      { seq: 2, session: HOST_SESSION, type: "buffer.append" },
      { seq: 3, session: HOST_SESSION, type: "buffer.append" },
      { seq: 4, session: HOST_SESSION, type: "buffer.append" },
      { seq: 5, session: HOST_SESSION, type: "session.end" },
    ]);
    v2Delivering(s, ["session-start", "stop"], HOST_SESSION);
    expect(classOf(s).flags).not.toContain("silent");
  });

  test("change ONLY v2's session id and the same day reads SILENT", () => {
    const s = scene(3);
    // The other half of the assumption above: the join is what makes the day
    // read `active`, so a mismatched id must break it. Without this the test
    // above could pass on a class that never fires.
    const HOST_SESSION = "0c9a51f2-host-session";
    v1Log(s.v1Dir, DATE, [
      { seq: 0, session: HOST_SESSION, type: "session.start" },
      { seq: 1, session: HOST_SESSION, type: "ab.muted", hook: "session_start" },
      { seq: 2, session: HOST_SESSION, type: "buffer.append" },
      { seq: 3, session: HOST_SESSION, type: "buffer.append" },
      { seq: 4, session: HOST_SESSION, type: "buffer.append" },
      { seq: 5, session: HOST_SESSION, type: "session.end" },
    ]);
    v2Delivering(s, ["session-start", "stop"], "a-different-id");
    expect(classOf(s).class).toBe("silent");
  });

  test("a v2 payload with NO session id makes the join UNAVAILABLE, never silent", () => {
    const s = scene(3);
    v1Muted(s);
    // The short payload shape: rows for the date, none carrying a session.
    // Declaring silence from it would invent the evidence the class rests on.
    buildStore(s.v2Dir, (store) => {
      for (const hook of ["session-start", "stop"]) {
        store.appendEvent({
          name: PRIMACY_DELIVER_EVENT,
          day: 0,
          payload: { hook, reason: "override-engram", system: "v2", date: DATE },
        });
      }
    });
    const r = classOf(s);
    expect(r.flags).not.toContain("silent");
    expect(r.why).toContain("silent-session join was UNAVAILABLE");
  });

  test("WORKER rows carry no session BY DESIGN, and do not make the join unavailable (G47(b))", () => {
    const s = scene(3);
    v1Muted(s);
    // A day whose only v2 rows are the worker's: the sweep gate, the cycle and
    // the wake render. None of them carries a session id, and none of them ever
    // could — they are not per-session records. Counting them as "rows for this
    // date with no session" made `joinAvailable` false, and the silent-session
    // class went unmeasured on exactly the days v2 was quietest.
    buildStore(s.v2Dir, (store) => {
      store.appendEvent({
        name: "sweep.gate",
        day: 0,
        payload: { reason: "ran", scopes: 2, ran: 0, date: DATE },
      });
      store.appendEvent({
        name: "sleep.cycle",
        day: 0,
        payload: { reason: "ran", failed: 0, phases: [], date: DATE },
      });
      store.appendEvent({ name: "self.briefing", day: 0, payload: { bytes: 10, date: DATE } });
    });

    const r = classOf(s);
    // The muted v1 session got no v2 delivery, and that IS knowable here.
    expect(r.class).toBe("silent");
    expect(r.why).not.toContain("silent-session join was UNAVAILABLE");
    // The three rows are still counted; what changed is which of them the join's
    // availability is asked about.
    expect(r.v2.sessionBearingRowsForDate).toBe(0);
    expect(Object.keys(r.v2.bySessionForDate).length).toBe(0);
  });

  test("the unavailable-join NOTE counts ROWS, not counters — a reason split must not double one", () => {
    const s = scene(3);
    v1Muted(s);
    buildStore(s.v2Dir, (store) => {
      // The same session-less shape as the test above, so the join is
      // unavailable and the note fires at all.
      for (const hook of ["session-start", "stop"]) {
        store.appendEvent({
          name: PRIMACY_DELIVER_EVENT,
          day: 0,
          payload: { hook, reason: "override-engram", system: "v2", date: DATE },
        });
      }
      // Plus three sweep rows, two of them carrying the reason the reader
      // splits on. FIVE rows landed on this date; `byNameForDate` holds seven
      // VALUES over them, and a note saying "7 v2 row(s)" would be a count of
      // counters dressed as a count of evidence.
      for (const reason of ["ran", "no-credential", "no-credential"]) {
        store.appendEvent({
          name: "sweep.gate",
          day: 0,
          payload: { reason, scopes: 0, ran: 0, date: DATE },
        });
      }
    });
    const r = classOf(s);
    expect(r.why).toContain("5 v2 row(s) for this date");
    expect(r.why).not.toContain("7 v2 row(s)");
    // And the split itself is still there to be read, beside the total.
    expect(r.v2.byNameForDate["sweep.gate"]).toBe(3);
    expect(r.v2.byNameForDate["sweep.gate:no-credential"]).toBe(2);
  });

  test("v2's BOUNDARY evidence is the stop hook only — a session-start deliver is not one", () => {
    const s = scene(3);
    v1Muted(s);
    // `sessionEnd` and `pre-compaction` never call `deliveryVerdict`, so `stop`
    // is the only boundary hook that writes a durable primacy record.
    v2Delivering(s, ["session-start"]);
    expect(classOf(s).flags).toContain("thin");
    v2Delivering(s, ["stop"]);
    expect(classOf(s).flags).not.toContain("thin");
  });

  // ── review should-fix: an ABSENT v1 log is not a silent v1 ──────────────
  test("v1's detectors read NULL when the day's log is absent, never {0,0,0}", () => {
    const s = scene(3);
    // No v1 log for the date at all — v1 keeps 30 days, and this run may
    // outlive that. `{0,0,0}` would read as positive evidence the muted side
    // stayed muted, which is the one thing an unread log cannot show.
    v2Delivering(s);
    const r = classOf(s);
    expect(r.v1.present).toBe(false);
    expect(r.contamination.v1).toEqual({ wake: null, recall: null, ritual: null });
    expect(r.flags).not.toContain("contaminated");
    expect(r.class).not.toBe("active");

    // With a log present the same channels are real numbers again.
    v1Muted(s);
    expect(classOf(s).contamination.v1).toEqual({ wake: 0, recall: 0, ritual: 0 });
  });

  test("v1's wake channel counts DELIVERIES only — the runner's renders never sum into it", () => {
    // A muted v1 whose runner rendered its wake file three times and whose
    // session-start delivered once: one delivery, not four events, not three.
    const s = scene(3);
    v1Muted(s, [
      { seq: 20, session: "runner", type: "wake.rendered" },
      { seq: 21, session: "runner", type: "wake.rendered" },
      { seq: 22, session: "runner", type: "wake.rendered" },
      { seq: 23, session: "s1", type: "wake.delivered" },
    ]);
    v2Delivering(s);
    const r = classOf(s);
    expect(r.contamination.v1.wake).toBe(1);
    expect(r.class).toBe("contaminated");
  });
  test("every matching class is kept in `flags`, and the winner is by stated precedence", () => {
    const s = scene(3);
    // A straddled session AND a muted-side wake: both true, mixed wins.
    v1Log(s.v1Dir, DATE, [
      { seq: 0, session: "s1", type: "session.start" },
      { seq: 1, session: "s1", type: "wake.delivered" },
      { seq: 2, session: "s1", type: "buffer.append" },
      { seq: 3, session: "s1", type: "buffer.append" },
      { seq: 4, session: "s1", type: "buffer.append" },
      { seq: 5, session: "s1", type: "ab.muted", hook: "user_prompt_submit" },
      { seq: 6, session: "s1", type: "session.end" },
    ]);
    v2Delivering(s);
    const r = classOf(s);
    expect(r.class).toBe("mixed");
    expect([...r.flags].sort()).toEqual(["contaminated", "mixed"]);
  });

  test("the v2-side contamination channels are COUNTED out of box 2 — the four delivery records are durable", () => {
    const s = scene(3);
    v1Muted(s);
    v2Delivering(s);
    buildStore(s.v2Dir, (store) => {
      store.appendEvent({
        name: "adapter.wake.injected",
        day: 0,
        payload: { ok: true, reason: "ok", bytes: 1200, budget: 9000, sentinel: true, date: DATE, session: "s1" },
      });
      store.appendEvent({
        name: "adapter.recall",
        day: 0,
        payload: { reason: "ok", surfaced: 2, footnotes: 0, bytes: 700, budget: 9000, observer: false, date: DATE, session: "s1" },
      });
    });
    const r = classOf(s);
    // Phase P, v2 primary: delivery is the job, so these are counts, not contamination.
    expect(r.contamination.v2).toEqual({ wake: 1, recall: 1, ritual: 0 });
    expect(r.class).toBe("active");
    // What is still recomputed rather than stored stays named, never a zero.
    expect(r.v2.nonDurable).toContain("sleep.symmetry");
    expect(r.v2.nonDurable).not.toContain("adapter.wake.injected");
  });

  test("the daily REFUSES a missing v1 wake path as its only probe (delta N4)", () => {
    const s = scene(3);
    v1Muted(s);
    v2Delivering(s);
    const missing = join(s.v1Dir, "render", "wake.md");
    expect(() => classOf(s, { v1Ritual: [], v1WakeFile: missing })).toThrow(/NO_V1_CROSS_ENCODING_PROBE/);
  });

  test("a day whose only v2 boundary evidence is a durable `adapter.boundary` row still counts as reached", () => {
    const build = (withBoundaryRow: boolean): ReturnType<typeof classOf> => {
      const s = scene(3);
      v1Log(s.v1Dir, DATE, [
        { seq: 0, session: "s1", type: "session.start" },
        { seq: 1, session: "s1", type: "wake.delivered" },
        { seq: 2, session: "s1", type: "buffer.append" },
        { seq: 3, session: "s1", type: "buffer.append" },
        { seq: 4, session: "s1", type: "buffer.append" },
        { seq: 5, session: "s1", type: "session.end" },
      ]);
      buildStore(s.v2Dir, (store) => {
        for (const hook of ["session-start", "user-prompt-submit"]) {
          store.appendEvent({
            name: PRIMACY_STANDDOWN_EVENT,
            day: 0,
            payload: { hook, reason: "override-bansai", system: "v1", date: DATE, session: "s1" },
          });
        }
        if (withBoundaryRow) {
          store.appendEvent({
            name: "adapter.boundary",
            day: 0,
            payload: { hook: "session-end", kind: "session-end", captured: true, spans: 3, date: DATE, session: "s1" },
          });
        }
      });
      return classOf(s, { phase: "0", primacy: "v1" });
    };
    // The session ended through `session-end` only: no `stop`, so no primacy
    // row and no episode ask — the boundary row is the evidence. Control first:
    // the scene's store is reused by name, so the row must be added last.
    expect(build(false).class).toBe("thin");
    expect(build(true).class).toBe("active");
  });

  test("CONTAMINATED before the flip: a muted v2 that injected a wake is caught by its own durable row", () => {
    const s = scene(3);
    // v1 primary and delivering normally; v2 stood down at every hook — except
    // that one wake bundle went out. The primacy stand-down rows say "muted";
    // the delivery row says otherwise, and the row wins (scar §2.4: a
    // stood-down instrument must be distinguishable from a revived one).
    v1Log(s.v1Dir, DATE, [
      { seq: 0, session: "s1", type: "session.start" },
      { seq: 1, session: "s1", type: "wake.delivered" },
      { seq: 2, session: "s1", type: "buffer.append" },
      { seq: 3, session: "s1", type: "buffer.append" },
      { seq: 4, session: "s1", type: "buffer.append" },
      { seq: 5, session: "s1", type: "session.end" },
    ]);
    buildStore(s.v2Dir, (store) => {
      for (const hook of ["session-start", "user-prompt-submit", "stop"]) {
        store.appendEvent({
          name: PRIMACY_STANDDOWN_EVENT,
          day: 0,
          payload: { hook, reason: "override-bansai", system: "v1", date: DATE, session: "s1" },
        });
      }
      store.appendEvent({
        name: "adapter.wake.injected",
        day: 0,
        payload: { ok: true, reason: "ok", bytes: 900, budget: 9000, sentinel: true, date: DATE, session: "s1" },
      });
    });
    const r = classOf(s, { phase: "0", primacy: "v1" });
    expect(r.class).toBe("contaminated");
    expect(r.contamination.v2.wake).toBe(1);
    expect(r.contamination.v1.wake).toBe(1); // v1 delivering is its job before the flip
  });

  test("the day's v1 DETECTOR lines are copied into the run directory, and nothing else is", () => {
    const s = scene(3);
    v1Muted(s, [{ seq: 8, session: "s1", type: "embed.refresh" }]);
    v2Delivering(s);
    const artifacts = dailyRecord({
      runDir: s.runDir,
      date: DATE,
      v1Dir: s.v1Dir,
      v2DataDir: s.v2Dir,
      v1Ritual: [V1_RITUAL],
      phase: "P",
      primacy: "v2",
    });
    const copy = artifacts.files[`v1-log-copies/events-${DATE}.jsonl`];
    expect(copy).toBeDefined();
    expect(copy).toContain("ab.muted");
    expect(copy).toContain("buffer.append");
    // `embed.refresh` is not a detector: G2's evidence is the detectors, not the log.
    expect(copy).not.toContain("embed.refresh");
  });

  test("run.json accumulates the day classes, the active count and both config hashes", () => {
    const s = scene(3);
    v1Muted(s);
    v2Delivering(s);
    const configPath = at("config", "adapter.json");
    writeJson(configPath, { parallel: { enabled: true } });
    const assignPath = at("ab", "assignment.json");
    writeJson(assignPath, { override: "engram" });

    const artifacts = dailyRecord({
      runDir: s.runDir,
      date: DATE,
      v1Dir: s.v1Dir,
      v2DataDir: s.v2Dir,
      v1Ritual: [V1_RITUAL],
      phase: "P",
      primacy: "v2",
      v2ConfigPath: configPath,
      assignmentPath: assignPath,
      seat: "claude-opus-5",
      vectors: "voyage-3-large",
      startDate: "2026-09-01",
    });
    expect(artifacts.run.activeDays["P"]).toBe(1);
    expect(artifacts.run.days).toEqual([{ date: DATE, class: "active", phase: "P" }]);
    expect(artifacts.run.seat).toBe("claude-opus-5");
    expect(artifacts.run.vectors).toBe("voyage-3-large");
    expect(artifacts.run.configHashes.v2Config).toMatch(/^[0-9a-f]{64}$/);
    expect(artifacts.run.configHashes.assignment).toMatch(/^[0-9a-f]{64}$/);
    expect(artifacts.run.startDate).toBe("2026-09-01");
  });

  // ── review blocker 5: activeDays is PER PHASE, and every day says which ───
  test("an active day 0 then 3 active P days reads activeDays {0: 1, P: 3} — and no S", () => {
    const s = scene(3);
    const dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"];
    // Day 0 is before the flip: v1 delivers and v2 stands down. The flip
    // happens at the end of that day, and from day 1 it is inverted — the
    // single-phase shape (RULED 2026-09-03). Every day is otherwise identical.
    for (const [i, date] of dates.entries()) {
      const phase = i < 1 ? ("0" as const) : ("P" as const);
      const primacy = i < 1 ? ("v1" as const) : ("v2" as const);
      v1Log(s.v1Dir, date, [
        { seq: 0, session: `s${i}`, type: "session.start" },
        ...(phase === "P"
          ? [{ seq: 1, session: `s${i}`, type: "ab.muted", hook: "session_start" } as V1Ev]
          : []),
        { seq: 2, session: `s${i}`, type: "buffer.append" },
        { seq: 3, session: `s${i}`, type: "buffer.append" },
        { seq: 4, session: `s${i}`, type: "buffer.append" },
        { seq: 5, session: `s${i}`, type: "session.end" },
      ]);
      buildStore(s.v2Dir, (store) => {
        for (const hook of ["session-start", "stop"]) {
          store.appendEvent({
            name: phase === "P" ? PRIMACY_DELIVER_EVENT : PRIMACY_STANDDOWN_EVENT,
            day: 0,
            payload: {
              hook,
              reason: phase === "P" ? "override-engram" : "override-bansai",
              system: phase === "P" ? "v2" : "v1",
              date,
              session: `s${i}`,
            },
          });
        }
      });
      const artifacts = dailyRecord({
        runDir: s.runDir,
        date,
        v1Dir: s.v1Dir,
        v2DataDir: s.v2Dir,
      v1Ritual: [V1_RITUAL],
        phase,
        primacy,
      });
      expect(artifacts.record.class).toBe("active");
      RunDir.open(s.runDir, NO_STORES).writeJson("run.json", artifacts.run);
    }

    const run = readRunRecord(s.runDir);
    // The old line counted EVERY active day in the run into the running phase,
    // so P would have read 4 on its first day and cleared a 7-day minimum four
    // days early.
    expect(run?.activeDays).toEqual({ "0": 1, P: 3 });
    expect(run?.days.map((d) => d.phase)).toEqual(["0", "P", "P", "P"]);
    // There is no shadow phase to count: the key does not exist at all.
    expect(Object.keys(run?.activeDays ?? {})).toEqual(["0", "P"]);
  });

  // ── review blocker 9, the record's half: a poisoned read is never active ──
  test("a v2 READ ERROR poisons the detectors to null and the day is UNREADABLE", () => {
    const s = scene(3);
    v1Muted(s);
    // A store file the reader can open but not read past `meta`.
    const db = new Database(join(s.v2Dir, "operational.sqlite"), { create: true });
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
    db.close();

    const r = classOf(s);
    expect(r.v2.readErrors.length).toBeGreaterThan(0);
    expect(r.contamination.v2).toEqual({ wake: null, recall: null, ritual: null });
    expect(r.class).toBe("unreadable");
    expect(r.class).not.toBe("active");
    expect(r.why).toContain("A read that failed is not a day that was quiet");
  });

  test("a TRUNCATED event read is the same refusal — every count under it is a floor", () => {
    const s = scene(3);
    v1Muted(s);
    v2Delivering(s);
    const capped = dailyRecord({
      runDir: s.runDir,
      date: DATE,
      v1Dir: s.v1Dir,
      v2DataDir: s.v2Dir,
      v1Ritual: [V1_RITUAL],
      phase: "P",
      primacy: "v2",
      eventLimit: 1,
    }).record;
    expect(capped.v2.truncated).toBe(true);
    expect(capped.contamination.v2.wake).toBeNull();
    expect(capped.class).toBe("unreadable");

    // Uncapped, the very same day is active — so the class above is the cap
    // talking, not the fixture.
    expect(classOf(s).class).toBe("active");
  });

  // ── review blocker 7d: the daily record REFUSES to run unmetered ─────────
  test("no v1 probe is a NAMED REFUSAL, not a silent zero in the v1→v2 direction", () => {
    const s = scene(3);
    v1Muted(s);
    v2Delivering(s);
    expect(() =>
      dailyRecord({
        runDir: s.runDir,
        date: DATE,
        v1Dir: s.v1Dir,
        v2DataDir: s.v2Dir,
        phase: "P",
        primacy: "v2",
      }),
    ).toThrow(/NO_V1_CROSS_ENCODING_PROBE/);
    // A wake file alone is a probe too — either channel satisfies it.
    const wake = at("wake", "v1-wake.txt");
    writeFileSync(wake, "The standing bundle, rendered for this session.\n", "utf8");
    expect(classOf(s, { v1Ritual: [], v1WakeFile: wake }).crossEncoding.v1IntoV2.measured).toBe(true);
  });

  // ── review should-fix: bars.json is REQUIRED, never defaulted ────────────
  test("a run directory with NO bars.json refuses to record a day", () => {
    const runDir = dir("run-no-bars");
    expect(() =>
      dailyRecord({
        runDir,
        date: DATE,
        v1Dir: dir("v1"),
        v2DataDir: dir("v2"),
        phase: "0",
        primacy: "v1",
        v1Ritual: [V1_RITUAL],
      }),
    ).toThrow(/BARS_NOT_COMMITTED/);
    // `activeDayTurnFloor: 0` was the fabricated default, under which EVERY
    // lived day clears the floor and the active-day count means nothing.
    writeJson(join(runDir, "bars.json"), { ...BARS(3), crossEncodingMinLineChars: undefined });
    expect(() =>
      dailyRecord({
        runDir,
        date: DATE,
        v1Dir: dir("v1"),
        v2DataDir: dir("v2"),
        phase: "0",
        primacy: "v1",
        v1Ritual: [V1_RITUAL],
      }),
    ).toThrow(/BARS_NOT_COMMITTED/);
  });

  // ── review should-fix: the operator's --primacy against the FILE ─────────
  test("a --primacy that disagrees with the assignment file is FATAL", () => {
    const s = scene(3);
    v1Muted(s);
    v2Delivering(s);
    // The file is what both resolvers read at every hook. Recording a day
    // stamped with the operator's belief instead would misattribute every
    // contamination verdict on it (§5 G3).
    expect(() => classOf(s, { assignmentOverride: "bansai" })).toThrow(
      /PRIMACY_DISAGREES_WITH_ASSIGNMENT/,
    );
    expect(() => classOf(s, { assignmentOverride: "none" })).toThrow(
      /PRIMACY_DISAGREES_WITH_ASSIGNMENT/,
    );
    // Agreement records normally.
    expect(classOf(s, { assignmentOverride: "engram" }).primacy).toBe("v2");
  });

  test("the tally is created-versus-exited, per kind, per system, with its caveat named", () => {
    const s = scene(3);
    v1Muted(s, [
      { seq: 8, type: "store.write" },
      { seq: 9, type: "store.write" },
      { seq: 10, type: "decay.expire" },
    ]);
    buildStore(s.v2Dir, (store) => {
      store.put({ type: "memory", kind: "fact", body: "born today", learnedOn: DATE, source: "authored" });
      store.appendEvent({
        name: PRIMACY_DELIVER_EVENT,
        day: 0,
        payload: { hook: "stop", reason: "override-engram", system: "v2", date: DATE },
      });
    });
    const r = classOf(s);
    expect(r.tally.v1).toMatchObject({ created: 2, exited: 1, attributable: true });
    expect(r.tally.v1.note).toContain("UPPER BOUND");
    // v2's exits are the durable `memory.pruned`/`memory.merged` rows, which
    // carry only the store's LIVED day — with no `--lived-day` there is nothing
    // to attribute them to, so this is NULL and says why (review blocker 8).
    expect(r.tally.v2).toMatchObject({ created: 1, exited: null });
    expect(r.tally.v2.note).toContain("not-exercised");
    expect(r.tally.v2.byKind).toEqual({ fact: 1 });

    // Hand it the lived day and the same day reads a real number instead.
    const withDay = classOf(s, { livedDay: 0 });
    expect(withDay.tally.v2.exited).toBe(0);
    expect(withDay.tally.v2.note).toContain("memory.pruned");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The preflight
// ═══════════════════════════════════════════════════════════════════════════

interface Fixture {
  runDir: string;
  v1Dir: string;
  v2Dir: string;
  engramDir: string;
  configPath: string;
  replayOut: string;
  transcripts: string;
  abDir: string;
}

function fixture(): Fixture {
  const runDir = dir("run");
  const v1Dir = dir("v1");
  const v2Dir = dir("v2");
  const engramDir = dir("engram");
  const abDir = dir("ab");
  const transcripts = dir("transcripts");
  const replayOut = dir("replay-out");

  writeJson(join(abDir, "assignment.json"), {
    mode: "alternate-day",
    anchor: "2026-07-17",
    override: "bansai",
  });

  const configPath = at("config", "adapter.json");
  const credentialsPath = join(runDir, "..", "credentials.env");
  writeFileSync(credentialsPath, "ANTHROPIC_API_KEY=test-key-not-a-real-credential\nVOYAGE_API_KEY=test-voyage-not-a-real-credential\n", "utf8");
  writeJson(configPath, {
    credentialsFile: credentialsPath,
    dataDir: v2Dir,
    parallel: { enabled: true },
    injectionBudgetBytes: 9_000,
    models: { interpret: { id: "claude-opus-5" }, embed: { id: "voyage-3-large" } },
  });

  writeJson(join(runDir, "bars.json"), BARS(3));
  writeJson(join(runDir, "pricing.json"), {
    approvedBy: "owner",
    approvedAt: "2026-09-03",
    marginalSpend: "v2 embeddings plus crash-fallback sweeps; the authored dump rides session context",
  });
  // A REAL `--apply` into THIS run's v2 data dir. A dry-run report carries the
  // same `source_readonly.identical` — of course it does, it wrote nothing —
  // so mode and target are what make it evidence (`tools/migrate/types.ts`).
  writeJson(join(runDir, "migration-report.json"), {
    mode: "apply",
    source: join(root, "v1"),
    target: v2Dir,
    source_readonly: { files: 12, identical: true, changed: [] },
  });
  writeJson(join(replayOut, "pass-record.json"), {
    runId: "replay-sample-5d",
    readOnlyProof: true,
    totalityOk: true,
    sample: true,
    counts: { pass: 31, fail: 0, "needs-rater": 2, "not-exercised": 23, watch: 0 },
    verdicts: record().verdicts,
  });
  // THE DAY-0 SEQUENCE, COMPLETE — preconditions 8 and 9 bind at phase 0 now
  // that there is no shadow phase to defer them past (RULED 2026-09-03), and
  // what makes them measurable is the order of that sequence: the throwaway
  // session in which v2 DELIVERED (its ask observed, its first surfacing
  // decisions durable), then the day-0 daily run that writes G12's baseline
  // hash into run.json, and only then this preflight.
  writeJson(join(runDir, "ask-channel.json"), {
    observedAt: "2026-09-04",
    channel: "stdout",
    exitCode: 0,
    session: "throwaway-1",
  });
  writeJson(join(runDir, "run.json"), {
    startDate: "2026-09-04",
    phase: "0",
    primacy: "v1",
    activeDays: { "0": 0, P: 0 },
    days: [],
    configHashes: { v2Config: null, assignment: null },
    seat: "",
    vectors: "",
    surfaceSet: surfaceSetHash(),
    updatedAt: "2026-09-04T11:00:00.000Z",
  });

  // A clean transcript with a measurable, parallel hook model — and v1's wake
  // arriving the way the host actually routes it, as an attachment with no
  // message role. That entry is what makes the canary a MEASUREMENT: without a
  // single v1 marker anywhere the scan proves nothing and reads not-exercised.
  writeFileSync(
    join(transcripts, "session.jsonl"),
    [
      JSON.stringify({ message: { role: "user", content: "Nothing foreign in here." } }),
      JSON.stringify({
        type: "attachment",
        content: "<bansai-memory>\nthe standing bundle\n</bansai-memory>",
      }),
      JSON.stringify({
        type: "attachment",
        timestamp: "2026-09-04T09:00:01.000Z",
        attachment: { type: "hook_success", hookEvent: "SessionEnd", hookName: "bansai", durationMs: 400 },
      }),
      JSON.stringify({
        type: "attachment",
        timestamp: "2026-09-04T09:00:01.050Z",
        attachment: { type: "hook_success", hookEvent: "SessionEnd", hookName: "counterparts", durationMs: 400 },
      }),
    ].join("\n"),
    "utf8",
  );

  buildStore(v2Dir, (s) => {
    s.put({ type: "memory", kind: "self", body: "A synthetic standing self note.", source: "authored" });
    s.put({ type: "memory", kind: "fact", body: "A synthetic migrated fact.", source: "migrated" });
    // The throwaway session's durable surfacing decision (precondition 9): v2
    // writes one only on a turn it DELIVERED, since the primacy stand-down
    // precedes `recallForTurn` — so this row is evidence that the session
    // happened, not decoration.
    s.appendEvent({ name: "recall.decision", day: 0, payload: { surfaced: 2 } });
  });

  return { runDir, v1Dir, v2Dir, engramDir, configPath, replayOut, transcripts, abDir };
}

function preflight(f: Fixture, over: Partial<Parameters<typeof runPreflight>[0]> = {}) {
  return runPreflight({
    runDir: f.runDir,
    v1Dir: f.v1Dir,
    v2DataDir: f.v2Dir,
    v2ConfigPath: f.configPath,
    engramDir: f.engramDir,
    replayOut: f.replayOut,
    transcripts: [f.transcripts],
    envs: [
      { name: "v1-hooks", abDir: f.abDir },
      { name: "v2-hooks", abDir: f.abDir },
    ],
    today: "2026-09-04",
    at: "2026-09-04T12:00:00.000Z",
    ...over,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// The primacy guard — §5 G3, and the 2026-09-03 flip's own scar
// ═══════════════════════════════════════════════════════════════════════════

describe("the primacy guard — a stale run.json never grades a day", () => {
  const DATE = "2026-09-04";
  const V1_RITUAL = "What did you learn in this session that is worth keeping?";

  interface Guard {
    runDir: string;
    v1Dir: string;
    v2Dir: string;
    abDir: string;
    engramDir: string;
  }

  /** A v2-primary day: v1 muted and alive, v2 delivering, override `engram`. */
  function guard(): Guard {
    const runDir = dir("run");
    writeJson(join(runDir, "bars.json"), BARS(3));
    const g: Guard = {
      runDir,
      v1Dir: dir("v1"),
      v2Dir: dir("v2"),
      abDir: dir("ab"),
      engramDir: dir("engram"),
    };
    writeJson(join(g.abDir, "assignment.json"), {
      mode: "alternate-day",
      anchor: "2026-07-17",
      override: "engram",
    });
    v1Log(g.v1Dir, DATE, [
      { seq: 0, session: "s1", type: "session.start" },
      { seq: 1, session: "s1", type: "ab.muted", hook: "session_start" },
      { seq: 2, session: "s1", type: "buffer.append" },
      { seq: 3, session: "s1", type: "ab.muted", hook: "user_prompt_submit" },
      { seq: 4, session: "s1", type: "buffer.append" },
      { seq: 5, session: "s1", type: "buffer.append" },
    ]);
    buildStore(g.v2Dir, (store) => {
      for (const hook of ["session-start", "user-prompt-submit", "stop"]) {
        store.appendEvent({
          name: PRIMACY_DELIVER_EVENT,
          day: 0,
          payload: { hook, reason: "override-engram", system: "v2", date: DATE, session: "s1" },
        });
      }
    });
    return g;
  }

  /** The run record the flip left behind: days recorded, primacy never moved. */
  function staleRunJson(g: Guard): void {
    writeJson(join(g.runDir, "run.json"), {
      startDate: "2026-09-03",
      phase: "P",
      primacy: "v1",
      activeDays: { "0": 1, P: 0 },
      days: [{ date: "2026-09-03", class: "active", phase: "0" }],
      configHashes: { v2Config: null, assignment: null },
      seat: "",
      vectors: "",
      surfaceSet: surfaceSetHash(),
      updatedAt: "2026-09-03T23:00:00.000Z",
    });
  }

  function daily(g: Guard, over: Partial<Parameters<typeof dailyRecord>[0]> = {}) {
    return dailyRecord({
      runDir: g.runDir,
      date: DATE,
      v1Dir: g.v1Dir,
      v2DataDir: g.v2Dir,
      v1Ritual: [V1_RITUAL],
      assignmentOverride: primacyFromAssignment(join(g.abDir, "assignment.json")),
      ...over,
    });
  }

  test("THE 2026-09-03 DEFECT: run.json says v1, the file says engram — REFUSED, not graded", () => {
    const g = guard();
    staleRunJson(g);
    // Without the guard this records a v2-primary day as `contaminated`
    // ("the muted v2 side delivered") every single day, off a field nobody
    // compared against the file both resolvers read.
    let thrown: { code?: string; detail?: Record<string, string> } | null = null;
    try {
      daily(g, { phase: "P" });
    } catch (err) {
      thrown = err as { code?: string; detail?: Record<string, string> };
    }
    expect(thrown?.code).toBe("RUN_PRIMACY_DISAGREES_WITH_ASSIGNMENT");
    // It says WHICH of the two to fix, and how — both readings, by name.
    expect(thrown?.detail?.["runJson"]).toBe("v1");
    expect(thrown?.detail?.["assignmentOverride"]).toBe("engram");
    expect(thrown?.detail?.["resolved"]).toBe("v2");
    expect(thrown?.detail?.["remedy"]).toContain("--primacy v2");
  });

  test("a --primacy that AGREES with the file heals the stale field, and the record says so", () => {
    const g = guard();
    staleRunJson(g);
    const artifacts = daily(g, { phase: "P", primacy: "v2" });
    expect(artifacts.record.class).toBe("active");
    expect(artifacts.run.primacy).toBe("v2");
    expect(artifacts.record.primacyCheck.verified).toBe(true);
    expect(artifacts.record.primacyCheck.note).toContain("RE-STAMPED");
    // And the day is NOT contaminated: it was the stale field, never v2.
    expect(artifacts.record.flags).not.toContain("contaminated");
  });

  test("a --primacy that disagrees with the file is refused, naming the FLAG", () => {
    const g = guard();
    let thrown: { code?: string; detail?: Record<string, string> } | null = null;
    try {
      daily(g, { phase: "P", primacy: "v1" });
    } catch (err) {
      thrown = err as { code?: string; detail?: Record<string, string> };
    }
    expect(thrown?.code).toBe("PRIMACY_DISAGREES_WITH_ASSIGNMENT");
    expect(thrown?.detail?.["source"]).toBe("--primacy");
  });

  test("the PHASE DEFAULT is not exempt either: no flag, no run.json, and a file that disagrees", () => {
    const g = guard();
    writeJson(join(g.abDir, "assignment.json"), { mode: "alternate-day", override: "bansai" });
    let thrown: { code?: string; detail?: Record<string, string> } | null = null;
    try {
      // `--phase P` alone resolves primacy v2; the file says v1.
      daily(g, { phase: "P" });
    } catch (err) {
      thrown = err as { code?: string; detail?: Record<string, string> };
    }
    expect(thrown?.code).toBe("PRIMACY_DISAGREES_WITH_ASSIGNMENT");
    expect(thrown?.detail?.["source"]).toBe("phase default");
  });

  test("an override that is neither `bansai` nor `engram` is refused, never mapped to a default", () => {
    const g = guard();
    writeJson(join(g.abDir, "assignment.json"), { mode: "alternate-day", override: "none" });
    expect(() => daily(g, { phase: "P", primacy: "v2" })).toThrow(
      /PRIMACY_DISAGREES_WITH_ASSIGNMENT/,
    );
  });

  test("with no assignment reading at all the record says UNVERIFIED — never a silent pass", () => {
    const g = guard();
    const r = daily(g, { phase: "P", primacy: "v2", assignmentOverride: undefined }).record;
    expect(r.primacyCheck.verified).toBe(false);
    expect(r.primacyCheck.assignmentOverride).toBeNull();
    expect(r.primacyCheck.note).toContain("NOT cross-checked");
  });

  test("a missing assignment file reads UNVERIFIED with its reason, and does not fabricate an override", () => {
    const g = guard();
    const reading = primacyReading(join(root, "no-such-ab-dir"));
    expect(reading.override).toBeNull();
    expect(reading.healthy).toBe(false);
    expect(reading.reason).toBe("file-missing");
    const r = daily(g, { phase: "P", primacy: "v2", assignmentOverride: reading.override }).record;
    expect(r.primacyCheck.verified).toBe(false);
  });

  // ── the BIN's half: the guard is not opt-in, and a refusal is exit 2 ──────
  //
  // The measured defect was the bin's DEFAULT path — the daily command in
  // PARALLEL-RUN-STATUS passes no `--assignment`, so the cross-check that
  // exists to catch exactly this never ran. Exit codes only exist at the bin,
  // so this one test spawns it.
  test("the daily BIN reads the assignment DIRECTORY by default: exit 2, named, nothing recorded", () => {
    const g = guard();
    staleRunJson(g);
    const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "tools", "parallel", "bin", "daily.ts");
    const ritual = at("probe", "ritual.txt");
    writeFileSync(ritual, `${V1_RITUAL}\n`, "utf8");
    const args = [
      bin,
      "--run-dir", g.runDir,
      "--date", DATE,
      "--phase", "P",
      "--v1-dir", g.v1Dir,
      "--v2-data-dir", g.v2Dir,
      "--engram-dir", g.engramDir,
      "--ab-dir", g.abDir,
      "--v1-ritual", ritual,
    ];
    const refused = spawnSync(process.execPath, args, { encoding: "utf8" });
    expect(`${refused.status}: ${refused.stderr}`).toContain("RUN_PRIMACY_DISAGREES_WITH_ASSIGNMENT");
    expect(refused.status).toBe(2);
    // A refusal RECORDS NOTHING: the day file was never written.
    expect(existsSync(join(g.runDir, "days", `${DATE}.json`))).toBe(false);

    // And with the deliberate re-stamp the same command line runs clean — so
    // the refusal is the guard working, not the tool broken.
    const healed = spawnSync(process.execPath, [...args, "--primacy", "v2"], { encoding: "utf8" });
    expect(`${healed.status}: ${healed.stderr}`).not.toContain("REFUSED");
    expect(healed.status).toBe(0);
    expect(healed.stdout).toContain("ACTIVE");
    expect(healed.stdout).toContain("muted-consistent");
    // The fifth watch prints its own line, value and reason, like the other
    // four — a detector added to the reader that the daily never printed would
    // be a reading nobody takes (§5 G13).
    expect(healed.stdout).toContain("memory.reinforced");
    expect(existsSync(join(g.runDir, "days", `${DATE}.json`))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The phase clock, restarted — §5 G12's carry-forward rule, as a command
// ═══════════════════════════════════════════════════════════════════════════

describe("restarting the phase clock", () => {
  interface Run {
    runDir: string;
    v1Dir: string;
  }

  function runWithDays(days: readonly { date: string; class: string; phase: string }[]): Run {
    const runDir = dir("run");
    writeJson(join(runDir, "bars.json"), BARS(3));
    writeJson(join(runDir, "run.json"), {
      startDate: "2026-09-03",
      phase: "P",
      primacy: "v2",
      activeDays: { "0": 1, P: days.filter((d) => d.class === "active" && d.phase === "P").length },
      days,
      configHashes: { v2Config: null, assignment: null },
      seat: "claude-opus-5",
      vectors: "voyage-3-large",
      surfaceSet: surfaceSetHash(),
      updatedAt: "2026-09-06T23:00:00.000Z",
    });
    return { runDir, v1Dir: dir("v1") };
  }

  const DAYS = [
    { date: "2026-09-03", class: "active", phase: "0" },
    { date: "2026-09-04", class: "active", phase: "P" },
    { date: "2026-09-05", class: "active", phase: "P" },
    { date: "2026-09-06", class: "thin", phase: "P" },
  ];

  test("the current phase's count goes to zero, the days stay, and the annotation says why", () => {
    const r = runWithDays(DAYS);
    const artifacts = restartArtifacts({
      runDir: r.runDir,
      date: "2026-09-07",
      reason: "recall BUDGET_MS 250 -> 1200: behavior-changing, so the phase restarts",
      at: "2026-09-07T08:00:00.000Z",
    });
    expect(artifacts.run.activeDays["P"]).toBe(0);
    // Day 0 is NOT rewritten by a restart of P.
    expect(artifacts.run.activeDays["0"]).toBe(1);
    // The history is kept, every day of it (§5 G10: halt and PRESERVE).
    expect(artifacts.run.days.map((d) => d.date)).toEqual(DAYS.map((d) => d.date));
    expect(artifacts.run.phaseRestart).toEqual({
      restartedAt: "2026-09-07T08:00:00.000Z",
      date: "2026-09-07",
      phase: "P",
      reason: "recall BUDGET_MS 250 -> 1200: behavior-changing, so the phase restarts",
      surfaceSet: surfaceSetHash(),
      clearedActiveDays: { "0": 1, P: 2 },
    });
    // And the history line, one JSON object per restart.
    const log = artifacts.files["restarts.jsonl"];
    expect(log).toBeDefined();
    const parsed = JSON.parse((log ?? "").trim()) as Record<string, unknown>;
    expect(parsed["date"]).toBe("2026-09-07");
    expect(parsed["priorSurfaceSet"]).toBe(surfaceSetHash());
  });

  test("A LATER DAILY RUN DOES NOT RESURRECT THE COUNT — the restart is on the record", () => {
    const r = runWithDays(DAYS);
    const run = RunDir.open(r.runDir, NO_STORES);
    const restarted = restartArtifacts({
      runDir: r.runDir,
      date: "2026-09-07",
      reason: "the wake frame names landed",
      at: "2026-09-07T08:00:00.000Z",
    });
    for (const [rel, value] of Object.entries(restarted.json)) run.writeJson(rel, value);
    for (const [rel, text] of Object.entries(restarted.files)) run.writeText(rel, text);

    // One ordinary active day AFTER the restart. `activeDays.P` recomputes from
    // `days[]` on every daily write, so without the annotation being carried
    // forward this would read 3 — the clock resurrecting the days the restart
    // was told to stop counting.
    v1Log(r.v1Dir, "2026-09-07", [
      { seq: 0, session: "s9", type: "session.start" },
      { seq: 1, session: "s9", type: "ab.muted", hook: "session_start" },
      { seq: 2, session: "s9", type: "buffer.append" },
      { seq: 3, session: "s9", type: "buffer.append" },
      { seq: 4, session: "s9", type: "buffer.append" },
    ]);
    const v2Dir = dir("v2");
    buildStore(v2Dir, (store) => {
      store.appendEvent({
        name: PRIMACY_DELIVER_EVENT,
        day: 0,
        payload: {
          hook: "stop",
          reason: "override-engram",
          system: "v2",
          date: "2026-09-07",
          session: "s9",
        },
      });
    });
    const artifacts = dailyRecord({
      runDir: r.runDir,
      date: "2026-09-07",
      v1Dir: r.v1Dir,
      v2DataDir: v2Dir,
      v1Ritual: ["What did you learn in this session that is worth keeping?"],
      phase: "P",
      primacy: "v2",
    });
    expect(artifacts.record.class).toBe("active");
    expect(artifacts.run.activeDays["P"]).toBe(1);
    expect(artifacts.run.phaseRestart?.date).toBe("2026-09-07");
  });

  test("the second restart APPENDS to the history rather than replacing it", () => {
    const r = runWithDays(DAYS);
    const run = RunDir.open(r.runDir, NO_STORES);
    const first = restartArtifacts({
      runDir: r.runDir,
      date: "2026-09-07",
      reason: "one",
      at: "2026-09-07T08:00:00.000Z",
    });
    for (const [rel, value] of Object.entries(first.json)) run.writeJson(rel, value);
    for (const [rel, text] of Object.entries(first.files)) run.writeText(rel, text);
    const second = restartArtifacts({
      runDir: r.runDir,
      date: "2026-09-09",
      reason: "two",
      at: "2026-09-09T08:00:00.000Z",
    });
    const lines = (second.files["restarts.jsonl"] ?? "").trim().split("\n");
    expect(lines.length).toBe(2);
    expect((JSON.parse(lines[0] ?? "{}") as { reason?: string }).reason).toBe("one");
    expect((JSON.parse(lines[1] ?? "{}") as { reason?: string }).reason).toBe("two");
    expect((JSON.parse(lines[1] ?? "{}") as { priorPhaseRestart?: string }).priorPhaseRestart).toBe(
      "2026-09-07",
    );
  });

  test("every refusal is NAMED: no run record, an empty reason, a malformed or impossible date", () => {
    const r = runWithDays(DAYS);
    expect(() =>
      restartArtifacts({ runDir: dir("empty-run"), date: "2026-09-07", reason: "x" }),
    ).toThrow(/NO_RUN_RECORD/);
    expect(() => restartArtifacts({ runDir: r.runDir, date: "2026-09-07", reason: "   " })).toThrow(
      /RESTART_REASON_REQUIRED/,
    );
    expect(() => restartArtifacts({ runDir: r.runDir, date: "07-09-2026", reason: "x" })).toThrow(
      /RESTART_DATE_MALFORMED/,
    );
    expect(() => restartArtifacts({ runDir: r.runDir, date: "2026-09-01", reason: "x" })).toThrow(
      /RESTART_DATE_BEFORE_RUN_START/,
    );
    // A corrupt run.json is EVIDENCE, not a reason to start a fresh clock.
    writeFileSync(join(r.runDir, "run.json"), '{"startDate": "2026-09-03", "days": [', "utf8");
    expect(() => restartArtifacts({ runDir: r.runDir, date: "2026-09-07", reason: "x" })).toThrow(
      /RUN_RECORD_CORRUPT/,
    );
  });

  test("it writes ONLY the run directory — and refuses one that overlaps a live store", () => {
    const v1Dir = dir("v1-live");
    expect(() =>
      RunDir.open(join(v1Dir, "run"), { ...NO_STORES, v1Dir }),
    ).toThrow(/RUN_DIR_OVERLAPS_STORE/);
    // The engine itself holds no write API at all: it returns artifacts and the
    // caller writes them, exactly as `record.ts` does (G1's containment).
    const r = runWithDays(DAYS);
    const before = manifest(r.runDir);
    restartArtifacts({ runDir: r.runDir, date: "2026-09-07", reason: "x" });
    expect(manifest(r.runDir)).toEqual(before);
  });
});

describe("the preflight — Phase 0, as a gate", () => {
  test("a complete fixture reaches ready: true, with EVERY row binding — nothing deferred", () => {
    const f = fixture();
    process.env["ANTHROPIC_API_KEY"] = "test-key-not-a-real-credential";
    try {
      const report = preflight(f);
      const failing = report.checks.filter((c) => c.status !== "pass");
      expect(failing.map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
      expect(report.ready).toBe(true);
      // Preconditions 8 and 9 are in the passing set, not in a deferred one:
      // with the shadow phase dropped they gate the DAY-0 flip (RULED
      // 2026-09-03), and the report has no `deferred` list at all any more.
      expect(report.checks.find((c) => c.id === "precondition.8")?.status).toBe("pass");
      expect(report.checks.find((c) => c.id === "precondition.9")?.status).toBe("pass");
      expect("deferred" in report).toBe(false);
      // HERMETIC, PROVED: every path the preflight actually resolved is inside
      // this test's temp tree. A green preflight that had reached the real
      // `~/.memory-ab` would look identical without this line.
      const realRoot = realpathOr(root);
      for (const id of ["assignment.realpath", "datadirs.disjoint", "v2.config", "bars.committed"]) {
        const detail = report.checks.find((c) => c.id === id)?.detail ?? "";
        // Absolute paths only: a seat id like `claude-opus-5/pinned` is not one.
        for (const [, path = ""] of detail.matchAll(/(?:^|[\s=])(\/[^\s·;]+)/g)) {
          expect(`${id}:${path}:${path.startsWith(realRoot) || path.startsWith(root)}`).toBe(
            `${id}:${path}:true`,
          );
        }
      }
    } finally {
      delete process.env["ANTHROPIC_API_KEY"];
    }
  });

  test("PHASE 0 BINDS 8 AND 9: without the day-0 session's evidence, ready is false", () => {
    // The old build deferred these two to an S→P flip that no longer exists,
    // which under the single-phase ruling would let the run flip to v2-primary
    // with the ask channel unproven — and day 1 is the authored dump's first
    // fire anywhere. Each is removed on its own, so neither is carrying the
    // other's failure.
    process.env["ANTHROPIC_API_KEY"] = "test-key-not-a-real-credential";
    try {
      const noAsk = fixture();
      rmSync(join(noAsk.runDir, "ask-channel.json"));
      const a = preflight(noAsk);
      expect(a.ready).toBe(false);
      expect(a.checks.find((c) => c.id === "precondition.8")?.status).toBe("not-exercised");
      expect(a.checks.find((c) => c.id === "precondition.9")?.status).toBe("pass");

      const noHash = fixture();
      rmSync(join(noHash.runDir, "run.json"));
      const b = preflight(noHash);
      expect(b.ready).toBe(false);
      expect(b.checks.find((c) => c.id === "precondition.9")?.status).toBe("not-exercised");
      expect(b.checks.find((c) => c.id === "precondition.8")?.status).toBe("pass");
    } finally {
      delete process.env["ANTHROPIC_API_KEY"];
    }
  });

  test("--phase P is the daily re-check: the same rows, and the drop-dead behind us", () => {
    // §5 P1's drop-dead bars a run from STARTING (§9 OQ5). The daily re-check
    // runs for every day of a ≥7-day run — every one of them past 09-08 by
    // arithmetic — so failing that row mid-run would tell an already-running
    // run that it should not have started, which is not a thing it can act on.
    const f = fixture();
    process.env["ANTHROPIC_API_KEY"] = "test-key-not-a-real-credential";
    try {
      const late = { today: "2026-09-15" };
      const atZero = preflight(f, { ...late, phase: "0" as const });
      expect(atZero.ready).toBe(false);
      expect(atZero.checks.find((c) => c.id === "bars.committed")?.status).toBe("fail");

      // Without a day 0 on record, the re-check cannot buy the drop-dead (NEW-2).
      const noDayZero = preflight(f, { ...late, phase: "P" as const });
      expect(noDayZero.checks.find((c) => c.id === "bars.committed")?.status).toBe("fail");
      expect(noDayZero.ready).toBe(false);

      const runJson = JSON.parse(readFileSync(join(f.runDir, "run.json"), "utf8")) as Record<string, unknown>;
      writeJson(join(f.runDir, "run.json"), {
        ...runJson,
        days: [{ date: "2026-09-04", class: "active", phase: "0" }],
      });
      const running = preflight(f, { ...late, phase: "P" as const });
      const bars = running.checks.find((c) => c.id === "bars.committed");
      expect(bars?.status).toBe("pass");
      expect(bars?.detail).toContain("bars a run from STARTING");
      expect(running.ready).toBe(true);
    } finally {
      delete process.env["ANTHROPIC_API_KEY"];
    }
  });

  function rowOf(f: Fixture, id: string, over: Partial<Parameters<typeof runPreflight>[0]> = {}) {
    const report = preflight(f, over);
    return report.checks.find((c) => c.id === id);
  }

  test("assignment.health fails on override: null, naming the CONTRACT's rule", () => {
    const f = fixture();
    writeJson(join(f.abDir, "assignment.json"), { mode: "alternate-day", override: null });
    const row = rowOf(f, "assignment.health");
    expect(row?.status).toBe("fail");
    expect(row?.detail).toContain('override must be exactly "bansai" or "engram"');
  });

  test("assignment.realpath fails when MEMORY_AB_DIR is set for either process", () => {
    const f = fixture();
    const row = rowOf(f, "assignment.realpath", {
      envs: [
        { name: "v1-hooks", abDir: f.abDir },
        { name: "v2-hooks", abDir: f.abDir, abDirEnvSet: true },
      ],
    });
    expect(row?.status).toBe("fail");
    expect(row?.detail).toContain("MEMORY_AB_DIR must be unset for both hook processes");
    expect(row?.detail).toContain("v2-hooks");
  });

  test("assignment.realpath fails when the two environments resolve DIFFERENT files", () => {
    const f = fixture();
    const otherAb = dir("other-ab");
    writeJson(join(otherAb, "assignment.json"), { override: "bansai" });
    const row = rowOf(f, "assignment.realpath", {
      envs: [
        { name: "v1-hooks", abDir: f.abDir },
        { name: "v2-hooks", abDir: otherAb },
      ],
    });
    expect(row?.status).toBe("fail");
    expect(row?.detail).toContain("resolve different files");
  });

  test("datadirs.disjoint fails when one store is nested inside another", () => {
    const f = fixture();
    const row = rowOf(f, "datadirs.disjoint", { v2DataDir: join(f.v1Dir, "nested-v2") });
    expect(row?.status).toBe("fail");
    expect(row?.detail).toContain("overlaps");
  });

  test("v2.config fails when parallel.enabled is not true", () => {
    const f = fixture();
    writeJson(f.configPath, { dataDir: f.v2Dir, parallel: { enabled: false } });
    const row = rowOf(f, "v2.config");
    expect(row?.status).toBe("fail");
    expect(row?.detail).toContain("parallel.enabled is not true");
  });

  test("v2.config reports credential NAMES and never a value", () => {
    const f = fixture();
    process.env["ANTHROPIC_API_KEY"] = "sk-secret-do-not-print";
    try {
      const row = rowOf(f, "v2.config");
      expect(row?.detail).toContain("ANTHROPIC_API_KEY=present");
      expect(row?.detail).not.toContain("sk-secret");
    } finally {
      delete process.env["ANTHROPIC_API_KEY"];
    }
  });

  test("v2.config fails an EXPIRED seat", () => {
    const f = fixture();
    writeJson(f.configPath, {
      dataDir: f.v2Dir,
      parallel: { enabled: true },
      models: { interpret: { id: "some-model", placeholder: true, expires: "2026-01-01" } },
    });
    const row = rowOf(f, "v2.config");
    expect(row?.status).toBe("fail");
    expect(row?.detail).toContain("expired");
  });

  test("replay.gate PASSES on a sample record with no signature anywhere", () => {
    // The fixture's pass record is `sample: true` and the run directory holds
    // no waivers file at all — there is no such file any more (RULED
    // 2026-09-03). The row carries the wiring readings it passed on, so a green
    // gate can be read rather than trusted.
    const f = fixture();
    expect(existsSync(join(f.runDir, "waivers.json"))).toBe(false);
    const row = rowOf(f, "replay.gate");
    expect(row?.status).toBe("pass");
    expect(row?.detail).toContain("sample=true");
    expect(row?.detail).toContain("wiring: preselect.meanSchemasShown=pass");
  });

  test("replay.gate FAILS when the record's wiring is dead, naming the channel", () => {
    const f = fixture();
    const dead = record();
    writeJson(join(f.replayOut, "pass-record.json"), {
      runId: "replay-sample-5d",
      readOnlyProof: true,
      totalityOk: true,
      sample: true,
      counts: { pass: 30, fail: 1, "needs-rater": 2, "not-exercised": 23, watch: 0 },
      verdicts: { ...dead.verdicts, "preselect.blindRate": { verdict: "fail", value: 1 } },
    });
    const row = rowOf(f, "replay.gate");
    expect(row?.status).toBe("fail");
    expect(row?.detail).toContain("EVERY gated chunk encoded blind");
  });

  test("replay.gate fails when there is no pass record at all", () => {
    const f = fixture();
    const row = rowOf(f, "replay.gate", { replayOut: join(root, "no-replay") });
    expect(row?.status).toBe("fail");
    expect(row?.detail).toContain("no pass record at");
  });

  test("canary.transcripts fails on a conversation-block hit, and calls it a RED-LINE", () => {
    const f = fixture();
    writeFileSync(
      join(f.transcripts, "leaked.jsonl"),
      // A WAKE marker in a user-role block: the host's transcript shape changed
      // and v1's injection is now reaching v2's capture. `[bansai] …` would be
      // the episode ask, which is the designed case, not this one.
      `${JSON.stringify({ message: { role: "user", content: "<bansai-memory>leaked into capture</bansai-memory>" } })}\n`,
      "utf8",
    );
    const row = rowOf(f, "canary.transcripts");
    expect(row?.status).toBe("fail");
    expect(row?.detail).toContain("RED-LINE");
  });

  test("the canary and classifyBlock AGREE today, so the drift branch stays empty", () => {
    const f = fixture();
    // An episode-ask marker whose text `classifyBlock` would NOT call foreign
    // is the breach itself: `enters()` no longer refuses it. Constructed by
    // making the marker match while the classifier's own rule does not — the
    // canary and `transcript.ts` disagreeing is the whole signal.
    const scan = scanTranscripts([
      (() => {
        const path = join(f.transcripts, "drift.jsonl");
        writeFileSync(
          path,
          `${JSON.stringify({ message: { role: "user", content: "[bansai] an ordinary ask" } })}\n`,
          "utf8",
        );
        return path;
      })(),
    ]);
    // The drift branch is UNREACHABLE today by construction: `foreignMarkerIndex`
    // and `classifyBlock` walk the same `FOREIGN_MARKERS` with the same
    // `trimStart()`, so they cannot disagree. It is a guard against future
    // divergence — if either recognizer is ever changed alone, the exclusion
    // silently stops applying and that branch is what says so. This test pins
    // the agreement rather than exercising the branch, and says which.
    expect(scan.recognizerDrift).toEqual([]);
    expect(scan.byDesignHits.length).toBe(1);
  });

  test("canary.transcripts is NOT-EXERCISED when the scan saw no v1 marker at all", () => {
    const f = fixture();
    const row = rowOf(f, "canary.transcripts", { transcripts: [dir("empty-transcripts")] });
    // An empty scan and a clean one are indistinguishable, and only one of them
    // is evidence. A vacuous pass here would have signed off the isolation
    // guarantee on a corpus that was never read (review blocker 6).
    expect(row?.status).toBe("not-exercised");
    expect(row?.detail).toContain("no v1 marker was seen");
  });

  test("canary.transcripts PASSES on the episode ask alone — that is §5 G8 working", () => {
    const f = fixture();
    writeFileSync(
      join(f.transcripts, "ask.jsonl"),
      `${JSON.stringify({ message: { role: "user", content: "Stop hook feedback:\n- [bansai] what did you learn?" } })}\n`,
      "utf8",
    );
    const row = rowOf(f, "canary.transcripts");
    expect(row?.status).toBe("pass");
    expect(row?.detail).toContain("§5 G8 working");
  });

  test("host.hooks is NOT-EXERCISED when the SessionEnd budget was never measured", () => {
    const f = fixture();
    // A measurable execution model, but no SessionEnd record anywhere: the
    // CONTRACT asks for that budget measured with BOTH systems' hooks
    // installed, and `sessionEndWorstMs === null` is the measurement MISSING.
    // It used to pass, because `sessionEndOk === null` fell through to `pass`.
    writeFileSync(
      join(f.transcripts, "session.jsonl"),
      [
        JSON.stringify({
          type: "attachment",
          timestamp: "2026-09-04T09:00:01.000Z",
          attachment: { type: "hook_success", hookEvent: "SessionStart", hookName: "bansai", durationMs: 400 },
        }),
        JSON.stringify({
          type: "attachment",
          timestamp: "2026-09-04T09:00:01.050Z",
          attachment: { type: "hook_success", hookEvent: "SessionStart", hookName: "counterparts", durationMs: 400 },
        }),
      ].join("\n"),
      "utf8",
    );
    const row = rowOf(f, "host.hooks");
    expect(row?.status).toBe("not-exercised");
    expect(row?.detail).toContain("SessionEnd budget was never measured");
  });

  test("v2.config judges a HOOK-SHAPED env: keys in the preflight's own shell do not count, the configured file does", () => {
    const f = fixture();
    process.env["ANTHROPIC_API_KEY"] = "shell-key-not-a-real-credential";
    process.env["VOYAGE_API_KEY"] = "shell-voyage-not-a-real-credential";
    try {
      const withFile = rowOf(f, "v2.config");
      expect(withFile?.status).toBe("pass");
      expect(withFile?.detail).toContain("present (file)");
      const cfg = JSON.parse(readFileSync(f.configPath, "utf8")) as Record<string, unknown>;
      delete cfg["credentialsFile"];
      writeJson(f.configPath, cfg);
      const without = rowOf(f, "v2.config");
      expect(without?.status).toBe("fail");
      expect(without?.detail).toContain("no credentialsFile configured");
    } finally {
      delete process.env["ANTHROPIC_API_KEY"];
      delete process.env["VOYAGE_API_KEY"];
    }
  });

  test("host.hooks PASSES by COMPLETION evidence when the host recorded no attachment — a durable session-end boundary row on the day", () => {
    const f = fixture();
    buildStore(f.v2Dir, (s) => {
      s.appendEvent({
        name: "adapter.boundary",
        day: 0,
        payload: { hook: "session-end", kind: "session-end", captured: false, spans: 0, date: "2026-09-04", session: "probe" },
      });
    });
    const row = rowOf(f, "host.hooks", { transcripts: [dir("empty-transcripts")], today: "2026-09-04" });
    expect(row?.status).toBe("pass");
    expect(row?.detail).toContain("evidenced by COMPLETION");
    // A different day's row is not this day's evidence.
    const other = rowOf(f, "host.hooks", { transcripts: [dir("empty-transcripts")], today: "2026-09-05" });
    expect(other?.status).toBe("not-exercised");
  });

  test("host.hooks is NOT-EXERCISED when the model could not be measured", () => {
    const f = fixture();
    const row = rowOf(f, "host.hooks", { transcripts: [dir("empty-transcripts")] });
    expect(row?.status).toBe("not-exercised");
    expect(row?.detail).toContain("model=unknown");
  });

  test("host.hooks fails when the shared SessionEnd budget is exceeded", () => {
    const f = fixture();
    writeFileSync(
      join(f.transcripts, "session.jsonl"),
      [
        JSON.stringify({
          type: "attachment",
          timestamp: "2026-09-04T09:00:01.000Z",
          attachment: { type: "hook_success", hookEvent: "SessionEnd", hookName: "bansai", durationMs: 900 },
        }),
        JSON.stringify({
          type: "attachment",
          timestamp: "2026-09-04T09:00:01.900Z",
          attachment: { type: "hook_success", hookEvent: "SessionEnd", hookName: "counterparts", durationMs: 800 },
        }),
      ].join("\n"),
      "utf8",
    );
    const row = rowOf(f, "host.hooks");
    expect(row?.status).toBe("fail");
    expect(row?.detail).toContain("shared SessionEnd budget is exceeded");
  });

  test("bars.committed fails when bars.json is absent, and when it is UNDATED", () => {
    const f = fixture();
    rmSync(join(f.runDir, "bars.json"));
    expect(rowOf(f, "bars.committed")?.status).toBe("fail");
    writeJson(join(f.runDir, "bars.json"), { activeDayTurnFloor: 3, crossEncodingBar: 0, committedAt: "" });
    const row = rowOf(f, "bars.committed");
    expect(row?.status).toBe("fail");
    expect(row?.detail).toContain("dated committedAt");
    // DATED means dated: a non-empty string is not a date (§5 G15).
    writeJson(join(f.runDir, "bars.json"), { activeDayTurnFloor: 3, crossEncodingBar: 0, committedAt: "yes" });
    expect(rowOf(f, "bars.committed")?.status).toBe("fail");
  });

  test("bars.committed FAILS once the precondition drop-dead has passed", () => {
    const f = fixture();
    expect(preflight(f, { today: "2026-09-07" }).checks.find((c) => c.id === "bars.committed")?.status).toBe("pass");
    // §5 P1 / §9 OQ5: past the drop-dead the run does not start and v1 flips
    // as-is. A date that lives only in a sentence is a date nobody compares.
    const late = preflight(f, { today: "2026-09-09" }).checks.find((c) => c.id === "bars.committed");
    expect(late?.status).toBe("fail");
    expect(late?.detail).toContain("drop-dead 2026-09-08 has passed");
  });

  test("store.schemaBytes is not-exercised on an empty store, and precondition 5 follows it", () => {
    const f = fixture();
    const empty = dir("empty-store");
    buildStore(empty, () => {
      /* nothing */
    });
    const report = preflight(f, { v2DataDir: empty });
    const bytes = report.checks.find((c) => c.id === "store.schemaBytes");
    const five = report.checks.find((c) => c.id === "precondition.5");
    expect(bytes?.status).toBe("not-exercised");
    expect(five?.status).toBe("not-exercised");
    expect(five?.detail).toContain("closed by the schemaBytes reading");
    expect(report.ready).toBe(false);
  });

  // ── review should-fix: a DRY RUN is not a migration ─────────────────────
  test("precondition 6 REFUSES a dry-run report, and a report for another target", () => {
    const f = fixture();
    const path = join(f.runDir, "migration-report.json");
    const real = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

    // A dry run writes nothing, so its source-manifest proof is vacuous — and
    // the old check passed on it, certifying a migration that never happened.
    writeJson(path, { ...real, mode: "dry-run" });
    let r = rowOf(f, "precondition.6");
    expect(r?.status).toBe("fail");
    expect(r?.detail).toContain('not "apply"');

    // An apply into a DIFFERENT data dir is not this run's starting store.
    writeJson(path, { ...real, target: join(root, "somewhere-else") });
    r = rowOf(f, "precondition.6");
    expect(r?.status).toBe("fail");
    expect(r?.detail).toContain("is not the v2 dataDir this run measures");

    // And the real one passes, by realpath on both sides.
    writeJson(path, real);
    expect(rowOf(f, "precondition.6")?.status).toBe("pass");
  });

  test("precondition 6 fails without a migration report carrying the manifest proof", () => {
    const f = fixture();
    rmSync(join(f.runDir, "migration-report.json"));
    const row = rowOf(f, "precondition.6");
    expect(row?.status).toBe("fail");
    expect(row?.detail).toContain("OQ2 RULED migrated");
    writeJson(join(f.runDir, "migration-report.json"), {
      mode: "apply",
      target: f.v2Dir,
      source_readonly: { files: 3, identical: false },
    });
    expect(rowOf(f, "precondition.6")?.detail).toContain("source_readonly.identical is not true");
  });

  // ── review should-fix: 8 and 9 have INPUTS, so the S→P preflight is
  //     reachable rather than impossible by construction ────────────────────
  test("precondition 8 reads a machine-readable ask-channel record, not prose", () => {
    const f = fixture();
    rmSync(join(f.runDir, "ask-channel.json"));
    let r = rowOf(f, "precondition.8");
    expect(r?.status).toBe("not-exercised");
    expect(r?.detail).toContain("ask-channel.json");
    // And it names WHY a muted throwaway session cannot prove it: v2's Stop
    // ask never fires while it is standing down.
    expect(r?.detail).toContain("v2 DELIVERS");

    // A record missing any field is a FAIL, not a pass: the observation has to
    // say what was seen, when, through which channel, and with what exit code.
    writeJson(join(f.runDir, "ask-channel.json"), { channel: "stdout", exitCode: 0 });
    r = rowOf(f, "precondition.8");
    expect(r?.status).toBe("fail");
    expect(r?.detail).toContain("a dated observedAt");

    writeJson(join(f.runDir, "ask-channel.json"), {
      observedAt: "2026-09-05",
      channel: "stdout",
      exitCode: 0,
      session: "throwaway-1",
    });
    r = rowOf(f, "precondition.8");
    expect(r?.status).toBe("pass");
    expect(r?.detail).toContain("stdout");
  });

  test("precondition 9 reads recall.decision ROWS and the surfaceSet hash", () => {
    // A store with no surfacing decision in it: replay INTERFACE-GAPS §7's gap,
    // unclosed — and, in the single-phase shape, the day-0 throwaway session
    // still owed, since a muted v2 decides nothing (the stand-down precedes
    // `recallForTurn`).
    const empty = fixture();
    const bare = dir("bare-store");
    buildStore(bare, () => {
      /* a store, no decisions */
    });
    let r = rowOf(empty, "precondition.9", { v2DataDir: bare });
    expect(r?.status).toBe("not-exercised");
    expect(r?.detail).toContain("recall.decision");
    expect(r?.detail).toContain("the day-0 throwaway session still owed");

    const f = fixture();
    rmSync(join(f.runDir, "run.json"));
    // The rows are there, but G12 still has nothing to compare a change against.
    r = rowOf(f, "precondition.9");
    expect(r?.status).toBe("not-exercised");
    expect(r?.detail).toContain("surfaceSet");

    // A daily record writes the hash; then both halves hold.
    v1Log(f.v1Dir, "2026-09-04", [{ seq: 0, session: "s1", type: "session.start" }]);
    const artifacts = dailyRecord({
      runDir: f.runDir,
      date: "2026-09-04",
      v1Dir: f.v1Dir,
      v2DataDir: f.v2Dir,
      phase: "0",
      primacy: "v1",
      v1Ritual: ["What did you learn in this session that is worth keeping?"],
    });
    expect(artifacts.run.surfaceSet).toMatch(/^[0-9a-f]{16}$/);
    RunDir.open(f.runDir, STORES(f)).writeJson("run.json", artifacts.run);
    r = rowOf(f, "precondition.9");
    expect(r?.status).toBe("pass");
    expect(r?.detail).toContain(surfaceSetHash());
    // A hash of the surfacing fields alone would class a gate-record or
    // band-transition change as telemetry-only (N6) — so every SCORED durable
    // record's field list is a component. `gate.deposit` joined 2026-09-05 with
    // the authored door's own record: `gate.refusalMix` is computed over it, and
    // a scored record the arbiter cannot see is the hole N6 closed for the rest.
    expect(surfaceSetComponents().map((c) => c.name)).toEqual([
      "recall.decision",
      "gate.chunk",
      "gate.deposit",
      "band.transition",
    ]);
    for (const c of surfaceSetComponents()) expect(c.fields.length).toBeGreaterThan(0);
    const recallOnly = createHash("sha256").update(surfaceSetFields().join("\n")).digest("hex").slice(0, 16);
    expect(surfaceSetHash()).not.toBe(recallOnly);

    // A hash from another build is a MISMATCH, which is G12 doing its job.
    RunDir.open(f.runDir, STORES(f)).writeJson("run.json", {
      ...artifacts.run,
      surfaceSet: "0000000000000000",
    });
    expect(rowOf(f, "precondition.9")?.detail).toContain("the surface set moved");
  });

  test("precondition 7 fails without approvedBy/approvedAt", () => {
    const f = fixture();
    writeJson(join(f.runDir, "pricing.json"), { marginalSpend: "some number" });
    const row = rowOf(f, "precondition.7");
    expect(row?.status).toBe("fail");
    expect(row?.detail).toContain("no approvedBy/approvedAt");
  });

  test("gate-sets.json copies FOUR enumerations into the run dir, wiring included", () => {
    // Precondition 1's sets are "copied into the run directory" so the run's own
    // artifacts say what the gate asked about. The wiring checks are part of
    // that now (RULED 2026-09-03: the predicate replaced the signature), and a
    // predicate nobody can read from the run directory is the same ceremony in
    // a different costume.
    const f = fixture();
    const artifacts = preflightArtifacts(preflight(f), readBars(f.runDir));
    const sets = artifacts["gate-sets.json"];
    expect(sets.parallelExercisable).toEqual([...PARALLEL_EXERCISABLE]);
    expect(sets.raterDeferred).toEqual([...RATER_DEFERRED]);
    expect(sets.notApplicableToRun).toEqual([...NOT_APPLICABLE_TO_RUN]);
    expect(sets.wiringAlive.map((w) => w.id)).toEqual([
      "preselect.meanSchemasShown",
      "preselect.blindRate",
      "gate.refusalMix",
    ]);
    for (const w of sets.wiringAlive) expect(w.proves.length).toBeGreaterThan(10);
    expect(sets.preconditionDropDead).toBe("2026-09-08");
    // And no waivers file is written or read anywhere in the artifacts.
    expect(Object.keys(artifacts)).toEqual(["preflight.json", "gate-sets.json"]);
  });

  test("preconditions 2, 3 and 4 carry the NAMES of the tests that verify them", () => {
    const f = fixture();
    const report = preflight(f);
    const two = report.checks.find((c) => c.id === "precondition.2");
    const three = report.checks.find((c) => c.id === "precondition.3");
    const four = report.checks.find((c) => c.id === "precondition.4");
    expect(two?.detail).toContain("the ratchet tripwire renders a verdict every cycle (guarantee 12)");
    expect(three?.detail).toContain("the scan is bounded");
    expect(four?.detail).toContain("the poison pill is BOUNDED");
    // And those test names must actually exist in the suite — a citation that
    // has rotted is worse than none.
    const here = dirname(fileURLToPath(import.meta.url));
    for (const [file, needle] of [
      ["sleep.test.ts", "the ratchet tripwire renders a verdict every cycle (guarantee 12)"],
      ["encode.test.ts", "the scan is bounded"],
      ["remember.test.ts", "the poison pill is BOUNDED"],
    ] as const) {
      const src = readFileSync(join(here, file), "utf8");
      expect(`${file}:${src.includes(needle)}`).toBe(`${file}:true`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G1 — the instrument writes nothing but its own run directory
// ═══════════════════════════════════════════════════════════════════════════

describe("guarantee 1 — nothing but the run directory", () => {
  test("BYTE-IDENTICAL inputs across a full preflight AND a daily run", () => {
    const f = fixture();
    v1Log(f.v1Dir, "2026-09-04", [
      { seq: 0, session: "s1", type: "session.start" },
      { seq: 1, session: "s1", type: "ab.muted", hook: "session_start" },
      { seq: 2, session: "s1", type: "buffer.append" },
      { seq: 3, session: "s1", type: "buffer.append" },
      { seq: 4, session: "s1", type: "buffer.append" },
      { seq: 5, session: "s1", type: "session.end" },
    ]);
    buildStore(f.v2Dir, (s) => {
      s.appendEvent({
        name: PRIMACY_DELIVER_EVENT,
        day: 0,
        payload: { hook: "session-start", reason: "override-engram", system: "v2", date: "2026-09-04" },
      });
    });

    const before = {
      v1: manifest(f.v1Dir),
      v2: manifest(f.v2Dir),
      engram: manifest(f.engramDir),
      ab: manifest(f.abDir),
      transcripts: manifest(f.transcripts),
      replayOut: manifest(f.replayOut),
      config: manifest(dirname(f.configPath)),
    };

    const report = preflight(f);
    const run = RunDir.open(f.runDir, STORES(f));
    run.writeJson("preflight.json", report);
    const artifacts = dailyRecord({
      runDir: f.runDir,
      date: "2026-09-04",
      v1Dir: f.v1Dir,
      v2DataDir: f.v2Dir,
      v2ConfigPath: f.configPath,
      phase: "P",
      primacy: "v2",
      v1Ritual: ["What did you learn in this session that is worth keeping?"],
    });
    for (const [rel, value] of Object.entries(artifacts.json)) run.writeJson(rel, value);
    for (const [rel, text] of Object.entries(artifacts.files)) run.writeText(rel, text);

    const after = {
      v1: manifest(f.v1Dir),
      v2: manifest(f.v2Dir),
      engram: manifest(f.engramDir),
      ab: manifest(f.abDir),
      transcripts: manifest(f.transcripts),
      replayOut: manifest(f.replayOut),
      config: manifest(dirname(f.configPath)),
    };

    expect(after).toEqual(before);
    // And the run directory is not empty — a tool that wrote nothing at all
    // would pass the assertion above vacuously.
    expect(existsSync(join(f.runDir, "preflight.json"))).toBe(true);
    expect(existsSync(join(f.runDir, "days", "2026-09-04.json"))).toBe(true);
    expect(existsSync(join(f.runDir, "run.json"))).toBe(true);
  });

  test("the run-dir writer REFUSES a path that escapes its root", () => {
    const run = RunDir.open(dir("run"), NO_STORES);
    expect(() => run.writeText(join("..", "escaped.json"), "x")).toThrow(/RUN_DIR_ESCAPE/);
    expect(() => run.path("..", "..", "etc")).toThrow(/RUN_DIR_ESCAPE/);
    expect(existsSync(join(root, "escaped.json"))).toBe(false);
  });

  // -- review blocker 3: the run dir must be disjoint from every live store --
  test("a run dir NESTED under a live store is refused BEFORE any mkdir", () => {
    const v1Dir = dir("v1");
    const nested = join(v1Dir, "runs", "parallel-2026-09");
    expect(() => RunDir.open(nested, { ...NO_STORES, v1Dir })).toThrow(/RUN_DIR_OVERLAPS_STORE/);
    // Nothing was created: a refusal that left a directory behind would have
    // already written into the store it was refusing to write into.
    expect(existsSync(nested)).toBe(false);
    expect(existsSync(join(v1Dir, "runs"))).toBe(false);
  });

  test("the overlap is caught in BOTH directions, and by realpath", () => {
    const runDir = dir("run");
    // A store nested under the run directory is the same defect mirrored.
    const v2DataDir = join(runDir, "store");
    expect(() => RunDir.open(runDir, { ...NO_STORES, v2DataDir })).toThrow(
      /RUN_DIR_OVERLAPS_STORE/,
    );
    // And a symlink is not a way around it: the run dir is realpathed first.
    const real = dir("real-engram");
    const link = join(root, "engram-link");
    symlinkSync(real, link);
    expect(() => RunDir.open(join(link, "run"), { ...NO_STORES, engramDir: real })).toThrow(
      /RUN_DIR_OVERLAPS_STORE/,
    );
    // A genuinely disjoint sibling still opens, so this is not refusing all.
    expect(RunDir.open(dir("run-ok"), NO_STORES).root.length).toBeGreaterThan(0);
  });

  test("the preflight's datadirs.disjoint row carries the RUN DIR too", () => {
    const f = fixture();
    const ok = preflight(f).checks.find((c) => c.id === "datadirs.disjoint");
    expect(ok?.status).toBe("pass");
    expect(ok?.detail).toContain("run dir=");

    const inside = preflight(f, { runDir: join(f.v1Dir, "run") }).checks.find(
      (c) => c.id === "datadirs.disjoint",
    );
    expect(inside?.status).toBe("fail");
    expect(inside?.detail).toContain("run dir");
  });

  // -- review should-fix: run.json is written atomically, and a corrupt one
  //    is EVIDENCE rather than a reason to restart the run -------------------
  test("writeText leaves no partial file and no temp file behind", () => {
    const run = RunDir.open(dir("run-atomic"), NO_STORES);
    run.writeJson("run.json", { startDate: "2026-09-01" });
    run.writeJson("run.json", { startDate: "2026-09-02" });
    expect(readdirSync(run.root)).toEqual(["run.json"]);
    expect(JSON.parse(readFileSync(join(run.root, "run.json"), "utf8"))).toEqual({
      startDate: "2026-09-02",
    });
  });

  test("an UNPARSABLE run.json THROWS — it never silently restarts the run", () => {
    const runDir = dir("run-corrupt");
    // The shape a killed process leaves: a truncated write.
    const truncated = '{"startDate": "2026-09-01", "days": [';
    writeFileSync(join(runDir, "run.json"), truncated, "utf8");
    expect(() => readRunRecord(runDir)).toThrow(/RUN_RECORD_CORRUPT/);
    // And the file is preserved exactly as found — it is the evidence (G10).
    expect(readFileSync(join(runDir, "run.json"), "utf8")).toBe(truncated);
    // A run that has not started is still simply null, not an error.
    expect(readRunRecord(dir("run-fresh"))).toBeNull();
  });

  test("the SOURCE SCAN: no module but the writer imports a filesystem write API", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const toolRoot = join(here, "..", "tools", "parallel");
    const FORBIDDEN = [
      "writeFileSync",
      "appendFileSync",
      "mkdirSync",
      "renameSync",
      "rmSync",
      "unlinkSync",
      "copyFileSync",
      "openSync",
      "truncateSync",
      "cpSync",
      "mkdtempSync",
      "createWriteStream",
    ];
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const name of readdirSync(d).sort()) {
        const full = join(d, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".ts")) files.push(full);
      }
    };
    walk(toolRoot);
    // The scan must actually cover something, `bin/` included.
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.includes(`${sep}bin${sep}`))).toBe(true);

    for (const file of files) {
      const rel = relative(toolRoot, file).split(sep).join("/");
      if (rel === "writer.ts") continue;
      const src = readFileSync(file, "utf8");
      for (const forbidden of FORBIDDEN) {
        expect(`${rel}:${forbidden}:${src.includes(forbidden)}`).toBe(`${rel}:${forbidden}:false`);
      }
    }
    // And the writer really is the one that holds them, so the scan is not
    // passing because nothing writes anywhere.
    const writer = readFileSync(join(toolRoot, "writer.ts"), "utf8");
    expect(writer.includes("writeFileSync")).toBe(true);
    expect(writer.includes("mkdirSync")).toBe(true);
  });

  test("only `bin/` may resolve a home directory — every other module takes its paths in", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const toolRoot = join(here, "..", "tools", "parallel");
    // The bins carry the real defaults on purpose: that is where a human types
    // a path. Everywhere else, importing `node:os` is the only way to reach a
    // home — and `homedir()` does NOT read $HOME on Bun, so a module that used
    // it would resolve the REAL `~/.memory-ab` inside a test that believed it
    // had redirected it. That hole is nailed shut structurally, here.
    const OS = 'from "node:os"';
    // EVERY non-bin module, walked rather than listed, so a new file cannot be
    // added to this tool without the rule applying to it.
    const modules = readdirSync(toolRoot).filter((n) => n.endsWith(".ts")).sort();
    expect(modules.length).toBeGreaterThan(7);
    for (const name of modules) {
      const src = readFileSync(join(toolRoot, name), "utf8");
      expect(`${name}:${src.includes(OS)}`).toBe(`${name}:false`);
    }
    // And the bins really do carry them, so this is not passing vacuously.
    const bin = readFileSync(join(toolRoot, "bin", "preflight.ts"), "utf8");
    expect(bin.includes(OS)).toBe(true);
    expect(bin.includes(".memory-ab")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
/**
 * `--v2-data-dir`: THE ONE LIVE PATH THAT MUST BE SAID OUT LOUD (G39).
 *
 * The #80 reviewer's finding, carried as LAUNCH-STATUS G39: the three bins
 * default `--v2-data-dir` to `~/.counterparts`, so a command line that names
 * nothing still names the owner's live memory — "writes a live path by naming
 * nothing". The tool writes only its run directory; the path is a GUARD INPUT
 * (`RunDir.open`'s overlap check) and, in the daily and the preflight, a READ
 * TARGET. A guard whose subject was chosen by a default is a guard nobody
 * agreed to.
 *
 * THE DEFAULT STAYS, and the source scan above says why in its own words: "a
 * default that has to be typed is a guard that is sometimes skipped". Requiring
 * the flag would make the overlap check optional in practice, and would break
 * the restart line documented in `tools/parallel/README.md` and
 * `docs/HANDOFF.md`, which passes none.
 *
 * What replaces the SILENCE is the explicit-dir guard's own doctrine at a third
 * door (after `store/paths.ts#dataDir` and
 * `config-path.ts#implicitConfigRefusal`): an unnamed default is always
 * ANNOUNCED, and REFUSED outright wherever the guard is armed — which is every
 * agent shell in this repo, the install loop, and this suite.
 */
describe("the v2 path is named, announced, or refused", () => {
  const NAMED = { dir: "/tmp/some/named/store", named: true } as const;
  const UNNAMED = { dir: "/Users/nobody/.counterparts", named: false } as const;
  const GUARD = "COUNTERPARTS_REQUIRE_EXPLICIT_DIR";

  test("a path the operator TYPED is neither announced nor refused, whatever the guard says", () => {
    // The guard's question has only ever been about the fallback. A named path
    // is a sentence somebody wrote, and a tool that argued with it would teach
    // people to unset the variable — the exact failure `store/NOTES.md` names
    // for the config door.
    for (const env of [{}, { [GUARD]: "1" }, { [GUARD]: "0" }, { [GUARD]: "banana" }]) {
      const gate = v2DataDirGate(NAMED, env);
      expect(`${JSON.stringify(env)} → ${gate.refused} ${gate.lines.length}`).toBe(
        `${JSON.stringify(env)} → false 0`,
      );
    }
    expect(v2DataDirRefusal(NAMED, { [GUARD]: "1" })).toBeNull();
    expect(v2DataDirNotice(NAMED)).toBeNull();
  });

  test("UNARMED: the default stands, and stops being silent", () => {
    // Silence was the defect. The path is not wrong — it is the path the run
    // actually uses — it was simply never in the transcript, so nobody could
    // see that a live store had been chosen for them.
    const gate = v2DataDirGate(UNNAMED, {});
    expect(gate.refused).toBe(false);
    expect(gate.lines).toHaveLength(1);
    expect(gate.lines[0]).toContain("--v2-data-dir");
    expect(gate.lines[0]).toContain(UNNAMED.dir);
    // `off` means off here exactly as it does at the store door: a guard whose
    // `=0` refused would trip the shell of the person it protects.
    for (const value of ["0", "false", "off", "OFF", ""]) {
      const off = v2DataDirGate(UNNAMED, { [GUARD]: value });
      expect(`${JSON.stringify(value)} → ${off.refused}`).toBe(`${JSON.stringify(value)} → false`);
      expect(off.lines).toHaveLength(1);
    }
  });

  test("ARMED: the default is REFUSED by name, in the guard's whole vocabulary", () => {
    for (const value of ["1", "true", "on", "ON", " True ", "\t1\n"]) {
      const gate = v2DataDirGate(UNNAMED, { [GUARD]: value });
      expect(`${JSON.stringify(value)} → ${gate.refused}`).toBe(`${JSON.stringify(value)} → true`);
      expect(gate.lines).toHaveLength(1);
      // The sentence carries all three: what armed it, which flag answers it,
      // and the path it would otherwise have used.
      expect(gate.lines[0]).toContain(GUARD);
      expect(gate.lines[0]).toContain("--v2-data-dir");
      expect(gate.lines[0]).toContain(UNNAMED.dir);
    }
  });

  test("JUNK is refused too, in the guard's OWN words — the two doors teach one lesson", () => {
    // Not this module's sentence: `explicitDirMalformedRefusal`, the same
    // string the store throws, so `=yes` gets an identical explanation wherever
    // it is met.
    const gate = v2DataDirGate(UNNAMED, { [GUARD]: "yes" });
    expect(gate.refused).toBe(true);
    expect(gate.lines[0]).toBe(explicitDirMalformedRefusal("yes"));
  });

  /**
   * THE BINS' HALF. Exit codes only exist at the bin, and the claim that must
   * hold is not merely "exit 2" — it is that the refusal costs NOTHING: no
   * realpath of a live store, no mkdir of the run dir, no record. So the run
   * directory named is one that does not exist, and it must still not exist
   * afterwards.
   *
   * The suite's own environment arms the guard (`test/preload.ts`) and a
   * spawned child inherits it — which is exactly the class of process this
   * ruling is for.
   */
  test("all three BINS refuse an unnamed --v2-data-dir under the armed guard, having done nothing", () => {
    const binDir = join(dirname(fileURLToPath(import.meta.url)), "..", "tools", "parallel", "bin");
    const cases: readonly (readonly [string, readonly string[]])[] = [
      ["restart.ts", ["--date", "2026-09-10", "--reason", "a fix landed"]],
      ["daily.ts", ["--date", "2026-09-10"]],
      ["preflight.ts", []],
    ];
    for (const [name, extra] of cases) {
      const runDir = join(root, `never-created-${name}`);
      expect(existsSync(runDir)).toBe(false);
      const out = spawnSync(process.execPath, [join(binDir, name), "--run-dir", runDir, ...extra], {
        encoding: "utf8",
        env: { ...process.env, [GUARD]: "1" },
      });
      expect(`${name} → ${out.status}: ${out.stderr}`).toContain("--v2-data-dir");
      expect(`${name} → ${out.status}`).toBe(`${name} → 2`);
      expect(`${name}: ${out.stderr}`).toContain(GUARD);
      // NOTHING HAPPENED. Not the run dir, not a record, not a resolved path.
      expect(`${name} created ${runDir}: ${existsSync(runDir)}`).toBe(
        `${name} created ${runDir}: false`,
      );
      expect(`${name} stdout: ${out.stdout}`).toBe(`${name} stdout: `);
    }
  });

  /**
   * A BLANK VALUE IS A MISSING VALUE (the #87 reviewer). The bins' parser
   * already rules that "a value that starts with `--` is a MISSING value, not a
   * value"; the other way a flag arrives carrying nothing is
   * `--v2-data-dir "$LIVE"` with `LIVE` unset, which the shell hands over as an
   * empty argument. `parseArgs` records that as NAMED, so before this the gate
   * announced nothing and refused nothing — and `resolve("")`, the CURRENT
   * WORKING DIRECTORY, became the live store the run dir's overlap check was
   * measured against. One place answers it, the gate, for all three bins.
   */
  test("a BLANK --v2-data-dir is a MISSING one: ARMED, it is refused like the unnamed default", () => {
    for (const dir of ["", " ", "\t\n "]) {
      const gate = v2DataDirGate({ dir, named: true }, { [GUARD]: "1" });
      expect(`${JSON.stringify(dir)} → ${gate.refused}`).toBe(`${JSON.stringify(dir)} → true`);
      expect(gate.lines).toHaveLength(1);
      expect(gate.lines[0]).toContain(GUARD);
      expect(gate.lines[0]).toContain("--v2-data-dir");
    }
    // Only blank. A path with a space IN it is a path somebody typed.
    expect(v2DataDirGate({ dir: "/tmp/two words", named: true }, { [GUARD]: "1" }).refused).toBe(
      false,
    );
  });

  test("a BLANK --v2-data-dir is a MISSING one: UNARMED, it is announced as the default", () => {
    // Unarmed the default stands — but it stops being silent, exactly as when
    // the flag was never typed. `gate.lines` is verbatim what the bin writes to
    // stderr.
    for (const env of [{}, { [GUARD]: "0" }, { [GUARD]: "off" }, { [GUARD]: "" }]) {
      const gate = v2DataDirGate({ dir: "", named: true }, env);
      expect(`${JSON.stringify(env)} → ${gate.refused}`).toBe(`${JSON.stringify(env)} → false`);
      expect(gate.lines).toHaveLength(1);
      expect(gate.lines[0]).toContain("NOTE");
      expect(gate.lines[0]).toContain("--v2-data-dir");
    }
  });

  test("all three BINS refuse a BLANK --v2-data-dir under the armed guard, having done nothing", () => {
    // The bins' half of the same claim, held to the same standard as the
    // unnamed case above: the refusal must cost NOTHING, so the run directory
    // named does not exist before and must not exist after.
    const binDir = join(dirname(fileURLToPath(import.meta.url)), "..", "tools", "parallel", "bin");
    const cases: readonly (readonly [string, string, readonly string[]])[] = [
      ["restart.ts", "", ["--date", "2026-09-10", "--reason", "a fix landed"]],
      ["daily.ts", " ", ["--date", "2026-09-10"]],
      ["preflight.ts", "", []],
    ];
    for (const [name, blank, extra] of cases) {
      const runDir = join(root, `never-created-blank-${name}`);
      expect(existsSync(runDir)).toBe(false);
      const out = spawnSync(
        process.execPath,
        [join(binDir, name), "--run-dir", runDir, "--v2-data-dir", blank, ...extra],
        { encoding: "utf8", env: { ...process.env, [GUARD]: "1" } },
      );
      expect(`${name} → ${out.status}: ${out.stderr}`).toContain("--v2-data-dir");
      expect(`${name} → ${out.status}`).toBe(`${name} → 2`);
      expect(`${name}: ${out.stderr}`).toContain(GUARD);
      expect(`${name} created ${runDir}: ${existsSync(runDir)}`).toBe(
        `${name} created ${runDir}: false`,
      );
      expect(`${name} stdout: ${out.stdout}`).toBe(`${name} stdout: `);
    }
  });

  test("only v2's path gets this — v1's and engram's are covered by the FORBIDDEN list instead", () => {
    // The asymmetry is the point, and it is structural rather than a judgement
    // call. `~/.bansai` and `~/.claude-engram` are on
    // `store/paths.ts#FORBIDDEN_ROOT_NAMES`, so every store-open path in the
    // product refuses them by realpath with no variable involved: a silent
    // default there cannot become an opened store. `~/.counterparts` is
    // deliberately NOT on that list — the store has to be able to open its own
    // default — which is the whole reason the explicit-dir guard exists, and
    // the reason v2's is the one path here that a default leaves uncovered.
    // `--ab-dir` is an assignment file, not a store, and answers to
    // `MEMORY_AB_DIR` already.
    expect(FORBIDDEN_ROOT_NAMES).toContain(".bansai");
    expect(FORBIDDEN_ROOT_NAMES).toContain(".claude-engram");
    expect(FORBIDDEN_ROOT_NAMES as readonly string[]).not.toContain(".counterparts");
    // And the bins still carry every default, so this ruling changed what is
    // SAID about an unnamed path, not which paths the tool knows.
    for (const name of ["preflight.ts", "daily.ts", "restart.ts"]) {
      const src = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "tools", "parallel", "bin", name),
        "utf8",
      );
      expect(`${name}:.bansai:${src.includes(".bansai")}`).toBe(`${name}:.bansai:true`);
      expect(`${name}:.counterparts:${src.includes(".counterparts")}`).toBe(
        `${name}:.counterparts:true`,
      );
    }
  });
});

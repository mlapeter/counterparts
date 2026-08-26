/**
 * `tools/replay/` — the validation harness, exercised against synthesized
 * fixtures.
 *
 * NOTHING HERE TOUCHES A REAL CORPUS. The real one lives outside the repo
 * (`~/counterparts-replay-corpus/`), v1's live store is `~/.bansai`, and both are
 * off-limits to this suite by CLAUDE.md and by `store/paths.ts`'s structural
 * refusal. Every corpus below is written into a fresh temp directory shaped like
 * the inventory in `docs/harvest/replay-baselines.md` §2, and removed after.
 *
 * The properties this suite exists to hold:
 *   - the reader never writes (proved by a write probe AND a byte-identity check
 *     across a full run);
 *   - the driver refuses a pre-set data-directory variable rather than honoring
 *     it (scar §2.13);
 *   - the same fixture twice renders the same report;
 *   - the comparator's four verdicts each happen, including `not-exercised`;
 *   - no fixture body string reaches a rendered report or a pass record;
 *   - the decay three-way separates on a corpus designed to separate it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { InterpretFn, SweepChunk } from "../src/core/remember/index.js";
import { Store } from "../src/core/store/index.js";

import {
  BASELINES_DOC,
  Corpus,
  CorpusError,
  DriverError,
  HARNESS_VERSION,
  METRICS,
  REFERENCE_SHAPE,
  ReportError,
  assertNoPresetDataDir,
  contentAddress,
  decayShapes,
  digestOf,
  documentSections,
  gateOpen,
  manifest,
  passRecord,
  renderReport,
  replay,
  runReplay,
  scoreMetric,
  scoreRun,
  totality,
} from "../tools/replay/index.js";
import type { MetricSpec, ReplayObservation, RunRecord } from "../tools/replay/types.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const BUDGET_BYTES = 9000;
const FIXED_NOW = 1_756_000_000_000;

/** Distinctive strings planted in every fixture span and in every minted
 *  memory. A report that contains one of these is leaking content. */
const SPAN_MARKER = "ZQSPANMARKERALPHA";
const MINT_MARKER = "ZQMINTMARKERBRAVO";

let work: string;
let priorEnv: string | undefined;

beforeEach(() => {
  priorEnv = process.env[ENV];
  // Guarantee 1: the driver ERRORS on a pre-set data dir. The suite therefore
  // clears it, and restores whatever sibling suites in this process rely on.
  delete process.env[ENV];
  work = mkdtempSync(join(tmpdir(), "counterparts-replaytest-"));
});

afterEach(() => {
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(work, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fixture corpora — v1-shaped, synthesized, tiny
// ═══════════════════════════════════════════════════════════════════════════

interface FixtureOptions {
  /** Add a line that parses as JSON but is not a span. */
  readonly malformedSpan?: boolean;
  /** Add a file under a day dir the reader should not recognize. */
  readonly strayFile?: boolean;
  /** Write one span with `role` instead of `kind` (format drift, counted). */
  readonly roleOnly?: boolean;
  /** Write an `index.sqlite` with two embedding generations. */
  readonly index?: boolean;
  /** Leave a `-wal` sidecar beside the index. */
  readonly wal?: boolean;
  /** Add a jot span. */
  readonly jot?: boolean;
}

const DAYS = ["2026-07-27", "2026-07-29", "2026-07-30"];

/** Long enough that a claim clears `MIN_CLAIM_BYTES` and the content floor. */
function spanText(day: string, session: string, n: number): string {
  return (
    `${SPAN_MARKER} On ${day} in session ${session} we settled part ${n} of the storage split: ` +
    "canonical prose stays on disk in a form any editor can open, one small operational " +
    "database carries the state that must be transactional, and the cache is rebuildable " +
    "so it never enters the backup set. The reason it matters is that a backup nobody can " +
    "verify is a backup nobody has, and the same is true of a memory nobody can read."
  );
}

function writeFixtureCorpus(dir: string, opts: FixtureOptions = {}): string {
  mkdirSync(join(dir, "buffer-archive"), { recursive: true });
  mkdirSync(join(dir, "logs"), { recursive: true });

  let activeDay = 154;
  let at = 1_753_000_000_000;

  for (const date of DAYS) {
    const dayDir = join(dir, "buffer-archive", date);
    mkdirSync(dayDir, { recursive: true });
    const lines: string[] = [];
    for (const session of [`ses_${date}_a`, `ses_${date}_b`]) {
      for (let n = 0; n < 3; n++) {
        at += 1000;
        const text = spanText(date, session, n);
        lines.push(
          JSON.stringify({
            hash: contentAddress(text),
            session,
            scope: "proj-replay",
            kind: n % 2 === 0 ? "conversation" : "assistant",
            text,
            at,
            day: activeDay,
            from: n,
            to: n + 1,
          }),
        );
      }
    }
    if (opts.roleOnly === true && date === DAYS[0]) {
      at += 1000;
      const text = spanText(date, "ses_role", 9);
      lines.push(
        JSON.stringify({
          hash: contentAddress(text),
          session: `ses_${date}_a`,
          scope: "proj-replay",
          role: "assistant",
          text,
          at,
          day: activeDay,
        }),
      );
    }
    if (opts.jot === true && date === DAYS[0]) {
      at += 1000;
      const text = `${SPAN_MARKER} A deliberate jot: the harness must leave the store as it found it, which is the whole of the instrument rule.`;
      lines.push(
        JSON.stringify({
          hash: contentAddress(text),
          session: `ses_${date}_a`,
          scope: "proj-replay",
          kind: "jot",
          text,
          at,
          day: activeDay,
        }),
      );
    }
    if (opts.malformedSpan === true && date === DAYS[0]) {
      lines.push(JSON.stringify({ nothing: "that looks like a span" }));
    }
    writeFileSync(join(dayDir, "spans.jsonl"), `${lines.join("\n")}\n`, "utf8");
    if (opts.strayFile === true && date === DAYS[0]) {
      writeFileSync(join(dayDir, "README.txt"), "not a span file\n", "utf8");
    }

    // The event log: content-by-reference, exactly as v1 wrote it.
    const events = [
      { at, event: "runner.start", data: { scope: "proj-replay", cycle: 1, activeDay } },
      { at: at + 1, event: "buffer.claim", data: { spans: 6, bytes: 4200 } },
      { at: at + 2, event: "interpret.done", data: { chunkBytes: 4200, traces: 2, schemasShown: 2 } },
      { at: at + 3, event: "encode.gated", data: { gate: "secrets", where: "trace" } },
      { at: at + 4, event: "decay.tick", data: { nodes: 1718 } },
      { at: at + 5, event: "runner.done", data: { scope: "proj-replay", cycle: 1 } },
    ];
    writeFileSync(
      join(dir, "logs", `events-${date}.jsonl`),
      `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
      "utf8",
    );
    activeDay += 1;
  }

  if (opts.index === true) writeIndex(join(dir, "index.sqlite"));
  if (opts.wal === true) writeFileSync(`${join(dir, "index.sqlite")}-wal`, "", "utf8");
  return dir;
}

/** A tiny v1-shaped cache: `embeddings` keyed `(node_id, model)`, two models. */
function writeIndex(path: string): void {
  const require_ = createRequire(import.meta.url);
  const { Database } = require_("bun:sqlite") as {
    Database: new (p: string, o?: unknown) => {
      exec(sql: string): unknown;
      close(): unknown;
    };
  };
  const db = new Database(path, { create: true });
  // DELETE, never WAL: a WAL corpus sprouts sidecars a reader can grow, which
  // is exactly what the byte-identity guarantee forbids.
  db.exec("PRAGMA journal_mode = DELETE");
  db.exec("CREATE TABLE embeddings (node_id TEXT, model TEXT, PRIMARY KEY (node_id, model))");
  db.exec(
    "INSERT INTO embeddings (node_id, model) VALUES ('mem_a','voyage-3-large'),('mem_b','voyage-3-large'),('mem_a','voyage-3.5')",
  );
  db.close();
}

/** Deterministic, and it never echoes a span: it "interprets". */
function fakeInterpret(stopReason = "end_turn"): InterpretFn {
  return async (chunk: SweepChunk) => ({
    stopReason,
    proposals: [
      {
        content:
          `${MINT_MARKER} The storage split settled in ${chunk.spans[0]?.session ?? "unknown"} chunk ${chunk.index}: ` +
          "canonical prose on disk, one operational database, and a cache that is never backed up because it rebuilds.",
        kind: "fact",
      },
      {
        content:
          `${MINT_MARKER} A backup nobody can verify is a backup nobody has, which is why the backup set stays small enough to check by hand (chunk ${chunk.index}).`,
        kind: "fact",
      },
    ],
  });
}

function corpusDir(name: string, opts: FixtureOptions = {}): string {
  return writeFixtureCorpus(join(work, name), opts);
}

async function runFixture(
  name: string,
  opts: FixtureOptions = {},
  overrides: { interpret?: InterpretFn; seat?: string; vectors?: string } = {},
): Promise<Awaited<ReturnType<typeof replay>>> {
  return replay({
    corpusDir: corpusDir(name, { index: true, ...opts }),
    interpret: overrides.interpret ?? fakeInterpret(),
    seat: overrides.seat ?? "deterministic-fake",
    vectors: overrides.vectors ?? "none",
    budgetBytes: BUDGET_BYTES,
    workRoot: work,
    minBytes: 100,
    now: () => FIXED_NOW,
    pinModel: "voyage-3-large",
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The corpus reader — READ-ONLY, and tolerant with a counter
// ═══════════════════════════════════════════════════════════════════════════

describe("the corpus reader", () => {
  test("reads a v1-shaped snapshot: day dirs of spans, jsonl event logs, an index", () => {
    const corpus = Corpus.open(corpusDir("plain", { index: true }));
    const summary = corpus.summary();

    expect(corpus.days()).toEqual(DAYS);
    expect(summary.days).toBe(3);
    expect(summary.spans).toBe(18);
    expect(summary.sessions).toBe(6);
    expect(summary.scopes).toBe(1);
    expect(summary.eventFiles).toBe(3);
    expect(summary.eventLines).toBe(18);
    // The LIVED-day clock, read from the log rather than assumed (scar E8).
    expect(summary.activeDays).toBe(3);
    expect(summary.indexPresent).toBe(true);
    expect(summary.embeddingModels["voyage-3-large"]).toBe(2);
    expect(summary.embeddingModels["voyage-3.5"]).toBe(1);
    corpus.close();
  });

  test("format drift is TOLERATED AND COUNTED — never a silent drop", () => {
    const corpus = Corpus.open(
      corpusDir("drift", { malformedSpan: true, strayFile: true, roleOnly: true }),
    );
    const s = corpus.summary();
    expect(s.malformedSpans).toBe(1);
    expect(s.unrecognizedSpanFiles).toBe(1);
    // A span spelled with `role` instead of `kind` is read, and the assumption
    // is a number the report prints.
    expect(s.assumedKind).toBe(1);
    expect(s.spans).toBe(19);
    corpus.close();
  });

  test("spans come back in a deterministic order, not readdir order", () => {
    const dir = corpusDir("order");
    const a = Corpus.open(dir).spans(DAYS[0] ?? "");
    const b = Corpus.open(dir).spans(DAYS[0] ?? "");
    expect(a.map((s) => s.hash)).toEqual(b.map((s) => s.hash));
  });

  test("the sqlite handle REFUSES a write — proved, not promised (guarantee 2)", () => {
    const corpus = Corpus.open(corpusDir("probe", { index: true }));
    expect(corpus.probeWriteRefused()).toBe(true);
    corpus.close();
  });

  test("a WAL-mode index is REFUSED rather than read (it would grow sidecars)", () => {
    const corpus = Corpus.open(corpusDir("wal", { index: true, wal: true }));
    expect(() => corpus.embeddingModels()).toThrow(CorpusError);
    corpus.close();
  });

  test("a missing corpus is a loud error, not an empty read", () => {
    expect(() => Corpus.open(join(work, "nope"))).toThrow(CorpusError);
  });

  test("the content address is one function, and it is stable", () => {
    expect(contentAddress("the same text")).toBe(contentAddress("the same text"));
    expect(contentAddress("a")).not.toBe(contentAddress("b"));
    expect(contentAddress("a")).toHaveLength(16);
  });

  test("THE CORPUS IS BYTE-IDENTICAL AFTER A FULL RUN", async () => {
    const dir = corpusDir("readonly", { index: true, jot: true });
    const before = manifest(dir);
    const run = await replay({
      corpusDir: dir,
      interpret: fakeInterpret(),
      seat: "deterministic-fake",
      vectors: "voyage-3-large",
      budgetBytes: BUDGET_BYTES,
      workRoot: work,
      minBytes: 100,
      now: () => FIXED_NOW,
      pinModel: "voyage-3-large",
    });
    run.cleanup();
    const after = manifest(dir);
    expect(after).toEqual(before);
    expect(digestOf(after)).toBe(digestOf(before));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The driver — isolation, and the real host path
// ═══════════════════════════════════════════════════════════════════════════

describe("the pipeline driver", () => {
  test("a pre-set data-directory variable is an ERROR, never an instruction (scar §2.13)", () => {
    process.env[ENV] = join(work, "somewhere");
    expect(() => assertNoPresetDataDir()).toThrow(DriverError);
    delete process.env[ENV];
    expect(() => assertNoPresetDataDir()).not.toThrow();
  });

  test("the driver refuses to run while the variable is set, and runs when it is not", async () => {
    const dir = corpusDir("envguard");
    process.env[ENV] = join(work, "somewhere");
    const corpus = Corpus.open(dir);
    await expect(
      runReplay({
        corpus,
        interpret: fakeInterpret(),
        seat: "deterministic-fake",
        vectors: "none",
        budgetBytes: BUDGET_BYTES,
        workRoot: work,
      }),
    ).rejects.toThrow(DriverError);
    delete process.env[ENV];
    const run = await runReplay({
      corpus,
      interpret: fakeInterpret(),
      seat: "deterministic-fake",
      vectors: "none",
      budgetBytes: BUDGET_BYTES,
      workRoot: work,
      minBytes: 100,
    });
    expect(existsSync(run.storeDir)).toBe(true);
    run.cleanup();
    expect(existsSync(run.storeDir)).toBe(false);
    corpus.close();
  });

  test("the seat, the vector generation and the host ceiling are REQUIRED", async () => {
    const corpus = Corpus.open(corpusDir("required"));
    const base = {
      corpus,
      interpret: fakeInterpret(),
      budgetBytes: BUDGET_BYTES,
      workRoot: work,
    };
    await expect(runReplay({ ...base, seat: "", vectors: "none" })).rejects.toThrow(DriverError);
    await expect(runReplay({ ...base, seat: "x", vectors: "" })).rejects.toThrow(DriverError);
    await expect(
      runReplay({ ...base, seat: "x", vectors: "none", budgetBytes: 0 }),
    ).rejects.toThrow(DriverError);
    corpus.close();
  });

  test("it replays day by day and mints through the crash-fallback path", async () => {
    const result = await runFixture("drive", { jot: true });
    const o = result.run.observation;
    expect(o.days).toHaveLength(3);
    expect(o.days.map((d) => d.date)).toEqual(DAYS);
    // The lived-day clock advances once per day actually lived (scar E8).
    expect(o.days.map((d) => d.livedDay)).toEqual([1, 2, 3]);
    expect(o.cycles).toHaveLength(3);
    expect(o.chunks.length).toBeGreaterThan(0);
    expect(o.chunks.every((c) => c.ok)).toBe(true);
    expect(o.store.memories).toBeGreaterThan(0);
    expect(result.run.record.seat).toBe("deterministic-fake");
    expect(result.run.record.readOnlyProof).toBe(true);
    result.cleanup();
  });

  test("a truncated interpreter response costs its chunk and nothing else (scar E2/E1)", async () => {
    const result = await runFixture("truncated", {}, { interpret: fakeInterpret("max_tokens") });
    const o = result.run.observation;
    expect(o.chunks.length).toBeGreaterThan(0);
    expect(o.chunks.every((c) => !c.ok)).toBe(true);
    expect(o.chunks.every((c) => c.reason === "TRUNCATED")).toBe(true);
    expect(o.store.memories).toBe(0);
    // The spans came back rather than being lost (E6) — the sweep restored them.
    expect(o.sweeps.some((s) => s.spansRestored > 0)).toBe(true);
    result.cleanup();
  });

  test("AN EMPTY CHUNK DOES NOT STEAL ITS NEIGHBOUR'S GATE VERDICT", async () => {
    // `fallback.ts` short-circuits to EMPTY *before* `apply`, so an empty chunk
    // emits no gate event at all — and v1's zero-yield rate was 16.4%, so this
    // is the common case. A cursor that zipped gate events to chunks by
    // position would hand chunk 1 the record belonging to chunk 2 and shift
    // everything after it, silently corrupting the blind rate. Small chunks
    // here so one sweep carries several.
    const alternating: InterpretFn = async (chunk: SweepChunk) => {
      if (chunk.index % 2 === 0) return { stopReason: "end_turn", proposals: [] };
      return fakeInterpret()(chunk);
    };
    const result = await replay({
      corpusDir: corpusDir("emptychunks"),
      interpret: alternating,
      seat: "deterministic-fake",
      vectors: "none",
      budgetBytes: BUDGET_BYTES,
      workRoot: work,
      minBytes: 100,
      chunkBytes: 400,
      now: () => FIXED_NOW,
    });
    const chunks = result.run.observation.chunks;
    const empty = chunks.filter((ch) => ch.reason === "EMPTY");
    const applied = chunks.filter((ch) => ch.reason === "APPLIED");
    expect(empty.length).toBeGreaterThan(1);
    expect(applied.length).toBeGreaterThan(1);

    // An empty chunk is "not asked", not "asked and refused".
    for (const ch of empty) {
      expect(ch.gated).toBe(false);
      expect(ch.accepted + ch.refused + ch.minted).toBe(0);
      expect(ch.blind).toBe(false);
    }
    // Every applied chunk kept its OWN verdict, interleaving notwithstanding.
    for (const ch of applied) {
      expect(ch.gated).toBe(true);
      expect(ch.proposals).toBe(2);
      expect(ch.minted).toBeGreaterThan(0);
      expect(ch.accepted).toBeGreaterThan(0);
    }
    // And the gate metrics count only the chunks that actually reached a gate.
    const blindRate = result.scorecard.metrics.find((m) => m.id === "preselect.blindRate");
    expect(blindRate?.observed?.denominator).toBe(applied.length);
    result.cleanup();
  });

  test("THE SAME FIXTURE TWICE RENDERS THE SAME REPORT", async () => {
    const dir = corpusDir("determinism", { index: true });
    const opts = {
      corpusDir: dir,
      interpret: fakeInterpret(),
      seat: "deterministic-fake",
      vectors: "voyage-3-large",
      budgetBytes: BUDGET_BYTES,
      workRoot: work,
      minBytes: 100,
      now: () => FIXED_NOW,
      pinModel: "voyage-3-large",
    };
    const a = await replay(opts);
    const b = await replay(opts);
    expect(b.report).toBe(a.report);
    expect(b.pass).toEqual(a.pass);
    expect(b.run.record.runId).toBe(a.run.record.runId);
    // Different store dirs, identical report: the store path is not evidence.
    expect(b.run.storeDir).not.toBe(a.run.storeDir);
    a.cleanup();
    b.cleanup();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The comparator — four verdicts, and range logic
// ═══════════════════════════════════════════════════════════════════════════

const EMPTY_OBSERVATION: ReplayObservation = {
  activeDays: 0,
  days: [],
  cycles: [],
  sweeps: [],
  chunks: [],
  events: [],
  store: {
    memories: 0,
    archived: 0,
    episodes: 0,
    schemas: 0,
    byKind: {},
    byBand: {},
    superseded: 0,
    livedDay: 0,
  },
  corpus: {
    dir: "/nowhere",
    days: 0,
    spanFiles: 0,
    spans: 0,
    spanBytes: 0,
    sessions: 0,
    scopes: 0,
    malformedSpans: 0,
    unrecognizedSpanFiles: 0,
    assumedKind: 0,
    eventFiles: 0,
    eventLines: 0,
    malformedEventLines: 0,
    eventNames: 0,
    activeDays: 0,
    indexPresent: false,
    embeddingModels: {},
    pinnedModel: null,
    pinnedRows: 0,
    digest: "0".repeat(64),
    files: 0,
  },
  seat: "test-seat",
  vectors: "none",
};

const RECORD: RunRecord = {
  runId: "run_test",
  at: FIXED_NOW,
  seat: "test-seat",
  vectors: "none",
  corpusDir: "/nowhere",
  corpusDigest: "0".repeat(64),
  budgetBytes: BUDGET_BYTES,
  storeDir: "/tmp/nowhere",
  harnessVersion: HARNESS_VERSION,
  readOnlyProof: true,
};

/** A stand-in baselines document for scorecards built from custom registries:
 *  without it the real doc's eleven §1 sections would trip totality for reasons
 *  the test is not about. */
const STUB_DOC = "### 1.1 A stub section\n";

function spec(partial: Partial<MetricSpec> & Pick<MetricSpec, "id" | "grading">): MetricSpec {
  return {
    section: "1.1",
    label: "a label",
    v1: "a v1 figure",
    unit: "rate",
    ...partial,
  } as MetricSpec;
}

describe("the comparator's four-value vocabulary", () => {
  test("a value inside the range PASSES; outside it FAILS", () => {
    const inside = spec({
      id: "inside",
      grading: { kind: "range", range: { lo: 0.1, hi: 0.35 } },
      compute: () => ({ value: 0.2, numerator: 2, denominator: 10 }),
    });
    const outside = spec({
      id: "outside",
      grading: { kind: "range", range: { lo: 0.1, hi: 0.35 } },
      compute: () => ({ value: 0.9, numerator: 9, denominator: 10 }),
    });
    expect(scoreMetric(inside, EMPTY_OBSERVATION).verdict).toBe("pass");
    expect(scoreMetric(outside, EMPTY_OBSERVATION).verdict).toBe("fail");
  });

  test("the range is INCLUSIVE at both ends — a bar is a bar", () => {
    const edge = (value: number): MetricSpec =>
      spec({
        id: `edge-${value}`,
        grading: { kind: "range", range: { lo: 0.1, hi: 0.35 } },
        compute: () => ({ value }),
      });
    expect(scoreMetric(edge(0.1), EMPTY_OBSERVATION).verdict).toBe("pass");
    expect(scoreMetric(edge(0.35), EMPTY_OBSERVATION).verdict).toBe("pass");
    expect(scoreMetric(edge(0.0999), EMPTY_OBSERVATION).verdict).toBe("fail");
  });

  test("AN EMPTY DENOMINATOR IS NOT-EXERCISED, never a zero that passes", () => {
    const never = spec({
      id: "never-asked",
      grading: { kind: "range", range: { lo: 0, hi: 1 } },
      compute: () => null,
    });
    const result = scoreMetric(never, EMPTY_OBSERVATION);
    expect(result.verdict).toBe("not-exercised");
    expect(result.reason).toBe("no-denominator");
    expect(result.why).not.toBeNull();
  });

  test("not-computable and not-comparable are not-exercised WITH A REASON", () => {
    const nc = scoreMetric(
      spec({ id: "nc", grading: { kind: "not-computable", why: "no relay for it" } }),
      EMPTY_OBSERVATION,
    );
    expect(nc.verdict).toBe("not-exercised");
    expect(nc.reason).toBe("not-computable");
    expect(nc.why).toBe("no relay for it");

    const ncmp = scoreMetric(
      spec({ id: "ncmp", grading: { kind: "not-comparable", why: "another seat" } }),
      EMPTY_OBSERVATION,
    );
    expect(ncmp.verdict).toBe("not-exercised");
    expect(ncmp.reason).toBe("not-comparable");
  });

  test("a human-rated criterion returns NEEDS-RATER, never a machine pass", () => {
    const rated = scoreMetric(
      spec({ id: "rated", grading: { kind: "rater", bar: "≤5%, human-rated" } }),
      EMPTY_OBSERVATION,
    );
    expect(rated.verdict).toBe("needs-rater");
    expect(rated.observed).toBeNull();
  });

  test("a range with NO SCORER can never pass — it is not-exercised and trips totality", () => {
    const hollow = spec({ id: "hollow", grading: { kind: "range", range: { lo: 0, hi: 1 } } });
    const card = scoreRun(EMPTY_OBSERVATION, RECORD, [hollow], STUB_DOC);
    expect(card.metrics[0]?.verdict).toBe("not-exercised");
    expect(card.totality.unaccounted).toEqual(["hollow"]);
    expect(card.totality.ok).toBe(false);
    expect(card.clean).toBe(false);
  });

  test("A RUN CONTAINING A NOT-EXERCISED IS NOT A CLEAN PASS (guarantee 4)", () => {
    const passing = spec({
      id: "passing",
      grading: { kind: "range", range: { lo: 0, hi: 1 } },
      compute: () => ({ value: 0.5 }),
    });
    const skipped = spec({ id: "skipped", grading: { kind: "not-computable", why: "no path" } });
    expect(scoreRun(EMPTY_OBSERVATION, RECORD, [passing], STUB_DOC).clean).toBe(true);
    const mixed = scoreRun(EMPTY_OBSERVATION, RECORD, [passing, skipped], STUB_DOC);
    expect(mixed.counts.pass).toBe(1);
    expect(mixed.counts["not-exercised"]).toBe(1);
    expect(mixed.clean).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The totality tripwire — source-scan the doc, don't trust a list
// ═══════════════════════════════════════════════════════════════════════════

describe("the totality tripwire", () => {
  test("EVERY §1 SECTION OF replay-baselines.md HAS AT LEAST ONE METRIC", () => {
    const t = totality();
    expect(t.unclaimedSections).toEqual([]);
    expect(t.unknownSections).toEqual([]);
    expect(t.unaccounted).toEqual([]);
    expect(t.ok).toBe(true);
  });

  test("a new section in the baselines document TRIPS it", () => {
    const doc = `${readFileSync(BASELINES_DOC, "utf8")}\n### 1.99 A newly measured thing\n`;
    expect(documentSections(doc)).toContain("1.99");
    expect(totality(METRICS, doc).unclaimedSections).toEqual(["1.99"]);
    expect(totality(METRICS, doc).ok).toBe(false);
  });

  test("a metric citing a section the document does not have TRIPS it", () => {
    const stray = spec({
      id: "stray",
      section: "9.9",
      grading: { kind: "not-computable", why: "n/a" },
    });
    expect(totality([stray]).unknownSections).toEqual(["9.9"]);
  });

  test("every registered metric either computes or says why not", () => {
    for (const m of METRICS) {
      const declares =
        m.grading.kind === "not-computable" ||
        m.grading.kind === "not-comparable" ||
        m.grading.kind === "rater";
      expect(declares || m.compute !== undefined).toBe(true);
      if (m.grading.kind === "not-computable" || m.grading.kind === "not-comparable") {
        expect(m.grading.why.length).toBeGreaterThan(40);
      }
    }
  });

  test("metric ids are unique", () => {
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The independent-scorer rule (guarantee 5)
// ═══════════════════════════════════════════════════════════════════════════

describe("the scorer grades with its own arithmetic", () => {
  test("the comparator, the registry, the renderer and the vocabulary import NO src/ module", () => {
    for (const file of ["compare.ts", "baselines.ts", "report.ts", "types.ts"]) {
      const src = readFileSync(
        fileURLToPath(new URL(`../tools/replay/${file}`, import.meta.url)),
        "utf8",
      );
      const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
      expect(code).not.toContain("src/core");
      expect(/from\s+["'][^"']*\/src\//.test(code)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. The report — numbers, never text
// ═══════════════════════════════════════════════════════════════════════════

describe("the report renderer", () => {
  test("NO FIXTURE BODY STRING REACHES THE REPORT OR THE PASS RECORD", async () => {
    const result = await runFixture("nobody", { jot: true });
    // The run really did carry the markers through the pipeline...
    expect(result.run.observation.store.memories).toBeGreaterThan(0);
    const stored = result.run.counterpart.store;
    const ids = stored.list({ type: "memory" });
    const first = ids[0];
    expect(first).toBeDefined();
    if (first !== undefined) expect(stored.readProse(first).body).toContain(MINT_MARKER);

    // ...and none of it is in the report.
    expect(result.report).not.toContain(SPAN_MARKER);
    expect(result.report).not.toContain(MINT_MARKER);
    expect(result.report).not.toContain("storage split");
    const json = JSON.stringify(result.pass);
    expect(json).not.toContain(SPAN_MARKER);
    expect(json).not.toContain(MINT_MARKER);
    result.cleanup();
  });

  test("the report states the seat, the pinned vectors, the ceiling and the read-only proof", async () => {
    const result = await runFixture("record", {}, { vectors: "voyage-3-large" });
    expect(result.report).toContain("acting seat     deterministic-fake");
    expect(result.report).toContain("vectors pinned  voyage-3-large");
    expect(result.report).toContain(`host ceiling    ${BUDGET_BYTES} B`);
    expect(result.report).toContain("read-only proof sqlite refused");
    result.cleanup();
  });

  test("format drift is PRINTED, so first contact with the real corpus shows a number", async () => {
    const result = await runFixture("driftreport", {
      malformedSpan: true,
      strayFile: true,
      roleOnly: true,
    });
    expect(result.report).toContain("format drift: malformed spans 1");
    expect(result.report).toContain("unrecognized span files 1");
    expect(result.report).toContain("assumed kind 1");
    result.cleanup();
  });

  test("every one of the four verdicts is legible in the rendered scorecard", async () => {
    const result = await runFixture("verdicts");
    expect(result.report).toContain("N/EX");
    expect(result.report).toContain("RATER");
    expect(result.report).toContain("NOT A CLEAN PASS");
    expect(result.scorecard.counts["not-exercised"]).toBeGreaterThan(0);
    expect(result.scorecard.counts["needs-rater"]).toBeGreaterThan(0);
    expect(result.scorecard.clean).toBe(false);
    result.cleanup();
  });

  test("a scorecard with an unaccounted metric THROWS rather than rendering a blank", () => {
    const hollow = spec({ id: "hollow", grading: { kind: "range", range: { lo: 0, hi: 1 } } });
    const card = scoreRun(EMPTY_OBSERVATION, RECORD, [hollow], STUB_DOC);
    expect(() => renderReport({ scorecard: card, observation: EMPTY_OBSERVATION })).toThrow(
      ReportError,
    );
    expect(() => passRecord({ scorecard: card, observation: EMPTY_OBSERVATION })).toThrow(
      ReportError,
    );
  });

  test("THE GATE IS A PRECONDITION: an unclean run does not open it", async () => {
    const result = await runFixture("gate");
    expect(gateOpen(result.pass, HARNESS_VERSION)).toBe(false);
    const clean = { ...result.pass, clean: true, totalityOk: true };
    expect(gateOpen(clean, HARNESS_VERSION)).toBe(true);
    // A pass record from another harness version does not open this gate.
    expect(gateOpen(clean, "replay/999")).toBe(false);
    result.cleanup();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Decay shapes — physics open question 1
// ═══════════════════════════════════════════════════════════════════════════

describe("the decay three-way (physics OQ1)", () => {
  function seededStore(dir: string): Store {
    const store = Store.open({ dir });
    // A spread of last-used days is what makes the curves separate: at dt = 0
    // all three are 1.0 by construction, so a corpus of fresh memories cannot
    // decide the question — and the report says so rather than pretending.
    for (let i = 0; i < 12; i++) {
      store.put({
        type: "memory",
        kind: "fact",
        body: `A recorded fact number ${i} about the way the storage split was settled and why it holds.`,
        salience: { novelty: null, relevance: 0.9, emotional: 0.7, predictive: 0.8 },
        physics: { birthDay: 0, lastUsedDay: i * 10 },
      });
    }
    return store;
  }

  test("three shapes produce three different curves on a corpus designed to diverge", () => {
    const dir = mkdtempSync(join(work, "decay-"));
    const store = seededStore(dir);
    const report = decayShapes(store, { day: 120 });

    expect(report.rows).toBe(12);
    expect(report.shapes).toEqual(["flat", "exponential", "power-law"]);
    const means = report.census.map((c) => c.meanStrength);
    expect(new Set(means.map((m) => m.toFixed(6))).size).toBe(3);
    // Flat is the harshest at long intervals, power-law the gentlest — the
    // Ebbinghaus/Wixted/Jost ordering, and the reason engram moved to it.
    const flat = report.census.find((c) => c.shape === "flat")?.meanStrength ?? 0;
    const exponential = report.census.find((c) => c.shape === "exponential")?.meanStrength ?? 0;
    const power = report.census.find((c) => c.shape === "power-law")?.meanStrength ?? 0;
    expect(flat).toBeLessThan(exponential);
    expect(exponential).toBeLessThan(power);
    expect(report.distinguishable).toBe(true);
    expect(report.maxMeanAbsDelta).toBeGreaterThan(0);
    store.close();
  });

  test("the band census differs between shapes — the divergence that matters", () => {
    const dir = mkdtempSync(join(work, "decay-band-"));
    const store = seededStore(dir);
    const report = decayShapes(store, { day: 120 });
    const shapes = new Set(report.census.map((c) => JSON.stringify(c.bands)));
    expect(shapes.size).toBeGreaterThan(1);
    expect(report.totalBandFlips).toBeGreaterThan(0);
    expect(report.perBand.length).toBeGreaterThan(0);
    store.close();
  });

  test("a corpus that cannot separate them SAYS SO instead of passing", () => {
    const dir = mkdtempSync(join(work, "decay-flat-"));
    const store = Store.open({ dir });
    store.put({
      type: "memory",
      kind: "fact",
      body: "A memory used today, which every curve leaves exactly where it is.",
      salience: { novelty: null, relevance: 0.9, emotional: 0.7, predictive: 0.8 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    const report = decayShapes(store, { day: 0 });
    expect(report.rows).toBe(1);
    expect(report.distinguishable).toBe(false);
    expect(report.maxMeanAbsDelta).toBe(0);
    store.close();
  });

  test("the decay comparison rides in the report as evidence, not as a verdict", async () => {
    const result = await runFixture("decayreport");
    expect(result.report).toContain("DECAY SHAPE — physics open question 1");
    expect(result.report).toContain("at the last replayed lived day");
    expect(result.pass.decay?.reference).toBe(REFERENCE_SHAPE);

    // A replay mints everything "today", so the curves coincide at the last
    // lived day. The projection is where OQ1 is actually decided, and there the
    // Ebbinghaus ordering shows: flat hits the floor, the power law holds on.
    expect(result.report).toContain("projected forward 90 lived days");
    const horizon = result.pass.decayHorizon;
    expect(horizon).not.toBeNull();
    expect(horizon?.day).toBe((result.pass.decay?.day ?? 0) + 90);
    expect(horizon?.distinguishable).toBe(true);
    const flat = horizon?.meanStrength["flat"] ?? 0;
    const exponential = horizon?.meanStrength["exponential"] ?? 0;
    const power = horizon?.meanStrength["power-law"] ?? 0;
    expect(flat).toBeLessThan(exponential);
    expect(exponential).toBeLessThan(power);
    expect(horizon?.maxMeanAbsDelta ?? 0).toBeGreaterThan(result.pass.decay?.maxMeanAbsDelta ?? 1);
    // It contributes no verdict: the counts are the metric registry's alone.
    expect(result.scorecard.counts.pass + result.scorecard.counts.fail).toBeLessThanOrEqual(
      METRICS.length,
    );
    result.cleanup();
  });
});

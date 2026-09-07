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
import { DEFAULT_RETENTION_DAYS, Store } from "../src/core/store/index.js";

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
  metricById,
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
  /**
   * Write the day's spans in v1's REAL shape — `{ts, sessionId, spanText,
   * project, hash}` in a file named the way `archiveClaim` names one — instead
   * of the near-miss shape the reader assumed before first contact with the
   * corpus. This is the shape the real run reads.
   */
  readonly v1Shape?: boolean;
  /**
   * Use the SAME two session ids on every day, the shape of the real corpus
   * (a session that spans days) that the per-date ids here never exercised —
   * which is exactly how the driver's cursor bug (review F2, 13.2% of the real
   * corpus silently dropped) stayed invisible to every fixture.
   */
  readonly recurringSession?: boolean;
}

/** v1's `safeScope`: a scope is `global` or `project:<hash>`, and a colon is
 *  illegal in some filesystem paths, so the archive filename replaces it. */
function safeScope(scope: string): string {
  return scope.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** v1's project scope spelling — what lands in a span's `project` field. */
const V1_SCOPE = "project:9f2c1ab4c7d30e51";

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
    const sessions =
      opts.recurringSession === true ? ["ses_rec_a", "ses_rec_b"] : [`ses_${date}_a`, `ses_${date}_b`];
    for (const session of sessions) {
      for (let n = 0; n < 3; n++) {
        at += 1000;
        const text = spanText(date, session, n);
        lines.push(
          opts.v1Shape === true
            ? // v1's own `interface Span`: no `kind` (a span is a conversation
              // SLICE, not a turn), an ISO `ts`, and the content in `spanText`.
              // The LAST span of each session deliberately omits `hash`, which
              // v1's reader re-derives on read — so this fixture exercises both.
              JSON.stringify({
                ts: new Date(at).toISOString(),
                sessionId: session,
                spanText: text,
                project: V1_SCOPE,
                ...(n === 2 ? {} : { hash: contentAddress(text) }),
              })
            : JSON.stringify({
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
    // v1 names an archived claim `<safeScope>.<epochms>.<pid>.<seq>.jsonl`.
    const spanFile =
      opts.v1Shape === true ? `${safeScope(V1_SCOPE)}.${at}.4131.0.jsonl` : "spans.jsonl";
    writeFileSync(join(dayDir, spanFile), `${lines.join("\n")}\n`, "utf8");
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

/** Same idiom as `fakeInterpret`, but one of the two proposals CLAIMS a
 *  salience floor — the only way to exercise `salience.lifted` /
 *  `mint.proposal.lifted` in a fixture, since the plain fake never claims one
 *  (review finding F5's watch metrics are otherwise structurally not-exercised
 *  in every existing fixture). */
function fakeInterpretWithClaim(stopReason = "end_turn"): InterpretFn {
  return async (chunk: SweepChunk) => ({
    stopReason,
    proposals: [
      {
        content:
          `${MINT_MARKER} The storage split settled in ${chunk.spans[0]?.session ?? "unknown"} chunk ${chunk.index}: ` +
          "canonical prose on disk, one operational database, and a cache that is never backed up because it rebuilds.",
        kind: "fact",
        claimed: 0.95,
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
    // Every span in this fixture is a NEAR-MISS shape, not v1's own — which is
    // itself a counted assumption now that the v1 shape is the primary one.
    expect(s.assumedShape).toBe(19);
    expect(s.spans).toBe(19);
    corpus.close();
  });

  // ── v1's REAL span shape (first contact, 2026-08-25) ──────────────────────
  // 798 files, 0 spans, 870 malformed: the content field is `spanText`, which
  // the near-miss list never carried. This is the shape the real run reads.
  test("v1's OWN span shape is the primary one: spanText / sessionId / project / ts", () => {
    const corpus = Corpus.open(corpusDir("v1shape", { v1Shape: true }));
    const s = corpus.summary();

    expect(s.spans).toBe(18);
    expect(s.malformedSpans).toBe(0);
    // Not drift: `kind` is structurally absent from a v1 span, and reading a
    // conversation SLICE as `conversation` is the shape, not a guess.
    expect(s.assumedKind).toBe(0);
    expect(s.assumedShape).toBe(0);

    const spans = corpus.spans(DAYS[0] ?? "");
    expect(spans.length).toBe(6);
    const first = spans[0];
    expect(first?.kind).toBe("conversation");
    // `project` → scope, verbatim: v1 spells a scope `global` or `project:<hash>`.
    expect(first?.scope).toBe(V1_SCOPE);
    expect(first?.session).toBe(`ses_${DAYS[0]}_a`);
    expect(first?.text).toContain(SPAN_MARKER);
    // `ts` is an ISO STRING; the reader parses it rather than dropping the order.
    expect(first?.at).toBeGreaterThan(0);
    expect(corpus.spans(DAYS[0] ?? "").every((sp) => (sp.at ?? 0) > 0)).toBe(true);
    corpus.close();
  });

  test("a v1 span's hash is trusted when present and DERIVED when absent", () => {
    const corpus = Corpus.open(corpusDir("v1hash", { v1Shape: true }));
    const spans = corpus.spans(DAYS[0] ?? "");
    // Every span has an address, including the two written without one — the
    // same rule v1's own reader follows, through the ONE content-address fn.
    for (const sp of spans) expect(sp.hash).toBe(contentAddress(sp.text));
    expect(spans.length).toBe(6);
    corpus.close();
  });

  test("the malformed counter still counts a GENUINELY broken line, not the new shape", () => {
    const corpus = Corpus.open(corpusDir("v1drift", { v1Shape: true, malformedSpan: true }));
    const s = corpus.summary();
    expect(s.malformedSpans).toBe(1);
    expect(s.spans).toBe(18);
    expect(s.assumedShape).toBe(0);
    corpus.close();
  });

  test("the snapshot's `index-snapshot.sqlite` is found without a symlink", () => {
    const dir = corpusDir("snapindex");
    writeIndex(join(dir, "index-snapshot.sqlite"));
    const corpus = Corpus.open(dir);
    expect(corpus.summary().indexPresent).toBe(true);
    expect(corpus.embeddingModels()["voyage-3-large"]).toBe(2);
    expect(corpus.probeWriteRefused()).toBe(true);
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
    // The replay store's log window is the corpus plus the default, so the
    // `log` phase — which runs during the replay — can never sweep a row the
    // scorer reads at run end. The meta row is written at the store's first
    // open, so it records the window the driver actually asked for.
    const replayed = Store.open({ dir: run.storeDir, observer: true });
    try {
      expect(replayed.getMeta("retentionDays")).toBe(String(corpus.days().length + DEFAULT_RETENTION_DAYS));
    } finally {
      replayed.close();
    }
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

  /**
   * §I7: a replay of a corpus from months ago must not date its rows today.
   *
   * The harness passes no `now` here on purpose — that is the default path, and
   * the default is the CORPUS DAY, not `Date.now()`. Every memory the replay
   * mints belongs to the day whose transcripts produced it, while the lived-day
   * clock still counts three days across a four-day calendar span (the corpus
   * skips 2026-07-28).
   */
  test("the corpus's dates reach the rows, and the lived-day clock still skips the day nobody lived", async () => {
    const corpus = Corpus.open(corpusDir("corpusdates", { index: true, jot: true }));
    const run = await runReplay({
      corpus,
      interpret: fakeInterpret(),
      seat: "deterministic-fake",
      vectors: "none",
      budgetBytes: BUDGET_BYTES,
      workRoot: work,
      minBytes: 100,
    });
    const store = run.counterpart.store;
    const learned = new Set<string>();
    for (const id of store.list()) learned.add(store.readProse(id).learnedOn);
    expect(learned.size).toBeGreaterThan(0);
    const today = new Date().toISOString().slice(0, 10);
    for (const d of learned) {
      expect(`${d} in corpus=${DAYS.includes(d)}`).toBe(`${d} in corpus=true`);
    }
    expect(learned.has(today)).toBe(false);
    // The other clock, unmoved: three lived days for three corpus days, even
    // though four calendar days elapsed.
    expect(run.observation.days.map((d) => d.livedDay)).toEqual([1, 2, 3]);
    // The durable event log is dated the same way.
    const at = store.eventLog({ limit: 5000 }).map((e) => new Date(e.at).toISOString().slice(0, 10));
    expect(at.length).toBeGreaterThan(0);
    for (const d of new Set(at)) {
      expect(`${d} in corpus=${DAYS.includes(d)}`).toBe(`${d} in corpus=true`);
    }
    run.cleanup();
    corpus.close();
  });

  test("a corpus in v1's REAL span shape replays end to end", async () => {
    const result = await runFixture("v1drive", { v1Shape: true });
    const o = result.run.observation;
    // The shape reaches the brain, not just the reader: spans captured, chunks
    // gated, memories minted. Before the fix this read 0 spans of 18.
    expect(o.corpus.spans).toBe(18);
    expect(o.corpus.assumedShape).toBe(0);
    expect(o.corpus.malformedSpans).toBe(0);
    expect(o.days.map((d) => d.spansOffered).reduce((a, b) => a + b, 0)).toBe(18);
    // EIGHTEEN of eighteen: capture runs once per TURN with the session's
    // cumulative array — production granularity (review F2/F4). The first
    // build fed a whole session-day in one call, and capture's per-call
    // coalescing turned it into one mega-span per kind (6 here, 60KB slabs on
    // the real corpus) while the cross-day cursor overlap dropped silently.
    expect(o.days.map((d) => d.spansCaptured).reduce((a, b) => a + b, 0)).toBe(18);
    expect(o.chunks.some((c) => c.gated)).toBe(true);
    expect(o.store.memories).toBeGreaterThan(0);
    // v1 spells a project scope with a colon; it survives into the replay.
    expect(o.sweeps.some((s) => s.scope === V1_SCOPE)).toBe(true);
    result.cleanup();
  });

  test("a session that spans days loses NOTHING at the capture seam (review F2)", async () => {
    // The real corpus's shape: the same session recurring across days. Before
    // the cumulative-turns fix, day 2's array was sliced by day 1's cursor and
    // every overlapped span silently read NOTHING_NEW — 13.2% of the real
    // corpus never entered the replay, and no metric said so.
    const result = await runFixture("recurring", { recurringSession: true });
    const o = result.run.observation;
    expect(o.days.map((d) => d.spansOffered).reduce((a, b) => a + b, 0)).toBe(18);
    expect(o.days.map((d) => d.spansCaptured).reduce((a, b) => a + b, 0)).toBe(18);
    // And the floor that makes this failure impossible to miss again:
    const coverage = result.scorecard.metrics.find((m) => m.id === "run.captureCoverage");
    expect({ verdict: coverage?.verdict, value: coverage?.observed?.value }).toEqual({
      verdict: "pass",
      value: 1,
    });
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
  gateRecords: [],
  depositRecords: [],
  bandTransitions: [],
  symmetry: [],
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
    assumedShape: 0,
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

  test("a SAMPLE run says so everywhere, and its pass record can NEVER open the gate", async () => {
    const result = await runFixture("samplerun");
    const input = {
      scorecard: result.scorecard,
      observation: result.run.observation,
      decay: result.decay,
      sample: true,
    };
    // The banner is the first thing a reader sees...
    expect(renderReport(input).split("\n")[0]).toContain("SAMPLE RUN");
    // ...the record carries the mark durably...
    const pass = passRecord(input);
    expect(pass.sample).toBe(true);
    // ...and the gate refuses it STRUCTURALLY: a sample proves wiring, never
    // readiness, whatever its verdicts say.
    expect(gateOpen(pass, HARNESS_VERSION)).toBe(false);
    // The unsampled path is unchanged: sample defaults false.
    expect(passRecord({ ...input, sample: undefined }).sample).toBe(false);
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

// ═══════════════════════════════════════════════════════════════════════════
// 8. The three metrics the composition root used to make impossible, and the
//    two the decay pass did. Each was `not-computable` with a reason in
//    INTERFACE-GAPS; each is now arithmetic over a REPLAYED STORE.
// ═══════════════════════════════════════════════════════════════════════════

/** A synthetic observation: the scorer's arithmetic, checked without a run. */
function observed(over: Partial<ReplayObservation>): ReplayObservation {
  return { ...EMPTY_OBSERVATION, ...over };
}

function gateRecord(over: Partial<ReplayObservation["gateRecords"][number]> = {}): ReplayObservation["gateRecords"][number] {
  return {
    chunkKey: "k",
    day: 1,
    scope: "proj",
    proposals: 1,
    accepted: 1,
    refused: 0,
    fullyGated: false,
    blind: false,
    shown: 2,
    candidates: 4,
    shownLexicalOnly: 1,
    shownSemanticOnly: 1,
    shownBoth: 0,
    semanticState: "ran",
    fires: {},
    refusalsByReason: {},
    ...over,
  };
}

function depositRecord(
  over: Partial<ReplayObservation["depositRecords"][number]> = {},
): ReplayObservation["depositRecords"][number] {
  return {
    contentHash: "h",
    day: 1,
    scope: "proj",
    source: "jot",
    accepted: true,
    kind: "fact",
    fires: {},
    refusalsByReason: {},
    blockedBy: [],
    statuses: {},
    ...over,
  };
}

function cycle(over: Partial<ReplayObservation["cycles"][number]> = {}): ReplayObservation["cycles"][number] {
  return {
    date: "2026-07-27",
    day: 1,
    phasesRan: 7,
    phasesFailed: 0,
    decayRan: true,
    decayExamined: 10,
    decayChanged: 1,
    promoted: 0,
    pruned: 0,
    merged: 0,
    bandUp: 0,
    bandDown: 0,
    briefingBytes: null,
    budgetBytes: null,
    ...over,
  };
}

describe("the gate metrics compute from the durable record", () => {
  test("gate.refusalMix is the secrets share of the battery's own fire count", () => {
    const metric = metricById("gate.refusalMix");
    expect(metric?.grading.kind).toBe("range");
    const o = observed({
      gateRecords: [
        gateRecord({ fires: { secrets: 3, floor: 1 } }),
        gateRecord({ fires: { aliases: 2, precision: 1, secrets: 1 } }),
      ],
    });
    const sample = metric?.compute?.(o);
    expect(sample?.numerator).toBe(4);
    expect(sample?.denominator).toBe(8);
    expect(scoreMetric(metric as MetricSpec, o).verdict).toBe("pass");
  });

  test("gate.refusalMix counts BOTH doors — the authored one is not half a distribution", () => {
    const metric = metricById("gate.refusalMix") as MetricSpec;
    // One swept chunk, one authored deposit. Before `gate.deposit` (replay
    // INTERFACE-GAPS §2a) the second row did not exist, so the mix was the
    // crash-sweep path alone — and the crash sweep is normally silent while the
    // authored door fires at every session end and every jot.
    const o = observed({
      gateRecords: [gateRecord({ fires: { secrets: 1, floor: 1 } })],
      depositRecords: [depositRecord({ fires: { secrets: 2 } })],
    });
    const sample = metric.compute?.(o);
    expect(sample?.numerator).toBe(3);
    expect(sample?.denominator).toBe(4);

    // …and the authored rows ALONE are a computable mix, which is the state a
    // store that never crashed is actually in.
    const authoredOnly = observed({
      depositRecords: [depositRecord({ fires: { secrets: 1, aliases: 1 } })],
    });
    expect(metric.compute?.(authoredOnly)?.denominator).toBe(2);

    // The preselection metrics do NOT read across: a deposit is preselected
    // against nothing, so folding these rows in would average in a shown-count
    // that was never measured.
    const shown = metricById("preselect.meanSchemasShown") as MetricSpec;
    expect(shown.compute?.(authoredOnly)).toBeNull();
    expect(scoreMetric(shown, authoredOnly).verdict).toBe("not-exercised");
  });

  test("a corpus that fired NO gate is not-exercised, never a zero that passes", () => {
    const metric = metricById("gate.refusalMix") as MetricSpec;
    const result = scoreMetric(metric, observed({ gateRecords: [gateRecord()] }));
    expect(result.verdict).toBe("not-exercised");
    expect(result.reason).toBe("no-denominator");
  });

  test("preselect.meanSchemasShown is the count behind `blind`", () => {
    const metric = metricById("preselect.meanSchemasShown") as MetricSpec;
    const o = observed({
      gateRecords: [gateRecord({ shown: 3 }), gateRecord({ shown: 1 }), gateRecord({ shown: 2 })],
    });
    expect(metric.compute?.(o)?.value).toBe(2);
    expect(scoreMetric(metric, o).verdict).toBe("pass");
  });

  test("preselect.channelMix counts only chunks where the semantic channel RAN", () => {
    const metric = metricById("preselect.channelMix") as MetricSpec;
    // Two shown on a chunk the channel ran for (one semantic-only), plus a
    // chunk it SKIPPED, whose zero would otherwise read as "adds nothing".
    const o = observed({
      gateRecords: [
        gateRecord({ semanticState: "ran", shownLexicalOnly: 1, shownSemanticOnly: 1, shownBoth: 0 }),
        gateRecord({
          semanticState: "skipped",
          shown: 4,
          shownLexicalOnly: 4,
          shownSemanticOnly: 0,
          shownBoth: 0,
        }),
      ],
    });
    const sample = metric.compute?.(o);
    expect(sample?.numerator).toBe(1);
    expect(sample?.denominator).toBe(2);
    expect(scoreMetric(metric, o).verdict).toBe("pass");
  });

  test("with the channel SKIPPED everywhere, the mix is never-asked — not 'semantic adds nothing'", () => {
    const metric = metricById("preselect.channelMix") as MetricSpec;
    const result = scoreMetric(
      metric,
      observed({ gateRecords: [gateRecord({ semanticState: "skipped", shownSemanticOnly: 0 })] }),
    );
    expect(result.verdict).toBe("not-exercised");
    expect(result.reason).toBe("no-denominator");
  });

  test("no registry entry still declares these three not-computable", () => {
    for (const id of ["gate.refusalMix", "preselect.meanSchemasShown", "preselect.channelMix"]) {
      expect(metricById(id)?.grading.kind).toBe("range");
      expect(metricById(id)?.compute).toBeDefined();
    }
  });
});

describe("the salience and schema-birth watch metrics compute from relayed events (review F5 / finding 5)", () => {
  test("salience.liftRate reads mint.proposal's own `lifted` flag, not a raw salience.lifted count", () => {
    const metric = metricById("salience.liftRate") as MetricSpec;
    expect(metric.grading.kind).toBe("watch");
    const o = observed({
      events: [
        { name: "mint.proposal", data: { id: "m1", proposal: "p1", kind: "fact", updates: null, updatesReason: "NO_DECLARATION", lifted: true, blind: false } },
        { name: "mint.proposal", data: { id: "m2", proposal: "p2", kind: "fact", updates: null, updatesReason: "NO_DECLARATION", lifted: false, blind: false } },
        { name: "mint.proposal", data: { id: "m3", proposal: "p3", kind: "fact", updates: null, updatesReason: "NO_DECLARATION", lifted: true, blind: true } },
        // The second `salience.lifted` emit site (schema entity placement, no
        // proposal id) — must NOT move this rate, per the registry note.
        { name: "salience.lifted", data: { computed: 0, claimed: 0.7, applied: 0.7 } },
      ],
    });
    const sample = metric.compute?.(o);
    expect(sample?.numerator).toBe(2);
    expect(sample?.denominator).toBe(3);
    expect(scoreMetric(metric, o).verdict).toBe("watch");
  });

  test("no mint proposals in the run is not-exercised, never a zero that passes", () => {
    const metric = metricById("salience.liftRate") as MetricSpec;
    const result = scoreMetric(metric, observed({ events: [] }));
    expect(result.verdict).toBe("not-exercised");
    expect(result.reason).toBe("no-denominator");
  });

  test("salience.meanLift means (applied − computed) over salience.lifted seam events", () => {
    const metric = metricById("salience.meanLift") as MetricSpec;
    const o = observed({
      events: [
        { name: "salience.lifted", data: { id: "m1", computed: 0, claimed: 0.8, applied: 0.8 } },
        { name: "salience.lifted", data: { id: "m2", computed: 0.2, claimed: 0.6, applied: 0.6 } },
      ],
    });
    const sample = metric.compute?.(o);
    // (0.8 - 0) + (0.6 - 0.2) = 1.2, over 2 lifts = 0.6
    expect(sample?.value).toBeCloseTo(0.6, 10);
    expect(sample?.denominator).toBe(2);
    expect(scoreMetric(metric, o).verdict).toBe("watch");
  });

  test("salience.capRate is not-exercised when `capped` is absent from every lift (the pre-doctrine shape, retained for old observations)", () => {
    const metric = metricById("salience.capRate") as MetricSpec;
    const o = observed({
      events: [{ name: "salience.lifted", data: { id: "m1", computed: 0, claimed: 0.8, applied: 0.8 } }],
    });
    const result = scoreMetric(metric, o);
    expect(result.verdict).toBe("not-exercised");
    expect(result.reason).toBe("no-denominator");
  });

  test("salience.capRate computes once `capped` is on the event", () => {
    const metric = metricById("salience.capRate") as MetricSpec;
    const o = observed({
      events: [
        {
          name: "salience.lifted",
          data: { id: "m1", computed: 0, claimed: 0.9, applied: 0.6, ceiling: 0.6, capped: true },
        },
        {
          name: "salience.lifted",
          data: { id: "m2", computed: 0, claimed: 0.5, applied: 0.5, ceiling: 1, capped: false },
        },
      ],
    });
    const sample = metric.compute?.(o);
    expect(sample?.numerator).toBe(1);
    expect(sample?.denominator).toBe(2);
    expect(scoreMetric(metric, o).verdict).toBe("watch");
  });

  test("schema.birthRefusalShare is refused over (born + refused)", () => {
    const metric = metricById("schema.birthRefusalShare") as MetricSpec;
    const o = observed({
      events: [
        { name: "schema.birth", data: { nameHash: "h1", kind: "person", day: 1, aliases: 0, aliasesDropped: 0, chunkRef: "c1" } },
        { name: "schema.birth.refused", data: { nameHash: "h2", kind: "person", reason: "name-not-in-source", collided: 0 } },
        { name: "schema.birth.refused", data: { nameHash: "h3", kind: "entity", reason: "birth-cap-per-chunk", collided: 0 } },
      ],
    });
    const sample = metric.compute?.(o);
    expect(sample?.numerator).toBe(2);
    expect(sample?.denominator).toBe(3);
    expect(scoreMetric(metric, o).verdict).toBe("watch");
  });

  test("a run with no birth attempts at all is not-exercised, never a zero that passes", () => {
    const metric = metricById("schema.birthRefusalShare") as MetricSpec;
    const result = scoreMetric(metric, observed({ events: [] }));
    expect(result.verdict).toBe("not-exercised");
    expect(result.reason).toBe("no-denominator");
  });

  test("schema.birthRefusalMix is the name-not-in-source share of refusals, mirroring gate.refusalMix", () => {
    const metric = metricById("schema.birthRefusalMix") as MetricSpec;
    const o = observed({
      events: [
        { name: "schema.birth.refused", data: { nameHash: "h1", kind: "person", reason: "name-not-in-source", collided: 0 } },
        { name: "schema.birth.refused", data: { nameHash: "h2", kind: "person", reason: "name-not-in-source", collided: 0 } },
        { name: "schema.birth.refused", data: { nameHash: "h3", kind: "entity", reason: "birth-cap-per-chunk", collided: 0 } },
      ],
    });
    const sample = metric.compute?.(o);
    expect(sample?.numerator).toBe(2);
    expect(sample?.denominator).toBe(3);
    expect(scoreMetric(metric, o).verdict).toBe("watch");
  });

  test("all five watch metrics are computable WATCH entries claiming §1.11 — measured, never a vacuous pass", () => {
    for (const id of [
      "salience.liftRate",
      "salience.meanLift",
      "salience.capRate",
      "schema.birthRefusalShare",
      "schema.birthRefusalMix",
    ]) {
      const metric = metricById(id);
      expect(metric?.section).toBe("1.11");
      // The PR-5 review's SF3: an unfailable range renders `pass`, and a
      // vacuous PASS reads healthier than an honest absence (scar §2.4) — so
      // these grade as `watch`, the measured-ungraded verdict, which can
      // neither pass nor fail a run.
      expect(metric?.grading.kind).toBe("watch");
      expect(metric?.compute).toBeDefined();
    }
  });
});

describe("the band metrics compute from direction-counted transitions", () => {
  test("promotions and demotions are separate per-day rates over UP and DOWN moves", () => {
    const o = observed({
      activeDays: 2,
      cycles: [cycle({ bandUp: 6, bandDown: 2 }), cycle({ bandUp: 4, bandDown: 0 })],
    });
    expect(metricById("band.promotionsPerActiveDay")?.compute?.(o)?.value).toBe(5);
    expect(metricById("band.demotionsPerActiveDay")?.compute?.(o)?.value).toBe(1);
    expect(scoreMetric(metricById("band.demotionsPerActiveDay") as MetricSpec, o).verdict).toBe("pass");
  });

  test("band.symmetryAsked fails when a starved sample is reported as within-expectation", () => {
    const metric = metricById("band.symmetryAsked") as MetricSpec;
    const honest = observed({
      symmetry: [{ day: 1, kind: "fact", ok: true, reason: "never-asked", up: 0, down: 0 }],
    });
    expect(scoreMetric(metric, honest).verdict).toBe("pass");

    // The failure this exists to catch: a verdict claiming health on a counter
    // nothing ever fed. `ok` is true in BOTH rows — only `reason` separates them.
    const dishonest = observed({
      symmetry: [{ day: 1, kind: "fact", ok: true, reason: "within-expectation", up: 0, down: 0 }],
    });
    expect(scoreMetric(metric, dishonest).verdict).toBe("fail");
  });

  test("a run that rendered NO verdict is not-exercised, not a pass", () => {
    const metric = metricById("band.symmetryAsked") as MetricSpec;
    const result = scoreMetric(metric, observed({ symmetry: [] }));
    expect(result.verdict).toBe("not-exercised");
    expect(result.reason).toBe("no-denominator");
  });
});

describe("a real replay carries the durable gate and band surfaces", () => {
  test("the driver reads gate records BACK OUT OF THE STORE, keyed by content", async () => {
    const result = await runFixture("gaterecords");
    const o = result.run.observation;

    expect(o.gateRecords.length).toBeGreaterThan(0);
    // One record per chunk that reached the gate, and the keys are distinct.
    const keys = new Set(o.gateRecords.map((g) => g.chunkKey));
    expect(keys.size).toBe(o.gateRecords.length);
    expect(o.gateRecords.every((g) => g.scope.length > 0)).toBe(true);
    // The three metrics are COMPUTED now — pass or fail, never absent.
    const card = result.scorecard;
    for (const id of ["gate.refusalMix", "preselect.meanSchemasShown", "preselect.channelMix"]) {
      const row = card.metrics.find((m) => m.id === id);
      expect(row?.reason).not.toBe("not-computable");
    }
    result.cleanup();
  });

  test("meanSchemasShown reads ZERO and FAILS — the unwired schema slice, as a red line", async () => {
    const result = await runFixture("shownzero");
    const row = result.scorecard.metrics.find((m) => m.id === "preselect.meanSchemasShown");
    // `applySweep` hands the chunk gate no schema slice, so preselection has
    // nothing to select from and every chunk reads blind. The number is now
    // computable, which is what turns that gap from an absence nobody has to
    // answer for into a failing line in the scorecard (INTERFACE-GAPS §1a).
    expect(row?.observed?.value).toBe(0);
    expect(row?.verdict).toBe("fail");
    expect(result.run.observation.gateRecords.every((g) => g.blind)).toBe(true);
    result.cleanup();
  });

  test("every cycle rendered a per-kind symmetry verdict, and none of them claims health", async () => {
    const result = await runFixture("symmetry");
    const o = result.run.observation;
    expect(o.symmetry.length).toBe(o.cycles.length * 6);
    for (const v of o.symmetry) expect(v.reason).toBe("never-asked");
    expect(
      result.scorecard.metrics.find((m) => m.id === "band.symmetryAsked")?.verdict,
    ).toBe("pass");
    result.cleanup();
  });
});

describe("the salience watch metrics wire through a real replay (review F5)", () => {
  test("a claimed salience floor lifts the computed value, and the watch metrics see it without crashing or guessing", async () => {
    const result = await runFixture("saliencewatch", {}, { interpret: fakeInterpretWithClaim() });
    const o = result.run.observation;

    const proposals = o.events.filter((e) => e.name === "mint.proposal");
    const lifted = o.events.filter((e) => e.name === "salience.lifted");
    expect(proposals.length).toBeGreaterThan(0);
    expect(lifted.length).toBeGreaterThan(0);
    expect(proposals.some((e) => e.data.lifted === true)).toBe(true);

    const card = result.scorecard;
    // The salience pair COMPUTES on this fixture (claims fire): watch, with a
    // real number behind it.
    for (const id of ["salience.liftRate", "salience.meanLift"]) {
      const row = card.metrics.find((m) => m.id === id);
      expect({ id, verdict: row?.verdict }).toEqual({ id, verdict: "watch" });
      expect(row?.observed).not.toBeNull();
    }
    // The birth pair has NO denominator here — the fixture births nothing —
    // and says so honestly rather than guessing a zero.
    for (const id of ["schema.birthRefusalShare", "schema.birthRefusalMix"]) {
      const row = card.metrics.find((m) => m.id === id);
      expect({ id, verdict: row?.verdict, reason: row?.reason }).toEqual({
        id,
        verdict: "not-exercised",
        reason: "no-denominator",
      });
    }
    // The PR-5 review's tautology, closed: the old assertion accepted every
    // verdict the scorer can produce. `capped` ships on the seam event now
    // (the mint-source doctrine) and this fixture's claimed 0.95 exceeds the
    // fallback ceiling, so capRate must COMPUTE — a real numerator over the
    // lifted events, all of which were capped.
    const capRow = card.metrics.find((m) => m.id === "salience.capRate");
    expect({ verdict: capRow?.verdict, value: capRow?.observed?.value }).toEqual({
      verdict: "watch",
      value: 1,
    });

    // Watch-only, never a content leak.
    expect(result.report).not.toContain(SPAN_MARKER);
    expect(result.report).not.toContain(MINT_MARKER);
    result.cleanup();
  });

  test("totality still holds with the five new metrics registered", () => {
    expect(totality().ok).toBe(true);
  });
});

describe("the report prints the gate record and the tripwire's standing", () => {
  test("the REPLAY block names gate fires, schemas shown, band moves and verdicts BY REASON", async () => {
    const result = await runFixture("g12report");
    expect(result.report).toContain("gate records ");
    expect(result.report).toContain("gate fires ");
    expect(result.report).toContain("schemas shown ");
    // Grouped by reason, never by `ok`: a starved counter reads `never-asked`
    // with `ok: true`, and printing that as health is the failure G12 prevents.
    expect(result.report).toContain("symmetry verdicts: never-asked=");
    expect(result.report).toContain("band moves: up 0 · down 0");
    // Still no content, on a line that now prints more of the gate's record.
    expect(result.report).not.toContain(SPAN_MARKER);
    expect(result.report).not.toContain(MINT_MARKER);
    result.cleanup();
  });
});

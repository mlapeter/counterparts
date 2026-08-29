#!/usr/bin/env bun
/**
 * `run-replay <corpus-dir> [--out <dir>] [--fire]`
 *
 * The REAL replay run — the paid one. DRY RUN IS THE DEFAULT (the migrate bin's
 * doctrine, same reason): without `--fire` this opens the corpus read-only,
 * prints the inventory against the numbers the run was priced on, exercises the
 * store-dir safety check, and exits without opening a socket. `--fire` spends
 * money and is an owner decision (recorded 2026-08-26: Opus 5, as-shipped).
 *
 * WHAT THE INJECTOR OWNS (INTERFACE-GAPS §3): the harness measures the pipeline;
 * streaming, token headroom, retries, watchdogs and detachment belong here, to
 * the caller. So this file wraps `interpretClient` with:
 *   - a fresh client per call carrying `AbortSignal.timeout(WATCHDOG_MS)` — the
 *     watchdog's hand on each socket, never one signal for the whole run;
 *   - bounded transient-only retries (429/408/5xx/529, transport throws, NO_BODY).
 *     NO_JSON_IN_RESPONSE is NOT retried: throw-and-restore is the shipped
 *     semantics, and a restored span gets its honest retry at the next boundary.
 *     NO_API_KEY / SEAT_UNUSABLE are refusals, not weather.
 *
 * CRASH INSURANCE AT THE PAID BOUNDARY: the moment `runReplay` returns, the run
 * record and the full observation are written to disk (both are counts-only by
 * construction — log discipline holds). Scoring and rendering run AFTER that,
 * inside a catch that dumps what it has and exits nonzero: a render throw must
 * not eat a paid, non-resumable run. `cleanup()` is deliberately never called —
 * the replayed store is the run's evidence and outlives the process.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { API_KEY_ENV, DEFAULT_INTERPRET_MODEL, EMBED_KEY_ENV, TUNABLES } from "../../../src/adapters/claude-code/config.js";
import { openEmbedder } from "../../../src/adapters/claude-code/embed-client.js";
import { InterpretError, interpretClient } from "../../../src/adapters/claude-code/interpret-client.js";
import type { InterpretFn } from "../../../src/core/remember/index.js";
import { assertSafeDataDir } from "../../../src/core/store/index.js";

import { scoreRun } from "../compare.js";
import { Corpus } from "../corpus.js";
import { decayShapes } from "../decay-shapes.js";
import { HARNESS_VERSION, runReplay } from "../driver.js";
import { DEFAULT_DECAY_HORIZON_DAYS } from "../index.js";
import { gateOpen, passRecord, renderReport, writePassRecord } from "../report.js";

/** The 2026-08-25 snapshot's own inventory — the corpus the ~$30 was priced
 *  against. A mismatch means this is not the run the owner approved.
 *  `pinnedRows` is 13,709 where replay-baselines §2 says 13,664: the doc was
 *  measured during the log-audit window and v1 embedded 45 more nodes before
 *  the snapshot was cut (the frozen `voyage-3.5` generation still matches §2
 *  exactly, 9,600). Verified read-only against `index-snapshot.sqlite`,
 *  2026-08-26. Vectors are recorded, never used (INTERFACE-GAPS §4). */
const EXPECTED = { spans: 870, eventLines: 65_499, pinnedRows: 13_709 } as const;

/** The pinned vector generation (NOTES §6 item 3): v1's CURRENT generation,
 *  the one every `embed.refresh` in the instrumented window used. Recorded on
 *  the run record; the harness does not yet use the vectors (INTERFACE-GAPS §4). */
const VECTORS = "voyage-3-large";

/** The host ceiling v1 actually ran under — the 9K wake budget. */
const BUDGET_BYTES = 9_000;

/** The corpus's owner, anchored (review CRITICAL-2: the first run passed no
 *  identity and the interpreter confabulated a name — 15 durable memories
 *  called the owner "Matt"). Names from the corpus's own census: Mike x181
 *  files, mlapeter x376, Michael x4, Matt x0. */
const OWNER = { name: "Mike", aliases: ["mlapeter", "Michael"] } as const;

const TRANSIENT_HTTP: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 529]);
const RETRY_WAITS_MS: readonly number[] = [15_000, 60_000];

function log(line: string): void {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

/** A short name for why a failure is retryable, or null when it is not. */
function transientCode(err: unknown): string | null {
  if (err instanceof InterpretError) {
    if (err.code === "NO_BODY") return "NO_BODY";
    if (err.code !== "HTTP_ERROR") return null;
    if (err.detail["reason"] === "no-fetch") return null;
    const status = Number(err.detail["status"]);
    return TRANSIENT_HTTP.has(status) ? `HTTP_${status}` : null;
  }
  // Anything else out of fetch/stream is transport weather: connection resets,
  // the watchdog's abort, a torn stream. Bounded retries make this safe.
  return err instanceof Error ? err.name : "UNKNOWN";
}

/** The real interpreter, wrapped with the injector's duties (see header). */
function realInterpret(): InterpretFn {
  return async (chunk) => {
    for (let attempt = 0; ; attempt += 1) {
      const client = interpretClient({
        config: { identity: { name: OWNER.name, aliases: [...OWNER.aliases] } },
        signal: AbortSignal.timeout(TUNABLES.WATCHDOG_MS),
        onEvent: (name, data) => log(`${name} ${JSON.stringify(data)}`),
      });
      try {
        return await client(chunk);
      } catch (err) {
        const code = transientCode(err);
        const wait = RETRY_WAITS_MS[attempt];
        if (code === null || wait === undefined) throw err;
        log(`interpret.retry ${JSON.stringify({ chunk: chunk.index, attempt: attempt + 1, waitMs: wait, code })}`);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  };
}

interface Args {
  readonly corpusDir: string;
  readonly outDir: string | null;
  readonly fire: boolean;
  /** SAMPLE mode: replay only the first N of the corpus's days. The pass
   *  record is marked and can never open the gate; priced-inventory gates are
   *  skipped (a sample is not the corpus the price was quoted against) while
   *  every structural gate stays. */
  readonly days: number | null;
  /** Wire the live Voyage embedder (VOYAGE_API_KEY): the semantic channel and
   *  novelty run. Absent = a LEXICAL-ONLY run, said in the log. */
  readonly embed: boolean;
}

function usage(): never {
  process.stderr.write(
    [
      "usage: run-replay <corpus-dir> [--out <dir>] [--fire]",
      "",
      "  <corpus-dir>  the preserved v1 snapshot. READ-ONLY, always.",
      "  --out <dir>   where the run's artifacts land (log, record, observation,",
      "                report, pass record, the replayed store). Required to fire.",
      "  --fire        actually run — real model calls, real money. Without it",
      "                this is a free read-only pre-flight against the priced",
      "                inventory, and no socket is opened.",
      "  --days <n>    SAMPLE: replay only the first n days. The pass record is",
      "                marked sample and can never open the gate.",
      "  --embed       wire the live Voyage embedder (VOYAGE_API_KEY) so the",
      "                cards' semantic channel and novelty run. Absent, the run",
      "                is lexical-only and the log says so.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): Args {
  let corpusDir: string | null = null;
  let outDir: string | null = null;
  let fire = false;
  let days: number | null = null;
  let embed = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--fire") fire = true;
    else if (a === "--embed") embed = true;
    else if (a === "--days") {
      const v = Number.parseInt(argv[i + 1] ?? "", 10);
      if (!Number.isFinite(v) || v < 1) usage();
      days = v;
      i += 1;
    } else if (a === "--out") {
      const v = argv[i + 1];
      if (v === undefined) usage();
      outDir = v;
      i += 1;
    } else if (a !== undefined && !a.startsWith("--") && corpusDir === null) corpusDir = a;
    else usage();
  }
  if (corpusDir === null) usage();
  return { corpusDir, outDir, fire, days, embed };
}

/**
 * Assemble a SAMPLE corpus: the first `days` day-directories plus their event
 * logs, and everything else (index, meta, config) verbatim. A copy, never a
 * view — the reader's byte-identity proof must hold on the sample itself.
 */
function buildSampleCorpus(corpusDir: string, days: number, outDir: string): string {
  const sampleDir = join(outDir, `sample-corpus-${days}d`);
  rmSync(sampleDir, { recursive: true, force: true });
  mkdirSync(join(sampleDir, "buffer-archive"), { recursive: true });
  mkdirSync(join(sampleDir, "logs"), { recursive: true });
  const dayDirs = readdirSync(join(corpusDir, "buffer-archive")).sort().slice(0, days);
  for (const day of dayDirs) {
    cpSync(join(corpusDir, "buffer-archive", day), join(sampleDir, "buffer-archive", day), {
      recursive: true,
    });
    const log = join(corpusDir, "logs", `events-${day}.jsonl`);
    if (existsSync(log)) cpSync(log, join(sampleDir, "logs", `events-${day}.jsonl`));
  }
  for (const name of readdirSync(corpusDir)) {
    if (name === "buffer-archive" || name === "logs") continue;
    cpSync(join(corpusDir, name), join(sampleDir, name), { recursive: true });
  }
  return sampleDir;
}

/** Pre-flight: every gate, each printed PASS/FAIL. Returns the failures.
 *  In SAMPLE mode the priced-inventory equalities are skipped — a sample is
 *  not the corpus the price was quoted against — while every STRUCTURAL gate
 *  (zero malformed, index present, write probe) stays. */
function preflight(corpus: Corpus, opts: { sample?: boolean } = {}): string[] {
  const s = corpus.summary();
  const refused = corpus.probeWriteRefused();
  const inventory: readonly [string, boolean, string][] =
    opts.sample === true
      ? []
      : [
          ["spans parse at the priced count", s.spans === EXPECTED.spans, `${s.spans} (expected ${EXPECTED.spans})`],
          ["event lines at the priced count", s.eventLines === EXPECTED.eventLines, `${s.eventLines} (expected ${EXPECTED.eventLines})`],
          [`pin ${VECTORS} at inventoried rows`, s.pinnedRows === EXPECTED.pinnedRows, `${s.pinnedRows} (expected ${EXPECTED.pinnedRows})`],
        ];
  const checks: readonly [string, boolean, string][] = [
    ...inventory,
    ["no malformed spans", s.malformedSpans === 0, `${s.malformedSpans}`],
    ["no assumed shapes (v1 shape is primary)", s.assumedShape === 0, `${s.assumedShape}`],
    ["no unrecognized span files", s.unrecognizedSpanFiles === 0, `${s.unrecognizedSpanFiles}`],
    ["no malformed event lines", s.malformedEventLines === 0, `${s.malformedEventLines}`],
    ["index present", s.indexPresent, `${s.indexPresent}`],
    ["corpus write probe REFUSED", refused, `${refused}`],
  ];
  const failures: string[] = [];
  log(`preflight corpus=${s.dir}`);
  log(`preflight days=${s.days} spanFiles=${s.spanFiles} sessions=${s.sessions} scopes=${s.scopes} activeDays=${s.activeDays}`);
  log(`preflight digest=${s.digest.slice(0, 12)} files=${s.files} embeddingModels=${JSON.stringify(s.embeddingModels)}`);
  for (const [name, ok, detail] of checks) {
    log(`preflight ${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`);
    if (!ok) failures.push(name);
  }
  return failures;
}

/** The driver would catch an unsafe store dir before any API call — but a
 *  detached run should fail at launch, not one minute into a log. */
function exerciseStoreDir(outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  const probe = mkdtempSync(join(realpathSync(outDir), "counterparts-replay-"));
  assertSafeDataDir(probe);
  rmSync(probe, { recursive: true, force: true });
  log(`preflight PASS  store dir accepted under ${outDir}`);
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.fire) {
    // Fail fast, before the corpus opens: without this, every chunk throws
    // NO_API_KEY per-chunk, the day loop completes anyway, and the result is a
    // fully-written zero-mint garbage run.
    const key = process.env[API_KEY_ENV];
    if (key === undefined || key.trim().length === 0) {
      process.stderr.write(`refusing to fire: ${API_KEY_ENV} is not set\n`);
      return 2;
    }
    if (args.outDir === null) {
      process.stderr.write("refusing to fire: --out is required for a real run\n");
      return 2;
    }
    if (existsSync(join(args.outDir, "pass-record.json"))) {
      process.stderr.write("refusing to fire: --out already holds a pass record\n");
      return 2;
    }
    if (args.embed) {
      const voyage = process.env[EMBED_KEY_ENV];
      if (voyage === undefined || voyage.trim().length === 0) {
        process.stderr.write(`refusing to fire: --embed but ${EMBED_KEY_ENV} is not set\n`);
        return 2;
      }
    }
  }

  const sample = args.days !== null;
  // SAMPLE mode assembles a copy — a subset of days, never a view of the real
  // corpus — so the reader's byte-identity proof holds on what actually ran.
  const corpusDir =
    args.days === null || args.outDir === null
      ? args.corpusDir
      : (mkdirSync(args.outDir, { recursive: true }),
        buildSampleCorpus(args.corpusDir, args.days, args.outDir));
  if (sample) log(`SAMPLE mode: first ${args.days} days -> ${corpusDir}`);

  const corpus = Corpus.open(corpusDir, { pinModel: VECTORS });
  try {
    const failures = preflight(corpus, { sample });
    if (args.outDir !== null) exerciseStoreDir(args.outDir);
    if (failures.length > 0) {
      log(`preflight VERDICT: ${sample ? "sample failed structural gates" : "NOT the priced corpus"} — refusing (${failures.length} failed)`);
      return 1;
    }
    log(sample ? "preflight VERDICT: sample structurally sound — ready to fire" : "preflight VERDICT: ready to fire");
    if (!args.fire) return 0;

    const outDir = args.outDir as string;
    // The live embedder, knob explicitly ON for this run only (--embed): the
    // cards' semantic channel and novelty run. Absent, this is a LEXICAL-ONLY
    // run and the log line says so — semanticState will read `skipped`.
    const embedder = args.embed ? openEmbedder({ embedder: { enabled: true } }) : null;
    log(
      `fire seat=${DEFAULT_INTERPRET_MODEL} vectors=${VECTORS} embed=${embedder !== null ? "LIVE" : "off (lexical-only cards)"} sample=${sample} budgetBytes=${BUDGET_BYTES} harness=${HARNESS_VERSION}`,
    );
    const run = await runReplay({
      corpus,
      interpret: realInterpret(),
      seat: DEFAULT_INTERPRET_MODEL,
      vectors: VECTORS,
      budgetBytes: BUDGET_BYTES,
      workRoot: outDir,
      identity: { name: OWNER.name, aliases: [...OWNER.aliases] },
      ...(embedder === null ? {} : { embed: embedder.embed, liveVectors: embedder }),
      onDay: (date, index, total) => log(`day ${index}/${total} ${date}`),
    });

    // ── the paid boundary: persist BEFORE any scoring code can throw ────────
    writeFileSync(join(outDir, "run-record.json"), `${JSON.stringify(run.record, null, 2)}\n`, "utf8");
    writeFileSync(join(outDir, "observation.json"), `${JSON.stringify(run.observation, null, 2)}\n`, "utf8");
    log(`replay complete storeDir=${run.storeDir} — record and observation persisted`);

    try {
      const scorecard = scoreRun(run.observation, run.record);
      writeFileSync(join(outDir, "scorecard.json"), `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");
      const decay = decayShapes(run.counterpart.store);
      const decayHorizon = decayShapes(run.counterpart.store, { day: decay.day + DEFAULT_DECAY_HORIZON_DAYS });
      const input = { scorecard, observation: run.observation, decay, decayHorizon, sample };
      const report = renderReport(input);
      writeFileSync(join(outDir, "report.txt"), `${report}\n`, "utf8");
      const pass = passRecord(input);
      writePassRecord(join(outDir, "pass-record.json"), pass);
      process.stdout.write(`\n${report}\n\n`);
      // The wiring proof a sample exists for is the TREND, not the aggregate:
      // every replay starts from an empty store, so early days are blind by
      // construction and an aggregate would understate steady state.
      const byDay = new Map<number, { gated: number; blind: number; shown: number }>();
      for (const g of run.observation.gateRecords) {
        const row = byDay.get(g.day) ?? { gated: 0, blind: 0, shown: 0 };
        row.gated += 1;
        if (g.blind) row.blind += 1;
        row.shown += g.shown;
        byDay.set(g.day, row);
      }
      for (const [day, row] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
        log(
          `cards trend day=${day} gated=${row.gated} blind=${row.blind} meanShown=${(row.shown / Math.max(1, row.gated)).toFixed(2)}`,
        );
      }
      log(`gateOpen=${gateOpen(pass, HARNESS_VERSION)} clean=${pass.clean} totalityOk=${pass.totalityOk} sample=${pass.sample}`);
    } catch (err) {
      // The run is paid for and persisted; the scorer owes an explanation, not
      // the corpus another $30.
      log(`scoring FAILED after a persisted run: ${err instanceof Error ? `${err.name} ${err.message}` : String(err)}`);
      return 1;
    } finally {
      run.counterpart.close();
    }
    return 0;
  } finally {
    corpus.close();
  }
}

process.exit(await main(process.argv.slice(2)));

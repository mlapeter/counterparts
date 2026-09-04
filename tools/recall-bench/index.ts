/**
 * `tools/recall-bench` — what would ambient recall have delivered, for these
 * real prompts, against this store?
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * Scar §2.8: no recall threshold ships unmeasured against the real space. The
 * replay tool answers "does the machinery still behave" against a fixture
 * corpus; this one answers a narrower and more embarrassing question — *for the
 * thirteen things the owner actually typed on 2026-09-03/04, which memories came
 * back, and were they the nine 9-to-20 KB hubs that came back for everything?*
 * A tunable claiming a calibration needs a table like this behind it, and the
 * table has to be re-runnable by hand after the next change.
 *
 * ── READ-ONLY DISCIPLINE (tools/parallel's rule, tightened) ──────────────────
 *
 * `tools/parallel` defaults its paths to the live locations and never writes
 * them. This tool goes one step further and has NO default store at all: the
 * operator names the directory, and `refuseLiveStore()` rejects anything inside
 * `~/.counterparts`, `~/.bansai` or `~/.claude-engram` outright. The intended
 * use is a COPY (`cp -R ~/.counterparts/store /tmp/store-copy`), because the
 * only honest bench corpus is the real one and the real one is not ours to open
 * read-write.
 *
 * Within that, exactly ONE core entry point is called: `Recall.build()`. Build
 * is the pure half of the ambient path by contract (§5 G3) — it reads, scores,
 * gates and composes, and writes nothing, no gate state and no telemetry. The
 * recording half, `recall()`, is never reached from this file, and neither is
 * `resolveUse`, `coactivate` or any deposit. Nothing durable happens.
 *
 * ── WHAT IT MEASURES, AND WHAT IT CANNOT ────────────────────────────────────
 *
 * **The lexical channel only.** The store is opened with no embedder and the
 * bench passes no turn vector, so `activate`'s semantic channel contributes
 * nothing. That is not a simplification for the bench's convenience — it is
 * today's live condition: authored memories carry no embeddings, and the hook
 * path passes no turn vector (another agent is wiring that). When the semantic
 * channel lands, these numbers are a lexical-only baseline to compare against,
 * not a prediction of what recall will then do.
 *
 * **One turn at a time.** Every query gets a FRESH session id, so per-session
 * dedup never fires. That isolates the scorer, which is the thing under test —
 * and it is deliberately stricter than the live run, where the same nine hubs
 * were spent once and then made 12 of 19 turns read "all-gated". If the hubs
 * still come back here, dedup was the only thing hiding them.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { DELIBERATE_DIM_CAP, tierOf } from "../../src/adapters/mcp/deliberate.js";
import { Recall, withTunables } from "../../src/core/recall/index.js";
import { activate } from "../../src/core/recall/index.js";
import { DEFAULT_DATA_DIR_NAME, Store, forbiddenRoots, isWithin } from "../../src/core/store/index.js";
import type { BenchConfig, BenchInput, BenchReport, Delivered, QueryRow, ToolRow } from "./types.js";

export type { BenchConfig, BenchInput, BenchReport } from "./types.js";

/**
 * The configuration that reproduces the pre-normalization scorer EXACTLY.
 *
 * `2·tf/(tf+1)` is BM25 at `b = 0, k1 = 1`, and for the single-token probes the
 * cue channel issues it is monotone in `tf` with the same id tiebreak — so the
 * fetch set and the ordering are the ones the old code saw. That is why "before"
 * needs no checkout of master: it is this binary with these three numbers.
 */
export const BEFORE: BenchConfig = { name: "before (b=0, no cap)", b: 0, k1: 1, cap: Infinity };

/** Ids delivered on `MIN_RECURRENCE` turns or more: the hub metric that needs no
 *  blocklist. `known_hubs` names the nine that were caught; this names whatever
 *  is behaving like them THIS run. */
export const MIN_RECURRENCE = 3;

/**
 * The roots this tool refuses to open, whatever the operator typed.
 *
 * The two v1 roots come from `store/paths.ts`'s own list rather than being
 * retyped here — a second copy of that list is the drift `test/store.test.ts`'s
 * name tripwire exists to catch. The v2 root is composed from the store's
 * exported constants for the same reason, and DELIBERATELY from `homedir()`
 * rather than from `dataDir()`: `dataDir()` follows `COUNTERPARTS_DATA_DIR`,
 * which every hermetic test points at a temp directory, and a guard that
 * refuses whatever the environment currently says is a guard that refuses the
 * test corpus and permits the live store on a machine where the variable is set.
 */
export function forbiddenStoreRoots(): string[] {
  return [resolve(join(homedir(), DEFAULT_DATA_DIR_NAME)), ...forbiddenRoots()];
}

/**
 * CLAUDE.md's second safety rule, as a predicate rather than as a paragraph the
 * operator is asked to remember. Returns the offending root, or null.
 */
export function refuseLiveStore(dir: string): string | null {
  for (const root of forbiddenStoreRoots()) {
    if (isWithin(root, dir)) return root;
  }
  return null;
}

export function readBenchInput(path: string): BenchInput {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as BenchInput;
  if (!Array.isArray(parsed.queries)) throw new Error("bench input has no `queries` array");
  return parsed;
}

function split(
  store: Store,
  wanted: readonly string[],
  delivered: readonly Delivered[],
): { wanted: string[]; missed: string[]; absent: string[] } {
  const got = new Set(delivered.map((d) => d.id));
  const hit: string[] = [];
  const missed: string[] = [];
  const absent: string[] = [];
  for (const id of wanted) {
    if (got.has(id)) {
      hit.push(id);
      continue;
    }
    // A labeled id that is not in this store is NOT a miss. Several of the
    // labels were minted after the session they are labels for; scoring them as
    // misses would make the bench look worse the more honest the label file is.
    let exists = false;
    try {
      exists = store.row(store.resolve(id)) !== undefined;
    } catch {
      exists = false;
    }
    (exists ? missed : absent).push(id);
  }
  return { wanted: hit, missed, absent };
}

/**
 * Run one configuration over the whole input. The store is opened ONCE per run
 * and the tunables ride in through `Recall`'s own constructor, which is the
 * seam a calibration claim is supposed to move through.
 */
export function runBench(storeDir: string, input: BenchInput, config: BenchConfig): BenchReport {
  const offending = refuseLiveStore(storeDir);
  if (offending !== null) {
    throw new Error(`recall-bench refuses to open a live store: ${storeDir} is inside ${offending}`);
  }
  const store = Store.open({ dir: storeDir });
  try {
    return benchOverStore(store, input, config);
  } finally {
    store.close();
  }
}

export function benchOverStore(store: Store, input: BenchInput, config: BenchConfig): BenchReport {
  const tunables = withTunables({
    CUE_LENGTH_NORM: config.b,
    CUE_TF_SATURATION: config.k1,
    CUE_LENGTH_ONE_SIDED: config.oneSided === true,
    CUE_DOC_CAP: config.cap,
    // The bench measures the SCORER, not the clock: a cold 300 MB index in a
    // fresh process is the latency finding of a different PR, and letting it
    // abort here would silently turn a scoring table into a timing table. The
    // real elapsed time is reported per row so the two never get confused.
    BUDGET_MS: 600_000,
  });
  const recall = new Recall({ store, owner: true, tunables });
  const hubs = new Set(input.known_hubs ?? []);
  const day = store.livedDay();
  const storeSize = store.list({ archived: false }).length;

  const rows: QueryRow[] = [];
  for (const [i, q] of input.queries.entries()) {
    const label = q.turn === undefined ? `q${i + 1}` : `turn ${q.turn}`;
    // A FRESH session per query: no dedup, no cue carry-over, no refractory.
    const built = recall.build({ sessionId: `bench-${config.name}-${i}`, text: q.text, owner: true, day });
    const d = built.decision;
    const delivered: Delivered[] = [
      ...d.surfaced.map((id) => ({ id, tier: "surfaced" })),
      ...d.footnotes.map((id) => ({ id, tier: "footnote" })),
    ];
    // The cap counter is not in `RecallDecision` on purpose (that record's field
    // list is a hashed surface set the parallel run carries ratings across), so
    // the bench asks the activation pass for it directly.
    const act = activate(
      store,
      {
        text: q.text,
        day,
        selfFelt: false,
        maxCandidates: tunables.MAX_CANDIDATES,
        storeSize: d.storeSize > 0 ? d.storeSize : storeSize,
      },
      tunables,
    );
    const marks = split(store, q.labels?.should_surface ?? [], delivered);
    rows.push({
      label,
      reason: d.reason,
      candidates: d.candidates,
      capped: act.capped,
      delivered,
      hubHits: delivered.filter((x) => hubs.has(x.id)).map((x) => x.id),
      ...marks,
      elapsedMs: d.elapsedMs,
    });
  }

  const toolRows: ToolRow[] = [];
  for (const [i, tq] of (input.tool_queries ?? []).entries()) {
    toolRows.push(runToolQuery(store, recall, tq, hubs, day, `tool ${i + 1}`));
  }

  // Recurrence, over the ambient turns only: the tool queries are a different
  // question and would double-count the same memory under a different intent.
  const seen = new Map<string, { turns: number; loud: number }>();
  for (const r of rows) {
    for (const d of new Map(r.delivered.map((x) => [x.id, x])).values()) {
      const e = seen.get(d.id) ?? { turns: 0, loud: 0 };
      e.turns += 1;
      if (d.tier === "surfaced") e.loud += 1;
      seen.set(d.id, e);
    }
  }
  const recurring = [...seen.entries()]
    .filter(([, e]) => e.turns >= MIN_RECURRENCE)
    .map(([id, e]) => ({ id, turns: e.turns, loud: e.loud }))
    .sort((a, b) => b.turns - a.turns || (a.id < b.id ? -1 : 1));
  const recurringIds = new Set(recurring.map((r) => r.id));

  const totals = {
    turns: rows.length,
    delivered: rows.reduce((a, r) => a + r.delivered.length, 0),
    surfaced: rows.reduce((a, r) => a + r.delivered.filter((d) => d.tier === "surfaced").length, 0),
    footnotes: rows.reduce((a, r) => a + r.delivered.filter((d) => d.tier === "footnote").length, 0),
    hubHits: rows.reduce((a, r) => a + r.hubHits.length, 0),
    turnsWithHub: rows.filter((r) => r.hubHits.length > 0).length,
    wanted: rows.reduce((a, r) => a + r.wanted.length, 0),
    missed: rows.reduce((a, r) => a + r.missed.length, 0),
    absent: rows.reduce((a, r) => a + r.absent.length, 0),
    allGated: rows.filter((r) => r.reason === "all-gated").length,
    rendered: rows.filter((r) => r.reason === "rendered").length,
    capped: rows.reduce((a, r) => a + r.capped, 0),
    maxElapsedMs: rows.reduce((a, r) => Math.max(a, r.elapsedMs), 0),
    recurring,
    recurringDeliveries: rows.reduce(
      (a, r) => a + r.delivered.filter((d) => recurringIds.has(d.id)).length,
      0,
    ),
  };
  return { config, storeSize, rows, toolRows, totals };
}

/**
 * The deliberate path, through the SAME scoring. `tierOf` is imported from the
 * adapter rather than reimplemented: a bench that re-derives the tiering is
 * measuring its own copy of it (observer-mode.md G7, in miniature).
 *
 * `chars` is what the tool would put on the wire under the OLD payload — full
 * bodies for everything admitted. It is reported because that number, not the
 * ranking, is what overflowed the host's tool-result cap on 3 of 3 calls.
 */
function runToolQuery(
  store: Store,
  recall: Recall,
  tq: { question: string; should_surface?: readonly string[] },
  hubs: ReadonlySet<string>,
  day: number,
  label: string,
): ToolRow {
  const built = recall.build({ sessionId: `bench-tool-${label}`, text: tq.question, owner: true, day });
  const d = built.decision;
  const surfaced = new Set(d.surfaced);
  const footnoted = new Set(d.footnotes);
  const admitted: Delivered[] = [];
  const dim: { id: string; activation: number }[] = [];
  for (const v of d.verdicts) {
    const tier = tierOf(v.verdict, surfaced.has(v.id), footnoted.has(v.id));
    if (tier === null) continue;
    if (tier === "dim") dim.push({ id: v.id, activation: v.activation });
    else admitted.push({ id: v.id, tier });
  }
  dim.sort((a, b) => b.activation - a.activation);
  for (const v of dim.slice(0, DELIBERATE_DIM_CAP)) admitted.push({ id: v.id, tier: "dim" });

  let chars = 0;
  for (const m of admitted) {
    try {
      chars += store.readProse(m.id).body.length;
    } catch {
      // A row whose prose has gone contributes no characters and no failure.
    }
  }
  const marks = split(store, tq.should_surface ?? [], admitted);
  return {
    label,
    reason: d.reason,
    considered: d.candidates,
    returned: admitted.length,
    chars,
    delivered: admitted,
    hubHits: admitted.filter((x) => hubs.has(x.id)).map((x) => x.id),
    ...marks,
  };
}

// ── rendering ───────────────────────────────────────────────────────────────

/** A markdown table, because the destination of this output is a PR body. */
export function renderReport(report: BenchReport): string {
  const out: string[] = [];
  out.push(`### ${report.config.name}  —  b=${report.config.b}, k1=${report.config.k1}, cap=${report.config.cap}`);
  out.push(`store: ${report.storeSize} live memories · lexical channel only (no embedder, no turn vector)`);
  out.push("");
  out.push("| turn | reason | cand | capped | delivered (tier:id) | hub hits | wanted | missed | absent | ms |");
  out.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of report.rows) {
    const delivered = r.delivered.map((d) => `${d.tier[0]}:${d.id}`).join(" ") || "—";
    out.push(
      `| ${r.label} | ${r.reason} | ${r.candidates} | ${r.capped} | ${delivered} | ${r.hubHits.length > 0 ? r.hubHits.join(" ") : "—"} | ${r.wanted.join(" ") || "—"} | ${r.missed.join(" ") || "—"} | ${r.absent.length} | ${Math.round(r.elapsedMs)} |`,
    );
  }
  const t = report.totals;
  out.push("");
  out.push(
    `**totals** — turns ${t.turns} · delivered ${t.delivered} (loud ${t.surfaced}, footnotes ${t.footnotes}) · **hub hits ${t.hubHits}** (on ${t.turnsWithHub}/${t.turns} turns) · **should-surface hits ${t.wanted}**, missed ${t.missed}, absent-from-store ${t.absent} · rendered ${t.rendered} · all-gated ${t.allGated} · capped docs ${t.capped} · max ${Math.round(t.maxElapsedMs)} ms`,
  );
  out.push("");
  out.push(
    t.recurring.length === 0
      ? `**recurrence** — no id was delivered on ${MIN_RECURRENCE} or more of the ${t.turns} turns.`
      : `**recurrence** — ${t.recurring.length} id(s) on >= ${MIN_RECURRENCE} turns, ` +
        `${t.recurringDeliveries} of ${t.delivered} deliveries: ` +
        t.recurring.map((r) => `\`${r.id}\` ${r.turns}x (loud ${r.loud})`).join(", "),
  );
  if (report.toolRows.length > 0) {
    out.push("");
    out.push("| tool query | reason | considered | returned | body chars | hub hits | wanted | missed | absent |");
    out.push("|---|---|---|---|---|---|---|---|---|");
    for (const r of report.toolRows) {
      out.push(
        `| ${r.label} | ${r.reason} | ${r.considered} | ${r.returned} | ${r.chars} | ${r.hubHits.length > 0 ? r.hubHits.join(" ") : "—"} | ${r.wanted.join(" ") || "—"} | ${r.missed.join(" ") || "—"} | ${r.absent.length} |`,
      );
    }
  }
  return out.join("\n");
}

/** The sweep's one-line-per-cell summary — how `b` and the cap were chosen. */
export function renderSweep(reports: readonly BenchReport[]): string {
  const out: string[] = [];
  out.push("| config | hub hits | turns w/ hub | should-surface hits | missed | delivered | loud | footnotes | recurring ids | recurring deliveries | capped docs |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of reports) {
    const t = r.totals;
    out.push(
      `| ${r.config.name} | ${t.hubHits} | ${t.turnsWithHub}/${t.turns} | ${t.wanted} | ${t.missed} | ${t.delivered} | ${t.surfaced} | ${t.footnotes} | ${t.recurring.length} | ${t.recurringDeliveries} | ${t.capped} |`,
    );
  }
  return out.join("\n");
}

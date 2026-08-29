/**
 * `tools/replay/baselines.ts` — v1's distributional baselines, as a registry.
 *
 * One entry per number in `docs/harvest/replay-baselines.md` §1, plus the two
 * criteria from §3 that only a human can render. Each entry says what v1
 * measured, and then does ONE of three things, always explicitly:
 *
 *   - grades the replay against a RANGE,
 *   - hands the criterion to a rater,
 *   - declares itself not-computable / not-comparable WITH A REASON.
 *
 * There is no fourth option, and no entry may be silent: `report.ts` throws on an
 * entry that neither computes nor declares (the totality tripwire, CONTRACT §5
 * guarantee 9). `test/replay.test.ts` additionally source-scans the baselines
 * document and fails when a `### 1.x` section has no entry here — a list nobody
 * maintains is exactly what that scar is about.
 *
 * WHY RANGES AND NOT NUMBERS. replay-baselines §1.3 is the lesson in miniature:
 * the same blind rate reads 17.05% over the full instrumented window and 24.71%
 * over the six-day sub-window behind the standing "22%", on 4–45 events a day
 * swinging 0–78%. Both are honest reads of a noisy metric. A gate naming a
 * precise percentage would be measuring noise, so every band below is wide on
 * purpose, and §17.3's own bound is adopted rather than re-derived: ingestion is
 * nondeterministic, equivalent code scored 63–75% across runs of one benchmark,
 * and per-category moves of ±0.1 are noise.
 *
 * THE SCORER'S ARITHMETIC IS ITS OWN (guarantee 5). Every `compute` below counts
 * over the observation with plain arithmetic; nothing here imports `src/`, so a
 * bug in the code under test cannot grade itself.
 */
import type { MetricSpec, ObservedEvent, ReplayObservation, Sample } from "./types.js";

// ---------------------------------------------------------------------------
// Counting helpers — the scorer's own arithmetic, and all of it
// ---------------------------------------------------------------------------

/** A rate, or `null` when the denominator is empty. A zero denominator is
 *  "never asked", which is a different record from a zero rate (scar §2.4). */
function rate(numerator: number, denominator: number): Sample | null {
  if (denominator <= 0) return null;
  return { value: numerator / denominator, numerator, denominator };
}

function mean(total: number, count: number): Sample | null {
  if (count <= 0) return null;
  return { value: total / count, numerator: total, denominator: count };
}

function sum<T>(xs: readonly T[], f: (x: T) => number): number {
  let total = 0;
  for (const x of xs) total += f(x);
  return total;
}

/**
 * Chunks whose gate verdict was actually matched to them — the ONLY honest
 * denominator for a gate rate. A chunk that never reached the gate carries
 * zeros meaning "not asked", and averaging those in would read as a gate that
 * refused nothing (scar §2.4).
 */
function gatedChunks(o: ReplayObservation): readonly ReplayObservation["chunks"][number][] {
  return o.chunks.filter((c) => c.gated);
}

/** Chunks whose interpretation completed — v1's `interpret.done` denominator. */
function interpretedChunks(o: ReplayObservation): readonly ReplayObservation["chunks"][number][] {
  return o.chunks.filter((c) => c.ok);
}

function livingMemories(o: ReplayObservation): number {
  return o.store.memories - o.store.archived;
}

/** Relayed events by exact name — content-by-reference only (types.ts), so this
 *  never touches a body or transcript string. */
function eventsNamed(o: ReplayObservation, name: string): readonly ObservedEvent[] {
  return o.events.filter((e) => e.name === name);
}

/** A numeric field off an event's data, or `null` when absent or non-numeric —
 *  never coerced, never guessed. */
function numField(e: ObservedEvent, key: string): number | null {
  const v = e.data[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const METRICS: readonly MetricSpec[] = [
  // ── §1.1 gate pass/block ────────────────────────────────────────────────
  {
    id: "gate.chunkBlockRate",
    section: "1.1",
    label: "Proposals refused by the encode battery, per gated chunk",
    v1: "≈46.4% (737 gate fires vs 782 claimed spans — an event-count numerator over a span-count denominator, so an order-of-magnitude figure)",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0.2, hi: 0.75 },
      note: "v1's own figure is explicitly order-of-magnitude; the band is correspondingly wide.",
    },
    compute: (o) => {
      const chunks = gatedChunks(o);
      const refused = sum(chunks, (c) => c.refused);
      const accepted = sum(chunks, (c) => c.accepted);
      return rate(refused, refused + accepted);
    },
  },
  {
    id: "gate.refusalMix",
    section: "1.1",
    label: "The secrets gate's share of all gate fires (secrets / alias / precision)",
    v1: "secrets 485, alias 222, precision 30 — secrets is 66% of all fires",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0, hi: 0.9 },
      note: "WIDE, and the reason is beside it: v1's secrets fires rode on the EPISODE surface — 483 of 737 fires were on episode text — which a raw-span replay does not exercise at all (see `gate.episodeSurfaceShare`). A low secrets share here is a corpus fact before it is a regression, and a zero is legitimate: a corpus with no credential shapes in it fires no secrets gate. What the metric really grades is that the mix EXISTS — the per-gate distribution is recoverable from a replayed store, which it was not before `gate.chunk`. VOCABULARY (review F7): these are FIRES — gates ACTING (redact, hedge, feeling-kill, drop) — not refusals. v2's battery refuses a proposal only three ways (secret-in-name, empty-after-redaction, content floor); alias/precision/emotion degrade and accept by design. Refusals live in `gate.chunkBlockRate`; the id predates the split and is kept for record stability.",
    },
    compute: (o) => {
      // The battery's OWN count of an acting gate: it writes one `gate.<name>`
      // event per gate that fired or rejected, and the record relays those.
      let secrets = 0;
      let total = 0;
      for (const g of o.gateRecords) {
        for (const [gate, n] of Object.entries(g.fires)) {
          total += n;
          if (gate === "secrets") secrets += n;
        }
      }
      return rate(secrets, total);
    },
  },
  {
    id: "gate.episodeSurfaceShare",
    section: "1.1",
    label: "Share of gate fires on episode text",
    v1: "episode 483 of 737 fires (66%) — the most heavily gated surface in v1",
    unit: "rate",
    grading: {
      kind: "not-computable",
      why: "Episodes are v1 OUTPUT, not replay input (§17.1): the raw-span corpus contains no episode-ingest surface to gate. The v2 episode gate is wired (SEAMS H) and covered by the seam suite, not by replay.",
    },
  },

  // ── §1.2 interpretation outcomes ────────────────────────────────────────
  {
    id: "interpret.spansPerChunk",
    section: "1.2",
    label: "Spans per interpreted chunk",
    v1: "1.09 mean",
    unit: "mean",
    grading: { kind: "range", range: { lo: 0.8, hi: 1.6 } },
    compute: (o) => mean(sum(o.chunks, (c) => c.spans), o.chunks.length),
  },
  {
    id: "interpret.proposalsPerChunk",
    section: "1.2",
    label: "Proposals returned per chunk",
    v1: "1.85 traces/chunk (a v1 trace is a v2 proposal before the gate)",
    unit: "mean",
    grading: {
      kind: "range",
      range: { lo: 1.0, hi: 3.0 },
      note: "Ingestion is nondeterministic (§17.3): the band, not the point, is the claim.",
    },
    compute: (o) => {
      const done = interpretedChunks(o);
      return mean(sum(done, (c) => c.proposals), done.length);
    },
  },
  {
    id: "interpret.mintsPerChunk",
    section: "1.2",
    label: "Memories minted per chunk (post-gate yield)",
    v1: "1.85 traces/chunk — v1 did not separate pre- and post-gate yield",
    unit: "mean",
    grading: { kind: "range", range: { lo: 0.8, hi: 3.0 } },
    compute: (o) => {
      const done = interpretedChunks(o);
      return mean(sum(done, (c) => c.minted), done.length);
    },
  },
  {
    id: "interpret.meanChunkBytes",
    section: "1.2",
    label: "Bytes per chunk",
    v1: "mean 9,221 · median 4,099 (right-skewed)",
    unit: "bytes",
    grading: {
      kind: "range",
      range: { lo: 3000, hi: 15000 },
      note: "v2's `CHUNK_BYTES` target is 12,000; v1's mean sat below its own target too.",
    },
    compute: (o) => mean(sum(o.chunks, (c) => c.bytes), o.chunks.length),
  },
  {
    id: "interpret.zeroYieldChunkRate",
    section: "1.2",
    label: "Chunks that produced nothing",
    v1: "128 of 780 (16.4%)",
    unit: "rate",
    grading: { kind: "range", range: { lo: 0.05, hi: 0.35 } },
    compute: (o) => {
      const done = interpretedChunks(o);
      return rate(done.filter((c) => c.minted === 0).length, done.length);
    },
  },
  {
    id: "interpret.chunkFailureRate",
    section: "1.2",
    label: "Chunks lost to truncation, malformed output, or a throw",
    v1: "parse-retry 0.64%; 5 of 7 `system.error` events were interpreter parse failures",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0, hi: 0.03 },
      note: "Scar E2: a truncated response is a failure, not data. Per-chunk isolation means a failure costs one chunk (E1), and the spans come back (E6).",
    },
    compute: (o) => rate(o.chunks.filter((c) => !c.ok).length, o.chunks.length),
  },
  {
    id: "run.captureCoverage",
    section: "1.2",
    label: "Corpus spans accounted for at capture (captured + deduped + excluded, over offered)",
    v1: "no v1 counterpart — a harness-validity floor added after review F2: the first real run silently dropped 13.2% of the corpus at the capture seam and no metric said so",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 1, hi: 1 },
      note: "HARD, and a wiring check rather than a distribution: every span the corpus offers must come back as a captured span, a counted dedup, or a counted exclusion. Anything less is the driver silently replaying a subset while the scorecard grades it as the whole — the exact failure that let the first run grade a replay that never saw an eighth of its input.",
    },
    compute: (o) => {
      const offered = sum(o.days, (d) => d.spansOffered);
      if (offered <= 0) return null;
      return rate(
        sum(o.days, (d) => d.spansCaptured + d.deduped + d.excluded),
        offered,
      );
    },
  },
  {
    id: "run.seatRecorded",
    section: "1.2",
    label: "The acting model seat is recorded in the run record",
    v1: "model uniformly `claude-opus-5` on the 85 of 780 events carrying the field",
    unit: "flag",
    grading: {
      kind: "range",
      range: { lo: 1, hi: 1 },
      note: "CONTRACT §5 guarantee 8. v1 added the seat because 'which seat ran' had been unanswerable for months, and it is what makes the not-comparable rule enforceable.",
    },
    compute: (o) => ({ value: o.seat.trim().length > 0 ? 1 : 0 }),
  },
  {
    id: "ops.outcomeMix",
    section: "1.2",
    label: "Operation outcomes (applied / rejected / deferred)",
    v1: "applied 7,592 (99.32%), rejected 40 (0.52%), deferred 12 (0.16%)",
    unit: "rate",
    grading: {
      kind: "not-comparable",
      why: "v1's operation vocabulary (`selfIndex.add`, `trace.handle.add`, `currentState.update`) belongs to a v1 mechanism. v2 mints memories and revises them; there is no op engine to grade, so these rates are a v1 baseline, not a v2 regression check.",
    },
  },

  // ── §1.3 preselection ───────────────────────────────────────────────────
  {
    id: "preselect.blindRate",
    section: "1.3",
    label: "Chunks encoded blind (no schema shown) — THE headline number",
    v1: "17.05% full-window (22/129); 24.71% on the 08-19→08-24 sub-window behind the standing 22%; daily 0–78% on 4–45 events",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0.1, hi: 0.35 },
      note: "Roughly a fifth to a quarter, on a metric that needs WEEKS to stabilize. A gate naming a precise percentage would be measuring noise (CONTRACT §4).",
    },
    compute: (o) => {
      const gated = gatedChunks(o);
      return rate(gated.filter((c) => c.blind).length, gated.length);
    },
  },
  {
    id: "preselect.blindButProductiveRate",
    section: "1.3",
    label: "Blind chunks that still minted something",
    v1: "8 of 22 (36.4%) — the finding that graduated option (b) preselection to v1's fix queue",
    unit: "rate",
    grading: { kind: "range", range: { lo: 0.15, hi: 0.65 } },
    compute: (o) => {
      const blind = gatedChunks(o).filter((c) => c.blind);
      return rate(blind.filter((c) => c.minted > 0).length, blind.length);
    },
  },
  {
    id: "preselect.meanSchemasShown",
    section: "1.3",
    label: "Mean schemas shown per chunk",
    v1: "1.95 over instrumented events",
    unit: "mean",
    grading: {
      kind: "range",
      range: { lo: 0.5, hi: 4 },
      note: "v1-anchored, and EXPECTED TO FAIL AT ZERO until `applySweep` hands the chunk gate a schema slice — it passes none today, so preselection has nothing to select from and every chunk reads blind (INTERFACE-GAPS §1a). That failure is the point: the number is now computable, so the gap shows up as a red line in the scorecard instead of as an absence nobody has to answer for.",
    },
    compute: (o) => mean(sum(o.gateRecords, (g) => g.shown), o.gateRecords.length),
  },
  {
    id: "preselect.channelMix",
    section: "1.3",
    label: "Share of shown schemas the SEMANTIC channel alone reached",
    v1: "`both` ×16, `semantic` ×10 — one day of data (2026-08-25), flagged as a field to carry from day one; semantic-only is 10/26 = 38.5%",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0.1, hi: 0.8 },
      note: "The question §8 G4 exists to answer — did the channel that only ever ADDS actually add anything? — so the numerator is the semantic-ONLY count, not the overlap. The denominator is shown schemas on chunks where the semantic channel RAN: with no vectors wired (INTERFACE-GAPS §4) it is `skipped` everywhere, and a zero under `skipped` means never-asked, not 'semantic adds nothing' (scar §2.4). Never-asked lands as `no-denominator`.",
    },
    compute: (o) => {
      const ran = o.gateRecords.filter((g) => g.semanticState === "ran");
      const shown = sum(ran, (g) => g.shownLexicalOnly + g.shownSemanticOnly + g.shownBoth);
      return rate(sum(ran, (g) => g.shownSemanticOnly), shown);
    },
  },

  // ── §1.4 recall / surfacing ─────────────────────────────────────────────
  {
    id: "surface.meanSurfaced",
    section: "1.4",
    label: "Memories surfaced per turn decision",
    v1: "1.07 mean over 88 decisions",
    unit: "mean",
    grading: { kind: "not-computable", why: NO_TURN_LOOP() },
  },
  {
    id: "surface.zeroSurfacedRate",
    section: "1.4",
    label: "Turns that surfaced nothing",
    v1: "40 of 88 (45.5%)",
    unit: "rate",
    grading: { kind: "not-computable", why: NO_TURN_LOOP() },
  },
  {
    id: "surface.meanFootnotes",
    section: "1.4",
    label: "Footnotes per turn decision",
    v1: "2.81 mean (retune bar B1: footnote flood >40% fails)",
    unit: "mean",
    grading: { kind: "not-computable", why: NO_TURN_LOOP() },
  },
  {
    id: "surface.affectFlagRate",
    section: "1.4",
    label: "Affect / high-affect flag rate",
    v1: "affect 7.95%, highAffect 2.27% (retune bar B2: affect-flag noise >25% fails)",
    unit: "rate",
    grading: { kind: "not-computable", why: NO_TURN_LOOP() },
  },
  {
    id: "surface.loudOffTopicRate",
    section: "3.1",
    label: "Loud-tier intrusions rated off-topic (hard trip A2)",
    v1: "≤5%, human-rated — a hard trip in `eval/replay/GATES.md`",
    unit: "rate",
    grading: {
      kind: "rater",
      bar: "≤5% of loud-tier surfacings rated off-topic, over a sample a human actually read. A2 in v1's criteria ledger; the surface it grades is the per-turn surfacing decision record (§17.3's richest comparison surface).",
    },
  },

  // ── §1.5 reinforcement + gradient ───────────────────────────────────────
  {
    id: "gradient.moveMix",
    section: "1.5",
    label: "Gradient moves by reason",
    v1: "896 moves: self-index-refresh 69%, confirm 23%, nuance 8%",
    unit: "rate",
    grading: {
      kind: "not-comparable",
      why: "v1's inert-gradient vocabulary describes its self-index refresh cycle, a v1 mechanism. v2's equivalent movement is band assignment under `physics/`, graded by the band metrics in this section.",
    },
  },
  {
    id: "band.promotionsPerActiveDay",
    section: "1.5",
    label: "Band promotions per active day (UP-moves, counted by direction)",
    v1: "episodic→semantic 34 + consolidating→semantic 21 over 9 days ≈ 6.1/day",
    unit: "per-day",
    grading: {
      kind: "range",
      range: { lo: 0, hi: 15 },
      note: "v1's crossings only started firing 2026-08-15, after the belief migration unblocked them — a 9-day denominator, not 26. The numerator is every UP-move, not only the identity crossing: v1's 6.1/day were episodic→semantic band moves, which in v2 happen in the decay materialization, not in the promotion pass. REPLAY CAVEAT (review F3/F6): with no turn loop, `uses` never move, so the identity crossing's 3-distinct-days condition is unsatisfiable and a decay up-move needs strength to RISE without reinforcement — a 0 in replay is structural, not behavior. The metric earns its range in the parallel run.",
    },
    compute: (o) => mean(sum(o.cycles, (c) => c.bandUp), o.activeDays),
  },
  {
    id: "band.demotionsPerActiveDay",
    section: "1.5",
    label: "Band demotions per active day (DOWN-moves, counted by direction)",
    v1: "semantic→episodic 268 of 345 crossings (decay demotions dominate at 84%)",
    unit: "per-day",
    grading: {
      kind: "range",
      range: { lo: 0, hi: 40 },
      note: "The band this pairs with is `band.promotionsPerActiveDay`, and the pair IS physics' symmetry counter (guarantee 12, scar §2.10 — v1's ratchet read 279:0 for three days and nothing fired). The ceiling is generous for the same reason `decay.rowsPerTick` is not-comparable at all: v1's 29.8 demotions a day rode on 13.5K accumulated rows, and a replay store holds ~30 days. A ZERO here beside a nonzero promotion count is the interesting reading, not a clean one.",
    },
    compute: (o) => mean(sum(o.cycles, (c) => c.bandDown), o.activeDays),
  },
  {
    id: "band.symmetryAsked",
    section: "1.5",
    label: "The ratchet tripwire renders a verdict, and no verdict reads healthy on a starved sample",
    v1: "no v1 counterpart: v1 had NO symmetry counter, which is why 279 up-moves against zero down-moves ran for three days unnoticed (scar §2.10)",
    unit: "flag",
    grading: {
      kind: "range",
      range: { lo: 1, hi: 1 },
      note: "Not a distributional comparison — a wiring check, and the one this section was missing. Passes when every cycle rendered a verdict per kind AND every verdict below the minimum sample says `never-asked` rather than `within-expectation`. `never-asked` carries `ok: true`, so a consumer reading `ok` alone reads a starved counter as health; this asserts the REASON is what travels.",
    },
    compute: (o) => {
      if (o.symmetry.length === 0) return null;
      const honest = o.symmetry.every(
        (v) => v.reason !== "within-expectation" || v.up + v.down > 0,
      );
      const tripped = o.symmetry.filter((v) => !v.ok).length;
      return {
        value: honest ? 1 : 0,
        numerator: o.symmetry.length - tripped,
        denominator: o.symmetry.length,
      };
    },
  },
  {
    id: "reinforce.missMix",
    section: "1.5",
    label: "Reinforcement misses by cause",
    v1: "190 misses: no-eligible-occasion 61.1%, no-grounding-trace 26.3%, element-not-live 12.6%",
    unit: "rate",
    grading: { kind: "not-computable", why: NO_TURN_LOOP() },
  },

  // ── §1.6 decay ──────────────────────────────────────────────────────────
  {
    id: "decay.ticksPerActiveDay",
    section: "1.6",
    label: "Decay ticks per active day (the lived-day clock, scar E8)",
    v1: "26 ticks over 26 active days — exactly one per day lived",
    unit: "per-day",
    grading: {
      kind: "range",
      range: { lo: 0.9, hi: 1.1 },
      note: "The clock property this grades is the scar: a week away must not decay a week's worth.",
    },
    compute: (o) => mean(o.cycles.filter((c) => c.decayRan).length, o.activeDays),
  },
  {
    id: "decay.changedShare",
    section: "1.6",
    label: "Share of live memories whose strength row moved, per tick",
    v1: "mean 1,718 nodes decayed per tick against 13,005 live rows ≈ 13.2%",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0.02, hi: 0.35 },
      note: "The size-independent port of v1's raw row count. CAVEATS, both from the 2026-08-26 review (F3): the band is v1's MATURE store — with `DECAY_QUANTUM` at 1e-4 a row keeps moving daily for ~250-400 lived days after its last reinforcement, so a young or still-growing store reads high for its first year and that FAIL is age, not defect. And the first build divided by ticks x FINAL store size, understating churn on a growing corpus (56% reported vs 96% true); the denominator is now the per-tick examined count the cycles actually recorded.",
    },
    compute: (o) => {
      const ticks = o.cycles.filter((c) => c.decayRan);
      const examined = sum(ticks, (c) => c.decayExamined);
      if (ticks.length === 0 || examined <= 0) return null;
      return rate(sum(ticks, (c) => c.decayChanged), examined);
    },
  },
  {
    id: "decay.rowsPerTick",
    section: "1.6",
    label: "Absolute rows decayed per tick",
    v1: "mean 1,718 (min 799, max 3,046); skippedIdentity 15.7, skippedPinned 1.5",
    unit: "count",
    grading: {
      kind: "not-comparable",
      why: "The absolute count scales with corpus size, and a replay store holds ~30 days of spans against v1's 13.5K accumulated memories. The size-independent port is `decay.changedShare`.",
    },
  },
  {
    id: "decay.expireReasons",
    section: "1.6",
    label: "Expiries by reason",
    v1: "15 expiries, all `task-state`; no other reason fired in the window",
    unit: "count",
    grading: {
      kind: "not-computable",
      why: "v1's only expire reason was task-state, a v1 curation path. v2 forgets by decay-to-floor and pruning; nothing in the raw-span corpus drives a task-state expiry.",
    },
  },

  // ── §1.7 prospective memory ─────────────────────────────────────────────
  {
    id: "prospective.fireRate",
    section: "1.7",
    label: "Fires over fire+suppressed",
    v1: "45.5% (15 fires, 18 suppressed — all `prior-session-high-affect`, one day)",
    unit: "rate",
    grading: {
      kind: "not-computable",
      why: "Prospective fires are wake-time and session-scoped; the replay drives boundaries, not wakes. v1's own sample (33 events) is too small to re-derive PR-A…PR-F against in any case (§1.7).",
    },
  },
  {
    id: "prospective.referenceRate",
    section: "1.7",
    label: "Referenced uses over fires",
    v1: "40.0% (6 of 15)",
    unit: "rate",
    grading: {
      kind: "not-computable",
      why: "Same reason as the fire rate: no wake/turn loop in a fallback replay.",
    },
  },
  {
    id: "prospective.gateTable",
    section: "3.1",
    label: "PR-A…PR-F prospective gate table",
    v1: "PR-A out-of-window fire = 0 (hard); PR-B fire during refractory = 0 (hard); PR-C in-window noise ≤10%; PR-D re-fire after referenced use = 0 and non-vacuous; PR-E coverage ≥80%; PR-F mistimed/intrusive ≤5% over ≥20 fires, human-rated",
    unit: "rate",
    grading: {
      kind: "rater",
      bar: "PR-F is human-rated over a sample of ≥20 fires; PR-A…PR-E are machine-scored but need a prospective fixture (26 occasions / 20 sessions / 81 turns in v1), not the raw-span corpus. The independent-scorer rule applies hardest here: v1's scorer implemented its own window arithmetic.",
    },
  },

  // ── §1.8 episodes ───────────────────────────────────────────────────────
  {
    id: "episode.ingestedPerActiveDay",
    section: "1.8",
    label: "Episodes ingested per active day",
    v1: "214 ingested (8.2/day)",
    unit: "per-day",
    grading: { kind: "not-computable", why: NO_EPISODE_INPUT() },
  },
  {
    id: "episode.regrowRate",
    section: "1.8",
    label: "Regrow rate over ingested",
    v1: "92 regrown / 214 ingested = 43.0%",
    unit: "rate",
    grading: { kind: "not-computable", why: NO_EPISODE_INPUT() },
  },
  {
    id: "episode.meanSalience",
    section: "1.8",
    label: "Mean episode salience at ingest",
    v1: "0.611",
    unit: "mean",
    grading: { kind: "not-computable", why: NO_EPISODE_INPUT() },
  },
  {
    id: "episode.hasEmotionRate",
    section: "1.8",
    label: "Episodes carrying an emotion at ingest",
    v1: "86.0%",
    unit: "rate",
    grading: { kind: "not-computable", why: NO_EPISODE_INPUT() },
  },

  // ── §1.9 wake / briefing render ─────────────────────────────────────────
  {
    id: "briefing.overBudgetRate",
    section: "1.9",
    label: "Boundary briefings exceeding the ceiling the host reported",
    v1: "wake renders 8,384–12,308 bytes against a 9K sentinel budget; the 12,308 max is the first, pre-sentinel render",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0, hi: 0 },
      note: "A HARD one: the ceiling is the host's, and scar §2.18 is a renderer that invents one. v1's own overshoot is why the sentinel exists.",
    },
    compute: (o) => {
      const rendered = o.cycles.filter(
        (c) => c.briefingBytes !== null && c.budgetBytes !== null,
      );
      return rate(
        rendered.filter((c) => (c.briefingBytes ?? 0) > (c.budgetBytes ?? 0)).length,
        rendered.length,
      );
    },
  },
  {
    id: "briefing.budgetUtilization",
    section: "1.9",
    label: "Mean briefing bytes as a share of the reported ceiling",
    v1: "mean 9,125 rendered / 9K budget ≈ 1.01; delivered mean 8,994",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0.3, hi: 1.05 },
      note: "A replay store holds far less life than v1's month, so a low utilization here is a corpus fact before it is a defect — read it beside the store census.",
    },
    compute: (o) => {
      const rendered = o.cycles.filter(
        (c) => c.briefingBytes !== null && c.budgetBytes !== null && (c.budgetBytes ?? 0) > 0,
      );
      return mean(
        sum(rendered, (c) => (c.briefingBytes ?? 0) / (c.budgetBytes ?? 1)),
        rendered.length,
      );
    },
  },
  {
    id: "wake.deliveredBytes",
    section: "1.9",
    label: "Bytes actually injected at wake",
    v1: "15 deliveries, mean 8,994 bytes — close to the render mean, so delivery is not truncating further",
    unit: "bytes",
    grading: {
      kind: "not-computable",
      why: "Delivery is host-side and session-scoped (the sentinel is checked against what the host actually injected). The replay drives no wake injection; `noteWakeDelivered` is the adapter's seam.",
    },
  },

  // ── §1.10 runner durations ──────────────────────────────────────────────
  {
    id: "runner.duration",
    section: "1.10",
    label: "Boundary run wall-clock duration",
    v1: "mean 20.9s · median 17.0s · p90 38.6s · max 166.1s (788 paired start/done)",
    unit: "mean",
    grading: {
      kind: "not-comparable",
      why: "v1 infrastructure timing on a live model seat. In replay the wall clock measures the INJECTED interpreter — a deterministic fake in tests — not the system under test. Recording it would be a number that looks like a comparison and is not one.",
    },
  },

  // ── §1.11 other mechanisms ──────────────────────────────────────────────
  {
    id: "thread.matchRate",
    section: "1.11",
    label: "Thread/loop-claim match rate",
    v1: "52 matched / 56 missed = 48.2%; mean score 0.905, method uniformly `margin`",
    unit: "rate",
    grading: {
      kind: "not-computable",
      why: "v1's loop-claim matching maps to v2 `schemas/` belief placement, which no raw-span replay path drives. §17.3 also grades loop-claim matching as EXACT-match with pinned vectors, not distributionally — it belongs in a fixture suite, not this scorecard.",
    },
  },
  {
    id: "embed.pinnedGeneration",
    section: "1.11",
    label: "The run names exactly one vector generation",
    v1: "`voyage-3-large` in every logged refresh; the cache also holds 9,600 legacy `voyage-3.5` rows",
    unit: "flag",
    grading: {
      kind: "range",
      range: { lo: 1, hi: 1 },
      note: "CONTRACT §5 guarantee 7 and §4: two generations coexist in v1's cache, so 'reuse the cached vectors' is undefined until one is named. `none` is a legitimate answer, and it is still an answer.",
    },
    compute: (o) => ({ value: o.vectors.trim().length > 0 ? 1 : 0 }),
  },
  {
    id: "backup.snapshotsPerActiveDay",
    section: "1.11",
    label: "Backup snapshots per active day",
    v1: "26 snapshots over 26 log-days — one a day",
    unit: "per-day",
    grading: {
      kind: "not-computable",
      why: "Backups belong to the owner's adapter, not the core, and the replay store is a temp bench that is deliberately never backed up.",
    },
  },
  {
    id: "hygiene.applyRate",
    section: "1.11",
    label: "Hygiene proposals applied",
    v1: "2 runs, 18/18 and 10/10 applied (100% both times)",
    unit: "rate",
    grading: {
      kind: "not-comparable",
      why: "v1's hygiene was an owner-reviewed batch operation. v2 folds the same work into the sleep cycle's dedup/prune phases, which have no v1 rate to match — v1 never pruned at all (physics NOTES: PHI_PRUNE has no inherited measurement).",
    },
  },
  {
    id: "selfindex.refreshPerActiveDay",
    section: "1.11",
    label: "Self-index refresh / recompression",
    v1: "169 refreshes; 3 recompression events (one episode, trigger `over-budget`, 11,958 vs 5,760 bytes)",
    unit: "per-day",
    grading: {
      kind: "not-comparable",
      why: "v1's self-index is a curated document refreshed on its own cycle; v2's briefing is rendered at the boundary and trims to the host's ceiling (SEAMS G). The v1 recompression event has no v2 counterpart to count.",
    },
  },
  {
    id: "revision.supersedesPerActiveDay",
    section: "1.11",
    label: "Revisions that superseded a memory, per active day",
    v1: "accommodate.invited/fired 1/1 in the window; belief.minted 3 — near-zero by design",
    unit: "per-day",
    grading: {
      kind: "range",
      range: { lo: 0, hi: 2 },
      note: "§17.3: revision fire rate is near-zero by design, so this is a LONG-window comparison. A high number here is the interesting failure, not a low one.",
    },
    compute: (o) => mean(o.store.superseded, o.activeDays),
  },
  // ── watch-only: salience self-claim (review finding F5) ─────────────────
  {
    id: "salience.liftRate",
    section: "1.11",
    label: "Mint proposals whose salience claim lifted the computed value",
    v1: "no v1 counterpart — first blind run (2026-08-26, run_6b037641d8aa): 1656/1691 mints lifted (97.9%), mean +0.150, mode 0.8 (review finding F5: 'salience is self-assigned and shaped the whole store... No metric watches lift rate or claimed-vs-computed divergence')",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0, hi: 1 },
      note: "watch-only — bars proposed after the re-run's profile. Read off `mint.proposal`'s own `lifted` flag rather than counting `salience.lifted` events directly: that event has a SECOND emit site (`schemas/index.ts` entity placement, carrying no proposal id) that would drift the numerator off the mint-proposal denominator if counted straight.",
    },
    compute: (o) => {
      const proposals = eventsNamed(o, "mint.proposal");
      const lifted = proposals.filter((e) => e.data.lifted === true).length;
      return rate(lifted, proposals.length);
    },
  },
  {
    id: "salience.meanLift",
    section: "1.11",
    label: "Mean lift size (applied − computed) over `salience.lifted` seam events",
    v1: "no v1 counterpart — first blind run: mean +0.150, mode 0.8 (review finding F5)",
    unit: "mean",
    grading: {
      kind: "range",
      range: { lo: -1, hi: 1 },
      note: "watch-only — bars proposed after the re-run's profile. Computed over the SEAM event, not the mint proposal: once a sweep-ceiling extension lands, `salience.lifted` also fires on capped-without-lift, where applied−computed can read near zero and dilute the mean — a widening gap against F5's +0.150 first-run baseline is itself a reading, not noise.",
    },
    compute: (o) => {
      const events = eventsNamed(o, "salience.lifted");
      let total = 0;
      let count = 0;
      for (const e of events) {
        const applied = numField(e, "applied");
        const computed = numField(e, "computed");
        if (applied === null || computed === null) continue;
        total += applied - computed;
        count += 1;
      }
      return mean(total, count);
    },
  },
  {
    id: "salience.capRate",
    section: "1.11",
    label: "Share of `salience.lifted` seam events whose raw claim was capped",
    v1: "no v1 counterpart, and `capped` is absent from `salience.lifted` today — absent until a sweep-ceiling PR lands; this reads not-exercised until then, by construction rather than by guess.",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0, hi: 1 },
      note: "watch-only — bars proposed after the re-run's profile. Defensive by construction (scar §2.4's zero-vs-never-asked): `capped` is a field the event may not yet carry, so this renders not-exercised (no-denominator) rather than a guessed zero when no event in the run has it, and counts only over events that do.",
    },
    compute: (o) => {
      const events = eventsNamed(o, "salience.lifted");
      const withField = events.filter((e) => "capped" in e.data);
      if (withField.length === 0) return null;
      const capped = withField.filter((e) => e.data.capped === true).length;
      return rate(capped, withField.length);
    },
  },
  // ── watch-only: schema-birth refusal (review finding 5) ──────────────────
  {
    id: "schema.birthRefusalShare",
    section: "1.11",
    label: "Schema-birth mentions refused, over all birth attempts (born + refused)",
    v1: "no v1 counterpart — first blind run: 3 births vs 279 refusals = 98.9% refused (review finding 5: 'No scorecard metric covers birth at all')",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0, hi: 1 },
      note: "watch-only — bars proposed after the re-run's profile.",
    },
    compute: (o) => {
      const born = eventsNamed(o, "schema.birth").length;
      const refused = eventsNamed(o, "schema.birth.refused").length;
      return rate(refused, born + refused);
    },
  },
  {
    id: "schema.birthRefusalMix",
    section: "1.11",
    label: "The `name-not-in-source` share of all schema-birth refusals — the dominant reason the first run found",
    v1: "no v1 counterpart — first blind run: name-not-in-source 267/279 (95.7%), birth-cap 11, collision-near 1 (review finding 5)",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0, hi: 1 },
      note: "watch-only — bars proposed after the re-run's profile. Mirrors `gate.refusalMix`'s pattern: names the ONE reason the first run found dominant instead of re-deriving a mode per run, so a shift away from `name-not-in-source` shows up as a falling share rather than as silence.",
    },
    compute: (o) => {
      const refused = eventsNamed(o, "schema.birth.refused");
      const named = refused.filter((e) => e.data.reason === "name-not-in-source").length;
      return rate(named, refused.length);
    },
  },
  {
    id: "buffer.restoreRate",
    section: "1.11",
    label: "Spans restored to the buffer rather than consumed",
    v1: "11 restores (6 partial, 5 full) against 782 archives ≈ 1.4%",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0, hi: 0.1 },
      note: "Scar E6: an outage must never mean 'nothing durable'. Restores are the mechanism working; a high rate means the interpreter is failing.",
    },
    compute: (o) => {
      const swept = sum(o.sweeps, (s) => s.spansSwept);
      const restored = sum(o.sweeps, (s) => s.spansRestored);
      return rate(restored, swept + restored);
    },
  },
  {
    id: "system.errorRate",
    section: "1.11",
    label: "Cycle phases that failed",
    v1: "7 `system.error` events in the window (5 interpreter parse, 1 hebbian 'database is locked', 1 exhausted retries)",
    unit: "rate",
    grading: {
      kind: "range",
      range: { lo: 0, hi: 0.03 },
      note: "Degrade, don't abort: a failed phase is reported and the cycle continues, so this is a rate over phases rather than a count of dead runs. SCOPE (review F3): the numerator is CYCLE phases only — interpreter failures are chunk outcomes and structurally cannot appear here (v1's 7 `system.error`s were 5/7 interpreter parse). Read `interpret.chunkFailureRate` beside this line; a 0 here with a nonzero there is one system failing in the other's blind spot.",
    },
    compute: (o) => {
      const phases = sum(o.cycles, (c) => c.phasesRan + c.phasesFailed);
      return rate(sum(o.cycles, (c) => c.phasesFailed), phases);
    },
  },
  {
    id: "observer.standdownCount",
    section: "1.11",
    label: "Observer stand-downs in the replay store",
    v1: "9 `observer.skip` events (`boundary.encode`) — observer mode correctly skipping the encode path",
    unit: "count",
    grading: {
      kind: "range",
      range: { lo: 0, hi: 0 },
      note: "Inverted on purpose: the replay store is the instrument's own bench and is NOT an observer (an observer brain sweeps nothing). A stand-down here means the driver silently replayed nothing. The read-only guarantee lives on the corpus reader, which has no write path at all.",
    },
    compute: (o) => ({
      value: o.events.filter((e) => e.name.includes("observer")).length,
    }),
  },
  {
    id: "session.boundaryCoverage",
    section: "1.11",
    label: "Sessions that reached a session-ending boundary",
    v1: "15 `session.start` / 14 `session.end` — one session ended without a recorded end",
    unit: "rate",
    grading: {
      kind: "not-computable",
      why: "TAUTOLOGICAL IN THIS HARNESS (review F3): the driver increments `boundaries` and `sessions` from the same loop, so the ratio is 1.0 by construction and cannot reproduce v1's own finding (a session end that never fired). Spec §2 G5 is real, but grading it needs a host that can drop a boundary — the parallel run — not a driver that manufactures one per bucket. A vacuous PASS reads healthier than an honest absence (scar §2.4), so this renders as not-exercised until the surface can actually move.",
    },
  },
];

// ---------------------------------------------------------------------------
// Shared reasons — written once so two metrics cannot drift apart
// ---------------------------------------------------------------------------

function NO_TURN_LOOP(): string {
  return "The replay driver feeds the crash-fallback path (capture → boundary → sessionEnd); it runs no turn loop, so no recall decision, credit, or reinforcement is exercised. Grading these needs paired turn-sequence fixtures (v1 committed 11 of them), not raw spans — and guarantee 6 forbids synthesizing the per-session state a production turn path never carries.";
}

function NO_EPISODE_INPUT(): string {
  return "Episodes are v1 OUTPUT, not replay input (§17.1): the raw-span archive holds spans, not episode asks or chapter appends. In v2 the experiencer writes episodes at session end, which is the path CONTRACT §7 OQ2 names as having no v1 counterpart to replay — it can only be measured forward, in the parallel run.";
}

export function metricById(id: string): MetricSpec | undefined {
  return METRICS.find((m) => m.id === id);
}

/** Sections of `replay-baselines.md` this registry claims to cover. */
export function claimedSections(): string[] {
  return [...new Set(METRICS.map((m) => m.section))].sort();
}

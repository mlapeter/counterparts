# Replay baselines — v1's log window, captured before it rolls off

*Captured 2026-08-25, per §17.5 of `behavioral-spec.md` ("three things to capture before
v1 goes quiet"), item 1 (distributional baselines) and item 2 (replay input inventory).
Item 3 (pre-committed criteria) closes the set. Source for §1: `~/.bansai/logs/events-*.jsonl`,
read-only, content-by-reference only — no memory body text, no trace content, ids/hashes/
counts only, per the standing log discipline (`CLAUDE.md` "Logs are content-by-reference").
Source for §2: directory/row counts under `~/.bansai`, read-only, nothing copied or moved.
Source for §3: file names and doc titles under `docs/` and `eval/` in the repo, plus
`~/.bansai/eval/` file names only.*

**A companion document, `log-audit.md`, already inventories per-event-type fire counts
against the declared `EVENT_TYPES` vocabulary (which mechanisms fired at all, which never
fired). This document does not repeat that table — it computes rates, denominators, and
distributions over the events that did fire, which is what §17.3's "distributional
comparison" needs a future v2 run to be checked against.**

---

## 0. The window

- **First event:** `2026-07-27T15:24:55.676Z`
- **Last event:** `2026-08-25T17:52:35.978Z`
- **26 log files** (`events-YYYY-MM-DD.jsonl`), one per day with activity, spanning a
  30-calendar-day range (2026-07-27 through 2026-08-25 inclusive).
- **4 calendar dates have no log file** (no activity that day): 2026-07-28, 2026-08-02,
  2026-08-16, 2026-08-20.
- **Total events parsed: 65,075**, all valid JSON, one object per line.
- **Active-day counter** (`runner.start.activeDay`, the lived-day clock, not calendar
  days — scar #8): 26 distinct values, 154 through 179 — one per log-file day, confirming
  the clock advances once per day actually lived and not on the missing calendar dates.
- This is the **entire retained window** — logs are 30-day bounded retention
  (`pruneLogs`), so every rate below is a wasting asset; the window will have rolled
  forward by the time this doc is read again.
- **The logs are live and growing during extraction.** `events-2026-08-25.jsonl` is
  today's file and gained events between successive queries while this document was
  being assembled (65,075 → 65,102 total across two passes). Every count and rate below
  is from one single-pass extraction; treat todays's date as a moving edge, not a fixed
  boundary.
- **Daily rate below means `count / 26 active days`** unless stated otherwise (26 is the
  count of log-files-with-activity, which equals the count of distinct
  `runner.start.activeDay` values seen — the two agree, confirming one active day per
  log-day in this window).

---

## 1. Distributional baselines

### 1.1 Gate pass/block (`encode.gated` vs `buffer.claim`)

| | count | per active day |
|---|---:|---:|
| `buffer.claim` events (accepted claims) | 782 | 30.1/day |
| — total spans claimed | 852 | — |
| — total bytes claimed | 7,786,630 | — |
| `encode.gated` events (blocked) | 737 | 28.4/day |

**`encode.gated` by gate:** secrets 485, alias 222, precision 30.
**`encode.gated` by where:** episode 483, trace 246, op 7, alias-secret 1.

Approximate block rate (gated events / (gated events + claimed spans)): **46.4%** — this
mixes an event-count numerator with a span-count denominator (gate events aren't always
1:1 with spans), so treat it as an order-of-magnitude figure, not an exact rate. The
dominant gate by far is **secrets** (66% of all gate fires), and the dominant surface is
**episode text** (66% of fires) — the episode-ingest path is the most heavily gated
surface in the system.

### 1.2 Interpretation outcomes (`interpret.done` and siblings)

- `interpret.done` count: **780** (30.0/day)
- Mean spans/chunk: 1.09; mean traces/chunk: 1.85; mean ops/chunk: 0.46
- Mean `chunkBytes`: 9,221 (median 4,099 — right-skewed, a handful of very large chunks)
- Chunks yielding **zero traces**: 128 (16.4%)
- `interpret.noSchemas`: 22 · `interpret.rejected`: 1 · `interpret.parseRetry`: 5
  (parse-retry rate over `interpret.done`: 0.64%)
- `system.error` at `interpret.chunk` (JSON parse failures that exhausted retries): 5 of
  the window's 7 total `system.error` events — the interpreter's least reliable stage,
  consistent with the harvest's ingestion-nondeterminism finding (§17.3).
- **Model + prompt size** (fields only present from 2026-08-19 onward — 85 of 780
  events carry them): model is uniformly `claude-opus-5`; mean `promptBytes` 75,218,
  max 165,155.
- **Capture coverage** (`run.captureCoverage`, added 2026-08-26 after review F2): no
  v1 number — a harness-validity floor, not a baseline. Every corpus span offered
  must return as a captured span, a counted dedup, or a counted exclusion; the bar
  is exactly 1.0. The first real run silently dropped 13.2% of the corpus at the
  capture seam and no metric said so.

**Op outcomes** (`op.applied` / `op.rejected` / `op.deferred`):

| outcome | count | rate | per active day |
|---|---:|---:|---:|
| applied | 7,592 | 99.32% | 292.0/day |
| rejected | 40 | 0.52% | 1.5/day |
| deferred | 12 | 0.16% | 0.5/day |

Applied-op top kinds: `selfIndex.add` 4,823, `trace.add` 1,656, `trace.handle.add` 428,
`currentState.update` 215, `trace.emotion.set` 184, `trace.archive` 92, `belief.add` 57,
`thread.resolve` 53, `thread.add` 34, `gist.merge` 28.

Rejected-op reasons (top): "core-edit requires accommodation (crossed ledger)" ×10 (the
guardrail scar-list item 6.2 covers — this is it firing live), "no schema
sch_placeholder" ×3, "no schema sch_hearddd_v2" ×3, six distinct "no thread el_…" misses
×1-2 each. Deferred-op reason is uniformly "no Phase-1 primitive; deferred" ×12.

### 1.3 Preselection stats

- `interpret.done` events carrying a `schemasShown` field: **129 of 780** (the field was
  added partway through the window — treat pre-field events as "not instrumented," not
  "zero shown").
- **Blind rate** (`schemasShown == 0`, among instrumented events): **22 / 129 = 17.05%**
  over the full window the field was live for. Checked against CLAUDE.md's standing 22%
  by narrowing to the 2026-08-19→08-24 sub-window (the data behind the 08-25 graduation
  call): **21 / 85 = 24.71%** — closer to 22% but still not an exact reproduction. The
  per-date breakdown explains why neither figure is stable: 2026-08-19 blind rate 4.4%
  (2/45), 08-21 77.8% (7/9), 08-22 16.7% (1/6), 08-23 0% (0/4), 08-24 52.4% (11/21),
  08-25 2.3% (1/44) — **daily N is small (4-45 instrumented events/day) and the rate
  swings an order of magnitude day to day.** The 22% figure is a real, defensible read
  of a genuinely noisy metric, not a different measurement methodology; v2 should not
  treat any single blind-rate percentage as a precise target, only as "roughly a fifth
  to a quarter, on a metric that needs weeks of data to stabilize" (echoing CLAUDE.md's
  own caution: "denominator was 1-2 sessions... give it weeks"). Mean `schemasShown`
  over instrumented events: 1.95.
- **Blind chunks that still produced output** (traces>0 or ops>0 despite zero schemas
  shown): **8 of 22** — corroborates the "blind chunks mint real traces" finding that
  graduated option (b) preselection to the fix queue (CLAUDE.md).
- `schemaChannels` field (newest addition — appears only on **2026-08-25**, 13 events):
  channel distribution `both` ×16, `semantic` ×10 (a chunk can show multiple schemas via
  different channels). Too small a sample (one day) to trend; flag for v2 as a field
  worth carrying forward from day one rather than backfilling later.

### 1.4 Recall / surfacing (`surface.decision`)

- Count: **88** over 13 distinct days (3.4/active-day averaged over all 26 active days;
  6.8/day averaged over only the 13 days it actually fired — this event is
  session-scoped, so it's silent on days with no interactive session, unlike the
  background-runner event types above).
- Phase breakdown: `inject` 50, `hebbian.flush` 38.
- Mean `surfaced` items per decision: 1.07; mean `footnotes`: 2.81.
- Turns with **zero surfaced**: 40 / 88 (45.5%).
- `affect` flag rate: 7.95% · `highAffect` flag rate: 2.27%.
- `observer: true` (observer-mode decisions, which must strengthen/deposit nothing per
  scar #7): 4 of 88.

### 1.5 Reinforcement + gradient distributions

- `gradient.move`: 896 events. Reasons: `self-index-refresh` 619 (69%), `confirm` 203
  (23%), `nuance` 74 (8%).
- `gradient.cross` (band transitions): 345 events, 9 distinct days (first seen
  2026-08-15 — the entity-schema/belief-migration batch that unblocked crossings, per
  CLAUDE.md). Reasons: `decay` 289 (84%), `reinforce` 56 (16%). Transitions:
  semantic→episodic 268 (decay demotions dominate), episodic→semantic 34,
  consolidating→semantic 21, semantic→consolidating 11, episodic→consolidating 11.
- `reinforce.miss`: 190 events. Reasons: `confirm` 126 (66.3%), `nuance` 64 (33.7%) —
  these two tally to 190/190, a clean partition. Causes (also a clean partition of the
  same 190): `no-eligible-occasion` 116 (61.1%), `no-grounding-trace` 50 (26.3%),
  `element-not-live` 24 (12.6%).

### 1.6 Decay

- `decay.tick`: 26 events (one per active day, as expected from the daily consolidation
  cycle). Mean nodes decayed per tick: **1,718** (min 799, max 3,046). Mean
  `skippedIdentity`: 15.7 · mean `skippedPinned`: 1.5 · mean `taskStateExpired`: 4.8.
- `decay.expire`: 15 events, all reason `task-state` (no other expire reason fired in
  the window).

### 1.7 Prospective memory

- `prospective.fire`: 15 (all `via: "wake"` — no other delivery channel fired this
  window) · `prospective.suppressed`: 18 (all reason `prior-session-high-affect`,
  concentrated on a single day, 2026-08-25) · `prospective.referenced`: 6.
- Fire rate over fire+suppressed: 45.5%; reference rate over fires: 40.0%.
- Sample is small (33 fire-or-suppress events total) — not enough to re-derive PR-A
  through PR-F against; see §3 for where those bars already live.

### 1.8 Episodes

- `episode.ingested`: 214 (8.2/active day) · `episode.regrown`: 92 (regrow rate over
  ingested: **43.0%**) · `episode.asked`: 122 · `episode.tail`: 107.
- Mean episode salience at ingest: 0.611 · `hasEmotion` rate at ingest: **86.0%**.

### 1.9 Wake render

- `wake.rendered`: 795 events (30.6/active day). Bytes: mean 9,125, median 8,889, min
  8,384, max 12,308.
  The max (12,308) matches the very first render in the window (2026-07-27) — sizes
  compress after that, consistent with the 9K sentinel/tripwire budget documented in
  memory (`wake-injection-truncated.md`).
- `wake.delivered` (the actually-injected subset, session-scoped): 15 events, mean bytes
  8,994 — close to `wake.rendered`'s steady-state mean, i.e. delivery isn't truncating
  much further than render already does.

### 1.10 Runner durations

Computed by pairing `runner.start`/`runner.done` on `(scope, cycle)` and diffing
timestamps (not a logged field itself) — **788 `runner.start`, and 788 of those pair
1:1 with a cycle-bearing `runner.done` (100% paired, not ~2x as a first pass over the
raw count suggested).**

- Mean: 20.9s · median: 17.0s · p90: 38.6s · max: 166.1s.

`runner.done` fires **1,592 times total**, not 788 — the extra 804 break down as: 742
events carrying `mode: "cli"` and no `cycle` field (confirmed at `src/consolidate/
runner.ts:475` vs `:189` — two distinct call sites; the `mode: "cli"` completions are a
separate, uncycled on-demand invocation path, not a second phase of the boundary run)
and 62 events with `skipped: "lock-contention"` (the runner backing off when another
process holds the lock — scar #5, lock discipline, observed firing live). **v2 should
log these three `runner.done` varieties under distinguishable sub-types** rather than
one flat event name, since a raw `runner.done` count conflates completion, lock-skip,
and on-demand CLI runs.

### 1.11 Other mechanisms worth a number

- `thread.matched`: 52 · `thread.matchMiss`: 56 → match rate **48.2%**; mean match
  `score` 0.905; method uniformly `margin`.
- `embed.refresh`: 787-788 events, model uniformly `voyage-3-large` in every logged
  refresh this window. Mean `embedded` (freshly embedded) per refresh: 2.41; mean
  `hashSkipped` (cache-hit, unchanged content): 12,279 — the cache is doing its job;
  fresh embedding calls are rare relative to corpus size. Latest refresh (2026-08-25)
  reports `candidates: 13,005`.
  Live-verified pipeline: 2026-08-04 threads-v1 regression run confirmed retrieval
  tier decisions were byte-identical across a code change, with drift traced entirely to
  refetched-embedding third-decimal noise (GATES.md 2026-08-08 entry) — the empirical
  basis for §17.3's "exact-match only with pinned vectors" rule.
- `backup.snapshot`: 26 (one per log-day, as expected).
- `hygiene.run`: 2 (2026-08-04: proposed 18/applied 18/rejected 0; 2026-08-14: proposed
  10/applied 10/rejected 0 — 100% apply rate both times logged).
- `selfindex.refresh`: 169 · `selfindex.recompress`: 3 events, all one episode on
  2026-08-22 (`start`→`archived`→`done`, trigger `over-budget`, renderBytes 11,958 vs
  budgetBytes 5,760 — the stale-8KB-vs-live-5,760-byte doc drift flagged in
  `behavioral-spec.md` Appendix A item 5, caught firing live here).
- `accommodate.invited` / `accommodate.fired`: 1 / 1 — the single 2026-08-24 acceptance
  (`led_82975ae8c1c043e8`, cumulativeScore 0.52) that is the flow-walk arc's final
  acceptance criterion, per CLAUDE.md.
- `belief.minted`: 3.
- `buffer.append` 105 / `buffer.archive` 782 / `buffer.restore` 11 (modes: partial 6,
  full 5) / `buffer.prune` 6.
- `system.error`: 7 total (5 `interpret.chunk` JSON-parse failures, 1
  `boundary.hebbian` "database is locked", 1 `interpret.chunk` "failed after 4
  attempts"). `observer.skip`: 9 (`boundary.encode` — observer mode correctly skipping
  the encode path, scar #7).
- `session.start`: 15 · `session.end`: 14 (reasons: `prompt_input_exit` 8, `other` 6).
- **Salience self-claim** (`salience.liftRate` / `salience.meanLift` / `salience.capRate`,
  added 2026-08-29 after review finding F5, WATCH-ONLY): no v1 number — the first
  blind replay (2026-08-26, run_6b037641d8aa) found `salience.lifted` on 1656 of
  1691 mints (97.9%), mean lift +0.150 (mode 0.8), with nothing watching lift
  rate or claimed-vs-computed divergence. `liftRate` reads `mint.proposal`'s own
  `lifted` flag (not a raw `salience.lifted` count, which has a second emit site
  in `schemas/` entity placement); `meanLift` and `capRate` read the seam event's
  `applied`/`computed`/`capped` fields directly. `capRate` is defensive by
  construction: `capped` is not on the event in the shipped build, so it renders
  not-exercised until a sweep-ceiling extension adds it, rather than guessing
  zero. All three are watch-only bands (0–1 / −1–1), not health claims — bars get
  proposed once the re-run has a profile to set them against.
- **Schema-birth refusal** (`schema.birthRefusalShare` / `schema.birthRefusalMix`,
  added 2026-08-29 after review finding 5, WATCH-ONLY): no v1 number — the same
  run found 3 births against 279 refusals (98.9% refused), 267 of them
  `name-not-in-source`, 11 `birth-cap`, 1 `collision-near`, with "no scorecard
  metric covers birth at all." `birthRefusalShare` is refused over (born +
  refused); `birthRefusalMix` mirrors `gate.refusalMix`'s pattern by naming the
  one dominant reason the first run found (`name-not-in-source`) rather than
  re-deriving a mode per run. Watch-only — bars proposed after the re-run's
  profile.

---

## 2. Replay input inventory

*In place under `~/.bansai` — nothing here was copied, moved, or read for content beyond
what's needed to count/size it. Paths and counts only.*

| corpus | path | count | size | date range |
|---|---|---:|---:|---|
| **Raw span archive** | `~/.bansai/buffer-archive/` | 782 files across 26 day-dirs | 9.3 MB | 2026-07-27 → 2026-08-25 (matches the log window exactly) |
| **Traces (interpreted memories)** | `~/.bansai/traces/` | 13,653 `.md` files across 36 scope dirs (`global` + 35 `project-*`) | 55 MB | not date-partitioned in the filesystem; ~13.5K matches the replay contract's stated corpus size (§17.1) |
| **Episodes** | `~/.bansai/episodes/` | 192 `.md` files | 1.4 MB | 2026-07-16 → 2026-08-25 (older than the log window — episode files themselves aren't log-bounded) |
| **Schemas** | `~/.bansai/schemas/` | 8 files (`self.md`, `craft.md`, two `person-*.md`, four `entity-*.md`) | — | live |
| **Live (unclaimed) buffer** | `~/.bansai/buffer/` | 262 files | 1.0 MB | current |
| **Archive (overwrite/tombstone target)** | `~/.bansai/archive/` | 89,008 files (`traces/` + `schemas/` subtrees) | — | includes `.meta.json` provenance sidecars per the no-silent-destruction design |
| **Backups** | `~/.bansai/backups/` | 16 daily snapshot dirs | 2.6 GB | 2026-08-10 → 2026-08-25 (bounded retention, older snapshots already pruned) |
| **`index.sqlite`** (the reconstructible cache, per "the DB is a cache" invariant) | `~/.bansai/index.sqlite` | 142.7 MB | — | live |

**`index.sqlite` table detail:**

- `nodes`: 13,661 rows. By kind: fact 7,649, skill 2,841, person 2,000, self 1,141,
  place 26, entity 4. Archived flag: 656 archived / 13,005 live.
- `embeddings`: **23,264 rows total**, keyed `(node_id, model)`. Two models present:
  `voyage-3-large` 13,664 rows (current — matches `config.ts:662`'s configured embedder
  and every `embed.refresh` log event this window) and `voyage-3.5` 9,600 rows (a
  legacy/prior-model cache, still resident since the primary key is per-model — **v2
  replay should decide explicitly whether stale non-current-model vectors are a fixture
  to carry forward or dead weight to drop**; they were not observed driving any
  `embed.refresh` event in this window).
- `ledger` (accommodation ledger): 7 rows.
- `self_index`: 43 rows.
- `edges` (Hebbian graph, flushed from the in-memory buffer at Stop per scar #1's
  exemption): 426 rows. `hebbian_buffer`: 0 rows (expected — it's drained on flush).
- `aliases`: 24,732 rows.
- `meta`: `schema_version` 3, `migration_epoch_day` 20500.

**Raw-span retention status** (`~/.bansai/config.json`, this instance):
```json
{ "toggles": { "subconscious": true },
  "retention": { "keepRawSpans": true, "rawSpanRetentionDays": 30 } }
```
This is the **owner's bake-in instance opting in locally** (shipped default is
`keepRawSpans: false`, per `src/config.ts:725` and the privacy-review memo). The
30-day retention window on `buffer-archive/` is why its date range tracks the log
window almost exactly — both are on the same rolling 30-day clock, and both roll
forward together. **This is the wasting asset §17.5 item 2 calls out**: today is as
much raw-span history as will ever be available unless something is deliberately
snapshotted out of the rolling window before it prunes.

**Gaps that would block an input-for-input replay:**
- The raw-span archive only covers the log window (30 days back from today); nothing
  before 2026-07-27 exists as raw spans, only as their already-interpreted output
  (traces/episodes/schemas). Interpretation of anything before that date can only be
  distributionally compared (§17.3), never input-for-input replayed.
- The `voyage-3.5` embedding rows are a second, older vector generation coexisting with
  `voyage-3-large` in the same cache table — a replay that reuses "the cached vectors"
  per §17.5 item 2 needs to pick one model's rows explicitly, since both are present.
- No separate copy of the vector cache was exported here — this inventory records where
  it lives and its shape, per the read-only mandate; extracting a portable snapshot is a
  follow-up action, not something this pass performs.

---

## 3. Pre-committed criteria (v1's gates, for v2 to restate)

*File names and doc titles only, per the read-only mandate on `~/.bansai/eval/` content;
repo-tracked eval docs (`eval/replay/GATES.md` and siblings) are versioned engineering
documentation, not user memory, and are cited more fully since they *are* the criteria.*

### 3.1 The criteria ledger: `eval/replay/GATES.md`

This is the single file that carries essentially all of v1's pre-committed, machine-read
acceptance bars. Structure (full detail already in behavioral-spec.md §17.2 — this is
the pointer, not a re-derivation):

- **Hard trips** (A1 tender-into-unrelated salience≥0.75 sacred-tier via generic
  cue/recency = 0; A2 loud-tier off-topic intrusion ≤5%, human-rated; A3 confidentiality
  leak into a shared session = 0, not-exercised).
- **Retune bars** (B1 footnote flood >40% fails; B2 affect-flag noise >25% fails; B3
  name-smear fanout >50 fails).
- **Coverage floors** (C1 person-surfacing ≥60% on person-naming turns; C2 alias
  coverage ≥ owner-ratified scope).
- **Emotion cue gate**: fired-cue precision ≥0.80 against a reference judge (own
  sub-section, `eval/emotion/`, results in `eval/emotion/results/*.json` — file names
  `2026-07-16-scorecard.json`, `2026-07-23-scorecard.json`,
  `2026-07-23-holdout-scorecard.json` mark the baseline / earned / held-out runs).
- **Prospective memory gate** (PR-A through PR-F, cross-referenced in
  `docs/design-prospective-memory.md` §6): PR-A out-of-window fire = 0 hard trip; PR-B
  fire during refractory/suppressed = 0 hard trip; PR-C in-window noise ≤10%; PR-D
  re-fire after referenced use = 0 and non-vacuous; PR-E coverage ≥80%; PR-F
  mistimed/intrusive ≤5% human-rated, sample ≥20.
- **The un-gating mechanism**: `bansai on` parses GATES.md itself and refuses ambient
  injection until a passing `<!-- bansai-gates:run -->` record is appended — a
  machine-readable pass record a runtime switch actually reads, not just a document.
- **Recorded gate runs** (dated, each with a scorecard JSON under
  `eval/replay/results/<run-name>/gate-scorecard.json`): 2026-07-16 (migrated store),
  2026-07-16 fix-pack, 2026-07-23 emotion-cue enable, 2026-07-29 prospective, 2026-07-30
  PR-F rating pass, 2026-08-04 threads-v1 regression, 2026-08-08 ranker-fix regression.
  Result directory names: `embedding-ab-35/`, `embedding-ab-3large/`,
  `2026-07-16-fixpack/`, `2026-08-04-threads-v1-prospective/`,
  `2026-08-04-threads-v1-replay/`, `2026-07-29-prospective/`,
  `2026-08-08-ranker-fix-replay/`.

### 3.2 Design-doc-embedded bars (numeric thresholds cited outside GATES.md)

- `docs/design-threads-and-history-simplification.md` (and
  `docs/handoff-2026-07-30-threads-v1.md`): thread-claim matching — `score ≥ T_high`
  (~0.5 starting point) AND `margin ≥ M` (~0.15 starting point); ambiguity refuses.
- `docs/design-prospective-memory.md` §6: the pre-committed PR-A..PR-F gate table,
  written BEFORE the machinery landed — the source GATES.md's prospective section
  quotes.
- `docs/design-accommodation-residuals.md`: identity-belief formation salience
  reference point (~0.6) as a design discussion, not itself a pass/fail bar.
- `docs/flow-walk-advance-briefs-2026-08-08.md`: numerous inline numeric constants
  surfaced by the 19-agent code review (accommodation crossing = cumulativeScore ≥
  threshold × kind-inertia, person/self additionally needing ≥3 distinct lived days;
  identity gradient band ≥0.85; rule-2 minting salience ≥0.6; self-index warmth ≥0.8) —
  these are calibration constants the review catalogued, not independently gated
  criteria; flag for v2 as candidates to promote into named, versioned bars rather than
  scattered inline numbers.

### 3.3 Benchmark standing score (not a gate, but a pre-committed comparison point)

- `eval/longmemeval/results/`: file names `oracle-smoke-5.jsonl`,
  `oracle-stratified-12.jsonl`, `oracle-stratified-60.jsonl` (+ `-run4`/`-run5`/`-run6`
  reruns), each paired with a `.eval-results-gpt-4o` judged-output file. Per memory
  (`longmemeval-status.md`), the standing score is **75%** (run 6), measured on Sonnet
  as the maintainer seat — since superseded by an Opus sweep seat, so a same-seat re-run
  is needed before calling any v2 number a regression or an improvement (§17.3's
  "not comparable across model seats" rule applies directly here).

### 3.4 The test spine as a criteria source

- 86 `*.test.ts` files under `test/` in the current repo snapshot (companion doc
  `test-triage.md` already triages 52 behavior files / 14 mechanism files / 13 mixed —
  not re-derived here).
- `test/gates.test.ts` exists as a dedicated file — confirms the gate battery has direct
  test coverage distinct from the replay-harness gate runs above.

### 3.5 ~/.bansai/eval/ — file names only (this instance's own eval residue)

Listed for completeness; contents not read beyond what identifies each file's subject,
per the read-only mandate (several of these likely contain real-corpus excerpts, which
is exactly why only names are recorded here):

- `2026-07-30-thread-triage.md`, `2026-08-08-thread-triage-draft-new.md`,
  `2026-08-08-thread-triage-extended.md`, `2026-08-08-triage-export-pointers.md`
- `2026-08-18-contradiction-probe/` (`REPORT.md`, `scores.md`, `real-corpus.json`, `raw/`)
- `2026-08-19-sweep-bakeoff/` (`REPORT.md`, `raw/`)
- `compress-self-index-proposals.json`, `migrate-project-beliefs-proposals.json`,
  `migrate-self-currentstate-overrides.json`, `migrate-self-currentstate-proposals.json`
- `self-index-recompression/2026-08-22-2026-08-22T15-50-34-806Z.json`

These are this bake-in instance's own probe/migration artifacts (contradiction probe,
sweep bakeoff, recompression run) — evidence for decisions already recorded in
`docs/DECISIONS.md`, not additional gate definitions.

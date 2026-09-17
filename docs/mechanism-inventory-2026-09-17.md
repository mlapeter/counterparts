# Mechanism inventory — what has actually fired, 2026-09-17

Store: one read-only immutable snapshot of `~/.counterparts/store/operational.sqlite` taken
**2026-09-17 14:44:53** local (appendix Q0…Q20). Lived day 191; calendar 09-03 → 09-17. Code
read at `.claude/worktrees/step2-trial`. **The deployed tree is `f34f8c6`** — the newest
`adapter.checkout` rows say so, and master is 11 commits past it, so two silences below are
*not yet deployed* rather than broken.

## 1. In plain words

There are **40 mechanisms** here — eleven from the field guide, the rest the plumbing that
feeds them. **24 have been seen firing on the live store, 10 have never fired, and 6 cannot
be told either way** because nothing durable records them. (Every one of those 40 is named
with its state in the roll-call under the table, so the three numbers can be checked.)

Two surprises. **Learned association has produced nothing since the store was imported** —
430 edges, every one stamped with import day 184 — because the half that buffers a link and
the half that writes it run in two different processes. And **the gate battery has never
refused anything**: 1,181 proposals in, 1,181 accepted, refusal counters empty in all 232
rows. A gate that has never said no cannot be told from a gate that is never reached.

A third pattern runs through everything: **the system records what happened and almost never
records what was prevented.** Promotion, decay, prune, revision and every schema refusal
write a durable row when they *succeed* and only an in-process note when they *refuse*, so
"why didn't this memory promote" is unanswerable once the worker exits. That, not any single
bug, is what makes constitution line 11 hard to satisfy today.

The known one is now measured: **the authorship ask was refused 236 times and granted 30.**
The cap was changed from per-day to per-session today (`c87127b`) but is **not deployed** —
41 refusals on 09-17 still read `day-chapter-cap`.

Good news: doctor has 16 checks, and the dashboard already walks the whole event registry in
three places. The "what fired" view is closer than it looks.

## 2. The inventory

⟨B⟩ = one of the eleven brain mechanisms. **"dash:all"** = covered by the three totality
views that enumerate `DURABLE_EVENT_NAMES` (terminal `activity.ts:89`, web `views.ts:1260`
and `views.ts:1601`), so every *registered event name* is visible there by construction; a
surface named after a mechanism is a deeper, dedicated read.

| # | Mechanism | Module | Durable evidence | Ever fired (first→last) | 7d | Refuses / caps — durable? | Owner sees it |
|---|---|---|---|---|---|---|---|
| 1 | Capture of transcript spans | `remember/spans` | `events adapter.boundary` | 454 rows, 791 spans, 09-03→09-17 | 307 | `NOTHING_NEW` 20, `ALL_EXCLUDED` 2 — **durable, same row** | doctor:clock; dash:all; parallel daily |
| 2 | The authorship ask at Stop | `claude-code/hooks.ts` | `events adapter.ask` (hooks.ts:1129→790) | 315, 09-04→09-17: **capped 236, paced 49, asked 30** | 261 | `MAX_ASKS_PER_SESSION`=6 (`self/tunables.ts:129`, was a shared day cap, `episodes.ts:271`); `FIRST_ASK_TURNS/BYTES`=6/4000, `REASK_TURNS/BYTES`=8/8000 — **durable, `outcome`+`reason`** | doctor:authorship; dash:all; daily |
| 3 | Authored deposits (session_end, note) | `mcp/` → `encode/battery.ts:79` | `events gate.deposit` (counterpart.ts:2609) | 127 (115 session-end, 12 jot), 09-10→09-17 | 117 | secrets (not ablatable, `battery.ts:57`), `FLOOR_MIN_CHARS`=20/`MIN_WORDS`=3 (`encode/tunables.ts:21,24`), `STUB_TOKENS`, `TAU_DUP`=0.95 (`physics:136`) — **durable `blockedBy`; 0 refusals ever** | doctor:authorship; dash:all; **not** in daily |
| 4 | The journal chapter | `mcp/chapter` → `self/` | `versions.reason='episode-chapter'`; `meta self.episode.*` | 14 chapters, lived day 186→191 | yes | same cap as #2 — refusal durable only as #2's row | dash browse/memoryDetail |
| 5 | Crash-fallback sweep (the gate) | `remember/` | `events sweep.gate` (counterpart.ts:2083) | 324; swept 28 of 4,814 scope-looks, 09-04→09-17 | 285 | `NO_CRASHED_SESSION` 1498, `NOTHING_TO_SWEEP` 1318, `NOTHING_UNCLAIMED` 2; `CRASH_STALE_MS`=12h, `MIN_CLAIM_BYTES`=200 (`remember/tunables.ts:50,14`) — **durable `refusals` map** | doctor:sweep; dash:all; daily |
| 6 | Sweep woken as the self | `counterpart.ts:1993` | `events sweep.wake` | **NEVER** | 0 | — | dash:all (narrate.ts:358); **not** in daily |
| 7 | Gate battery refusals ⟨B: interference⟩ | `encode/battery.ts` | `refusalsByReason` on `gate.chunk`/`gate.deposit` | **NEVER refused** (1,181 proposals, 1,181 accepted) | 0 | it *is* the refusal channel | dash:all |
| 8 | Salience tagged at write ⟨B⟩ | `encode/` | `memories.novelty/relevance/emotional/predictive`; historical `salience.defaulted` | 16,601 rows carry it; `salience.defaulted` 20, 09-04 only | — | `AUTHORED_DEFAULT_CLAIM`=0.25, `SWEEP_CLAIM_CEILING`=0.6 (`physics:87,59`) — no refusal row | dash memoryDetail |
| 9 | Novelty / prediction error | `encode/` | `gate.chunk.novelty`, `noveltyReason` | 105 chunks, all `computed` | 67 | `SEMANTIC_FLOOR`=0.6, `SEMANTIC_CAP`=2 (`encode/tunables.ts:75,80`) — no refusal row | dash:all (inside gate.chunk) |
| 10 | Emotional modulation ⟨B⟩ | `encode/`, `recall/` | `gate.*.fires.emotion`; `recall.decision.affectFlag` | fires 40 / 37 chunks; **affectFlag true on 1 of 425 turns** | yes | `EMOTION_CLASSIFIER_ENABLED`=**false** until it clears `PRECISION_BAR`=0.8 (`encode/tunables.ts:96,98`); `AFFECT_MIN_EMOTION`=0.7 — **durable, `channels` says `off` in all 232 rows** | dash:all |
| 11 | Birth-by-mention ⟨B: standing picture⟩ | `schemas/` | `memories kind='entity'` + `source` | 445 entity rows (49 semantic) | yes | `MAX_BIRTHS_PER_CHUNK`=1, `NAME_MIN_CHARS`=2 (`schemas/tunables.ts:21,25`) — **refusals RING-ONLY** (`schemas/index.ts:263`) | dash browse |
| 12 | Schema assimilation / accommodation ⟨B⟩ | `schemas/` | `memories.source='accommodation'`; `versions.reason='replaced-by-declaration'` | 8 rows 09-11→09-17; 5 declarations | 8 | `NEAR_COLLISION`; refusals **RING-ONLY** (`schemas/index.ts:480,521,864`) | dash browse |
| 13 | Embedding / backfill | `bin/runner.ts`, `vectors.ts:278` | `events adapter.embed.backfill` | 322; 782 embedded, 5,440 chunk failures; newest row `remaining 0` | 285 | 64/boundary; `EMBED_BATCH_SIZE`=128; credential gate — **durable `failed`/`codes`/`remaining`** | doctor:backfill + doctor:vectors; dash:all; **not** in daily |
| 14 | Lagged semantic cue | `vectors.ts:124` | `events adapter.semantic.lag` | 322 (`ok` 321, `no-text` 1) | 285 | `no-text` — durable | dash:all; **not** in daily |
| 15 | Ambient recall — surfaced items | `recall/` | `recall.decision.surfacedCount` (counterpart.ts:1401) | **7 items across 425 turns** | yes, small | **`MAX_SURFACED`=1 per turn** (`recall/tunables.ts:294`), `SNR_GLOBAL`=1.6, `SNR_STRONG`=2.5, `FLOOR_STRONG_DEFAULT_UNITS`=4.5, `MIN_CUE_FRACTION`=0.5 — **durable: `all-gated` 86 turns**; an aborted turn (13) writes nothing | dash:all + views.ts:1400; daily |
| 16 | Ambient recall — footnotes | `recall/` | `recall.decision.footnoteCount` | 1,186 | yes | `MAX_FOOTNOTES`=6, `BUDGET_BYTES`=2048 — durable | same |
| 17 | Per-session gate state | `recall/session.ts` | table `gate_session` | 1,268 rows (surfaced 1193, scalar 28, semantic 27, credited 20), day 184→191 | yes | `MAX_SESSION_RECORDS`=200 — no refusal row | **nowhere** (no doctor, no dashboard, no daily) |
| 18 | Deliberate recall + expansion | `mcp/deliberate.ts` | **NONE in the store** — `sessions/expansions.jsonl` sidecar only | sidecar present (113 B, 09-17) | untellable | `RECALL_MAX_IDS`=3, `DELIBERATE_DIM_CAP`=5, `HARD_GATES` (deliberate.ts:74) — **RING-ONLY; zero `appendEvent` in `adapters/mcp/`** | nowhere |
| 19 | Credit for use ⟨B: retrieval strengthening⟩ | `recall/`, `physics/` | `events recall.credit` (hooks.ts:1047); `memories.uses` | 214 rows; **credited on only 9**, 20 memories; 141 rows have `uses>0` | 214 | `already-credited-today`, `birth-day`, `W_FOOTNOTED`=0 (`physics:689,112`), `CREDIT_BUDGET_MS`=150 — **durable `refused` map** | doctor:credit; dash:all; daily |
| 20 | Learned association edges ⟨B: temporal association⟩ | `associate/` | table `edges` (no event at all) | 430 rows, **all `last_day`=184 (import); none since** | **0** | `<2 eligible` (`associate/index.ts:188`), `EDGE_FLOOR`=0.02, `MAX_EDGES_PER_NODE`=32 — **RING-ONLY; zero `appendEvent` in `core/associate/`** | dash browse:270, flow node; not doctor, not daily |
| 21 | Spreading activation ⟨B⟩ | `associate/spread.ts` | **NONE** | untellable | — | `HOPS`=2, `MAX_SPREAD_NODES`=64 — ring | nowhere |
| 22 | The sleep cycle / worker run | `sleep/`, `bin/runner.ts` | `events sleep.cycle` (counterpart.ts:2160); `meta sleep.marker.*` | 211 rows 09-14→09-17, 0 failed phases — but **208 are `already-done-today` no-ops**; only 3 did work (one per lived day 189–191), and **`consolidate` ran exactly once** (09-16, lived day 190) | 211 rows / 3 real | `CONSOLIDATION_EVERY_DAYS`=3 (`sleep/tunables.ts:16`); per-phase `BUDGETS` — **durable `phases[].status`/`reason`, aggregate only** | doctor:sleep; dash:all; daily |
| 23 | Worker spawn refused / failed / runner failed | `hooks.ts:1307`, `runner.ts:299` | `adapter.spawn.refused`, `.failed`, `adapter.runner.failed` | **NEVER (all three)** | 0 | these *are* the rows; `ESCALATE_AFTER`=3 | doctor:spawn (reads **persisted counters kept outside `events`**, not these rows); dash:all; **not** in daily |
| 24 | Decay ⟨B⟩ | `physics/`, `sleep/decay.ts` | `band.transition` (down); `sleep.cycle.bandDown` | 213 semantic→episodic 09-03→09-17; bandDown 92 | 169 | `S_BASE`=60, `DECAY_QUANTUM`=1e-4 — **per-item RING-ONLY** (`decay.ts:229`) | dash status.ts:247; daily `sleep.symmetry` |
| 25 | Promotion between bands ⟨B: consolidation⟩ | `sleep/consolidate.ts:136` | `band.promoted`, `band.transition` (up), `sleep.cycle.promoted` | **1 ever** (semantic→identity, 09-03, import). episodic→semantic 5, first **09-16**. The one consolidate pass (09-16) promoted 0, bandUp 3, bandDown 41 | 5 up; 0 identity | `THETA_ID`=0.85, `N_PROMOTION_DAYS`=3 (`physics:43,46`) — **success durable, REFUSAL RING-ONLY**; **10 live semantic rows already satisfy N≥3** | dash views.ts:356 (`band.promoted` direct); **not** doctor, **not** daily |
| 26 | Dedup / interference merge ⟨B⟩ | `sleep/dedup` | `events memory.merged`; `sleep.cycle.phases[dedup]` | 8, **09-03 only** (import). The phase ran 3 times, **all `ran-nothing-found`** | **0** | `TAU_DUP`=0.95, needs vectors — **refusal ring-only** | dash:all; daily |
| 27 | Prune / archive at the floor ⟨B⟩ | `sleep/prune.ts:130` | `events memory.pruned`; `archived_reason='pruned'` | 5, 09-03→09-11. The phase ran 3 times since the rows existed, **all `ran-nothing-found`** | 1 | `PHI_PRUNE`=0.02 **and `D_FLOOR_DAYS`=90** (`physics:141,144`), plus protected/identity — **success durable, refusal ring-only** | dash:all; daily |
| 28 | Revision under pressure ⟨B: reconsolidation⟩ | `schemas/index.ts:768` | `events revision.pressure`; `versions.reason='revised-by-pressure'` | 4 pressure rows 09-15→09-17; **3 revisions** (day 188, 190) | 4 | one credited challenge/day, `F_DAY_CAP_SLOW`=0.35, `protected-refuses-revision` — **credit durable, REFUSAL RING-ONLY** (`schemas/index.ts:682`) | dash **stories** view (stories.ts:34); daily `self.schema.pressure` |
| 29 | Prospective memory — SET ⟨B⟩ | `prospective/` | table `prospective` | 14 rows, **all from `tools/migrate/apply.ts:190`** | 0 | `SALIENCE_FLOOR`=0.6, `LEAD_DAYS`=3 — **RING-ONLY, zero `appendEvent` in the module** | dash browse:281, flow node |
| 30 | Prospective memory — FIRED ⟨B⟩ | `prospective/` | `prospective.fires`, `last_fired_day` | fires 21 are **v1 counters**; `last_fired_day` **NULL on all 14** | 0 | `FIRES_PER_WINDOW`=2, `TEMPORAL_MAX_TIER`="footnoted" — ring-only | dash flow node |
| 31 | Temporal-association channel ⟨B⟩ | `core/retrieval.ts:78` | **NONE** — folded into `recall.decision` totals | untellable | — | `HORIZON_ITEMS`=2 — ring | nowhere |
| 32 | Wake composition (briefing) | `self/briefing.ts` | `events self.briefing` (counterpart.ts:2234) | 3 renders 09-15→09-17; 16 elements trimmed | 3 | budget 8,840 B (host-reported, no default); `IDENTITY_MAX`=24, `WARM_FLOOR`=0.35 — **durable `trimmed`/`counts`** | dash:all; daily |
| 33 | Wake injection | `claude-code/hooks.ts` | `events adapter.wake.injected` | 37, 09-03→09-17 | 23 | budget, observer, primacy standdown — durable `ok`/`reason` | dash:all; daily |
| 34 | Wake delivery check | `hooks.ts:599` | `events adapter.wake.delivered` | **NEVER** | 0 | needs `input.sentinelSeen` | dash:all; daily (watches a name with no rows) |
| 35 | Parallel-run primacy | `claude-code/hooks.ts` | `adapter.primacy.deliver` 200 / `.standdown` 9 | both **stop 09-04** | 0 | the A/B assignment — durable | dash:all; daily |
| 36 | Which checkout is live | `doctor.ts` | `events adapter.checkout` | 8, 09-15→09-17 (`master` 6, `dirty` 1, `behind` 1) | 8 | — | doctor:checkout (**live git, not this row**); dash:all; daily |
| 37 | Scope registry verdicts | `adapters/scopes.ts` | **NONE** — `SCOPE_REFUSED_EVENT` is documented ring-only (`scopes.ts:132`, emitted `hooks.ts:412`) | untellable | — | `off`/`paused`/`observer` decide **before the store opens** | nowhere |
| 38 | Confidentiality gating | `recall/gate.ts:319` | rides inside `recall.decision`; `gate.*.gates[].status` | `secrets` = `clear` in all 127 deposits, never `acted`; no `confidential-withheld` seen | 0 | it is the gate | dash:all (not broken out) |
| 39 | Deliberate protection | `physics/`, `store/` | `memories.protected` | 3 rows, **all `migrated`** | 0 | — | dash status.ts:122; daily (schemaBytes reader) |
| 40 | Owner removal / export | `store/owner-op-seam.ts` | `removal_record`, `removal_tombstone` | **0 rows in both** | 0 | CLI confirm gate | dash health views.ts:1627 |
| 41 | Unmerge repair | `owner-op-seam.ts:373` | `events memory.unmerged` | 3, 09-05 | 0 | `noop` latch — durable | dash:all |
| 42 | Backups | `cli/commands.ts:2659` | **NONE** — no row, no ring, no `~/.counterparts/backups/` | never run here | 0 | refuses to overwrite (`snapshot.ts:176`) | nowhere |
| — | Gist across many episodes ⟨B⟩ | — | **not built** (storage spec §5 marks it thin) | n/a | — | — | — |

**State roll-call** (the §5 vocabulary; this is where §1's counts come from). The canonical
set is rows 1–42 **plus** the gist row, **minus** 9 and 16 (pure sub-readings of 8 and 15)
and **minus** 36 (an observability aid, not a memory mechanism) = **40**.

- **firing** (24): 1, 2, 3, 4, 5, 8, 10*, 11, 12, 13, 14, 15, 17, 19, 22, 24, 25*, 26*, 27, 28, 32, 33, 35*, 41
- **never** (10): 6 (*not-deployed* — the honest sub-state), 7, 20, 29, 30, 34, 38, 39, 40, gist (*not built*)
- **blind** (6): 18, 21, 23, 31, 37, 42
- \* 10 is *disabled* (the gate fires, the classifier ships off); 25 and 26 are `quiet` at the
  top band (last fired 09-03, outside 7 days); 35 is `retired` by parallel-run phase.

## 3. The silent list — first diagnosis under line 11

**S1. `sweep.wake` (0) — NOT DEPLOYED, not broken.** `recordSweepWake` (`counterpart.ts:2396`)
is called unconditionally at `counterpart.ts:1993`, right after `recordSweepGate`, so it
would fire on all 324 sweeps. `git log -S SWEEP_WAKE_EVENT` returns one commit, `d9028ef`
2026-09-17 13:19; `git merge-base --is-ancestor d9028ef f34f8c6` = **NO**. **Check:** after
deploy + restart, `sweep.wake` must match `sweep.gate` one-for-one; if not, the
`this.observer` guard at `:2415` is the suspect.

**S2. `adapter.wake.delivered` (0 since 09-03) — WIRING FAULT, two of them.** The durable
writer (`hooks.ts:599`) sits behind `input.sentinelSeen !== undefined` (`hooks.ts:596`), and
`sentinelSeen` — declared `hooks.ts:123` — is **never set**: `toHookInput`
(`bin/hook.ts:320-346`), the only live constructor, builds `sessionId`, `scope`, `turns`,
`expansions`, `reFired`, `prompt`, `at` and nothing else; the name appears nowhere else in
`src/`/`tools/`. Second, the expectation it compares against lives in `this.expected`, an
in-process `Map` (`hooks.ts:473`, `:616`), and every hook is a fresh process — so even a
populated field meets `expected = null`. The one mechanism meant to answer "did the wake
arrive" has answered nothing all run. **Check:** read the sentinel in `toHookInput`, persist
the expectation in `store/sessions/<id>.json`.

**S3. Association edges (none since lived day 184) — WIRING FAULT, a process split.**
`coactivate()` buffers deltas in an in-process `DeltaBuffer` (`associate/index.ts:168`,
`:208`); `flush()` publishes them (`:240`). The only live caller of `coactivate` is
`creditReferences` (`counterpart.ts:1521`, `:1565`), invoked from **the hook process**
(`hooks.ts:1033`); the only live caller of `flush()` is `sessionEnd` (`counterpart.ts:1758`),
invoked from **the detached worker** (`bin/runner.ts:234`). The buffer dies at hook exit. The
`too-few-members` gate (`associate/index.ts:188`) is real but not the cause — 6 of 214 credit
rows credited two or more, and those six left no edge either. **Check:** `SELECT COUNT(*)
FROM edges WHERE last_day > 184` after flushing at the end of the credit pass.

**S4. Prospective set and fire (14 rows, all migrated) — NO PRODUCER.** `arm()` and `fire()`
have exactly two callers, both in `tools/demo/seed.ts` (`:580`, `:561`); `setProspective` is
called only inside `prospective/index.ts` and from `tools/migrate/apply.ts:190`; `derive()`
has no caller outside the module. The *read* half is wired — `core/retrieval.ts:78` calls
`arrivals()` every turn — so the temporal channel runs each turn over 14 frozen v1 rows whose
newest `event_date` is 2026-09-01 and can only look backwards. **Check:** one window derived
from an authored deposit, one fired end-to-end.

**S5. Promotion into identity (1 ever, import day) — N=3 IS NOT THE BINDING GATE; the second
gate is untested.** First, the denominator: 211 `sleep.cycle` rows are boundary runs, not
nights — 208 are `already-done-today` no-ops and **`consolidate` has run exactly once** since
the rows existed (09-16, lived day 190: promoted 0, bandUp 3, bandDown 41), because
`CONSOLIDATION_EVERY_DAYS`=3 (`sleep/tunables.ts:16`). Second, and against my own first
reading: **10 live semantic-band memories already satisfy `N_PROMOTION_DAYS`=3**
(`reinforced_days` 3–7; nine of them still `consolidated=0`), so the promotion path is not
starved of eligible rows. The remaining gate is `THETA_ID`=0.85 on *base* strength
(`physics/index.ts:43`); the highest `claimed` among those ten is 0.80, and claimed is capped
by channel (`SWEEP_CLAIM_CEILING`=0.6, `AUTHORED_DEFAULT_CLAIM`=0.25), so **the salience
ceiling, not the day count, is the likely blocker — inference, since base is computed by
physics and is not a column.** **Check:** run `promotionEligibility` over those ten ids in a
hermetic harness; the reason it returns settles it in one pass.

**S6. Dedup (8 rows, 09-03 only) — CONFIRMED EMPTY CANDIDATE SET.** The phase ran 3 times
since the rows existed and every one reports `status: ran-nothing-found`, so it is executing
and finding no pair at `TAU_DUP`=0.95. It needs vectors, and the backfill logged 5,440 chunk
failures against 782 embeddings (I33) before today's newest row reached `remaining: 0`.
**Check:** with `remaining` at 0, one more cycle should either merge or keep reporting
`ran-nothing-found` — but the row never says how many pairs it compared, so a real
zero and an empty scan still read alike.

**S7. Prune (5 ever, 1 in the last 7 days) — GENUINELY RARE.** `PHI_PRUNE`=0.02 **and
`D_FLOOR_DAYS`=90** (`physics/index.ts:141,144`): a memory must sit at the floor for 90 lived
days, on a store that has lived 191 with most rows imported at once. The phase has run 3
times since `sleep.cycle` rows existed, all `ran-nothing-found` — correct behaviour, not a
fault. (An earlier draft of this report claimed `sleep.cycle.pruned`=0 contradicted the 09-11
`memory.pruned` row; it does not — `sleep.cycle` rows only start 09-14, so the two never
overlap.) **Check:** none needed; watch that the count stays non-zero over a longer window.

**S8. The gate battery has never refused (0 in 232 rows) — UNVERIFIABLE.** All 127
`gate.deposit` rows carry an identical verdict array (secrets clear, precision clear, aliases
and emotion not-invoked, floor clear), `refusalsByReason` = `{}`; all 1,054 sweep proposals
accepted. The gates are not inert — `gate.chunk.fires` records `precision` 115, `emotion` 40,
`aliases` 5 — they act, they never turn anything away. **Check:** no hermetic test settles
this; only a probe deposit (a fake credential shape, a sub-floor fragment) separates a
calibrated gate from an unreached branch.

**S9. Emotional modulation ⟨B⟩ — DISABLED BY A NAMED DECISION.**
`EMOTION_CLASSIFIER_ENABLED`=false until it clears `PRECISION_BAR`=0.8
(`encode/tunables.ts:96,98`); all 232 gate rows say `emotion-classifier=off`, `affectFlag` is
true on 1 turn in 425. Amendment 15 working — but one of the eleven is a stub today.
**Check:** nothing to fix; the view must say *disabled*, not *silent*.

**S10–S13, briefly.** Primacy (200 / 9, both stop 09-04) is **retired by phase** — show it as
retired or the view cries wolf every morning. Protection (3 rows, all `migrated`) and owner
removal/export (0 rows) are **never exercised**; one `delete --dry-run` would leave a record
and prove the seam constitution line 6 leans on. Backups have **never run here** — no
`~/.counterparts/backups/`, and `backupCommand` (`cli/commands.ts:2659-2701`) writes nothing
anywhere, while I29/I38's "database is locked" lands on exactly the store-open it does first.
The three spawn/runner names never firing is the **healthy** reading and also unfalsifiable —
a dead writer looks identical; they belong in the blind list.

## 4. The blind list — no durable evidence exists

| Mechanism | Why blind | Smallest row that fixes it |
|---|---|---|
| Deliberate recall + expansion (#18) | `adapters/mcp/` contains zero `appendEvent`/`noteAdapterEvent`; only `sessions/expansions.jsonl` | one `mcp.recall` event: `{tool, results, expanded, refused, scope, date}` |
| Association edges (#20) | zero `appendEvent` in all of `core/associate/`; a flush that drops everything looks like a quiet day | one `associate.flush` event per boundary: `{buffered, pairs, rows, dropped, evicted, day}` |
| Spreading activation (#21) & temporal channel (#31) | folded into `recall.decision` with no breakdown | add `channelCounts:{lexical,semantic,temporal,schema,associative}` to the existing `recall.decision` — no new name |
| Prospective set + fire (#29, #30) | zero `appendEvent` in `core/prospective/`; `SuppressReason`/`FireReason` are ring-only | one `prospective.fire` event `{memoryId, windowKey, outcome, reason, day}` |
| Per-item refusals in promotion, decay, prune, revision (#24–#28) | success is durable (`consolidate.ts:136`, `prune.ts:130`, `schemas/index.ts:768`); the refusal is a bounded 500-item in-process ring | add `blockedBy:{reason:count}` to the existing `sleep.cycle` payload — aggregate, one row a night |
| Schema birth/alias/belief refusals (#11, #12) | ring-only (`schemas/index.ts:263,442,480,521`) | same `blockedBy` roll-up, on `gate.deposit` |
| Scope registry verdicts (#37) | ring-only **by design** — `off` is decided before the store opens, so no store row is possible at that instant | a counter file beside `scopes.json` (`{date:{on,observer,off,paused}}`), read by doctor — not an events row |
| Worker spawn health (#23) | three names that prove a *silence*; a dead writer is indistinguishable from a healthy run | one positive `adapter.spawn.started` per boundary |
| Deliberate protection (#39) | a boolean column with no history | reuse `versions` with `reason='protected'` |
| Backups (#42) | no channel at all | one `store.backup` event `{out, bytes, ok, code, date}` |
| Per-session gate state (#17) | `gate_session` is read by no surface — not doctor, not dashboard, not the daily | nothing new; render the existing table |

## 5. Proposed shape for the "what fired" view

Most of this exists. The web **health** view (`views.ts:1601-1612`) already walks
`DURABLE_EVENT_NAMES`, marks absent axes and draws a day×name heatmap. Make that the view;
give doctor the same rows.

```
mechanism | last fired | fired 7d | total | refused 7d (top reason) | state
```
`state` ∈ `firing` · `quiet` · `never` · `blind` · `retired` · `disabled` · `not-deployed`.
`not-deployed` compares the newest `adapter.checkout.head` against the commit that introduced
the name — without it, S1 reads as a bug; `disabled` keeps a named Amendment-15 stand-down
(the emotion classifier) from reading as a fault.

Three sections. **(a)** The 29 registry names straight from `DURABLE_EVENT_NAMES`, tolerating
unregistered names the store already holds (`date.repaired`, `salience.defaulted`,
`store.migrate.paths`). **(b)** Five table probes for the mechanisms with no event:
`edges(max last_day)`, `prospective(count, max last_fired_day)`, `memories(protected, source
last 7d)`, `removal_record(count)`, `versions(reason, max version_day)`. **(c)** One refusal
column, fed only by payload fields that exist today — `adapter.ask.outcome`,
`sweep.gate.refusals`, `gate.*.refusalsByReason`, `recall.credit.refused`,
`recall.decision.reason`.

NEW durable rows, six, in order: (1) `adapter.spawn.started`; (2) `associate.flush`; (3)
`mcp.recall`; (4) `blockedBy` + `promotionCandidates` + `dedupPairsCompared` on the
**existing** `sleep.cycle` payload; (5) `prospective.fire`; (6) `store.backup`. Plus the
scope-verdict counter file, which cannot be an events row.

Doctor gains one finding, `fired`: amber when a mechanism that fired in the previous 7 days
fired zero times in this one; red when one with a positive-evidence row goes silent 2 days
running — and it stops reading in-memory counters for `spawn`.

## 6. Method notes

- **The store is live and was being written as I read it** — counts drifted between passes
  (`sleep.cycle` 203 → 209). Every number here is from the one snapshot at 14:44:53 (Q0).
- **"Last 7 days" is wall-clock `at`, never lived day**: the lived clock advanced 7 days
  across 15 calendar ones (Q3), so a lived-day window would silently drop rows.
- **Deployed ≠ master.** Checkout rows say `f34f8c6`; master is 11 ahead. Two fixes merged
  today (`d9028ef` sweep-wake, `c87127b` per-session ask cap) are **not live**.
- **A row is only as old as its producer**: `sleep.cycle`/`self.briefing`/`recall.credit`/
  `adapter.checkout` since 09-14, the three spawn names since 09-11, `gate.deposit` since
  09-10. A first-fired date is the row's birthday, not the mechanism's.
- **Could not determine:** (a) whether the gate battery's refusal branches are reachable —
  nothing has ever been refused and I ran nothing (S8); (b) whether spreading activation
  contributed to any of the 7 surfaced items — no channel breakdown exists; (c) how many
  handle expansions occurred — I did not open `expansions.jsonl` (salted hashes); (d) the
  embedding cache's true state — restricted to `operational.sqlite`, so `remaining: 0` on the
  newest backfill row is my only evidence I33 cleared; (e) whether `THETA_ID`=0.85 is what
  blocks the ten N≥3 rows — base strength is computed by `physics/`, not stored, so S5's
  conclusion there is marked inference.
- **A `sleep.cycle` row is a boundary run, not a night.** 208 of 211 are `already-done-today`
  no-ops. Read `phases[].status`, never the row count. This corrected S5, S6 and S7.
- **Not read, by instruction:** memory bodies, titles, transcript text, credential values,
  `~/.bansai`, `~/.claude-engram`. `meta.self.briefing` holds rendered wake text — length only.

## Appendix — queries

All run as `sqlite3 -readonly "file:$HOME/.counterparts/store/operational.sqlite?immutable=1" "<sql>"`.

- **Q0** the snapshot script behind every §2 number; saved at `scratchpad/snapshot.txt`, each statement tagged `#EVENTS`, `#ASK`, `#DEPOSIT`, `#SLEEP`, …
- **Q1** `SELECT name,COUNT(*),MIN(date(at/1000,'unixepoch','localtime')),MAX(...),SUM(CASE WHEN at>=strftime('%s','now','-7 days')*1000 THEN 1 ELSE 0 END) FROM events GROUP BY name;`
- **Q2** `SELECT json_extract(payload,'$.outcome'),COUNT(*) FROM events WHERE name='adapter.ask' GROUP BY 1;` → capped 236 / paced 49 / asked 30
- **Q2b** same with `WHERE date(at/1000,'unixepoch','localtime')='2026-09-17'` grouped by `$.reason` → `day-chapter-cap` 41 (proves the new cap is not deployed)
- **Q3** `SELECT day,MIN(date(at/1000,'unixepoch','localtime')),MAX(...),COUNT(*) FROM events GROUP BY day;` → lived 184–191 over 09-03…09-17
- **Q4** `SELECT json_extract(payload,'$.source'),COUNT(*),SUM(json_extract(payload,'$.proposals')),SUM(...accepted),SUM(...refused) FROM events WHERE name='gate.deposit' GROUP BY 1;` → 127 / 127 / 127 / 0
- **Q5** same shape for `gate.chunk` → 105 rows / 1054 / 1054 / 0
- **Q6** `SELECT j.key,SUM(j.value) FROM events e,json_each(json_extract(e.payload,'$.refusalsByReason')) j WHERE e.name IN ('gate.chunk','gate.deposit') GROUP BY 1;` → **empty**
- **Q7** same over `'$.refusals'` for `sweep.gate` → NO_CRASHED_SESSION 1498, NOTHING_TO_SWEEP 1318, SWEPT 28, NOTHING_UNCLAIMED 2
- **Q8** `SELECT json_extract(payload,'$.from')||'->'||json_extract(payload,'$.to'),COUNT(*),MIN(date(...)),MAX(date(...)) FROM events WHERE name='band.transition' GROUP BY 1;`
- **Q9** `SELECT json_extract(payload,'$.reason'),COUNT(*),SUM(...promoted),SUM(...merged),SUM(...bandUp),SUM(...bandDown) FROM events WHERE name='sleep.cycle' GROUP BY 1;` → ran 211; promoted 0, merged 0, bandUp 5, bandDown 92
- **Q9b** `SELECT json_extract(j.value,'$.phase')||'='||json_extract(j.value,'$.status'),COUNT(*) FROM events e,json_each(json_extract(e.payload,'$.phases')) j WHERE e.name='sleep.cycle' GROUP BY 1;` → `consolidate=ran` **1** / `did-not-run` 210; `dedup=ran-nothing-found` 3; `prune=ran-nothing-found` 3; every phase `did-not-run` 208
- **Q9c** `SELECT reinforced_days,COUNT(*) FROM memories WHERE archived=0 AND band='semantic' GROUP BY 1;` → **10 rows at `reinforced_days`≥3** (3:3, 4:2, 6:3, 7:2) — the query that overturned "starved"
- **Q10** `SELECT COUNT(*),MIN(last_day),MAX(last_day) FROM edges;` → 430 / 184 / 184
- **Q11** `SELECT state,COUNT(*),SUM(fires),COUNT(last_fired_day) FROM prospective GROUP BY state;` → fired 4 (8, 0 dated), suppressed 10 (13, 0 dated)
- **Q12** `SELECT json_extract(payload,'$.reason'),COUNT(*),SUM(...surfacedCount),SUM(...footnoteCount) FROM events WHERE name='recall.decision' GROUP BY 1;` → rendered 339 (7 surfaced, 1186 footnotes); all-gated 86
- **Q13** `SELECT json_extract(payload,'$.reason'),COUNT(*),SUM(...credited) FROM events WHERE name='recall.credit' GROUP BY 1;` → credited 9 rows / 20 memories; nothing-to-credit 44; no-candidates 161
- **Q14** `SELECT json_extract(j.value,'$.channel')||'='||json_extract(j.value,'$.state'),COUNT(*) FROM events e,json_each(json_extract(e.payload,'$.channels')) j WHERE e.name IN ('gate.chunk','gate.deposit') GROUP BY 1;` → emotion-classifier=off 232; semantic-preselection=ran 105
- **Q15** `SELECT source,COUNT(*) FROM memories WHERE learned_on>=date('now','-7 days') GROUP BY source;` → fallback 873, authored 127, episode 44, accommodation 8, blank 8
- **Q16** `SELECT reason,COUNT(*),MIN(version_day),MAX(version_day) FROM versions GROUP BY reason;`
- **Q17** `SELECT COUNT(*) FROM removal_record;` / `… removal_tombstone;` → 0 / 0
- **Q18** `SELECT date(at/1000,'unixepoch','localtime'),payload FROM events WHERE name='adapter.checkout' ORDER BY seq;` → newest head `f34f8c6`
- **Q19** `SELECT kind,COUNT(*),MIN(last_day),MAX(last_day) FROM gate_session GROUP BY kind;`
- **Q20** shell, not SQL: `ls -la ~/.counterparts/` (no `backups/`); `ls ~/.counterparts/store/spans/ | wc -l` → 25. Git: `git merge-base --is-ancestor d9028ef f34f8c6` → no; same for `c87127b` → no.

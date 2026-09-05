# `tools/replay/` — INTERFACE-GAPS

What the harness needs from the rest of the system and does not have. Each entry
is a metric that is `not-exercised` today and would be gradable if the gap were
closed — the scorecard says so out loud, per metric, with the reason.

---

## §1. CLOSED 2026-08-25 — the chunk gate's record is durable

*The problem is kept in full, because the shape of the fix is the useful part.*

`encodeChunk` returns a full `EncodeResult`: `refused[].blockedBy` (which gate,
by name), `preselection.shown` (how many schemas, through which channel),
`events`, `channels`. `Counterpart.applySweep` emitted **counts only** —
`{chunk, proposals, accepted, refused, fullyGated, blind}` — and let the rest go,
which made `gate.refusalMix`, `preselect.meanSchemasShown` and
`preselect.channelMix` structurally not-computable.

**What closed it:** one durable `gate.chunk` event per swept chunk, appended in
`applySweep` through `store.appendEvent` (SEAMS K's log), carrying the gate's
whole outcome content-by-reference — per-gate fire counts as the battery itself
counted them, per-proposal refusal reasons and `blockedBy`, shown-schema ids and
the lexical/semantic/both split, channel records, novelty-with-reason. It is
written for **every** chunk that reached the gate, the fully-gated ones above
all, since those are most of what a refusal distribution is made of.

The three metrics now compute — and they compute **from the store**, read back by
the driver through `eventLog`, not from the in-process event ring: a number that
can only be derived from a live event stream cannot be recomputed from the store
a parallel run leaves behind. Proof: `test/gate-records.test.ts` and the metric
tests in `test/replay.test.ts` §8.

**The correlation id came with it.** `counterpart.sweep.chunk` used to carry a
chunk index that restarts at 0 for every scope `sweepAll` visits, so the harness
matched a gate record to a chunk by arrival order. Both the relayed event and the
durable record now carry `chunkKey`, the content address of the chunk's own span
hashes. The positional zip in `collectChunks` survives only because
`SweepReport.chunks[]` — owned by `remember/` — has no field for it (**§1b**).

### §1a. `applySweep` passes NO schema slice — CLOSED 2026-08-29 (owner ruling)

Closed exactly as filed: `sweepFallback` now builds the slices once per sweep
(protected elements filtered per-element and counted), hands each chunk's
prompt the cards its own preselection chose, and `applySweep` passes the same
slices and the same memoized chunk vector to `gateSweepChunk` — so
`preselect.meanSchemasShown`, `blindRate` and `channelMix` measure a live
mechanism. The prompt/gate agreement is pinned by test (card ids == the
durable record's shown ids). PREDICTION CHECKS remain a named gap: the sweep
intake accepts no `checks` field yet, so `ChunkInput.predictionChecks` stays
unfed on the fallback path — filed here rather than left silent.
`EncodeResult.effects` is still dropped at the same site, same reason as
before: the fallback path mints through `mintProposal` and applies no
`DurableEffect`.

### §1b. The join key exists on the event; the sweep report has no field for it

`chunkKey` reaches the log and the relayed event; `SweepReport.chunks[]` carries
only an index, so `collectChunks` still zips by position for the per-chunk
`ChunkSummary`. Not blocking any metric today — the three that were blocked read
the durable record directly. One `chunkKey` field on `remember/`'s chunk outcome
deletes the last positional join here and in §6.

## §2. CLOSED 2026-08-25 — band moves are counted by direction, and G12 is live

`sleep/decay.ts` recomputed strength and band for every live row and reported
`examined` / `changed` / a skip census, with no **transitions by direction** — so
`band.demotionsPerActiveDay` was not-computable, and `physics.symmetryCheck`
(guarantee 12, scar §2.10, the tripwire that would have caught v1's 279:0
ratchet) was enforced in one place and consumed by nobody.

**What closed it:** the decay materialization diffs each row's band against its
last cached reading and appends a durable `band.transition` event
(`{kind, from, to, direction, site}`, latched per id and lived day). At cycle end
`runCycle` sums those rows per kind, hands them to `symmetryCheck`, and puts the
verdict on `CycleReport.symmetry` plus a `sleep.symmetry` event per kind — with
`sleep.symmetry.tripped` beside it when a verdict is not ok.

Three consequences worth stating out loud:

- `band.promotionsPerActiveDay` now counts **up-moves**, not identity crossings.
  v1's 6.1/day were episodic→semantic band moves, which in v2 happen in the decay
  pass; the identity crossing is rarer than that by design.
- The decay diff is the **one** site. A demotion exists nowhere else (it is a
  number falling back under `THETA_SEM`); a revision-driven demotion is the same
  fact one tick later; and an identity crossing becomes an up-move on the next
  tick, because `promotedIdentity` makes `band()` answer "identity". Counting it
  at the promotion site as well would double-count the same crossing — a ratchet
  tripwire lying in the ratchet's own direction. The cost is a one-day lag on a
  counter whose sample threshold is 20 moves across the whole history.
- The verdict is **not persisted**. It is arithmetic over the durable rows,
  recomputed every cycle, so a second copy could only go stale. What is persisted
  is the counter.

**The registry half CLOSED before 2026-09-04.** This paragraph used to read
"still open, and it needs the dashboard's owner": the activity view's
`DURABLE_EVENT_NAMES` registry (`src/adapters/dashboard/registries.ts`) knew
neither `gate.chunk` nor `band.transition`, so `test/dashboard.test.ts`'s "no
event reaches the durable log that the registry does not know about" passed only
because its fixture swept nothing and lived one day. Both names are in the
registry, the flow map and the narration vocabulary now, all three
`satisfies Record<DurableEventName, …>`. The type-level hole the dashboard's own
INTERFACE-GAPS §5 names is unchanged and is a different hole: a writer that
appends a RAW STRING name still goes unlisted without failing `tsc`, which is why
the empirical half of that test exists beside the type-level one.

The status view should also **surface the symmetry verdict, BY REASON, never by
`ok`**: below `SYMMETRY_MIN_SAMPLE` the verdict is `never-asked` and carries
`ok: true`, so a view keyed on the boolean paints a starved tripwire green — the
precise failure guarantee 12 exists to prevent.

### §2a. CLOSED 2026-09-05 — the authored door records its gate too

*The problem is kept in full, because the shape of the fix is the useful part.*

`Counterpart.deposit` received a `SubmitResult` carrying `{reason, gate}` — the
battery's first refusal reason and nothing else. `encode/`'s `GateRecord[]` (the
per-gate statuses, hedge counts, alias verdicts, secret families) never crossed
back, because `remember/`'s `GateVerdict` failure arm had nowhere to put it. So
no durable record was written for the authored door: the only two facts that
could be — accepted, refused-with-a-reason — rode the in-process
`counterpart.deposit` / `counterpart.deposit.refused` events and died with the
process. `gate.refusalMix` was therefore computed over the crash-sweep path
alone, which on a corpus that mostly AUTHORS is the smaller half of the
distribution, presented as the whole one.

**What closed it,** and it is the fix this entry proposed, with two departures
named below: `records`, `channels` and an unjoined `blockedBy` on BOTH arms of
`GateVerdict`, relayed through `SubmitResult` (which also carries the proposed
`kind`, the one fact that used to survive a refusal only on the accepted
proposal), and one durable `gate.deposit` row per deposit that reached the
battery — written on the accept arm and the refuse arm alike, through
`store.appendEvent`, the same SEAMS K log `gate.chunk` and `recall.decision` are
written through. Content by reference, all of it: gate names, closed-vocabulary
statuses and reasons, counts, secret FAMILIES with a site, a hash of the REDACTED
text. No draft text, no alias, no quote, no secret and no hash of one.
`tools/replay`'s `gate.refusalMix` now sums fires over both record kinds.

**The two departures from the proposal above.**

- **The name is `gate.deposit`, not `gate.authored`.** It reads as the twin of
  `gate.chunk` — both are "the battery met X" — and the door it names is the one
  `Counterpart.deposit` owns.
- **It is a FOURTH surface-set component, so the G12 hash moved**
  (`800a9a9421cd969f` → `1f5452ecaedfff37`). `gate.chunk` is in that hash because
  it is scored; `gate.deposit` is scored by the same metric, and a scored record
  whose schema the arbiter cannot see is the hole PR-8 delta N6 closed for the
  other two. CONTRACT §4 is explicit that nothing is smuggled in as "just
  telemetry" without the surface-set proof, and keeping the number still by
  leaving the record out would be that smuggling with extra steps.

**Three things this does NOT do, named rather than laundered:**

- **No row when no battery ran.** An observer stand-down, a malformed draft, a
  content duplicate and a gate that threw are all decided before or instead of
  the battery (`remember/` NOTES §7's rejection ordering). A row claiming five
  clear gates for a draft no gate ever saw would be worse than no row (scar
  §2.4), so those four outcomes keep only their in-process event.
- **No `dedupKey`, unlike `gate.chunk`.** `store.pruneEvents` keeps a latched row
  forever. That is right for the crash fallback, whose ordinary rate is zero rows
  a day; it is wrong for a door that fires at every session end and every jot.
  These age out on the log's 90-day window, exactly the call §7 records for
  `recall.decision`. What the latch would have bought is bought elsewhere: an
  accepted deposit cannot repeat, because `remember/`'s content ledger refuses a
  second deposit of the same text before the battery is called.
- **No novelty and no preselection count.** `bridge.batteryGate` refuses before
  it embeds, so the refusal arm could only ever carry a null; and the authored
  door shows the author no schema cards at all, so a `shown: 0` would read as a
  preselection that ran and selected nothing. The record says
  `preselection: "not-run"` with a reason instead, and `depositRecords` is a
  SEPARATE array in the observation so those zeros never reach
  `preselect.meanSchemasShown`.

Proof: `test/gate-records.test.ts` (a refused deposit and an accepted one, each
leaving a row that names the acting gate), `test/dashboard.test.ts`'s totality
test with the new name, and `test/dashboard-web.test.ts` (the ENCODE node lights
on it, and no longer carries an `unloggedPath` sentence).

## §3. No turn loop to replay

Every §1.4 surfacing metric, and `reinforce.missMix`, are `not-computable`
because raw spans are not turns: a surfacing decision needs a cue, a session, and
a reply that used something. v1 committed 11 paired turn-sequences plus a
53-memory seeded store precisely for this, and those fixtures are *not* in the
corpus inventory.

**What would close it:** port v1's paired turn-sequence fixtures (as fixtures,
not as code — constitution line 14) and give the harness a second driver mode
that runs `recallForTurn` → `resolveUses` over them. Guarantee 6 applies with
full force there: the harness must not construct per-session gate state that the
production turn path does not carry, which is exactly how v1's session dedup,
emotional refractory, cue zeroing and cross-session carry-over came to be tested
and inert.

## §4. The pinned vectors are named but not used

`Corpus.embeddingModels()` reads the cache's per-model row counts and the run
record names the pinned generation, satisfying guarantee 7's *naming* half. The
driver does **not** wire those vectors into the brain as an `Embedder`, so today
every replay is a no-vectors replay.

This is what stands between the harness and §17.3's sharpest result: *exact-match
when v2 reuses v1's cached vectors; tier sets and orderings only when it does
not*. Until it is closed, no exact-match retrieval claim can be made from a
replay run at all.

**What would close it:** an `Embedder` backed by the read-only index, keyed by
the pinned model, with a recorded miss rate (a cache miss must be a counted
`not-exercised`, not a silent recompute on a different model).

## §5. Episodes and prospective have no replay input

`episode.*` and `prospective.*` are `not-computable`: episodes are v1 *output*
(§17.1), and prospective fires are wake-time and session-scoped. v1's own
prospective sample (33 fire-or-suppress events) is too small to re-derive PR-A…F
against in any case.

**What would close it:** the prospective fixture v1 committed (26 occasions /
20 sessions / 81 turns) as a separate harness mode, with the scorer implementing
its own window arithmetic — guarantee 5 bites hardest here, since a shared
window bug would grade itself.

## §6. The join key exists; the join does not

`contentAddress()` is the one content-address function §17.1 asks for, and the
reader stamps it on fixture spans. Nothing yet **joins** a replayed chunk back to
the v1 event that interpreted the same span, which is what would turn the
distributional comparison into a per-chunk one (same span in → what did v1 get,
what did v2 get).

**What would close it:** index v1's `interpret.done` events by their span hashes
and emit the same address on v2's chunk event.

## §7. The two human-rated criteria have no rater path — the CARRY-FORWARD half CLOSED 2026-09-03

*The problem is kept in full, because the shape of the fix is the useful part.*

`surface.loudOffTopicRate` (A2, ≤5%) and `prospective.gateTable` (PR-F, ≤5% over
≥20 fires) return `needs-rater` and stop there. v1's carry-forward rule — a
human verdict carries across a code change **only when the machine-scored surface
set is provably identical** — needs the machine-scored surface set to be
recorded and diffable before a rating can carry at all. The record itself existed
and was content-by-reference from day one; it lived in the in-process event ring
and died with the process, so no §6 Recall criterion was recomputable from a store
and G12 had nothing to hash (parallel CONTRACT precondition 9).

**What closed it:** one durable `recall.decision` event per turn, appended in
`Counterpart.recallForTurn` through `store.appendEvent` — SEAMS K's log, the same
seam `gate.chunk` is written through — carrying the decision content-by-reference:
session and turn, the lived day and the calendar date, the reason, the budget and
the composed bytes, the two tier counts, the affect flag with its reason, whether a
sentinel was rendered, and the surfaced and footnoted ids each with the salience
and activation the gate judged it by. No memory text, no cue text and no hash of
either (scar §2.20) — pinned by a marker planted in both the memory body and the
turn and asserted absent from the whole log. The registry entry landed with it, so
the activity view can name the row — the `DURABLE_EVENTS` hole §2 above names.

G12's carry-forward rule now has something to hash: `surfaceSetFields()`, exported
beside the record in `src/core/counterpart.ts`, is the record's ordered field list,
exhaustive BY TYPE against the record literal — so the writer and whatever hashes
it cannot drift apart without failing `tsc`. Proof: `test/counterpart.test.ts`,
"the surfacing decision is DURABLE — one row per turn, content-by-reference".

**Three things this does not close, named rather than laundered:**

- **`needs-rater` stays `needs-rater`.** A hashable surface set is the precondition
  for a human verdict to CARRY across a change; it is not a rater. A2 and PR-F
  still return `needs-rater` until the parallel run supplies one.
- **A latency abort writes nothing at all** — no row, and no in-process event
  either (`recall/` §5 G2: *nothing injected, buffered, logged, or spent*; a
  subconscious that lost its race must not then pay for a durable write to say so).
  So the surfacing race's WIN arm is in the store and its TIMEOUT arm is not: the
  timeout is counted where a timeout is still allowed to be seen, the adapter's own
  per-turn `adapter.recall {reason: "latency-abort"}` — a log, not a ring, which is
  what parallel G2's "durable stores **plus logs**" admits. `aborted` and
  `elapsedMs` stay in the field list; `aborted` is false in every written row, and
  the field stays so the asymmetry is legible rather than assumed.
- **No retention rule was added.** The row carries no `dedupKey`, so it ages out on
  the log's existing window (`DEFAULT_RETENTION_DAYS` = 90, longer than any run this
  contract plans) instead of being kept forever as a replay latch. A `session:turn`
  latch was considered and rejected: a turn number restarts at 1 whenever gate state
  is reset or evicted, so the latch would swallow a genuine second decision.

## §8. And the one that no interface can close

**Replay plus clock-simulated decay covers most verification; a 1–2 week parallel
run beside v1 is the irreducible live-verify** (CONTRACT §5 guarantee 11, §17.4).
Every live verification in v1's history found bugs its tests did not. A green
scorecard from this harness is a precondition for that run, never a substitute
for it.

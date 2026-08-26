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

### §1a. `applySweep` passes NO schema slice, so preselection has nothing to select

Now visible, which is the point. `gateSweepChunk(chunk, drafts, day, {observer})`
supplies no `schemas`, so `preselection.candidates` is 0, every chunk reads
`blind`, and `preselect.meanSchemasShown` computes **0.00 and FAILS** its
v1-anchored band. That failing line is the honest surface of the gap: before the
record existed, the same defect showed up as an absence nobody had to answer for.

Wiring the slice in is a behaviour change, not a logging one — schema slices
drive entity mentions, prediction checks and novelty, all of which move durable
state — so it belongs to whoever owns the encode path, with its own tests.
`EncodeResult.effects` is dropped at the same site for the same reason: the
fallback path mints through `mintProposal` and applies no `DurableEffect`.

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

**Still open, and it needs the dashboard's owner.** The activity view's
`DURABLE_EVENT_NAMES` registry (`src/adapters/dashboard/registries.ts`) is
exhaustive by TYPE over four record interfaces and does not know `gate.chunk` or
`band.transition`. `test/dashboard.test.ts` — "no event reaches the durable log
that the registry does not know about" — passes today only because its fixture
sweeps nothing and runs a single cycle (a first materialization is not a
crossing). **It will fail the moment that fixture sweeps or lives a second day**,
and the dashboard's own INTERFACE-GAPS §5 already names this as the hole the
type-level totality check cannot catch.

The status view should also **surface the symmetry verdict, BY REASON, never by
`ok`**: below `SYMMETRY_MIN_SAMPLE` the verdict is `never-asked` and carries
`ok: true`, so a view keyed on the boolean paints a starved tripwire green — the
precise failure guarantee 12 exists to prevent.

### §2a. The authored door's gate records stop at `remember/`'s verdict seam

`Counterpart.deposit` receives a `SubmitResult` carrying `{reason, gate}` — the
battery's first refusal reason and nothing else. `encode/`'s `GateRecord[]` (the
per-gate statuses, hedge counts, alias verdicts, secret families) never crosses
back, because `remember/`'s `GateVerdict` failure arm has nowhere to put it. So
no durable record is written for the authored door: the only two facts that could
be — accepted, refused-with-a-reason — already ride the in-process
`counterpart.deposit` / `counterpart.deposit.refused` events, and minting a third
durable event name while the registry above is unfixed would break that totality
test for no new information.

**What would close it:** an optional `records` field on `GateVerdict`, relayed
into a `gate.authored` durable event, landing together with the registry entry.

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

## §7. The two human-rated criteria have no rater path

`surface.loudOffTopicRate` (A2, ≤5%) and `prospective.gateTable` (PR-F, ≤5% over
≥20 fires) return `needs-rater` and stop there. v1's carry-forward rule — a
human verdict carries across a code change **only when the machine-scored surface
set is provably identical** — needs the machine-scored surface set to be
recorded and diffable before a rating can carry at all.

**What would close it:** persist the per-turn surfacing decision record (§17.3's
richest comparison surface, content-by-reference) and hash the surface set into
the pass record.

## §8. And the one that no interface can close

**Replay plus clock-simulated decay covers most verification; a 1–2 week parallel
run beside v1 is the irreducible live-verify** (CONTRACT §5 guarantee 11, §17.4).
Every live verification in v1's history found bugs its tests did not. A green
scorecard from this harness is a precondition for that run, never a substitute
for it.

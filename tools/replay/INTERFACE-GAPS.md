# `tools/replay/` — INTERFACE-GAPS

What the harness needs from the rest of the system and does not have. Each entry
is a metric that is `not-exercised` today and would be gradable if the gap were
closed — the scorecard says so out loud, per metric, with the reason.

---

## §1. The composition root drops the chunk gate's own record

`encodeChunk` returns a full `EncodeResult`: `refused[].blockedBy` (which gate,
by name), `preselection.shown` (how many schemas, through which channel),
`events`, `channels`. `Counterpart.applySweep` emits **counts only** —
`{chunk, proposals, accepted, refused, fullyGated, blind}` — and lets the rest
go.

Blocked by this, all reported `not-computable`:

- `gate.refusalMix` — v1's headline gate distribution (secrets 66%, alias 30%,
  precision 4%) cannot be reproduced, so the most-fired gate in v1 is invisible
  in v2 telemetry.
- `preselect.meanSchemasShown` — v1's 1.95 mean. `blind` is relayed, the count
  behind it is not, which means the harness can see *that* preselection failed
  and never *how close* it came.
- `preselect.channelMix` — v1's newest field (`schemaChannels`), flagged in the
  harvest as one to carry from day one rather than backfill. v2 currently
  carries it nowhere.

**And there is no correlation id.** `counterpart.sweep.chunk` carries the chunk
index but not the scope or the claim, while chunk indices restart at 0 for every
scope `sweepAll` visits. The harness therefore matches a gate record to a chunk
by (arrival order + index + an outcome that actually reached `apply`), and
records `gated: false` when it cannot — because a chunk whose interpreter
returned nothing short-circuits to `EMPTY` *before* `apply` and emits no gate
event at all. On v1's numbers that is 16.4% of chunks, so a naive positional zip
would have shifted the blind rate for most of the corpus. One correlation id on
the event would delete the whole problem.

**What would close it:** one relayed event per refused proposal (ref, kind,
reason, `blockedBy`), a `shown`/`channels` field on the existing chunk event, and
a claim-or-scope id on both. All content-by-reference already — counts and gate
names, not text — so nothing about the logging discipline has to change.

## §2. Decay reports rows changed, not band transitions

`sleep/decay.ts` recomputes strength and band for every live row and reports
`examined` / `changed` / a skip census. It does not report **transitions by
direction**.

- `band.demotionsPerActiveDay` is `not-computable` (v1's dominant crossing:
  268 of 345 were semantic→episodic decay demotions).
- The same missing number is what `physics.symmetryCheck` needs to fire at all —
  guarantee 12, scar §2.10, the tripwire that would have caught v1's 279:0
  ratchet. A counter nobody feeds is a tripwire that cannot trip.

**What would close it:** count `{from, to}` band moves in the decay phase and put
the pairs on the phase report, the way promotions already are.

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

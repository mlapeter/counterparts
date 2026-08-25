# `recall/` — implementation notes

Where the contract was silent, ambiguous, or asked for machinery this build has not
earned yet. Each entry says what was decided and why, so the next session argues with a
recorded choice rather than re-deriving one.

## 1. The relative bar is LEAVE-ONE-OUT

The contract says surfacing is judged "relative to this turn's own background
distribution". Read literally — background = all of this turn's activations — the rule
is self-defeating: the strongest candidate drags `mean + k·sd` up by roughly the amount
it stands out, so a lone perfectly-cued memory is measured against itself and can never
clear its own bar. Measured on the first fixture built here: bar 7.20 against a top
activation of 7.61, which the salience modulator then pushed to 8.40 and the memory went
dark.

So the background for candidate *i* is the turn's OTHER activations (`looBar`). The
whole-sample `mean`/`sd`/`bar` are still reported in the decision record for replay; the
number each candidate actually faced rides on its own verdict (`CandidateVerdict.bar`),
because in this regime a single turn-level bar would be a fiction.

## 2. Two absolute regimes, both named

`background()` returns a `Regime`, and the record carries it:

- `absolute-cold-start` — store below `COLD_START_MIN_STORE`. Cold start is stricter,
  not looser (§9 G13): a higher floor replaces the bar entirely and the candidate cap
  tightens. Small stores over-surface.
- `absolute-thin-background` — fewer than `MIN_BACKGROUND_SAMPLE` cued candidates, or
  zero variance. A background of one is not a distribution, and saying so in the record
  is better than computing a number that means nothing.

Salience modulates the bar in the `relative` regime only. The absolute regimes exist
precisely to be un-negotiable.

## 3. Emotion is a modulator, not a channel — which is STRICTER than v1

v1 lists emotion among the single channels that are tier-capped, implying an
emotion-only candidate can exist. Here it cannot: a memory becomes a candidate only
through the token index or the vector index, so emotional salience can lower a cued
memory's bar (`gatedSal`) but can never summon an uncued one. Hard gate (a) is therefore
structural rather than checked. This is a deliberate tightening; if replay shows real
retrievals lost to it, the fix is an emotion seed channel, not a weaker gate (a).

The turn gate on emotional salience (§9 G10) is `detectAffect().selfFelt`, and the
subject rules of G11 are split as the spec splits them: the FLAG fires on any subject's
stated feeling, the CUE only on the speaker's own.

## 4. `detectAffect` uses its own splitter, and that is not a second tokenizer

Cue matching imports `tokenize` from the store so cues are word-bounded exactly the way
the index was built. Affect detection cannot: `tokenize` drops tokens under two
characters, which throws away "I". Affect detection never touches the index, so a local
splitter is not a second definition of the same thing — it is a different thing.

Its precision limits are real and recorded as a probe question: a fixed feeling
vocabulary, a five-word backward window for the subject, object pronouns excluded, and a
stop at the nearest third-person subject. "She told me Robin was upset" reads as stated,
not self-felt. Turns that bury the pronoun further back read as not-self-felt, which is
the safe direction.

## 5. Session dedup subsumes the arrival refractory

The harvest names four rules that were dark in v1. Three are implemented as named
mechanisms: session dedup, the emotional refractory, cue carry-over. The fourth —
"refractory suppression of arrival cues" — is subsumed: a surfaced memory is suppressed
outright for the rest of the session, so there is no arrival boost left to damp. If
dedup is ever softened to a penalty rather than a suppression, this rule comes back as
its own mechanism.

## 6. Carried cues are turn TOKENS in box 2 — a deliberate, bounded call

Cue carry-over needs last turn's cue tokens, and persisting them means user words land
in the operational database. The call: keep it, bounded to `MAX_CUES` tokens, overwritten
every turn, scoped to one session, never emitted as telemetry. The decision record and
every event carry counts and hashes only — a cue token is turn text, and turn text is
exactly what telemetry may not carry. Revisit if the retention review disagrees.

## 7. Deliberately NOT built (Amendment 15 — complexity is earned)

- **Deliberate recall (§9.1)** — the explicit ask, its lower-confidence labeled tier and
  bodies-for-footnotes. Different thresholds on purpose; a different entry point. Not
  needed by the ambient path and not built here.
- **Edge traversal / spreading activation** — `associate/` owns it (module map ruling 1).
  Recall's channels are cue, semantic and arrival; when `associate/` ships, its hops feed
  a fourth channel and the gate does not change.
- **The query-aware inhibition relaxation (§9 G14)** — the cluster-majority rule is
  machinery earned by a v1 incident with a live-data regression fixture we do not have.
  Shipped: plain near-duplicate suppression at `NEAR_DUPLICATE`. Ship the relaxation with
  the fixture that proves it, not before.
- **A census surface (§9.1 G6)** — belongs with deliberate recall.

`G15` (a suppressed candidate reclaims a slot only as competition, never as
un-inhibition) holds by construction: suppressed candidates are dropped, and slots fill
from the ranked remainder. An empty slot stays quiet — nothing lowers a bar to fill one.

## 8. Every tunable is CAL, inherited, not measured

`tunables.ts` carries v1's live calibration as starting points, marked CAL. That is a
record of what real use moved in v1's activation space, not a measurement of v2's — and
v2's cue weights are a different scale entirely (smoothed idf, not v1's normalized
similarities). Nothing here is calibrated until `tools/replay` says so (scar §2.8).

## 9. The build/record split is a public seam

`Recall.build()` is exported rather than private. "Build and record are separate steps"
is only a real property if the build is separately callable; a private half is a promise.
`recall()` = build + record, and the latency abort returns before the record step, which
is what makes the abort side-effect-free.

One residual: an aborted build may already have caused the STORE to emit its own read
telemetry. Recall emits nothing and writes nothing. The guarantee is about recall's side
effects, and the store's read events are read events.

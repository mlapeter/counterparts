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

## 8. Every tunable is CAL, inherited, not measured — except five, now

`tunables.ts` carries v1's live calibration as starting points, marked CAL. That is a
record of what real use moved in v1's activation space, not a measurement of v2's — and
v2's cue weights are a different scale entirely (smoothed idf, not v1's normalized
similarities). Nothing here is calibrated until it is measured against v2's own corpus
(scar §2.8).

Five now are. `BUDGET_MS` was re-measured on day 0 of the parallel run, and
`CUE_LENGTH_NORM` / `CUE_TF_SATURATION` / `CUE_LENGTH_ONE_SIDED` / `CUE_DOC_CAP` on
2026-09-04 against a copy of the live store with `tools/recall-bench` — see the tunable's
own comment for the 23-cell grid, including the cell it picked (`b = 0.5`, clamped) over
the textbook BM25 default it was expected to pick.

## 10. Length normalization lives in the INDEX, not in the scorer

The obvious place to divide by document length is `activate.ts`, where the cue arithmetic
already is. It would not have worked. `searchIndex` takes the top `PER_CUE_FETCH` rows
**ordered by score**, so a scorer that normalizes after the fetch is re-ranking a set that
raw term frequency already chose — and on the live store the nine longest documents held
most of the slots for every cue. So the normalization is SQL, `Store.search` grew a `norm`
argument, and `activate` multiplies the cue's rarity weight by whatever evidence the index
reports. `tfFactor` is no longer applied there; applying it would saturate a saturated
number.

Two consequences to keep in mind when reading the code:

- **The length factor is CLAMPED at 1**, so the scale only ever moves DOWN. BM25's factor
  is centered on the mean, which would have raised a short document up to ~1.6× its old
  score — fine for ranking, not fine for the absolute floors (`FLOOR_GLOBAL_UNITS`,
  `FLOOR_STRONG_DEFAULT_UNITS`), which a candidate has to clear in a fixed number of cue
  units. The clamp was added to TEST whether those floors explained the loud-tier jump. They
  did not: clamping moves the loud count by one, and the floors turned out not to be firing
  at all (CONTRACT §7 OQ5, answered 2026-09-04 — document frequency was being read off the
  length of a bounded top-K, so rarity stopped being measured as the store grew). The clamp
  ships anyway, because it is the conservative arithmetic and because at `b = 0.5` it is the
  only cell in the grid that recovers an ambient labeled positive.
- **The candidate union got an order of magnitude wider**, because the hubs are no longer
  occupying every cue's fetch. `activate` therefore ranks from box 2 and reads prose only
  for the survivors — an equivalence, not a heuristic, and the reason the change is
  latency-neutral (warm, 13 real prompts: 160 ms before, 168 ms after).

## 11. The deliberate tool's result has a byte budget now, and it is the host's number

The ambient path has had `BUDGET_BYTES` since day one because scar §2.18 says the
injection ceiling is a host capability. The deliberate path had none, and on 2026-09-04
three real `recall` calls returned 7, 8 and 12 full bodies — 73,000 to 122,000 characters
— and all three overflowed the host's tool-result cap. An answer the host truncates is not
a smaller answer; the model cannot tell it from "nothing came".

So: a LIST answers *which memories* and ships 300-character excerpts; an ADDRESS (`handle`,
or the new `ids`, capped at three) answers *what it said* and ships up to 4,000 characters
each; the total is bounded at 12,000; and every cut is stated in the payload and in the
`mcp.recall` event. `ids` routes each id through `expandHandle`, so the confidentiality
boundary and the no-fuzzy-search rule are the same ones, not new copies.

## 9. The build/record split is a public seam

`Recall.build()` is exported rather than private. "Build and record are separate steps"
is only a real property if the build is separately callable; a private half is a promise.
`recall()` = build + record, and the latency abort returns before the record step, which
is what makes the abort side-effect-free.

One residual: an aborted build may already have caused the STORE to emit its own read
telemetry. Recall emits nothing and writes nothing. The guarantee is about recall's side
effects, and the store's read events are read events.

## 12. Rarity is undefined on a store of ONE — 2026-09-04

**Symptom.** A fresh store, no identity core, one authored memory through the MCP `note`
door. `recall` with a question that plainly matched it answered
`reason: "nothing-came", considered: 0, storeSize: 1`. Writing ANY unrelated second
memory made the same question find the first one. At `storeSize` 1 the `handle` and `ids`
paths returned the memory (`reason: "expanded"`), so the writer, the cache and the ranking
were all fine: the question path's candidate SET was empty at n=1. Reproduced on four
independent fresh stores by a cold-stranger reviewer, and again here at both doors.

**Cause.** `cues.ts#informativeness` — `Math.log((storeSize + df) / (2 * df))`. On a store
of one, the only memory holds every token, so `df = 1 = storeSize` and the expression is
`log(2 / 2)` = `log(1)` = **exactly zero, for every token in the turn**. `buildCues` drops
a zero-weight cue (`if (idf <= 0) continue`), so the cue list came back empty, the token
index was never probed, and the gate never saw a candidate to refuse. Not a floor, not
BM25 length normalization (`avgDocLen` on one document gives a length factor of exactly 1,
which is what it should give), not a `LIMIT` — the smoothing's own zero.

The zero is the RIGHT answer to the question the formula asks. It is the wrong question at
n=1: rarity is a claim about alternatives, and a token that spans a one-memory store is not
ubiquitous, it is merely present. §9 G4's "informativeness weighting replaces stop-lists"
needs at least two documents before "spans the whole store" distinguishes anything.

**Fix.** `MIN_RARITY_STORE = 2`, and the store size is read as
`Math.max(storeSize, MIN_RARITY_STORE)`. Definitional rather than tunable — it names the
domain of the rule, not a dial — so it sits beside the function and not in `tunables.ts`.
No floor was retuned; the root cause was never a floor.

**And the tier is capped at that size** (`gate.ts`, verdict
`cold-start-undiscriminating`). Making the first memory cueable has a cost, and it is
larger than it first looks: at N=1 EVERY token the memory holds is maximally rare, and
`COLD_START_MIN_STORE` is 15, so N=1 is always the cold-start regime with
`strongFloor = 4.5 x 0.4055 = 1.8246`. MEASURED 2026-09-04 with the fix in and before the
cap: one ordinary three-sentence note against five unrelated turns sharing nothing but
`the` / `that` / `and` / `not` went **`surfaced` — the LOUD tier — on all five**, at
activation 1.82, 1.88, 1.99, 2.19 and 2.24. (The reviewer who found it measured the same
shape on a different note: loud on three of five at 2.78 / 2.87 / 2.87, footnoted on the
other two.) Session dedup bounds it to once per session, and N=2 cures it on its own — the
same five turns at N=2 footnote at 0.36-0.62, one of them not a candidate at all — but
"bounded and self-curing" is not the same as "right", and the doctrine at
`gate.ts#background` is that cold start is STRICTER, not looser. So below
`MIN_RARITY_STORE` the loud tier is closed: arrival makes a memory warm, and at a size
where there is no relevance to measure, nothing makes it loud. The floors are untouched;
`cold-start-undiscriminating` is a loud-tier BLOCK, so it reaches a reader as
`loudBlockedBy` on an admitted candidate and adds no field to the decision record (G12
class IDENTICAL, `800a9a9421cd969f`). Inert at N >= 2 by construction.

**At scale.** `df >= 1` always, so `storeSize >= 2` is the only regime that can be affected
and it is untouched by construction: the fix changes nothing but `storeSize === 1`. The
weight of one maximally-rare cue, before and after — N=1: **0 -> 0.4055**; N=2: 0.4055
(unchanged); N=3: 0.6931; N=100: 3.9220; N=14,000 (the live store): 8.8537 — every one of
them bit-identical, which a test asserts against the pre-fix expression rather than
claiming. `storeSize: 0` still returns 0, which the quiet-turn record depends on
(`index.ts` denominates a no-candidate turn in `floorUnit(0)`). So the #25/#28 bench on the
14,000-memory store cannot move: loud 3/13 turns, 2.8 delivered per turn, hubs 0 stand
untouched. That bench needs a copy of the owner's live store and cannot be run from here —
**bench re-run: NEEDS-OWNER**.

What does change at `storeSize` 1, and it is the intended change: the ambient path can now
footnote the lone memory when the turn shares a cue with it (`floorUnit(1)` goes 0 ->
0.4055, so the cold-start floor there goes 0 -> 0.1622 and stops being vacuous), and a turn
sharing no token still goes quiet — an absent token has `df = 0` and is still worth
nothing. The stop-list guarantee is genuinely OFF at that size, which is what the tier cap
above is for.

**Left alone, deliberately.** The same arithmetic makes a token with `df === storeSize`
score zero at n=2 and n=3 as well: two memories that share the question's only content word
are both invisible to it. That is NOT rare in the default flow, and the first draft of this
note said it was — the rationale "the second memory usually shares nothing" is false.
MEASURED: `chapter` writes an `epi_` row that `list({archived: false})` counts and
`doc_tokens` indexes, so a session that journals and then notes the same subject reaches
N=2 with `df = 2` on every shared content word, and the question comes back
`nothing-came, considered: 0` WITH this fix in (`ids = [epi_…, mem_…]`,
`storeSize: 2`, `df(sourdough) = 2`).

The choice stands anyway, for a different reason: the generalizations that would soften it
— `max(storeSize, df + 1)`, or a `log((N + 1) / (df + 0.5))`-style smoothing — give every
whole-store token a small non-zero weight at EVERY scale, trading the stop-list guarantee
on a 14,000-memory store for a small-store miss. That is a bad trade to make blind, and
this branch is a one-line fix under adversarial review, not the place to re-derive the
smoothing. Two findings are FILED for the owner rather than folded in here: (a) recall
counts, indexes and delivers journal (`epi_`) rows at all, which is what makes the n=2
collision the default rather than the exception; (b) `df` counts indexed rows in
`doc_tokens` while `storeSize` counts live rows in `memories`, so `df > storeSize` is
reachable (an archived sibling, a superseded head) and re-zeroes a rare token — revise the
first memory on a fresh store and it goes dark again. Both want a decision about what the
denominator IS, which is a bigger question than this bug.

## 13. A chapter is delivered, and says it is a chapter — 2026-09-04

Owner ruling, `docs/LAUNCH-STATUS.md` §I14: keep chapters RECALLABLE, label them journal in
every result. Both halves matter. The filter was the obvious fix and is the wrong one — a
chapter about the lighthouse conversation may rightly come to mind, and a question answered
worse is not a safer answer. What was actually wrong is that an `epi_` row arrived from
recall wearing a memory's clothes: note #12 above measured one coming back `quiet` on a
question and footnoted on the ambient path, with nothing on the row or the line to say that
it is the first-person ACCOUNT a memory was made from, that it sits outside every sleep
phase (`sleep/types.ts#isJournal`), and that the physics printed beside it is recorded and
never acted on.

**The label is data plus one word, and it is nothing else.** No candidate is added or
removed, no score moves, no ordering changes, and the surfacing decision record does not
grow a field — `surfaceSetHash()` is `800a9a9421cd969f` before and after, which is what
makes this a rendering change under parallel §5 G12 rather than a surface-set move. The
three doors:

- `render.ts` — `Resolved.journal` and `FRAMING.journal` (`"Journal:"`), in front of the
  content in BOTH tiers, and outside `clip()`. The label is what tells a reader the line is
  not a memory, so it can never be the part the byte budget eats; a line that does not fit
  is dropped whole by the trim order, where that decision belongs.
- `mcp/deliberate.ts` — `journal: boolean` on `Recalled` and `BoundedMemory`, glossed once
  in the payload (`JOURNAL_GLOSS`) so the flag is not a bare boolean the reader has to
  guess at, and claimed in the tool description (`tools.ts`) where the calling model reads
  it. `kind` stays PHYSICS kind: a chapter is usually `kind: "self"`, which is exactly the
  ambiguity the boolean resolves rather than overwrites.
- `cli/commands.ts` — `[journal]` beside the tier, with its own legend line.

**The predicate is `ProseDoc.type === "episode"`**, the same field `isJournal` reads off the
row. Read at render time from the doc that is already in hand, so nothing was added to
`Candidate`, `CandidateVerdict` or the decision record to carry it — which is the whole
reason the hash does not move. The model is the dashboard's, which has flagged the row in
prose since #33 (`dashboard/web/views.ts`, `MemoryDetail.journal`); this is the same
sentence at the doors that had not learned it.

**The wake needed no change, and the test says why.** `self/identity.ts#scanActive` lists
`type: "memory"` and nothing else, so a chapter cannot reach a lane however it is shaped —
identity band, promoted, `unresolved`, skill-kind, maximum salience. `test/self.test.ts`
builds one of each and asserts no `epi_` id in any lane and no chapter text in the render.
That test proves a property rather than a change, and it is the tripwire for the day that
one filter moves.

**The one value-level delta, named.** A labelled line is 9 bytes longer ("Journal: "), so a
turn that delivers a chapter AND lands within 9 bytes of `BUDGET_BYTES` trims one more item
than it used to. That is recorded in `trimmed` like any other trim. Measured on the
fixture: the same turn renders 225 bytes before and 234 after.

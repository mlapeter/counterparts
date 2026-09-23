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

## 13. The two denominators, answered: the index is the LIVE store — 2026-09-04

§12 filed finding (b) and said the denominator wanted a decision. This is the decision.

**Symptom.** A fresh store, one note through the MCP `note` door, one revision — and the
same question that answered a moment ago comes back `nothing-came`, `storeSize: 1`. Not
the N=1 degeneracy §12 fixed: the store still holds exactly one live memory, and it is the
successor, which nothing had ever asked about before.

**Cause.** `informativeness(df, storeSize)` reads two numbers that come from two boxes and
count two different populations. `storeSize` is `store.list({ archived: false }).length` —
box 2, LIVE rows. `df` was `COUNT(*)` over `doc_tokens` — box 3, every row ever indexed,
including the archived and superseded ones, because nothing ever took a row OUT of the
index. `revision.ts:385` calls `Store.supersede`, which archives the head and leaves its
token rows in place, so `df(sourdough) = 2` stood against `storeSize = 1`. And
`log((max(N,2) + df) / (2·df))` is exactly zero at `df ≥ N`: every cue is dropped, the
index is never probed, and the gate never sees a candidate to refuse. §12's zero, reached
by revising rather than by being first.

**Fix — deindex, not a second count.** `cache.ts#deindexDoc` deletes the row's
`doc_tokens` and `doc_lens`; `Store.archive` and `Store.supersede` call it; `rebuildCache`
skips rows that are archived or superseded and counts them out in `skippedArchived`, which
`counterparts verify --rebuild` prints and includes in its accounting.

The alternative — counting `df` over live rows only — was refused on two grounds. Box 2
and box 3 are separate sqlite FILES, so it needs an `ATTACH` or a copy of "which rows are
live" kept inside the cache: a second source of truth that drifts from the first, which is
scar §2.6's shape. And it fixes one number where the whole statement was wrong: the index
is read by `docFrequency` AND by `searchIndex`, and both of those feed a pass that
discards dead rows anyway. Deindexing makes `df ≤ storeSize` structural rather than a
filter someone must remember, and the rule it states is the simpler one (constitution 15):
**the text index is the index of the LIVE store.** Brain analog: reconsolidation replaces
a trace; it does not leave the old one competing at retrieval.

**The second half, which had not been named.** `searchIndex` returns the top `PER_CUE_FETCH`
per cue, and `activate.ts` then throws away every hit whose row is archived or superseded
(`skipped`). So a dead row was spending a candidate SLOT before it was refused — the
candidate SET was narrowed by rows that could never be delivered. That is the same failure
that put length normalization inside the SQL before `ORDER BY … LIMIT`: re-ranking a wrong
set is not choosing a right one. `test/recall.test.ts` pins it ("a dead row does not
occupy a candidate slot in the index either").

**…and it is closed on the LEXICAL channel only. The semantic half is OPEN.** The first
draft of this entry, and of `deindexDoc`'s docblock, said that nothing reads a dead row's
vector and that no reader could tell. Both were false, and an adversarial review measured
it: `cache.ts#nearest` does `SELECT memory_id, vec FROM embeddings` with **no filter**,
`activate.ts` takes that ranking as `SEMANTIC_TOP_M` candidates, and only then discards
the archived or superseded row — after it has spent the slot. Measured on the branch:
after a `supersede`, `store.nearestTo(v, 10)` returned the **dead row first of three**.
This is not a regression (master had it on both channels; this change is strictly better
on one) and it is reachable in production, not theoretical — the lagged worker
(`adapters/claude-code/vectors.ts` → `counterpart.ts` → `recall/session.ts`) is the door
the semantic channel reaches the owner's store through today. What is true, stated
narrowly: **nothing can be DELIVERED from a dead row, and its vector can still displace a
live neighbour from the semantic slate.**

**FOLLOW-UP, filed not built:** filter inside `Store.nearestTo` — over-fetch and drop the
non-live against box 2, the same shape the lexical half just got — and the same for
`nearestVectors`, which is the novelty context slice and shares the scan. Not done here
because it widens a core diff the night before a merge, and because it wants the
over-fetch factor measured rather than guessed.

**What it changes, arithmetically.** `storeSize` does not move, so `floorUnit` —
`informativeness(1, storeSize)` — is bit-identical at every size and **no floor and no
tier was retuned.** Only `df` moves, from `k + a` to `k`, where `k` is the live rows
holding the token and `a` the dead ones. Weight of that token, before → after:

| N | k live | a dead | before | after | Δ |
|---|---|---|---|---|---|
| 1 | 1 | 1 | 0 | 0.4055 | +0.4055 — the reported case; dark → cueable |
| 2 | 1 | 1 | 0 | 0.4055 | +0.4055 (journal + note, the note revised) |
| 2 | 2 | 1 | 0 | 0 | 0 — §12's "left alone" case, still left alone |
| 3 | 1 | 1 | 0.2231 | 0.6931 | +0.4700 |
| 100 | 1 | 1 | 3.2387 | 3.9220 | +0.6833 |
| 100 | 10 | 2 | 1.5404 | 1.7047 | +0.1643 |
| 14,000 | 1 | 1 | 8.1607 | 8.8537 | +0.6931 |
| 14,000 | 24 | 5 | 5.4884 | 5.6773 | +0.1889 |
| 14,000 | 574 | 10 | 2.5246 | 2.5412 | +0.0166 |

The shape: a rare token with one dead twin gains at most `log 2` ≈ 0.693 cue units at any
scale, and a common token barely moves. So the change is **largest exactly where the bug
bit** — the small store, the rare word, the revised memory — and is noise on the words that
span a 14,000-memory index. That is the opposite asymmetry from §12's bug, which grew with
the store.

**On the live store this MOVES OUTPUT, and by an amount this session cannot read.** `a` is
the number of archived-or-superseded rows still sitting in `doc_tokens`, and the owner's
store is off-limits here. It is not zero: the migration archives rows (`tools/migrate/
apply.ts`), sleep's dedup and prune archive, `schemas` fades, `self` regrows episodes.
`counterparts verify --dir <store>` now prints that population on its own line — *indexed
but not live (archived or superseded)* — so the owner reads `a` before deciding anything.
**Bench re-run: NEEDS-OWNER** — the #25/#28 bench needs a copy of the live store and cannot
be run from here, and unlike §12 this change cannot be argued bit-identical at N=14,000.

**The fix is PROSPECTIVE, so it ships with its own migration.** `archive` and `supersede`
keep the invariant from here on; the rows that went dark before this change are still in
the index. `rebuildCache` would clear them and drop every paid vector box 3 holds on the
way — ~13.9K on the owner's store, and master records that figure two ways (13,862 and
13,868), which is the claims auditor's to settle rather than this note's — and
`counterparts verify --rebuild` refuses outright while box 3 holds any, so a rebuild is not
a repair the owner of a real store can actually run. So the migration is
`Store.pruneDeadIndex()` / `counterparts verify --prune-index`: it diffs box 3's indexed
ids against box 2's live rows and deindexes the difference, touching no embedding. Same
shape and same reason as `backfillLengths`, which exists because the v2→v3 lengths were
derivable and a `resetCache` would have cost the vectors. It is NOT run at open — an
instrument writes nothing at open, and a write at open takes the write lock — so the owner
runs it by name, once.

**Left alone, deliberately, and with the reason corrected.** `embeddings`. A vector cost a
paid network call and box 3's float layout is being rewritten in the same night's work, so
`deindexDoc` drops tokens and lengths only. The reason first written here — "nothing reads
a dead row's vector" — was **wrong**, and the paragraph above records what the measurement
found instead. Two further tables this rule does not reach, both inert rather than wrong:
`ranking` keeps the dead row (keyed by id, read per-id by callers that already iterate live
rows), and `rebuildCache` does not carry a dead row's vector forward, because a rebuild
reproduces the live index — an archived row keeps its vector until the next rebuild.

**THREE index readers lose their archived hits**, and this is a real cost, not a rounding.

1. `cli/removal.ts`'s contamination scan (`store.search(body, 20)`). The removal probe's
   largest residue surface is unaffected — the archived VERSION files under `versions/`
   were never indexed at all — but a removed memory's archived sibling will no longer be
   listed as contamination. The honest repair is a residue scan that reads canonical prose
   rather than the recall index; filed, not worked around.
2. The dashboard's **search view** (`web/views.ts`). Note the seam this opens: the
   dashboard still reports *"archived: N — held, not gone"* from `store.list`, while its
   search box can no longer reach those rows. No UI control offers archived results, so
   the loss is silent rather than a lie — but the two panels now disagree about what
   "held" means, and that is worth one line of copy.
3. **`counterpart.ts`'s `updates:` content-match candidate source** — `store.search(query
   .content, query.limit)`, with no archived filter of its own in `remember/updates.ts`. A
   declared `updates:` can therefore no longer content-match an archived or superseded row.
   It cuts both ways and both ways are small: a plain ARCHIVED match was already a dead end
   (`revision.ts` refuses it as `target-archived`), so losing it is an improvement; a
   SUPERSEDED head used to `resolve` forward to its live successor, so a declaration that
   quoted the old wording was retargeted and now has to match the new wording instead. It
   is a live behaviour change on the REVISION path either way, and belongs inside the G12
   argument rather than beside it.

**Named, not fixed** (from the same review, none blocking): two predicates state one
invariant — `rebuildCache` reads `archived = 1 || superseded_by IS NOT NULL` while
`pruneDeadIndex` and `recall/index.ts` read `archived = 0` alone; equivalent today because
`supersede` writes both and nothing else writes either, but that is scar §2.6's shape and
wants one helper. `archive` now does box-3 work between the box-2 commit and its event, so
a throw in `deindexDoc` loses the `store.archive` event for a row that IS archived — the
house pattern from `put`/`supersede`, widened to a method that did not have it. And
`verify --rebuild --prune-index` together lets rebuild win silently where a one-line
refusal would be clearer.

## 14. A chapter is delivered, and says it is a chapter — 2026-09-04

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
grow a field — `surfaceSetHash()` is `800a9a9421cd969f` before and after. That hash covers
field NAMES only, so it is evidence that the record's SHAPE did not move and not evidence
that no value did: `bytes` moves on every turn that delivers a chapter, and `surfaced` /
`footnotes` move on a budget-tight one (see the delta at the end). The three doors:

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

**The wake has TWO doors, and the first draft of this note only found one.** The scanned
lanes come from `self/identity.ts#scanActive`, which lists `type: "memory"` and nothing
else, so a chapter cannot reach identity, craft, threads or hints however it is shaped —
identity band, promoted, `unresolved`, skill-kind, maximum salience. `test/self.test.ts`
builds one of each and asserts none arrives. That much was true, and it is the tripwire for
the day that one filter moves.

**The horizon lane is the other door, and it was OPEN.** Found by the adversarial review of
PR #70. `req.horizon` never goes through `scanActive`: `briefing.ts#selfRenderer` fills it
from `prospective.horizon()`, which walks `store.list({ archived: false })` — every row
type — and `derive()` excluded only `kind: "skill"`. So a chapter carrying a content date
rendered in the wake as a thing about to happen. Reproduced end to end, with `at` inside the
chapter's own window, on a hermetic store: `Arriving: - 2026-09-05 (of 2026-09-10) · ## the
lighthouse conversation`. It is reachable on the live store — 224 migrated episodes carry
`happenedOn` and `learnedOn`, are `kind: "self"`, and were given a claimed salience floor —
and #67's `repair-dates` would widen it.

**And the fix there is a FILTER, not a label**, which is the one place in this branch where
the ruling's "label, don't filter" does not apply: a chapter's date is the day it was
LIVED, so "Arriving" is a category error about it no matter what word sits in front of the
line. `DerivableMemory.journal` and a `"journal"` `DeriveReason` refuse it in the predicate
rather than at one caller — `derive` has seven call sites in `prospective/index.ts`, and a
filter at one of them is a rule that holds where somebody remembered it. Tested at the
predicate (`test/prospective.test.ts`, including the negative control: the same row with
the flag off IS prospective) and end to end through the real composition root
(`test/seams.test.ts`).

**Still open, filed rather than fixed.** `self/identity.ts#enumerate()` has no type filter
either. It is closed today only because no writer gives an episode the identity band or the
protected flag — which is a fact about the writers, not a property of the enumeration.

**The one value-level delta, named.** A labelled line is 9 bytes longer ("Journal: "), so a
turn that delivers a chapter AND lands within 9 bytes of `BUDGET_BYTES` trims one more item
than it used to. That is recorded in `trimmed` like any other trim. Measured on the
fixture: the same turn renders 225 bytes before and 234 after.

## 15. A second embedder, and what the shipped fusion does with it — 2026-09-23

The C1 trial ran recall end to end with a local static table (potion-base-8M) wired in
the embedder seat, on a seeded store, against lexical-only. Nothing in this module
changed. What it learned belongs here because the finding is about this module's
tunables: at the shipped `SEMANTIC_SEED_FLOOR`/`SEMANTIC_WEIGHT` the static channel is
**near-inert** — no delivery gained or lost on either path, though lexical items per
turn do move (2.90 → 2.80) — because its cosines rarely clear 0.45 and a scaled
contribution of at most 1.0 is small beside a rare cue's informativeness. The raw ranking
is good (paraphrase MRR 0.40 against lexical's 0.17). The two recall paths answer the
tunables differently — the deliberate path (the question's own vector) gains most and is
hurt by floor 0; the per-turn path (the lagged cue) gains less and is not. INTERFACE-GAPS
§8 carries both grids and the proposed shape (per-identity, per-path floor/weight, keyed
by the cache's new tag).

## 16. The retune: a floor and weight per embedder and per path — 2026-09-23 (night)

The static table became the primary embedder, and §15's finding — the shipped pair makes
it near-inert — became a table: `SEMANTIC_BY_IDENTITY`, keyed by the identity box 3
records, split by path. `activate` chooses by `recordedIdentity(store)` (the tag the
store's open reconciled) and by whether the semantic input is the caller's own `vector`
(inline — the deliberate MCP ask) or the worker's `hits` (lagged — the hook's per-turn
cue), and reports the choice on `ActivationResult.semantic`.

**What the measurement said, in one line each** (`docs/research/…`, "the retune"):

- The deliberate path wants a LOW floor and a HIGH weight (0.15 / 6): the ranking is of
  the question itself, so what a low floor adds is mostly the right memory — 11/30
  paraphrase targets against lexical-only's 6, nothing lost.
- The per-turn path wants a LOW weight (0.08 / 2): its cue may be about the previous
  subject, and the new topic-changing arm shows the weight is what pays for that — at
  weight 6 a changed topic loses its target and gathers ~4 stale items; at weight 2,
  nothing measurable on a topic change and 10/30 on topic (lexical-only ~8.5).
- An identity with no entry — static-retrieval, an unknown table, a store with no tag,
  Voyage — behaves exactly as before (the confirmation run's static-retrieval table row
  equals lexical-only; every existing recall test is unchanged).

**What was not changed:** `SEMANTIC_TOP_M` (8) stays global; the gate's bars and floors
stay as calibrated on the lexical channel; nothing in the decision record's hashed field
set moved (`ActivationResult` is not the decision record).


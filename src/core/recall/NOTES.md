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
records, split by path. `activate` chooses by `recordedIdentity(store)` — the file's tag,
read fresh (`Store.rankingIdentity()`) — and by whether the semantic input is the caller's
own `vector` (inline: the deliberate MCP ask) or the worker's `hits` (lagged: the hook's
per-turn cue), and reports the choice on `ActivationResult.semantic`; the recording path
puts it on the ring as `recall.semantic.tuning`.

**What the measurement said, in one line each** (`docs/research/…`, "the retune"):

- The deliberate path wants a LOW floor and a HIGH weight (0.15 / 6): the ranking is of
  the question itself, so what a low floor adds is mostly the right memory — 11/30
  paraphrase targets against lexical-only's 6, nothing lost.
- The per-turn path wants TODAY's weight with potion's floor (0.05 / 1): its cue may be
  about the previous subject, and the topic-changing arm shows the weight is what pays for
  that — at weight 6 a changed topic loses its target and gains ~26 stale items; at weight
  1, 9.8/30 on topic (lexical-only 8.4–9.0) for 1.2 stale items over 40 pairs.
- An identity with no entry — static-retrieval, an unknown table, a store with no tag,
  Voyage — behaves exactly as before (the confirmation run's static-retrieval table row
  equals lexical-only on every delivery; a Voyage-tagged store through `activate` is
  pinned equal to the defaults by a test).

**Two things the review taught** (and the fixes): a lagged row is never ranked, so a row
ranked under another model must be dropped where it is LOADED (`other-model`), not where
a ranking would have been refused; and an identity snapshot taken at open is wrong for a
handle whose open lost the lock, so the identity is read per activation.

**What was not changed:** `SEMANTIC_TOP_M` (8) stays global; the gate's bars and floors
stay as calibrated on the lexical channel; nothing in the decision record's hashed field
set moved (`ActivationResult` is not the decision record).


## 17. Mood-matching, and emotion reaching the turn gate — 2026-09-26 (emotion part A)

Owner decision 4 (2026-09-25/26): when a person's current feeling is known, memories that
carried a matching feeling for that same person come up more easily; the other person's
matching feeling gives a smaller lift. CONTRACT guarantee 18 states the rule; this is how
it was built and what was decided along the way.

- **Where it folds in.** Beside `gatedSal`, on the candidate's `sal` — the number the gate
  reads only after hard gate (a) (uncued is dark) and hard gate (b) (the absolute floor).
  `modulate` lowers the RELATIVE bar by `SAL_BAR_WEIGHT × 2 × lift`, so a fresh same-person
  match at strength 0.9 (lift 0.27) faces a bar ~27% lower; the cross-link at 0.1 moves it
  ~9%; the same match a month later (softened to ~0.22 of its strength) ~6%. In the two
  absolute regimes nothing moves. `activation` is never touched, so the candidate set is
  the same with and without a mood — `emotion.test.ts` builds the same turn with the mood
  switched off and compares every activation.
- **"Current" = recorded in the last 3 hours** of the STORE's clock (the clock `created_at`
  was stamped with; `Recall.now` is the latency clock and is not used), at strength 0.3 or
  more. Not "this session": feelings carry no session id and the table is not to change
  in this part, and a session that runs past three hours has usually moved on from how it
  started. One indexed query per turn; with no mood, nothing else is read.
- **A feeling inside the window is the mood, not a match.** Otherwise the note written five
  minutes ago matches its own feeling — and session dedup would not catch it, because it
  was never surfaced.
- **Blends match as both cores** (`coresOfFeeling`; by valence since the wheel v2, §23): tender (sad + happy) matches a sad mood
  and a happy one.
- **Per candidate: one batched read** (`Store.feelingsOn`), only for CUED candidates, only
  when there is a mood, inside the latency budget.
- **`moodMatched` joined the durable decision record** — how many admitted memories the mood
  had lifted. It moves the surface set (G15); the parallel run whose ratings that protected
  ended 2026-09-21, and the mechanisms views need a durable count to show the mechanism
  firing.
- **G10 and the affect flag read intensity.** When the turn carries first-person feeling,
  `gatedSal` reads the emotional dimension as the memory's intensity (the stronger of its
  score and its recorded feelings); otherwise 0, as before. The affect flag's "charged"
  test uses the same intensity against `AFFECT_MIN_EMOTION = 0.7`.

**Unmeasured.** Every mood tunable is a working default with a reason, not a measurement;
the recall bench has no feelings in it yet.

## 2026-09-26 — a cued use is organic

`resolveUse(…, { cued })` passes through to `store.reinforce`: a use of a loud candidate
recall surfaced on the turn's own cue (`reference.ts`'s `quoted`) is a RETURN even while
the memory is showing in the wake's hints lane (physics §5.11). An id the model expanded
may have been read off the wake, and there the display decides.


**Tightened after the review of #251 (2026-09-26, working default).** "On the turn's own
cue" is now literal. `resolveUse` passes `cued` on only when the gate state's `surfaced`
record for that memory is from THIS turn (`surfaced.turn === state.turn`).

Surfaced earlier in the session, the quote may have come off the wake, so the display
decides. The review saw a wake-shown memory, once surfaced by any cue, count every later
quote as a return.

## 18. Hops and the cut — 2026-09-28 (association build 1)

Working defaults, held lightly; the association side is `associate/NOTES.md` §13.

- **Hops are in neither half of `cueFraction`.** They sat in the denominator, which
  was meant to push a candidate away from the loud tier and could also take it away: a
  neighbour's contribution larger than a well-cued memory's own cue dropped it under
  `MIN_CUE_FRACTION` and footnoted it. A hop can now neither buy nor revoke the loud
  tier; gate (c) is decided by the conversation alone: `(cue + semantic) / (cue +
  semantic + arrival)`.
- **Salience ranks the cut.** The cut to `MAX_CANDIDATES` ranked on activation alone,
  before salience, feeling or mood touched anything — so a salient memory ranked 25th
  never met the lowered bar that would have let it in. The cut now ranks by activation
  over the gate's own bar factor (`salienceRank`: `1 − SAL_BAR_WEIGHT·(2·sal − 1)`,
  with the turn-gated emotional dimension), so it keeps what the relative bar would
  admit first — and only where the gate will modulate: on a cold-start store, or a turn
  whose cued sample (`cue + semantic > 0`, at most `maxCandidates`) is under
  `MIN_BACKGROUND_SAMPLE` or has no spread (sd 0), the bar is absolute, so the cut
  ranks by activation alone there (cold start stays stricter). Chosen over raising the cut because a bigger cut changes the turn's
  background (more weak candidates, lower bars) for every turn, while ranking changes
  only which 24 get there. Mood's lift is not in the key: it needs the feelings read,
  which stays after the cut. What the cut left out is counted (`dropped` on the
  decision and its durable row) — never a silent cut.
- **The decision record carries `spread`** — seeds, expanded, stop, depth, computed,
  and `landed` (on candidates the cut KEPT) — and `dropped`, both added to `RECALL_DECISION_FIELDS` the way `moodMatched`
  was (the parallel run that froze that list is over).

## 19. Links change what comes to mind — 2026-09-28 (association build 2)

Working defaults, held lightly; the association side is `associate/NOTES.md` §14.

- **Quiet pointers** (associate INTERFACE-GAPS §1, answer (b)). A memory only links
  reached may join the quiet tier: handed to the gate when what arrived is at least
  `LINK_POINTER_MIN_FRACTION` (0.05) of the strongest seed's activation, shown in slots
  of its own after the cued footnotes (`LINK_POINTERS_MAX`, 2), labelled `Linked:`,
  footnote tier only, behind confidentiality and dedup like anything else, and recorded with
  `via: "link"` on its verdict and in the session's gate state (the `surfaced` row's
  `value` column — no schema change). Its activation is what arrived. (The first build
  capped it at a quarter of the strongest seed; the review of #281, finding 4, found that
  the gate ranks and admits pointers by their anchored sum and never reads the capped
  number, so the cap bound nothing and was removed. A real bound, if live use shows a
  need, caps the anchored sum in the gate.) Hard gate (a) is CHECKED for this one lane
  rather than structural (CONTRACT §5 G5).
- **The anchor** (after the bench). A pointer is shown only when the activation that
  reached it FROM MEMORIES THE TURN SHOWS is at least that same fraction of the strongest
  shown memory's. The first rule, without it, showed 63 pointers over 40 bench turns and
  1 was relevant: most were carried by seeds the gate then turned away, so they sat in
  the render with nothing visible to complete. With the anchor: 32 over 20 turns, still
  1 relevant — **still noisy on that store**, whose links are demo links and whose labels
  are narrow phrase matches (a pointer to an associated but unlabelled memory counts as
  irrelevant). The pattern-completion fixture (a target sharing no words and no meaning
  with the query, reachable only through a link at 0.5 — about five co-uses — from a
  memory the query finds) recovered 6 of 6 in both the lexical and the semantic arm,
  with no one-co-use distractor and no other pointer riding along. Whether pointers earn
  their slot is measured live: `spread.pointersShown` on each `recall.decision`, and
  `pointersExpanded` on `recall.credit` (the pointers a reply went on to expand, which
  also credits them — a pointer `trains`). Doctor's Association line says both. The
  lever is on or off, not the number (review of #281, decision A): the fixture's link
  passes w/8 = 0.0625 of the strongest seed, so every fraction that keeps it (≤ 0.0625)
  keeps 22–32 bench pointers, and every one that cuts them much loses it; the bench's
  pointers are 8 hub memories (a self-belief cluster and three chapters) shown again and
  again. `LINK_POINTERS_MAX: 0` is a clean off switch. The owner decides on or off.
- **Seeds are the top `SPREAD_SEEDS`** (24) candidates, words and meaning, ranked the way
  the cut ranks them; a seed receives nothing, so hops lift only candidates past the
  seeds (associate NOTES §14 says why, and what it costs).
- **The hop ceiling.** A candidate's hop score is at most `HOP_CEILING` (1) × its own
  cue + semantic: however many paths reach it, links can at most double what the
  conversation gave it. It bound on about one modulated candidate in ten on the bench.
  `hopsCapped` is on the turn's `spread`.
- **The turn's `spread`** now also carries `linkOnly`, `pointerCandidates`,
  `pointersShown`, `pointersUnanchored`, `hopsCapped`, and `waiting` when the node
  budget bound — all inside the one `spread` field of `RECALL_DECISION_FIELDS`, so the
  field list did not move. Since the review of #281 (finding 5) the durable row's
  `footnotes` entries also carry `via: "link"` on a pointer, inside the existing
  arrays, so which footnote was one survives the gate state's pruning.

## 20. A memory's standing — 2026-09-29 (contradictions)

`standing.ts` turns the pair rows into a qualifier in front and a pointer after
(`Resolved.standing`), composed outside the clip so the budget never eats the part that
says a memory is not current. One indexed read per rendered id, memoised within a build
(the trim loop composes more than once). A pair closed through another (`via`) and a
withdrawn one say nothing. The corrected label is seen only by id: an archived memory
never surfaces. `deliberate.ts#expandHandle` shows a superseded row asked for by its own
id as itself, with `replaced by` — the display path only; `store.resolve` still forwards,
and a use of that row is not credited (the credit pass refuses archived rows).

## 21. A chapter and its copy, one result — 2026-09-30 (U13)

The U13 session saw every chapter twice in deliberate answers: the `epi_` row and the
untitled self-kind copy `self/` ingests from it, two of about eight slots in all six
questions. Lateral inhibition did not catch the pair because it runs only on ADMITTED
candidates; a pair below the turn's bar reached the deliberate dim tier as two rows, and a
titled chapter against an untitled copy can fall under `NEAR_DUPLICATE` anyway.

- **Where**: `activate.ts`, after scoring and before the cut — the step the ambient turn and
  the deliberate ask share, so the two agree and the freed slot goes to the next candidate.
  The gates are untouched. The link is read off box 2's own columns (`journalCopyOf`:
  `type: "memory"`, `source: "episode"`, `origin_ref`), so the scan pays no prose read.
- **Which row**: the chapter (the brief's working default: it has the title and the
  `Journal:` label). It is scored as the pair — the stronger half of cue, temporal and
  semantic, arrival from the chapter's own strength. A pointer never re-opens the pair.
  Flipping to the copy is one line in that block.
- **Credit**: `Recall.resolveUse` credits the chapter and then each live copy
  (`MemoryFilter.originRef`), same tier, same once-a-day rule per copy, the copy's own
  `trains` respected; a copy's `recall.credit` event carries `via: "chapter"`. The
  chapter's own credit is recorded and never acted on (it is outside decay); the copy's is
  the one that moves physics. SCOPED (review of #293, S4): only for a chapter this
  session's gate state holds — recall showed the pair. A chapter used off the wake or the
  `chapter` tool credits itself only, as before (forwarding those would make copies fade
  slower than they used to). A chapter read through the deliberate ask leaves no gate
  state, so its use credits the chapter only; a copy listed on its own there used to earn
  that use — the one place a copy now earns less.
- **The pair's other halves** (S1, S2): the higher salience of the two, either half's
  mood lift (the copy carries `proposal.salience` and most stamps), and the copy's links —
  a hop to the copy lands on the chapter, and the copy seeds the spread beside it, since
  existing edges point at the copy.
- **The dashboard**: its ask view had folded the pair the other way since round 3 (the
  memory, with a "from chapter …" link). It now receives the chapter alone and shows it as
  a journal row; `pages/memories/fold.js` still links a copy whose chapter was not shown.
  (2026-10-09: `fold.js` and `/api/chapters` are gone; facts mode folds the pair itself.)

## 22. Recall by feeling, deliberate only — 2026-09-30 (U13 items 1 and 2)

U13: asked by feeling, recall answered with plumbing. Stamps only reweighted what the words
had found (`gatedSal` needs `selfFelt`, `moodLift` needs a cue and a mood); nothing let a
stamp NOMINATE a memory, and "moved" could not reach a memory stamped `moved` whose text
never says it.

- **Read at question time, not indexed.** The stamps are not folded into `doc_tokens`:
  that needs a reindex on every `addFeelings`/`retractFeelings` and on rebuild, and would
  leave every stamp already on a live store unreachable until a cache rebuild — a
  backfill by another name. `Store.feelingsLive()` is one scan of a small table, the scan
  `mood.ts` already pays each turn; the deliberate path has a 15 s budget.
- **One lane for both items** (`feeling-ask.ts`, then `activate.ts`). Item 1 is the pool
  filter: a question word a stamp answers to (its emotion word, aliases pointing at it,
  wheel core(s) — a blend under both — and the writer's own word, the coordinator's
  addition: `unsettled`, `validated`, `wistful` kept as `other_word`) names a feeling.
  Item 2 is the ranking: the pool's strongest memories by softened strength, top six.
- **Detection, after the review of #293 (B2).** The first cut ranked on any feel-word or
  wheel word, and the wheel is full of everyday words (`open`, `happy`, `moved`,
  `critical`): "what is the happy path for the importer" put six stamped memories ahead
  of the answer, and their cue raised the gate's relative bar sevenfold, dropping every
  answer the words found a tier. Now ranking needs a feeling word used about a PERSON
  (the look-back of `detectAffect`, widened two words forward for "what moved me"; "we"
  counts only beside a feel-word, so "where we moved the parser" does not); a feeling
  word followed by a determiner is a verb on a thing and names nothing; a writer's own
  word answers only when it is one word ("at the edge of something" made "something" a
  feeling word). A feeling named about no one still nominates, as an ordinary cue.
- **Out of the background.** The stamps' cue is `Candidate.stamp`; `gate.ts` samples each
  candidate's activation WITHOUT it, and a candidate only stamps reached faces the whole
  sample's bar. On an ambient turn `stamp` is absent and the gate is byte-identical.
- **Whose.** First person is the asker — the counterpart in its own `recall` (said so in
  the tool's description), the owner at the console's `ask` (`DeliberateOptions.asker`) —
  EXCEPT the dashboard's Ask, which rewrites the owner's words into the counterpart's
  voice and so passes `--voiced` (asker `self`; review B1); `exact` keeps the owner's.
  Second person is the other one; the owner's names (`sleep#ownerNames`, injected through
  the turn: `recall/` imports no other core module) or "owner"/"user" the owner; "we", or
  nothing said, both.
- **Ranking.** The gate orders by activation and caps tiers (1 loud, 6 quiet, 5 dim), so
  the order is set in `deliberate.ts#answerQuestion`: vivid; the felt quiet rows, then
  the other quiet ones; the felt dim rows, then the other dim ones — felt rows by the
  softened strength that nominated them (the lane's order since §25), the rest of activation breaking a tie, exempt
  from the dim cap (review of #293, S3 and R2: the first cut put the felt rows above
  everything, and the second above the quiet tier, so a quiet text answer — the usual
  shape of a deliberate answer — landed seventh under six dim stamps).
- **The cut (R1).** The 24-candidate cut is taken over the rows the words and meaning
  reached, ranked WITHOUT their stamps, and every stamped row is appended after it, marked
  `pastCut` when only its stamp kept it, so the gate samples none of it. Before
  that, six nominations sat inside the cut, evicted six text rows, and moved the gate's
  background whenever the cut bound — which on a live store it always does.
- **Everyday phrasings (R3).** A feeling word followed by a possessive or "it"/"them" is
  a verb on a thing ("moved my parser", "I moved it to src"); a possessive near a feeling
  word is not a person feeling it ("is my build open", "my happy path test fails"); a
  feel-word followed by "like"/"that" is an opinion ("I feel like the test is flaky").
  `afraid` joined the wheel's aliases (→ `scared`).
- **Known limits.** "how does Katie feel about the move" names no person the store holds
  feelings for, so it ranks nothing. Wrong-core repairs kept the writer's word but not the
  core they named, and an alias kept the wheel word (`touched` → `moved`) — both answer
  through the alias table, not the original input. No stemming (a light one since §25).
  Item 3 (a feeling's journey over time) is still open. *(2026-10-09: item 3 is answered
  by meaning mode, #322, merged 2026-10-03, in 0.3.12 — outside this module, at the MCP
  layer (`mcp/meaning.ts`, mcp CONTRACT §6e): a person's, a project's or a feeling's
  chapters in time order, each with its feelings by whose, and page 1 keeps the turns
  where a feeling's valence changes sign.)*

## 23. The wheel v2 in recall — 2026-09-30

- **Mood-matching reads valence, not cores** (`mood.ts`). A person's mood is the
  valences of what was recorded for them in the window; a past feeling matches by
  `1 − |Δvalence| / MOOD_VALENCE_SPAN (0.5)` against the closest of them. Two things
  the core match got wrong: curious and confused (one core, opposite feelings) matched
  as one, and sad and uneasy (close feelings, two cores) never did. Blends no longer
  need special handling here. The weights are unchanged; it stays a light tie-breaker.
  The page's "so a low mood can't feed itself" is a rule here since the review of #301
  (M2): a low mood meeting a low feeling counts `MOOD_LOW_LOW_WEIGHT = 0.25` of its
  match. The faster softening of unpleasant feelings (physics `S_FEELING_NEGATIVE`)
  adds to it over time.
- **A stamp answers to its group's word too** (`feeling-ask.ts#feelingTokens`):
  "afraid" was an alias of scared on the first wheel and is scared's group now, so
  "when was I afraid" still reaches a memory stamped scared — as does a stamp of
  terrified or frightened. Every word a stamp answers to is ONE word: the wheel has
  phrases now ("caught out", "that's me", "at ease"), and "out" or "me" must not become
  feeling words for the whole store (the review of #293's B2 rule, applied to the
  wheel's own words).
- **Everyday words name a feeling only in a feeling's frame** (the review of #301, m1;
  `EVERYDAY_FEELING_WORDS`): close, content, settled, seen, caught, engaged, open,
  important, empty, sorry, familiar and a few more are read as a feeling only when a
  feel-word or a form of "to be" is one of the two words before ("felt close", "I was
  content", "am I sorry"). After "to be" only, a preposition next takes it back out —
  "are you close to done", "what was I engaged with", "is this familiar to you"; after
  a feel-word it stays ("felt close to Mike"). "I settled on the second option", "is my
  PR still open", "how close am I to finishing" no longer rank. A stamp still answers
  to the word.
  `dream/slices.ts` still counts these words as feeling words in a transcript (a light
  over-count of how "whole" a slice should come).
- **Sad's `wounded` group answers to "hurt"** (the page's name for it, `WheelEntry.label`):
  "when was I hurt" reaches stung and wounded as well as angry's hurt.
- **A mild positivity bias in the ranked lane, named** (m4): stamps rank by SOFTENED
  strength, and an unpleasant feeling softens faster, so among stamps of one recorded
  strength and age a pleasant one ranks higher as the weeks pass (at 30 days, 0.9
  frustrated reads ~0.13, 0.9 joyful ~0.28). That is the fading affect bias the
  softening was built for; a question that names the feeling ("when was I frustrated")
  pools only those stamps, so it decides nothing there.
  Since §25 a question that asks for the strongest or over all time ranks as recorded, so
  the bias applies only to an ordinary "when was I…".

**The lift, before and after M2** (fresh, strength 1, same person, `MOOD_SAME_WEIGHT` 0.3):

| mood → memory's feeling | before | after |
|---|---|---|
| sad −0.6 → lonely −0.6 | 0.30 | 0.075 |
| sad −0.6 → uneasy −0.5 / angry −0.7 | 0.24 | 0.06 |
| sad −0.6 → wistful −0.3 | 0.12 | 0.03 |
| sad −0.6 → calm, happy | 0 | 0 |
| confused −0.2 → bittersweet 0 | 0.18 | 0.18 |
| happy +0.7 → happy / warm | 0.30 | 0.30 |
| happy +0.7 → calm +0.5 | 0.18 | 0.18 |
| happy +0.7 → curious +0.3 | 0.06 | 0.06 |

## 24. A question about time, and where a result came from — 2026-09-30 (the continuity test)

Mike ended a ~/random session (an evening's notes and a chapter), opened a new one two
minutes later and asked "what do you remember from our most recent session?". The words
matched "session" and "recent" across every day in the store, the cap (24) filled with
other sessions' release work, and the evening never came back. With four or five sessions
at work that day, the new session also could not tell which result was whose. Brief:
`~/counterparts-notes/2026-09-30-continuity-brief.md`, items 3 and 4.

- **A cue, not a filter.** A person asks this plainly, so the plain question has to work;
  `recency-ask.ts` is a fixed phrase list plus a clock time, the shape of the feeling cues.
  An explicit `since`/`session` argument was not added: nothing yet asks for one.
- **In the adapter, beside the feeling lane's reordering, not in `activate.ts`.** The rows
  it adds are not candidates the search reached: they are what one session wrote, found
  by session (`origin_session`, a new `MemoryFilter.originSession` beside `originRef`)
  and by the session's directory (`coverage/#sessionsHere`). Putting them into activation
  would make them compete under a bar that is about words; leading the answer with them
  is what the question asked for. Activation, the gate and the decision record don't move.
- **Which session** (revised after the review of #302, MAJOR-2 and MINOR-2). The first
  round took the newest session with turn-ends here, which with several sessions live in
  one repo was often a sibling still at work rather than the one the person meant. Now:
  a named window ("this morning", "yesterday", "last night", "16:01–17:48", "at 4pm" as
  an hour either side) means the sessions here at work in it, by their `stop` turn-ends
  and pieces against the store's local clock; none at work then means no lead rather
  than a guess. Without a window, "the most recent session" is the one the wake's "Last
  here" line names, so the wake and recall agree; then the newest that ENDED (a
  `session-end`, or work that stopped before the asker's began); a live sibling last.
- **Lead or promote** (MINOR-1). Leading is right for "what do you remember from our most
  recent session?" and wrong for "the last time we used Postgres" or "what did we decide
  about the deploy today?", where the time words narrow a question about something else.
  The test is cheap: take out the cue, numbers and the words that ask nothing ("what did
  we do", "remember", "session"); if nothing is left, lead; if anything is, only the rows
  the search found too move up. The clock cue needs am/pm, "at" or a range, so "John
  3:16" is not a time.
- **Which rows.** What the session wrote in THIS directory (`origin_scope` when set),
  never a dream's or a reflection's (their `origin_session` is the session that launched
  the nightly run — MAJOR-1), never a replaced row; the chapter showed its LATEST chapter
  (MINOR-4) until 2026-10-01 and shows its FIRST since — or, for a named window, the first
  chapter dated inside it (`last-here.ts#chapterFor`) — and its copies leave the rest of
  the list (MINOR-5). Each row is read in its
  own try (MINOR-6).
- **Not with feeling** (MINOR-3). A ranked question about feeling (`feeling-ask.ts`,
  narrower since #301) keeps its strongest-stamp order and gets no recency lead; "how did
  I feel this evening" is answered by feeling. Chosen over ordering the lead by stamp:
  one lane deciding the order at a time is easier to read.
- **Provenance is a label** (`from`, CONTRACT §6c) read off the row. `origin_scope` was
  already set on memories; episodes now set it at birth too (`self/episodes.ts`, #300),
  so a chapter written before today says who and when but not where. A dream's or a
  reflection's row says what made it.
- **Not built:** recency for the console's `ask` (it has no directory), and provenance on
  the ambient footnotes (a footnote is a title; the brief asked for recall results).

## 24. A note from before the server knew its session (2026-09-30, the 0.3.10 release check)

In Claude Code the memory server learns its session only at the first `chapter` or
`session_end` (the lazy bind). Until then a `note` is filed under the one id every unbound
server shares (`types.ts#UNBOUND_SESSION`, "mcp"), and a recall's reader is that id too.
§23's `from` and the recency lead took it for a session: before the bind every such note,
any session's, read `from: "this session, …"`; after it, `"session mcp, …"`; and the lead,
gathering rows by `origin_session`, left out every note a session wrote before it bound
(on the throwaway check, all eleven of A's). The live store had 46 of ~430 authored
memories under the id.

- **In words it is nobody** (`handoff#sessionWords`): "a session that hadn't been
  identified yet", with the directory and the time; never "this session", whoever asks. A
  reader that is the unbound id owns no row. `coverage#sessionsHere` names no such session,
  and `chaptersBySession` skips the id (a chapter always binds, so that is a guard).
- **The lead takes them back when they can be no one else's** (`deliberate#preBindNotes`):
  written in THIS directory, inside the stretch the session was at work here (its turn-ends
  and held pieces), at a moment no other session — the asker included — was at work here.
  Two sessions side by side share the stretch, so neither gets the note; it is ranked as
  before. The label still says "not yet identified": the lead's reason is the window, not
  the row.
- **Not built:** nothing is backfilled onto the rows (the window could stamp them at the
  bind, but an inference written down reads later as a fact). Since 2026-10-01 (§26) a new
  note is filed under its session at write time, and an older one reads as placed by time.
  An unbound asker cannot tell its own live session from a sibling's; the lead already prefers the one Last here names.

## 25. Recall by feeling, round 2 — 2026-10-01 (lane 6)

Seen live on 0.3.10: "when was I afraid" came back thin (no stamp of the afraid group, 18 of
the uneasy core); "when did I feel ashamed or caught out" missed while the same question with
"uneasy" hit; "what have I felt most strongly" favoured the latest day (softened ranking, and
half the stamps were from one day); and feeling questions pulled in memories ABOUT the
feeling system — the wheel, the cores, the emotion research — because their words are the
question's.

- **Tiered matching** (`feeling-ask.ts#readFeelingAsk` → `FeelingAsk.cores`, `activate.ts`).
  Tier 1 is what the stamp answers to, as before (its word, group, label, aliases, cores, the
  writer's own word). Tier 2, on a RANKED ask only, is a stamp under a named word's HOME core
  (and a blend's second). Group words stay tier 1: "afraid" reaching scared is §23's rule and
  the asker named the group. A named-only ask ("the happy path") gets no tier 2: an ordinary
  cue does not widen to a core.
- **"An exact stamp still leads"** is held by the cue, not by re-ordering across the gate's
  tiers: a tier-2 nomination brings no more cue than the weakest tier-1 one, so it can sit in
  a higher gate tier only by its own words. Within a tier the lane's order (tier, strength,
  newer stamp) decides.
- **Reading a word.** An `other` whose own word is on the wheel ("sheepish" kept as the
  writer's word, which the v11 upgrade left as `other`) now reads as that word: its group,
  its home core. Wheel phrases are matched whole ("caught out" as two words in a row, before
  the everyday-frame rule could eat "caught"), and only with a person as its subject — right
  before it, or through a feel-word or "to be" ("I was caught out", "felt let down"), or
  joined to a feeling word ("ashamed or caught out"), and never with a preposition after it
  ("where I caught out of range errors" is not one). A stamp answers to the phrase as one token with a space, which no single question
  word can equal, so "out" is still nothing. `EVERYDAY_TO_WHEEL` is question-side only and
  small; it leaves out words a question often uses about a thing or a name (panic, hope,
  love, worry, pleased, joy, pride, curiosity — the B2 scar). The stemmer tries
  -iest/-ier/-iness/-ness/-est/-er and accepts only a stem in `STEMMABLE` (happy, sad,
  angry, lonely, proud…): "opener", "warmer", "closer" are about things. An everyday word or
  a stem names a feeling only in a feeling's frame — a feel-word in the question, or "to be"
  among the two words before ("when was I stressed", not "the endpoints I stressed"). A word
  the asker capitalised mid-sentence is a name, never a feeling ("a person named Joy") —
  unless it is on the wheel.
  The owner's name in the possessive is the owner only when it was written with an
  apostrophe ("Mike's", "James'"): "bills" and "marks" are never Bill or Mark. Beside a
  non-feel word it is a possessive, as "my" is.
- **Strongest** (`FeelingAsk.strongest`): a superlative feeling word ("happiest"), or most,
  ever, strongest, strongly, since, always, deepest, biggest, hardest, worst within two
  words of a feel-word or a feeling word ("felt most strongly", "what moved me most") — and
  never when the question says recent, recently, lately, latest, last, today, yesterday,
  tonight or now ("what have I felt most recently", "the most recent release"). Then the
  stamps rank by recorded strength, the newer stamp breaking a tie; otherwise softened, as
  before.
- **Item 3 — chosen rule: structural, not a topic list.** On a ranked ask, a row the stamps
  did not nominate and that no TOPIC word reached (`FeelingLane.noTopic`) is answered after
  every stamped row, whatever its gate tier, and before the plain dim rows. A topic word is
  a cue token with weight that is not a feel-word, a feeling word, a "most/strongly" word,
  a person word or a question-frame word (`QUESTION_FRAME`: wh-words, auxiliaries,
  determiners, prepositions, "times") — the cue channel has no stop list, so on a small
  store "when" alone would count. A word the asker capitalised mid-sentence is always a
  topic (`askedNames`; review of #310, where "how did I feel about Will" had put the Will
  memory fifth), so lower-case will, may, can and do stay function words; it, done and id
  are left out (IT, a to-do, a memory id). A wheel word is never a capitalised name ("when
  was I Sad", "I felt Sad"), and a question typed all in capitals names nothing (second
  review of #310). A row the calendar reached
  keeps its place. A memory with
  a stamp the question did not nominate counts as unstamped here. No blacklist of
  feeling-system memories: one asked about by a topic word ("what did we decide about the
  wheel") is answered as before.
- **Measured** on a copy of the 2026-10-01 snapshot (titles only, on the lane's PR): "when
  was I afraid" went from no stamped nomination (two text matches about fear and the cores
  first) to 6 uneasy-core rows first; "ashamed or caught out" from four dim chapters to 6
  rows stamped sheepish (the phrase's group); the Katie and yesterday controls identical row
  for row.
- **Known limits.** Tier 2 is topic-blind like the every-stamp pool: "how I'd treated Mike"
  nominates the strongest uneasy stamps whether or not they are about Mike, and the rows the
  words found follow them in each tier (§22's R2 order). "times I felt moved or sad": the
  quiet decoy that once led now follows the stamped rows (its words were all frame and
  feeling words).

## 26. Provenance at write time, and placed by time for the rows before (2026-10-01)

An inside view of 0.3.10 found most of a day's memories in one directory saying "a session
that hadn't been identified yet", even inside a recent block the lead had attributed to one
session.

- **At write time, by process** (`sessions.ts#sessionOfHost`, `server.ts#hostSession`). The
  host that launched the memory server is the parent of the hook that opened the session:
  the server records it as `hostPid` at launch, the hook as `opened.hookPpid`. One live
  record in this scope with that pid is the server's session, and a `note` (and a
  `recall`'s reader) before any claim uses it. EXACT OR NOTHING: no match (a host that runs
  its hooks through a shell that does not `exec`), or two live ones, leaves the note
  unbound as before. NOT A BIND: nothing is frozen for the process, so a `/clear` in the
  same host is found afresh, and `chapter` / `session_end` bind by claim as they did.
  Claude Desktop is excluded (one server serves every chat; it binds per call). Review of
  #311 added two conditions: the server's environment is Claude Code's
  (`hosts.ts#claudeCodeEnvMarker`), and the record OPENED (its `opened.at`, stamped at
  startup, resume, clear and fork) no earlier than `HOST_MATCH_SLACK_MS` before the server
  launched — so a crashed host's pid, reused by a stranger, matches nothing, and a record
  with no stamp time (an older build's) matches nothing either.
- **The rows before, placed by time** (`provenanceOf`'s `spans`): an unbound note inside
  exactly one session's stretch in its directory — §24's rule — reads "session a1b2c3d4
  (placed by when it was written)". Nothing is written back. The registry's `startedAt` is
  not a stretch (#307's reverted attempt: an idle tab opened early covered a sibling's
  note), so a first turn's note, before the session's first turn-end, stays unidentified
  on an old row; the write-time match is what fixes that going forward.

## 27. An alias in a question reads as its wheel word (2026-10-02, lane B)

- `feelingWord` reads a wheel ALIAS as the word it stands for, and the question keeps the
  word asked too: "fear" names `afraid`, so "when did the owner feel fear?" reaches a stamp
  of scared or frightened (they answer to their group's word), not only an `afraid` stamp
  — the 0.3.10 release check's follow-up. The same for thankful → grateful, touched →
  moved, anger → angry. No frame is needed, as for any wheel word.


## Confidentiality, frozen (2026-10-02, owner)

The confidential class (`store/index.ts#confidentialByMeta`, CONTRACT §9) has no way in. No tool or entrance marks a memory confidential. Only a dream or reflection inheriting it from a source that is already confidential sets it. The owner's live store held 0 of 823 on 2026-10-02. The owner's ruling: freeze it. Keep the gates as they are, add no new plumbing for it, and don't treat it as a reason to block a review. The plan is to review it and remove it later. Privacy that matters is handled elsewhere today: directories opted out of Counterparts entirely, and the gate battery's credential redaction.

## 28. Shown, and not used (2026-10-09)

Recall predicts on every turn that what it shows will help the reply, and a miss left no
record per memory: the `recall.credit` row named what was credited (`ids`) and expanded
(`expandedIds`), not what was quoted but refused, or shown and ignored. The association
diagnosis of 10-02 could say the Hebbian path was nearly dark (`quoted` 0 and `expanded`
62 over the store's whole life), but not for which memories or which lane.

- **What is scored.** `Counterpart#creditReferences` takes every memory the session's gate
  state records as shown (loud, footnoted, or footnoted as a quiet pointer) after the
  session's `judged` mark. One is used when a reply this boundary expanded or quoted it:
  the resolver's uses before any refusal, because the prediction is "this will help",
  not "this will earn credit". The rest are shown and not used. The mark then moves to the
  session's newest recall turn, so each showing is scored once.
- **The mark** is its own gate kind (`judged`, ref `credit`, `session.ts`), written only by
  the credit pass. `setGateRecords` upserts row by row, so recall's save, which names its
  own rows, cannot drop it; `loadGateState` skips it as it skips `asked`. Not written
  under observer.
- **The row** carries `shownLoud`, `shownFootnotes`, `shownPointers`, `unusedLoud`,
  `unusedFootnotes`, `unusedPointers`, `shownNotUsed` (up to 64 ids, oldest showing first),
  `shownNotUsedTotal` and `judgedThrough`. Footnotes are the cued ones; a pointer counts
  as a pointer only. `probe-oq4` sums the lanes into a hit rate over the rows that carry
  them. The per-memory read is `probe.ts#probeMemoryHits` (2026-10-10, Hawkins 2a, Mike
  asked): `shownNotUsed` joined to the session's `recall.decision` rows, per memory and
  per lane, a memory in a session as the unit. A session with no scoring row, or whose
  list was cut at 64, is left out and counted rather than read as hits, and so is a
  showing past the session's highest `judgedThrough` (`unjudgedShowings`: its reply not
  read yet; review of #373). No CLI, dashboard
  or doctor reads it yet. Lightly held (b2+f8): ignoring is measured first; if anything
  acts on it later it lowers how readily a memory surfaces, not its strength. Decide
  after the ~10-14 check-in.
- **Measurement only.** No strength, threshold or ranking reads it.
- *Choices and residuals:*
  - A showing is scored at the first boundary after it. One opened at a later boundary is
    counted once as not used (its own) and once as used (the later row's `expandedIds`):
    the score is of the reply it was shown for.
  - A boundary whose slice holds no reply and no expansion scores nothing and leaves the
    mark (review of #329): a capture that failed or found nothing new is not a reply
    that ignored what it was shown. Its showings wait for the next boundary that read a
    reply.
  - A session already open when this build arrived has no mark, so its first boundary
    scores everything that session showed (at most `MAX_SESSION_RECORDS`, at most 64 ids
    on the row). One over-count, toward more misses.
  - A mark that cannot be read scores from the session's start; one that cannot be
    written is scored again next time. Both over-count misses, never under-count.
  - On a `budget-exceeded` row a quote may have gone unchecked; a reader should leave
    those rows out.
  - After a gate reset (`recall.gate.reset`, an unreadable scalar row) the session's turn
    count starts again at 1 while the mark may sit higher, so its showings go unscored
    until the turns pass the mark: left out of the rate, not counted as hits. Rare, and
    the reset is evented.
  - A footnote can be used only by an expansion: it showed a title, and a title is not
    quotable (§9.2). The lane split keeps that from reading as a worse prediction.
  - Ambient recall only. A deliberate answer's memories (`asked`) are not in the gate
    state's `surfaced`, and are not scored.
  - Recorded only where the credit pass runs (INTERFACE-GAPS §9).

## 29. Below reach (2026-10-10, Group 1, g1a — kept minimal in this module)

Physics now has a line under which a memory is out of the working layer (`REACH = 0.15`,
review 03 C2). Ambient recall leaves it out:

- `activate()` takes `includeBelowReach` (absent on the ambient turn, its only caller; a turn
  with `feeling` set counts as deliberate). On an ambient turn the token top-K and the inline
  semantic top-K are PREFILTERED on box 3's ranking (`Store#search` / `nearestTo`'s
  `minStrength`, `cache.ts#reachJoin`), so a faded row takes no slot, and `recallable`
  RECHECKS the exact strength, which also covers spreading's landings and the temporal cue.
  `ActivationResult.belowReach` counts what the recheck left out (reported, not recorded).
  The lagged semantic cue (`Counterpart#noteSessionSemantic`) is prefiltered the same way.
- Outside reach altogether: chapters, their copies, handoffs, entity cards
  (`store/operational.ts#reachExempt`); the identity band is never below it.
- **Stale by one pass, named:** a memory revived since the last decay pass (a use, an open)
  still reads below reach in the prefilter until the next pass; the exact recheck passes it,
  but the top-K never offered it. Deliberate recall, which does not prefilter, finds it.
- `gatedSal` (G10): `sal()` lost its emotional dimension, so a felt turn adds `EMO_LIFT × I`
  (`salArm`), an unfelt one reads `sal()`.
- Softening reads `feelings.recorded_day` (`feltDay`), store v13.
- Untouched on purpose: the credit tiers and `resolveUse` (Group 1b), the mood weights (1c).

## 2026-10-10 — near-universal cue words are not looked up (Lane 0, scale review C4)

`activate` fetched every cue's postings, and a word in almost every memory has postings the
size of the store: the review measured `searchIndex` at 52% of a turn at 10x. A cue whose
`informativeness(df, storeSize)` is under `CUE_FETCH_MIN_IDF` (0.1 — a word in more than
~80% of memories) can stay a cue and fetch nothing; `ActivationResult.unfetched` counts
them (not a `RecallDecision` field, for `capped`'s reason). **It ships off (0).** Its own
evidence is a few percent of one rare word's, but its postings (up to `PER_CUE_FETCH`
near-zero candidates) were the gate's background: without them a thin turn drops from the
relative bar to the absolute one (`gate.ts#background`, `MIN_BACKGROUND_SAMPLE`). Measured
by the review of #368: a 40-memory store, "the garden tomatoes", 2 footnotes → 0; a prose
corpus with 4-word prompts, 5 of 120 turns showed fewer at 150 memories and 2 of 120 changed
at 400; sentence-length prompts, none. Re-enable after a recall-bench run on a store copy,
with a minimum store size. `storeSize` is `countMemories` now, not
the length of a list of every live id (16% of a 10x turn). Not done here, from the same
finding: persisting the alias index and indexing `feelings(created_at)` (a canonical index —
Group 1).

## 30. Mood weights to 0 (2026-10-10, review 02 C3)

`MOOD_SAME_WEIGHT` and `MOOD_CROSS_WEIGHT` are 0. Decided by b2+f8, 2026-10-10, lightly
held. Evidence from the old use metric (lifted memories used 1.3% vs 2.4%); re-test after
Group 1's engaged credit gives a real signal. The code in `mood.ts` is kept whole and its
tests run it at the old weights; with both at 0, `Recall#build` skips `currentMood` (the
per-turn `feelings` scan with no index on `created_at`).

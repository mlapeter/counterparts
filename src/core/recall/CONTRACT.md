# `recall/` — CONTRACT

*This contract guides the work; it doesn't limit it. Anything here, RESOLVED items included, can be raised for discussion at any time and revised when there's a better way (constitution line 13).*

## 1. Purpose

Let the right past arrive on its own, ignorably: cues → activation → a surfacing gate →
bounded injection, plus the explicit ask, plus noticing afterwards whether a surfaced memory
was actually used.

## 2. Brain analog

Cue-driven spreading activation with a relevance gate, and behavioral-relevance tagging
afterwards. **Named deviations** (constitution line 12): (a) surfacing is judged **relative
to this turn's own background distribution**, not against an absolute threshold — *where a
design wants `if x > threshold`, suspect a flattened gradient*; (b) only a retrieval the
reply actually used reconsolidates, where in humans every retrieval does.

## 3. Keeps

- **Three tiers, ascending in intrusiveness**: an affect flag (content-free — no ids, no
  bodies, no feeling named); footnotes (pointers with short titles, **never bodies**); and
  rarely a surfaced gist. A quiet turn renders **the empty string**, not an empty block.
  [v1 §9]
- **No generative model call on the hot path.** [v1 §9 G1] Precise v2 form, per the harvest's
  own correction: the ambient path may consult an **embedding** model, never a generative
  one, and must degrade to lexical-only rather than fail (Appendix A #12 — v1's "no second
  LLM call" was true of generation and silent about embeddings). **And it consults that
  embedding without calling anything**: the ambient turn's semantic input is COMPUTED ONE
  TURN EARLIER, off this path entirely (open question 2, answered — see §5 G17).
- **Hard latency budget, silent abort, zero side effects on loss** — the pass *builds* its
  decision and a separate step *records* it; on timeout nothing is injected, buffered,
  logged, or spent. *A slow subconscious is worse than a quiet one.* [v1 §9 G2]
- **Host boilerplate is stripped before cue extraction and before embedding** — measured: an
  image placeholder token surfaced an unrelated image-cache memory. [v1 §9 G3]
- **Cue matching is word-bounded and rarity-weighted**; informativeness weighting replaces
  stop-lists — **and rarity is COUNTED, not inferred from a bounded top-K.** The pass read
  `df` off the LENGTH of its own `PER_CUE_FETCH` result, which is `min(trueDf, K)`, so the
  rule held on a fixture (where `trueDf` cannot reach `K`) and switched itself off as the
  store grew: MEASURED 2026-09-04 on a 15,421-document index, `conversation` (df 574) and
  `chat` (df 444) both drew informativeness **5.70** against a ceiling of 8.95, where their
  true frequencies put them at 2.6 and 2.9. `Store.docFrequency` counts, in one grouped
  query (8-36 ms cold, 2-4 ms warm for 72 tokens) — paid for several times over by asking
  rarity FIRST and probing the index only for the tokens that became cues. [v1 §9 G4]
  - **Amendment, 2026-10-19 — AN EXPERIMENT (Mike's word; check ~10-22, revert by 11-02):
    trying rarity scaled by how everyday a word is in English, and stemmed words, to see
    whether first prompts surface what they are about.** "Informativeness replaces
    stop-lists" is revised, not deleted. Rarity is still counted in this store; it is now
    multiplied by `everydayFactor` — the embedder table's own row weight for the word
    (`Store.wordNorm`; potion-base-8M only, the table it is calibrated on), 0 at or below
    `EVERYDAY_NORM_LOW`, 1 at or above `EVERYDAY_NORM_HIGH`, a smoothstep between. Why: the
    store's memories are third-person summaries, so question words ("you", "inviting",
    "colleagues", "suggest") were as rare in them as the topic word, and a memory sharing two
    of them beat every memory sharing only "bake" (first-prompt recall diagnosis, Bug 2). No
    word is named and none is banned outright by a list; a word the table holds only in
    pieces, or any word with no table (observer, embedder off), keeps its full weight. And
    words that share a stem are ONE cue (`CueInput.term`, `Cue.forms`): the index is stemmed
    since cache v7 (store CONTRACT §4). Facts mode reads both the same way. To undo the
    discount: set `EVERYDAY_NORM_HIGH <= EVERYDAY_NORM_LOW`. To undo stemming: another cache
    bump whose worker step re-indexes from prose (a revert is not free; store CONTRACT §4).
- **…and the same rule holds on the DOCUMENT side: a cue's evidence for a memory does not
  scale with how long the memory is.** Informativeness says a token spanning the whole store
  is evidence of nothing; a memory spanning every topic is likewise specific evidence for
  none. Mechanized as BM25 length normalization in the token index — applied *before* the
  index's own `ORDER BY … LIMIT`, so the candidate SET is chosen length-fairly and not only
  re-ranked — plus a per-document ceiling at a multiple of that document's own strongest
  cue. The length factor is CLAMPED at 1 — a long document is penalized, a short one is
  never rewarded — so no score exceeds what it was before normalization and the inherited
  absolute floors keep their meaning. **This is a v2 addition, not a v1 port**: v1's cue
  channel matched curated entity aliases, where length could not accumulate, and it capped a
  node's total alias contribution absolutely (`entityCueCap`) for the same reason the ceiling
  exists here. MEASURED 2026-09-04 — see `tunables.ts` (`CUE_LENGTH_NORM`,
  `CUE_TF_SATURATION`, `CUE_LENGTH_ONE_SIDED`, `CUE_DOC_CAP`) and `tools/recall-bench` for
  the 23-cell sweep behind the values.
- **Ambiguous handles fire at reduced weight and train nothing** — and the training half must
  actually be enforced, not just documented (scar §2.6: v1 documented this in three places,
  enforced it in one, and a repo-wide grep found zero consumers). [v1 §9 G5]
- **Salience lowers the bar but never bypasses relevance**, via three hard gates salience
  cannot touch: an **uncued memory is dark** whatever its salience; an **absolute floor** is
  checked before any salience adjustment; the loud tier requires a **minimum fraction of
  activation from cues**. [v1 §9 G7]
- **Ordering and admission use deliberately different keys** — salience blends into the
  surfaced *pick* only; admission, inhibition, and the footnote tier stay pure activation,
  preserving the footnote tier as the **recency discovery channel**. [v1 §9 G8,
  earned-mechanism #19]
- **Single-channel cues are tier-capped**: *arrival makes a memory warm; only relevance makes
  it loud.* [v1 §9 G9]
- **Emotion is turn-gated, and that gate is the safety property** — a high-salience wound
  must not light up every turn. [v1 §9 G10]
- **The affect flag and the retrieval cue have different subject rules**: the flag is
  subject-inclusive; the *cue* is first-person only, guarding against mood-congruent
  overgeneralization. [v1 §9 G11]
- **The absolute floors are in the model's own unit: one maximally-rare cue.** A floor of
  `4.5` means *four and a half maximally-rare cues' worth of evidence* — the same sentence on
  a seventeen-memory store as on a fifteen-thousand-memory one (`gate.ts#floorUnit`,
  `informativeness(1, storeSize)`). This is what the loud tier's rarity rests on, and it is a
  v2 addition: v1's floors were absolute numbers on a normalized 0-1 cosine, and carried into
  a SUM of `idf x evidence` they could not fire at any scale anyone measured (§7 OQ5). ACT-R's
  retrieval threshold τ, restored to the model's units.
- **Per-kind floors are a MECHANISM, not a shape** — v1 measured one (person activation peaked
  near 0.79 where craft material floored at 1.0) and v2's corpus refuses it: over 312 candidate
  rows from 13 real prompts, p50 runs 1.21-1.45 and p90 1.93-2.79 across `fact`, `person`,
  `self`, `skill` and `entity` — one distribution, not five, because v2's activation is
  cue-driven and kind-agnostic. So the override table ships EMPTY (scar §2.8: measured or
  disabled) and a kind that earns an override still gets one. The *background statistic* stays
  global. [v1 §9 G12, re-earned 2026-09-04]
- **Cold start is stricter, not looser** — below a minimum store size the variance estimate is
  meaningless, and small stores over-surface. In the same cue units, at twice the ordinary
  floor, so "stricter" is arithmetic rather than a comment. [v1 §9 G13]
- **Lateral inhibition with a query-aware relaxation**, and a suppressed candidate may reclaim
  a slot only as competition, never as un-inhibition. **An empty slot stays quiet.**
  [v1 §9 G14–G15]
- **Hard caps on volume, and the tiers are disjoint** — a memory is "came to mind" *or*
  "quietly available", never both. [v1 §9 G16]
- **Deliberate recall is not this module's ranking any more** (2026-10-03, Release B): a
  question asked on purpose is answered by `mcp/facts.ts` or `mcp/meaning.ts`, each its own
  path, and neither calls `build()`. The reason the old rule gave still stands — the ambient
  seed floor is the right bar for surfacing uninvited and the wrong bar for a question
  someone asked (measured: five on-point traces, best similarity 0.366, zero surfaced) — so
  the answer is now every match, not the ambient pool re-tiered. **A search is not
  recording**: it trains nothing; opening or quoting credits at the boundary. [v1 §9.1]
- **A candidate count must not become an undercount** — a top-K tuned for surfacing is wrong
  for an aggregation question. [v1 §9.1 G3]
- **Reference resolution reads the assistant's turns only, uses no model and no file reads,
  and its bar is precision over recall** — a false "used" pollutes learning permanently while
  a miss merely leaves weak credit. [v1 §9.2] **Built 2026-09-14 (`reference.ts`, wired at
  the session-ending boundary by the claude-code adapter), under the owner's rule of the same
  day: a memory is credited when the assistant EXPANDED it through deliberate recall (`ids`
  or `handle` on the tool call — the call is an assistant turn; ids are never parsed out of
  prose) or QUOTED it at content level (eight consecutive words of the body, verbatim, in one
  assistant turn; only a memory that surfaced LOUD is quotable, since a footnote showed the
  model nothing but a title). Never for being named, surfaced, footnoted, or rendered in a
  wake; the `surfaced` and `footnoted` use tiers stay unused by this consumer. Agreement is
  not judged: a memory expanded and then argued with is credited. One durable row per
  boundary, `recall.credit`, with a `reason` readers split on.** *Since 2026-10-09 that row
  also scores what ambient recall showed since the session's last scored boundary: by
  lane, how many a reply expanded or quoted and which it did not (NOTES §28). Measurement
  only; nothing trains on a miss.*
  **A third door, 2026-10-11: `drewOn`, by the session's own word.** *Built by the drewOn
  builder, 2026-10-11, from Mike's 10-10 direction, lightly held; the successor to #371's
  matcher, parked at hand-read precision 0.17–0.33.* `session_end` and `chapter` take
  optional `drewOn` ids, and each is credited at the `engaged` tier (half a use, half a
  return, no core-lane day; physics §5.5 — since 2026-10-19, an experiment, a full use
  with an awake return) by `Counterpart#creditDrewOn`. No matcher guesses:
  the 09-14 rule against crediting a name in prose stands. **The one guard: only an id this
  session was SHOWN counts** — its gate state's `surfaced` records (footnotes, loud, quiet
  pointers) and its `asked` records (a deliberate answer's results). Anything else is
  refused `not-shown`. The wake is not in that record, so a wake line is credited by
  opening it. Then refused by name: an unknown id, an archived row, a handoff, a superseded
  memory, one faded under a newer one. At most `DREW_ON_MAX_PER_BOUNDARY` (3) land per
  boundary — one recall turn, both tools together — the first in the order given, the rest
  `capped`. Each tool call that names any writes its own `recall.credit` row (`source:
  "drewOn"`, `via` the tool), and every credit row carries `how`, aligned with `ids`:
  `expanded` / `quoted` / `drewOn`.
  **Ratings, 2026-10-14: not a door — a record.** *Mike's call, tracking only, lightly
  held.* `session_end` takes optional `rated: [{id, score}]`, score 0–3 (noise / on topic,
  not needed / useful background / changed what I did or said; `rated.ts`). Rateable: what
  the session was shown — `surfaced`, `asked`, and what the tools handed it (`opened`).
  Anything else is refused `not-shown`; a bad score or missing id by name; the last score
  for an id counts. `Counterpart#rateShown` writes one `recall.rated` row and **moves
  nothing**: no strength, ranking, credit, decay, link or judged mark. Read by
  `probe.ts#probeRatings` (`counterparts probe-oq4`). How the signal is used is decided later.
  *Amended 2026-10-19 — an experiment, not a ruling (the feedback loop; Mike: "err on too
  strong, so we can see what it looks like when it's actually happening"; check on ~10-22;
  revert by reverting the PR).* Trying the ratings as a door, to see whether the day starts
  teaching the system: over the stretch since the session's previous rating row, each
  rating is a use at its tier through `resolveUse` (0 none, 1 `ontopic`, 2 `useful`, 3
  `referenced`; physics §5.5), and each ambient showing in the stretch left unrated a
  glimpse (`shown`). Only for a memory that may be credited (`creditDrewOn`'s row checks:
  not unknown, archived, a handoff, superseded or faded under a newer one); a rating of
  such a memory is still recorded. Co-used memories are linked (associate G1). And a
  memory rated 0 in `HABITUATION_MIN_SESSIONS` (2) sessions within
  `HABITUATION_WINDOW_DAYS` (7) lived days is HABITUATED: the gate raises the bar it faces
  by `HABITUATION_BAR_LIFT` (×1.5), after the floor, in both tiers, until those ratings age
  out or a later rating of 2 or more clears them (`habituation.ts`). A penalty on its
  chance to show, never on its strength; never a veto; quiet pointers and deliberate
  questions untouched. The count is read from a derived note in box 3, rebuilt from the
  `recall.rated` rows whenever it is behind them. The rating row now also records what its
  call credited and linked.
- **Framing is load-bearing and part of the spec** — footnotes are pointers, and the "quietly
  available / ignorable" phrasing is a deliberate probe question, at step 1 since 2026-09-14
  (§7 OQ4). [v1 §9 G17]
- **A chapter is recallable and is LABELED, at every door.** An `epi_` row is the
  first-person account a memory was made from, not a memory: it sits outside every sleep
  phase (`sleep/types.ts#isJournal`) and the physics beside it is recorded, never acted on.
  It may rightly come to mind, so **recall** filters nothing — and every result carrying
  one says what it is: `FRAMING.journal` in front of the rendered line in both tiers,
  `journal: true` on the deliberate row, `[journal]` in the console. Owner ruling
  2026-09-04 (LAUNCH-STATUS §I14); a v2 addition, and a LABEL — it changes nothing about
  what is recallable, scored or ranked, and adds no field to the decision record. **The
  one place the label is not enough is the wake's horizon lane**, where the claim is not
  "here is something" but "this is arriving": a chapter's date is a day already lived, so
  it is refused outright there (`prospective/` CONTRACT §3). Label where the reader can
  discount; filter where the frame itself would be a lie.
- **A chapter and its own copy are one result** (2026-09-30, U13; working default). The
  self-kind memory ingested from a chapter (`source: "episode"`, `origin_ref` = the
  chapter) is folded into the chapter before the candidate cut, on every path
  (`activate.ts`); the chapter is the row shown, scored with each channel's stronger half,
  the higher salience and either half's mood lift, and the copy's links are the pair's. A
  use of a chapter RECALL SHOWED this session is credited to its live copy too
  (`Recall.resolveUse`, the copy's own `trains` respected), so the copy — the one that
  decays — earns what it earned while it was shown; a chapter used off the wake or the
  `chapter` tool credits itself only. A copy whose chapter was not reached is shown as
  itself.

## 4. Drops / simplifies

- **Per-session gate state is persisted, first-class, in the operational database.**
  **Decided, for now** (owner, 2026-10-20; settled by module-map Rulings 3 of 2026-08-25). This is the harvest's most consequential single
  finding and demands an explicit answer: in v1 the object holding "what surfaced this
  session", the refractory countdown, and carried cues was constructed fresh every turn and
  discarded, because the turn path is a new process per turn and nothing serialized it. So
  **session dedup, the emotional refractory, refractory suppression of arrival cues, and
  cross-session cue carry-over were all inert on the live path** — specified, implemented,
  tested, unreachable. The spec's instruction is to pick one and say so; this contract
  persists it (a few rows under the storage rescope) and marks the call. **Generalized: a
  pure function over caller-owned state is only as real as its caller.** The one piece of
  it that is the person's own words, the carried cue tokens, is emptied in any session idle
  past the retention ceiling (`clearIdleCarries`, run by the worker; NOTES §6, 2026-10-13).
- **The activation graph's edge arithmetic may belong in `physics/` and the traversal here** —
  `associate/CONTRACT.md` open question 1, the module map's standing check-in question. Not
  resolved by this contract.
- **v1's ~40 recall knobs are not ported as a set.** Each ships with a recorded calibration
  against a real corpus and a fixture-bounded window, or ships disabled (scar §2.8). v1's
  values in behavioral-spec §9 are the best surviving record of what lived use moved — the
  starting point, not the default. **Nine knobs are no longer inherited**:
  `CUE_LENGTH_NORM`, `CUE_TF_SATURATION`, `CUE_LENGTH_ONE_SIDED` and `CUE_DOC_CAP` were
  measured on v2's own corpus (`tools/recall-bench`, 2026-09-04) rather than carried over;
  `BUDGET_MS` was re-measured on day 0 of the parallel run; and the three absolute floors
  plus `SNR_GLOBAL` were re-earned on 2026-09-04 with a **change of UNIT**, not only of value
  — `FLOOR_GLOBAL`, `FLOOR_STRONG_BY_KIND`, `FLOOR_STRONG_DEFAULT` and `COLD_START_FLOOR` are
  now `*_UNITS`, denominated in `informativeness(1, storeSize)`. The rename is the mechanism:
  a re-scaled tunable that keeps its old name is how v1's numbers survived into v2 unnoticed
  for a month, and every stale reading of the old scale is now a compile error. That is what
  "re-earned against v2's own corpus" looks like when it actually happens.
- **The learned-edge type coupling is made deliberate.** In v1, learned co-activation edges
  were written as the same type the activation pass *boosts*, so learning silently rode a
  1.6× multiplier. **PROPOSED** — owner call at check-in, since choosing deliberately may
  change behavior either way.

## 5. Contract

**Inputs** — the user's turn; the memory graph with typed, valenced edges; strengths from
`physics/`; persisted per-session gate state; the prospective horizon; the observer
predicate; the lived day.
*One row is excluded from the candidate pool by name (2026-09-18): the SELF PAGE
(`activate.ts#isSelfPage`). It is delivered whole at every wake, so surfacing it tells the
reader nothing they were not already told — and it would otherwise accrue use credit and
association edges for being what it always is, and, having no project scope, surface under
a project it was never written in. The role string is read structurally rather than
imported; `recall/` depends on nothing in `self/`. One line to reverse.*
*A SECOND is excluded the same way (2026-09-20, E1): the per-directory HANDOFF
(`activate.ts#isHandoff`). It is working context for one place — delivered as a pointer at
the wake of that directory, expandable there by id, and expiring — not an interpretation of
what was learned, and it carries no project scope a search could honour, so left in the pool
it would put one directory's unfinished business in front of another's turn. It is NOT
refused at `deliberate.ts#expandHandle`, because the pointer's whole shape is a line and an
id; what it is refused is CREDIT (`counterpart.ts#creditReferences`), so expanding one
reinforces nothing and can never promote.*
*A THIRD (2026-10-11, Group 3 part D): an ENTITY CARD (`activate.ts#isEntityCardRow`, off
the row's `meta` column). A card is how a name reaches its memories — subjects, facts mode's
subject channel — and a newborn one holds only its name, so once cards were born from the
names the memories say, a turn naming someone footnoted the stub. Facts mode keeps it out of
its results the same way (`facts.ts#neverAResult`). The identity core is a card too.*
*A FOURTH, FOR NOW (2026-10-21, wave 2 lane C): a BELIEF (`activate.ts#isBeliefRow`, off the
row's `meta` column) — never a candidate, a footnote, "came to mind", or a head standing in
for one (`index.ts#headsWin`), and never a facts-mode result. The night starts writing
beliefs; showing them is lane E's, in a slot of their own behind its own switch. Opening one
by its id still reads it, as a card's id does.*
**Outputs** — a rendered injection (empty string, affect flag, footnotes, or a surfaced
gist); a decision record (tier counts, ids, salience — content-by-reference); reference
credit at the boundary; reinforcement deltas handed to `physics/`.

**Guarantees** — **[M]** mechanized · **[A]** advisory:

1. **[M]** No generative model call on the hot path, asserted by a test that enumerates call
   sites. An embedding lookup is permitted and must degrade to lexical-only. *(2026-09-23:
   the embedding may now come from a local static table — `core/embed/static.ts`, no
   network — and the vectors it is compared against carry their model's name, checked at
   store open, held durably on a mismatch, and re-read against the handle's own identity
   on EVERY ranking and every vector write — so no handle on this release's code takes a
   cosine across two models or files a vector under another model's tag, however long it
   has been open (test: `embedder-identity.test.ts` › "MAJOR A of the re-review"). A
   previous release's unrestarted MCP server can until it is restarted: store NOTES,
   "Release timing"). The fusion's floor and weight are chosen per embedder identity and
   per path (`SEMANTIC_BY_IDENTITY`, looked up from the identity the store records, read
   fresh per activation), with the old pair as the default; a lagged row ranked under another
   model than the store records is dropped (`other-model`): INTERFACE-GAPS §8, closed.)*
2. **[M]** A latency-budget abort has zero side effects: nothing injected, nothing buffered,
   no telemetry, no fire budget spent.
3. **[M]** Build and record are separate steps.
4. **[M]** Surfacing is relative to this turn's background, never a fixed number.
5. **[M]** The three hard gates hold: uncued is dark; the absolute floor precedes any salience
   adjustment; the loud tier requires a minimum cue fraction. *Working default since
   2026-09-28 (association build 2): "uncued is dark" has ONE named lane. A memory that
   only links reached — a QUIET POINTER (`activate.ts#Candidate.linkOnly`), pattern
   completion — may join the quiet tier: at most `LINK_POINTERS_MAX` (2) a turn, in slots
   of its own after the cued footnotes, only when the activation that arrived is at least
   `LINK_POINTER_MIN_FRACTION` (0.05) of the strongest seed's AND the part of it that came
   from memories this turn SHOWS is at least that fraction of the strongest shown one's
   (the anchor: a pointer completes something that came to mind), never the loud tier, and
   still behind session dedup (the confidentiality gate beside it was retired 2026-10-21,
   G9). For that lane gate (a) is CHECKED
   rather than structural (the memory is fetched); for every other uncued memory it is
   structural as before. Tests: `association-build2.test.ts` › "1. quiet pointers".*
6. **[M]** Tiers are disjoint and capped. *(Quiet pointers have their own cap,
   `LINK_POINTERS_MAX`, beside `MAX_FOOTNOTES`; 2026-09-28.)* *(2026-10-10, Group 1, review
   03 C2: no tier — surfaced, footnote or quiet pointer — offers a memory BELOW REACH,
   strength under physics' `REACH` (0.15), the identity band excepted. Prefiltered on box
   3's ranking in the token and semantic top-K, rechecked exactly per candidate;
   deliberate recall still lists such a memory after its main results, labelled faded.
   `NOTES.md` §29.)*
7. **[M]** Ambiguous handles fire at reduced weight AND train nothing — both halves, with a
   test that greps for the consumer, not the comment (scar §2.6).
8. **[M]** A deliberate SEARCH trains nothing and deposits no memory (2026-10-03: stated
   as the owner's rule of 09-16 — exposure never strengthens, retrieval does). Opening a
   memory by id or title, or quoting the words a deliberate answer showed (`asked` gate
   records, read by `Counterpart#creditReferences`; never by the ambient gate), is credited
   at the boundary like any use.
9. **RETIRED 2026-10-21.** Confidentiality was enforced at the boundary of the ask — material
   marked confidential returned only in the owner's own session. Removed on Mike's call:
   nothing in the product set the mark, nobody used it, and it was never clear whom it
   protected. The `confidential` column is inert (store CONTRACT §5 G13); the `Verdict`
   variant `confidential-withheld` stays readable on old `mcp.recall` rows.
10. **[M]** Reference credit is precision-biased, never downgrades an already-credited item,
    and is a no-op under observer. Since 2026-10-11 a lower tier credited earlier the same
    lived day is LIFTED by a higher one (`physics#creditUse`'s `upgradeFrom`) — from this
    session's gate state, or, for an engaged credit, from its return row in any session —
    never the other way. (2026-10-19 experiment: also a glimpse's or a rating of 1's
    partial credit, read back from its own return row.)
11. **[M]** Under observer, recall computes and renders normally and strengthens nothing —
    checked first, before any other work (scar E7).
12. **[M]** Per-session gate state has a defined store and lifetime, and a test asserts the
    live path reads and writes it — the exact assertion whose absence made v1's four gate
    rules inert.
13. **[A]** Framing and phrasing are preferences, recorded as open probe questions.
14. **[M]** The per-turn surfacing decision record is content-by-reference and exists from day
    one — it is the richest replay comparison surface (§17.3).
15. **[M]** That record is **durable**: the composition root appends one `recall.decision` row
    per non-aborted turn to the store's event log, and exports the record's ordered field list
    (`surfaceSetFields()`) as the surface set's schema — so a run's surfacing numbers are
    recomputable from the store it leaves behind rather than from a live event ring, and a
    human rating can be carried across a change only when that set provably matches (parallel
    CONTRACT §5 G2/G12, replay INTERFACE-GAPS §7). Nothing is written under observer; an
    abort writes nothing at all, which is guarantee 2 unchanged.
16. **[M]** The semantic channel has a **stated source on every turn**, from a closed
    vocabulary (`none`, `lagged`, `in-line`, `in-line-skipped`, `stale`, `other-model`,
    `unreadable`, and the worker's four named failures; `other-model`, 2026-09-23: a lag row
    ranked under another embedder than box 3 records now; `in-line-skipped`, 2026-10-19: no
    fresh lag row, and box 3 past `SEMANTIC_INLINE_MAX_VECTORS`). Measured 2026-09-04: both live paths built their turn without a
    vector, so `semanticUsed: false` was written on every real turn and said nothing about
    why — "did not fire" and "was never asked" are different records (scar §2.4). The
    source is NOT in the durable surface set (`RECALL_DECISION_FIELDS`), because moving
    that set mid-parallel-run invalidates every carried human rating (parallel §5 G12); it
    rides the adapter's own `adapter.recall` row, which is durable.
17. **[M]** The lagged semantic cue is **per-session gate state with a one-turn lifetime**,
    on the same `gate_session` table and swept by the same `pruneGateSessions()`. It stamps
    the session's SERVED turn count when written and is usable only while that number is
    still the served count — i.e. on the very next turn, exactly the `carriedCues` rule.
    What it carries is the **top-M `{id, score}` ranking**, not the vector: `Store.nearestTo`
    measured 590-1040 ms over 13,862 JSON-stored vectors (2026-09-04), so the scan was as
    unaffordable on the hot path as the round trip. **Amended 2026-10-19:** on float32 BLOBs
    the scan measures ~18 ms cold at the live store's 2,207 vectors, so a turn with NO usable
    row (`none`, `stale`) embeds its own text with the store's sync embedder and ranks it in
    line (`session.ts#inLineSemantic`), guarded by vector count before the rank, never by
    clock (the rank runs before `build()`'s first time check). A fresh row is used as before. A recorded race: a worker slow enough to be overtaken
    by the next turn stamps the newer turn number, so a cue can be labelled one turn later
    than the text it was computed from. Cheap to detect (the hits are a turn stale), not
    worth a lock.
18. **[M]** **Mood-matching modulates; it never admits** (emotion part A, owner decision
    2026-09-25/26 — working default; `mood.ts`). A person's CURRENT feeling is only what
    was RECORDED for them in the last `MOOD_WINDOW_HOURS = 3` of the store's clock at
    `MOOD_MIN_STRENGTH = 0.3` or more — no classifier reads the turn. A candidate that
    carried a feeling CLOSE IN VALENCE to someone's mood (the wheel v2, 2026-09-30: the
    match is `1 − |Δvalence| / MOOD_VALENCE_SPAN (0.5)`, nothing past the span; it was
    core equality before) gets `MOOD_SAME_WEIGHT (0.3) × match ×` that feeling's SOFTENED
    strength added to its `sal` when the feeling was that same person's,
    `MOOD_CROSS_WEIGHT (0.1) ×` when it was the other's; a feeling recorded inside the
    window is the mood, never a match. The
    lift rides `sal` ONLY: it is computed for cued candidates only, it never enters
    `activation` (so it cannot change the candidate set), hard gate (a) and the absolute
    floor (b) are both evaluated before `sal` is read, and in the absolute regimes the
    admission bar ignores `sal`. What `sal` still decides in EVERY regime is the order
    of the loud pool (`SAL_SORT_WEIGHT`): among memories already admitted loud, a
    mood-lifted one can take a surfaced slot another would have had, pushing that one
    to a footnote. Tests: `emotion.test.ts` › "mood-matching never admits an uncued
    memory". The decision record carries `moodMatched` — admitted memories the mood
    lifted, a count, never which feeling. Adding that field moves the surface set (G15):
    the parallel run it protected ended 2026-09-21, and a durable count is the only way
    the mechanism can be seen firing. Since 2026-10-14 (lightly held) it also carries
    `moodMatchedIds` — which admitted memories, ids only, at most `MOOD_MATCHED_IDS_CAP`
    (64, `shownNotUsed`'s cap) — so a re-test with the weights on can compare their use.
    Empty while `MOOD_SAME_WEIGHT`/`MOOD_CROSS_WEIGHT` stay 0.
    **The tension with G11, named.** §3 keeps v1's rule that the affect CUE is first-person
    only, "guarding against mood-congruent overgeneralization" — and this is mood-congruent
    recall, on purpose. The guard it keeps is structural rather than a subject rule: it
    cannot reach a memory the conversation did not, it lifts by at most 0.3 of salience,
    the other person's mood lifts a third as much, and a match softens with age. The turn
    gate itself (G10: the emotional DIMENSION counts only when the turn is felt in the first
    person) is unchanged; when it opens, the dimension now reads as the memory's emotional
    INTENSITY (physics §5.10), so a feeling held in the `feelings` table is not read as
    unfelt. The affect flag's "charged" test reads the same intensity.
19. **[M]** **A deliberate question about feeling is answered from the stamps** (U13,
    2026-09-30, revised after the review of #293 — working default; `feeling-ask.ts`,
    `activate.ts`). *2026-10-03: the deliberate caller that set `feeling` was the old
    question path, retired in Release B; facts mode reads no feeling lane, and feeling
    questions are meaning mode's (`mcp/meaning.ts`). The lane below is unchanged in the
    core.* Only when the turn carries a `feeling` ask, which only a deliberate
    path sets: the ambient turn, its affect gate (G10/G11) and mood-matching (G18) are
    unchanged. A stamp answers to its emotion word (an `other` whose own word is on the
    wheel reads as that word), its group's word, the aliases pointing at it, its wheel
    core(s), and the writer's own word when that is ONE word; a wheel phrase ("caught out")
    answers only as the whole phrase. A question word is read through the wheel, a
    question-side everyday list (`EVERYDAY_TO_WHEEL`: shame, dread, relief…) and a light
    stem of a known feeling (happiest, sadness) — those two only in a feeling's frame — and
    never a word off the wheel capitalised mid-sentence (a name); the owner's name written with an
    apostrophe ("Mike's") is the owner. Two cases:
    **Ranked** — a real question about feeling: a feel-word (`FEEL_WORDS`) or a word naming
    a feeling, used about a PERSON (first person singular or second person, the owner by
    word or name, and "we" for a feel-word only; `detectAffect`'s look-back, widened two
    words forward for "what moved ME"). The pool is the stamps its named words answer to
    (tier 1), then the stamps under those words' home cores (tier 2, lane 6 2026-10-01),
    or every stamp when none is named, of the person asked about (first person is the
    asker; nothing said, both). The first `FEELING_CANDIDATES_MAX` (6) memories by tier,
    then strength, then the newer stamp, are nominated with `FEELING_CUE_UNITS` (4) cue
    units × that strength — a tier-2 stamp's cue capped at the weakest tier-1 nomination's.
    The strength is SOFTENED, unless the question asks for the strongest or over all time
    (a superlative, or "most", "ever", "strongest", "since" beside a feeling word, never
    with "recent"/"lately"): then as recorded. They are
    appended after the cut (which is taken over the words' and meaning's rows, ranked
    without stamps, so it keeps what it keeps with no lane), and answered first within the
    tier the gate gave them, in the lane's order — vivid, felt-quiet, quiet, felt-dim, then
    the rows NO TOPIC WORD reached (only the question's feeling and function words, or its
    meaning; a capitalised word is always a topic: `FeelingLane.noTopic`) whatever their
    tier, then dim — exempt from the dim
    cap. **Named only** — a feeling word used about no one ("the happy path"): its stamps
    nominate their memories as an ordinary word would (its rarity among the stamps), and
    nothing is reordered. A feeling word followed by a determiner, a possessive or
    "it"/"them" is a verb on a thing ("moved THE parser", "moved MY parser") and names
    nothing; a possessive is not a person ("is MY build open"); "feel like" / "felt that"
    is an opinion.
    Either way the stamps' cue is in the CUE channel (the temporal channel's shape: hard
    gate (a) stays structural, the floor (b) still applies) and is kept OUT of the gate's
    background (`Candidate.stamp`): the relative bar is what the words and meaning found.
    Every scope rule of `recallable` applies; a chapter and its copy take one slot. Ids and
    numbers only reach `BuildOutput.feeling`; no feeling's word reaches the decision
    record. Tests: `recall-feelings.test.ts`.

20. **RETIRED 2026-10-03 (Release B).** Facts mode reads time as a FILTER instead
    (`recall/time-ask.ts`, `mcp/facts.ts`; mcp CONTRACT §6f): a window the question names
    keeps only what is inside it, and "the last session" is resolved to the session the
    wake's "Last here" names, whose rows lead. `recency-ask.ts` stays, read by
    `time-ask.ts` for days and clock times. **Soft words are the exception**
    (2026-10-20, from the benchmark loss read; helps real recall too; lightly held,
    revisit — an experiment, Mike's go via BENCHMARK): "lately", "recently", "these
    days", "nowadays" (`time-ask.ts#SOFT_WORDS`) come back marked `soft`, and facts mode
    ranks the past week first instead of filtering, unless the question is only time;
    explicit windows are unchanged (mcp CONTRACT §6f). Facts answers also list the next
    20 matches as title lines after the page (the title tail, §6f there): listed is not
    shown, and credits nothing. What this guarantee said, for the record:
    **A deliberate question about time leads with the session it means**
    (2026-09-30, the continuity test; revised after the review of #302 — working default;
    `recency-ask.ts`, `mcp/deliberate.ts#recentRows`). Only on the deliberate path, only
    when the caller names the asking session's directory (the MCP `recall`; not the
    console's `ask`), and not when the answer is a RANKED question about feeling (G19),
    which keeps its own order. A fixed list of phrases ("most recent", "last session",
    "where did we leave off", "this evening", "today", …) or a clock time with am/pm, "at",
    or a range is the cue; no model reads the question. WHICH SESSION: a named window
    ("this morning", "yesterday", "16:01–17:48") means the sessions here, not the asker,
    at work in it, and none means no lead; otherwise the session the wake's "Last here"
    line names (`Counterpart#chaptersHereFor`), then the newest one here that ended, then
    a live sibling. WHICH ROWS: its latest episode, shown from its FIRST chapter (what
    its title names; since 2026-10-01, its latest before), with a line saying how many
    more it holds and that its id fetches the whole, and up to
    `RECENT_MEMORIES_MAX` (8) of the memories it wrote in this directory, newest first,
    never a dream's or a reflection's, never a replaced row or a chapter's copy (and the
    lead chapter's copies leave the rest of the list). LEAD OR PROMOTE: a thin question
    (nothing left once the cue and function words are out) puts them FIRST, marked
    `recent: true`, a row the search did not reach coming in as `quiet`; any other only
    moves up the ones the search found too. **This lane adds rows the gate never saw**:
    a `quiet` row marked `recent` was put there by the question, not admitted by the
    ambient bar, and the result's glossary says so. Activation, the gate and the
    decision record are unchanged (the rows it adds are not in `considered`).
    Tests: `continuity.test.ts`.
21. **[M]** **Ambient recall does not hand a session back what it wrote** (the echo skip;
    an experiment started 2026-10-19, feedback-loop build part C: trying it to see whether
    footnotes get less noisy without costing long sessions what they compacted away; check
    on ~10-22). `Counterpart#recallForTurn` reads the ids this session wrote
    (`origin_session`, the nightly run's rows excepted; `store.sessionMemoryIds`) — since
    the host's last compaction of the conversation when the host says one happened
    (Claude Code: the transcript's newest `compact_boundary` line), else the whole
    session; when a named transcript will not read, nothing (the skip fails open, toward
    showing; `echoWindow: "unread"`) — and passes them as `Turn.echo`. The gate turns each away as `echo-skipped`
    once it has cleared the floor and its bar (so the count is what would have been
    shown), and in the quiet-pointer lane behind dedup; an earlier version whose head is
    in the echo set stays inhibited. It stays in the background sample, as a
    dedup-suppressed candidate does. The decision row counts them (`echoSkipped`, in the
    surface set). **Deliberate recall is unaffected**: nothing on that path sets
    `Turn.echo`. Known gap: a memory a server wrote before it knew its session
    (`UNBOUND_SESSION`) can still echo. Revert by no longer setting `Turn.echo` in
    `recallForTurn`. Tests: `echo-skip.test.ts`.
    **Another project's work faces a slightly higher bar** (2026-10-21, wave 2 lane G; Mike:
    "we could try a slightly higher bar, and review after a week" — an experiment, CHECK-AFTER
    ~10-29). `recallForTurn` binds `Turn.elsewhere` for a turn in a folder: work
    (`self/work.ts#isWorkMemory`) written in a folder outside this one's project
    (`folder_projects`). Its admit and loud bars are multiplied by `CROSS_PROJECT_BAR_LIFT`
    (1.25), after the floor, as habituation's lift is; the decision row's
    `crossProjectLifted` counts what the lift alone kept back. The hard filter
    (`RECALL_BY_PROJECT`, off) instead turns it away as `project-skipped` at the echo skip's
    two places (`projectSkipped`). Craft, personal marks, a memory with no folder and a joined
    folder's work are never another project's; deliberate recall never sets it. Lift 1 and
    the filter off: nothing is bound. Tests: `recall-by-project.test.ts`.
22. **[M]** **Context priming: what the session is doing gives its neighbours a head start**
    (an experiment started 2026-10-19, `prime.ts`: trying it to see whether primed
    footnotes are rated more useful than unprimed ones without one cluster winning turn
    after turn; check on ~10-22; revert by setting `PRIME_LINK_UNITS` and
    `PRIME_TRAIN_SHARE` to 0, or reverting the PR). SOURCES: what this session used
    (credited at the referenced, engaged or useful tier, or rated 2–3 on its rating
    rows), what it wrote (the echo set, item 21), and what is open in its folder (the open
    threads its wake kept, recorded by the host as a `prime` gate record, and the
    directory's live handoffs), read once a session. Each passes a head start one hop
    along links (`Associate#partnersOf`, decayed weight × the source's weight, decayed
    by turns since it first counted) and joins the TRAIN OF THOUGHT — a running vector of
    this session's prompts, decayed by turn, kept in gate state (kind `prime`, never read
    by `loadGateState`) and scored against the turn's candidates, never ranked over the
    store. Amended at review (2026-10-19, also experiments, same check): the train's
    score is CENTRED on the turn's cut before priming (`PRIME_TRAIN_CENTRE`, revert by 0)
    — only the part of a candidate's cosine above its peers' mean counts, so a steady
    topic does not lift every candidate; it is scaled by how much the train holds (at
    most one prompt's worth), so a train of only old turns or a folder's leftovers primes
    softly; on a lagged turn the newest prompt, which the lag row already carries, is
    taken out of the train scored against; and a handoff's weight as a source falls by
    `PRIME_HANDOFF_DAY_DECAY` per lived day of its age. THE LIMITS, which are the guarantee: ambient only (only `recallForTurn` sets
    `Turn.prime`); only a candidate this turn's words or meaning reached (priming never
    mints one, and quiet pointers are not primed); never a memory in the echo set; at most
    `PRIME_CEILING` times its own cue + semantic; out of `cueFraction` both halves; out of
    the turn's background sample (as a stamp is), so a primed cluster does not raise
    anyone's bar; and out of BOTH absolute floors — hard gate (b) and the loud tier's
    per-kind floor are judged on the activation without it, so on a turn whose background
    is too thin for a relative bar priming changes nothing. Inside those, it may lift a
    memory into the cut and past its relative bar, in either tier. Habituation's raised
    bar (item on ratings above) applies after it, unchanged. A first prompt with nothing
    open in its folder primes nothing: the same injection and verdicts as with priming
    off. The train is the person's words in another form, so it is emptied in a session
    idle past the retention ceiling (`clearIdleCarries`), its newest prompt with it. The
    decision row carries a `primed` summary (sources by kind, whether a train existed, the
    cosine the train's head start had to beat, primed / lifted / by channel among what
    was shown) and each shown row its `primed` part; `null` when
    priming did not run. Tests: `context-priming.test.ts`.
    **Amended 2026-10-22 (wave 2 lane E; an experiment, check 2026-10-29): TAGS PRIME
    TOO** (`TAGS_PRIME`, on; revert by setting it false). A source's tags are a second
    partner source beside its links (`PrimeInput.tagPartners`, bound by the
    composition root from `schemas/tags.ts#tagPartners`): memories carrying one of its
    tags through the merges, and memories carrying one of the `TAGS_PRIME_NEIGHBOURS`
    tags most often on the same memories (B's concept edges, sharing at least two) at
    half, all scaled by `TAGS_PRIME_WEIGHT` (0.1, under one co-use link). A stop tag and
    a tag on more than `TAGS_PRIME_MAX_TAG_MEMORIES` live memories prime nothing. Through
    the same link channel, so every limit above holds unchanged. Off, the tag source is
    never asked. And each shown row's `primed` now says, per footnote, the part of
    `link` that came through tags (`tag`), the channel that gave the most (`by`: `link`,
    `tag` or `train`) and the source id that gave the most along links or tags (`top`),
    beside `lifted` — so a read can join primed footnotes to their ratings and read
    tunnel vision by id (the 0.3.27 read's two asks); the summary counts `byTag`. Tests:
    `beliefs-shown.test.ts`.

23. **[M]** **Beliefs in their own slot** (wave 2 lane E, 2026-10-22; design §7; an
    experiment, `BELIEFS_IN_RECALL`, on; check 2026-10-29; revert by setting it false).
    When a turn's words name a subject — a card through the alias index
    (`Schemas#subjectsIn`), a topic by its word (`tags.ts#topicsNamedIn`), never the
    self subject — its live beliefs are offered (`Schemas#beliefsNamedIn`, bound as
    `Turn.beliefs` by the composition root; ambient only). The slot shows those
    STRICTLY above `BELIEFS_SLOT_FLOOR` (0.3: a belief born at the ceiling with nothing
    behind it does not show), not shown earlier this session nor habituated (rated 0 in two sessions; off with `HABITUATION_BAR_LIFT` 0), strongest first, at most
    `BELIEFS_SLOT_MAX` (3), each as `Subject: statement (strength word; N memories)
    [id]` under its own header, after the footnotes — IN ADDITION to them; the
    footnotes stay belief-free (`isBeliefRow`, unchanged). A subject named is enough:
    a turn with no memory to show still carries the slot (its reason stays the
    memories'). In the trim order the slot gives way FIRST, weakest belief first, so it
    never takes a footnote's room. The sentinel adds `beliefs=N` only when it carried
    one. What it showed is its own gate record (kind `belief`, never `surfaced`: the
    footnote numbers, the credit pass and rating coverage do not see it) and the
    decision row's `beliefs` (offered, shown, bytes; null when it did not run). A shown
    belief is RATEABLE (`rated.ts`, lane `beliefs`): a rating is a USE of it at its tier
    — once a lived day, through the store's one door for it (`Store#reinforce`'s
    `beliefSlot`) — NEVER a support filing; for a belief about me or us
    (`Schemas#aboutMeBelief`) it counts nothing at all (`belief-about-me`); a belief
    left unrated is no glimpse; a belief is never co-used or linked as shown together.
    Every other door (an open, a quote, `drewOn`) still credits a belief nothing. Off:
    the lookup is never asked and the turn is byte for byte the turn it was. Tests:
    `beliefs-shown.test.ts`.

## 6. Scars honored

**E7** (observers surface but strengthen nothing) · **E8** (base-level decay runs on lived
days) · **§2.4** (footnote-flood, affect-noise, and name-smear get tripwires, not tiles) ·
**§2.6** (the ambiguous-alias safety half is enforced, not documented) · **§2.8** (every
recall threshold ships measured, or disabled) · **§2.9** (context assembly logs what it
showed, by id) · **§2.18** (the injection ceiling is a host capability) · **§2.20** (the
decision record carries ids, never bodies).

## 6b. A memory's standing is a label (2026-09-29, contradictions)

**[M]** Recall renders a memory's standing in a contradiction (`standing.ts`, read off
`contradictions`): the OLDER of an unsettled pair as `Unsettled — may be out of date, see
[id]`, a `changed` one as `Earlier (now [id])` (and `(earlier: [id])` after the one that
holds), a `corrected` one as `Corrected by [id]`, an `open` pair as `(disagrees with
[id])`. Outside the clip, like `Journal:` — a label, never a filter: nothing about what
is recallable, ranked or gated moves. The deliberate path carries the same as a
`standing` field, and by id a replaced row says `replaced by [id]`.

**[M] "Earlier (now [id])" names the end of the chain** (review of #408, 2026-10-11): the
id is `headOf`'s, the same memory a write's neighbours and the dream's bundles name with
`earlier (now mem_…)` — on A→B→C, A reads `now [C]`. And `headOf` decides whether it is
earlier at all (the wake's `settledOver` rule): a memory whose holder is gone with nothing
live after it carries no `Earlier`. Since 2026-10-11 (Group 3 part B; random-06, lightly
held) a settle speaks only about the pair it names: a newer pair in which a memory holds no
longer re-affirms it over the pair that put it under another. To make B current again over
C, settle B over C: the owner's or a session's settle reorders the standing pair it names
(the old settle undone, its trail kept; review of #432) — a session's only when the owner
did not settle it.

**[M] The chain head wins ambient recall** (2026-10-11, Group 2; review 04 change 1, MOD
#3) — the one place the label's rule became a filter. A turn candidate with a `headOf`
carries it into the gate, which inhibits it when its head is admitted beside it or is
already in the session; a turn that reached only the earlier one is shown its head instead
(`recall/index.ts#headsWin`: the earlier's numbers, the head's words and its `(earlier:
[id])`), left out of the turn's background. A head the turn reached only through a link
(a quiet pointer) counts as not reached: it is brought in to stand for the earlier one and
its pointer candidate dropped (2026-10-11, Group 2b), so the two never show side by side. The
deliberate path is unchanged: facts mode already folds a chain under its head, meaning mode
marks an earlier moment `earlier (now [id])` (Group 2b), and every other answer carries the
label.

## 6c. A deliberate result says where it came from (2026-09-30)

**[M]** Every row the deliberate path returns carries `from`: the session that wrote it
("this session" for the asker's own, the short id otherwise), its directory (home as `~`),
and when it was written in the store's zone (a chapter: its latest write) —
`session a1b2c3d4, ~/random, 09-30 17:41`. Read off the row (`origin_session`,
`origin_scope`, `created_at`/`updated_at`); a row the nightly run made says so ("a dream
launched from session …", "a reflection"), one carried over from an older store says
that, a row that recorded less says less, and "an earlier session" when it names no
session. Nothing is backfilled. A label, like standing:
nothing about what is recallable or ranked moves. Episodes record their directory on
`origin_scope` from 2026-09-30 on.

## 7. Open questions

1. **Is per-session gate state the right lifetime?** Persisting it is this contract's
   proposal; the alternative the spec offers is honest deletion of the four rules that depend
   on it. Either is defensible; v1's state — specified, implemented, tested, unreachable — is
   the worst of the three.
2. ~~**Does the ambient path embed at all on a cold cache?**~~ **ANSWERED 2026-09-04
   (owner ruling): no — and it does not rank one either.** v1's did, inside its own
   latency race (`~/bansai/hooks/surface.ts:82-88`, "a cold cache calls Voyage and the
   latency race covers it"), which is how "no second LLM call" quietly became untrue
   there. v2 cannot even do that much: `recall.build` is a synchronous pass with budget
   checkpoints rather than a race, so an overrun aborts the turn instead of degrading the
   channel, and every hook is a fresh process already spending 700-1000 ms cold against
   1200 ms. The cue is computed by the detached worker after a turn and used on the next
   one (§5 G17). The deliberate ask is the exception and embeds in line
   (`mcp/deliberate.ts#embedQuestion`; since 2026-10-03 it ranks in its own mode, not
   through `build()`).
3. **Does `associate/` fold in here** (traversal), with its arithmetic going to `physics/`?
   The module map's standing check-in question; owned by `associate/`.
4. **Is the "quietly available / ignorable" framing actually ignorable to a model?** v1
   shipped it as a deliberate probe question and never answered it. **Probe advanced one
   step 2026-09-14:** step 0 (`render.ts#FOOTNOTE_HEADER_STEP_0`, the string above) ran
   live to that date; step 1 keeps "ignorable" and adds "expand an id with recall before
   citing one", after the model was measured asserting counts and characterizations of
   five footnoted memories from their titles without expanding any (IMPROVEMENTS U5). The
   measurement is `probe.ts` / `counterparts probe-oq4`: per calendar date, footnotes
   delivered (`recall.decision`) vs. later expanded by id (`recall.credit.expandedIds`),
   and since 2026-10-09 a hit rate by lane from the credit row's own score (NOTES §28).
   Reversible by one string; the owner rules on the reading, not this file.
5. ~~**The absolute floors have never fired in v2, and the loud tier needs them.**~~
   **ANSWERED 2026-09-04. The floors are in cue units now, and the "cue-count half" was
   never a second half — it was a broken measurement.**

   The finding that closed it: `activate.ts` took a token's document frequency from the
   LENGTH of its own `PER_CUE_FETCH` result, and a bounded top-K's length is
   `min(trueDf, K)`. So on a 15,421-document index every word occurring in 24 or more
   memories measured as equally rare — `conversation` (true df 574) and `chat` (444) both
   drew informativeness **5.70** against a ceiling of 8.95 — while on a seventeen-memory
   fixture the truncation cannot happen at all. §3 G4's "informativeness weighting replaces
   stop-lists" was therefore *true in miniature and progressively false at scale*, which is
   exactly the asymmetry that made a floor calibrated on the live store blind a small one.
   Counting df instead (`store/cache.ts#docFrequency`) removes it: a hermetic
   seventeen-memory fixture whose turn cleanly cues one memory now lands at **3.00 cue
   units**, INSIDE the live store's per-turn range of **0.88 to 5.17**. One scale, two
   corpora three orders of magnitude apart.

   With that fixed, denominating the floors in `informativeness(1, storeSize)` — one
   maximally-rare cue, the model's own unit — is sufficient on its own, and it is what
   shipped: `FLOOR_GLOBAL_UNITS` 0.2, `FLOOR_STRONG_DEFAULT_UNITS` 4.5,
   `COLD_START_FLOOR_UNITS` 0.4, `FLOOR_STRONG_BY_KIND_UNITS` empty. On the 13-prompt
   bench, against the same store copy: loud fell from **13 of 13 turns to 3 of 13**, the
   near-contentless turn 3 went silent, delivered per turn went 3.9 → 2.8, hub deliveries
   stayed 0, **no id was delivered on 3 or more turns at all** (against 5 ids carrying 27 of
   51 deliveries before), and the labeled positives went from 3 to 7 — including both
   ambient ones, on the turn they were labeled for.

   **What the two candidate mechanisms turned out to be worth**, since both were named here
   and only one of them was ever going to ship:
   - *Normalize activation by the turn's own cue mass* is **refuted by arithmetic**, and
     usefully so: turn 3's top candidate takes **22%** of its turn's cue mass where turn 5's
     takes **7%**. A thin turn CONCENTRATES, so this is the relative bar's failure again in
     a new coat. Recorded rather than left as a lead, so nobody prototypes it.
   - *Gate the loud tier on whether the turn carried distinctive vocabulary* (candidate b)
     works but discriminates poorly: turn 3's cue mass is 3.67 units against 15.3-67.7 for
     the other twelve, which silences turn 3 and nothing else; reaching one-in-four needs a
     floor near 40 units, and mass scales with turn LENGTH (14 tokens vs 163), so that floor
     would be gating on how much the person typed. It also fails the miniature outright — a
     four-word hermetic turn carries 3.0 units, indistinguishable from turn 3. Not shipped,
     and not needed: the per-candidate floor reaches the target without a turn-level gate.
   - *Loud pacing* (candidate c) was not needed and is not shipped. It is a gate where the
     evidence supported a gradient, and it would have made the loud tier a function of when
     the session started rather than of what the turn said.

   **A second instance of the same scar, found on the way and fixed here**:
   `prospective.CUE_STRENGTH` (0.5) was also an absolute number on v1's scale, so a temporal
   arrival was worth 0.23 of a maximally-rare word on a seventeen-memory store and 0.056 of
   one on a fifteen-thousand-memory store — the calendar going quiet as the owner remembers
   more. It is converted at the fold (`activate.ts`), which is what makes "one more cue, like
   the user typing 'Portland'" finally true.

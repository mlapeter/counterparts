# `recall/` — CONTRACT

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
- **Deliberate recall is a deeper effort with different thresholds, on purpose** — the ambient
  seed floor is the right bar for surfacing uninvited and the wrong bar for a question someone
  asked (measured: five on-point traces, best similarity 0.366, zero surfaced). It adds a
  **labeled** lower-confidence tier and returns footnote-tier items as bodies. **Ranking is
  not recording**: it trains nothing and deposits nothing. [v1 §9.1]
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
  boundary, `recall.credit`, with a `reason` readers split on.**
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

## 4. Drops / simplifies

- **Per-session gate state is persisted, first-class, in the operational database.**
  **PROPOSED** — owner call at check-in. This is the harvest's most consequential single
  finding and demands an explicit answer: in v1 the object holding "what surfaced this
  session", the refractory countdown, and carried cues was constructed fresh every turn and
  discarded, because the turn path is a new process per turn and nothing serialized it. So
  **session dedup, the emotional refractory, refractory suppression of arrival cues, and
  cross-session cue carry-over were all inert on the live path** — specified, implemented,
  tested, unreachable. The spec's instruction is to pick one and say so; this contract
  persists it (a few rows under the storage rescope) and marks the call. **Generalized: a
  pure function over caller-owned state is only as real as its caller.**
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
   per path (`SEMANTIC_BY_IDENTITY`, looked up from the identity the store records), with
   the old pair as the default: INTERFACE-GAPS §8, closed.)*
2. **[M]** A latency-budget abort has zero side effects: nothing injected, nothing buffered,
   no telemetry, no fire budget spent.
3. **[M]** Build and record are separate steps.
4. **[M]** Surfacing is relative to this turn's background, never a fixed number.
5. **[M]** The three hard gates hold: uncued is dark; the absolute floor precedes any salience
   adjustment; the loud tier requires a minimum cue fraction.
6. **[M]** Tiers are disjoint and capped.
7. **[M]** Ambiguous handles fire at reduced weight AND train nothing — both halves, with a
   test that greps for the consumer, not the comment (scar §2.6).
8. **[M]** Deliberate recall trains nothing and deposits nothing.
9. **[M]** Confidentiality is enforced at the boundary of the ask — sensitive material returns
   only in the owner's own session; withholding is *stated* for a direct lookup and silent in
   a list.
10. **[M]** Reference credit is precision-biased, never downgrades an already-credited item,
    and is a no-op under observer.
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
    vocabulary (`none`, `lagged`, `in-line`, `stale`, `unreadable`, and the worker's four
    named failures). Measured 2026-09-04: both live paths built their turn without a
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
    measured 590-1040 ms over 13,862 stored vectors, so the scan is as unaffordable on the
    hot path as the round trip was. A recorded race: a worker slow enough to be overtaken
    by the next turn stamps the newer turn number, so a cue can be labelled one turn later
    than the text it was computed from. Cheap to detect (the hits are a turn stale), not
    worth a lock.

## 6. Scars honored

**E7** (observers surface but strengthen nothing) · **E8** (base-level decay runs on lived
days) · **§2.4** (footnote-flood, affect-noise, and name-smear get tripwires, not tiles) ·
**§2.6** (the ambiguous-alias safety half is enforced, not documented) · **§2.8** (every
recall threshold ships measured, or disabled) · **§2.9** (context assembly logs what it
showed, by id) · **§2.18** (the injection ceiling is a host capability) · **§2.20** (the
decision record carries ids, never bodies).

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
   one (§5 G17). The deliberate ask is the exception and embeds in line, under its own
   budget (`mcp/deliberate.ts`, `DELIBERATE_BUDGET_MS`).
3. **Does `associate/` fold in here** (traversal), with its arithmetic going to `physics/`?
   The module map's standing check-in question; owned by `associate/`.
4. **Is the "quietly available / ignorable" framing actually ignorable to a model?** v1
   shipped it as a deliberate probe question and never answered it. **Probe advanced one
   step 2026-09-14:** step 0 (`render.ts#FOOTNOTE_HEADER_STEP_0`, the string above) ran
   live to that date; step 1 keeps "ignorable" and adds "expand an id with recall before
   citing one", after the model was measured asserting counts and characterizations of
   five footnoted memories from their titles without expanding any (IMPROVEMENTS U5). The
   measurement is `probe.ts` / `counterparts probe-oq4`: per calendar date, footnotes
   delivered (`recall.decision`) vs. later expanded by id (`recall.credit.expandedIds`).
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

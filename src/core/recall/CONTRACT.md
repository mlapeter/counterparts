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
  LLM call" was true of generation and silent about embeddings).
- **Hard latency budget, silent abort, zero side effects on loss** — the pass *builds* its
  decision and a separate step *records* it; on timeout nothing is injected, buffered,
  logged, or spent. *A slow subconscious is worse than a quiet one.* [v1 §9 G2]
- **Host boilerplate is stripped before cue extraction and before embedding** — measured: an
  image placeholder token surfaced an unrelated image-cache memory. [v1 §9 G3]
- **Cue matching is word-bounded and rarity-weighted**; informativeness weighting replaces
  stop-lists. [v1 §9 G4]
- **…and the same rule holds on the DOCUMENT side: a cue's evidence for a memory does not
  scale with how long the memory is.** Informativeness says a token spanning the whole store
  is evidence of nothing; a memory spanning every topic is likewise specific evidence for
  none. Mechanized as BM25 length normalization in the token index — applied *before* the
  index's own `ORDER BY … LIMIT`, so the candidate SET is chosen length-fairly and not only
  re-ranked — plus a per-document ceiling at a multiple of that document's own strongest
  cue. **This is a v2 addition, not a v1 port**: v1's cue channel matched curated entity
  aliases, where length could not accumulate, and it capped a node's total alias
  contribution absolutely (`entityCueCap`) for the same reason the ceiling exists here.
  MEASURED 2026-09-04 — see `tunables.ts` (`CUE_LENGTH_NORM`, `CUE_TF_SATURATION`,
  `CUE_DOC_CAP`) and `tools/recall-bench` for the sweep behind the values.
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
- **Per-kind floors, because kinds live on different activation scales** — measured: person
  activation peaked near 0.79 where craft material floored at 1.0, so a global floor silently
  excluded whole kinds. The *background statistic* stays global. [v1 §9 G12]
- **Cold start is stricter, not looser** — below a minimum store size the variance estimate is
  meaningless, and small stores over-surface. [v1 §9 G13]
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
  a miss merely leaves weak credit. [v1 §9.2]
- **Framing is load-bearing and part of the spec** — footnotes are pointers, and the "quietly
  available / ignorable" phrasing is a deliberate, still-open probe question. [v1 §9 G17]

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
  starting point, not the default. **Three knobs are no longer inherited**:
  `CUE_LENGTH_NORM`, `CUE_TF_SATURATION` and `CUE_DOC_CAP` were measured on v2's own corpus
  (`tools/recall-bench`, 2026-09-04) rather than carried over, and `BUDGET_MS` was
  re-measured on day 0 of the parallel run. That is what "re-earned against v2's own corpus"
  looks like when it actually happens.
- **The learned-edge type coupling is made deliberate.** In v1, learned co-activation edges
  were written as the same type the activation pass *boosts*, so learning silently rode a
  1.6× multiplier. **PROPOSED** — owner call at check-in, since choosing deliberately may
  change behavior either way.

## 5. Contract

**Inputs** — the user's turn; the memory graph with typed, valenced edges; strengths from
`physics/`; persisted per-session gate state; the prospective horizon; the observer
predicate; the lived day.
**Outputs** — a rendered injection (empty string, affect flag, footnotes, or a surfaced
gist); a decision record (tier counts, ids, salience — content-by-reference); reference
credit at the boundary; reinforcement deltas handed to `physics/`.

**Guarantees** — **[M]** mechanized · **[A]** advisory:

1. **[M]** No generative model call on the hot path, asserted by a test that enumerates call
   sites. An embedding lookup is permitted and must degrade to lexical-only.
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
2. **Does the ambient path embed at all on a cold cache?** v1's did, inside its own latency
   race, which is how "no second LLM call" quietly became untrue.
3. **Does `associate/` fold in here** (traversal), with its arithmetic going to `physics/`?
   The module map's standing check-in question; owned by `associate/`.
4. **Is the "quietly available / ignorable" framing actually ignorable to a model?** v1
   shipped it as a deliberate probe question and never answered it.
5. **Is the relative bar calibrated for a distribution that is no longer dominated by
   outliers?** Length normalization removed the nine hubs that were setting `sd` on every
   turn, and the bench measured the consequence: over the same 13 prompts, delivered items
   went 32 → 83 and the LOUD tier went 4 → 26 — "came clearly to mind" on every turn, where
   §3 says *rarely*. Two readings are live and only the live run can choose: either the gate
   is finally seeing a distribution with real signal in it (an on-point memory now stands
   out where nothing could stand out from a wall of hubs), or `SNR_GLOBAL` / `SNR_STRONG` /
   the absolute `FLOOR_STRONG_*` values are calibrated against the OLD scale — short
   documents score up to ~1.6× their previous value under normalization, so an absolute
   floor admits more than it used to. Deliberately not retuned in the same change that moved
   the scale: two calibrations at once measure neither.

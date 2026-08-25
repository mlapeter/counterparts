# `tools/replay/` — CONTRACT

## 1. Purpose

The validation harness: feed v1's recorded month of real inputs through Counterparts and
compare against the distributional baselines, with an honest verdict vocabulary.

## 2. Brain analog

None — this is an instrument, and its entire design constraint is the anti-Heisenberg
deviation `observe/` names: **an instrument must leave the store as it found it**
(constitution line 11, "evidence over ceremony"; scar E7).

## 3. Keeps

- **The exact-match / distributional split, per stage.** [v1] behavioral-spec §17.3. Exact:
  the gate battery; every refusal by reason; the lived-day clock around the boundary hour
  (the 3:59/4:01 edge is a named unit test); occasion counting; revision arithmetic and
  close reasons; prospective eligibility, ramp shape, window arithmetic, and the four
  brakes; strength, band assignment, and decay steps given a fixed clock; preselection's
  **lexical** channel; briefing budget arithmetic and trim order given a fixed store.
- **Activation and gate arithmetic exact-match ONLY with pinned vectors.** [v1] §17.3 —
  the sharpest empirical result in the harvest: across one real code change *every tier
  decision, cue hit, and inhibition was identical*, with the only difference third-decimal
  background drift from refetched embeddings. **Compare tier sets and orderings, never
  activation floats, when the vectors differ.**
- **Distributional comparison for everything nondeterministic**, with v1's own honest
  band: *ingestion is nondeterministic; equivalent code scored 63–75% across runs of the
  same benchmark*, and per-category moves of ±0.1 are noise. **Adopt that band rather than
  re-deriving it.** [v1] §17.3.
- **Not comparable, and say so**: anything measured on a different model seat is a new
  baseline, not a regression check. [v1] §17.3.
- **A four-value verdict vocabulary: pass / fail / needs-rater / not-exercised.** [v1]
  §17.2 — nothing is ever silently passed, and an unexercised criterion says so. This is
  the same discipline as scar §2.4's "a zero is not a pass."
- **The independent-scorer rule.** [v1] §17.2 — the scorer implements its own window
  arithmetic rather than calling the code under test: *a shared bug must not grade itself.*
- **Totality tripwires that source-scan the repo** rather than trusting a list: every event
  type has a production emitter or is explicitly reserved; every path where text becomes
  canonical is a known-gated caller; only the owner path reaches destruction; the harness
  is structurally unable to touch a real store. [v1] §17.2 — *the highest-leverage
  conformance mechanism in v1 and the cheapest to port.*
- **A machine-readable pass record a runtime switch actually reads.** [v1] §17.2 — *the
  gate is not a document; it is a precondition.*
- **The carry-forward rule**: a human-rated verdict carries across a code change **only
  when the machine-scored surface set is provably identical.** [v1] §17.2.
- **One content-address function joins the corpora** — the same short content hash names a
  raw span, a chunk in a run record, and a rejected proposal. [v1] §17.1.
- **The two richest comparison surfaces**: the per-turn surfacing decision record (tier
  counts, affect flags, ids with salience) and the per-cycle consolidation summary vector.
  Both content-by-reference, so both compare without ever handling memory text. [v1] §17.3.
- **The pre-committed bars, restated**: surfacing hard trips (a sacred-salience memory
  reaching the loud tier on a generic name or pure recency = 0, machine-scored; loud-tier
  off-topic intrusions ≤5%, human-rated); retune bars (footnote flood >40% fails,
  affect-flag noise >25% fails, name-smear >50 memories per name fails); coverage floors
  (≥60%); emotion fired-cue **precision** ≥0.80; the prospective PR-A…PR-F table. [v1]
  §17.2. **The discipline is the harvest; the specific bars are calibration.**

## 4. Drops / simplifies

- **Input-for-input replay of interpretation is bounded by what exists.** v1's raw-span
  archive reaches back only the rolling 30 days (782 spans, ~9.3 MB); everything older can
  be compared **distributionally only**. v1 keeps rolling the window forward while it runs,
  so replay depth stays ~30 days whenever v2 is ready. Settled by measurement
  (replay-baselines §2), not by choice.
- **The embedding cache must be pinned to one model generation explicitly.** v1's cache
  holds two — `voyage-3-large` (13,664 rows, current) and `voyage-3.5` (9,600 rows,
  legacy) — in the same table, keyed per model. A replay that says "reuse the cached
  vectors" without naming one is undefined.
- **The blind-rate target is a range, not a number.** **PROPOSED** — owner call at
  check-in on the gate's wording. v1's standing figure of 22% was a six-day sub-window; the
  full-window rate is 17% with 0–78% daily swings on 4–45 events a day. The honest gate
  says *roughly a fifth to a quarter, on a metric that needs weeks to stabilize* — and a v2
  gate that names a precise percentage would be measuring noise.
- **A confidentiality criterion that was never exercised is not inherited as a pass.** v1's
  A3 (a confidential memory surfacing in a shared session = 0) never ran, because no
  shared-session flag was ever set. **v2 either exercises it or drops it honestly** (§17.2).
- **v1's longmemeval standing score does not travel.** It was measured on a smaller model
  seat than the one later pinned; a re-run is a new baseline, not a regression check.

## 5. Contract

**Inputs** — v1's stores, **read-only, through explicitly-designed paths**: the raw span
archive, the interpreted store, the committed fixtures and run outputs, the emotion
corpora (authored and held-out), the event logs, the criteria ledger, and a pinned vector
generation.
**Outputs** — a scorecard per run with a four-value verdict per criterion; distributional
comparisons against `docs/harvest/replay-baselines.md`; a machine-readable pass record;
divergence logs.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] The harness cannot touch a real store.** It creates its own temporary directory
   unconditionally, **errors** if it finds a pre-set data-directory variable rather than
   honoring it, realpaths both sides of every path comparison, and removes only the
   directory it created (scar §2.13 — v1's own replay harness silently honored an exported
   variable while its header claimed a throwaway directory, and its store-builder
   unconditionally overwrote the graph file).
2. **[M] Reads of v1 stores are read-only, and `~/.bansai` and `~/.claude-engram` are never
   written under any code path.** A test asserts the open modes.
3. **[M] The harness runs under observer** — it strengthens nothing and deposits nothing in
   any store it reads (scar E7).
4. **[M] Every criterion returns one of four verdicts**, and a run containing a
   `not-exercised` cannot be reported as a clean pass.
5. **[M] The scorer implements its own arithmetic** for every criterion it grades, and a
   test asserts the scorer does not import the module under test.
6. **[M] Replay exercises the real host path, not an in-process loop.** This is the
   harvest's disposition on v1's dark behaviors: session dedup, the emotional refractory,
   cue zeroing, and cross-session carry-over were implemented and *tested* — because the
   harness threaded a context across an in-process loop — and inert in production, because
   the turn hook discarded per-session gate state. **A harness that constructs state the
   production path never has is measuring a system that does not exist.**
7. **[M] Vectors are pinned by model generation, named in the run record**, and any
   exact-match retrieval claim states which generation it used.
8. **[M] The acting model seat is recorded in every run record.** v1 added this precisely
   because "which seat actually ran" had been unanswerable for months, and it is what makes
   the not-comparable rule enforceable.
9. **[M] Totality tripwires source-scan the repository** rather than trusting a maintained
   list, and each fails the build when a new member is unmapped (scar §2.4 — v1 had 17 of
   53 event types lighting nothing, and one such test, born green, would have caught six
   separately-filed findings at once).
10. **[A] The specific bars are v1's calibration.** Re-earn them; do not inherit them. The
    discipline — commit the bar *before* the mechanism is allowed on — is what travels.
11. **[M] Definition of done is unchanged: verified live, not merged.** Replay plus
    clock-simulated decay covers most verification; **a 1–2 week parallel run beside v1 is
    the irreducible live-verify** (§17.4). Every live verification in v1's history found
    bugs its tests didn't.

## 6. Scars honored

**E7** (the harness is an instrument and leaves the store as it found it) · **E8**
(clock-simulated decay runs on lived days; the boundary-hour edge is a named test) ·
**§2.4** (a zero is not a pass — the four-value vocabulary and the totality tripwires are
this scar's instruments) · **§2.8** (every threshold the harness grades names its
calibration inputs, so changing the embedding model or the chunk shape visibly re-opens
it) · **§2.13** (harness isolation: no environment default, realpath both sides,
own-directory-only cleanup) · **§2.17** (the harness reports created-versus-exited per kind,
which is how a starved curation path becomes visible) · **§2.20** (every comparison surface
is content-by-reference).

## 7. Open questions

1. **Is a portable snapshot of the raw spans and the vector cache taken before the window
   rolls?** replay-baselines §2 records where they live and explicitly does not extract
   them — "a follow-up action, not something this pass performs." Every day this is
   deferred, a day of input-for-input replay depth is lost permanently.
2. **What does "same behavior" mean for interpretation when the authorship path has
   changed?** v1's spans were interpreted by a sweep; v2's are written by the experiencer.
   The corpora can validate the sweep-as-fallback and everything downstream, but **the
   primary path has no v1 counterpart to replay against** — it can only be measured
   forward, which makes the parallel run more load-bearing than replay.
3. **Are the legacy `voyage-3.5` vectors a fixture to carry or dead weight to drop?**
   Recorded as an explicit v2 decision in replay-baselines §2 and not made.
4. **Which emotion precision number is cited** — 0.909 or 0.846? The harvest records both
   for the same gate on the same date (Appendix A #3); the scorecard is the tiebreak, and
   a v2 claim should cite exactly one.

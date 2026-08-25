# `encode/` — CONTRACT

## 1. Purpose

What gets in: the gate battery every proposal passes, the salience tags it carries, and
the computed novelty that makes prediction error a number.

## 2. Brain analog

Attention selecting what is worth encoding, plus amygdala tagging that marks emotional
material for preferential consolidation. **Named deviation** (constitution line 12): the
secrets gate has no biological analog — the brain has no interlock that refuses to encode
a credential. It is a deliberate, non-ablatable addition.

## 3. Keeps

- **The gate battery, all five checks, engine-side, no model in the loop.** [v1]
  behavioral-spec §3: **secrets** (redact; empty after redaction ⇒ reject), **precision**
  (auto-hedge dates, years, and quoted strings not in the source — softening, never
  dropping), **aliases** (must occur verbatim in the source, *and then pass their own
  secrets scan*), **emotion** (stated-only: a cited quote the span contains plus a named
  subject; the quote is stripped before the feeling becomes durable), **content floor**
  (empty / stub token matched exactly after normalization / under a minimum length ⇒
  refused as degenerate).
- **The content floor as a named earned mechanism.** [v1] earned-mechanism #3 — v1's
  model-bake-off minted a literal `"placeholder"` trace that passed every other gate.
  v1 calibration: 20 characters / 3 words, set at about half the shortest real memory in
  its own fixtures. TUNABLE.
- **A fully-gated chunk moves NO durable state** — not strength, not `uses`, not a
  revision, not an entity mention. [v1] §3 G2, earned-mechanism #15.
- **Gates run on proposals, before anything is durable** — never as a post-hoc sweep.
  [v1] §3 G3.
- **A refused proposal is not a failed batch.** Rejection is data. [v1] §3 G6.
- **The emotion exemption cannot widen**: exactly one recognized provenance — the author
  stating its own feeling about its own span. A claim about someone else's interior always
  takes the ordinary path, where a transcript exists to check it against. [v1] §3 G5.
- **Ops carry their own rules**: a secret in a *name* rejects the whole operation ("a
  credential must never become an entity the store indexes"); a matching key that never
  persists is exempt from hedging ("a name is not a claim"). [v1] §3.
- **Four-dimensional salience tagged at write time.** [v0] `{novelty, relevance,
  emotional, predictive}`, each 0–1, scored once, fixed at birth.
- **Novelty is prediction error against schema expectations** — computable, not a model
  opinion. [v0 dimension, v1 mechanism] §8; the number and its inputs live in
  `physics/` §5.2.
- **Encode-time preselection, two channels UNIONED.** [v1] §8, earned-mechanism #1: a
  precise lexical channel (name or alias, **as a whole word**) that never gives ground,
  plus a semantic channel that only ever *adds*. Whole-word matching has **one definition,
  shared with entity birth**.
- **Blindness is measured, not assumed.** [v1] §8 G5, scar §2.9 — every chunk shown zero
  schemas is counted, with per-channel attribution by id, not by count.
- **Beliefs and current state render verbatim; identity core renders compressed.** [v1]
  §8 G7 — "a paraphrase of a belief cannot be honestly confirmed or contradicted."
- **Emotion is typed, attributed, and absent-means-null, never neutral. Retro-typing
  emotion is forbidden.** [v1] §4.2 G5.
- **Task-state is not memory**, discriminated at encode time by one question: *would this
  still be a true memory worth holding after the date passes?* [v1] §4.2 G10.

## 4. Drops / simplifies

- **The interpreter's closed operation vocabulary shrinks to what the experiencer can
  actually declare**: content, salience, kind, scope, feeling, aliases, handles,
  `updates:`, `unresolved`. Belief-supersede, protected-add, thread-open/close, and
  schema-create leave the vocabulary — revision is `updates:` (owner decision, settled),
  entities are born by mention (owner decision, settled), and loops are ordinary memories
  with an `unresolved` flag (v1's own recorded v2 direction, §6.3).
- **The self-store tool's salience clamp survives; the tool does not.** The v1 self-store
  is **superseded by** experiencer authorship — self-writing became the primary path, not
  a channel the model must remember to call. The clamp (a claimed salience is a floor,
  mechanized) moves to `physics/` §5.2, where it now governs *every* memory rather than
  one tool's output.
- **Substring name matching is gone** (v1 measured the cost: the self schema is *named*
  "self", so 21% of its matches came from the English inside "myself" and
  "self-contained"). Whole-word only, one definition. Settled by measurement.
- **Emotion classification does not ship enabled.** It re-earns its ≥0.80 fired-cue
  precision bar against a held-out reference set before the channel turns on (§17.3: "do
  not enable a channel on a rewrite's promise").

## 5. Contract

**Inputs** — a proposal (content, author-claimed salience, kind, scope, optional feeling
with its quote and subject, optional aliases, optional `updates:`), the source span, the
schema slice the proposal was encoded against, the lived day.
**Outputs** — an accepted-and-possibly-redacted proposal, or a refusal with a reason;
computed novelty or an explicit null; per-channel preselection attribution; gate
telemetry by reference.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] The secrets gate is not ablatable.** No off switch, no A/B arm, no bypass —
   enforced by a universality test that source-scans every caller of the paths where text
   becomes canonical, including every outpost. *A prompt is not exempt from the gate.*
2. **[M] All five checks run on every proposal**, in one battery, before anything durable.
3. **[M] A fully-gated proposal moves zero durable state**, asserted per state kind, not
   per happy path.
4. **[M] Aliases pass their own secrets scan** after the verbatim-in-source check.
5. **[M] The emotion exemption is set per proposal by the engine that minted it**,
   evaluated against that proposal's own span, only when the subject is the author itself
   and the feeling is non-empty.
6. **[M] Every stated privilege is mechanized or is not stated.** v1's plain "remember
   this" note claimed a high-salience floor **only in its prompt**, with no engine
   backstop — the one place a stated guarantee had no enforcement (§4.1 known gap). Here
   the floor is the clamp in `physics/` §5.2, and the prompt states nothing the engine does
   not enforce.
7. **[M] Preselection happens once per chunk**, so the prompt builder and the blind-rate
   counter can never disagree about what the author saw.
8. **[M] The semantic channel is degradable by construction**: no embedder, no cached
   vectors, or an embedding failure yields an empty semantic set and a **loud skip** —
   never a thrown chunk. Worst case is exactly lexical-only. *Deliberately off is silence;
   a failure is a skip*, and the two are distinguishable in telemetry.
9. **[M] Zero-context encoding is counted and its output is measured**, not invisible.
   v1's residual blind rate was ~a fifth to a quarter of chunks and 7 blind chunks minted
   16 real memories.
10. **[M] Every gate firing is content-by-reference**: gate name, kind, hashes. Never the
    secret, the quote, or the body.
11. **[M] Three distinct records per gate**: "rejected", "refused by design", and "never
    invoked" — the by-design case flagged structurally **at the refusal site**, never
    inferred later by pattern-matching a message (scar §2.4).
12. **[A] Hedge phrasings, the stub vocabulary, and the floor's exact minimums are
    preferences.** That the floor *exists* is mechanized.
13. **[M] Every threshold here ships with a recorded calibration against a real corpus and
    a fixture-bounded window naming what breaks on each side, or ships disabled**
    (scar §2.8).

## 6. Scars honored

**E1** (the preselection semantic channel degrades to empty, never throws) · **§2.6**
(mechanize invariants; instruct only preferences — guarantee 6 is this scar's direct
descendant) · **§2.7** (a gate covers every ingestion path *and every side-channel*) ·
**§2.8** (no threshold ships unmeasured) · **§2.9** (the encoder must see what its output
can affect, and context assembly logs what it showed, by id and by channel) · **§2.14**
(a degenerate-but-well-formed proposal is rejected by the content floor) · **§2.16**
(every model-facing operation carries an admission test and a named negative example) ·
**§2.20** (content-by-reference at the gate boundary).

## 7. Open questions

1. **The `encode`/`remember` boundary — one of the module map's three standing check-in
   questions.** With the experiencer's end-of-session write as the primary path, span
   capture survives mainly as crash-fallback input. Does `encode` shrink to
   gates-and-tagging *inside* `remember`'s pipeline, leaving no separate module? The
   argument for keeping it separate is that the gate battery is the one thing every
   entrance must traverse (scar §2.7), and a module boundary is the cheapest way to make
   "every entrance" checkable. The argument against is constitution line 10: one brain
   function per module, and attention-plus-tagging is arguably part of encoding, not
   beside it. **Left open deliberately.**
2. **Does the semantic preselection floor need recalibrating for a different text
   length?** v1's 0.60 floor was calibrated on trace-length text and applied to
   chunk-length text; the harvest names the dilution risk and never resolved it.
3. **Is precision-hedging still the right shape** when the author is the mind that lived
   the session rather than a sweep reading a transcript? Hedging is a confabulation brake,
   and the confabulation risk is lower in-the-moment — but not zero.

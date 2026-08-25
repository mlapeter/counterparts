# `encode/` — NOTES

Working notes beside the contract. **`CONTRACT.md` is the spec; this file never
edits it.** Where the contract was silent, or where two readings were available,
the choice made in the code is recorded here so the next reader does not have to
re-derive it — and so the owner can overrule any of it cheaply (constitution
line 13: decisions are defaults).

*(First build, 2026-08-25.)*

## Ambiguities resolved — simplest reading, recorded

1. **Encode returns INTENTS; it never writes.** The contract says a fully-gated
   proposal moves zero durable state, but never says who moves state on the happy
   path. Simplest reading: encode is pure, and its entire output surface for
   durable change is `DurableEffect[]`, which `remember/` applies. That makes
   guarantee 3 structural — encode holds no store handle, so "moves zero durable
   state" is not a discipline anyone has to keep — and it makes the enumeration
   scar §7 asks for cheap: the effect union names every state kind a chunk could
   move, so the test asserts per state kind rather than per happy path.

2. **The universality test is a two-part promise, and only one part can exist
   yet.** Guarantee 1's full form source-scans *every caller* of the paths where
   text becomes canonical, "including every outpost". `remember/`, the adapters,
   and any import path do not exist yet, so that half is **deferred to the
   coordinator** — it is a suite-level test, not an `encode/` test. What ships
   here instead is the half that does not depend on callers: **every
   text-returning export of this module runs its output through `redactSecrets`
   before returning**, whatever order a caller invoked things in. A caller that
   reaches past the battery still cannot get an unredacted string out.

3. **Non-ablatability is enforced four ways, none of them a comment.** (a) No
   function in `secrets.ts` takes an options object, so there is nowhere to put a
   flag; (b) `SecretsGateStatus` excludes `"stood-down"`, so the disabled state
   is not representable in telemetry; (c) `assertNoSecretsBypass()` refuses at
   runtime any option key matching `/secret|redact|credential/i`, which stops an
   untyped JavaScript caller too; (d) the output-side redaction of (2).

4. **"All five checks run" is literal — no short-circuit on refusal.** The
   battery runs precision, aliases, emotion, and the floor even after secrets has
   already rejected the proposal. A short-circuit would report one reason and hide
   three, and "all five ran" would stop being checkable from the records. Cost:
   a few microseconds on a proposal that is going to die anyway.

5. **Refusal reasons collect like physics' verdicts.** `blockedBy` carries every
   blocking reason and `reason` is the first — the same shape as
   `promotionEligibility()` and `pruneVerdict()`. An all-secret proposal reports
   BOTH `empty-after-redaction` and `content-empty`, because both are true.

6. **A secret is never hashed.** The contract's telemetry vocabulary says "gate
   name, kind, hashes", but `hashText()` of a low-entropy credential is
   reversible — the store already names this hazard (§16 G9, `RemovalNote`
   carries no content hash for exactly this reason). Findings therefore carry
   **family + count + site**, and the only hash logged is the hash of the
   REDACTED content.

7. **Whole-word matching is case-insensitive, with no option.** "Verbatim in the
   source" is a claim about the words, not about the shift key. An option is how
   two callers drift apart, and §8 G3 requires *one* definition shared with schema
   birth — so `occursAsWholeWord()` takes no flags. `schemas/` must import it
   rather than write its own.

8. **Hyphens and apostrophes are word characters.** This is what makes "self" fail
   to match "self-contained" — v1's measured false positive, worth 21% of the self
   schema's matches. It also means a hyphenated name ("claude-code") matches as
   one word, which is the behavior you want anyway.

9. **A secret in an alias DROPS THE ALIAS; a secret in a name REJECTS THE
   PROPOSAL.** Both come from §3, and the asymmetry is deliberate: an alias is a
   retrieval handle, so losing it costs a retrieval, while a *name* becomes an
   entity the store indexes, and "a credential must never become an entity the
   store indexes" is the ops rule. Aliases and handles are both exempt from
   *hedging* ("a name is not a claim") and neither is exempt from the secrets scan.

10. **Precision hedging runs in ONE pass over the original content.** A second
    pass turns "mid-July 2026" into "mid-July around 2026". Alternation order is
    therefore load-bearing: a quoted region is consumed whole before anything
    inside it is considered, and a month+year is consumed before the bare year
    inside it can be hedged separately.

11. **Month+year is consumed but not changed.** Month-level *is* the hedge
    granularity v1 chose ("mid-July"), so "July 2026" is already at the target
    precision. It is matched only so the `2026` inside it cannot be separately
    hedged to "around 2026".

12. **The floor measures redaction-stripped text.** `[REDACTED:google-api-key]` is
    26 characters of nothing; counting it would let a proposal that was entirely
    a credential clear a length floor. Stripping first is also what makes an
    all-secret proposal report both of its true reasons (note 5).

13. **The emotion exemption waives the quote requirement, nothing else.** §5 G5
    says the exemption is evaluated "against that proposal's own span, only when
    the subject is the author itself and the feeling is non-empty". Reading: when
    the span *is* the author stating its own feeling, requiring a citation from
    the span is circular, so the citation is waived — the type and subject
    requirements are not. A flag set on a claim about someone else's interior is
    `exemption-not-available`, refused at the refusal site.

14. **No emotion classifier is built.** §4 says the channel does not ship enabled
    until it re-earns a ≥0.80 fired-cue precision bar. Building it disabled would
    be machinery in anticipation of a failure (Amendment 15), so it does not
    exist — and because it does not exist, `emotionClassifierRecord(true)` reports
    `skipped`, not `ran`. Asking for a channel that is not there is loud; leaving
    it off is silence.

15. **Novelty is computed against the SHOWN slice, not against every schema.**
    Prediction error is error against what the author could actually see; a schema
    preselection never showed cannot have been predicted from. A consequence worth
    naming: a blind chunk has a null novelty *by construction*, so the blind rate
    and the null-novelty rate are the same measurement, which is the property
    §5 G7 wants (the prompt builder and the counter cannot disagree).

16. **Task-state discrimination is not a battery gate.** §3 keeps "task-state is
    not memory, discriminated at encode time by one question: would this still be
    a true memory worth holding after the date passes?" That question is answered
    by the *author*, not by an engine-side check — there is no computable test for
    it — so it belongs to `remember/`'s authorship ask and `prospective/`'s
    arming, not to a gate that runs with no model in the loop. Named here so the
    omission is a decision rather than an oversight.

17. **Observer suppresses effects but still computes.** Encode holds nothing
    durable, so there is no store seam here to refuse at; the honest v2 shape is
    that an instrument may *measure* the gates and emits no intents. The
    stand-down is logged (`encode.observer.standdown`), so a stood-down instrument
    stays distinguishable from a broken hook (scar E7, observer-mode G5/G6).

## Calibration status (scar §2.8, guarantee 13)

Every threshold in `tunables.ts` carries the v1 measurement it inherits and a
window naming what breaks on each side. Two carry a **standing warning**:

- `SEMANTIC_FLOOR = 0.60` was calibrated on **trace-length** text and is applied
  here to **chunk-length** text. This is contract open question 2 and v1's own
  live watch. It must be recalibrated on the text length v2 actually sees before
  anyone trusts the number.
- `FLOOR_MIN_CHARS / FLOOR_MIN_WORDS` inherit v1's fixture calibration, not a
  measurement against v2's corpus, which does not exist yet. Re-measure at replay.

## Open, for the coordinator

- The `encode` / `remember` boundary (contract open question 1, module map's third
  standing check-in question) is **untouched by this build**: encode is a separate
  module with one chokepoint, which is the argument *for* separateness. Nothing
  here forecloses folding it into `remember/`'s pipeline later.
- The cross-module half of the universality test (note 2) belongs to the suite,
  once there are callers to enumerate.

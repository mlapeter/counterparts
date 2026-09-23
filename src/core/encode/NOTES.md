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

18. **The AWS SECRET access key is caught by context, never by shape alone** (2026-09-23,
    handoff INTERFACE-GAPS §6; hardened by the PR #189 review). The key id has a prefix
    (`AKIA…`) and always had a family; the 40-character secret beside it has none — it is
    base64's alphabet, and that shape alone also matches a CamelCase identifier or a path.
    The 09-20 review measured the consequence: id redacted, secret stored verbatim, in a
    handoff and, by the same battery, the journal and the self page.
    `aws-secret-access-key` is three patterns under one family name:
    (a) the value under its own NAME — `aws_secret_access_key`, `AWS_SECRET_ACCESS_KEY`,
    `"SecretAccessKey"`, `aws configure`'s prompt, and the four forms with no `=` (review
    M4): `aws configure set aws_secret_access_key …`, a Dockerfile `ENV …`,
    `os.environ["…"] = "…"`, XML `<SecretAccessKey>…`. The value must carry a digit, `/`
    or `+` as well as a letter, so a prose word after the name is not taken (review m8);
    (b) a fenced, mixed-case 40-character token within 200 characters AFTER a key id; (c)
    the same BEFORE one. (b) and (c) anchor on the id's PLACEHOLDER — so text an older
    build half-redacted is finished by a re-scan — through a LOOKBEHIND and a LOOKAHEAD,
    not inside the match: the first version consumed its anchor, so one id redacted one
    token and a repeated secret, an old and a new one, or two ids followed by two secrets
    left the second verbatim (review M3). And every value any of the three captures is
    then redacted EVERYWHERE else it stands, in one linear pass over the text's maximal
    base64 runs (`propagate`): one verbatim copy further down is the whole leak.
    Near a key id, two kinds of PATH are left alone (review m8): a run straight after `~`
    or `.`, and one that starts at a well-known absolute root (`/Users/`, `/home/`, …). A
    bare leading `/` is NOT excluded — one real secret in 64 begins with one, and the cost
    of the other error is a redacted path. A bare 40-character token with no name and no
    id nearby is LEFT ALONE: a declared non-goal. Proved in `test/secrets-aws.test.ts`,
    including every entrance.

19. **The catch-all's fence was the ROOT cause, and is fixed for every name** (2026-09-23,
    PR #189 review M5). `assigned-credential` began with `\b`, and an underscore is a word
    character, so it never fired inside a snake_case name: `DB_PASSWORD=…`, `JWT_SECRET=…`,
    `AWS_SESSION_TOKEN=…`, `HF_TOKEN=…` were stored verbatim through every entrance. It is
    fenced now by "no letter or digit before" (`(?<![A-Za-z0-9])`), the JSON form's closing
    quote may sit before the `:`, and `session_token` joins the list. The TRAILING `\b`
    stays and is the false-positive guard: a name must END in the keyword, so
    `MAX_TOKENS`, `TOKEN_URL`, `SECRET_ROTATION_DAYS` and `PASSWORD_MIN_LENGTH` never match.
    A value that is a small integer (five digits or fewer), a boolean or a null word is a
    setting, not a credential, and is left alone; six digits or more under a
    password-shaped name is still redacted, because a numeric password is a password. A
    QUOTED placeholder is recognised as a placeholder too — without that, the widened
    fence let this family re-redact the AWS family's own `KEY="[REDACTED:…]"`.

20. **The re-review's residuals (PR #189, R2–R4, R6, R10), and the trades they cost**
    (2026-09-23).
    - **Every copy, as a literal** (R2). Propagation now replaces every LITERAL
      occurrence of a caught value, fenced only by "no letter, digit or `+` either side",
      so a copy glued on by `=`, `/`, `?`, `&`, `:` or `@` (`export SK=S1`, `?sk=S1&`,
      `s3://bucket/S1/obj`) is taken; the run-match it replaces never saw those. And
      beside a key id, a token straight after `identifier=` (`key=S`, `sk=S`) is the
      pair's first copy. Values travel only if `propagatable`: eight characters or more,
      no whitespace, and a digit, both cases, or a symbol other than `-_.` — so
      `secret: "production"` does not take every "production" in the text with it.
      Propagation now covers every NAMED family, not only AWS (R4).
    - **Hard-coded fallbacks** (R3): the AWS name may be followed by `, "…"`, `|| "…"` or
      `?? "…"` (`os.getenv("…", "S")`, `process.env.X || "S"`). The generic catch-all takes
      `||` and `??` but NOT the `, "…"` form: with names as common as `token`, it matched
      every JSON array of strings and every `"family":"…-key","count"` telemetry row, found
      the first time the store-walk test ran. So `os.getenv("DB_PASSWORD", "x")` is caught
      only if its value is caught some other way.
    - **More names** (R4): passwords get their own pattern — four characters are enough,
      and `,` / `;` may be inside one; `pgpassword` and `secret_key_base` are keywords; a
      case-SENSITIVE pattern takes camelCase (`dbPassword`, `apiToken`, `webhookSecret`) and
      SCREAMING prefixes glued to PASSWORD (`MYSQLPASSWORD`). A bare camelCase `Key` is
      not a keyword (`primaryKey`, `sortKey`, `cacheKey`).
    - **Settings, not secrets** (R6), in code (`isSetting`) rather than a lookahead: a
      boolean or null word; a number — EXCEPT six digits or more under a password-shaped
      name, which is a PIN (a deliberate difference from "purely numeric is a setting":
      `input_token = 123456` stays, `DB_PASSWORD=12345678` is redacted); unquoted, a code
      reference whose first identifier has no digit (`self._refresh`,
      `settings.DB_PASSWORD`, `Optional[str]`, `os.environ["X"]`); unquoted after a `:`, a
      type name (`str`, `SecretStr`, a CamelCase word of letters only). The trade: a
      password that is itself a digit-free dotted word (`my.pass.word`) or, after `:`, a
      two-part CamelCase word (`HunterTwo`) is read as code and left alone.
    - **Letters-only secrets** (R10): the named form also takes exactly 40 mixed-case
      letters — the ~1 in 4,000 AWS secrets with no digit, `/` or `+`. A prose word after
      the name is never 40 letters.
    - **Left**: a 40-character RELATIVE path beside a key id (`src/…`, review N2) is still
      redacted — over-redaction, the safe direction.

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

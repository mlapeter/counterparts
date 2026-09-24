# `encode/` — interface gaps for the coordinator

*What `encode/` needed from another module and could not have, and what another
module will need from `encode/` before the wiring can be right. Nothing here is
implemented in `encode/` — the whole point is that these are decisions for the
seam, not for one side of it.*

## 0. Nothing was stubbed

`physics/` and `store/prose.ts` covered every arithmetic and content-address need:
`clampSalienceAtSeam`, `novelty`, `cosine`, `sal`, and `hashText` were all present
and all sufficient. **No local stub of a store or physics API exists in this
module**, and encode imports exactly one symbol from `store/` (`hashText`, from
`store/prose.js`) — a test asserts that is the only one.

## 1. `remember/`'s `GateFn` seam does not carry enough to keep encode's guarantees

`remember/proposals.ts` declares the injected `GateFn` it will call, and
`remember/INTERFACE-GAPS.md` §2 names it as the wiring point. Its shape and
encode's do not line up, and **four of the mismatches are load-bearing** — a
straight adapter over the current `GateInput`/`GateVerdict` would silently drop a
mechanized guarantee. Listed worst first.

### (a) BLOCKING — the chunk-level guarantee has no chunk

**Closed 2026-09-24** — sweep chunks go through `encodeChunk` (`core/bridge.ts#gateSweepChunk`).

`GateFn` is per proposal. **"A fully-gated chunk moves NO durable state" (encode
§5 G3, scar §7b) is a CHUNK-level property**: it is scoped to *all-rejected*, and
it is what closes the element-level side channel — prediction checks, entity
mentions, and warmth updates from a chunk whose proposals were all refused.

A per-proposal gate cannot express it. Either:

- **preferred** — `remember/` calls `encodeChunk()` once per chunk and honors
  `result.effects` / `result.predictionChecks` (both empty when `fullyGated`); or
- `remember/` keeps `GateFn` for the per-proposal battery **and** takes on the
  all-rejected rule itself, in which case that rule needs its own test on
  `remember/`'s side and the scar is now guarded in two places.

The first is what encode is shaped for: `encodeChunk` is the module's one
chokepoint, and it already returns the per-proposal verdicts `remember/` wants.

### (b) BLOCKING — the emotion exemption cannot be set

**Closed 2026-09-24** — the exemption is engine-set from the proposal's source (`core/bridge.ts#verdictFor`, `selfAuthoredFeeling`).

Encode §5 G5: the exemption is **set per proposal by the engine that minted it**,
and encode never infers it. `GateInput` has no field for it. As written, every
self-authored feeling with no citable quote comes back `quote-missing` and the
feeling is dropped — the doctrine survives, the channel starves.

**Add to `GateInput`:** `selfAuthored?: boolean`. (`source: "jot" | "session-end"`
is not a substitute: an end-of-session dump can carry a feeling about the *owner*,
which must take the ordinary path.)

### (c) The claimed-salience floor is not reachable through this seam

**Closed 2026-09-24** — `claimed` and `salience` ride `GateInput` (`remember/proposals.ts`); the floor is clamped at mint (`core/mint.ts`, `clampSalienceAtSeam`, emits `salience.lifted`).

Encode §5 G6 exists because v1's "remember this" note claimed a salience floor
**only in its prompt**, with no engine backstop. The clamp lives at the
proposal→memory seam (`tagSalience` → `physics.clampSalienceAtSeam`) and emits
`salience.lifted` on any lift.

`GateInput` carries no `claimedSalience` and no dimensions, and `GateVerdict`
carries no salience back — so through this seam the floor is once again stated
somewhere and enforced nowhere. **Add `claimedSalience?: number | null` and
`dimensions?: {relevance, emotional, predictive}` to `GateInput`, and `salience`
to the `ok` verdict** — or route through `encodeChunk`, which already does it.

### (d) The ops rule has no input

**Closed 2026-09-24** — the author's `title` reaches the battery as a handle (`core/bridge.ts#verdictFor`).

Encode refuses the whole proposal when a *name or handle* carries a credential
("a credential must never become an entity the store indexes"). `GateInput` has no
`handles` field, so that refusal can never fire through this seam. **Add
`handles?: readonly string[]`.**

### (e) Lossy telemetry on refusal

**Closed 2026-09-24** — the refusal arm carries `blockedBy`, `records` and `refusedByDesign` (`remember/proposals.ts#GateVerdict`, filled by `core/bridge.ts#verdictFor`).

`GateVerdict`'s failure arm is `{ ok: false; gate: string; reason: string }` — one
gate, one reason. Encode returns `blockedBy` (every blocking reason) plus one
`GateRecord` per gate, always, including the `not-invoked` / `refused-by-design` /
`rejected` distinction that guarantee 11 and scar §2.4 exist for. Collapsing that
to a single string throws away the by-design flag *at the refusal site*, which is
precisely the thing §5 G11 says must never be re-derived by pattern-matching a
message later.

**Suggest:** `{ ok: false; gate: string; reason: string; blockedBy: string[];
records: GateRecord[] }`. Additive; the existing two fields keep their meaning
(`gate`/`reason` = the first blocker).

### (f) `span: null` is a silent capability loss, not an error

Encode checks aliases *verbatim in the source* and quotes *contained in the span*.
With `span: null`, every alias is dropped (`alias-not-verbatim-in-source`) and
every non-exempt feeling is refused (`quote-not-in-span`). That is the correct
conservative behavior, but it should be a **named, counted** condition at the
wiring site rather than a surprise in the alias-drop rate. Recommend the adapter
log a `gate.no-span` event when it passes a null span.

### (g) Cosmetic

`GateInput.feeling` spells the type word `feeling`; encode's `Feeling` spells it
`type` (with `quote`, `subject`). `GateInput` has no proposal handle; encode's
`Proposal.ref` needs one — the span hash or the buffer index will do. Both are
adapter-local renames.

## 2. `schemas/` must import encode's whole-word matcher, not write its own

**Closed 2026-09-24** — `schemas/aliases.ts` and `schemas/index.ts` import `occursAsWholeWord` from `encode/words.ts`.

behavioral-spec §8 G3 requires **one** whole-word definition, shared between
preselection and entity birth: "Birth must test a proposed name by *exactly* the
rule preselection uses, or the two drift and a name that 'was in the span' for one
is not for the other."

That definition is `encode/words.ts`, exported as `occursAsWholeWord`,
`wholeWordRegex`, `countWholeWord`, and `escapeRegExp`. **`schemas/` should import
them from `encode/`** rather than re-deriving the boundary rule. The rule is
subtle in exactly one way that matters: hyphens and apostrophes count as word
characters, which is what makes `self` fail to match `self-contained` — v1's
measured 21% false-positive rate on the self schema.

If the coordinator would rather this live in a neutral place, the file has no
dependencies and moves cleanly; what must not happen is two copies.

## 3. Not a gap, but the coordinator owns it: the caller-side universality test

**Partly landed 2026-09-23** (`test/secrets-aws.test.ts`, "every entrance takes BOTH halves
out"): a credential pair is pushed through every model-facing door that writes canonical
text — `note`, `session_end` (memories and its `handoff` field), `chapter`, `self_page` —
and through the crash fallback's mint, each read back from the store, and then every byte
of the store outside `spans/` is walked for either half. What it does NOT do is the
source-scan half — enumerate entrances from the code so a NEW one fails the test by
existing — which stays the coordinator's.

**Observed while there, not this module's:** the crash fallback's outgoing PROMPT is the
raw transcript (`fallback.ts#renderForSweep` → `interpret-client.ts`), and nothing puts it
through this battery before it leaves the machine; only the vector text is redacted
(`counterpart.ts#sweepFallback`). With the key-based sweep becoming an opt-in (roadmap C2)
it matters less, but a credential spoken in a crashed session is sent to the interpreter
as spoken.

*As filed:*

Encode §5 G1's full form source-scans **every caller** of the paths where text
becomes canonical, "including every outpost". Encode's own suite proves the half
that does not need callers (no disable flag exists; every text-returning export
redacts its output; an invented bypass option throws). The other half — enumerate
every entrance (steady state, migration, import, repair, replay harness, each
adapter) and assert each traverses the battery — is a **suite-level test that
belongs to the coordinator**, once there are entrances to enumerate. It is the
test that would have caught v1's ungated migration path and its three live keys.

## 4. `store/` LAYOUT — already filed by `remember/`

`remember/INTERFACE-GAPS.md` §1 asks `store/paths.ts` to classify `spans/`.
`encode/` does not touch the data dir and has no stake in the outcome; noted only
so the coordinator does not read two lists and count it twice.

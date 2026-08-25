# SEAMS — cross-module wiring obligations

*The no-cross-edits rule for parallel builds means every inter-module need lands here
(or in a module's INTERFACE-GAPS.md) instead of being hacked in. The coordinator wires
these deliberately. An item stays listed until a test proves the wiring.*

## Blocking before the pipeline composes (wave-2 findings)

1. **Chunk-level gated-means-gated across the remember→encode bridge.** remember's
   `GateFn` is per-proposal; encode's "a fully-gated CHUNK moves no durable state
   (including prediction checks)" is chunk-level. The fallback sweep must gate via
   `encodeChunk()` (or remember takes on the all-rejected rule with its own test).
2. **`GateInput` lacks the emotion exemption channel** — every self-authored feeling
   currently comes back `quote-missing`. Needs `selfAuthored?: boolean`, engine-set.
3. **`GateInput` lacks `claimedSalience`/dimensions and `handles`** — guarantee 6's
   floor and the ops rule are unreachable through the seam as typed; and the failure
   arm collapses `refused-by-design` into a single string.

## Queued (non-blocking, wire at the next seam pass)

4. **Observer predicate hoists to `src/core/observer.ts`** — store and remember both
   consume it; remember's `WRITE_SITES` + store's `WRITE_METHODS` become one
   cross-module totality test.
5. **`gate_session` table in store** — recall's per-session gate state is
   read-modify-written via meta; two writers can drop each other's records
   (scar §2.1 shape). Fix is a table, not merge-on-save.
6. **Alias map source** — recall enforces both halves of the ambiguous-alias rule but
   borrows the map from the caller; `schemas/` owns the alias index and must expose it.
7. **One whole-word rule** — `schemas/` imports `occursAsWholeWord` from
   `encode/words.ts`; a second definition is forbidden (§8 G3; hyphens are word chars).
8. **Salience clamp site** — `physics.clampSalienceAtSeam` runs at the proposal→memory
   minting seam (downstream of remember, which carries `claimed` and never re-judges).
9. **`kind` default** — remember defaults `"fact"`; if encode classifies kind, the
   default moves behind the gate verdict.
10. **`InterpretFn` adapter contract** — streaming, token headroom, detachment are the
    adapter's; `remember.validateWatchdog()` must be proven inside `STALE_CLAIM_MS`.
11. **`CandidateSource` + `IdResolver`** for `updates:` resolution come from
    store/schemas; `UPDATES_FLOOR`/`UPDATES_MARGIN` are CAL and uncalibrated.
12. **Caller-universality test** — once entrances exist (adapters), enumerate every
    ingestion entrance and prove the gate battery covers each (encode's caller-side
    half).

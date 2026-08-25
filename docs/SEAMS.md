# SEAMS — cross-module wiring obligations

*The no-cross-edits rule for parallel builds means every inter-module need lands here
(or in a module's INTERFACE-GAPS.md) instead of being hacked in. The coordinator wires
these deliberately. An item stays listed until a test proves the wiring.*

## Blocking before the pipeline composes (wave-2 findings)

**Items 1–3: CLOSED 2026-08-25** by `src/core/bridge.ts` + `test/bridge.test.ts`
(commit 50bbaa9) — kept below for the record.

1. **Chunk-level gated-means-gated across the remember→encode bridge.** remember's
   `GateFn` is per-proposal; encode's "a fully-gated CHUNK moves no durable state
   (including prediction checks)" is chunk-level. The fallback sweep must gate via
   `encodeChunk()` (or remember takes on the all-rejected rule with its own test).
2. **`GateInput` lacks the emotion exemption channel** — every self-authored feeling
   currently comes back `quote-missing`. Needs `selfAuthored?: boolean`, engine-set.
3. **`GateInput` lacks `claimedSalience`/dimensions and `handles`** — guarantee 6's
   floor and the ops rule are unreachable through the seam as typed; and the failure
   arm collapses `refused-by-design` into a single string.

## The wave-3 seam pass (consolidated from all module gap files, 2026-08-25)

A. **Observer hoist** → `src/core/observer.ts`; store's `WRITE_METHODS` + remember's
   `WRITE_SITES` become one cross-module totality test. (= item 4 below)
B. **`gate_session` table** in box 2, replacing recall's read-modify-written meta row.
   (= item 5)
C. **Alias wiring**: recall's `Turn.aliases` sourced from `schemas.aliasMap()`. (= item 6)
D. **Temporal cue wiring**: prospective `arrivals()` → recall `ActivationInput.temporal`,
   folded into cueScore, counted as cue by cueFraction, footnote-ceiling for
   cue-only-temporal candidates — per prospective's gap spec. NEVER into recall's
   recency arrival (opposite contracts, same word).
E. **`retargetOnSupersede` gets its caller**: the supersede executor (schemas revision
   path) calls associate's retarget in the same flow — scar §2.2 is live until wired.
F. **schemas↔self seam test**: identity core minted by `ensureIdentityCore` is indexed
   by schemas, and status-on-identity refuses with `status-on-identity-refused` (never
   `entity-unknown`).
G. **sleep→self render wiring**: `RenderFn = (ctx) => self.boundary({day, budgetBytes,
   horizon}).briefing` — budgetBytes joins sleep's cycle options from the host; horizon
   from prospective.
H. **Episode gate at the composition root**: episodes route through the battery via the
   bridge (self's episode gate default currently refuses everything).
I. **The `updates:` minting seam** — remember's minted proposals must write
   `doc.meta["updates"]` so sleep's dedup exclusion and the revision path can see it;
   currently enforced downstream and starved at the source (scar §2.6 shape — first
   priority).
J. **Box-3 `ranking` table + `Store.setRanking()`**, replacing sleep's side-sqlite
   workaround.
K. **Box-2 `events` table** (durable increments for schemas' `story()` + sleep's
   records), replacing in-memory rings where durability matters.
L. **`spread()` into recall** — conservative default chosen: spreading may RAISE
   footnote-tier candidates but never create loud-tier candidates without a cue
   (preserves recall's hard gate; revisable).
M. **`physics.consolidationEligibility()`** exported; sleep's inline criterion moves in.
N. **Freeze seam caller**: the minting/resolution path consults `self`'s freeze so
   self-claim repeats are counted-not-trained end to end.

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

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

A. **CLOSED 2026-08-25** — `store/observer.ts` MOVED to `src/core/observer.ts` (a move,
   not a rewrite: it still imports nothing). `store/index.ts` re-exports it, so both
   existing consumers changed import paths only. This also closes queued item 4. Proof:
   `test/seams.test.ts` — "exactly ONE definition of the predicate exists, at the hoisted
   path, importing nothing (observer-mode G1/G2)", "the store's public surface still
   carries the predicate (consumers change import paths only)", "stand-down totality spans
   BOTH consumers: every site in WRITE_METHODS ∪ WRITE_SITES emits".
B. **CLOSED 2026-08-25** — `gate_session` table in box 2 (`SCHEMA_VERSION` 2), ONE ROW
   PER RECORD, plus `Store.setGateRecords()` / `gateRecords()` / `pruneGateSessions()`.
   `recall/session.ts` writes rows instead of the JSON meta row, and the bound applies on
   both write and read. Closes queued item 5. Proof: `test/seams.test.ts` — "the
   interleaved load→mutate→save race that the meta row lost now loses nothing", "the
   keyspace has a real lifetime: pruneGateSessions sweeps on the active-day clock", "an
   unreadable scalar row resets, and says so — never a silent fresh start"; plus
   `test/recall.test.ts` — "the state lives in box 2 as ONE ROW PER RECORD with a defined
   lifetime (SEAMS B)".
C. **CLOSED 2026-08-25** — `src/core/retrieval.ts` (`composeTurn` / `recallTurn`) is the
   call site: `Turn.aliases` comes from `schemas.aliasMap()`, so the map stops being
   borrowed from a caller who can forget it. Closes queued item 6. Proof:
   `test/seams.test.ts` — "schemas.aliasMap() reports the ambiguity that recall's gate
   needs", "composed, an ambiguous handle sets trains:false and resolveUse REFUSES the
   credit", "WITHOUT the wiring the same turn trains — which is the gap this seam
   closes".
D. **CLOSED 2026-08-25** — `Turn.temporal` / `ActivationInput.temporal` folded into
   `cueScore` (the same map, so one activation number against the same background bar),
   counted as CUE by `cueFraction`, with a per-candidate `maxTier` ceiling and the new
   verdict `cue-only-temporal`; `src/core/retrieval.ts` maps `prospective.arrivals()`
   into it. `ARRIVAL_WEIGHT` is untouched. **One call the gap file was silent on:** a
   temporal cue is id-addressed, so it sets `trains: true` — without that clause a
   temporal-only surface would be refused as `ambiguous-handle-trains-nothing`, a true
   refusal under a false name (scar §2.4). Proof: `test/seams.test.ts` — "the cue reaches
   recall through the CUE channel and is counted as cue by cueFraction", "there is NO
   second injection path: recall's `arrival` is still pure recency", "a cue-only-temporal
   candidate is FOOTNOTED, and the record names the ceiling", "the CEILING is what stops
   it: the identical candidate goes loud without the cap", "a temporal cue TRAINS — it is
   id-addressed, so nothing about it is ambiguous".
E. **CLOSED 2026-08-25** — `SchemasOptions.retarget` is the injected callback (schemas
   may not import `associate/`, and the store may not depend on a module above it),
   called inside `supersedeBelief` immediately after the successor id exists. A retarget
   that THROWS is evented and does not undo a revision that already landed. Proof:
   `test/seams.test.ts` — "wired, the successor inherits the old head's live edges IN THE
   SAME FLOW", "UNWIRED, the same revision leaves the successor cold — the scar, live",
   "a retarget that THROWS does not undo a revision that already landed".
F. **CLOSED 2026-08-25** — no code change was needed: `Self.ensureIdentityCore` already
   mints the shape `schemas/` asked for (`type: "schema"`, `kind: "self"`,
   `meta.role: "entity"`), and the seam test proves the wiring end to end. Proof:
   `test/seams.test.ts` — "status-on-identity refuses with its OWN reason, never
   `entity-unknown`", "schemas actually INDEXES the core — the refusal is not an accident
   of a missing row", "a name that resolves to the identity core is not a birth site",
   "the core is idempotent — a second core is a category error", "a blank name mints
   NOTHING — the core's name is the owner's, and there is no default".
G. **CLOSED 2026-08-25** — `src/core/briefing.ts` (`selfRenderer`) is the one line:
   `BriefingContext` grows `budgetBytes`, `SleepOptions.budgetBytes` carries the HOST's
   reported ceiling into it (an argument somebody can see, not a constant hidden in a
   lambda — scar §2.18), and the horizon lane's ids come from `prospective.horizon()`.
   With no reported ceiling the renderer REFUSES and events `briefing.no-budget` rather
   than inventing one. Proof: `test/seams.test.ts` — "the wired cycle publishes a
   briefing the wake can read back", "the ceiling reaches the renderer: a smaller budget
   publishes a smaller briefing", "NO reported ceiling means NO render — an invented one
   is scar §2.18", "the horizon lane's source is prospective, and an observer renders
   nothing".
H. **CLOSED 2026-08-25** — `bridge.episodeGate()` routes episode ingestion through the
   real battery, so `self/`'s refusing `NO_GATE` default is unreachable in production.
   `EpisodeGateVerdict`'s ok arm grew an optional `text` (additive) and ingestion now
   stores the GATE's text, never the draft — a body credential is redacted like every
   other ingestion path, and a credential in a HANDLE refuses the whole ingestion.
   Proof: `test/seams.test.ts` — "UNWIRED, self's default refuses everything — an absent
   gate is not an open one", "wired, an ordinary episode ingests through the battery", "a
   credential in an episode body is REDACTED, and the redacted text is what lands", "a
   credential in a HANDLE refuses the whole ingestion (the ops rule)".
I. **CLOSED 2026-08-25** — `src/core/mint.ts` (`mintProposal`) is the proposal→memory
   seam: it writes the RESOLVED `updates:` id to `doc.meta["updates"]` (never the
   declared string; an unresolved declaration writes no key) and runs
   `physics.clampSalienceAtSeam` there and nowhere else (this also closes queued item
   8). Proof: `test/seams.test.ts` — "a resolved `updates:` declaration lands in
   doc.meta and sleep's dedup REFUSES the merge", "an UNRESOLVED declaration writes no
   key — a dangling address is not a merge exclusion", "the salience floor is clamped
   AT this seam and the lift is emitted (queued item 8)".
J. **CLOSED 2026-08-25** — `ranking` table in `cache/cache.sqlite`
   (`CACHE_SCHEMA_VERSION` 2, and in `resetCache`'s `TABLES` so `rebuildCache()` drops
   it), plus `Store.setRanking()` / `ranking()` / `rankingAll()`.
   `sleep/strength-cache.ts` gains `storeRankingCache()` and `runCycle` defaults to it
   wherever the port implements the writer; the side sqlite file survives only as the
   fallback for a port that does not. Proof: `test/seams.test.ts` — "a real cycle writes
   box 3's ranking table and opens no second sqlite file", "the ranking table is a
   CACHE: rebuildCache drops it, and the next tick restores it", "an observer cycle
   materializes nothing at all (the instrument writes no cache)".
K. **CLOSED 2026-08-25** — `events` table in box 2 with a partial-unique `dedup_key`
   (the replay latch that reconciles an append-only log with sleep §5 G3), plus
   `Store.appendEvent()` / `eventLog()` / `pruneEvents()`. `schemas.story()` now reads
   DURABLE increments and unions this session's ring on top; sleep's prune / promotion
   / merge records append beside their meta rows (the meta row still goes first, so §5
   G8's ordering is untouched) through an OPTIONAL `SleepStore.appendEvent`. Proof:
   `test/seams.test.ts` — "a revision story survives a RESTART: the increments are
   durable, not ringed", "the dedup latch makes an append-only log idempotent under
   replay (sleep §5 G3)", "sleep's prune record reaches the durable log beside its meta
   row, and a replay adds nothing", "the log has bounded retention, and a latched record
   is never swept".
L. **CLOSED 2026-08-25** — `Turn.spread` / `ActivationInput.spread` is the injected
   traversal (`Associate.spreadFrom`), wired at `src/core/retrieval.ts`. Read as option
   (a) of `associate/INTERFACE-GAPS.md` §1 — the option that file itself calls "the
   conservative default", and the only one under which SEAMS' own "(preserves recall's
   hard gate)" is literally true, since a hop reaches a memory "no cue and no embedding
   touched" and such a memory is uncued in the CONTRACT's vocabulary. So: seeds are the
   CUED candidates, a contribution to anything that is not already a candidate is
   DROPPED, and hop weight sits in `activation` but never in `cueFraction`'s numerator —
   so the graph can only push a candidate AWAY from the loud tier. Proof:
   `test/seams.test.ts` — "a hop NEVER mints a candidate — an uncued memory stays dark
   (hard gate (a))", "a hop RAISES a candidate the OTHER channels reached (a semantic
   hit)", "hops are excluded from cueFraction's NUMERATOR, so they push AWAY from loud".
M. **CLOSED 2026-08-25** — `physics.consolidationEligibility(m, d, {archived?})` mirrors
   `promotionEligibility` (`{eligible, reason, blockedBy, band, birthDay}`), and
   `sleep/consolidate.ts` now executes a crossing it does not define. The property the
   inline criterion existed to protect travelled with it: NO reinforcement requirement,
   so a formative one-shot still consolidates without repetition. Proof:
   `test/seams.test.ts` — "it mirrors promotionEligibility: eligible, first reason, and
   EVERY blocking reason", "NOTHING consolidates on the day it was encoded, whatever it
   claims for itself", "a formative ONE-SHOT consolidates without repetition — there is
   no reinforcement gate", "a faded memory is below the semantic floor and does not
   consolidate", "sleep now EXECUTES that verdict — the phase's skip reasons are physics'
   reasons", "a source scan: sleep no longer states the criterion itself".
N. **CLOSED 2026-08-25** — `mintProposal` routes every proposal that RESOLVED against an
   existing element through `self.noteSelfConfirmation` (`MintOptions.self`). Two things
   are engine-set and unclaimable by an author or an interpreter: the CHANNEL
   (`MintOptions.channel` — a sweep can never call itself authorship, which is the whole
   doctrine) and the fact that the call happens at all. No second claim-matcher was
   written: `remember/`'s `updates:` resolution is the matcher, upstream, and the claim's
   DIRECTION is read off that matcher's own verdict (`mint.directionOf`) rather than
   defaulted — `declared` (someone ADDRESSED the id to revise it) is a softening, which
   is never frozen and never reinforces, because a refutation must not credit a use to
   the belief it refutes (scar §2.10, the same rule `physics.dedupVerdict` checks first
   for the merge case); `content` / `content+hint` (the engine matched a RESTATEMENT) is
   a confirmation, which is the doctrine's own scenario when it arrives from a sweep. An
   unwired freeze seam routes nothing and therefore trains nothing. Proof:
   `test/seams.test.ts` — "a FALLBACK confirmation against the self is COUNTED and NOT
   trained", "the SAME claim from the authored front door DOES train — the doctrine's own
   input", "a DECLARED `updates:` is a softening — a refutation never credits the belief
   it refutes", "the DIRECTION is read off the matcher's verdict, never defaulted", "the
   channel is ENGINE-SET: no author field can turn a sweep into authorship", "a claim
   against an ORDINARY memory is not self-narration and moves normally", "no freeze seam
   wired means no claim is routed — and nothing is trained either".

**Wave 3 is CLOSED (2026-08-25): A–N all wired and proved in `test/seams.test.ts`.**

## Found in the parallel run

O. **CLOSED 2026-09-04** — `src/core/revision.ts` (`applyRevision`) is the REVISION seam,
   called from every mint door (`deposit`, which is the session-end dump and the note,
   and `applySweep`). **The gap, measured on the live store on day 1 of the parallel
   run:** the surprise pipeline dissented and the dissent went nowhere. The sweep declared
   a revision against a shown card; `remember/` resolved it; `mint.ts` wrote
   `doc.meta["updates"]` and routed the claim through the freeze seam — and then nothing.
   `encode/chunk.ts` emitted a `revision.challenge` DurableEffect no consumer applied, and
   `Schemas.challengeBelief` — the pressure accumulator, the durable events, the supersede
   past the bar — had callers only in test files. Store-wide, for the store's whole life:
   zero rows with pressure, zero `last_challenged_day`, zero `superseded_by`, zero
   `versions` rows, zero `revision.pressure` events. `self/freeze.ts` called the revision
   path "the caller's next stop"; the caller had never been written.

   **The dispatch is by TARGET (owner ruling, Mike, 2026-09-04):** a schema BELIEF and an
   IDENTITY element (a `type: "memory"` row in band `identity` or carrying
   `promoted_identity`) accumulate PRESSURE through `physics.applyChallenge` and are
   superseded only past the bar, both writing the SAME durable `revision.pressure` event
   with the same `(target, day, challenger)` latch, so the dashboard's story reads one
   shape; a CURRENT-STATE row is REPLACED immediately with lineage
   (`Schemas.replaceCurrentState`, versions reason `replaced-by-declaration`), because
   world-state flips on one clear correction; an ENTITY row and any ORDINARY memory are
   LINKED and nothing else; a PROTECTED element refuses every path. Authored declarations
   out-push swept ones through the PHYSICS alone — the reteller's claim was already cut at
   the minting seam — and no second weighting was added. A CONFIRMATION (`content` /
   `content+hint`: the engine matched a restatement) never enters the pressure path, read
   off `mint.directionOf` so the freeze seam and this one cannot disagree. Refusals are
   returned and evented, never thrown, and the declaration is logged as a hash. One apply
   per DECLARATION, resolved or not, so the applies stand one for one with encode's
   effects. Closes queued item 11 and `schemas/INTERFACE-GAPS.md` §8. Proof:
   `test/seams.test.ts` — "a SWEPT declaration adds pressure to a belief — the increment
   is durable", "the LINK alone is what the gap looked like — meta.updates without a
   mover", "one credited challenge per target per lived day, whatever the chunk says",
   "pressure crosses the bar and the belief is SUPERSEDED, with lineage", "an AUTHORED
   declaration carries more force than a SWEPT one on the same belief", "the NOTE door
   applies a declaration too — every door, not just the sweep", "an IDENTITY element takes
   pressure on the same arithmetic and the same event", "the increment reaches the
   DASHBOARD's story view, unchanged", "a CURRENT-STATE row is REPLACED immediately, with
   a versions row and no pressure", "an ORDINARY memory is LINKED and nothing else — no
   supersede, no pressure", "an ENTITY is not a claim: a declaration against one links and
   stops", "a PROTECTED element refuses the declaration, from every door", "one apply per
   DECLARATION — an address that resolves to nothing is counted, not silent", "a FULLY
   GATED chunk moves nothing — no effect, and therefore no apply", "an OBSERVER moves
   nothing, at the door and at the applier itself", "a CONFIRMATION is not a challenge — a
   matched restatement adds no pressure"; plus `test/schemas.test.ts` — the
   `replaceCurrentState` block ("a declared update REPLACES a now-fact immediately — no
   bar, no pressure", "the versions row says WHICH crossing ran — a replace is not a
   climbed bar", "a declaration against a SUPERSEDED now-fact is forwarded, never
   dangled", "every refusal names its own ground, and none of them throws", "a PROTECTED
   now-fact refuses the replace path too", "an archived-but-unsuperseded now-fact refuses
   with its own reason") and the surface-totality test, which now enumerates
   `replaceCurrentState`.

   **Open, and stated so it is not mistaken for settled:** a `content+hint` resolution
   where the author DID write an `updates:` string is classified `confirm` by the existing
   `mint.directionOf`, and therefore takes no pressure. That is the standing doctrine, not
   a decision made here — but it is the corner the ruling is least explicit about.

**Accepted rent, stated so nobody rediscovers it:** `Store.pruneEvents()` deliberately
never sweeps a row carrying a `dedup_key`, because that key is the replay latch — and
every consumer wired so far (schemas' pressure increments, sleep's prune / promotion /
merge records) carries one. So the log's bounded retention currently bounds only
latch-free telemetry, which is not yet written by anything. `schemas/INTERFACE-GAPS.md`
§1 asked for *bounded* retention on increments specifically; the honest fix when the
volume matters is an age-based sweep that keeps the latch and drops the payload, which
nothing needs yet (constitution 15).
*Two things changed after this was written (2026-09-05). Latch-free telemetry IS written
now — `recall.decision` per turn, `gate.deposit` per authored deposit, `sweep.gate`, the
eleven `adapter.*` rows — and `pruneEvents` HAD NO CALLER until sleep's `log` phase
(`sleep/CONTRACT.md` §5 G16; `sleep/NOTES.md` §13, §15), so "bounded retention" was a
sentence about a sweep that never ran. The latched-row rent itself stands unchanged.*
No item was skipped and no genuine gap-vs-CONTRACT contradiction was found, so there is
no Conflicts section. One item needed an INTERPRETATION rather than a transcription —
item L, where SEAMS' own summary was read against `associate/INTERFACE-GAPS.md` §1 and
recall's CONTRACT; the reasoning is recorded in L's entry above. Four composition roots
now exist alongside `bridge.ts`: `src/core/mint.ts` (proposal→memory),
`src/core/retrieval.ts` (recall's three borrowed channels), `src/core/briefing.ts`
(sleep→self), and `src/core/revision.ts` (a resolved `updates:` → the target it hit,
added 2026-09-04, item O). Store schema: `SCHEMA_VERSION` 2 and `CACHE_SCHEMA_VERSION` 2, fresh-open
only — no live stores exist yet, so there is no migration path and none was written.

## Queued (non-blocking, wire at the next seam pass)

4. **CLOSED 2026-08-25 — see item A.** (Observer predicate hoisted to
   `src/core/observer.ts`; the cross-module totality test spans both consumers.)
5. **CLOSED 2026-08-25 — see item B.** (`gate_session` table, one row per record.)
6. **CLOSED 2026-08-25 — see item C.** (Alias map sourced from `schemas.aliasMap()`.)
7. **One whole-word rule** — `schemas/` imports `occursAsWholeWord` from
   `encode/words.ts`; a second definition is forbidden (§8 G3; hyphens are word chars).
   *Already satisfied in code and asserted by `schemas/`'s own suite; left listed until a
   source scan covers the whole package.*
8. **CLOSED 2026-08-25 — see item I.** (`physics.clampSalienceAtSeam` runs in
   `mintProposal`, at the proposal→memory seam, and nowhere else.)
9. **`kind` default** — remember defaults `"fact"`; if encode classifies kind, the
   default moves behind the gate verdict.
10. **`InterpretFn` adapter contract** — streaming, token headroom, detachment are the
    adapter's; `remember.validateWatchdog()` must be proven inside `STALE_CLAIM_MS`.
11. **CLOSED 2026-09-04 — see item O.** (`remember/` resolves text to a candidate id;
    `src/core/revision.ts` walks that id through the supersede chain and dispatches by
    target. `UPDATES_FLOOR`/`UPDATES_MARGIN` remain CAL and uncalibrated, unmoved.)
12. **Caller-universality test** — once entrances exist (adapters), enumerate every
    ingestion entrance and prove the gate battery covers each (encode's caller-side
    half).

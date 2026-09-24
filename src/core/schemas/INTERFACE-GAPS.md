# `schemas/` — interface gaps

*What this module needed from a neighbour and worked around instead of editing,
and what a neighbour will need from this module before the wiring can be right.
Each entry names the owner, the workaround now in the code, and the real fix. An
item stays listed until a test proves the wiring.*

## 0. Nothing was stubbed, and the shared rule is imported

`physics/` covered every arithmetic need — `applyChallenge`, `pruneVerdict`,
`successorSeed`, `supersedeRecord`, `revisionBar`, `band`, `strength`,
`clampSalienceAtSeam` — and `store/` covered every durability need. **No local
copy of a physics rule or a store operation exists in this directory.**

Three symbols are imported from `encode/`, all leaf files, no cycle:

- `occursAsWholeWord` from `encode/words.js` — **SEAMS §7, mandatory**. One
  whole-word definition, shared with preselection; a second is forbidden. A test
  imports both this module's alias lookup and `occursAsWholeWord` and proves they
  agree term-for-term, and a source scan asserts no boundary regex is defined
  here.
- `gateAliases` from `encode/aliases.js` — reuse, not obligation. It already
  implements "verbatim in source, individually verified, dropped rather than
  fatal" on top of the one whole-word rule, and it drops an alias that is itself
  a credential. Re-implementing it would have been a second alias policy.
- `containsSecret` from `encode/secrets.js` — the ops rule: a credential must
  never become an entity the store indexes. Birth refuses the name outright
  (`name-is-secret`), because unlike an alias, a name has no drop-and-continue.

## 1. `store/` has no durable event log — the revision story is session-scoped

**Owner:** `store/` (box 2), with `dashboard/` as the consumer.
**Needed:** contract §5 says every pressure increment is logged and the
dashboard's story view reads them; constitution line 16 says the owner can see
what changed and why.
**Have:** `Store` emits `StoreEvent` to an in-memory ring plus an `onEvent`
callback. There is no events table and no append-only telemetry file.
**Workaround:** `Schemas` keeps its own ring and its own `increments[]`, and
`story(beliefId)` returns the durable half (the version rows the store retained,
the live pressure/bar on the head) plus the increments **this session** logged.
Restart the process and the increment history is gone; the pressure number
survives, the story of how it got there does not.
**Real fix:** an `events` table in box 2 with a bounded retention sweep beside
`pruneSupersededVersions`, or a documented obligation on every adapter to
persist `onEvent`. The second is cheaper and worse: it makes the telemetry an
adapter's discipline, which is exactly the shape scar §2.4 keeps punishing.

## 2. `store/` has no meta query — enumeration is a full scan at open

**Owner:** `store/` (box 2).
**Needed:** "every belief of entity X", "every entity row" — the module's most
common reads.
**Have:** `Store.list({ type, kind, band, archived })`. `meta` lives in prose,
not in a column, so no filter can reach `role` or `entityId`.
**Workaround:** one scan at open (`list({type:"schema"})` → read each prose file
→ index `role` / `entityId` / `name` / `aliases` in memory), and every subsequent
write updates the index. Operational state (archived, superseded, physics) is
always read live from box 2; only the prose-only fields are cached.
**Consequence:** open cost is O(schema rows), and a second `Schemas` instance
over the same store does not see the first's writes. Fine for one process; the
moment two adapters open the store concurrently it is stale-cache territory.
**Real fix:** either a `meta_index` table (key, value, memory_id) box 2 maintains
on write, or first-class `schema_element` columns. A `Store.listByMeta(key,
value)` is the smallest useful shape.

## 3. `recall/` should take its alias map from here — SEAMS §6 wiring

**Owner:** the coordinator. **Do not edit `recall/`.**
`recall/INTERFACE-GAPS.md` §2 records that `Turn.aliases?: ReadonlyMap<string,
readonly string[]>` is *borrowed from the caller*, and that a caller who forgets
it silently loses the ambiguous-handle safety half.

**This module now owns that map.** The wiring is one line at the call site:

```ts
recall.turn({ ...turn, aliases: schemas.aliasMap() });
```

`aliasMap()` returns handle (lower-cased) → sorted entity ids, for LIVE entities
only — a faded entity stops disambiguating because it stops surfacing.
`aliasIndex().ambiguous()` lists the handles that resolve to more than one
entity, if the caller wants the count rather than the map. Keys are lower-cased
because the shared whole-word matcher is case-insensitive without an option;
`handleKey()` is exported so recall never has to guess the folding.

**The gap stays open until a test in the composed pipeline proves the map is
actually passed** — the safety half is unreachable from inside either module.

## 4. `encode/`'s `SchemaSlice` has no elision count

**Owner:** `encode/`.
Contract §5 G8 requires elided items to be announced as a count, never silently
omitted. `encode/preselect.ts`'s `SchemaSlice` carries `beliefs`, `currentState`,
`identityCore` and no count field.
**Workaround:** `SchemaSliceOut` is `SchemaSlice`-shaped plus `elided`, and it is
structurally assignable to `SchemaSlice`, so `preselectSchemas({ schemas:
schemas.slices() })` type-checks today. `elided` is 0 in this build: nothing is
dropped, so nothing needs announcing.
**Real fix, when a slice ever elides:** `elided?: number` on `SchemaSlice`, read
by `renderSchemaContext` the way it already announces the identity-core
truncation. Until then the field is carried and ignored, which is honest but not
enforced anywhere.

## 5. `self/` must mint the identity core in this module's shape

**Owner:** `self/`.
Birth refuses `kind: "self"` in two independent layers, so the identity core
cannot be created through this module — correct, and deliberate. But the
placement rule (`status-on-identity-refused`) and the "a name resolving to the
identity core is not a birth site" layer both need to *see* the self schema.

**The obligation:** `self/` writes its core as `type: "schema"`, `kind: "self"`,
with `meta: { role: "entity", name: <the core's name>, aliases: [...] }`. Without
`meta.role` this module will not index it, and the ~72 KB refusal degrades to
"entity-unknown" — a refusal, but the wrong one, and a *silent* weakening of the
guarantee that matters most here.
**Test to write at the seam:** mint the core through `self/`, then assert
`schemas.addCurrentState({ entityId: coreId, ... }).reason ===
"status-on-identity-refused"`.

**Deliberate, and stated here so it is not mistaken for an oversight:**
`SchemaSliceOut` carries no `identityCore`. Encode's `SchemaSlice` has the field
and `renderSchemaContext` renders it under a byte budget — but *what the core
says* is `self/`'s to compose and to compress, not this module's to spill. The
slice from here is names, aliases, beliefs and current state; a caller that wants
the core in the same prompt merges `self/`'s rendering into the slice it passes
to `preselectSchemas`. If that merge never materialises, the symptom is a self
schema whose core is invisible at encoding — worth a seam test either way.

## 6. `sleep/` owns the fade cadence

`fadeSweep(day)` is pure arithmetic on a lived day and does no scheduling. Death
by decay only happens if something calls it — this is scar §2.17 in its most
literal form (*write paths ship, curation paths starve*), and `lifecycle()`'s
`noExitsYet` flag is the tripwire that fires if nobody ever does.

**The obligation:** `sleep/`'s consolidation cycle calls `schemas.fadeSweep(d)`
on the active-day clock, and reports the returned counts alongside its own prune
counts.

**Status (2026-09-24): met.** `sleep/`'s `fade` phase runs after `prune` every
`CADENCE.fade` lived days and calls an injected `FadeFn`, which
`counterpart.ts#sessionEnd` wires to `fadeSweep(day, { date, dryRun, limit })`;
the counts ride `CycleReport.faded`, the phase report and the durable
`sleep.cycle` row. The floor prune now skips entity cards — it had been
archiving them itself (NOTES §14, sleep NOTES §17). A `Schemas` used without a
`Counterpart` still has to be wired by whoever runs its cycle.

## 7. `pruneVerdict`'s `inLiveRevisionChain` is supplied as `false` for entities

**Owner:** shared with `sleep/`.
Entities are never superseded — only beliefs are — so an entity is never in a
live revision chain and the flag is a constant here. **Whoever prunes BELIEF rows
must not copy that constant:** a belief in an open supersede chain is exactly the
case the flag exists for, and the answer comes from `store.versions()` /
`superseded_by`, not from this module.

## 8. `remember/`'s `updates:` resolution overlaps this module's (SEAMS §11)

SEAMS §11 lists `CandidateSource` + `IdResolver` for `updates:` resolution as
coming "from store/schemas". `Schemas.challengeBelief` resolves the declared
target itself, through `store.resolve()`, and refuses `target-unresolvable`
rather than throwing. If `remember/` also resolves — with its own
`UPDATES_FLOOR` / `UPDATES_MARGIN`, both uncalibrated — then a declaration is
matched twice by two different rules.

**Recommendation for the coordinator:** `remember/` resolves *text to a candidate
id* (its matching problem); this module resolves *an id through the supersede
chain* (the store's problem). They compose in that order and must not be merged.

**CLOSED 2026-09-04 — `src/core/revision.ts` (SEAMS item O) is the composition,
in exactly that order.** The door hands the applier `resolved ?? declared`, and
the applier walks it through `store.resolve()` before anything else; no second
matcher was written, and `UPDATES_FLOOR` / `UPDATES_MARGIN` stayed where they
are. The applier also carries the matcher's `method` through
`mint.directionOf`, so the freeze seam and the pressure path read ONE verdict
about what a declaration meant — a `content` match is a restatement and never
becomes a challenge. Proof: `test/seams.test.ts` — "one apply per DECLARATION —
an address that resolves to nothing is counted, not silent", "a CONFIRMATION is
not a challenge — a matched restatement adds no pressure".

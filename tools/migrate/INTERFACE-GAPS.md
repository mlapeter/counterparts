# `tools/migrate/` — INTERFACE-GAPS

Places where being a *consumer* of v2's public API cost something. Each one is a
workaround this tool takes deliberately, filed rather than fixed by reaching past
a module's front door.

## §1 — `Self.ensureIdentityCore` mints a row a live `Schemas` never learns about

`ensureIdentityCore` puts a `type: "schema"`, `kind: "self"` row with
`meta.role = "entity"` — exactly the shape `schemas/` indexes. But `Schemas`
builds its alias index and meta map in `load()`, at construction, so an instance
that already exists never learns about a row minted behind its back. Adding a
belief to the freshly-minted core in the same process therefore fails
`entity-unknown`.

**Workaround here:** `apply.ts` opens the store twice — phase A sets the clock and
mints the core, phase B reopens so `Schemas.load()` sees it.

**The fix that belongs in core:** either `Self` takes the same `retarget`-style
callback `schemas/` already accepts (`SchemasOptions.retarget` is the precedent),
or `Schemas` exposes an explicit `learn(id)` for rows minted by a sibling module.
This is the same shape as SEAMS E: a row that exists but is invisible to the index
that should own it.

## §2 — no metadata channel on `Schemas.addBelief` / `addCurrentState`

Both take a fixed argument list (statement, day, protection, claimed salience,
`groundedIn`/`statedOn`). v1 elements carry fields with no slot in it —
a belief's `provenance` and `confidence`, a relationship's `entity`, a self-index
entry's `pointers` and `shelfQuery`. This tool DROPS them and counts them by name
rather than reaching into `store.put` behind `schemas/`'s back to attach meta to a
row `schemas/` owns.

Filed rather than worked around: an element metadata channel is a `schemas/`
decision, and a migration is the wrong place to invent one.

## §3 — `Schemas.beliefs()` lists only live rows

Idempotence needs to see the elements a previous run created AND archived (a v1
`superseded` belief arrives archived). `beliefs()` / `currentState()` filter
archived rows and `byEntity` is private, so `apply.ts` re-derives the element set
from `store.list({ type: "schema" })` plus each doc's `meta.role` / `meta.entityId`
— reading through the store rather than through the module that owns the concept.

An `includeArchived` option on `beliefs()` (which `entities()` already has) would
close it.

## §4 — the lived-day clock has no "set" verb

`Store.advanceClock(date)` moves the clock forward exactly one lived day per new
calendar date; there is no way to say "this store is on lived day 42" without
inventing 42 fake dates. `apply.ts` writes `livedDay` / `lastActiveDate` through
`setMeta`, which is public but is the clock's storage rather than its interface.

A named `Store.seedClock(livedDay, date)` — refusing to move backwards, exactly as
`advanceClock` does — would make the cutover a first-class operation instead of a
meta write that happens to work.

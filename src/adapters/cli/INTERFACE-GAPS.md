# `adapters/cli/` — INTERFACE-GAPS

*What the console needed from `store/` and worked around instead of editing.
Written 2026-08-25 alongside `test/cli.test.ts`; §§1–3 CLOSED the same evening,
when BUILD-STATUS gaps 3 and 4 came due.*

---

## 1. `store/` has no chase surface for box-2 rows — **CLOSED 2026-08-25**

**What shipped:** `chaseRemoved(store, id): ChaseReport` on
`store/owner-op-seam.ts` — the honest fix below, built as named. One transaction,
which also appends the `chased` stage, so the rows and the record land together
or not at all. It refuses unless the id is already dark (`REMOVAL_NOT_DARK`: the
record comes first, always), and it crosses the store's own stance check, so an
instrument cannot chase (`OBSERVER_REFUSED`, site `chaseRemoved`).

**What dies:** the edges touching the id **in both directions** — the conducting
problem this entry named (§16 G14) — its prospective windows, the gate rows that
name it, and every content pointer it had (`prose_path`, `content_hash`, and the
same pair on each of its version rows).

**What survives, and why:** the removal record and the deny-list; a
`removal_tombstone` row saying what the memory WAS, in flags and counts only
(never a title, a body, or a hash — §16 G9), which is what lets `self.enumerate`
show a removed protected element as `[removed]` instead of losing it (§2.19); and
the memory's own row and version rows, STRIPPED — because box 2's foreign keys
make them the lineage. A survivor whose `superseded_by` or `successor_id` names
the removed id must land on a named removal rather than a dangling pointer, so
`Store.resolve` stops at a denied id and `Store.read` refuses it by name, and the
skeleton renders as `[removed by the owner]` wherever an id is rendered and as
nothing at all everywhere else.

`RemovalPlan.unchasable` is empty now, and the field STAYS: a chase that
half-works at run time still has to say so (§16 G15).

**The original entry, kept because the reasoning is the record:**

**What exists.** The owner-op seam's plan (`owner-op-seam.ts` step 5) says
"copies are chased — prose, versions, edges, prospective rows, box 3". The store
exports `appendRemovalRecord` and `deniedIds`, and `rebuildCache` skips denied
ids. It exports nothing that can remove a `memories`, `edges` or `prospective`
row, by design: "the store's public surface carrying a way to destroy a memory"
is the thing §5 G2 forbids.

**What the CLI does.** Chases what it can reach — the prose file, the version
files, and the cache (via a rebuild that skips and logs the denied id) — and
REPORTS the rest in `unchased`, printed to the owner by name. No silent partial
success (§16 G15). The rows survive as dark state that every consumer skips:
`recall/activate`, `sleep/{decay,prune,consolidate,dedup}`, `associate/` and
`prospective/` all consult `deniedIds()`.

**Why "dark" is not "chased".** An erased id left in the learned graph keeps
CONDUCTING activation between its former neighbours (§16 G14). Today the edges
survive; the deny-list stops the endpoints from being fetched, which blunts the
effect but does not remove the edge.

**The honest fix.** A single `Store.chaseRemoved(id): ChaseReport` on the owner-op
seam — importable only from here, the way `OwnerRemovalPort` already is — that
deletes the row, its edges and its prospective windows inside one transaction and
returns what it touched. The port type exists; only the store's half is missing.

## 2. `Store.read`/`row` do not consult the deny-list — **CLOSED 2026-08-25**

The refusal is at the seam now, so every module inherits it instead of having to
remember it: `read`, `readProse`, `physicsOf` and `readVersion` raise
`REMOVED` with `detail: { id, by: "owner" }`, and `resolve` stops AT a removed id
rather than walking past it into `ID_DANGLING`. `put` consults it too — a removed
id is taken forever, so a stray copy cannot be reborn at the same address.

**`row()` is the deliberate exception**, and it is not an oversight: it is the raw
box-2 accessor, and the dashboard's browse list reads it over `list()` precisely
so that a removed memory keeps a LINE in the owner's inventory carrying
`[removed by the owner]`. A `row()` that threw would turn the instrument that
shows the absence into one that cannot render it (constitution 16).

**On the spelling:** the code is `REMOVED`, not `REMOVED_BY_OWNER`. The actor
rides in `detail`, where telemetry can read it; the CODE is the wire shape
consumers switch on, `adapters/dashboard/resolve.ts` switches on `"REMOVED"` to
choose its `[removed by the owner]` label, and renaming it would have bought a
longer string at the price of the one rendering path that depends on it.

## 3. `OwnerRemovalOutcome` is not re-exported — **CLOSED 2026-08-25**

`store/index.ts` re-exports `ChaseReport`, `OwnerRemovalOutcome`,
`OwnerRemovalPort` and `OwnerRemovalRequest`. The seam's TYPES travel as one unit;
the chase itself does not — `chaseRemoved` is importable only from
`owner-op-seam.js`, by the one directory the caller-universality test allows.

## 4. There is no writer's lock to take

CONTRACT §5 G2: "take the writer's lock only AFTER the confirmation, then reload
and re-plan under it." `store/` has no lock API — `remember/`'s `SpanBuffer` has
claim files, and box 2 relies on SQLite's own `BEGIN IMMEDIATE` per transaction.
So `remove` implements the half it can: it plans against a store opened in
observer stance, holds nothing across the human prompt (scar E5), then opens a
writing store and RE-PLANS before executing. Between the re-plan and the first
record append there is a window a concurrent writer could use. Fix: a data-dir
lock file the console takes and the background worker respects — which is
E5's own seam, and is the thing that would make the guarantee whole.

## 5. `VACUUM INTO` needs a raw connection, so the CLI reaches past `store/index.ts`

`snapshot.ts` and `export.ts` import `openDb` from `../../core/store/db.js` — a
deep import into a core module's internals — because `Store` exposes no way to
execute the database's own snapshot operation, and a file copy is exactly what
scar §2.11 forbids. Fix: `Store.snapshotTo(path): SnapshotResult` on the store
itself, which is also where the WAL/journal knowledge belongs. Until then the
deep import is the honest version of the dependency: the CLI genuinely needs the
database, not the store's abstraction of it.

## 6. The CLI CONTRACT §5 G6 and the store's LAYOUT disagree about `versions/`

**G6:** "the archive tree is deliberately excluded from snapshots — archive-on-
overwrite history is itself the redundancy layer, and snapshotting it copies an
unbounded, already-redundant tree into every snapshot."

**`store/paths.ts` LAYOUT:** `versions` is classified `backup: true`.

**What shipped:** the store's classification, because (a) rescope 3 replaced the
forever-archive with bounded versioning — superseded rows retain ~90 lived days,
which defuses G6's "unbounded" premise — and (b) G5's totality rule says the
backup set IS the layout, asserted by a test; maintaining a second, contradictory
list here would re-create the v1 bug G5 exists to prevent. Recorded as a real
contradiction for the owner to close in one direction or the other, not as a
silent choice.

## 7. An instrument still MINTS an absent store at open — CLOSED 2026-08-26

**Filed 2026-08-25**, alongside the fix for the live "database is locked" failure
(`docs/live-verify-2026-08-25.md`). `Store`'s constructor no longer writes at open
when the store is current — that was the lock the backup lost — and a store a
schema BEHIND now refuses under observer (`STORE_UNINITIALIZED`) rather than
migrating itself out from under whoever owns it.

**Closed 2026-08-26** exactly as filed: an observer opening a data directory
with no store now refuses with the same `STORE_UNINITIALIZED` — thrown BEFORE
the first `mkdirSync`, so the refusal deposits nothing, not even the cache
container (`store.test.ts` pins "leaves NOTHING behind"). To a reader, "not
created yet" and "not migrated yet" are one condition. The seven test files
that opened observers on virgin temp dirs now create the store they read (an
owner open, closed immediately). Callers squared with the refusal: the
dashboard bin catches it and prints `statusCommand`'s sentence instead of a
stack trace; the hook bin still exits 0 but now names its stand-down on stderr
(a CORRUPT config fails toward observer, and on a machine with no store that
path used to be the silent mint — an ABSENT config keeps owner defaults, so
cold start still mints normally); the CLI's `storeExists` guards already
answered before opening.

## 8. Entity birth (`schemas.mention`) has no adapter path at all

**Filed 2026-08-25** from the live-verification run, for the coordinator. Neither
`adapters/mcp/` nor `adapters/cli/` calls `Schemas.mention()`; grep finds it only
in `src/core/` and `test/`. Birth-by-mention is a core primitive whose only live
caller is the composition itself.

**Checked, not assumed** — and the answer is worse than the live note implies.
`grep -rn "\.mention(" src/` returns NOTHING: not an adapter, and **not the mint
path either**. `counterpart.ts` never calls it while placing a deposit, so birth
is not ambient-by-another-name; the live run's `{ ok: true, reason: "born" }`
happened because the seeding script called the composition's `schemas.mention()`
by hand. As shipped, an entity is born only if the embedding host reaches into
`Counterpart.schemas` itself.

That makes it the same shape BUILD-STATUS gap 2 names for `physics.symmetryCheck`
— enforced in one place, consumed by nobody — and it lands on a rule the module
states as doctrine: "birth is by mention, death is by decay". Death runs on the
clock; birth has no caller. For the coordinator to route: either the mint path
mentions the entities a deposit names (ambient, constitution 8) or the console
grows an owner-facing verb, but a birth rule with no live caller cannot be
claimed as working.

## 9. `remember/` has no door to strike a span, so removal can only NAME the buffer

**Filed 2026-09-04**, with the adapter half of LAUNCH-STATUS §I2 (owner ruling:
option A — report it now, chase it later).

A note is CAPTURED before it is minted: `captureJot` appends the verbatim text to
`spans/<keyFor(scope)>/jots.jsonl`, and `submitJot` mints from it. Nothing prunes
that file, so a removed note's words stay on disk — and `backup` copies them
(measured; `export` does not, §C1). `removal.ts` now reports the surface in all
three states, and `ownerRemoval` counts it into the `cli.removal.complete` EVENT
— which the console binds to `io.out`, so the count is printed and never stored.
The durable `removal_record` holds the removal's four stages and no count.
Reporting is all it can do.

**A second, smaller ask, filed with it.** If the unchased count should be
durable, the write is `store.appendEvent` on the completion payload, plus a
`cli.removal.*` name in `dashboard/registries.ts` so `activity` can render it.
Not taken tonight: the destruction path is the last place to add a write on a
launch eve, and the printed line is honest as long as the documents say printed.

**What is missing.** `SpanBuffer` exposes `claim`/`consume`/`restore` — the
lifecycle of a buffer being drained forward — and nothing that removes ONE span
from wherever it currently sits (live stream, `claims/*.jsonl` aside, consumed
ledger). The destruction path cannot be given a `rmSync` over `spans/`: that file
is `remember/`'s state machine, spec §2 G6 forbids a span being in neither claim
nor buffer, and a claim renaming underneath a chase is exactly the race that
guarantee exists to prevent.

**Fix, for the coordinator to route:** `SpanBuffer.strike(scope, predicate |
spanHash): StrikeReport` — one seam, inside `remember/`'s own `mutate()`, that
rewrites each stream file without the matching records and reports counts per
file. The removal path then calls it between `dark` and `chased` and moves the
surface from `unchasable` into `surfaces`. The hash to strike is already minted:
`Proposal.ownSpanHash` — but it is NOT persisted (the store keeps
`origin_session` / `origin_scope` / `origin_ref` and drops the span hash), so
either that column joins `memories`, or `strike` takes the content predicate the
adapter already uses to detect the residue.

**Until then**, `spanResidue()` in `removal.ts` decides by LOOKING: it searches
the scope's buffer files for the doomed words and reports `held` on a hit,
`not-applicable` on a checked miss, and `unknown` for its two blind spots (the
prose already gone; provenance never recorded). Evidence first, provenance
second — `source = 'authored'` turns a miss into `unknown` rather than an
all-clear, because "I did not find it" is not "it was never there".

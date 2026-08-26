# `adapters/cli/` — INTERFACE-GAPS

*What the console needed from `store/` and worked around instead of editing.
Written 2026-08-25 alongside `test/cli.test.ts`.*

---

## 1. `store/` has no chase surface for box-2 rows — removal leaves DARK state

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

## 2. `Store.read`/`row` do not consult the deny-list

`owner-op-seam.ts` says the deny-list is "consulted at load and at rebuild".
Rebuild consults it; every consuming module consults it; `Store.read(id)` does
NOT — after a removal it throws ENOENT on the missing prose file instead of
refusing a denied id by name. A caller that has not learned to check
`deniedIds()` gets a confusing error rather than a clear refusal. Fix: one check
at the top of `requireRow`, raising a `REMOVED` StoreError.

## 3. `OwnerRemovalOutcome` is not re-exported from `store/index.ts`

`index.ts` re-exports `OwnerRemovalPort` and `OwnerRemovalRequest` but not
`OwnerRemovalOutcome`, so `removal.ts` imports it from
`../../core/store/owner-op-seam.js` directly. One line in the store's export
block; the seam should travel as one unit.

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

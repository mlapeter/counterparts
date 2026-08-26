# `dashboard/` — INTERFACE-GAPS

What this adapter needed from the core and did not find, in the order it hurt.
Each item says what exists, what is missing, what the workaround costs, and who
should own the fix. Nothing here blocks the five views; everything here is a place
where the dashboard is compensating for a core surface, which is exactly the kind
of debt that goes silent if it is not written down.

---

## §1 — A read-only open still writes. `store/cache.ts`, `openCache`

**Found by:** the byte-identical test, on its first run.

**Have:** `Store.open` constructs box 3 through `openCache`, which unconditionally
runs

```
INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', ?)
```

inside a transaction on the cache database. That transaction is **outside
`mutate()`** and consults no stance, so an observer's Store rewrites bytes in
`cache/cache.sqlite` before any caller does anything. Measured: the file's hash
changes on every open, and again on the next one.

**Want:** either the write is skipped under observer (it is idempotent, so an
observer skipping it loses nothing), or it becomes conditional — read the row,
write only on mismatch — which fixes it for every caller, not just instruments.

**Cost of the workaround:** the guarantee splits in two. `test/dashboard.test.ts`
proves the strict property for boxes 1 and 2 (prose and operational — hashed
before the Dashboard exists, after every render, and after close) and the
across-renders property for box 3 (hashed after open). Both are real, and the
second is weaker than the CONTRACT's plain reading of "byte-identical dir after
every view renders". Nothing canonical moves, and box 3 is rebuildable by
declaration, so this is a *provability* gap rather than a data one — but the
sentence "an instrument leaves the store as it found it" (scar E7) is not
currently true of the bytes.

**Owner:** `store/`.

---

## §2 — Cycle outcomes are unenumerable. No `Store.metaKeys(prefix)`

**Have:** `sleep/` records every promotion, prune and merge under a meta key —
`sleep.promoted.<id>`, `sleep.pruned.<id>`, `sleep.merged.<id>` — and box 2's meta
table is reachable only as `getMeta(key)`. There is no listing, prefix scan, or
iteration.

**Want:** `metaKeys(prefix?: string): string[]`, or the real tables
`sleep/INTERFACE-GAPS.md` §3 already asks for.

**Cost of the workaround:** `status` cannot report *what the last cycle actually
did*. It reports what is durable and enumerable instead: the per-phase completion
markers (which lived day each finished) and the archived-with-reason state of every
row, labelled **since birth**. That is honest, and it is less than the view wants.
A per-cycle promotion count is currently unanswerable from a cold store — the
`CycleReport` that holds it is returned to its caller and then gone.

Note the durable `events` table *does* carry these (`band.promoted`,
`memory.pruned`, `memory.merged`) with a `dedupKey`, so a day-scoped count is
reachable through `eventLog({ sinceDay })`. That is the likely fix and it is a view
decision, not a core one — but events are bounded-retention telemetry and the meta
records are not, so the two are not interchangeable for an old cycle.

**Owner:** `store/` (the surface), `sleep/` (the records).

---

## §3 — `self.enumerate` drops what it cannot read

**Found by:** the identity-view test that removes a protected element.

**Have:** `self/identity.ts`'s `enumerateOne` returns `null` when `readProse` or
`physicsOf` throws, and `enumerate` skips it. So a memory the owner removed simply
stops being in the list, with no record that it was.

**Want:** the enumeration to carry unreadable ids as a third bucket —
`unreadable: { id, reason }[]` — beside `identity` and `protected`.

**Cost of the workaround:** the two lists behave differently, and only one is
fixable here. The identity BAND is queryable (`list({ band: "identity" })`), so the
view diffs the band against the enumeration and prints the difference as named
absences ("Identity-band rows I could not read just now"). The PROTECTED set is
not: protection is a physics flag on the row whose physics is exactly what stopped
reading, so there is no way to know a removed row was protected. A removed
protected element therefore leaves the protected list silently — which is scar
§2.19's failure shape (permanence without inspectability) reached from the other
side.

Related, smaller: there is no `list({ protected: true })` filter, which is why
`enumerate` scans every live row to build its second list.

**Owner:** `self/`, with a `store/` filter as the cheaper half.

---

## §4 — Observer is enforced by wrapper and scan, not by types

**Have:** `Dashboard.open` sets `observer: true` itself, and `sourceOf` refuses any
Counterpart whose stance is not observer. `DashboardSource` narrows the read
surface to `store`, `schemas`, `self` — but those are the real objects, and their
write methods are still on them. A view function *could* call one; the reason none
does is the source scan in `test/dashboard.test.ts`, which strips comments and
string literals and fails on any `WRITE_METHODS` name or filesystem call anywhere
in this directory.

**Want:** a read-only projection type in the core — `ReadOnlyStore`, structurally
the read half of `Store` — so "an instrument cannot reach a write method" is a
compile error rather than a test. `docs/observer-mode.md` G4's spirit is that an
observer proves its own stand-down rather than relying on the store's; a type would
carry that further than a runtime check does.

**Cost of the workaround:** the mechanism is a test, so it protects this directory
and nothing else. Any future adapter that wants the same property re-implements the
scan.

**Owner:** `store/`.

---

## §5 — The event log has no distinct-name query

**Have:** `eventLog({ name })` filters to one name. To render the durable-event
vocabulary — every name that *can* be recorded, with its count — the view issues
one query per known name and takes the length.

**Want:** `eventCounts(): { name: string; count: number }[]`, or a `distinct`
option. It would also let the view discover names the registry does not know,
which is the more interesting direction: right now `DURABLE_EVENTS` is exhaustive
by type over the four record interfaces, and a fifth writer that appends a raw
string name would go unlisted without failing `tsc`.

**Cost of the workaround:** four queries where one would do, on a table that is
small by construction. Negligible today; wrong at a hundred names.

**Owner:** `store/`.

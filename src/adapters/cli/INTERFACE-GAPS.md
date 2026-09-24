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

## 9. `remember/` has no door to strike a span — **CLOSED 2026-09-05**

**What shipped:** `strikeSpans(buffer, request)` on
`src/core/remember/owner-strike-seam.ts` — the seam this entry proposed, built
as named and gated the way `store/owner-op-seam.ts` is: `SpanBuffer`'s
constructor hands it a capability through a WeakMap, `"strike"` joins
`WRITE_SITES` so the stand-down totality test covers it, and a
caller-universality test pins the two files in `src/` that may import it
(`remember/spans.ts`, which grants and never calls; this directory's
`removal.ts`). Holding a `SpanBuffer` — which every `Counterpart`, and so the
MCP server, does — reaches nothing.

**What dies:** the matching lines in the five files under a scope that carry
`text` — `buffer.jsonl`, `jots.jsonl`, `assistant.jsonl`, `quarantine.jsonl`,
and every `claims/*.jsonl` — rewritten per file by rename-aside plus
append-the-survivors-back, `claim()`'s own choreography, because `mutate()` is a
stance check and not a lock. `removal.ts` calls it between `dark` and the box-2
chase, so the addressing still exists when it runs.

**What survives, and why:** the hash, in `consumed.jsonl`. That is the terminal
ledger `seenHashes()`, `restore()` and `mergeOrphans()` all filter against, so
keeping it is what stops the words being re-captured, restored by a worker
mid-arc, or merged back from a crashed run's orphan. The strike ledgers FIRST,
before a byte moves. `coverage.jsonl` and `failures.jsonl` keep their hashes for
the same reason.

**On the persistence question this entry raised.** `Proposal.ownSpanHash` is
persisted now — in the PROSE META as `origin.spanHash`, not as a `memories`
column. Two reasons. §16 G9: a hash of low-entropy content is brute-forceable,
and `chaseRemoved` blanks `content_hash`/`prose_path` on the skeleton precisely
so no pointer to removed content outlives the removal; in the prose meta the
pointer dies with the document, in a column it would not. And the mechanical
one: `openOperational` returns early when the schema version matches, so a new
column needs `SCHEMA_VERSION` 4 → 5, after which a REVERT leaves the owner's
live store unopenable by the previous build (`SCHEMA_AHEAD`) — a one-way door
bought for a field the prose already carries. The chase also works
RETROACTIVELY, with no migration at all: every accepted proposal has always
written `{spanHash, proposalId, own}` into the scope's `coverage.jsonl` and the
mint has always stored the proposal id in `origin_ref`, so a memory minted long
before this branch is addressable by its `own: true` marks. The content
predicate stays as the third fallback, for a row with neither.

**The content fallback is FENCED, after the adversarial review (F4).** It is
full-text equality on a jot, never a substring, and only inside the memory's
recorded `origin_scope`. A row with no scope — which is every row
`tools/migrate/apply.ts` imported, since it writes `origin: { ref }` alone — is
NOT chased by content; the console lists the jot lines that would have matched,
by file and count, and stops. `--strike-by-content-across-scopes` performs it on
the owner's explicit say-so, and even then takes only an exact line.

**Still open, and deliberately:** the second, smaller ask below — a durable box-2
event for the removal's counts — is not taken. And one window is named rather
than closed: a worker that has already read `claim.spans` into memory finishes
its arc, so a NEW memory can be minted from a span struck a millisecond later.
The deny-list stops the removed id from returning; it does not stop that. Closing
it means a lock `remember/` does not have. `remember/NOTES.md` §14 says so.

**The original entry, kept because the reasoning is the record:**

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

*(Since the close: identity first, evidence second, provenance third.
`spanResidue()` matches the recorded span hash before it matches the body, which
is what lets a memory whose prose is already gone still be chased. Only ONE
blind spot is left — prose gone AND no hash — and it is still `unknown`, still
counted `unchased: 1`.)*

## 10. `Store.eventLog` orders ASCENDING, so "the newest row of this name" is not a query — STORE SIDE BUILT 2026-09-24

**Status (2026-09-24):** `eventLog` takes `order: "asc" | "desc"` (default `asc`, so no
caller changed), and `eventLog({ name, order: "desc", limit: 1 })` is the newest row of
a name in one query (`test/store.test.ts` › "event log reads"). **Still open on this
side:** `claude-code/doctor.ts#newestRows` keeps its ladder until whoever owns doctor
collapses it to that call — not touched here, another session owned the file.

`doctor` (2026-09-14) asks the store one question over and over: what is the
NEWEST `sleep.cycle` / `sweep.gate` / `adapter.embed.backfill` /
`adapter.spawn.refused` row. `eventLog({ name, sinceDay, limit })` answers
`ORDER BY seq ASC LIMIT ?`, which is the OLDEST N — so a name with more rows than
the limit returns a window that does not contain the newest, and a caller that
took `rows.at(-1)` would report last week's reading as today's, silently.

`claude-code/doctor.ts#newestRows` closes it EXACTLY rather than approximately: a
ladder of lived-day windows, narrowest first (today, 2, 7, 30, everything), and a
window whose result is shorter than the limit was not truncated, so its last row
is provably the newest in it. A full window is discarded rather than trusted.
Cost: up to five queries where one `ORDER BY seq DESC LIMIT 1` would do, on a hot
path bounded at 150 ms.

**The ask**: `eventLog` takes an `order: "asc" | "desc"` (or a `newest: n`), and
`newestRows` collapses to one call per name. Box 2's own business, it changes no
behaviour, and it is the only reason that ladder exists.

---

## 11. `Store` has no GROUP BY, so the what-fired view counts rows in JavaScript — (a) BUILT 2026-09-24

**Status (2026-09-24):** ask (a) is built as `Store.eventCounts({ sinceDay?, sinceAt? })`
→ `{ name, count, newestAt, newestDay, newestSeq }[]`, one `GROUP BY`, sorted by name;
plus `eventNames()`. **`fired.ts#readLog` is NOT rewired to it, deliberately**: its
windows date each row by `payload.date` (falling back to `at`), and its refusal columns
read payloads, so neither half is a `GROUP BY` on a column. A payload-free column the
writers fill (a `date` column on `events`) would make it one; until then the one-pass
read stays. The dashboard's own per-name counts do use it (dashboard §5). (b) and (c)
are not built.

`adapters/fired.ts` (2026-09-17) asks two questions of every mechanism: how many
rows of this name landed in each of two seven-day windows, and when did the
newest one land. Both are one `GROUP BY` in SQL and neither is a call the store
offers, so the view reads the whole log through `eventLog({ limit })` — one
query, not one per name per day — and tallies it here. A read that comes back
FULL is handled rather than trusted (the same trap §10 names): it is the oldest
rows, so a second day-bounded read covers the windows, the two are joined on
`seq`, and every total is reported as a floor.

Four TABLE reads have the same shape and no aggregate at all. `edges`,
`prospective` and `versions` are keyed by memory id and reachable only as
`edgesFrom(id)` / `prospectiveFor(id)` / `versions(id)`, and `MemoryFilter` has
no `protected` field, so the five probes the view needs — newest `edges.last_day`,
the prospective count and newest fired day, the protected count, the removal
record, `versions` by reason — cost a few queries per memory. Only
`removalRecord()` is one query. `web/views.ts:1360` already pays the same price
for its edge count. The view bounds the scan, reports a truncated one as a floor,
and the one caller on a hook's hot path turns the probes off and NAMES the
mechanisms it therefore did not read.

**The ask**, in the order it would pay: (a) `eventCounts({ sinceDay })` returning
`name → { rows, newestAt }`, which collapses the whole first half; (b)
`MemoryFilter.protected`; (c) `edgeCensus()` / `prospectiveCensus()` /
`versionCensus()` returning a count and a newest day per key. All of it is box
2's own business and none of it changes behaviour.

## 12. `export --markdown` holds the whole tree in memory — OPEN 2026-09-20 (F7)

`collectMarkdown` builds a `Map<path, Buffer>` of every live row's rendered
markdown before one byte is written. That is what makes `--markdown
--passphrase` safe — nothing plaintext ever reaches the disk on that path — and
it is also a peak whose size is the store's bodies plus their frontmatter, and
twice that briefly during `encryptBundle`'s base64 manifest. On the measured
store shapes (a few thousand rows, ~10 MB of bodies) this is nothing. On a store
an order of magnitude larger it is the first thing that would hurt.

**The ask**, if it ever hurts: a streaming bundle — `store.forEachDoc(fn)` and a
sink the plaintext arm writes straight through, with the encrypted arm keeping
the buffered path because sealing needs the whole thing anyway. **Not built**:
constitution line 15 says wait for the named problem, and `--markdown` is a
deliberate owner action nobody runs in a loop.
Recorded against the store, where it would be declared: `store/CONTRACT.md` §7 question 6
(that module keeps no `INTERFACE-GAPS.md` of its own, so its open asks live in its §7).

**What is already bounded:** the DATABASE export streams through `VACUUM INTO`
and holds one file, so the ordinary export is unaffected by any of this.

## 13. A clean `close()` does not fold the write-ahead log — BUILT 2026-09-24 (#26)

**Status (2026-09-24):** built as an explicit checkpoint rather than statement
finalization. `Store.close()` runs `PRAGMA wal_checkpoint(TRUNCATE)` (`db.ts#foldWal`)
on each box THIS handle changed a row in (`total_changes() > 0`), never under observer, with the
connection's busy timeout at 0 so a reader holding a snapshot makes the fold partial
instead of stalling the close for five seconds. Measured cost and the reasons are in
`store/NOTES.md` (2026-09-24). The `migrate-cache --apply` compaction and the removal
reclaim run on raw `openDb` handles and checkpoint themselves: the removal with its own
`wal_checkpoint(TRUNCATE)`, the compaction with `foldWal` after each `VACUUM`, so its
"reclaimed" line is true of the file on disk.

`store/db.ts#openDb` prepares a new statement on every `get`/`run`/`all` and never
finalizes one, so when a `Store` closes, bun's `close()` finds statements still open and
skips SQLite's last-connection checkpoint-and-truncate. The `-wal` stays on disk at its
high-water size — measured: 300 rows written, a clean close, a 2.19 MB log before and
after the process exited — until some later connection happens to fold it (the MCP
server a `claude mcp list` health check starts did, on a throwaway store: 3.8 MB to 0).
Nothing is lost; the next writer reuses the log. What it costs is a store whose size on
disk depends on which program touched it last — finding #26, where `uninstall` showed
6.7 MB and then 1.4 MB a minute apart. `uninstall` now measures after its own pre-flight
and says how much of the number is log (NOTES, 2026-09-23), which is this module's half.

**The ask**, against `store/` (not built here): finalize statements — or cache them per
SQL string and finalize the cache in `close()` — so a clean close is a real close. Worth
measuring the hooks' per-turn cost before and after, since they open and close the store
on every turn.

# Adversarial review — PR #137, `floor/f1-wal` (head `aa2f50c`, base `039cd5d`)

*2026-09-18. Reviewer: an adversarial agent working in its own scratch worktree. Nothing
on the branch was changed, nothing pushed, nothing commented, nothing deployed. Every
probe ran against throwaway stores under the session scratchpad; the live stores were
never opened.*

---

## Verdicts, up front

**Safe to merge as is?** *Almost* — **merge after one named code fix** (MAJOR-1, the
`databaseBytes()` over-report; small, and self-contained in `cli/commands.ts`) and,
if the coordinator wants it, MINOR-1 (one event row when a flip did not take). The core
of the change — busy timeout first, read the journal mode before setting it, WAL only
when the opener asks — is right, and I proved the headline claims hold.

**Safe to deploy to the live multi-process store as is?** **No — not as is.** With the
ordered procedure in the last section, **yes**. Two things must happen before the
checkout moves, and neither is in the PR: the owner's own `sqlite3 …?immutable=1`
diagnostic recipe stops telling the truth the moment this lands (BLOCKER-1), and every
long-running process from the old build must be closed **before** the deploy, not after
(BLOCKER-2).

**Findings by rank:** 2 BLOCKER (both about deploying, not about the code), 3 MAJOR,
6 MINOR, 4 NIT.

**Suite, typecheck, flake:** `bun test` → **2231 pass / 0 fail**, 28451 expect() calls,
38 files, 58.7 s — matches the PR's claim exactly. `bun run typecheck` → clean, no
output. `test/store.test.ts` run **10 times in a row**: 83 pass / 0 fail every time, no
flake. The timing-based lock tests did not wobble.

---

## What I confirmed the PR gets right

These were claims worth doubting. They hold.

- **A reader is not blocked by a writer.** Connection A holds `BEGIN IMMEDIATE`; B's
  `SELECT count(*)` returns in **1 ms**. (Under DELETE it would have waited.)
- **Writer against writer waits, then succeeds.** A holds the write lock for 700 ms; B's
  write returns **after 792 ms** with the row written — the busy timeout does its job and
  releases as soon as the lock clears, not after the full 5 s.
- **No classic WAL "stale snapshot" trap.** `db.transaction()` opens with
  `BEGIN IMMEDIATE` (`src/core/store/db.ts:210`) and nothing else in `src/` or `tools/`
  begins a deferred transaction that later writes. I also probed the subtler shape —
  B does a `db.get()` (which `openDb` never finalizes), A commits, B then writes — and it
  **succeeded** in 0 ms both in autocommit and through `transaction()`. bun resets the
  statement after `get()`, so no read snapshot is pinned. The classic trap is not present.
- **Deploy day for a long-lived handle.** An OLD-build connection opened while the file
  was in DELETE, left idle, then a NEW-build process flips the file to WAL: the old handle
  keeps **reading and writing** correctly. I checked the thing the PR did not: the old
  connection reports `delete` from a bare `PRAGMA journal_mode` but reports `wal` **inside
  its next transaction**, and no `-journal` is ever created — so there is no mixed-mode
  write and no corruption. Writes from both sides land, both see 6 rows at the end.
- **SIGKILL mid-transaction recovers, and a read-only reader after it is fine.** A writer
  with 40 committed and 40 uncommitted rows SIGKILLed; the next read-write open recovers
  from the `-wal`, sees exactly the 40 committed rows, and writes again. I also ran the
  sequence the watchdog actually produces — kill the worker, then open **read-only** with
  `tools/parallel/readers.ts`'s opener **before** anything read-write touches the file:
  it opened and read the 40 committed rows. No `SQLITE_READONLY_RECOVERY`, no
  `CANTOPEN`. Repeated with the `-shm` deleted after the kill (a stale index): still
  fine. So a watchdog kill followed by the daily parallel gate does not poison the day's
  record.
- **No checkpoint starvation observed.** With a second long-lived connection alive, 500
  inserts grew the `-wal` to 2.2 MB (549 frames, below the 1000-page autocheckpoint
  threshold); a `PASSIVE` checkpoint then moved all 546 frames and a `TRUNCATE` checkpoint
  took the `-wal` to 0 bytes **while the other connection was still open**. Nothing pins a
  snapshot.
- **The read-only arms are as described.** A read-only connection to a WAL database
  succeeds while the sidecars exist, and fails `SQLITE_CANTOPEN` when **both** are gone. I
  found the missing middle: with the `-wal` present and only the `-shm` deleted, a
  read-only open still **succeeds** (SQLite's read-only WAL fallback). So the CANTOPEN arm
  needs both sidecars gone.

  **One caveat the coordinator should not generalize.** On this Mac the sidecars survive
  even a clean close: I opened the store with `/usr/bin/sqlite3` and with `/usr/bin/python3`,
  let each exit normally, and the `-wal` and `-shm` were still there afterwards (the `-wal`
  checkpointed to 0 bytes, but present). Apple's system SQLite enables **persistent WAL** by
  default, which is why. Stock SQLite — Linux, a packaged build, a user's own `sqlite3` —
  **deletes both on the last clean close**. So the builder's step-6 warning ("nobody runs
  `sqlite3` and quits") is over-cautious *here* and exactly right *elsewhere*: on a machine
  without persistent WAL, one clean close leaves a WAL-header database with no sidecars, and
  `tools/parallel/readers.ts` then refuses it with `SQLITE_CANTOPEN` until a read-write open
  puts them back. That is a launch-portability note, not a deploy-day one.
- **Nothing in `src/` or `tools/` opens the operational store read-only except
  `tools/parallel/readers.ts`** (`readonly: true` at line 348, `readOnly: true` at 353)
  and `tools/replay/corpus.ts` (lines 128/133), which reads its own corpus index, has its
  own opener, imports nothing from `store/db.ts`, and **refuses** a WAL index by name
  (`corpus.ts:534-552`). The PR's pre-check is correct; `test/replay.test.ts` is unaffected.
- **Copies go through `VACUUM INTO`.** `snapshot()` iterates `LAYOUT` and joins
  `entry.name`, so only `operational.sqlite` is named and it takes the vacuum route
  (`src/adapters/cli/snapshot.ts:133-153`); `cache` has `backup: false`. The sidecars are
  never file-copied. `assertLayout()` passes with `-wal`, `-shm` and a stray `-journal`
  present, because `LAYOUT`'s database entry is `match: "prefix"`.
- **The MCP server takes one handle for life** (`src/adapters/mcp/index.ts:81`, one
  `Counterpart.open` inside `openServer`), and so does the **dashboard**
  (`src/adapters/dashboard/web/server.ts:240`, one `Dashboard.open` for the whole server;
  requests read `src.store`, they do not re-open). Neither re-opens per request. That
  matters a lot for the deploy-day procedure below.

---

## BLOCKER

### BLOCKER-1 — the owner's own `sqlite3 …?immutable=1` recipe silently stops telling the truth

**Where:** not in the diff at all. `docs/HANDOFF.md:79,515`, `docs/storage-spec-2026-09-16.md:94`,
`docs/mechanism-inventory-2026-09-17.md:263`, `docs/promotion-diagnosis-2026-09-17.md:4`,
`docs/recall-surfacing-diagnosis-2026-09-18.md:4,482`,
`docs/plan-parallel-rebuild-2026-09-18.md:165` — the rebuild plan this PR is track F1 of.

**What goes wrong:** every one of those documents tells whoever is diagnosing the live
store to read it with

```
sqlite3 -readonly "file:$HOME/.counterparts/store/operational.sqlite?immutable=1" "<sql>"
```

`immutable=1` is a promise to SQLite that the file cannot change, and SQLite takes it by
**ignoring the `-wal` entirely**. Under WAL every row committed since the last checkpoint
lives in the `-wal` and nowhere else, so an `immutable=1` read returns the database *as of
the last checkpoint* — quietly, with no error.

**Proved.** A WAL store with three rows, all of them still in the `-wal`:

```
--- immutable=1 (the docs' recipe):
Error: in prepare, no such table: f1probe
--- -readonly, no immutable:
3
--- plain read-write:
3
```

On the live store (7 MB already checkpointed into the main file) it will not say "no such
table" — it will return a **number that is quietly short** by everything written since the
last checkpoint, which on a busy day is hours of memory. That is precisely the fabricated
zero scar §2.4 is about, arriving through the owner's most-used instrument.

**Failure scenario:** the owner deploys, then runs the storage spec's census query to check
the day's memories. It reports 15,940 where the truth is 15,977. He rules on the number.

**Smallest fix:** drop `?immutable=1` from the recipe everywhere — plain `-readonly` on the
path works and reads the `-wal` (proved above). One line in `store/NOTES.md` saying why,
and a sweep of the six documents. This is a documentation fix, not a code fix; it does not
block the merge, it blocks the deploy.

### BLOCKER-2 — an old-build process that opens a FRESH connection after the flip fails at open, or flips the store back

**Where:** old `src/core/store/db.ts` (on `master`), which execs `PRAGMA journal_mode = DELETE`
unconditionally with `busy_timeout` set *after* it. The PR names this ("alone it flips the
store back and in company it throws") but understates the trigger.

**What I measured, and it is worse than the PR says.** The old code does not need a *write*
to be in progress. It throws whenever **any other connection merely has the WAL database
open**, idle:

```
[new] openop … -> {"ok":true,"mode":"wal"}            # a new-build handle, open and idle
[old-fresh-A] openop … -> {"ok":false,"ms":2,"error":"database is locked","code":"SQLITE_BUSY"}
```

2 ms, no wait, and `Store.open` throws — so the old process gets nothing, not a degraded
handle. And with nothing else open, the same old open **succeeds and converts the store
back to DELETE**:

```
before old open:  main=110592  -wal=8272  -shm=32768
[old-fresh-B] openop … -> {"ok":true,"mode":"delete"}
sidecars:         main=110592  -wal=—     -shm=32768   # the -wal was checkpointed in, then removed
[old-fresh-B] count -> 7                                # every row still there
```

**Is data ever lost? Can a flip back to DELETE happen while another connection is in WAL
with uncheckpointed frames? No, and no — and the two answers are the same answer.** The
WAL → DELETE conversion needs the exclusive lock, so it **fails with `SQLITE_BUSY` whenever
any other connection has the file open at all** (case (i) above, 2 ms, idle handle). It can
therefore only succeed on a **quiet** store, and when it succeeds SQLite checkpoints the
`-wal` into the main file before removing it — row count preserved through
WAL → DELETE → WAL (7 rows in, 7 rows out). A flip forward with an old idle handle attached
leaves that handle working. **The store can flap between modes** as old and new processes
alternate, and each flap is safe for the data; what is not safe is the moment of the flap,
where the losing side gets `database is locked` at open with zero wait and `Store.open`
throws.

**Which real old-build processes open fresh connections?** I checked all three:
- the **MCP server** — one `Counterpart.open` in `openServer`, closed at exit. Never re-opens. Safe.
- the **dashboard server** — one `Dashboard.open` in `startDashboard`; requests use `src.store`. Never re-opens. Safe.
- the **worker** — spawned fresh from a hook, so after the deploy it *is* new code. Safe.

So the exposure is not the running servers; it is **anything the owner types**, and
specifically **a `counterparts` command run from a checkout that is not the deployed one** —
an agent worktree, the shared checkout before it moved, a stale terminal. There are eight or
more agent worktrees around.

**Smallest fix:** none in this PR's code — the old code is on `master` and cannot be changed
retroactively. The fix is the deploy procedure below: close everything old **before** the
checkout moves, and never run a `counterparts` command from a stale checkout afterwards.

---

## MAJOR

### MAJOR-1 — `databaseBytes()` counts the `-wal` as *reclaimable*, and it is not

**Where:** `src/adapters/cli/commands.ts:2434-2437` (`databaseBytes`), used at 2461
(`reclaimableBytes`), 2564, 2625, 2736.

**What goes wrong:** the builder fixed a real under-report (a cache whose content sat in the
sidecar read as 1.8 MiB) by adding the `-wal` to the size. But `reclaimableBytes` subtracts a
`VACUUM INTO` copy from that number, and a `VACUUM INTO` copy never contains the `-wal`'s
duplication — the `-wal` holds *copies of pages that are already counted in the main file*.
So the whole `-wal` is now reported as space a `VACUUM` would give back. It would not; a
**checkpoint** gives it back, and a checkpoint happens on its own.

**Proved.** A cache with **nothing to reclaim** — 2000 fresh rows, no deletions:

```
no-garbage store: main=4112384 wal=4144752 vacuumed-copy=4112384
  reclaimableBytes (new) = 4144752   <- claims 4.1 MB is reclaimable
  reclaimableBytes (old) = 0         <- the truth
```

4,144,752 clears `worthCompacting`'s two tests easily (`> 1 MiB` and `> size/20`), so
`migrate-cache` now recommends — and with `--apply`, performs — a full `VACUUM` of a
perfectly compact cache whenever the `-wal` happens to be fat. On the same probe, the
"reclaimed" line it prints afterwards is also wrong in the other direction: real reclaim
4.1 MB, reported 8.2 MB, because the VACUUM's own output is sitting in the new `-wal`.

**Failure scenario:** the owner runs `counterparts migrate-cache --apply` after a busy day.
It says 4 MB is reclaimable, takes the exclusive lock on box 3 for the length of a VACUUM,
rewrites the whole file, and reports a reclaim that did not happen.

**Smallest fix:** measure the logical size, not the file set — `page_count * page_size`
from the two pragmas on the open handle. That is correct wherever the pages happen to be
sitting and needs no lock. (The other obvious fix, `PRAGMA wal_checkpoint(TRUNCATE)` before
each `statSync`, has a hole: with the dashboard or a session open on box 3 the checkpoint
returns `busy` and the number is wrong again.)

### MAJOR-2 — a WAL store on read-only media is unreadable, where a DELETE store was readable

**Where:** the consequence of `openDb`'s WAL default for `openOperational` writers, and of
WAL itself. The floor plan's "risk 1" is about the read-only *connection*; this is about the
read-only *medium*, which nobody checked.

**Proved.** Same store, same code, sidecars absent, directory `chmod 555`:

```
WAL header:    observer open  -> SQLITE_READONLY_DIRECTORY  "attempt to write a readonly database"
               read-only open -> SQLITE_CANTOPEN            "unable to open database file"
DELETE header: observer open  -> ok, reads its rows
               read-only open -> ok, reads its rows
```

**Failure scenario:** a year from now the owner mounts an old backup read-only, or restores
a store onto a read-only volume, or an archive tool strips the sidecars, and points
`counterparts status --dir` or the dashboard at it. Today that works. After this, it
refuses with a message about writing to a read-only database — on an instrument whose whole
promise is that it does not write.

This is survivable today because `counterparts backup` produces a **DELETE-mode** copy
(`VACUUM INTO` output always is — the PR pins this), so the snapshots the owner actually
takes are readable. But the live store itself, copied to read-only media, is not.

**Smallest fix:** in `openOperational`'s instrument path (`initialize === false`), when the
file's header says `wal` and the `-shm` is absent and the directory is not writable, open
with SQLite's read-only WAL fallback rather than a read-write handle — or, much cheaper and
probably enough for now, catch `SQLITE_READONLY*`/`SQLITE_CANTOPEN` at `Store.open` and turn
it into a named `StoreError` that says "this store is in WAL mode and this medium is
read-only; take a `counterparts backup` of it from a writable copy". A sentence beats a
`SQLITE_READONLY_DIRECTORY`.

### MAJOR-3 — a copy of the main file alone now opens and *lies* instead of refusing

**Where:** the consequence of WAL; nothing in the diff guards it.

**Proved.** A WAL store, four writes, `cp` of `operational.sqlite` alone:

```
sidecars: main=4096  -wal=24752  -shm=32768
read-only open of the copy -> SQLITE_CANTOPEN
observer  open of the copy -> "no such table: f1probe"     # it opened. It is just empty.
```

The read-only path fails loudly, which is fine. The **read-write path opens the copy and
reports a store that is missing everything since the last checkpoint** — on my probe, that
was everything. A `Store.open` on such a copy would throw `STORE_UNINITIALIZED` on a fresh
store (I saw that too) but on a real one, where the main file holds most of the history,
it would open and be *silently short*.

`tools/recall-bench` (README line 21, `bin/bench.ts:38`, `index.ts:21`) tells the owner
`cp -R ~/.counterparts/store /tmp/store-copy`. `cp -R` copies the sidecars, so that advice
still works — the builder is right about that. The hazard is the one-file `cp`, which
nothing in the tree recommends but which is the obvious human move.

**Smallest fix:** one line in `store/NOTES.md` and in the recall-bench README: *since WAL,
`operational.sqlite` alone is not the database — copy the directory or use
`counterparts backup`.* Optionally, `Store.open` could notice a `wal` header with no
sidecars and say so, but that state is legitimate (a cleanly checkpointed store), so a
refusal would be wrong; a doc line is the honest fix.

---

## MINOR

### MINOR-1 — nothing durable records that a writer open ended up *not* in WAL

`convertToWal` swallows the refusal and returns. There is no event row, no warning, no
`doctor` line. The only surface is `counterparts verify`'s new `Journal mode:` line, and its
own comment concedes the reading is ambiguous ("`delete` means no writer on this build has
opened it since the deploy — **or** that one on the build before it has"). Under this
project's own norm — every stand-down is observable — a conversion that silently did not
happen should leave a trace. **Smallest fix:** emit one event
(`store.journal.unconverted`, detail: the mode found) from `openOperational` when a writer
open asked for WAL and the mode afterwards is not `wal`, and have `doctor` read it.

### MINOR-2 — a contended flip does not always fail in a millisecond: a reader makes the open wait

**Where:** `src/core/store/db.ts:133-138` (the comment on `convertToWal`),
`src/core/store/NOTES.md`'s new section, and the PR body — all three state as measured fact
that *"SQLite does not run the busy handler for a journal-mode change… it fails in about a
millisecond, not after the five-second wait."*

That is true only when the contention is a **writer**. When another connection holds a
**shared (read) lock**, SQLite *does* run the busy handler, and the open waits. Proved, both
arms:

```
holder in BEGIN IMMEDIATE;     a new wal:true open ->    3 ms, mode stays "delete"   (as claimed)
holder in a deferred READ txn; a new wal:true open -> 5297 ms, mode stays "delete"   (not as claimed)
```

**Why this is MINOR and not worse.** My probe held the read lock for the full five seconds,
so the flip lost; a real 300 ms read produces a 300 ms wait and a **converted** store — the
busy handler retries and wins the moment the reader lets go. And in DELETE mode that same
opener's first *write* would have waited on the same shared lock anyway, so the wait moved
from first-write to open; it did not grow. **No fix to the code is needed** — capping the
conversion's own timeout would only leave the store in DELETE longer without saving any
latency. **Smallest fix: correct the three places that state it as fact**, so the next person
reading them does not budget an open at one millisecond.

### MINOR-3 — the swallow's edges

- **Too narrow, in one direction that now bites:** `SQLITE_READONLY` propagates out of
  `convertToWal`, so a **writer** open of a DELETE-mode store on read-only media now
  **throws at open** where the old code opened it fine and failed at the first write.
  Proved: `WRITER (new code, wal:true) -> SQLITE_READONLY "attempt to write a readonly
  database"`. Arguably correct (a writer on read-only media is doomed), but it is a
  behaviour change the PR does not mention.
- `isLocked` reads `(err as {code?}).code` with no null guard (`db.ts:158`); a thrown
  `null`/`undefined` becomes a `TypeError` inside the catch. One `?.` fixes it.
- `isLocked` also matches any message *containing* "database is locked", which will catch
  a wrapped error that merely quotes the phrase. Harmless today.

### MINOR-4 — `test/cli.test.ts`'s backup-mid-write assertion lost its teeth

`test/cli.test.ts:495` now asserts `existsSync(`${paths.operational(dir)}-wal`)` where it
asserted `-journal`. Under WAL the `-wal` exists **from the moment the store is opened**,
so the assertion is vacuous — it can never fail while the store is in WAL. Worse, I measured
that an *uncommitted* write does not reach the `-wal` at all: through an open
`BEGIN IMMEDIATE` the `-wal` stayed **0 bytes** and grew only at `COMMIT`. So the fixture no
longer witnesses "live state in a sidecar and a main file that is not, on its own, the
database" — the comment's new claim is not what the assertion checks. **Smallest fix:**
assert what is now true and load-bearing — that the `-wal` is **non-empty** (earlier commits
are in it) before the snapshot, and that the vacuumed copy contains those committed rows and
not the uncommitted one. The second half of the test already does the real work.

### MINOR-5 — `verify --rebuild`'s fails-closed fixture now only covers the sidecar-free shape

`test/cli.test.ts:1611` deletes `cache.sqlite-wal` and `-shm` along with garbling the main
file, because "a `-wal` beside a garbled main file is a database SQLite recovers from". That
is true and the fixture had to change — but the shape it removed is the **realistic live
one**: a real garbled main file will normally have a real `-wal` beside it. The guard is now
tested only where it was already easy. **Smallest fix:** keep the fixture as written and add
a sibling case that garbles the main file *with* the sidecars in place and asserts whatever
the correct behaviour is there (recovery, or a named refusal) — so the branch is decided
rather than deleted.

### MINOR-6 — `journalModeOf()` takes a read-write handle from inside an observer command

`db.ts:170-177` opens with `openDb(path)`, which is `new Database(path, { create: true })` —
a read-write handle with create-on-missing — and it is called from `verifyCensus`
(`commands.ts:2233`), which is `Store.open({ dir, observer: true })`. On a WAL store this
creates/writes the `-shm`; on a missing path it would create an empty database file. It is
after the census so the file exists, and the `-shm` is excluded from every byte-identity
suite, so nothing catches it — but it is an instrument taking a writable handle to answer a
read. **Smallest fix:** open read-only for this one call (a read-only connection reads the
journal mode fine when the sidecars are there), or reuse the store's own handle.

---

## NIT

- **NIT-1 — the first observer open of the live box 3 converts it.** `openCache` passes
  `{ wal: true }` unconditionally (`cache.ts:190`), so the first `observer: true` open of
  the live, DELETE-mode `cache/cache.sqlite` rewrites its header. Proved: after building a
  store with old code and opening it with new code as an observer,
  `cache/cache.sqlite` **changed content hash** and two sidecars appeared. Subsequent
  observer opens are idempotent (verified). The PR argues this is licensed — box 3 is
  declared rebuildable and the constructor already materializes `cache/` under an
  instrument — and I agree that is defensible. What is worth naming is that **no test
  covers it**: every fixture is built by new code, so box 3 is already WAL by the time the
  byte-identity suites look, and the one-time conversion they would otherwise catch only
  exists on the live store. I also watched box 3 **flap**: an old-build write after the
  observer's conversion put it back to DELETE and removed the `-wal`, leaving a stale
  `-shm`. Safe, but noisy.
- **NIT-2 — `isDatabaseSidecar` also skips `-journal`.** Harmless in steady state, but
  during the deploy window an old-build process can leave a `-journal` beside the database
  and the five hash helpers would now be blind to it. Consider skipping only `-shm`, which
  is the one with the measured reason.
- **NIT-3 — WAL costs about four open file descriptors per connection instead of one, and
  bun's `close()` does not release them promptly.** Measured, 100 `openDb` + `close()`
  cycles on 100 distinct files in one process: **403 open fds on this branch, 104 on
  `master`**. They are reclaimed by GC (the count fell to 241 during the next loop), and
  `ulimit -n` here is 1048576, so this is not a practical risk — and no long-lived process
  opens more than one store. Recording it because the PR raises `close()` and this is its
  measurable size.
- **NIT-4 — `docs/QUICKSTART.md:155-162` draws the store tree without `operational.sqlite-wal`
  and `-shm`.** After this deploy a new user's `ls` shows two files the quickstart does not
  name. One line.

---

## Filesystems (reasoned from the SQLite documentation and the code; nothing was mounted)

WAL needs shared memory: SQLite maps `<db>-shm` and requires real `mmap` semantics shared
between processes. The documented consequences, mapped onto this code:

- **NFS / SMB / any network filesystem.** WAL is documented as not working there. Two
  shapes are possible and the code handles them differently:
  - `PRAGMA journal_mode = WAL` **returns the old mode without raising** (SQLite reports the
    *resulting* mode as the statement's result row). `convertToWal` **discards that row**
    (`db.ts:149` — `db.get(...)` with the result thrown away), so a silent refusal is
    invisible: the store stays in DELETE, which is safe, and nobody is told. Combined with
    MINOR-1, a store on a network mount would run in DELETE forever with `verify` the only
    way to notice.
  - Or the header write succeeds and the `-shm` cannot be created, in which case **every
    subsequent open raises** `SQLITE_IOERR_SHMOPEN`/`SQLITE_CANTOPEN` and the store is
    unopenable on that medium until it is copied somewhere with working shared memory. This
    is the dangerous shape, and there is no guard against it.
- **iCloud Drive / Dropbox / OneDrive folders.** These are ordinary local POSIX
  filesystems, so shared memory works and SQLite will run. The hazard is the sync client:
  it now has three files that must be captured at one instant and will copy them in
  whatever order it likes. Under DELETE, a synced copy taken between transactions was
  usually a consistent database; under WAL, a copy with a mismatched `-wal` is not, and the
  `-shm` should never be synced at all. A store in a synced folder is a worse idea after
  this PR than before it.
- **Recommendation:** one paragraph in `store/NOTES.md`, and — if it is cheap — have
  `openOperational`'s writer path check the mode after asking for WAL and emit MINOR-1's
  event when it did not take. That single event covers both the network-filesystem refusal
  and the contended refusal.

---

## Deploy day, in order

The store is 16,000 memories of real private memory, several old-build MCP servers are
holding handles, and this is the first change of the rebuild to touch it. The procedure
below is what I would do. Steps 1–3 are the ones that matter; skipping them is survivable
but noisy, and what the owner would see is spelled out at the end.

**Before the checkout moves**

1. **Fix the recipe first (BLOCKER-1).** Stop using
   `sqlite3 -readonly "file:…?immutable=1"` against the live store, and correct the six
   documents that teach it. Plain `sqlite3 -readonly "<path>" "<sql>"` reads the `-wal` and
   is correct — verified. Do this *before* the deploy, so no diagnosis taken after it is
   quietly short.
2. **Take a backup while the store is still in DELETE mode.**
   `counterparts backup --out <dir outside the store>`. It goes through `VACUUM INTO`, so
   the copy is a plain DELETE-mode database readable by anything, including an old
   checkout. That is the revert lever, and it is worth more taken before the flip than after.
3. **Close every old-build process that could open a fresh connection (BLOCKER-2).** Quit
   all Claude Code sessions (each takes its MCP server with it), stop the dashboard with
   ctrl-c, and confirm nothing is left: `pgrep -fl counterparts`. Do this **before** the
   deploy, not after. The running servers themselves would survive the flip — I proved
   that — but with them gone there is nothing alive that can fresh-open with old code, and
   the first flip happens on a quiet store where it cannot be refused.

**The deploy**

4. Run `tools/deploy-checkout.sh` (the owner's step; I did not run it).

**The first contact, in this order**

5. **Make a writer open happen deliberately.** Start **one** Claude Code session and let
   its SessionStart hook write. Note that `counterparts verify` and `counterparts status`
   open as **observers** and will *not* convert the store — the PR's "on the live store"
   list implies step 1 shows `wal`, and it will not until a writer has run.
6. `counterparts verify --config ~/.counterparts/claude-code.json` → expect
   `Journal mode: wal (busy timeout 5000 ms)`. If it says `delete`, a flip was refused
   (MINOR-2); nothing is wrong, just repeat step 5 and look again.
7. `ls -la ~/.counterparts/store/` → `operational.sqlite-wal` and `operational.sqlite-shm`
   present, plus `cache/cache.sqlite-wal` and `-shm` inside `cache/`. The store still opens;
   they are classified.
8. `counterparts doctor --config ~/.counterparts/claude-code.json` → green as usual.
9. `counterparts backup --out <a second dir>` → succeeds, and the copy is a DELETE-mode
   database. This proves the backup path still works under WAL.
10. Re-open the rest of the sessions and restart the dashboard.

**Standing rules from this day on**

11. **Never run `counterparts` from a checkout that is not the deployed one against the live
    store.** That is the one remaining way to hit BLOCKER-2, and there are eight or more
    agent worktrees sitting at old commits.
12. **Never copy `operational.sqlite` on its own** (MAJOR-3). Copy the directory or use
    `counterparts backup`.
13. **Never delete the `-wal`.** Committed memories live in it until a checkpoint. Deleting
    it deletes them — I watched a store go from 20 rows to "no such table" that way.
14. Do not put the store on a network mount or inside a synced folder.

**If the procedure is skipped entirely, what the owner sees:** most likely nothing at all —
the open MCP servers keep working, the first hook flips the store, and everything continues.
The two ways it goes wrong: (a) he types a `counterparts` command in an old worktree, and it
either dies with `database is locked` at once or silently puts the store back into DELETE,
at which point the I38 lock reports return until the next new-build writer converts it
again; and (b) every `?immutable=1` query he runs from then on returns a number that is
quietly short, with no error to warn him.

---

## Method, for the record

Two scratch worktrees: this branch, and a second detached at `origin/master` for the
old-code side, removed after the review. Probes were subprocess pairs driven over stdin
against throwaway stores under the session scratchpad, so every "old code vs new code"
result is two real processes on one real file, not a simulation. All probe scripts are
prefixed `f1-review-` and stay local. `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` was exported in
every shell. `~/.counterparts`, `~/.bansai` and `~/.claude-engram` were never touched, and
neither was `/Users/mlapeter/counterparts`.

Two actions were refused by the permission classifier and not retried: a backgrounded
`bun test` writing its log to the scratchpad, and two compound shell commands the
worktree-isolation guard could not verify. All three were re-run as plain foreground
commands with the same result, so nothing is missing from this review.

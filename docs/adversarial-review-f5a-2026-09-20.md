# Adversarial review A — PR #148, `floor/f5-the-floor` (head `20adaf6`, base `40f92ae`)

*2026-09-20. Reviewer A of two, working independently in its own scratch worktree.
Nothing on the branch was changed, nothing committed, nothing pushed, nothing deployed.
Every probe ran against throwaway stores under the session scratchpad; `~/.counterparts`,
`~/.bansai`, `~/.claude-engram`, `~/counterparts-backups` and the live checkout were
never opened, read or written. `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` in every shell, and
every spawned process ran under `env -i` with a throwaway `HOME`.*

**My half:** the refusal, the old store's safety, crash safety, and the cut-over.

---

## Verdict, up front

**MERGE AFTER FIXES.**

The refusal itself is right, and I could not break it from the direction it was built to
defend. I pointed **29 distinct new-code entry points** at a real v5 store built by
master's own code — with uncheckpointed frames sitting in its `-wal` — and every one of
them refused by name, before opening anything, leaving the directory byte-for-byte
identical apart from the one write the PR already admits. The filename-over-schema-version
argument holds: I confirmed by measurement that nothing opens the old database.

What is not right is the **other** direction, and both findings are about cut-over week
rather than about the floor's design:

- **MAJOR-1** — one old-build hook firing once on a v6 store (the rollback the owner has
  planned) makes the v6 store permanently unopenable by the new build, and the refusal
  then tells him it is "readable by `floor/v5-last`" — the build that just stood down.
  Neither build opens. No data is lost; nothing on any surface says what to delete.
- **MAJOR-2** — a v5 database wearing the v6 *name* is **migrated and stamped v6**. The
  filename check is the *only* lock; `ADDED_COLUMNS` being empty is not a second one. After
  that the old build refuses it with `SCHEMA_AHEAD` and the new build cannot read a body.
  This is the one outcome F5 exists to prevent, reached without a single line of the
  refusal being wrong.

**Findings by rank:** 0 BLOCKER, 2 MAJOR, 4 MINOR, 3 NIT.

**Suite, as printed on this machine (`caffeinate -i ~/.bun/bin/bun test`):**

```
 2473 pass
 1 fail
 31254 expect() calls
Ran 2474 tests across 42 files. [128.45s]
```

The one failure is `test/claude-code.test.ts > … the sentinel search is LINEAR`, a
wall-clock assertion (`expect(elapsed).toBeLessThan(100)`, measured 139–150 ms). **It fails
identically on master `40f92ae`** (run from a clean `git archive` of that tree:
`180 pass / 1 fail`), so it is this machine, not this PR. The PR's `2474 / 0` claim is
credible; I could not reproduce it here and neither could master.

**Typecheck:** `~/.bun/bin/bunx tsc --noEmit` → **clean, no output, exit 0**.

**`$TMPDIR` leftovers:** `counterparts-*` directories under
`/var/folders/6y/rgb1z5f51z1cf989j4vbjqnr0000gn/T/` — **80 before the suite, 80 after.**
No new leftovers. (The 80 are pre-existing, from other sessions.)

---

## What I ran, so the findings below can be weighed

A **real v5 store, built by master's own code** — not a hand-rolled fixture:
`git archive 40f92ae | tar -x` into the scratchpad (no `git worktree add`, so nothing was
written into the live checkout's `.git`), then a script using *that* tree's `Store` to
`put` six memories, `revise` three times (two version files under `versions/`, one dir
per memory), plus `spans/` and `sessions/` entries. The writer was **`SIGKILL`ed instead
of closed**, so the store carries committed-but-uncheckpointed frames: a 4 096-byte
`operational.sqlite` beside a **243 112-byte `operational.sqlite-wal`** — i.e. essentially
every one of the owner's words lives in the `-wal`. That is the shape the refusal has to
leave alone, and it is the fixture every probe below copies.

**Fingerprint** = `find .` sorted (so a new empty *directory* shows) plus sha256 and byte
count of every regular file **including `-wal` and `-shm`**. The `-shm` is deliberately
*not* exempted: on the refusal path the database is never opened, so it must be identical
too.

---

## MAJOR

### MAJOR-1 — the rollback bricks the v6 store for the new build, and the refusal points the owner back at the build that just failed

**What is wrong.** `PRE_ROWS_MARKERS` are names the *old build itself creates*. Master's
`Store` constructor mkdirs `prose/`, `versions/`, `tmp/`, `cache/` and mints
`operational.sqlite` **before** it reaches `assertLayout()` — so an old-build writer
touching a v6 store leaves three of the three markers behind before it refuses. From that
moment the new build refuses its own store, for ever, with
`readableBy: "floor/v5-last"` — pointing at the build that has just stood down on the same
store. Both builds are dead; the sentence sends him in a circle.

This is not hypothetical for cut-over week: the plan's rollback *is* re-pointing the
checkout at the old code, and the first thing that happens after a checkout moves is a
session's `SessionStart` hook.

**Reproduction I ran** (`scratchpad/oldhook.sh`) — a v6 store built by this branch, then
**one** SessionStart through master's real `bin/hook.ts`:

```
[counterparts] hook stood down: LAYOUT_UNCLASSIFIED {"name":"counterparts.sqlite-wal"}
{"systemMessage":"Counterparts memory is OFF for this session: the store would not open (LAYOUT_UNCLASSIFIED). Run: counterparts doctor"}
exit=0
--- what the old hook left in the v6 store ---
  > 3d1e98365599c0aadf69ebddee20431cd8525432f9306c8b0e82a09f9ef2b76d  4096  ./operational.sqlite
  > be6e032041b7f01563aa437a65a291a67acb7ca51fa4511a335ce0b981efa387  32768  ./operational.sqlite-shm
  > f78961791ec8795a5ef40f0d77b69ac925acb44173c02aeea836b8ff81b0b7fc  107152  ./operational.sqlite-wal
  > DIR  ./prose
  > DIR  ./sessions
  > 985f33ed30fc5d35b49fed5b8fa76bc8bfeb5c76943cb023992c557007522a7b  183  ./sessions/roll-1.standdown.json
  > DIR  ./tmp
  > DIR  ./versions
--- and now the NEW build on that store ---
REFUSED (new/writer) code=STORE_PRE_ROWS {"dir":"…/oldhook","found":"operational.sqlite","expected":6,"readableBy":"floor/v5-last"}
```

The same through the library (`scratchpad/reverse.sh`), with the old **observer** as the
control:

```
--- 2. OLD code, OBSERVER, on the v6 store ---
REFUSED (old/observer) code=STORE_UNINITIALIZED {"path":"…/operational.sqlite","expected":5}
  fingerprint: IDENTICAL
--- 3. OLD code, WRITER, on the v6 store ---
REFUSED (old/writer) code=LAYOUT_UNCLASSIFIED {"name":"counterparts.sqlite-wal"}
  (mints operational.sqlite + sidecars, prose/, tmp/, versions/)
--- 4. and now NEW code on that same store (roll forward) ---
REFUSED (new/writer) code=STORE_PRE_ROWS {"found":"operational.sqlite","readableBy":"floor/v5-last"}
--- 5. and OLD code again (roll back a second time) ---
REFUSED (old/writer) code=LAYOUT_UNCLASSIFIED {"name":"counterparts.sqlite-wal"}
--- 6. after removing exactly what the old build left, does NEW open? ---
OPENED (new/writer) rows=6
```

**Good news inside it:** the old *observer* writes nothing at all, the v6 data is never
touched, and step 6 proves the store comes back intact once
`operational.sqlite*`, `prose/`, `versions/` and `tmp/` are removed. The damage is a
lockout with no instructions, not a loss.

**Smallest fix.** Keep refusing — a directory holding both floors' names is genuinely
ambiguous and must not be minted into. Change the *sentence*, and **discriminate before
telling anyone to delete anything.** The old build's leftovers are an **empty** `prose/`
and an **empty** `versions/`; a real v5 store's are not, and a store that has both names
because somebody hand-copied a `counterparts.sqlite` into it is holding 16 973 memories
under `prose/`. "Remove `operational.sqlite*`, `prose/`, `versions/`, `tmp/`" is the right
instruction for the first and a catastrophe for the second, so the detail has to know
which it is looking at — and `readdirSync` on a directory answers that without opening
anything:

```ts
const preRows = PRE_ROWS_MARKERS.find((name) => existsSync(join(this.dir, name)));
if (preRows !== undefined) {
  const alsoNewFloor = existsSync(paths.operational(this.dir));
  const emptyOld = ["prose", "versions"].every(
    (d) => !existsSync(join(this.dir, d)) || readdirSync(join(this.dir, d)).length === 0,
  );
  throw new StoreError("STORE_PRE_ROWS", {
    dir: this.dir, found: preRows, expected: SCHEMA_VERSION,
    ...(alsoNewFloor && emptyOld
      ? { alsoFound: DATABASE_FILE,
          remedy: `${DATABASE_FILE} is this build's store; an older build left EMPTY operational.sqlite*, ` +
                  `prose/, versions/ and tmp/ beside it. Remove those four and this store opens again.` }
      : alsoNewFloor
      ? { alsoFound: DATABASE_FILE,
          remedy: `this directory holds TWO stores' names — a pre-rows store (${preRows}, with words in it) ` +
                  `and a ${DATABASE_FILE}. Do not delete either; move one out and name the one you mean.` }
      : { readableBy: "floor/v5-last" }),
  });
}
```

And one line in the cut-over procedure (below): **once `counterparts.sqlite` exists, a
rollback means restoring the parked v5 directory, never pointing the old build at the new
store.** If `tools/deploy-checkout.sh` can see the store, it is the right place to refuse
a checkout of `floor/v5-last` against a directory that has a `counterparts.sqlite`.

---

### MAJOR-2 — a v5 database wearing the v6 name is migrated and **stamped v6**; afterwards neither build can read it

**What is wrong.** The filename check is the *only* lock. Past it, `openOperational`
does what it always did for anything below `SCHEMA_VERSION`: runs the DDL
(`CREATE TABLE IF NOT EXISTS`, so the v5 `memories` table is left alone and gains no
`body` column), runs `ensureAddedColumns` (a no-op, `ADDED_COLUMNS` is empty), and then
`INSERT OR REPLACE … 'schemaVersion' … 6`. The PR calls the empty `ADDED_COLUMNS` "the
second lock". It is not a lock at all: it prevents a NULL `body` column being *added*, and
does nothing to stop the **version stamp**, which is what makes the store unreadable by
the build that can read it. The result is strictly worse than the NULL-body outcome the
comment describes — the column is simply absent, so reads fail with a SQL error rather
than a blank.

The builder's reason for dropping plan §2's version check ("the rename means a v5 dir has
no `counterparts.sqlite`, and opening a WAL store to read its version checkpoints it")
is sound for the *filename* door and does not apply here: by the time `openOperational`
runs, this build has already opened the file itself.

**Reproduction I ran** (`scratchpad/case-i.sh`) — the "I'll just rename it" migration: a
real v5 store, `prose/` and `versions/` moved aside, the database renamed to the v6 name:

```
--- BEFORE: the database says ---
schemaVersion= 5  memories= 6  has body col= false
--- new code opens it (writer) ---
OPENED (new/writer) rows=6
--- AFTER: the database says ---
schemaVersion= 6  memories= 6  has body col= false  has versions table= 1
--- can NEW code read a memory's words? ---
list -> 6 rows
readProse THREW: StoreError: ID_UNKNOWN {}
--- put the OLD layout back and hand it to the OLD build ---
REFUSED (old/writer) code=SCHEMA_AHEAD {"path":"…/operational.sqlite","expected":5,"found":"6"}
```

`schemaVersion` went `5 → 6` in a store with no `body` column, and after that the old
build refuses it permanently. Recovering it means hand-editing `meta` with `sqlite3`.

**How reachable is it?** It needs a deliberate hand-rename *and* `prose/`/`versions/` out
of the way — if either is present the filename door fires first (measured: case (d), a
directory holding both `operational.sqlite` and `counterparts.sqlite`, refuses
`STORE_PRE_ROWS` and mints nothing). So this is not a blocker. It is a MAJOR because the
rename is the headline of this PR, "rename the file" is the first thing a person tries,
and the fix is three lines that the plan already specified.

**Smallest fix.** Put a second lock inside `openOperational`, where the file is already
open and the WAL argument is moot. A bare `found < SCHEMA_VERSION → throw` is *not* free —
I checked, and three tests assert the opposite, all of them on a genuinely v6-shaped
database whose stamp was lowered by hand (`test/store.test.ts`: "a store BELOW the read
floor refuses under observer rather than migrating itself" (`setMeta '1'`), "a store one
version behind refuses under observer" (`SCHEMA_VERSION - 1`), and the `'3'` stamp at
~1518, which asserts the migration keeps the words). So gate on the **shape**, which is
what actually distinguishes a pre-rows database from a stamp somebody moved:

```ts
// in openOperational, after `found` is read and the SCHEMA_AHEAD guard, writer path:
const preRowsShape =
  found !== null && Number.parseInt(found, 10) < SCHEMA_VERSION &&
  !db.all<{ name: string }>("PRAGMA table_info(memories)").some((c) => c.name === "body");
if (preRowsShape) {
  db.close();
  throw new StoreError("STORE_PRE_ROWS", {
    path, expected: SCHEMA_VERSION, found, readableBy: "floor/v5-last",
  });
}
```

That refuses exactly the database this build cannot read and leaves all three tests
passing. It is the invariant the CONTRACT's new G16 already claims, and it is the lock the
PR body mistakes `ADDED_COLUMNS` for.

---

## MINOR

### MINOR-1 — `migrate-cache` never reaches the refusal, and writes into a parked pre-rows store

`migrate-cache` does not open a `Store` at all; it opens box 3 directly. Pointed at a real
v5 store it runs happily, prints a census, and **never names `STORE_PRE_ROWS`**. Measured
(`scratchpad/mcapply.sh`, `--apply --yes`):

```
Store: …/work/mcapply
Cache: …/work/mcapply/cache/cache.sqlite  (48.0 KiB, schema v4)
Vectors: 0   float32 BLOB: 0   JSON text: 0
Converted and compacted. Nothing to do.
--- delta ---
< 79b0cc…  32768  ./cache/cache.sqlite-shm
> 5f6ae6…  32768  ./cache/cache.sqlite-shm
```

Here the fixture's cache holds no vectors, so only the `-shm` moved. On the owner's real
parked store it holds ~17 000 documents' index; `--apply` would rewrite and `VACUUM` it in
place. Box 3 is declared rebuildable and is out of the backup set, so this is not memory
loss — but it is a door that writes into a store this build has declared it cannot read,
and a rebuild of that cache after a rollback is a paid re-embed.

*Fix:* call `storeExists`/the marker check at the top of `migrateCacheCommand` and refuse
by name, as the other ~20 console doors do.

### MINOR-2 — `verify --rebuild` rewrites the pre-rows store's `cache/cache.sqlite-shm` before it refuses

It *does* refuse by name and exits 3, but box 3 is opened first:

```
=== verify-rebuild (exit 3) ===
  refusal: STORE_PRE_ROWS named
  fingerprint: *** CHANGED ***
    < 79b0cc…  32768  ./cache/cache.sqlite-shm
    > 5f6ae6…  32768  ./cache/cache.sqlite-shm
```

`isDatabaseSidecar()` already argues the `-shm` holds no content, so I am not calling this
a broken promise — but "byte-identical afterwards" is not true of `verify --rebuild`, and
the CONTRACT's G16 should say `-shm` or the command should refuse before touching box 3.
Every other command in the sweep was byte-identical including the `-shm`.

### MINOR-3 — the console's refusal is a code and a JSON blob, and the hook's remedy points at the door that prints it

Verbatim, every console door:

```
could not open the store: STORE_PRE_ROWS {"dir":"…","found":"operational.sqlite","expected":6,"readableBy":"floor/v5-last"}
doctor failed: STORE_PRE_ROWS {"dir":"…","found":"operational.sqlite","expected":6,"readableBy":"floor/v5-last"}
verify failed:  STORE_PRE_ROWS {…}
Snapshot: none — nothing was copied.
  could not open the store: STORE_PRE_ROWS {…}
```

The **hook** is the one surface that says it in English, and it is good:

> `Counterparts memory is OFF for this session: this store keeps its memories in files, which this build does not read — it was written before the floor changed (STORE_PRE_ROWS). Run: counterparts doctor`

…except that `counterparts doctor` prints the blob above. The one instruction the owner is
given ends in a dead end. Nothing is a stack trace, and `status` correctly exits non-zero
and does **not** suggest `counterparts init` — both of those I checked and they hold.

*Fix:* one `describePreRowsRefusal(err, remedy)` beside `describeGuardRefusal` in
`paths.ts` (same shape, same reason — F1 built that pattern for exactly this), used by
`commands.ts`'s error printer. `doctor` should carry the sentence rather than the code.

### MINOR-4 — a directory holding only `operational.sqlite-wal`/`-shm` is **not** a marker: new code mints a store into it, then refuses with the wrong name

```
=== h: only operational.sqlite-wal/-shm ===
  new/writer: REFUSED code=LAYOUT_UNCLASSIFIED {"name":"operational.sqlite-shm"}
  after: cache counterparts.sqlite counterparts.sqlite-shm counterparts.sqlite-wal operational.sqlite-shm operational.sqlite-wal
```

`PRE_ROWS_MARKERS` uses exact `existsSync`, while `LAYOUT` deliberately prefix-matches its
sidecars. So a pre-rows directory whose main database was moved by hand is *not* seen as
pre-rows; the constructor mkdirs `cache/` and `openOperational` creates
`counterparts.sqlite` **before** `assertLayout` refuses, and on the wrong evidence. It is
not silent and nothing is destroyed, so it is a MINOR — but it is the one case in my sweep
where a *write* landed in a pre-rows directory ahead of the refusal.

*Fix:* **keep** the `existsSync` exact check exactly as it is — it is what catches `Prose/`
and `OPERATIONAL.SQLITE` on this case-insensitive filesystem, and a `readdirSync(...).find`
would lose both — and **add** a sidecar sweep beside it:

```ts
const preRows =
  PRE_ROWS_MARKERS.find((name) => existsSync(join(this.dir, name))) ??
  readdirSync(this.dir).find((n) =>
    PRE_ROWS_MARKERS.some((m) => n.toLowerCase().startsWith(`${m}-`)));
```

(It also picks up a stale `operational.sqlite-journal` from a pre-F1 store.)

---

## NIT

1. **`found` names only the first marker.** A v5 store reports `found: "operational.sqlite"`
   and never mentions the 16 000 files under `prose/` — which are the part the owner would
   actually want named. Reporting all present markers costs a `.filter`.
2. **`readableBy: "floor/v5-last"` is a git ref with no explanation.** It is right, and it
   is the only actionable token in the payload, but nothing tells the reader it is a tag to
   check out rather than a file to look for. The hook's sentence should carry it.
3. **`doctor` insists on a `--config` even when `--dir` names the store** (pre-existing, not
   this PR): `counterparts doctor --dir <store>` under the explicit-dir guard refuses with
   `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 and no configuration was named…`. On cut-over day
   "run doctor" is the standard instruction and the owner will hit this first.

---

## Checked and clean — what I attacked and could not break

**Every door at a real v5 store.** 29 entry points, each on its own pristine copy, each
fingerprinted before and after. All refused **by name** with `STORE_PRE_ROWS`, and all left
the directory — `operational.sqlite`, its 243 KB `-wal`, its `-shm`, `prose/`, `versions/`,
`spans/`, `sessions/`, `cache/`, `tmp/` — **byte-identical**:

`status` · `status --observer` · `verify` · `verify --prune-index` · `verify --rebuild`* ·
`fired` · `backup --out` · `export --out --plaintext` · `remove <id>` (dry) ·
`remove --confirm` · `self-page` · `self-page --versions` · `recall` · `note` · `probe-oq4` ·
`backfill-claims` · `repair-dates` · `repair-merged-beliefs` · `init` · `rebrief` ·
`doctor --config` · the **hook** on `SessionStart`, `UserPromptSubmit` and `Stop` · the
**detached worker** (`bin/runner.ts`) · the **MCP server** (`bin/serve.ts`, a real
`initialize` + `tools/call` on stdin) · the **dashboard** (`serve --dir`) · `Store.open`
writer · `Store.open` observer.
(*`verify --rebuild` and `migrate-cache` are MINOR-1/-2 above; every other one was identical
including the `-shm`.*)

- **It never opens the old database.** Nothing in any run produced a SQLite error, and the
  `-wal`/`-shm` bytes never moved — an open-and-close would have checkpointed them.
- **The one admitted write is the only one.** `sessions/<id>.standdown.json` appears on
  SessionStart and UserPromptSubmit (183–198 bytes), and on nothing else — `Stop` wrote
  nothing, the worker wrote nothing, the MCP server wrote nothing, the dashboard wrote
  nothing. I judge it **acceptable**, and I proved the thing that makes it acceptable rather
  than assuming it: **the old build still opens that exact store afterwards.** Master's
  `Store`, pointed at the v5 copy the new hook had just marked, printed
  `OPENED (old/writer) rows=6` and read the bodies; and master's **real `bin/hook.ts`**, run
  on the same directory, did not choke on a `code` it has never heard of — it ran an
  ordinary SessionStart (its only message was the unrelated "no `ANTHROPIC_API_KEY`" notice),
  wrote its own `sessions/sess-SessionStart.json`, and appended to the `-wal` (243 112 →
  259 592 bytes) exactly as a normal session does. `sessions/` is classified by *both*
  floors' `LAYOUT`, and the marker carries a code and a date and no memory text.
- **`status` exits non-zero (3) and does not print `counterparts init`.**
- **The hook exits 0, prints valid hook JSON with `systemMessage` only, and is graded
  `persistent`** — a second turn in the same session is silent, a new session is told
  (the PR's own test; I re-ran the real binary and saw the message and the marker).

**Marker games** (`scratchpad/markers.sh`), all measured:

| directory | result |
|---|---|
| only `prose/` | refuses, `found: "prose"`, nothing minted |
| only `operational.sqlite` | refuses, nothing minted |
| **empty dir, writer** | mints a fresh v6 store — correct, there is nothing to bury |
| empty dir, observer | `STORE_UNINITIALIZED`, writes nothing at all |
| `operational.sqlite` **and** `counterparts.sqlite` | refuses on the old name, **mints nothing** |
| v6 store + a folder called `prose` | refuses (this is MAJOR-1's mechanism, and here it is the *right* answer) |
| v6 store + a folder called `versions` | refuses |
| **symlinked** dataDir → v5 store | refuses (`existsSync` follows the link), nothing minted |
| `Prose/` (capital P, case-insensitive APFS) | refuses, `found: "prose"` |
| `OPERATIONAL.SQLITE` | refuses, `found: "operational.sqlite"` |
| v6 + unknown top-level file | `LAYOUT_UNCLASSIFIED` by name (pre-existing G11) |
| v6 + stale `counterparts.sqlite-journal` | opens; SQLite discards the journal; store intact |
| v6 + stale `operational.sqlite-wal` | `LAYOUT_UNCLASSIFIED` — refuses rather than opening |

**Nothing in that table silently started empty next to real data.** The only mint into a
non-empty directory is MINOR-4's sidecar-only case, and it still refuses.

**Crash safety on the new floor** (`scratchpad/kill9.sh`, `churn.ts`, `check.ts`). A child
opening a real v6 store and looping `put` → `putMany({isolate:true})` → `revise` → `revise`
→ `pruneSupersededVersions` (every 3rd) → `archive` (every 5th), **`SIGKILL`ed at 14
different instants**, each one only after a marker file proved its first write had
committed (so no round is vacuous; 172–276 rows survived per round). After every kill:

- a **writer** open — the one that recovers the `-wal` — never threw;
- `PRAGMA integrity_check` → `ok`, 14/14;
- every `memories` row checked individually: no `body IS NULL`, no blank body with a real
  hash, and **`content_hash === hashText(body)` on every row**;
- every `versions` row checked: **no orphan** (no version whose parent memory is gone),
  **no version with a missing body**.

```
round 1: {"opened":true,"rows":240,"tombstones":0,"integrity":"ok","problems":[]}
…
round 14: {"opened":true,"rows":172,"tombstones":0,"integrity":"ok","problems":[]}
rounds with a problem: 0 / 14
```

I specifically looked for the new window the PR's own text invites ("body in one
transaction, version in another") and did not find it: `revise` copies the head into
`versions` and updates the head inside one `mutate`, and 14 kills across that loop produced
no version without a live parent and no row whose hash stopped addressing its words. The
old "commit the row, then publish the file" window is gone and I could not replace it.

**Kill during first open / schema creation** (`scratchpad/killopen.sh`): **70 SIGKILLs**
across the boot-and-create window (two sweeps: 0.144–0.156 s at 0.3 ms steps, and
0.146–0.660 s), each followed by a reopen and the full row/version/integrity check. **0
broken stores.** Honest limit: I could not reliably land a kill *inside* the DDL
transaction from outside the process — every round that created anything had already
committed its first `put` — so the strongest statement I can make from measurement is "70
kills in that window, never a store that failed to come back". The DDL, the `ADDED_COLUMNS`
pass, the three meta upserts and the `schemaVersion` stamp are one `db.transaction`
(`operational.ts`, read not measured), so a kill inside it rolls back and the next open
re-creates — which is consistent with everything I saw.

**Concurrent first open** (`scratchpad/race.sh`): **three** processes creating the *same*
fresh v6 store simultaneously — the hook, the MCP server and the worker at session start —
**20 rounds**. Every round: 3/3 processes succeeded, `rows=3`, `integrity=ok`,
`schemaVersion=6`. **0 failures in 20.** The WAL flip plus DDL under contention is held by
`PRAGMA busy_timeout = 5000` being set first (`db.ts`), which is F1's doing and survives
here.

**`assertLayout` / layout totality:** `journal/` is classified before anything writes it
(scar §2.11's criterion, kept); an unknown top-level name refuses by name; `-wal`, `-shm`
and `-journal` of the *canonical* name are prefix-classified; of the *old* name they are
not, and refuse (MINOR-4 is the one ordering wrinkle).

---

## What I could not determine

- **The removal chase's `PRAGMA wal_checkpoint(TRUNCATE)`** (the PR's own headline
  caveat 1). I could not drive it: `counterparts remove <id> --confirm` refuses
  non-interactively (`refused: removal requires an interactive confirmation and this console
  has no prompt`), and my direct `ownerRemoval` harness failed on its own missing `actor`
  argument rather than on anything in the code. **I did not verify** that a chase leaves the
  doomed words out of both `counterparts.sqlite` and its `-wal`, nor what a contended
  TRUNCATE does. That claim rests on the builder's measurement, and it belongs to
  reviewer B's half.
- **Whether a contended TRUNCATE is common in practice** — same as the PR says; I saw none.
- **Node.** Everything here ran on bun 1.3.10. `node:sqlite` + WAL + rows is still untested.
- **Real-corpus behaviour** — 17 000 memories with bodies in rows, the 90-day prune's new
  cost, and the double-hold of revised text. My fixtures were 6 to ~300 rows.
- **The `$TMPDIR` count** is 80 before and after, but I did not audit *which* 80; the PR
  says they pre-date this branch and the count not moving is consistent with that.

---

## Cut-over day, in order

1. **Before anything moves:** a cold copy of the whole v5 store directory, taken with every
   Counterparts process stopped, to a path outside `~/.counterparts`. Not `backup`, not
   `export` — `cp -Rp` of the directory, **including the `-wal` and `-shm`**, because on a
   post-F1 store most of the recent writes are in the `-wal` and a copy of the main file
   alone is a lie (F1 review MAJOR-3).
2. **Stop every long-running process on the old build** — sessions, the MCP server, the
   worker, any dashboard. A rollback is only clean if nothing from the old build is holding
   the directory.
3. **Park the old store by moving the directory**, not by moving files out of it. A v5
   directory minus its `prose/` and `versions/` is exactly MAJOR-2's shape.
4. **Never rename `operational.sqlite` to `counterparts.sqlite`.** There is no migration.
   Until MAJOR-2's second lock lands, that rename is the one action that can make the old
   store unreadable by both builds.
5. **Start the new store as a new, empty directory.** Confirm the first open produced
   exactly `counterparts.sqlite`, its two sidecars and `cache/`.
6. **Prove the refusal once, on the parked copy** (not the parked original): point
   `counterparts status --dir <copy>` at it and read `STORE_PRE_ROWS`. That is the sentence
   the owner will see if the checkout ever slips.
7. **If a rollback is needed:** re-point the checkout at `floor/v5-last` **and** point it at
   the *parked v5 directory*. Do **not** let the old build touch the v6 store — one
   SessionStart hook is enough to lock the new build out of it (MAJOR-1).
8. **If that has already happened** (the v6 store has `operational.sqlite`, `prose/`,
   `versions/`, `tmp/` in it and the new build says `STORE_PRE_ROWS`): stop everything,
   **check that `prose/` and `versions/` are empty** (`ls`; the old build creates them
   empty — if they have files in them this is a v5 store, not a marked v6 one, and deleting
   them destroys memories), then delete exactly those four. The v6 store then opens with
   every row intact — I proved this (`reverse.sh` step 6, `OPENED rows=6`). Nothing else
   needs to be restored.
9. **After the flip:** `counterparts doctor --config <the config>` (it wants the config, not
   just `--dir` — NIT-3), then `verify`, and read the new `Floor: schema v6 · bodies in
   rows · prose files: none` line.

---

## Method, for the record

Worktree: `~/counterparts/.claude/worktrees/agent-a8f18d029967ef19e`, detached
at `20adaf6`. Master read via `git archive 40f92ae | tar -x` into the session scratchpad —
no `git worktree add`, so nothing was registered in the live checkout's `.git`. All probe
scripts lived in the scratchpad and were never added to the tree; `git status` shows only
this file, uncommitted. Every spawned process: `env -i PATH=/usr/bin:/bin HOME=<throwaway>
COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`. Every test and
typecheck under `caffeinate -i`. No `counterparts` command was ever run against anything
but a directory this review created.

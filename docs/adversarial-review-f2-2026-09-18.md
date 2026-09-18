# Adversarial review — PR #136, `floor/f2-snapshots` (head `45b37ba`, base `039cd5d`)

2026-09-18. Reviewed against `origin/master`, in a scratch worktree. Nothing was pushed,
nothing was commented on the PR, nothing was deployed. Every probe ran against trees built
under `$TMPDIR`; no probe was pointed at `~`, `/`, `~/.counterparts`, `~/.bansai` or
`~/.claude-engram`.

**Suite on the branch:** `bun test` → **2268 pass / 0 fail**, 28638 expect() calls, 39 files,
59.2 s. `bun run typecheck` (`tsc --noEmit`) → **clean, no output**. This matches the
builder's claim (he wrote 2267; the tree gives 2268 — an off-by-one in the PR body, nothing
more).

**Timing sensitivity:** none in the unit tests — the clock is injected everywhere (`now`, `date`)
and staleness is faked with `utimesSync`. The one place is the three worker-level tests at
`test/snapshots.test.ts:702-740`, which go through `runOnce` and therefore use the real clock for
both `today` and `snapshotName(Date.now())`. That is N-2's exposure: a run straddling UTC midnight
would file the copy under tomorrow's name while the row says today's date. Roughly one run in a
thousand, and only at midnight UTC. Nothing flaked across three runs of the file.

**Verdict: safe to merge AFTER the four named fixes below — MAJOR-1 through MAJOR-4.** No
BLOCKER. Nothing I could find makes rotation delete a real snapshot early, walk out of its
directory, or touch the store. The design's two load-bearing ideas — *the name is the
protection* and *no rotation after a failed copy* — hold up under everything I threw at them,
including a real SIGKILL mid-copy.

**Count: 0 BLOCKER · 4 MAJOR · 10 MINOR · 5 NIT.**

**A snapshot IS restorable — proved.** See MAJOR-4 for the caveat that matters.

---

## What I could not break

Stated plainly, because it is most of the review:

- **Rotation never left the directory.** A symlink inside the snapshots directory wearing a
  snapshot's name, pointing at a real tree outside it, was neither counted nor deleted
  (`readdirSync(..., {withFileTypes:true})` reports the entry's own type, so
  `entry.isDirectory()` is false for a link). Proved.
- **A file with a snapshot's name, and a name with a suffix** (`2026-01-01T00-00-00-000Z-my-notes`)
  are both invisible to rotation. The regex is anchored on both ends. Proved.
- **`keep` cannot ever mean "delete everything".** `keepOf()` returns 14 for `0`, `-1`,
  `-14`, `NaN`, `1.5` and `Infinity`; a huge `keep` (1e9) deletes nothing. Proved.
- **A backwards clock jump does not cost a snapshot.** With 14 copies present and a new one
  named `2020-…`, the new one sorts oldest, lands in the doomed set, and is skipped by the
  explicit `justTaken` guard — nothing is deleted, 15 remain. Proved.
- **A SIGKILL mid-copy leaves nothing that counts.** I spawned a child that built an 12,000-file
  synthetic store and snapshotted it, and killed it with signal 9 partway. The snapshots
  directory held exactly one entry, `.partial-2026-09-18T17-18-53-478Z-69433`, which does not
  match `SNAPSHOT_NAME_RE`. A later run with the clock advanced past `PARTIAL_STALE_MS` swept
  it (`cleaned: 1`) **and** took a real copy in the same pass. Proved.
- **It never threw.** A closed counterpart, and a snapshots path that is a *file* rather than
  a directory, both returned a report rather than an exception (the file case returned
  `reason: "failed"` with `ENOTDIR` in `errors`). Proved. The code path I expected to escape —
  `store.backupSet()` in `cli/snapshot.ts:133`, which sits *outside* that function's only
  `try` — does not throw in practice, and `runner.ts`'s own `try` in the `finally` would catch
  it if it ever did.
- **The database leg is `VACUUM INTO`, not a file copy** (`cli/snapshot.ts:143`,
  `vacuumInto()` at :180), so it is consistent under WAL when F1 (#137) lands. Nothing copies
  `-wal`/`-shm` raw: the loop iterates `LAYOUT`'s seven entries, and `operational.sqlite` is
  short-circuited to `vacuumInto` before `copyTree` is reachable. The `match: "prefix"` on that
  layout entry also means WAL's sidecar files stay *classified*, so `assertLayout()` will not
  start refusing the store when F1 lands. Read, not probed.
- **Two runs the same day.** The second is `already-today`. Forced to collide on an identical
  name, the rename fails `ENOTEMPTY`, the partial is removed, and the existing snapshot is
  untouched — no clobber, no nesting. Proved.
- **A mirror failure is not fatal**, and rotation of the primary runs *before* the mirror is
  attempted (`snapshots.ts:349-350`). Read.

---

## MAJOR

### MAJOR-1 — "THE GUARD" runs the live-store refusal on the *unresolved* path, then realpaths, and hands back a forbidden directory

`src/adapters/snapshots.ts:217`

```ts
const real = realpathDeep(assertSafeDataDir(dir));
```

`assertSafeDataDir` (`src/core/store/paths.ts:67`) is pure string math: it `resolve()`s and
compares against `~/.bansai` and `~/.claude-engram`. It does **not** follow symlinks. So the
order here is backwards: the one check that refuses v1's live memory is applied to the path as
written, and only *afterwards* is the path resolved through its links. Every other check in the
function (root, home, containment both ways) is correctly applied to `real`. This one is not.

The function's own docstring says the opposite — "both sides are resolved — and REALPATHED
where the directory already exists, because `resolve` does not follow symlinks" — and the module
header lists "is one of v1's live stores" among the refusals. For a symlink, it is not.

**Failure scenario.** `snapshots.dir` is set to a path that is a symlink whose
target is `~/.bansai` or a directory under it. `assertSafeDataDir` sees the link's own path
(harmless, not under a forbidden root) and passes. `realpathDeep` then resolves it to the
forbidden directory, root/home/containment all say no, and the function **returns the forbidden
directory as the rotatable one**. `runSnapshot` then calls `cleanPartials(dir, …)` on it
(`snapshots.ts:324`) before anything re-checks — which reads that directory and `rm -rf`s every
child directory named `.partial-*` older than 30 minutes.

**What saves it from being worse.** The copy itself is refused: `copyInto` → `snapshot()` →
`assertSafeTarget` re-runs `assertSafeDataDir` on the already-realpathed partial path, which is
now under the forbidden root, and throws inside `snapshot()`'s try. Rotation never runs, because
rotation only runs after a copy that succeeded. So today's realised blast radius is: a read of
`~/.bansai`, plus deletion of stale `.partial-*` directories inside it. `~/.bansai` has no reason
to contain one.

**The `mirror` leg is NOT exposed, and that is to the builder's credit.** `mirrorTo` (`:477-481`)
runs `assertRotatableDir`, then `assertSafeTarget(store.dir, join(target, name))` — which re-runs
`assertSafeDataDir` on the *already realpathed* target — and only then `cleanPartials`. A mirror
pointed through such a symlink throws before the sweep. The primary path is the one that sweeps
first and checks second.

**Status: PROVED BY PARTS, not end to end.** I could not run the whole chain, and I did not try:
`os.homedir()` under bun **ignores `process.env.HOME`** (measured — setting it to a temp path
still returns `/Users/mlapeter`), so the forbidden roots cannot be relocated into a temp tree,
and the only way to run the real case would be to point the code at the owner's actual
`~/.bansai`. By rule, I did not. The three parts, each proved hermetically:

```
part A  assertSafeDataDir(join(homedir(), ".bansai", "snapshots"))  → THROWS   (pure string math,
        assertSafeDataDir("<$TMPDIR>/…/linked")                     → returns   no fs access)
part B  assertRotatableDir(store, "<$TMPDIR>/…/linked")             → returns realpath(target)
        ⇒ the refusal in part A ran on the LINK's name, and the return value is the TARGET
part C  runSnapshot with config.dir = that link, a `.partial-whatever-1` in the target aged
        past PARTIAL_STALE_MS  →  the .partial directory is DELETED inside the target
```

**Smallest fix.** Swap the order — one line:

```ts
const real = assertSafeDataDir(realpathDeep(dir));
```

`realpathDeep` already handles a path that does not exist, so nothing else changes. Worth adding
the symlink case to the existing test at `test/snapshots.test.ts:206` if a way is found to
relocate `homedir()`; if not, say in a comment that it is unprovable under bun.

### MAJOR-2 — a one-character typo in an optional backup setting stops memory from capturing at all, silently

`src/adapters/claude-code/config.ts:404`

```ts
if (typeof keep !== "number" || !Number.isInteger(keep) || keep <= 0) unreadable = true;
```

**Confirmed, exactly as the builder described it, and worse than the PR body implies.** Proved:
`loadConfig({ dataDir, snapshots: { keep: X } })` for X ∈ `0, -1, 1.5, "14", null` returns

```json
{"config":{"observer":true},"ok":false,"reason":"unreadable"}
```

— note `dataDir` is *gone*. `bin/hook.ts:435-439` then writes one line to stderr and `return`s
without doing anything; `runner.ts:439-441` does the same. The owner's hooks run with stderr
going nowhere (I32), and the hook JSON that would show a `systemMessage` in his terminal is
never emitted on that path.

**What the owner would experience.** He adds `"snapshots": { "keep": 0 }` — or writes `"14"`
with quotes, which is the likelier typo — to `~/.counterparts/claude-code.json`. From the next
session on, nothing is captured, nothing is recalled, no snapshot is taken and no row is written.
Memory just stops. The only reliable tell is running `counterparts doctor` and reading the config
line.

**Which warning he gets depends on how his hook names the config, and I did not determine which
he is on.** `namedUnreadableRefusal` (`src/adapters/config-path.ts:213-225`) fires **only** for a
config named by `--config` or `COUNTERPARTS_CONFIG`. On that path `bin/hook.ts:435-439` writes one
line to stderr — which goes nowhere from a hook (I32) — and returns before any JSON is produced,
so the `systemMessage` channel added for exactly this class of problem (`bin/hook.ts:530-568`) is
never reached. On the *default*-path case the hook does not return: it continues in observer
stance, and `adapter.notice()` at SessionStart is red-only, so a red config finding may surface a
`systemMessage`; I did not confirm that it does. Worth five minutes of the builder's time to check
which path the owner's installed hook command uses, because on the named one there is no message
at all.

**Two layers disagree about the same input.** `snapshots.ts:507` already defends `keep`
completely — `keepOf()` turns every one of those values into 14, and I proved it. So the config
layer's refusal is a second, harsher answer to a question the code has already answered safely.
`keepOf`'s `undefined` branch stays live and necessary (absent block, doctor); it is only its
*invalid-value* branch that config makes unreachable — and that branch is the safe one.

The `dataDir` precedent the builder cites is about a **path this package writes into** — guessing
there is genuinely dangerous. `keep` is a count with a safe default sitting in the same PR.

**Smallest fix.** Drop `keep` from the `unreadable` set: parse it when it is a positive integer,
ignore it otherwise, and let `keepOf` own the fallback (that is what it is for). If the strictness
is kept on purpose, then `bin/hook.ts` must surface it as a hook `systemMessage`, not a stderr
line — a silent stand-down on a backup typo is the failure this project keeps writing scars about.

### MAJOR-3 — doctor's `Snapshot` line never looks at the disk, so it reads green with zero copies present

`src/adapters/claude-code/doctor.ts:1310-1393` (`snapshotFindings`)

The whole finding is computed from the newest `snapshot.taken` **row**: `kept`, `oldest`, `date`,
`files` all come out of `payloadOf(row)`. `resolveSnapshotsDir` is called only to decide whether
a default location exists; the directory is never listed. The docstring above it says this is
"the one line that answers *if this database were wiped this afternoon, what would come back*".
It answers a different question: *what did the last run say it had written*.

**Failure scenario, PROVED.** A store with one real snapshot taken, then the snapshots directory
deleted from disk (a person tidying up, a sync tool, a failed disk, a `rm -rf` of the wrong
sibling):

```
WITH copies present:        green | Snapshot | last snapshot 2026-09-18, 1 kept, oldest 2026-09-18
AFTER deleting every copy:  green | Snapshot | last snapshot 2026-09-18, 1 kept, oldest 2026-09-18
one day later:              green | Snapshot | last snapshot 2026-09-18, 1 kept, oldest 2026-09-18
two days later:             amber | Snapshot | last snapshot 2026-09-18, 1 kept, oldest 2026-09-18 — 2 days ago or more
```

The line says "1 kept" when nothing is kept, and stays *green* for a full day. After two days it
goes amber for the wrong reason (staleness), still claiming a copy exists. On the live store this
reads "14 kept, oldest 2026-09-01" over an empty directory.

**Smallest fix.** Doctor already imports from `snapshots.ts`. Add `snapshotNamesIn` to that import
and reconcile: `const onDisk = snapshotNamesIn(resolved.dir)`; report `onDisk.length` as the kept
count, and go amber with "the row says N, the directory holds M" when they disagree — amber and
loud when `onDisk.length === 0` and a `snapshot.taken` row exists. This is the mechanism-is-seen-
firing rule (constitution 11) applied to the mechanism it matters most for.

### MAJOR-4 — a restored snapshot cannot be searched, and no restore procedure is written down anywhere

**A snapshot IS restorable at the data level — PROVED.** Copy `~/.counterparts/snapshots/<iso>/`
to a fresh `…/store` and `Counterpart.open` it: the store opens, `list()` finds the memory,
`read(id)` returns the doc with its title and body, `readProse(id)` returns the prose. The copy
contains `operational.sqlite`, `prose/`, `versions/` and (on a store that has them) `spans/`, and
correctly does **not** contain `cache/`. Good.

**But `search()` returns `[]` on it.** Proved:

```
ORIGINAL search("lemon tree")  → [{"id":"mem_…","score":2.67}]
RESTORED search("lemon tree")  → []
RESTORED rebuildCache()        → {"indexed":1,"unrecomputed":1,"keptVectors":0,"droppedVectors":0,
                                  "declared":[{"what":"embeddings","repair":"Store.open({embed}) then rebuildCache()"}]}
RESTORED search("lemon tree")  → [{"id":"mem_…","score":1.33}]
```

The lexical index and every vector live in `cache/`, which is deliberately excluded. The store's
own contract calls that loss "a re-index", and `counterparts verify --rebuild` is the re-index —
so the machinery exists. What does not exist is anybody being told. This PR adds a backup, a
doctor line, two fired rows, three event names and a CONTRACT clause, and **none of them contains
the sentence "here is how you get your memory back"**. A person restoring on the worst day of the
year opens the copy, asks it something, gets nothing, and concludes the backup is empty.

Note also that `rebuildCache()` without an embedder **drops every vector** (`keptVectors: 0`) — so
the naive repair silently costs semantic recall until the worker's backfill refills it over days.

**Smallest fix.** Four or five lines: a "how to restore" paragraph in CONTRACT §5 G24 — copy the
directory, open it, run `counterparts verify --rebuild --dir <it>` with an embed key in the
environment — and the same sentence as the `remedy` on doctor's Snapshot finding. No code change.

---

## MINOR

### MINOR-1 — three watchdog aborts burn the day's whole copy budget, though no copy was ever attempted

`snapshots.ts:335` writes the abort row as `{ date, step: "copy", reason: "aborted" }`, and
`failedAttemptsToday` (`:657`) counts any row whose `step` is `"copy"` or `"rename"`. The comment
three lines above says "Only a failed COPY counts against the cap."

**Proved:** three runs with an already-aborted signal, then a fourth healthy run with no signal at
all → `attempts-exhausted`, no copy, empty snapshots directory. On a day with three boundaries
where the sleep cycle overran the 5-minute watchdog, the store gets no backup even though nothing
ever tried to copy it.

**Smallest fix:** `step: "aborted"` (and leave the counter alone). One word.

### MINOR-2 — the fail-closed retry read can stop backups permanently and silently

`snapshots.ts:635-647`. If `eventLog` comes back with 1000 rows, the function returns
`MAX_ATTEMPTS_PER_DAY` — "exhausted" — and `attempts-exhausted` deliberately writes **no row**.
Once the `snapshot.failed` count inside the `livedDay - 2` window reaches 1000, backups stop for
good, and the only trace is doctor's Snapshot line saying nothing has been taken.

With the clock healthy, the window holds at most ~4 rows/day and this is unreachable. Under the
frozen lived-day clock this project has already lived through (I32) every row sits in one `day`,
the filter stops filtering, and 1000 rows is a couple of years of failures. The builder names
exactly this scenario in the comment and chooses fail-closed on the grounds that "the thing being
refused is a retry rather than a backup" — but at this limit what is refused is every backup,
forever. Unproved (I did not manufacture 1000 rows); read from the code.

**Smallest fix:** when the read saturates, write one `snapshot.failed` row with
`reason: "attempt-window-unreadable"` so the silence is evidenced — or read with `ORDER BY seq
DESC` if the store offers it.

### MINOR-3 — a relative `snapshots.dir` resolves against the worker's current directory

`resolveSnapshotsDir` (`:193`) does `resolve(configured)` with no absoluteness check. Proved:
`resolveSnapshotsDir(dir, "snaps")` returned `<the repo worktree>/snaps`. The worker is spawned
from whatever directory the host session is in, so copies would scatter across projects, each
location holding exactly one, and rotation would run inside whichever directory the shell
happened to be in. **Fix:** refuse a non-absolute `dir`/`mirror` in `config.ts` with a named reason.

### MINOR-4 — `"dir": ""` silently means "use the default"

`:192` treats an empty or whitespace string as absent, and `loadConfig` accepts it
(`{"dir":""}` parses `ok: true`). A person who blanked the value to disable snapshots gets the
default location instead. **Fix:** refuse an empty string in `config.ts`, or document that blank
means default.

### MINOR-5 — one future-dated directory permanently costs one real snapshot per rotation

Proved: a `2099-01-01T00-00-00-000Z` directory plus 14 real copies, `keep: 14` → rotation deletes
`2026-09-01T12-00-00-000Z`. The future-dated name sorts newest and is kept forever, so the owner
silently keeps 13 days of real history instead of 14 — and the `oldest` reported on the row is the
wrong one. One clock-skewed boundary (a laptop waking with a bad RTC) is enough to plant it
permanently. **Fix:** skip candidates whose name parses to a time in the future by more than a
day, or report them in the `snapshot.rotated` row so somebody sees it.

### MINOR-6 — `runSnapshot` has no observer check of its own

The runner refuses under observer before it opens a store, so today nothing reaches this. But
called directly with an observer counterpart, `runSnapshot` **writes a full copy of the store to
disk** and creates the snapshots directory. Proved:

```
observer runSnapshot: taken 2026-09-18T12-00-00-000Z files: 2
snapshots dir: [ "2026-09-18T12-00-00-000Z" ]
rows written: 0
```

The row is correctly refused by `noteAdapterEvent`; the 67 MB of disk is not. An instrument that
leaves a directory behind is the thing §15 G3 is about. **Fix:** three lines at the top of
`runSnapshot` — if the counterpart is an observer, return a report with a new reason and write
nothing.

### MINOR-7 — the only proof a directory is a snapshot is its name

Proved: a directory the *user* created called exactly `2026-01-01T00-00-00-000Z`, holding a file
called `my-notes.md`, is `rm -rf`ed by rotation. Likewise `cleanPartials` deletes any directory
whose name starts with `.partial-` once it is 30 minutes old, including
`.partial-my-own-thing` (proved).

In the default layout this is a directory the package created and owns, so the exposure is nil.
It becomes real the moment somebody points `snapshots.dir` or `mirror` at an existing directory
of their own — e.g. a backups folder on an external drive shared with another tool.
**Fix, cheap and worth it:** require the candidate to contain `operational.sqlite` before it is a
rotation candidate. Two lines in `snapshotNamesIn`, and it makes the delete rule "a directory
this package wrote" rather than "a directory whose name looks like one".

### MINOR-8 — the disk cost is never reported, and the mirror doubles it

14 copies × the store size, per location. On the owner's 67 MB store that is about **940 MB**, and
about **1.9 GB** with a mirror configured — growing with the store, forever, with no byte figure
in doctor, no row carrying total size, and no cap other than a count. **Fix:** put the total bytes
in the snapshot's directory on the doctor line, next to the count.

On the disk question the brief asked: a *persistently failing* copy does **not** fill the disk.
Each failed attempt removes its own partial (`copyInto:431` and `:444`), and there are at most
three attempts a day. The only accumulation path is hard kills, which leave a partial per kill for
up to 30 minutes — bounded by boundaries-per-half-hour, and very unlikely given a 2.3 s copy.
On ENOSPC the behaviour is the permission case I proved: `reason: "failed"`, the partial removed
(or an error recorded saying it could not be), a `snapshot.failed` row, no rotation, no throw,
worker carries on.

### MINOR-9 — the finished snapshot is never verified before it counts as one

Nothing between `snapshot()` returning `ok: true` and `renameSync` looks at what was written.
`report.ok` means only that no entry reported an error — it does not mean the copy has files in
it. `copyTree` returns 0 files for a source that does not exist and reports `ok: true`
(`cli/snapshot.ts:88`), and `vacuumInto` is the only leg that would notice an empty database.
So a snapshot that is structurally empty still gets the name, still counts toward `keep`, still
satisfies "today's exists", and still pushes a real one out on day 15.

I did not manufacture this — it needs a filesystem misbehaving in a way that returns success —
so: suspected, not proved. But the fix is three lines before the rename and this is the one
directory the owner would be relying on: assert `files > 0` and that
`<partial>/operational.sqlite` exists and is non-empty, and treat a failure as a failed copy
(which, correctly, rotates nothing).

### MINOR-10 — a second connection now opens on the canonical database at every boundary

`vacuumInto` calls `openDb(source)` on `operational.sqlite` while the worker's own connection is
open, once per day, inside the `finally` before `close()`. Under today's `journal_mode=DELETE`
this is a new `SQLITE_BUSY` surface at exactly the moment I38 ("database is locked after a Stop")
is about — and with the 3-attempts-a-day cap, three busy boundaries is the whole day's budget
gone. The existing `test/cli.test.ts` case holds an open write transaction across the copy and
passes, so the common case is fine. Not a defect in this PR; a reason to land F1 (#137, WAL +
busy timeout) **before or with** this one, and to re-measure after.

---

## NIT

- **N-1.** The PR says "only the parent's kill can end an overrun". Nothing kills the worker.
  `spawn.ts` spawns `detached: true` and never calls `.kill()`; the worker's own watchdog
  (`runner.ts:456-461`) only `abort()`s a signal, on an `unref`'d timer. An overrunning copy runs
  to completion. The `.partial-` protection is still right — machine sleep, shutdown, a user
  `kill -9` — but the stated mechanism is not there, and the CONTRACT text inherits the claim.
- **N-2.** `today` is computed at the top of `runOnce` (`:201`) and `snapshotName(Date.now())` at
  the end, so a boundary that straddles UTC midnight files its copy under tomorrow's name while
  the row says today's date — and yesterday ends with no copy. Harmless, once a run in a thousand.
- **N-3.** `test/snapshots.test.ts:202` calls `assertRotatableDir(dir, homedir())`, which
  `realpathSync`es the owner's *real* home directory. Read-only, so it is not a hermeticity
  breach — but it is worth a comment. What I measured is narrower than "bun ignores `$HOME`":
  under bun, **mutating `process.env.HOME` at runtime does not move `os.homedir()`** (it still
  returned `/Users/mlapeter`). Setting `HOME` at process *spawn* time is untested — the harness
  refused that command and I did not work around it — and a spawned child with `HOME` set at
  startup is the likely route if the builder wants a hermetic regression test for MAJOR-1. As it
  stands, that is why MAJOR-1 is proved by parts rather than end to end.
- **N-4.** I checked for stray writes: after the full suite, `git status --porcelain` in the
  worktree is empty and neither `$TMPDIR/snapshots` nor `/tmp/snapshots` exists. The hermetic
  claim holds — every test's `dataDir` is its own `mkdtemp` root with the store one level down,
  so the default resolves inside that root.
- **N-5.** **Collision risk with PR #138** (`self/s1-page`), which touches all six of the same
  registry files: `core/counterpart.ts` (`AdapterDurableEventName`), `dashboard/registries.ts`
  (`DurableEventName` + `DURABLE_EVENTS`), `web/narrate.ts` (`NARRATORS` + `REF_KIND`),
  `web/flow.ts` (`EVENT_NODE`), `fired.ts` (`MECHANISMS`) and `doctor.ts`. Both PRs append
  entries near the same lines. Textual conflicts are likely and mechanical; the
  `satisfies Record<DurableEventName, …>` totality means a half-merged one fails `tsc` rather
  than shipping a hole, which is the right direction. Merge one, rebase the other, re-run
  typecheck. #137 (F1/WAL) touches none of these — see MINOR-10 for the ordering argument.

---

## The specific questions in the brief, answered

| Asked | Answer |
|---|---|
| Rotation deleting a non-snapshot | Only a directory *directly inside* the resolved dir whose name exactly matches the pattern. Symlinks, files, suffixed names all skipped — proved. A user directory with a matching name IS deleted (MINOR-7). |
| Snapshots dir = store / parent / contains store / root / home | All refused (`assertRotatableDir`). Root and home refusals read from code, not run — proving them would mean pointing the code at `/` or the real `~`. `/Users` and `/private` fall to "contains the store", which is correct. |
| `..`, relative, empty string | `..` normalised (fine). Relative → CWD (MINOR-3). Empty → default (MINOR-4). |
| Symlink swapped between check and delete (TOCTOU) | Not probed. Single-user local machine, and the window is microseconds inside one synchronous pass. Low, unproved. |
| Future-dated / odd-sorting name | MINOR-5 — costs one real snapshot per rotation, permanently. |
| Clock jumps backwards | Safe: the copy just taken is protected explicitly, nothing is deleted that pass. Proved. |
| What "never deletes the copy just taken" rests on | Two things: it is newest by name, *and* an explicit `if (name === justTaken) continue`. Belt and braces, correctly. |
| A second `$TMPDIR` realpath bug | Yes — MAJOR-1, though it is an ordering bug rather than a missing realpath. |
| `keep` 0 / negative / NaN / 1.5 / string / huge | Can never delete everything (proved). But an invalid value takes the whole adapter to observer — MAJOR-2, and the owner's experience is "memory stopped, nothing on screen". |
| Half-copy: killed mid-copy | Proved with a real SIGKILL. Not counted, does not satisfy today, not a rotation candidate, swept after 30 min, and the sweep only removes `.partial-` names (which does include a user's own — MINOR-7). |
| Can a partial be renamed in incomplete? | No. `snapshot()` returns `ok: false` if *any* entry errored, and the rename is skipped. |
| Is the finished snapshot verified? | **No** — MINOR-9. Nothing opens it, counts its files or checks its size. `report.ok` only means nothing threw. |
| Disk / ENOSPC / cost | See MINOR-8. Partials are cleaned on failure; the cap holds it to 3/day; ~940 MB steady state, ~1.9 GB with a mirror, unreported. |
| Mirror affecting primary or rotation | It cannot: the primary's rotation runs first, the mirror is wrapped entirely in `try`, and a failure only sets `mirror.ok = false` plus a `mirrorWhy` on the row. |
| Never throws / worker safety | Held under every probe. `runner.ts` also wraps it. `close()` is delayed by the copy (~2.3 s once a day) but never prevented. |
| Observer writes nothing | True *via the runner* (it refuses before opening a store). Not true of `runSnapshot` itself — MINOR-6. |
| Watchdog kill leaves the store unharmed | Yes: the store is only read, and the database leg is `VACUUM INTO` on its own connection. Nothing writes to the store. |
| Two workers, no lock | Outcomes are safe-direction, proved: distinct partial names (pid), `already-today` catches the second, a forced name collision fails `ENOTEMPTY` rather than clobbering or nesting, and neither rotation nor the sweep can touch the other's fresh partial. |
| Default-directory rule | Correct, and yes — a user with a differently-named `dataDir` gets **no backups at all**, with one **amber** doctor line and a remedy naming the config key. That is visible enough *if he runs doctor*. Nothing else tells him. |
| WAL / `VACUUM INTO` / raw `-wal` copy | Correct on all three (see "What I could not break"). |
| Restorable? | **Yes, proved** — but not searchable until `verify --rebuild`, and nobody is told. MAJOR-4. |
| Doctor line, fired entries, dashboard, three core constants | Doctor line has MAJOR-3. The rest read correctly; the `backup` mechanism's relabel to "BY HAND, from the console" is right, and splitting `snapshot-trouble` from `snapshot` is the correct call for the reason given. Collision risk with #138 — N-5. |

---

## The four fixes the verdict depends on

1. **MAJOR-1** — one-line swap: `assertSafeDataDir(realpathDeep(dir))`.
2. **MAJOR-2** — stop `keep` from taking the whole configuration to observer; `keepOf` already
   handles it safely.
3. **MAJOR-3** — make the doctor line count what is on disk, not what a row remembers.
4. **MAJOR-4** — write down how to restore, in CONTRACT §5 G24 and as the doctor line's remedy.
   A paragraph of prose, no code. I would not deploy a backup to the live store without it.

Everything under MINOR is worth doing and none of it blocks. If one MINOR were promoted it would
be MINOR-9 (three lines: check the copy is non-empty before the rename makes it a snapshot).

# Adversarial review — N1, `counterparts start-fresh` (PR #150)

Branch `origin/newuser/n1-start-fresh` @ `2bc1a25`, reviewed against the merge-base with
`origin/master`. Read-only: nothing here was fixed, committed, pushed or deployed.

Everything under **I ran this** was executed in a scratch lab under `$TMPDIR`, with `HOME`
pointed at a fake home inside it, a curated `env -i`, a stub `claude` on `PATH`, and real
old-floor stores built by `git archive floor/v5-last` + that build's own `Store` API
(4 KB `operational.sqlite`, 535 KB uncheckpointed `-wal`). No live store, checkout or
config was read or written.

---

## Verdict

**MERGE AFTER FIXES.**

The one rule holds. I could not make the command delete anything, and I could not make it
open the store it parks. Structurally, `renameSync` is the only mutating call in
`start-fresh.ts`; behaviourally, a real v5 store came through `--dry-run`, a real run, a
refused run, an interrupted run and a full printed rollback **byte-identical**, `-wal` and
`-shm` and mtimes included, and `floor/v5-last` still read every row out of it afterwards.
The refusal set is genuinely good: `.bansai`/`.claude-engram` by name and by realpath,
symlinks, home, `/`, the config's own directory, cross-device, `--dir`, no-TTY.

What stops it being "as is" is a ring of paths **around** the rename where the command
writes to, or creates, a store nobody named — and a rollback block that is printed from a
plan that is not always the plan that ran.

One BLOCKER, five MAJOR, five MINOR, three NIT.

---

## BLOCKER

### B1. A one-character `--config` typo makes `start-fresh` open and WRITE TO the live store, and stamp it "began today"

`startFreshCommand` treats an absent configuration as "a machine with nothing on it", so
`plan.storeDir` is `""` — and then the pin at `commands.ts:2323` is skipped:

```ts
if (final.storeDir.length > 0) installFlags["dir"] = final.storeDir;
```

`installLayout` therefore falls back to `$COUNTERPARTS_DATA_DIR`, else `~/.counterparts/store`
— the live store — and after `install` returns OK the command opens it and writes
`store.started`, `store.started.by` into it. The comment above that line ("THE PATH IS
PINNED, ALWAYS … so a shell with a decoy in it would have created the blank store somewhere
else") is false in exactly the case it is about.

**I ran this** (lab home `w2`, a real new-floor store with memories at the default path):

```
$ counterparts start-fresh --config <home>/.counterparts/claude-code.jsonn --yes
Configuration: <home>/.counterparts/claude-code.jsonn (not there yet)
Store:

Nothing to park: there is no store at that path (or it is empty).
So this is an ordinary first install, and it says so rather than pretending
it moved something.
...
Store already present at <home>/.counterparts/store.          <-- his live store
  created <home>/.counterparts/claude-code.jsonn
```

`status` before: `Memories: 2  Beliefs and entities: 1`.
`status` after: `This store began on 2026-09-20.` — on a store that did not.

Two sentences on one screen contradict each other: `Store:` is blank and "there is no store
at that path", directly above "Store already present at …/store".

**I ran this** (lab home `w3`, same typo, with `COUNTERPARTS_DATA_DIR` exported — which
QUICKSTART §3 teaches):

```
Store:
Nothing to park: there is no store at that path (or it is empty).
Created a store at <lab>/decoy-store.
Done. What is left is yours to do:
  decoy dir now holds: cache counterparts.sqlite counterparts.sqlite-shm counterparts.sqlite-wal
```

Nothing is deleted and nothing is renamed, so no memory is lost. But this is the I29/#80
class — a store nobody named, written to — pointed at the owner's real memory, one
mistyped character away, on the day he is most likely to be typing long paths. And
`store.started` is not unsettable from the console: the falsified "began on" line is
permanent on that surface.

**Smallest fix.** When `configPresent` is false, compute
`installLayout(undefined, env, home_, custom).store` **up front**, print it as the `Store:`
line instead of leaving it blank, pin `installFlags["dir"]` to it, and refuse if `sight()`
shows anything there — a machine with nothing on it has no store where `install` would land.
That closes both variants (the default store and the `$COUNTERPARTS_DATA_DIR` decoy) in one
place and leaves the genuinely-cold arm working, so it does not fight the PR's own test at
`test/start-fresh.test.ts:587` — under `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` that test can only
name its config with `--config <path that is not there>`, which is the same arm. (A blanket
"refuse a named config that is absent" would break it; this does not.)

Worth doing beside it: write the `store.started` record only when this run actually created
the store. `install` already computes `existed`; thread it out, or check `storeExists` before
the install, and skip the meta write when the store was already there.

---

## MAJOR

### M1. `install` can refuse AFTER both directories are parked, leaving the config pointing at nothing

`start-fresh` pre-flights the forbidden roots, the symlinks, the layout and the filesystem —
but not `install`'s own refusals. The reachable one is the ceiling passthrough:
`installFlags["budget"] = String(host.config.injectionBudgetBytes)`, while `installCommand`
validates with `Number.isInteger(n) && n > 0`. `loadConfig`'s `num()` accepts any finite
positive number, so a **fractional** `injectionBudgetBytes` loads fine everywhere else and
blows up here — after the renames.

**I ran this** (lab home `h2`, `"injectionBudgetBytes": 8192.5`):

```
  parked snapshots: …/snapshots -> …/snapshots.parked-2026-09-20
  parked store:     …/store     -> …/store.parked-2026-09-20

Creating the blank store. This is 'counterparts install', run for you:

refused: --budget takes a positive whole number of bytes, not '8192.5'.

The install did not complete. Your memory is parked at …/store.parked-2026-09-20 and is
untouched; the rollback lines printed earlier are the way back.
```

Layout afterwards: `claude-code.json credentials.env scopes.json snapshots.parked-… store.parked-…`
— no store at `dataDir`. `doctor` goes RED ("no store at …"), `status` says "No store at …",
neither mints anything. The recovery sentence is good. But this is an avoidable landing in
the one window the whole design is built to keep two syscalls wide, and it is the window
M3/M4 below turn dangerous.

**Smallest fix:** validate the ceiling before the first rename — if
`!Number.isInteger(ceiling)`, either drop the passthrough for this run or refuse with
"Nothing has changed." (Round it, or just omit `--budget`; the file is kept either way.)

### M2. The rollback block is printed from the FIRST plan and can name paths the SECOND plan did not use

`rollbackLines(plan)` is printed at `commands.ts:2213` from the pre-confirmation plan;
`park(final.parks)` at 2298 runs the re-read one. The re-read is the right design — but
nothing re-prints the way back, and `commands.ts:2307` then asserts "the rollback lines
printed earlier still name the way back."

**I ran this** (lab home `h3`, via `expect` at the real interactive prompt; while the command
waited, another actor took the parked name):

```
  mv …/store.parked-2026-09-20 …/store          <-- what is on his screen
Type the parked name to go ahead [store.parked-2026-09-20]: store.parked-2026-09-20
  parked store: …/store -> …/store.parked-2026-09-20-2   <-- what actually happened
```

Running the printed line 2 verbatim restores the *decoy*, and his memory sits at `-2` with
the "way back" block silently wrong. (The "3. Your previous memory is at" line does name
`-2` correctly — that is the only thing that saves it.)

The likelier trigger is the **UTC day boundary**, because the command explicitly sends the
owner to another terminal to run `pgrep` while it waits. **I ran this** at the module level
(`planStartFresh` + `rollbackLines` at 23:58Z and 00:04Z on the same lab home):

```
PRINTED plan date:   2026-09-20
  mv …/store …/store.blank-2026-09-20
  mv …/store.parked-2026-09-20 …/store
  mv …/snapshots.parked-2026-09-20 …/snapshots

EXECUTED plan date:  2026-09-21
  …/snapshots -> …/snapshots.parked-2026-09-21
  …/store     -> …/store.parked-2026-09-21
```

All three printed lines name paths that do not exist; line 1 succeeds (parking the blank
store under yesterday's date) and lines 2 and 3 fail.

`confirmationWord(plan)` comes from the first plan too, so across that same midnight he is
asked to type `store.parked-2026-09-20`, types it, and the rename goes to
`store.parked-2026-09-21`. The confirmation is a check that he read the screen, not a check
against the plan that runs — worth knowing when judging how much work it is doing.

**Smallest fix:** after the renames (and in the failure branch at 2302), re-print
`rollbackLines(final)` under a heading like "The way back, as it actually stands:". Cheap,
and it makes the failure sentence true.

### M3. The printed rollback MERGES when the destination exists — `mv` moves a directory INTO an existing one

Item 2 of the brief asks that rollback refuse rather than merge. Plain `mv` does neither
refusing nor overwriting: it nests, silently, exit 0.

**I ran this** (macOS BSD `mv`, and `mv -n` behaves identically):

```
$ mkdir -p src dst && touch src/MEMORY dst/BLANK && mv src dst; echo $?
0
dst/BLANK
dst/src/MEMORY
```

And on the real layout (lab home `h2`, after M1 left it parked, then a hook re-minted a
store at `dataDir` — see M4), running only the rollback's line 2:

```
$ mv …/store.parked-2026-09-20 …/store
$ ls …/.counterparts/store
cache  counterparts.sqlite  counterparts.sqlite-shm  counterparts.sqlite-wal  sessions
store.parked-2026-09-20                                  <-- his memory, nested inside

$ counterparts status --dir …/store
could not open the store: LAYOUT_UNCLASSIFIED {"name":"store.parked-2026-09-20"}
```

Nothing is deleted and everything is recoverable, but the parked store ends up *inside* the
live one and the store stops opening. Skipping line 1 is the natural reading precisely when
M1 fired ("the install did not complete" — so there seems to be no blank store to park).

**Smallest fix:** print each rollback line guarded, e.g.
`[ -e <dst> ] || mv <src> <dst>` — or `mv -h`-style explicitness — plus one sentence:
"run them in order; if a destination already exists, stop and look, `mv` would put the
source inside it."

### M4. A hook MINTS a store at `dataDir` in the post-park window — and the next run then records the wrong "previous"

The brief asks whether the hook or the worker can mint a store at the configured path
between the rename and the install. It can.

**I ran this** (lab home `h2`, in the M1 state — parked, no blank store — firing the PR
build's real `hook.ts` with a stub SessionStart payload and no explicit-dir guard, i.e. the
real host's environment):

```
$ ls …/.counterparts        # before
claude-code.json credentials.env scopes.json snapshots.parked-… store.parked-…
$ <hook.ts SessionStart>    # exit 0, ordinary wake output
$ ls …/.counterparts        # after
claude-code.json credentials.env scopes.json snapshots.parked-… store store.parked-…
$ ls …/.counterparts/store
cache  counterparts.sqlite  counterparts.sqlite-shm  counterparts.sqlite-wal  sessions
```

That is the collision M3 needs. It also poisons the record: the next `start-fresh` parks the
minted (or half-made) store as `store.parked-<date>-2` and writes *that* into
`store.previous.parked`.

**I ran this** (lab home `v4`, a half-made blank store holding only `cache/`):

```
  parked store: …/store -> …/store.parked-2026-09-20-2
$ counterparts status --dir …/store
This store began on 2026-09-20; the previous one is parked at …/store.parked-2026-09-20-2, untouched.
```

The real memory is at `store.parked-2026-09-20`; the one line that says where his memory
went names an empty shell.

**Smallest fix:** in the resume/park arms, when more than one parked sibling exists, record
(and print) the **largest** one, or all of them — `siblingsParked` already collects them and
`final.alreadyParked.at(-1)` is currently the newest *name*, not the one with memories in
it. Simplest honest version: when `alreadyParked.length > 1`, print all of them and set
`store.previous.parked` to none rather than to a guess.

### M5. A non-absolute `dataDir` is resolved against the process working directory

`planStartFresh` does `resolve(input.dataDir.trim())`. `resolve` is cwd-relative and does not
expand `~`, and `loadConfig` accepts any string.

**I ran this** (lab home `r8`, `"dataDir": "relative-store"`, run from `<lab>/cwdA`):

```
  parked store: <lab>/cwdA/relative-store -> <lab>/cwdA/relative-store.parked-2026-09-20
Done.
  cwdA now: relative-store relative-store.parked-2026-09-20
```

It renamed an unrelated directory that happened to sit in the working directory, and
reported success. **I ran this** (lab home `r9`, `"dataDir": "~/.counterparts/store"`): it
printed "Nothing to park", created a literal `~/` directory in the working directory with a
blank store inside it, and said `Done.` — while the real store sat untouched and unmentioned.
(I removed that `~/` afterwards; `git status` is clean.)

**Smallest fix:** refuse a `dataDir` that is not absolute, by name, in `planStartFresh` —
one `isAbsolute()` check, with the sentence "`install` always writes an absolute path; a
relative one means something different to every process that reads it."

---

## MINOR

### m1. `pgrep -fl counterparts` — the advice is right, the sentence around it is false on his machine

The command prints: "THE ONLY LINE SHOULD BE THIS COMMAND ITSELF, sitting here waiting for
you. Anything else is a hook, a worker, an MCP server or a dashboard still running."

**I ran this** on the real machine (a process listing only — no store was read):

```
22292 bun run /Users/mlapeter/counterparts/src/adapters/mcp/bin/serve.ts --owner
24806 bun run /Users/mlapeter/counterparts/src/adapters/mcp/bin/serve.ts --owner
79472 bun run /Users/mlapeter/counterparts/src/adapters/mcp/bin/serve.ts --owner
57365 bun run src/adapters/dashboard/bin/dashboard.ts serve --dir /Users/mlapeter/.counterparts/store --port 4747
98153 bun run src/adapters/dashboard/bin/dashboard.ts serve --dir /Users/mlapeter/.counterparts/store --port 4767
49260 tail -n 0 -f /Users/mlapeter/counterparts-replay-runs/opus5-as-shipped-2026-08-26/run.log
56369 node /Users/mlapeter/counterparts-site-wt/node_modules/.bin/next dev -p 3111
```

`pgrep -f` matches the whole argv, so the last two are unrelated processes that merely have
the string in a path. A check that cries wolf on a `tail` and a `next dev` is one he will
learn to wave through — on the day the three MCP servers and **two dashboards holding
`/Users/mlapeter/.counterparts/store` open** are the thing that matters. Suggest: "ignore
lines that are not `serve.ts`, `hook.ts`, `runner.ts` or `dashboard.ts`", and name the
dashboards explicitly.

### m2. A symlinked `~/.counterparts/snapshots` refuses the WHOLE command

Lab home `s6`: `snapshots` as a symlink to a real directory → `refused: the snapshots
directory … is a SYMBOLIC LINK`, nothing parked. Symlinking a backup folder to an external
disk is an ordinary thing to have done, and there is no way through except editing the
config to add `snapshots.dir`. Consider treating a symlinked `snapshots` the way a configured
`snapshots.dir` is treated — left alone, said out loud — rather than blocking the store move.

### m3. Deploying before `start-fresh` leaves a stand-down mark inside the old store

**I ran this** (lab home `h5`): the PR build's SessionStart hook against a real v5 store
stands down correctly — `hook stood down: STORE_PRE_ROWS`, clear `systemMessage`, exit 0, no
database opened, every sqlite/`-wal`/`-shm` hash unchanged — but it writes
`<store>/sessions/<id>.standdown.json`, creating a `sessions/` directory the v5 store did not
have. `floor/v5-last` still opens that store and reads all four rows plus all 40 meta keys,
so it costs nothing. Worth one line in the cut-over notes so nobody reads the extra directory
as damage. It also does **not** falsely trip the liveness refusal: the mark is
`{"sessionId":…,"at":…,"event":"session-start","code":"STORE_PRE_ROWS","told":true,…}` with no
`lastBoundaryAt`, so `readLiveness` skips it, and I confirmed a later `start-fresh` against
that store parked normally rather than refusing.

### m4. `doctor` reads GREEN on a Config whose `dataDir` does not exist

In the M1 state: `RED Store no store at …` and, two lines down,
`GREEN Config … — read; dataDir …/store`. The Store line covers it, but the Config line is
asserting a path that is not there.

### m5. The export carries the parked store's absolute path

`store.previous.parked` lives in `meta`, so a `--plaintext` export includes the old store's
full filesystem path. Correct (it is host state, not a memory — `select count(*) from
memories` is 0, and `recall` returns nothing), but worth knowing before an export is shared.

---

## NIT

- **n1.** When the store rename fails but snapshots succeeded (lab home `d1`, a dangling
  symlink at the parked name → `ENOTDIR`), the message still says "the rollback lines printed
  earlier still name the way back" — line 2 of which now names a source that does not exist.
- **n2.** `--name` is passed straight through to `install`'s identity seed: `--name
  "../../escape"` printed `identity core seeded for ../../escape`. Harmless (it is a name,
  not a path; the config is kept and the store path is unaffected), but unvalidated.
- **n3.** `store.parked-<date>` and `snapshots.parked-<date>` pick their `-N` suffixes
  independently, so a second run's two directories can wear different numbers. QUICKSTART
  §9a already says so, which is the right call; noted only because it surprised me.

---

## Checked and clean

**I ran this**, all of it, unless marked *(read)*:

- **Never deletes, never opens — structurally.** `start-fresh.ts` calls only `lstatSync`,
  `readdirSync`, `realpathSync`, `readFileSync`, `statSync`, `existsSync` and `renameSync`.
  No `child_process`, no `Store`, no `openDb`, no `rm`/`unlink`/`cp`, no `mkdir`, no
  `writeFile`. In `startFreshCommand` the only things that touch a path are `park()`
  (renames), `installCommand` (writes at the install layout) and `Store.open` on the *new*
  store.
- **Never deletes, never opens — behaviourally.** A real v5 store (4 KB db, 535 KB
  uncheckpointed `-wal`) fingerprinted by SHA-256 of every file including `-wal`/`-shm`, every
  directory's entry list, every symlink, and mtime+size of every database file, compared
  across: `--dry-run` (identical), a real run (parked tree identical), a **refused** run (a
  store inside `.bansai` — identical), an **interrupted** run (M1's shape: parked, install
  refused — the parked tree identical), and a full printed rollback (identical).
  `floor/v5-last` then read all 4 rows and all 40 meta keys out of the restored store. The
  other refusals in the battery below were checked by layout and contents (`ls -A`, file
  bodies, symlink targets) rather than by hash, and every one of them left the ground exactly
  as it was.
- **`--dry-run`** changed nothing at all, in the store or beside it.
- **The `counterparts` on his `PATH` IS the shared checkout,** so the deploy does move it:
  `command -v counterparts` → `/Users/mlapeter/.bun/bin/counterparts` →
  `../install/global/node_modules/counterparts/src/adapters/cli/bin/counterparts.ts`, and
  `~/.bun/install/global/node_modules/counterparts` is a symlink to
  `/Users/mlapeter/counterparts`. (Symlink targets only; I read nothing inside the checkout.)
  This is what makes the cut-over order below work.
- **Refusals, each leaving the ground untouched:** `dataDir` inside `.bansai` (by name);
  a `dataDir` symlink whose realpath is inside `.claude-engram` (caught on the resolved
  spelling); an ordinary symlink; `dataDir` = home; `dataDir` = `/`; `dataDir` = the config's
  own directory; `--dir <path>` (in words); `--dir` with no value ("--dir needs a value");
  no TTY without `--yes`; a live unended session record in `<store>/sessions/` (refuses even
  with `--yes`); a config that will not parse; a config naming no `dataDir`; observer stance;
  an unnamed config under `COUNTERPARTS_REQUIRE_EXPLICIT_DIR`.
- **`..` in `dataDir`** normalises to the real store and parks it correctly, snapshots and
  all. A **trailing slash** likewise.
- **Cross-device (`EXDEV`).** Mounted a disk image and pointed `dataDir` at the mount point
  (`stat -f %d`: `16777258` vs parent `16777234`). Refused **before anything was parked**,
  with the reason: "moving it beside itself would be a COPY followed by a DELETE … and this
  command does not delete, ever." The store and the mount were untouched.
- **Date-suffix collisions.** `store.parked-<date>` already present as a **file**, as a
  **symlink**, and as a **non-empty directory** — each time the new park went to `-2` and the
  existing thing was left exactly as it was (the file still held its bytes, the symlink was
  still a symlink, the old parked directory still held its `OLD` file). A genuine **second run
  the same day** parks to `-2` beside the first. A **dangling** symlink at the parked name is
  the one gap: `existsSync` is false, `rename` then fails `ENOTDIR`, and the run stops with
  the store still in place and nothing deleted (see n1).
- **Snapshots.** Absent → nothing parked, store parked, says so. Configured elsewhere
  (`snapshots.dir`) → left alone, with the `keep`-sharing paragraph printed. Not named `store`
  → "No snapshots directory belongs to this layout".
- **Ordering.** Snapshots first, store second, `park()` stops at the first failure and undoes
  nothing: a failure on rename 1 left everything in place ("Nothing has changed."), a failure
  on rename 2 left snapshots parked and the store where it was.
- **Config, credentials, scopes byte-identical.** `md5` of `claude-code.json`,
  `credentials.env` (mode 600) and `scopes.json` unchanged across a full run. With a config
  carrying `injectionBudgetBytes: 12345`, `executionCeilingMs`, `snapshots.keep` and
  `identity`, the file was byte-identical afterwards and the "NO injectionBudgetBytes was
  written" paragraph did not print (0 hits). The ceiling passthrough cannot change a value:
  `install` runs without `--force`, so `writeOnce` keeps the file.
- **The blank store** is schema v6 `counterparts.sqlite` + `cache/`, and a real SessionStart
  hook opened it and produced an ordinary wake ("No briefing has been composed yet — this
  store has not lived a boundary"), adding only `sessions/`.
- **The record** is `meta`, not memory: `select key,value from meta where key like 'store.%'`
  returns the three keys; `select count(*) from memories` is 0; `recall` returns
  `NOTHING CAME BACK`; `status` prints "This store began on 2026-09-20; the previous one is
  parked at …, untouched." A store that was simply installed prints no such line *(read: the
  test at `test/start-fresh.test.ts:698` asserts it, and I confirmed the meta is absent)*.
- **Resume.** Store parked with no blank store → the next plain `start-fresh` reports "A
  previous run was interrupted", moves nothing, creates the blank store, and records the
  right previous. `doctor` and `status` in that intermediate state report precisely and mint
  nothing (only the *hook* does — M4).
- **`--name`** does not change where the blank store lands or what gets parked; it only seeds
  the identity core. **`COUNTERPARTS_DATA_DIR`** set to a decoy is correctly ignored when a
  config is present (decoy directory stayed empty) — it is only unpinned in B1's shape.
- **Rollback, run for real** by `sed`-ing the three `mv` lines out of the actual captured
  output and running them verbatim: old store byte-identical, snapshots byte-identical,
  `floor/v5-last` reads every row, the blank store is *parked* at `store.blank-<date>` and not
  deleted, and `start-fresh` runs correctly again afterwards.
- **Regression sweep.** The PR adds two test files and changes none. No `test.skip`,
  `test.todo` or `test.only` anywhere in the diff. The `git archive` fixture is honest and
  cheap: `git archive floor/v5-last src` is 3.8 MB in 16 ms, and a full v5 store (memories,
  a revision, an episode, a journal, a cache, 535 KB of uncheckpointed WAL) takes 59 ms; the
  five cut-over tests total 0.256 s. Throwing when the tag is missing is right — skipping
  would turn the one claim that matters into a green run. Leftovers after a full suite:
  `counterparts-v5build-*` = 0, `counterparts-v5home-*` = 0, `counterparts-n1-*` = only my
  own lab, removed.
- **Suite and typecheck**, as printed:
  ```
  bun test v1.3.10 (30e609e0)
   2539 pass
   0 fail
   34675 expect() calls
  Ran 2539 tests across 43 files. [67.73s]
  ```
  `bunx tsc --noEmit` → exit 0, no output.

---

## The thing that will actually go wrong on cut-over day

**An old-build process still attached writes half of one memory into the parked store and
the other half into the new blank one.** This is not a bug in the rename; it is the price of
parking *in place*, and it is worth stating plainly because the command's own warning does
not name this shape.

**I ran this** (lab home `u1`): a `floor/v5-last` process held the store open across the
rename, then wrote again.

```
HOLDER: wrote after-mark through the old handle
HOLDER: put a memory after the rename

PARKED dir:  cache operational.sqlite operational.sqlite-shm operational.sqlite-wal prose tmp versions
NEW dir:     cache counterparts.sqlite counterparts.sqlite-shm counterparts.sqlite-wal prose tmp
                                                                                      ^^^^^ ^^^
```

SQLite follows the **inode**, so the row landed in the parked `operational.sqlite`. The prose
writer resolves `join(dir, "prose", …)` by **path string**, so the markdown body landed in the
**new** store: `…/store/prose/memories/mem_98cb696a680b.md`. One memory, two stores. And the
new store then refuses to open at all:

```
could not open the store: refused: …/store was written before this build's floor — it keeps its
memories in files (prose) … this directory holds TWO stores' names — a pre-rows store (prose,
WITH FILES IN IT) and a counterparts.sqlite. DELETE NEITHER.
```

The refusal message is excellent and does not tell him to delete anything — but it does not
say the two halves belong to *different* stores. **I also ran** the simpler version (a
`floor/v5-last` `Store.open` pointed at a finished new-floor store): it minted
`operational.sqlite`, `operational.sqlite-wal/-shm`, `prose/`, `versions/` and `tmp/` inside
it, and the new build then refused its own store — F5's review A, reproduced.

The guard against all of this is: **nothing old may still be running, and nothing old may
start afterwards.** Which is the ordering question.

---

## Cut-over day, in order

`floor/v5-last` **does not have this command** — I checked the tag's `COMMANDS` array; there
is no `start-fresh` and no `src/adapters/cli/start-fresh.ts`. So the plan is wrong where it
matters:

- `docs/plan-parallel-rebuild-2026-09-18.md` §4 says *"backup off the store · N1's command ·
  deploy the checkout to master · restart Claude Code."* At step 2 the `counterparts` on his
  `PATH` is the pinned old build, which does not have the verb. **That order cannot be run.**
- §4's rollback sentence — "re-detaching at `floor/v5-last` and pointing `dataDir` back" — is
  also stale against this PR: N1 parks in place, so `dataDir` never moves and there is nothing
  to point back.
- `docs/QUICKSTART.md` §9a is correct for an ordinary user and says nothing about which build
  runs it, because it is not a cut-over-day page. That is fine, but the cut-over runbook needs
  its own line.

**The deploy must come before `start-fresh`**, and this is the most important sentence in the
review. Deploy-first is safe: I measured the new build's hook standing down cleanly against a
real v5 store (`STORE_PRE_ROWS`, exit 0, no database opened, every hash unchanged, and
`floor/v5-last` still reads it afterwards — m3). Deploy-*after* is the dangerous order: in
the window between `start-fresh` and the deploy, any session that starts runs the **old**
build against the **new** store and produces the two-stores-in-one-directory state above.

What I would have him do:

| # | Step | Which build |
|---|---|---|
| 1 | Close every Claude Code session, both dashboards, every MCP server, the worker. Verify with `pgrep -fl counterparts` and ignore the `next dev` / `tail` lines (m1). | — |
| 2 | `counterparts backup --dir ~/.counterparts/store --out <somewhere off the store>` and verify it. **This must happen before the deploy** — the new build cannot open a v5 store at all. | **old** (`floor/v5-last`, on `PATH` today) |
| 3 | `tools/deploy-checkout.sh --repo ~/counterparts --ref origin/master`. Nothing is open, so no hook fires against the v5 store. This also swaps the CLI on his `PATH`, because that shim links into the same checkout (verified above). | — |
| 4 | `counterparts start-fresh --config ~/.counterparts/claude-code.json`. Type the parked name — **do not pass `--yes`**; the typed confirmation is the only instrument that catches the idle dashboard. Read the `Store:` line and confirm it is not blank (B1). | **new** — `PATH` now resolves to it |
| 5 | Restart Claude Code. | new |
| 6 | `counterparts doctor --config ~/.counterparts/claude-code.json`, then `ls ~/.counterparts/store` and confirm it holds only `counterparts.sqlite*`, `cache/` and `sessions/` — no `prose/`, no `operational.sqlite`. That check is what catches a process nobody closed. | new |

Rollback, if he wants the old memory back: re-run the three printed `mv` lines **in order**
(M2, M3 — check each destination does not exist first), then
`tools/deploy-checkout.sh --repo ~/counterparts --ref floor/v5-last`, then restart. `dataDir`
does not move and needs no editing.

---

## What I could not determine

- **Whether a real, long-idle Claude Code session leaves a `sessions/<id>.json` fresh enough
  to trip the ten-minute refusal.** The record format is identical between `floor/v5-last` and
  this build, and a synthetic live record refuses correctly — but the boundary that refreshes
  `lastBoundaryAt` is `Stop`, so a session open for an hour without a turn is invisible, as the
  code says. The dashboard and the MCP server leave no record at all, and both are running on
  his machine right now.
- **A real `SIGKILL` inside the two-syscall window.** I built each intermediate state by hand
  instead and probed every entry point against it; I did not land a kill between the two
  `rename` calls.
- **`EXDEV` with `snapshots` on one filesystem and the store on another.** I could not mount
  at an arbitrary path without root, so I proved the store-as-mount-point case only. The order
  is right structurally: `sameFilesystemRefusal` returns from `planStartFresh` before `parks`
  is built, so nothing can be parked first — but only the store's device is compared, never the
  snapshots directory's.
- **Whether the live `~/.counterparts/store` has any shape my lab did not reproduce.** I never
  read it. Everything above is against v5 fixtures written by `floor/v5-last` itself; his store
  has ~17,000 rows and years of `prose/`, `versions/` and journal files, which changes nothing
  about a rename but means step 6's "look at what is in the new store" is the check that
  matters, not my fingerprints.

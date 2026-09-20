# Adversarial review (confirmation pass) — N1, `counterparts start-fresh` (PR #150)

Branch `origin/newuser/n1-start-fresh` @ **`0accf01`**. Read-only: nothing here was fixed,
committed, pushed or deployed.

Everything under **I ran this** was executed in a lab under `$TMPDIR`
(`counterparts-n1b-*`), every command with `HOME` pointed at a fake home inside it and a
curated `env -i` (`PATH` with a stub `claude`, `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`,
`BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`, `TMPDIR` inside the lab). `HOME` was echoed inside
that env on every invocation. Old-floor fixtures were built by `git archive floor/v5-last`
+ that build's own `Store` API (4 KB `operational.sqlite`, **535,632-byte uncheckpointed
`-wal`**). The live checkout, `~/.counterparts`, `~/.bansai`, `~/.claude-engram` and
`~/.claude*` were never read, listed, written or `cd`-ed into, and no process on the real
machine was sampled. Paths below are folded to `~` for width; `~` means the lab's fake home.

---

## Verdict

# MERGE AFTER FIXES

**The forward command is closed.** Every one of B1, M1–M5 and the three SHOULDs is fixed,
and I proved each by running the first review's own reproduction. The one rule still holds
under the sharpest test available: a genuine v5 store with 535 KB of uncheckpointed WAL
went through a refusal, a dry run, a real cut-over and a full printed rollback
**byte-identical** (`f148bbee…` before and after, `-wal` still 535,632 bytes), and
`floor/v5-last` read all four rows and its meta back out afterwards.

**The new `--undo` is not.** It is the one path on the branch that nobody had attacked, and
it runs **none of the forward direction's refusals**: no `assertSafeDataDir`, no
`parkRefusal`, no symlink clause, no `isAbsolute`, no "contains the configuration", no
liveness check. I made it rename a directory out of a `.bansai` twice — once with a
tampered record, once with **no tampering at all**, on a configuration the forward command
refuses by name one command earlier on the same screen. That is the second CLAUDE.md safety
rule, broken by the command whose entire job is being the safe way back.

**What this is not.** On the owner's actual layout — `dataDir = ~/.counterparts/store`, the
record written by the forward run — `--undo` behaved correctly every single time I ran it:
the v5 good path (restored `f148bbee…`, `floor/v5-last` read all four rows), the two-runs
case (the record wins, the right store comes back), undo-twice (refuses). BLOCKER-1 is a
**missing guard ring under inputs the forward path refuses by name**, not a bug that will
fire on his machine on cut-over day. The fix is parity, not redesign: `planUndo` /
`startFreshUndo` calling the same checks `planStartFresh` already calls. That is why this is
MERGE AFTER FIXES and not DO NOT MERGE.

**1 BLOCKER, 2 MAJOR, 5 MINOR, 3 NIT.** All of them are in `--undo` or in what the output
says; none is in the rename ring the first review hardened.

---

## Part 1 — the first review's findings, each re-run

| # | Finding | Closed? | What I RAN, and saw |
|---|---|---|---|
| **B1** | a one-character `--config` typo opens and stamps the live store | **YES** | The reviewer's exact typo (`…/claude-code.jsonn --yes --nothing-is-open`) against a fake home holding a real store with 2 memories + an identity core: `Store:` now prints `~/.counterparts/store` (never blank) **before** anything happens, then *"refused: there is no configuration at …jsonn … but ~/.counterparts/store already holds something (5 entries) … a configuration one character off names a directory that is not yours to start fresh in."* Store fingerprint identical (incl. `-wal`/`-shm`), **mtimes identical**, `select key,value from meta where key like 'store.%'` → `[]`, no `store.*parked*` directory written. |
| B1 | variants | **YES** | config path is a **directory** → refused ("exists but could not be read"); **malformed JSON** → refused, named separately; **valid JSON, no `dataDir`** → refused by name; **`chmod 000`** → refused; **`COUNTERPARTS_DATA_DIR` decoy exported** with the typo → same refusal, decoy directory left **empty**; **`COUNTERPARTS_CONFIG`** naming the typo'd path → same refusal (so the env spelling is covered, not just `--config`); **first-ever machine, no config anywhere** → the landing path is printed first, then `Created a store at ~/.counterparts/store`; **cold arm with something already at the landing place** → refused, naming it. |
| B1 | the record gate (`storeExists(installTarget)`, replacing the always-true `parking \|\| resume \|\| !symlink`) | **YES, with one unreachable window** | The **false** branch — a record written on a store this run made — is the good path I ran end to end. The **true** branch is driven by the builder's own test (`test/start-fresh.test.ts:1084`), which mints a store at the live path from inside `io.out` on the `"Creating the blank store"` line, i.e. at `commands.ts:2665`, immediately before the check at `:2683`; `install` then prints *"Store already present"* and `store.started` is `undefined`. *(Read: that is an honest seam, and it leaves one window — a mint landing between `:2683` and `:2691` — that no test can drive. See "could not determine".)* |
| **M1** | `install` can refuse *after* both parks | **YES** | Order reversed — the blank store is built in `store.new-<pid>` first. Budget battery on a non-empty store, each run checked for parked siblings afterwards: `8192.5` → no refusal, the passthrough is dropped with an explicit note, store parks normally; `-1`, `0`, `1e400`, `"lots"` → refused, **`parked: 0`** in every case (nothing moved). `--name ""` and `--name $'a\nb'` refused. |
| **M2** | rollback printed from plan 1, renames from plan 2 | **YES** | The date is frozen (`const at = now()` feeds both `planStartFresh` calls), `parksDiffer` refuses on drift, and the real run re-prints **"The way back, as it actually stands now"** from the plan that ran — I parsed those lines out of real output and ran them (M3 below) and they named paths that exist. The decoy-at-the-prompt race needs a TTY between the two plans; I did not land it, I read the refusal. |
| **M3** | printed `mv` merges into an existing destination | **YES** | Guarded lines `grep`-ed out of **real** output and run verbatim through `/bin/sh`: **free destinations** → exit 0, restored store byte-identical to the parked one, blank store parked at `store.blank-2026-09-20` not deleted; **destination exists** (same lines re-run) → both print `REFUSING: … mv would put the source INSIDE it`, nothing nested (`ls store/` has no `store.*` child); **a home path containing a space, a `$` and a `'`** (`~/we ird$x'q`) → the lines escape correctly (`\$`, the quote bare inside double quotes), run clean through `/bin/sh`, restored store byte-identical. |
| **M4** | a hook mints a store at `dataDir` in the post-park window | **YES for the collision; the leftovers are new (N5)** | I rebuilt the post-park state by hand and fired the **real** `hook.ts` SessionStart: it still mints a full store at `dataDir` (`cache counterparts.sqlite …-shm …-wal sessions`) — as it must, nothing in this PR changes the hook. The window it can do that in is now two `rename`s wide, and `renameSync(installTarget, storeDir)` onto a non-empty directory throws rather than merging. On the next `start-fresh` the minted store's live session record **refused the run outright** before any rename. The `ENOTEMPTY` branch's printed way back now includes its snapshots line (read: `printWayBack(io, final, outcome.done.map(...), installTarget)` at `commands.ts:2759`). |
| **M5** | non-absolute `dataDir` renames a directory in the cwd | **YES on the forward path; NOT on `--undo`** — see **BLOCKER-1 / MAJOR-1** | `relative-store`, `~/.counterparts/store`, `./rel2` → all refused by name before anything moves; trailing slash and `..`-containing paths normalise and park correctly; a **symlinked** `dataDir` → refused with the full "renaming a link moves the link" paragraph. |
| SHOULD 1 | `--yes` refused on a non-empty store unless `--nothing-is-open` | **YES** | `--yes` alone on a 5-entry store → *"refused: --yes on a store with 5 things in it…"*, nothing parked. (`--yes --dry-run` returns at the dry-run before the gate — correct, nothing is at stake.) |
| SHOULD 2 | a symlinked `snapshots` is LEFT and SAID, the store still parks | **YES** | `snapshots` → an external directory: *"The snapshots folder at … is LEFT WHERE IT IS"* with the symlink reason quoted under it; `store.parked-2026-09-20` created; the symlink still a symlink pointing where it did. |
| SHOULD 3 | both devices compared before the first rename | **read, not run** | `planStartFresh` calls `sameFilesystemRefusal(snapshotsDir)` at `start-fresh.ts:595` before `parkSnapshots` is set, and `sameFilesystemRefusal(storeDir)` at `:601` returns before `parks` is built. I could not mount at an arbitrary path without root — unchanged from the first review. |
| m1–m5, n1–n3 | | **YES** | `pgrep` text names `serve.ts`/`dashboard.ts`/`hook.ts`/`runner.ts` and says path-only matches are noise; symlinked snapshots (SHOULD 2); the store and its snapshots wore the **same** suffix in every multi-run case I made; `--name` validated for blank/newline/null (`"../../escape"` still passes — as the PR says it intends). |

### Also confirmed on the forward path

**I ran this.** Real v5 store (4,096-byte database, 535,632-byte uncheckpointed `-wal`):

```
0. fingerprint as built              f148bbee1e765972c5d126ce3bc670cb171898c78d9b94a619a62d9774106d6a
1. the new build refuses it by name  STORE_PRE_ROWS … NOTHING WAS TOUCHED
   fingerprint after the refusal     f148bbee…  (identical)
2. start-fresh --yes --nothing-is-open   exit 0;  STORE_PRE_ROWS hits in the output: 0
3. parked tree                       f148bbee…  IDENTICAL: yes;  -wal still 535632 bytes
5. start-fresh --undo                restored
6. restored store                    f148bbee…  IDENTICAL: yes
7. floor/v5-last reads it            rows: 4   meta n1.fixture.0: 200
8. the blank store                   PARKED at store.blank-2026-09-20, not deleted
9. snapshots                         back at ~/.counterparts/snapshots
```

The old-floor plan line prints, the `--undo` old-floor warning prints in **both** the dry
run and the real run, and the run never reached the pre-rows refusal.

---

## Part 2 — `--undo`: new findings

### BLOCKER-1. `--undo` renames directories the forward command refuses by name — including inside `.bansai`

`startFreshUndo` (`commands.ts:2864`) and `planUndo` (`start-fresh.ts:949`) run **no**
`parkRefusal`, **no** `assertSafeDataDir`, **no** symlink check, **no** `isAbsolute`, and
**no** "the store contains the configuration" clause. `storeDir = resolve(dataDir.trim())`
and `parked = resolve(input.parked)` go straight to `existsSync` → `renameSync`.

**I ran this — variant A, no tampering at all.** A configuration whose `dataDir` is
`~/.bansai/store`, with a `store.parked-2026-09-20` sibling exactly as a forward run would
have left one:

```
=== forward start-fresh (control)
refused by name: the store (~/.bansai/store) is inside ~/.bansai. That is a live memory
this package never touches — not to read it, not to move it, not to rename it
(CLAUDE.md, the second safety rule).

=== --undo --yes --nothing-is-open   (same configuration, same screen)
  moved the store that is there now: ~/.bansai/store -> ~/.bansai/store.blank-2026-09-20
  moved your parked memory: ~/.bansai/store.parked-2026-09-20 -> ~/.bansai/store
Done. Your memory is back at: ~/.bansai/store

=== .bansai afterwards:
store            <- was store.parked-2026-09-20
store.blank-2026-09-20   <- was the live store
```

Two renames inside `.bansai`, one command after the forward direction refused the same path
in those exact words. Nothing was deleted, but the rule is "not to move it, not to rename
it", and it did both.

**I ran this — variant B, the record treated as hostile.** `store.previous.parked` is a row
in the new store's `meta` table; anything with the store open can write it. Rewritten to
`~/.bansai/store` (which held `MEMORY.md`):

```
Parked: ~/.bansai/store
  moved your parked memory: ~/.bansai/store -> ~/.counterparts/store
--- the restored store:
MEMORY.md
PRECIOUS-V1-MEMORY
```

`~/.bansai` was left **empty**. A crafted value makes `--undo` rename an arbitrary
directory over `dataDir`. Two more crafted values, both accepted as legitimate plans:

- `parked` = `dirname(storeDir)` (`~/.counterparts`, holding `claude-code.json` and
  `credentials.env`) → the plan prints `~/.counterparts -> ~/.counterparts/store`, a
  directory into its own child. Step 1 (parking the blank store) runs first, so the run
  reaches the doomed rename with the store path already vacated.
- `parked` = a **symlink** to an unrelated directory → **I ran this**: it renamed the link
  to the store path, so `dataDir` is now a symlink into `~/elsewhere4`. That is the exact
  outcome `parkRefusal`'s symlink paragraph calls "the one outcome worse than refusing" —
  produced by the command that is supposed to be the way back from it.

**Smallest fix.** In `startFreshUndo`, before anything: run the same three checks the
forward direction runs, on **both** paths —

```ts
const bad = parkRefusal("store", storeDir, configPath, home)
         ?? parkRefusal("parked store", parked, configPath, home);
if (!isAbsolute(dataDir.trim()) || bad !== null) { refuse; }
```

and constrain the record: `parked` must be `dirname(storeDir)`-sibling and its basename
must start with `${basename(storeDir)}.${PARKED_INFIX}-`. The record is data in a database;
anything it names that is not a parked sibling of this store is not a thing to rename.
(`planUndo`'s own fallback already only ever produces siblings — this makes the recorded
value obey the same rule the fallback does.)

### MAJOR-1. `--undo` resolves a relative `dataDir` against the process working directory

M5's fix landed in `planStartFresh` only. **I ran this** with `{"dataDir": "relative-store"}`
and `--undo`:

```
Store:  /Users/mlapeter/counterparts/.claude/worktrees/agent-af67b643889a09532/relative-store
```

— the CLI's cwd, not the fake home. It refused only because no `relative-store.parked-*`
happened to sit there; with one present it would have renamed it. Same class as M5, same
one-line fix (`isAbsolute`), covered by BLOCKER-1's fix if that is written as described.

### MAJOR-2. `--undo` has no live-session check at all

The forward direction refuses on a live un-ended session record **even with
`--yes --nothing-is-open`** (`livenessRefusal` runs above the `--yes` gate). `--undo` never
calls `readLiveness`. The store it displaces is a real one too — on the owner's machine it
is a week of new memories with a dashboard attached.

**I ran this.** A fresh un-ended `sessions/live.json` (`lastBoundaryAt = Date.now()`) in the
store:

```
--- forward start-fresh control:
refused: a Claude Code session's hooks ran against this store in the last 10 minutes …
--- undo with the SAME live record:
  moved the store that is there now: ~/.counterparts/store -> ~/.counterparts/store.blank-2026-09-20
  moved your parked memory: … -> ~/.counterparts/store
Done.
```

**Smallest fix:** call `readLiveness(storeDir, now())` in `startFreshUndo` and reuse
`livenessRefusal`, printing the same two grades. Five lines, and it closes the parity gap.

### MINOR-1. `--undo`'s failure branch prints no way back

`commands.ts:2972–2976` prints *"What is listed above HAS moved; nothing else has"* and
stops. The forward direction calls `printWayBack` in **both** of its stop-partway branches
(`:2728`, `:2759`); the undo has no equivalent. A run that parks the blank store and then
fails to put the memory back leaves the owner with nothing at `dataDir`, a
`store.blank-<date>` whose name says it is disposable, and not one printed line.

*(Read, not run: I could not land a mid-plan failure. The nearest I got — a dangling symlink
at the parked name — was caught earlier still, by `planUndo`'s own `!taken(parked)` clause
("…is not there"), which moves nothing.)* **Smallest fix:** print the
guarded reverse of `outcome.done` in that branch, exactly as `printWayBack` does.

### MINOR-2. `--undo` does not re-read the ground after the confirmation

M2's whole lesson — "a plan held across a person is a plan about a store that may have
changed" — is applied to the forward direction (`planStartFresh` twice, `parksDiffer`) and
not to the undo, which plans once at `:2896`, checks destinations at `:2914`, then waits at
a prompt at `:2962` and renames at `:2970` from the plan it made before the wait. *(Read.)*

### MINOR-3. There is no way back from an undo — the header comment says there is

`commands.ts:2855` says *"The blank store is PARKED rather than removed, so an undo of an
undo is a rename too."* **I ran this:** after an undo, a second `--undo` refuses —
*"nothing beside … is a parked store, and the store that is there carries no record of
one."* It is right to refuse, but the blank store is parked as `store.blank-<date>`, which
`siblingsParked` (prefix `store.parked-`) never matches and no record names. The way back
from an undo is a hand-written `mv`, and nothing on screen says so.

### MINOR-4. `--undo --dry-run` writes into the new store

**I ran this.** Per-file hashes of `~/.counterparts/store` before and after
`--undo --dry-run`: `counterparts.sqlite-shm` and `cache/cache.sqlite-shm` both change.
Nothing else does — no `-wal`, no database, no content — so this is `Store.open({observer:
true})` touching its shared-memory index, and it is the **new** store, not the parked one
(the parked tree's fingerprint was unchanged across the same run). It does not break the
rule. It is worth one sentence because the line above it says *"nothing is deleted, and the
parked store is never opened"* and a careful reader checking bytes will find bytes moved.

### Things I tried against `--undo` that held

**I ran this**, each in its own fake home:

- **the good path**, twice: a new-floor store (memories intact on the parked blank one) and
  the v5 store above — restored **byte-identical**, `floor/v5-last` reads every row, the
  blank store parked not deleted, snapshots restored.
- **record names a path that no longer exists** → *"refused: … is not there."* Nothing moved.
- **undo twice** → the second refuses; nothing moved.
- **undo after two `start-fresh` runs** → the record wins: it restored
  `store.parked-2026-09-20-2` (the second store, holding the memory made on it — `status`
  confirms `Memories: 1`), leaving `store.parked-2026-09-20` (the original) alone. Correct,
  and the record is doing real work here.
- **"refuses to guess when several parked siblings exist"** → proved by deleting the record
  row with two siblings present: *"refused: 2 parked stores sit beside … this will not guess
  — guessing is how an empty shell gets named as somebody's memory"*, both listed.
- **destination exists** (a `snapshots` folder the rotation put back) → the snapshots step
  is dropped and **said** (*"is LEFT WHERE IT IS … Your copies are in both"*), the store
  still comes back. That is m2's lesson applied correctly, and it is the builder's own
  corrected premise — it holds.
- **it opens only the new store, as an observer** → `Store.open({ dir: storeDir, observer:
  true })` at `commands.ts:2886` is the only open in the undo path; the parked tree's
  fingerprint was unchanged across a dry run and across the real run (only the rename).
- **`--dir` and `--observer`** are refused on `--undo` too (the `--dir` clause sits above the
  undo branch).
- **undo to an old-floor store says the checkout must go back**, in both the dry run and the
  real run, naming `tools/deploy-checkout.sh --repo <checkout> --ref floor/v5-last`.
- **what happens if he restarts without doing that** → **I ran this**: the new build's real
  `hook.ts` SessionStart against the restored v5 store stands down —
  `hook stood down: STORE_PRE_ROWS`, exit 0, and a `systemMessage` that says *"Counterparts
  memory is OFF for this session"* by name. The only change to the store is
  `sessions/probe-2.standdown.json` (m3, already documented); the database, the `-wal`, the
  `prose/` bodies and `versions/` are all untouched, and `floor/v5-last` still reads it.

---

## Part 3 — regression sweep

- **Diff vs `origin/master`:** 11 files, +4153/−16. `commands.ts` (+951), `start-fresh.ts`
  (new, 1071), `test/start-fresh.test.ts` (new, 1487), `test/old-floor-fixture.ts` (new,
  161), `install.ts` (+19, the exported `budgetRefusal` M1 needs), `index.ts` (+36, flags
  and help), plus docs. Nothing in the fix-pass diff is unexplained by a finding.
- **No test weakened, skipped or deleted.** `grep -rn "test.skip|test.todo|test.only|
  it.skip|describe.skip" test/` → no hits anywhere in the tree. The PR changes no existing
  test file.
- **The rollback tests are hermetic in effect, and break a documented rule.** Both
  `spawnSync("/bin/sh", ["-c", line])` sites (`test/start-fresh.test.ts:876`, `:1212`) pass
  **no `env`** — and `test/preload.ts` says in so many words that a child spawned with no
  `env` option "sees the REAL home — outside this guard entirely… Today's two spawn sites
  are safe by construction, not by luck… If you add a third, do one of those two things."
  This PR adds four spawn sites and updates neither the paragraph nor the calls. In
  practice these two are safe: the lines they run are fully absolute paths under the test's
  own `mkdtempSync` home, with no `~`, no `$HOME`, no relative argument — the shell never
  resolves a home. **NIT-1**, not a finding: pass `env: { ...process.env }` and amend the
  preload paragraph so the next one is safe by construction too.
  (`test/old-floor-fixture.ts`'s two spawns both pass explicit `env`.)
- **Suite and typecheck, as printed:**
  ```
  $ ~/.bun/bin/bunx tsc --noEmit
  (no output)   tsc exit: 0

  $ ~/.bun/bin/bun test
  bun test v1.3.10 (30e609e0)
   2669 pass
   0 fail
   36287 expect() calls
  Ran 2669 tests across 44 files. [74.96s]
  ```
  Matches the PR's claim exactly.
- **`tools/install-loop/run.sh`:**
  ```
  steps: 52   PASS 52   FAIL 0   total 4s
  ```
- **Leftovers**, after the suite and the loop: `counterparts-n1-*` = 0,
  `counterparts-v5build-*` = 0, `counterparts-v5home-*` = 0. (`counterparts-test-home-*` = 3
  belong to other suites, as the PR says; `counterparts-root-*` = 0.) My own lab
  (`counterparts-n1b-*`) and the install loop's clean room are removed by hand; `git status`
  is clean but for this file.

### Three more, ranked

**MINOR-5. A stale `store.new-<pid>` accumulates silently and nothing ever mentions it.**
**I ran this:** with a `store.new-99999` sitting beside the store (the shape a crashed run
leaves), the next `start-fresh`'s **printed plan** never names it — that run then stopped at
the liveness refusal (the hook-minted store's session record), so what I observed is that
the plan ignores it, not that a completed run does; the code path is the same either way,
since nothing in `planStartFresh` or `startFreshCommand` ever reads a `store.new-*` sibling.
It is **not** dangerous — `freeTempStore` only ever returns a name that does not
exist, so a stale one (same pid or not) is stepped over with `-2` and can never be renamed
into place as the owner's store — but on a machine where the command has failed twice there
are directories called `store.new-*` beside the memory, and the only sentence about them is
in a failure branch he may not still have on screen. Smallest fix: one line in the plan when
`storeDir.new-*` siblings exist — *"these are part-built stores from interrupted runs;
nothing reads them and nothing here will remove them."*

**NIT-2. The guarded lines' REFUSING branch exits 0.** **I ran this:** re-running the
captured block against existing destinations printed both `REFUSING` lines and
`/bin/sh` exited **0**, so a pasted three-line block keeps going past a refusal. It is
loud enough for a human reading the screen, which is what those lines are for. If it is
worth a character: `{ echo "REFUSING: …" >&2; false; }`.

**NIT-3. Rollback line 1 calls the memory "blank" if the run died during the install.** The
way back is printed *before* the install, and the install now runs *before* the parks — so
an interruption during the install leaves the memory still at `store`, and line 1
(`mv "<store>" "<store>.blank-<date>"`) would park it under a name that says it is the
empty one. Not destructive (nothing is deleted and line 2 puts it back), but the word is
wrong in the one window it is now most likely to be read in. The post-run block
(`printWayBack`) does not have this problem — it only prints line 1 when the store actually
moved.

---

## Cut-over day, in order — updated for the final command

`floor/v5-last` does not have `start-fresh` at all, so **the deploy comes first**. The
build's own hooks stand down cleanly against a v5 store (proved again above), so deploy-first
costs nothing; deploy-*after* is the order where a session that starts in the gap runs the
old build against the new store.

| # | Step | Which build | What he should SEE — stop if it differs |
|---|---|---|---|
| 1 | Close every Claude Code session, both dashboards, every MCP server, the worker. `pgrep -fl counterparts` **from a plain terminal, not from inside Claude Code**. | — | Only lines running `serve.ts`, `dashboard.ts`, `hook.ts`, `runner.ts` matter. A `tail`, an editor, a `next dev` in a path with the word in it are noise. It should end with none of ours. |
| 2 | `counterparts backup --dir ~/.counterparts/store --out <somewhere off the store>`, and verify it. **Before the deploy** — the new build cannot open a v5 store. | **old** (`floor/v5-last`, on `PATH` now) | A backup file, and a verify that passes. |
| 3 | `tools/deploy-checkout.sh --repo ~/counterparts --ref <the merge commit>`. Nothing is open, so no hook fires at the v5 store. This also swaps the CLI on his `PATH`. | — | The deploy's own confirmation. |
| 4 | `counterparts start-fresh --config ~/.counterparts/claude-code.json` — **no `--yes`**. | **new** | `Store:` names `~/.counterparts/store` and is **not blank**; the plan lists `snapshots` then `store`; the **OLD FLOOR** paragraph appears naming `operational.sqlite, prose, versions` and `floor/v5-last`; three guarded `mv` lines print **before** anything moves; then the typed confirmation asks for `store.parked-<today>`. If the date on screen is not today's UTC date, or the `Store:` line is blank, or the OLD FLOOR paragraph is missing — stop. |
| 5 | Type the parked name. | new | `Created a store at ~/.counterparts/store.new-<pid>`, then `parked snapshots:` and `parked store:` on one line each, then `Done.` and the way back **re-printed**. If the run stops with "the blank store could not be moved into place", read the three named directories and stop — nothing was deleted. |
| 6 | Restart Claude Code. | new | An ordinary wake against a blank store. |
| 7 | `counterparts doctor --config ~/.counterparts/claude-code.json`, then `ls ~/.counterparts/store`. | new | Only `counterparts.sqlite*`, `cache/`, `sessions/`. **No `prose/`, no `operational.sqlite`** — that is the check that catches a process nobody closed. |

**Rollback.** `counterparts start-fresh --undo` is the way back **once BLOCKER-1 and
MAJOR-1/2 are fixed**; it is the step-4-and-5 reverse and it does the same three renames
without a shell. Until then, use the guarded `mv` lines from the run's own output — they are
printed twice, they run clean through `/bin/sh`, and each refuses rather than nesting.

`--undo` sits **before** the checkout goes back, and it says so itself: it prints *"THE
STORE COMING BACK IS ON THE OLD FLOOR … the checkout has to go back too"* in both the dry
run and the real run. So: `start-fresh --undo` → `tools/deploy-checkout.sh --repo
~/counterparts --ref floor/v5-last` → restart. If he restarts before re-deploying, memory is
visibly **OFF** for the session (`hook stood down: STORE_PRE_ROWS`, a `systemMessage` that
says so, exit 0) and the old store is untouched but for a `sessions/*.standdown.json` mark —
measured, and `floor/v5-last` still reads every row afterwards. `dataDir` never moves, so
nothing needs editing.

---

## What I could not determine

- **A real `SIGKILL` between the two renames**, and the `ENOTEMPTY` branch of the second
  rename. I rebuilt every intermediate state by hand and probed them, and I read the branch's
  printed way back; I landed no kill inside the window.
- **The `storeExists(installTarget)` → `installCommand` race** (`commands.ts:2683`–`:2691`).
  The builder's test drives a mint at `:2665`, immediately *before* the check; there is no
  injection point *between* the check and the install and no test can drive one. Reasoned: on
  the parking arm `installTarget` is a fresh temp sibling, so it is false by construction; on
  the cold and resume arms a hook minting a store in those microseconds would be stamped
  `store.started.by = start-fresh`. Narrow, and much narrower than what B1 closed.
- **`EXDEV` with `snapshots` on one filesystem and the store on another.** Both devices are
  compared before the first rename (read); I could not mount at an arbitrary path without root.
- **The decoy-takes-the-parked-name race at the real interactive prompt.** The frozen date
  closes the midnight variant by construction and `parksDiffer` refuses on drift; I did not
  drive a TTY between the two plans.
- **Whether the live `~/.counterparts/store` has a shape my lab did not reproduce.** I never
  read it, listed it or went near it. Everything above is against v5 fixtures written by
  `floor/v5-last` itself — which is why step 7's "look at what is in the new store" is the
  check that matters on the day, not my fingerprints.

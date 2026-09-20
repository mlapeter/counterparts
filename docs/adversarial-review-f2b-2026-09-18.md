# Adversarial review, second pass — PR #136, `floor/f2-snapshots` (head `5633cec`)

2026-09-18. Reviewed `git diff 45b37ba..5633cec` — the builder's answer to the first review
(`adversarial-review-f2-2026-09-18.md`). Read-only on the branch: nothing pushed, nothing
commented, nothing deployed. Every probe ran against trees built under `$TMPDIR`; no probe was
pointed at `~`, `/`, `~/.counterparts`, `~/.bansai` or `~/.claude-engram`.

**Suite on the new head:** `bun test` → **2282 pass / 0 fail**, 28729 expect() calls, 39 files,
53.4 s. `bun run typecheck` (`tsc --noEmit`) → **clean**. Matches the claim exactly.
**The three worker tests are no longer clock-dependent:** all three now pass `date: TODAY` into
`runOnce`, and the assertion is `startsWith(TODAY + "T")`, so the copy's name no longer depends
on which side of UTC midnight the test runs.

**Verdict: safe to merge AFTER one named fix — MAJOR-A below.** Everything the first review
raised at MAJOR is closed, and I proved each one closed. The new delete-path code introduces one
new silent failure direction that is worth five lines to remove before it ships.

**Deploy line: yes — safe to deploy to the live store once WAL (#137) is live. Proved, on both
halves of the question.**

1. *Does `VACUUM INTO` from a WAL source write a WAL copy?* **No.** Measured directly against
   `bun:sqlite`, no repo code involved: a source database in WAL mode (header bytes 18/19 =
   `2, 2`, with live `-wal` and `-shm` beside it) produced a copy whose header reads `1, 1`
   (rollback), with **no sidecars at all** next to it, 500/500 rows intact and
   `PRAGMA quick_check` = `ok`. So every snapshot is a plain rollback-mode file the moment it is
   written, whatever the live store's mode is. An archived snapshot on read-only media opens.
2. *Does `verifyCopy` convert it afterwards?* **No.** F1 makes WAL conversion opt-in
   (`openDb(path, { wal: true })`, default false, and its own comment names `vacuumInto`'s source
   as a caller that must not convert); `verifyCopy` calls `openDb(db)` with no options. Measured
   on this head: the copy's header stays `1, 1` after being opened and closed, and after three
   consecutive verifications the copy directory still holds no `-wal`, `-shm` or `-journal`.

Nothing asserts either fact in a test, so both are one edit away from silently becoming false —
see NIT-5.

**Count, this pass: 0 BLOCKER · 1 MAJOR · 6 MINOR · 5 NIT.**

---

## 1. The four MAJORs — all closed, all proved

### MAJOR-1 (guard order) — CLOSED

`assertRotatableDir` now calls `refuse(dir)` on the path as written and then
`refuse(realpathDeep(dir))` on the path it resolves to. Proved with the injected stand-in:

```
1a guard was called with: [ "<tmp>/linked", "<tmp>/elsewhere" ]     ← link first, then its target
```

and a stand-in that refuses only the **target** throws before anything else runs, leaving a stale
`.partial-…` in that target untouched:

```
assertRotatableDir(dir, link, p => { if (p === realpath(target)) throw … })  → THROWS
victim .partial- still present: true
```

and a path forbidden by **name** is still refused on the first call, with only that one spelling
seen. The injected `refuse` parameter is the right answer to the untestability I reported: it is
defaulted to `assertSafeDataDir`, never passed in production, and I confirmed there are exactly
two call sites (`snapshots.ts:368` in `runSnapshot`, `:607` in `mirrorTo`) and both use the
default.

**Is `cleanPartials` reachable on a directory that has not passed the guard? No, on every path.**
In `runSnapshot`, `assertRotatableDir` is the statement immediately before `cleanPartials`, inside
a `try` whose `catch` returns; the sweep only ever sees the guard's return value. In `mirrorTo`,
the order is `assertRotatableDir` → `assertSafeTarget(store.dir, join(target, name))` → sweep, so
the mirror is checked twice before it sweeps. Neither function is called anywhere else in the
repository. Read, and consistent with the probe above.

### MAJOR-2 (a `keep` typo stops memory) — CLOSED

Proved on every value I could think of. All return `ok: true`, keep `dataDir`, set no `observer`,
fall back, and name what happened:

```
keep = 0     → ["\"snapshots.keep\" was 0; using 14"]
keep = -1    → ["\"snapshots.keep\" was -1; using 14"]
keep = 1.5   → ["\"snapshots.keep\" was 1.5; using 14"]
keep = "14"  → ["\"snapshots.keep\" was \"14\"; using 14"]
keep = null  → ["\"snapshots.keep\" was null; using 14"]
snapshots = 42 / "nope" / []  → ["\"snapshots\" was not an object; the whole block was ignored"]
{dir: 7}     → ["\"snapshots.dir\" was not a path; using the default location"]
{dir: ""}    → ["\"snapshots.dir\" was blank; using the default location"]        ← MINOR-4 too
{dir: "relative/path"} → ["…must be an absolute path; using the default location"] ← MINOR-3 too
{mirrors: "/x"}        → ["\"snapshots.mirrors\" is not a setting this reads"]
```

and **strictness outside the block is untouched** — `{ owner: "yes" }` still returns
`{observer: true}, ok: false`. Proved. Doctor turns any non-empty `ignored` amber and prints it
(proved in MINOR-4 below). The unknown-sub-key report is a genuine improvement over the old
"silently dropped": a typo'd `"mirrors"` no longer lets somebody believe they have a second copy.

### MAJOR-3 (doctor never looked at the disk) — CLOSED

Proved with the same scenario that read green last time:

```
with copies present:      green | last snapshot 2026-09-18, 1 kept, oldest 2026-09-18
                                  data: {onDisk:1, newest:…, oldest:…, readable:true, future:0}
after deleting the dir:   amber | the snapshots directory is missing or unreadable — but a
                                  snapshot.taken row says one was made on 2026-09-18. There is
                                  nothing to restore from.
after emptying the dir:   amber | the snapshots directory is empty — but a snapshot.taken row …
fix on both:              "To restore: stop every session, copy a snapshot directory to …"
```

Missing and empty are kept apart, as claimed. `kept`, `newest` and `oldest` now come from the
directory listing; the row is used only to detect disagreement (`rowDated > newestDate`). Reading
a directory writes nothing, so the line stays observer-safe.

### MAJOR-4 (no restore procedure) — CLOSED

`RESTORE_STEPS` is exported from `doctor.ts`, names the three steps and the embed-key caveat, and
is the `fix` on the "nothing to restore from" arm (proved). **CONTRACT G24 carries the long form**
(`src/adapters/claude-code/CONTRACT.md:410-425`), and it is better than what I asked for: it says
to stop every session, to **move the damaged store aside rather than delete it**, gives the
literal `cp -R` and `counterparts verify --rebuild` lines, lists what comes back with the copy,
and states plainly that **"until the rebuild, `search()` returns nothing"** — the exact fact my
probe found and the thing a person in a panic needs on the page. The restore probe is now a real
test in `test/snapshots.test.ts`. Re-proved independently here:

```
restored copy → read(id).doc.title = "The lemon tree by the back door"
search("lemon") before rebuild: []      after rebuildCache(): [{id:…, score:1.33}]
```

One small overstatement, no more (NIT-1): RESTORE_STEPS is not on *every* non-green arm — the
"no snapshot has ever been taken here" and "stale" ambers keep their own, better-targeted
remedies, which is the right call.

### The MINORs taken — spot-checked, all good

- **MINOR-1** (aborts burning the day) — proved fixed: three `AbortSignal.abort()` runs, then a
  healthy fourth → `taken`. The abort row is `step: "aborted"` and the counter now counts only
  `copy` / `rename` / `verify`.
- **MINOR-2** — a saturated attempt window now writes a deduped `snapshot.failed` row with
  `reason: "attempt-window-unreadable"`. The permanent silent stop is gone.
- **MINOR-3 / MINOR-4** — relative and blank paths named and defaulted (proved above).
- **MINOR-5** — future-dated copies counted rather than deleted (see §4).
- **MINOR-6** — proved fixed: `runSnapshot` with an observer counterpart returns
  `reason: "observer"` and **the snapshots directory is not created at all**.
- **MINOR-7** — proved fixed in both directions: `.partial-my-own-thing` now survives the sweep
  (`cleanPartials` returned 0), and the LAYOUT rule is in place — which is where MAJOR-A comes
  from.
- **MINOR-9** — `verifyCopy` is in, before the rename, and catches all four bad shapes:
  `"the copy landed no files at all"` · `"the copy holds no operational.sqlite"` ·
  `"the copy's operational.sqlite is empty"` · `"the copy's database would not open: file is not
  a database"`. Proved.
- **N-1 / N-2 / N-3** — the CONTRACT/NOTES claim about the kill is corrected, the name's date is
  pinned to the run's date (§5), and the homedir limitation is written down.
- **MINOR-8** (disk cost unreported) and the TOCTOU note — not taken, as stated. Both are fine to
  leave; MINOR-8 is now partly answered anyway, because doctor counts the directory.

---

## 2. MAJOR — the new code that decides what may be deleted

### MAJOR-A — a snapshot the LAYOUT rule does not recognise is invisible to everything, forever, and nothing says so

`src/adapters/snapshots.ts:696-745` (`readSnapshotsDir` → `looksCopied`)

The new rule is right in spirit: a rotation candidate must hold at least one top-level entry the
store's `LAYOUT` classifies, so "a directory this package wrote" replaces "a directory whose name
looks like one". But a candidate it rejects is not skipped for deletion only — it is dropped from
the return value, so it is invisible to `rotate`, to `todaysSnapshot`, to `kept`, to `oldest`, to
doctor's `onDisk`, and to every row. Nothing counts it. Nothing names it. It can never be deleted
again by anything but a person with `rm`.

**Failure scenario, PROVED.** Twenty directories in the snapshots directory, all correctly named;
fourteen hold `operational.sqlite`, six hold only names the layout does not classify — which is
what a copy taken on an **older floor** looks like after the layout changes:

```
rotate(dir, keep=14, …)  →  deleted: []   kept: 14   errors: []
the directory still holds 20 entries
JSON.stringify(report) does not contain the string "2026-08" anywhere
```

Fourteen are managed; six are permanent, uncounted, unreported residue.

**First, the case that is NOT a problem**, because the coordinator asked it directly: a real copy
of a store whose backup set is only the database is always recognised. The database is a `prefix`
entry in `LAYOUT`, `vacuumInto` always writes it, and `snapshot()` cannot produce a copy without
it — proved (`snapshotNamesIn` found a real copy holding exactly
`["versions", "operational.sqlite", "prose"]`, and it would have matched on the database alone).

**And the F5 case is probably fine too.** The plan says the new floor "collapses to the database,
`spans/` and `journal/`" (§1.4), and the owner's snapshots hold `spans/`, so pre-F5 copies would
most likely still be recognised through `spans/` — and through the database itself if F5's rename
keeps a `prefix` entry that an old `operational.sqlite` no longer matches. I have not read F5's
actual `LAYOUT`, so that is unverified rather than safe; it is a thing for whoever writes F5 to
check, not a reason to hold this PR.

**The finding's weight is the silence, not F5.** `looksCopied` reads `LAYOUT` at runtime, so the
delete rule can change underneath existing copies at any floor change, and when it does, nothing
anywhere says so: no count, no error, no row, no doctor line. A smaller trigger needs no floor
change at all — a copy somebody partly cleaned out, or one whose listing fails, proved separately:

```
a snapshot directory holding only "something-else" → readSnapshotsDir → {names: [], readable: true}
```

This is the same defect the module exists to remove, one level down: "a candidate rejected" and
"a directory with nothing in it" are the same silence. New code in the one decision that deletes
should not be able to stop deleting without saying so.

**Smallest fix** (about five lines, no behaviour change): count the rejections.
`readSnapshotsDir` returns `{ names, readable, unrecognised }`; `RotationReport` carries
`unrecognised`; it rides on the `snapshot.taken` row beside `kept`; doctor appends
"; N directories here are not recognised as copies" and goes amber when it is non-zero. Then the
rule is still as strict, and it is visible. (If the builder would rather be safe on the floor
change specifically, the alternative is to recognise a directory that holds *any* entry LAYOUT
has **ever** classified — but the counted-and-reported version is smaller and does not need a
history.)

**One thing the rule does get right:** rotation and "today's exists" share the single definition
(`todaysSnapshot` calls `snapshotNamesIn` calls `readSnapshotsDir`), so they cannot disagree.
Proved: a rejected candidate named `<today>T09-00-00-000Z` is null to `todaysSnapshot` and absent
from `snapshotNamesIn` in the same breath.

---

## 3. MINOR

### MINOR-a — a run `date` that is not a calendar date produces a name that matches neither pattern

`snapshots.ts:414` builds the name as `` `${date}T${snapshotName(now).slice(11)}` `` from an
unvalidated `date`. Both of the module's load-bearing regexes then fail on it. PROVED:

```
runSnapshot({ date: "not-a-date" })  → reason: "taken", name: "not-a-dateT12-00-00-000Z"
  matches SNAPSHOT_NAME_RE? false        snapshotNamesIn sees: []        todaysSnapshot: null
  its partial ".partial-not-a-dateT12-00-00-000Z-<pid>" matches PARTIAL_NAME_RE? false
```

So: a full copy every single boundary (because "today's exists" can never be true), none of them
ever rotated, and any partial it leaves never swept — unbounded disk growth from one bad string.

**Not reachable today.** I checked every caller: `runOnce`'s `main()` passes only
`{config, signal, session?, scope?}`, and `today` falls back to
`new Date().toISOString().slice(0,10)`. It becomes reachable the day anyone adds a `--date` flag
to the worker, which this project already has elsewhere. **Fix:** one line at the top of
`runSnapshot` — if `date` does not match `/^\d{4}-\d{2}-\d{2}$/`, use `dateOf(now)`.

### MINOR-b — the MIRROR copy is never verified

`mirrorTo` (`:586-620`) does `cpSync` then `renameSync` with no `verifyCopy` between them. Every
argument in MINOR-9's fix applies to it: a `cpSync` that fails halfway throws and is cleaned up,
but one that returns successfully having written a truncated tree (a filling disk on the mirror
volume is the obvious case) is renamed into place, counted toward the mirror's own `keep`, and
rotates a good copy out of the mirror on day 15. The mirror is the copy you reach for when the
primary is gone. Read from code, not probed. **Fix:** call `verifyCopy(partial, 1)` before the
mirror's rename, exactly as the primary does.

### MINOR-c — `verifyCopy`'s `finally` can still throw out of `runSnapshot`

`verifyCopy` returns from inside `try`, and `finally { handle?.close(); }` runs after. A throwing
`close()` replaces the return and propagates: `verifyCopy` → `copyInto` (the call at `:527` is not
wrapped) → out of `runSnapshot`. `runner.ts`'s own `try` in the `finally` catches it, so the
worker is safe, but "it never throws" remains belt-and-braces rather than structural, and the new
code adds a fresh SQLite handle on that path. **Fix:** wrap the `close()` in its own try, or wrap
the `verifyCopy` call at `:527`.

### MINOR-d — `ignored` is unbounded, and the unknown-key branch interpolates the key name raw

The value branches are safe: `dir`/`mirror` never echo the value, and the `keep` branch uses
`JSON.stringify`, which escapes control characters (proved: `keep: "[2J"` produced
`"snapshots.keep" was "[2J"; using 14`, **no raw ESC**). The unknown-key branch is not:

```
{ "[2J[Hmirror": "/x" }
  → "\"snapshots.[2J[Hmirror\" is not a setting this reads"   ← raw ESC
  → doctor detail contains a raw ESC: true                                ← proved end to end
```

so a config key carrying ANSI escapes writes them into the owner's terminal when he runs
`counterparts doctor`. Low severity — it is his own file — but it is unescaped input reaching a
terminal and the fix is a one-liner. Length and count are unbounded too, on all branches:

```
keep: "q".repeat(200_000)      → one ignored line of 200,033 characters
2000 unknown sub-keys           → 2000 lines, 92,888 characters, all joined into one detail string
```

**Fix:** strip `[\x00-\x1f\x7f]` from the interpolated key, cap each line to ~120 characters, and
cap the list to the first three with "and N more".

### MINOR-e — `mirror` inside `dir` is allowed, and `mirror === dir` fails with a raw errno

PROVED:

```
mirror = <snapshots>/offsite  → reason: taken, mirror ok: true
  outer: ["2026-09-18T12-00-00-000Z", "offsite"]   inner: ["2026-09-18T12-00-00-000Z"]
mirror = <snapshots>          → mirror ok: false,
  why: "ENOTEMPTY: directory not empty, rename '…/.partial-…' -> '…/2026-09-18T12-00-00-000Z'"
```

The first is the worse one: the "second location" is a subdirectory of the first, so both copies
die with the same disk, and local storage silently doubles. The outer rotation ignores `offsite`
(its name does not match), so nothing ever says there are two trees. The second is safe but the
message is an errno where a sentence belongs. **Fix:** in `mirrorTo`, refuse a mirror that is
equal to, inside, or containing `dir`, with the same phrasing style as the other refusals.

### MINOR-f — doctor and rotation disagree about what "future" means

`rotate` calls `futureNamesIn(remaining, now)` with the live clock; doctor calls it with
`Date.parse(input.today + "T00:00:00Z")`. The cutoff is `now + 1 day`, so the two differ by up to
a day. PROVED on a copy named `2026-09-19T08-00-00-000Z` with today = 2026-09-18:

```
rotate-style (now = today 12:00): []           ← not future
doctor-style (now = today 00:00): ["2026-09-19T08-00-00-000Z"]  ← future
```

So doctor can go amber saying "1 dated in the future, holding a slot each" while the
`snapshot.rotated` row for the same directory says `future: 0`. Cosmetic, but the two surfaces
are supposed to agree (constitution 16). **Fix:** pass the same reference instant, or compare
dates rather than instants.

---

## 4. The specific questions, answered

**Can the new LAYOUT rule make rotation skip real snapshots forever, and is a skipped candidate
reported anywhere?** Yes and no, respectively — MAJOR-A, proved.

**Can a real partial now fail `PARTIAL_NAME_RE` and never be swept?** Yes, via MINOR-a's bad
`date` (proved), and not otherwise: the partial is built as
`` `${PARTIAL_PREFIX}${name}-${process.pid}` `` and `process.pid` is always digits, so with a
well-formed date the shape always matches. One other never-swept case, unchanged from before and
now sharper: a partial whose **mtime is in the future** makes `now - mtimeMs` negative, which is
always `< PARTIAL_STALE_MS`, so it is kept forever (NIT-2).

**Do "today's exists" and rotation share one definition?** Yes — `todaysSnapshot` →
`snapshotNamesIn` → `readSnapshotsDir`. They cannot disagree. Proved.

**`verifyCopy`: sidecars, journal mode, cost, throwing.**

- *Sidecars:* none. After three consecutive verifications the copy still held exactly
  `["versions", "operational.sqlite", "prose"]` — no `-wal`, `-shm` or `-journal`. Proved.
- *Journal mode:* the copy is rollback-mode when written and stays that way. Header bytes 18/19
  read `1, 1` (WAL would be `2, 2`) both straight out of `VACUUM INTO` — **including when the
  source is in WAL**, measured directly — and again after `verifyCopy` has opened and closed it.
  Proved on both halves; see the deploy paragraph at the top and NIT-5.
- *Cost:* on a 1.79 MB copy, `verifyCopy` took **4 ms, then 3 ms, then 3 ms** on repeat. Whole
  `runSnapshot` on a 9,001-file store was 1,375 ms. `quick_check` is linear in pages, so a 7 MB
  database is on the order of 15 ms — about 0.005% of the 300 s watchdog. No concern at all.
- *Throwing:* it does not throw for any bad input I gave it (no files, no database, empty
  database, junk bytes — all returned sentences). The one escape is the `finally` — MINOR-c.

**MINOR-5's choice — is `keep` still enforced over the real ones, and can a future-dated copy make
"today's exists" true for a day with no copy?** Enforced, and no. Proved: one `2099-…` directory
plus fourteen real ones with `keep: 14` still deleted the oldest real one and reported
`future: 1`. And `todaysSnapshot` matches on a date prefix, so a copy dated 2099 can never answer
for today. The accepted cost — a skewed name permanently occupying one of the fourteen slots — is
now counted and printed rather than silent, which is what I asked for.

**N-2's fix — collision, sort order, pattern.** All clean. Proved:

```
runSnapshot({ now: 2026-09-19T00:00:05Z, date: "2026-09-18" })
  → name "2026-09-18T00-00-05-000Z", matches SNAPSHOT_NAME_RE, todaysSnapshot finds it
  → sorts after yesterday's late copy: ["2026-09-17T23-58-00-000Z", "2026-09-18T00-00-05-000Z"]
two runs, same date, now and now+1ms  →  the second is "already-today"
```

Two copies can only collide on an identical millisecond *and* an identical date, and the
already-today gate closes long before that. Sorting is by date first and there is at most one copy
per date, so the time component being taken from the new day is cosmetic only (NIT-3).

**The lenient block's text, and `mirror` against `dir`.** MINOR-d and MINOR-e.

---

## 5. NIT

- **NIT-1.** `RESTORE_STEPS` is the remedy on the "nothing to restore from" arm and on the
  non-stale amber arms, not on *every* non-green arm — the "never taken a snapshot" and "stale"
  arms keep their own remedies, which is correct. Only the PR's summary sentence overstates it.
- **NIT-2.** A partial with a future mtime is never swept (`now - mtimeMs` is negative, which is
  always below the staleness bound). Same clock-skew family as MINOR-5; one `Math.abs` away.
- **NIT-3.** A midnight-straddling copy is named with the old day's date and the new day's
  time-of-day — `2026-09-18T00-00-05-000Z` for a copy taken at `2026-09-19T00:00:05`. Harmless
  (sorting is by date, one per date) but somebody reading the directory will be briefly confused;
  a comment beside the name construction would settle it.
- **NIT-4.** `config.ts` now imports `DEFAULT_KEEP` from `../snapshots.js`, which pulls
  `cli/snapshot.js`, `core/store/db.js` and `core/store/index.js` into every config load. No cycle
  (nothing in `snapshots.ts` reaches back into `claude-code/config.ts`) and typecheck is clean,
  but it is a wider import graph for one integer.
- **NIT-5.** **The one cross-PR coupling to write down.** Two facts keep snapshots openable on
  read-only media, and both are measured rather than asserted: `VACUUM INTO` writes a
  rollback-mode file even from a WAL source, and `verifyCopy` does not convert it because F1 made
  conversion opt-in and `verifyCopy` calls `openDb(db)` with no options. If anyone ever adds
  `{ wal: true }` to that call — or makes conversion the default again — every snapshot would be
  converted at verification time, and a WAL-mode database cannot be opened on read-only media,
  which is exactly where archived backups end up. One test asserting the copy's header bytes (or
  `journalModeOf(copy)` once F1 exports it) pins both forever and costs three lines.

---

## 6. What still stands from the first review, untaken and fine

- **MINOR-8** (the disk cost is never reported in bytes) — not taken, and less pressing now that
  doctor counts the directory. Worth a byte total on the line one day.
- **TOCTOU** (a symlink swapped between the listing and the delete) — not taken, correctly. Single
  user, local machine, a microsecond window inside one synchronous pass.

---

## Verdict

**Safe to merge after MAJOR-A** — make the LAYOUT rule's rejections counted and reported, so the
one mechanism in this package that deletes cannot silently stop deleting. It is about five lines
and no behaviour change. MINOR-a (validate the run's `date`) and MINOR-b (verify the mirror's
copy) are each a one- or two-line edit and I would take them in the same commit; the rest can
follow.

**Deploy:** yes, safe on the live store once WAL (#137) is live, and now proved rather than
argued — `VACUUM INTO` writes a rollback-mode copy even from a WAL source (measured directly), no
sidecars appear beside it, `verifyCopy` does not convert it, `quick_check` costs single-digit
milliseconds, and the whole step is well under 1% of the watchdog. Pin it with NIT-5's three-line
test so a later edit cannot quietly undo it.

This is a good round. Every MAJOR I raised was answered at the mechanism rather than at the
symptom, and two of the answers (the injected `refuse`, and doctor counting the directory instead
of trusting a row) are better than what I asked for.

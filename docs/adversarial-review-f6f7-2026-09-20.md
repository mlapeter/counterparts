# Adversarial review — PR #154, "F6 + F7: the journal's markdown copy, and export"

Reviewed at `389c281`, against `git diff origin/master...HEAD` (merge-base `3f6a6eb`; E2
and S2 are master's and were not reviewed). Reviewer: an adversarial session with no hand
in the build. Everything under **I RAN THIS** was executed in this worktree against temp
stores created by `mkdtemp`; everything under **I READ THIS** is a reading of the code and
is labelled as such.

---

## VERDICT: **MERGE AFTER FIXES**

The shape is right and the honest parts are genuinely honest — `--markdown --passphrase`
leaves no plaintext anywhere (measured), a faulted row is named rather than written as an
empty file (measured), an observer export writes nothing durable (fingerprinted), and the
`journal echo` sentence, *when it fires*, is exactly the disclosure judgment call 2 claims.

But three of the four questions this PR exists to answer — is anything **leaked**, **left
behind**, or **lost** — come back with a measured "yes" on at least one path:

- **leaked**: the journal writer will follow a symlinked directory and write the owner's
  chapters to a file **outside the store** (MAJOR-1); and an export target reached through
  a symlink lands **inside the store** (MAJOR-4).
- **left behind**: the "words may still be in `journal/`" disclosure is best-effort and
  goes **silent** on a store with more than twenty close matches, while the report prints
  `journal(0, nothing beside the row)` and `unchased: nothing` (MAJOR-3); and nothing
  anywhere says that every rotating snapshot now holds the removed episode's words as
  **plain greppable markdown** (MAJOR-5).
- **lost** (the log rather than the memories): a `journal/` that cannot be written appends
  **25 `journal.copy.failed` rows per worker cycle, for ever**, undeduped, and starves the
  backfill behind them (MAJOR-2).

None of these is a data-destruction bug in the ordinary path. All five are the kind of
thing this floor's reviews exist to catch, and four have small fixes.

**Which fixes gate the merge.** MAJOR-1, MAJOR-2 and MAJOR-3 should land before merge:
each makes a sentence the PR itself asserts false (the module owns one directory *inside*
the store; a failure "is a durable row", singular; the chase's honesty). MAJOR-4 is a
pre-existing guard shared with `backup` and MAJOR-5 is a print statement — both can ride a
following PR if the owner prefers, provided they are written down as open when this merges.

---

# BLOCKER

None. Nothing here loses a memory that the database still holds, and nothing writes
plaintext where a `--passphrase` was given.

---

# MAJOR

## MAJOR-1 — the journal writer follows a symlinked directory OUT of the store, and the removal chase deletes outside it

`journalFiles()` walks with `statSync(full).isDirectory()`, which **follows symlinks**, and
every arm downstream (`writeFileSync`/`renameSync` in `syncJournalCopy`, `rmSync` in its
removal arm, `rmSync` in `sweepJournalTemps`) resolves the same path through the link. So a
symlink anywhere under `<store>/journal/` turns the whole module into a writer and a
deleter outside the store it is supposed to own. `assertLayout()` classifies the top-level
name `journal` and never looks inside it.

This is not only an attacker story. `journal/` is the one directory in the store the owner
is *invited* to treat as files — "a copy you can open in any editor" — so pointing a year
at an external disk, a synced folder or Obsidian's vault is exactly the thing a person does
with it.

**I RAN THIS** (`test/zz-probe-f6f7.test.ts`, P2): write a chapter, replace
`journal/2026` with a symlink to a directory outside the store, write a second chapter;
then tombstone the episode and call `syncJournalCopy` with a planted file of a matching
name sitting outside.

```
P2 write: files outside the store under …/counterparts-probeout-Eiq0sx/away:
          ["2026-09-20-epi_015a7d5ec030.md"]
P2 write: content = ---
id: epi_015a7d5ec030
type: episode
learned: 2026-09-20
bornDay: 0
payload: {"id":"epi_015a7d5ec030","type":"episode"…
P2 delete: outcome=removed; victim outside the store still exists = false
```

The chapter's words landed outside the store, and the removal ceremony deleted a file
outside the store — reporting `chased: journal(1 markdown copy)` for it.

**Smallest fix.** In `journalFiles`'s `walk`, use `lstatSync` and skip anything that is a
symlink (`isSymbolicLink()`), and in `syncJournalCopy` refuse when `lstatSync(target)` or
any ancestor under `journalDir` is a link — returning `failed` with a new reason code
(`journal-symlink`) rather than writing. Both are inside the "never throws" contract
already. Four lines, and it makes "this module owns one directory inside the store and
nothing else" true rather than intended.

---

## MAJOR-2 — `journal.copy.failed` is not deduped: 25 rows per worker cycle, for ever

`noteJournalCopy` appends a durable row on every `failed` outcome with no memo of what it
already said, and `journalBackfillTargets` selects "episodes with no file" — so an episode
whose copy cannot be written is selected again on the *next* pass, and the next, for ever.
The brief asks for the opposite in so many words: *"A copy failure leaves a durable
`journal.copy.failed` row, deduped (a permanently unwritable dir must not write a row per
chapter for ever)."*

The same root cause has a second symptom: the failing ids sit at the head of
`store.list({type:"episode"})` and consume the whole 25-slot budget on every pass, so
nothing behind them is ever backfilled. Starvation is **reasoned, not measured** (my probe
made every episode fail); the row flood is measured.

**I RAN THIS** (P1): a `Store` with a *file* where `journal/` must be — the builder's own
fixture for this case — five chapters, then thirty episodes and three `Self.boundary()`
passes (the detached worker's door), counting rows straight out of `events`.

```
P1: failed rows after 5 chapters = 5; after 3 boundaries = 80
```

Five chapters → five rows. Three worker cycles → seventy-five more, 25 per cycle, and it
does not stop: on the owner's cadence that is thousands of rows a week in the log that
`fired`, the dashboard and `doctor` all read, all saying the same thing. The doctor line
is correctly silent-until-standing, which makes the flood invisible while it happens.

**Smallest fix.** Two changes, either of which alone helps: (a) in `noteJournalCopy`, skip
the append when the newest `journal.copy.failed` for the same `ref` carries the same
`reason` and no `journal.copy.written` has landed for it since — the same "a fixed fault is
not a line" test `journalCopyFindings` already implements; (b) in `journalBackfillTargets`,
keep the failing ids out of the next pass's budget (a per-process `Set` of ids that
returned `failed`/`absent`, or a `LIMIT … OFFSET` that moves).

---

## MAJOR-3 — the "journal echo" disclosure is best-effort, and goes silent exactly when a store is big

Judgment call 2 is defensible: a chapter that quotes a removed memory's words is the
counterpart's own account of a day, and chasing it destroys material nobody named. What
makes it safe is the disclosure — and the disclosure is computed from
`contamination`, which is `store.search(body, 20)`: a ranked, **top-20** full-text search.
An episode that does not make the top twenty produces no `journal echo:` line at all, and
the report then reads as if the surface were empty.

**I RAN THIS** (P8b): one chapter quoting `ZQECHOSILENT`, one memory with the same
sentence, then twenty-five near-identical memories (the ordinary shape of a store that has
thought about one subject for a while).

```
P8b journal echo present = false
P8b surfaces line:   chase journal: 0
P8b the markdown copy still holds the words = true
```

And for contrast, the same removal at small scale (P8, the `--confirm` run) — which is the
good case, and it is genuinely good:

```
  chase journal: 0
  LEFT on purpose — journal echo: 1 episode whose chapters quote these words
      (epi_e2388dc53cea) — the counterpart's own account of those days, not this memory.
      Left on purpose, row and markdown copy alike. Remove one by its own id if that is
      what you want.
  …
  chased: …, journal(0, nothing beside the row), …
  unchased (dark via the deny-list, never silently dropped): nothing
```

In the silent case the owner sees `chase journal: 0`, `journal(0, nothing beside the row)`
and `unchased: nothing`, and a plain `.md` file under his store still holds the sentence he
just removed. That is F5 review-B MAJOR-1's shape one directory over, and the *only* thing
standing between this PR and that finding is an FTS rank.

Two further notes, both read rather than run:

- the sentence says *"Remove one by its own id if that is what you want"* but does not give
  the **command** (`counterparts remove <episodeId> --confirm`), which the brief asks for
  by name.
- `chased: journal(0, nothing beside the row)` is printed for a memory that never could
  have had a journal file of its own. "Nothing beside the row" is true and reads as "this
  surface is clean", which is the opposite of what the `leftAlone` line says two lines
  down. The two lines should not be able to disagree.

**Smallest fix.** Do not make the disclosure depend on a ranked search: when
`body.trim()` is non-empty, ask the store for episodes containing the body's span hash or
run the same search **restricted to `type = 'episode'`** so the twenty slots are not spent
on memories. Failing that, say out loud in the `journal` surface line that the echo check
is a bounded search and may miss — a stated bound is survivable, a silent one is not.

---

## MAJOR-4 — `assertSafeTarget` does not resolve symlinks: an export lands inside the store

`assertSafeTarget` compares `resolve(target)` against `resolve(store.dir)`. `resolve()`
normalises `..` but does **not** read the filesystem, so a target path that passes through
a symlink into the store is judged "outside" and written anyway. The guard is shared with
`backup` and predates this PR — but F7 is the change that makes `journal/` a directory with
machinery attached to its contents, and the PR body claims "refuses a target inside the
store" without that qualifier.

**I RAN THIS** (P12): `ln -s <store>/journal <outside>/lnk`, then
`export --out <outside>/lnk/sub --markdown --plaintext`.

```
P12 exit=0 out=Exported 3 files (1887 bytes) to …/counterparts-probeout-LYGbLx/lnk/sub
P12 store journal/ now holds: ["2026/2026-09-20-epi_b8a0ce9eea0a.md",
                               "sub/README.md",
                               "sub/journal/2026/2026-09-20-epi_b8a0ce9eea0a.md",
                               "sub/memories/fact/mem_824f554646e5.md"]
P12 store re-opens: yes
```

A whole export tree, memories and all, now lives inside `<store>/journal/`. Worse than
mess: `journalFileEpisodeId` matches on the **basename**, so
`journal/sub/journal/2026/2026-09-20-epi_….md` is now indistinguishable from a real copy —
`journalFilesFor` returns it, the next chapter append deletes it as a "stale" name, and
`journalBackfillTargets` counts its episode as already copied.

The literal cases *are* refused, which I checked: `--out <store>/journal` →
`refusing to write a copy inside the store it is copying: …/journal` (P11, exit 2), and
`--out <store>/../escape-probe` resolves outside and is correctly allowed (P4).

**Smallest fix.** In `assertSafeTarget`, resolve the target's nearest existing ancestor
with `realpathSync` before the two `isWithin` comparisons (the leaf itself usually does not
exist yet). One helper, and it fixes `backup` at the same time.

*Side note from the same probe set, and the reason this is MAJOR and not BLOCKER:* a
symlink whose destination does **not** exist is refused by accident — `mkdirSync(target,
{recursive:true})` throws `EEXIST` on a dangling link (P9, exit 2), which the console prints
raw as `EEXIST: file already exists, mkdir '…'` instead of a refusal sentence. A guard that
holds because of an `mkdir` errno is not a guard.

---

## MAJOR-5 — every snapshot now holds removed episodes' words as plain markdown, and nothing says so

`LAYOUT`'s `journal` entry is `backup: true`, and the builder's own test
(`test/cli.test.ts:533`, "F6: a snapshot carries the journal's markdown copies") proves a
snapshot copies the files byte for byte. So after `counterparts remove <episode>` the
words are gone from the live store — P13 below proves that half by byte grep — but every
rotating snapshot and every `backup` taken **before** the removal still holds them, and now
as a `.md` file that any `grep`, Spotlight index, Time Machine pass or Dropbox client can
read, rather than inside a SQLite file.

**I READ THIS.** I grepped `removal.ts` and `commands.ts` on this branch and on
`origin/master` for a sentence handed to the owner about older copies. The only one is
`SPANS_BLIND` — *"this removal did not reach it, and a later backup would copy it (export
would not)"* — which is about the spans buffer, is about *future* backups, and only prints
when the spans surface is unchasable. There is no line, on either branch, about snapshots
already taken. F6 does not create the gap but it changes its severity by a wide margin:
a database in an old snapshot is a file somebody must know to open; a markdown file in an
old snapshot is a search result.

Neither F5 review raised it. f5b's snapshot findings are about rotation deleting the
owner's pre-rows copies (MAJOR-2 there) and about restore steps; f5c's own
"could not determine" list ends with *"Whether the overflow residue reaches anything
outside the store directory… I did not measure a snapshot of a store in the residue
state."* So this is new ground, not an accepted gap being re-filed.

**Smallest fix.** One sentence appended to the removal's completion report whenever the
target was an episode (or whenever a journal echo was reported), naming the rotating
snapshot directory and saying that copies taken before today still hold the words as
markdown. This is a print statement, not a design change, and the machinery for saying it
(`chased`/`leftAlone`/`notes`) already exists.

---

# MINOR

## MINOR-1 — a confidential self page makes the manifest state something false

`collectMarkdown` skips confidential rows before `census.page` is set, so
`markdownReadme` prints the "no page" branch for a store that has one.

**I RAN THIS** (P5): a self page revised through `Self.revisePage`, then
`confidential = 1` set on its row; plus an open memory with a confidential earlier wording,
exported with `--markdown --plaintext --with-versions`.

```
P5 terminal: … 2 confidential rows were left out; pass --include-confidential …
P5 README self-page line: - `self-page.md` — absent: this store has no written self page.
P5 README omitted line:   - Confidential memories omitted: **2**. …
P5 page body leaked into the tree: false
```

Nothing leaked — the gate held on both the row and the divergent version path, which is the
fix this PR made and it works. But the manifest, which exists precisely so the directory
cannot read as complete six months later, asserts there is no page. **Fix:** compute
`page` from the row's type before the confidentiality `continue`, and print a third branch
("omitted as confidential").

## MINOR-2 — `omittedConfidential` mixes two units and undercounts

The version loop increments the same counter as the row loop
(`counts.omittedConfidential += 1`), and versions belonging to a *skipped* confidential row
are never reached at all. So an open memory with three confidential wordings reports 3
("3 confidential rows were left out") while a confidential memory with three wordings
reports 1 — four things omitted either way. P5 above shows the mixing: the count of 2 is
one page plus one version. **Fix:** two counters, and one sentence that names both.

## MINOR-3 — `--into-non-empty` overwrites existing files silently

The non-empty refusal (judgment call 3) is a good change. Its opt-out then writes the whole
bundle with `writeFileSync` and no existence check, and says nothing about what it replaced.

**I RAN THIS** (P7): a target holding `README.md` ("SOMEBODY ELSE'S README — irreplaceable.")
and `keepme.txt`.

```
P7 exit=0 out=Exported 2 files (1539 bytes) to …/existing
        Kind: markdown. Mode: plaintext. …
P7 README is now: # Counterparts export (markdown)
P7 keepme survived: true
```

Nothing is deleted, which is the right half. But the flag whose whole purpose is "I know
this directory has things in it" is the one place the report should say **which** of them
it replaced. **Fix:** count the bundle paths that already exist and append them to the
report line ("replaced N existing file(s): …").

## MINOR-4 — the refusal names a flag that does not exist

`export.ts:394`: *"`--include-confidential` and `--versions` are about the readable
tree…"*. The flag is `--with-versions`; judgment call 5 says so deliberately, and the
`ExportOptions.versions` doc comment repeats the wrong name. A refusal that tells the owner
to pass a flag the parser rejects is a second refusal. **Fix:** two strings.

## MINOR-5 — `export` now opens the store writable, and that is not in the PR body

`Store.open({ dir, observer: true })` became `Store.open({ dir, observer })`. The PR
discusses the `OWNER_OPS` removal at length and never says that the ordinary,
non-`--observer` export now opens the canonical database **for writing**. I fingerprinted
it and the effect is confined to what the durable row needs, so this is disclosure rather
than damage:

**I RAN THIS** (P3, sha256 of every file under the store before and after):

```
P3 observer export changed: ["cache/cache.sqlite-shm","counterparts.sqlite-shm"]
P3 observer terminal: … No store.export row was written: this console is in observer
    stance, and an instrument does not write to the store it is reading.
P3 owner export changed: ["counterparts.sqlite-shm","counterparts.sqlite-wal"]
```

Observer touches only the two `-shm` files, which `isDatabaseSidecar` declares skippable by
design; the owner's export additionally moves the `-wal`, which is the `store.export` row.
No file, no `journal/` write, no scratch. **What the owner should be told:** an instrument
in observer stance could not run `export` at all before and now can — it makes a full
readable or sealed copy of every memory, confidential ones included with one flag, and
writes no trace in the store. That is the egress question judgment call 1 names, and it is
his to rule on; the measurement says the implementation does what the PR claims.

**I RAN THIS** (P3b): with another connection holding `BEGIN IMMEDIATE` on the operational
database, `export --plaintext` still returned `exit=0` — no lock regression of the I38
shape. The `store.export` row's `catch {}` means a row lost to contention is silent, which
is a defensible choice but is one more way the "did anything leave" question can answer
"no" when the answer was "yes".

---

# NIT

1. `JOURNAL_STILL_THERE`'s sentence — *"journal/ — it is a derived copy, a backup would
   copy it, and deleting that file loses nothing"* — is only ever printed on the `failed`
   and `threw` arms. The `leftAlone` echo line, which is the one an owner will actually
   see, does not carry "a backup would copy it" at all (see MAJOR-5).
2. `journalFileEpisodeId` matches on the basename only, so any `.md` anywhere under
   `journal/` at any depth with a date-shaped prefix is treated as an episode copy. Benign
   today; it is what makes MAJOR-4's consequence worse than mess.
3. `syncJournalCopy`'s "a file this episode wore under a different date" loop swallows its
   `rmSync` failure entirely (`/* named below if it matters */`) — but nothing below names
   it, so two files for one episode is a state that can exist and be reported as `written`.

---

# Checked and clean

**I RAN THIS**

- **Suite and typecheck**, on this branch, as printed:
  `bun run typecheck` → `$ tsc --noEmit` and no output, exit 0.
  `bun test` → `2525 pass / 0 fail / 34547 expect() calls / Ran 2525 tests across 42 files. [68.61s]`
  — matching the PR body exactly.
- **`--markdown --passphrase` writes no plaintext, and no scratch** (P10, 200 memories):
  `P10 tree=["README.md","counterparts-export.cpx"] leak=[] scratch 0->0`. The target holds
  only the blob and the outer README; no byte of any body is readable in either; the count
  of `counterparts-export-*` directories in `$TMPDIR` did not move.
- **A faulted row is named, never written as an empty file** (P6): hand-made `body=''` with
  the original `content_hash` intact →
  `1 row could not be rendered and is NOT in this copy: mem_8202cb52af92`, exit 0, and the
  export tree contained `README.md` only — no id-named file at all.
- **Tombstoned rows are never exported**; confidential rows and confidential *versions* are
  both omitted and the divergent gate the builder found is genuinely closed (P5, zero leak
  across every file in the tree read as `latin1`).
- **The store's own `journal/` as a literal target is refused** (P11): exit 2,
  `refusing to write a copy inside the store it is copying: …/journal`.
- **A `..` target that resolves outside the store is allowed** (P4, `<store>/../escape-probe`,
  exit 0 — correct, that path is outside). A `..` that would resolve back *inside* was not
  tried; `resolve()` normalises before the comparison, which is a reading, and the literal
  inside-the-store case is refused (P11).
- **An observer export writes no file and no durable row**, and says so on the terminal
  (P3, fingerprinted; see MINOR-5).
- **The real removal ceremony on a WHOLE EPISODE is clean, byte for byte** (P13:
  `run(["remove", <episodeId>, "--confirm"])` through the console, then every file under
  the store read as `latin1`):

  ```
  P13 before: files holding the mark = ["counterparts.sqlite-wal",
                                        "journal/2026/2026-09-20-epi_0c532be6c5d0.md"]
  …
    chase journal: 1
    chased: …, journal(1 markdown copy), …
    unchased (dark via the deny-list, never silently dropped): nothing
  P13 after: files holding the mark = []
  P13 journal/ now: []
  ```

  The file is **deleted**, not blanked, and no stale filename survives — `journal/` is
  empty afterwards, so nothing of the episode remains in a name either. The surface is
  counted at 1 in the plan and named in the completion report.
- **A memory MINTED from an episode, removed, is reported honestly at ordinary scale**
  (P14): `chase journal: 0`, `journal(0, nothing beside the row)`, and the `LEFT on
  purpose — journal echo: 1 episode … (epi_27ec3b938d59)` line in both the plan and the
  completion report; the grep afterwards correctly still finds the mark in
  `counterparts.sqlite` and in `journal/2026/2026-09-20-epi_27ec3b938d59.md`, which is what
  judgment call 2 says will happen. (MAJOR-3 is about the case where that line does not
  appear.)
- **The `journal echo` line does fire, with the episode id and no body text, in both the
  dry run and the `--confirm` report**, at ordinary scale (P8 and P14; full transcript
  above under MAJOR-3).

**I READ THIS**

- **No test was weakened, skipped or deleted.** `git diff origin/master...HEAD -- test/`
  removes four import lines and nothing else; 25 tests added across 3 existing files, no
  `.skip`, no `.only`.
- **Filenames carry ids only.** `journalRelativePath` composes `<date>-<doc.id>.md` from
  `learnedOn` and `id`; no title, handle or session name reaches a path on any branch,
  including the `undated` one. `pathFor` in `export.ts` is the same discipline
  (`memories/<kind>/<id>.md`, `schemas/<id>.md`, `versions/<id>/<seq>.md`).
- **Nothing reads a journal file back.** No parser exists in `journal-file.ts`; the only
  readers are `readFileSync` for the idempotence check inside the writer itself and
  `journalFiles`' name walk. I grepped `src/` and `tools/` for `JOURNAL_DIR`,
  `journalDir(`, `journalFiles` and `journalRelativePath`. Outside the module itself the
  hits are `self/index.ts`, `cli/removal.ts`, `cli/export.ts` (for `journalRelativePath`
  only, which reads no file), `claude-code/doctor.ts` and `adapters/fired.ts` (both for the
  two event-name constants), plus `self/INTERFACE-GAPS.md`. `export --markdown` builds the journal tree from
  **rows**, which is the right call and is the reason a stale file cannot be exported as
  though it were live.
- **Error messages carry reason codes, not bodies.** `JournalCopyResult.reason` is a code
  (`write-failed`, `render-refused`, `unlink-failed`, `journal-unreadable`); `notRendered`
  carries ids; the durable rows carry counts and a store-relative path.
- **Registries are total and free of duplicates.** Three new event names, each appearing
  exactly once in `DurableEventName`, `registries.ts`'s blurbs, `flow.ts`'s node map and
  `narrate.ts`'s narrator and `REF_KIND` maps; `tsc --noEmit` is what enforces it and it
  passes.
- **A crashed rename leaves a `.tmp-<rand>` for at most an hour**, swept on an `mtime`
  bound for the same reason `export.ts`'s sweep is, and `journalFileEpisodeId` matches the
  temp form so a removal takes it too. Correct, and I did not find a way to make it
  accumulate.
- **`--include-confidential` / `--with-versions` without `--markdown`** are refused by name
  (modulo MINOR-4's wrong flag name in the sentence).

---

# What I could not determine

- **Peak memory on a 5,000-memory store** for `--markdown --passphrase`. I measured 200
  memories (clean, instant); I did not build the large store or take an RSS reading, so the
  builder's own open gap (judgment call 4, `cli/INTERFACE-GAPS.md` §12) stands unmeasured
  by me. The whole-tree-in-memory buffering is real and is what makes the plaintext
  guarantee true, so it is a trade rather than a defect.
- **SIGKILL mid-run**, on either export path. I reasoned from the code that the markdown
  arm has no window (nothing is written until the blob is sealed) and P10 supports it, but I
  did not kill a process to prove it.
- **The pre-rows (v5) refusal.** I read the code path (`Store.open` throws,
  `describeDirRefusal` prints F5's sentence, `EXIT.refused`, and the `mkdirSync` of the
  target sits after it so nothing is created) and the builder's test for it; I did not build
  a v5 store with `git archive floor/v5-last`.
- **Backfill starvation** (the second half of MAJOR-2) is reasoned from
  `journalBackfillTargets`' ordering, not measured — my fixture made every episode fail, so
  I could not separate "starved" from "all failing".
- **Two workers at once** on the same store, and the timing of 100 `chapter` appends with
  and without the copy. Not run; the copy is one whole-file rewrite of one episode per
  append, which is the cost the PR states.
- **An export target inside `~/.bansai` or `~/.claude-engram` under a fake `HOME`.** The
  builder has a test for it and `assertSafeDataDir` reads `homedir()` and resolves both
  sides, so the reading is that it holds; I did not run it, because MAJOR-4 says the guard
  it depends on does not resolve symlinks — **a symlink whose destination is inside
  `~/.bansai` is the case that most needs running, and I did not run it.** Assume it
  passes only after MAJOR-4 is fixed.
- **A worker killed with `SIGKILL` between the temp write and the rename** — whether the
  `.tmp-*` accumulates in practice. The sweep's mtime bound makes at most one per episode
  per hour, which I read but did not force.

---

## Housekeeping

Probes were written as `test/zz-probe-f6f7.test.ts` and `test/zz-probe-f6f7b.test.ts`
inside this worktree, each hermetic with its own `mkdtemp` store, and **deleted** after the
run; `git status` should show only this file. Temp directories created by this review used
the prefixes `counterparts-probe-`, `counterparts-probeb-` and `counterparts-probeout-` and
were removed by exact path. **Leftovers:** `find $TMPDIR -maxdepth 1 -name 'counterparts-*'
-newermt '-2 hours'` came back **empty** after the full suite and every probe — this
branch's own prefixes (`counterparts-export-`, `counterparts-cli-`, `counterparts-self-`,
`counterparts-fixture-`) left nothing. The 80-odd `counterparts-standdown-*` /
`counterparts-scope-*` / `counterparts-page-c-*` directories already in `$TMPDIR` all
predate this session by more than two hours and are other sessions' business. No
command in this review touched `~/.counterparts`, `~/.bansai`, `~/.claude-engram`,
`~/counterparts-backups` or the live checkout.

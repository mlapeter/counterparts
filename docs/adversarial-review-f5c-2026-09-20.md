# Adversarial review f5c — the CONFIRMATION pass on PR #148 "F5: the floor"

Head `5b2e040`; the fix pass is `20adaf6..5b2e040` (seven commits). This is the short third
pass: depth on the six MAJORs from `adversarial-review-f5a` / `-f5b`, not a third full
review. I did not fix, commit, push, merge or deploy anything.

Everything under **I ran this** was executed on this machine today against fresh temp
directories I made under `/tmp/f5c-…` (removed afterwards, by exact path) and a source
export of `40f92ae` (`floor/v5-last`) for the old build. `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`
in every shell. No live store was read, written or named.

---

## VERDICT: **MERGE AFTER FIXES**

All six MAJORs are closed, four of them cleanly and verifiably. I reproduced reviewer B's
`cache/cache.sqlite` residue that the builder could not (3 of 5 shapes with the fix
disabled, 0 of 5 with it enabled) — the fix is real and load-bearing.

**One new MAJOR.** The same chase that now clears box 3 still leaves a removed memory's
words in `counterparts.sqlite` **itself** — the canonical database — when the body is large
enough to take overflow pages, while the console prints `unchased … : nothing`. It is
deterministic (5/5), a second checkpoint does not clear it, and only `VACUUM` + a
checkpoint does. The PR body states the opposite conclusion in as many words ("*no, a
removed body does not survive in a freed page on this build — the checkpoint is sufficient
and no VACUUM is needed*") and ships a test that asserts it; the test passes only because
its marker word sits at the **start** of the body. This is the same class of finding
reviewer B ranked MAJOR one database over, and it is newly reachable because F5 is the
floor that put bodies in box 2.

A wording-only fix is acceptable if the arithmetic is not wanted (see the finding).
Nothing else I found is merge-blocking.

**Suite / typecheck, as printed:**

```
bun test  ->  2493 pass   0 fail   33610 expect() calls   42 files   [67.82s]
bun x tsc --noEmit  ->  exit 0, no output
```

No known load flake fired (`claude-code.test.ts` "sentinel search is LINEAR" and
`cli.test.ts` "CONVERTED BUT NOT COMPACTED" both passed on the one full run).

---

## The six findings

| # | finding | closed? | what I RAN, and saw |
|---|---|---|---|
| **A-1** | an old build touching a v6 store locks the new build out, and the remedy points back at the build that just failed | **YES** (two MINOR residues: NEW-MINOR-1, NEW-MINOR-2) | Built a v6 store (6 rows), fired **one real SessionStart through `40f92ae`'s own `bin/hook.ts`** → it stood down `LAYOUT_UNCLASSIFIED` and left `operational.sqlite{,-wal,-shm}`, empty `prose/`, `versions/`, `tmp/`, `sessions/` — reviewer A's shape exactly. The new build's `status`/`doctor` then printed the discriminating sentence naming all five leftovers and saying they are empty. I followed it **verbatim** (`rm` those names + `tmp/`) → `status` = **6 memories, exit 0**, `verify` exit 0, cache clean. **Twin:** a real v5 store built by the old build (3 memories, real prose files) with a hand-copied `counterparts.sqlite` beside it → *"DELETE NEITHER. Move one of them out…"*. Both branches correct. |
| **A-2** | a v5 db wearing the v6 name is stamped v6 and then nothing reads it | **YES** | Real v5 store, `prose/`+`versions/` removed, db and both sidecars renamed to `counterparts.sqlite*`. Fingerprinted every file (main, `-wal`, `-shm`) before/after. Writer open → `STORE_PRE_ROWS {reason:"no-body-column"}`, observer open → `STORE_UNINITIALIZED`; **`changed files: NONE (byte-identical)`** for both. `schemaVersion` still `5`, `memories` still has no `body`, 3 rows. `init` refuses and mints nothing. Renamed back + prose restored → **the old build opened it and listed its 3 rows**. |
| **B-1** | removed words left in `cache/cache.sqlite`'s log while the report says `unchased: nothing` | **YES for box 3** — **NEW MAJOR for box 2** | Took a scratch copy of this branch, reverted **only** the `checkpoint(paths.cache(dir), …)` line, ran the real ceremony (`run(["remove", id, "--confirm", …])` with a prompting `Io`) at 120/160/200/240/300 fillers: **residue in `cache/cache.sqlite` in 3 of 5** (offsets printed). Same five shapes on the branch: **0 of 5**, `cache/cache.sqlite-wal` = 0 bytes every time. `secure_delete` = 2, `page_size` 4096, `auto_vacuum` 0, measured on both databases. *I read this, I did not drive it:* the contended case is covered by the branch's own `a CONTENDED cache checkpoint is reported, never claimed` test (it holds a read transaction and asserts the printed `cache write-ahead log (a reader held it; the next checkpoint folds it in)`), which ran inside my suite run but which I did not reproduce by hand; I also did not check what the durable **removal record** says about an unchased surface. **But see NEW-MAJOR-1.** |
| **B-2** | rotation deletes the owner's real pre-rows snapshots after cut-over | **YES** | Seven fixtures through the real `rotate`/`readSnapshotsDir`: (1) 3 v5 **with `spans/`** + 14 v6, keep 14 → `deleted: []`, `preRows: [the 3]`, prose survives; (2) 30 v6 + 5 v5, keep 14 → **exactly 16 v6 deleted, 0 v5**; (3) keep 1 → still 0 v5; (5) a v6 copy with a `prose/` folder dropped in → treated pre-rows, kept (conservative, correct); (7) a future-dated v5 copy → kept and named. Doctor on a fixture with 3 v5 + 3 v6 copies: **`GREEN Snapshot … 3 older-format copies this build cannot open — kept, never rotated, read by the build tagged floor/v5-last: <names>`**. `RESTORE_STEPS` says what one is. |
| **B-3** | a faulted row stands every session down and nothing names it | **YES** | Hand-made `body='' + real hash` on (a) a schema row, (b) an ordinary memory, (c) the self-page row, (d) two rows at once; plus a **tombstone** (`body=''`, `content_hash=''`) in every fixture. `status` exit **3** and names every id; `verify` exit **3** and names every id with both exits; doctor `RED Store open … The row is sch_… Two ways out…`. The tombstone is **never** reported as a fault in any of the four. A healthy store: `status` exit 0, `verify` exit 0. **I followed the `remove` exit for real** — `counterparts remove <id> --confirm --dir <store>` returned exit 0 and **`Counterpart.open` then opened**, in all four fixtures. (This was the fix most likely to be a dead end; it is not.) |
| **B-4** | an interrupted `export --passphrase` leaves plaintext in the target | **YES** (one MINOR residue) | 6 000-memory store (2.9 MB db), a real child exporter with a controlled `TMPDIR`, **polled for the scratch and SIGKILLed the process once it passed 2 MB**. `TARGET after the kill: []` — nothing at all. The scratch is `$TMPDIR/counterparts-export-XXXXXX/scratch.sqlite`, directory mode **0700**. Two exports to the same target cannot collide: `sweepStaleScratch` only removes `.export-scratch-*` **in the target**, a name nothing writes any more, so it cannot touch another live export's `mkdtemp` directory — confirmed by running a second, completed export while the killed one's directory was on disk (it survived untouched). |

## The SHOULDs

| check | result |
|---|---|
| `verify --rebuild` refuses a pre-rows store before touching box 3 | **filename shape yes** (`cache/` byte-identical). **Shape-lock shape: it refuses, but box 3 moves first** — `shasum` of `cache/*` around one `verify --rebuild` on a renamed v5 database shows `cache.sqlite-shm` changed before the refusal arrived from box 2 → folded into NEW-MINOR-4 |
| `migrate-cache` refuses a pre-rows store before touching box 3 | **filename shape yes; shape-lock shape NO** → NEW-MINOR-4 |
| the MCP server refuses both shapes | **yes** — `serve.ts --config <cfg> --dir <store>` prints `server did not start: STORE_PRE_ROWS {…}` for the real v5 store *and* for the renamed one; every file byte-identical, no `sessions/` minted. It prints the bare code + JSON rather than the sentence (same family as NEW-MINOR-3) |
| a directory holding only `operational.sqlite-wal`/`-shm` refuses | **yes** — `status`, `verify`, `verify --rebuild`, `migrate-cache`, the hook all refuse; nothing minted |
| every console door's refusal is a human sentence | **yes for the filename shape** (`status`, `verify`, `verify --rebuild`, `migrate-cache`, `init`, `install`, `backup`, `doctor`, the hook). **No for the shape-lock shape** → NEW-MINOR-3 |
| whitespace-only / NUL bodies refused at `put`, `revise` | **yes** — `""`, `" "`, `" \t\n "`, `"\0"`, `"\0 \0"` all `PROSE_BODY_INVALID{reason:"empty"}` at both doors |
| `putMany` | **yes** — a whitespace item refuses the batch; with `{isolate: true}` the bad item is skipped and the good one commits (the documented shape) |
| a lone surrogate is NORMALISED | **yes** — stored as U+FFFD, memory kept, `hashText(row.body) === row.content_hash` |
| a truncated surrogate **pair** through the sweep's truncation is not dropped | **yes** — a body cut mid-pair is accepted, normalised, hash addresses the stored body |
| the `floor/v5-last` tag the refusals tell people to check out actually exists | **yes** — `git ls-remote --tags origin` → `refs/tags/floor/v5-last` → `40f92ae` |

## Regression sweep

- **Nothing in `git diff 20adaf6..5b2e040` is unexplained by a finding.** The one widening
  beyond the fix list is benign: `describeDirRefusal` replaced the raw
  `String(err.message)` at ~12 more console catch sites (`install`, `credentials`, `scope`,
  `doctor`, `backup`, `remove`, two backfills), which only ever adds a sentence.
- **No test weakened, skipped or deleted.** `git diff … -- test | grep -E '^-.*(expect|test\()'`
  returns five lines, each an assertion *replaced by a stronger one* in the same test
  (`unrecognised` → `unrecognised` + `preRows`; `found: "operational.sqlite"` → all markers;
  the doctor `fix:` string → the row-naming string). No `.skip`/`.todo`/`.failing` added.
- **`$TMPDIR`**: **0** `counterparts-export-*` directories after a full suite run (so the new
  SIGKILL test does not leak its plaintext scratch — though see NEW-NIT-4 for why). The
  standing 61 `counterparts-standdown-` and the `bansai-*`/`h1-lock-` prefixes pre-date this
  pass and belong to other sessions sharing the machine; I cannot give an honest global
  before/after either, for the same reason the builder could not.

---

# New findings

## NEW-MAJOR-1 — a removed body on overflow pages survives in a freed page of `counterparts.sqlite`, and the report says `unchased: nothing`

**I ran this.** The full, real removal ceremony on this branch, with the fix enabled:

```
200 filler memories, then one memory whose ~40 KB body carries the marker word
at the START and (after one revise) also at the END, then
  run(["remove", id, "--confirm", "--dir", store])  with a prompting Io

console:  chased: …, cache, write-ahead log, cache write-ahead log
          unchased (dark via the deny-list, never silently dropped): nothing

residue after removal: [{"file":"counterparts.sqlite","offsets":[290796],"size":290816}]
LIVE ROWS holding the word: none
page_size 4096   freelist_count 27   secure_delete 2   auto_vacuum 0
residue after VACUUM:                          [{"file":"counterparts.sqlite","offsets":[290796]}]
residue after a further TRUNCATE checkpoint:   []
```

5/5 deterministic (3 identical runs of one probe, 2 of another). The word is in the
**main canonical database file**, in a page no row points at, at offset 290796 of a
290816-byte file — the tail of the last page.

**And it is not exotic.** The branch's own test shape — `"…lazy dog. ".repeat(900)`, marker
first, 200 fillers **after** — is clean, which is why the test passes. Take that exact shape
and put the marker **at the end of the body too**:

```
[TESTSHAPE+trailingword] order=after fillers=200
   after removal: [{"file":"counterparts.sqlite","offsets":[217070]}]
   after VACUUM:  [{"file":"counterparts.sqlite","offsets":[217070]}]
```

So the passing assertion is a property of where the marker sits, not of the store.

**Why a second checkpoint is not enough.** I measured the two candidate remedies
separately on the same fixture:

```
after the ceremony:                ["counterparts.sqlite"]
after second-checkpoint:           ["counterparts.sqlite"]     <- no help
after vacuum-then-checkpoint:      []                          <- clean
```

The pages are on the **freelist**, and `secure_delete = 2` (FAST) zeroes only the slack of
a page being rewritten, never a whole freed page. The chase's own `wal_checkpoint(TRUNCATE)`
is what materialises those stale pages into the main file; nothing folds them again.
(Note the second line of the earlier block: a `VACUUM` *alone* also looks like a no-op,
because in WAL mode it writes into the log — the main file is unchanged until the next
checkpoint. Any fix must be VACUUM **then** checkpoint.)

**Why it is a MAJOR rather than a known gap.** On the old floor a body was a file, and
`rmSync` took it away; box 2 held only `prose_path` and `content_hash`. F5 is the floor that
put the words in box 2, so a freed page holding them is new with this PR — and this PR adds
CONTRACT §5 **G17** and the `chased/unchased` report that state the surface is closed. The
console tells the owner the directory is clean, and for a long memory it is not. That is
exactly the sentence reviewer B ranked MAJOR one database over.

**Smallest fix — pick one, and both are small.**
1. *Arithmetic:* end `chaseWriteAheadLog`'s box-2 pass with `VACUUM` followed by the
   TRUNCATE checkpoint, reported as its own surface and never thrown (a `VACUUM` of a
   17 000-row store is seconds and the removal's rows have already gone). Measured clean
   5/5 on the failing shape.
2. *Words only:* if the VACUUM is not wanted, then say so rather than claim it — the
   `write-ahead log` line becomes something like `write-ahead log (folded in; freed pages
   holding an overflow body are cleared by the next VACUUM)`, and G17 is narrowed to match.
   The one thing that must not stay is `unchased … : nothing` over this.

In either case the test needs a marker at the **end** of the big body, and the PR body's
"*no freed page holds it*" paragraph needs correcting.

*A third option I could not settle:* `PRAGMA secure_delete=ON` on the connection that blanks
the body would, on paper, zero the overflow pages as they are freed and cost nothing per
removal. I could not measure it — a bare-SQLite fixture (WAL, 40 KB overflow body, blanking
`UPDATE`, TRUNCATE checkpoint) left **no residue in either mode**, so the real mechanism
involves more than that single statement (the version row, the FTS shadow tables and the
cache rebuild all write in the same window). Worth the builder's five minutes before
reaching for a VACUUM; it also means "the checkpoint is sufficient" was never established
in the first place.

---

## MINOR

**NEW-MINOR-1 — the one sentence the owner actually sees still sends him to `floor/v5-last` in the lockout case.** *I ran this.* On the A-MAJOR-1 store (a v6 store with an old build's
empty leftovers), the hook's `systemMessage` — the channel H1 built precisely because
"*a hook's stderr goes nowhere the owner looks*" — reads:

```
Counterparts memory is OFF for this session: this store keeps its memories in files, which
this build does not read — it was written before the floor changed; the build that reads it
is the tag floor/v5-last (STORE_PRE_ROWS). Run: counterparts doctor
```

That is A-MAJOR-1's circle, in the visible channel: `floor/v5-last` is the build that has
just stood down on this same directory. The correct sentence is on **stderr** and in
`doctor`, so the owner is one documented step from the truth — which is why this is MINOR
and not MAJOR. `PLAIN_WORDS.STORE_PRE_ROWS` (`standdown.ts:129`) is a constant and does not
look at `detail.remedy`. **Fix:** when `detail.remedy` is present, use a reason clause that
does not name the tag — e.g. *"…an older build left empty directories beside this store;
run counterparts doctor for the four names to remove"*.

**NEW-MINOR-2 — the "they are empty, remove them" remedy misfires on a v5 store whose `prose/` was moved out, and it says `rm`, not "move aside".** *I ran this.* A real v5 store built
by `40f92ae` with 3 memories, `prose/` moved to a parking directory (an empty `prose/`
left), plus a hand-copied `counterparts.sqlite`:

```
…an older build was pointed at it and left operational.sqlite, prose, versions,
operational.sqlite-shm, operational.sqlite-wal behind, all of them empty, which is why
this refuses. Check that prose/ and versions/ really are empty, remove <those> and tmp/…
```

The `operational.sqlite` it says to remove holds **`memories: 3 rows`, `meta: 4 rows`** —
every memory's physics, band, hashes, learned dates, the lived day, and on a real store the
deny-list (the permanent removal record, §14.1 G9). The parked prose files survive, so this
is not total loss, but the store is destroyed and the hedge ("check that prose/ really is
empty") is exactly what a person who moved it would confirm. The builder's choice not to
open `operational.sqlite` is right and I would keep it — the cheap fixes are wording:
(a) add *"…and that you did not move `prose/` aside yourself"*, and (b) say **move these
four out of the directory** rather than **remove** them, which costs nothing and makes the
whole remedy reversible. `preRowsLeftoversAreEmpty` treats a **missing** `prose/` as empty
too, which is the same hole with no directory at all.

**NEW-MINOR-3 — `status` and `verify` print a bare code and a JSON blob for the shape-lock shape.** *I ran this.* On a v5 database wearing the v6 name:

```
$ counterparts status --dir …   ->  exit 3
could not open the store: STORE_UNINITIALIZED {"path":"…/counterparts.sqlite","expected":6,"found":"5"}
```

These doors open as **observer**, so they meet `OBSERVER_READ_FLOOR`'s `STORE_UNINITIALIZED`
rather than `STORE_PRE_ROWS`, and `describePreRowsRefusal` never fires — A-MINOR-3's exact
complaint, surviving on the other lock's shape. `verify --rebuild`, `migrate-cache`, `init`
and the hook all *do* print the sentence here, which makes the inconsistency visible.

**NEW-MINOR-4 — on the shape-lock shape, box 3 is opened before the refusal — `migrate-cache` is not refused at all.** *I ran this.* `refusePreRows` keys on `preRowsMarkersIn` (filenames)
only, so on a v5 database wearing the v6 name it passes. `migrate-cache` then runs to
completion: `Cache: …/cache/cache.sqlite (48.0 KiB, schema v4) … Converted and compacted.
Nothing to do.` `verify --rebuild` *does* refuse — but from box 2, after its census has
already opened box 3. Before/after `shasum` of every file, for both commands: only
`cache/cache.sqlite-shm` changed; box 2's stamp is still `5` and its bytes are untouched.
So nothing was lost — but this is the door that still writes into a store the build has
declared it cannot read, which is what A-MINOR-1/-2 were about, and on a real parked store a
`migrate-cache --apply` would rewrite and VACUUM the whole index. **Fix:** have
`migrateCacheCommand` (and `verifyCommand`'s rebuild census) open box 2 read-only through
`openOperational` — which carries the second lock — before either touches box 3, or hoist
the shape check beside `refusePreRows`.

**NEW-MINOR-5 — doctor names one faulted row out of N and does not say where the rest are.** *I ran this.* With two faulted rows, `status` and `verify` both name **2/2**; doctor names
**1/2** — the one `Schemas.load` threw on — and its remedy offers "restore a snapshot" or
"remove that one row" with no count and no pointer to `verify`. Following doctor is
therefore a one-at-a-time loop with no idea how long it is. The hook's instruction is
`Run: counterparts doctor`, so this is the path the owner is actually sent down.
**Fix:** one clause — *"`counterparts verify --dir <store>` lists every such row"* — or read
`store.faultedIds()` in `openFindings` instead of `faultId(err)`.

**NEW-MINOR-6 — an interrupted `--passphrase` export leaves a full plaintext copy of the store in `$TMPDIR`, and nothing sweeps it.** *I ran this* (exact numbers above): after the SIGKILL,
`$TMPDIR/counterparts-export-rHt7pq/` (mode **0700**) holds `scratch.sqlite`, 2 904 064 bytes,
containing the memories' words. `sweepStaleScratch` only sweeps `.export-scratch-*` **in the
target**, so a second, completed export left it exactly where it was. On macOS the per-user
`/var/folders` temp is reaped after roughly three days of non-access, or at reboot —
otherwise it is there indefinitely. This is the design reviewer B proposed and it is a large
improvement on leaving it in the target, so it is MINOR, not a re-open. **Fix, if wanted:**
sweep `counterparts-export-*` in `tmpdir()` at the start of every export, bounded by an
mtime age (`PARTIAL_STALE_MS`-style) so a concurrent export's directory cannot be taken —
without that bound the sweep *would* introduce the collision the target sweep currently
cannot have.

## NIT

1. **`describePreRowsRefusal` renders `found` as if it were always filenames.** For the
   second lock `found` is the schema version, so `verify --rebuild` on a renamed v5 database
   prints *"it keeps its memories in files **(5)**"*. One conditional clause.
2. **`init` prints `refused: refused: …`** — `initCommand`/`installCommand` add their own
   `refused:` prefix in front of the sentence, which now starts with `refused:` too.
3. **`cleanPartials` still deletes a stale `.partial-…` that holds pre-rows files.** *I ran
   this*: a 30-day-old `.partial-2026-09-01T00-00-00-000Z-4242` containing `prose/memories/mem_1.md`
   and `operational.sqlite` → `cleanPartials` removed 1, prose gone. A partial is by
   definition an incomplete copy and master's sweep did the same, so I think this is right —
   but it is the one path left that still deletes pre-rows bytes, and B-MAJOR-2's rule
   (`PRE_ROWS_MARKERS` ⇒ never ours to delete) is not applied there. Worth one sentence in
   the note saying it is deliberate.
4. **The new `an INTERRUPTED --passphrase export…` test kills on a fixed `Bun.sleep(220)`.**
   It does not poll for the scratch, and there were **0** `counterparts-export-*` directories
   in `$TMPDIR` after a full suite run — i.e. the child most likely finished the vacuum and
   ran its `finally` before the kill landed, so the test may be asserting a clean target for
   a case it never reached. My own polling probe confirms the real mid-vacuum case is clean,
   so the *claim* holds; the *test* should poll for `scratch.sqlite` instead of sleeping.
5. **`verify`'s faulted sentence over-generalises.** "A session that reads one stands down"
   is true for a `schema` row; for an ordinary memory the session starts normally (measured:
   `Counterpart.open` opened with a faulted `mem_…` in the store, and doctor's Store line was
   green while `status`/`verify` exited 3). Two words: *"a session that loads a belief or
   reads that memory…"*.

---

## What I could not determine

- **Whether the overflow residue reaches anything outside the store directory.** `backup`
  and `export` go through `VACUUM INTO`, which copies live pages only, so in principle no;
  I did not measure a snapshot of a store in the residue state.
- **How common a contended cache checkpoint is in practice** — unchanged from the builder's
  own note. The branch's test proves it is *reported*; I have not seen one arise by itself.
- **A clean global `$TMPDIR` before/after.** Several agents are running suites in the same
  temp dir today; I can only say that no `counterparts-export-*` remained after my run.
- **Whether `secure_delete=ON` is the cheap answer to NEW-MAJOR-1** — see the note under that
  finding; my bare fixture did not reproduce the residue at all, so the question is open.
- **What the durable removal record says** when a surface goes unchased. I read the console
  report, not the record's own stages.
- **Node.** Not exercised, as agreed.

---

*Hygiene: every probe ran under `/tmp/f5c-…` directories I created and removed by exact
path, plus a `git archive` source export of `40f92ae` in the same tree (no `git worktree`
was added). The only change left in this worktree is this file, uncommitted.*

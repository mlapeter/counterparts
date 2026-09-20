# Adversarial review B — PR #148, `floor/f5-the-floor` (head `20adaf6`)

2026-09-20. Reviewer **B** of two, working independently. My half: *is every word still there,
still true, and still removable, on the new floor?* Reviewer A owns `STORE_PRE_ROWS`, old-store
safety, kill −9 and first-open races; I did not spend time there.

Read-only on the branch: nothing committed, nothing pushed, nothing commented, nothing deployed.
Every probe ran against a fresh `mkdtempSync($TMPDIR, "counterparts-…")` it removed afterwards.
No probe was pointed at `~/.counterparts`, `~/.bansai`, `~/.claude-engram`, `~/counterparts-backups`
or the live checkout. `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` was exported in every shell.

**Suite on this head:** `bun test` → **2474 pass / 0 fail**, 33775 expect() calls, 42 files,
59.47 s. `bunx tsc --noEmit` → **clean, exit 0**. `$TMPDIR` `counterparts-*` count: **80 before,
80 after, `diff` empty** — no leftovers. All three claims in the PR body match exactly.

**Verdict: MERGE AFTER FIXES.**

Nothing I found loses or corrupts a live memory on a normal path, and the parts of this change
that frightened me most — the versions table, the prune, the tombstone/fault pair, byte-exact
round-trips, `tools/parallel` on the owner's live stores, backup/restore of unflushed WAL content
— I attacked hard and could not break. Four MAJORs, all of them about *the promise around the
words* rather than the words themselves: one removal surface the chase does not reach while the
console says it did; one rotation rule that will delete the owner's pre-rows snapshots after
cut-over; one fault the owner cannot diagnose or repair; and one plaintext copy of the whole
store left in a directory he is about to share.

**Count: 0 BLOCKER · 4 MAJOR · 5 MINOR · 4 NIT.**

Throughout, **"I ran this"** means a probe I executed and whose printed output is quoted;
**"I read this"** means a claim from code I read and believe but did not execute.

---

## MAJOR-1 — `cache/cache.sqlite` still holds the removed memory's words, and the report says `unchased: nothing`

**I ran this.** `chaseWriteAheadLog` (`src/adapters/cli/removal.ts:836`) opens
`paths.operational(dir)` and checkpoints **that database only**. Box 3 is also in WAL and also
holds the removed memory's text (as `doc_tokens` rows), rewritten by `store.rebuildCache()` one
step earlier — and when the removal returns, the *old* bytes are still in `cache/cache.sqlite`.

Five runs of the same shape (200 filler rows, one memory carrying a unique word, one revision,
then the real `counterparts remove <id> --confirm --dir <tmp>` ceremony), grepping every file
in the store directory case-insensitively:

```
run 0: residue=[{"file":"cache/cache.sqlite","offsets":[121504,128862,152644]}] live_rows=[] cache_freelist={"freelist_count":0} sizes={"counterparts.sqlite":192512,"counterparts.sqlite-wal":8272,"cache/cache.sqlite":163840,"cache/cache.sqlite-wal":4095312}
run 1: residue=[{"file":"cache/cache.sqlite","offsets":[91628,128862,152644]}]  live_rows=[] …
run 2: residue=[{"file":"cache/cache.sqlite","offsets":[116080,128862,152644]}] live_rows=[] …
run 3: residue=[{"file":"cache/cache.sqlite","offsets":[128862,150669,152644]}] live_rows=[] …
run 4: residue=[{"file":"cache/cache.sqlite","offsets":[128862,149407,152644]}] live_rows=[] cache_freelist={"freelist_count":1} …
```

5/5 for this shape. `live_rows=[]` — the *index* really is chased; it is the bytes on disk that
are not. It is **shape-dependent**: a variant with 300 fillers and no revision left nothing
anywhere, and one run of a later 3-run repeat was clean too, so this is "often", not "always".
The console said, in every run:

```
  chased: operational.edges(0), operational.prospective(0), operational.gate_session(0),
          operational.memories(1, tombstoned), operational.versions(1, tombstoned),
          cache, write-ahead log
  unchased (dark via the deny-list, never silently dropped): nothing
```

`cache` and `write-ahead log` both reported chased; `unchased: nothing`. The owner is told the
directory is clean and it is not.

**What is and is not new.** Master had the same residue — box 3 always indexed the body — so this
is not a regression in behaviour. It *is* a regression in truthfulness: F5 adds CONTRACT §5 **G17**
("A removal chases the write-ahead log … §16 G14 — every copy is chased") and a chase that covers
exactly one of the two WAL'd databases, which converts a known gap into a stated guarantee that
does not hold. G7 has the same problem: "every surface is chased including the derived index".

**Main database and `-wal`: clean, both ways.** For box 2 the builder's measurement reproduces.
Uncontended, after the ceremony, the doomed word is in neither `counterparts.sqlite` nor its
`-wal`, and a 34 KB body (overflow pages, `page_size` 4096, `freelist_count` 0 → 8) left nothing
either; `PRAGMA integrity_check` = `ok`; a subsequent `VACUUM` changed nothing because there was
nothing left to find.

**The mechanism is the same one G17 was written for, not a freelist problem — and so the fix is
one line.** `PRAGMA secure_delete` on this machine is **2** (FAST), but the freelist is not the
story: in the residue runs `freelist_count` was **0** (run 4: 1). I then asked the direct
question — take the residue, open box 3's database, `PRAGMA wal_checkpoint(TRUNCATE)`, close,
rescan — three runs:

```
run 0: after-removal=["cache/cache.sqlite"] freelist=0 checkpoint={"busy":0,"log":0,"checkpointed":0} after-checkpoint=[]
run 1: after-removal=[]                     freelist=0 checkpoint={"busy":0,"log":0,"checkpointed":0} after-checkpoint=[]
run 2: after-removal=["cache/cache.sqlite"] freelist=1 checkpoint={"busy":0,"log":0,"checkpointed":0} after-checkpoint=[]
```

3/3 clean afterwards, including both runs that had residue. So these are pages the rebuild has
not yet folded over, exactly like box 2's — the surface `chaseWriteAheadLog` exists to close,
on the database it does not visit. (`log: 0` at the moment of the PRAGMA means the last frames
went in on the closing connection; the clearing work is the open-checkpoint-close as a unit,
which is what the chase would do.)

**Smallest fix.** Give `chaseWriteAheadLog` the second path: do the same
`openDb → PRAGMA wal_checkpoint(TRUNCATE) → close` on `paths.cache(dir)`, and report it as its own
surface (`cache write-ahead log`), chased or unchased, never thrown — same rule, same sentence.
No `secure_delete`, no `VACUUM`. If for some reason box 3 is deliberately left alone, then say so
in the report rather than in silence: the `cache` line should read `cache (index rows; the file
keeps the old pages until the next checkpoint)` instead of sitting under `unchased: nothing`.

---

## MAJOR-2 — after cut-over, rotation deletes the owner's real pre-rows snapshots

**I ran this.** `looksCopied` (`src/adapters/snapshots.ts:861`) decides what rotation may delete by
asking whether a directory holds any entry the **current** `LAYOUT` classifies. F5 removes `prose`,
`versions` and `operational.sqlite` from `LAYOUT`. A v5 snapshot the owner actually has contains
`operational.sqlite`, `prose/`, `versions/` **and `spans/`** — `spans` was in master's backup set
(`git show origin/master:src/core/store/paths.ts`, `name: "spans", backup: true`) and the owner's
live store has a capture buffer every day. `spans` is still in the new `LAYOUT`. So a real v5
snapshot **is recognised** — and is therefore rotatable.

Three realistic v5 snapshots (prose + versions + operational.sqlite + spans/default/jots.jsonl)
beside fourteen v6 ones, `keep: 14`:

```
recognised: 17 of 17
unrecognised: []
deleted: [ "2026-09-01T00-00-00-000Z", "2026-09-02T00-00-00-000Z", "2026-09-03T00-00-00-000Z" ]
kept: 14 oldest: 2026-10-01T00-00-00-000Z unrecognised: []
v5 prose still on disk: false
```

The only copy of those words in those folders is gone, silently, as an ordinary rotation.

**The condition, stated precisely.** `resolveSnapshotsDir` returns `<dirname(store)>/snapshots`
whenever `basename(store) === "store"`. The owner's live store is `~/.counterparts/store`, and the
pre-rows refusal means cut-over has to move it aside and mint a new one — most naturally at the
same path, which gives the new store **the same `~/.counterparts/snapshots`**. Fourteen daily
boundaries after cut-over, every v5 snapshot in it is deleted. (I did not and will not look at
his actual directory; this is the default arithmetic.)

**The near-miss that shows the rule was nearly right.** A v5 snapshot *without* `spans/` (or
`journal/`) is correctly `unrecognised` — kept, counted, named:

```
recognised names: [ "2026-08-31…", "2026-09-17…", "2026-09-18…", "2026-09-19…" ]
unrecognised: [ 16 old-floor folders ]
rotation report: {"deleted":[], "kept":4, …}
old-floor words still on disk: true
```

F2's MAJOR-A reasoning ("`LAYOUT` is read at runtime, this rule can change underneath copies that
already exist — a floor change") anticipated exactly this case and got it right for the folders
that have *only* pre-rows names. `spans` is the hole.

**Smallest fix**, one line in `looksCopied`: a directory that holds any `PRE_ROWS_MARKERS` entry is
**not** ours to delete, whatever else it holds —

```ts
const entries = readdirSync(path);
if (entries.some((e) => PRE_ROWS_MARKERS.includes(e))) return false;   // pre-rows copy: keep and count
```

It lands in `unrecognised`, so it is kept, named and counted, which is what F2 built that channel for.

---

## MAJOR-3 — a faulted row stands every session down, and nothing names which row or repairs it

**I ran this.** Hand-edited one schema row to the fault shape (`body = ''`, real hash) on a
temp store — the state the PR says no write path produces, which I confirmed (see "checked and
clean" #4):

```
hand-edited row: {"id":"sch_20d55d7c5bc1","body":"","content_hash":"f2f95eea6c14a49e"}
Counterpart.open throws: MEMORY_BODY_MISSING {"id":"sch_20d55d7c5bc1","tombstoned":false}
read(faulted): MEMORY_BODY_MISSING {"id":"sch_20d55d7c5bc1","tombstoned":false}
```

Correct and by design. But the three surfaces the owner reaches for next:

```
--- status --dir <store>  exit=0 ---
Memories: 1   Beliefs and entities: 1   Journal: 0 episodes   Archived: 0   Superseded: 0
   (…a completely normal store summary. No mention of the fault.)

--- verify --dir <store>  exit=0 ---
Canonical rows: 2   live rows: 2   removed (deny-list): 0
Floor: schema v6 · bodies in rows · prose files: none
The cache covers every live row and holds nothing else.
   (…green. No mention of the fault.)

--- doctor --config <cfg>  exit=1 ---
RED   Store open  <store>: will not open — MEMORY_BODY_MISSING: a memory's row is in the store and its words are not
                  fix: Every session's hooks stand down here: no wake, no recall, no capture. The code names what the read path met.

names the faulted id? false      ← the id was sch_d1defc41967d
```

So: every session is down, `status` and `verify` both say the store is fine, and doctor's red line
names the *class* but not the row. On the old floor the same fault printed
`Restore <path>` — a specific file the owner could fetch from a snapshot. F5 takes that away and
the PR body knows it ("`MEMORY_BODY_MISSING` carries `{ id }` and **no path**, because there is no
file to restore; doctor's existing `path === null` arm takes it") — but that arm prints no id
either. **I read this and believe it:** there is no repair command anywhere; the only reference to
the code outside the store is `standdown.ts:121`, a sentence.

**Why it matters more on this floor.** The fault used to be repairable by restoring one file.
Now the row's words are the only copy, so the only exits are "restore a whole snapshot" or "edit
SQL by hand" — and the owner cannot even find the row to decide which.

**Smallest fix**, two parts, both small:
1. Carry `detail.id` through `OpenReading` into `openFindings`, so the red line ends `… — row
   sch_…`, and make the `path === null` remedy name a real next step ("that row's words are gone;
   restore a snapshot, or `counterparts forget <id>` to tombstone it and let sessions start").
2. `verify` should count and name rows with `body = '' AND content_hash != ''` beside its
   `Floor:` line — the census that would have turned this from a mystery into a number.

---

## MAJOR-4 — an interrupted `export --passphrase` leaves an unencrypted copy of the whole store in the target

**I ran this.** F5 moves the `VACUUM INTO` scratch out of `<store>/tmp/` (deleted with the floor)
and into **the target directory** (`src/adapters/cli/export.ts:126`). On the happy path it is
removed in `finally`, and I verified the finished encrypted artefacts are clean:

```
export exit: 0   Mode: encrypted (aes-256-gcm)
target now: [ "counterparts-export.cpx", "README.md" ]
counterparts-export.cpx 5940 confidential? false plain? false
README.md 522 confidential? false plain? false
```

But the scratch is a plaintext SQLite copy of the *whole* store, and it exists on disk for the
duration of the vacuum. A 20,000-memory store, encrypted export, killed the moment the scratch
passed 4 MB:

```
store db bytes: 9494528
saw the scratch at 4255744 bytes, killed the exporter
target after the kill: [ ".export-scratch-1789921802515.sqlite", ".export-scratch-…-journal" ]
  .export-scratch-1789921802515.sqlite 4255744 holds the words: true
```

The file survives, holds the memories' words, is named with a timestamp so nothing ever collides
with or overwrites it, and **nothing sweeps it** — the next export mints a new name. The target is,
by `assertSafeTarget`'s own argument, a directory *outside* the store: an external disk, a synced
folder, the directory the owner is about to hand somebody. That is the one place a `--passphrase`
export must not leave cleartext, and `--passphrase` exists precisely to say "this copy leaves the
machine".

**Smallest fix.** Put the scratch in the OS temp dir (`mkdtempSync(join(tmpdir(), "counterparts-export-"))`,
removed in the same `finally`) — outside the store, outside the target, and swept by the OS if the
process dies. If it must stay beside the target for space reasons, then sweep
`.export-scratch-*` from the target at the start of every export and say in the README that an
interrupted export can leave one.

---

## MINOR

**MINOR-1 — CONTRACT §5 G11's own note still spells the database `operational.sqlite`, unmarked.**
`src/core/store/CONTRACT.md:199–200`: *"the database entry classifies by PREFIX, so
`operational.sqlite-wal` and `-shm` are covered … but **`operational.sqlite` is no longer the
database on its own**"*. On this floor there is no `operational.sqlite`; that exact name is now the
thing `STORE_PRE_ROWS` refuses on. This is the one guarantee about the layout, it is not marked
`[F8: …]`, and it names the wrong file twice. (The CONTRACT is otherwise well marked — see
"checked and clean" #10.) Fix: two words, or an `[F8: rewrite]` tag.

**MINOR-2 — `content_hash` is now a hash of the body alone, and §2.20 is the scar about that.**
`hashText(body)` replaces a hash of the whole serialized document (id and frontmatter included).
Scar §2.20, cited in this very CONTRACT's §6, says content-by-reference is only private if the
reference cannot be inverted; a 16-hex SHA-256 prefix of a short, low-entropy body is guessable.
**I ran this:** two memories differing only in title now share a `content_hash`, and adjacent
version rows can too:

```
hash before: d17f40ed1a491f08 after: d17f40ed1a491f08 same: true
two versions share a content_hash: true
```

**I read this:** nothing that leaves the machine carries it — the removal record carries no hash
(§16 G9), and `dashboard/web/views.ts:896` blanks it for confidential rows. `browse.ts:192` prints
it beside the body the owner is already reading, which is harmless. `store.put`'s emitted
`hash` field changed meaning from the document hash to the body hash and rides the worker's
telemetry; I did not trace where that telemetry lands. Worth one sentence in NOTES saying the
column's preimage got weaker and why that is acceptable, rather than leaving §2.20 pointing at it.

**MINOR-3 — `dedup` now merges two memories that differ only in title, and that is stated as a
sharpening rather than measured.** **I ran this:**

```
hashes equal: true
dedup pairs: [{"candidateId":"mem_93d…","originalId":"mem_37c…","sameContentHash":true}]
```

Two memories, identical bodies, *different titles and different people in them* ("Alice's rule" /
"Bob's rule"), are proposed as a dedup pair. **In fairness to the PR: this is not new** — master's
`contentHashCandidates` already hashed `store.read(id).doc.body`
(`git show origin/master:src/core/sleep/dedup.ts:114`), so behaviour is unchanged. What F5 changes
is that `memories.content_hash` now agrees with that choice, which removes the one column a future
reviewer could have used to tell the two apart. Worth a test that pins "a title is not part of the
duplicate question" as a *decision* rather than an accident of which hash is handy.

**MINOR-4 — a lone surrogate breaks "the hash addresses the body".** **I ran this:**

```
loneSurrogate: bytes 13 -> 14 exact=false hashOK=false storedHash==hash(original)=true
stored hash: 7f76dfb4e735edb2   hash(readback): 769a7a048a5938e0   equal: false
```

`put({ body: "lead \uD800 alone" })` succeeds; the column comes back with U+FFFD, so the stored
`content_hash` (computed in memory from the original string) no longer addresses the row's own
body. `verify` says nothing about it (exit 0, all lines green). It is the one input that violates
the invariant the floor leans on and that the PR's own kill-−9 test asserts ("every row asked …
whether the hash still addresses them"). Probably pre-existing — writing the same string to a file
on master would also have substituted — and reachable only through a JSON-RPC client that emits an
unpaired `\ud800`. Smallest fix: normalise or refuse in `insertOne`/`revise`
(`if (body !== Buffer.from(body,"utf8").toString("utf8")) throw PROSE_BODY_INVALID`), so the
invariant is total.

**MINOR-5 — `Store.put(" ")` and `Store.put("\u0000")` are accepted.** **I ran this:**

```
put(''):    refused PROSE_BODY_INVALID
put(' '):   ACCEPTED -> mem_8209a5e7c11c
put('\0'):  ACCEPTED -> mem_1b7999095b06
revise(''): refused PROSE_BODY_INVALID
revise(' '): ACCEPTED -> 1
putMany atomic '': refused PROSE_BODY_INVALID
putMany isolate '': ACCEPTED -> []        ← skipped and reported, correct
whitespace row: body=" " hash=36a9e7f1c95b82ff tombstoned-shape=false
```

Neither produces the faulted shape (the hash is real and the body is non-empty), so the pair the
floor depends on is intact — and the MCP `note` door refuses whitespace-only itself
(`server.ts:600`). But a memory whose body is one space renders as an empty memory everywhere,
which is the thing `revise("")` was closed to prevent. One `.trim().length === 0` in `insertOne`
beside the existing check makes the rule the same at both doors.

---

## NIT

**NIT-1** — `src/adapters/claude-code/CONTRACT.md:473`, the restore instructions: *"What comes back
with the copy: every memory, **its prose**, the journal, the spans…"*. There is no prose to come
back; the database is the whole of it. The same page at line 388 still says *"a store with one
missing prose file meant no wake"* as present tense. Both are wording only — the steps themselves
are correct, and I proved they work (see "checked and clean" #5).

**NIT-2** — `src/core/schemas/NOTES.md:24` and `src/core/remember/NOTES.md:202` still describe
memories as living in `prose/`. Notes, not contracts; F8's list.

**NIT-3** — `RESTORE_STEPS` (`doctor.ts:1604`) is accurate but does not say the snapshot directory
may also contain **pre-rows** copies this build cannot open. After MAJOR-2 is fixed those folders
will sit there permanently as `unrecognised`; one clause telling the owner what they are would stop
the next panic from being about them.

**NIT-4** — `rotate()`'s report carries `unrecognised`, and I could not find the surface that prints
it to the owner (doctor's Snapshot line grades staleness and count). **I read this, did not run it.**
If it is unprinted, F2's "counted, never just skipped" is half-kept, and after cut-over there will be
a lot of them.

---

## Checked and clean — what I attacked and could not break

1. **Removal residue in box 2 and its `-wal`, uncontended and contended.** Uncontended: the real
   ceremony leaves the doomed words in neither `counterparts.sqlite`, its `-wal`, its `-shm`,
   `sessions/`, `spans/`, the `versions` rows nor the journal rows — small body and 34 KB
   overflow-page body alike; `freelist_count` 0 → 8 and a later `VACUUM` found nothing.
   `PRAGMA secure_delete` is **2** (FAST) on this machine, `page_size` 4096, `auto_vacuum` 0.
   Contended, with a **second process** holding a real read transaction (verified as real: a
   TRUNCATE against it returns `{"busy":1,"log":441,"checkpointed":233}` and the `-wal` keeps its
   size), the removal is honest about it:

   ```
     chased: …, operational.memories(1, tombstoned), operational.versions(1, tombstoned), cache
     unchased (…): write-ahead log (a reader held it; the next checkpoint folds it in)
   AFTER (contended): [ "counterparts.sqlite-wal" ]     ← the words are there
   AFTER holder died, before any new checkpoint: []      ← something folded it in within 300 ms
   AFTER next checkpoint: []
   ```

   The sentence is exactly true, the removal does not throw, and the words do go — note honestly
   that in my run they were already gone *before* the explicit checkpoint I then ran, i.e. some
   connection closing after the reader left did the work, not my PRAGMA. Either way the report's
   promise ("the next checkpoint folds it in") held. This is the judgement call the PR flagged, and I think it is the right one.
   `chaseRemoved` has exactly two importers (`owner-op-seam.ts`, `cli/removal.ts`), so there is no
   door that removes without the chase.

2. **Versions.** Five revisions changing body, title, meta, `learnedOn` and `happenedOn` together:

   ```
   seqs:        [1,2,3,4,5]
   bodies:      ["body zero","body 1","body 2","body 3","body 4"]
   titles:      ["t0","t1","t2","t3","t4"]
   metas:       ["{\"a\":0}",…,"{\"a\":4}"]
   learned_on:  ["2026-01-01","2026-01-02","2026-01-03","2026-01-04","2026-01-05"]
   happened_on: ["2026-01","2026-02","2026-03","2026-04","2026-05"]
   reasons:     ["r1","r2","r3","r4","r5"]
   hashes match their own body: true
   ```

   Every version's own `learned_on`/`happened_on` are the ones that were live when it was archived —
   the column pair the plan did not ask for is load-bearing and correct. `readVersion` returns the
   same bytes as the row. A title-only and a meta-only revision **do** archive a version (2 versions
   from 2 revisions), and the index still finds the new title after a title-only revise
   (`search 'renamed'` → 1 hit).

3. **The prune.** `retentionDays: 0`, clock advanced: `{"pruned":2,"cutoffDay":1,"retentionDays":0}`,
   the live body survives verbatim, `readVersion(id, 1)` throws `VERSION_UNKNOWN`, and the counts in
   the report equal the rows deleted. On the **self page** specifically, with three writes:
   versions `[2,1]` → pruned → `[]`, the page itself still reads, and

   ```
   restorePage(1): {"written":false,"reason":"no-such-version", …}
   ```

   — exactly the named answer the brief asked for, not a throw and not a silent no-op. Journal rows
   (episodes) are untouched by the version prune. The prune really does delete the owner's earlier
   words now, and the code says so where it used to claim it destroyed nothing.

4. **The tombstone-vs-fault pair.** I could not get any write path to produce `body = ''` with a
   real hash: `put("")`, `revise("")` and atomic `putMany([""])` all refuse `PROSE_BODY_INVALID`;
   isolated `putMany` skips and reports; MCP `note` refuses whitespace-only at its own door; the
   self page's `--clear` writes a real sentence (`PAGE_CLEARED_BODY`) plus a `meta.cleared` marker
   rather than blanking anything. The fault shape had to be hand-made in SQL. When it exists, the
   session stands down loudly with the id in the detail (the *diagnosis* is MAJOR-3, not the
   mechanism).

5. **Snapshot / backup / restore on v6, including unflushed WAL content.** 50 memories plus a
   revision written and **never closed** (so the writes are in the `-wal`), `counterparts backup`,
   source directory destroyed, copy opened:

   ```
   ok   counterparts.sqlite  (vacuum-into, 1 files)
   rows in the copy: 50
   first body: "memory number 0, revised"
   its versions: [ "1:memory number 0 with real words" ]
   last body: "memory number 49 with real words"
   ```

   Nothing lost. `cli/snapshot.ts` matching the layout's own entry rather than a literal is the right
   call and I could not find a second spelling anywhere. A full self-page round trip through the same
   path — two writes, clear, restore, backup, restore-by-copy — brings back page, versions `[3,2,1]`
   and rows.

6. **The self page beyond its tests.** Clear reads as absent (`selfPage()` → `null`) while the row
   and every version survive; restoring a pre-clear version is itself a version (`version: 3`); the
   page survives a 90-day-equivalent prune as the *live* body while its history goes. I could not
   find a page state that loses the live words.

7. **Big and strange bodies.** Byte-exact round trip, and `content_hash === hashText(readback)`, for
   a **5 MB** body, emoji with ZWJ sequences and a flag, CRLF, an embedded NUL, `'; DROP TABLE
   memories; --`, a body that looks like the old frontmatter (`---\nid: …\n---\n…`), combining marks,
   and an RTL override. The only exception is the lone surrogate (MINOR-4).

8. **`tools/parallel` is read-only, on both floors, proved by fingerprint.** `openReadOnly` uses
   `readonly: true` / `readOnly: true` and `openStore` refuses any handle that does not pass
   `probeReadOnly`. Fingerprinting every file (sha256 + size) before and after `v2StorePath`,
   `proseRows` and `readSchemaBytes`:

   ```
   v6 store:            DIFF v6:     [ "counterparts.sqlite-shm: …47e39118… -> …a126a650…" ]
   hand-built v5 store: DIFF v5:     []   (dir still exactly: operational.sqlite prose versions)
   v5 store in WAL with a live -wal:  DIFF wal-v5: [ "operational.sqlite-shm: … -> …" ]
   ```

   The `-shm` is the only thing that moves — read marks, and the one sidecar `isDatabaseSidecar`
   excuses by name. No file created, no `-wal` checkpointed away, no `journal_mode` conversion.
   Both floors are read correctly: v6 → `proseRows: 2, body: "an identity element with words in the
   ro…"`; v5 → `proseRows: 1, body: null` and `readSchemaBytes {present:true,bytes:37,elements:1}`.
   The two-spelling `v2StorePath` resolves to `counterparts.sqlite` on one and `operational.sqlite`
   on the other. This is the part of the change that reads the owner's live store on real days, and
   it is safe.

9. **Performance: no cliff — most of it is faster.** 20,000 memories, ~340-byte realistic bodies,
   same fixture, same machine, this head vs a clean extract of `origin/master` (`git archive`):

   | | master `40f92ae` | F5 `20adaf6` | |
   |---|---|---|---|
   | `putMany` 20,000 | 36,333 ms | **26,323 ms** | 1.4× faster |
   | `read` ×1000 | 628 ms | **48 ms** | **13× faster** |
   | `search` ×20 | 3,133 ms | 3,128 ms | same |
   | `recallForTurn` ×10 | 239 ms | 260 ms | same |
   | one `runCycle` | 24,083 ms | **4,030 ms** | **6× faster** |
   | `Counterpart.open` | 296 ms | 503 ms (first) | see below |
   | canonical db | 3,485,696 B | 11,202,560 B | 3.2× bigger |
   | whole store dir | 77,624,234 B | **73,919,488 B** | smaller |

   The database triples; the *store* shrinks, because ~16,000 small files cost more in block
   overhead than the bodies cost in pages. Nothing is above the 2× bar. `Counterpart.open` looked
   1.7× slower in the first pass, so I measured it three times on a fresh 20k store with schema rows
   in it: **113 / 43 / 31 ms** — the 503 ms was a cold page cache, not the floor.
   `readProseWalking`'s `row` hint, over 20,000 rows: **583 ms without, 4 ms with**. The parameter the
   NOTES kept "because the saved lookup is now MOST of the walk" is now ~99% of it; the claim is
   understated if anything, and every caller in the pinned list passes it.

10. **CONTRACT truth.** I read `src/core/store/CONTRACT.md` at this head against the code. The
    `[F8: gone]` / `[F8: rewrite]` markers are honest: §3's "owner can VIEW every memory", §5 G15
    (`prose_path` placement, the sharpest one), and the §7 open question are all marked, the banner
    says the page is mid-rewrite, and G5 / G11 / G16 / G17 are restated rather than left stale.
    Guarantees I checked and found still kept: G3 (single-writer structured state), G4 (forwarding
    address), G5 (overwrite keeps the prior version in the same transaction — proved in #2), G6
    (crash ordering), G8 (box 3 rebuildable), G10 (telemetry content-by-reference — but see
    MINOR-2), G11 (layout totality; `status` prints all five entries), G13 (`readProseWalking`'s two
    exemptions, and the two-importer pin), G14 (the explicit-dir guard). The two I would not sign
    are **G7/G17** (MAJOR-1) and the §5 G11 note's filename (MINOR-1).

---

## What I could not determine

- **Whether the owner's cut-over will in fact share `~/.counterparts/snapshots` with the pre-rows
  store.** MAJOR-2's arithmetic is the default; the actual flip plan is his. I did not look at his
  directory. If the new store gets a new base directory, MAJOR-2 costs nothing and the fix is still
  worth the one line.
- **Where the worker's telemetry lands on disk**, and therefore whether the changed meaning of
  `store.put`'s `hash` field (MINOR-2) is persisted anywhere. I traced it to `runner.ts`'s `emit`
  and stopped.
- **Whether `rotate()`'s `unrecognised` list is printed to the owner anywhere** (NIT-4). I read the
  doctor Snapshot line and did not find it; I did not run every console surface.
- **Doors I did not run**, and so cannot claim clean: the MCP **`session_end`** tool and
  `revision.ts#applyRevision` as possible fault-shape producers (I ran `put`, `putMany`,
  `revise`, the self-page door and MCP `note`); `tools/migrate/**` as a writer against a v6
  store; **FTS-finds-it and `export`-writes-it for the 5 MB body** (I proved the byte-exact
  round trip and the hash, not the index hit or the export); and **wake composition** — my
  `wake()` on the 20k fixture returned 188 bytes, i.e. an empty wake with no page and no
  identity lane, so the composition cost is unmeasured and the number in the table is a floor.
- **Node.** Everything above is bun 1.3.10. `node:sqlite` + WAL + rows is untested here too.
- **A real 16,973-memory corpus.** My 20,000 rows are synthetic and uniform; the real store's body
  length distribution and its ~13,868 vectors could move the database-size number.

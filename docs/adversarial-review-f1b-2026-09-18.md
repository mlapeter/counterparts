# Adversarial review, second pass — PR #137 `floor/f1-wal`, head `44bab3e`

*2026-09-18. Reviewing `git diff aa2f50c..44bab3e` — the builder's answer to the first pass
(`adversarial-review-f1-2026-09-18.md`). Same rules: read-only on the branch, hermetic
probes under the session scratchpad, nothing pushed, nothing commented, nothing deployed.*

---

## Verdicts

**Merge: yes, as is.** The one code fix I gated the merge on (MAJOR-1) is closed, and I
re-measured it rather than taking the claim. Everything else in this pass is either a
correct fix, an honest piece of documentation, or a test that pins something that was
previously only true by luck. Nothing in this pass introduces a new problem at MAJOR or
above.

**Deploy to the live multi-process store: with the procedure, yes — and the procedure is
unchanged except for step 1, which is now smaller.** One deploy gate remains open, and it
is not a code gate: the six documents that teach `sqlite3 …?immutable=1` are untouched.

**Findings from the first pass:** 6 closed, 3 closed-as-documented, 2 still open (1 of them
a docs sweep, 1 a NIT), 1 new NIT.

**Suite / typecheck / flake:** `bun test` → **2236 pass / 0 fail**, 28471 expect() calls,
38 files, 54.0 s — matches the claim. `bun run typecheck` → clean, exit 0.
`store.test.ts` + `cli.test.ts` + `doctor.test.ts` (which hold the new timing tests,
including the 600 ms reader arm) run **5 times in a row**: 313 pass / 0 fail every time.
**No flake.**

---

## 1. MAJOR-1 — closed, and correct under WAL

`databaseBytes(db)` is now `page_count * page_size` off the open handle
(`commands.ts:2441`), `reclaimableBytes(db)` lost its `path`, and every size figure in
`migrate-cache` is read off a handle. I re-ran my own probe.

**Is `page_count` WAL-aware when the pages sit only in the `-wal`?** Yes — and this is the
decisive shape, which the builder's fixture does not quite reach. A store grown to 300 rows
inside one transaction, no checkpoint yet:

```
writer handle: pages*size=1236992  main=4096  wal=1252512
fresh handle : pages*size=1236992  main=4096
rows seen by the fresh handle: 300
```

The main file is **4,096 bytes** and the measure says **1,236,992** — correct, on the
writer's handle *and* on a second, freshly opened one. So both the dry run (which opens its
own handle) and the `--apply` path read the true size.

**Is the over-report gone?** Yes, on both arms:

```
C. reclaimable on a store with NOTHING to reclaim = 0        (aa2f50c reported 4,144,752)
D. real debt, after deleting half             = 2,056,192    (vacuumed copy: 2,056,192 — exact)
E. straight after a VACUUM, same handle: pages*size=2,056,192 while main is still 4,112,384
   reported reclaimed = 2,056,192  (the old statSync would have said 0 here)
```

Line E is worth noticing: it is the case the *original* `statSync` bug would have got
wrong in the other direction, and the new measure gets right without waiting for a
checkpoint.

**Does any size figure still read the file set?** No. The only `statSync` left in the
sizing path is `statSync(probe).size` on the `VACUUM INTO` output (`commands.ts:2469`),
which is correct — that copy is always a plain DELETE-mode file with no sidecars. The four
call sites (`2469`, `2576`, `2631`, `2749`) all take a handle. `verify` prints no byte
figure at all; its only size read is the same probe. Nothing in `verify` or `migrate-cache`
reads the file set any more.

The new fixture is a fair one: it converts a cache, then dirties every page with
`UPDATE embeddings SET dim = dim` to produce a >1 MiB `-wal` on a database with no garbage,
and asserts the dry run says "Converted and compacted. Nothing to do." and never prints
"reclaimable". The pre-existing real-debt test still names its debt (suite green).

## 2. The new doctor line — observer-safe, with two unreachable throws

**Observer safety: confirmed by hashing, not by assertion.** I hashed the whole store
directory (the `-shm` aside) around an observer `Store.open` plus the two `journalModeOf`
calls the doctor line makes, on a store built by the OLD build and on one built by the new:

```
### store built by the OLD build
  FIRST instrument open + ask -> box2 "delete", box3 "wal"
  canonical bytes: CHANGED
     CHANGED  cache/cache.sqlite      (the box-3 conversion — NIT-1, now pinned by a test)
     NEW      cache/cache.sqlite-wal 0
  SECOND instrument open + ask -> box2 "delete", box3 "wal"
  canonical bytes: UNCHANGED

### store built by the NEW build
  FIRST  instrument open + ask -> box2 "wal", box3 "wal"   canonical bytes: UNCHANGED
  SECOND instrument open + ask -> box2 "wal", box3 "wal"   canonical bytes: UNCHANGED
```

So: the *only* byte an instrument moves is the one-time box-3 conversion the builder now
has a named test for, `journalModeOf` itself moves nothing, and box 2 is left in `delete`
for the writer to convert. Isolated, on a store whose files already exist, `journalModeOf`
changed neither the database nor the `-wal` in either mode (hashed separately).

**What it says on the awkward stores.** Measured, each in a fresh process:

| state | `journalModeOf` |
|---|---|
| database absent | `"absent"`, and the directory is still empty afterwards — it does not create the file |
| DELETE-mode store | `"delete"`, files and bytes unchanged |
| WAL store, sidecars present | `"wal"`, database and `-wal` bytes unchanged |
| WAL header, sidecars gone, **writable** dir | `"wal"` — and it **creates** the `-shm` and a 0-byte `-wal` |
| WAL header, sidecars gone, **read-only** dir | **throws** `SQLITE_READONLY_DIRECTORY` |
| a file that is not a database | **throws** `SQLITE_NOTADB` |

The last two are the coordinator's question — "it must never throw out of doctor". It
does throw, but **neither state is reachable through doctor or verify**, because both
commands take an already-open `Store` and `Store.open` fails first on exactly the same
error (I proved the read-only-media arm in the first pass). So the user-visible behaviour
is unchanged. I am ranking it a NIT rather than letting it go, because the reason it is
safe lives in a neighbouring module: `journalModeOf` is called from two surfaces whose
whole job is to report rather than fail, and a `try { … } catch { return "unknown" }`
would make that true in this module. **NIT-B1.**

## 3. `journalModeOf` — "absent without creating", and the kept read-write handle

**Absent:** confirmed. `existsSync` guard, `"absent"` returned, no file created.

**Race:** `existsSync(path)` then `openDb(path)` is not atomic, and `openDb` opens with
`create: true`. If the file is deleted in the microseconds between, the question creates an
empty database rather than answering `absent`. On a live store nothing deletes box 2, and
the alternative (catching `SQLITE_CANTOPEN` from a read-only open) trades this for a
different failure. **NIT-B2**, worth a sentence in the comment, not a change.

**Does the kept read-write handle ever convert or write?** No, and this is now proved
rather than argued: `openDb(path)` is called without the `wal` option, so `convertToWal`
never runs. A DELETE-mode store asked the question ten times over stays `delete` with the
same bytes; box 2 stayed `delete` through two instrument opens above while box 3 went to
WAL through `openCache`. The builder's argument for keeping a read-write handle — that a
read-only one would refuse a sidecar-free WAL store and turn a one-word question into a
failure — is the right trade, and my first-pass measurement supports it (read-only fails
`SQLITE_CANTOPEN` on exactly that shape).

## 4. Open-time behaviour on the live path — unchanged, and re-proved

`convertToWal`'s body is byte-identical (only its comment grew). The pragma order is
untouched. `isLocked` gained a `?.` and nothing else. `journalModeOf` gained the
`existsSync` guard. So nothing on the open path moved, and I re-ran the cross-build
subprocess scenario against `44bab3e` anyway:

- old-build long-lived handle + new-build flip → old handle still reads and writes; both
  see 6 rows at the end. Unchanged.
- old-build **fresh** open while a new handle is open → `SQLITE_BUSY` at open in **1 ms**.
  Unchanged; BLOCKER-2 stands exactly as written.
- old-build fresh open with nothing else open → converts back to DELETE, all rows intact.
  Unchanged.
- One number I can now state that the first pass left blank: a contended *write* across
  builds waited the **full 5,252 ms** before failing, rather than failing instantly. That
  is the busy timeout doing its job; it changes no conclusion (the instant failure I
  reported was, and still is, the *open*).

## 5. The other first-pass findings

| finding | state |
|---|---|
| **MAJOR-1** databaseBytes over-report | **CLOSED** — `page_count * page_size`, re-measured above, plus a fixture |
| **MINOR-2** the ~1 ms claim | **CLOSED** — corrected in `db.ts`'s comment, in NOTES (with both measured numbers, 3 ms and 5,297 ms, and the note that the first cut generalized from the writer arm), in the PR body, and pinned by a new reader-arm test that holds a 600 ms read and asserts the open waits and then converts |
| **MINOR-4** the vacuous `existsSync(-wal)` | **CLOSED** — replaced by two real assertions: the `-wal` is non-empty (so a file-only copy would be short) **and** a `busy_timeout = 0` connection cannot take `BEGIN IMMEDIATE` during the copy (so the write transaction really is open across it). That is a stronger test than the `-journal` one it replaced |
| **MINOR-1** no trace of a refused flip | **CLOSED** — `journalFindings` in doctor: green on `wal`, amber otherwise with the reason and the way out, and a test that asserts the reading converts nothing. The builder's reason for a doctor line rather than an event row (an event would be a write at open, on the path that exists to avoid one) is right |
| **MINOR-3** `isLocked` null guard | **CLOSED** — `?.` |
| **MINOR-5** garbled-main-file-with-sidecars | **CLOSED** — decided, not deleted: a new test asserts that with the `-wal` in place SQLite recovers and `--rebuild` does its ordinary work, so the guard's branch really is the sidecar-free one. That is the right answer and it is now written down |
| **NIT-1** the box-3 conversion under an instrument | **CLOSED** — a named test asserts box 3 goes to WAL, box 2 does not, and the second instrument open moves no byte. My hash above agrees exactly |
| **NIT-2** `isDatabaseSidecar` skipping `-journal` | **CLOSED, and better than I asked for** — it now skips **only** the `-shm`, with the reason spelled out: a `-journal` during the changeover means an old-build writer is mid-transaction, which the byte-identity suites *should* see. Suite green with it |
| **MAJOR-2** read-only media | **CLOSED AS DOCUMENTED** — NOTES §"Three things a WAL store cannot do", item 1, with the exact two error codes and the point that `backup`/`export` output is always DELETE-mode and therefore readable anywhere. No code change, which is the right call for now |
| **MAJOR-3** a one-file copy opens and lies | **CLOSED AS DOCUMENTED** — NOTES item 2 and a new note under CONTRACT §5 G11: "`operational.sqlite` is no longer the database on its own". `migrate-cache`'s "copy box 3 aside" instruction now names the `-wal` as well, which was not asked for and is right |
| **BLOCKER-1** `?immutable=1` | **PARTLY** — the knowledge is now recorded where it belongs (NOTES item 3 and the CONTRACT note, both naming scar §2.4), but **the eight lines across seven documents that teach the recipe are untouched**: `docs/HANDOFF.md:79`, `docs/storage-spec-2026-09-16.md:94`, `docs/mechanism-inventory-2026-09-17.md:263`, `docs/promotion-diagnosis-2026-09-17.md:4`, `docs/finding-12-diagnosis-2026-09-17.md:5`, `docs/recall-surfacing-diagnosis-2026-09-18.md:4,482`, `docs/plan-parallel-rebuild-2026-09-18.md:165`. Those are living documents outside this PR's scope, so keeping them out of it is defensible — but the sweep must happen **before** the deploy, not after. It stays a deploy gate |
| **BLOCKER-2** old build, fresh connection | **UNCHANGED, by design** — it cannot be fixed in this PR (the code is on `master`). Handled by the procedure |
| **MINOR-6** `journalModeOf`'s read-write handle | **ANSWERED** — the absent case is fixed; the handle stays read-write with a stated reason I agree with. Residue is NIT-B1 |
| **Filesystems** | **CLOSED AS DOCUMENTED** — a NOTES paragraph covering the network-mount refusal, the `SQLITE_IOERR_SHMOPEN` shape and the synced-folder hazard |

---

## New findings in this pass

### NIT-B1 — `journalModeOf` has no catch, and it is called from two reporting surfaces
`db.ts:184-193`. Measured: it throws `SQLITE_READONLY_DIRECTORY` on a sidecar-free WAL store
on read-only media, and `SQLITE_NOTADB` on a garbled file. Neither is reachable through
`doctor` or `verify` today, because `Store.open` fails first with the same error — but that
is a guarantee from a neighbouring module, and a diagnostic should be unconditionally
answerable. **Smallest fix:** `catch { return "unknown" }` and let the amber branch say so.

### NIT-B2 — the `existsSync` / `openDb` window
`db.ts:185`. A file deleted between the check and the open is created empty rather than
answered `absent`. Unreachable on a live store; worth half a sentence in the comment.

### NIT-B3 — on a writable directory, asking the question creates the sidecars
Measured: on a WAL-header store whose sidecars are gone, `journalModeOf` answers `wal` and
leaves a new `-shm` and a 0-byte `-wal` behind. Under `doctor` this is invisible (the
Store's own handle made them a moment earlier), and the files are correct rather than
harmful. Naming it only so that "the reading converts nothing" is not read as "the reading
creates nothing".

---

## Deploy day, in order — what changes

The procedure from the first review stands. Three amendments:

- **Step 1 is smaller.** The reason `?immutable=1` is wrong is now written down in
  `store/NOTES.md` and CONTRACT §5 G11, so the sweep is a find-and-replace across the seven
  documents listed above rather than an explanation that has to be composed. It is still a
  **gate**: do it before the checkout moves.
- **Step 6 gets a better instrument.** `counterparts doctor` now grades the journal mode —
  green `wal`, amber with the way out — so after the deploy the check is
  `counterparts doctor` rather than reading `verify`'s line and interpreting it. Amber after
  a writer has run is the signal that something on an older build is opening the store and
  setting it back, which is exactly BLOCKER-2's fingerprint. `verify` still prints the mode,
  so either works.
- **Everything else is unchanged**, including the order: fix the recipe → backup while the
  store is still DELETE → close every old-build process **before** the deploy → deploy →
  one session so a *writer* opens (doctor and verify are observers and will not convert) →
  `doctor` green → `ls` the sidecars → `backup` → reopen everything. Standing rules
  unchanged: never run `counterparts` from a stale checkout, never copy `operational.sqlite`
  alone, never delete the `-wal`, not on a network mount or in a synced folder.

---

## Method

Same scratch worktree at the branch head, a second detached at `origin/master` re-added for
the cross-build subprocess runs and removed afterwards. All probes hermetic under the
session scratchpad, prefixed `f1-review-`. `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` exported
throughout. Nothing was pushed, commented or deployed; `/Users/mlapeter/counterparts` and
the live stores were never touched. One probe of mine failed on its own bug (I passed
`doctorFindings` an input without a config) and was replaced by a narrower one that
exercises the same mechanism; no permission refusals in this pass.

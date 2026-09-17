# Step 3 — "The Floor": implementation plan

*Saved from a read-only planning agent (Opus), 2026-09-17. A PLAN for the owner to read, not a ruling: nothing here is built, and every choice in it is a recommendation. Decisions it designs to are the working defaults in `docs/storage-spec-2026-09-16.md` §15, which are "for now".*

*Read-only planning pass. Code base: `/Users/mlapeter/counterparts/.claude/worktrees/step1-trial` (master + the unmerged step-1 batch, HEAD `7234a98`). No files were written; the plan is below in full.*

---

## 0. Plain-language summary

- Today a memory is a markdown file on disk *plus* a row in a database. About 16,000 files
  sit beside a 7 MB database, and the two can disagree. After this step there is one file:
  the database. Everything the system depends on is a row in it.
- You lose nothing you can read. The dashboard, `counterparts recall`, the CLI and asking
  the counterpart all still show memories as prose. Markdown becomes something you ask for
  (`counterparts export`) rather than something the system needs.
- The journal keeps being a folder of markdown files as well, written as each chapter is
  written. Nothing reads them back today; they are there because that is what survived v1.
- The database gets three protections it does not have: WAL mode (two programs can read
  and write at once), a wait-instead-of-fail timeout set *first* rather than last (the bug
  behind "database is locked", I38/I39), and an automatic rotating snapshot each day.
- What gets simpler: backup is one file copy instead of a file tree, a crash can no longer
  leave a row whose words are missing, deleting a memory is one transaction instead of a
  file chase, and about 1,200 lines of path-juggling code disappear.
- The risk is the changeover. **Your live memory is never migrated.** The old code keeps
  running the old store until the day you start a fresh blank one. The new code is built so
  it *refuses by name* to open the old store rather than half-converting it.
- The other risks: the version history now stores real words, so the 90-day version prune
  would delete your words — I recommend switching it off (question 1); and a long journal
  session stores each chapter twice, which I recommend measuring rather than optimising.

---

## 1. The target design

### 1.1 Tables (schema **v6**, `src/core/store/operational.ts`)

Everything below is a *fresh-store* DDL. There is no `ALTER TABLE` path from v5.

```sql
memories (
  id TEXT PRIMARY KEY, type TEXT, kind TEXT, band TEXT, band_day INTEGER,
  novelty REAL, relevance REAL, emotional REAL, predictive REAL, claimed REAL,
  birth_day INTEGER, uses REAL, last_used_day INTEGER, reinforced_days INTEGER,
  consolidated INTEGER, promoted_identity INTEGER, protected INTEGER,
  pressure REAL, last_challenged_day INTEGER,
  archived INTEGER, archived_reason TEXT, superseded_by TEXT REFERENCES memories(id),
  revision INTEGER, learned_on TEXT, happened_on TEXT,
  source TEXT, origin_session TEXT, origin_scope TEXT, origin_ref TEXT,
  -- NEW in v6; prose_path is GONE
  title        TEXT,                        -- was ProseDoc.title
  body         TEXT NOT NULL,               -- was the file below the fence. THIS is the memory.
  meta         TEXT NOT NULL DEFAULT '{}',  -- the payload's `meta`, verbatim JSON (G6 round-trip)
  confidential INTEGER NOT NULL DEFAULT 0,  -- was meta.confidential / meta.confidentiality
  content_hash TEXT NOT NULL                -- hashText(body), one definition, both tables
)
versions (
  memory_id TEXT REFERENCES memories(id), seq INTEGER, reason TEXT,
  version_day INTEGER, archived_at INTEGER, successor_id TEXT REFERENCES memories(id),
  -- NEW; `path` is GONE
  title TEXT, body TEXT NOT NULL, meta TEXT NOT NULL, content_hash TEXT NOT NULL,
  PRIMARY KEY (memory_id, seq)
)
```

`edges`, `prospective`, `gate_session`, `events`, `removal_record`, `removal_tombstone`,
`meta` are unchanged.

**`meta` stays one JSON column, not columns.** 28 distinct keys are in use across
`src/` and `tools/` (`entityId`, `updates`, `aliases`, `statedOn`, `chapters`,
`episodeKey`, `handles`, …), the set is open, and contract §3's "unrecognized fields
survive parse→serialize untouched" is satisfied for free by storing the text verbatim.
Only `confidential` is promoted, because it is a **gate**: a gate that must parse JSON on
every read is a gate that will one day fail open.

**The journal stays as it is today, now in rows.** A chapter is not a new table: one
`type = "episode"` row per session, chapters appended into its body with
`## Chapter N` headings by `src/core/self/episodes.ts#appendChapter`, each append going
through `Store.revise` and so keeping its version. That is the simplest thing that meets
decision 1 and it means `sleep/`, `prospective/derive.ts`, `recall/` and `self/` do not
change at all. The honest cost is in question 2.

### 1.2 What `Store` keeps and what changes

**Unchanged signatures, so the brain layer does not notice (decision 6):** `put`,
`putMany`, `revise`, `supersede`, `archive`, `updatePhysics`, `reinforce`, `setBand`,
`link`, `linkMany`, `setProspective`, `advanceClock`, `setMeta*`, `setGateRecords`,
`appendEvent`, `pruneEvents`, `setRanking`, `appendRemovalRecord`, `rebuildCache`,
`pruneDeadIndex`, `embedOne`, `read`, `readProse`, `row`, `resolve`, `list`,
`countMemories`, `versions`, `readVersion`, `physicsOf`, `search`, `nearestTo`,
`livedDay`, `today`, `events`, `tombstones`, `deniedIds`, `backupSet`, `assertLayout`.
`ProseDoc` and `StoredMemory` stay the read shapes — that is the seam that holds.

**Removed:** `Store.absolutePath()`, `Store.pathCensus()`, `PathCensus`, and from
`paths.ts` `stored.*`, `paths.prose/proseKind/proseFile/versions/versionsFor/versionFile/tmp`,
`resolveStoredPath`, `relativizeStoredPath`, `isCanonicalRelativePath`.
From `prose.ts`: `parseProse`, `readProseFile`, `stageProse`, `publishStaged`,
`archivePriorVersion`, `Staged`. From `errors.ts`: `PROSE_FRONTMATTER_MISSING`,
`PROSE_PAYLOAD_MISSING/MALFORMED/MISMATCH`, `PROSE_FILE_MISSING`,
`PROSE_META_UNSERIALIZABLE` (kept, see below), `ARCHIVE_COLLISION`, `STORED_PATH_ESCAPES`.

**Kept and moved:** `serializeProse` becomes `renderMarkdown(doc)` in
`src/core/store/render.ts` — it is now the **export renderer only**, nothing parses it back.
`assertJsonSafe` and `PROSE_META_UNSERIALIZABLE` stay: they now guard what goes into the
`meta` column (a function or a `NaN` in meta is still silent data loss).

**Added:** `StoredMemory.confidential: boolean`; `StoreError` code `STORE_PRE_ROWS`.

**LAYOUT (`paths.ts`) becomes four entries:** `counterparts.sqlite` (prefix, backup —
covers `-wal`/`-shm`), `cache` (exact, no backup), `spans` (exact, backup),
`journal` (exact, backup), `sessions` (exact, no backup). `prose`, `versions` and `tmp`
are deleted. See question 5 on the filename.

### 1.3 WAL and the busy timeout (`src/core/store/db.ts`)

Pragma order at open becomes, exactly:

1. `PRAGMA busy_timeout = 5000` — **first**, which is the I39 fix. Today it is set *after*
   `journal_mode`, so the journal-mode statement runs with zero wait inside another
   writer's commit window (spec §6.5, verified in the file).
2. `PRAGMA foreign_keys = ON` (unchanged).
3. `PRAGMA journal_mode` is **read first** and only set when it differs from `wal`. Today
   it is exec'd unconditionally, which is a write-at-open — an instrument opening a
   DELETE-mode store would convert it while standing down (contract §5, observer rule).
4. `PRAGMA synchronous = FULL` (unchanged; the standard WAL pairing is `NORMAL`, and that
   is a durability ruling, not a cleanup — left alone under line 15, flagged as a tunable).

The `-wal`/`-shm` sidecars are already classified: `LAYOUT`'s database entry is
`match: "prefix"` (spec §4 finding 7 — "the stated reason is gone"). `cache/cache.sqlite`
gets WAL too; its sidecars are inside the `cache/` directory.

### 1.4 Snapshots

- **What runs:** the existing `snapshot(store, target)` in `src/adapters/cli/snapshot.ts`,
  not `vacuumInto` alone. It copies exactly `store.backupSet()`, so it is correct on both
  floors: on today's store that is the database *plus* `prose/`, `versions/`, `spans/`; on
  the new one it collapses to the database, `spans/` and `journal/`. A database-only
  snapshot on the current store would re-enact scar §2.11's incident (the canonical journal
  silently absent for three weeks).
- **Where:** `<baseDir>/snapshots/<iso-name>/`, i.e. a sibling of `store/` inside
  `~/.counterparts`. It must be outside the store directory — `assertSafeTarget` already
  refuses a destination inside the store, and a destination inside would land an
  unclassified top-level path in the store. Optional second location via config.
- **New module `src/adapters/snapshots.ts`:** decides *whether* to run (at most one per
  calendar day; skip if today's exists), calls `snapshot()`, then **rotates** — keep the
  newest `keep` (default 14), delete the rest oldest-first, and report what went and how
  many remain (scar §2.4). Rotation deletes, so it lives in an adapter, never in core
  (contract §5 G2: the store exports no delete of any kind).
- **When:** a fourth step in `src/adapters/claude-code/bin/runner.ts`, after the sleep
  cycle. Deliberately **not** a `sleep/cycle.ts` phase — decision 6 says sleep must not
  learn that the floor changed.
- **Config:** `snapshots: { dir?, keep?, mirror? }` in `claude-code.json`, parsed in
  `src/adapters/claude-code/config.ts` (which validates keys strictly, lines 247–280; an
  unparsed key is dropped silently, so it needs an entry).
- **Durable reporting:** `snapshot.taken` / `snapshot.failed` / `snapshot.rotated` rows via
  `Store.appendEvent`, registered in `src/adapters/dashboard/registries.ts`; a `fired.ts`
  entry `id: "snapshot"`; a doctor line ("last snapshot <date>, 14 kept, oldest <date>",
  amber past 48 h). Note in the code: the `snapshot.taken` row is written *after* the copy,
  so a snapshot never contains its own record — it appears in the next one.
- **It never throws.** CLI CONTRACT §5 G8 and the same reasoning as the worker's
  degrade-don't-abort rule: a snapshot problem must not take a consolidation cycle down.

### 1.5 The journal's markdown copy

- **New module `src/core/self/journal-file.ts`** (~60 lines), called by
  `self/index.ts#appendChapter` immediately after the store write returns.
- **By owner decision 2 this is the one brain module that treats `Store.dir` as a
  filesystem root.** State it in the module header rather than letting a reviewer find it;
  `remember/spans.ts` is the precedent for a core module that owns a directory.
- **Naming:** `journal/<YYYY>/<YYYY-MM-DD>-<episodeId>.md`, whole-file rewrite on every
  append (the episode row is revised per append, so a per-chapter file append would have to
  reconstruct what is already in the row; a whole-file write is idempotent and a chapter
  never changes once written). Frontmatter is the same render as export.
- **On failure:** caught, never thrown into the host; one `journal.copy.failed` event row
  with the reason code; the store write already landed and is canonical, so nothing is lost.
- **Observer stance:** an instrument writes nothing, so the copy is skipped under observer.
- **Seen working:** a `fired.ts` entry `id: "journal-file"` on
  `journal.copy.written` / `journal.copy.failed`, plus a doctor count over seven days.

### 1.6 Export (`src/adapters/cli/export.ts`)

- The bundle becomes **the database alone**, still through `VACUUM INTO`, plus `journal/`
  and `spans/`. The `prose/**` walk goes.
- The `VACUUM INTO` scratch currently lands in `paths.tmp(store.dir)`. With `tmp/` gone, a
  scratch file in the store directory would fail the next `assertLayout`. The scratch moves
  into the export **target**, which `assertSafeTarget` already proves is outside the store.
- New `--markdown`: renders `journal/` and one `.md` per memory (and, from step 4, pages)
  through `render.ts#renderMarkdown`. Question 4 covers confidential rows.
- `--passphrase` / `--plaintext` and the refusal-with-no-default are untouched.

---

## 2. The cut-over (decision 5) — recommendation: **a clean cut at a tag**

**Why, not "two floors behind one interface".** A version-selected old floor means
`prose.ts`, `stored.*`, `resolveStoredPath`, `relativizeStoredPath` and the v4/v5 placement
rules all survive as live, tested code — carrying the code, which is exactly what
constitution line 14 forbids — and it doubles the test matrix for a floor that is being
retired in weeks. The mechanism that makes the clean cut safe already exists:

**`tools/deploy-checkout.sh` pins the runtime.** `~/counterparts` is both the repository
and the runtime; hooks are fresh processes that run whatever is checked out there, and
**a merge to master deploys nothing until the checkout moves** (I36). So:

1. Tag the last commit that can open a v5 store: `floor/v5-last`.
2. Phases 1–4 deploy normally (they are safe on the live store and two of them *help* it).
3. Phases 5–8 merge to master, but the shared checkout **stays detached at the tag** until
   cut-over day. `doctor` will read amber ("behind master") for those weeks **on purpose** —
   say so in `docs/HANDOFF.md` so nobody "fixes" it by deploying.
4. A `hotfix/v5-floor` branch off the tag exists for anything the live store needs
   meanwhile.
5. **Cut-over day, in order:** `counterparts backup --out <somewhere off the store>` ·
   `counterparts init --dir ~/.counterparts/store-v2` ·
   `counterparts install --dir ~/.counterparts/store-v2` (rewrites
   `~/.counterparts/claude-code.json#dataDir`, `install.ts:309`) · re-run the
   `claude mcp add counterparts -s user -e COUNTERPARTS_DATA_DIR=… ` line it prints
   (`install.ts:401`) · `tools/deploy-checkout.sh` · restart Claude Code.
6. **Rollback:** re-detach the checkout to `floor/v5-last` and point `dataDir` back. The old
   store was never opened by new code, so it is byte-identical to the moment before.

**The one hazard that can destroy the live store, and its guard.** `openOperational` today
migrates any store below `SCHEMA_VERSION`: DDL, `ensureAddedColumns`, then it stamps the new
version. If v6 added `body` through `ADDED_COLUMNS`, new code opening the live v5 store as a
writer would "migrate" it — every body NULL, every `prose_path` orphaned, stamped v6, and
now unreadable by the old checkout too. So:

- **v6 refuses a pre-v6 store by name, before any transaction**, with
  `STORE_PRE_ROWS { found, expected: 6, readableBy: "floor/v5-last" }`.
  Nothing is added to `ADDED_COLUMNS`. `OBSERVER_READ_FLOOR` becomes 6.
- The named check runs **in the `Store` constructor before `openOperational`**, because
  `assertLayout()` would also refuse (an unclassified `prose/`) but only after the database
  was opened, and a refusal that names the layout instead of the floor is the wrong sentence.
- **Acceptance test:** a fixture directory with `prose/` and `meta.schemaVersion = '5'`;
  `Store.open` throws `STORE_PRE_ROWS`; afterwards `schemaVersion` still reads `5` and
  `PRAGMA table_info(memories)` has no `body`.

**Failure modes of the clean cut, named:** (a) the checkout is deployed early by habit — the
`STORE_PRE_ROWS` refusal turns that into a loud broken session rather than a corrupted
store, and the rollback is one `git checkout --detach`; (b) the MCP registration is not
re-run and the server keeps `COUNTERPARTS_DATA_DIR` pointed at the old store — the refusal
catches it at the first tool call, and the step-2 verification note ("the memory server
reports `scope source: project`") is the same class of same-day check; (c) something the
owner wanted is only in the old store — it is still on disk, read-only, and the hand-carry
is its own later session.

---

## 3. Phases

38 test files; **34** open a store or make a data dir (this is the spec's "32–36 touch file
layout in passing"); **16** name the layout explicitly and will need edits:
`store.test.ts` (37 references), `store-portable.test.ts` (39), `cli.test.ts` (11),
`sleep.test.ts` (4), `counterpart.test.ts` (2), `dashboard-web.test.ts` (2),
`replay.test.ts` (2), `self.test.ts` (2), `dashboard.test.ts` (1),
`claude-code.test.ts` (1), plus `schemas.test.ts:1340`, `migrate.test.ts:376`,
`mcp.test.ts:131`, and `parallel.test.ts` / `probe.test.ts` / `demo-seed.test.ts` via helpers.

Phases 1 and 2 deploy to the **existing** live store; 3–8 land behind the pinned tag.

### Phase 1 — WAL, the busy timeout, and I39
*Owns:* `src/core/store/db.ts`, `src/core/store/NOTES.md` §9, `test/store.test.ts` (one new
block), one line in `verifyCensus` (`src/adapters/cli/commands.ts:2194`).
*Changes:* pragma order above; the conditional journal-mode set.
*Verified:* a test opens two handles, holds a write transaction on one and asserts the other
**waits** rather than throwing instantly; a test asserts `busy_timeout` precedes every other
pragma; a test asserts an observer open of a DELETE-mode store leaves the mode alone.
*Pre-check:* `test/replay.test.ts:256,444` pins DELETE mode and refuses a WAL database — that
is the **replay corpus index**, which has its own opener and does not import `store/db.ts`
(`tools/replay/corpus.ts:17`). Unaffected; say so in the PR so the reviewer does not stall.
*Seen after deploy:* the first **writer** open flips the file header; the long-running MCP
server picks it up on its next transaction. `counterparts verify` prints
`journal mode: wal (busy timeout 5000 ms)`. Check it on the live store the same day, and
check the **dashboard** still opens — a read-only connection to a WAL database needs write
access to `-shm`, which is unverified (risk 1).

### Phase 2 — automatic rotating snapshots
*Owns:* new `src/adapters/snapshots.ts`, `src/adapters/claude-code/bin/runner.ts`,
`src/adapters/claude-code/config.ts`, `src/adapters/claude-code/doctor.ts`,
`src/adapters/fired.ts`, `src/adapters/dashboard/registries.ts`, `test/cli.test.ts` (new
block), `test/doctor.test.ts`, `test/fired.test.ts`.
*Changes:* §1.4. `cli/snapshot.ts` is **not** edited — it is reused as-is.
*Verified:* rotation keeps N and reports the deletions; a second run the same day is a
no-op; a failed copy produces a `snapshot.failed` row and exit 0 from the worker; the
existing "hold an open write transaction across the copy" test still passes under WAL.
*Cost named:* on today's store a copy is ~67 MB and ~16,400 files. Daily cadence, inside a
watchdogged worker — measure the wall time in the first week; it collapses to one file on
the fresh store.
*Seen after deploy:* `~/.counterparts/snapshots/` fills; `counterparts fired` shows
`snapshot — firing`; doctor prints the last snapshot and the count.

### Phase 3 — consumers off the file layout (old floor, suite green)
*Owns:* `src/core/schemas/index.ts` (191, 1124), `src/adapters/cli/commands.ts`
(3361, 3402, 3413), `src/adapters/dashboard/browse.ts:185`,
`src/adapters/dashboard/web/views.ts:892–895`, `src/core/recall/activate.ts`
(`isConfidential`), `src/core/counterpart.ts:2480`, `src/core/store/index.ts`
(`StoredMemory.confidential`, computed from `doc.meta` for now — no schema change).
*Changes:* every `readProseFile(store.absolutePath(row.prose_path), id)` becomes
`store.readProse(id)`; the dashboard stops printing a filesystem path and prints
id · revision · content hash; `isConfidential` reads the flag off `StoredMemory`.
*Tests:* `dashboard.test.ts`, `dashboard-web.test.ts`, `schemas.test.ts`, `recall.test.ts`.
*Seen:* nothing new fires. This is a refactor; the suite is the evidence.

### Phase 4 — one test fixture for stores
*Owns:* new `test/store-fixture.ts` (`makeStore`, `bodyOf`, `versionBodies`), and the
mechanical conversion of the 10 incidental layout-touching test files.
*Why it is its own phase:* it takes ~10 files out of Phase 5's diff, so Phase 5 edits the
helper plus two store test files instead of sixteen. Independently mergeable, zero behaviour
change.

### Phase 5 — the floor (the one phase that cannot be split)
*Owns:* all of `src/core/store/` · `src/adapters/cli/removal.ts` (673, 755–760, 775, 833,
839) · `src/adapters/cli/export.ts` (the `prose/` walk and the `tmp/` scratch) ·
`src/adapters/cli/snapshot.ts` (nothing to change, re-verified) · `tools/demo/seed.ts:82` ·
new `tools/parallel/legacy-paths.ts` (`resolveStoredPath`, `relativizeStoredPath` move here
for `tools/parallel/readers.ts:1283,1432`, which reads the *old* store with its own
read-only opener and is retired in step 6) · `test/store.test.ts`,
`test/store-portable.test.ts`, `test/store-fixture.ts`, `test/mcp.test.ts:131`.
*Changes:* schema v6, the `STORE_PRE_ROWS` refusal, bodies and versions in rows, LAYOUT
trimmed to four entries plus `journal`, the removal chase becomes column blanking inside the
existing transaction (`body = ''`, `title = NULL`, `meta = '{}'`, `content_hash = ''`;
`rowTombstoned` becomes `body === '' && content_hash === ''`), `OwnerOpAccess.reindexLexical`
reads the row.
*Verified:* the v5-refusal test above · a kill-at-any-point test leaves the store readable
(the crash window between "commit the row" and "publish the file" no longer exists) · copy a
store, destroy the source, read and remove through the copy (I22's scar without I22's code) ·
`putMany({isolate})` per-item isolation still holds · round-trip of `meta` including unknown
keys · box 3's behavioural rebuild test unchanged.
*Seen after deploy (cut-over day):* `counterparts verify` prints
`schema v6 · bodies in rows · prose files: none`; `counterparts status` opens the fresh
store; the first `mcp__counterparts__note` lands and `store.put` appears in the event log.

### Phase 6 — the journal's markdown copy
*Owns:* new `src/core/self/journal-file.ts`, `src/core/self/index.ts#appendChapter`,
`src/adapters/fired.ts`, `src/adapters/claude-code/doctor.ts`, `test/self.test.ts`.
*Verified:* a chapter write produces a file whose text matches the row; a write into an
unwritable directory produces a `journal.copy.failed` row and does **not** throw; observer
stance writes nothing.
*Seen:* `counterparts fired` shows `journal-file`; the files appear under
`<store>/journal/2026/`.

### Phase 7 — export
*Owns:* `src/adapters/cli/export.ts`, `src/core/store/render.ts`, `test/cli.test.ts`.
*Verified:* an encrypted export round-trips and opens standalone; `--markdown` renders every
live memory and every journal chapter; the scratch file never lands in the store directory
(assert `assertLayout()` passes immediately after an export).

### Phase 8 — the contract, and the deletions
*Owns:* `src/core/store/CONTRACT.md` (rewritten fresh, §5 below), `src/core/store/NOTES.md`
(rewritten: §1, §2, §3, §5 and the 2026-09-05 self-contained note all go),
`tools/migrate/**` + `test/migrate.test.ts` deleted, `docs/storage-spec-2026-09-16.md` §16
item 3 ticked, `docs/HANDOFF.md`.
*Pre-check:* nothing under `tools/parallel/` or `tools/replay/` calls `Store.open` on the
live store — both use raw read-only `Database` handles (`readers.ts:338–353`,
`corpus.ts:128–133`) — so they survive the cut-over and retire with step 6 as planned.

---

## 4. What gets deleted, and which scars are carried

**Contract guarantees deleted outright** (`src/core/store/CONTRACT.md`):
§3 "Prose is canonical and readable in any editor" · §3 "Archive-on-overwrite, atomic and
collision-proof, with temp files named so a crash-leaked one cannot be loaded as a
duplicate" · §3 "The strength-only exemption to archive-on-overwrite" · §3 "A store
directory is self-contained" (the *property* survives; the store-relative-path *mechanism*
goes) · §5 G5 (rewritten) · §5 G15 in full · §7 open question 2 (answered: no) · §7 open
question 3 (deleted: there is no import).

**NOTES sections deleted:** §1 (prose format — moves to `render.ts` as export documentation)
· §2 and §2b (the exemption argument) · §3 (versions prune rows, files never deleted —
no longer true, see question 1) · §5 (the stage→commit→rename crash window) · §9's WAL
paragraph · the whole 2026-09-05 "store directory is self-contained" note.

**Code deleted:** ~1,200 lines across `prose.ts` (the parser, the stager, the archiver),
`paths.ts` (the placement rules and the census), `index.ts` (`absolutePath`, `pathCensus`,
the file publish/unlink paths), `removal.ts`'s file chase, `export.ts`'s prose walk,
`tools/migrate/**` (5 files) and `test/migrate.test.ts` (1,062 lines).

**Scars carried as acceptance criteria (line 14 — port the scars, not the code):**

| scar | criterion in the new floor |
|---|---|
| §2.11(a) backup scope asserted against the layout | `assertLayout()` + `backupSet()` still break the build on an unclassified path; the `journal/` copy **must** be classified before it is written (v1 lost its journal from snapshots for three weeks exactly this way) |
| §2.11(b) a canonical database is never file-copied | `VACUUM INTO` in `snapshot()` **and** in `export`; the "hold an open write transaction across the copy" test survives, now under WAL |
| §2.12 the cache-rebuild contract is a test | unchanged: delete box 3, rebuild, assert the same recall for the same cues; declare what cannot be recomputed |
| §2.13 path guards resolve before they compare | `assertSafeDataDir`, `assertSafeTarget`, and now the snapshot directory *and* its mirror |
| §2.1 multi-writer structured state needs a transaction | strengthened: there is no non-transactional canonical state left |
| §2.2 supersede retargets every inbound reference | unchanged |
| §2.4 every discard says what and how much | extended to snapshot rotation |
| §2.6 / §2.7 one seam; no model-reachable removal | unchanged, including the `owner-op-seam.ts` export-name pin |
| §2.19 permanence and write bar | a removed protected element still shows as `[removed]` in the tombstone list |
| §2.20 content-by-reference | sharpened: the journal markdown copy is body text on disk, so no telemetry may name it, and question 4 rules on confidential chapters |
| I22 the copied-store bug | criterion kept ("a store never reads another store's data"), mechanism deleted — copy, destroy the source, read and remove through the copy |
| I38/I39 "database is locked" | busy_timeout is set before any other pragma; two handles, one holding a write transaction, and the second waits |
| NOTES §5's crash window | criterion becomes "a crash never leaves a row whose words are missing", now structurally true; proved with a kill-at-any-point test |

**Scars that no longer apply:** temp-file naming (§16 G4's "a crash-leaked stage must not
load as a duplicate"), the archive-collision `wx` loop, the absolute-vs-relative placement
rule, "the loader reads only `*.md` under `prose/`", and "`journal_mode = DELETE` because
every top-level path must be classified".

---

## 5. The new store CONTRACT — outline only

Target ≈130 lines; a contributor reads it in one sitting.

1. **Purpose** — two boxes and one seam: one canonical transactional database, one
   rebuildable search cache. *(3 lines)*
2. **Brain analog** — none, deliberately: exactness where the brain is reconstructive. *(3)*
3. **Keeps** — bodies are rows the owner can view; ids immutable, type-prefixed, resolution
   follows lineage; every mutable sub-item has a stable handle; revision keeps its history;
   removal is recorded, append-only, carries no body and no hash; per-item persistence
   isolation; three dates, two clocks; one content-address function. *(≈25)*
4. **Drops / simplifies** — the prose box, the versions tree, `tmp/`, the path columns, the
   placement rules, the temp-naming ceremony, the strength-only exemption; markdown is an
   export; the journal also gets a file copy, as a copy. Each with the line that earned it. *(≈20)*
5. **Contract** — inputs, outputs, and the guarantees, marked **[M]** / **[A]**:
   G1 one seam · G2 no delete export except the owner-op seam · G3 no hand-serialized
   mutable state · G4 referential integrity in the store · G5 an overwrite keeps the prior
   version, body included, in the same transaction · G6 removal is one transaction, so every
   crash point is safe · G7 everything that must read doomed content reads it first ·
   G8 box 2 is behaviourally rebuildable · G9 path guards resolve both sides · G10 telemetry
   is content-by-reference · G11 every top-level path is classified · G12 [A] raw
   conversational text is not the system of record · G13 reads of archived / superseded
   content emit an event · G14 the implicit default is refusable · **G15 a store written by
   an older floor is refused by name, never migrated** · **G16 WAL plus a busy timeout on
   every handle, set first; an instrument sets no pragma that writes** · **G17 a snapshot is
   a `VACUUM INTO` of the classified backup set, rotated by an adapter, and its outcome is a
   durable row.** *(≈55)*
6. **Scars honored** — the table in §4 above, one line each. *(≈12)*
7. **Open questions** — three, from §6 below. *(≈8)*

---

## 6. Open questions for the owner

1. **The version prune now deletes your words.** *ELI5:* every time a memory is rewritten,
   the old wording is kept. Today the old wording is a file that is never deleted, and only
   the database's *note* about it expires after 90 days. Once the wording lives in the
   database, that same 90-day rule deletes the wording itself. — **Recommendation: switch
   the prune off for the fresh store** (`retentionDays: Infinity`, or delete
   `pruneSupersededVersions`). The live store's whole version history is 483 rows and 3 MB.
   Constitution line 7 says revisions keep their history; line 15 says don't build the
   pruner until size is a named problem.
2. **A long journal session stores its earlier chapters more than once.** *ELI5:* each time
   a chapter is added, the whole diary entry so far is copied into the history table. Six
   chapters of 2 KB costs about 36 KB instead of 12 KB. — **Recommendation: accept it for
   now and measure.** At five sessions a day that is roughly 65 MB a year, and the fix
   (exempting append-only revisions from versioning) is exactly the kind of diff-based
   machinery constitution line 15 says to wait for. Revisit if `versions` passes 200 MB.
3. **Where do snapshots live, and how many?** — **Recommendation:
   `~/.counterparts/snapshots/`, keep 14, at most one per calendar day**, plus an optional
   `mirror` path (an external disk or an iCloud/Dropbox folder). Anything inside the store
   is refused by the existing guard, and rightly: a backup inside the thing it is backing up
   is not a backup.
4. **Do confidential memories appear in the journal files and in `export --markdown`?**
   *ELI5:* the journal copy is the counterpart's own diary in a folder only you see; the
   export is a thing you can email. — **Recommendation: the journal copy is written as-is;
   `export --markdown` omits confidential rows unless `--include-confidential` is passed,
   and says how many it omitted.**
5. **Does the fresh store's database keep the name `operational.sqlite`?** *ELI5:* the name
   means "the operational bits beside the real memories", which stops being true. —
   **Recommendation: `counterparts.sqlite`.** It costs one LAYOUT line and one `paths.ts`
   line because there is no migration to worry about, and a name that lies is a name
   somebody will one day act on.
6. **When is cut-over day, and does anything come over by hand that day?** —
   **Recommendation: pick the date after Phase 8 merges, and carry nothing that day.** Bring
   v1's self and person pages over in their own later session through the owner door
   (§15's steer: don't overbuild the part users never touch). The old store stays on disk,
   read-only, forever.

---

## 7. Risks, and what I could not determine

1. **Read-only opens under WAL are unverified.** A read-only SQLite connection to a WAL
   database needs to create or write `-shm`. `tools/parallel/readers.ts` and the dashboard
   open the live store `readonly: true`; if the directory or the sidecar is not writable by
   that process they will fail where they used to succeed. This is the one thing in Phase 1
   that touches the live store's readability — check the dashboard and
   `counterparts status` on deploy day. (`tools/replay/corpus.ts`'s WAL refusal is a
   *different* database and is not affected.)
2. **The Node branch has never been live-verified** (`NOTES.md` §9). `node:sqlite` + WAL +
   `VACUUM INTO` is untested. Bun is the runtime; this only matters at packaging.
3. **No measurement exists of the fresh store's growth with bodies in rows.** The only
   numbers I have are the current store's 67 MB of prose and 3 MB of versions. Questions 1
   and 2 are therefore judgement calls, not arithmetic.
4. **`src/adapters/cli/commands.ts` is 4,242 lines and I read about 600 of them.** I found
   three prose-path readers there; there may be more. A `grep -n "absolutePath\|prose"` over
   that file is the first thing Phase 3 should do.
5. **Whether `test/parallel.test.ts` (4,722 lines) pins anything in core that Phase 5
   breaks.** My layout grep says no, but it opens stores, and step 6 of the rebuild order
   exists because it pinned things once before.
6. **I did not verify that the journal markdown copy is wanted for *every* chapter rather
   than once at session end.** The spec's wording is "as they are written". Per-append is
   the reading I took; per-session-end is cheaper and loses a crashed session's last chapter.
7. **Out of scope and assumed:** the page renderer, the nightly self-page session and the
   handoff lane (steps 4 and 5) will want new tables. Nothing in this plan forecloses them —
   a `pages` table and a `handoffs` table are additive against v6 — but I have not designed
   them, and the temptation to design them *inside* this step is the main way this phase
   becomes three weeks instead of one.

---

## Summary (under 250 words)

Step 3 moves memory bodies, their version history and the journal out of ~16,000 markdown
files and into the one canonical SQLite database, behind the unchanged `Store` interface, so
`physics/`, `recall/`, `associate/`, `prospective/`, `encode/` and most of `sleep/` never
learn the floor changed. Markdown becomes an export; the journal keeps a file copy written as
each chapter lands. The database gains WAL, a busy timeout set *before* the journal-mode
pragma (the I39 fix), and a daily rotating `VACUUM INTO` snapshot in `~/.counterparts/snapshots`,
reported as durable event rows, a `fired.ts` entry and a doctor line.

There is no migration. I recommend a **clean cut at a tag**: `deploy-checkout.sh` pins the
runtime, so phases 1–2 (WAL, snapshots) deploy to the live store now, phases 3–8 merge while
the checkout stays detached at `floor/v5-last`, and cut-over day is init + install + re-register
the MCP server + deploy + restart. The one thing that could destroy the live store is
`openOperational`'s migrate-at-open path; v6 must refuse a pre-v6 store by name
(`STORE_PRE_ROWS`) before any transaction, with a test proving the file is untouched.

Eight phases, each independently mergeable, with named file ownership. 38 test files; 34 open
a store; 16 name the layout and need edits — a shared fixture phase pulls ten of those out of
the floor swap, which is the one phase that cannot be split.

Six questions for the owner; the sharpest is that the 90-day version prune would now delete
his own words — I recommend switching it off.

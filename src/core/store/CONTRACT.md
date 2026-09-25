# `store/` — CONTRACT

## 1. Purpose

The substrate: **two** boxes — one small canonical transactional database
(`counterparts.sqlite`), one rebuildable search cache (`cache/`) — and the single seam
every write crosses. Since the floor (schema v6, 2026-09-20) **a memory IS a row**: its
title, its words, its metadata and its archived versions are columns. Markdown is an
export (`render.ts`), written one direction only; nothing reads it back.

## 2. Brain analog

None, deliberately. This is the engineering floor the brain does not have: **exactness
where the brain is reconstructive** (constitution line 9 — "biology's rules without
biology's limits"). Human memory has no separable substrate; conflating the two is how v1
ended up with canonical state spread across a prose store plus half a dozen sidecars
(Appendix A #14).

## 3. Keeps

- **The owner can VIEW every memory.** Constitution line 6, in the owner's own words
  (2026-09-16): "going forward by 'readable' we mean if someone can view them" — in a file
  or in the database. The dashboard, `counterparts recall`, the console and asking the
  counterpart all show the words; `counterparts export` writes markdown. What is not
  claimed is that every memory IS a markdown file.
- **Round-trip fidelity extends to metadata** — unrecognized fields survive untouched.
  [v1] §4.2 G6 (v1 incident: a parser silently dropped tier, frequency, provenance and
  aliases on rewrite). *Free since the floor: `meta` is one TEXT column holding the JSON
  verbatim, and a value JSON would drop or transform is refused before the row is written
  (`assertJsonSafe`, `PROSE_META_UNSERIALIZABLE`) rather than truncated — the one guard
  that outlived the markdown parser.*
- **Ids are immutable, never reused, type-prefixed; resolution follows lineage; a cycle,
  a dangling id, or an over-deep chain is a hard error.** [v1] §4.2 G2, test-triage P1
  `ids.test.ts`.
- **Every mutable sub-item carries a stable handle. The body is the content; the handle is
  the identity.** [v1] §4.2 G1.
- **Archive-on-overwrite, in one transaction.** [v1] §16 G4. *Since the floor the prior
  version is a ROW written beside the update — body, title, meta, hash and both provenance
  dates — so "atomic and collision-proof" is a property of the transaction: no `wx` loop,
  no temp-file naming ceremony, and no crash-leaked stage that could be loaded as a
  duplicate, because there is no stage.*
- **Destruction enforced by absence**, with a caller-universality test. [v1] §16 G1–G2,
  earned-mechanism #14: "the shape — enforced by absence, verified mechanically — is worth
  more than the specific mechanism."
- **Removal is recorded, the record is canonical and append-only, and carries no body and
  no content hash.** [v1] §16 G7–G9, scar §2.20.
- **A removed memory cannot be silently resurrected** — a deny-list at load and rebuild;
  the stray copy is skipped and logged, never deleted. [v1] §16 G12.
- **Per-item persistence isolation** — one item that fails to serialize is logged and
  skipped; the rest persist. [v1] §16 G6.
- **Three dates, deliberately distinct**: when it happened (at stated precision, never
  rounded), when it was learned, which lived day it was born on. [v1] §4.2. The first two
  come from the session's INJECTED clock (`StoreOptions.now`), the third from the physics
  clock (`advanceClock` / `livedDay`) — two clocks, never one (`NOTES.md` 2026-09-05).
- **One content-address function**, so a raw span, a run record and a rejected proposal
  join on the same key. [v1] §17.1. *Since the floor it is `hashText(body)`, one definition
  across `memories` and `versions`, where it used to address the whole serialized document:
  a title-only revision no longer moves it, and two memories differing only in title share
  it. `NOTES.md` 2026-09-20 traces where the column travels and why the weaker preimage is
  acceptable.*
- **A store directory is self-contained.** A copy, a move or a restored backup reads and
  removes its OWN memories and never another store's (finding I22, 2026-09-05).
  Constitution line 6 — local-first, portable — and line 7's "backups catch catastrophe"
  both rest on it: a backup that still pointed at the live store was not a backup. *G15
  below: structural since the floor rather than enforced.*

## 4. Drops / simplifies

- **The three boxes are two** (owner decision 2026-08-25, settled; revised by the same
  owner 2026-09-16/17 — `docs/storage-spec-2026-09-16.md` §15 item 9, "everything lives in
  the database for now; markdown is an export"):
  1. ~~**Canonical prose** — one markdown file per memory.~~ **GONE at the floor.** About
     16,000 files sat beside a 7 MB database and the two could disagree. With them went
     `prose/`, `versions/`, `tmp/`, `memories.prose_path`, `versions.path`, the placement
     rules, the census and ~1,000 lines of path-juggling. The MARKDOWN survives as
     `render.ts#renderMarkdown`, the export renderer, which keeps the format's one testable
     property — a section never used renders byte-identically to a document that predates
     the section ([v1] §4.2 G8, `test/store.test.ts`). The journal ALSO keeps a file copy,
     as a copy, because plain files outlive the system that wrote them (§15 item 9): one
     `journal/<YYYY>/<YYYY-MM-DD>-<id>.md` per episode, written by the worker as each
     chapter lands, never read back, derived and regenerated if deleted.
  2. **One small canonical transactional SQLite** — the memories themselves (`title`,
     `body`, `meta`, `confidential`, `content_hash`), their archived versions, and the
     structured state around them: ids, kinds, salience, `uses`, day stamps, lineage rows,
     entity/belief rows, prospective windows, the removal record, per-session gate state.
     **Transactional**: every multi-step change commits or does not.
  3. **A separate rebuildable cache** — embeddings and full-text index. **Never backed
     up**, always reconstructible, and its loss is a re-index, never a memory. Vectors are
     float32 BLOBs (`dim` little-endian singles, cache schema v4, 2026-09-05) — the
     embedder's own precision, 2.8× smaller and ~11× faster to scan than v3's JSON text
     (measured; `NOTES.md`). "Reconstructible" is honest for the text index and partly
     dishonest for the vectors: those cost a paid network call each, which is why
     `rebuildCache({ keepVectors })` and `counterparts migrate-cache` exist rather than a
     rebuild. **Since cache v5 (2026-09-23) the vectors say which model wrote them** —
     `cache_meta.embedder = <model>@<dim>` beside `embedderRebuild = inline|external` — and
     `Store.open` checks that tag against the configured embedder's identity ONCE, at open
     (`cache.ts#reconcileEmbedder`, verdict on `Store.embedderVerdict`): a match touches
     nothing and takes no lock; no embedder touches nothing; a static table's rows under
     another identity are dropped and refilled inline, batched and time-bounded; **paid
     rows are never dropped at open** — any other identity configured HOLDS them, durably
     (`cache_meta.embedderHeld`), so no handle on the file ranks or writes vectors until
     the configuration goes back or `verify --rebuild --drop-vectors` drops them. Every
     transition writes a durable `store.embedder.reconciled` row. A cache written by a
     NEWER build is left exactly as found: its version is never stamped down, the vector
     channel is off by name (`cache-ahead`), and a rebuild refuses `SCHEMA_AHEAD`. Every
     vector write and every ranking re-reads the file's claim against the handle's own
     identity, so a handle open all session never files or ranks under another model's
     tag. *(2026-09-23: the local static table is the primary embedder; the paid Voyage
     seat is FROZEN — deprecated, kept, and its paid-rows hold kept with it.)*
- **The markdown parser is gone, and with it the "refuses ambiguity" guarantee it carried**
  ([v1] §4.2 G7): the frontmatter reader, the authoritative `payload:` line that existed so
  a lossy YAML reading could never become the truth, and the six refusal codes around them
  (`PROSE_FRONTMATTER_MISSING`, `PROSE_PAYLOAD_MISSING/MALFORMED`, `PROSE_FILE_MISSING`,
  `ARCHIVE_COLLISION`, `STORED_PATH_ESCAPES`). Nothing parses markdown back, so there is no
  ambiguity to refuse. What replaced `PROSE_FILE_MISSING` is `MEMORY_BODY_MISSING`, which
  says the same thing about a row and is told apart from a tombstone by the hash beside it.
- **The strength-only exemption to archive-on-overwrite is gone** ([v1] §16 G5) — a
  conservative line-level diff with a flag as permission. Structural since physics moved to
  columns: `updatePhysics` names the columns it sets and none of them is the body, the
  title, the meta or the hash.
- **The universal "the DB is a cache" rebuild contract is released** (owner rescope 1,
  settled) — it covers box 3 only. Box 2 is canonical and is backed up as a database.
  *One box-2 table is telemetry rather than memory and has bounded retention: the durable
  event log (SEAMS item K). `pruneEvents({ limit })` deletes UNLATCHED rows older than
  `retentionDays` lived days, oldest first, capped per call, and reports what went and what
  is left; rows carrying a `dedup_key` — the replay latch — are kept at any age.
  `eventLogCensus()` is the read-only count of the same. The caller is sleep's `log` phase
  (`sleep/` §5 G16, 2026-09-05).*
- **Hand-serialized JSON sidecars are gone** (owner rescope 1, settled). All seven bugs in
  v1's 2026-08-18 verified-bug batch were structured-sidecar bugs, and the class refired
  2026-08-23 (scar §2.1).
- **The staged quarantine → cooling-off → chase-every-copy erase ceremony is released**
  (owner rescope 3, settled): 871 lines, never production-fired. The kernel survives —
  owner-initiated removal, loud, recorded, unreachable from any model path. One property
  from inside the released ceremony is kept as a note for `cli/`: the cooling-off was
  deliberately **wall-clock**, not active days.
- **Forever-archive becomes bounded versioning** (owner rescope 3, settled) — superseded
  rows retained ~90 lived days, on by default (owner ruling 1, 2026-09-18). *The prune's
  cost changed at the floor and the ruling was taken knowing it: a version row now holds
  the owner's earlier WORDS, where it used to hold a note about a file that was never
  deleted. His steer: simple working-memory mechanics over keeping everything.*
- **Local-only absolutism is released**; the property is **no silent egress** (owner
  rescope 2, settled).
- **The v1 → v2 import is gone** (owner ruling 6, 2026-09-18, and F8): `tools/migrate/**`
  and its tests are deleted, the cut-over carries nothing, and the owner starts as a new
  user. If an import is ever built it traverses G1's seam like everything else, and for the
  named reason: scar §2.7's worst incident was v1's migration path bypassing the secrets
  gate and putting three live API keys into the store.

## 5. Contract

**Inputs** — write requests (create, revise, supersede, archive, prune), reads by id, by
cue, by kind, by scope; rebuild requests for box 3.
**Outputs** — durable state; resolved references; ids; the removal record; telemetry by
reference only.

*Numbering is stable across the floor on purpose: G1–G17 are the numbers other modules,
tests and `docs/` already cite, and none of them is retired. G5, G11 and G15 are restated
for rows; G16 and G17 arrived with the floor; **G18 and G19 are new here**, and they are
not new PROMISES — they are two things the code has kept since 2026-09-18 and 2026-08-25
that lived only in `NOTES.md`, written down so a citation can reach them. The
implementation plan's §5 outline numbered the tail differently — its G15 is this page's
G16 and its G16 is this page's G18 — and its G17, "a snapshot is a VACUUM INTO of the
classified backup set, rotated by an adapter", is not a store guarantee at all: rotation
DELETES, so it lives in `adapters/snapshots.ts` and may never live here (G2). What is a
store property is the `VACUUM INTO`, and that is G19. The code's numbering wins.*

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] One seam.** Every path by which text becomes canonical — steady state, jot,
   crash fallback, import, repair, replay harness, adapter — traverses one write function,
   and a totality test enumerates entrances and asserts each one does (scar §2.7).
2. **[M] The store exports no delete/remove/unlink function of any kind**, and a test
   asserts that over every export name. Removal lives in exactly one module, and a
   caller-universality test pins who may import it — **no model-reachable path may**
   (scar §2.6, earned-mechanism #14).
   *Correction (2026-08-25, when the box-2 chase landed — BUILD-STATUS gap 3): the ban is
   total over the module EXCEPT `owner-op-seam.ts`, whose export list is pinned by name in
   `test/store.test.ts`. The seam had to become the place removal actually happens, because
   a removal that could not reach the `memories`/`edges`/`prospective` rows was "anything
   can be removed loudly" with a footnote. Nothing weakened: `Store` itself still carries no
   such method (the prototype test is unchanged and total), the chase reaches its capability
   through a WeakMap the constructor grants and no caller can read, it crosses the same
   observer stance check every write crosses, and a second caller-universality test pins who
   may VALUE-import the seam — `adapters/cli/` and nobody else.*
   *Second correction (2026-09-05, the probe-H repair — `sleep/NOTES.md` §12): the seam
   gained `unarchiveMerged` (with `MERGED_ARCHIVE_REASON` and `UNMERGE_EVENT`), the one
   REPAIR on this path. It is here rather than on `Store` for the same reason the chase is:
   a general `unarchive` would reverse the prune, the revision and the removal along with
   the merge, and every one of those is archived for a reason a repair tool has no business
   undoing. This door undoes exactly `archived_reason: "merged"` and refuses every other
   reason, a superseded row, a removed id and an unknown id, each by its own error code. It
   crosses the same stance check, appends a latched `memory.unmerged` record in the same
   transaction, and erases nothing (constitution 7). It is also the one owner-op that
   touches box 3 — `OwnerOpAccess.reindexLexical`, the LEXICAL half only, so a restored row
   is findable again while its embedding is neither recomputed at cost nor dropped.*
3. **[M] No structured mutable state is hand-serialized by more than one writer** (scar
   §2.1). Box 2 is transactional, and since the floor there is no non-transactional
   canonical state left at all — the words moved inside the transaction with everything
   else. **Partly mechanized, honestly:** `test/store.test.ts`'s layout totality enumerates
   every top-level path and fails on an unclassified one, and this page names what each one
   is; what NO test proves is single-writer-ness for the two mutable directories that are
   not the database — `spans/` (`remember/`'s buffer, one writer per project key plus a
   claim protocol) and `sessions/` (host state). Argued in `remember/` and
   `adapters/sessions.ts`, not asserted. §7 question 4.
4. **[M] Referential integrity is enforced by the store** — foreign keys, or one retarget
   site every write path inherits — never by remembering at each call site. Supersession
   leaves a forwarding address; a dangling reference is a hard error, not a silent drop
   (scar §2.2; v1's cross-boundary dangling gap, §6.2 known gaps, is closed by this).
5. **[M] An overwrite keeps the prior version, body included, in the same transaction.**
   *(Restated at the floor: it was "archives the prior version first, atomically and
   collision-proof", which described an ordering between a file copy and a file rename. The
   version is a row now, written beside the update, so there is no first and no window. The
   version row carries `learned_on` and `happened_on` as well as the words, because
   `revise({learnedOn})` travels this same door precisely so a corrected date keeps its
   prior version — taking the dates from the live row would silently rewrite every version
   behind a correction.)*
6. **[M] Removal is ordered so every crash point is safe**: at each moment a memory is
   fully alive, or dark *and* recorded. A failed record append is never reported as
   success — if the record cannot be written, nothing moves (§16 G10–G11).
7. **[M] Everything that must read doomed content happens before any copy is chased**
   (§16 G13), and every surface is chased including the derived index and the association
   graph (§16 G14, scar §2.2's erase variant). The span buffer is chased FIRST, because the
   chase blanks the row's body, hash and `origin_ref` — which are what address a span. The
   journal's markdown copy is a named surface too, and it stands down rather than following
   a symlink at or under `journal/` (`journal-symlink`), which is the one place this
   guarantee answers "could not" instead of "did" — said in the report, never passed over.
   Copies taken BEFORE a removal still hold the memory, and the report says so rather than
   implying the machine is clean (G19's `VACUUM INTO` is why no copy taken AFTER one does).
8. **[M] Box 3 is behaviorally rebuildable**: a test deletes it, rebuilds from canonical,
   and asserts *the same recall for the same cues* — not merely that rebuild returned.
   Anything rebuild cannot recompute is declared, with a named owner and a repair path,
   and the count of un-recomputed items is logged at every rebuild (scar §2.12).
9. **[M] Path guards resolve and realpath both sides before comparing**; no tool accepts a
   pointer at a real store from an environment variable (scar §2.13). Since 2026-09-18 the
   snapshot directory and its optional mirror go through the same guard, which also refuses
   a destination inside the store it is copying and one that contains it.
10. **[M] Telemetry is content-by-reference** — ids, hashes, scores, counts, kinds, tiers;
    never body text, never user turn text; error messages included. Any surface that names
    a memory resolves the id against the live store **at render time**, so the display dies
    with the record (scar §2.20, earned-mechanism #16). *`content_hash` became a weaker
    reference at the floor — a 16-hex SHA-256 prefix of a short, low-entropy body is
    guessable — and it is acceptable because of where it goes, which `NOTES.md` 2026-09-20
    traces rather than assumes: the removal record and the tombstone carry no hash at all,
    the dashboard blanks it for confidential rows, and `store.put`'s emitted `hash` reaches
    no durable row. If it ever starts riding telemetry that lands on disk, look again.*
11. **[M] Every top-level path in the data directory is classified**: in the backup set, or
    on an explicit documented exclusion list. Adding a directory breaks the build until it
    is classified (scar §2.11 — v1 silently omitted the canonical episode journal from
    snapshots for three weeks). Five entries, and the reason each one is where it is:
    `counterparts.sqlite` (prefix, backed up — box 2), `cache` (excluded, rebuildable),
    `spans` (backed up, not reconstructible), `journal` (**classified and EXCLUDED**),
    `sessions` (excluded, host state).
    **Classified is not the same question as backed up**, and `journal/` is what makes
    that worth saying. It is a derived, write-only markdown COPY of episode rows the
    database already holds, and it is excluded on purpose: a copy of it put removed
    episodes' words into every rotating snapshot as plain greppable markdown, where a
    database inside an old snapshot is a file somebody must know to open and a `.md`
    inside one is a search result. Excluding it costs nothing, because a restored store
    writes every file again at its next boundary. Scar §2.11 is not weakened by that —
    the scar is about losing the CANONICAL journal from every backup, and the canonical
    journal is rows. What the scar's other half still demands is met: the directory was
    **classified BEFORE anything wrote it**, which is v1's incident said forwards.
    *Note (2026-09-18, when the boxes went to WAL): the database entry classifies by
    PREFIX, so `counterparts.sqlite-wal` and `-shm` are covered — but* **the database file
    alone is no longer the database.** *Pages committed since the last checkpoint live in
    the `-wal`, so a copy of the file alone opens and is silently short, and deleting a
    `-wal` deletes what is inside it. The copies that are whole are `counterparts backup`,
    `export` and the rotating snapshot — all `VACUUM INTO` (G19) — or a copy of the whole
    directory, sidecars included. For the same reason `sqlite3 "file:…?immutable=1"` reads
    the store as of the last checkpoint and says nothing; plain `-readonly` is right.*
12. **[A] Raw conversational text is not the system of record.** The shipped default keeps
    none; where a developer opts in, the window is as short as the retry path needs.
13. **[M] Reads of archived, superseded, and removal-record content emit an event.** v1
    could not answer "did the archival mechanisms ever pay for themselves" because nothing
    logged a read-back (log-audit §3). This is a v2 instrumentation requirement, not a
    preference. The exemption is `walk-seam.ts#readProseWalking`, for a caller WALKING rows
    rather than answering for one — an index build, a repair plan. It is a look at the
    address, so it fires no event and asks the deny-list nothing; the callers that need it
    (`schemas/index.ts#load`, `cli/commands.ts`'s unmerge helpers) had exactly that by
    reading the file behind the store's back until 2026-09-18, and this is the same
    exemption said once, in one place, where it can be seen and one day closed. It is
    **not** a `Store` method, for the reason `chaseRemoved` is not: §4's "unreachable from
    any model path" has to stay true of the store's own surface, and `Counterpart.store` is
    public. Two files may import it and `test/cli.test.ts` pins which.
    `StoredMemory.confidential` rides on the ordinary read for the opposite reason: the
    confidentiality class is a gate, and a gate that re-parses JSON at every call site is a
    gate that will one day fail open (`confidentialByMeta`, the one truth table, which
    `recall/activate.ts#isConfidential` is a door onto). It is a COLUMN since the floor and
    the truth table is unchanged.
14. **[M] The implicit default is refusable.** `dataDir()`'s fallback to
    `~/.counterparts/store` is the one path a caller reaches by naming nothing, and on the
    owner's machine it is his live memory; `.counterparts` cannot join the forbidden roots
    (G9) because the store must open its own default. So the fallback is a door with a lock:
    with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` armed (`1`, `true` or `on` — trimmed and
    case-insensitive), every resolution that would have returned it throws
    `IMPLICIT_DEFAULT_DIR_REFUSED` before anything is created, naming the guard, the
    directory and the remedy — and a named `dir` or a `COUNTERPARTS_DATA_DIR` is unaffected.
    Absent, blank, or `0` / `false` / `off` means OFF, behaviour unchanged; **the guard fails
    closed on anything else**, throwing `EXPLICIT_DIR_GUARD_MALFORMED` at the same decision
    point rather than reading a word it does not know as "off" (the #80 review measured
    `=true`, `=yes`, `=on` and `= 1` all falling open under the first draft). Off means off
    and junk is a question this will not answer; the variable is never set on an installed
    host. The same guard covers the configuration default in `adapters/config-path.ts`,
    because a default-sourced `~/.counterparts/claude-code.json` NAMES a store and `install`
    writes under that base. **Not covered, by design:** a number read from the default config
    for a store already named (`rebrief`'s ceiling), and the read-only instruments that carry
    the live paths as defaults by their own rule (`claude-code/primacy.ts`,
    `tools/parallel/bin/*`). Armed by `test/preload.ts` for the whole suite, so a forgetful
    test is REFUSED rather than redirected (LAUNCH-STATUS I21, owner ruling 2026-09-05).
15. **[M] A store directory is self-contained: copying or moving it never touches another
    store's files.** **Structural since the floor rather than enforced.** A row IS its
    memory, so there is nothing outside the database for a copy to reach, and there is no
    pointer to resolve against the wrong root. The mechanism that defended this while rows
    named files is deleted — `memories.prose_path`, `versions.path`, `paths.stored.*`,
    `resolveStoredPath`, `relativizeStoredPath`, `isCanonicalRelativePath` and
    `STORED_PATH_ESCAPES`, four review rounds of blank pointers, pre-v5 absolute rows and
    `../ESCAPE/…` — and the two resolvers live on in `tools/parallel/legacy-paths.ts`, for
    the read-only instruments that still read the owner's parked pre-rows store. **The
    criterion is unchanged and still proved**: `test/store-portable.test.ts` copies a store,
    destroys the source outright and reads through the copy; removes through the copy and
    finds the source byte-identical; and opens a `backup` snapshot standalone after the
    source is gone. *Added 2026-09-05 (schema v5) when finding I22 showed an absolute
    `prose_path` made a copied store read and DELETE the source's prose.*
16. **[M] A store written by an older floor is refused BY NAME, never migrated.**
    A data directory holding `operational.sqlite`, `prose/` or `versions/` was written by a
    build that kept its memories in files, and this one has no code that reads them.
    `Store`'s constructor throws `STORE_PRE_ROWS` — carrying what it found, the version this
    build writes, and `readableBy: "floor/v5-last"`, the tag whose build still opens it —
    **before any transaction, before any directory is created, and without opening the old
    database**. FILENAMES are the evidence deliberately: reading the schema version would
    mean opening a WAL store whose `-wal` a close could checkpoint away, moving the bytes
    the refusal exists to leave alone. All three names, because a store whose database was
    moved by hand still holds every one of its words in files. `ADDED_COLUMNS` may never
    name a v6 column (it was empty at v6 and holds v7's eleven since 2026-09-25), which is
    the second lock: `openOperational` migrates anything below `SCHEMA_VERSION`, and `body`
    added that way would be NULL on every row while the words sat in files, stamping the
    store current and unreadable by the build that can read it. `OBSERVER_READ_FLOOR` is
    `SCHEMA_VERSION`: there is no floor below the current version, because every read names
    the current columns and an instrument on an older store would report an empty or broken
    store rather than one waiting for its upgrade.
    There is no migration and there is not going to be one (owner ruling 6, 2026-09-18: the
    cut-over carries nothing). `test/store-portable.test.ts` builds a real v5 store by hand
    and proves the directory is byte-identical after a refused writer open, a refused
    observer open and a refused session.
17. **[M] A removal reclaims the pages that held the words — the log AND the free list —
    on both databases.** Blanking a body is an `UPDATE`: in WAL mode the old page stays in
    the `-wal` until a checkpoint, and a body long enough to take OVERFLOW pages leaves
    whole pages on the FREELIST still holding the words (`secure_delete` is FAST by default
    and zeroes only the slack of a page being rewritten). Measured 2026-09-20, deterministic
    with marks at the start, middle and end of a ~40 KB body. So the console's removal ends
    with `VACUUM` then `PRAGMA wal_checkpoint(TRUNCATE)` on each database, on its own
    connection, reported as its own surface and never thrown (G7; scar §2.20). A contended
    reclaim is REPORTED in words, with what is still true and the command that finishes it —
    never `nothing`. Snapshots taken BEFORE a removal hold the memory properly and are not
    reached; nothing that leaves the machine ever carried the residue (G19).
18. **[M] Both boxes are WAL, every handle carries a busy timeout, the timeout is set
    FIRST, and an opener that did not ask to convert sets no pragma that writes.** The
    order is the fix (I38/I39, 2026-09-18):
    `busy_timeout = 5000` before anything else, because every statement after it can contend
    for a lock and without it SQLite fails them INSTANTLY — it used to be set LAST, so the
    journal-mode statement ran with zero wait inside another writer's commit window. Then
    `foreign_keys = ON`; then the journal mode is READ and set only when it differs from
    `wal` **and the caller asked**, because setting is a write that takes the exclusive
    lock and an opener that converted a file it had come to read would be writing at open;
    then `synchronous = FULL` (WAL's usual pairing is `NORMAL`, and that is a durability
    ruling for the owner, not a cleanup to make in passing — TUNABLE). A swallowed
    conversion leaves the store in its old mode and says so through `verify` and `doctor`
    rather than through a write from inside `openDb`. Only SQLITE_BUSY/LOCKED is swallowed.
    *Why at all: several processes hold this one small database open at once — the session
    hooks, a long-running MCP server, the nightly worker, the dashboard — and in WAL a
    reader no longer blocks the writer. What it costs is in `NOTES.md`, including the three
    things a WAL store cannot do that a DELETE store could.*
19. **[M] A canonical database never leaves by file copy.** `backup`, `export` and the
    rotating snapshot all go through `VACUUM INTO`, which copies live pages only and whose
    output is a plain DELETE-mode database readable on any medium by any SQLite reader
    (this build still refuses a database a NEWER one wrote — `SCHEMA_AHEAD` — which is a
    different question from whether the file opens) — so a copy
    is consistent even taken from a store another process is mid-write on, and even from a
    store in G17's residue state. This is scar §2.11(b) said as a guarantee rather than left
    in two notes; it is what makes the snapshot the real protection against a corrupt or
    wiped database (owner ruling 3, 2026-09-18). Rotation, which DELETES, lives in an
    adapter and never here (G2) — and it never deletes a folder holding pre-rows markers, so
    the copies of the parked store survive cut-over.
20. **[M] A copy before a schema migration.** A writer open that finds box 2 on an older
    schema copies the database (`VACUUM INTO`, G19) before it changes anything, under the
    same write lock that decides who migrates. This is the one write the store makes
    outside its own directory: into the snapshots directory beside it (`<base>/snapshots`),
    or the one named by `StoreOptions.snapshotsDir`. A store outside `<base>/store` with
    none named does not migrate. If the copy cannot be made, nothing migrates and the open
    throws `MIGRATION_SNAPSHOT_FAILED`, whose `remedy` says why; the store stays on its old
    version. A later open reuses a copy already taken for the same upgrade that day, or one
    the live store has not been written since. Observers never migrate and never copy.
    `NOTES.md` (2026-09-24) has the rollback steps.
21. **[M] Two kinds of time, one conversion module** (docs/time.md, 2026-09-25). A
    MOMENT is UTC milliseconds from the injected clock (`store.now()`): `created_at` /
    `updated_at` on `memories`, `edges` and `prospective`, a version's `created_at` and
    `archived_at`, an event's `at`. A CALENDAR DATE a person said is text at its stated
    precision — `happened_on`, and `event_date` (day, month, year or `a..b` range, refused
    as `EVENT_DATE_INVALID` when `core/time.ts` cannot read it) — and is never turned into
    a moment. A person's day (`today()`, a new row's `learned_on`, the day the store began)
    is the local date of a moment in `zone()`: `StoreOptions.timeZone` when it names a real
    zone, else the machine's current zone, resolved per call. Rows written before
    2026-09-25 keep the UTC `learned_on` they were given. `datedMemories(from, to)` answers
    which live rows carry an `event_date` overlapping a window, from an index.

## 6. Scars honored

Each line: the scar, what carries it on this floor, and where it is pinned.

| scar | carried by | pinned by |
|---|---|---|
| **E5** / **§2.1** multi-writer structured state needs a transaction | G3 — strengthened: there is no non-transactional canonical state left | `test/seams.test.ts` "the interleaved load→mutate→save race that the meta row lost now loses nothing" |
| **§2.2** supersede retargets every inbound reference | G4 | `test/store.test.ts` "supersede leaves a forwarding address; the old id resolves forever"; "referential integrity is enforced by the store, not by the caller" |
| **§2.4** every discard says what and how much | G8's declaration; the two prunes; rotation | `test/store.test.ts` "version rows past H lived days are pruned; resolution is NOT"; "the event sweep is capped per call, takes the OLDEST rows first, and reports what it left"; `test/snapshots.test.ts` "keeps the newest N and reports every deletion, oldest first" |
| **§2.6 / §2.7** one seam; no model-reachable removal | G1, G2 | `test/store.test.ts` "no export name in the module is a deletion verb"; "no method on Store (public OR private) is a deletion verb"; "the owner-removal seam exports EXACTLY the destruction path, and nothing else does"; "the chase is not reachable from the store's own surface"; `test/cli.test.ts` "no core module, no other adapter, and no test but this one imports removal.ts" |
| **§2.11(a)** backup scope asserted against the layout | G11 — and `journal/` was classified before the code that writes it | `test/store.test.ts` "every top-level path is classified as backed-up or explicitly excluded (§5 G11)"; "an unclassified new directory fails loudly" |
| **§2.11(a)**, the other half — the canonical journal is never missing from a backup | G11: the canonical journal is ROWS, inside the database every copy carries. The markdown copy is derived and deliberately EXCLUDED, and its absence costs nothing | `test/cli.test.ts` "MAJOR-5: a snapshot does NOT carry the journal's copies, and a restore REGENERATES them"; `test/self.test.ts` "DELETING journal/ LOSES NOTHING: the next boundary writes it again" |
| **§2.11(b)** a canonical database is never file-copied | G19 | `test/store.test.ts` "the sidecars are classified, and `VACUUM INTO` still copies a consistent database"; `test/cli.test.ts` "`backup` survives a store another process is WRITING"; `test/snapshots.test.ts` "copies the WHOLE backup set, not just the database — and the words come with it" |
| **§2.12** the cache-rebuild contract is a test | G8 | `test/store.test.ts` "rebuild from canonical answers the same cues identically"; "what rebuild cannot recompute is declared, counted, and logged (§5 G8)" |
| **§2.13** path guards resolve before they compare | G9 | `test/store.test.ts` "refuses a pointer at a live v1 store — resolved before compared (scar §2.13)"; `test/snapshots.test.ts` "a SYMLINK is judged by its target, not by its name"; "refuses a directory inside the store"; "refuses a directory that CONTAINS the store"; and since `assertSafeTarget` began resolving both sides, `test/cli.test.ts` "MAJOR-4 — a destination reached THROUGH A SYMLINK into the store is refused too"; "MAJOR-4 — a DANGLING symlink target is refused by name, not by an mkdir errno"; "MAJOR-4 — a target symlinked into ~/.bansai or ~/.claude-engram refuses under a FAKE HOME" |
| **§2.19** permanence and the write bar: a removed protected element still shows as `[removed]` | G2 — the tombstone captures the row's band at chase time | `test/self.test.ts` "a removed element is a NAMED absence in BOTH halves, never a silent drop" |
| **§2.20** content-by-reference is only private if the reference cannot be inverted | G10, G17 | `test/cli.test.ts` "NEW-MAJOR-1: a removed body on OVERFLOW pages leaves no freed page holding it"; "review B, MAJOR-1: a CONTENDED cache checkpoint is reported, never claimed"; "the words a note rode in on are struck out of the buffer, and a later backup has none of them" |
| **§2.20**, the journal half — the markdown copy is body text on disk, so removal must reach it and nothing may carry it off | G7, G11 | `test/cli.test.ts` "F6: removing an episode takes its markdown copy, and the whole directory is clean"; "MAJOR-3: the journal echo is EXACT, not a ranked top-20 that goes silent on a big store"; "MAJOR-5: a snapshot does NOT carry the journal's copies…"; "--markdown OMITS confidential rows, and SAYS how many — on the terminal and in the tree"; and the four stand-downs that keep the copy and the chase inside the store — `test/self.test.ts` "MAJOR-1 — a symlinked YEAR directory does not carry a chapter out of the store"; "the removal arm never unlinks THROUGH a symlink"; "a DANGLING link under journal/ is refused too, not treated as absent"; "`journal` ITSELF being a symlink is refused, not followed" |
| **I22** the copied-store bug | G15 — criterion kept, mechanism deleted | `test/store-portable.test.ts` "(a) `cp -R` the store, DESTROY the source outright, and the copy still reads its own words"; "(b) an owner removal run in the COPY leaves the SOURCE byte-identical"; "(d) a `backup` snapshot opens standalone and HOLDS THE WORDS after the source is gone" |
| **I38 / I39** "database is locked" | G18 | `test/store.test.ts` "busy_timeout is set FIRST, before every other pragma (I39)"; "a second handle WAITS for a held write lock instead of failing instantly"; "a WRITER converts the file to WAL; an INSTRUMENT opening a DELETE store leaves it alone" |
| **the stage→commit→rename crash window** (`NOTES.md` §5, deleted): a crash never leaves a row whose words are missing | G5, G6 — structurally true: the words commit with the row | `test/store.test.ts` "SIGKILL mid-write leaves the store readable, every row's words intact" |
| **the floor's own hazard**: migrate-at-open would have destroyed the pre-rows store | G16 | `test/store-portable.test.ts` "a WRITER open throws STORE_PRE_ROWS and the directory is byte-identical afterwards"; "an OBSERVER open, and a whole session, meet the same refusal and write nothing"; "ADDED_COLUMNS may never name a column the floor introduced" |

**Scars that no longer apply**, named so nobody re-ports them: temp-file naming (§16 G4's
"a crash-leaked stage must not load as a duplicate" — there is no stage), the
archive-collision `wx` loop, the absolute-vs-relative placement rule, "the loader reads
only `*.md` under `prose/`", and "`journal_mode = DELETE` because every top-level path must
be classified" (the database entry matched by prefix all along).

## 7. Open questions

1. **Is `PRAGMA secure_delete = ON` on the chase's connection the cheap answer to G17?**
   It would, on paper, zero overflow pages as they are freed and cost nothing per removal,
   where a `VACUUM` costs 23 ms on a 9.3 MB box 2 and 58 ms on a 16.6 MB box 3. It
   measured clean on some body shapes and left the middle and end marks on others, because
   it only zeroes what THAT transaction frees. F5's third review could not settle it either
   — a bare-SQLite fixture did not reproduce the residue at all, so the real mechanism
   involves more than the one statement. `VACUUM` is kept because it clears residue whatever
   freed the page and whenever.
2. **How often is a contended checkpoint met in practice?** G17 reports one honestly and a
   test proves the report; nobody has seen one arise by itself. If it turns out to be common,
   the reclaim wants a retry rather than a sentence.
3. **Node is untested.** `db.ts` binds `node:sqlite` under Node (22.5+ flagged, 23.4+
   default) and the branch is structurally present, but `node:sqlite` + WAL + `VACUUM INTO`
   + bodies in rows has never been run. Verify at packaging (`NOTES.md` §9).
4. **G3's totality is argued, not tested, for the two directories that are not the
   database.** The layout test enumerates every top-level path; nothing asserts that
   `spans/` and `sessions/` have one writer each. A test in the shape of G1's entrance
   enumeration would close it.

*Two asks stand against this module from outside it. This module keeps no
`INTERFACE-GAPS.md` of its own (CLAUDE.md), so they are recorded here rather than
nowhere; neither is built, and both are waiting for a named problem (constitution 15).*

5. **A store-owned seam that hands a module its own CLASSIFIED subdirectory** —
   `store.ownedDir("journal")` — refusing at the seam what `assertLayout()` refuses at the
   next open. Two core modules now hold a piece of layout knowledge beside their own work:
   `remember/spans.ts` and, since F6, `self/journal-file.ts`, which reaches `Store.dir` by
   the owner's decision 2 and says so in its header. Nothing enforces the pairing from
   their side; a module writing to a directory `LAYOUT` does not know breaks the store's
   next open, loudly, which is the safe direction but is a runtime answer to a
   compile-time question. `self/INTERFACE-GAPS.md` asks it, and so does that file's #4 for
   the briefing's render file — the two want one answer, not two.
6. **A streaming read seam** — `store.forEachDoc(fn)` — so `export --markdown` need not
   hold the whole rendered tree in memory before writing a byte. Buffering is what makes
   `--markdown --passphrase` safe (nothing plaintext reaches the disk on that path) and it
   is also a peak the size of every body plus its frontmatter, briefly doubled while
   `encryptBundle` builds its base64 manifest. Nothing at the measured store shapes; the
   first thing that would hurt an order of magnitude up. `cli/INTERFACE-GAPS.md` §12 asks
   it, and notes that the DATABASE export is unaffected — it streams through `VACUUM INTO`
   and holds one file.

*Closed since the last revision of this page: **is the embedding cache one box or two?**
Answered one file, two tables (`NOTES.md` §7) — the split that matters is rebuild cost, and
that is expressed by G8's declaration, not by a second file; re-open if vectors ever need a
different backup posture than the text index. **Does prose stay one file per memory?**
Answered no, 2026-09-20 — this whole page. **How does a v1→v2 import traverse the seam?**
Not a question any more: there is no import (§4).*

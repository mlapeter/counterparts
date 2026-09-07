# `store/` — CONTRACT

## 1. Purpose

The substrate: three boxes — canonical prose, one small canonical transactional database,
one rebuildable search cache — and the single seam every write crosses.

## 2. Brain analog

None, deliberately. This is the engineering floor the brain does not have: **exactness
where the brain is reconstructive** (constitution line 9 — "biology's rules without
biology's limits"). Human memory has no separable substrate; conflating the two is how v1
ended up with canonical state spread across a prose store plus half a dozen sidecars
(Appendix A #14).

## 3. Keeps

- **Prose is canonical and readable in any editor.** [v1] Constitution line 6; test-triage
  P1 `schema-md.test.ts` / `files.test.ts` — a portable format must survive round-trip.
- **Lossless serialization that refuses ambiguity**: human-legible text beside an
  authoritative machine payload; the parser reads only the payload; content that could
  break the parser is rejected loudly, never truncated. [v1] behavioral-spec §4.2 G7.
- **Round-trip fidelity extends to metadata** — unrecognized fields survive
  parse→serialize untouched. [v1] §4.2 G6 (v1 incident: a parser silently dropped tier,
  frequency, provenance, and aliases on rewrite).
- **Omitted-when-absent** — a section never used serializes byte-identically to a store
  that predates the section. [v1] §4.2 G8.
- **Ids are immutable, never reused, type-prefixed; resolution follows lineage; a cycle,
  a dangling id, or an over-deep chain is a hard error.** [v1] §4.2 G2, test-triage P1
  `ids.test.ts`.
- **Every mutable sub-item carries a stable handle. Prose is the content; the handle is
  the identity.** [v1] §4.2 G1.
- **Archive-on-overwrite, atomic and collision-proof**, with temp files named so a
  crash-leaked one cannot be loaded as a duplicate. [v1] §16 G4.
- **The strength-only exemption to archive-on-overwrite** — a rewrite differing in nothing
  but strength bookkeeping skips the archive copy, decided by a conservative line-level
  diff, with the flag as permission only. [v1] §16 G5.
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
  rounded), when it was learned, which lived day it was born on. [v1] §4.2. The first
  two come from the session's INJECTED clock (`StoreOptions.now`), the third from the
  physics clock (`advanceClock` / `livedDay`) — two clocks, never one (`NOTES.md`
  2026-09-05).
- **One content-address function**, so a raw span, a run record, and a rejected proposal
  join on the same key. [v1] §17.1.
- **A store directory is self-contained.** Every file a row names is named RELATIVE to
  the store root, so a copy, a move, or a restored backup reads and chases its own files
  and never another store's (§5 G15; finding I22, 2026-09-05). Constitution line 6 —
  local-first, portable — and line 7's "backups catch catastrophe" both rest on it: a
  backup that still pointed at the live store was not a backup.

## 4. Drops / simplifies

- **The three boxes replace v1's prose-plus-sidecars layout** (owner decision 2026-08-25,
  settled):
  1. **Canonical prose** — memories, identity documents, episodes. Markdown, editable.
  2. **One small canonical transactional SQLite** — operational and structured state:
     ids, kinds, salience, `uses`, day stamps, lineage rows, entity/belief rows, prospective
     windows, the removal record, per-session gate state. **Transactional**: every
     multi-step change commits or does not.
  3. **A separate rebuildable cache** — embeddings and full-text index. **Never backed
     up**, always reconstructible, and its loss is a re-index, never a memory. Vectors
     are stored as float32 BLOBs (`dim` little-endian singles, cache schema v4,
     2026-09-05) — the embedder's own precision, and 2.8× smaller and ~11× faster to scan
     than the JSON text of v3 (measured; `NOTES.md`). "Reconstructible" is still an
     honest word for the text index and a partly dishonest one for the vectors: those
     cost a paid network call each, which is why `rebuildCache({ keepVectors })` and
     `counterparts migrate-cache` exist rather than a rebuild.
- **The universal "the DB is a cache" rebuild contract is released** (owner rescope 1,
  settled) — it now covers box 3 only. Box 2 is canonical and is backed up as a database.
- **Hand-serialized JSON sidecars are gone** (owner rescope 1, settled). All seven bugs in
  v1's 2026-08-18 verified-bug batch were structured-sidecar bugs, and the class refired
  2026-08-23; prose files never minted one (scar §2.1).
- **The staged quarantine → cooling-off → chase-every-copy erase ceremony is released**
  (owner rescope 3, settled): 871 lines, never production-fired. The kernel survives —
  owner-initiated removal, loud, recorded, unreachable from any model path. One property
  from inside the released ceremony is kept as a note for `cli/`: the cooling-off was
  deliberately **wall-clock**, not active days.
- **Forever-archive becomes bounded versioning** (owner rescope 3, settled) — superseded
  rows retained ~90 lived days.
- **Local-only absolutism is released**; the property is **no silent egress** (owner
  rescope 2, settled).

## 5. Contract

**Inputs** — write requests (create, revise, supersede, archive, prune), reads by id, by
cue, by kind, by scope; rebuild requests for box 3.
**Outputs** — durable state; resolved references; ids; the removal record; telemetry
by reference only.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] One seam.** Every path by which text becomes canonical — steady state, jot,
   crash fallback, import, repair, replay harness, adapter — traverses one write function,
   and a totality test enumerates entrances and asserts each one does (scar §2.7).
2. **[M] The store exports no delete/remove/unlink function of any kind**, and a test
   asserts that over every export name. Removal lives in exactly one module, and a
   caller-universality test pins who may import it — **no model-reachable path may**
   (scar §2.6, earned-mechanism #14).
   *Correction (2026-08-25, when the box-2 chase landed — BUILD-STATUS gap 3): the ban
   is now total over the module EXCEPT `owner-op-seam.ts`, whose export list is pinned by
   name in `test/store.test.ts` — on 2026-08-25 that was three names (`chaseRemoved`,
   `grantOwnerOps`, `REMOVED_REASON`). The seam had to become the place removal actually happens,
   because a removal that could not reach the `memories`/`edges`/`prospective` rows was
   "anything can be removed loudly" with a footnote. Nothing weakened: `Store` itself
   still carries no such method (the prototype test is unchanged and total), the chase
   reaches its capability through a WeakMap the constructor grants and no caller can
   read, it crosses the same observer stance check every write crosses, and a second
   caller-universality test pins who may VALUE-import the seam — `adapters/cli/` and
   nobody else.*
   *Second correction (2026-09-05, the probe-H repair — `sleep/NOTES.md` §12): the seam
   gained `unarchiveMerged` (with `MERGED_ARCHIVE_REASON` and `UNMERGE_EVENT`), the one
   REPAIR on this path. It is here rather than on `Store` for the same reason the chase
   is: a general `unarchive` would reverse the prune, the revision and the removal along
   with the merge, and every one of those is archived for a reason a repair tool has no
   business undoing. This door undoes exactly `archived_reason: "merged"` and refuses
   every other reason, a superseded row, a removed id and an unknown id, each by its own
   error code. It crosses the same stance check, appends a latched `memory.unmerged`
   record in the same transaction, and erases nothing: the merge record and the
   `memory.merged` event stay where they are (constitution 7). It is also the one
   owner-op that touches box 3 — `OwnerOpAccess.reindexLexical`, the LEXICAL half only,
   so a restored row is findable again once `archive()` starts deindexing (PR #64) while
   its embedding is neither recomputed at cost nor dropped.*
3. **[M] No structured mutable state is hand-serialized by more than one writer.** A test
   enumerates every mutable non-prose path in the data directory and fails on any that is
   neither transactional nor provably single-writer (scar §2.1).
4. **[M] Referential integrity is enforced by the store** — foreign keys, or one retarget
   site every write path inherits — never by remembering at each call site. Supersession
   leaves a forwarding address; a dangling reference is a hard error, not a silent drop
   (scar §2.2; v1's cross-boundary dangling gap, §6.2 known gaps, is closed by this).
5. **[M] Overwrites archive the prior version first**, atomically and collision-proof.
6. **[M] Removal is ordered so every crash point is safe**: at each moment a memory is
   fully alive, or dark *and* recorded. A failed record append is never reported as
   success — if the record cannot be written, nothing moves (§16 G10–G11).
7. **[M] Everything that must read doomed content happens before any copy is chased**
   (§16 G13), and every surface is chased including the derived index and the association
   graph (§16 G14, scar §2.2's erase variant).
8. **[M] Box 3 is behaviorally rebuildable**: a test deletes it, rebuilds from canonical,
   and asserts *the same recall for the same cues* — not merely that rebuild returned.
   Anything rebuild cannot recompute is declared, with a named owner and a repair path,
   and the count of un-recomputed items is logged at every rebuild (scar §2.12).
9. **[M] Path guards resolve and realpath both sides before comparing**; no tool accepts a
   pointer at a real store from an environment variable (scar §2.13).
10. **[M] Telemetry is content-by-reference** — ids, hashes, scores, counts, kinds, tiers;
    never body text, never user turn text; error messages included. Any surface that names
    a memory resolves the id against the live store **at render time**, so the display dies
    with the record (scar §2.20, earned-mechanism #16).
11. **[M] Every top-level path in the data directory is classified**: in the backup set, or
    on an explicit documented exclusion list. Adding a directory breaks the build until it
    is classified (scar §2.11 — v1 silently omitted the canonical episode journal from
    snapshots for three weeks).
12. **[A] Raw conversational text is not the system of record.** The shipped default keeps
    none; where a developer opts in, the window is as short as the retry path needs.
13. **[M] Reads of archived, superseded, and removal-record content emit an event.** v1
    could not answer "did the archival mechanisms ever pay for themselves" because nothing
    logged a read-back (log-audit §3). This is a v2 instrumentation requirement, not a
    preference.
14. **[M] The implicit default is refusable.** `dataDir()`'s fallback to
    `~/.counterparts/store` is the one path a caller reaches by naming nothing, and on the
    owner's machine it is his live memory; `.counterparts` cannot join the forbidden roots
    (G9) because the store must open its own default. So the fallback is a door with a lock:
    with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` armed (`1`, `true` or `on` — trimmed and
    case-insensitive, a superset of the set `COUNTERPARTS_OBSERVER` accepts), every resolution
    that would have returned it throws `IMPLICIT_DEFAULT_DIR_REFUSED` before anything is created,
    naming the guard, the directory and the remedy — and a named `dir` or a
    `COUNTERPARTS_DATA_DIR` is unaffected. Absent, blank, or `0` / `false` / `off` means OFF,
    behaviour unchanged; **the guard fails closed on anything else**, throwing
    `EXPLICIT_DIR_GUARD_MALFORMED` at the same decision point rather than reading a word it does
    not know as "off" (the #80 review measured `=true`, `=yes`, `=on` and `= 1` all falling open
    under the first draft). Off means off and junk is a question this will not answer; the
    variable is never set on an installed host. The same guard covers the configuration default in
    `adapters/config-path.ts`, because a default-sourced `~/.counterparts/claude-code.json`
    NAMES a store and `install` writes under that base. **Not covered, by design:** a
    number read from the default config for a store already named (`rebrief`'s ceiling),
    and the read-only instruments that carry the live paths as defaults by their own rule
    (`claude-code/primacy.ts`, `tools/parallel/bin/*`). Armed by `test/preload.ts` for
    the whole suite, so a forgetful test is REFUSED rather than redirected — the second
    layer under the temp-home redirect (LAUNCH-STATUS I21, owner ruling 2026-09-05;
    `NOTES.md` same date).
15. **[M] A store directory is self-contained: copying or moving it never touches another
    store's files.** `memories.prose_path` and `versions.path` hold store-relative POSIX
    paths — `prose/<family>/<id>.md`, `versions/<id>/<seq>-<hash>.md` (`paths.ts#stored`)
    — and every read, write and chase resolves them against the OPENED directory
    (`Store.absolutePath`), never against the process's working directory. A pre-v5
    ABSOLUTE row is placed against the opened directory by the same rule the migration
    uses, so an instrument on a v4 copy, backup or moved store reads that store's own
    file; the one value read as given is an unplaceable one (no `prose/` or `versions/`
    segment to key on). A blank pointer resolves to nothing, never to the store root, and
    a value that would land outside `prose/` or `versions/` is refused by name
    (`STORED_PATH_ESCAPES`) and never resolved. Tests copy a store, destroy the source's
    file, and read through the copy — as a writer and as an instrument on a v4 copy;
    remove through the copy and find the source intact; open a `backup` snapshot
    standalone; and refuse a hand-edited `../ESCAPE/…` row
    (`test/store-portable.test.ts`). *Added 2026-09-05 (schema v5), when finding I22 showed
    an absolute `prose_path` made a copied store read and DELETE the source's prose. Rows
    written before v5 are converted once, at the first writer open, inside the
    migrate-at-open transaction; a row that cannot be placed is left and counted, and
    `counterparts verify` prints the census. A v5 instrument may open a v4 store as it
    stands (`OBSERVER_READ_FLOOR`), because the only thing v5 changed is a spelling every
    v5 reader accepts.*

## 6. Scars honored

**E5** (rescoped: transactions for structured state; locks only where files stay
canonical, and never held across a human prompt) · **§2.1** (multi-writer structured state
needs a transaction) · **§2.2** (supersede retargets every inbound reference) · **§2.4**
(every discard logs what and how much — v1's `pruneLogs` was the system's one true deleter
and emitted nothing) · **§2.7** (one chokepoint every write traverses) · **§2.11** (backup
scope asserted against the layout) · **§2.12** (a cache-rebuild contract is a test, not a
comment) · **§2.13** (path guards resolve before they compare) · **§2.20**
(content-by-reference is only private if the reference cannot be inverted).

## 7. Open questions

1. **Is the embedding cache one box or two?** Vectors and the FTS index have different
   rebuild costs — re-indexing text is free, re-embedding costs money and an API round
   trip. A vector cache that is never backed up is also a bill that must be re-paid after
   any loss. (Phase-2 storage agenda item, SYNTHESIS.)
2. **Does prose stay one file per memory?** v1 had 13.6K files across 36 scope
   directories, and 89K files in the archive tree. One file per memory is legible and
   greppable; it is also what made backups 2.6 GB.
3. **How does a v1→v2 import traverse the seam?** It is a near-certainty, and it is the
   exact shape of scar §2.7's worst incident — v1's migration path bypassed the secrets
   gate and put three live API keys into the store.

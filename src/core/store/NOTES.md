# `store/` — implementation notes

*What the CONTRACT left open, and the simplest reading this implementation took.
The CONTRACT is the spec and is never edited from here; this file records choices,
their reason, and what would change them. Everything below is a working default
(CLAUDE.md), not law.*

## 1. Prose format: human lines derived, one payload authoritative

The contract asks for "human-legible text beside an authoritative machine payload;
the parser reads only the payload" (§3, spec §4.2 G7). Shape chosen:

```
---
id: mem_ab12…
type: memory
title: Coffee
happened: 2026-08-24
learned: 2026-08-25
bornDay: 4
payload: {"id":"mem_ab12…","type":"memory",…,"meta":{…}}
---
the body, verbatim
```

- The `key: value` lines are **rendered from the payload** and ignored on parse; a
  hand-edit to them is discarded on the next write, and a test pins that.
- **The body is NOT in the payload.** One source of truth for content, so an owner's
  edit in any editor is unambiguous — the alternative (body in both places) makes
  "which one wins" a policy question on every read.
- Ambiguity is refused loudly with a code, never truncated: missing fence, missing
  payload line, malformed JSON, non-JSON-safe metadata (functions, `undefined`,
  symbols, non-finite numbers), a body that is not a string, and a
  filename/payload id disagreement.

## 2. The strength-only archive exemption is not ported — it is structural

v1 needed a "rewrite differing in nothing but strength bookkeeping skips the archive
copy" rule, decided by a line-level diff (§16 G5). With physics in box 2, a strength
change never rewrites prose at all: `updatePhysics`/`reinforce` touch only the
database. The exemption's *effect* is preserved and its machinery is dropped
(constitution line 15). A test asserts the prose file is byte-identical after
physics churn. **Reopen if** prose ever carries a strength-derived field.

## 2b. Every field on the shared seam gets a column

`MemoryPhysics` and `Salience` (`src/core/types.ts`) are stored field-for-field,
including the two optional ones added while this module was being built:
`salience.claimed` (the author's claimed FLOOR → `claimed REAL`, null when absent,
never defaulted to a number) and `reinforcedDays` (distinct lived days that credited
a use → `reinforced_days INTEGER NOT NULL DEFAULT 0`). Both fail safe when dropped,
which is exactly why they are asserted in the round-trip test rather than trusted.

`uses` is `REAL`, not `INTEGER`: physics §5.5 credits weighted uses, and an integer
column would silently truncate a 0.5. `reinforce(id, day, weight)` persists one
credit and bumps `reinforced_days` only when the day differs from `last_used_day` —
the one derived thing the store computes, because a weighted sum cannot reconstruct
a distinct-day count and identity promotion is gated on it. `updatePhysics()` sets
absolute values and remains authoritative over both.

## 3. Bounded versioning prunes ROWS; prose files are never deleted here

`pruneSupersededVersions()` deletes `versions` rows older than H lived days and
reports the count (scar §2.4: every discard says what and how much). The archived
prose file that a pruned row pointed at is **left on disk** — this module exports no
way to delete a file, by design (§5 G2). So retention here means "the store stops
tracking the version", not "the bytes are gone"; reclaiming the bytes is an owner
operation on the CLI's path (`owner-op-seam.ts`). Two resolvabilities, deliberately
distinct and separately tested:

- `resolve(oldId)` follows `superseded_by` **forever** — a dangling reference is a
  hard error, so this can never expire (§5 G4).
- `versions(id)` / `readVersion(id, seq)` is the retained-history surface, and that
  is what H bounds.

H defaults to **90 lived days** and is a constructor option (module-map ruling 2:
tunable, not an owner ruling).

## 4. `putMany` is atomic by default; per-item isolation is opt-in

§16 G6 wants per-item persistence isolation; the transactional box wants
all-or-nothing. Both are real, and they are different promises, so the caller picks
out loud: `putMany(inputs)` rolls the batch back on the first failure,
`putMany(inputs, { isolate: true })` skips the failure, logs `store.put.skipped`
with the reason code, and persists the rest.

## 5. Write ordering: stage → commit box 2 → publish prose

Filesystems are not transactional, so one crash window is unavoidable. Chosen
ordering and why:

1. Serialize and **stage** the prose into `tmp/` under a name carrying pid, time,
   a counter and randomness, suffixed `.tmp` (§16 G4: a crash-leaked stage must not
   be loadable as a duplicate — the loader only reads `*.md` under `prose/`).
2. Commit box 2 (rows).
3. `rename(2)` the stage into place — atomic, leaves no residue.

A crash between 2 and 3 leaves a row whose prose is missing, and `read()` fails
loudly with `PROSE_FILE_MISSING`; the staged bytes are still on disk for repair. The
inverse ordering would leave canonical prose that the store cannot see — a silent
loss, which is the worse failure. A rolled-back write leaves an inert temp; nothing
sweeps it, because a sweeper is a deleter.

## 6. Telemetry does not live in the canonical database

Events go to an in-memory ring plus an optional `onEvent` sink — not to box 2 and
not to a log file. Reason: observer mode's one deliberate write is its stand-down
event (observer-mode.md G6), and if events were canonical rows an instrument would
mutate the canonical database by standing down. Events carry ids, hashes, counts,
kinds and codes only (§5 G10). **A durable log sink belongs to an adapter**, which
can decide retention.

## 7. Box 3 is an inverted table, not FTS5

FTS5 is a compile-time option and the two supported runtimes do not guarantee it
identically, so text search is a small tokenizer plus a `doc_tokens(memory_id,
token, tf)` table, and vectors are JSON in `embeddings`. Deterministic ordering
(score desc, id asc) is what makes "the same recall for the same cues" testable
after a rebuild (§5 G8). Contract open question 1 (one cache box or two) is answered
as **one file, two tables**: the split that matters is rebuild cost, and that is
expressed by the declaration below, not by a second file. Re-open if vectors ever
need a different backup posture than the text index.

Rebuild declares what it cannot recompute: without an `embed` function the
embeddings are not restored, and the report names `what` / `owner` / `repair` and
logs the count at every rebuild.

## 8. Observer mode

`observer.ts` holds the single predicate and imports nothing (observer-mode.md G2).
It sits in `store/` because the seam is its only consumer today; when a second core
module needs it, **move the file to `src/core/observer.ts`** — it has no imports, so
hoisting is a move, not a rewrite.

The check happens in `mutate()` *before* any staging, so an observer cannot leave a
temp file behind, and every stand-down emits `store.observer.standdown` naming the
site. `WRITE_METHODS` is the enumerated list, and the totality test asserts it
equals the set of sites found in the source — adding a write method without listing
it fails the suite.

Not implemented, deliberately: the byte-identical-canonical-database assertion
(observer-mode.md G4). SQLite may touch file bytes on open alone, so the property is
tested as *refusal at the seam* plus byte-identical prose. **Owner: whoever builds
the probe harness**; the honest form of the test is a populated-store probe run
compared on logical content, not bytes.

## 9. Runtime adapter

`db.ts` selects `bun:sqlite` under Bun and `node:sqlite` otherwise, via
`createRequire` so a missing module is a caught, named error rather than an import
crash. `PRAGMA foreign_keys = ON` at every open (SQLite defaults it OFF, and §5 G4
puts referential integrity in the store). Journal mode is deliberately **DELETE, not
WAL**: WAL leaves permanent `-wal`/`-shm` sidecars, and every top-level path must be
classified (§5 G11).

**The Node branch is structurally present but has not been live-verified**: this
machine runs Node 20 and `node:sqlite` landed in 22. Verify at packaging, together
with the exact version floor CLAUDE.md flags.

## 10. Deferred, with the reason

- **The one-seam totality test over every ENTRANCE** (§5 G1) enumerates the Store's
  own write methods today. The other entrances — hooks, import, replay harness —
  do not exist yet; the test grows with them.
- **The caller-universality test on removal** (§5 G2) needs a caller. `owner-op-seam.ts`
  is types only and exports no function; the store's half — the append-only removal
  record and the deny-list consulted at read and rebuild — is implemented and tested.
- **`erase`-style copy-chasing across box 3 and the edge graph** (§5 G7) is the CLI's
  operation; the store provides the record, the deny-list, and the rebuild skip.
- **Multi-writer / lock discipline (scar E5)** is satisfied for structured state by
  the transaction; concurrent *processes* writing prose is untested.
- **Backups** (§16 G18) are not this module's job; `backupSet()` reports the
  classification so the backup tool cannot silently omit a directory the way v1 did.

## 2026-09-04 — the default data dir is `~/.counterparts/store`, not `~/.counterparts`

The launch inventory reproduced what the parallel-run preflight had worked around: the
host adapter writes `claude-code.json` (and the credentials file) into `~/.counterparts`,
and the store classifies every top-level entry of its data dir and refuses an
unclassified one at open (§5 G11). So the old default, `~/.counterparts` itself, was a
store that could not open on any installed host. The owner ruled (2026-09-04): the base
dir belongs to the adapters, the store sits one level below it, and the default says so.
One line in `dataDir()`, one replaced assertion. The live host is unaffected: its config
names `dataDir` explicitly and the MCP registration sets `COUNTERPARTS_DATA_DIR`, so no
live code path consulted the default. `FORBIDDEN_ROOT_NAMES` is unchanged; the
recall-bench and parallel tools still refuse the whole base dir by name.

## 2026-09-05 — box 3's vectors are float32 BLOBs (cache v4), converted in place

**The debt.** `embeddings.vec` held `JSON.stringify(vec)`: 177.5 MB at ~13.9K vectors on
the live store, ~12.7 KB a row against 4 KB of float32, and a `nearest()` scan that
`JSON.parse`d every row measured at 590–1,040 ms (LAUNCH-STATUS §E-W1(4)). None of that
is the parser being slow. It is the scan reading three times the bytes and then
allocating a 1,024-element `number[]` per row to throw away.

**What float32 costs, said precisely.** It is not a lossy choice for an EMBEDDING: every
provider computes and serves single precision, so the float64 room JSON text was paying
for never held float64 information. It IS lossy for a value that reached the store as a
float64 which is not float32-exact — and the live store's vectors are exactly that, which
the measurement below found rather than assumed. A provider serves ~8 significant decimal
digits; `JSON.parse` turns those into the nearest float64, and `Math.fround(x) === x` is
then false for almost every coordinate. So the conversion moves each coordinate by up to
one float32 ulp (~6e-8 relative).

Measured, on a synthetic store built under `mkdtemp` — 14,000 random unit-norm 1,024-dim
vectors, three scans each, `nearest(probe, 50)`, no real store touched:

| values | file before | file after | scan before (3 runs) | scan after (3 runs) | order | max abs Δscore |
|---|---|---|---|---|---|---|
| 8-digit decimals (**the live shape**: 12.8 KB/row) | 175.3 MB | 61.8 MB (2.84×) | 449, 455, 455 ms | 55, 53, 42 ms (9.0×) | identical | 1.5e-9 |
| float32-exact (21.4 KB/row) | 292.0 MB | 61.8 MB (4.72×) | 608, 598, 602 ms | 41, 45, 39 ms (14.4×) | identical | **0 — bit-identical** |

The first row is the one the owner's store will see; the second is the property the tests
pin, because it is the one that can be stated exactly. `test/store.test.ts` holds both:
bit-identical scores (`Object.is`, not `toBeCloseTo`) for float32-exact vectors, and
same-order-under-1e-6 for float64 ones. The conversion itself ran 14,000 rows in 0.8–1.2 s
plus a 0.3 s `VACUUM`.

**Why the migration converts and does not rebuild.** A rebuild recomputes, and the thing
that would recompute here is an embedder — which the console does not wire, and which
charges per row. `verify --rebuild` as the migration would have meant deleting ~13,700
paid vectors and hoping. The information needed to write the new shape is already in the
old one, so `counterparts migrate-cache` reads each JSON row and writes the BLOB: dry run
by default, `--apply` to convert, one transaction per `--batch` (500), `VACUUM` at the end
because free pages are not free space.

**Three properties that are design, not decoration:**

- **Reads tolerate BOTH shapes** (`decodeVector`). This is what makes it a conversion
  rather than a flag day: an interrupted `--apply` leaves a mixed cache, and a reader that
  assumed one shape would turn an unconverted row into a crash or — worse — a silent
  zero-similarity lie. The cost is one `typeof` per row. `verify`'s census names the mix.
- **The batch is idempotent by its WHERE clause** (`typeof(vec) = 'text'`), so re-running
  finishes an interrupted run and `--apply` on a converted store REFUSES rather than
  printing a conversion it did not do.
- **No table rewrite.** The declared column type is AFFINITY, not a constraint: SQLite's
  TEXT affinity leaves a bound BLOB a BLOB, so a v3 table whose DDL says `vec TEXT` stores
  the new shape correctly. Asserted in a test rather than assumed, because the entire
  write path rests on it.

**Two follow-ups filed by PR #43's review, closed here.** `Store.embeddingCount()` — what
box 3 HOLDS, which is not `unembeddedCount()`'s coverage denominator — and
`rebuildCache({ keepVectors })`, which re-indexes the token side and leaves `embeddings`
in place, dropping only the vectors whose memory is no longer canonical (a removed id, an
orphan) so §16 G12 still holds. `verify --rebuild --keep-vectors` is its door; the old
refusals are unchanged and now name it.

**Brain analog: none, and that is the point.** This is the engineering floor biology does
not have (CONTRACT §2) — a substrate that stores a number in the precision it was computed
in. What is worth saying is the boundary the change respects: nothing canonical moved. Box
3 is rebuildable, so its format is a free variable, and a format change that had needed a
canonical migration would have been the wrong design showing itself.

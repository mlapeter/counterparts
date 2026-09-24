# `store/` — implementation notes

*What the CONTRACT left open, and the simplest reading this implementation took.
The CONTRACT is the spec and is never edited from here; this file records choices,
their reason, and what would change them. Everything below is a working default
(CLAUDE.md), not law.*

*Rewritten in part on 2026-09-20 (F8), when the floor moved the memories into rows.
Sections **1** (the markdown format — it is `render.ts`'s documentation now, because
markdown is an export) and **5** (the stage → commit → rename crash window — there is no
stage) are GONE, and their numbers are left as gaps rather than closed up, so the one
citation that reaches into this file by number (`db.ts` → §9) keeps pointing where it
meant to. Sections 3, 6 and the 2026-09-05 self-contained note are rewritten; everything
dated stays as it was written, because a log corrected after the fact stops being one.*

## 2. Every field on the shared seam gets a column

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

## 3. Bounded versioning: the prune deletes ROWS, and since the floor those rows hold words

*Rewritten at the floor (F8). It used to say the archived prose FILE a pruned row
pointed at was left on disk — this module exports no way to delete a file — so
retention here meant "the store stops tracking the version" rather than "the bytes
are gone", and reclaiming them was an owner operation. There is no file. The
version's words ARE its row, and the prune deletes them.*

`pruneSupersededVersions()` deletes `versions` rows older than H lived days and
reports the count (scar §2.4: every discard says what and how much). The owner
took that ruling knowing what the floor had done to its cost — on by default at 90
lived days, ruling 1 of 2026-09-18, his steer being simple working-memory mechanics
over keeping everything, and losing some data after a month or two an acceptable
price. It is a real cost and it is made visible by a test rather than left as a
sentence.

Two resolvabilities, deliberately distinct and separately tested:

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

## 6. Telemetry: an in-memory ring, and one durable table an adapter prunes

*Corrected (F8). This section used to say events go to the ring and an optional
`onEvent` sink and nowhere else — "a durable log sink belongs to an adapter". Half of
that held and half did not: the sink was built, and it is a table in box 2.*

Two channels, and the observer argument is what keeps them apart:

- **The ring** — capped, in-process, plus an optional `onEvent` sink. Every `emit`
  goes here, an instrument's included. Nothing durable, nothing on disk.
- **`events`, a box 2 table** — written only by `appendEvent`, which is in
  `WRITE_METHODS` and crosses the stance check like every other write. So an
  instrument standing down writes no row, and observer mode's one deliberate write
  stays its stand-down event (observer-mode.md G6) rather than becoming every event
  it happened to watch. That was the whole reason this section said "not box 2", and
  putting the check on the write METHOD answered it without giving up the log.

Retention belongs to the adapter that wanted it: `pruneEvents({ limit })` is called
by sleep's `log` phase, deletes UNLATCHED rows past `retentionDays` lived days
oldest-first, caps the call, and reports what went and what is left. Rows carry ids,
hashes, counts, kinds and codes only, never text (§5 G10).

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

The check happens in `mutate()`, which every write method enters before it touches
anything, and every stand-down emits `store.observer.standdown` naming the site.
`WRITE_METHODS` is the enumerated list, and the totality test asserts it equals the
set of sites found in the source — adding a write method without listing it fails
the suite. *(It used to say "before any staging, so an observer cannot leave a temp
file behind". There is no staging and no `tmp/` since the floor; the position of the
check is unchanged and the reason for it is now the simpler one — nothing may reach
a transaction.)*

Not implemented, deliberately: the byte-identical-canonical-database assertion
(observer-mode.md G4). SQLite may touch file bytes on open alone, so the property is
tested as *refusal at the seam* plus the directory hashed around the open — which
since 2026-09-18 means the `-wal` WITH the database and only the `-shm` skipped
(`isDatabaseSidecar`), because a commit lives in the `-wal` until a checkpoint and a
hash that skipped it would pass over exactly the write it exists to catch. **Owner:
whoever builds the probe harness**; the honest form of the test is a populated-store
probe run compared on logical content, not bytes.

## 9. Runtime adapter

`db.ts` selects `bun:sqlite` under Bun and `node:sqlite` otherwise, via
`createRequire` so a missing module is a caught, named error rather than an import
crash. `PRAGMA foreign_keys = ON` at every open (SQLite defaults it OFF, and §5 G4
puts referential integrity in the store).

Journal mode was **DELETE**, and the reason given here was that WAL leaves permanent
`-wal`/`-shm` sidecars while every top-level path must be classified (§5 G11). That
reason had already expired when it was written — `LAYOUT`'s database entry matches by
PREFIX, so the sidecars were classified all along — and `db.ts` cites this line for
the reason that no longer holds. Both boxes are **WAL since 2026-09-18** (§5 G18);
the dated note below carries the pragma order, the measurements, and the three things
a WAL store cannot do that a DELETE store could.

**The Node branch is structurally present but has not been live-verified**: this
machine runs Node 20 and `node:sqlite` landed in 22. Verify at packaging, together
with the exact version floor CLAUDE.md flags.

## 10. Deferred, with the reason

- **The one-seam totality test over every ENTRANCE** (§5 G1) enumerates the Store's
  own write methods. It is a SOURCE scan of this module, so an entrance that reaches
  a write method is covered by construction and an entrance that goes around one
  would not be. The hooks and the replay harness both exist now and both go through
  `Counterpart`; the import entrance the guarantee named was deleted with the tool
  (F8). What would make it total is the same enumeration one level out — over every
  caller that mints canonical text — and nothing does that today.
- ~~**The caller-universality test on removal** (§5 G2) needs a caller.~~ **DONE.**
  `owner-op-seam.ts` stopped being types-only on 2026-08-25 (`chaseRemoved`,
  `grantOwnerOps`, `REMOVED_REASON`, later `unarchiveMerged`), its export list is
  pinned by name, and `test/cli.test.ts` asserts that no core module, no other
  adapter and no other test imports `removal.ts`.
- **`erase`-style copy-chasing across box 3 and the edge graph** (§5 G7) is the CLI's
  operation; the store provides the record, the deny-list, and the rebuild skip.
- **Multi-writer / lock discipline (scar E5)** is satisfied for structured state by
  the transaction, and since 2026-09-18 concurrent PROCESSES are covered for the two
  databases as well — WAL plus a busy timeout set first, with a test that holds a
  write transaction on one handle and asserts the second waits (§5 G18). What is
  still argued rather than tested is the two mutable directories that are not
  databases: §5 G3's totality does not prove one writer each for `spans/` and
  `sessions/` (CONTRACT §7 question 4).
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
| 8-digit decimals (**the live shape**: 12.8 KiB/row) | 175.3 MiB | 61.8 MiB (2.84×) | 540, 507, 459 ms | 49, 46, 42 ms (11.1×) | identical | 1.5e-9 |
| float32-exact (21.4 KiB/row) | 292.0 MiB | 61.8 MiB (4.72×) | 654, 619, 637 ms | 47, 49, 42 ms (13.9×) | identical | **0 — bit-identical** |

The first row is the one the owner's store will see; the second is the property the tests
pin, because it is the one that can be stated exactly. `test/store.test.ts` holds both:
bit-identical scores (`Object.is`, not `toBeCloseTo`) for float32-exact vectors, and
same-order-under-1e-6 for float64 ones. The conversion itself ran 14,000 rows in 0.9–1.2 s
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

**How far the rounding can reach, which is further than its size suggests.** The
adversarial review (2026-09-05) found the argument that matters, and it belongs here rather
than only in a PR body. The 1e-9 movement is continuous, but two of its consumers are
DISCRETE:

- `recall/activate.ts:300` applies an ABSOLUTE floor, `if (h.score < SEMANTIC_SEED_FLOOR)
  continue` (0.45). A candidate that crosses it by 1e-9 does not gain 1e-9 of anything — it
  gains `semantic > 0`, and `recall/gate.ts:273` builds the turn's background from
  `candidates.filter((c) => c.cue + c.semantic > 0)`. **Membership is a whole number.** So
  the crossing changes `n`, `mean`, `sd` and every other candidate's leave-one-out bar by
  O(1/n), and `background()` switches regime entirely at `n < MIN_BACKGROUND_SAMPLE` (3).
  Measured on illustrative activations at TUNABLES defaults: the regime flip moved the bar
  by 2.6e-1, and an in-regime n=3→4 by 4.6e-3. The magnitudes depend on the activations;
  the O(1/n) shape does not.
- `ranked.slice(0, SEMANTIC_TOP_M)` (`activate.ts:301`, 8) is a RANK cut, fed the same way
  from `counterpart.ts:840` and from the worker: a 1e-9 swap at ranks 8/9 changes the seed
  set outright.

The probability is negligible — a top-8 cosine would have to land within ~1.5e-9 of exactly
0.45, and the smallest adjacent score gap in a 14,000-row top-50 measured 1.7e-7, about a
hundred times the perturbation. The CONSEQUENCE, should it happen, is finite. That is the
honest shape of the claim, and it is why the G12 class is the third one: "provably
identical" is a claim about consequences, not about probabilities.

**What the review changed, all of it in the same direction.** A `NaN` no longer survives a
write (`encodeVector` coerces non-finite to 0 and `countNonFinite` reports it) — v3 coerced
it by accident, via `JSON.stringify(NaN) === "null"`, and writing it through would have been
a regression dressed as a format change, since `nearest`'s comparator reads `NaN - x` as
falsy and lets such a row sort anywhere. A BLOB whose byte length is not a multiple of four
decodes EMPTY rather than truncated, and `vectorFormats` counts it as unreadable: a
silently shortened vector is a cosine over a prefix, a wrong number with no signal on it. A
row that will not parse costs one row — `convertVectorBatch` parses outside the transaction
and takes an `after` cursor, because the first version rolled the batch back and then
re-selected the same row forever, one corrupt byte holding 13,000 vectors hostage. And
`keepVectors` no longer offers a held row to the embedder at all: it called it and let
`indexDoc` overwrite what it had just promised to preserve.

**Brain analog: none, and that is the point.** This is the engineering floor biology does
not have (CONTRACT §2) — a substrate that stores a number in the precision it was computed
in. What is worth saying is the boundary the change respects: nothing canonical moved. Box
3 is rebuildable, so its format is a free variable, and a format change that had needed a
canonical migration would have been the wrong design showing itself.

## 2026-09-05 — the two clocks: lived days for physics, real dates for provenance

*The design behind LAUNCH-STATUS §I7 and the owner's ruling of 2026-09-04: "we do
lived days for good reason (if we don't chat for a few weeks we don't want everything
to fade) but we also need to use actual dates/clock times, so we should have a
solution that works and understands both."*

### The brain analog

**An episodic memory carries a "when" that is separate from its consolidation age.**
The hippocampus time-stamps an experience — the temporal context that lets you say
"that was the Tuesday before the trip" — and that stamp is CONTENT: it can be recalled,
it can be wrong, it can be corrected without changing anything about how strong the
memory is. Consolidation age is a different variable entirely, and it is the one that
governs forgetting: how much has happened since, how many times the trace was
reactivated, how far systems consolidation has carried it out of the hippocampus. Two
weeks in a coma and two weeks of living are the same fourteen calendar days and are
not the same amount of consolidation.

v2 had the second and was faking the first. `physics/clock.ts` is a careful,
well-defended lived-day clock — engram scar E8, "a week away must not decay a week's
worth". Provenance had no clock at all: `store.put` defaulted `learnedOn` to a
module-level `today()` that read the ambient `Date.now()`, `appendEvent` and the
version rows stamped `Date.now()` inline, and `Store.open` took no clock to be given
one. So the "when" was not a stamp on the experience, it was a stamp on the WRITE —
and every path where those two differ produced a row that says a thing that is not
true. Three of them, all measured:

- the demo store: 156 of 172 rows read the day the seeder ran; every one of the wake's
  26 lines opened `2026-09-05 ·`;
- a replay of a corpus from months ago: every row dated the day the harness ran;
- the v1 import: 12,334 of 14,529 migrated memories carry the import day
  (`docs/PARALLEL-RUN-STATUS.md`, 2026-09-04), which is why #29/#30 had to render a
  migrated element as an upper bound, `by 2026-09-03 ·`, rather than as a claim.

### The model

**Two clocks, named, with a fixed division of fields.**

| | PHYSICS CLOCK | PROVENANCE CLOCK |
|---|---|---|
| what it measures | how much experience has passed | when in the world |
| where it lives | `livedDay()` / `advanceClock(date)` / `physics/clock.ts` | `StoreOptions.now`, `Store.now()`, `Store.today()` |
| who moves it | the host, once per lived day | the session, continuously |
| what reads it | decay, consolidation, dedup's tie-break, banding, pruning, `bornDay`, `bandDay`, `lastUsedDay` | `learnedOn`, `happenedOn`, the event log's `at`, a version's `archived_at`, a removal record's `at`, the in-process event ring |
| what a week away does | nothing — days not lived do not advance it | seven days pass, because they did |

The provenance clock is INJECTED and defaults to `Date.now`, so a host that gives it
nothing behaves exactly as it did before this entry existed. The seeder gives it the
story's day, the replay driver gives it the corpus day, and a migration would give it
the day the row was actually learned. There is now exactly one `Date.now()` call left
in `store/index.ts` — inside the module-level `today()` the adapters still use — and
`test/two-clocks.test.ts` counts it.

**The mint path takes the PROPOSAL'S instant, not the write's.** `mintProposal` dates a
memory `dateOf(proposal.at)`: the moment the author deposited, read off the span
buffer's injected clock. The row is written later — at a boundary, possibly the next
morning, possibly during a replay of a corpus from a year ago — and a memory is dated
by when it was learned. On the crash-fallback path the proposal's `at` is the
boundary's own `nowFn()`, which makes a swept memory dated the day it was INTERPRETED.
That is the honest default and it is named rather than assumed: the spans it read
carry their own instants, and deriving a `happenedOn` from them is DELIBERATELY not
done here, because `prospective/` reads `happenedOn` as a content date and would begin
arming windows off a field the interpreter never claimed. Filed, not forgotten.

### Four decisions, with the reason each was taken

1. **UTC, not local.** `dateOf(at)` is `toISOString().slice(0, 10)`, the same
   arithmetic `today()` always used, and the same arithmetic every other date in this
   codebase is written with: the hook that supplies `advanceClock`'s date
   (`bin/hook.ts:101`), the worker (`bin/runner.ts:177`), `sleep/cycle.ts#todayDate`,
   the embedder's seat rotation. Provenance dating locally while the physics clock is
   keyed UTC would put the two calendars a few hours out of step for anyone west of
   Greenwich and make a row's `learnedOn` disagree with the lived day it was born on.
   **Moving ALL of them to local dating is a real question and it is filed, not
   decided here**: it is a one-line change per site and a behaviour change on the live
   store, and it wants its own carry-forward declaration.
2. **Not `physics/clock.ts#dayKey`.** `dayKey` shifts by `BOUNDARY_HOUR` so that a
   lived evening running past midnight counts as one day. That is a PHYSICS idea — it
   answers "which lived day does this activity belong to". A memory taken at 01:30 was
   taken on the 14th whatever lived day it counts toward, so provenance does not get
   the boundary shift. The two functions stay in two files for that reason.
3. **`revise` is the door for a date correction.** `store.revise` learned
   `learnedOn` / `happenedOn`, writing the prose frontmatter and the column in one
   transaction. A date correction is a revision: `revise` archives the prior document
   first, so the wrong date stays readable in `versions/` (constitution 7 — revisions
   keep their history, nothing is silently overwritten). This also closes
   `prospective/INTERFACE-GAPS.md` §4, which asked for exactly `happenedOn?: string` in
   the patch so a reschedule could complete in one call.
4. **The physics date key stays the host's.** `sleep/cycle.ts#todayDate()` still exists
   and still reads the ambient clock; every live entry point passes `date` explicitly,
   so it is only a fallback. What changed is which fallback: `Counterpart.sessionEnd`
   now defaults `date` to `this.store.today()`, so a caller who forgets the date
   advances the lived-day clock with THIS SESSION'S date rather than with a date from a
   different year than everything the same run wrote. A boundary is the one place the
   two clocks touch, and that is the only line where they do.

### The repair, and the three guards the review bought it

Nothing here is retroactive. The 12,334 migrated rows still carry the import day until
the owner runs `counterparts repair-dates --apply`, which proposes true dates from what
the rows themselves carry — engram-era ids that are millisecond timestamps, v1 `created`
fields, a v1 element's `statedOn` / `openedOn`, session references, source paths — and
writes nothing on a dry run.

The adversarial review of PR #67 reproduced the failure mode that matters, and it is
worth recording because the shape recurs in every repair tool: **a repair that measures
its own starting condition stops being able to measure it once it has run.**
`measureImportDay` takes the MODE of `learned_on`; after `--apply` the mode can move to a
repaired date, which both narrows the plausibility window and pulls correctly-dated rows
into the target set. Measured on the review's fixture: a second `--apply` wrote ten
no-op revisions and ten events for five rows, and at 12,334 rows that is ~12K archived
documents recording a change that did not happen. Three guards, in the order they fire:

1. **The import day is pinned, not re-measured.** The first `--apply` records the day it
   used in store meta, later runs read it back, and `tools/migrate/apply.ts` now writes
   `migratedOn` at import time so a store migrated from here on never has to be measured
   at all. A recorded day the measurement contradicts is a REFUSAL with the flag that
   overrides it printed — the two ways that happens are "somebody repaired this already"
   and "this is not the store you think it is", and both want a human.
2. **A repaired row is never a target again**, by a marker on its own document
   (`meta.dateRepaired`).
3. **A proposal equal to the date already there is never written.** A re-dating that
   changes nothing must not archive a version and claim it did.

**The dry run shows the shape of what it would write, not only the count.** A v1 importer
that stamped one `created` date onto thousands of documents reads as confidence `high`
here, and applying it would re-do the exact failure this tool exists to undo — invisibly,
because twenty sample rows out of 12,334 cannot show it. So the report prints the
proposed dates by count and flags any single date carrying more than 5% of the proposals
(with a five-row floor, so a small store does not cry wolf).

**A repaired date stops being hedged.** `self/`'s wake renders a migrated element's date
as an upper bound — `by 2026-09-03 ·` — because the row could not say whether the date
was v1's or the importer's. A row repaired at HIGH confidence now says which, so it
renders plainly; `medium` and `low` keep the bound, because the session, the element's
statement and the source path are all still "no later than". The marker is read
structurally in `self/index.ts` (an adapter's constant may not be imported into core) and
a malformed one renders the bound, which is the safe direction.

### What this does not fix, on purpose

- **Migrated ELEMENTS have no evidence to recover from.**
  `tools/migrate/apply.ts#writeElement` does not pass `el.v1Id` into the element's meta,
  so every `sch_` row without a `statedOn` / `openedOn` lands in the `none` bucket and is
  left exactly as it is. The count shows it; this is the reason. Fixing it means changing
  the migration and re-importing, which is a different operation than a repair.
- **`happenedOn` from spans.** See above. `prospective/` reads it; deriving it would
  arm windows nobody claimed.
- **Local dating.** Decision 1.

## 2026-09-05 — `COUNTERPARTS_REQUIRE_EXPLICIT_DIR`: the implicit default can be refused

**The incident (LAUNCH-STATUS I21).** Overnight an agent opened the owner's live store
by passing the wrong option name to a library call: `dir` was undefined, it had no
`COUNTERPARTS_DATA_DIR`, and `dataDir()` did what it is documented to do — returned
`~/.counterparts/store`. Read-only, nine titles printed to its own terminal, no write,
no egress; and exactly the shape every guard in this module was built to catch, one
directory over. `.counterparts` is deliberately NOT on `FORBIDDEN_ROOT_NAMES` — the store
has to be able to open its own default — so the path guard (§5 G9) could not have fired,
and `test/preload.ts`'s temp-home redirect protects only the test process. The owner
ruled: add a guard, OFF by default, ON in this repo's agent shells.

**The mechanism.** One environment variable, two new error codes. With
`COUNTERPARTS_REQUIRE_EXPLICIT_DIR` armed, `dataDir()` throws `IMPLICIT_DEFAULT_DIR_REFUSED`
instead of returning the fallback, with `{ guard, dir, remedy }` in the detail so the
message names all three without any caller composing it.

**Reading the switch — three answers, not two.** It arms on `1`, `true` or `on`, trimmed
and case-insensitive: a superset of the two `COUNTERPARTS_OBSERVER` accepts, so a person
who exports `=true` or `=on` by analogy is protected. It stands DOWN on `0`, `false` or
`off`, exactly as if unset. And it REFUSES anything else non-blank with
`EXPLICIT_DIR_GUARD_MALFORMED`, at the same decision point (`explicitDirRequired`), with
a sentence naming the value, the three words that arm it and the three that turn it off.

Two review rounds shaped that. The first draft armed on exactly `1`, and the #80 review
measured `=true`, `=yes`, `=on` and `= 1` all falling silently to the default: fail-open,
the one direction a safety guard may not have. The fix over-corrected — it refused `0` and
`false` too — and the owner ruled that back: a guard whose `=0` refuses trips the shell of
the person it protects, which is the surprising choice, and refusing on junk keeps the
fail-closed property without it. **Off means off; junk is a question this will not answer.**

`COUNTERPARTS_OBSERVER` is deliberately NOT widened to the same set, though the parity
argument runs both ways. It is matched exactly (`"1"` / `"true"`) in two places —
`cli/commands.ts` and `mcp/bin/serve.ts#launchOptions` — and the second is on the live MCP
server's launch path, which this change promises to leave instruction-for-instruction
identical; giving observer a fail-closed arm is a behaviour change to an unrelated
variable and wants its own ruling. So the guard is the superset, and says so. The guard is consulted
only where it decides — a malformed value beside a named `dir` or a named configuration
is not read at all, because the guard's one question is about the fallback. Every door
the store has funnels through that one function — `Store.open`,
`Counterpart.open`, `SpanBuffer`, `storeExists()` with no argument, the console's
`resolveDir`, the dashboard — so the guard sits in one place. The env-set case returns
before the guard is read: a process launched with `COUNTERPARTS_DATA_DIR` (the live MCP
server) executes the instructions it executed before. `dataDir()` also gained an
injectable `env` parameter (default `process.env`), which let `cli/commands.ts#resolveDir`
drop the swap-the-variable-in-and-out-of-`process.env` shape it had, and lets a test
construct the armed and unarmed cases without touching the process.

**The second door, and why it is covered.** The reviewer of PR #72 named the configuration
default as the other way into the live machine, and it is: a default-sourced
`~/.counterparts/claude-code.json` NAMES a store (`install` always writes `dataDir`) and
the credentials beside it, so the hook, the worker and the MCP server reach the live store
and the live keys with `dataDir()` never called — and `install` builds `~/.counterparts`
from `homedir()` itself and writes there. `adapters/config-path.ts#implicitConfigRefusal`
is the same variable at that door: armed AND the configuration resolved to the default →
a refusal string, chained after `namedConfigRefusal` in the three bins and applied by hand
in the console's `install` branch. It is a separate function, not a clause in
`resolveConfigPath`, because `rebrief` resolves through the resolver too, for a budget
NUMBER against a store already named by `--dir`; refusing that would teach people to unset
the guard. The line: **the guard refuses an implicit default that locates a store or
writes the live base; a number read from the default config is neither.**

**Not covered, on purpose.** `claude-code/primacy.ts` reads the parallel run's assignment
file at `~/.memory-ab` by default — read-only, no store, and `test/store.test.ts` pins it
read-only. `tools/parallel/bin/{preflight,daily,restart}.ts` carry the live paths as
defaults by their own contract (every real path is a flag; the run directory's overlap
guard needs them named). Neither goes through `dataDir()` and neither opens a store.

**The gap between the two doors, and how it surfaces.** A NAMED configuration that names
no store — `--config` at a file with only `injectionBudgetBytes` — and no
`COUNTERPARTS_DATA_DIR`: `implicitConfigRefusal` is not its business, so the bins proceed
and `loaded.dataDir ?? dataDir()` meets the STORE guard, thrown rather than returned. The
refusal is right (a config that omits `dataDir` named where the keys are, not which
memory); the first draft's rendering was not: the hook printed the raw `StoreError` JSON,
whose remedy said `--dir` — a flag the hook does not have — and the worker exited 0 and
the server exited 1 with nothing on stderr (#80 review, recommendations 3 and 4). Now
`store/paths.ts#describeGuardRefusal(err, remedy)` renders both guard codes as one
sentence with the SURFACE's own remedy: the console, the dashboard and the server say
`--dir <path>, or COUNTERPARTS_DATA_DIR`; the hook and the worker say `Set "dataDir" in
<the file they read>, or set COUNTERPARTS_DATA_DIR`. The worker's and the server's
rejection handlers print that sentence (or, for any other error, its message) before
their exit 0 / exit 1, where they printed nothing — the one place this PR widened two
entry points' failure legibility, because the reason was sitting in the error the
handler was discarding (`test/config-rule.test.ts`, "the WORKER and the MCP SERVER say why
in that same gap", which spawns both as real processes).

**THE SECOND INCIDENT, and the refusal it earned (2026-09-04, added in the #80 review
round).** I21 was read-only and cost nine titles. The day before it, the same door was
walked through in the other direction, with a WRITE at the end: a suite run that had lost
`test/preload.ts`'s home mock resolved the owner's REAL `~/.counterparts/claude-code.json`
and rewrote its `dataDir` to a temp path. That file is the one the hook, the worker and the MCP server
read when nothing names another, so from that moment his live memory was a directory the
OS was free to delete — and it recorded nothing for three days before anyone noticed.
This PR is the prevention, and the mock is only half of it: a mock can be lost, and was.

So `cli/install.ts#throwawayDefaultRefusal` refuses the shape itself, with no variable
involved — the incident's shell had neither the guard nor the mock, so a refusal that
needed either would not have been there. `install` will not write THE DEFAULT
`~/.counterparts/claude-code.json` with a `dataDir` under a temp root (`os.tmpdir()`,
`$TMPDIR`/`$TMP`/`$TEMP`, `/tmp` — each compared in both its spellings, because macOS
hands out `/var/folders/…` and `/private/var/folders/…` for the same directory).
`--config <elsewhere>` is the way through and moves the credentials and the store with
it, so a scratch install is scratch all the way down; `--force` does not buy past it,
because `--force` overwrites a file you named and this is the file nobody named.

The refusal's third clause is what keeps the clean rooms working, and it is the honest
answer to "key it on the REAL default path": it fires only when the CONFIG is **not**
itself under a temp root. `tools/install-loop/run.sh` installs into a fake `$HOME`
beneath `$TMPDIR` with no `--config`, so its default config and its store are both
throwaway and both under the same base — a stranger's install, correctly measured, not a
live default pointed at a temp store. The test suite is in the same position (the mocked
home is minted under `os.tmpdir()`), which is why the refusal is provable only with an
injected home outside the temp tree; both install-loop runs stayed 47/47 with it in.

**Observation, recorded (#80 review, 5).** The guard is read from the INJECTED
environment only: `dataDir(env)` and `cli/commands.ts#run(argv, { env })` read the object
they were handed, so `run(["status"], { env: {} })` with `process.env` armed is not
refused — it reaches the fallback, which in the suite is the mocked temp home. The real
bin passes no `env` (`opts.env ?? process.env`), so no live surface is affected, and the
preload's first layer still holds for a test that injects an empty environment; what the
second layer promises — "a forgetful test is REFUSED" — is true of tests that do not
inject one. OR-ing the injected env with `process.env` would close it at the cost of the
"unarmed → today's behaviour" tests having to stand the process guard down around their
bodies; left as is, and named here, so the choice is visible.

**Follow-up, filed (#80 review, 6).** `tools/parallel/bin/restart.ts` still reaches a live
path by naming nothing — its `--v2-data-dir` default is `join(homedir(), ".counterparts")`
— and WRITES there. It is outside this guard by construction (an explicit dir built from
`homedir()`, never `dataDir()`) and outside the ruling's scope; it is the incident's exact
class with a write at the end, and wants its own ruling.

**Where it is ON.** `test/preload.ts` (a forgetful test is now REFUSED, not redirected —
the second layer under the temp-home; `test/preload.test.ts` asserts it is armed when a
file starts, so a test that stood it down and forgot to re-arm it is caught), the demo
seeder's CLI path, the visual loop, the recall bench's bin. The install loop UNSETS it
inside its clean room: its fake HOME already makes the defaults throwaway, and the loop
measures a stranger's environment — the stranger's path IS the defaults. One loop step
arms it on purpose to prove the installed console and hook carry the refusal.

**Cost.** With the variable unset, every function in the change returns the same value and
performs the same side effects it did before, for every input, on every host. The MCP
server's arm has zero new instructions; the hook's and the console's fallback arms each
evaluate one new side-effect-free environment read. Surface-set hash unchanged
(`c3af0bef00209ba6` on master and branch). Declared to the parallel run as ANYTHING ELSE
riding today's owed restart rather than IDENTICAL — G12's first class is telemetry-only by
its text, and a guard is not telemetry — with the value-identity argument recorded as the
reach (`docs/PARALLEL-RUN-STATUS.md`, same date).
## 2026-09-05 — a store directory is self-contained (schema v5, and what survived the floor)

*Condensed at the floor (F8). The v5 MECHANISM is deleted and the long version of this
note with it: the store-relative path columns, `resolveStoredPath`'s four cases, the
blank-pointer line that mattered most in review, `relativizeStoredPath`'s deepest-segment
tail rule, the `../ESCAPE/…` guard, the argument for why a schema bump beat a tolerant
no-bump, the `OBSERVER_READ_FLOOR` exception that bump earned, and the migration's three
properties with their 79/82/67 ms measurement. All of it existed to keep a row's POINTER
honest, and there is no pointer. The bug and the property are what is worth keeping.*

**The bug** (finding I22, LAUNCH-STATUS G26). `insertOne` wrote an ABSOLUTE
`<dir>/prose/<family>/<id>.md` into `memories.prose_path`, and `revise`/`supersede` wrote
the same shape into `versions.path`. Every reader handed the column straight to
`readFileSync`, and `adapters/cli/removal.ts` handed it to `rmSync`. So a copied store —
`cp -R`, a `counterparts backup`, a restored snapshot — opened fine, listed its own rows,
and read the ORIGINAL's prose through them; a removal run in the copy reported success and
deleted the original's file while the copy's own survived. Constitution line 7's
catastrophe case — source gone, open the backup — is exactly where a read-only reader
failed.

**What keeps it now: nothing does, and that is the point.** A row IS its memory, so there
is no address outside the database for a copy to resolve against the wrong root, and no
resolver left to get one wrong. The criterion is unchanged and still proved —
`test/store-portable.test.ts` copies a store, destroys the source outright and reads
through the copy; removes through the copy and finds the source byte-identical; and opens
a `backup` snapshot standalone (§5 G15). `tools/parallel/legacy-paths.ts` keeps
`resolveStoredPath` and `relativizeStoredPath` for the read-only instruments that still
read the owner's parked pre-rows store; nothing in `src/` imports either.

**The one loose end the v5 note named, closed by the floor rather than by anybody:** the
plaintext `export` bundled `prose/` and the database but NOT `versions/`, so a restored
export's version rows dangled. Versions are rows in the one database `VACUUM INTO` copies,
so there is nothing left to omit.

**Brain analog: none.** This is the engineering floor (CONTRACT §2). What it protects is
constitution line 6 — memory that "travels across hosts" cannot be pinned to one machine's
directory tree — and line 7's "backups catch catastrophe", which was not true while a
backup's rows pointed at the live store.

## The backfill's give-up list lives in meta (I33, 2026-09-11)

`missingVectors` returns a STABLE order — first-person material first, oldest
first inside each group — and that order is a memory claim worth keeping. It is
also, without a skip list, a head-of-line block waiting for one un-embeddable
row: two migrated memories carrying a lone UTF-16 surrogate made the provider
answer 400 for the whole 64-text chunk, and the same head-64 was re-asked at
every boundary for a week while 165 blind memories waited behind them.

**`embed.failed.<id>` in box 2's meta, `EMBED_SKIP_AFTER` = 3.** Meta keys, not a
column and not a schema bump — the precedent is `sleep.pruned.<id>`, and the fact
being recorded is about a retry loop, not about the memory.

**Only an ITEM-ATTRIBUTABLE failure may move it, and "three" was never the guard
that made that true.** The first cut counted every failure and said three in a
row was past transient. It is not: a 429, a dead socket or — worst — the detached
worker's own watchdog abort fails the WHOLE window every time it happens, so
three bad boundaries retired sixty-four healthy rows and `unembeddedCount` then
read COMPLETE. That is I33 inverted, with the coverage watch failing in the
optimistic direction, and a 503 test now pins it shut. The counter moves only
when the last fill blamed ONE INPUT — a 400 the bisector narrowed to a single
item (`ChunkFailure.item`). Three is still the limit because even a 400 can be
answered for a reason that is not the text.

The gate is per FILL rather than per id: a `ChunkFailure`'s offsets address the
embedder's own deduped batch, not the backfill's ids, so a fill that mixed an
isolated 400 with a 500 elsewhere still charges the 500's victims. Bounded by a
run that saw poison at all, and named in the adapter's INTERFACE-GAPS.

**The moves are ONE transaction.** `setMetaMany` exists for this: one `setMeta`
per id was one lock acquisition per id, on exactly the run where things are
already going wrong, at a boundary where the adapter has measured six
overlapping workers against a 5 s busy timeout. A run where everything lands
writes nothing at all.

**A skip is not a denial, and the two must never merge.** `deniedIds()` is a
REMOVAL: the row is dark, it must never come back, and a read of it is a refusal.
A skipped id is live, recallable, lexically indexed and perfectly ordinary —
only its vector is missing. `skippedVectorIds()` names them, `verify` prints
them, and setting the counter back to zero puts the id straight back in the
rotation.

**The skip is self-sealing, so it needs a door of its own.** A run that LANDS
clears the counter — but a skipped id is never offered to a run again, so it
cannot land; and `rebuildCache` has no embedder to recompute a vector with and
never touches meta. The first cut of `verify` printed "repair it (or rebuild box
3) and the counter clears on the next run that lands", and neither half of that
was reachable. `counterparts verify --dir <store> --retry-skipped` is the remedy:
it clears every `embed.failed` counter, names how many and which ids, writes
nothing else, and lets the next boundary decide again on the evidence.

**`unembeddedCount()` excludes them, and that is the honest reading.** The count
exists so a coverage watch has a number that falls run over run; a number that
can never fall because three rows in it can never be embedded is a watch that has
quietly stopped meaning anything. The excluded rows are not hidden — the backfill
row carries `skipped`, `verify` prints the ids beside the count — so the two
numbers add up wherever a person actually reads them.

**`metaWithPrefix(prefix)`** is the read that makes this affordable: one `LIKE`
(with `%` and `_` escaped — callers pass a key prefix, not a pattern) instead of
one `getMeta` per live memory. `sleep.pruned.<id>` has the same shape and the
same potential reader.

## `memories.band` is the band of record, and decay keeps it true (U8, 2026-09-14)

**What the column meant until now, in practice: nothing anybody could trust.**
Every row is inserted `episodic` (`insertOne`, `input.band ?? "episodic"`);
`setBand` was called from exactly one place, `sleep/consolidate.ts` at the
identity crossing. Nothing ever wrote `semantic`. On the live store that read
`1,054` semantic rows in the ranking cache against `185` in the table, all of
them stamped `band_day = 184` — the one day a promotion ever fired — and 869 live
rows semantic in box 3 and episodic in box 2 at the same instant.

**The ruling: the table follows physics.** `sleep/decay.ts` now writes a row's
band back to `memories.band` / `band_day` whenever the column disagrees with
`band(m, d)`, in the same pass that emits the `band.transition` rows — so the
canonical column cannot contradict the crossing records the system publishes
about it. The reasoning, and why this is not the materialize-decay churn v2
declined, is in `sleep/NOTES.md` §5.

**Who reads the column, as of this PR** — enumerated, because changing what a
column means is only safe if the readers are known:

| reader | reads | effect of the change |
| --- | --- | --- |
| `self/identity.ts` (`list({ band: "identity" })`, `row.band !== "identity"`) | the identity band, as a set | none: `band()` answers `identity` only for a `promotedIdentity` row, which `consolidate` already stamped, and identity is decay-exempt |
| `adapters/mcp/server.ts` `status.byBand` | the column, directly | **fixed**: it stops reporting a fossil |
| `adapters/cli/commands.ts` `status` | computes the band from physics and says so in a comment | none; the workaround is now redundant rather than wrong |
| `adapters/dashboard/` (`browse.ts`, `status.ts`, `web/views.ts`) | computes live, shows the recorded column beside it | none; `recorded` now agrees after a pass |
| `schemas/` | reads `band`, writes none (§4 of its CONTRACT; source scan) | none |
| `sleep/consolidate.ts` | `rowToPhysics`, never `band` | none — promotion never gated on the column |
| `revision.ts:310` | **GATES**: `row.band === "identity" \|\| target.promotedIdentity` routes a declaration to the identity arm | none in the losing direction — see the argument below |
| `store/owner-op-seam.ts:213` → `self/identity.ts:388` | **GATES**: the removal tombstone captures `row.band` at chase time, and the enumeration lists a removed element as an identity absence on `gone.wasPromotedIdentity \|\| gone.band === "identity"` | none in the losing direction — see the argument below |

**Two of them GATE, and the reconciliation is safe for both.** An earlier
statement of this change said none of the readers gated on the column; that was
wrong, and the two above are why the enumeration is worth keeping. Both are ORs
with `promoted_identity`, and `band()` returns `identity` **iff**
`promotedIdentity` — it is the first line of the function, before any arithmetic
(`physics/index.ts`). So for a live row the reconciliation can only write the
column INTO identity (a promoted row whose column had not caught up), never out
of it, and a gate that fires on `band === "identity"` can only gain rows it
should already have had. The single path that writes `identity` into the column
without the flag is migration — `tools/migrate/plan.ts` hands a v1 trace above
the identity gradient cut `bandOf()` identity while `promotedIdentity` stays
false when v1 itself had retired the trace — and such a row is written ARCHIVED,
which the decay pass skips outright. Only the owner-op `unarchiveMerged` door
could put one back in front of the pass, and there the correction is the point:
an un-merged row whose column claims identity it was never promoted to is
exactly a column denying the arithmetic.

**`band_day` means "the lived day the column was last brought to physics."** It
has never been a crossing record: the latched `band.transition` row is, and it is
the one a reader should join on. The first pass after this ships stamps the whole
backlog with one day, which is the honest reading of what happened — the column
was reconciled that day.

**Checked, not believed:** `counterparts verify` counts live non-journal rows
whose column disagrees with box 3 (`cli/commands.ts#bandOfRecordCensus`), and it
is 0 after a decay pass that its budget did not cut short.

## WAL, and the busy timeout first (I38/I39, 2026-09-18)

`openDb` sets its pragmas in this order, and the order is the fix:

1. `PRAGMA busy_timeout = 5000` — **first**. Every statement after it can contend
   for a lock, and without it SQLite fails them INSTANTLY. It used to be set LAST,
   which meant the journal-mode statement ran with zero wait inside another
   writer's commit window: I39, and the shape of the I38 "database is locked"
   reports.
2. `PRAGMA foreign_keys = ON` (unchanged).
3. The journal mode is **read, then set only when it differs from `wal`** — and
   only when the caller asked (`openDb(path, { wal: true })`). Reading is free;
   setting is a write that takes the exclusive lock, so an opener that converted a
   file it had come to read would be writing at open (§5, the observer rule). The
   default is OFF for the openers that matter: `vacuumInto` opens the SOURCE of a
   backup this way, and `cli` opens box 3 read-only for the vector census. The
   writer path asks (`openOperational` when `initialize !== false`), and so does
   `openCache` unconditionally — box 3 is declared rebuildable and its sidecars
   live inside `cache/`, the same licence the constructor already takes to
   materialize that directory under an instrument.
4. `PRAGMA synchronous = FULL` — unchanged. WAL's usual pairing is `NORMAL`; that
   is a durability ruling for the owner, not a cleanup to make in passing.
   TUNABLE, and the one knob here that trades fsyncs for commit speed.

**Why WAL at all:** several processes hold this one small database open at once —
the session hooks, a long-running MCP server, the nightly worker, the dashboard —
and in WAL a reader no longer blocks the writer.

**What was measured getting here** (bun:sqlite 1.3, macOS; all of it is pinned in
`test/store.test.ts`'s "WAL, the busy timeout, and I39"):

- **What a contended conversion costs depends on who holds the lock.** Against a
  WRITER, SQLite does not run the busy handler: the statement fails in about a
  millisecond (measured: 3 ms), the open continues in the old mode, and the next
  open tries again. Against a READER the handler DOES run, so the open waits for
  the reader and then converts — a 600 ms read costs 600 ms, and a reader holding
  for longer than `BUSY_TIMEOUT_MS` costs the full five seconds and leaves the
  file as it was (measured: 5,297 ms). So the ONE converting open can wait, once,
  up to five seconds; every open after it reads `wal` and returns without a
  statement, and in DELETE mode that opener's first WRITE would have waited on
  the same shared lock anyway. *(The first cut of this note said "about a
  millisecond" for both, which was measured against a writer and generalized.)*
  Only SQLITE_BUSY/LOCKED is swallowed: "file is not a database" arrives on the
  same statement, and `verify --rebuild`'s guard has to fail closed on it. One
  consequence not to be surprised by: `SQLITE_READONLY` now propagates out of a
  WRITER open on read-only media, where the old code opened and failed at the
  first write.
- A handle opened while the file was in DELETE mode keeps reading **and writing**
  correctly after another connection flips it to WAL. That is deploy day for the
  MCP server: no restart needed.
- A **read-only** connection cannot create the `-shm`, so a WAL database whose
  sidecars are BOTH missing is unreadable to one (`SQLITE_CANTOPEN`; with the
  `-wal` still there and only the `-shm` gone it succeeds — SQLite's read-only
  fallback). Every handle in this codebase is read-write — the dashboard's and
  the census's included — so the exposure is `tools/parallel/readers.ts` alone,
  and any ordinary open puts the sidecars back. **How often that state occurs is
  a property of the SQLite build, not of this code**: Apple's system SQLite
  enables persistent WAL, so on this machine the sidecars survive a clean close;
  stock SQLite removes them on the last one, which means on Linux or a packaged
  build a store nobody has open is in exactly this state. Deleting a `-wal` that
  has not been checkpointed takes the commits inside it too: the sidecars are
  part of the database, not litter.
- `close()` does not release the file to the PROCESS: a closed connection still
  holds the lock a WAL → DELETE conversion needs. It is why the tests build a
  DELETE-mode store with `VACUUM INTO` rather than a pragma, and why the sidecars
  outlive a close here where SQLite would normally remove them.
- **A database's size is `page_count * page_size`, not a file size.** The file
  alone under-reports (a cache mid-conversion read 1.8 MiB with 3.7 MB in the
  `-wal`, enough to print "nothing to do" over a real compaction debt). The file
  PLUS the `-wal` over-reports, and that was the first cut of `cli`'s
  `databaseBytes`: the `-wal` holds COPIES of pages the file already counts, so a
  fat one read as space a `VACUUM` would give back — 4,144,752 bytes of
  reclaimable on a cache with nothing to reclaim, over the floor that sends
  `migrate-cache --apply` into a pointless full VACUUM. What returns those bytes
  is a checkpoint, and a checkpoint happens on its own. The two pragmas are true
  wherever the pages are sitting and take no lock.

`counterparts verify` prints the mode and the timeout, and `counterparts doctor`
grades it — green in `wal`, amber otherwise with the reason and the way out — so
"is it on yet", and "did a conversion quietly not take", are both one command
rather than a `sqlite3` incantation. Amber is the only trace a swallowed refusal
leaves, deliberately: the alternative was an event row written from inside
`openDb`, which would mean a write at open on the path that exists to avoid one.

**Three things a WAL store cannot do that a DELETE store could.** None is a
reason to go back; all three are worth knowing before they are met.

1. **Read-only media.** With the sidecars absent and the directory not writable,
   an instrument open of a WAL store fails `SQLITE_READONLY_DIRECTORY` and a
   read-only one fails `SQLITE_CANTOPEN`; a DELETE store reads its rows in both.
   The copies the owner actually takes are safe: `counterparts backup` and
   `export` go through `VACUUM INTO`, whose output is always a plain DELETE-mode
   database, so a snapshot is readable anywhere, on any medium, by any build. It
   is the LIVE directory, copied as it stands onto read-only media, that refuses.
2. **The database file on its own is no longer the database.** *(Written as
   `operational.sqlite`, which is what it was called until the floor renamed it
   `counterparts.sqlite` two days later — owner ruling 5.)* A copy of the
   file alone opens read-write and is *silently short* by everything committed
   since the last checkpoint (it refuses `SQLITE_CANTOPEN` read-only, which is
   the honest half). The supported copies are `counterparts backup`, `export`,
   and a copy of the whole directory INCLUDING the sidecars. Deleting a `-wal`
   deletes the memories inside it — a store went from 20 rows to "no such table"
   that way in review.
3. **`sqlite3 "file:…?immutable=1"` now reads a short database.** `immutable=1`
   promises SQLite the file cannot change, and SQLite keeps its side by ignoring
   the `-wal` entirely — so the read returns the store as of the last checkpoint,
   with no error. Plain `sqlite3 -readonly "<path>"` reads the `-wal` and is
   correct. A fabricated number is what scar §2.4 is about, and this one arrives
   through a diagnostic recipe.

**Filesystems.** WAL needs real shared-memory `mmap` between processes, so a
network mount (NFS, SMB) is out: either the conversion is silently refused and
the store runs in DELETE forever, or the header takes and every later open fails
`SQLITE_IOERR_SHMOPEN`. A synced folder (iCloud, Dropbox) is an ordinary local
filesystem and works, but the sync client now has three files it must capture at
one instant and will not — a store in one is a worse idea after this than before
it. `counterparts doctor` reports the mode, which is where a silent refusal shows.


**The byte-identity suites keep their teeth.** Five of them hash a store
directory and mean "nothing wrote": the dashboard's, the probe's (scar E7),
`encode`'s gated chunk, the parallel run's input manifest, `verify`'s census.
Under WAL a commit lands in the `-wal` until a checkpoint moves it into the file,
so they hash the `-wal` WITH the database and skip only the `-shm`, which every
connection writes read-marks into (`isDatabaseSidecar`, `paths.ts`). All five are
green with the `-wal` in the hash — an instrument writes nothing there either.

## The walking read and `StoredMemory.confidential` (2026-09-18)

Consumers outside this module read prose by PATH —
`readProseFile(store.absolutePath(row.prose_path), id)` in `schemas/index.ts`,
`cli/commands.ts`, `dashboard/`. That is the last reason anything above the store
knows there is a filesystem under it, and the bodies-in-rows work cannot start
while it is true. Two additions took them off it, and both are about a gate.

**The walking read is an exemption, not a convenience.** `Store.read` fires
`store.archived.read` (contract §5 G13) and refuses a denied id. The walking
callers wanted neither, which is why they went round the store in the first
place. Both exemptions had to be kept exactly:

- *The event.* `Schemas.load` scans every schema row at every open, so routing it
  through `read` would file one archived-read per archived schema row per session
  and invert what the event means. It answers "did anyone look at archived
  CONTENT", and an index build is a look at the address.
- *The deny-list, which is the one that bit.* The first draft used `requireRow`,
  which refuses a denied id — and a `dark`-stage removal marks the id while
  leaving the row and the file until the chase. `Counterpart.open` then threw on
  every subsequent session (`test/dashboard.test.ts`, "a protected element
  removed since stops resolving", caught it). So the quiet read asks the
  deny-list nothing, exactly as the direct file reads did; the refusal belongs
  where the OWNER is answered — `read`, `resolve`, `readVersion` and the render
  seams. It is a hole either way, but it is now one hole with a name on it
  instead of five hand-rolled ones spread over two modules.

**And it is not on `Store`.** The first draft put it on `Store.prototype` beside
`read`. The adversarial review's objection was structural, not behavioural: no
live path was worse off, but `Counterpart.store` is public, so the method handed
every adapter and every future contributor a removal bypass they did not ask for,
and §4's "owner-initiated removal is unreachable from any model path" stopped
being true of the store's own surface. So it moved to `walk-seam.ts` — the
`chaseRemoved` pattern, a deliberate import from a pinned list of two files —
and the name carries the dangerous half rather than only the quiet one
(`readProseQuiet` → `readProseWalking`). The same review found the mitigating
fact that `Schemas.element` still refused a denied id only by *evaluation order*
(`physicsOf` happens to run after `statement` in the object literal), which is
luck; the follow-up that makes `schemas/` skip removed rows turns it into a
check.

It takes the caller's own `row` when the caller has one: every walk reads the
row's columns too, and a second lookup per id measured 54% of a 16,000-row walk
(650 ms → 990 ms on this machine). That is 3% with the row passed, and it matters
more once the body IS the row and the file read stops dominating. A row for the
wrong id is refused by name in the seam itself rather than relying on
`readProseFile`'s `expectId` check, which the bodies-in-rows work deletes.

**`StoredMemory.confidential` is the opposite move.** The confidentiality class
was a predicate over `doc.meta` that every caller re-derived
(`recall/activate.ts#isConfidential`). It is a gate, and a gate that parses JSON
at every call site is a gate that will one day fail open — so the truth table is
`confidentialByMeta` here, `read` carries the answer, and `isConfidential` is a
thin door for callers holding a bare `ProseDoc` (`dashboard/web/reveal.ts`,
`mcp/deliberate.ts`). It reads `meta` today and a column later; nothing above
notices. The table is odd in two places and both are preserved on purpose, with a
test per value: the class comparison is case-sensitive and untrimmed (`"OPEN"`
and `" open"` are confidential), and `confidential` is checked with `=== true`
(`1` and `"true"` are not).

## 2026-09-20 — the floor: the memory IS the row (schema v6)

*F5. Sections 1, 2 and 5 above described the floor this replaced and were deleted
by F8; 3, 6 and the 2026-09-05 self-contained note were rewritten in place, each
saying what it used to say. What follows is what this build learned, with the
measurements.*

**What moved.** `memories` gained `title`, `body`, `meta` and `confidential`;
`versions` gained `title`, `body`, `meta` and the two provenance dates; both
path columns are gone, and with them `prose/`, `versions/`, `tmp/`,
`stored.*`, the placement rules, the census and ~1,000 lines of code. `ProseDoc`
is unchanged, which is the seam that held: `physics/`, `recall/`, `associate/`,
`prospective/`, `encode/`, most of `sleep/` and all of S1's self page never
learned the floor moved, and S1's 78 tests passed on v6 without an edit.

**The refusal keys on FILENAMES, not on the schema version, and that was a
correction.** The first design read `meta.schemaVersion` out of the old database
and refused below 6. Two things are wrong with it. The rename to
`counterparts.sqlite` (ruling 5) means a v5 directory has no file at that path,
so `fresh` would have read true, `openOperational` would have MINTED a blank v6
store beside `operational.sqlite`, and the refusal would have arrived from
`assertLayout` — as `LAYOUT_UNCLASSIFIED`, after the damage, naming the wrong
thing. And since F1 the live store is in WAL: an open-and-close to read the
version can checkpoint and delete its `-wal`, so the act of asking would move the
bytes of the store the refusal exists to leave untouched. `PRE_ROWS_MARKERS` is
`operational.sqlite`, `prose`, `versions` — all three, because a store whose
database was moved by hand still holds every one of its words in files, and
minting a blank store on top of them would bury the only copy.

**`ADDED_COLUMNS` is empty, and that is the second lock.** `openOperational`
migrates anything below `SCHEMA_VERSION` by adding whatever is listed there. The
constructor's refusal makes a pre-rows store unreachable; the empty list is what
survives somebody relaxing the constructor. `test/store.test.ts` asserts both the
emptiness and that no entry may ever name a v6 column.

**`OBSERVER_READ_FLOOR` is the version itself.** v5 earned a floor below it
because its only change was a spelling every v5 reader resolved both ways. v6
cannot: a v6 instrument on a v5 store would report an EMPTY store rather than an
unreadable one, which is worse than refusing because it looks like an answer.

**The removal leaves its words in the store in TWO ways, and chases both.**

*The write-ahead log.* Measured 2026-09-20 on a store with 200 filler rows:
right after a chase the doomed text is in `counterparts.sqlite-wal`, and one
`wal_checkpoint(TRUNCATE)` clears it. Box 3 is in WAL too and holds the same
words as `doc_tokens` rows, so both databases are checkpointed.

*Freed pages, which is the harder one and which I got wrong first.* An earlier
version of this note said the checkpoint was sufficient and no VACUUM was
needed. **That was wrong**, and the third adversarial review caught it
(NEW-MAJOR-1). Blanking a body long enough to take OVERFLOW pages leaves whole
pages on the freelist still holding the words; `secure_delete` is 2 (FAST) by
default, which zeroes only the slack of a page being REWRITTEN, never a whole
freed page. My test passed because its marker sat at the START of the body —
the page holding the start of an overflow chain gets reused, the middle and the
end do not. With marks at the start, middle and end of a ~40 KB body the residue
is deterministic 5/5, in `counterparts.sqlite` itself, in a page no row points
at, while the report said `unchased: nothing`.

A second checkpoint does not help: the checkpoint is what MATERIALISES those
stale pages into the main file. `VACUUM` rebuilds the file from live pages
alone — and in WAL mode a VACUUM writes to the log, so it must be VACUUM **then**
checkpoint, which is why a VACUUM alone also reads as a no-op.

*Why VACUUM and not `secure_delete = ON` for the chase's connection*, which is
cheaper and was the obvious candidate: it measured clean on some shapes and left
the middle and end marks on others, because it only zeroes what THAT transaction
frees — a page freed by a revision months ago is not its business. VACUUM is the
one remedy that clears residue whatever freed the page and whenever, which is
what "removed means gone" has to mean. Cost, measured on a 17,000-memory store:
**VACUUM 23 ms** on a 9.3 MB box 2 and **58 ms** on a 16.6 MB box 3, checkpoint
under a millisecond. Removal is a rare, deliberate owner operation.

*What never carried it:* `backup` and `export` are `VACUUM INTO`, which copies
live pages only — measured clean even with the source in the residue state, and
the rotating snapshot takes the same route (`method: vacuum-into`), so no
snapshot ever inherited a removed memory's words. **Snapshots taken BEFORE a
removal are a different matter and contain the memory properly**; nothing here
reaches into them, and the removal report does not pretend to.

**`content_hash`'s preimage got weaker, and where it travels is: nowhere.**
Scar §2.20 says content-by-reference is only private if the reference cannot be
inverted, and a 16-hex SHA-256 prefix of a SHORT, LOW-ENTROPY body is guessable
— so the column is now a weaker reference than the whole-document hash it
replaced (review B, MINOR-2). It is acceptable because of where it goes, which
I traced rather than assumed:

- the removal record and the tombstone carry **no hash at all** (§16 G9), which
  is the one place a hash of a removed memory would matter;
- `dashboard/web/views.ts` blanks it for confidential rows, and `browse.ts`
  prints it beside the body the owner is already reading;
- `store.put`'s emitted `hash` field rides the store's in-memory ring, is
  relayed into `Counterpart`'s in-memory ring, and stops there: both are capped
  arrays, neither is persisted, and **`runOnce` is called with no `onEvent` in
  production** (`bin/runner.ts#main`) — the only caller that passes one is a
  test. It reaches no durable row and never leaves the machine.

Nothing joins on it either: `sleep/dedup.ts` hashes the body itself rather than
reading the column, and `remember/`'s content-idempotency ledger hashes
normalized content and never reads it. If it ever starts riding telemetry that
lands on disk, this is the note that says to look again.

**`content_hash` is `hashText(body)` now**, one definition across both tables,
where it used to address the whole serialized document. Two consequences worth
knowing: two memories differing only in title hash the SAME (which sharpened
`sleep/dedup.ts`'s test rather than weakening it — dedup pairs by the
interpretation, and the interpretation is what the hash now addresses), and a
title-only or meta-only revision no longer moves the hash. Nothing compares this
column to a hash computed elsewhere; `origin.spanHash` is the buffer's own hash
of a different string.

**`supersede` holds the words twice**, and `revise` holds them twice for as long
as the version lives: the head row keeps its body and the version row carries a
copy, where both used to point at one file. Bounded by the 90-day prune (ruling
1) — and the prune now deletes the owner's earlier words rather than a note
about a file that was never deleted. That is the ruling's real cost, and it is
made visible by a test on the self page rather than left as a sentence.

**Two columns the plan did not ask for.** `versions.learned_on` and
`versions.happened_on`. The plan's §1.1 listed `title`, `body`, `meta` and
`content_hash`; the CODE disagreed, because `revise({learnedOn})` travels the
same door as a body change precisely so a corrected date keeps its prior version
(`index.ts#revise`, and the comment there predates the floor). Taking the dates
from the LIVE row instead would have silently rewritten every version behind a
correction. A version doc takes `type` and `bornDay` from the head row, because
neither can be revised.

**The unreadable state has a name, and it needed one.** `body = ''` with
`content_hash = ''` is a TOMBSTONE — the owner's removal — and `body = ''` beside
a real hash is `MEMORY_BODY_MISSING`, a row whose words went missing underneath
the store. No write path produces the second: `put` and `revise` both refuse an
empty body (`revise` did not, and `patch.body ?? prior.body` accepted `""`
happily — fixed here). The pair is what lets `Schemas.load` skip a removed schema
row and keep the session alive (#139) while still standing the session down on a
store that lost a memory's words.

## 2026-09-21 — a store knows the day it was made (`store.created`)

**The finding it exists for is one directory over.** `doctor`'s Authorship line reports a
seven-day window, and on a store made that morning it printed `2026-09-15→2026-09-21` — a
week the store did not exist for (new-user findings #8). Nothing in the store knew its own
age: `livedDay` is the physics clock (the worker advances it, and it reads 0 on a store
whose worker has never run), `lastActiveDate` is empty until the first boundary, and
`store.started` is written only by `start-fresh`. So one meta row, `STORE_CREATED_KEY`.

**Written by the open that CREATED the file, and by nothing else.** The `fresh` flag the
constructor already computes (`!existsSync(paths.operational(dir))`), never under observer
— an instrument that minted this row would be writing at open, which is the rule the two
comments above it keep — and `INSERT OR IGNORE` on top of both, so a store that was already
there is never stamped with a day it did not begin on. That is the same rule `install`
keeps for `store.started`, and for the same reason: a falsehood on a surface the owner
reads and cannot unset from the console.

**The provenance clock**, `dateOf(this.nowFn())`, not an ambient `Date.now()` — so a seeded
test dates a store's beginning the way it dates everything else.

**Every store made before this is simply without it**, and every reader has to treat the
absence as UNKNOWN rather than as "today". `doctor` does: no evidence, no clamp, the
sentence it always printed.

## 2026-09-23 — `Store.schemaVersions()`: the stamps, asked again by a process that stayed open

`SCHEMA_AHEAD` is decided once, at open (`openOperational`), which is right for every
process that opens a store and closes it within one event. The MCP server is the one that
does not: the host keeps it for the whole session, and a hook on a newer build can migrate
the store under it. `schemaVersions()` is how it asks — `meta.schemaVersion` on box 2 and
`cache_meta.schemaVersion` on box 3, each as written (a string) or null, on the store's own
two connections. Two primary-key reads, prepared once, no transaction and no write, so it
behaves identically under observer; it may throw (a dropped table), and the caller decides
what that means. Outside a transaction each read sees what another process last committed,
WAL or not — which is the whole reason it works on a handle opened before the migration.
Measured at ~3 µs a call (`adapters/mcp/NOTES.md`, 2026-09-23). The rule that uses it —
every tool refuses when either stamp is ahead of the code — is the adapter's
(`adapters/mcp/CONTRACT.md` §5 G14); nothing here refuses.

It reads box 3's meta table from `index.ts` rather than through a `cache.ts` export on
purpose: that file had another owner in the same round, and a read-only query against a
table box 3 already publishes costs nothing to keep here.

**The write guard (`Store.guardWrites`, 2026-09-23, #187 re-review N5).** One slot: a check
`assertWritable` runs before every write this store makes — after the stance, before the
transaction — refusing by throwing, so a refused write stages nothing. The store decides
nothing with it; the MCP server installs the schema re-read there, because its deposits can
`await` an embedder between the tool's entry check and their writes. `null` removes it.

## 2026-09-23 — cache v5: the vectors carry their model's name (roadmap C1)

**Why now.** Two embedders exist (the paid Voyage seat and the local potion table), and
switching between them is an ordinary act — so "a vector's generation is part of its
identity" (`embed-client.ts` §2.15) had to become something box 3 enforces rather than
something a pinned config id hopes for. `cache_meta.embedder = <model>@<dim>` and
`embedderRebuild = inline|external`; the table's shape is unchanged.

**The rules, and why each is where it is** (`cache.ts#reconcileEmbedder`):

*(Rules as amended by the adversarial review — see "later" below for what changed.)*

- **At open only**, by a process with an identified embedder, never under observer. The
  steady state is a lock-free read (a match; or a paid seat of unknown width meeting an
  empty untagged table, which has nothing to decide); anything that writes re-reads and
  decides inside one IMMEDIATE transaction, so two processes opening at once agree.
- **Recorded rows a STATIC table's, another identity configured → drop and refill at
  open.** They cost nothing to recompute. The TAG goes down first, so a process that
  dies part-way leaves rows that all match their tag.
- **Recorded rows PAID → HELD, whatever is configured** — a second paid model or the
  static table alike. Dropping paid vectors is the owner's decision, never an open's.
  The hold is DURABLE (`cache_meta.embedderHeld`), so every handle on the file — the MCP
  server's, the dashboard's, the console's — neither writes vectors nor ranks against
  them. The ways out (`heldExits`): put the configuration back (released at the next
  open), or `counterparts verify --rebuild --drop-vectors --dir <store>`.
- **Legacy (untagged) rows**: a paid seat adopts them only when every row has the seat's
  KNOWN width (`EMBED_MODEL_DIMS`); a static table drops and refills them only when every
  row has the table's own width (they are a static table's rows whose tag was lost);
  anything else is held.
- **The v4→v5 migration keeps a tag it finds on a cache stamped below 5 when every row
  still has the tag's width**, and erases it otherwise (see mixed builds, below).
- **The tag follows the writes**: the first vector a process writes under a registered
  identity re-tags when `<model>@<dim>` differs from what it last saw (memoized per
  handle, so once per process). A paid seat's width is learned this way.
- `resetCache({ keepEmbeddings })` keeps the tag with the vectors (it used to drop
  `cache_meta` whole, which would have left untagged rows for the next static open to
  drop). The scan skips rows whose width differs from the query's: `cosine` reads a
  common prefix, so a 1,024-d query against a 256-d row used to produce a number.

**Held means no paid call can be wasted on it — where this change reaches.** The
worker's two jobs (`adapters/claude-code/vectors.ts`) read `embedderVerdict` first and do
nothing under `held` or `cache-ahead` (backfill reason `vectors-withdrawn`, the lag cue
`embed-failed` with `withdrawn` beside it). Two callers outside this change still ASK
the paid seat for a vector under a hold: the novelty seam at deposit (`counterpart.ts`'s
`vectors.vector`) and the MCP server's deliberate question (`server.ts#embedQuestion`).
Neither can USE it any more — the hold is durable, and the server's store now reconciles
with the configured identity (`mcp/index.ts#openServer`), so its `nearestTo` answers
nothing — but the call is paid for. Both are one-line checks of `store.embedderVerdict`,
filed for their owners.

**A cache from a newer build is left as found** (found by roadmap E while building the
every-call schema check): `openCache` used to stamp any version it did not recognize down
to its own. Now an ahead cache is returned for reading only — no DDL, no stamp, no
reconcile — the verdict is `cache-ahead` (event `cache.schema.ahead`), vectors are neither
written nor ranked, lexical reads and writes go on (its tables are the plain ones every
version has had), and `rebuildCache` refuses `SCHEMA_AHEAD`, box 2's code.

**The inline refill, measured** (bun 1.3.10, M3 Pro, potion-base-8M, ~1.2 KB bodies):
1,000 memories in 118 ms, 5,000 in 563 ms (~0.11 ms each: read, embed, insert, in
500-row transactions). `REFILL_BUDGET_MS = 1500` therefore covers ~13K memories at
open; a larger store is finished by the worker's backfill, whose static bound (1,000
per run, one `embedOne` commit each) measured 200–233 ms.

**This file's index.ts footprint**, named because the builder's brief listed only
`cache.ts`: `Embedder` became an interface with an optional `identity`; the constructor
runs the check and the refill; `nearestTo`/`neighbourVectors` answer nothing while held or
ahead; `embedderVerdict` is public. There was no way to check an identity "at open" from
`cache.ts` alone — the constructor is the open, and the refill needs box 2's rows.

### 2026-09-23, later — what the adversarial review of #190 changed

- **BLOCKER 1 — the open took box 3's write lock every time for a vectorless paid
  store.** A paid seat of unknown width has nothing to tag until its first vector, so the
  "fresh" arm wrote a `DELETE` inside `BEGIN IMMEDIATE` on every open — and waited, then
  threw `database is locked`, behind any other box-3 writer (measured 5,258 ms). That
  arm now returns from the read. Tested with a second connection holding the lock.
- **MAJOR 1 — the hold was per handle.** A store opened with no identity (the MCP
  server's shape) read `none` and ranked a new model's question against the old model's
  rows (measured: 3 hits). The hold is now a `cache_meta` row every open reads, and the
  MCP server's store is opened with the embedder's identity.
- **MAJOR 2 — a static configuration dropped paid vectors at open** (16,000 of them,
  measured, with only an in-process event to show for it). Recorded paid rows are now
  held whatever is configured, and every transition (reset, new hold, adoption, release)
  writes `store.embedder.reconciled` to box 2's event log from INSIDE the store — the
  hook's composition root passes no `onEvent`.
- **MINOR 3 — a new identity starts the skip list over**: `embed.failed.<id>` counters
  are not keyed by identity, so a reset clears them before the inline refill.

**Mixed builds** (MINOR 2). Any older build — a 0.2.0 process, an unrestarted MCP server,
a dev checkout — stamps box 3 back to v4 when it opens it. The next v5 open migrates it
up again and looks at the tag: if every row still has the tag's width, nothing foreign
was written and the tag is KEPT (no needless refill); if an older build wrote rows of
another width (it can only have written paid ones), the tag is erased and the rows are
judged as legacy — a static table refills rows of its own width and holds anything else,
a paid seat adopts only its own known width. So under mixed builds a static store at
worst refills (free), and a paid store at worst holds (never drops).

**Two policies for one condition, and which wins** (MINOR 7). #187 makes the MCP server
refuse EVERY tool while either box is ahead of its code; this change lets any other
handle on an ahead cache keep reading and writing the lexical tables (vectors off by
name). For the server, #187's policy takes precedence — its gate runs before any tool
touches the store — and the lexical-continue behaviour applies only to non-server
handles (hooks on a mixed install, the console, the dashboard). Both read "ahead" through
ONE predicate, `schemaAhead` (a plain integer above the code; `"6-beta"` is not ahead),
exported from here for #187 to import in place of its local copy.

**Release timing** (MINOR 7). If this and #187 ship in one release, the PREVIOUS
release's MCP server — still running in a session nobody restarted — has neither #187's
gate nor this change's width filter in `nearest`. A person who switched to the static
table during that session would have that server rank 1,024-wide Voyage questions
against 256-wide static rows by their common prefix until the session restarts. The
update notice (#187) is the remedy; it is named here because no code in this release can
reach a process that is already running the old one.

### 2026-09-23, re-review of #190 — the file is asked on every write and every ranking

- **MAJOR A — a long-lived handle wrote under an identity it checked only at launch.**
  Handing the MCP server's store the embedder (MAJOR 1's fix) let a session-long server
  file a 256-wide static vector under `voyage-3-large@1024` after a hook reset the store
  — the memory then "had" a vector, `missingVectors` skipped it, `nearest` skipped it by
  width, and it left semantic recall silently. Same-width pairs (potion vs a retrained
  table; full-width static-retrieval vs Voyage) ranked across two models outright. Now
  every vector write (`admitVector`, inside the write's own transaction) and every
  ranking (`Store.rankable` → `searchRefusal`) reads the file's claim — tag, hold, stamp:
  one primary-key read, #187's per-call pattern — and compares it with the handle's own
  identity. On a mismatch no vector is written (a revised memory's stale vector is
  deleted with it, so the owning identity's backfill fills it), nothing is ranked, and
  a `cache.vector.refused` event names the site and the reason (`held`, `cache-ahead`,
  `identity-changed`). A backfill does not count such a refusal against the item.
- **What an identity compares.** The model always; the width only for an inline table
  (a 256-wide slice of a 1,024-wide table is another space). A paid seat's width is its
  provider's, pinned by its model id: `EMBED_MODEL_DIMS` decides only whether untagged
  rows may be adopted, and the tag records what the vectors measured. A file a paid seat
  TAKES (fresh, or reset) is tagged with the model alone until its first vector, so a
  process still running under the old identity sees at once that the file is no longer
  its own.
- **The one write a fresh store needs can lose the lock** (NIT 1): a decision that meets
  another writer past the 5 s busy timeout now becomes `deferred` — nothing written, the
  embedder withdrawn for that open, a durable row, and the next open decides again. A
  lost lock costs the tag, never the open.
- **The drop-vectors exit writes a durable row** (NIT 2): `rebuildCache` records what a
  plain rebuild dropped and the hold it ended (`kind: "dropped", by: "rebuildCache"`), so
  all five transitions leave a row in box 2.
- **The exits a hold names are the ones that exist** (MINOR B; `heldExits`). Untagged
  rows (a 0.2.0 store opened under the static table) have no recorded model to go back
  to: the free exit is `embedder.kind` back to `"voyage"`, which adopts them at the seat's
  known width. A recorded model: put `models.embed` back to it. The drop
  (`verify --rebuild --drop-vectors`) is the other exit either way, and for a paid seat
  it is a paid re-embed of every memory.
- **The non-default `models.embed` upgrade case, stated** (MINOR B(2)). A 0.2.0 store
  whose owner hand-set `models.embed` to an id this package does not list
  (`voyage-context-3`, `voyage-law-2`, …) holds 1,024-wide untagged rows that NOTHING in
  this release will adopt: the seat's width is unknown, so adoption is refused, and the
  configuration already IS the model that wrote them, so "put it back" is not an exit.
  The only way out today re-pays for every embedding. `models.embed` is undocumented and
  `configObject` never writes it, so only a hand-edited configuration gets here. The
  fixes, not built: list the id in `EMBED_MODEL_DIMS`, or an explicit "adopt these rows"
  command for rows the owner vouches for (C3's `migrate-cache`). Re-loosening the width
  check is not one — a keyed 0.2.0 process can leave single-width untagged rows of a
  different model than the one configured now.
- **Residual (the re-review's NIT 3).** static-retrieval-mrl-en-v1 at FULL width is 1,024,
  the paid seat's width: a 0.2.0 process with a key writing Voyage rows into such a store
  keeps the static tag through the stamp-down (the widths agree). Reachable only through
  `COUNTERPARTS_STATIC_WEIGHTS_DIR` pointed at that table unsliced; the package ships
  potion (256). Named, not handled.

**Release note: 0.2.0 ignores `embedder.kind`.** A configuration that says
`{"enabled": true, "kind": "static"}`, read by any 0.2.0 process — an unrestarted MCP
server, a machine not yet upgraded — with a Voyage key saved, still embeds with Voyage:
memory text still goes to Voyage until every process runs this release. Whoever writes
the release notes for the static tier should say so.

**Owner decision, 2026-09-23 (night): the static tier is the PRIMARY embedder; the Voyage
seat is FROZEN — deprecated, not removed.** Its code stays, and so does everything in
this module that protects vectors it already paid for (the paid-rows hold, adoption at
its known width, `external` identities). No new Voyage behaviour is to be written; a
future finding that would need some is documented here instead.

**Two per-write checks, composed (after #187 merged).** #187's one-slot `guardWrites` —
the MCP server's schema re-read — runs in `assertWritable`, before any transaction, and
refuses the WHOLE write by throwing (`SCHEMA_AHEAD`, `refusedBy: "mcp-write-guard"`).
#190's identity check (`admitVector`) is not in that slot: it runs inside the vector's
own transaction in box 3, because it is the store's own cache and the check has to be
atomic with the vector it admits, and it refuses only the VECTOR (the words still land).
They never compete for the slot, and both fire in one server
(`static-wiring.test.ts` › "the two per-write checks compose…"). The server now imports
the store's single `schemaAhead` (re-exported from `server.ts` for its readers); its local
copy is gone.


## 2026-09-24 — the dashboard's reads, `ReadOnlyStore`, and the fold on close

Four things a redesigned dashboard needs from this module, built together (cli
INTERFACE-GAPS §10, §11, §13; dashboard INTERFACE-GAPS §4, §5).

**Newest first.** `eventLog` takes `order: "asc" | "desc"`, default `asc`, so none of
the ~30 existing callers moved. `{ name, order: "desc", limit: 1 }` is the newest row of
a name in one query. `doctor.ts#newestRows` still climbs its ladder; collapsing it is
doctor's owner's change.

**Counted by name, in SQL.** `eventCounts({ sinceDay?, sinceAt? })` is one `GROUP BY
name` over `events` (the `events_name` index covers it), returning each name's count
and its newest `at`, `day` and `seq`, sorted by name. A name with nothing in the window
is ABSENT, not zero. `eventNames()` is the distinct-name read. Neither reads a payload,
which is why `adapters/fired.ts` is not rewired: it windows rows by `payload.date` and
reads refusals out of payloads, so its tally is not a `GROUP BY` on any column. The
dashboard's per-name counts (activity vocabulary, health records) are, and now use it.

**`ReadOnlyStore`** = `Omit<Store, WriteMethod | "close" | "guardWrites">`. Defined by
SUBTRACTION, so the `WRITE_METHODS` totality test is what keeps it true: a new write
method drops out the day it is listed. `close` and `guardWrites` are out because they
are not a reader's to call (one ends a handle the reader does not own, the other can
remove the guard a composition root installed). It is a type, not a wrapper — a cast
gets round it; the stance is still what the seam refuses on. `DashboardSource.store`
is typed against it; to make that compile, two functions the dashboard hands its store
to were widened from `Store` (pure loosening): `adapters/fired.ts#firedReport` and
`core/self/identity.ts#findIdentityCore`. **Other candidates, not touched** — reader
functions still typed `Store` in `adapters/sessions.ts`, `adapters/snapshots.ts`,
`adapters/cli/export.ts`, `core/self/journal-file.ts`, `core/recall/*` (the read
halves), and doctor. Each is a one-word change when its owner wants the compile-time
guarantee.

**A writer's clean close folds the write-ahead log.** The cause #26 found: `openDb`
never finalizes a statement, so bun's `close()` defers the real close and skips
SQLite's last-connection checkpoint; the `-wal` stayed at its high-water size (1.38 MB
after 300 puts, measured again here) until some other process folded it. Fixed with an
explicit `PRAGMA wal_checkpoint(TRUNCATE)` in `Store.close()` (`db.ts#foldWal`) rather
than statement finalization: it is independent of driver and of statement lifecycle,
and finalization would have touched every call site in this module.

- **Only a box this handle WROTE** (`db.ts#wroteOn`: `total_changes()` on that
  connection). The first cut folded on every writable close and broke three dry-run
  suites' byte fingerprints: a writable handle that only read was moving the file's
  bytes by folding a log some other process left. That log is its writer's to fold.
  **This is a deviation from "a clean close checkpoints", taken on purpose.** Three
  consequences: `total_changes()` counts ROW changes only, so a schema-only write (an
  open that migrated or tagged and changed no row) does not fold, and its frames wait
  for the next writer's fold; it also counts rows a later ROLLBACK undid, so a handle
  that wrote and rolled back still folds (the pre-gate behaviour, harmless); and if the
  last writer to a store CRASHES, its log stays until the next handle that writes
  closes — the hooks write every turn, so in practice that is one turn.
- **Never under observer** — a checkpoint changes the canonical file's bytes, and the
  byte-identity suites hash file-plus-`-wal` around an instrument (§8).
- **Never waits.** RESTART/TRUNCATE run the busy handler while readers stand in the log,
  and this connection's is 5 s. Measured: with a reader holding a snapshot and the
  timeout left in place, `close()` took 5.3 s, and the same against a writer holding
  `BEGIN IMMEDIATE`. So the timeout goes to 0 for the checkpoint (the
  timeout is restored in a `finally`, so a caller that keeps using the handle has not
  lost I39's wait), and a contended fold degrades to
  PASSIVE: every frame the readers allow is copied, `busy: true` is reported, the log
  keeps its size, and the next writer's close finishes it. Nothing is lost.
- **Never throws.** Any throw is caught into `WalFold.error`; one
  `store.wal.checkpoint` ring event per folded box, emitted after both handles close so
  a listener cannot write a frame back into a log just folded.

**What it costs a hook turn** (measured, bun 1.3.10, macOS APFS, a 2,000-memory store,
open → put → appendEvent → close, median of 40): **~6 ms with the fold, ~0.7 ms
without** — the close itself ~3.8 ms (the checkpoint's writes and fsyncs under
`synchronous = FULL`), the rest the next open re-starting a truncated log. A turn that
only reads pays nothing (it folds nothing). If that ever matters on a slower disk, the
lever is a floor — fold only when the `-wal` is past some size — at the price of a
close that is no longer always a fold; not built.

**Not verified:** `node:sqlite`. `foldWal` and `wroteOn` use only `exec`/`get`, which
the adapter maps identically, and it typechecks; nobody has run it under Node.
`Store.close()` returns early on a second call, so neither handle is closed twice —
`node:sqlite` throws on a double close where `bun:sqlite` shrugs.

## 2026-09-24 — a copy before a schema migration

A writer open that finds box 2 on an older schema now copies the database before it
changes anything (`pre-migration.ts`, called from `openOperational`):

- **One process copies and migrates.** The migration transaction is `BEGIN IMMEDIATE`;
  the version is read again under that lock, and a process that finds it current does
  neither. The test holds the lock while three child processes queue on it.
- **The copy is `VACUUM INTO` on its own connection**, taken while the migrating
  connection holds the write lock and has written nothing, so it is the last committed
  state before the migration. Database only: the migration touches nothing else in the
  store.
- **Where:** the snapshots directory the daily copies use (`<base>/snapshots`, or
  `snapshotsDir` / the host's `snapshots.dir` — the hook, the worker, the MCP server and
  the console's `openCounterpart` all pass it), named
  `<instant>-pre-migration-v<from>-to-v<to>` by the wall clock (an injected or replayed
  clock once named a copy that collided with its own earlier one). A store outside
  `<base>/store` with no directory named refuses to migrate rather than go without a copy.
- **One copy per upgrade, not per attempt.** A migration that fails AFTER its copy (a
  commit that loses its lock, a bad trigger) would otherwise take a new full copy at every
  open. So an open reuses a copy already there for the same from→to when it was taken
  today (UTC), or when neither the live file nor its `-wal` has been written since the
  copy's instant. The cost: rows an older build writes between the copy and the upgrade
  that finally lands are not in the copy.
- **If the copy fails, nothing migrates**: the transaction rolls back and the open
  throws `MIGRATION_SNAPSHOT_FAILED`, whose `remedy` says why; the store stays on the
  old version and the build that wrote it still opens it. An abandoned `.partial-…`
  is left for the daily sweep (the store deletes nothing).
- **Observers never get here** — they refuse an old store `STORE_UNINITIALIZED` first.
  So doctor asks separately: it reads the stamp, and when the store is behind it
  dry-runs the copy's preconditions (the destination passes the same checks, and a probe
  directory can be made there and removed) and grades Store open amber (the next session
  upgrades it) or red (every hook will refuse), instead of reading green or failing.
- **Box 3 is not copied.** It is declared rebuildable, is outside the backup set, and
  its vectors are recomputed for free by the static tier.
- **Rotation** keeps these apart from `keep`: one is removed only when it is at least
  14 days old (`PRE_MIGRATION_KEEP_DAYS`) and `keep` newer daily copies exist. Doctor's
  Snapshot line names the newest.

**What it costs to hold the lock.** The copy runs while this connection holds the write
lock, so every other opener waits on it. Measured in review: ~1.3 s for a 200 MB database
with a 418 MB `-wal`. Past roughly 1 GB the copy can outlast `BUSY_TIMEOUT_MS` (5 s); the
openers that lose then get "database is locked", which the hooks stand down on as
transient, and the next turn opens the upgraded store. No code change for that.

The store deletes nothing, so a copy that fails (a full disk) leaves its `.partial-…`
directory, possibly empty, for the daily sweep to remove once it is stale.

**To roll a migration back:** stop every session, move the store's
`counterparts.sqlite` (and its `-wal`/`-shm`) aside, and move `cache/` aside too — it
rebuilds, and a cache the newer build stamped would make the old MCP server refuse every
tool. Copy the pre-migration copy's `counterparts.sqlite` into the store directory and run
the build that matches its `v<from>` (the newer build would migrate it again). Rows
written since the upgrade are lost; they are not in the copy.

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

**The mechanism.** One environment variable, one new error code. With
`COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`, `dataDir()` throws `IMPLICIT_DEFAULT_DIR_REFUSED`
instead of returning the fallback, with `{ guard, dir, remedy }` in the detail so the
message names all three without any caller composing it. Only the exact value `1` arms
it. Every door the store has funnels through that one function — `Store.open`,
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
hook's entry point already turns any rejection into `[counterparts] hook stood down:
<message>` with exit 0, and the message names the code, the dir and the remedy
(`test/config-rule.test.ts`, "guarded-storeless"). The worker's handler exits 0 silently
and the server's exits 1 silently — the shape those two already have for EVERY open
failure (`DATA_DIR_FORBIDDEN`, `STORE_UNINITIALIZED`), spawned detached with stdio ignored
in the worker's case. Not widened here: making two entry points print on every rejection
is a separate decision about their failure legibility, not part of this guard.

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

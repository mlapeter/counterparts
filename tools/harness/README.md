# tools/harness: the simulation harness (dev-only)

A second host for Counterparts: it feeds a stream of lived days into a fresh temp store and
measures what the memory physics makes of them. It's never shipped: `package.json#files`
publishes `src/` and `tools/install-loop/` only. It imports only the package's public seams
(`test/harness-imports.test.ts`), so it also checks that those seams are enough to build a host on.

Step 1 of the 2026-10-20 plan (lane 1) is **physics-only replay**. Steps 2–4 (the seat
interface, a model in the seat, a scripted new owner) build on it.

## Run it

```sh
# Copy a snapshot out of ~/.counterparts first. The harness refuses anything under it.
mkdir -p ~/counterparts-backups/<date>-corpus
cp ~/.counterparts/snapshots/<snapshot>/counterparts.sqlite ~/counterparts-backups/<date>-corpus/

bun tools/harness/cli.ts replay --source ~/counterparts-backups/<date>-corpus/counterparts.sqlite
#   --returns derived|recorded   derive awake returns from the uses (default), or pin the recorded ones
#   --through-day N              stop after lived day N (skips the fidelity block)
#   --early-days N               how many days the early-core table covers (default 10)
#   --keep                       keep the replayed store and print where it is
#   --json <file>                write the whole run record
```

On a 29-day, 2,000-memory record a run takes about 15 seconds.

## What it does

The harness starts from day 0 with an empty store. For each lived day, in the order live had
it, it first runs the boundary: `sessionEnd({date})` with the sweep skipped by name, as the night
worker does. If a phase reports its budget spent, it runs the boundary again on the same date,
as live's many daily boundaries did. Then it lands that day's recorded acts.

| Act | Read from | Applied with |
|---|---|---|
| birth | `memories` (first version's body where one was kept) | `store.put` under its own id |
| about-mark | `core_events` `about` | `store.setAbout` |
| feeling | `feelings` on `recorded_day` | `store.addFeelings` |
| use | `recall.credit` (expanded, quoted, drewOn), `recall.rated` | `store.reinforce` |
| night return | `returns` sourced `dream` / `reflection` | `replayReturn` / `reflectReturn` |
| settle | `contradictions` settled + `contradiction_settles` actor | `settleContradiction` |
| merge | memories archived `dream-merge`, on the version's day | `store.archive` |

Bands, awake returns, promotions, decay and prunes are **outputs**. The run record compares
them against the record: per-memory uses, awake returns by id and day, promotions, archives,
and the band census.

## What it leaves out, and says so

- Episodes, places, and the episodes' chapter copies. Their lifecycle (regrow, clear) is the
  adapter's night, not physics.
- Credit paths that write no event row: recall surfacing, schemas mentions, and the self page
  citing a memory. The per-memory use diff shows how much they carried.
- Salience as it was at birth. The row holds today's values, which a dream may have revised.
- What was shown per turn and how many candidates it was shown against. The record doesn't
  keep it, so a "return weighted by the pool" test needs the model-in-seat mode, or a store
  change batched with wave 2.
- Rules that changed mid-record. The replay applies *today's* rules to the recorded acts.
  Where the record's outputs differ, that difference is partly the rule change itself (for
  example, ratings counting as use since 0.3.27).

## Safety

- The source is opened read-only, and the harness refuses any path under `~/.counterparts`.
- The target is always a fresh `mkdtemp` and is removed unless `--keep` is set. The harness
  refuses to run if `COUNTERPARTS_DATA_DIR` is set.
- The run record holds ids, counts and days. It never holds a body, a title, or a feeling's
  words.
- Events prune after 90 lived days. Keep a corpus copy aside before the record you want
  ages out. The record's header says if the source's event log starts later than day 0.

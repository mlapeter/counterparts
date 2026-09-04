# `recall-bench` — what would ambient recall have delivered?

A hand-run scoring bench. It replays real prompts through `Recall.build()` against a
**copy** of a real store and prints, per prompt, what came back and whether it was the
thing the person actually wanted.

It exists because scar §2.8 says no recall threshold ships unmeasured against the real
space, and because the failure it was built for is invisible to a fixture corpus: on
2026-09-04, ambient recall returned the same nine 9–20 KB memories for every topic across
two unrelated sessions, and the instance that lived the conversation judged 0 of 9
relevant.

## Running it

```sh
# 1. copy the store. The tool REFUSES to open a live one.
cp -R ~/.counterparts/store /tmp/store-copy

# 2. one configuration
bun tools/recall-bench/bin/bench.ts \
  --store-dir /tmp/store-copy \
  --input /tmp/recall-bench-input.json \
  --b 0.75 --k1 1 --cap 3

# 3. or the whole grid, written to a directory
bun tools/recall-bench/bin/bench.ts \
  --store-dir /tmp/store-copy --input /tmp/recall-bench-input.json \
  --sweep --out /tmp/bench-out
```

`--b 0 --k1 1 --cap inf` reproduces the pre-2026-09-04 scorer exactly (`2·tf/(tf+1)` is
BM25 at `b = 0, k1 = 1`), which is how a "before" column is produced without checking out
an old revision.

`bin/migrate-timing.ts --cache <copy of cache.sqlite>` times the box-3 v2→v3 migration and
asserts the embeddings survived it.

## What it will not do

- **Open a live store.** `--store-dir` is required, has no default, and anything inside
  `~/.counterparts`, `~/.bansai` or `~/.claude-engram` is refused by name. `tools/parallel`
  defaults to the live paths and reads them; this one does not get that latitude, because
  it opens the store read-write to score.
- **Write anything durable.** `Recall.build()` is the only core entry point it calls, and
  build writes nothing by contract (§5 G3): no gate state, no telemetry, no credit. Only
  `--out` is written.
- **Measure the semantic channel.** The store is opened with no embedder and no turn
  vector is supplied, so these are lexical-channel numbers. That is today's live condition
  rather than a simplification — authored memories carry no embeddings yet — and it should
  be said out loud next to any table this prints.

## Reading the output

Per prompt: the decision `reason` (`rendered` / `all-gated` / `no-candidates`), candidates
scored, documents that hit the per-document ceiling, the delivered ids with their tiers,
which of them are known hubs, and which labeled `should_surface` ids came back.

A labeled id that is **not in the store** is counted as `absent`, never as a miss — several
of the real labels name memories minted after the session they label, and scoring those as
misses would punish the label file for being honest.

Each query runs under a fresh session id, so per-session dedup never fires. That isolates
the scorer and is deliberately stricter than the live run, where the nine hubs were spent
once and then left 12 of 19 turns with nothing to say.

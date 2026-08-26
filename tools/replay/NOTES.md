# `tools/replay/` — NOTES

Implementation choices the CONTRACT left open, and the assumptions this build
makes. Written to be argued with.

## 1. The assumed v1 corpus shapes (the biggest assumption in the harness)

The real corpus is not in this repo and was deliberately not read while building
this: `docs/harvest/replay-baselines.md` §2 records *where* v1's spans, logs and
index live and *how many* of each there are, not their byte shape. So the reader
assumes the following, and **counts every time it has to guess**:

```
<corpus>/buffer-archive/<YYYY-MM-DD>/<anything>.jsonl   one JSON span per line
<corpus>/buffer-archive/<YYYY-MM-DD>/<anything>.json    an array, {spans:[…]}, or one span
<corpus>/logs/events-<YYYY-MM-DD>.jsonl                 one JSON event per line
<corpus>/index.sqlite  (or cache.sqlite)                table `embeddings(node_id, model)`
```

A **span** is any object carrying non-empty `text` (or `body`/`content`) and a
`session` (or `sessionId`/`session_id`). `scope` falls back to `project` then to
`"global"`. `kind` is honoured when it is one of `conversation` / `assistant` /
`jot`; otherwise it is inferred from `role`, and that inference is counted in
`CorpusSummary.assumedKind`. An **event** is any object with `event` / `name` /
`type`; a nested `data` object is flattened over the top-level fields, because
both spellings appear in v1's own docs.

Everything the reader cannot use is a counter, never a silent drop:
`malformedSpans`, `unrecognizedSpanFiles`, `assumedKind`, `malformedEventLines`.
**The rendered report prints all four on the "format drift" line**, so the first
run against the real corpus shows shape drift as a number rather than as a stack
trace or, worse, as a quietly short replay.

If the real shapes differ, the fix is in `parseSpan` / `parseEvent` /
`recordsOf` in `corpus.ts` and nowhere else.

## 2. Driver decisions

- **One span is one turn.** v1 spans carry a `from`/`to` cursor range that can
  cover several turns; the harness does not synthesize the turns it cannot see.
  Role comes from the span kind (`assistant` → assistant, everything else →
  user), and a `jot` span goes through `captureJot`, not `captureSpans`.
- **Which path is replayed.** `capture → boundary → sessionEnd({sweep})`, which
  is the crash-fallback composition. v1's spans were interpreted by a sweep, so
  the sweep is the path with a v1 counterpart. v2's primary path — the
  experiencer writing its own memories — has none, and can only be measured
  forward (CONTRACT §7 OQ2). This is why the parallel run is more load-bearing
  than the replay, not less.
- **Guarantee 6, honoured literally.** Every call is a `Counterpart` method in
  the order a host makes them. Nothing reaches past the composition root to
  thread state a production caller never has — that is exactly how v1 ended up
  with four dark behaviours that were tested and inert.
- **The replay store is NOT an observer.** Guarantee 3 is about the stores the
  harness *reads*, which the corpus reader satisfies structurally by having no
  write path. Under observer, `sweep()` stands down and `gateSweepChunk` moves
  nothing, so an observer brain would replay precisely nothing. The metric
  `observer.standdownCount` grades this: any stand-down in the replay store means
  the driver silently replayed less than it claimed.
- **The clock.** `sessionEnd({date})` advances the lived-day clock inside the
  cycle, so the driver never calls `advanceClock` itself. Days are replayed in
  ascending order, which is also what keeps the store's backwards-clock refusal
  from firing. A calendar gap in the corpus (the fixture has one) costs no lived
  days — scar E8's whole point.
- **Chunk correlation.** A chunk's outcome comes back on the `SweepReport`; the
  gate's verdict for the same chunk arrives as a relayed event. `sweepAll` runs
  scopes sequentially in sorted order and awaits each, so the two are zipped by
  position rather than by a correlation id nobody emits. A chunk that never
  reached the gate (`TRUNCATED`, `THREW`) gets zeros and its reason, never a
  neighbour's numbers.

## 3. Determinism

The same corpus twice must render the same report, and a test asserts it. The
sources of drift, and what each is bound to:

| source | binding |
|---|---|
| span order | reader sorts by `(at, session, from, file, text)` |
| scope order | `SpanBuffer.scopes()` is sorted |
| day order | `Corpus.days()` is sorted |
| wall clock | `now` is injectable; the run record's `at` uses it |
| run id | derived from the corpus digest, not random |
| generated ids | never printed — the report is counts, rates and verdicts |
| map iteration | every rendered map is sorted before printing |

The store directory is a fresh `mkdtemp` per run and is deliberately *not* in
the report: a path is not evidence.

## 4. The decay three-way

`decay-shapes.ts` calls the real `physics.strength(m, d, shape)` rather than
re-implementing three curves. The independent-scorer rule (guarantee 5) scopes to
criteria the harness **grades**; this comparison grades nothing and has no bar.
Its job is to say what the system *would do* under each curve, which makes the
system's own arithmetic — `stability()`, the per-kind `kappa`, the identity-band
exemption — the only correct source. A hand-rolled curve here would drift from
the shipped one and hand the owner wrong evidence for a real decision.

**The comparison runs twice: at the last replayed lived day, and projected 90
lived days forward.** A replay mints everything "today", so at the final lived
day the elapsed interval is ~0 and all three curves coincide to the fourth
decimal — exactly where the evidence is worthless. The projection is where the
Ebbinghaus ordering shows (on the fixture: flat 0.000000, exponential 0.022063,
power-law 0.029993), and it is the block the owner reads. `decayHorizonDays: 0`
turns it off.

`distinguishable: false` is a first-class result: on a corpus of freshly-used
memories all three curves sit at 1.0, and the report says the corpus cannot
decide OQ1 rather than implying the shapes agree.

## 5. Ranges, not numbers

Every gradable metric carries a RANGE. The reason is `replay-baselines.md` §1.3:
the same blind rate reads 17.05% over the full instrumented window and 24.71%
over the sub-window behind the standing "22%", on 4–45 events a day swinging
0–78%. Both are honest. A gate naming a precise percentage would be measuring
noise. §17.3's own bound is adopted rather than re-derived: ingestion is
nondeterministic, equivalent code scored 63–75% across runs of one benchmark, and
per-category moves of ±0.1 are noise.

The bars themselves are **v1's calibration, not v2's law** (guarantee 10). The
discipline — commit the bar before the mechanism is allowed on — is what travels.

## 6. What a real run needs that a fixture run does not

1. A corpus snapshot at `~/counterparts-replay-corpus/` — extracted before v1's
   rolling 30-day window prunes it (CONTRACT §7 OQ1; every deferred day is a day
   of input-for-input depth lost permanently).
2. A real `InterpretFn` — streaming, token headroom, a `stop_reason` check and
   detachment all belong to the injector (scars E2/E3/E4).
3. A decision on the vector generation: `voyage-3-large` (13,664 rows) or the
   legacy `voyage-3.5` (9,600). The harness records the pin; it does not yet
   *use* the vectors (INTERFACE-GAPS §4).
4. The acting seat, named. `deterministic-fake` is the honest name in tests.

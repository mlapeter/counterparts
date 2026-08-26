# `tools/replay/` — NOTES

Implementation choices the CONTRACT left open, and the assumptions this build
makes. Written to be argued with.

## 1. The v1 corpus shapes — assumed, then corrected on first contact

The reader was built without reading the real corpus:
`docs/harvest/replay-baselines.md` §2 records *where* v1's spans, logs and index
live and *how many* of each there are, not their byte shape. So it accepted a
documented shape plus the obvious near-misses and **counted every time it had to
guess**. First contact (2026-08-25, numbers only, read-only) graded that bet:

| surface | result |
|---|---|
| events | 65,499 lines, 0 malformed, 51 distinct names — the assumption held |
| index | both embedding generations at the inventoried counts; write probe refused |
| spans | 798 files, **0 parsed**, 870 malformed lines — a total miss |

The miss was one field. A v1 span's content lives in `spanText`, which the
near-miss list (`text` / `body` / `content`) did not carry, so every line failed
the "looks like a span" test. **The v1 shape is now PRIMARY**, taken from v1's
own writer (`~/bansai/src/encode/buffer.ts`, `interface Span` — read as a donor,
never imported):

```
<corpus>/buffer-archive/<YYYY-MM-DD>/<safeScope>.<epochms>.<pid>.<seq>.jsonl
        { ts: ISO string, sessionId, spanText, project, hash }   one per line
<corpus>/logs/events-<YYYY-MM-DD>.jsonl                 one JSON event per line
<corpus>/index.sqlite | index-snapshot.sqlite | cache.sqlite
                                          table `embeddings(node_id, model)`
```

Mapping: `spanText`→`text`, `sessionId`→`session`, `project`→`scope` (v1 spells
it `global` or `project:<hash>`; the filename is the same string with the colon
replaced), `ts`→`at` by `Date.parse`, and `hash` trusted when present or derived
with `contentAddress()` when absent — exactly what v1's own reader does.
`index-snapshot.sqlite` is listed because the preserved snapshot uses that name;
a symlink at the filesystem level must not be load-bearing for a run record.

**`kind` is structurally absent from a v1 span** and reads as `conversation`: a
span is a raw conversation *slice*, not a turn. That is the shape, not drift, so
it does not touch `assumedKind` — a counter pinned at 100% on every real run is a
counter nobody reads (scar §2.4).

The previously-assumed shapes survive as fallbacks — a span is still any object
carrying non-empty `text`/`body`/`content` plus a `session`/`sessionId`/
`session_id`, with `kind` inferred from `role` — and taking one is now its own
counter, `assumedShape`. An **event** is unchanged: any object with `event` /
`name` / `type`, a nested `data` flattened over the top-level fields.

Everything the reader cannot use is a counter, never a silent drop:
`malformedSpans`, `unrecognizedSpanFiles`, `assumedKind`, `assumedShape`,
`malformedEventLines`. **The rendered report prints all five on the "format
drift" line**, so a run against the real corpus shows shape drift as a number
rather than as a stack trace or, worse, as a quietly short replay. Against a real
snapshot the expected reading is `assumedShape 0`; a large one means v1's writer
moved and `parseSpan` is a release behind.

If the real shapes differ again, the fix is in `parseSpan` / `parseEvent` /
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
  position — `SweepReport.chunks[]` still carries only an index, and an index
  restarts at 0 for every scope. A chunk that never reached the gate
  (`TRUNCATED`, `THREW`) gets zeros and its reason, never a neighbour's numbers.
  A `chunkKey` now EXISTS (the content address of the chunk's own span hashes,
  on both the relayed event and the durable `gate.chunk` row); the day
  `remember/` puts it on its chunk outcome, this zip becomes a lookup
  (INTERFACE-GAPS §1b).
- **The gate record is read back out of the store, not off the event ring.**
  `gate.refusalMix`, `preselect.meanSchemasShown` and `preselect.channelMix`
  count over `ReplayObservation.gateRecords`, which the driver builds by querying
  the replayed store's durable log. Same for `bandTransitions`. This is a
  deliberate constraint, not a convenience: a number that can only be derived
  from a live in-process event stream cannot be recomputed from the store a
  parallel run leaves behind, and the store is the only evidence that run makes.
  The symmetry VERDICT is the exception and comes off the `CycleReport` — it is
  arithmetic over those same durable rows, recomputed every cycle, so persisting
  it would create a second copy that can go stale.

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

### Decided by Mike, 2026-10-25, lightly held (ambient recall's meaning reads this turn)

- Decided by Mike on the 10-25 roadmap ("switch on"), lightly held: every ambient turn embeds its own prompt and
  ranks it in line (`recall.SEMANTIC_THIS_TURN`, on), instead of using the worker's lagged rank of the previous
  exchange when one is fresh. Why: the cue should match the turn. The replay (1,782 real turns, 10-18..10-25, a
  10-25 snapshot copy) was a wash on numbers: 16% of lagged turns differ by ~1.3 items, later-credited items lost
  10 and gained 8, ≤3-word prompts lost 1 credited of 28, +4–7 ms p50 a turn
  (`~/counterparts-notes/2026-10-25-0327-reread.md`, "Semantic lag A/B, gate cleared").
- Past the in-line count guard (`SEMANTIC_INLINE_MAX_VECTORS`) a fresh lag row is still used, recorded `lagged`,
  so the lag WRITER stays in the worker for now; retiring it is a later cleanup. The embed backfill beside it stays
  regardless.
- Ambient turns now rank on the `inline` calibration (`SEMANTIC_BY_IDENTITY`, potion: floor 0.15, weight 6),
  which was measured on deliberate questions, where the lagged profile had floor 0.05, weight 1. The replay's
  in-line arm ran on that profile, so its numbers include it.
- Check ~2026-11-01 (`docs/CHECK-AFTER.md`). Revert: `recall.SEMANTIC_THIS_TURN` false.

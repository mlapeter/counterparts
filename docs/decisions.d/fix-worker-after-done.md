### Decided by the W1 builder, 2026-10-30, lightly held (the per-turn worker's cost)

- Decided by the W1 builder, 2026-10-30, lightly held: concurrent workers don't collapse. Why: a
  later worker holds its session's lagged cue, which expires after one turn, and the sidebar file
  that includes the earlier worker's rows; the steps that mustn't run twice already have a lease, a
  claim or a latch. On 10-29, two or more ran at once for 120 s of the day, and at a third of the
  duration the same starts give about 26 s. 10-30 was already worse, on a partial day: 809 s, at most
  four, 655 s of it in one 20-minute stretch. The week's read decides (`docs/CHECK-AFTER.md`).
- Decided by the W1 builder, 2026-10-30, lightly held: the sidebar's file is still written after
  every boundary. Reading less was enough, so its freshness didn't need to be traded for time.
- Decided by the W1 builder, 2026-10-30, lightly held: one `runner.steps` row per run in the
  process log, rather than admitting `runner.coverage`, `runner.snapshot` and `runner.sidebar`. About
  400 bytes a turn. Delete the row from `LOGGED` once the question is settled.

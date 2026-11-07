### Decided by the FD1 step 2 builder, 2026-11-07, lightly held (growth exits; brief FD1, Mike's 11-07 ruling)

- Decided by the FD1 step 2 builder, 2026-11-07, lightly held: `recall.decision`,
  `recall.credit` and `recall.rated` keep 30 lived days (`store/operational.ts`
  `SHORT_RETENTION_DAYS`, `SHORT_RETENTION_NAMES`); every other unlatched event row keeps 90.
  Why: they are most of the log, and every reader on a turn or a night reads at most 14 lived
  days of them (habituation 14; doctor's lines 7; priming and the same-turn rating check the
  session; the dream since the last night). Before a day of them goes, its counts go into
  one latched `events.rolled` row. Undo: empty the list.
- Decided by the FD1 step 2 builder, 2026-11-07, lightly held: per-turn names not on the list
  yet (`adapter.recall`, `adapter.boundary`, `mcp.recall`, `associate.flush`) stay at 90.
  Doctor's boundary-age read takes `adapter.boundary` with no day bound, and the others'
  readers weren't all checked, so they wait for a check of their own.
- Decided by the FD1 step 2 builder, 2026-11-07, lightly held: the Growth lines are always
  green, and none is in the session-start reading. Why: a ratio isn't a fault (guards loose
  first), and the memories line walks every live row.

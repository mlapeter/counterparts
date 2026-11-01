### Decided by Mike, 2026-11-01, lightly held (habituation's window, 7 to 14 lived days)

- Decided by Mike, 2026-11-01, lightly held: `recall.HABITUATION_WINDOW_DAYS` is 14 (it was 7). Min sessions, the bar lift
  and the clear score stay, and the store doesn't change. Why: replaying 2,037 real turns (10-26..31) at 14 removed 260
  showings for 5 useful ones lost, and moved rated noise from 40.3% to 37.7%. The cost is about twice as many memories
  held down at once. These are estimates: the replay's control reproduced 66.5% of live footnotes. Undo: the same line
  back to 7. `docs/CHECK-AFTER.md` says how to read it again and what would change it.
- Decided by the H14 builder, 2026-11-01, lightly held, past the brief's "nothing else": `habituationRows` reads the
  window newest first with its own bound (`HABITUATION_ROWS_MAX`, 5,000). Why: it took `eventLog`'s default of 500 rows,
  oldest first, and the owner's store has 546 in 14 lived days. Left that way, the newest rows were dropped (a later 2
  didn't clear), and the note's `through` never matched the newest row, so every prompt read the rows. A store past the
  bound now loses the window's oldest rows instead of its newest.
- Decided by the H14 builder, 2026-11-01, lightly held: the note a 7-day build left is left to heal. It reads as current
  until the next rating row, so for that stretch a 14-day read sees only 7 days of rows, and memories rated 0 in the
  older 7 aren't held yet. The next rating row rebuilds it. Tested through `session_end`.

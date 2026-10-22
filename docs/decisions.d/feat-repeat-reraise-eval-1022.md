### Decided by the lane R builder, 2026-10-22, lightly held (the repeat / re-raise eval; brief R)

The measure is `src/adapters/cli/mechanisms.ts#settledReading`, read by `counterparts mechanisms` (seven
calendar days) and by the harness over a run's whole record (`tools/harness/settled.ts`). Where it departs
from the brief's plain reading, and why:

- The window is wall-clock (the console's seven calendar days in the store's zone: `events.at`,
  `contradictions.created_at`, `memories.created_at`, the standing settle's `at`), and "after the settle day"
  is by lived day. Why: the console's other lines count calendar days, and lived and calendar days are different
  columns.
- A repeat also counts an id a session named in `drewOn` that was refused (archived, superseded, not shown):
  the session said it drew on the old side, whatever the credit made of it. And a `recall.rated` score of 3 or
  `drewOn: true`, since a rating has been a use since 2026-10-19 (`dream/day.ts` reads it so).
- "A session write citing it": a memory a session wrote (`source = 'authored'`) whose meta cites the loser or
  is grounded in it (`fit/index.ts#derivedFrom`). An `updates` of the loser is not counted here: it makes a new
  pair naming the loser, which is a re-raise.
- A re-raise through the winner leaves out the winner being revised in turn (a newer pair where the winner is
  the side that loses: X, then Y, then Z). On the 10-22 copy every id-based hit (7 of 7) was that chain: merges,
  folds and new writes superseding the winner. A newer memory that says the old thing again is still caught,
  by the same-claim half.
- The same-claim half exists as a function: the reflection's bar (`BELIEF_SAME_CLAIM`, 0.9, token cosine as
  `remember/updates.ts#similarity`, tokenized once per text) with its negation test
  (`dream/reflect.ts#negationDiffers`, exported for this). A memory made from the loser (merge, gist, update)
  is not a restatement.
- Shown-only reads `recall.decision` loud lines and footnotes as well as `recall_turns.shown` (v14, empty on a
  store just migrated), plus ratings below 3 and `expanded` opens (`opened` in the JSON). An open is a look,
  not a use, by the brief's tiers.
- By build: event payloads and `memories.meta` say their own build; pairs and `recall_turns` rows join the
  build log on their lived day. A row with no build, or a lived day before the log, is `pre-stamp`.

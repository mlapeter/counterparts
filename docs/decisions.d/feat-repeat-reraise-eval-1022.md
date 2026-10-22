### Decided by the lane R builder, 2026-10-22, lightly held (the repeat / re-raise eval; brief R; review of #596)

The measure is `src/adapters/cli/mechanisms.ts#settledReading`, read by `counterparts mechanisms` (seven
calendar days) and by the harness over a run's whole record (`tools/harness/settled.ts`). The line:
"Settled things drawn on again: N of M pairs this week (changed a of b, corrected c of d — …); came up again R;
shown only S", a "beside it" line (the winner in a newer pair; changed ones drawn on without their winner in the
same row) and a split by build and kind. Where it departs from the brief's plain reading, and why:

- The window is wall-clock (the console's seven calendar days in the store's zone: `events.at`,
  `contradictions.created_at`, `memories.created_at`, the standing settle's `at`), and "after the settle day"
  is by lived day. Why: the console's other lines count calendar days, and lived and calendar days are different
  columns.
- Split by kind (review of #596). A `corrected` loser is archived: recall never shows it, a rating cannot reach
  it, and `drewOn` refuses it. Those pairs (21 in the 10-22 week, 24 in all) register only by a refused `drewOn`
  naming the id, a citation, a restatement or a newer pair, so a 0 on them is what the archive does, not proof of
  nothing drawn on. The line says so in its own words.
- Drawn on again also counts an id a session named in `drewOn` that was refused (archived, superseded, not
  shown): the session said it drew on the old side, whatever the credit made of it. And a `recall.rated` score of
  3 or `drewOn: true`, since a rating has been a use since 2026-10-19 (`dream/day.ts` reads it so). `alone` (changed
  pairs only): drawn on in a row — a credit, a rating, a write — that did not carry the winner too; the one that
  looks like a mistake rather than history.
- "A session write citing it": a memory a session wrote (`source = 'authored'`) whose meta cites the loser or
  is grounded in it (`fit/index.ts#derivedFrom`). An `updates` of the loser is not counted here: it makes a new
  pair naming the loser, which comes up again.
- Came up again is a newer pair naming the LOSER, or the loser said again. The winner in a newer pair is
  reported beside it (`viaWinner`), not in it (review of #596): the winner revised in turn (X, then Y, then Z) is
  not counted at all — on the 10-22 copy's week every id-based hit (7 of 7) was that chain — and the winner
  holding again over another memory is shown beside.
- The same-claim half exists as a function: the reflection's bar (`BELIEF_SAME_CLAIM`, 0.9, token cosine as
  `remember/updates.ts#similarity`, tokenized once per text) with its negation test
  (`dream/reflect.ts#negationDiffers`, exported for this). Not a restatement: a memory made from either side by
  its meta, or one at least as near the winner as the loser (review of #596: "Reminder: sync is on Tuesday"
  after Monday was settled to Tuesday read as Monday back).
- A flip-back — a later standing pair where the old loser holds over the old winner — ends the old pair from
  that moment; one flipped before the window is not counted (`flippedBack`). Through the owner's door
  (`settle --holds … --against …`) the store itself undoes the old settle and reorders the pair, so this only
  bites on a second pair kept the other way round.
- Shown-only reads `recall.decision` loud lines and footnotes as well as `recall_turns.shown` (v14, empty on a
  store just migrated), plus ratings below 3 and `expanded` opens (`opened` in the JSON). An open is a look, not a
  use, by the brief's tiers.
- By build: event payloads and `memories.meta` say their own build; pairs and `recall_turns` rows join the build
  log on their lived day. A row with no build, or a lived day before the log, is `pre-stamp`. Each build carries
  its exposure — its recall turns in the window and the lived days they fell on — in place of a pairs count per
  build (the pairs are one set for the window), and its own shown-only: what it showed and did not itself draw on.
- Not counted as pairs: 3 settled pairs on the 10-22 copy have no trail row of their own (`ctr_6f4449a83fdc`,
  `ctr_3570bee467e5`, `ctr_507776497134`, all `slot`). They were closed through another settle (`via`), so they
  name no winner or loser.
- In a physics-only replay the newer-pair half reads higher than live: the replay files each pair on its settle
  day, so a pair flagged before an earlier settle but settled after it (a slot flag, pressure) reads as a later
  flag there.

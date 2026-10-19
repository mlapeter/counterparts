### Decided by the coordinator, 2026-10-19, lightly held for Mike's review (meaning in line when no fresh cue is ready)

From the first-prompt recall diagnosis (`~/counterparts-notes/2026-10-19-first-prompt-recall-diagnosis.md`,
open questions 1, 2 and 6). Each is undone by reverting the PR; nothing is stored differently.

- **Stale turns are covered too, not only first prompts.** A turn whose lag row is from an
  earlier turn (`stale`) now embeds and ranks its own text in line, as a session's first
  prompt (`none`) does. Why: on the live store's records, stale turns were about 21% of all
  turns (3.5 times the first prompts) and showed the fewest items, and the code and the cost
  are the same. The worker's lagged cue is still used whenever it is fresh. Revisit if Mike
  wants first prompts only; it is one condition in `Counterpart#withSemantic`. Why the lag
  row is stale that often is not looked at here.
- **The in-line profile, not the lagged one.** The new in-line cue goes through the existing
  in-line path (`potion-base-8M@256`: floor 0.15, weight 6), because on these turns the
  vector is this turn's own question. The evidence is thin either way (5 bench questions).
- **This partly revises the 2026-09-04 owner ruling "do not embed on the hot path".** Its
  reasons were a network call and a 590-1040 ms scan; the embedder is a local table
  (~0.5 ms) since 0.3.0, and the scan measured ~18 ms cold at the live store's size. The
  prompt path still opens no socket.
- **The guard is a vector count (100,000), not a clock**, because the rank runs before the
  build's first time check, where an overrun would abort the turn. Past it the turn records
  `in-line-skipped` and the channel stays dark.
- **Facts mode treats "many", "much", "often", "typical", "typically", "usually" as asking
  nothing.** "How many" counted "many" as a content word (bench 2788b940: the Zumba schedule
  32nd of 76, 26th without it). Don't count the bench move as a win before the bench says so.

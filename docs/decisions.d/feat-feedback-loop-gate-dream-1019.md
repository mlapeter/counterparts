### Experiments started 2026-10-19 by the feedback-loop builder 2 (the echo skip, the dream's day replay, the night's own prompts)

From the feedback-loop brief (`~/counterparts-notes/2026-10-19-feedback-loop-brief.md`,
parts C, E and F; parts A, B and D are builder 1's PR). Each is an experiment, set to see an
effect, to be checked on ~10-22 (two lived days after install). Nothing is stored
differently; reverting the PR undoes all three, and each has its own smaller revert below.

- **C, the echo skip: trying it to see whether footnotes get less noisy without costing long
  sessions what compaction took away.** Ambient recall (footnotes, "came to mind", quiet
  pointers) skips memories whose `origin_session` is this session, since the conversation's
  last compaction when Claude Code's transcript has a `compact_boundary` line (#453's
  question: the hooks can tell, from the transcript), else the whole session; a named
  transcript that will not read skips nothing (fails open, `echoWindow: "unread"`). Checked once a
  memory has cleared the floor and its bar, so `echoSkipped` on the `recall.decision` row
  counts what would have been shown. Deliberate recall is untouched (only `recallForTurn` sets
  the echo set). Known gap: a memory a server wrote before it knew its session
  (`UNBOUND_SESSION`) can still echo. `echoSkipped` joins the surface set, so `tools/parallel`'s
  hash moves, as it did for `moodMatchedIds`. Revert by no longer setting `Turn.echo` in
  `Counterpart#recallForTurn`.
- **E, the dream replays the day: trying the day's own use as the replay signal, to see
  whether the night starts reinforcing what the day used rather than only what a model judges
  important.** `dream/day.ts` reads the stretch since the last dream's start from rows that
  already exist (`recall.credit`, `recall.rated`, waking `returns` by a denylist so builder
  1's graded credit is read as it lands, `recall.decision`). Marks: reward (`drewOn` or rated
  3), used, useful (rated 2), shown (not if rated 0). A queued memory's replay priority is
  multiplied by `1 + DAY_LIFT` (reward 3, used 2, useful 2, shown 0.5, set strong on purpose);
  up to `TODAY_COUNT` (20) used / useful / reward memories are listed as the bundle's `today`,
  and one already dreamed joins in the new role `today` (fit priority `TODAY_FIT` 3.5); pairs
  used together in one session are listed as `todayPairs` (at most 12) and the launch prompt
  asks the dream to replay both and link them if they belong. The dream still chooses; no
  automatic link is laid for a pair, because builder 1's co-use deposit already lands far
  above the replay's 0.05 and a proposal never adds. A night with nothing new still does not
  dream, so the day replay rides only on nights that have something new. Revert by setting
  `DAY_LIFT` to zeros and `TODAY_COUNT` to 0.
- **F, the night's own prompts: trying no ambient recall in the nightly run's children, to see
  night sessions drop out of the day's footnote numbers.** Finding: recall did run there. The
  children carry `COUNTERPARTS_NIGHT_RUN` (measured 10-12 to pass through `claude -p`), so
  `nightRun` was set, but `userPromptSubmit` only stood the cues down (#453); the launch prompt
  ran the full recall and its footnotes landed in the child's gate state. That is where the
  ~14 night sessions with `recall.credit` rows since 10-14 came from: every Stop writes a
  credit row, and the child's row counted those footnotes as shown. The row credited nothing:
  a night child captures no turns, so its cursor stays 0 and its own recall calls are never in
  a judged slice (a test pins this). Now the prompt gets the clock line only, reason
  `night-run`, and no `recall.decision` row. Since part E reads "shown" from decision rows,
  this keeps the night out of the day it replays. Revert by deleting the `nightRun` return in
  `hooks.ts#userPromptSubmit`.

What to look at on ~10-22 (for docs/CHECK-AFTER.md):

- C: `echoSkipped` per day and per session on `recall.decision` rows, and the `adapter.recall`
  row's `echoWindow` (`compaction` vs `session`, and `unread` when it stood down): how many showings a long session lost, and
  whether compacted sessions get their early memories back. Footnote ratings over the same
  days: does the noise share (47%) drop? A session that complains it was not reminded of
  something it wrote earlier is the cost to look for.
- E: the `dream.begun` rows' `today`, `todayReward`, `todayDreamed`, `todayPairs` and
  `freshMarked`; how many `today` memories the dream then replayed or linked (its
  `dream.changed` rows); whether used memories now get dream returns more often than before.
  Watch the night's room: if `today` crowds out new memories (`queue.waiting` rising), lower
  `TODAY_FIT` or `TODAY_COUNT`.
- F: night children's sessions should have no `recall.decision` rows after install, and their
  `recall.credit` rows should read `shownFootnotes: 0`.
- Not added to `counterparts mechanisms`: a new proof there needs the sidebar's copy changed
  in step (`sidebar-mechanism-drift.test.ts`), so the counts live on the rows above for now.

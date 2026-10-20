### An experiment, decided with Mike 2026-10-20, lightly held: the reflection closes open threads that are plainly done. Check on ~10-24

- **Trying**: the nightly reflection closes a stale open thread itself when a memory it
  read plainly shows the thing finished (`finish`'s `closeNow`, each with a why and,
  ideally, the memory that shows it), and says so in the morning share ("I closed two open
  threads that looked done: … If one isn't, say so and I'll reopen it."). It still asks
  about the ones it is unsure of (`close`, as since #489 D). The prompt says: close what is
  plainly done and say why, ask about the rest, when in doubt ask, never close one just
  because it is old.
- **Why**: threads opened in one session and finished in another orphan, so they pile up
  (58 open on Mike's store on 10-20, 12 untouched for 2+ weeks), and asking every time
  means a yes/no most mornings. On 10-20 Mike said yes to two obvious ones. Mike: "ok lets
  go ahead and do that".
- **Kept the same**: ids only from the night's `staleOpen` list (shown through recall's
  gates), `closeThread`'s protected and archived checks, at most `STALE_OPEN` (5) asked and
  closed together a night, nothing once the share was told or carried.
- **A lightly held exception to the 2026-10-02 night-run ruling, Mike, 2026-10-20 09:38:
  "i think its ok for nightly run to close threads from other folders".** The nightly
  run's server is not the owner's and is scoped to the launching session's folder
  (`night-run.ts#nightMcpConfig`, 10-02: "its write-ups close no thread opened elsewhere").
  For `closeNow` and its undo `reopen` alone, the folder check is not made: a stale thread
  the reflection was shown may be closed, and reopened, whatever folder wrote it. Night
  write-ups keep the 10-02 rule and still close no thread opened elsewhere; the `close`
  phase (the owner's yes) keeps its checks too.
- **Asked instead**: a confidential thread is never closed by the reflection, from any
  session, and neither is one the owner reopened. It is asked about instead, and a yes
  from his session closes it (`counts.closeAskedInstead`).
- **Undo**: the reflect tool's phase `reopen` with the thread's id alone (the reflection
  that closed it is the one the memory names), in any later session. After a
  reopen the memory carries `threadReopenedBy`, and no reflection closes it on its own
  again; it may only ask.
- **Check ~10-24**: how many it closed itself, whether any was wrong (reopened), and how
  the Still open count moves (`docs/CHECK-AFTER.md`).
- **Revert by** putting back the 10-16 `close` line in the reflection's instructions in
  `src/core/dream/reflect.ts` (the `closeNow` field can stay; nothing asks for it), if it closes
  things that weren't done or the count does not move.

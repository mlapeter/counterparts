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
- **Kept the same**: ids only from the night's `staleOpen` list, `closeThread`'s checks
  (protected, archived, and for a session not the owner's, confidential or another
  directory), at most `STALE_OPEN` (5) asked and closed together a night, nothing once the
  share was told or carried.
- **Asked instead**: the nightly run's server is not the owner's and is scoped to the
  launching session's folder (`night-run.ts#nightMcpConfig`, decided 2026-10-02), so it
  closes on its own only threads written in that folder. One from another folder (or one
  the owner reopened) is asked about instead, as before this change, and a yes from his
  session closes it. If the experiment should reach every folder, that stance is Mike's to
  change; it is not changed here.
- **Undo**: the reflect tool's phase `reopen` (reflection id + the ids it closed). After a
  reopen the memory carries `threadReopenedBy`, and no reflection closes it on its own
  again; it may only ask.
- **Check ~10-24**: how many it closed itself, whether any was wrong (reopened), and how
  the Still open count moves (`docs/CHECK-AFTER.md`).
- **Revert by** putting back the 10-16 `close` line in the reflection's instructions in
  `src/core/dream/reflect.ts` (the `closeNow` field can stay; nothing asks for it), if it closes
  things that weren't done or the count does not move.

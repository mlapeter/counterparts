### The shared "mcp" id goes line by line (coordinator's brief, 2026-11-01, marked for Mike's review)

- A sessionless `remember`'s raw copy is filed under the shared id `"mcp"`, and retention judged all of those as one
  session, so each new note restarted the clocks for the rest. With a note every 2 days, day 0's copy was still there on
  day 40. "Never more than 14 days" (README, doctor, onboarding) was false for it, and is now true of it.
- Each line is judged as a session of one, on its own time: 3 days when it owes nothing, 14 whatever it owes. A flat 14
  was the smaller change and left "3 days after it's written up" false for these notes.
- **Past the ceiling a line a write-up still owes goes unwritten.** That is the ceiling's price for any session; this
  bucket used to dodge it. It affects notes whose memory did not land, whose words are nowhere else.
- Not changed: a real session that keeps being appended to keeps all its lines while it moves. It is one conversation,
  and its write-up reads all of it. `src/core/remember/NOTES.md` has the rest.
- Still not covered by the promise: a pass runs once per date (up to a day over), and only when the worker runs, so a
  quiet hosted tenant waits for its next `wake` and a laptop for its next session. No sweep was built
  (`hosted/INTERFACE-GAPS.md`). Nothing a hosted person reads says 14.
- `counterparts note`'s shared `"console"` id goes the same way, through the same code (`SHARED_SESSIONS`, same day, on
  the same measurement: 11 of 11 lines kept at day 20). Only that id's write-up rewinds when its lines go.
- Undo: remove the `planUnboundLines` loop in `src/core/remember/retention.ts`; the bucket goes back to one session. To
  undo only the console's, take `CONSOLE_SESSION` out of `SHARED_SESSIONS` in `src/core/types.ts`. What already went
  doesn't come back.

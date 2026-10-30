### Decided by the NC1 builder, 2026-10-30, lightly held (the catch-up and a folder that is off; coordinator's brief, marked for Mike's review)

- Decided by the NC1 builder, 2026-10-30, lightly held: a session with words in an on folder and an
  off one is set aside whole, rather than writing up the on folder's share. Why: it is the hook's
  rule (a session whose folder is off goes quiet wherever it stands), and it is one test in one
  place. The cost: that session's on-folder words are not written up either. Since 2026-09-17 a
  session's words land under one directory, so it should be rare.
- Decided by the NC1 builder, 2026-10-30, lightly held: what is left out is not marked or touched,
  and retention is not changed. So its text stays on the owed clock, up to 14 days from its last
  activity, rather than the 3-day one. Why: a paused folder resumed has to be owed again, and a
  setting read at the moment of asking does that with nothing to undo. The cost: a folder set `off`
  for good keeps its already-captured text for those days. Shortening that for `off` alone would be
  a change in `core/`, and is Mike's call.
- Decided by the NC1 builder, 2026-10-30, lightly held: a setting file that will not read takes
  nothing, where the hook's direction is on. Why: a hook may not fail its host, and a night can wait;
  the two nearest writers (`lifecycle.ts#chapterExports`, the reflection's marks) already go this way.
  The file's trouble is said at every session start, and doctor, which has no line of its own for
  it, keeps counting the debts in that case, so they go overdue rather than reading "nothing owed".
- Decided by the NC1 builder, 2026-10-30, lightly held: the door gets no folder check of its own.
  Why: the plan decides what is granted and re-reads the setting each batch, and a refusal in the
  door would only change a folder turned off during one child's run. That child finishes. Guards
  loose-first; a door check is small if it ever matters.
- Decided by the NC1 builder, 2026-10-30, lightly held: `coverage.owed` and `coverage.lapsed` rows
  still fire for these sessions. They record what the ledger read, nothing reads them as a debt, and
  `core/coverage/` knows no folders.

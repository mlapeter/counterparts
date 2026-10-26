### Decided by the S2c builder, 2026-10-26, lightly held (doctor's Catch-up amber for check-in users)

- Decided by the S2c builder, 2026-10-26, lightly held: doctor's Catch-up line (and the
  Authorship line's count) is amber only for an OVERDUE debt (`doctor-write-ups.ts#overdue`):
  the newest catch-up row is from a later date than the stretch's latest piece, or
  `OVERDUE_DAYS_OF_USE` (2) days of use came after it with no catch-up run since. It was amber
  for any stretch from yesterday or earlier, which after S2 was every morning before the first
  prompt for a check-in user (H0 `checkins`: amber on 7 of 8 mornings, now 0). Dates, not
  minutes: the night is launched from the morning session's first prompt, and a second run the
  same day is not a chance at that day's sessions. Any catch-up counts as a chance, a bounded or
  failed one included (loose-first). The "finished here, waiting on another project" amber uses
  the same test. Revert: `overdue` back to `localDate(stretch.lastAt) < today`.
- Decided by the S2c builder, 2026-10-26: the lapsing count says what it counts, by reason
  (`sessions.ts#notPointableWhy`): "short headless runs (claude -p, the Agent SDK)" and "short
  sessions with no session record", "short" being small or under the floor. It said "small, not
  known as a person's session", wrong on both halves since the S2 review held headless runs to
  the floor small or not. `counterparts coverage` says the same: "(short, and headless or with no
  session record)".
- Also: the Catch-up fix line said a stretch "lapses after two more days of use"; it is
  `LAPSE_DAYS_OF_USE` (14) since 2026-10-10, and now reads it.

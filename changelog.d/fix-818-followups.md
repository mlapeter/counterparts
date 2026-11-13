- **A write-up's memories are read like any other `session_end`'s.** Sent as one object, as
  a JSON string of a list or as plain text, they're read as the list they are, where before
  the write-up refused them.
- **A date and time written without a time zone keeps its day.** "2026-11-14T03:00" in a
  reminder date or the date something happened is the 14th, whatever zone the server runs
  in; before, a server on UTC could file it a day early for someone west of it.

- **A write-up's memories are read like any other `session_end`'s.** Sent as one object, as
  a JSON string of a list or as plain text, they're read as the list they are, where before
  the write-up refused them. Text that starts like JSON but doesn't parse (a trailing comma,
  a list cut off) is refused so it can be sent again, on any `session_end`, instead of being
  kept as one memory of raw JSON.
- **A date and time written without a time zone keeps its day.** "2026-11-14T03:00" in a
  reminder date or the date something happened is the 14th, whatever zone the server runs
  in; before, a server in a different zone from yours could file it on the wrong day.

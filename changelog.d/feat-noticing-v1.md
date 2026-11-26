- **Claude Code: a short nudge to keep what you read or sent.** When a session reads letters, web pages or documents
  (a PDF or an EPUB), or sends a letter, and no `remember` follows, the end of that turn adds one line saying how many
  (never what or from whom) and pointing at `remember`. It is off for sessions nobody attends, under observer and in
  folders set off. Turn it off with `"noticing": {"enabled": false}` in the configuration; add your own shell
  commands with `"bashPatterns"` (reads) and `"bashOutgoing"` (sends). `counterparts mechanisms` shows how often it
  fired and how often a memory followed. The `remember` tool now says to keep a struck line word for word with who
  wrote it, and that a letter is about the person who wrote it.

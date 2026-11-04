- **A morning share no longer asks for a tool call to mark it told.** When last night's share
  reaches a session, handing it over marks it told, so a new person isn't shown a permission
  prompt for bookkeeping they have no context for. A session that still calls `reflect` with
  `told` gets a plain yes.
- **A memory about Counterparts' own refused calls stays out of your wake.** When a session
  writes down that a tool call was denied, that a permission prompt was declined, or what it
  couldn't do (a slash command, a tool it doesn't have), the memory is kept without a date, an
  open thread or a "me"/"us" mark, so it never leads Coming up or the folder's news. The
  person's own words about a prompt are kept as usual.

- **Day's end after skipped days writes about the last day you used it.** Day's end only ever looked at
  yesterday, so after a day or more away the last day before the gap never reached your page's Lately section.
  Now, when yesterday is empty, it looks back up to a week for the last day with memories that no night has
  written about yet. It never writes about a day twice and never works through a backlog.
- **The page's "ahead" lines are told to catch up.** The nightly writers are now told that a line about
  something ahead, once it has happened or passed, should be said as past or set down. Before, a page could
  keep "the wedding is ahead" after the wedding.
- **A host that sets the page's room tells the writers that room.** With `selfTunables.PAGE_ROOM_BYTES` set,
  day's end and the reflection were told the default 4,600 bytes and then sent back at the host's number. They
  are now told the host's number.

- **Every session can close what it finds, from any folder.** A thread or a reminder
  is closed by its id from whichever folder you are in, from any session: Claude Code,
  a Claude Desktop chat, the nightly run's write-ups, and the reflection's `close`. A
  protected memory is still never closed. Until now a session that was not "yours"
  (a Desktop chat, the night run) could not close something written in another folder.
- **"Last said here" in every session.** Any session that opens in a folder gets the
  wake's "Last said here" line and can recall "last exchange", a Desktop chat and the
  night run included. Under observer it is still not given.
- **No more "owner".** `status` no longer reports `owner`, `ownerFrom` or `ownerMeans`;
  doctor's Mode line just says "remembering" (or the observer line). `install` no
  longer writes `"owner": true`; an existing configuration's `owner` is ignored and
  named under doctor's "Old settings" (you may delete it). `COUNTERPARTS_OWNER` does
  nothing now, and the memory server's `--owner` flag is accepted and ignored for one
  release.

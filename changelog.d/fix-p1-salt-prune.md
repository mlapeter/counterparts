- **A store keeps its id after its first week.** The session-start cleanup removed the store's handle salt
  (`sessions/expansions.salt`) seven days after it was made, so the next session made a new one: the store's id
  changed (the sidebar compares it) and earlier handle lookups no longer matched. The salt is now kept however old
  it is. A store that already lost its salt has nothing to recover: the one it made since is kept from now on, and
  handle lookups only last a day anyway.

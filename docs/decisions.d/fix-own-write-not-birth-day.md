### Decided by Mike and the R2 builder, 2026-10-24, lightly held (credit refuses the writing session, not the birth day)

- Decided by Mike, 2026-10-24, lightly held (R2): use credit refuses the session that wrote the
  memory (`own-write`), not the memory's birth day. Why: v1 §10 G9's cause was the writing
  session's boundary seeing the new memory's words in its own reply; the ping/pong memory was
  used by two other sessions within minutes and kept `uses` 0. Unknown writer (no origin session,
  or a credit with no session) keeps the birth-day refusal. Switch: `physics.OWN_WRITE_GATE` (off:
  exactly as before).
- Decided by the R2 builder, 2026-10-24: the store decides `ownWrite` from the row (origin
  session, or the write-up's `writtenUpBy`), not each caller, since every credit path ends in
  `Store#reinforce`. A revision is its reviser's: the session that wrote the original may credit
  the revision, the revising session may not. `own-write` holds on any lived day, not only the
  birth day. A birth-day return stays refused `birth-day` for everyone (spacing measures from
  birth); only the use is credited.

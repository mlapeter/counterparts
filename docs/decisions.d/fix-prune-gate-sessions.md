### Decided by the prune-gate builder, 2026-11-03, lightly held (recall's gate rows get a live sweep)

- Decided by the prune-gate builder, 2026-11-03, lightly held: `Store#pruneGateSessions`
  runs inside the sleep cycle's `versions` phase, right after the version prune, on its
  marker and its window, not as a phase of its own. Why: the store's own doc said "beside
  the version prune", and a new phase would move the phase list every report and test
  enumerates. Its count rides its own event (`sleep.gate.pruned`), so the phase's numbers
  stay the versions'; a throw is caught and named (`sleep.gate.failed`) so it cannot fail
  the version prune that already committed.
- Decided by the prune-gate builder, 2026-11-03, lightly held: the window stays the
  store's `retentionDays` (90 lived days by default), with no second constant. Why: a
  session used inside it keeps every row the gate reads, and a shorter one would only
  reset older resumed sessions sooner; the typed words already leave on the 14-day clock.
  A store younger than 90 lived days (the owner's, started 2026-09-21) deletes nothing
  yet. A shorter window is the owner's call.
- Decided by the prune-gate builder, 2026-11-03, lightly held: the sweep stays per row
  (`last_day` past the cutoff), not per session. Why: the rows the gate reads are
  re-stamped at every save, so per row never takes a live session's dedup, and it also
  sweeps the rows a long session evicted past `MAX_SESSION_RECORDS`, which per session
  would keep while the session lives. The edges are in `recall/NOTES.md` §6.

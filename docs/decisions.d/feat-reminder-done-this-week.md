### Mike's go 2026-10-20, lightly held, an experiment (a weekly reminder done for this week; F6 and F6b)

- Mike's go 2026-10-20, lightly held, an experiment: `updates` at a REPEATING reminder with
  `status: "done"` and no `eventDate` closes only the occurrence open today — no footnote, no
  "Arriving:" line, and no plain line even if it had not been said yet — and the reminder keeps
  its date, its repeat and its standing; the next occurrence comes back as normal, and the
  answer says which date was closed and when it returns. Why: Mike's Tuesday backup reminder
  came back at 09:15 after he ran the backup at 08:40 and the session wrote a "backup ran"
  memory; the only close for one week was naming the id in `drewOn`, and the documented close
  (`eventDate: null`) ended the whole repeat. Ending the repeat is still `eventDate: null`, or
  `status: "done"` with `recurring: null`.
- Decided by the builder, lightly held: the declared revision does not run for that write (the
  link is the whole effect), so the reminder is not settled or faded under the "done" memory,
  and a core reminder takes no pressure. When nothing had delivered the occurrence yet, the
  close counts as its delivery (one use, as a footnote or a plain line would), so marking a week
  done early doesn't cost the reminder a use. Why: one week done must not cost a reminder its
  standing.
- Decided by the builder, lightly held: a one-off dated memory with `status: "done"` behaves as
  before (its date is spent, its chain closed, it settles under the done memory). Why: for a
  one-off, this time is the whole obligation.
- Decided by the builder, lightly held: a `done` at a memory holding a date passes the update
  guard without the relatedness read. Why: "backup ran" closes "back up every Tuesday" and
  shares few words with it; this applies to one-off dates too.
- Decided in review of #540, lightly held: a `done` closes the occurrence open that day, except
  in the next occurrence's lead days when the one before it is still unclosed (and inside its
  grace, and was owed): then it closes that late one. A weekly backup done on Saturday with
  Tuesday's never closed closes Tuesday's, and next Tuesday's comes back; with Tuesday's closed,
  it closes next Tuesday's. The answer names the date it closed. Why: a "done" said while one
  is overdue most likely means the overdue one, and closing the coming one would silence a
  backup nobody ran. "That day" is the writer's (the server's clock, or a write-up's own day).
- Decided by the builder, lightly held: a write with no `updates` that says `status: "done"` or
  `saidBy: "owner"`, landing beside a dated memory whose occurrence is due now (on or after its
  day, inside its window, not closed), gets `answers` with the way to close it. Offered, never
  closed. Why: the 08:40 memory was written fresh, without `updates`.
- Decided by the builder, lightly held (F6b): `drewOn` credits a memory superseded or faded under
  a newer one when that newer one was written by this session or born the same lived day — the
  stale memory itself, not the head, since the head was born today and is never credited on its
  birth day. The settle the session made still stands. Why: the stale memory is what made the
  session catch and fix the record. An archived one (a `corrected` settle archives) is still
  refused, and `rated` keeps the old rule.

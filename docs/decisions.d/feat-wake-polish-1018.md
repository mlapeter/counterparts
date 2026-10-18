### Decided by the wake-polish builder, 2026-10-18, lightly held (random-6c's 10-17 wake)

From random-6c's 10-17 feedback: fewer items with their words beats more items as counts or
ids. Each is undone by reverting the PR; nothing is stored differently.

- **"Still open" leads with what is live.** An open thread untouched (neither born nor used)
  for 14 lived days (`STILL_OPEN_STALE_DAYS`) now ranks after every one touched since; one
  that would show as "Unsettled — may be out of date" ranks after a plain one; person-scoped
  threads still come first among their peers; then the most recently touched first. Before,
  the order was person-scoped first, then oldest-opened first, so the weeks-old questions
  nobody closed led every wake. "Untouched" is read as #489 D's nightly close-offer reads it
  (born or used), at a different threshold: 14 lived days here, 4 there. The room is the same; only the
  order. The core memory being reconsidered still leads (one at a time, rotating); one that
  is also unsettled waits behind the plain ones, because its unsettled label replaces the
  "keep or retire it" words. The count line now says what it counts: `(57 more still open,
  12 untouched for 2+ weeks; recall ids …)`. No new nag or prompt.
- **A handoff's staleness is one sentence.** `2 days old; since then: a newer chapter here;
  written on 0.3.24, 0.3.25 now`, in place of "before 0.3.25 was installed, and a newer
  chapter here since; work here 09:58–20:32 since, written up to …, N pieces not yet". The
  release is said as what it was and what it is: a session that installed the
  new release and wrote its handoff before restarting was still on the old one, so
  "installed since" was not true of it. The work-since accounting is off the line; doctor
  and `counterparts coverage` still count it. A handoff that is fresh reads as before.
- **When every handoff listed is stale, one is shown.** The newest in full and the rest by
  id ("+3 older here: …"). The reserve is still sized for three, so a fresh morning keeps
  its room. The widest single pointer the reserve sizes to went from 503 to 428 bytes, but
  the 10-18 snapshot's wakes grew by 59–72 bytes, because an older stale handoff's sentence
  is longer than its old words.
- **Yesterday names folders, not a count.** "Yesterday: … ; and 2 sessions in ~/counterparts"
  in place of "and 2 more" / "3 sessions in other projects". Only a folder the "Today,
  elsewhere" line may name (its scope setting on, not this folder, not the store's own);
  the rest are not said at all, as that line does not say them. Never a title or an id
  past the About-me gate.

**Left open by the review (2026-10-18), not decided:**
- A core memory being reconsidered that is also unsettled never takes slot 1 while a plain one exists. That
  departs from the rotation #430's review asked for. Revisit if a reconsidered core item sits unanswered
  for more than a week.
- The Yesterday line's shorter forms keep the whole folder list, so under pressure the line drops whole
  instead of naming fewer folders.
- Already on master before this change: when the wake falls back to the bundle published at the last
  boundary, it can exceed a very small ceiling (1,234 B against 1,200 in a sweep). The default ceiling is
  9,000, so no real install is affected.

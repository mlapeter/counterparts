### Decided by ROADMAP, built by the WK1 builder, 2026-10-30, for Mike's review (the wake's room)

- "Might be relevant" is off the wake (`HINTS_IN_WAKE` false). Why: it showed on 4 of 29 days since
  10-02 and ambient recall does that job per turn, with ratings. Follows `CRAFT_IN_WAKE`: a switch,
  so turning it back on is one line. With it off, every publish closes the open `wake_display` rows,
  so a use is no longer refused a return as `on-display`.
- No wake line lists bare ids. A count names the door that lists its items by title (`still open`,
  which gains `comingUp`, and the new `handoffs here`). A lane with no such door is a count alone.
  An id after a title stays: that is its handle.
- A lane with nothing it can title still says its count and the door, rather than nothing. Why: the
  never-silent guarantee (2026-10-12). The brief allows "nothing"; say if silence is wanted.
- Coming up lists the 2 oldest overdue (`COMING_UP_OVERDUE_LISTED`), and they step back when they
  would cost "Still open" an item. Why: dated lines outrank the lane's items in the room, which was
  meant for what is due today, and "Still open" is to stay as it was while the open-threads read runs.
- The handoffs, "Last here" and "Last said here" are one block, grouped by session, the newest
  leading (`handoff/stands.ts`). An older entry is judged by session and time, never by text.
- On a tight day the newest mention outlives an older handoff. This reverses review of #300 MAJOR-1
  ("the handoff first") only where a chapter is newer than every handoff here, as the brief asks;
  the door still counts them.
- The newest handoff's lead is up to 5 lines (`HANDOFF_LEAD_LINES`), each other live handoff one line
  (Mike's markup, via ROADMAP, 10-30). No cap on how many others: their fortnight and the ceiling
  bound them. They take room from "Work here" first: the numbers are in the PR and the check below.
- A lead line is at most 240 bytes (`HANDOFF_LEAD_LINE_BYTES`), a long line taken a sentence at a time,
  because a handoff is as often one paragraph as a list and five paragraphs would be the handoff.

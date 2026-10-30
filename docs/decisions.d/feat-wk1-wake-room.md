### Decided by ROADMAP, built by the WK1 builder, 2026-10-30, for Mike's review (the wake's room)

- "Might be relevant" is off the wake (`HINTS_IN_WAKE` false). Why: it showed on 4 of 29 days since
  10-02 and ambient recall does that job per turn, with ratings. Follows `CRAFT_IN_WAKE`: a switch,
  so turning it back on is one line. With it off, every publish closes the open `wake_display` rows,
  so a use is no longer refused a return as `on-display`.
- A store with no self page yet keeps "Might be relevant". Why: the case for dropping it was measured on Mike's store, whose
  page holds 53% of the room. With no page the lane is all a wake has of its memories, and with it off a new user's wake was
  empty until the first page. The brief said drop it; this is the one exception, for ROADMAP to rule on.
- No wake line lists bare ids. A count names the door that lists its items by title (`still open`,
  which gains `comingUp`, and the new `handoffs here`). A lane with no such door is a count alone.
  An id after a title stays: that is its handle.
- A lane with nothing it can title still says its count and the door, rather than nothing. Why: the
  never-silent guarantee (2026-10-12). The brief allows "nothing"; say if silence is wanted.
- Coming up lists the 2 oldest overdue (`COMING_UP_OVERDUE_LISTED`), and they step back when they
  would cost "Still open" an item. Why: dated lines outrank the lane's items in the room, which was
  meant for what is due today, and "Still open" is to stay as it was while the open-threads read runs.
- The handoffs, "Last here" and "Last said here" are one block, grouped by session (`handoff/#standsLadder`). An entry
  under the lead is judged by session and time, never by text.
- The newest handoff leads, even when a chapter is newer (ROADMAP, after the first build had the newest mention leading). A
  newer chapter goes under it by title, "Since then:", if there is room, and gives way before any handoff's line does. This
  keeps review of #300 MAJOR-1: unfinished work outranks orientation.
- The newest handoff's lead is up to 5 lines (`HANDOFF_LEAD_LINES`; Mike's markup, via ROADMAP, 10-30), and the next 2 live
  handoffs a line each (`HANDOFF_OTHERS_SHOWN`; ROADMAP: a line each with no cap took "Work here"'s room on a folder holding
  seven). The rest are a count and `recall "handoffs here"`. Which seat a handoff belongs to waits for WK2.
- A lead line is at most 240 bytes (`HANDOFF_LEAD_LINE_BYTES`), a long line taken a sentence at a time, because a handoff is
  as often one paragraph as a list and five paragraphs would be the handoff. A line is cut at a word's end, and a handoff's
  last `next:` part keeps a line of its own, the lines before it giving way: it is what the next session opens it for.

### Decided by the day-summary builder, 2026-10-30, lightly held (what holds a day's summary back)

- Decided by the day-summary builder, 2026-10-30, lightly held: the Yesterday gate counts a memory only
  when day's end could have been handed it: `writer.ts#isOfDay` (the day lived, or a merge of it), born
  before the summary was told. Dropped: a row merely written inside the day, and the store-wide count of rows by
  folder written inside the day. Why: on the 10-29 summary the only blockers were three write-ups of
  10-26, from a folder set off, filed on 10-29; they were in neither day's input. Temp folders, worktrees and rows with no
  folder hid nothing on the six days with a written summary.
- This reverses the W1 review's test that a backdated row from an off folder holds the summary back. The
  commit records no reason beyond reading the day as day's end saw it, and day's end never picks by when
  a row was written. What the clause bounded was recall, and it bounded only the rows written that day:
  recall reaches every day.
- What that gives up, plainly: day's end's child holds `recall`, and nothing filters it by folder. An off
  folder's row written that day about another day, read by that recall and put in the prose, was held back
  before and now reaches the wake. The same row written a day earlier already did, on the old gate too.
  Only a bound on recall in that child, or the run recording what recall handed it, closes both.
- Chose the gate, not day's end's input. Filtering the input (the `omit` it already takes) would not
  have helped either day, since the rows were not in it, and it needs the scope setting read at night
  and a mark on the run saying the input was filtered. Revisit if `handoff.daysummary.held` shows
  `folder-closed` often on days an off folder really wrote.
- A row or chapter with no folder recorded still holds it back: nothing can tell whether it is private,
  and it has not happened since chapter-written memories began reading their chapter's folder.
- The chapter walk has no time bound: no chapter blocked anything, and a chapter's date is its heading.

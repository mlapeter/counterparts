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
- What that gave up, and what closed it: the old clause caught an off folder's row written that day about
  another day, if day's end's recall put it in the prose. Round 2 below closes that for every day: the child
  can't read such a row. What stays open: a folder set off after the night ran. Its words were read while it
  was on, and the gate holds the summary only if the row was of that day.
- Kept the gate as it is beside the fence. With the fence on, a summary told while a folder was closed can't
  carry that folder, so the gate's hold on that folder's rows of that day is more than it needs; it stays as
  the second line for a folder set off after the telling. Revisit if `handoff.daysummary.held` shows
  `folder-closed` on days the folder was closed before day's end ran.
- A row or chapter with no folder recorded still holds it back: nothing can tell whether it is private,
  and it has not happened since chapter-written memories began reading their chapter's folder.
- The chapter walk has no time bound: no chapter blocked anything, and a chapter's date is its heading.

### Decided by the day-summary builder, 2026-10-30, round 2, Mike's roadmap go on `core/dream`, for his review (the night's fence)

- A folder that doesn't export is closed to the whole night, at the source: day's end, the dream, the
  reflection, the tagging, and each one's recall by facts, meaning, id, handle or chapter address. A merge,
  gist or fold can't be made from one. One set (`dream/slices.ts#closedToNight`), walked once per night call
  (153 ms on the owner's store, 5,886 rows), read everywhere: the two `showable`s, the chapter walks, day's
  end's `omit`, the `denied` set of facts and meaning, the address path.
- The rule is `scopes.ts#foldersOn`, the one the catch-up uses. It means the same as the gate's `exportsFrom`,
  without "your own folder is always yours": a night has no own folder. A folder that's closed and hosts the
  night reads nothing of itself.
- Reads the other way from the gate on what it can't tell: a row with no folder, or a night row whose originals
  are gone, stays readable. The gate holds one line for a morning; failing closed here would blind every night
  to its pre-folder memories.
- A stored merge of a closed row is closed to the night and stays stored (Mike, 10-26: a folder turned off later
  keeps what it already shared). On the owner's store today that is none: the fence closes 3 live memories, 0
  night rows.
- The dream goes without the published wake on a night it names a closed row. It was composed for no reader, and
  cutting it line by line would leave an item's later lines behind.
- A recall of a closed row by address says `closed-to-the-night` rather than `handle-unknown`: a lookup that
  answers "nothing" where something exists would be a lie (§9.1 G5), and the asker already held the id.

### Decided in the review of #688, 2026-10-30, on Mike's rulings through the roadmap (what the fence does at its edges)

- A setting file that won't read holds the night, as a night that failed: no page, no dream, no reflection, the
  reason on the row and at the door, doctor red. Closing everything stands; going on with what's left doesn't.
  The red is a finding of its own (`night-held`), read from the file so it clears when fixed; the catch-up's
  amber from #689 stays beside it.
- A row with no folder stays readable, for the reason above. A past dream's journal or reflection's entry is left.
  A card's name goes when only closed rows name it, and the tagging ask's tags and titles read the fence.
- A day summary citing a closed row isn't in the reflection's timeline; that day goes as its chapters do.
- A session's own marks stop reading as the night once quiet past `ABANDONED_AFTER_MS`, as `begin` reads a dream
  left behind. A child of the run carries its mark regardless. The cost: a session-launched dreamer quiet that long
  reads as a session again until its next call.
- Lives in `dream/slices.ts`, not a file of its own: the directory flavor was at its 510-file margin.

### Decided by Mike and the W1 builder, 2026-10-24, lightly held ("Today so far" and Yesterday from day's end's summary)

- Decided by Mike, 2026-10-24 17:45 ("yes to both, lightly held, go ahead"; night-list item A):
  a session start's wake gets a "Today so far here" line (`self.TODAY_SO_FAR`, on), and the
  Yesterday line leads with day's end's summary when there is one (`self.YESTERDAY_FROM_SUMMARY`,
  on). Why: jumping between sessions should feel like talking to the same person; a 3pm session
  saw only the newest chapter here, and the one model-written account of yesterday was read only
  by the night. Revert: either switch off (both off: the wake byte for byte as before, checked
  on the 10-24 corpus), or revert the PR.
- Decided by the W1 builder, 2026-10-24: "Today so far" is THIS folder's chapters only (the
  row's own directory). The brief leaned to adding about-me chapters from other folders; those
  are already named once by "Today, elsewhere" (a folder's newest about-me chapter) or the "About
  me, from another directory" line, so taking them here would repeat them or need a second
  suppression rule. Joined project folders are not included (follow-up if wanted).
- Decided by the W1 builder, 2026-10-24: the line rides in the Yesterday line's place as a second
  line, one ladder of forms (`withTodaySoFar`): it steps down and drops before the Yesterday line
  gives up a title (`ROOM_ORDER`'s `todaySoFar`, just below `yesterday`). Like Yesterday it outranks
  "Still open" past its first item and "Work here"; on the corpus replay it cost those 3 Still-open
  items in a full wake. Widths: the newest 4, a summary's first sentence cut at 120 bytes, then 60.
- Decided by the W1 builder, 2026-10-24, the privacy gate (stricter than the brief's floor, on
  purpose): day's end reads every chapter and the day's strongest memories store-wide, whatever the
  scope settings, so cites don't bound what the prose drew on. The summary shows only when every
  cite is nameable here (this folder's, or about me/us/owner from a folder whose scope is on),
  every chapter that day is from this folder or a scope-on folder, and every folder that wrote a
  memory that day is too. Otherwise the plain chapter list. The summary is never cut: under
  pressure the line falls back to the plain list's forms.

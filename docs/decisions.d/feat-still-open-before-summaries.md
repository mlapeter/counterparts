### Decided by Mike, 2026-10-24, lightly held ("Still open" keeps its items before "Today so far" keeps its summaries, W1b)

- Decided by Mike, 2026-10-24 21:11 ("ok your rec sounds good, lightly held as im sure we'll
  continue making tweaks to that page"; raised by W1's reviewer and the coordinator): "Today so
  far here"'s summary forms give way before "Still open" past its first item, as a new
  `ROOM_ORDER` lane `todaySoFarSummaries` between craft and "Still open". Its title forms stay
  where W1 put them (`todaySoFar`, below "Still open"'s items and "Work here"). Why: a summary can
  be opened by its chapter's id, but a Still open item that drops is a promise forgotten. No new
  switch: with `self.TODAY_SO_FAR` off the wake is byte for byte as before (checked on the 10-24
  corpus). Revert: move the lane, or revert the PR.

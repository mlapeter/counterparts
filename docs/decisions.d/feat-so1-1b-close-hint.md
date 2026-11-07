### Decided by the SO1 step 1b builder, 2026-11-07, lightly held (a write's close hint)

- The shape (roadmap with Mike, 11-07): a stored `remember` or `session_end` entry lists
  open items from any folder whose subject it matches (`mayClose`), and the writing model
  decides. Why: the proof an item is done lives in the session that did the work, which
  never knew the item existed; the night's rule closed 0 of the 32 items closed by hand
  on 11-07.
- At most three per entry, nearest first (fewest patches on, then the newest item). No
  per-call cap beyond that.
- The entry must say the thing was DONE (released, published, merged, …) beside the
  version or PR in its headline; a plan (`planned`, `proposed`, `asked`) and an entry
  about owner/us/me list nothing.
- The item's `settlesWhen` is read with every version and PR it names (the same version
  counts: "settles when 0.3.46 published" is listed beside "0.3.46 published"), since it
  is a trigger written on purpose. Its headline is read strictly (a step verb beside the
  version, `sameSubject`'s rules).
- A PR rule exists for the hint only (`interference.ts#prKeys`). The night's interference
  sweep still has none: a fade there is the store's call and was wrong on all three
  same-PR pairs in #777's review; a hint is a list the model judges.
- Asked items are listed with a note naming the owner ("asked of Mike: close only if
  this is Mike's answer"), the name read from the store, "the owner" when none.
- Counted as two event names, no store-format change: `open.close-hint.shown` per entry
  that listed any (ids, ms) and `open.close-hint.closed` when a listed id is closed
  through `updates` within 7 lived days (`CLOSE_HINT_TUNABLES.CLOSE_WINDOW_DAYS`).
- The cost, on the write path: a write whose headline names nothing done (nearly every
  write) is checked on its own words and reads nothing. One that does reads every open
  item's head once (one indexed query), then the parked and settled-over checks for the
  few that matched. Measured on a hermetic store with 150 open items in three folders:
  about 1 ms when it lists (p50 ~1.0-1.2 ms), about 0.5 ms when it matches nothing.

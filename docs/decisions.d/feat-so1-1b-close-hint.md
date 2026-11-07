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
  item's head once (`INDEXED BY memories_open`), then the parked check (one row's touch
  read, only for an item with no `settlesWhen` that isn't asked) and the settled-over
  walk, nearest first, only until three are listed. Measured on a copy of the owner's
  store (11-07, 338 open items): ~1.6 ms p50 in the read whether it lists or not, ~2 ms
  p50 through `remember` (max 2.3). Before the review's fixes it was ~18 ms with hints:
  the planner took `memories_birth`, and the touch read walked every open item.
- After the review of #783 (a dry run on the 11-07 copy: 3 of 19 plainly irrelevant, 2
  weak): the PR rule matches only items in the writer's own project folders (the join
  Still open reads), since a PR number belongs to one repository; checks and follow-ups
  are never listed (title or `settlesWhen` with CHECK-AFTER, "Check due", "Check ~",
  "Experiment check", "re-read": a merge doesn't settle a read); protected rows are left
  out (their close would be refused); and an item in a folder the folder setting has off,
  paused or observer is never listed in another folder's result.

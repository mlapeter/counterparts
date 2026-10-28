### Decided by the P2b builder, 2026-10-28, lightly held (the parked counted whatever line "Still open" has)

- Decided by the P2b builder, 2026-10-28, lightly held: "Still open" says how many threads are
  parked even when it has no count line — `(3 parked; recall "still open" lists them)` under
  the items it lists, or `Still open: nothing current · 3 parked (recall "still open" lists
  them)` when it carries nothing — and the folded line keeps `· N parked`. This replaces P2's
  "only on the existing count line". Why: the brief said parked items are counted, not
  vanished, and its main aim was a clean list for a new user in week 3, whose lane is short; a
  store with 3 parked items and nothing carried woke on day 40 with no word of them.
- Decided by the P2b builder, 2026-10-28, lightly held: the line is reserved like a lane's
  count line (the trim loop pays for it before the lanes' items), and only a bare floor goes
  without it. Why: unreserved, it would drop on most real wakes, which fill to the budget.
- Decided by the #675 reviewer, 2026-10-28, lightly held: the parked words are the first of
  the lanes' words to give way. They take room as the lanes' lines do, but before the trim
  loop pops a "Who I am" item for them, and before a floor goes bare for them, they go quiet
  and the wake is the one it would be with nothing parked; the last check (`tellLost`) tries
  every form without them before it leaves a lane untold. This revises the line above ("only
  a bare floor goes without it") and answers the PR's open question (no page, a tight budget:
  the parked line no longer outranks identity items). Why: as built, ` · 3 parked` on the
  folded line could push the fold a few bytes past its room, and the floor went bare — "Still
  open" and "Coming up" untold, the parked unsaid as well (a 4,000-case fuzz: 48 wakes told
  fewer lanes than #674's; the real path at a 700-byte ceiling); an aside about what nobody
  touched in 14 lived days should never cost a current lane its count.

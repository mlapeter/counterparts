### Decided by ROADMAP and the LT1 builder, 2026-10-30, marked for Mike's review (a slow turn is shown)

- Decided by ROADMAP, 2026-10-30, marked for Mike's review: recall no longer gives up at its 1,200 ms
  line. Why: both checks came after the slow work, so giving up saved about 5 ms and cost the turn. It
  replaces "a latency abort has zero side effects" in recall's contract: a late turn writes what any
  turn writes, and says `lateMs` on its row. `BUDGET_MS` stays, as the line that names a turn late.
- Decided by the LT1 builder, 2026-10-30, lightly held: a lock held past about 10 s still loses the
  answer, on a late turn as on an on-time one (`persist` throws after the second busy timeout, in 11 s).
  Why left alone: catching it did show the answer in a scratch copy, but at 30 s, because the writes
  behind it wait too, and whether 30 s with memories beats 11 s without is a question for someone who
  has waited through both. How often this happens isn't known; the hook's `ms` over 5,000 in the week's
  read says.
- Decided by the LT1 builder, 2026-10-30, lightly held: the covering index is not a store-format change.
  No version moves and an older build reads a covered cache as it was (byte-identical on 52 of 52
  prompts), so it doesn't wait for a batch of migrations. It adds about 15 MB to a rebuildable file.
- Decided by the LT1 builder, 2026-10-30, lightly held: a card's name whose first word isn't plain ASCII
  is still tried on every prompt. `toLowerCase` and the regex's case folding disagree outside ASCII, and
  trying it is what every term cost before, so such a store is no slower than today and no faster there.
  The scanner the v12 backfill uses had this same gap, on a long s or a final sigma; it goes through the
  same two functions now.

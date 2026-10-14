### Decided by Mike, 2026-10-14, lightly held; review 2026-10-18 (the era all the way down, and the wait under the floor)

- Decided by Mike, 2026-10-14, lightly held; review 2026-10-18: **a memory leaves after 14
  lived days UNDER the floor**, not 14 since its last use. `physics#pruneVerdict` counts from
  `floorDay(m)` (the anchor plus `daysUntilBelow(m, PHI_PRUNE)`, read off the curve, never
  stored) and never from before `curveSince` — the lived day this build's curve first read
  the store (`sleep/decay.ts#curveSinceDay`: a row `decay.curve.since` in the existing `meta`
  table, written when a new curve signature replaces an old one; no column, no store
  version). Why: the rule meant was "exits after 14 lived days under the floor"; the old
  count let a long-unused memory go the night it crossed. The crossing day alone is not
  enough: a new curve that lowers a memory reads it as under the floor for weeks already,
  so the guard is what keeps the era change below from emptying the store the night it
  lands. Costs, said plainly: every curve change (any constant in the signature, the era
  toggled) pauses every exit for 14 lived days; a per-memory lowering (a `changed` fade, a
  smaller claim) and a dated memory whose window closed still read as if always on the
  lower curve, as before.
- Decided by Mike, 2026-10-14, lightly held; review 2026-10-18: **an old claim the era
  scales DOWN is the whole salience the curve reads** (`physics#curveSal`): `eraClaim`
  alone, not `max(mean of the dimensions, eraClaim)`. Why: pre-Group-1 memories carry
  author-scored relevance/predictive written under the same old field text as their claims
  (mean ~0.29/0.21; a memory written since reads ~0.02), so the mean floored the era back up
  — and a fresh install's memory reads its claim, which is what the era (2026-10-11) says an
  upgrader should read. Scaling the dimensions by the claim's ratio was the alternative; it
  leaves the high-dimension rows above the default. Memories the era raises read as before;
  the exempt are untouched (`eraClaimOf` unchanged). Note: the 10-11 rule lowers an old
  DEFAULT even on an otherwise-exempt row (a protected done work event's old 0.25 default
  reads 0.20), and that row now reads 0.20 flat. `curveSal` feeds height, steepness and recall's
  turn gate. The curve signature's `eraReads: 3` re-curves a store once.
- Measured on a copy of the live store, lived day 23 (2026-10-14): of 591 era-read memories,
  485 lowered and 106 raised; before the fix 103 of the 485 read no lower at all and the
  lowered median read 0.395, after it 0 and 0.250. Below reach (1,603 prunable live rows):
  332 with the fix off, 570 with it on. Under the floor tonight: 0 either way, so 0 exits
  tonight under every rule. Over the next 14 lived days (to day 37), with nothing used: the
  old count would archive 74 (fix off) / 130 (fix on); the new wait archives 0 — the first
  exits are on day 39 or later (26 by day 44, 130 by day 51 with the fix on).

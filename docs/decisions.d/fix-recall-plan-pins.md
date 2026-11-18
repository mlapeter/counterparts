### Decided by the recall-plan-pins builder, 2026-11-18, lightly held (recall latency, no store change)

- Decided by the recall-plan-pins builder, 2026-11-18, lightly held: `tagNeighbours` and
  `subjectsOfKind` are pinned with a unary `+archived`, not `INDEXED BY` as #783 did. Why:
  `+` only takes the bait index (`memories_birth`) away and can never fail, while a named
  index that is missing throws "no such index" (and `selfSubject` is read outside the
  beliefs slot's per-subject guard). Revisit once the store runs ANALYZE or `PRAGMA optimize`.
- Decided by the recall-plan-pins builder, 2026-11-18, lightly held: `beliefsNamedIn` catches
  up once a call, not once a named subject. Why: each catch-up is a scan of `memories`. The
  cost: a belief another process files in the milliseconds between two subjects of one
  turn shows next turn. No incremental watermark yet: once a call already makes it one scan
  a turn, and the type index the next batched migration can add removes the scan outright.

### Decided by the R3S builder, 2026-11-01, on Mike's call that morning, lightly held (a stop-list for learned cue words)

- Cue learning no longer learns from path fragments (`tmp`, `uds`, `sock`, `cross`, `etc`, `usr`, `var`), hex ids (7+
  hex characters with a digit and a letter) or acknowledgements (`sounds`, `good`, `ahead`, `let`, `okay`, `yes`,
  `yeah`, `yep`, `sure`, `fine`, `cool`, `great`, `thanks`, `fyi`), and ignores the pairs they learned before when it
  reads. Why: the 11-01 read of R3 found 3,268 pairs in a week, about 10× what was expected, and path fragments and
  acknowledgements among the widest words (`cross` 53 memories, `uds` 50, `tmp` 49; `ahead`, `let`, `sound` at the
  per-word cap, all led by one memory). On a store copy these classes were about 10% of pairs: hygiene, not the cause
  of the growth.
- No store row is edited. Deleting the old pairs would be a change to real users' stores, which goes to Mike first;
  they fade and are swept as before.
- Undo: empty `associate.TUNABLES.CUE_STOP_LIST` (one constant). Then no filter runs and cue learning is exactly what
  it was, the old pairs read again. What to read and what would change it: `docs/CHECK-AFTER.md`, "Due ~7 lived days
  after the cue stop-list".

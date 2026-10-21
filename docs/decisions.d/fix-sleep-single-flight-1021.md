### Decided with the day coordinator, 2026-10-21 (one sleep cycle at a time, per store)

- The cycle is single-flight per store through a fenced lease in box 2 (`sleep/lease.ts`),
  not a lock database held for the whole cycle. Why: an OS lock is freed at once by a death
  but held for ever by a wedged worker, and nothing reliably kills one (the spawn's timeout
  lives in the hook that already exited); the lease is reclaimed, and the fence stops the old
  holder before its next phase. A lease another owner holds is taken over when it has run
  out, when its pid names no process, or when the clock says it was taken in the future or
  runs out further ahead than a lease lasts.
- Both closing workers (Stop and SessionEnd) still spawn and still flush; the second stands
  aside from the cycle at once and leaves a `sleep.cycle.held` row.
- **Known residual, accepted:** a holder that is alive but misjudged, by its clock or by a
  `kill(pid, 0)` that wrongly reports it dead (another pid namespace, a store synced to
  another machine), gets at most ONE PHASE of overlap with the cycle that took its lease
  over, before the fence stops it. Births in that window are still one card per name: the
  birth's own re-check under the write lock (#578) covers them, and the trial merge of
  #569, #578 and #581 made no twin. Another phase may run twice in that window, as any
  phase could before the lease; births was the one where that left lasting damage.
  Revisit if a store is ever shared across machines or pid namespaces.

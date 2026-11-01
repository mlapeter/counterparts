### Decided by Mike, 2026-11-01, lightly held (the core door's shadow retired)

- Decided by Mike, 2026-11-01, lightly held: the core door's support arc stops running in shadow.
  `physics.CORE_DOOR_SUPPORT` defaults to `"off"` (it was `"shadow"` from 2026-10-24). The two lanes decide exactly as
  they did under shadow, and no `promotion.shadow` or `promotion.shadow.sleep` row and no `sleep.shadow.*` mark is
  written. The shadow and the support door stay in the code, inert. Mike's call followed the shadow week's read on his
  store (lived days 35–41: lanes 1, door 5; `docs/CHECK-AFTER.md`, "Checked 2026-11-01").
- A memory can still be admitted to core on a reflection's citation alone (Mike's 09-27 ruling). Retiring the shadow
  doesn't change that.
- No memory was promoted or demoted by this change: the door's five `wouldPromote` memories stay out, and its one
  `wouldHold` memory (mem_9e4bfcefab3c) stays core.
- Undo: set `physics.CORE_DOOR_SUPPORT` back to `"shadow"` to record again, or to `"on"` to let the door decide. It's
  one value in `src/core/physics/index.ts`.

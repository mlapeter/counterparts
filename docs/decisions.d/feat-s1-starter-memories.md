### Decided by the S1 builder, 2026-11-03, lightly held (starter memories)

- The mark is the row's `source`, `told`, a new member of `MEMORY_SOURCES`: no schema change (`source` is free
  text on every store), and the readers that already branch on `dreamed`/`reflection`/`episode` take one more
  word. The row's meta repeats the set's version (`told: "v1"`); the store's meta holds `told.set` and
  `told.surface`.
- Seeds are planted beside `beginNewInstall`, not inside it: `install` on a store it created (so `start-fresh`,
  which re-uses install, seeds — a fresh store is a new counterpart), and hosted's `startNewStore`. `init` and a
  store a hook opens don't, as they never start the meeting either.
- Ambient recall: a told candidate is outside the turn's background, never loud (`told-quiet`), and ranked after
  every lived one before inhibition and the footnote cap, so it only takes a quiet slot no lived memory wanted.
  Not a salience knob (§9 G8). Deliberate recall: facts orders a told match at half its score; meaning mode leaves
  them out (they are no moment of anyone's arc).
- The store size recall reads (`countMemories`) still counts the seeds, so a new store leaves the gate's cold-start
  regime (`COLD_START_MIN_STORE`, 15) at about 4 lived memories rather than 15, and word rarity is measured over 11
  more rows. Left as is, a watch for Mike's fresh-user test: the ranking test (25 lived) shows no lived match lost,
  and the seeds are outside the turn's background either way.

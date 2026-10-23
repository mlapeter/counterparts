### Decided by Mike, 2026-10-22 ("ok sounds good"), an experiment: the dream's fresh intake (`dream.FRESH_LIST_CHARS` 16,000, `dream.NEIGHBOURS` 4)

The nightly dream took at most ~44 new memories a night while the waiting queue grew (415 → 434 → 562 → 654 over
four recorded nights). The cap was the fresh LIST (ids and neighbours, costed 2× JSON ≈ 270 characters an entry
with 6 neighbours) at 12,000 characters, not the 50,000-character fresh room. A composition-only compare on the
10-22 snapshot, with no model spend (`~/counterparts-notes/2026-10-22-dream-intake-compare.md`; copies and script in
`~/counterparts-backups/2026-10-22-corpus-intake/`), reproduced the real night exactly at base and read:

- base 44 fresh; list 24k alone 51 (the fresh room binds next); NEIGHBOURS 4 alone 53; both 64, with nothing
  left out (notShown 0, every section the same), 5 parts, about +1.3k tokens a night.
- the cost is detail: whole texts 20 → 11 with both.
- neither drains the queue (it grows ~20–130 a night net of fading); a real drain needs `FRESH_SHARE` or
  `NIGHT_CHARS`, which is tokens. Not done: Mike was near his weekly limit and chose composition only.

**16,000, not the 24,000 Mike okayed (the coordinator's call, 2026-10-23, lightly held; told him).** At 24k a
full list, with the wake and the page, passes part 1's furniture line (`RESULT_CHARS - FIRST_PART_MIN_ROOM`,
36,000), and the wake is left out of part 1 on a busy night; the wake cannot be fetched in a later part
(`test/result-ceiling.test.ts`, "a busy night reaches the model whole", fails at 18k and passes at 16k). The real
10-22 night used 14,506 characters of the list at 24k with 4 neighbours, so 16k takes the same 64. The list would
only need more if `FRESH_SHARE` rose.

NEIGHBOURS 4 is under the owner's earlier 5–8; he okayed 4 for this experiment. `reconsolidation.ts`'s
`NEIGHBOURS` is a different setting (`CONTRADICTION_TUNABLES`) and is unchanged. Revert: put both values back in
`src/core/dream/tunables.ts`. Check: `docs/CHECK-AFTER.md`, "Due ~2026-10-29 (the dream's fresh intake)".

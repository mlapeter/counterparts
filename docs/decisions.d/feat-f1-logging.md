### Decided by ROADMAP, 2026-10-30, marked for Mike's review (chapter summaries' default claim)

- A new chapter summary that is unmarked or marked work is born at 0.25 instead of the self-kind default, 0.4
  (`SELF_TUNABLES.CHAPTER_SUMMARY_CLAIM`). One marked me, us or owner stays at 0.4 (ROADMAP, on the review of #696), and so
  does world, since the change names only unmarked and work; the copy has no world summaries. New rows only.
- Why: the 10-30 replay, 379 never-used summaries out of reach and no use-days lost, measured with every summary lowered.
  With the marked ones kept, 35 of the 464 live summaries on the copy stay at 0.4, and below reach is 324 of 464 instead
  of 355. That leaves 31 in reach, 24 of them never used, so the 379 reads about 350 (an estimate; the replay wasn't rerun).
  Lowering fewer rows can't lose more use-days.
- Accepted: an unused unmarked or work summary reaches the prune floor at 49 lived days instead of 267, so it is let go about
  63 lived days in (the 14-day dwell after) rather than about 281. A marked one keeps the 281.
- The claim is taken once, at birth, from the chapter's `about` as written: the mark given with the summary, else the one
  that chapter's call recorded, else, for an episode from before per-chapter marks, the episode's latest.
- A summary re-marked later keeps the claim it was born with, whichever way the mark moves: `store.setAbout`, which every
  re-mark goes through (a later `about` on the same chapter, the `remark` door, the reflection, the dashboard), writes the
  mark and never the claim. So a work summary re-marked us stays at 0.25 and fades on that curve until a use lifts it, and
  an us summary re-marked work stays at 0.4. Automatic rewritten as written is the same row and keeps its claim too.
- At 0.25 a summary is under the Nearby lane's `WARM_FLOOR` (0.35). That lane still runs on a store with no page yet (WK1
  kept it there, `self/identity.ts`), so such a store's "Might be relevant" no longer lists an unmarked or work summary; at
  0.4 it listed one for about a lived day. Those chapters are still named by "Today so far", "Yesterday" and "Where this
  folder stands". The same goes if `HINTS_IN_WAKE` is turned on again. `docs/CHECK-AFTER.md`.

### Decided by the F1 builder, 2026-10-30, lightly held (what the rows carry)

- Decided by the F1 builder, 2026-10-30, lightly held: `meta.claimedDefault` stays on a summary at 0.25, though
  `defaultClaimFor` wouldn't say 0.25 for it: the flag means nobody claimed it, which is still true. `eraClaimOf` reads a
  default only on a row older than the store's cutoff, so a new summary reads as stored. The value is a self tunable,
  outside `sleep/decay.ts#curveSignature`, so nothing re-curves.
- Decided by the F1 builder, 2026-10-30, lightly held: the top below-reach candidates are NOT logged. A running max can
  only see what reaches `recallable`, and both bulk channels (the word index and meaning) filter at `REACH` before that,
  so it would name what a date, a learned pair or a link reached, plus rows a stale cache let through, not what forgetting
  costs. The real list needs each top-K read twice per turn, which is new per-turn work. Replay stored cues offline with
  `includeBelowReach` instead.
- Decided by the F1 builder, 2026-10-30, lightly held: no abort row and no phase timings. Since LT1 nothing aborts, and
  every turn's row already has `elapsedMs` and `lateMs`. No phase timers exist, and adding them is more than this asked.
- Decided by the F1 builder, 2026-10-30, lightly held: `cue`, `sem`, `pair`, `bar` and `standsFor` go on loud rows too, not
  only footnotes. It's the same function, and a loud memory's reason is the same question. `pair` is what learned pairs
  gave before the document cap, held to `cue`.
- Decided by the F1 builder, 2026-10-30, lightly held: a session start's section bytes are flat `sec_*` fields on
  `adapter.wake.injected`, because an adapter's row is flat, and they come from one scan of the delivered text by its line
  heads (`counterpart-boundary.ts#wakeShape`), because the lines spliced in at delivery have no render to report them. WK2
  owns those heads next: it either keeps the scan's list current or reports bytes from its composer.
- Decided by the F1 builder, 2026-10-30, lightly held: kept ids capped at 16 per lane, with the lane's count beside them.
- Decided by the F1 builder, 2026-10-30, lightly held: `recall_turns` and `dream_shown_day` stay until the next batched
  store-format change, since dropping either is one. Only the reader goes: `mechanisms.ts` read the empty table beside the
  `recall.decision` rows that already say the same. For that batch: drop the `recall_turns` table with its index and
  `recordRecallTurn` / `recallTurns`, and `memories.dream_shown_day` with its index.

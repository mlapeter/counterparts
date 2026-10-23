### Decided with Mike, 2026-10-23 (roadmap seat, 13:40–15:30; his go 15:32, lightly held): day's end and the reflection's room

- The night laid against human memory: the DREAM is sleep (part 1, fresh memories with their neighbours, is
  slow-wave consolidation; part 2, mixing, lookback and links, is REM). The REFLECTION is the morning's
  autobiographical reasoning: patterns over weeks, the long-term self.
- The page writer has one human equivalent, the bedtime diary: what is gone over before sleep is consolidated more.
  So it stays first, in its own child, and is called **day's end** (Mike: "days end works as a name"). Identifiers,
  the row and the `pageWriter.mode` key keep the old name: no store change, no config migration.
- Day's end reads the day as told (`self.DAYS_END_INPUT`): every chapter by its summary with its address, and the
  day's 12 strongest memories with ids, so Lately can cite (`self_page` takes `cites` and `claims` now).
- The reflection's room is filled long view first (`dream.REFLECT_ROOM_ORDER`). `dreamSaw` gave every memory the
  dream was shown a line ahead of the core, and was not deduped against `recent`: on 10-21/10-22 it took the room
  and core, candidates and recent got nothing. It keeps only what the dream changed and 40 older ones it saw.
- The order, not the size: `ROOM_CHARS` stays 80k. A busy night now spends about 89–92k across 4 parts (was ~105k).
- Decided by the D1 builder: the chapters' room (`REFLECT_CHAPTER_CHARS` 16k) shortens each line on a busy few days
  (to 80 bytes at least) and grows past that rather than drop one; the long view is guaranteed a line each even past
  the room (more parts), never dropped.
- Decided by the D1 builder: a page cite whose memory a dream merged reads through the merged memory at read time
  (`measures.ts#pageTrace`, `throughLater`); the stored cite is never rewritten.

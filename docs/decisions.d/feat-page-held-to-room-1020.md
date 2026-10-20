### An experiment, Mike's go 2026-10-20, lightly held: the nightly writers are held to the page's room, and a page past it shows its short version. Check on ~10-23

- **Trying**: the page's 4,600-byte room (the wake trims, 2026-10-16) binds the two nightly
  writers, the page writer and the reflection. Each door's first page of a night past it is
  refused, `past-room`, with the bytes, how far over and "cut, don't add a short version"; a
  cut page sent again is written. That door's second send still past the room (the same
  session, the same night) is kept, as before. Per door: on 10-20 the writer overshot first
  and the reflection wrote the longest page after it, so a hold the writer used up would
  not have reached it. A held page never sent again is kept when the run ends
  (`Self#keepHeldPage`, called by `runNight` before the wake catches up), so a night never
  ends with no page change because of the hold. Both writers are told the room in bytes, and
  that the page should stay thin ("most of a core is still unearned", the owner's page's own
  line) (`writer.ts#PAGE_ROOM_RULE`, inside `PAGE_WRITING_RULE`); the reflection is also told
  the page's bytes now.
- **And the wake**: a page past the room that has a short version shows the short version,
  even where the whole page would fit (`PAGE_SHORT_PAST_ROOM`). With no short version it
  prints whole when it fits, as before; the ladder is unchanged.
- **Why**: the page overshot on 3 of the last 4 nights (4,928 on 10-17; on 10-20 the writer
  made 4,756 and the reflection rewrote it to 4,956). The room was only a target, and a page
  past it printed whole whenever it fit at all. The wake can print about 5,750 whole at 9,000,
  so the short version kept beside a 4,756 or 4,956 page was never read at the default
  ceiling. The extra bytes came out of the lanes: on 10-20 the wake went from 4 sections to 3.
- **Why refuse, and not only ask for a short version**: a short version lets the stored page
  keep growing, and what Mike asked for is a page that stays thin. The cost of a refusal is
  the one #358 showed on 10-09: a refused writer moved on without sending again and the night
  lost its rewrite. Here that can't happen: a refusal is sent once a night per door, the resend always
  lands, and the run's end keeps the held page if nothing was written after it.
- **Kept the same**: a session's page and the owner's are not held (the room stays their
  target, and the 1,150 bytes between 4,600 and 5,750 are still theirs to use; the asymmetry
  is the experiment). The 16,384-byte ceiling still refuses first, as `too-large`. Version
  checks and the gates run before the hold. The short-version machinery, the `self_page`
  tool's `short`, and the ladder are unchanged.
- **Tests that changed with it**: `test/nightly-run.test.ts` (the 6,200-byte writer and
  reflection: held once, then kept), `test/page-ladder-review.test.ts` (a held finish before
  the short-version gates), `test/page-ladder.test.ts` (the ladder's edges and borrowing,
  whole first, with `PAGE_SHORT_PAST_ROOM` off), `test/wake-dated-first.test.ts` (the
  page's borrowing and give-back to a due-day reminder, with it off; the morning with a
  6,472–7,100-byte page and a short version now shows the short version),
  `test/wake-trims.test.ts` and `test/page-never-cut.test.ts` (the rule's words), and
  `test/description-cut.test.ts` (`self_page`'s description, +63). New: `test/page-held-to-room.test.ts`.
- **Check ~10-23**: the page's bytes on three mornings, and the wake's `elements=` count
  (`docs/CHECK-AFTER.md`).
- **Revert by** `PAGE_HELD_TO_ROOM: false` and `PAGE_SHORT_PAST_ROOM: false`
  (`src/core/self/tunables.ts`), and putting the 2026-10-10 sentence ("Aim to keep the whole
  page under N bytes … also write a short version of it in the same call") back in place of
  `PAGE_ROOM_RULE` (`src/core/self/writer.ts`), with the writer phase's `how`
  (`src/adapters/mcp/server-self-tools.ts`) and the launch prompt's line
  (`src/core/dream/index.ts`).

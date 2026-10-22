### Decided by the open-threads builder, 2026-10-22, lightly held (open threads mean someone owes an answer; shape agreed by Mike 10-22 10:34)

- `unresolved`'s description (one text, on `remember` and `session_end`) and the Stop ask say
  open means someone owes an answer: a question to the owner, a check with a date, a promise.
  The Desktop chat's write-up ask is unchanged (it names `updates` only). Why: the wake carried
  88 open items on 10-22, most of them notes that felt unfinished, and one in five of a night's
  stale list had an owner.
- The Stop ask gains a third, unnumbered line naming this session's own open items, title and id,
  at most `STOP_OPEN_MAX` (5), the most recently touched first (the carry's own touch); none, no
  line. "This session's own" is what it wrote (`origin_session`) or USED here — an `awake` or
  `engaged` return credited to it (a rating of 2–3, a quote, `drewOn`, a claim). Not a glimpse or a
  rating of 0–1 (review of #592, F1: another folder's open item only footnoted here was named as
  "Still open from this session"). A use refused a return (another session's already counted that
  day) does not name it. Settled-over, dreamed, flag-not-on-the-prose items are not threads
  (`openThread`, F2). The line is held to 520 characters, items past it left out whole (F5); the
  two lines' length pin went 610 → 720 for the open clause.
- An open item with no eventDate, not `asked`, untouched for `OPEN_CARRY_DAYS` (21) lived days is
  not carried (`self/identity.ts#openCarry`, the one rule the turn-end wake, the session-start
  wake, the reflection's `staleOpen` and its `noLongerCarried` count read, over one test of what a
  thread is, `openThread`: not dreamed, not settled over, not a core memory (it shows under "Who I
  am" anyway), the flag on the prose — review of #592, F3, and its re-review). It is in no lane of the wake, not "Nearby" either (it would read as still carried there),
  and is not offered to the reflection. Not closed.
- TOUCHED is born, used beyond a glimpse, or revised. Used: `meta.usedDay`, the lived day of the
  last credited use that was not a glimpse (a rating of 1–3, `drewOn`, a quote, a claim, an
  expansion), written on an open memory at the one place a use is credited (`Store#reinforce`;
  meta is JSON, so no schema bump, as #591's `build`). Decided by the coordinator on the re-review
  (G1): the returns table cannot say it, since a real use on the day a reflection cited the item
  is refused a return of its own, and a glimpse the next day then hid it; weight-0 awake rows
  would change what the core lanes and doctor read. For history before this ships the
  returns-based read stands beside it (`last_used_day`, read back to the newest `awake` /
  `engaged` / `ontopic` return when that day's credit was a glimpse). Revised:
  `versions.version_day` (any revision: a reopen, an `updates` that keeps it open). NOT a dream's
  replay and NOT a reflection's return: a share that asks about a stale thread cites it, and a
  cite would carry it forever. Being listed under "Still open", offered in `staleOpen`, or shown
  in a recall answer writes none of these, so being shown is not a touch. A rating of 0 is not a
  touch (it says the memory was not needed), and NEITHER IS A GLIMPSE — an ambient footnote left
  unrated. Decided by the coordinator, 2026-10-22, lightly held, for Mike's review (review of #592,
  F4): the loop the carry breaks is "shown again and again, never answered", and a glimpse is
  exactly that. This is separate from Mike's 10-19 ruling that a glimpse is a use that restarts the
  memory's FADE clock — that stands; only the open-thread carry ignores glimpses. Revert:
  `self.OPEN_CARRY_GLIMPSE_TOUCH` true (every credited use carries it, `last_used_day` as it is).
- The lane's own ageing (the "untouched for 2+ weeks" count) and `staleOpen`'s `untouched` still
  read born-or-used, as before; only the carry reads revisions. Why: a reopened thread is offered
  back to the reflection the next night (the 10-20 reopen path), as it was.
- The reflection's bundle carries `noLongerCarried` — what stopped being carried and no share
  already holds — and its instructions ask the share to say the count once ("… nobody touched in
  21 lived days …"), never the list. What a share holds: the `detail.notCarried` of every row with
  a share (offered, carried or told), newest back to and including the last one that reached a
  session (`told`, or `carried` into a waking session with the ask to tell it). An offered share
  not yet carried still will be (`pendingShare` finds older ones), so its count is its own; a night
  with no share holds nothing, and the next share says it. Each leaving lands in exactly one share
  (review of #592, F5 and G2). The row's `notCarried` sits beside #591's `build` stamp. A first
  night after this ships counts everything already past the line, once.
- `STALE_OPEN` stays 5 and the close/closeNow proposal path is unchanged.
- Revert: `OPEN_CARRY_DAYS` `Infinity` (carries everything, as before); the description and
  `OPEN_MEANS` back; `STOP_OPEN_MAX` 0; for the glimpse rule alone, `OPEN_CARRY_GLIMPSE_TOUCH` true. Check 2026-11-05, first look 10-29 (`docs/CHECK-AFTER.md`).

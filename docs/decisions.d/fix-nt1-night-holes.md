### Decided by Mike, 2026-11-01, lightly held (when the night runs)

- Decided by Mike, 2026-11-01, lightly held: the night keeps starting at the first message, with no scheduler, and its two
  holes close. Why: on 11-01 a night started from a `claude -p` session in a lid-closed dark wake, its catch-up child got
  about 15 s awake, the laptop slept 853 s, and the 10-minute watchdog fired on wake. Revisit a schedule if nights keep
  failing after this (`docs/CHECK-AFTER.md`, "Due ~1 week after the night's two holes").

### Decided by the NT1 builder, 2026-11-01, lightly held (how the holes close)

- A watchdog counts time awake by looking for a late tick on the wall clock (`claude-code/awake.ts`; every
  `NIGHT_AWAKE_TICK_MS`, 1 s; a tick `NIGHT_ASLEEP_GAP_MS`, 30 s, late is a sleep). Why: no clock JavaScript can read stops
  for sleep on both platforms, and macOS and Linux go opposite ways (`adapters/claude-code/NOTES.md`, "the night's two
  holes"). A sleep under the gap is charged, so a busy machine's stall is never read as sleep. A stepped wall clock costs
  one misread.
- "Headless" for the night is the entrypoint list (`hooks.ts#passesOnNight`), the same reading as doctor's
  (`sessions.ts#notPointableWhy`), unless the host says `ATTENDED=1`. Not `isInteractive`, which reads `ATTENDED` first and
  decides who gets the day's told lines. Changed in the review of #712: the host's `ATTENDED` is 0 for a person's
  `claude --bg` (kind `bg`, entrypoint `cli`), a teammate, and any process with no terminal whose entrypoint isn't on the
  host's own list (read from the 2.1.316 binary, `XU()`). A wrong "nobody's watching" holds a line; a wrong "headless" here
  stops nights, and doctor couldn't have said so. So those start the night unwatched, as they always did, with the line held.
  The cost: a `claude -p` an agent runs inside a VS Code or Desktop session may inherit that entrypoint and start the night.
- A turn no person started in a person's session (`startedByHost`, a subagent's hand-back) still starts the night, as it
  did. The brief named headless sessions, the session has a person in it, and a sleep no longer costs that run anything.
  On Mike's store two of the last eight nights started from an unwatched `cli` turn (10-25, 10-31), and both were hand-backs
  (read from the host's transcripts in the review). Open: it would be one line to send hand-backs to `passOnNight` too.
- What a run slept through is a field on its row (`NightRun.sleptMs`, on the `dream.night` event too), read by
  `nightRunLost`. No store-format change. Only the living process adds to it, so a run that really died still goes lost.
- A sleep renews the catch-up batch's claims and its runner's record (`renewCatchUp`), rather than the door learning
  about sleep. Only claims still its own: a subject another writer took stays theirs.
- A store only headless sessions use gets no night under `auto`, as it already got none under `ask`. One doctor line,
  amber, after two days without one (`night-headless`, the entrypoint list over the registry's week). Nothing more.
- A run under way holds a second one off across the date too (`Dreams#status`, review of #712; it was the same date only).
  Before NT1 a Mac's timer killed a run asleep past midnight on wake, ahead of the morning's first prompt; now it wakes and
  goes on, so without this the prompt starts another on its dream. A run really gone is lost as before. A row dated ahead
  (a clock since put right) holds nothing.

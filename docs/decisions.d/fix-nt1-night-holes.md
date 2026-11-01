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
- "Headless" for the night is the hook's own reading, `hooks.ts#isInteractive`: the host's `CLAUDE_CODE_SESSION_ATTENDED`
  when it's set, else the entrypoint list. It isn't one test across the adapter: doctor's (`sessions.ts#notPointableWhy`) is
  the entrypoint list alone, because the registry keeps no `attended`. The two differ on `cli` with `ATTENDED=0` (the hook:
  headless) and `sdk-cli` with `ATTENDED=1` (the hook: a person). The hook's reading was chosen because it already decides
  who gets the day's told lines, and the night should go to whoever is told about it.
- A turn no person started in a person's session (`startedByHost`, a subagent's hand-back) still starts the night, as it
  did. The brief named headless sessions, the session has a person in it, and a sleep no longer costs that run anything.
  On Mike's store two of the last eight nights started from an unwatched `cli` turn (10-25, 10-31; the log can't say
  whether each was a hand-back, which still starts one, or `ATTENDED=0`, which now passes). Open for review: it would be
  one line to send hand-backs to `passOnNight` too.
- What a run slept through is a field on its row (`NightRun.sleptMs`, on the `dream.night` event too), read by
  `nightRunLost`. No store-format change. Only the living process adds to it, so a run that really died still goes lost.
- A sleep renews the catch-up batch's claims and its runner's record (`renewCatchUp`), rather than the door learning
  about sleep. Only claims still its own: a subject another writer took stays theirs.
- A store only headless sessions use gets no night under `auto`, as it already got none under `ask`. One doctor line,
  amber, after two days without one (`night-headless`, the entrypoint list over the registry's week). Nothing more.
- Left as it was: `Dreams#status` holds a second run off only for a row of the same date, so a run that sleeps past midnight
  can have the morning's first prompt start another beside it. Older than this; named so it's seen.

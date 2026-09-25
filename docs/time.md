# Time in Counterparts — the plan (2026-09-25)

*Agreed with the owner on 2026-09-25. A working plan, not a rule: change it when it stops
fitting. Written because date and time bugs come from two sources: mixing UTC and local,
and spreading the conversion across many files.*

## The two kinds of time

Rails has `t.datetime` and `t.date`. So do we.

| Kind | Examples | Stored as | Shown as |
|---|---|---|---|
| **A moment** | `created_at`, `updated_at`, when an event was logged, when a version was archived | UTC milliseconds since the epoch, taken from the store's one clock (`store.now()`) | Converted to the local zone at display time |
| **A calendar date a person says** | "taxes due Oct 15", "launch in October", "late October" | Plain text: `2026-10-15`, `2026-10`, or a range `2026-10-20..2026-10-31` | As written, never converted |

A calendar date is never turned into a moment. "Oct 15" stored as midnight UTC is
Oct 14 at 6 pm in Montana, so the reminder would fire a day early. A month has no moment
to pick at all.

A third clock, the **lived day** (days the owner actually used it), drives decay and
the other memory physics. It is a counter, not a calendar, and nothing here changes it.

## Rules

1. **One module does every conversion: `src/core/time.ts`.** It turns a moment into a
   local date or a local clock string, parses and compares calendar dates and ranges, and
   says what "today" is. Nothing else calls `toISOString().slice`, `getUTC*`, or builds a
   date string by hand. A test checks this.
2. **The zone follows the computer** by default, so a laptop that moves to New York
   shows New York time. An optional `timeZone` in the config (an IANA name like
   `America/Denver`) overrides it, e.g. on a server set to UTC. Install prints the zone
   it detected in one line.
3. **"Which day was this?" is asked of a moment in the local zone**, at the time it is
   asked. `learned_on` becomes the local date of `created_at`, filled by the same helper.
   The column stays only so queries by day stay cheap.
4. **Every table that holds records gets `created_at` and `updated_at`** (moments).
5. **People see local time.** The wake opens with a line like
   `Now: Thu 25 Sep 2026, 1:40 pm MDT`, and each turn's recall note carries the current
   local time, because a session can run for hours.
6. **Old rows stay as they are.** Memories written before this change carry a UTC
   `learned_on`, so an evening one may read a day late. There are too few users for a
   backfill to be worth it.

## Scenarios (the test cases)

- **Travel.** A session started in New York says EDT on its Now line. A memory made in
  Montana shows its time in whatever zone it is viewed from.
- **A reminder while travelling.** "Taxes due Oct 15", saved in Montana, comes up on
  Oct 15 in New York, and in Hawaii too.
- **A month.** "Launch in October" is `2026-10`, and it never becomes a day.
- **Across midnight.** A memory written at 11:50 pm local belongs to that local day,
  even though it is already the next day in UTC.
- **Daylight saving.** The zone is a name (`America/Denver`), not an offset, so the
  change in March and November is handled by the zone rules.
- **A server on UTC.** Set `timeZone` in the config, and every local date follows it.

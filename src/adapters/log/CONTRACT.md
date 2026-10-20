# `log/` — CONTRACT

*This contract guides the work; it doesn't limit it. Anything here, RESOLVED items included, can be raised for discussion at any time and revised when there's a better way (constitution line 13).*

*Added 2026-09-30, from the owner's ask of that day: "log files of everything that happened,
errors, etc, as long as we don't make it insanely verbose and just keep it for past 7 days or
so." Working defaults throughout, held lightly: the allowlist in particular is meant to be
edited.*

## 1. Purpose

The order of events, for a week, from the four processes whose event rings die with them —
the hook, the turn-end worker, the nightly run and the MCP server. The durable `events` table
keeps the facts doctor and the dashboard read; this keeps what happened, in order, so "what
happened at that Stop" has an answer after the process is gone (constitution 11, 16).

No brain analog: it is an instrument, like `fired.ts`, not a memory.

## 2. Where it lives, and why

`<dataDir>/sessions/log/<YYYY-MM-DD>.log`, the date the person's day in the store's zone
(`resolveZone(config.timeZone)`, which is `Store#zone`). Inside `sessions/` because that
entry's own note says new host state goes there: a new top-level name would make an older
build's `assertLayout()` refuse the store. Not backed up (`sessions` is `backup: false`).

A shared leaf beside `sessions.ts` rather than inside one adapter, because three adapters use
it (`claude-code/`, `mcp/`, `cli/`) and adapters do not import each other
(`mcp/INTERFACE-GAPS.md` §7). The core is unchanged: its existing `onEvent` callback is the
sink interface, and the entry points wire it.

## 3. What a line is

One JSON object per line: `at` (ISO instant), `proc` (`hook:<event>`, `worker`, `nightly`,
`mcp`), `pid`, `session` (or null), `name`, `ref` (when the event has one), `data`. Each
process adds `process.start` and `process.end` (`ms`, `reason`; for a throw, the error's
class, code and top source location in this package). A UserPromptSubmit hook, the most
frequent, writes only its end; everywhere else a start with no end is the evidence a
process was killed.

## 4. What goes in (working default)

`LOGGED` in `index.ts`, and nothing else: every `*.failed`, `*.threw`, `*.standdown`; process
start and end; the turn's end (`adapter.boundary`, `adapter.ask`); write-ups and handoffs; the
nightly run's states and parts; wake renders and `rebrief`; the sleep cycle, the retention
pass and the worker's summary; refusals by name (`runner.refused`, `mcp.refused`). Per-prompt
recall and association detail, and the store's own bookkeeping, stay out.

## 5. Guarantees

1. **The store's content rule** (`store/CONTRACT.md` §5 G10): ids, hashes, counts, codes,
   kinds. The emitters are what keep to it; `clean` is a heuristic behind them, not a
   guarantee. It writes a string as its length (`[text:N]`) when it has a space, starts with
   `/` or `~`, contains `..`, or runs past 160 characters — which catches sentences, error
   messages and absolute paths. A single token still passes: a word, an email address, a URL,
   a relative path. So a model-typed value is admitted only where the emitter has checked it
   is an id (`mcp.write_up`'s `ref` is written only for a session the registry knows). An
   error is its class, its code and where; never its message.
2. **It never fails its caller.** Every write is swallowed.
3. **Observer writes nothing**, and neither does the MCP server in a directory set `off`. The
   log never creates a data dir, and the hook opens it only once the store has opened: a
   store this build refuses gets no lines (its stand-down marker, stderr and
   `systemMessage` say so).
4. **One append per line**, so four processes share a file without tearing a line.
5. **Seven days.** Files dated more than `LOG_DAYS` (7) before today are deleted beside the
   session registry's prune, at SessionStart. A file whose name is not a date is left alone.

## 6. Readers

`counterparts log [--date YYYY-MM-DD]` prints a day, oldest first: the dashboard's sentence for
the few names whose ring data matches their durable row (`LOG_NARRATED` in `cli/commands.ts`),
`key=value` for the rest. Doctor's `Log` line says where it is, how many days it holds, and how
many failures today.

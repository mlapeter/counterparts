# `log/` — NOTES

## 2026-09-30 — the first build

- **Measured before building:** a hermetic SessionStart, prompt, two Stops, SessionEnd and a
  worker run emit several dozen distinct names across the rings. The allowlist keeps about a
  dozen of them. The heavy ones left out are `store.*` (including
  `store.event.appended`, which fires once per durable row and would have doubled every row)
  and the per-prompt recall family.
- **Volume, measured in review:** a SessionStart and three prompt/Stop turns, with the
  worker's lines counted, came to 30 lines and 5,959 bytes — about 10–11 lines and ~2 KB a
  turn. The prompt's `process.start` was dropped after that (review of #286), one line a
  turn less: a prompt is the most frequent event, its end carries `ms`, and it only says
  `reason`. Stop, SessionStart, the worker, the nightly run and the server keep their start
  lines, because a start with no end is the evidence a process was killed.
- **`clean` is a guard on values, not a list of fields.** Emitters already keep to codes and
  counts; the guard is there so a future emitter's path or sentence reaches the file as
  `[text:N]`, not as itself. `/` is allowed in the middle of a value (for the error location,
  `adapters/claude-code/hooks.ts:123`); a leading `/` or `~`, and `..`, are not.
- **`errorFields` never reads a message.** For something thrown that is not an `Error` it
  writes the value's type (`error: "string"`, `code: "UNKNOWN"`) and no location.
- **The hook opens its log only after the store has opened** (review of #286). The first
  version opened it before, so a store this build refuses got a start line and an end by a
  throw — and since pruning lives in `noteSession`, which a refused store never reaches, those
  files were never pruned. Now a refused store gets nothing; its stand-down marker, stderr
  and `systemMessage` already say so. The adapter's events reach the log through a
  forwarding closure, like the server's.
- **`counterparts log` narrates only `LOG_NARRATED`** (`cli/commands.ts`): `adapter.boundary`,
  `adapter.ask`, `adapter.wake.injected` — each emitted by `hooks.ts#record`, so the ring data
  IS the durable payload — and the two new rows. Every other name prints `key=value`. The
  dashboard's sentences read durable payloads, and on ring data some state false facts
  (`handoff.written` from the ring said "showing for 0 days"). Chosen over "sentence then
  key=value" to keep one line short; a name joins the list once its ring data is checked.
- **`clean` lets a single token through** — a word, an email, a URL, a relative path. So the
  one model-typed value that reached a line, `mcp.write_up`'s `ref` (the `writeUp` argument),
  is now written only for a session the registry knows (`isSessionId` and `readSession`).
  `isSessionId` alone was not enough: `SecretWordBravo` passes it.
- **Bun's `rmSync(dir, { force: true })` throws on a directory**, empty or not (measured,
  bun 1.3.10), so `pruneSessions` cannot remove `sessions/log/`. The test pins it with the
  directory's mtime set a month back.
- **The MCP server opens its log after the store**, because the store is what resolves the
  directory; the counterpart's `onEvent` is a forwarding closure until then. Events emitted
  while the store opens are not logged (none of them is on the list unless it fails, and a
  failure there throws).
- **`process.end`'s `reason`** is the process's own word: the hook's `HookResult.reason`, the
  worker's `RunReport.reason`, the night run's state (its own reason goes in `why`), and
  `stdin-closed` for the server.
- **A new `localTime` in `core/time.ts`** (`HH:MM:SS`, 24-hour) for `counterparts log`: the
  date is the file's, and seconds are what tell two lines apart.
- **`runner.steps` (2026-10-30).** A worker's `runner.coverage`, `runner.snapshot` and
  `runner.sidebar` stay out of the file: they're emitted for tests and a hand run, and the
  allowlist never took them. What the file needed was where the time goes, so one row per run
  carries every step's wall ms instead of three rows carrying some. The read it answers:
  `claude-code/NOTES.md`, 2026-10-30.

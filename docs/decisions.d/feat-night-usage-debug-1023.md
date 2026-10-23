### Decided by the C1 builder, 2026-10-23, lightly held (what a night costs, and a debug switch)

- Mike's go via the roadmap session, 10-23: each night child's tokens (`input`, `output`, `cacheRead`,
  `cacheCreate`, `costUsd`) from its own `stream-json` `result` line go on the `dream.night` row and
  event as `usage`, per child that ran (`writer`, `dream`, `reflection`, `tags`) plus a `total`. Why:
  since `--no-session-persistence` (10-21) nothing showed what a night cost, and the Haiku tag child
  was never measured.
- Decided by the C1 builder: a child that ran and said no usage (stopped mid-stream, retried without
  the stream) is `null`, not zeros; a child not started has no key; `total` is null when no child
  said any. The catch-up's children are not counted (no stream is kept for them).
- Decided by the C1 builder: the parser (`childUsage`) moved from `tools/harness/usage.ts` into
  `claude-code/transcript.ts`, the module that reads the night's stream; the harness imports it.
- Decided by the C1 builder: `debug: { nightTranscripts }` in `claude-code.json`, off by default,
  keeps each night child's raw output under `<base>/debug/<date>/` for 7 days (0600 files, 0700
  folders), only beside a store in the package's own layout (`<base>/store`), as the default
  snapshots folder is. Pruned by the date folder's name at every night's start, switch on or off,
  only files named `<child>-nrn_….jsonl`; links and foreign files are left. Snapshots never carry it
  (they copy the store); `uninstall` counts `debug` as ours. Documented in CONTRIBUTING.md only.

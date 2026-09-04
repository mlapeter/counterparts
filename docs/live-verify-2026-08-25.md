# Live verification — MCP and CLI adapters — 2026-08-25

**What this is.** Per CLAUDE.md's definition of done ("verified live, not merged"),
`adapters/mcp/NOTES.md` and `adapters/cli/NOTES.md` both say the same thing: every
test runs against a temp store with a faked transport, and "nothing has spoken to a
real MCP client" / "the outstanding proof is one real snapshot of a real store,
restored and read." This is that proof. Every exercise below ran as a real OS
process (`bun run <bin>`) against a real, throwaway data directory — no imports of
adapter internals stand in for the process boundary, except where noted (seeding,
and the export round-trip, which call the real composition/module functions
directly because there is no CLI/MCP surface for those specific operations).

No memory body text appears anywhere below — only ids, counts, kinds, reasons, exit
codes, and byte lengths, per CLAUDE.md's logging rule and the task's redaction
requirement.

## Environment

- `bun --version`: **1.3.10** (macOS arm64, Darwin 23.1.0)
- `node --version` present on the machine: 20.19.1, **not exercised** — every run
  used `~/.bun/bin/bun` per this repo's CLAUDE.md toolchain rule. `package.json`
  declares `"engines": { "node": ">=22" }`; the Node driver path in
  `src/core/store/db.ts` was not live-tested this session.
- Data dirs: all under
  a session scratchpad outside this repo (`data/*`), created fresh,
  never under `~/.bansai` or `~/.claude-engram`. `COUNTERPARTS_DATA_DIR` set
  explicitly for every run; `assertSafeDataDir`'s forbidden-root guard was never
  approached, let alone tripped.
- Primary store exercised: `data/store-1`, built by
  `scripts/seed.ts` (task 1), then driven through MCP (task 2) and the CLI
  (task 3) in sequence, so later exercises ran against a store that had already
  accreted real, mixed-origin state — not a fixture reset between tools.

## Task 1 — seeding a realistic store

Driver: `scratchpad/live-verify/scripts/seed.ts`, importing the real
`Counterpart` composition (`src/core/counterpart.ts`) via a `file://` URL import
(no adapter in front of it — this step is explicitly "the composition," not the
CLI or MCP surface). Ten drafts went through `submitSessionEnd()`, the same
authored front door `session_end` and the crash-fallback ultimately call, then
`sessionEnd()` ran a real boundary cycle (clock → decay → consolidate → prune →
dedup → versions → briefing).

| # | label | kind | notes | result |
|---|---|---|---|---|
| 1 | fact-1 | fact | | minted |
| 2 | person-1 | person | "Priya" | minted |
| 3 | entity-1 | entity | | minted |
| 4 | skill-1 | skill | | minted |
| 5 | place-1 | place | | minted |
| 6 | feeling-1 | fact | `feeling: {feeling, quote:"", subject:"self"}` | minted, emotion exemption applied |
| 7 | updates-original | fact | | minted |
| 8 | updates-revision | fact | `updates: <#7's id>` | minted, resolved (not a dangling declaration) |
| 9 | skill-2 | skill | | minted |
| 10 | person-2 | person | "Jordan" | minted |

**10/10 deposited, 0 refused.** `store.list().length` = 11 after seeding (10
memories + 1 schema row, see below). `sessionEnd()`'s cycle report shows all seven
phases at `status: "ran"` or `"ran-nothing-found"` (never `"skipped"` or an error
status) — briefing included.

**Entity birth.** `c.schemas.mention({ name: "Priya", kind: "person", ... })`
returned `{ ok: true, reason: "born", id: "sch_53849aae7517" }`. **Finding, not a
bug:** grepping `src/adapters/mcp/` and `src/adapters/cli/` for any call to
`schemas.mention()` turns up nothing outside `test/`. Neither the MCP tool
registry nor any CLI command reaches `Schemas.mention()` — birth-by-mention is a
core primitive with no exercised adapter path as of this run. `schemas/CONTRACT.md`
says birth is "by mention" without saying who calls it; this session found no host
wiring that does. Exercised here by calling the composition directly, as task 1
instructed, not as a claim that any shipped surface can trigger it.

## Task 2 — MCP handshake, live

Driver: `scripts/mcp-live.ts`, which spawns `bun run src/adapters/mcp/bin/serve.ts
--session <id> --scope <dir> --owner` as a **real child process** (`Bun.spawn`,
`stdin`/`stdout` pipes) and speaks newline-delimited JSON-RPC 2.0 at it exactly as
`protocol.ts` documents the wire. Full frame log (redacted): `out/mcp-live-1.json`
(19 frames). A second, narrower run (`scripts/mcp-negotiate.ts`) checked version
negotiation in isolation against a fresh store.

| exchange | pass/fail | detail |
|---|---|---|
| `initialize` (2025-06-18) | **pass** | echoed `2025-06-18`, capabilities.tools present, serverInfo.name `counterparts` |
| unsupported version (`2099-01-01`) | **pass** | answered `2025-06-18` (newest supported) — negotiates down, no hard failure |
| `notifications/initialized` | **pass** | no response frame emitted (notification semantics honored) |
| `tools/list` | **pass** | returned exactly `note, recall, status, session_end` |
| `tools/call note` | **pass** | `stored: true`, `reason: "minted"`, `salienceLifted: true` |
| `tools/call recall` (question) | **pass** | `path: "question"`, 3 memories returned with tier labels (`vivid`/`quiet`) |
| `tools/call status` | **pass** | live/archived/superseded counts, by-kind/by-band symmetry, clock, stance all present |
| `tools/call session_end`, bound session | **pass** | `deposited: 1, refused: 0`, real memory id minted |
| `tools/call session_end`, **mismatched session id** | **pass** | refused with `reason: "session-mismatch"`, `isError: true`, **zero** memories landed |
| malformed JSON on the wire | **pass** | JSON-RPC error `-32700` (PARSE_ERROR), `id: null` |
| unknown method (`no/such/method`) | **pass** | JSON-RPC error `-32601` (METHOD_NOT_FOUND) |

**9/9 scripted exchanges passed, plus the standalone negotiation check.** Server
process exited cleanly on `stdin.end()` + `kill()`; **stderr was empty** across the
whole run (`stderrLen: 0`). Spot-checked the frame log for leaked memory body text
(scanned every frame for a non-redacted `"body"`/`"content"`/`"text"` value) —
none found; the client-side redaction (masking those keys before logging) and the
server's own recall payload were both clean.

## Task 3 — CLI, live

Driver: the real binary, `bun run src/adapters/cli/bin/counterparts.ts <command>`,
run as a genuine child process every time (via Bash, and via `expect` for the two
exercises that need a real TTY for the interactive prompt). Store: `data/store-1`
(post-MCP state, 13 live rows before removal).

| command | pass/fail | exit | notes |
|---|---|---|---|
| `status` | **pass** | 0 | 13 live, 0 archived/superseded, layout table printed |
| `export --plaintext` | **pass** | 0 | 14 files, 102338 bytes; `prose/`, `operational.sqlite` present and readable |
| `export --passphrase` | **pass** | 0 | 14 files, same byte count; `.cpx` blob + README |
| passphrase round-trip (`decryptBundle`, real crypto) | **pass** | — | restored 14 files, **byte-identical** to the plaintext export (diff: 0 files); wrong passphrase correctly fails to decrypt |
| `backup --out <dir>` (quiescent store) | **pass** | 0 | `prose` (13 files), `versions` (0), `spans` (4) via file-tree; `operational.sqlite` via `VACUUM INTO` |
| open backup DB and query it | **pass** | — | opened with `bun:sqlite` directly (`readonly: true`); `SELECT ... FROM memories` returned 13 rows matching store count; `meta` table intact (schemaVersion, livedDay, sleep markers, etc.) |
| `verify` | **pass** | 0 | 13 canonical rows, 13 re-indexed, 0 skipped, "Not recomputed: embeddings" declared with owner+repair, `accounted === canonical` |
| `remove <id>` dry run (no `--confirm`) | **pass** | 0 | printed chase plan + 6 overlap ids (ids only, no bodies), "Dry run. Nothing has changed." |
| `remove <id> --confirm`, no TTY | **pass** | 2 (refused) | correctly refuses: "removal requires an interactive confirmation and this console has no prompt" |
| `remove <id> --confirm`, real TTY, **wrong typed id** | **pass** | 0 | "refused: the confirmation did not match. Nothing has changed." — store untouched |
| `remove <id> --confirm`, real TTY, **correct typed id** | **pass** | 0 | 4 removal-record stages appended (`requested→dark→chased→complete`); chased `prose, versions, cache`; `operational.memories/edges/prospective` correctly left as deny-list (unchasable) rather than silently dropped |
| observable effect of removal | **pass** | — | `status` afterward: live 13→12, "Removed: 1" with date+id+actor (no body); `verify` afterward: "Skipped as removed (deny-list): 1", still `accounted === canonical`; the `.md` file physically gone from `prose/memories/` |
| `backup` **while a writer holds an open transaction** | **FAIL** | 3 | see finding below |
| `status` while a writer holds an open transaction | pass (degraded) | 3 | caught and reported, see finding below |

### FAILED LIVE: `backup` throws under write contention, violating its own "never throws" contract

**Repro:**
```
# terminal / process A — a real bun:sqlite connection holding a genuine
# uncommitted write transaction on the store's operational.sqlite:
bun run scripts/hold-txn.ts <dataDir>/operational.sqlite 5000
#  -> db.exec("BEGIN IMMEDIATE"); db.exec("INSERT ... INTO meta ...");
#     Bun.sleepSync(5000); db.exec("COMMIT");

# terminal / process B, ~1s later, while A's transaction is still open:
bun run src/adapters/cli/bin/counterparts.ts backup --dir <dataDir> --out <target>
```
**Observed:** exit code **3**, stdout **empty** (no `"Snapshot: ..."` header ever
printed — meaning the crash happens before `commands.ts`'s `backupCommand` reaches
its own body), stderr is the bare driver message `database is locked`, no
`out/backups-concurrent*` directory is ever created (clean crash, not a partial
write). Reproduced twice, both identical. Store integrity unaffected — `status`
immediately after reads normally.

**Root cause, read from source, not guessed:**
- No SQLite connection anywhere in this package sets `busy_timeout`
  (`grep -rn "busy_timeout" src` returns nothing), and `src/core/store/db.ts`
  sets `journal_mode = DELETE` (rollback journal, not WAL) — so a second
  connection hitting a held write lock gets `SQLITE_BUSY` immediately, with
  no retry window.
- `Store`'s constructor (`src/core/store/index.ts:266-306`) runs an
  **unconditional write transaction** — `this.ops.transaction(() => { ... INSERT
  OR IGNORE INTO meta ... })` (lines 287-292) — **even when `observer: true`**.
  There is no stance check before this write; `assertWritable()` only guards
  `mutate()` calls made *after* construction, not this seed step.
- `adapters/cli/commands.ts:384`, `backupCommand`, calls
  `Store.open({ dir, observer: true })` **outside any try/catch** (the
  surrounding `try { ... } finally { store.close(); }` starts on the next line).
  When that constructor's write hits the concurrent lock, the exception is
  uncaught inside `commands.ts`, propagates through `run()`, and is caught only
  by the top-level generic handler in `bin/counterparts.ts` (`process.exit(3)`
  after printing the bare error) — never reaching `snapshot()`'s own careful
  try/catch (`src/adapters/cli/snapshot.ts`), which *would* have turned this
  into a graceful `SnapshotReport.errors` row.

This directly contradicts CONTRACT §5 guarantee 8 for `adapters/cli/`: **"Backups
never leave the machine and never throw — a backup problem must not block a
consolidation cycle."** As built, a backup started while any other process (or a
future in-process writer) holds an open write transaction on `operational.sqlite`
**does throw**, uncaught, at `Store.open()` — before `snapshot()` is ever reached.

The same root cause reaches `status` too (`commands.ts:215`, inside a try/catch
there, so it degrades to `"could not open the store: database is locked"` at exit
3 rather than crashing bare) — meaning any `Store.open({ observer: true })` call,
i.e. every nominally read-only CLI/adapter entry point, is exposed to the same
contention window. `backup` is the one whose own contract explicitly promises
immunity to exactly this class of failure, which is why it is filed as the
headline failure and `status`'s milder version as a related note rather than a
second independent bug.

**Not fixed here** — this session is report-only; other agents hold the write
fence tonight.

## "Verified live" vs "failed live"

**Verified live** (real process, real store, observed effect, no fix needed):
- Seeding 10 memories across 5 kinds + 1 feeling + 1 `updates:` revision chain
  through the real `submitSessionEnd` → `sessionEnd()` boundary cycle.
- MCP: real stdio child process, `initialize`, version negotiation (both
  supported and unsupported), `notifications/initialized`, `tools/list`, `note`,
  `recall`, `status`, `session_end` (bound and session-mismatched), one malformed
  JSON-RPC frame, one unknown method. 9/9 scripted exchanges + 1 standalone
  negotiation check, all pass, zero stderr, zero leaked memory body text observed
  in the frame log.
- CLI: `status`, `export --plaintext`, `export --passphrase` with a real
  crypto round-trip (byte-identical restore, wrong-passphrase rejection),
  `backup` (quiescent store) with the resulting DB opened and queried directly,
  `verify`, and the full `remove` ceremony — dry run, no-TTY refusal, real-TTY
  wrong-id refusal, real-TTY correct-id removal with observable effects in
  `status`/`verify`/the filesystem.

**Failed live:**
- `counterparts backup --dir <dir> --out <dir>`, run while another process holds
  an open write transaction on `operational.sqlite`: throws uncaught
  (`database is locked`, exit 3, empty stdout), instead of the graceful
  `SnapshotReport.errors` failure CONTRACT §5 guarantee 8 promises. Root cause is
  `Store`'s constructor performing an unconditional write even under
  `observer: true` (`src/core/store/index.ts:287-292`), combined with no
  `busy_timeout` anywhere and an unguarded `Store.open()` call in
  `backupCommand` (`src/adapters/cli/commands.ts:384`). `status` shares the root
  cause but degrades more gracefully (caught, reported, still exits non-zero).

**Not exercised, and not claimed:** the Node (`node:sqlite`) driver path; any
host actually wiring `schemas.mention()` to a live adapter (none exists to test).

Scripts, raw frame logs, and export/backup artifacts from this session live in a
session scratchpad outside this repo (scratch, not part of this repo).

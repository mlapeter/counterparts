# Launch status — the session scoreboard

*Opened 2026-09-04 by the launch session's inventory owner. It reconciles
`docs/BUILD-STATUS.md` (2026-08-25, 22 PRs stale) with `docs/PARALLEL-RUN-STATUS.md`
(the living record) into one page, and is the file later workstreams append to:
scores, open issues, spend, NEEDS-OWNER.*

**Rule for this file: every number is copied from command output run in this session, or
cites `file:line`. A number taken from another document says which document. Nothing
here is claimed from memory.**

---

## A. Snapshot

| | |
|---|---|
| Date | 2026-09-04 |
| Branch this was written on | `launch/inventory`, off master `55c12bc` |
| master commit | `55c12bc846a33bfc3d9cbb36100d5c76d68ddcc6` — 2026-09-04 12:39:02 -0600, "STATUS: #29/#30 wake element dates and rebrief…" |
| History | 182 commits on master, 30 merge-commits from pull requests (`git log --oneline master \| wc -l`; `--grep="Merge pull request" \| wc -l`) |
| Suite | **1443 pass, 0 fail, 19,300 `expect()` calls, 23 files, 8.51 s** — `bun test` under bun 1.3.10, `COUNTERPARTS_DATA_DIR` pointed at a scratch dir, exit 0 |
| Typecheck | `npx tsc --noEmit` → **exit 0, zero lines of output**, TypeScript 5.9.3 |
| Node on this machine | v20.19.1 |
| bun | 1.3.10 (`~/.bun/bin/bun`) |

Suite count over time, for the record: 854 (`docs/BUILD-STATUS.md`, 2026-08-25) → 1239
(PARALLEL-RUN-STATUS, day 0) → 1411 (PARALLEL-RUN-STATUS, after the 2026-09-04 merges) →
1431 (`docs/launch-prompt-2026-09-03.md`) → **1443 measured here**.

Guardrail note for anyone reproducing this page: every invocation below passed an explicit
`--dir` under the session scratchpad. No command in this session read, wrote, listed or
resolved `~/.counterparts`, `~/.bansai`, `~/.claude-engram`, `~/.memory-ab`,
`~/counterparts-parallel-run` or `~/counterparts-backups`. `src/adapters/mcp/bin/serve.ts`,
`claude-code/bin/hook.ts` and `claude-code/bin/runner.ts` were **not run**, because all
three hard-code `CONFIG_PATH = join(homedir(), ".counterparts", "claude-code.json")` with
no override (`serve.ts:43`, `hook.ts:39`, `runner.ts:56`) and `serve.ts:104` calls
`questionEmbedder()` on that default. The MCP probe in §C used `openServer()` directly
instead.

---

## B. Verified live by the parallel run — carried forward, not re-verified here

Evidence lives in `docs/PARALLEL-RUN-STATUS.md`; this table is the index.

| Item | Evidence |
|---|---|
| MCP client handshake | The `counterparts` server registered and used daily; five tools — `note`, `recall`, `status`, `session_end`, `chapter` (PARALLEL-RUN-STATUS day-0 table; `chapter` added by PR #26) |
| Hooks inside real Claude Code sessions | All five events (SessionStart, UserPromptSubmit, Stop, SessionEnd, PreCompact), two days (day-0 log; day-1 entry) |
| Interpret client's real API calls | Day-0 sweeps ("four sweeps ran once the credentials file landed") and the sample replay, record `run_6530ad2ee770`, harness `replay/2`, exit 0 |
| `backup` against the real store | 2026-09-04 (day-1 entry) |
| Migration confidentiality mapping | Day 0 dry run on the live store: 26 redactions (19 google-api-key), 10 floor refusals named; `--apply` with `source_readonly.identical: true` |

---

## C. Verified or refuted in this session

All three items ran against temp stores under the session scratchpad, through the real
entry scripts where the task named one.

### C1. `export` and `remove` through `src/adapters/cli/bin/counterparts.ts` — VERIFIED

**The store.** Not a test fixture. Built by a script that opens `Counterpart` on a fresh
temp dir and calls the authored door 26 times — `submitJot({content, kind, claimed: 0.6})`
with `session: "seed-session"` — plus one `appendEpisode`. No API key, no interpreter, no
embedder. Result: `deposited: 26 of 26`, `episode appended: true epi_2b9211c93b81 chapter 1`.

**`status` before.** `Live memories: 27 archived: 0 superseded: 0` /
`by kind: self 4 person 3 entity 3 skill 4 place 4 fact 9` / `by band: episodic 27`.
27 and `self 4` on 26 memories and 1 episode — see §I1, a bug found here.

**`export --plaintext`, exit 0:**

```
Exported 28 files (130800 bytes) to …/w1/export-plain
Mode: plaintext. Unencrypted, at the owner's explicit request. Prose is readable in any editor.
```

On disk: 29 files, 228K. The set is `README.md` + `operational.sqlite` +
`prose/episodes/epi_2b9211c93b81.md` + 26 `prose/memories/mem_*.md`. The reported count
(28) excludes the generated `README.md`; the README inside the export states the same 28.
`spans/`, `versions/` and `cache/` are **not** in the export. `cache/` is excluded on
purpose and the export README says so; `spans/` is `backup: true` in the store's LAYOUT
(`src/core/store/paths.ts` LAYOUT entry "spans") and is absent from the export with no
line saying so — flagged in §I3, not resolved here.

A prose file is plain Markdown with a YAML header carrying `id`, `type`, `learned`,
`bornDay` and a `payload` JSON line; the body is the memory's own text.

**`export --passphrase …`, exit 0:** `Mode: encrypted. Encrypted with aes-256-gcm under a
key derived from your passphrase.` Two files: `counterparts-export.cpx` 14,004 B and
`README.md` 523 B.

**`export` with neither flag:** exit 2 —
`export refuses to choose for you: pass --passphrase <secret> to encrypt, or --plaintext…`.

**`remove` dry run** (no `--confirm`), exit 0: printed the six plan surfaces
(`prose: 1`, `versions: 0`, `edges: 0`, `prospective: 0`, `operational rows: 1`,
`cache: 1`), then 19 contamination ids (ids only, no text — includes `epi_2b9211c93b81`),
then `Dry run. Nothing has changed.`

**`remove --confirm` non-interactively** (stdin `/dev/null`), exit 2:
`refused: removal requires an interactive confirmation and this console has no prompt.`
That is the design — `bin/counterparts.ts:41` offers `prompt` only when
`process.stdin.isTTY`.

**`remove --confirm` under a real PTY** (driven with `expect`), exit 0:

```
  cli.removal.stage {"stage":"requested","target":"mem_c0a55a9a1d31"}
  cli.removal.stage {"stage":"dark","target":"mem_c0a55a9a1d31"}
  cli.removal.stage {"stage":"chased","target":"mem_c0a55a9a1d31"}
  cli.removal.stage {"stage":"complete","target":"mem_c0a55a9a1d31"}
  cli.removal.complete {"target":"…","chased":8,"unchased":0,"contamination":19}

Removed mem_c0a55a9a1d31.
  chased: prose, versions, operational.edges(0), operational.prospective(0),
          operational.gate_session(0), operational.memories(1, tombstoned),
          operational.versions(0, tombstoned), cache
  unchased (dark via the deny-list, never silently dropped): nothing
  removal record: 4 stages appended
```

**The directory after.** `prose/memories/` 25 files (was 26). `status` reads
`Live memories: 26` and `Removed: 1 / 2026-09-04 mem_c0a55a9a1d31 by owner`. The removed
memory's text does not appear anywhere under the store (`grep -rl`) — but this memory was
seeded with `submitJot` alone, so its words never entered the span buffer; the probe below
is the one that tests that path. `dashboard browse
--id mem_c0a55a9a1d31` renders `[removed by the owner] mem_c0a55a9a1d31` — the line
survives, the content does not. `strings operational.sqlite | grep -c mem_c0a55a9a1d31`
→ 8: the stripped lineage rows, the tombstone and the four-stage record that
`src/adapters/cli/INTERFACE-GAPS.md` §1 says survive by design. Not decoded per table.

**Second removal, the residue probe** — a note taken the way the MCP `note` tool takes one
(`captureJot` first so the words ride the span buffer, then `submitJot` claiming that span
by hash; `server.ts:337-355`). Before removal the marker text was in
`store/spans/<scope>/jots.jsonl` and `store/prose/memories/mem_e335e7d51d6f.md`. After a
successful PTY removal (`chased: 8, unchased: 0`), the prose is gone and
**`store/spans/<scope>/jots.jsonl` still holds the removed memory's verbatim text.**
See §I2 — this is a bug, filed with a repro.

**Verdict: `export` VERIFIED (three modes), `remove` VERIFIED end to end through the real
executable, with one defect found (§I2) and one reporting gap (§I3).**

### C2. CLI §7 — an observer mints an absent store at open — REFUTED (already closed)

`src/adapters/cli/INTERFACE-GAPS.md` §7 says CLOSED 2026-08-26. `docs/BUILD-STATUS.md`
("CLI §7 — an observer still MINTS an absent store at open") and the launch prompt
("Still unverified live: … CLI §7") are both stale on this. Confirmed by running:

| Command | stdout | exit | directory after |
|---|---|---|---|
| `counterparts status --dir <empty dir>` | `No store at <dir>. Run 'counterparts init' to create one.` | 0 | unchanged — `find` returns only the dir itself |
| `dashboard.ts status --dir <empty dir>` | same sentence | 0 | unchanged |

Nothing was minted, not even a `cache/` container. Code: `commands.ts:246-252` guards with
`storeExists` for the friendlier sentence; the store's own refusal is
`STORE_UNINITIALIZED` thrown before the first `mkdirSync`; `dashboard/bin/dashboard.ts:128`
catches exactly that code.

**Verdict: CLOSED. The gap does not exist in the current code.**

### C3. Replay §2a — authored-path gate records — CONFIRMED STILL OPEN

Determined from code and tests; the replay was not run.

- `src/core/remember/proposals.ts:256-262` — `GateVerdict`'s failure arm is
  `{ ok: false; gate: string; reason: string; refusedByDesign?: boolean }`. There is no
  field for `encode/`'s `GateRecord[]`, so per-gate statuses, hedge counts, alias verdicts
  and secret families cannot cross back.
- `src/core/counterpart.ts:1458-1476` — `deposit()`'s refusal arm calls
  `this.emit("counterpart.deposit.refused", …)`; the success arm calls
  `this.emit("counterpart.deposit", …)`. Neither calls `store.appendEvent`.
- `src/core/counterpart.ts:1829-1843` — `emit()` writes to an in-process ring plus an
  optional `onEvent` callback. Nothing durable.
- Contrast, the sweep path: `src/core/counterpart.ts:1618-1622` writes a durable
  `gate.chunk` row via `this.store.appendEvent({ … dedupKey: "gate.chunk:…" })`.
  `GATE_CHUNK_EVENT` is declared at `counterpart.ts:101`; `test/gate-records.test.ts`
  pins its four properties.
- `tools/replay/INTERFACE-GAPS.md` §2a states the gap and its reason unchanged, including
  why a third durable event name is not being minted yet (the dashboard's
  `DURABLE_EVENT_NAMES` registry, `src/adapters/dashboard/registries.ts`, does not know
  `gate.chunk` or `band.transition`).

**Verdict: OPEN, unchanged since it was filed. No durable gate record exists for the
authored door; the only two facts (accepted / refused-with-a-reason) ride in-process
events.**

### C4. Side evidence gathered while verifying the above

`openServer({dir, embedder: null})` driven directly (no config read, no network):

- `recall` returned `"semantic": "embedder-off"`, `"considered": 24`, `"storeSize": 26`,
  `"returned": 6` with six lexically-matched memories. Lexical degradation confirmed
  working, and it names itself — to the model.
- `status` returned `"live": 25, "journal": 1` plus
  `"counts": "Every number above is MEMORIES. \`journal\` is the first-person episodes
  those memories were made from…"`. The MCP census separates the journal correctly. The
  CLI's does not (§I1).

---

## D. Still unverified — named

1. **Node.** Nothing in this session ran under Node. `src/core/store/db.ts:74`: "node:sqlite
   landed in Node 22 (behind a flag) and is on by default from 23.4." This machine has Node
   v20.19.1, so the Node path cannot be exercised here at all. Every number on this page is
   from bun 1.3.10. NEEDS-OWNER (§G2).
2. **`npm pack` / a stranger's install.** Not attempted, because there is nothing to pack —
   see §E-W1(5). Nobody has ever installed Counterparts from the docs on a machine without
   the repo.
3. **`serve.ts`, `hook.ts`, `runner.ts` under a relocated config.** Not run; the config path
   has no override (§G1).
4. **Removal residue in `versions/`** — the probe's memory had no superseded versions
   (`versions: 0` in both plans), so the version-file chase never fired against real files.
5. **The replay harness against the corpus** — not run this session (day-0 sample only;
   the prompt forbids re-running it).
6. **`self.enumerate` after removing a protected element** — `INTERFACE-GAPS.md` §1 says a
   removed protected element renders `[removed]`; the seeded store had zero protected rows
   (`Permanent … 0`), so that path was not exercised.

---

## E. Known blockers, by workstream

### W1 — install / packaging

1. **The default data dir is `~/.counterparts` itself, and the hook config lives inside it.**
   Confirmed in code and reproduced.
   - `src/core/store/paths.ts:44-56` — `dataDir()` resolves `COUNTERPARTS_DATA_DIR`, else
     `join(homedir(), ".counterparts")`.
   - `src/core/store/paths.ts:68-113` — `LAYOUT` classifies exactly seven top-level names:
     `prose`, `versions`, `operational.sqlite` (prefix), `cache`, `spans`, `tmp`,
     `sessions`. `claude-code.json` is not among them.
   - `src/core/store/paths.ts:124-129` — `assertLayoutClassified` throws
     `LAYOUT_UNCLASSIFIED` on the first unclassified name; called from
     `src/core/store/index.ts:467-469`, invoked at `index.ts:413` inside the `Store`
     constructor. So the check runs at **open**, on every consumer.
   - Reproduced on a copy of the seeded store with `claude-code.json` placed inside it:
     `counterparts status --dir <that dir>` → `could not open the store:
     LAYOUT_UNCLASSIFIED {"name":"claude-code.json"}`, exit 3.
   - The console already teaches the workaround: `commands.ts:366-371` prints "Write the
     adapter's configuration BESIDE the store, never inside it" with the path
     `<dir>/../claude-code.json`. Nothing else does. The fix touches core `paths.ts`, which
     makes it NEEDS-OWNER during the run (§G3).

2. **The written install path does not exist.**
   - `README.md` is 37 lines. It contains no install steps, no command, and no mention of
     `dataDir`, `credentialsFile`, `COUNTERPARTS_DATA_DIR` or `sessions/`
     (`grep -n` for all four returns nothing). It says **"Status: pre-build"** and
     "Implementation starts after the owner's skeleton review."
   - Its License section says the license is "Deliberately undecided until packaging (owner
     decision 2026-08-25); `UNLICENSED` while the repo is private." The owner decided MIT on
     2026-09-03 (launch prompt, "the license is DECIDED"). The README contradicts the ruling.
   - **There is no QUICKSTART file.** `find . -iname "*quickstart*"` (excluding
     `node_modules`) returns nothing. The prompt's "the README and QUICKSTART say nothing
     about…" understates it: one is stale, the other does not exist.
   - **No embed key:** the claim "it degrades to lexical recall and says so" is half true.
     *Degrades to lexical:* confirmed — `openServer({embedder: null})` `recall` returned six
     memories (§C4). *Says so:* to the **model**, yes — the tool result carries
     `"semantic": "embedder-off"` (`src/adapters/mcp/server.ts:427`;
     `src/adapters/mcp/deliberate.ts:443-444`, where `SemanticSource` is a closed
     vocabulary documented at `deliberate.ts:207-210` and `recall/session.ts:280-304`).
     To a **human**, no: `counterparts status` prints no line about embeddings or vector
     coverage (`commands.ts:306-330`), and no document states it. Core's own comment is at
     `src/core/recall/index.ts:27` ("degrades to lexical-only rather than failing, contract
     §5 G1") and `recall/activate.ts:116-118` (`semanticDegraded`, "recorded rather than
     silent").

3. **The MCP server needs `COUNTERPARTS_DATA_DIR` in its env, and is launched from static
   config.**
   - `src/adapters/mcp/bin/serve.ts:45-52` names the env keys; `serve.ts:76-79` resolves
     `dir` as `--dir` flag, else `COUNTERPARTS_DATA_DIR`, else **absent**.
   - `src/adapters/mcp/index.ts:82` passes `dir` through only when present, so an absent
     `dir` falls back to `dataDir()` → `~/.counterparts` → blocker (1) at open.
   - The config file is read for credentials and the embedder only (`serve.ts:104-124`);
     its `dataDir` field is **not** used to locate the store. A host that sets one and not
     the other is named in `src/adapters/mcp/CONTRACT.md:152`.
   - Static-config consequence, from PARALLEL-RUN-STATUS ("Facts the day taught"): a session
     open across a merge keeps the old server until it restarts.

4. **The vector cache stores embeddings as JSON text.** Write sites:
   `src/core/store/cache.ts:241-248` (inside `indexDoc`) and `cache.ts:263-269`
   (`setEmbedding`), both `JSON.stringify(vec)` into
   `INSERT OR REPLACE INTO embeddings (memory_id, dim, vec)`. Read back as a string at
   `cache.ts:364` and `cache.ts:380`. Sizes are from PARALLEL-RUN-STATUS, not measured here:
   177.5 MB at ~13.9K vectors, ≈12.7 KB each vs ~4 KB as float32; nearest scan 590–1,040 ms.
   Irrelevant to a fresh install; a named debt for the docs' honesty.

5. **`package.json` ships nothing runnable.** Read directly:
   `bin`, `files`, `main`, `exports`, `module`, `types` are all **undefined**;
   `private: true`; `license: "UNLICENSED"`; `engines: {"node": ">=22"}`; `version: "0.0.0"`.
   `npm publish` refuses a private package; `npm pack` would ship the whole tree with no
   entry point.

### W2 — dashboard

Terminal-only today (`src/adapters/dashboard/bin/dashboard.ts` prints a string and exits;
`src/adapters/dashboard/NOTES.md` OQ1). Findings:

1. **`browse` renders episode rows as memories — REAL, reproduced.**
   `src/adapters/dashboard/browse.ts:79` iterates `store.list(filter)` where `filter` carries
   only `kind` and `archived` (`browse.ts:75-77`); `Store.list` is
   `SELECT id FROM memories …` (`src/core/store/index.ts:1200-1204`) and the `memories`
   table holds episodes too. On the seeded store, `dashboard browse --limit 40` printed
   `epi_2b9211c93b81` as a row with `kind self`, `band episodic`, strength 0.00, and the
   footer read `27 memories match live only; showing 27`. There were 26 memories.
2. **`stories` walks `store.list()` — REAL but not manifest here.**
   `src/adapters/dashboard/stories.ts:55-57` iterates `store.list()` and admits any row with
   `pressure > 0`. An episode row would qualify if it ever carried pressure. On the seeded
   store `stories` printed the empty-state sentence, so nothing was misrendered. Not proven
   impossible; lower severity than (1).
3. **The status line counts the journal apart from live memories — CONFIRMED CORRECT.**
   `src/adapters/dashboard/status.ts:66-72` documents the `journal` field;
   `status.ts:101-104` skips `isJournal(row)` before incrementing `live`. Output:
   `I am holding 26 memories, beside 1 journal entry that do not decay.` The nit is closed.
4. **NEW: the dashboard prints a raw stack trace for any store error except one.**
   `dashboard/bin/dashboard.ts:117-131` catches `STORE_UNINITIALIZED` and rethrows
   everything else; `bin` line 147-150 has no handler. Pointed at a data dir containing
   `claude-code.json`, it printed a nine-frame `StoreError: LAYOUT_UNCLASSIFIED` stack and
   exited 1, where the CLI printed one sentence and exited 3. Constitution 16.
   See §I4.

### W3 — repo-public prep

- README rewrite (see W1.2): status line, license line, and the whole install path.
- `LICENSE` file: absent from the repo root (`ls` shows `CLAUDE.md`, `CONSTITUTION.md`,
  `README.md`, `bun.lock`, `package.json`, `tsconfig.json`, `docs/`, `src/`, `test/`,
  `tools/`; `node_modules/` is untracked). MIT is decided; the file and the
  `package.json` field are both unwritten.
- `private: true` and `license: "UNLICENSED"` in `package.json` (W1.5).
- De-personalization: not surveyed this session. Note as a fact for the surveyor — the seeded
  store's prose payload records the absolute store path in `meta.origin.scope`, so any
  screenshot or export made from a demo store leaks the path it was built at.
- Git-history secrets scan: not run this session.

### W4 — marketing site

Not started. Consumes W2's screenshots and W3's settled claims. One claim already needs a
correction before it can be copied anywhere: `docs/ELI5.md` line "**cli** — the owner's
console. Status, backup, export, delete, and the one-off repairs" is accurate;
`README.md`'s "Status: pre-build" is not.

---

## F. Scores

Filled by the critics, not by builders. A blank row means the gauntlet has not run.
Pass = ≥8.5 with zero console errors and a clean claims audit.

| Round | Date | Cold-stranger (install + README) | Design-director (dashboard + site) | Claims auditor | Notes |
|---|---|---|---|---|---|
| 1 | — | — | — | — | — |
| 2 | — | — | — | — | — |
| 3 | — | — | — | — | — |
| 4 | — | — | — | — | — |

---

## G. NEEDS-OWNER

| # | Item | Why it waits |
|---|---|---|
| G1 | The three host entry points hard-code `CONFIG_PATH = ~/.counterparts/claude-code.json` with no flag or env override (`mcp/bin/serve.ts:43`, `claude-code/bin/hook.ts:39`, `claude-code/bin/runner.ts:56`). A clean-room install loop, and this session, cannot run them without redirecting `HOME`. Adding an override touches adapter entry points the live hooks execute. | The hooks run `~/counterparts` master directly. |
| G2 | **Node vs bun as the documented launch runtime.** `package.json` says `engines: node >=22`; `db.ts:74` says `node:sqlite` is behind a flag in 22 and default from 23.4. This machine runs Node **v20.19.1**, so the Node path was not exercised and cannot be here. Decide the documented floor (and whether Node is claimed at all at launch) before the README states one. | A claim nobody has run. |
| G3 | **The default-data-dir fix.** Making `~/.counterparts/claude-code.json` legal means changing `LAYOUT` or `dataDir()` in `src/core/store/paths.ts` — a **core** change, which alters the owner's live memory at the next hook event and restarts the parallel run's phase clock. | Core change during the run. |
| G4 | **Span-buffer residue after removal** (§I2). The fix adds a surface to `RemovalPlan` and a chase over `spans/` — `src/adapters/cli/removal.ts` is an adapter, but the span buffer is `remember/`'s and the guarantee is the CLI CONTRACT's §16 G15. Owner should say whether the near-term answer is a chase or an honest `unchasable` entry. | Touches a constitution-6/7 guarantee ("anything can be removed loudly"). |
| G5 | `private: true` blocks `npm publish`; `license: "UNLICENSED"` and the README's "Deliberately undecided" contradict the 2026-09-03 MIT ruling. Flipping any of these is staged-not-executed by the prompt's own rules, but the field values are edits someone must sanction. | Owner-only action list. |
| G6 | `backfill-claims --apply` on the live store — 20 rows qualify (PARALLEL-RUN-STATUS, PR #24). Still the owner's to run. | Pre-existing, carried forward. |

---

## H. Spend log

| Item | When | Estimate | Actual |
|---|---|---|---|
| Sample replay, 7 days, Opus + Voyage | **day 0, 2026-09-03** — not this session | $25–40 | ≈$16–20 by token volume (1.2M in / 0.3M out), record `run_6530ad2ee770`; console bill is the actual. Source: `docs/PARALLEL-RUN-STATUS.md` "Sample replay". Do not re-run. |
| This inventory session | 2026-09-04 | $0 | **$0.00.** No interpreter call, no embedder call, no network call of any kind. The seeded store was built through `submitJot` with no embedder; the MCP probe passed `embedder: null`. |
| Run, API side (embeddings + crash-fallback sweeps) | ongoing | dollars/day | per day, from `run.json` — the owner's daily |

---

## I. Open issues

### I1. `counterparts status` counts the journal as a live memory — NEW, found here

`src/adapters/cli/commands.ts` `statusCommand` iterates `store.list()` and increments `live`
for every row that is neither archived nor superseded (`commands.ts:276-290`). It never
calls `isJournal`. `src/core/sleep/types.ts:407-409` defines
`isJournal(row) => row.type === "episode"`, and PR #27 threaded it through decay, prune,
consolidate, dedup and the dashboard's census — but not through the CLI's.

**Repro.** Seed a temp store with 26 authored memories and one `appendEpisode`, then:

```
counterparts status --dir <dir>
  Live memories: 27   archived: 0   superseded: 0
    by kind: self 4  person 3  entity 3  skill 4  place 4  fact 9
    by band: episodic 27  semantic 0  identity 0
```

26 memories were seeded; three of them were kind `self`. The 27th, and the fourth `self`,
is `epi_2b9211c93b81`. The same store, same moment:

- `dashboard status` → "holding 26 memories, beside 1 journal entry that do not decay"
- MCP `status` tool → `"live": 25, "journal": 1` (after the removal in §C1)

So two of three census surfaces are right and the owner's own console is wrong. Adapter-only
fix (`commands.ts`), no core change. Cross-check for the day-2 watch on `storeSize` labels:
the MCP `recall` result reported `"storeSize": 26` on the same store where `status` reported
`live 25 / journal 1` — `storeSize` counts every live row, memories and journal together,
exactly as the day-2 watch predicted.

### I2. A removed memory's verbatim text survives in the span buffer — NEW, found here

`remove` reports `unchased … nothing`, and the words are still on disk.

**Repro.**

1. Take a note the way the MCP `note` tool does (`src/adapters/mcp/server.ts:337-355`):
   `captureJot({session, scope, text})` first, then
   `submitJot({content: text, …}, {session, scope, ownSpanHash})`.
   Marker text used: `ZQRESIDUEPROBE the culvert gate key is kept under the third fence
   post at Kestrel Barn.` → `mem_e335e7d51d6f`.
2. `grep -rl ZQRESIDUEPROBE <store>` → `store/spans/<scope>/jots.jsonl` and
   `store/prose/memories/mem_e335e7d51d6f.md`.
3. `counterparts remove mem_e335e7d51d6f --confirm --dir <store>` under a PTY, confirmed.
   Output: `chased: 8, unchased: 0`, `unchased (dark via the deny-list, never silently
   dropped): nothing`.
4. `grep -rl ZQRESIDUEPROBE <store>` → **`store/spans/<scope>/jots.jsonl`** (one line,
   the full text verbatim).

**Cause.** `src/adapters/cli/removal.ts:124-131` enumerates six surfaces — `prose`,
`versions`, `edges`, `prospective`, `operational rows`, `cache`. `spans/` is not one of
them, and `unchasable` is the hard-coded `[]` at `removal.ts:133-137` with a comment saying
the field stays so "the plan must always have a place to name what it cannot reach."
Nothing fills it for the span buffer, so the report is a silent partial success against the
CLI CONTRACT's §16 G15 as quoted in that same comment.

**Blast radius, measured.** `counterparts backup --dir <store> --out <dir>` on that same
store, after the removal, exit 0, reported `ok spans (file-tree, 4 files)` — and
`grep -rl ZQRESIDUEPROBE <backup>` returns
`<backup>/2026-09-04T20-34-53-940Z/spans/014abf0c4d26/jots.jsonl`. **A snapshot taken after
a removal carries the removed text.** `export` does not: `spans/` is outside its set (§C1),
confirmed by the same grep against the export directories.

What was *not* tested: whether the crash-fallback sweep could re-mint from the surviving
span. The deny-list makes the id unusable a second time (`src/adapters/cli/INTERFACE-GAPS.md`
§2), but no test was run against that span, so the re-mint question is open. What is
certain is the disk residue and the report that says there is none — "anything can be
removed loudly" (BUILD-STATUS gap 3's phrasing) is not true of a note that rode the buffer.

### I3. `export` drops `spans/` with no line saying so

`spans` is classified `backup: true` in LAYOUT and described there as "lived experience
awaiting encoding; not reconstructible." The export set is prose + `operational.sqlite`;
the export's generated README explains only the cache's exclusion. Either the omission is
intended and undocumented, or it is a gap in "the owner owns the data" (constitution 6).
Not resolved here; needs the CLI CONTRACT §5 read against `src/adapters/cli/export.ts`.

### I4. The dashboard prints a stack trace on any store error but `STORE_UNINITIALIZED`

See W2.4. `dashboard/bin/dashboard.ts:128` is the only catch; `LAYOUT_UNCLASSIFIED` — the
exact error a stranger following a wrong config placement will hit — escapes as nine frames
and exit 1.

### I5. Carried from `docs/BUILD-STATUS.md`, unresolved

- **No writer's lock** (`INTERFACE-GAPS.md` §4): between `remove`'s re-plan and its first
  record append there is a window a concurrent writer could use.
- **`versions/` in the backup set** (`INTERFACE-GAPS.md` §6): the CLI CONTRACT §5 G6 and the
  store's LAYOUT still disagree in writing; LAYOUT won in code.
- **Replay §1a's remainder**: the sweep intake accepts no `checks` field, so
  `ChunkInput.predictionChecks` is unfed on the fallback path
  (`tools/replay/INTERFACE-GAPS.md` §1a).
- **`DURABLE_EVENT_NAMES` does not know `gate.chunk` or `band.transition`**
  (`tools/replay/INTERFACE-GAPS.md` §2, "Still open"): `test/dashboard.test.ts`'s totality
  test passes today only because its fixture sweeps nothing and lives one day.

### I6. Documents that are now wrong

- `README.md` — "Status: pre-build", "Implementation starts after the owner's skeleton
  review", license "Deliberately undecided".
- `docs/BUILD-STATUS.md` — CLI §7 listed as open (closed 2026-08-26, re-verified §C2);
  gaps 1–4 listed as open (closed the same night per its own night-shift section); the
  "merged, not yet verified live" list is superseded by §B and §C.
- `src/adapters/cli/INTERFACE-GAPS.md` §8 — "Entity birth (`schemas.mention`) has no adapter
  path at all… `grep -rn "\.mention(" src/` returns NOTHING: not an adapter, and not the
  mint path either." It does now, at both mint sites:
  `src/core/counterpart.ts:1493` (`mentionFromProposal(proposal, \`deposit:${mint.id}\`)`, the
  authored door) and `counterpart.ts:1685` (`\`sweep:${chunk.index}\``, the fallback path),
  both landing on `this.schemas.mention({…})` at `counterpart.ts:1814`. `docs/BUILD-STATUS.md`'s
  night-shift section records the fix; §8 was never updated.
- `docs/module-map.md` — "Status: Pre-build skeleton" framing in `CLAUDE.md` and
  "no implementation exists until after the owner's skeleton check-in" in the map header.
- `CLAUDE.md` "## Status — Pre-build skeleton."

---

*Appended by later workstreams. Do not rewrite an earlier section's numbers; add a dated
entry instead.*

## 2026-09-04, round 1 — Wave 1 landed, first gauntlet run

*Appended by the launch session's coordinator after the inventory (§A–§I above). PRs are open
unless marked merged; merges wait on the owner's approval in conversation (the auto-mode
classifier blocks `gh pr merge` from the session).*

### Owner rulings (2026-09-04, in conversation)

- Dashboard: build a local **web** view following bansai's dashboard (pages overview / flow /
  memories / mind / health + the three.js brain) and its design decisions; the **glow** (tron)
  theme; terminal views stay. W2 started on `launch/w2-dashboard-web`.
- Runtime: **bun**. Node stays "untested" in every doc.
- Site: owner owns counterparts.ai (Namecheap), deploys on Vercel; **start fresh** (not the
  bansai-site skeleton), tron styling, content modeled on the best of engram.fyi and
  hippo-memory.com; styling may change later.
- Data-dir default: ruling requested — proposed fix is `dataDir()` → `~/.counterparts/store`
  (one line in `src/core/store/paths.ts` + the replaced `test/store.test.ts` assertion; trial-applied
  by W1: tsc clean, exactly one test changes). Live host unaffected (config and MCP env are explicit).

### Branches / PRs

| PR | Branch | What | Suite |
|---|---|---|---|
| #31 (merged) | `launch/inventory` | this file's §A–§I | 1443 / 0 |
| #32 | `launch/w1-install` | packaging (MIT, `bin` ×4, `exports`, `files`), `LICENSE`, `counterparts install`, `docs/QUICKSTART.md`, `tools/install-loop/run.sh` (23/23 PASS, 2 s), CLI `status` journal fix, MCP version string | 1455 / 0 |
| #33 | `launch/dashboard-fixes` | `browse`/`stories` skip the journal; every `StoreError` is one sentence | 1448 / 0 |
| #34 | `launch/w3-audit` | `docs/launch/repo-public-audit.md`, `tools/audit/` | docs |
| #35 | `launch/demo-seed` | `tools/demo/seed.ts` — a 30-lived-day synthetic store (130 memories, 2 contested beliefs, 16 chapters) for every public screenshot; `--empty` mode | 1472 / 0 |
| — | `fix/recall-first-memory` | CORE: the first memory in a fresh store is never returned by the `question` path (in progress) | — |
| — | `launch/test-home-guard` | bun test preload redirects `HOME` to a temp dir for the whole suite (in progress) | — |
| — | `launch/w2-dashboard-web` | the web dashboard (in progress) | — |

### Scores — round 1

| Critic | Score | Verdict |
|---|---|---|
| Cold-stranger (install + README), on `launch/w1-install` @ `fd1a7ee` | **4 / 10** | install to a working store 1 m 37 s; first successful note → recall 3 m 54 s and only via hand-written JSON-RPC after a second write. Report: session scratchpad `critic-cold-stranger-round1.md`. |
| Design-director | — | not yet run (W2 in progress) |
| Claims auditor | — | not yet run |

Cold-stranger ranked findings: (1) CRITICAL — at store size 1 the `question` recall path returns
`nothing-came, considered: 0` while `handle`/`ids` return the memory; a second unrelated write
makes the first recallable (core; `fix/recall-first-memory`). (2) CRITICAL — `install --dir`
writes the config beside the custom dir, but `hook.ts:39` / `runner.ts:56` read only
`~/.counterparts/claude-code.json`, so the hooks silently never find it (W1 round 2: config always
at the fixed path, `--dir` moves only the store). (3) MAJOR — §2's install command names
`counterparts.tgz`; `npm pack` produces `counterparts-0.1.0.tgz`, and the resulting ENOENT is the
one §10.4 attributes to relative paths (W1 round 2). (4) §7 "Check it" gives no way to store or
recall a memory from the shell (W1 round 2: `counterparts note` / `recall`). Also: the packaged
README links five files not in the package; the documented install tree shows `sessions/`,
which appears only after a hook fires; bun warns that its global bin dir is not on PATH.

### New findings since §I (all reproduced; none from impression)

- **I7 (core)** `learnedOn` and event `at` are wall-clock (`ProposalDraft` has no date; `store.put`
  defaults `today()`; `Store.open` takes no `now`), so a seeded or replayed store carries the run
  day on every element — every demo wake element reads "learned 2026-09-04". Kin of the migration
  finding (12,334 rows carrying the import day). NEEDS-OWNER: thread the injected clock through.
- **I8 (core)** A revised belief's successor is byte-identical to its challenger, and sleep's
  content-hash dedup merges it the same evening: `declared-revision-never-merged` names the
  predecessor, the successor has a fresh id, and `mem_` sorts before `sch_` in the tie-break. The
  `stories` view therefore ends "REVISED, becoming … [archived: merged]". Fires on both the belief
  and the current-state arms. NEEDS-OWNER.
- **I9 (dashboard)** `recall.decision`'s durable `ref` is a session id; `activity` resolves every
  ref as a memory id and renders `[no longer at this address] <session>`. W2 resolves refs by type.
- **I10 (cli)** `counterparts status` reads the stored `band` column, written only on a
  transition; the dashboard computes bands live. On the demo store: CLI episodic 144 / semantic 0
  / identity 15 vs dashboard 54 / 74 / 15. Adapter fix, queued for W1 round 3.
- **I11 (core, minor)** `Schemas` indexes at open and the identity core is minted after, so
  `addBelief` on the core in the same open returns `entity-unknown`.
- **I12 (design, not a bug)** identity promotion is kind-agnostic, so repeated high-claim facts
  reach the identity band and the wake's "Who I am" lane opens with them.

### Repo-public audit (PR #34) — headline

183 commits, 71 refs incl. 30 `refs/pull/N/head`, 1024 blobs / 28.5 MB, 0 skipped: **zero true
secrets**. De-personalization: 450 pattern hits / 77 files (mostly benign) plus 12 read-through
findings that matter. **History recommendation: publish from a fresh orphan root** — live-store
schema filenames sit in `docs/harvest/replay-baselines.md:276` at the root commit `3d8f2f8`, and
PR heads cannot be deleted by a user, so no squash or filter removes them once public.
NEEDS-OWNER. The fixture first name in `test/migrate.test.ts:98-99` is replaced regardless (W3 pt 2).

### Incident — disclosed

The demo-seeder agent's first (uncommitted) test called `Store.open` on a path under the real
`~/.counterparts` inside a `.not.toThrow()`, four runs before it caught itself. Likely result: an
empty store skeleton at `~/.counterparts/x/`, beside (not inside) the live `store/`. Owner asked
to check and delete. Mechanized answer: `launch/test-home-guard` (a preload that redirects `HOME`
for the whole suite). Root fact: `.counterparts` is not in `FORBIDDEN_ROOT_NAMES`.

### NEEDS-OWNER (additions to §G)

| # | Item |
|---|---|
| G7 | Approve merges: #32, #33, #34, #35 (adapters, docs, tools only). |
| G8 | Rule on the data-dir default (proposal above). |
| G9 | History: fresh orphan root vs flip this repo (audit §1). |
| G10 | Removal residue (§I2): honest `unchasable: spans` line now (adapter) vs a chase (core). |
| G11 | `fix/recall-first-memory` — core fix, review + approve when the PR opens. |
| G12 | I7 / I8 core findings — rule whether they are launch blockers (I8 spoils the flagship `stories` screenshot). |
| G13 | Check `~/.counterparts/x/` and delete if present. |

### Spend

$0.00 this session so far (no interpreter or embedder call by any agent; the critic ran with no keys).

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

## 2026-09-04, round 2 — the core fixes landed, the tree is public-ready except for images

*Appended by the coordinator after Wave 2's first landings. Master `c00cef9` at the time
of writing; suite on master **1513 pass / 1 skip / 0 fail** (the skip is the W1 loop's
first-memory test, un-skipped in the sync PR that follows). Merging rule adopted after #44:
the suite runs on a preview of master + branch before any merge, never on the branch alone.*

### Owner rulings since round 1

- **History stays as-is; this repo flips public** (the owner is fine with first names and
  business names existing in history). The fresh-root recommendation in the audit is
  withdrawn on that ruling. The fixture name was swapped anyway (#40).
- **Reviewed PRs may merge** on a standing approval for this session (the classifier
  still blocks an unapproved merge).
- **Data-dir default → `~/.counterparts/store`** approved and merged (#37).
- Still pending: the removal-residue option (§I2: A = honest `unchasable: spans` line now,
  adapter; B = a chase, core) and whether §I7/§I8 block the launch.

### Merged since round 1

| PR | What | Suite on the merge |
|---|---|---|
| #32 | W1 round 2 after the cold-stranger critic: `install --dir` writes the config at the hooks' one path and moves only the store; tarball command matches `npm pack`'s real filename; `counterparts note` / `recall` on the console (the MCP doors, `captureJot` + `submitJot` with `ownSpanHash`, `deliberateRecall`); `--help` exits 0; `files` ships ELI5, module-map and the loop; loop 25/26 with step 14 EXPECTED-FAIL until #38 | 1502 / 1 skip |
| #39 | Test HOME guard: `test/preload.ts` redirects `homedir()` to a temp dir for the whole suite via `mock.module("node:os")` (Bun fixes `homedir()` at startup and ignores a later `$HOME`, measured); fails closed; sweeps in a root `afterAll` (`process.on("exit")` does not fire under `bun test`, measured) | 1480 |
| #40 | Migration fixture's second person is invented; the harvest inventory counts schema files by kind | 1480 |
| #41 | G12 carry-forward declarations for #37 and #38, class IDENTICAL, recorded BEFORE merge: `surfaceSetHash()` = `800a9a9421cd969f` on master, both branches and `run.json` | docs |
| #42 | De-personalization of the working tree (session id, machine path, quoted live-store content, the owner's verbatim config, third-party PII descriptions, dated affect markers; every count kept); `CLAUDE.md` status current; BUILD-STATUS snapshot header; `docs/launch/flip-checklist.md` (12 owner-executes steps, names no redaction). Scanner 580/86 → 569/87, every remaining hit classified deliberate | 1480 |
| #43 | `counterparts verify` is a read-only observer census; `--rebuild` refuses to drop vectors it cannot recompute unless `--drop-vectors`; fails closed on an unreadable box 3 (from #37's review: a bare `verify` would otherwise have wiped the live store's ~13,700 vectors once the default resolved there) | 1506 / 1 skip |
| #37 | **CORE** — default data dir `~/.counterparts/store` (`DEFAULT_STORE_SUBDIR`); adversarial review MERGE WITH CHANGES, all three procedural and met (G12 record #41, HOME guard #39, `verify` guard #43). Live-host reach: none; the unreadable-config fallback moves from "no memory" to a correct read-only open | 1506 / 1 fail → |
| #44 | One-line test fix: #39 and #37 were each green alone; merged, `preload.test.ts` asserted the old default. Master red ~4 min | 1506 / 1 skip |
| #38 | **CORE** — first memory in a fresh store is cueable: `informativeness = log((N+df)/(2df))` is exactly 0 at `df = N = 1`, so every cue was dropped (`considered: 0`); `MIN_RARITY_STORE = 2` inside the log, bit-identical at N ≥ 2 (asserted); plus the review's cap — below `MIN_RARITY_STORE` nothing goes LOUD (`loudBlockedBy: cold-start-undiscriminating`), because at N=1 a note surfaced loudly on `the`/`that`/`and`/`not` alone (measured 5/5 → footnoted 5/5; inert at N=2). Hash still `800a9a9421cd969f` | 1513 / 1 skip |
| #45 | README rewritten for a cold reader (claims list in the PR); two screenshot slots for W2 | docs |

### Scores — round 1 stands; round 2 not yet run

The cold-stranger critic's round-1 ranked list is closed except for the two that were
fixed by #38 and the sync (items 1 and 4's second half). Round 2 of the cold-stranger runs
after the sync PR; design-director and claims auditor run after W2.

### New findings (reproduced by reviewers; core; NEEDS-OWNER)

- **I13** `df` counts `doc_tokens` rows while `storeSize` counts live `memories` rows, so
  `df > storeSize` is reachable (archived sibling; **superseded head**) and re-zeroes a rare
  token: revise your first memory on a fresh store and it goes dark again. A fix moves
  output on the live store → its own G12 declaration.
- **I14** Recall counts, indexes and DELIVERS journal (`epi_`) rows (an episode came back
  `quiet` on a question and `footnoted` ambient); the dashboard census skips them since
  #33, `recall/` does not. Kin of #27's ruling that the journal is not a memory.
- **I15** (tools) The run instrument's `--v2-data-dir` default is the base dir; its
  readers need the store dir. Pre-existing; the owner passes the flag explicitly.
- **I16** (src comment) `src/core/remember/tunables.ts:39` still carries a session id and
  a clock time; `CLAUDE.md`'s toolchain line still says "Target: Node … and Bun" (bun
  ruled). Both for a small docs/comments PR.
- **Day-0 wake is empty of content** (identity lane renders nothing until a boundary
  composes one); QUICKSTART no longer implies `--name` produces visible output. `self/`
  owner to look.

### Incident — disclosed

The round-1 cold-stranger critic ran with the real HOME (the harness refuses `HOME`
assignment in agent shells), so `counterparts-mcp` read the owner's live
`claude-code.json` (embedder on, credentials file named) while pointing at a scratch
store: its recall calls made a handful of Voyage embedding requests on the owner's key.
The text embedded was the critic's own invented notes; no store was touched. Documented as
QUICKSTART §10.4 and README rough edge 2. Root fact, twice today: the store is redirected
and the credentials are not.

### NEEDS-OWNER (running list; G1–G13 above)

| # | Item | State |
|---|---|---|
| G3 | default data dir | **closed** (#37) |
| G7 | merges | standing approval given; #32–#45 merged as reviewed |
| G8 | data-dir ruling | **closed** |
| G9 | history | **closed** — flip this repo |
| G10 | removal residue | open — A vs B |
| G11 | `fix/recall-first-memory` | **closed** (#38) |
| G12 | I7 / I8 (wall-clock `learnedOn`; dedup eats a revised belief's successor) — launch blockers? | open |
| G13 | `~/.counterparts/x/` | **closed** — owner deleted it |
| G14 | I13 / I14 — schedule as core PRs after launch or before? | open |
| G15 | Bench re-run on a store copy after #38 (record only; N=14,000 is bit-identical) | open, optional |

### Spend

| Item | Actual |
|---|---|
| Round-1 cold-stranger critic, Voyage embeddings on the owner's key (unintended, see incident) | cents; count unknown (no usage logging) |
| Everything else this session (agents, loops, seeder, reviews) | $0.00 — no interpreter or embedder call |

## 2026-09-04, round 3 — the gauntlet ran; both centerpieces passed; the core fixes landed

*Appended by the coordinator, evening. Master `35caa5f`; suite **1579 pass / 0 fail**, nothing
skipped; install loop **33 / 33** in 2–3 s. Every merge below ran the suite on a preview of
master + branch first.*

### Scores — final for this session

| Critic | Rounds | Score | Verdict |
|---|---|---|---|
| Cold-stranger (install + README) | 4 | 4 → 4.5 → 8.0 → **8.0** | Below the 8.5 bar by a half-point that no critic on this machine can close: the clone 401s until the repo flips, and the hooks / MCP / wake surface is verifiable only inside a real Claude Code session (QUICKSTART §9 says so). Command time to a working memory ≈ 60 s; the §7 capture reproduced character for character in rounds 3 and 4. |
| Design-director (dashboard) | 2 | 6.5 → **8.5 PASS** | 0 console/page errors across the loop's 38 shots and the critic's own 68; worst contrast 4.97:1 (was 1.86); "the stories panel is now the best surface in the product". Round-3 polish in flight (note-refresh gap, date column, tap targets, overview tile count, README reshoot). |
| Design-director (site) | 1 (+1 in flight) | **8.5 PASS** | 0 errors across 24 loads; all five owner ideas judged executed; polish round applied (fold gate, −23 % height, hamburger, copy buttons, Inter body). Confirming round 2 in flight. |
| Claims auditor (README, QUICKSTART, CLAUDE.md) | 3 + delta | FAIL 9 → FAIL 4 → FAIL 2 → **delta FAIL 1 → fixed (#59)** | Every rewrite traced to code; the numbers (suite, loop, error strings, exit codes) reproduced on every pass; the pinned suite line reproduced on its commit. Site copy audit in flight. |

### Merged since round 2

| PR | What |
|---|---|
| #47 | W1 sync: nothing skipped; loop 26/26; docs stop calling the first-memory bug open; image URLs absolute |
| #48 | **The web dashboard** (`counterparts-dashboard serve`, six pages, glow theme, visual loop) |
| #49 | README images in `docs/images/` |
| #50 | W1 round 4: the console's config rule stated once and printed; the claims audit's nine rewrites; `init` documented; `NOTHING CAME BACK` |
| #51 | `docs/overnight-prompt-2026-09-04.md` |
| #52 | W1 round 5: hook-environment sentence everywhere; the loop exercises the lazy `session_end` bind via a separate MCP process; `counterparts-dashboard --help` opens no store |
| #53 | Removal names the span buffer it cannot reach, by looking (option A, owner-ruled) |
| #54 | W2 round 2: the design director's nine, measured |
| #55 | W1 round 6: unknown flags refused before any open; `note`/`recall` print `Store:`; `init --name` |
| #56 | **CORE** — dedup never archives a revision's successor (owner-ruled fix-before-launch); class ANYTHING ELSE declared before merge; **owner runs `restart.ts --date 2026-09-05`** |
| #57 | W1 round 7: the removal count is printed, not stored; CLAUDE.md names the asks against `store/` |
| #58 | One store, one count: memories vs beliefs-and-entities on every surface; CLI bands from physics |
| #59 | QUICKSTART's capture shows the `Store:` line (delta audit) |
| #60 | Demo-seed determinism test gets a 30 s budget (8.2 s measured under load) |

### Owner rulings since round 2

Removal residue = **option A** (landed, #53; B filed for the overnight prompt). Dedup-eats-revised-belief = **fix before launch** (landed, #56). Wall-clock `learnedOn` = after launch, with a real two-clock design (lived days for physics, real dates for provenance) — overnight prompt workstream 1. Journal in recall = keep recallable, label as journal — overnight 2. df/storeSize edge — overnight 3. Bench — later, only at a finished point. **Awaiting the owner:** the site's lane labels (in/out vs "your lane / the AI's lane").

### New findings since round 2

- **I17 (core, pre-existing — FIXED on branch `overnight/schema-not-dedup`, 2026-09-05; see that entry)** Schema elements (`sch_`) are ordinary dedup candidates and lose the same-day tie-break to a memory with the same body even with no revision anywhere; migrated elements were minted at the import day while migrated memories kept their v1 birth day, so such pairs on the live store would already be archived. Filed in `sleep/NOTES.md` §12. Read-only check: `memory.merged` events whose `candidateId` starts with `sch_`.
- **I18 (dashboard)** `counterparts note` does not refresh an open flow page (refresh gated on durable events; a note writes none). W2 round 3.
- **I19 (process)** A RESUMED agent whose isolated worktree was auto-cleaned runs in the live checkout: the delta auditor did `git checkout --detach origin/master` in `~/counterparts` (same commit, nothing changed, re-attached). Rule: spawn fresh with worktree isolation for anything that checks out or edits.
- **I20 (test)** `test/demo-seed.test.ts`'s determinism test timed out under full-suite load (8.2 s vs 5 s default) — fixed (#60).

### NEEDS-OWNER — current

| # | Item | State |
|---|---|---|
| G16 | **Run the phase-clock restart for #56**: `~/.bun/bin/bun run tools/parallel/bin/restart.ts --run-dir ~/counterparts-parallel-run/2026-09-03 --date 2026-09-05 --phase P --v2-data-dir ~/.counterparts/store --reason "fix/revision-successor-survives: dedup no longer archives a revision's successor; G12 class anything-else; surfaceSet 800a9a9421cd969f unchanged"` — with no session open. Zero counted days lost. | open |
| G17 | Read-only check for I17 on the live store (merge records with `sch_` losers). **Now a command:** `counterparts repair-merged-beliefs --dry-run` — see the 2026-09-05 entry. | open |
| G18 | Site lane labels: in/out (builder) vs your/AI (ruling). | open |
| G19 | Create the site's GitHub repo and Vercel project; point counterparts.ai at it (after the flip). | later |
| G20 | The flip: `docs/launch/flip-checklist.md`, 12 steps, owner executes. | staged |
| G21 | Fire `docs/overnight-prompt-2026-09-04.md` overnight; merge core in the morning. | staged |

### Spend

$0.00 this round. Cumulative: the round-1 critic's handful of Voyage calls (cents); nothing else.

## overnight, 2026-09-05 — workstream 11: beliefs are not dedup candidates (I17 / G17)

Branch `overnight/schema-not-dedup`. **Not merged; core, so the owner merges.**

- **I17 is fixed.** A `type: "schema"` row is no longer a dedup candidate at all —
  rule (a), taken over (b) "schema-with-schema on the same entity" on contract grounds:
  `schemas/` §2 and constitution 12 (beliefs never blend; generalization is only an
  explicit provenance-carrying revision), §5 G4 (near collisions refuse LOUDLY rather
  than merging), §5 G1 (no operation edits a belief), and `migrate/apply.ts#writeElement`
  already de-duplicates same-entity elements at import. `sleep/` CONTRACT gains **G9c**;
  G7's "still open" paragraph is closed; `sleep/NOTES.md` §14 records it and §12's probe
  H is marked closed. Physics is unchanged — `dedupVerdict` did not move, because
  candidates are the phase's job and never physics'.
- **G9b (PR #56) stays load-bearing, not belt-and-braces.** `revision.ts`'s identity arm
  mints its successor as `type: "memory"`, so the schema rule does not reach it. A new
  test pins that case. None of PR #56's five tests were removed; each keeps every
  invariant assertion and only its reason line moved to `skipped.schema`.
- **Failing-test-first:** five new tests failed on master (same body, migration shape,
  cosine path, the narrowness guard, two beliefs) and pass after. Measured on the merged
  tree (master `a49bca5` merged into the branch): suite **1,610 / 0**, `tsc` clean,
  install loop **36/36**.
- **The repair exists**, because stopping the bug does not undo it:
  `counterparts repair-merged-beliefs`, dry run by default, over the union of
  `memory.merged` events with a `sch_` candidate and archived schema rows whose reason is
  the merge. The core door it needed did not exist and was built as the smallest one that
  works: `store/owner-op-seam.ts#unarchiveMerged` accepts `archived_reason: "merged"` and
  refuses every other reason, a superseded row, a removed id and an unknown id, each by
  its own error code. The `uses` each merge credited is LEFT STANDING and recorded in the
  `memory.unmerged` record rather than silently reversed.
- **G12 class: ANYTHING ELSE.** Surface-set hash `800a9a9421cd969f` on master (`7fe3e9f`)
  and on the branch — unchanged, and still `800a9a9421cd969f` on master `a49bca5` and on
  the branch with that merged in. Unchanged because it hashes field NAMES on three record
  shapes and no field moved. That is not "identical": an element that would have been archived stays
  live, one fewer `sleep.merged.<id>` is written, and recall, the wake and every schema
  slice see a belief where they would have seen nothing. The day-1 record says nothing
  about schema/memory collisions, and migration settles the DIRECTION of the loss (elements
  at the import day, migrated memories keeping their v1 birth day, so the element always
  loses) and not its FREQUENCY — a pair needs two distinct v1 items whose gated text is
  byte-identical. The direction is certain; the count is unknown, and only G17's dry run
  can say. "No live row is affected" is not a claim this session can make.

### NEEDS-OWNER — workstream 11

| # | Item | State |
|---|---|---|
| G17 | **Now runnable, and read-only:** `counterparts repair-merged-beliefs --dry-run --dir ~/.counterparts/store` answers I17's question on the live store — it prints every belief a merge archived, with the entity, the statement's first 60 characters, the memory it went into and the lived day. It writes nothing. The owner runs it; no agent has, or may. | open |
| G22 | Merge `overnight/schema-not-dedup` (core). Record the G12 class **anything else** in `docs/PARALLEL-RUN-STATUS.md` before merging — a proposed entry is drafted there under 2026-09-05, for the owner to confirm or amend. | open |
| G23 | After merging, and only if G17's dry run listed anything: `counterparts repair-merged-beliefs --apply --dir ~/.counterparts/store`, with no session open. It restores each belief to live and appends one `memory.unmerged` record per row; a second run does nothing. Owner-only. | open |
| G24 | The phase clock: this is an anything-else class like #56's, so the same restart applies. Whether it needs its OWN restart or rides #56's (G16, same night, same surface-set hash) is the owner's call — the session that made the change may not run `restart.ts`. | open |

## Overnight, 2026-09-05 — the after-launch workstreams, on branches; core waits for the owner

*Appended by the coordinator at the end of the night. Nothing below is merged to `src/core/`.
Every core PR carries an adversarial review as a PR comment (all nine verdicts: MERGE WITH
CHANGES, every change applied and re-verified by its builder), its surface-set hash on master
and branch, and its carry-forward class. Master at the start of the night: `7fe3e9f`, suite
1586 / 0. Master now: `a49bca5` (#73 merged tonight), suite 1593 / 0, install loop 36 / 36,
visual loop 51 / 0. Eleven workstreams; eleven landed on branches; nothing blocked.*

### The morning rule for merging core

Read the nine review comments. Then merge EITHER the pre-integrated batch (branch
`overnight/core-batch`, a draft PR marked owner-only) OR the individual PRs in the landing order
below — never both. Then run **one** `restart.ts`, after the merge and before the daily, because
#65 moves the surface-set hash (a fourth hashed component, `gate.deposit`) and the preflight
compares `run.json`'s hash to the build. Every PR's class is ANYTHING ELSE; one restart covers
the batch. Zero counted days are lost if the restart is dated 2026-09-05 and runs before that day
is recorded.

```
~/.bun/bin/bun run tools/parallel/bin/restart.ts \
  --run-dir ~/counterparts-parallel-run/2026-09-03 \
  --date 2026-09-05 --phase P --v2-data-dir ~/.counterparts/store \
  --reason "overnight core batch #64-#72: surfaceSet 800a9a9421cd969f -> c3af0bef00209ba6 (#65 gate.deposit); class anything-else"
```

### The PRs

| PR | Workstream | What | Class | Review verdict → fix round | Hash on branch |
|---|---|---|---|---|---|
| #64 | 3 df vs storeSize | deindex on archive/supersede; `verify --prune-index`; census "indexed but not live" | anything else | MERGE WITH CHANGES → applied (`c3877c9`; blurb round `4a94611` on master `a49bca5`) | `800a9a9421cd969f` |
| #65 | 6 replay §2a | durable `gate.deposit` per authored deposit (28 ids-only fields); registries total; replay refusal mix over both kinds | anything else (hash moved by design) | MERGE WITH CHANGES → applied (`6cdb542`; the feeling word is author text and left the record) | **`c3af0bef00209ba6`** |
| #66 | 5 float32 vectors | cache v4 float32 BLOBs; `migrate-cache` dry-run first; 175 → 62 MB, scan 450 → 50 ms | anything else (Δscore ≤ 1.5e-9 vs an absolute semantic floor) | MERGE WITH CHANGES → applied (`dc4233e`; the stranded VACUUM, read-only dry run; blurb round `5090fce`) | `800a9a9421cd969f` |
| #67 | 1 two clocks | `StoreOptions.now`; provenance dates from the deposit instant; seeder dates real; `repair-dates` dry-run | anything else (reviewer's call; rides the batch restart) | MERGE WITH CHANGES → applied (`69e5505`; re-run guards, the histogram, the unheld dates; blurb round `6c2ca7d`) | `800a9a9421cd969f` |
| #68 | 4 span chase | `origin.spanHash` in prose meta; owner-strike seam; `spans` chased; `remember/` G14 draft | anything else (one new durable field) | MERGE WITH CHANGES → applied (`9a2eac7`; six findings; blurb round `2a41191`, loop 39 steps) | `800a9a9421cd969f` |
| #69 | 11 beliefs not dedup candidates | `isSchemaRow` excludes elements from dedup; `repair-merged-beliefs` dry-run/apply via `unarchiveMerged` | anything else | MERGE WITH CHANGES → applied (`6c815f6`; re-index on restore, three records; blurb round `6fcb16b`) | `800a9a9421cd969f` |
| #70 | 2 journal labelled | journal rows recallable, labelled `journal` on every surface; horizon lane no longer lists chapters | anything else (third class; content moves) | MERGE WITH CHANGES → applied (`c5568f7`; horizon lane filters journal rows in `prospective/derive.ts`) | `800a9a9421cd969f` |
| #71 | 9 day-0 wake | a day-0 store wakes with furniture, not a claim ("No identity has formed here yet" guarded by the empty lane); sentinel intact | anything else (rides the batch restart; hash unchanged, wake content moves) | MERGE WITH CHANGES → applied (`5dcbf79`; coreName computed once on the untrimmed lane; `flatten(name)`) | `800a9a9421cd969f` |
| #72 | 10 one config rule | `--config` on hook, MCP server, dashboard, CLI; one resolver; session record names the config; loop 37 steps | adapter (hook.ts) — **owner merges** | MERGE WITH CHANGES → applied (`cc4e50d`; a NAMED config that is missing, not JSON, or mistyped refuses; an absent default stays ordinary; the worker pin no longer trips it; blurb round `66cde70`, loop 41 steps) | `800a9a9421cd969f` |
| #73 | 7 dashboard leftovers | overview tile refreshes on the first event; `serve` refuses the env var alone; both consoles exit 1 on a missing store, stderr only; `COMMAND_BLURB` exhaustive (help and parser held together by a type) | adapter/docs — **merged tonight as `a49bca5`** (preview: tsc clean, suite 1593 / 0, loop 36 / 36, visual loop 51 shots / 0 findings) | MERGE WITH CHANGES → applied (`15b9349`); landed first so every later PR that adds a command or flag could add its blurb line against it | `800a9a9421cd969f` |
| site `7bf8754` | 8 ecosystem page | `/ecosystem`: the landscape explorer and mechanism deck from mikelapeter.com/lab/memory, components kept and restyled into the site's idiom (type as shape, one hue one meaning); 47 / 47 rows sourced; the build refuses an unsourced row; three new shoot gates | site only (unpushed) | shoot clean on the final build; no design critic (owner deferred visual dial-in) | — |

### New findings overnight

- **I21 (core, process)** Nothing refuses an implicit default data dir: a caller that omits `dir` and has no `COUNTERPARTS_DATA_DIR` opens `~/.counterparts/store`. An agent did exactly that (read-only, nine titles printed to its own terminal, no write, no egress). Proposed guard `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` — G25.
- **I22 (core)** `prose_path` is stored absolute, so a copied store reads and deletes the source's prose — G26.
- **I23 (core — FIXED on branch `core/prune-events`, 2026-09-05, owner ruling the same day: wire it into sleep)** `pruneEvents` has no caller — G27. Now sleep's `log` phase, last in the cycle: unlatched rows older than 90 lived days go, at most 5,000 per pass, oldest first; every latched record is kept and counted; `counterparts verify` prints what the next pass would delete (`sleep/CONTRACT.md` §5 G16, `sleep/NOTES.md` §15).
- **I24 (core, informational)** `self/identity.ts#enumerate()` has no type filter; closed today only because no writer gives an episode the identity band or the protected flag (`recall/NOTES.md` #13).
- **I25 (fixed in #70)** The horizon lane listed a chapter's date as "Arriving": a lived day rendered as prospective. Filtered in `prospective/derive.ts` — label where the reader can discount, filter where the frame itself would be a lie.
- **I26 (fixed in #72)** An absolute `--config` naming a missing, non-JSON or mistyped file fell through to the default store instead of refusing.
- **I27 (fixed in #71)** The day-0 name guard was evaluated at two seams on two different values; a name with newlines could forge a wake bullet.

### Corrections to earlier entries (appended, not edited)

- An earlier entry (this file at `a49bca5`, lines 154-155) records exit **0** for both consoles on an empty store. As of #73 both exit **1**, stderr only, remedy naming the passed `--dir`; "nothing minted" still holds (re-verified by the #73 reviewer). `runReport` exits 1 for every `StoreError`, not only a missing store.
- The overnight prompt's "hash unchanged ⇒ class identical" reasoning was wrong and three reviewers said so independently: `surface.ts` hashes field NAMES, so an unchanged hash is evidence the record's shape did not move, never that no value did. Every core PR tonight is class ANYTHING ELSE and rides one restart.

### Read-only checks for the owner, all dry runs, all on the live store, none run by the session

| Check | Command | Tells you |
|---|---|---|
| Merged beliefs (I17) | `counterparts repair-merged-beliefs --dry-run --dir ~/.counterparts/store` (after #69 merges) | how many beliefs the same-day tie-break archived as duplicates; `--apply` restores them |
| Dead index rows (I13) | `counterparts verify --dir ~/.counterparts/store` (after #64 merges) | the "indexed but not live" count; `--prune-index` repairs |
| Migrated dates (I7) | `counterparts repair-dates --dir ~/.counterparts/store` (after #67 merges) | proposed true dates by confidence for the 12,334 import-day rows; `--apply --confidence <tier>` |
| Vector cache (debt) | `counterparts migrate-cache --dir ~/.counterparts/store` (after #66 merges) | rows, bytes now, bytes after; `--apply` converts in place |

### Landing order — why it matters now

`COMMAND_BLURB` (#73) is exhaustive, so #64, #66, #67, #68, #69 and #72 each carry a blurb round merged against `a49bca5`. #71 and #72 append install-loop steps at the same seam of `run.sh`; #68 and #71 both own QUICKSTART's step count. Merging the eight open PRs one at a time therefore conflicts from the second one on. The pre-integrated batch (branch `overnight/core-batch`, opened as a draft PR after this entry — owner-only, never merged by the session) merges them in this order with the three seams resolved and every gate re-run: **#72 → #64 → #65 → #66 → #67 → #68 → #69 → #70 → #71**. The eight individual PRs stay open as the review record; reject one and the batch is rebuilt in the morning.

### NEEDS-OWNER — the morning

| # | Item | State |
|---|---|---|
| G22 | **Read the nine review comments**, then merge EITHER the batch PR OR the individual PRs in the landing order above. Never both. | open |
| G23 | **Then ONE restart**, before the daily: `~/.bun/bin/bun run tools/parallel/bin/restart.ts --run-dir ~/counterparts-parallel-run/2026-09-03 --date 2026-09-05 --phase P --v2-data-dir ~/.counterparts/store --reason "overnight core batch #64-#72: surfaceSet 800a9a9421cd969f -> c3af0bef00209ba6 (#65 gate.deposit); class anything-else"` — with no session open. Zero counted days lost if it runs before 2026-09-05 is recorded. Supersedes G16 (the #56 restart), which the owner already ran on 2026-09-04. | open |
| G24 | The four read-only dry runs (table above), after the merge. `repair-merged-beliefs --dry-run` answers G17 directly. | open |
| G25 | **I21** — `COUNTERPARTS_REQUIRE_EXPLICIT_DIR`: should the library refuse an implicit default dir when the env var is unset? Tonight's agents ran with the var exported everywhere; one earlier agent opened the live store read-only by passing the wrong option name. Core change; owner's call. | open |
| G26 | **I22** — `prose_path` is stored ABSOLUTE: a copied store reads and deletes the SOURCE's prose. Backups as a revert lever are unsafe until this is relative; the recall-bench README's `cp -R` advice is hazardous. Core change; owner's call. **Owner ruled 2026-09-05: fix it.** PR #79, branch `core/prose-paths-relative` (store schema v5: both path columns store-relative, converted at the first writer open — 79/82/67 ms measured on 15,000 + 2,000 synthetic rows; `verify` prints the census; `store/CONTRACT.md` §5 G15; G12 declaration in PARALLEL-RUN-STATUS). Owner merges; rides the day's restart. | PR #79 open |
| G27 | `pruneEvents` has no caller; the events table grows without bound. Wire it into sleep or drop it. Core; owner's call. **Wired, on branch `core/prune-events` (owner ruling 2026-09-05: sleep).** The `log` phase runs last; `counterparts verify --dir ~/.counterparts/store` prints the live table's row count, oldest day and what the first pass would delete — read that BEFORE merging, since the count on the live store is unverified by any agent. Expected by arithmetic: 0 rows until the store has lived 90 days past its first v2 event. | owner merges PR |
| G28 | Site: push `~/counterparts-site` `main` (unpushed, ~40 commits), create the GitHub repo and the Vercel project (G19). Kill the dev server on 3111 when done looking. | open |
| G29 | Site: `content/status.ts` mis-attributes four true status lines to the README's "Status, honestly" section. One-line header fix. | open |
| G30 | Hero polish round (owner: "dial in the details later"). | later |

### The site

Hero rebuilt to the owner's ruling (two vertical Tron light ribbons, yours and your counterpart's,
mostly parallel, twisting at conversations; "your counterpart", never "the AI" as a tool) — see
`~/counterparts-site/review/round-4/`. Design director rounds: 8.5 → 9.0 before the hero change;
the ribbons hero is unreviewed by a critic (owner: "good enough for now, dial in details later").
Claims audit of the site: FAIL 1 → fixed; demo regenerated at master. The ecosystem page landed overnight (row above); `/ecosystem` is indexed and in the sitemap. The dev server on port 3111 was left running for the owner (`npx next dev -p 3111` in `~/counterparts-site`; kill it when done). Site finding: `content/status.ts` calls all seven status lines "verbatim from README 'Status, honestly'" while four are sourced to `package.json`, the licence and the install section — true, mis-attributed.

### Spend

$0.00 overnight.

### Addendum, end of night — the batch is open as PR #75

`overnight/core-batch` head `386bc38`: ten `--no-ff` merges on `a49bca5` in the landing order
(#72 → #64 → #65 → #66 → #67 → #68 → #69 → #70 → #71, then master `0ac953b` for #74). Gates on
the final tree: tsc clean · suite **1782 / 0** (29 files) · install loop **46 / 46** · visual loop
**51 shots / 0 findings** · hash **`800a9a9421cd969f` → `c3af0bef00209ba6`** (moves at #65, stable
after) · `--help` lists 14 commands once each, every per-command page free of `(undocumented)` ·
QUICKSTART's check count (46) and `session_end` step index (33) match `run.sh`.

**The morning rule, corrected by the build:** merge **the batch** (#75). Merging the nine PRs
individually is NOT equivalent — it re-does every conflict resolution the PR body lists (nine
`commands.ts` seams, two NOTES §13 renumberings, the `run.sh` seam, the QUICKSTART counts) and #69
would fail two of its own tests once #64's deindex and #66's BLOB vectors are real; the batch adapted
those two tests. Reject a PR → the batch is rebuilt without it, not merged around it.

**Three things the merge exposed, NEEDS-OWNER (in the PR body as B1–B3):**

| # | Item | State |
|---|---|---|
| G31 | **`--yes` means opposite things** in `migrate-cache` (#66: skip the typed confirmation, `--dir` still required) and `repair-dates` (#67). Same flag, two meanings, now one help sentence naming both. Pick one meaning before publish. | open |
| G32 | `sleep/NOTES.md` and `recall/NOTES.md` each had two §13s (two PRs appended the same number); the batch renumbered the later-merged one to §14 — an order accident, swap if preferred. | open |
| G33 | QUICKSTART's `session_end` step index was already stale on master (said 23, was 25) and nothing asserts it; the loop's count and index are prose. A `doc_check` for the two numbers is a ten-line follow-up. | open |

Spend: still $0.00. Every agent shell ran with `COUNTERPARTS_DATA_DIR` on a scratch dir; no live store, hook, MCP server, `daily.ts` or `restart.ts` was touched by the session.

## 2026-09-05 afternoon → 2026-09-07 — the batch merged, four repairs applied, the second batch built, and a three-day gap found

*Appended by the coordinator on 2026-09-07. A rate limit ended the 09-05 session mid-afternoon;
work resumed 09-07 with the owner's instruction to use Opus for agents. Master now `cf80c53`
(suite 1803 / 0, loop 46 / 46). The second core batch is open as draft PR #82 (owner-only).*

### What happened on 2026-09-05

- The owner merged **#75**, the first core batch (master `ef82cd5`), ran the second same-date
  `restart.ts` (restarts.jsonl line 3, hash `c3af0bef00209ba6`), then permitted the session to run
  the four read-only dry runs and three of the four repairs on the live store: `verify
  --prune-index` (1,078 dead index rows dropped), `repair-merged-beliefs --apply` (3 beliefs
  restored), `repair-dates --apply --confidence medium` (445 rows re-dated; 11,466 import-day
  rows carry no date evidence and stay). The owner ran `migrate-cache --apply` with every session
  closed: 14,328 vectors → float32, cache 272.9 → 142.5 MiB. `verify` afterwards: "the cache
  covers every live row and holds nothing else". The daily record for 2026-09-04 was written
  (ACTIVE, 97 turns, no red line).
- Owner rulings: G31 `--yes` only skips a confirmation and every bulk write requires the `--dir`
  flag → **#77 merged** (`cf80c53`; one helper on seven doors, incl. `backfill-claims` and
  `repair-merged-beliefs`, which had no door). G32 leave the §14 renumbering. G33 lockstep test →
  in #77 (`test/install-loop.test.ts`). Dashboard `serve --yes` → `--default-store` → **#78
  merged** (`1744f1e`; the bin also gained the unknown-flag refusal it lacked). I22, I21, I23 →
  yes to all three → the second batch.

### The second core batch — draft PR #82, owner-only

| PR | What | Review | Head |
|---|---|---|---|
| #80 | `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` guard on every door incl. the config door; `install` refuses to write a real-home default config that points at a temp store (the I29 incident); loop step 16 arms it | MERGE WITH CHANGES → applied (`abadc25`; 1 / true / on arm, 0 / false / off disarm, junk refuses) | `abadc25` |
| #79 | `prose_path` and `versions.path` stored store-relative; schema 4 → 5 migrate-at-open (~80 ms / 15k rows); observers place absolute rows against the opened dir; `STORED_PATH_ESCAPES` guard; `verify` path census | MERGE WITH CHANGES → applied (`1ca16e5`) | `1ca16e5` |
| #81 | sleep phase `log` calls `pruneEvents` (cap 5,000 / pass, retention 90 lived days, every durable record kind latched); replay driver opens with a corpus-sized retention; `verify` events census | MERGE WITH CHANGES → applied (`7ba6dbe`) | `7ba6dbe` |

Batch head `6c76418` on `cf80c53`: tsc clean · suite **1837 / 0** (31 files) · install loop
**47 / 47 both ways** · visual loop 51 / 0 · hash **`c3af0bef00209ba6` unchanged** · eight
conflicts resolved, listed in the PR body (store CONTRACT G14 / G15 renumbering; `verifyCensus`
folded; three G12 declarations reconciled to one restart). Live census, read-only, before #81:
1,342 event rows, oldest lived day 184, the first pass deletes 0.

### NEEDS-OWNER — the merge of #82

| # | Item | State |
|---|---|---|
| G34 | **Backup first**: `counterparts backup --out <dir outside the store> --dir ~/.counterparts/store`, kept until the run's verdict. #79 moves the schema to v5 and a pre-v5 build refuses a v5 store, so this backup is the revert lever. | open |
| G35 | **Merge #82 with NO session open** (a stale old-code MCP server fails every prose read after the migration), then ONE `restart.ts --date <merge day>` with the reason in the PR body (hash unchanged; class ANYTHING ELSE). Supersedes G23. | open |
| G36 | Then `counterparts verify --dir ~/.counterparts/store`: prose paths census ("0 absolute" only after the first writer open) and the events census. | open |
| G25 | I21 explicit-dir guard — **in #82** (closes on merge). | in #82 |
| G26 | I22 prose paths — **in #82**. | in #82 |
| G27 | I23 events pruned — **in #82**. | in #82 |
| G31 | `--yes` — **closed by #77 + #78**. | closed |
| G33 | step-count lockstep — **closed by #77**. | closed |

### I29 — the live memory recorded nothing from 2026-09-04 15:16 to 2026-09-07

Found on resume. `~/.counterparts/claude-code.json`'s `dataDir` had been overwritten at
2026-09-04 15:15:59 with a temp path (`…/T/counterparts-out-HKaR6P/twice-install/store`): the
repo's own `install` test, run in a checkout that predated the home-directory mock, wrote the
owner's real default config. Every hook and MCP session since opened that empty temp store: 780
events, **0 memories**; the live store's last active day is 2026-09-04. The daily records for
09-05 and 09-06 read THIN for that reason (v2 reached no boundary in the live store; 09-06 also
had no v1 log). The classifier blocked the session's restore and its rescue copy; the owner
restores the one field from the Desktop sheet and restarts sessions. Nothing to carry across (the
temp store holds no memories); the owner chose not to replay the three days. Prevention landed in
#80 (the guard, armed in the test preload and every agent shell; `install` refuses a temp-store
default) — G37 below asks for the last piece.

### I30 — the Anthropic receipts are bansai's

The $20 recharges (11 since 09-03) are bansai's Stop / SessionEnd / PreCompact hooks encoding
every assistant turn through the Anthropic API — "always encode, both systems collect" is the
run's own rule; muting stops injection only. Our sessions run ~10× a normal day's turns.
Counterparts spent $0 on Anthropic (sweeps ran 0 times; embeddings are Voyage, cents). The run's
09-03 cost estimate counted v2's sweeps and never v1's encoding. Owner's choice, G38.

### NEEDS-OWNER — new

| # | Item | State |
|---|---|---|
| G37 | Restore `dataDir` in `~/.counterparts/claude-code.json` to `~/.counterparts/store` (sheet on the Desktop), restart every session, confirm with `counterparts status`. | open |
| G38 | bansai's per-turn encoding spend: remove its Stop / SessionEnd / PreCompact hook entries from `~/.claude/settings.json` (recommended; keeps the muted wake hooks so the daily's consistency check still reads) — or accept the cost until the verdict retires v1. | open |
| G39 | `tools/parallel/bin/restart.ts` writes a live path by naming nothing (the #80 reviewer); `COUNTERPARTS_OBSERVER` accepts only `1|true` untrimmed while the new guard accepts a wider set — widen in one place, separate PR. | later |
| G40 | `migrate-cache`'s hint says "take a `counterparts backup` first" but `backup` excludes the cache by design; a `cp` of `cache.sqlite` is the real protection. One-line hint fix. | later |

### Spend

$0.00 by the session and its agents across 09-05 → 09-07. See I30 for the receipts.

## 2026-09-08 → 09-10 — the owner's sitting: #82 merged, live memory back on, restart #4, I31, G41–G43

*Appended 2026-09-10 by a docs session. Master is now **`2b95f21`** (`gh pr view 82`: #82 merged
`2026-09-10T14:13:23Z`; no PR is open). **Provenance rule for this entry:** every figure in the
sitting table below is the OWNER's command output, relayed to this session by the coordinating
session on 2026-09-10. This session ran no command against the live store, opened no backup
directory, and ran no test. The run-directory numbers (restart 4, `run.json`, the dailies) were
read read-only from `~/counterparts-parallel-run/2026-09-03/` and are this session's own.*

### The sitting, item by item

| # | Item | State | What the record says |
|---|---|---|---|
| G34 | Backup before the schema move | **DONE** | `~/counterparts-backup-2026-09-07/2026-09-10T14-13-00-341Z` — prose **15,541** files, versions **468**, `operational.sqlite` via `VACUUM INTO`, spans **58**. Kept until the run's verdict; this is the revert lever, since a pre-v5 build refuses a v5 store by name. |
| G35 | Merge #82 with no session open, then ONE restart | **DONE** | Merged `2026-09-10T14:13:23Z` as `2b95f21`, no session open. Restart 4: `restarts.jsonl` line 4, `2026-09-10T14:15:48.392Z`, hash `c3af0bef00209ba6` unchanged, class anything-else. |
| G36 | `verify --dir ~/.counterparts/store` after the merge | **DONE** | Output verbatim below. |
| G37 | Restore `dataDir` in `~/.counterparts/claude-code.json` | **DONE 08:15 local** | The config's `dataDir` points at the live store again, and a backup, `claude-code.json.bak-2026-09-07`, sits beside it (this session did not open either file and does not know which state that backup holds). This is the end of the I29 window and, unknowingly, of I31's. |
| G25 | I21 explicit-dir guard (#80) | **CLOSED** | by the merge. |
| G26 | I22 prose paths (#79) | **CLOSED** | by the merge; the conversion event is below. |
| G27 | I23 events pruned (#81) | **CLOSED** | by the merge. Not yet exercised: the `log` phase runs inside a sleep cycle and the `verify` below was taken before the first Stop-boundary sleep pass, so 1,349 held / oldest lived day 184 is what the first pass will read, not a report of one that ran. It will delete 0. |
| G6 | `backfill-claims --apply` on the live store | **CLOSED — nothing to apply** | The read-only dry run, 2026-09-10: "Authored memories with no claimed salience: 0 / Default floor to apply: 0.25 / Dry run. Nothing has changed." A carried-forward item since 2026-09-04, closed by finding the work already unnecessary rather than by doing it. |

### `counterparts verify --dir ~/.counterparts/store`, after the first wake (owner's output)

> Canonical rows: 15541 live rows: 14466 removed (deny-list): 0
> Prose paths: 15541 relative, 0 absolute (unplaceable), 0 missing files
> Version paths: 468 relative, 0 absolute, 0 missing
> Events: 1349 held (104 latched) oldest lived day 184 (2026-09-03) window 90 lived days
> Cache: indexed documents 14466, embeddings 14328, live memories with no vector 219, vector format float32 BLOB (v4)
> The cache covers every live row and holds nothing else

And the conversion that produced the second and third lines: event **`store.migrate.paths`** at
`2026-09-10T14:16:03Z` — `from` 4, `to` 5, prose converted **15,541**, versions converted **468**,
**0** unplaceable.

**One consistency check this session CAN make without touching anything.** `verify`'s "15541
canonical / 14466 live" reconciles against the run directory: every daily record from 09-07 through
09-09 carries `v2.memories.total` **15541** and `archivedTotal` **1075**, and 15541 − 1075 = 14466.
Two instruments, read days apart, agree on the same store. It is a weak check — both read the same
rows — but it is the only one available here, and it passes.

**A note on `counterparts status` and "last active", so it is not misread as a failure.** The
owner's sheet said to expect `last active = today` right after the restart. It showed the previous
date instead. That is correct behaviour: `advanceClock` runs in the Stop-boundary sleep pass, so
the store's active date does not move until the first such boundary of the new session. The sheet's
expectation was early, not wrong about the outcome. The same mechanism is why the four watches
still read `not-exercised` (PARALLEL-RUN-STATUS, 2026-09-10).

### Correction to I29 — the temp store was not empty by 09-10

The 2026-09-07 entry records the temp store as holding **0 memories**, which was true when it was
read. By 2026-09-10 it held **124**. They were backed up to
`~/counterparts-tempstore-backup-2026-09-10/…` and the owner ruled they are **NOT** merged into the
live store: the content is from private project directories and does not belong in the counterpart's
memory. There is no `import` command in the CLI, so no partial merge was available even had the
ruling gone the other way; writing one for 124 rows of unwanted content is not work anybody asked
for. The three days remain unreplayed by the owner's earlier choice, and now the 124 remain
unmerged by this one. The original I29 line stays as written; this is the appended correction.

### I31 — the hooks and the MCP server were pointed at different stores

**NEW, found 2026-09-10.** The second half of the I29 fault, and the more interesting half, because
it explains a refusal that had been visible for six days without an explanation.

**What was true.** The MCP server is registered in `~/.claude.json` with
`COUNTERPARTS_DATA_DIR=~/.counterparts/store` in its `env` — the LIVE store. The hooks
take their `dataDir` from `~/.counterparts/claude-code.json`, which since 2026-09-04 15:15:59 named
a **temp** store (I29). One host, two components, two different stores, for six days.

**What it caused, 2026-09-04 15:16 → 2026-09-10 08:15.**

- The wake and the crash-fallback sweeps came from the TEMP store. That is the same fact I29
  records; the daily records for 09-05 through 09-09 read `thin` because of it.
- **Every `session_end` and `chapter` call was refused `session-unknown`.** The hook writes the
  session record into ITS store — `<dataDir>/sessions/<id>.json`, the temp one. The server checks
  the LIVE store's registry (`src/adapters/mcp/server.ts`, `requireBoundSession` →
  `readSession(registryDir)`), which held no entry after 2026-09-04 15:15. The two halves of the
  session-binding mechanism — the note the hook leaves and the note the tool reads — were in
  different directories, so the authored front door was shut for the whole window.
- **Nothing leaked into the live store.** Its `operational.sqlite` mtime stayed at 2026-09-05 (the
  merge-day repairs), and its last active date stayed 2026-09-04 in every daily record. The server
  held the live store open and refused every write that reached it; the refusals are the proof.

**Re-aligned by G37** on 2026-09-10 at 08:15 local, when the config's `dataDir` went back to the
live store. Both components now name the same directory.

**Prevention idea for the owner, filed rather than built.** The server should refuse to bind a
session when its registry dir differs from the hooks' configured `dataDir` — a mismatch it can see
at startup and the operator cannot. The alternative, the hook recording the session in BOTH stores,
is worse: it makes the split legal instead of loud. Filed as gap 9 in
`src/adapters/claude-code/INTERFACE-GAPS.md`, which is where this adapter's asks against `mcp/`
live. Note what the #80 guard would and would not have caught: `COUNTERPARTS_REQUIRE_EXPLICIT_DIR`
refuses an UNNAMED store, and both of these stores were named. A guard against silence does not
catch two confident voices disagreeing.

### Corrections — housekeeping on this file (appended; no earlier line is edited)

- **G22, G23 and G24 were assigned twice.** The workstream-11 round (lines 805–807: merge
  `overnight/schema-not-dedup`; the `repair-merged-beliefs --apply`; the phase clock) and the
  overnight round the same night (lines 883–885: read the nine reviews and merge; the ONE restart;
  the four read-only dry runs). Both sets are real and both are now resolved by events. **Going
  forward the SECOND set — lines 883–885 — is cited as G22b, G23b, G24b.** No line is renumbered.
- **I28 was never defined in this file.** The number was used before it had a definition. It is
  hereby defined as the `migrate-cache` backup-hint finding: the hint says "take a `counterparts
  backup` first" while `backup` excludes the cache by design, so a `cp` of `cache.sqlite` is the
  real protection. **I28 = G40**, which is still open.
- **§F's score table (the four blank rows at lines 353–356) was never filled and will not be.** The scores exist; they
  live in the round entries, under "Scores — round 1" (line 536) and **"Scores — final for this
  session"** (line 705). Read those. The empty table stays as the reminder that a blank row means
  the gauntlet did not run.
- **G items resolved in the narrative but never crossed off in a table**, listed here so the tables
  are not read as the whole truth: **G1** (the hard-coded `CONFIG_PATH` — closed by #72, `--config`
  on the hook, the MCP server, the dashboard and the CLI); **G2** (Node vs bun — bun is the
  documented runtime; Node is untested at launch and CLAUDE.md says so); **G5** (`private`,
  licence and the README's "deliberately undecided" — closed by #32); **G12** (I7 / I8 as launch
  blockers — ruled 2026-09-04, both fixed); **G14** (I13 / I14 as core PRs — closed by #64 and
  #70); **G16** (the #56 restart — run; `restarts.jsonl` line 2, `2026-09-05T03:12:09.700Z`, which
  is the evening of 09-04 in the owner's local time, and is what line 884's "already ran on
  2026-09-04" refers to); **G17** (the merged-beliefs dry run — run 2026-09-05, 3 beliefs restored
  by `--apply`); **G21** (fire the overnight prompt — done, and #64–#73 are its output).

### NEEDS-OWNER — new (owner's asks, 2026-09-10)

The owner asked for three things after a week of living with the hooks in three private project
directories. All three are host-adapter questions, filed in
`src/adapters/claude-code/INTERFACE-GAPS.md` under the host-side gaps.

| # | Item | State |
|---|---|---|
| G41 | **Ask on first launch in a new directory** whether Counterparts should be on or off there. Today the answer is "on, everywhere, silently" — the hooks are global and a new project inherits them without being asked. | open |
| G42 | **An easier per-directory disable.** Today it takes a project `.claude/settings.json` `env` block naming an observer config via `COUNTERPARTS_CONFIG` plus `COUNTERPARTS_OBSERVER=1` — verified 2026-09-10 to reach both the hooks and the MCP servers. Observer means wake and recall are delivered and nothing is captured or deposited. That is four moving parts and a JSON file to get one directory to stop remembering. | open |
| G43 | **A pause/resume toggle per directory** — the temporary version of G42, for a session you do not want recorded without permanently opting the directory out. | open |

**Host fact, recorded so the next session does not mistake it for a bug:** three private project
directories were set to observer mode this way on 2026-09-10. Sessions in those directories deliver
wake and recall and capture nothing. A daily that reads few turns from those directories is reading
the configuration working, not a fault.

### Open owner items as of 2026-09-10

**G15** (optional — the bench re-run on a store copy, record only), **G18** (site lane labels),
**G19** (the site's GitHub repo and Vercel project), **G28** (push the site), **G29**
(`content/status.ts` attribution), **G30** (hero polish), **G38** (bansai's per-turn encoding
spend — I30), **G39** (`restart.ts` naming a live path by default; widen
`COUNTERPARTS_OBSERVER`'s accepted values), **G40** (= I28, the `migrate-cache` backup hint), and
the three new ones, **G41–G43**. G39 and G40 are small enough to be PRs the next session opens.
G6 is closed by its dry run (above) and is off this list.

### Dailies

Records for **2026-09-07, 2026-09-08 and 2026-09-09** were written on 2026-09-10 under the owner's
standing permission of 2026-09-05. All three read `thin` for I29's reason; 09-09 carries one named
finding (cross-encoding v2→v1, ratio 0.0020 against a bar of 0.1) and no red line. The day-by-day
numbers are in `docs/PARALLEL-RUN-STATUS.md`, 2026-09-10.

### Spend

**$0.00** by the session and its agents across 2026-09-08 → 2026-09-10. The Anthropic receipts in
this window are still bansai's (I30, G38 open).

## 2026-09-10, afternoon — owner rulings applied; G39 and G40 landed

Appended by the coordinating session after the morning entry above. Every line is command
output or a merge the session ran; nothing here is from memory.

### Merged

| PR | What | Verified before merge |
|---|---|---|
| #85 | G40 — `migrate-cache`'s dry-run hint no longer points at `counterparts backup` (which excludes the cache on purpose); it names the `cp` of `cache/cache.sqlite` and "every session closed". Test tightened to assert the new line and refuse the old one. | preview merge on master: 1837 / 0, tsc clean, hash `c3af0bef00209ba6`; adversarial review MERGE |
| #87 | G39 — `src/adapters/stance-env.ts`: `COUNTERPARTS_OBSERVER` / `COUNTERPARTS_OWNER` parse `1\|true\|on` trimmed, case-insensitive, via the guard's own word lists; junk ⇒ observer / not owner, one stderr line; flags still beat the environment, and `--owner` + `COUNTERPARTS_OBSERVER=1` still stands down (the observer-mode directories rely on it). `tools/parallel/live-stores.ts`: the three run bins announce the default `--v2-data-dir` on stderr and REFUSE (exit 2, before `RunDir.open`) when `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` is armed and the flag is absent or blank. | review MERGE WITH CHANGES → the blank-value hole closed in a fix round (head `4d828e5`); preview merge: 1852 / 0, tsc clean, hash unchanged, `src/core` untouched |

Residuals named by the fix round, not fixed: unarmed + blank `--v2-data-dir` is announced but
still proceeds with `""` (cwd) as the overlap subject; the notice prints an empty path in that
case. Three core comments now state the opposite of shipped behaviour and are the owner's next
core batch: `src/core/store/paths.ts` ~82–84, `src/core/store/NOTES.md` (2026-09-05 entry),
`src/core/store/CONTRACT.md` ~179 ("`COUNTERPARTS_OBSERVER` deliberately not widened").

### Owner rulings, applied the same afternoon

| # | Ruling | Applied |
|---|---|---|
| G38 | Stop bansai's per-turn encoding. | Its Stop / SessionEnd / PreCompact hook entries removed from `~/.claude/settings.json` (backup `settings.json.bak-2026-09-10-pre-bansai-off`); session-start and user-prompt-submit kept, so `record.ts`'s `v1MutedConsistent` (needs only `ab.muted` rows) still reads. bansai's memory has a gap from 2026-09-10 onward — the revert lever is weakened knowingly. |
| G28 | Push the site. | `~/counterparts-site` pushed to a PRIVATE GitHub repository (42 commits; HTTPS remote); the dev server on 3111 stopped. G19 (Vercel, domain) waits for the flip. |
| G29 | Status-file attribution. | One comment fixed and pushed: three of the seven status lines come from README "Status, honestly", the other four from package.json, "License and contributing" and "Install". |
| G18 | Lane labels. | Closed by inspection: the site says "you" / "your counterpart" throughout. |
| G30 | Hero polish + a critic pass on the ribbons hero. | Deferred to a site review session with the owner. |
| G6 | Salience backfill. | Closed by the 09-10 dry run (0 rows). |
| G39, G40 | | Closed by #87 and #85 above. |

Also that afternoon: three private project directories placed in observer mode via project
settings (`COUNTERPARTS_CONFIG` → an observer config, `COUNTERPARTS_OBSERVER=1`), and bansai's
hooks routed through a guard script with a per-directory opt-out list — host facts, recorded in
`src/adapters/claude-code/INTERFACE-GAPS.md`. Seven stale agent worktrees removed.

Open for the owner after this entry: G15 (optional), G19, G30, G41–G43 (build now or after
launch), the four deletions (the empty `x` test store, the 09-05 cache backup inside the live
store, the temp-store backup, one kept worktree), the flip checklist steps 3 / 5 / 6, and the
post-verdict plan for bansai (undefined in both run documents).

### Spend

$0.00 by the session and its agents.

## 2026-09-10, evening — the owner's rulings 5 and 6; flip prep; scope controls in flight

Appended by the coordinating session at the end of the day. Every line is a merge the session
ran or a ruling the owner gave in conversation.

| What | State |
|---|---|
| **PROMOTE ruling for v1** | Recorded in `docs/PARALLEL-RUN-STATUS.md` ("Owner ruling, 2026-09-10 — what PROMOTE does to v1"): keep `~/.bansai` and `~/bansai` untouched and read-only; at the verdict remove bansai's two remaining hooks and the guard, any MCP registration, and the `parallel.enabled` knob; archive the assignment file after OQ7's watch list is written. |
| **Flip checklist steps 3, 5, 6** | DONE ahead of the flip on the owner's ruling. PR #89 (master `af0a283`): `docs/launch-prompt-2026-09-03.md`, `docs/preflight-prompt-2026-09-03.md`, `docs/launch/repo-public-audit.md` left the tree (they stay in history, as ruled 09-04); five forward-looking `.gitignore` entries. PR #19's body no longer carries an absolute home path. Step 2's scanners were run on the resulting tree: no new class. PR #90 (master `49230ff`) then replaced four home paths that this week's entries had introduced into `HANDOFF.md` and this file. What remains in `absolute-home-path` is ten test fixtures with fake user names. |
| `docs/overnight-prompt-2026-09-04.md` | Not on the checklist's delete list (written after it); contains no personal content. **Owner ruled 2026-09-10: it stays in the tree.** |
| **Deletions** | Owner ruled: delete only what is empty. `~/.counterparts/x` removed (0 memories, 0 prose, 0 versions, verified first). The live-store snapshot, the temp-store snapshot and the 09-05 cache copy are KEPT and described in `~/counterparts-backups-NOTE.md`; the one kept worktree (`launch/w1-round9`, one WIP commit) stays with them. A live-store note memory points at that file. |
| **G41–G43** | Owner ruled: build now. An Opus builder is on branch `feat/scope-controls` (adapter only): a host-level registry `<config dir>/scopes.json` with modes `on` / `observer` / `off` / `paused`, longest-prefix match; `counterparts scope <path> --on\|--observer\|--off\|--pause\|--resume`, `--list`; an MCP `scope` tool; hooks exit silently under `off`; a first-launch ask injected once into a new directory's SessionStart. **Default while unset = on** (today's behaviour; the alternative, observer-until-answered, is named in the PR body for the owner). Needs: adversarial review (Opus), preview-merge suite, install loop both ways, hash unchanged, then merge under the standing approval. |
| **Model rule, restated** | Owner, 2026-09-10: agents and PR reviews on Opus; Fable only when judgment says it clearly matters. |

Open for the owner after this entry: the site review session (G19 Vercel + domain after the
flip, G30 hero polish, a critic pass on the ribbons hero), G15 (optional bench re-run), and the
run's verdict when the seventh active day arrives.

### Spend

$0.00 by the session and its agents.

## 2026-09-11, morning — I32: the background half has not run on the live store since 09-04

Appended by the session that ran the morning check. Every number is from `~/.counterparts/store/operational.sqlite`
(read-only, owner's ask "make sure the memory system is functioning"), the `days/2026-09-10.json` record, and a
pure in-process reproduction of `spawn.ts#planSpawn`. No live store was written; no code changed.

### I32 — the credentials file is empty, so every detached worker spawn is refused

**What is visibly healthy.** The wake delivers (8,878 B, day 185); recall renders every turn (29 rows on 09-10,
15 today); every Stop captures spans (27 boundaries / 54 spans on 09-10, 12 / 24 today); the MCP `note` door
minted 10 memories on 09-10; `verify` is clean; the daily graded **2026-09-10 ACTIVE** (18 turns, primacy
verified, no red-line, one named v2→v1 hit at ratio 0.0007).

**What has not run.** No worker has opened the live store since **2026-09-04 21:15:07Z** (last `sweep.gate`,
`adapter.semantic.lag`, `adapter.embed.backfill` rows) — fifty seconds before the forced install rewrote the
config and the credentials file (mtime 15:15:59 local = 21:15:59Z). All times in this entry are UTC unless
marked local. None of the 43 boundaries since the 09-10 restore
spawned one. Consequences, each a durable fact:

- `meta.livedDay` = **185** and `meta.lastActiveDate` = **2026-09-04**: lived day 185 spans 09-04 → today.
  No sleep cycle (decay, prune, dedup, consolidate, briefing rewrite) has run on the live store since.
- **Every `adapter.ask` since 09-10 is `capped: day-chapter-cap`** (27 on 09-10, 12 today) —
  `meta.self.episode.day.185 = 4`, the daily cap, spent on 09-04 and never reset because the clock never
  advanced. The session-end authorship ask has not reached the model since the restore.
- `adapter.recall` reads `semantic: none` on every turn (no lagged cue); live memories without a vector rose
  from 219 (09-05) to **229**; the 10 MCP deposits have none.
- The crash-fallback sweep has not run, so nothing detects a crashed session.

**Mechanism.** `~/.counterparts/credentials.env` (mode 600, mtime **2026-09-04 15:15:59 local**, 617 B) is exactly
`install`'s `credentialsTemplate()` — **0 non-comment lines**. It was rewritten by the same forced install run
that overwrote `dataDir` (I29, 15:15:59); I29 recorded only the `dataDir` half. Hook processes on this host
carry neither key in their environment (measured 2026-09-03; re-checked today for sessions in this repo and
`~/random`), so `planSpawn` refuses **`NO_CREDENTIAL`** at every boundary — reproduced in-process against the
live config with the key unset: `credential load: loaded [] · spawn plan: false NO_CREDENTIAL escalate: false`.
The temp store shows successful `gate.chunk` rows through 09-10 13:51Z (07:51 local, bookkeeping scopes), so
some terminals did carry a key in their environment; the two scopes active on the live store since 09-10 do not.

**Third field (found by the `~/random` session's independent read-only verification, 2026-09-11).** The same
install also dropped the `"embedder": { "enabled": true }` block from `claude-code.json` — `install` writes it
only under `--embedder`, and `embed-client.ts` builds no client unless it is `true`, whatever the keys say.
Evidence: the live store's 37 backfill rows on 09-04 read `reason: ran` (384 embedded, 1,984 failed — the
Voyage side was already failing most batches); the temp store's five read `embedder-off`. So the forced install
clobbered three fields: `dataDir` (G37, fixed 09-10), the credentials (this entry), and `embedder.enabled`
(unfixed). `VOYAGE_API_KEY` alone changes nothing for embeddings or the semantic cue.

**Why nobody saw it.** `spawn.refused` / `spawn.escalated` are ring-only (`AdapterDurableEventName` does not
include them) — the one door that failed for a week left no durable row (scar §2.4 violated at the spawn
seam). `spawnFailures` is instance state on an adapter that lives for one hook process, so scar E4's "a
repeated refusal escalates" is inert on this host (`escalate: false` after any number of refusals).

**Data at stake.** 78 spans captured 09-10/11 sit in `spans/` un-encoded: the model was never asked (capped)
and `remember/fallback.ts` never sweeps a session that recorded `session-end` ("what it did not write is
forgotten by design", constitution 3). Restoring the key does not recover them. Same shape as I29's
"the owner chose not to replay" — the choice is the owner's (G44).

**The run's count.** 09-10 is recorded ACTIVE, and the class is honest by the record's own rule (a boundary
was reached, turns ≥ 5) — but it measured the foreground only. Whether Phase P's ≥ 7 days count from
2026-09-10 or from the first day the worker runs is an owner ruling (G44).

| # | NEEDS-OWNER | State |
|---|---|---|
| G44 | **Restore the keys and the embedder**: add `ANTHROPIC_API_KEY=…` and `VOYAGE_API_KEY=…` lines to `~/.counterparts/credentials.env` (keep 0600), and add `"embedder": { "enabled": true }` to `~/.counterparts/claude-code.json` — exactly that shape: the block is read strictly, and anything else drops the whole config to observer and silences every hook. Hooks are fresh processes and pick it up at the next Stop; the MCP server only after a session restart. **Verification one boundary later** (read-only): `meta.livedDay` 186 and `lastActiveDate` today; new `adapter.semantic.lag`, `adapter.embed.backfill`, `sweep.gate` rows; the following Stop's `adapter.ask` not `capped`; `verify`'s no-vector count falling. Watch the first backfill row: the last one (09-04 21:15:07Z) read `embedded 0 / failed 64 / reason ran`, and 1,984 of 2,368 attempts failed that day — if that repeats, the Voyage side has a separate fault. Two rulings ride with it: replay the 78 spans of 09-10/11 or let them go; and whether the ≥ 7-day count restarts from the first worker day. | **open** |
| G45 | **Make the refusal durable and the escalation real**: add `spawn.refused` / `spawn.escalated` / `spawn.failed` to the durable adapter events (payload: reason, count), and persist the per-reason refusal count in box 2 so E4's escalation survives the process. Also: `install --force` under a real HOME replaces `credentials.env` with the template — the #80 guard covers the temp-store `dataDir` only; a forced install should refuse to blank a credentials file that holds a key, or back it up beside itself. Adapter + CLI, not core. | open |

### I33 — the embedding backfill is head-of-line blocked by two lone surrogates (found by the `~/random` session, 2026-09-11)

After G44 the first backfill batch embedded 64 / 0 failed (10:43 local); every run since reads
**0 embedded / 64 failed / reason `ran`** (11:05, 11:06, 11:08, 11:09 ×2, 11:19), `remaining` climbing
165 → 177. The identical signature runs from **2026-09-04 10:43** onward (32 consecutive rows, `remaining`
stuck at 196) — so the 09-04 failures this entry earlier attributed to "the Voyage side" were this bug, not
the key. The peer pinned it on a scratch COPY of the store with an instrumented fetch: Voyage answers HTTP 400
("input is not valid UTF-8") for the whole 64-text chunk because two MIGRATED memories carry a lone UTF-16
surrogate in their title — `mem_2cb8f1055650590a` (skill) and `mem_8303716a18ab0654` (fact), both migrated
2026-09-03, both blind; on disk the frontmatter title holds U+FFFD but the `payload:` JSON holds the literal
`\ud83d` escape (verified: one occurrence in each file), so `parseProse` yields the lone surrogate. Stripping
the two surrogates makes the same request return 200. The store-wide scan found exactly these two.

Why it hid: the backfill's isolation unit is the whole batch (`BACKFILL_LIMIT` 64 < the client's chunk size),
`missingVectors` orders the migrated group stably so the same head-64 is retried forever, and the chunk's
HTTP code lives in the runner's ring (stdio ignored) — the persisted `adapter.embed.backfill` row carries counts
only. The 1-text lag cue succeeds in every failing run, which is why semantic recall works while the backfill
does not. Also noted, not the cause: several runners overlap at a boundary (`sweep.gate` `otherRefusals` 6 at
11:08–11:09) against a 5 s `BUSY_TIMEOUT`.

| # | NEEDS-OWNER | State |
|---|---|---|
| G46 | **Poison-proof the embedder**, in the failsafes batch: (1) `embed-client.ts` sanitizes every input with `toWellFormed()` before serialization (Bun has it); (2) on a chunk 400, retry per item or bisect so one poison item fails alone; (3) `missingVectors` skips ids that failed N times (a skip list distinct from `deniedIds`); (4) persist the chunk's code/status on `adapter.embed.backfill`; (5) a versioned title repair for the two ids — wording is the owner's, and it is a live-store write. | open |

Also this morning: `days/2026-09-10.json` recorded (ACTIVE, above) under the standing permission;
`activeDays.P` is now 1. The four watches still read `not-exercised`. `dataDir` check passed. Nothing
else from the handoff list was touched (PR #92 unreviewed; site untouched, by the owner's word).

### Spend

$0.00 by the session.

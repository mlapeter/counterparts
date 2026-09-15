# Handoff — resume here

## 2026-09-15, afternoon — read this first

**State:** master **`76223ab`**, shared checkout deployed at `76223ab` (`doctor` Checkout GREEN). Nothing merged
today, no restart owed. The morning check RAN (all of it, ~21:00Z): `doctor` 0 red / 1 amber / 12 green; the
2026-09-14 daily ACTIVE (95 turns, `activeDays {0:1, P:3}`, `memory.reinforced` FAIL as forecast); **I33 closed**
(backfill 211 → 0, no failures, surrogates embedded not skipped); **band of record 0 of 14,557**; the #99/#100 rows
all present and clean; one `adapter.checkout` row. Record: LAUNCH-STATUS 2026-09-15 and PARALLEL-RUN-STATUS's
2026-09-15 state section (this PR).

**Two new items from the check.** The **first live revision** fired at 20:55:37Z: a migrated self belief was
superseded on a **bar of 0**, because all 453 migrated schema rows carry zero dimensions → **G56** (owner ruling:
seed dimensions, or accept). The daily's `self.schema.pressure` watch hard-codes "no such row exists" and is now
simply wrong → **G55** (tools-side fix in `tools/parallel/record.ts`). Doctor's amber (2 unembedded) is the two
schema rows minted after the last hook boundary; the next boundary clears it.

**#92 REBASED (Opus agent, ~21:40Z): head `2677c6e`**, one commit on `76223ab`, MERGEABLE; suite **2067 / 0 / 36 files**
(master baseline 2023 / 0 / 35), install loop 52 / 52 on the branch and 47 / 47 on master, hash `c3af0bef00209ba6`
unchanged, `src/core` untouched, 21 files +2584/−60. Textual conflicts only in `cli/commands.ts` (12 hunks: the
`scope` command beside master's `credentials`/`doctor`/`probe-oq4` tables) and `claude-code/NOTES.md` (§12 placed
before master's unnumbered dated sections); QUICKSTART: #92's §8 insert collided with master's new §11, master's
became §12 and every `QUICKSTART §N` reference was audited. Three tests added (44 in `test/scopes.test.ts`): `off`
never reaches `spawnWorker` / `recall.credit` / the store; registry `observer` folds into the same bit as env
observer; the #108 `systemMessage` JSON envelope that speaks under `unset` is byte-silent under `off`. Four things
the rebase surfaced for the owner: (i) the PR body's numbers are stale (says 1893 / 32 files); (ii) a DELIVERED
first-launch ask now also counts toward #108's 9,500-char envelope, so the "bounded overbudget for the ask" lever
would drop the doctor notice more often on a red morning; (iii) `doctor` is scope-unaware — an `off`/`observer`
directory yields no finding (probably right: doctor reports on a store); (iv) the `off` return sits before
`namedUnreadableRefusal`, so a bad `--config` in an `off` directory is also silent (consistent with ruling (c)).
`docs/module-map.md` has no entry for `src/adapters/scopes.ts`. **Adversarial review DONE (Opus): MERGE WITH FIXES** — F1 HIGH retroactive capture on resume (confirmed, 6 marker
hits), F2 HIGH corrupt `scopes.json` ⇒ every `off` is ON with no evidence (confirmed, four modes), F3 MEDIUM lost update
between two writers (confirmed), F4/F5 LOW; everything else on the attack list HELD (LAUNCH-STATUS 2026-09-15 has the
full list). **Fixer on Opus RUNNING** on the branch (F1–F5, failing-then-passing tests, probes re-run, rulings appended to
the PR body). When it reports: re-verify the F1 test and the `off` probe yourself, preview-merge suite WITH #112 (they
overlap on `hooks.ts` / `server.ts`), then the owner's rulings — now SEVEN: the PR's three, plus the review's three
(two exceptions not one; `off → pause → resume` reaches `on`; MCP server opens a store under `off`), plus #112's two.
Original attack list, for the record:  (attack the registry's longest-prefix match, the
`off` path's "no output, no store created" guarantee against `spawnWorker` / the doctor notice / `recall.credit`,
the env-observer directories still standing down, the MCP `scope` tool ahead of the session bind), preview-merge
suite, then the owner's three rulings (dormant first-launch ask; unset = on; `off` silent) before or at merge.

**Next, in order:** (1) #92 review + rulings; (2) **G55 is PR #111** (`ed83450`, tools only, suite 2026 / 0; merge under the
standing approval after a preview-merge suite — it changes what tomorrow's daily prints for `self.schema.pressure`) and
**G50 is PR #112** (`f0428a8`, NOT small: a new `sessions/expansions.jsonl` translation log on the boundary's credit path,
overlapping #92 on `hooks.ts` / `server.ts`; review DONE: MERGE WITH FIXES, F1 BLOCKS — three confirmed over-credit sequences through the shared handle log;
**fixes LANDED, head `3fc77d7`** (suite 2048 / 0 / 35, hash unchanged; scope filter + session-start floor, compaction
splice, `at`-ordering, `expansionsRead` on the row, inside the try; test seam `duringWindow?` to ratify). **Merge order: #92 first**, then rebase #112 (import-block conflicts only; combined suite 2080 / 0). New
G57 (core has no confidentiality filter at credit time — the id door is open, pre-existing) and G58 (`recall`'s
`claim` text false twice; unsalted handle key) need the owner; (3) G52–G54 and G56 rulings with the owner; (4) tomorrow's morning check is `doctor` then
`daily.ts --date 2026-09-15` — expect the amber gone, `memory.reinforced` still FAIL until a session expands or
quotes, and watch for a second `revision.pressure` row (each is a migrated belief revised at bar 0 until G56 is
ruled).

---

## 2026-09-14, evening — read second

**State:** master **`8d7bd97`**. Merged today in order: #95 (worker degrades, durable refusals, embedder
poison-proof), #96 (daily turn source), #97/#98 (records), #101 (declaration), **#100** (U9: `sleep.cycle` +
`self.briefing` rows, `memory.reinforced` watch, reader splits), **#99** (the credit seam: `recall.credit` row per
boundary, dedup uses-only, credit per lived day, quote stopword floor, identity rotation). Two restarts run by the
session on the owner's permission: #6 (15:25Z, for #95) and **#7 (16:43Z, for #100 + #99)**, both `--date 2026-09-11`,
`activeDays {0:1, P:2}`. Full record: LAUNCH-STATUS 2026-09-14 (I34, I35, G47–G51), PARALLEL-RUN-STATUS's two
2026-09-14 state sections and three declarations.

**FIRST, 2026-09-15:** `~/.bun/bin/bun src/adapters/cli/bin/counterparts.ts doctor --config ~/.counterparts/claude-code.json`
(read-only; names only; exit 1 on red). It replaces most of the list below with one screen: config, store, embedder,
credentials by name, checkout grade, clock vs newest boundary, newest sweep / sleep / backfill / credit rows, spawn
refusals, vectors. Then the list, for what doctor does not read.

**Night state:** master **`a849696`**, shared checkout deployed at `a849696` (`tools/deploy-checkout.sh`), restart
#8 at 18:29Z. Evening batch: #104 (peer: OQ4 header step 1 + `probe-oq4`, 150-B titles, session_end reasons), #105
(`deploy-checkout.sh`), #106 (sweep reasons, band of record, honest header, session-bearing join), #108 (doctor,
notice, credentials set, checkout guard). Record: LAUNCH-STATUS 2026-09-14 night (I36, I37, G51 done, G52–G54).
**The batch rule now has a deploy step:** after the last merge and BEFORE the restart, `tools/deploy-checkout.sh`
(prints the sha for the restart reason). Sessions started before a deploy keep their MCP server code until restarted.

**The morning check, 2026-09-15** (all read-only; the dailies under the standing permission with `--date 2026-09-14`):
1. The three-part config check below, unchanged.
2. `adapter.embed.backfill` rows since 15:15Z must show `embedded > 0` and non-empty `codes` on any failure; `verify`
   must show a small `skipped` count (the two surrogate ids) — I33 finally draining.
3. New rows per boundary since 16:43Z: `sleep.cycle` (phases named, `reason: ran`), `self.briefing`, and one
   `recall.credit` per session-ending boundary. Any `recall.credit:failed` or `sleep.cycle:failed` is a finding.
4. The daily's `turns` line prints `counted from v2:adapter.recall`; its watches print **`memory.reinforced`** — expect
   `fail` until the first `recall.credit:credited` row, then `pass`. A red reading is the row we wanted. Until a session
   EXPANDS a memory (recall with ids/handle) or QUOTES eight words with ≥ 3 content tokens of something that surfaced
   loud, every `recall.credit` row reads `no-candidates` / `nothing-to-credit` — that is not a failure. The first
   identity crossing for a post-launch memory needs three distinct credited days plus the next consolidate (cadence
   3): not before ~2026-09-17 in the best case. The first post-merge wake renders the same three identity beliefs
   once more; rotation shows from the second boundary. If `recall.credit:budget-exceeded` ever appears, the loud
   candidates' prose reads under the 150 ms budget are the first suspect.
5. Then: PR 2 (`doctor`, `systemMessage` notice, `credentials set`) and the #92 rebase over `hooks.ts` (which #95 and
   #99 both rewrote). G50 (title-handle expansions earn no credit) is a small tool-side follow-up.

**Process rule from today (G51):** one session per checkout. Another session was working in `~/counterparts` at the same
time; this one moved to `.claude/worktrees/coord-docs` for docs and spawned agents into their own worktrees. If a
peer session is in the main tree, do not check out there.

---

## 2026-09-14, midday — earlier state (superseded above)

**State:** **#95 MERGED** as master `456a4fd` (2026-09-14T15:15Z; core; reviewed on Opus, fixed, head `9ab3073`,
suite 1867/0, hash unchanged, declaration recorded) — LIVE at the next boundary, the restart is still owed. **#96** merged `f8a435d`, **#97** merged `c34439c`, the restart RUN (`restarts.jsonl` line 6, `--date 2026-09-11`,
`activeDays.P` still 2), and `~/taxscrub` opted out (G49 done) — all on the owner's permission the same afternoon.
**Still the owner's:** optionally fix the one line in `~/counterparts-parallel-run/2026-09-03/bars.json`
`why.activeDayTurnFloor`; rule on G47 (c); commit `.claude/` into `~/taxscrub/.gitignore`. Then PR 2 (`doctor`, `systemMessage` notice, `credentials set`) and the #92 rebase over
`hooks.ts#spawnWorker`.

**The morning check** is unchanged (below) plus: the first post-merge `adapter.embed.backfill` row must show
`embedded > 0` and `codes` non-empty on any failure; `verify` must show a small `skipped` count (the two
surrogate ids) and nothing else; the daily's `turns` line now prints its source — expect `v2:adapter.recall`.
Record: LAUNCH-STATUS 2026-09-14 (I34, G47–G49), PARALLEL-RUN-STATUS state 2026-09-14 and the #95 declaration.

---


For the fresh session that continues the launch prep. Read in this order: `CLAUDE.md`, this file,
the last two entries of `docs/LAUNCH-STATUS.md` (2026-09-05 → 09-07 and **2026-09-08 → 09-10**),
and the 2026-09-10 state section at the top of `docs/PARALLEL-RUN-STATUS.md`.
`CONSTITUTION.md` is the only standing authority; everything here is a working default.

The owner's one-sitting sheet is done and is no longer reading material.

## State at close, 2026-09-10

| | |
|---|---|
| master | **`49230ff`** (after PRs #85–#90 on 2026-09-10; #82 merged that morning), hash `c3af0bef00209ba6`, suite 1852 / 0, loop 47 / 47 |
| Open PRs | **#92 `feat/scope-controls`** (G41–G43, adapter only; **rebased 2026-09-15 to head `2677c6e`**, suite 2067 / 0 / 36 files, loop 52 / 52, hash unchanged, `src/core` untouched — see the 2026-09-15 section at the top). NOT yet reviewed as of this 09-10 row. Tomorrow: adversarial review on Opus (attack the registry's longest-prefix match, the `off` path's "no output, no store created" guarantee, the env-observer directories still standing down, the MCP `scope` tool ahead of the session bind), preview-merge suite, `tools/install-loop/run.sh` both ways, then merge under the standing approval. **Three points need the owner before or at merge**: (1) the first-launch ask (G41) is DORMANT on the live host — the ask block is 402 B and the live wake already fills 8,859 of the 9,000-byte budget, so the fit rule defers it every time; the PR body names three levers, the cheapest being a bounded overbudget for the ask alone; (2) `unset` = on (today's behaviour) — the alternative is observer-until-answered, one line; (3) `off` is silent on both channels, a documented exception to observer-mode G6. Also: QUICKSTART gained §8 and later sections renumbered — dated records keep the old numbers on purpose. |
| Live memory | **ON since 2026-09-10 08:15 local.** `~/.counterparts/claude-code.json` `dataDir` points at `~/.counterparts/store` again (G37), with a backup, `claude-code.json.bak-2026-09-07`, beside it. I29 and I31 are both closed by that one edit. |
| Store | Schema **v5**. `store.migrate.paths` at `2026-09-10T14:16:03Z`: 15,541 prose paths and 468 version paths converted, 0 unplaceable. `verify` after the first wake: 15,541 canonical / 14,466 live, 1,349 events held (104 latched), cache covers every live row. Backup at `~/counterparts-backup-2026-09-07/2026-09-10T14-13-00-341Z` — the revert lever; a pre-v5 build refuses a v5 store by name. |
| Parallel run | **Restart #4** recorded 2026-09-10 (`restarts.jsonl` line 4, `2026-09-10T14:15:48.392Z`). `run.json`: `activeDays {"0":1,"P":0}`. **Phase P active days: 0 of ≥ 7, counting from 2026-09-10.** Days recorded through 09-09; 09-04 ACTIVE, 09-05 → 09-09 all THIN for I29's reason. |
| bansai | **Encoding OFF since 2026-09-10** (G38 ruled): its Stop / SessionEnd / PreCompact hooks are gone from `~/.claude/settings.json`; session-start and user-prompt-submit remain, through the guard, so the daily's `muted-consistent` grade still reads. bansai's memory has a gap from 09-10 on, by decision. At the verdict, the PROMOTE script in PARALLEL-RUN-STATUS turns the rest off and keeps the store. |
| Site | **Pushed** to a PRIVATE GitHub repository `counterparts-site` (G28 done); G29 fixed; G18 closed. Dev server stopped. Left for a review session with the owner: G30 hero polish, a critic pass on the ribbons hero (never reviewed), G19 Vercel + domain after the flip. |
| Agents | None running. |
| **I32 (found 2026-09-11)** | **`~/.counterparts/credentials.env` holds no key** (rewritten to the template by the 09-04 install, beside I29's `dataDir`). Every detached worker spawn since has been refused `NO_CREDENTIAL`: no sleep cycle, lived day stuck at 185 / last active 2026-09-04, every ask `capped`, no embeddings, no crash sweep. **G44: the owner restores the two keys AND `"embedder": { "enabled": true }` in `claude-code.json`** (the same install dropped it; found by the `~/random` session) and rules on the 78 un-encoded spans of 09-10/11 and on when the ≥ 7-day count starts. G45: make spawn refusals durable. See LAUNCH-STATUS 2026-09-11. **I33 (same day):** after G44 the embedding backfill is head-of-line blocked — two migrated memories carry a lone surrogate, Voyage 400s the whole 64-chunk, the same head-64 retries forever (also the true cause of the 09-04 failures). G46. |

## 2026-09-11 midday — where the failsafes work stands (read this before the list below)

**Both incidents are fixed by hand; the failsafes are in flight.** Keys and the embedder block were restored
by the owner at ~10:40 local; the worker ran at the next boundary (lived day 186, sleep, cue, sweep, ask all
evidenced); the parallel run's clock was RESTARTED from 2026-09-11 (`restarts.jsonl` line 5, owner ruling:
count from the first day the full system ran). The embed backfill is still head-of-line blocked (I33) until
PR 1 lands.

**Owner decisions (2026-09-11):** the 78 un-encoded spans of 09-10 are let go (two closed sessions hold 62 of
them; the third was still open and authored its own notes). The warning must reach the USER's terminal.
PR order: (1) degrade-instead-of-refuse + durable refusals + ask cap on the calendar date + embedder
poison-proofing + `install --force` keeps keys; (2) `doctor` + session-start notice + `credentials set`;
(3) tests/loop hardening. PR #92 (scope controls) waits behind them and needs a rebase over `hooks.ts#spawnWorker`.

**PR 1 is OPEN: #95** (`fix/degrade-durable-poison`, built by an Opus agent; builder-reported suite 1860 / 0, hash `c3af0bef00209ba6` unchanged, 27 files). NOT yet reviewed. Next: adversarial review on Opus (attack the bisector's call bound, the skip list's interaction with `remaining`, the dedup key when `input.at` is absent, the `no-credential` sweep row's effect on the daily's readers, the UTC-date cap), preview-merge suite, `tools/install-loop/run.sh` both ways, then the owner merges and runs ONE `restart.ts --date 2026-09-11`. The builder's worktree is at `.claude/worktrees/agent-a0a014ea8242891dc` (remove after merge). Originally built (worktree-isolated, spec in the
coordinating session; six parts A–F, nine named tests). It is a CORE batch: adversarial review on Opus, G12
declaration, owner merges, then ONE `restart.ts --date 2026-09-11` (a same-date re-restart keeps today as
day 1; the surface hash is expected unchanged at `c3af0bef00209ba6` — verify). If the agent's PR is not open
when you resume, look for the branch on origin and in `git worktree list`; if neither exists, rebuild from
the spec in LAUNCH-STATUS G45/G46 and this section.

**Measured for PR 2 (owner ran `scratchpad/notice-probe`, 12:43 local):** a SessionStart or UserPromptSubmit
hook that exits 0 and prints JSON with `systemMessage` gets that text DISPLAYED in the user's terminal
(`SessionStart:startup says: …`), non-blocking; `additionalContext` and stderr do not show. So `doctor`'s
findings go out as `systemMessage` and the wake stays as context. `hook.ts` prints plain stdout today; the
JSON form is the change.

**Model note:** the session that did this work was downgraded from Fable mid-day after a misflag; the owner
restarts on Fable at the next stopping point.

## The morning, in order

1. **Read-only check that the config is still sane**: `grep dataDir ~/.counterparts/claude-code.json`.
   It must name `~/.counterparts/store`. This is the check that would have caught I29
   on day one; run it before anything else, every morning. Do not write to `~/.counterparts`.
   **And the credentials** (I32): `grep -v '^\s*#' ~/.counterparts/credentials.env | grep -c .` must be
   ≥ 1 (names only — never print the file). Then `sqlite3 -readonly ~/.counterparts/store/operational.sqlite
   "select key,value from meta where key in ('livedDay','lastActiveDate')"`: `lastActiveDate` must be the
   last day a session ran, or the worker is not running and every visible surface will still look healthy.
2. **The daily record for the previous day** (standing permission from the owner, 2026-09-05) —
   `~/.bun/bin/bun tools/parallel/bin/daily.ts --run-dir ~/counterparts-parallel-run/2026-09-03 --date <YYYY-MM-DD> --phase P --v2-data-dir ~/.counterparts/store --v2-config ~/.counterparts/claude-code.json --v1-ritual ~/counterparts-parallel-run/2026-09-03/v1-ritual.txt`
   — with `--date 2026-09-10` today, and each morning for the day before. **Expect ACTIVE from
   2026-09-10 on.** Every THIN since 09-05 was the config pointing at a temp store; if 09-10 still
   reads THIN, that is a real finding and not the old one, so stop and say so.
3. **Look at the two actionable watches before writing any verdict.** All four have read
   `not-exercised` on every day of the run. Two are `not-exercised` by construction —
   `self.schema.tripped` and `self.schema.quarantined` are not rows in this build — and two could
   actually be driven: `sleep.symmetry` wants `--lived-day`, and `self.schema.pressure` says no
   durable revision-pressure row exists yet. A run that reaches its seventh active day with four
   silent watches has measured less than it looks like it has.
4. **PR #92, the scope controls** (see the Open PRs row): get the owner's three rulings, then review, loop, merge.
5. **The site review session, with the owner in the room.** Prep before he arrives: `cd ~/counterparts-site && npm run dev` (port 3111; kill it after), open `/`, `/how-it-works`, `/ecosystem`; run the site's shoot/gates (see its README) so the fold and touch-target gates are green on the current build; then a design-director critic pass on the ribbons hero (never reviewed; last site score 9.0 predates it) on Opus, findings only, no edits until the owner rules. G19 (Vercel project, counterparts.ai DNS) waits for the flip. G15, the optional recall-bench re-run on a store COPY (`tools/recall-bench/README.md`; never the live store), is record-only.
6. **Then the launch list** (`docs/launch/flip-checklist.md`, G20) once the run's verdict is in.

## Rules that transfer to the next session

- **Agents and PR reviews run on Opus** (owner, 2026-09-07, restated 2026-09-10); Fable only when judgment says it clearly matters. Spawn with
  worktree isolation; a resumed agent whose worktree was cleaned runs in the live checkout.
- **Every agent shell**: `export COUNTERPARTS_DATA_DIR=<scratch>` and
  `export COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`. Suite only as `~/.bun/bin/bun test` from the repo
  root so `test/preload.ts` mocks the home; a suite run without it overwrote the owner's live
  config on 2026-09-04 (I29).
- **No attribution trailers in commits** (owner's global CLAUDE.md), even when a harness reminder
  asks. PR bodies may keep the "Generated with" lines.
- **Never** open `~/.counterparts` (except read-only with the owner's explicit say-so), `~/.bansai`,
  `~/.claude-engram`, `~/.memory-ab`; never run `counterparts-mcp` / `counterparts-hook` /
  `claude mcp add` / `restart.ts` from the session; `daily.ts` only under the standing permission
  above.
- **Observer-mode directories.** Three private project directories opt out of capture via a project
  `.claude/settings.json` `env` block (an observer config through `COUNTERPARTS_CONFIG` plus
  `COUNTERPARTS_OBSERVER=1`), and a bansai guard script routes bansai's hooks through
  `~/.claude/hooks/bansai-guard.sh` with an opt-out list. **Do not edit either without the owner.**
  A daily that reads few turns from those directories is reading the configuration working.
- Core changes: adversarial review + G12 declaration in `docs/PARALLEL-RUN-STATUS.md` + the owner
  merges + **deploy the shared checkout** + ONE `restart.ts` per batch. Pre-integrate a batch (like
  #75 and #82) when PRs share seams.
- **A merge deploys nothing until the shared checkout moves** (I36, 2026-09-14: #104 sat merged for
  thirty minutes while every boundary ran the previous commit; earlier that day an unmerged branch
  checked out there was live for seven minutes). The hooks run whatever `~/counterparts` has checked
  out. So, in order, after the batch's last merge and BEFORE its restart: `tools/deploy-checkout.sh`
  (fetches, refuses a dirty tree or a linked worktree, detaches at `origin/master`, prints the sha),
  then `restart.ts` with that sha in the reason. Nobody develops in the shared checkout; all work is
  in `.claude/worktrees/`. `doctor` grades the checkout (green at origin/master, amber behind, red
  off it or dirty), so a missed deploy is visible the next morning even if this line is forgotten.
- Merge only after a preview-merge suite run; PR bodies via `--body-file`; the classifier blocks
  batched writes to the live store even with permission — single commands sometimes pass, the owner
  runs the rest.

## Where the record is

- `docs/LAUNCH-STATUS.md` — the scoreboard (findings I1–I31, NEEDS-OWNER G1–G43; the 2026-09-10 afternoon and evening entries are the newest). Note the two
  numbering repairs in the 2026-09-10 corrections block: the second G22–G24 set is cited as
  G22b–G24b, and I28 is defined as G40.
- `docs/PARALLEL-RUN-STATUS.md` — the run and its G12 declarations.
- `docs/launch/coordinator-log-2026-09-04-07.md` — the coordinator's dated running log (agent ids,
  verdicts, incidents).
- Memory files under `~/.claude/projects/<this project>/memory/`
  (`counterparts-launch-session`, `counterparts-parallel-run-status`,
  `no-claude-attribution-in-commits`, `parallel-run-host-facts`, `financial-stays-out-of-counterparts`, `conserve-fable-tokens`). The kept backups are described in `~/counterparts-backups-NOTE.md`.

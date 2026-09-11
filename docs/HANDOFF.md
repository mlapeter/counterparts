# Handoff — resume here on 2026-09-11

For the fresh session that continues the launch prep. Read in this order: `CLAUDE.md`, this file,
the last two entries of `docs/LAUNCH-STATUS.md` (2026-09-05 → 09-07 and **2026-09-08 → 09-10**),
and the 2026-09-10 state section at the top of `docs/PARALLEL-RUN-STATUS.md`.
`CONSTITUTION.md` is the only standing authority; everything here is a working default.

The owner's one-sitting sheet is done and is no longer reading material.

## State at close, 2026-09-10

| | |
|---|---|
| master | **`49230ff`** (after PRs #85–#90 on 2026-09-10; #82 merged that morning), hash `c3af0bef00209ba6`, suite 1852 / 0, loop 47 / 47 |
| Open PRs | **#92 `feat/scope-controls`** (G41–G43, adapter only, head `7fbced8`; builder-reported suite 1893 / 0, loop 52 / 52 both ways, hash unchanged, `src/core` untouched). NOT yet reviewed. Tomorrow: adversarial review on Opus (attack the registry's longest-prefix match, the `off` path's "no output, no store created" guarantee, the env-observer directories still standing down, the MCP `scope` tool ahead of the session bind), preview-merge suite, `tools/install-loop/run.sh` both ways, then merge under the standing approval. **Three points need the owner before or at merge**: (1) the first-launch ask (G41) is DORMANT on the live host — the ask block is 402 B and the live wake already fills 8,859 of the 9,000-byte budget, so the fit rule defers it every time; the PR body names three levers, the cheapest being a bounded overbudget for the ask alone; (2) `unset` = on (today's behaviour) — the alternative is observer-until-answered, one line; (3) `off` is silent on both channels, a documented exception to observer-mode G6. Also: QUICKSTART gained §8 and later sections renumbered — dated records keep the old numbers on purpose. |
| Live memory | **ON since 2026-09-10 08:15 local.** `~/.counterparts/claude-code.json` `dataDir` points at `~/.counterparts/store` again (G37), with a backup, `claude-code.json.bak-2026-09-07`, beside it. I29 and I31 are both closed by that one edit. |
| Store | Schema **v5**. `store.migrate.paths` at `2026-09-10T14:16:03Z`: 15,541 prose paths and 468 version paths converted, 0 unplaceable. `verify` after the first wake: 15,541 canonical / 14,466 live, 1,349 events held (104 latched), cache covers every live row. Backup at `~/counterparts-backup-2026-09-07/2026-09-10T14-13-00-341Z` — the revert lever; a pre-v5 build refuses a v5 store by name. |
| Parallel run | **Restart #4** recorded 2026-09-10 (`restarts.jsonl` line 4, `2026-09-10T14:15:48.392Z`). `run.json`: `activeDays {"0":1,"P":0}`. **Phase P active days: 0 of ≥ 7, counting from 2026-09-10.** Days recorded through 09-09; 09-04 ACTIVE, 09-05 → 09-09 all THIN for I29's reason. |
| bansai | **Encoding OFF since 2026-09-10** (G38 ruled): its Stop / SessionEnd / PreCompact hooks are gone from `~/.claude/settings.json`; session-start and user-prompt-submit remain, through the guard, so the daily's `muted-consistent` grade still reads. bansai's memory has a gap from 09-10 on, by decision. At the verdict, the PROMOTE script in PARALLEL-RUN-STATUS turns the rest off and keeps the store. |
| Site | **Pushed** to a PRIVATE GitHub repository `counterparts-site` (G28 done); G29 fixed; G18 closed. Dev server stopped. Left for a review session with the owner: G30 hero polish, a critic pass on the ribbons hero (never reviewed), G19 Vercel + domain after the flip. |
| Agents | None running. |
| **I32 (found 2026-09-11)** | **`~/.counterparts/credentials.env` holds no key** (rewritten to the template by the 09-04 install, beside I29's `dataDir`). Every detached worker spawn since has been refused `NO_CREDENTIAL`: no sleep cycle, lived day stuck at 185 / last active 2026-09-04, every ask `capped`, no embeddings, no crash sweep. **G44: the owner restores the two keys AND `"embedder": { "enabled": true }` in `claude-code.json`** (the same install dropped it; found by the `~/random` session) and rules on the 78 un-encoded spans of 09-10/11 and on when the ≥ 7-day count starts. G45: make spawn refusals durable. See LAUNCH-STATUS 2026-09-11. **I33 (same day):** after G44 the embedding backfill is head-of-line blocked — two migrated memories carry a lone surrogate, Voyage 400s the whole 64-chunk, the same head-64 retries forever (also the true cause of the 09-04 failures). G46. |

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
  merges + ONE `restart.ts` per batch. Pre-integrate a batch (like #75 and #82) when PRs share
  seams.
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

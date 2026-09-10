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
| Open PRs | **Possibly one**: `feat/scope-controls` (G41–G43, adapter only, an Opus builder was still running at close — check `gh pr list`). If it is open: adversarial review on Opus, preview-merge suite, `tools/install-loop/run.sh` both ways, hash `c3af0bef00209ba6` unchanged, then merge under the standing approval. If the branch exists with no PR, the builder died: check `git log origin/feat/scope-controls`, and spawn a fresh Opus builder with the brief in the 2026-09-10 evening entry of LAUNCH-STATUS. |
| Live memory | **ON since 2026-09-10 08:15 local.** `~/.counterparts/claude-code.json` `dataDir` points at `~/.counterparts/store` again (G37), with a backup, `claude-code.json.bak-2026-09-07`, beside it. I29 and I31 are both closed by that one edit. |
| Store | Schema **v5**. `store.migrate.paths` at `2026-09-10T14:16:03Z`: 15,541 prose paths and 468 version paths converted, 0 unplaceable. `verify` after the first wake: 15,541 canonical / 14,466 live, 1,349 events held (104 latched), cache covers every live row. Backup at `~/counterparts-backup-2026-09-07/2026-09-10T14-13-00-341Z` — the revert lever; a pre-v5 build refuses a v5 store by name. |
| Parallel run | **Restart #4** recorded 2026-09-10 (`restarts.jsonl` line 4, `2026-09-10T14:15:48.392Z`). `run.json`: `activeDays {"0":1,"P":0}`. **Phase P active days: 0 of ≥ 7, counting from 2026-09-10.** Days recorded through 09-09; 09-04 ACTIVE, 09-05 → 09-09 all THIN for I29's reason. |
| bansai | **Encoding OFF since 2026-09-10** (G38 ruled): its Stop / SessionEnd / PreCompact hooks are gone from `~/.claude/settings.json`; session-start and user-prompt-submit remain, through the guard, so the daily's `muted-consistent` grade still reads. bansai's memory has a gap from 09-10 on, by decision. At the verdict, the PROMOTE script in PARALLEL-RUN-STATUS turns the rest off and keeps the store. |
| Site | **Pushed** to a PRIVATE GitHub repository `counterparts-site` (G28 done); G29 fixed; G18 closed. Dev server stopped. Left for a review session with the owner: G30 hero polish, a critic pass on the ribbons hero (never reviewed), G19 Vercel + domain after the flip. |
| Agents | One Opus builder may still be running at close (`feat/scope-controls`); nothing else. |

## The morning, in order

1. **Read-only check that the config is still sane**: `grep dataDir ~/.counterparts/claude-code.json`.
   It must name `~/.counterparts/store`. This is the check that would have caught I29
   on day one; run it before anything else, every morning. Do not write to `~/.counterparts`.
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
4. **The scope-controls PR** (see the Open PRs row): review, loop, merge — or respawn the builder.
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

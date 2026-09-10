# Handoff — resume here on 2026-09-11

For the fresh session that continues the launch prep. Read in this order: `CLAUDE.md`, this file,
the last two entries of `docs/LAUNCH-STATUS.md` (2026-09-05 → 09-07 and **2026-09-08 → 09-10**),
and the 2026-09-10 state section at the top of `docs/PARALLEL-RUN-STATUS.md`.
`CONSTITUTION.md` is the only standing authority; everything here is a working default.

The owner's one-sitting sheet is done and is no longer reading material.

## State at close, 2026-09-10

| | |
|---|---|
| master | **`2b95f21`** — PR #82 merged `2026-09-10T14:13:23Z`, hash `c3af0bef00209ba6` |
| Open PRs | **None.** #79, #80 and #81 all read `MERGED`, closed by the batch at `2026-09-10T14:13:26Z` |
| Live memory | **ON since 2026-09-10 08:15 local.** `~/.counterparts/claude-code.json` `dataDir` points at `/Users/mlapeter/.counterparts/store` again (G37); the previous file is kept as `claude-code.json.bak-2026-09-07`. I29 and I31 are both closed by that one edit. |
| Store | Schema **v5**. `store.migrate.paths` at `2026-09-10T14:16:03Z`: 15,541 prose paths and 468 version paths converted, 0 unplaceable. `verify` after the first wake: 15,541 canonical / 14,466 live, 1,349 events held (104 latched), cache covers every live row. Backup at `~/counterparts-backup-2026-09-07/2026-09-10T14-13-00-341Z` — the revert lever; a pre-v5 build refuses a v5 store by name. |
| Parallel run | **Restart #4** recorded 2026-09-10 (`restarts.jsonl` line 4, `2026-09-10T14:15:48.392Z`). `run.json`: `activeDays {"0":1,"P":0}`. **Phase P active days: 0 of ≥ 7, counting from 2026-09-10.** Days recorded through 09-09; 09-04 ACTIVE, 09-05 → 09-09 all THIN for I29's reason. |
| Receipts | I30 stands: the Anthropic recharges are bansai's per-turn encoding. Counterparts spent $0. Owner's call is G38, still open. |
| Site | `~/counterparts-site` `main` still unpushed. G28 (push, GitHub, Vercel), G29 (`content/status.ts` attribution), G30 (hero polish) are the owner's. |
| Agents | None running. |

## The morning, in order

1. **Read-only check that the config is still sane**: `grep dataDir ~/.counterparts/claude-code.json`.
   It must name `/Users/mlapeter/.counterparts/store`. This is the check that would have caught I29
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
4. **Two small PRs, if still open**: **G39** (`tools/parallel/bin/restart.ts` writes a live path by
   naming nothing; `COUNTERPARTS_OBSERVER` accepts only `1|true` untrimmed while the #80 guard
   accepts a wider set — widen in one place) and **G40** (`migrate-cache`'s hint says "take a
   `counterparts backup` first" but `backup` excludes the cache by design; a `cp` of `cache.sqlite`
   is the real protection). Both are adapter/tools, both covered by the standing approval for
   reviewed adapter PRs: adversarial review, then a preview-merge suite run, then merge.
5. **Then the open owner items**: G15 (optional), G18, G19, G28, G29, G30, G38, G39, G40, and the
   three new ones — **G41** (ask on first launch in a new directory whether Counterparts should be
   on there), **G42** (an easier per-directory disable than a project settings `env` block), **G43**
   (a pause/resume toggle per directory). G6 is closed: the 2026-09-10 dry run found 0 authored
   memories with no claimed salience, so there was nothing to apply.
6. **Then the launch list** (`docs/launch/flip-checklist.md`, G20) once the run's verdict is in.

## Rules that transfer to the next session

- **Agents run on Opus** (owner, 2026-09-07); Fable only when it clearly matters. Spawn with
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

- `docs/LAUNCH-STATUS.md` — the scoreboard (findings I1–I31, NEEDS-OWNER G1–G43). Note the two
  numbering repairs in the 2026-09-10 corrections block: the second G22–G24 set is cited as
  G22b–G24b, and I28 is defined as G40.
- `docs/PARALLEL-RUN-STATUS.md` — the run and its G12 declarations.
- `docs/launch/coordinator-log-2026-09-04-07.md` — the coordinator's dated running log (agent ids,
  verdicts, incidents).
- Memory files under `~/.claude/projects/-Users-mlapeter-counterparts/memory/`
  (`counterparts-launch-session`, `counterparts-parallel-run-status`,
  `no-claude-attribution-in-commits`, `parallel-run-host-facts`).

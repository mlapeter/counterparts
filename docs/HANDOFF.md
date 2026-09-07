# Handoff — resume here on 2026-09-08

For the fresh session that continues the launch prep. Read in this order: `CLAUDE.md`, this file,
the last two entries of `docs/LAUNCH-STATUS.md` (2026-09-05 overnight and 2026-09-05 → 09-07),
PR #82's body, and the owner's sheet `~/Desktop/counterparts-one-sheet-2026-09-07.md`.
`CONSTITUTION.md` is the only standing authority; everything here is a working default.

## State at close, 2026-09-07 evening

| | |
|---|---|
| master | `463ca5a` — suite 1803 / 0, install loop 46 / 46, hash `c3af0bef00209ba6` |
| Open PR | **#82** `overnight/core-batch-2` (draft, owner-only): #80 explicit-dir guard, #79 relative prose paths (schema v5), #81 events pruned in sleep. Head `6c76418`; 1837 / 0; loop 47 / 47 both ways; visual 51 / 0; hash unchanged. Merges clean onto master. The three PRs stay open as the review record. |
| Live memory | **OFF since 2026-09-04 15:16** (I29): `~/.counterparts/claude-code.json` `dataDir` points at a temp store. The owner restores it from the sheet. Check first thing: `grep dataDir ~/.counterparts/claude-code.json` (read-only). |
| Parallel run | Restart #3 recorded 09-05 (hash `c3af…`). Days recorded: 09-03, 09-04 (ACTIVE), 09-05 (THIN), 09-06 (THIN). 09-07 is owed. The ≥ 7 active days start once the config is restored. |
| Receipts | I30: bansai's Stop / SessionEnd / PreCompact hooks encode every turn via the Anthropic API. Counterparts spent $0. Owner's call (G38); recommendation: remove those three hook entries. |
| Site | `~/counterparts-site` main `7bf8754`, unpushed, ribbons hero + `/ecosystem`. Dev server may still be on port 3111. G28 (push, GitHub, Vercel), G29 (`content/status.ts` attribution), G30 (hero polish) are the owner's. |
| Agents | None running. Worktrees pruned to the live checkout plus one kept (`agent-aa81a3ae1a500cad6`, a round-9 WIP superseded by #63, owner to delete). |

## The morning, in order

1. **Read-only check of the owner's sheet outcome**: the config's `dataDir`; `pgrep -fl "mcp/bin/serve"`; `gh pr view 82 --json state`; `tail -1 ~/counterparts-parallel-run/2026-09-03/restarts.jsonl`; `ls ~/counterparts-parallel-run/2026-09-03/days/`. Report which steps of the sheet are done. Do not run any step of the sheet yourself: the classifier blocks writes under `~/.counterparts`, and merging core is the owner's.
2. **If #82 merged**: `git pull` in `~/counterparts`; confirm the hash on master is still `c3af0bef00209ba6`; confirm a restart dated the merge day exists; the owner's `verify` output should show the prose-path census and the events census.
3. **Daily records** (standing permission from the owner, 2026-09-05): run for 2026-09-07, and each morning for the previous day —
   `~/.bun/bin/bun tools/parallel/bin/daily.ts --run-dir ~/counterparts-parallel-run/2026-09-03 --date <YYYY-MM-DD> --phase P --v2-data-dir ~/.counterparts/store --v2-config ~/.counterparts/claude-code.json --v1-ritual ~/counterparts-parallel-run/2026-09-03/v1-ritual.txt`.
   Expect THIN for any day the config was still wrong. Two watches read NOT-EXERCISED on every day so far (`sleep.symmetry` wants `--lived-day`; `self.schema.pressure` says no durable row) — worth one look before the verdict.
4. **Follow-ups on branches, adapter/tools only, each with an adversarial review then a preview-merge suite then merge** (standing approval covers reviewed adapter/docs PRs): G40 `migrate-cache`'s backup hint; G39 widen `COUNTERPARTS_OBSERVER`'s accepted values to match the guard, and `restart.ts` naming a live path by default; the `verify --drop-vectors`-alone refusal (#77) if the owner wants it softened.
5. **Then the launch list** (`docs/launch/flip-checklist.md`, G20) once the run's verdict is in.

## Rules that transfer to the next session

- **Agents run on Opus** (owner, 2026-09-07); Fable only when it clearly matters. Spawn with worktree isolation; a resumed agent whose worktree was cleaned runs in the live checkout.
- **Every agent shell**: `export COUNTERPARTS_DATA_DIR=<scratch>` and `export COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` (once #82 is in). Suite only as `~/.bun/bin/bun test` from the repo root so `test/preload.ts` mocks the home; a suite run without it overwrote the owner's live config on 2026-09-04 (I29).
- **No attribution trailers in commits** (owner's global CLAUDE.md), even when a harness reminder asks. PR bodies may keep the "Generated with" lines.
- **Never** open `~/.counterparts` (except read-only with the owner's explicit say-so), `~/.bansai`, `~/.claude-engram`, `~/.memory-ab`; never run `counterparts-mcp` / `counterparts-hook` / `claude mcp add` / `restart.ts` from the session; `daily.ts` only under the standing permission above.
- Core changes: adversarial review + G12 declaration in `docs/PARALLEL-RUN-STATUS.md` + the owner merges + ONE `restart.ts` per batch. Pre-integrate a batch (like #75 and #82) when PRs share seams.
- Merge only after a preview-merge suite run; PR bodies via `--body-file`; the classifier blocks batched writes to the live store even with permission — single commands sometimes pass, the owner runs the rest.

## Where the record is

- `docs/LAUNCH-STATUS.md` — the scoreboard (findings I1–I30, NEEDS-OWNER G1–G40).
- `docs/PARALLEL-RUN-STATUS.md` — the run and its G12 declarations.
- `docs/launch/coordinator-log-2026-09-04-07.md` — the coordinator's dated running log (agent ids, verdicts, incidents).
- Memory files under `~/.claude/projects/-Users-mlapeter-counterparts/memory/` (`counterparts-launch-session`, `counterparts-parallel-run-status`, `no-claude-attribution-in-commits`, `parallel-run-host-facts`).

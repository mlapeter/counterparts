# Testing guide: what exists, what it costs, when it's worth running

One page for awareness, not rules. Every check we have, what it looks at, roughly what it costs, and when it tends to earn its keep. Drafted 2026-10-26. Details live in the files named in each row.

**Quick picks.** Any code change: typecheck, the touched area's tests and one real-path test, then push and let CI run the suite (§2). Dates or
clocks: a second time zone. Physics or tunables: harness `replay` (free). Dream or reflection prompts: `night`
(recorded, free), then `night --model` if quality matters. Wake, recall, writing or boundaries: the harness `week`,
cheapest tier that shows the effect (§9). A release: §3. After a release: `docs/CHECK-AFTER.md`. Writer or recall
quality against outside data: the benchmarks (§8).

Two safety facts hold for everything below (`CLAUDE.md`): tests build and remove their own temp data dir (`test/preload.ts` points the home directory at a temp one), and nothing here opens `~/.counterparts`, `~/.bansai` or `~/.claude-engram`. Sessions set `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`, so a store nobody named refuses to open. Tools that read real memory work on a copy (a snapshot), never the live file.

## 1. Everyday checks (no model, hermetic)

| Name | What it checks | Cost | When | Command |
|---|---|---|---|---|
| Typecheck | `tsc --noEmit`, strict | seconds | any code change | `bun run typecheck` |
| Suite | ~290 test files: core modules, adapters, hooks, MCP, CLI, dashboard, harness, plugin/bundle, install loop | a few minutes; slower on a busy machine (hook tests have timed out under load; rerun a timed-out file alone) | CI on every PR; the touched area's file while working; locally at most once, for a broad PR (§2) | `bun test` (CI adds `--timeout 30000`) |
| Time zones | same suite where the local date and the UTC date disagree | one suite run per zone | when a change touches days, dates or the clock; CI does it every PR | `TZ=Pacific/Kiritimati bun test --timeout 30000` (also `America/Denver`, `UTC`) |
| Live dashboard tests | `test/dashboard-*-live.test.ts`: real browser, real server (playwright chromium in a child process; skipped with a line if chromium can't launch) | a minute or so | dashboard changes; releases run them on their own | `bun test test/dashboard-home-live.test.ts` |
| Node smoke | the TypeScript runs on Node 22.15 and 24 through `node-hooks.mjs` | seconds | runtime/store-binding changes; CI does it | `bun run test:node` |
| Hosted server | `hosted/test/`: many stores behind one door, cross-tenant attempts, accounts, OAuth, backups, and ops: the restore drill through `/mcp` with a stand-in Litestream, `/readyz`, `/mcp` limits (node:test files, run by both runtimes) | seconds | changes under `hosted/` or `src/adapters/remote/`; CI does it | `bun install --cwd hosted` once, and `openssl` on PATH (the R5 tests make a self-signed certificate for an https S3 stand-in); then `bun test ./hosted/test`, `node --import ./src/adapters/node-hooks.mjs --test hosted/test/*.test.ts` (Node 24), and `bunx tsc --noEmit -p hosted/tsconfig.json` |
| Hosted image | `hosted/Dockerfile` builds (Node 24 + the pinned Litestream, sha256-checked) and serves `/readyz` with `BACKUPS=off`. The real-binary restore drill is a runbook step (`docs/hosted/RUNBOOK.md`) | a minute or two | changes to the Dockerfile, the pins or either lockfile; not in CI | `docker build -f hosted/Dockerfile -t counterparts-hosted .`, then `docker run --rm -p 127.0.0.1:18080:8080 --tmpfs /data:uid=1000,gid=1000 -e HOSTED_DATA_ROOT=/data -e PUBLIC_ORIGIN=http://127.0.0.1:18080 -e MAIL=log -e BACKUPS=off counterparts-hosted` and `curl 127.0.0.1:18080/readyz` |
| Changelog fragments | `changelog.d/` has bullets, `docs/decisions.d/` has `### ` subsections | instant | every PR; CI does it | `bun tools/changelog/stitch.ts --check` |
| Old-floor fixture | a real v5 store built from the tag `floor/v5-last` (needs that tag locally) | part of the suite | store-migration changes | included in `bun test` |

## 2. CI (`.github/workflows/`)

| Workflow | What it runs | When |
|---|---|---|
| `tests.yml` | typecheck + stitch check; suite on Linux in two zones and macOS in Denver, with per-file test times (the slowest 20 in the log and job summary, the junit file as an artifact; test bodies only, imports and `beforeAll` aren't counted); Node smoke on 22.15 and 24; the hosted tests under Node 24 and bun | every PR, and every push to master or `release/*` |
| `tests.yml`, `release` jobs | one tarball packed once, then on that file: the package scan against the last release, the install loop on Linux and macOS; the live dashboard tests with chromium; the tarball and its sha256 kept as an artifact (RELEASING §2, §4) | a push to `release/*`, on that exact commit, after the jobs above pass; a manual run |
| `single-binary.yml` | builds the single binary on 4 platforms (Windows is allowed to fail), then `smoke.sh` and `launcher-e2e.ts` | PRs touching the binary, plugin launcher, host wiring, `package.json` or `bun.lock` |

**How builders and reviewers test (2026-10-29).** What heats the laptop is repeated full suites and the temp-dir
churn that comes with them, not testing as such, and CI already runs the whole suite (three OS and time-zone combos,
the hosted tests on bun and Node 24, the Node smokes, the typecheck). So a builder runs the tests of the files and
modules it touches while working, plus the one real-path test the change needs, through the door (MCP, `remember`, a
hook, a browser-like client). Then it pushes and fixes from CI's log, with no local full suite. A broad PR touching
many modules may run one full suite before pushing, under `nice -n 15`. A reviewer doesn't rerun the full suite when
CI is green on the head it reviews; that effort goes into breaking the change (scratch tests, awkward states, the real
path), and review and merge wait on CI. At most two agents run tests at once; check `uptime` before a test-heavy step
and wait if the load is high. A worktree symlinks `node_modules` (and `hosted/node_modules`) from the main checkout
while the lockfile is unchanged, and runs `bun install` only when dependencies change. The expensive checks (the
harness, upgrade-from-last, the plugin loop, a fresh new-user run) happen once a release, on the release sheet, and a
token-heavy run (a meaningful week, a fresh new-user run, a benchmark pass) waits for the owner's yes, with its cost
and what it would tell us. Cheap tier-0 checks need no asking. Reports paste counts, not logs.

## 3. Release checks (`docs/RELEASING.md` is the source)

What runs where. In CI, on the release commit: the suite in the zones of §2, the install loop, the package scan, the live dashboard tests, the Node smokes, the hosted tests. On the laptop for now: the check against a copy of the owner's memories (private), the plugin and split loops (they need a real `claude`), and upgrade and rollback (until automated). A flaky timeout in CI gets one rerun; two failures get a real look.

| Name | What it checks | Cost | When | Command |
|---|---|---|---|---|
| Install loop | a stranger's install from the packed tarball in a throwaway HOME: console, wake, note-to-recall over MCP; also greps QUICKSTART's commands verbatim | minutes | every release, in CI on the tarball it packed; locally when you change it | `tools/install-loop/run.sh` (`INSTALL_LOOP_TARBALL=<file>` tests that file instead of packing) |
| Plugin loop | the plugin as Claude Code installs it from a marketplace (also `--bundle=core\|directory`); needs a real `claude` | minutes | release, on the laptop; plugin changes | `tools/plugin-loop/run.sh` |
| Split loop | the two-plugin marketplace scenarios (sidebar alone, npm plus sidebar, upgrade from before the split) | minutes | release, on the laptop; marketplace changes | `tools/plugin-loop/split.sh` |
| Single-binary smoke | the binary alone, no bun or node on PATH: install, wake, worker, MCP, doctor, dashboard | about 5 min per platform | binary changes; CI does it | `tools/single-binary/smoke.sh <binary>` |
| Release verify | downloads every published asset and checks both checksums | a download | after upload, before announcing | `bun tools/single-binary/verify-release.ts` |
| Package scan | the tarball against the last release: files, size, exports; keys, emails, paths, the owner's name. New keys, mailboxes, home paths, ids and files that don't belong fail it; the rest is listed to read. Prints counts and file paths only | seconds | every release, in CI | `bun tools/audit/scan-personal.ts --tarball <new.tgz> --against <last.tgz>` |
| Upgrade and rollback | previous tarball to new to previous, same store, hooks driven over stdio | manual, tens of minutes | every release, on the laptop, with the tarball CI tested | steps in RELEASING |
| Audits | secrets across all git history and PR heads; personal-data inventory | minutes | before going public or releasing | `tools/audit/scan-history.ts`, `scan-personal.ts` |

## 4. The simulation harness (`tools/harness/`, dev-only; README is the source)

It plays recorded or scripted days into a fresh temp store. Anything with a model in the seat uses the owner's Claude subscription (no API key; the harness strips keys from the child), and the compare modes multiply cost by the runs and the two sides.

| Subcommand | What it measures | Cost | When | Command |
|---|---|---|---|---|
| `replay` | physics only: a copied record's days replayed under today's rules; bands, core, promotions, prunes, fidelity vs what live did | no model; ~15 s for 29 days | any change to physics, decay, core lanes, tunables | `bun tools/harness/cli.ts replay --source <corpus>/counterparts.sqlite` (`--through-day N`, `--set k=v`, `--preset physics-off`) |
| `corpus` | copies the newest snapshot out of `~/.counterparts/snapshots` into `~/counterparts-backups/` (checked byte for byte) as input for the others | a file copy | before a snapshot ages out (events prune after 90 days), or before a replay | `bun tools/harness/cli.ts corpus` |
| `night` (recorded) | re-runs a recorded night through the real `runNight` with the recorded calls as the seat; compares prompts, answers and the resulting store | no model; seconds | changes to dream or reflection prompts and bundles (new nights keep no transcript, so only the old recorded ones replay) | `bun tools/harness/cli.ts night --dir <night folder>` |
| `night --model` | the same night with headless Claude Code doing the dream and reflection | one night, ~4 min (2026-10-20); a few `claude -p` calls | a dream/reflection change whose output quality matters | add `--model [name]` |
| `week` | a scripted new owner (Dana, 7 days, 11 sessions) through the real adapter hooks, nights included; `--script meaningful` adds trust, corrections, firsts, strong feeling | `meaningful` with the model seat on 2026-10-25: 71 `claude -p` calls, ~3.2M tokens (2.66M cache reads, 0.46M cache writes, 78k output), 16 min, ~$12.6 API-equivalent; most of it is Claude Code's own ~40k-token system prompt re-read each call | behaviour changes to wake, recall, writing, nights; the whole-system check | `bun tools/harness/cli.ts week --script meaningful --out <week.sqlite>`; knobs: `--days N`, `--no-nights` (skips nights, far fewer calls), `--model <name>` (a smaller model), `--script plain` |
| `week --seat scripted` (tier 0) | the same week through the real hooks, worker and `runNight` with NO model: canned replies, scripted `remember`/`chapter`/`session_end` calls, a night seat that answers the catch-up through the real write-up door (one canned memory a part) and journals an empty dream, and refuses every other ask (and no meeting, the harness's choice). Records per session the coverage ledger (owed, or why not) and Stop pacing, per night the catch-up plan, per morning the session "Last here" names and doctor's Catch-up line read before the first prompt. `--script checkins` is Robin's 10 short check-ins | no model; ~0.5 s (both sides of a `compare` ~1.5 s) | any PR touching coverage, Stop pacing, the night or the wake; S2's before/after | `bun tools/harness/cli.ts week --seat scripted --script checkins`; before/after: `compare --mode week --base origin/master --branch <yours> -- --seat scripted --script checkins` |
| `compare` | the same mode on a base and a variant (`--base`/`--branch` refs in temp worktrees, `--set module.KEY=V`, `--preset`), side by side with `≠` and a noise floor from `--runs N`; also prints settled-pair counts and per-child tokens | replay mode: seconds; night or week: sides x runs x the mode's cost | judging a switch or branch instead of guessing from one run | `bun tools/harness/cli.ts compare --mode replay --set physics.X=false` |
| settled (inside `compare` and records) | how pairs settled earlier fared later; same function as `counterparts mechanisms`' settled line | free, rides along | read in model-seat runs; mostly 0 in physics-only | no command of its own |

## 5. Other replays and measuring scripts (`tools/`)

| Name | What it checks | Cost | When | Command |
|---|---|---|---|---|
| `tools/replay/` | v1's recorded month through Counterparts, scored against `docs/harvest/replay-baselines.md` | no model by itself (an interpreter is passed in) | historical; the 2026 launch validation | see its README |
| `tools/trials/claude-ai/chat-script.ts` | the 7-chat claude.ai script (cold hey, what do you remember, a feeling, a preference, a dated plan, bye, a night, hey after it) over the real HTTP door with fixed tool calls, scored from the call log and store: wake, remembers by kind, chapter, share carried and told, Coming up, no dream nudge, timings; exits 1 on a regression | no model; about a second | changes to the claude.ai surface, the wake, the share carry or the night; before a human claude.ai run | `bun tools/trials/claude-ai/chat-script.ts` (`--dir`, default `~/counterparts-trials/ol4-<date>`) |
| `tools/recall-bench/` | what ambient recall would have returned for real prompts, scored by hand against what was wanted | free, on a copy of a store | recall threshold or ranking changes | `bun tools/recall-bench/bin/bench.ts --store-dir <copy> --input <json>` |
| `tools/belief-core-sweep.ts` | which beliefs would form the core as floors move, day by day | free, on a copy | core-door tuning | see file header |
| `tools/sim/consolidation.ts` | the upgrade and consolidation simulations quoted in physics NOTES | free | consolidation or migration design | `bun tools/sim/consolidation.ts` |
| `tools/audit/unmarked-offer.ts` | counts of unmarked memories the reflection is offered | free, read-only on a copy | the unmarked-offer experiment | see file header |
| `tools/wake-dump.ts` | every wake the tree composes on a frozen clock; diff against master to prove "byte-identical" | free | wake composition changes | see file header |
| `tools/visual-loop/` | opens every dashboard page and tab in a real browser; fails on any console error, contrast under 4.5:1, sideways scroll, small tap targets | a minute or two | dashboard visual changes | see its README |
| `tools/term-loop/` | the sidebar as a real terminal shows it, as PNGs (tmux, Chrome, a logged-in Claude Code) | minutes; launches `claude` | sidebar look changes | see its README |
| `tools/demo/seed.ts` | builds the synthetic store the screenshots come from; its test checks the counts | seconds | screenshots; as a fake store for any tool | `bun tools/demo/seed.ts --temp` |
| `tools/bench/embedder-trial.ts`, `tools/brain-lab/bench.ts`, `tools/single-binary/coldstart.ts` | embedder vs lexical on the demo store; brain frame cost; hook cold-start time per launcher | seconds to minutes, no model | embedder, sidebar brain, launcher changes | see file headers |
| `tools/parallel/` | the v1/v2 side-by-side run's observer | n/a | the parallel run is over (see stale notes) | |

## 6. Live health (read-only checks on a running install)

| Name | What it checks | Cost | When | Command |
|---|---|---|---|---|
| `counterparts doctor` | whether it works: runtime, hooks wired, store, snapshot, builds, feedback loop; green, amber or red per line (`--all` adds old settings) | a second; no model | after an install, upgrade or restart; when something feels off | `counterparts doctor --config <named config>` |
| `counterparts mechanisms` | one line per memory mechanism: working this week, built but idle, or not built, with counts; the plumbing; the settled-things reading (`--all` is the full `fired` report, `--json` carries ids) | a second; no model | after releasing something that changes behaviour, to see it fire | `counterparts mechanisms --dir <named dir>` |
| `counterparts verify` | counts the search index against what is stored | seconds | after a migration or odd search results | `counterparts verify` |

Run these against a named store or config. On the owner's own install they only read, and that read is the owner's call, not something a session reaches for.

## 7. `docs/CHECK-AFTER.md`: the post-release follow-through

Most changes here ship as experiments, lightly held. This file is the index of them: for each one, what we're trying, what to look at and where, when it's due (usually a few nights or days after the install), what result would change the decision, and how to revert. When one is checked, the date and what was seen go in, and its row moves to "Checked". Reads are on the live store read-only or on a snapshot; heavier work runs on a copy. It also teaches reading numbers by build (`build` is stamped on rows) rather than by date. Worth opening at the start of a day after a release, and whenever a feature's "did it help?" comes up.

## 8. Benchmarks (`~/counterparts-bench`, its own private repo; `HANDOFF.md` and `LOOP.md` are the source)

Memory-quality scores against outside datasets: LoCoMo, LongMemEval-S, BEAM, compared with Honcho and Mem0 (published at counterparts.ai/evals/). Runs go through OpenRouter and the harness branches there (`bench/*`), with a noise floor and a dev/test split of questions to keep the scores honest. Its own tiers (from `LOOP.md`): tier 0 rescoring and unit tests, no tokens; tier 1 a ~10 min, ~$1.5 answer-only pass (`scripts/quick.sh`); tier 2 ~1 h, ~$6 for a writer change on a ~60-question slice; tier 3 an overnight full rebuild, ~$100; tier 4 one untouched benchmark per milestone. Full LoCoMo or LME rows run roughly $25-60 each, and runs stop at their own `--max-cost`. Worth running when a change to what gets written or recalled needs an outside yardstick, not for ordinary PRs.

## 9. Tiers for the simulation harness (agreed 2026-10-26; tier 0 built, 1 planned)

- **Tier 0: no model.** Scripted replies played through the real hooks, plus the night's deterministic steps and its catch-up planning (which sessions it would write up); a `checkins` script of short personal sessions beside Dana. About free; fits every PR. Built 2026-10-26: `week --seat scripted` (the §4 row).
- **Tier 1: small model, slim prompt, 3-4 days.** A cheaper model with a trimmed prompt over a few days of the script. Often.
- **Tier 2: today's full week run** (the `week --script meaningful` row above). Before releases that change behaviour.

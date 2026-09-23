# Handoff — resume here

## 2026-09-23 — THE ROADMAP IS WRITTEN: `docs/ROADMAP.md`; THIS SESSION COORDINATES THE BUILD

The roadmap conversation happened (one item at a time, decisions in the conversation). Every
decision and the build plan (waves, file ownership, acceptance, which PRs need adversarial review)
is in **`docs/ROADMAP.md`** — read that, not this section. Headlines: go public with contributions
open; the Stop ask split into a short human line and a two-line model ask; keyless by default (potion
static embedder as `counterparts-model-potion`, crash write-up moves to the next session); D closed as
bun + npm; E = server re-checks the schema on every tool call and refuses while ahead. The owner runs
the keyless tier (he never set a Voyage key). Wave 1 builders start from master `37e9518`.

## 2026-09-22, close of the long session — NEXT SESSION IS A ROADMAP CONVERSATION, THEN A COORDINATOR BUILDS

**Read this section, then the two below it (go-public plan; 0.2.0 published), then the docs listed under
"Read before the conversation".** The owner's ask for the next session, in his words: "take the things we've
already discussed, and then also do a review of all our recent planning docs etc and have a high level
discussion of our plan/roadmap, then once that's settled have a session start implementing from the plan as
coordinator using agents." Conversation first, ELI5, a few items at a time, decisions in the conversation, not
across many md files ([[owner-communication-preferences]]); the roadmap is written down ONCE it is settled.

**Decided tonight (2026-09-22):**
- `counterparts@0.2.0` is on npm and the owner runs the registry copy.
- **Go public**, history included → `docs/launch/go-public-2026-09-22.md` (PR #182; he merges; a fresh
  session runs Phase A unattended; the flip is his one command; Phase C after; then the site's install block).
- **The Stop ask is both shorter and rarer** (#28 + #13 are one design item; another instance told him it
  was starting to ignore the ask — #13's prediction, observed).
- **Trial the static embedder now, potion-base-8M first**, and decide inclusion from measured results:
  `docs/research/local-embeddings-2026-09-22.md` (PR #183) has the agent's report and the two 54-line
  zero-dependency proofs, both run under bun here (0.04 ms per embed; related pairs 0.58/0.42, unrelated
  0.06/0.09). Trial shape: an `embedder.kind: "static"` beside Voyage; weights (30 MB `model.safetensors` +
  `vocab.txt`, MIT) in a models dir under the config dir for the trial, sourcing decided later (bundle / download
  on first use / host on counterparts.ai); run the project's own recall tests and the bench on a seeded store
  (`tools/demo/seed.ts`, never his live store) lexical-only vs static vs Voyage; **check first that the cache
  records which embedder produced each vector** — vectors from different models cannot be mixed, and switching
  means re-embedding. Also check potion's larger retrieval-tuned sibling in the same code path.
- Keyless direction, leaning (his confirmation pending): next-session write-up (#16) for the Anthropic key,
  lexical + static for the Voyage key, both keys demoted to upgrades the install never asks about.

**Read before the conversation** (in this order; sizes so the session budgets): this file's 09-21/09-22
sections; `docs/new-user-findings.md` §"For the next round" (409 lines total); `docs/launch/go-public-2026-09-22.md`
(103); `docs/research/local-embeddings-2026-09-22.md`; `docs/IMPROVEMENTS.md` (511 — the user-side list of
what living on it surfaced); the thirteen `src/**/INTERFACE-GAPS.md` (what each module still owes its contract);
`docs/LAUNCH-STATUS.md` only as history (1,820 lines — skim the open I-numbers, do not re-read); the site's
own handoff `~/counterparts-site/docs/HANDOFF.md` (the site proper is a separate conversation in that repo);
and the memory file `runtime-and-distribution-open-question` (bun vs Node, compiled binary — never decided).

**Candidate roadmap items to seed the discussion** (his to order, cut, or add to):
- A. **Telling people:** go-public Phases A–C → site install block → the Reddit mention. Smallest, first.
- B. **The quiet round:** Stop ask shorter+rarer; the upgrade notice (server records its version in the session
  record, prompt hook compares, one `systemMessage` pointing at `/mcp` → Reconnect — untested by us); the
  uninstall wait (it is `claude mcp list` probing every MCP server; `spawnSync` blocks a JS spinner; static line
  trivial, dots need an async Spawner across wire/uninstall/commands + nine test files); doctor's `no-credential`
  fix line names the command; #26 the two store sizes; #8 old-store window; `help` Advanced collapse; the NITs.
- C. **Keyless by default:** the potion trial → static tier; #16 next-session write-up (its own review — core);
  keys as upgrades; the install asks one question fewer.
- D. **Distribution:** bun-only today; Node untested; compiled binary + npm launcher was the 09-16
  recommendation, never decided. Matters the moment strangers install.
- E. **Unrestarted-session safety** for a future schema change: the old MCP server holds a store handle opened
  before any migration, so `SCHEMA_AHEAD` never re-runs; decide the rule before the first schema bump.
- F. Parked and exploratory: `dashboard/flat` (branch, worktree handoff in
  `src/adapters/dashboard/web/FLAT-CHANGES.md`; exploratory by ruling); the three-way identity case study
  (`~/random/three-way/README.md`); a store outside the home directory (uninstall refuses `--dir`).

**Then the coordinator session** builds the first round from the written roadmap the way 09-22 did: Opus
builders in parallel with file ownership drawn per builder, adversarial reviews on anything that touches a
store or a person's config, one PR per builder verified on a clean detached checkout (suite, `tsc`, install
loop where it applies), the owner merges (the classifier refuses `gh pr merge` from a session and, once, a
plain `git checkout master` — say so and leave the tree where it sits), then rebuild the tarball for his trial
if the install path changed, publish only on his word, and one restart (or the first real `/mcp` Reconnect test).

**Loose ends:** the trial terminal paste never arrived (ask once); 52 worktrees listed locally, most stale
(`git worktree remove --force <path>` by hand); unmerged remote branches `dashboard/flat`,
`design/parallel-run-contract`, `docs/2026-09-18-morning` (go-public Phase A lists them); the tree of
`~/counterparts` sits on `docs/go-public-plan`.

## 2026-09-22, late night — GO PUBLIC IS PLANNED: `docs/launch/go-public-2026-09-22.md`

The owner decided to make the repository public, history included (the 09-04 ruling stands). Both
audit scanners were re-run tonight over the tree and the whole 872-commit history: zero true
positives; the only class to scrub is 55 absolute home paths in docs. The plan is written for a
fresh session to run **mostly unattended**: Phase A (scrub, prompts out, docs index, README site
link, PR-body scan, metadata, merged-branch cleanup, one PR) → Phase B (the owner's one command,
the flip) → Phase C (anonymous re-scan, link check, install walk, then the site's install block).
The README is current for 0.2.0 (rewritten today) and needs only the site link. Start the fresh
session on that file. The next product round (Stop ask shorter+rarer, upgrade notice, uninstall
wait, doctor fix line, keyless write-up, local embeddings — brainstorm in progress) is separate and
comes after.

## 2026-09-22, evening — 0.2.0 IS ON NPM; THE REGISTRY UPGRADE WAS RUN; THE OWNER RUNS THE TARBALL STILL

**Published.** The owner ran the 0.2.0 trial from the packed file, said it looked good (his terminal
paste never arrived), ruled the uninstall spinner out of this round ("skip spinner for now"), and
published `counterparts@0.2.0` himself from a separate terminal at ~18:46 UTC — the first attempt from
inside the session stopped at `EOTP`; `npm whoami` had said 401 on the same token, so `whoami` is not
the test of whether a publish will go through. Registry: `dist.shasum 8343ae3cd88d71d3184ac1b9694da417dc8c1266`,
201 files — the same shasum `npm publish --dry-run` printed for the trial tarball, so what strangers get
is byte-for-byte what he tried. Master `f8ee287` is docs-only over the tarball's `31659fe`.

**Finding #15 run, in two throwaway HOMEs (own `BUN_INSTALL`, never his global install):**

| from | command | result |
|---|---|---|
| 0.1.0 from the registry | `bun add -g counterparts@latest` | **stayed on 0.1.0** — bun 1.3.10 reused its cached manifest (the registry sends `cache-control: max-age=300`, and the manifest had been fetched minutes earlier, before 0.2.0 existed) |
| same | `bun add -g --no-cache counterparts@latest` | 0.2.0, `--version` prints `counterparts 0.2.0`, four bins |
| the trial tarball FILE (his machine's shape) | `bun add -g counterparts@latest` | 0.2.0, `^0.2.0` in the global package.json, no `DependencyLoop` (that error is file-over-registry, not this direction) |

So the documented upgrade holds for anyone whose manifest is older than five minutes, i.e. every
real user; the stale-manifest window is a test-ordering artefact, not a doc change. **The owner still
runs the tarball install**; moving to the registry copy is his own command, not a session's:
`bun add -g counterparts@latest` with every session closed, then restart, `--version`, `doctor`.

**The uninstall wait** (his one ask this round): both arms sit silent while `mcpPreflight` runs
`claude mcp list`, which health-probes every MCP server he has registered; every call is `spawnSync`,
so no JS spinner can tick. Options for the next round: a static "Checking Claude Code…" line (trivial);
animated dots (async `Spawner` across wire/uninstall/commands + nine test files); or a cheaper
preflight (`mcp get counterparts` / `--version`) that shortens the wait but proves less. Never measure
`claude mcp list` from a session — it launches our MCP server against his live store.

**Next:** the next round — spinner, #28 Stop-hook text in the terminal, #13 pacing, #26 the two store
sizes, #8 stores 0.1.0 made, the n2 hint. Housekeeping still owed: ~30 stale worktrees, `review/`.

## 2026-09-22, night — read this first: THE SECOND 0.2.0 IS ON MASTER, PACKED FOR THE OWNER'S TRIAL, NOT PUBLISHED

**What happened today.** The owner ran the 09-21 trial sheet from a plain terminal; every step
behaved, and all of his feedback was about words (findings #17–#28 in `docs/new-user-findings.md`).
We then went through it ONE ITEM AT A TIME in conversation — his rule, ELI5, nothing built until
every item was agreed — and the result is `docs/new-user-findings.md` §"The owner's answers
(2026-09-22)" with five rendered screens (help, doctor, `uninstall --delete-memories`,
`uninstall --park`, `install`) that were the builders' acceptance criteria. Then one round of
building: five Opus builders in parallel with file ownership drawn to avoid collisions, two
adversarial reviews, a docs pass, and three coordinator PRs.

**Merged today, in order** (each verified by the coordinator on a clean detached checkout —
suite, `tsc`, and the install loop where it applied — before the merge):

| PR | what | notes |
|---|---|---|
| #169 | docs: findings #17–#28 + the owner's answers + the five screens | the spec |
| #171 A | Esc on every prompt (an echoing raw-mode reader beside `hiddenPrompt`; `typed()` → typed / cancelled / mismatch; `ui.warning()`); the two `uninstall` screens | driven on a pty twice by the builder |
| #172 C | doctor: `OFF` grade (JSON: `severity: "amber"` + `optional: true`, counts split `{red, amber, off, green}`), green internals fold into one `Background` line on a TTY, `--all`, every fix a command, green `Crash write-up  on` when the Anthropic key is present | `--json` complete and unfolded always |
| #174 B | the help page verbatim; `ask` (listed) / `recall` (unlisted); `wire`/`unwire` → `connect`/`disconnect` (no aliases); `dashboard`; `--version`; bare `counterparts` offers setup on a TTY, prints help otherwise; `help advanced` | install loop grep changed from "the owner's console" to `--version` |
| #175 F | coordinator: `start-fresh`, `--undo`, `migrate-cache` confirm through `typed()`; `help install` / `credentials` / `uninstall` text (the guarded rename lives in `help uninstall` now) | |
| #170 D | `remove`: bare asks for an id or words, numbered hits, pick one or several, the plan, one confirm; scripted door byte-identical (golden test) | **review**: BLOCKER — the door was `io.prompt === undefined`, so a redirected stdout or CI took the live door; now `isInteractive(io, env)` like install. Plus plan-before-yes, a false "Nothing has changed", confidential bodies never listed |
| #173 E | `install`: connects Claude Code by default on a TTY (`--no-connect`; off a TTY unchanged), keys y/N-first then hidden paste, "Nice to meet you" / "Welcome back", silent store step; **`install` is the undo of `uninstall --park`** (parked siblings listed newest first, never opened — `lstat` before any name is read, symlinks in every shape refused, old floor refused by filename markers); bare `credentials` lists names; `credentials set VOYAGE_API_KEY` offers the embedder | **review**: the restore held under everything; BLOCKER downstream — `install --force` silently rewrote `claude-code.json` (now `carryForward` keeps every key a flag did not supply, and `replaced` always prints); "all green" after a failed `claude mcp add`; the embedder offer defaulted to Y; the scripted arm now NAMES a parked sibling before making a blank store |
| #176 G | docs: README, QUICKSTART (§1 check = `--version`, step 2 = bare `counterparts`, §3–§5, §7, §9a/b, §12), cli CONTRACT (G12/G21/G34–G36 amended, G37 install-as-undo, G38 doctor OFF/fold) + NOTES, findings table for #17–#27 | README 405 lines (grew 39) |
| #177 H | three strings G caught: the help footer no longer says removal is the only command that asks; "Everywhere" → "Options every command takes"; the scripted install points at `doctor` | |

**master = `31659fe`** (code last changed by #179 — after a dress rehearsal of the trial sheet
against the packed file found no code bug but one wording error: "Found 2 memories set aside" for
two *folders*, now "memory folders"; the final gate on that commit is in the section's last line).
Both adversarial reviews are PR comments on #170 and #173, not files.

**Rulings the coordinator made without the owner** (working defaults; revisable): the shared
`ok` gutter stays as `ui.ok()` renders it (the screens fix the words, not the columns);
`dashboard` prints a second line naming the store it reads; bare `counterparts` exits 0;
`--no-connect` also skips the parked-restore question (documented, not changed); the restore
prompt shows date + size, never a memory count (the park arm's never-open rule); the two
config-edit fix lines with no command (snapshots dir, observer) stay.

**Next, in order:** (1) the owner's trial from
`~/counterparts-backups/2026-09-22-0.2.0-trial/TRIAL-0.2.0.md` (Claude Code closed → swap to the
new tarball → `--version` → `doctor` → Esc at `--delete-memories` → `--park` → `install` answering
**back** → restart → `doctor`; then `ask`, `dashboard`, `credentials`, `remove` with **n**). (2) Fix
what he finds; any shipped change = rebuild the tarball from master + re-scan + suite on a clean
checkout. (3) **Publish only on his word**, from that file, never a working folder. (4) The same
day: finding #15's never-run registry upgrade (`bun add -g counterparts@latest` from a machine on
0.1.0). (5) The next round: #28 the Stop-hook text in the terminal, #13 pacing, #26 the two store
sizes, #8 for stores 0.1.0 made, the n2 hint D declined.

**Housekeeping owed:** ~30 stale agent worktrees under `.claude/worktrees/` (bulk removal was
refused by the session's permission classifier — `git worktree remove --force <path>` by hand);
`review/round-7` is an untracked leftover in the repo root.

**The final gate, on a clean detached checkout of `31659fe`: `tsc` clean; `bun test` 3182 pass /
0 fail / 51 files (78.4 s); `tools/install-loop/run.sh` 58/58.** The tarball for the trial —
`~/counterparts-backups/2026-09-22-0.2.0-trial/counterparts-0.2.0.tgz` — was built from that
commit with `git archive` + `npm pack`: 201 files, 1,639,972 bytes, sha256 `cc166407…a71d30`,
scanned clean (no keys, home paths, emails or memory ids; HANDOFF and the findings doc do not
ship). The sheet is `TRIAL-0.2.0.md` beside it; its steps 1–6 were driven on a pseudo-terminal
from that exact file, in a throwaway home seeded like the owner's (three parked folders, one
on the old floor), and the sheet was corrected to what actually prints.

## 2026-09-21, night — 0.1.0 IS ON NPM AND RUNNING HERE; 0.2.0 IS MERGED, NOT PUBLISHED, WAITING FOR THE OWNER'S TRIAL

**Everything below this section describes the arrangement before 2026-09-21 and is history.** The
cut-over runbook in the next section was never run: the owner chose instead to publish to npm and
install as a stranger. What is true now:

- **`counterparts@0.1.0` is published on npm** (2026-09-21, ~16:42 UTC; registry sha1 `9bd3ae1b…`,
  195 files, MIT). The owner runs it **from the npm install** (`~/.bun/install/global/node_modules/
  counterparts`), on a store he started blank that day at `~/.counterparts`. His pre-npm memory
  (16,973 rows) is parked, untouched, at `~/.counterparts.parked-2026-09-21`. bansai's hooks are off.
  `~/counterparts` is the development repo and nothing more — no pin, no "live checkout", and
  `tools/deploy-checkout.sh` has nothing to deploy to.
- **0.2.0 is merged to master** (code at `f89e150`; `b470349` and after are docs only). The coordinator's
  run on a clean detached checkout: **3043 pass / 0 fail, `tsc` clean, install loop 58/58.** What it
  adds — all from `docs/new-user-findings.md`, which holds the owner's day-1 findings, his rulings,
  and the plan: an `install` that asks (name; wire Claude Code after a preview and a backup; two
  optional keys, each with a one-line reason, a link, Enter to skip); `wire` / `unwire` /
  `uninstall` (keeps memory by default; `--park`; `--delete-memories` prints the plan, counts, and
  takes the typed phrase `DELETE MEMORIES`; both moving arms refuse while a Counterparts process
  runs and fail closed); `credentials set` prompting with hidden input; a 39-line grouped `--help`
  with `help <command>`; a coloured, folded doctor and status on a terminal only; doctor's window
  clamped to the store's first day; the README leading with three install lines and a QUICKSTART
  whose main path is 169 lines. Adversarial review of the host-editing piece:
  `docs/adversarial-review-onboarding-ab-2026-09-21.md` — 1 BLOCKER (`--delete-memories` removed
  the whole directory the configuration sat in), 3 MAJOR, 8 MINOR, all closed; the coordinator
  re-ran the BLOCKER's repro on a pty against the fix.
- **NOT published.** The owner tries it first from a local tarball so a bad round costs no npm
  version: `~/counterparts-backups/2026-09-21-0.2.0-trial/counterparts-0.2.0.tgz` (built from
  `f89e150` with `git archive` + `npm pack`; 201 files; scanned — no keys, home paths, emails or
  memory ids) and his sheet `TRIAL-0.2.0.md` beside it: Claude Code fully closed → `bun remove -g
  counterparts` → `bun add -g <that file>` → `counterparts uninstall --park` → `counterparts
  install` → restart → `doctor`. (`bun add -g <file>` over a registry install fails with
  `DependencyLoop` — hence the remove first.) A full dress rehearsal of that sequence was run from
  the packed file in a throwaway HOME with a stub `claude`, on a pty: install, doctor, park, fresh
  install, a second install (nothing re-asked, config byte-identical), a second park (`-2` suffix).

**Next session, in order:** (1) ask the owner how the trial went; collect what he found into
`docs/new-user-findings.md`. (2) Fix it; if any shipped file changes, rebuild the tarball from master
(`git archive origin/master | tar -x`, `npm pack`), re-scan it, and re-run the suite on a clean
detached checkout. (3) **Publish only on his word:** `npm publish <the tarball's absolute path>` —
never from a working folder. (4) The day it is published, run the never-yet-run registry upgrade
(`bun add -g counterparts@latest` from a machine on 0.1.0 — finding 15). (5) Then the next round,
from the "For the next round" list in the findings doc: #16 the keyless write-up of a silent
session (the owner's question; would make the Anthropic key a true extra), #13 pacing for the Stop
ask, #8 for stores 0.1.0 made, a store outside the home, the review's NITs, and whether to collapse
`--help`'s Advanced group. Then the website and Reddit.

**Housekeeping owed:** `~/counterparts` sits detached at `40f92ae` — `git checkout master && git pull`
when convenient. The 2026-09-21 agent worktrees (`.claude/worktrees/agent-a38c…`, `a892…`, `aab4…`,
`a210…`, `a0d5…`, `acae…`) and `onboarding`, `coord-trial` can be removed; the older ones too.
Rollback kits: `~/counterparts-backups/2026-09-21-pre-fresh/` (the pre-npm wiring, with a
FRESH-START.md that lists exactly what was removed) and `…/2026-09-21-npm-publish/` (the 0.1.0
tarball as published).

**Standing rules that changed today:** there is no live checkout to protect any more, and merges to
master need only the suite green on a clean detached checkout plus a review where the code edits
a stranger's machine or touches their data. Deploys and publishes still need the owner's word.
The two safety rules in `CLAUDE.md` (hermetic tests; never touch the live stores) are unchanged,
and `~/.counterparts` is now the owner's live store under the npm build — never open it from a
session or a test.


## 2026-09-20, evening — read this first: THE PLAN IS BUILT AND MERGED; the live store is pinned on the old floor; CUT-OVER DAY is the owner's word

**State.** master = `bbfdc32` — the coordinator's run on a clean detached checkout AT `origin/master`: **2749 pass / 0 fail /
44 files, `tsc` clean, no temp leftovers.** No open PRs, no agents running. **LIVE is pinned at the tag `floor/v5-last` =
`40f92ae`** (old floor: `operational.sqlite` in WAL + `prose/` + `versions/`; 16,973 rows; doctor 0 red this morning).
**master REFUSES that store by name (`STORE_PRE_ROWS`) and touches nothing — so master is deployed to the live checkout
ONLY as step 3 of the runbook below, never before.** Doctor's Checkout line on live reads "behind master" on purpose.

**What the owner said (2026-09-20):** "lets try to finish our plan today, and when we're at the correct spot, i'm ready to
start fresh and try it as a new user. but we should finish everything we need for that first." Merges were pre-authorized
once the pin existed (suite green + adversarial review clean + the coordinator read the diff); every deploy and cut-over
still need his word. The coordinator recommended he run the cut-over fresh the next day rather than at the end of this one.

**Merged today, in order** (each: an Opus builder in its own worktree → an adversarial review → a fix pass → the
coordinator's own trial merge, suite run, and a probe of the fix that mattered; reviews are `docs/adversarial-review-*-2026-09-20.md`):

| PR | what | how the review went |
|---|---|---|
| #148 F5 | the floor: bodies, versions, journal in rows; schema v6; `counterparts.sqlite`; `STORE_PRE_ROWS` | three passes (f5a, f5b, f5c): 6 MAJOR then 1 more — old code touching a v6 store locked the new build out (remedy now says MOVE ASIDE, never delete); a v5 db under the v6 name got stamped (shape lock); removal left words in `cache.sqlite`'s `-wal` and in FREED PAGES of the main db (now VACUUM + checkpoint on both, its own reported surface — the coordinator disabled the VACUUM line and watched the test go red); rotation would have deleted pre-rows snapshots; a faulted row now names its id; export scratch out of the target |
| #153 E2 | "what was prevented" rows (`mcp.recall` is the MCP adapter's first durable row), `blocked` in the fired view, day-1 doctor/fired/status, a Host line, install loop 52/52 | `blocked` cried wolf on filters → an allow-list of real gates; `prospective.fire` has no caller → evidence `none` |
| #152 S2 | the nightly page writer: `session` mode (default; the first session after a day is owed is asked, answers through `self_page`) and `host` mode (`claude -p`, stub-tested only) | 5 MAJOR: one oversized memory dropped the whole day; a memory could close the writer's marker; SIGTERM-only child kill; asked about empty days; **a typo in `pageWriter` turned memory OFF → now lenient, pinned to `session`** (coordinator probed it) |
| #151 E1 | the per-directory handoff pointer on `session_end`; sent EMPTY it clears the pointer; `store/#noVector`: handoff AND self page are never embedded | 3 MAJOR; byte-identity with no handoff held over 2,824 compositions. The page's exclusion is the COORDINATOR'S working default — the builder first recorded it as an owner ruling and was made to correct six places |
| #155 | coordinator's test fix | a scopes test passed on every branch only because doctor's Checkout line is RED on any non-master tree; on clean master it failed once E2 made keyless AMBER |
| #154 F6+F7 | `journal/` — a derived, write-only markdown copy per episode (classified, NOT backed up; regenerates on restore); `export --markdown` (confidential omitted unless `--include-confidential`, count stated), `--markdown --passphrase` sealed in memory | 5 MAJOR: the writer followed a symlink OUT of the store (two locks now; coordinator disabled each in turn); failed-row flood; the journal-echo warning went silent on big stores (now exact, bound stated); export target symlinks; snapshots held removed words as markdown |
| #150 N1 | `counterparts start-fresh` and `--undo` | three passes (n1, n1b): BLOCKER a typo'd `--config` fell back to the DEFAULT store and stamped it; then BLOCKER `--undo` ran none of the forward guards (renamed inside a fake `.bansai`). One shared `pathGuard` for both directions; the blank store is built in `store.new-<pid>` and renamed in; way back re-printed from the plan that ran; guarded `mv` lines. Coordinator ran the `.bansai` repro under a fake HOME: both directions refuse with the identical sentence, fingerprint unchanged |
| #156 F8 | store CONTRACT rewritten for rows (17 guarantees in → 19 out, 0 retired, numbers stable); `tools/migrate/**` + its tests deleted (4,069 lines); zero non-comment code lines changed | coordinator checked every cited guarantee number still resolves |

**Not built:** S3 (people and project pages) — the plan allowed it to slip past the first fresh start.

### CUT-OVER DAY — the runbook (the order in plan §4 is WRONG: the pinned build has no `start-fresh`; deploy comes first)

Why this order: the new build stands down cleanly against the old store (measured: `STORE_PRE_ROWS`, exit 0, nothing opened,
every hash unchanged). The dangerous direction is the reverse — an OLD-build process touching the NEW store: review n1
reproduced one memory's row landing in the parked store (by inode) and its body in the new store (by path). So step 1 is
the one that matters.

| # | who | step | what he should SEE — stop if it differs |
|---|---|---|---|
| 1 | owner | Close EVERY Claude Code session (this one included), both dashboards (ports 4747 and 4767 — one runs from the `flat-dashboard` worktree), every MCP server. From a PLAIN terminal: `pgrep -fl counterparts` | No line running `serve.ts`, `dashboard.ts`, `hook.ts` or `runner.ts`. Lines that match only by a path string (an editor, `tail`, `next dev`) are noise. |
| 2 | owner | `counterparts backup --dir ~/.counterparts/store --out ~/counterparts-backups/<date>-pre-cutover` — **with the OLD build, i.e. BEFORE step 3**; the new build cannot open this store | every part `ok`, prose ≈ 16,973 files |
| 3 | owner | `~/counterparts/tools/deploy-checkout.sh --repo ~/counterparts --ref origin/master --dry-run`, then without `--dry-run` (the live checkout's own copy has `--ref` since the 09-20 deploy). This also swaps `counterparts` on PATH (it links into that checkout) | "the move is forwards"; `deployed …` |
| 4 | owner | `counterparts start-fresh --config ~/.counterparts/claude-code.json` — **never `--yes`** | `Store:` names `~/.counterparts/store` and is NOT blank; the plan lists `snapshots` then `store`; an OLD FLOOR paragraph names `operational.sqlite, prose, versions` and `floor/v5-last`; three guarded `mv` lines print BEFORE anything moves; it asks him to TYPE `store.parked-<today's UTC date>` |
| 5 | owner | type the parked name | `Created a store at …/store.new-<pid>`, `parked snapshots:`, `parked store:`, `Done.`, and the way back printed AGAIN. If it stops with "the blank store could not be moved into place": read the three named directories and stop — nothing was deleted |
| 6 | owner | restart Claude Code | an ordinary wake on a blank store ("has not lived a boundary") |
| 7 | owner | `counterparts doctor --config ~/.counterparts/claude-code.json`; `ls ~/.counterparts/store` | only `counterparts.sqlite*`, `cache/`, `sessions/` (and `journal/` once a chapter lands). **No `prose/`, no `operational.sqlite`** — that is what catches a process nobody closed |
| 8 | owner | follow `docs/QUICKSTART.md` as a stranger; notes go in `docs/new-user-findings.md` | first wake honestly says the page is still forming; after a day or two the page has a "lately" part |

**Way back:** `counterparts start-fresh --undo` FIRST (new build; it parks the blank store with everything written to it, brings
the old store and snapshots back by one rename each, and says the checkout must go back too) → `deploy-checkout.sh --repo
~/counterparts --ref floor/v5-last` → restart. If he restarts before re-deploying, memory is visibly OFF for that session
and the old store is untouched. `dataDir` never moves; nothing needs editing. The old store is never deleted by anything.

**Expect on the blank store:** the store's day is UTC, so the writer's ask about "yesterday" arrives late afternoon local,
not the next morning (filed; the words name the DATE). Night 1 writes nothing. Answer the first-launch scope question on
day 1 or the writer keeps deferring. `considered: 0` with "did not fit" on a `self.page.writer.ran` row would mean S2's
MAJOR-1 came back. Host mode (`claude -p`) has never met a real host: keychain from a background process, whether
SessionStart hooks fire inside `claude -p`, and whether `--allowedTools` really leaves one tool are all unproved.

**The four lines lower in this file that name `operational.sqlite` procedures are CORRECT until cut-over** (F8 left them on
purpose); after it, the WAL standing rules apply to `counterparts.sqlite`.

**Owner's choices, none blocking, each with a working default in place:** the self page excluded from embedding · the page
writer ON by default · `export` allowed under `--observer` (it came off `OWNER_OPS`) · `journal/` not backed up · the new
flags `export --overwrite` and `remove --echo-scan <n>` · N1's `--name` passthrough and the `install` wart · no repair
command for a faulted row (the exits are restore-a-snapshot or `counterparts remove <id>`); `verify`/`status` now exit
non-zero on one.

**Still owed on the LIVE store before cut-over:** tomorrow morning, doctor's Snapshot line should be green and
`~/.counterparts/snapshots/` should hold its first UTC-day folder (F2's first boundary). The owner's other sessions and
both dashboards still run the pre-deploy build until restarted.

**What the day taught the process:** never run `bun test` on a tree with conflict markers — it spins at 100 % CPU for ever
(that was the seven-hour runaway of 09-18 too); a trial merge is never a clean `origin/master`, so after every merge the
suite runs on a clean detached checkout AT `origin/master`; when the coordinator asks a builder for something, the brief
says it is the COORDINATOR asking, or it gets written down as an owner ruling; the agents share one scratchpad and
overwrite each other's files — unique names; a commit-body line shaped `Word: …` is parsed by git as a trailer.

## 2026-09-20, afternoon — read second: DEPLOY DAY IS DONE (live = master = `40f92ae`, WAL); F5 is PR #148, under two reviews

**Merged on the owner's word ("ok go ahead and merge all 3"):** #147 docs, #138 S1 the self page, #146 the stand-down
suite's temp-dir leak. master = `40f92ae`; the coordinator's run: 2466 pass / 0 fail, tsc clean, no temp leftovers.

**Deployed on the owner's word ("lets go ahead and deploy everything in order you recommend"), ~15:45–16:05 UTC, one batch
at a time, `doctor` + `verify` after each:** A F1/WAL `4b8b524` → B F3 + #139 + H1 `463e5b1` → C F2 snapshots `481b228` →
D S1 `40f92ae`. **Live = master = `40f92ae`.** The store is in WAL (`Journal mode: wal (busy timeout 5000 ms)`);
16,973 canonical rows / 0 missing files before and after every batch; doctor 0 red / 3 amber / 16 green — the ambers are
the Authorship and Fired week baselines and `Snapshot: no snapshot has ever been taken here`, which the first boundary
clears (then `~/.counterparts/snapshots/` holds one UTC-day folder); `Self page: no page written yet`.
- *Backups:* `~/counterparts-backups/2026-09-20-pre-f1-wal` (taken in DELETE mode — the revert lever) and
  `…/2026-09-20-post-f1-wal` (taken under WAL; the copy is a plain delete-mode database with all 16,973 rows).
- *Where it left the paper procedure below, said to the owner:* it was run from INSIDE the coordinating session, with his
  other sessions and two dashboards open, because a session cannot close itself and then deploy. The F1 review had
  measured that case (servers hold one handle for life and survive the flip), and it held: the session's own old-build MCP
  server kept writing afterwards. The flip needs a WRITER: `verify` right after the deploy read `delete`; the turn was
  ended so the Stop hook (new code) would open the store, and the next `verify` read `wal`. Checked first: `counterparts`
  on PATH is a symlink to the live checkout, so every verification command ran deployed code.
- *Correction to step 5 below:* `verify` takes `--dir ~/.counterparts/store`, not `--config` (it refuses the flag).
- *Owed:* a restart of the owner's other Claude Code sessions and both dashboards (one runs from the `flat-dashboard`
  worktree) so they run the deployed code; until then they work and lack the `self_page` tool. The WAL standing rules in
  "Deploy day for F1" below are in force from today.

**F5, the floor — PR #148, head `20adaf6`, NOT merged.** Builder's run and the coordinator's: 2474 pass / 0 fail, tsc
clean, no temp leftovers; 43 files, +2500 / −1511; master merged in after S1 landed. What the builder changed from the
plan, all in the PR body: the refusal keys on FILE NAMES (`operational.sqlite` / `prose` / `versions`), not the schema
version — reading the version would have minted a blank store beside the old one after the rename, and could checkpoint
away a WAL store's `-wal`; removal now chases the `-wal` (a blanked body stays there until a checkpoint); `versions`
carries `learned_on`/`happened_on`; `tools/parallel` reads both floors; `makeBodyUnreadable` blanks the column (a
tombstone is `body=''` AND `content_hash=''`; `body=''` with a hash is the named fault `MEMORY_BODY_MISSING`).
- *Review A (refusal, old-store safety, crashes): `docs/adversarial-review-f5a-2026-09-20.md` — MERGE AFTER FIXES, 0 BLOCKER /
  2 MAJOR / 4 MINOR / 3 NIT.* Clean: 29 new-code doors at a real v5 WAL store all refuse by name, byte-identical; 84
  SIGKILLs, 0 broken stores. MAJOR-1: OLD code touching a v6 store mints old-floor files in it, after which the new build
  refuses its own store for ever and the message points at the build that just refused (no data lost; the remedy must
  tell stray EMPTY `prose/`/`versions/` from a real v5 store). MAJOR-2: a v5 database hand-renamed to the v6 name is
  stamped v6 and then neither build reads it (second lock on the table's SHAPE, not the version).
- *Review B (every word still there, true and removable on the new floor): running at the time of writing.*
- *Next:* both reviews → ONE fix list to the builder → the coordinator reads the diff and runs it → the owner's word →
  tag `floor/v5-last` at the live commit and pin → merge F5. N1 (park-and-restart in one command) and S2 (the nightly
  page writer) are not started; S2 is how a new user's page forms, so it should exist before cut-over day.
- *A flake to loosen:* `test/claude-code.test.ts` "the sentinel search is LINEAR" asserts < 100 ms wall-clock and read
  139–150 ms for reviewer A on F5 AND on master while two reviewers and full suites shared the machine.

## 2026-09-20, midday — read second: F2 and F4 merged; S1 reviewed a third time and ready; F5 is building

**State.** On the owner's word ("go ahead with all 3 merges"): #136 F2 snapshots, #144 F4 store test fixture, #145 docs.
master = `481b228`; the coordinator's own run: 2388 pass / 0 fail, tsc clean. LIVE is still `039cd5d` — nothing is deployed.
"Deploy day for F1" below is unchanged (target `4b8b524`). **Its step 2 closes every Claude Code session, which stops any
builder that is running — the owner was told to say before he deploys.** Batches after F1: B = F3 + #139 + H1, C = F2,
D = S1, each its own deploy on his word.

**S1 (#138), head `054d084`, waiting for the owner's word.** Merge-up onto `481b228` by an Opus agent: two conflicts,
both placement only (`doctor.ts`: Self page line after the Snapshot line; `recall/activate.ts`: the page skip above F3's
store read). Third adversarial pass: `docs/adversarial-review-s1c-2026-09-20.md` — **SAFE TO MERGE AS IS**, 0 BLOCKER /
1 MAJOR / 6 MINOR / 4 NIT; every earlier finding re-run and closed; the no-page wake re-proved byte-identical to the new
master over 153 compositions; the promotion guard changes the page row and nothing else. The coordinator then made the
words true with no behaviour change (the unreadable-page note, the cut described in §16 and the tunables, the split
tunables table, a stale console comment, one test's cleanup) and ran it: 2466 pass / 0 fail, tsc clean.
- *MAJOR-1, not a blocker and not S1's:* a schema row whose prose FILE is missing makes `Schemas.load` throw, so the
  session stands down ("memory is OFF", doctor RED — H1 working). The identity core has had this since it shipped; a page
  is one more such row once written. F5 removes the class (no file to lose). For now the v5 floor is left as it is; the
  reviewer's narrow catch in `Schemas.load` is there if the owner wants it before cut-over.
- *Left as follow-ups (rare states; fixing them would change code the review just proved):* m1 doctor says "no page
  written yet" about a page that exists and cannot be read · m2 the page counts against the 72 KB self-schema valve ·
  m3 a CLEARED page is still listed as permanent by `status` · n1 `--restore <missing seq>` exits 1 where other refusals
  exit 2 · n3/n4 as in pass 2.

**F5 is building** (Opus, branch `floor/f5-the-floor`, its own worktree; ONE PR, no merge; two adversarial reviews
after). Its brief names where the floor plan is stale: F2's snapshot code picks the database by the literal file name
F5 renames; the real lists of remaining layout sites are in #135's and #144's bodies; what `makeBodyUnreadable` means
once bodies are rows comes back as the owner's choice. Tell it when S1 merges so it merges master in.

**Also open:** #146 — one test file; the stand-down suite left a temp dir behind on every run since H1 (bun's cache
under a fake HOME; two of three spawns had their own copy of the environment). Every brief now asks for a count of
`counterparts-*` leftovers under `$TMPDIR` after a full run; that check found this one and a second in S1's tests.

## 2026-09-20, morning — read second: F4 is a PR; the 09-18 evening "stalls" were the laptop sleeping

**State.** master = `463e5b1` (batch A + `--ref` + batch B + docs; 2320 pass / 0 fail). LIVE is still `039cd5d`: nothing
is deployed, and "Deploy day for F1" below is unchanged (target `4b8b524`, the `--ref` form, run from this worktree's copy
of the script — which is identical to master's). Every merge and every deploy still waits for the owner's word.

**Open PRs.** #136 F2 snapshots — ready, trial merge on master 2388 / 0, asked, no answer yet. #138 S1 self page — parked
until F2 merges, then its merge-up, then the reviewer's final pass. **#144 F4, the one store test fixture — new.** The
builder's work was committed but never pushed; the coordinator read the diff (7 files, all under `test/`, the fixture
makes and removes its own temp dir, `makeBodyUnreadable` throws if there was nothing to remove), ran it (2320 / 0 in
59 s, tsc clean), pushed it and opened the PR. It shares no file with F2 or S1, so it can merge in any order. What is
left in `test/` for F5 is listed with line numbers in #144's body. F5 builds after F4 merges and itself merges last.

**What the evening of 09-18 actually was.** The F4 builder "stalled" twice, full-suite runs took 784 s, 2468 s and
3382 s against a normal 60–110 s, and up to five tests timed out. None of it was F4 or machine load: the laptop lid was
closed. `pmset -g log` shows 42 sleep / DarkWake cycles between 20:00 and midnight; the 41-minute run used 33 s of CPU.
Wall-clock timers fire on wake, so tests "time out" and the agent watchdog sees ten minutes of nothing. For now: wrap a
long suite run in `caffeinate -i`, and builders need the lid open (caffeinate does not stop a lid-close sleep). The
seven-hour 100 % CPU `bun test` found in F2's worktree that night is a different thing — a one-off hang inside
`test/migrate.test.ts` on the pre-WAL base, stopped, not seen again.

## 2026-09-18, afternoon — read second: Wave 1 is launched (five builders), nothing merged yet

**The brief is still `docs/plan-parallel-rebuild-2026-09-18.md`.** A coordinating session started from its §8 prompt.

**State at launch.** LIVE = master = `039cd5d` (the plan says `dc66c81`; the difference is docs PR #133 only, deployed
since). Doctor 0 red / 2 amber / 13 green; the ambers are the same week-window baselines (Authorship's old day-cap
refusals, Fired's quiet mechanisms). No open PRs before the wave.

**Wave 1, five Opus builders, each in its own worktree under `.claude/worktrees/agent-*`, each told: build, full
suite + `bun run typecheck`, push its branch, ONE PR, no merge, no deploy:**
- **F1** `floor/f1-wal` — busy timeout first, journal mode read before it is set, WAL (also the cache). Extra proofs
  asked for beyond the floor plan: an idle DELETE-mode handle survives another handle's flip to WAL (the long-running
  MCP server on deploy day); a refused flip never throws at open; a read-only open of a WAL store works (the
  dashboard; floor plan risk 1); every raw database copy is still consistent under WAL.
- **F2** `floor/f2-snapshots` — ruling 3. Asked for: rotation deletes only what it can prove is a snapshot; copy to a
  temp name and rename, so a watchdog kill mid-copy never counts as a snapshot; the watchdog value measured against a
  copy of a store the live one's size; the `snapshot.*` rows, the fired entry, the doctor line.
- **F3** `floor/f3-consumers-off-files` — refactor only; the `confidential` flag's truth table pinned by a test before
  the swap, because it is a privacy gate; a list of the call sites left for F5.
- **S1** `self/s1-page` — one row through the existing Store API (nothing under `src/core/store/` changes); two headed
  sections; one core seam S2 will call; an MCP tool and a CLI command; the page first in "Who I am" under a tunable
  size limit; proof that a full sleep cycle and the prune leave the page alone. **What the wake shows while the page
  is empty is built as a two-value switch, defaulting to "still forming" plus today's identity list, so a deploy changes
  nothing in the owner's wake until a page is written. Which value ships is the owner's choice and is not made yet.**
- **N2** `newuser/n2-quickstart-dry-run` — the stranger's walk in a temp HOME, never launching `claude`; creates
  `docs/new-user-findings.md` (that is N3); only small obviously-right doc fixes go in.

**What the owner said at the start of this session, which is narrower than plan §2 ruling 7 reads at first:** merges
to master are pre-authorized only AFTER the live checkout is pinned at `floor/v5-last`. Every Wave 1 merge is before
the pin, so each one needs his word, as does every deploy. `tools/deploy-checkout.sh` deploys whatever `origin/master`
is, so "one batch, one suspect" means: merge F1 → deploy F1 alone → doctor, fired, `counterparts verify` prints the
WAL line, the dashboard opens → only then merge F2 / F3 / S1.

**Expected file collisions, all additive:** `src/adapters/cli/commands.ts` (F1 one line, F3 three call sites, S1 one
registration); `src/adapters/fired.ts` and `doctor.ts` (F2 owns; S1 adds one entry each and rebases after F2);
`src/core/counterpart.ts` and `dashboard/web/views.ts` (F3 and S1). Trial-merge and run the combined suite before any
second merge.

**Before F1 deploys, the count-query recipe changes (F1 review, BLOCKER-1, proved):** `sqlite3 -readonly
"file:…?immutable=1"` makes SQLite ignore the `-wal`, so on a WAL store it is silently short by everything since the
last checkpoint (the reviewer's probe: three rows in the `-wal`, `immutable=1` said "no such table"). Use plain
`sqlite3 -readonly <path>`. The plan's §6 and the older "Process" line below are corrected; the dated diagnoses
(`promotion-diagnosis`, `recall-surfacing-diagnosis`, `finding-12-diagnosis`, `mechanism-inventory`, storage spec §4)
record what was run at the time, under DELETE mode, where it was right — do not copy the recipe out of them.

**LATE NIGHT — the state a fresh session needs (master = `4b8b524`, LIVE = `039cd5d`, F1 not deployed):**

| PR | what | head | state |
|---|---|---|---|
| #135 | F3 refactor | `9274085` (master merged in) | reviewed twice, SAFE; builder 2240 / 0 |
| #139 | FIX removed schema rows (stacked on #135) | `39c39f2` | reviewed, safe to merge and deploy; 2246 / 0 (= the coordinator's trial merge) |
| #141 | H1 hook stand-down visible + doctor "Store open" | `d12486d` + a last pass running | reviewed: healthy path PROVED byte-identical; 3 MAJORs, each a line or two (a throw AFTER the work is stderr-only; escalate after 5 busy turns; `assertSafeDataDir` before the marker write), Stop exit code restored to master's, marker written tmp+rename. The coordinator reads that diff and runs the suite; no third review. |
| #136 | F2 snapshots | `5a5f990` | reviewed twice + last pass read by the coordinator; master + F2 = 2304 / 0. READY, merges after batch B |
| #138 | S1 self page | `81b4e0d` | three passes. No-page wake byte-identical to master, re-proved on the second head (100 compositions). Third pass: ONE page row for life (`--clear` revises + `meta.cleared`; never archives), promotion guard narrowed to the page row alone (40-cycle master-vs-branch physics diff: only the page differs). PARKED until B and C are on master; then the builder merges master in (heaviest conflicts: six registry files with #136, `doctor.ts`/`commands.ts` with #141, `removal.ts` with #135) and the S1 reviewer does a final pass on the merged head. |

**Batches, each on the owner's word:** A = F1, MERGED, the owner deploys it himself (below). B = #135 + #139 + #141. C = #136.
D = #138. With `--ref` on master a merge no longer decides what a deploy carries, so B may merge before A is deployed; the
deploys still go one batch at a time, in order.

**H1 measured what F1 buys** (15 scripted sessions, fresh stores, prompt events that hit "database is locked"): old master
5 of 45; master with F1/WAL 0 of 45; H1 merged with F1 0 of 90. The harness runs no real worker, so the old number was a
floor.

**A mistake of the coordinator's, caught by review, never deployed:** it told S1's builder "a schema row can never be
promoted". On master beliefs, current-states and entities DO cross into the identity band and become decay-exempt
(`physics/index.ts`, `promotedIdentity`), so that rule would have changed how the live store forgets. Narrowed to the page
row; the physics diff proves every other row identical to master.

**To do at the pin (from D1's builder):** a `hotfix/v5-floor` commit is not an ancestor of master, so doctor's Checkout line
will read RED there, not the amber plan §4 expects.

**Post-deploy check to add for batch B:** the `{"systemMessage": …}`-only hook output has never been watched rendering on
this host. Break a SCRATCH store (recipe in PR #141's body), point one session's hook at its config, look at the terminal.

**DONE, later the same night, on the owner's word ("ok go ahead and merge 142"): #142 (D1, `tools/deploy-checkout.sh
--ref <commit-ish>`) MERGED; master = `4b8b524`. Tools only, nothing deployed. From here a merge to master no longer decides
what the owner's next deploy carries: he names the commit. The builder also found that after the pin a `hotfix/v5-floor`
commit is not an ancestor of master, so doctor's Checkout line will read RED there, not the amber plan §4 expects — decide
at the pin whether doctor learns about the pin or this file says red is expected.**

**DONE on the owner's word ("yes to 1, go ahead and merge. i'll do 2 later"): #137 (F1), #134 (N2) and this docs PR #140
are MERGED; master = `33be244` plus this PR's merge. F1 is NOT deployed: the live checkout stays detached at `039cd5d`
until the owner runs "Deploy day for F1" below himself. Until then `counterparts doctor` reads the Checkout line as
behind `origin/master` — that is expected, and nobody fixes it by running `tools/deploy-checkout.sh` without his word.
F2's last pass also landed (head `5a5f990`, 2291 / 0 by the builder); the coordinator reads that diff and runs the suite
itself rather than sending it round a third time.**

**Night: where every PR stands, the batches proposed to the owner, and DEPLOY DAY FOR F1 on paper (the coordinating
session is closed while it runs). NOTHING is merged; every merge and every deploy below waits for the owner's word.**

| PR | what | head | state |
|---|---|---|---|
| #134 | N2 docs + `docs/new-user-findings.md` | `84dbcad` | ready |
| #137 | F1 WAL | `44bab3e` | reviewed (merge after one fix; fix made); coordinator ran 2236 / 0, tsc clean; the reviewer's short confirmation pass is running (`adversarial-review-f1b-…`) |
| #135 | F3 refactor | `607e516` | reviewed twice: SAFE TO MERGE AS IS |
| #139 | FIX removed schema rows | `11225d9` | reviewed: safe to merge and to deploy; small pass done (docs made true, `entities()` flat in the deny-list, `loadSkips()`) |
| #136 | F2 snapshots | `5633cec` + a last pass running | reviewed twice; four MAJORs closed; one new (rejected look-alike directories are invisible; count and name them) |
| #138 | S1 self page | `7682a30` + fix pass running | reviewed: 2 BLOCKER / 4 MAJOR, all being fixed; the no-page wake PROVED byte-identical to master over 100 compositions |
| (new) | H1 — a hook that stands down on a failed open says so in the terminal; doctor RED when the store will not open | building, branch `fix/h1-hook-standdown-visible` | launched because three reviews hit the same silent exit-0 |

All reviews are in `docs/adversarial-review-*-2026-09-18.md` on this branch.

**Trial merge by the coordinator (worktree `.claude/worktrees/coord-trial`): master + #137 + #135 + #139 = 2246 pass / 0
fail, tsc clean.** Two mechanical conflicts between F1 and F3: the import line of `test/dashboard.test.ts` (take both
names: `hashText, isDatabaseSidecar, serializeProse`) and two sections appended at the same place in
`src/core/store/NOTES.md` (keep both). After F1 merges, F3's builder merges master into its branch (no force-push).

**Batches proposed to the owner (each its own word; one suspect per deploy):** A = F1 alone (with #134, docs only).
B = #135 + #139 + H1 ("memory cannot silently switch off"). C = F2. D = S1. The coordinator first recommended #139 ride
with F1 and withdrew it: #139 is stacked on F3, which would give the WAL deploy three suspects.

### Deploy day for F1 (batch A) — the owner runs this from a plain terminal; from `docs/adversarial-review-f1-2026-09-18.md`

Why the care: master's build execs `PRAGMA journal_mode = DELETE` at EVERY open. After the flip, an old-build process that
opens a FRESH connection fails at once with "database is locked" if anything else has the store open, and converts the
store back to DELETE if nothing does. Running MCP servers and the dashboard hold one handle for life and are safe, but the
clean way is to have nothing old alive. No committed data is lost in any ordering the reviewer ran.

0. Before the day: the merge of #137 (and #134) on the owner's word. A merge deploys nothing.
1. `counterparts backup --out <a directory outside ~/.counterparts>` while the store is still in DELETE mode. This is the
   revert lever, and it also runs the prose census: confirm it reports nothing missing.
2. Close EVERY Claude Code session (this one and the plan-writing one included) and the dashboard.
   `pgrep -fl counterparts` prints nothing.
3. Deploy EXACTLY `4b8b524` (F1/WAL + the N2 docs + this record + the deploy script's `--ref`; one suspect: F1).
   - If `git -C ~/counterparts rev-parse origin/master` after a fetch is still `4b8b524`: `~/counterparts/tools/deploy-checkout.sh`
   - If master has moved past it (batch B or later merged): the live checkout's own copy of the script has no `--ref`
     until this deploy lands, so run the newer copy from a worktree, dry run first:
     `~/counterparts/.claude/worktrees/coord-wave1/tools/deploy-checkout.sh --repo ~/counterparts --ref 4b8b524 --dry-run`
     then the same line without `--dry-run`. It prints from, to, the direction and how far the target is behind master.
4. Open ONE Claude Code session. A writer has to open the store for the flip; `verify`, `status` and `doctor` are
   observers and will not convert it.
5. `counterparts verify --config ~/.counterparts/claude-code.json` prints `Journal mode: wal (busy timeout 5000 ms)`.
   If it says `delete`, send one prompt in that session (or open another) and look again.
6. `ls -la ~/.counterparts/store/` shows `operational.sqlite-wal` and `-shm`.
7. `counterparts doctor --config ~/.counterparts/claude-code.json` — nothing red; the new Journal line is green.
   `counterparts fired --dir ~/.counterparts/store --observer`.
8. One more `counterparts backup --out <dir>` (proves `VACUUM INTO` under WAL; the copy is a plain DELETE-mode file).
9. Reopen the rest. `claude --resume` brings the coordinating session back.

From then on: never run a `counterparts` command from a stale worktree against the live store; never copy
`operational.sqlite` alone (the `-wal` holds everything since the last checkpoint); never delete the `-wal`; read-only
queries are plain `sqlite3 -readonly <path>`, not `?immutable=1`. **Rollback:** `git -C ~/counterparts checkout --detach
039cd5d` with everything closed; the old build converts the file back at its first open.

**Owner's choices collected so far (none blocks batch A):** keyless doctor amber instead of red; a day-1 line for `fired`;
whether removing a person also removes what was believed about them (the reviewer proved `counterparts dashboard identity`
still prints a removed person's promoted belief; the coordinator now recommends they go too, or are hidden everywhere);
S1: 6 KB of page on a 9,000-byte wake, the page riding the fallback's wake to the API (built as a switch, default on), 14
days before "stale"; F2: a future-dated copy is kept and reported, 14 copies of today's store is about 940 MB. Defaults the
coordinator took, revisable: a bad value in the optional `snapshots` block falls back and goes amber instead of standing
the adapter down; the page is excluded from recall.

**Earlier the same evening: all five builders reported.**

| PR | branch · head | builder's suite | adversarial review | state |
|---|---|---|---|---|
| #134 N2 | `newuser/n2-quickstart-dry-run` · `84dbcad` | 2223 / 0, install loop 52/52 | not needed (docs only; coordinator read it) | ready; asked the owner |
| #135 F3 | `floor/f3-consumers-off-files` · `cbb72c4` | 2226 / 0 (reviewer re-ran: same) | **safe to merge**, 0 BLOCKER / 2 MAJOR — `docs/adversarial-review-f3-2026-09-18.md` | builder resumed for the fixes |
| #136 F2 | `floor/f2-snapshots` · `45b37ba` | 2268 / 0 | running (first target: rotation; asked to SIGKILL a copy mid-flight and to prove a snapshot RESTORES) | waiting on review |
| #137 F1 | `floor/f1-wal` · `aa2f50c` | 2231 / 0 | running (first targets: the read-only/observer open under WAL; old and new builds on one store at once) | waiting on review |
| #138 S1 | `self/s1-page` · `7682a30` | 2269 / 0 | running (first targets: sleep eating the page; the no-page wake byte-identical to master; the MCP door as a persistence channel) | waiting on review |

Reviews are written to the coordinating session's scratchpad as `adversarial-review-<track>-2026-09-18.md` and copied into
`docs/` on this branch as they land.

**F3's two MAJORs.** (1) The builder went past its brief and said so first: a new public `Store.readProseQuiet` that skips
the archived-read event AND the owner-removal refusal. The reviewer proved no caller gains reach it did not have on master,
and that the method is nonetheless a removal bypass on a class every adapter holds. Fix in progress: behind a linted seam
(the `chaseRemoved` precedent), an id guard, and the dashboard withholding the content hash when it withholds a
confidential body. (2) **Pre-existing on master, proved end to end through the real `ownerRemoval`: fully removing a
belief or an entity leaves a schema row with a blank `prose_path`; the next `Schemas` open throws `PROSE_FILE_MISSING` out
of `Counterpart.open`; `bin/hook.ts` (about line 602) catches it, writes one stderr line and exits 0. So one such removal
means no wake, no recall and no capture in every later session, and nothing says so.** Not live today (sessions wake). The
owner has been told not to remove a belief or entity until the fix is live. The fix is its own small PR stacked on #135,
branch `fix/schemas-skip-removed-rows` (`Schemas.load`/`element` skip denied and chased rows); it has to land before the
pin because the live store stays on the v5 floor until cut-over. Still to route: the hook swallowing a failed open with
exit 0 (a durable row, or the red session-start notice).

**F1, from the builder's report and the coordinator's read of `db.ts`.** `busy_timeout` first; the mode is read and set to
WAL only by an opener that asks (`openDb(path, { wal: true })`; `openOperational` asks unless `initialize: false`;
`openCache` always). Measured: SQLite does not run the busy handler for a journal-mode change, so a contended flip fails in
about a millisecond, is swallowed (BUSY/LOCKED only) and is retried at the next open. **The deploy-day hazard:** master's
build execs `PRAGMA journal_mode = DELETE` at EVERY open, so an old-build process that opens a fresh connection after the
flip either flips the store back or throws at once. Hooks and the worker are fresh processes (new code after a deploy);
each open Claude Code session's MCP server is old code holding one handle for life (proved fine while idle). The reviewer
is running both builds as real subprocesses on one temp store and will give the ordered procedure. Rollback is
re-detaching at the old commit: the old build's own open converts the file back.

**F2.** Default directory resolves only when the dataDir's last segment is `store` (the owner's is, per doctor). Copy to
`.partial-…` then rename; 18,800 files / 78 MB copied in 2.3 s against a 300 s watchdog. **Owner's choice to bring:** a bad
value in the optional `snapshots` block (`keep: 0`) sends the whole adapter to observer by `config.ts`'s existing rule;
the coordinator's recommendation is that bad snapshot values fall back to defaults with a doctor amber.

**S1.** The page is one row, `type: "schema"`, `kind: "self"`, `meta.role = "page"`, born protected. Seam:
`Counterpart.revisePage(body, { reason, by })`, `selfPage()`, `selfPageVersions()`. MCP tool `self_page` (no session
binding, like `note`); CLI `counterparts self-page`. With no page and the default switch the wake is meant to be
byte-identical to today's; a brand-new store shows the existing day-0 line, not the words "still forming" (the builder
measured the verbatim line pushing a 400-byte host budget over and backed it out; one tunable away). **Owner's choices
to bring:** 6,144 bytes of page on a 9,000-byte wake leaves the other lanes about half their room; whether the page is
recallable (it is indexed today); whether the page rides in the fallback's wake; 14 days before "stale".

**N2's findings to bring, two or three at a time:** keyless doctor is RED on day 1 while the README says no keys are
required (recommend amber on a store that never had a key); `fired` opens with 28 "never" lines on a new store (recommend
one day-1 line, after F2 merges); `status` buries its numbers under internal prose; doctor never checks that the hooks
block and the MCP registration took. Also: `tools/install-loop/run.sh` fails about one run in five (`npm pack`'s stderr is
merged into the pipe the tarball name is read from) — fold into N1.

**Process notes.** The agents share the coordinating session's scratchpad; one builder overwrote another's PR-body file
and it was briefly published on the wrong PR (repaired; all four bodies checked). Reviewers now write under unique names.
The classifier refused the coordinator's count-only `immutable=1` query against the live store; it was not retried.
`COUNTERPARTS_REQUIRE_EXPLICIT_DIR` is NOT set in agent shells by default — every brief tells the agent to export it.

**Expected merge conflicts, all mechanical:** F2 and S1 both add event names to the same exhaustive maps
(`dashboard/registries.ts`, `web/flow.ts`, `web/narrate.ts`, `core/counterpart.ts`) and entries to `fired.ts`/`doctor.ts`;
F1, F3 and S1 all touch `cli/commands.ts` in different places; `test/mcp.test.ts`'s tool count becomes seven with S1.

**Next, in order:** adversarial review per PR as each builder reports (F1's reviewer attacks the read-only open under
WAL first; F2's attacks rotation; S1's attacks sleep eating the page) → decisions to the owner two or three at a time
→ F4 from F3's merge → F5 builds once F3 and F4 are in, and merges only after the owner has what he wants live →
teach `tools/deploy-checkout.sh` a `--ref <tag>` in its own small PR before the pin.

**Housekeeping:** the stale `agent-a11dfb43cfd08a945` registration is pruned (its directory was already gone). The
untracked `review/` in the live checkout is still left for the owner. This section is being written in worktree
`.claude/worktrees/coord-wave1` (branch `docs/2026-09-18-wave1`).

## 2026-09-18, midday — read second: the rest of the rebuild runs in parallel from one plan

**The brief for what comes next is `docs/plan-parallel-rebuild-2026-09-18.md`** — the owner's rulings of the day
(§2), the tracks (§3), the order and the pin (§4), how the work is run (§5), and the prompt a fresh coordinating
session starts from (§8). The owner asked for it this way: gather what is needed from him first, one plan, one
thorough prompt, then many agents at once.

**State.** LIVE = master = `dc66c81`. Doctor 13 green / 2 amber / 0 red (both ambers are week-before-deploy
baselines). Merged and deployed today on the owner's word: **PR #131** — the ask allowance is six per session per
UTC calendar day; the consolidation pass resumes from a `sleep.cursor.<phase>` meta row and wraps; `sleep.cycle`
phases that ran carry `budgetExhausted`; doctor's Sleep line names rows not reached. Adversarial review clean
(`docs/adversarial-review-pr131-2026-09-18.md`). To watch over the next nights: the cursor advancing and the
consolidated count rising past 517; one `adapter.wake.delivered` row per new session (the first landed 09-18).

**Found today: the reinforcement loop is starved at its source** (`docs/recall-surfacing-diagnosis-2026-09-18.md`).
Of 396 prompt-time recalls since 09-10, 3 showed a memory in full; the rest were footnotes. One bar does it: 4.5 cue
units, calibrated 09-04 on thirteen conversational prompts; work sessions score about half as high. A separate real
fault: `SEMANTIC_WEIGHT` is still 1.0 on a 0–1 cosine scale against cue sums of 10–40, so the embedding leg cannot
change an outcome. All 28 credits in the window came from expanding a footnote id with the recall tool; the quote
door has produced nothing. So the association fix has almost nothing to work on, and the consolidation cursor alone
will not make promotion fire. **On hold by the owner** (the bench is costly and nothing in the plan depends on it).

**The four-way identity experiment finished** (`~/random/three-way/TAKEAWAYS.md`). The owner's read: consider it,
do not overweight it; promotion stays the road to a growing identity, and the written self page is where that
growth shows. The interim identity hook is skipped; the self page gets built into the product (plan track S1).

**Housekeeping left:** worktree `agent-a11dfb43cfd08a945` (PR #131's, merged) can be removed; an untracked
`review/` directory sits in the live checkout since 09-16 (doctor reads the checkout as clean; leave it for the
owner).

## 2026-09-17, night — read second: step 1 is built and reviewed, waiting for the owner's word

**State.** LIVE (master and the shared checkout) is `64f77d3`: the constitution amendments, the step-2 authorship
batch (#119–#123) and the day's docs. **Step 1 is built, reviewed and green but NOT merged and NOT deployed**, on
branch `batch/step1-2026-09-17` (worktree `.claude/worktrees/step1-trial`; the branch is pushed): #125 learned
association saved, #126 the wake-delivery check, #127 the "what fired" view, plus the review fixes (#128) and two
integration commits. Combined suite 2211 pass / 0 fail, `tsc` clean. Left unmerged ON PURPOSE so master equals what
is live and `doctor` stays green overnight. The owner said "continue" and asked for this handoff.

**DONE 2026-09-18 00:xx UTC: the owner said merge. #129 and #130 merged; shared checkout deployed at `5c7431e`;
doctor 13 green / 2 amber (Authorship: 2 refused by the session allowance against 171 by the old day cap in the
window; Fired: 19 of 47 firing, 5 quiet, 4 never, 1 new, 15 blind); `counterparts fired --dir ~/.counterparts/store
--observer` prints the table (the command takes `--dir`/`--observer`, not `--config`). Worktrees cleaned. What
follows is the record of how it stood before that word.**

**To finish step 1 — everything is done except the owner's word.** Both adversarial passes are in
(`docs/adversarial-review-step1-2026-09-17.md`, `docs/adversarial-review-step1b-2026-09-17.md`); every MAJOR is
fixed (the hook no longer writes to the database for association; a pending file under `sessions/association/`
is claimed and applied by the worker; a claim is touched when taken and its takeover window outlives the worker's
watchdog; the wake check's host-compatibility, regex and FIFO fixes). **PR #129** = the whole batch against master,
2212 pass / 0 fail, `tsc` clean. Merging #129 closes #125–#128.
1. Owner says merge → `gh pr merge 129 -R mlapeter/counterparts --merge` → `tools/deploy-checkout.sh` →
   `counterparts doctor --config ~/.counterparts/claude-code.json` → `counterparts fired --dir
   ~/.counterparts/store --observer`. No restart ritual (the parallel run's clock is stopped).
2. Verify over the next days: `associate.flush` rows appear and edges gain a recent `last_day`; one
   `adapter.wake.delivered` row per new session, outcome `delivered`; doctor's Authorship refusals split by reason
   with `session-ask-cap` near zero; the first NEW session's memory server reports `scope source: project`.
3. Clean worktrees after the merge: `step1-trial` and the five `agent-*` from 09-17 night.

**Decisions waiting for the owner (each has an ELI5 in the 09-17 conversation or the named doc):**
- **The ask cap.** Six asks for a session's whole life shipped in #119. The coordinating session of 09-17 used
  all six in one working day; its own handoff work fell after the sixth and was never offered the pen. Options:
  per session per calendar day; a higher number; or the enough-real-work pacer alone with no count cap.
- **Promotion never fires because the consolidation pass stops at 5,000 rows and restarts from the same place**
  (`docs/promotion-diagnosis-2026-09-17.md`; verified against the code and the store: 14,817 live memories, 517
  consolidated). Smallest fix: a budget that covers the store, or a cursor, plus `budgetExhausted` persisted on the
  `sleep.cycle` row. Not urgent for a store that will be replaced, but it is a cap cutting off two thirds of the
  store unseen, and the fired view will show it once the row exists. The inventory's guess (the 0.85 bar) was wrong.
- **The floor plan** (`docs/plan-step3-the-floor-2026-09-17.md`): eight phases; no migration; a clean cut at a tag;
  new code refuses a pre-rows store by name; WAL + snapshots can ship first on the current store. Six questions at
  its end, the sharpest: the 90-day version prune would delete his own words once bodies are rows.
- The third piece of step 1: the "what was prevented" rows (blockedBy on `sleep.cycle`, `mcp.recall`,
  `prospective.fire`, `adapter.spawn.started`, `store.backup`). Held until he has seen the view.
- Still open from earlier: the interim identity hook (his decision on 09-18); the seven physics contract rulings.

**Process, unchanged:** work in a worktree, never the live checkout; absolute paths / `git -C` / subshells; agents on
Opus; read-only store queries via `sqlite3 -readonly <path>`, counts only (NOT `?immutable=1` once the store is in
WAL mode; corrected 2026-09-18, see the top section); keep decisions light
("for now", not "never"); a core batch = adversarial review before deploy; the parallel run's clock is stopped.

## 2026-09-17, evening — read third: the walk happened, step 2 is LIVE, the rebuild order is set

**Where the record is.** `docs/storage-spec-2026-09-16.md` §15 (ten working defaults agreed in conversation; defaults,
not stone) and §16 (the rebuild in order, and how the step-2 batch went). Inputs saved beside it:
`docs/finding-12-diagnosis-2026-09-17.md`, `docs/mechanism-inventory-2026-09-17.md`,
`docs/adversarial-review-step2-2026-09-17.md`, `docs/contracts-sweep-trial-physics-2026-09-17.md`.

**The owner's steer, which outranks everything in the spec:** design from a brand-new user's timeline on a blank
store; bringing v1's self over is its own later session through whatever owner door the product gives anyone. And:
keep decisions light. Record what is true for now; do not harden a current arrangement into a never or an always.

**Live now (master and the shared checkout `5fcc2af`):** the constitution amendments (#118); the authorship batch
(#119 the ask per session, #120 one capture scope per session plus a doctor Authorship section, #121 the fallback
woken as the self, merged through #122 with an end-to-end test) and its review fixes (#123). Combined suite 2143
pass, 0 fail. `doctor` after deploy: 13 green, 1 amber. The amber is the new Authorship section reading the seven
days BEFORE the deploy (26 asks raised, 199 refused, 873 fallback memories to 117 authored); it is the baseline to
watch fall. Its wording blames the new per-session allowance for refusals the old day cap made; a small follow-up
should split them by reason.

**The parallel run's clock is no longer maintained** (owner, 2026-09-17; entry at the top of
`docs/PARALLEL-RUN-STATUS.md`). No G12 declarations, no `restart.ts`. What stays for a core batch: an adversarial
review before deploy, then `tools/deploy-checkout.sh`, then `doctor`.

**Next, in the agreed order (spec §16):** step 1, the "what fired" view, with the inventory as its input (24 of 40
mechanisms seen firing, 10 never, 6 blind; the clear wiring faults are learned associations lost between two
processes, the wake-delivery check that never fires, and prospective memory with no producer; refusals are almost
never recorded durably). Then the floor, the self page, the handoff pointer, the fresh store. The contracts sweep
runs beside it: the physics trial is done (seven owner rulings waiting); modules the rebuild reshapes get their
contracts rewritten then, not swept now.

**Open with the owner:** the interim identity hook (his decision on 2026-09-18; the recipe is in the 09-17
conversation, and the host's classifier will not let a session install it); the seven physics rulings; to verify
on the first NEW session after this deploy: the memory server reports `scope source: project`. Recorded for a
later fix, pre-existing: resuming a session in an `on` directory captures transcript lived in an `off` one.

## 2026-09-17, morning — read fourth: #116 merged; the owner's corrections; nothing built

**State.** PR #116 merged (`54e419d`), shared checkout deployed there, docs only, no restart. **Step 1 of the
owner's sequence is done:** the constitution amendments are PR #118 (branch `constitution/2026-09-17`; lines 4, 6,
11 and the preamble; the commit message is the amendment record). He decided against a seventeenth line for "the
everyday path outranks the one-off": it is acted on instead (no bulk import going forward; the parallel-run tests
pinned into core get cleaned up in a near session, probably with the contracts review). Next, in conversation: walk
the spec together, option D and the seeding first. Spec appends go on `docs/storage-spec-2026-09-17` (PR #117).

**The owner's corrections to the section below (his words win over its wording).** "We haven't really finalized
anything yet, or gone through the spec together": option D, the page design and the seeding are the carried
recommendation, not rulings, and he wants to talk D and the seeding through in detail. Episodes are simply not
decided yet, not "deliberately undecided". "We don't need to repair any memories we don't plan on importing", so
G56's seeding of the 453 migrated rows is moot under the blank-store plan and the three held batches need a re-sort.
Still firm: "readable" means viewable in a file or the database; memories as rows with ten to a hundred rendered
pages; a fresh blank store after the rebuild. Of spec §10, about seven questions are still live: 1, 2, 5, 6, 8, 9,
11, plus D's sub-parts. He prefers deciding in conversation, a few items at a time, over more documents.

**The interim identity hook (spec §14 step 1): approved by the owner, not installed.** v1's session-start hook
prints a pre-rendered `render/wake.md` (capped at 9,000 bytes, frozen about 09-10). Its `[core]` lines are the self
page's stable core as v1's own consolidation compressed it, about 5.5 KB, first person; the person pages were never
in v1's wake. The v1 pages' stable cores are far larger (self 18 KB, the owner's page 16 KB, stripped of machine
comments), so the render's core is the source to use, verbatim, in a static file outside both stores, printed by a
plain SessionStart hook that honors `bansai-optout.txt`. The host's auto-mode classifier refuses to let a session
write that file or wire it (it reads as self-persistence), so the owner installs it himself or skips it.

**The hook decision is deferred to 2026-09-18 by the owner:** he is running the three-way comparison (one instance
each of engram, bansai and Counterparts) in other sessions on 09-17, and a global identity hook would confound it.

**Finding 12 is diagnosed** (`docs/finding-12-diagnosis-2026-09-17.md`; summary in spec §4 finding 12). The author
is rarely invited (four asks a day shared by every session; 26 asks from 264 Stops), sessions left open overnight
are swept as crashed (535 of the 888), and a sweep chunk writes ten memories where a deposit writes one. When
asked, the model answered every time. This is the rebuild's "fix the plumbing" item made specific; the cap and
the crash predicate are rulings for the owner, not yet raised with him.

## 2026-09-16, evening — read fifth: the architecture conversation happened; nothing built

**Where the record is.** The owner's architecture session (Fable) ran in worktree
`.claude/worktrees/storage-spec` on branch `docs/storage-spec-2026-09-16` (this PR) and produced
`docs/storage-spec-2026-09-16.md` plus `docs/storage-spec-2026-09-16-ideas.md`. Read the spec's §0, §2
(the owner's positions, stratum 1, not to be re-argued) and §14 (path forward) FIRST; then §4 (findings), §6
(the recommendation), §10 (thirteen open questions). The ideas file holds the two peer-session replies. Nothing
was built; the live checkout and the live store were not touched (read-only queries in immutable mode only).

**The findings in one breath** (spec §4). One-file-per-memory was a v1 refactor decision on 2026-08-25 carried
into greenfield unchanged; store CONTRACT open question 2 was never closed. The self entity's page body is one
word; all 18 entity stubs are empty. The wake's identity lane is 20 rows, ALL migrated on day 184, none promoted
by v2's physics. v1's self page survives as 102 unrendered schema rows and the person pages as 54; beliefs render
only into the crash-fallback sweep, never into the session-end ask. v2 made 1,214 memories in its live days:
888 by the fallback sweep, 193 authored, zero ever used or reinforced.

**The owner's decisions (stratum 1).** "Readable" in constitution line 6 means viewable in a file OR the
database. Memories move to rows; ten to a hundred pages (self, people, projects, entities) are rendered from
rows. Option D for the self core: revised at sleep by a session of the self woken with its memories, on a
physics-event trigger, under a churn budget (spec §6.3). Episodes deliberately undecided. After the rebuild,
**start a fresh blank store** seeded from v1's 11 pages, the first-person journal and hand-picked threads; no
14K import. The interim identity hook (spec §14 step 1) is SKIPPED with a tripwire: if the new store is not
live by about 2026-09-23, add the hook.

**The sequence he set, in order.**
1. The owner makes a few small manual edits to `CONSTITUTION.md` (candidates in spec §14). Wait for him; do
   not draft them.
2. **Contracts sweep session**, aggressive: delete contract prose that is stale, makes no sense, fights the
   constitution, or holds the work back. Map: `docs/contract-audit-2026-09-16.md`. Rule: delete prose, keep
   tests; a test justified only by a deleted line is re-justified in its own comment or removed on purpose.
   The store CONTRACT is exempt (rewritten fresh during the rebuild). Code comments citing deleted sections may
   dangle for now. Method: propose keep/delete per module, owner rules in batches of two or three with an ELI5.
3. Rulings on spec §10, questions 1–13.
4. Rebuild on a branch with hermetic tests: swap the floor (store: prose to rows), add the missing layer (page
   renderer, sleep-time self session, handoff lane), fix the plumbing (why the fallback out-writes the author,
   credit that moves, promotion reachable). Not a rewrite; the brain layer stays. Sizing in spec §14.
5. Fresh store seeded as above; retire the parallel-run scaffolding; live on it with the daily grade.

**Still standing from the section below:** the morning check (doctor, then the daily) still applies; the three
batches (audit rulings, the G61/G62 adapter PR, the core batch) stay on hold until the architecture lands; G56
seeding is needed regardless; the three-way identity comparison is prepped, not built.

**Process for the next session:** work in a worktree, never the live checkout; agents on Opus; the spec is the
record, so append to it rather than re-deriving; peer sessions can be reached with ListAgents/SendMessage.

## 2026-09-16, close — read sixth

**Everything is committed, merged, deployed and recorded. No PR is open, no worktree holds work.** Master and the
shared checkout are at the sha of this docs merge (`doctor` Checkout GREEN). The day's record is the 2026-09-16
entry below and in LAUNCH-STATUS (rulings G52–G63, findings I39–I41, the merge chain, restart #9) and
`docs/contract-audit-2026-09-16.md`. Session shape today: this coordinating session (Fable) + a `~/random`
session + a site session; a `dashboard/flat` worktree belongs to one of the owner's other sessions — leave it.

**DO NOT START the three batches the entry below lists (audit rulings, the G61/G62 adapter PR, the core batch).**
The owner said at close: *"I just recently realized our high level architecture isn't quite what I intended"* —
he thought the design was **Markdown files for the self, people, etc., with the rest in sqlite**, and it is not
(everything is rows + prose files under `store/prose/`). Another of his sessions is exploring the gap; the
architecture conversation comes first, with the audit as input, and the three batches wait on it. Cost of
waiting, named: migrated self beliefs keep being revised at bar 0 until G56 seeding lands (two so far; each is
archived with its successor, nothing is lost outright). Revisit if the wait passes a week. Also open, not decided:
G63 (bun vs Node, compiled binaries, npm launcher — see the LAUNCH-STATUS row).

**Next session, first:** `counterparts doctor --config ~/.counterparts/claude-code.json` (the four commands are on
PATH now, via `bun link`, tracking the shared checkout), then the daily for 2026-09-16 (command in "The morning,
in order"; expect `self.schema.pressure` to READ rows via #111, `memory.reinforced` FAIL until a session expands
or quotes, more `revision.pressure` rows at bar 0 until G56). Then whichever of the two conversations the owner
opens: the architecture gap, or the experiment below.

### The three-way identity comparison (owner's idea at close; prepped, NOT built)

Goal: three sessions, each with exactly ONE memory system live — Counterparts, bansai (v1), engram (v0) — so the
owner can compare what each holds as its self/identity/"personality", then have the three talk to each other and
compare for themselves. Estimated: ~1 hour of configuration, no code changes to any system. Everything below was
read from the live wiring on 2026-09-16 (read-only).

**How each system decides whether to speak in a directory (verified):**
- Counterparts: the scope registry (`counterparts scope <dir> --off` — hooks silent, tools refuse; merged #92).
- bansai: `~/.claude/hooks/bansai-optout.txt` (a directory list read by `bansai-guard.sh`) AND the A/B assignment
  file — `~/bansai/src/ab.ts` reads `MEMORY_AB_DIR` (default `~/.memory-ab`), whose `assignment.json` today says
  `override: "engram"` (= v2 primary), so bansai stands down everywhere. Its Stop/SessionEnd/PreCompact hooks were
  REMOVED globally on 2026-09-10 (G38); only session-start and user-prompt-submit remain, through the guard.
- engram: hooks at `~/claude-engram/hooks/{session-start,stop,session-end,pre-compact}.sh` — wired NOWHERE today;
  its MCP server was removed at run start (`~/counterparts-parallel-run/2026-09-03/mcp-servers-removed.json`).
  `session-start.sh` reads the same `~/.memory-ab/assignment.json`; `override: "engram"` makes it believe it is
  primary. `ENGRAM_DISABLE` exists as an env switch.

**The build (three subdirectories under `~/random`; project-level hooks/MCP MERGE with the global ones):**
1. `~/random/only-counterparts`: add the path to `bansai-optout.txt`. Nothing else (counterparts is on by default;
   engram is not wired).
2. `~/random/only-bansai`: `counterparts scope ~/random/only-bansai --off`; a `.claude/settings.json` there with an
   `env` block `MEMORY_AB_DIR=~/random/only-bansai/.memory-ab` and an `assignment.json` in it with
   `override: "bansai"`; optionally `claude mcp add --scope project` for bansai's server
   (`~/bansai/src/mcp/server.ts`, config preserved in `mcp-servers-removed.json`).
3. `~/random/only-engram`: `counterparts scope ~/random/only-engram --off`; add the path to `bansai-optout.txt`; a
   `.claude/settings.json` there wiring engram's four hook scripts (SessionStart, Stop, SessionEnd, PreCompact);
   `claude mcp add --scope project` for engram's server (`~/claude-engram/src/mcp/server.ts`).
4. The conversation: local Claude sessions can message each other in this build (ListAgents / SendMessage), or each
   writes its self-description to a shared file under `~/random/compare/` and the others read it.

**Three owner decisions before building:**
- **bansai's store.** A bansai session that delivers writes rows to v1's live log, and the parallel-run daily grades
  v1 as `muted-consistent` from that log — a speaking bansai could change that day's grade. Safest: point the
  experiment at a COPY of `~/.bansai` if bansai has a data-dir override (check `~/bansai/src` for it while
  building); otherwise accept and annotate that day's daily.
- **Whether bansai should also remember the conversation** — re-adding its three encoding hooks in that one
  directory's settings is possible; they encode through the Anthropic API (the $20 receipts, I30).
- **engram's API key.** The saved MCP config in `mcp-servers-removed.json` holds the key in PLAIN TEXT (seen
  2026-09-16, not copied anywhere). Have engram read it from its own env file (`hooks/load-env.sh`) rather than
  copying it into a project `.mcp.json`; the owner should scrub that saved file.

**Hazards:** never run any of the three systems' hooks or servers from an agent shell (they read the owner's live
stores); the `~/random` root itself must stay `on` for counterparts (the sub-directory entries are longest-prefix,
so `off` on a child does not touch the parent); `bansai-optout.txt` is read by the guard as prefix match, so list
the exact directories.

---

## 2026-09-16 — earlier state (superseded above)

**State:** master **`b9f4dd6`** (#92 → #111 → #110, in that order, all merged today). Then **#112 merged `24d3d26`**, the shared checkout **deployed at `24d3d26`** (~19:10Z), **restart #9 run** (19:12:43Z, same-date `2026-09-11`, active days kept). **#113 merged `07804c7`** (bin executable bit), **deployed `07804c7`** (mode-only, no restart owed; `counterparts --help` runs at the terminal again — I41 closed). Open: the day's record PR (#114). The morning check RAN (~14:00Z, read-only): `doctor` 0 red / 1
amber / 12 green (amber = one unembedded memory, cleared at the next boundary); the 2026-09-15 daily **ACTIVE**
(17 turns, `activeDays {0:1, P:4}`, `memory.reinforced` FAIL as forecast, earliest PROMOTE verdict ~09-19); the
`revision.pressure` rows are now **three**, and the third one HELD at a bar of 0.534 against the minted successor
from the first — migrated rows are free, minted ones are not. Record: LAUNCH-STATUS 2026-09-16 and
PARALLEL-RUN-STATUS's 2026-09-16 state section.

**What the owner ruled today** (one line each; the rows are in LAUNCH-STATUS 2026-09-16 "The rulings"):
**G56** = (a), seed dimensions on the 453 migrated schema rows — next core batch. **G57** = fix in core, the
confidentiality filter at credit time — same batch. **G58** = ruled as a PRINCIPLE, *"Exposure never strengthens.
Retrieval always does."*, with the old "trains nothing" rule recorded as a corrected, now-named deviation from
CONSTITUTION 12 — the text changes ride #112's rebase. **G59** and **G52–G54** deferred. **#92's three:** unset =
ON confirmed; the dormant first-launch ask superseded by G61; `off` silent confirmed, with one exception — a bad
`--config` in an `off` directory speaks one terminal line. **The review's three:** two exceptions, not one (the
corrupt half becomes G62); `resumeTo` returns to the PRIOR mode; the MCP server opening a store under `off` is
ACCEPTED — the `off` invariant is **no writes** (incognito), so "no store constructed" is documented as a
hook-only guarantee. **New and open: G63** — runtime and distribution (bun vs Node, compiled per-platform
binaries, an npm launcher so `npx counterparts install` works); not decided, discuss again before launch. **New
task:** an audit of every module CONTRACT against CONSTITUTION.md for drift (Opus agent running read-only; report
pending).

**The merge chain.** #92 `f17ba4f` (fast-forward on `76223ab`, merged as reviewed — the classifier refused this
session's merge and the owner ran `gh pr merge` from his own session), #111 `95acd06` (preview suite 2080 / 0 / 36), #110
`b9f4dd6`. **#112 is rebasing** onto `95acd06` with ruling 9's text folded in (recall claim, mcp CONTRACT
"exposure is not recording", per-store salt, the module-map entry for `scopes.ts`); then preview suite → merge →
`tools/deploy-checkout.sh` → **ONE restart** `--date 2026-09-16`.
**#112 MERGED `24d3d26`** (owner's `gh pr merge`; the classifier refused the session's twice today): Opus rebase onto `b9f4dd6`, head `debed4a` — five textual hunks (hooks.ts / server.ts / lifecycle.test.ts import blocks, twice; claude-code NOTES.md), plus a SEMANTIC catch: the #92 review's `recordSession` inside `input()` stamped each test session at the Stop, so #112's session floor dropped the resolution — A1–A3 were passing vacuously and six handle-door arcs raced `Date.now()` (~1 run in 3 red); fixture-only fix (`0e1b4e7`, `a6fd81b`), the live host cannot reach that shape (`sealJoinedLate`). Ruling-9 commit `1f50b0a`: recall claim rewritten, mcp CONTRACT §26 'Exposure is not recording; retrieval is' with the named deviation, per-store salt at `<dataDir>/sessions/expansions.salt` (minted once, 0600, fails closed; +3 tests), module-map row for `scopes.ts`. Coordinator-verified on the head: suite **2108 / 0 / 36**, hash `c3af0bef00209ba6`, `src/core` diff empty. Open half: the same absolute still stands in `src/core/recall/CONTRACT.md` §3 and guarantee 8 (core; next batch). **Deployed `24d3d26`** by `tools/deploy-checkout.sh` at ~19:10Z (first refused: the owner's `bun link` had chmod'ed the four bin scripts, four tracked mode changes; restored, then deployed — see I41). **Restart #9 at 19:12:43Z**, `--date 2026-09-11` (same-date re-restart, NOT `--date 2026-09-16` as the line above planned: a new first day would have zeroed the four active days; `activeDays {0:1, P:4}` kept), reason names the deploy sha and the four PRs. `doctor` after the deploy: 0 red / 0 amber / 13 green, Checkout GREEN at `24d3d26`, lived day 190, Vectors 0 unembedded, Credit `nothing-to-credit` 0 of 1 considered. **PR #113** (`fix/bin-executable-bit`): the four `package.json#bin` scripts carry `100755`; mode-only; after merge, one more `deploy-checkout.sh`, no restart owed.

**The follow-up adapter PR (one PR, after #92 — spec in LAUNCH-STATUS rows G61 and G62):** ask-first and silent
until answered in an unset directory (no wake, no recall, no capture, registry-only read; terminal `systemMessage`
at the top with zero context bytes; a ~200-byte model block; answering `on` returns the wake in-band from the
`scope` tool; unanswered ⇒ `on` from the second session; a one-time owner command marks `on` every directory the
store has already recorded from, run at deploy) **+ G62** (corrupt registry ⇒ observer everywhere plus a line each
session; one refused entry ⇒ that directory observer plus a line naming it) **+ ruling 4** (a bad `--config` under
`off` speaks one line) **+ `resumeTo` → prior mode**. I40 is inside it: the trouble sentence must move from stderr
to `systemMessage`. The terminal line reads: say "turn memory on", or `! <absolute invocation> scope . --on` built
from the hook's own launch path (the owner's `bun link` at 11:05 local put all four commands on PATH against the
checkout, so the pasted form works).

**The next core batch** — one declaration, one restart, nothing else in it: **G56** seeding dimensions on the 453
migrated schema rows; **G57** the credit-time confidentiality filter in `recall/`; **I39** the pragma reorder in
`src/core/store/db.ts` (`busy_timeout` before `journal_mode`, lines 169/174 today). I39 also **closes I38**: the
live events are clean and `openOperational` takes no write lock on a current-schema store, so the seal is not at
risk — only the zero-wait open window is.

**Tomorrow's morning check:** `doctor --config ~/.counterparts/claude-code.json` first, then
`daily.ts --date 2026-09-16`. Expect `self.schema.pressure` to READ the rows now (#111 merged) instead of the
hard-coded not-exercised; expect more `revision.pressure` rows against migrated beliefs **at bar 0** until G56
lands; expect `memory.reinforced` to stay FAIL until a session expands a memory by id or quotes one.

**Three sessions today, for the record:** this one coordinating from `.claude/worktrees/coord-docs`; the
`~/random` session reporting the user side and minting the first credited row; the site session readying the page
but **not deploying** it before the flip.

---

## 2026-09-15, afternoon — earlier state (superseded above)

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
full list). **Fixes LANDED, head `d6083de`**, re-verified by this session (suite 2077 / 0 / 36, hash unchanged, core untouched,
`scopes.test.ts` 54 / 0). #112 fixed head `3fc77d7` likewise re-verified (2048 / 0 / 35). Trial merge: four files, one
hunk each (hooks.ts = import block). **One open question on #92 before merge (I38 × F1): can a SessionStart stand down at store OPEN on a lock, leaving
no session record, so that the first Stop SEALS and discards instead of recovering from cursor 0? `noteSession("start")`
writes the record before the first sqlite write, so only an open-time lock reaches it; confirm whether `Store.open`
takes a write lock under `journal_mode = DELETE`. Everything else is blocked on the owner.** Order:
rulings → merge #92 → Opus agent rebases #112 and re-runs the seal + A1–A3 tests on the combined tree → merge #112 →
`deploy-checkout.sh` → ONE restart. Also new: **I38** (`database is locked` stand-down after a Stop, 3/8 in the
fixer's test; check the live events for it tomorrow), G59 (seal residues), G60 (core `sealCursor` seam). The owner's
rulings — now NINE (G56, G57, G58, G59 plus the five below): the PR's three, plus the review's three
(two exceptions not one; `off → pause → resume` reaches `on`; MCP server opens a store under `off`), plus #112's two.
Original attack list, for the record:  (attack the registry's longest-prefix match, the
`off` path's "no output, no store created" guarantee against `spawnWorker` / the doctor notice / `recall.credit`,
the env-observer directories still standing down, the MCP `scope` tool ahead of the session bind), preview-merge
suite, then the owner's three rulings (dormant first-launch ask; unset = on; `off` silent) before or at merge.

**Worktrees left checked out under `.claude/worktrees/` (clean up AFTER the merges; do not develop in them):**
`agent-a1eff85243757120f` (feat/scope-controls at the PRE-fix `2677c6e`), `agent-ab46e32d6091d5420` (branch
`scope-controls-fixes` at `d6083de` = the pushed head), `agent-a5f4edc2f95d4221f` (mcp/handle-expansion-credit at the
PRE-fix `f0428a8` — six behind origin; a push from there without a fetch is rejected), `agent-ab5f89df1c48abdb4`
(`fixes/pr112-review` at `3fc77d7` = the pushed head), `agent-aee1e116fdfcd91be` (tools/daily-pressure-watch at
`ed83450`), two detached reviewer worktrees (`agent-a021d7c142ec7c49f`, `agent-af46353102071f1a0`), and the old
`agent-aa81a3ae1a500cad6` (`launch/w1-round9`, stale since before 09-14). `coord-docs` holds this record's branch.

**Next, in order:** (1) the owner's rulings, then the merge chain above (#92 → #112 rebase → deploy → one restart); (2) **G55 is PR #111** (`ed83450`, tools only, suite 2026 / 0; merge under the
standing approval after a preview-merge suite — it changes what tomorrow's daily prints for `self.schema.pressure`) and
**G50 is PR #112** (`f0428a8`, NOT small: a new `sessions/expansions.jsonl` translation log on the boundary's credit path,
overlapping #92 on `hooks.ts` / `server.ts`; review DONE: MERGE WITH FIXES, F1 BLOCKS — three confirmed over-credit sequences through the shared handle log;
**fixes LANDED, head `3fc77d7`** (suite 2048 / 0 / 35, hash unchanged; scope filter + session-start floor, compaction
splice, `at`-ordering, `expansionsRead` on the row, inside the try; test seam `duringWindow?` to ratify). **Merge order: #92 first**, then rebase #112 (import-block conflicts only; combined suite 2080 / 0). New
G57 (core has no confidentiality filter at credit time — the id door is open, pre-existing) and G58 (`recall`'s
`claim` text false twice; unsalted handle key) need the owner; (3) G52–G54 and G56 rulings with the owner; (4) tomorrow's morning check is `doctor` then
`daily.ts --date 2026-09-15` — plus a read-only grep of `events` for `locked` / `BUSY` codes (I38); expect the amber gone, `memory.reinforced` still FAIL until a session expands or
quotes, and watch for a second `revision.pressure` row (each is a migrated belief revised at bar 0 until G56 is
ruled).

---

## 2026-09-14, evening — earlier state (superseded above)

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

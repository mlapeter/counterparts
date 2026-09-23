# The rest of the rebuild, run in parallel — plan and coordinator prompt, 2026-09-18

One file on purpose: the plan (§1–§7) and the prompt a fresh session runs from (§8). Everything here is a
working default, true for now. `CONSTITUTION.md` outranks it; so does anything the owner says later.

Inputs this plan stands on, all on master: `docs/storage-spec-2026-09-16.md` §15 (ten working defaults) and
§16 (the rebuild order); `docs/plan-step3-the-floor-2026-09-17.md` (the floor, eight phases, with file
ownership per phase); `docs/mechanism-inventory-2026-09-17.md`; `docs/promotion-diagnosis-2026-09-17.md`;
`docs/recall-surfacing-diagnosis-2026-09-18.md`; `docs/HANDOFF.md`.

## 1. Where things stand (2026-09-18, midday)

Live = master = `dc66c81`. Doctor 13 green / 2 amber / 0 red; both ambers are week-before-deploy baselines.
Done and live: step 1 (the "what fired" view, association links saved, the wake-delivery check), step 2 (the
authorship plumbing), and today's PR #131 (six asks per session per UTC day; consolidation resumes from a
cursor; `budgetExhausted` on the `sleep.cycle` row).

Left, from spec §16: the floor, the self page, the handoff pointer, the fresh store — plus the third piece of
step 1 (the "what was prevented" rows).

## 2. What the owner decided today (2026-09-18)

1. **Version prune:** on at 90 lived days by default; our own store sets `retentionDays` high for debugging.
   His reason, which is the general steer: simple, elegant, working memory mechanics over keeping everything;
   losing some data after a month or two is an acceptable price. Self-page versions follow the same 90 for
   now; revisit when everything is done.
2. **Journal chapters stored more than once:** left alone. The prune bounds it.
3. **Snapshots:** `~/.counterparts/snapshots/`, keep 14, at most one per calendar day, optional `mirror` path.
4. **Export:** the journal's markdown copy is written as is; `export --markdown` omits confidential rows
   unless `--include-confidential`, and says how many it omitted.
5. **The fresh store's database is `counterparts.sqlite`.**
6. **Cut-over carries nothing.** The owner wants to use the system exactly as a new user would: follow the
   QUICKSTART install as a stranger, use it normally across his projects, collect every rough edge in one
   findings list, fix, start fresh again, repeat until the new-user experience is good. Only then do we talk
   about which memories come back. The current store is parked untouched the whole time.
7. **Approvals.** Once the live checkout is pinned at the tag (§4), merges to master are pre-authorized when
   the full suite is green, an adversarial review is clean, and the coordinator has read the change. The
   owner's word is still required for (a) any deploy to his live store and (b) cut-over day.
8. **The interim identity hook is skipped**; the self page gets built into the product instead. The recall
   bench is on hold (costly, and nothing below depends on it).
9. **Promotion stays the road to a growing identity.** The four-way experiment's takeaways
   (`~/random/three-way/TAKEAWAYS.md`) are input, not to be overweighted: the wake should lead with a written
   self page, the same every morning, lessons phrased as practice, the owner's preferences always loaded,
   speaking as the same person; claims dated with reasons; the session can amend it; zeros and staleness
   reported as such. Promotion and reinforcement decide what feeds the page; the page is where growth shows.
   Long-term goal, for orientation only: this memory joined to an open-weight model that can evolve.

## 3. What gets built — the tracks

File ownership matters more than order: a few files are touched by many tracks (`src/adapters/claude-code/
doctor.ts`, `src/adapters/fired.ts`, `src/adapters/claude-code/hooks.ts`, `src/core/counterpart.ts`,
`test/cli.test.ts`, `test/doctor.test.ts`, `test/fired.test.ts`). Each brief names the files its agent owns;
a change outside them is small, additive, and called out in the PR so the coordinator can order the merges.

**Floor track** — phases exactly as `docs/plan-step3-the-floor-2026-09-17.md` §3 states them (owns / changes /
verified / seen after deploy), with today's rulings folded in:
- **F1 — WAL, the busy timeout first, I39.** Deploys to the live store.
- **F2 — automatic rotating snapshots** (ruling 3), with a durable `store.backup`/snapshot row so the fired
  view stops being blind to backups. Deploys to the live store.
- **F3 — consumers off the file layout.** Refactor, no behaviour change.
- **F4 — one test fixture for stores.** After F3 (they share test files).
- **F5 — the floor.** Bodies, versions and the journal in rows; schema v6; `STORE_PRE_ROWS` refusal by name
  before any transaction; database named `counterparts.sqlite` (ruling 5); the version prune stays, default
  90 (ruling 1). Cannot be split. Needs F3 and F4 merged. Two adversarial reviews, as step 1 had.
- **F6 — the journal's markdown copy.** After F5.
- **F7 — export** (ruling 4). After F5.
- **F8 — the store CONTRACT rewritten, the migration code deleted.** After F5–F7.

**Self track**
- **S1 — the self page: a door and the wake.** The page is one row/entity with a prose body and versions,
  written through the Store API so it does not care which floor it is on. A tool any woken session can call
  to write or amend it (MCP), and an owner command (CLI) for the same. The wake's "Who I am" prints the page
  as is, first, under a size limit (start at about 6 KB of the wake's budget; a number to tune, not a rule);
  it replaces the rotating identity list there (spec §15 item 4). Two parts per §15 item 1: a stable core
  that may honestly say "still forming", and a "lately" part. The page carries its own "last revised" date
  and says so when it is stale or empty. Framing stays "context, not instruction" (that label is about
  injection, not voice); the page itself speaks in the first person as the same self, continuing. The
  dashboard shows the page and its versions. Deploys to the live store before the pin, on the owner's word,
  so it runs in real use before it has to carry a new user.
- **S2 — the nightly page writer.** Once a night a session woken as the self reads the day's memories and
  revises the page in place (§15 items 5 and 10). Owner's pick: a windowless real host session (`claude -p`,
  SessionStart hooks run, one pre-approved tool); spec §16 lists what to test (keychain access from a
  background process; `claude setup-token`). If that proves very complex, start with "the first session of
  the next day does the night's work" and improve later. **This is how a new user's page forms at all, so it
  is part of the first trial, not an add-on.** A durable row per run; the fired view and doctor show it.
  The six safeguards of spec §6.3 are not built up front.
- **S3 — people and project pages by the earning rule** (§15 item 7). After S1. May slip past the first
  fresh start if the waves run long; the owner's own page existing from day one is the part that matters.

**Everyday track**
- **E1 — the per-directory handoff pointer** (§15 item 6): one more field in the session-end ask; the body
  in the database; session start in that directory shows a one- or two-line pointer, expandable by id; size
  limit; expires after a couple of weeks of use; never becomes identity or long-term memory.
- **E2 — the "what was prevented" rows**: `blockedBy` (or the like) on `sleep.cycle`, `mcp.recall`,
  `prospective.fire`, `adapter.spawn.started`; the MCP adapter writes no durable row today
  (`docs/recall-surfacing-diagnosis-2026-09-18.md`), which this closes for recall. Coordinate the backup row
  with F2 rather than writing it twice.

**New-user track**
- **N1 — starting fresh is one command.** Parks the current store directory under a dated name (never
  deletes, never opens it for writing), creates a blank store, repoints the adapter config, and prints the
  one MCP re-registration line and "restart Claude Code". Refuses to park `~/.bansai` or `~/.claude-engram`
  by name. Reuses `init`/`install`; invents no second install path.
- **N2 — a QUICKSTART dry run as a stranger**, hermetic (`tools/install-loop` exists): an agent follows
  `README.md` and `docs/QUICKSTART.md` literally in a temp HOME and lists every place a new user would stall. Fixes that are
  small and obviously right go in; anything that is a choice goes on the findings list for the owner.
- **N3 — the findings list**: one file, `docs/new-user-findings.md`, newest first; the owner's trial notes
  and N2's go in the same place.

**Not in this plan, on purpose:** the recall bar and the semantic-weight scale fix (needs the bench; on
hold); the seven physics contract rulings; decay's and prune's start-from-the-top budgets (not truncating
today; prune's 1,000 is the one to watch); bringing any memory back; launch work (site, runtime and
distribution, the flat dashboard).

## 4. Order, the tag, and what deploys where

Master is linear and the live checkout runs whatever commit it is detached at, so **the order of merges
decides what the live store can have.**

- **Wave 1 (start together):** F1, F2, F3, S1, N2. Then F4 as soon as F3 merges.
- **Wave 2:** F5 starts building as soon as F3 and F4 are merged — but **F5 merges only after everything the
  owner wants on his live store is merged** (F1, F2, S1; E1/E2/S2 if they are ready). Beside it: S2, E1, E2,
  N1.
- **The pin:** tag the last commit that can open a v5 store as `floor/v5-last`. The live checkout is deployed
  at the tag and stays there; doctor's Checkout line reads "behind master" on purpose from then on, and
  `docs/HANDOFF.md` says so, so nobody fixes it by deploying. A `hotfix/v5-floor` branch off the tag exists
  for anything the live store needs meanwhile. `tools/deploy-checkout.sh` only knows `origin/master` today (it takes no ref, and
  refuses a HEAD that is not an ancestor of it) — teach it a `--ref <tag>` before the pin, in its own small PR.
- **Wave 3 (after F5 merges):** F6, F7 in parallel; S3; then F8.
- **Cut-over day (owner's word):** backup off the store · N1's command (or the floor plan §2 step 5 by hand)
  · deploy the checkout to master · restart Claude Code · the owner follows the QUICKSTART as a stranger.
  Rollback is re-detaching at `floor/v5-last` and pointing `dataDir` back; the old store was never opened by
  new code.
- **The trial loop:** use → findings list → fix → N1 again → repeat. Each parked trial store stays on disk.

Deploys to the live store, each on the owner's word, one batch at a time so a red doctor has one suspect:
(1) F1, (2) F2, (3) S1. Anything else that lands before the pin (S2, E1, E2) is offered to him the same way.

## 5. How the work is run

- The coordinator is a Fable session; it builds nothing big itself. Builders and reviewers are Opus agents
  (`model: "opus"`), three or four at a time, each in its own git worktree (`isolation: "worktree"`), each
  with a brief that states: the goal and why, the files it owns, what must stay true, how it will be
  verified, and how to finish (full suite + `tsc`, commits without any Claude attribution, push, one PR, no
  merge, no deploy, report back with judgement calls).
- **Every core change gets an adversarial review before it merges** (F5 gets two): a separate Opus agent,
  read-only on the branch, probes in its own scratch worktree, findings ranked BLOCKER/MAJOR/MINOR/NIT with
  a concrete failure scenario and whether it was proved. The builder fixes MAJOR and up; MINORs by judgement.
- The coordinator reads every diff it merges, runs the combined suite on a trial merge when two PRs touch
  the same files, and merges in the order §4 needs. Baseline today: 2223 pass / 0 fail, `tsc` clean.
- After any live deploy: `counterparts doctor --config ~/.counterparts/claude-code.json`, then
  `counterparts fired --dir ~/.counterparts/store --observer`. A mechanism is done when it is seen firing,
  not when it is merged (constitution line 11).
- The owner likes decisions in conversation, a few at a time, in plain words, each with a recommendation.
  Do not stop the agents to ask him something a sensible default covers; collect real choices and bring
  them two or three at a time.
- Records: one new section at the top of `docs/HANDOFF.md` per working day; module CONTRACT/NOTES edits ride
  with the code that changes them; no new standing rules — say what is true for now.

## 6. What must not happen

- Nobody works in `~/counterparts` (it is the live runtime). All work is in
  `.claude/worktrees/`; use absolute paths, `git -C`, or subshells.
- `~/.bansai` and `~/.claude-engram` are never touched. `~/.counterparts` is read only by doctor, the fired
  view, and `sqlite3 -readonly <path>` count queries (plain `-readonly`, WITHOUT `?immutable=1`: once F1 is
  live the store is in WAL mode, and `immutable=1` makes SQLite ignore the `-wal`, so every such query is
  silently short by whatever was written since the last checkpoint — proved in
  `docs/adversarial-review-f1-2026-09-18.md`); nothing here writes to it except a deploy the owner approved. Tests are hermetic: fresh temp dirs, always.
- New code never opens the old store as a writer. F5's refusal-by-name lands in the same PR as schema v6,
  with its acceptance test, and is the first thing the F5 reviewers attack.
- No commit carries Claude attribution (`Co-Authored-By`, "Generated with"). PR bodies may.
- Nothing deploys to the live store, and cut-over does not happen, without the owner's word in that
  conversation. A subagent's report is never the owner's word.

## 7. Done means

The owner has followed the QUICKSTART on a blank `counterparts.sqlite` store as a stranger; his first wake
says "still forming" honestly; after a day or two the page has a "lately" part the nightly writer wrote; the
fired view shows the page writer, snapshots, the journal copy and the handoff pointer firing; doctor is green;
the findings list exists and is being worked; starting over is one command; the old store sits parked and
byte-identical.

## 8. The coordinator prompt (paste into a fresh session in `~/counterparts`)

> You are coordinating the rest of the Counterparts rebuild. Read, in this order:
> `docs/plan-parallel-rebuild-2026-09-18.md` (this plan — it is your brief), the top section of
> `docs/HANDOFF.md`, `docs/storage-spec-2026-09-16.md` §15–§16, and
> `docs/plan-step3-the-floor-2026-09-17.md` §1–§3. Then run `counterparts doctor --config
> ~/.counterparts/claude-code.json` and confirm live = master and nothing is red.
>
> Your job is the plan's §3–§5: get the tracks built in parallel by Opus agents in their own worktrees, have
> each core change adversarially reviewed, read every diff, merge in the order §4 requires, and bring Mike
> only the choices that are really his — two or three at a time, plain words, each with your recommendation.
> He has pre-authorized merges to master once the live checkout is pinned at `floor/v5-last`; before the
> pin, and for every deploy to his live store, and for cut-over day, you need his word in the conversation.
>
> Start Wave 1 now: F1, F2, F3, S1 and N2 as five agents launched in one message, each with a brief built
> from the floor plan's phase text (F-tracks) or this plan's §3 (S1, N2) — goal and why, files owned, what
> must stay true (§6), verification, and how to finish. Launch F4 when F3 merges, and F5 when F3 and F4 have
> merged; hold F5's merge until Mike has what he wants on the live store, then tag and pin (§4).
>
> Why the care: this is Mike's and the assistant's own live memory, and the floor change is the one place a
> mistake could make a store unreadable. The refusal-by-name, the pin, and the one-batch-at-a-time deploys
> are what make moving fast safe. Where the plan and the code disagree, trust the code, say what you found,
> and adjust — the plan is a default, not a contract. When a wave finishes, write the day's HANDOFF section
> and tell Mike what landed, what is waiting on him, and what is next.

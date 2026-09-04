# Goal

Take Counterparts (`~/counterparts`) from feature-complete to public-launch-ready. Four
deliverables: (1) **verified solid and stranger-installable** — a person who has never seen
this project gets a working memory by following the README alone; (2) **the dashboard
finished, working, and beautiful** — it is the launch's visual centerpiece (README images,
the marketing site, reddit posts); (3) **a public-ready repo** — an easy-to-read README,
licensing pack, history hygiene, and a staged flip checklist; (4) **a new marketing site
for counterparts.ai**. This is a finishing-and-hardening session over an existing,
adversarially-reviewed codebase — not a rebuild. The bar: a skeptical stranger installs
it, it works first try, and the visuals make them stop scrolling.

# Read first

`CLAUDE.md`, then `CONSTITUTION.md` (the only document with standing authority —
everything else, including this prompt's specifics, is a working default). Then
`docs/PARALLEL-RUN-STATUS.md`, day-1 entry first — the living record of what is true
now — and `docs/ELI5.md` for the map in plain words. `docs/BUILD-STATUS.md` is 08-25
vintage and 22 merged PRs stale (#7–#28); read it only for the carried gaps it names.

# What changed since this prompt was written (2026-09-04) — read before starting

first real conversation was reviewed, and **PRs #17–#28 merged in one day** (suite 1239 →
1431). `docs/BUILD-STATUS.md` is now 22 PRs stale; the living record is
`docs/PARALLEL-RUN-STATUS.md` (read its day-1 entry first) and the plain-words map is
`docs/ELI5.md`. What changed that this session must know:

- **`~/.counterparts` is now the owner's LIVE production memory.** Add it to the
  off-limits list beside `~/.bansai` and `~/.claude-engram`: never read it, never write
  it, never point a demo, screenshot, install loop or dashboard at it. Synthetic demo
  stores only, in temp dirs.
- **The hooks run `~/counterparts` master directly.** Every merge to master changes the
  owner's live memory behavior at the next hook event, and the parallel run's carry-forward
  rule restarts the phase clock on behavior changes (restarted 2026-09-04, first counting
  day 2026-09-05). So: core `src/` behavior changes are NEEDS-OWNER during the run, even
  with a test; adapters, docs, dashboard, packaging and the site are free. Never run
  `tools/parallel/bin/daily.ts` or `restart.ts` against the real run directory from this
  session; the owner runs the daily.
- **Behavior that is different from what older docs describe:** the transcript sweep runs
  only for crashed sessions (no session-end boundary, 12 h silent), never at Stop, session
  end or compaction; one Stop ask on one pacer (cap 4 per day) names the session id and two
  tools; `session_end` binds lazily to a live session from the registry under
  `<dataDir>/sessions/`; the `chapter` MCP tool writes the episode; `note` and
  `session_end` take `updates` and per-dimension salience; unclaimed authored memories
  get a 0.25 floor; the wake has a delivery preface and an identity share; recall has a
  lagged semantic channel, BM25 length normalization and floors in cue units; sleep never
  touches episodes. Any README or site claim about these must be traced to the current
  code, not to BUILD-STATUS.
- **Known stranger-install blockers, for the W1 inventory (verified bugs, PR them):**
  (1) the default data dir is `~/.counterparts` itself and the hook config
  `claude-code.json` lives inside it, which the store's layout check rejects at open — the
  live host works only because its config sets `dataDir` to a subdirectory; (2) the README
  and QUICKSTART say nothing about `dataDir`, `credentialsFile` (the 0600 file both the
  hooks and, since #23, the MCP server read for the embed key), `COUNTERPARTS_DATA_DIR`,
  or the `sessions/` registry; (3) the MCP server must be registered with
  `COUNTERPARTS_DATA_DIR` in its env and is launched from static config — sessions open
  across an upgrade keep the old server until restarted; (4) the vector cache stores
  embeddings as JSON text (177 MB at 13.9K vectors, nearest scan 0.6–1.0 s at that size) —
  irrelevant to a fresh install, a named debt for the docs' honesty.
- **Dashboard nits from today:** `dashboard/browse.ts` and `stories.ts` still walk
  `store.list()` and may render episode rows as memories; the status line now counts the
  journal apart from live memories. Read-only, presentation only.
- **Housekeeping done:** the merged agents' worktrees are removed and pruned; the
  day-0 pre-flip and pre-backfill backups sit in `~/counterparts-backups/` (never a demo
  source).

# How to work

1. **Inventory before polish.** First deliverable: reconcile BUILD-STATUS's layers into
   one current `docs/LAUNCH-STATUS.md`. Run the full suite and typecheck, then verify or
   refute each "merged, not yet verified live" item. Verified by the parallel run as of
   2026-09-04, evidence in `docs/PARALLEL-RUN-STATUS.md`: the MCP handshake (the
   `counterparts` server is registered and used daily, five tools: note, recall, status,
   session_end, chapter); the hooks inside real Claude Code sessions (all five events,
   two days); the interpret client's real API calls (day-0 sweeps and the sample replay,
   record `run_6530ad2ee770`); `backup` against the real store (2026-09-04); the
   migration confidentiality mapping (day 0: 26 redactions, 10 floor refusals). Still
   unverified live: `export` and `remove` against a real non-temp store (use a COPY of a
   temp store, never the live one); CLI §7 (an observer mints an absent store at open);
   replay §2a (authored-path gate records). Understand the trap this step exists for: the pipeline is
   live-verified *from inside the repo, in temp stores, under bun* — nobody has ever
   installed Counterparts from the README on a machine without the repo. 1,431 green tests
   are not the bar; a stranger's clean install is. Known today, before anyone installs
   anything: `package.json` has no `bin`, `files`, `main` or `exports`, so `npm pack`
   ships nothing runnable; the README and QUICKSTART never mention `dataDir`,
   `credentialsFile`, `COUNTERPARTS_DATA_DIR`, the `sessions/` registry, or how the
   system behaves with no embed key (it degrades to lexical recall and says so; document
   it); the default data dir is `~/.counterparts` itself with the hook config inside it,
   which the store's layout check rejects at open.

2. **Build the verification loops before the polish.** (a) *Install loop:* a scripted
   clean-room install — fresh temp HOME, no repo checkout, following only the written
   install docs, ending in a working wake → recall round-trip — repeatable after every
   packaging change. (b) *Visual loop:* headless-browser screenshot tooling (playwright is
   available) that starts the dashboard, seeds a store, and captures every view as PNG
   plus a console/JS-error log. **All screenshots come from a synthetic demo store, seeded
   rich** — fictional people, beliefs, episodes, a self, edges — because these images go
   in the README and on reddit. Never the live stores, in any form. No agent claims
   anything it hasn't run or screenshotted itself.

3. **Fan out in waves, one owner per workstream.** Wave 1: the inventory (step 1) plus
   both verification loops. Wave 2, in parallel — **W1 install/packaging** (npm pack,
   quickstart, the clean-room loop green), **W2 dashboard** (finish and polish; empty-store
   and rich-store states both handled gracefully), **W3 repo-public prep** (README
   rewritten for a cold reader; MIT licensing pack — the license is DECIDED, owner
   2026-09-03: LICENSE file, package.json field, no CLA; full git-history secrets scan;
   de-personalization pass; per-file ship list; flip checklist).
   Wave 3: **W4 marketing site**, last — it consumes W2's screenshots and W3's settled
   claims. Donors, read-only: `~/bansai-site` (structure, content to adapt) and
   `~/marketing-agents/BANSAI_MARKETING_PLAN.md` (strategy; note the trust-axis lead is
   tactics, not identity — lead with what Counterparts is and what it unlocks). Core
   `src/` behavior changes only for verified bugs, each with a test, PR'd and
   adversarially reviewed before merge — that process caught four real issues in the last
   arc and eleven more on 2026-09-04; keep it. AND: the hooks run `~/counterparts` master
   directly, so a core change alters the owner's live memory at the next hook event and
   restarts the parallel run's phase clock — every core change is NEEDS-OWNER before
   merge while the run is on.

4. **Gauntlet every workstream with critics who write no code.** A **cold-stranger
   critic** for install + README: enters with zero prior context, times the path to a
   working memory, logs every point of confusion, scores 0–10. A **design-director
   critic** for dashboard + site: takes its own screenshots across store states and
   viewport sizes; zero console errors required; 0–10 where 10 = a screenshot alone makes
   a stranger stop scrolling, 8.5 = ship with nits, 5 = programmer art. A **claims
   auditor** for README, site copy, and CLAUDE.md: every claim traced to a specific test,
   command output, or measurement — never to another document; one claim stronger than
   the code = automatic fail. Pass = ≥8.5 with zero errors and a clean claims audit.
   Below that, the builder gets the ranked issue list and goes again, up to 4 rounds.

5. **Final gate.** One end-to-end launch dry-run: clean-machine install from the README
   alone; dashboard visuals regenerate from the demo store; flip checklist complete.
   Then STOP — everything staged, nothing executed.

6. **Persist and loop.** Scores, open issues, spend log, and a NEEDS-OWNER list live in
   `docs/LAUNCH-STATUS.md`; each iteration resumes from the weakest workstream, not from
   scratch.

# Rules

- Never touch `~/.bansai`, `~/.claude-engram`, or **`~/.counterparts`** (the owner's
  live Counterparts memory since 2026-09-03) — absolutely off-limits, in any form: no
  demo, screenshot, install loop or dashboard points at them. `~/.memory-ab` and
  `~/counterparts-parallel-run/` are the run's state and instrument output: read-only
  here; never run `tools/parallel/bin/daily.ts` or `restart.ts` from this session.
  Tests stay hermetic in fresh temp dirs, always.
- `~/bansai`, `~/bansai-site`, `~/claude-engram` are read-only donors. Never import from
  or modify them.
- Owner-only actions — stage, never execute: flipping the repo public, deploying the site
  to a public domain, npm publish, posting anywhere. (The license is already decided —
  MIT — and is not revisited here.)
- API spend: trivial single-call verifications are fine; anything over ~$5 goes to
  NEEDS-OWNER first. The sample replay already ran on day 0 (record `run_6530ad2ee770`, ~$16–20) — do not
  run it again.
- Agents run on Opus by default, at any volume; Sonnet is fine for mechanical fan-out.
  Fable only where judgment density clearly earns it (final review passes, the claims
  audit) — conserve Fable tokens.
- Never inflate scores or claims. Real numbers, failed rounds, what is still missing.
  When a builder and a critic disagree, the critic's screenshot wins.
- Make routine decisions yourself, state assumptions, keep going. Only NEEDS-OWNER items
  wait for the owner.

Start now.

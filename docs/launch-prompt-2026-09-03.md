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
`docs/BUILD-STATUS.md` — knowing it is 08-25 vintage and six merged PRs stale: its
night-shift section closed gaps 1–4, and PR #6 later closed replay §1a.

# How to work

1. **Inventory before polish.** First deliverable: reconcile BUILD-STATUS's layers into
   one current `docs/LAUNCH-STATUS.md`. Run the full suite and typecheck, then verify or
   refute each "merged, not yet verified live" item: a real MCP client handshake;
   `backup`/`export`/`remove` against a real non-temp store; the interpret client's first
   real API call; the hooks inside an actual Claude Code session; replay-harness state
   after PR #6. Also carried open: CLI §7 (an observer mints an absent store at open),
   replay §2a (authored-path gate records), and the migration confidentiality mapping
   (BUILD-STATUS gap 5). Understand the trap this step exists for: the pipeline is
   live-verified *from inside the repo, in temp stores, under bun* — nobody has ever
   installed Counterparts from the README on a machine without the repo. 1018 green tests
   are not the bar; a stranger's clean install is.

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
   arc; keep it.

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

- Never touch `~/.bansai` or `~/.claude-engram` — live memory, absolutely off-limits.
  Tests stay hermetic in fresh temp dirs, always.
- `~/bansai`, `~/bansai-site`, `~/claude-engram` are read-only donors. Never import from
  or modify them.
- Owner-only actions — stage, never execute: flipping the repo public, deploying the site
  to a public domain, npm publish, posting anywhere. (The license is already decided —
  MIT — and is not revisited here.)
- API spend: trivial single-call verifications are fine; anything over ~$5 goes to
  NEEDS-OWNER first. The sample replay run is separately queued — do not run it.
- Agents run on Opus by default, at any volume; Sonnet is fine for mechanical fan-out.
  Fable only where judgment density clearly earns it (final review passes, the claims
  audit) — conserve Fable tokens.
- Never inflate scores or claims. Real numbers, failed rounds, what is still missing.
  When a builder and a critic disagree, the critic's screenshot wins.
- Make routine decisions yourself, state assumptions, keep going. Only NEEDS-OWNER items
  wait for the owner.

Start now.

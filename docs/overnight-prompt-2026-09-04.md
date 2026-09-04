# Overnight prompt — 2026-09-04 → 05

# Goal

Counterparts is launch-ready on master except for the owner-only flip. This session spends the
night on the items the owner ruled AFTER LAUNCH on 2026-09-04, plus the hardening debts named in
`docs/LAUNCH-STATUS.md`, so that the morning finds each one on a reviewed branch with a PR, a test,
and a one-paragraph NEEDS-OWNER entry — nothing merged that changes the live system. The bar is
the same as the day's: verified, not merged; real numbers; no claim stronger than the code.

# Read first

`CLAUDE.md`, `CONSTITUTION.md` (the only page with standing authority), then `docs/LAUNCH-STATUS.md`
in full — every dated entry, the findings I1–I16, the NEEDS-OWNER table — then
`docs/PARALLEL-RUN-STATUS.md` (the live run's state and the G12 carry-forward rule's evidence),
`docs/QUICKSTART.md`, `docs/ELI5.md`, `docs/module-map.md`. Then, per workstream, the module's
`CONTRACT.md` and `NOTES.md`.

# What is true tonight (2026-09-04, evening)

- Master carries the whole launch build: packaging, `counterparts install|init|note|recall|verify`,
  the clean-room install loop (30/30), the web dashboard (`counterparts-dashboard serve`), the
  synthetic demo store (`tools/demo/seed.ts`), the visual loop, README and QUICKSTART audited
  twice, the de-personalized tree, `docs/launch/flip-checklist.md`. Suite ≥ 1,557 / 0.
- The owner's hooks run `~/counterparts` master directly. Every merge to master reaches his live
  memory at the next hook event. Core (`src/core/`) changes need an adversarial review AND a
  carry-forward declaration recorded in `docs/PARALLEL-RUN-STATUS.md` BEFORE merge (compute
  `~/.bun/bin/bun -e 'import {surfaceSetHash} from "./tools/parallel/surface.ts"; console.log(surfaceSetHash())'`
  on master and on the branch and compare with the run record's `surfaceSet`, read-only) — and
  tonight they are NOT merged at all: the owner merges core in the morning.
- Two more core fixes may still be in flight when you start: `fix/revision-successor-survives`
  (dedup must not merge a revised belief's successor) and the adapter branch
  `launch/cli-removal-spans`. Check `git branch -r` and the open PRs first; do not duplicate them.
- The marketing site lives in a SEPARATE repo, `~/counterparts-site` (branch `main`, not on GitHub
  yet). Its design-director round may have left a ranked list in `LAUNCH-STATUS`.

# Owner rulings that frame the night (2026-09-04)

- **I7, the clock.** Memories carry the wall-clock date, not the lived day. The owner's words:
  "we do lived days for good reason (if we don't chat for a few weeks we don't want everything to
  fade) but we also need to use actual dates/clock times, so we should have a solution that works
  and understands both." Design the two-clock model properly — physics on lived days, provenance on
  real dates from the session's injected clock, never `Date.now()` in the mint path — and build it.
- **I14, journal in recall.** Keep chapters recallable; label them as journal in every result
  (tool output, footnotes, the wake) so a chapter is never mistaken for a memory.
- **I13, the tiny-store edge.** Rarity is counted over indexed rows, store size over live rows;
  revising the first memory in a fresh store makes it unfindable. Fix after launch — tonight.
- **Option B for removal residue.** The honest `unchased: spans` line lands today (option A);
  tonight, build the real chase: a `remember` door that strikes a span by hash, wired into
  `removal.ts`, so removal reaches the buffer.
- **Bench re-run:** later, only at a finished point if it costs money. Do not run it.

# Workstreams — one owner each, all on branches, none merged to master

1. **The two clocks (I7).** Thread an injected `now` through `Counterpart` → `store.put` /
   `appendEvent` / `mintProposal` so `learnedOn`, `happenedOn` and event `at` come from the
   session's clock while `bornDay` / lived days stay the physics clock. Every existing test that
   asserts a date must still pass or be corrected with the reason. Then: the seeder sets real
   dates (the demo wake stops reading "learned 2026-09-04" on every line); the replay harness
   passes corpus dates; and a `counterparts repair-dates --dry-run` CLI proposes true dates for
   the 12,334 migrated rows from engram-era ids (millisecond timestamps) and session references,
   printing a sample of 20 and counts by confidence — the owner runs `--apply`. Write the design as
   a dated entry in `src/core/store/NOTES.md` (or physics, where it belongs), naming the brain
   analog (episodic memory carries a "when" separate from consolidation age).
2. **Journal in recall (I14).** `recall/` and `mcp/deliberate.ts`: a result row that is an
   `epi_` chapter is labeled `journal` in the tool output and in the footnote tier's rendering;
   the wake never lists a chapter as a memory. Tests at both doors. No change to what is
   recallable.
3. **df vs storeSize (I13).** Count document frequency over live rows only (or deindex on
   archive/supersede — pick with `cache.ts` in hand and say why); test the superseded-head case
   (revise the first memory in a fresh store, then recall it). This moves output on the live
   store: compute and report the surface-set hash and state the G12 class in the PR body; the
   owner records it before merging.
4. **Span chase (option B).** `remember/spans.ts`: a door to strike a span by hash (rewrite the
   jots file without that line, atomically, with a durable record); `removal.ts` calls it and
   the `spans` surface moves from `unchased` to `chased` with a count; backups taken after a
   removal no longer carry the words (test with the residue probe from LAUNCH-STATUS §I2).
5. **Vector cache as float32.** `store/cache.ts` stores embeddings as JSON text (177 MB at 13.9K
   vectors; nearest scan 0.6–1.0 s). Store BLOB float32, read back typed; a cache-format version
   bump with `verify --rebuild` as the migration (vectors are lost on rebuild without an embedder
   — so the migration must CONVERT in place, not drop; write it as a one-shot `counterparts
   migrate-cache` that reads JSON and writes BLOB, dry-run by default). Measure on a synthetic
   store of 14,000 random 1,024-dim vectors: size and nearest-scan time before and after. Core
   store change: NEEDS-OWNER merge.
6. **Replay §2a.** Authored-path gate records made durable (a `gate.deposit` record beside
   `gate.chunk`), and the dashboard's `DURABLE_EVENT_NAMES` registry learns `gate.chunk` and
   `band.transition` so the totality test means what it says. Then `tools/replay` can compute
   refusal mix on the authored path.
7. **Dashboard leftovers.** Whatever the design director's second round left open in
   `LAUNCH-STATUS` (read it), plus: the `serve` command with no `--dir` prints a loud warning
   before opening the default store (or refuses without `--yes`); per-command `--help` for the
   console; `status` on a missing store exits non-zero (decision proposed with the trade-off).
8. **The ecosystem page.** In `~/counterparts-site`: `/ecosystem`, adapted from
   `~/mikelapeter/app/(piece)/lab/memory/` — reuse its COMPONENTS (`LandscapeExplorer`,
   `MechanismDeck`, the data files) read-only, NOT its styling; restyle in the site's own theme;
   every competitor claim sourced from their public page with a date-stamped code comment; the
   Counterparts row says what is verified and nothing more. Screenshots with the site's own shoot
   script; zero console errors.
9. **Day-0 wake.** A fresh store's wake is empty of content until a boundary composes one
   (`install --name` seeds an identity core the lane does not render). Either render the core on
   day 0 or have the wake say, in one line, that nothing has been lived yet and what will fill it.
   `self/` design note first, then the smallest change.
10. **Config resolution, unified.** The hook, the worker and the MCP server read only
    `~/.counterparts/claude-code.json`; the console reads beside-the-store then home. Propose ONE
    rule for all entry points (likely: `--config <path>` accepted everywhere, default unchanged),
    implement it adapter-side with tests, document it once. This lets the install loop drive the
    hook against a scratch config on a machine that already has an install.

# How to work

- Work in worktrees; commit on branches; push branches; open PRs with `--body-file`. Merge
  NOTHING that touches `src/core/`. Adapters, docs, tools and the site may merge only after: an
  adversarial review by a separate agent, AND the full suite + `tsc` run on a preview merge of
  master plus the branch (two green branches made master red once today).
- Every core PR body carries: the failing-test-first evidence, the surface-set hash on master
  and branch, the proposed G12 class with the argument, and the exact `restart.ts` command if the
  class is a restart.
- Gauntlet: one adversarial reviewer per workstream; the claims auditor on any doc that changed;
  the design director on the ecosystem page. Scores and open issues go in a dated
  `docs/LAUNCH-STATUS.md` entry ("overnight, 2026-09-05"), with a NEEDS-OWNER table the owner
  reads over coffee: what to merge, what to record, what to run.
- Agents on Opus by default; Fable only for the claims audit and final review passes.

# Rules (learned today, non-negotiable)

- `~/.counterparts` is the owner's LIVE memory and is NOT on the store's forbidden-roots list;
  the default data dir resolves to `~/.counterparts/store`. Every command that opens a store
  passes `--dir <scratch>` or `COUNTERPARTS_DATA_DIR=<scratch>`. The test preload redirects
  `homedir()`; a script does not — guard it yourself.
- Never run `counterparts-mcp`, `counterparts-hook` or `claude mcp add` from an agent: they read
  `~/.counterparts/claude-code.json` (the owner's key and embedder) regardless of `--dir`. Never
  set `HOME` in a shell (the harness refuses it). Never touch `~/.bansai`, `~/.claude-engram`,
  `~/.memory-ab`, `~/counterparts-parallel-run`, `~/counterparts-backups`, `~/.claude/settings.json`,
  `~/.claude.json`. Never run `tools/parallel/bin/daily.ts` or `restart.ts`.
- API spend: none expected; anything over ~$5 is NEEDS-OWNER first. The bench does not run.
- Owner-only, staged never executed: flipping the repo public, `npm publish`, creating the site's
  GitHub repo, deploying to Vercel, posting anywhere, merging core, running `restart.ts`,
  applying `repair-dates` or `migrate-cache` to the live store.
- No "co-authored by Claude" trailers in commits. Real numbers, failed rounds, what is missing.

Start now.

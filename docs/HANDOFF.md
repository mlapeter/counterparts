# Handoff — resume here

## 2026-09-18, afternoon — read this first: Wave 1 is launched (five builders), nothing merged yet

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
3. `~/counterparts/tools/deploy-checkout.sh`
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
   `env` block `MEMORY_AB_DIR=/Users/mlapeter/random/only-bansai/.memory-ab` and an `assignment.json` in it with
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

# Roadmap history

*Earlier rounds of `docs/ROADMAP.md`, moved here on 2026-09-30 when the roadmap was cut back to
what is still ahead. Kept as the record; not a plan. Newest first. What shipped when is in
`CHANGELOG.md`.*

---

# After 0.3.0 — the plan (2026-09-24)

*Agreed with the owner on 2026-09-24, in conversation. A plan for now, not a rule: change it when
it stops fitting. Release and telling people (publish 0.3.0, the site's new home, the install
block, Reddit) finish on their own track and are out of scope here. The older round below stays as
the record of what 0.3.0 built.*

**The aim.** Get closer to the original goal: memory that follows human memory mechanisms. Build a
dashboard that shows, at a glance, whether each mechanism is working and how well. Use that
dashboard as the reference while the missing mechanisms are built.

**Where it stands (checked against master `8e1a698`, 2026-09-24).** Of the 11 mechanisms the site
names:

| state | mechanisms |
|---|---|
| built | encoding and salience (novelty now keyless), decay and forgetting, retrieval and strengthening, consolidation (narrow) |
| partial, rarely fires | reconsolidation (only on an explicit `updates:`), emotion (a written-down feeling carries no weight; only the numeric score does), association (links boost only what the turn already reached) |
| not built | interference, prospective (no date field), schemas (no live belief writer), episodic → semantic (only a label) |

Some human effects the site doesn't name are built: the testing effect, spacing, source tracking
and a refractory period. Four claims on the site aren't badged but go beyond the code: "similar
ones are merged", "stay strong → core", association's "nudge", emotion's "adds weight". They get
a badge or softer copy when the site is next touched.

## Order

1. **Stop ask (small; conversation, then one builder).** The ask fires too often in short sessions
   (3 times in about 12 turns on 09-24; after the 2nd message in another session). In long sessions
   it runs into the 6-a-day limit (48 refused over 09-22 to 09-24, nothing lost). To decide: what
   counts as a typed turn, the daily limit, and doctor's amber. Starts after the release session's
   `release/0.3.0-quiet-ask` lands.
2. **Store and CLI cleanup (small; mostly builders).** The nine 09-20 working defaults the owner
   never confirmed, shown to him as one list. Then the INTERFACE-GAPS items, **the store reads the
   dashboard needs first**: grouped counts, newest-first events, a read-only store type. Also the
   WAL fold on a clean close (cli §13), and a cleanup commit for the ~40 gap entries the code has
   already closed. Runs in parallel with 1: different files. The store half can start now. Edits
   to `cli/commands.ts`, `doctor.ts` and `config.ts` wait for the quiet-ask merge, because the
   release session touches those files.
3. **Dashboard conversation (while 1 and 2 build).** Page by page, one at a time. Goal: anyone can
   see at a glance whether memory is working and how, with detail one click away. Starting idea: organize by
   mechanism (the site's 11, the same brain), and for each show built or not, whether it's firing, and
   how well. `dashboard/flat` (09-16, before the storage rewrite) is a sketch of what the owner
   liked, not the base.
4. **Dashboard build.** After the conversation and after step 2's store reads.
5. **Mechanisms and recall quality, one at a time.** A fresh session per mechanism, briefed from
   this section. Each ships with its own gauge on the dashboard. The owner reads the gauges on his
   real store; sessions use the demo store. Candidates: the four not built, similarity merge in
   consolidation, the partial three, U7 (yesterday's work missing from the wake), and re-checking
   the static embedder's tuning on real turns. (The bug where schema cards never faded is fixed:
   #215 gave `fadeSweep` a caller, the sleep `fade` phase.) Prospective needs a date field, which
   is a schema change; the Reconnect recipe (E) and the snapshot before migration (#214) are in.
   - Contradictions (raised on Reddit, 09-24; built 2026-09-29 as a mechanism — changed,
     corrected or open, with a record and an undo; schema v10). A disagreement is noticed
     when it is written (a stored memory comes back with its nearest few live memories), or
     when a dream flags a pair; an unsettled pair is raised awake and labelled in recall.
     Still not built: finding two memories that disagree when nobody wrote the second one
     near the first and no dream saw them together — a sleep pass over close neighbours is
     the candidate, if it shows up in real use. Doctor's Contradictions line is the gauge.
   - Later: interactive `counterparts ask` in the terminal (arrow keys, Enter expands; the
     owner's idea, after the ask-readable change lands).

**Status (2026-09-24, afternoon).** Steps 1 and 2 are built and in 0.3.0: #207 (pacing counts
what the person typed; first ask at 6 typed turns or 24 KB of combined text, then 8 more or 24 KB
more; 12 a day; doctor amber only on loss), #204 (store reads, WAL fold), #208 (`note` embeds on
write). The owner confirmed all nine 09-20 defaults. #211 marked 31 closed gap entries.

**2026-09-25, the mechanisms round (with the owner, all held lightly).** 0.3.1 is on npm.
Order agreed: prospective → emotion → consolidation → association → contradictions
(reconsolidation + interference) → schemas → gist, each talked through before it is built.
In flight for 0.3.2: the store v7 change (#231: `core/time.ts` per `docs/time.md`, timestamps,
the model on each memory, a reminder date, a feelings table built on a feelings wheel),
`counterparts mechanisms` (#229, merged), spacing credit plus a "Nearby" lane chosen by context
and habituation (the rich-get-richer loop), then reminders (the date field, ranges, the four
tune questions from v1's rating pass, important dates said plainly).

Tentative ideas, to talk through when their turn comes:
- **Onboarding, "Her"-style.** A first conversation to learn about the person, which seeds
  their first memories and feelings. The person describes the relationship they want, not
  the assistant's personality. The assistant's first self-memories come from its own reactions,
  and maybe from reading a few books or essays it picks, marked *read, not lived*. With this, the
  rich-get-richer effect may be fine as it is, since it would reinforce what the start seeded.
- **A journal entry per new model**, with notes from its system card on what changed, since
  a new model changes the self. Builds on the model now recorded on each memory.
- **A short check-in in the wake** ("how am I feeling, what do I need today"), from a poster
  the owner shared.
- **Emotion's behaviour:** feelings add height and slow the fading, mood-matching recall by
  person, the feeling softens faster than the fact. Each person's feelings shape what the
  assistant knows about them, and its own feelings shape its self. Designed in outline on
  2026-09-25; not built.
- **Balance across projects:** context-weighted recall should never become silos, and the
  core identity and beliefs should come through everywhere.

**Near term, beside the dashboard work:**
- Done 2026-09-24 (merged, not yet on npm):
  - #213: prompts typed mid-turn are captured and paced.
  - #214: a snapshot before any schema migration.
  - #215: entity cards fade gently, and the prune no longer archives them or the identity core.
  - #217: the model version on each chapter.
  - #218: a card named in a saved memory counts as used.
  - #220: a faded card named in a saved memory comes back. A small release of these is on the owner's word.
- Next: **the dashboard conversation (step 3)** in a fresh session. See `docs/HANDOFF.md` top
  and `docs/research/mechanism-audit-2026-09-24.md`.
- Also found: peer hand-backs that arrive mid-turn are missed by capture, like queued prompts
  were. And an `unprune-entities` door or doctor finding for any store the old prune hit.
- **Windows.** Untested, and the code assumes Unix in places: `pgrep`, `0600` permissions,
  POSIX signals, rename semantics, the hook command lines install writes, and nothing checks for
  `win32`. Try WSL first (it is Linux, and Linux is untested too), then native Windows. Until
  then the site says Mac, with Linux untested.

**How it runs.** One coordinator session holds this plan. Builders are Opus agents, each in its
own worktree with file ownership drawn, and adversarial review on anything that touches a store,
a person's config, or the boundary rituals. The owner talks with the coordinator one topic at a
time while builders run. The coordinator merges what it has verified (suite and typecheck on a
clean checkout, a review where one is due); publishes and deploys happen on the owner's word. When the
coordinator's context grows long, it writes a handoff and a fresh session picks up from here.

---

# Roadmap — the round after 0.2.0 (decided 2026-09-23)

*Written once, after a roadmap conversation with the owner on 2026-09-23 (one item at a time,
decisions in the conversation). This page is the brief for the coordinator session and its
builders. Everything here is a working default in the sense of `CONSTITUTION.md`: revisable when it
fights that page, otherwise the plan. Inputs: `docs/HANDOFF.md` §"2026-09-22, close",
`docs/new-user-findings.md` §"For the next round", `docs/launch/go-public-2026-09-22.md`,
`docs/research/local-embeddings-2026-09-22.md`, the thirteen `src/**/INTERFACE-GAPS.md` (digested;
several entries marked open are already closed in code — verify an entry against the source before
building from it), and `docs/IMPROVEMENTS.md` (U1–U12; everything but U5/U7 built on 09-14; the 09-14
plan of record for boundary credit is built — `creditUse` is wired).*

## The decisions, in one table

| item | decision (owner, 2026-09-23) |
|---|---|
| A. Telling people | Go public as planned; **contributions open** (default 5 flipped). Then the site's install block, then his Reddit mention. |
| B. The quiet round | Stop ask: short human line, two-line model ask, JSON emission tested first; pacing counts only what the owner typed; "nothing new" is an answer; thresholds unchanged until lived with. All trial fixes in; `help` Advanced group collapses. AWS-secret redaction fixed; calendar day in local time; hidden SessionStart warning made visible; **raw transcript kept 7 days** after a normal, written-up end. |
| C. Keyless by default | Static embedder (potion-base-8M first) as a **separate unscoped npm package** the main one depends on; vector-cache identity tag first. Crash write-up moves to the **next session in that project**; the Anthropic key becomes an opt-in upgrade. Install asks about neither key. The owner runs the keyless tier (he never added a Voyage key). |
| D. Distribution | **Closed: bun + the npm package.** No compiled binary, no Node work. |
| E. Schema-change safety | Server records its version; the prompt hook shows one line on mismatch (`/mcp` → Reconnect). Server re-checks the store's schema version on **every tool call** and **refuses everything** while the store is ahead of it. |
| F. Parked | Flat dashboard = the owner's own session. Three-way case study and a store outside the home dir stay parked. |

## Status (2026-09-23, close)

**2026-09-24: `counterparts@0.3.0` is on npm** (master `ee9438c`), with the keys removed, the quiet Stop ask, and `ask` by meaning.

Built and merged: A (#185, flip done, Phase C #196), B (#186 #188 #189), C (#190 #193 #192 #195), E (#187); D closed; release commit `b2e0ca1` = 0.3.0 trial tarball, unpublished. **2026-09-24: Voyage and the Anthropic key path were removed** (owner's word; keyless only — no keys, no credentials file, no `credentials` command, and the page writer's command is no longer configurable). Follow-ups: the site's in-development list; snapshot before a schema migration; `owner` write-up close command; `lastCaptureAt`/`lastAnswerAt` on HeldSession (m-E); the per-start plan cost.

## Amendments (2026-09-23, night — owner decisions during wave 1)

- **A:** Phase A merged (#185). **Before the flip, the owner wants a README pass** (simplify; align with the coming-soon positioning on counterparts.ai) — a conversation, one section at a time, then the flip.
- **C — static is primary; Voyage is FROZEN.** The static tier is included and recall is retuned for it per model and per path (`keyless/recall-tune`, a separate PR after #190, measured on both bench paths). Voyage stays only for configs that already name it: code and the paid-rows hold kept, marked deprecated, **no new Voyage code**; install and doctor surfaces (C3) speak of the static tier only. Removal is a later deletion PR on the owner's word.
- **E — release order:** the gate and notice exist only in servers launched from a build that has them. 0.3.0 install instruction: quit every Claude Code session first. E also stamps the installed build into every session record so a pre-E session is told once.
- **Process:** merged branches are deleted at merge time (`--delete-branch`) and their worktrees removed — standing permission from the owner. Detailed session records live in `~/counterparts-notes` (private), not here.
- **B3 readings accepted:** a session owes a write-up only if the pacer asked (or substance reached the first-ask threshold with no ask record); raw text lives ≤7 days in the store and ≤21 counting the 14 daily snapshots.

## How the round is built (the coordinator pattern, as 09-22)

- Opus builders in parallel, each in its own worktree on a branch from master, with **file ownership
  drawn per builder** (below). One PR per builder.
- **Adversarial review** (a second Opus agent, adversarial brief) on anything that touches a store, a
  person's config or settings, the boundary rituals, or the MCP server's every-call path. Marked
  "review" below.
- Gate per PR, on a **clean detached checkout** of the branch head: `bun test`, `tsc`, and
  `tools/install-loop/run.sh` where the install path changed. The coordinator verifies, not the builder.
- The owner merges (the classifier refuses `gh pr merge` from a session; say so and leave the tree
  where it sits). Publishes and deploys are his word only.
- Tests hermetic; **never open `~/.counterparts`** (his live store) from a session, a test or a tool.
  Sessions export `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`.
- Every builder's brief carries: the exact files it owns, the acceptance below, "no
  Co-Authored-By/Claude trailers in commits" (owner's global rule), and "report what you could not do".
- End of round: rebuild a tarball from master for the owner's trial, publish **0.3.0** on his word,
  then the first real `/mcp` Reconnect test (E) on his machine, by his hand, from a recipe.

## Waves and file ownership

**Wave 1 (parallel):**

| builder | owns | lands |
|---|---|---|
| A docs | `docs/**` (scrub + index), `README.md`, `CONTRIBUTING.md`, PR bodies, repo metadata, remote branches; `src/**` comment scrubs only in files no other builder owns | first — docs-only, others rebase over it |
| B1 Stop ask | `src/adapters/claude-code/hooks.ts` **Stop region + `substanceOf` + transcript reader + the SessionStart warning line (I40)**; `src/adapters/mcp/server.ts` session_end empty-batch; the live-session registry if `nothing-new` is recorded there; their tests. **Not** `self/episodes.ts` | before C2 and E touch `hooks.ts` |
| B2 CLI fixes | `src/adapters/cli/**`, `src/adapters/claude-code/doctor.ts`, `wire*.ts`, `uninstall*`; cli CONTRACT/NOTES; QUICKSTART lines that quote the help screen | before C3 |
| B3 hygiene | `src/core/encode/secrets.ts`; the calendar-day seam (`src/core/self/episodes.ts#asksSpentOn`/`asksDay`, `self/index.ts`, the page writer's schedule in `claude-code/`); spans retention (`src/core/remember/**`, `bin/runner.ts` job) | independent |
| C1 embedder | `src/core/store/cache.ts` (identity tag), new `src/core/embed/` (static embedder), `src/adapters/claude-code/vectors.ts`, `embed-client.ts` wiring, `config.ts` `embedder.kind`; the bench under `tools/`; a new sibling repo/dir for the weights package | independent; the config/install surface waits for C3 |
| E server version | `src/adapters/mcp/server.ts` every-call check + version in the session record; `src/core/store` schema-version read; `hooks.ts` **UserPromptSubmit region** (compare + `systemMessage`) | builds `server.ts` first, the `hooks.ts` compare last, rebases after B1 merges |

**Wave 2 (after wave 1 merges):**

| builder | owns |
|---|---|
| C2 write-up | session registry (ended-unwritten detection), `mcp/server.ts` `session_end` write-up door, `hooks.ts` **SessionStart region** (the ask), `bin/runner.ts` (sweep becomes opt-in), doctor line |
| C3 keyless surfaces | `install` (no key questions), `credentials set` offers, `help`/`doctor` text, README/QUICKSTART key sections, the main `package.json` dependency on the weights package |

`hooks.ts` is shared by B1 (Stop), E (UserPromptSubmit) and C2 (SessionStart): different functions,
merged in that order, each rebasing. Two builders never edit the same function.

---

## A. Telling people

**Plan:** `docs/launch/go-public-2026-09-22.md`, Phases A → B → C, unchanged except default 5.

**Changes to the plan:**
- **Default 5 → contributions open.** README §"License and contributing" says contributions are
  welcome. New `CONTRIBUTING.md`, one page, plain: how to run the suite (`bun test`, `tsc`), the two
  safety rules (hermetic tests; never touch a live store), that `CONSTITUTION.md` is the only document
  with standing authority, that each module's `CONTRACT.md` says what it keeps, **open an issue first
  for anything that touches a store or someone's config**, small PRs with tests, MIT.
- Phase A's `src/` comment scrubs: only in files not owned by a wave-1 builder; list the rest for a
  follow-up commit after wave 1.
- Phase C4 (the site's install block) is **not this repo's work**: the coordinator writes a short
  copy-paste message for the owner's site session (two install lines, npm link, repo link) once
  Phase B has run. Push = deploy there, on his word, after he sees it locally.

**Acceptance:** as the plan's A9 and C1–C3, plus `CONTRIBUTING.md` exists and README links it.
**Review:** none (docs). The scrub must not touch test fixtures or the tunables comment's v1 session id.

## B. The quiet round

### B1. The Stop ask — shorter, quieter, rarer (#28 + #13)

**Now:** `stopAsk()` in `src/adapters/claude-code/hooks.ts` is nine lines, sent on stderr with exit 2;
Claude Code prints "Stop hook error:" and the whole text to the person, and hands the same text to
the model. Pacing (`src/core/self/episodes.ts#askDue`): first ask at ≥6 turns AND ≥4,000 bytes (or
≥12,000 bytes alone), re-ask at ≥8 turns AND ≥8,000 bytes, ≤6 per session per calendar day.
Observed 2026-09-23: a subagent's hand-back arrived as a user-role message and paced the ask.

**Decision:**
1. **Split human from model.** The person sees one short line (the owner's rule: "whatever we display
   in terminal should be short and useful to the user since they're the one seeing it"). The model
   gets a two-line ask: memories via `session_end` (session id), chapter N via `chapter` (session id),
   with "set `handoff` on `session_end` only if work here is unfinished" and "nothing worth keeping is
   a real answer" as clauses. Field detail stays in the tool descriptions.
2. **Emission:** what the terminal renders is a TUI question no agent can measure (`claude -p` does
   not render the banner). The builder reads the Claude Code hooks documentation for what a Stop
   hook's JSON `decision: "block"` + `reason` + `systemMessage` do, implements the emission **behind a
   switch that ships both shapes** (JSON and stderr + exit 2, both with the short text), unit-tests
   that both block, and writes a one-turn recipe. **The owner looks at one Stop in his own terminal
   after the round's restart and picks**; the losing shape is removed next round.
3. **Pacing counts only what the owner typed.** Agent hand-backs, task notifications, hook feedback
   ("Stop hook feedback", "UserPromptSubmit hook success") and other host-injected material are not
   `source: "conversation"`. Classify from the transcript JSONL's own metadata where it exists, not by
   text pattern alone; document the shapes found.
4. **"Nothing new" is an answer:** `session_end` with an empty `memories` array is accepted, recorded
   (`nothing-new`), mints nothing, and counts as answered.
5. **Thresholds unchanged.** Revisit after living with it.

**Acceptance:** a fixture transcript with 1 typed turn + 1 agent hand-back + 1 task notification
paces as 1 turn; the emitted human line ≤ 1 line; the model ask ≤ 2 lines + clauses; an empty
`session_end` is accepted and recorded; both emission shapes tested for blocking; the recipe for the
owner's one-look test is in `src/adapters/claude-code/NOTES.md`. **B1 does not touch
`src/core/self/episodes.ts`** (B3 owns it): record `nothing-new` in the registry or `server.ts`.
**Review:** yes (the boundary ritual; the "one ask, one pacer" scar in `self/CONTRACT.md` §3).

### B2. Small fixes from the 0.2.0 trial (defaults, all agreed)

- **Uninstall wait:** print `Checking Claude Code…` before `mcpPreflight` runs `claude mcp list`. No
  spinner (ruled out 09-22). Never measure `claude mcp list` from a session.
- **Doctor's `no-credential` fix line names the exact command** (`counterparts credentials set …`).
- **#26 the two store sizes** (6.7 MB in the delete plan, 1.4 MB in the park plan a minute later):
  chase it (WAL checkpoint or the worker finishing is the likely cause) and show one consistent
  number — the same measurement in both plans, WAL included or checkpointed first.
- **#8 for stores 0.1.0 made:** doctor's window falls back to the oldest event row's timestamp (or the
  database file's birth time) when `store.created` is absent.
- **`help` Advanced group collapses** to a comma list (39 → ~31 lines). The cli CONTRACT's verbatim
  screen and any QUICKSTART quote follow.
- **NITs n1–n5** (`docs/adversarial-review-onboarding-ab-2026-09-21.md`): settings-file
  re-serialisation, JSONC/BOM refusal text, the re-read/re-merge race, the fixed `.tmp` sibling, the
  park heading.

**Acceptance:** each has a test or a pty-driven check; the help screen's line count is asserted.
**Review:** the settings-file changes (n1, n3, n4) touch a person's config — yes, light.

### B3. Three things the gap digest surfaced, plus retention

- **AWS secret access key stored verbatim** (handoff §6; owner `src/core/encode/secrets.ts`): the shared
  filter redacts the key id and misses the 40-character secret. Fix the pattern; fixture = the 09-20
  review's fake pair; assert both halves redacted on every entrance (memory, journal, self page,
  handoff, note).
- **The calendar day is UTC midnight** (self ask cap; the "nightly" page writer fires ~17:00 Pacific;
  claude-code §13): use the machine's **local time zone** for the calendar day everywhere one is
  taken. Lived-day counters are untouched. One-time effect on the day of change (an allowance may
  refill once early or late) is accepted; say so in NOTES.
- **Hidden SessionStart warning (I40):** the scope-registry warning goes to stderr at SessionStart,
  which the terminal does not show; emit it as the hook JSON `systemMessage` (the channel E also uses).
- **Raw transcript retention — 7 days.** Nothing prunes `buffer.jsonl`/spans (remember §9); backups
  carry raw text forever, and a removed memory's source text survives. **One predicate, defined once
  here and reused by C2:** a session *owes a write-up* only when (a) the pacer found substance and no
  answer (`session_end`/`chapter`) was recorded, or (b) it ended abnormally (no normal end in the
  registry) with captured text. A short session that never reached the pacer's threshold owes nothing.
  Rule: a session's captured text is deleted **7 days after it ended, when nothing is owed**; a session
  that owes waits until written up (by its own boundary or C2), and doctor counts those. A worker job;
  one `remember.prune` event row per run with counts. Before deleting, the builder inventories every
  reader of spans (the sweep, C2's write-up, dashboard flow page, replay tooling) and says so in NOTES.
  `export` still omits spans (I3) — say so in export's output while here.

**Acceptance:** tests for each; the retention job on a seeded store with three sessions (written-up
old, written-up recent, unwritten old) deletes exactly one.
**Review:** yes — retention deletes a person's data; secrets touches every entrance.

## C. Keyless by default

### C1. The static embedder (potion-base-8M first)

**Facts (verified 2026-09-23):** `embeddings(memory_id, dim, vec)`; `cache_meta` holds only
`schemaVersion`. **Vectors are not tagged with their model.** The owner's live store has **no vectors**
(no Voyage key was ever set) — he is the first user of the static tier.

**Steps, in order:**
1. **Identity tag:** `cache_meta.embedder = "<model>@<dim>"` written when vectors are; **at open only**
   (E's every-call check is E's alone), if the configured embedder's identity differs from the recorded one,
   drop `embeddings` and rebuild — inline for static (milliseconds), through the existing
   `migrate-cache` typed confirm for Voyage (paid). Cache schema bump (v5). **E's rule protects only the upgrade AFTER the one that installs it**: a 0.2.0 server has neither the gate nor the notice, so the 0.3.0 install instruction is *quit every Claude Code session before installing*.
2. **Embedder:** the 54-line zero-dependency proof (`docs/research/local-embeddings-2026-09-22.md`
   appendix 2) becomes `src/core/embed/static.ts` (host-agnostic core, its own CONTRACT stub): BERT
   basic tokenizer + WordPiece + row mean + L2; reads `model.safetensors` + `vocab.txt`. Load time on a
   hook-sized process measured; F32 unless f16 + decode is clearly better.
3. **Weights package:** new unscoped npm package **`counterparts-model-potion`** — `model.safetensors`
   (F32, 30.2 MB, or f16 if chosen), `vocab.txt`, LICENSE (MIT, MinishLab attribution, HF source and
   revision), README. The main package adds it under `dependencies` (our own package; Amendment 15
   spirit — judgment, not a vow). **The owner publishes it**, as he does the main package. During the
   trial, a local path via env var.
4. **In-process embedding:** the static tier embeds at write time in whatever process writes (hook,
   MCP server) so the semantic channel is never dark without the worker (closes recall §6 / mcp §7 for
   this tier); the worker backfills anything missing.
5. **Measure:** on a seeded store (`tools/demo/seed.ts`, never live): lexical-only vs potion vs
   `static-retrieval-mrl-en-v1` sliced to 256d (same code path) vs Voyage if a key is available to the
   coordinator (otherwise report without it). The project's recall tests + the bench. **Include only on
   results:** the static tier must improve the bench over lexical-only with no recall-test regressions;
   pick the better static model; write numbers into `docs/research/`.
6. **Config:** `embedder: { enabled, kind: "static" | "voyage" }`; new installs → static; existing
   configs with a Voyage key keep voyage; `credentials set VOYAGE_API_KEY` offers the switch (identity
   tag triggers the rebuild). Surfaces land in C3.

**Acceptance:** identity-tag tests (mismatch → rebuild, match → untouched); embedder unit tests
(tokenizer parity on the proof's pairs; 0.58/0.42 vs 0.06/0.09 reproduced); bench report; the seeded
store never his.
**Review:** yes (store cache schema; every vector in a person's store).

### C2. The keyless write-up of a session that ended before it was written up (#16)

**Now:** the Anthropic key's one job is the crash-fallback sweep in `bin/runner.ts`, which sends
captured text to Anthropic when a session ended before the assistant wrote it up.

**Decision:** at the **next session start in that project**, the hook notices captured text never
written up and asks the live assistant to write it — the nightly page writer's pattern ("the first
session after a day is owed is asked"; proven live 2026-09-23). Nothing leaves the machine beyond
what Claude Code already sees; the write-up is in the model's voice. The key-based sweep becomes an
**opt-in upgrade** (a config flag offered by `credentials set ANTHROPIC_API_KEY`). Per-project waiting
is accepted: a project never reopened is never written up; doctor counts them.

**Design points the builder settles (CONTRACT amendment, reviewed):**
- **"Ended without a write-up" is B3's predicate** (owes a write-up), not "no `session_end` recorded":
  a short session that never reached the pacer's threshold is never asked about.
- `session_end` is bound to ONE live session and refuses other ids by design. The write-up needs its
  own door: a `writeUp: <ended session id>` field (or a sibling tool) accepted **only** when the hooks'
  registry says that id ended in this project without a write-up. Memories are recorded as authored,
  with the writing session named; the old session is then marked written up (so B3's retention clock
  starts).
- Cap and chunk: ≤ ~24 KB of captured text per session start, oldest session first, the rest at later
  starts. One session-start ask type; it shares the day's allowance and may coincide with the page
  writer's ask (§13 G3 is about the blocked Stop, not SessionStart).
- Doctor: `Crash write-up  next session` green with no key; `on (API)` when opted in; N awaiting.

**Acceptance:** a fixture project with one ended-unwritten session produces exactly one ask with the
capped text; the write-up door refuses a live id, an unknown id, and an already-written-up id, each
by name; the sweep does not run without the opt-in flag.
**Review:** yes (core boundary; a new write door).

### C3. Keyless surfaces (after B2, C1, C2)

`install` asks about **neither key**; `credentials set` remains the door and offers the upgrade
(embedder switch / API sweep); `help`, `doctor`, README and QUICKSTART describe both keys as upgrades;
`package.json` gains the weights dependency. The owner's own install: the keyless path (he restarts
and runs `doctor`).
**Acceptance:** install loop 58/58 (updated for the removed questions); README/QUICKSTART key sections
read as upgrades. **Review:** light (install edits a person's config; the 09-22 reviews' BLOCKERs are
the checklist).

## D. Distribution — closed

bun + the npm package, as today. No compiled binary, no Node support work this round. README already
says bun is required and Node is untested; leave it. The `runtime-and-distribution` question is
closed for now; reopen only if strangers' installs say otherwise.

## E. Schema-change safety + the upgrade notice

**Now:** Claude Code starts the MCP server once per session; hooks start fresh every turn. After an
upgrade the hooks run new code, the server old code (I36). `SCHEMA_AHEAD` runs only at open, so an
old server holding a handle never sees a migration a hook performed.

**Decision:**
1. **Notice:** the server writes its version (package version + store and cache schema versions) into
   the live-session record at launch. The UserPromptSubmit hook compares with the installed code
   every turn; on mismatch, **one** `systemMessage`: `Counterparts was updated. Run /mcp and Reconnect
   to load it.` Shown once per session (recorded in the session record), not every turn.
2. **Rule:** the server re-reads the store's schema version (and the cache's) **on every tool call**.
   If either is ahead of the code it runs, **every tool refuses** with the same one-line message and
   touches nothing. Recall through the hooks keeps working (new code). `SCHEMA_AHEAD` stays one-way;
   rollback is the pre-migration snapshot (check the automatic snapshot fires before a migration; if
   not, take one).
3. **Reconnect is untested:** the builder writes a recipe (throwaway project + throwaway store with
   `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`, never the owner's config) and, at the end of the round, the
   owner runs it once on his machine.

**Acceptance:** integration test — open a store, bump its schema meta from outside, assert every MCP
tool refuses by name and nothing is written; the hook emits the notice exactly once on a fixture
session record with a stale version.
**Review:** yes (the server's every-call path; the session record).

## F. Parked (not this round)

- **Flat dashboard:** the owner's own session — branch `dashboard/flat`, handoff in
  `src/adapters/dashboard/web/FLAT-CHANGES.md`; exploratory by ruling.
- **Three-way identity case study:** `~/random/three-way/README.md`; after a second run.
- **A store outside the home directory:** `uninstall` refuses `--dir`; the builder's proposal (accept
  `--dir` only when it equals the configured `dataDir`) is not built.
- From the digest, still open and not scheduled: sleep §9 (symmetry verdict has no face), handoff §4
  (no `counterparts handoff` command), mcp §2 (nothing sets confidentiality — so it is not advertised),
  mcp §9 (the recall tool's description overstates — owner's ruling needed), cli §10–11 (doctor scans
  everything), I11/I12 (identity-core promotion by kind).

## Housekeeping owed (any session, by hand)

~50 stale worktrees under `.claude/worktrees/` (`git worktree remove --force <path>`; bulk removal
was refused by the classifier); `review/` untracked in the repo root; unmerged remote branches
`dashboard/flat`, `design/parallel-run-contract`, `docs/2026-09-18-morning` (Phase A lists them).

---

## Recently done, before 10-16 (moved from the roadmap 2026-10-20)

- **10-14**: 0.3.24 on npm: a memory leaves only after 14 lived days under the floor, and a curve change starts that wait fresh, so nothing is archived for 14 lived days after upgrading; old claims the era lowers read at today's default all the way down (#494); Claude rates the memories it was shown 0–3 at the session_end ask, tracking only (#492); routine work left at the default salience by the tool text, "faded: weak, below reach", a reminder's whole moved chain closes together, an untitled revision keeps its title, `recall` takes `query` (#493); the plugin's uninstall leaves a working npm install's memory server and hooks alone (#487, #491); the sidebar counts feelings under Emotion (#488) and its footer fits the docked pane (#486); no store-format change, nothing to run after upgrading from 0.3.23
- **10-14**: 0.3.23 on npm, the build for Anthropic's plugin directory: the sidebar shows memory and acts on nothing (no buttons, no links, no network: it reads `~/.counterparts/sidebar.json`, written only while the plugin is installed), the brain gone and the fox kept (#480, #483); the directory build never reads `~/.claude.json` (no stand-down beside an npm install there, a known limit) and drops the dashboard's 3D brain (#481, #482); no store-format change, nothing to run after upgrading from 0.3.22
- **10-14**: 0.3.22 on npm: the plugin installs from its own generated repository, counterparts-ai/counterparts-plugin, which also carries the directory flavor (#475); the sidebar ready for Anthropic's directory: links in a terminal, buttons on the desktop, no search, the fox from image files, `counterparts dashboard` opens the one already running (#477, #478); MCP tool annotations (#474); session context offers rather than orders (#476); no store-format change, nothing to run after upgrading from 0.3.21
- **10-13**: 0.3.21 on npm: conversation text kept 3 days after write-up and never more than 14 days, never in a backup, `counterparts delete conversation-text|backups|activity-log` and "Delete data…" on the dashboard (#468); recall's carried words cleared past the same ceiling (#471); the plugin installs over HTTPS (#467); "installed twice" said once (#469); the fox polished and the sidebar's Desktop layout (#470, #472); no store-format change, nothing to run after upgrading from 0.3.20
- **10-12**: 0.3.20 on npm: plugin installs now remember from the second day, the wake gets a default 9,000-byte ceiling (#466); the first meeting is a short conversation that is never interrupted (no dream, write-up in the session, one question at a time, ends with what to do next), plain words in the wake and dashboard, a fresh install's doctor with no ambers, a one-line first-run notice and a store id for the sidebar, honest wording about recall by meaning (#450, #451, #452, #456, #458, #459); compaction starts unwatched, the wake never drops a section silently (#453, #454); the sidebar: onboarding, the split, the fox, no Claude Code memory switch (#447, #455, #460, #462); bundle README disclosures (#457, #461); the dead A/B file read removed (#463); no store-format change, nothing to run after upgrading from 0.3.19
- **10-12**: 0.3.19 on npm: reminders arrive: one due today stays under "Arriving:" all day, near ones first, never "told" to a turn nobody typed, a warning for a reminder-like memory with no date (#442, #445, #443); far fewer reads of Claude Code's own files (#444); the core can change, the night folds what belongs together, catch-up over written parts, cards born, one door for writes (#430, #432, #436, #429, #435, #427); the big-file split that fits the directory's 256 KiB limit (#439); no store-format change, nothing to run after upgrading from 0.3.18
- **10-11**: 0.3.18 on npm: the first meeting on every new install, started by the sidebar or `/counterparts:meet`, and dreaming on for new installs (#419, #416, #424); the plugin ready for Anthropic's directory: the bundle, no Bun auto-install, `/counterparts:dashboard`, install-aware doctor (#396, #394, #399); `uninstall` offers to delete, at a terminal, with a typed phrase, and `/counterparts:uninstall` (#414, #421, #425); older memories read at today's defaults (#395), merges and revisions keep what they were about (#398, #400, #403); the night writes up everything owed, `counterparts catch-up`, the reflection in its own session (#401, #407, #413, #426); what replaces what (#420, #408, #422); reminders (#393, #411); association (#423); last exchange, day order, chapter wording, the verbatim trial, context trims (#392, #405, #404, #409, #415); decisions fragments (#418); no store-format change
- **10-11**: 0.3.17 on npm: the sidebar mod v0.2, what memory is doing in 35 columns (#375); forgetting changes what comes to mind: each memory on its own curve, below reach, archived (never deleted) after 14 lived days under the floor, the dated hold, feeling counted once, old claims read at their defaults (#372, #377, #386); faded matches inline in facts recall (#379); `note` is `remember`, salience by attention, mood off (#369); `drewOn` (#385); about-marks (#383); the wake put together at session start, "Today, elsewhere" and "Since you started" (#376, #380, #387); a `remember` reaches the next wake the same day (#374); `counterparts rollback` (#384); scale fixes (#368, #373); follow-ups (#378, #382); changelog fragments (#381); store v12 to v13 and cache v5 to v6, nothing to run after upgrading from 0.3.16
- **10-10**: 0.3.16 on npm: the self page is kept up to 16 KB and the wake steps down a ladder of whole texts (page, short version, outline, headings, one line), its room 5,681 bytes (#363); dated items before the wake's furniture, and doctor's Wake line amber when one goes unlisted (#367); a paused folder says so at session start (#362); each hook output field bounded on its own, the claims file mends itself, late twins stand down, scope commands name the folder (#366); the plugin's first-run line again (#365); the sidebar lights every mechanism an event proves (#360); tools/term-loop (#364); no store-format change, nothing to run after upgrading from 0.3.15
- **10-10**: 0.3.15 on npm: the self page is never cut in the wake (#358); one delivery per event when the plugin and the npm install are both wired, the claims in a file of their own (#355, #359); `connect` and `install` rewrite Claude Desktop's entry and doctor reads it, so Desktop users run `counterparts connect` once (#354, #356); a yearless "by 1/5" in late December is the coming January (#356); the sidebar mod in the plugin (#342); CI runs the whole suite (#357); RELEASING.md (#356); no store-format change
- **10-09**: 0.3.14 on npm: the plugin runs with no Bun or Node, as one prebuilt program per platform (#351); a project's `.env` and `bunfig.toml` stay out of the hooks and the server, so npm users run `counterparts connect` once (#349); the wake keeps "Still open" beside a long page and says when a reminder was due (#350); facts names corrected versions, reads amounts and "by 12/20" right, meaning says when a name has no card (#345, #347, #348, #352); dashboard and doctor follow-ups (#343, #346, #347); no store-format change
- **10-09**: 0.3.13 on npm: dates that repeat, and corrections held when they look unrelated (#339–#341); facts reads "last Saturday" and "before 7/22", meaning answers about the person asked about, the dashboard's Ask in both modes (#333, #334, #338); doctor without false alarms on Fired and Wake, and the night checks its own transcript (#325, #330, #337); the Claude Code plugin (#328); no store-format change
- **10-08**: 0.3.12 on npm: recall's two modes, facts and meaning, and what a memory records (#321–#323, store v12); with 10-02's work below
- **10-02**: on master: one measured ceiling for tool results (#315); feelings round 3 (#317); follow-ups after 0.3.11 (#318); the Desktop app's Code tab verified live
- **10-01**: 0.3.11 on npm: the morning catch-up and "Yesterday" line; "Work here" vs Nearby; Node 22.15+ and Linux; the Code tab files under its own session; recall by feeling, round 2; dashboard Health fixes (#306)
- **10-01**: 0.3.10 on npm: the feelings wheel v2 (seven cores, store v11); handoffs per session; the "Last here" line; recall by time (a question about time leads with this directory's last session)
- **09-30**: Claude Desktop chat; recall by feeling (0.3.9); handoffs per session; the feelings wheel redesigned with the owner; event log; coverage ("answered" isn't "written up"); the wake keeps up; dashboard feedback; Desktop's Code tab verified
- **09-29**: contradictions (changed / corrected / open, with undo); headless nightly run (0.3.7)
- **09-28**: nightly run (0.3.6); association links; fitting more into a night; looser guards
- **09-27**: reflection and the self page; traits (0.3.5)
- **09-26**: dreaming; reminders; feelings recorded (0.3.3, 0.3.4)
- **09-25**: dashboard, first version; time handling and store v7 (0.3.1, 0.3.2)
- **09-24**: keyless by default; quieter Stop ask (0.3.0)

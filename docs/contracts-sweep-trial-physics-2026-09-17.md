# Contracts sweep — TRIAL on `physics/` (2026-09-17)

Read-only. Nothing edited. Paths are in the `storage-spec` worktree.
Sweep rule used throughout: **shorten prose, never renumber.** `test/physics.test.ts`
cites sections by number (`:2`, `:99`, `:177`, `:344`, `:505`) and `CONTRACT.md:101`
cites "NOTES.md item 16"; renumbering silently breaks those pointers.

## 1. Verdict in plain language

This contract is in good shape and should mostly survive. About two thirds of it is the
actual arithmetic of memory — the formulas, the per-kind table, the thresholds — and that
is the module's whole reason to exist. What has drifted is not *length* but *genre*: the
guarantees section and two rewrite notices have turned into short incident reports, and
the opening "what we keep / what we dropped" lists restate formulas that appear again,
in full, forty lines later. After the sweep it would read as: purpose, brain analog with
its three named deviations, a one-line-per-item lineage list, the equations untouched,
one checkable sentence per guarantee, the scars, the five open questions. Roughly a third
shorter, with nothing removed that a test or a reader depends on. One passage in `NOTES.md`
is flatly out of date and contradicts both the contract and the code — that is the only
clean deletion. The rest is judgement, and I have turned it into seven yes/no questions.

## 2. Section-by-section

### `CONTRACT.md` (342 lines)

| What it is about | Lines | Proposal | Reason |
|---|---|---|---|
| Title + purpose ("all the arithmetic on one page") | 1–6 | KEEP | Line 10 — this is the one-sitting opening |
| Brain analog + the three named deviations from biology | 8–16 | KEEP | Line 12 requires deviations be named and defended; these are |
| "Keeps" — what was inherited from v0/v1/engram, with citations | 18–45 | SHORTEN → ~10 | Line 10: restates §5's formulas verbatim before §5 states them. Keep one line + lineage tag each (CLAUDE.md asks a contract to say what it keeps) |
| "Drops" — the v1 machinery deliberately not rebuilt | 47–67 | SHORTEN → ~8 | Line 13: the two "SETTLED, owner ruling" items are archaeology about a system that no longer exists; one line each keeps the ruling, drops the retelling |
| Contract header — inputs, outputs, notation | 69–78 | KEEP | The module's actual interface |
| §5.1 how "how much did this matter" is scored at encoding | 79–101 | SHORTEN → ~16, +1 sentence | Line 12: add one sentence naming that `emotional` has no live producer (ruling C1). Lines 95–101 duplicate NOTES item 16 |
| §5.2 the single strength number + the per-kind table | 103–129 | KEEP | The most reusable calibration in the repo; every constant marked TUNABLE |
| §5.3 the three bands and how a memory is promoted | 131–161 | SHORTEN → ~20 | Lines 133–137 are a 5-line rewrite notice; line 16 wants a glance-readable law, the story belongs beside it in NOTES |
| §5.4 forgetting curve over lived days | 163–186 | KEEP (trim ~2) | Line 12: Ebbinghaus named, deviation named |
| §5.5 what counts as "this memory was used" | 187–197 | KEEP + 1 line | Line 11 as amended: mark the 0.25 tier as specified-but-never-fired rather than deleting it (ruling A1) |
| §5.6 how a memory gets overturned by a later one | 198–242 | SHORTEN → ~22 | Lines 200–204 rewrite notice, 217–225 the day-cap story, 235–240 a design essay. Line 10 |
| §5.7 duplicate detection and the two refusals | 244–263 | SHORTEN → ~14 | Keep both refusals (load-bearing); the "first store that ever crossed the bar" anecdote is NOTES material (line 16) |
| §5.8 pruning — the only thing that deletes | 265–278 | KEEP | Short, checkable, owner-facing |
| §5.9 the twelve guarantees | 280–309 | SHORTEN → ~16, numbers kept | Audit Top 4 (rules 10 + 16): guarantees 2 and 8b have absorbed narrative. One checkable sentence each |
| §6 scars honored | 311–319 | KEEP | Line 14 — scars travel as criteria; this is the list |
| §7 five open questions | 321–342 | SHORTEN → ~12 | All five are genuinely still open (audit Part 3 agrees); only the ancestry paragraphs compress |

### `NOTES.md` (155 lines)

| What it is about | Lines | Proposal | Reason |
|---|---|---|---|
| Framing — "the contract is the spec, this file never edits it" | 1–12 | KEEP | Line 13 stated in place |
| Items 1–15: choices the contract left open, recorded | 14–99 | KEEP (trim ~8) | Exactly what NOTES is for; each is a decision the owner can overrule cheaply |
| Item 16: the measured default-claim finding, 35 lines | 101–135 | SHORTEN → ~15 | Line 11 — the measurement earns its place, the triple sub-essay does not (ruling C2) |
| Observation: "the ~3-day revision bound is an approximation; nothing was fixed in code" | 139–149 | **DELETE** | **Stale and contradicted three ways** (below) |
| Observation: which constants are calibration-required | 151–155 | SHORTEN → ~4 | Duplicates the TUNABLES table it points at |

**The one clean deletion.** `NOTES.md:146–147` says *"nothing was 'fixed' in code — but if
the owner meant the prose as the guarantee, the cheapest fix is a per-day force cap
(`min(F, F_day_max)`)"*. That cap exists: `CONTRACT.md:219–225` records it added
2026-08-25, `src/core/physics/index.ts:125` defines `F_DAY_CAP_SLOW: 0.35`, `:830` applies
it, and `test/physics.test.ts:788–789` asserts it. The note also claims the test uses
salience 0.9 "below the 0.855 bar" — the test now expects the capped value. No ruling
needed; it describes a world that ended the day it was written.

## 3. Rulings for the owner

### Group A — two mechanisms that have never been seen to work

**A1. The quarter-credit for "we showed it to you and you ignored it."**
*What it is:* when the system puts a memory in front of the assistant and the assistant
doesn't use it, the rules say that still counts as a quarter of a use — enough to slow its
fading a little. *Is it firing?* No. The one place credit is booked hard-codes the full
"referenced" weight and throws the tier away (`src/core/counterpart.ts:1410`), and the only
other caller passes "referenced" too (`tools/demo/seed.ts:540`). *Diagnosis (amended line
11, started here):* `src/core/associate/tunables.ts:28–35` says *that* module's weak tier
"ships DISABLED (0) on purpose… deliberately NOT wired in" until a calibration fixture
exists, and names `physics.TUNABLES.W_SURFACED` as the number to re-earn. **INFERENCE:** I
read that as the physics tier being parked for the same reason — nothing at the credit site
(`counterpart.ts:1398–1404`, a long comment about something else) says why the tier is
discarded. That is exactly the discriminator a half-hour diagnosis should settle: parked
deliberately (line 11 says name it, don't remove it) versus a plain wiring fault (fix it).
*Recommendation:* keep the prose, add one line saying it has never fired
and why. Separately — and this is a design question, not a sweep question — audit item 1
argues the brain does the opposite (being shown something shouldn't strengthen it) and that
deleting the tier changes a deviation named in two other modules' contracts. Do not settle
that inside a prose sweep.

**A2. The daily brake on overturning a belief about yourself or a person.**
*What it is:* a cap so that no single day's challenge, however confident, can flip a
long-held belief — it takes three days. *Is it firing?* The whole overturning path is
essentially silent (audit item 7 cites `schemas/CONTRACT.md:110–112`: zero pressure rows
as of 2026-09-04 — **per the audit, not verified here; I was scoped to `physics/`**). So
line 11 gives the cap no special cover; the silence is the feature above it. *The real
question is line 15:* the cap was added from arithmetic on a whiteboard, before any real
failure — the contract says so itself at `:219–225`. *Recommendation:* keep the cap, cut
its nine-line justification to two, and label it a provisional guard awaiting its first
real challenge. *The honest case for removing it:* line 15 says machinery is earned by a
named real failure, and this one wasn't; without it the "~3 lived days" promise is an
approximation rather than a bound, which the owner may simply accept.

### Group B — guarantees and rewrite notices have become stories

**B1. The two "rewritten after review finding N" notices** (§5.3 at `:133–137`, §5.6 at
`:200–204`). *What they are:* five-line boxes explaining what an earlier draft of the rule
got wrong. *Either way:* keeping them preserves a scar; cutting them to one line each keeps
the scar and loses the retelling — the file's git history is the amendment log. *Recommend:*
one line each.

**B2. The guarantees list** (`:280–309`). *What it is:* the promises a test can check.
Two of them (2 and 8b) now carry the incident that produced them. *Recommend:* one
checkable sentence per guarantee, numbers unchanged, stories moved to `NOTES.md`. This is
audit item 4 (rules 10 and 16) applied to the strongest contract in the repo.

### Group C — one idea told twice, and one gap named everywhere but here

**C1. The fourth ingredient of "how much did this matter" has no supplier.**
Salience averages four things; one of them is emotional weight. Nothing produces it:
`src/core/mint.ts:143` defaults it to `0`, `src/core/schemas/index.ts:156` hard-codes zeros,
and `src/core/bridge.ts:191` carries a comment literally headed "NAMED GAP (2026-09-04)".
Something *consumes* it (`src/core/recall/gate.ts:335`). So the producer is dark and the
consumer is live — a genuine wiring gap, named in code and (per the audit) in two other
contracts, but not in `physics/` §5.1. *Recommend:* one sentence in §5.1 saying so. This
also explains why the store's strengths sit low, and why the default-claim constant exists.

**C2. Which file owns the default-claim story?** The same finding is told at
`CONTRACT.md:95–101` and again, at length, at `NOTES.md:101–135`. *Recommend:* contract
keeps the rule and the arithmetic bound; NOTES keeps the measurement. Roughly 20 lines go.

**C3. "Keeps" and "Drops" (`:18–45`, `:47–67`).** These restate the equations. CLAUDE.md
asks each contract to state what it keeps and drops, so this is SHORTEN, not DELETE — but
one line plus a lineage tag per item is enough to satisfy it.

## 4. Numbers

| File | Prose lines now | After proposal | Change |
|---|---|---|---|
| `src/core/physics/CONTRACT.md` | 342 | ~230 | −112 (−33%) |
| `src/core/physics/NOTES.md` | 155 | ~110 | −45 (−29%) |
| Both | 497 | ~340 | −157 (−32%) |

Deleted outright: 11 lines (the stale NOTES observation). Everything else is compression.

## 5. Tests at risk

**None under this proposal as written.** I grepped for tests citing physics contract
sections and found exactly one file, `test/physics.test.ts` (1122 lines), which cites §2
(`:579`) and §5.1–§5.9 by number; no test cites §3, §4, §6 or §7 — the four sections I
propose cutting hardest. Conditional on rulings:

- If ruling **A1** goes the other way (delete the quarter-credit tier):
  `test/physics.test.ts:626–664` (the "§5.5 reinforcement" block, asserting
  `creditUse(m, 5, "surfaced")` → `w: 0.25`) and `:1089` (`expect(TUNABLES.W_SURFACED)
  .toBe(0.25)`) lose their only justification — `CONTRACT.md:190`.
- If ruling **A2** goes the other way (delete the daily brake):
  `test/physics.test.ts:788–789` and `:819` lose theirs — `CONTRACT.md:217–225`.

Listed only. I touched no test.

## 6. Method notes for scaling up

- Cheap: the section table, one pass. Expensive: "is this mechanism alive?" — three greps
  and two narrow reads each, and the first grep lied (the tier string is everywhere; the
  credit site hard-codes past it).
- Do the aliveness check **once, centrally**: one pass listing every TUNABLE and its live
  call sites, shared by all module sweeps, instead of re-deriving it per module.
- Cite the 2026-09-16 audit for cross-module facts as unverified rather than re-reading
  other modules; that alone halved the reading here.
- Expect most modules to cut harder than 32% — physics was the audit's own control case.
- Keep the shorten-never-renumber rule global; it is what makes the cuts test-safe.

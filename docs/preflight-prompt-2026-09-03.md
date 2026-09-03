# Goal

Close everything that stands between Counterparts and the **start of its parallel run**
— the launch's critical path. Four outcomes, in order: (1) the parallel-run contract
landed (branch `design/parallel-run-contract` reviewed and merged); (2) the seven §9
owner questions resolved in conversation and recorded; (3) the sample replay executed on
owner approval and its trends read honestly; (4) the §5 preconditions closed and the
parallel run **started** — v2 shadowing live v1, encode-only, observer-honest. The owner
is present in this session: this is a working session *with* him, not an autonomous run.

# Read first

`CLAUDE.md`, then `CONSTITUTION.md` (the only document with standing authority). Then the
contract itself: `git show design/parallel-run-contract:tools/parallel/CONTRACT.md` (or
check the branch out). `docs/BUILD-STATUS.md` for carried gaps — it is 08-25 vintage; the
night-shift section closed gaps 1–4 and PR #6 closed replay §1a. The decision journal for
this arc is `~/bansai/docs/DECISIONS.md` (append entries there when the owner rules; the
2026-08-29 entries cover the slices wiring and the sample-run framing).

# How to work

1. **Land the contract.** Review the branch adversarially first (the house process — it
   caught four real issues in the last arc, including a prompt-injection blocker), then
   PR and merge. Its §5 preconditions and §9 questions are this session's worklist.

2. **Resolve the seven §9 questions with the owner, in conversation, 1–2 at a time, in
   ranked order.** Each has a PROPOSED default. For each: present the default, the cost
   of the alternative, and your recommendation in a few sentences — then record the
   ruling in the contract and append the batch to the DECISIONS journal. OQ2 (migrated
   vs. empty starting store) gates real work: if migrated, the confidentiality mapping
   (BUILD-STATUS gap 5: v1 `confidentiality: sensitive` → v2 `isConfidential`, ~16
   traces) and the import-path secrets gate graduate to hard preconditions — build them,
   with tests, before the run.

3. **Sample replay.** Price it, get the owner's explicit go (~$20–35, the Opus seat —
   already decided, not a knob — `--days 5..7 --embed`), run it, and report the per-day
   TREND (early days are blind by construction): blind rate, schemas shown, refusal mix,
   novelty non-null, birth grounding. The sample's pass record is marked `sample` and can
   never open the runtime gate — do not let it. If a channel looks broken, fix and re-run
   beats rationalizing a bad trend.

4. **Close the §5 preconditions one by one** — each verified by the preflight, none
   waived by prose: replay gate green (machine-readable record); the G12 symmetry
   consumer live (the ratchet tripwire must be armed DURING the run — that is when it
   earns its keep); `scanSecrets` bounded; poison-pill retry bounded; the self-store
   pressure valve's relief wired; the OQ2-dependent migration items; and the run priced
   and approved — including the authored dump's session-context cost, which lands on the
   owner's subscription rather than an API line item; say so explicitly when pricing.

5. **Start the parallel run.** The shadow mechanism is v1's `ab.ts`: ONE config write to
   v1, zero v1 code changes. Before that write: run the isolation preflight (data dirs
   realpath-disjoint, spawner guards), confirm the mechanized guarantees (G1–G9) are
   enforced in code, and get the owner's explicit go — this touches his live memory
   instance's config, the only action in this session that does. Confirm day-1 telemetry
   is flowing both ways, then hand off: the run continues in the background for 3+7
   active days. Final deliverable: `docs/PARALLEL-RUN-STATUS.md` — what started and when,
   the watches and their four-value discipline, the daily check ritual, and the REVERT
   lever (one config write; failure named; re-entry cheap).

# Rules

- `~/.bansai` is the owner's — and the assistant's — live memory. Its ONLY permitted
  touch is the single designed `ab.ts` config write, owner-present, after the isolation
  preflight passes. `~/.claude-engram`: never, for anything.
- Tests stay hermetic; the run directory is the instrument's only write target (G1).
- Nothing that spends runs before the owner prices and approves it in this session. Log
  actuals against estimates in PARALLEL-RUN-STATUS.md.
- Agents on Opus by default; Sonnet for mechanical fan-out; Fable only where judgment
  density clearly earns it — conserve Fable tokens.
- Report trends and failures honestly. A stalled precondition named beats one waived.
  Never mark a precondition closed without its named verification.

Start now.

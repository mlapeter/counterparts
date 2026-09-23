# What is in `docs/`

This folder is the project's working record, kept in the open: the workshop with the lights
on. Most of it was written during the build, by the author and the AI sessions that build
Counterparts with him, for each other. It is dated, candid, and often superseded by a later
page. **Nothing here has standing authority.** [`CONSTITUTION.md`](../CONSTITUTION.md) alone
has it; every other page is a working default or a record of what happened.

## If you came to use it

- [`QUICKSTART.md`](QUICKSTART.md) — the install path.
- [`ELI5.md`](ELI5.md) — the whole system in plain words, on one page.
- [`module-map.md`](module-map.md) — the technical map, module by module.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — how to run the suite and send a change.

## Where the work is going

- [`ROADMAP.md`](ROADMAP.md) — the plan for the current round.
- [`HANDOFF.md`](HANDOFF.md) — the note one session leaves for the next. The newest section is
  on top; everything below it is history.
- [`IMPROVEMENTS.md`](IMPROVEMENTS.md) — things noticed while living on it, as opposed to
  building it.
- [`new-user-findings.md`](new-user-findings.md) — what the first install from npm was like.

## Module documents (in `src/`)

Each module under `src/` carries its own pages. `CONTRACT.md` says what the module keeps (with
its lineage), what it drops, and what it guarantees. `NOTES.md` records what the build
learned. `INTERFACE-GAPS.md` lists what the module still owes. [`SEAMS.md`](SEAMS.md) holds the
wiring obligations between modules, and [`observer-mode.md`](observer-mode.md) describes one
mode of the core API.

## Status records

Dated snapshots, kept as history rather than current state:
[`BUILD-STATUS.md`](BUILD-STATUS.md) (feature-complete, 2026-08-25),
[`LAUNCH-STATUS.md`](LAUNCH-STATUS.md) (the launch scoreboard, from 2026-09-04),
[`PARALLEL-RUN-STATUS.md`](PARALLEL-RUN-STATUS.md) (the weeks v1 and this version ran side by
side), and [`live-verify-2026-08-25.md`](live-verify-2026-08-25.md).

## Specs and plans

[`storage-spec-2026-09-16.md`](storage-spec-2026-09-16.md) and its
[`-ideas`](storage-spec-2026-09-16-ideas.md) companion,
[`plan-step3-the-floor-2026-09-17.md`](plan-step3-the-floor-2026-09-17.md), and
[`plan-parallel-rebuild-2026-09-18.md`](plan-parallel-rebuild-2026-09-18.md). A plan is a
recommendation as of its date. The code and the `CONTRACT.md` files say what was built.

## Adversarial reviews

`adversarial-review-*.md`. Before a risky change merged, a second agent was briefed to break
it, worked read-only against temporary stores, and wrote down what it found. A file ending in
`b` or `c` is the next pass, reviewing the builder's fixes. Some later reviews live as comments
on their pull requests instead.

## Diagnoses, audits and measurements

[`finding-12-diagnosis-2026-09-17.md`](finding-12-diagnosis-2026-09-17.md),
[`promotion-diagnosis-2026-09-17.md`](promotion-diagnosis-2026-09-17.md),
[`recall-surfacing-diagnosis-2026-09-18.md`](recall-surfacing-diagnosis-2026-09-18.md),
[`mechanism-inventory-2026-09-17.md`](mechanism-inventory-2026-09-17.md),
[`contract-audit-2026-09-16.md`](contract-audit-2026-09-16.md),
[`contracts-sweep-trial-physics-2026-09-17.md`](contracts-sweep-trial-physics-2026-09-17.md),
and [`replay-review-2026-08-26.md`](replay-review-2026-08-26.md). Several of them read the
author's own store, read-only, and report counts from it.

## Folders

- [`harvest/`](harvest/README.md) — what v1 taught, distilled on 2026-08-25: a behavioral spec,
  a scar list, a test triage and more. [`harvest/SYNTHESIS.md`](harvest/SYNTHESIS.md) is the
  entry point. It cites v1's own documents, which are not in this repository.
- [`research/`](research/) — research reports, such as local embeddings without an API key.
- [`launch/`](launch/) — the plan for making this repository public and the checklist it
  follows.
- [`images/`](images/) — the dashboard screenshots the README shows.

## Reading notes

- "The owner" is the author. "The assistant" or "the counterpart" is the AI whose memory this
  is.
- `~/.counterparts` is the author's live store. `~/bansai` and `~/.bansai` are v1's code and
  v1's store on his machine. v1's repository is private, so a mention of it is lineage, not a
  link.
- Session ids, run ids and commit ids are cited as the evidence behind a number.
- A dated record may name a file that has since left the tree. Two prompt files were removed
  on 2026-09-23; git history keeps them.

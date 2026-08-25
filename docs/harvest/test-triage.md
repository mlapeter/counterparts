# v1 test suite triage — for the v2 rewrite

*Harvest artifact, 2026-08-25. Classifies every file in `test/` (86 files found, not the
~84 estimated) against `docs/v2-constitution.md`: does the file assert WHAT the system
does (BEHAVIOR — ports, rewritten against the new API), HOW v1 specifically does it
(MECHANISM — re-derived or dropped), test scaffolding (INFRA), or a blend (MIXED, with
the parts named). Method: `describe`/`it` strings read for every file, assertions
skimmed — enough to classify honestly, not exhaustively. Priority on BEHAVIOR rows:
P1 = the file is the PRIMARY guard of a named constitution property or CLAUDE.md scar
(each property/scar is credited to exactly one file; other files touching the same
property are P2 even if their tests are substantial) · P2 = ordinary behavior ·
P3 = tuning/edge polish. "Guards" in the MIXED rows names the behavior vein as the
*property it protects*, never as the v1 assertion-style that carries it (per the
constitution's own example: the no-delete-export assertion is mechanism; "no silent
destruction" is the property).*

## BEHAVIOR — P1 (primary guardian of a named property or scar; ~day-one set)

| File | Guards |
|---|---|
| `interpreter.test.ts` | Property 2 (interpret, don't transcribe): placeholder floor — a stub can never become durable memory; scar 1 (chunked failure isolation, primary case); parse-hardening (balanced-brace extraction) is a lived production scar |
| `gates.test.ts` | Secrets/precision/alias/emotion gates — the non-ablatable gate, primary guardian; content-by-reference at the gate boundary |
| `log.test.ts` | Content-by-reference logging convention (hard rule) — primary guardian; hashText stability; bounded log retention |
| `observer-deposits-nothing.test.ts` | Scar 7 (observer strengthens/deposits nothing, both directions) — primary guardian |
| `ops.test.ts` | Property 7 (revisions keep history via lineage); no-silent-destruction (archive-in-place, never removed from store); content-by-reference on op events; scar 1 (persistStore per-item isolation) |
| `erase.test.ts` | Property 7 / no-silent-destruction: the ONE deliberate, owner-only erasure path — reversible quarantine, cooling-off, append-only tombstones, resurrection deny-list |
| `clock.test.ts` | Scar 8 (active-day clock) — primary guardian: lived-day boundary, crash-replay-exactly-once, clamp-never-behind-canonical |
| `hygiene.test.ts` | Property 3 (forgetting/consolidation is a feature): gist.merge never touches a pinned or ledger-open trace |
| `llm.test.ts` | Scars 2/3 (stop_reason/max_tokens truncation is not data; watchdog-abort is not retried) — primary guardian |
| `runner.test.ts` | Full pipeline order (interpret→gate→assimilate→self-index→wake); scar 5 (lock discipline, primary case); scar 6 (buffer-restore-on-throw, primary case); the wake-injection-integrity P0 fix |
| `ids.test.ts` | Referential-integrity contract: every id resolves, a cycle or a dangling ref is a hard error — a structural invariant the whole graph depends on |
| `ledger-supersede-retarget.test.ts` | The dangling-ledger-after-supersede lesson — a real, recurring live bug (fired again 08-23 per DECISIONS.md); open evidence must follow a belief through revision |
| `selfindex-supersede.test.ts` | Property 4 (self stays consistent): the self-index must retarget on revision so the wake render never asserts a superseded statement |
| `self-confirm-freeze.test.ts` | Property 4: a standing design decision (now permanent) that self-narration cannot self-reinforce through a naive confirm loop |
| `protected-queue.test.ts` | Property 4 (self is governed, owner-visible): second-signature confinement for identity writes; a denial archives with a reason, nothing vanishes |
| `schema-birth.test.ts` | Property 1 (structure of experience) crossed with property 4 (self excluded from autonomous birth): hallucination guard, collision detection, content-by-reference refusal |
| `prospective.test.ts` | A genuine "follow the brain" model (anticipation/temporal ramp) plus scar 5 (ledger lock, secondary case) |
| `contradiction-pipeline.test.ts` | Property 7's hard boundary: the interpreter can never rewrite a belief directly (contract 7) — confirmation vs. revision, end to end |
| `accommodate.test.ts` | The accommodation engine itself: authorization required for any core edit, per-kind thresholds, forensics hold, secrets gate runs before the write lands |
| `subconscious-gate.test.ts` | Property 12 (follow the brain) — the recall admission gate: SNR, per-kind floors, lateral inhibition, refractory clock |
| `subconscious-activation.test.ts` | Property 12 — the spreading-activation formula itself (distinct from admission: this is what accrues before the gate decides) |
| `subconscious-hebbian.test.ts` | Contract 3 (Hebbian credit); scar 5 (flush lock, secondary case); at-most-once flush semantics |
| `note.test.ts` | Property 8's named exception ("the note ... is the exception, not the interface") — thin file, structurally primary |
| `subconscious-golden.test.ts` | Canonical end-to-end recall acceptance scenarios (G1–G4) — property 11 (evidence over ceremony, verified live) at the recall layer |

## BEHAVIOR — P2 (ordinary behavior; real but not a lone property's guardian)

| File | What it guards |
|---|---|
| `accommodation-iteration.test.ts` | Accommodation's rules 1–4 (protected-exclusion, per-event cap, distinct-occasions) — refinements of `accommodate.test.ts`'s contract |
| `accommodation-residuals.test.ts` | Evidence anchors to the marked contradicting trace; refractory cooldown against re-litigating a refused target |
| `assimilate.test.ts` | Contradiction-ledger accrual math; idempotent replay by body hash; thread.close resolution via the engine matcher |
| `embed-batch.test.ts` | Scar 1 applied to embedding (secondary case — interpreter.test.ts is primary) |
| `episode-ingest.test.ts` | Self/episode ingestion as first-class traces; grown-file re-ingest; idempotency |
| `episode-lens.test.ts` | Secrets gate applied to episode excerpts before they reach a prompt (secondary case); byte-cap crowd-out guarantee |
| `episode-ritual.test.ts` | Substance-gated, ambient reflection pacing — property 8's ambient principle, implementation-specific cadence |
| `fully-gated-chunk.test.ts` | Secrets gate is non-ablatable end-to-end (secondary case of `gates.test.ts`'s property) |
| `reinforce.test.ts` | Reinforcement bands; SEMANTIC_CEILING — rote repetition alone never crosses into identity, a deliberate deviation from naive reinforcement |
| `roundtrip-fidelity.test.ts` | Ops-based mutation is never a raw rewrite (audit-trail principle); stated-emotion never silently overwrites a felt one |
| `runner-index-refresh.test.ts` | Hash-skip unchanged bodies (no redundant re-embedding); cache refresh at cycle end |
| `runner-log-retention.test.ts` | Bounded log retention cadence at the boundary |
| `runner-raw-span-retention.test.ts` | Bounded raw-span retention — privacy-conservative default is owner policy, not just mechanism |
| `runner-spawn.test.ts` | A spawned child must inherit the correct data dir, never silently fall back to a default (scar 4 adjacent) |
| `scope-sweep.test.ts` | A boundary run also sweeps other stranded projects' buffers, each gated/attributed under its own scope — no cross-contamination |
| `self-slice.test.ts` | Property 9 (one memory, many fidelities): gist compresses, the falsifiable surface (beliefs/currentState) stays verbatim |
| `selfindex.test.ts` | Self-model rendering under a byte/element budget, warmth-ordered, cap never exceeded |
| `selfindex-recompress.test.ts` | Never-compress marker on verbatim-pinned entries; every recompression proposal is archived before it's applied |
| `selfstore.test.ts` | Property 8's exception, elaborated (structured self-store, one tool not two); scar 6 (a failing sweep costs nothing) |
| `subconscious-cues.test.ts` | Entity-cue matching with IDF weighting; ambiguous-entity handling (contract 5); non-user-content cue exclusion |
| `subconscious-emotion.test.ts` | Stated-emotion lexicon detector (the *gate* that admits it is `gates.test.ts`'s property) |
| `subconscious-loadstore.test.ts` | Embedding math (cosine); active-day base-level decay (scar 8 adjacent) |
| `subconscious-reference.test.ts` | Reference-driven full Hebbian credit — a supporting mechanism for contract 3, which `subconscious-hebbian.test.ts` primarily guards |
| `subconscious-tiers.test.ts` | Injection-rendering tiers (footnote vs. surfaced) — a rendering contract, not a memory property |
| `thread-match.test.ts` | Open-loop matching that refuses on ambiguity rather than guessing — a design value (evidence over ceremony), not a named property |

## BEHAVIOR — P3 (edge polish / tuning)

| File | What it guards |
|---|---|
| `deliberate.test.ts` | Cosine-ranked dev-mode recall fallback — a dev-only convenience path |
| `subconscious-porch-regression.test.ts` | A specific query-aware lateral-inhibition tuning regression |
| `subconscious-ranker-regression.test.ts` | Specific ranking-tuning regression probes (salience-sort-weight, admission-bound headline) |

## MIXED (state which parts port)

| File | Behavior (ports) | Mechanism (drop / re-derive) |
|---|---|---|
| `buffer.test.ts` | Idempotent-by-content-hash append; scar 6 (buffer-restore-on-throw, primary case); privacy-conservative retention default (archive-not-delete when opted in) | `buffer-archive/YYYY-MM-DD/` directory layout, `.pending` rename-aside recovery, exact chunk-byte-budget mechanics |
| `backup.test.ts` | Backups run on active-day cadence and fail non-fatally (property 7: "backups catch catastrophe") | The canonical-file allowlist and directory layout for what gets copied |
| `cli.test.ts` | Erase requires explicit confirmation + a cooling-off window; `on` refuses without a passing gate record (no ceremony-free go-live) | `settings.json` merge mechanics, exact CLI flag/output shapes, gates.md file format |
| `dashboard.test.ts` | Read-only guarantee (an instrument leaves the store as it found it — scar 7's spirit applied to a viewer); sensitive-content withholding; Host-header guard against DNS rebinding | The ~50 HTTP endpoint JSON shapes, Chart.js vendoring, the terminal-dashboard page itself — all v1-specific |
| `db.test.ts` / `db-model.test.ts` | The DB-is-a-cache invariant: deleting the derived index and rebuilding from canonical files reproduces it exactly | SQLite schema, column names, migration numbering |
| `erase-universality.test.ts` | No-silent-destruction, enforced structurally: deliberate erasure is unreachable from any LLM or boundary path | The literal import-graph assertion style ("only module X imports file Y") is v1 code-shape |
| `files.test.ts` | No-silent-destruction (no system path can delete a canonical file); overwrite archives the prior version (revision keeps history); a portable, prose-readable format survives round-trip (property 6) | Frontmatter serialization details, atomic temp-file write mechanics, the git-absence check (a v1 architecture decision, not a constitution property) |
| `gate-universality.test.ts` | The secrets gate is structurally universal and non-ablatable — every write path is gated, with no flag to turn it off | The literal "callers are exactly this known set" import-graph check |
| `hooks.test.ts` | Detached-spawn-plus-watchdog pattern (scar 4); a latency budget that aborts cleanly with no side effects; anti-loop re-entrancy guard | Claude-Code-specific hook names and wiring (SessionStart/UserPromptSubmit/Stop/...) — this is host-coupling, and property 5 says the core knows nothing about any particular host |
| `mcp.test.ts` | Self-store is one tool, not two (a real design decision); observer stands down over the wire (scar 7) | MCP wire-protocol mechanics (initialize/tools-list/tools-call framing) |
| `protected-confinement.test.ts` | Second-signature confinement for identity writes (property 4) — only a deliberate, owner-authorized path can write protected/identity elements | The import-graph structural check itself |
| `schema-md.test.ts` | A lossless, portable, human-editable prose format must survive round-trip (property 6) | The exact frontmatter + JSON-in-comment serialization scheme |

## MECHANISM (do not port; v2 re-derives or drops)

| File | Why it's mechanism |
|---|---|
| `ab.test.ts` | v1/engram alternate-day coexistence experiment — this pairing does not exist in v2 |
| `engram-guard.test.ts` | Shell-script parity for the same v1/engram A/B system — drop entirely alongside `ab.test.ts` |
| `boundary-keys.test.ts` | Multi-file API-key rotation and per-key cursor bookkeeping — v1-specific plumbing |
| `config.test.ts` | Config-schema literal keys and validation shape; the retention *defaults* reflect real owner policy but the test is schema-shape |
| `craftlane.test.ts` | A specific mechanical text-compression heuristic for one wake-render lane |
| `cursor-prune.test.ts` | Bounded retention of a specific transient buffer-cursor file layout |
| `flow-registry-totality.test.ts` | Six-axis consistency check that every event type is wired into the v1 dashboard's own registries (FLOWMAP/TRANSLATE/OPWORDS) — pure v1 code-shape |
| `interpreter-schema.test.ts` | Anthropic API structured-output JSON-schema conformance mechanics (additionalProperties, union caps) — provider-specific |
| `migrate-project-beliefs.test.ts` | One-time v1 migration script (beliefs → entity schemas) — the migration is done; the tool has no future |
| `migrate-secrets-gate.test.ts` | One-time migration secrets-gate tooling. Note: the underlying lesson — *a bulk-import path is secrets-gated exactly like any other write path* — should get re-derived deliberately for whatever v1→v2 data import v2 eventually needs, since that import is a near-certainty and this is the one test that proves the scar was ever learned |
| `migrate-self-currentstate.test.ts` | One-time v1 migration script (self currentState → entity homes) |
| `migrate.test.ts` | One-time engram→bansai migration script and its heuristics |
| `subconscious-config.test.ts` | Config-schema validation for v1-specific subconscious keys |
| `thread-triage.test.ts` | v1-specific owner triage-sheet parsing and CLI. Vein: scar 5 (consolidation lock) and "dry run is the default" are real safety behaviors riding along in a mechanism-dominant file |

## INFRA (test helpers, eval/replay tooling — not system behavior)

| File | What it is |
|---|---|
| `bakeoff-sweep.test.ts` | Model bake-off evaluation harness (blinding, judgment aggregation, divergent-case detection) |
| `longmemeval-fetch.test.ts` | Benchmark dataset download harness |
| `longmemeval-loader.test.ts` | Benchmark dataset parsing harness |
| `longmemeval.test.ts` | Benchmark pipeline harness (`--dev` runner) |
| `migrate-guard.test.ts` | Safety helper preventing a migration script from touching the live data dir |
| `replay-harness-guard.test.ts` | Safety helper preventing the eval replay harness from touching a real store |
| `replay.test.ts` | Transcript-replay harness (parsing + end-to-end scorer) used to drive evaluation, not the product itself |

## Counts

- **86 files total** (task estimated ~84; actual count is 86)
- **BEHAVIOR: 52 files** — P1: 24 · P2: 25 · P3: 3
- **MIXED: 13 files** (12 table rows — `db.test.ts` and `db-model.test.ts` share one row, both guarding the DB-is-a-cache invariant)
- **MECHANISM: 14 files**
- **INFRA: 7 files**

Total: 52 + 13 + 14 + 7 = 86.

## P1 behavior tests v2 must have from day one

Grouped by the property or scar each one primarily guards — this is the day-one unit,
not the file:

1. **Interpret, don't transcribe** — a stub can never become durable memory (`interpreter.test.ts`, placeholder floor)
2. **The secrets/precision/alias/emotion gate is non-ablatable** (`gates.test.ts`)
3. **Logs are content-by-reference, never body text** (`log.test.ts`)
4. **Observer mode deposits and strengthens nothing, both directions** (`observer-deposits-nothing.test.ts`)
5. **Revisions keep history; nothing is silently destroyed** — archive-in-place, lineage on supersede (`ops.test.ts`)
6. **Deliberate erasure is the one owner-only, reversible, tombstoned exception to no-silent-destruction** (`erase.test.ts`)
7. **The active-day clock**: decay runs on days lived, not calendar days; crash-safe, never resets silently (`clock.test.ts`)
8. **Consolidation never touches pinned or in-dispute memory** (`hygiene.test.ts`)
9. **A truncated LLM response is a failure, not data; an aborted call is not retried** (`llm.test.ts`)
10. **The full boundary pipeline order, lock discipline, and buffer-restore-on-throw** (`runner.test.ts`)
11. **Referential integrity**: every id resolves; a cycle or dangling ref is a hard error (`ids.test.ts`)
12. **Open evidence follows a belief through revision — never strands on superseded lineage** (`ledger-supersede-retarget.test.ts`, `selfindex-supersede.test.ts`)
13. **Self-narration cannot self-reinforce through a naive confirm loop** (`self-confirm-freeze.test.ts`)
14. **Identity/protected writes require a second, owner-authorized signature; denials are recorded, not erased** (`protected-queue.test.ts`)
15. **Autonomous entity creation excludes self and refuses hallucinated names** (`schema-birth.test.ts`)
16. **Prospective memory**: eligibility, temporal ramp, capped firing (`prospective.test.ts`)
17. **The interpreter can never rewrite a belief directly — confirmation and revision are structurally separate paths** (`contradiction-pipeline.test.ts`, `accommodate.test.ts`)
18. **Follow-the-brain recall**: spreading activation, then an admission gate (SNR/per-kind floors/lateral inhibition/refractory) (`subconscious-activation.test.ts`, `subconscious-gate.test.ts`)
19. **Hebbian association strengthens only on genuine reference, under lock, at-most-once per flush** (`subconscious-hebbian.test.ts`)
20. **The note is the named exception to ambient remembering** (`note.test.ts`)
21. **Canonical end-to-end recall acceptance scenarios stay green** (`subconscious-golden.test.ts`)

# Module map

*The skeleton's spine. One brain function per self-contained module (constitution line
10); each module's `CONTRACT.md` states purpose, brain analog, what it keeps (with
lineage: v0 / engram / v1 / the store's design memory), what it drops or simplifies,
its guarantees, and the scars it honors. Contracts are spec, and they were written
first; the skeleton they describe has since been built, so read each contract beside the
code and the `NOTES.md` / `INTERFACE-GAPS.md` next to it.*

## Core (`src/core/`) — knows no host

| module | brain function | one line |
|---|---|---|
| `physics/` | synaptic plasticity | ALL the arithmetic on one page: strength, decay, reinforcement, strength-weighted revision. No opinions, no model calls. |
| `encode/` | attention + amygdala tagging | What gets in: gates (secrets, precision), salience tagged at write time, novelty as prediction error. |
| `remember/` | hippocampal encoding | The authorship contract: the experiencer's end-of-session dump (content, salience tags, `updates:` marks), in-the-moment jots, crash-fallback ingestion. |
| `store/` | the substrate | Three boxes: prose markdown (canonical), one small SQLite (canonical operational, transactional), one rebuildable cache (embeddings/FTS, never backed up). |
| `recall/` | retrieval + priming | Cues → activation → surfacing gate → bounded injection; footnote tier; reinforcement on real use. |
| `associate/` | Hebbian linking | Co-activation strengthens links; spreading activation at recall. **RESOLVED (owner, 2026-08-25): stays a module** — edge-level arithmetic keeps `physics/` one page; Hebbian plasticity/contiguity is its own mechanism in the field guide. |
| `schemas/` | semantic memory | Entities and beliefs; birth by mention, death by decay; strength-weighted revision with row history. |
| `self/` | autobiographical self | Identity documents, episodes, the wake briefing (v0's briefing, grown up). Governed: frozen self-reinforcement rules. |
| `prospective/` | prospective memory | Future intentions, cued by time or context; fire / suppress / reference telemetry. |
| `sleep/` | systems consolidation | Pure math on a cycle: decay tick (active-day clock), floor-pruning (real forgetting), re-render of the wake briefing. Zero standing model calls. |
| *(observer)* | — (instrument stance) | **RESOLVED (owner, 2026-08-25): a MODE, not a module** — one predicate threaded through the core API, checked at the store seam. Spec moved to `docs/observer-mode.md`. |

**Third open question (check-in): the `remember`/`encode` boundary.** With the
experiencer's dump as the primary path, span-capture survives mainly as crash-fallback
input — does `encode` shrink to gates-and-tagging inside `remember`'s pipeline?

## Adapters (`src/adapters/`) — one host each

| adapter | job |
|---|---|
| `claude-code/` | Hooks: wake injection at session start, end-of-session remember, crash detection. The launch adapter. |
| `mcp/` | Deliberate tools: note, recall, status — plus the Stop ask's two return channels, `session_end` (memories) and `chapter` (the episode's own journal, **added 2026-09-04**, because the ask named a door no adapter had built). |
| `cli/` | `counterparts` command: status, install, owner operations (delete, export, backup). |
| `dashboard/` | The owner's window (constitution line 16): brain-view, revision stories, band/protected lists. Observer-mode by construction; minimal version ships DURING the parallel run. **Added 2026-08-25 (owner elevation).** |
| `sessions.ts` | Not an adapter — a leaf both may import: the live-session registry a host's hooks write (`<dataDir>/sessions/`) and its tools read, so a tool launched without a session can bind to one that is real, live and in its project. Adapters stay leaves; this is the sibling they share instead of importing each other. **Added 2026-09-04**, because this host's MCP servers are launched from a static config and cannot be told which session they serve. |
| `expansions.ts` | The same shape, for the other direction: the handle-resolution log the MCP `recall` tool writes (`<dataDir>/sessions/expansions.jsonl` — a hashed handle, an id, a timestamp) and the boundary's credit pass reads, so an expansion by TITLE credits the memory it actually reached. **Added 2026-09-15** (LAUNCH-STATUS G50): `recall/reference.ts` credits literal `mem_…` addresses and resolves nothing, so until this the most deliberate act a session had — naming a memory and reading it — earned no credit at all. |

## Tools (`tools/`)

| tool | job |
|---|---|
| `replay/` | Validation harness: feed v1's recorded month of real inputs through Counterparts, compare against the distributional baselines (`docs/harvest/replay-baselines.md`, behavioral-spec §17). |

## Rulings — 2026-08-25 (check-in + adversarial review, all owner-ratified)

Contracts are read subject to these; where a contract still says PROPOSED on a listed
item, this section is the newer law.

1. `associate/` stays a module; observer is a mode (`docs/observer-mode.md`); `encode/`
   stays separate; `dashboard/` added as an adapter (constitution line 16, ratified).
2. Physics: pressure-accumulator revision (§5.6 rewritten — field on target, one credited
   challenge/day, force = strength × sal, novelty at encoding only); nothing born into
   identity, N = 3 promotion at consolidation (§5.3 rewritten); bands 4→3 and one strength
   number both settled; decay is a three-way (flat/exponential/power-law) decided by
   replay; H = 90 is a TUNABLE default, not an owner ruling.
3. Settled drops: identity-promotion surface, `protected.add` queue, model-seat pins,
   zero-deps vow. Per-session gate state is persisted (`recall/`). Replay gates use
   ranges, not point targets. Wake briefing renders WITHOUT a model at launch (the sleep/
   OQ3 correction: v0's briefing was in fact model-compressed — the precedent cuts the
   other way, and Amendment 15 decides instead).
4. The adversarial review's five findings are all conceded and resolved in the contracts
   as of this date; the §4-vs-§5.3 band contradiction is closed.

## Authority note

Owner-decided (2026-08-25, bansai `docs/DECISIONS.md`): experiencer authorship with
crash fallback; librarian-as-physics with zero standing model calls; strength-weighted
revision (no ledger subsystem); only physics forgets; the three storage boxes;
birth-by-mention entities; Amendment 15. Anything a CONTRACT drops beyond that list is
marked **PROPOSED** and waits for the owner's check-in.

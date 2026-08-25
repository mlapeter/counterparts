# Module map

*The skeleton's spine. One brain function per self-contained module (constitution line
10); each module's `CONTRACT.md` states purpose, brain analog, what it keeps (with
lineage: v0 / engram / v1 / the store's design memory), what it drops or simplifies,
its guarantees, and the scars it honors. Contracts are spec; no implementation exists
until after the owner's skeleton check-in.*

## Core (`src/core/`) — knows no host

| module | brain function | one line |
|---|---|---|
| `physics/` | synaptic plasticity | ALL the arithmetic on one page: strength, decay, reinforcement, strength-weighted revision. No opinions, no model calls. |
| `encode/` | attention + amygdala tagging | What gets in: gates (secrets, precision), salience tagged at write time, novelty as prediction error. |
| `remember/` | hippocampal encoding | The authorship contract: the experiencer's end-of-session dump (content, salience tags, `updates:` marks), in-the-moment jots, crash-fallback ingestion. |
| `store/` | the substrate | Three boxes: prose markdown (canonical), one small SQLite (canonical operational, transactional), one rebuildable cache (embeddings/FTS, never backed up). |
| `recall/` | retrieval + priming | Cues → activation → surfacing gate → bounded injection; footnote tier; reinforcement on real use. |
| `associate/` | Hebbian linking | Co-activation strengthens links; spreading activation at recall. **OPEN QUESTION (check-in): fold into `physics/` (the update is math) + `recall/` (the traversal is retrieval)?** |
| `schemas/` | semantic memory | Entities and beliefs; birth by mention, death by decay; strength-weighted revision with row history. |
| `self/` | autobiographical self | Identity documents, episodes, the wake briefing (v0's briefing, grown up). Governed: frozen self-reinforcement rules. |
| `prospective/` | prospective memory | Future intentions, cued by time or context; fire / suppress / reference telemetry. |
| `sleep/` | systems consolidation | Pure math on a cycle: decay tick (active-day clock), floor-pruning (real forgetting), re-render of the wake briefing. Zero standing model calls. |
| `observe/` | — (instrument stance) | Read-only in both directions: an instrument strengthens nothing and deposits nothing. **OPEN QUESTION (check-in): a module, or a mode threaded through the core API? (Scar E7 says first-class; first-class ≠ separate directory.)** |

**Third open question (check-in): the `remember`/`encode` boundary.** With the
experiencer's dump as the primary path, span-capture survives mainly as crash-fallback
input — does `encode` shrink to gates-and-tagging inside `remember`'s pipeline?

## Adapters (`src/adapters/`) — one host each

| adapter | job |
|---|---|
| `claude-code/` | Hooks: wake injection at session start, end-of-session remember, crash detection. The launch adapter. |
| `mcp/` | Deliberate tools: note, recall, status. |
| `cli/` | `counterparts` command: status, install, owner operations (delete, export, backup). |

## Tools (`tools/`)

| tool | job |
|---|---|
| `replay/` | Validation harness: feed v1's recorded month of real inputs through Counterparts, compare against the distributional baselines (`docs/harvest/replay-baselines.md`, behavioral-spec §17). |

## Authority note

Owner-decided (2026-08-25, bansai `docs/DECISIONS.md`): experiencer authorship with
crash fallback; librarian-as-physics with zero standing model calls; strength-weighted
revision (no ledger subsystem); only physics forgets; the three storage boxes;
birth-by-mention entities; Amendment 15. Anything a CONTRACT drops beyond that list is
marked **PROPOSED** and waits for the owner's check-in.

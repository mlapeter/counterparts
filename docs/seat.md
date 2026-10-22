# The seat: the acts the memory asks of a model

The memory doesn't write itself. A model reads the wake, rates what it was shown, writes
sessions up, dreams and reflects. Whoever does that sits in **the seat**, and the self is
authored there. So the seat is part of the memory's own protocol, not a feature of one host.
The interface is `src/core/seat.ts`; this page describes the acts and their shapes.

There are two kinds of act.

## Night acts: the memory asks

The memory composes an **ask** and a seat answers it: `Seat.answer(ask) → answer`. The ask
says which act it is, gives the words the memory composed, the tools the answer goes through
and the ones it must not reach, the session it is filed under, the directory, and its
limits. The answer says only whether the seat took the ask and how it ended. **What the act
did is read from the store**, where the tools wrote it, never from the answer.

| Act | The words | Answers through | Must not reach | What lands in the store |
|---|---|---|---|---|
| `catch-up` | the owed parts of sessions that ended unwritten (`night-catch-up.ts#catchUpPrompt`) | `session_end` (its `writeUp` field) | everything else | write-ups, filed as each owed session's own |
| `dream` | the night's launch prompt (`Dreams#launchPrompt`, without the reflection) | `dream` (its phases, the page writer's first), `self_page`, `recall` | `reflect` | the page writer's revision, a journaled dream, its changes |
| `reflection` | the reflection's launch prompt (`Reflections#launchPrompt`), on tonight's dream or the last few days | `dream`, `reflect`, `self_page`, `recall` | nothing listed | a finished reflection, its returns, page revisions |
| `tags` | the tagging prompt (`dream/tags.ts#tagsPrompt`): untagged memories, look-alike tags, cards with no kind | `dream` (its `tags` phase) | `reflect`, `self_page` | tags `via: night`, merges, card kinds, a row per run |

The tools are the memory's own, and a host names them its own way (Claude Code:
`mcp__counterparts__<tool>`). Lookups inside an answer are tool calls: `recall` reads a
memory whole by id, and the dream's phases hand out their own bundles (`src/core/fit/`). A
seat may answer with an agent loop over the tools, or hand a model a pre-fitted bundle.
`fit/`'s lookup ledger measures how far one call gets compared with a loop.

The dream must not reflect because the reflection is its own ask, with a fresh context. It
reads tonight's dream from the store, never the dream's conversation. One shared context
peaked past a 200k-token model (2026-10-11).

The ask declares what must not be reached; the host enforces it. Claude Code does this two ways:
- it denies the withheld tools to the child;
- it tells the memory's server which act it serves (`COUNTERPARTS_NIGHT_CHILD`), so the dream
  tool's last step stops at the journal instead of pointing on to the reflection.

A seat that answers through the server another way must tell the server the same.

A night's order (`adapters/claude-code/night-run.ts#runNight`):
1. the catch-up, batch by batch;
2. the dream;
3. the reflection, unless the dream exited at once having begun nothing, or a reflection
   already finished today;
4. the tagging (2026-10-21), on the host's fastest model, unless `schemas.TAGS_NIGHT` is off
   or there is nothing to ask. Its exit is never the run's.

## In-session acts: the host's model drives

No ask goes out. The host's model calls the memory's tools as the conversation goes, and the
memory composes what it hands back.

| Act | The memory composes | The model answers with |
|---|---|---|
| wake | the wake: the page, handoffs, still open, coming up | reading it (no call) |
| a turn's recall | footnotes and loud memories for the turn | using them, expanding by id (`recall`) |
| rate | the list of what was shown since the last write | `session_end`'s `rated` and `drewOn` |
| write-up | the end-of-session ask | `session_end`'s memories, `remember` mid-session |
| chapter | the boundary ask | `chapter` |

A seat that isn't a host's live model (the harness's) answers these by calling the same core
functions the tools call: compose the wake and footnotes, hand them to the model, and feed
its write-up and ratings through the server's own paths.

## Who sits in it

- **Claude Code** (`night-run.ts#claudeCodeSeat`): each night ask is a locked-down
  `claude -p` with only the counterparts MCP server. This is what every user has.
- **The harness** (`tools/harness/`, dev-only), next: first headless Claude Code against a
  temp store; then a local open model; then the API, only if speed or cost forces it.

The starting rule (2026-10-20): self-facing acts, the reflection above all, run on the model
that lives in the store. When one doesn't, the harness measures the drift: the same store,
two seats, the page diff and the write-ups' ratings. A seat that isn't Claude reads the asks
differently, so its write-ups are scored before it is trusted with anything but measurement.

No version field and no compatibility apparatus until a third implementer exists.

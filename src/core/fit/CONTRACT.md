# `fit/` — CONTRACT

*Added 2026-09-28 (build B), from the owner's conversation of that day and the two notes
behind it (`2026-09-28-brain-compression-research.md`, `2026-09-28-brain-principle-audit.md`,
kept privately). A working default, held lightly: revise it when a real night shows it wrong.*

## 1. The principle (working default, 2026-09-28)

When a mechanism has more than it can take in, it **labels, ranks, and says so** rather than
cutting by position.

- **A line for everything** in the candidate set (a night's new memories, the core, a few
  days' chapter entries). The **whole text for the most important**, by the labels the
  mechanism itself ranks by. **Ids, and a named, batchable lookup, for the rest.**
- **Count what waits, and carry it over.** What a run cannot take tonight is not dropped: it
  waits, with a count, for a window; past the window it goes back to ordinary fading, and that
  count is said too.
- **Hard budgets live at the host's ceilings** — about 10,000 characters of hook injection, and
  about 25,000 tokens per tool result — and a model's own context. At those, compress, or
  deliver in parts. Everywhere else a number is a page size or a nightly rate.
- **Cuts are stated.** Every excerpt carries its whole length (`chars`).
- **The lookup is measured.** If receivers do not use it, the lines are too thin or the
  instruction is unclear — and "index + look up more" has become truncation again.

## 2. Brain analog

The brain tags moments as they happen (surprise, feeling, reward, what is coming), replays a
selection by tag at night within a limited capacity, and what misses tonight is mostly caught
up the next night (Schönauer 2015; the research note, Part 1 §2 and §7). A remembered day is
slices with gaps, not its first two thirds (Jeunehomme & D'Argembeau). Working memory holds a
few chunks and reaches the rest through pointers.

## 3. What the module holds

- `fit(candidates, { room, excerptChars, least })` — the fitter. The caller brings each
  candidate's **priority** (the fitter computes none: the dream ranks by replay priority, the
  reflection by feeling), its line and its whole text. Breadth first: ids (or lines, with
  `least: "line"`) for all in priority order, then lines, then whole texts, each pass filling
  past a misfit. Returns what each was shown as (`whole | excerpt | line | id`), with its whole
  length, the ids that wait, and a report in one shape for every mechanism:
  `{ candidates, whole, excerpt, lined, ids, waiting, agedOut }`.
- `lineOf(row, bytes)` — what a memory is called in one line: its title, else its first
  substantive line (markdown markers and chapter headings passed over), byte-bounded, the cut
  said with "…". Derived at read; nothing stored. Titles stay the writer's: nothing here fills
  one in (a title is also a recall handle, and it is searched with the body).
- `derivedFrom(row)` — what a row was made from, one reader over the meta keys that say it
  (`mergedFrom`, `sources`, `cites`, `groundedIn`, `revisedFrom`, `updates`, `migratedFrom`,
  `reminderFrom`, `episodeId`).
- `packParts(pieces, first, later)` — a list too long for one result, in parts.
- **The lookup ledger** — each mechanism's latest index (`fit.index.<mechanism>` in meta, one
  row per mechanism, overwritten): which ids it offered at which fidelity, its later parts, and
  which offered ids a lookup has since fetched. `noteLookups(store, ids)` counts, per
  mechanism, the expanded ids an index offered only in part; `fidelityOf` says what a change
  was made from (whole, an excerpt, a line — or whole, fetched since).

## 4. Who uses it (2026-09-28)

- `dream/` — the queue of undreamed memories, tonight's room, detail by importance, chapter
  entries as slices, the bundle in parts, fidelity on merges and gists.
- `dream/reflect.ts` — the whole core, every candidate and the last few days as lines at least,
  the most felt whole, chapters as slices, fidelity per item.
- `self/` — the wake (#489 C, 2026-10-16): a long list item prints as its line (title, else
  `lineOf`) and id, the first item of "Still open" and "Coming up" whole when there is room
  left over; the ids offered as lines are `fit.index.wake`, written at session start by
  `adapters/lifecycle.ts` and counted within `LOOKUP_WINDOW_MS` (a wake has no run row).
- `adapters/mcp` — the recall tool counts lookups against the ledger (the `mcp.recall` row's
  `fromIndex`); `claude-code/doctor.ts` surfaces the count (`Lookups`), the wake's offered
  count from each `adapter.wake.injected` row's `lined`.

Deliberate recall fits this way on its own and was left as it is. The wake composer did not
(it printed an item whole or as an id, nothing between) until #489 C.

## 5. Guarantees (as of 2026-09-28)

- A placed item's `chars` is its whole text's length; an excerpt ends "…".
- The fitter's order is the caller's priority; ties keep the caller's order.
- The ledger holds ids and labels only — no words — so removing a memory leaves no copy of its
  words here.
- Arithmetic and bookkeeping only: nothing here calls a model.

## 6. Drops

- Cutting by position (`slice(0, N)` on a newest-first list) for the mechanisms above.
- The dream's `MAX_NEW`, `TEXT_CHARS`, `CHAPTER_CHARS`, `MAX_CHAPTERS`; the reflection's
  `CORE`, `CANDIDATES`, `RECENT`, `TEXT_CHARS`, `CHAPTER_CHARS`, `MAX_CHAPTERS`.

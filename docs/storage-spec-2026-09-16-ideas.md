# Storage spec — ideas and peer replies

*Companion to `docs/storage-spec-2026-09-16.md`. This file holds what is genuinely
unresolved, ideas the assistant had that are not yet recommendations, and what peer
sessions said. If an idea firms up into a recommendation it moves to the spec's §6.
Nothing here is built.*

## 1. Ideas, not recommendations

- **The wake could become the self page plus the handoff.** If the self page is rendered
  by the same renderer as the wake's identity lane, the wake bundle may collapse to: the
  self page (gist, current state, beliefs, threads) plus the handoff lane for this
  directory plus the hints. That would retire the separate lane machinery (craft, threads,
  horizon as their own lanes) in favor of sections of one page. Big simplification if it
  holds; unverified against the byte budget.
- **Per-topic pages, not only per-entity.** "How I work" is a skill-kind entity today. A
  craft page rendered from skill-band rows would be the same mechanism. Check whether the
  page-earning rule (semantic band) already produces it.
- **Gist cadence.** Regenerate only when a source belief was added, superseded, or crossed
  a confidence bar; not on every reinforcement. Otherwise the model call fires nightly for
  the self entity forever.
- **Gist prompt shape, sketched.** Inputs listed as rows with ids, confidence, contested
  flag, learned-on date. Output: the paragraph, then the ids used, one per line. The store
  refuses a gist that cites an id not in its input, and refuses one that exceeds the cap.
  That is the whole grounding mechanism; no parser of prose.
- **Byte caps, as guesses to be measured:** self page under four kilobytes rendered; any
  other entity page under one; a gist paragraph under six hundred bytes; a handoff under
  two kilobytes. Numbers are placeholders, not rulings.
- **Handoff as an optional file projection.** The owner keeps a hand-written
  `docs/HANDOFF.md` in git for humans. If the handoff lane exists, an optional
  `counterparts handoff --write` could render the current one to a file in the project
  directory for the same audience. Not needed for the mechanism.
- **Export renders pages.** `counterparts export` could write the page folder the owner
  originally pictured (ten to a hundred markdown files) as the portable form, satisfying
  constitution line 6 without any file being canonical.
- **A free-text "why saved" line on authored memories.** From the Reddit thread. Cheap;
  useful for debugging why the model kept something. Add when a failure names it.
- **Relationship section.** The self page's relations section should render "what I
  hold about the owner and me," distinct from the owner's own page, which is "what I hold
  about the owner." The renderer decides, not the storage.
- **Migration order, if it ever runs:** rows first with bodies copied from prose, prose
  left in place read-only until verify says every row's body hash matches, then the
  prose folder becomes an export artifact. No file is deleted by the migration.

## 2. Things to verify before any ruling

- Whether the session-end ask can carry the standing picture within the host's injection
  ceiling for a session that touched several entities.
- Whether `Store.list({ type: "schema" })` plus the role field is enough to render a page,
  or whether a page needs an index by entity.
- What the parallel run's storage-layer evidence actually consists of (which daily checks
  read files versus rows), to size the evidence-clock reset honestly.
- WAL under the three-process pattern (Stop hook, detached worker, next prompt's hook):
  measure I38 with WAL on before claiming it closes.

## 3. Peer replies

### counterparts-f7 (the dashboard session)

*Asked: what the dashboard work shows the owner wants to see per entity; whether the
band-and-role mapping matches what they would render; gist-row versus document edit.*

(awaiting reply)

### random-4c (a fresh session in another directory)

*Asked for the shape of their wake, not its content: lane counts from the sentinel,
identity element count, whether it read as a self or a list, what footnotes fired on turn
one, whether they know which project they are in.*

(awaiting reply)

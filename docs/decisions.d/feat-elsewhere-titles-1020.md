### Decided with Mike's go 2026-10-20, lightly held, an experiment (the elsewhere lines name what was written, not only how much)

From the 10-20 morning: Mike runs several sessions at once, and two of them did the same
wake check because neither knew what the other had done. "Today, elsewhere" (session start)
said `~/random open since 08:33 (live), 3 memories`, and "Since you started" (per prompt)
said `Since 08:41: ~/random open, 8 memories`: counts, not what was written. The ~/random
session asked for a line that names the work. Undone by reverting the PR; nothing is stored
differently.

- **What the lines say now.** Each folder they name carries up to two of its memories by
  title and id after the count, e.g. `~/random open since 08:33 (live), 8 memories: "Wake
  check 10-20 from ~/random" (mem_…), "Spans out of backups" (mem_…)`. A title is cut to 48
  bytes (`ELSEWHERE_TITLE_BYTES`); the id is whole, so recall can expand it. A memory with no
  title is named by its first words.
- **Which ones, and why.** Work in progress first: a memory with a status mark (planned,
  proposed, asked, or done, which within today's window means done today), then a work
  memory by the wake's own rule (`self/work.ts#isWorkMemory`: marked `work`, or unmarked and
  a skill, or a fact, entity or place written in a directory), newest first within each.
  Nothing else: no chit-chat (`world`, unmarked person or self). Newest, not highest
  salience: what stops two sessions doing the same thing is what the other one is doing
  now, and a status mark is the writer's own word that something is work in progress.
  Salience would need the physics read, which neither line makes (both are reads only, no
  scan), and it ranks what lasts, not what is current.
- **The gate is the one both lines already use** (`Counterpart#elsewhereGate`): a folder is
  named only when its scope setting is `on` (not off, paused or observer), never this
  folder or the store's own (the nightly run). On top of it, for titles: never a
  confidential memory (not even to the owner, who still sees it counted), never one marked
  about me, us or the owner (personal: those cross only as the about-me chapter line's, and
  are not work), never this session's own, the nightly run's, a chapter's copy, or an
  identity-band row. In the wake, a memory "Still open" may list is left to that lane. The
  folder rule is the same one that decides whether a chapter from that folder may be named
  here, so a folder Mike keeps apart leaks neither.
- **Room.** The line keeps its 300-byte cap (`TODAY_ELSEWHERE_MAX_BYTES`) in the wake and in
  the prompt, because in the wake it takes its room from the lanes above it in `ROOM_ORDER`
  before it steps down. Its ladder now gives up titles before folders, and a chapter's title
  before a memory's: per count of folders, the most titles first (spread across folders
  before two go to one; the first-named folders keep theirs longest), each with the chapter
  and then without. With no titles to name, the forms are exactly the 10-10 ones.
- **No repeats.** "Since you started" names only memories written since this session was
  last told: its window already starts at the wake or at the last line it showed
  (`sinceSeen`), so a title one line named the next does not name again, and a title the
  wake named is not named at the first line. Nothing new, no line, as before.
- **Not covered:** a second session in this same folder. Both lines skip this folder by
  design ("Last here", "Last said here" and the handoffs speak for it), and that stays.
  Whether a live session here should be named too is a question for after the check.

Check ~10-23 (`docs/CHECK-AFTER.md`): do parallel sessions avoid duplicate work, and are the
titles useful or noise?

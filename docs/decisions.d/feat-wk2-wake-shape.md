### Mike approved the shape 10-30 14:12 (draft 5); built by the WK2 builder, 2026-10-30, off by default

The limits and their reasons are `WAKE_SHAPE_LIMITS` in `src/core/self/tunables.ts`. What the spec left open, and the call:

- A store turns it on by a meta row (`counterparts wake-shape on|off|default`), not a config key. Why: one store, every host on it, at once, and back by a word. A config key is one host at a time.
- A store with no page yet keeps "Might be relevant", above the folder. WK1's exception holds.
- The published bundle is untouched, and is delivered if the composer declines (no budget or date, a ceiling too small for the frame, anything that throws). Why: "off" is then the same code, and doctor and the dashboard read it either way.
- The project line (`WAKE_PROJECT_LINE`) isn't in the shape: the table has no section for it, and no row is written with the shape on.
- "Since, here" leaves out open threads and dated items, for their own sections. A row left out still counts as "later", so no false nothing.
- With no handoff and nothing since yesterday, the folder names its last chapter, so a folder left a while ago keeps what "Last here" gave it.
- Spare room on Coming up reaches later items only, up to 3, and never past 2 overdue (round 4: past that it flooded). Spare on Elsewhere stops at 8 folders.
- `Elsewhere`'s rest reads `+2 more folders; recall facts "yesterday"` (ROADMAP, the spec's floor: no count without a door). It is a question, not a list, so it answers for yesterday's work; a folder only worked in today isn't on it.
- A seat is an all-caps first word in the handoff itself, not a list of seats: the prototype's coordinator/roadmap words are one owner's. No seat: the session's short id.
- Sections give way in the order elsewhere, open, coming, yesterday, night, folder; a plain reminder's room is kept until the others have given.
- Last night's budget is 450, not 350: a 300-byte line and two titles passed 350 on every case in round 4.
- A joined folder is here (`PROJECTS_TRAVEL`), as on the old road: its work is in "Since, here" and its sessions in "Open here now". "This folder only" in the spec is against other folders; `project join` says each one's wake shows the work of all of them.
- `Still open:` and `Coming up:` always print a heading, with `Nothing open.` or `Nothing dated.` under it, so "nothing owed" is said rather than left to silence.

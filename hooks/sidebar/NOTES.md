# Sidebar mod: notes

A Claude Code mod (a module of function hooks) inside the Counterparts plugin:
a memory pane docked beside the transcript. **v0.2** (2026-10-10) is what
memory is doing, in 35 columns: a small brain beside the title, the day, the
count and a search box; Memories, Subconscious, Saved this session,
Mechanisms today and Last Dream; three rows of switches. Closed, it is one
line above the prompt (the strip) or a dim tail under it (quiet). The design is
the round-3 mockups Mike chose over three rounds that day
(`~/counterparts-notes/mockups/2026-10-10-mod-round3/`, with `FEEDBACK-all.md`
there: its last section overrides the PNGs). v0.1's notes follow the v0.2
section, as the record; where v0.2 changed something they say so. Everything
here is a working default.

**Try it from a frozen copy**, not from a working tree. A `--plugin-dir` folder
hot-reloads on every edit, and an agent's worktree is deleted at merge. So
export one commit, install its dependencies (the plugin's server, which stands
down beside an npm install, still loads its code), and point Claude Code at
that:

    git -C ~/counterparts fetch -q origin
    sha=$(git -C ~/counterparts rev-parse --short origin/feat/sidebar-v02)
    dir=~/counterparts-trials/sidebar-v02-$sha
    mkdir -p "$dir" && git -C ~/counterparts archive "$sha" | tar -x -C "$dir"
    (cd "$dir" && bun install --frozen-lockfile)
    claude --plugin-dir "$dir"

That loads the whole plugin. Beside the npm install, its classic hooks and its
server stand down, so only the mod runs; the one start-up line says this is
expected and asks for nothing. Every copy named `counterparts` shares one
`$.store` (term-loop's README says where), so a v0.1 trial copy reads what
v0.2 stores: v0.2's `sidebar` is v0.1's `full`; v0.2's `quiet` makes a v0.1
session open its narrow quiet pane.

It opens by itself only where the terminal docks a pane beside the transcript
(the fullscreen layout), and only when the view is the sidebar. `/counterparts`
opens it; `/counterparts strip` and `/counterparts quiet` close it to the strip
or the tail (`hide` and `rail` are quiet too); `/counterparts brain
turning|still|off` sets the brain; `/counterparts resume` resumes a folder
paused here; `/counterparts fps [n]` reports the brain's rate (or sets its
target). `caps` is gone: the footer's switches are dots, with no ends to draw.

**Check it:** `sh hooks/sidebar/check.sh`, which runs validate on both manifests,
`claude plugin test hooks/sidebar` (109 tests, terminal and desktop) and
`tsc -p hooks/sidebar`, all with a throwaway HOME. **See it:**
`tools/term-loop/` (its README), at `--size 200x60` and `--size 160x48`. A
term-loop session sends no message, so nothing comes to mind and nothing is
saved in it; `COUNTERPARTS_SIDEBAR_SESSION=<session id>` in the environment
shows that session's Memories, Subconscious and Saved instead (below,
"Seeded").

## v0.2 (2026-10-10): what memory is doing, in 35 columns

The shots and the side-by-sides are in
`~/counterparts-notes/mockups/2026-10-10-mod-build/` (`mockup-vs-build-200x60.png`,
`mockup-vs-build-160x48.png`, and every state at both sizes).

### The pane, top to bottom

- **Width.** `$.ui.open({ columns: 34 })`; the dock adds its divider, so it is
  35 wide, the mockups' exactly. Measured in a 200-column capture: the divider
  at column 165, the panel 166–199, text 167–198 (32 columns), the same cells
  as the mockup frames. Below the dock's floor or a width the person dragged,
  the layout follows `bodyColumns`.
- **Header.** The brain as an 18 x 6 Raster, two blank columns, then
  `COUNTERPARTS` (a Button: a plain click opens the dashboard), the day, the
  count and the search box, on the mockup's rows. The search box is one row a
  shade above the panel (`#121a22`) with `⌕` and an `Input` whose placeholder
  `search` the engine draws dim (Mike's "subtle search box with a fainter
  placeholder"). With the brain off, the header is the mockup's two lines: `◉
  COUNTERPARTS ↗` and the day; the search box and the count. The `◉` takes the
  stage colour of whatever just fired. At 200x60 a blank row sits above the
  header (a body of 44 rows or more), at 160x48 none, as in the mockups.
- **The body** is one `Client` surface module (`hooks/body.tsx`) drawing the
  lines `hooks/sections.ts` lays out. Every row carries the key of the item it
  belongs to; a click posts that key to the hooks module, which opens, closes
  or reads. No Buttons in the body: the engine inverts a Button under the
  pointer (v0.1, plumbing question 3), and the mockups have no hover look.
- **Memories ──── 10:25**: the recall block's "Came to mind" lane for the
  person's last message that had one, titles in full (wrapped to three lines),
  no dots. The block names a surfaced memory by its gist only
  (`core/recall/render.ts` writes `- <gist>`; a footnote is `- <title>
  [id]`), so its title comes from the dashboard: the `recall.decision` row
  for this session's turn (`/api/activity?name=recall.decision&limit=8`, its
  `surfaced` ids), then `/api/memory?id=` for each. Until those land, or with
  the dashboard down, the gist stands: it is what Claude read. No surfaced
  memory: no section, and the time moves to Subconscious. The time is a
  12-hour clock with no am or pm, as the mockups have it (every time shown is
  recent), or `Oct 9` before today.
- **Subconscious ────**: the "Quietly available" lane, up to four, one line
  each, cut with `…`. A `recall` call this session made with that id (or a
  handle that is its id or its title), seen at `tool.call`, adds `↗ opened`.
- **Saved this session ──── N**: what `note`, `session_end` and `chapter`
  saved this session, newest first, each with its stage dot on its first line
  only (Salience's cyan for a new memory, Reconsolidation's lilac for an
  update), wrapped lines back at the left edge, titles to two lines. Never cut
  to one line each: when they don't all fit, fewer show, each keeping its two
  lines (twelve at most; the heading counts them all). An update
  (`updates: <id>`, unless `how: open` or a held settle) adds `replaces <old
  title>`, the old title read from `/api/memory?id=`; unread, `replaces an
  earlier memory`. The v0.1 toast on a kept note is gone: the pane, the strip
  and the tail say it.
- **Mechanisms today ──── times fired**: the twelve in the website's order;
  half-height bars (`▄`, `▖` for a half) in the stage colours at 0.84, the
  longest at 12 cells; a zero dim with no bar; Schemas `○ not built yet`.
  Counts: `firedToday` from `/api/mechanisms` (below). A click on one lists
  its newest firings from `/api/mechanism?id=` (one read, 6–8 KB), grouped
  (`faded at 8:07:`), each title on up to two lines (no bullet between
  firings, so a wrapped line draws a shade softer than a firing's first);
  each opens in place like a memory. No tagline, no link.
- **Last Dream ──── 8:15**: the newest dream from `/api/dreams?limit=1`, its
  first sentence in italic, full width; its time is its `dream.journaled`
  row's. A click opens a few more lines of it (to nine, cut at a word) and
  "what changed last night:" (merged near-copies, patterns written down,
  pairs linked, outdated memories replaced, from the dream's counts; how many
  memories faded and became core, from the `band.transition` and
  `band.promoted` rows of its lived day).
- **Footer (variant B)**: a faint rule, then `● Counterparts  ● Claude
  memory`, `view ● sidebar ○ strip ○ quiet`, `brain ● turning ○ still ○ off`;
  each dot and its word one Button. What a click on either memory switch does
  shows, while it is hovered, in a card drawn `position: absolute` over the
  two rows above the rule (`display: none`, revealed by its hover group), so
  nothing moves under the pointer; its words are whole sentences in those two
  rows at 32 columns (a test per folder state). No card while the pause
  confirm or a note shows: those rows are the confirm's [Pause] [Cancel], and
  the pointer is still on the switch it just pressed. The pause confirm and a switch's note draw
  as rows just above the rule, pushing the body up; the paused banner sits
  under the header.

### Opening things

- **In place, or on the dashboard.** An item opens in place when its text
  takes at most **12 lines** at the pane's width (about 350 characters;
  `sections.ts#EXPAND_MAX_LINES`), plainly: its title in full, bold; its
  text; `fact · learned Oct 9`. Longer, a click opens its card on the
  dashboard (`#memories?id=<id>`, a route this change adds to the Memories
  page) and nothing opens here. **Measured** on 77 of the live store's newest
  memories: the median text is 626 characters (about 20 lines), so about one
  in nine opens in place. That is the threshold doing what Mike asked, and
  the first thing to judge by use. Measured again in review (2026-10-10,
  the newest saved memories of three sessions): 2 of 29 open in place, so a
  click on a saved item nearly always opens a browser tab. An opened item
  closes itself after a minute. At a short pane the `open` ladder can still
  cut an in-place text to 8 or 5 lines (`textTo`), with no link to the rest
  (no link, by decision).
- **The reads.** The text comes from `/api/memory?id=`
  (`views/memory.ts#memoryDetail`): `readProse`, `row`, `physicsOf`,
  `reveal`, all reads; the dashboard's source is typed so a write method fails
  `tsc` (`source.ts`, `guardWrites`); a confidential body comes back withheld.
  Never the `recall` tool, which counts a deliberate look-up and records what
  it showed for crediting.
- **A section's heading** is a click too: it gives that section the room (it
  folds last and shortens only after every other section has folded); again,
  and it is back as it was. Its costs, from the review: a click on a heading
  that isn't folded changes nothing you can see, but the next click undoes
  it; the focus never closes by itself (an opened item does, after a
  minute); and Last Dream's heading opens the dream while it is unfolded
  (its key is the dream's), unlike the others.
- **Folding.** `layoutBody` takes the least folding that fits, with a blank
  row between sections, else without; then opens again any fold the last one
  made unnecessary (compose3.ts's ladder, less its "saved 1 line each"
  step): saved items go fewer, one at a time, each keeping its two lines,
  then the section folds to `Saved this session ──── 9 ›`; the dream
  shortens; the subconscious shows fewer; the chart and the memories fold
  last. An opened item keeps its room longest (its text gives way only after
  the chart and the dream have folded), and is never folded away. An opened
  dream: the chart folds, then the saved list goes down to two, then the
  excerpt shortens (to 7, 5, 3 lines), then the last two saved go.
- **Search** is v0.1's (Enter is a `recall` in facts mode), restyled: the
  results take the sections' place under `“query” ──── 2 found ✕`, each title
  and what it is; a click opens its excerpt in place; a click on the heading
  clears it.
- **Dashboard tabs: a link opens a new tab, as before.** Reusing an open
  dashboard tab was looked at and not built. A browser lets no page bring
  another tab forward: `window.focus()` from the open tab is ignored without
  a click in it, so a BroadcastChannel hand-off (the new tab posts its address
  to an open one and closes itself) would close the new tab and leave the
  person on whichever tab sits beside it, the dashboard not shown; and a tab
  the OS opened (`open URL`) is not script-closable in every browser. macOS
  AppleScript can find the tab and activate it, but it asks for the
  Automation permission ("…wants to control Google Chrome") and is a script
  per browser. Neither is small and permission-free.

### Seeded, on the first dashboard read

A resumed session (`claude --resume`) starts this module over with nothing
seen. So on its first read, while it has seen nothing, the sidebar fills
Memories and Subconscious from this session's newest `recall.decision` with
anything in it, and Saved from this session's `gate.deposit` rows (with a
settle's `holds`/`over` for `replaces`), titles from `/api/memory?id=`. All
reads. `COUNTERPARTS_SIDEBAR_SESSION=<id>` names another session instead, for
a preview or a check: term-loop's sessions send no message, so its shots use
it (the side-by-sides used two of Mike's sessions of 2026-10-10).

### Mechanisms today: the dashboard's count

`/api/mechanisms` now carries `firedToday` on every light and the day it
counts (`today`): the rows that proved the mechanism on the person's
calendar day (`store.today()`, the zone's local date of each row's `at`),
counted as **rows, not amounts** (a flush that wrote 8 links is one firing of
Association; a deposit of 3 memories one of Salience), a dream's
`dream.journaled` and `dream.changed` rows one firing (`firingKey`: `dream.*`
under one `ref`). The calendar day, not the lived day: a lived day can start
after midnight, at the day's first sleep, and "today" in the sidebar is the
date on the clock. Computed from the seven-lived-day window's rows the view
already reads (30–50 ms on the live store). Tests:
`test/dashboard-mechanisms.test.ts` (one pins the zone: a minute either side
of Honolulu's midnight, both on one UTC date), `test/mechanism-evidence.test.ts`.
Events only: master's decay `census` (2026-10-10) adds a part to a light,
never a row, so it is not counted; a trial merge of the two conflicted only
in CHANGELOG.md and passed the mechanism and dashboard tests.

A dashboard older than this (0.3.16, Mike's install until the next release)
says no `firedToday`. The sidebar then counts from the feed itself on a cold
read: each event name's newest 150 rows, read twice as deep while every row is
still today's, to at most 1,200, classified by `feed.ts#RULES` and counted the
same way (`countToday`); polls add what arrives. On 2026-10-10 that was about
290 turns. The cold read is then heavier (up to a few MB from localhost, once
per cold read); it goes away with the new dashboard.

The sidebar re-reads `/api/mechanisms` when a poll brings a row that proves a
mechanism, and on the first poll after this machine's date changes, rows or
none (the dashboard's `today` is its store's zone, so the check is the day
the counts were last read on this clock, not that). The older-dashboard
cold read counts rows only up to the seq the polls then go on from, so a
row landing during it is counted once. Measured against the live 0.3.16
dashboard in review: the cold read is about 5.5 MB in about 24 requests
(about 0.2 s; every `/api/activity` answer carries about 16 KB of
vocabulary), a warm poll about 19 KB and 38 ms.

### Views, the tail, and the status line

- **sidebar** is the pane. **strip** closes it and draws ONE line in the band
  above the prompt: `◉ 2:10 stored: <title>` (the `◉` in the stage colour, the
  time dim, the verb mid-grey) and, at its right end, `│ ○ sidebar ● strip ○
  quiet` (Buttons; the engine adds its `[-]`). It reads nothing and draws no
  brain. **quiet** closes it and draws nothing above the prompt.
- **The tail**: the newest thing in plain words (`remembered: <title>`,
  `subconscious: <title>` when nothing was said in full, `stored: <title>` or
  `stored 3 memories: <first>`, `opened: <title>`, `dreamed: <first
  sentence>`) as the `PromptHint` site's `tail`, which the engine draws dim
  at the end of its own line, its pills live. Shown while the pane is not
  showing, **not in the strip view** (the strip says the same thing one line
  up; Mike's rule on the dashboard is to show each thing once), and not while
  the folder is paused or off (the amber line says that). An unasked pane
  this surface could not place says `/counterparts opens the sidebar` there,
  until it draws.
- **The status line is only a warning** now: a folder paused (`⏸
  Counterparts memory paused in this folder · /counterparts resume`, or
  `resume it in <dir>`) or off, in every view. Nothing otherwise: no day, no
  counts, no fps (that is in `/counterparts fps`'s reply only), no "Claude
  memory off" (the footer says it; the line adds it only beside a pause).
  **Measured: clearing it gives the row back.** A probe mod that set a status
  line, cleared it (`$.ui.status(undefined)`) and set it again, captured
  three times in term-loop at 200x60 (Claude Code 2.1.296): set, the prompt's
  top rule was on row 56 and the amber line on row 59; cleared, the rule moved
  to row 57 and the hint line sat right under the prompt; set again, the rule
  went back to row 56.
- **Migration.** A stored view from v0.1 reads as: `full` (or none) the
  sidebar; `quiet`, `rail` and `hidden` quiet. Opening the pane writes
  `sidebar`, unasked opens included (a v0.1 copy writes `full` back when it
  opens; each reads the other's word as the pane), and a choice writes
  v0.2's word. v0.1 reads a stored `strip` as its full pane and v0.2's
  `quiet` as its narrow quiet pane, so after a v0.2 close a v0.1 session
  opens narrow rather than closed; left so (v0.1 is a trial copy). Both
  write one key at a time, so neither drops the other's (`brain`, `caps`,
  `fpsShown`, `rail`). The pane's `✕` (a close by the person) goes to
  quiet, for this session and the next.

### The brain

- **18 x 6, dim at rest.** Unlit cells draw at 0.72 (`FrameOptions.dimRest`,
  the mockups' factor); while a region is lit, the rest at 0.6. No tag (no
  room for a name at this size). The Raster's cells take the terminal's
  default background, so the panel's own colour shows through: measured, the
  engine draws a Raster's colours at 4 bits a channel, and the panel's
  `#05080c` came out `#000011`, a navy box around the brain; with the default
  background the cells capture as `5,8,12`, the panel.
- **turning** (the default) **sways** rather than turning all the way round:
  at 18 x 6 the front and back views lose the brain (a rounded skull-like
  outline; the sheet of fourteen yaws is
  `~/counterparts-notes/mockups/2026-10-10-mod-build/brain-views-18x6.png`),
  while the sway, side to three-quarter, keeps it. It is v0.1's timer:
  calm (6 a second) while it sways, a burst while an arc flies, and no timer
  after a quiet minute until something fires or the pane opens. The task's
  "slow rotation" is this, said plainly in the report.
- **still**: a fixed view (the sway's centre), no timer at all. Something
  firing lights its region (`Brain.flash`) in the pane's next drawing, and
  the drawing 2.6 s later puts it out (`Brain.dark`): two drawings an event.
- **off**: no Raster; the header is two lines.
- **CPU** of the `claude` process (`top`, 30 s windows; term-loop at 200x60,
  the pane drawn, the dashboard polled every 15–30 s while Mike's other
  sessions wrote events; load average 3–7, one window at 10; four runs, the
  last from a frozen copy with nothing edited during it, since a
  `--plugin-dir` working tree hot-reloads on every edit and the earlier runs'
  odd windows lined up with edits):

  | Mode | CPU | v0.1 |
  |---|---|---|
  | turning, swaying (the minute after an open or an event) | 1.2–4.5% | 2.8–4.2% swaying |
  | turning, at rest, in a fresh session | 0.1–0.8% | 0.3–1.2% |
  | turning, at rest, after a slash command | 1.6% | — |
  | still | 1.0–2.2% | — |
  | off | 0.7–1.7% | — |
  | quiet (no pane, no reads) | 0.6–1.6% | 0.6–0.8% quiet, 0.7% hidden |
  | a static probe pane (no Counterparts) | 0.3–0.5% | 0.6% no plugin |

  Still and off run no timer. At rest, the brain's mode makes no difference
  the measurement can see: turning at rest measured as low as 0.1% in a fresh
  session and 1.6% once the transcript held a command's output, the same as
  still and off (whose windows all came after the command that set them).
  Read it as: idle, about 1–2% whatever the mode (the polls and their
  redraws, and the session's own); turning adds two or three percent for the
  minute it moves after an open or an event.

### Where the build differs from the mockups, and why

- The round-3 decisions win over the round-3 PNGs: two headings (Memories,
  Subconscious) instead of "On Claude's mind" with `memories:` and
  `subconscious:` labels; stage dots on saved items.
- The brain's lit region shows only for 2.6 s after something fires; the
  mockups froze a lit moment.
- An opened memory: the mockup `c` opened a 684-character memory in place;
  with the 12-line threshold that one opens the dashboard instead (shot `c`
  opens a saved 328-character one). At 160x48 the shot clicks `Saved this
  session` first: the item is the fifth saved one, folded away otherwise.
- Live data: words, counts and which sections have anything differ. Every
  count in the shots came through the older-dashboard path (Mike's 0.3.16
  dashboard has no `firedToday`), and a long item's dashboard link lands on
  the Memories page there, not on the memory, until the release.
- The paused state (`g`) was not shot live: a shot would mean pausing a folder
  in Mike's live registry. The tests cover it.
- From the review (2026-10-10): saved items never go to one line each (the
  round-3 ladder's first step), by Mike's rule that fewer readable items beat
  more cut ones; an opened dream keeps its excerpt while the saved list goes
  down to two (the round-3 order cut the excerpt first, which with two-line
  items cut it to five lines beside eight saved ones at 200x60); a
  mechanism's firings wrap to two lines, the second a shade softer (the
  mockup cut each to one); the hover words are shorter, to fit their card.
- "Claude memory off" shows only in the footer while the pane is open, and on
  the amber line only beside a pause: closed, nothing says it (v0.1's status
  line did, in every view). By the round-2 rule (the amber line only for a
  paused or off folder); worth Mike's look.

### Footprint of the build's runs

Mike's shared sidebar store read `view: "full"` before the runs and reads
`view: "sidebar"` with a new `brain: "turning"` after: the same view and the
default brain to both versions (term-loop compares them by meaning, so it put
nothing back). No other key moved; the Counterparts and Claude memory
switches were never clicked. The review's five runs (2026-10-10, from frozen
copies, `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`) found it reading
`{"fpsShown": true, "rail": false, "view": "sidebar", "claudeMemory": true,
"brain": "turning"}` and left it so after each; they hovered both switches
and clicked neither.

### Not done, assumed

- The strip's buttons were pressed in the test kit, not clicked live.
- The hover cards' reveal is the surface's; the test kit draws them hidden.
  Seen live in review: hovering either switch shows its card over the two rows
  above the rule, and nothing in the footer moves (`hover-cp`, `hover-mem` in
  the shots' folders).
- Inline above the prompt (the main screen), the layout is held to 64 columns.
- **The search box's placeholder is not fainter.** Measured (Claude Code
  2.1.296): the engine draws an `Input`'s placeholder `#999999`, brighter
  than the day and count beside it (`#66717c`) and than the `⌕` (`#8e98a2`);
  `Input` takes no colour. Drawing our own dim word and the `Input` only
  while the pane holds the keyboard would change where the keyboard goes
  after any click in the pane; not done.
- The desktop has no Raster: it draws the brain-off header.

# v0.1 (2026-10-09/10), the record

What follows is v0.1's. v0.2 removed the ACTIVITY list (and `list.tsx`, its
"+N from other sessions" line and the kept toast), the legend of twelve, the
42 x 14 brain and its tag, the switch tracks and their caps, the quiet pane
and the hidden view, and the status line's day and counts; the plumbing, the
switch's safety, the scope registry read, the brain's timer and the Claude
memory switch carry on as written here.

## Layout, and why

- `hooks/hooks.json` names the module under `"modules"` beside the five classic
  hooks; the root `plugin.json` names the state contract (`"types"`).
- `hooks/sidebar/` is a plugin root of its own (a `.claude-plugin/plugin.json`
  also named `counterparts`, so the `$.state` keys match either way).
  `claude plugin test <dir>` runs every `*.test.ts` under `<dir>`; at the repo
  root that would include the 154 bun test files, which can't load in a mod's
  environment, and the runner refuses a folder with no `hooks/hooks.json`.
- `bunfig.toml` sets `[test] root = "./test"`, so `bun test` never picks up the
  mod's tests. It ran 5,534 tests across 164 files on 2026-10-10, the
  sidebar's drift test among them (`test/sidebar-mechanism-drift.test.ts`).
- The engine's declarations (`.claude-plugin/types/`) are generated per build
  and gitignored. `check.sh` lays them for `tsc`, from the copy a
  `--plugin-dir` session wrote or from the plugin-authoring skill's copy.
- The engine lets `$` pass only to functions declared at the top of the same
  file, so `register.tsx` holds everything that touches the engine. `brain.ts`,
  `cells.ts`, `feed.ts` and `mechanisms.ts` are pure.

## The plumbing questions

| # | Question | Answer | How |
|---|---|---|---|
| 1 | `hooks.json` holds both `"hooks"` and `"modules"`; validate is clean; the classic hooks are still listed | **verified** | `claude plugin validate` passes. Its one warning (CLAUDE.md at the plugin root) is on master too. A `-p` load of the whole plugin registered the five command hooks, ran SessionStart's `plugin-run.sh`, and loaded the module with its seven hooks. |
| 2 | Raster refusal: braille, background colours, Powerline caps U+E0B6/U+E0B4 | **verified**: all three pass; a wide character (U+4E00) is refused and the refused tree draws nothing | `claude plugin test` with mounted Rasters. **Painting** is the font's: Mike's iTerm2 drew the caps as `?` boxes, so the switch ends are half blocks (`▐ ▌`) by default, and `/counterparts caps` turns on the round caps for a terminal that draws them. |
| 3 | How the switches become clickable | **verified**: a `plain` Button whose children are Text cells carrying `backgroundColor` validates on terminal and desktop, and a press reaches it. But the engine inverts a Button under the pointer, which lit row after row as Mike moved the mouse. So the ACTIVITY list and the search results are a `Client` surface module (`hooks/list.tsx`) that reads its own clicks (`onPointer`) and has no hover look. The switches and the legend stay Buttons. | The test kit, plus live in tmux: a mouse move over a row leaves it as drawn, while a move over a legend Button inverts it. |
| 4 | `$.http.fetch('http://localhost:4747/api/...')` from a mod | **verified**: 200 for `localhost` and `127.0.0.1`, so the Host allowlist passes. A dead port rejects (`ECONNREFUSED`), and the sidebar then says to start `counterparts dashboard`. | A probe mod under `-p`, then the real pane in a tmux-hosted session showing live day, count and activity. |
| 5 | `$.mcp.call` target | **verified, each side apart**: the npm server's tools are `mcp__counterparts__*` and are called as `counterparts`; the plugin's are `mcp__plugin_counterparts_counterparts__*` and are called as `plugin_counterparts_counterparts` (`plugin:counterparts:counterparts` works too). `$.mcp.connect('counterparts')` answers with the plugin's server even when it has stood down with no tools, so the target is read off `$.tool.list()`, npm first. **Assumed**: both connected at once, Mike's case (a unit test covers the choice). | Probe mods with a fake MCP server, one name at a time. |
| 6 | Re-opening the pane with fewer `columns` narrows the dock | **verified, with a floor**: at 200 columns, `columns: 44` gives a dock 45 wide, and re-opening with `columns: 5` narrows it to **24**, not 7. Opening at 44 again restores 45. **Assumed** from the docs: a width the person dragged wins. | Real session in tmux. |

Found on the way (each **verified** unless marked):

- **`$.mcp.call` goes through the permission check** and can open a dialog
  ("Tool use · from the counterparts plugin … Yes / No"). The debug log shows
  `$.mcp.call` → `$.tool.call` → permission. The 2.1.295 and 2.1.296 doc
  comments both say "No permission prompt". So the sidebar calls the server
  unasked only when `$.tool.check` says `allow`, and a press may ask, because
  the person just asked. The dialog offered only Yes or No. An allow rule for
  `mcp__counterparts__recall` ends the asking for search. **Not for `scope`**:
  with that rule the model could pause or turn off folders unasked. **Auto
  mode, measured in round 1:** a plugin's call skips the auto-mode classifier
  and raises no dialog. But `$.tool.check` doesn't answer `allow` there without
  a rule, so an unasked read gated on it is never made: on Mike's machine a
  session started in a paused folder showed `?` until clicked.
- **So where the folder stands is read from the registry file, not the tool**
  (since 2026-10-09). `hooks/scopes.ts` copies the core's rules: the file is
  `scopes.json` beside the configuration the wired hook names (its own
  `--config` after the hook, in the user's settings and then this folder's;
  else `COUNTERPARTS_CONFIG`; else `~/.counterparts/claude-code.json`), the
  longest ancestor governs, segment-aware, both sides realpathed with
  `$.fs.stat({ resolve })`. `$.fs` is used read-only, and no event is logged.
  That `$.fs.read` raises no permission check is from the engine reference
  and the coordinator, **not measured** here: if it ever did, the start read
  would quietly go back to `?`. If both the user's settings and this folder's
  wire our hook with different configurations, the core runs both and the
  sidebar follows the first found (the user's). Before `session.start` (the
  band can draw first) there is no folder yet, and the state is left unknown
  rather than marked unreadable, so the first state shown is a real read. It is read at session start, on every dashboard poll while
  the pane is drawn, once a minute otherwise (hidden, quiet, or not shown),
  and on every `/counterparts`, so a pause made in another session shows here
  within a poll, or within a minute with the pane hidden. The `scope` tool is
  used for writes (after the confirm, and resumes), and for a read only when
  the file can't be read and the person pressed. **Assumed:** that
  `COUNTERPARTS_CONFIG` set in a settings `env` block reaches `$.env.get` (a
  configuration named only there would be missed, and the default read).
- The recall block arrives at `session.append` as door `hook-context`, name
  `hook_additional_context`, origin `{ kind: 'hook', event: 'UserPromptSubmit' }`,
  inside a system reminder (a `-p` run with a settings hook printing a block).
- Claude memory: `prompt.context` lists MEMORY.md as an instruction file of kind
  `memory`. Filtering it out on the way down makes core re-render `claudeMd`
  without it, and the stored first message lacks it. `prompt.section` `memory`
  fires and takes `{ text: null }`. **Assumed** from the docs: invalidating both
  takes effect from the next message and busts the prompt cache once.
- The engine heads every plugin status line with `⚠ <plugin>:`, so the line
  drops the name ("◉ day 18 · 782 memories · 1 kept").
- The dark theme fills a docked pane with a grey (256-colour 235). The
  transcript keeps the terminal default.
- A `--plugin-dir` folder hot-reloads in an interactive session. On a reload
  `session.start` runs again, the timers start over, and `$.state` survives.
- An unasked pane waits undrawn below 144 columns (**assumed** from the docs).
  The status line then says `/counterparts opens the sidebar` until the pane
  draws.
- Whether a surface docks a pane is known only to a drawing (`e.viewport
  .isFullscreen`), never at `session.start`. So the module hooks the band above
  the prompt, draws nothing there, and opens the pane from that band's first
  drawing, only when it docks. Live in tmux, the fullscreen layout opened it by
  itself, and the main screen did not.
- A pane closed by hand (`ui.close`, origin `person`) stays closed for the
  session, across a hot reload too (live). The test kit can't raise that event.
- **A pane opened again is drawn from the terminal's settled evaluation**
  (debug log: "terminal reuses its settled evaluation"). The module's render
  hook doesn't run, so the brain stopped at the close stayed frozen after
  `/counterparts`, until a width change (the rail and back) forced a drawing.
  Every open now asks for a fresh drawing (`$.ui.invalidate('ui.render')`).
  The brain's timer is also generation-guarded: a late answer to a blit from a
  timer since replaced can't stop the current one. A refused blit asks for a
  fresh drawing, up to three times until a blit is taken again. Live: close
  and reopen twice, and the brain kept turning.
- Inline above the prompt (the main screen, or a dock under 110 columns), the
  pane's body is the terminal's full width, so the brain is held to 30 x 10
  there. The review measured 7.5% CPU inline before this.
- **The plugin beside npm, from a folder** (`src/adapters/plugin.ts`,
  `pluginOrigin`). Under `--plugin-dir`, the stand-down line used to say "run
  `counterparts disconnect`". That would have left the live memory wired to a
  development copy, and every session without `--plugin-dir` memoryless. A
  plugin root outside Claude Code's plugins directory, and not the recorded
  `installPath`, now says it is expected beside the npm install, with nothing
  to do. The stood-down server tells the model the same, and not to suggest
  disconnecting. A real install keeps the advice, marked optional.
- **`/counterparts:doctor` beside the npm install.** Run from the plugin while
  the npm wiring is live, it used to show the plugin copy's doctor: a different
  version, or a development folder. Now `plugin-run.sh cli` marks the console
  as the plugin's, and `doctor` first says the plugin is standing down. It then
  runs the wired install's own doctor: the runtime and the install of the live
  hook (else the live server) in settings, with `cli/bin/counterparts.ts` beside
  that entry, and its `--config`. PATH's `counterparts` is used only when the
  wiring can't be read that way, since PATH may find a different install.
  Failing both, it says to run `counterparts doctor` in a terminal.
  `test/plugin.test.ts` runs this through the launcher with a stand-in
  install.

## The frame rate and the load, measured

The brain (rebuilt in the brain lab, `tools/brain-lab/`, 2026-10-09; rounds and
measurements in `tools/brain-lab/out/round-*/NOTES.md`) repaints on
`$.clock.every(1000 / target)` with `$.ui.blit`. The target is **12**, which is
the most it draws. Each tick, the brain says how much to draw:

| Mode | When | Draws |
|---|---|---|
| burst | a pulse's arc is flying (about 1.75 s) | every tick: 12 fps |
| calm | it sways, or a glow fades | every other tick: 6 fps |
| rest | nothing has fired for a minute | nothing; the last frame stands |

It sways 16° either side of 18° (side view to three-quarter) over 40 s. At its
fastest, a pole of the 42 x 14 brain moves a quarter of a braille dot a frame.
After a quiet minute it eases into 18° and stops; it eases back out when
something fires.

The brain keeps its own clock, the sum of the ticks' `dt`, never less than one
tick's interval. So it moves with the ticks that draw it, a test's fake clock
included.

`frame()` hands back the standing frame when nothing has moved a fifth of a dot
(no `fresh`). `tick` then sends no blit at all. Swaying at 6 fps, about 4.5
frames a second change. 45 of the 42 x 14 brain's 588 cells change a frame,
against 255 before the rebuild.

**What `/counterparts fps` reports, and how to read it:**
- **"fps achieved"** counts blits taken over the last 10 s, and only frames that
  changed are blitted. Expect about 4.5 while it sways, 0 at rest, and up to 12
  during an arc.
- **"A frame takes N ms"** averages the last 120 frames asked for. That
  includes frames the cache answered in microseconds, so it reads low. The cost
  of a frame drawn afresh comes from `bun tools/brain-lab/bench.ts`.
  At load average about 7, it measured 0.99 ms at 42 x 14 (the old brain 1.46),
  0.62 ms at 30 x 10, and 5.3 ms at 90 x 32.

`/counterparts fps <1-30>` sets the target (the burst rate), which is kept.
Calm draws every `round(target / 6)`-th tick: 6 fps at the default 12, 5 at
15. Setting the target restarts the
timer from the command's own `$`, which works live, as do the 30 s auto-closes
started from a press.

**Before the rebuild** (the point-cloud brain at a fixed rate, measured in a
tmux-hosted session at 200 x 60 and 256 colours):

| Target | Achieved | Frame compute |
|---|---|---|
| 10 | 9.1 fps | 6.2 ms |
| 15 | 13.7 fps | 2.6 ms |
| 6 (then the default) | 5.5 fps | 3–8 ms |

CPU of the `claude` process, idle, from `top` over 10 s. The rebuilt brain was
measured live after the merge, in tmux at a load average of about 7, so those
two rows are noisy:

| State | CPU | Earlier |
|---|---|---|
| Pane drawn, swaying (timer at the calm rate, 6 a second) | **2.8–4.2%** | 4.4–4.6% with the timer at 12 a second; 3.5% (the old brain at a fixed 6 fps); 6.1% at 10 fps (the review's measure) |
| Pane drawn, at rest after a quiet minute (no timer) | **0.3–1.2%** | 0.8–1.4% with the timer still ticking |
| Quiet (`‹`) | 0.6–0.8% | 1.6% on the old rail (timer ticking with nothing drawn) |
| Hidden (`✕`) | 0.7% | — |
| No plugin | — | 0.6% (the review's measure) |

**The timer keeps the brain's pace** (`register.tsx#tick`):
- it ticks at the calm rate (`round(target / 6)` ticks of the target: 6 a
  second at 12) while the brain sways;
- it re-paces to the target only while a pulse's arc is in flight (a read
  that proves several mechanisms sends their arcs 300 ms apart, which keeps
  the burst up to 0.9 s longer; below, "One event lights every mechanism");
- it stops altogether at rest.

A pulse, a picked mechanism or the sidebar opening full wakes it. Each of those
draws the pane, and the drawing starts the timer. Opening full also calls
`Brain.wake()`, the one line added to `brain.ts`, and the brain eases out of
rest as it does after a pulse. Every re-pace is a new timer under a new
generation, so a late answer from the old one changes nothing.
`/counterparts fps` says which it is now: "swaying (6 fps)", "in a burst (12
fps)", or "at rest (no timer)". Measured live in tmux, at a load average of
5–7.

Nothing runs until the pane draws. The brain's timer stops when a blit is
refused (the Raster is gone: quiet, hidden, another pane shown) and while the
pane holds the keyboard (typing a search), and the next drawing starts it again.
The quiet and hidden views run no timer and read nothing: their list and counts
move only with this session's own events. The quiet view's `◉` lighting up is a
one-shot after an event.

The dashboard is read only while the pane is placed and shown (`$.ui.panes()`):

- **Cold** (first drawing, or after a 10-minute gap): `/api/pulse` (about 130 ms
  of the dashboard's time; it reads up to 20,000 log rows and counts memories),
  then `/api/activity?name=` for each of the 18 events that prove a mechanism
  (about 20 ms each).
- **Warm**: `/api/activity?sinceSeq=` (about 23 ms) every 15 s, or every 30 s
  after four quiet reads. The pulse is read again only when a new event changed
  the count or the day.

A follow-up for the dashboard: a cheap `lastSeq`-and-count read. Today every
activity reply also carries the 15 KB event vocabulary.

Mike's first real run is the real measurement.

## Where the design changed, and why

- **The sidebar paints its own background** (`#05080c`, the mockup's black),
  the brain's empty cells included. The dock's grey made the navy glow read as
  a dark box. In a light theme the palette would have been unreadable. The
  glow itself is gone since the brain lab: a cell has one background, so a
  radial glow steps.
- **Search runs on Enter, not on every keystroke.** Each `recall` writes a count
  row (it counts under Retrieval's "deliberate look-ups") and the "shown this
  session" bookkeeping. Typing "publish" would have made seven.
- **Typing in the search field is light.** Mike found it janky. What a
  keystroke cost, measured from the debug log:
  - **Before:** one `ui.input` round trip to this module for the field's
    `onInput` (3–4 ms). Any drawing in between (a poll, a press) also drew the
    module's copy of the text back into the field, and computed a brain frame.
  - **Now:** the field has no `onInput` and is never handed a value back. A
    drawing reuses the last brain frame when nothing it shows has changed. The
    brain holds still while the pane holds the keyboard. The engine still
    dispatches `ui.input` per keystroke (2.3 ms), with nothing of ours to run.
- **Results read like activity:** kind over date (`memory`, `Oct 9`), the
  title beside them. Who said it shows only when it is known. There is no more
  "speaker unknown · status unknown". A click opens one: who said it, the
  excerpt, and `↗ open on the dashboard` (`#memories`: there's no open-by-id
  route yet). `← activity` sits on the results' header, and `✕` in the field.
- **Links open on a plain click.** A `Link` is OSC 8, which iTerm2 opens only on
  ⌘-click. The list's `↗` line posts the URL to this module, which runs `open`
  (macOS) or `xdg-open` (Linux), found once with `uname`. On Windows (no
  `uname`) it runs `rundll32 url.dll,FileProtocolHandler`, never `cmd /c start`,
  which would read `& | ^ %` in a URL as its own. Only the dashboard's URLs open,
  and only in a strict character set (`[A-Za-z0-9#?=/_.~-]`), so the v0.2
  `?id=` links stay safe. Verified live: `$.process.run` asks no permission.
- **Widths are terminal cells** (`hooks/width.ts`). Wrapping, cutting and
  padding count a CJK character or an emoji as two cells and a combining mark
  as none. Before, a title with wide characters wrapped on screen and shifted
  every clickable row under it.
- **The search field keeps its text across a redraw** (live in tmux). It held
  "publish" through a Pane redraw from a mechanism press, and again through
  the 30 s auto-close.
- **ACTIVITY speaks for this session.** This session's events are in the
  sidebar's words ("kept · <title>", "3 came to mind" with the titles under
  it). The night's (dreamed, faded, merged, settled by a dream) keep the
  narrator's. Other sessions' fold into one dim line ("+29 from other
  sessions"). Whose an event is comes from:
  - its `session` detail;
  - `actorId`, for a settle a session made.

  A look-up (`mcp.recall`, the sidebar's own searches included), a reminder
  (`prospective.plain` / `.fire`) and a link flush (`associate.flush`) carry
  no session yet. One of those from after this session began counts as this
  session's; one from before, as another's. With two sessions running at
  once, the other's look-ups and flushes can show here. (v0.1 said a flush was
  placed by its `sessions` detail. Core writes none: the live keys on
  2026-10-10 were reason, day, dayFrom, claims, passes, pairs, rows, blocked,
  evicted, swept, dropped, pendingDropped, corrupt, stuck, oldestMs, and a
  `contiguity` object whose `sessions` is a count. That branch never ran and
  is gone.) **Core follow-up:** add `session` to the `mcp.recall`,
  `prospective.*` and `associate.flush` payloads; the `session` read already
  in `classify` then places them, and the sidebar can stop guessing.
- **One event lights every mechanism it proves** (2026-10-10). v0.1 gave each
  event one mechanism, "first wins", while core's table
  (`adapters/mechanism-evidence.ts`) lets one event prove several. So Emotion
  and Gist never lit, though live 7 of the last 40 turns had a mood match and
  10 of the last 21 dreams wrote a gist. Interference and Consolidation missed
  a dream's merges, and Interference a settle `changed`. Now:
  - **one row an event**, as before. Its own mechanism (`mech`, the first
    rule in `RULES` that holds) gives its word and colour: a dream's row is
    still "dreamed" in Dreaming's lilac, a turn's still "recalled". Every
    mechanism that holds is in `mechs`, its own first (contract:
    `types/index.d.ts`). An opened row says the others in the legend's names:
    "also Emotion", "also Gist · Interference · Consolidation";
  - **every mechanism pulses, a little apart**: the first at once, the rest
    300 ms after one another, so each arc reads as its own. Two that draw the
    same arc (one region in one stage colour: Dreaming and Consolidation, both
    the hippocampus in lilac) pulse once. A fifth shares the fourth's slot, so
    the last arc lands by 2.3 s, inside the legend's 2.6 s light. The burst
    (12 fps) lasts while any arc flies, so a dream's three arcs keep it about
    0.6 s longer than one; the calm and rest rates are unchanged. Done with
    `$.clock.after` in `register.tsx`; `brain.ts` is untouched;
  - **the legend lights each one** the read proved (`firing` holds a list now),
    and the brain's tag still names the newest row's own. A reload keeps the
    state, so a `firing` v0.1 wrote (`{ id, at }`) can be read by this code: it
    lights nothing (before that guard, it failed the pane's drawing for 2.6 s);
  - **a live came-to-mind row takes on its twin's** mechanisms when the
    dashboard's `recall.decision` for that turn lands (`mergeRows`). The
    recall block says nothing of mood, so Emotion lights for that turn one poll
    after the row appears (up to 15 s), not at once. That lag is expected;
  - **the conditions are core's too**: a `dream.changed` that changed nothing
    and suggested nothing proves nothing and is no row (core counts `applied`
    less suggestions, and the suggestions apart). A recall whose mood match the
    render trimmed to nothing shown is Emotion's row ("1 brought closer by a
    matching mood");
  - **not mirrored: `stands`.** Core stops counting a dream, or a settle, the
    owner undid. An `/api/activity` row carries nothing that says so. Separate
    `dream.undone` and `contradiction.undone` events exist (none in the live
    log on 2026-10-10), and could be matched to a row by its dream id
    (`subject`) or pair. Left out: a pulse lights when the act happens, and an
    undo comes later. An undone dream's row stays in ACTIVITY;
  - **a guard**: `test/sidebar-mechanism-drift.test.ts`, a bun test at the
    repository root, imports core's table and this `feed.ts` and fails when
    they disagree: by event name both ways, and by payload (a row lights
    exactly what core says it proves). Census-only evidence (emotion's lift,
    consolidation's returns, dreaming's reflections) has no event, so no row,
    and is out of its scope. It loads `feed.ts` by a dynamic import tsc can't
    follow: a static one would pull the mod's sources (extensionless imports,
    the engine's types) into the repository's `tsc`, which fails on them.
- **Esc doesn't clear the search.** By the reference, Esc hands the keyboard
  back to the prompt and never reaches a mod's Input (**assumed**: not pressed
  in the live run). Clearing is the `✕` beside the field, or an empty Enter.
- **2026-10-09, Mike's trial: a press meant for Claude Code's memory paused
  ~/random.** The label "Counterparts" beside "Claude memory" didn't say which
  memory was which, the press paused at once, and a folder whose state was
  never read drew as on. The folder stayed paused for about ten minutes; three
  ~/random sessions got no wake, no recall and no log lines (a paused folder's
  hooks return before logging). Since then:
  - the switches read **"Counterparts memory · this folder"** and **"Claude
    Code's own memory"**, one a line, and hovered each says what a click does
    in two lines kept for it under both switches (a fixed-height Box, overflow
    hidden; each row joins a hover group, `hover: { scope }`, that reveals its
    own lines there). The first version revealed the words inside the row,
    which pushed the Claude memory switch down three rows while the pointer was
    on the Counterparts one: controls moving under the pointer, where the
    misclick happened. **Verified** in the test kit: the words are drawn, the
    rows hold nothing hidden, and the room is fixed; the reveal itself is the
    surface's, **assumed** from the reference;
  - **an unknown state is never drawn as on**: a grey track with a `?`, and
    "state unknown · click to check" (or "checking…" while reading);
  - **a pause asks first**: a confirm row, "Pause Counterparts memory in
    ~/random for every session here? [Pause] [Cancel]". Only [Pause] calls the
    tool; Cancel, or 30 s, closes it. Resuming asks nothing;
  - **a paused folder shows everywhere**: an amber "⏸ Counterparts paused in
    this folder · click to resume" under the header (quiet view too), and the
    status line ("⏸ Counterparts memory paused in this folder · /counterparts
    resume") in every view, hidden included. `$.ui.status` takes text only, so
    the status line can't be amber: the ⏸ and the words carry it;
  - the folder is read from the registry file (above) at session start, so a
    session started in a paused folder says so before anything is drawn, with
    no permission rule.
- **The Counterparts switch shows four folder states, not two, and acts on only
  some of them.**
  - **States:** `on` and `unset` (on by default) draw on. `observer` draws
    "Counterparts reads only" on a darker track. `paused` and `off` draw off,
    and the list says PAUSED or OFF. Unread, it is a grey `?` (above).
  - **What a press does:** while unread, a press only learns the state. After
    that it asks before pausing a folder whose **own** entry is `on` or
    `observer` (the pause remembers which), and it resumes only its own pause,
    at once. One call per confirmed press.
  - **What it refuses, and says so** in a line under the switches, with the
    console command that would do it:
    - an `off` folder (no `resume` is ever sent to one; the line names
      `counterparts scope <dir> --on`);
    - an `unset` folder;
    - a folder that inherits its mode from a parent;
    - a folder paused by a parent.
  - **Core ask:** the `scope` tool (and the console) can set on, observer, off,
    pause and resume, but can't put a folder back to **unset**. Pausing an
    unset folder records `resumeTo: on`, and resuming then writes an explicit
    `on`, which silences the wake's "nothing is set here" question for good.
    The switch won't write that `on`, so for unset folders it explains instead.
    What fixes it: `pause` of an unset folder records `resumeTo: unset`, and
    `resume` deletes the entry.
- **The rail is gone: quiet and hidden instead.**
  - **Quiet** (`‹`): the dock's floor (24 columns), no brain, no reads. It
    shows a compact list ("● kept · Publishing…", "● 3 came to mind"), the
    counts, and a still `◉` that lights in the event's stage colour for a
    moment. `›` opens it full.
  - **Hidden** (the pane's `✕`, or `/counterparts hide`): the pane is closed,
    and the status line keeps `◉ 3 came to mind · 1 kept · /counterparts to
    open`. The engine already heads the line with `⚠ counterparts:`, so the
    name isn't said twice.
  - The view is kept for the session and in `$.store`, so the next session
    opens quiet, full, or not at all.
  - **The band draws before `session.start`** has read the stored view
    (measured live: band 14.636 s, `session.start` settles 14.784 s). The
    unasked open used to read this session's default (`full`), open full, and
    write `full` over the stored choice. It now reads the store itself. Two
    tests draw the band before `session.start`, and they fail with the old
    read. Checked live: quiet, and hidden, each survived a restart.
- **No slide animations.** The mechanism line and an opened row appear and
  close at once (still on a second press or after 30 s).
- The activity word column is 13 wide, because a recall row's word carries its
  count ("3 recalled").
- On a cold start, ACTIVITY asks `/api/activity?name=` once for each event that
  proves a mechanism (18 small reads). One `?limit=300` read was 290 KB and
  covered 40 minutes of mostly flow noise. Polling is above (the load).
- **Opened unasked only where it docks.** Inline above the prompt it would take
  the room, so on the main screen nothing opens and nothing is said
  (`/counterparts` is in the typeahead).
- **The status line names no dashboard trouble.** "Not running" is said inside
  the pane only. The line shows the day and count, this session's counts,
  paused/off/reads-only, and `Claude memory off` whenever that is off.
- **The Claude memory switch is one sticky preference** (`$.store`, every
  session). Each drawing reads the stored value, so a switch turned in another
  session never shows stale. A session with the pane drawn follows such a
  change within a poll (its prompt caches are rebuilt then).
- **The brain is line art, not a point cloud** (brain lab, 2026-10-09). The
  shape is 13 ellipsoids proportioned from Gray's lateral view, cast one ray
  per braille dot. It draws:
  - a bright rim, white-hot where it turns most edge-on;
  - the lateral fissure carved as a channel over the temporal lobe;
  - leaning, sinuous sulci;
  - a lilac cerebellum with arc folia, tucked under the back;
  - an open stalk for the stem;
  - the near hemisphere's thalamus, hippocampus and amygdala in their region
    colours.

  The point cloud read as a blob at 42 x 14 (the judge's scorecards are in
  `tools/brain-lab/out/`).
- **The brain sways and rests rather than spinning** at a fixed 6 fps. Front
  and back views read worst, and a still brain costs nothing. 12 fps is only
  for arcs.
- **The brain lab lives in `tools/brain-lab/`**, outside the plugin folder, so
  a plugin install doesn't copy it. Its rounds' PNGs stay on disk and out of git
  (`.gitignore`), with the notes and the judge's scorecards kept. Run it with
  `bun tools/brain-lab/shoot.ts` or `bench.ts`. Neither `tsc` nor the plugin's
  checks read it (the repository's `tsconfig.json` excludes it).

## Known gaps (v0.1)

- TODO: the desktop's brain as an `Svg` (Raster is the terminal's alone). The
  desktop shows a placeholder.
- TODO: the install-bun card; opening one memory by id on the dashboard (links
  land on `#memories`); fork write-ups.
- A sidebar search is a `recall` like the model's: it counts as a deliberate
  look-up on the dashboard. It also records which memories the answer showed
  this session, so a later reply quoting those words could credit them. A
  search strengthens nothing by itself.
- The facts-answer parser follows `adapters/mcp/facts.ts#renderFacts` (doc and
  code); the live check's fake server didn't speak that format.
- The event-to-mechanism table in `feed.ts` copies
  `adapters/mechanism-evidence.ts` (a mod can't import from outside its folder).
  A proof added there shows here only once this copy learns it; until then
  `test/sidebar-mechanism-drift.test.ts` fails, naming it. What a dream or a
  settle the owner undid proved still shows (core's `stands`, above).
- A came-to-mind row is matched to its dashboard twin by session id and turn.
  That assumes the store's session id is Claude Code's (true in today's feed).
- A session without the pane drawn follows a Claude-memory change made in
  another session only when it next draws or restarts (its cached prompt
  answers stand until then).
- A `/clear` starts this session's counts over. Rows already in ACTIVITY stay;
  they happened.
- After an Enter in the live run, the engine emptied the search field while the
  module still holds the query (`run.draft`, drawn back as the field's `value`).
  Nothing visible went wrong, but a later redraw may put the query back in the
  field.
- Unexplained: once, in the tmux session, focusing the pane with ctrl+x tab and
  then Enter widened the dock to about 60 columns. Not reproduced.

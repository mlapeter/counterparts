# Sidebar mod v0.1: notes

A Claude Code mod (a module of function hooks) inside the Counterparts plugin:
a memory pane docked beside the transcript, with a header, two switches, the
brain turning in braille, the twelve mechanisms, search, and ACTIVITY. The
approved design is the 10-09 mockup ("Sidebar v2", `drawD` in
`~/counterparts-notes/mockups/2026-10-09-mod/`). This file records what the
build learned. Everything here is a working default.

**Try it from a frozen copy**, not from a working tree. A `--plugin-dir` folder
hot-reloads on every edit, and an agent's worktree is deleted at merge. So
export one commit, install its dependencies (the plugin's server, which stands
down beside an npm install, still loads its code), and point Claude Code at
that:

    git -C ~/counterparts fetch -q origin
    sha=$(git -C ~/counterparts rev-parse --short origin/feat/mod-sidebar)
    dir=~/counterparts-trials/sidebar-v01-$sha
    mkdir -p "$dir" && git -C ~/counterparts archive "$sha" | tar -x -C "$dir"
    (cd "$dir" && bun install --frozen-lockfile)
    claude --plugin-dir "$dir"

That loads the whole plugin. Beside the npm install, its classic hooks and its
server stand down, so only the mod runs; the one start-up line says this is
expected and asks for nothing.

It opens by itself only where the terminal docks a pane beside the transcript
(the fullscreen layout). Elsewhere, and after closing it by hand,
`/counterparts` opens it. `/counterparts fps` shows the brain's frame rate,
`/counterparts quiet` makes it quiet (as `‹` does), `/counterparts hide`
hides it (as its `✕` does), `/counterparts caps` swaps the switch ends.

**Check it:** `sh hooks/sidebar/check.sh`, which runs validate on both manifests,
`claude plugin test hooks/sidebar` (57 tests, terminal and desktop) and
`tsc -p hooks/sidebar`, all with a throwaway HOME.

## Layout, and why

- `hooks/hooks.json` names the module under `"modules"` beside the five classic
  hooks; the root `plugin.json` names the state contract (`"types"`).
- `hooks/sidebar/` is a plugin root of its own (a `.claude-plugin/plugin.json`
  also named `counterparts`, so the `$.state` keys match either way).
  `claude plugin test <dir>` runs every `*.test.ts` under `<dir>`; at the repo
  root that would include the 154 bun test files, which can't load in a mod's
  environment, and the runner refuses a folder with no `hooks/hooks.json`.
- `bunfig.toml` sets `[test] root = "./test"`, so `bun test` never picks up the
  mod's tests. It still runs the same 5,319 tests across 154 files.
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
  comments both say "No permission prompt". So the sidebar never calls the
  server unasked unless `$.tool.check` says `allow`. A press may ask, because
  the person just asked. The dialog offered only Yes or No. An allow rule for
  `mcp__counterparts__recall` ends the asking for search. **Not for `scope`**:
  with that rule the model could pause or turn off folders unasked. (Mike runs
  in auto mode; whether its classifier passes these quietly is **assumed**,
  not measured.) The quiet read happens once, at the pane's first drawing (and
  again after a hot reload), and each one is one `mcp.scope.read` line in the
  event log.
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
- it re-paces to the target only while a pulse's arc is in flight;
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
  - `actorId`, for a settle a session made;
  - for a link flush, its `sessions` list.

  A look-up (`mcp.recall`, the sidebar's own searches included) and a
  reminder (`prospective.plain` / `.fire`) carry no session yet. One of those
  from after this session began counts as this session's; one from before, as
  another's. With two sessions running at once, the other's look-ups can show
  here. **Core follow-up:** add `session` to the `mcp.recall`, `prospective.*`
  and `associate.flush` payloads, and the sidebar can stop guessing.
- **Esc doesn't clear the search.** By the reference, Esc hands the keyboard
  back to the prompt and never reaches a mod's Input (**assumed**: not pressed
  in the live run). Clearing is the `✕` beside the field, or an empty Enter.
- **The Counterparts switch shows four folder states, not two, and acts on only
  some of them.**
  - **States:** `on` and `unset` (on by default) draw on. `observer` draws
    "Reads only" on a darker track. `paused` and `off` draw off, and the list
    says PAUSED or OFF. Before the first read it is dim.
  - **What a press does:** the first press learns the state. After that it
    pauses only a folder whose **own** entry is `on` or `observer` (the pause
    remembers which), and it resumes only its own pause. One call per press.
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
  A mechanism added there shows here only once this copy learns it.
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

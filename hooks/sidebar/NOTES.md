# Sidebar mod: notes

A Claude Code mod (a module of function hooks) inside the Counterparts plugin:
a memory pane docked beside the transcript. **v1** (2026-10-14, the directory
trim, below) shows memory and does not act: the fox (or no avatar) above the
title, the day and the count; Memories, Subconscious, Saved this session,
Mechanisms today and Last Dream; a footer of instructions. Closed (quiet), it
is a dim tail under the prompt that ends with how to open it again. The
design is the round-3 mockups Mike chose on 2026-10-10
(`~/counterparts-notes/mockups/2026-10-10-mod-round3/`, with `FEEDBACK-all.md`
there: its last section overrides the PNGs). The sections after v1's are the
record of v0.2 and v0.1 (the brain, the switches, the intro button): where a
later version changed something they say so, or v1's section does. Everything
here is a working default.

## v1: the directory trim (2026-10-14)

Why: the plugin directory's review read the sidebar, together, as a mod that
can take over Claude: it ran plugin commands, called a memory tool and could
pause memory from a press. Mike: v1 shows memory, it doesn't act. One sidebar,
both builds (the speak-first stays a module of its own, in the full build
only). The full v0.2 is kept on the branch `sidebar-full-0.3.22`, to bring
pieces back from later.

Removed:

- **"Start the 5-minute intro"** (its `$.command.run` of `/counterparts:meet`),
  with the onboarding reads behind it (`/api/onboarding`, the wake's marker in
  the sidebar; the speak-first still reads the marker itself).
- **The desktop's COUNTERPARTS and `more` Buttons** that ran
  `/counterparts:dashboard`, and the Mechanisms section's "Start the dashboard"
  click. On the desktop COUNTERPARTS and `more` are plain words now (a
  non-https Link draws as text there); on the terminal both stay `Link`s to the
  dashboard, which the terminal opens.
- **The folder switch** (on · paused · off): its `$.mcp.call` of `scope`, the
  confirm row, the hover card, the notes, `$.tool.list` (to find the server),
  and the paused banner's "click to resume". The banner and the amber status
  line still say a folder is paused or off, read from the registry file as
  before; they say how to resume (`say "resume memory here"` to Claude).
  `/counterparts resume` keeps its name and says the same: it changes nothing.
- **The view and avatar switches** in the footer: `/counterparts quiet`,
  `/counterparts`, and `/counterparts avatar animal|off` do it.
- **The brain** (the braille brain on a Raster, its timer, pulses, fps,
  `/counterparts fps`, `/counterparts brain …`, `avatar brain`, the regions on
  each mechanism). A stored `turning` or `still` reads as the fox. The header
  is the brainless one everywhere: `◉ COUNTERPARTS ↗` with the count and the
  day on its right; the `◉` still lights in the stage colour of whatever fired.
- **`COUNTERPARTS_DASHBOARD_PORT`.** Every `$.http.fetch` names
  `http://127.0.0.1:4747` whole at the call (the validator flags a computed
  address); links use the same address (`mechanisms.ts#DASHBOARD`). A
  dashboard on another port is not read: the trial rig's 4848 included,
  accepted. `/api/whoami` still guards the store: another store's dashboard on
  4747 shows "The dashboard serves another memory." and none of its numbers.

Added: **the footer** (`words.ts#footerLines`), where the switches were, the
same on terminal and desktop:

    ────────────────────────────────
    Intro · /counterparts:meet
    Stats · /counterparts:dashboard
    Pause · say "pause memory here"
    Hide · /counterparts quiet

The label dim, the command bright. Where every long label fits (a wide pane,
or the desktop's narrower font) they read `5-minute intro`, `Dashboard`,
`Pause here`, `Hide this`; narrower than an item, its short label, then the
command under it, indented. A command is never cut.

Renamed for the scanner, which reads a `key`/`token` word beside a URL as a
credential: `fox.ts#PNG_KEYS` is `PNG_FRAMES`, a feed row's `keys` is
`twinIds`. Kept: the `xmlns="http://www.w3.org/2000/svg"` in the fox's Svg
(`fox.ts#foxSvg`): the engine draws an `Svg`'s source as an image on the
desktop (`SvgProps`), and an SVG read as an image needs its namespace. The
brain's `cellsSvg` (the other one) is gone with the brain.

Checked as text by `test/sidebar-shows-not-acts.test.ts` (the repository's
bun tests): every file the directory flavor ships from `hooks/` has no
`$.command.run`, `$.mcp.call`, `$.process.run`, `$.prompt.submit`,
`$.tool.list` or `<Button`, and every `$.http.fetch` starts with the literal
address.

What the bullets below say of the intro button, the desktop Buttons and the
brain is the record of v0.2.

## For the plugin directory (2026-10-14)

The directory's validator, and Mike's calls the same day, for both builds (one sidebar):

- **One hooks module per plugin.** `hooks.json` "modules" takes one entry (a second is
  refused). The plugin's own build names `full.tsx`, which registers `register.tsx` (the
  sidebar) and `speak-first.tsx` (the once-per-install speak-first, moved out of the
  sidebar); the directory build names `register.tsx` alone, which never submits a prompt.
  Two hooks of one plugin on one event with no matcher are refused, so every speak-first
  hook carries one (it validates alone too). They share, through the engine, `$.state`
  `counterparts.scope` (the sidebar writes it, the speak-first reads it; alone, the
  speak-first never fires), `$.state` `counterparts.typedIn` (the sidebar's `/counterparts`
  hook answers without `next`, so it records the person typing it there), and the
  `$.store` mark `meetTriggered` (the speak-first writes it; the sidebar hides its button
  while this session's speak-first introduces). `full.tsx` registers the sidebar first, and
  the first registered is the outer hook: order matters. Without the speak-first, "Start
  the 5-minute intro" shows for `not_started` too. The speak-first looks every second for
  two minutes after an interactive start, then once a minute until it has decided (the
  sidebar's scope recheck used to carry that).
- **No `Client` identifier** in the hooks module but on the line that names its module.
- **No `$.process.run`:** on the terminal the dashboard links are `Link`s (OSC 8). The
  desktop draws a non-https link as plain text, so there COUNTERPARTS is a Button and `more`
  posts its key; both run `/counterparts:dashboard`, which opens the browser on a dashboard
  already serving this store (`counterparts dashboard` asks `/api/whoami` when the port is
  taken) and starts one otherwise. A `more` there opens the dashboard, not that memory.
- **No search box** (it was hidden since 0.3.20).
- **No base64 module:** the fox's PNGs are files (`art/fox/`, under `$.plugin.root`). The
  plugin bundle must ship that folder: its tracer follows imports, not these paths.
- **The engine's clock** (`$.clock.now()`), never `Date.now()`/`performance.now()`; read once
  a frame, a tick skipped while one waits for it; the fps report no longer gives a frame's
  compute time.
- **No PNG folder found:** no picture tier at all, even under `avatar detail images`.

## Where core ends and the mod begins (Mike, 2026-10-11, lightly held)

Core is everything about memory: the store, writing, recall, forgetting,
dreaming, the wake, the MCP tools, the CLI, the dashboard and its API, and the
five classic hooks. It also owns onboarding (the steps and the first-run
state), shared by every way of installing. The mod is how Counterparts looks
and is controlled inside Claude Code: the sidebar, the quiet line, the
switches. It reads core only through core's public surfaces (the dashboard
API, hook output, its own tool calls) and never opens the store. When it needs
something those don't give, that is a core ask, not a workaround inside the
mod. Packaging (the manifest, the launcher, the bundle, the directory listing)
ships both.

The test: would someone using Counterparts without the sidebar need it? Then
it's core.

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
opens it; `/counterparts quiet` closes it to the tail (`hide`, `rail` and the
dropped `strip` are quiet too); `/counterparts brain
turning|still|off` sets the brain; `/counterparts resume` resumes a folder
paused here; `/counterparts fps [n]` reports the brain's rate (or sets its
target). `caps` is gone: the footer's switches are dots, with no ends to draw.

**Check it:** `sh hooks/sidebar/check.sh`, which runs validate on both manifests,
`claude plugin test hooks/sidebar` (214 tests, terminal and desktop) and
`tsc -p hooks/sidebar`, all with a throwaway HOME. **See it:**
`tools/term-loop/` (its README), at `--size 200x60` and `--size 160x48`. A
term-loop session sends no message, so nothing comes to mind and nothing is
saved in it; `COUNTERPARTS_SIDEBAR_SESSION=<session id>` in the environment
shows that session's Memories, Subconscious and Saved instead (below,
"Seeded").

## The Claude memory switch, removed (2026-10-12)

The opt-in footer switch that hid Claude Code's own memory (its MEMORY.md
instruction files through `prompt.context`, its `memory` system-prompt
section through `prompt.section`) is gone, with its `$.store` keys
(`claudeMemory`, `claudeMemorySwitch`), the `COUNTERPARTS_SIDEBAR_CC_MEMORY`
opt-in, the `Claude memory off` status-line part, its hover card and toast.
Why: a mock directory review read it as close to the policy against
interfering with Claude's own features, and the owner prefers to drop it.
The mod now only observes Claude's context and tool calls.

- **A stale stored value is never read.** Whoever had it off (Mike among
  them) gets Claude Code's memory back from the first session on this
  version: nothing filters it any more. The old keys stay in the store
  untouched; nothing reads, rewrites or shows them. One test pins it: with
  `claudeMemory: false`, `claudeMemorySwitch: true` and the old env opt-in
  all set, MEMORY.md and the memory section pass whole, no switch is drawn,
  the status line is empty.
- `tools/term-loop` no longer clicks the switch to put that preference back
  (`claudeMemory` left `PREF_KEYS`; the put-back is the mod's commands only).
- The sections below that describe the switch are history.

## Fox polish (2026-10-13, for 0.3.21)

Mike's picks from art round 8 (`~/counterparts-notes/mockups/2026-10-13-fox-r8/`,
its NOTES.md and lab), 2026-10-13. His guiding note: more movement, but
subtle, so he looks alive without pulling the eye.

- **Perk is round 8's variant A** (replaces round 7's): one ear up, the other
  eye taller under a raised brow, a small "hm!" mouth; the sparkle stays. It
  is derived from idle, so only the head changes (108 PNG art pixels, 21
  sextant cells).
- **The tail tip flicks** (`tailSmall`: the white tip leans 1 then 2 px).
  Slower than the lab (360/520/360 ms, about 1.2 s, against the lab's
  220/320/220), so it reads as unhurried. It is also the first thing he
  does: the first hold after the fox appears is 2–4 s, then the flick
  (`schedule.first`, `firstMs`).
- **The whole tail stays, rarer** (weight 0.5 against the tip's 3).
- **Lick is not shipped** (its frames and moment left out; Mike: skip for now).
- **He lies down** (round 8's "loaf") after 45 s with nothing happening
  (`lieAfterMs`), has small moments lying (`lieWeights`: a blink, the ear, a
  glance, a breath), and naps at 2 min (`napAfterMs`, was 3 min), curling up
  from lying (`lieNapIn`). `fox.ts` has a third mode, `lie`. Any real event
  gets him up: a prompt (`lieOut`: the lying blink, the sitting blink,
  idle), a save, the meeting, a dream (straight to the curl, `lieNapIn`).
  Something coming to mind while he lies perks him up lying down
  (`cameLie`, the sparkle at `sparkLie`), then he sits up; that is the
  lab's choice, kept.
- **Frequent small moments**: holds of 4–9 s (were 8–20). Weights: blink 4,
  tail tip 3, ear 2, glance 2, tail 0.5, yawn 0.3. The hold is still one
  still frame, sitting or lying (the round-2 rule: calmer).
- **The ear twitches once, and no longer flickers.** Round 7's `ear` frame
  was a separate drawing of the whole fox: switching to it re-drew the body's
  dithering everywhere (1,174 PNG art pixels; 116 of the sextant tier's
  cells, every row), twice in 520 ms. That was the flicker. The new `ear` is
  idle with only the right ear moved (round 8's own ear-lift, the other way:
  2 px shorter, its tip 3 px out): 88 art pixels, 15 sextant cells in the top
  three rows. The half-block ear was already local and is unchanged.
  `lieEar` is the same ear on the loaf. One frame, 280 ms.

**How the art changed.** `fox-art.ts` is no longer a verbatim copy of an art
module: it is round 7's with round 8's frames merged in (`new-frames.ts`:
perk, tailSmall0/1, the seven lie frames, `sparkLie`), the new ear, and the
moments and schedule above. The new ear's grids came from round 8's pipeline
(`src/lib.ts`, `maj2.ts`, the `tiers.ts` steps; the pipeline reproduces the
shipped idle and round 8's lie0 cells exactly). The PNG export folder is
round 7's plus round 8's PNGs plus the re-derived frames below (ear, lieEar, blink, drowsy, looks, breathe, note1/2, tail1/2 and their lying versions).

**Smoothness, checked pair by pair** (what can run back to back; numbers
are PNG art pixels / sextant cells that change):

- Holds to moments and back: every sitting moment starts from and ends on
  idle-faced frames (tip flick 34 / 7, ear 88 / 15, blink and glance local in
  sextant and half). Lying, the same from lie0 (lieBlink 17 cells, lieEar
  16, liePerk 20).
- Sit to lie (`lieIn`: blink, lieBlink, lie0) and lie to nap (`lieNapIn`:
  lieBlink 1.4 s, nap0): the pose changes only between two shut-eyed frames.
  Up from lying (`lieOut`: lieBlink, blink, idle): the same, the other way.
  Nap to sitting (`napOut`: nap0, stretch, blink, idle) is unchanged.
- A mode change never starts from a moment's last frame: a moment that would
  run past the 45 s or 2 min mark is not started; the still holds until the
  mark (`holdThen`).
- Perk in and out: perk is idle plus the ear, eye, brow and mouth, so in and
  out are a cut of the head only; `cameLie` the same on the loaf.
- Events mid-moment: an event used to cut straight from whatever was on
  screen. Now (`getUp`) from the nap it plays the stretch, from lying
  `lieOut`, and from a sitting moment's frame (a glance, the tail, the
  notepad) one 160 ms blink (`bridge`) back to the sitting face first.
- One wake per change: a moment that ends on the frame the next hold shows
  (`came`'s idle, `lieIn`'s lie0) used to cost a second wake; `advance` now
  plans ahead and joins them, and the hold's time is counted from when the
  frame really changed. So `director.mode` turns to `lie` or `nap` up to one
  hold before the pose changes on screen; `trigger` reads the pose from the
  frame on screen (`poseOf`), and nothing outside `fox.ts` reads `mode`.
- The early flick is once per module life (the first drawing of the fox in a
  session), not at every reopening of the pane.

**No more shimmer: the small moments re-derived** (second pass, same day, at
the coordinator's ask: the desktop draws the picture tier). Round 7's frames
were each a separate drawing of the whole fox, so at the PNG tier every
moment re-drew the body's dithering. Each is now its base pose with only the
moving part edited, so the body's pixels are identical from frame to frame
(PNG art pixels that change, before → after):

| frame | base | what changes | before | after |
|---|---|---|---|---|
| blink | idle | idle's eyes out, round 7's closed-eye strokes in | 1,059 | 36 |
| drowsy | idle | the eyes' top two rows under a lid (no head dip any more, as the sextant and half tiers already drew it) | 2,653 | 16 |
| lookL / lookR | idle | round 7's look eyes (with their whites) in idle's eye boxes | 970 / 910 | 64 / 60 |
| breathe | idle | the head, rows 0–45 left of the tail, 1 px lower (the sextant tier's breathe) | 1,828 | 446 (the head itself moving) |
| note1 / note2 | note0 | only the paws, pencil and pad (x 32–58, y 49–72) | 491 / 511 vs note0 | 115 / 103 |
| tail1 / tail2 | idle | only the tail's area (right of the body, from row 30; the head's edge stays idle's) | 1,631 / 1,878 | 681 / 811 (the tail swinging) |
| lieBlink, lieLookL/R, lieBreathe | lie0 | the loaf with the new heads | 547 / 534 / 1,327 | 36 / 64 / 444 |

hello0 → hello1 was already local (75 pixels, the waving paw); idle → hello0,
idle → note0, the stretch and the yawn are pose changes and stay cuts. The
sextant tail1/tail2 are rebuilt the same way (idle's clean cells, plus the
cells whose majority differs from idle's): 113 / 130 cells → 73 / 83, all in
the tail's rows. The other sextant and half-block frames were already local
and are unchanged. Sources (`derive.ts`, `tiers3.ts`) are in
`~/counterparts-notes/mockups/2026-10-13-fox-r8/shipped/ear-src/`.

**The sextant colours were read one off.** The sextant cells name the art's
palette from 1 (`1` is the outline, `#000`; `j`, 19, the last), as round 7's
and round 8's pipelines write them, but `fineCells` read it from 0: every
sextant colour was the next one along (most of the fox drew `#a76`, a muted
tan, instead of the rust `#a42`; the creams drew white; the notepad's `j`
fell off the end and drew nothing). Now read from 1. That fixes the notepad,
and the iTerm fox now has the same colours as the picture (through
TEXT_256's picks: the fur lands on `#d75f00`). **This changes how the fox
looks in iTerm, WezTerm and VS Code**: a stronger orange, a cream chest
instead of white, dark grey feet and ear tips. Check it live; if the old,
softer look is the one wanted, that is a TEXT_256 choice now, not an
indexing accident.

**The hint for a narrow window.** Where the screen docks a pane but the
window is too narrow to place the sidebar, the tail under the prompt said
`/counterparts opens the sidebar`, which can't open it there either. It now
says `widen this window to see the memory sidebar` (`NARROW_HINT`), or
`widen to see the sidebar` on a row too short for that (`narrowHint`, the
same room as the quiet tail's). The classic screen's `/tui fullscreen…` hint
is unchanged.

## The fox (2026-10-12, for 0.3.20)

A small fox now sits at the top of the pane, under the title. It is the avatar
when nobody has chosen one. A `brain` someone stored (`turning`, `still`, `off`)
stays what it was. The footer's row is `avatar ○ brain ● animal ○ off`
(`/counterparts avatar animal|brain|off`; `brain turning|still|off` still works).
The trial branch's `trialBrain`/`trialFoxSize` keys and its small/big size are
gone: there is one size, under the real `brain` key.

**The art is data.** `hooks/fox-art.ts` is the art agent's module, copied
verbatim (round 7: `~/counterparts-notes/mockups/2026-10-12-stage/fox-final-sprites.ts`).
It holds every frame three times (PNG paths, sextant cells, half-block pixels),
and the moments and the schedule once. `hooks/fox-png.ts` is generated from the
PNG export by `tools/fox-art/build.ts`. That script downscales the ×8 export to
×3 (228 × 243, sampling each art pixel's centre, so the result stays crisp),
lays the effects over the frames each moment draws (`nap1+zSmall+z`, `perk+spark0`, …)
and writes them to `hooks/sidebar/art/fox/` and as base64 to `fox-png.ts`. The
total is 25 PNGs and 59 KB. An art fix is a data-only change:

    cp <new fox-final-sprites.ts> hooks/sidebar/hooks/fox-art.ts
    bun tools/fox-art/build.ts <new fox-png folder>
    # commit fox-art.ts, fox-png.ts and art/fox/

The bundle traces imports, so it ships `fox.ts`, `fox-art.ts` and `fox-png.ts`
but not `art/fox/*.png`. The mod never reads that folder: a hooks module's
`$.fs` paths are relative to the working directory and can't name the plugin's
own folder, so the pictures travel as base64. The folder is the source the
module is generated from.

**Four ways to draw one design** (`fox.ts`, `pickTier`):

| tier | where | how | a frame change |
|---|---|---|---|
| `image` | kitty, Ghostty | `Image` of the PNG, 30 × 16 cells | a blit of the new `{ png }` |
| `fine` | iTerm2, WezTerm, VS Code (and Ghostty/kitty where pictures don't show) | sextants (2 × 3 pixels a cell, two colours), as rows of `Text` runs | a redraw of the pane |
| `basic` | everything else: Apple Terminal, tmux, screen, unknown | half-blocks on a `Raster`, 34 × 15 | a blit of the cells |
| `svg` | the desktop app (no Raster, no Image) | `Svg`: rects from the half-block pixels, the PNG over them as a data URI | a redraw |

`/counterparts avatar detail auto|images|fine|basic` overrides the choice. It
is stored in `$.store` as `avatarDetail`.

- **No capability flag exists.** `RenderViewport` gives columns, rows and
  `isFullscreen`, and nothing on `e.surface` says whether the terminal draws
  pictures. So the choice reads the environment once at session start
  (`TERM_PROGRAM`, `TERM`, `KITTY_WINDOW_ID`, `WEZTERM_EXECUTABLE`, `TMUX`, `STY`,
  `CLAUDE_CODE_FORCE_TERMINAL_IMAGES`). Pictures are chosen only for
  `TERM_PROGRAM=ghostty`, `TERM=xterm-ghostty|xterm-kitty` or a
  `KITTY_WINDOW_ID`, and never under tmux or screen. The force variable says
  yes or no outright. **Assumed, not seen:** what Ghostty and kitty set (taken
  from their docs, not observed here).
- **The runtime check.** `$.ui.blit` on an Image is refused when "the Image
  draws its alt there". In `auto`, two refused picture blits in a row switch
  the session to sextants. Right after mounting, an Image's first frame is
  blitted again as a probe, so a wrong guess shows the dim `a small fox` alt for
  about two drawings, not until the next moment.
- **Why the sextants are Text and not a Raster.** `RasterProps.cells` takes
  "one printable width-1 BMP character". U+1FB00–1FB3B are not BMP, so a
  Raster of them would be refused. **Unverified live:** that the engine
  measures a sextant as one cell wide inside `Text`. If it counts two, the
  stage's rows would wrap; `avatar detail basic` is the way out.
- **The desktop's Svg** has both the rects and an `<image href="data:…">`.
  Whether the drawing shows the PNG depends on whether the Svg scrub keeps a
  data URI. If it drops it, the rects show the same fox in half-block pixels.
  **Unverified:** nobody has opened it in the desktop app.
- Transparent pixels: on the Raster they are the terminal's default colour,
  as the trial found (a panel hex comes out as a box). In Text, a cell with no
  colour takes the panel's.
- Footprint: the stage is 34 columns, edge to edge (outside the frame's
  padding), and needs a pane of 30 rows or more (`STAGE_MIN_PANE_ROWS`).
  Shorter, inline, or narrower, the brain's header draws instead, standing
  still. The fox's box starts 1 (half), 2 (sextants) or 2 (picture) columns in,
  leaving room for the effects beside its head.

**What it does when** (round 6's design, `fox-small-r6.ts`; the art's
`moments` and `schedule`; `fox.ts`, `advance`/`trigger`, pure and seeded in
tests):

- At rest, a **still** hold of 8–20 s, then one small moment by weight: blink
  3, glance 2, ear 2, tail 2, yawn 0.5. The art's `rest` loop (idle with
  `breathe`) is not used. The owner asked for calmer movement, and the
  breathing bob was the trial's suspected flicker. `breathe` is an unused
  frame for now; adding it to the weights would bring it back as a moment.
- After 3 minutes with nothing happening (`napAfterMs`), a nap with a z beside
  the head. A prompt the person sends wakes it with a stretch, and so does any
  real moment. The art's `napMaxMs` (4 min) also ends a nap, so a fox left
  alone naps and wakes in turns.
- Real state: `came` (a recall block put something in front of Claude), `note`
  (a memory saved: the notepad, twice), `hello` (the speak-first goes out, and
  each call of core's `meet` tool) and `dream`. The fox dreams while a dream
  runs: during this session's `dream` tool call, or from a `dream.begun` row
  in the activity feed until `dream.journaled`/`changed`/`undone`. A dream
  that never says it ended stops after 20 minutes. While it dreams, other
  moments wait.
- **CPU.** One `$.clock.after` per change of what is on screen (`advance`
  returns when the picture next changes, past steps that show the same thing).
  No timer runs while the pane holds the keyboard, after a drawing finds the
  pane not shown (the poll loop's not-shown branch stops it too), after a
  refused blit, or in any view but the sidebar. A drawing starts it again.
- The fox's moments are awaited inside the hooks that cause them (`onSaved`,
  `onRecallBlock`, `tool.call`, `prompt.submit`) and use `$.clock.now()`, not
  `Date.now()`, so the test kit's clock drives them.

**"Start the 5-minute intro"** runs `/counterparts:meet` through `$.command.run`
(from a timer: the engine refuses it inside a hook the turn waits on). The
owner's trial showed why. In a later session (meet=later) the button sent the
speak-first's line, "Meet your new counterpart.", and Claude had nothing to tie
it to. The plugin command carries its own instructions. `MEET_PROMPT` is "Meet
your new counterpart." (the owner, 13:03) and is sent only by the automatic
first-session speak-first; core's wake names it (#459). A refused command shows
a toast.

**The Mechanisms section with the dashboard down** is a cyan link, "Start the
dashboard to see stats here". A click on any of its lines runs
`/counterparts:dashboard`. Schemas (not built) is no longer drawn at all.

**Which store** (core #459). The wake's `<!-- counterparts:store id=st_… -->`
is kept in `run.wakeStore`, and it survives a `/clear` because the store is
the same. Every poll first asks `/api/whoami`. When both sides are known and
differ, the sidebar does the following until they match again (`storeMatches`):

- the dash state becomes `other`;
- the pulse, today's counts and the last dream are dropped;
- `fetchJson` refuses every read, which covers titles, memories, mechanisms
  and seeding;
- the Mechanisms section says "This dashboard belongs to another memory.", dim.

A match makes the next read a cold one. `/api/onboarding`'s `store` is checked
too, so another store's meeting state is never taken. Either side unknown (no
marker yet, an older core with no `/api/whoami`, `store: null` before a wake
minted the salt) means "can't tell": it carries on. A marker that arrives
after a cold read from the wrong store corrects within one poll. Memories and
Subconscious come from this session's own hook context and Saved from its own
tool calls, so those always show.

**The search box is hidden for 0.3.20** (`searchFlag`; set
`COUNTERPARTS_SIDEBAR_SEARCH=1` before starting Claude Code to bring it back).
In the owner's real sessions (fox trial rounds 1 and 2), a click never put the
keyboard in it, while Buttons in the same pane pressed fine. The round-2
"blit while focused" fix didn't change that. It could not be checked live from
the build session. A term-loop session runs his npm hooks against his live
memory and the mod reads his `~/.counterparts/scopes.json`, and builders may
not touch either. The record has it working in tmux on 10-10 (v0.1, before the
brain header). Next live check: master, fullscreen, the owner's own terminal,
the brain avatar (`/counterparts avatar brain`) and the flag on. Click the box
and type. If it works there, the stage's layout is the cause. If not, it is
the terminal's or the engine's Input-in-a-pane, and a report to the Claude
Code team.

**The blank last line** under the avatar row in the owner's screenshot
(`11-fox-r2-sidebar.png`) is not ours. It is grey, the dock's colour, while
everything we draw sits on the panel's `#05080c` inside a frame `minHeight` of
the body's rows. Our last row is the avatar row. That grey row is the engine's
pane edge (the counterpart of the ✕ row at the top).

## The split, a theme setting, a stranger's copy (2026-10-12)

**Why** (owner, 2026-10-12): a clean split before the desktop view and the
stage, which must reuse the shared parts. `register.tsx` was 107 KB and held
everything.

**What the engine allows**, measured with `claude plugin validate`: `$` may not
be passed to a function imported from another file (refused: "$ is followed
only into a function declared in this same file, never across an import"); a
`read($, x)` needs `x` to be an atom declared in the same file; the surface
modules are read off the hooks module's own `<Client module=…>`. A closure made
in `register.tsx` that captures `$` may cross an import. So every function that
takes `$`, the atoms, `PANE` (a matcher's literal) and the `<Client>` tag stay in
`register.tsx`, and the views take the element table and a record of closures
(`PaneActions`). That leaves `register.tsx` near 80 KB, not the 40 hoped for.
Going further means a port object of closures handed to the core functions:
a redesign, not a move, and the owner's call.

**The file map** (`hooks/`):

| file | part | holds |
|---|---|---|
| `register.tsx` | entry | the hooks, the atoms, every function that touches `$` (dashboard reads, the speak-first, the switch, search, the brain's timer, `/counterparts`) |
| `state.ts` | core | timings and limits, the first meeting's line and mark, `run` |
| `words.ts` | core | what the sidebar says: status line, switch explanations, hover cards, tail words |
| `feed.ts`, `sections.ts`, `mechanisms.ts`, `scopes.ts` | core | the dashboard's rows read, the body's sections laid out, the mechanism table, the scope registry read |
| `theme.ts` | core | every colour: `tron`, `cozy`, the palette in use (`P`) |
| `pane.tsx` | view, every surface | the pane's tree: title, search box, paused banner, the intro button, the confirm row, the footer |
| `terminal.tsx` | terminal view | the brain's header (a `Raster`), its frame and frame rate; with `brain.ts`, `cells.ts`, `width.ts`, `tail.ts` (the quiet tail) |
| `desktop.tsx` | desktop view | the header without a brain (also the terminal's with the brain off) |
| `body.tsx` | view | the body, a Client surface module |

The first commit is moves only (every top-level statement identical, an
`export` added; checked by a script comparing the statements' text), and
validate's report of hooks, calls, state and surface modules is the same
before and after each of the first two.

**The theme.** `/counterparts theme tron|cozy`, stored in `$.store` (`theme`,
default `tron`) like the view and the brain, kept in the `theme` atom, applied
at each drawing of the pane (so a reload, which starts the module at tron,
draws right). `tron` is the old values exactly; `cozy` is
`~/counterparts-notes/mockups/2026-10-12-stage/cozy-theme.md`. `cyan` is now
`accent`, `amber` `accent2`. Not themed: the mechanisms' stage colours and
the brain's own body colours (the cozy notes keep stage colours per effect).
The palette in use is one module object `applyTheme` copies into, so the
layout stays a plain function of its state; a desktop view in another
process would apply its own.

**The copy** a stranger's read flagged, taken:
- The submitted line: "Counterparts is installed. Claude would like to introduce itself."
- The button: **"Start the 5-minute intro"** (was "Meet your counterpart"). The owner may still revise this one.
- Dashboard down: "Counts appear once the dashboard is open (/counterparts:dashboard)", for every install. The
  per-install route (`dashboardRoutes`, the console's `counterparts dashboard` for an npm install) is gone: the
  slash command works wherever this sidebar is drawn.
- The tail with nothing new: "Watching quietly · nothing new yet · /counterparts opens it".
- Schemas' tagline loses "Not built yet."; it still draws hollow (`notBuilt`).

## The owner's onboarding trial, round 1 (2026-10-12)

A fresh-user trial of the first meeting turned up three things in the mod:

- **The visible prompt.** Claude Code shows `MEET_PROMPT` to the person ("Prompt from the counterparts plugin"), so
  "Counterparts is installed. Say hello and introduce yourself." read as machinery. It is now "Counterparts: Claude
  has a memory now and would like to introduce itself." It still tells the model to introduce itself; core's wake
  carries the real instructions.
- **The quiet tail's save.** It read `stored: Answered: what Mike does off the keyboard`: two prefixes in a row.
  A save now reads `Stored “<title>” — <the note's own words>…`: one lead word, the title in quotes (so a title's own
  `Answered:` is just part of the title), then as much of the text as the width budget (`TAIL_SPARE` and the hint
  prop, unchanged) leaves, cut at a word with an ellipsis. No words are added to a title that was clipped, and
  none when the title was cut from the text itself. Several saves: `Stored 2 memories, the first “…”`. The text
  rides on `SidebarSaved.text` and `SidebarLatest.body`; a row rebuilt from the dashboard has none (title only).
  The other lead words (`remembered:`, `subconscious:`, `opened:`, `dreamed:`) are unchanged.
- **The classic screen's hint.** There the pane can only go inline, so nothing opens unasked and the only sign was
  `/counterparts opens it`. The status line's tail now ends `/tui fullscreen shows the memory sidebar` when
  `e.viewport.isFullscreen` is false (read on the tail's own render, else the band's remembered answer; unknown
  keeps `/counterparts opens it`). The mod does not touch the `tui` setting, writes no settings, and adds no
  toast: it only says what would show the sidebar. `/counterparts` itself still opens the inline pane.

## The first meeting's trigger, a three-way switch, Claude memory opt-in (2026-10-11)

Built against core's onboarding state, which core was building in parallel
(`~/counterparts-notes/2026-10-11-onboarding-core-brief.md`). **The source is
the SessionStart wake's marker**, `<!-- counterparts:onboarding
meet=<state> -->` on a line of its own (right under the `Now:` clock line,
outside the wake block; nothing in the mod reads the wake by line
position), written on every wake, compactions included, and on a same-day
resume's short wake (core #415: one line pointing at the wake above). The
marker is the only thing the mod reads from the wake (day and count are the
dashboard's), so the short form changes nothing; a resumed session has
replayed turns, so it never speaks first (done
included; `start-fresh` resets it to not_started); spelled once, in
`feed.ts#ONBOARDING_MARKER`. The hooks don't start the dashboard, so it
could not be the source. No marker: an older core, `unknown`, and the mod
does nothing about the meeting. `GET /api/onboarding` (`{ meet, where, style
}`, read strictly by `feed.ts#parseOnboarding`) is only a refresh while the
dashboard is up (the cold read, and warm polls while the state can still
move); a 404, a refusal or another shape changes nothing and never marks the
dashboard down.

**The once-only mark is keyed to the store by core's state, not an id.** No
store identity reaches the mod without a core change (`STORE_CREATED_KEY` is
in the store's meta, on no public surface; the data dir's path survives
`start-fresh`). Instead: every known state past `not_started` rewrites the
mark as `{ settled: <state> }`, a settled mark doesn't block the speak-first,
and so a `not_started` after it, which only a new store says, gets its own
first meeting. A `{ session }` mark (fired, never moved past not_started)
still binds; the button covers that case.

- **Speak first** (`register.tsx#speakFirst`). At an interactive start, once
  both the folder's registry read and the wake's marker have landed (either
  order; whichever is last decides): if the folder is `on` or unset (not
  paused, off, observer or unknown), no binding `meetTriggered` mark is in
  `$.store`, the marker says `not_started`, `$.session.turns()` is 0, the
  prompt box is empty and
  no prompt of the person's was seen (`prompt.submit`, origin `composer` or
  `bridge`), it stores `meetTriggered: { session, at }` and then submits
  `Counterparts is installed. Say hello and introduce yourself.` (mark first:
  a crash in between loses the trigger rather than repeating it). `$.store`
  is shared by every session and restart, so it goes out once per store
  (above). The engine runs a plugin's prompt once the session is idle; if
  the person's own prompt gets there first, the queued one is dropped
  (`prompt.submit` hook) and core's offer at the end of that reply stands.
  The drop keys on `run.spokeFirst`, which core's state moving on never
  clears: that reply calls `meet` (state `offered`), and a refresh read then
  must not let the queued line through after it (review of #416).
  Nothing is read from the dashboard at start.
- **What the submitted turn looks like: not observed.** No core served the
  endpoint, and a real run would send a model turn through the live hooks.
  From the declarations: origin `{ kind: 'plugin', name: 'counterparts' }`;
  the model reads it framed, "The counterparts plugin sent a message: …"
  (not `asUser`); the transcript names the plugin; it goes through the
  UserPromptSubmit settings hooks, so core's recall block attaches as for a
  typed prompt. Check it in the first real run.
- **Meet your counterpart**: a cyan row at the top of the body (after the
  header and any paused banner, before the sections) while core says `later`
  or `offered`; a press submits the same line, once a minute at most. Also
  shown for `not_started` when the speak-first went out in an EARLIER session
  (its turn never reached core's `meet`: otherwise a dead end). Hidden for
  done, skipped and unknown, and in a folder that is paused, off, observer or
  unknown (nothing would be kept). No poll of its own: the cold dashboard read
  and each warm poll read it, the warm ones only until done or skipped, and a
  call of core's `meet` tool reads it again.
- **The Counterparts switch is three-way**, `Counterparts ● on ○ paused ○
  off` (32 cells, the dock's text width; `memory` for the word when
  narrower). As safe as before: unknown draws `?` on every position and a
  press on any only learns the state; only a folder's own entry is changed
  (unset and inherited are explained); `paused` and `off` ask first (the
  confirm row: [Pause] or [Turn off]); `on` resumes the folder's own pause at
  once. **`on` turns a folder off by its OWN entry back on** (Mike,
  2026-10-11 15:25, lightly held), after the same confirm row ("Turn memory
  back on in <folder>? Nothing from while it was off was kept." [Turn on]),
  through the `scope` tool (the one tool that answers in an off folder); an
  observer folder gets the same confirm to go fully on. Off because a PARENT
  is off still explains and names the parent, and nothing flips the parent
  from here. A confirm left open acts only while the folder is still in a
  mode it may change (`CONFIRM_FROM`), else the row hides. Any slash command
  the person runs (`/model`, which starts no turn) counts as typed for the
  speak-first. It stands a speak-first down that hasn't gone out, but doesn't
  drop one already queued: only a prompt (`run.prompted`) gets a reply in
  which core can offer the meeting instead (review of #416). **A session
  started in a reads-only folder can't change the setting at all:** its
  server bakes the registry's `observer` into the store, and the `scope`
  tool stands down on every write (`serve.ts`). The confirm still shows (the
  sidebar can't tell that launch from a folder set reads-only later); its
  [Turn on], [Pause] or [Turn off] then names the console command
  (`stoodDownNote`) instead of the bare refusal (review of #416).
- **The Claude memory switch is hidden** unless opted in:
  `COUNTERPARTS_SIDEBAR_CC_MEMORY=1` in the environment Claude Code starts
  with (`$.env.get`; a shell export is sure to reach it), or `$.store`
  `claudeMemorySwitch: true`. Whoever had already turned Claude memory off is
  opted in by the store, once, at the first start of this version, so no
  filter is left that can't be seen or undone (Mike keeps his this way). The
  filtering (`prompt.context`, `prompt.section`, the status line) is
  unchanged. Opted in, it is its own footer row, under the Counterparts one.

## v0.2 (2026-10-10): what memory is doing, in 35 columns

### The polish round (2026-10-10, evening, from Mike's trial of dd179df5)

Mike used the copy in his own terminal; his decisions are the last section of
`~/counterparts-notes/mockups/2026-10-10-mod-round3/FEEDBACK-all.md`. Shots,
before (dd179df5) and after, both sizes:
`~/counterparts-notes/mockups/2026-10-10-mod-polish/` (private: live memory).
The sections below this one describe the build before the round; where they
disagree, this wins.

- **Two views: sidebar and quiet.** The strip is gone (Mike read a click on
  "strip" as the sidebar disappearing). Footer `view ● sidebar ○ quiet`. A
  stored `strip` reads as quiet, like v0.1's `rail` and `hidden`, and is never
  written back (a v0.1 copy on the same store keeps reading its own word);
  `/counterparts strip` is quiet, so an older term-loop put-back still works.
  The band above the prompt draws nothing now; its first drawing still decides
  whether the pane opens unasked.
- **The quiet tail always ends with ` · /counterparts opens it`**
  (`sections.ts#quietTail`): the tail is dim text the engine draws and can't be
  clicked, so it says the way back. The newest thing is shortened to the row
  so the hint is never the part cut: `viewport.columns` less the `hint` prop
  less 32 (`register.tsx#TAIL_SPARE`). **Measured** at 160x48 (term-loop,
  Claude Code 2.1.296): the engine draws more than the prop holds (`⏸ manual
  mode on · ? for shortcuts · ← for agents`, 49 cells, for a prop about 30;
  auto mode's line 16 more), two cells of indent, ` · ` before the tail, and
  three cells kept clear at the end; with two spare the first build's tail
  lost `nterparts opens it`. With 32, whole in manual and auto mode at 160 and
  200 columns (`quiet-*.png` in the shots). Nothing new yet: `Counterparts is quiet · …`.
  An unasked pane this surface could not place still says `/counterparts opens
  the sidebar` (view sidebar, nothing newer).
- **A click opens in place, every time; again, it closes.** No click opens the
  dashboard by itself: the 12-line threshold (`EXPAND_MAX_LINES`) is gone, and
  with it the Subconscious "flash, then the dashboard". Up to 20 lines of text
  (`OPEN_MAX_LINES`) show whole; longer, 20 lines, the last ending at a word
  with `…` and a cyan `more` on that same line. `more` is the one link: a row
  carries `link: { from, key }` (`sections.ts#Line`), and the body posts the
  link's key (`more:<id>`) for a click from that column on, the row's own key
  before it. It opens `#memories?id=<id>`. Shortened by the fold ladder at a
  short pane (14, 10, 8, 5 lines), the text still ends with `more`. Nothing
  opened closes by itself (review: the minute's auto-close is gone, for items,
  the dream and an opened mechanism alike); only a click closes it.
- **Up to three lines an item** in Memories, Subconscious and Saved (and a
  mechanism's firing): fewer items when they don't fit, never one shorter. The
  ladder's "memory titles 2 lines" step became "memories shows 2/1". A
  footnote's `↗ opened` goes on its last line, or the line after when there's
  no room.
- **Saved this session:** every line of an item in one colour (`P.hi`); the
  stage dot on line 1 only; no `replaces …` line in the list (it shows inside
  the opened item); chapters left out (a journal entry, not a saved memory).
- **Dates in titles** (`feed.ts#humanDates`, display only, never the stored
  text): an ISO date that means today is dropped with its brackets or
  separator (`(2026-10-10)`, `2026-10-10: `, `, 2026-10-10)`), `on 2026-10-10`
  reads `today`, `on 2026-10-10 morning` `this morning`; any other ISO date is
  `Oct 9`, or `Jan 5 2025` in another year (`hm` and the meta line follow the
  same rule). Applied to Memories, Subconscious, Saved, firings, an opened
  title, `replaces`, search hits and the tail. A short date standing alone
  (`(10-09)`, `10-09: `, `… 10-09`, review) reads the same way, as this
  year's (`feed.ts#isoShortDates`); not a date, left as written: part of a
  longer number or name (`#10-09`, `v10-09`, `0.10-12`, `10-09-2026`, a path),
  a time (`10:09`, `10-09:30`), a range of something (`10-20 lines`,
  `10-20%`: a list of unit words), an impossible day (`13-09`, `02-30`). Not
  touched: memory text and the dream's (an opened memory still reads
  "Investigation 2026-10-10"; Mike's rule was about titles).
- **An opened mechanism says what its firings were about**
  (`feed.ts#mechFirings`, titles read whole by `/api/memory?id=`, all reads):

  | Mechanism | What a firing shows | Source |
  |---|---|---|
  | Retrieval | each memory that came to mind or sat in the footnotes | `recall.decision` `surfaced`/`footnotes` ids |
  | Retrieval | each memory a session's replies strengthened | `recall.credit` `ids` (when credited) |
  | Emotion | the memories of a mood-matched recall | `recall.decision` ids |
  | Salience | the memory kept | `gate.deposit` `memoryId` |
  | Forgetting | the memory that faded, or was let go | `band.transition` / `memory.pruned` subject |
  | Consolidation | what rose or became core; a dream's merge (the kept memory) | `band.*` subject; `/api/dreams` changes |
  | Interference | a dream's merge; `<A> holds over <B>` for a settle | `/api/dreams`; `contradiction.settled` |
  | Reconsolidation | `<A> holds over <B>`; `<B> argued with <A>` | `contradiction.settled`; `revision.pressure` |
  | Prospective | the reminder | `prospective.*` subject |
  | Dreaming | the dream's first sentence (opened: the journal) | `dream.journaled` + `/api/dreams` |
  | Gist | the pattern the dream wrote | `/api/dreams` `gist` changes |

  **Left out, nothing to name:** a look-up (`mcp.recall` counts what it
  opened, no ids), a link flush (`associate.flush` counts pairs: so an opened
  **Association** says what it does instead, `links memories used together;
  it doesn't record which yet`, review), a flagged
  contradiction (a pair id only), a sleep cycle's fades (counts), and a
  `dream.changed` row for a dream older than the newest three. A core
  follow-up would give `associate.flush` and `mcp.recall` the ids they count.
  A dream's link changes do carry pairs, but they are Dreaming's, not
  Association's flush, so they are not shown under Association.

  **Read deeper when the panel names few** (review): `/api/mechanism?id=`
  narrates four lines from 200 rows an event name, its repeats merged. So
  Salience (every deposit narrates alike) named one memory beside 159 today,
  and Emotion none beside 27 (its mood-matched recalls are sparse: the first
  of today's was the 321st decision). When a mechanism names fewer than
  three, or fewer than it fired today, the click also reads its own event
  rows (`/api/activity?name=`, 150, doubling to 1,200, as today's counts do;
  a 500-row decision read is about 0.7 MB, on a click only) and lists up to
  eight (`register.tsx#deeperFirings`).
- **Last Dream:** no "what changed last night" list (and its two `band.*`
  reads are gone); opened, the dream's own text, up to 20 lines (no `more`:
  the dashboard has no page for one dream by id).
- **Mechanisms today stays open by default** (Mike, via the coordinator: the
  bars break up the text); the ladder still folds it when room runs out.
- **Amber only for a warning.** With the strip gone, the pane draws amber
  only in the paused banner and the pause confirm. One more place took it: the
  brain-off header's `◉` takes the stage colour of what just fired, and
  Retrieval's stage is amber; it now draws cyan for Retrieval (other stages
  keep theirs). The Retrieval and Association bars, and the brain's lit
  region, keep the stage colour.
- **Found while shooting: from 1,000 memories the header overflowed.** The
  count (`1000 memories`, 13 cells) wrapped in the 12-column header column,
  making it seven rows beside a six-row brain, so the pane ran one row long
  and its last row (the brain switches) was cut, in dd179df5 too (Mike's
  store reached 1,000 on 2026-10-10). The builder's fix wrapped it to two
  rows (`1000` / `memories`), which read oddly; in review the header's text
  column takes one cell of the two-cell gap beside the brain whenever the
  count is wider than 12, every row of it (so `COUNTERPARTS`, the day, the
  count and the search box stay aligned), and `1002 memories` is one row; the
  brain's right edge still has a cell of air. From 10,000 the count reads
  `10k+ memories` (13 cells); the dashboard has the exact number. Tests at
  999, 1000 and 12345.
- **Footprint:** Mike's store read
  `{"fpsShown":true,"rail":false,"view":"sidebar","claudeMemory":true,"brain":"turning"}`
  before and after every run; no switch was clicked. The "before" run of
  dd179df5 clicked a long saved item, which in that build opens the dashboard:
  it opened one browser tab on `#memories?id=` (a read).

#### Review of the polish round (2026-10-10, late, a separate reviewer)

Changes are above, marked "review". Seen at 200x60 and 160x48 from a frozen
copy (930ae06c), session 0464c1d3 seeded as the builder's shots were; every
state in `~/counterparts-notes/mockups/2026-10-10-mod-polish/` (the builder's
kept as `*-builder.png`).

- **Clicks are the same every time.** Open A, open B (A closes), close B,
  open A again: each did what it did the first time (`p2`–`p4` shots, and a
  pane test). An opened item still open after five minutes on the mocked
  clock (a test).
- **`more` opens that memory.** The click on the cyan `more` of a 25-line
  saved item ran `open http://localhost:4747/#memories?id=mem_8a2172cd59f2`,
  that item's id: logged by a stub `open` put first on the run's `PATH`, so
  no browser opened (a trick worth keeping for term-loop runs that click
  links). A click on the row before `more` closes the item (a test).
- **The quiet tail's 32 cells: works, with modest headroom.** Measured with a
  real newest thing (the builder's auto-mode shot had only "Counterparts is
  quiet"): the hint ends 26 cells short of the row at 200 columns, 12 at 160
  (manual mode) and 11 at 160 in auto mode. The engine's `hint` prop grows
  with the mode line, so the margin covers both today; a Claude Code release
  that draws more than ~10 extra cells outside the prop would cut
  `/counterparts opens it` again. Brittle against the engine, not against
  the data; the robust fix is the engine telling a `PromptHint` hook how wide
  its drawn line is.
- **Migrations and safety.** A stored `strip` reads as quiet and is never
  written back (a test per stored word); v0.1 copies read only `quiet` and
  `hidden` as not-full, as before. The switch code is untouched by the round
  (strip's buttons gone, nothing else). Timers left: the poll, the brain,
  the folder's recheck, the switch note's and pause confirm's 30 s (a
  safety close, kept), a title retry, a redraw after a pulse.
- **Not fixed, for Mike's eye:** a settle reads as one run-on title (`Mike:
  a great system beats … let old ones fade holds over Era PR…`): two titles
  joined by `holds over`, cut at three lines; dates inside memory and dream
  text stay as written ("Investigation 2026-10-10", the dream's "the 09-10
  line"); the search placeholder's `#999999` (earlier review).
- **Core asks:** `associate.flush` (and `mcp.recall`) to carry the memory ids
  they count, so Association can name what it linked; and the panel's
  four-line, 200-row window, which is what made the sidebar read deeper.
- **Footprint:** five runs, his preferences file read the same before and
  after each (`{"fpsShown":true,"rail":false,"view":"sidebar","claudeMemory":true,"brain":"turning"}`);
  no switch clicked; no browser tab opened; reads only on the live dashboard.

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
- **Subconscious ────**: the "Quietly available" lane, up to four, each on up
  to three lines (polish round; it was one line, cut with `…`). A `recall` call this session made with that id (or a
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
  click on a saved item nearly always opens a browser tab. (Polish round: no
  threshold; review: nothing closes by itself.) At a short pane the `open` ladder can still
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
  it; the focus never closes by itself (nor, since the review, does an opened
  item); and Last Dream's heading opens the dream while it is unfolded
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

**The dashboard down: the route this install has, and its port (2026-10-11).**
The chart used to say `counterparts dashboard`, which a plugin-only install
can't run (nothing on its PATH). It now names the route by the memory server
this session connected (`mechanisms.ts#dashboardRoutes`): `counterparts` (the
npm install's, which also wires the command) gets `counterparts dashboard`;
the plugin's own server gets `/counterparts:dashboard` (`commands/dashboard.md`,
which runs `plugin-run.sh cli dashboard` as a background Bash task, so the
server outlives the tool call and stops with the session or from `/tasks`).
No server found: the plugin route first, then `or counterparts dashboard`.
The sidebar does not start the dashboard itself; it could (a detached
`$.process.run` of the launcher), but that is a decision, not done.

The port is read as core's server reads it when no `--port` is given:
`COUNTERPARTS_DASHBOARD_PORT`, else 4747 (`mechanisms.ts#dashboardPort`; `0`,
"any free port", reads as 4747). Reads and links use it, and a link opens only
on localhost at that port (`isDashboardUrl`). **A core ask:** a dashboard
started with `--port` can't be found from here; core offers no port file or
other discovery surface. (A feed row's `url`, `feed.ts`, is still built on
4747; nothing opens it today. Thread the port in before anything does.)

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
  `cells.ts`, `feed.ts` and `mechanisms.ts` are pure. (Since 2026-10-12 the
  rest is split further: "The split" at the top has the file map.)

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

## Desktop layout (2026-10-13)

Measured live with Mike in the Claude Desktop app's Code tab, screenshot by screenshot:

- The app sets our text in a **proportional font**, not cells: about a fifth more characters fit in a
  pane's reported width, a `─` rule can run wider than the cells it was counted in and wrap every
  heading, and spaces line nothing up (the chart's `Name   ▄▄▄  3` rows came out ragged).
- Its **native buttons** (the title, the footer's switches) are drawn dark; on tron's black panel they
  were dark on dark. The Claude Code **theme keys** (`text`, `inactive`, `subtle`, `suggestion`,
  `warning`) follow the app's light or dark mode, so they are the only colours that work on both.
- A **pane width a plugin asks for is ignored**: the app keeps the width the person dragged. Asking
  for `OPEN_COLUMNS - 4` is harmless and a hint at best. The pane's own width is read from
  `bodyColumns` every drawing.
- `Svg` is **not available in a Client module** (body.tsx), so the fox's picture stays in the pane's
  own tree and the chart's bars are made of `Box`es and half-block text.

What the branch does, for the surfaces that set text in their own font (`SURFACE.prose`: `desktop`,
`vscode`; theme.ts `applyTheme(name, surface)`):

- The `desk` palette of theme keys, no panel background, no hover card; tron and cozy apply to the
  terminal only. `bg()` leaves a Box's background unset when the palette has none.
- No `─` rules. A heading's rule is a `flexGrow` spacer (body.tsx); the stage rule and the footer's
  rule are blank rows.
- The body wraps at `floor(w * 1.2)` (`bodyW`), with a blank row between items (`prose` in
  BodyState, `spaced`). The chart's rows are segments, not padding: `cw` (a name column that many
  cells wide), `fill` of `of` (a half-block bar clipped to a share of a column sized by the pane's
  own cells, `cellsW`), `grow` (a spacer), then the count.
- The fox's Svg holds the PNG alone (the half-block rects under it showed as a dark ghost edge on the
  light page; they stay only for a frame with no PNG). The fox shows down to 22 columns, scaled to fit
  (about 7 px a cell), and the rows it takes are counted accordingly. Two rows of headroom keep the
  pane from scrolling by a line.

Two changes are on **every** surface: the memories count moved to the **title row** (`headRight`,
desktop.tsx: `1511 memories · day 22`, else `1511 · day 22`, else `day 22`, by room; the brain
header keeps its count beside the brain), so the separate count row is gone and the search box row
exists only when `COUNTERPARTS_SIDEBAR_SEARCH=1`; and the footnote parser (feed.ts) turns a lead
like `Earlier (now [id]): ` into `Earlier: ` and `Unsettled — may be out of date, see [id]: ` into
`Unsettled: `, takes the id that follows the lead, and drops a trailing `(earlier: [id])` or
`(corrects [id])`.

Also for 0.3.21: the desktop has no Raster, so it has no brain yet. A static Svg of one frame of the
terminal brain's cells (`cells.ts#cellsSvg`, kept with its tests) was tried live with Mike on
2026-10-13: it drew, sat too close to the title, and didn't light up. So a stored `brain` avatar draws the
fox there, the desktop's avatar row offers animal and off only, and the stored choice stays for the
terminal. A brain that turns and lights on the desktop is for the next version.

A pane press is not a request from the person, so in auto mode the classifier can refuse the
tool call (`$.mcp.call ... refused: ... auto mode classifier ...`), on the terminal too. The switch
(and a search) then shows a short note worded to the press ("Auto mode didn't let the switch change
this. Ask Claude: ..."), never the engine's text; the scope is left as it was. A route that does not
go through the classifier (a local dashboard write) is for a later version.

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
- Since 2026-10-11 core's `mcp.recall` and `associate.flush` rows carry `ids` (at most 20)
  and `idCount`, and `mcp.recall`, `prospective.fire`, `prospective.plain` and
  `associate.flush` carry `session` when it is known (a flush's is the session that applied
  it). `feed.ts` doesn't read them yet.

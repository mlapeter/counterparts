# `web/` — where the dashboard's pieces live

A working map, not a rulebook. Split out of one 1,731-line `app.html` on
2026-09-25 with no visible change; move things when a better shape shows up.

The page is plain browser ES modules and stylesheets — no bundler, no build
step, no dependencies. `server.ts` serves them as files (see "Serving" below).

## Server side (TypeScript, runs in bun)

| file | what it is |
|---|---|
| `server.ts` | `node:http` on 127.0.0.1, the Host allowlist, `router()` (GET: `/`, `/brain` (now a redirect to `/#home`), the favicon, `/api/*`, the static files), and the POST hand-off to `actions.ts`. A store waiting for its one-time upgrade (v6 met by v7, `../upgrade.ts`) gets one calm page instead, and is tried again on every request |
| `actions.ts` | managing: `POST /api/action/<name>` — the same-origin + per-launch-token guard, argument validation, and the console's own `run()` (loaded lazily; never handed the observer source). `ACTIONS` lists them: `ask`, `note`, `remove`, `backup`, `export`, `scope`, `rebrief`, `verify`, and `doctor` (a read: the health tab's checklist, `doctor --json`) |
| `ask-voice.ts` | `toMyVoice(question, ownerName)`: Ask is the owner talking to me, so `ask` turns his question into my voice before it searches ("do you remember what I said" → "do I remember what Mike said"; his I → "you" when the store knows no name). Pure; the rules are in its header and `test/dashboard-ask-voice.test.ts`. The server reads the name (`sleep#ownerNames`) and hands `actions.ts` the string |
| `static.ts` | `resolveStatic()`: which URL paths are static files and where they live (pure; no fs) |
| `views.ts` | the index of `views/`: re-exports every view, so callers import from here |
| `views/<name>.ts` | one module per `/api` view: `meta`, `overview` (the home tab's; its "Today" lines are `today`), `memories` (`/api/memories` + `/api/memories/list`), `memory`, `search` (`/api/search`), `mind` (the self tab's; its trait bars are `traits`), `activity`, `flow-view` (`/api/flow` + `/api/node`), `health`, `pulse`, `mechanisms`, `mechanism-panel` (`/api/mechanism?id=`) |
| `views/archive-words.ts` | why a memory was archived, in plain words: one table (`ARCHIVE_WORDS`, a group phrase and a single-row phrase per reason) and one fallback for a reason nobody mapped; health's bar, the memories list and home's archived count read it |
| `views/mechanisms.ts` | `/api/mechanisms`: each mechanism's light (grey = not built, green = fired in the last 7 lived days, waiting = built and not due — a scheduled run ahead, or nothing to act on — amber = built and quiet), its `build` (built / partly / not: the pill's "partly built" tag), one evidence line, the newest backing event `seq`s. Which rows count as a firing is `adapters/mechanism-evidence.ts` — ONE judgement shared with `counterparts mechanisms` (`cli/mechanisms.ts`), which keeps its own words and its calendar window; this file owns the lived-day window and the dashboard's words |
| `views/shared.ts` | the census and small counters every view leans on |
| `views/rows.ts` | row shapes and builders more than one view uses (band bars, contested beliefs, chapters, lived days) |
| `flow.ts` | the diagram's static shape: nodes, edges, which event lights which node |
| `narrate.ts` | a durable event → one first-person sentence, with its tone (orange only for a real problem), its feed and its icon |
| `lanes.ts` | which feed an event belongs in — `home` (memory events: remembered, stronger, replaced, let go, a chapter, a handoff, sleep, a reminder) or `flow` (housekeeping) — and the home line's icon; one table, exhaustive by type |
| `reveal.ts` | id → words at render time, withholding confidential rows |
| `fired.ts` | `/api/fired`, the what-fired panel |

## Client side (browser modules)

```
app.html              the shell: header, one empty <section> per tab, #tip, #overlay,
                      the <link>s (their ORDER is the cascade order) and one <script type=module>
app.js                entry: mounts every page, the nav, the modal; boot; resize; starts the pulse
shell/
  pages.js            the page registry (nav order) and the page-module interface
  tabs.js             nav strip + showTab
  pulse.js            the 4-second poll: new events → live feeds + page hooks; store moved → page.refresh()
shared/
  tokens.css          @font-face + colour/type variables (:root) — the site's look (counterparts.ai)
  type.css            which face goes where: Outfit (--sans) for anything read as words; Courier (--mono) only for big numbers, ids, record names; loaded LAST
  vendor/             three.module.min.js (0.169.0, MIT) for the home brain
  fonts/              Outfit (variable, latin) + Courier Prime 400/700 (latin) .woff2, with their OFL licences
  base.css layout.css utilities.css   reset, header/nav, headings, the .cols grids, .foot/.tone-*/#err
  tip.css modal.css   the tooltip and the overlay card
  dom.js              $  esc
  format.js           n2 n3 pct said livedSpan headline
  dates.js            dateWords dateOr stampWords: every date the dashboard prints itself, one style
                      ("Sep 30th", the year when it is not this one; "Wed, Sep 30th" for a title).
                      No DOM, so views/mind.ts and narrate.ts use it too. Dates inside stored
                      words (memories, the journal, the wake) are shown as written
  colors.js           COL BANDCOL ACCENT (canvas needs JS values)
  absence.js          emptyBox absenceLine — the "(none yet)" / "(never run)" block
  api.js              api() (looking: GET only) and fail()
  actions.js          act() (managing: the one POST, with the page's token) and resultHtml()
  canvas.js           FACE (the canvas's face, Outfit) fit hitTest roundRect clip wrapText
  tip.js modal.js     showTip/hideTip; openModal/closeModal/section
  memory-modal.js     openMemory, copyId, removeMemory (window globals: rows use inline onclick)
  memory-marks.js .css  a memory's kind icon/colour, feeling dots, strength meter, badges;
                      feelingName (what the page CALLS a stored core: its own name
                      since the wheel v2, 2026-09-30) and feelingWord (a
                      memory's own feeling word, else its core's name)
  event-modal.js      openEvent (window global)
  doctor.js           one `doctor --json` run shared by Health's checklist and Home's health dot
  state.js            tabs {current, loaded}; live {lastSeq, fingerprint}
  widgets/            card rows table chart tiles bar feed light .css;
                      feed.js (renderFeed, live-feed registry),
                      confirm.js + .css (confirmTyped: type a phrase back to confirm),
                      light.js (the status dot: green / waiting ring / amber / grey),
                      tips.js + .css (the `?`: explaining words behind a tap or hover; one
                      copy for every page, pinned tips kept across a live refresh)
pages/<tab>/          tabs: home (was overview), memories, self (was mind), flow, health;
                      #overview and #mind still land (shell/tabs.js RENAMED)
  index.js            default export { name, mount(section), render(), refresh?, show?,
                      resize?, redraw?, onEvents?, onDeposit? }; composes its sections' markup
  sections/*.js       one panel each: `export const markup` (its <h2> + container) and
                      `paint(d)` (or `render()` when it fetches for itself)
  <tab>.css           styles only this page uses (home, memories, self, flow, health)
mechanisms/
  index.js            MECHANISMS (the site's eleven, in its order) and FAMILIES (its four, with colours)
  <id>/index.js       default export { id, family, name, short, tagline, does, explainer,
                      built, inDevelopment }; the light (and its big number) come from
                      /api/mechanisms
  <id>/panel.js       picture(payload): the Explorer panel's list of our memories (every
                      built mechanism has one since home round 3b)
  picture.js          the pictures' shared pieces
  regions.js          brain regions → mechanisms, as the site maps them
```

Moving a section between pages: import its module in the other page's
`index.js`, put `${section.markup}` where it should sit, call its `paint` from
that page's `render` with the right payload (the data comes from that page's
`/api` view — a section may need its view to grow a field). Its CSS may live in
a page stylesheet; move that too.

A hash can carry more than the tab: `#self/settling` (an anchor) or
`#memories?state=archived` (a query). `shell/tabs.js#parseRoute` splits it, and
the page's optional `route({ anchor, params })` is called once the page is
drawn. Everything on the home tab links this way.

The home page (round 4, 2026-09-28, a try): the best pictures from the other
tabs, each a way into its own tab, for someone who knows none of the details.
Top to bottom: one headline (`sections/hero.js`, "Day 7 with Mike · 306
memories · 13 new today" — `views/overview.ts#heroHeadline`; the owner's name
is sleep's `ownerNames`, a zero "new today" is left out) with a health dot
beside it (`shared/doctor.js`: the Health tab's doctor run, said in a few
words, linked to `#health`); the brain (`sections/brain.js` feeds `brain.js`
its lights from `/api/mechanisms`; a click on a region goes to
`#health/mechanisms?id=<its first mechanism>`, and a point's name shows only on
hover) beside "Today" (`sections/today.js`, `views/today.ts`: a few plain lines
about memory — written today, became core, the day's dream, let go — each a
memory card or a place on another tab; no event names, bytes or paths; an
empty today falls back to the most recent lived day and says which); then "How
it feels" (the one feelings chart both tabs draw, `shared/widgets/feel-radar.js`;
a click opens `#memories?feeling=<core>`) beside "Around the core" (the Self
tab's map, `pages/self/sections/map.js`, with `{ legend: "min" }`). No tips.
The memory count is `views/shared.ts#memoriesLive` — what the memories list's
"live" chip counts, and what the memories header says; the console's
`Memories:` (doctor, status, the wake preface) counts memory rows only, so the
two differ by the people and project cards. Gone in round 4: the four tiles,
the written-vs-came-back chart (`views/written-returned.ts`), Tonight
(`views/tonight.ts`), the live feed (Home's filtered, folding live feed with
it) and the header's store, day and last-event chips.

`pages/home/brain.js` is the three.js brain, imported statically from
`shared/vendor/three.module.min.js` (0.169.0, MIT, `MIT-three.txt` beside it;
never a CDN). It sets `#home-brain[data-ready]` once it is drawing or has
fallen back to a sentence. `mechanisms/regions.js` maps brain regions to
mechanisms, as the site does.

The mechanism pills and panel ("How the memory works") are the Health tab's
last section since round 4: `pages/health/sections/mechanisms.js`, behaviour
unchanged, its styles in `health.css`. The panel's picture comes from
`mechanisms/<id>/panel.js` (export `picture(payload)`, pure markup), gathered in
`PANELS` in `mechanisms/index.js` beside `guideUrl(id)`. Its data comes from
`/api/mechanism?id=` (`views/mechanism-panel.ts`: last firings narrated, plus a
`picture`, both read-only). `mechanisms/picture.js` holds the pictures' shared
pieces. A mechanism built later gets a `panel.js`, one line in `PANELS`, and a
case in `mechanism-panel.ts`. The pills are one line that scrolls sideways
inside itself (`.mechs`), each with its stage as a small colour mark. The panel
is the same three things for every mechanism: one big number (`lead` on each
light, picked from the evidence parts by `LEADS` in `views/mechanisms.ts`), the
memories behind it (at most `PICTURE_ROWS` in `views/mechanism-panel.ts`), and
the module's one `does` line. The rest (the site's line, the explainer, the
firing line, built / in development, Lately, the Field Guide link) is behind a
"how it works" fold, closed by default and kept open for the tab's session
(sessionStorage). Anything that says who is close to the core asks
`views/core-road.ts`, a thin wrapper over sleep's `aboutMe` and physics'
`promotionEligibility`; nothing here re-derives eligibility. A sleep that only
checked and found nothing due (`lanes.ts#isSleepCheck`) goes to the flow feed.

`pages/memories/` — the memories tab (round 4, 2026-09-28, a try: it reads for
someone who knows roughly what it is). The whole tab is one column capped at
60rem (`#tab-memories` in `memories.css`, 2026-09-30), so a row's words keep a
readable length on a wide window. The top says who "I" am once (the name
lives in `shared/voice.js`, nowhere else) and the count once, like Home.
`state.js` holds the page's filters (live/archived/all — "kept · put away ·
both" on the page — kind, core, journal, hold, feeling, sort, page offset) and
`find` (the find box is answering); any filter change ends a find. A live
refresh redraws from it and puts the scroll back, and `counterparts:changed` (a
window event, fired after a note and after a removal on the memory card) makes
the page re-read at once. `row.js` is the one row shape the list and the find
box's answers share: every row the same brightness, "fading" as a word only
when it applies, no kind tag on a plain fact, a journal chapter titled
"Journal · Sun, Sep 27th", and the row's own date left out of its title's
trailing brackets and its words' front when the right-hand column already
shows it (`withoutRowDate`, 2026-09-30; the card shows the memory as stored). Sections: `hold.js` ("How well I remember", 2026-09-30:
one square per memory, firm / settling / fading from `holdOf` in
`views/memories.ts`, each keyed underneath with its exact count and a sentence
true to that rule; beside the feelings chart the grid keeps to the height that
chart takes, and when it would not fit a square stands for 2, 5, 10, 20 …
memories, `waffleScale`, the smallest that fits, every state with a memory
keeping at least one square, and the key says "each square is N memories"; the
journal is a line of its own under the key, not in the grid; a square, a key or
the journal line clicked filters the list; the grid is laid out again on
`show`/`resize`), `feel.js` (the shared feelings chart, `shared/widgets/feel-radar.js`,
which Home draws too; an axis clicked filters the list), `list.js` (every
memory, newest or oldest first, twenty a page, two rows of chips with a few
words each on hover, paged on the server by `/api/memories/list` in
`views/memories.ts`, which also groups several put-away versions of one memory
into one row), `search.js` (ONE box with a "by word | facts | by meaning" switch
beside it, `state.js#find.mode`, 2026-09-30, three ways since 2026-10-09: by
word finds as you type, `/api/search`, and Enter only runs it at once; facts
and by meaning ask on Enter via `act("ask", {json:true, mode, page})`, the
console's `ask --json --mode`, and draw the answer it returned — facts every
match, counted and paged, with who said it, when and what it was before; by
meaning the arc, chapters in time order with their moments and feelings —
through pure functions (`factsRows`, `meaningRows`, …) that
`test/dashboard-ask-answers.test.ts` feeds real answers; the switch never flips
by itself; when the words find fewer than `CLOSE_BELOW`,
`views/search.ts#closeMatches` adds "close matches", a typo or two away over
titles and words, the dashboard's own pass with `store.search` untouched; the
answers take the list's place and "×" gives it back; the search's words are
marked where they appear in an answer (`row.js#marked`, whole words as the
word index splits them, escaped first; for Ask, the question's longer words),
and a memory id written in a row's words is a small link to it
(`memory-marks.js#idMark`); the question is turned into my voice server side
by `ask-voice.ts`), and `tools.js` (add a memory, and the
back-up/export folder dialog). `views/memory-words.ts` says how a row's words
are shown (a date at their front lifted off, a journal chapter's heading lifted
off, feelings in words); archive reasons come from `views/archive-words.ts`.
`shared/memory-marks.{js,css}` are the kind icons and colours, feeling dots and
the badges, used by the rows and the memory card (`shared/memory-modal.js`: the
words, how well I remember it — a chart from `fadeCurve` in
`views/mechanism-panel.ts`, the Forgetting panel's own maths, and one plain
sentence — why it mattered, the day it was written, then everything else under
"details"). The card's sentences that read the payload — the road to the core
(the engine's verdict, `views/memory.ts#coreRoad`, from
`physics#promotionEligibility`; the fast lane named when it applies), where the
curve starts ("written" until a real use), and the Versions rows (a dream's
near-copy merges named and grouped) — are pure functions in
`shared/memory-card-words.js`, checked in `bun test`.

`pages/self/`: the self tab (reworked 2026-09-26 as an experiment; round 3b,
2026-09-27, prefers a picture to a paragraph). The top is two columns: the self
page on the left (rendered by `markdown.js`, which escapes first), and a side
column with the page's history as ONE strip and the wake as a short list.
`sections/page.js` draws the page and the strip: one dot per lived day from the
page's first version to the newest lived day (`pageDays` in `views/mind.ts`). A
filled dot is a day it was rewritten; clicking it opens that day's newest
version above the page, diffed against the one before with `diff.js` (line
comparison, then words, no deps). Who rewrote it and why is said in plain
words (`rewriteWords`: the reasons a door writes by itself, like the
reflection's, become words; anything else is quoted with its ids left out;
the record is untouched). A hollow dot is a day it was not; hover or
tap it for why, in the page writer's own recorded words (the newest
`pageWriterRuns` row that happened that lived day, read through `self/`'s
`pageWriterStatus` and worded by `writerWords`), or "no record" when there is
none. A version sits on the lived day it was WRITTEN (`PageVersion.day` is the
day it was replaced). Nothing is open by default. A page
`PAGE_BEHIND_LIVED_DAYS` or more lived days old gets one calm line above it
(`pageBehind`: when it was written, and the lived days, chapters and dreams
since). `sections/settling.js` is one line of counts (core, protected, argued
with; each opens its list), then the self map, then what crossed lately. The
self map (`sections/map.js` + `views/self-map.ts`, an experiment kept in those
two files so it is easy to change or take out) draws the memories about me or
about us as dots, as bright as they are firmly held, in three rings named on
the map itself (round 4, 2026-09-28: no legend): "who I am" (the core, in the
middle), "almost there" (ready, or one awake return away) and "about me and
us" (the rest, nearer the middle the closer to the core). The core and the
almost-there dots carry short titles, placed so none overlaps another or a dot
(a pure function of the data and the width, text widths estimated from a
table), the rest counted as "+N more" when room runs out; the other dots are
unnamed and fainter. The association links (`edgesFrom`) are hidden until a
dot is hovered, focused or tapped, and then only that dot's show; one caption
sits under it. Click for the card (on a touch screen, the first tap shows the
links and words, the second opens it). Who is drawn and how close each is comes
from `coreCandidates` (`physics#promotionEligibility` in the engine's own
context: `aboutMe`, the lived day, the owner's demotion; a memory he sent back
is not drawn), and the faint ring is `oneReturnAway`; the layout is a pure
function of the data, so a live refresh draws the same picture. `settling.candidates`
(the five closest) stays in the view. `sections/traits.js`
("How I act", 2026-09-27, a try) sits under the settling panel: the seven trait
axes (`store/traits.ts#TRAIT_AXES`) as thin spectrum bars, the left pole's word,
a track, a marker, the right pole's word, and how many memories stand behind
it; an axis's gloss is behind a `?`. The balance is `views/traits.ts`
(`balanceOf`): each nudge counts `strength × firmness` (the memory's strength on
today's lived day; a core memory counts 1), signed −1 toward `poles[0]` and +1
toward `poles[1]`, over Σ unsigned; the bar, its list and its count are the
live memories. A faint marker is the same over the nudges recorded 7 or more
calendar days ago, weighed by each memory's firmness 7 lived days ago
(`firmnessThen`: core membership, returns and feelings rolled back exactly; a
memory used since reads as used that day, a ceiling, since uses keep no
history), and it still counts memories archived or merged away since (a merge's
copied nudge counted once). A confidential memory's nudge moves the bar and its
words show as "withheld". An
axis with nothing behind it draws an empty track and no marker. Tapping a row
lists its memories (each opens its card); `state.js#trait` keeps it open.
`sections/wake.js`
is "Next time I wake, I start with:" — the page and its age, the nearby
memories by title (the hints lane's open `wake_display` rows, each opening its
card; the lane's own lines on an older store), anything arriving (the horizon
lane: the wake keeps no ids for it, so `views/mind.ts#arrivingOf` matches each
line back to a dated memory by its words; shown like the nearby ones, by title
or first sentence, and a line nothing matches is its first sentence) — and
"read it" for the whole wake. `sections/journal.js` is a strip of days, each with its date in one
format (the view's `iso`: the chapter heading's date, else the entry's own), its
lived day and "N chapters"; a day lists its chapters, a chapter opens in place. The `?` that holds each explaining line is
`shared/widgets/tips.js`; `state.js` holds what is open, so the pulse's `refresh()` (which redraws only
the panels whose data moved) keeps it open. `sections/stories.js` is only
`storyCard`, opened in the overlay. The view is still `views/mind.ts` / `/api/mind`.

The health tab answers "is it working?": `pages/health/sections/checks.js` runs
`counterparts doctor --json` through the actions seam (a read; a dashboard
opened on a bare `--dir` arms the explicit-dir guard for that run, so the
settings line reads "not checked") and draws its findings as a checklist,
folding the non-headline greens the way `cli/report.ts` does; `cycle.js` is the
last sleep cycle as one line with a dot per phase; `wake.js` (round 3b, moved
from the self tab) answers "is the wake overflowing?" in one compact row: its
size against the ceiling the newest `self.briefing` row recorded, as a stacked
bar of its parts (`wakeParts`, cut at the lane headings from `self/`), amber
when that render had to trim to fit (`healthView#wake`); `archive.js` is one stacked
bar of `archived_reason` (plain phrases in the shared archive-words module,
unknown reasons get their own segment); `verify.js` is "Check the index"
(`verify` through the seam). The developer panels (band symmetry, what fired,
every durable record, the day × event grid, what I cannot see) live under the
flow diagram as "Under the hood"
(`pages/flow/sections/{symmetry,fired,records,heatmap,blind}.js`), still fed by
`/api/health` and `/api/fired`. On a bare `--dir` dashboard every action runs
with the explicit-dir guard, COUNTERPARTS_CONFIG removed, and home pointed at a
nonexistent dir (doctor keeps the real home for its ~/.claude check), so no
action can reach a default config.

Harness hooks `tools/visual-loop` relies on: `window.tileValue`,
`window.flowState`, `window.particleCount`, `document.documentElement.dataset.loaded`,
`#home-brain[data-ready]`, and the element ids it clicks (`#mlist .mrow`, `#flowcv`, `#overlay`, …).

## Serving

`resolveStatic` serves only `/app.js` and files under `/shared/`, `/shell/`,
`/pages/`, `/mechanisms/`, with extension `.js`, `.css` or `.woff2`; every path
segment must be plain (no `..`, dotfiles, `%`-escapes left after one decode,
backslashes, NUL). A new top-level folder or extension means editing
`static.ts` (and its test). Everything is `cache-control: no-store`, so an edit
shows on reload. `test/dashboard-web.test.ts` checks that every file the shell
reaches exists and is served, and that no `.js`/`.css` under `web/` is orphaned.
`test/dashboard.test.ts`'s source scan covers the `.js` files too.

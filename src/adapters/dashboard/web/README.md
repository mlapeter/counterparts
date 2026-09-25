# `web/` — where the dashboard's pieces live

A working map, not a rulebook. Split out of one 1,731-line `app.html` on
2026-09-25 with no visible change; move things when a better shape shows up.

The page is plain browser ES modules and stylesheets — no bundler, no build
step, no dependencies. `server.ts` serves them as files (see "Serving" below).

## Server side (TypeScript, runs in bun)

| file | what it is |
|---|---|
| `server.ts` | `node:http` on 127.0.0.1, the Host allowlist, `router()` (GET: `/`, `/brain` (now a redirect to `/#home`), the favicon, `/api/*`, the static files), and the POST hand-off to `actions.ts` |
| `actions.ts` | managing: `POST /api/action/<name>` — the same-origin + per-launch-token guard, argument validation, and the console's own `run()` (loaded lazily; never handed the observer source). `ACTIONS` lists them: `ask`, `note`, `remove`, `backup`, `export`, `scope`, `rebrief`, `verify`, and `doctor` (a read: the health tab's checklist, `doctor --json`) |
| `static.ts` | `resolveStatic()`: which URL paths are static files and where they live (pure; no fs) |
| `views.ts` | the index of `views/`: re-exports every view, so callers import from here |
| `views/<name>.ts` | one module per `/api` view: `meta`, `overview` (the home tab's), `memories` (`/api/memories` + `/api/memories/list`), `memory`, `search`, `mind` (the self tab's), `activity`, `flow-view` (`/api/flow` + `/api/node`), `health`, `pulse`, `mechanisms`, `mechanism-panel` (`/api/mechanism?id=`) |
| `views/archive-words.ts` | why a memory was archived, in plain words: one table (`ARCHIVE_WORDS`, a group phrase and a single-row phrase per reason) and one fallback for a reason nobody mapped; health's bar, the memories list and home's archived count read it |
| `views/mechanisms.ts` | `/api/mechanisms`: each mechanism's light (grey = not built, green = fired in the last 7 lived days, amber = built and quiet), one evidence line, the newest backing event `seq`s. `MECHANISM_PROOFS` is the one table saying which durable rows count as a mechanism firing |
| `views/shared.ts` | the census and small counters every view leans on |
| `views/rows.ts` | row shapes and builders more than one view uses (band bars, contested beliefs, chapters, lived days) |
| `flow.ts` | the diagram's static shape: nodes, edges, which event lights which node |
| `narrate.ts` | a durable event → one first-person sentence |
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
  colors.js           COL BANDCOL ACCENT (canvas needs JS values)
  absence.js          emptyBox absenceLine — the "(none yet)" / "(never run)" block
  api.js              api() (looking: GET only) and fail()
  actions.js          act() (managing: the one POST, with the page's token) and resultHtml()
  canvas.js           FACE (the canvas's face, Outfit) fit hitTest roundRect clip wrapText
  tip.js modal.js     showTip/hideTip; openModal/closeModal/section
  memory-modal.js     openMemory, copyId, removeMemory (window globals: rows use inline onclick)
  event-modal.js      openEvent (window global)
  state.js            tabs {current, loaded}; live {lastSeq, fingerprint}
  widgets/            card rows table chart tiles bar feed light .css;
                      feed.js (renderFeed, live-feed registry), chapters.js (chapterRows),
                      confirm.js + .css (confirmTyped: type a phrase back to confirm),
                      light.js (the status dot: green / amber / grey)
pages/<tab>/          tabs: home (was overview), memories, self (was mind), flow, health;
                      #overview and #mind still land (shell/tabs.js RENAMED)
  index.js            default export { name, mount(section), render(), refresh?, show?,
                      resize?, redraw?, onEvents?, onDeposit? }; composes its sections' markup
  sections/*.js       one panel each: `export const markup` (its <h2> + container) and
                      `paint(d)` (or `render()` when it fetches for itself)
  <tab>.css           styles only this page uses (home, memories, self, flow, health)
mechanisms/
  index.js            MECHANISMS (the site's eleven, in its order) and FAMILIES (its four, with colours)
  <id>/index.js       default export { id, family, name, short, tagline, inDev, explainer };
                      the light comes from /api/mechanisms
  <id>/panel.js       picture(payload): the Explorer panel's picture, where one is drawn
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
drawn. The home hero's four counts are links of this kind.

The home page is the site's hero plus Explorer. `pages/home/brain.js` is the
three.js brain, imported statically from `shared/vendor/three.module.min.js`
(0.169.0, MIT, `MIT-three.txt` beside it; never a CDN). It sets
`#home-brain[data-ready]` once it is drawing or has fallen back to a sentence.
`mechanisms/regions.js` maps brain regions to mechanisms, as the site does.
`sections/explorer.js` owns the pills and the inline panel. The panel's picture
comes from `mechanisms/<id>/panel.js` (export `picture(payload)`, pure markup),
gathered in `PANELS` in `mechanisms/index.js` beside `guideUrl(id)`. Its data
comes from `/api/mechanism?id=` (`views/mechanism-panel.ts`: last firings
narrated, plus a `picture`, both read-only). `mechanisms/picture.js` holds the
pictures' shared pieces. A mechanism built later gets a `panel.js`, one line in
`PANELS`, and a case in `mechanism-panel.ts`.

`pages/memories/` — the memories tab. `state.js` holds the page's filters
(live/archived/all, kind, band, page offset) and notifies the list when they
change; `counterparts:changed` (a window event, fired after a note and after a
removal on the memory card) makes the page re-read at once. Sections:
`search.js` (search by words, plus Ask via `act("ask", {json:true})` rendered
as a list), `tools.js` (write a note, and the back-up/export folder dialog),
`constellation.js` (the one picture: the scatter, band chips that filter,
strength-by-band in the right margin), `kinds.js` (six kinds in words; click to
filter), `list.js` (every memory, newest first, paged on the server by
`/api/memories/list` in `views/memories.ts`, whose archive reasons are put into
plain words by `archiveWords` from `views/archive-words.ts`).

`pages/self/`: the self tab. `sections/page.js` is the self page (rendered by
`markdown.js`, which escapes first) and its history as a timeline; clicking a
dot diffs that version against the one before with `diff.js` (line comparison,
then words, no deps). `sections/settling.js` covers the core, protected and
contested memories, plus the closest candidates for the core; the view computes
them with `physics#promotionEligibility` and counts memories that can't get
there by use separately. `sections/wake.js` is the wake folded to one line and
a stacked bar of its parts (`wakeParts` in `views/mind.ts`, cut at the lane
headings from `self/`), plus the rebrief button. `sections/journal.js` shows
chapters by day with their model. `sections/stories.js` is only `storyCard`,
opened in the overlay. The view is still `views/mind.ts` / `/api/mind`.

The health tab answers "is it working?": `pages/health/sections/checks.js` runs
`counterparts doctor --json` through the actions seam (a read; a dashboard
opened on a bare `--dir` arms the explicit-dir guard for that run, so the
settings line reads "not checked") and draws its findings as a checklist,
folding the non-headline greens the way `cli/report.ts` does; `cycle.js` is the
last sleep cycle as one line with a dot per phase; `archive.js` is one stacked
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

# `web/` — where the dashboard's pieces live

A working map, not a rulebook. Split out of one 1,731-line `app.html` on
2026-09-25 with no visible change; move things when a better shape shows up.

The page is plain browser ES modules and stylesheets — no bundler, no build
step, no dependencies. `server.ts` serves them as files (see "Serving" below).

## Server side (TypeScript, runs in bun)

| file | what it is |
|---|---|
| `server.ts` | `node:http` on 127.0.0.1, the Host allowlist, `router()`: `/`, `/brain`, the favicon, `/api/*`, and the static files |
| `static.ts` | `resolveStatic()`: which URL paths are static files and where they live (pure; no fs) |
| `views.ts` | the index of `views/`: re-exports every view, so callers import from here |
| `views/<name>.ts` | one module per `/api` view: `meta`, `overview`, `memories`, `memory`, `search`, `mind`, `activity`, `flow-view` (`/api/flow` + `/api/node`), `health`, `pulse` |
| `views/shared.ts` | the census and small counters every view leans on |
| `views/rows.ts` | row shapes and builders more than one view uses (band bars, contested beliefs, chapters, lived days) |
| `flow.ts` | the diagram's static shape: nodes, edges, which event lights which node |
| `narrate.ts` | a durable event → one first-person sentence |
| `reveal.ts` | id → words at render time, withholding confidential rows |
| `fired.ts` | `/api/fired`, the what-fired panel |
| `brain.html` | the `/brain` page (self-contained; slated for removal) |

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
  tokens.css          colour/size variables (:root)
  base.css layout.css utilities.css   reset, header/nav, headings, the .cols grids, .foot/.tone-*/#err
  tip.css modal.css   the tooltip and the overlay card
  dom.js              $  esc
  format.js           n2 n3 pct said livedSpan headline
  colors.js           COL BANDCOL ACCENT (canvas needs JS values)
  absence.js          emptyBox absenceLine — the "(none yet)" / "(never run)" block
  api.js              api() (the only fetch; GET only) and fail()
  canvas.js           fit hitTest roundRect clip wrapText
  tip.js modal.js     showTip/hideTip; openModal/closeModal/section
  memory-modal.js     openMemory, copyId (window globals: rows use inline onclick)
  event-modal.js      openEvent (window global)
  state.js            tabs {current, loaded}; live {lastSeq, fingerprint}
  widgets/            card rows table chart tiles bar feed .css; bar.js (bandBars),
                      feed.js (renderFeed, live-feed registry), chapters.js (chapterRows)
pages/<tab>/
  index.js            default export { name, mount(section), render(), refresh?, show?,
                      resize?, redraw?, onEvents?, onDeposit? }; composes its sections' markup
  sections/*.js       one panel each: `export const markup` (its <h2> + container) and
                      `paint(d)` (or `render()` when it fetches for itself)
  <tab>.css           styles only this page uses (memories, mind, flow, health)
mechanisms/<name>/    (empty for now) one folder per memory mechanism — explainer, store
                      reader, panel — served like pages/
```

Moving a section between pages: import its module in the other page's
`index.js`, put `${section.markup}` where it should sit, call its `paint` from
that page's `render` with the right payload (the data comes from that page's
`/api` view — a section may need its view to grow a field). Its CSS may live in
a page stylesheet; move that too.

Harness hooks `tools/visual-loop` relies on: `window.tileValue`,
`window.flowState`, `window.particleCount`, `document.documentElement.dataset.loaded`,
and the element ids it clicks (`#hubs .r`, `#flowcv`, `#overlay`, …).

## Serving

`resolveStatic` serves only `/app.js` and files under `/shared/`, `/shell/`,
`/pages/`, `/mechanisms/`, with extension `.js`, `.css` or `.woff2`; every path
segment must be plain (no `..`, dotfiles, `%`-escapes left after one decode,
backslashes, NUL). A new top-level folder or extension means editing
`static.ts` (and its test). Everything is `cache-control: no-store`, so an edit
shows on reload. `test/dashboard-web.test.ts` checks that every file the shell
reaches exists and is served, and that no `.js`/`.css` under `web/` is orphaned.
`test/dashboard.test.ts`'s source scan covers the `.js` files too.

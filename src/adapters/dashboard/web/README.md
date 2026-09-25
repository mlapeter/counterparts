# `web/` — where the dashboard's pieces live

A working map, not a rulebook. Split out of one 1,731-line `app.html` on
2026-09-25 with no visible change; move things when a better shape shows up.

The page is plain browser ES modules and stylesheets — no bundler, no build
step, no dependencies. `server.ts` serves them as files (see "Serving" below).

## Server side (TypeScript, runs in bun)

| file | what it is |
|---|---|
| `server.ts` | `node:http` on 127.0.0.1, the Host allowlist, `router()` (GET: `/`, `/brain`, the favicon, `/api/*`, the static files), and the POST hand-off to `actions.ts` |
| `actions.ts` | managing: `POST /api/action/<name>` — the same-origin + per-launch-token guard, argument validation, and the console's own `run()` (loaded lazily; never handed the observer source) |
| `static.ts` | `resolveStatic()`: which URL paths are static files and where they live (pure; no fs) |
| `views.ts` | the index of `views/`: re-exports every view, so callers import from here |
| `views/<name>.ts` | one module per `/api` view: `meta`, `overview` (the home tab's), `memories`, `memory`, `search`, `mind` (the self tab's), `activity`, `flow-view` (`/api/flow` + `/api/node`), `health`, `pulse`, `mechanisms` |
| `views/mechanisms.ts` | `/api/mechanisms`: each mechanism's light (grey = not built, green = fired in the last 7 lived days, amber = built and quiet), one evidence line, the newest backing event `seq`s. `MECHANISM_PROOFS` is the one table saying which durable rows count as a mechanism firing |
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
  tokens.css          @font-face + colour/type variables (:root) — the site's look (counterparts.ai)
  type.css            which face goes where: body/headings Outfit (--sans), labels/numbers/pills Courier (--mono); loaded LAST
  fonts/              Outfit (variable, latin) + Courier Prime 400/700 (latin) .woff2, with their OFL licences
  base.css layout.css utilities.css   reset, header/nav, headings, the .cols grids, .foot/.tone-*/#err
  tip.css modal.css   the tooltip and the overlay card
  dom.js              $  esc
  format.js           n2 n3 pct said livedSpan headline
  colors.js           COL BANDCOL ACCENT (canvas needs JS values)
  absence.js          emptyBox absenceLine — the "(none yet)" / "(never run)" block
  api.js              api() (looking: GET only) and fail()
  actions.js          act() (managing: the one POST, with the page's token) and resultHtml()
  canvas.js           MONO (the canvas's face) fit hitTest roundRect clip wrapText
  tip.js modal.js     showTip/hideTip; openModal/closeModal/section
  memory-modal.js     openMemory, copyId, removeMemory (window globals: rows use inline onclick)
  event-modal.js      openEvent (window global)
  state.js            tabs {current, loaded}; live {lastSeq, fingerprint}
  widgets/            card rows table chart tiles bar feed light .css; bar.js (bandBars),
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
                      the light comes from /api/mechanisms. Room here for a panel per mechanism later.
```

Moving a section between pages: import its module in the other page's
`index.js`, put `${section.markup}` where it should sit, call its `paint` from
that page's `render` with the right payload (the data comes from that page's
`/api` view — a section may need its view to grow a field). Its CSS may live in
a page stylesheet; move that too.

The home page's `sections/mechanisms.js` is a TEMPORARY strip (pills + lights,
hover for the explainer and evidence, click to open the newest backing event);
the full home design replaces it.

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

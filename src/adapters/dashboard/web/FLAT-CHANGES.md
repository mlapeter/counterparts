# FLAT-CHANGES — a scratch log for the exploratory flat page

This is a running scratch log for `flat.html`, the exploratory second dashboard page
served at `/flat`. It is **not** a contract, not a rule, and not a decision record —
nothing here has been ruled on, and `app.html` at `/` is unchanged and stays the
reference. It exists so every difference from `app.html` can be read back, and put back,
without diffing 1800 lines.

`flat.html` started as a byte copy of `app.html`. Everything below is what then changed.

---

## Removed from `app.html`'s shape

- **The overview lede.** `<p class="lede" id="ov-opening"></p>` was the first element
  inside `<section class="tab" id="tab-overview">`, and `paintOverview` filled it with
  `$("ov-opening").textContent = d.opening;`. Both are gone from `flat.html`. The
  payload still carries `d.opening` — nothing server-side changed — so putting it back
  is those two lines. The mind and flow ledes are untouched.

- **The tile's third line.** `app.html`'s tile is
  `<div class="n">…</div><div class="l">…</div><div class="s">note</div>`. On `flat.html`
  a tile is two lines, and the note is the tile's `title=` (a hover tooltip). The
  markup now comes from one `tileHTML(t)` function. The `.tile .s` CSS rule is still
  in the file, unused — deleting the `title=` and restoring the `<div class="s">` line
  inside `tileHTML` puts the old shape back.

- **Four of the ten overview tiles.** `OV_TILES` (a const beside `tileHTML`) names the
  six the overview keeps: `lived days`, `memories held`, `beliefs and entities`,
  `archived`, `identity band`, `protected`. The other four — `journal entries`,
  `contested beliefs`, `last cycle`, `wake bytes` — are filtered out of `#ov-tiles` and
  painted into a new `<div class="tiles" id="h-tiles"></div>` at the top of
  `<section id="tab-health">`, from the same `/api/overview` payload, by the same
  `paintOverview`. The split is entirely client-side and matches on the payload's own
  `label` strings, verbatim; `views.ts` is untouched and still returns all ten in one
  array in the same order. To undo: delete the filter (`.filter((t) => OV_TILES…)`),
  the `#h-tiles` paint, and the `#h-tiles` div.

- **The per-bar gloss lines.** "Where every memory sits" rendered three bars each
  followed by `<div class="gloss">b.note</div>`. On `flat.html` the gloss is the bar
  row's `title=` and the `.gloss` CSS rule is deleted (the `@media(max-width:520px)`
  rule that reset its margin lost that clause too). Still three bars — episodic,
  semantic, identity — and the footnote sentence (`d.bandNote`) under them is unchanged.

- **The feed row's shape.** `app.html`'s row is two columns — `day N` and a block that
  wraps the whole narrated sentence with the event name as a small second line under it.
  `flat.html`'s row is three columns on one line each:
  `hh:mm:ss` (local wall clock from `e.at`, dim, tabular) · `e.name` in bold, nowrap,
  142px · the plain headline, nowrap, ellipsis. Row padding `7px 14px`, font-size 11px,
  so about thirteen rows fit the 440px panel instead of four or five. Tone colours moved
  from `.ev .t` to `.ev .h` (amber → `--amber`, notable → `--ink`, calm → `--dim`), and
  `.ev.notable`'s hardcoded `#dfe6ee` became `var(--ink)`. A `@media(max-width:560px)`
  rule drops it to two columns with the name under the headline. The classes `.ev .t`
  and the old `.ev .k` block styling are replaced, not kept.

- **Hardcoded canvas colours.** `const COL = {…}` with six hex literals became
  `readPalette()`, which resolves every colour from a `:root` custom property. The
  canvas literals `#39424d`, `#5c6773`, `#c5cdd8`, `#0d1117`, `rgba(0,229,255,.07/.12/
  .18/.42)`, `rgba(255,215,64,.24/.5)` and `rgba(92,103,115,.95)` now read `COL.muted`,
  `COL.dim`, `COL.ink`, `COL.card`, `COL.grid`, `COL.axis`, `COL.edge`, `COL.arrow`,
  `COL.edgedot`, `COL.arrowdot`. The heatmap cell's inline `rgba(0,229,255,a)` became
  `rgba(var(--heat),a)`, which recolours with no repaint at all.

- **Inline bar colours.** Bars used to carry `style="background:#hex;box-shadow:0 0 9px
  #hex55"`. They now carry `style="--c:var(--cyan)"` (`BANDVAR`, or `var(--amber)` /
  `var(--teal)` on the contested card), with `.bar .fill{background:var(--c)}` and the
  glow's box-shadow as a `:root[data-theme="glow"]` rule using `color-mix`. Same three
  places: `ov-bands`, `mem-bands`, `contestedCard` — and the same swap in the
  constellation legend's `.chip` dots, which `applyTheme` does not repaint.

## Added

- **The route.** `server.ts` gains `const FLAT_PATH = join(HERE, "flat.html")` and
  `if (path === "/flat") return page(FLAT_PATH);` beside the `/` and `/brain` routes.
  Same `page()` helper, same Host allowlist (checked before any route), same `no-store`
  headers, same favicon behaviour. The `node:fs` import is still exactly
  `{ readFileSync }`. One comment in the header changed "two static HTML files" to "the
  static HTML pages".

- **Two themes, flat the default.** `:root{…}` is now the flat palette and
  `:root[data-theme="glow"]{…}` restores today's. Flat values: `--bg:#0a0e14`
  `--card:#0d1117` `--hover:#111820` `--border:#1c2430` `--glow:#2a3548` `--cyan:#56d4dd`
  `--purple:#b78af7` `--amber:#e0b45c` `--teal:#4fd6a8` `--red:#e06c75` `--radius:10px`
  `--hovershadow:none`, plus `--deep:#070b11` for the few surfaces that used it. The
  **text ramp stays v2's measured one in both themes** — `--ink:#c9d4e3` (flat) /
  `#c5cdd8` (glow), `--dim:#8a95a3`, `--faint:#79848f`. v1's flat `--dim` of `#6b7a90`
  measures 4.43:1 and is under the AA floor the visual loop enforces; it survives only
  as `--cdim`, a chart fill, never text.

  Every glow-only rule is now under a `:root[data-theme="glow"]` selector: `body::after`
  (scanlines), the h1's uppercase/letter-spacing/weight-300/text-shadow, `.tile .n`'s
  weight-300 + text-shadow and the three per-accent text-shadows, the tile/card hover
  box-shadow, `.bar .track`'s `--deep` background and translucent-cyan border, the bar
  fill's box-shadow, `.beat .track`'s background and border, `#modal`'s box-shadow and
  8px radius, `#q:focus`'s box-shadow, and `.badge.ok`'s translucent teal border. In
  flat, h1 is lowercase `counterparts` at 19px/700/normal spacing, `.tile .n` is
  22px/600, and the bar track is `var(--bg)` with no border.

- **The theme chip.** `<button id="theme" onclick="toggleTheme()">` in the header,
  styled like a badge. `toggleTheme()` flips the attribute, persists to
  `localStorage["counterparts-theme"]` inside try/catch, calls `readPalette()` and
  redraws from the cached payloads only — `paintOverview(OVERVIEW,false)` (the feed is
  the poll's and is left alone), `drawConstellation()`/`drawHistogram()` if `MEM`,
  `drawFlow()` if `FLOW`. Nothing is refetched. A tiny `<script>` in `<head>`, before
  the stylesheet, reads the saved value and sets `data-theme` so a reload in glow does
  not flash flat first; `<html>` no longer carries a hardcoded `data-theme="glow"`.

- **The `updated hh:mm:ss` badge.** `<span class="badge" id="updated">` in the header,
  tabular numerals, set by `markUpdated()` at the end of every `poll()` that actually
  came back, inside `refreshCounters` after `/api/meta` answers, and once at the end of
  `boot()`. A poll that threw returns before it, so a stale number is the signal. The
  existing `#seen` chip ("last event / last deposit") is kept as it is — it is not in
  this page's brief either way, and keeping it is the smaller change.

- **The `glow page` link.** `<a href="/">` in the header, so the reference page is one
  click away. Its `glow ` prefix is inside `<span class="wide">`, which the existing
  720px header rule hides, leaving `page` on a phone.

- **`headline` on every narrated event.** `narrate.ts` gains `HEADLINES`, an
  `as const satisfies Record<DurableEventName, (t: Told) => string>` map beside
  `NARRATORS`, and `NarratedEvent` gains `readonly headline: string`, populated in
  `narrate()` next to `text` with its own try/catch and a fallback that is never the
  raw event name. Purely additive: every existing JSON field is unchanged, `views.ts`
  is untouched (every view already goes through `narrate()`), and `app.html` ignores
  the extra field. `Told` is now exported so the test can build a synthetic row.
  `test/dashboard-web.test.ts` gains a totality test mirroring the `NARRATORS` one:
  every `DURABLE_EVENT_NAME` has a headline, no headline is empty, none equals its own
  event name, and none ends in a full stop.

- **`feedRow(e)`.** One row-shape function used by `renderFeed` (overview and flow both)
  and by the poll's prepend, which used to build its own copy of the markup inline. The
  poll parses `feedRow(e)` into an element and adds `.flash` to it; the flash animation
  is unchanged except that its colour is now `var(--flash)`.

- **`clockOf(at)`.** `at` (ms since the epoch) → local `hh:mm:ss`, or `--:--:--` for a
  row with no readable time.

- **`window.tileValue` reads both tile rows.** The selector went from
  `#ov-tiles .tile` to `.tiles .tile`, so the four demoted labels still answer.

- **The boot waits for the overview, and only the overview.** `boot()` used to
  `Promise.all` all five tabs before setting `dataset.loaded`, so on the owner's
  store (≈15k rows) the page was blank for about seventeen seconds — the server
  answers one request at a time, so five parallel payloads queue end to end.
  Now: `/api/meta`, then `await loadTab("overview")`, then `dataset.loaded="1"`
  and the poll, and only then the other four, **sequentially**, as an idle
  prefetch (parallel prefetches would put the four-second poll behind all of
  them). A tab switched to before its payload lands gets the same `loadTab` and
  shows a `loading…` absence line in that tab rather than a blank panel;
  `loading[tab]` holds the in-flight promise so the switch and the prefetch are
  one request. Three supporting pieces, all new:
  `lastSeq` is seeded from the overview payload's own feed (it used to come from
  the flow payload, which boot no longer waits for — an unseeded cursor makes
  the first poll treat the whole kept window as newly arrived), `renderFlow`
  never moves it backwards, and `refreshCounters` re-reads `/api/flow` only when
  the diagram is on screen, marking `flowStale` otherwise and paying for it on
  the way back to that tab. `window.tileValue`, `window.flowState` and
  `window.particleCount` all still answer — `flowState` from the moment the flow
  prefetch lands. `app.html` is untouched, and so is every `/api/*` payload.

- **One tick at a time, and the poll in front of the prefetch.** Three additions
  beside the boot change above, all of them about the four-second poll on a store
  slow enough for a tick to outlive its interval. `pollBusy` drops a tick that
  arrives while the previous one is still running (`poll()` is now the guard and
  `pollOnce()` the body) — the interval used to stack: two `/api/activity` reads,
  two `/api/meta` reads, and two identical `/api/overview` refetches queued to
  paint the same tiles twice. `refreshOverview()` holds the overview refetch to
  one in flight with a TRAILING run (`overviewBusy`/`overviewAgain`): a refresh
  asked for while one is in flight starts no second request and is not dropped
  either — it runs once when the first lands, so the tiles end on the payload
  asked for last. And the idle prefetch loop waits out a tick in flight before
  starting the next tab, so at most one prefetch sits in front of a poll on the
  wire instead of four. Verified in a browser: three writes inside one tick
  window → one `/api/overview` refetch, tiles 121 → 124, zero console errors.
  `app.html` untouched; no `/api/*` payload changed.

## Unchanged, on purpose

- `app.html`, `brain.html`, every `/api/*` route and every existing JSON field.
- The event modal: it still shows the full narrated sentence (`e.text`) and every
  `detail` field. The headline appears only in the feed row.
- Everything else on the overview — chapters, "who I am", permanent ink, beliefs under
  argument — and the memories, mind, flow and health panels below the new tile row.
- The 720px phone header rules, extended only so `.hright button` gets the same 44px
  minimum height `.hright a` already had.

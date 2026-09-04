# `tools/visual-loop` — look at the dashboard, and fail on anything it says

A dashboard is judged by eye. A change that silently breaks one panel is
invisible to a suite of JSON assertions, and a console error is invisible to
everybody until a stranger opens the page. So this seeds its own stores, starts
the real server on a free port, opens every page and every tab in a real
browser, screenshots each one, and **exits non-zero on a single console error,
page error or failed request.**

It also measures the two things a screenshot cannot tell you, because a design
review found both by hand and neither should ever have to be found by hand
again:

- **Text contrast**, as a WCAG ratio, computed in the page against the first
  background an ancestor actually paints. The per-memory metadata row — the line
  carrying what was remembered and when — measured **1.86:1** before this
  existed, and the narration lede measured **3.35:1**. Anything under **4.5:1**
  fails the run.
- **Horizontal overflow.** The page body must never scroll sideways. A mobile
  emulator hides this by *widening the layout viewport* when content refuses to
  shrink, so `scrollLeft` stays 0 and the failure is invisible; a 390 request
  that reports `innerWidth: 448` has already failed, and the run says so.

And it causes **one real event** on the rich store, from an open page, because
two of this dashboard's claims cannot be checked any other way: that particles
ride only on real events, and that the flow diagram's counters are live rather
than fetched once at boot.

## Once, per machine

```sh
~/.bun/bin/bun install                      # playwright is a pinned devDependency
~/.bun/bin/bunx playwright install chromium # ~95 MB, into ~/Library/Caches/ms-playwright
```

## Every time

```sh
~/.bun/bin/bun tools/visual-loop/shots.ts --out /tmp/shots
~/.bun/bin/bun tools/visual-loop/shots.ts --out /tmp/shots --keep    # leave the seeded stores
~/.bun/bin/bun tools/visual-loop/shots.ts --out /tmp/shots --headed  # watch it work
```

Omit `--out` and it writes into a fresh temp directory and prints the path.

## It never touches a real store

Two temp directories are created and seeded through `tools/demo`, whose own
guard refuses `~/.counterparts`, `~/.bansai`, `~/.claude-engram`, `~/.memory-ab`,
`~/counterparts-parallel-run` and `~/counterparts-backups` **by name**, refuses
a relative path, and refuses any directory that already holds a store.

**There is deliberately no `--dir`.** A screenshot tool that can be pointed at an
existing directory is one typo away from publishing the owner's memory, and the
whole reason this tool exists is to produce images that get published.

## What it produces

| | |
|---|---|
| `rich-<page>-1440x900.png` | the thirty-day demo store, full page |
| `rich-<page>-1024x768.png` | the awkward middle — where the flow diagram's silent clipping and colliding edge labels showed |
| `rich-<page>-390x844.png` | the same, on a phone |
| `empty-<page>-*.png` | an initialized store with nothing in it — the panel that has to look intentional |
| `rich-event-modal-*.png` | the live feed's event record, opened |
| `rich-memory-modal-*.png` | one memory, opened |
| `rich-flow-node-*.png` | the flow page with a node selected |
| `rich-flow-live-event-*.png` | shot with a comet in flight, after a real deposit |
| `log.json` | every shot, every console message, page error and 4xx, and every contrast and viewport measurement |

Pages are `overview`, `memories`, `mind`, `flow`, `health` and `brain`. The
brain view is not shot at 390: a portrait-phone hologram proves nothing.

The run prints the **worst** contrast reading per selector across every page and
viewport — the number to quote, rather than the best one — and the layout
viewport width every 390 request actually got.

## The live event

After the rich store's screenshots, the loop opens the flow page, reads the
`sleep` node's state line, and then deposits one memory through the **real
door** of its own temp store — `submitSessionEnd` + `sessionEnd`, the same calls
`tools/demo/seed.ts` makes, with no embedder and no interpreter, so it spends
nothing and reaches no network. It then waits for `window.particleCount()` to go
above zero, screenshots the comet mid-flight, and reads the node's state line
back. A run where the number did not move, or where no particle was ever in
flight, is a failed run.

## What counts as a failure

Any console `error` or `warning`, any uncaught page error, any request that
fails, any response from the dashboard's own origin with a status of 400 or
worse, any text under 4.5:1, any page whose content scrolls sideways or whose
layout viewport widened past the request, and a live event that changed no
counter or drew no particle.

**One named exemption**, and it belongs to the harness rather than to the page:
taking a screenshot of a live WebGL canvas makes the headless GPU read pixels
back mid-frame, and the driver logs `GPU stall due to ReadPixels`. It is emitted
by `page.screenshot()` on the brain view and by nothing else. It is matched by
its text, so a real WebGL error still fails the run.

The brain view's three.js comes from a pinned CDN and is **allowed** to fail —
offline it renders one sentence and a link back, which is a valid screenshot.
That failure is reported as a request failure like any other, so a run made
offline will exit non-zero and say why; every other page renders fully with the
machine unplugged.

## How it waits

Each page sets `document.documentElement.dataset.loaded = "1"` after its first
full render — including the brain view when it has decided it cannot load. The
loop waits on that flag rather than on a sleep, so a slow machine takes longer
and a fast one does not race.

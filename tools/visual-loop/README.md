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
- **Tap targets**, on the phone pass only. Something a thumb has to hit is at
  least **44px** tall; the nav links measured **29.2px** and the `brain` link
  **18.4px** before this existed. A mouse needs no such thing, so the check runs
  at 390 and nowhere else.

And it causes **two real deposits** on the rich store, from an open page,
because three of this dashboard's claims cannot be checked any other way: that
particles ride only on real events, that the flow diagram's counters are live
rather than fetched once at boot, and that a deposit which writes *no durable
event at all* — which is what `counterparts note` is — still moves them.

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
~/.bun/bin/bun tools/visual-loop/shots.ts --out /tmp/shots --name fernbrook-demo
                                                    # name the store in the header chip
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
| `rich-flow-note-*.png` | the same, after a note — which writes no durable event, and used to move nothing |
| `rich-<page>-1440x900-fold.png` | the first screen at the size the README publishes |
| `log.json` | every shot, every console message, page error and 4xx, and every contrast and viewport measurement |

Pages are `home`, `memories`, `self`, `flow` and `health`. The brain is part
of the home page (since 2026-09-25; `/brain` only redirects there), so it is
shot with it, at every viewport.

The run prints the **worst** contrast reading per selector across every page and
viewport — the number to quote, rather than the best one — and the layout
viewport width every 390 request actually got.

## The live events

After the rich store's screenshots, the loop opens the flow page, reads the
`sleep` node's state line, and deposits one memory through the **real door** of
its own temp store — `submitSessionEnd` + `sessionEnd`, the same calls
`tools/demo/seed.ts` makes, with no embedder and no interpreter, so it spends
nothing and reaches no network. It waits for `window.particleCount()` to go
above zero, screenshots the comet mid-flight, and reads the node's state back.

Then it does it again the other way, with `captureJot` + `submitJot` — the
console's own two calls, in the console's own order. That path writes **no
durable event**, so a page polling the event log sees nothing, and before this
check existed the open page kept reporting the old count forever while the
server already answered the new one. It asserts that `remember` and `store`
both moved, and that a comet flew.

A run where a number did not move, or where no particle was ever in flight, is a
failed run.

## What counts as a failure

Any console `error` or `warning`, any uncaught page error, any request that
fails, any response from the dashboard's own origin with a status of 400 or
worse, any text under 4.5:1, any page whose content scrolls sideways or whose
layout viewport widened past the request, anything under 44px that a thumb has
to hit at 390, and a deposit — of either kind — that changed no counter or drew
no particle.

**One named exemption**, and it belongs to the harness rather than to the page:
taking a screenshot of a live WebGL canvas makes the headless GPU read pixels
back mid-frame, and the driver logs `GPU stall due to ReadPixels`. It is emitted
by `page.screenshot()` of the home page's brain and by nothing else. It is matched by
its text, so a real WebGL error still fails the run.

The brain's three.js is vendored (`web/shared/vendor/`, pinned 0.169.0, MIT)
and served from the dashboard's own origin, so every page renders fully with
the machine unplugged. Where WebGL is unavailable the brain says one calm
sentence in its place, which is a valid screenshot.

## How it waits

Each page sets `document.documentElement.dataset.loaded = "1"` after its first
full render, and the home page's brain sets `data-ready` on `#home-brain` once
it is drawing or has decided it cannot. The loop waits on those flags rather than on a sleep, so a slow machine takes longer
and a fast one does not race.

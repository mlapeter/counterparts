# `tools/visual-loop` — look at the dashboard, and fail on anything it says

A dashboard is judged by eye. A change that silently breaks one panel is
invisible to a suite of JSON assertions, and a console error is invisible to
everybody until a stranger opens the page. So this seeds its own stores, starts
the real server on a free port, opens every page and every tab in a real
browser, screenshots each one, and **exits non-zero on a single console error,
page error or failed request.** Zero console errors is the launch bar; this is
what enforces it.

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
| `rich-<page>-390x844.png` | the same, on a phone |
| `empty-<page>-*.png` | an initialized store with nothing in it — the panel that has to look intentional |
| `rich-event-modal-*.png` | the live feed's event record, opened |
| `rich-memory-modal-*.png` | one memory, opened |
| `rich-flow-node-*.png` | the flow page with a node selected |
| `log.json` | every shot, plus every console message, page error and 4xx the run saw |

Pages are `overview`, `memories`, `mind`, `flow`, `health` and `brain`. The
brain view is desktop-only: a 390-wide hologram proves nothing.

## What counts as a failure

Any console `error` or `warning`, any uncaught page error, any request that
fails, and any response from the dashboard's own origin with a status of 400 or
worse.

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

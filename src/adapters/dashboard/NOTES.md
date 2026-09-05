# `dashboard/` — NOTES

Working notes from the build. The CONTRACT is the spec; this is what building
against it decided, and why. Everything here is a **working default, revisable
without ceremony** (constitution line 13).

## OQ1 — terminal or local web? **Terminal, for now.**

The contract said the guarantees are identical either way, and they are. Terminal
won on three grounds, none of them permanent:

1. **It is the shape the guarantees are easiest to prove in.** A view that returns
   a string is a pure function of the store, so "byte-identical directory after
   every view renders" is a loop in a test rather than a browser harness. The
   observer guarantee is the reason this adapter exists at all; making it cheap to
   assert is worth more than pixels at this stage.
2. **Zero new surface.** A local web view needs a server, a port, a lifetime, and a
   decision about who may reach it — four things Amendment 15 says are earned after
   the simple thing fails, not before.
3. **It is where the owner already is.** The parallel run against v1 happens in a
   terminal session; the instrument should not require leaving it.

**What would revise this:** the moment the owner wants to *click* — a memory graph,
a strength curve over lived days, a diff between two versions. None of those read
well as text, and none of them are in the five views. The view functions know
nothing about a terminal; a web adapter would reuse the data-shaping and replace
only the last step. Nothing here is a fork in the road.

## OQ1, revisited — 2026-09-04: **both. The web view is built.**

The revision condition the entry above named — *the moment the owner wants to
click* — arrived, and it arrived for exactly the reason it predicted: a memory
graph, a strength curve over lived days, a belief's pressure against its bar.
The owner ruled for a local web view (2026-09-04) and it is in `web/`.

**Nothing in the terminal answer's reasoning is discarded**, because each of its
three grounds was a claim about how to keep a guarantee cheap, not a claim about
pixels:

1. *"A view that returns a string is a pure function of the store."* So is
   `router(url, host, source)`: it takes an already-opened observer source,
   returns a plain `{status, headers, body}`, and binds no socket. The
   byte-identical assertion is the same loop, over endpoints instead of over
   views (`test/dashboard-web.test.ts`). The property did not get harder to
   prove; it got a second shape.
2. *"Zero new surface — a server, a port, a lifetime, and a decision about who
   may reach it."* All four are now answered rather than avoided: `node:http`
   (not `Bun.serve`, so Node is not foreclosed), 127.0.0.1 only, the process's
   own lifetime, and a Host-header allowlist checked before any view is
   computed. Amendment 15 says complexity is *earned*; this is the moment it
   was, and the four answers are the price.
3. *"It is where the owner already is."* Still true, and the five terminal views
   are untouched. `bin/dashboard.ts serve` is a sixth subcommand beside them,
   not a replacement for them.

**What the web shape added that the terminal shape did not have.** Two things,
and both are rules the terminal views should probably adopt:

- **Confidential rows are withheld** (`web/reveal.ts`). `recall/activate.ts`
  has a predicate the surfacing gate uses; the terminal views resolve straight
  through it. On a screen that gets screenshotted, that is the one surface in
  the system where the rule would not hold. The row still renders — id, band,
  strength, its dot on the chart — and only the sentence is gone, because a
  memory whose *existence* the owner cannot see would be the worse failure.
- **Refs are resolved BY EVENT NAME.** `recall.decision` carries a session id in
  its `ref`, and the terminal feed puts it through the memory resolver and
  prints `[no longer at this address]` beside a turn that went perfectly well.
  A false absence is worse than no line. Filed against the terminal view.

**What is genuinely new, rather than the same data in colour.** The flow page:
Counterparts' own architecture drawn from a node registry, with each node's
brain analog AND where that analogy deliberately breaks, and an event→node map
declared `satisfies Record<DurableEventName, NodeKey>` — the fourth totality
axis, in the same shape as the other three. A durable event the core learns to
write now fails `tsc` until someone has decided which part of the machine it
belongs to.

**One exception was opened, narrowly.** `web/server.ts` is the only file in this
directory that may import `node:fs` — `readFileSync`, for two static HTML pages
that ship beside it — and `node:http`. The directory-wide ban mechanizes "there
is no dashboard state file because nothing here can open one"; a read-only
import keeps that exactly, and the test pins the binding by name so it cannot
widen into a write. It also joins the enumerated network-verb list in
`test/claude-code.test.ts`, with the inbound-only claim asserted beside it.

## The web view, second pass — 2026-09-04, after a design review

A design director scored the first pass **6.5/10** against a ship bar of 8.5,
with measurements rather than taste. The console-error bar passed cleanly; what
held it back was presentation of content the same review called better than any
dev-tool dashboard it had judged. Nine findings were acted on, and four of them
turned out to be *bugs* rather than styling:

**The one that mattered most.** "How I changed my mind" rendered `it began as X…`
and `it now says X…` as byte-identical strings — the one surface whose whole job
is to show a change showed none. The cause was not truncation: `contestedRows`
resolved BOTH ends with `reveal`, which walks the supersede chain, so both
resolved to the same row. The origin is now read with `revealHere` (unfollowed),
which is what `stories.ts` had been doing all along and for exactly this reason.
On top of that, `divergentPair` shows both versions around the point they
DIVERGE rather than from character zero, because a revision usually keeps most
of its sentence — truncating from the start spends the width on the shared
prefix and cuts the change off the end.

**A filesystem path was in every screenshot.** The header chip rendered the data
dir's absolute path and the memory modal's subtitle was 150 characters of
somebody's tmpdir. The chip is now the store's NAME with the path in `title=`;
the modal shows the path relative to the store, with the absolute one behind a
copy button. What identifies a memory's file is its place inside the store; the
machine it is sitting on is not part of that.

**Contrast was a measured failure, not a dark-theme choice.** `--faint` (the
per-memory metadata row — the line constitution 16 is actually about) measured
**1.86:1**, and `--dim` (the narration lede, the nav, the legends, the table
headers) measured **3.35:1**. They are now **4.97:1** and **6.36:1**, with
`--ink` unchanged at 11.8:1, so the hierarchy survives as a real three-step ramp
and only the floor moved. AA is 4.5.

**The page scrolled sideways at 390** on two of five pages — the task's
never-allowed case. Grid items default to `min-width:auto`, so a seven-column
table refused to shrink and `.tablewrap{overflow-x:auto}` never engaged; the
emulator then widened the layout viewport to 448 to swallow it, which is why
`scrollLeft` looked innocent. One line: `.cols>*,.cols-wide>*{min-width:0}`.

**And a UA-stylesheet trap worth remembering.** `[hidden]{display:none}` loses
to any selector carrying an id, so `#flowcv{display:block}` kept the canvas on
screen after `hidden` was set and the new mobile flow list rendered below an
invisible blank box. `[hidden]{display:none!important}` is now declared once.

### What the loop learned to measure

The two findings above were found by a human reading pixel values, and neither
should ever have to be found that way again. `tools/visual-loop` now computes
WCAG contrast in the page against the background an ancestor actually paints,
records the layout viewport every request actually got, shoots 1024×768 (where
the flow diagram's silent clipping and colliding edge labels lived and nowhere
else), and — because two of this page's claims cannot be checked from a still —
**causes one real event**: it deposits a memory through the real door of its own
temp store, waits for a comet to be in flight, photographs it, and asserts the
flow node's counter moved. The counters had been fetched once at boot, so a page
left open reported yesterday.

### Two things deliberately not done

- **The all-monospace type system.** One proportional face for prose against
  mono for data would lift every page at once, and the review names it as the
  reason a 9 is not available. It is also the change with the widest blast
  radius, and it is not what stands between this and shipping.
- **The health page's identifier wall.** `adapter.wake.injected`, `gate.chunk`,
  `sweep.gate` — 24 dotted names across two tables that partly repeat each
  other. The honest fix is to lead each row with the plain-English gloss it
  already carries in its third column and merge the two tables; that is a
  restructuring, not a patch, and it is filed rather than half-done.

## The web view, third pass — 2026-09-04, and the number that disagreed with itself

Two of the four findings this round were the same shape as last round's: a
presentation complaint with a bug underneath it.

**A note left the page reporting a number the server no longer agreed with.**
`counterparts note` deposits a memory and writes **no durable event**. The flow
page polled the event log to know whether anything had happened — which is the
wrong question, because the log is not the whole truth — so the sequence never
moved, the refetch never fired, and a page left open said `143 came through`
indefinitely while `/api/flow` already answered 144. Straight after the
console's flagship "remember this". `/api/meta` now carries a row count, the
poll compares it, and a deposit that left no trace in the log still refreshes
the counters and lights the path it actually took: session → remember → encode →
store, on **named** edges, because the first edge into ENCODE is the dotted
crash fallback and a note did not crash. No feed row is invented — the feed IS
the durable log, and a row there would be a claim that something was recorded.
The chip says `last deposit`, not `last event`, for the same reason.

**The overview counted beliefs as memories.** `census()` keeps every live row
that is not the journal, and that includes schema rows — entities, and the
beliefs about them. So the headline tile read 145 while `counterparts status`
said 121 memories beside 24 beliefs and entities, on the same store, in the same
second. Two of this product's own surfaces disagreeing about its most basic
number is worse than either number being wrong. The census still keeps both
populations, because the bands, the kinds and the constellation are true of a
belief exactly as they are of a memory — but each row now says which it is, and
every surface that uses the word counts only memories. Beliefs and entities got
a tile of their own beside the first; hiding them would have been the other half
of the same mistake. The test reads the definition off the store rather than off
either surface, so the console and the dashboard are held to one rule instead of
to each other.

**The date that never changed.** Fifteen identity rows of `learned 2026-09-04`
under fifteen rows of `strength 1.00` — two of three visible fields constant, in
the README's first image. It had been filed as a limitation of the demo store.
It was not: `learnedOn` is the day a row ENTERED the store, which for anything
built or migrated in one run is the same morning, while the lived days spread
across the whole month and were already in the store. Rows carry `born day N ·
last used day M` now; the calendar date moved to the memory's card, labelled
`recorded`, saying what it means on a migrated store.

**Tap targets.** 29.2px nav links and an 18px `brain` link on a phone, against
44. Below 720px the nav stops wrapping and becomes one scrolling strip with real
44px hits, and the header lost a row (150px → 132.6px). Literally one row is not
available at 390 with six sections and four chips; three tidy rows — identity,
state, navigation — is the honest floor.

The loop measures tap heights the way it measures contrast, shoots a fold-height
frame at the size the README publishes, takes `--name` so the store in every
screenshot has a name a person would give it (`fernbrook-demo`, not
`counterparts-vl-rich-zjReXw` — the round-2 basename fix was only ever as good
as the directory's name), and, after the durable deposit it already caused,
types a note and asserts the counters moved on screen. That last check fails on
the build before this one, which is the only kind of regression test worth
having for a bug that only exists while somebody is looking.

## OQ2 — which views ship during the parallel run?

The contract asked what the minimum is "beyond status + revision stories". Answer:
all five, because the two it named are unreadable without the other three.

- `stories` names ids constantly (challenger, successor, entity). Without `browse`
  the owner cannot follow one, and the story becomes a column of hex.
- `status` reports counts. Without `identity` the two counts that are *permanent* —
  identity band and protected set — are numbers with no list behind them, which is
  precisely the shape scar §2.19 rejects.
- `activity` is the only view where the render-time-resolution rule is visible as a
  behaviour rather than as an implementation note.

Five is still minimal-first: v1's 3.1k-line panel system is not ported, there is no
navigation, no state, no interactivity, and nothing is cached.

## Narration

The brain voice ("I have lived 4 days", "what I let go") is not decoration. Two
things fall out of it that a legend-and-table dashboard does not get:

- It forces the view to state what it does **not** know. "Ways out, counted since
  birth — never a per-cycle number I do not durably hold" is a sentence the first
  person made unavoidable; a table of numbers would have silently implied a
  per-cycle figure that box 2 does not carry.
- It makes an absence a claim. `(none yet)` next to `place` says *I have never held
  a place*, which is a fact the owner can act on. A blank row says nothing.

## Absence has two words, deliberately

`(none yet)` — asked, and the answer is zero.
`(never run)` — never asked.

Scar §2.4 is about exactly this distinction, and v1's "zero births" ambiguity is
the case study: a count of zero that could equally mean *refused* or *never
proposed* is not evidence about anything. The cycle-phase table uses `(never run)`;
the count tables use `(none yet)`.

**And a third, for one node, added 2026-09-04.** ENCODE on the flow diagram
rendered `(never run)` beside STORE's `143 memories held` — a flat contradiction
to anyone who did not click it, and both words were false. The gate battery HAS
run, on all 143; it writes a durable record on one of its two paths. The
crash-sweep path records what it gated, because nobody was watching it happen.
The authored path is gated in line, in front of the person who asked, and writes
no `gate.chunk` row at all. So the node says `143 passed · no gate record yet`
and `UNLOGGED_PATH` (in `web/flow.ts`) carries the whole sentence for the panel
behind it, including where that would change — replay §2a. The rule the third
word obeys is the same as the first two: never borrow an absence word that means
something else, and never render an absence that is not one.

## What the totality rule is anchored to

Three registries, none of them a copy (`registries.ts` has the full argument):

| axis | source | staleness caught by |
|---|---|---|
| kinds | `Object.keys(physics.TUNABLES.KINDS)` | nothing to catch — it *is* the registry |
| bands | `BAND_ORDER … satisfies Record<Band, number>` | `tsc`, in this directory |
| cycle phases | `sleep`'s exported `PHASES` tuple | nothing to catch — imported |
| durable events | `DURABLE_EVENTS … satisfies Record<DurableEventName, string>` | `tsc`, in this directory |

The fourth was not in the task. It was added when the build found that `sleep/`
appends three durable event names beside `schemas/`'s one, and that a feed showing
only what happened to fire is the starvation failure with the log as its hiding
place. `band.promoted (never run)` is now a line the owner reads.

## Two things the build learned by running

- **`self.enumerate` drops what it cannot read.** A removed identity element left
  no trace in the enumeration — right for a briefing, wrong for an inspection
  surface. The identity band is queryable, so that half is recovered here and
  printed as a named absence; the protected half is not recoverable and is filed
  (INTERFACE-GAPS §3).
- **A read-only tool cannot leave the directory bit-identical.** `openCache` writes
  its schema-version row on every construction. Box 3, rebuildable, nothing
  canonical — but it is a stance-blind write on the read path, and it is filed
  (INTERFACE-GAPS §1). The suite proves the strict property for boxes 1 and 2 and
  the across-renders property for box 3, rather than excluding the file quietly.

## 2026-09-04 — three fixes from the launch inventory (§E-W2, §I4)

1. **`browse` listed episodes as memories.** `store.list()` returns the whole
   `memories` table and its filter has no "memories only" switch, so an `epi_…`
   row printed as `kind self`, `band episodic`, strength 0.00, and the footer
   over-counted by one per lived day (the inventory saw `27 memories` over 26).
   `renderList` now skips `isJournal(row)` — the same door `status.ts` has used
   since it started counting the journal apart. Opening one by address still
   works: `browse --id epi_…` renders the episode. Skipping it from the CENSUS is
   not hiding it from the owner who asks for it.
2. **`stories` admitted any row with pressure.** `contestedBeliefs` unions the
   durable pressure log with rows still carrying pressure, and that second half
   walked every row. Same skip: nothing argues with the account of a day, and an
   episode admitted there would open a story with no challenge log behind it.
   `status.ts`'s `everContested` reads through this function, so it is fixed too.
3. **The entry script printed a stack trace for every store code but one.**
   `run()` caught `STORE_UNINITIALIZED` and rethrew the rest, so a data dir with
   `claude-code.json` inside it gave nine frames of `LAYOUT_UNCLASSIFIED` and
   exit 1 — to the exact stranger who most needs a sentence. Now one
   `describeStoreError` handles EVERY `StoreError`, at open and at render: the
   named codes get their sentence, an unknown code gets its code and detail (ids
   and counts only, never prose — `store/errors.ts` §5 G10), and anything that is
   not a `StoreError` still throws, because that would be a bug here.
   `LAYOUT_UNCLASSIFIED` repeats what `cli/commands.ts`'s `init` teaches, in the
   same words: the adapter's configuration goes BESIDE the store, never inside it.

   One trap found while writing it: the dir the sentence NAMES cannot be resolved
   eagerly, because `dataDir()` throws `DATA_DIR_FORBIDDEN` when the env points
   inside v1's live store — a handler that throws while describing an error is
   the same bug one frame further down. `targetDir()` is the defensive read, and
   there is a test for the code no branch was written for.

**`browse` and `stories` now filter the journal, the way `status` always has.**
Three views, one rule, three copies of it — if a fourth view ever needs it, that
is the moment the skip becomes a helper rather than the moment it becomes a
policy.

## The web view, fourth pass — 2026-09-05, the leftovers

Four of the six things the third pass filed as NOT done, plus the two refusals
the cold stranger asked for. What they had in common is that each one was a
surface telling the truth to somebody who already knew the system.

**The overview was not on the signal the flow page was on.** The third pass
gave the poll a second question — `/api/meta`'s row count, because the event
log is not the whole truth and a `note` writes nothing into it — and then
refreshed the flow diagram alone. So the page the dashboard OPENS on kept its
boot-time tiles: `memories held` frozen at whatever it was when the tab was
opened, on the first screen of the product, beside a tab that moved. The same
bug, one page over, found by reading the fix rather than by watching the page.
`renderOverview` splits into a fetch and a `paintOverview(d, withFeed)`; the
refresh path calls the paint without the feed, because the poll prepends
flashed rows into that panel and a repaint underneath would wipe them
mid-flash — unless the feed is still its absence line, where there is nothing
of the poll's to lose and a store's first event should not need a reload. The
loop types a note and reads the tile back off the DOM: a page that never
repaints answers the payload correctly, so the assertion cannot ask the payload.

**The health page's identifier wall.** Filed twice as "a restructuring, not a
patch", and it was: eleven `adapter.*` names in one table and all nineteen in
the other, seven of them listed twice on one screen with near-duplicate
glosses, and a first screen of 23 dotted names against a column of `(never
run)`. One table now. The gloss the registry already carried LEADS each row and
the dotted name is the second line, which is the order a reader needs them in —
what this records, then what it is called. `host` marks the rows an adapter
wrote, which is the only thing the split was really saying, and the
adapter-specific caveat rides beside the name. Two columns rather than three,
which is also most of what the shredded third column at 390 was about. The
merge is only safe if totality survives it, so the test asserts both halves:
every durable name, exactly once, each led by a sentence that is not its own
name. And what has actually happened is listed above what never has, with the
rule stated on the page — a reference table nobody can read is not a reference.

**`serve` refuses the default store.** It printed a loud line and opened it: on
a machine with an install that is the owner's live memory, every element of it,
on a socket, in a browser — and the warning arrives after the socket is bound,
which is the wrong end of the transaction. `--dir` names a store, `--yes` means
the default, and neither is a warning. The refusal is a pure function of the
parsed arguments, so the test needs no store and no socket, and the install
loop asserts it on the INSTALLED binary under a `perl alarm` — because the
failure mode of a regression here is a server that starts and never returns,
and a hanging loop is a loop nobody reads.

**A view of a store that is not there is a refusal, not a render.** Both
consoles said the right sentence and exited 0, so a script wrapping either one
sailed past a mistyped `--dir`. `runReport` carries the second half of the
answer and the entry point spends it: stderr, exit 1. And the remedy names the
dir that was actually passed — `counterparts init` offered on its own, under a
line that had just named `--dir /somewhere`, is advice that works, somewhere
else.

**`strength 1.00` is gone from the identity rows.** Every element in that band
is at 1.00 by construction, so the field said one thing fifteen times in the
README's first image — a tautology dressed as a measurement. The row says
`promoted day N` where the log recorded a crossing, and nothing where it did
not: a seeded or migrated core was never watched crossing, and an invented day
would be worse than an absent one. With `born day` and `last used day` beside
it, three numbers vary where two were constant.

**And the loop shoots `brain.html` at 390 for the first time.** The phone pass
skipped the page on the argument that a 390-wide hologram proves nothing. True
of the hologram; false of its header, which is where the page's two links out
live — and they measured 13px against a 44px minimum, unseen for as long as
nobody took the picture. A shot nobody takes is a surface nobody checks. 51
shots now, zero findings.

**Still open, and named rather than half-done:** the all-monospace type system
(the 9.5 item, unchanged in its reasoning); the mobile flow list flattening a
branching architecture into one arrow chain; edge labels dropped silently on
collision at 1024; the letterboxed canvas at 1024x768; the event modal's raw
`band.transition` title; the empty store's one sentence five times over; and
the heatmap's row labels, which are still a third list of raw dotted names —
the merged table above is where their glosses live now, and the heatmap has no
room for a sentence per row.

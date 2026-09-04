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

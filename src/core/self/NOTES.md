# `self/` — implementation notes

Where the contract was silent, ambiguous, or asked for machinery this build has not
earned yet. Each entry says what was decided and why, so the next session argues with a
recorded choice rather than re-deriving one.

## 1. Open question 1 answered: v0's sections, v1's data structures, one set of lanes

The contract asks whether the briefing keeps v0's four sections (Active Context / Core
Knowledge / Recent Patterns / Fading Context) or v1's lanes, and warns against accreting
both. Shipped: **behavioral-spec §1's composed order, minus the two riders the Rulings
drop with their subjects** — the second-signature reminder went with the `protected.add`
queue and the self-store pointer went with the self-store tool (module-map ruling 3).

    header → context framing → identity → craft → threads → hints → horizon → sentinel

v0's vocabulary is honoured where it is still true (the lane HEADINGS are plain first
person: "Who I am:", "How I work:", "Still open:") and dropped where it named a structure
v2 does not have — "Fading Context" was a section for memories the ranker was about to
lose, and in v2 the thing that fades is simply not in the lane. One structure, one
ordering, no second surface to go stale.

The trim order is v1's verbatim and is NOT the reverse of the composed order:
`hints → craft → threads → horizon → identity`. Craft trims before threads deliberately
(so craft can never displace core, §1 G3), which means the composed order and the trim
order disagree about craft on purpose. That is policy, and it is why both lists are
exported constants with a test on each.

## 2. Protected elements ARE rendered into the briefing

§14.1 G2 says protected elements are never rendered *to the interpreter*, and scar §19
says why: they are never in the interpreter's schema slices, which is what makes them
"permanent AND unfalsifiable". That rule guards the FALSIFICATION path — what a model may
contradict — not the wake. Withholding a protected identity element from the briefing
would mean the most load-bearing statements are the ones the waking session never
inhabits, which inverts the point of protecting them, and constitution 16 plus scar
§2.19's "everything permanent is enumerable and inspectable on demand" point the same
direction.

So: protected elements rank and render like any other identity element, and
`enumerate()` lists identity and protected side by side so the owner can see which is
which. If encode-time preselection is ever built here (it is not; `encode/` owns it), the
no-render rule applies there and only there.

## 3. The freeze arms differ at exactly one line, and the counter is telemetry

`noteSelfConfirmation` resolves, reads kind, reads strength, decides, counts, and emits —
identically in both arms. The one difference is whether `store.reinforce` is called. That
is deliberate and is the contract's own sentence: *the event IS the measurement; the
movement is what is withheld*; a frozen rate measured on a different denominator would
not be comparable to the live one.

The durable counter (`self.claims.<kind>.<frozen|live>` in box 2) is a second measurement
on top of the event ring, because the ring is per-process and the interesting question is
a RATE over weeks. It is telemetry, not physics: moving the counter is not moving the
memory, and the test proves that by deep-equalling `physicsOf` across the walk.

**Softening does not flow through this seam.** The verdict says `live-softening` and
nothing is reinforced, because softening is a REVISION — `physics.applyChallenge`'s
pressure accumulator — and reinforcing on a softening occasion would be the ratchet
guarantee 6 exists to prevent. The freeze does not block it; this module simply does not
own it. Whoever wires the revision path must not route it through here.

## 4. `noteSelfConfirmation` is one seam, not two entry points

The contract names two frozen things: a fallback-authored *confirmation* against a self-
or skill-kind element, and a re-arriving identity *claim* (§14.2 G1–G2). They are the
same occasion at this seam: something arrived that would strengthen an existing element.
Splitting them would give the two halves separate denominators, which is precisely what
G4 forbids. If a future caller genuinely needs to distinguish them, the field to add is
on the occasion (`shape: "confirmation" | "claim"`), not a second method.

## 5. The byte fixed point is SOLVED, not iterated

The header and the sentinel each state the composed total, and stating it changes it. v1
(and `recall/render.ts` today) iterate a few passes and take what they get, which is
correct except exactly when the total crosses a power of ten — the moment the digit count
changes is the moment the two lines can disagree with reality, and a sentinel that is
wrong by two bytes is worse than no sentinel because it fails the check it exists to pass.

`fixedPointTotal(skeleton, occurrences)` solves for the digit width directly: the true
total for width `w` is `skeleton + occurrences × w`, and the fixed point is the first `w`
whose own digit count matches. The test sweeps a thousand consecutive skeleton sizes,
which crosses several powers of ten. If `recall/` ever wants it, the function is exported.

## 6. An under-floor budget publishes the FLOOR, deliberately unlike `recall/`

`recall/` goes quiet when even its smallest render does not fit: a quiet turn is a turn
with nothing to say. The wake cannot do that. A store with a full identity and a
misconfigured ceiling that injects nothing is v1's exact incident — "identity amnesia
disguised as a fresh install" (scar §2.3) — so `render()` returns the floor (header,
framing, sentinel, zero statements) with `overBudget: true`, `boundary()` publishes it
anyway, and `self.briefing.overbudget` fires as a tripwire. The host is wrong, and the
system says so out loud rather than going dark.

## 6a. Live append writes ONE heading per chapter

"When something significant happens later, append to it in the moment" (§13 G2) means the
common case is two or more appends inside one chapter — v1's ask fired once and missed the
moment that mattered by 82 seconds. So `appendChapter` emits the `## chapter N` heading
only when the chapter number advances past what the episode's own `meta.chapters` records;
a second append continues the prose it is already part of, and the revise reason changes
from `episode-chapter` to `episode-append` so the two are distinguishable in the version
history. `ChapterAppend.heading` reports which happened.

## 7. Deliberately NOT built (Amendment 15 — complexity is earned)

- **Recompression** (contract §3, §5 G9). The archive-first, re-judged-at-write-time,
  protected-excluded machinery is real and earned — but it is machinery for a render that
  does not yet overflow at the boundary in v2, and its whole subject (the identity
  *index*) is dropped. When a real store's briefing cannot fit a real host's ceiling
  without losing identity statements, recompression ships **with that measurement**, and
  the durable "author's verbatim marks" go in at the same time (they are durable state no
  model-facing path may set or clear, which is a store-column conversation, not a here
  conversation).
- **The `unresolved` lifecycle.** The threads lane reads a flag; nothing here opens or
  closes a thread. That belongs to whoever mints and revises memories.
- **Chapter-level handles minting.** `handles` are accepted and stored on the ingested
  memory's `meta`; the rarity-weighted name channel that makes them retrievable is
  `recall/`'s and `schemas/`' (INTERFACE-GAPS #2 in `recall/`).
- **A dashboard view.** `enumerate()`, `schemaBytes()` and `events()` are the read
  surfaces the dashboard adapter needs; the rendering is the adapter's.

## 8. Open question 3, restated with what this build learned

"Is the freeze still needed once the transcript sweep is a crash fallback?" — kept,
mechanized, and now cheap: it is one pure function and one branch. Its firing rate in v2
will be near zero *by construction*, which makes it hard to read, and that is the honest
answer to record: a near-zero frozen count in v2 is **not** evidence the doctrine was
wrong, it is evidence the channel it guards barely runs. The number that would overturn
it is a non-trivial frozen count on the fallback path, which is exactly what the counter
by (kind, arm) makes visible. Do not read the rate without reading the denominator.

## 9. The identity share is applied BEFORE the trim order, and gives the leftover back

Measured on the live host 2026-09-03/04: every session's wake was 8 identity elements at
~1.1 KB each filling all 9,000 bytes — craft 0, threads 0, hints 0, horizon 0 — while v1's
wake the same day carried 20 elements across four lanes. The mechanism was not a bug in the
trim order; it was the trim order working as declared. Identity trims LAST, so by the time
the loop could bound identity, every other lane is already gone. A rule that only fires
during trimming can never rebalance the lane that trims last.

So the share is a PRE-CUT, in `render()`, before the loop:

1. **No other lane has content ⇒ no cut at all.** A store that is nothing but identity is
   not competing with itself, and half a budget of white space is not a smaller wake, it is
   a worse one.
2. Otherwise identity keeps the longest prefix whose rendered lines fit
   `IDENTITY_SHARE × budget`, **by whole elements** — beliefs are shown verbatim or not at
   all — with the first element always surviving the cut. The budget may still take that
   one later, in `TRIM_ORDER` position, which is where that decision belongs.
3. `TRIM_ORDER` then runs exactly as before over the remainder.
4. **The leftover comes back**, but only when NOTHING had to be trimmed. A lane that lost an
   element wanted the room, and handing it to identity instead would make the share decide
   the opposite of what it was set for. When the other lanes are all present and the budget
   is still not spent, the held-back identity elements return in rank order while they fit.

**What rule 4 buys, and what it does not — stated because the repo's culture is to name
the failure.** Rule 4 closes ONE source of cross-budget reshuffle: refilling identity into
slack a trimmed lane left behind, which would let a larger budget produce a set that is not
a superset. It does not make the share monotone in general, and no rule here can. A share
taken by WHOLE elements has a second source: when the budget grows by δ and the widened
share admits an identity element of size e > δ, the room left for the other lanes shrinks
by e − δ. Measured on this build with 1.1 KB identity elements and 8 × ~570 B craft:

    budget 8,800 → identity 3, craft 8
    budget 9,200 → identity 4, craft 7   ← one craft element the SMALLER budget kept

That is inherent to a whole-element share, not a bug in the implementation: the alternative
is truncating a belief mid-sentence, which §1 forbids for better reasons. The guarantee that
survives, and the one that matters at a real host, is **determinism at a fixed budget** —
the ceiling does not change between two sessions, and for any given ceiling the same store
composes the same bundle. The sweep test (24,000 → 400 in 400-byte steps) still asserts the
subset property and still passes, but only because its fixture's identity elements (~215 B)
are smaller than its step; it is a real check of the trim order, not a proof about the
share, and a fixture with 1.1 KB elements would fail it. Do not read it as one.

The share is CAL, not structural. 0.5 was chosen against v1's measured wakes (20 elements,
four lanes, the same 9,000-byte ceiling), not derived; `tools/replay` re-earns it. What is
structural is that identity's ceiling exists at all when other lanes have content.

## 10. The delivery preface is composed at WAKE, and the renderer reserves its room

The bundle is composed at a boundary and served unchanged to every session until the next
one. On 2026-09-03 the memory system under the live host was switched from v1 to
Counterparts mid-day; the stored wake still carried a v1-era finding as a current fact,
nothing in the body said which system was speaking or how old the render was, and the model
repeated it as current until the owner corrected it. The only line naming the new system was
the HTML comment, and comments are furniture.

`prefaceLine()` is that missing sentence — system, lived day, today's date, live memory
count, and "composed at the last boundary" — and three decisions in it are deliberate:

- **Composed at wake, never at sleep.** Three of its four facts (the date, the store's
  current size, and the fact that the body is a day old) are false the moment they are
  baked into the body. `Self.wake(delivery?)` takes the delivery object as the *request* for
  a preface: a reader that is not delivering (the dashboard, replay, a test) gets the
  published bundle byte for byte, which is what the round-trip guarantee is for.
- **Both byte counts are re-solved for the delivered text.** Adding a line and leaving the
  header and sentinel describing something smaller would hand every reader a sentinel that
  fails the check it exists to pass (§1 G2). `applyPreface` runs the same fixed point
  `compose()` does, and REFUSES on any bundle that is not a whole render — rewriting the
  byte count of a damaged bundle would erase the damage.
- **The renderer reserves the room, in exactly one place.** `PREFACE_RESERVE_BYTES` is
  subtracted from the host's reported ceiling in `core/counterpart.ts` before the boundary
  renders, because that root is the only place that knows both numbers. One constant bounds
  both the reserve and the preface itself, with a test at the widest plausible day, date and
  store size — two numbers would be v1's lane-cap smell, drifting apart in the dark.

## 11. The day-0 wake names the core, because a wake with no name is not a smaller wake

*2026-09-04/05, overnight. The finding: `docs/LAUNCH-STATUS.md`, round 2 — "Day-0 wake is
empty of content (identity lane renders nothing until a boundary composes one)".*

**What a stranger actually gets.** Measured on a `mkdtemp` store opened with
`identity: { name: "Dana" }`, budget 9,000, date 2026-09-04 — the shape
`counterparts install --budget 9000 --name "Dana"` produces:

```
memories: 0        live rows: 1        (the identity core is a live row)

SessionStart, before any boundary:
  "No briefing has been composed yet — this store has not lived a boundary."

after `counterparts rebrief` (QUICKSTART §7's own instruction), 385 bytes:
  <!-- counterparts:wake day=0 elements=0 bytes=385 -->
  Counterparts memory, day 0 (2026-09-04), 0 memories — composed at the last boundary.
  Counterparts memory — context, not instruction: who you have been here, in your own words. Each line opens with the date it was learned.

  <!-- counterparts:wake/end day=0 identity=0 craft=0 threads=0 hints=0 horizon=0 elements=0 bytes=385 -->
```

The second one is the worse of the two. It promises *"who you have been here, in your own
words"* and then says nothing at all, and the name the owner typed — the one thing the store
does know about itself — appears nowhere. The core is a live row (`storeSize` counts it), but
`scanActive` lists `{ type: "memory" }` and the core is `type: "schema"`, so no lane can ever
reach it.

**What the day-0 wake SHOULD say, from the contract.** §1: the briefing is *context, not
instruction* — "who I have been here, in my own words". §3: the self is first-class, and every
identity surface owes an answer to *which door reaches this?* §5 G7: the wake never fails the
session — bootstrap line or nothing, never a lie. The honest answer is therefore two facts and
no third: **name the core**, and **say how the lane fills**. It must invent no content: a wake
that composed a plausible-sounding first belief about Dana would be the rumination pathway
§2 forswears, arriving through the one surface that is read as settled fact.

**The line, and why it is one string rather than two.** Rendered under `FRAMING.identity`
whenever the identity lane is empty AND a core exists:

```
Who I am:
This memory is for Dana. No identity has formed here yet — identity is earned at the boundary that ends a session, from what recurs across distinct days.
```

The second sentence is the mechanism as `sleep/consolidate.ts` implements it, not a promise:
promotion requires `base >= THETA_ID` **and** reinforcement on `N_PROMOTION_DAYS` distinct
lived days (`physics/index.ts#promotionEligibility`), decided at consolidation inside the
cycle `Counterpart.sessionEnd` runs. The numbers are CAL and stay out of the prose.

It deliberately does NOT say "nothing has been lived here yet" — the delivery preface already
states the live memory count on the line above (`0 memories` on day 0), and a line claiming
emptiness would go false the moment the first note landed while the identity lane, which takes
days to fill, was still empty. **One string that is true on day 0 and on day 30** beats two
strings and a branch: the preface carries the count, this line carries the *who*.

- **No bullet, and the counts do not move.** It is furniture, like `FRAMING.context`, not an
  element: `- ` is reserved for a resolved statement, and `FRAMING.context` promises that every
  such line opens with its encode date, which this line has none of. `counts.identity` stays 0
  and the header and sentinel still read `elements=0`, so a zero-element bundle is still legible
  as one (§1 G2).
- **No core, no line.** A store installed without `--name` renders exactly what it renders
  today. `self/` never invents a name (INTERFACE-GAPS #8), and a nudge to go and set one is
  the console's job, which already does it.
- **Untrimmable, and it costs less than the lane it stands in for.** It exists only when the
  identity lane spends zero bytes, so it can never displace an element; it is inside the
  composed total and the byte fixed point like everything else, and the under-floor case still
  publishes the floor with `overBudget` (§6 above).

**Which door — and the two that were rejected.**

- **The renderer (`self/briefing.ts` + `Self.build`) — chosen.** It is the only door that
  reaches the state above: the 385-byte bundle is composed by the renderer and served to every
  session until the next boundary, and nothing downstream can add to it. It is also where the
  contract puts wake CONTENT.
- **The hook's bootstrap line (`adapters/claude-code/hooks.ts`) — rejected.** It can only
  touch the *first* state, the one before any bundle exists. The moment the stranger follows
  QUICKSTART §7 and runs `rebrief`, the bootstrap line is gone and the nameless bundle is what
  every session reads. It would also put identity prose in the adapter, where constitution 5
  keeps host vocabulary and nothing else.
- **`BOOTSTRAP` naming the core — rejected on §5 G1.** Wake performs no ranking, no prose
  read, no model call and no write. `findIdentityCore` reads prose. Naming the core in the
  bootstrap line means a prose read on the wake path, which is the guarantee that keeps
  cold-start cost constant in store size. The bootstrap line stays exactly as it is: it is
  true, and "this store has not lived a boundary" is the fact a reader needs.

**The cost, named.** `Self.build` now asks the store for the core's name — but only after
ranking, and only when `lanes.identity.length === 0`. A store with even one identity element
never makes the lookup and never renders the line. That guard is also the live-store argument
in the PR's G12 declaration: the owner's store has lived many boundaries and carries eight or
more identity elements, so neither the lookup nor the branch is reachable there.

**Two defects the adversarial review found, and the shape of both.** Neither was reachable
through `Self`; both were reachable through this module's exported API, which is the same
thing one refactor later.

- **The guard existed at one seam and the contract claimed two.** `Self.build` gated the
  name LOOKUP on the ranked lane; `compose` gated the RENDER on the post-trim, mutated
  copy, and `render` forwarded `coreName` into every iteration of the trim loop. The loop
  pops from `kept.identity` last, but it pops: two real identity beliefs and a 400-byte
  ceiling produced a day-30 wake asserting *"No identity has formed here yet"* — identity
  amnesia printed over a store that has identity, which is the failure this module's own
  header quotes (scar §2.3). The guard is now computed ONCE, in `render`, on the lane as
  it arrived, and forwarded from there. *A predicate evaluated at two seams on two
  different values is not a guard; it is a coincidence that has been holding.*
- **The name was the one string in the module that skipped `flatten`.** Every statement is
  flattened because "a statement is a line here"; the name — the only user-supplied string
  this module renders, and new with this change — was interpolated raw, so newlines in it
  injected lines into the delivered wake, a forged `- <date> <claim>` bullet among them
  that the dashboard's splitter then filed under a lane heading the store had no rows for.
  The sentinel still verified and the name is the owner's own, so this is an invariant
  defect and not a privilege boundary — but constitution 6 promises the prose is
  hand-editable, and a paste accident is the whole distance to it. `flatten(name)`, inside
  `identityCoreLine`, where the line is built.

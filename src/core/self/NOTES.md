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

A second exception, since 2026-10-12 (#454, nothing dropped without a word): at the fold's
boundary. The folded line is shorter than the lanes' own count lines, and the rescue spends
the difference, so a synthetic sweep re-admitted "Still open"'s first item at 1,200 bytes
that 1,600 had left out. The sweep test's fixture does not cross that boundary. Measured
and named in `docs/decisions.d/fix-wake-never-silent-1012.md`.

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

**A second splice joined it on 2026-09-20 (E1), at the other end of the bundle.**
`spliceBeforeSentinel` is `applyPreface`'s mechanism pointed at the foot: it inserts above
the tail sentinel, re-solves the same fixed point, and returns a bundle that is not a whole
render untouched, for the same reason. It exists because the per-directory handoff pointer
is a delivery-time fact for exactly the reason the preface is — one bundle is published per
store and read by sessions in every directory, so WHICH directory this session opened in
cannot be known when the body is composed.

Two things about it belong here rather than in `handoff/`:

- **`self/` does not learn what a directory is.** The block arrives composed, from
  `core/handoff/`, and is joined to the bundle at `core/counterpart.ts#addHandoffPointer`,
  which is the one place holding the published bundle, the host's ceiling and the scope.
  This module's half is the splice and nothing else.
- **The comment at `briefing.ts:768` was true and is now narrower.** It said the preface is
  "deliberately not per-session… nothing in it varies between two sessions on the same day,
  so the delivery expectation stays a stable string". The preface still does not vary. The
  DELIVERED SENTINEL now can, between two sessions of the same day in different
  directories, because the pointer changes the byte count. That is safe because the
  expectation is recorded per session (`hooks.ts#noteWakeExpectation` writes `woke.sentinel`,
  the delivered one, into that session's own registry record), and it is worth saying out
  loud because the older sentence reads as a promise it was never making.

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

---

## The cap moved off the lived day, then off the shared day, then back onto a day of its own (I32, 2026-09-11; finding 12, 2026-09-17; the long session, 2026-09-18)

**First move, and the scar under it.** `dayKey` keyed the ask cap on the store's
LIVED day from 2026-09-04, and the reasoning was sound as far as it went: E8 says
episode pacing and the regrow window run on lived days, and a per-session cap
multiplies itself by however many times the owner typed `claude`. What it missed
is WHO ADVANCES THAT CLOCK. The lived day moves inside the sleep cycle, and the
sleep cycle runs only in the detached worker — so the cap's reset depended on the
machinery whose failure the cap would then hide, and on 2026-09-04 that machinery
stopped. The clock froze at 185 for seven days, `self.episode.day.185` sat at its
cap of 4, and every Stop from then on read `capped`. Thirty-nine asks a person was
present for were never made, and the store's own record said "capped", which was
true and told you nothing. The cap moved to the CALENDAR date, which fixed the
freeze.

**Second move: the sharing was the rest of the bug.** Diagnosed 2026-09-17
(`docs/finding-12-diagnosis-2026-09-17.md`) on the live store: four asks shared by
every session a calendar day held refused 196 of 264 Stops, and the crash-fallback
sweep wrote 888 memories against the author's 193. The owner runs five or more
sessions a day, so the day's allowance was usually spent by sessions that had
ended before this one began — the experiencer was not losing a fight about who
writes, it was almost never invited. When it was asked it answered every time.

**Third move: a session's whole life was too long a window the other way.** On
2026-09-17 a coordinating session spent all six asks inside one working day and
then kept running; its end-of-day handoff work — the stretch most worth writing —
was never offered the pen, and nothing short of a new session could give the
allowance back. The cap was doing to one long session what the shared day cap did
to every short one.

**The rule now:** the cap is the SESSION's own **per calendar day**
(`MAX_ASKS_PER_SESSION`, 6, owner's ruling 2026-09-18), and a session must still
have done real work first — the substance pacer is untouched, and it is the pacer,
not the count, that spaces asks out: six of them need roughly 6 + 5×8 turns AND the
bytes to match. The 2026-09-04 measurement against per-session (six asks in one
evening) was taken under the OLD re-ask rule, an OR across two pacers with a byte
half a third of v1's; the AND landed the same day. (Superseded 2026-09-24: 12 a
day, and a pacer on typed turns OR text — §23.)

**Which day, and why that one.** The store's CALENDAR date (`Store#today`, UTC),
not the lived day — I32's argument unchanged: the lived clock is advanced by the
detached worker, and a cap whose reset depends on the machinery it is capping is a
cap that can be spent forever. It is held on the session's own state
(`asksToday` + `asksDay`) rather than in a counter of its own, so nothing outside
the session can spend it and there is no second row to go stale. `asks` stays the
session's whole-life count, because the first-ask branch and `appendChapter`'s
"is a chapter open?" test both read it and neither means "today".

**A state written before the day stamp reads as zero spent today**, not as today's
count. Read the other way a session already at its cap would be capped on every
later day too, with no write that could ever move it off — the starvation this move
exists to end; read this way it costs at most one extra allowance on the day the
stamp lands, and the pacer still spaces those out.

**What is deliberately unchanged.** Episode PACING and the regrow window still run
on lived days (E8 stands). Exhausting the allowance INSIDE one day still binds —
accepted for now. Refusals stay on the record: a capped Stop still writes an
`adapter.ask` row with `outcome: "capped"` and `reason: "session-ask-cap"`, the
same reason string as before, because the door is the same one and only its window
moved.

**What went away with the day.** `dayKey`, `Self.dayAsks`, `bumpDayAsks` and the
`self.episode.day.*` meta rows: nothing read them but the cap, and "how many asks
did this date hold" is a question the durable `adapter.ask` rows answer better,
each stamped with the host's UTC date and its outcome. Old `self.episode.day.*`
rows on a live store are inert — nothing reads or writes them again.

**The wake render now leaves ONE durable row per boundary (`self.briefing`,
2026-09-14, IMPROVEMENTS U9).** `self.briefing.trim` fires once per trimmed
element and `self.briefing.rendered` carries the lane counts, and both lived
only in this module's ring, so "what did the wake trim today, and what actually
rendered" was not answerable from the store. **The row is not written here.**
`self/` holds no store handle and must not grow one (SEAMS G), so the
composition root collects what the cycle's render emitted — through the SELF
relay it already wires, armed for the span of one `runCycle` — and appends the
row after the cycle returns. Payload: `reason: "rendered"`, `date`, `day`,
`bytes`, `budget`, `counts` per lane in `LANE_ORDER` for what RENDERED, and
`trimmed: [{ id, lane }]` — ids only, capped at `BRIEFING_TRIM_LOG_CAP` (this
module's constant, since the trim is this module's), with the full number beside
it as `trimmedTotal`. No render, no row: the briefing phase is cadenced daily, so
a second boundary on one lived day writes nothing and `sleep.cycle`'s own
`phases` list says why. **One case where `phases` does NOT say why, named rather
than glossed:** a host that reported no ceiling makes `selfRenderer` refuse and
return void, and `sleep/briefing.ts` counts a void render as `changed: 1`, so the
phase reads `ran` while no row exists. The refusal is loud in its own right —
`briefing.no-budget` — but it predates these rows and is not fixed by them.
Unlatched, and pruned at the store's 90-lived-day window.
`rebrief()` leaves one too, under `reason: "rebrief"`. It renders, trims and
PUBLISHES, so a rebrief with no row would leave the last `self.briefing` in the
store describing a bundle nobody is reading any more — the log reporting a wake
that has been replaced. The reason keeps the two apart: the boundary's row is the
day's record, the rebrief's is the owner pulling the lever mid-day, and a reader
counting wake renders per day has to be able to tell them apart. A rebrief that
REFUSES for want of a ceiling renders nothing and writes nothing.

## 12. The self page: one row, two doors, and what it cost to stay out of sleep's way (2026-09-18)

The wake's "Who I am" printed a rotating list of about twenty identity elements,
re-ranked at every boundary, while the entity the store calls the self was a
`type: "schema"` row whose body was its own name. Owner rulings 8 and 9 of
2026-09-18 (`docs/plan-parallel-rebuild-2026-09-18.md` §2) replace the list with
a written page — prose, first person, the same every morning, kept with versions,
amendable by a woken session and by the owner.

**Where it lives, and why there.** One row: `type: "schema"`, `kind: "self"`,
`meta.role = "page"` — the identity core's shelf, one role along. The
alternatives were an `episode` (which is the journal's type, and would put the
page into `reconcileEpisodes`, the journal export and the chapter surfaces) or a
`memory` (which would put it into a briefing lane, to be ranked and trimmed as an
element, which is the thing it replaces). A schema row is neither, and it buys
three exemptions that already existed rather than three new ones:

- `dedup` skips every schema row by name (`sleep/types.ts#isSchemaRow`), so
  nothing that resembles the page is ever merged into it;
- `prune` blocks on `protected` (`physics#pruneVerdict`), and the row is born
  with it — the page is standing ink, which is what that flag has always meant;
- `scanActive` lists `{ type: "memory" }`, so the page can never enter a lane.

`decay` and `consolidate` do walk it, and that is fine: both write physics
columns and neither touches prose. `schemas/#toMetaRecord` returns null for any
role but entity, belief and current-state, so the page is skipped by that index
build rather than mis-filed in it. Proved by a test that runs seven cycles and a
prune over a store holding a page with two versions.

**What is NOT special-cased, on purpose.** Old page versions take the ordinary
90-day retention (owner ruling 1): `pruneSupersededVersions` deletes by
`version_day` alone and there is no exemption to make one for. The page's bytes
ARE weighed by the standing self-schema counter, like the identity core's — it is
`kind: self` prose that accumulates on the self, which is precisely what that
valve watches, and `PAGE_MAX_BYTES` bounds it at a fraction of the trip point.

**The switch, and why the default is the boring one.** What "Who I am" shows
while no page exists is the owner's choice and he has not made it. So
`PAGE_EMPTY_SHOWS_LIST` has two values and defaults to keeping the list: with no
page the wake renders byte for byte what it rendered before, day-0 line included.
Deploying the page therefore changes nothing in the owner's wake until somebody
writes one, and on a brand-new store the list is empty anyway. With the switch
off, the list goes and `PAGE_FORMING_LINE` stands in its place.

**The still-forming line is about the PAGE; the day-0 line is about IDENTITY.**
They are two sentences with two subjects and they must not be printed as one. A
store with twenty identity elements and no page has not failed to form an
identity; it has failed to write one down. Under the default switch that store
sees exactly what it always saw. PR #71's rule — a store that HAS identity never
says it does not — is untouched.

**Over the limit, twice.** `PAGE_WAKE_BYTES` (6,144, about 6 KB of the owner's
9,000-byte ceiling, clamped to the caller's budget so a page can never outgrow
the whole wake) cuts the RENDER at a paragraph or section boundary and adds a
marker naming the bytes shown, the bytes there are, and the command that reads it
whole. `PAGE_MAX_BYTES` (16,384) refuses the WRITE, and refuses rather than cuts,
because what gets cut at write time is the only copy. Between the two a write is
accepted and warned. When the page plus the furniture will not fit the caller's
ceiling at all, the floor publishes with `overBudget: true` — the tripwire that
has always existed for an under-floor ceiling, not a new one.

**Staleness is calendar days, not lived ones.** The lived clock has run seven
days across fifteen calendar ones on the owner's own store, so a lived window
would report a fortnight of silence as three days — the same reasoning
`adapters/fired.ts` states for its own window. The dateline prints the DATE and,
when stale, the number of days the tunable allows; it deliberately does not print
"N days ago", because the bundle is composed at one boundary and served unchanged
until the next.

**It renders on an `omit` composition too.** The fallback woken as the self (spec
§15 item 3) is the composition that most needs to know who it is writing as, and
`omit` stands aside protected and confidential MEMORIES — the page's `protected`
flag is the prune's vocabulary, not a confidentiality class. The day-0 line stays
suppressed there, for the reason the 2026-09-17 review gave.

**Two things the reader should know are true and slightly odd.** With a page
present the identity lane renders empty, so `self.briefing`'s `counts.identity`
is 0 and the `self.rendered.<id>` rotation stops advancing — both honest, and
both readable in the row. And `FRAMING.context`'s "each line opens with the date
it was learned" is a claim about the element lines; the day-0 line has carried no
date since it shipped, and the page carries its own date on its own line.

### 12a. What the default switch does NOT do, measured (2026-09-18)

S1's brief describes value (b) of `PAGE_EMPTY_SHOWS_LIST` two ways in one
paragraph: *"'still forming' followed by today's identity list as a fallback"*
and *"deploying this changes nothing in the owner's wake until a page exists"*.
Those are different renders, and only the second can be true of a store that has
identity. What is built is the second, plus this: the forming line prints on
value (a) alone, never above a list, and never on a lane that merely happens to
be empty.

The third reading — print it whenever the lane is empty, so a brand-new store
says the words verbatim — was built and then backed out, because it was measured
rather than argued: the line is FURNITURE, so it is untrimmable, and it adds ~127
bytes to the floor of every wake whose identity lane is empty. `test/claude-code`'s
host-budget case (a host reporting 400 bytes) then composed 539 and published
`overBudget`, which is scar §2.18's guarantee paying for a sentence. Two other
existing wake tests turned over with it, both asserting the older rule that a
lane with nothing in it renders no heading at all.

What a brand-new store says instead is the day-0 line, which has said the same
thing in this module's own words since it shipped: *"No identity has formed here
yet — identity is earned at the boundary that ends a session, from what recurs
across distinct days."* If the owner wants the page's own sentence verbatim on a
fresh store, the switch is one value away — which is what a switch with two
values and an unmade choice is for.

## 13. What the adversarial review of the page found, and what each fix cost (2026-09-18)

Two blockers, four majors. The two blockers were both in `self/`, both small,
and both the same mistake in different clothes: a number that looked like it
bounded something and did not.

**The cut threw away the room it had.** `cutAtBoundary` took the last blank line
in the window wherever it was. A page that opens `## Core\n\n` and then runs
without another blank line — a markdown bullet list, or one long paragraph, which
between them are most of what a model writes for "who I am" — has its only `\n\n`
at byte 7, so a 9,698-byte page rendered 110 bytes: a heading and a marker. The
write had been ACCEPTED, with a warning that said the wake would show a cut of it.
And because a page suppresses the identity list, the wake then carried no identity
at all — the silence failure scar §2.3 is about, reached through a door that said
everything was fine. The fix is a threshold: take a boundary only if it keeps more
than `BOUNDARY_KEEP_SHARE` (a quarter) of the room, else fall to the next finer
one, else cut bytes. A quarter and not a half on purpose — a page whose only break
sits at 2.5 KB of a 6 KB room should take that clean cut rather than fall through
to a mid-sentence one.

**The cap was measured against the wrong number.** The page was clamped to the
whole budget, so a long page filled the budget exactly and the header, the framing
line, the heading, the dateline and the sentinel pushed the composition past it —
with nothing to trim, because the identity lane is empty by then and the page is
furniture the trim loop cannot pop. An 8,657-byte page published `overBudget` at
400, 900, 2,000 and 6,000. This is the same measurement that kept the
still-forming line out of the default switch (§12a), and the review's sharpest
observation is that the argument had been accepted against a 127-byte sentence
and not applied to a 6 KB block. `PAGE_FLOOR_RESERVE_BYTES` (512, against a
measured widest of 444) is subtracted first, and two floors sit under it: below
`PAGE_MIN_RENDER_BYTES` the wake says the page exists and does not fit in one
line, and below the furniture itself it says nothing at all, because a ceiling
that small has no room for prose about prose and the over-budget tripwire should
be left for a host that really is misconfigured.

**`protected` meant two things and the comment said one.** The page is born
`protected` so the floor prune cannot take it; `sweepFallback` filters on exactly
that flag to decide what leaves the machine, and its own comment said "nothing
protected or confidential" — which this page made false. The flag is the prune's
vocabulary and does not settle egress by itself, but it is close enough that the
answer has to be written down: `PAGE_ON_EGRESS`, default true (the owner's
decision of 2026-09-17), with the comment and the contract corrected to say what
goes out and why. **Nothing marks a page confidential.** There is one page; the
switch is the decision.

**Removal was the only way out, and it was a loaded gun.** `revisePage("")`
refuses, the dashboard is read-only, and the page is the most conspicuous schema
row an owner has — `enumerate()` lists it and `status` prints its id. So the one
affordance for "stop leading my wake with this" was `counterparts remove <id>`,
which tombstones the row and leaves `Schemas.load` reading a blank `prose_path`:
a store that will not open, with the wake hook swallowing the error so the symptom
is silence. (Pre-existing — the identity core has had it since it shipped — and
the `schemas/` skip is its own PR.) The door this needed is `--clear`, and the
shape of it is the interesting part: the body becomes a VERSION and the row is
ARCHIVED, so "no page" is a state every reader already understands
(`findSelfPage` lists live rows) and nothing is destroyed. Blanking the body was
the alternative and it is worse — a live page whose text is a placeholder is the
"empty is a valid state" failure the bootstrap line exists to avoid.

**The version log named the wrong write.** `store.revise` records the REPLACING
write's reason on the row it archives, so version 1 — the first page — was
labelled with the second write's words, while the current page's own
`Last change:` line read the row's meta and was right. One word meaning opposite
things on two surfaces. The durable rows carry what is wanted, and the arithmetic
is exact: the write that produced version `seq` is the one whose row says
`version: seq - 1`, because a revision archives the body that was standing and
numbers it with the revision it is making. The store is untouched; only the
presentation changed, with `replacedBy` keeping the store's value under its true
name.

**Two writers, last one wins, both told it worked.** Not data loss — every lost
body is a version — but silent reversion of the page every session reads, which
is the same felt outcome and harder to notice. `ifVersion` is optional on purpose:
passed, a write that crossed with another is refused and handed the current page
to merge; omitted, nothing changes. That is a courtesy between writers rather than
a lock, which is what keeps it inside the owner's "no safeguards up front".

**And the page could be promoted.** `consolidate.ts` had no `isSchemaRow` guard
where `dedup.ts` has had one since it shipped, so forty cycles over a page
carrying the physics repeated recall credit leaves produced `promoted_identity`,
`band identity` and a `band.promoted` crossing record — on a row no lane can ever
rank. The wake was unaffected; the telemetry was not, and the promotion
diagnostics counted it. One line, mirroring dedup's, and it covers the identity
core too. Excluding the page from recall — which the coordinator decided, and
which is right on its own terms, since the page is already delivered whole every
morning — closes the credit path that made it reachable. Both are one line to
reverse.

### 13a. Three things the second pass narrowed or fixed (2026-09-18)

**The promotion guard is the promotion ARM, not the phase.** The first cut
skipped schema rows from `consolidate` whole, mirroring `dedup`. That also stops
a belief being CONSOLIDATED — `+CONS_BONUS` on `base` — which changes the
strength trajectory of every belief on the owner's live store from the first
cycle after deploy, for a fix about a telemetry row. Only the crossing is
withheld now: a belief consolidates exactly as it always has and simply never
crosses, which is the whole of what "this row entered the identity band" should
never say about a standing claim.

**A cleared page is found by its own durable row, not by id order.** Clear →
restore → clear leaves TWO archived page-role rows and no live one, and
`store.list` is `ORDER BY id` over hashed ids — so the version log would have
read whichever sorted first, and the `--restore <seq>` pointer the clear had just
printed would have been resolved against the wrong row. `pageRowId` reads the
newest `self.page.revised` row carrying `cleared: true` and takes its `ref`.

**What clear/restore does NOT carry, said out loud.** The history of a cleared
page is reachable for as long as it is the last thing cleared. Write a NEW page
and the live row wins: the older cleared page's versions sit on an archived row
no console door reaches. That is an acceptable limit for now — nothing is
destroyed, and the row is still in the store for anyone who goes looking — and
the two messages that offer `--restore` say "until a new page is written" rather
than promising more than they can keep.

## 14. One row for the life of the page, and a guard that fits the finding (2026-09-18, second review)

**The undo closed behind the owner.** `--clear` archived the row; `revisePage`
looks for a LIVE page; so the `--restore <seq>` the clear message itself
recommends minted a fresh row, and four versions with full attribution sat on a
row no surface could reach. Proved through the real console: `--versions` listing
four, then `--restore 4`, then `--versions` answering "No earlier versions". The
mechanism built to answer "the owner can see and undo a bad write" destroyed
access to exactly what it was protecting, on its main path.

**The shape that fixes it is one row for the life of the page.** A clear is an
ordinary REVISION — so the body it replaces becomes an ordinary version,
attributed like any other — to a fixed cleared-body line, with `meta.cleared`
set. The row stays live and keeps its whole chain. `readSelfPage` returns null
for a cleared row, so every reader sees a store with no page and the wake goes
back to its empty-page behaviour; the next write or restore revises the SAME row
and drops the flag. Two properties fall out and both are asserted: there is never
a second page row, live or archived, however often it is cleared; and nothing
needs the event log to find the page or its history. The named limit from the
first attempt — an older cleared page's versions unreachable once a new page is
written — does not exist any more, because there is no older row. So does
MINOR-E: the cleared-page lookup no longer depends on rows sleep prunes at 90
days, and there is no arbitrary id-ordered fallback to pick the wrong page with.

The reviewer's own preferred fix was a `Store.unarchive`. This gets the same
result without a new store verb, which matters while the floor (F5) is being
rebuilt underneath.

**And a guard that fits the finding.** The promotion guard was schema rows
generally. `physics#decay` returns 1 for a promoted row, so withholding the
crossing from beliefs, current-states and entities stops them becoming
decay-exempt — a retention change for three row classes across the owner's whole
store, inside a PR about one page. Measured, master against the branch, identical
fixtures, 40 cycles:

```
             master                          first attempt
memory       band identity, promoted 1       identical
belief       band identity, promoted 1       band semantic, promoted 0
current-state band identity, promoted 1      band semantic, promoted 0
entity       band identity, promoted 1       band semantic, promoted 0
page         band identity, promoted 1       band semantic, promoted 0
band.promoted events: 5                      1
```

The guard is now the PAGE, by role, and the same measurement over the fix leaves
one line different: the page, and `band.promoted` 5 → 4. Whether a belief should
cross into the identity band at all is a real question — it is odd, and
`enumerate()` has no type filter, so beliefs that crossed appear in `status`'s
identity list — but it has a one-query answer against the live store that nobody
has, and it is not this change's to take.

The identity core is deliberately NOT exempted: it could cross on master, and
exempting it would be the same quiet retention change one row smaller.

## 15. The nightly page writer: how the day is chosen, why the claim is a row, and the one thing it refuses to claim to know (2026-09-20, S2)

S1 put a written page at the head of every wake and left nothing to fill it. On the
owner's live store that was survivable — a session that happens to think of it can write
one — but on a store a stranger installed this morning it means the page never forms at
all. So S2 is the mechanism, and these are the four choices it turned on.

**The day is a CALENDAR date, and it is always yesterday.** The lived day was the obvious
candidate and is wrong here for the reason `episodes.ts` already gives about the ask cap
(I32): `livedDay` advances inside `advanceClock`, which runs inside the sleep cycle, which
runs inside the detached worker. A worker that cannot start freezes that clock — it did,
for seven days — while the calendar keeps going. A nightly mechanism keyed to a clock the
night itself advances can miss every night and still look on time. The row carries both:
`about`, the calendar date it read, and `day`, the lived day it ran on, which is what every
other durable row in this store is stamped with.

It does not chase a backlog, and that is a decision rather than an omission. A machine that
was off for a week comes back and writes about the day just gone. Six model calls and six
revisions of one page in one morning is how a page starts drifting, and the memories of
those days are still in the store and still reach the page through the ordinary lanes.

**The claim is a durable row, not a lock file.** The obvious shape was `spawn.ts`'s: a file
opened `wx`, a pid, a staleness window. The row is better here for two reasons the file
cannot match. It is *the same object the fired view and doctor already read*, so "did last
night happen" is answered by the mechanism's own record rather than by a second artefact
nobody looks at; and it works across machines, because two laptops sharing a store over a
sync folder share the row and would not share a pid. What the row gives up is atomicity in
the last few milliseconds: two hooks that both read "no claim" in the same tick can both
write one. That is why the allowance is a count rather than a boolean — a duplicate ask is
already inside the budget, and the second writer's `ifVersion` refuses cleanly with a row
saying so.

**Two asks per day, and it is not a second pacer.** The scar this module carries about
pacers (CONTRACT §3) is precise: it is about the BLOCKED MOMENT at Stop, where two asks on
two substance pacers drew about a dozen asks from a 13-turn evening. Nothing here goes near
it — the writer's ask fires at SessionStart, consults no substance, spends none of
`MAX_ASKS_PER_SESSION`, and rides in the same field the first-launch scope question uses.
Its cadence is the day boundary. The count exists because one ask per day is brittle in
practice: the first session of a morning is often deep in something else, and a night lost
to that is a day missing from the page forever. Two was chosen over three because the
whole design of the doctor line is that a mechanism must not nag, and the same is true of
the ask itself.

**The one thing it refuses to claim.** "Nothing to say" had to be a first-class outcome —
a day that changed nothing about who the self is should end with no revision, and that must
be recorded rather than inferred from silence. Host mode can report it honestly: a
windowless session handed one instruction and one tool, which exits clean without calling
the tool, has answered. Session mode cannot. A session that was asked and wrote nothing may
have decided there was nothing to say, or may have been three hours into a refactor and
never read the block. Storing `nothing-to-say` there would be the engine putting words in
the writer's mouth, which is §2.4 from the other direction. So session mode stores the
claim, and `pageWriterStatus` READS a claim whose day has ended as `nothing-to-say` with
`derived: true` — and every surface that prints it prints that it was derived. The claim
carries the date it was MADE (`on`) as well as the date it is about, because "is this still
in flight" is a question about the first and not the second.

**What is still unproved, and it is host mode's half.** Nothing in this build has started a
real `claude -p`. The launcher, its argument and environment shape, its watchdog and its
claim are all exercised against a stub executable; what a real machine has to answer is
whether a background process can reach the keychain for the subscription login
(`claude setup-token` is the documented route — spec §16). Until somebody runs it, `session`
is the mode that is actually known to work, which is why it is the default.

## 16. Two things the first build of the writer got wrong, both invisible to its own tests (2026-09-20, review of S2)

Both were found by asking what the mechanism does on a REAL store rather than on a
fixture, and both would have made session mode — the default — quietly not work.

**The block repeated the page, so on any store a few days old the ask was deferred every
morning and nothing durable said so.** The first version handed the writer the page body
followed by up to 8 KB of the day's memories, and then checked whether the total fitted
beside the wake under the host's ceiling. On the fixture — a 60-byte page and one memory —
it always fitted. On a store with a 4 KB page and a productive day behind it, against the
9 KB ceiling this host reports, it never does: the wake has already spent most of the
ceiling, and the page is in the wake, so the block was re-sending the single biggest thing
the reader already had. The deferral was correct behaviour (never truncate, never smuggle
past the ceiling) and its only trace was a ring event that dies with the hook process,
which is I32's shape exactly: a mechanism refused every time with no row anyone can read.

Two fixes, and the second is the one that generalises. The block now POINTS at the page
(version, bytes, last revised, "it is at the head of your wake, call the tool with no
arguments to read it whole") instead of repeating it — which is also just true, in both
modes, since host mode's whole reason for existing is that the child runs the ordinary
SessionStart hook. And the day is sized to the room that is actually left: the empty block
is measured first, with the same function that composes the full one so the two cannot
drift, and the memories get the remainder. A day that does not all fit is delivered SHORT
with the count on the run's row, rather than the whole ask being dropped.

The third fix is the diagnostic, because the first two do not make deferral impossible:
doctor's line now reads `pageWriterDue` itself and goes amber when a night has been owed
for more than two days with nothing delivered. A deferral still leaves no durable row —
nothing claimed is the correct behaviour — so the only honest way to see it is to notice
that the night is still owed.

**`by: "writer"` could never fire in session mode, because the real MCP server is
unbound.** The server is launched from a static host configuration and never learns which
session it serves; it binds lazily, on the first tool call that carries an id
(`requireBoundSession`). A session answering the page-writer ask right after its wake has
called nothing else, so `this.session` was null, so the registry mark was never read, so
every night's revision was filed as an ordinary amendment and the night then read as
`nothing-to-say`. The inverse of the honesty the outcome exists for, and the test passed
because `openServer({ session })` sets the id at launch, which production does not do.

The ask now names the session id and the tool takes an optional `session`, the way the Stop
ask and `chapter` already do. It is honoured NON-FATALLY: `requireBoundSession` is reused
so there is one definition of corroboration, and its refusal value is discarded. A page
amendment has never needed a session and must not start being refused for lack of one; what
a bad claim costs is the `writer` label, and the ring says why.

## 17. What the adversarial review found, and the one thing that could not be fixed (2026-09-20, review of S2)

Five MAJORs, none a blocker, and every one of them a case where the mechanism was honest
about something that was not true. They are worth keeping together because they share a
shape: **the fixture was smaller than the world.** A 60-byte page and one memory fits any
budget, dies on any signal, and has no second day; the defects lived in the gap between
that and a real store.

**The block told the writer the day was empty.** `dayMemories` stopped at the first memory
that would not fit, so any room smaller than the LARGEST memory's cost dropped every one of
them — and `writerInstruction`, handed an empty list, said "Nothing was written down on
<date>". The reviewer reproduced it across a 260-byte band of ordinary budgets on a 3 KB
page and a 20-memory day. The next morning that reads as a derived `nothing-to-say`, and the
narrator says "nothing about who I am moved that day" about a day with twenty things in it.
Three fixes, because one was not enough: the loop fills past a miss instead of stopping;
the empty branch distinguishes "the day was empty" from "I could not see the day" using
`dropped`, which was in scope and discarded; and a block that can carry NONE of the day
defers rather than spending one of the night's two asks on a sentence.

**A memory could close the block it was quoted in.** `flattenLine` collapsed whitespace and
nothing else, and the framing sentence sat at the top of the block while the untrusted
material sat at the bottom. A memory is exactly what the sweep proposes from a transcript,
so this was a first-class injection into the one prompt that revises the identity page. The
markers go now — this block's and the wake's, which `page.ts` already refuses on the way IN
— and the sentence that says the list is material moved down to sit beside it. The general
lesson, which is not new: framing is positional, and a warning above content the reader has
not met yet is a warning about nothing.

**A child that ignores SIGTERM hung the worker.** Both alarms signalled and neither
resolved, and the promise resolved only on `close`, so a trapping child kept the worker
inside its `finally` holding the store open — measured at 25 seconds against a 3-second
child watchdog. The fix is the ordinary escalation nobody wrote the first time: SIGTERM,
grace, SIGKILL to the process group, and then a reap timer that resolves the promise whether
or not the OS ever confirms. The child is `detached` now solely so there is a group to kill.

**`no-memories` was declared and never returned.** `hasDayBefore` asks whether the store
holds anything older than today, which is true for ever after the first memory, so a machine
used twice a week was asked every single morning about five empty days. The dead enum member
was the evidence that the first build meant to prevent exactly this.

**One typo turned memory off.** The `pageWriter` block was strict on the argument that
`host` starts a process — and the argument does not survive contact with the code, because
`mode` is an exact-string allowlist and a typo can only ever resolve to the fallback.
Strictness bought nothing and cost the owner his store's memory for a misspelling in an
optional block, which is the failure the F2 ruling moved `snapshots` out of strictness to
avoid. It is lenient now, with the fallback PINNED to `session` — the one protection
strictness was really offering, kept — and a doctor amber naming the key and the value.

**And the one that could not be fixed, only told the truth about.** The docstring and the
CONTRACT both said the day arrives "newest and most salient first". There is no newest:
inside one calendar day `learned_on` is a date, `birth_day` is the lived day, and `newId` is
six random bytes, so every row of a day ties on every clock the store has. The reviewer
offered two options — tie-break on rowid, or delete the word — and the first is not
available from the `Store` API. So the word is gone, from the code, the block and the
contract, and what is asserted instead is the property that is real: the cut is
deterministic, which is what §1 G3 asks for. A tie-break on insertion order would need
`store/` to expose one, and that is a real ask rather than a fix to make here.

## 18. What the floor (F5) changed underneath the writer, measured rather than assumed (2026-09-20)

Merged `origin/master` at `3f6a6eb` — bodies, versions and the journal are rows in
`counterparts.sqlite` now. The merge was clean; one test needed rewriting, because it was
the one place in this file that still knew a body was a file. Three interactions were
checked by running them, and all three came out needing no change to the mechanism:

**A body the new floor refuses never reaches it.** `put`/`revise` now refuse whitespace-only
and NUL-only bodies (`store/prose.ts#bodyForStorage`) and a throw out of `revisePage` would
break the one guarantee this path makes — every call returns a reason and leaves a row.
Measured: `""` is refused `empty` by `self/`'s own check, and `"   "` and `"\0\0\0"` are
both refused `gate-refused (content-empty)` by the battery, which sits in front of the
store. The store never sees any of them.

**A FAULTED page row does not reach the writer, because it does not reach anything.** F5's
fault state — `body = ''` with the content hash still naming the words that were there — is
raised by `Schemas.load`, which reads every schema row at open. Measured: `Counterpart.open`
throws, so the session stands down and doctor reads RED naming the id. There is no wake for
the writer to fail and no boundary for it to break. That is the S1 review's MAJOR-1 carried
onto the new floor, and it is still `schemas/`'s to answer rather than this mechanism's.

**A TOMBSTONED page row cannot be made.** `planRemoval` refuses the page row by name
(`is-the-self-page`, S1) and the destruction seam under it refuses an id with no dark
removal record first — measured, `chaseRemoved` throws `REMOVAL_NOT_DARK`. So the state
`Schemas.load` skips is unreachable for this row, which is why the writer carries no special
case for it. **If either of those doors ever opens**, the hazard to look at first is that
`findPageRow` skips a row whose body will not read, so `revisePage` would mint a SECOND page
row beside the damaged one and break S1's one-row invariant. It is filed rather than guarded
because today nothing can get there, and a guard against an unreachable state is a guard
nobody can test.

## 19. The writer beside E2, and why it declares no refusal channel (2026-09-20)

Merged `origin/master` at `d60db90` (E2 — the "what was prevented" rows). One semantic
conflict git could not see, and three interactions checked by running them.

**The conflict: two `daysBetween`.** E2 put one in `fired.ts` and imports it into
`doctor.ts`; S2 had landed a local copy of the same four lines for the page writer's
staleness reading, and the merge put them side by side. Resolved by deleting the local one
— one definition, shared with the fired view, which is the rule this module already keeps
for every other reading the two surfaces share. The one behavioural difference is kept and
named: the shared one returns a NEGATIVE when a clock has moved backwards where the local
one clamped to zero, and the comparison it feeds uses `>`, so a future date reads "not
overdue" rather than "today".

**E2's young rule and this mechanism's doctor line agree, by different roads.** E2 grades a
store too new when it is under two LIVED days and has no durable row older than two
CALENDAR days — both clocks, because a store whose worker has been dead a fortnight also
reads lived day 0 and that store needs the full list. The page writer's own line has been
green-when-never-run-on-a-store-with-no-yesterday since S2 shipped, which is the same answer
read off whether a day before today holds anything. Measured: on a fresh store both say
young, and the roll-call comes back on its own after two `advanceClock` calls.

**And it declares no refusal channel, which is the honest answer rather than an empty one.**
`RefusalSource.only` exists because reading a namespace wholesale made a healthy store
report `BLOCKED prune … dwell-too-short ×240` permanently — the test it sets is whether a
NAMED RULE turned away a candidate that otherwise qualified, the owner saying no, rather
than arithmetic saying not yet. Nearly every skip here is the second kind, and one of them
is worse than that: after the night's first ask, `already-claimed` is what a perfectly
healthy store says at every session start until midnight. Declaring these would rebuild the
false alarm one namespace over.

The one that is arguably a real gate is `no-room` — the host's ceiling turning away a block
that qualified. It is left out anyway, because it already has a louder and better-aimed
surface: doctor's Page writer line goes amber after two owed days and names
`injectionBudgetBytes` in the fix. Two surfaces for one fact, one of them permanent on any
store with a tight ceiling, is the shape the review was about.

## 20. The page is not embedded — a working default, not a ruling (2026-09-20, landed with E1)

E1's adversarial review asked whether the self page was in the same position as the
per-directory handoff, which E1 had just excluded from embedding. It was: `missingVectors()`
held it, and with a sync embedder wired — which the live adapter does — `indexOne` embedded
it at every `revise`. E1 flagged it rather than fixing it, correctly: a one-line predicate in
`store/` is not the place to set this module's policy.

**Who decided, said exactly.** The COORDINATING SESSION asked for the exclusion the same
day, and it landed with E1's PR. **The owner has not ruled on it.** A coordinator's ask is
never his word, and nothing here is recorded as a ruling that was not one — this is a
working default in the ordinary sense (CLAUDE.md: decisions are defaults, revisable without
ceremony), and one line in `store/#noVector` reverses it. It is worth putting to him if the
page is ever wanted searchable by meaning, because all three reasons below stop being true
at once in that case.

The three reasons it was asked for, recorded here because they are about the PAGE and not
about the seam:

1. **A vector buys the page nothing.** `recall/activate.ts#isSelfPage` skips it — the page
   is delivered whole at every wake and never surfaces in a turn — so nothing the semantic
   channel ranks could ever deliver it.
2. **It is the most identity-bearing prose in the store**, up to `PAGE_MAX_BYTES` of it, and
   embedding sends it to an API for that nothing. Constitution 6: data leaves the machine by
   the owner's explicit choice, and an indexer that indexes everything is not one.
3. **It floors the embed backlog.** `unembeddedCount()` is the number `doctor` and the
   parallel run watch, and its job is to say what is actionable; on a keyless store a page
   in it never falls out.

The rule is `store/#noVector`, which names `role: "page"` and `role: "handoff"`. The page's
row keeps its LEXICAL index, so the dashboard's search and the console's `remove` flow still
find it — neither is a recall path. Nothing retracts a vector a page already has; the one
door is `counterparts verify --rebuild`, and the measurement is in
`core/handoff/INTERFACE-GAPS.md` §7. The owner's live store has never had a page written, so
nothing has been embedded there.
## 21. The journal's markdown copy: what the build chose, and what the plan got wrong (2026-09-20, F6)

`docs/plan-step3-the-floor-2026-09-17.md` §1.5 designed this module before the
floor existed. Four of its choices survived contact with the code and three did
not; all seven are here so the next reader does not have to diff them.

**Kept from the plan.** A new module called from the chapter door immediately
after the store write; `journal/<YYYY>/<YYYY-MM-DD>-<episodeId>.md`; whole-file
rewrite per append; the observer writes nothing; a failure is caught and becomes
a `journal.copy.failed` row rather than an exception.

**Changed, with the reason.**

1. **One function, not a writer and a deleter.** The plan had a writer; removal
   needed a deleter; two functions would have expressed one invariant twice.
   `syncJournalCopy(store, id)` asks the invariant instead — *a file exists
   exactly when a live episode row does, and holds exactly what that row holds* —
   so the chapter door's rewrite and the destruction console's removal are the
   same call, and the thing the tests assert is the sentence rather than two
   implementations of it.
2. **Per append, not per session end.** The plan's §7.6 recorded this as
   undetermined. The code answers it: the episode row is revised on every append
   (`episodes.ts#appendChapter`), so the file is a whole-file rewrite either way
   and per-append costs nothing extra while per-session-end loses a crashed
   session's last chapter.
3. **No doctor count over seven days.** The plan wanted one; the brief wanted a
   line only while a failure stands, and the brief is right for the reason
   `snapshotFindings` states about permanently amber lines. A derived copy that
   refills itself has no interesting count. `journalCopyFindings` returns **no
   finding at all** in the ordinary case.

**Two things the plan did not think about, and the reviews did.**

4. **The temp file is a residue surface.** A crashed rename leaves
   `<final>.md.tmp-<rand>` holding a chapter's words, `journal/` is in the backup
   set at the time, and so a leak would ride into every snapshot. (That flag is
   `false` since the f6f7 review — §16 — which removes the snapshot half of the
   argument and leaves the other half standing: a crashed rename otherwise
   leaves a chapter's words in a file nothing owns, inside the store, for ever.)
   Hence one filename matcher
   that finds the final name, an older date's name and a crashed temp
   (`journalFileEpisodeId`), and a sweep bounded by mtime — bounded for exactly
   the reason `cli/export.ts`'s temp sweep is: an unbounded one would take a
   concurrent writer's file between its write and its rename.
5. **The backfill is bounded twice, and it does not run where the first draft of
   this note said it did.** `Self.boundary` is the consolidation cycle's last
   content write (through `core/briefing.ts#selfRenderer`, SEAMS G), so the
   backfill runs in the **detached worker**, not in the session's Stop hook —
   that calls `Counterpart.boundary`, a different method that appends spans and
   thinks about nothing. The bounds stay: a count (25) *and* a wall clock
   (250 ms), because the worker is watchdogged and shares a cycle with decay,
   dedup and the prune. The honest consequence, stated rather than glossed: a
   store with a thousand episodes and no `journal/` fills over forty WORKER
   RUNS, which is weeks on a normal cadence, not minutes. The chapter door is
   what keeps a live store current; the backfill is for episodes that predate
   the feature or a directory somebody deleted.
   It fills what is MISSING and does not re-derive what is present —
   re-rendering every episode to prove nothing had changed would read every body
   in the store at every boundary.

**What is NOT built, and what would earn it.** There is no repair path from file
back to row and no reconciler: the file is downstream, and a parser here would
re-create exactly the two-can-disagree problem the floor deleted `parseProse` to
end. The store CONTRACT's §4 says that second half in its own words now: markdown
is an export, AND the journal keeps a file copy — a copy, derived, write-only,
classified in the layout but deliberately out of the backup set, regenerated from
its rows if it is deleted.

## 22. The calendar day is the person's: local midnight for the cap and the night (2026-09-23, B3)

**The ruling.** The owner's, 2026-09-23: the six-a-day ask cap and the "nightly" page
writer take their calendar day in the machine's LOCAL zone. Until then both read
`Store#today`, which is UTC — an owner at UTC−6 got the day's allowance back at 18:00,
and the writer's night turned over at about 17:00 Pacific (`claude-code/INTERFACE-GAPS`
§13).

**What moved — one helper, read in one place.** `calendar.ts#calendarDate(at, zone?)`
turns the STORE's provenance instant (`store.now()`, never the ambient clock, so a seeded
or replayed store decides its days by its own run) into `YYYY-MM-DD` in `zone`, or in the
machine's zone when none is given — which is what `TZ` sets. `Self#calendarToday()` is
the only caller inside `self/`, and it now decides: the cap's day (`askDue`,
`openChapter` → `asksDay`), the writer's due check, the claim's `on` stamp, and the
defaults of `pageWriterStatus` / `pageWriterClaimOpen` / `pageWriterInput`. The claim's
`on` had to move WITH the day it is compared against — `claim.on < today` with one side
local and the other UTC would close a night hours early or late. Host mode
(`claude-code/page-writer.ts`) stopped passing its own `today` and lets `Self` decide,
so the two modes cannot disagree about which night is owed.

**What did not move.** The LIVED day (physics) is untouched — no clock move here reads or
advances it (`test/local-day.test.ts` asserts it). Every PROVENANCE date stays UTC and
stays `store/`'s: `learned_on`, the page's `revisedOn`, a clearing's `on`, every `date` a
hook stamps (`input.at`, the `adapter.ask` row's `date`), the worker's run date. The page
writer still SELECTS a night's memories by `learned_on`, so the day it names (local) and
the rows it reads (UTC-stamped) are offset by the zone. Nothing is read twice or
skipped — each UTC date is read by exactly one run, the first one after it has closed —
but west of UTC "the 18th" is 18:00-on-the-17th to 18:00-on-the-18th local. That is two
clocks in one store, named rather than hidden; the fix that removes it is `store/`
stamping `learned_on` locally (`store/index.ts#dateOf`), one clock moved once, and it is
not this module's to make.

**The east-of-UTC guard.** `pageWriterNight` holds the night back to the newest
provenance date that has CLOSED: `about = min(local yesterday, UTC yesterday)`. West of
UTC the local yesterday is never later than UTC's, so this changes nothing there. East of
UTC, for the hours between local midnight and UTC's, the local yesterday is a UTC date
still being filed under — and on a store made that morning its rows are hours old, so a
plain "local yesterday" would have broken DAY 0 (`no-previous-day`) for every new user in
Asia or Australia. With the guard the night waits until that date closes (09:00 in
Tokyo); a caller that passes `today` explicitly gets the plain rule, unchanged.

**The day of the change — accepted.** An `asksDay` stamped under UTC and read against a
local `today` can differ for a few hours: the allowance may refill once early, or hold a
few hours late, and `asksSpentOn`'s existing rule (a mismatched stamp reads as nothing
spent) means it never reads as MORE spent than there was. Likewise a writer claim stamped
with a UTC `on` may close its night a few hours early or late, once. Both were accepted
with the ruling.

**Tests do not depend on the machine's zone.** `Self` takes a `zone` (`SelfOptions.zone`),
and `test/local-day.test.ts` pins `America/Chicago`, `UTC` and `Asia/Tokyo` explicitly;
the older writer tests now read the night through `pageWriterNight` instead of
recomputing it from UTC, so the whole suite passes under any `TZ`.

**Doctor reads the same night** (PR #189 review, M2). `doctor-self-page.ts#pageWriterFindings` took
`dateOf(store.now())` — UTC — and compared a claim's local `on` with it, so every Pacific
evening it called an in-flight claim "nothing-to-say (derived)" and named the wrong night
as owed. It now reads `pageWriterNight(store)` and passes that `about` to
`pageWriterDue`, the one function the writer's own header says all three readers share.

**An ended claim closes its night** (review m7). East of UTC the night is held to a UTC
date across local midnight, so the same `about` could outlive the local day its claim was
made on: `pageWriterStatus` then read it `nothing-to-say` and `pageWriterClaimOpen`
false, while `pageWriterDue` offered the night again. `pageWriterDue` now treats an
`asked` claim whose `on` is before today as closing the night, so the three agree. West
of UTC `about` moves with the local day, so this never fires there. Boundary cases —
UTC−7 at 23:30, UTC+9 at 08:00, 00:10 local, both DST days, and the review's two repros —
are in `test/local-day.test.ts`.


## 23. The pacer counts what the person typed (2026-09-24)

Measured 2026-09-24: the Stop ask fired after the owner's second message. Turns were every
conversation text piece from both roles, and each assistant text block between tool calls
was its own piece — one session had 8 assistant blocks (8.6 KB) against his 2 messages
(2.3 KB), so the assistant's own writing paced the ask.

Now `Substance.turns` is messages the person typed (the host counts them:
`claude-code/hooks.ts#substanceOf`) and `Substance.bytes` is conversation text from both
roles. An ask is due on either, whichever comes first — first ask `FIRST_ASK_TURNS` or
`FIRST_ASK_TEXT_BYTES`, later ones `REASK_TURNS` or `REASK_TEXT_BYTES` since the last. The
old AND was there to stop the assistant's reply re-asking on its own; with turns typed-only
and a larger byte threshold that job is done by the counting. `MAX_ASKS_PER_SESSION` went
to 12, since typed-turn pacing spaces asks further apart. All five numbers are tunables to
move as the owner's days show.

**Sessions in progress.** A watermark committed under the old counting sits above what
typed-turn counting reaches for a while. Byte counting did not change, so such a session
reads exactly one way: bytes at or past the watermark, turns below it. On that pattern
only, `openChapter` pulls the turn watermark down to today's count
(`episodes.ts#rebasedWatermark`, one persisted write, ring event `self.episode.rebased`),
and `askDue`/`noteOrphanTail` read the same re-based state. Any other reading below the
watermark — an empty one from a transcript that would not read — moves nothing, and a
caller can say its count is not real with `rebase: false`.

## 24. A chapter's heading carries its calendar date, and the model that wrote it (2026-09-24)

`chapterHeading` writes `## chapter 1 — Wed 23 Sep 2026 · lived day 2` for every chapter
opened since this date, where it wrote `## chapter 1 — lived day 2` before. The owner
could not tell which DAY a chapter was from anywhere it is read back (`ask`, the
dashboard, the markdown copy, an export) — the lived day is the physics clock and means
nothing on a calendar. The date is `calendarDate(store.now(), zone)`, the same local day
§22 gave the cap and the night, so a chapter written at 20:00 in Chicago says the 18th
while its `learned_on` says the 19th. Stored bodies are NOT rewritten: older chapters keep
the older heading, and `readChapterLead` reads both forms — and the bare `## chapter 1` a
model sometimes writes under the journal's own — for a surface that shows a chapter's
words on one line and its heading as metadata. Every surface that prints the body
inherits the new heading with no change of its own; none of them parses it.

**Built the same day: each chapter records the model that wrote it.** The heading reads
`## chapter 1 — Wed 23 Sep 2026 · claude-opus-5-5 · lived day 2`, and the episode's
`meta.models` maps chapter number to model id (`{ "1": "claude-opus-5-5" }`), written
when a chapter opens and carried whole on every revise (meta merges shallowly). The
path is the one below: `parseTranscript` takes the last assistant `message.model` that
is not a host stand-in (`<synthetic>`, `isApiErrorMessage`) or a sidechain → the
record's `model` (carried like `config`, newest wins; `isModelId` screens it, since it
is printed into a heading) → `chapterTool` → `appendEpisode({ model })`. The Stop writes
the record before its ask goes out, so the chapter that answers the ask has the right
model. Unknown model: the heading is the dated form, nothing added. `ask`'s meta line
shows it after the date; the dashboard's journal list shows no date and was left alone.
Raw ids are printed as the host reports them.

The original note, kept for the reasoning: which MODEL wrote a chapter was not recorded
(asked the same day). It needs no schema
migration — the episode's `meta` is open JSON — but this package does not know the model
at the door that writes a chapter: `chapter` is an MCP tool, and the MCP server has no
hook input and no transcript. The host's only sources are the SessionStart input's
optional `model` (documented as not always present) and `message.model` on the
transcript's assistant entries (reliable, per turn). The relay would be: every hook
already parses the transcript (`claude-code/bin/hook.ts#toHookInput`) → take the last
assistant `message.model` that is not `<synthetic>` → carry it on the session registry
record (`adapters/sessions.ts`, optional fields already) → `mcp/server-session-end.ts#chapterTool`
reads that record, as `corroborate` already does → `appendEpisode` opts → `meta` per
chapter. It lags a mid-session `/model` switch by one turn (the record is refreshed at
the boundary, and this adapter registers no `PostModelSwitch` hook).

## 25. One calendar for the self and the store (2026-09-25)

docs/time.md moved `learned_on` to the local day, in the STORE's zone (`Store#zone`: the
config's `timeZone`, else the machine's). §22's "two clocks in one store" is therefore one
clock from this date: `Self` with no `zone` of its own now uses the store's
(`dayZone()`), and `pageWriterNight` passes the store's own yesterday as `closedThrough`,
which in one zone IS the local yesterday — so §22's east-of-UTC guard reduces to the plain
rule. It is kept, because it still does the right thing for a `Self` pinned to a zone apart
from its store's (the tests in `test/local-day.test.ts` pin the store to UTC to keep
proving it). For the nights either side of the change, rows written before carry a UTC
`learned_on`, so a row may be read one night early or late — never twice or not at all.

`calendar.ts` is now a re-export of `core/time.ts`, and `isModelId` of `core/types.ts`;
no caller moved. The self page and each chapter's episode row also record their writer in
the store's `model` column (store NOTES 2026-09-25) beside `meta.models`.

## 26. "Nearby" rotates: organic strength × habituation (2026-09-26)

*The owner's "rich get richer" (2026-09-25), harvested from the held #238 and reworked
after its review. `identity.ts#hintReading`; physics §5.11 for the other half.*

One strong memory held the hints lane nearly every session: shown, mentioned by the
assistant, credited, still strongest, shown again. #238's review measured its fix
slowing the loop without breaking it — the strong memory was back every day by ~day 20
of a 60-day simulation — because a use while shown still reset `lastUsedDay`, still
added to `uses`, and was only half a habituation step. Now:

- **The lane ranks on ORGANIC strength** — the memory decayed from its last organic use,
  with the uses it had when it was FIRST EVER shown plus its awake returns (each return
  is a use the display did not prompt). A use while it was showing moves neither. Its
  own strength still rises (the use credits, as always): the warm floor, recall and the
  bands read that.
- **Habituation**: each published showing adds `HINT_STEP` (1, used or not), recovering
  as `exp(−days / 3)`; the pull is `1 / (1 + load)`. A return AFTER it left the lane — a
  memory reached for without the prompt — resets the load.
- **What was shown is a store table** (`wake_display`, schema v8), written by `boundary`
  on a real publish (kept ids, not ranked ones; every other open showing closed that
  day), because the store needs it too: a use while a memory is showing is not a return.
- **Dropped from #238**: the scope/session context boost (it followed the scope of the
  boundary that triggered the render, not the reader's — its own named approximation),
  and the `self.hinted.*` meta keys (a table is chased by removal; meta keys were not).

Measured (`tools/sim/consolidation.ts`, 60 lived days, HINTS_MAX 8, a strong memory
used every time it is shown, two new facts a day): shown on 34 of 60 days, longest run 8,
99 distinct memories shown, 0 returns. `test/hints-nearby.test.ts` pins the rotation, the
recovery, the organic reset, the same-day re-render, and a 60-day loop at the defaults.


## 27. The page is rewritten by the reflection (2026-09-27)

The page had been stuck at version 1 since 09-24: the nightly writer's ask rode in the
SessionStart injection beside the wake and deferred `no-room` every session
(`adapters/claude-code/hooks.ts`), and as the wake grew it could only get worse. The
rewrite moved to the reflection after a dream (`core/dream/reflect.ts`): it is handed the
page as context and the core as the source, cites the memories the page rests on (at
least one core memory when there is a core), and writes through `revisePage` with
`by: "writer"` — the author the S2 writer was given, so no new vocabulary. The write
records the night's page-writer run, which claims the night: the SessionStart writer
finds it claimed and stands down, and on a night with no reflection it runs as before.
Left in place because it does no harm and dreamless nights still have it. Craft belongs
under "## How I work", not the core; the reflection's instructions say so.

## 28. The writer moves into the nightly run; the reflection gets its own name (2026-09-28)

Working defaults, held lightly. §27's diagnosis stood (the SessionStart ask deferred
`no-room` as the wake grew), and the owner's fix is to take the writer off the wake
entirely: once a calendar day one background agent runs the page writer, then the dream,
then the reflection (dream CONTRACT §5.2; the order is the owner's call — the writer
first reads yesterday raw, survives a cut-off session, and the dream and the reflection
see the fresh page).

- The writer's day arrives through the dream tool's `writer` phase, a tool result: the
  page whole (`pageInline`, since the agent never got the wake) and up to
  `NIGHT_WRITER_MEMORY_BYTES` (40,000) of the day. The claim is the ordinary `asked` row,
  now carrying `session` and `run` in its payload; `nightClaimFor` is what the MCP door
  reads to write `by: "writer"`. No new event name, no schema change.
- The writer and the reflection are different jobs and both may write the page for now:
  the reflection writes as `reflection` (a new `SELF_PAGE_AUTHORS` value — the label lives
  in the page's own meta, so no schema), and it no longer records a page-writer run. After
  a few days the owner compares versions to see whether they overwrite each other.
  (2026-10-23: they did — the page was rewritten whole twice a night. Now split by
  section, below.)
- `pageSections` reads ANY heading: "## Us" and "## How I work" fell out of every view
  that read the parts. Core and Lately are kept by name, as the convention.
- The day survives a dream's merge (`isOfDay`, `hasDayBefore` counting archived rows) —
  found while the order was still dream-first, kept for a dream left behind or resumed.
- Retired with the session-start ask: its sizing against the wake's ceiling, the durable
  `no-room` / `scope-question` deferral rows (old rows still read), and the scope
  question's patience counter. Host mode is untouched and not the default.

## 2026-09-29 — a memory's standing in the wake's lanes (review of #284, S3)

`resolveStatement` reads `recall/standing.ts#standingOf` for each element and
`elementLine` puts its prefix before the statement and its suffix after, so the hints,
threads and identity lanes say `Earlier (now [id])`, `Unsettled — may be out of date,
see [id]` or `(disagrees with [id])` exactly as recall does. The byte accounting reads
the same line, so it counts the label. The hints ranking needs nothing: `hintReading`
goes through `strength()`, which carries a `changed` memory's fade.

## 29. The wake says what it left out; host mode's rows (2026-09-29)

**"N more" lines.** The lane caps (identity 24, craft 8, threads 12, hints 8, horizon 6)
cut silently, and the budget trim's count lived only in telemetry. Now `rankLanes` carries
what each cap left out (`Lanes.overflow`, optional so hand-built lanes still compose), and
`render` gives each lane that lost something — to its cap, the identity share, or the trim
— at most one furniture line: `(3 more still open; recall ids: mem_…, …)`, up to
`MORE_LINE_IDS` (5) ids, "the first 5" when there are more. Choices: the ids are recall's
`ids` argument because that is the handle that reads a memory whole by address (a question
could miss them); the line is furniture — no bullet, not in `counts` or `elements` — so
the header and sentinel stay true; lines are offered room in the reverse of the trim
order (identity, horizon, threads, craft, hints) and only AFTER the identity leftover, so
they take only room nothing else wanted; a line that does not fit is dropped and the next
lane's tried. Identity says nothing while the page replaces the list. On a normal day this
does change the wake: a store with more than eight warm hints will carry a "nearby" line.
The test that proves the ids work goes through the real MCP `recall` handler.

**Host mode's rows.** `PAGE_WRITER_MODES` is `off` and `session` now. A row an old build
wrote with `mode: "host"` stays in the log as written and READS as `session` (the reader's
fallback for a mode it does not know), rather than keeping a third mode alive in the type
for rows that, as far as anyone knows, were never written on a real store. An abandoned
`started` — host mode's claim — still reads `failed`.

## 30. The wake keeps up with the day (2026-09-30)

**Why.** The bundle was rendered once per lived day, by the cycle, at the day's first
worker run. On 2026-09-30 the owner's first session of the morning woke with the page one
version back: under dreaming `auto` the nightly run starts at the day's first prompt, the
first turn-end a minute later runs the cycle while the run is still going, and phase 7
renders before the run's writer writes. Nine `self.briefing` rows for nine lived days.

**What.** Two writes mark the wake behind (`behind.ts`; every accepted memory and every
handoff change since 2026-10-10, below): the page written (`revisePage`,
`clearPage`; every writer arrives there) and memories accepted through `session_end` (the
door both the Stop ask's answer and the next-session write-up take —
`Counterpart.submitSessionEnd`). `Counterpart.refreshWake` re-renders through `rebrief`'s
path (one renderer, the preface reserved, no marker moved) where a process holding the
host's budget next runs: the turn-end worker after its cycle, when marked; and the nightly
process after the child returns, whatever the run's state — that one writes no mark and
passes `run-end` straight in as a trigger. The host
re-fires Stop after a session answers the ask, and that Stop still spawns a worker, so the
write-up case needs nothing of its own. The `self.briefing` row says `reason: "refresh"`
and `triggers`. No budget, no render: the refusal stands and the mark waits.

**The mark.** Two meta keys, so the renderer never writes the key a writer sets:
`self.wake.behind` (`{ n, at, triggers }`) and `self.wake.caught` (the raw mark a render
read before it composed). A mark set during a render has a new value and survives the
catch-up; `n` keeps two marks apart under a clock that stands still. The cycle's own
render catches up too, so the day's first worker renders once.

**Same-day stability.** A re-render the same lived day used to score a hint shown that
morning at its already-stepped load — half, at `HINT_STEP` 1 and `HINT_HABITUATION` 1 —
and hand Nearby to the runners-up (`counterparts rebrief` had the quirk). `hintReading`
now scores a hint an earlier render today showed at `load - HINT_STEP` — open or closed
since, because a row a later render today dropped carries the same step, and scoring it
stepped reordered the "N more" ids between two refreshes with nothing new (review of
#287); `nextLoad` already kept the step to one a day. The identity rotation put the elements stamped today
LAST and so rotated again; now they go first. Their order among themselves falls to
strength, because the stamp overwrote the day each was chosen by — so the first extra
render of a day can reorder identity lines against phase 7 while keeping the set. Moot
while a page replaces the list.

**Cost.** One refresh on a temp store: ~40 ms at 300 memories, ~77 ms at 600, ~180 ms at
1,500 (median of 15, this machine). The worker renders only when marked; the run's end
renders unconditionally, once a night.

**The page writer's "yesterday" under `auto`.** `pageWriterNight` reads the wall clock in
the store's zone, not the lived day, so a run that starts before the day's first worker is
about the same calendar yesterday as one that starts after (tested). The lived day reaches
the writer only in `dayMemories`' strength read (order within one day) and the `day`
stamped on the claim row and on the page's `revisedDay` — the dashboard's `newerThanWake`
compares that lived day with the last render's, and reads a same-day page as not newer.

**Every accepted memory, and every handoff change (2026-10-10).** The two writes became
all of them. A hermetic repro (notes 2026-10-10, wake staleness) showed a memory written
with `note` — the most common write mid-session — left Still open, Nearby and Arriving as
they were for up to a day, in every directory, a thread it closed included: the turn-end
worker found no mark and rendered nothing. The mark moved from `submitSessionEnd` into
`Counterpart.deposit`, on the accept arm, so every door marks it: `write-up` for
`session_end`, the new `memory` for the rest. `writeHandoff`, `retireHandoff` and
`clearHandoff` mark `handoff` when the write landed, because the bundle's room for the
handoff pointer is sized at render time (`handoff/` does not import `self/`, so the mark
sits in the Counterpart method). Cost: one render per turn that wrote something, ~0.45 s
on the owner's store copy and ~3 s at 10x, in the detached worker, no model call; turns
that wrote nothing cost nothing more. **The night run marks as before:** its main child's
tools (dream, reflect, self_page, recall) never reach `deposit` — dream and reflection
rows mint through their own doors — and the catch-up child's only tool, `session_end`,
already marked `write-up`. So no skip for the night: it would need a flag threaded into
the deposit context to change nothing observable, and `run-end` still renders once at the
end. Still not covered: the morning burst (sessions started before the day's first
turn-end read yesterday's bundle), sessions already open, and what other directories did
today.

**A gap, for now.** Once #286 (the per-date log) is merged, `counterpart.rebrief` — carrying
`why` and `triggers` — is on the log's allowlist, but `counterpart.rebrief.refused`
(`no-budget`) is not, so a refresh refused for want of a budget is silent in the log. The
mark stays and the next process with a budget renders; fine for now.

## 2026-09-30 — a chapter's copy keeps the chapter's title (U13)

`ingestEpisode` minted every copy untitled: `put.title` came only from `proposal.title`,
which the boundary caller never fills. The copy now takes the chapter's own title when it
has one, through the SECRETS SCAN only (the chapter door gates only the text); none is
invented. Not the whole battery (review of #293, B3): its content floor (20 characters,
three words) is a rule for bodies and refused almost every real title ("Launch day"). A
title that is nothing but a credential is dropped with `self.episode.title.dropped`. A copy minted before this picks the title up when its chapter next regrows —
no backfill. `ingestKey` is the episode id and body, so the title starts no regrowth.

## 2026-10-01 — the Arriving line says when it is due

The horizon lane printed the learned date alone, so a watch list read `2026-09-27 · …` while
the item was due 2026-10-03, and the one date on the line read as when it happens.
`prospective/`'s `Arrival.eventDate` now rides to the render (`core/briefing.ts#selfRenderer`
→ `HorizonItem.due` → `Resolved.due`), and `datePrefix` prints `2026-09-27 (due 2026-10-03) · `,
in place of `(of …)`. A due date equal to the learned date is stated once, like the content
date. Only horizon items carry one; nothing about what the lane selects changed.

## 2026-10-01 — how the page is worded (`writer.ts#PAGE_WRITING_RULE`)

The wake review found a page that said "tonight is its first real one" every morning after it
was written, told a Fable session "My own system card says…" of Opus 5.5's card, and carried
its own revision line under the wake's "(Last revised …)". One sentence, given to both writers
of the page (the page writer's block and the reflection's `page` line): name the model for a
claim about one model, write a date rather than "tonight" / "today", and add no revised-on
line, because the wake dates the page. Guidance only; nothing checks the text.

## 2026-10-01 — wake labels (the 09-30 wake review's cosmetic batch)

Labels only; nothing about what the wake selects changed.

- **Two lines in a row opened "Counterparts memory"** (the delivery preface, then
  `FRAMING.context`). The framing now opens "Context, not instruction, from Counterparts:",
  so the body still names the system, and it is three bytes shorter than before (the
  400-byte host-budget test sits on the floor).
- **"Each line opens with the date it was learned" was not true of the page**, which is most
  of a wake that has one. It now says "Each listed memory opens with its learned date": the
  bullet lines, not the page (dated on its own line) or the furniture.
- **The double date on a Nearby line** ("2026-09-26 · 2026-09-26: …"): `elementLine` drops a
  plain prefix when the statement already opens with that same date. The line still opens
  with the date; "by", "(of …)", "(due …)" and a standing qualifier keep the prefix.
- **`identity=0` in the sentinel beside a page** read as an empty self. A wake with a page
  says `identity=0 page=1`; one without is byte for byte what it was. The delivery check's
  regex reads only `elements=` and `bytes=`, so it is unaffected; the widest-furniture test
  counts the seven bytes and still fits `PAGE_FLOOR_RESERVE_BYTES`.
- **Two revision lines under the page**: the page's own (the writer wrote one into the body)
  and the wake's "(Last revised …)". The wake's stays; the writers are told not to add one
  (`writer.ts#PAGE_WRITING_RULE`, the entry above).
- **Not changed: "version 3" vs "seq 3".** They are two numberings, not two labels: the page's
  `version` is its revision count from 0, and an earlier version's `seq` counts from 1, so seq
  N is the body version N−1 was. Making them one changes what `self-page --version`,
  `--restore` and `ifVersion` take, which is a decision, not a label.

## 2026-10-01 — what Nearby and Arriving leave out (an inside view of 0.3.10)

- **An answered question shown alone.** Nearby carried an "Open: …?" memory without the
  later memory that answered it. A memory that is the `over` of a settled `changed` or
  `corrected` pair (`settledOver`) now leaves craft, threads, Nearby and Arriving;
  identity keeps it, labelled, because that band is earned. Left out rather than shown as
  "Earlier (now [id]): …" because the line's words are still the question. ONLY WHILE
  SOMETHING LIVE HOLDS (review of #311): the pair that counts is the newest one naming the
  memory (so one re-affirmed by a newer pair is shown), and its `holds` is followed through
  newer settles and `superseded_by` to a live memory; an archived or removed `holds` hides
  nothing. Why that pair was never flagged: two nightly dreams had both memories in their
  bundle and flagged nothing; an open question and its answer do not DISAGREE, and the
  dream's contradiction pass is asked for disagreement. Not built: a pass for "answered".
- **The same memory under Arriving and Nearby.** The horizon came from the caller and was
  never deduplicated against the scan; a memory arriving now leaves the other lanes.
- **Nearby repeating the page.** `covered.ts`: the reflection's cites, or a hint one page
  SENTENCE holds at `PAGE_COVER_SHARE` (0.35) of its rare-word weight. The first version
  compared whole paragraphs at 0.2, which dropped a new fact that merely shared a subject
  with a one-paragraph page (review of #311). Measured on a copy of the owner's store at
  sentence level, no Nearby candidate passed 0.13, so in practice the cites are what cover;
  the word test catches a near restatement.
- **"(331 more nearby; recall ids…)"** is gone: it counted the warm store.
- **Not built: directory weighting** (the brief's 6b). The lanes are composed once per
  store and read in every directory, so "weight the directory you woke in" needs a
  delivery-time choice among published candidates, with the sentinel's counts re-solved.
  On the probe copy, a reading directory's Nearby was four work memories from the code
  repository.


## 2026-10-01 — craft is this directory's work; Nearby is personal (lane 8)

- **What was measured.** On the owner's store the craft lane took only kind `skill`
  above `WARM_FLOOR`; every skill memory was young and barely used, so craft never
  carried a line. The technical knowledge was kind `fact`, competed in Nearby, and a
  reading directory's wake got another project's plumbing. Both such lines on the
  probe copy were UNMARKED facts written in the build directory.
- **The split** (`work.ts#isWorkMemory`): `work` is work, any kind; `me`, `us`, `owner`
  and `world` are personal; unmarked, a `skill` is work, a `fact`, `entity` or `place`
  is work when it carries a directory (`origin_scope`) and personal when it does not,
  and `self` and `person` are personal. A journal copy is never work. The brief's
  suggestion ("unmarked fact: craft only in its own directory, else Nearby") would have
  left both measured lines where they were, so it was not taken.
- **Composed at delivery** (the "Last here" way): the stored bundle has no craft lane
  (`rankLanes`' `workAtDelivery`, switch `CRAFT_AT_DELIVERY`), and
  `Counterpart#addHandoffPointer` splices "Work here, if it helps:" for the session's
  directory above the handoff block, in the room the handoff and "Last here" leave —
  they are chosen first. The lines: newest touched first (born or used), then strength;
  no warm floor; not a thread, a reminder, confidential, or settled over; at most
  `WORK_HERE_MAX`, each a title, a cut excerpt and the id. Furniture: the sentinel's
  `craft=` stays 0 and the counts do not move.
- **Its own reserve** (`Counterpart#workReserveBytes`), under the handoff's share rule:
  the widest directory's block, up to an eighth of the budget. It cannot be a rung of
  the handoff's reserve: the handoff block alone sits near the eighth at 9,000 bytes.
- **On the probe copy at 9,000 bytes**: ~/random's Nearby went from two build-directory
  facts and one owner memory to three owner memories, and it gained four work lines
  written in ~/random; ~/counterparts gained four work lines; both still carry the page,
  "Last here" and the handoff.
- **Open**: no habituation on the work lines (a memory used every day stays first);
  unmarked facts written in a directory but really personal wait for the reflection to
  mark them. (2026-10-02: the lines past `WORK_HERE_MAX` now rotate by lived day — see
  that day's note.)
- **Review of #313.** A name scope (`claude-desktop:`) is not a directory
  (`work.ts#isDirectoryScope`: an absolute path), so Desktop chat's unmarked notes stay in
  Nearby. Unmarked `person` and `self` memories are personal wherever written (they always
  were; now pinned). The `about` field asks for `owner` or `us` on anything personal
  instead of "leave it out when unsure"; the nightly reflection's marks correct what stays
  unmarked. The candidates are filtered and capped in SQL (`Store#workCandidates`) before
  any prose is read: about 3 ms per delivery on the probe copy, bounded by
  `WORK_HERE_MAX × WORK_HERE_READ_PER_LINE` reads whatever the store's size.
- **The `omit` composition** (the background writer woken as the self) has no directory
  to deliver work lines to, so it now sees neither a craft lane nor work hints.

## 2026-10-01 — a chapter's `about`, carried to its copy (lane 8)

`appendChapter` takes `about` (`EPISODE_ABOUT_META` on the episode, and `setAbout` on the
live copy, found by `origin_ref`); `ingestEpisode` gives a new copy the mark of the copy it
replaces, else the episode's own. Latest act wins: the writer's chapter-time mark, then a
reflection's on the copy, are both on the copy's row by the time it regrows.

## 2026-10-02 — a wake another build published is behind (`version`)

The first wakes after an install were the ones the old version composed, until a mark or the
next lived day: on 10-01 a question 0.3.11 closes stayed in "Still open" all afternoon. Now each
publish stamps `self.wake.build` with the package version of the process that rendered it
(`CounterpartOptions.build`; the turn-end worker, the nightly process and the console pass
`installedVersion()`), and `refreshWake` adds the `version` trigger when the stamp differs from
the running build, or is absent beside a bundle (one published before the stamp existed). No
mark is written for it: the comparison is the mark. An unknown build compares nothing. What
remains: the first SessionStart after the install still reads the old bundle — SessionStart
renders nothing (CONTRACT §5 G1) — and that session's first Stop re-renders it for every
session after.

## 2026-10-02 — the work lines rotate, and an overflow leaves a row

With more work in a directory than `WORK_HERE_MAX`, the same newest four showed every day
and the rest never did, and a "Work here" with no room left only a ring event. Now
`workHere` ranks up to `WORK_HERE_POOL` (8) and `rotateWork` chooses the day's lines: the
newest stays first, and the other places move through the rest by lived day, so every
session that day sees the same lines (identity's once-a-day rule) and a week shows them all.
Stateless: nothing is written to remember a rotation. Each line costs
`WORK_HERE_READ_PER_LINE` prose reads at delivery, so the pool doubles the reads (40 at
most). When a delivery carries fewer lines than it ranked, one durable `self.work.overflow`
row per directory, cause and lived day says so: `cap` (more than a wake shows, so they
rotate) or `room` (fewer fitted the room the handoff and "Last here" left; `shown: 0` is
none). Doctor's Wake line counts the `room` days; the dashboard's wake bar counts the
directories since the last render, as it does "Last here". `cap` is the rotation working,
and is not a cost.

## 2026-10-03 — chapter addresses (Release A of deliberate recall)

- **`epi_…#N`** names one chapter (1-based), and `chapter-address.ts#resolveChapter`
  resolves it to its heading, text, calendar date, span and the session's memories written
  in that span. The address is derived (the chapter's place among the engine headings,
  read by `handoff/last-here.ts#chaptersOf`, which now also returns the heading line).
- **The moment each chapter was written is stored** in the episode's meta
  (`CHAPTER_AT_META`, carried whole like `models`), because the only other record — the
  `episode-chapter` version's `archived_at` — is pruned after the retention window.
  Episodes from before are read from those versions while they last; past them the
  resolver says `momentsFrom: "unknown"` and lists no memories rather than guessing from
  the heading's day.
- **The span** runs from the chapter before's moment (open for the first) to this
  chapter's, each edge shifted by `CHAPTER_MOMENT_GRACE_MS` (five minutes, a working
  default): the end-of-stretch answer writes its memories and its chapter in one turn, in
  either order. Chapter copies are left out of the list. A write-up's memories carry the
  session's id but a later moment, so they sit under no chapter. No caller yet (Release B).
- **First caller (Release B, meaning mode):** `chapterTimesOf` reads an episode's chapter
  moments once and `chapterAt` places one memory by the same span rule, so recall can put
  hundreds of a subject's memories under their chapters without a `resolveChapter` (and its
  per-memory prose reads) for each; a test holds the two to the same answer.

## 2026-10-09 — a regrown copy keeps its links

- When a chapter grows, `ingestEpisode` mints the new copy and archives the old one
  (`episode-regrown`). The old copy's links (the session's contiguity, a co-use, a dream's
  tie) stayed on the archived row, which conducts nothing: on 10-02 that was 260 of a live
  store's 1,200 edge rows. `SelfOptions.retarget` now hands each archived copy's links to
  the new copy, after the archive. It is `associate.retargetOnSupersede`, injected by the
  composition root as for `schemas/` and `dream/`; absent, nothing is carried, as before.
- A retarget that throws costs the links, never the copy: counted on
  `self.episode.relink.failed`, and the ingestion reports what it always did.
- The links stranded before this are carried once at open, in `counterpart.ts`
  (associate NOTES §15).

## 2026-10-09 — the page's own "Last revised" line is taken out

The 10-01 guidance (`PAGE_WRITING_RULE`, above) told both writers to add no revised-on
line, and nothing checked it: the wake still printed two date lines under "Who I am" for a
page that carried one, and a page that already had it kept it. Now
`page.ts#stripRevisedLines` takes the line out in two places: where the wake renders the
page (`Self#pageBlock`, so a page stored with the line prints one date from the next
render), and at the one write door (`Self#revisePage`, before the caps, the gate and the
byte count), so a stored page heals the next time anyone writes it. A line is the page's
own when the whole of it opens with "Last revised" past any parentheses, brackets,
emphasis, quote marker or dash, and it is at most 160 characters; the words inside a
paragraph stay. The blank line it stood behind goes with it. The revision row says how many
went (`datelines`), because the owner's console writes through the same door. A page that
is nothing but the line is refused as `empty` at write, and printed as it stands at render.
The guidance stays: the strip is the check, not a reason to stop asking.

**Review of #332: only a dateline.** As first built the rule took any short line opening
"Last revised" past its wrappers, which took prose ("Last revised my view of …"), a quoted
line, a list entry, a code block's line and a page's own history list — at the write door,
so the words left the stored page. Now the words must be followed by a date (ISO or numeric,
a month's name, or today / tonight / yesterday), straight after or after "on" or a short
"by …"; and a line inside a code fence, beside another such line (a history), or an entry
beside another entry of a list stays. A lone one, at the head, the foot or between
sections, still goes.

## 2026-10-09 — the Arriving line says how often a repeating date comes round

A horizon item whose date repeats (`prospective/` NOTES §15) carries `every` beside
`due` (`core/briefing.ts#selfRenderer` → `HorizonItem.every` → `Resolved.every`), and
`datePrefix` prints `2026-08-25 (due 2026-10-12, every Monday) · `. `due` is this
occurrence, never the anchor, so a birthday stated in 1990 reads as due this year. Unlike
a one-off date, the parenthesis stays when the occurrence falls on the learned date:
"every May 14" is news even then. One change to what the lane selects (review of #339): a
DAILY repeat takes no line (`prospective/` NOTES §15) — rendered the evening before, it
would read as due yesterday.

## 2026-10-09 — "Still open" over nothing, and an Arriving line a day late

The owner's wake that morning read `Still open:` and, under it, only `(20 more still open;
recall ids (the first 5): …)`; and an Arriving reminder due 10-08 read `(due 2026-10-08)`.

- **Why no item fit.** Not the lane's items alone and not a lane share — the lane had no
  share at all. The page is furniture the trim cannot pop, so `Self#pageBlock` cuts it
  before the lanes compose, to `min(PAGE_WAKE_BYTES, budget − PAGE_FLOOR_RESERVE_BYTES)`:
  room for the wake's own furniture and nothing else. The delivery reserves (preface,
  handoff, work lines) bring a 9,000-byte host to a compose budget near 7 KB, the page
  takes ~6 KB of it, the Yesterday line (furniture) rides whole, and Arriving trims AFTER
  "Still open". Reproduced with 25 open items (~276-byte lines), a 7 KB page, a 300-byte
  Yesterday line and two Arriving lines: at compose budgets 7,100–7,250 the page showed
  5,961 bytes and "Still open:" printed over `(25 more still open; …)` — the room left
  (~150–290 bytes) held the 150-byte "more" line but not one item and its heading.
- **The floor — first drafted out of the page, and moved off it in review (#350).** The
  first draft cut the page to leave the Yesterday line, Arriving and 768 bytes of "Still
  open" their room (never below half the budget). Measured at the 9,000 default with a
  349-byte Yesterday line and two Arriving lines (compose budget 7,205): the page's cap
  fell from 6,144 to 5,361, and the owner's 5,845-byte page (version 16) printed 5,098 —
  the self the wake exists for, cut to make room for a list. So the page keeps its old
  cap, `min(PAGE_WAKE_BYTES, budget − PAGE_FLOOR_RESERVE_BYTES)`, and the room comes out
  of the lanes instead (`keepFirstOpen`): only when the trim loop fits with "Still open"
  empty, the lane's first item AND its "N more" line (one item with no count reads as the
  only thing open) are put back, and what gives way is, in order, the room the delivery
  holds for "Work here" (lent: the composition may run past its budget by up to the work
  reserve, the delivery then shows fewer work lines, and the render's `budgetBytes`
  states what it borrowed so Health's "runs over its ceiling" stays true), Arriving
  beyond its first line, and the Yesterday line's titles (shorter forms the root
  composes, fewer titles and the rest by count). All or nothing, and never past
  Arriving's first line, which the trim order still ranks above the first open item.
  Same scenario after: 5,845 → whole, one item and `(24 more …)` inside the budget, nothing
  lent; 6,100 and 6,144 → whole, one item and its count on 213 and 257 lent bytes, both
  Arriving lines and all four Yesterday titles kept, and "Work here" at four lines (the
  reserves' margins covered it) and three. The delivered wake then sits near the
  ceiling, so the clock line above it goes over by a few bytes — counted by doctor,
  never amber, as for any full wake (review of #318). Without the lend
  the same two drop Arriving's second line and two or three Yesterday titles. One item,
  not two: every byte past the first is taken from a reminder or from yesterday.
  Without a page the identity share already leaves the lane its room (5 of 25 listed).
- **The backstop.** A lane (not identity) that keeps no element and has something to say
  about what it left out is ONE line with its heading in it (`collapsedLine`): `Still
  open: 25 — no room to list them in this wake; recall ids (the first 5): …`. No "more":
  more than none is not a count. The dashboard's splitters read the lane off the line
  (`collapsedLane`). Seen in the same scenario at a 2,000-byte compose budget.
- **The Arriving line, by design and now said truly.** A quiet one-off stays in the
  horizon lane through its grace days (`prospective/` GRACE_DAYS, 7), and the wake is
  composed at a boundary and read later — the 10-08 evening's render read on the 9th.
  `(due 2026-10-08)` was a true date under a heading that reads as "still to come". The
  render now says `(was due …)` for a date already behind the day it was composed for
  (`HorizonItem.past`, set by `core/briefing.ts#selfRenderer` from its `at`), and the
  delivery — which alone knows the morning — says `(was due yesterday, 2026-10-08)` the
  day after and `(was due 2026-10-05)` later (`arrivingTense`, beside the preface, with
  the same date). It touches only the date prefix of an Arriving `- ` line, in what the
  preface's reserve leaves: "was " on every such line fits even beside the widest preface
  at `HORIZON_MAX` lines (tested); "yesterday, " is added while room is left. A due date
  equal to the learned date is now printed as `due YYYY-MM-DD ·` rather than the learned
  date alone, so the line says when and the delivery has a date to turn.
- **A plain reminder told on its day was still there the next morning** — reproduced:
  when the day's first render runs before the telling (a late session's turn ending after
  midnight), nothing re-rendered after it, so the told reminder stayed under "Arriving:"
  through the day and into the next morning. The claim now marks the wake behind
  (`told`, `behind.ts`), and the next turn-end worker re-renders it.

## 2026-10-09 — the self page is never cut in the wake

#350's second reviewer measured a gap between the two ends of the page. The wake's cap was
`min(PAGE_WAKE_BYTES = 6,144, budget − PAGE_FLOOR_RESERVE_BYTES)`, on the COMPOSE budget —
the host's ceiling less what the delivery holds back: the preface (160) and, under the
share rule (`handoff/#reserveBytes`, a block reserves only while `want × 8 ≤ budget`), up
to an eighth of the ceiling each for the handoff pointer with its "Last here" line and for
"Work here". At 9,000 that is 160 + 1,125 + 1,125 = 2,410, a compose budget of 6,590 and a
cap of 6,078 — while the writer accepted up to 16,384 (`PAGE_MAX_BYTES`, with an
`over-wake-cap` warning past 6,144). A page between 6,078 and 6,144 was accepted with no
warning and printed cut.

- **The host ceilings.** Claude Code: `injectionBudgetBytes` in the configuration, 9,000
  unless `install --budget` said otherwise (the interactive install's default). Claude
  Desktop: the same number — its server reads the same configuration, and its `wake` tool
  delivers the same published bundle (one per store, composed at the boundary); its own
  channel is a tool result (`fit/TOOL_RESULT_CEILING`, ~50,000 characters), which does not
  bind. A configured override: any positive number `loadConfig` reads (`install` takes a
  whole one), so the smallest allowed is 1.
- **One number for both ends, derived.** `briefing.ts#PAGE_LIMIT_BYTES =
  pageRoomBytes(PAGE_HOST_BUDGET_BYTES)` — 9,000 less `deliveryReserveBound` (the preface
  and `DELIVERY_SHARED_RESERVES` = 2 terms at the share rule's widest) less the furniture:
  **6,078**. `PAGE_MAX_BYTES` defaults to it; `PAGE_WAKE_BYTES` and the warning are gone.
  The CLI's install default reads `PAGE_HOST_BUDGET_BYTES`, so the ceiling the limit is
  sized against and the one install writes cannot drift. It is no ceiling anything
  composes against: §2.18 holds. `pageRoomBytes` grows with the ceiling, so every ceiling
  at or above 9,000 holds a page at the limit whole; raising `injectionBudgetBytes` does
  not raise the limit, and only lowering it can make a page meet the line.
- **The wake: whole, or one line.** `Self#pageBlock` prints the page as it is when it fits
  `budget − PAGE_FLOOR_RESERVE_BYTES`, and otherwise `pageTooLargeLine` — its bytes, and
  both doors (the `self_page` tool, `counterparts self-page`) — or nothing, when even the
  line does not fit. The cut (`page.ts#renderPage`, its boundary rule, the marker,
  `PAGE_MIN_RENDER_BYTES`) is gone; `truncationMarker` stays only so the dashboard can
  still read an old bundle. Only a ceiling configured below what the page needs, or a page
  written before the limit, meets the line; doctor's Self page line goes amber for the
  second and says the next revision has to come in under the limit.
- **The writer: told before, refused after, never cut.** `revisePage` refuses past the
  limit (`too-large`, with `limit`), and measures AGAIN after the gate redacts:
  `password=hunter2x` becomes `password=[REDACTED:assigned-credential]`, 22 bytes longer,
  so a page at the limit could otherwise be stored over it. The limit is said before
  writing — in `PAGE_WRITING_RULE` (the nightly writer and the reflection both read it),
  the `self_page` tool's `body` field, and the writer's block ("N bytes of at most
  6,078") — and in the refusal: the MCP answer carries `limit` and `over`, the console
  names the limit and how many bytes to take out, and a reflection's refusal says the
  same. The writer tightens and sends the whole page again; nothing shortens it for him.
- **Proved through the real paths** (`test/page-never-cut.test.ts`, Denver and
  Kiritimati): a handoff block and a work block each tuned to exactly ⌊9,000/8⌋ − 48 =
  1,077 bytes, so each reserves 1,125 and the boundary's own `self.briefing` row reads a
  budget of 6,590; then a page of exactly 6,078 bytes, ASCII and multi-byte, delivered
  whole by Claude Code's SessionStart and by Desktop's `wake`. With the bound changed to
  one shared reserve the same tests fail. A ceiling of 6,000 gets the line and none of
  the page.
- **The owner's page** is 5,904 bytes (version 17): 174 bytes of headroom. The nightly
  writer and the reflection now meet the limit in what they read before they write.
- **Seen beside it** (fixed in the review, below). In #350's own morning scenario (25 open
  items, two Arriving lines, four Yesterday titles, this directory's handoffs and work), a
  page of 5,904 bytes left "Still open" with one item and no room for its "N more" line:
  the trim loop kept the item itself, and `keepFirstOpen` acted only when the trim left
  the lane empty. The lane read as if one thing were open.

### The review of #358 (2026-10-09)

- **The line was too blunt for a page a little over.** Measured through the real paths
  (`runOnce`, then SessionStart), Denver and Kiritimati: with #350's morning reserves
  (compose budget near 7.2 KB) pages of 6,100–6,300 printed whole on #358 as on master;
  under the widest reserves (6,590) #358 replaced every page from 6,100 up with the line
  — where master had printed 6,079–6,144 whole on most days. Now `Self#build` asks
  `pageBlock` a second time with the "Work here" reserve (`lendBytes`) added before it
  settles for the line, and composes into what the page took (`page + 512 − budget`, at
  most the lend; the rest of the lend is still "Still open"'s). At 9,000 that reaches
  9,000 − 160 − 1,125 − 512 = 7,203 under the widest handoff reserve: 6,100, 6,144,
  6,300 and 7,000 print whole there now, the delivered wake under 9,000 with its handoff;
  7,300 gets the line. The handoff is chosen before "Work here" at delivery and never
  gives way to it. Doctor stays amber for any page over the write limit, which does not
  move (`page-never-cut.test.ts`). The trade, said: at 7,000 under the widest reserves
  the page prints whole beside one Arriving line and its count, and "Still open" carries
  nothing at all — not even its collapsed line, which Arriving's "N more" took the room
  for — where #358 had printed the pointer and five open items. Page over lanes is the
  rule (#350's review); the page is past the limit and doctor is amber until it is
  tightened.
- **Not done: the Yesterday line stepping down beside the page.** Tried — the floor
  check offered `yesterdayShorter` before dropping the line — and measured worse: the
  Yesterday line is furniture, so a shorter one that fit the floor pushed out Arriving
  and "Still open" whole (widest reserves, 5,904: both Arriving lines and the open item
  lost to a shorter Yesterday line). Left as it was: dropped when the full line does
  not fit the floor.
- **The count beside what the trim kept.** `keepFirstOpen` now also pays for the lane's
  "N more" line when the trim kept items but left no room for it — out of "Work here"
  alone. Dropping the lane's own later items for the count was tried first and broke
  "a smaller budget yields a SUBSET" (`self.test.ts`): the identity share grows with the
  budget, so a larger budget kept fewer open items than a smaller one. Arriving and
  Yesterday give nothing for a count, since the trim order ranks Arriving above "Still
  open"'s later items. The 5,904 morning now reads one item and "(24 more still open; …)".
- **A refusal for length is not "nothing to say".** Traced through the nightly run's
  doors: `self_page` refuses 6,200 bytes with `limit`, `over` and plain words, nothing is
  stored (the version stands), and the claim stays open — the run is an agent reading
  the refusal, so it can tighten and send the page again in the same run, and the writer
  phase's `how` and the launch prompt now say to. But a run that moved on to its dream
  without doing so had its claim closed by `closeNightWriter` as `nothing-to-say`, which
  `pageWriterStatus` reads as settled: doctor green, the dashboard "read the day and kept
  it as is", over a page that was never written. The refusal row now carries its numbers
  (`writer.ts#pageTooLargeDetail`), and the close records `failed` with them and "not
  sent again before the run moved on to the dream" — doctor amber, the dashboard says
  how far over and that tonight's run tries again. The reflection already said the
  numbers and took a second `finish` with the page alone; both are proved
  (`nightly-run.test.ts`). The next night's writer is told the limit before it writes, in
  the rule and beside the page's own bytes; it is not told about the night before.

## 2026-10-10 — the page's ladder: stored separate from shown

#358's refusal was a stopgap, and the page's history showed why: the nightly writer
wrote 7,012 and later 6,767 bytes, sessions hand-trimmed to 6,067, 6,340 and 6,066, and
this morning's reflection wrote 6,085. The limit kept winning by a few hundred bytes and
somebody trimmed by hand each time. The owner wanted it durable and graceful; the shape
below is the one he agreed, the details are working defaults.

- **Stored separate from shown.** The writer keeps any page up to the 16,384-byte ceiling
  (`PAGE_MAX_BYTES`, as before #358). The room is a TARGET (`PAGE_ROOM_BYTES`), told
  before writing — "aim under N; past it, sessions read a short version instead" — never
  a refusal. Kept from #358: the ceiling refusal, the re-measure after redaction, the
  numbers on a refusal, and a refused night closing `failed`, never `nothing-to-say` (all
  still true of the ceiling). Gone: the length refusal at the room and its
  tighten-and-resend instructions (the writer's `how`, the launch prompt, the
  reflection's refusal); in their place, the ask for a short version.
- **The ladder** (`Self#pageBlock`, `briefing.ts#PageRung`), first that fits, every rung
  whole text: the page; the short version written with this exact text; each `##`
  section's heading and first whole sentence; the headings alone; one line; nothing.
  Each rung borrows the "Work here" lend before stepping down (#358's borrowing, kept,
  generalised). **Rungs are offered in order, not by size**: a short version smaller
  than the outline is preferred whenever it fits, and when it does not, the outline does
  not either, so the wake goes to the headings — tested at each exact edge
  (`page-ladder.test.ts`).
- **The mechanical rung** (`page.ts#pageOutline`, `firstSentence`): level-two sections,
  or the highest level a page has; the first paragraph (or a list's first entry) up to a
  full stop, question or exclamation mark followed by a space, skipping "e.g.", "v0.3.14"
  and single initials; with none, the first line; past 480 bytes, the heading alone.
  Mechanical on purpose — no model, no summary — and only the page's own words.
- **The short version** lives on the page row's prose meta (`PAGE_META_SHORT`: body, the
  hash of the text it condenses, that text's bytes). **No schema bump.** Every archived
  version keeps the meta it had, so the history carries each version's short version and
  `--restore` brings it back. Tied by HASH, not by version number: the version a revise
  produces is only known inside its transaction, and the hash says exactly what the
  brief asks — this short version condenses this text. Two guards, so a future path that
  forgets one is still safe: a write without one nulls it (`revise` merges meta), and a
  reader takes it only when the hash matches. It crosses the page's gates in the page's
  order (datelines out, no wake markers, the credential battery, measured after the
  redaction) and is kept only beside a page past its room and only within it. One that
  is not kept never costs the page. **Added on its own** (`addPageShort`: the tool's
  `short` alone, the console's `--short` alone, the reflection's `page.short` on a second
  `finish`) it is an ordinary revision of the same text — a new version, so the history
  says it — refused with nothing written when it would change nothing.
- **Top and end lines on every rung but the last** (`pageTopLine`, `pageEndLine`): what is
  below and the page's size, the exact end line, "if you don't see that line, it was cut
  off", and both doors. The last rung's one line is its own top line and has no end. The
  end line prints after the dateline. `readPageTopLine` reads any rung back (the
  dashboard's wake costs), and a test round-trips every rung.
- **The bytes, honestly** — one derived number for writer and wake, as #358 put it:
  `PAGE_ROOM_BYTES = 9,000 − deliveryReserveBound (293 + 1,125 + 1,125) − 512 −
  PAGE_FRAME_RESERVE_BYTES (264) = 5,681`. The frame reserve is the short rung's top and
  end lines at a seven-character size (261, measured); the preface grew by the whole-wake
  sentence (133), which `deliveryReserveBound` carries. **The owner's page (5,904, v17)
  is now 223 bytes past the room.** It still prints whole on every day — at 9,000 under
  the widest reserves a page borrows its way to about 6,880 — and the writer is now asked
  for a short version with it. Proved through the real paths at the history's own sizes
  (`page-never-cut.test.ts`): 5,904, 6,085 and 6,767 borrow and print whole, doctor
  green; 7,012 shows its short version when it has one, its outline when not.
- **The host, measured** (Claude Code 2.1.296, 2026-10-10; `adapters/config.ts`): a hook
  field over 10,000 CHARACTERS is saved to a file, and the model sees a "too large, saved
  to <path>" line and the first ≤ 2,000 characters cut back to a line end — nothing tells
  it to read the file. The cap is per field and per hook. So the whole wake's own way
  back sits in the preface (`WAKE_WHOLE_SENTENCE`): read that file, it runs to
  `counterparts:wake/end`. The page's top line is the second layer. A test simulates the
  cut at those numbers on a 16,000-byte ceiling (`page-ladder.test.ts`).
- **No door reads a session's composed wake** (checked: `rebrief` prints numbers; the MCP
  `wake` tool is Desktop's and starts a session; the dashboard reads the stored bundle).
  Not built; filed, INTERFACE-GAPS §13.
- **Doctor's Self page line** reads the rung off the newest durable `self.briefing` row
  (`page: { rung, bytes, whole }`, new on that row): green for the page whole or its short
  version; amber for the outline, the headings, one line or nothing, with what to do — a
  short version or a tighter page when the page is past its room; the ceiling
  (`injectionBudgetBytes`) when it is not.
- **What the room cost elsewhere.** The preface is 133 bytes longer in every wake, so
  every composition has 133 bytes less for its lanes. Two fixtures moved with it
  (`continuity.test.ts` 2,600 → 2,650, where whole elements left slack that happened to
  hold a "Last here" line; `claude-code.test.ts`'s cramped ceiling 400 → 700, since the
  preface alone is now 260).

**Review of #363 (2026-10-10), three holes closed** (`page-ladder-review.test.ts`):

- **A reflection's short version crosses the reflection's own gates** — the dream's mark
  and a confidential memory's words (`Reflections#shortRefusal`) — not only the page's
  battery: it is read by every session the page would have been. Beside the page, one that
  fails is not sent and the page is written with a note; alone, it is refused, and the
  page-writer-off switch refuses it too.
- **A short version added on its own is held to the version it read** (`addPageShort`
  passes `ifVersion: page.version` when the caller passed none): without it, a page
  another process wrote between the read and the write was reverted to the old text.
- **The wake's own frame is never stored as the page** (`briefing.ts#isPageFrameLine`,
  `Self#ownWords`): a rung's top line, end line or the one line, copied out of a wake and
  written back, is left out like a dateline — at write (counted as `frameLines` on the
  revision row) and at render — so no wake prints a stale size or an end line in the
  middle of the page, after which a cut would look whole.

## 2026-10-10 — dated items before the furniture: one list of who gives way (`ROOM_ORDER`)

The owner's wake on lived day 19 (in `~/random`) was 8,922 bytes and read "Arriving: 1 —
no room to list them in this wake". The item left out was his tax reminder (remind on the
12th unless paid, due the 15th), while the same wake printed yesterday's chapter titles and
four handoffs. Why: the handoff pointer and "Last here" are spliced at delivery into a
reserve the composition subtracts before any lane competes, so no lane could ever take that
room; and the Yesterday line is furniture the trim cannot pop. The trim loop pops Arriving
right after "Still open", and nothing below it was poppable.

- **One declared list** (`briefing.ts#ROOM_ORDER`), first to give way to last: `hints`,
  `craft`, `threads` (the trim loop's), `work`, `openCount`, `yesterday`, `lastHere`,
  `handoffs`, `arriving`, `openFirst`, `arrivingFirst`, `pageBorrow`, `due`, `page`. Each
  lane takes room only from the lanes below it, lowest first, and only what it needs
  (`takeRoom`, which walks the list). The old special cases are entries in it: #350's
  "Still open keeps its first item before Arriving keeps its second line" is `arriving <
  openFirst < arrivingFirst`, and #358's "the count beside kept items comes out of Work
  here and nothing else" is `openCount` just above `work`.
- **The handoffs' room is lent** (`BriefingRequest.handoffLendBytes`, the root's
  `handoffReserveBytes`, split out of `wakeReserveBytes`): after "Work here" and after the
  Yesterday line has given every title to its id. The delivery is unchanged: it already
  drops "Last here" first and steps the handoff ladder down (fewer in full, the rest by
  id), and "Work here" goes in what is left — so the order at delivery is the list's order.
- **The rescues run highest first** after the trim fits: Arriving's head (`arrivingHead`:
  its due-day plain reminders, or its first line), then "Still open"'s first item and
  count, then the rest of Arriving. Each lists as many as fit, with the lane's count
  pinned (an item under a heading with no count reads as the only one), or without the
  count when only the items fit.
- **Where dated items sit against the page's borrowing — decided:** an ordinary Arriving
  line ranks BELOW the page borrowing "Work here" (the page is the self; the line is
  still a memory recall finds), and a plain reminder due the day the wake is read ranks
  ABOVE it: the person asked to be told, and the page has its own ladder now. So in
  `Self#build`, when a due item is unlisted and the page borrowed, the page steps down its
  ladder until the reminder is listed — never below the first rung that borrows nothing;
  the page within its own room outranks it, and when even that does not list it the wake
  stays as composed and doctor says so. The page still takes room from "Work here" only:
  ranking it high in the list does not let it empty the Yesterday line or the handoffs.
- **"Due the day the wake is read"** (`prospective/#plainDueOn`): plain, dated the day the
  wake is composed for or the next. The evening boundary's wake is read the next morning,
  and once the reminder is told on its day it leaves the lane (`toldForGood`), so a rule of
  "today" alone would almost never fire when it matters. `prospective#horizon` puts these
  first before its `HORIZON_ITEMS` cut, and `Self#build` puts them first in the lane.
- **The Yesterday line keeps its ids.** Its shorter forms now give a title at a time to the
  chapter's id, down to ids alone (`handoff/last-here.ts#yesterdayShorter`): pointers
  instead of titles, every chapter still named. And at the floor it takes its widest form
  that fits within the budget and what is left of "Work here" (it outranks it): beside a
  page that borrowed, a four-title line was dropped whole, ids and all, measured while
  building this.
- **Doctor.** The durable `self.briefing` row gains `trimmedLanes` (per lane, uncapped);
  the Wake line counts renders in its window that left a dated item unlisted — by that
  count, or a pre-existing row's trimmed list — adds a clause with the newest date, and is
  amber with what to do (a short version or a page under its room; the ceiling).
- **The count is unchanged, and no longer silent** (review of #367). `prospective`'s
  `HORIZON_ITEMS` (2, v1's calibration) still bounds the lane's lines; what it leaves out
  arrives as `BoundaryRequest.horizonMore` and joins the lane's overflow, so the "N more
  arriving" line names it by id. A last rescue (`keepArrivingCount`) pays for that count
  out of the lanes below `openFirst` — Arriving's lines past its head included — before a
  later line is listed in full without it.
- **The handoffs' room is lent only past the newest handoff** (review of #367): the root
  lends the reserve less every directory's smallest rung (its newest handoff alone, with
  the margin). Measured on the branch as built: ~280-byte reminders beside a 6,767-byte
  page and 25 open questions took the whole reserve, and all four handoffs went unshown
  while doctor stayed green. The delivery picks the widest rung that fits, so room the
  composition could not use usually comes back as three shown in full.
- **That kept room is lent to `due` alone** (second reader of #367, `ROOM_ORDER`'s
  `handoffsKept`, `handoffKeepBytes`). Kept from every lane, it made the newest handoff
  outrank a due-day plain reminder: one handoff (so nothing of its room was lent), no
  "Work here", a 7,300-7,450-byte page printed whole without borrowing, and the
  reminder's Arriving line was in no line of the wake while the handoff printed (doctor
  amber; the plain line itself still rode beside the wake). Now `takeRoom` reaches it last,
  and only for `due`; an ordinary dated line never does.
- **Not done: naming the other handoffs in the tightest case.** The ladder's last rung is
  the newest handoff's own block, which names none of the others. Keeping room for the
  narrowest rung that does name them (the newest in full, "+N older here: ids") costs
  about 158 bytes more with four handoffs, and the second dated item at the owner's
  6,767-byte page (`wake-dated-first.test.ts`'s sweep) went unlisted for it. Left as it is.
- **An arriving id the count could not name leaves a trim row** (second reader of #367).
  An id past the lane's cap was never a line the trim popped, so when the lane's count did
  not fit either (two due-day reminders heading the lane, nothing left to lend) it was in
  no line and no row, and doctor stayed green. `render` now records it as a popped line is
  (strength 0), and doctor's Wake line counts it.
- **The plain line itself never rode the wake.** It is said beside the wake — above its
  opening comment for the model, as a notice for the person — and claimed only once the
  envelope carries it; with no room it waits for the first prompt, where recall gives way
  to it. The part that rode the wake and could be crowded out was the same memory's
  Arriving line, which is now `due` in the list.

## 2026-10-10 — the ask asks for attention; the cap yields to a due stretch (Group 1c)

- **The Stop ask is 01 C1's, verbatim** (`claude-code/hooks.ts#stopAsk`): "hand back what
  caught your attention since you last wrote, one idea each — what you read, what they
  said, what happened". "Nothing worth keeping is a real answer" is gone (01 D4); `[]` is
  said on the `memories` field. 474 characters at the widest (pin 480).
- **`MAX_ASKS_PER_SESSION` yields to a due stretch** (01 C5, `episodes.ts#askDue`): at the
  cap, the third arm (`due-unwritten`) still asks; turns and bytes do not. Measured: 84
  cap refusals in 4 sessions, 35 while unwritten pieces existed. Decided by g1c-builder,
  2026-10-10, lightly held; revisit after ~5 lived days. Why: 01 offered this or a cap of
  20; this asks only when something is owed, and the arm paces itself (three pieces, half
  an hour since the later of the first of them and the last ask).

## 2026-10-10 — the wake assembled at session start, and "Today, elsewhere"

Mike's symptom: morning sessions in several directories repeated the same things and seemed
unaware of each other. The read-only investigation (`~/counterparts-notes/2026-10-10-wake-
staleness.md`) found the bundle is composed at a turn-end and read unchanged by every session
in every directory until the next one: a morning's first sessions read the evening's bundle,
whose Yesterday line named the day before yesterday, and a `note`'s open question or
reminder waited a day. Mike approved two options on 2026-10-10; details b2's and
random-f8's, lightly held.

- **What moved to session start** (`Self#assemble`, `Counterpart#assembleWake`): "Still
  open", "Arriving:", the Yesterday line and the page — every lane that is a plain read.
  **What stayed at the turn-end:** "Nearby" and the identity rotation, because showing them
  writes state (`recordHintDisplay`, the `self.rendered.<id>` stamps). The publish now keeps
  what it showed of identity, craft and Nearby, in order, and the room it composed in
  (`WAKE_SHOWN_KEY`); the assembly reads those ids back and drops one that has gone, become
  open, arriving or settled, or — a hint — is now covered by the page.
- **One composition, two callers.** `build` was split at the lanes: `composeLanes` (the
  page's ladder and borrowing, `render`, `ROOM_ORDER`, the page stepping down for a due-day
  reminder) is shared, so a session start keeps every room rule the published bundle keeps.
  The turn-end's horizon mapping moved into `core/briefing.ts#horizonFor` for the same
  reason.
- **The room is the turn-end's** (`budget`, `lend`, `handoffLend`, `handoffKeep`):
  recomputing it at delivery means every directory's handoffs, chapters and work lines —
  the span buffer for each — on the session's latency path. A session under another
  ceiling than the one recorded delivers the published bundle.
- **Still open from an index.** `Store#openThreadIds` (`meta LIKE '%"unresolved":true%'`, as
  `planCandidates` matches it) answered by the partial index `memories_open`. No bump of its own
  (Mike, 10-09: batch format changes): the index is in `DDL_AFTER_COLUMNS` and rides the v13
  upgrade, so a fresh store and an upgraded one have it; a store stamped v13 before it existed
  scans one column instead (1.7 ms at a synthetic 9,250). `memories_created` (the day's counts) and
  `memories_origin_ref` (the chapter walks' copies) the same way.
- **"Today, elsewhere"** (`handoff/last-here.ts#todayElsewhereLines`, composed by
  `Counterpart#elsewhereFor`): the other directories worked in today — the host's registry
  for when and live or ended (`WakeHere.sessions`, host state only), the store's counts
  (`Store#memoryCountsByScopeSince`, numbers only), and today's newest chapter there on the
  "About me, from another directory" line's gate (scope on, not confidential, a copy marked
  me, us or owner — never the one that line already names). Skipped: this directory, this
  session, the nightly run's directory (the store's own), any directory the scope setting
  keeps home — named not at all, not even by count. Never span text, a work memory's title
  or a handoff body. It first sat in `ROOM_ORDER` right after Nearby, and the test-build
  rehearsal (10-10) found it never printed at 9,000 beside the owner's ~5.9 KB page. Now
  (b2+f8, lightly held) every form is within `TODAY_ELSEWHERE_MAX_BYTES` (300; folders past
  it "+N more", last the count alone). #380 first ranked it above `pageBorrow` (the page
  chosen in the line's bytes less room, the line floor furniture); **the review of #380
  moved it down to between `handoffs` and `arriving`**, the lowest rank that printed it in
  both measured cases (9,000, a due-day plain reminder, four handoffs):
  - owner-like (~5.9 KB page, one other folder): above `openCount` is enough — the line
    took "Still open"'s count; below it, only "1 other directory." printed;
  - busier (6.5 KB page that borrows, "Work here" and a Yesterday line, two or three other
    folders): nothing below `handoffs` printed it, not even the count alone; from
    `handoffs` up it printed whole, and "Work here" lost its one line;
  - and at 6,767 bytes (an owner's page size from the history), above `pageBorrow` cost
    the page its whole rung for a 243-byte line (8,881 → 4,172 bytes, whole → outline
    with no short version); here the page stays whole and the line prints.
  So the line takes room from the trim loop's lanes, then — the trim loop asking
  `takeRoom` on its behalf before it would pop a lane above it — "Work here", the
  Yesterday line's titles and the handoffs' room, and only then steps down; "Still
  open"'s last item counts as its first (`openFirst`, with its count) there. The page and
  its borrowing give it nothing (`composeLanes` is as before #380); Arriving, "Still
  open"'s first item and a due-day reminder step it down in the rescues.
- **The preface says so:** "— assembled at session start" in place of "— composed at the
  last boundary" (fewer bytes, inside `PREFACE_RESERVE_BYTES`).
- **The record speaks for one bundle.** It is written in the same transaction as
  `BRIEFING_KEY` (`setMetaMany`) and carries the bundle's hash; a session start whose
  published bundle has another hash delivers it as published.
- **Cost, measured (synthetic, hermetic; bench in the PR):** SessionStart through the hook,
  200 registry records: 3.7 → 6.6 ms at 925 memories, 12.3 → 28.2 ms at 9,250 written in
  one day with 250 open questions and 44 dated. `Counterpart#wake` alone: 2.1 → 6.2 and
  9.5 → 30.6 ms.
  The terms are the open questions (≈5 ms of it at 250), the horizon (≈4.5 ms, the same
  read the per-turn cue path makes), the day's counts and the episode list (≈3 ms each,
  linear until the indexes exist). One chapter walk per delivery (`deliveryWalk`), shared
  by "Last here", the handoffs and "Today, elsewhere".
- **No worker kick at session start.** Nearby lags by one turn-end by design, and the
  wake-behind fix (every deposit marks the wake) makes turn-ends catch it up.
- **Named costs.** The dashboard and doctor show the published bundle, which is no longer
  byte for byte what a session got; a session start's trims leave no durable row (the
  turn-end's `self.briefing` row is still the day's record).

## 2026-10-15 — chapter summaries replace the full copies (P1, Mike)

The design check is in the owner's notes (2026-10-15, "journal storage ramifications" and
"dups and chapter copies"); what was built, and what it chose:

- **One summary memory per chapter, written once** (`summaries.ts`,
  `index.ts#summaryAtChapter`). The `chapter` tool takes `summary`; it goes through the
  same gate as the chapter. A second summary for a chapter that has one the session wrote
  is kept out (`kept`, said in the result). A chapter with no summary gets an AUTOMATIC one
  at the boundary (`ingestEpisode`, still the name of the door): the opening ~600
  characters of the chapter, cut at a sentence, its title on the row. A summary written
  later REPLACES an automatic one in place — `revise`, so the engine's words are its
  version and the row keeps its id, links and marks. "Written once" counts archived
  summaries too: a summary the prune or a merge took is not written again.
- **Shape:** the copy's (`source: episode`, `origin_ref`, `meta.episodeId`, kind `self`)
  plus `meta.chapter` (1-based, `chaptersOf`'s order — the `epi_…#N` number) and
  `meta.chapterSummary`. Title: the episode's, `— chapter N` after the first, so a
  session's summaries do not read as duplicates of one another. `happened_on`: the day the
  chapter's heading names (the dashboard reads a chapter memory's date from it, since the
  summary has no heading). `about`: its own chapter's (`meta.abouts`; the episode's latest only for an episode written before per-chapter marks — an unmarked chapter's summary is unmarked); an `about`
  given later in the same chapter updates that chapter's summary only (and a frozen copy).
- **Names:** the cards the CHAPTER names are credited to the summary and linked to it as
  subjects (`Counterpart#summaryNamed`), the 419 subject links the copies held being the
  thing that would otherwise thin. An append that continues a chapter credits its new
  words to the summary standing. A rewrite links without crediting again.
- **Fading (Mike's decision):** a summary is born with the default floor an authored
  self-kind memory gets (`defaultClaimFor`, 0.4, recorded `claimedDefault`) — at the copy's
  zero it would have been below reach on its first day — and decays, leaves reach and is
  pruned like one. Measured on the physics: unused, it stays in reach about three weeks
  and reaches the prune floor in about nine months. **The frozen full copies keep their
  exemption** (CONTRACT §3 says why: they are their chapters' only memory, they carry the
  marks and links, and at zero salience they would all leave in one wave).
- **No regrowth.** `findIngested`, `memoriesForEpisode`, the regrow window and
  `copyAbout` are gone; the 101 live copies stay frozen; a chapter a copy covers gets no
  summary (`chaptersCoveredByCopies`: the most chapters any copy of the episode held), a
  chapter written after it does. The 320 archived copies are untouched (the next batch).
- **Appends keep no version** (`store#appendBody`). `appendChapter` now keeps the stored
  body whole and adds the blank line it needs, instead of `trimEnd()`-ing it, so the
  prefix guarantee holds byte for byte.
- **The page writer reads the day's chapters** (`dream/slices.ts#dayJournal`, composed by
  `Counterpart#pageWriterInput`): a room of its own (`WRITER_JOURNAL_CHARS` 14,000, at most
  35% of the block's budget) taken out of the same 40 KB, a line for every chapter of the
  day across sessions — its summary when the session wrote one — and the most important
  whole. The journal's own memories (summaries, copies) are no longer listed among the
  day's memories. Measured on a copy of the owner's store: on the busiest day (10-11, 51
  chapters, 75k characters) the writer had kept 75 memories and **none** of the day's 3
  copies (strength 0 lost every time) — it never saw the journal; now it sees 43 of the
  51 chapters as lines and 49 memories in the rest. On 10-12 (34 chapters): all 34, two
  whole. On 09-27 (13): all, seven whole.
- **Doctor:** `Chapter summaries` — written vs automatic over the week, green, silent with
  none.
- **Not done, said:** the dashboard still lists a summary as "journal" (unscored, no
  curve on its card) as it did the copy, though it now fades; the wake's "about me from
  another directory" reads the mark off the live copies and summaries only, so a summary
  pruned months later takes its chapter's mark with it (the window that reads it is a
  fortnight).
- **Review of #504, what changed:** (1) a chapter's use credited every summary its
  episode held — 51 at once on a long session, which undid the fading; now only the
  summaries recall folded into the chapter shown, carrying at least half the pair's match
  (recall NOTES). (2) Each chapter keeps its own `about` (`meta.abouts`), so an automatic
  summary takes its chapter's mark, not the episode's latest; the wake's "about me" test
  is now "any chapter", said in CONTRACT §3. (4) Written-once across processes:
  `settleSummaries` after every write, `summary-duplicate` for the loser. (5) CONTRACT
  G10 says what the code does (no second AUTOMATIC summary; a session's later one is
  written). (6) The writer's "nothing besides the journal" line names confidential
  rows held back; the journal's cost counts each line's framing. `self.episode.reconciled`'s
  `ingested` counts summaries written now, not episodes.
- **Second review (of e6920860):** the half-share bar for fold credit was judged inside
  the fold loop, against the match merged SO FAR, so a weak summary folded before a
  strong sibling passed; it is now judged after every fold, against the pair's final
  match (`recall/activate.ts#foldCredited`, pure, tested weak-first). An unmarked
  chapter's summary is now unmarked: the episode's latest mark is lent only to an
  episode from before per-chapter marks (no `abouts`). The page writer's journal cost is
  measured as the block renders it (`writer.ts#journalBlockChars`), framing and excerpt
  notes included. When a boundary loses a duplicate race its summary is archived
  without name credit; the summary that stands was credited by its own write.

## 2026-10-16 — a long list item is a line (#489 C)

Lightly held, Mike's call of 2026-10-16 ("we'll see how it looks tomorrow").

- **Why.** Measured 2026-10-15 on the owner's morning wake (9,116 bytes against 9,000): the
  page took 4,840, and every listed memory was printed as its whole first paragraph — 350 to
  1,100 bytes each, median about 550. About 2,200 bytes were left for every lane together,
  so craft listed 0 of 3, hints 0 of 8, "Still open" 1 of 60. The trim was working; each
  item cost too much. The design pass is on #489.
- **What.** `resolveStatement` offers a `line` (title, else `fit/lineOf`) for a statement
  longer than `WAKE_LINE_BYTES` (240) when the line and id are shorter than it;
  `briefing.ts#asLine` prints it as `date · line [id]` in every lane but identity, never for
  a due-day plain reminder (`Ranked.due`) or an upgraded item (`Ranked.whole`). Deciding it
  in `elementLine` keeps every rescue, the share and the fold on one byte count. The id is
  not repeated when a standing prefix already names it (the "Core, being reconsidered"
  line, which the prototype printed with two).
- **The upgrade.** After the rescues, `render` tries the first item of "Still open", then
  of "Coming up", whole; it keeps the change only when `tellLost` says the same counts and
  the composition stays under the same limit. Not gated on "nothing trimmed" as identity's
  leftover is: a lane that lost items keeps its count either way.
- **Numbers.** On the 2026-10-15 store copy the prototype went from 3 to 14 lane elements
  at 9,000 with the page whole; the lanes cost 2,130 bytes (78–210 per item). The hermetic
  production-scale test (`test/wake-lines.test.ts`: page at its 5,681-byte room, 3 craft,
  25 open, 8 warm, 2 dated, ~550-byte titled items) goes from 4 to 18 lane elements, 8,569
  bytes, 16 of them lines.
- **Measuring it.** `fit.index.wake` holds the ids the newest session start listed as
  lines (`Lifecycle#noteWakeIndex`; the core wake still writes nothing), and the
  `adapter.wake.injected` row carries `lined`. Doctor's Lookups line adds "wake: N looked
  up of M offered in part, over K session starts". Near zero after a week means the titles
  are too thin or the lines read as truncation — revisit then.
- **Tests that pinned whole-text scarcity** (a lane with no room for one line, the share
  against craft that could not fill the rest, a page that needs "Last said here"'s room)
  now run with `WAKE_LINE_BYTES: Infinity`, so they still test what they were written for.

## 2026-10-16 — the wake trims (Mike, lightly held, review 2026-10-18)

- **What.** One tag line at the top (`store-id.ts#wakeTagLead`, the head tag without `day=`);
  today's date on the `Now:` line only (`SHORT_PREFACE`, `YESTERDAY_UNDATED_AT_START`,
  `PAGE_DATELINE_TODAY`, short item dates `SHORT_DATES`); a shorter header and framing line;
  the page's target 4,600 (`PAGE_ROOM_BYTES`, under the 5,750 room) with "## How I work" as
  short general lessons (`HOW_I_WORK_RULE`); craft out of the wake (`CRAFT_IN_WAKE`);
  "Coming up" = today (`COMING_UP_TODAY_ONLY`). Each change and its revert is in
  `docs/decisions.d/wake-trims-1016.md`.
- **The markers kept their text.** The plugin's sidebar draws beside a newer npm install's
  hooks and reads each marker by its own pattern, so a merged tag would have cost an older
  sidebar the first meeting's state and the store check. They share a line instead.
- **Where the date comes from.** A short date needs the year it is short in; it is the
  composition's date (`BoundaryRequest.at`, threaded from `selfRenderer` and
  `Counterpart#assembleWake`), else the store's today. A test that passes an explicit 2026
  date stays right in 2027. `arrivingTense` reads a short date as the day nearest today
  (`time.ts#dayOfShort`).
- **Later dates are in no other lane.** Moving them out of the horizon lane first let them
  fall into "Might be relevant" (a test caught it: `rankLanes` keeps only the horizon's own
  ids out). `Lanes.later` keeps them out of every lane, as an arriving item is. The 10-12
  morning test had been getting its "Nearby" from exactly that duplication: dated items past
  prospective's count listed there too.
- **The published bundle's preface is 32 bytes longer** than the assembled one's ("(composed
  at the last boundary)", `PUBLISHED_WORDS`); tests that compare a wake at one ceiling with a
  wake at another add it.
- **Numbers.** A copy of the owner's store at 9,000: 3 items before, 4 after with the
  5,525-byte page, 9 with a page at 4,600. `test/wake-trims.test.ts` at production scale: 5 → 14.

## 2026-10-18 — "Still open" leads with what is live (the wake-polish builder, lightly held)

random-6c's 10-17 wake led "Still open" with two three-week-old questions and counted 57
more. The order was person-scoped first, then OLDEST-opened first (behavioral-spec §1 G4:
long-held relational debts trim last). It is now `identity.ts#byThreadLive`: untouched for
`STILL_OPEN_STALE_DAYS` (14) lived days after every one touched since — "touched" is
`max(born, lastUsedDay)`, as #489 D's `staleOpen` reads it (its threshold is 4 lived days,
not 14, so the two don't count the same set); then plain before "Unsettled — may be out of date" (`recall/standing.ts#
unsettledAmong`, one read of the open candidates' pairs per render); then person-scoped
first, which keeps G4 among peers; then the most recently touched. The core memories being
reconsidered still lead (`RECONSIDERING_MAX`, not aged: they wait on a decision), but one
that is also unsettled takes its turn after the plain ones — its unsettled prefix replaces
the "keep or retire it" words. The count line says how many of what it counts are old:
`(57 more still open, 12 untouched for 2+ weeks; recall ids …)` (`STALE_OPEN_WORDS`, read
back by `countedLanes`). The room is unchanged; only the order and the count's words.

Measured on the 10-18 snapshot copy (observer): shown before `mem_eef7749259b8` (core,
unsettled) and `mem_108281079c41` (born lived day 10); after, `mem_18628b85d486` (core, the
plain one in turn) and `mem_9d9af2754e64` (born day 25). Undo: `git revert` of the PR
(nothing is stored differently).

## 2026-10-20 — one tag in the head, and every "Coming up" item's own id (Mike's go, lightly held)

- **`withHeadFields`** (`briefing-delivery.ts`): the host's `meet=` / `store=` fields go into
  the opening comment after `counterparts:wake ` and both byte counts are re-solved, the
  mechanism `spliceBeforeSentinel` uses. `Counterpart#wake` applies it (`WakeHere.headFields`)
  after the furniture splice, and only when the result still fits the ceiling (applied
  unconditionally there, it pushed full wakes 4–29 bytes past 9,000 in the room tests). The
  builder first put it BEFORE the splice so the pointer's room check counted the ~43 bytes;
  the review of #536 measured that taking "Last here" on 8 of 61 ceilings from 8,700 to 9,300
  in a full fixture — and since the Yesterday line leaves that line's episode to it, the
  episode was then in no line. The fields are cosmetic, the line is not, so they go last.
  When there is no room for them, the head is left as it was (`tagged` false) and the host
  carries the fields in a tag of its own. Every head reader matches the prefix and `elements=… bytes=…`, so the
  fields read like the `day=` that sat there until 10-16.
- **`HORIZON_OWN_ID`** (`briefing.ts#elementLine`): a "Coming up" item printed whole also
  ends with `[its id]`, before the standing's suffix ("(earlier: [mem_…])"). A line-form
  item already carried it (`lineText`). Counted by `elementBytes`, so the lane's room is
  honest; no other lane changes.

## 2026-10-20 — "Today, elsewhere" names a folder's work by title (Mike's go, lightly held, an experiment)

- No change in `self/`: the line arrives as before (`BriefingRequest.elsewhere` and its
  shorter forms) and steps down by the same `ROOM_ORDER` rank. What changed is what the
  forms hold (`handoff/last-here.ts`, handoff NOTES §16): up to two memory titles a folder,
  given up first, inside the same 300 bytes, so the room the line can take from the lanes
  above it is what it was. `self/work.ts#isWorkMemory` is now also read by
  `Counterpart#elsewhereTitles`, so "work" means one thing in "Work here" and in the
  elsewhere line. A memory "Still open" may list is left to that lane (the store's
  `openThreadIds`, read once at assembly; since the review of #543 the title read leaves out
  every open thread itself, so the per-prompt line names none either). The same day the line gained "Here, also open:",
  this folder's other live sessions with their work, and "Work here" (composed at delivery
  in `counterpart.ts`) leaves a memory that clause printed to it. Decision:
  `docs/decisions.d/feat-elsewhere-titles-1020.md`.

## 2026-10-20 — a core question that waited a week leads "Still open" (an experiment)

Mike's go 2026-10-20, lightly held, with the reflection's half (`dream/NOTES.md`, same
date). On his store three core memories flagged on 10-13 still waited on 10-20; two were
also unsettled, and since 10-18 an unsettled one took its turn only after every plain one,
so with `RECONSIDERING_MAX` 1 they never led — and when one did, its "Unsettled — may be out
of date" prefix replaced the "keep or retire it" words.

- `rankLanes` takes `waiting` (`identity.ts#waitingIds`: flagged
  `sleep/tunables.ts#CORE_WAITING_DAYS`, 7, lived days ago or more, read off
  `coreReconsidering`'s flag day, which consolidation does not rewrite while the cause
  stands). The waiting ones rotate first, then the rest, each ONE rotation over plain and
  unsettled alike (#430's ask). Passed at both `rankLanes` sites (the turn-end render and
  the assembled wake). `wake-polish.test.ts`'s "unsettled after the plain" test is
  rewritten to the new rule, not dropped.
- `resolveStatement`: a reconsidered core memory's prefix is
  `Core, being reconsidered — keep or retire it (remember core) [id]` and, when it has a
  standing, `; ` and that standing's prefix after it (its suffix kept). The id stays inside
  the prefix so `briefing.ts#asLine` still prints it once.
- Nothing changes on a store with no waiting ones except the one rotation: a fresh
  unsettled one can now lead on its day. Undo: `git revert` (nothing is stored differently
  by the wake).

## 2026-10-20 — the nightly writers held to the room; past it, the short version first (Mike's go, lightly held, an experiment)

- **What was happening.** The room (4,600, the wake trims) was a target, and a page past it
  was kept and printed whole whenever it fit. At 9,000 the whole page fits up to ~5,750, so
  the short version kept beside a 4,756 or 4,956 page was never read; the extra bytes came
  out of the lanes (10-20: 4 sections down to 3). Three of four nights overshot (4,928 on
  10-17; 4,756 then 4,956 on 10-20, the reflection rewriting after the writer).
- **Chosen: refuse once, keep the resend, keep a held page at the run's end.** In
  `Self#revisePage`, after the ceiling, the version check and the gate: from `writer` or
  `reflection` (`PAGE_HELD_DOORS`), a page past the room is refused `past-room` each
  door's first time in a night for that session (`heldTonight` reads the refusal rows by
  `date`, `by` and `session`). Per door, not per night: keyed per night, the writer's hold
  on 10-20's pattern (the writer overshot first) would have let the reflection's 4,956 in
  on its first send. The refusal row carries the gate's text, its short version, reason and model
  (`held`), and `at`, the version it was held against. That door's second send past the room is kept
  as before (with the short version asked for). `keepHeldPage` writes the newest held page
  when the page still stands at `at` — called by `runNight` at the child's return, before
  the wake catches up — and records a writer's night `revised` after the `failed` its close
  wrote. Why not "keep the long page and require a short version": that lets the stored page
  keep growing, which is the thing Mike asked to stop. Why not a plain refusal: #358's
  (10-09) was exactly that, and a writer that moved on lost the night; here the resend always
  lands and the run's end is the backstop.
- **The wake** (`pageBlock`, `PAGE_SHORT_PAST_ROOM`): a page past the room with a short
  version skips the whole rung. That makes the short version mean "what the wake shows past
  the target", not only "on a day it has no room". No short version: whole when it fits, as
  before, so no store's wake drops to the outline overnight. Borrowing ("Work here"'s lend)
  is unchanged; with the writers held, the normal case is a page within its room that prints
  whole and borrows nothing (`test/page-held-to-room.test.ts` §4).
- **Not held**: a session's `self_page` and the owner's console. The 1,150 bytes between the
  target and the room stay theirs; that asymmetry is part of the experiment.
- **Unsure**: a held page kept at the run's end is past the room by construction, so on
  that night the wake shows its short version if it had one, else the page whole as before.
- **Review of #541 (same day).** Four fixes, each with a test in
  `test/page-held-to-room.test.ts` §5:
  - The night is the last 12 hours by the wall clock (`PAGE_HELD_NIGHT_MS`), not the
    calendar date. Keyed on the date, a run crossing midnight held a door twice, and the
    run's end (which read today's date) missed a hold made before midnight. `runNight`
    passes its own start.
  - No run end. Only `runNight` called `keepHeldPage`, but a night launched from a session
    (the dream tool's `launch`, under the default `ask`) or a run killed after the hold never
    reaches it, so #358's lost night came back there. The worker now keeps a held page at a
    boundary once the hold is 30 minutes old (`PAGE_HELD_SETTLE_MS`), with the same version
    guard, looking back 48 hours (`PAGE_HELD_KEEP_MS`: the next boundary after an evening launch may be the next morning). A writer still cutting is left alone; one cutting
    past 30 minutes gets `version-moved` and the kept page handed back.
  - The short version sent with a held page was stored raw on the refusal row. The page body
    was the gate's text, but the short version was not, so a credential in it sat in the event
    log for its 90-day retention. It now goes through the short version's own gates first,
    and only what they keep is stored.
  - The hold was looked for among the 50 newest refusal rows of every kind, so a run of other
    refusals could push it out. Now the scan reads up to 1,000 rows, bounded by lived day.
  - Checked and left alone: `counterparts delete activity-log` removes `sessions/log/` files
    and not the events table, so a held page survives until it is kept. Retention is 90 lived
    days. The database export copies the row, as it copies every page version. The dashboard
    narrates the refusal without its body. A short version that is stale against its page is
    null (`shortOf` checks the hash), so it is never shown first.

## 2026-10-20 — two cheap self measures, and the page in layers (wave 1 lane 2, an experiment)

- **Why.** Nothing measured the self, so wave 2 (beliefs) could only be compared with
  today's page by taste. These are readings only: nothing promotes, demotes or rewrites on them.
- **Cites per claim.** The reflection's page rewrite carried one `page.cites` list. It now
  also takes `page.claims: [{ text, cites }]`, each passage quoted from the page, and its ids go
  through the same filters as the whole list (not shown, gone, dreamed, confidential). A claim
  is a sentence (`page.ts#pageClaims`; headings and fenced code are not claims). The trace is
  stored on the page row's meta (`PAGE_META_TRACE`: `{ of, cites, claims: [{ of, cites }] }`),
  with sentence keys, not words, and tied to the text by hash like the short version. So no
  schema change was needed, and every archived version keeps its own trace. Matching runs
  against the text as stored, after the datelines and the gate. A passage names a sentence by
  its words (emphasis, quotes and spacing aside) or by an opening of 24+ characters. One that
  names nothing is counted and said in the finish note, never refused. The words the page
  says are never changed by any of this.
- **Carried, or not.** The same text written again (a short version added, a restore of
  identical words) keeps the trace; a restore brings back that version's own; a held page
  stores its trace as keys on the refusal row, and `keepHeldPage` writes it. Any other write
  without one sets it to null. A session's or the owner's page is untraced: there is no door
  for them to send one yet.
- **Doctor**: "Self page claims" (`self-page-trace`) and "Core" (`core-support`), both always
  green. A page from before traces reads "cites were not kept per claim", falling back to its
  reflection's record (entry and page ids together, so it overcounts), never "all hypotheses".
  Core support reads every live row and edge, so it stays out of the session-start reading.
- **Support columns.** Derivations are what an element was MADE FROM: the ids its meta names
  (`fit#derivedFrom`), because the v13 `derivations` table is still written by nothing, and
  the episode it was born from (`origin_ref`), each once. An episode is keyed by its own id,
  with a chapter's `#n` set aside. A ref like `dream:…`, `reflection:…` or a migration's is
  not a lived episode and is left out. Links are edges either way, as their own column. Days
  and contexts (`origin_scope`) span the element, its returns and what it was made from.
  Returns carry a session, not a scope, so they add days only. "One episode behind it" means
  all of that sits on one lived day.
- **Review of #550: links widen nothing.** The first build let linked memories' days and
  contexts into the span. With ~9,500 links on Mike's store, almost no element would have
  read "one episode behind it", which hides exactly the early-core problem (Katie's first
  5–10 memories made core) that this reading is meant to show. Before that fix the
  derivations column also read mostly 0, because a memory born from an episode records it in
  `origin_ref`, not in its meta. Links are still the weak column (the 10-22 co-use check says
  whether to keep them).
- **Layers** (dashboard, `pages/self/sections/layers.js`): a passage is a SECTION, followed
  by heading. The page is rewritten whole from memories, so a sentence seldom survives a night
  word for word. It shows how far back the kept versions reach and how many retention let go.
  It is only a view; keeping layers longer would be a retention choice. The page's hypotheses
  (sentences with no memory named) are listed under it there.
- **Review of #550.** A passage is read by the page's own rules (`pageClaims`), so one quoted
  with its list mark, quote mark or heading names its sentence; the ask and the tool say the
  24-character floor for an opening. A page cited only by passage, with every id refused, is
  sent back naming them. A clear lets the trace go, as it does the short version. In layers, a
  section that came or went has its own line and is not counted as "the same in every version".

## 2026-10-20 — personal news reaches other folders once marked (Mike's go, lightly held, an experiment)

Mike: non-work memories should flow across folders, work should mostly stay in its folder.
The wake's split already does that by the mark (`work.ts#isWorkMemory`: me, us, owner and
world are in Nearby everywhere; an unmarked fact, entity or place written in a directory is
"Work here" in that directory only). What was missing was the mark: sessions leave `about`
unset, and the reflection was offered five unmarked memories a night.

- **The field says why** (`mcp/tools.ts#ABOUT_PROPERTY`, used by `remember` and each
  `session_end` memory): mark anything personal owner or us, so it reaches every folder ("a
  friend visiting this weekend, how a long week left the owner"); work belongs to the folder
  it was written in, though sessions elsewhere may see its title (F4's "Today, elsewhere");
  left unmarked, a fact written here is this folder's work, so mark the personal ones. The
  chapter's `about` says the same of a session. Field descriptions are served whole (the
  2,048-character cut is the tool description's, `test/description-cut.test.ts`).
- **The reflection keeps up** (`dream/NOTES.md`, same day): 24 a night, the personal-looking
  first. No change to the wake or recall: a memory it marks owner or us is in another
  folder's Nearby by the rules that were there (`test/unmarked-offer-1020.test.ts`, the
  last test). Recall by question was never folder-gated.
- No change to F4's elsewhere line.

## 2026-10-21 — the writer holds nothing back by default

- `pageWriterInput`'s default `omit` is none (it was confidential-only), the day's journal
  no longer holds sessions back, and the writer's "held back as confidential" sentences
  are gone (a caller's own `omit` still counts what it held back, said as "held back").
  `workHere` no longer skips a marked row. The crash fallback's wake (`sweepWake`) still
  stands PROTECTED rows out and counts them.

## 2026-10-21 — projects, and craft that travels (wave 2 lane G, design §8; lightly held)

A memory knew its folder, not its project, and an unmarked skill counted as work, so craft
learned in one folder stayed there. One switch, `PROJECTS_TRAVEL` (on):

- **A folder belongs to a project** (`folder_projects`, store v14). With no row it is its own,
  and nothing is written to say so: the wake writes nothing (§5 G1), and a card per folder
  seen would be noise (the corpus copy has scratch-workspace folders). The project's card is
  made at the first join (`counterpart-projects.ts`): found by name — a live card that is not
  a person or me, marked `subject_kind` `project` — or born by mention, so the alias index
  holds its name. Joining by a folder names the project after that folder (`via: default`).
  The owner's door is `counterparts project join|leave|list`.
- **Travel by project** (`work.ts#projectFolders`): "Work here" reads every folder of the
  project, and the elsewhere gate (`counterpart.ts#elsewhereGate`) never names a folder of
  this one's project; its open sessions are "Here, also open". **This folder keeps half**:
  the project's other folders take at most half the ranked places unless this one has too
  little. Measured on a copy of the 10-20 corpus: joined, ~/counterparts-site ranked 0 of
  its own 8 beside ~/counterparts' newest; with the half rule, 3 of its own, 3 of
  ~/counterparts' and 2 craft.
- **Craft travels** (`isWorkMemory`'s `craftTravels`, `isCraft`): a skill not marked `work`
  is craft, in no stored lane and a work line in any folder. `WORK_HERE_CRAFT_MAX` (2) places
  of the pool are craft from outside the project, taking turns by lived day among the newest
  (by date alone it never ranked beside a busy project's work), from a folder the host lets
  be named elsewhere (`exportsFrom`; none when the host cannot be asked), or from no folder.
  A skill marked `work` stays with its project. Measured on the copy, 7 lived days of
  `workHere` + `rotateWork`: skills reaching another folder's wake 0 → 10 distinct (15 lines
  in 10 of 10 folders' wakes on day one).
- **Where the old rule stays**: the reflection's unmarked offer and its folder-off guard
  (`dream/reflect.ts`) still read an unmarked skill as work — the offer is how a skill gets
  pinned to its project with `work`, and a skill from a folder set off stays there; the
  elsewhere titles (`elsewhereTitles`, `hereSessions`) still name a folder's craft as what it
  did today. The `about` field's text now says work is one project's own and an unmarked
  skill reaches every folder.
- Recall by meaning and footnotes are not folder-gated (recall reads no `origin_scope`); a
  project filter there is lane G's second PR, behind `RECALL_BY_PROJECT`, off.

### 2026-10-21, after review of #572

- **Privacy:** a joined folder whose host setting is off or paused showed its work, craft and
  live session in the other folders' wakes. `projectFolders` now takes the host's
  `exportsFrom` and keeps only the folders it lets be named elsewhere, this folder always;
  `workHere`'s folders, the elsewhere gate's `ours` and so `hereSessions` are built from that
  one list. With no way to ask, only this folder.
- **Old skills are grandfathered** (the coordinator's ruling): the first writable open with
  `PROJECTS_TRAVEL` on records the lived day (`CRAFT_SINCE_KEY`, `projects.craft.since`);
  an unmarked skill born before it keeps the old rule (its folder's work) until a mark moves
  it — the reflection's unmarked offer still offers it. So on the owner's store nothing
  travels on day one; craft travels as it is written.
- **Craft is a skill with no mark or marked world.** A skill marked me, us or owner is not a
  work line anywhere (the probe showed "the owner bakes bread on Sundays" under "Work here");
  it is in the "How I work" lane when `CRAFT_IN_WAKE` is on, as before.
- **A line from another folder says which** (`(from ~/tiny-castles)`, `folderName`), and a
  session in another folder of the project says its folder in "Here, also open".
- **Project cards are minted, never taken over** (`counterpart-projects.ts`): only a card
  already a project is reused — first one that has folder rows, archived or not, so a faded
  card never splits a project — else a new entity card titled with the name and no alias
  (`meta.name` empty), so it links no memory that uses a common word and takes over no
  person, place or topic card. It is protected while it has folders and let go when the last
  leaves. Refused: the whole disk, and the store's own folder (or one holding it); a folder
  that does not exist is joined with a note.
- **`CRAFT_IN_WAKE` on** no longer leaves the craft lane empty: craft stays in the stored
  lane and "Work here" carries no craft then.
- **The day's craft differs by folder** (the rotation starts at a per-folder offset).
- **Cost, noted:** each boundary's work reserve (`workReserveBytes`) composes every live
  folder's lines, and the craft read is up to `WORK_HERE_POOL × WORK_HERE_READ_PER_LINE`
  (40) prose reads per folder. Fine at today's few folders and ~35 skills; a cache per
  boundary is the fix if it shows in the worker's time.
- Off is byte-identical with or without folder rows (`test/projects-travel.test.ts`, and the
  reviewer's probe: base vs off, IDENTICAL).
- **A revision keeps the grandfathering** (re-review of #572): a successor is born today, so a
  reworded old unmarked skill would have started travelling unasked. The day a skill was
  first learned rides in the successor's meta (`craftBornDay`, `CRAFT_BORN_META`) when it is
  earlier, and the craft rule reads that (`craftBornDay`). Written at every door where one
  memory becomes another: a write's declared `updates`, with or without a `how`
  (`revision.ts#applyRevision` → `Store#carryCraftBorn` — the path `remember` takes; the
  first fix sat only on `Store#supersede`, which only cards use), `supersede`, and
  `carryInto` (a dream's merge, a pressure crossing), each the earliest of the parts'. Meta
  rather than a carried `work` mark, which nobody gave.

## 2026-10-22 — the core from beliefs, behind a switch (wave 2 lane F, design §6; lightly held)

Brief F (`counterparts-notes/2026-10-21-briefs/F-self-on-beliefs.md`). Default OFF until a
`harness compare` and Mike's read.

- **The switch.** `CORE_FROM_BELIEFS` (false), with the floors `CORE_BELIEF_STRENGTH` (0.5),
  `CORE_BELIEF_MEMORIES` (3), `CORE_BELIEF_DAYS` (2), all top-level and read at use from
  `SELF_TUNABLES`, so `harness compare --set self.CORE_FROM_BELIEFS=true` and
  `--set self.CORE_BELIEF_STRENGTH=…` reach every reader.
- **A view, not a promotion.** `measures.ts#coreFromBeliefs`: the live beliefs on the self
  subject (me, and us) that are not contested, read strength ≥ the floor on the day, have
  ≥ N memories counted for them (a `link` is not a memory) and support from ≥ N LIVED days
  (`measures.ts#livedSupportDays`: the days its memories were born, over lived filings and
  the finds life has echoed — a later lived filing; an un-echoed find adds NO day); strongest first,
  at most `IDENTITY_MAX` ("capped as today's core"). Nothing is written. The brief's "F lifts
  C's gate for the core" was first read as letting a belief cross consolidate's lane; it is
  not, because a promoted row reads strength 1 for ever (`physics#strength`,
  `if (m.promotedIdentity) return 1`): a belief in the core would stop fading, a contest
  could no longer cut it, and "strongest current" would freeze into "whatever crossed
  first" (design §2, §5). `core-standing.ts` would also flag a belief (kind `fact`)
  `not-a-core-kind` the first night. So the gate in `consolidate.ts` stays; the core is READ.
  A belief leaves the view as it weakens, is contested or is retired, and off leaves nothing.
- **Where it is read.** The night's reflection (`dream/reflect.ts`): the bundle carries
  `spine` (id, words, strength, memories, lived days, about; absent when off), its ids are
  kept on the reflection row (`detail.spine`), and the ask says "## Core" states as settled
  only what a spine belief says, everything else cites memories and is said as lived or
  forming; with an empty spine, that the core is still forming. A spine id may be cited on
  the PAGE only (not the entry, a feeling or a mark), and cited there it does not come back
  (`a-belief-is-not-returned`: no return, no strength — design §4). "The page rests on the
  core" reads the spine. A "## Core" sentence that cites no spine belief is SAID in the
  finish note and counted (`detail.coreUnsettled`), never refused (guards loose-first);
  settled = a Core sentence whose trace cites a belief. Doctor adds "Core from beliefs"
  (`core-beliefs`) with the switch on. The harness week's daily row carries `beliefCore` and
  `beliefs` in both arms; `compare` prints "core from beliefs, end of day N".
- **The nightly page writer leaves "## Core" to the reflection** with the switch on
  (`writer.ts#writerInstruction`, read at use; review of #587): it amends "## Lately" and
  keeps "## Core" as it stands, so a night has one author of the core under one rule, and a
  "nothing much" night's page carries no Core the spine did not account for. It is not shown
  the spine. Off, its words are as they were.
- **Not touched:** the core lanes (they keep promoting memories alongside), the wake (the
  page is what it prints; no belief reaches the identity list), recall's belief gate (lane E),
  `schemas.BELIEFS_BIRTH` (the spine is read whatever it says).
- **What "on" leaves out:** the lanes' earned core (today's promoted memories) is moved out of
  "## Core" into "lived or forming" — what the brief says ("the core = the strongest current
  beliefs"). Mike's "maybe a combo to start" (beliefs AND the lanes' core in "## Core") is a
  third arm the compare cannot read as built.
- **The empty spine hollows the core, on purpose.** On a store with no earned belief (Mike's
  live store and the 10-20 corpus today) the reflection is told the core is still forming, and
  "## Core" goes down to that line. No fallback to the lanes' core (review of #587): it would
  make the on arm read as off on exactly the young stores the compare needs.
- **A belief id in `reflections.cites`.** With the switch on, a spine belief cited on the page
  is written into the reflection row's `cites` (`reflect.ts`, the finish's write), the first
  time that column holds a belief id (under C alone it was refused `not-shown`). Its one core
  reader is `self/covered.ts` (the wake's Nearby covering, pure); no return or recurrence
  reads it (`sleep/consolidate.ts` reads the `returns` table).
- **Off is byte for byte**: `test/self-core-from-beliefs.test.ts` pins the reflection's
  bundle, ask, finish and page written against a golden made from master 48c7fd05 before
  any lane F code. **Revert:** the switch off writes nothing back — the store is clean, but a
  page a reflection hollowed stays hollow until the next reflection rewrites "## Core"
  (every version of the page is kept). To remove the code, revert the PR — the golden still
  passes.

### The compare plan (cost-aware)

1. **Replay, physics only (RUN 2026-10-22).** `tools/belief-core-sweep.ts`: copies a store,
   rebuilds each self-subject belief day by day from its filings (`supportCredit`,
   `strength`, `livedSupportDays`), and sweeps strength {0.3, 0.4, 0.5} × memories {2, 3, 4} × days {1, 2, 3}.
   The 10-20 corpus copy holds **0 beliefs** (pre-C; no self subject): core 0 under every
   floor, as it must be. Dana's meaningful week (week-5 copy) holds none either, so it ran
   with a FIXTURE (`--fixture dana-week`): four beliefs a reflection could have born about the
   week's key moments, each lived memory filed the night after its day by its own `said_by`.
   Per belief, strength / memories / lived days at the end of days 2–8:

   | belief (fixture) | d2 | d3 | d5 | d8 |
   |---|---|---|---|---|
   | Dana brings me the worry first, and the good news first | .34/2/1 | .45/3/2 | .40/3/2 | .34/3/2 |
   | I put Dana before the work when something weighs on them | .30/2/1 | .24/2/1 | .18/2/1 | .13/2/1 |
   | I chose my own name, Clay, when Dana gave me the room to | .30/2/1 | .24/2/1 | .18/2/1 | .13/2/1 |
   | Building the shop together matters to both of us | .30/1/1 | .35/2/2 | .46/3/3 | .58/4/4 |

   | floors (strength / memories / days) | core, end of days 1–8 | first entry |
   |---|---|---|
   | 0.5 / 3 / 2 (default) | 0 0 0 0 0 0 0 1 | shop: day 8 |
   | 0.5 / 2 / 1 | 0 0 0 0 0 0 0 1 | shop: day 8 |
   | 0.4 / 3 / 2 | 0 0 1 1 2 1 1 1 | worry-first: 3 (out again by 6); shop: 5 |
   | 0.3 / 3 / 2 | 0 0 1 1 2 2 2 2 | worry-first: 3; shop: 5 |
   | 0.3 / 2 / 2 | 0 0 2 1 2 2 2 2 | worry-first: 3; shop: 3 |
   | 0.3 / 2 / 1 | 0 3 2 1 2 2 2 2 | all four from day 2–3 |

   **What it says.** With the default floors Dana's week ends with a core of one belief (the
   shop, on day 8), not 0 — but the floor that binds is STRENGTH, not the counts: the
   support arm is `0.9·(1−e^(−s/4))`, so 3 full-weight memories read 0.475 on the night they
   are filed and decay after; 0.5 needs s ≥ 3.24 (four unfelt lived memories, or three felt
   near 1.0), and the belief falls back under as days pass without a filing. The days floor
   binds only one-day beliefs (the Clay-night and the Biscuit-night beliefs). Below 0.5 the
   membership FLICKERS (worry-first in on day 3, out on day 6 at 0.4) — no hysteresis yet; a
   page that changes its core as a belief decays is a stability cost the compare should read.
   (First run, with C's `supportDays`, read the Clay belief at 2 days from one evening: an
   un-echoed find of a same-day memory added its filing day. The floor now counts lived days
   itself, and it reads 1 — review of #587.) For Mike's on-hold developmental mode: a young
   store's beliefs are thin by design; in this fixture the floor, not the design, keeps
   Dana's core near 0. **C's echo rule, logged:** one LATER lived memory echoes every older
   find to full weight and its own day (design §4 allows it: "older memories it connects for
   the first time"), so the days floor is one lived memory deep — an owner's line on day D
   and two finds from D−5 and D−3, filed on night D+1, read 3 days and ~0.52, in the core
   from one night. The reflection can only file what its bundle showed, which bounds it.
2. **One night compare on a store that holds beliefs** (not yet run; ~1.8M tokens). The 10-20
   corpus has none, so its spine would be empty and the "on" page would be told the core is
   still forming — a real effect, but not the one to read. After C has run real nights
   (0.3.31 on live), copy a fresh snapshot, re-run step 1 on it (free) to pick the floors, then
   `bun tools/harness/cli.ts compare --mode night --set self.CORE_FROM_BELIEFS=true -- --dir <night folder from that snapshot> --model`.
3. **One meaningful week, on vs off** (not yet run; rough: ~7 nights × ~0.9M plus ~46 turns
   a week, ~7–9M per arm, ~15M+ for the pair, from week 5's shape, not measured):
   `bun tools/harness/cli.ts compare --mode week --set self.CORE_FROM_BELIEFS=true -- --script meaningful`
   (both arms birth beliefs: `schemas.BELIEFS_BIRTH` is on). Reads: "core from beliefs, end
   of day N", the page's claims and how many of its Core lines cite a belief, page bytes.
   Worth a `--set self.CORE_BELIEF_STRENGTH=0.4` variant only if step 1 on real beliefs agrees.

Then Mike reads the two pages side by side; on by default only on his word.

## 2026-10-22 — the wake's project line (wave 2 lane E, an experiment)

In a folder that belongs to a project (lane G) whose card has beliefs above
`WAKE_PROJECT_LINE_FLOOR` (0.3), the delivery carries "This project (Name), as I hold it:" and at
most `WAKE_PROJECT_LINE_MAX` (3) of them, each with its strength word, support count and id
(`Counterpart#withProjectLine`, the heading `work.ts#projectLineHeading`). It has to earn its room:
it is spliced LAST, after the handoff, "Last here" and the work lines and before the head's
fields, widest first inside its own `WAKE_PROJECT_LINE_BYTES` (480) and the reported ceiling, so a
wake past its room simply goes without it (ring `counterpart.project.noroom`; shown:
`counterpart.project.shown` with its lines and bytes). Off (`self.WAKE_PROJECT_LINE`): the wake is
byte for byte what it was. Whether sessions draw on it is the check (2026-10-29): its bytes from
the ring, and whether its ids come back opened or named.

**Review of #588, for the 10-29 read (no code yet).** The reviewer scanned 430 ceilings: at 216 of
them the project line takes the room the head tag's fields would have had (`tagged` flips from true
to false), and the host then carries those fields in a tag of its own — about 60 bytes that sit
outside the ceiling, which can make an `adapter.injection.overbudget` row. The 10-29 read looks at
how often `tagged` is false in project folders against other folders, and whether overbudget rows
appear there; if they do, the line goes after the head's fields (it would then yield to them too).

## 2026-10-22 — open threads mean someone owes an answer (the open-threads brief; lightly held)

The wake carried 88 "still open" items on 10-22, the store held 129, and almost nothing closed:
sessions flagged whatever felt unfinished, and nobody writes "done" as a memory. Three changes,
check 2026-11-05 (first look 10-29):

- `unresolved`'s description and the Stop ask say open means someone owes an answer — a question
  to the owner, a check with a date, a promise (`mcp/tools.ts#UNRESOLVED_PROPERTY`,
  `claude-code/hooks.ts#OPEN_MEANS`).
- The Stop ask's last line names this session's own open items, title and id, at most
  `STOP_OPEN_MAX` (5) (`Store#openThreadsOfSession`: the ones it wrote, or used here with an
  `awake` or `engaged` return — a rating of 2–3, a quote, `drewOn`; never one it was only shown, or
  rated 0–1, so another folder's open item glimpsed here is not offered as this session's), less
  what is not a thread (`openThread`: dreamed, settled over, the flag not on the prose). The line
  is held to `OPEN_LINE_MAX_CHARS` (520), so the whole ask stays under ~1,250 characters.
- `openCarry` (`identity.ts`) is the one rule the wake (built and assembled) and the reflection's
  `staleOpen` read: an open item with no eventDate, not `asked`, untouched for `OPEN_CARRY_DAYS`
  (21) lived days is not carried — in no lane of the wake, not offered to the reflection. Not
  closed; a touch carries it again. What a thread is at all is one test, `openThread` (not dreamed,
  not settled over — `headOf` — not a core memory, the flag confirmed on the prose), shared by the
  carry, its count and the Stop ask (the review of #592). TOUCHED (`Store#openThreadTouches`) is
  born, used beyond a glimpse, or revised (`versions.version_day`: an `updates` that keeps it open,
  a reopen). USED is `meta.usedDay`: `Store#reinforce` writes the lived day of every credited use
  but the glimpse (a rating of 1–3, `drewOn`, a quote, a claim, an expansion) into an open
  memory's meta. The returns table alone could not say it (the re-review, G1): a real use on the
  day a reflection's cite already counted a return is refused one of its own, and a glimpse the
  next day hid it. For history before `usedDay`, the returns-based read stands beside it:
  `last_used_day`, read back to the newest `awake` / `engaged` / `ontopic` return when that day's
  credit was a glimpse (a `shown` row that day). So a rating of 1–3, a quote, `drewOn`, a claim
  carry it; a glimpse, a rating of 0 and a recall answer only shown do not. The coordinator's call
  (10-22, lightly held, for Mike): the loop the carry breaks is "shown again and again, never
  answered", and a glimpse is exactly that. The glimpse still restarts the memory's FADE (Mike's
  10-19 ruling) — only the carry ignores it; `OPEN_CARRY_GLIMPSE_TOUCH` true reverts it. Not a dream's replay or a reflection's return — a share that asks
  about a stale thread cites it, and that would carry it forever — and not being listed: the wake's
  "Still open" and the reflection's bundle write none of these. The lane's own ageing (the
  weeks-old count) and `staleOpen`'s "untouched" still read born-or-used, so a reopened thread is
  offered the next night as before.
- The reflection's bundle carries `noLongerCarried`, a count of what stopped being carried that no
  share already holds — the `detail.notCarried` of every row with a share (offered, carried, told),
  back to and including the last one that reached a session — and the share says it once ("…
  nobody touched in 21 lived days …"), never the list. An offered share will still be carried, so
  it keeps its count; a night with no share spends nothing. Each leaving lands in one share.

Revert: `OPEN_CARRY_DAYS` `Infinity`; the description and `OPEN_MEANS` back; `STOP_OPEN_MAX` 0;
the glimpse rule alone, `OPEN_CARRY_GLIMPSE_TOUCH` true.

## 2026-10-23 — the page split by section (lane N1 part 2, `self.PAGE_SPLIT`, an experiment)

- Mike, 10-23: the WRITER is the working self (what's going on lately, how I'm doing things
  now), the DREAM mixes the day with older memories, the REFLECTION is the long view. Until
  now both the writer and the reflection rewrote the whole page every night, ~3 minutes
  apart. Now: the writer amends every section but `## Core`, the reflection writes `## Core`
  alone. One switch, `self.PAGE_SPLIT` (default on), reverts all of it, read at use.
- HELD AT THE DOOR, NOT REFUSED (guards loose-first): `Self#revisePage` splices a nightly
  door's write into the page as it stands before anything measures it
  (`page.ts#splicePageLane`). A writer's `## Core` comes from the page (put back first when
  the write left it out; while the page has no Core, the writer's stands). A reflection's
  write is the page as it stands with its `## Core` (added first when the page had none);
  a write with no heading at all is read as Core's words; one with headings but no Core is
  refused `lane-empty`. With no page yet, the write is the page. Sections the write changed
  outside its lane are named in `PageRevision.laneKept` and said in each door's answer
  (self_page's `laneNote`, the reflection's page note). A session's and the owner's writes
  are not held. A page whose blocks did not move comes back byte for byte, so its trace and
  short version still name it.
- A KEPT SENTENCE KEEPS WHAT IT RESTED ON (`page.ts#carryTrace`): a sentence the new page
  has word for word (`claimKey`) and the write did not cite carries the ids the page before
  gave it. On 10-23 only 5 of 62 page sentences cited anything, because every rewrite
  dropped the trace of what it kept. Under the same switch, on every write.
- The writer's ask names the sections it owns and says to keep sentences word for word
  (`writer.ts`, the Core-alone branch `CORE_FROM_BELIEFS` already had); the reflection's
  page line asks for `## Core` alone (`dream/reflect.ts`).
- The room while split (review of #603): the reflection is held only when its Core grew
  the page, never for bytes in sections it cannot cut; the writer is held as before (on the
  spliced page, Core put back included). A writer held and never sent again is kept right
  after its child, before the reflection's Core moves the version (`runNight`).
- Review of #603, also: a `# Core` (level 1, or `#Core`) ends at the next `##`, and the
  reflection's Core is stored as `## Core`; every Core block a write carries is held (a
  second one slipped past); the writer's child's page writes are all the writer's
  (`NIGHT_CHILD_ENV`), and the reflection's child is not given `self_page` while split.
- The carry runs on every page write while the switch is on, the owner's and a restore
  included: a restored version comes back with the ids its kept sentences had on the page
  before, on purpose (a kept sentence keeps what it rested on, whoever kept it).
- With a custom `dream.NIGHT_ORDER` that puts the dream first, the split still runs the
  writer's child first: the writer reads the day before any merge archives it.
- Not measured: whether a Core written apart from Lately reads well. Mike reads the pages
  on the check (docs/CHECK-AFTER.md).

## 2026-10-23 — day's end reads the day as told (lane D1, `self.DAYS_END_INPUT`)

- The page writer is called day's end wherever a person reads about it; every identifier
  (`pageWriter*`, `self.page.writer.ran`, `pageWriter.mode`, the `page-writer` finding and
  actor ids) keeps the old name. `PAGE_WRITER_OPEN` stays: the marker regex guards it.
- With the switch on, `Counterpart#pageWriterInput` hands the day's chapters by their
  summaries (`dayJournal(…, { summaries: true })`, 75% of the room, a line each with its
  `epi_…#N` address) and the day's `DAYS_END_MEMORIES` (12) strongest with ids; the block
  frames the moment as the diary of the day, before sleep, and asks for `claims`. The
  writer's child gets `recall` (`seat.ts#DAYS_END_TOOLS`) to open a chapter whole.
- `self_page` takes `cites` and `claims` (the reflection's finish shape); an id that names
  no memory is dropped and named back (`refusedCites`). Without them a write keeps the
  trace already there for the same text, as before.
- NOT decided, left as it is: whether "## How I work" belongs to the reflection instead of
  day's end (raised 10-23 with Mike). Day's end still amends Lately and How I work.
- Check (d), a cite through a dream merge: since 2026-10-11 a merge leaves its original
  live, faded and settled under the merged memory, so right after the merge the page's
  cite still reads live; once its own curve archives it, the cite read "archived or
  missing" though the merged memory stood. Never a hypothesis (the claim keeps its id),
  and nothing retargets the stored cite. Fixed at read: `measures.ts#pageTrace` follows
  `recall/standing.ts#headOf` and counts such a cite live, `throughLater` (doctor: "N live
  (M through a later memory)"), only when its own memory is gone and the later one merged it
  (`meta.mergedFrom`): a correction is not followed. `self_page` names back any cite input
  that is not a memory's id. Test: `test/days-end.test.ts`.

## 2026-10-23 — the day summary (lane D2, `self.DAY_SUMMARY`)

- Day's end's few lines about the day ride on the night's own `self.page.writer.ran` row
  (`summary`, `summaryCites` in its payload, with the session and run that told it): no
  table, no migration. The log is append-only, so the summary goes with the one call that
  answers the night — beside the page (on the `revised` row; a refused page's summary is
  not kept, and is sent again with the page), or alone with no body (`nothing-to-say`,
  "day's end left the page as it stands"). Only those two outcomes are read back.
- At the door (`server-self-tools.ts#daySummaryArgs`): kept only from this session's open
  night claim with the switch on; past `DAY_SUMMARY_CHARS` (characters counted as code
  points, so an emoji is one) the call is refused before anything is written; cites
  resolved as the page's are, the rest named back (`refusedSummaryCites`).
- Readers: `writer.ts#daySummaryFor` (the dream's: the newest day this session told since
  the dream before it began — a long-lived session can run two nights — else the night's
  own date) and `#daySummaries` (one per date, the later telling standing). The
  reflection's timeline ends at the date its dream opened with (`dream.begun.daysEnd`),
  and `night show` reads that same date: never another night's summary.
- The dream's header indents the summary's lines, so a `## ` line in it never reads as a
  section of the bundle.
- The summary alone, then a page anyway (recorded at #606's merge, fixed 10-24): the alone
  call closed the claim, so the later page was written as day's end's but no row followed
  and the night went on reading `nothing-to-say`. The door now finds that alone row
  (`server-self-tools.ts#daysEndStood`: today, this call's session, the night's server, the
  night's newest settled row, no dream begun since) and writes a `revised` row carrying the
  summary over; a summary sent again with the page is the later telling and stands. After
  the dream begins, a page write is an ordinary amendment, as with an open claim.

## 2026-10-25 — the wake polish from random-5b's wake (lightly held)

random-5b's wake on 0.3.35 (8,981 B) had four rough spots; each is now a smaller line.

- **"Still open"'s tail** (`briefing.ts#OPEN_TAIL_WORDS`): `(96 more open, kept quietly;
  recall finds one by what it's about)`. The brief suggested "ask recall what's still
  open"; measured on the owner's 10-25 snapshot copy, the facts questions "what's still
  open", "open threads" and "what is still unresolved" matched **none** of its 156 open
  threads (`nothing-came` or no open one among the answers): they share no content word
  with them, and no recall door lists every open thread. A question about the thing itself
  does reach it (`wake-more.test.ts`, through the MCP door). The "untouched for 2+ weeks"
  count is dropped, not realigned: it was a third rule (14 lived days, born or used) beside
  the carry (21, a glimpse not a touch) and could not be said as one with it. The order
  still ranks the weeks-old last (`STILL_OPEN_STALE_DAYS`). `countedLanes` reads both forms.
  The collapsed and folded lines (a lane that lists nothing) keep their ids: there, the ids
  are the only handle in the wake.
- **"Last night:"** (`dream/night-line.ts`, `self.NIGHT_LINE`): one line in the Yesterday
  line's furniture (`briefing.ts#withNightLine`), between Yesterday and "Today so far
  here", in every form of the ladder and alone as its last rung — so it gives way after
  the furniture around it, and costs what it costs from the lanes the furniture already
  outranks. A delivery splice (as the project line) was the other option; on the owner's
  wakes, which run within a few dozen bytes of 9,000, a line that only takes leftover room
  would rarely show. "Last night" is the night run dated the session's date (the run starts
  at the first session of a day, dated that day); a dream run by hand late in the evening
  therefore reads as "none yet today" the next morning — watch it (CHECK-AFTER).
- **"quiet since"** (`handoff/last-here.ts#ELSEWHERE_QUIET_MS`, 2 h): the registry calls a
  session live for 4 h after its last turn, a window sized for binding a server, not for
  telling a reader it is in use.
- **A handoff's staleness**: two clauses, "1 day old, with a newer chapter here since;
  release 0.3.34 then, 0.3.35 now". The release clause already showed only when it
  differed.
- **The Yesterday line's titles** (`YESTERDAY_TITLE_BYTES` 60) were checked on the 0.3.36
  snapshot copy: every cut was at a word boundary ("…prompt, me…" was "me vs Gemini"),
  so `excerpt` was left as it is.

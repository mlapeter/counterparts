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
half a third of v1's; the AND landed the same day.

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

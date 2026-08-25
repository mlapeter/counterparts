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

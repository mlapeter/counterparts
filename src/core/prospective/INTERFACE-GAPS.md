# `prospective/` — interface gaps

Things this module needs from a neighbour and worked around instead of editing. Each
entry names the owner, the workaround now in the code, and what the real fix looks like.

## 1. The wiring into `recall/` — and the `arrival` NAME COLLISION

**Owner:** the coordinator (a seam pass), not this module and not `recall/`.
**Needed:** contract §5 G1 — "a temporal cue enters `recall/` through the same activation
and gate path as any other cue; a test asserts no second injection path exists."
**Have:** `Prospective.arrivals()` returns `Arrival[]`. Each one carries `memoryId`,
`cueWeight` (= `CUE_STRENGTH x ramp`) and `maxTier: "footnoted"`. Nothing else. There is
no render, no injection, no text of any kind in this module, and `test/prospective.test.ts`
enumerates the exports and asserts that.

**READ THIS BEFORE WIRING — the two "arrival"s are not the same thing.**

| | `recall/`'s `arrival` | `prospective/`'s `Arrival` |
|---|---|---|
| what it is | base-level activation: `ARRIVAL_WEIGHT x strength` | a temporal cue: the calendar reached a remembered window |
| what it can do | MODULATE a candidate the conversation already reached | be one more cue, like the user typing "Portland" |
| can it create a candidate? | **no** — hard gate (a), an uncued memory is dark | **yes** — that is what a cue is |

They collide only in the word. Wiring a temporal arrival into `recall/`'s
`ARRIVAL_WEIGHT` would be a category error: it would silently make a *recency* multiplier
into an *admission* channel and break hard gate (a) for every dated memory.

**Real fix:** `ActivationInput` grows an optional
`temporal?: readonly { id: string; weight: number }[]`, folded into `cueScore` alongside
the token postings — the same map, so the candidate competes on one activation number
against the same background bar. Two constraints that must ride along:

1. `cueFraction` must count temporal weight as CUE, not as arrival, or hard gate (c)
   silently changes meaning.
2. A candidate whose ONLY cue is temporal must be capped at the footnote tier (§12 G5).
   `recall/`'s gate has no such per-candidate ceiling today; the cap belongs there, next
   to the other tier rules, not here.

Until that lands there is no wiring at all — which is the safe direction: the module
computes arrivals and nothing consumes them.

## 2. `ProseDoc` has no future-event date, and no enumeration of dated memories

**Owner:** `store/`.
**Needed:** (a) somewhere canonical for "the date this memory is ABOUT, in the future";
(b) a way to ask which memories have one, without reading every memory.
**Have:** `ProseDoc.happenedOn` — stated precision, never rounded, exactly the right
shape, and past-tense by name — plus the free-form `meta` bag.
**Workaround:** `contentDates(doc)` reads `happenedOn` plus a meta convention this module
declares (`eventDate: string`, `eventDates: string[]`), and `ArrivalInput.extraDates`
lets a caller supply dates it extracted itself. `arrivals()` and `exitReport()` then scan
`store.list()` and read every live memory — O(store) per call.
**Real fix:** either rename/widen `happenedOn` to a neutral `datedOn` with a documented
future case, or add a `happened_on` index plus `Store.datedMemories(fromDate, toDate)`.
The column already exists on the memories table; only the query is missing.

## 3. Session dedup is in-process — brake 3 of four does not survive a restart

**Owner:** `recall/` (contract open question 3: "what replaces session dedup if
`recall/`'s per-session gate state is not persisted?" — it IS persisted, in `gate_session`
via meta).
**Have:** `Prospective` keeps `sessionId -> Set<windowKey>`, bounded by
`MAX_SESSION_WINDOWS`, in memory.
**Workaround cost:** two processes in one session, or a restart mid-session, each get a
fresh set. The other three brakes still hold (once per lived day, the per-window cap, and
referenced-stop), so the failure mode is one extra polite mention — exactly the budget
§12 G12 sets for firing state.
**Real fix:** the window keys offered this session belong in `recall/`'s persisted gate
state, next to `surfaced` and `credited`, and this module reads them through the same
seam it will use for the wiring in gap #1.

## 4. `store.revise` cannot patch `happenedOn`, so a reschedule cannot complete here

**Owner:** `store/`.
**Needed:** §12 G8 — the correction "names the exact current value, carries a reason, and
archives the old."
**Have:** `Store.revise(id, { body?, title?, meta?, reason? })`. It archives the prior
version with a reason (the "archives the old" half, exactly right), but `happenedOn` is
not in the patch shape, so the stated date cannot be corrected through the seam.
**Workaround:** `Prospective.reschedule()` does the FIRING-STATE half only — it validates
the compare-and-swap against the memory's currently derived windows, retires the old
window (kept, state `expired`, never deleted) and arms the fresh key. The caller then
revises the memory's own date (`store.revise` with the `eventDate` meta of gap #2). Until
that second step lands, derivation still points at the old date and the fresh window
simply never fires — the fail-safe direction: the system stays quiet rather than speaking
about something that is not happening.
**Real fix:** `happenedOn?: string` in the revise patch, so the whole correction is one
transaction and cannot half-land.

## 5. The prospective row cannot record WHY a window was suppressed

**Owner:** `store/`.
**Needed:** scar §2.4 — "a suppressed fire is a distinct record from a fire that never
became eligible", durably.
**Have:** `prospective(memory_id, window_key, event_date, precision, state, fires,
last_fired_day)`, with `state` drawn from four values and no reason column.
**Workaround:** the four states are spent carefully so the distinctions that MATTER
survive without a reason column — `suppressed` is written by referenced-stop and nothing
else, `expired` by a closed or superseded window, and `over-fired` is readable as
`fires >= FIRES_PER_WINDOW`. What does not survive a restart is the finer detail
(which reschedule retired a window, whether an expiry was a close or a swap); that rides
in telemetry only.
**Real fix:** a `reason TEXT` column, or a `state` vocabulary that includes `referenced`.
Neither is urgent: losing this costs analytics, never a brake.

## 6. The observer predicate lives in `store/`

Not a defect, and recorded so nobody "fixes" it: `Prospective.observer` reads
`store.observer` and never re-derives the predicate (`docs/observer-mode.md` G7, and
`recall/`'s INTERFACE-GAPS #4 says the same). If the predicate moves to
`src/core/observer.ts` (SEAMS #4), this module follows the move without changing
behavior.

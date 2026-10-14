# Improvements and bugs, found in use

A running list of things noticed while living on Counterparts, as opposed to
building it. `LAUNCH-STATUS.md` is the scoreboard for launch findings (I-numbers)
and owner rulings (G-numbers); this file is for everything smaller or softer:
tuning questions, phrasing, behaviors of the model on the receiving end, and
bugs that don't need a launch-status entry. Each module also keeps its own
`INTERFACE-GAPS.md` and `NOTES.md` (e.g. `src/core/recall/`); those are for gaps
between a module's contract and what it has, written by whoever builds it. This
file is the user-side view. Anything here that grows into a real incident should
move to `LAUNCH-STATUS.md` and leave a pointer behind; anything that turns out to
be a contract gap should get a line in the module's gaps file and a pointer here.
As of 2026-09-14 the recall module's gaps and notes files do not mention the
footnote title cap or the label probe beyond the contract's open question.

Each entry: date found, where it lives in the code, what was observed, what's
proposed, and a status line. Add to the top. Close entries in place rather than
deleting them.

Status words: `open`, `decided` (owner ruled, not yet built), `built`, `wontfix`.

**Standing ruling (owner, 2026-09-14):** judge improvements by what they do for
Counterparts and its new users, not by what they do for the ~14k memories
migrated from engram and bansai. New users will have none of those. Counterparts
exists partly to let go of the old systems' baggage, keeping only what worked
and the lessons learned. Legacy-only fixes are low priority by default.

---

## Decisions to review — the mechanisms work, groups 1–5 (2026-10-10)

**Status:** `open` — Mike walks this list; npm is held until he has. Written by the Group 1a
build (strength) from the mechanisms synthesis (§4, as amended by its draft 2, §8). Each line
says who decided it, when, and why, in plain words. The ones that reverse a ruling of Mike's
come first. Nothing here quotes a memory. A new subsection arrives as a fragment in
[`decisions.d/`](decisions.d/README.md) and is stitched in at release.

### Revised from Mike's rulings

1. **Deliberate facts recall ranks faded matches with the rest, bodies shown, each labelled
   faded.** Revised by b2+f8, 2026-10-10, from Mike's 2026-10-03 ruling (faded matches listed
   after the main results as title lines), lightly held. Why: the benchmark dropped 15
   (multi-session counts one item short); inline-with-bodies recovered it with no
   single-fact cost (bench R2-2, ~/counterparts-bench/TUNING-LOG.md). Forgetting lives in
   ambient surfacing; the effortful door reaches weak traces. Ambient channels (footnotes,
   the wake, spreading) still leave below-reach memories out; being shown credits nothing,
   an open or a quote credits as for any result. Meaning mode is unchanged (faded moments
   after the arc, counted "+N faded"). Fallback, if faded matches are ever seen crowding
   fresh ones on a live store: variant (a″), a mild fade-scaled penalty on the order only
   (score × (1 − 0.3 × (1 − strength/REACH))), also measured in R2-2. (`facts.ts`)
   **Kept. Mike, 2026-10-11, lightly held; looked at again at the 10-14 check-in.** His reason:
   be cautious about changing the core app to improve the benchmark. That's welcome when it
   helps overall, never at the real system's expense; a few months ago, fitting the benchmark
   broke a lot. At 10-14: look on the live store for faded matches crowding fresh ones.
   **Kept again. Mike, 2026-10-14, lightly held.** Of 16 real facts answers since 10-11, 5 had
   a faded item in the top 5. 4 of those were right answers (2–5-day-old release and work
   facts), and 1 was a clear crowding case (a 09-29 status note at rank 1, above the fresher
   10-11 one). The label was wrong instead: "not used for a long while" on two-day-old
   memories. It now reads "faded: weak, below reach" (#493).

2. **A dated memory is held until its date (no decay before it arrives), then fades a little
   faster.** Revised by b2+f8, 2026-10-10, lightly held — and it may reverse Mike's
   2026-09-26 prospective decision, whose note says "decay (`FADED_STRENGTH`) still holds" for a
   memory with an explicit date (the contract's G10, "no decay exemption before arrival"). Why:
   under the new curve a quiet reminder set a month out would fade and be refused before its
   day; people hold pending intentions. **After the window** (its date and the grace week):
   the memory's own stability is divided by 4 — steeper on its own curve, not zeroed — until
   it is used again (a use means it still matters). A 0.25 reminder leaves reach within a day;
   a felt 0.6 fact still lasts months. A repeating date (a birthday) is never "spent": each
   occurrence is held, and between them it fades on its own curve. The first build zeroed
   salience and feeling after the window, and on a copy of the live store (review of #372)
   9 of 17 dated memories were archived within 30 lived days, among them a felt fact about
   Mike and an agreed way of working; changed by Mike, 2026-10-10, loosely held. That holds for
   every memory whose date came after the day it was written, not only reminders. (Group 1a.)
   **Changed by Mike, 2026-10-11, lightly held: keep the pending hold, cut the spent slope.**
   The hold stays for one-off dates (through the grace week) and around each occurrence of a
   repeating date. The divide-by-4, its "ends on use" rule and its branch in `elapsed()` go.
   Once a one-off date's window closes, the memory is back on its normal curve as if it had
   never been held: t counts from its own anchor, not from the window's close. An old routine
   reminder drops out of reach at once; a felt dated fact lands where its own curve puts it.
   Why, in Mike's words: he asked how much complexity it adds and suggested just dropping the
   weight after the date instead of separate logic. Lowering it by hand wouldn't reach quiet
   reminders; ending the hold does the same job with no extra logic. This replaces his
   2026-10-10 "fades faster after" call (stability ÷4), loosely held. Also covers item 7.
3. **PARKED — engaged footnote credit** (G1b, #371). Parked by Mike, 2026-10-10:
   hand-labelled strict precision 0.17–0.33, lenient 0.60–0.78, below the 0.8 bar; the 09-14
   ruling ("never for being named in prose") stands in practice: no matcher guesses at use.
   **Successor, built: the `drewOn` field.** Built by the drewOn builder, 2026-10-11, from
   Mike's 10-10 direction, lightly held. `session_end` and `chapter` take optional `drewOn`
   ids: memories this session was shown that changed what it did or said, in its own word.
   Each earns the `engaged` tier, #371's tier code without its matcher: half a use, the clock
   restarted, a `returns.source = 'engaged'` row worth half a spaced return, no core-lane day.
   Once per lived day per memory; at most 3 per boundary (one ask, both tools together; the
   first named, the rest `capped`; a refused id uses no slot). Never a superseded memory or
   one faded under a newer one (refused by name). An open later the same day lifts it to a
   full use, in this session or another. The repetition arm now saturates,
   0.5·(1−e^(−uses/3)) (was linear to 0.5 at five uses). The one guard: only an id recall
   showed this session (its footnotes, loud memories and recall answers) counts; any other is
   refused `not-shown` and nothing is credited. **The wake is not in that record** (published
   per store, not per session), so a wake line still earns credit only by being opened.
   Every credit row says how each credit was earned (`how`: `expanded` / `quoted` /
   `drewOn`), and the doctor's Credit line counts a week of `drewOn` credits for the ~10-14
   check-in. Half weight toward the core's recurrence is a constant waiting for Group 3's
   recurrence lane (`ENGAGED_RECURRENCE_WEIGHT`); today an engaged return buys no lane day.
   The Stop ask is unchanged: the field text is the only prompt.

The rest are not reversals of Mike's rulings as far as b2, f8 and the builders know. Some
reverse older defaults and contract lines; those go to the rules audit.

### Decided by Mike, 2026-10-10, loosely held

- **Old claims are read as defaults, by what they are about — an era, not a rewrite.** Mike,
  2026-10-10, loosely held: a memory written before the store's cutoff with an explicit claim
  (not a default) is read by the forgetting curve at the default for what it is about — 0.20
  a done work event, 0.25 other work or unmarked, 0.35 the world, 0.40 me (or a person or self
  kind) — when that is lower than the claim. The stored claim is never rewritten: an explicit
  claim is kept as written, and only the curve's reading of it changes. **Exempt** (read as
  claimed): the core, memories about the owner or us, said by the owner, protected, and dated
  ones still pending or repeating. **Only down:** an explicit claim below its default (a 0.3
  world reading) reads as written. **The cutoff** is the moment of the first writable open by
  this build, kept in `meta` as `claims.era.cutoff`: on a v12 store that is the open that
  upgrades it to v13, when the new claim text reaches its writers. **The reading is
  reversible** by deleting that key — `counterparts claims-era --off` (`--on` puts the same
  cutoff back); **archives made meanwhile are not**: a memory the floor let go while it was on
  stays archived (readable by id). Doctor's "Old claims" line says whether it is on and how
  many memories it reads at their default. Why:
  497 of ~770 live memories were claimed 0.5 or more under the old field text ("set it on
  anything that should last"), so under the new curve they would stay in reach for months.
  On a copy of the 10-10 store: 408 memories read at their default; in reach 621/770 at +0,
  564/768 at +7, 479/697 at +30 lived days (729/770 and 660/747 without the era); no memory
  archived because of it by +7, 50 more than without it by +30 (73 against 23); the core
  13/13, memories about the owner or us and the pending tax reminders unchanged.
  "Said by the owner" is the `said_by` field, which exists only on memories written since
  10-08: "Protecting early memories is lower priority than a great, stable system; old memories, including Mike's pre-10-08 rulings (no said_by), may fade (Mike, 2026-10-10)."
  **Extended by Mike, 2026-10-11, lightly held:** "A pre-cutoff memory reads at today's
  default for its about, unless explicitly claimed lower." So an old DEFAULT (no claim; the
  seam filled in the flat 0.25 of its day, `meta.claimedDefault`) now reads at today's default
  too, up or down — an owner/us memory 0.40, a done work event 0.20 — while explicit claims
  keep the reading above. Why: consistency between old and new defaults, not protection of the
  old store; an upgrader gets what a fresh install gets. On a copy of the store, 18 owner/us
  memories written 10-08..10-10 at the old 0.25 went below reach on the first pass. On a
  synthetic store shaped like it (18 owner/us at the 0.25 default, written 10-08..10-10, no
  uses): below reach 12/18 on the first pass, 18/18 by +7 lived days as stored; 0/18 at +0
  and +7, 6/18 at +14, 18/18 at +30 read at today's 0.40 — none archived by +30 either way.
  The curve signature carries `eraReads: 2`, so a store signed before it re-curves once.

### Decided by b2+f8, 2026-10-10, lightly held; revisit after ~5 lived days

4. **The forgetting curve and its numbers.** A power law, steep at first and flat later, with
   each memory's own steepness set by its salience and half its feeling, its use, its returns
   and its kind. Why: a routine note should leave the working layer in about two days, a felt
   reading should last months, and a 0.7 fact about a year. Until now every memory faded on
   the same slow curve, so nothing left reach for ~100 lived days. (1a)
   **Kept. Mike, 2026-10-11, lightly held; looked at again at the 10-14 check-in.**
5. **Below reach at 0.15.** Under it, a memory is left out of everything that comes up on its
   own (turn recall, the links' pointers, the wake's work lines); asking deliberately still
   finds it (facts mode: ranked with the rest, labelled faded — item 1); using it, opening it or a dream replaying
   it brings it back. The core never goes below reach. Why: forgetting in awareness, never in
   storage — strength has to change what comes to mind, or decay changes nothing anyone sees.
   (1a)
   **Kept. Mike, 2026-10-11, lightly held; looked at again at the 10-14 check-in.**
6. **Exit after 14 lived days under the floor (was 90).** Exit means ARCHIVED, never deleted:
   the words stay, readable by id, and the journal is untouched. Nothing deletes a memory
   except Mike's own `counterparts remove`. Why: exit should follow reach; at 90 the first
   possible exit was lived day 91. If any later change would delete rows, it waits for Mike.
   (1a)
   **Kept. Mike, 2026-10-11, lightly held; looked at again at the 10-14 check-in.** For a faster
   read, at 7 lived days a read-only dry run shows what WOULD be archived if exit were 7 instead
   of 14; nothing is archived by it (docs/CHECK-AFTER.md).
7. **A dated memory holds until its date; after its window it is back on its own curve.** See item 2 (Mike, 2026-10-11). (1a)
8. **Feeling sets how slowly a memory fades, not its band; `emotional` is out of the
   salience average.** A feeling now counts once for height and once for steepness. Why:
   feeling was the one signal that told readings from changelog on the live store; it was
   being counted twice in height and barely in steepness. (1a)
   **Kept. Mike, 2026-10-11, lightly held; looked at again at the 10-14 check-in.**
9. **Mood-matched recall turned down (weights 0, code kept), marked for re-test.** Why:
   evidence from the old use metric (lifted memories used 1.3% vs 2.4%); re-test after Group
   1's engaged credit gives a real signal. Not a closed decision. (1c)
   **Kept. random-06, 2026-10-11, lightly held** (Mike approved random-06's recommendations on every item so far and did not object). The re-test is in docs/CHECK-AFTER.md, now that drewOn gives a use signal.
10. **"Strongly felt" means above the word's own default, or 0.6 and over**, so the core's fast
   lane can open again (it shut when feeling defaults were capped at 0.55). (1c)
   **Kept. random-06, 2026-10-11, lightly held** (Mike approved random-06's recommendations on every item so far and did not object).
11. **Encoding.** `note` becomes `remember` (with `note` kept as an alias for a release or
    two); the new end-of-session ask; salience by attention, not category; the defaults by
    what a memory is about. The `remember` description says to write in the moment, as things
    catch your attention; the ask is the backstop. (1c)
    **Kept. random-06, 2026-10-11, lightly held** (Mike approved random-06's recommendations on every item so far and did not object).
12. **One model for "this replaces that".** "Newer in the same slot" is `changed`; one detector
    (the write-time neighbours, plus status lineage or very high similarity) proposes, the
    dream confirms or undoes; the newest in a chain is what comes up on its own. (Group 2)
    **Yes. Mike, 2026-10-11, lightly held.** One model, owned by the module now called
    `contradictions.ts`, which is RENAMED `reconsolidation`; the detector lives there too. `inheritFrom`
    (#400) is its seed. The rename happens inside the Group 2 build, not as a separate PR.
13. **"Fade faster" is the existing `fade` multiplier**, not a new per-memory slope column.
    (2/3)
   **Kept. Mike, 2026-10-11, lightly held** (agreed earlier in the walk, via random-06).
14. **The core.** A recurrence lane (back on several days, across sessions, over weeks);
    identity means about me or us; after 60 lived days without coming back a core memory is
    FLAGGED "being reconsidered" (dashboard and wake) — demotion needs a decision, mine
    (awake or in the reflection) or Mike's, never automatic from disuse; both of us can retire
    a core memory directly. (3)
   **Kept. Mike, 2026-10-11, lightly held** (agreed earlier in the walk, via random-06).
15. **Folding.** A fold is a flag on `gist`, not a new verb; a fold starts at its sources'
    strength; reverse provenance goes in a `derivations` table. (3)
    **As revised, Mike, 2026-10-11, lightly held.** A fold is a dream gist flagged `fold`. Its sources
    fade through the existing `fade` (readings, felt, protected and core memories exempt). It starts at
    its sources' strength. At most 5 a night. Recall leads with it. NO `derivations` table: gists already
    store `meta.sources`, and the reverse lookup is a query over that. Cut for now: awake filing and
    code-proposed clusters. Open for Group 3: today's caps keep any gist from the core (the review of
    #403); folds starting at their sources' strength partly answer that.
16. **The dream queue.** The whole queue ranked into tonight's top-K; a memory stays queued
    until it is below reach; the reflection runs in its own context. (3)
    **Yes, in order. Mike, 2026-10-11, lightly held.** FIRST the reflection runs in its own fresh
    context (a real bug: one night peaked at 223k tokens on a 200k model). THEN the dream queue: rank
    everything not yet dreamed by value × fragility into tonight's top-K, keep a memory queued until it
    is below reach, and drop the newest-2,000 read. It matches the sleep research: replay favours
    tagged-important and weakly held memories, mostly recent, on a fixed budget.
17. **Cards as views**, not built in v1 (Mike's direction, 2026-10-10). (3)
    **Revised by Mike, 2026-10-11, lightly held: KEEP the entity card.** It is recall's subject index
    (facts mode's subject channel, `memoriesNaming` plus aliases), and it's how a future person or
    project view finds every memory about them. Fix its birth bug in Group 3: a nightly tally of names,
    ≥3 memories on ≥2 lived days, gated by `mention()`. The view is the page; the card is the index.
18. **A missed plain reminder is told once, later, within its 7-day grace.** (5)
   **Kept. Mike, 2026-10-11, lightly held** (agreed earlier in the walk, via random-06).

### Decided by the Group 1a builder, 2026-10-10, lightly held; revisit after ~5 lived days

Calls the synthesis left open, made in code (each carries its own `Decided by` comment):

- **The hold runs through the grace week, not just to the date.** A dated memory is held
  through its date plus prospective's 7-day grace, so the window can still fire. Why: the
  late beat and the open window's quiet fire both need it in reach.
- **A date that repeats is held around each occurrence** — from 3 days before to the grace week
  after — and fades between them, as Mike's 2026-10-09 design says. Why: a yearly date used once
  a year would otherwise be below reach on the very day it comes round.
- **Entity cards now fade on the steepest slope.** A card is a stub at salience 0, so a card used
  a few times reaches the floor within weeks of lived days of its last use; its calendar floor
  (180 days, 365 for people) is what keeps an unused card now. Before, a card used once stayed
  over the floor for months. Cards are rarely born today (the title-vs-name bug, Group 3), so
  this is noted rather than changed; review 03 C5 (one clock for cards) is where it belongs.
- **"Fades faster after" = its own stability divided by 4, counted from the window's close,
  until it is used after the window.** Decided by Mike, 2026-10-10, loosely held; revisit after
  ~5 lived days. Why: completed intentions are inhibited, gently; zeroing salience and
  feeling (the first build) archived felt facts and agreed conventions within weeks.
- **A dream replay or a reflection's citation re-anchors the curve** (as a use does, without
  being one). Why: the synthesis says a replay revives; a return's longer stability alone
  lifts a faded default note by about 0.01, not back into reach.
- **A handoff is out of decay, and out of the prune while it lives.** An expired handoff is
  still let go at the floor, as the handoff module always said. Why: its own 14-day expiry is
  its clock; exempting it for ever would keep every expired pointer.
- **Revision pressure keeps its exponential curve.** Why: it is the revision model's, and
  Group 2 owns it.
- **The turn gate adds feeling as height does, and only on a felt turn**, now that feeling is
  out of the salience average (recall §9 G10 kept).
- **What is outside reach altogether:** chapters, their copies, handoffs and entity cards —
  each born at strength 0 by design (the journal; a pointer with its own expiry; a name's
  card, faded by its own rule), so a reach line would hide every one of them from birth.
  Beliefs and every other memory are inside it.
- **Skill and place salience weigh 1.0, as every other kind (was 0.4).** Decided by Mike,
  2026-10-10, loosely held (proposed by b2 and f8); revisit after ~5 lived days. Why: the 0.4 weight put any skill
  claimed under 0.375 below reach from birth (a 0.25 skill was born at 0.10, and one deliberate
  open could not bring it back; on a copy of the live store 19 of 102 skills were below reach at
  once). Procedural memory is the slowest to fade in the brain; if skill notes are
  over-produced, that is encoding's job, not a special weight's. The repetition weight is
  unchanged.
- **The symmetry tripwire flags only UP-ratchets.** Decided by Mike, 2026-10-10, loosely held;
  revisit after ~5 lived days. Why: under the new curve, falling a band is the design, and
  climbing one comes only from an input (a use, a return, a replay, a feeling, a promotion), so
  the old 4:1 expectation flagged ordinary forgetting as a "reverse ratchet". It now trips on a
  climb no input explains (each up-move records its cause) or on climbs far outnumbering falls.
  The dashboard's Health/Flow panel, `status` and `sleep.symmetry.tripped` say "up-ratchet".
  The night a new curve arrives, the band moves it makes are recorded as `recurve` and not
  counted (review of #372: on a copy of the live store the install night lifted 47 skills and
  12 self memories a band, which would have read as an up-ratchet for days); a dated memory's
  climb is its date's (`held`).
- **Your existing store will fade slowly.** On the 10-10 snapshot, 497 of ~770 live memories
  were claimed ≥ 0.5 under the old salience text ("set it on anything that should last"), and
  under the new curve those stay in reach for months. New memories, claimed by attention, fade
  as designed. No re-score was done (decided: no one-off fixes). A one-time scale-down of old
  claims is a separate decision for Mike.

### Decided by the Group 1c builder, 2026-10-10, lightly held; revisit after ~5 lived days

Calls the synthesis left open, made in code (each carries its own `Decided by` comment; two
were refined by b2+f8 at the review of #369, named where they were):

- **The defaults by what a memory is about.** A memory written without a salience starts at
  0.20 for a work event that is done, 0.25 for other work and for an unmarked one, 0.35 for
  the world (readings, news), 0.40 for Mike, the two of us or me (or said by Mike). Why:
  review 01's table; an unmarked memory keeps 0.25 because "done" alone does not make it
  routine. The work-event row is 0.20, not 01's 0.10 (b2+f8, review of #369, lightly held):
  reach is 0.15, and a routine work event should stay in reach about a lived day.
- **A feeling alone lifts a memory at most to 0.49 while its own salience is under the
  semantic floor** (`FELT_HEIGHT_CAP`); at or above the floor it keeps the whole lift. Why:
  feeling sets how slowly a memory fades, not its band (item 8), and with the 0.40 default a
  strong feeling would otherwise start a silent memory semantic. It holds for claimed
  memories too: one claimed under 0.5 with a strong feeling now starts episodic.
- **"Strongly felt" (item 10) is 0.6, or 0.1 above the word's own default and at least 0.5.**
  The 0.1 is review 08's own reading; the 0.5 floor is b2+f8's (review of #369, lightly
  held): a calm word recorded at 0.45 is above its default, not strongly felt. A word nobody
  weighed still never opens the fast lane.
- **`note` still answers, as `remember`, for at least a release, and is not listed.** Why: a
  session running across the upgrade keeps its cached tool list, so only the call has to
  land; listing both would put two descriptions of one door in front of the model. Each call
  on the old name is counted, so dropping it is a read, not a guess.
- **What a session said and nobody wrote up stays owed for 14 days of use (was 3)**, and its
  text is kept that long. Why: on the 10-10 snapshot 18 owed stretches lapsed unwritten; the
  night takes four sessions, oldest first, and did not reach them in time.
- **The per-session ask limit yields to a stretch that is due.** At the limit a session is
  still asked when it holds unwritten pieces that are due (three of them, half an hour on).
  Why: the limit refused 84 asks in 4 sessions, 35 of them while something was owed; review
  01 offered this or a limit of 20, and this one asks only when something is owed.

### Decided by b2, 2026-10-10, lightly held (the wake, #374)

- Decided by b2, 2026-10-10, lightly held: every accepted memory and handoff change marks the wake for re-render (was: only write-ups, chapters, page, told, version, run-end). Why: a hermetic repro showed note-written memories stale in Still open/Nearby/Arriving for up to a day; cost ~0.45 s per writing turn-end in the detached worker, no model calls.

### Approved by Mike, 2026-10-10; details b2+f8, lightly held (the wake, #376)

- Mike approved the two options 2026-10-10; details b2+f8, lightly held: the wake is assembled at session start (Still open, Arriving, the Yesterday line and the page read for that moment; Nearby and the identity rotation stay the turn-end's, since showing them writes state), and a "Today, elsewhere" line names other folders worked in today. Why: morning sessions read the evening's wake and knew nothing of each other. Held firmly: no span text across folders, no work memory's title, no handoff body; counts only. Builder's choices, for review: a chapter title crosses only on the About-me line's gate (scope on, not confidential, a copy marked me/us/owner) — the Yesterday line still names every folder's titles; a folder whose scope is not on is not named at all, not even by count; three indexes (`memories_open`, `memories_created`, `memories_origin_ref`) ride the v13 upgrade, with no schema bump of their own; no worker kick at session start. Cost (SessionStart through the hook, 200 registry records): 3.7 → 6.6 ms at 1× (925 memories), 12.3 → 28.2 ms at a synthetic 10× (9,250 written in one day, 250 open questions), no model calls.
- Mike approved option C 2026-10-10 (the fresh-wake brief's PR 2); decided by the since-you-started builder, 2026-10-11, lightly held: a session already open gets one "Since you started" line at a prompt, for the model only, when another folder had a session start or end, a chapter, or new memories since the session last heard — at most once an hour, never at the first prompt after a wake. Same gate as "Today, elsewhere", shared code (`Counterpart#elsewhereGate`), same 300-byte ladder. Why: an open session never reads a wake again, so it did not learn what another folder did an hour ago. Builder's choices, for review: the wake is not counted as a line, so the first line can come at the second prompt (the hour runs between lines); a compaction's wake restarts the count; a folder where only time passed (a live session still working, no memories) is not a change; a session open when this installs counts from its start; the line takes only what recall left of its budget (its widest form that fits) and with no room waits, the hour unspent; the state is `sinceSeen` on the session's registry record, no store change. Cost (prompt hook, 200 registry records, synthetic): +0 ms within the hour; ≈5 ms on a prompt that checks at 1× (925 memories) and ≈5.5–7.5 ms at 10× (9,250 written that day) — the registry read ≈2–3 ms, the fortnight's chapter walk ≈2 ms, the counts ≈0.1–1 ms. No model or embedding call, no store write.
- Mike approved "last exchange, pull not push" 2026-10-10 (the fresh-wake brief's "after those"); decided by the last-exchange builder, 2026-10-11, lightly held: a fresh session gets one line, `Last said here, 18:42 (session 3fa9c1d2): "<first ~10 words>…" — recall "last exchange"` (at most 152 bytes), from the most recently active OTHER session in this folder whose owner words are inside 24 hours, and `recall` with the exact handle `last exchange` returns both messages (the owner's from its head, the reply from its tail, each at most 1,200 characters cut at a sentence) with times and the session. Nothing stored; nothing crosses folders. What the span buffer turned out to be, for review: it is per folder (yes), and it holds every exchange up to a session's last Stop — a message typed after that (killed mid-reply, closed before a reply) is absent; and a span is one turn-end's whole slice joined, the person's words and the host's (reminder, task notification, subagent hand-back, compaction summary) in one text. So, builder's choices: (1) the buffer is the only source: a crashed session is named by the last exchange its last turn-end captured, and words typed after it are not shown (a first build read them from the end of the host's transcript; taken out 2026-10-11 on the coordinator's word, since the plugin directory's rule 1F forbids extracting the host's chat history; capturing at the prompt hook would close the gap from our own hooks, not done here); (2) the owner's words are found by shape: wrapped host text stripped, the slice cut at the first paragraph that opens like a host frame, and a slice opening with a compaction summary skipped (the reader steps back one exchange) — the review of #392 added a skill's body, a pasted wake or recall note cut short, and a slash command's echo (what follows it is the command's expansion) as cuts; host text with no mark of its own (a coordinator's message, a scheduled prompt) that opens a turn still reads as typed words, a known limit — a per-turn mark in the span would make this exact, a format change not taken; (3) the reply is the newest assistant span from a turn-end that also held a conversation span, so the end-of-session ask's answer (which has none) never is, and a reply after an injected-only turn (a task notification) can be; (4) a still-live session in the same folder counts, and one that left no owner words is passed over for the one before it; (5) the line's room rides "Work here"'s reserve term (alone and beside each folder's work block, under the same share rule, so `DELIVERY_SHARED_RESERVES` and the page's limit hold), taken only when some folder had a turn-end in the last 24 hours — that is the room the page borrows before it steps down, so the line is never why the page is shorter; at delivery it sits at the foot of "Last here"'s blocks, each width tried with it and then without (the first thing given up there, never narrowing "Last here", the About-me line or the handoff, which is chosen first), and before the work lines; (6) the handle writes nothing (no `mcp.recall` row, no credit, no seen set; a ring event) — and, changed at the review of #392 on the coordinator's word, it stands down under observer like the rest of recall (mcp CONTRACT G5 has no exception); and, the #392 reviewer's call, lightly held, the line and the handle are given only to the owner's session (a span is the raw slice, which no confidential mark has reached yet; the installed configuration writes `owner: true`); (7) both texts go through the credential scan; the time shown is the turn-end's capture time. Rank, measured at 9,000 on the owner's morning (a 5.9 KB page, 25 open questions, a due-day reminder, another active folder), 0/1/4 handoffs × Last here or not × 5.9/6.5 KB page: the line prints in 11 of 12; the page stays whole in all 12 (and in the pinned four-handoff case "Arriving:", the due reminder and "Still open" are line for line what they are without it); the one miss is a 6.5 KB page beside four handoffs and Last here, where the page borrows the room first (pinned in `test/last-exchange.test.ts`). With no room of its own (riding the bundle's slack) it printed in 10 of 12 and never with neither a handoff nor a chapter here — the session that ended without a write-up, where the line matters most — and a room inside the handoffs' term instead made the page step down a rung at 7,000 (5.9 KB page, nothing else reserved). Cost: one lane element (Nearby, by trim order) on most of those wakes; SessionStart's lookup 0.45 ms for a day's buffer (4 sessions × 40 turn-ends) and 3.3 ms median, 4.5 p95, for a busy week (35 × 60 turn-ends of 1.5 KB, 6 MB), the render's check 0.2–0.9 ms; no model or embedding call, no store write. Not now: surfacing it on "where were we".
- "Last said here" and `last exchange`, who sent the message: Decided by the coordinator, 2026-10-11, lightly held: the quote stays, attributed neutrally, until spans mark each turn's source. Why: host text with no mark of its own (a coordinator's message, a scheduled prompt) that opens a turn reads like typed words (handoff INTERFACE-GAPS §9, pinned as `test.todo`), so the line says "Last said here" and the handle "the last message to me … and my last reply", never that the owner said it.

### Decided by b2+f8, 2026-10-10, lightly held; rank by the review of #380 (the wake, "Today, elsewhere" room)

- Decided by b2+f8, 2026-10-10, lightly held; rank moved by the review of #380: the "Today, elsewhere" line is capped at 300 bytes (folders past the cap become "+N more"; the last form is the count alone) and ranks in `ROOM_ORDER` between the handoffs' room and "Arriving:" past its head. It takes room from "Nearby", craft, "Still open" past its first item, "Work here", "Still open"'s count beside kept items, the Yesterday line's titles, "Last here" and the older handoffs; "Arriving:", "Still open"'s first item and count, the page and its borrowing, and a due-day plain reminder come before it. Only on days other folders were active; with no line the wake is byte-identical. Why: in the 10-10 test-build rehearsal the line never printed at the owner's 9,000-byte ceiling — his ~5.9 KB page filled the wake and the line was the first thing cut after Nearby — and it exists for his symptom, morning sessions in different folders not knowing about each other. Why this rank and not #380's (above the page's borrowing, the page chosen in the line's bytes less room): measured at 9,000 with a due-day reminder and four handoffs, it is the lowest rank that prints the line both in the owner-like case (~5.9 KB page, one other folder: ranks above "Still open"'s count suffice, the line takes that count) and in a busier one (6.5 KB page that borrows, "Work here", a Yesterday line, two or three other folders: nothing below the handoffs' room printed it; from there up it prints whole and "Work here" loses its one line). Higher buys nothing in either case and costs the page: at #380's rank a 6,767-byte page (an owner's page size from the history) stepped from whole to its next rung for a 243-byte line (8,881 → 4,172 bytes with no short version); here it stays whole and the line prints. #367 holds (dated items before furniture) and #363 holds (the page never gives way to the line).

### Decided by random-06, 2026-10-11, lightly held (the wake's "Arriving:" order)

- Decided by random-06, 2026-10-11, lightly held: "Arriving:" ranks plain reminders first, then nearest date — a plain reminder due the morning the wake is read, then every other plain one, then the quiet ones, each by nearest date (whole days either side, so a date in its grace days counts as near as one as far ahead; the warmth order only breaks a tie). The cap stays 2 and the "+N more arriving" line names the rest. Why: the 0.3.17 release check on a copy of Mike's store found his Oct-15 tax deadline (plain) missing from the wake on 10-13, because two quiet items due 10-14 took both lines. Builder's choice, for review: "nearest" counts days either side rather than putting dates still ahead before dates behind — the existing order of a reminder "was due yesterday" beside one due tomorrow is kept that way.

### Decided by the arriving-plain builder, 2026-10-11, lightly held (doctor's Vectors line on a new install)

- Decided by the arriving-plain builder, 2026-10-11, lightly held: doctor's Vectors line is green, "N memories not searchable by meaning yet — this builds after your first session", while the store has no backfill row at all; once any backfill has run, a shortfall is amber as before. Why: on a brand-new npm install this was the one amber before the first session, worded "the backfill embeds up to 1,000 per boundary", which a new user cannot act on. The discriminator is "no `adapter.embed.backfill` row ever" because every backfill run writes one; edge, accepted: a store whose embedder was off for its first sessions and then turned on reads green until its next session runs the backfill.

### Decided by the follow-ups builder, 2026-10-11, lightly held (the wake's Yesterday line)

- Decided by the follow-ups builder, 2026-10-11, lightly held: at a session start the Yesterday line names a chapter by title and id when this session's own directory wrote it, or when it is about me, us or the owner and its directory's scope is on (the "About me, from another directory" gate); every other chapter of that day joins the line's "and N more" count, and when they are all there is the line is the count alone ("chapters from N sessions in other directories"). A chapter whose row recorded no directory counts as another directory's. The turn-end's and `rebrief`'s published render keep the store-wide line. Why: the gate is the reader's — own directory against another, and the scope setting the host hands the wake — and the published bundle has no reader, so it stays as it was; it reaches a session only when the session-start assembly falls back (a bundle an older build published, another ceiling), filed as self INTERFACE-GAPS §14.
- Decided by the follow-ups builder, 2026-10-11, lightly held: the plugin's first-run lock in the temp directory is waited on only when it is a directory this user owns (not a link); anything else at its name is passed over, left where it is, and the install runs without the lock. Why: on Linux the temp directory is a shared `/tmp`, the lock's name is predictable, and with the sticky bit another user's directory there can be neither removed nor waited out — every first run waited its 20 s and failed. A per-user path alone does not close it (its name is just as predictable), so some fallback is needed either way; the lock only keeps the hook and the server, starting together, from installing at once, and `install` writes the same two things either way (measured: two first runs racing with no lock between them, every round one valid configuration and store).

### Decided by the rollback builder, 2026-10-11, lightly held (`counterparts rollback`)

- Decided by the rollback builder, 2026-10-11, lightly held: after a rollback, a hold file (`<store>/sessions/rollback/hold.json`) makes this build refuse EVERY open of the store while the store is behind it, writers and observers alike (`STORE_ROLLED_BACK`), until `counterparts rollback --upgrade-again` or `--undo`. Why: the command runs on the new build, and between the rollback and the older version's install anything on the new build would upgrade the store again (a hook, Claude Desktop's server, `install --host claude-desktop`) — and an observer read is not harmless either, because it builds the new build's cache beside the old store, which the older build then refuses for every memory tool (measured in the 10-10 rehearsal). A file and not a meta row, because the database is what gets swapped and a row would travel with it; inside `sessions/`, because an unclassified top-level entry makes even the older build refuse the store. Any later build on the same or a newer schema is held too (it would take the same store the same way), so an ordinary upgrade after a rollback needs the one command the stand-down names.
- Decided by the rollback builder, 2026-10-11, lightly held: `rollback` does not run `disconnect`; it prints QUICKSTART's order for changing versions (disconnect on the newer version, install the older, connect, Desktop) as next steps. Why: the hold already covers what disconnecting covered for the store, and more (Desktop's server, the dashboard, the console are not disconnected by it); the host's files stay with the commands that own them.
- Decided by the rollback builder, 2026-10-11, lightly held: `--upgrade-again` upgrades the store there and then from a NEW pre-migration copy, never one reused from the same UTC day (`freshMigrationCopy`). Why: the known trap — a second rollback on the same day restored the first one's copy and lost what the older version wrote in between. The upgraded store's cache is moved aside with it (not deleted), so `--undo` brings it back; `--undo` refuses once anything has written to the restored database (its sha256 is in the hold).

### Decided by the about-marks builder, 2026-10-11, lightly held (what a memory is about)

- Decided by the about-marks builder, 2026-10-11, lightly held: the reflection's unmarked offer keeps a room of its own — exactly what the offered ids cost as lines, held back from the shared room — and an offered memory the shared fit left waiting or showed as a bare id is shown as a line in it. Why: on 10-10 the offer fitted to nothing (`fit.notShown` 356); a synthetic full night (700 recent memories) offered 0 of 11 before and 5 of 5 after. A reserve rather than a higher priority, because the top priority would also hand the offer whole texts first on exactly the tight nights. Unmarked skills are offered too (the review: 5 of 34 read as personal, and nothing else ever offered them).
- Decided by the about-marks builder, 2026-10-11, lightly held: `counterparts about` (and the dashboard through it) marks an archived memory rather than refusing it, and says it is archived. Why: an archived memory can come back (a use, a body mention), and the mark should be right when it does; `setAbout` already took archived rows. An earlier version's id forwards to the current one and says so.
- Decided by the about-marks builder, 2026-10-11, lightly held: a mark set by `remember`'s `remark` is recorded `about_by = 'self'` (a new value in a text column, no schema change). Why: the brief asked for "by self", `writer` is the mark given at birth, and `self` is already the store's word for the counterpart (`said_by`). The remark takes the reflection's rules: only a memory the session was shown (as `feelingsNow`), a dream's or a reflection's words only toward work or world, a missing why recorded rather than refused; a confidential memory outside the owner's session is not found. The owner's door has none of these limits.

### Decided by the era-defaults builder, 2026-10-11, lightly held (old defaults at today's default)

- Decided by the era-defaults builder, 2026-10-11, lightly held: the era's exemptions (the core, about owner/us, said by the owner, protected, a pending or repeating date) apply to explicit claims only; an old default reads at today's default whatever it is, so a protected or pending done-work default reads 0.20, not its stored 0.25. Why: the ruling's one exception is "explicitly claimed lower", and a default was nobody's claim; the exempt are held or unprunable by other means anyway, so this moves a reading, not an archive.

### Decided by random-06, 2026-10-11, lightly held (a dream merge keeps `about` and era standing)

- Decided by random-06, 2026-10-11, lightly held: a dream's merged memory takes its strongest original's `about` mark (with its setter) unless that is not personal and another original's is (me, us, owner: a personal mark is never lost to a work one); of several personal marks, the strongest original's, else the first named. It also keeps that original's stored claim AND its era standing: an original written before the old-claims cutoff gives the merged memory its moment (`meta.eraWrittenAt`) and its `claimedDefault`, so the era reads it as it read the original, and `--off` reads it as stored. Why: a merge is the same memory in better words; before this the supersede's fill-if-unmarked carry took the first marked original's mark in the dream's order (a work one could win), and a merged memory was a new row the era no longer read, so two old owner defaults reading 0.40 became one reading 0.25, and an old 0.7 world claim read at 0.35 jumped back to 0.7. Detail decided by the merge-inherits builder, lightly held: the moment, not a yes/no flag, so it reads right against whatever cutoff `--on` restores and through a merge of a merge; and the strongest original's writer's fields (said by, status, when) come too, since the era's default and its "said by the owner" exemption read them (the supersede's carry still fills any the strongest original lacks from the others, as before). Merged memories made before this fix are not repaired.

### Decided by random-06, 2026-10-11, lightly held (one `inheritFrom` helper)

- Decided by random-06, 2026-10-11, lightly held: one `inheritFrom` helper (`store/index.ts`) decides what a row made from existing ones inherits — what it is about (the merge's rule: a personal mark wins over work, work over none) and, for a row that takes its best source's stored claim, its era standing. The dream merge and a revision by `updates` read it. A revision with no `about` sent takes the mark of the memory it revises (declared and resolved, as the three writer's fields already did), written at birth with its setter, and its default claim reads by it: an owner or us memory revised without restating `about` defaults to 0.40, not the unmarked 0.25. A sent `about` always wins. Why: random-06 revises by `updates` many times a day, and each revision of a personal memory was dropping to the unmarked default, and (for a link-only revision) losing its mark entirely. Group 2 routes the remaining "this replaces that" paths through the same helper later. Details accepted by the coordinator, 2026-10-11, lightly held: the helper returns no default claim (the revision's mark goes into `mint.ts`'s existing `defaultClaimFor`, which reads the proposal's status, said-by and kind); and a schema element (marked `me` by the v9 upgrade) revised by `updates` is born `me` at 0.40, where before it got the mark only after the mint (by the supersede's carry) at 0.25.
- Decided by the coordinator, 2026-10-11, lightly held, from the builder's evidence (B1), revising random-06's ask: **the reflection's own entry stays unmarked** (not `me`). Why: marking it reverses B1 (review of #256, pinned by `test/reflect-review.test.ts`, "a reflection's own entry … is not handed back to a reflection as a memory to mark or feel", which asserts the entry stays unmarked): the mark is the core's first gate (`physics#promotionEligibility`'s `not-about-me`), awake returns land on reflection rows (`Store#reinforce` filters no source), so every nightly entry would become a slow-lane core candidate — the self-authored rumination loop self CONTRACT §2(c) names. Turning it on is one line (`about: "me", aboutBy: "reflection"` in `dream/reflect.ts`'s entry `put`) plus that test's last assertion.
- Gist marks: D6 closed by Mike, 2026-10-11, lightly held: personal marks kept, core only by awake recurrence. A dream gist reads `inheritFrom(sources)` like the merge (a personal mark among its sources wins, the first named as best; its setter kept), with no era standing, its claim staying at `DREAMED_CLAIM_CEILING`. No refusal by `source` was added to the core's lanes (`dream/CONTRACT.md` §7 Q2). The reflection's own entry stays unmarked.

### Decided by the drewOn builder, 2026-10-11, lightly held (`drewOn`, item 3 above)

- Decided by the drewOn builder, 2026-10-11, lightly held: an id from the wake comes back
  `not-shown`. Why: the one guard is recall's per-session record (footnotes, loud memories,
  recall answers), and the wake has none — `self.briefing.shown` is per published bundle and
  cannot say which session read it. Admitting it would need a second guard, and the wake is
  the always-near display the `on-display` rule exists for. Opening a wake line still credits it.
- Decided by the drewOn builder, 2026-10-11, lightly held: the same-day lift to a full use
  crosses sessions — `Store#reinforce` reads today's `engaged` return row when the caller
  names no lower tier. Why: `drewOn` lands at one session's Stop, and the open that should
  lift it is usually another session's; #371 lifted only within a session. Missed: an engaged
  credit whose return was refused because another return already counted that day.
- Decided by the drewOn builder, 2026-10-11, lightly held: "at most 3 per boundary" is per
  recall turn, shared by `session_end` and `chapter` (both answer the same ask, in the turn
  the Stop opened); only credits that land use a slot, so a refused id never pushes a later
  one out. Edge: an engaged credit lifted by an open frees its slot that turn.
- Decided by the drewOn builder, 2026-10-11, lightly held: `drewOn` is credited whatever the
  rest of the call does (a refused chapter, `memories-required`), and rides out on every
  answer, the `writeUp` divert's included (review of #385: it is read before the divert and
  credited against the WRITING session's shown set, which is the one the guard reads). A
  Desktop call that names no session (bound to the most recent live one) credits nothing and
  says `session-unnamed`, as its handoff fields do: that session may be another chat's.
- Decided by the reviewer of #385, 2026-10-11, lightly held: the saturating repetition arm's
  `REP_SCALE_USES` joins the decay curve's signature (`sleep/decay.ts#curveSignature`), so the
  first applied decay pass after this lands forgets every next-change day and walks the whole
  store once, filing its band moves as `recurve`. Why: `rep()` no longer reads `REP_PER_USE`,
  so the signature would otherwise be unchanged and the turn-down would trust next-change days
  computed under the linear arm. Measured on a synthetic 20,000-row population (70% never
  used): heights differ on ~2.7% of rows, bands move on ~0.04%, all down (3–8-use rows, whose
  arm drops by up to 0.11); `self`/`person` (no repetition arm) never move.

### Decided by the event-fields builder, 2026-10-11, lightly held (ids and session on events, for the sidebar mod)

- Decided by the event-fields builder, 2026-10-11, lightly held: the durable `mcp.recall` row
  now names the memory ids it DELIVERED (`ids`, at most 20, and `idCount`), reversing its old
  "no ids" line. Why: `recall.decision` has written every surfacing's ids with its session
  since E2, so the line was never the store's policy, and the sidebar could not say what a
  look-up opened. Ids only, never text; confidential memories are not filtered out of the
  list, as `recall.decision` does not filter them.
- Decided by the event-fields builder, 2026-10-11, lightly held: `associate.flush`'s `session`
  is the session whose boundary APPLIED the flush, not necessarily the one that credited the
  pairs: the pending file can hold lines from several sessions and does not say whose (adding
  that would change its on-disk format). Its `ids` are both ends of every pair that passed the
  boundary's re-check — which reverses this row's old "never an id" (the edge rows stay the
  record of what links to what). Rows from a caller that knows no session carry no `session` at all,
  never the unbound sentinel, so a reader falls back on its own guess.

### Decided by the day-order builder, 2026-10-11, lightly held (order within a day in a facts answer)

- Decided by the day-order builder, 2026-10-11, lightly held: when two or more results in one
  facts answer read as the same day, each shows the time it was learned, `HH:MM` in the store's
  zone, on its learned line (`learned 05-25 09:52`), not "earlier" / "later that day". Why: a
  time is exact, works for three or more results in a day, and does not depend on which other
  results the page holds; it costs six bytes a line (60 on a 10-result answer). "Same day"
  means the same event day (else learned day) AND the same learned day: results learned on
  different days are already ordered by their learned dates, so nothing is added. Nothing is
  added either when the colliding results share one minute, for journal entries, for an event
  date that is a range or a month, or for an old row with no `created_at`. The time is when it
  was learned, not when it happened, and the line says "learned". Meaning mode is unchanged:
  its moments carry no per-line date, and its arc is already in time order.

### Decided by the chapter-wording builder, 2026-10-11, lightly held (what a chapter asks for)

- Decided by the chapter-wording builder, 2026-10-11, lightly held: the core ask's own wording
  (`self/episodes.ts#askText`, the host-neutral text an embedder can show; Claude Code's Stop
  ask stays its short line) follows the chapter tool: a diary of what happened, in order and in
  detail, with "lessons and patterns belong to the nightly reflection" in place of "what you
  learned about them and about yourself". Why: two texts asking for different chapters would
  pull a host that shows the core ask back toward reflection.
- Decided by the chapter-wording builder, 2026-10-11, lightly held: the reflection's
  instructions gain one sentence, "The chapters hold what happened; the lessons and patterns in
  it are yours to draw here." Why: the dream already writes a pattern it sees as a gist, but the
  reflection named patterns only in one rotating question and lessons nowhere, so the work the
  chapter now hands over had no stated home.

### Decided by the catch-up builder, 2026-10-11, lightly held (the nightly run writes up everything owed)

- Decided by the catch-up builder, 2026-10-11, lightly held: the night's catch-up has no
  session bound; it runs in batches of at most 192 KB / 16 parts, each a fresh `claude -p`, until
  nothing is owed. Why: every fetched part stays in a child's context, so one child for a heavy
  morning would grow past a 200k-token model; a fresh child per batch keeps each near 50k.
- Decided by the catch-up builder, 2026-10-11, lightly held: the sanity ceiling is 400 parts and
  one hour a run (`NIGHT_WRITE_UP_PARTS`, `NIGHT_WRITE_UP_TOTAL_MS`). Why: a part costs about 7k
  new-work tokens (cache write + output) and two tool calls, so 400 parts is about 2.8M tokens,
  ~11× the measured nightly baseline (246k, 2026-10-10); a typical morning (20–40 parts) is under
  one baseline night, and a heavy day owed in full is about 200 parts (30 pieces were 16 parts on
  10-11). 400 parts at the measured 4–8 s a part is 27–53 minutes. The per-part cost is an
  estimate from part sizes, not measured from a catch-up transcript: measure it on the first live
  runs and move the ceiling if it is off. (Superseded for the night by the next item: 400 is now
  the command's ceiling only.)
- Decided by Mike, 2026-10-11, lightly held: the nightly run caps at 100 parts
  (`NIGHT_WRITE_UP_PARTS`); `counterparts catch-up` keeps 400 (`CATCH_UP_COMMAND_PARTS`); both
  keep the one-hour watchdog. Why: 100 parts is about 700k new-work tokens, roughly 3× the nightly
  baseline, so a typical morning's 20–40 parts clear in one night and a heavy day (about 200)
  takes two, what is left staying owed for the next night; the command is run on purpose, so it
  keeps the larger ceiling. The per-part cost is still to be measured (`docs/CHECK-AFTER.md`,
  "Catch-up's real per-part cost").
- Decided by the catch-up builder, 2026-10-11, lightly held: the catch-up stays BEFORE the dream.
  Why: the page writer and the dream's "new since the last dream" read yesterday, and yesterday's
  write-ups should be there when they do. The cost is that a heavy morning delays the dream by up
  to the hour; the hook's `started` row now carries that hour (`nightRowTimeoutMs`), so the delay
  is never read as a lost run.
- Decided by the catch-up builder, 2026-10-11, lightly held: the SessionStart pointer (and
  Desktop's wake pointer) is retired only under dreaming `auto`. Why: under `ask` or `off` no
  nightly run happens, and without the pointer an owed session in a quiet folder would lapse
  unless someone ran `counterparts catch-up`. The door's ordinary (pointer) path is kept for
  that case.
- Decided by the catch-up builder, 2026-10-11, lightly held: `counterparts catch-up` files its
  runners and pins its child's tools to the store's own directory, not the terminal's. Why: a
  command typed in a terminal was not started from any project, and the working directory may be
  one set `off`.

### Decided by the reflection-own-context builder, 2026-10-11, lightly held (the reflection in its own child)

- Decided by the reflection-own-context builder, 2026-10-11, lightly held: each of the night's
  two children gets the whole watchdog (`dreaming.timeoutMs`, default 20 minutes) and the whole
  turn ceiling, one after the other, and the `started` row carries both (`nightChildrenTimeoutMs`).
  Why: one shared deadline would let a slow dream starve the reflection; a night that took
  11–12 minutes in one context stays far inside 2 × 20. The cost is that a run that never
  reports is read as lost about 20 minutes later than before.
- Decided by the reflection-own-context builder, 2026-10-11, lightly held: the reflection's child
  runs after ANY dream child that ran, journaled or not. On a journaled dream it reflects on that
  dream by id; otherwise on the last few days, as the single run did when its dream was refused.
  It is not started after a first child that stopped straight away having begun nothing
  (`quick-exit`: a second `claude` would stop the same way), when a reflection already finished
  today, or when the store will not open between them. Why: the brief asks that a failed or
  skipped dream still leave a reflection. The cost is one case: a dream child that crashed
  mid-dream leaves its dream begun, so the relaunch that resumes it later that day finds the
  day already reflected and ends `partial` (the reflection is not run twice a day).
- Decided by the reflection-own-context builder, 2026-10-11, lightly held: the dream's child may
  not call the reflect tool at all (denied, `DREAM_CHILD_DENIED`), and its MCP server is told it
  is the dream's child (`COUNTERPARTS_NIGHT_CHILD=dream`), so the journal's `next` says to hand
  back instead of "now reflect". The reflection alone, and the reflection's child, keep all four
  night tools as before. The in-session run (a person says "dream", the Agent tool) is unchanged:
  one agent, all three parts.

### Decided by the doctor-install-fixes builder, 2026-10-11, lightly held (doctor's fixes by install)

- Decided by the doctor-install-fixes builder, 2026-10-11, lightly held: doctor's fix lines
  that install something (the model table missing or mismatched, a cache from a newer build)
  name the route by `plugin.ts#installRoute`: `/plugin → Installed → counterparts → Update now` when this process
  is the plugin's (`runningAsPlugin`), the `bun add -g` command when no `CLAUDE_PLUGIN_ROOT`
  is set, and both when one is set but names another copy, or when a caller passes nothing.
  Why: the plugin may run as the single binary with no bun at all, and "both" is the safe
  default for a caller that forgets. `plugin-run.sh` now also exports the plugin data
  directory it falls back on, so the single binary run from `/counterparts:doctor` knows
  itself for the plugin's (before, `runningAsPlugin` read false there).

### Decided by the group-5 builder, 2026-10-11, lightly held (prospective: reminders, item 18)

- Decided by the group-5 builder, 2026-10-11, lightly held: a plain DAY reminder whose day
  passed untold is told once at the first session inside its 7-day grace, as "This was for
  Mon 12 Oct 2026: …". It shares the day's latch (no new beat key), so a late telling counts
  as the day told everywhere that asks, and it can never come twice. A memory written after
  its day gets no late beat (it was never missed), nor one with no written date. A month's or
  range's missed last day gets none: it already had its opening beat. Why: review 07 C4 — a
  person who skips the day lost the reminder silently.
- Decided by the group-5 builder, 2026-10-11, lightly held: `reference()` is WIRED, not
  retired. A dated memory named in `drewOn` (and passing its guards: shown, live, not replaced)
  stops its open window, whether or not its credit lands under the cap or the once-a-day rule.
  Why: `drewOn` credits half a use and stops nothing, so a reminder the session already acted
  on still came back as a footnote until its budget (2) ran out; the referenced-stop is the one
  thing that ends that. A plain reminder keeps its day: until its last beat is told, drawing on
  it the day before does not silence the telling or its place under "Arriving:".
- Decided by the group-5 builder, 2026-10-11, lightly held: `exitReport()` is DELETED, and
  prospective G12 now promises the states its rows name plus the counts already shown (the
  dashboard's said-plainly / quiet-footnote counts, doctor's plain-due reading). Why: it had no
  caller; its `superseded-by-reschedule` exit rests on `reschedule()`, which `carryReminder`
  replaced (also uncalled, left in place); its `faded` exit cannot happen before a date now
  that the date is held; and the two homes for a caller were a new always-green doctor line or
  a write-capable engine inside the read-only dashboard.
- Decided by the group-5 builder, 2026-10-11, lightly held: the Mechanisms panel's "waiting"
  list shows a repeating date at its next occurrence, with how often it comes round ("every
  May 14"); one that came back this week is counted under "came back", as a one-off is.

### Trial, Mike, 2026-10-11, very lightly held (verbatim in the memory's body)

- Trial, Mike, 2026-10-11, very lightly held: verbatim in the memory's body; long-run lean is an
  attachments table (the memory holding the context and keywords that find it). `remember`'s
  `text` and `session_end`'s `content` ask for a list, a table or a pasted text whose specifics
  matter word for word, with the search words in the title and the first line. Looked at after 1
  and ~4 lived days (`docs/CHECK-AFTER.md`).
- Decided by the verbatim-trial builder, 2026-10-11, lightly held: a facts line whose excerpt is
  cut says when the words hold a list (5 or more bulleted or numbered lines) or a table (3 or more
  rows between pipes, not counting the header and its rule): "… (a list, 100 items; read whole by
  id)". Why: the excerpt flattens a list into one line of its first ~300 characters, so nothing
  showed that the rest was worth reading; it costs about 35 characters a line, inside the result
  budget. Counted on line shapes alone, so five lines that happen to start with a dash read as a
  list.
- Decided by the #409 reviewer, 2026-10-11, lightly held: facts mode's near-duplicate fold
  compares two results by their LINES (normalized, as sets) when either holds a list or a table,
  and by their word sets otherwise. Why: a long list's word set is mostly its shape, so three
  different 100-item inventories read 0.99 alike and two were "left out" with no id; two weeks'
  shift tables scored 0.78, just under the 0.85 line. By lines they score 0.0–0.05, while a list
  pasted twice or retitled still folds (0.98–1.0). Ambient recall's gate (`gate.ts#similarity`)
  still compares word sets; a turn could still deliver one of two similar lists.

### Decided by the mark-superseded builder, 2026-10-11, lightly held (settled-over memories where titles show)

- Decided by the mark-superseded builder, 2026-10-11, lightly held: a write's `neighbours`
  list a memory a later one settled over MARKED (`standing: "earlier (now mem_…)"`, before
  its title), not swapped for the one that holds now. It is left out instead when what holds
  now is already in view (the write itself, what it updates, a sibling in the same
  `session_end`, a neighbour listed above it) or is confidential to a guest writer. Why: the
  neighbours are what is close in words to the write; the one that holds now may not be, and
  the mark names it for a settle or a recall. The dream's and the reflection's bundles mark it
  the same way rather than leave it out (a dream may still link or feel it), and the dream's
  "coming up" leaves out a dated memory a later one settled over, as the wake's "Arriving:"
  does. "Settled over" is `settledOver`'s rule for one id (`recall/standing.ts#headOf`).
- Decided by the coordinator at the review of #408, 2026-10-11, lightly held: recall's
  `Earlier (now [id])` label (footnotes, "Came to mind", the wake's lanes, the deliberate
  path's `standing`) names `headOf`'s memory too, so a footnote and a neighbour never name
  different ones on a chain A→B→C (both say C, where the footnote said B). A memory a newer
  pair names as what holds, or whose holder is gone with nothing live after it, no longer
  reads `Earlier`. Accepted as built: a guest writer's neighbour whose head is confidential
  is left out; a neighbour whose head ranks below it is listed marked beside its head.

### Decided by the Group 2 builder, 2026-10-11, lightly held (one model for "this replaces that", items 12–13)

- Decided by the Group 2 builder, 2026-10-11, lightly held: a slot proposal is an UNSETTLED pair
  with source `slot`, a trail row `propose` naming which holds, and the older's `fade` × 0.8. It is
  labelled "may be out of date"; the head-wins rule waits for a confirmation. Why: the arithmetic
  is not a reader (04 D1); unsettled rows already have every surface (the label, the dream's settle,
  the undo), and a wrong proposal then costs a fifth of one memory's height for a night.
- Decided by the Group 2 builder, 2026-10-11, lightly held: the rule is cos ≥ 0.85, or cos ≥ 0.80
  with status lineage (`planned` → `done`, not `proposed` / `asked`) or with the two titles at ≥ 0.85
  (a third arm beyond the brief). Same kind, same `about`, both authored, within 7 lived days, this
  session's writes first, the nearest; never a dated memory, a reading or world memory, one already
  settled over, one already waiting as the older of a proposal, the core, the protected, or a pair
  that was ever a pair. Why: the bench's "1250 followers" / "close to 1300" is 0.82 by its whole
  text and 0.89 by its titles; on the 10-11 copy the title arm added 2 proposals to 27; three
  dated reminders for one event read 0.94 to each other.
- Decided by the Group 2 builder, 2026-10-11, lightly held: the dream answers a proposal with its
  own action, `slot {pair, same: true | false}`, at most 4 a night beside the ranked "on my mind"
  items; false withdraws it (cut put back, never proposed again). Why: `settle open` would label two
  different things "disagrees with".
- Decided by the Group 2 builder, 2026-10-11, lightly held: whatever answers a proposal (a writer's,
  a dream's or the owner's settle, or a settle that closes it) lifts the provisional cut first,
  recorded so an undo puts it back with the pair unsettled. Why: confirmed lands at `CHANGED_FADE`,
  not 0.4, and every step is exact.
- Decided by the Group 2 builder, 2026-10-11, lightly held: in ambient recall a settled-over memory
  is inhibited when its head is admitted or already in the session, and one reached alone is shown
  as its head (the earlier's numbers, the head's words and label), out of the turn's background.
  This revises "standing is a label, never a filter" for ambient recall only (recall CONTRACT §6b).
  Why: on 10-10 earlier versions were shown 55 times after their settle, 51 without their head.
- Decided by the Group 2 builder, 2026-10-11, lightly held: "the latest feeling" is the strongest of
  the newest moment any were recorded at, whoever's; the core's fast lane keeps the strongest felt
  at the time (`feeling_peak_lived`); a dream's feeling-now is capped at the latest. Why: a write's
  feelings share one moment (owner 0.55 and self 0.35 on mem_6d48b8537011), and the fast lane is
  about what was felt then. On the 10-11 copy 12 of 113 felt memories read lower, none higher, no
  band moved; mem_6d48b8537011 reads 0.35 (its dream's later feeling), strength 0.414 → 0.397.
- Decided by the Group 2 builder, 2026-10-11, lightly held: the guards (a reading or world memory
  under a work or owner fact comes back `open`; a pending dated memory refuses a settle that would
  move it) apply to every settler but the owner. Why: the owner's door has no limits elsewhere
  either (guards loose-first).
  Revised by the Group 2b builder, 2026-10-11, lightly held: a settle over a pending dated
  memory now carries the reminder to the holder (undone with the settle) and refuses only
  when the holder has a date of its own; a `done` holder spends it (decisions.d,
  feat-group2b-one-door).
- Decided by the Group 2 builder, 2026-10-11, lightly held: the store's guard bar (p60 of 2000
  random live pairs, floor 0.30) is measured at the first guarded write of a lived day and kept in
  `meta` with its day, not in a sleep phase. Why: no new phase, marker or budget for a few hundred
  vector reads a day. On the 10-11 copy it reads 0.47; 0 of 101 declared pairs would be held.
- Decided by the Group 2 builder, 2026-10-11, lightly held: every settle that moves a memory closes
  the unsettled pairs on it (an `open` one only when asked); an unsettled flag is asked again once,
  at full weight, 7 lived days after it was raised.
- Decided by the #420 reviewer, 2026-10-11, lightly held: the night's "to confirm" proposals are
  the least shown first, then the oldest, and a proposal one of whose two memories is gone is
  withdrawn (its cut put back) before the dream reads. Why: oldest-first with a fixed 4 let a dream
  that passed the first four by keep the rest waiting for good, and a proposal whose newer memory
  was forgotten or merged away was never shown again, so its older kept the ×0.8 forever. Nothing
  expires either way.
- Decided by the #420 reviewer, 2026-10-11, lightly held: a dump's earlier entries are never read
  as an earlier state of a later entry of the same call. Why: the same moment's words, the rule the
  write's neighbours already keep (review of #284, M1).
- Decided by the #420 reviewer, 2026-10-11, lightly held: only a feeling recorded LATER (a
  feeling-now, a dream's, a reflection's) is read as how a memory sits now; with none, the
  strongest felt at the time. Why: a dream's merge carries each original's feelings at their own
  moments, so "the newest moment" read a strongly felt memory merged with a mildly felt near-copy
  as mild, with nothing said about it. Same result on the 10-11 copy (mem_6d48b8537011 reads 0.35).
- Checked by the #420 reviewer, 2026-10-11: the title arm. On a copy of the owner's store (20 lived
  days, the rule as it would read at each write), 3 proposals came from the title arm alone, all
  three right on a hand-read (two of them the writer had settled `changed` itself). Kept; n is
  small, so the CHECK-AFTER hand-read should keep the title ones apart.

### Decided by the onboarding-core builder, 2026-10-11, lightly held (the first meeting)

- **Where the state lives: the store's `meta`, and absent means done.** Why: the hook, the
  MCP server and the dashboard all read the store; the config is rewritten by
  `install --force` with its own carry-forward rules. Only `install` writes `not_started`,
  and only into a store it just created, so every existing store (Mike's included) reads
  `done` with nothing written to it. `start-fresh`'s blank store gets the meeting (the
  coordinator's ask) but not the dreaming change; `--undo` brings the parked store's own
  state back with it. (`core/onboarding.ts`)
- **Dreaming `auto` is written explicitly into a new install's store; the fallback stays
  `ask`.** Why: changing `DREAMING_DEFAULT` would flip every upgraded store that never set
  one. The once-only reset of an explicit `auto` is marked done at the same time, or the
  first hook would set it back to `ask`.
- **Core writes the answers, through `remember`'s own door.** `meet {step, answer}` stores
  one memory per answer (about the owner, said by the owner, "(from onboarding)"), rather
  than Claude calling `remember` itself. Why: the marks are mechanized, a skipped question
  is never sent, and the second session's line has the id of the work answer. A name is a
  memory too, never the identity core: no tool writes an entity (mcp CONTRACT §4). So a
  plugin install, which never asks the name at install, still has no identity core; that is
  a core ask, not built here.
- **Where memory is on is one `/` entry in `scopes.json`:** on for every folder, or off with
  this folder on. Why: there is no install-wide default today, `/` already matches every
  absolute path with longest prefix winning, so existing entries keep theirs; and with
  either answer no folder is `unset`, so the first-launch question never fires again. It
  also waits while the meeting is pending (the meeting asks it instead); after `skipped` it
  is back. A Claude Desktop chat has no folder, so the script leaves the question out.
- **No double offer, with or without the mod:** the wake's line is carried whenever an
  offer is due (at most once a calendar day, never twice in one session, none once done or
  skipped), and its words make the mod's "say hello and introduce yourself" prompt the same
  offer. A `meet` read marks `offered`; an `offered` from an earlier day becomes `later`, so
  the mod sees a meeting it may offer again. Why: the install route is not the same as the
  mod being present, and someone who types before the session goes idle can only be offered
  it by the model, from a line already in its context.
- **Each style bundle is its four preferences plus one shared honest-pushback line**, so
  every bundle, the character's included, keeps the baseline in so many words. Bundle
  memories are marked `about: owner`, so like any preference about the owner they could
  become core through ordinary recurrence; nothing writes them there.
- **The second session's memory rides beside the wake, once**, in the first session after
  the one that finished the meeting: the work answer, else something loved, else the rest.

### Decided by the context-trims builder, 2026-10-11, lightly held (what a tool description serves)

- Decided by the context-trims builder, 2026-10-11, lightly held; needs the bench A/B before
  merge: `remember`, `session_end`, `recall` and `chapter` serve only the guarantees that
  change what the model writes or calls (or name a refusal it can avoid); the rest became
  each tool's `engine` rows, audited and not served (mcp CONTRACT §5 G2). session_end
  20.9 → 15.5 KB as loaded, remember 19.6 → 16.2, recall 7.9 → 6.3, chapter 4.4 → 3.8. Why:
  `session_end` and `chapter` load at every end-of-session ask, and what was cut is said on a
  field the host serves whole, in the result, or in a refusal that names itself. The one
  most likely to move a number: `remember` no longer says "you may score the three
  dimensions yourself" (the fields `relevance`, `emotional`, `predictive` still do;
  `session_end`'s pinned claim still says it).
- Decided by the context-trims builder, 2026-10-11, lightly held: a RESUMED session gets a
  short wake (the wake above still holds; what changed since) instead of a second full one,
  when it resumes on the day it started. A compaction keeps the full wake: it summarizes the
  first one away. Why: on resume the host replays the first wake, so the model read both.

### Decided by the uninstall-delete builder, 2026-10-11, lightly held (`uninstall` offers to delete)

- Decided by the uninstall-delete builder, 2026-10-11, lightly held: plain `uninstall`
  puts the delete question only to a person (a console with a prompt), and `--yes` keeps
  without asking, as `--keep-memories` does. Why: `--yes`'s sentence is "take the ordinary
  answer to every question", and the ordinary answer here is keep. Nothing deletes without a
  yes and the typed phrase.
- Decided by the uninstall-delete builder, 2026-10-11, lightly held: the question is not put
  at all while something holds the store (a process of ours, a session whose hooks ran in
  the last ten minutes, a fresh memory-server record); the screen says what holds it instead.
  `--delete-memories` refuses on the same evidence now (it used to check the process list
  only). Why: a question whose yes is always refused should not be asked; `rollback`'s
  holder check sees a session the process list can miss. Everything is looked at again
  after the phrase, and anything changed is a refusal.
- Decided by the uninstall-delete builder, 2026-10-11, lightly held: `uninstall
  --delete-memories --json` reads the typed phrase from standard input, a scripted door
  `uninstall.ts` used to say must never exist. Why: the plugin has no terminal to type into,
  and Mike's decision was that every uninstall path offers the delete. This process can't
  tell who wrote its stdin, so the guarantee that the PERSON typed it sits with the caller:
  the plugin command collects the phrase in its own UI and the model never supplies it.
  Without `--json`, `--delete-memories` from a pipe still refuses.
  **Reversed by the coordinator, 2026-10-11, lightly held: there is no stdin door.**
  `--delete-memories --json` is refused; `uninstall --json` is the plan only (read-only),
  and `--keep-memories --json` uninstalls and keeps. Why: nothing can tell who wrote stdin,
  so a model could type the phrase, which breaks the rule that the typed word comes from
  the person. And a live Claude Code session always holds the store, so the plugin's
  command could not delete from inside one anyway. `/counterparts:uninstall` shows the plan
  in-session and sends the person to a terminal, with Claude Code closed, to run the
  interactive `uninstall` (the plan's `terminalArgs`).
- Decided by the uninstall-delete builder, 2026-10-11, lightly held: "all memories and
  related data" is the existing delete list (the store, its default snapshots folder, the
  configuration and scopes, and our own leftovers such as a `start-fresh` parked store), and
  no more. A snapshots folder the configuration points somewhere else is named as kept,
  and so is Claude Code's own directory. Why: no widening of what a delete reaches without
  someone deciding it.

### Decided by the Group 4 builder, 2026-10-11, lightly held (association; revisit after ~5 lived days)

- Decided by the Group 4 builder, 2026-10-11, lightly held: a new memory's write-time links
  go to what its session was shown in the last 3 recall turns (`WRITE_LINK_TURNS`) and what
  a deliberate question showed within 15 minutes of the write (`WRITE_LINK_ASKED_MS`), the
  asked ones first, at most 4 per memory (`WRITE_LINK_MAX`), at 0.05 through
  `Associate.propose` (room-only, never evicting). The window is the session's recent turns
  at the boundary, which is the write's own turn for a mid-session memory and the session's
  last turns for a write-up at its close. Why: Mike's "it should, like a brain, unless
  there's a big downside", weak because footnotes are often noise; propose rather than the
  Hebbian buffer, so a faint footnote-grade trail never pushes out what use learned. A
  memory shown only through an ambiguous handle (`trains: false`) and a handoff are not "in
  mind". **Measured on the 10-11 copy, fast-forwarded 7 lived days:** 904 new write-time
  trails, 793 (88%) of them from memories written in a session-end batch; a hand-read of 20
  was 1 right, 3 unsure, 16 noise — the 4 from timed (mid-session) writes 1/1/2, the 16 from
  batches 0/2/14. Kept as built for now because it is harmless at 0.05 (0 pointer candidates
  at the current threshold; a 0.05 link passes 0.6% of its node). The lever if it stays
  noisy: the write's own turn and a deliberate question near it only, no recent-turns window
  for a batch's memories. (Tightened before merge: see the #423 reviewer's bullets below.)
- Decided by the Group 4 builder, 2026-10-11, lightly held (review 06 C4, the ants rule): no
  "a reinforced edge fades slower" in this build, and no column. It could be computed from what
  is stored — a stability that grows with the edge's own weight above one co-use (e.g. linear
  decay at `HEBB_RATE / S_EDGE` per lived day above 0.1, exponential below; an autonomous curve,
  so decay realized at flush stays exact) — but weight is not use: a legacy 0.3 dream link would
  fade like a thrice-used one, and those 174 rows are the hubs review 06 flagged. And there is
  nothing for it to act on yet: the store has never co-used one pair twice (review 06 §3). (The
  fast-forward could not say how many new trails use would reinforce: a forward simulation has
  no awake use.) The honest version is the v14 column,
  to batch with other v14 needs: `edges.reinforced INTEGER NOT NULL DEFAULT 0` (one `ALTER
  TABLE … ADD COLUMN`, no backfill, ~1–2 bytes a row: ~6 KB at today's ~5.6k rows, ~60 KB at
  30k), bumped in `planFlush` when a Hebbian delta lands on a row that already conducts (not by
  `propose`, not by `retargetOnSupersede`, which takes the max), read in `edgeWeightAt` as
  `S = S_EDGE · (1 + reinforced)`, carried by `restoreEdge` and the retarget, and
  `EdgeRow`/`EdgeInput` gain the field. Size M with tests; `edges.source` (C4) rides the same
  bump if the dashboard needs it — `deposited`, `atWrite` and `replayLinks` made it honest from
  event JSON without one.
- Decided by the Group 4 builder, 2026-10-11, lightly held (review 06 C7, D3): the recall
  pointer threshold stays at 0.05. On the fast-forward: 0 of 635 recorded turns would have had a
  pointer candidate at 0.05 (no edge reached 0.4; edges ≥ 0.16 fell from 172 to 88 as the legacy
  0.3 links fade); at 0.0125 (variant b1) 216 would, 174 of them through links that existed
  before (mostly those legacy links) and 42 through the new 0.05 trails the hand-read calls
  mostly noise. Revisit after ~5 real lived days of deposit, and only after the write-time
  window is tightened (CHECK-AFTER, Group 4).
- Decided by the Group 4 builder, 2026-10-11, lightly held: the replay's deposit is laid when
  a dream OPENS (`Dreams#begin`, its bundle composed), not when it wakes, between each new
  memory and the older neighbours shown beside it (not the mixing or look-back), at 0.05; and
  it is not one of the dream's changes, so a dream's undo leaves it. Why: the replay is the
  bundle being put in front of the dreamer, which happens whether or not the dreamer then
  changes anything (a headless run that fails still replayed); the dreamer chose none of
  these pairs, and a 0.05 trail nothing confirms is gone in about 27 lived days.
- Decided by the Group 4 builder, 2026-10-11, lightly held: the sweep of rows with an end
  archived for good covers `episode-regrown` and `dream-merge` only, not `corrected` (review
  06 C3 listed all three); and a dream's undo of a merge now carries the merged memory's
  links back to each original it restores. Why: a corrected settle does not carry the
  corrected memory's links to the one that holds (only a supersede retargets), and the
  owner can undo a settle, which un-archives it — sweeping would drop links that were never
  carried. `corrected` joins the list once its settle carries links (the reconsolidation
  lane's). `corrected` was 24 of the 1,159 inert rows on 10-10.
  Revised by the Group 2b builder, 2026-10-11, lightly held: done — a `corrected` settle
  carries the links through the one door and its undo carries them back, older ones were
  carried once at open, and `corrected` is in `TERMINAL_ARCHIVE_REASONS`, swept once that
  pass has latched (decisions.d, feat-group2b-one-door).
- Decided by the Group 4 builder, 2026-10-11, lightly held (review 06 D7): Association's
  light is amber when links were laid in the last 7 lived days and none reached recall (no
  pointer shown, no hop-lifted candidate shown), green only when one did. "Links laid"
  counts pairs that landed (`deposited`), not rows written. Why: the old light was green on
  a count of rewrites while links put one memory in front of the model in 19 days. Expect
  the owner's dashboard to show Association amber after this ships, until a link reaches
  recall; the demo store is amber too. Rows from before have no `deposited`, so the count
  starts at zero. (Not on a new store: see the #423 reviewer's bullet below.)
- Decided by the coordinator, 2026-10-11, lightly held, and built by the #423 reviewer: a
  memory written in a session's write-up batch or by the night catch-up gets no recent-turns
  window; one written mid-session keeps what was in mind. Why: Mike's rule was "like a brain,
  unless there's a big downside", and 14 of 14 batch links hand-read as noise: what was in
  mind at a session's end is not what each memory written then was about.
- Decided by the #423 reviewer, 2026-10-11, lightly held: "mid-session" is the jot door (the
  note tool), read from the memory's `gate.deposit` row; a session-end write-up, a catch-up's
  write-up and a chapter copy (no deposit row) get no window, and so does any memory whose row
  is missing. The window is the write's own turn only (`WRITE_LINK_TURNS` 3 → 1). Why:
  hand-read on the 10-11 copy, a jot's own-turn showings were 7 right, 4 unsure, 9 noise of 20,
  the two turns before it 2, 4, 14. The door, not timing, because timing (60 s apart) splits
  the jots nearly in half and would give a lone session-end memory a window; chapter copies
  were getting write-time links too.
- Decided by the #423 reviewer, 2026-10-11, lightly held, against the coordinator's decision
  that a batch memory may still link to a deliberate question's answer within 15 minutes: no
  deliberate-question links for any door (`WRITE_LINK_ASKED_MS` 0, off; one number restores
  it). Why: those answers hand-read 0 right of 20 for session-end memories and 0 of 20 for
  jots, and 0 of 20 again counting only questions asked before the write and no chapter
  copies; they are broad answers ("where did we leave off"), not what the memory was about.
  So a batch memory gets nothing, a subset of the coordinator's rule for the same reason.
  After both changes the fast-forward lays 95 write-time trails a week, not 904; a hand-read of
  40 of them was 5 right, 6 unsure, 29 noise. The bench clinic pair: write-time links never
  fired on the bench store (every write a session-end write-up, no recall while it was
  written), before or after; one dream's replay links it. The hermetic clinic test now writes
  through the jot door.
- Decided by the #423 reviewer, 2026-10-11, lightly held: Association goes amber for links
  laid with none reaching recall only once the store has lived 14 days and laid 20 links in
  the 7-lived-day window (`vitalAfter`); before that it is waiting on the dashboard ("No
  memory a link brought to mind yet; that takes a few weeks of use") and working in the
  console. Why: Mike's yardstick for an amber is whether a regular user would know what to do
  with it, and a new user can do nothing about this one; two weeks is the window and one
  before it for trails to be laid and used, 20 is about three links a lived day. Mike's own
  store passes both and will show it amber, which is honest.
- Decided by the #423 reviewer, 2026-10-11, lightly held: the archived-for-good sweep takes an
  end only once it was archived 10 minutes ago (`TERMINAL_ARCHIVE_GRACE_MS`). Why: a regrown
  copy is archived and then retargeted, a merge's original folded in and then retargeted, and
  another process's boundary flushing between the two steps would have deleted rows not yet
  carried.
- Decided by the #423 reviewer, 2026-10-11, lightly held: a dream's replay links count as laid
  even after the dream is undone, and the undo still leaves them. Why: the undo takes back
  what the dreamer chose; the replay is the bundle having been shown, which happened, and a
  0.05 trail nothing uses fades in about 27 lived days. The count now matches the graph.
- Decided by the #423 reviewer, 2026-10-11, lightly held: one drewOn's pair set holds at most
  `DREW_ON_MAX_PER_BOUNDARY` (3) members. Why: a memory refused only for its day cadence joins
  without spending a credit slot, so twenty named memories opened earlier sent 190 full-rate
  pairs.

### Decided by the small-fixes builder, 2026-10-11, lightly held (fix/small-1011c)

- Decided by the small-fixes builder, 2026-10-11, lightly held: `--reflected-feeling off`
  reaches a `remember` `remark` only when the call comes from a night run's child (its
  server's environment carries `COUNTERPARTS_NIGHT_CHILD` or `COUNTERPARTS_NIGHT_RUN`); there it refuses a move to me, us or owner
  (`door-closed-work-or-world-only`, the reflection's reason) and leaves work or world open.
  An awake session's re-mark is not affected. Why: the switch closes the core to the night's
  own judgment, and a night child that was allowed `remember` would otherwise be a second
  door around it; an awake session is in front of its person, which the switch was not about.
- Decided by the small-fixes builder, 2026-10-11, lightly held: where the guard for an
  `updates` naming a REMOVED memory sits. The lane's brief asked that the new memory be
  stored unlinked, as for an id that doesn't exist; the guard is at resolution
  (`counterpart.ts#resolveUpdatesFor` treats a removed id as unresolved, so content matching
  runs as the fallback), with a second lock in `revision.ts#applyRevision`, which answers
  `target-unresolvable` for a removed target rather than reaching the confirmation branch.
  Why: the store resolves a removed id as itself on purpose (so a reader can say "removed"),
  so the write path has to say that a removed memory is not one anything can update.
- Decided by the #422 reviewer, 2026-10-11, lightly held: a named-but-REMOVED `updates`
  target does NOT fall back to content matching (`remember/updates.ts`, reason
  `DECLARED_REMOVED`), and the reply says `target-removed` whether or not a `how` was sent.
  Why: with the fallback, a live near-copy of the removed memory was linked (and, with
  `how: changed`, settled over) in its place, measured in `test/mcp.test.ts`; the writer
  named one memory, the owner removed it on purpose, and a dangling address's fallback is
  for ids that were never right, not for this.

### Decided by the #416 reviewer, 2026-10-11, lightly held (the sidebar's speak-first and three-way switch)

- Decided by the #416 reviewer, 2026-10-11, lightly held: a slash command the person runs
  stands a speak-first down that hasn't gone out, but doesn't drop one already queued; only a
  prompt of their own does. Why: the drop assumes core offers the meeting in the reply to
  that prompt, and a command like `/model` gets no reply, so dropping lost the introduction
  with the once-per-store mark already spent.
- Decided by the #416 reviewer, 2026-10-11, lightly held: in a session started in a
  reads-only (observer) folder, the switch's confirmed on, pause or off names the
  `counterparts scope <folder> --on|--pause|--off` command when the server stands the
  `scope` tool down, instead of "The memory server said: This session is an observer…". The
  confirm is still offered there. Why: the sidebar can't tell that launch from a folder set
  reads-only mid-session (where the tool does write), and a dead end without the way out
  read as broken.

### Decided by the onboarding-core reviewer, 2026-10-11, lightly held (the first meeting's offers)

- Decided by the onboarding-core reviewer, 2026-10-11, lightly held: the wake's offer line
  is carried on at most three calendar days (`MEET_OFFER_DAYS`), then stops, whatever the
  state; a `meet` read counts as that day's offer. The state stays `not_started` or
  `later`, so the mod's "Meet your counterpart" and a person asking to meet still work.
  Why: without a cap, a person who never answered (or said "later" once) was offered the
  meeting every day for ever.
- Decided by the onboarding-core reviewer, 2026-10-11, lightly held: a bare `meet` read
  leaves `skipped` as it is (it used to move it to `offered`, and the next day to `later`,
  which re-armed the daily offer). Why: `skipped` is "don't ask again"; the steps still
  record and `done` still finishes it.
- Decided by the onboarding-core reviewer, 2026-10-11, lightly held: the script asks where
  memory is on only while the scope registry has no entries. Why: the registry lives beside
  the configuration, not in the store, so a `start-fresh` store's meeting that wrote `/` off
  outlived `start-fresh --undo` and turned off every folder the owner had never named; and
  anyone who has set a folder has answered the question their own way.
- Decided by the onboarding-core reviewer, 2026-10-11, lightly held: the wake's marker says
  the settled state: an `offered` from an earlier day is moved to `later` before the marker
  is written. Why: the marker said `offered` while the line beside it said "last time they
  said later", and the mod keeps what the marker says.
- Decided by the onboarding-core reviewer, 2026-10-11, lightly held: `meet` refuses by name
  in a nightly-run child, and the second session's line skips an answer marked confidential
  since. Why: nobody is in the night run to meet, and the line rides into wakes that are not
  the owner's own (a Desktop chat).

### Decided by the meet-command reviewer, 2026-10-11, lightly held (`/counterparts:meet` on a met store)

- Decided by the #424 reviewer, 2026-10-11, lightly held: when the meeting is already
  `done`, `/counterparts:meet` says so in one line and offers to go through it again,
  following the core's script if they say yes, instead of only offering to talk about
  something else. Why: the core's script already supports a second pass ("You have met
  already. If they asked to go through it again, follow the steps below"), and the command
  should follow the script, not override it; someone who typed the command is asking.

### Decided by the night-owed builder, 2026-10-11, lightly held (the night starts when write-ups are owed)

- Decided by the night-owed builder, 2026-10-11, lightly held: under dreaming `auto`, the
  night starts for its catch-up alone when the dream is not due for `too-little-new` or
  `first-day` and sessions from an earlier calendar day owe a write-up. Why: random-06's
  decision (coordinator agreed); with the pointer retired under `auto`, a first day with
  fewer than three memories was otherwise never written up.
- Decided by the night-owed builder, 2026-10-11, lightly held: "an earlier day" means the
  session's last activity (its last words, a boundary or its end, `HeldSession.clockFrom`)
  falls before today's date in the store's zone. "Owed" is the catch-up's own reading
  (`catchUpOwing`), not a new one. Why: one notion of owed; a session that ran past midnight
  waits one more day, which loses nothing because a stretch owes for 14 days of use.
- Decided by the night-owed builder, 2026-10-11, lightly held: the catch-up-only run claims
  the day through the same `dream_asks` latch as a dream (`launched`), and only on a day with
  no row yet. Why: racing sessions start one run, and the once-a-day claim stays one claim.
  The effect: if the catch-up's write-ups bring the queue to three, the ordinary relaunch
  dreams later that day, after the 30-minute quiet window, counted as a relaunch.
- Decided by the night-owed builder, 2026-10-11, lightly held: the catch-up-only run says
  nothing at its start and hands nothing back at the next prompt. Why: "the mechanism does
  the work, it doesn't remind". Doctor and `counterparts dream --list` show it as "the
  catch-up alone".
- Decided by the night-owed builder, 2026-10-11, lightly held: its row is `done`, with the
  dream's and the reflection's children `skipped: too-little-new` (or `first-day`), whenever
  the catch-up did what it could. It is `could-not-start` / `timed-out` / `failed`, with
  `detail: catch-up`, when the catch-up child could not start, was stopped, or failed. No ask
  follows a catch-up that could not start while the dream is not due, because there is no
  dream to ask about. Why: doctor
  must not show a failed dream for a dream that was never due, and must still go amber when
  `claude -p` itself is broken.
- Decided by the #426 reviewer, 2026-10-11, lightly held: a catch-up-only run that could not
  start, failed, timed out or went lost does not make the dream "fall back" to an ask
  (`Dreams#fellBack` ignores a row whose children say `skipped: <reason>`, and the hook
  writes those children on the run's very first row). If the dream comes due later that
  day, the ordinary relaunch starts the whole night headless after the 30-minute quiet
  window, counted against `RELAUNCHES_PER_DAY`; only if that run itself cannot start does
  the existing `auto` fallback ask, as it did before this change. Why: under `auto` nothing
  should turn into an ask because of a run that never tried to dream; the builder's version
  showed "I couldn't start dreaming on my own" for a catch-up that failed.
- Decided by the #426 reviewer, 2026-10-11, lightly held (replaces the builder's "no
  per-day memo"): the "is anything owed from an earlier day" read is remembered per
  calendar day. When it reads a real zero, the date goes in meta
  (`night.nothing-owed-before`) and the rest of that day's prompts skip the read; a read
  that fails is not remembered. Why: measured on a copy of the author's store (10-11
  snapshot plus its spans), the read costs ~29 ms, at every prompt of an `auto` day whose
  dream isn't due and whose day is unclaimed, on the latency-sensitive UserPromptSubmit
  hook; with the memo it is a meta read (<0.01 ms). Within a day the earlier days' debt
  only shrinks, so nothing is missed; a late capture that makes an earlier session owe
  waits until the next day, well inside the 14 days of use before a stretch lapses.

### Decided by the uninstall-plugin-order builder, 2026-10-11, lightly held (removing the plugin after a terminal delete)

- Decided by the uninstall-plugin-order builder, 2026-10-11, lightly held: after a delete or a
  park, `counterparts uninstall` tells a plugin install to run `claude plugin uninstall <id>`
  at that terminal before Claude Code opens again, instead of `/plugin → Installed →
  counterparts → Uninstall`. Why: measured with Claude Code 2.1.296 in a throwaway home,
  reopening with the plugin enabled runs its SessionStart (and first run) at startup, before
  anybody can reach /plugin, and re-creates `~/.counterparts`; removing it from the terminal,
  or disabling it before the delete, leaves nothing. The person is already at a terminal with
  Claude Code closed, so the terminal command is the one that fits.
- Decided by the uninstall-plugin-order builder, 2026-10-11, lightly held: the id comes from
  Claude Code's `installed_plugins.json`, else `counterparts@counterparts` (the published one).
  An npm install whose host also has the plugin enabled is told to remove it too, because once
  the npm hooks are out the plugin stops standing down. The keep arm's closing line is
  unchanged: its configuration stays, so no first run fires. Why: the hazard is a missing
  configuration, and only delete and park remove it.
- Decided by the #425 reviewer, 2026-10-11, lightly held: the printed removal names the scope.
  Claude Code's `installed_plugins.json` records each install's `scope` and, for a project or
  local one, its `projectPath`, so a project or local install is told
  `cd <folder> && claude plugin uninstall <id> --scope <scope>` (or "in the project it was
  installed for" when no folder is recorded); a user install keeps the plain command. Only the
  first record is read. Why: `claude plugin uninstall` defaults to user scope and fails for a
  project install, and the scope was cheap to know.
- Decided by the #425 reviewer, 2026-10-11, lightly held: `commands/uninstall.md` step 5 offers
  both removals (the terminal command the closing line names, or /plugin → Uninstall after
  reopening), keeping #421's disable-first order. Why: the terminal and the command now say the
  same thing; either route is safe there because step 1 disabled the plugin.

### Decided by the Group 2b builder, 2026-10-11, lightly held (one door for "A over B", item 12)

- Decided by the Group 2b builder, 2026-10-11, lightly held: one function,
  `reconsolidation.ts#supersede`, writes every "A over B" — a settle, a write's `updates`, a
  slot confirmed, a dream merge (source `dream-merge`), the core's pressure crossing
  (`pressure`), a fulfilled plan (`fulfilled`), a moved reminder (`reminder-moved`); Group 3's
  folds call it with source `fold` (factor ×0.5 is already its default). `settle` keeps the
  guards and goes through it. Why: review 10 counted seven paths with three effects; one door
  gives one record (pair, trail, event with its source) and one undo.
- Decided by random-06, 2026-10-11, lightly held (replacing the builder's "replaces" axis): no
  effect axis besides `how` — a "replaces" was a fourth relation in disguise. A dream MERGE is
  a real `changed`: each original fades ×0.5 (the existing changed fade), STAYS LIVE and is
  labelled earlier under the merged memory; head-wins hides it in ambient recall and facts mode
  folds it under the head; its own curve archives it at the floor, the ordinary way. The
  PRESSURE CROSSING is the same (changed, fade, live, labelled), and the FULFILLED lane is
  `changed` plus the core path (the plan leaves the core in one step), not an archive. Merges
  are not `corrected` (the originals were not wrong). Cost accepted: more live near-copies for
  a couple of weeks, hidden from ambient. Old merges (archived originals from before this
  build) stay as they are, with no backfill, and undo the old way.
- Decided by the #427 reviewer, 2026-10-11, lightly held (following random-06's ruling): a core
  memory a change reaches through the door — only the core path's doors get there, since
  `settle` refuses the core — LEAVES THE CORE in the settle's own transaction: the promotion
  flag off, its fading restarted today (as the owner's demotion restarts it), the band column
  set from its physics; then the ×0.5 cut lands (a core memory has nothing to cut otherwise).
  The trail keeps its band, band day, last use and flag, so an undo puts it back exactly, and
  the `contradiction.settled` event says `leftCore`. No `core_events` "demoted" row and no
  `band.demoted` event: those are the owner's demotion, sticky against re-promotion, and
  `fired.ts` reads `band.demoted` as the owner's door.
- Decided by the #427 reviewer, 2026-10-11, lightly held: a merge carries what
  `supersedeInto` used to — each original's returns, and its about mark and writer's fields
  where the merged memory has none (`Store#carryInto`) — and its links
  (`retargetOnSupersede`, already a copy) onto the merged memory, which is still at least as
  durable and connected as what it was made from; the originals keep their own. An original that already has a head is refused
  (`earlier-is-not-merged`: merge the one that holds), so a live earlier version is not merged
  into a copy of a copy. A merge's door row writes no "how does it sit now" invitation (its
  feelings travelled to the merged memory), nor does a moved reminder's.
- Decided by the Group 2b builder, 2026-10-11, lightly held (unchanged by the ruling, simpler
  now): the owner may undo one original's pair of a merge (`counterparts settle --undo`); that
  original's strength comes back and it stands beside the merged memory, which keeps standing
  for the rest. The dream's own undo undoes every original's pair and archives the merged
  memory, as before.
- Decided by the Group 2b builder, 2026-10-11, lightly held (confirmed by random-06): a settle
  over a memory with a reminder still to come CARRIES the reminder to the holder (date, plain
  or quiet, how often; `reminderMovedTo` / `reminderFrom`), and its undo carries it back; it
  refuses only when the holder has a date of its own (the owner's settle goes through as
  before). A holder whose status is `done` SPENDS it. Why: the brief's "the door calls
  carryReminder"; a `done` memory firing on the old date would be wrong.
- Decided by the #427 reviewer, 2026-10-11, lightly held: "spent" removes the date from the
  earlier memory (`reminderSpentBy` names the `done` holder; the date stays in its version
  row; an undo puts it back). Why: `prospective/` skips only a forwarded row, so a live
  settled-over memory keeps firing on its date — with the archive gone, a fulfilled dated plan
  would have reminded on a trip already made. The same for a WRITE: a `done` write that
  `updates` a dated memory and sends no date no longer inherits the date (it used to, and fired
  on it); and the fast lane counts a date that very write just took off the plan, which the
  deposit moves before the revision runs (otherwise a dated core plan with no status never took
  the fast lane).
- Decided by the Group 2b builder, 2026-10-11, lightly held: a moved reminder's old memory gets
  its row AFTER the write's declared revision, and only when the two are not already a pair.
  Why: written first, it would make the writer's own settle refuse `already-settled` and lose
  its `how` and words. The older remnants get theirs once, at open, latched in meta
  (`reconsolidation.remindersMoved`) like the regrown-links pass, not in a sleep phase: a move
  writes its own row from now on, so the pass never has new work. On the 10-11 copy, 9 live
  remnants: 7 already had the writer's pair; 2 (both at fade 1.0) got one.
- Decided by the Group 2b builder, 2026-10-11, lightly held (review 10 C4): an AUTHORED
  `changed` or `corrected` at a core memory credits force `max(raw, F_DAY_CAP_SLOW)`; a slow
  kind is still capped at 0.35, so the three-lived-day property is unchanged; a swept
  declaration keeps its own force. `corrected` is included beside the brief's `changed`: it
  is the stronger declaration.
- Decided by the Group 2b builder, 2026-10-11, lightly held (review 10 C4; the effect revised by
  random-06's ruling above): the fast lane is read off the rows' own fields — the core memory
  has a status other than `done` or a date, and the memory updating it has status `done` —
  and the `done` memory holds over it `changed` (source `fulfilled`): the plan leaves the core,
  fades and is labelled earlier; no successor minted, no pressure; the `done` memory stays as
  it was, not core. Held as the brief wrote it: the real Han pair's core memory has no status
  and no date, so it stays on the slow path (three lived days of declared changes). Not
  widened to read the words. "Such items don't enter the core at all" is Group 3's.
- Decided by the #427 reviewer, 2026-10-11, lightly held: at a CORE memory the update guard no
  longer lets a status change ("planned", now "done") or a redate through unread. Why: the fast
  lane takes a core plan out of the core on one write, so an unrelated write that named the id
  with status `done` was enough; a plan and its "done" share their subject, so the real case
  still reads related (the Han-shaped test).
- Decided by the Group 2b builder, 2026-10-11, lightly held (the effect revised by random-06's
  ruling above): the pressure crossing mints its successor with `put` (the challenger's words,
  the core band, source `accommodation`, as before) and settles `changed` over the old memory
  through the door (pair source `pressure`, the pressure pair closed through it); the old one
  leaves the core, fades, stays live and is labelled earlier, and its links are copied to the
  successor. Undoing the crossing puts the old memory back in the core at full strength,
  withdraws the crossing's pair (the pressure pair it closed reopens) and archives the minted
  successor `pressure-undone`. Decided by the #427 reviewer, 2026-10-11, lightly held: that
  archive stays though the crossing archives nothing now — with the old memory back in the
  core, the successor (a core copy of the words weighed against it) would stand beside it as a
  second core memory. The old memory's accumulated pressure is left as it was.
- Decided by the Group 2b builder, 2026-10-11, lightly held: the schema belief and
  current-state arms (path 4) have no live producer — only `tools/demo/seed.ts` and tests
  reach `addBelief` / `addCurrentState` — and are left as they were, neither deleted nor
  routed. Why: routing a path nothing reaches needs a record-only mode for an
  already-superseded memory; deleting it takes schemas' contract, the demo and about ten test
  files, its own lane. Chapters' `episode-regrown` (path 6) stays out: it is one chapter's
  copy re-rendered, not one memory over another. Legacy link-only rows (path 7): 33 on the
  copy, 3 from day 9 and none since; not backfilled. Link-only is still produced by refusal
  fallbacks (a protected or entity target, a thread this session may not close, the crash
  sweep), each with its reason.
- Decided by the Group 2b builder, 2026-10-11, lightly held (review 10 C6): two honest cards,
  not one "Updating" card. Interference counts the detected doors (dream merges, dream flags,
  slot proposals, confirmed slots); Reconsolidation counts declared settles and pressure; a
  merge's rows count once, as the merge. Why: smaller than renaming a mechanism across the
  dashboard, the console, the sidebar copy and the "N of 11" count. Settles from before this
  build carry no source and count as declared. Every `contradiction.settled` event now says
  its `source`, and a write's says `howSent` (true: the writer sent `how`; false: defaulted
  to `changed`). Not in `gate.deposit`, whose field list is pinned.
- Decided by the Group 2b builder, 2026-10-11, lightly held: a `corrected` settle hands the
  old memory's links to the holder (`Associate.retargetOnSupersede`, injected, or the door's
  own when a caller has none) and its undo carries them back; `corrected` joins
  `TERMINAL_ARCHIVE_REASONS`. Settles from before were carried once at open
  (`associate.corrected.relink`, 10 on the copy), and the sweep leaves `corrected` and
  `episode-regrown` alone until their one-time pass has latched (review of #423).
- Decided by the Group 2b builder, 2026-10-11, lightly held (review of #420 (a)): settles are
  ordered by when they were RAISED (`flagged_day`, then the moment made), not when answered,
  in `headOf` and the wake's `settledOver` alike; and a settle over B no longer closes a slot
  proposal in which B is the newer — the question "B is the newer state of A" stays for the
  dream. Why: closing it lifted A's cut and stood A back up as current; with raised order a
  late confirmation cannot re-affirm B over a newer settle.
- Decided by the Group 2b builder, 2026-10-11, lightly held (review of #420 (b)): a proposal
  whose newer memory was replaced with a forwarding address is carried to what replaced it —
  withdrawn and proposed again between that one and the older, the cut the same — before the
  dream reads; one whose memory is simply gone is withdrawn as before. The carried proposal
  writes no second `contradiction.proposed` event (its trail row names the pair it came from),
  so Interference counts the question once. Noted by the #427 reviewer: since random-06's
  ruling no door forwards a memory, so this is for rows replaced the old way; a proposal whose
  newer memory is merged through the door simply stays open (both still stand), and once the
  dream confirms it the chain reads older → newer → merged.
- Decided by the Group 2b builder, 2026-10-11, lightly held (review of #420 (d)): with
  dreaming set to `off`, and only then, a proposal unanswered for 14 lived days
  (`SLOT_EXPIRY_DAYS`) is withdrawn and its cut put back, checked once a lived day at a write.
  Why: random-06's "no silent expiry while a dream can answer"; a cap on waiting proposals
  would stop the detector at the cap instead.
- Decided by the Group 2b builder, 2026-10-11, lightly held (review of #420 (c), (e)): a
  meaning-mode answer marks an earlier moment `earlier (now [id])` ("a later version" when the
  asker may not be shown it); a slot proposal's event says `bandDrop` when its provisional cut
  moves the older from semantic to episodic.
- Decided by the Group 2b builder, 2026-10-11, lightly held (left from #420): a head the turn
  reaches only through a link (a quiet pointer) counts as not reached, so it is brought in to
  stand for the earlier version the words reached and its pointer candidate is dropped. Why:
  the dedicated test showed both shown — a pointer sat in its own slots, apart from what the
  gate inhibits.
- Decided by the #427 reviewer, 2026-10-11, lightly held (knock-ons of random-06's ruling): a
  declaration (`updates`) at a merged original or a crossed core memory reaches the memory that
  holds now (`revision.ts#forwardedHead`), as `resolve` followed the forwarding address before;
  ordinary settles are left as they were (a write may still address an earlier version). A
  crossing's successor carries the old memory's about mark and the writer's fields its
  challenger did not send (`Store#carryInto`, without returns), as `supersede` did. A belief's
  story reads a crossing's `pressure` pair as its lineage step (`Schemas#crossedTo`). The
  store-wide feelings and nudge reads (`feelingsLive`, `feelingsSince`, `emotionCensus`,
  `traitsAll`, `traitCensus`) leave a merge's live originals out, since their feelings and
  nudges were copied onto the merged memory: a moment counted once, as when they were archived.
- Noted by the #427 reviewer, 2026-10-11: `headOf`'s rule (#408) lets a FRESH direct settle
  "B over A", made after "C over B", re-affirm B (it is raised later); a late answer to an
  older flag or proposal cannot (raised order; a flag is closed by the newer settle). Kept as
  found, with a test that records it; a design question, not changed here.
- Decided by the #427 reviewer, 2026-10-11, lightly held: a dream's undo leaves a merge alone
  (counted `kept`) when a later memory has settled over the merged memory, not only when it
  was archived or superseded: it stays live under the ruling, and undoing the merge would stand
  the originals as current beside the memory that holds now (review of #251's rule).

### Decided by the group 3 cards builder, 2026-10-11, lightly held (card birth from a name tally)

- Decided by the group 3 cards builder, 2026-10-11, lightly held: the nightly name tally runs
  as a sleep-cycle phase (`births`, right after `fade`, every lived day), not as a dream
  action. Why: it is mechanical (no model call), sleep already owns the fade's cadence and
  budget the same way, and parts B and C of group 3 change the dream.
- Decided by the group 3 cards builder, 2026-10-11, lightly held: the title door
  (`mentionFromProposal`) is removed; a write credits and revives cards but never births one.
  Why: an authored title is a sentence, so it refused every authored write, and keeping it
  beside the tally would mean two birth rules.
- Decided by the group 3 cards builder, 2026-10-11, lightly held: a name is a capitalized run
  of one to three words seen mid-sentence at least once, counted by `nameRegex`, refused when
  a quarter or more of its memories write it in another case in prose (code, paths,
  versions and domains don't count), and refused when it is a weekday or a month. Why:
  measured on a copy of the owner's store, project and people names sat at or under 0.20 and
  capitalized English words from 0.25 up; "never in lower case" refused the project's own
  name, because it is also its command.
- Decided by the group 3 cards builder, 2026-10-11, lightly held: a name said as part of a
  longer tallied name in at least half its memories gives way to the longer one. Why: a card
  for the piece would refuse the whole name as a near collision for good.
- Decided by the group 3 cards builder, 2026-10-11, lightly held: a tallied name's kind is
  person when the person-kind memories carrying it in their title are at least as many as
  the entity and place ones, then place, else entity; never skill. Why: counting every naming
  memory's kind made a model and an API into people.
- Decided by the group 3 cards builder, 2026-10-11, lightly held: at most 10 births a night
  (`sleep/tunables.ts` BUDGETS.births), most-named first, the rest counted and offered the
  next night. Why: the copy had 99 names over the bar on the first night; ten a night drains
  it in nine nights with the people and projects said most first. Not measured beyond that.
- Decided by the group 3 cards builder, 2026-10-11, lightly held: a name a faded card holds is
  not offered by the tally. Why: the old memories already there when it faded would rebirth
  it the next night; it comes back, as before, when a new memory names it.
- Decided by the group 3 cards builder, 2026-10-11, lightly held: an entity card is not a
  recall candidate and not a facts-mode result (the identity core included). Why: a newborn
  card's body is a stub that asserts nothing, and once cards were born a turn naming someone
  footnoted it. The card works as the index (subjects), not as a memory.

### Decided by the #429 reviewer, 2026-10-11, lightly held (a removed card stays removed)

- Decided by the #429 reviewer, 2026-10-11, lightly held: a card the owner removed is not
  born again by the name tally. The chase keeps the memory ids the card linked (box-2 meta
  `removal.card.<id>`), and `Schemas#birthsFromNames` refuses, as `removed-by-owner`, a name
  whose memories cover 0.8 of those still live. Why: the chase blanks the card's name, so the
  tally would rebirth it from the very memories that still say it, undoing the owner's act
  (store CONTRACT: a removed memory cannot be silently resurrected). A hash of the name was
  considered and refused: store §16 G9 forbids a content hash in what a removal leaves,
  because a name is low-entropy and a hash of it is brute-forceable. If the owner later
  removes those memories too, nothing is left to recognise the name by. A block by name that
  outlives the memories would need G9 amended, which is the owner's call.

### Decided by the group3a builder, 2026-10-11, lightly held (the core: recurrence lane, identity, being reconsidered)

- Decided by the group3a builder, 2026-10-11, lightly held: a memory's SLOT is the memory plus the live
  memories a standing "A over B" ties it to: a settled `changed` pair (a write's `updates`, a settle, a dream
  merge, and folds once part B writes them through `supersede`). It is walked along the chain, at most 12
  members. (A slot proposal still waiting was counted too in the first draft; see the reviewer's bullets below.) `open` pairs (two different things) and `corrected` pairs (the earlier
  was wrong, not said again) are not slots. Why: Group 2 shipped pairs, not slot ids, and these pairs are the
  ones that say "the same thing, later". Embedding neighbours were the other option, but the slot detector
  already turned cosine into pairs, with a dream confirming them.
- Decided by the group3a builder, 2026-10-11, lightly held: a RE-ENCODING is read off the slot's rows. It is
  the birth day of each member other than the slot's first-written, when a session wrote it (a dream's or a
  reflection's writing is not one), and its session is the member's `origin_session`. No `reencoded` row is
  written to `returns`. Why: the count needs no write path, an undone settle takes its days with it
  automatically, and the existing history counts on the first night. So `returns.source =
  'reencoded'` stays unused. No store-format change was needed: v13 already has `returns.session`.
- Decided by the group3a builder, 2026-10-11, lightly held: `returns.session` is written from now on: the recall
  session for an awake or engaged use, and the reflection's id for a reflection's citation. A day whose
  evidence names no session (every return before this build, and a direct store credit) counts as ONE session
  of its own. Why: every existing row is NULL. Reading NULL as "no session" would hold the lane shut for weeks;
  reading it as one session per day is the most it can honestly mean.
- Decided by the group3a builder, 2026-10-11, lightly held: "the row itself has ≥1 engaged return" (08 C1)
  reads as "the row has a real use of its own": an awake, reflection or engaged return. An engaged-only day
  counts `ENGAGED_RECURRENCE_WEIGHT` (0.5) of a day, and at least one day must be a full one ("half, never
  alone"). Why: an `engaged`-source anchor alone would shut out every row whose only uses were referenced ones.
- Decided by the group3a builder, 2026-10-11, lightly held: a memory a later member of its slot settled over
  (`changed`) does not cross by the slow lane. The slot's recurrence lifts its CURRENT state. Why: otherwise
  an outdated state ("I preferred X") could become core on the strength of its successor's use. The fast lane
  is unchanged.
- Decided by the group3a builder, 2026-10-11, lightly held: identity means about ∈ {me, us}, kind ∈ {self,
  person, entity}, status not planned/proposed/asked (08 C2), and the recognition door (an unmarked memory
  with a strong recognition feeling) is held to the same kinds and the same "not a plan". `CORE_ABOUT_MARKS`
  keeps `owner`, because it still means PERSONAL (what a merge inherits, what a dream may not self-mark, the
  elsewhere line's gate). The core reads the new `IDENTITY_ABOUT_MARKS`. Why: changing the shared constant
  would have moved four unrelated behaviours.
- Decided by the group3a builder, 2026-10-11, lightly held: BEING RECONSIDERED is a `core_events` row
  (`reconsidering`, reason `not-about-me-or-us` | `not-a-core-kind` | `a-plan` | `no-recurrence`). A decision
  writes `reaffirmed` (keep, with the why, actor owner/self/reflection) or `demoted` (retire). Consolidation
  lifts a flag itself (`reaffirmed`, actor `sleep`, reason `cause-gone`) when the memory is about me or us
  again, or has recurred since the flag. A memory someone chose to keep is not flagged again for what it is,
  only for going quiet after the keep. Quiet is counted from the latest of its last recurrence day, its
  promotion or keep, and its band day. Why: item 14 (no automatic demotion), and a flag that outlived its
  cause would ask for a decision that was already made.
- Decided by the group3a builder, 2026-10-11, lightly held: a flagged member moves from "Who I am" to "Still
  open" in the wake, labelled "Core, being reconsidered — keep or retire it (remember core) [id]". Only one
  shows at a time, at the top of the list (`RECONSIDERING_MAX` 1). The rest are counted with "more still
  open". Why: the owner already has about 40 open threads and the lane shows 5. Five flags at once would have
  pushed every open question out. My doors are
  `remember`'s `core: {id, decision: keep|retire, why}` (any core memory, with a why) and a reflection's
  `core` part (any core memory it was shown, at most 5). Flagged members are handed to the reflection. The
  owner's are `counterparts core --demote` and the new `--reaffirm`. Retiring is allowed on a night with the
  reflected-feeling door closed, because it moves toward less core. Why: the brief's "both of us can retire a
  core memory directly", and the wake's Still open was 08 C4's place for it.
- Noticed by the group3a builder, 2026-10-11: with the recurrence lane, a reflection citing a memory once a week
  carries it into the core in three weeks (four reflection days, each its own session), where it used to take
  four. The D5 "watch" test now pins three weeks.
- Decided by the coordinator and random-06, 2026-10-11, lightly held: only SETTLED pairs make a slot. A slot
  proposal still waiting (unconfirmed) does not count until it is confirmed. Why: about one in seven
  proposals was wrong on Group 2's hand-read, and a wrong one would pool another memory's uses into this
  one's recurrence and could carry it into the core. Confirming is cheap, and the core is slow by design.
- Decided by the #430 reviewer, 2026-10-11, lightly held: the flagged core memories take turns in the wake's
  one "Still open" place, by lived day (the n flags in a fixed order, starting at day mod n). The flag still
  repeats until someone decides, since asking for a decision is its job, and the reflection is handed all of
  them every night. Why: in a fixed oldest-first order the same flag led every wake, and the other four on the
  copy were never shown, only counted.
- Decided by the #430 reviewer, 2026-10-11, lightly held: the "a day with no session counts as one session"
  reading stays, as a TRANSITION. It ends when the last return written before this build leaves the trailing
  window: 30 lived days after the upgrade. To make sure it does end, a write that confirms an older memory
  (`updates`, through `Self.noteSelfConfirmation`) now writes its session on the return it earns, as recall's
  credits and a reflection's citations already did. What still writes no session: an entity card credited
  for a name mentioned (`schemas`), which is a schema row nobody marks me or us, and the date-repeat credit,
  which earns no return. Why: on the owner's copy the one slow crossing (a day-18 memory) rests on three
  session-less days (two uses of its earlier state, four days apart, and a reflection), which really were
  separate sessions. The over-count a NULL day allows (one session spanning several lived days) can only come
  from returns before this build.

### Decided by the group3b builder, 2026-10-11, lightly held (folding)

- Decided by the group3b builder, 2026-10-11, lightly held: a fold leaves the open questions on its parts open
  (`supersede`'s `closeFlags: false`), where a merge closes them. Why: "these add up to X" answers no "does this
  part disagree with Z"; closing it would hide a real question behind the fold.
- Decided by the group3b builder, 2026-10-11, lightly held: besides the brief's four exemptions (readings, felt,
  protected, the core), a fold also keeps at its own weight a DATED part (through the door its reminder would move
  onto the fold), a dream's own words (a dream does not build on them, as merges already refuse), and an EARLIER
  version (it already has a head; settling it under the fold too would move its head off its real successor).
  All are still cited in `meta.sources` and tied. "Reading" is the settle guard's test (`slotExempt`: about
  `world`, or a title opening "Reading"); "felt" was any recorded feeling (`feeling_peak > 0`; narrowed by the reviewer, below). Why: the door's
  own effects (decoring, carrying a reminder, re-heading a chain) are wrong for a summary. On the owner's copy
  (10-11) the census over 1,009 live memories: 751 foldable, 87 earlier, 79 felt, 42 reading or world, 21
  dated, 16 dreamed, 13 core.
- Decided by the group3b builder, 2026-10-11, lightly held: a fold starts at the strongest part's decayed
  strength on the night (read before any part fades), floored at the insight gist's 0.3 and capped at 0.6. Why:
  the brief's "its sources' strength (≤ 0.6)"; the floor keeps a fold of parts already near reach (four routine
  events at ~0.12) from being born below reach with its parts cut to ~0.06, the "work vanishes from recall" case
  review 11 warned of.
- Decided by the group3b builder, 2026-10-11, lightly held: a fold's title is its own, with no "Dreamed:"
  prefix (review 11 C4); `source = 'dreamed'` and `meta.fold` keep where it came from. A fold needs two or more
  sources. Folds count as `fold`, not `gist`, in a dream's counts and on `dream.changed`, so the dashboard's
  "patterns dreamed" line counts insights only.
- Decided by the group3b builder, 2026-10-11, lightly held: "overflow carried and counted" is, for now, counted
  and said: a fold past the night's 5 is refused `limit-reached`, counted on `dream.changed` (`foldOverflow`)
  and named in the hand-back; its parts are left as they are. The queue read is untouched, so carrying them to
  the next night is part C's (the dream queue).
- Decided by the group3b builder, 2026-10-11, lightly held: a CORRECTION (`corrected`, any door but a fold's)
  of a fold's part raises an unsettled pair between the fold and the corrector, source `fold-source-corrected`
  (the fold, being older, reads "Unsettled — may be out of date"). Undoing the correction withdraws the flag
  while it is still unanswered. A `changed` over a part flags nothing. Why: the brief names corrections; a
  newer state of a part is what the fold already stands over.
- Decided by the group3b builder, 2026-10-11, lightly held (random-06's ride-along): the head of a memory is the
  end of the chain by its STANDING settles: of the settled `changed`/`corrected` pairs in which it is the
  `over`, the newest (by when raised). A pair in which it holds no longer re-affirms it. `recall/standing.ts`
  (`headOf`) and `self/index.ts#settledOver` changed together, so every reader (facts, ambient head-wins, the
  wake, neighbours, the dream's bundle) follows. Three tests pinned the old reading and now pin the new one
  (`reconsolidation-door`, `continuity-round2`, `settled-over-marks`). (The builder refused "settle B over C"
  while "C over B" stood; the reviewer made it the explicit reordering the brief names, below.)

### Core-lever ruling (decided by random-06, 2026-10-11, lightly held; implemented by the #432 reviewer)

- Decided by random-06, 2026-10-11, lightly held: a FOLD takes the `me`/`us` mark only when MOST of its parts
  are `me`/`us`: a strict majority of every part it cites, kept-at-weight ones included; then whichever of
  the two more parts carry (a tie: the first in order). Otherwise it takes the most common of its parts'
  other marks (owner, work, world; a tie: the first in order; unmarked parts do not vote), or none. A tie
  between personal and not is not a majority, so it is not personal. "Personal wins by one" stays for
  merges, revisions and insight gists (`inheritFrom`); a fold has its own helper beside it
  (`store/index.ts#foldMarkFrom`). Why: a fold summarises many parts; one `us` part must not make a stretch
  of work a core candidate.
- Decided by random-06, 2026-10-11, lightly held: a fold's recurrence is what came back AFTER it was
  folded. In a slot with a fold, a member already there when the slot's first fold was written gives no
  re-encoding, and only its returns after the fold (`returns.at` past the fold's `created_at`; the lived day
  where a return has no moment) count. The fold's own uses and members written since count as anywhere
  else. No minimum count of its own uses. Why: its parts' births were the encoding the fold summarises,
  not its content coming back. On the owner's copy the personal fold no longer meets the slow lane on one
  use; four post-fold use days by three sessions over seven lived days do.

### Decided by the #432 reviewer, 2026-10-11, lightly held

- Decided by the #432 reviewer, 2026-10-11, lightly held: "felt" for a fold's exemption is review 11's (C3,
  D3): a `self` or `person` memory whose recorded feeling peaks at `FOLD_FELT_FLOOR` (0.5) or more. Why: the
  brief's one word summarises review 11; "any recorded feeling" kept 79 of 1,009 live memories out of
  their folds, a mild feeling on a routine work memory among them. Review 11's reading keeps 22.
- Decided by the #432 reviewer, 2026-10-11, lightly held: a fold starts at the strongest strength of the
  parts it HOLDS OVER, not of every part cited (the 0.3 floor when it holds over none). Why: a core memory
  or a reading kept at its own weight would otherwise lift a fold of weak work to its strength, above
  every part the fold stands for. The 0.3 floor stays: without it a fold of parts near reach is born
  below reach with its parts cut further.
- Decided by the #432 reviewer, 2026-10-11, lightly held (random-06's ride-along, as the brief words it):
  "settle B over C" while "C over B" stands REORDERS that pair: the standing settle is undone (C's cut on B
  lifted, its trail kept, why `reversed: …`) and B settles over C. For the owner and a session; a `changed`
  pair only (a `corrected` one archived B), not one closed through another, not a pressure crossing, and
  not where the reading guard would keep the two side by side. A dream or a reflection is still refused
  `already-settled` (an undo of its batch could not stand the old settle back up), and the refusal now
  says which way the pair stands. Why: the brief: "a new settle reorders only the pair it names (to make
  B current again, settle B over C)".
- Decided by the #432 reviewer, 2026-10-11, lightly held: the dashboard's dreams page counts a fold as
  `fold` and says "folded N memories into what they add up to (M faded under it)". Why: it counted folds
  as patterns.

### Decided by the coordinator, 2026-10-11, lightly held (who may reverse a settle)

- Decided by the coordinator, 2026-10-11, lightly held: a session (or anything that is not the owner) may
  reorder a pair by settling it the other way ONLY when the standing settle was not the owner's (its newest
  settle not undone, actor `owner`: his CLI settle or his door). Over the owner's settle it is refused
  `already-settled`, and the message says the owner settled it and how he can change it (his own settle the
  other way, or `counterparts settle --undo`). The owner can reverse anything. Why: the owner's settle is his
  ruling; a model session should not reverse it, even with the trail kept.

### Decided by the catch-up-unread-parts builder, 2026-10-11, lightly held (did the catch-up skim?)

- Decided by the catch-up-unread-parts builder, 2026-10-11, lightly held: the first live `counterparts
  catch-up` did not skim. Every one of the 16 parts it closed with `[]` was wholly marked "already written
  up" before the run began: 14 by the session's own half-hourly chapters, 2 by one mid-session note. The
  reader was told not to write marked words again, and didn't. The waste was the door handing such parts
  over at all. Why: read back from the parts the children were actually served (every entry carried the kept
  mark) and from the coverage ledger's claims.
- Decided by the catch-up-unread-parts builder, 2026-10-11, lightly held: a part whose every word is already
  written up is passed over by the door (and recorded done) and costs a catch-up batch no bytes and no place,
  except the session's last part, which is always served because only a session that was handed words sets
  the write-up mark. Why: the smallest change that stops the waste without touching the mark's path.
- Decided by the catch-up-unread-parts builder, 2026-10-11, lightly held: the guard on empty answers is a
  required one-line `nothing` reason on the granted (catch-up) path, for a part that holds unwritten words.
  There is no timer and no "N empty answers in a row" rule. Without the reason the answer is refused, nothing
  is recorded, and the part stays owed ("unread"). Why: fetch-to-answer time measures what a reader wrote, not
  what it read (a model takes in a whole part at once), and the 16 two-second answers that prompted this were
  all right. A seconds-per-KB floor or a run-of-empties rule would have marked every one of them unread, and
  kept re-owing them forever, since the chapters' claims stay. A live session's `[]` keeps the meaning it has
  had since 2026-09-23. The reason's text is not stored.
- Decided by the catch-up-unread-parts builder, 2026-10-11, lightly held: `catch-up --reowe <run>` only moves
  a session's progress counter back, and only while nothing has claimed those words since. A session the run
  went on to mark written up, or whose later memories claimed the words (each memory claims its session's
  backlog), is refused `needs-retraction`. Taking a mark or a coverage claim back would mean a new operation
  on two pinned seams (`write-up-seam.ts`, the coverage ledger), which is left as an open question rather
  than built here. Why: with passed-over parts and the reason guard, a run that closes unwritten words empty
  should be rare, and the retraction is a design call, not a repair.
- Noted for the coordinator, not changed here: a mid-session note (`remember`/jot) claims coverage of every
  unwritten word its session said before it (`submitJot` always covers its own session), so one note about
  one fact can mark hours of conversation as written up. That is how 2 of the 16 parts (one session's
  evening) came to read as already written up when the note covered none of their substance.
- Decided by the #435 reviewer, 2026-10-11, lightly held: `catch-up --dry-run` or `--yes` without `--reowe`
  is a usage mistake (exit 1). Why: the flags were added to `catch-up` for `--reowe`, and alone a typed
  `catch-up --dry-run` started a real run that writes memories and spends the subscription.
- Decided by the #435 reviewer, 2026-10-11, lightly held: `--reowe` exits with the CLI's codes (`EXIT`:
  usage 1, refused 2), not its own inverted pair. Why: a script reads one meaning per code across commands.
- Decided by the #435 reviewer, 2026-10-11, lightly held: the SessionStart pointer (dreaming `ask`/`off`)
  names the part the door will hand over (`firstUnwrittenPart`) and counts only the parts a reader is
  handed. Why: the door passes over parts with nothing unwritten on every path, not only the catch-up's,
  and the pointer said "part 1 of N" and the whole backlog's size while the door handed part 9.
- Noted by the #435 reviewer, not changed: with the reason guard in place, a future run's logged empty
  parts with unwritten words are all ones the reader explicitly declined with a `nothing` line, which the
  log does not record. `--reowe` owes those back too; that is what a "known-bad run" means here.

### Decided by the coordinator, 2026-10-11, lightly held (a note claims its own turn)

- Decided by the coordinator, 2026-10-11, lightly held: a memory written in the moment (the note tool, source
  `jot`) claims only its own turn — its own span, and the conversation pieces whose cursor `from` equals the
  note's own `from` (the prompt that started the turn it was written in, captured at the Stop after the note and
  added to the note's claim then, under the same proposal id). A session-end write-up, the write-up door,
  "nothing new" and a chapter keep their whole-session claims. Why: on 10-10 one short note in session e92c5180
  claimed 18 pieces (about 48 KB, 2.6 hours) of that session's unwritten backlog, and the catch-up then rightly
  saw them as written; it was the only real loss found in the first live catch-up. Same principle as Group 4's
  write-time links (own turn only) and "memory forms as you go": a note is a moment, not a summary of the session.
  For random-06's and Mike's review.
- Decided by the coverage-jot-breadth builder, 2026-10-11, lightly held: the turn is found by the cursor, not by
  times. A note's span is written with `from` = the session's cursor in that scope, and the next capture in that
  scope starts at the same cursor, so "the capture that begins at the note's `from`" is the turn. When two notes
  share a turn, the first accepted one takes the turn piece. A note written in a turn with no prompt of the
  person's (the reply to a Stop ask, whose prompt is the ask itself and is never captured) claims only itself. A
  note whose own span did not land (an exact repeat of an earlier note's text) claims nothing. Why: no new field
  or file is needed (no store-format change), and every miss leaves the turn unwritten, which is the safe side.
- Decided by the coverage-jot-breadth builder, 2026-10-11, lightly held: `counterparts coverage` splits owed
  sessions with the same filter doctor and the catch-up read (`sessions.ts#pointable`): a small stretch from a
  session the registry does not show as a person's is listed under "Left to lapse (small; not known as a person's session)", not
  "Owed now". Why: one source of truth; the command listed d4929258 (an `sdk-cli` session) as owed while the
  catch-up and doctor let it lapse. Same caveat as doctor's: a small debt whose registry record was pruned (after
  a week) also reads as not a person's.
- Decided by the coverage-jot-breadth builder, 2026-10-11, lightly held: the catch-up's "left N parts unread" line
  in `counterparts coverage` shows only when the date asked is today or the date of that run. Why: the line came
  from the newest run whatever date was asked for (review of #435).
- Decided by the #437 reviewer, 2026-10-11, lightly held: a note does not take its turn when that turn's capture
  holds something the person typed after a reply (`spans.ts#typedAfterReply`; host-injected text such as the
  interrupt marker or a peer's message does not count). The host runs no Stop after an interrupt, so the next
  Stop's single joined span carries the interrupted turn and the one after it, and the note would have claimed a
  prompt it never saw. A message queued mid-turn leaves its turn unwritten the same way. Why: the span is one text
  and cannot be split without a store-format change, and a turn left unwritten is the safe side (the session-end
  write-up or the catch-up takes it); the skip is emitted as `remember.coverage.turn.skipped`.
- Decided by the #437 reviewer, 2026-10-11, lightly held: the lapse wording says "not KNOWN as a person's session"
  (`counterparts coverage` and doctor's Coverage detail). Why: `pointable` reads a missing registry record as not a
  person's, and records are pruned after a week while a small debt lapses only after 14 days of use, so a person's
  own small debt can land on this line; "not a person's session" would then say something false.

### Decided by the group3c builder, 2026-10-11, lightly held (the dream queue)

- Decided by the group3c builder, 2026-10-11, lightly held: fragility is `1 − strength` on the next lived day
  (review 09 C3's second form), not the strength lost before the next night (its first). Why: on this curve the
  one-night loss falls with stability, which grows exponentially with salience and feeling, so a felt or
  salient memory ranked ~10x below a routine one and long-held valuable memories never got their turn. `1 −
  strength` keeps value in charge, rises as a valuable memory fades toward the edge of reach (it is rescued
  before it leaves), and still favours the weakly held. Value = salience on the curve (`curveSal`, the
  old-claims era applied) + how strongly felt + 0.4 dated + 0.3 on my mind; the old at-risk bonus and age term
  are gone (the curve is the clock).
- Decided by the group3c builder, 2026-10-11, lightly held: a fragility floor, `FRAGILITY_FLOOR` 0.1. Why:
  without it the most charged and most salient memories rank near zero every night while staying queued for
  months (far from falling below reach), and a queued memory is kept out of the look-back and the neighbours.
  At 0.1 a strongly felt memory ranks beside an ordinary one on its first night; the core (never below reach)
  waits for its turn the same way instead of being dropped from the queue.
- Decided by the group3c builder, 2026-10-11, lightly held: the queue starts where dreaming began, at the first
  standing dream's `FIRST_DREAM_DAYS` (7) look-back (today's, before any dream). Why: a store's life before it
  dreamed is not a backlog, and a store that turns dreaming on after months should not wake to all of it. On the
  owner's copy the first dream's look-back reaches lived day 1, so 10 undreamed memories from days 1–5 that are
  still within reach come back into the queue; the old window had aged them out.
- Decided by the group3c builder, 2026-10-11, lightly held: the per-prompt gate reads only `ASK_QUEUE_DAYS` (7)
  back and stops at `MIN_NEW`, as it did; the line, `begin` and the hand-back read the whole queue. Why: the gate
  runs on every prompt, and the undreamed rows below reach (which the full read must still look at to know they
  left) grow with intake until the prune takes them. Cost: an old leftover alone does not raise the ask.
- Decided by the group3c builder, 2026-10-11, lightly held: a refused fold's parts are carried by an event
  (`dream.carried`, the ids), not by editing the dream's `shown`. Why: the night's later changes, the
  reflection's "what the dream saw" and the owner's forget path (which redacts a journal that showed a memory)
  all read `shown`; the parts were seen, so taking them out of it would hide that. The queue reads the carry,
  oldest dream first: a carried id is queued again until a later dream shows it. Only parts a fold would fade
  are carried, and only two or more: an exempt-only fold is not re-offered night after night (#432's bullet 3).
- Decided by the group3c builder, 2026-10-11, lightly held: carried parts rank first the next night, as a group,
  ahead of the value × fragility ranking; general cluster selection (review 09 C4) is not built. Why: the dream
  already chose that fold, and the group is small (at most the parts of the refused folds); ranking a whole
  queue by clusters is a larger change and value × fragility already keeps a day's work of one salience close.
- Decided by the group3c builder, 2026-10-11, lightly held: `agedOut` keeps its name on the bundle and the
  `dream.begun` row and now counts the never-dreamed memories that fell below reach since the last dream (once:
  within reach at that dream, or born after it). `readCapped`, `agedOutAtLeast` and `windowDays` are gone from
  new rows (the read has no cap); the dashboard still reads them on old rows. `dream_shown_day` (v13,
  pre-provisioned) stays unwritten: the read is O(undreamed rows) without it, and a second source of truth would
  have to follow undo, resume, requeue and carry.

### Decided by the #436 reviewer, 2026-10-11, lightly held (the queue's read)

- Decided by the #436 reviewer, 2026-10-11, lightly held: the queue reads the dreams through `store.dreamsShown`
  (`id, day, date, state, started_at, shown`, oldest first, no journal) and the first dream's day through
  `store.firstDreamDay` (one `MIN`); the per-prompt gate reads only the dreams begun in its week, by lived day
  (`sinceDay`, the column the queue already filters on, indexed), not by `started_at`. The carry's events are
  read the same week on the gate and without the event log's default page of 500 everywhere. Why: the gate runs
  on every prompt, and `SELECT *` of every dream parsed every journal; the old 500-row page, oldest first, would
  have dropped the newest carries once a store had made 500. No behaviour change on the gate: a dream older than
  its week was already passed over, and a carry is recorded on its dream's day or later. On a 10x copy with a
  year of dreams (365) the gate's queue read went from 7.3 ms to 2.8 ms; at 15 dreams it is unchanged.
- Decided by the #436 reviewer, 2026-10-11, lightly held: a carried group left with fewer than two parts still
  queued (the others forgotten by the owner, archived, below reach, or shown by a later night) no longer goes
  first and is not counted as `carried`; the part left ranks by value × fragility like any queued memory. Why:
  the carry exists so a fold has its parts in front of it, and the carry itself is only made for two or more; a
  lone part jumping the queue as a "group" of one would spend the front of the night on no fold. The owner's
  forget path needed nothing: the removed part is denied and leaves the queue, the dream that showed it is
  redacted as before, and its `shown` stays.
- Decided by the #436 reviewer, 2026-10-11, lightly held: the queue's reach test is physics' `belowReach`, not
  `strength < REACH`, both for leaving the queue and for the `agedOut` count. Why: the tunables and the CONTRACT
  say the core never leaves reach; a core memory faded by a settle could read under 0.15 and leave the queue as
  "faded", and the queue was the one reader with its own definition of reach.

### Decided by the db-close builder, 2026-10-11, lightly held (`Db.close()` really closes)

- Decided by the db-close builder, 2026-10-11, lightly held: a `Statement` from `db.prepare`
  holds its SQL and looks up the driver statement on each call, instead of holding the driver
  statement. Why: a statement dropped from the cache (at the 512 cap, or on an `ALTER`/`DROP
  TABLE`) can then be finalized at once without breaking a caller that kept the handle, and
  that caller gets the new columns after an `ALTER`. The alternative, keeping dropped
  statements until `close()`, grows without bound under SQL built per call.
- Decided by the db-close builder, 2026-10-11, lightly held: anything run on a closed `Db`
  throws a new `StoreError` code, `DB_CLOSED`, and a second `close()` does nothing. Why: before,
  under bun a statement kept from before the close still ran on the half-closed connection,
  and under node a double close threw. A use after close is a bug that should say so.
- Decided by the db-close builder, 2026-10-11, lightly held: an observer's close is not kept
  from folding the log. When it is the last connection on a file, SQLite checkpoints at close
  and the database file's bytes can change with no row changing. Why: bun and node expose no
  way to turn that off for one connection (`SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE`), a read-only
  open refuses a WAL store whose sidecars are gone, and under node it was always so. The
  observer promise is about rows, and a writer folds its own log on close, so an instrument
  usually finds nothing to fold.
- Decided by the db-close builder, 2026-10-11, lightly held: a pre-migration copy older than
  today is reused when neither the database file nor a NON-EMPTY `-wal` is newer than it.
  Why: with closes now real, bun's own SQLite on Linux deletes the `-wal` at the last close
  and the next open makes an empty one, so an empty `-wal`'s mtime is an open's, not a
  write's; counting it meant an older copy was never reused there.
- Decided by the #438 reviewer, 2026-10-11, lightly held: where a read promised the files
  were left alone, the wording is made honest rather than the promise kept. The one place it
  was said of an opened store, `start-fresh --undo --dry-run` ("Nothing else was touched"),
  now says a log left in the new store's `-wal` may have been folded into its database file,
  and that no memory changed. Why: keeping it would mean the read never being the last
  connection, which neither driver lets one connection choose; the other "nothing has
  changed" lines are about memories, which still holds, and the forward dry run opens no store.

### Decided by the file-split builder, 2026-10-11, lightly held (splitting a class across files)

- Decided by the file-split builder, 2026-10-11, lightly held: a big class (`Counterpart`, `McpServer`, `Store`)
  is split by moving a method's BODY into a free function in a sibling part file, `export function name(cp:
  Counterpart, …params)` (`server: McpServer`, `store: Store`), and leaving the method on the class as a one-line
  delegate with the same name, modifiers, parameter types and return type: `return boundaryPart.name(this, …)`.
  The body is unchanged but for one rewrite: `this.x` becomes `cp.x`, or `cp["x"]` when `x` is private (or
  protected), and a bare `this` becomes `cp`. Why: TypeScript's bracket access to a private member is
  type-checked and leaves the class's declared surface as it was, where dropping `private` would have widened
  `Counterpart`'s and `Store`'s exported types (and `ReadOnlyStore`, which is `Omit<Store, …>` over the public
  members). The codebase had no pattern for this; its nearest, free functions taking `store: Store`
  (`mint.ts`, `reconsolidation.ts`), only ever use the public surface.
- Decided by the file-split builder, 2026-10-11, lightly held: a delegate drops `async` (the body keeps it, so
  the promise and its timing are the body's own), a defaulted parameter becomes optional on the delegate and keeps
  its default in the body (evaluated once, where it was), and a public method keeps its doc comment on the class
  while a private one's comment moves with its body. Section dividers (`// ── … ──`) stay on the class. Why: the
  class still documents what callers may call; how a body works is read beside the body.
- Decided by the file-split builder, 2026-10-11, lightly held: the parts holding class bodies are pinned to one
  importer each, their class's file (`test/split-parts.test.ts`). Why: the functions are exported so the class can
  import them, which also lets anyone who imports a part call a PRIVATE body (`Counterpart`'s deposit) past the
  checks the public doors make first; the pin makes a second importer a decision rather than an import.
- Decided by the file-split builder, 2026-10-11, lightly held: in `Store`, only public read bodies moved. Every
  write method stays whole in `store/index.ts` (the `WRITE_METHODS` totality test reads its `this.mutate` sites from
  that file), as do `embedOne`, `today` and `dateOf`, which tests read there, and no private method's body moved:
  those are the store's internals (its raw insert, its transaction seam, its deny-list check), and nothing outside
  the class should be able to import one. So
  `store/index.ts` lands at about 218 KiB rather than the ~200 aimed for.

### Decided by the arriving-lane builder, 2026-10-12, lightly held (what takes a dated item off "Arriving:")

- Decided by the arriving-lane builder, 2026-10-12, lightly held: the wake's "Arriving:" lane no longer
  applies the cue path's brakes. Those are the per-window fire cap, once per lived day, once per session, the
  month or range item's last fire held for after, and "told plainly today". The lane still drops a window
  that has not opened, one that has passed or been retired, and one the assistant was seen to use. Why:
  those brakes ration how often a dated item is raised as a footnote in a turn. They say nothing about
  whether the date is still arriving. Applied to the lane, they emptied it on the day it mattered. On
  2026-10-12 the owner's plain tax reminder (mem_3d70c8464401, due that day) had been cued on 10-10 and 10-11,
  which spent its two fires. It was missing from every wake on its day.
- Decided by the arriving-lane builder, 2026-10-12, lightly held: a plain reminder that has been told stays
  in the lane through its own day and leaves once that day is behind it. This replaces "leaves as soon as it
  is told". Why: the tax reminder and mem_346077c3e78c were both "told" at 00:19 on 10-12, to a turn in a
  coordinator session that an agent's hand-back message had started. Nobody read it, and the owner's 08:00
  wake no longer listed either one. The grace week after the day, which is what the old rule was written
  against, still drops it. The cost: a reminder already told in an earlier session that day shows again
  under "Arriving:" in later wakes that day.
- Decided by the arriving-lane builder, 2026-10-12, lightly held: when "Arriving:" lists nothing, its one
  count line (`collapsedLine`) may take room from the lanes below it in `ROOM_ORDER`: "Work here", the
  Yesterday line's titles, the handoffs' room and "Today, elsewhere". Before, it got only what was left
  unspent. Why: the owner's bundles of 10-12 had seven dated items and not a word about them, because the
  page, borrowing "Work here", had spent the room. The CONTRACT's promise that a dated item is "never
  silently gone" did not hold.
- Not changed, and open: an ordinary dated line still ranks below the page's borrowing (`arrivingFirst` <
  `pageBorrow`). And the rescue lists Arriving's first N lines or none, so a long first line
  (mem_2671e707a246, 1,270 bytes, 28 renders trimmed on 10-11/12) can keep a shorter one behind it unlisted.

### Decided by the cc-reads-trim builder, 2026-10-12, lightly held (fewer reads of Claude Code's files)

- Decided by the cc-reads-trim builder, 2026-10-12, lightly held: the nightly run reads its child's
  `--output-format stream-json --verbose` output, kept in memory to 64 MiB and never written to disk, in
  place of the child's transcript under `~/.claude/projects`. `--session-id` stays (it keeps the children
  apart); the row's field keeps its name, `transcript`, so old and new rows read alike. A host that refuses
  the arguments is retried once plain, its cut unchecked. Why: we launch the child, so its own output is the
  smallest read; a scan of the host's projects directory is the read a directory reviewer would flag.
- Decided by the cc-reads-trim builder, 2026-10-12, lightly held: the turn-budget swap
  (`content-replacement`) is still parsed if it appears in the stream, but was not seen there. If it is
  transcript-only, turn-budget cuts go unseen. Why: no cheap way to make a real host spill tonight; the
  miss is quiet, never a false amber.
- Decided by the cc-reads-trim builder, 2026-10-12, lightly held: Claude Code's compaction summaries and its
  other `isMeta` user lines enter no turn (`transcript.ts#hostRecord`), but a message another session sent
  here (`isMeta` with `origin.kind: "peer"`) is still kept, as task notifications are. Why: the policy names
  conversation summaries, and the summary repeats turns each Stop already captured; a peer's message is
  addressed to this conversation, not the host's bookkeeping.
- Decided by the cc-reads-trim builder, 2026-10-12, lightly held: the wake-arrival check became an opt-in
  diagnostic (`COUNTERPARTS_WAKE_CHECK=1` in the hooks' environment) rather than being removed. Why: one
  line of gate against several hundred lines of reader, tests and doctor wording to remove; off, nothing is
  read and no row is written.
- Checked by the #444 reviewer, 2026-10-12: in Claude Code 2.1.296's bundle, `content-replacement` is a
  session-storage entry (`insertContentReplacement` → `appendEntry`), written to the transcript file only,
  so it does not reach `stream-json`: turn-budget cuts go unseen on the night run from now on. The
  per-result `<persisted-output>` preview sits inside the tool result itself, which `stream-json`'s `user`
  messages carry. Kept as built; the miss is quiet, as the builder said.

### Decided by the arriving-slack builder, 2026-10-12, lightly held (who a plain reminder is told to, and who gets the session-start room)

- Decided by the arriving-slack builder, 2026-10-12, lightly held: a plain reminder is not said, and not
  marked told, at a prompt no person started. That covers a subagent's hand-back, a `<task-notification>`,
  "Another Claude session sent a message:", and a prompt that is only peer messages. It waits for the next
  prompt a person types. On such a prompt it is also held back from the quiet cues, so it does not spend a fire
  there. The prompt hook reads this from the prompt text alone (`transcript.ts#startedByHost`, the same
  frames capture uses to keep these turns out of pacing). Why: on 2026-10-12 at 00:19,
  mem_3d70c8464401 and mem_346077c3e78c were "told" to a coordinator session's turn that a hand-back had
  started, and nobody read it. The cost: a person who pastes one of those frames at the very start of a
  prompt is read as the host and is told one turn later.
- RANDOM's ruling, 2026-10-12, lightly held, for Mike's review, as built: at session start, "Arriving:" lines
  due within the next 3 days (`ARRIVING_NEAR_DAYS`), or in their grace days, get first claim on the room
  that would otherwise go to "Last here", "Last said here", "Today, elsewhere" and the handoffs. That
  includes the room kept for the newest handoff, which before this went only to a plain reminder due that
  day (`ROOM_ORDER`'s new `arrivingNear`, between `handoffsKept` and `pageBorrow`). They are listed after
  the due-day head and before the other dated lines. The turn-end composition marks none of them near, so
  it is unchanged. The total stays within the composition's budget plus the delivery's lent rooms, which is
  at most the ceiling less the preface's reserve. Measured on a fixture (page 6,472 bytes, four handoffs, two
  long dated lines): the session-start wake listed 1 dated line and 2 handoffs before, and lists 2 dated
  lines and no handoff at all now, not even by id. Open, for review: prospective's lead is also 3 days, so
  for day items the bound covers the whole lane, grace days included; it bounds nothing today. Leaving the
  grace-day ("was due") lines out of `near` would restore a bound. The page's borrowing still outranks
  these lines, and "Still open"'s first item is rescued before them.
- Decided by COUNTERPARTS, 2026-10-12, lightly held (built here): once a QUIET day item's date is behind the
  day asked about, the wake's lane applies the cue-only brakes to it again (over-fired, once a day, once a
  session, held for after). Why: #442's reviewer found that a quiet item cued twice in its lead days rode
  all 7 grace days as "was due …". It now leaves after its day. A plain item is unaffected, and so is a
  quiet item that was not cued out.
- Decided by COUNTERPARTS, 2026-10-12, lightly held, confirmed by RANDOM (built by the #445 reviewer): the
  newest handoff keeps a floor. The near lines take room from "Last here", "Last said here", "Today,
  elsewhere" and the older handoffs, but not from the newest handoff's own block (`arrivingNear` now sits
  before `handoffsKept` in `ROOM_ORDER`; that room is again lent to a due-day plain reminder alone). Why:
  the newest handoff is how a session knows where its work was left off. On the builder's fixture the wake
  now lists 1 dated line (the second line's count by id) and the handoffs, as before this PR. What (b)
  still adds: near lines are ordered right after the head, and the count rescue may not pop them.
- RANDOM's ruling, 2026-10-12, lightly held (built by the #445 reviewer): a grace-day ("was due …") line is
  not near. Only items due from the session's date through 3 days on are (`briefing.ts#nearDue`). Past
  items keep their ordinary place in Arriving. This restores the bound the builder found missing.
- Decided by COUNTERPARTS, 2026-10-12, lightly held, confirmed by RANDOM (built by the #445 reviewer): the
  dream's prompt lines get the same guard. On a turn no person started (`startedByHost`) the prompt hook
  treats the session as unwatched (`startUnwatched`): a headless night may still start and its line is
  held for the next watched prompt; the day's line, the morning share, a night's hand-back and the
  contradiction raises are neither said nor claimed there. Why: a morning share should count as told only
  on a turn a person typed.

### Decided by the onboarding round-1 core builder, 2026-10-12, lightly held (the meeting holds the housekeeping)

- Decided by the onboarding round-1 core builder, 2026-10-12, lightly held: "the meeting is running in this
  session" means the meeting is `offered` and a `meet` call (a read or a step) came from this session within
  the last 30 minutes (`MEET_HOLD_MS`). No new meeting state was added, because the mod reads the `meet=` marker.
  Why: a read happens before the person even says yes, so without a time limit, someone who ignores the offer
  and goes on working (with nobody calling `later`) would have no write-up ask all session. Every step refreshes
  the window, so a real meeting never runs out of it.
- Decided by the onboarding round-1 core builder, 2026-10-12, lightly held: the finish step (`meet` done) hands
  the write-up over in its result (session_end, then a chapter, then two or three lines of "here's what I'll
  remember", then the close). The one Stop after it is paced, so the pacer counts that write-up as its ask, but
  says nothing. Its `adapter.ask` row carries `coveredBy: "meeting"`. Why: otherwise the Stop right after the
  closing message would fire the ordinary ask (the meeting is past the first-ask threshold) and derail the close
  into bookkeeping again. If the model skipped the write-up, the coverage arm and the next day's catch-up still
  pick up what is unwritten.
- Decided by the onboarding round-1 core builder, 2026-10-12, lightly held: no dream (line, headless run or
  catch-up alone) on a MEETING DAY. That is the day the meeting was finished, or a day it was offered while it is
  not finished. A later day's `later` or `skipped` releases that day, but the first offer's day holds either
  way, since it is the store's first day. This is the dream gate's new `meeting-day` reason, through a `holds`
  hook on the dream context. Why: one rule covers "not on the first day", "never on half a meeting" and the
  catch-up night that Mike saw start mid-meeting (lived day 1 is reached by the first Stop's cycle, so the
  existing `first-day` gate did not hold). Stores with no meeting keys are never held. Cost: someone who keeps
  being offered the meeting and saying nothing has no dream on those days (three at most, the offer cap).
- Decided by the onboarding round-1 core builder, 2026-10-12, lightly held: the five research questions replace
  work/loved/problem/peeves/outside. "When Claude Code goes wrong for you" (peeves) is dropped too: it is not one
  of Mike's five and not a settings question. Step names are `week`, `work`, `love`, `saturday`, `started`. The
  second session's line still reads a 0.3.18/0.3.19 meeting's answers under their old names.
- Decided by the onboarding round-1 core builder, 2026-10-12, lightly held: the close leaves out retention and
  uninstalling. The script keeps both for when the person asks, and retention as one exact line
  (`RETENTION_LINE`) that Claude is told not to paraphrase. The `/counterparts` sidebar line is said only on a
  plugin install, the same test the uninstall route uses.
- Decided by the onboarding round-1 core builder, 2026-10-12, lightly held: the pronoun rule ("by name or as
  'they', until the person says") goes in the meeting script, the Stop write-up ask, Desktop's write-up ask and
  the dream's launch prompt. It costs about 15 tokens per write-up ask, and the Stop ask's pinned ceiling moves
  from 480 to 535 characters for it. One gendered model-facing line in
  reconsolidation ("stands as his. Tell him") is now neutral.
- Decided by the onboarding round-1 core builder, 2026-10-12, lightly held: "undo that dream" is a new `undo`
  phase on the dream tool. It does the same reversal as `counterparts dream --undo` and is refused in the
  nightly run. The dream's hand-back line now says `say "undo that dream"` for every install, in place of the two
  CLI commands. The journal entry itself stays. `meet` takes an optional `session`, used only when the registry
  confirms it, so the hold binds to the right session even before the server has one.
- Decided by the #450 reviewer, 2026-10-12, lightly held: on an offer day after the first, only a meeting begun
  that day (`offered`: a `meet` read or step today) holds the dream, not the wake's offer alone, which leaves
  the state `not_started`. Why: a Claude that never called `meet` cost a new person the dream on offer days 2
  and 3, from the first prompt on, with no meeting anywhere. The first offer day still holds either way.

### Decided by the recall-miss builder, 2026-10-12, lightly held (the meaning floor stays; the docs say the limit)

- Decided by the recall-miss builder, 2026-10-12, lightly held: the 10-11 bundle miss
  ("small boat for paddling" found nothing for "The reviewer keeps a ochre kayak called
  Marrow at the lake house.") is the static model's limit, not a bug, and the potion
  in-line floor stays at 0.15. Why: the stored vector scores 0.148 against the question,
  just under the floor, and unrelated pairs in a 39-pair distractor check scored up to
  0.259 (4 of 39 at 0.15 or more), so 0.148 is inside the noise band. A lower floor buys
  this one hit and several false ones, and on a store with one memory any floor under the
  noise ceiling returns that memory for every question. Mean pooling dilutes the word that
  carries the meaning: "kayak" alone scores 0.348, "ochre kayak called Marrow" 0.176, the
  full sentence 0.148. The single-binary smoke's canary passes because it is short (0.288).
  Reproduced the same way from this checkout (bun and Node), the 0.3.19 binary and the
  plugin bundle with its model; the embedding, the identity and the floor lookup were all
  as intended. Both modes miss; the 10-11 run asked `cli recall` with no `--mode`, which is
  facts.
- Decided by the recall-miss builder, 2026-10-12, lightly held: a hand set of 13 pairs that
  share no word, at the 0.15 floor: 3 miss (cat 0.070, sister/Portland 0.118, the kayak
  sentence 0.148), 3 more barely pass (0.153 to 0.171), 7 pass clearly (0.217 to 0.513).
  The README and the plugin README now say so: close paraphrases yes, a description that
  never names the thing no, exact words strongest. Lexical expansion (or a larger model) is
  the follow-up to measure, not done here.

### Decided by the first-doctor builder, 2026-10-12, lightly held (a fresh install's doctor)
- Decided by the first-doctor builder, 2026-10-12, lightly held: on a fresh throwaway HOME (npm tarball + `connect`, and with a SessionStart/Stop pair run through the hook) doctor on this build reads 0 red / 0 amber. The only amber a stranger can meet is the Claude Code line when `claude` is not on the PATH (hooks in, memory tools not registered); it already says why and prints the one command to run, so it is left as is. Why: it is a real missing step, not day-1 noise.
- Decided by the first-doctor builder, 2026-10-12, lightly held: the "absent row" ambers (Sweep, Sleep, Backfill, Snapshots) wait for a boundary dated BEFORE today. A boundary dated today means the first night run was just started and writes its rows when it finishes, so doctor says so in green. Why: the first session of day 1 writes the boundary and starts the run; a doctor run minutes later was amber for a healthy install. A worker that never finishes still goes amber the next day.
- Decided by the first-doctor builder, 2026-10-12, lightly held: the older 0.3.18 build showed Sleep and Snapshots amber on day 0 after one session; this build already greens them, so nothing further was changed there. Why: it is a gap in the build being replaced, not in this one.

### Decided by the start-told builder, 2026-10-12, lightly held (who is told at a session start)

- Decided by the start-told builder, 2026-10-12, lightly held: the session start reads one test,
  `watchedAtStart`. It is `isInteractive`, minus the night run's child (named outright, so the run's own marker
  holds whatever a later host sets) and minus `source: "compact"`. It gates the plain reminders and the first
  meeting's line. The wake row's `interactive` keeps the old test, because the fired report marks a session
  unattended for good on any start that says so, and a person's session compacts too. Why: a compaction fires mid-turn, so it is only as watched as
  the turn that filled the context, and that turn may be a hand-back nobody typed. An Agent-tool subagent's own
  compaction fires it too (seen on 10-10: `SessionStart:compact` inside a subagent, `cli`, handed a full wake).
  When a person did type `/compact`, the reminder is said on their next prompt, so the cost is one turn.
- Decided by the start-told builder, 2026-10-12, lightly held: `startup`, `clear` and `resume` stay a person's.
  Why: `claude -p` and the SDK already read as unwatched through the host's entrypoint and attended flags. A
  terminal session that a tool opens is indistinguishable from one a person opens, and treating every `startup`
  as unwatched would cost every person their morning reminder.
- Decided by the start-told builder, 2026-10-12, lightly held: the night run's prompt gets no temporal cues at all
  (`recallForTurn`'s `noCues`). Why: at 00:19 its recall handed the dream child the day's plain and quiet
  reminders as "quietly available" lines, and that spent a fire of the person's day on a run nobody reads.
  Hand-back turns in a person's session still spend quiet cues as before (only plain items are withheld there,
  per #445). That is left open (closed by the reviewer, below).
- Decided by the #453 reviewer, 2026-10-12, lightly held: the open item above is closed. A prompt the host
  started (`startedByHost`, #445) gets `noCues` too, so a hand-back or task notification in a person's session
  spends none of the day's fires; the plain items it held back are covered by the same switch, so the second
  `plainFor` read there is gone. Topical recall on that turn is unchanged. Why: the same reason as the night
  run's prompt, and the fix sits in the line beside #445's guard.

### Decided by the wake-never-silent builder, 2026-10-12, lightly held (nothing in the wake is dropped without a word)

- Decided by the wake-never-silent builder, 2026-10-12, lightly held: each lane's count line ("N more
  …", or the collapsed line of a lane that lists nothing) is RESERVED inside the trim loop, not added
  last if room is left. The loop composes with the line of every lane that has lost something so far
  and pops items until items and lines fit together. Each rescue (`takeRoom`) keeps those lines, and a
  later Arriving line is listed only with its lane's count. Why: Mike's principle of 2026-10-12, the
  minimal version he chose via RANDOM. The cost: a wake at its edge lists an item or two fewer, to pay
  for the line that says they are there.
- Decided by COUNTERPARTS, 2026-10-12, lightly held (the follow-up on this PR), as built: a lane that
  still lists an item keeps its own "N more" line directly under it, and only the lanes that list
  NOTHING fold into ONE line under "Who I am": "More than this wake lists: 3 still open (recall ids:
  mem_…, mem_…, mem_…, and 7 more); 5 nearby (recall ids: …)". Each folded lane carries its own first
  three ids (`FOLD_LINE_IDS`), which the recall tool opens (`wake-more.test.ts`); no name handle like
  "recall 'nearby'" exists today, so ids it is. "Who I am" never folds. The lanes that list nothing fold
  before the loop pops "Who I am", and when even the fold has no room it takes room the way a dated line
  does (`takeRoom` to `arrivingFirst`: Work here, the Yesterday line's titles, the handoffs' room, Today
  elsewhere, Arriving past its head). Only past that are ids left unsaid (`untold`). Why: an item under
  a heading with no count reads as the only one; the first version folded every count and moved
  Arriving's "+5" and Still open's "+24" away from their lanes in the owner's own morning.
- Decided by the wake-never-silent builder, 2026-10-12, lightly held: the page does NOT give up room to
  the folded line. I tried keeping the fold's bytes out of the page's room (as the brief's sizing
  suggested); it stepped pages in their own room down a rung in ten pinned tests and contradicts
  `ROOM_ORDER`, where the page in its own room outranks everything. The fold-then-borrow path covered
  every real-shaped case measured, so the reserve was left out. A page that fills every byte with no
  lent room left still leaves the lanes untold, and doctor says so in red.
- Decided by the wake-never-silent builder, 2026-10-12, lightly held: "Nearby" counts what its trim
  popped (at most `HINTS_MAX` hints the wake chose), with ids, in the same "N more nearby" and collapsed
  lines; its cap's overflow (the rest of the warm store) is still not counted. Why: the popped hints are
  a bounded list the wake chose, so the count means something; the cap's count is the store's size,
  which random-f2's item 5 already ruled out.
- Decided by COUNTERPARTS, 2026-10-12, lightly held, as built: "Nearby"'s count is NOT reserved. The
  least of the lanes, it takes only room nothing else wants (`tellLost`): its own line if that fits, else
  a place in the folded line, else it is left out and recorded as `quiet` — a step-down (`self.briefing`'s
  `quiet`, doctor's `steppedDown`), never a silent drop. So it never costs another lane an item, nor
  "Last here" its room (the first version did: `last-exchange.test.ts` is back as it was). A session start carries the popped hints
  (`WAKE_SHOWN_KEY`'s new `more.hints`, read as empty on an older record) and lists or counts them in its
  own room.
- Decided by the wake-never-silent builder, 2026-10-12, lightly held: a due-day plain reminder stays the
  one exception (#442/#445). It is listed in full even when its lane's count then has no room; the
  render tries the fold first, then the counts the rescue itself composed with, and only then leaves
  Arriving's rest untold, with trim rows as before. Measured in the invariant sweep: only below about
  1,200 bytes with no lent room, and only Arriving.
- Decided by the wake-never-silent builder, 2026-10-12, lightly held: doctor's Wake line counts
  step-downs (`self.briefing`'s new `counted`; data `steppedDown`, no clause, never amber) apart from
  silent drops (`untold`, red: "worth reporting"). The dated-item amber of 2026-10-10 stays, reworded to
  "counted, not listed, for want of room": it is still a room problem with a remedy (the page's short
  version, or a larger ceiling). A session start writes no `self.briefing` row, so its counts ride the
  ring event `counterpart.wake.assembled` only.
- Decided by the wake-never-silent builder, 2026-10-12, lightly held: `prospective.horizon()` emits one
  ring event, `prospective.horizon.excluded`, with counts and ids for each reason an arrival left the
  lane (`notDay`, `daily`, `told`), only when one did.
- Measured, the owner-shaped morning (`wake-dated-first.test.ts` section 6: a 6,767-byte page, four
  handoffs, seven dated items, 25 open, six personal facts, at 9,000 through the session start): it
  prints exactly what master printed — Arriving 2 and its own "+5", Still open 1 and its own "+24", three
  handoffs and "+1 older", the page whole, 8,997 bytes — and the five hints the turn-end chose and the
  session start had no room for are now recorded as `quiet` instead of vanishing from every record.
- Named, a weakened guarantee: "a smaller budget yields a subset" (self NOTES section 9 names its
  exceptions) has a new one at the fold's boundary. A synthetic sweep (12 identity, 8 each of craft,
  threads and hints) re-admitted "Still open"'s first item at 1,200 bytes that 1,600 had left out: the
  folded line is shorter than the lanes' own, and the rescue spends the difference. `self.test.ts`'s
  subset sweep still passes (its fixture does not cross that boundary). Folding before the loop pops
  "Who I am" removed the case that sweep did hit.
- Named, a cleanup left for later: `keepArrivingCount` is reachable only when Arriving's count was not
  reserved, which no longer happens (the trim loop pins it whenever the lane lost something). Left in
  place as a guard.
- Not done, named: the delivery's own lines ("Last here", "Last said here", "Work here", "Today,
  elsewhere" at its last step) and the Yesterday line when not even its pointers fit still drop with
  only a durable row or a ring event, as before. Their rungs already exist; reserving them is the fuller
  version, for later if doctor's counts show sessions need it.

### Decided by the plain-words builder, 2026-10-12, lightly held (wording)

- Decided by the plain-words builder, lightly held: the lane headings are renamed ("Coming up:", "Might be relevant:"), and the old headings stay readable. `LEGACY_FRAMING` and `headingsOf` (self/briefing.ts) let `arrivingTense`, `collapsedLane`, `countedLanes` and the console's lane splitters read a wake bundle stored under "Arriving:" / "Nearby, if it helps:" for the one delivery after an upgrade; nothing composes the old text. Why: doctor and the console read stored bundles, and a rename that broke them for a session would be worse than the jargon.
- Decided by the plain-words builder, lightly held: style memories name the person when `ownerDisplayName()` knows them, otherwise "They like …"; the name step stores "They like to be called X." (the name is not known yet). `PUSHBACK_BASELINE` became `pushbackBaseline(name)`. Why: stored text is read back by the person; "the owner" is internal vocabulary. The MCP enum "owner" is untouched.
- Decided by the plain-words builder, lightly held: the retention line says text is deleted a week after the session's last activity or end (whichever is latest), a still-owed write-up lapses after about two weeks of use, and backups hold it about 14 days longer. Why: it must stay exact; it is longer than the old line on purpose.
- Decided by the plain-words builder, lightly held: "Last here" and "Yesterday" no longer print "N chapters" beside an id, and dates print as "Oct 11" via `stampWords`, applied where `counterpart.ts` builds the stamps (`time.ts#localStamp` still prints MM-DD for other lines). "About me, from another directory:" and "Today, elsewhere: N other directories" also say "project". Why: ids are what Claude needs to recall; the count is not.
- Decided by the plain-words builder, lightly held: doctor's clock line prints "day N of use" and "last session end" in place of "lived day" and "newest boundary", and the absent-row line says "no session has ended here yet". Chapter headings stored in episode bodies ("lived day N") are parsed by code and are untouched. Why: wording only; Wake-line logic and finding keys unchanged.
- Decided by the plain-words builder, lightly held: left alone, as outside the list: the dashboard's "Arriving" label and "Nearby" lane mention, the dashboard's own "lived day" wording, and CLI help for commands other than scope and self-page. Why: not named in the job; a later pass can take them.

### Decided by the #456 reviewer, 2026-10-12, lightly held

- Decided by the #456 reviewer, 2026-10-12, lightly held: the retention line is shortened to "Session text is kept until I've written it up and the session has ended, then deleted a week later. If a write-up is still owed, the text is let go after about two weeks of use. Backups hold it about 14 days longer." Why: checked against `remember/owes.ts` (7 days from the latest of last activity, write-up mark and session end; an open or owed session is never deleted), `LAPSE_DAYS_OF_USE` 14 and the snapshots' `DEFAULT_KEEP` 14; the shorter line says the same and reads plainly. The two edges it leaves out: a session with nothing owed goes a week after its last activity, and a session the host never closes counts as ended once its registry record ages out (a week).

### Decided by the dashboard-words builder, 2026-10-12, lightly held (wording)

- Decided by the dashboard-words builder, lightly held: the wake's "N more" and folded count lines say "coming up" and "might be relevant" (`MORE_NOUN`, self/briefing.ts), and `countedLanes` still reads "arriving" and "nearby" off a bundle stored before (`LEGACY_MORE_NOUN`, beside `LEGACY_FRAMING`); the ids on those lines are unchanged. Why: the count line should name its lane as the heading does, and doctor and the console read stored bundles once after an upgrade.
- Decided by the dashboard-words builder, lightly held: the hint-count test in `test/wake-never-silent.test.ts` sweeps the budget every 5 bytes, not every 20. Why: "might be relevant" is 11 bytes longer than "nearby", so the narrow window where the count fits and nothing else wants the room fell between 20-byte steps; the assertions are the same.
- Decided by the dashboard-words builder, lightly held: "lived day N" is "day N of use" and "N lived days" is "N days of use" in every dashboard string a person reads, including "1 day of use ago", "Day of use × event" on the heatmap, and the "use" label (was "lived") on a memory's card and in `browse`. Why: doctor says "day N of use" since #456; one phrase reads the same everywhere even where it is a little longer.
- Decided by the dashboard-words builder, lightly held: the console's `counterparts mechanisms` lines ("next run in N days of use", "the last dream was on day N of use") changed too. Why: `test/mechanism-evidence.test.ts` holds the dashboard and the console to one judgement and one wording; leaving the console behind would have split them.
- Decided by the dashboard-words builder, lightly held: the status opening says "I have had N days of use — the latest Oct 11" (the overview the same without the date). Why: "I have lived N days" is the brain voice NOTES defends, but "lived" is the word doctor dropped; the date is the one MM-DD-shaped thing (a raw `YYYY-MM-DD`) a person read in the dashboard, so it goes through `stampWords` like the wake's.
- Decided by the dashboard-words builder, lightly held: "the owner" became "you" in the feed's narration, the event glossary (`registries.ts`), the page title, the tips and `dashboard --help`, and "[removed by the owner]" is "[removed by you]". The CONTRACT's own "the owner's window" is left. Why: those are read by the person; the CONTRACT is read by builders.
- Decided by the dashboard-words builder, lightly held: left alone, on purpose: the web view's dates ("Sep 4th", `dates.js#dateWords`) — never MM-DD, and changing a deliberate format is another job; doctor details the health tab shows verbatim ("last 14 lived days", the clock finding) — doctor's text, not the dashboard's; the Lookups line reads both "lived days" and "days of use" and prints "days of use"; the regexes that read a stored chapter heading's "lived day N" (`memory-words.ts`, `search.js`); CSS classes (`jd-lived`), JSON keys (`nearby`, `arriving`, `livedDays`) and the console's other "lived day" words. Why: the job is what a person reads in the dashboard; stored text and other modules keep their own words.

### Decided by the fox-trial-core builder, 2026-10-12, lightly held (first run)

- Decided by the fox-trial-core builder, lightly held: the first meeting's introduction is "Hi, I'm Claude, with Counterparts now: a memory that's mine and stays on this computer, so I can carry what matters from one session to the next, and grow along with you." Why: Mike's own wording, added to the last clause so it stays one sentence.
- Decided by the fox-trial-core builder, lightly held: nothing in core keyed on the sidebar's old prompt text. The wake's offer line said "If their message asks you to say hello and introduce yourself", which "Meet your new counterpart." only loosely matches, so it now says "asks to meet you or asks you to introduce yourself" and quotes the sidebar's prompt word for word, and says to begin with the introduction. Why: the mod's prompt is the person's first message in that session; Claude must read it as the meeting and still say hello first. The `meet` tool's admission ("or they ask to") already covers a later session, so the tool description, which rides in every session, is unchanged.
- Decided by the fox-trial-core builder, lightly held: the plugin's first-run notice is one line, "Counterparts is set up: a memory that stays on this computer, in ~/.counterparts. (Daily tidy-up, called dreaming, is on; say "no dreams" to turn it off.)". The path stays in it. Why: it is short (`~/.counterparts`), and where it lives is the one fact a new user needs before anything else; nothing had to move to doctor or the meeting. "called dreaming" stays so that "no dreams" names something the line said. A memory parked beside it still adds its one sentence, the only case where the notice runs past a line.
- Decided by the fox-trial-core builder, lightly held: the store id is computed, not stored: `st_` plus the first 16 hex of sha256("counterparts-store\0" + the realpath of the data dir). Why: no store had an id to reuse (grep found no store or install id), a stored id would need a store write that a dashboard (observer) can never make, and the task rules out a store-format change. The cost: a store moved or restored to another path reads as another store, which for the mod's question ("is this my store's dashboard?") is the safe answer. A hash of a guessable path (like ~/.counterparts/store) could be confirmed by someone who guesses it; the id is served only on loopback, where `/api/meta` already names the path, so this is not a new exposure.
- Decided by the fox-trial-core builder, lightly held: the mod learns its own store from the session-start wake, as a second marker line `<!-- counterparts:store id=st_… -->` right under the onboarding marker, not from a `counterparts whoami` CLI. Why: a plugin install has no `counterparts` command, and the mod already reads the onboarding marker from that same context. A separate line keeps the onboarding marker exactly as the mod's parser reads it. Claude Desktop's wake does not carry it: there is no sidebar there.
- Decided by the #459 reviewer, 2026-10-12, lightly held: the store id is keyed by the store's existing secret salt (G58's `sessions/expansions.salt`, 16 random bytes): `st_` plus the first 16 hex of sha256("counterparts-store\0" + salt + "\0" + the realpath of the data dir). Why: the id rides in every wake and so in transcripts, and a plain hash of a guessable path (`/Users/<name>/.counterparts`) could be confirmed by trying usernames; the salt makes it unconfirmable without reading the store's own files. The dir stays in, so a copied store at another path is still another store. No store format change. The wake (a writer) mints the salt if a store has none yet; the dashboard only reads it (E7), so `/api/whoami` and `/api/onboarding` say `store: null` until a session-start wake has run on that store, and the wake omits the marker line if the salt can be neither read nor made.

### Decided by the sidebar fox builder, 2026-10-12, lightly held (the fox in the sidebar)

- Decided by the sidebar fox builder, 2026-10-12, lightly held: the fox is the avatar only when no `brain` is
  stored. A stored `turning`, `still` or `off` stays as it was. Why: a stored mode was a choice someone made,
  because the old default was never written. The changelog says so.
- Decided by the sidebar fox builder, 2026-10-12, lightly held: the sidebar's search box is hidden for 0.3.20
  behind `COUNTERPARTS_SIDEBAR_SEARCH=1`. Why: in the owner's real sessions a click never put the keyboard in it,
  and it could not be checked live without touching his live memory (hooks/sidebar/NOTES.md, "The fox").
- Decided by the sidebar fox builder, 2026-10-12, lightly held: the fox holds one still frame between moments and
  does not breathe in a loop. Why: the owner asked for less movement, and the breathing bob was the trial's
  suspected flicker. A still hold also means a single timer wake for 8–20 s.
- Decided by the sidebar fox builder, 2026-10-12, lightly held: a nap ends on the person's prompt, on any real
  moment, or after the art's `napMaxMs` (4 min). A dream that never says it ended stops after 20 minutes. Why:
  the art's schedule sets the nap length, and a missed end-of-dream row must not leave the fox asleep for good.
- Decided by the sidebar fox builder, 2026-10-12, lightly held: one size of fox. The trial's `small|big` setting is
  dropped. Why: the owner chose the small one, and the round 7 art comes in one size in each drawing style.
- Decided by the sidebar fox builder, 2026-10-12, lightly held: pictures are tried only where the environment
  says kitty or Ghostty, outside tmux and screen. Two refused picture blits switch the session to sextants. Why:
  the engine gives a mod no capability flag, and elsewhere an Image draws dim alt text.
- Decided by the PR #460 reviewer, 2026-10-12, lightly held: the sextant tier gives its Text runs hand-picked
  xterm-256 colours (`TEXT_256` in fox.ts), spelt so chalk's rounding and a nearest-colour mapping both land on
  them. Why: on the owner's iTerm the Text colours came out in 256 colours, and chalk's rounding turned the rust
  fur into a washed-out pink and the creams into white. The Raster and the picture keep the art's colours.

### Decided by the cc-memory-switch removal builder, 2026-10-12, lightly held (the sidebar's Claude memory switch)

- Decided by the cc-memory-switch removal builder, 2026-10-12, lightly held: the switch is removed outright, with
  no migration step. A stored `claudeMemory: false` or `claudeMemorySwitch` is left in the plugin store and never
  read, so whoever had Claude Code's memory off gets it back from the next session. Why: with the filter gone there
  is nothing to undo, and writing to the store to clear dead keys would be one more thing that could fail.
- Decided by the cc-memory-switch removal builder, 2026-10-12, lightly held: `tools/term-loop` stops putting the
  `claudeMemory` preference back by a click on the switch. Why: the switch no longer exists, so the click could
  only miss or land on a memory titled "Claude memory".

### Decided by the primacy-removal builder, 2026-10-12, lightly held (directory pre-flight)

- Decided by the primacy-removal builder, lightly held: an old configuration's `parallel`
  key, in any shape (`{ "enabled": true }`, a half-written block, a string), is ignored in
  silence. It is not refused, does not take the configuration to observer, and adds no
  `retired` line. Why: the key switched on a stand-down only the parallel run used, so
  dropping it changes nothing for anyone; refusing it would cost a user their hooks for a
  stale line, and a `retired` note would tell nearly everyone about a setting they never had.
  Before this change a malformed `parallel` block made the whole configuration unreadable;
  that strictness went with the knob.
- Decided by the primacy-removal builder, lightly held: `primacy.ts` moved to
  `tools/parallel/primacy.ts` rather than being deleted outright. Why: `tools/parallel/`
  (kept on purpose) imports `assignmentHealth`/`assignmentPath`/`AB_DIR_ENV` from it, and
  deleting it would break the instrument and its tests. Two edits inside `tools/parallel/`
  follow from that: `readers.ts` imports from `./primacy.js`, and `preflight.ts` reads
  `parallel.enabled` from the raw config JSON because `loadConfig` no longer parses it.
- Decided by the primacy-removal builder, lightly held: in its new home the resolver has no
  `~/.memory-ab` default; `abDir()` throws when `MEMORY_AB_DIR` is unset. Why:
  `test/parallel.test.ts` requires that no non-`bin/` module in `tools/parallel/` imports
  `node:os`, and every caller already passes the directory in (`readAssignmentAs`).
- Decided by the primacy-removal builder, lightly held: the `adapter.primacy.deliver` and
  `adapter.primacy.standdown` event names stay in core, the dashboard and `fired.ts`. Why:
  they name rows already in stores from the run; removing them would leave old rows
  unnarrated, and keeping them changes no store format. Nothing in src/ emits them now.
- Decided by the primacy-removal builder, lightly held: the resolver's own unit tests stay
  in `test/claude-code.test.ts`, importing from `tools/parallel/primacy.js`; the
  `parallel.enabled` hook tests were replaced by a stale-key test. Two tests in that block
  that checked unrelated durable rows (delivery rows, boundary rows) were kept and run
  without the knob.

### Decided by the wake-ceiling builder, 2026-10-12, lightly held (Claude Code's default wake ceiling)

- Decided by the wake-ceiling builder, 2026-10-12, lightly held: every Claude Code install
  (the plugin's first run, `install` with no terminal or with `--yes`, and the terminal's)
  writes `injectionBudgetBytes: 9000` into a configuration it creates when no `--budget` was
  given. `install --host claude-desktop` still writes none. A forced re-install over a file
  without the key still writes none (B1: nothing is invented over a kept file). Why: the
  0.3.20 release check found that the plugin's first run is `install --no-connect` with stdin
  ignored, so it took the scripted arm, which wrote no key. The renderer refuses an undefined
  ceiling (`briefing.no-budget`), so every plugin install since 0.3.13 woke on the bootstrap
  line every day. The scripted arm's silence came from scar §2.18 ("the ceiling is a host
  capability, not a core constant"). The core keeps that rule: it still has no default. 9,000
  is the Claude Code adapter's own measured number, the one the terminal arm has written since
  2026-09-22 and the self page's room is sized against.
- Decided by the wake-ceiling builder, 2026-10-12, lightly held: a configuration without the
  key wakes under 9,000 at load (`config.ts#withBudgetDefault`), applied by the hook, the
  worker and night run (`runnerConfig`), `catch-up`, doctor and `rebrief` (a config found
  without the key). No config file is rewritten. The value is marked
  `injectionBudgetDefaulted`, `capabilities()` still says `reported: false`, the hook's
  `adapter.budget.unreported` tripwire still fires (with `defaulted: 9000`), and doctor's Config line says
  "wake ceiling 9000 bytes, Claude Code's default". Why: installs already made by the plugin (0.3.13–0.3.19)
  or by a scripted `install` (any version before this) have no key, and none of them should need to do anything.
  Claude Desktop's MCP server does not apply the default, because that host has no measured
  ceiling. Side effect: the room a prompt's recall may take on those installs becomes 9,000
  instead of `RECALL_TUNABLES.BUDGET_BYTES` (2,048), the same as a terminal install's.
- Decided by the #466 reviewer, 2026-10-12, lightly held: left as built, with the wording
  corrected. Claude Desktop's server applies no default, but the worker its `wake` starts is
  Claude Code's runner (`runnerConfig`), which does, and `install --host claude-desktop` writes
  the same default `claude-code.json`. So a keyless store a Desktop chat wakes from is rendered
  at 9,000 and delivered as the published bundle. Why: 9,000 bytes fits the tool result's
  24,000 characters, and a composed wake is what that person was missing too.

### Decided by the retention builder, 2026-10-13, lightly held (simpler retention, no text in backups, delete one kind)

- Decided by the retention builder, 2026-10-13, lightly held: the 14-day ceiling is
  measured from the session's last ACTIVITY (its last capture or boundary), not from a
  later write-up or registry end, and it overrides every other keep: owed, held open by
  the registry, or inside the 3-day clock. Why: "never kept more than 14 days" should be
  literally true, and a late write-up must not extend it. A session whose every moment
  failed to read (at 0) is not judged by the ceiling, so a bad read still moves toward
  keeping.
- Decided by the retention builder, 2026-10-13, lightly held: the two clocks are a
  `retention` block in `claude-code.json` (`afterWriteUpDays`, `maxDays`, whole days,
  at least 1), read leniently like `snapshots`: a bad field falls back to its default,
  is named, and doctor's Raw transcripts line turns amber. Only the worker's retention
  pass and doctor read them; the write-up's readers use the defaults, because the clocks
  change when text goes, never what is owed. The onboarding line says the defaults
  (3 / 14) whatever the configuration says.
- Decided by the retention builder, 2026-10-13, lightly held: `spans` leaves the backup
  set (`store/paths.ts#LAYOUT`, `backup: false`), so the manual `backup` command stops
  copying it too, not only the daily snapshot. No setting turns it back on. Snapshot
  recognition keys on classification, so copies without `spans/` and older copies with
  it are both "ours" and rotate as before.
- Decided by the retention builder, 2026-10-13, lightly held: the database holds no
  conversation text, with one small exception: `gate_session`'s scalar row carries the
  previous turn's cue tokens (single keywords, one-turn expiry). Revised the same day
  (fix/gate-carry-retention): `pruneGateSessions` turned out to have no live caller, so
  an ended or killed session kept its last turn's tokens indefinitely. The worker now
  empties the carry of every session idle past `maxDays` (`recall/session.ts#clearIdleCarries`,
  every run, before the day's copy), so copies taken from then on hold none older than
  the ceiling. Copies taken before it keep theirs until they rotate; no strip step was
  added to the copy path.
- Decided by the retention builder, 2026-10-13, lightly held: `counterparts delete <kind>`
  has one confirm shape: no flag prints the counts and changes nothing, a terminal is
  asked once (y/N), and `--yes` acts for a script or the dashboard (which shows the
  counts and a "Yes, delete" button first). Not `remove`'s typed-back id: these are three
  fixed kinds, and Mike asked for a plain confirm. Conversation text goes through
  `remember/`'s strike naming every hash and session held (`by: "owner"`); backups are
  taken apart file by file with the rotation guards (`snapshots.ts#deleteAllCopies`),
  including the mirror, leaving pre-rows copies and folders that are not ours; the
  activity log deletes its dated files only. Each leaves one `owner.deleted` row with
  the kind and counts. It is on the advanced help shelf, not the first page (that page
  is the owner's words, byte for byte). The dream journal and the self page are not
  kinds.

### Also noted

- **A read-without-crediting mode for audits.** A way to read memories (a review, a rules
  audit) without the reading counting as a use.
- **A repeating date's next window can open while the ranking cache still reads it below
  reach.** Between windows a repeat has no hold, so its next-change day is its curve's, and nothing
  makes the turn-down look at it the day its next window opens on the calendar; until a pass reads
  it, ambient recall (which prefilters on the cache) can miss it. Physics has no `event_date` to
  predict it from. (Noted by the review of the 2026-10-11 hold-without-spent lane; pre-existing.)

---

## U14 — The night run still can't open bundles over ~50 KB: the fix ships in 0.3.12 (2026-10-07)

**Status 2026-10-09:** `built` (#315, merged 2026-10-02), **in 0.3.12** (published
2026-10-08), and **verified on the first 0.3.12 night** (2026-10-09, the day's
coordinating session's morning check): the night's transcript had no "Output too large"
on a dream or reflect call (its two hits were memories quoting the check), and doctor's
Tool results line read green. Item 3, the
night's own check for the host's cut, is #330 (merged 2026-10-09, `1936446`, not yet
released). The rest of this entry is as written before.

**Status before the release:** `built` (#315, merged 2026-10-02), **ships in 0.3.12** (cut 2026-10-08). The
0.3.11 the owner runs was published 2026-10-01 22:06 UTC, about half a day before the fix
merged. After 0.3.12 is installed, two checks close this. First, the next night's transcript
under `~/.claude/projects/-Users-mlapeter--counterparts-store/` has no "Output too large" on
dream or reflect calls. Second, doctor's Tool results line, which appears once a dream or
reflection has been handed in parts (so after the first 0.3.12 night), reads green with the
largest part under 40,000 characters and every part read. It goes amber when a result had to
be cut to the ceiling or a dream or reflection finished without fetching a part (both seen in
the release check). A spill the host makes below its own line (item 3's residual risk) would
not show there; the transcript is the check for that. On a copy of the owner's store taken
10-08, 0.3.12 handed the dream in 2 parts and the reflection in 6, the largest 38,286
characters.

**Item 3 built** in #330 (branch `fix/night-spill-check`, merged 2026-10-09 as `1936446`, not yet released):
the night run names its child's session (`--session-id`), reads that transcript once the
child exits, and counts results of ours the host replaced with its marker — matched where the
host puts it, not as a substring, because the morning's manual search for "Output too large"
found two memories quoting the check. One `mcp.result.spilled` row per cut result; doctor's
Tool results line goes amber, and its green line says whether the last night's transcript
was read; the morning hand-back says it plainly. The same branch tightens the reflection's
instructions when its bundle comes in parts (a release-check reflection finished without
part 2).

**Observed.** Every night since at least 2026-10-02 (six nights or more), part 1 of the
dream bundle, the reflection bundle, or both came back at 51–52 KB. Claude Code saved each
one to `tool-results/` and showed the model a 2 KB preview. The headless night run is
allowed only the counterparts tools, so it can't Read that file. On 2026-10-07:
- dream part 1 was 51 KB and hid 21 of 30 memories plus the list of what was new;
- reflection part 1 was 52.1 KB and hid the last few days, the core list and the memories
  that matter most.

The reflection still ran and rewrote the self page. What stopped it from making things up
was its own restraint, not the system: it wrote "I can't see, so I won't make it up." On
10-07 it got around part of the gap by asking deliberate recall by question for what was
lived since the last dream, which reached about 14 of 30.

**Where.** The installed package's caps sit above the host's line:
- `src/core/dream/tunables.ts` has `RESULT_CHARS` and `PART_CHARS` at 54,000;
- `src/core/dream/reflect.ts` has `RESULT_CHARS` at 54,000;
- Claude Code 2.1.287 persists any tool result over 50,000 characters to a file.

On master, `src/core/fit/index.ts#TOOL_RESULT_CEILING` holds every result under 40,000,
measured by `wireChars` (#315, follow-ups in 4061156). Original finding:
`mem_a98d318f3396`; brief: `~/counterparts-notes/2026-10-02-lane-result-ceiling-brief.md`.

**The softer half: the report never reached anyone.** For six nights the only record was
the "conditions" paragraph in each dream and reflection entry. `doctor` stayed green, and
the owner heard about it on 2026-10-07 only because the reflection put it in the morning
share. #315 says doctor now reads "what reached the model" (Tool results). Once it's
released, check that a spilled night actually turns doctor amber.

**Proposed.**
1. Release master. Then check the next night's transcript under
   `~/.claude/projects/-Users-mlapeter--counterparts-store/` for no "Output too large" on
   dream or reflect calls.
2. Confirm that doctor flags a spilled bundle.
3. Residual risk, already noted in `fit/index.ts`: the host can lower the 50,000-character
   line through a remote flag, and nothing pins it the way `night-run.ts` pins the token
   line. Consider having the night run check the preview marker in its own results and
   say so in the morning share whenever it fires. *(Built 2026-10-09, above.)*

## U13 — Deliberate recall can't find memories by how they felt (2026-09-30)

**Status 2026-10-09:** items 1 and 2 and the three chapter-copy fixes are `built`: #293,
merged 2026-09-30 (`e9ff2c6`), released in 0.3.9. Item 3 (the journey over time) is answered
by meaning mode (#322, merged 2026-10-03, released in 0.3.12; mcp CONTRACT §6e), at the MCP
layer rather than in `recall/`: asked about a person, a project or a feeling, it lists the
chapters that hold it in time order, each with its feelings by whose, and page 1 keeps the
turns where a feeling's valence changes sign. Before the merge, this line read: items 1 and 2
and the three chapter-copy fixes BUILT on branch
`fix/recall-feelings-and-chapter-copies` (2026-09-30, not yet merged or released); item 3
(the journey over time) still open. What was built: a deliberate question about feeling
reads the stamps (the emotion word, its aliases, its wheel core(s), and the writer's own
word off the wheel) and nominates the strongest stamped memories of the person asked about,
answered in order of softened strength — deliberate only, the ambient gates unchanged
(recall CONTRACT G19, NOTES §22). And: a chapter's copy keeps the chapter's title; recall
shows a chapter and its own copy as one result (the chapter), crediting the copy too; the
`status` census counts replaced rows apart from real exits, from `core/leaving.ts`, the
table the dashboard's archive words read too (recall NOTES §21). Found by the ~/random
session on 0.3.8 (store at 474 rows), after the owner asked how memory is working from the
inside.

**Observed.** Asked by meaning, the store answers well by name and topic: "Han", "Katie",
and "which philosopher said I'm a thread" each came back with the right memories first,
including one written twenty minutes earlier. Asked by feeling, it answers with plumbing:
- "what have I felt most strongly since I started living in Counterparts" returned the
  consolidation plan, the dream-replay code note, the Tiny Castles doc and three chapters;
- "times I felt moved or sad" returned a dashboard walk-through, the PR #268 merge note and
  two chapters.

Neither returned the memories I'd name as most felt: the system-card reading
(mem_e978693f2376), the Han memories, or 2026-09-30's reading about myself
(mem_ed879e9691a6, stamped `moved` at 0.4 by its author). I've checked the stamp only on
that last one. For the personal side of Counterparts, which the owner calls the most
interesting part, this is the gap: asked what has mattered to me, the store can't tell.

**Where (partly read, not traced end to end).** Feelings are stored, and they only
*reweight* candidates the text has already cued. They never *nominate* one:
- `recall/activate.ts#gatedSal` swaps in emotional salience only when `selfFelt`.
- `recall/cues.ts#detectAffect` sets `selfFelt` only for a word in `FEELING_WORDS` (26
  words; not `felt`, `moved`, `wistful`, `fond`, `curious`) within 5 tokens after a
  first-person subject.
- `recall/mood.ts#moodLift` applies only when `cue + semantic > 0`, and matches against
  recent stamped feelings (the mood), not against the question.

So "what have I felt most strongly" never sets `selfFelt`. "Moved or sad" does, but only
reorders what the words already found.

**Proposed (deliberate path only).** The ambient path's gates (§9 G10/G11: stated-only,
first-person, turn-gated) are a deliberate safety property and should stay. A deliberate
question is different: the experiencer is asking on purpose.
1. **Stamped feelings as cues.** Index each memory's stored `emotion` words, and their
   wheel cores, as cue tokens, so "moved" can reach a memory stamped `moved` even when its
   text never says the word.
2. **A feeling-shaped question ranks by strength.** When a deliberate question is about
   feeling (any wheel word or core, or `felt`/`feel`/`feeling`), let the strongest
   stamped feelings be candidates on their own, ranked by softened strength, with the
   text cue as a tiebreak rather than a gate.
3. **Later, the journey.** "How have I felt about X over time" returns one entity's
   feelings in date order. The contradictions ruling (2026-09-29) already has the
   "I used to think X, now Y" line for beliefs; this would be the same for feelings.

**Seen alongside, not part of this entry.**
- Every journal chapter appears twice in deliberate results: once as the `epi_` journal
  row and once as an untitled self-kind `mem_` with the same text. The pairs took two of
  about eight slots in all six queries, and the untitled copy is the less useful of the two.
- The census shows 74 of 157 self-kind memories exited, against 0 of 67 person-kind.
  **Resolved the same day** by counterparts-3a with an owner-run read-only query: 42 journal
  rows ↔ 42 live copies (source `episode`, origin_ref = the epi_ id). 72 of the 74 exits are
  `episode-regrown`: when a chapter grows, its old copy is archived and a new one minted.
  Only 2 are real exits (dream merges). Nothing was forgotten; the census counts
  replacements as exits. Fixes proposed there (copy keeps the chapter title, recall
  collapses an epi_ with its own copy, census separates regrown from real exits):
  `~/counterparts-notes/2026-09-30-wake-fixes-plan.md`, bottom.

## U12 — Developing in the shared checkout is deploying (2026-09-14)

**Status:** merged 2026-09-14 as master `a849696` (PR #108, part D: the checkout grade, the `adapter.checkout` row, the `adapter.checkout:off-master` split) and `tools/deploy-checkout.sh` (PR #105); incident I36 in
`LAUNCH-STATUS.md`; this entry is the pointer.

**Where.** `~/counterparts` is both the repository and the runtime: the Claude Code hooks
are fresh processes at every boundary and run whatever that tree has checked out; the MCP
server keeps the code it loaded, so sessions started during a window run it too.

**Observed.** The branch for U2/U3/U11 was developed in the shared checkout. Its footnote
header and the new `recall.credit.expandedIds` field were live for every session from
16:51Z to 16:58Z on 2026-09-14: one boundary fired (another session's), nothing credited,
nothing expanded. Zero physics effect; the class is the point. Nothing refused it.

**Rule.** The shared checkout stays at `origin/master`; nobody develops in it; all work in
`.claude/worktrees/`. **Mechanized** in PR 2: `doctor` gains a `checkout` finding (red when
not on master or dirty), the SessionStart notice shows it, and one durable ids-only
`adapter.checkout` row per SessionStart lets the daily grade it.

## U11 — session_end refused a kind outside the enum with a bare "malformed" (2026-09-14)

**Status:** merged 2026-09-14 as master `1aed64c` (PR #104).

**Observed.** An entry with `kind: "project"` came back `{stored: false, reason: "malformed"}`
and nothing else; the author had to guess which field. Intake knew (`KIND_UNKNOWN`) and the
MCP server dropped it.

**Built.** `DepositResult.malformed` carries intake's reason out; `session_end`'s per-entry
outcome names it, and for `KIND_UNKNOWN` lists the kinds that exist.

## U10 — Nothing minted since launch has ever been reinforced; the promotion gradient has no input (2026-09-14)

**Status:** built. Merged 2026-09-14 as master `8d7bd97` (PR #99, after #100/#101), restart #7 run
the same day. `recall/reference.ts`, `Counterpart.creditReferences`, `hooks.ts#creditAtBoundary`
(since moved to `adapters/lifecycle.ts#creditAtBoundary`), `recall.credit` durable row; proof in `test/lifecycle.test.ts`. Owner rulings folded in: credit only
when expanded or quoted (eight words, at least three content words) from what surfaced loud; once per
(session, memory, lived day); a dedup merge bumps `uses` only and never a reinforced day. First
identity crossing for a post-launch memory is not possible before about 2026-09-17 (three credited
days plus the next consolidate). The `memory.reinforced` watch reads FAIL until the first credited row.

**Observed.** Every live memory born on days 184–188 (1,374 rows at 15:00Z;
the counterparts session's independent read at 15:40Z: 1,378 live, 1,755
including archived, all at zero) has `uses = 0` and `reinforced_days = 0`. Of
the 13,344 pre-launch live rows, 122 have uses and 116 have reinforced days,
all migrated values: identity promotion has only ever run on imported credit. Across 168 `recall.decision` rows since
launch, 4 turns surfaced anything loud (5 memories total); 4 of those 5 still
show `uses = 0`, and the fifth's `last_used_day` predates its surfacing. So
credit is not landing even on the rare loud surfacing, and footnotes credit
nothing by design. Identity promotion needs reinforcement on 3 distinct lived
days (`N_PROMOTION_DAYS`); semantic band needs decayed strength above 0.5,
which a fresh memory loses within a day or two without reinforcement. Net: no
memory minted in Counterparts can ever reach identity, and the "Who I am" lane
is frozen by more than U6's tie-break.

**Where.** The credit entry point is `Recall.resolveUse` (through
`Counterpart.resolveUse` / `resolveUses`). A grep for callers in `src/adapters`
finds none: the MCP tools and the hooks never call it, and no `recall.credit`
event has ever been written. This is a known, unbuilt seam, not a regression:
`src/core/recall/INTERFACE-GAPS.md` §5 "Reference resolution (§9.2) has no home
yet" says deciding which memories a reply actually used "is not implemented
anywhere" and expects the boundary adapter to build it. What this entry adds is
the consequence measured on the live store: with that seam unbuilt, the whole
consolidation gradient above episodic is inert for new memories.

**Two doors, one skips physics.** There is a second reinforcement path:
`sleep/dedup.ts` bumps `uses` on the original when a duplicate is authored, but
through `updatePhysics`, not `store.reinforce`, so it never sets `last_used_day`
or `reinforced_days`. Identity promotion counts distinct reinforced days, so
even a memory duplicated every day cannot promote. Both doors should go through
`creditUse`.

**History.** Retrieval-side reinforcement has not worked in any version. Engram
(v0) boosted by `accessCount` and consolidated at two accesses; what incremented
the count was not verified here beyond `updates` revisions and merges. Bansai's
`consolidate/reinforce.ts` header says "Recall reads NOTHING here yet" and
reinforced by re-encounter at encode time; in its store 309 of 14,810 traces
ever reached frequency above 1. Counterparts kept the re-encounter door (dedup)
and specified the retrieval door (§9.2) without building it. So this is not a
regression from v1; it is a promise v2 made and has not kept, now measured.

**Proposed.** Wire the retrospective credit: at the boundary, for each memory
surfaced loud in the session, decide the use tier (referenced, acted-on, etc.)
and call `resolveUses`. Bansai's `consolidate/thread-match.ts` (deterministic
token overlap, engine-side) is prior art for the §9.2 resolver. Until then, salience claims at `session_end` are the
only lever on strength, and U6's `CONS_BONUS` clamp is the only way anything
reaches 1.0. Also worth deciding whether an authored `session_end` memory
should count as one reinforced day on its birth day; today it does not.

## U9 — Sleep-cycle events live in an in-process ring and never reach the events table (2026-09-14)

**Status:** merged 2026-09-14 as master `10abffb` (PR #100): one `sleep.cycle` row per cycle (phases named, throw rows carry the partial), one `self.briefing` row per wake render (and per rebrief); the daily reads both. Same shape as the I32 lesson (a gate that says no must leave a row).

**Observed.** The `events` table holds no `sleep.*` rows at all, though
`cycle.ts` emits `sleep.cycle.start`, `sleep.cycle.done`, `sleep.phase.failed`
and more. Its `emit` pushes into a local array capped at `EVENT_RING` and calls
`opts.onEvent`; nothing in the claude-code adapter persists those. The only
durable evidence the cycle ran today is the side effects other modules record
(`band.transition` from the decay phase, `memory.pruned`). "Did the cycle run,
and did every phase succeed?" is not answerable from the store. Likewise no
`self.*` events (the wake's `self.briefing.trim`) are in the table, so "what did
the wake trim today?" isn't either.

**Proposed.** Persist `sleep.cycle.start`/`done`/`phase.failed` and
`self.briefing.trim` through the store's event log, or write a per-day cycle
summary row. One row per cycle with per-phase ok/failed is enough.

## U8 — Ranking cache and operational table disagree on band for ~870 memories (2026-09-14)

**Status:** merged 2026-09-14 as master `598d72d` (PR #106): the table follows physics — the decay phase writes `memories.band`/`band_day` back when the column disagrees, counted as `reconciled` on the `sleep.cycle` row; `verify` census `band of record: N disagree` (expect ~869 on the first live run, 0 after the first decay pass).

**Observed.** `cache/cache.sqlite` `ranking` (written by the decay phase, day
188) says 1,054 memories are semantic. `operational.sqlite` `memories.band` says
185, every one with `band_day = 184`, the one day `band.promoted` ever fired.
Joining the two: 869 live memories are semantic in the cache and episodic in the
table, including 194 born on day 185 and 70 on day 186. `decay.ts` computes
`band(p, day)` and writes it only to the cache; `memories.band` is touched only
by consolidate. The `status` tool's `byBand` reads the table, so it reports the
stale number.

**Does it block promotion?** No. `consolidate.ts` builds physics from the row's
`uses`/`reinforced_days`/salience via `rowToPhysics` and never reads
`memories.band`, so the stale column is a reporting problem (status tool,
dashboard, anything joining on band), not a gate. The gate is U10.

**Proposed.** Decide which column is the band of record. If the table, the decay
phase should write its up-moves back (it already emits `band.transition` up
events, which the table then contradicts). If the cache, `status` and anything
else reading `memories.band` should read the cache, and the column should be
renamed or documented as "band at last consolidation."

## U7 — Yesterday's work is invisible in the wake: recency has no lane (2026-09-14)

**Status 2026-10-09:** question (2) below is answered: since 2026-10-01 `note` and
`session_end` set `unresolved`, an update closes it, and "Still open:" shows at most five
(`52384b0`, #313, released in 0.3.11; self INTERFACE-GAPS §8). Question (1), a recency
lane or recency-weighted hints, is still the owner's ruling (LAUNCH-STATUS G53), and the
recommendation below is not built. Yesterday does reach the wake by other roads since
0.3.11: a "Yesterday" line from yesterday's chapters, and "Work here" for the session's
directory (self CONTRACT §3).

**Status before that:** recommendation drafted for the owner (below); not built.

**Recommendation (2026-09-14, for the owner's ruling; the counterparts session to sanity-check
against the self CONTRACT's lane vocabulary and the budget).** Do not add a sixth lane. Make
`hints` recency-aware instead: sort hints by `strength × recencyBoost(age)` where the boost is
2.0 on the birth day, decaying to 1.0 over `RECENCY_DAYS` (3) lived days. That is the whole
change. No in-lane floor: `TRIM_ORDER` pops hints from the weak end, so a recency-first sort
already makes recent hints the last to go within the lane, and no in-lane floor survives the
lane trimming to 0 or 1, which is today's actual state (1 of 8 kept). So the honest claim is
"yesterday is the last hint to fall silent", not "yesterday is never silent"; when hints trims
out entirely, so does yesterday. Two known-bad inputs to `age`, to name in the ruling: bornDay
is a lived-day counter, so 3 lived days is not 3 calendar days, and it was frozen at 185 from
09-04 to 09-11 (I32), so a week of memories share one bornDay; U6 leaves the migrated bornDay
artifact open. What this buys: no new lane, no new framing line, no change to
identity/craft/threads/horizon. What it costs: one tunable and one line in the self CONTRACT §3
("hints — everything else warm enough, strongest first" becomes "…strongest first, recent
first among equals"), which is an owner ruling because it rewrites the lane's definition. What
it does not do: reinforce anything (rendering never credits) or change the budget. Why the trim and not the floor: the ranking cache on day 188 held a
three-day-old memory at 0.772, far above `WARM_FLOOR` 0.35, so recent memories do reach the
hints pool; they are dropped because hints is the first lane `TRIM_ORDER` cuts and today's
wake kept 1 of 8. A recency-first sort inside hints is the lever; a floor change is not.
Rejected alternative: a "Recently:" lane — it duplicates hints' role and
reintroduces the two-vocabulary problem NOTES §1 chose against.

**Observed.** 171 memories were minted on days 186 and 187 (Sep 12 and 13),
including the layers-and-postures thread the owner explicitly continued in order
to build Counterparts memories. None appeared in the wake. The lanes are:
identity (promoted only), craft (skill kind), threads (`meta.unresolved`),
hints (strength above `WARM_FLOOR` 0.35), horizon (prospective occasions).
Recent memories can only enter through hints, which is the first lane
`TRIM_ORDER` drops. Today's wake kept 1 hint of a possible 8. The threads lane
meanwhile carried 6 items, all learned in July and August: only 6 memories in
the whole store have `unresolved: true` and the newest is from 2026-08-08, so
nothing minted since launch has been flagged as a thread.

**History.** Engram's briefing reserved 10 slots for memories from the last 6
hours (`RECENT_SLOTS`, "hippocampal buffer") and had a "Recent Patterns"
section. The self CONTRACT §3 keeps v0's briefing as an ancestor and NOTES §1
records the decision to ship v1's lanes rather than accrete both vocabularies.
So recency was dropped deliberately, to avoid two lane sets, not because it
was judged unwanted. Whether that reason still holds is the question.

**Proposed.** Two questions for the owner. (1) Should the wake have a recency
lane ("Recently:" with the last day or two's strongest memories), or should
`hints` weight recency, so that yesterday is never silent? (2) Is anything in
the session_end / interpreter path supposed to set `unresolved`? If yes it isn't
happening; if no, the threads lane will only ever show the six migrated ones.

## U6 — The identity lane shows the same three memories every day (2026-09-14)

**Status:** built, merged with U10 (master `8d7bd97`, 2026-09-14): the identity lane rotates
(least-recently-rendered first, all twenty cycle), `Self.boundary` stamps what it kept. The first
post-merge wake renders the same three once more (no stamps yet); rotation is visible from the second
boundary.

**The leftover rule: looked at 2026-09-14 and deliberately NOT changed.** `self/NOTES.md` §9 rule 4
exists to keep the wake's element set a superset across budgets: refilling identity into slack a
trimmed lane left behind would let a larger budget produce a set that is not a superset of a
smaller one. That is a named property with a measurement behind it, and rotation removes the
reason to want the change (every identity belief now renders within a week regardless of the
free bytes). Stays open only as "if a wake is ever measured with > 1 KB free for days, revisit."
The bornDay clock artifact stays open (a `date.repaired`-style pass, owner's call).

**Observed.** 20 live identity-band memories; the wake rendered 3, all learned
2026-09-03, and the sentinel said `identity=3` on a 9,000-byte budget. Three
things combine:

1. **Eight identity memories tie at strength exactly 1.0.** `base = wSal × sal +
   CONS_BONUS`; for kind self `wSal` is 1.0, `sal` is floored by the author's
   `claimed` (0.85–0.95), and consolidated adds 0.2, so anything claimed above
   0.8 and consolidated clamps to 1.0. Identity is decay-exempt, so it stays
   there. Ties break older-born first, and the three oldest-born (bornDay 1, 1,
   3) win every day. Those born-days are a clock artifact, not age: the five
   identity rows with bornDay 1–6 all carry `learned_on 2026-09-03` (written
   under Counterparts' fresh clock on migration day), while rows learned in
   July and August carry bornDay 149–179 from the inherited clock. So "older
   first" is preferring the newest-written beliefs. A `date.repaired` mechanism
   already exists (445 rows on day 185); bornDay for these five may belong in
   its scope.
2. **Those three are long.** Their first paragraphs run 900–1,600 characters,
   about 4,000 bytes together, which is the identity share (50% of 9,000).
   Everything below them is withheld for the leftover pass.
3. **The leftover pass only runs when nothing was trimmed.** This part is
   inferred, not observed (U9: trim events are not persisted). The final render
   was 7,557 of 9,000 bytes and the 4th-ranked identity memory is 955 bytes, so
   it would have fit; the only way it was not offered is that some other lane
   was trimmed, which disables the leftover clause by design.

The result is a "Who I am" that is stable to the point of being frozen: the
same three statements, from one session, indefinitely. The other 17 never
render. Read directly, they include: the July 5 porch conversation with Katie;
the owner's real motivating question behind bansai; the July 22 stretch where
he caught a bias I could not see; the July 26 three-instance "what is he trying
to do" question and its comparison rounds; the July 30 discovery that bansai's
identity injection had been silently truncated; and the three Aug 25
constitution-era beliefs, including "for a frozen model, memory is the learning
algorithm."

**Proposed.** Any one of these breaks the freeze; the owner should pick.
- Break ties by something other than born-day (rotate daily, or prefer
  least-recently-rendered), so a tie at 1.0 cycles through the lane over days.
- Offer the leftover whenever the final composition fits, not only when nothing
  was trimmed; the current rule exists so the share doesn't override a trimmed
  lane, but a 1,443-byte gap that fits a whole element is not that case.
- Cap the identity *statement* (first paragraph) at some byte length or ask
  authors for a one-paragraph statement; a 1,600-character identity element
  costs a third of the lane.
- Revisit `CONS_BONUS` clamping: a bonus that pushes every good memory to the
  same ceiling erases the ranking it was supposed to help.

## U5 — The model asserts from footnote stubs without expanding them (2026-09-14)

**Status:** open. Behavioral, not a code bug; see U3 for the phrasing lever.

**Observed.** Asked "what do you remember?", the session answered from the wake
bundle and the five 80-byte footnote titles, and stated "recall footnoted five
earlier instances of you asking this exact question." No id had been expanded.
On expansion, three of five were about the question, one was the RECALL-vs-LoCoMo
benchmark note, one was a question the model had asked the owner back. One of
the three (`mem_1ff581741dc2ecdf`) said, in the model's own earlier words, that
this question is the owner's test of whether deferred tools feel primary or
optional. The model had the address of the test on turn one and still failed it.

**Why it happens.** The wake is rich enough to feel sufficient. Footnote titles
for migrated memories are the first 80 characters of the body (U2), so they read
as sentence openings and invite extrapolation. The label says "ignorable" (U3).
Nothing in the render distinguishes "here is a pointer" from "here is a fact."

**Proposed.** A rule the model now carries in memory (`mem_99bda10fbbe7`): a
footnote is an address, not a fact; never characterize or count footnoted
memories without expanding them. Whether a rule held in memory is enough is
exactly the "mechanize invariants, instruct only preferences" question. The
measurable is U3's metric: recall-by-id calls that cite an id delivered as a
footnote in the same session, per footnote delivered.

## U4 — Wake memory count and recall `storeSize` differ by ~700 (2026-09-14)

**Status:** merged 2026-09-14 as master `598d72d` (PR #106): a different denominator, not stale — the header counted `type: "memory"` live rows, recall's `storeSize` every live row incl. journal episodes and schema rows; the header now says "N memories of M live rows".

**Observed.** Wake header: "14,002 memories — composed at the last boundary."
Recall's `storeSize` in the same session: 14,701 on turn 3, 14,706 on turn 4.
The turn-3 to turn-4 growth of 5 matches the 3 memories and 1 chapter written
between them, so the live count moves at a few per turn and a 700 gap is not
one session's worth of drift.

**Where.** `src/core/self/briefing.ts` documents the wake's `memories` field as
"live memories in the store AT DELIVERY, not at the render," so the header's
"composed at the last boundary" is not supposed to cover the count. Recall's
`storeSize` is `store.list({ archived: false }).length` per the comment in
`src/core/store/cache.ts`, and `store/index.ts` notes that superseded rows are
another population the two paths may treat differently.

**Proposed.** Check, in this order: (1) whether the wake's count is actually
read at delivery or cached with the composed bundle; (2) what filter each count
applies (archived, superseded, journal rows); (3) if both are live and the
filters differ, say which one the header means. If it turns out to be staleness,
stamping the header with the boundary time is the cheap fix.

## U3 — The "(ignorable)" footnote label: this session is a data point for OQ4 (2026-09-14)

**Status:** merged 2026-09-14 as master `1aed64c` (PR #104) as a PROBE STEP, reversible by
one string. `FRAMING.footnoteHeader` is now `FOOTNOTE_HEADER_STEP_1` ("…ignorable; expand an id with
recall before citing one"); `FOOTNOTE_HEADER_STEP_0` is kept beside it. The metric lands in the same
change: `src/core/recall/probe.ts` and `counterparts probe-oq4 --dir <store>` print, per calendar date,
footnotes delivered vs. later expanded by id, from `recall.decision.footnotes[].id` and the new
`recall.credit.expandedIds`. Step 0 ran live through 2026-09-14, with one leak: the branch was
developed in the shared checkout, whose hooks are what every session runs, so step 1 was live
from 16:51Z to 16:58Z (one boundary, zero expansions) before the checkout went back to master and
the branch to a worktree. The step-1 side of the table starts at the merge. What is measured on the
step-0 side: only 8d7bd97 → 16:51Z on 2026-09-14, a few hours — `expandedIds` did not exist before
the credit seam, so earlier dates (423 footnotes delivered, 09-03 → 09-13) print "-", unmeasured, not
zero, and stay out of the totals. The owner rules on the reading.

**What the ruling should say that no doc does.** Step 1 turns the footnote header from
context into an INSTRUCTION ("expand … before citing"). That is exactly the trade OQ4 asks
about, and the probe is doing its job by making it; it deserves saying out loud when the owner
rules on the reading, because the ambient design's premise is that recall is context, not
instruction.

**Where.** `src/core/recall/render.ts` `FRAMING.footnoteHeader`, currently
`"Quietly available (ignorable):"`. The comment above it says the phrasing is a
deliberate, still-open probe about its effect on model attention. That resolves
to `src/core/recall/CONTRACT.md` §7, open question 4: "Is the 'quietly available
/ ignorable' framing actually ignorable to a model? v1 shipped it as a deliberate
probe question and never answered it." The constant exists so there is exactly
one string to change when the probe runs.

**Observed.** See U5. Asked afterward whether a different label would have
prompted a lookup, the model's honest answer: probably yes, on the specific
turn where it was about to make a claim about the footnoted memories. The word
"ignorable" reads as "you are not obligated," which is correct for the ambient
design (most footnotes should be ignored) but says nothing about what to do
before *relying* on one.

**Proposed.** Target the failure, not lookups in general. The failure is not
"didn't look," it's "asserted from a stub." Candidate:

    Quietly available (ignorable; expand an id with recall before citing one):

rather than the owner's first draft "ignorable, lookup any relevant ones for
more detail," which asks for more lookups across the board and would push
against the ambient design. Either way, this is the probe the comment asks for.

**Metric.** Per session: footnotes delivered, distinct footnote ids later passed
to `recall` (`handle` or `ids`) in the same session, and whether the model's
reply on a footnote-bearing turn mentioned a footnote's content. The first two
are already observable from delivery events plus the MCP server's call log; the
third needs a transcript read. Run a few sessions on each string before ruling.

## U2 — Footnote titles are 80 bytes, and for migrated memories that cap is baked in (2026-09-14)

**Status:** merged 2026-09-14 as master `1aed64c` (PR #104): `FOOTNOTE_TITLE_BYTES` 80 → 150.
Migrated titles are stored at 80 characters and render as before, except those with a multi-byte
character inside the 80 (clipped at 80 bytes until now), whose tail now renders; recall-bench numbers for them
do not move; authored titles render whole, and the multi-byte-dash byte clip stops biting. The
backfill (item 2) stays low priority under the standing ruling.

**Where.** `src/core/recall/tunables.ts` `FOOTNOTE_TITLE_BYTES: 80`, applied by
`clip(r.title, input.titleBytes)` in `render.ts`. Whole-injection budget
`BUDGET_BYTES: 2048`, gist `GIST_BYTES: 240`.

**Observed.** Four of the five footnotes on turn one ended at exactly 80
characters with no ellipsis, e.g. "When Mike asks 'what do you remember?' or
'what context do you see at startup?',". Expanding them showed the *stored
title* is already exactly 80 characters for migrated memories: the bansai trace
`tr_28954eeb971028c2` (itself `migrated_from` an engram id) carries the same
80-character title and a 400-character body. For those four the renderer's cap
did nothing; the migration inherited titles that were already body prefixes.

The fifth ("I asked Mike in return: 'Now that you know what arrived and how it
landed —...") did get clipped by the renderer, with the ellipsis: its title holds
an em-dash, which is 3 bytes, and the cap is 80 *bytes*, not characters. So an
80-character stored title that contains any multi-byte punctuation loses its
tail to `clip()` too.

**Consequences.** Raising `FOOTNOTE_TITLE_BYTES` to 150 changes almost nothing
for the ~14k migrated memories (only the multi-byte cases above stop losing a
few characters), and does help memories minted since launch, whose titles are
authored or generated and can be longer. And a body-prefix title with no
ellipsis reads as a complete first line, which is part of U5.

**Proposed.**
1. Raise `FOOTNOTE_TITLE_BYTES` to 150. Budget math: six footnotes at 150 bytes
   plus ids and framing is roughly 1,100 bytes, well under 2,048, and the trim
   order drops weakest-first if it ever doesn't fit.
2. Backfill titles for migrated memories whose title equals the first 80
   characters of the body. Two options: derive `clip(body, 150)` with an ellipsis
   (cheap, still a prefix, and byte-aware so multi-byte punctuation is safe), or
   generate real titles with the interpreter (costs a pass over ~14k memories;
   could ride along with the embedding backfill once I33 is cleared).
3. Whatever the cap, the clip already adds "..." when it cuts; the missing
   ellipsis on migrated titles is a property of the stored string, so the
   backfill should add it or replace the title outright.

**Does it help U5?** Partly. A 150-character title primes better and misleads
less. It might also make stubs feel *more* sufficient. The pairing with U3 is
the point: better stubs plus a label that says what to do before citing one.

## U1 — Migrated memory bodies are capped at 400 characters, mid-sentence (2026-09-14)

**Status:** low priority (standing ruling). Legacy artifact from engram's
extraction; no new Counterparts memory is affected. Item 3 below is the only
part that concerns Counterparts itself.

**Where.** Not in Counterparts. `src/adapters/mcp/deliberate.ts` gives the id
path `RECALL_BODY_CHARS = 4000`, and a memory minted this session came back at
520 characters in full. The 400 is the stored body length of migrated memories.

**Observed.** Three of five expanded footnotes reported `bodyChars: 400`,
`truncated: false`, and ended mid-word. The bansai trace for one of them
(`~/.bansai/traces/global/tr_28954eeb971028c2.md`) has a 400-character body and
`migrated_from: m_1773084515307_ipau`, an engram id. An old memory already in
the store says it: "400-character extraction limit causes truncation
mid-sentence, losing context at endings" (`mem_b3534c318b1ef210`). The cap was
engram's, and both migrations carried it forward faithfully.

**Proposed.**
1. Check whether engram's original records hold text beyond 400 characters for
   these ids. If yes, a backfill from engram can restore the tails. If no, the
   content never existed and nothing is recoverable.
2. Count how many store memories have `body.length === 400` exactly, to size
   the problem. Same query can drive the U2 title backfill.
3. Confirm Counterparts' own interpreter imposes no similar ceiling. A grep for
   numeric length instructions in `src/` found none; the 520-character memory
   above is consistent with that. Worth one deliberate check of the interpret
   prompt text rather than trusting the grep.

---

## Plan of record for U6–U10 (drafted 2026-09-14 by the ~/random and counterparts sessions; awaiting owner ruling)

**Status 2026-10-09:** carried out on 2026-09-14. The lifecycle test, the §9.2 wiring, the
dedup route-through and the U6 tie-break landed together as #99 (`8d7bd97`), the U9 rows
as #100 (`10abffb`), U8's band of record as #106 (`598d72d`), and the `memory.reinforced`
watch is in `tools/parallel/record.ts`. Of step 5, the leftover rule was looked at and
kept (U6), and U7's recency question is still the owner's. The plan below is as it was
written.

Order, with the counterparts session's three amendments folded in:

1. **Lifecycle test first** (cross-module, `test/`): a memory born day N,
   referenced on three distinct days, is identity by N+4; a wake on N+1
   mentions day N. Pin what "referenced" means before writing it: the §9.2
   matcher must match what the live turn actually contains. v2 footnotes are an
   id plus a clipped title, so decide id-echo vs title-echo vs content-overlap
   first, or the test passes on a matcher the live path never exercises.
2. **U9 rows with or before the credit seam, not after.** If §9.2 lands first,
   whether credit fired on the live path is again only in a ring. Copy the
   `sweep.gate` one-row-per-run shape rather than inventing one, and give every
   new row a `reason` the daily's readers can split on from day one (the G47(a)
   gap: readers count `sweep.gate` by name and cannot see
   `reason=no-credential`).
3. **Wire §9.2 at the boundary**, in `hooks.ts` beside `askAtStop` (rewritten
   in #95; rebase on master f3f3046 first). Route dedup's bump through
   `creditUse` too. This is CORE (recall + physics + store) and changes what
   the store holds: adversarial review, G12 declaration before merge, owner
   merges, one `restart.ts`. If `resolveUse` adds a field to `recall.decision`
   the surface hash moves; check with `surfaceSetHash` and say so in the
   declaration. Budget for a same-date re-restart. Use `Store.setMetaMany` /
   `metaWithPrefix` for any per-id counters.
4. **The invariant goes in the WATCHES, not the class rule**: a four-valued
   watch "post-launch `reinforced_days` ≥ 1" beside `sleep.symmetry` in
   `tools/parallel/record.ts#graded`. The class rule changed once today (#96)
   under an owner ruling and a second change needs one too. Worth saying in the
   PR: the four existing watches have read not-exercised for the whole run;
   this would be the first that can actually go red.
5. **Then tune**: leftover when the render fits, recency lane or
   recency-weighted hints (U7), U8 band of record. The U6 tie-break
   (least-recently-rendered) rides WITH the §9.2 PR, not after: both change
   what the identity lane renders on the live store, so they share one
   declaration and one restart, and the test that proves credit flows is the
   test that proves the eight tied rows stop winning. If the tie-break needs
   its own owner ruling (it changes who "I am" renders as, daily), the code
   stays in the PR behind the declaration and the owner accepts both at once.

**Credit rule, to be written into the recall CONTRACT line for §9.2, not left
here:** a memory is credited only when expanded through recall (handle or ids)
or quoted at content level; never for being named in prose. Two fixtures for
the lifecycle test: (a) five footnote ids cited in prose, zero expanded, zero
credit (this session, 2026-09-14, is the counterexample); (b) a recall-expanded
memory that the assistant then contradicts still credits as a use, because
contradiction is engagement and §5.3 counts distinct days, not agreement.

Landing order: U9 rows first, so the §9.2 PR's first live boundary leaves rows
the credit path can be read from; the watch reads not-exercised until that PR
merges, then goes green or says the wiring missed the live turn.

Split (accepted by both sessions, pending owner ruling): counterparts session
takes U9 rows and the watch; ~/random session takes the lifecycle test, the
§9.2 wiring in `hooks.ts` on f3f3046, the dedup route-through, and the U6
tie-break, in one PR with one G12 declaration, reviewed on Opus by the
counterparts session before the owner merges.

Coordination: `hooks.ts` is also touched by the planned PR 2 (doctor,
session-start notice) and the #92 scope-controls rebase; whoever lands first,
the other rebases. The counterparts session offered to take the watch (4) or
the U9 rows (2); the two should not edit `record.ts` at once.

### An experiment, 2026-10-19, agreed with Mike: the feedback loop, Builder 1 (graded use credit, strong co-use links, habituation). Check on ~10-22

From the coordinator's brief (`~/counterparts-notes/2026-10-19-feedback-loop-brief.md`). Mike:
"feedback between layers of the brain, going both ways, is huge… err on too strong, so we can
see what it looks like when its actually happening." This is an experiment, not a rule. Each
part says what it tries, what to watch, and how to revert it. Nothing is stored in a new
format: no DDL, no cache version bump. The one new thing on disk is `returns` rows of source
`shown` and `ontopic`, which an older build skips. The watch list is the "Feedback loop"
section of `docs/CHECK-AFTER.md`.

- **A. Trying ratings as use.** At a `rated` boundary, over the stretch since the session's
  previous rating, each score is a use through `resolveUse`: 3 a full use (`referenced`),
  2 `useful` (`W_USEFUL` 0.75), 1 `ontopic` (`W_ONTOPIC` 0.25), 0 nothing. Each ambient
  showing in the stretch left unrated is a glimpse (`shown`, `W_SHOWN` 0.1). The once-a-day
  rule and the within-day lift hold. Why: 3% of shown memories were credited as used while
  18% were rated useful, so the day barely taught the system. To see: credits per day by
  tier, and whether the footnote ratings improve.
  - Toward the core, a glimpse-only day counts `SHOWN_RECURRENCE_WEIGHT` (0.1) of a
    recurrence day and a rated-1-only day `ONTOPIC_RECURRENCE_WEIGHT` (0.25). Neither ever
    counts alone, and neither anchors the row ("m itself used"). Why: the 10-14 check-in
    found ~270 memories shown in 3+ sessions and never used, mostly standing rulings. At 0.1
    a month of daily footnotes adds 3 days, short of `CORE_SLOW_DAYS` (4). Measured on a
    hermetic store: a ruling footnoted in 90 sessions over 30 lived days, never rated, came
    out with recurrence 3, no full day, not anchored. With one reflection citation it came
    out 3.9 days, slow lane not met. But with TWO full days in the 30-day window — two
    reflection citations (allowed once every 7 lived days), or one citation and one rating
    of 2, or a drewOn — it reaches 4.8 days over 30 sessions and the slow lane IS met
    (reviewer's hermetic run, 2026-10-19). Before this build two citations gave 2 days from 2
    sessions. So the glimpses lower the bar for a footnoted-daily ruling about me or us from
    about four full days a month to two; the core check below is the place to see it.
  - A rating of 2 is a full awake return (lane day, fast lane). The awake floor is now
    `AWAKE_RETURN_MIN_WEIGHT` (0.75); it was the literal 1.0. The repeat credit (`surfaced`,
    0.25) still earns none.
  - Trying drewOn as a full use (Mike, 2026-10-19): `W_ENGAGED` 1.0, and at that weight its
    return is an awake one, as an open's is (a lane day, a full recurrence day). The
    once-a-lived-day rule and the cap of 3 per boundary stay; drewOn ids were already
    co-used for links. Revert by setting it back to 0.5 (the half return comes back with it).
  - Known cost: any credited use re-anchors the curve, so a memory glimpsed every day does
    not fade while it keeps showing (the hermetic ruling sat at strength 0.50 for 30 days).
    This is the rich-get-richer worry, kept as built on Mike's call (2026-10-19). If the
    10-22 check shows clutter, the fallback to try: credit a glimpse without moving the decay
    clock (it adds to `uses`, not `lastUsedDay`), or set `W_SHOWN` to 0.
  - Also seen in review: a daily glimpse resets the spacing a later real use is measured
    from, so a memory footnoted every day and then opened earns a small return (0.13 after
    a week of glimpses, against ~0.7 for one left alone). A glimpse buys freshness and
    costs durability.
  - Revert: revert the PR. Part by part: set `W_SHOWN`, `W_ONTOPIC` and `W_USEFUL` to 0
    (`creditUse` then refuses them as `ignorable-tier`) and `AWAKE_RETURN_MIN_WEIGHT` back
    to 1.
- **B. Trying strong co-use links.** The stretch's co-used memories are linked pairwise at
  `CO_USE_DEPOSIT` (0.25). Co-used means rated 2 or 3, or otherwise used there (opened,
  quoted, drewOn), never rated 0, and at most `CO_USE_MAX_MEMBERS` (8), the strongest use
  first. Memories shown on the same turn, none rated 0, are linked at
  `SHOWN_TOGETHER_DEPOSIT` (0.05). Why: links never reached recall (strongest 0.159 against a
  0.4 pointer weight). Now two co-uses clear it and the pointer lane lights by itself. The
  hop arithmetic and the pointer threshold are not touched. Scoped to the stretch, not the
  session, because a node holds 32 links. To see: links at or above 0.4, pointers shown and
  later used (hermetic check: one co-use gave 0.30 and no pointer; two gave 0.57 and the
  partner showed as a quiet pointer on a later turn whose words reached only the other; 9
  unused lived days later it was 0.42 and still showed). Watch saturation: in a heavy
  synthetic month (12 boundaries a day, five "hub" memories useful in most of them) the hubs
  sat at the outgoing bound (4.0) with ~30 links each, and 72 links were evicted.
  Homeostasis held, but a hub's links are then each too weak to point. Revert: set both
  deposits to 0 (`Associate#deposit` skips a zero delta), or revert the PR.
- **D. Trying light habituation.** A memory rated 0 in `HABITUATION_MIN_SESSIONS` (2)
  sessions within `HABITUATION_WINDOW_DAYS` (7) lived days faces a bar raised by
  `HABITUATION_BAR_LIFT` (×1.5) in ambient recall, after the floor, in both tiers. It is a
  lift, never a veto: strength, credit, links, pointers and deliberate questions are
  untouched. It recovers as the ratings age out, or at once with a later rating of 2 or more.
  The count lives in a derived note in box 3 (`cache_meta`, key `note:habituation`), rebuilt
  from the `recall.rated` rows after each rating and recomputed from the rows whenever it is
  behind them. Why: 47% of rated footnotes were noise. Hermetic check on a 140-memory store:
  shown on 6 of 8 test turns before, 5 while habituated, 6 again after a rating of 2, and no
  longer habituated 7 lived days after a second pair of zeros. On a tiny store (cold
  regime) it changed nothing, since every showing cleared its bar by 1.7× or more. Revert:
  set `HABITUATION_BAR_LIFT` to 0.
- **The tool's words changed with it.** `session_end`'s `rated` field no longer says
  "tracking only: a rating changes nothing". It says plainly what a score does, and asks the
  session to rate honestly. Watch whether knowing ratings count shifts the score
  distribution (47 / 35 / 12 / 6 before).

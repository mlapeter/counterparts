# `dream/` — NOTES

What the build learned, and every choice the brief left open (2026-09-26).

## The tunables (`tunables.ts`), and why each number

| name | value | reason |
|---|---|---|
| `MIN_NEW` | 3 | a dream with less than three new memories to replay is not worth the owner's minutes |
| `FIRST_DREAM_DAYS` | 7 | a store that never dreamed treats the last week as "new" |
| `MAX_NEW` | 40 | bounds the bundle: newest first |
| `NEIGHBOURS` | 6 | the owner's "5–8" |
| `MIXING` / `MIXING_FROM_RANK` / `MIXING_TO_RANK` | 5 / 12 / 40 | "loosely related": ranks 12–40 of a new memory's neighbourhood, picked at random (a seeded RNG, so a bundle is reproducible from its dream id) |
| `LOOKBACK_DAYS` ± `LOOKBACK_SPREAD`, `LOOKBACK_COUNT` | 7 ± 2, 5 | "about a week back", the strongest-felt five |
| `TEXT_CHARS`, `PAGE_CHARS`, `WAKE_CHARS`, `CHAPTER_CHARS`, `MAX_CHAPTERS` | 400, 6000, 6000, 3000, 6 | keep the bundle well under an MCP tool result's size |
| `LIMITS` | merge 10, link 20, gist 3, replayed 60, contradiction 10, feeling-now 10, nominate-core 3 | the owner's "~10 merges, 20 links, 3 gists"; the rest sized so a dream over 40 new memories can replay each |
| `LINK_WEIGHT` | 0.1 (was 0.3 until 2026-09-28) | about one Hebbian co-activation (`HEBB_RATE`): the dream proposes, waking use confirms, edge decay fades the rest. Written through `associate.propose`: raised from the decayed weight, never added, and only where both ends have room (never evicts or scales down a learned link) |
| `MAX_TEXT_CHARS`, `MAX_JOURNAL_CHARS` | 2000, 12000 | bounds, not targets |

## Choices the brief left open

1. **The journal is a column on `dreams`, not a memory kind.** The brief allowed either.
   A memory kind would have needed every scan (decay, dedup, prune, recall, the wake,
   the census, the dashboard's lists) to learn to skip it; a table nobody scans for
   memories needs nothing. The owner reads it with `counterparts dream --show` and on
   the dashboard.
2. **"Last dreamed" is the newest `dreams` row**, and the snooze a `dream_asks` row per
   calendar date — both durable rows, not meta.
3. **The ask is once per calendar day across sessions**, claimed when the line is
   composed. A line the host then drops (an envelope too small) costs that day's ask;
   the plain reminders' claim-at-delivery would fix it (INTERFACE-GAPS §2).
4. **The ask waits for a store's second lived day**: "I haven't dreamed since …" needs a
   since.
5. **A begun dream that did nothing does not use up the day**: the next `begin` closes it
   `undone` and opens a fresh one (an agent that gave up, a crash).
6. **A merge takes 2–3 memories of ONE kind, none of them core.** The merged memory
   stands where the strongest original stood (its salience, its channel, its legacy
   consolidation), with the most uses, the latest use and the earliest birth, every
   original's returns (the `returns` rows are carried) and feelings, and their links
   (`associate.retargetOnSupersede`, which had no caller until now). So a merge never
   leaves a memory weaker than what it was made from.
7. **`feeling-now` is the self's feeling, capped at the memory's peak.** A dream records
   softening; it cannot raise a memory, nor open the core's fast lane.
8. **`nominate-core` only for a memory about me or about us** — the same reading the
   lanes use; a nomination of anything else would be noise.
9. **A dream's words are redacted of credentials, not run through the full gate
   battery.** The battery refused short text (`content-too-short`): a one-line journal,
   a nomination's reason, a merged sentence. The words are rewordings of memories that
   already crossed the battery.
10. **Contradictions are raised once each**, by a meta latch (`dream.raised.<dream>.<seq>`),
    at most two a session, and only when both memories are showable in that session.
    (Since v10, 2026-09-29, the latch is the pair's `raised_day`; the upgrade carried every
    meta latch onto its pair.)

11. **The ask is cheap, because it runs on every prompt.** `status` answers observer,
    first day, dreamed today and the day's ask row before it counts anything, and "new
    since" is one bounded read (`store.newMemoryIds`, the column gates in SQL) with the
    deny-list and confidentiality applied to what comes back. The first version walked
    every memory row per prompt (~17k queries on the owner's store) on every quiet day.
12. **One anchor for "the last dream"**: the newest dream not undone. The ask, "new
    since" and `begin` all read it, so after an undo they agree.
13. **A dream cannot strengthen what a dream wrote**: `replayed` and `merge` refuse a
    `dreamed` row (`dreamed-rises-only-awake`). A gist rises only by proving true awake.
14. **A dream can refer to what it made** in an earlier `propose` call of the same dream
    (a merge's memory, a gist): those ids join what it was shown.

## What it cost to find out

- The dashboard's import-scan reads `from"` as a module path, so reading a merge's
  `from` key needed a destructure (dashboard NOTES).
- The store bans deletion verbs in method names; undo's helpers are `restoreEdge` and
  `retract*`.


## After the review of #251 (2026-09-26)

- **Merged return days are a UNION (Q4, confirmed and tested).** `supersedeInto` copies
  returns under `(memory_id, day, source)`, and `return_days` is `COUNT(DISTINCT day)`
  of awake rows. Two originals that came back on the same day give the merged memory
  that day once.
- **An undone dream no longer lights anything.** Proofs read from dream events carry
  `stands`, which drops rows whose dream is undone. This covers Dreaming,
  Consolidation's dream merges, and Episodic → semantic's gist.
- **Replays follow spacing** (physics NOTES): a memory in every night's bundle counts at
  most once a week.
- **Removal redacts journals** that cite or quote the removed memory (store NOTES).


## 2026-09-27 — reflection, the morning share, core by meaning

Working defaults from the owner's conversation of 2026-09-27 and its design review
(`~/counterparts-notes/2026-09-27-build-brief.md`, addendum included). Every choice the
brief left open, and why.

1. **A sibling tool, `reflect`, not more `dream` phases.** Reflection has its own record
   and can run without a dream (addendum 1); a phase of `dream` would have tied it to a
   dream row. The dream's launch prompt chains the steps, and `journal` tells the dreamer
   to reflect next (and to fall back to the journal's hand-back if reflecting fails).
2. **The record is a table; the entry is also a memory when it cites something.** The
   table holds what only a reflection has (the questions, the share and its state, the
   page version). The entry is lived, so it becomes an ordinary memory of source
   `reflection` — recall labels it "Reflected:", the next dream can replay it — but only
   when it cites what it rests on. A "nothing much" night leaves no memory.
3. **"Nothing much" = nothing cited.** The rule is mechanical so no made-up depth is
   needed to pass it: no citations → no memory, no page (refused `page-needs-cites`), no
   share. Only a memory that became core on reflection alone is still said.
4. **How reflection returns feed the two lanes**: see physics NOTES 2026-09-27 — the fast
   lane's return, and at most one slow-lane day a week per memory. Returns are credited
   to the union of what the entry, the page and the share cite, at most 12.
5. **The page rests on the core** when there is one (at least one cited core memory, else
   `page-rests-on-the-core`); a store with no core yet writes from what it cites. A
   dream's gist is not citable for the page (`dreamed-is-not-a-source`), and a page that
   carries a six-word run of the dream's gist is refused (`dreamed-words-on-the-page`).
   *(2026-09-28: the gist-words check is removed and the core rule is a note — see that
   day's entry below.)*
   The prompt asks for craft under "## How I work"; nothing enforces headings.
6. **The page write claims the night.** `writePage` records a `self.page.writer.ran` row
   (mode `session`, outcome `revised`) for `pageWriterNight`'s date. That is why the old
   SessionStart writer is LEFT IN PLACE: on a night the reflection wrote the page it
   finds the night claimed and stands down; on a night with no reflection it behaves as
   before (and mostly defers `no-room`, as it did). It does no harm, and removing it would
   leave dreamless nights with no writer at all.
7. **The share is carried on the prompt, not the wake.** The SessionStart wake's byte
   ceiling is what stranded the page writer. `dreamLines` (UserPromptSubmit) carries an
   untold share once, and only after the reflecting session ended (its registry record
   is ended or quiet past `SESSION_TTL_MS`), so the two do not both tell it. The line and
   the hand-back ask for a telling in the session's own words, then `told`.
8. **The hand-back carries the mark**, a standalone reflection's too
   (`⟦counterparts:dream reflection rfl_…⟧`): capture refuses the tool's words, so a
   thought about the owner is never filed as a fact about him from them; the session's
   own telling is what is lived.
9. **Questions rotate by count**: three in a row from the list, starting where the last
   night stopped (eight questions after a dream, seven without — consecutive nights never
   share one).
10. **No new durable event names.** The dashboard's registry is exhaustive by type and is
    another session's; reflection records live in their own table, per-memory `told` and
    `about` in `core_events`, and mechanisms count reflections with a census.
11. **What's on my mind** reads what the store already keeps: dated memories in the next
    14 days, flagged pairs still standing, live handoffs' first lines. No goals in v1
    (nothing records one).
12. **A dream's nomination is its suggestion of meaning.** It cannot set the mark, so it
    may nominate an unmarked memory; not a `skill`, and not one something awake already
    marked `work` or `world`. The reflection sees nominations and decides.
13. **A promotion on reflection alone is said** (the owner's addition): the next bundle
    lists it (`becameCore`), the instructions ask the share to say it, and if the share
    did not cite it the engine adds "I think "…" has become part of who I am." A meta
    latch (`reflection.coreMentioned.<id>`) says it once.
14. **What a dream or a reflection wrote earns no return by being cited.** A dreamed
    gist can be cited in the entry and the share (it is a suggestion the waking self may
    take up), but the citation is not a return (`dreamed-rises-only-awake`, the dream's
    own rule): otherwise the agent that dreamed a gist could wake, mark it, feel it and
    cite it into the core in two days with no organic use. A reflection's own entries are
    not shown to it as memories at all — only as words, under `earlier` — because a
    reflection returning its own reflections is the rumination loop self CONTRACT §2(c)
    names (`reflection-does-not-return-itself` if one is ever cited).

## 2026-09-27 — the ask, previewed (`previewAsk`)

The dashboard's Tonight box asked `status`, got "observer", and fell back to counting
"new since the last dream" itself — a count that skipped the showable filter
(confidential rows) and the `MAX_NEW` cap, so it could read higher than the gate.

1. **One gate, two stances.** `status` and the new `previewAsk` both call the private
   `gate(at, observer, owner)`; `askLine` still reads `status`. Agreement is by
   construction, and `test/dream-preview.test.ts` checks it case by case against
   `status` and against `askLine`'s actual line.
2. **It mirrors `status`, not `begin`.** `begin` quietly closes a dream that was begun
   and did nothing; `status` counts that dream as today's. The real ask reads `status`,
   so the preview does too.
3. **`newSince` is always counted** in the preview. The gate stops before counting when
   it already knows (dreamed, asked or declined today; first day) — that is the per-prompt
   path's economy, not a meaning. The Tonight box wants the number anyway.
4. **Whose gate.** An observer is never the owner's session (the facade forces `owner`
   off), while the owner's hooks run `owner: true`, where confidential memories count as
   new. So an observer previews a guest's gate by default and the owner's on
   `owner: true`. A live session previews its own and ignores the option — a guest
   session cannot count the owner's confidential memories by asking. Only a count comes
   back, never an id or a word.

## 2026-09-27 — trait nudges (working defaults, held lightly)

1. **The reflection writes them; it never reads them.** `finish` takes `traits: [{ id,
   axis, toward, strength, carried_by }]` on memories it was shown, lived ones only
   (`notLivedReason(…, "trait")`: a dream's gist is a suggestion, a reflection's entry is
   not an act). Its `carried_by` is scanned like its feelings' and prefixed "on
   reflection, <date>". The instructions name the seven axes and tie them to the
   "unlike your page" question; nothing it is shown carries a trait, so it cannot steer
   toward a balance.
2. **A merge carries the originals' nudges** with their own source, model and
   `created_at` — unlike feelings, which a merge restamps. A row today's vocabulary would
   refuse stays on the (superseded) original rather than failing the merge half-way.
   Undo needs nothing new: the merged memory is archived, the originals come back with
   their own rows.
3. **No backfill.** A dream does not write nudges (later, maybe).

## 2026-09-28 — loosening the guards (owner direction)

The owner's direction after the morning's dream and reflection (on the live store)
failed three ways, all ours: **err on the side of removing guards and
limits; add or tighten one only after a real issue is seen; fix the root cause (clearer
instructions, fields shown in advance) — accept and repair beats refuse.** Kept, because
each protects something real: the dream's mark never carries dream text into lived
memory; a confidential memory's words stay off the page; the page cites real memories and
never a gist; one dream a lived day; observer stance; the live-store rules.

1. **Removed: the gist-words check on the page** (`quotesAGist`,
   `dreamed-words-on-the-page`). Every hit that morning was a lived quote the gist had
   quoted too (the owner's own words of 09-25; the system-card reading). The citation
   rules carry the intent: a gist is still no page's source (`dreamed-is-not-a-source`).
2. **`finish` may be called again** the same lived day: the second call supplies the parts
   the first refused or left out, never re-mints the entry, and may replace a share not
   yet told or carried. Limits count across both (`detail.counts`); the first call's
   moves into me/us/owner are kept in `detail.movedIn` so a replaced share still says
   them, and a became-core line claimed by this reflection is said again. Every part not
   written carries `detail` (the rule, the matching words or id) and the outcome's
   `retry` says it can be sent again. The morning's share claimed a rewrite that had
   been refused; the MCP `say` now tells the model never to claim a part that was not
   written.
3. **Feelings: accept and repair.** An `emotion` that carries a phrase ("steadied: the
   guard has held every time since…") is split — the word is the emotion, the rest goes
   to `carried_by` — in `store/feelings.ts#checkFeelings` for every door, and before the
   credential scan in the dream and the reflection so the tail crosses it. Root cause:
   nothing the dreamer read said `emotion` is one word and `carried_by` the nuance; every
   schema and both prompts now say so, and the launch prompt lists each change's fields.
   A FEELING_INVALID that remains carries its reason through every door
   (`feeling-invalid:<reason>`).
4. **The doubled "steadied" was a display, not a write.** A feeling recorded at the time
   and the dream's feeling-now of the same word, capped at the memory's peak — which is
   that very feeling's strength — are two records; the bundle showed only whose, word,
   strength and `later`, so they read as one twice. The bundle now carries `by` (who
   recorded it) and a slice of `carried_by`. Separately, a dream that resends a batch no
   longer doubles a feeling it already recorded (`already-recorded`). A refused feeling
   never wrote: the check runs before the transaction and the change record after it.
5. **Text caps raised; nothing is cut without a word.** Share 700 → 3,000, entry 8,000 →
   20,000, journal 12,000 → 30,000, merged/dreamed text 2,000 → 8,000, titles → 200,
   other word 40 → 80, carried_by 280 → 1,000 (a trait's too). A text over its cap is
   kept to it and the result says so. The per-dream COUNTS stay numbers; the launch
   prompt now says "usually far fewer; none is fine" (a dream used all 20 links twice).
   The host injection budget and the self page's `PAGE_MAX_BYTES` are untouched.
6. **Refusals re-classified** against the keep list. Now written with a note:
   `page-rests-on-the-core`, `about-needs-why` (recorded "no why given"),
   `skill-is-how-i-work` (reflect's; `aboutMe` never reads a skill), `share-needs-cites`
   on a night that cites something (a night that cites nothing is still "nothing much"),
   `kinds-differ`, `merge-takes-two-or-three` (now two or more), `already-core`,
   `work-is-not-core`, `not-about-me` (a nomination promotes nothing). Kept, with a
   `detail`: the mark and confidentiality rules, `dreamed-*` / `reflection-does-not-*`,
   `core-is-not-merged`, `page-needs-cites`, `not-shown-or-gone`, `page-writer-off` and
   `door-closed-work-or-world-only` (the owner's own switches), `dated-is-not-merged` and
   `demoted-is-not-merged` (a reminder going quiet; the owner's demotion), the per-action
   `limit-reached` counts, `gist-needs-sources`, `same-memory`.
7. **After the adversarial review of #268** (same day):
   - The whole sent `emotion` now crosses the credential scan and the mark check
     BEFORE it is split, in the dream and the reflection (a key in `emotion` had gone
     around the scan into `other_word`); the note door already redacts it in
     `counterpart.addFeelings`. Not done centrally in `Store.addFeelings`: `store/`
     sits below `encode/` and does not import it.
   - A second `finish` records nothing twice: a feeling (whose, core, emotion, word) or
     nudge (axis, toward) this reflection already recorded on that memory comes back
     `already-recorded` (`detail.recorded` holds the ids). Cites count as a set
     (`detail.entryCites`). A page refused on a second finish no longer hides the one the
     first wrote (hand-back and `counts.page`). Replacing an offered share is a claim
     (`ifShareState: "offered"`), `share-already-carried` when another session took it.
     After a told share, a mark moved into me/us/owner is still said in the hand-back.
   - The dream's `already-recorded` is asked before its limit, so a resent batch does
     not come back `limit-reached`.
   - `repairEmotion` never hands back an emotion over the cap: with no break, it cuts at
     the last word boundary within the cap (not the first word); punctuation alone is
     kept to the cap.
   - Owner direction: `emotion-under-another-core` is repaired — stored under the wheel
     word's own core, with a note — and the note door's `skill-is-how-i-work` is loosened
     like the reflection's. A trait's over-long `carried_by` is kept to its length at the
     note door too. Titles and whys over their caps are said.

## 2026-09-28 — the nightly run (working defaults, held lightly)

The owner's shape, agreed that day: the day's memories are stored during the day; once
per calendar day the first session starts ONE background agent that runs the page
writer, the dream and the reflection. What the build learned:

1. **The order is the owner's call: writer, then dream, then reflection.** The first
   build had dream → writer → reflection (the brief's), and it met the problem the brief
   asked to verify: a dream's merge archives yesterday's originals and stamps the merged
   memory today, so the writer's day (`learned_on === about`) came back with holes. The
   owner then moved the writer first (it reads yesterday raw, survives a session cut off
   mid-run, and the dream and the reflection see the fresh page). The merge fix stays
   anyway (`self/writer.ts#isOfDay`, following `meta.mergedFrom` a few merges deep, and
   `hasDayBefore` counting archived rows): a dream left behind from an earlier night, or
   a resumed one, can still have merged some of the day. `NIGHT_ORDER` is one line, and
   each phase's `next` reads it.
2. **The setting is store meta, not config** (`dream.setting`): the hook, the MCP server
   and the console already open the store, and "no dreams" said in conversation has to
   reach it from the MCP server, which does not write the host's config. Recorded on the
   existing `dream.ask` row (state `setting`) rather than a new durable event name, so no
   registry grew. No schema change: `dream_asks.state` is free text, and `launched` and
   `relaunched` are new values of it.
3. **A dream left behind is RESUMED, not restarted.** Its changes are real (a merge stands,
   a link is drawn); closing it `undone` without undoing them would lie in the log, and
   undoing them would throw away work. So the same dream moves to the session that picks
   it up, today and this lived day, its limits counting what it did, its bundle composed
   again from the dream before it. "Left behind" is TIME-based — begun and quiet (no
   change) for 30 minutes — because core cannot see session liveness; the line going out
   again is a compare-and-set on the day's latch (`reclaimDreamAsk`) so two sessions do
   not both restart it, at most twice a day. With `auto`, a launch no dream followed is
   started again the same way (the session closed before the agent began); with `ask`, an
   ask nobody answered is not asked again. Watch: a short session that closes mid-dream
   every time would resume the same dream three times a day — the cap holds that.
4. **The calendar gate.** The dream's "dreamed today" and the reflection's "reflected
   today" (and `finish` again) compare the row's `date` with the calendar today (the row's
   lived `day` when it has no date). Rows already carried both. Tests that moved only the
   lived clock (`advanceClock`) to mean "the next night" now move the calendar too.
5. **The reflection's bundle in parts.** It carries what the dream saw (every shown id and
   what the dream made, a line each, citable) and the page whole. Measured before: about
   21–23k tokens worst case already. Over `RESULT_CHARS` (60,000 characters) the first
   result holds everything but the long lists, as far as they fit, and says `part 1 of N`;
   phase `part` hands the rest at `PART_CHARS` (24,000, the write-up's precedent). The
   later parts' ids are kept in the reflection row's `detail` until the first finish, and
   each memory is read as it is now (gone since: said). The dream's own bundle still cuts
   its page view at `PAGE_CHARS` with a marker, unchanged — a candidate for PR B's fitter.
6. **The reflection writes the page as `reflection`**, with a reason naming the
   reflection and its dream, and no longer records a page-writer run: that row existed to
   stand the old session-start writer down, and with the writer in the same run it would
   say the writer revised on a night it may have refused.

## 2026-09-28 — after the adversarial review of #271

- A dream that began, changed nothing and went quiet no longer counts as "a dream
  followed the launch": the line goes out again, and `begin` closes it and opens a fresh
  one.
- A resumed dream's start moves to the moment it resumed (`updateDream` takes
  `startedAt`): it reads as busy at once, so another session cannot take it over, and the
  next dream's "new since" counts from there (the resumed bundle carried what came before).
- The writer's claim labels a `self_page` write only when the call NAMES the claimed
  session — never the session the server happens to be bound to (the run binds it
  early, and the owner's own page edit in that session is an ordinary amendment). When
  the run moves past the writer without a write, the dream's `begin` (or the
  reflection's) answers the night `nothing-to-say`.
- `launch` marks the day `launched` (claiming it, or flipping an accepted `ask`), so a run
  that dies before its dream begins is started again under either setting.
- A dream journaled today whose reflection never finished: the next line starts the
  REFLECTION alone (`reflect launch` with the dream id; `reflect begin` accepts another
  session's dream once it has been quiet `ABANDONED_AFTER_MS`), under the same latch and
  cap.
- The relaunch count is one meta key, `<date>:<n>`, overwritten by a new day.
- The reflection's result is measured as it leaves the MCP server (the bundle re-escaped
  inside the result's JSON, beside `how` and the questions): `RESULT_CHARS` 54,000 and
  `PART_CHARS` 24,000 of that text. Tested at the real limit. A part still fetches after
  a finish. Not changed here: the DREAM's own begin result can pass 60,000 characters on a
  busy night (seen in that test) — PR B's fitter (done in build B: parts, below).
- Headless runs (`claude -p`) still get the `auto` line: the hook cannot tell one that
  will exit from an interactive session reliably, and the 30-minute relaunch recovers a
  run that died with it.

## 2026-09-28 — build B: fitting (working defaults, held lightly)

- `MAX_NEW` 40 (newest first, the rest never shown to any dream), `TEXT_CHARS` 400,
  `CHAPTER_CHARS` 3,000 and `MAX_CHAPTERS` 6 are gone. In their place: the QUEUE (undreamed
  = in no standing dream's `shown`, within `QUEUE_DAYS`), ranked by replay priority;
  TONIGHT'S ROOM (`NIGHT_CHARS`, across parts); detail by importance (`DETAIL_CHARS`); and
  chapter ENTRIES as slices. See `fit/` CONTRACT for the principle.
- The chapter cut used to drop exactly the new chapters: a grown episode was re-sent from
  chapter 1 and cut at 3,000 characters. Now only the entries added since the last dream are
  sent; how far the last dream read each episode is kept in its index (exact), and without
  one the headings' lived days decide (an entry of the last dream's own day is sent again —
  over-shown rather than dropped).
- The begin result is measured as it leaves (`dreamResultChars`) and comes in parts past
  `RESULT_CHARS`; the busy-night fixture of #271 now passes through the MCP server under it
  (`test/fitting.test.ts`).
- `onMyMind` is ranked across its three kinds (it filled coming-up first, so five dated
  items hid every flagged pair); `onMindMore` counts the rest.
- The page and the wake are still cut at 6,000 characters in the bundle; their whole lengths
  are said (`selfPageChars`, `wakeChars`). The wake mostly repeats the page (audit note B);
  sending only its non-page lanes is a follow-up.
- Unsure: `FRESH_SHARE` 0.5 and `CHAPTER_SHARE` 0.3 of the night are guesses. A real
  night's `dream.begun` row now carries the queue and how the room was spent.

## 2026-09-29 — the ask the person sees; `auto` becomes headless (held lightly)

- Why: on 09-29 the first session of the day ran in the host's auto permission mode, and
  the host's classifier refused the `auto` line's instruction to start a background agent
  ("a hook-injected instruction to start an agent, with no user yes in the transcript").
  With the owner's yes in the session the same launch went through. Two weak points
  besides: the run lived in whichever session happened to be first, and a launch that
  was refused never reached the store, so nothing recorded it.
- So: the default is `ask`, and the ask is shown to the PERSON (terminal), not only the
  model. `offer` / `claimOffer` split the old `askLine` so the host claims the day only
  when the person's line is certainly leaving — the plain reminder's rule. `askLine`
  remains, as the two together.
- `auto` is headless. The in-session "Start tonight's run now…" line is RETIRED. The
  relaunch rules are unchanged, with one exception: a `launched` day whose headless run
  recorded `could-not-start` may be offered again AT ONCE (no 30-minute window — there is
  no run to wait for), as an ask with the reason. The cap still counts it.
- "dream on your own" = `setting auto` AND today's run in the session (the person just
  said yes); from the next day the host starts it.
- The record is meta (the latest run, one lookup on the per-prompt path) plus a latched
  event per state. A late terminal state from an older run never overwrites a newer
  run's row.
- Unsure: whether a headless run that exits 0 having begun nothing should fall back to
  asking (it does: `could-not-start`, reason `nothing-ran` — most likely the MCP server is
  not registered for a bare `claude -p`). And whether the person should see the fallback
  line in the same session the "dreaming in the background" line appeared in, seconds
  later — it reads a little abrupt; the alternative was 30 minutes of silence.

## 2026-09-29, later — after the review of #282 (held lightly)

- Wording: the run happens at the day's first session, usually the morning, so nothing it
  tells says "last night": the launch prompt says "since you last slept", the share's
  telling "While I slept I dreamed…".
- The reflection's page line leans toward writing (the owner would like a page a
  reflection wrote every day unless there is truly nothing new), says the writer revised
  the page earlier in this run when it did (version, by the writer), and that every
  version is kept. A "nothing much" night still rewrites nothing.
- The run's record grew `partial` and `parts`, and its watchdog (for LOST); the fallback
  covers timed-out, failed and lost runs that began nothing; an ask it becomes is not a
  relaunch; the gate reads a live `started` row as `dreaming-now`; `askLine` no longer
  claims a headless offer; an explicit `auto` from before is reset once. Why each: the
  review, findings 4, 5, 7, 9, 10, and owner decisions A and D.

## 2026-09-29 — contradictions: the flag is a pair, and a dream may settle (held lightly)

- **The flag is a row in `contradictions`** (schema v10), unsettled, beside the
  `dream_changes` row that undo reads. Raising awake (`raiseLines`) and "my mind"
  (`mind.ts`) read unsettled pairs from that table, so an undone settle reopens a pair
  and it is raised again; settling it — a new memory that `updates` one of the two, a
  `note` settle, a reflection's or the dream's own, the owner's `counterparts settle` —
  takes it off both. Habituation keys on the pair id (`mind.seen.<ctr_…>`).
- **`settle` is a dream action** rather than a use of the flag: the flag stays a flag.
  It needs a `why` (a dream settles only with a clear reason) and two ids it was shown;
  limit 5. The trail's actor is `dream` with the dream id.
- **Undo** withdraws a pair this dream CREATED while it is still unsettled (a pair that
  already stood, or one settled since, stands), and undoes this dream's settle only while
  it is the pair's standing settle — otherwise it is counted as kept, like a merge that
  moved on. A flag the v10 upgrade carried is found by `dream_id` + `dream_seq`.
- **The reflection** settles through its own phase (`Reflections.settle`, reflect phase
  `settle`): only ids it was shown, a `why` through the credential scan, actor
  `reflection`. Its instructions mention it only when an unsettled pair is on its mind.

### After the review of #284

- An undone dream's settle leaves its pair `withdrawn` when nobody had flagged it, and
  `unsettled` when it was a flag; the trail's actor is `dream-undo` with the dream id (M4).
- A reopened flag starts fresh on "my mind" (its `mind.seen.<pair>` count is reset, M5).

## 2026-10-02 — lane B: feelings over weeks, re-feeling awake, unmarked offered (held lightly)

- **Feelings over weeks** (`feeling-weeks.ts`). Rolling seven-day windows ending today,
  four of them, in the person's zone, each feeling dated by when it was recorded. "What
  changed" compares the last two windows with the two before: a core moved when the
  difference is at least `MIN_CHANGE` (2) and one side is at least twice the other — so
  1 → 3 is a rise, 3 → 4 is not. The ids it rests on are the strongest feelings behind
  each change (the recent ones for a rise, the earlier ones for a fall), or behind my
  commonest core when nothing changed; at most 6, only what the reflection may see.
  It does not say "around releases": that is the reflection's to read off the memories
  it rests on. A sample from the test: `{"weeks":["2026-09-05",…,"2026-09-26"],
  "mine":{"uneasy":[0,1,0,3],"warm":[0,0,0,1]},"owner":{"happy":[2,0,0,0]},
  "lookingBack":0,"changed":["my uneasy up: 1 in the two weeks before, 3 in the last
  two","the owner's happy down: 2 in the two weeks before, 0 in the last two"],
  "restsOn":[five ids]}` — 403 characters.
- **The merge kept feelings' source and date-recorded-later but not their moment**:
  `addFeelings` stamped `created_at = now`, so every feeling a merge carried read as
  felt on the merge night — a spike in the weeks, and a morning mood from a dream's
  housekeeping. `provenance` carries `createdAt` now, as a trait nudge's does.
- **Re-feeling awake reuses the reflection's path** rather than the session's
  `feelings`: the guarantees that make a later feeling safe (shown only, lived only, the
  credential scan on the whole emotion, no doubles, the strength default capped below
  the fast lane, `recorded_later`) were all in `finish`'s loop; it is one method now
  (`laterFeeling`), called by both. Source `awake`, not `reflection`: the dashboard and
  doctor can tell a session's look back from the night's.
- **Unmarked, offered**: the brief's "fact/entity ones that mention people or feelings"
  is read from what the store holds — a recorded feeling, kind `entity`, the owner's name
  in the words — not from guessing at names in text. They count toward the night's 8
  about marks, and the instructions say so.

### After the review of #316

- **A reflection's own later feelings stay out of `changed`** (they are still counted):
  three uneasy it records tonight would otherwise read tomorrow as "my uneasy up" — the
  reflection reading itself back. An awake look back is the session's and does count.
  `lookingBack` is per core now, mine and the owner's (one number said nothing).
  The sources come from `store/feelings.ts` (`FEELING_SOURCES`, `LATER_FEELING_SOURCES`).
- **Unmarked offers rotate.** The ids a reflection was offered are kept in its detail
  (`detail.unmarked`, carried across `finish`); what the last `UNMARKED_REST_NIGHTS` (3)
  reflections were offered waits behind the rest and comes back when the rest run out —
  so a pool left unmarked (a personal one on a closed-door night) is not the same five
  every night.
- **The awake way to the fast lane stays loose and is made visible**:
  `awakeFeelingCounts` reads the `awake` rows on live memories (how many, how many at
  `CORE_FAST_FEELING`, how many the owner's), and doctor's Reflection line says them in
  one clause.

## 2026-10-02 — bundles are read as a guest (review of #318)

Until #318 every server that built a dream's or a reflection's bundle was a guest. Since it,
Claude Code's server is the owner's, and in `ask` mode (the default) and `reflect launch` the
background agent calls that server. `BUNDLE_OWNER` (`tunables.ts`, false) keeps the bundles as
they were — kept as before, a coordinator default the owner may revisit: `Dreams#showable`,
its queue reads, the on-my-mind ranking, the aged-out read and the chapters, and the same in
`Reflections` (`showable(row, owner = BUNDLE_OWNER)`, `recentChapters`, the chapter fit). A
dream's journal and a nomination's `why` carry no confidentiality mark and are read later by
other bundles and the dashboard. The dream's gate (`gate`, `previewAsk`, the offer's count)
keeps `ctx.owner`, and so does a share's delivery (`pendingShare`, `carryLine`). Feeling again
awake (`feelAgain`) takes the call's own stance (#317 × #318).
No host reads a bundle as the owner; `CounterpartOptions.bundlesAsOwner` (`ctx.bundleOwner`)
exists for the store-level tests of what an owner-read bundle must keep — a merge of a
confidential memory is confidential, a page rests on nothing confidential — which opt in.

**Two things the guest bundle does not cover, for now (2026-10-02, left open for the owner).**
- *A recall during an `ask` dream.* The dream's background agent calls the session's own
  server, which is the owner's since #318. The bundle and its parts stay guest, but a `recall`
  BY QUESTION the agent makes mid-dream answers as that server does, so it can return a
  confidential memory's text — and what the agent writes then lands in the dream's journal,
  which carries no confidentiality mark. By id it would need a confidential id, which the
  bundle never hands it (only such a recall could). Narrow; not closed here — whether the
  dream's recall should read as a guest, or the journal take a mark, is the owner's call.
- *The ask can promise more than the bundle holds.* The gate (`gate`, `previewAsk`, the
  offer's count) keeps `ctx.owner`, so it counts confidential new memories that the guest
  bundle then leaves out: on a store whose only new memories are confidential, "yes, dream"
  can come back with nothing new. A known quirk, kept as is.

## 2026-10-03 — a gist takes the writer's three fields (schema v12)

- `gist` takes `occurredOn`, `saidBy` and `status` (prompt line and the `dream` tool's
  schema), read loose-first by `gistFacts`: what reads goes on the row, what does not is
  left off with a note and the gist is written. Nothing is defaulted — a gist is plainly an
  inference, but doctor's `Write fields` line measures what the writer fills, so an
  engine-set `inferred` would read as the writer's. A merge takes no fields; the store
  carries each original's to the merged memory where it has none (`carryWriteFacts`, the
  first original that has one, as the about-mark). Reflection entries do not take them yet.

## 2026-10-09 — a reflection in parts is told to read every part first

On the 0.3.12 release-check copy of the owner's store, a reflection handed its bundle in 2
parts finished without fetching part 2 (doctor's Tool results line measures "every part
read"). The launch prompt and part 1's `parts.next` both said to fetch the rest "before you
answer", but `how` — the instructions beside the bundle, which read as the procedure — went
from "Reflect on the questions" straight to "call finish", with no word about parts. The
dream's `how` gives no procedure of its own, so its launch prompt's "before you change
anything" stands alone there.

- `instructions` now opens, when the bundle comes in parts, with "First, read every part:
  this bundle comes in N parts and this is part 1", the exact `part` call for part 2 (and
  "each part up to N"), and "reflect and write only once you have read them all".
- `pack` measures the instructions with that line in place (a placeholder note of 99
  parts), so the first part's room is not overrun by the line that says it is a part.
- "before you answer" became "before you answer or write anything" in the two reflection
  launch prompts, the night's launch prompt and `parts.next`: "answer" alone can read as
  the final message, and the finish call is writing.

Untested against a model: whether this is enough. Doctor's line is the measure.

## 2026-10-09 — `previewAsk` removed

`Dreams.previewAsk` (and its `DreamPreview` type) was made for the dashboard's Tonight box
(2026-09-27, #262/#263); Home round 4 took the box out the next day (#273), and since then
only its own tests called it. It is gone, with `DashboardSource.dreams`, the one wire that
carried it to the dashboard, and `test/dream-preview.test.ts`. The gate is unchanged:
`status`, `askLine` and `offer` ask it as before, and the private `gate` keeps its stance
arguments. The entries above that name `previewAsk` (2026-09-27, and the guest-bundle notes
of 2026-10-02) are history.

## 2026-10-10 — `begin` reads stored neighbours (Lane 0)

`compose` takes one `store.neighbourReader()` for the night instead of a `nearestTo` scan per
queued memory, and the fresh list's room is checked before a memory's neighbours are read
(an entry with no neighbours is the least it can cost; when even that does not fit, the full
check refused it anyway). Same bundle as before on the review's clone; `begin` 314 → 231 ms
at 1x (170 ms once the lists are stored), 37 s → 1.4 s at 10x (0.97 s stored). `near()`
still returns the memory itself at rank 0, so `MIXING_FROM_RANK` means what it meant.

## 2026-10-10 — requeue on spill (Lane 0, dreaming review 09 C1)

The last silent cap: from 10-01 to 10-08 ~327 fresh memories left the queue on nights whose
parts the headless run could not open, because `shown` is written at compose. Now the night
run passes the transcript's cut dream parts (and the ones that came through whole —
`ToolSpills.whole`, so a part fetched again counts as delivered) to
`Dreams#requeueSpilled`. Which ids a part carried comes from the dream's fit index: later
parts' `m:new:` keys, and for part 1 the index's new `fresh` list. "Acted on" is read
broadly — every id a standing change names (`ref`, `ref2`, `detail.from|sources|linked`)
and the index's `looked` — because removing a changed memory from `shown` would orphan its
change rows. Test (`test/lane0-requeue.test.ts`): 60 fresh, a cut part carrying 21, one
replayed → 20 requeued, 1 kept, and the next night's queue is waiting + 20.

## 2026-10-11 — the unmarked offer keeps a room of its own (about-marks lane, held lightly)

The about-marks review (2026-10-10) found the offer working when it was made (10-09: five
offered, five marked, four into me/us/owner) and gone on a full night: on 10-10 the record
had no `unmarked` key and `fit.notShown` was 356. The cause is in `compose`: the offer's
ids carry priority 2, below recent and on-mind (3), core (4) and the dream's (5), and the
fit's first pass places ids in priority order until the room is spent — so on a night whose
ids alone fill the room, the offer waits and `unmarked.filter(kept)` drops it.

Now the offered ids' exact line cost (`OVERHEAD` + the line, or the whole when it is
shorter) is held back from the shared room; the shared fit runs as before in what is left;
any offered id it left waiting or showed as a bare id is fitted again with `least: "line"`
in the held-back room plus what the shared fit left over, and placed first (so a bundle in
parts carries it in part 1). The reserve is taken only when the plain fit (the whole room,
as before) leaves an offered id waiting or a bare id, and never past the room there is
(review of #383): a night whose plain fit already shows the offer a line or more is fitted
exactly as before — measured at 150 long recent memories, the always-held reserve had
turned six whole texts into lines (88 → 82) on a night that never needed it. Not a
higher priority: the third pass hands whole texts out by priority, so the offer would have
taken up to five whole texts on exactly the tight nights.

Measured on a synthetic night (a temp store: 8 unmarked facts and 3 unmarked skills written
in a directory 30 days ago, then N work memories written the day before): at N = 700 the
offer was 0 of 11 before and 5 (each shown whole, the texts being short) after, with
`notShown` 78 → 81; at N = 640, 0 → 5 (`notShown` 18 → 21); at N = 100, 5 → 5. Test:
`feelings-round3.test.ts`, "a full night still offers them".

Unmarked skills are offered too — `isWorkMemory` counts every unmarked skill as work, and
nothing else ever offered one (the review: 5 of 34 read as personal). A skill marked me, us
or owner is shown everywhere but never becomes core; the finish note already says so.

## 2026-10-11 — the headless night's reflection is a child of its own (held lightly)

The writer, the dream and the reflection ran in ONE `claude -p`, so every reflection turn
re-read the dream's bundle: peaks of 223k and 394k tokens on 10-10 and 10-09 (review 09
§3c), past a 200k-context model. Now the headless night starts the page writer and the
dream in one child (`launchPrompt({ reflect: false })`, ending at the journal; `reflect`
denied), then the reflection in a second child, fresh, from `Reflections#launchPrompt`
with tonight's dream id. The in-session Agent path keeps the single prompt.

Measured once each on a copy of the owner's store (11 Oct morning, v12 migrated; hooks
off, strict MCP on the copy; Opus 5.5; peak = max input + cache write + cache read over
a child's turns, deduped by message id). The page writer had nothing to write on that
copy in both runs, and it was a light night (13 turns, against 33–38 on 10-09 and 10-10),
so the absolute peaks are not comparable with the review's 223k; the drop between the
two is the evidence. Whether the dream child alone stays under 200k on a heavy night is
still to be seen on the live runs.

| | turns | peak context | cache read | cache write | output | wall |
|---|---|---|---|---|---|---|
| before: one agent | 13 | 147.9k | 994k | 144k | 17.6k | 3.1 min |
| after: dream child | 8 | 98.0k | 353k | 94k | 10.2k | 1.8 min |
| after: reflection child | 7 | 70.4k | 216k | 65k | 12.9k | 2.0 min |

The reflection child no longer carries the dream's ~80k. New work (cache write + output)
went from 161k to 181k (+12%), because the reflection's own context is written to the
cache again; cache read nearly halved (994k to 569k).

## 2026-10-11 — folding (Group 3 part B, held lightly)

A fold is a gist flagged `fold: true`, written through the one door (`supersede`, source
`fold`): no new verb, no table. Simulated on a copy of the owner's store (10-11 morning
snapshot, v12 migrated; no model: the four clusters review 11 named by hand, a personal
cluster of four `self`/me memories, and two spare work clusters, proposed as folds into one
dream whose `shown` was widened to them):

- 5 folds applied, 2 refused past the night's 5 (`foldOverflow` 2, said in the hand-back).
- 57 sources: 36 faded ×0.5 under a fold, 15 kept at their weight (14 already an earlier
  version under a Group 2 merge or slot, 1 reading). Undo put all 36 back.
- Starts: 0.519 (personal), 0.58, 0.6, 0.327, 0.6. A fold at 0.6 is ~0.52 at +7 and ~0.37
  at +30 lived days with no use; its faded parts at 0.25–0.32 on the night.
- Two work folds inherited `us` ("personal wins": one part was about us); as `fact` they
  cannot reach the core.
- The personal fold met the slow lane after ONE awake use the next lived day: its three
  folded parts, written by sessions on days 6, 11 and 19, count as re-encodings of its slot.
  That is the D6 intent; whether one use should be enough is for the coordinator.

**Review of #432 (same copy, same clusters), after random-06's core-lever ruling.** A fold
is `me`/`us` only when most of its parts are, and its recurrence is what came back after
it was folded (parts' later uses count; their births and earlier uses don't). The two work
folds (2 and 3 `us` parts of 11) are now `work`. The personal fold no longer meets the
slow lane on one use the next day (1 recurrence day, 1 session); with four post-fold use
days by three sessions over seven lived days (three of the fold, one of a part) it does.
"Felt" narrowed to review 11's: a `self`/`person` memory felt at 0.5 or more. That keeps
22 of 1,009 live memories out of a fold, down from 79 (any feeling). A fold now starts at
the strength of the parts it holds over (kept ones don't lift it); on these clusters the
starts are the same. Undo put every source's fade back exactly (57 of 57).

## 2026-10-11 — the dream queue (Group 3 part C, held lightly)

The queue is read whole (no newest-2,000 read), a memory stays in it while it is within
reach (no 7-day window), and it is ranked by value × fragility. Simulated on a copy of the
owner's store (10-11 snapshot, v12 migrated; no model; the copy has no embedding cache, so
no neighbour lines: `FRESH_SHARE` was lowered to 0.1 in both runs to bring a night back to
the live ~52):

- Tonight (+1 lived day): before, 50 of a 254 queue, 16 of them already below reach (wasted
  replay); after, 52 of a 182 queue, none below reach, 53 counted as having faded undreamed.
  15 of the 52 are the same. The ranking moves dated, `us`/owner and felt memories up, and
  brings in 10 undreamed memories from lived days 1–5 that were still within reach.
- Drain with no use, after: queue 182 → 127 → 69 → 17 → empty by +5 (faded 53, 5, 7).
  Before: 254 → 204 → 152 → 101 → 49 → empty by +6, nothing counted as faded.
- A sixth fold of four parts had fewer than two foldable parts (nothing carried); a seventh
  carried its 2 parts, which came back first, together, the next night.
- Cost (copy, bun, 1x / a 10x copy with every memory cloned 9 times and every dream showing
  the clones): the night's full queue read 3.8 / 41 ms (before, capped: 2.4 / 18 ms); the
  per-prompt gate 0.9 / 4.4 ms (0.6 / 3.8); `begin` end to end 63 / 335 ms (69 / 321). The
  work is the undreamed rows (dreamed ids are skipped before any row is read), and the
  undreamed rows below reach leave with the prune, so it grows with intake, not the store.
  Before, the 10x read hit `readCapped`.
- Review of #436: the queue read every dream with `SELECT *` (journals included) on every
  prompt. It now reads `store.dreamsShown` (no journal), and the gate only its week's dreams.
  On the 10x copy with 350 older journaled dreams added (365 in all), the gate's queue read
  went 7.3 → 2.8 ms (the same as at 15 dreams); counts unchanged. The carry's events were read
  through the event log's default page (500, oldest first); now whole.
- The reflection's part packer read a memory the fit left as an id, but that the dream also
  saw (so it was offered as a line too), as a line: a part cost more than `pack` measured.
  Once the queue read whole, the CJK limits test showed it (25.2k over a 24k part). Fixed
  in `reflect.ts#part`: an id is read as an id before a line.

## 2026-10-15 — a chapter's line is its summary (chapter summaries, P1)

- **What changed.** A journal entry's LINE — what the dream, the reflection and now the
  page writer show of a chapter the room does not take whole — is the chapter's summary
  when its session wrote one (`slices.ts#withSummaries`, `entryLine`); an automatic summary
  is the chapter's first words already, so it leaves the line as it was. The part
  renderers (`Dreams#part`, `Reflections#part`) render the same line at the same length,
  read off the run's index (`FitIndex.lineCap`).
- **How long, measured on a copy of the owner's store** (stand-in summaries of ~900
  characters on every chapter of the day). The busiest day, 10-11: 51 chapters, 75,032
  characters. Before: the dream's 30k journal room took 9 chapters whole and 42 as lines;
  the reflection's 24k, 5 whole. With every summary shown whole as its line (capped at
  600 bytes), the dream kept 1 whole and left 10 entries out altogether; the reflection 1
  whole, 18 out. So the line is ADAPTIVE (`summaryLineBytes`): 40% of the room spread over
  the entries in view, never shorter than an ordinary line (200 bytes), never longer than
  `SUMMARY_LINE_BYTES` (600). On 10-11: dream 7 whole + 44 summary lines (the 5 most
  important chapters whole, as before), reflection 5 whole (as before). 10-12 (34
  chapters): dream 13 → 10 whole, reflection 9 → 7, every entry shown. 09-27 (13
  chapters): unchanged, all whole. A quiet day reads its summaries at up to 600 bytes.
- **The queue leaves the journal's own memories out** (`Dreams#queue`): a chapter's
  summary — and a frozen full copy — reach the dream as their chapter's line in the
  journal section; queued as new memories too, the same chapter would be in the bundle
  twice. Before, the day's copies came in as memories cut to 4,000 characters each: on
  10-12, 6 copies and 23,519 characters; on 10-11, 3 and 9,775. Now none. Named cost: a
  dream no longer replays (returns to) a summary, so a summary is strengthened by use in
  recall only; and a day of chapters with no memories raises the dream's "new since"
  count by nothing.
- **Review of #504:** a later part renders a chapter's summary only if it was written
  by the time the fit ran (`withSummaries(…, asOf)`, the index's `at`), so a summary
  written or rewritten between begin and part cannot make the part longer than `pack`
  measured. The reflection's `recent` lane leaves the journal's own memories out, as the
  dream's queue does (the core lanes still take a summary about me).

## 2026-10-16 — the reflection proposes closing stale open threads (#489 D)

- The wake's "Still open" lane drew from ~60–70 unresolved memories, most open only
  because nobody closed them. Mike's call (lightly held): the nightly reflection proposes,
  the owner confirms with one word. Built from what was there: the stale list rides in the
  bundle like the unmarked offer (ids kept on the row's `detail.staleOpen`, rotated the
  same way); proposals are validated against it, kept on `detail.closeProposed`, and asked
  in the share as one generated line (the became-core precedent), so the hand-back, the
  carried line and `told` carry it untouched. The session is told how to act in the
  hand-back and carried line, not in the share's words.
- The confirm path is a new reflect phase, `close` (no new tool, no store change): ids ⊆
  the reflection's proposals, any day, told or not; the write is `closeThread`'s (flag
  false, reason `thread-closed`) with its checks. Weighed and not taken: the existing
  road, `remember` with `updates` + `unresolved: false`, mints a revision memory per
  closure — heavier than a yes deserves.
- Open: proposals a share already told or carried cannot be added (refused by name); a
  "no" is not recorded, so a declined thread may be proposed again after the rotation's
  three nights. Watch whether that nags before adding a memory of the no.

## 2026-10-20 — the reflection closes the plainly done ones itself (an experiment)

- Decided with Mike 2026-10-20, an experiment, lightly held ("ok lets go ahead and do
  that"): open threads still pile up (58 open on his store, 12 untouched for 2+ weeks), and
  a yes/no most mornings is a chore. The reflection now closes the clear cases itself and
  says so in the share; it still asks about the unsure ones.
- Shape: a second field beside `close`, `closeNow: [{id, why, shows?}]`. Same checks as a
  proposal (ids from `staleOpen` only, still open, share not told or carried), then
  `closeThread`'s guards (so `finish` takes the session's `scope`), and a why through the
  credential scan (`CLOSE_WHY_CHARS`). Asked and closed together keep to `STALE_OPEN` (5),
  which the offered list already bounds. The write is `closeThread`'s, plus
  `threadClosedBy: {reflection, why, shows}` on the memory and `detail.selfClosed` on the
  reflection row.
- The flags flip only once the share that says them stands: on a second finish whose
  share another session took mid-call, nothing closes (`share-already-carried`), like the
  proposals before it. The share's open-thread lines (closed, then asked) are one generated
  `closeLine`, rebuilt on a later finish.
- Order of writes (review of #535): the reflection row — the share naming the closes and
  `detail.selfClosed` — is written first, and the flags flip after it. As first built the
  flags flipped before the row, so a row write that threw (a locked database) left threads
  closed that no share said and no `reopen` could find, and a retry refused them
  `no-longer-open`. Now the worst a crash between leaves is a share naming a thread still
  open (`reopen` answers it as already open). A flag that fails to flip is taken out of the
  share, the row and the counts. An id sent in both `close` and `closeNow` is asked.
- Undo is a new reflect phase, `reopen` (ids a reflection closed itself, confirmed on its
  `selfClosed`, same guards, flag back to true, reason `thread-reopened`). The thread's id
  is enough (review of #535): the share is told in the morning and the owner may say "that
  one wasn't done" in a later session that never saw the reflection's id, so the
  reflection is looked up from the memory's `threadClosedBy.reflection`. Weighed and not taken: `remember`
  with `updates` + `unresolved: true` moves the thread onto a NEW memory (`closeThread`
  carries it only from a row still open), which is not putting it back. `reopen` stamps
  `threadReopenedBy` on the memory, and a later `closeNow` of it is asked instead
  (`reopened-by-owner`; the bundle marks it `reopened`): `revise` leaves its untouched
  days alone, so without the stamp the next nights would close it again.
- **The nightly run's stance, and the exception Mike made.** The night child's server is
  not the owner's (`night-run.ts#nightMcpConfig`, `OWNER_ENV` "0", 2026-10-02: "its
  write-ups close no thread opened elsewhere — until that is decided on its own") and is
  scoped to the launching session's directory, so as first built a self-close landed only
  for a thread written there. Mike, 2026-10-20 09:38: "i think its ok for nightly run to
  close threads from other folders" — a lightly held exception for `closeNow` and its
  `reopen` alone (`threadGuard`'s `anyDirectory`): the folder check is not made for a
  thread the reflection was shown as stale. Write-ups keep the 10-02 rule, and the `close`
  phase keeps its checks. A confidential thread (shown only to a bundle read as the
  owner's) and one the owner reopened are ASKED instead, from any session — a proposal,
  with a note and `counts.closeAskedInstead` — and the owner's yes closes it.
- Nothing in doctor or the dashboard counted proposals, so no line changed; the
  `reflection.finished` record now carries `closeAsked`, `selfClosed` and
  `closeAskedInstead`, and
  `reflection.reopened` is emitted on an undo. Watch (CHECK-AFTER, ~10-24): how many it
  closed itself, how many were reopened, and how the Still open count moves.

## 2026-10-20 — the core questions that waited a week (an experiment)

- Mike's go 2026-10-20, lightly held ("i agree with your recs, lightly held, lets try it and
  see how it goes"). Measured that day on his store: five core memories flagged "being
  reconsidered" on 10-13, two answered by 10-20, three waiting 7+ lived days (two of them
  also in unsettled pairs for 11–13 lived days). The reflection WAS handed the flagged ones
  (`reconsidering`, since 10-11), at priority 4 beside the whole core, with "you may leave
  one for another night" — and it left them. His session answered all three by hand.
- Shape (`core-ask.ts`): the offer is now only the ones that waited `CORE_WAITING_DAYS` (7,
  `sleep/tunables.ts`, shared with the wake and doctor), at most `CORE_ASK_MAX` (3), the
  least recently offered first (`detail.coreOffered` on the last `CORE_ASK_LOOKBACK`, 10,
  reflections — review of #542: a one-night memory starved the seventh of seven), then the
  longest waiting; each with `waited`
  and its unsettled `pair` (read off `contradictionsOf`, either side — `unsettledAmong`
  labels only the older side), the other memory taken into the room too. Priority 6, above
  the dream's own: these are the night's questions. The prompt says decide where you can,
  leave the rest, and that the waking session is still asked.
- Fresh flags are no longer in the offer: the waking session has the first week. `finish`'s
  `core` still takes any core memory the reflection was shown (the whole core rides in
  `core`), so nothing it could do before is refused now.
- A pair: `memoryRefusal` refuses settling over a core memory (`core-takes-pressure`), and
  `retireCore` clears `promoted_identity` and re-bands it at once, so the prompt orders it:
  retire in `finish`, then phase `settle` (open the same calendar day after a finish).
  Tested both ways. A retire whose memory is still in an unsettled pair says so on its
  `core` part's `note` (review of #542), with the settle to make or that the pair stays;
  a settle that then fails leaves the memory retired and the pair unsettled, and its own
  reply says why.
- The share's core line is generated like `closeLine` (`coreSentence`): one line naming
  each decision with its why and "If one is wrong, say so and I'll undo it", rebuilt on a
  second finish (`detail.coreLine`), cited (`told` records on them like any share cite). A
  share already told or carried takes none; the hand-back's `tellAlso` says it. The
  hand-back and the carried line add `coreHow`: the undo for a retire is remember's core
  keep (or `core --reaffirm`), for a keep a retire.
- THE UNDO DID NOT EXIST. A retire was sticky for everyone (`coreDemoted`, and `keepCore`
  refused `not-core`). Now `keepCore` by the owner or me awake, on a memory whose latest
  word on the core is a REFLECTION's retire, restores it: a `promoted` core event by that
  actor (lane `restored`, reason `restored: …`), physics and band back to identity, then the
  `reaffirmed` keep so it is not flagged again for what it is; `band.core.restored` is the
  event (not `band.promoted`, so doctor's "became core on reflection alone" does not count
  it). A reflection may not restore; a retire by the owner or by me awake stays sticky.
  Review of #542 (the coordinator's ruling, protecting Mike's word): the owner's or a
  session's retire on top of a reflection's is recorded as theirs (`retireCore` →
  `confirmed`, a `demoted` row, physics untouched), so a session's keep can no longer
  restore it; the owner's keep restores any retired memory. `core --list` lists each
  retired memory once, by its latest retire, and not one restored since.
- Recorded on the row: `detail.coreOffered`, `detail.coreDecided` ({id, decision, why}),
  `counts.coreOffered`/`coreKept`/`coreRetired` (also on `reflection.finished`). Doctor's
  Reflection line says how many have waited 7+ lived days (`coreWaited`).
- Watch (CHECK-AFTER, ~10-27): how many waited past 7, what it decided, whether Mike
  reversed any. If it retires what he would keep, tighten the prompt toward "keep unless
  plainly not who I am" before anything else.

## 2026-10-20 — the reflection held to the page's room (Mike's go, lightly held, an experiment)

On 10-20 the page writer made 4,756 bytes and the reflection rewrote it to 4,956, past the
4,600-byte room; the wake went from 4 sections to 3. The reflection is now told the room in
bytes, the page's bytes now (`pageInfo().bytes`, "It is N bytes now."), and that the page
stays thin (`self/writer.ts#PAGE_ROOM_RULE`, inside `PAGE_WRITING_RULE`). A page past the room
on the night's first send comes back `past-room` (`Counterpart` maps `Self#revisePage`'s
refusal to the words `pastRoomWords` gives), as a refused part: `retry` names it, the MCP
`say` asks for the cut before anything else, and a second `finish` with just the page is
written whether or not it was cut. The hold counts once per door per session per night,
so the reflection is held on its own first page past the room even after the writer was held
(10-20's pattern: the writer overshot first, the reflection wrote the longest page after it). If
the reflection never sends again, the nightly process keeps the held page at the child's return
(`night-run.ts` → `Self#keepHeldPage`). Tests: `test/page-held-to-room.test.ts` §2–3, and the
6,200-byte reflection in `test/nightly-run.test.ts` (held once, then kept).

## 2026-10-20 — the unmarked offer keeps up, the personal ones first (Mike's go, lightly held, an experiment)

Mike, 2026-10-20: non-work memories ("a friend is visiting this weekend") should flow across
folders, and work should mostly stay in its folder. An unmarked fact written in a project is
that project's work and is shown only there, sessions often leave `about` unset, and the
reflection was offered five a night.

- **What made a night "closed-door".** Only the owner's switch: `counterparts core
  --reflected-feeling off` (`sleep/consolidate.ts#acceptsReflectedFeeling`, the meta row
  `core.fast.acceptsReflectedFeeling`, open by default; owner ruling D1 on #256, "closed is
  fully closed"). It is the owner closing the core to reflection alone, and its help text
  promises him that a reflection then moves marks only toward work or world. The nightly
  run's not-the-owner stance (`night-run.ts`, `OWNER_ENV` "0", 10-02) is a different thing:
  it keeps confidential memories out of the bundles (`BUNDLE_OWNER`) and keeps write-ups from
  closing threads opened elsewhere; neither `finish`'s about loop nor `markAbout` reads it.
  So on a default store the reflection could already mark owner or us — nothing in the
  10-02 stance stood in the way, and no exception to it was needed. The exception the brief
  allowed (lifting a not-the-owner rule) had nothing to lift; the switch is the owner's own
  word and was left as it is. If it is off on his store, `counterparts core` says
  "Closed to reflection alone", and turning it on is his call.
- **The offer: 24 a night (was 5)**, and `LIMITS.about` 32 (was 8): the offer counts toward
  it, and eight stay for re-labels elsewhere. Not measured on the owner's store from this
  session (the read of a snapshot copy was refused by the session's permissions);
  `tools/audit/unmarked-offer.ts <copy>` prints the counts: the pool, how many a lived day
  adds, how many read as personal. 24 is the brief's 20–30, held lightly until that is run.
- **Personal first** (`dream/unmarked.ts`, pure, shared with the probe): a feeling recorded
  2, another person named 2 (names from live person memories — `name`, `entity`,
  `aliases`, a title of up to three words — and the store's person cards), a word of life
  outside the work 1 (`PERSONAL_WORDS`, whole words, none of the build's own: no feeling,
  dream, sleep, home, health, rest, walk, doctor — the last taken out at review, being
  the `counterparts doctor` of 458 paragraphs of the repo's notes), an entity 1, the owner's name 1 (it is in half the
  work notes too). Then the most used, the oldest, the id. Unmarked person and self
  memories are personal wherever written (`self/work.ts`), so they are never in this pool.
- **Rest nights kept** (3): a mark takes a memory out of the pool, so what rotates is only
  what the reflection left, and with 24 a night the pool turns over faster.
- **The share stays short**: past three re-labels into me, us or the owner, two are said by
  name and the rest in one sentence with their count — every one still cited.
- Tests: `test/unmarked-offer-1020.test.ts`.

## 2026-10-21 — confidential memories removed (dream and reflection)

- `BUNDLE_OWNER`, the `bundleOwner` getters, `CounterpartOptions.bundlesAsOwner` and the
  dream's `queue`/`gate` owner parameter are gone: they existed only for the confidential
  mark. Every bundle is read the same, so a store that had marked rows may count a few
  more in a dream's queue and the ask. Both `confidentialityOf` copies are deleted, so a
  merge, a gist or a reflection's entry carries no confidentiality key. Reflection lost
  its page-source refusal (`confidential-is-not-a-page-source`), its six-word-run check
  (`confidential-words-on-the-page`, and `sharedRun` with it), `touchesConfidential` and
  the confidential ask-instead on a self-close. `showable` keeps protected, archived,
  superseded, schema and empty rows out; `threadGuard` keeps protected, archived and
  other-directory. The night's `OWNER_ENV` "0" still means a write-up closes no thread
  opened elsewhere; the reflection's self-close and `reopen` still reach any folder.
  `ReflectContext.owner` stays for `threadGuard`, lightly held.

## 2026-10-21 — the night run is answered like any session

- Mike, 2026-10-21 12:18: "for 1, i agree, lets remove it." `ReflectContext.owner` is gone and `threadGuard` checks protected and archived
  only, so `close` (the owner's yes) also reaches a thread written in another folder,
  as the self-close and `reopen` already did. The night run no longer launches with
  `COUNTERPARTS_OWNER=0`.

## 2026-10-21 — the night's tagging ask (wave 2 lane B)

- Its own child, not the reflection's finish (the brief said "likely the reflection, like
  `core-ask.ts`"): labels, "same?" and "which kind?" are small-model work, and a child of its
  own leaves `reflect.ts` to lane C. It is the dream tool's `tags` phase (the page writer's
  `writer` phase is the precedent), two calls: the bundle, then the answers.
- The dream's intake is unchanged with tags present: on a copy of the 10-20 corpus, the
  dream's `fresh` set is the same 146 memories with the card-name backlog written and
  without (and `test/tags-night.test.ts` holds it on a fixture).
- Its size on the corpus copy: 40 memories, 2 pairs, 10 cards — 20,124 characters, about
  5k tokens of bundle and prompt. With `claude -p`'s own system prompt and tool list and three
  turns, about 60–80k input tokens a night (mostly cache reads) and 2–3k out, on the small
  model (`NIGHT_TAGS_MODEL`). Not measured on a model: no model nights from this lane.
- The backlog on the corpus: 813 memories with no tag after the card names (of 2,138 live):
  about 20 nights at 40. Card kinds: 120 waiting, 12 nights at 10.

## 2026-10-21 — review of #576: the tagging ask, bounded

- Both ways at the door (`server-self-tools.ts`): a plain session asking for `tags` is refused
  `night-run-only`; the tagging child asking for any other phase is refused `tags-child`. It
  reads memory text it did not write, so it holds the one phase and nothing of the dream's
  setting, launch or begin.
- `askTags` records the ask under the run; `applyTagsAnswer` takes only what it lists, each
  memory once, and re-checks at write time (live, not the journal's row, no tag of its own).
  A pair never shown ("castle" / "taxes") and a card never asked about are refused by name.
- "Untagged" counts only the hands that say what a memory is about (`OWN_TAG_VIAS`); a
  card's name alone would otherwise mark ~1,300 corpus memories tagged with names only,
  and no topic word would ever reach them.
- Undo: a revision that carried a night tag on (`via: carried`) loses it too, and so do its
  own revisions after it, followed by where the carried tag came from: the memory each
  revision declared (`meta.updates`, `Store#revisionsOf`). Not `superseded_by`:
  `remember … updates` with the default `changed` leaves it NULL on both rows (re-review
  of #576; lane G met the same trap). A kind changed since the night is left as it is.
- One ask record is kept (`tags.ask.<run>`): a new run's read removes the last run's.

## 2026-10-21 — the night proposes a project (wave 2 lane G, design §8; lightly held)

Design §8: related folders join one project on Mike's word, "or the night proposes it from
co-use and asks". `project-ask.ts` (kept apart from `reflect.ts`, as `core-ask.ts` is):

- **Mechanical, no model.** Over the last `PROJECT_JOIN_WINDOW` (14) lived days, two folders
  are proposed when both were written in on at least `PROJECT_JOIN_DAYS` (3) of the same days,
  at least half the less-used folder's days, AND their memories name at least
  `PROJECT_JOIN_SUBJECTS` (3) of the same subjects (cards, by name), at least
  `PROJECT_JOIN_OVERLAP` (0.4) of the telling subjects of the folder that names fewer.
  A subject named in more than half the active folders is not telling.
- **Why those two gates**, measured on the 10-20 corpus copy: by days and raw subjects alone
  every busy folder paired with every other ("Mike, Counterparts, Claude"); the spread rule
  left ~/pwntastic pairing with both busy folders on Apple/Gmail/Google; the overlap rule
  leaves one pair, ~/random → ~/counterparts (10 shared days, overlap 0.64; every other pair
  0.25 or under). ~/counterparts-site never qualifies (its memories name only what every
  folder names): Mike joins it himself.
- **One pair a night**, in the reflection's finish: a generated line in the share
  (`joinSentence`), `detail.joinProposed` and `joinLine` kept on the row like the core line,
  and the hand-back (and a carried share) says how to act: the reflect tool's phase "join",
  on the owner's yes only, which joins them `by: night` and records `detail.joined` and a
  `reflection.project.joined` row. A no, or no answer, changes nothing; the pair rests
  `PROJECT_JOIN_REST` (7) reflections.
- Never proposed: folders already one project; a folder the host keeps home (`folderOn`);
  the store's own folder (the nightly run's) or one inside it.
- `PROJECT_JOIN_ASK` (on) stops it; every number is compare-settable (`dream.*`).

### 2026-10-21, after review of #580

- **A stale yes cannot pull a folder out of its project.** The folder that would join is
  proposed only when it is alone in its project, and the proposal keeps its lived day and both
  folders' projects. At `join` (`joinStillStands`), the yes is refused when the proposal is
  older than `PROJECT_JOIN_EXPIRE_DAYS` (3), when either folder's project changed since, or
  when the host now keeps either folder home.
- **Who may say yes.** `join` is refused in the nightly run (`NIGHT_CHILD_ENV` or
  `NIGHT_RUN_ENV`, as a dream's undo is) and until the share was marked told, so the yes can
  only follow the owner hearing the question.
- **Harder for a general folder** (the coordinator's call): a folder used on the same days as
  `PROJECT_JOIN_GENERAL` (3) others or more is never proposed, and the shared subjects must be
  at least `PROJECT_JOIN_OVERLAP_MAX` (0.25) of the telling subjects of the folder that names
  more, too. The question now says plainly that all of each folder's work would show in the
  other's wake. Folder and subject names in the share are flattened and capped.
- `written` counts distinct memories, not a row per subject.
- **Re-measured on the corpus copy: nothing is proposed.** ~/counterparts is a general folder
  now (used on the same days as ~/random, ~/general, ~/pwntastic and ~/counterparts-site), so
  ~/random → ~/counterparts no longer qualifies; with the general gate lifted it still would
  (the 0.25 floor passes: 21 shared of 46). A folder's busiest project is the one most often
  "general", so the night will rarely propose joining INTO it; the owner's
  `counterparts project join` remains the door for that.
- A silent night with a proposal now offers a share whose only content is the question
  (`share.reason` `join-proposed`). Intended.
- **Accepted risk (the coordinator, after review of #580):** a reflection launched from an
  awake session runs as a background agent in that session, with no night env, so in
  principle it could call `told` and then `join` itself. Every stronger check offered would
  also block the owner's own yes in the same session. It is the trust model `close` has
  today. What would close it later: a yes carried by the owner's typed turn (the host's
  record of what the person typed), checked at `join`.


## 2026-10-21 — the reflection writes and files beliefs (wave 2 lane C2)

- **Shown, not citable.** The beliefs section lives beside the memories, and its ids are kept
  on the row's detail (`beliefSelf`, `beliefSubjects`, `beliefsShown`, `beliefsContested`),
  never in `shown`: a belief cannot be cited (which would count as a return), felt or marked.
  "Cited again by the reflection" so adds nothing by construction.
- **Subjects in play** are read off the memories the night may show (`subjectsOf` over the
  fit's candidates), not only the ones that fit, so a subject is there when its memories
  are in a later part.
- **Births need a lived cite.** A belief with nothing lived behind it is a guess; one cite
  is the floor. Cites that are not shown or not lived are left out of its support and said.
- **Near-duplicates** use `remember/updates.ts#similarity` (token cosine) at v1's 0.6, the
  belief a birth `replaces` excepted (a better wording is close by design).
- **Retire** goes through `reconsolidation.ts#settle` as the reflection (actor
  `reflection`), held over by the memory that contested the belief, `corrected`: archived,
  its words and support on the record, undoable like any settle.
- **What I'd run** (not run here: no model nights from this lane): one model night on a
  temp copy of the corpus store, `harness compare --set schemas.BELIEFS_BIRTH=false` against
  the default (~1.8M tokens), to read how many beliefs a night births and files and whether
  the near-duplicate bar holds; then Dana's meaningful week once, after C3.
- **A replacement rests on the evidence** (review of #577, the coordinator's call): a
  `replaces` birth must cite at least one of the contested belief's contrary memories
  (`replaces-without-the-evidence` otherwise), and those memories are shown with the belief
  (`contestedBy`). The same-claim check (`BELIEF_SAME_CLAIM` 0.9, negations exempt) stays,
  but word overlap cannot fully stop a reworded restatement: "We work best at dawn, not at
  night." (0.85), "No doubt: we work best at dawn." (0.85) and "…nothing else comes close."
  (0.75) pass it. Citing the evidence is what a restatement lacks. On the 10-26 check list.

## 2026-10-21 — the dream proposes beliefs; a session writes one rarely; the owner corrects (lane C3)

- **A candidate is a change, not a row.** `belief-candidate` records `{subject, statement,
  sources}` on the dream's change and writes nothing else, so undoing the dream withdraws
  it and nothing has to be archived; the reflection's adoption is a birth of its own
  (route `dream`), awake, and outlives the dream's undo. The subject is free text from the
  dream (it is shown no cards): "me", "us", or a name, which the reflection maps to a
  subject it was shown, or names itself.
- **Its ceiling is top-level** (`BELIEF_CANDIDATES`, settable by a compare); the `LIMITS`
  entry only names the action.
- **A session's birth** asks for testimony, a choice, or a felt moment (≥
  `BELIEF_SESSION_VIVID` 0.6 felt at the time), so an ordinary note does not mint beliefs;
  the reflection is the usual author.
- **The owner's correction** goes through the update guard by id (his "that's wrong" need
  share no word with the belief) and settles at once; another writer's update of a belief
  is read by the guard and, if it goes on, presses.

## 2026-10-22 — a night's child carries its own session id (lane L)

`NightChildRun.hostSession`: the id the host ran the child under, when the night chose it
(`--session-id`). Optional, read back forgivingly, absent on rows from before; the event
row carries the named ones as `childSessions` (`nightChildSessions`). No schema change.
What it is for: a child's transcript or output is matched to its row by name, not time
(`tools/harness/night.ts#nightRowFor`).

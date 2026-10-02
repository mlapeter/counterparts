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

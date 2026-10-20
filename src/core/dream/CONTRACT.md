# `dream/` — CONTRACT

*Added 2026-09-26 from the owner's decisions of that day (dreaming + consolidation).
Working defaults, held lightly: "try it, see how it goes, adjust".*

## 1. Purpose

Let the counterpart dream: a few minutes, once a day at most and only when the owner
says yes, of replaying what was lived since the last dream beside what it resembles,
and changing the store in the ways sleep changes a brain: merge, link, strengthen,
notice a pattern, flag a contradiction, soften a feeling. Keep a dream journal. Never
let a dream pass for something that happened, and make every dream undoable as a whole.

This module holds the RULES and the BOOKKEEPING: when a dream is due, what a dream is
shown, what it may change and how much, the record of every change, and undo. The
dreamer is the model (a background agent the session launches), outside this process.

## 2. Brain analog

- **Deep-sleep replay** (the hippocampus replaying the day during slow-wave sleep and
  handing it to cortex — Wilson & McNaughton 1994; Diekelmann & Born 2010): file what
  happened, link what belongs together, merge near-copies into one trace, and strengthen
  what matters. Here: `merge`, `link`, `replayed` (a return at half weight).
- **REM mixing** (loose associations across distant memories; insight and pattern after
  sleep — Wagner et al. 2004; Cai et al. 2009): `mixing` and `lookback` in the bundle,
  `gist` as the pattern written down, `contradiction` when two memories cannot both hold.
- **Emotional softening** ("sleep to forget, sleep to remember" — Walker & van der Helm
  2009): the sting fades, the memory stays. Here: `feeling-now`, recorded beside the
  original, never stronger than it was felt.
- **A dream journal.** Dreams are remembered as dreams.

**Named deviations** (constitution line 12):

1. **A dream is ASKED for.** Humans do not consent to sleep; here the owner says yes, once
   a day at most, because a dream spends his model's time and changes his store.
2. **A dream is not lived.** Its words are refused by capture (`DREAM_MARK`), its journal
   is not a memory, a gist it writes starts lower than anything lived (source
   `dreamed`), and its replays count toward no core lane. Human dreams leak into waking
   memory; this one is kept from doing so on purpose.
3. **Nothing is lost to a dream.** A merge keeps its originals: since 2026-10-11 (Group 2b;
   decided by random-06, lightly held) each is settled `changed` under the merged memory
   through the one door (`reconsolidation.ts#supersede`, source `dream-merge`) — faded ×0.5,
   live, labelled earlier, hidden behind the merged memory in ambient recall and folded under
   it in facts mode — and leaves by its own curve. Merges from before were archived with a
   forwarding address. The whole dream can be undone, and the owner can undo one original.

## 3. Keeps

- **Sleep changes memory offline** [v0: auto-consolidation on a cycle; the field guide's
  consolidation]. `sleep/` stays arithmetic-only; this is the part that needs a model,
  and so it is a separate, asked-for act.
- **Recall's gates** [v2 recall §9.1]: a dream is shown only what could surface in the
  session that launched it — no archived, superseded, protected or schema row; nothing
  confidential outside the owner's own session.
- **Versions, never deletion** [constitution 7; store §16]: a merge settles over its
  originals (before 2026-10-11 it superseded them); undo restores.
- **One door per act, every claim mechanized** [mcp §5 G2]: one tool, `dream`, with
  phases.
- **The authorship doctrine's provenance** [owner ruling 2026-08-29]: a dream's gist is
  minted on its own channel, `dreamed`, engine-set.
- **#238's idea**, harvested for returns rather than here: what the display prompts is
  not evidence.

## 4. Drops / simplifies

- **No model call in this module**, and none in `sleep/`: the dreamer is a background
  agent the session launches with its own tools.
- **No dreaming nobody chose.** The default asks the person, in their terminal; only the
  owner's `auto` lets the host start the run on its own (2026-09-29).
- **Settling is mostly not the dream's** (2026-09-29, held lightly). A dream flags a pair
  (an unsettled row in `contradictions`); the pair is raised awake next session, and to
  the owner when it is about him. A dream MAY settle a pair it was shown when the reason
  is plain (`settle`, `why` required), and the trail names the dream.
- **No promotion.** A dream nominates; only a core lane at consolidation promotes.

## 5. Contract

### 5.1 The line — the nightly run starts (2026-09-28, working defaults, held lightly)

- **The owner's setting**, `auto` | `ask` | `off`, default `ask` (2026-09-29; `auto`
  until then) — in the store's meta
  (`dream.setting`), so the hook, the MCP server and the console read one value. Set by
  the dream tool's phase `setting` (the owner saying "no dreams" in conversation is
  `off`) and by `counterparts dream --setting`; reversible the same way; recorded on the
  `dream.ask` row with what it was; shown by doctor's Dreaming line and by
  `counterparts dream`.
- Due when: not observer; the store has lived more than one day; no dream journaled
  this CALENDAR day (the I32 reason the writer already followed: the lived clock
  advances inside the sleep cycle, so a gate on it can miss nights); the setting not
  `off`; no run under way (a dream begun and busy within `ABANDONED_AFTER_MS`); the
  day's line neither given nor declined — or given to a run that was LEFT BEHIND
  (below); and at least `MIN_NEW` showable memories made since the last dream. Fewer:
  nothing runs, and they carry over (new is since the last dream).
- Raised on the first prompt, at most once per calendar day across every session (the
  `dream_asks` latch, `launched` or `offered`), in TWO renderings from one gate
  (`offer`, 2026-09-29): a line for the MODEL (the hook's `additionalContext`) and a
  line for the PERSON (the prompt hook's `systemMessage`, shown in the terminal). The
  host claims the day (`claimOffer`) only once it knows the person's line is leaving;
  unclaimed, the model's line is taken back too and the next prompt offers it again.
  `askLine` is offer-then-claim, for callers with no terminal. Every rendering for the
  model tells it to say the line once, in its first reply, as one plain sentence
  (`sayOnce`, 2026-10-01). A run started by a session nobody watches is HELD
  (`holdTold` → `heldTold`, worded for the reading session, while the run is still
  going → `claimHeldTold`, an event latch per run): the host's rule for who may claim
  is the adapter's (claude-code CONTRACT, "Only a session someone can see").
  `ask` (the default): the person is shown "I haven't dreamed since … (N new memories).
  Say "dream" to start, or "dream on your own" to let me do it each day." The model
  does not ask again; "dream" is `launch` → one background agent, "dream on your own" is
  `setting auto` and then today's run the same way, not today is `decline`.
  `auto` (2026-09-29): HEADLESS — the host claims the day and starts the run itself in a
  windowless session (claude-code `night-run.ts`); the model launches nothing and is
  told so, and the person is shown "dreaming in the background (a few minutes). Say
  "no dreams" to turn it off." when there is room. When that run could not do its job —
  `could-not-start`, or `timed-out` / `failed` / LOST (a `started` row past its watchdog
  and `NIGHT_LOST_GRACE_MS`) having begun nothing — the line falls back to an ask with the
  reason, at once: "I couldn't start dreaming on my own: <reason>. Say "dream" to do it
  here." — recorded `offered` after `could-not-start`, not counted as a relaunch. A run
  still inside its watchdog makes the gate `dreaming-now`. The next calendar day tries
  headless again. "No dreams" takes effect from the next run; a run in flight finishes,
  and the owner is told so (owner decision D).
  THE CATCH-UP ALONE (2026-10-11, `catchUpOffer`): under `auto`, when the gate says
  `too-little-new` or `first-day`, the day is unclaimed and no run is under way, the host
  may claim the day with a silent headless offer carrying `dreamSkipped` — when it finds
  write-ups from an earlier day owed (the host's question, not this module's). The run
  writes them up and skips its dream and reflection; its row is `done` with both children
  `skipped: <reason>` (`dreamSkippedOf`), never a failed dream, and the `dream.ask` row
  carries the reason. A later dream that day comes only through the ordinary relaunch, once
  the queue reaches `MIN_NEW`.
  THE FIRST MEETING'S DAYS (2026-10-12, `DreamContext.holds`, `onboarding.ts#meetingDay`):
  on the first meeting's first offer day, on a later day it was begun (`offered`) and is not
  finished, and on the day it finished,
  the gate says `meeting-day` before anything else but observer — no line, no headless
  run, no catch-up alone. The first dream of a new install waits for its next lived day
  and never dreams on half a meeting. A store with no meeting keys is never held. "Undo
  that dream", said, is the dream tool's `undo` phase (`Dreams.undo`, as `--undo` is);
  never in the nightly run.
  `off`: nothing.
- **`auto` from before 2026-09-29 is reset once** (owner decision A): its meaning changed,
  so an explicit `auto` in a store's meta becomes `ask` on the first hook prompt of this
  version (`resetAutoOnce`), recorded on `dream.ask` (`by: upgrade`), and the owner is told
  once. A setting chosen on this version is never reset.
- **The headless run's record** (2026-09-29): one row per run, the latest in the store's
  meta (`dream.night`: run, date, state `started` | `done` | `partial` | `failed` |
  `timed-out` | `could-not-start`, reason, exit code, its watchdog, the PARTS that ran —
  writer, dream, reflection — and the dream and reflection it produced), each state
  on the `dream.night` event log latched by run and state. Ids, codes and times only.
  Doctor's Nightly run line reads it; the dashboard can later. Since 2026-10-09 the host
  adds what the child's transcript said: `transcript` (`read` | `absent` | `unreadable`)
  and, when read, `spills` — results the host cut to a preview.
- **The hand-back of a headless run** — the dream's own line (`handBackOf`) and the
  morning share — has no agent to return to a session, so once the run has ended the
  next prompt anywhere, the launching session included, carries both, once ever (a
  latched `dream.night.handed` event, then `handedAt` on the row so later prompts only
  read; the share through `Reflections.carryLine`). A partial run's line says it was
  partial; a reflection-alone run hands back its share only. A run with `spills` adds one
  plain line (`nightSpillLine`, 2026-10-09) — handed back even when it journaled nothing.
- **A run left behind does not use up the day.** A dream begun, never journaled and
  quiet for `ABANDONED_AFTER_MS` (30 minutes: its session closed and the background
  agent went with it), today's or yesterday's, makes the line due again once the line
  itself has been quiet as long — and with `auto`, so does a launch no dream followed
  (headless or not: a headless run cut off is started again headless).
  At most `RELAUNCHES_PER_DAY` (2) a day, a compare-and-set on the latch
  (`reclaimDreamAsk`); an `ask` nobody answered is not asked again, but one the owner said
  yes to is (`launch` flips the day to `launched`). A dream that began, changed nothing and
  went quiet does not count as following a launch. A dream journaled today whose
  reflection never finished makes the line start the REFLECTION alone (`reflect launch`
  with the dream's id), under the same latch and cap.
- Never in the headless nightly run's own child. (The reflection that follows a dream is
  the DREAMER's, in the run that dreamed — not a phase of the dream: see §5.4. The page
  writer's separate host-mode child was removed on 2026-09-29.)
- An unsettled pair (a dream's flag, or a settle that was undone) is raised the same way,
  once — the pair's `raised_day` is the latch since v10 — when both memories are
  showable, naming the pair's id and the `note` settle.
- *(Removed 2026-10-09: the ask's read-only preview, `previewAsk`, made for the
  dashboard's Tonight box. The box left the home page in round 4 (#273) and nothing
  called it since; NOTES 2026-10-09.)*

### 5.2 The nightly run, and the dream in it

- `launch` returns the prompt for ONE background agent (same model, same MCP server,
  the session's id), written by this module (`launchPrompt`): the NIGHTLY RUN, in the
  order `NIGHT_ORDER` gives — the owner's call, 2026-09-28: **the page writer, then the
  dream, then the reflection**. The writer first: it reads yesterday before any merge
  archives an original, it survives a session cut off mid-run, and the dream and the
  reflection see the fresh page. Each phase's `next` follows the same list, so another
  order is one line. The writer is the dream tool's phase `writer` (self CONTRACT; it
  claims the night for this session and hands the day and the page whole through the
  tool result); writer and reflection are DIFFERENT jobs and both may write the page
  for now, with their own author labels (`writer`, `reflection`), every version kept.
  The HEADLESS night (2026-10-11) asks for the prompt without the reflection
  (`launchPrompt({ reflect: false })`): its first child ends at the dream's journal, and
  the reflection runs after it as a child of its own, from `Reflections#launchPrompt`
  with tonight's dream id, reading the dream from the store with a fresh context.
- `begin` refuses under observer, when a dream was journaled this CALENDAR day, while
  another session's run is busy (`dreaming-now`), and when nothing is new. A dream LEFT
  BEHIND — begun, never journaled, quiet for `ABANDONED_AFTER_MS` — is RESUMED when it
  changed something and is today's or yesterday's: the same dream, moved to this
  session, today and this lived day, its changes standing and counting toward its
  limits, its bundle composed again (marked `resumed`, with what it had changed). One
  that changed nothing is closed (`undone`) and a fresh one opens; one older than
  yesterday stands as it is and new-since counts from it. Otherwise it records the dream
  and returns the bundle: the self page,
  the wake, journal chapters since the last dream, the owner's names and the memories
  about him, every new memory with its `NEIGHBOURS` nearest older ones (the static
  embedder's vectors, or the token index), `MIXING` loosely related older ones, the
  `LOOKBACK_COUNT` strongest-feeling memories from about a week back, and WHAT'S ON MY
  MIND (2026-09-27, `mind.ts`): up to five open things — a memory dated in the next two
  weeks, a pair a dream flagged that still stands, where the work stands in a directory
  (a handoff's first line, words only). Not new; the dream may draw on them. The ids
  shown are recorded on the dream; nothing else can be changed by it.
- **The queue, tonight's room, and parts** (2026-09-28, build B; working defaults, held
  lightly — `fit/` CONTRACT states the principle; read whole and ranked by value ×
  fragility since 2026-10-11, Group 3 part C). "New" is every showable memory that no
  dream that stands was shown (read from the dreams' own `shown`; a dream being resumed,
  or one the next `begin` will resume or close, is passed over) and that is still within
  reach on its own curve (`physics.REACH`), born since the first standing dream's
  `FIRST_DREAM_DAYS` look-back (a store's life before it dreamed is not a backlog), plus a
  refused fold's carried parts. The whole queue is read — no positional cut. The
  per-prompt gate's `MIN_NEW` counts it only `ASK_QUEUE_DAYS` back, newest first (a floor,
  said as one). `begin` ranks it by replay priority = value × fragility (`replayPriorityOf`:
  value = salience on the curve + how strongly felt + 0.4 dated + 0.3 on my mind;
  fragility = `1 − strength` on the next lived day, at least `FRAGILITY_FLOOR`), carried
  fold parts first and together, and takes tonight's new memories in that order while their lines,
  and their neighbours', fit `FRESH_SHARE` of `NIGHT_CHARS`; the rest WAIT for the next
  night, counted in the bundle (`queue`), the tool's `how` and the hand-back. A
  never-dreamed memory leaves the queue when it falls below reach, and how many did since
  the last dream is said (`agedOut`, a name kept from the fixed window it counted before).
  Every memory shown has a line at least and says why
  it is here, what it is about, its strongest feeling and its whole length; the most
  important come whole (up to `DETAIL_CHARS`, else an excerpt with its length). The
  journal comes as ENTRIES, cut at the chapter headings: only the entries added since the
  last dream (how far it read each episode is kept in its index), a line each, the most
  important whole. A bundle longer than one tool result — measured as the MCP server sends
  it — comes in parts (phase `part`). A merge or a gist records the fidelity it was made
  from (`detail.fidelity`: whole, excerpt, line — or whole, looked up since).
- **The day's replay — an experiment, started 2026-10-19 (feedback-loop build, part E;
  check on ~10-22, two lived days after install).** Trying this to see whether the day's
  own use, fed back into the night, changes what the dream replays and links. `day.ts#readDay`
  reads the stretch since the last dream's start from rows the day already leaves:
  `recall.credit` (opened, quoted, `drewOn`), `recall.rated`, waking `returns` (every source
  but `dream`, `reflection`, `legacy`) and `recall.decision` (shown). Each memory gets its
  strongest mark: `reward` (`drewOn` or rated 3), `used`, `useful` (rated 2), `shown` (never
  if rated 0 in the stretch). A queued memory's replay priority is multiplied by
  `1 + DAY_LIFT[mark]`. Up to `TODAY_COUNT` used / useful / reward memories are listed in the
  bundle as `today`, strongest first; one already dreamed joins in the role `today` (fit
  priority `TODAY_FIT`, between `new` and `on-mind`; it takes over a neighbour's or a mixing
  role, and a look-back one keeps its own); a queued one that is not tonight's new
  is left out (shown, it would leave the queue undreamed). Pairs used together in one
  session, both shown, are listed as `todayPairs`, at most `TODAY_PAIRS`. The launch prompt
  says what both mean. Physics and the dream's limits are unchanged: the dream still chooses
  what it replays and links. A night with nothing new still does not dream (`nothing-new`).
  The `dream.begun` row counts `today`, `todayReward`, `todayDreamed`, `todayPairs`,
  `freshMarked`. Revert by setting `DAY_LIFT` to zeros and `TODAY_COUNT` to 0, or by
  reverting the commit; nothing is stored differently.
- **A memory leaves the queue once it was delivered** (2026-10-10, Lane 0; working
  default). When the run's transcript shows the host cut a dream part to a preview and the
  part was not fetched again whole, `requeueSpilled` takes that part's new memories back
  out of the dream's `shown` (a cut `begin` returns the whole fresh list, which rides in
  part 1), except any the dream acted on (a standing change names it, or it looked it up).
  They rejoin the queue; the count rides on the run's row (`requeued`), the
  `dream.requeued` event and the morning's spill line. Without the dream's own index the
  cut parts are counted `unattributed`, never guessed.
- `propose` applies each change on its own, within per-dream `LIMITS`, and records it
  with what undo needs (ids and numbers only):
  `merge` (two or more near-copies, not core, into one memory in better words, under
  the strongest original's kind when the kinds differ; the
  merged memory stands where the strongest original stood, carries their returns,
  feelings and trait nudges — each nudge keeping its source, model and moment, each
  feeling its source, its recorded-later date and (since 2026-10-02) its moment — and
  inherits their links; since 2026-10-11 it also takes the strongest original's `about`
  mark, its setter, and its writer's fields (who said it, its status, when) — a personal
  mark (me, us, owner) from any original wins over a work or world one, and any mark
  over none — and its era
  standing: an original written before the old-claims cutoff gives the merged memory its
  moment (`meta.eraWrittenAt`) and its `claimedDefault`, so the era reads the merged
  memory as it read that original; `store/marks.ts#inheritFrom`, `store/operational.ts#eraCarriedFrom`),
  `link` (both ways, proposed at `LINK_WEIGHT` through
  `associate`, only where there is room, since 2026-09-28), `replayed` (a
  return at `DREAM_RETURN_WEIGHT`, never a use), `gist` (source `dreamed`, citing and
  linked to its sources, salience capped at `DREAMED_CLAIM_CEILING`; since 2026-10-11
  it takes what its sources were about by the merge's rule, a personal mark winning, the
  first named as best — `store/marks.ts#inheritFrom` — and no era standing, its claim being
  its own; D6, §7 Q2), a FOLD (2026-10-11, Group 3 part B, item 15: a `gist` with
  `fold: true` — not an action of its own — saying the standing outcome two or more parts
  add up to; it holds over each part through the one door, `reconsolidation.ts#supersede`,
  how `changed`, source `fold`, `closeFlags: false`: the part fades ×0.5, stays live, is
  labelled earlier under the fold and joins its slot. Kept at their own weight, still cited
  and tied: the core, a protected memory, a reading or a world memory, a strongly felt
  `self` or `person` memory (feeling ≥ `FOLD_FELT_FLOOR` 0.5; review 11 C3), a dated one, a dream's own words and an earlier version
  (`foldExemption`). It starts at the strongest strength of the parts it holds over, read before any fade, in
  [`DREAMED_CLAIM_CEILING`, `FOLD_CLAIM_CEILING` 0.6]; its title is its own (no
  `Dreamed:`); the dream picks its kind; it is `me`/`us` only when most of its parts are (`foldMarkFrom`), else their most common other mark. At most
  `FOLDS`, 5, a dream; one past it is refused `limit-reached`, counted on `dream.changed`
  as `foldOverflow` and said in the hand-back; its parts a fold would fade (two or more)
  are CARRIED to the next night's queue as one group (2026-10-11, Group 3 part C: a
  `dream.carried` event; `foldCarried` on `dream.changed`). Counted as `fold`, not `gist`. A later
  `corrected` settle over one of its parts flags it beside the corrector, source
  `fold-source-corrected`; "which folds came from X" is `Store#foldsCiting`, a query over
  `meta.sources`), `contradiction`
  (an unsettled pair in `contradictions`; a pair already standing is left as it is),
  `settle` (2026-09-29: two memories it was shown, `holds` / `over` / `how` / `why`,
  through `reconsolidation.ts#settle`; undone with the dream unless settled since),
  `slot` (2026-10-11, Group 2: a "to-confirm" pair on my mind — the slot detector read two
  memories as one thing's earlier and later state — `same: true` confirms it as a settle
  `changed`, `same: false` withdraws it with its provisional cut put back; at most
  `SLOT_PER_NIGHT`, 4, shown a night, the least shown then the oldest first, beside the ranked items; undone with
  the dream as a settle, or as the proposal it was. *Amended 2026-10-19 — an experiment, not
  a ruling (agreed with Mike; check on ~10-22; revert by setting `SLOT_FADE` back to 0.8): a
  proposal makes no provisional cut (`SLOT_FADE` 1), so it only flags the older for the
  dream; `same: true` is then the only fade, and `same: false` has nothing to put back
  unless the proposal was made before, with its cut on the trail. Trying it because the
  detector was right on 4 of 7 by hand-read and the dream said "not the same" on 3 of the
  4 it judged.*),
  `feeling-now` (the self's feeling today, capped at the memory's peak; the same
  feeling twice in one dream is one record), `nominate-core`
  (the dream's SUGGESTION of what a memory is about — any memory not already core,
  because a dream cannot set the mark and a nomination promotes nothing; recorded in
  `core_events` with the dream's reason).
- **Accept and repair; every refusal names what tripped it** (owner direction
  2026-09-28). A change that is refused says the rule and the id or field in `detail`;
  one that was written with something to say (a split emotion, a capped strength, a
  text kept to its cap) says it in `note`. A text over its cap is kept to the cap and
  said, never cut without a word.
- `journal` closes the dream with its entry (kept in `dreams.journal`, never a memory)
  and returns the hand-back line, which begins with the mark — and tells the dreamer to
  wake and reflect (§5.4). The run's final message is the reflection's hand-back, which
  opens with the dream's line.
- Every word a dream writes is redacted of credentials first.

### 5.3 Guarantees

1. **[M]** A dream cannot delete, edit the self page, promote, rewrite a memory in place,
   or change a memory it was not shown (`apply`'s action list and `shown`).
2. **[M]** At most one dream journaled per calendar day (`begin`); a dream left behind
   is resumed, not counted (2026-09-28).
3. **[M]** A dream's words never become a lived memory: the bundle and the hand-back carry
   `DREAM_MARK`; `remember/spans.ts#enters` refuses any turn carrying it; the Claude Code
   reader tags such a block `dream`. Tested end to end: seed, dream, sweep, zero rows.
4. **[M]** Undo reverses the whole batch and is idempotent: originals restored (each
   original's pair undone, its strength back; a merge from before 2026-10-11 un-archived; a
   fold's parts likewise, each pair undone, unless the fold has moved on since: `kept`), the merged memory and gists archived `dream-undone`, links back to
   their prior weights, the dream's feelings, replays and nominations removed. A merge
   whose merged memory has moved on since (revised into a successor, merged again,
   archived or removed) is left as it is and counted (`kept`), so an undo never stands
   originals beside a live successor (review of #251).
7. **[M]** What a dream makes keeps the rules of what it was made from: a merge or gist drawn
   from a confidential memory is confidential; a dated reminder, a memory the owner
   demoted from the core, and an earlier version (one a later memory holds over: merge the
   one that holds, 2026-10-11) are not merged; a dream's merges are not "new" for the next
   ask; a dream left open is closed to changes once a newer one begins (review of #251).
5. **[M]** Under observer stance nothing is written and every phase says so.
6. **[M]** The journal lives in the `dreams` table: no decay, dedup, prune or recall
   touches it.

### 5.4 Reflection — the waking self (2026-09-27, working defaults)

`reflect.ts`, and the `reflect` tool. Dreaming, reflecting and talking are three things:
a reflection is LIVED, has its own record (`reflections`, with an optional dream id),
usually follows a dream and can run on its own, so the self page does not depend on a
dream having run.

- `begin` refuses under observer and when one already finished this CALENDAR day
  (2026-09-28); given a dream, it must be this session's and journaled. It HANDS the
  reflection, rather than letting it search: WHAT THE DREAM SAW (2026-09-28: every
  memory the dream was shown and what it made, still standing, a line each — citable
  like the rest), the SELF PAGE WHOLE (it was cut at 6,000 characters while a page may
  be 16,384 bytes), the dream (journal, gists, nominations — marked as dreamed), the
  last few days' chapters and memories, its own last few reflections, what's on my mind,
  the self page, the core, the core candidates, the most strongly felt memories that
  could be about me (marked or not), and memories that became core on reflection alone
  since a share last said so — as memories and feelings, **never the lane arithmetic**.
  Since 2026-10-02 (lane B) also **feelings over weeks** (`feeling-weeks.ts`; a few
  hundred characters): counts by core per seven-day window for four weeks, mine and the
  owner's apart, what changed (the last two weeks against the two before), how many were
  recorded looking back (per core), and the ids it rests on — handed like the rest, so the entry and
  the page can cite them. Counted from stored feelings (written at the time or recorded
  later), never text; not a dream's feeling-now, nor one on what a dream or a reflection
  wrote; null on a month with none. And **unmarked** — at most `UNMARKED` (5) memories
  nobody has marked that the work lane counts as a project's work only for want of a
  mark (`self/work.ts#isWorkMemory`: a fact, entity or place written in a directory, or a
  skill — since 2026-10-11; not a journal copy), those with a feeling, an entity or the
  owner's name first, then the most used, then the oldest, rotated so the last three
  nights' offers wait behind the rest — offered to be marked by meaning. They keep a room
  of their own (2026-10-11): on a night the plain fit leaves one waiting or a bare id, what
  they cost as lines is held back from the shared room (never past the room there is), so
  a full night shows each at least as a line; any other night is fitted as before. A writer's mark is never
  offered. A reflection's own later feelings are counted but never make a change. Three questions, rotated so consecutive nights share none (the dream question only
  after a dream). **In parts, not cut** (2026-09-28): a bundle longer than
  `RESULT_CHARS` (the tool result's ceiling is about 25k tokens) comes as part 1 of N —
  everything but the long lists, which go on in order as far as the room allows — and
  the result says so; phase `part` hands the rest, `PART_CHARS` at a time, each memory
  as it reads now (one gone since is said to be gone). The parts' ids are kept on the
  row. **Fitted** (2026-09-28, build B; `fit/`): the WHOLE core, every core candidate and
  every memory of the last few days are handed (they were the 20, 12 and 12 most felt),
  plus a page of the most strongly felt with its full count (`feltOf`); the fitter gives
  the most felt their whole text (up to `DETAIL_CHARS`), a line to the rest, an id alone
  past that, each with its whole length (`chars`). The chapters come as entries of the
  last few days, a line each, the most important whole. How the room was spent is on the
  row (`detail.fit`) and in the bundle (`shownAs`).
- `finish` takes an entry, what it cites, and optionally a page, a share, feelings,
  about marks and trait nudges, each on its own. Everything it names must be something it was shown and
  still standing.
  - **It may be called again** the same calendar day on the same reflection (2026-09-28):
    a second call supplies the parts the first refused or left out without re-minting
    the entry, and may replace the share while it has not been told or carried. The
    limits count across both. Every part not written names its rule and what tripped
    it, and the result says it can be sent again (`retry`).
  - **An insight cites real memories.** An entry that cites something becomes a memory,
    source `reflection`, titled "Reflected: …". **A night that cites nothing is "nothing
    much"** — a normal outcome: the entry stays on the record, and nothing else is
    written or shared.
  - **The page** is rewritten whole through `Self#revisePage` — BY `reflection`
    (2026-09-28: it wrote as `writer` until then; the writer and the reflection are two
    jobs and the version history tells them apart), with a reason naming the
    reflection and its dream — from what it
    cites — meant to rest on at least one core memory when there is a core (a page that
    cites none is written with a note, since 2026-09-28) — never from a dreamed gist
    or a confidential memory, and never carrying the words of a confidential memory it
    was shown (review of #256); the old page is context. (The check on a recent gist's
    words was removed 2026-09-28 — NOTES.) With
    the host's `pageWriter.mode: off` the page is not written at all (owner ruling D3); the
    entry and the share still are. It records no page-writer run (that row made the
    retired session-start writer stand down; the writer runs in the same nightly run
    now, first, and keeps its own row). **Held to the page's room** (2026-10-20, Mike's
    go, lightly held, an experiment; self CONTRACT §16, `PAGE_HELD_TO_ROOM`): told the room
    in bytes, the page's bytes now, and that the page stays thin, a reflection whose page
    is past the room (its first such send of the night, whatever the writer did) gets it back
    `past-room` with how far over and "cut, don't add a short version", inside the
    finish's own retry — the entry and every other part stand — and a second finish with
    the page is written, cut or not. A held page it never sends again is kept when the
    nightly process's child returns (`Self#keepHeldPage`), or with no run end (launched
    from a session) at the worker's next boundary once it has settled.
  - **The share** — two or three sentences, citing what it rests on — is offered in the
    hand-back; `told` records `told` on the memories it cites; a later session carries
    an untold one once. A memory promoted on reflection alone is named in the next share.
  - **Feelings** are the self's, recorded later (`source: reflection`, `recorded_later`
    = today), and may be stronger than anything felt at the time (at most 5) — on a
    lived memory only: not on a dream's gist or a reflection's own entry (review of #256).
    The same path (`Reflections#laterFeeling`) records an awake session's (below).
  - **Awake, too** (2026-10-02, lane B): `feelAgain` — `note`'s `feelingsNow` — records
    a later feeling from an ordinary session, through the reflection's path and its
    guarantees, plus three: only a memory the session was shown (the door hands the set
    in: what recall surfaced or returned, a write's neighbours; one not shown is refused
    with the way in), at most one awake feeling-now a calendar day per memory
    (`once-a-day`), and labeled — `source: awake`, `recorded_later` = today, carried_by
    "looking back, awake, <date>: …". Mine by default, the owner's when they said so. At
    most `AWAKE_FEELINGS` (5) a call. The core's fast lane reads it only through the
    reflected-feeling door, as a reflection's (`store/feelings.ts#LATER_FEELING_SOURCES`);
    a memory it carries to the core is not named by a share as the reflection's
    (`PromotionRecord.feelingRecordedLaterBy`, review of #317).
  - **About marks** (at most 8): `me`, `us`, `owner`, `work`, `world`, each with a why
    (one not given is recorded as "no why given"); a core mark on a dream's gist or a
    reflection's own entry is refused (`work`/`world` stay open on those); one on a
    `skill` is written with a note — a skill never becomes core. With the door open it may re-label either way
    (owner ruling D2 on #256: "it's me reflecting; it may catch labeling bugs"): every
    re-label is recorded in `core_events` with what it was and the reflection's why,
    doctor counts them (and apart, the moves into me/us/owner), and a move into me, us or
    the owner is said in that morning's share. With the door closed only moves toward
    `work`/`world` are allowed (D1).
  - **Trait nudges** (folded into v9, 2026-09-27; at most 5): where a memory it was shown
    really shows how I acted, on one of the seven axes (`store/traits.ts`), source
    `reflection` — "where did you act unlike your self page?" is their natural question.
    On a lived memory only, like its feelings; an unknown axis or pole is refused by name.
    **It is shown no balance or totals** — no trait appears in what `begin` hands it
    (only the limit): the arithmetic stays on the dashboard. Nudges feed nothing.
  - Every memory it cites comes back: a reflection return (physics §5.11).
  - **Stale open threads, proposed closed** (2026-10-16, #489 D; a lightly held default):
    `begin` hands at most `STALE_OPEN` (5) memories still flagged `unresolved` and
    untouched for `STALE_OPEN_DAYS` (4) lived days (`staleOpen`, rotated like the
    unmarked offer). `finish`'s `close` may name the ones that look done; the share asks
    the owner, and the reflect tool's phase `close` clears the flag on the owner's yes.
    Since 2026-10-20 (an experiment, decided with Mike): `finish`'s `closeNow` closes the
    ones a memory plainly shows finished, each with a why (and ideally the memory that
    shows it), kept on the memory (`threadClosedBy`) and the row (`detail.selfClosed`);
    the share names them and says how to undo, and the reflect tool's phase `reopen` puts
    one back on the owner's no, from the thread's id alone (the reflection is the one
    `threadClosedBy` names), in any session. Asked and closed together keep to `STALE_OPEN` a night.
    **[M]** a proposal or a self-close is only an id from that list; a self-close needs a
    why, keeps `closeThread`'s checks, and lands only with the share that says it (none
    once the share was told or carried); `close` closes only ids the reflection proposed,
    and `reopen` reopens only ids it closed itself, both with `closeThread`'s checks; a
    thread the owner reopened is never closed by a reflection again, only asked about,
    and a confidential one is never self-closed, only asked about. A self-close and its
    `reopen` reach a stale thread from any folder (Mike, 2026-10-20, a lightly held
    exception to the night run's 10-02 stance); night write-ups and `close` keep the
    folder check.
- Guarantees: **[M]** at most one reflection a calendar day; **[M]** it can cite, feel or
  mark only what it was shown; **[M]** nothing under observer; **[M]** a reflection is
  not undone with its dream (it was lived); **[M]** what a dream or a reflection wrote
  earns no return by being cited; **[M]** its hand-back carries the mark, so
  the share is told in the session's own words, not captured from the tool's; **[M]**
  the owner's removal redacts a reflection that was shown, cited or quotes the memory.
- **A gist takes the writer's three fields** (v12, 2026-10-03): `occurredOn`, `saidBy`,
  `status`, read loose-first — **[M]** one that cannot be read is left off with a note and
  the gist is written; nothing is defaulted. A merge takes none; the store carries each
  original's to the merged memory (`store/` guarantee 26; since 2026-10-11 by
  `Store#carryInto`, the originals staying live).

## 6. Scars honored

**§2.4** (every refusal named; a dream that changed nothing says so) · **§2.6** (every
tool claim mechanized) · **§2.16** (the tool carries an admission test and negative
examples) · **§2.19** (every change enumerable: `counterparts dream --show`) · **G11**
(this system's own words never enter capture).

## 7. Open questions

1. The run starts on its own now (`auto`, 2026-09-28). Watch for runs cut off by short
   sessions (`dream --list` shows `begun` rows; doctor names one begun and not
   journaled) and for writer and reflection overwriting each other's page — the owner
   compares page versions after a few days, and may decide the reflection stops writing
   the page.
2. Should a gist that proves true awake be promoted out of `dreamed` provenance?
   Related, D6 (owner ruling on #256): **CLOSED by Mike, 2026-10-11, lightly held** — a
   gist keeps a personal mark (me, us, owner) chosen by `inheritFrom`'s "personal wins"
   rule over its sources, and reaches the core only the ordinary way, by awake recurrence
   (a dream cannot replay it, a reflection cannot feel it or mark it about me, its claim
   is capped). No special rule: `sleep/consolidate.ts#aboutMe` refuses nothing by
   `source`. The provenance question above stays open. Measured at the review of
   #403, under today's tunables: no lane is met by a gist even awake. Thirty days of
   awake returns leave it at strength ~0.29, under the slow lane's 0.5 floor (its claim
   stays at the cap, the repetition arm is 0 for `self`/`person` and stays under 0.5
   for the rest, consolidation is for legacy rows only), and the fast lane needs a
   feeling, which every door refuses on a gist. So today the mark changes the wake
   lane a gist sits in (work or Nearby), not its way to the core. The question above
   is the only road there. **Since 2026-10-11 (Group 3 parts A and B) a FOLD has the
   ordinary road**: the slow floor became "within reach", a fold starts at its parts'
   strength (≤ 0.6), and its parts are in its slot. Its recurrence is what came back
   AFTER it was folded (decided by random-06, 2026-10-11, lightly held): its own uses and
   its parts' later uses count, the parts' births and earlier uses do not; no minimum
   count of its own uses beyond the slow lane's anchor. And it is `me`/`us` only when
   most of its parts are (`store/marks.ts#foldMarkFrom`), so a work fold with one `us`
   part is not a core candidate. The builder's first measure (10-11) had a personal fold
   meet the slow lane after ONE awake use, on its parts' births; that lever is closed.
   An insight gist still has no road (its claim stays at the cap).
3. Should dream links be stored differently from Hebbian links (a marker, a hop
   weight)? A session designing association with the owner may decide; today they are
   ordinary edges at `LINK_WEIGHT`. Since 2026-09-28 (association build 1) that is 0.1,
   about one co-activation, written through `Associate.propose`: live endpoints, the
   pinned freeze, raised from the decayed weight, and ONLY WHERE THERE IS ROOM — a
   proposal never evicts or scales down what waking use learned. A `link` with no room
   is refused `no-room`; a gist keeps its first-named ties that fit and records which
   landed. The dream row always counts `gistLinks`, `linkNoRoom`, `linkFrozen`,
   `linkFailed` (associate NOTES §13).

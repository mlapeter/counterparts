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
3. **Nothing is lost to a dream.** A merge archives its originals with a forwarding
   address and keeps their words as a version; the whole dream can be undone.

## 3. Keeps

- **Sleep changes memory offline** [v0: auto-consolidation on a cycle; the field guide's
  consolidation]. `sleep/` stays arithmetic-only; this is the part that needs a model,
  and so it is a separate, asked-for act.
- **Recall's gates** [v2 recall §9.1]: a dream is shown only what could surface in the
  session that launched it — no archived, superseded, protected or schema row; nothing
  confidential outside the owner's own session.
- **Versions, never deletion** [constitution 7; store §16]: merges supersede; undo
  restores.
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
  Doctor's Nightly run line reads it; the dashboard can later.
- **The hand-back of a headless run** — the dream's own line (`handBackOf`) and the
  morning share — has no agent to return to a session, so once the run has ended the
  next prompt anywhere, the launching session included, carries both, once ever (a
  latched `dream.night.handed` event, then `handedAt` on the row so later prompts only
  read; the share through `Reflections.carryLine`). A partial run's line says it was
  partial; a reflection-alone run hands back its share only.
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
- **The ask, previewed** (2026-09-27, `previewAsk`, for the dashboard's Tonight box):
  `{ wouldAsk, reason, newSince }` from the same gate `status` and `askLine` run — the
  same dreamed / declined / asked-today checks, the same showable filter, the same
  queue (2026-09-28: no longer capped at `MAX_NEW`) — asked as a live session would ask it, so it answers under observer
  too. `newSince` is counted for every reason (the gate itself stops before counting
  once it knows). A live session previews its own gate; an observer previews a guest's
  (confidential memories not counted) unless it passes `owner: true`. Only a count comes
  back.

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
  lightly — `fit/` CONTRACT states the principle). "New" is every showable memory born
  within `QUEUE_DAYS` lived days that no dream that stands was shown (read from the
  dreams' own `shown`; a dream being resumed, or one the next `begin` will resume or
  close, is passed over). The gate's `MIN_NEW` counts this queue. `begin` ranks it by
  replay priority (salience, how strongly felt, coming up or on my mind, salient-but-weak,
  less a little for age) and takes tonight's new memories in that order while their lines,
  and their neighbours', fit `FRESH_SHARE` of `NIGHT_CHARS`; the rest WAIT for the next
  night, counted in the bundle (`queue`), the tool's `how` and the hand-back. Past the
  window a never-dreamed memory leaves the queue for ordinary fading, and how many did since
  the last dream is said (`agedOut`). Every memory shown has a line at least and says why
  it is here, what it is about, its strongest feeling and its whole length; the most
  important come whole (up to `DETAIL_CHARS`, else an excerpt with its length). The
  journal comes as ENTRIES, cut at the chapter headings: only the entries added since the
  last dream (how far it read each episode is kept in its index), a line each, the most
  important whole. A bundle longer than one tool result — measured as the MCP server sends
  it — comes in parts (phase `part`). A merge or a gist records the fidelity it was made
  from (`detail.fidelity`: whole, excerpt, line — or whole, looked up since).
- `propose` applies each change on its own, within per-dream `LIMITS`, and records it
  with what undo needs (ids and numbers only):
  `merge` (two or more near-copies, not core, into one memory in better words, under
  the strongest original's kind when the kinds differ; the
  merged memory stands where the strongest original stood, carries their returns,
  feelings and trait nudges — each nudge keeping its source, model and moment, each
  feeling its source, its recorded-later date and (since 2026-10-02) its moment — and
  inherits their links), `link` (both ways, proposed at `LINK_WEIGHT` through
  `associate`, only where there is room, since 2026-09-28), `replayed` (a
  return at `DREAM_RETURN_WEIGHT`, never a use), `gist` (source `dreamed`, citing and
  linked to its sources, salience capped at `DREAMED_CLAIM_CEILING`), `contradiction`
  (an unsettled pair in `contradictions`; a pair already standing is left as it is),
  `settle` (2026-09-29: two memories it was shown, `holds` / `over` / `how` / `why`,
  through `contradictions.ts#settle`; undone with the dream unless settled since),
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
4. **[M]** Undo reverses the whole batch and is idempotent: originals restored (their
   versions kept), the merged memory and gists archived `dream-undone`, links back to
   their prior weights, the dream's feelings, replays and nominations removed. A merge
   whose merged memory has moved on since (revised into a successor, merged again,
   archived or removed) is left as it is and counted (`kept`), so an undo never stands
   originals beside a live successor (review of #251).
7. **[M]** What a dream makes keeps the rules of what it was made from: a merge or gist drawn
   from a confidential memory is confidential; a dated reminder and a memory the owner
   demoted from the core are not merged; a dream's merges are not "new" for the next
   ask; a dream left open is closed to changes once a newer one begins (review of #251).
5. **[M]** Under observer stance nothing is written and every phase says so. The ask's
   preview (`previewAsk`) answers under observer where `status` stands down, and claims
   no ask, records no event and writes nothing, in either stance (`test/dream-preview.test.ts`: byte-identical store,
   and it agrees with `status` and `askLine` case by case).
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
  recorded looking back, and the ids it rests on — handed like the rest, so the entry and
  the page can cite them. Counted from stored feelings (written at the time or recorded
  later), never text; not a dream's feeling-now, nor one on what a dream or a reflection
  wrote; null on a month with none. And **unmarked** — at most `UNMARKED` (5) memories
  nobody has marked that the work lane counts as a project's work only for want of a
  mark (`self/work.ts#isWorkMemory`: a fact, entity or place written in a directory; not
  a skill, not a journal copy), those with a feeling, an entity or the owner's name
  first, then the most used, then the oldest — offered to be marked by meaning. A
  writer's mark is never offered. Three questions, rotated so consecutive nights share none (the dream question only
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
    now, first, and keeps its own row).
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
    reflected-feeling door, as a reflection's (`store/feelings.ts#LATER_FEELING_SOURCES`).
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
- Guarantees: **[M]** at most one reflection a calendar day; **[M]** it can cite, feel or
  mark only what it was shown; **[M]** nothing under observer; **[M]** a reflection is
  not undone with its dream (it was lived); **[M]** what a dream or a reflection wrote
  earns no return by being cited; **[M]** its hand-back carries the mark, so
  the share is told in the session's own words, not captured from the tool's; **[M]**
  the owner's removal redacts a reflection that was shown, cited or quotes the memory.

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
   Related (owner ruling D6 on #256, left open): should `sleep/consolidate.ts#aboutMe`
   also refuse a `dreamed` row outright, as defence in depth? Today no road reaches the
   core from a gist (capped salience; a reflection cannot feel it or mark it about me),
   but the v9 upgrade marked a `self`-kind gist `me` when it carried the old rule.
3. Should dream links be stored differently from Hebbian links (a marker, a hop
   weight)? A session designing association with the owner may decide; today they are
   ordinary edges at `LINK_WEIGHT`. Since 2026-09-28 (association build 1) that is 0.1,
   about one co-activation, written through `Associate.propose`: live endpoints, the
   pinned freeze, raised from the decayed weight, and ONLY WHERE THERE IS ROOM — a
   proposal never evicts or scales down what waking use learned. A `link` with no room
   is refused `no-room`; a gist keeps its first-named ties that fit and records which
   landed. The dream row always counts `gistLinks`, `linkNoRoom`, `linkFrozen`,
   `linkFailed` (associate NOTES §13).

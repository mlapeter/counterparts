# `handoff/` — implementation notes

Choices the CONTRACT does not make, recorded here rather than left to be re-discovered from
the code. None is a guarantee; each is the smallest rule that could work, and each names
what would have to fail before machinery is added. True for now (2026-09-20), not law.

## 1. Why the pointer is spliced at DELIVERY and not composed into the bundle

The wake bundle is composed once per boundary and published under one meta key. `Self.wake()`
reads that one bundle back with zero compute, and every session in every directory reads the
same bytes. So "which directory am I in" is not knowable when the body is composed — it is a
delivery-time fact, exactly like today's date and the store's current size, which is why the
delivery preface exists at all (`self/briefing.ts#prefaceLine`).

The splice therefore reuses the preface's own mechanism, pointed at the other end of the
bundle: `spliceBeforeSentinel` inserts above the tail sentinel and re-solves the byte fixed
point so both comment lines state the delivered total. A damaged bundle is returned
untouched, for `applyPreface`'s reason — rewriting the byte count of a damaged bundle erases
the damage the sentinel exists to show.

Joined at `counterpart.ts` and not inside `self/`: `self/` knows nothing about directories
and gains nothing by learning. The composition root is the one place that holds the
published bundle, the host's ceiling and the scope at once.

## 2. Why the reserve is CONDITIONAL, sized to the real block, and off below a share

`wakeReserveBytes()` adds `reserveBytes(...)` to the preface's reserve only while some
directory in this store holds a live, unexpired handoff.

- **Unconditional** would make every wake in every store 448 bytes smaller than master's
  forever, including on the blank store the owner is about to start on. The claim "with no
  handoff written the wake is byte-identical" would be false, and the first thing anyone
  would notice is a store that trims one more element than it used to for no visible reason.
- **No reserve at all** fails the other way, and worse, because it fails silently and late.
  The boundary trims the composition to exactly `budget - PREFACE_RESERVE`, so on any store
  with enough elements the bundle fills the ceiling and a pointer spliced afterwards would be
  dropped at every wake. It would work on a new store for two weeks and then stop, and the
  only symptom would be `handoff.shown` going quiet — which is exactly the shape of failure
  the fired view exists to catch and exactly the shape nobody looks for.

The scan `liveBlockBytes()` runs is ONE walk of the schema rows of the place kind — a
handful — and it is wrapped: a store that will not answer reserves nothing, which composes
the wake master composes. It builds each `Handoff` from the row it already holds rather
than asking `readHandoff` per directory, which would walk the store once per directory at
every boundary for a number that is the same shape as the one in hand.

**Two more things, both learned from the adversarial review of 2026-09-20 (MAJOR-1).**

- **A flat reserve over-reserved, and other directories paid for it.** 448 was the widest
  block this module can produce; a real pointer is 250–300 bytes, and the reserve is
  store-wide while the pointer is per-directory. Measured at a 1,200-byte ceiling, a session
  in a directory with NO handoff lost 4 of its 6 identity elements; in the directory that
  DID get the pointer, five memories bought two lines and 295 bytes of unused headroom. So
  `reserveBytes` now takes the widest block that actually exists — one per directory, newest
  row per scope — plus a margin, capped at that same 448.
- **Below a share of the budget the reserve is not taken at all.** A pointer is a fortnight
  of working context; it is not worth a third of a small wake's memories. The rule is one
  comparison (`want * 8 <= budget`), which turns the reserve on from about 2,400 bytes up
  (about 3,000 since 2026-09-30, when the reserve was sized to the widest "how current"
  words the delivery adds; about 3,650 since the pointer says who left it and how to
  retire it)
  and leaves every smaller ceiling composing exactly what it composed before. At that size
  the pointer is simply not carried, and `handoff.refused{reason:"no-room"}` says so rather
  than leaving it to be noticed.

**Named cost: the reserve lags one boundary.** The first handoff a directory ever gets is
written at a boundary whose composition was already published, so the very next wake in that
directory may be the one case where the pointer does not fit. It is delivered without the
pointer, the `no-room` row is written (deduped per row per lived day — it was ring-only, and
every hook is its own process, so the lag left no trace at all), and the boundary after that
has the room. Every wake fact behaves this way; it is not worth a second publish to fix.

## 3. Why `type: "schema"`, `kind: "place"`, `meta.role = "handoff"`

`ProseType` is a closed union of three in `store/prose.ts`, and `store/` is not this module's
to edit. `Kind` is a closed union of six enumerated exhaustively in the MCP tool schemas, the
census, the claim counters and the CLI — adding to it would make "handoff" a kind a model can
propose a memory as, which is the opposite of the point.

So the row goes on the shelf the self page uses, one role along. `kind: "place"` is the
honest subject (a handoff is about a directory, a place of work) and it also keeps the recall
scan's exemption cheap: the prose read is gated on `type === "schema" && kind === "place"`,
so only schema rows about places pay for it.

**What that placement buys free**, all of it by mechanisms that already existed: dedup skips
schema rows by name; `scanActive` lists `{ type: "memory" }` so no lane can reach it; and
`schemas/#toMetaRecord` returns null for any role but entity, belief and current-state, so
the index build skips it rather than mis-filing it.

## 4. Why NOT `protected`, and the dwell clock that follows from it

The self page is `protected` at birth because it is standing ink. The handoff is the one
standing row in the store that is *meant* to be let go, so it is not — `protected` is exactly
what would stop `physics#pruneVerdict` ever archiving it.

That makes one thing load-bearing: `store.revise` writes prose and a version row and touches
no physics column. A row born on day 1 and rewritten on day 200 would still read
`lastUsedDay = 1` — dwell 199, strength under the floor, band episodic — and the prune would
archive a pointer written that morning. So every write does
`updatePhysics(id, { lastUsedDay: day })`. That is the whole of the interaction, and it is
tested by name.

**And it really can be let go, which was worth checking rather than assuming.**
`pruneVerdict`'s fifth blocker is `inLiveRevisionChain`, and a row that is revised on every
handoff accumulates version rows forever. That clause reads `superseded_by` on the ROW and
`successor_id` on the version rows — and `store.revise` writes version rows with
`successor_id = NULL` (only `store.supersede` sets one). So versions on one row do not block
the prune; supersession between two rows does, and nothing here supersedes. The row's own
`pressureAt` is zero for the same reason nothing else about it moves: no challenge ever
lands on it.

The numbers it leans on: `D_FLOOR_DAYS = 90` and `PHI_PRUNE = 0.02`. A pointer expires from
view at 14 lived days and the row survives roughly 90 more before the prune can take it. The
gap is deliberate — the row is the only copy, and an owner reading the dashboard three weeks
later should still find what was handed over.

## 5. Why expansion by id is allowed, and credit is not

The brief asks for the pointer to be expandable through the door that already exists, which
is `recall({ handle: <id> })` → `deliberate.ts#expandHandle`. The self page is refused there;
the handoff is not, because the pointer's whole shape is "here is a line of it, and here is
its id".

That opens the one path by which working context could reinforce itself:
`expandHandle` → `recordHandleResolution` → `creditAtBoundary` → `creditReferences` →
`resolveUse`, which advances `uses` and `reinforced_days`, which is the input
`promotionEligibility` reads. So the refusal sits in `creditReferences`' own filter, beside
`unknown-id` and `archived`, and is counted as `handoff` rather than swallowed.

**Named cost:** `expandHandle` has no scope filter, so a session that somehow holds another
directory's handoff id can read that body. The id only ever appears in that directory's own
wake, so this is a hazard for a session that was told an id, not one that can find one. Filed
in INTERFACE-GAPS §2.

## 5b. What a PRESENT but blank field means, and why archiving is the retirement

`handoff: ""` used to be total silence: `writeHandoffField` returned null, nothing was
written, and the stale pointer stood. It is the shape a model reaches for when it means
"the work here is finished" — which is the one thing CONTRACT open question 3 said it must
not be unable to say — so it is now a CLEAR.

**Archived, not revised to a cleared body.** The self page's precedent points the other way
(`self/page.ts`, "ONE ROW FOR THE LIFE OF THE PAGE") and it is the right precedent for the
page and the wrong one here, for one reason: the page must be restorable by an owner who
cleared it by mistake, so its history has to stay reachable through a live row. A handoff
has no restore door and wants none — it is working context whose whole design is to be let
go. Archiving gets every property for free: `handoffRows` filters `archived: false`, so the
pointer leaves the wake, leaves the reserve and leaves `anyLive` in one move; the words stay
on the row for an owner who asks for it by id; and the next handoff for that directory mints
a fresh row rather than reviving a retired one.

**A clear on a directory with no pointer is `nothing-to-clear`, with its own durable row.**
A session that finished work in a directory that never had a handoff said something true,
and the honest answer is a named fact rather than a silent success.

Since 2026-09-30 all of this is per SESSION (§8): a blank field archives the caller's own
row and leaves every other session's standing, and "no pointer" means "none of mine".

## 5c. No refusal channel on either fired row, and why

`Mechanism.refusals` (E2) exists because reading a namespace wholesale made a healthy store
report `BLOCKED prune … dwell-too-short ×240` for ever. `RefusalSource.only` is the
allow-list that fixes it, and the test it sets is whether a NAMED RULE turned away a
candidate that otherwise QUALIFIED — the owner saying no — rather than arithmetic saying
not yet.

By that test this module has almost nothing to declare. `no-scope` is "there is no
directory to file one against"; `not-text` and `too-large` are a malformed or oversized
input; `nothing-to-clear` is "there was no pointer here"; `empty` is nothing written.
None of them is a rule refusing something that qualified — they are all *not applicable*
or *not yet*. `gate-refused` and `store-refused` ARE real gates, and they are also the
rarest rows in the set: a handoff carrying a credential or a body the floor rejects is an
event worth a line, and the line it gets is the refusal row itself in the fired view's
evidence, not a permanent `blocked` state on the mechanism.

The one that argues for itself is `no-room` — a host's ceiling turning away a pointer that
qualified. It is left out for the reason S2 left its own `no-room` out (`self/NOTES` §19):
one fact, two surfaces, and the permanent one is the wrong one. A store whose ceiling is
below the share rule would read `blocked` for ever, which is the shape E2's own review was
about; what that store wants said is "your ceiling is small", and that belongs beside the
ceiling, not beside the mechanism.

So: **no `refusals` declared on either row.** The refusals are still durable, still read by
`fired` as evidence, and still in the dashboard's log — they simply do not grade the
mechanism as blocked.

## 6. Why the field is processed BEFORE `session_end` checks `memories`

`session_end` requires a non-empty `memories` array. A session that learned nothing worth
keeping but is leaving a directory half-finished would otherwise have its handoff thrown away
with the refusal. So the handoff is written right after the session bind, and its outcome
rides out on the refusal as well as on the success. The `memories` contract is unchanged.

## 6b. Why `flatten` strips control and format characters

`\s+` is `\n \r \t` and friends. It is not NUL, not ESC and not U+202E. Measured
(adversarial review MINOR-4), a right-to-left override in a handoff reversed the display of
everything after it in the delivered wake for any reader that honours bidi, and an ANSI
escape landed in a prompt that is sometimes rendered in a terminal. Line injection was
already blocked — the CR case folds here and only one line is ever excerpted — so this
closes the rest of the class in the same function, where there is one thing to check.

Order matters and is the only subtle part: a control that IS whitespace becomes a space
first (or `"a\nb"` would join into `"ab"`), everything else in `\p{Cc}` and `\p{Cf}` is
dropped, and then the ordinary collapse runs so a dropped character cannot leave a double
space.

## 7. Why the excerpt reserves three bytes for its ellipsis

`…` is U+2026 and is three bytes in UTF-8. The first draft reserved one character's worth and
a 160-byte cap rendered 161. Measured, not reasoned about — and the same class of mistake as
every other byte cap in this tree that counts characters somewhere and bytes somewhere else.

## 8. Why one handoff per session, and what the wake does with several (2026-09-30)

Several sessions often work in one repo at once. With one row per directory, the last to
end overwrote the others: on 2026-09-30 a pointer saying two builds were in flight was
replaced by a session that knew nothing of either. The owner's ask was a "from" field and
room for more than one. What was built, and the choices the brief left open:

- **The key is (directory, session), read from meta that was already there.** Every row
  written since 2026-09-20 carries `meta.session`, so no migration and no schema change:
  a row from before keys to the session that last wrote it, that session's next write
  revises it, and anyone else's mints a fresh row beside it. Only a row with a null
  session (a direct caller that named none) reads "an earlier session". Two new meta
  fields ride on new writes: `model` (host state, via the MCP server's session record, as a
  chapter's model does) and `writtenAt` (this module's clock).
- **Newest first by lived day, then `writtenAt`, then id.** The lived day alone ties all
  day; a row from before `writtenAt` existed ranks as the older of two on one day.
- **Who, in the words the host gives.** The first eight characters of the session id —
  "this session" for the waking session's own — and the model as a person says it
  (`claude-opus-5-5` → `Opus 5.5`, anything unfamiliar printed as it came). A name the
  person gave the session is not in the hook input or the registry; deferred (CONTRACT §8
  question 6). A single handoff with no session reads exactly as it did before.
- **The several-handoff block is a count line, up to three one-line entries, the rest by
  id, one door.** One line each (who, when, the first sentence, the id) rather than three
  copies of the two-line block, which would cost a third more for the same words. Only the
  newest says whether work ran here since: for the older ones the newer handoffs are that
  work. Numbered `1)`, never `- `, because the pointer is furniture.
- **A LADDER, not one block.** The reserve lags a boundary (§2); a directory's first
  second author appears at a boundary whose reserve was sized for one pointer, and without
  the ladder that wake would drop the pointer whole. So the delivery tries three shown,
  two, one, then the newest's own two-line block, and carries the first that fits;
  `no-room` is written only when the last rung does not. The last rung says nothing of the
  others — a shorter pointer that fits beats a fuller one dropped whole, for one boundary.
- **`reserveBytes` takes the widest candidate that passes the share rule**, where it took
  the widest and then asked. With one block per directory that is the same answer except
  in one case: a narrow block in one directory is now reserved for when a wider one
  elsewhere fails the share, where before the wider one turned the reserve off for both.
  The ceiling constant grew from 448 to 1,408 because the widest block grew (1,389 measured
  once the door named `retireHandoff`; 1,448 since §9's "written up to" words, measured
  1,431; 1,646 since §10's "may be out of date" words); the share rule is what binds in
  practice (at 9,000,
  nothing past 1,125). Measured with sixty identity elements, one handoff against three:
  a reserve of 487 against 735 bytes at 6,000 (the share rule binds), 487 against 855 at
  7,000 and 9,000; all three carried, every wake keeping its 24 elements — a fixture whose
  wake composes to about 2,860 bytes, so the lane caps bind first there.
- **`handoff.shown` is one row per handoff shown in full**, deduped per row per lived day
  as before, and the block's bytes are split so the rows sum to the cost — each entry its
  own line, the newest the rest (count line and door). `among` says how many were live, so
  the fired view can see whether handoffs pile up.
- **Retire by id** was small enough to build: `retireHandoff` on `session_end`, any
  handoff filed under the caller's directory and not yet retired, `not-here` for anything
  else (and `not-here` is not a failure the result flags, as `nothing-to-clear` is not). It
  exists because per-session rows accumulate — a session that finishes another's work
  could otherwise only leave the stale pointer standing for its fortnight. It rides the
  same field rules as `handoff`: before the memories check, counts as landing something,
  and refused beside `writeUp`. Review of #295 (MAJOR-1) added the two nudges that make it
  findable: both door lines say `retireHandoff: [id]`, and a successful write returns the
  other sessions' live handoffs here (`others`: id, session, date, first sentence).
- **Follow-up, not built: a shorter life for an older handoff** once a newer one stands in
  the same directory. It is the next answer if `among` still runs high with the nudges in
  place; left until the row says it is needed.
- **A blank session id is no session** — keyed, cleared and retired as null, the rule
  `Lifecycle#composeWake` applies to what it is handed.
- **A Claude Desktop call that names no session leaves and retires no handoff** (review of
  #295, MINOR-4, asked for by the hosts session). Desktop's server is shared by every chat,
  and a call with no `session` binds to the most recent live Desktop session, which may
  be another chat's; a handoff is keyed by its session, so chat A's `handoff` would have
  revised chat B's and its blank field would have cleared it. `session_end` refuses both
  fields `session-unnamed` there (durably, with "name your session" words) and lets the
  rest of the call through; nothing else about the fallback changes.
- **`dream/mind.ts` still reads one open loop per directory** (`newestPerScope`, now the
  newest across sessions). Showing every session's there is a question for the mind's own
  budget, not this change.

## 9. "Last here", and how far the work since is written up (2026-09-30, the continuity test)

Mike ended a ~/random session that had finished its work (notes, a chapter at 17:50,
session_end memories, no handoff, as the Stop ask says), opened a new one two minutes later
and asked what it remembered of the last session. Nothing pointed at the evening: the
directory's pointer moves only for a handoff, and the one standing (another session's, from
15:19) said "work here 16:01–17:53 since, not yet written up" with a chapter right there.
The brief: `~/counterparts-notes/2026-09-30-continuity-brief.md`. What was built, and the
choices it left open:

- **Derived, not a row type.** Which directory a chapter is in, in order: the episode's
  `origin_scope`, set at birth from 2026-09-30 (`self/episodes.ts`); with none, the
  chapter claims in that directory's coverage file (`coverage/#chapterClaims`, the
  `chapter:<epi>#n` claims since #289); failing both, the directories its session's
  turn-ends are filed in (`coverage/#sessionsHere`, `boundaries.jsonl`, which retention
  never strikes). The first round used the turn-end join alone; review of #300 (MINOR-1)
  put it last, because a session's turn-ends are filed under where it was launched, which
  is not always where its chapter tool was pointed. Chapters already on a store still
  show the day this ships, by claim or turn-ends.
- **The session's time is its `stop` turn-ends and pieces here**, first to last,
  stretched to the chapter's own writes. Never a `session-end` boundary, whose time is
  when the host closed the session, hours later sometimes (MINOR-2). Not the registry's
  start: core does not read the registry, and the first Stop is within a turn of it.
- **Not the reader's own** (MINOR-3): a session waking again after compaction is not told
  it was last here.
- **Several sessions here that day**: the newest with its first sentence, the one before by
  title ("Before it: …"), the rest of that DAY by id ("+N more here on 09-30: …"). The day
  rather than the fortnight, because ~/counterparts sees a dozen chaptered sessions a day,
  and "+48 more" is noise. Older ones are still the newest when nothing newer exists.
- **Its fortnight is the handoff's** (`LAST_HERE_LIFE_DAYS = HANDOFF_LIFE_DAYS`), read
  off the latest chapter heading's lived day. The walk is bounded in SQL, not by the
  fortnight after the fact (the first round claimed so wrongly; MINOR-5): episodes born
  inside the window (`MemoryFilter.bornFromDay`), then only those sessions' turn-ends kept
  while the coverage files are read (`sessionsHere`'s `only`). A session whose episode was
  born before the window and chaptered inside it is missed; sessions that long are rare.
- **Who gives way.** The line rides the handoff reserve (§2, CONTRACT §6): each of its
  three rungs per directory is a candidate alone and beside each handoff rung, and the
  share rule takes the widest that passes. At delivery the HANDOFF IS CARRIED FIRST: the
  widest handoff rung that fits alone, then the line tried above it, widest first. The
  first round tried every handoff rung with the line before any handoff alone, which at
  some ceilings carried the newest handoff alone plus the line where three handoffs fit
  (review of #300, MAJOR-1). Unfinished work beats orientation.
- **What the reserve costs now** (MINOR-6). The reserve is store-wide, and a store in use
  always holds a chapter inside the fortnight, so it is always taken: the widest
  directory's line plus its handoff rungs, plus the margin, up to an eighth of the ceiling.
  On a store whose lanes fill the ceiling, that is lane elements given up in every
  directory, whether or not a session there is ever shown a line — the review estimated
  roughly one to three identity elements at 9,000. Where the lane caps bind first (the
  measured fixtures above, and the owner's store as of 2026-09-30) it costs nothing. And
  CONTRACT §5 G6's byte-identical property, true of a store with no chapter, no longer
  holds on a real one.
- **A chapter puts the wake behind** (MAJOR-2). A bundle composed before a store's first
  chapter in the window reserved nothing for the line, and on a full store the line then
  never fit until the next lived day's render. `appendEpisode` marks `write-up`, so the
  turn-end worker's `refreshWake` re-renders with the room reserved.
- **Splitting `handoff.shown`'s cost** still reads the handoff rung's own lines; the
  last-here line's bytes (its length and one newline) come off the total first.
- **"Written up to 17:48 (chapter), 3 pieces after."** `workSince` returns the latest
  WRITTEN-UP PIECE's time — a piece time, like the range it sits in — and what claimed it
  (`writerOf`: the session's memories, a chapter, a later session's write-up, read off the
  proposal's own session). "Nothing new" wrote nothing up, so it reads "nothing new to
  write up as of 16:20". "Not yet written up" only when no claim stands on any of it;
  "after" when every unwritten piece is later, "not yet" when some are earlier (another
  session's — claims are per session). The first round printed the claim's time (MINOR-7).
- **Not built**: a durable row for the line (CONTRACT §8 question 8), Desktop chats
  (question 9), and a human session name (question 6 still holds: the line prints the
  short id and the model, as the handoff does).

## 10. What a waking session reads first, round 2 (2026-10-01, random-f2's view of 0.3.10)

- **A stale handoff says so** (CONTRACT §5 G12). A handoff that said it was waiting on a
  fix read as current the morning after that fix was installed. Two facts
  that already exist decide it, at delivery: the release that wrote it against the one
  installed (`staleWords`; the row's `build` stamp since today, else the registry's
  `opened.build.version` for its session — the registry keeps a week, the pointer two, so
  an unstamped row older than that says nothing), and a chapter written here by another
  session after it. Not "its condition landed": that is a judgement, and the next session
  is the one reading the handoff and the words beside it. The words sit right after who
  and when, before the handoff's own first sentence. The installed version is read off
  disk at the wake (`manifestVersionOnDisk`), because a long-running server's own is the
  version it launched with.
- **Who retires it.** The Stop ask now says `retireHandoff` may retire any handoff here
  whose work is done, whoever left it — the door existed (CONTRACT §5 G3c) and only the
  pointer's door line named it. The ask grew by one clause; its pinned length went from
  450 to 480 characters.
- **A recalled handoff's provenance.** Read as a memory, a handoff said "an earlier
  session, 2026-09-23": `origin_session` is never set on it, and a row from before
  2026-09-30 was revised in place by later sessions, so its birth date is the first
  writer's. `handoffAuthorship` reads the writer off the meta and the time off its newest
  `handoff.written` row, as the pointer does.
- **Last here pairs the title with the chapter it was written with.** An episode's title
  is set once, with chapter 1; the line printed the latest chapter's first sentence under
  it, so a later chapter's words read as if they were what the title named. Chosen over "the
  latest chapter alone, no title": the title is the session's own name for what it did,
  and a time question ("what did we do yesterday") wants what was done. The count
  ("2 chapters") says there is more behind the id. Recall's time lead does the same, with
  "(Chapter 1 of 2; recall epi_… for every chapter.)" in FRONT, so a bounded excerpt still
  says it.
- **About me, from another directory.** A chapter about who I am, written in one
  directory, did not reach a wake in another. One line, the newest such chapter inside the
  fortnight, decided by the `about` mark on its copy (`me`, `us`, `owner`). Measured on a
  copy of the owner's store: only day 6's chapter copies carry a mark — the reflection
  marks what it is shown, and a chapter's copy is minted at the session's end — so the
  chapter that prompted this is unmarked and would not show. Marking a chapter at write time
  (`chapter` takes no `about`) is the follow-up that would make this fire on the day.
- **A dropped line leaves a row** (`handoff.lasthere.noroom`), one per chapter per lived
  day, with whether a handoff was carried in its place.
- **One grouped read for the copies** (second review of #311). Whether a chapter is
  confidential or about me is read off its copies, and `origin_ref` has no index, so one
  `list({ originRef })` per episode was a table scan each: 300 episodes on a 15k-row store
  took the walk from 19 ms to 1.7 s and the wake to 3.3 s. `Store#copiesOf` reads every
  copy of the window's episodes in one scan, and the walk carries the answers
  (`ChapterHere.confidential`, `aboutMe`). No schema change. The Yesterday line, which is
  composed once and read by every session, leaves confidential chapters out for all.


## 2026-10-03 — `chaptersOf` returns the heading too

Each chapter `chaptersOf` reads now carries its engine heading line (`heading`, null for a
body with none), so a chapter address (`self/chapter-address.ts`, v12) resolves to it. The
two fields it had are unchanged.

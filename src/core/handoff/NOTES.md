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

## 11. What was planned here since the handoff (2026-10-09)

From daily use: a session wrote its handoff, worked on, and near its end wrote a note that
changed the plan, without rewriting the handoff. The next wake in that directory showed the
older handoff as the place to resume, and the note said nothing. §10's stale words would
not fire: they look for a chapter by ANOTHER session, or a newer install. What was built
(CONTRACT §5 G13), and why each piece is the way it is:

- **The signal is the writer's v12 `status`, plus `unresolved`.** `planned` (decided, not
  done), `proposed` (put forward, not decided) and `asked` (a question or request still
  open) are a closed vocabulary the writer fills deliberately, a column the SQL can filter
  on, and a revision carries it over by default — so a note that `updates` a planned
  memory to change the plan is still `planned` unless the writer says otherwise. `done` is
  not a next step and an unmarked memory says nothing. `unresolved` is the older flag for
  an open question or a pending promise, and the brief named it; the line prints it as
  "open", the word the "Still open:" lane uses. Not a separate "updates a plan" rule: a
  revision of a fact is not a plan, and a revision of a plan carries its status.
- **Since the NEWEST handoff, one line for the block.** Per-handoff lines would multiply
  the bytes, and "since the oldest shown" makes "since" mean something different on each
  rung. What this gives up: a plan written between two sessions' handoffs is not named
  once the later handoff exists. Beside several handoffs the lead says "Since the newest
  handoff here:".
- **The same answer is not news.** `session_end` writes its handoff first and its memories
  straight after, so a planned entry in the same call would be listed "since" a handoff it
  was written with, every wake for a fortnight. The writer's own memories within
  `SINCE_SAME_ANSWER_MS` (five minutes, the chapter span's grace for the same answer) are
  left out; another session's count from the first millisecond. Chosen over "until the
  writer's next turn-end" (`coverage/#workSince`'s rule): a turn in this host can run an
  hour, a plan changed late in the same long turn should be named, and a host with no
  turn-ends (Desktop chat) would never name its own.
- **Only what a session wrote** (`source = 'authored'`: notes, `session_end` entries, a
  write-up). A dream's gist can carry a status too, and is filed under the directory the
  dream ran in; it is a reading of older memories, not news since the handoff.
- **Tried before the third handoff.** The ladder is every rung with the line, widest first,
  then every rung as it was. Interleaved (three with, three, two with, …) would keep a
  third, older handoff over the line at the owner's ceiling, where the share rule caps the
  block near 1,077 bytes; the line is newer than any handoff in the block. The rungs
  without it are today's blocks byte for byte, so a ceiling with no room for the line
  carries exactly what it carried before.
- **Not named twice.** A planned note written in a project is usually a work memory too
  (an unmarked fact with a directory), so the work lines above the pointer leave out the
  ids the chosen rung's line names. And the line leaves out what the published wake
  already lists under "Still open:" (review of #332): the bundle cannot be filtered at
  delivery, so the lane keeps it and the line gives way. Its ids are written beside the
  bundle at each publish (`self/index.ts#THREADS_SHOWN_KEY`, a JSON array) and handed in as
  `listed`, as `settled` is. An open question the lane does not list — opened since the
  last boundary, or past its cap of the oldest — is still named here, which is when the
  line is the only place it shows.
- **Sized to the line that exists, at the boundary** (`liveBlockBytesByScope` asks
  `plansSince` as delivery does). Until 2026-10-10 a `note` did not mark the wake behind,
  so a plan written after the last boundary was carried only where the bundle had room
  until the next one. Now every accepted memory marks it (`memory`), and so does every
  handoff written, retired or cleared (`handoff`, `Counterpart.handoffBehind`); the next
  turn-end's worker re-renders. What lag remains is the worker's: about a second after
  the Stop.
- **Cost.** One SQL read per directory with a live handoff, at each delivery and each
  boundary (no index on `origin_scope`, as `workCandidates`), and prose reads only for
  what it returns; `settledOver` only when there is something to name. Timed against the
  continuity suite's busiest ladder test with the read switched off: no difference above
  the noise. Measured in review (#332) on a synthetic store: the SQL read is 0.2 ms at 800
  memories and 1 ms at 5,000; `plansSince` whole, with its 30 prose reads, 5–9 ms per
  directory.
- **The reserve's ceiling moved, so the widest no-plan block's margin is no longer
  clamped** (review of #332). At 1,646 the ceiling ate the 48-byte margin of a 1,646-byte
  block; at 1,963 it does not. Below a 13,168-byte budget nothing changes (that block fails
  the share rule either way); between 13,168 and 13,552 the reserve takes a narrower rung
  than it did; above, it is up to 48 bytes larger. The owner's hosts report 9,000.

## 12. The Yesterday line gives titles to ids, not to a count (2026-10-10)

`yesterdayShorter` stepped down one title at a time to one, the rest by count, so the ids
of the chapters it gave up were gone. Since the wake ranks its lanes in one list
(`self/briefing.ts#ROOM_ORDER`), the line gives way to "Arriving:" and "Still open"'s first
item before "Last here" and the handoffs do, so it now gives way the cheaper way: each
title given up leaves its chapter's id in its place — pointers instead of titles — down to
ids alone, every chapter the whole line names still named, the count past them unchanged.
Each form is strictly narrower than the one before. And at the wake's floor the line takes
its widest form that fits rather than being dropped whole, which is what happened beside a
page that borrowed "Work here".

The room this module's pointer and "Last here" hold at delivery is now lent too (the root's
`handoffReserveBytes`, split out of `wakeReserveBytes`), after "Work here" and the
Yesterday line's titles. Nothing here changed for it: the delivery already drops "Last
here" first and steps `pointerLadder` down — fewer shown in full, the rest by id — in the
room it finds. What is lent stops at each directory's smallest rung, its newest handoff
alone (review of #367): lent whole, the room went to dated lines and "Still open", and no
handoff was shown at all. That kept block is lent to one lane only, a plain reminder due
the day the wake is read (`self/briefing.ts#ROOM_ORDER`'s `handoffsKept`): then the
delivery may find no room for the pointer, and writes its `no-room` row as before.

## 13. What the span buffer holds of the last exchange (2026-10-11)

Checked before building "Last said here" (CONTRACT §5 G14), with a hermetic run through the
real Stop hook on a written transcript:

- **Per directory: yes.** `spans/<key>/` per scope, the session on every span.
- **A crashed session: up to its last Stop.** Capture runs only at a boundary (Stop,
  SessionEnd, PreCompact), never at a prompt. A session that turn-ended and was then
  abandoned without SessionEnd keeps its last exchange; a message typed after the last
  Stop — the session killed mid-reply, or closed before a reply — is not in the buffer.
  That stretch is not read from anywhere else. A first build read the end of the host's
  transcript for it (when the registry, which the prompt hook refreshes, showed a prompt
  after the last boundary); it was taken out the same day, because the plugin directory's
  policy (rule 1F) forbids extracting data from the host's chat history, and Mike wants
  the plugin to pass that review. Such a session is named by the last exchange its last
  turn-end captured. Capturing at the prompt hook would close the gap from our own hooks;
  it would change capture's cursor and pacing, so it is not done here.
- **A span is a turn-end's whole slice.** `capture` joins every user-side turn since the
  cursor into one conversation span and every assistant text into one assistant span,
  `\n\n` between them, with their sources dropped. So a reminder, a task notification and
  a subagent's hand-back (all `injected`, all captured) sit in the same text as the typed
  message, and the interim "Let me look." sits before the final reply. `ownerWords`
  strips what comes wrapped, cuts the slice at the first paragraph that opens like a host
  frame (a turn runs on past its first paragraph, and typed words come first in a slice),
  and gives up on a slice that opens with a compaction summary, which has no closing
  mark. A per-turn mark in the span would make this exact; that is a format change.
- **The ritual is mechanical.** The end-of-session ask never enters (`ritual`), so the
  turn-end that answers it holds an assistant span and no conversation span. A reply is
  only ever read from a turn-end that held a conversation span.
- An exact repeat of earlier words is not captured twice (layer-2 dedup), so the "last"
  message can be the earlier copy.

## 14. The wake polish: one staleness sentence, one handoff when all are stale, Yesterday by folder (2026-10-18)

From random-6c's 10-17 wake (`~/counterparts-notes/2026-10-17-wake-feedback.md`, items 3
and 4); the wake-polish builder, lightly held.

- **Staleness as one sentence** (`staleWords`): `2 days old; since then: a newer chapter
  here; written on 0.3.24, 0.3.25 now`. The release is said as what it was and what it is,
  not "installed since": a session that installs a release and writes its handoff before
  restarting is still running the old one (it happened on 10-16), so "before 0.3.25 was
  installed" was not true of its handoff.
  Age is calendar days in the store's zone (`daysBetween` of the two local dates), what a
  person means by "two days old"; lived days would undercount a week away.
- **The work-since accounting left the line.** `handoffSince` no longer calls `workSince`;
  `PointerSince.after` and `writtenUpWords` are gone. The reserve shrank with it: the widest
  single block 503 → 428 bytes, `HANDOFF_RESERVE_MAX_BYTES` 1,963 → 1,946 (the older entries'
  sentence is longer than their old words, the newest's shorter).
- **All stale, one shown.** `pointerLadder` starts at one shown when every one it would list
  in full carries a staleness sentence. The reserve sizing passes `collapseStale: false`:
  `WIDEST_POINTER_SINCE` is always stale, and a reserve sized to the collapsed block would
  leave a fresh morning's three without room.
- **Yesterday by folder** (`last-here.ts#yesterdayLine`'s `places`): the chapters a session
  start may not name by title are said as `and 2 sessions in ~/random` — only for a folder
  `elsewhereGate.named` lets the "Today, elsewhere" line name (scope `on`, not this one, not
  the store's own), and not at all otherwise, as that line does not say them. A chapter
  whose row recorded no directory is not said either. Three room tests' fixtures had relied
  on the old bare count to fill the line; they now write their chapters in the session's
  own directory, so the line has the titles their names promised.

- **Review of #543** (the awkward states, `test/elsewhere-titles-states.test.ts`). Three
  leaks found and closed: a status mark let a personal memory through (tier 0 skipped
  `isWorkMemory`: an unmarked person or self memory marked `asked`, Desktop chat's unmarked
  fact marked `planned`); the per-prompt line named open threads (the wake's skip was the
  only guard; the read now leaves out `unresolved` rows, as `workHere` does); the night's
  catch-up wrote write-ups (`secondHand`) under the subject's folder at 03:00, named in the
  morning as that folder's work, and its runner's registry record (`writeup-<run>`, in the
  folder that launched the run) printed as "Here, also open: session writeup-". Checked and
  left: a title with a credential is refused at the battery (a title is a handle); a body
  with one is redacted before it is stored, so the untitled fallback names redacted words;
  a re-mark (owner, confidential) is read from the columns at every read; a session idle
  3h59m is open here, 4h01m not, an ended one never; four live sessions here take the whole
  line, the other folders counted ("3 other projects"), and "Last here" and the dated items
  are where they were in a full 9,000-byte wake with the head fields (8,700–9,300).

Undo: `git revert` of the PR; nothing is stored differently.

## 15. Each episode once, no bare ids (2026-10-20)

From the 10-20 morning wakes (Mike's 10-16 "remove duplication"); lightly held, an
experiment. Decision record: `docs/decisions.d/fix-wake-dedupe-1020.md`.

- **Who owns an episode.** The Yesterday line is composed inside the body, before the
  furniture is spliced, so the split is decided on both sides of that seam: at assembly the
  Yesterday line drops the one episode every "Last here" rung names (its newest,
  `Counterpart#lastHereNewest`); at the splice, "Before it", "+N more here" and the about-me
  line drop any episode whose id the body's text already holds (`lastHereBlock`'s `named`,
  `result.text.includes(id)`). Reading the body's text rather than the Yesterday line's
  inputs keeps the splice true of whatever form the room left: a title Yesterday gave up to
  its count is named again below, by id. The published bundle (no reader) keeps the
  store-wide Yesterday line; when a session start falls back to it, "Last here"'s newest can
  appear twice, as before.
- **Bare ids.** `yesterdayLine` lists only titled chapters (at most `YESTERDAY_SHOWN`) and
  counts the rest; `yesterdayShorter` stops at one title. A line of untitled chapters only is
  a count ("Yesterday: 2 sessions").
- **Measured on a fixture** (`test/last-exchange.test.ts`): a wake whose Yesterday line went
  away composed without borrowing the furniture's room (`takeRoom`'s lend), and the
  leftover-room upgrade (#489 C, `briefing.ts`) then had less room than in the control, so
  "Still open"'s first item printed as a line, not whole. The same items are listed. The
  upgrade spending borrowed room is the room system's behaviour, not changed here.

## 16. The elsewhere lines name what was written (2026-10-20)

Mike's go, lightly held, an experiment. Decision record:
`docs/decisions.d/feat-elsewhere-titles-1020.md`.

- **The read.** `Store#memoryTitlesByScopeSince` is one SQL read over the window's rows:
  a tier per row (a status mark 0, work 1, the rest dropped), `ROW_NUMBER()` per
  `origin_scope`, at most `perScope × 4` a folder so the caller can still drop this
  session's own and the open threads and keep two. The columns only (`title`, or the
  body's first 240 characters), the same exclusions as the counts plus confidential for
  everyone, the personal marks, identity, a chapter's copy (`source`, `origin_ref`, a
  summary's `meta.episodeId`). The caller confirms every row on `isWorkMemory` (tier 0
  too, since the review), so an unmarked fact in a name scope (`claude-desktop:`) stays
  personal, as in the wake's lanes.
- **The ladder.** `elsewhereForms` used to try, per count of folders, the form with
  chapters and the one without. It now tries every non-increasing allotment of titles
  across the named folders (0–2 each), most titles first and spread before stacked, each
  with and without the chapters, then the folder count steps down. The monotone filter is
  unchanged: each kept form is narrower than the one before. With no titles every
  allotment prints the same string, so the old chain falls out unchanged (pinned in
  `test/elsewhere-titles.test.ts`). At most 21 allotments × 2 for five folders.
- **Tests that pinned the old rule.** `wake-fresh-today`, `since-you-started`,
  `wake-on-resume` and `wake-lanes` asserted "never a work memory's title" anywhere in the
  wake; they now expect the title in the elsewhere line (and the body nowhere), and the
  lane tests check their lanes with that line set aside. On the long temp paths of the
  since tests, two folders with a title each leave no room for the chapter: the chapter
  gives way first, by design.
- **The same folder** (added the same day, the coordinator's ask). `elsewhereForms` takes a
  second list, this folder's other live sessions (`HereSession`), put FIRST in the entries
  the ladder counts down, so other folders give way before them; they print as a clause of
  their own after the folders ("… . Here, also open: …"), or alone ("Here, also open: …";
  for the per-prompt line, "Since …: here, also open: …"), and the last form counts both. The
  read is the same SQL partitioned by `origin_session` (`sessions` option), filtered to rows
  filed in this folder. The folder's scope is not asked: `named()` still refuses this
  folder, and nothing from here is new to a session here. A session that ran out its
  registry TTL (4 h since its last boundary) is not live and is not named. One fixture had
  to change because of it: `last-exchange`'s control wake (A's) now sees B open here, so B
  is closed before it; `wake-fresh-today`'s first test closes its HERE session so the line's
  room stays the other folders' as it pins.
- **Work here.** `addHandoffPointer`'s work lines skip a `mem_` id the printed elsewhere
  line holds (`elsewhereNamedIn`, read off the body text as the 10-20 episode dedupe reads
  it), so another session's work shows once, in the line that says who is doing it.
- **Not done:** the per-prompt line still says nothing within its hour, so titles written
  in that hour wait for the next line rather than being lost.

Undo: `git revert` of the PR; nothing is stored differently.

## 2026-10-21 — confidential chapters are no longer left out

- `HandoffsOptions.owner` is gone (it existed only for the "since" line's confidential
  rule), and `ChapterHere.confidential` with it. "Last here", the Yesterday line, the
  elsewhere lines and the about-me chapter line name a chapter by the scope, folder and
  about-me rules alone; a store whose copies will not read now reads as about nothing
  rather than as confidential.

## 2026-10-21 — the last exchange for any session in the folder

- The "Last said here" line and the recall handle are no longer owner-only: any
  session in the folder gets them (the yours/guest split was removed). The line is
  still not given under observer, whose handle stands down.

## 2026-10-26 — "Last here" names a later session with no chapter (S2)

The Dana week (0.3.36): a meeting chapter on day 1, then short sessions with none, and "Last
here" named the day-1 meeting until day 6 — true of the chapter, false as an account of who was
last here. A check-in rarely writes a chapter, so for the new first audience it was most days.
Now the newest session here, when it is newer than every chapter here and wrote none, is
named first; its newest live memory stands for what it was about (the night's second-hand
write-up of it, or a note it made in the moment — the smaller of the two true things, beside
"Last said here", which quotes its last words while they are inside a day), and the chapter is
"Before it". A session with nothing to show (only a turn-end filed here, no words held, no
memory) is passed over, at most `LATER_HERE_TRIED` (3) looked at. `chaptersHereFor` is
unchanged, so recall's "the most recent session" and the no-room row still mean the chapter.
H0 `checkins`: "Last here" named nothing all week before; after, every morning names the
previous check-in.


## 2026-10-26 — review of #636's follow-ups: headless runs, the line's room with no chapter

- **A session nobody attended is not the line's.** `WakeSession.headless` is the host's word
  (Claude Code: the registry's `entrypoint` in `NON_INTERACTIVE_ENTRYPOINTS`, `sdk-cli` for
  `claude -p`, the SDKs). The later-session walk passes one over before its `LATER_HERE_TRIED`
  count, so a run of them cannot hide the person's session behind them. A session the registry
  no longer knows (records are pruned at 7 days, the line's fortnight is 14) reads as a
  person's: noise at worst, the direction `fired.ts#presentDays` takes too.
- **The reserve no longer waits for a chapter.** `handoffRoom` sized the line only when the
  fortnight held a chapter; a later session with none now gets the same room, under the same
  share rule. The boundary has no registry, so the reserve is a bound and counts a headless
  session too. Measured at 9,000 B on a full-lanes fixture: the line had fitted before anyway,
  in the slack of other reserves (the preface's worst case is 293 B against ~110 used, and an
  unused "Last said here" bound), so this mostly stops it borrowing that room. When the line
  is dropped, its no-room row now names the later session, not the older chapter or nothing.
- `sessionsHere(scope)` is read once per scope for the chapters and the later session both.

## 2026-10-26 — the later session's quote is never the night's (L2)

- **Night output is filed under the session the night launched in**, not the sessions it
  read: a dream's gist, fold or merge (`origin_ref dream:…`) and a reflection's entry
  (`reflection:…`). The S2 tier-2 week showed chapterless sessions quoted as "Reflected: …" /
  "Dreamed: …" (d3s1, d4s2, d6s1). `laterHere` now passes over `isNightRow` rows, the same
  test the privacy read uses, so the quote is the session's own note or its write-up (filed
  under the session it writes up), else "not written up yet". The folder-only rule stands.
- **A session with only night rows and no words still held is passed over**, as one with
  nothing captured always was ("something to show for it"); before, it was named with the
  night's quote. Kept: a dream filed under it is nothing it said.
- A reflection a session makes by hand (the `reflect` tool) is filed the same way and is
  skipped too: the rows carry no mark of who launched them. Telling the two apart would need
  one (the reflection row's `dream_id` is the nearest); left for a later read of whether
  hand reflections happen enough to matter.
- Harness (finding 6): night children's tokens are tallied by act (`recordUsage(output, act)`),
  each night's asks carry their child's tokens, and `renderWeek` prints them per night, so a
  model-seat week can say what each catch-up cost.

## 2026-10-30 — one block for where this folder stands (WK1)

- **What comes next is kept by its word.** `handoffLead` looks for a handoff's last `next…:` (`next:`, `Next for me:`, `Next
  step:`). A handoff with its next step in other words has no such guard: its first lines are what shows.

- **Why one renderer, not a reorder.** Three ladders spliced in a fixed order is what let an older handoff read as the
  latest word; sorting them would still have said who and when three times. `standsLadder` groups by session, so one session's
  chapter, last words and newest handoff are one entry. Older entries are judged by session and time, never by text.
- **Removed with it:** `pointerLine`, `pointerDoor`, `pointerBlock`, `pointerBlockMany`, `pointerLadder`, `Handoffs#pointer`,
  `#pointerChoices`, `lastHereBlock`, `lastHereLadder`, `laterHereLadder`, `withExchange`, `lastExchangeLine`, and the limits
  `HANDOFF_WAKE_SHOWN`, `HANDOFF_WAKE_LISTED`, `LAST_HERE_SHOWN`, `LAST_HERE_LISTED`. "Before it" and "+N more here" are
  "Today so far"'s and the Yesterday line's job. The all-stale collapse went too: every other handoff is now a short line
  with no staleness sentence, its day says it. The newest says its own, "with a newer chapter here since", and the chapter
  is named under it.
- **The shape changed mid-build** (Mike's markup and ROADMAP's review of the numbers, 10-30): first one line with the newest
  mention leading; then the newest handoff's lead at up to five lines and every other live handoff a line, which took "Work
  here" down to nothing on a tight wake; then two other handoffs, and the handoff leading whatever is newer, as review of
  #300 MAJOR-1 asked. Measured on the 10-30 copy, the last step gave ~/random back 1–2 "Work here" lines and ~/counterparts
  back all of its. A lead line stays flat and indented, so a body cannot read as a line
  of the wake's own, and the markers are refused at write as before.
- **The events keep their meanings.** `handoff.shown` is a handoff with a line in the wake, `counterpart.lasthere.shown` and
  `handoff.lasthere.noroom` the chapter's part, `counterpart.lastexchange.*` the quote. Doctor and the dashboard still call
  it the "Last here" line: words to change with WK2's look at the block, not here.
- **The corpus copy has no `spans/`** (backups hold no conversation text), so the real-path run there shows no last exchange
  and no later session: `test/wake-room-wk1.test.ts` covers both through the door.
- **Found by the tests' pass, fixed:** `index.ts` importing `standsLadder` made a load cycle through `last-here.ts`'s constant
  (`LAST_HERE_TITLE_BYTES` moved to `index.ts`; a test loads each module first). A session nobody attended no longer has its
  last words in the block: as a lesser line it could quote one, and here it would have led. The `last exchange` handle still
  answers with it. `LAST_EXCHANGE_LINE_MAX_BYTES` is 176 for the exchange as the block's whole entry.
- **`hintsForReader` reads the new count lines too:** a store with no page keeps the hints lane, so a count with no ids reaches
  the published-bundle road. It names nothing a reader may not see, so it stands, where it would have been dropped as unreadable.

## 2026-10-30 — the block under the wake's shape (WK2)

- With `self.WAKE_SHAPE` on, `standsLadder` isn't asked: `core/counterpart-wake-shape.ts` writes "Where this folder stands" from the
  same reads. The ladder stays for the old road and for the boundary's reserve (`handoffRungBytes`).
- **`handoffLead` takes a line's limit** so the shape can have whole sentences up to the lead's own room, keeping the last `next:`
  part #687 made safe. The default is `HANDOFF_LEAD_LINE_BYTES`, as before.
- **`lastExchange` takes `skip`**, for the sessions nobody attended. With the switch on that goes for the `last exchange` handle
  too, which answered with them before; off, the handle is as it was. A quote from further back than the last attended session
  isn't "Last said" in the shape: read beside a later handoff it would seem to be what was just said.
- **"Since, here" leaves out open threads and dated items.** Spec-silent: the prototype's claim order let Since take them, which
  lost a due item's place in Coming up and an open one's settles-when. Each section one question; a row left out still counts as "later", so no false nothing.
- **A folder with no handoff and no work since yesterday** names its last chapter (`Last here: chapter "…" (5 days)`), rather than
  losing what "Last here" gave it on the old road.
- **Elsewhere's door is its own read (2026-10-30).** `+N more folders; recall facts "yesterday"` filtered on a row's event date:
  on the 10-30 corpus 131 store-wide rows over 14 pages, and 0 rows for two of three hidden folders. `recall "elsewhere"` is
  `readElsewhere`, which is `elsewhereFacts`, the section's read. What makes its count exact: the folders the section only counts
  (worked in, with no title that passes: personal rows, dated rows, open threads) are named now, last, with no title; and nothing
  above the section can claim one of its rows any more, since the page's hints skip what Elsewhere names. On a store with no page
  yet a hint Elsewhere would name gives way to the next hint, on the shaped road only. A wake read later than its door, or the
  other way round, can differ by what was written in between; the numbers are the same at one moment.


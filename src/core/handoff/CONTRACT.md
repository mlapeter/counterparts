# `handoff/` — CONTRACT

## 1. Purpose

Carry, for one directory, *where the work stands and what to pick up next* — and stop
carrying it. One live pointer per place per session that left one, delivered at the wake
of a session that opens there, and never a memory. Beside it (2026-09-30), *who was last
here*: the session that last wrote a chapter in this directory, finished or not, derived
at the wake from the chapter and never stored (`last-here.ts`).

## 2. Brain analog

**Prospective working context**, not episodic memory: the note you leave on the bench about
the half-finished job, which is useful for a fortnight and then is clutter. Human memory
keeps this in a different register from what was *learned* — it is bound to the place and
the task, it does not consolidate overnight, and it is not part of who you are.

**Named deviation** (constitution line 12): the brain does not keep a per-directory ledger.
The directory stands in for the place-and-task binding a person gets for free, because in
this host a directory is what a piece of work *is*.

## 3. Keeps

- **The lane itself.** [v1] `task-state` — an expiring, non-consolidating store of "what I
  was doing here". v1 had it, it worked, and the clean-room rebuild dropped it. The spec's
  §6.4 and §15 item 6 are where it comes back, in the owner's words: today he types "prep a
  handoff so we can pick up from here in a new session", and he wants that to happen on its
  own.
- **One ask, one pacer.** [v2, `self/CONTRACT.md` §13 G3's scar] The handoff is a FIELD on
  the `session_end` call the end-of-session ask already names. There is no second ask, no
  second tool and no second pacer; growing the blocked moment back into two asks is the
  measured failure that scar is named for.
- **Refused, never cut.** [v2, S1's rule] Past `HANDOFF_MAX_BYTES` the write is refused with
  a named reason: what gets cut at write time is the only copy.
- **Every entrance passes the battery.** [v2, SEAMS H] A handoff is prose written in a hurry
  at the end of a session, which is exactly the kind of text a credential gets pasted into.
- **A cap reports what it refused, where the owner will see it.** [owner ruling 2's
  corollary, 2026-09-18] Refusals are durable rows, not silence.
- **Furniture, not an element.** [v2, the self page's placement] The pointer carries no
  `- ` bullet, enters no lane, and leaves `counts` and the sentinel's `elements=` true of
  the bundle that holds it.

## 4. Drops / simplifies

- **No forgetting mechanism of its own.** The pointer stops showing after
  `HANDOFF_LIFE_DAYS` lived days; the row is then let go by the ordinary prune, because it
  is born unprotected in the episodic band with nothing on any salience dimension. Adding a
  sweep for it would be a second forgetting for one row (constitution line 15).
- **No archived row per revision.** A newer handoff from the same session for the same
  directory REVISES that session's row, so the one it replaces is an ordinary version,
  bounded by the ordinary version retention. The self page's precedent; the alternative
  leaves superseded rows for every reader of `list()` to skip.
- **No merging of sessions' handoffs.** Until 2026-09-30 a directory had ONE row and every
  session's write revised it, so the last session to end replaced the others' pointer —
  measured that day, when "Two builds are in flight" was overwritten by a session that
  knew nothing of either. Each session now keeps its own row and the wake shows them side
  by side; nothing tries to reconcile them.
- **No doctor line.** The fired view carries both halves, and a handoff that nobody left is
  not a fault. A handoff row whose WORDS have gone missing is a different matter and is not
  this module's line to print: on the v6 floor a tombstoned row is skipped by
  `Schemas.load` and the session starts normally, and a FAULTED one (blank body, a hash
  that still names it) stands the session down as `MEMORY_BODY_MISSING` — which `verify`
  names by id and `counterparts remove <id>` clears. Both measured, both tested.
- **No second lane in the wake, and no new trim order.** The pointer is reserved for, not
  ranked.
- **No scope registry of its own.** The directory arrives as a string from the adapter that
  resolved it (`adapters/scopes.ts`); this module canonicalises nothing.

## 5. Contract

**Inputs** — a body, a canonical directory, a session id (or null), the writing session's
model id (or null), the lived-day clock, and a gate (`bridge.episodeGate`, injected).
**Outputs** — one schema row per (directory, session) with `meta.role = "handoff"`; a
pointer block for a given directory and day — two lines for one live handoff, a short
newest-first list for several, and under either a "since" line when a plan was written
here after the newest (§5 G13); four durable event names (`written`, `shown`, `cleared`,
`refused`). And a "Last here" block for a directory where a session wrote a chapter inside
the fortnight: one to three lines, no row and no durable event (§5 G11).

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] It is never a memory.** It is out of the recall scan (`recall/activate.ts`), it
   takes no use credit even when a session expands it by id
   (`counterpart.ts#creditReferences`), it is skipped by dedup (`sleep/types.ts#isSchemaRow`),
   it is invisible to the schemas index (`toMetaRecord` returns null for its role), and
   `scanActive` lists `{ type: "memory" }` so it can reach no briefing lane. With `uses` and
   `reinforced_days` structurally pinned at zero, `physics#promotionEligibility` can never
   be satisfied and the row can never cross into the identity band.
2. **[M] One live row per directory per session** (since 2026-09-30; per directory
   before). The same session's second write revises its first; the body it replaces is a
   readable version on the same row. A different session's write mints its own row and
   touches no other. The row's key is `meta.scope` and `meta.session`, both of which every
   row written since 2026-09-20 already carried, so the rows that existed before are keyed
   by the session that last wrote them — no migration.
3. **[M] The body is refused past `HANDOFF_MAX_BYTES`, never truncated**, and every refusal
   is named and durable — except under observer, where nothing at all is written. Every
   refusal in this module goes through one private seam, so that is checkable in one place;
   the two shapes that used to escape it (`no-scope` short-circuited at the MCP door, and a
   present-but-blank field, which was total silence) were the adversarial review's MAJOR-2
   and are closed.
3b. **[M] A `handoff` field that is PRESENT and blank RETIRES the caller's own pointer for
   the directory**, and no other session's. The row is archived by the ordinary means, its
   words stay readable on it, and one `handoff.cleared` row says so. An ABSENT field means
   "leave what stands"; a field that is not text is a named, durable refusal.
3c. **[M] `retireHandoff` retires a handoff in THIS directory by id, whoever wrote it**
   (2026-09-30) — the door for one whose work a later session finished. An id that is not
   a handoff filed under the caller's directory and not yet retired is `not-here`,
   durable, and nothing is touched (a race's duplicates of the retired row's key go with
   it, as `clear` takes them). Its `handoff.cleared` row says `byId` and whose it was. A
   successful write names the other sessions' handoffs standing here (`others`), and both
   door lines of the pointer say how to retire one, so the session that finishes the
   work is told they are there.
3d. **[M] A Claude Desktop call that named no session leaves and retires no handoff.**
   It was bound to the most recent live Desktop session, which may be another chat's, and
   a handoff is keyed by its session. `handoff` and `retireHandoff` are refused
   `session-unnamed`, durably, with the words that fix it; the rest of the call goes
   through as it always did.
4. **[M] Credentials are redacted or the write is refused**, by the same battery every other
   entrance passes, and the writer is told which happened.
5. **[M] The pointer expires in LIVED days.** After `HANDOFF_LIFE_DAYS` it is not shown and
   no row claims it was. A handoff with no recorded lived day has already expired.
6. **[M] With no live handoff in the store and no chapter written inside the fortnight in
   any directory, the wake is byte-identical to what this tree composed before this module
   existed.** The delivery splice happens only when a pointer or a "Last here" line is
   found, and the compose-budget reserve is taken only while some directory holds one (the
   chapter clause since 2026-09-30). Proved by `tools/wake-dump.ts` against another checkout, `diff` exit 0; the
   adversarial review widened the same proof to 2,824 compositions with the same result.
   **On a real store this no longer holds** (review of #300, MINOR-6): a store in use
   always has a chapter inside the fortnight, so the reserve is always taken there. What
   that costs is NOTES §9.
7. **[M] The pointer never puts the bundle over the host's ceiling.** Its room is reserved
   out of the compose budget at the boundary (see §6 for who pays); at delivery a bundle
   that would still exceed the ceiling is delivered WITHOUT the pointer rather than over the
   limit, and that drop leaves a durable `handoff.refused{reason: "no-room"}` row, deduped
   per row per lived day.
7b. **[M] It never gets a vector** (`store/#noVector`, asked at all three doors:
   `indexOne` at write time, `unembeddedIds` for the backfill, `embedOne` for a caller
   naming an id). One could not reach a turn — `activate` skips the row — but it would give
   the prose this module calls the likeliest to carry a token a second representation
   outside its row, and put a floor under the embed backlog `doctor` watches. The SELF PAGE
   is excluded by the same rule as a working default (2026-09-20, the coordinating session's
   ask — not an owner ruling, and revisable); the journal is NOT, and
   why is in `INTERFACE-GAPS.md` §7. The LEXICAL index still holds both, so the owner can
   still find a row by searching for it.
8. **[M] The sentinel stays true.** The splice re-solves the byte fixed point so the opening
   comment and the tail sentinel both state the delivered total, and the lane counts and
   `elements=` are untouched.
9. **[M] Nothing in a payload is a directory path or a body.** Telemetry is ids, counts,
   bytes, reasons and flags (store §5 G10); which directory a row is about is on the row.
10. **[A] The wording of the pointer's lines is advisory.** What is mechanized is that a
    pointer states WHO wrote it when the row names a session (the short session id, "this
    session" for the reader's own, and the model when the host recorded one), that
    several live handoffs are shown newest first with at most `HANDOFF_WAKE_SHOWN` in full
    and the rest named by id, that a
    pointer states when it was written (since 2026-09-30 to the minute, and — when work past
    the owed floor was captured here after that, not counting the writing session's own
    turn — when that work ran and how far it is written up, computed at delivery from piece
    times and claims by `coverage/#workSince`: "written up since", "written up to 17:48
    (chapter), 3 pieces after" (the latest written-up piece's time), "nothing new to write
    up as of 16:20", or "not yet written up" only when no claim stands on any of it), the
    first sentence of at least
    `EXCERPT_MIN_SENTENCE` characters of its first line of SUBSTANCE (headings and a leading
    list marker are skipped) and its id,
    names the door to the whole of it, and carries no control or bidi-override character
    into the bundle.

11. **[M] Last here (2026-09-30).** A wake in a directory where some session wrote a chapter
    within `LAST_HERE_LIFE_DAYS` lived days (the handoff's fortnight) carries a "Last here"
    line: who (the short session id and the model, `sessionWords`), when that session was
    at work here (its first and last `stop` turn-end and piece in this directory, never the
    host's close), the chapter's title and id (with its chapter count past one), and the
    first sentence of its FIRST chapter — the one its title was written with (since
    2026-10-01; its latest until then, which paired a later chapter's words with the
    first one's title). The engine's own heading is the only split. The waking session's own chapter
    is never "last here". Up to `LAST_HERE_SHOWN` sessions of that day are named (the one
    before by title only) and the rest of that day by id. Derived at delivery: a chapter is
    HERE when its row's `origin_scope` says so (set at birth since 2026-09-30); with none,
    when this directory's coverage file holds its chapter claim; failing both, when its
    session's turn-ends are filed here — no new row type and no write. A removed row is
    not read. A chapter puts the wake BEHIND (`self/behind.ts`, trigger `write-up`), so the
    turn-end worker's refresh reserves the line's room on a store whose lanes fill the
    ceiling. It is spliced above the handoff pointer and shares its reserve and share rule
    (§6); the handoff is carried first. It is not a handoff: nothing retires it, and a
    session that finished its work and wrote a chapter needs no handoff to be found.
    A line dropped for room leaves one durable row per chapter per lived day
    (`handoff.lasthere.noroom`, since 2026-10-01), which the dashboard's wake bar reads.
    **About me, from another directory** (2026-10-01): the newest chapter inside the
    fortnight written elsewhere whose copy is marked `me`, `us` or `owner` adds one line
    (title, id, and the directory) on the widest rungs, given up first. Work stays where it
    was done. Only from a directory the host's scope setting has `on` (`WakeHere.exportsFrom`;
    no way to ask means nothing crosses), only a chapter whose row records its directory,
    and NEVER a confidential one (the episode or any copy). A confidential chapter is
    "last here" to the owner only (review of #311).

12. **[M] A handoff says when it may be out of date** (2026-10-01). Beside who and when,
    at delivery: "before 0.3.10 was installed" when the release that wrote it — stamped on
    the row (`build`) since 2026-10-01, else the release its session opened with, from the
    host's registry — is older than the one installed now; "a newer chapter here since"
    when a session other than its writer wrote a chapter in this directory after it. Both
    from records that exist; nothing judges whether what it waited on happened. The Stop
    ask names `retireHandoff` for any handoff here whose work is done, whoever left it.

12. **[A] The "Yesterday" line is composed here, carried by the wake** (2026-10-01, wake
    build 3). `last-here.ts#chaptersOn` reads, per episode, the chapters WRITTEN on a date
    — each chapter's own heading prints its calendar day, and only that is read (a row's
    write times move for a retitle too); an episode from before headings carried a date is
    read by the day it was born — so a session that wrote yesterday and again today is
    still yesterday's, and two chapters count as two (reviews of #308).
    `last-here.ts#yesterdayLine` names them store-wide, oldest episode first: up to
    `YESTERDAY_SHOWN` by title (cut to `YESTERDAY_TITLE_BYTES`) and id, with the count when
    more than one, the rest by count, the date in the line.
    The root hands it to `self/`'s render as furniture for the day before the render's
    date; unlike "Last here" it is in the published bundle, not spliced at delivery.

13. **[M] What was planned here since the handoff is named under it** (2026-10-09). A
    session that left a handoff and later changed the plan in a note, without rewriting
    the handoff, left the newer memory quiet. Now the pointer's block ends with one line,
    "Since this handoff:" ("Since the newest handoff here:" beside several), naming the
    memories this directory's sessions wrote by hand after the NEWEST handoff's words
    whose v12 `status` is `planned`, `proposed` or `asked`, or that are still flagged
    `unresolved` (`Handoffs#plansSince`, `PLAN_STATUSES`): up to `SINCE_SHOWN` by title
    (cut to `SINCE_TITLE_BYTES`), word and id, newest first, the rest by count. Its own
    session's memories count, except what it wrote within `SINCE_SAME_ANSWER_MS` of the
    handoff, which is the same answer (the `session_end` call writes its handoff first
    and its memories straight after). Never named: a `done` or unmarked memory, another
    directory's, a dream's or a sweep's (`source = 'authored'` only), one a later memory
    settled over, a journal copy, a confidential one outside the owner's session. Read
    at delivery and at the boundary from the columns (`Store#planCandidates`), then the
    prose of what came back; a store that will not answer names nothing. Every rung of
    the ladder is tried WITH the line before the rungs WITHOUT it, which are the blocks as
    they were, byte for byte; a memory the line names is left out of the work lines
    above it. `handoff.shown` counts the line's memories (`plans`).

## 6. Where it sits in the wake's order — who pays, when, and how much

The pointer is **furniture at the foot of the bundle**, above the tail sentinel and below
every lane. It is not in `TRIM_ORDER`, which is a LANE order: the trim loop pops elements,
and the pointer is not an element.

**An earlier draft of this section said the pointer "never causes a trim". That was the
reverse of the mechanism, and the adversarial review of 2026-09-20 measured it.** What is
true:

- **The reserve is what causes the trim.** `reserveBytes` is subtracted from the compose
  budget, so the trim loop runs against a smaller ceiling and pops lane elements *to make
  room for the pointer*. A memory is dropped so a handoff can be shown.
- **The reserve is store-wide; the pointer is per-directory.** One bundle is published per
  store. A handoff written in project A shrinks the wake composed for every session in
  every directory of that store, and a session in project B pays for a pointer it will
  never be handed.
- **What that cost was, measured, at the flat 448-byte reserve:** at a 1,200-byte ceiling a
  session in a directory with no handoff lost 4 of its 6 identity elements; at 2,000, 4 of
  13; at 3,000, 5 of 23. At the 9,000 the parallel run uses, the lane caps bind before the
  byte ceiling does and the cost is zero.
- **What it is now.** Two changes, both in `reserveBytes`, and neither of them a second
  budgeter: the reserve is sized to the pointer block that ACTUALLY EXISTS (the widest live
  one, one per directory) plus a small margin, capped at the widest block this module can
  produce; and it is **not taken at all** unless the ceiling is at least
  `HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE` times it. Below that the reserve is zero, no lane
  pays anything, and the pointer is simply not carried at that ceiling — `handoff.refused
  {reason: "no-room"}` says so, once per row per lived day.
- **At delivery**, a bundle that would still exceed the ceiling drops the pointer whole
  while every lane element stays.
- **Several handoffs in one directory (2026-09-30)** do not buy more than one could. The
  boundary passes every block a delivery might splice — three shown, two, one, the newest
  alone — and the reserve is the widest of them the share rule allows, so it can never
  pass an eighth of the ceiling however many sessions left one. At delivery the ladder is
  walked widest first and the first rung that fits is carried; the pointer is dropped
  (and `no-room` written, with the smallest rung's bytes) only when not even the newest
  alone fits. Measured with sixty identity elements, one handoff against three (each
  naming a session and a model): the reserve is 487 against 735 bytes at a 6,000-byte
  ceiling (the share rule's 750 binds), and 487 against 855 at 7,000 and at 9,000. All
  three are carried at each ceiling, and the directory's own wake and a wake elsewhere
  keep all 24 of their elements at each — but that fixture composes to about 2,860 bytes,
  so the lane caps bind before the byte ceiling does; on a store whose lanes fill the
  ceiling, the compose-budget difference is what the lanes give up, never past an eighth.

- **The "Last here" line (2026-09-30)** is a candidate in the same reserve: per directory,
  each of its rungs (every session of that day, the newest with a count, the newest alone)
  on its own and beside each of the directory's handoff rungs. At delivery the HANDOFF IS
  CARRIED FIRST (review of #300, MAJOR-1): the widest handoff rung that fits alone is the
  one delivered, and the line is tried above it, widest first, that rung alone being the
  fallback. The line alone only when no handoff rung fits (`no-room` written as before).
  With no chapter here the ladder is the handoff's, rung for rung.

- **The "since" line (2026-10-09)** is part of the handoff's own rungs (§5 G13): each rung
  with it is a candidate in the reserve, sized to the line that exists at the boundary,
  and the share rule still takes the widest that passes. It adds 79 bytes for one plan
  with a 29-byte title, and at most 306 (317 beside several handoffs: three titles at the
  cap, the widest word, a count). With no plan written here since the newest handoff the
  rungs, the reserve and the block are what they were. A plan written after the boundary
  that composed the bundle waits for the next one to be reserved for (`session_end`
  marks the wake behind; a lone `note` does not), and until then is carried only where
  the bundle has the room.

So the order of who gives up bytes, stated plainly: **above the share rule's threshold the
pointer is paid for first, out of the compose budget, by whatever lane the trim order
reaches — store-wide. Below it the pointer gives up everything and the lanes give up
nothing.** A fortnight of working context is worth less than a memory, and the threshold is
where this module says so in numbers rather than in a sentence.

**Worktrees, and why they are not a surprise.** The directory a session is filed under is
`CLAUDE_PROJECT_DIR` where the host sets it (`bin/hook.ts#startDirectory`,
`mcp/server.ts#hostScope`), which stays put when a session `cd`s or enters a git worktree.
So a session launched at a repo root and working inside `.claude/worktrees/x` shares the
repo's pointer, and a session *launched* inside the worktree gets its own. Both are
defensible; what would not be is neither being written down.

## 7. Scars honored

**§2.3** (delivery telemetry is distinct from render telemetry — `handoff.written` and
`handoff.shown` are two rows because "we wrote one" is not "a session was handed one") ·
**§2.18** (the host's ceiling is reported, never invented, and the reserve is what makes it
survive a delivery-time splice) · **§1 G2** (both comment lines state the delivered total) ·
**§1 G7** (a store that will not answer never fails a wake) · **observer G3** (an instrument
does not log its own refusal) · **§13 G3** (one ask at the blocked moment).

## 8. Open questions

1. **Is the share rule's threshold right?** `HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE` is 8,
   which turns the reserve on from about 3,650 bytes of ceiling — about 3,900 for a pointer
   naming a session and a model (2,400 until 2026-09-30, when the pointer began saying how
   current it is, then who left it and how to retire it, and the reserve was sized to
   those words), and roughly 4,400 for one that also says why it may be out of date
   (2026-10-01); about 5,000 with a one-plan "since" line under that, and 6,900 with the
   widest line (2026-10-09). It is a judgement about
   what a pointer is worth against a memory, made once, in numbers; the owner's hosts all
   report far more than that, so nothing he runs is near it today.
2. **Does the host's own file memory duplicate this?** The spec names it as the thing to
   watch in real use (§15 item 6). A directory with a `CLAUDE.md` that already says where
   the work stands may be carrying the same sentence twice.
3. **Is a fortnight right?** `HANDOFF_LIFE_DAYS` is a guess with a reason, not a measurement.
   The row to watch is `handoff.shown`'s `ageDays`, which is now ONE row per directory per
   lived day — before that it was one per wake, and the distribution would have been
   dominated by a session re-waking rather than by distinct pickups. Read it as written; no
   further dedupe is needed.
4. **CLOSED (2026-09-20): a stale pointer now has a one-word retirement.** The ask fires up
   to six times a session, so a session can write "half done" early and finish by the last
   ask. Sending the field PRESENT and blank clears the directory's pointer (§5 G3b). What
   remains open is whether models actually reach for it; the row to watch is
   `handoff.cleared` against `handoff.written`.
5. **Do per-session handoffs pile up?** Before 2026-09-30 a directory could hold one; now
   it holds one per session that left one and did not retire it, for a fortnight each. The
   row to watch is `handoff.shown`'s `among`. Two nudges are built (the doors say how to
   retire one, and a write names the others standing). If it still runs high, the next
   answer is a shorter life for an older one (a follow-up, NOTES §8) — not a cap that
   silently drops someone's pointer.
6. **Should the pointer name a session in words a person uses?** It prints the first
   eight characters of the session id. The host lets a person name a session, but that
   name is not in the hook input or the session registry today; reading it means a
   transcript field threaded through `lifecycle.ts` and `sessions.ts`, which is the hosts
   work's ground. Left as a follow-up.
7. **Should an expired row be archived rather than left to the prune?** Today it sits live
   and unread for the 90 lived days `D_FLOOR_DAYS` asks for. That is correct and it is also
   a row `list()` walks for three months after it stopped mattering.
8. **Should "Last here" leave a durable row?** When it is SHOWN, a ring event only
   (`counterpart.lasthere.shown`), so the fired view cannot see it fire. When it is
   DROPPED for room, a durable row since 2026-10-01 (`handoff.lasthere.noroom`), so the
   wake bar can go amber for it.
9. **Claude Desktop chats and "last here".** A Desktop chat records no turn-ends, so
   before 2026-09-30 its chapters were never "last here". An episode now carries its
   place on `origin_scope`, and every Desktop chat shares one place (`claude-desktop:`),
   so a new chat is shown the last chat's chapter. Whether that is wanted for chats is
   untested with the owner.

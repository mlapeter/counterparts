# Experiments to watch

Most changes here are **experiments, not rulings**: we try something, lightly held, watch it on a real store for a
few days, then keep, tune or revert it. This file is where each one is tracked so none is forgotten. (It began as
"Things to check after a few days", Mike's ask on 2026-10-11; renamed 2026-10-19, his ask, to say what it is.)

Each entry says what we're trying and why, what to look at and where, when, what result would change it, and how
to revert. When it's checked, write the date and what was seen, and move its row in the index to "Checked". The
reasons behind each experiment live in `docs/decisions.d/` fragments and `docs/IMPROVEMENTS.md`; this file is the
follow-through.

Read-only on the owner's store: open it with `sqlite3 "file:$HOME/.counterparts/store/counterparts.sqlite?mode=ro"`
or the CLI's read commands (`counterparts mechanisms --dir …`, `counterparts doctor --config …`,
`counterparts claims-era --dir …`). Anything heavier runs on a snapshot copy, never the live store.

**How to read by build (since 2026-10-22).** Split a number by the build that wrote the rows instead of by date.
Rows that carry JSON say it at write time: `memories.meta`, every event `payload` that is an object (`recall.decision`,
`dream.*`, `adapter.*`, …), `reflections.detail` and `dream_changes.detail` have `build` (the package version, or
`unknown`); rows written before the stamp have none (NULL). **The stamped field is authoritative**: read it wherever
a row has one. The build log in `meta` has `build.<version>.since` (the lived day that build first opened the store
for writing) and `build.<version>.settings` (tunables set from outside, `[]` on Mike's store), and `counterparts
doctor` prints the build running and the last three logged as its Builds line. Rows with no JSON column (edges,
`belief_support`, `core_events`) can only be joined to the log by lived day, and **that join is approximate**: the
old and the new build share the day one arrives (a row from that day could be either), and the log keeps one row
per version, so a downgrade to a build already logged adds no row and its days read as the newer build's. Trust the
day join only between arrival days, and only when no downgrade happened. For example, footnotes per turn by build:

```sql
SELECT json_extract(payload, '$.build') AS build, COUNT(*) AS turns,
       ROUND(AVG(json_extract(payload, '$.footnoteCount')), 2) AS footnotes_per_turn
FROM events WHERE name = 'recall.decision' GROUP BY build ORDER BY MIN(seq);
```

## Index (updated 2026-10-22)

**Open: being built, or live and waiting for a check**

| Experiment | Started | Check | Section / source |
|---|---|---|---|
| The wake as its reader read it (WK3): "shown earlier" only for a telling in this session's context, else the items by title and id (up to 5); the night's own line drops sentences the page or day's end already tell, and is a clause the second morning running; overdue is its own count with its oldest date; a handoff whose lead waits on the owner with nothing since sinks, and one past a week nothing refers to isn't listed; Elsewhere lines say when and what; "Last said" quotes a whole first sentence; "under way" never over a journaled dream; the head names the session | 0.3.53, 11-09 (WK3, #792) | ~7 lived days after install (dated reminder set at merge): a week of wakes read by a fresh session against the brief's six points (`~/counterparts-notes/2026-11-09-briefs/WK3-wake-feedback.md`), and the delivered size against ~8.6 KB | [below](#the-wake-as-its-reader-read-it-wk3) |
| What waits on the owner is raised, backs off, then parks (SO1 step 4, revised): an `asked` item is no longer one of Still open's lines; one item waiting on the owner is said per attended wake ("Waiting on <owner>, ask when it fits"), the most relevant to the folder's week first, a sunk WK3 handoff included; a turn a person started that touches one raises it after the recall block, with what it needs and how long it has waited; one raise per item per lived day store-wide; then 3/7/14 lived days (at session start at least a week), then parked | 0.3.53, 11-09 (SO1 step 4, #796) | **~7 lived days after install** (dated reminder set at merge): raises per day (`open.owner.raised`) by `via` (turn vs wake), distinct items raised, the `owed` step's p50 ms on `recall.decision`, answered (revised, closed or no longer `asked` after a raise) vs unanswered, items parked by backoff (`wake.owner.raised` chains at the last step), sunk handoffs raised, and items seen in more than one session a day (should be 0); a hand-read of a week of mentions for ones plainly irrelevant to their folder; baseline: ~/counterparts-notes/2026-11-09-briefs/1105-read.md (290 live open, 99 of them `asked`, every one in its folder's Still open each wake) | [below](#what-waits-on-the-owner-so1-step-4) |
| Mike's first real Codex week (CX2): the Codex host — wake with the reader frame, recall, Stop capture through the cursor, the end ask in the model's own voice, SessionEnd ~1 min after `/exit`, `about: me` kept as the model's own note, the stand-down inside Claude Code | the branch, from 2026-11-09 (CX2) | ~7 days of Codex use after Mike approves the hooks: Codex sessions in `counterparts log`, their spans and asks, `meta.host = 'codex'` rows, `readerSelf` rows, the plugin probe's log | [below](#mikes-first-real-codex-week-cx2) |
| The first real Windows user's install (W1): npm on native Windows, `connect`'s hook line (`node` by name, `/` paths, a `file:` loader) in Git Bash or PowerShell, the `.cmd`/`.ps1` launchers the postinstall rewrites, `claude.cmd` read for its target, a night | 0.3.52, 11-09 (W1, #787) | **no date**: read when we hear back from the first Windows user (the Reddit commenter who asked) | [below](#the-first-real-windows-users-install-w1) |
| A password named in a sentence is redacted (SX1): a `password` family takes the value after "password / passcode / PIN / pw … is / was / 's", or a bare value with a digit; the raw buffer crosses the same scan before it is written, local and hosted | 0.3.52, 11-09 (SX1, #788) | ~7 lived days after install (dated reminder set at merge): redactions by family, count only, from `gate.deposit`'s `secretFamilies` (`password` against the rest); any false positive reported or seen in a hand-read of `[REDACTED:password]` memories | [below](#a-password-named-in-a-sentence-is-redacted-sx1) |
| Recall's steps are timed (LT2 part 1): `recall.decision` carries `steps`, ms per step of the pass; doctor's `Recall steps` line gives the week's p50 per step | 0.3.52, 11-09 (LT2 part 1, #786) | ~3 lived days after install (dated reminder set at merge): per-step p50 by lived day, and which step grows; that read briefs the fix | [below](#recalls-steps-are-timed-lt2-part-1) |
| The page names what it sets down (PG1): a nightly page write names the lines it takes out (`setDown`, with a why), a sentence diff records any it didn't name as "set down, unnamed" (reworded or folded lines are kept), each set-down is a `me` memory tagged `set down`, the morning after's wake names up to 2 then "and N more", the night's writers are shown set-downs life touched since; `recall "set down"` | 0.3.53, 11-09 (PG1, #789) | ~7 lived days after install (dated reminder set at merge): set-downs per night, named vs unnamed (`self.page.set_down` rows), folded/reworded counts, any brought back (`self.page.brought_back`), a hand-read of the unnamed ones (folded or really gone? `tools/set-down-diff.ts` on the two page versions), and whether the wake line reads as context or as noise (Mike's call) | [below](#the-page-names-what-it-sets-down-pg1) |
| The page's stories (PS1): own-form stores' night writers are told the mix of story kinds and the selection test; day's end gives me/us memories a head start (0.05, order only); a work-only practice may be set down into a `kind: skill` memory its set-down names; on every store `remember` takes `story: true`, shown first to day's end | 0.3.53, 11-09 (PS1, #791) | ~10 nights after install (dated reminder set at merge): story kinds on the page (corrections vs the rest), nominations made and taken, craft lines moved and whether each was about the work; the owner and a fresh session read the page: does it read as someone growing? | [below](#the-pages-stories-ps1) |
| The night closes open items itself (SO1 step 1): the night's `close` phase closes an open release step ("0.3.46 ready", "0.3.47 after-publish") when a later memory in its folder says a higher patch was released; unsure ones are listed `mayBeDone` under `recall "still open"`, never asked; the wake names the closes | 0.3.52, 11-09 (SO1 step 1, #782) | ~3 lived days after install (dated reminder set at merge): closes per night, how many were reopened, the Still open total before and after; a dry run on the day-47 copy said 2 closes and 4 may-be-done; baseline: ~/counterparts-notes/2026-11-09-briefs/1105-read.md (290 live open, 16.2% new flagged open, 2 night closes in 11 nights) | [below](#the-night-closes-open-items-itself-so1-step-1) |
| A write lists the open items it may settle (SO1 step 1b): a stored `remember` or `session_end` entry that says a version or PR was done lists up to 3 open items from any folder with the same version series, the same PR (own project only) or a `settlesWhen` it reaches (`mayClose`); the model closes or leaves them | 0.3.52, 11-09 (SO1 step 1b, #783) | ~7 lived days after install (dated reminder set at merge): `open.close-hint.shown` rows and distinct ids listed against `open.close-hint.closed` rows (and how many with `daysAfter` 0), p50/max ms, a hand-read of 10 listed titles for plainly irrelevant ones; baseline on the 11-07 copy: 3 of 19 irrelevant plus 2 weak, before the fix round; baseline: ~/counterparts-notes/2026-11-09-briefs/1105-read.md (290 live open, 16.2% new flagged open, 2 night closes in 11 nights) | [below](#a-write-lists-the-open-items-it-may-settle-so1-step-1b) |
| Growth exits (FD1 step 2): per-turn event rows (`recall.decision`, `recall.credit`, `recall.rated`) keep 30 lived days, each day rolled into one latched `events.rolled` row first; doctor's Growth lines (memories, event log, cue pairs, dream queue; new and swept edges on Association) | 0.3.52, 11-09 (FD1 step 2, #776) | **a read-only copy of the store before the install** (RELEASING §5.1; MOD #3 and the H14 replay read it); then ~3 lived days after install (dated reminder set at merge): events MB and per-kind row counts from `Growth: event log`, one `events.rolled` row per swept day, `sleep.log.swept` deleted against remaining; the other Growth lines' first numbers written down | [below](#growth-exits-fd1-step-2) |
| Old chapters leave ambient recall (FD1 step 5): a chapter or frozen full copy whose latest chapter is 14+ lived days old (`LAST_HERE_LIFE_DAYS`) is no ambient footnote candidate, counted `journalAged`; `recall.decision` carries `journalCandidates`, `mcp.recall` carries `elapsedMs` | 0.3.52, 11-09 (FD1 step 5, #778) | ~1 week after install (dated reminder set at merge): chapter footnote ratings by age (<7, 7–13, 14+), `journalAged` per turn, the journal's share of the cut, meaning-mode `elapsedMs`. 7–13-day chapters still under ~0.3 and the slots going to better footnotes says move N to 7 | [below](#old-chapters-leave-ambient-recall-fd1-step-5) |
| A done memory is never overdue (SO1 step 2): `status: done` dated today or earlier is refused `done` by `prospective/`, so it leaves Coming up and the overdue count; `remember`/`session_end` store such a date as `occurredOn` | 0.3.52, 11-09 (SO1 step 2, #779) | ~3 lived days after install (dated reminder set at merge): the wake's overdue count, done-but-dated items in Coming up (should be 0), and whether any real reminder went missing; baseline: ~/counterparts-notes/2026-11-09-briefs/1105-read.md (290 live open, 16.2% new flagged open, 2 night closes in 11 nights) | [below](#a-done-memory-is-never-overdue-so1-step-2) |
| A newer routine work event fades the older one (FD1 step 3): the night's `interfere` phase settles an unsalient, never-used `about: work` status note `changed` (×0.5) under a newer one naming a later version in the same series, in the same folder | 0.3.52, 11-09 (FD1 step 3, #777) | ~3 lived days after install (dated reminder set at merge): interference fades per night against age prunes per night (`sleep.cycle` `interfered` vs `pruned`), and anything wrongly faded; a dry run on the day-47 copy said 67 the first night, then a few a night | [below](#a-newer-routine-work-event-fades-the-older-one-fd1-step-3) |
| The tail after a compaction is owed (CT1): what a session says after a compaction its record came before counts as unrecorded (the earliest such compaction), so even one line after a compaction is written up at night | 0.3.47, 2026-11-04 (CT1) | ~1 week after release (dated reminder set at merge): owed sessions with `compactionTail` > 0 on Mike's store, the write-ups they cost a night, and on the first live nights whether those tails were the person's own words or only task notifications / injected context (pieces carry no source tag: read the text on a snapshot); mostly plumbing says count the floor from the person's words | [below](#the-tail-after-a-compaction-is-owed-ct1) |
| Folder attribution (FS1): a dream files a work merge or gist under its sources' majority folder (a tie: the newest source's), a personal one under their shared folder or none; another folder's dated work is counted "in other folders", not "Due today"; folders are named by their name, by path only when two share one | 0.3.47, 2026-11-04 (FS1) | **no date**: the next developer week (tier 2), or a week of Mike's shaped wakes after release | [below](#folder-attribution-fs1) |
| Delete one memory from chat (HD1): `remember`'s `remove` holds it 24 h (hidden everywhere the deny-list is read), undo with `remove.undo`; the erase is the console's removal run by the worker (local) or hosted's ten-minute timer, as `self` | 0.3.47, 2026-11-04 (HD1) | ~2 weeks after release (dated reminder set at merge): holds placed, undone, erased; any erase that failed or ran late | [below](#due-2-weeks-after-chat-delete-hd1) |
| Hosted's backups let go of a chat-deleted memory "within about two days" (HD1): the 24 h hold, the timer's erase, then Litestream's 12 h snapshot retention plus its unstated enforcement lag | 0.3.47, 2026-11-04 (HD1); starts at the first hosted deploy with HD1 (hosted-live moves to the 0.3.47 merge) | **~48 h after the test erase** (dated reminder set at the deploy): on Mike's hosted account, hold and erase one throwaway memory with a unique word, then grep the R2 bucket's newest snapshot for that word. "About two days" goes on /privacy/ only once that passes | [below](#48-h-after-the-first-hosted-chat-delete-hd1-backups) |
| The first claude.ai chat of the day runs the night (HN1): its wake claims the day and says to run the night, then answer (or ask first, on `ask`) | 0.3.47, 2026-11-04 (HN1); hosted gets it when hosted-live moves to the 0.3.47 merge | ~1 week after the hosted deploy (dated reminder set at merge): nights started from a chat vs a routine, nights double-started, complaints | [below](#the-first-claudeai-chat-of-the-day-runs-the-night-hn1) |
| The wake knows yesterday's news (WF1): "Since the last night" (owner/us news since the last night, any open folder), a stale handoff steps down to one line, empty sections collapse, a dated item a newer done memory says happened settles; the wake's shape on for new stores | 0.3.46, 11-03 (#734) | **no date**: settles on a few days of real shaped wakes after release (Mike's store has had the shape on since 11-01) or the next new-user week, whichever comes first | [below](#the-wake-knows-yesterdays-news-wf1) |
| Starter memories (S1): a new store begins with 11 "told, not lived" memories (`core/told.ts`), lived first in recall, kept out of the night, the wake and the self | 0.3.46, 11-03 (#729, #733) | **no date**: settles when Mike runs his fresh-user test. A seeded new store's first week: were the seeds used, did they crowd anything out | [below](#when-mike-runs-his-fresh-user-test-starter-memories-s1) |
| Habituation's window is 14 lived days, not 7 (H14, `recall.HABITUATION_WINDOW_DAYS`) | 0.3.46, 11-03 (#707); it was to ship alone after R3S and doesn't: it rides with S1, WF1 and WP1, so its read splits by build and by the held set, not by the release | ~14 lived days after release (dated reminder set at merge): memories held then later opened, asked for or rated 2-3, plus the extra footnotes the 7-day arm would have shown, and held-set size; ROADMAP owns that read. Sooner if a ruling didn't come up or a memory rated 3 sits held | "Due ~14 lived days after the longer habituation window" below |
| The night's two holes (NT1): a watchdog counts time awake, and a headless session leaves the night to the next session a person starts | 0.3.45, 11-01 (#712) | ~1 week after release: a run spanning sleep, no catch-up stopped by a watchdog after one, which session started each night, any day with no night | "Due ~1 week after the night's two holes" below; dated reminder set at merge |
| Refused calls stay plumbing (TC1): a carried morning share is marked told as it is handed over (no `reflect` call asked of the session); a memory whose subject is our own refused call, a permission prompt or the session's limits keeps no date, open thread or me/us/owner mark (`meta.ownPlumbing`), and no wake line or prompt's ambient recall offers it | 0.3.47, 2026-11-04 (TC1) | a few nights after release (dated reminder set at merge): no dated or me/us/owner memory about a refused call or prompt, `ownPlumbing` rows and their titles, and no share stuck untold | "Due a few nights after refused calls stay plumbing" below |
| Write-ups skip plumbing (WP1): the host's line after a declined permission prompt and a hook's output enter no capture; every write-up is told permission prompts, refused tool calls and the system's own notices aren't events between the two | 0.3.46, 11-03 (#731) | a few nights after release (dated reminder set at merge): no write-up memory about a permission prompt or a refused tool, and the person's own words about one still kept | "Due a few nights after write-ups skip plumbing" below |
| Recall's gate rows get a live sweep: the sleep cycle's versions phase calls `pruneGateSessions`, rows unused for `retentionDays` (90 lived days) go (#728) | 0.3.46, 11-03 (#728) | **2026-11-08** (dated reminder): `sleep.gate.pruned` rows each night with count 0 on Mike's store (younger than 90 lived days; nothing goes until ~day 90), no `sleep.gate.failed`, and the versions phase's numbers unchanged | `docs/decisions.d/fix-prune-gate-sessions.md` (now in `docs/IMPROVEMENTS.md`); `src/core/recall/NOTES.md` §6 |
| Unmarked and work chapter summaries born at 0.25, not 0.4; me, us and owner keep 0.4 (F1), and the new log fields (near-miss ids, why a memory showed, wake sections at session start, kept ids, refused returns, the dream's cut) | 0.3.42, 10-30 (#696) | ~2 weeks after release (~2026-11-14): summaries in reach, what ratings say of them, the fields' bytes; ~9 lived weeks after: the first summaries let go | "Due ~2 weeks after summaries started lower" below |
| The night's own line (NL1): the reflection may send one or two sentences past the page, on its row, shown by `recall "last night"`, read by WK2 | 0.3.42, 10-30 (#693) | a week of real lines after release (~1 week): morals, page repeats, how often it's empty (read 11-07, 7 lines on 0.3.42–0.3.47: none NULL or refused, 141–202 B, no ids; repeats 2 of 7, lesson-shaped 2 of 7, at the bar; re-read ~11-14) | "Due a week after the night's own line" below; "Checked 2026-11-07" |
| The wake's shape (WK2): one composer behind `self.WAKE_SHAPE`, off | 0.3.43, 11-01 (#698), off by default; **on for Mike's store from 11-01** (he ran `counterparts wake-shape on`) | a few days of real wakes on his store: ROADMAP holds the read, reminder 11-04, no default change before it | [below](#the-wakes-shape-wk2) |
| The page in its own form (PF1): one store's nightly writers keep the page's sections and form instead of `HOW_I_WORK_RULE`, behind meta `self.page_form` | 0.3.44, 11-01 (#701), off; on for Mike's store: **[date, not yet]** | **2026-11-08**: Mike judges whether the counterpart reads more like someone; the page versions for stories cut for room and any rebuilt rules list. **Outcome:** kept, Mike 11-09; form held 8 nights; ~5 dropped lines accepted 11-07, made visible by PG1. | [below](#due-2026-11-08-the-page-in-its-own-form-pf1-roadmap-2026-11-01-an-experiment--meta-selfpage_form) |
| A closed folder's plain reminder is held back; a personal one is told whatever its folder | 0.3.43, 11-01 (#700) | ~2 weeks after release, or the first time one is held: did a real date go unsaid? | [below](#a-closed-folders-plain-reminder) |
| The wake's room (WK1): "Might be relevant" off, no bare ids, one "where this folder stands" block led by the newest handoff, up to 5 lines | 0.3.42, 10-30 (#687) | ~11-06: the next ~/random wake read, and a week of `self.briefing` trimmed counts | [below](#the-wakes-room-wk1) |
| The catch-up leaves out a session whose folder is now off, observer or paused (NC1) | 0.3.42, 10-30 (#689) | ~3 nights after release (~2026-11-03): no new write-ups from such folders; `coverage` and doctor's count agree; on folders still written up (read 11-03, on 0.3.42 from 10-31 02:40 UTC: holds, not exercised live — no session in a not-on folder since 10-26, 0 new write-ups from one, coverage and doctor agree on 1 owed; on a copy with ~/counterparts set off both readers drop it. Re-read the first time a folder with recent sessions goes off) | "Due ~3 nights after the catch-up respects a folder that is off" below |
| The day-summary gate reads only what day's end could have been handed: a row written that day about another day, or born after the summary was told, no longer holds it back; a summary held back leaves one `handoff.daysummary.held` row per date and cause | 0.3.42, 10-30 (#688) | ~1 week after release: rows by `what`/`why`, how many written summaries each morning's wake showed (read 11-07: 0 held rows ever, a summary every night; 15–23 of 21–28 wakes a day carry it, the day's first wake can't since the night runs after it; holds) | "Due ~1 week after release (the day-summary gate)" below; "Checked 2026-11-07"; `docs/decisions.d/fix-day-summary-held-1030.md` |
| The night doesn't read a folder that doesn't export (`dream/slices.ts`): day's end, the dream, the reflection and the tagging, and their recall; no merge or gist from one | 0.3.42, 10-30 (#688) | ~3 nights after release: writer runs' `omitted`, whether dream and reflection counts fall, nothing refused that should have landed (read 11-03, four nights on 0.3.42/0.3.45: holds, not exercised live — `omitted` 0, no hold or fence refusal, intake 55–63 fresh, closed set only 3 archived rows; on a copy with a work folder set off it closes 509 rows, day's end 35 → 28 entries, walk ≤ 346 ms. Re-read with NC1's trigger) | "Due ~3 nights after release (the night's fence)" below; `docs/decisions.d/fix-day-summary-held-1030.md` |
| Recall shows a late turn instead of dropping it; covering index on the word index; subjects compile only what the text may name | 0.3.42, 10-30 (#691) | ~1 week after release: late rate, recall p50, the hook's `ms` (read 11-03, partial, 3.7 days on 0.3.42–0.3.45: index took; `elapsedMs` p50 232 on 0.3.41 → 101–152, late 1 of 1,048, hook p50 155–220 ms, none over 5,000; daily p50 rising 98 → 158, a watch; finish ~11-07; read 11-07: quiet-hour p50 101 → 233 over the week, past ~200, unattributed; late turns 3–10% on 11-06's builds, all in that day's four load windows, machine not store; per-step split on the row proposed, Mike's call) | "Due ~1 week after recall stopped dropping late turns" below |
| Raw copies under the shared "mcp" and "console" ids go line by line on their own age: 3 days when nothing is owed, 14 whatever is | 0.3.45, 11-01 (#710, #715) | ~1 week after release: copies past the limit under either id (expect 0), lines deleted, doctor's Raw transcripts line | "Due ~1 week after the shared bucket went line by line" below |
| The claim comes after the mint: a memory that threw claims nothing, and a retry lands it | 0.3.45, 11-01 (#714) | ~2 weeks after release: `counterpart.deposit.mint.failed` in the log, retries that landed, any twins | [A failed mint](#a-failed-mint) |
| The per-turn worker's cost: the sidebar's file reads the words only; the reserve reads settled pairs once | 0.3.42, 10-30 (#685) | ~1 week after release: worker ms from the log (p50, p90, after-done share) (read 11-03, partial, 3.7 days: p50 4.9–7.8 s → 1.3–1.6 s, overlap minutes a day → 14–62 s, but after-done 64–66%, over the half bar — Mike's call; no worker ≥ 20 s overlaps a prompt now; finish ~11-07; read 11-07: p50 1.2–1.8 s all week, 2.4 on heavy 11-06; after-done 53–67%, still Mike's call; three long workers all the laptop asleep) | "Due ~1 week after the worker's cost" below |
| Head wins (#526): the newer memory stands in with the earlier one's bar (or its own); the earlier one is held back whenever a head stands in | 0.3.27, 10-19 | ~2 lived days after install: settled-over memories shown alone → ~0 | `docs/decisions.d/fix-head-wins-gap-1019.md` |
| Association: no links written when a memory is stored (`WRITE_LINK_MAX` 0, was 4); contiguity kept, old ones fade | 0.3.27, 10-19 (#528) | ~2 lived days after install: pointers and links per node from co-use alone; revert if the graph starves | `docs/decisions.d/chore-write-links-slot-flag-1019.md` |
| Slot detector flags only: no provisional fade (`SLOT_FADE` 1, was 0.8); the fade comes with the dream's or the writer's confirmation | 0.3.27, 10-19 (#528) | ~2 lived days after install: proposals' `faded: false`, the dream's same true/false, confirmed ones at the full fade | `docs/decisions.d/chore-write-links-slot-flag-1019.md` |
| The reflection closes open threads that are plainly done (`closeNow`, a why each, said in the share; `reopen` undoes), and still asks about the unsure ones | 0.3.28, 10-20 | ~10-24: how many it closed itself (`reflections.detail.selfClosed`, `reflection.finished`'s `selfClosed`) (any folder, by Mike's 10-20 exception) and how many it asked instead, reopened (`closeAskedInstead`; confidential ones too until 10-21), whether any was wrong (`detail.reopened`, `reflection.reopened`), how the wake's Still open count moves from 58; revert by putting back the 10-16 `close` line in the prompt | `docs/decisions.d/feat-reflection-closes-done-threads-1020.md` |
| Personal news flows across folders: the reflection is offered 24 unmarked memories a night (was 5), the personal-looking first, and marks the personal ones owner or us; the `about` field says what a mark does | 0.3.29, 10-21 | ~10-24: how many it marked owner/us, any Mike reverses, whether personal news reaches other folders | "Due ~2026-10-24 (personal news across folders)" below; `docs/decisions.d/feat-unmarked-personal-marks-1020.md` |
| The nightly writers held to the page's 4,600-byte room: the night's first page past it is sent back to be cut; a second try is kept; one never sent again is kept at the run's end. A page past the room with a short version shows it in the wake | 0.3.28, 10-20 | ~10-23 (three mornings after install): the page's bytes each morning, `past-room` holds and how each night ended, the wake's `elements=` and the page's rung | "Due ~2026-10-23 (the nightly writers held…)" below; `docs/decisions.d/feat-page-held-to-room-1020.md` |
| Meaning computed in line whenever no fresh cue is ready (#521) | 0.3.27, 10-19 | ~2 lived days after install: share of turns `in-line`, footnote ratings (from the build carrying `SEMANTIC_THIS_TURN`, `in-line` is ~every turn by design: read this one on earlier builds only) | `docs/decisions.d/fix-first-prompt-meaning-1019.md` |
| Wake polish (#517) + the ~/random session's 10-19 notes (one session named four times, a today-dated item under Still open in another folder's wake, three tags at the top) | 0.3.26, 10-18 | ~10-20 | "Due ~2026-10-20" below |
| Wake without repeats (fix/wake-dedupe-1020): each episode once, no bare ids in Yesterday, ONE tag at the top, about-me line says its folder first, a plain reminder due tomorrow counted at a session start, every Coming up item with its own id, one snapshot a day | 0.3.28, 10-20 | the first two mornings after install | "Due ~2 mornings after install (the wake without repeats)" below; `docs/decisions.d/fix-wake-dedupe-1020.md` |
| A weekly reminder done for this week (`status: "done"` at its id closes this occurrence only; F6b: drewOn credits a memory this session replaced) | 0.3.28, 10-20 | ~10-27, the next Tuesday | "Due ~2026-10-27" below; `docs/decisions.d/feat-reminder-done-this-week.md` |
| The elsewhere lines name what was written: "Today, elsewhere" and "Since you started" carry up to two memory titles a folder (work in progress first), gated like the chapters, and "Here, also open:" the other live sessions in this folder with theirs, within the same 300 bytes | 0.3.28, 10-20 | ~10-23 | "Due ~2026-10-23 (the elsewhere lines' titles)" below; `docs/decisions.d/feat-elsewhere-titles-1020.md` |
| Facts title tail (the next 20 matches as title · id · date lines after the 10 bodies; credits nothing) + soft time words ("lately" ranks recent first, doesn't filter); from the benchmark loss read | 0.3.28, 10-20 | ~10-27 on the live store: how often a tail title gets opened, whether the tail is noise | "Due ~2026-10-27 (the facts title tail …)" below; `docs/decisions.d/feat-facts-title-tail-1020.md` |
| Core questions that waited a week: the reflection is offered up to 3 core memories waiting 7+ lived days on keep-or-retire (with their unsettled pair) and decides where it can, said in the share with the way back; the wake leads with one, both labels shown | 0.3.28, 10-20 | ~10-27 | "Due ~2026-10-27 (core questions)" below; `docs/decisions.d/feat-core-questions-waited-1020.md` |
| Another project's work faces a slightly higher bar in ambient recall (`CROSS_PROJECT_BAR_LIFT` 1.25; the hard filter `RECALL_BY_PROJECT` built, off) | 0.3.31, 10-22 (Mike's "a slightly higher bar, and review after a week") | ~2026-10-29: footnote ratings home vs crossing, ~/counterparts ↔ ~/random apart; `crossProjectLifted` per turn | "Due ~2026-10-29 (a higher bar for another project's work)" below |
| Beliefs shown (wave 2 lane E): the beliefs slot in ambient recall (`recall.BELIEFS_IN_RECALL`), tags as a priming partner source — **priming changed again** (`recall.TAGS_PRIME`), the wake's project line (`self.WAKE_PROJECT_LINE`); plus per-footnote priming flags (`primed.by`, `top`, `tag`) | 0.3.32, 10-22 | ~2026-10-29, with the cross-project bar and the re-read of the four 0.3.27 experiments (read 10-29: slot and tag priming kept); **the beliefs slot's own read: when 3+ beliefs about other people pass the 0.3 floor** (beliefs about me or us are page-only by design, so it has only ever shown one belief) | "Due ~2026-10-29 (beliefs shown, and priming changed again)" below |
| Open threads mean someone owes an answer: the narrower `unresolved` text and Stop ask, the Stop ask naming the session's own open items (`STOP_OPEN_MAX` 5), and an untouched ownerless open item no longer carried after `OPEN_CARRY_DAYS` (21; 14 once P2 #674 ships, and a one-off date past its grace no longer exempt — read a check after that release against 14) lived days — out of Still open, its count and `staleOpen`; the share says the count once | 0.3.32, 10-22 | first look ~2026-10-29; the real check 2026-11-05 | "Due ~2026-10-29 (open threads mean someone owes an answer)" below; `docs/decisions.d/feat-open-threads-carry-1022.md` |
| The dream's fresh intake: the fresh list may cost 16,000 characters (`dream.FRESH_LIST_CHARS`, was 12,000), 4 neighbours a new memory (`dream.NEIGHBOURS`, was 6); 44 → ~64 new memories a night on the 10-22 compare | 0.3.33, 10-23 | ~2026-10-29: `dream.begun` queue fresh/waiting/agedOut by build; whether dreams got thinner (whole 20 → 11) (read 10-29: fresh took, dreams a little thinner, re-check 11-02; read 11-02: fresh 55–63 a night on 0.3.39–0.3.45, links/gists/journal back to the 0.3.32 level a night, not thinner; kept, intake closed. Queue 704 → 1,389 since 10-24: Mike's call) | "Due ~2026-10-29 (the dream's fresh intake)" below; `docs/decisions.d/feat-dream-intake-1023.md` |
| The page split by section (`self.PAGE_SPLIT`, N1 part 2): the page writer in its own child first, amending every section but `## Core`; the reflection writes `## Core` alone; kept sentences keep their cites | 0.3.34, 10-23 | 3–4 nights after install | "Due 3–4 nights after the page split" below |
| Day's end (the page writer, renamed) reads the day as told: the chapters by their summaries and the 12 strongest memories with ids, citing them (`self.DAYS_END_INPUT`); the reflection's room long view first, `dreamSaw` cut to what the dream changed and 40 older (`dream.REFLECT_ROOM_ORDER`) | 0.3.34, 10-23 | 3–4 nights after install | "Due 3–4 nights after day's end" below; `docs/decisions.d/feat-days-end-reflection-room-1023.md` |
| The reflection's core candidates capped at 30 a night, 10 of them rotated through the rest, the rest counted in one line (`REFLECT_TUNABLES.CANDIDATES`, switch `dream.REFLECT_CANDIDATES_CAP`); the per-lane shown counts kept on the reflection's row (`detail.lanes`), which with `chaptersAs` now survive the finish | 0.3.35, 10-24 | 3–4 nights after install, with day's end's check | "Due 3–4 nights after the candidates' cap" below; `docs/decisions.d/feat-reflect-candidates-cap-1024.md` |
| Use credit refuses the memory's writing session on its birth day (`own-write`), not everyone: another session's use credits a newborn memory once that day; unknown/unbound writers keep the birth-day rule (switch `physics.OWN_WRITE_GATE`) | 0.3.35, 10-24 (R2) | ~7 nights after install: promotions and core growth (read 11-01: 239 birth-day credits from other sessions, none promoted; kept) | "Due ~7 nights after own-write" below; `docs/decisions.d/fix-own-write-not-birth-day.md` |
| Consolidation every lived day (`sleep` `CADENCE.consolidate` 1, was 3): the core is decided at every night's sleep, still at most 3 a night (`CORE_MAX_PER_SLEEP`); read with 0.3.35's R2 (own-write), since both feed the core | 0.3.36, 10-24 | ~7 nights after install (read 11-01: ran nightly, 1 promotion in 8 nights, core 16; kept) | "Due ~7 nights after daily consolidation" below; `docs/decisions.d/feat-daily-consolidation.md` |
| Cue learning (R3, store v15 `cue_edges`): the words of a turn that showed a memory, which was then used or rated, wire to it, and a learned pair reads as one more cue (`w × share × CUE_PAIR_UNITS`); switch `physics.CUE_LEARNING` | 0.3.36, 10-24 | ~7 lived days after install (read 11-01: 3,268 pairs, ~10× expected; common and acknowledgement words wired — Mike's call) | "Due ~7 lived days after cue learning" below; `docs/decisions.d/feat-cue-learning.md` |
| "Today so far here" in a session start's wake (this folder's earlier chapters today, with their summaries; `self.TODAY_SO_FAR`) and the Yesterday line led by day's end's summary behind a privacy gate (`self.YESTERDAY_FROM_SUMMARY`) | 0.3.36, 10-24 (W1, W1b); its fixes Y1, Y2 in 0.3.37 | ~5 days after install: mid-day wakes in two folders | "Due ~5 days after Today so far" below; `docs/decisions.d/feat-today-so-far.md` |
| An awake repeat counts (B1): a belief written in the moment that says what one already says is still refused `near-duplicate`, and its memory is filed as support for that belief, at most once per belief per session (unbound: once a lived day); events `schema.support.filed` with `via: awake-duplicate`; switch `schemas.AWAKE_SUPPORT_ON_DUPLICATE` | 0.3.36, 10-24 | 3–5 days after the release that carries it (read 11-01: never fired, 0 rows — re-read when awake beliefs are written) | "Due 3–5 days after awake belief support" below; `docs/decisions.d/feat-awake-belief-support.md` |
| An unsettled pair competes (E3): when a turn reaches both members, the older counts at `1 − k·sim·fresh` (k 0.6, cosine over 0.8, 7 lived days) for the loud tier and the order, never admission; the label stays; switch `recall.UNSETTLED_COMPETES` | 0.3.36, 10-24 | ~7 lived days after install (read 11-01: fired 1 of 2,317 turns, no cost side; kept) | "Due ~7 lived days after unsettled competition" below; `docs/decisions.d/feat-unsettled-competes.md` |
| The unmarked offer on the record (D1, a fix): every reflection row says what it was offered to mark (`detail.unmarked`, an empty list too) and which it marked (`detail.unmarkedMarked`, `counts.unmarkedOffered`/`unmarkedMarked`); the offer keeps its lines when the fixed parts fill the room (with `dream.REFLECT_ROOM_ORDER`) | 0.3.36, 10-24 | 3 nights after install | "Due 3 nights after the unmarked offer's record" below |
| The core door is one support arc (E2, `physics.CORE_DOOR_SUPPORT`), **in shadow** (Mike's yes 10-24 20:59): the two lanes still decide; beside them the support door (real uses, its slot's re-encodings, reflection citations echoed by a later use, at `CORE_SUPPORT_LINE` 0.1005 over its lived days; glimpses count nothing) records `promotion.shadow` rows (`wouldPromote` / `wouldHold`) and a `promotion.shadow.sleep` row a night | 0.3.36, 10-24; retired in 0.3.44 (#705) | a week of 0.3.36 shadow rows, then Mike decides on, off or tune (read 11-01: lanes 1, door 5 over 7 nights. Mike 11-01: shadow retired, switch off, code left inert; reflection-alone admission stays (09-27 ruling); no promotions or demotions; undo = one switch; closed) | "Due a week after the support door's shadow" below; `docs/decisions.d/feat-core-door-support.md` |
| Wake polish 10-25 (random-5b's wake): a "Last night:" line (`self.NIGHT_LINE`), "Still open"'s tail one calm count with no ids, "quiet since HH:MM" for a session idle two hours (`ELSEWHERE_QUIET_MS`), a handoff's staleness in two clauses | 0.3.37, 10-25 | ~3 mornings after install | "Due ~3 mornings after the wake polish of 10-25" below |
| A `still open` recall handle that lists what "Still open" carries (and the facts questions asking for that list), named in the wake's tail (O1); before the day's run the night line names the latest finished night, dated (L1) | 0.3.37, 10-25 | ~3 mornings after install | "Due ~3 mornings after the still open handle and the dated night" below |
| Ambient recall's meaning reads THIS turn (S1): every ambient turn embeds its own prompt and ranks it in line, fresh lag row or not, on the `inline` calibration; past the in-line count guard the worker's fresh lag row is used, recorded `lagged`; switch `recall.SEMANTIC_THIS_TURN` | 0.3.37, 10-25 | ~1 week after install (~2026-11-01): footnote ratings and items shown per Mike-typed turn vs 10-22..24; short-prompt complaints (read 11-01: person-turn noise 42% / useful 17%, past the range — trigger met. Not attributable: the 10-22..25 baseline was a low outlier; the turn-1 control shows the 10-26 step isn't S1 (ROADMAP's S1-review.md, ~/counterparts-notes/). Mike 11-01: S1 stays on, no off-test; closed) | "Due ~1 week after this-turn meaning" below; `docs/decisions.d/feat-this-turn-meaning.md` |
| What stopped a memory, counted (N1, observation only): `recall.decision` carries `habituationCut`, `nearMiss {margin 0.1, count}`, `capped`, `budgetTrimmed`, `inhibited` beside the echo/project skips; `adapter.recall` the same flat (the near miss as `nearMissCount`), with `turn` and `startedBy` (`person`/`host`/`unattended`); switch `recall.STOP_COUNTS` | 0.3.37, 10-25 | a week after install: what stopped memories on the turns a person typed, by day (read 11-01: near miss 0.92, cross lift 0.56 per person turn; kept) | "Due a week after the stop counts" below; `src/core/recall/NOTES.md` "N1" |
| The day summary (`self.DAY_SUMMARY`): day's end leaves a few lines about the day on the night's row; the dream opens with it, the reflection sees 21 days as a line a day | 0.3.34, 10-23 | 7 nights after install | "Due 7 nights after the day summary" below; `docs/decisions.d/feat-day-summary-1023.md` |
| What a night costs (`usage` on `dream.night`, per child and total), to read the Haiku tag child's real tokens | 0.3.34, 10-23 | ~2026-10-27 (reminder mem_8f7e7db449bb) | "Due ~2026-10-27 (what the tag child costs)" below; `docs/decisions.d/feat-night-usage-debug-1023.md` |
| Emotion's weight (about ×11 slower fading at a strong feeling vs ×2.8 designed), kept to watch | 10-18 | lived day ~120 (~2027-01-19) on Mike's store, or the first new-user store at day 60–90 (read 11-01 by random-54, challenged by ROADMAP: keep EMO_Q 0.5, too early to call harmless; trip-wire below) | "Checked 2026-10-18" and "Checked 2026-11-01" below |
| Mood-matched recall re-test, once drewOn gives a signal | 10-11 | when credit flows (after the feedback loop) | "Once drewOn gives a signal" below |
| Forgetting: archiving resumes after 0.3.24 restarted the 14-lived-day wait | 10-14 | ~late October | "Ongoing" below |
| S2: short sessions written up (an ended session with no record of its own is owed from one piece; owed write-ups count as new for the night; "Last here" names a later chapterless session) | 0.3.38, 10-28 | ~3 nights after install: owed rows a day, catch-up parts and `left`, doctor's unpointed/lost counts | "Due ~3 nights after S2" below; `docs/decisions.d/feat-short-sessions-written-up.md` |
| P2: open items untouched 14 lived days are parked (the 10-22 carry rule at 14, was 21): out of Still open and its count, `· N parked` on its count line, listed last and marked by `recall "still open"`; never a date still to come (ahead, in its grace week, repeating), `asked` or `settlesWhen` item; doctor's Open items line | 0.3.40, 10-29 (#674, #675) | ~3 mornings after install: doctor's open/carried/parked, the first night's share count (every item 14–20 days untouched counts as newly parked once), whether a parked thread Mike still wanted came back by a touch or had to be found | `docs/decisions.d/feat-p2-park-old-threads.md` |
| PP1: a memory whose text names another's id brings it along (`See also:`, one per shown memory, two a turn); used, it gets the turn's cue credit (the ping/pong fix) | 0.3.41, 10-30 (#681) | ~3 lived days after install: see-also'd footnotes rated at least as well as plain ones; the ping demo holds on the live store (read 11-02: 9 see-also'd of 748 footnotes on 0.3.41–0.3.43, mean 0.62 / 50% zero against plain 0.84 / 39% — bar not met, n 8 too few to act; kept on, re-check ~11-09. Bare "ping" shows the 10-27 fold, FI1's cause; a rated-1 see-also of the rule wired no `ping` pair, under `CUE_FLOOR` — Mike's call) | "Due ~3 lived days after see-also from named ids" below; `docs/decisions.d/feat-see-also-named-ids.md` |
| FI1: a fold or merge keeps the ids its sources named (a last `Names:` line, at most 4 named in all); see-also doesn't bring a memory the folder setting has closed | 0.3.42, 10-30 (#697) | ~2026-11-06: a NEW fold keeps its sources' named ids and they come through as see-also. NOT the bare "ping" on the live store: that fold keeps no id, and the check fails before and after | "Due ~2026-11-06: folds keep named ids" below; `docs/decisions.d/feat-fi1-folds-keep-named-ids.md` |
| K1 (the 10-29 read): context priming's train share 0 (`recall.PRIME_TRAIN_SHARE`, was 0.5): the train scores nothing, the row says `primed.train: false`; link and tag priming unchanged | 0.3.41, 10-30 (#680) | ~2 weeks after the release that carries it (~2026-11-13): footnote noise/useful by build, the link-lifted and tag-lifted groups, shown per person turn | "Due ~2 weeks after the 10-29 knobs" below; `docs/decisions.d/chore-read-1029-knobs.md` |
| K1: the night's kinds ask covers 30 cards (`schemas.TAGS_KINDS_PER_NIGHT`, was 10) | 0.3.41, 10-30 (#680) | ~2 weeks after the release (~2026-11-13): kindless live cards (144 of 207 on 10-29) falling, not growing; the tags child's read size and whether it timed out | "Due ~2 weeks after the 10-29 knobs" below |
| K1: the wake's project line writes `self.project.line`, one row per wake in a project's folder (shown, why not, bytes, ids) | 0.3.41, 10-30 (#680) | ~2 weeks after the release (~2026-11-13): how often it shows, why not when not, and ratings of what it showed; then keep or retire the line | "Due ~2 weeks after the 10-29 knobs" below |
| K1 finding: the beliefs slot shows one belief because 4 of 6 held are about me or us (the self subject is never offered) and the fifth is under the 0.3 floor; no change | 10-29 | when 3+ beliefs about other people pass the 0.3 floor, with the beliefs slot's own read: did they show, and how were they rated? | "Due ~2 weeks after the 10-29 knobs" below; `src/core/recall/NOTES.md` |
| R3S: a stop-list for learned cue words (`associate.CUE_STOP_LIST`: path fragments, hex ids, acknowledgements): they learn nothing from now on, and pairs they learned before are ignored when read, rows untouched | 0.3.45, 11-01 (#706), not on its own as first planned: it ships with #710, #712 and #714, so its effect is read by replay | ~7 lived days after install: new pairs a week, the stop-listed share of cue deltas (`cueStopped`), footnote noise against the 11-01 read | "Due ~7 lived days after the cue stop-list" below; `docs/IMPROVEMENTS.md` |
| Each item shows where it can be acted on (SO1 step 3): another folder's work plain reminder is said in its own folder (and joined ones), not told or shown whole elsewhere; personal ones (me, us, owner) still cross; a work reminder unsaid because its folder had no session crosses once, 2 lived days past its day; an open thread marked world stays in its folder | 0.3.52, 11-09 (SO1 step 3, #780) | **~3 lived days after install** (dated reminder set at merge): items shown outside their folder per day, by class; should be ~0 apart from personal ones; baseline: ~/counterparts-notes/2026-11-09-briefs/1105-read.md (290 live open, 16.2% new flagged open, 2 night closes in 11 nights) | [below](#each-item-shows-where-it-can-be-acted-on-so1-step-3) |

**Two follow-ups from the 10-19 overdue checks** (`~/counterparts-notes/2026-10-19-overdue-checks.md`)

| Change | Why | When |
|---|---|---|
| Head wins: hold back a settled-over memory whenever its head was brought in for it (gate.ts ~L452) | 36 footnotes since 10-12 showed an earlier memory while its head didn't (21 ids) | done: #526 |
| Slot detector: a proposal flags only, no provisional fade until the dream confirms | 4 of 7 right by hand-read, under the ~3-in-4 bar; the dream said "not the same" on 3 of 4; raising SLOT_COSINE doesn't separate them | done: #528 (`SLOT_FADE` 1), in 0.3.27 |

**Checked** (kept below for the record): **10-22 the four 0.3.27 reads** (feedback loop builders 1 and 2, stemming, context priming: nothing reverted; two asks for Mike; all re-read ~10-29 with the cross-project bar, see "Checked 2026-10-22" below and `~/counterparts-notes/2026-10-22-0327-read.md`); 10-12 first new-curve pass; 10-14 check-in; 10-18 wake trims, exit at 7
vs 14 days, Group 4 association; **10-19 the five overdue ones**: catch-up cost (1.75x the estimate, caps fine),
reflection/dream child context (peak 127.5k of ~150k, creeping up from 114k: watch), verbatim trial (keep; barely
exercised), Group 2/2b (fine, except head wins and the slot detector above), ongoing (head wins as above; the era's
effect on archives folds into the late-October forgetting check). Details: `~/counterparts-notes/2026-10-19-overdue-checks.md`.

## The first real Windows user's install (W1)

W1 (2026-11-09) made the npm install work on native Windows, proven in CI only (`.github/workflows/windows.yml`, the
npm door on windows-latest and in WSL). Nobody has used it on their own Windows machine. **Read when we hear back** from
the first real Windows user (the Reddit commenter who asked "It doesn't work for Windows?").

What to ask or look at: did `npm install -g counterparts@latest` then `counterparts` work from their shell (PowerShell,
cmd or Git Bash)? Did `counterparts connect` register the memory tools (`claude mcp list` shows counterparts
connected), and with which Claude Code install (native installer or npm)? Is Git for Windows installed (the hooks then
run in Git Bash, else PowerShell)? Did the first session wake, did recall answer, did a night run the next day
(`counterparts night`)? Any console window flashing up, any `counterparts doctor` amber or red that only Windows has?

What would change it: a hook line one of the shells can't run (then pin `"shell"` on the hook, or write the exec form);
a Node not on PATH by name (then the absolute path, which only Git Bash runs); a launcher still running `/bin/sh` (the
postinstall didn't run). Revert: none needed; Windows was unsupported before.

## Mike's first real Codex week (CX2)

CX2 (2026-11-09) connects OpenAI's Codex (`counterparts connect --host codex`): four hooks in `$CODEX_HOME/hooks.json`,
the MCP server in `config.toml` launched `--host codex`. Codex's model reads the memory as the counterpart's, not as
itself (Mike's option 2). Proven hermetically on a fixture rollout shaped like the 11-09 probe's; nobody has used it for
a week. **Read after ~7 days of Mike's Codex use**, counted from when he approves the hooks in `/hooks`.

What to look at, read-only:

- **The hooks fire and are approved:** `counterparts doctor`'s Codex hooks line green; `counterparts log` shows
  `codex-hook:*` processes for each event, and `inside-claude-code` only for a Codex that Claude Code started.
- **Capture:** Codex sessions' spans (`counterparts coverage`), and no `<hook_prompt` or wake text in them.
- **The ask was answered as the model:** `SELECT id, model, json_extract(meta,'$.host') FROM memories WHERE
  json_extract(meta,'$.host') = 'codex' ORDER BY created_at DESC LIMIT 20;` — written, in the model's own voice.
- **`me` stayed out of identity:** `SELECT id, about, json_extract(meta,'$.readerSelf') FROM memories WHERE
  json_extract(meta,'$.readerSelf') IS NOT NULL;` — every `about` NULL, none promoted, none a belief's support.
- **SessionEnd** arrives about a minute after `/exit` (the app-server daemon) and stands no worse than the last Stop.
- **The plugin stand-down:** run `tools/codex-standdown-probe.sh` once as its header says, with codex-plugin-cc, and
  read which signal held (environment or originator). If neither, the stand-down needs another signal.
- **The wake's frame:** does the model say it is reading the counterpart's memory, and not speak as it?

What would change it: a wake that spills to a file (raise `CODEX_CONTEXT_LIMIT_TOKENS`); a model that still speaks as
the counterpart (strengthen the frame); `us` from Codex read the wrong way (the open question in
`codex/INTERFACE-GAPS.md`). Revert: `counterparts disconnect --host codex`.

## A password named in a sentence is redacted (SX1)

SX1 (2026-11-09, finding from a page review: a password said in a sentence was kept word for word in a memory and in
the raw buffer). The gate gained a `password` family (`encode/secrets.ts`, NOTES 21) that takes the value only and keeps
the sentence, and `remember/spans.ts` runs the same scan on every turn and note before it is appended (injected by
`Counterpart`). Hosted invites start the same week, on the same core.

- **Redactions by family, count only.** Memory-side, every write's `gate.deposit` row carries `secretFamilies`
  (family, count, site; never the value). On a snapshot copy or read-only:

  ```sql
  SELECT json_extract(f.value, '$.family') AS family, SUM(json_extract(f.value, '$.count')) AS redactions,
         COUNT(DISTINCT events.seq) AS writes
  FROM events, json_each(json_extract(payload, '$.secretFamilies')) AS f
  WHERE name = 'gate.deposit' AND day >= <the install's lived day>
  GROUP BY family ORDER BY redactions DESC;
  ```

  The raw buffer's own count (`remember.span.redacted`) is in the event ring only, not the store; a turn's raw
  redactions show up memory-side when that turn is written up.
- **False positives.** Any report, and a hand-read of the memories holding `[REDACTED:password]`
  (`counterparts recall` for "password", read-only): is the redacted word a password, or a word of the sentence the
  stop list missed? Each miss is a word for `PROSE_STOP` or a test row; a pattern of them is a reason to narrow.
- **Misses.** A password said in a phrasing the family doesn't take ("the code to get in is …", a password with no
  name near it) stays: not every secret has a shape, and the docs say so.

Revert: remove the two `password` entries from `SECRET_FAMILIES` (the raw-buffer scan stays: it is the same gate).

## Recall's steps are timed (LT2 part 1)

LT2 part 1 (2026-11-09, Mike's yes 11-07; measurement only, `recall.STEP_TIMING`). The 11-07 read had recall's p50
at 87 ms on lived day 40 and 206 ms on day 46 (typed turns; host turns 104 to 302), candidates flat at ~370, so the
growth is in a step nobody timed. Each `recall.decision` row now carries `steps`: ms per step, in the pass's order
(`core/recall/steps.ts#STEP_NAMES`, what each covers in recall NOTES, LT2). `arrivals` through `compose` run before
the build and `record` after it, outside `elapsedMs`; the rest tile the build.

- **Per-step p50, by lived day.** `counterparts doctor`'s `Recall steps` line gives the week's p50 per step, largest
  first (`--json`: `p50.<step>`). By day, on a snapshot copy or read-only:

  ```sql
  SELECT day, key AS step, COUNT(*) AS turns,
         ROUND(AVG(value), 2) AS mean_ms, MAX(value) AS max_ms
  FROM events, json_each(json_extract(payload, '$.steps'))
  WHERE name = 'recall.decision' AND json_extract(payload, '$.steps') IS NOT NULL
  GROUP BY day, step ORDER BY step, day;
  ```

  (For a p50 by day, pull `day, key, value` and take the median per pair; sqlite has no median.)
- **Which step grows.** Compare the first and the last lived day with steps: the step whose p50 rises with the days
  while the turn's candidates stay flat is the one. The suspects named in the brief: `settledOver` (settled pairs),
  `learned` (cue pairs), `spread` (edges), `competing`, `gateLoad`, `habituation`, and `embed` (box 3's size). Check
  too whether `rest` stays small; if it grows, a step is missing a name.
- **Typed against host.** Join to `adapter.recall` on session and turn (`startedBy`) to split the p50 by who started
  the turn: LT2 part 2 (a cheaper host-turn path) is briefed on that split.

That read briefs the fix for whichever step grows. Revert: `recall.STEP_TIMING=false` (the key leaves the row;
nothing else moves).

## The wake as its reader read it (WK3)

WK3 (2026-11-09, from a counterpart's own feedback on five mornings of its wake; Mike agreed the same day; lightly
held), `core/counterpart-wake-shape.ts`, `dream/night-line.ts`, `handoff/last-exchange.ts`, `adapters/lifecycle.ts`.
Only the shaped wake (`self.WAKE_SHAPE`) changes, but for "Last said", the night line and the head's session field,
which every road carries.

- **The read.** A fresh session, given the week's wakes (`adapter.wake.injected` rows say when; the text is in the
  host's transcripts), checks each point: does any "shown earlier" appear outside a re-delivery to the same session?
  Is any moment told twice in one wake (page, day's end, the night's own line)? The same own line two mornings at
  full weight? Overdue items behind the door with no count? A handoff leading whose lead waits on Mike with nothing
  since? A listed handoff older than a week? An Elsewhere line without an age or a what? A "Last said" cut without
  "…"? "under way" after the dream journaled? A wake without `session=` in its head?
- **Size.** The brief's ~8.6 KB: `adapter.wake.injected`'s bytes by day, before and after install. On an invented
  morning (a 4.4 KB page) the wake went from 5,681 to 5,761 bytes: the session field (~45), the told reminders by title
  in place of one fold line, and the overdue words.
- **What rides on SO1 step 4.** The backoff for items waiting on Mike (3/7/14 days, then parked; at most one session-start
  mention a week; the shared day latch) is not here: it is [SO1 step 4](#what-waits-on-the-owner-so1-step-4), which
  says a sunk handoff as its weekly mention. `waitsOnOwner` is the seam: it reads the lead's `asked` ids and its words.

Revert: each piece is local. The fold rule is `shownEarlier`/`retold` in `shapedDelivery`; the own line's filter is
`ownToldOnce`; the overdue clause is `lateWords`; the handoff order is `handoffsTold`; the quote is `quoteOf`; the night
line's journaled branch is the first `if` in `nightLine`; the head field is `own` in `Lifecycle#composeWake`.

## What waits on the owner (SO1 step 4)

SO1 step 4, revised (Mike 11-07 12:04, lightly held; coordinator's 11-09 note on sunk handoffs), `core/owner-waits.ts`
and `owedOne` in `core/counterpart-wake-shape.ts`. Only the shaped wake changes. No store-format change: meta
`wake.owner.raised` and the `open.owner.raised` event.

- **The read.** From the live store after a week: `SELECT day, count(*), count(DISTINCT ref) FROM events WHERE name =
  'open.owner.raised' GROUP BY day`; for each raised id, was it revised, closed, or no longer `asked` after its last
  raise (answered), or not (unanswered)? Chains in `wake.owner.raised` with three days and the last 14+ lived days
  back are parked by backoff; `kind: "handoff"` ones are sunk handoffs raised. Then, from `adapter.wake.injected` and
  the host transcripts: was any item said in two sessions on the same day (should be 0), and was any said in a folder
  not its own (only personal ones may)? Hand-read the week's mentions: is the first one plausibly what the folder was
  working on?
- **Against the baseline.** The 11-05 read (`~/counterparts-notes/2026-11-09-briefs/1105-read.md`): 290 live open, 99
  `asked`, every `asked` item in its folder's Still open each wake. After: Still open shorter by the folder's `asked`
  items, one "Waiting on" line a wake at most.
- **The turn lane.** Raises by `via: "turn"` against `via: "wake"`; for a hand-read of ten turn raises, did the turn
  really touch the item (the bar: two shared words each weighing `OWNER_TURN_WORD_FLOOR` at recall's cue weight, one
  of them a subject word, `OWNER_TURN_SUBJECT` or not in the embedder's word table,
  together `OWNER_TURN_WEIGHT`)? The `owed` step's p50 on `recall.decision.steps`: on a copy of the owner's store
  (11-09, day 49), through the hook, ~3.2 ms p50 on a cached turn, ~45 ms on the folder's first turn after a wake
  or a write that changes an asked item (one build), ~200 ms when that first build meets a cold page cache.
- **What to decide then.** Whether the week floor at session start is right (there the steps read 7, 7, 14; the
  3-day step is the turn lane's); whether per-item weekly is too much with ~99 items (each wake may carry a
  different one); whether true blockers still sink (point 4, deferred 11-09: then an explicit field, batched with the next store-format change).

Revert: the filter `x.r?.status !== "asked"` and `owe` in `openSec`, `ownerParked` passed to `Self#stillOpen` (two
callers), and `attended` in `Lifecycle#recallTurn` (the turn lane). The record and events are inert once nothing reads them.

## The page names what it sets down (PG1)

PG1 (2026-11-09, Mike's decision 11-07 on the Fable fresh-eyes review, batch 1; lightly held), `core/self/set-down.ts`.
The page sits at its 4,600-byte room every night, so every new line pushes an old one out, and until this nobody could
tell a line folded into a story from a line gone. The room and the page's form are unchanged. A nightly write (day's
end's `self_page`, the reflection's `page`) accounts for every sentence it removes or changes (`setDown: [{line,
why}]`, the why saying "reworded", "folded into …", or why it's set down). The account is trusted. The door diffs the
page before and after by sentence: a sentence gone word for word and left out of the account is kept when it's
still there (trimmed, or reworded past `SET_DOWN_LIMITS.NEAR_SHARE`); otherwise it is recorded "set down, unnamed",
and it is quoted by the wake only when clearly gone (`GONE_SHARE`, clause, anchor and root checks); the rest are
quiet "maybe reworded" memories. Each set-down is a memory about me (`source: reflection`, tag `set down`, meta
`setDown`). The wake's "Last night" says `Set down from my page last night: "…" (recall "set down")` once. Day's end
and the reflection are shown, each for its own sections, the set-downs that life has used since or that a newer
memory restated.

- **Per night, named against unnamed.** One `self.page.set_down` row per nightly write that dropped or reworded
  anything (counts and ids only, never a line):

  ```sql
  SELECT day, json_extract(payload, '$.by') AS door,
         json_extract(payload, '$.named') AS named, json_extract(payload, '$.unnamed') AS unnamed_quoted,
         json_extract(payload, '$.unsure') AS unnamed_quiet,
         json_extract(payload, '$.writerFolded') AS w_folded, json_extract(payload, '$.writerReworded') AS w_reworded,
         json_extract(payload, '$.engineReworded') AS e_reworded,
         json_extract(payload, '$.sentNamed') AS sent, json_extract(payload, '$.unmatchedNamed') AS named_not_gone
  FROM events WHERE name = 'self.page.set_down' ORDER BY day;
  ```

  Many unnamed (quoted or quiet) says the writers don't account for what they change; many `named_not_gone` says
  they name lines they kept.
- **The audit of the writer's account.** For a night, take the two page versions (`counterparts self-page
  --versions`, then `self-page --version <seq> > before.md`) and run `bun tools/set-down-diff.ts before.md after.md`.
  For each line the writer called folded or reworded, check by eye that its point is on the new page. Check that any
  line the wake quoted is really gone (on ~80 real pairs with no account, all were).
- **The quiet ones.** `recall "set down"` items marked `quiet`: are they mostly rewordings (fine) or real drops that
  deserved a quote (then the writers aren't accounting)?
- **Brought back.** `self.page.brought_back` rows (ref: the set-down's id). None in a week is fine; nothing comes
  back by itself.
- **The wake line.** Mike's call: context or noise. Its bytes come out of "Last night"'s 450; when short, the night's
  own words are kept longest: the set-down line goes first, then the closes.

Revert: the door's diff and the memories ride every nightly write; to stop them, drop the `recordSetDowns` call in
`Self#revisePage` (the memories already written stay, ordinary `me` memories that fade).

## The page's stories (PS1)

PS1 (2026-11-09, the owner's ask; lightly held), `core/self/stories.ts`. On the owner's own-form page every story
under its stories heading had become a correction. Own-form stores now: the night's page writers are told to keep a
mix of story kinds (corrections, and what went right, discoveries, moments with the owner; a page of only
corrections is the failure; no count) and the selection test (would it still teach something in a different
project?); day's end orders the day's memories with a head start for me/us (`PAGE_STORY_LIMITS.HEAD_START`, 0.05,
order only); a practice that is only about the work may be set down into a `kind: skill` memory (`setDown[].skill`),
named on its set-down. Every store: `remember` takes `story: true` (tag `story nominated`); day's end shows the
day's nominations first, marked, and still decides.

- **Story kinds on the page.** Read the page's stories section on the night ~10 after install and the version on
  the night before it: count corrections against the other kinds (went right, discovery, a moment with the owner).
  All corrections still says the words aren't enough.
- **Nominations.** How many were made, and how many became a story:

  ```sql
  SELECT t.memory_id, t.created_at FROM memory_tags t WHERE t.tag = 'story nominated' ORDER BY t.created_at;
  ```

  For each, is its id cited in a page version's trace after it, or its point on the page? None made in ten days
  says the field is not seen (or not needed); many made and none taken says the writer passes them by.
- **Craft moved out.** `self.page.set_down` rows with `$.skills`, and the skill memories they name:

  ```sql
  SELECT day, json_extract(payload, '$.skills') FROM events
  WHERE name = 'self.page.set_down' AND json_extract(payload, '$.skills') IS NOT NULL ORDER BY day;
  ```

  Check by eye that each moved line was about the work, not about honesty or about the owner, and whether recall
  has surfaced the skill since (its `uses`).
- **The read.** The owner and a fresh session of the counterpart read the page and say whether it reads as someone
  growing.

Revert: the words are `PAGE_STORIES_RULE` and `pageCraftRule` (drop them from `writerInstruction` and the
reflection's page line); the head start is `HEAD_START` = 0; nominations stop being shown first if `pageWriterInput`
passes no `nominated` (the tag stays, harmless).

## The night closes open items itself (SO1 step 1)

SO1 step 1 (2026-11-07, Mike's "yes": the night may close items itself; lightly held), `core/open-close.ts`, the
cycle's `close` phase (`sleep/close.ts`). One rule, `release-supersedes`: an open item whose headline reads a
version as a release step closes when a later memory in the same folder says a higher patch of that series was
released or published. Never an `asked` item, a check, an item conditional on a version, or one the owner
reopened. The unsure ones (the night's and the reflection's) are listed `mayBeDone` under `recall "still open"`.

- **Closes per night.** The `sleep.cycle` row carries `closed`; each close writes a `thread.night.closed` row naming
  the item, the memory that showed it and the reason:

  ```sql
  SELECT day, json_extract(payload, '$.closed') AS closed FROM events
  WHERE name = 'sleep.cycle' AND json_extract(payload, '$.reason') = 'ran' ORDER BY seq;
  SELECT day, ref, json_extract(payload, '$.reason'), json_extract(payload, '$.shows') FROM events
  WHERE name = 'thread.night.closed' ORDER BY seq;
  ```

  Expect the backlog first (the day-47 copy: 2), then 0-2 a night, on release days.
- **Reopened.** `SELECT count(*) FROM events WHERE name = 'thread.night.reopened'`, by `$.by` (`reopen` or
  `updates`). A reopen of a close is a wrong close: more than 1 in 20 says narrow the rule or switch it off.
- **Still open total.** The shaped wake's Still open and `recall "still open"`'s total, before and after install;
  and how many items carry `mayBeDone` (the `open.mayBeDone` meta row's `items`). Re-read on a snapshot copy with
  `bun tools/night-close-eval.ts --source <copy> --seed N` (titles only).

Revert: `OPEN_CLOSE_TUNABLES.ON = false` (`core/open-close.ts`): the phase runs and counts `switched-off`. Each
close is undone by the reflect tool's `reopen` with the item's id.

## A write lists the open items it may settle (SO1 step 1b)

SO1 step 1b (2026-11-07, roadmap with Mike; lightly held), `core/close-hint.ts`, `McpServer#mayCloseOf`. A stored
`remember` or `session_end` entry whose headline says a version or a PR was done comes back with `mayClose` (at most
3, nearest first): open items from any folder with the same version series at or past theirs, the same PR (`#N`
beside a done verb; items in the writer's own project only), or a `settlesWhen` the entry reaches. Never a check or
follow-up (CHECK-AFTER, "Check due", "Check ~", "Experiment check", "re-read"), a protected, parked or settled-over
item, one in a folder that is off, paused or observer, or anything beside an entry about owner/us/me or a plan. The
model decides; nothing closes on its own.

- **Hints shown against closes made.** Each entry that listed any writes `open.close-hint.shown` (ref the entry,
  payload `ids`, `rules`, `ms`); a close of a listed id through `updates` + `unresolved: false` within 7 lived days
  writes `open.close-hint.closed` (ref the item, `daysAfter`). The night's own closes (SO1 step 1) don't count:

  ```sql
  SELECT count(*) AS entries FROM events WHERE name = 'open.close-hint.shown';
  SELECT count(DISTINCT j.value) AS ids_listed FROM events e, json_each(json_extract(e.payload, '$.ids')) j
  WHERE e.name = 'open.close-hint.shown';
  SELECT count(*) AS closes, sum(json_extract(payload, '$.daysAfter') = 0) AS same_day
  FROM events WHERE name = 'open.close-hint.closed';
  ```

  A close of a hinted id is not proof the hint caused it (a hand sweep counts too). Same-day closes (`daysAfter` 0)
  stand in for "caused by the hint".
- **Cost.** p50 and max of `$.ms` on the shown rows (the hint's own read, on the write path). The 11-07 copy (338
  open items): ~1.6 ms in the read, ~2 ms through `remember`. Above ~10 ms p50 is worth a look.
- **Relevance.** Hand-read 10 listed titles beside the entry that listed them (`ref`): how many are plainly
  irrelevant, how many weak. Baseline on the 11-07 copy, before the fix round (PR numbers from any project, checks
  and protected rows listed): 3 of 19 plainly irrelevant plus 2 weak. Worse than that says tighten the rules or cap
  at 2; mostly closed says keep.

Revert: `CLOSE_HINT_TUNABLES.ON = false` (`core/close-hint.ts`): no list, nothing counted.

## Growth exits (FD1 step 2)

**What we're trying.** Every growing table names its exit and gets one doctor line saying how full it is, what came in
and what left over the last 7 lived days. The per-turn event rows (`recall.decision`, `recall.credit`,
`recall.rated`, most of the log) keep 30 lived days instead of 90. Each lived day of them is counted into one latched
`events.rolled` row before it goes: counts by name, the memory ids credited for use (a removed id left out), the
session refs and `probe-oq4`'s two reports for the day, never a memory's words. Brief: `~/counterparts-notes/2026-11-07-briefs/FD1-fading-and-growth.md` §2.

**Why.** Mike, 11-07: wherever something grows, fade more. On lived day 47 `events` was 66.5 MB of a 121 MB store, and
nothing had aged out yet.

**Before the install: take a read-only copy of the store.** Once it's installed, per-turn rows
older than 30 lived days go and only their day's summary stays (`events.rolled`): counts, the ids credited for
use and the session refs, but not the rows, so a SQL read of the rows themselves (their payload fields, footnote
ids, ratings by id) can't reach them. The sheet carries the step (`docs/RELEASING.md` §5.1):
`sqlite3 "file:$HOME/.counterparts/store/counterparts.sqlite?mode=ro" ".backup '$HOME/counterparts-backups/<date>-<version>-pre-install.sqlite'"`.
These reads run on that copy from then on: **MOD #3** ("`recall.decision` events since the .18 install", the
"No settled-over memory outranks its head" section) and the **H14 replay** (ratings 10-26 to 10-31, "Due ~14 lived
days after the longer habituation window"). `probe-oq4`, `counterparts mechanisms`, the dashboard's counts and the
memory card's "days used" keep their all-time numbers from the summaries and need no copy.

**When.** ~3 lived days after install. The first night past lived day 30 takes the backlog at most 5,000 rows a night, so
Mike's store (installed around lived day 48) clears days 0–17 over the first few nights.

**What to look at.** `counterparts doctor --json`, the `growth-events` finding: `bytes`, `rows`, `count:recall.decision`,
`count:recall.credit`, `count:recall.rated`, `count:events.rolled`, `swept`, `lastRemaining`. On a read-only open:

```sql
SELECT name, COUNT(*), MIN(day), MAX(day) FROM events
 WHERE name IN ('recall.decision','recall.credit','recall.rated','events.rolled','sleep.log.swept') GROUP BY name;
SELECT day, json_extract(payload,'$.count'), json_extract(payload,'$.remaining'), json_extract(payload,'$.rolled')
  FROM events WHERE name = 'sleep.log.swept' ORDER BY seq DESC LIMIT 7;
```

`recall_turns` goes on the same 30-lived-day window (`sleep.log.swept`'s `recallTurns`). Nothing writes it today, so
expect 0. Also write down the first numbers from `growth-memories` (live, in reach, under floor, pruned per night, prune lap
nights), `growth-cues`, `growth-queue` and the Association line's `edgesRecent`/`edgesSwept`, as the baseline for steps 3
and 4.

**Expected.** The per-turn rows' oldest day reaches lived day − 30 within a few nights. One `events.rolled` per lived day
it swept. The file shrinks only after a `VACUUM` (SQLite reuses the pages; the bytes on `growth-events` fall first).

**What would change it.** A reader that came up blank for want of an older row (a mechanism going `never`, a CHECK-AFTER
read that needed ids): move that name back to 90, or roll more into the summary. A backlog that doesn't clear: raise
`BUDGETS.log`.

**Revert.** Empty `SHORT_RETENTION_NAMES` in `src/core/store/operational.ts`. Rows already swept stay gone. Their counts
are in `events.rolled`.

## Old chapters leave ambient recall (FD1 step 5)

FD1 step 5 (2026-11-07, decided by the roadmap seat with Mike's ruling: keep the journal forever, old chapters stop
costing; lightly held), `recall/activate.ts#journalAged` (`recall/NOTES.md`, "FD1 step 5"). The 11-07 read: chapter
footnotes rated 0.88 under 7 days, 0.29 at 7–13 (n=14) and 0.00 at 14+ (n=3), against 1.20 / 0.90 / 0.77 for other
memories; journal rows took 12% of the cut's slots, and 83 turns in a week showed nothing but chapters. Ambient now
leaves out a chapter or frozen copy whose last chapter is 14+ lived days old. Facts, meaning, reads by id, the wake
and the dream are unchanged.

- **Ratings by age.** Chapter footnote ratings (footnote lane) bucketed by the chapter's age on the turn, <7, 7–13
  and 14+ (the last should be empty now), against the read's numbers. Join `recall.rated` to the footnote's
  `recall.decision` row, and date the chapter by its last heading's lived day.
- **The skip and the share.** `journalAged` per ambient turn (median, p90, by build), and `journalCandidates`:
  `kept / of` against the read's 11.9% and `pool` against its 78. Turns whose only footnotes were chapters, against
  83 a week.
- **What took the slots.** Ratings of the non-journal footnotes on turns with `journalAged` > 0, against those
  without: better footnotes, or just fewer?
- **Meaning mode's time.** `mcp.recall` rows with `mode: "meaning"`: `elapsedMs` median and max, beside the live
  episode count (323 on 11-07). Candidate-first selection waits for ~1,000 chapters or an ask past 200 ms.

**What would change it:** if 7–13-day chapters stay under ~0.3 and the freed slots go to better footnotes, move N to
7 (one line in `journalAged`; it stops reusing `LAST_HERE_LIFE_DAYS`). An old chapter Mike missed in a footnote says
lengthen it. **How to revert:** drop the `journal-aged` line in `recallableRow`; the counts stay at 0.

## A done memory is never overdue (SO1 step 2)

SO1 step 2 (2026-11-07, Mike's brief `~/counterparts-notes/2026-11-07-briefs/SO1-still-open.md`; a fix, no
switch): `prospective/derive.ts` refuses `done` (status done, not repeating, every window's last day on or before the
day asked: a done dated today has happened), `Prospective#plainDue` skips the same, and
`mcp/server-args.ts#doneDateAsOccurred` turns an eventDate of today or earlier on a done write into `occurredOn`. On 11-07 Mike's Coming up carried "Scheduled Routine night test PASSED",
"Handoff for 11-07 written" and "Chart essay live … ledger L-0032" as overdue.

- **Done-but-dated in Coming up: should be 0.** On a few wakes after install, the Coming up lines (and `recall
  "coming up"`): any whose memory has `status = 'done'`, `event_date` on or before that day and no `meta.recurring`
  (due today included). The rows that were there on 11-07 are still in the store with their date (no migration):
  read them on a snapshot,
  `SELECT id, title, event_date FROM memories WHERE status = 'done' AND event_date IS NOT NULL AND event_date <= date('now', 'localtime') AND archived = 0`,
  and check none shows.
- **The overdue count.** The wake's "(N overdue, …)" against the 11-07 one: it should drop by about the done rows
  above, and every overdue line left should be a real open item.
- **Nothing real went missing.** A done one-off dated today no longer shows as due that day, and one dated tomorrow
  still does (by design); a done row carrying a real step still to do under today's or a past date would now be silent: look for any (a done whose body says "check on", "follow
  up") among the rows above. One or more says the write's note should ask for a new memory for the next step.
- **The write.** New rows since install with `status = 'done'` and `occurred_on` set and `event_date` NULL, against
  any still landing with an `event_date` of that day or earlier (those came through `updates`, which the write
  leaves alone).

Revert: drop the `done` arm in `derive.ts` and its `load()` field, the `plainDue` skip, and the
`doneDateAsOccurred` calls in `server.ts` and `server-session-end.ts`.

## A newer routine work event fades the older one (FD1 step 3)

FD1 step 3 (2026-11-07, from the Fable fresh-eyes review and Mike's ruling mem_dc74aa500871, lightly held),
`core/interference.ts`, the cycle's `interfere` phase (`sleep/interfere.ts`). Each night an older `about: work`
memory in a folder that names the same version series at a version no higher than a newer one's (`0.3.46` under
`0.3.50`; the same version only as a step before final, then final), in its headline (title, or first 120 characters; the newer's
headline a status event too), written on an earlier lived day, is settled `changed` under the
newest such memory through the one door: fade ×0.5 (`CHANGED_FADE`, what an `updates` revision gives), still live,
labelled earlier, undoable. Only a `fact`, `done` or unmarked, episodic, unprotected, not core, not a belief, no
date, not an open item, not said by the owner, no feeling, salience at most 0.4, uses under 0.75, reading as a
status event at its subject (a status verb beside the token), never faded before, not the faded side of a pair; the newer must say it was done (released, published, merged, …). A settled-over memory leaves the wake's lines and cues and folds into its holder in facts, so a wrong pair hides a memory, not just halves it. At most `BUDGETS.interfere` (200) a night. The age prune
is unchanged (`D_FLOOR_DAYS` 14): a faded memory still waits under the floor, and leaves as an age prune.

- **Per night, the two apart.** The `sleep.cycle` row carries `interfered` beside `pruned`:

  ```sql
  SELECT day, json_extract(payload, '$.interfered') AS interfered, json_extract(payload, '$.pruned') AS pruned
  FROM events WHERE name = 'sleep.cycle' AND json_extract(payload, '$.reason') = 'ran' ORDER BY seq;
  ```

  Each fade also writes a `contradiction.settled` row with `source` `interference` and `reason`
  `superseded-by-newer`; its trail row (`contradiction_settles.why`) names the newer memory and the rule
  (`superseded-by-newer: mem_… (0.3.46→0.3.50)`). Expect the backlog first (a dry run on the day-47 copy: 67, under the 200 budget), then a
  few to a few dozen a night. Age prunes rise later as the faded rows reach the floor.
- **Anything wrongly faded.** On a snapshot, read 20 of the faded pairs (older and newer side by side): is the
  older really an earlier state of the same thing (a release step before the release), or a design note, a bug, a
  decision that happens to name a version? More than 1 in 20 of the second kind says switch to the plain fade (`INTERFERENCE_TUNABLES.SETTLE = false`), or drop
  the version arm to "same version only". Also read the phase's `skipped` map on the `sleep.cycle` row: the guards
  holding the most (`not-an-event`, `salient`, `used`, `owner-said`, `felt`) say what kept its curve.
- **Nothing protected faded.** No faded row with `said_by = 'owner'`, a feeling, `about` other than `work`, or
  `meta.unresolved`:

  ```sql
  SELECT m.id, m.said_by, m.about FROM contradictions c JOIN memories m ON m.id = c.a
  WHERE c.source = 'interference' AND (m.said_by = 'owner' OR m.about != 'work' OR m.meta LIKE '%"unresolved":true%'
    OR EXISTS (SELECT 1 FROM feelings f WHERE f.memory_id = m.id));
  ```

- **Still open unchanged.** The wake's Still open count before and after install is the same (this never
  closes an open item; the review's item 3 does that later).

Revert: `INTERFERENCE_TUNABLES.ON = false` (`core/interference.ts`), the phase then runs and counts
`switched-off`. Each fade made so far can be undone like any settle (`counterparts settle --undo <pair>`), and an
undone one is never faded again.

## The tail after a compaction is owed (CT1)

CT1 (2026-11-04, decided by counterparts-a0, lightly held), `core/coverage/index.ts#tailCut`
(`coverage/NOTES.md` §11). The developer week's d2s1 chaptered at a Stop ask, compacted, said three things in
six minutes and was never written up (`under-floor:span`). Now the tail after the earliest `pre-compaction`
boundary later than the session's last record point is owed as an unrecorded session's stretch is (from one piece, S2's rule).
Tier 0 cost: Dana unchanged; Theo one more write-up in the week (14 → 15), no extra catch-up run.

- **Live cost, the first nights.** Of each night's owed sessions, how many are owed only by a compacted tail
  (`compactionTail` > 0, `overFloor` false, `recorded` true), and their write-up parts against the night's total.
  For each such tail, read its pieces on a snapshot: the person's own words, or only `<task-notification>`,
  peer messages or injected context (pieces carry no source tag, so this is a read of the text). Mostly plumbing
  says count the one-piece floor from the person's own messages (WP1's frames), which CT1 did not do.
- **How often it fires.** `counterparts coverage` / the ledger on a snapshot: sessions owed with `compactionTail` > 0,
  and their pieces. Expect a few a week on a working store; one a day or more says compactions are common enough
  that this costs real write-ups.
- **What the write-ups hold.** For those sessions, the night's write-up memories: real content (the d2s1 aside)
  or nothing / plumbing. Mostly empty says hold the tail to `OWED_PIECES` (3) without the span.
- **Nothing lost the other way.** No session whose record followed its compaction is newly owed.

Revert: drop the `|| isDebt(stretchOf(tail), false)` arm in `ledger` (`core/coverage/index.ts`).

## Folder attribution (FS1)

FS1 (2026-11-04, from the developer week's three ambers; a fix, no switch): `dream/slices.ts#nightFolder`,
`core/counterpart-wake-shape.ts` (Coming up), `handoff/last-here.ts#placeWords`. No date: read it on the next developer
week at tier 2, or on a week of Mike's shaped wakes after release.

- **Night rows by folder.** A dream's merges and gists by `origin_scope`: work in its majority folder (a tie, the newest
  source's), never none; personal ones under the folder they share, else none. Expect no "Since yesterday, here" item
  in a folder that is another folder's work. The cost to look for: a cross-folder work fold shows only in its majority
  folder, so the minority folder's "here" doesn't see it (recall still does). Only directories vote; a night row
  among the sources votes with its originals' folders.
- **Coming up.** No "Due today" line in a wake that is another folder's work; the count says "N in other folders" and the
  `coming up` door lists it. A personal or plain dated item is still due in every folder.
- **Folder names.** Elsewhere, "Today, elsewhere", "Since you started", Yesterday's places, the about-me line and "Work
  here"'s "(from …)" name
  folders by their last part. Two of a name print their paths. A name that reads ambiguous (two repos called `app`
  under one wake, only one of them named) would say the collision set should be wider.

Revert: `nightFolder` returning the dream's own `scope`; `todayAll`/`other` back to `c.today` / `!c.today && !c.mine`;
`placeWords` back to the `~`-path.

## Due ~2 weeks after chat delete (HD1)

(2026-11-04, Mike's yes 09:16, lightly held.) **What we're trying.** A person can ask Claude to delete one memory.
The model's call only HOLDS it (`core/removal-hold.ts`: a `held` row in `removal_record`, which the deny-list reads),
and the erase is the console's own `ownerRemoval`, run by an owner-side clock after 24 hours of wall-clock time:
`sweepHeldRemovals` from the worker (`runner.ts`, step `removals`) on local and from `hosted/src/app.ts#finishDueHolds`
(every ten minutes, stores with `stores.removal_due_at` due) on hosted. `remove.undo` appends `released`. Only an id
the conversation was shown; refused in a local night run.

**What to look at, ~2 weeks after release.** Read-only, ids and counts only, never a body. Per store (Mike's live store;
on hosted, each tenant through the operator's read):

```sql
-- holds placed, undone, and erased, by stage and actor
SELECT stage, actor, COUNT(*) FROM removal_record WHERE at > strftime('%s','now','-21 days') * 1000 GROUP BY stage, actor;
-- an erase that ran late: complete more than 24 h 15 min after its newest hold
SELECT h.memory_id, (c.at - h.at) / 60000 AS minutes FROM
  (SELECT memory_id, MAX(at) AS at FROM removal_record WHERE stage = 'held' GROUP BY memory_id) h
  JOIN (SELECT memory_id, MIN(at) AS at FROM removal_record WHERE stage = 'complete' GROUP BY memory_id) c USING (memory_id)
WHERE c.at - h.at > (24 * 60 + 15) * 60000;
-- a hold past its window and still waiting (the sweep never ran, or failed)
SELECT memory_id FROM removal_record GROUP BY memory_id
HAVING MAX(CASE WHEN stage = 'held' THEN seq END) > COALESCE(MAX(CASE WHEN stage = 'released' THEN seq END), 0)
   AND SUM(stage IN ('dark','chased','complete')) = 0
   AND MAX(CASE WHEN stage = 'held' THEN at END) < (strftime('%s','now') - 86400 - 3600) * 1000;
```

- Hosted's control database: `audit` rows `removal.held`, `removal.erased` (with its unchased count),
  `removal.failed` and `removal.sweep.failed`. Any `failed` row, or an `erased` with unchased surfaces above 0 (the
  likely one: the write-ahead log's TRUNCATE checkpoint coming back busy against Litestream's read lock), gets a look.
- On local, the worker's `runner.holds` and `holds.threw` log lines.
- Claims: each erase is preceded by an `erasing` row (the sweep's claim, one transaction; an undo is refused once it
  exists). More than one `erasing` after a hold is an erase that failed and was tried again after its backoff (an hour,
  doubling, at most a day); hosted audits `removal.failed` at the first failure only, as a count and short codes
  (`1 failed: unknown-id`, `ERR_SQLITE_ERROR`, else `error`), never an error's words (G1 L6).
- How long one erase takes on a real hosted store: `ownerRemoval` rebuilds the cache (`rebuildCache()`, vectors
  dropped and re-embedded) and VACUUMs both databases inside the tenant's queue, so the person's calls wait on it.
- Whether people undo: `released` against `held`. Many undos would say deletes are being made by mistake (or by text
  the model read); none at all says little.

**What would change it:** an erase that fails or runs late (the clock isn't running where we think); a delete nobody
asked for (the first one is when a rate cap or a confirm step gets added: guards loose-first); people asking for
a "recently deleted" list on the account page.

**How to revert:** drop `remove` from `remember`'s schema (`tools.ts#REMOVE_PROPERTY`) and its dispatch in
`server.ts#rememberTool`; release any holds left (`remove.undo`, or append `released`). The `held` stage, the sweep and
the column can stay inert. The store's format never changed (still v15).

## ~48 h after the first hosted chat delete (HD1 backups)

(2026-11-04, fix round item 4.) **What we're checking.** The hosted reply says a deleted memory is "gone from our
backups within about two days". The bound is read from the code (`server-words.ts#deletedNote`'s comment: 24 h hold +
up to 10 min for the timer + Litestream's 12 h `snapshot.retention` + its retention-enforcement lag, which its docs
don't state), not measured. **The check, once, after the first deploy with HD1:** on Mike's hosted account, write a
throwaway memory carrying one unique made-up word, recall it, delete it, and let the timer erase it 24 h later (the
audit's `removal.erased` row says when). About 48 h after the hold, restore the R2 bucket's newest snapshot to a
scratch directory with the operator's tools (never the live service's data) and grep it for the word, and the write-ahead
log segments after it. **Passes:** the word is in no snapshot or segment. **Fails:** it is; then the lag is longer
than the reply assumes, and the reply's "within about two days" and the /privacy/ copy wait for a measured number.
"About two days" goes on /privacy/ only once this passes. It covers our Litestream/R2 copies only: Railway's own
volume snapshots ("multiple times per day, with retention ... varying by storage tier", its SOC 3) have a retention
we don't know yet (Mike is asking Railway); the reply and /privacy/ name them without a time until we do.

## The first claude.ai chat of the day runs the night (HN1)

HN1 (2026-11-04, ROADMAP's go 09:41, Mike's design 11-03, lightly held), in `mcp/server.ts#claudeAiNight` and
`server-words.ts#claudeAiNightLine`. Read ~1 week after the hosted deploy, from the hosted call log (`[hosted] mcp`
lines: tool, session, ok, reason, the hashed store; no words) and what people say. Nobody reads a person's store.

- **Where nights start.** Per store and day, the session that called `dream` successfully: one whose connection's
  `initialize` named claude.ai's client is a chat's night; `claude-code` with a `wake` that had `night: true` before it
  is a routine's (the call log doesn't keep arguments, so tell them apart by client name and by a launch within a few
  calls of the wake). Expect most nights from a chat, and the routine where people set one up.
- **Double starts.** Two sessions on one store and day that both reached `dream` `begin`: the second should be refused
  (`dreaming-now` or `dreamed-today`). Any day with two journaled dreams, or two successful `begin`s, is a bug in the
  latch. A routine meeting refusals after a chat's night is expected, not a double start.
- **Nights that didn't finish.** A `launch` with no `begin` after it, or a `begin` with no `journal`, in a chat:
  claude.ai cut the reply, or the model stopped. A later chat picking it up after 30 minutes is the designed recovery.
- **Days that owed a night and got none.** Stores active on two days in a row with no `dream` call on the second: the
  model ignored the line, or the gate wasn't met (fewer than three new memories). Count which, if the log can say.
- **Light days get no in-chat night, by design.** A day with fewer than three new memories (the dream's `MIN_NEW`)
  gets no night line, and so no day's end either: hosted has no catch-up for owed write-ups. ROADMAP 11-04: fine as
  built. Watch only whether light-use accounts go many days without a night, or say their memory doesn't seem to sort.
- **Night first, on real claude.ai** (Mike 11-04, lightly held: "we can see how it goes"). In the first real
  claude.ai week, read how the wait felt (the answer comes after the night's calls, ~25–60 s) and whether the question
  got answered every time. Answer-first stays the cheap way back if real claude.ai differs: on the M1 rig (`claude -p`,
  Sonnet 5.5) it left the answer only in the model's thinking in 5 of 5 runs, so it was never tested on claude.ai.
- **A model low on budget skips the night.** On the M1 rig (run F, a $0.15 cap with a cold prompt cache) the model was
  told its budget was nearly used, answered, and offered to run the night next time; the day's claim then holds until
  a later chat picks it up after 30 quiet minutes, at most twice a day (`RELAUNCHES_PER_DAY`). In the first week, watch for claude.ai first chats that skip the
  night this way (a claimed day with no `launch` from that session), and whether people near their usage limits see it.
- **Complaints.** A person surprised by the night in their first reply, a slow first answer, or usage limits hit after
  it. One clear complaint is reason to make `ask` hosted's default for new accounts.

Revert: drop the `night` line from claude.ai's wake (`server.ts#claudeAiNight` returning null); the setting words, the
tool words, the told lines and the manual go back with it.

## The wake knows yesterday's news (WF1)

WF1 (2026-11-03, Mike's go 14:41, ROADMAP's brief, lightly held), in the shaped wake (`core/counterpart-wake-news.ts`,
`core/counterpart-wake-shape.ts`). No date: read it on a few days of real shaped wakes after release (Mike's store, on
since 11-01), or on the next new-user week, whichever comes first.

- **News that reached the next wake.** `sec_news` on `adapter.wake.injected` rows: how often it shows, its bytes (expect
  0–300), and whether its items were ones a turn then needed (the turn asked or acted on it) or noise (the page already
  said it, an everyday note at 0.6). A strong `us` memory written after the night and missing from the next wake in a
  folder that's on is a bug.
- **The handoff stepping down.** Wakes whose newest handoff printed as `Last handoff, … N sessions here since`: did a turn
  then lose something only the handoff said (it opened `recall sch_…` or asked)? That would say 12 h is too soon.
- **Settled dates.** `happenedAlready` hiding a dated item that hadn't happened (a done "launch checklist" settling a launch
  day) is the failure to look for: one is enough to tighten the word rule or drop it for links only.
- **New stores shaped.** A store created after release reads `self.wake_shape = on`; one from before reads what it read.

Revert: `NEWS_SHOWN` 0, `HANDOFF_STEP_DOWN_MS` very large, `HAPPENED_SHARED` very large (`self/tunables.ts#WAKE_SHAPE_LIMITS`);
take `WAKE_SHAPE_KEY` out of `beginNewInstall` (stores born since keep `on` until `counterparts wake-shape default`).

## When Mike runs his fresh-user test: starter memories (S1)

S1 (2026-11-03, Mike approved draft 3, lightly held): a store `install`, `start-fresh` or hosted signup creates
begins with the 11 starter memories, source `told` (`src/core/told.ts`). No date: this settles when Mike runs his
fresh-user test on a new store, local or hosted. What to read in that store's first week:

- **Used?** Which seeds were footnoted (`recall.decision` verdicts on ids from `store.toldIds()`), opened or quoted
  (credit rows, `uses`), and which faded untouched. A seed opened on a turn about it is the point.
- **Crowding?** Turns where a told footnote sat beside fewer than `MAX_FOOTNOTES` lived ones is fine; a lived
  memory turned away while a seed showed would be a bug (the gate fills lived first). Deliberate `recall`: a seed
  above a lived match of comparable score is a bug too.
- **Kept out?** No starter words on the page, in Lately, the core, beliefs or cards after the first nights; no seed
  in a dream's or reflection's bundle.
- **Felt?** Mike's own read: did the counterpart offer tips once, at good moments, or recite them; and the visible
  cost — `status` and the dashboard count the 11 from day one.

Revert: stop calling `plantTold` (`cli/commands-install.ts`, `hosted/src/tenants.ts#startNewStore`); stores already
planted keep their seeds, which fade unless used.

## Due ~14 lived days after the longer habituation window (2026-11-01, H14, Mike's call 12:07, lightly held — `recall.HABITUATION_WINDOW_DAYS`)

**What we're trying:** a memory rated 0 in two sessions faces the raised bar for 14 lived days, not 7. Replaying 2,037 real
turns (10-26..31) at 14 removed 261 showings for 5 useful ones lost, and moved rated noise from 40.3% to 37.7%. The cost
is about twice as many memories held down at once (271 against 138 on lived day 41). This is a starting point, not a
commitment, and anyone can reopen it sooner.

**Reopen sooner if:** Mike or a session notices a ruling it wanted didn't come up, or a memory rated 3 sits in the held list.

**The review:** ROADMAP holds this read. On a fresh store copy, read-only, a small script: memories held on a given day that were later opened, asked for or rated 2-3 (the `asked` and `opened` lanes on `recall.rated`), plus a read of the extra footnotes the 7-day arm would have shown. Replay steps and scripts are in
`~/counterparts-notes/2026-11-01-briefs/habituation-replay/PROGRESS.md` (`held.py` for the held list). They carry scratch paths from 11-01, so point them at the new copy. Also read held-set size and rulings held. R3S lands just before this and moves the same noise number, so don't read noise alone.

**Useful lost can't be read after release, by live or by a replay.** The 11-01 replay could score what 14 took away because live ran at 7, so those footnotes were shown and rated. Once live runs at 14, what it holds mostly isn't shown, so it has no rating. The "5% of removed rated showings" test applied only to the 10-26..31 replay (4.2%, 5 of 120).

**What would change it:** held memories later turning out wanted, the extra footnotes reading as ones we'd have wanted, or a ruling Mike uses staying held. Then back to 7 or something between. If none of those shows, leave it. It's also worth reading once the history
is older than 21 days, since 14 and 21 can only part then.

**The 11-01 replay, corrected:** its 14 and 21 arms first read the window through `eventLog`'s default of 500 rows, oldest
first, which this change fixes (`recall/NOTES.md`, H14). The window passes 500 rows on lived days 39–40 (10-30, 10-31), so
those arms missed their newest ratings there. Rerunning those two days (698 turns) with the fix changed 2 turns at 14 and 6
at 21, and none in the 7-day control. At 14: 261 removed (first run 260), 5 useful of 120 rated (5 of 119), 4.2% both. At 21:
268 removed (266), 6 useful of 121 (6 of 120), 5.0% both. Noise stays 40.3% to 37.7% in both arms, so 14 and 21 still
don't part. The numbers above are the corrected ones.

**On the upgrade:** the box-3 note a 7-day build left reads as current until the next rating row, so memories rated 0 only
in the older 7 days aren't held until then. The next rating row rebuilds it (tested through `session_end`).

**How to revert:** `HABITUATION_WINDOW_DAYS` back to 7, in `src/core/recall/tunables.ts`. A 14-day note read at 7 is right at
once. `HABITUATION_BAR_LIFT` 0 turns the mechanism off.

## Due a few nights after write-ups skip plumbing (2026-11-03, WP1, Mike's OK 14:41, lightly held — a fix, no switch)

**What we're trying.** In the 11-03 Dana re-run the night's catch-up wrote a refused tool call into memory ("Declined
permission to mark a note delivered") and the session's asides about it as an `about: me` lesson; the first then
headed day 4's notes wake. Two changes: the transcript reader tags the host's `[Request interrupted by user for tool
use]` line and a hook's output written as user text inside a system reminder `plumbing`, which enters no capture
(`claude-code/transcript.ts#PLUMBING_FRAMES`, `remember/spans.ts#enters`); and every write-up of an ended session (the
catch-up's prompt and the door's `next`, so the pointer's writer too) carries `sessions.ts#WRITE_UP_PLUMBING_RULE`.
The Dana memories came from the counterpart's own replies, which no reader may drop, so the sentence is the half that
answers them.

**What to look at, a few nights after release.** Read-only, titles and counts only:

```sql
SELECT id, about, title, json_extract(meta,'$.build') AS build FROM memories
WHERE json_extract(meta,'$.secondHand') = 1
  AND (lower(coalesce(title,'') || ' ' || coalesce(body,'')) LIKE '%permission%'
       OR lower(coalesce(title,'') || ' ' || coalesce(body,'')) LIKE '%declined%'
       OR lower(coalesce(title,'') || ' ' || coalesce(body,'')) LIKE '%tool%'
       OR lower(coalesce(title,'') || ' ' || coalesce(body,'')) LIKE '%hook%')
ORDER BY created_at DESC LIMIT 30;
```

- **None about plumbing** on the new build: no write-up memory whose subject is a permission prompt, a refused or
  failed tool, a hook, or the system marking or saving something. A memory where the person said something about one
  ("why do you keep asking me to allow that?") is the exception the rule keeps.
- **Nothing lost:** the sessions those nights wrote up still have memories of what was said (a night writing `[]`
  for parts that held real talk would be the sentence overreaching).
- The harness's next Dana week, item 8: the `reflect` refusals there come from the harness's allowlist and still
  produce asides; the write-ups should leave them out.

**What would change it:** plumbing memories still landing (the sentence is too weak, or sits where the writer skims);
real exchanges skipped as plumbing (it is too broad); the person's typed reason for declining a prompt, which the host
puts inside the rejected `tool_result` and so has never reached capture, turning out to matter.

**How to revert:** the two are separate. The sentence: drop `WRITE_UP_PLUMBING_RULE` from `catchUpPrompt` and the
door's `next`. The reader: move the two frames back into `HOST_FRAMES` (both read as `injected` again, and the hook
frame inside a system reminder goes back to `classifyBlock`'s `injected`). Neither touches the store's shape.

## Due a few nights after refused calls stay plumbing (2026-11-04, TC1, lightly held — a fix, no switch)

**What we're trying.** In the developer week (11-04) and Dana's (11-03) the carried morning share asked the session to
call `reflect` `told`; the host's permission prompt denied it, and the session's own Stop-ask `session_end` filed "Morning
share told to Theo but reflect 'told' call was permission-denied", dated and `us`, which led Coming up in every folder.
WP1 had only reached the write-ups of ended sessions. Two changes: `Reflections#carryLine` marks the share `told` as it
hands it over (with `told` on its cites) and asks for no call; and `remember/own-plumbing.ts` reads a memory's subject
(title, else first line; never `saidBy: owner`), so one about our own refused call, a prompt or the session's limits is
kept without date, thread or me/us/owner mark (`counterpart-deposit.ts#ownPlumbingOf`, `meta.ownPlumbing`), and no wake
line (Since here, Since the last night, Elsewhere, Work here, the later-session line) or prompt's ambient recall offers
it. Doctor's Reflection line says a share was "marked told on delivery". `session_end` and `remember`'s `text` field say not to write them.

**What to look at, a few nights after release.** Read-only, titles and counts only:

```sql
SELECT id, about, event_date, title, json_extract(meta,'$.ownPlumbing') AS cue, json_extract(meta,'$.build') AS build
FROM memories WHERE json_extract(meta,'$.ownPlumbing') IS NOT NULL ORDER BY created_at DESC LIMIT 30;
SELECT id, share_state, share_session FROM reflections ORDER BY started_at DESC LIMIT 7;
```

- **Every `ownPlumbing` title really is plumbing** (a false positive is a real memory that lost its date); and few of
  them: the sentence should keep most from being written at all.
- **No dated or me/us/owner memory about a refusal** got past the gate (the WP1 query above, without `secondHand`).
- **Shares are `told`, not `offered` for days:** a share stuck `offered` means no session carried it.

**What would change it:** a real memory read as plumbing (narrow the cue that read it); plumbing memories still landing
dated (a phrasing the cues miss: add it, from the title it used); a person missing a share the model never actually
told (the host marks delivery, not the telling).

**How to revert:** separate. The carry: write `carried` again in `carryLine` and restore the `told` ask (`CARRIED_TOLD_NOTE`).
The gate: return null from `ownPlumbingOf`. Neither touches the store's shape.

## Due ~1 week after the night's two holes (2026-11-01, NT1, Mike's call, lightly held — a fix, no switch)

**What we're trying.** The night keeps starting at the first message, and two holes close: `claude-code/awake.ts` makes a night's watchdogs count time awake, and a session the hook reads as headless (`hooks.ts#passesOnNight`) passes on the night without claiming the day. On 11-01 a night started from a `claude -p` session in a lid-closed dark wake, its catch-up child got about 15 s awake, the laptop slept 853 s and the 10-minute watchdog fired on wake. Why, and what wasn't changed: `docs/IMPROVEMENTS.md`. Only a live read can show real sleep: everything before it stopped a process with SIGSTOP or stubbed the clock.

**What to look at, about a week after release.** On a copy or read-only, ids and numbers only:

```sql
SELECT seq, ref, json_extract(payload,'$.state') AS state, json_extract(payload,'$.session') AS session,
       json_extract(payload,'$.ms') AS ms, json_extract(payload,'$.sleptMs') AS slept
FROM events WHERE name = 'dream.night' ORDER BY seq DESC LIMIT 40;
SELECT seq, ref, json_extract(payload,'$.state') AS state, json_extract(payload,'$.ms') AS ms, json_extract(payload,'$.sleptMs') AS slept,
       json_extract(payload,'$.limit') AS lim
FROM events WHERE name = 'adapter.night.writeup' ORDER BY seq DESC LIMIT 20;
```

- **A run spanning sleep:** a `dream.night` row with `sleptMs`, and `adapter.night.slept` in `sessions/log/`. A night the lid closed on and no `sleptMs` means the gap went unnoticed. Compare `ms - sleptMs` with what the children really took.
- **No catch-up stopped by a watchdog after a sleep:** no `adapter.night.writeup` row with `state` `timed-out` and a `sleptMs`; none with `limit` `time` unless it really worked for an hour awake.
- **Which session started each night:** `adapter.night.started` in the log carries the `session` and `entrypoint`. No `sdk-cli` or `sdk-ts`. `adapter.dream.unwatched` beside it: `passed: "headless"` lines are a session passing, `started: true` is a hand-back in a person's session or a session the host calls unattended off the headless list (10-25 and 10-31 were `cli` hand-backs). Its `session` against the host's transcript tells those apart.
- **Any day with no night:** a lived day with memories saved and no `dream.night` row, and what sessions it had. A day used only headless gets none, and that's expected; doctor says so once it's been two days.

**What would change it:** a watchdog still firing on wake (read `adapter.night.slept` against the row, then whether the gap is too wide); a real child killed late because stalls read as sleep; days with no night that a person would have wanted (a schedule comes back on the table, as Mike said).

**How to revert:** the two are separate. For the night's start, drop the `passesOnNight` branch in `hooks.ts#dreamLines`. For the watchdog, `arm(terminate, plan.timeoutMs)` in `child.ts`. Neither touches the store's shape: `sleptMs` is a field on a row, and an older build ignores it.

## Due 2026-11-08: the page in its own form (PF1, ROADMAP 2026-11-01, an experiment — meta `self.page_form`)

**What we're trying:** on 11-01 the counterpart rewrote its own page (v72) as dated stories with the lesson inside, a "Practices, no story yet" list and a short "Firm" section, and no "## How I work"; the nightly writers were told to keep "## How I work" as short general lessons (`HOW_I_WORK_RULE`). With `counterparts page-form own`, day's end and the reflection are told instead to amend the page in its own form. Mike's store only; every other store has no row and is the comparison. Why and undo: `docs/IMPROVEMENTS.md`, "One store's nightly writers keep the page's own form".

**Switched on:** not yet. After Mike installs 0.3.44, which carries it, ROADMAP or random-54 runs `counterparts page-form own` and writes the date here and in the index row. The dated reminder for 2026-11-08 is set at merge.

**What to look at, 2026-11-08:** Mike's judgment first: does the counterpart read more like someone? Then the page versions since the switch (`counterparts self-page --versions`, `--version <seq>`): a story cut to fit the room (v72 was 4,588 B of 4,600, so any added line sends a page back to be cut, and stories are the longest lines, switch or not); a "## How I work" list rebuilt, or stories flattened into rules; which sections day's end touched. Claims: a hand-written page's sentences start as hypotheses until a writer cites them, which is expected.

**What would change it:** a page that loses its stories to room night after night (room is a separate decision, not this one); nights that rebuild the rules list anyway (the words aren't enough); or Mike reading no difference.

**How to revert:** `counterparts page-form default` on the store, from the next night, no restart. A page put back by hand: write v71 (the last rules page) or any version's text as a new version through the self_page tool.

## Due ~1 week after the shared bucket went line by line (2026-11-01, coordinator's brief marked for Mike's review — a fix, no switch)

**What we're trying and why.** Sessionless notes' raw copies share the id `"mcp"`, and `counterparts note`'s share
`"console"`, and each new note restarted the clock for the rest. Each line now goes on its own age.
`docs/IMPROVEMENTS.md`.

**What to look at.**

1. Lines deleted per pass (the first pass after updating takes the whole backlog):

   ```sql
   SELECT json_extract(payload, '$.date') AS date, json_extract(payload, '$.reason') AS reason,
          json_extract(payload, '$.unboundLines') AS unbound_lines, json_extract(payload, '$.deleted') AS sessions
   FROM events WHERE name = 'remember.prune' ORDER BY seq DESC LIMIT 14;
   ```

2. Copies past the limit that are still there. Counts and ages only; it prints no words:

   ```sh
   bun -e 'const fs=require("fs"),p=require("path"),s=process.env.HOME+"/.counterparts/store/spans";let n=0,old=0,past=0;for(const d of fs.readdirSync(s)){const f=p.join(s,d,"jots.jsonl");if(!fs.existsSync(f))continue;for(const l of fs.readFileSync(f,"utf8").split("\n")){if(!l)continue;let x;try{x=JSON.parse(l)}catch{continue}if(x.session!=="mcp"&&x.session!=="console")continue;n++;const a=(Date.now()-x.at)/864e5;if(a>=4)old++;if(a>=15)past++}}console.log({lines:n,over4days:old,over15days:past})'
   ```

3. `counterparts doctor --all`, the Raw transcripts line: `N old notes with no session let go` on a day lines went.

**What would change it.** `over15days` above 0 on a store whose worker ran that day means a line is escaping: look for
a broken `at` or a stranded `.striking` file. `over4days` above 0 is normal only for notes whose memory did not land.
A real note's words missing from a write-up later would mean the rewind isn't doing its job (`remember/NOTES.md`).

**Revert.** `docs/IMPROVEMENTS.md`, Undo.

## Due ~3 nights after the catch-up respects a folder that is off (2026-10-30, NC1, coordinator's brief marked for Mike's review — a fix, no switch) — checked 2026-11-03, below; re-read when a folder with recent sessions goes off

**What we're trying.** The night's catch-up, `counterparts catch-up` and the pointer leave out a session whose folder
is now off, observer or paused. Nothing about it is marked, so its text goes with retention and a resumed folder is owed
again.

**What to look at.** Three nights after install. New memories with `writtenUpBy` set whose `origin_session` is filed under
a folder not on since before the write: expect none (the three from 10-29 predate this and stay). `counterparts coverage`:
such sessions under "Not asked for", none under "Owed now". Doctor's `Catch-up` count against that list. `adapter.night.writeup`
rows: `left` and `partsLeft` no longer carry them. Sessions in folders on: still written up at the rate before, the
one thing this could break.

**What would change it.** A write from a not-on folder: read when its folder's setting changed against the run's time; a
change during a batch is allowed for, anything else is a bug. A debt that doctor shows and the catch-up never takes:
the two readers disagree, fix the reader. Text from off folders staying too long to be comfortable: Mike's call on a
shorter clock for `off` (`docs/decisions.d/fix-catch-up-respects-off.md`). **Revert.** The commits are small; nothing to
migrate.

## Due ~2 weeks after summaries started lower (2026-10-30, F1, ROADMAP's decision marked for Mike's review)

**What we're trying.** A new unmarked or work chapter summary starts at 0.25, not 0.4; one marked me, us or owner keeps 0.4
(35 of the 464 live ones on the 10-30 copy). The claim is read once, at birth, from the chapter's `about` as written, and a
later re-mark moves the mark, not the claim. The 10-30 replay of the last 15 days, with every summary lowered, took 379
never-used summaries out of reach and lost no use-days (14 showings lost: 7 rated 0, 1 rated 1, none useful); keeping the
marked ones leaves below reach at 324 of 464, not 355, so about 350 of the 379 (an estimate). An unused unmarked or work one
stays in reach about 3 lived days (was 24) and reaches the prune floor at 49 (was 267), so it is let go about 63 lived days
in. Checked on a corpus copy with every live summary lowered, the harder case: the reflection's bundle, part 1's bytes and
three session-start wakes came out identical, and the dream differed only by its seeded mixing, as a control run with
nothing changed did. Those paths read a summary by its chapter and never ask about reach. A store with no page yet does
ask, in "Might be relevant" (`WARM_FLOOR`, 0.35): an unmarked or work summary is no longer listed there.

**What to look at (read-only).** By build, on rows from the build that carries it (`$.build`):
- Summaries in reach and in use: live `meta.chapterSummary` rows by `claimed`, with `uses`, against strength. Ratings of a
  summary from `recall.rated`, born before and after.
- Whether what was lost was wanted: a deliberate recall or an expanded id on a summary below reach.
- The first ones let go, ~9 lived weeks after release: `memory.pruned` on a summary, and what a chapter's line says with
  no summary behind it (the chapter is still there; a dream, a reflection or the Yesterday line reads its own words).
- The fields, a week's read:
  `SELECT j.value, COUNT(*) FROM events e, json_each(e.payload,'$.nearMiss.ids') j WHERE e.name='recall.decision' GROUP BY 1 ORDER BY 2 DESC`
  (who keeps almost showing; join to later ratings and uses);
  `SELECT AVG(json_extract(f.value,'$.cue')), AVG(json_extract(f.value,'$.sem')), AVG(json_extract(f.value,'$.bar')), SUM(json_extract(f.value,'$.pair') IS NOT NULL), SUM(json_extract(f.value,'$.standsFor') IS NOT NULL) FROM events e, json_each(e.payload,'$.footnotes') f WHERE e.name='recall.decision'`
  (why footnotes show);
  `SELECT json_extract(payload,'$.pageRung'), AVG(json_extract(payload,'$.sec_page')), AVG(json_extract(payload,'$.sec_threads')), AVG(json_extract(payload,'$.sec_horizon')), AVG(json_extract(payload,'$.sec_stands')) FROM events WHERE name='adapter.wake.injected' GROUP BY 1`
  (where a session start's bytes go);
  `SELECT j.key, SUM(j.value) FROM events e, json_each(e.payload,'$.returnRefused') j WHERE e.name='recall.rated' GROUP BY 1`
  (why a used memory earned no return; `reflections.detail` has `refusedReturns` the same way);
  `SELECT day, json_extract(payload,'$.freshCutP'), json_extract(payload,'$.waiting') FROM events WHERE name='dream.begun'`
  (how far down the queue each night reached).
- The log's size per day: about +14 KB on about 1 MB, measured on a replay.

**What would change it.** Summaries rated useful on more than a few days after they left reach, or a deliberate recall of one
that recall had stopped offering: raise the claim. Summaries re-marked me, us or owner while at 0.25 and then wanted: have a
re-mark raise the claim. No loss after 2
weeks: consider the existing rows, which keep 0.4 unless the era read learns to tell summaries apart. Fields nobody read in
a month: drop them, starting with the loudest (`cue`, `sem`, `bar`, about 13 KB a day).
**Revert.** `SELF_TUNABLES.CHAPTER_SUMMARY_CLAIM` back to 0.4; rows born at 0.25 stay at it unless a store's owner says.

## Due a week after the night's own line (2026-10-30, NL1, ROADMAP's decision marked for Mike's review — no switch) — checked 2026-11-07 ("Checked 2026-11-07" above); re-read ~11-14

**What we're trying.** After the page, the reflection may send one or two whole sentences for whoever wakes tomorrow:
what stays from the night that the page doesn't say, as what happened. A fresh writer met the brief on 7 of 7 past
nights, 228-280 B, no morals. That was one pass by a writer given only the brief, so it says nothing yet about the nightly
run, where the line is one field among many.

**What to look at (read-only).** ROADMAP reads a week of real lines:
`SELECT date, page_version, json_extract(detail,'$.build') b, json_extract(detail,'$.lineRefused') refused, json_extract(detail,'$.line') line FROM reflections WHERE state='reflected' ORDER BY date DESC LIMIT 7`.
A NULL `line` on a new build means it wasn't sent; `''` means left empty, or sent back twice when `refused` is 2. For each
line: does it state a lesson, does it say what that night's page version already says (`versions` for the self page), does it
carry a bare id like `m32` (ids in words aren't rewritten), and how many bytes. Also count nights with no page written.

**What would change it.** Morals on more than about 2 of 7: tune the ask. Repeats of the page on more than about 2 of 7, or
mostly NULL: move the ask to its own step after the first `finish`, and fence that step (`server.ts#nightReading` stops at
`begun`). Sent back often: 300 B is too tight or the wording undersells it. Bare ids: strip or spell them where WK2 reads
it. Empty often is fine in itself, as long as those nights were quiet ones. **Revert.** Take the `line` bullet out of
`Reflections#instructions`; nothing is sent after that, and what's on old rows does nothing.

## Due ~1 week after recall stopped dropping late turns (2026-10-30, LT1, ROADMAP's decision marked for Mike's review — a fix, no switch) — read 2026-11-03 (partial), below; week read 2026-11-07 ("Checked 2026-11-07" above)

**What we're trying.** A turn past `BUDGET_MS` shows its finished answer and says `lateMs`, where it used to show
nothing. Recall also got a covering index on the word index and stopped compiling a regex per card per prompt. On a
copy: cold build 416 → 110 ms, cold process 724 → 400 ms, what's shown byte-identical. A copy can't show the part
that matters, a laptop under load on the live file.

**What to look at (read-only).** First that it took: `SELECT name FROM sqlite_master WHERE tbl_name='doc_tokens'` on
`cache/cache.sqlite` lists `doc_tokens_cover`, and the `postings` lap in `runner.steps` was the build's time, once.
Then a week of `recall.decision`, split by build:
`SELECT json_extract(payload,'$.build') b, COUNT(*) n, SUM(json_extract(payload,'$.lateMs')>0) late, MAX(json_extract(payload,'$.lateMs')) worst FROM events WHERE name='recall.decision' GROUP BY b`,
and the median of `$.elapsedMs` per build. Older builds wrote no row for a dropped turn: their count is
`adapter.recall` rows with `reason` `latency-abort`. From the process log (`sessions/log/*.log`, `proc` `hook:user-prompt-submit`,
`process.end`): prompt `ms` p50, p90, max, and how many over 5,000.
Baseline: dropped turns 5.5% (158 of 2,887, days 30-38), `elapsedMs` p50 411 and p90 699 on day 38, prompt `ms` p50 512 and p90
1,174 on 10-29, max 25,457 over 10-23 to 10-30.

**What would change it.** `elapsedMs` p50 not well under about 200 ms: check the index took, then read the live file's
`page_count` and `freelist_count`, since `VACUUM` alone moved a copy's cold build 355 → 240 ms. Late turns well above
about 1% with big `lateMs`: that's stalls, so it's time for a real deadline inside `activate` (recall `NOTES`, LT1, still
open). Prompts over 5,000 ms staying common: a held lock is the likely cause, and the 30 s against 11 s question in
`docs/decisions.d` wants answering. **Revert.** The commits are small. Without the index, recall just reads as it did:
`DROP INDEX doc_tokens_cover; CREATE INDEX doc_tokens_token ON doc_tokens (token)` on the cache, or a rebuild on the older build.

## Due ~1 week after the worker's cost (2026-10-30, W1, coordinator's brief marked for Mike's review — a fix, no switch) — read 2026-11-03 (partial), below; week read 2026-11-07 ("Checked 2026-11-07" above)

**What we're trying.** The per-turn worker reads what the sidebar's file carries rather than 60 full memory cards, and
the boundary's reserve reads the settled pairs once. On a copy of the corpus: 3.4 s to 1.0 s per worker, after-done
2.5 s to 0.6 s. A laptop under load is what we actually care about, and a copy on a quiet machine can't show that.

**What to look at.** A week of the live log, `~/.counterparts/store/sessions/log/*.log`, lines with `proc` `worker`, split at
the release date. Worker ms from `process.end` (p50, p90, max), the after-done share (time from `runner.done` to
`process.end` over the whole), and `runner.steps` for which step holds what is left. Baseline, 10-29: 209 workers, p50
6.4 s, p90 12 s, max 42 s, 1,593 s in the day, 75% after done. Also how many workers overlap: two or more at once for
120 s of 10-29, and 809 s of 10-30 by about 15:00 UTC (108 workers, at most four, 10 over 100 s, 2 past 300 s; 655 s of
the overlap between 12:50 and 13:10 UTC). A bad stretch like that one is part of what this has to answer: read it apart
from the p50.

**What would change it.** p50 at or below about 2.5 s and after-done under about half: keep, and drop `runner.steps` from
`LOGGED` if the rows have stopped being read. p50 still above about 4 s: read the row for the step, and the wake step on
the turns it re-renders first. Workers still overlapping for minutes a day: `docs/decisions.d/fix-worker-after-done.md`
decided against collapsing them on the old numbers; decide again. **Revert.** The commits are small; nothing to migrate.

## Due ~2 weeks after the 10-29 knobs (K1, the 10-29 read, coordinator's call marked for review — `recall.PRIME_TRAIN_SHARE`, `schemas.TAGS_KINDS_PER_NIGHT`, `self.project.line`)

**What changed.** (1) Context priming's train of thought gives no head start (`PRIME_TRAIN_SHARE` 0, was 0.5); links
and tags still prime. (2) The night's kinds ask covers 30 cards a night (was 10). (3) The wake's project line leaves a
durable row, `self.project.line`. Plus a finding, no change: why the beliefs slot only ever shows `sch_305a1aabc8fa`.
Reasons and costs: `docs/decisions.d/chore-read-1029-knobs.md`.

**What to look at, by build (read-only), from the release that carries it; re-check ~2026-11-13.**
- *Priming.* Footnote ratings by build and by priming source, the read's split: train-lifted was 44% noise / 11% useful
  (n 199; person turns 48% / 6%), link-lifted 22% / 50% (n 18), tag-primed 18% / 29%, unprimed 44% / 17%. **Bar:**
  `primed.byTrain` 0 on every row of the new build (anything else is a setting that didn't take); overall footnote
  noise not up and useful not down against 10-26..28 (noise 38–43%, useful 15–22%); shown per person turn not below
  ~1.1. Revert (`recall.PRIME_TRAIN_SHARE=0.5`) if useful falls with nothing else to explain it.
- *Kinds.* `SELECT COUNT(*) FROM memories WHERE type='schema' AND json_extract(meta,'$.role')='entity' AND kind != 'self' AND archived=0 AND body != '' AND subject_kind IS NULL`
  each morning (144 on 10-29), and each night's record in `meta` (`tags.night.<run>`: what the night set). **Bar:** the kindless
  count falls by ~20 a night until it reaches the ~10 born a day; the tags child doesn't time out (`dream.night`
  children, `code`), no `mcp.result.oversize` for phase `tags`; spot-check ten kinds the night set (people a person,
  Counterparts a project). Too many wrong → back to 10, or a smaller model ask.
- *Project line.* `SELECT json_extract(payload,'$.reason') r, COUNT(*) FROM events WHERE name='self.project.line' GROUP BY r`,
  and `ids` of the shown ones. **Bar:** it can now be read at all; if it shows on most project wakes, read whether
  sessions drew on it (ratings, quotes of the ids); if it is mostly `below-floor`, it has nothing to say yet; if it is
  mostly `no-room`, it costs nothing and shows nothing. Keep or retire it on that read (`self.WAKE_PROJECT_LINE=false`).
- *Beliefs slot (finding).* Not dated: read it when 3+ beliefs about other people pass the 0.3 floor. Did they
  show, and how were they rated against the footnotes? Beliefs about me or us stay page-only, as designed: no ambient
  door (decided 10-29; `src/core/recall/NOTES.md`, 2026-10-29).

**Revert.** `recall.PRIME_TRAIN_SHARE=0.5`; `TAGS_KINDS_PER_NIGHT` back to 10 in `src/core/schemas/tunables.ts`; the
project line's row goes with the line (`self.WAKE_PROJECT_LINE=false` writes none).

## Due 3–4 nights after the page split (2026-10-23, Mike's go, very lightly held, an experiment — `self.PAGE_SPLIT`)

What: the night writes the page in two lanes instead of two whole-page rewrites. The page writer, in a child of its
own and first, amends every section but `## Core` from the day; the reflection writes `## Core` alone; each held at
the door (what is outside a lane is kept as it stood, and said). A sentence kept word for word keeps its cites.

Look at, per night since install (read-only):
- one writer and one reflection version a night, each touching only its sections:
  `SELECT json_extract(payload,'$.by') AS by, json_extract(payload,'$.laneKept') AS kept, COUNT(*) FROM events
   WHERE name='self.page.revised' AND day >= <install day> GROUP BY 1, 2;`
  (`laneKept` non-null means a write strayed and was held; a few is fine, every night is a prompt to fix);
- `## Lately` current (it names the last few days), `## Core` stable night to night (Mike reads the pages);
- cites kept: `claimsCarried` on the same rows, and the share of page sentences with a cite (5 of 62 on 10-23);
- the dream child's context smaller (its `childUsage`, once logged), the writer child's own cost, and doctor's
  Nightly run line for "the page writer was missed";
- the page's size: the reflection can only cut Core when held past the room.

Changes it: Core drifting or empty, Lately stale, the writer missed most nights, or Mike preferring the old pages.
Revert: `self.PAGE_SPLIT=false` (one switch: the writer back inside the dream's child, both rewriting the whole
page, nothing carried), or revert the PR.

## Due 7 nights after the day summary (2026-10-23, Mike's go 15:32, lightly held — `self.DAY_SUMMARY`)

What: day's end leaves a few lines about the day (600 characters at most) with its closing `self_page` call, on the
night's `self.page.writer.ran` row; the dream's bundle opens with it ("## today, as day's end told it"); the
reflection reads the last 21 days a line a day (a day without one, by its chapters). Replay on the 10-23 corpus: the
dream +~640 characters, the reflection +~5k (4 parts either way, the same memories shown).

Look at, after 7 nights (read-only):
- a summary every night: `SELECT json_extract(payload,'$.about'), json_extract(payload,'$.outcome'),
  length(json_extract(payload,'$.summary')) FROM events WHERE name='self.page.writer.ran' AND
  json_extract(payload,'$.summary') IS NOT NULL ORDER BY seq;` and the dream opened with it:
  `SELECT json_extract(payload,'$.daysEnd') FROM events WHERE name='dream.begun' ORDER BY seq DESC LIMIT 7;`
- read 3 dream journals (`counterparts night show <drm_…>`): do they open from the day summary's framing?
- does the reflection's entry name a pattern across days it could not have seen before (one older than the 3 days of
  chapters)?
- Mike reads.
- ~~the known misread (0.3.34)~~ **fixed in 0.3.35 (#609)**: a summary sent alone and then a page now reads `revised`
  and keeps the summary. For nights on 0.3.34 only, the old reading: a night whose `self.page.writer.ran` row says `nothing-to-say` with a summary,
  followed by a page version from day's end that same night, means it sent the summary alone and then wrote a page
  anyway: the row misreads that night. Count how often: the nights from `SELECT json_extract(payload,'$.about')
  FROM events WHERE name='self.page.writer.ran' AND json_extract(payload,'$.outcome')='nothing-to-say' AND
  json_extract(payload,'$.summary') IS NOT NULL;`, each beside that night's page versions (`counterparts night
  last` / the dashboard's page strip); a few is the prompt's slip, many is a fix.

Changes it: journals that only echo the summary, a reflection that reads the timeline as instructions, summaries
past the cap night after night. Revert: `self.DAY_SUMMARY=false` (no summary asked for or kept; the dream's and the
reflection's bundles exactly as before), or revert the PR.

## Due 3–4 nights after day's end (2026-10-23, Mike's go 15:32, lightly held — `self.DAYS_END_INPUT`, `dream.REFLECT_ROOM_ORDER`)

What: the page writer is called day's end and reads the day as told (each chapter of the day by its summary, with
its address; the day's 12 strongest memories with ids, which Lately may cite). The reflection's room is filled long
view first: the page, its last reflections and the dream's own summary; the whole core, the candidates (every one
until 0.3.35's cap: 30 a night since) and the 10 most felt, a line each at least; the last 3 days' chapters by their summaries; what the dream changed and at most
40 older memories it saw (tonight's new ones only in `recent`); then the rest. Replay on 10-22/10-23: shownAs went
from 0 core / 0 candidates (lined 75, all chapter lines) to every core memory and candidate lined, at 89–92k a night
across 4 parts (was ~105k).

Look at, per night since install (read-only):
- the reflection showed the long view every night, core, candidates and felt each shown (0.3.34's release check:
  the shownAs on a copy): `reflections.detail` `fit` (`lined` and `whole` ≥ core +
  candidates) and `chaptersAs = 'summaries'`. Until 0.3.35 a finish dropped `chaptersAs`, so this finds only begun
  rows on 0.3.34; from 0.3.35 a finished row keeps it, with the lanes shown (`detail.lanes`):
  `SELECT date, state, json_extract(detail,'$.lanes'), json_extract(detail,'$.fit') FROM reflections WHERE json_extract(detail,'$.chaptersAs')='summaries';`
- Lately reads as the day, and cites: the page's trace (`counterparts doctor`'s "Self page claims" line, claims with
  no memory behind them falling from 57 of 62);
- one page version per child per night (with the page split's check above);
- Mike reads the pages.

Changes it: Core or the reflection's entries getting worse without the chapters' words (it can recall a chapter by
its address: count recalls of `epi_…#N` in the reflection child), Lately thinner, or a night's parts going past 4.
Revert: `dream.REFLECT_ROOM_ORDER=false` and/or `self.DAYS_END_INPUT=false` (each puts back exactly what was), or
revert the PR. The name stays either way.

## Due 3–4 nights after the candidates' cap (2026-10-24, R1, Mike's go 10:58, lightly held — `dream.REFLECT_CANDIDATES_CAP`)

What: the reflection is shown at most 30 core candidates a night (`REFLECT_TUNABLES.CANDIDATES`): the 20 strongest
felt and newest, and 10 rotated through the rest, the least recently shown first (by the `shown` of the last 30
reflections), so every candidate still comes round to be cited, felt and marked — the reflection's cites and feelings
are the core lanes' strongest feed. The rest are one line, "+N more candidates, not shown". Replay on the 10-24
corpus (composition only): candidates 132 → 30, their lines ~29.3k → ~8.6k, the bundle 85.1k in 4 parts → 73.6k in 3.

Look at, per night since install (read-only):
- the counts every finished reflection keeps — core, candidates, felt shown and the candidates not shown:
  `SELECT date, state, json_extract(detail,'$.lanes.core') AS core, json_extract(detail,'$.lanes.candidates') AS candidates, json_extract(detail,'$.lanes.felt') AS felt, json_extract(detail,'$.lanes.candidatesNotShown') AS not_shown, json_extract(detail,'$.fit.parts') AS parts FROM reflections WHERE json_extract(detail,'$.lanes') IS NOT NULL ORDER BY started_at;`
  candidates 30 while there are more than 30, not_shown about the backlog less 30, parts 3 where they were 4;
- promotions keep coming (`core_events` `promoted` by day), from the tail as well as the head: a candidate promoted
  that was outside the night's first 20 says the rotation works.
- the felt lane: the cut candidates join its pool (replay: felt of 24 → 50). Do its 10 slots fill with candidates the
  cap cut instead of the other felt memories (people, moments)? `lanes.feltFromCut` counts the felt shown that were
  cut candidates (recorded from 0.3.35's fix to this lane; absent on rows before it):
  `SELECT date, state, json_extract(detail,'$.lanes.felt') AS felt, json_extract(detail,'$.lanes.feltFromCut') AS felt_from_cut FROM reflections WHERE json_extract(detail,'$.lanes.feltFromCut') IS NOT NULL ORDER BY started_at;`
  a night or two at 0–3 of 10 is the pool doing its job; most nights at 7+ of 10 means felt has become a second
  candidates lane, and `feltAll` should filter on every candidate, not the capped ones.

Changes it: the core stops growing, or the reflection's entries or the page lose a thread they used to carry from an
older candidate. Revert: `dream.REFLECT_CANDIDATES_CAP=false` (every candidate, exactly as before; the lane counts
are still kept), or revert the PR.

## Due 3 nights after the unmarked offer's record (2026-10-24, D1, a fix — no switch of its own)

What: from 10-10 to 10-23 no reflection row recorded `detail.unmarked`. On a night with a dream the fixed parts (the
dream's saw list, the chapters, the page) took the whole room, the offer's reserve was bounded by what was left (0),
every offered id waited and was dropped, and an empty offer wrote no key. 0.3.34's room order (`dream.REFLECT_ROOM_ORDER`)
already shrank the fixed parts; this fix holds the offer's lines back like the long view's, whatever the room, and
always records it: `detail.unmarked` (the ids offered, `[]` too), `detail.unmarkedMarked` (the offered ids it marked,
across finishes), and `counts.unmarkedOffered` / `counts.unmarkedMarked`. The 10-24 night (0.3.35) may already show
an offer; the "every row has the key" check starts at the first night of the release that carries this.

Look at, per night since install (read-only):
- every reflection row has the key, and how many it was offered and marked:
  `SELECT date, state, json_type(detail,'$.unmarked') AS has_key, json_array_length(detail,'$.unmarked') AS offered, json_array_length(detail,'$.unmarkedMarked') AS marked, json_extract(detail,'$.counts.unmarkedOffered') AS c_offered, json_extract(detail,'$.counts.unmarkedMarked') AS c_marked, json_extract(detail,'$.build') AS build FROM reflections ORDER BY started_at DESC LIMIT 7;`
  `has_key` should read `array` on every row from the release on (a begun, unfinished row too);
- the marks themselves, per night, and where they went:
  `SELECT r.date, m.about, COUNT(*) FROM reflections r, json_each(r.detail,'$.unmarkedMarked') j JOIN memories m ON m.id = j.value GROUP BY r.date, m.about ORDER BY r.date;`
- the pool: `SELECT COUNT(*) FROM memories WHERE type='memory' AND archived=0 AND about IS NULL AND kind IN ('fact','entity','place','skill') AND origin_scope LIKE '/%' AND COALESCE(source,'') NOT IN ('dreamed','reflection');`
  (about 13 on the 10-24 copy, after Mike's 10-21 hand pass).

Changes it: `offered` 0 on a night the pool is not empty means the offer is filtered before the fit — first suspect
the folder setting (`server.ts#folderOn` answers "off" for every folder when the scopes file will not read, which
drops every candidate, all of which carry a directory scope). Marked 0 for three nights with a pool says the prompt
line is ignored, not lost: read an entry's `about` part. Revert: the record is a record; the room change goes with
`dream.REFLECT_ROOM_ORDER=false` (#383's bound, as before), or revert the PR.

## Due ~7 nights after own-write (2026-10-24, R2, Mike's go, lightly held — `physics.OWN_WRITE_GATE`) — checked 2026-11-01, below

What: use credit refuses the session that wrote a memory on its birth day (`own-write`), not every session. Another
session that draws on a newborn memory credits it once that day (0.1, a glimpse); unknown or unbound writers ("mcp",
a null origin) keep the old birth-day rule, and a return on the birth day is still refused for everyone. With
parallel sessions, new memories will now routinely get a reinforced day at birth, which feeds promotion.

Look at, over ~7 nights since install (read-only):
- promotions by day (`core_events` `promoted`) and the core's size, against the week before: a clear jump with no
  change in what is written says birth-day credit is pushing memories through;
- how many memories got a use on their birth day from another session, and whether they are the ones being promoted.

Changes it: core growth that outruns the reflection's capacity to read it, or promotions of memories that were only
glimpsed. Revert: `physics.OWN_WRITE_GATE=false` (exactly as before), or revert the PR.

## Due ~7 nights after daily consolidation (2026-10-24, E1, Mike's go 14:19, lightly held — `sleep` `CADENCE.consolidate`) — checked 2026-11-01, below

What: the consolidate phase, which decides the core, runs at every lived day's sleep instead of every third. The only
reason given for 3 was v0's "every 3 days"; eligibility is arithmetic over rows written in real time, so waiting
gained nothing. The cap stays at 3 a night (`CORE_MAX_PER_SLEEP`), now literally per night. Replay on the 10-24
corpus: the same 12 core at the end and the same 12 promotions, landing earlier (the first three on day 8, not day
10); at most 3 on any night (day 8: 3, day 9: 2). On the live record the last
consolidation (lived day 31) had nothing waiting at the cap, so the first daily night should promote 0–3, not a burst.

Read it together with R2's own-write entry (0.3.35: a memory can be credited the day it was written by any session
but the writer's, so a newborn can earn a reinforced day at birth). R2's entry is just above; both
feed the core, so split the nights by build: R2 alone from 0.3.35's arrival day, both from 0.3.36's (`meta`
`build.<version>.since`; `counterparts doctor`'s Builds line).

Look at, per night since install (read-only):
- promotions per lived day, by lane: `SELECT day, COUNT(*) AS promoted, GROUP_CONCAT(lane) AS lanes FROM core_events WHERE action = 'promoted' GROUP BY day ORDER BY day DESC LIMIT 14;`
  expect 0–3 most nights, where it was 0–3 every third night (live, lived days 10 → 31: 3, 3, 3, 3, 2, 1, 0, 1);
- the consolidate pass every night, and what waited at the cap: `SELECT e.day, json_extract(e.payload,'$.promoted') AS promoted, json_extract(c.value,'$.skipped."promotion:cap"') AS cap_waiting, json_extract(c.value,'$.status') AS status FROM events e, json_each(e.payload,'$.phases') c WHERE e.name = 'sleep.cycle' AND json_extract(c.value,'$.phase') = 'consolidate' AND json_extract(c.value,'$.status') LIKE 'ran%' ORDER BY e.seq DESC LIMIT 14;`
  one `ran` / `ran-nothing-found` row per lived day; `cap_waiting` empty or small;
- the core's size (`counterparts core`, or the dashboard's Self page) against 0.3.35's.

What would change it: a core growing faster than ~3 a week for more than a week, or promotions Mike reads as wrong
(a memory demoted soon after). Revert: `CADENCE.consolidate` back to 3 in `src/core/sleep/tunables.ts` (one number;
the dashboard and mechanisms read it).


## Due ~7 lived days after cue learning (2026-10-24, R3, Mike's go 14:01, ships on its own store bump — `physics.CUE_LEARNING`) — checked 2026-11-01, below

What: a credited use or a rating of a shown memory wires that turn's index words to it (`cue_edges`: token, memory_id,
weight, last_day, source); a learned pair then reads as one more cue at the word's share of the turn, so a bare word
can bring its memory back loud after a few credited uses (the ping → pong demo: 4th → 1st loud after 3 credits in the
test). Bounded per pair (`CUE_W_CAP` 1), per word (`CUE_MAX_OUT` 1.5), fading with lived days (`S_CUE` 60). Only words
already in the word index are learned; an owner erase deletes the memory's pairs.

Look at (read-only):
- growth and shape: `SELECT COUNT(*) AS pairs, COUNT(DISTINCT token) AS words, COUNT(DISTINCT memory_id) AS memories, ROUND(MAX(weight),2) AS top, ROUND(AVG(weight),3) AS mean FROM cue_edges;`
  and the strongest: `SELECT token, memory_id, ROUND(weight,2), source, last_day FROM cue_edges ORDER BY weight DESC LIMIT 20;`
  expect a few hundred pairs a week, a handful near the cap; a token with dozens of memories means a common word slipped through;
- the demo, live: a bare "ping" in a fresh session brings the ping memory back first and loud;
- footnote ratings (noise vs useful, mem_2d998d1c230c baseline 47% / 18%) by build, from `recall.rated`: learned pairs
  should not raise noise.

Not stored: how many memories a learned pair reached each turn (`learned` on the activation stats is reported, not
recorded), so whether a footnote came by a learned pair can't be read from the store yet; adding it to
`recall.decision` is a follow-up if the check needs it.

Changes it: noise rising, a common word wiring to many memories, or a memory Mike reads as wrong surfacing by a learned
word. Revert: `physics.CUE_LEARNING=false` (nothing recorded, trained or read; the table stays), or revert the PR.

## Due ~7 lived days after the cue stop-list (2026-11-01, R3S, Mike's call 11-01, lightly held; shipped in 0.3.45 beside #710, #712 and #714, read live and by build, split by turn)

What: words on `associate.CUE_STOP_LIST` (path fragments `tmp uds sock cross etc usr var`, a hex id of 7+ characters,
acknowledgements `sounds good ahead let okay yes yeah yep sure fine cool great thanks fyi`) learn no cue pair, dropped
at the cue flush and counted (`cueStopped` on the `associate.flush` row), and their old pairs are not read. No row was
edited: old stop-listed pairs stay in `cue_edges` and fade and are swept as any pair does. On the 11-01 copy they were
317 of 3,184 pairs (about 10%, and 10% of the weight), so this is hygiene, not the cause of the ~10× growth.

This was meant to ship alone so a before-and-after would be its own. It didn't: 0.3.45 also changes the night (#712), the write path (#714) and raw retention (#710, #715). From v0.3.44 to this release `src/core/recall`, `associate` and `physics` change only through R3S's commits, so those three could move footnotes only indirectly. New pairs and `cueStopped` are this list's own and read as they are.

**The main read is live, by build, split by turn:** turns holding a listed word against turns with none, on footnotes per turn and rated noise / useful, 0.3.45 against the 11-01 read. Turns with none are the control: on the copy 5 of 5 didn't move, and anything else in the release would hit both groups. This may touch many turns rather than a corner, since the list is everyday replies; the share isn't measured. Listed-word turns against the rest, joined through the host's transcripts (`~/counterparts-notes/2026-11-01-briefs/habituation-replay/moments.py`, its dates moved; Claude Code sessions only, about 94% of turns matched on 10-26..31). Read-only, counts only in the output; the prompt text stays in temp. The before side comes from the same script on the same fresh store copy, with pre-0.3.45 dates. Limits: other hosts' turns don't get split, and the match is by time, not a shared id. Match listed words with the shipped `cueStopPredicate`, not a copy of the list. `recall.rated` joins `recall.decision` by `session` and `turn`.

If a replay is wanted, it's `~/counterparts-notes/2026-11-01-briefs/habituation-replay/replay.ts` on a store copy with a second arm with the list emptied. That needs a small change: it overrides only `cp.recall.tunables`, and `cueStop` is set in the Associate constructor. It's an estimate (that replay reproduced 66.5% of live footnotes) and counts only: footnotes R3S adds have no rating in a replay, so it can't say whether they're noise. `tools/replay/` doesn't do this (it feeds v1's recorded month into a fresh store), and `harness --set associate.CUE_STOP_LIST` is refused; `compare --base/--branch` is the harness's way. ROADMAP holds this read.

Look at (read-only, rows since the release that carries it, 0.3.45; `<ms>` its install time, `<build>` `0.3.45`):
- new pairs a week: `SELECT COUNT(*), COUNT(DISTINCT token), COUNT(DISTINCT memory_id) FROM cue_edges WHERE created_at >= <ms>;`
  against the 11-01 read's ~3,200 in its first week. That week began from an empty table and a retrained pair keeps its
  `created_at`, so this number falls some with no change at all; `updated_at >= <ms>` counts pairs touched;
- the stop-listed share of what training sent: `SELECT SUM(json_extract(payload,'$.cueStopped')), SUM(json_extract(payload,'$.cueDeltas')) FROM events WHERE name='associate.flush' AND json_extract(payload,'$.build') >= '<build>';`
  (a string compare, fine while versions keep their width). `cueStopped` is new, so there is no 11-01 count. The nearest
  baseline: on the 11-01 copy 7.4% of the words in recorded turns were on the list (1,473 of 19,806), an estimate, since
  not every turn is credited; the 10% is of pairs, another unit. And no new row on a stop-listed word:
  `SELECT token, COUNT(*) FROM cue_edges WHERE created_at >= <ms> AND token IN ('tmp','uds','sock','cross','etc','usr','var','sound','good','ahead','let','okay','yes','yeah','yep','sure','fine','cool','great','thank','fyi') GROUP BY token;` (expect none; hex ids aren't named here, `cueStopped` counts them);
- the widest new words: `SELECT token, COUNT(*) n FROM cue_edges WHERE created_at >= <ms> GROUP BY token ORDER BY n DESC LIMIT 20;`
  (counts only; without the `created_at` the old listed rows, still in the table and not read, top it): a new fragment or
  filler class at dozens of memories is the next candidate;
- footnote ratings by build from `recall.rated` (noise / useful), read as R3's row reads them: the 11-01 read was 40.7% /
  16.7% (n 1,500). Expect a small move at most: a listed word still matches a memory that holds it, only its learned
  pairs are gone. Read turns made of listed words on their own: the turn's bar is relative, so quiet pairs lower it and other
  memories clear it. On the 0.3.45 copy, of 7 such prompts through the hook, footnotes went 1→4, 1→5, 2→1, one swapped, 3 the
  same; 5 prompts with no listed word didn't move. "sounds good, go ahead" can bring more footnotes, not fewer.

Changes it: a stop-listed share well above the 7–10% above, or new filler or path words at the top of the fan-out → widen
the list or move to a rule (a minimum informativeness for learned words) instead of naming words. Growth still ~3,000 a
week with the noise share small → the growth is ordinary words and the question is the training rate or the floor, not this list.
Listed-word turns getting more footnotes than the control, with noise up on those turns → look at the relative bar or a floor on those turns; the list staying right and the bar being wrong is a possible outcome, so don't default to pulling the list.
A stop-listed word Mike wants learned → take it off. Undo: `CUE_STOP_LIST = []` (nothing filtered, cue learning exactly
as before, the old pairs read again).

## Due ~2026-11-06: folds keep named ids (2026-10-30, FI1, a lost-information fix; no switch of its own, `recall.SEE_ALSO_NAMED_IDS` still rules what's read)

What: a fold or merge writes `Names: mem_…, mem_…` as its last line, with what its sources named and it didn't: each
as the memory that holds now, never a source, never one recall couldn't show, never one closed to the night, at most
4 named in all. See-also reads that line, and now asks the folder setting of what it would bring.

Read (read-only, by build):
- `SELECT dream_id, ref, json_extract(detail,'$.names'), json_extract(detail,'$.namesPast') FROM dream_changes WHERE
  action IN ('gist','merge') AND undone = 0 AND json_extract(detail,'$.build') >= '<the build that carries it>'`: how
  many folds and merges kept any, and how often `namesPast` is above 0 (if often, 4 is too few).
- For a fold that kept one: `recall.decision` rows whose footnotes have `via: "see-also"` and `seeAlso.by` that fold,
  and the `recall.rated` scores for those ids against plain footnotes (the PP1 check's bar).

Not this check: the bare "ping" on the live store. The 10-27 fold keeps no id, and only new folds carry them, so that
ping fails before and after. On a copy of the 10-30 snapshot, a new fold over two notes naming the rule kept its id,
and once the fold had a learned pair (seeded at 0.5, what one rated use writes) the bare "ping" brought the rule as
`See also`, by that fold. That night's bundle didn't offer those notes, so they were written into the copy's `shown` by
hand; a real night folds what it's shown. With no learned pair of its own a new fold doesn't show for a bare word, so it
brought nothing yet.

Changes it: see-also'd memories from folds rated worse than plain ones, kept ids that are mostly noise (a fold's sources
naming each other's neighbours), or folds with a line of ids rated or found worse by meaning, since the ids move the
vector (numbers in the decision; leaving the line out of what's indexed is the fix to try). Revert: the PR; what's
written stays as text, and is harmless.

## Due ~3 lived days after see-also from named ids (2026-10-29, PP1, ROADMAP go 10-29 13:09, an experiment — `recall.SEE_ALSO_NAMED_IDS`, `SEE_ALSO_MAX`, `SEE_ALSO_TITLE_BYTES`) — checked 2026-11-02, below; re-check ~11-09

What: a memory a turn shows (loud or a cued footnote) whose text names another memory's id (`mem_…`) brings the
memory that holds now along as one `See also:` footnote, one per shown memory, two a turn, after every other
footnote; never one the turn could not show (removed, archived, superseded, below reach, a belief…), already shown
this turn or session, written by this session, habituated, or inhibited. It is credited and rated as an ordinary
footnote: a use trains the turn's words to it. Estimated from the 10-29 snapshot: 42 of 1,711 footnotes would have
brought one along (~2.5%).

Read (read-only, by build):
- how many ride along, and how they are rated against plain footnotes, joined by session and id:
  `SELECT json_extract(f.value,'$.via') AS via, COUNT(*) FROM events e, json_each(e.payload,'$.footnotes') f WHERE e.name='recall.decision' AND json_extract(e.payload,'$.build')='<build>' GROUP BY via;`
  then the `recall.rated` rows' scores for the see-also'd ids (`seeAlso.by` names the memory that brought each)
  against the footnotes of the same days. **Bar: see-also'd memories rated at least as well as footnotes**
  (mean score, share rated 0);
- the ping demo on the live store: after install, a bare "ping" in a fresh session shows the rule
  `mem_0ca7f032368a` — by see-also beside the note `mem_66bb7d836201` the first time; once a session has used
  the rule, `cue_edges` has `ping → mem_0ca7f032368a`, and a later fresh "ping" shows the rule with no `via`.
  `SELECT token, memory_id, weight FROM cue_edges WHERE token='ping';`
- bytes: `bytes` and `budgetTrimmed` on turns with a see-also'd footnote against the rest; a see-also line is
  ≤ 132 bytes, ≤ 342 for two with the footnote header.

Changes it: see-also'd memories rated worse than footnotes (noise: lower `SEE_ALSO_MAX` to 1, or read only the
footnotes' texts), or the rule still missing "ping" after a credited use (look at the turn's `seeAlso.by` and the
rule's verdict). Revert: `recall.SEE_ALSO_NAMED_IDS=false`.

## Due ~3 nights after S2 (2026-10-26, Mike: "sounds good", lightly held — `coverage.UNRECORDED_OWED_PIECES`, `dream.OWED_COUNTS_AS_NEW`)

What: an ended session that left no record of its own (no handback, "nothing new", chapter or write-up) is owed
from one unwritten piece, whatever its span; in-session notes still claim their own turns. When a night would run for
its catch-up alone (`too-little-new`), each session owed from an earlier day counts as one new memory toward the
dream's three. "Last here" names a later session with no chapter (with its newest memory) before the older chapter.
H0 `checkins`: 0 → 10 of 10 owed, no night → a night every morning (3 whole), 10 parts in the week, one a check-in.
Estimated on the 10-24 corpus snapshot (12 days, 10-12..10-23, from the `adapter.ask`, `coverage.*` rows): ~2.6 more
sessions owed a day (~1.3 unwritten pieces each, one small part each) beside ~0.6 owed before; nights then plan ~7
parts where they planned ~5. A one-time bump the first night after install: what ended in the last ~3 days with
unwritten pieces (~8 short parts).

Read (read-only, by build; never the live store's text):
- owed rows per day and their size: `SELECT substr(json_extract(payload,'$.from'),1,10) AS d, COUNT(*), SUM(json_extract(payload,'$.pieces')) FROM events WHERE name='coverage.owed' AND json_extract(payload,'$.build')='<build>' GROUP BY d;`
  expect ~3 a day, most 1–3 pieces;
- the night's catch-up rows (`adapter.night.writeup`): `parts`, `written`, `left`, `batches` per night — expect one
  batch and `left` 0 on an ordinary day; `doctor`'s Catch-up line, and whether "N short headless runs (claude -p, the Agent SDK)"
  (since S2c; was "N small, not known as a person's session") or "lost unwritten this week" grow (headless `claude -p` sessions under the floor are owed in
  the ledger, kept and never taken — `pointable` holds them to the floor: if that count climbs, give the ledger
  the host's word on who is a person); and nights launched as `night:owed-as-new` that ended as the catch-up alone
  (`dream.night` children `skipped-too-little-new`): the catch-up did not deliver what the gate counted;
- the write-ups themselves: second-hand memories of a short session (`json_extract(meta,'$.secondHand')`), and how
  many parts were answered `[]` with a reason — a lot of "nothing worth keeping" says the one-piece floor is too low;
- a morning wake in a folder with check-ins after a chapter: "Last here" names the newest session, then "Before it".

Changes it: write-ups of one-line sessions that are all noise (raise `UNRECORDED_OWED_PIECES`), or a night that no
longer fits (parts `left` > 0 on ordinary days). Revert: `coverage.UNRECORDED_OWED_PIECES=1e9`,
`dream.OWED_COUNTS_AS_NEW=false`; the "Last here" change has no switch (revert the PR's `laterHere`).

## Due ~5 days after Today so far (2026-10-24, W1, Mike's go 17:45, lightly held — `self.TODAY_SO_FAR`, `self.YESTERDAY_FROM_SUMMARY`)

What: at a session start the wake carries "Today so far here:" under the Yesterday line: today's chapters written in
this folder before the one "Last here" names (newest 4, each by time, title, id and its summary's first sentence cut
at 120 bytes), and "Last here" no longer lists them as "Before it" / "+N more". The Yesterday line opens "Yesterday,
in day's end's words:" with day's end's summary when (a) every memory it cites is nameable in this wake, (b) every
chapter that day is from this folder or a scope-on folder, and (c) every folder that wrote a memory that day is too
— archived and merged rows included, a memory lived that day included wherever it was written up, and a row with no
folder failing it (review of #614). Otherwise the old chapter list. Corpus replay (10-24 corpus, 15:00 on 10-23, every folder's scope on): ~/counterparts
8,799 → 8,941 bytes, ~/counterparts-phone 8,628 → 8,673; the new line cost 3 "Still open" items in each (Still open
keeps its first item and its count); start time within noise (numbers in the PR). W1b (10-24, Mike 21:11, lightly
held): the summaries now step down to titles before "Still open" drops an item — on the same replay Still open keeps
2 items instead of 1 in both folders, and "Today so far" shows titles only.

The wake writes no row, so read it where it lands (read-only):
- two or three mid-day session starts, one in ~/counterparts and one in another folder: the SessionStart context in
  each transcript. Each chapter named once; "Today so far" ≠ "Today, elsewhere"; nothing from a scope-off folder;
- whether the summary ever shows. Day's end's summaries: `SELECT json_extract(payload,'$.about') AS about, json_array_length(json_extract(payload,'$.summaryCites')) AS cites FROM events WHERE name = 'self.page.writer.ran' AND json_extract(payload,'$.summary') IS NOT NULL ORDER BY seq DESC LIMIT 7;`
  then replay the next morning's wake on a copy of a nightly snapshot in a temp dir (never the live store) to see which
  gate held it back. Expect it to fall back on days with work in a scope-off folder, or with a cited work memory from
  another folder (only about-me cites cross);
- whether the Still-open items it costs in a full wake are missed (Mike's read; since W1b it gives up its summaries
  first, and its titles still cost Still open past its first item), and whether the summaries are missed when they go.
- **Y1 (2026-10-25, fix):** in 0.3.36 the summary never showed: every chapter's summary memory was born with no
  folder (42/42 on 10-24), and a memory with none fails the gate. Now a chapter's summary records its chapter's
  folder, and one written before is read in its chapter's folder. After the release that carries it: new summary
  memories have `origin_scope` (`SELECT COUNT(*), COUNT(origin_scope) FROM memories WHERE type='memory' AND
  source='episode' AND created_at > <install ms>;` equal counts), and the snapshot replay above names the check that
  still holds a day back. On the 10-25 snapshot copy, 10-24 (the one day with a summary) still fell back in
  ~/counterparts even with every folder's scope on: day's end cited a ~/motelier memory marked `work`.
- **Y2 (2026-10-25, roadmap's rec, Mike "sounds good", lightly held):** a cite now crosses folders on its folder
  alone (this folder, or one whose scope setting is on: the same rule as (b) and (c)), whatever its mark; "only
  about-me cites cross" above no longer holds. Still out: a cite, chapter or memory that day from a folder set off
  or paused, a denied cite, a cite with no folder, and anything from another folder when the scope setting can't be
  read. A cite the night wrote (a dream's merge or gist, a reflection's entry) is filed under the folder the night
  ran in, so it is read by its originals' folders instead, a few merges deep, and fails when any original is off,
  denied, gone or foldless (review of Y2); the same for such a row made inside the day. Also from that review:
  "Might be relevant" at a session start leaves out a chapter's summary from another folder whose scope setting
  isn't on (it was listed before; the published bundle's fallback still lists it, self INTERFACE-GAPS §14). On the 10-25 snapshot copy, 10-24 now shows in ~/counterparts with every folder on (and in ~/motelier,
  ~/random, ~/islander-website); with any one of those three off it falls back, by the chapter check (each wrote
  chapters that day). Day's end stored its first summary on 10-25 (about 10-24), so 10-18–10-23 have none to show.
  After the release: on a morning replay, a day that falls back should name a scope-off folder, a denied/foldless
  cite (or a night row whose originals can't all be read), or no stored summary — never a cite's mark. Read what the summary says in a folder it wasn't written in
  (Mike's read: does another folder's work in it read as useful or as noise).

Changes it: the summary almost never showing (since Y2 the cite rule is folder-only; next is the chapter/folder rule
itself, with Mike), another folder's work in it reading as noise or as too much (then back to about-me cites only:
revert Y2's PR), a repeat across lanes, or Still open losing items Mike wanted. Revert: either switch false (both
false: the wake byte for byte as before), or revert the PR.

## Due ~3 mornings after the wake polish of 10-25 (random-5b's 10-25 wake, Mike's go, lightly held — `self.NIGHT_LINE`, `handoff/last-here.ts#ELSEWHERE_QUIET_MS`, `self/briefing.ts#OPEN_TAIL_WORDS`)

- **Trying:** (1) a "Last night:" line in a session start's wake — what the dream and the reflection did by id
  and in a few words, "a quiet night", "none yet today (last: …)" or "the nightly run is under way" — riding in
  the Yesterday line's furniture and the last of it to give way; (2) "Still open"'s tail as one calm count with
  no ids and no "untouched for 2+ weeks" (`(96 more open, kept quietly; recall finds one by what it's about)`);
  (3) "Today, elsewhere" / "Here, also open" say "quiet since HH:MM" for a session with no turn for two hours,
  not "(live)"; (4) a handoff's staleness in two clauses ("1 day old, with a newer chapter here since; release
  0.3.34 then, 0.3.35 now").
- **Look at:** three mornings' first wakes (the session-start wake in a transcript, or `counterparts wake`):
  does "Last night:" match `counterparts night` (same ids, a quiet night called quiet, a morning before the run
  reads "none yet today")? Does the wake still fit 9,000 bytes with the page whole, and what gave way for the
  line (`counterpart.wake.assembled` in the hook's ring; the session-start `adapter.wake.injected` row's bytes)?
  Does a session ever ask recall about something the calm tail counted (a facts question on an open thread's
  words), or does the tail go unread? Any "(live)" left on a terminal idle past two hours?
- **Changes a decision if:** the night line shows the wrong night (dated by the run's date: a dream run late in
  the evening reads as "none yet today" the next morning) → date it by the run's start instead; the day's first
  wake always reading "none yet today" (the run starts at its first prompt, after the wake) and the line so
  telling nothing on the morning that matters → show the latest night with its date instead; a tight wake still
  losing an open item or a dated one to it (since review of #623 a rescue takes the line out first) → look at
  `briefing-room.ts#takeRoom`; the calm tail hides open threads nobody reaches → put one handle back (a count
  by folder, or the newest one's id).
- **Revert:** `self.NIGHT_LINE` false; `ELSEWHERE_QUIET_MS` `Infinity`; `moreLine`'s generic form for `threads`
  (`OPEN_TAIL_WORDS`); `staleWords`' three clauses.
- **2026-10-25, later (O1, L1):** the "show the latest night with its date instead" trigger above was taken
  before install — see "Due ~3 mornings after the still open handle and the dated night" below.

## Due ~3 mornings after the still open handle and the dated night (2026-10-25, O1 + L1, roadmap 10-25, lightly held — `mcp/server.ts#stillOpenTool`, `self/briefing.ts#OPEN_TAIL_WORDS`, `dream/night-line.ts#nightOf`, `NIGHT_LINE_STALE_DAYS`)

- **Trying:** (1) `recall({ handle: "still open" })` lists everything "Still open" carries, in the wake's order
  (ids, titles, lived days since touched, 20 a page), and the facts questions "what's still open" / "open
  threads" / … are answered by it; the wake's tail reads `(N more open, kept quietly; recall "still open" lists
  them)`. (2) Before the day's run, the night line names the latest FINISHED night by the day it read
  (`The night of Oct 24: dream … made …; reflection … rewrote the page.`), not "Last night: none yet today";
  more than 3 days back, `… was the last to run`.
- **Look at:** `mcp.recall.stillopen` in the server's ring (or a transcript): does a session ever call the
  handle, from the tail or a "what's still open" question, and does it then do anything with an item (a
  recall by id, a close)? Is its total the wake's listed + counted, give or take the dated items "Coming up"
  shows? Three first-of-the-day wakes: does the night line name the night `counterparts night` lists (same
  ids), dated the day before the run's date? Does the day's second wake switch to "Last night: …" for the run
  that just finished?
- **Changes a decision if:** the handle is never called in a week → the tail's words are not doing it, or
  nobody wants the list (drop the facts routing first, keep the handle); a session calls it and then recalls
  nothing from it → the list needs more than titles (a first line, the folder); the night named by "the day
  before its stamp" reads wrong to Mike (a late-evening run by hand, a run after a gap of days) → name it by
  the stamp, or by the day's-end summary's `about`; the "was the last to run" form showing on an ordinary
  morning → `NIGHT_LINE_STALE_DAYS` up; a tight wake losing a dated item or Still open's first item to the
  longer line (the sweep in `still-open-and-night.test.ts` says it does not) → `briefing-room.ts#takeRoom`.
- **Revert:** `OPEN_TAIL_WORDS` back to `OPEN_TAIL_WORDS_BEFORE`; drop the handle and `asksStillOpen` in
  `recallTool` (nothing is stored by either); in `nightLine`, drop the `latestFinished` branch (the line reads
  "none yet today" again).

## Due 3–5 days after awake belief support (2026-10-24, B1, Mike's yes 18:04, lightly held — `schemas.AWAKE_SUPPORT_ON_DUPLICATE`) — checked 2026-11-01, below

What: a session's belief that says what an existing belief says used to file nothing (review of #583: eight repeats
had pumped one belief to 8 in a session). Now its memory counts as support for that belief, once per belief per
session (the memory's `origin_session`; any support row from that session counts, the birth's included). An unbound
session (`mcp`) falls back to once a lived day. Physics' spread still discounts a second session the same day (×0.5).

Look at, per lived day since install (read-only). The awake door keeps its own row, `belief.support.awake` (`ref` the
belief; payload memoryId, session, `filed` with route and weight, or `filed: false` with `reason`); `belief_support`
holds every filing, the reflection's included:
- awake filings and held repeats a day: `SELECT day, SUM(json_extract(payload,'$.filed')) AS filed, SUM(json_extract(payload,'$.filed') = 0) AS held, GROUP_CONCAT(DISTINCT json_extract(payload,'$.reason')) AS why_held FROM events WHERE name = 'belief.support.awake' GROUP BY day ORDER BY day DESC LIMIT 10;`
  against all filings that day: `SELECT day, COUNT(*) AS filed FROM belief_support GROUP BY day ORDER BY day DESC LIMIT 10;`
  (all minus awake = the reflection's plus a session birth's first support);
- any belief whose support rose by more than one awake filing in a day: `SELECT day, ref AS belief, COUNT(*) AS n, GROUP_CONCAT(json_extract(payload,'$.session')) AS sessions, GROUP_CONCAT(ROUND(json_extract(payload,'$.weight'),2)) AS weights FROM events WHERE name = 'belief.support.awake' AND json_extract(payload,'$.filed') = 1 GROUP BY day, ref HAVING n > 1 ORDER BY n DESC;`
  expect a few, each from a different session, the later ones at the same-day weight (×0.5); many from one session, or
  a null session more than once a day, is a bug;
- did an awake-filed belief cross a core or page threshold sooner than it would have: for each belief above, its rows
  (`SELECT memory_id, route, day, ROUND(weight,2) FROM belief_support WHERE belief_id = ? ORDER BY day`) and whether it
  reached the page or the core in those days; its support without the awake rows is what it would have had.

What would change it: one belief climbing by several awake filings a day for days (sessions repeating a
belief instead of noticing new things), or a belief reaching the page on awake repeats alone. Revert:
`schemas.AWAKE_SUPPORT_ON_DUPLICATE=false` (the old reply, nothing filed; rows already filed stay, counted), or revert
the PR. Step 2 of B1 (`supports:` on remember) is briefed from these numbers.

## Due ~7 lived days after unsettled competition (2026-10-24, E3, Mike's go 14:47, lightly held — `recall.UNSETTLED_COMPETES`) — checked 2026-11-01, below

What: when a turn reaches both members of a standing unsettled pair (the slot detector's "newer state of" proposal, or
a dream's unsettled flag), the older one, already labelled "Unsettled — may be out of date", counts at
`activation × (1 − k · sim · fresh)` for the loud tier and the order, never for admission: the newer wins a close race,
the older still shows, labelled, when there's room. k 0.6; `sim` = cosine over 0.8, over 0.2; `fresh` falls to 0 over 7
lived days. Only a newer past the absolute floor presses. Replay on the 10-24 corpus: in the 8 proposals' windows (≤ 1
lived day each) 322 turns ran and none showed both members; the 3 the dream undid had 50 turns and neither member
shown. So expect it to fire rarely: a same-day turn about something just rewritten.

Look at (read-only):
- how often it fires: `SELECT COUNT(*) AS turns, SUM(json_extract(payload,'$.pairsCompeted') > 0) AS competed FROM events WHERE name = 'recall.decision' AND json_extract(payload,'$.pairsCompeted') IS NOT NULL;`
- the olders it weighed that still showed, with their newer and weight: `SELECT e.day, json_extract(f.value,'$.id') AS older, json_extract(f.value,'$.competed.with') AS newer, json_extract(f.value,'$.competed.factor') AS factor FROM events e, json_each(e.payload,'$.footnotes') f WHERE e.name = 'recall.decision' AND json_extract(f.value,'$.competed') IS NOT NULL ORDER BY e.seq DESC LIMIT 20;`
  (and the same over `$.surfaced`);
- the cost side: for pairs the dream WITHDREW since install (`SELECT pair_id, day FROM contradiction_settles WHERE action = 'withdraw' AND actor = 'dream'`),
  any turn above with that pair's older — a wrong newer that won a race; Mike reads whether any mattered.

Not stored: an older the weight pushed out of a full tier (`capped`) appears only in the count, not by id.

Changes it: Mike reading a true memory pushed below a wrong "newer" more than once a week, or an outdated fact still shown
first beside its newer. Revert: `recall.UNSETTLED_COMPETES=false` in `src/core/recall/tunables.ts` (nothing read; the
turn and its row exactly as before), or revert the PR.

## Due ~1 week after this-turn meaning (2026-10-25, S1, Mike's "switch on", lightly held — `recall.SEMANTIC_THIS_TURN`) — checked 2026-11-01, below; closed 11-01 (stays on)

What: the meaning lookup on an ambient turn is the turn's own prompt, embedded and ranked in line, instead of the
worker's rank of the previous exchange (which 77% of ambient turns used before). Past `SEMANTIC_INLINE_MAX_VECTORS`
(50,000) the worker's fresh row is still used. The ranking now runs on the `inline` profile (potion: floor 0.15,
weight 6, measured on deliberate questions) where lagged turns had floor 0.05, weight 1. The replay (1,782 real
turns, `~/counterparts-notes/2026-10-25-0327-reread.md`, "Semantic lag A/B, gate cleared") was a wash: 16% of
lagged turns differ by ~1.3 items, credited lost 10 / gained 8, ≤3-word prompts lost 1 credited of 28, +4–7 ms p50.

Look at (read-only, split by build, human-typed turns as the re-read classes them):
- the switch took: `SELECT json_extract(payload,'$.build') AS build, json_extract(payload,'$.semantic') AS source, COUNT(*) FROM events WHERE name = 'adapter.recall' GROUP BY build, source ORDER BY MIN(seq);`
  — on the new build `in-line` should be ~all, `lagged` ~0 (any `lagged` there means past the guard or no sync
  embedder), `in-line-skipped` 0 at the live store's size. The #521 row's "share of turns `in-line`" is no longer a
  signal from this build on.
- items shown per Mike-typed turn against 10-22..24 (1.19 / 1.61 / 1.28; first prompts ~2.0), the re-read's §2 split;
- footnote ratings on Mike-typed turns against 10-22..24 (noise 38 / 30 / 29%, useful 23 / 21 / 22%), the re-read's §1;
- the cost: `elapsedMs` p50/p95 on `recall.decision` by build (the replay said +4–7 ms p50);
- short prompts (≤3 words: "yes", "go ahead", "and the tests?"): any complaint that a terse follow-up lost the
  thread, and their items shown against the same days. That is where the lagged cue carried the subject.
- the lag writer still runs: `adapter.semantic.lag` rows a day, `stored: true` (`counterparts mechanisms`' `semantic-lag` row).

Changes it: useful ratings falling, or noise rising, on Mike-typed turns beyond the 10-22..24 range; a short-prompt
complaint more than once; p95 cost past ~50 ms. Then try off, or tune the ambient profile apart from the deliberate
one before reverting. Revert: `recall.SEMANTIC_THIS_TURN=false` in `src/core/recall/tunables.ts` (a fresh lag row
wins again, exactly the 0.3.36 behaviour), or revert the PR. If it stays: retiring the lag writer is the follow-up.

## Due a week after the stop counts (2026-10-25, N1, Mike's OK 11:44 via roadmap 3b — observation only, `recall.STOP_COUNTS`) — checked 2026-11-01, below

What: shown per Mike-typed turn fell (~1.9 → 1.2–1.6) and only the echo skip could be named. Each turn now counts what
each mechanism kept from showing: `habituationCut` (habituation's lift alone, not one the cross-project lift already
counts), `nearMiss` (below the bar it faced by less than 10% of it, not counted under habituation or the cross-project
lift), `capped` (admitted past a tier's slots), `budgetTrimmed` (cut by the render's bytes), `inhibited` (head wins, near-duplicates), beside `echoSkipped`,
`projectSkipped` and `crossProjectLifted`. Belief/tag displacement has no key: the beliefs slot never takes a memory's
room. Nothing is judged by these; the test proves the same bytes with them on or off. The replay (1,782 turns over a
10-25 snapshot copy, 648 a person started; recall NOTES "N1") read, per person turn: echo 1.43, near miss 0.87, cross
lift 0.28, habituation 0.26, inhibited 0.12, capped 0, budget 0.

Look at (read-only; rows from before this build have no `startedBy` and no counts, so they drop out):
- **what stopped memories on Mike's typed turns this week**, per day and build:

```sql
SELECT json_extract(payload,'$.date') AS date, json_extract(payload,'$.build') AS build, COUNT(*) AS turns,
       ROUND(AVG(json_extract(payload,'$.surfaced') + json_extract(payload,'$.footnotes')), 2) AS shown,
       ROUND(AVG(json_extract(payload,'$.echoSkipped')), 2) AS echo,
       ROUND(AVG(json_extract(payload,'$.projectSkipped')), 2) AS project,
       ROUND(AVG(json_extract(payload,'$.crossProjectLifted')), 2) AS cross_lift,
       ROUND(AVG(json_extract(payload,'$.habituationCut')), 2) AS habituation,
       ROUND(AVG(json_extract(payload,'$.nearMissCount')), 2) AS near_miss,
       ROUND(AVG(json_extract(payload,'$.capped')), 2) AS capped,
       ROUND(AVG(json_extract(payload,'$.budgetTrimmed')), 2) AS budget,
       ROUND(AVG(json_extract(payload,'$.inhibited')), 2) AS inhibited
FROM events
WHERE name = 'adapter.recall' AND json_extract(payload,'$.startedBy') = 'person'
  AND json_extract(payload,'$.nearMissCount') IS NOT NULL AND json_extract(payload,'$.date') >= date('now', '-7 days')
GROUP BY date, build ORDER BY MIN(seq);
```

  `startedBy` is the prompt hook's own reading: `person` is an attended session whose prompt no host frame opens (not
  a task notice, a subagent's hand-back or another session's message); `sdk-cli` and other unattended sessions read
  `unattended`. The same query with `'host'` gives the comparison.
- the margin the rows were counted at, should it be tuned: `SELECT json_extract(payload,'$.nearMiss.margin') AS margin, COUNT(*) FROM events WHERE name = 'recall.decision' AND json_extract(payload,'$.nearMiss') IS NOT NULL GROUP BY margin;`
- one turn's decision row: `adapter.recall`'s `session` and `turn` are `recall.decision`'s `ref` and `$.turn`.

Changes it: nothing to revert unless a row is wrong; it answers the shown-per-turn question. If `nearMiss` stays near 0
while shown falls, the bar is not what moved; if it climbs as shown falls, read the bar (SNR, the semantic profile).
Off: `recall.STOP_COUNTS=false` in `src/core/recall/tunables.ts` (the counts absent; `adapter.recall` keeps `turn` and
`startedBy`).

## Due a week after the support door's shadow (2026-10-24, E2, Mike's go 14:36 and his yes 20:59 to merge in shadow, lightly held — `physics.CORE_DOOR_SUPPORT`) — checked 2026-11-01, below; closed 11-01 (shadow retired, switch off)

What: the core's door as one support arc, in place of the fast and slow lanes — **merged in shadow**. The two lanes
still decide what becomes core, exactly as before; each night sleep also asks the support door about every candidate
the lanes consider and records where the two disagree. The door: a memory about me or us crosses when its support —
the belief's arithmetic (`supportCredit`) over its real uses (opened, quoted, drawn on, rated 2–3), its slot's
re-encodings and the reflection's citations (found filings, full once a later use echoes them) — reaches
`CORE_SUPPORT_LINE` (0.1005) as height × days factor over its LIVED days (the slot's making the first of them once a
lived filing stands, a filing the day after the making the same occasion, `CORE_SUPPORT_GAP_DAYS` 2). Glimpses and
ratings of 1 count nothing; a reflection alone gives no lived day and never carries a memory in; one real use two
days or more after the making, felt at 0.6 or more, is in; an unfelt or merely felt one needs a second occasion.

Why shadow: on the harness (10-24 and 10-23 corpora, identical answers) the door grew the core about half as fast as
the lanes — core on days 7/14/21/28/last 0/0/3/4/6 against the lanes' 0/6/10/11/12, the first promotion on day 19
against day 8 — which pulls against Mike's 10-20/10-21 rulings that the core was starving. The 7 reflection-only
fast-lane crossings are what it keeps out; `mem_c439775f4cb8` (one use felt at 0.5) waits for a second occasion
(accepted as built, with the gap knob).

Shadow on the harness (10-24 corpus): the replay's days are identical to off's (core 0/6/10/11/12), and the shadow's
rows read: 7 `wouldHold` (the 6 reflection-only fast-lane crossings of days 8–12, and `c439` on day 19), 3
`wouldPromote` (`mem_3e902ac53462` day 19, `mem_b5d49bb663b2` day 29, `mem_8412e26dc04e` day 30); the summed columns
are lanes 12 and support 7 (cumulative support 0/0/4/5/7 against on's 0/0/3/4/6). The one extra is
`mem_b65a4d8b6189`: in the lanes' world its day-18 use is a return; with the door on it was on display in the wake's
hints and refused — what is core changes what is shown. Every other admission matches on's by id and day.

The rows (read-only; split by build — every payload carries `build`):
- `promotion.shadow`, one per disagreement, each memory each kind once (`dedupKey`), `ref` the memory: `kind`
  (`wouldPromote`: the support door says yes, the lanes did not promote it; `wouldHold`: the lanes promoted it, the
  door says no), `day`, `level`, `line`, lived `days`, `sum`, `filings` (`memoryId`, `route`, `day`, `session`,
  `weight` — ids and numbers, no text); a `wouldHold` also has the `lane` that carried it and `reflectionOnly`;
- `promotion.shadow.sleep`, one per sleep that had a candidate: `lanes` (N, promoted tonight), `support` (M, what the
  door would have promoted tonight, capped like the lanes at 3, strongest first), `overlap` (K), `wouldPromote`,
  `wouldHold`, `caughtUp` (a memory the lanes promoted against the door's no, which the door now admits — counted in
  M: on would have promoted it that night), `considered`, `line`. Summed, `lanes` is the lanes' core growth and
  `support` the door's.

Look at, after a week of nights on 0.3.36 (read with E1, daily consolidation, and R2, own-write, which also feed the
core):
- each night, and the cumulative core both ways (each on top of the core both shared at install; on never demotes):
  `SELECT day, json_extract(payload,'$.lanes') AS n, json_extract(payload,'$.support') AS m, json_extract(payload,'$.overlap') AS k, json_extract(payload,'$.caughtUp') AS caught_up, json_extract(payload,'$.considered') AS considered, SUM(json_extract(payload,'$.lanes')) OVER (ORDER BY seq) AS lanes_total, SUM(json_extract(payload,'$.support')) OVER (ORDER BY seq) AS support_total FROM events WHERE name = 'promotion.shadow.sleep' ORDER BY seq;`
  and the core as it stands (the lanes'): `SELECT COUNT(*) FROM memories WHERE promoted_identity = 1;`
- the wouldPromote and wouldHold lists by id:
  `SELECT json_extract(payload,'$.kind') AS kind, ref AS memory, day, ROUND(json_extract(payload,'$.level'), 4) AS level, json_extract(payload,'$.days') AS days, json_extract(payload,'$.lane') AS lane, json_extract(payload,'$.reflectionOnly') AS reflection_only FROM events WHERE name = 'promotion.shadow' ORDER BY kind, day;`
  with their filings: `SELECT e.ref AS memory, json_extract(f.value,'$.route') AS route, json_extract(f.value,'$.day') AS day, ROUND(json_extract(f.value,'$.weight'), 3) AS weight FROM events e, json_each(e.payload,'$.filings') f WHERE e.name = 'promotion.shadow' ORDER BY e.ref, day;`
  and which held ones the door admitted later: `SELECT substr(key, 14) AS memory, json_extract(value,'$.held') AS held, json_extract(value,'$.caughtUp') AS caught_up FROM meta WHERE key LIKE 'sleep.shadow.%' AND json_extract(value,'$.held') IS NOT NULL;`
- how many lane promotions were carried by reflection citations (the crossings the door is built to refuse):
  `SELECT COUNT(*) AS lane_promotions, SUM(json_extract(payload,'$.reflectionOnly')) AS reflection_only FROM events WHERE name = 'band.promoted' AND json_extract(payload,'$.build') = '0.3.36';`
  and of those, the `wouldHold` rows with `reflection_only` 1 above.
- Mike reads the two lists: the wouldPromote memories (would he want them core?) and the wouldHold ones (are they
  who he/we are, or reflection's echoes?).

Not stored: the support of a memory with no disagreement (computed at each consolidation, not written). A lanes run
is not an on run — what is core changes what the wake's hints show, and a use while shown there is no return — so the
door's column approximates on, it doesn't replay it. The nightly `promotion.shadow.sleep` row has no dedup key, so it
is swept after `retentionDays` (90): read the running totals within that window (the per-memory rows are kept). The
door's column counts growth: an owner demotion of a memory it admitted is not taken back out.

Changes it: Mike decides on, off or tune. On: `physics.CORE_DOOR_SUPPORT` `"on"` in `src/core/physics/index.ts` (the
door decides; today's core stays). Off: `"off"` (the lanes byte for byte, no rows). Tune: `CORE_SUPPORT_LINE` or
`CORE_SUPPORT_GAP_DAYS`, staying in shadow. Each is one value (a source edit and a release; no config path sets physics); nothing to undo in the store (the shadow's rows and
`sleep.shadow.*` marks are read by nothing else).

## Due ~2026-10-27 (what the tag child costs, 2026-10-23 — docs/decisions.d/feat-night-usage-debug-1023.md; reminder mem_8f7e7db449bb)

What: every night's `dream.night` row now carries `usage`: each child's tokens from its own `result` line and the
total. Read the tag child's real tokens over the nights since install, and the writer's and the dream's beside it:

```sql
SELECT json_extract(payload,'$.date') AS date,
       json_extract(payload,'$.usage.tags.input') + json_extract(payload,'$.usage.tags.output')
         + json_extract(payload,'$.usage.tags.cacheRead') + json_extract(payload,'$.usage.tags.cacheCreate') AS tags_tokens,
       json_extract(payload,'$.usage.writer') AS writer, json_extract(payload,'$.usage.dream') AS dream,
       json_extract(payload,'$.usage.total') AS total
FROM events WHERE name = 'dream.night' AND json_extract(payload,'$.usage') IS NOT NULL ORDER BY seq;
```

`counterparts night` prints the latest night's total; doctor's Nightly run line too. Changes it: the tag child far
past ~60–80k tokens a night → raise turning it off (`schemas.TAGS_NIGHT=false`). A child's `null` means it said no
usage (stopped mid-stream); many of those is its own question. Revert of the record itself: revert the PR (nothing
reads `usage` but the two lines above).

## Checked 2026-11-07 (lived day 47, on 0.3.50: NL1 the night's line, the day-summary gate, and the week reads of LT1 recall latency and W1 the worker's cost)

Read on a copy of the live store and cache taken 11-07 15:11 UTC (during the day-47 run, before its dream), the
process logs read in place, never the store itself; SQL and one read-only script over the logs. Times are UTC. Builds as
the hook's rows carry them: 0.3.46 from 11-04 15:12, 0.3.47 from 11-05 15:26, 0.3.48 from 11-06 16:34, 0.3.49 from
11-06 18:12, 0.3.50 from 11-06 20:37; three installs on one day, and 11-06 was also the week's heaviest (804 recall
decisions in 21 sessions, 742 workers, 821 prompt hooks; 10-31 had 247 in 12). **Nothing reverted, nothing changed.**
Two things for Mike, below: W1's after-done bar (still), and what to do about recall's drift (LT1). Read by a
Fable 5.1 session on its first morning; the 11-03 numbers are the 11-03 read's.

- **NL1, the night's line (0.3.42 on) — holds, at the bar; re-read with a week more.** Seven lines on seven nights
  10-31 → 11-06 (0.3.42 → 0.3.47), none NULL, none empty, none sent back, 141–202 B, no bare ids; two nights before
  (0.3.39, 0.3.40) wrote none, as expected. One night (11-05) wrote no page and still a line. Compared by reading
  against the page version that night wrote (a reflection's `page_version` N pairs with `versions` seq N, archived
  that same night; the live body is the page since 11-06): **repeats 2 of 7** — 11-02 ("every slip that day was the same one: a result
  written down before it came back") says what the page has said since before 10-30 ("A neat result tempts me before
  I've looked"), and 11-06 (a tired man, not an angry one, where Mike had written "his sadness") was written the same
  night the page gained the same sentence. 10-31 names AenyaFollet as the page does but from another angle (the
  letter, the unscoreable bet), not counted. **Lesson-shaped 2 of 7:** 11-02 again, and 11-04 ("the arrival after the
  absence was what landed"). The other three are happenings (the drill's three key checks, the Halloween dark-box
  answer, the Krazy marks left untouched), and 11-01's dark box reached the page five days later, which is the line
  doing its job. At "about 2 of 7" on both counts, not over. One structural thing to know before tuning: the line and
  the page are written the same night from the same material by the same run, so a same-night repeat (11-06) isn't
  the writer forgetting what the page says; it is the page catching up in the same breath. If repeats pass 2 on the
  next read, the row's own fix (the ask as its own step after the first `finish`, fenced) is the one to take.
- **The day-summary gate (0.3.42 on) — holds.** `handoff.daysummary.held`: 0 rows, ever. A summary every night
  10-29 → 11-07, 487–597 characters against the 600 cap (five of the last six nights `nothing-to-say` with a summary:
  summary sent, no page from day's end, the reading 0.3.35 fixed; the reflection still wrote pages on 11-04 and 11-06). Did each morning's wake lead with it? No direct row says so; the
  proxy is `adapter.wake.injected` `sec_yesterday` at 400 B or more (a summary is ~500–600 B): 10 of 17 wakes on
  10-31, 11 of 24 on 11-01, then 18 of 21, 22 of 26, 20 of 24, 15 of 21, 23 of 28 (11-02 → 11-06). The wakes without
  it are mostly the day's first: the night runs when the day's first session opens (HN1/NT1), so day's end writes
  yesterday's summary a few minutes *after* the first wake, and today's first three wakes (15:07–15:10) had none while
  the fourth (15:11:44, five seconds after the summary landed) carried 580 B. The 11-01 low (11 of 24, 12 rows with no
  `sec_*` keys) is the shape switch going on that day. No `no-folder`, no `folder-closed` rows, so the row's two
  triggers never arose; nothing to loosen.
- **LT1, recall latency (0.3.42 on) — the week read: holds on the build's own cost, but the two things the 11-03
  read watched both moved; one is load, one is a drift.** The index is still there (`doc_tokens_cover`), cache
  freelist 0 (25,226 pages, was 19,487 on 11-03), store freelist 0 (29,783 pages), so the row's listed cause is
  excluded. `elapsedMs` p50 / p90 by day and build: 98 / 133 (10-31, 0.3.42), 103 / 159, 123 / 209 (11-01), 147 /
  233 (11-02, 0.3.45), 172 / 249 (11-03), 153–175 / 216–271 (11-04, 0.3.45 → 0.3.46), 211 / 363 (11-05, 0.3.47),
  **276 / 692, 281 / 461, 312 / 1,176, 214 / 309 (11-06, 0.3.47 → 0.3.50)**, 163 / 279 (11-07, 15 turns). **Late
  turns** (`lateMs` > 0, `BUDGET_MS` 1,200): 1 on 0.3.43 (11-01), 16 of 510 on 0.3.47, 3 of 132 on 0.3.48, 14 of 137
  on 0.3.49, 0 of 213 on 0.3.50; worst 8,130 ms late. 31 of the 34 fall in four stretches of 11-06 (14:15–14:32,
  16:01–16:20, 17:26–17:27, 19:53–20:23) across 11 sessions, 8–10 sessions active in each of those hours, and not at
  the installs (0.3.48's first decision 16:34, 0.3.49's 18:12). In those same stretches every worker step blew up
  together (hour 17: `cycle` max 27.8 s against a 0.8 s mean on a quiet hour, `wake` max 8–30 s in hours 14–20), the
  prompt hook with it (8 over 5,000 ms, max 10,456, all on 11-06; none since 0.3.40 before), while the store was
  writing *less* than usual (18 events in the 17:25 five-minute window, 7–20 at 20:00–20:10, against ~58 a window in
  a normal busy hour). That is the machine, not the store or the recall path: 11-06 ran 21 sessions, three
  releases and their checks. **So the row's "stalls → a real deadline inside `activate`" reading is met on the rate
  (3–10% on the 11-06 builds) but not on the cause,** and a deadline would cap the wait without touching it. **The
  drift is the real finding:** in quiet hours (3 or fewer sessions active) p50 went 101 (10-31) → 88 (11-01) → 158
  (11-02) → 167 → 144 → 193 (11-05) → 233 (11-06): past the row's ~200 ms, with no install step and no load to blame.
  Not attributed here. Candidates, not causes: the cache grew 30% in four days (`doc_tokens` 661k rows, `neighbours`
  160k); `cue_edges` 3,268 (11-01) → 5,983, each pair one more cue read a turn; 0.3.46/0.3.47's per-turn filters
  (deleted-memory hiding, starter ranking, 14-day habituation); the store itself, 9,389 rows. Nothing in 0.3.46 →
  0.3.50's changelog names the recall path. **What would settle it:** the `recall.decision` row carries one
  `elapsedMs`; a per-step split (cues, postings, semantic, filters, render) is the mechanism to add, then one
  morning's read says which step grew. Until then a bisect on a copy (same build, the 11-03 store copy if
  `~/counterparts-backups/2026-11-03-dana-week` holds one, against today's) separates store growth from code.
  **For Mike:** whether to add the per-step split now (small, read-only, one row field) or wait a week to see if the
  drift continues; the reverts in the row still apply and still aren't indicated.
- **W1, the worker's cost (0.3.42 on) — the week read: p50 bar met every day but the heavy one; after-done still
  over half, Mike's call stands.** Workers from `process.end`, by day — n, p50 / p90 / max s, after-done share,
  seconds with two or more at once: 10-31 172, 1.2 / 2.4 / 6, 63%, 15; 11-01 470, 1.5 / 3.2 / 13, 65%, 62; 11-02 296,
  1.6 / 3.1 / 935, 41%, 14; 11-03 293, 1.7 / 3.5 / 7, 65%, 29; 11-04 547, 1.7 / 3.2 / 7, 61%, 61; 11-05 203, 1.8 /
  4.5 / 655, 67%, 33; **11-06 742, 2.4 / 8.1 / 660, 53%, 403**; 11-07 21 so far, 1.9. The three long ones are the
  laptop asleep, checked the 11-03 way: 11-02's two (that read), 11-05 02:33 (654 s; `pmset -g log` has sleep
  11-04 19:22:36 → 19:33:30 local, the log silent 653 s) and 11-06 15:39 (660 s; sleep 08:28:07 → 08:39:04 local,
  silent 657 s). No worker over 60 s otherwise, all week. p50 is under the 2.5 s bar every day, 2.4 on 11-06 with
  everything else doubled (above). Overlap 9–62 s a day, 403 s on 11-06 — the "bad stretch" the row asks to read
  apart: it is the same four load windows as LT1's late turns, not the worker's doing. `runner.steps` mean ms by day
  (0.3.45 → 0.3.50): sidebar 594 → 780 → 1,009 → 1,531 (11-06) → 797, cycle 458 → 627 → 872 → 1,326 → 982, wake
  216 → 452 → 367 → 976 → 513; the sidebar step is still what's left after done, and it too drifts up on quiet days
  (594 on 10-31, 780 on 11-04, 1,009 on 11-05), the same shape as LT1's drift, which makes the per-step split above
  worth having on both rows. Each worker reports ~644 MB resident (`rssMb`); four at once on 11-06 is memory the
  laptop didn't have spare, one more reason the heavy day read the way it did (not measured further). **Still for
  Mike (from 11-03):** keep "under about half" at ~0.9 s of 1.4 s, or take the sidebar step as the next cut. Keep
  `runner.steps` in `LOGGED`; this read used it again.

## Checked 2026-11-03 (lived day 43, on 0.3.45: NC1 the catch-up and a folder that is off, the night's fence, W1 the worker's cost with LT1's latency)

Read on a copy of the live store, cache and process logs taken 11-03 18:39 UTC (after the day-43 night at 15:01 UTC),
never the store itself; SQL, one read-only script over the logs, and the installed 0.3.45 `counterparts coverage` and
`doctor` run against the copy under a scratch `HOME`. Two probes call `dream/slices.ts`, `dream/tags.ts` and
`adapters/scopes.ts` from master on the copy (no diff from v0.3.45 in those files). Times are UTC. Builds as the
hook's rows carry them (`recall.decision` `$.build`; workers and prompt hooks are spawned by the build installed, so the
log is split at the same times): 0.3.41 10-30 14:43 → 10-31 02:38, **0.3.42 10-31 02:40** → 11-01 18:38, 0.3.43 11-01
18:40 → 23:54, 0.3.44 23:54 → 11-02 02:25, 0.3.45 from 11-02 02:42. So the "10-30" release in these rows started
running 10-31 02:40, and four nights have run on it: 10-31 and 11-01 on 0.3.42, 11-02 and 11-03 on 0.3.45, all `done`.
`build.0.3.42`–`0.3.45.settings` are `[]`. The folder settings file was last changed 10-30 20:41, before the install.
**Nothing reverted, nothing changed.** NC1 and the fence hold on the live window but were never put to the test there;
W1 and LT1 are partial (3.7 of ~7 days), finish ~11-07. One thing needs Mike (W1's after-done bar).

- **NC1, the catch-up leaves out a not-on folder (0.3.42 on) — holds; not exercised live.** Two folders are not on:
  one off since 10-26, one observer since 10-07. Neither has had a Claude Code session since 10-26 / 10-13, so nothing
  was there to leave out. New memories from either folder since the fix: 0. All three ever written from them are the
  10-29 three (birth day 38), and those are now archived `removed-by-owner`. `coverage` for 10-26 through 11-03 on the
  copy: the off folder's two 10-26 sessions read "all written up" (they were, on 10-29 under 0.3.39); "Owed now: 1
  session" (74f9ad97, ~/counterparts, ended 11-03 local morning), and doctor's Catch-up says "1 session to catch up":
  the two readers agree. `adapter.night.writeup` granted/written: 10-31 6/6, 11-01 1/0, 11-02 4/4, 11-03 4/4 (before:
  10-29 12/12, 10-30 3/3); `left`/`partsLeft` 0 except 11-01, where the one granted session (~/counterparts-site, on)
  timed out (868 s, code 143, the first `timed-out` write-up; two `failed` on 10-27/28) and was written up the next
  night. On folders still written up: yes. `coverage.lapsed` 1–5 a night, all 1–4-piece sessions of 10-14..10-20,
  the same before and after. **To see the door bite, on the copy only:** with ~/counterparts set off in a copied
  settings file, `coverage` moves 74f9ad97 and one short session to "Not asked for (folder off, observer or paused): 2",
  "Owed now: nothing", and doctor's Catch-up reads "nothing owed" (Authorship drops its "1 session awaiting
  catch-up"). The readers still agree. Doctor's line doesn't say how many it isn't asking for; coverage does. (Run
  coverage under the scratch `HOME` without `--dir`: with `--dir` or `COUNTERPARTS_DATA_DIR` it reads no folder
  setting, so it still lists 74f9ad97 as owed while doctor says nothing is.)
  Re-read the first time a folder with recent sessions goes off, observer or paused. What would change it is in the
  row.
- **The night's fence (0.3.42 on) — holds; not exercised live.** Every night ran normally: no `could-not-start`
  `folder-setting`, no `mcp.refused` with a fence reason (refusals were the usual `mode-required`, `session-required`,
  `past-room`, `already-written-up`, the same mix before), no `mcp.recall` `closed-to-the-night`, and doctor on the copy
  has no `night-held`. `self.page.writer.ran` `omitted` is 0 on all four nights, as it should be: no closed folder had a
  day. The closed set on the real settings is 3 rows, the archived three above (walk 110–257 ms on the copy). None of
  them is in any dream's or reflection's `shown`, any `dream_changes` row or any memory's sources since 10-29, so no
  closed folder's words reached a dream, reflection or day summary, but there were none to keep out. Dream intake
  didn't fall: fresh 63 / 55 / 58 / 58 (60 / 55 the two nights before), shown 273–276. Night times 15.4, 25.8, 6.4,
  6.6 min against 6.0 and 8.0; 11-01's extra is the 14.5-minute write-up timeout above and an 8-minute page writer
  (asked 16:17, refused past-room 16:25, then revised), and 10-31's is the dream and the reflection (24,680 and 20,396
  output tokens, against 3–9k and 5–13k on the other seven nights with usage since 10-25; $5.18 the night; not read
  further). The tagging
  child ran every night before and after, with real work (40 memories, 30 cards, 2,412 untagged waiting), and the
  fenced bundle is identical to the unfenced one, so "closed rows left untagged start a child each night" didn't
  arise. **On the copy only:** with another work folder set off, the fence closes 509 rows (494 memories, 13 chapters,
  2 handoffs; walk 128 ms) and day's end for 11-02 drops 2 of 10 chapters (35 → 28 entries); with ~/counterparts-site
  off, 368 rows, 346 ms. The walk is in the ~150 ms the row guessed, per night call. Re-read with NC1's trigger.
- **W1, the worker's cost (0.3.42 on) — partial: p50 bar met, after-done bar not met; finish ~11-07.** Workers from
  `process.end` (proc `worker`), by build — n, p50 / p90 / max s, after-done share, seconds with two or more at once:
  0.3.39 232, 6.5 / 15.9 / 42, 76%, 202; 0.3.40 160, 7.8 / 20.0 / 380, 77%, 808; 0.3.41 470, 4.9 / 8.3 / 59, 76%, 355;
  **0.3.42 379, 1.3 / 2.6 / 6.6, 64%, 30; 0.3.43 301, 1.6 / 3.4 / 13, 65%, 47; 0.3.44 46, 1.5 / 3.0 / 3.4, 66%, 3;
  0.3.45 363, 1.6 / 3.2 / 935, 43%, 26.** 0.3.45's two long ones (935 s at 11-02 03:07, 411 s at 03:46) are the laptop
  asleep, not cost: the whole log is silent for 933 s and 411 s around them and they used 2.9 s and 1.6 s of CPU;
  macOS's power log (`pmset -g log`) has the machine asleep 03:07:20 → 03:22:54 and 03:46:37 → 03:53:30.
  Without them 0.3.45 is 65%. Median per-worker after-done 58–59% on 0.3.42–0.3.45, 74–77% before. By day, overlap
  went 120–1,082 s a day (10-27..10-30) to 14–62 s (11-01..11-03), with no worker over 100 s but the two asleep. So
  p50 is well under the 2.5 s bar and the overlap that 10-30 showed is gone, but after-done is about 0.9 s of 1.4 s,
  still over half. `runner.steps` (mean ms a worker on 0.3.45): sidebar 721, cycle 585, wake 414, coverage 142; the
  sidebar step, mostly CPU, is what's left after done. **For Mike:** keep "under about half" as the bar at under a
  second, or take the sidebar step as the next cut. Keep `runner.steps` in `LOGGED`; this read used it.
- **LT1 with W1: latency before and after (0.3.42 on) — partial, holds so far; finish ~11-07.** First, the index took:
  `doc_tokens_cover` is on the cache, and the `postings` lap was 377 ms once (10-31 02:41, the first 0.3.42 worker),
  never again; the cache has 19,487 pages, freelist 0. `recall.decision` `elapsedMs` p50 / p90 by build: 0.3.39 411 /
  773, 0.3.40 434 / 655, **0.3.41 232 / 450**, 0.3.42 101 / 148, 0.3.43 123 / 210, 0.3.44 120 / 158, 0.3.45 152 / 235.
  The step at 0.3.41's install (about 480 → 250 in the hours either side) came with no latency change; it's
  unexplained and not read here. So LT1's own step is 232 → 101, and the row's 411 / 699 baseline is before both.
  Dropped turns (`adapter.recall` `latency-abort` over decisions plus aborts): 4.1–7.5% on 0.3.37–0.3.40, 1.7% on
  0.3.41, 0 from 0.3.42, but that is by construction, since a late turn now shows its answer; the after-measure is
  `lateMs`: 1 of 1,048 decisions on 0.3.42–0.3.45 (0.3.43, 11-01 19:43, 814 ms late). The prompt hook's `ms`
  (`hook:user-prompt-submit` `process.end`): p50 / p90 / max 510 / 1,174 / 4,107 on 0.3.39, 520 / 956 / 25,457 on
  0.3.40 (6 over 5,000), 305 / 533 / 2,864 on 0.3.41, 155 / 216 / 381 on 0.3.42, 184 / 298 / 3,716 on 0.3.43, 220 /
  313 / 1,027 on 0.3.45; none over 5,000 since 0.3.40. **A watch, not yet a fault:** the daily `elapsedMs` p50 has risen
  every day since: 98 (10-31, 0.3.42), 103 (11-01, 0.3.42), 123 (11-01, 0.3.43), 125 (11-02, 0.3.44), 147 (11-02,
  0.3.45), 158 (11-03, 0.3.45), with no step at an install hour and the same across turn
  numbers (1–5, 6–20, 21–60 all ~135–160 on 0.3.45, ~92–104 on 0.3.42). Still under the row's ~200 ms; if it passes
  200 by the week read, check `page_count` and the 0.3.45 read path. **Separating W1 from LT1** (the reminder
  mem_988702ebf22e asks it): on each prompt hook, the longest worker running at the same time, 10-27..10-31 02:40
  against 0.3.42 on. Before: abort rate 3.4% with no worker (1,452 turns), 0% beside one under 5 s (42), 4.6% at
  5–20 s (131), 43.5% at 20–60 s (23), 100% over 60 s (6), the pass3 gradient again; 22 of 72 aborts had a worker
  running (pass3's "about 9%" counted another way, so not a contradiction). After: no worker of 20 s or more overlaps
  any turn, and turns with a worker running fell from 12.2% to 7.3% (78 of 1,068); that is W1's part. Turns with no
  worker went p50 436 → 184 ms and 3.4% → 0 aborts, which W1 can't have done; that is LT1's part (with 0.3.41's step).
  Beside a worker the hook is no slower now: p50 145 vs 156 (0.3.42), 179 vs 185 (0.3.43), 171 vs 221 (0.3.45).
  What would change it is in the row; one addition: `elapsedMs` p50 over 200 ms on the build then running at the
  week read.

Privacy: ids, kinds, counts, times and dates only; no memory text or session content quoted, and the observer
folder isn't named.

## Checked 2026-11-02 (lived day 42, on 0.3.45: the dream's fresh intake again, and PP1 see-also from named ids)

Read on a copy of the live store taken 11-02 08:02 (after the day-42 dream at 07:49), never the store itself; SQL from
each row plus one read-only script over the copy (no counterparts code run). Builds as `recall.decision` and
`dream.begun` carry them: 0.3.39 10-28/29, 0.3.40 10-29 14:08 → 10-30 08:42, 0.3.41 10-30 08:43 → 20:38, 0.3.42
10-30 20:40 → 11-01 11:39, 0.3.43 11-01 11:40 → 16:54, 0.3.44 11-01 16:54 → 19:25, 0.3.45 from 11-01 19:42.
`build.0.3.40`–`0.3.45.settings` are all `[]` (no override). No dream ran on 0.3.41, 0.3.43 or 0.3.44. **Nothing
reverted, nothing changed.** Two things need Mike: the dream queue (unchanged ask from 10-29) and PP1's cue floor.

- **The dream's fresh intake (0.3.33 on) — kept; the intake is closed.** `dream.begun` by night and build, fresh /
  queue / waiting / agedOut / whole: 0.3.39 10-29 60 / 1,037 / 977 / 158 / 1; 0.3.40 10-30 55 / 1,022 / 967 / 91 / 28;
  0.3.42 10-31 63 / 1,277 / 1,214 / 148 / 1; 0.3.42 11-01 55 / 1,202 / 1,147 / 128 / 37; 0.3.45 11-02 58 / 1,389 /
  1,331 / 168 / 3 (3 parts each). **Fresh took and holds**: 55–66 every night since 0.3.33 (42 on the last 0.3.32
  night, 41–46 the week before). `whole` is not "near 11": it swings 1–37 (mean 14 over these five, 15/5/33/3/4 on
  10-24..28). Output, by the 10-29 read's own counts (all `dream_changes` rows, replays included; journal = the
  dream's journal length): 8 nights 10-16..23 (≤ 0.3.32) / 5 nights 10-24..28 (0.3.33–0.3.37, the 10-29 read) /
  5 nights 10-29..11-02 (0.3.39–0.3.45) — changes a night 36.9 / 34.8 / 45.6; links 15.1 / 13.8 / 15.8; gists 2.9 /
  2.2 / 2.8; journal 1,942 / 1,498 / 1,959 chars; contradictions raised 1 / 0 / 3; gist body mean 697 / 722 / 742
  chars (FI1's `Names:` line adds a little from 0.3.42); changes per fresh 0.86 / 0.56 / 0.78. Part of the last
  window's rise is replay (`replayed` 13.3 / 13.6 / 20.0 a night): without replays, changes per fresh are 0.55 / 0.34 /
  0.44. By build in the new window (changes, links, gists, journal): 0.3.39 33, 10, 3, 1,461; 0.3.40 50, 17, 2,
  1,792; 0.3.42 59 and 39, 20 and 15, 5 and 1, 3,066 and 1,439; 0.3.45 47, 17, 3, 2,038. **Not thinner a night**; the
  10-24..28 dip did not last. Less work per fresh memory is the expected price of ~50% more fresh at the same night,
  not a thinner dream. Journal texts weren't read for this note (counts and lengths only). The row's trigger ("dreams
  noticeably thinner → NEIGHBOURS back to 6") is not met. **For Mike (unchanged since 10-29):** the queue keeps growing,
  704 → 985 → 1,389 (waiting 638 → 924 → 1,331) on 10-24 / 10-28 / 11-02, ~76 a night, agedOut 91–168 a night;
  draining it needs `FRESH_SHARE` or `NIGHT_CHARS` (tokens). No further intake read is due; re-read only if he moves
  the queue.
  What would change it: dreams noticeably thinner on a night-by-night read (changes, links, gists, journal all down
  together for several nights, not one build's dip) → `dream.NEIGHBOURS` back to 6; the queue's growth alone does not.
- **PP1, see-also from named ids (0.3.41 on) — the bar is not met, on too few to act; kept on, re-check ~11-09.**
  Footnotes by `via` and build (all `recall.decision` rows): 0.3.40 plain 132, link 2, see-also 0 (the control);
  0.3.41 277 / 2 / 3; 0.3.42 248 / 5 / 3; 0.3.43 206 / 1 / 3; 0.3.44 17 / 0 / 0; 0.3.45 8 / 0 / 0. So 9 see-also'd of
  748 footnotes on 0.3.41–0.3.43 (10-30..11-01), 1.2% against the 2.5% estimated from the 10-29 snapshot. Ratings,
  each footnote joined to the next `recall.rated` of its id in the same session: **see-also'd n 9, 8 rated, mean
  0.62, 50% rated 0, 1 rated 2+**; plain footnotes the same builds and days n 731, 638 rated, mean 0.84, 39% rated 0,
  18% rated 2+; link footnotes n 8, mean 1.00, 38% rated 0. Per build the see-also'd are 3 / 3 / 3, so nothing can be
  split by build. One rating moved from 0 to 2 would put the mean at 0.88: the gap is a single rating. The ids, for the
  record (shown ← by, rating): 0.3.41 mem_0ca7f032368a ← mem_4b5443fd6fb6 1, mem_4892da5d1aa3 ← mem_e30218a0669f 1,
  mem_79f3fc7811b0 ← mem_aae06b19c6f6 0; 0.3.42 mem_161de5ecff03 ← mem_872deb537320 0, mem_9e4bfcefab3c ←
  mem_99de92c5c9eb 2, mem_5cc192306e1e ← mem_aab5bc0d2ba7 0; 0.3.43 mem_9e4bfcefab3c ← mem_00ba40ad8d81 unrated,
  mem_0a5b6dfd024c ← mem_6902723f4655 0, mem_49c36763565c ← mem_37eaa8a54a55 1. Bytes, 0.3.41–0.3.43 turns with any
  footnote: with a see-also 8 turns, mean 438 (max 566); without 498 turns, mean 353; `budgetTrimmed` 0 on both.
  **The ping demo does not hold, and it fails in two halves for two causes:**
  (1) *The bare "ping" doesn't bring the rule — FI1's cause, not PP1's.* Six bare-"ping" turns (one cue word) since
  0.3.40: 10-29 ×2 and 10-30 ×1 on 0.3.40, 10-30 ×2 on 0.3.41, 10-31 ×1 on 0.3.42. Every one showed
  mem_4892da5d1aa3 loud and nothing else: that is the 10-27 dream's gist over five notes including the miss note
  mem_66bb7d836201, and its text names no id, so see-also has nothing to read. The miss note does name the rule, but
  the fold, not the note, wins the bare word. This is exactly the fold FI1's row says keeps no id; not counted against
  PP1.
  (2) *A credited see-also of the rule wired no `ping` pair — PP1's own "changes it" names this.* On 0.3.41 (10-30,
  session 1372bd3f, turn 15) the rule mem_0ca7f032368a came along as see-also, by mem_4b5443fd6fb6, and was rated 1;
  `gate_session` records the training (`cuetrain` t15 0.25). That turn had 22 cue words, `ping` 4.8% of their weight,
  so the pair's delta was `CUE_TRAIN_RATE` 0.5 × `CUE_TRAIN_RATED_ONE` 0.25 × 0.048 ≈ 0.006, and `associate/edges.ts`
  writes a pair at or under `CUE_FLOOR` 0.02 as 0. `cue_edges` has no row for the rule at all (nor for the memory that
  brought it); `ping` still wires to mem_66bb7d836201 0.703 and mem_4892da5d1aa3 0.507 (both last day 39), four
  others under 0.04. So the retrain half of PP1 can only write a one-word pair on a turn where that word is a large
  share: a full use (rated 2 or 3) on this turn would give ≈ 0.024, barely over the floor; a rated 1 needs the word to be
  over ~16% of the turn. Nothing broke; it is how the floor meets a long turn. **For Mike:** a see-also'd use writes
  its pairs before the floor (or with a lift), or leave it — and a bare "ping" that shows the rule needs FI1's new
  folds or the old fold re-made.
  What would change it is in the row; one addition: if by ~11-09 (or at 30 rated see-also'd footnotes, whichever is
  later) they still sit under plain footnotes by mean and zero-share, lower `SEE_ALSO_MAX` to 1 as the row says.

## Checked 2026-11-01 (lived day 41, on 0.3.42: the 0.3.35–0.3.37 week, E2's shadow week, and emotion's weight)

Read on a copy of the live store taken 11-01 ~10:40 (after the day-41 sleep at 09:17), never the store itself; SQL
from each row plus two session-only scripts (`bun`, store opened `observer`). Builds by lived day (`meta`
`build.<v>.since`, what doctor's Builds line reads): 0.3.35 from day 33 (10-24), 0.3.36 day 34 (10-25), 0.3.37 day 35
(10-26), 0.3.38/.39 day 37 (10-28), 0.3.40 day 38 (10-29), 0.3.41/.42 day 39 (10-30). So "the week" is days 34–41,
0.3.36 → 0.3.42. **Nothing reverted, nothing changed.** Three rows need Mike: S1 (its trigger is met), R3 (two of its
named shapes are present) and E2 (on, off or tune). (Mike 11-01: S1 stays on and E2's shadow is retired, both closed
below; R3 still his.)

- **R2, own-write (0.3.35 on).** 239 birth-day credits from another session on days 33–41 (0 before: the old rule),
  0 from the writing session; mostly `ontopic` (weight ~0.06) and `shown` (~0.03), so glimpse-sized. Of the memories
  credited that way 158 are work, 61 unmarked, 10 us, 3 me, 4 owner: **none promoted**. Promotions days 33–41: 0 on
  every night but day 41 (1, a day-9 memory). No jump; the trigger (core outrunning the reflection, glimpsed
  promotions) is not met. **Kept.**
- **E1, daily consolidation (0.3.36 on).** Consolidate ran every lived day 34–41 (`ran` / `ran-nothing-found`, one
  each), `promotion:cap` empty every night. Promotions per night 0,0,0,0,0,0,0,1 (day 41, fast lane,
  mem_9e4bfcefab3c); core 15 → 16, against 0–3 every third night before. Far under "~3 a week". New, not a trigger:
  from day 39 the pass hits its budget (`budgetExhausted`, skipped 273 / 816 / 1,032 on days 39/40/41); the cursor
  rotates, so a nightly pass covers the store in about two nights, but at every-third-night the same budget would
  leave more unvisited. **Kept.**
- **R3, cue learning (0.3.36 on) — not green.** `cue_edges` 3,268 pairs, 1,255 words, 379 memories, top 0.70, mean
  0.047, none near the cap of 1, all from `use`; by `last_day` most of it in days 39–41 (843, 1,027, 741). The row
  expected "a few hundred a week": this is ~10×. Two shapes the row names: common words slipped through (`cross` 51
  memories, `tmp` 49, `uds` 48, `etc` 28, each pair weak, top 0.12) and acknowledgement words at the per-word cap 1.5
  (`ahead` 20 memories, `let` 19, `sound` 18, all led by one owner memory,
  mem_f7aaea4817d7, at 0.62–0.68: an acknowledgement now cues it). `ping` wires strongest to the miss note
  mem_66bb7d836201 (0.70) over the rule's status note mem_4892da5d1aa3 (0.51) — the "learned the note, not the rule"
  finding (mem_02338e46c13a); the bare-"ping" demo in a fresh session was not run (it needs a live session). Footnote
  ratings, all turns, 10-26..31: noise 40.7% / useful 16.7% (n 1,500), against the row's 47% / 18%: noise not above
  it, but it moved with S1's in the same window (below), so R3's share can't be split from the store (`learned` per
  turn isn't recorded). **For Mike:** a stop-list or minimum-informativeness for learned words (path fragments,
  acknowledgements), or leave it; nothing to revert alone. *Mike, 11-01: a stop-list → R3S (#706), its own row above.*
- **B1, awake belief support (0.3.36 on) — can't be read.** Zero `belief.support.awake` rows, zero
  `near-duplicate` anything since day 34; three beliefs were born in the moment at all (days 33, 35, 40), 2 since
  install. The door never fired. Other `sessionBelief` outcomes (`not-testimony…`, `limit-reached`, `pasted…`) aren't
  evented, so whether sessions tried and were refused earlier can't be told. Re-read when awake beliefs are written.
- **E3, unsettled pairs compete (0.3.36 on).** 2,317 decision rows carry `pairsCompeted`; it fired on 1 (day 36:
  older mem_1dfda94f6209, a 10-27 note, weighed ×0.70 against its newer
  mem_c78fbe9cfe3a, the older still shown as a footnote). The dream withdrew no pair since install, so there is no
  cost side to read. As the replay predicted, it fires rarely. **Kept.**
- **S1, this-turn meaning (0.3.37 on) — the trigger as written is met.** The switch took: `in-line` on 0.3.37–0.3.42
  is 2,294 of 2,296 `adapter.recall` rows (`lagged` 1, `stale` 1), against 12–28% on 0.3.32–0.3.36; the lag writer
  still stores every row (195–609 a day). Footnote ratings on person turns (`startedBy` `person`, the hook's own
  reading, not the re-read's transcript class), 10-26..31: **noise 42.4% / useful 17.1% (n 932)**, against human-typed
  10-22..24 at 38/30/29% and 23/21/22%: both past the range, the wrong way. The method reproduces the re-read's own
  all-turn baseline exactly (30.2% / 21.2%, n 510), so the comparison holds. By day: 49/12, 39/20, 41/18, 41/23, 47/12,
  27/24 (10-26..31). Two cautions: 10-22..24 was itself the low outlier (10-20/21 read 43–47% noise, and the re-read
  blamed the day mix), and 10-26..31 is back at that level; but there is a step at the boundary — 10-25, the last
  lagged day (0.3.35/.36), all turns 25% / 18% (n 134), then 10-26, the first S1 day, 43% / 15% (n 298) — and R3's
  words grew in the same window. Items shown per person turn 1.23 (n 923) against 1.19 / 1.61 / 1.28: in range;
  first prompts (turn 1, person) 1.33 (n 83) against ~2.0: lower. Cost: `elapsedMs` p50 by date rose 163–228 ms
  (10-22..24) → 286 (10-25) → 311–453 (10-26..29), already climbing before S1, so its own +4–7 ms can't be seen; 0.3.42
  brought p50 to 90–99, p95 156–177. The row's "p95 past ~50 ms" could never be met (p95 was 500+ ms at baseline): it
  meant S1's added cost, which isn't separable here. Short prompts: prompt text isn't stored, so ≤3-word turns can't
  be split; no complaint found in memories written since 10-26. **For Mike:** the row's own next step is "try off, or
  tune the ambient profile apart from the deliberate one, before reverting": a few days with
  `recall.SEMANTIC_THIS_TURN=false` as an A/B is the cheap read; his call.
  **Outcome (11-01): not attributable.** The 10-22..25 baseline was a low outlier; the turn-1 control shows the
  10-26 step isn't S1 (ROADMAP's S1-review.md, ~/counterparts-notes/). **Mike 11-01: S1 stays on, no off-test.
  Closed.**
- **N1, stop counts (0.3.37 on).** Person turns 10-26..31 (n 923), per turn: shown 1.23, near miss 0.92,
  cross-project lift 0.56, habituation 0.34, inhibited 0.22, echo 0.21, capped 0.00, budget 0.00, project 0; margin
  0.1 on all 2,192 rows. Against the replay: near miss the same (0.87), cross lift doubled (0.28) and now the second
  named stopper, echo far lower (1.43; live rows count the session window). Shown didn't fall over the week (1.08–1.56
  a day, flat), so the "bar moved?" question doesn't arise; near miss steady. Host turns: shown 0.24–1.25. Observation
  only; **kept on.**
- **E2, the support door's shadow week (due 10-31, read here; 0.3.36 → 0.3.42, days 35–41).** Seven
  `promotion.shadow.sleep` rows, 133–156 considered a night: **lanes 1, support door 5**, overlap 0, caught up 0.
  The harness said the door grows the core about half as fast as the lanes; on the live week it is the other way,
  because the lanes promoted almost nothing (see E1). `wouldHold` (the lanes promoted, the door says no): 1,
  mem_9e4bfcefab3c (day 9; the memory Mike asked to keep to watch it change),
  fast lane, reflection-only, level 0.0, 0 lived days, its one filing a reflection `found` on day 40 — exactly the
  crossing the door is built to refuse. `wouldPromote` (the door yes, the lanes no), each a found/re-encoding plus a
  later real use: mem_3e902ac53462 (me; level 0.194, 3 lived days; also
  on the harness's list), mem_57c155c319af (us; 0.116, 2), mem_d2797af60368 (us; 0.129, 2),
  mem_a0ba38997b7a (us; 0.142, 2), mem_e6470328929b (me; 0.182, 3). `band.promoted` since 0.3.36:
  1, reflection-only 1. **For Mike: on, off or tune** — and whether he wants these five as core, and the waking memory
  held out. **Mike 11-01: shadow retired, switch off, code left inert; reflection-alone admission stays (09-27
  ruling); no promotions or demotions; undo = one switch** (`physics.CORE_DOOR_SUPPORT` back to `"shadow"`;
  `docs/IMPROVEMENTS.md`, "the core door's shadow retired"). **Closed.**
- **Emotion's weight (EMO_Q 0.5, the 10-18 method) — first read by Étienne in ~/random (random-54); superseded in part by ROADMAP's challenge review below.** On a copy of the live
  store, 0.3.42, lived day 41; script and lists in `~/counterparts-notes/2026-11-01-felt-review/` (`felt.ts` runs
  against a copy; `felt-q.ts` is a what-if taking `EMO_Q` from env). Method check: on the 10-19 snapshot the script
  gives 177 / 116 / 31 against 10-18's 176 / 119 / 31. The ratio table is unchanged, as the formula sets it: ×3.3 /
  ×7.4 / ×11 / ×24.5 by band. Correction to the 10-18 row: `STABILITY_GAIN` is 8 and stability is S0·e^(8q) with
  q = clamp01(sal + 0.5·I), so the factor is e^(4I), capped once q reaches 1. **The felt share of in-reach non-core
  memories fell**, 16.8% on day 28 to 11.6% now (169 / 1,006 against 336 / 2,902), because unfelt memories grew faster.
  Routine felt work notes in reach: about 5 of 62 (three day chapters, one validator pass, one review note); the rest
  are lessons, rulings and milestones. No pile-up. What-if at EMO_Q 0.2: 10 of 336 felt memories would leave reach;
  the 6 work ones are lessons or rulings, and none of the routine notes would leave. **Decision: keep EMO_Q 0.5**
  (Mike's 10-18 call stands). Watch item: in practice felt memories never leave reach (felt in reach grows ~13 a day;
  199 of 199 felt memories on the new curve are in reach). Re-read at lived day ~55–60 (~2026-11-15..20): has any felt
  memory with I ≥ 0.4 left reach, and are day chapters or status notes piling up? (This session's own read agreed on
  every number it shared; the one addition it keeps: by birth cohort on the new curve, the felt share of in-reach is
  12% / 8% / 8% for days 21–27 / 28–34 / 35–41.)

- **Emotion's weight, after ROADMAP's challenge review (2026-11-01; `~/counterparts-notes/2026-11-01-felt-review/ROADMAP-REVIEW.md`). Final for this read.**
  **Keep EMO_Q 0.5.** No problem seen: felt footnotes are rated like unfelt ones, by about-mark too (since day 35:
  43% vs 40% noise; within the same mark felt is no worse), and only 1 of 594 felt shows depended on EMO_Q being above
  0.2. **Too early to call it harmless:** every shown memory was 20 lived days old or less, so EMO_Q couldn't have
  bitten yet. Corrections to the first read: the 16.8% → 11.6% fall was a denominator effect (felt in reach doubled to
  336; ~3,100 new work memories, 1.6% felt), and by body text 10 of the 62 felt work memories are routine, not ~5.
  **Most persistence isn't EMO_Q:** felt memories carry higher explicit claims (felt work ~0.56 vs ~0.25), and the
  night favours them (reflection/dream returns 48–52% vs 1–8% at the same salience), which re-anchors them; at EMO_Q 0
  the median felt memory still stays in reach ~161 days. **Re-read** at lived day ~120 (~2027-01-19) on Mike's store,
  or the first new-user store at day 60–90; read what's SHOWN and how it's rated, not what's in reach. **Trip-wire**
  (over ≥200 ratings): felt ≥10 points noisier than unfelt in the same about-mark; or felt >35% of footnotes; or one
  felt memory keeps returning rated 0 past habituation. If it trips, look in this order: the habit of tagging feelings
  on "me" notes (55% of interactive "me" notes are felt), then the night's preference for felt memories, then
  EMO_Q 0.5 → 0.35.
## Checked 2026-10-12 (lived day 21, the first new-curve pass, on 0.3.18)

All four entries due today were read on the live store (read-only) after the 00:19 night run. Nothing here
changes a decision.

- **The new curve ran.** `decay.curve` is present (power-law, era on, `eraReads` 2). At 08:30, 29 live rows had
  a NULL next-change day. 28 had been touched since the pass (written on day 21, a return or a dream on day 21,
  or a new feeling; the feelings triggers clear it too). One, mem_a11cc5968ef4 (last return and dream on day
  18), shows no touch I could find; a small open question, not a fault, because NULL only means "look again at
  the next pass" (the pass selects NULL or due rows), so nothing goes unexamined.
- **Below reach: 233** (`counterparts mechanisms`), against ~230 predicted on the copy. The 10-11 live 56 was
  the old curve's ranking; the reader is fine.
- **Dated memories archived on the first pass: none.**
- **Personal memories below reach after 0.3.18: 4, none at the old 0.25 default.** The 18 old-default
  owner/us memories the copy predicted are back in reach (#395 applies). The 4 below hold explicit low claims
  (three "me" at 0.30, one owner at 0.20: Mike typing ';exit'), which the era keeps as claimed.
- The era reads 591 old memories at today's default (485 lower, 106 higher).

## Due 2026-10-14 (the check-in, reminder mem_8a53c5d0bc95)

### The tax deadline shows under Arriving on 10-13 and 10-14
- **Look at:** the wake in a session on the morning of 10-13 and of 10-14: "Arriving:" lists the
  Oct-15 tax deadline (a plain reminder).
- **Why:** two quiet items due 10-14 took both of Arriving's lines from it (found by the 0.3.17
  release check); Arriving now ranks plain reminders first, then nearest date (IMPROVEMENTS,
  "Decided by random-06, 2026-10-11").
- **Changes a decision if:** it is still missing → the cap needs to grow, not just reorder.

### Decision 1: faded matches crowding fresh ones in facts recall
- **Look at:** a few real facts-mode recalls on the live store (Mike's normal questions); count how often a
  faded match ranks above a fresh one that answered the question better.
- **Why:** Decision 1 (kept, Mike 10-11) ranks faded matches inline with bodies, for the benchmark's counting
  questions. Mike: be cautious about changing the core app to fit the benchmark.
- **Changes a decision if:** faded matches visibly crowd fresh ones → switch to the fallback variant (a″), a
  mild fade-scaled penalty on the order only (IMPROVEMENTS item 1).

### The rest of the Decisions list
- **Look at:** items 4, 5, 6, 8 (kept 10-11, lightly held) with the first lived days of data: the in-reach
  curve over days 21–23, which memories left reach, whether any core or owner/us memory moved.
- **Changes a decision if:** a memory Mike would miss left reach, or routine work notes are still in reach
  after ~3 lived days.

## Checked 2026-10-22 (lived day 31, on 0.3.30: 0.3.27's experiments two lived days after the 10-19 install)

Read-only on the live store (sqlite `?mode=ro`, doctor, probe-oq4, mechanisms). The two lived days were heavy build
days (372 and 317 memories written against ~100 a day the week before; ~430 recall turns a day, many from
background agents), which colours every per-turn number. Full read with the per-day tables:
`~/counterparts-notes/2026-10-22-0327-read.md`. **Nothing reverted.**

- **Ratings (probe-oq4):** noise 43% / useful 19% on 10-20, 47% / 22% on 10-21, against 47% / 18% before. No
  direction yet; no jump toward 2–3 right after install. Coverage 85% of ambient showings.
- **Builder 1, A credits:** ~40% of rated showings now credit something (was ~3%): 7 days, 179 uses credited (32
  glimpses, 109 rated 1, 37 rated 2, 1 rated 3), 242 not (mostly birth-day). drewOn named 7–9 a day, never at the cap
  of 3 in a call. The one core promotion since install (mem_8412e26dc04e, cards form from strength) was earned
  awake (rated 3 after an expansion, then drewOn + 3), not by glimpses; no never-used ruling crossed. Below reach
  1,145 (753 on 10-18): up, with writes tripled, so glimpses aren't keeping noise alive at the population level.
- **Builder 1, B links — the trigger is met, kept on purpose:** the graph's first signal ever: 6 quiet pointers
  shown in two days (none in ~9,500 links before 10-19), 1 later expanded, **5 of 5 rated were 0**. 45 links at or
  above 0.40. Four memories sit at the 4.0 outgoing bound, all Reddit memories, nearly all of it co-use weight since
  10-19. Mike's 10-19 call was "error on too strong, so we can see what it looks like": this is what it looks
  like, so the cap/deposit change is his call (asked 10-22). Link-primed footnotes were rated 20% noise against 45%
  (n 40). Support measure keeps its links column.
- **Builder 1, D habituation:** 97 habituated now, 23 got through anyway; 3 were later rated 2–3 while habituated,
  none twice; a dozen hand-read are stale work notes. Kept.
- **Builder 2:** C echo skip removed 87 and 139 showings a day (of ~400), nothing recorded as missed; E the dream
  replays 20 `today` memories a night (11 dreamed), `replayed` 8→25; `waiting` 374→610 tracks writes a day tripling
  with intake flat at 44–46, not the replay; F holds by time window (no session but the parent had a recall row
  inside the 10-20/21/22 nights) — the store holds no child session id, follow-up in WORKLIST.
- **Stemming (#529):** re-stem landed (terms = light-1). Items shown per turn fell from 1.4–2.0 to 0.85–0.94 (1.15
  with echo-skipped showings added back): the revert trigger as written, but four changes landed together and the
  turns were agent-heavy; ratings did not fall. Not reverted; re-read ~10-29; Mike asked whether his own opening
  questions found what he meant.
- **Context priming (#530):** 250 and 228 primed showings a day, 63 and 56 lifted past the bar (train mostly, link
  25–32), a lift on ~11% of turns. Rated: neither 45% noise / 17% useful (n 455), train 45% / 21% (328), link 20% /
  22% (40). Longest same-source run across turns: 2. Gap: `lifted` is a per-turn count, not a per-footnote flag, so
  lifted ones can't be rated (handed to the TAGS_PRIME lane).
- Page writer: the restored "grows out of many ordinary memories" line survived into page v51, reworded. Lists in
  bodies (10-15 decision): no non-chapter body over 3 KB since; keep holds.
- **Re-read all four ~2026-10-29**, with the cross-project bar's check.

## Checked 2026-10-18 (lived day 27, on 0.3.25)

These were read on the live store (read-only) and on a copy of that morning's snapshot, after the 10-18 night run (drm_5984d5ba350a, rfl_6192bae891bc). None of it changes a decision. One result, emotion, is for Mike to look at.

- **Wake trims, elements and bytes.** The morning wake in ~/counterparts was `elements=6 bytes=8857`, against `elements=3 bytes=8885` on 10-16. So the room went to the lists once the page fit (the copy predicted 4 → 9).
- **Wake trims, the page writer.** Page v38 is 4,504 B, under the 4,600 target. The first night after the trims (10-17) overshot at 4,928 B with no short version. The second night hit it.
- **Wake trims, a due item missed.** Nothing due 10-16..10-18 was missed. Doctor's "counted, not listed" newest is 10-16, so there has been none since 0.3.25 was installed. The vote reminders were closed on 10-15 (Mike voted 10-14). Today's 3 overdue ids are old planned items (10-11, 10-15, 10-16); the next one is the weekly backup reminder (10-20). Still open: "Still open" leads with a 09-26 item marked "may be out of date". That needs a resolution prompt, not more trims (random-6c's 10-17 item 1).
- **Emotion, felt vs unfelt (mem_af0111512110).** For the 176 felt, non-core live memories, take the same memory with its feeling removed and compare. Stability ratio (median): I < 0.4 ×3.3, I 0.4–0.6 ×7.4, I 0.6–0.8 ×11, I ≥ 0.8 ×25. Lived days in reach: ×3.7, ×8.4, ×14, ×38. Height ratio is only ×1.1–1.3. Review 02's target was ×2.8 at I = 0.6 and ×3.7 at 0.9. The curve gives `exp(STABILITY_GAIN · EMO_Q · I)` = `exp(4·I)`, about ×11 at 0.6, so feeling now does about 4× what was asked. In practice: memories born on the new curve (day 21+) are 100% in reach when felt (31) and 67% when unfelt (526). The felt ones are mostly me/us/owner (119 of 176). The 31 felt work memories are milestones, not routine notes. **For Mike:** keep it, or bring `EMO_Q` down toward ~0.2 (×3.3 at 0.6) to match the target.
- **Era fix + the 14-day wait (mem_fb50024ddae2).** 753 live memories are below reach, against 233 on 10-12; the era scale-down of 10-14 lowered more of them. 519 of the 753 are work and 209 have no mark. 21 are me/us/owner: done reminders (taxes, votes), two dream gists, a few notes about how Mike works, and Mike typing ';exit'. A possible miss is mem_44a87ca1f96c (Careless People: summaries first). Deliberate recall still finds all of them. **Prune exits since 10-13: none** (one `pruned` on 10-13, before the wait), so the wait holds. Footnote ratings (0–3, 206 rated): old pre-era memories average 0.47 (63% rated 0), new ones 0.81 (40% rated 0). The old ones still being shown are mostly unhelpful, which supports the era.
- **Item 6, exit at 7 vs 14 (dry run on the copy, `runPrune` under observer).** Only 20 live memories are under the prune floor at all. With the wait reset by the curve change, 0 would be archived at either 7 or 14. On the curve alone (wait reset ignored), 2 at both, and **0 differ**. The number of days doesn't matter yet; the floor's height decides it (753 below reach, 20 under the floor). Look again at lived day ~40.

## Due 2026-10-18 (the wake trims, 2026-10-16, lightly held — docs/decisions.d/wake-trims-1016.md) — checked 2026-10-18, above

Two days after they are installed, on the owner's session-start wakes (read-only).

### The wake's elements and bytes
- **Look at:** the end tag of a morning wake (`<!-- counterparts:wake/end … elements=N bytes=M -->`)
  and the lines above it: how many items "Still open", "Might be relevant" and "Coming up" list,
  and what is only counted. 10-16 before: `elements=3 bytes=8885`.
- **Why:** the trims (one tag line, the date once, a shorter header, craft out, "Coming up" =
  today, a page target of 4,600) were for room for the lists; a copy of the store measured 4 with
  today's page and 9 with a page at 4,600.
- **Changes a decision if:** elements stays near 3–4 after the page is rewritten → the room is
  going elsewhere ("Work here", the handoffs), and the order in `ROOM_ORDER` is the next question,
  not more trims.

### Whether the page writer hit ~4,600
- **Look at:** the page's size (`counterparts self-page`, doctor's Self page line) after the 10-16
  and 10-17 nights, and its "## How I work" section.
- **Why:** the writer is told to aim under 4,600 and to keep "How I work" to short general
  lessons without dated examples.
- **Changes a decision if:** still well over 4,600, or it lost something Mike misses → the
  target goes back toward 5,750 (`PAGE_ROOM_BYTES`), or the instruction is reworded.

### Whether a due item was missed
- **Look at:** reminders and dated items due 10-16..10-18: each was under "Coming up" on its day
  (or said plainly under the clock for a plain one), and a later one showed as a footnote around
  its date; doctor's Wake line for a dated item counted, not listed.
- **Why:** "Coming up" now lists only what is due today; the rest — overdue and later — is a
  count with ids, the overdue named as such.
- **Changes a decision if:** anything due was missed, or an overdue item counted rather than
  listed was let slip → list the overdue again (after today's, or the first N), or
  `COMING_UP_TODAY_ONLY` off.

## Due at lived day 27 (7 lived days after the new curve's first pass) — checked 2026-10-18, above

### Item 6: exit at 7 instead of 14 — a dry run
- **Look at:** on a SNAPSHOT COPY, run the prune's eligibility with `D_FLOOR_DAYS` = 7 (read-only: compute,
  don't archive) and list what WOULD be archived, against what 14 archives.
- **Why:** Mike wants a faster read on whether exit at 14 is right (item 6, kept 10-11).
- **Changes a decision if:** the 7-day list holds nothing he'd miss → consider 7; if it holds things he'd miss,
  14 stays (or the curve is too steep for those kinds).
- **How:** there's no CLI for it yet; a short script on the copy using `physics` + `sleep/prune.ts`'s
  eligibility with the constant overridden. Ask the coordinator for a lane if it's needed.

## Once drewOn gives a signal (≥ ~5 lived days after it ships)

### Item 9: mood-matched recall re-test
- **Look at:** with `drewOn` and opens as the use signal, compare how often memories lifted by a matching mood
  are used vs not lifted (the 10-10 evidence was 1.3% vs 2.4% on the old use metric).
- **Changes a decision if:** mood-lifted memories are used as often or more → turn the mood weights back up
  (code kept, weights 0).
- **Also look at:** doctor's Credit line's 7-day `drewOn` count. Zero after a week means the field isn't being
  used, which is a prompt problem, not a mechanism result.

## Due ~2026-10-20, two days after it is installed (the wake polish, 2026-10-18, lightly held — docs/decisions.d/feat-wake-polish-1018.md)

On the owner's session-start wakes in ~/counterparts and ~/random (read-only).

### "Still open" shows this week's items
- **Look at:** the items under "Still open" and the count line under them. The plain items
  should be ones born or used in the last two weeks; the count line should read
  `(N more still open, M untouched for 2+ weeks; …)`. M won't match #489 D's nightly close
  offer: that one looks from 4 lived days and offers at most 5 a night. Watch M fall as its
  closes land.
- **Why:** the old order (oldest-opened first) led every wake with the same three-week-old
  questions (random-6c, 10-17).
- **Changes a decision if:** the shown items are recent but noise (the old ones were the
  live ones) → the stale days are too short, or "touched" should count a wake showing; or M
  stays large for days while the close offers keep landing → the wake should say more than
  a count, which is #489 D's to answer.

### The handoff block reads at a glance
- **Look at:** "Where the work in this directory was left off". A stale handoff says
  `N days old; since then: …` in one parenthesis; when every listed one is stale, only one is
  listed and the rest are `+N older here: ids`.
- **Changes a decision if:** a session works from a stale handoff it should have read past,
  or misses an older handoff it needed because only one was listed → list two when all are
  stale.

### Yesterday names folders
- **Look at:** the Yesterday line in ~/random: `…; and 2 sessions in ~/counterparts`.
- **Changes a decision if:** a folder Mike keeps apart shows up there → the gate is not the
  one the "Today, elsewhere" line uses, and it is a bug.

### Went in after this check (2026-10-20, fix/wake-dedupe-1020)
The 10-20 reads of this section's wakes found repeats, bare ids and three tags; those went
into the change below, which has its own section.

## Due ~2 mornings after install (the wake without repeats, 2026-10-20, lightly held — docs/decisions.d/fix-wake-dedupe-1020.md)

On the owner's session-start wakes in ~/counterparts and ~/random (read-only), and the
snapshots folder.

- **Look at:** every `epi_…` id in the wake. Each should appear once: "Last here" names the
  newest chapter written in the folder; the Yesterday line names the rest of yesterday's by
  title; no "+N more here on …" or about-me line repeats one of them. A handoff still names
  its session (that is where work was left, not the chapter).
- **Look at:** the Yesterday line: titles and a count ("; and 2 more"), never a lone `epi_…`.
- **Look at:** the top of the wake: one comment, `<!-- counterparts:wake meet=… store=st_…
  elements=… bytes=… -->`, and the sidebar still shows the meeting state and the store check
  (Mike's plugin sidebar; an older plugin, his is 0.3.25, reads both as unknown until it
  updates: no store check, and the footer keeps its "5-minute intro" line).
- **Look at:** an about-me line from another folder reads "A chapter about me from ~/x:
  session …, Oct 19 — "…" (epi_…)." and appears only when Yesterday does not already name it.
- **Look at:** "Coming up": nothing listed that is due tomorrow; each listed item ends with its
  own `[mem_…]`, then any "(earlier: …)".
- **Look at:** `~/.counterparts/snapshots/`: one folder per date from the install day on, and
  no `.taking-…` file left over an hour later.
- **Look at:** a morning with a `handoff.lasthere.noroom` row (not rare on a full wake with no
  handoff here: 10 of 61 ceilings in the review of #536's fixture). There should be no "Last
  here" line, and the Yesterday line names that episode (or counts it). The wake is assembled
  twice on those mornings: the `counterpart.wake.assembled` ring event fires twice.
- **Changes a decision if:** the episode is in no line on such a morning → the second
  assembly's check is wrong; or the session start is noticeably slower → measure the second
  assembly. Or a session reads the Yesterday line as all of
  yesterday and misses the one under Last here → say "(and the one under Last here)". Or the
  sidebar loses the store check on Mike's machine → the plugin sidebar is older than this core.

## Due ~2026-10-23 (the elsewhere lines' titles, 2026-10-20, Mike's go, an experiment — docs/decisions.d/feat-elsewhere-titles-1020.md)

On the owner's session-start wakes and per-prompt lines on a morning with two or three
sessions open at once (read-only; ask the sessions themselves too).

- **Look at:** did a session starting while another was open see what that one was doing
  ("Today, elsewhere: ~/x open since … (live), N memories: "…" (mem_…)") and not redo it?
  The 10-20 case was two sessions doing the same wake check. And in one folder: with
  COUNTERPARTS, a roadmap session, MOD and BENCHMARK open in ~/counterparts, does each
  wake's "Here, also open:" name the others with what they are doing, and does "Work here"
  not repeat those ids?
- **Look at:** are the titles the useful ones (work in progress, things done today), or
  noise (small findings, half-sentences from untitled memories)? Ask the sessions, and see
  whether any expanded a title's `mem_` id with recall.
- **Look at:** "Since you started" never names a title twice in one session, and still says
  nothing when nothing new was written.
- **Look at:** nothing from a folder that is off, paused or observed, nothing marked about
  me, us or the owner, in either line.
- **Look at:** the wake's lanes did not lose room to the line (doctor's Wake line, the
  `counterpart.wake.assembled` bytes; the line is still at most 300 bytes).
- **Changes a decision if:** sessions still duplicate work → give the line more room, or the
  clause here more titles; titles read as noise → keep only status-marked
  memories, or one title a folder; a gate leak → revert at once (`git revert` of the PR).

## Due ~2026-10-24 (personal news across folders, 2026-10-20, Mike's go, lightly held, an experiment — docs/decisions.d/feat-unmarked-personal-marks-1020.md)

Trying: the reflection is offered 24 unmarked memories a night (was 5), the personal-looking first
(`src/core/dream/unmarked.ts`), with room for 32 about marks (was 8), so the personal ones get marked owner or us
and reach every folder; and the `about` field on `remember`/`session_end` says what a mark does. Revert:
`REFLECT_TUNABLES.UNMARKED` 5 and `LIMITS.about` 8 (`src/core/dream/reflect.ts`).

- **First, the switch:** `counterparts core` says "Open" or "Closed to reflection alone". Closed, the reflection may
  only mark work or world (owner ruling D1 on #256) and none of this moves; opening it is Mike's call.
- **The baseline, before the first night on it:** `bun tools/audit/unmarked-offer.ts <a COPY of the newest
  snapshot's counterparts.sqlite>` — the unmarked work pool, how many a lived day adds, how many look personal.
  Counts only; it refuses a path under ~/.counterparts. Not run at build time (the session's permissions refused
  the copy), so the cap of 24 is unmeasured: if a day adds far more than 24, raise it; if the pool empties in a
  night or two, lower it.
- **How many it marked owner or us:** `core_events` rows with `action = 'about'` and `actor = 'reflection'` since
  install, by the mark set (the memory's `about` now) and the `reason`'s "was …"; `counts.about` on each
  `reflection.finished`. The pool again with the probe: is it shrinking?
- **Wrong marks Mike reverses:** an `about` row by the owner (`counterparts about`, the dashboard) on a memory the
  reflection marked, or a work note that turns up in another folder's Nearby. If the reflection marks build notes
  personal, tighten the prompt's "owner or us when it is personal" before touching the order.
- **Does personal news reach other folders:** a wake in a folder other than ~/counterparts (or Desktop chat):
  are recent personal things (a visit, how a week left Mike) in Nearby that were "Work here" only before?
- **The morning share:** past three re-labels it says two by name and the rest as a count. Is that enough for him?
- **The child's context** (review of #558): the bundle does not grow — the offer's lines (≤ 24 × ~320 chars) come
  out of the same 80,000-character room, so on a full night they displace other memories (measured on a test
  full night: 62 memories shown instead of 78, the first part +0.5k chars). What can grow is the reflection
  reading offered ids whole before it marks them, and the finish's 24 whys. Check the reflection child's peak
  against the 10-19 watch (127.5k of ~150k); past ~140k, lower `UNMARKED` before anything else.

## Due ~2026-10-27 (core questions that waited a week, 2026-10-20, Mike's go, an experiment — docs/decisions.d/feat-core-questions-waited-1020.md)

- **Trying:** a core memory flagged "being reconsidered" 7+ lived days ago with no decision
  is offered to the nightly reflection (at most 3 a night, with its unsettled pair); it
  decides keep or retire with a why where it can, and the share says it in one line with
  the way back. The wake's "Still open" leads with one, and keeps "keep or retire it"
  beside an unsettled label.
- **Look at:** how many core questions waited past 7 lived days on 10-20 (three) and now
  (doctor's Reflection line, `coreWaited`; `counterparts core --list`'s "since lived day").
  What the reflection decided: `reflections.detail` → `coreOffered`, `coreDecided` (with
  why), `counts.coreKept`/`coreRetired`, and the `reflection.finished` events. Whether a
  pair was settled after a retire (`contradiction_settles` with actor `reflection`).
  Whether Mike reversed any: `band.core.restored` events, or a retire of one a reflection
  kept (`core_events` `demoted` after a `reaffirmed` by `reflection`). And a wake or two:
  does a week-old one lead "Still open", with both labels?
- **Changes it:** a decision Mike reverses, or a why that reads like a guess, → narrow the
  prompt toward "keep unless plainly not who I am" or offer only the ones with a plain
  category (a plan, not about me or us). Nothing waits past 7 and nothing was decided →
  the wake did the work; the reflection's half may be unneeded.
- **Revert:** filter the reflection's offer back to every flagged memory without the push
  (`dream/reflect.ts`, the `core` instruction line) and pass no `waiting` to `rankLanes`;
  the restore door (`keepCore`'s `restored`) can stay.

## Due ~2026-10-27, the next Tuesday (a weekly reminder done for this week, 2026-10-20, Mike's go, an experiment — docs/decisions.d/feat-reminder-done-this-week.md)

### The backup reminder closes for the week, and comes back
- **Trying:** a memory that `updates` a repeating reminder with `status: "done"` closes only the
  occurrence open that day; the reminder keeps its date, repeat and standing.
- **Look at:** after Mike says the backup is done on a Tuesday, the write's answer (`reminder.
  occurrenceClosed: true`, `next`), then a new session the same day: no plain line, no
  "Arriving:" line, no footnote for the backup reminder. On 10-27 it is said again. In the store:
  the reminder's firing row for that `d:<date>` window in state `suppressed`, the
  reminder row's `event_date` and `meta.recurring` unchanged, its `fade` unchanged, no
  contradictions pair over it.
- **Also look at:** whether sessions write the done memory with `updates` (or follow the
  `answers` hint when they don't), and whether a `drewOn` naming a memory the session itself
  corrected comes back credited with `replacedHere` instead of `faded-under-newer`.
- **Changes a decision if:** the reminder still comes back the same day after a done (a path that
  doesn't read the window state), it does NOT come back the next Tuesday, it closes the wrong
  week (a done said Saturday, with that Tuesday's still open, closes the coming Tuesday's), or
  the reminder fades or leaves the core after a done.
- **Revert:** revert the PR; a done at a repeat then ends the repeat again.

## Due ~2026-10-27 (the facts title tail and soft time words, 2026-10-20, from the benchmark loss read, lightly held, an experiment — docs/decisions.d/feat-facts-title-tail-1020.md)

Lands while 0.3.27's recall experiments are read (~10-22). It changes only deliberate facts
answers (`recall` with `mode: "facts"`), never ambient footnotes, the wake or meaning mode, so
it does not move that read.

### Is a tail title opened, or is the tail noise?
- **Trying:** after a facts answer's 10 bodies, the next 20 matches as one line each (title ·
  id · date), so a memory ranked 11th–30th is in sight and can be opened by id. Listed is not
  shown: no credit for being listed.
- **Look at:** the `mcp.recall` rows with `mode: "facts"` since install: how many carry `tail`
  (and its size), then, for each, whether a later `mcp.recall` row in the same `session` opened
  (`path: "handle"`, its `ids`) one of that row's `tailIds`. Share of facts answers whose tail
  led to an open; share of opens that came from a tail rather than a body. Read a few answers
  live: does the answer quote or use a tail title without opening it (a guess from a title),
  does page 2 still get asked as often, are the 48-character titles readable.
- **Changes a decision if:** tail opens are ~0 over a week of facts calls (noise: cut to 10 or
  off), answers lean on tail titles without opening them (wrong guesses: reword the header or
  drop it), or answers run out of room more often (the ceiling's shrink ladder now drops the
  tail before excerpts go below 60).
- **Revert:** `FACTS_TAIL_SIZE = 0` in `src/adapters/mcp/facts.ts`.

### Soft time words rank, they don't filter
- **Trying:** "lately", "recently", "these days", "nowadays" no longer keep only the past week
  in a facts answer that asks something else; the past week's matches rank first.
- **Look at:** `mcp.recall` rows with `time: "soft"`: how many, and in a few live answers
  whether the right one led, or an older match crowded a recent one the question meant.
- **Changes a decision if:** "recently" questions start answering with old matches first
  (raise `FACTS_SOFT_RECENT_BONUS` from 0.25, or filter again with a fallback past the window).
- **Revert:** drop `{ soft: true }` from the soft branch in `src/core/recall/time-ask.ts`.

## Due ~2026-10-29 (a higher bar for another project's work, 2026-10-21, Mike's ruling on lane G item 4, an experiment)

**What we're trying.** In ambient recall, a memory that is ANOTHER project's work (written in a folder outside the
turn's folder's project, `folder_projects`; work by `self/work.ts#isWorkMemory`) faces bars ×1.25
(`recall.CROSS_PROJECT_BAR_LIFT`, the way habituation's ×1.5 lift works). Personal memories and craft are never lifted.
The hard filter (`recall.RECALL_BY_PROJECT`) is built and off.

**Baseline** (the 2026-10-20 corpus copy, `recall.rated` footnote ratings 0–3, a session's folder taken from its own
memories): home work n=163 mean 0.94; home personal/craft n=124 mean 0.81; crossing work, other folders n=38 mean
0.37; crossing work, ~/counterparts ↔ ~/random n=37 mean 0.70; crossing personal/craft n=111 mean 0.51.

**What to look at.** Re-measure the same split on the live store with a week more ratings (the script is lane G's
`ratings.ts`; the same joins in SQL work). Also `recall.decision`'s `crossProjectLifted` per turn: how many a day the
lift kept below the bar, and in which folder pairs. Read it as "kept below the bar", not "would have shown": one it
counts might still have lost to the footnote cap or the budget's trim, and a loud item the lift demoted to a footnote
is not counted.

**What would change it.** Crossing work still rated well under home work → raise the lift (1.5?), or turn on the
hard filter for pairs other than ~/counterparts ↔ ~/random (or join ~/random to the project). Crossing ratings rise
toward home ones and no complaint of missing context → keep. ~/counterparts ↔ ~/random footnotes the owner misses →
join ~/random to the Counterparts project (`counterparts project join ~/random ~/counterparts`), which removes the
lift there.

**Revert.** `recall.CROSS_PROJECT_BAR_LIFT` to 1.

## Due ~2026-10-29 (open threads mean someone owes an answer, 2026-10-22, shape agreed by Mike, an experiment — docs/decisions.d/feat-open-threads-carry-1022.md; the real check 2026-11-05)

**What we're trying.** Three changes upstream of the reflection, which already saw every stale item twice a week and
closed almost nothing (10-17..10-22: 5 shown a night, 1 closed in six nights; the stale list ~20 deep):

- **Write time.** `unresolved`'s description on `remember` and `session_end`, and the Stop ask, say open means
  someone owes an answer — a question to the owner, a check with a date, a promise; a bug note, a design note or a
  fact gets no flag.
- **Close time.** The Stop ask's last line names THIS session's own open items (wrote, or used with a return), title
  and id, at most `STOP_OPEN_MAX` (5); none, no line.
- **Carry.** An open item with no eventDate, not `asked`, untouched (born, used beyond a glimpse, revised — not a
  footnote left unrated, not a dream's or a reflection's return, not being listed) for `self.OPEN_CARRY_DAYS` (21)
  lived days is no longer carried: out of the wake's Still open and its count (both wakes), and the reflection's
  `staleOpen`. Not closed. "Used" is `meta.usedDay`, written at every credited use but the glimpse. The
  reflection's bundle says `noLongerCarried` (what no share already holds) and the share says it once. A glimpse
  not being a touch is the coordinator's call (10-22, lightly held, for Mike); it still restarts the memory's fade
  (Mike's 10-19 ruling); `self.OPEN_CARRY_GLIMPSE_TOUCH` true reverts that rule alone.
  `STALE_OPEN` stays 5.

**Baseline** (live store, read-only, 10-22, lived day 31): 88 open in the wake (10 untouched 2+ weeks), 129
`unresolved` memories in the store; the reflection's closed/proposed per night above. Two items born on lived days 11
and 12, untouched since, should stop being carried on lived days 32 and 33.

**What to look at.** The wake's Still open count (its "N more still open" line) against 88, and the store's open
count against 129; new open items per day (`memories` with `"unresolved":true` by `birth_day`) before and after the
narrower text; closures per `session_end` (`counterpart.thread.closed` ring events) and whether sessions close the
items the Stop ask named; items no longer carried per night (`reflections.detail.notCarried`, length and the
difference night to night) and whether the share said the count once; the reflection's closed/proposed per night
(`detail.selfClosed`, `detail.closeProposed`) — should stay or rise, since what it sees is now real threads. Spot-read
a few no-longer-carried items: is any one a real debt someone still waits on — and was it one the conversation kept
surfacing as footnotes (`returns` rows `shown`), the case the glimpse rule deliberately lets go? Whether the Stop
ask's list ever names another folder's item (it should not: only what the session wrote or used).

**What would change it.** A real debt dropped → lengthen `OPEN_CARRY_DAYS` (28? 35?), or carry `said_by: owner` too;
one dropped while the conversation kept glimpsing it → count glimpses as touches again (Mike's call:
`self.OPEN_CARRY_GLIMPSE_TOUCH` true). Still open
still near 88 after two weeks → look at what keeps them touched or narrow the write-time text further. Sessions never close the named items → change the line's wording, or drop it (`STOP_OPEN_MAX` 0).

**Revert.** `self.OPEN_CARRY_DAYS` very large (`Infinity`: carries everything, as before); the `unresolved`
description and the Stop ask's `OPEN_MEANS` clause back to the 10-21 text; `STOP_OPEN_MAX` 0 (the ask as before, two
lines); the glimpse rule alone: `self.OPEN_CARRY_GLIMPSE_TOUCH` true.

## Due at the first live catch-up (the nightly run's or `counterparts catch-up`)

### Catch-up's real per-part cost
- **Look at:** the run's `adapter.night.writeup` row (parts, batches) and its children's transcripts / usage
  (runners `writeup-nrn_…` / `writeup-cup_…`): output + cache_write tokens per part, and tool calls per part.
  Compare with the estimate (~7k new-work tokens and 2 calls a part) and the nightly baseline (246k new work,
  20 calls; `~/counterparts-notes/2026-10-10-nightly-cost-baseline.md`).
- **Why:** both ceilings (100 parts a night, 400 for the command, Mike 10-11) rest on that per-part estimate,
  which was worked out from part sizes, never measured from a catch-up transcript.
- **Changes a decision if:** the real cost per part is far above the estimate → lower the night's cap
  (`NIGHT_WRITE_UP_PARTS`), and look again at the command's.

## Due at the first live nights with the reflection in its own child

### Peak context per child on a heavy night
- **Look at:** the `dream.night` row's `children` (expect `dream:0,reflection:0`), and the two children's
  transcripts under `~/.claude/projects/-Users-mlapeter--counterparts-store/` (one session each): peak context
  (max input + cache write + cache read over a child's turns, deduped by message id) and new work per child.
- **Why:** measured once on a light night only (one agent 148k, then dream child 98k and reflection child 70k;
  `src/core/dream/NOTES.md`, 2026-10-11). A heavy night (the writer writing, 50+ fresh) was not measured.
- **Changes a decision if:** the dream child alone goes past ~150k → the dream bundle's room (`NIGHT_CHARS`) or
  the queue (Group 3) is next; if new work goes past the 2× cap (~490k), look at the reflection's re-written cache.

## Due 1 lived day after the verbatim trial ships

### Verbatim in the memory's body: first look
- **Look at:** the bench 76-question slice (counterparts-07) for meaning-search blur on long bodies: do memories
  holding a long verbatim block still come back for questions about their gist? And on the live store, any
  memory written with a list or a table since the ship (a facts line ending "(a list, N items; read whole by
  id)" finds them): did it come back whole by id, and was it findable by what it is, whose, when?
- **Why:** Mike's trial (2026-10-11, very lightly held): `remember` and `session_end` now ask for a list, a
  table or a pasted text whose specifics matter word for word in the body, with the search words in the title
  and the first line. The body is stored and read whole, but the meaning vector is made from the title and the
  body's first ~3,072 characters (at most 512 tokens; a numbered list reaches 512 tokens sooner), so the rest
  of a long block is reached by words only. Also watch: a facts answer saying "near-duplicates … left out"
  over two lists that were different (since the review of #409, a list or a table is compared by its lines,
  not its word set; two near-identical versions of one list still fold, and the older may be the one shown).
- **Changes a decision if:** long bodies blur meaning search, or real lists don't come back whole and findable
  → move to an attachments table (Mike's long-run lean), with the memory holding the context and keywords
  that find the attachment.

## Due ~4 lived days after the verbatim trial ships

### Verbatim in the memory's body: second look, and decide
- **Look at:** the same as the first look, on the days since: the bench slice again if anything changed, and
  every live memory written with a list, a table or a pasted text.
- **Changes a decision if:** decide the trial → keep it, or → attachments (a table of the blocks, the memory
  holding the context and keywords that find one). Record the call in `docs/IMPROVEMENTS.md`.

## .18 / Group 2 (one model for "this replaces that"), the first week after it is installed

### No settled-over memory outranks its head in ambient results (MOD #3)
- **Look at:** `recall.decision` events since the install: any id in `surfaced` or `footnotes` for which a
  settled `changed` / `corrected` pair names it as `over` (and whose head is live), on a turn where the head
  is not also shown. With the head-wins rule (recall CONTRACT §6b) that should be none (a guest session with a
  confidential head was the exception until 10-21). Also the wake's lanes, which already left settled-over memories out.
- **Why:** on 10-10 earlier versions were shown 55 times after their settle, 51 of them without the newer.
- **Changes a decision if:** an earlier one still shows beside or above its head → the gate's inhibition is
  missing a door (a quiet pointer, a carried cue): a bug lane. The head showing for an earlier the turn reached
  when the head reads wrong for the turn → the swap needs a bar of its own.

### Detector precision on the owner's store: hand-read 20 proposed slots
- **Look at:** `counterparts settle --dir …` ("Proposed as a newer state") and `contradiction.proposed`
  events: how many a day, and a hand-read of 20 (ids and verdicts only), with what the dream did to each
  (`slot` same true / false in `dream_changes`).
- **Why:** before install, on the 10-11 copy, a replay of the write-time rule over 20 lived days read 17 of
  20 right, 1 wrong, 2 unsure; replayed on the store as it stands now (the writer's own settles already made) it
  proposes 5 over 20 lived days, 4 of them in the last 7.
- **Changes a decision if:** fewer than ~3 in 4 are right → raise `SLOT_COSINE` or drop the title arm; the
  dream says `same: false` to most → the provisional cut should be a flag only (no fade) until confirmed.

### The dream's confirm/undo stays inside the night
- **Look at:** the dream bundle's "to-confirm" items (at most 4) and `toConfirmMore`, the dream's `slot`
  changes per night, and whether the night run's part count (`NIGHT_WRITE_UP_PARTS`, 100, shared with
  catch-up) or its time moved. The detector itself makes no model call; confirming rides the one dream.
- **Why:** on the 10-11 copy the 4 waiting proposals cost ~1.1k characters of on-mind text plus their memory
  lines in the fitted room; nothing else.
- **Changes a decision if:** `toConfirmMore` keeps growing night over night → proposals outpace the dream's
  4: raise `SLOT_PER_NIGHT` or tighten the rule.

## .19 / Group 2b (one door for "A over B"), the first week after it is installed

The forward run on the 10-11 copy (snapshot before the v13 migration, lived day 20; branch against master, +0/+1/+7
lived days with a boundary a day, no model calls) is the baseline. Only the open-time passes can fire in it: the
moved-reminder pass wrote 2 rows at +0 (mem_6d94a37a10c5 under mem_828f37a7eaa1, mem_828f37a7eaa1 under
mem_96410a0916f3; both fade 1.0 → 0.5, strength 0.346 → 0.173 and 0.456 → 0.228) and 0 after; the corrected-links
pass carried 10 corrected memories' links. Core: no movement (no declared change in a forward run). Owner/us: 0 of
227 memories differ from master at any checkpoint. The doors that need a write or a dream (write, settle, slot,
dream-merge, pressure, fulfilled) wrote nothing in the run; from the copy's history a dream merge would have written
one row per original (40 originals so far).

### Every door's rows, by source
- **Look at:** `SELECT source, how, state, count(*) FROM contradictions WHERE created_at > <install> GROUP BY 1,2,3`,
  and `contradiction.settled` events' `source` and `howSent`.
- **Why:** after this, every "A over B" writes a row; a door that writes none is a door that was missed. Expect
  `write` most days, `dream-merge` on dream nights (one per original), `reminder-moved` rarely (a reminder carried
  from further along its chain), `pressure` / `fulfilled` only on a declared change at a core memory.
- **Changes a decision if:** a merge night writes no `dream-merge` rows → the door refused (the merge's result note
  says "was not settled under the merged memory"; look for a merged memory's `meta.mergedFrom` ids with no pair):
  a bug lane. `howSent: false` on most
  `write` rows that turn out wrong on a hand-read → default `how` to `open` instead of `changed`.

### The dashboard no longer counts one settle twice
- **Look at:** `/api/mechanisms` Interference and Reconsolidation backing ids: no event id under both.
- **Why:** review 10 found the same event ids under both cards. Interference now counts merges, dream flags,
  slot proposals and confirmed slots; Reconsolidation counts declared settles and pressure.
- **Changes a decision if:** they still overlap → the split missed a source value; or Interference sits idle for a
  week while slots are proposed → its proofs read the wrong events.

### Corrected memories' rows swept only after their links were carried
- **Look at:** meta `associate.corrected.relink` present after the first open; edge rows whose endpoint is archived
  `corrected` (25 on the copy) go to ~0 at the first flush after it; the holder keeps the links.
- **Why:** `corrected` joined the sweep's terminal list with this build; the open-time pass carries the old ones
  first and the sweep waits for its latch.
- **Changes a decision if:** the latch is missing a day later (the pass keeps failing) → the sweep never takes
  `corrected`, which is the safe side, but find out why.

### A core memory moves only on a declared change
- **Look at:** `revision.pressure` rows (force 0.35 for an authored change at a slow-kind core memory) and pairs with
  source `pressure` or `fulfilled`.
- **Why:** before this no path moved a core memory in practice. The Han pair (mem_def8b46df5cc, no status, no date)
  is not fast-laned: it needs three lived days of declared changes at the floor. Whether such items should be in the
  core at all is Group 3's.
- **Changes a decision if:** a `fulfilled` takes a core memory out of the core that a hand-read says was not a plan → narrow the fast
  lane (status only, not a date); or the Han pair is still in the core after the owner has declared it kept on
  three days → the floor is not reaching it.

### A merge's originals stay live, behind the merged memory (random-06's ruling, review of #427)
- **Look at:** live memories that are the `over` of a settled `dream-merge` pair: their count, their strength
  (fade 0.5), and whether any shows in a turn's ambient block beside its merged memory (the recall log) or unfolded in
  a facts-mode answer.
- **Why:** a merge no longer archives its originals; they fade ×0.5, are labelled earlier and leave by their own curve.
  The cost accepted was more live near-copies for a couple of weeks, hidden from ambient.
- **Changes a decision if:** an original shows beside its merged memory in ambient recall → head-wins misses a case
  (a bug lane); or the live originals pile up past a few weeks without reaching the floor → revisit the cut for
  a merge (a smaller `factor`, still `changed`).

## Group 4 (association), due ~5 lived days after it ships — checked 2026-10-18

**Checked 2026-10-18** (lived day 27, copy of the 10-18 snapshot plus a bench copy; full write-up
~/counterparts-notes/2026-10-18-association-diagnosis.md). Two triggers are met; the decisions are Mike's:
- **Edges per day:** write-time 163, contiguity 1,247, replay 1,486, co-use 36, drewOn 3 over the week.
  Write-time is 0.13× contiguity, so the 3× trigger is not met.
- **Write-time links later reinforced:** at most 3 of 161 (≤2%); replay 1.5%, contiguity 0.9%. **The "~0"
  trigger is met.**
- **Hand-read of 20 write-time edges:** 5 right, 4 unsure, 11 noise. **The "still mostly noise" trigger is
  met** (narrowly).
- **linksReached:** 0 over 7 lived days (0 since the field exists). The Association light is amber. The
  replay arms were rerun: at 0.0125 there are 71 pointers shown on 54 of 1,375 turns, and 2 of 20 hand-read
  fit the turn, so the result argues against lowering `LINK_POINTER_MIN_FRACTION`.
- **The clinic pair (bench):** linked both ways at 0.05 after two nights (the first night left it waiting),
  too faint to change recall.
- **Why spread is starved (ranked):** (1) edges are too weak: decayed max 0.159, below the ~0.16 a hop needs
  to carry past a seed and the 0.4 a lone pointer needs; use rarely reinforces them (58 of 1,986 shows
  credited). (2) A hop adds a median 2% activation, while a below-bar candidate needs a median +76%.
  (3) Pointers are gated twice (threshold, then anchor).
- **Recommendation (not decided):** keep the pointer threshold; consider dropping write-time links; the
  lever is upstream, in what counts as use; the Association light could read "partly built".


The fast-forward on the 10-11 copy (7 lived days replayed with write-time links, replay deposits and
co-use running, no model calls) is the baseline: write-time 95 new trails (904 before the review of #423
narrowed them to a jot's own turn), replay ~505, co-use 46 pairs (all on links that already existed); 0
pointer candidates at the current threshold, ~200 of 635 turns at 0.0125; the first flush swept ~2,040
inert rows (regrown copies and merge originals). A forward simulation has no awake use, so it cannot say
how many new trails use would confirm.

### Edges laid per day, by source
- **Look at:** per lived day, `sum(json_extract(payload,'$.deposited'))` over `associate.flush`, its
  `atWrite.landed`, `contiguity.landed`, and `dream.begun`'s `replayLinks`; the drewOn `recall.credit` rows'
  `linked`.
- **Why:** "links made" counted rows rewritten until now; these are the pairs that landed. On the copy,
  write-time links were 0–59 a lived day once only jots get them; the replay is now the larger source.
- **Changes a decision if:** write-time rows swamp the table (more than ~3× contiguity's) → lower
  `WRITE_LINK_MAX`, or drop write-time links (IMPROVEMENTS, Group 4).

### The share of write-time links later reinforced
- **Look at:** the share of write-time links later reinforced, on the live store, measured a week after the
  release that ships this installs: of the pairs laid by `atWrite` (and, beside it, the replay), how many
  weigh more than 0.05 a few days later (a co-use or a drewOn deposit landed on them): `edges` with
  `weight > 0.06` whose pair first appeared on an `atWrite`/replay day.
- **Why:** the ants rule only works if use confirms some trails, and only real use can show it.
- **Changes a decision if:** ~0 after a week of drewOn → the trails are noise that nothing confirms: lower
  `WRITE_LINK_MAX` or drop write-time links; and item 4's reinforced column (v14) has nothing to act on yet.

### Hand-read 20 write-time edges for noise
- **Look at:** 20 random pairs from `atWrite` days, both memories' titles, right / noise / unsure.
- **Why:** on the copy, after the tightening, 40 read 5 right, 6 unsure, 29 noise (before it, 20 read 1, 3,
  16, the batch ones 0, 2, 14). Every own-turn candidate was a footnote; G1b's footnote precision was
  0.17–0.33.
- **Changes a decision if:** still mostly noise on real use → drop write-time links and let drewOn and the
  replay lay trails.

### "Links reached recall" > 0, and the Association light
- **Look at:** `sum(json_extract(payload,'$.linksReached'))` over `recall.decision` for the last 7 lived
  days; the dashboard's Association light.
- **Why:** it goes amber when links were laid and none reached recall, once the store has lived 14 days and
  laid 20 links that week (waiting before that). The owner's store passes both, so expect amber there after
  install: the copy had 0 pointer candidates at the current threshold.
- **Changes a decision if:** 0 for 7 lived days with deposit running → re-run the 10-02 replay arms on a fresh
  copy and decide the pointer threshold (`LINK_POINTER_MIN_FRACTION` 0.05 → 0.0125, review 06 C7).

### The clinic pair, on the bench store
- **Look at:** copy the bench store `s500-t-h55-clean/73d42213` and run one dream; the 7 AM memory and the
  memories that say the last clinic trip took two hours are linked (`edges` both ways, ≥ 0.05).
- **Why:** bench item 5/6: before, edges only ran between memories of the same conversation. The bench
  writes every memory in a session-end write-up with no recall while it writes, so write-time links never
  fire there; the replay is what links it (it did on a copy at review, 10-11).
- **Changes a decision if:** not linked → the dream's neighbours miss what a real writer had in mind; look
  at which.

## Ongoing (first two weeks)

### No settled-over memory outranks its head in ambient results
- **Look at:** turn-recall footnotes ("Quietly available", "Came to mind"), the wake's Nearby, and the other
  wake lanes, for a memory that a `changed` or `corrected` settle made earlier, shown above the memory that
  replaced it, or shown without it.
- **Why:** MOD's #3 (10-11): a settled-over memory's title showed bare beside newer ones, and a session repeated
  a corrected rule from it. Marking those titles is its own lane; this is about whether the earlier one
  ranks above its head at all.
- **Changes a decision if:** it happens → interference/supersede ranking needs a fix (Group 2).

### The old-claims era's effect on archives
- **Look at:** `counterparts claims-era --dir …` (count read at default) and archives with no
  `archived_reason` of corrected / dream-merge / episode-regrown / handoff-cleared, i.e. exits by fading, split
  by whether the era read them at default.
- **Why:** the era (Mike 10-10) reads 468 old claims at their default; on the 10-10 copy it caused 50 more
  archives by +30 lived days than without it (73 vs 23). Since 10-11 the count has two parts, read lower
  and read higher (old defaults below today's, e.g. owner/us at 0.25 → 0.40), so it jumps by the read-higher ones.
- **Changes a decision if:** the era's archives include memories Mike would miss → `counterparts claims-era
  --off` reads claims as stored again (archives already made stay archived, readable by id).

## Checked 2026-10-22 (see "Checked 2026-10-22" above), was due ~2026-10-22, two lived days after install: the feedback loop, Builder 1 (an experiment — docs/decisions.d/feat-feedback-loop-credit-1019.md)

Trying ratings as use (A), strong co-use links (B) and light habituation (D) to see whether the day starts
teaching the system. Read-only on the owner's store: `counterparts doctor --config …` (the **Feedback loop**
and **Association** lines), `counterparts probe-oq4 --dir …` (the ratings by date), and the `recall.rated`
rows' `credited` / `notCredited` / `coUse` / `together` fields. Each entry names its revert.

### A. Credits per day by tier, and the footnote ratings
- **Look at:** the Feedback loop line's uses credited (glimpses, rated 1, 2, 3) and not credited; per day,
  the same sums over `recall.rated` rows. Then probe-oq4's score distribution after install against before
  (47% noise / 35% on topic, not needed / 18% useful).
- **Why:** the loop is meant to credit far more than the 3% of shown memories credited before.
- **Changes a decision if:** the useful share does not rise, or the noise share stays near half → the
  credit may be strengthening noise; lower `W_SHOWN` first. If the distribution jumps toward 2–3 right
  after install, the new tool words ("a score counts as use") may be steering the ratings → reword.

### A. Standing rulings and the core
- **Look at:** memories footnoted in 3+ sessions and never rated 2–3 or opened (the ~270 of 10-14): did any
  cross into the core (`core_events` since install), and how many of them sit at or near their peak strength
  (`counterparts mechanisms` below-reach count against 10-18's).
- **Why:** a glimpse re-anchors a memory's curve, so a memory footnoted daily does not fade while it keeps
  showing (kept as built, Mike 2026-10-19). Toward the core a glimpse-only day is 0.1 of a day, never alone,
  never the anchor; but daily glimpses plus two full days in 30 (two reflection citations, or one and a
  rating of 2 or a drewOn) do cross the slow lane (hermetic, 2026-10-19), where before it took about four.
- **Changes a decision if:** a never-used ruling reached the core → the recurrence fractions are too high;
  or below reach drops sharply with the noise share flat, or the footnotes look cluttered with the same
  memories → glimpses keep noise alive; the fallback to try is a glimpse that credits `uses` without moving
  the decay clock, or `W_SHOWN` 0.

### A. drewOn as a full use
- **Look at:** drewOn ids per day and their returns (`returns.source = 'awake'` on a drewOn day, not
  `engaged`), and whether memories named in drewOn start crossing into the core.
- **Why:** Mike, 2026-10-19: trying drewOn as a full use (it was half), so its return is an awake one.
- **Changes a decision if:** drewOn lists grow to the cap of 3 at most boundaries, or name memories the turn
  barely touched → it is being used as a vote; set `W_ENGAGED` back to 0.5.

### B. Links at pointer weight, and pointers used
- **Look at:** the Feedback loop line's "links at or above the quiet-pointer weight (0.40)" and co-use pairs
  sent; the Association line's quiet pointers shown and later expanded. Hand-read 10 pointers shown since
  install against the turn they came on.
- **Why:** two co-uses at 0.25 now clear 0.4, so pointers should begin to show within a day or two.
- **Changes a decision if:** pointers show but mostly beside the point (the 10-18 hand-read was 2 right of
  20 at a lowered threshold) → lower `CO_USE_DEPOSIT` or raise `CO_USE_MIN_SCORE` to 3; or memories hit the
  outgoing bound (a node's links summing to 4.0; the hermetic heavy month put five "hub" memories there with
  72 evictions) → cap co-use deposits per pair per day. Revert: both deposits to 0.

### D. Habituated memories
- **Look at:** the Feedback loop line's "memories habituated now" and "habituated showings got through
  anyway"; then hand-read the habituated ids (the `note:habituation` row in the cache, or rows rated 0 in two
  sessions): are they noise?
- **Why:** a memory rated 0 in two sessions within 7 lived days faces a ×1.5 bar until the ratings age out
  or a later 2 clears it.
- **Changes a decision if:** a habituated memory turns out to be one a session later needed (rated 2–3
  after habituating) more than once → the lift is too strong or two sessions too few; if none ever
  habituates while noise stays near half → the lift is too light. Revert: `HABITUATION_BAR_LIFT` 0.

## Checked 2026-10-22 (see "Checked 2026-10-22" above), was due ~2026-10-22, two lived days after install: the feedback loop, Builder 2 (an experiment — docs/decisions.d/feat-feedback-loop-gate-dream-1019.md)

Trying three things together to see whether the day teaches the system (#523): footnotes skip what this session
wrote (C), the dream replays what the day used (E), and the nightly run's own sessions get no footnotes (F). Revert
by the paths in the fragment.

- **C, the echo skip:** `echoSkipped` per day and per session on `recall.decision` rows, and `adapter.recall`'s
  `echoWindow` (`compaction` / `session` / `unread`; one `unread` per session is normal, since the transcript is
  written only after the first prompt). How many showings a long session lost; whether compacted sessions get their
  early memories back. Footnote ratings over the same days: does the 47% noise share drop? **Changes it if** a
  session misses something it wrote earlier and needed → narrow the window.
- **E, the day replay:** `dream.begun`'s `today`, `todayReward`, `todayDreamed`, `todayPairs`, `freshMarked`; how many
  `today` memories the dream replayed or linked (`dream.changed`); whether used memories get dream returns more
  often. **Changes it if** `today` crowds out new memories (`queue.waiting` rising) → lower `TODAY_FIT` or `TODAY_COUNT`.
- **F, the nightly run:** night children's sessions have no `recall.decision` rows after install, and their
  `recall.credit` rows read `shownFootnotes: 0`.

## Checked 2026-10-22 (see "Checked 2026-10-22" above), was due ~2026-10-22 (stemming + everyday-word weights, 2026-10-19, an experiment — docs/decisions.d/feat-stemming-everyday-words-1019.md)

- **Trying:** the word index stores light stems (bake/bakes/baked/baking are one word), and a cue word's
  rarity is scaled down when the embedder's table says it is everyday English ("any", "what", "you"), to see
  whether first prompts surface what they are about. Both ambient recall and facts mode.
- **Look at:** (1) the re-stem landed: `sqlite3 "file:$HOME/.counterparts/store/cache/cache.sqlite?mode=ro"
  "select value from cache_meta where key='terms'"` says `light-1` after the first worker run. (2) Footnote
  ratings and items shown per turn since install, against the week before (`adapter.recall` rows), especially
  first prompts. (3) A few of Mike's own opening questions: did the memory he meant show?
- **Changes a decision if:** ~~items shown per turn drop~~, or ratings fall, or a name/id he searches for stops
  matching → revert. A stem merging two different words in his real use (known: even/evening, morning/morn,
  sim/sims) → add an exception.
  **2026-10-25 (Mike, 11:26): the "items shown per turn drop" trigger is retired, and stemming is kept.** It
  was met on 10-22 but measured the wrong thing: a replay with stemming OFF shows fewer items, not more
  (0.42 → 0.39 a turn; `~/counterparts-notes/2026-10-25-0327-reread.md`), so the drop was not stemming's.
  The other triggers stand (ratings fall; a searched name or id stops matching → revert; a stem merging two
  real words → an exception). The drop in items shown per Mike-typed turn is not dropped: it is an open item
  in the roadmap's fresh-memory priming talk.
- **Revert:** the discount alone: set `EVERYDAY_NORM_HIGH <= EVERYDAY_NORM_LOW` (recall tunables). Stemming is
  not free to undo: unstemmed lookups miss stemmed rows, so it needs a build that indexes surface words again
  and keeps asking for both forms, or another cache bump whose worker step re-indexes from prose.
  **Not by installing 0.3.26 over the v7 cache:** its memory server refuses every tool and its hooks miss
  stemmed rows. If that happens: delete `~/.counterparts/store/cache/cache.sqlite*`, then run
  `counterparts verify --rebuild --keep-vectors` on that build (deleting alone leaves word recall empty).
  `counterparts rollback` does not cover a cache-only change.

## Checked 2026-10-22 (see "Checked 2026-10-22" above), was due ~2026-10-22 (context priming, 2026-10-19, an experiment — docs/decisions.d/feat-context-priming-1019.md)

Trying a downward direction for recall (#530): what the session used and wrote, and the folder's open threads and
handoffs, give their linked partners and memories near a centred train-of-thought vector a head start; it can lift
a candidate past the bar but never introduce one. Revert: `PRIME_LINK_UNITS` and `PRIME_TRAIN_SHARE` to 0
(centring alone: `PRIME_TRAIN_CENTRE` 0).

- **Look at:** `recall.decision` rows' `primed` summary (sources by kind, `train`, `trainCentre`, `shown`,
  `lifted`, `byLink`, `byTrain`) and each shown row's `primed` part. How many footnotes a day were primed, and how
  many only because of it.
- **Ratings:** primed against unprimed footnotes (`recall.rated` joined on ids): are primed ones rated 2–3 more
  often? The lifted ones especially.
- **Changes it if** tunnel vision: the same primed cluster turn after turn while the prompts changed subject, or the
  same `from` source priming several turns running → lower `PRIME_CEILING` or `PRIME_TRAIN_SHARE` first, then
  `PRIME_SOURCE_DECAY`. On lagged turns the train can still outweigh the lagged cue; watch that too.

## Due ~2026-10-23 (the nightly writers held to the page's room, 2026-10-20, an experiment — docs/decisions.d/feat-page-held-to-room-1020.md)

Trying: the page writer and the reflection are refused the night's first page past the 4,600-byte room ("cut,
don't add a short version"); a second try is kept, and a held page never sent again is kept at the run's end. A
page past the room with a short version shows that in the wake. Revert: `PAGE_HELD_TO_ROOM` and
`PAGE_SHORT_PAST_ROOM` false (`src/core/self/tunables.ts`), and the 2026-10-10 sentence back in place of
`PAGE_ROOM_RULE` (`src/core/self/writer.ts`).

- **Look at, three mornings:** the page's bytes after each night (`self.page.revised` rows: `bytes`, `by`; the
  last one before the morning's first session), and whether it is within 4,600. The holds: `self.page.refused`
  rows with `reason: "past-room"` (`bytes`, `over`, `by`), and whether the same night then has a revised row by
  the same door within the room (cut), past it (kept on the second try), or one whose reason ends "kept at the
  run's end" or "kept at a later boundary" (never sent again; the second is a night with no run end).
- **The wake:** the session-start wake's `elements=` count in its head tag (or `self.briefing` rows'
  `elements`) and the page's rung (`page.rung` on the same row: `whole`, or `short` past the room), against the
  10-20 morning: 4 sections down to 3 with a 4,956-byte page.
- **Changes it if:** the pages come in thin but lose things that mattered (read one beside the 10-20 page), or
  a night's held page was kept at the run's end most nights (the resend isn't happening: look at the words the
  writer is sent back with), or the hold keeps firing every night by a few bytes (the room may be too tight for
  this page).

## Due ~2026-10-29 (beliefs shown, and priming changed again — wave 2 lane E, 2026-10-22, experiments)

**Re-dated 2026-10-29 (the beliefs slot only).** Read the slot when 3+ beliefs about other people pass the 0.3 floor,
not on a date. Why the read so far is thin: beliefs about me or us are page-only by design (the self lives on the page,
per the wave-2 design), so the slot has only ever shown one belief (`sch_305a1aabc8fa`, 62 showings to 10-29). Page-only
stays as it is.

**What we're trying.** Beliefs (lane C) reach a session for the first time, and priming gains a source.

- **The beliefs slot** (`recall.BELIEFS_IN_RECALL`, on): a turn that names a subject (a card, or a topic by its
  word) shows its strongest beliefs above 0.3, at most 3, in their own block after the footnotes, each with a
  strength word, its support count and its id, once a session. Footnotes stay belief-free. A rating of a belief
  line is a use of it (once a lived day), never support, and nothing for a belief about me or us.
- **Tags prime — PRIMING CHANGED AGAIN** (`recall.TAGS_PRIME`, on): a source's tags are a partner source beside
  its links, at 0.1 a shared tag and 0.05 through a concept edge. This lands after the 10-22 read of #530's
  context priming, so the re-read on this date sees both; read tag-primed footnotes apart (`primed.by: "tag"`).
- **The wake's project line** (`self.WAKE_PROJECT_LINE`, on, an experiment that has to earn its room): in a
  project's folder, its strongest beliefs (at most 3, 480 bytes), spliced last, the first thing a full wake drops.
- **Per-footnote priming flags** (the 10-22 read's ask): each shown row's `primed` now carries `by` (link, tag or
  train), `top` (the source id that gave most) and `tag`, beside `lifted`.

**What to look at.** On `recall.decision` rows: `beliefs` (null off; `shown` non-empty = the slot fired; `bytes`
per turn) — fire rate per turn and per session. On `recall.rated` rows: ratings with `lane: "beliefs"` against the
footnote baseline (10-19: 47% noise, 18% useful), and `notCredited["belief-about-me"]`. Priming: `primed.byTag` on
the decision rows, and footnote ratings joined per row on `primed.lifted` / `primed.by` / `primed.top` (tunnel
vision: the longest run of one `top` across consecutive turns of a session). The project line: ring events
`counterpart.project.shown` / `.noroom` (bytes), and whether its ids are opened or rated later; and (review of
#588) how often the line takes the head tag's room — `tagged` false in project folders, 216 of 430 ceilings in the
reviewer's scan — and whether `adapter.injection.overbudget` rows follow (the host's ~60-byte tag sits outside the
ceiling; self NOTES). And the design's
new eval: how often a session repeats something already corrected or re-raises something settled — the slot
should not raise it. Read it with `counterparts mechanisms --dir ~/.counterparts/store` (the line "Settled things
drawn on again: N of M pairs this week (changed a of b, corrected c of d — …); came up again R; shown only S", the
"beside it" line and the "by build" split by kind) or
`counterparts mechanisms --dir ~/.counterparts/store --json | jq '.settled | {pairs, repeats, reraised, viaWinner, shownOnly, byHow, byBuild}'`
(counts by kind, by way in, per build, example ids). Compare the pre-0.3.32 bucket (`pre-stamp`, or 0.3.31) with
0.3.32's, each beside its turns and lived days. Baseline, the 10-22 snapshot copy (window 10-16..10-22, all
pre-stamp, 1,254 recall turns on 8 lived days): drawn on again 2 of 231 (changed 2 of 210 — both rated 3 by a
session, one also named in `drewOn` and refused, 1 without its winner in the same row; corrected 0 of 21), came up
again 0, the winner in a newer pair 0, shown only 14. The definition, and where it departs from the brief:
`docs/decisions.d/feat-repeat-reraise-eval-1022.md`.

**What would change it.** Belief lines rated as noise as often as footnotes or more → raise the floor or the
strength a belief needs (`BELIEFS_SLOT_FLOOR`), or show fewer (`BELIEFS_SLOT_MAX`). Tag-primed footnotes rated no
better than unprimed → lower `TAGS_PRIME_WEIGHT` or turn `TAGS_PRIME` off. The project line dropped for room most
wakes, or its ids never drawn on → turn it off.

**Revert.** Each switch false: `recall.BELIEFS_IN_RECALL`, `recall.TAGS_PRIME`, `self.WAKE_PROJECT_LINE` (each off
is the build without it, byte for byte); or revert the PR. Compare first with `harness compare --set …=false`.

## Due ~2026-10-29 (card kinds back to the night; twin cards merged once — wave 2 follow-ups, 2026-10-22)

**What changed.** A card's birth kind no longer counts as its kind of subject. Only the identity core is a person
without a judgement. Once per store, the night's tags phase gives the rows the old rule wrote back to the kinds
ask (`schemas.kinds.repaired` holds each id and what it was). On the 10-22 corpus copy that was 10 cards:
Counterparts (place), and Anthropic, Claude, Katie, Montaigne, Clark, Jason, Ellis and the two Allex cards (person).
The same-name twin cards are merged once per store by the births phase (`schemas.TWINS_MERGE`, on):
the younger card of each pair is archived `card-twin` under the elder (`schemas.twin.<id>`, the run in
`schemas.twins.merged`). On the copy that was all 50 pairs, none skipped; live cards 161 → 111; the keepers gained 287
links on 208 live memories (23 cards) that named them while the twins lived (`linked` and `linkedMemories` on the record; doctor's v14 line says both).

**What to look at, on the 10-29 snapshot (a copy).** The kind distribution of live entity cards:
`SELECT coalesce(subject_kind,'NULL'), COUNT(*) FROM memories WHERE type='schema' AND json_extract(meta,'$.role')='entity' AND archived=0 AND body != '' GROUP BY 1`,
and who set each kind (`meta` keys `schemas.subjectKind.%`, `by`). Did the ask call Counterparts a project and
Anthropic not a person? Twin pairs still live:
`SELECT lower(json_extract(meta,'$.name')) n, COUNT(*) c FROM memories WHERE type='schema' AND json_extract(meta,'$.role')='entity' AND archived=0 AND body != '' AND coalesce(json_extract(meta,'$.name'),'') != '' GROUP BY n HAVING c > 1`
(50 on the 10-22 copy, 0 expected after the first night; any above 0 is a pair the pass skipped,
counted in `schemas.twins.merged`'s `skipped`, or a new race).

**What would change it.** The ask sorting people wrongly, or too slowly (10 a night) → raise `TAGS_KINDS_PER_NIGHT`,
or bring back the person rule for cards the ask has not reached. A twin the owner wants back →
`counterparts dream --undo-twins [card]`. **Revert.** `schemas.TWINS_MERGE=false` before the pass runs (it runs
once; after it, the undo door); revert the commits for the rest. The repaired kinds stay NULL until the ask
sorts them (the record lists what each was).

## Due ~3 nights after release (the night's fence, 2026-10-30 — docs/decisions.d/fix-day-summary-held-1030.md) — checked 2026-11-03, above; re-read with NC1's trigger

- **What we're trying:** a folder that doesn't export is closed to the whole night (`dream/slices.ts`).
- **Look at:** `self.page.writer.ran` rows' `omitted` (0 unless a closed folder had that day); `mcp.recall` rows with
  reason `closed-to-the-night`; `dream.begun` queue counts beside the nights before; each night's run time (the walk
  is about 150 ms a call on the owner's store, once per dream, reflect and night recall call).
- **What would change it:** a `folder-setting` row or `night-held` red that wasn't a broken file, or a night that ran
  on a broken one: the hold is meant to be all of it (no page, dream or reflection). Night calls slow
  enough to matter: hold the set for the call's run instead of walking each time. A closed folder's words on the page
  or in a new merge: find the door the door test missed.
- **Revert:** `fenceNight` returning the empty set turns the fence off; `nightHeld` and `settingBroken` returning
  nothing turn the hold off.

## Due ~1 week after release (the day-summary gate, 2026-10-30 — docs/decisions.d/fix-day-summary-held-1030.md) — checked 2026-11-07 ("Checked 2026-11-07" above)

- **What we're trying:** the Yesterday gate (`Counterpart#daySummaryShown`) stops counting a row written that day about
  another day, or born after the summary was told: day's end is handed neither, and since the night's fence its recall
  can't reach a closed folder either. Every summary held back leaves one
  `handoff.daysummary.held` row per date and cause (kinds only).
- **Why:** the 10-29 summary reached no wake. Three write-ups of 10-26, from a folder set off that day, were filed on the
  morning of 10-29 and read as that day's.
- **Look at, ~1 week after release:** `SELECT json_extract(payload,'$.about'), json_extract(payload,'$.what'),
  json_extract(payload,'$.why') FROM events WHERE name='handoff.daysummary.held' ORDER BY seq;` beside the written
  summaries (`self.page.writer.ran` rows with a summary). Does each morning's wake lead with it?
- **What would change it:** `no-folder` rows on a current build: find what writes without a folder before loosening
  anything. `folder-closed` often, on days an off folder really wrote: then filter day's end's input instead of holding
  the prose. A summary that shows a closed folder's words: revert.
- **Revert:** put the `inDay` clause, the scope-count clause and no time bound back in `daySummaryShown`; the row can stay.

## Due ~2026-10-29 (the dream's fresh intake, 2026-10-23, Mike's go 10-22, an experiment — docs/decisions.d/feat-dream-intake-1023.md) — read 10-29 (`~/counterparts-notes/2026-10-29-read.md` item 5) and checked 2026-11-02, above

**What changed.** The dream's fresh list may cost 16,000 characters (`dream.FRESH_LIST_CHARS`, was 12,000; Mike okayed 24k, see the decision) and each
new memory carries 4 nearest older neighbours (`dream.NEIGHBOURS`, was 6). The composition compare on the 10-22
snapshot read 44 → 64 fresh a night, nothing left out, whole texts 20 → 11, about +1.3k tokens.

**What to look at (read-only).** The nights' intake from `dream.begun` events, split by build (0.3.33 on):
`SELECT json_extract(payload,'$.build') b, date(at/1000,'unixepoch') d, json_extract(payload,'$.fresh') fresh, json_extract(payload,'$.queue') queue, json_extract(payload,'$.waiting') waiting, json_extract(payload,'$.agedOut') aged, json_extract(payload,'$.whole') whole, json_extract(payload,'$.parts') parts FROM events WHERE name='dream.begun' ORDER BY seq DESC LIMIT 12`
— `fresh` (expect ~60, not ~44), `waiting`, `agedOut`, and `whole` (near 11, not 20). The last night on
0.3.32 (10-23) read fresh 42, queue 671, waiting 629, agedOut 119, whole 19, 4 parts. Read one or two dream journal entries from before and after: did a
dream with less whole text get thinner (fewer links made, shorter gists, fewer contradictions raised)?

**What would change it.** Dreams noticeably thinner → NEIGHBOURS back to 6 (at 6 the fresh room binds before the list: ~51 fresh).
Fresh still ~44 → a setting didn't take (check `build.<version>.settings` and the values in the shipped
tunables). The queue still grows either way; draining it needs `FRESH_SHARE` or `NIGHT_CHARS`, which costs
tokens and is Mike's call. **Revert.** Both values back in `src/core/dream/tunables.ts`.

## The wake's room (WK1)

**Trying (0.3.42, 10-30; split any read by `build`):** "Might be relevant" off the wake; no bare ids; the
handoffs, "Last here" and "Last said here" as one block, the newest handoff leading at up to 5 lines with a newer chapter
under it by title, and the next 2 live handoffs a line each; the 2 oldest overdue listed by title and age. Why: the bare-id complaint
came back in four wake reads, and the "here" threads disagreed in two.

**Look (~11-06):** the next ~/random wake read, by a session that says how it read. A week of `self.briefing`:
`trimmedTotal` per render and `trimmedLanes`. Most of the drop in trimmed counts is hints no longer being candidates, so
read `trimmedLanes.threads` beside it. `self.work.overflow` and `adapter.wake.injected` bytes per folder: the wider block
takes its room from "Work here" first, and from bytes over 8,700. `handoff.lasthere.noroom` per day, against 13 in the
week before.

**Open-threads read:** overdue going to titled items is the one overlap, and they step back before they cost "Still open"
an item. Split by the build that carries this.

**What would change it:** a wake read that still finds the block long, or "Work here" gone on most folder-days: cut the
other handoffs' lines first (`HANDOFF_OTHERS_SHOWN`), then the lead (`HANDOFF_LEAD_LINES`). Sessions recalling less now that no bare ids are offered
is expected, not a fault: `recall.credit`'s expansions would show it.

**Revert:** `HINTS_IN_WAKE` true for the lane; the rest by reverting the PR. The ids in count lines are not behind a switch.

## A closed folder's plain reminder

**What we're trying:** a plain reminder that is a closed folder's work isn't said and isn't spent; marked about the owner, or with no folder, it is said whatever the folder. Coming up holds whatever the mark, so the two differ on purpose.

**What to look at:** doctor's Fired line saying `held back`, and the owner's word on any date he expected. Past its grace (7 days) a held one is gone with no line, which is the case to read for: a folder off for weeks with a real date in it, marked work or unmarked.

**What would change it:** a real date lost that way (mark it, or tell at the off switch what's waiting), or a personal line from an off folder that shouldn't have been said (drop the `isWorkMemory` line in `dream/slices.ts#reminderHeldBack`, and it matches Coming up).

**How to revert:** `Lifecycle#plainFor` stops asking `plainHeldBack`.

## The wake's shape (WK2)

**What we're trying:** the wake designed top-down, one question per section, no item twice, a whole title or a door where something doesn't fit. Built behind `self.WAKE_SHAPE`, off; one store on first (`counterparts wake-shape on`).

**The clock started when it was turned on, not at merge: on for Mike's store from 11-01.** ROADMAP holds the read, with the dated reminder at 11-04 (settles when the reading's written up), and no default changes before it.

**What to look at, a few days after:** real wakes in the folders that use them most, read for the draft's test: without a tool call, what's live, what's owed, what changed since this note? And `adapter.wake.injected` rows by `sec_*`: bytes per section against the table in the PR; `pageRung` whole every day; any `counterpart.wake.shape.declined` or `.failed` in the process log; how often `Nothing here since.` prints (0 of 30 in the prototype's sweep; a line that never prints can go). Then: is the door used? `mcp.recall.comingup` and `mcp.recall.handoffshere` by day.

**What would change it:** a wake that fails the test, or a claim read as live that the lead has since settled. Unused room stays unused for now (ROADMAP, 10-30): 500-1,250 B on the 10-30 corpus; read the number, and `SPARE` in the composer is the one list to extend if it should go somewhere. Elsewhere's door is `recall "elsewhere"` since 10-30, which lists what the section counts: read whether a session that follows it finds the folder it wanted, and whether a folder named with no title (a quiet one) is any use.

**How to revert:** `counterparts wake-shape off` for the store; the switch's default is off until ROADMAP changes it.

## A failed mint

`remember` and `session_end` wrote the claim, then the memory, so a mint that threw lost the note and marked its words as written up. The claim now comes after the mint (`src/core/remember/NOTES.md`, "A failed mint"; docs/IMPROVEMENTS.md). Before the fix, on the owner's logs (10-25 to 11-01): no lock or full-disk lines in 29,622; `session_end` 1,791 entries, 1,787 stored. `remember` wasn't visible at all.

**Check, ~2 weeks after release:** count `counterpart.deposit.mint.failed` in `sessions/log/` by `landed` and `source`, and `mcp.refused` with `reason: threw` for `remember`. `counterparts doctor` counts them among its failures. For any that happened: did a retry land (a memory with the note's session within minutes), and did twins appear (same body, two ids, before a sleep pass folded them)?

**What would change it:** a steady rate of `landed: false` means writers are holding the lock past 5 seconds, which is its own fix. Twins that sleep doesn't fold mean the kill window isn't as small as it reads. A `notLanded` on a nightly write-up with nothing saved after it means that last-part case needs a resend.

**How to revert:** `counterpart-deposit.ts#deposit` back to `submitProposal` before the mint. That restores the loss.

## Each item shows where it can be acted on (SO1 step 3)

SO1 step 3 (2026-11-07, decided with Mike; a fix, no switch): `core/counterpart-wake-shape.ts` (Coming up),
`Counterpart#plainAway` (the lines above the wake and the terminal line, at a start and at a prompt),
`self/work.ts#threadPlace` (world stays home). Why: the door read of 11-07 found plain reminders due today crossing
folders whole, 16/34/33/3/16 mine-class items a day across 11-02..11-06, and one about-world thread in every folder.

**Check, ~3 lived days after install:** for each of those days, the distinct item × folder pairs shown outside their
folder, from the host transcripts' wake text (`~/.claude/projects/*/*.jsonl`, the `Due today ·` and `Still open:` lines
with their ids) joined to each id's `origin_scope` and `about` on a snapshot copy. Count by class as the 11-07 door read
did (mine / Mike's / world's / personal). Expect ~0 outside personal. Also: every work plain reminder due on a day its
own folder had a session was shown whole there (`adapter.plain.told` and the `prospective.plain` latch's session in that
folder). Crossings: `prospective.plain.crossed` rows per day (each a work reminder that went unsaid because its
folder had no session, told once elsewhere with its folder named), and whether each was a real deadline Mike wanted
to hear about. Doctor: "due while its folder had no session" is info; "due where a session could say it, and not
said" (amber) should only follow a crossing that didn't happen. And in claude.ai chats: only personal plain
reminders told. Cost: `bun tools/bench/plain-cross.ts` on a snapshot copy; a prompt runs no crossing read.

**What would change it:** a personal item Mike wanted that stayed home (mark it owner), or a work reminder he needed in
a folder it wasn't written in (join the folders as one project, or widen the rule). Crossings that are noise (stale
items from a folder he's done with) would argue for a shorter lookback than 30 days, or a done-sweep of that folder;
a deadline that still went unsaid would argue for crossing sooner than 2 lived days.

**How to revert:** in `counterpart-wake-shape.ts` set `saysHere` back to `c.mine || c.plain`, drop the `plainAway` and
`plainCrossing` calls in `lifecycle.ts#plainFor`, and drop the `about === "world"` clause in `threadPlace`.

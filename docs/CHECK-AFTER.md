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

## Index (updated 2026-10-19)

**Open: being built, or live and waiting for a check**

| Experiment | Started | Check | Section / source |
|---|---|---|---|
| Feedback loop, upward (#525): graded use credit, drewOn as a full use, strong co-use links, light habituation; glimpses restart the fade clock | merged 10-19, unreleased | ~2 lived days after install | "Due ~2026-10-22 … Builder 1" below |
| Feedback loop (#523): no footnotes from this session (echo), the dream replays the day, no footnotes in the nightly run's sessions | merged 10-19, unreleased | ~2 lived days after install | "Due ~2026-10-22 … Builder 2" below |
| Head wins (#526): the newer memory stands in with the earlier one's bar (or its own); the earlier one is held back whenever a head stands in | merged 10-19, unreleased | ~2 lived days after install: settled-over memories shown alone → ~0 | `docs/decisions.d/fix-head-wins-gap-1019.md` |
| Stemmed word index (cache v7) + everyday words weigh less in cues, ambient and facts | building 10-19 | ~10-22; revert by 11-02 | "Due ~2026-10-22" below; `docs/decisions.d/feat-stemming-everyday-words-1019.md` |
| Context priming (#530, the downward direction): what the session used/wrote and the folder's open threads warm neighbours, along links and a centred train-of-thought vector; handoffs age 0.7/lived day | merged 10-19, unreleased | ~2 lived days after install: ratings of primed vs unprimed footnotes, tunnel vision | "Due ~2026-10-22 (context priming)" below |
| Association: no links written when a memory is stored (`WRITE_LINK_MAX` 0, was 4); contiguity kept, old ones fade | merged 10-19 (#528), unreleased | ~2 lived days after install: pointers and links per node from co-use alone; revert if the graph starves | `docs/decisions.d/chore-write-links-slot-flag-1019.md` |
| Slot detector flags only: no provisional fade (`SLOT_FADE` 1, was 0.8); the fade comes with the dream's or the writer's confirmation | merged 10-19 (#528), unreleased | ~2 lived days after install: proposals' `faded: false`, the dream's same true/false, confirmed ones at the full fade | `docs/decisions.d/chore-write-links-slot-flag-1019.md` |
| The reflection closes open threads that are plainly done (`closeNow`, a why each, said in the share; `reopen` undoes), and still asks about the unsure ones | building 10-20 | ~10-24: how many it closed itself (`reflections.detail.selfClosed`, `reflection.finished`'s `selfClosed`) (any folder, by Mike's 10-20 exception) and how many it asked instead, confidential or reopened (`closeAskedInstead`), whether any was wrong (`detail.reopened`, `reflection.reopened`), how the wake's Still open count moves from 58; revert by putting back the 10-16 `close` line in the prompt | `docs/decisions.d/feat-reflection-closes-done-threads-1020.md` |
| Meaning computed in line whenever no fresh cue is ready (#521) | merged 10-19, unreleased | ~2 lived days after install: share of turns `in-line`, footnote ratings | `docs/decisions.d/fix-first-prompt-meaning-1019.md` |
| Wake polish (#517) + the ~/random session's 10-19 notes (one session named four times, a today-dated item under Still open in another folder's wake, three tags at the top) | 0.3.26, 10-18 | ~10-20 | "Due ~2026-10-20" below |
| Emotion's weight (about ×11 slower fading at a strong feeling vs ×2.8 designed), kept to watch | 10-18 | 2026-11-01 | "Checked 2026-10-18" below |
| Mood-matched recall re-test, once drewOn gives a signal | 10-11 | when credit flows (after the feedback loop) | "Once drewOn gives a signal" below |
| Forgetting: archiving resumes after 0.3.24 restarted the 14-lived-day wait | 10-14 | ~late October | "Ongoing" below |

**Two follow-ups from the 10-19 overdue checks** (`~/counterparts-notes/2026-10-19-overdue-checks.md`)

| Change | Why | When |
|---|---|---|
| Head wins: hold back a settled-over memory whenever its head was brought in for it (gate.ts ~L452) | 36 footnotes since 10-12 showed an earlier memory while its head didn't (21 ids) | done: #526 |
| Slot detector: a proposal flags only, no provisional fade until the dream confirms | 4 of 7 right by hand-read, under the ~3-in-4 bar; the dream said "not the same" on 3 of 4; raising SLOT_COSINE doesn't separate them | in review 10-19 (`SLOT_FADE` 1), with the write-time links row above |

**Checked** (kept below for the record): 10-12 first new-curve pass; 10-14 check-in; 10-18 wake trims, exit at 7
vs 14 days, Group 4 association; **10-19 the five overdue ones**: catch-up cost (1.75x the estimate, caps fine),
reflection/dream child context (peak 127.5k of ~150k, creeping up from 114k: watch), verbatim trial (keep; barely
exercised), Group 2/2b (fine, except head wins and the slot detector above), ongoing (head wins as above; the era's
effect on archives folds into the late-October forgetting check). Details: `~/counterparts-notes/2026-10-19-overdue-checks.md`.

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
  is not also shown. With the head-wins rule (recall CONTRACT §6b) that should be only a guest session with a
  confidential head. Also the wake's lanes, which already left settled-over memories out.
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

## Due ~2026-10-22, two lived days after install: the feedback loop, Builder 1 (an experiment — docs/decisions.d/feat-feedback-loop-credit-1019.md)

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

## Due ~2026-10-22, two lived days after install: the feedback loop, Builder 2 (an experiment — docs/decisions.d/feat-feedback-loop-gate-dream-1019.md)

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

## Due ~2026-10-22 (stemming + everyday-word weights, 2026-10-19, an experiment — docs/decisions.d/feat-stemming-everyday-words-1019.md)

- **Trying:** the word index stores light stems (bake/bakes/baked/baking are one word), and a cue word's
  rarity is scaled down when the embedder's table says it is everyday English ("any", "what", "you"), to see
  whether first prompts surface what they are about. Both ambient recall and facts mode.
- **Look at:** (1) the re-stem landed: `sqlite3 "file:$HOME/.counterparts/store/cache/cache.sqlite?mode=ro"
  "select value from cache_meta where key='terms'"` says `light-1` after the first worker run. (2) Footnote
  ratings and items shown per turn since install, against the week before (`adapter.recall` rows), especially
  first prompts. (3) A few of Mike's own opening questions: did the memory he meant show?
- **Changes a decision if:** items shown per turn drop, or ratings fall, or a name/id he searches for stops
  matching → revert. A stem merging two different words in his real use (known: even/evening, morning/morn,
  sim/sims) → add an exception.
- **Revert:** the discount alone: set `EVERYDAY_NORM_HIGH <= EVERYDAY_NORM_LOW` (recall tunables). Stemming is
  not free to undo: unstemmed lookups miss stemmed rows, so it needs a build that indexes surface words again
  and keeps asking for both forms, or another cache bump whose worker step re-indexes from prose.
  **Not by installing 0.3.26 over the v7 cache:** its memory server refuses every tool and its hooks miss
  stemmed rows. If that happens: delete `~/.counterparts/store/cache/cache.sqlite*`, then run
  `counterparts verify --rebuild --keep-vectors` on that build (deleting alone leaves word recall empty).
  `counterparts rollback` does not cover a cache-only change.

## Due ~2026-10-22 (context priming, 2026-10-19, an experiment — docs/decisions.d/feat-context-priming-1019.md)

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

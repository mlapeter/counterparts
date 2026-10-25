# Worklist

*The details behind the roadmap's "To do" list. Started 2026-10-20, updated 10-22 11:30. One entry per thing still to do: what it is,
why, where it stands. Close an entry by moving it to "Done" with the date and the PR; drop it after a release.
Experiments with a date to check live in [CHECK-AFTER](CHECK-AFTER.md); this file points there rather than
repeating them.*

---

## Being built

- **F4. Sessions see each other's work** (PR #543, reviewed, merging). "Today, elsewhere" and "Since you started"
  name up to two gated work titles per other folder, and "Here, also open" names other live sessions in this folder
  with theirs. Review found and fixed three leaks (status-marked personal items, open threads in the per-prompt
  line, the night's write-ups). Watch at ~10-23: with four sessions in one folder only about one title fits.

## Follow-ups found today (not started)

- **Refresh the harness corpus copy after each release** (Mike, 10-22). The replay corpus is a copy from 10-20,
  older than beliefs and tags, so the 10-22 replays saw none of either. After each release, copy the corpus from
  that night's snapshot, so replays read a store the release has actually run on.
- **Model harness runs: once per release** (Mike, 10-22). One night compare for each switch whose default changed
  in the release, spent by the coordinator at cut time, rather than runs per lane or per PR.
- Day's end shouldn't READ off/observer folders' chapters at all, so its summary is clean by construction and the
  Yesterday gate's off-folder block can go (roadmap 10-25, after Y2 #624).

- **Night children's session ids** (from the 10-22 read): `dream.night`, `dreams.session` and `reflections.session`
  all hold the parent session, so "the nightly run's sessions get no footnotes" (#523 F) can only be checked by time
  window. Record each child's own session id on `dream.night`.
- **Per-footnote `lifted` flag** (10-22 read): priming's `lifted` is a count on the decision row, so lifted footnotes
  can't be joined to ratings. Add it to each shown row (the TAGS_PRIME lane may fold it in).
- **submitJot doesn't forward `ctx.at`** to deposit, so remember's `at: today` is dropped (found 10-21).
- **Doctor's Old settings line says "ignored — ignored"** (doctor.ts join), a nit for 0.3.31.
- **Folders kept out of Counterparts: set their scope `off` explicitly.** They stay out today only because no hooks run there;
  an unset scope reads as `on`, so a memory filed from one could be named elsewhere by F4. Mike runs
  `counterparts scope off <path>`.
- **For the plugin split release (MOD's #547, after the directory approval):** a one-time core message telling
  plugin users to add counterparts-sidebar after updating; `onboarding.ts#finishText` says "/counterparts shows the
  memory sidebar" to every plugin install, wrong for a core-only one. (MOD folds keepOne and doctor's `twiceFix`
  into #547.)
- **Recall: same-session neighbours** (BENCHMARK's fix #2), after its measurement of #544's title tail.
- **"Read last night" lists the reflection's core decisions** (`adapters/mcp/nights.ts` shows closes, not
  `coreDecided`).
- **F4 room** if the ~10-23 check shows the four-sessions line too thin.
- **Wake polish from random-7b's read of the 10-21 wake** (relayed by the Fable roadmap session, mem_2008a1ffe09f;
  one small PR, not roadmap). (1) The wake says nothing about the night: only the day's first session hears it
  finished, through the prompt hook. Add one line: dream ran HH:MM `drm_…` / running since HH:MM / none yet, and
  whether the morning share was already told and in which session, so a second session doesn't retell it.
  (2) "Still open"'s tail of five bare recall ids is weight: show the oldest untouched item's title, or nothing.
  (3) "Last said here" is cut past meaning ("morning! morning!"): give it enough words, or drop it when it's
  that short. random-7b called "Today, elsewhere" the wake's most useful line (F4 working as meant).

## Needs a talk first

- **Lists vs attachments.** Decided 10-15, lightly held: lists and tables stay word for word in memory bodies, no
  attachments table yet (only 2 verbatim lists in ~700 memories, both inside the ~3 KB meaning window). The trigger
  to build attachments is a real list past ~3 KB, or the bench showing blur on long bodies. Mike's long-run lean is
  toward attachments. Re-check due 10-22; it's also part of the notes-module question below.
- **The notes module.** Brief written 10-15 (`~/counterparts-notes/2026-10-15-notes-module-brief.md`): a separate
  module for exact records (the great-assistant "which drawer the VIN is in"), notes as the source layer, files plus
  an index, a deliberate notes tool, and recall pointing into notes. Recommended next on 10-19, because it's the only
  mechanism talk that leaves 0.3.27's experiments untouched.
- **Dream throughput.** About 40–55 new memories a night by priority; the queue holds at 400–590; on a busy day about
  1 in 10 new memories is ever dreamed (389 waited after the 10-20 night). Is that enough? Talk after ~10-22, so a
  change doesn't muddy #523's reading.
- **Schemas, with gist.** Beliefs and entities that grow from what's lived; the only mechanism not built. Dreams write
  about 8 gists a week, and many episodes becoming one understanding happens only by chance.
- **F3. The decisive memory stays quiet at the moment of action.** When Mike ran the backup on 10-20, ~/random was
  offered unrelated footnotes; the 10-13 decision that backups hold no conversation text never came up, and the
  memory that did was the stale one saying backups copy spans, so a non-problem got flagged. Same root as the 10-19
  big-picture thread 1 (memory and use barely touch). Take this test case, and footnote noise (~2 of 7 useful in
  ~/random on 10-20; 47% noise / 18% useful measured 10-19), into the ~10-22 check before designing anything.
- **From the retired 10-10 decisions list**: checked 10-20 on snapshot copies
  (`~/counterparts-notes/2026-10-20-six-decisions-check.md`). Five retired as fine (skill salience, the symmetry
  tripwire, the #415 trim, whose A/B was run and recorded in the bench log, a note's own turn, routine-work median
  0.60 → 0.20); the sixth (core questions waiting) became #542, merged.
- **Benchmark-motivated changes from 10-18** (Mike: lightly held, review in about a week): #516's "may be inside the
  window" label and the rest of that day's list. Due ~10-25.
- **The synthetic bench's drift**: re-tune check (BENCHMARK session's).

## Outside this repo (other sessions)

- **The plugin in Anthropic's directory** (submitted 10-14, holds waiting on a reviewer). On 10-21: if it still isn't
  approved, decide whether to make the r/ClaudeCode maker post without it (distribution, in ~/random).
- **The directory flavor** of the plugin, held (mod session).
- **The site** (counterparts.ai SEO/AEO push, in ~/counterparts-site).

## Later (on the roadmap, not scheduled)

More hosts (claude.ai needs a tunnel or a hosted piece); the dashboard walk (Health, Flow, mobile); Windows (WSL
first); the nightly run's timing (a real night run needs a scheduler); dates written into memories' words; the site
as a public roadmap. Ideas and Parked: see the [roadmap](ROADMAP.md).

## Done

- **10-20, merged (unreleased):** F1 the reflection closes plainly done threads, across folders (#535); F2 wake
  without repeats, one tag, Coming up ids, one daily snapshot (#536); F7 read last night's dream and reflection,
  `counterparts night` (#538); F6/F6b a weekly reminder done for this week, credit for a just-replaced memory (#540);
  F5 the self page held to its room (#541); the reflection answers week-old core questions, Mike's retire sticky
  (#542); facts title tail and soft time words, from the benchmark loss read (#544); the fox follows activity (#545,
  MOD); docs #534, #539.
- **10-20, by hand:** three core questions answered on Mike's agreement (kept Katie's plain answer; retired the Han
  promise and the strong four-way telling, both pairs settled as changed); the self page's four-way line corrected
  (v45); the notes-and-schemas design brief written (`~/counterparts-notes/2026-10-20-notes-and-schemas-brief.md`).

- **10-20**: two stale threads closed on Mike's yes (the Han page line, the 10-09 bench plan); the 10-16 rebuild
  reminder closed (it ran as full-1017, 10-17→10-18); spans out of backups confirmed as the 10-13 design (f771a6b2);
  F8 checked: the page's "spending pauses until a product change could move a score" rests on the 10-19 rec and
  Mike's "fix real recall bugs before more benchmark spending".

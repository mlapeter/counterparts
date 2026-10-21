# Changelog

## 0.3.30 — 2026-10-21

Nothing is held back from your sessions any more. Confidential memories are gone: nothing in Counterparts could set that mark, so on most stores nothing changes on screen; a memory marked that way through the store directly now reads like any other everywhere, and doctor shows one amber line with how many remain only if your store had any. The split between your sessions and guest ones is gone too: any session, a Claude Desktop chat and the nightly run included, can close a thread or a reminder by its id from any folder (a protected memory still never closes), and every session gets its folder's "Last said here"; observer stays read-only. The nightly run no longer leaves a Claude Code transcript under `~/.claude/projects/`; transcripts from earlier nights are left to Claude Code's own cleanup, or you can delete the folder named after your memory store. The `owner` line in your configuration is now ignored and doctor names it under "Old settings" (you may delete it); `export --include-confidential`, the memory server's `--owner` and `COUNTERPARTS_OWNER` are accepted and ignored for this release. Code that embeds Counterparts loses the confidential fields and options listed below. No store-format change (store v13, cache v7) and no wiring change: nothing to run after upgrading from 0.3.29, and `counterparts connect` is not needed.

- **Confidential memories are gone: nothing is held back as confidential any more.** No
  part of Counterparts could mark a memory confidential; only code calling the store
  directly with a `confidential` meta key could. A memory marked that way is now recalled,
  named, dreamed on, reflected on and written up like any other, in every session: the
  owner's, a Claude Desktop chat, the night run and an observer. If your store had any,
  they are counted once, at the first open after the upgrade, and `counterparts doctor`
  shows one amber line with how many are still there (the ids are in `doctor --json`)
  for as long as any remain, so you can remove any you don't want with
  `counterparts remove <id>`. A store with none shows nothing.
- **A night may count a few more memories as new** on a store that had confidential
  memories, since the dream's queue no longer leaves them out. The recall tool's
  description no longer mentions confidentiality.
- **The dashboard, the sidebar and the console show every memory's words.** A memory
  that carried the old confidential key reads like any other on every page (the card,
  the list, search, Today, traits, the journal and the dreams), in the sidebar, in the
  `remove` list and in `dream`, `night` and `core --list`, where the `[confidential]`
  marker is gone.
- **`export --markdown` carries everything.** Every live memory, earlier wording,
  dream and reflection is in the tree, and the manifest no longer has an "omitted"
  line. `--include-confidential` is still accepted for one release, does nothing, and
  says so in one line; it goes in the release after. Without `--markdown` it is still
  refused by name, as before.
- **Doctor's mechanism census has one row fewer**: the "confidentiality" row is gone,
  with the gate it counted.
- **Every session can close what it finds, from any folder.** A thread or a reminder
  is closed by its id from whichever folder you are in, from any session: Claude Code,
  a Claude Desktop chat, the nightly run's write-ups, and the reflection's `close`. A
  protected memory is still never closed. Until now a session that was not "yours"
  (a Desktop chat, the night run) could not close something written in another folder.
- **"Last said here" in every session.** Any session that opens in a folder gets the
  wake's "Last said here" line and can recall "last exchange", a Desktop chat and the
  night run included. Under observer it is still not given.
- **No more "owner".** `status` no longer reports `owner`, `ownerFrom` or `ownerMeans`;
  doctor's Mode line just says "remembering" (or the observer line). `install` no
  longer writes `"owner": true`; an existing configuration's `owner` is ignored and
  named under doctor's "Old settings" (you may delete it). `COUNTERPARTS_OWNER` does
  nothing now, and the memory server's `--owner` flag is accepted and ignored for one
  release.
- **For code that embeds Counterparts: the confidential leftovers are gone from the
  API.** `confidentialByMeta`, `isConfidential`, `StoredMemory.confidential`,
  `TraitRead.confidential` / `withheld`, the `includeConfidential` option on the trait
  reads and `{ confidential }` on `memoryCountsByScopeSince` / `planCandidates`, the
  `confidential` member of `copiesOf` and `coreList()`, `MemoryRow.confidential` and
  `RecallRow.confidential`, `WriterJournal.omitted`, the `confidential` member of the
  page writer's `omit` predicate, and the verdict and refusal
  names `confidential-withheld`, `handle-confidential-withheld`, `confidential` and
  `other-directory` no longer exist; the dashboard's JSON rows no longer carry a
  `confidential` field (nor the traits view a `withheld` one). Nothing changes on screen. `export --include-confidential` is
  still accepted, and ignored, this release. With the yours/guest split, `OWNER_FALSE_NOTE` is
  gone from `counterparts/mcp` (written at release from #568's diff).
- **The nightly run no longer leaves a Claude Code transcript behind.** Each night child
  (the dream, the reflection, a write-up owed) used to be saved by Claude Code under
  `~/.claude/projects/`, with the memories it read and the conversation it wrote up,
  kept there until Claude Code's own cleanup (30 days by default) and out of reach of
  Counterparts' own retention. It now runs with `--no-session-persistence`, so nothing is
  saved there. Transcripts from earlier nights are not touched; Claude Code's cleanup
  removes them in time, or you can delete the folder named after your memory store.

## 0.3.29 — 2026-10-21

Personal news now travels between your folders: each night the reflection looks at up to 24 memories nobody marked (it was 5), the personal-looking ones first, and marks the ones about you or the two of you so every folder's wake can show them, while work notes stay in the folder they came from; the morning share names what it re-marked and how to have one marked back, and nothing written in a folder you set off or paused is offered or carried out. In the plugin's sidebar the fox goes to work while Claude's turn runs and sits back down when it ends. The self page now keeps which memories each sentence rests on, doctor gains two reading-only lines ("Self page claims" and "Core"), and the dashboard's Self page shows the page in layers across its kept versions. The mechanism counts now include a dream's folds and band rises, so Consolidation and Interference read higher and Reconsolidation lower than before. Most of these are experiments, to be checked in a few days. Update the plugin with this release for the working fox and for sidebar mechanism counts that match the dashboard's; a 0.3.28 plugin keeps working beside this core, with the older counts. No store-format change (store v13, cache v7) and no wiring change: nothing to run after upgrading from 0.3.28, and `counterparts connect` is not needed.

- **A dream's folds count as Consolidation and Interference.** A fold gathers memories that
  belong together into what they add up to; it now counts under both, as a dream's merges do,
  on the dashboard, in `counterparts mechanisms` and in the sidebar. The settles a fold writes
  over its parts count once, as the fold, and no longer under Reconsolidation.
- **"Rose a band" counts.** A memory that moves up a band now counts under Consolidation,
  whichever pass recorded it. Before, the count looked only for a pass that never records a
  crossing, so it was always 0. The crossing into the core is still counted once, as "became
  core".
- **The exact-copy merge is worded for what reaches it**: "exact copy merged into the one
  already held". A repeat in the same folder is turned away when it is written, which leaves no
  row to count. A copy written from a second folder is merged at sleep, and a new test proves
  that happens. Near-copies are still merged only in a dream; merging them at sleep too is
  open.
- **The self page keeps what each claim rests on.** The nightly reflection can now cite memories
  per sentence (`page.claims`) as well as for the whole page. The cites are kept beside the page,
  and the page's words are unchanged. A sentence with no memory behind it is a hypothesis: it
  is shown as one, never removed. An experiment.
- **Two new doctor lines, both readings only.** "Self page claims": how many claims the page
  makes, how many memories it cites and how many of those are live, archived or missing, and how
  many claims have no memory behind them. "Core": how many core elements there are, how many
  have only one episode behind them, and the range of days and contexts their support spans.
  `counterparts core --list` shows each element's returns, derivations and links.
- **The dashboard's Self page shows the page in layers.** It shows how each section read across
  the page's kept versions, and how far back those versions reach. Below that it lists the
  page's hypotheses. It is a view only; nothing is kept longer.
- **Personal news reaches your other folders more often.** The nightly reflection now looks
  at up to 24 unmarked memories a night (it was 5), the ones that look personal first: a
  feeling, someone's name, a weekend or a visit. When it marks one as about you or the two
  of you, every folder's wake can show it. Work notes stay in the folder they were written
  in. The morning share says what it re-marked: up to three by name; past that, two by
  name and the rest as a count, and how to have one marked back. A memory written in a
  folder you set off or paused is never offered, and never carried out of it by a mark.
  An experiment.
- **The `about` field says what the mark does.** On `remember` and `session_end`: mark
  anything personal owner or us, and it reaches every folder. Work belongs to its folder,
  though sessions elsewhere may see its title. Left unmarked, a fact counts as this
  folder's work.
- **The nightly run asks a seat.** For anyone embedding Counterparts: the package entry now
  exports `Seat`, one interface for the model work the memory asks for at night (writing up
  missed sessions, the dream, the reflection), with Claude Code's own night as its first
  implementation. Nothing changes in how the night runs on Claude Code.
- **The sidebar's fox is at work while Claude's turn runs, as an experiment.** Send a prompt
  and he gets up and goes to work: an alert face, with a tail wag, an ear twitch or a glance
  every few seconds. He never lies down or naps mid-turn, and a dream or a saved memory still
  plays and hands back to work. When the turn ends, for any reason, he blinks back to sitting
  and lies down at 45 seconds and naps at 2 minutes, as before. In terminals that draw the
  finer sextant fox, and on the desktop, he redraws about three times as often during a turn.

## 0.3.28 — 2026-10-20

The morning share now closes the open threads that are plainly done, and says which and why; say one isn't done and it is reopened. The session-start wake repeats nothing: each session is named once, and "Today, elsewhere" and a new "Here, also open" say by title what the other open sessions are working on. Saying "done" to a weekly reminder closes just this week; it comes back on its next date. Last night's dream and reflection open by their ids, and `counterparts night` reads them without changing anything. The nightly run keeps the self page within its 4,600-byte room, the reflection answers core memories that have waited a week for keep or retire, and facts list the next twenty matches by title. Most of these are experiments, to be checked in a few days. If you use the plugin, update it with this release: the wake's head is now one tag, and a plugin of 0.3.27 or earlier reads the meeting and the store as unknown until it is updated, so its sidebar footer offers the 5-minute intro again and it skips its store check. No store-format change (store v13, cache v7) and no wiring change: nothing to run after upgrading from 0.3.27, and `counterparts connect` is not needed.

- **The nightly reflection closes open threads that are plainly done, and tells you, as an
  experiment.** When a memory shows a thing finished, it closes the thread itself and the
  morning share names it with why; say it isn't done and it is reopened, and then only
  ever asked about. Threads it is unsure of, and private ones, are still asked about, as
  before.
- **Last night opens by its id.** Recall now reads a dream's id (`drm_…`) or a
  reflection's (`rfl_…`) — the ids the morning wake and the share name — as a short,
  read-only summary: what the dream did, the memories it touched and its gists; the
  reflection's entry, its share and whether it was told, what it cited, and any closes.
  Opening one changes nothing. A night that rests on a confidential memory is withheld from
  a session that isn't yours, and says so.
- **`counterparts night` reads the nights and changes nothing.** The recent dreams and
  reflections, `last`, `last-reflection`, or one by id — the same lines as `dream --show`,
  from a command with no undo, so a session can run it with you. Undo stays on
  `counterparts dream`.
- **A weekly reminder can be marked done for this week.** Saying a repeating reminder was done
  (a memory that updates it with `status: "done"`) closes just this time: it stops coming up
  today, the reminder keeps its date and repeat, and it comes back on its next date. The answer
  says which day was closed and when it returns. Dropping the date (`eventDate: null`) still
  ends the repeat.
- **A "done" note written on its own points at the reminder it answers.** When a memory saying
  something was done (or that you said it) lands next to a reminder due now, the answer names
  the reminder and how to close it.
- **A memory a session just replaced still counts as drawn on.** Naming in `drewOn` a memory the
  same session had just updated with a newer one (or one replaced that day) no longer refuses it.
  One put away by a correction is still refused.
- **The session-start wake names each session once.** The Yesterday line leaves the newest
  chapter written in this folder to "Last here", and "Last here"'s "Before it" and "+N more
  here" lines, and the chapter-about-me line, leave out what Yesterday already names. A
  Yesterday chapter with no room for its title is counted ("and 3 more"), never printed as a
  bare id.
- **One tag at the top of the wake.** The meeting's state and the store's id are now fields of
  the wake's own opening comment (`<!-- counterparts:wake meet=done store=st_… elements=…
  bytes=… -->`), or of one `<!-- counterparts:session … -->` tag when there is no wake to
  carry them. The sidebar reads both forms. An older sidebar (plugin 0.3.27 or before) reads
  them as unknown until the plugin is updated: it skips its store check and keeps the
  "5-minute intro" line in its footer.
- **The chapter-about-me line says where it is from first**: "A chapter about me from
  ~/site: session …, Oct 19 — "…" (epi_…)."
- **"Coming up" at a session start lists what is due today.** A plain reminder due tomorrow is
  counted with the other dates, as the evening's bundle still lists it for the next morning.
  Every "Coming up" item now carries its own id, beside any "(earlier: …)" pointer.
- **One backup a day, even when two background runs start at once.** The daily snapshot
  claims the day before it copies, so two runs at one boundary no longer leave two copies.
- **The nightly page writer and reflection keep your self page within its 4,600-byte room,
  as an experiment.** The night's first page past the room is sent back to be cut, with how
  many bytes over, rather than kept with a short version. A second try is kept, and a page
  that was never sent again is kept when the night ends, so a night's rewrite is never lost.
  A page past the room that has a short version now shows the short version in the wake, so
  the lists beside it keep their room. Pages you or a session write are not held.
- **A core memory that has waited a week for "keep or retire" gets answered, as an
  experiment.** The nightly reflection is offered up to three that have waited 7 lived
  days, decides the ones it can with a reason, and the morning share says which, in one
  line. Say one was wrong and it is undone: a memory a reflection retired comes back into
  the core with a keep (`counterparts core --reaffirm <id> --reason "..."`, or just say
  so in a session). Agree with one instead (`counterparts core --demote <id>`) and it
  is recorded as your retire, which no session can undo; your own `--reaffirm` still
  can. The wake's "Still open" leads with a week-old one, and still says
  "keep or retire it" when the memory is also unsettled. Doctor's Reflection line counts
  the ones waiting.
- **Asking for facts also lists the next matches by title.** After the ten results, the next
  twenty are listed one line each (title, id and date), so a memory ranked a little lower is in
  sight and can be opened by its id without asking for page 2. Being listed doesn't strengthen
  a memory; opening it does.
- **"Lately" and "recently" no longer hide older facts.** A facts question with "lately",
  "recently", "these days" or "nowadays" ranks the past week's matches first instead of keeping
  only those, and says so. "What happened lately?" on its own still means the past week, and
  "last week" or "in September" still keep only that time.
- **The sidebar's fox stays up while Claude is working, as an experiment.** Any tool call,
  including one waiting on a permission prompt, starts his idle clock over, so he no longer
  lies down or naps in the middle of a long call; he lies down at 45 seconds and naps at 2
  minutes after the last activity, as before. A memory saved from a session shows his
  notepad once.
- **"Today, elsewhere" and "Since you started" say what the other sessions are working on.**
  Beside each folder's memory count they name up to two of its memories by title and id,
  work in progress first ("planned" or "done" marks, then work memories), newest first:
  `~/random open since 08:33 (live), 8 memories: "Wake check 10-20" (mem_…), "Spans out of
  backups" (mem_…)`. Other sessions open in the same folder get a clause of their own:
  `Here, also open: session 25e12e7d on Fable 5 since 10:05: "…" (mem_…)`. Never from a
  folder that is off, paused or observed, never a confidential memory, a dated one, one about
  you, about the two of you or about your counterpart itself, or small talk. "Since you
  started" names only what was written since it last told you. Both lines stay within their
  old size.

## 0.3.27 — 2026-10-19

Recall learns from use, and finds "baking" when you say "bake". The memories a session rates useful, draws on or opens count as used, memories found useful together get linked, and one rated noise twice comes up less for a while; what the conversation has been about, and what is open in its folder, gives related memories a head start. Recall matches word forms and counts everyday words for less, a session's first prompt is matched by meaning too, footnotes skip what this session wrote, and a newer memory stands in for the one it replaced. Most of these are experiments, to be checked in a few days. `counterparts doctor` gains a Feedback loop line. No store migration (store v13) and no wiring change, so `counterparts connect` is not needed; the word index re-indexes itself once in the background (cache v6 to v7, under a second on a typical store). Going back to 0.3.26 is not a plain reinstall: its memory tools refuse the newer cache, and its hooks miss word matches without saying so. To go back, delete `~/.counterparts/store/cache/cache.sqlite*`, then run `counterparts verify --rebuild --keep-vectors --dir ~/.counterparts/store` on 0.3.26 (recall by meaning comes back over the next few sessions, as the background worker re-reads the memories); `counterparts rollback` does not cover a cache change.

- **Recall by meaning works on a session's first prompt.** Until now the first prompt of a
  session, and any prompt whose background cue from the turn before wasn't ready, was
  matched by words only. Those prompts are now matched by meaning too, computed on the spot
  with the same local table. It adds a few tens of milliseconds on a typical store.
- **Asking for facts ignores "how many" and "how often" wording.** Words like "many",
  "much", "often", "typical" and "usually" no longer count as part of what the question is
  about, so they stop pulling in memories that merely contain them.
- **Footnotes no longer repeat what this session just wrote (an experiment).** A memory
  written in the current conversation is already in front of the model, so it no longer
  comes back as a footnote or a "came to mind" line there. After the conversation is
  compacted, what it wrote before the compaction can come back again. Asking for a memory on
  purpose still finds it.
- **The nightly dream replays what the day used (an experiment).** Memories the day opened,
  quoted, drew on or rated useful are handed to the night's dream, even ones it already
  dreamed over, with the ones that changed what was said first, and pairs used together
  listed for it to link.
- **The nightly run's own sessions get no footnotes (an experiment).** The background
  sessions that dream and reflect overnight are no longer handed memories at their first
  prompt; they read what they need on purpose.
- **Rating what you were shown now counts, as an experiment.** When a session rates the
  memories it was shown at the end, a 3 counts as a full use of the memory, a 2 most of one,
  a 1 a little, and a footnote left unrated a glimpse; a 0 counts nothing. Used memories fade
  more slowly, as before. This is deliberately strong so its effect can be seen, and will be
  tuned after a few days.
- **A memory a session says it drew on counts as a full use, as an experiment.** Naming it
  in `drewOn` now counts like opening it (it was half a use); still once a day, at most three
  per boundary.
- **Memories found useful together get linked strongly.** Two memories rated useful (or
  opened, quoted or drawn on) since the session last rated are linked strongly enough that
  the second time it happens, one can bring the other to mind as a quiet pointer. Memories
  shown on the same turn get a faint link, unless one was rated noise.
- **A memory rated noise twice comes up less for a while.** Rated 0 in two sessions within
  a week, it needs a closer match to show as a footnote. It recovers when those ratings are
  a week old, or at once when a later session rates it useful.
- **`counterparts doctor` has a Feedback loop line** with what the ratings credited by
  score, the pairs they linked, the links now strong enough to show as pointers, and how
  many memories are holding back as noise.
- **An earlier version of a memory no longer shows without the one that replaced it.** When
  a turn's words lean towards a memory that a newer one has settled over, the newer one now
  shows in its place (labelled with the earlier one), where before the earlier one could
  slip through on its own as a quiet footnote. If the newer one doesn't clear the bar, the
  earlier one stays out too. If the newer one was written in this same
  session, neither is shown, since it's already in the conversation. This is a trial, to be
  checked in a few days.
- **A new memory is no longer linked to what was shown when it was written, as an
  experiment.** These faint links were almost never confirmed by use and mostly noise, and
  memories found useful together are now linked by ratings instead. Links between memories
  written one after another stay, and the links already made fade on their own.
- **A memory that looks like an older one's update no longer fades the older one right away,
  as an experiment.** It is still marked "may be out of date" and the nightly dream is asked
  to confirm it; only a confirmation fades it. The guess was wrong too often to cost the
  older memory anything before then.
- **Recall matches word forms and quiets everyday words (an experiment).** A prompt that
  says "bake" now finds a memory that says "baking" or "baked", and words like "any",
  "what" or "you" count for much less when deciding what a prompt is about. This applies to
  recall as you work and to asking for facts. The first time the background worker runs
  after the update it re-indexes the words of your memories (under a second on a typical
  store); until then recall matches both the old and the new word forms.
- **Recall follows the conversation's train of thought (an experiment).** What a
  conversation has been about, what it opened, rated useful or wrote, and what was left
  open in its folder now give related memories a head start, so they win close calls they
  used to lose. Only memories the current message already touches can get one, a memory
  the conversation wrote itself is still never handed back, and the head start fades
  within a few messages once the topic moves on. A conversation's first message, with
  nothing open in its folder, is recalled exactly as before.

## 0.3.26 — 2026-10-18

The wake leads with what is live. "Still open" puts the questions touched in the last two weeks first and counts how many of the rest have gone untouched; a stale handoff says how stale it is in one sentence, and when every handoff listed is stale only the newest shows whole; the Yesterday line names the other folders worked in instead of counting them; and a session still open from an earlier day says its start with the date. Doctor reads mood matching, switched off since 10-10, as disabled rather than amber. No store-format change (store v13, cache v6) and no wiring change: nothing to run after upgrading from 0.3.25, and `counterparts connect` is not needed.

- **"Still open" shows what is live first.** Open questions touched in the last two weeks come
  before the ones nobody has touched since, a plain one before one that may be out of date,
  and the count says how many of the rest are weeks old.
- **A handoff says how stale it is in one sentence.** "2 days old; since then: a newer
  chapter here; written on 0.3.24, 0.3.25 now". When every handoff in a folder is stale, the
  wake shows the newest and lists the others by id.
- **The Yesterday line names the other folders worked in**, rather than counting "sessions in
  other projects", and only the folders the "Today, elsewhere" line may name.
- **"Today, elsewhere" dates a session that started on an earlier day.** A session opened
  the day before and still live read `open since 09:08 (live)`, a clock that looked like a
  time later today; it now reads `open since 10-16 09:08 (live)`.
- **Doctor's Fired line reads mood matching as `disabled`** while both mood weights are 0
  (stood down by decision since 10-10), instead of amber "gone quiet". Turning the weights
  back up restores the ordinary grading.
- **Facts: a coarse event date only partly inside the time asked says so.** A month, year
  or range that straddles the window reads `happened 2023-04 · may be inside the time
  asked`, where a bare month beside a day window read as outside it. Held lightly.

## 0.3.25 — 2026-10-16

A chapter of the journal is now stood for by one short summary memory instead of a full copy: the `chapter` tool takes a `summary`, the engine writes a short one from the chapter's opening lines when the session gives none, and summaries fade like any other memory while the chapter itself keeps every word. The nightly reflection can propose closing items that have sat in "Still open" for days, and nothing closes until you say yes. The wake is shorter and lists more: long items as one line each, the tags on one line, today's date said once, "Coming up" only what is due today, and the self page written to about 4,600 bytes. Recall reads "in the last month" and "the past 3 months" as rolling windows, and facts' event dates carry their weekday. The plugin's sidebar says where you left off, can be clicked again in a few small ways, and the build from Anthropic's directory stands down beside the npm install. No store-format change (store v13, cache v6) and no wiring change: nothing to run after upgrading from 0.3.24, and `counterparts connect` is not needed.

- **The sidebar's fox tries a picture first, everywhere.** Instead of guessing from your
  terminal's name whether it can show pictures, it tries one and lets Claude Code say: where
  the picture can't show, it draws the finer sextant fox in terminals whose fonts have them
  (iTerm2, WezTerm, VS Code, Ghostty, kitty) and the half-block fox elsewhere. It reads four
  environment variables for that, down from seven.
- **The sidebar keeps its numbers beside an npm install when the plugin is loaded from a
  folder.** A plugin started with `claude --plugin-dir` stands its own server down there, and
  until now nothing told the npm install's processes the sidebar was present, so they deleted
  its status file. The stood-down server now leaves a small marker beside the configuration
  while its session runs (`sidebar-plugin-here`, refreshed every ten minutes, counted for
  thirty, or for up to a day while that server is still running, so a laptop waking from sleep
  keeps the file), and the memory server asks again at each write instead of once at its start.
- **After a rollback or a snapshot restore the sidebar catches up straight away.** A status
  file written before the store was put back named a later point in the log than the log now
  has, and both the writers and the sidebar kept it until the log caught up. A writer now
  replaces a file that is ahead of the log, and the sidebar accepts an older point in the log
  from the same store when the file is more than five seconds newer.
- **The store's note of where the sidebar file lives no longer disappears every week.** It is
  touched on every write, so the session-start cleanup keeps it.
- **The plugin from Anthropic's directory stands down beside the npm install.** It reads none
  of Claude Code's files, so it couldn't tell the npm install was there, and Claude was
  offered every memory tool twice. The npm install now leaves a small note beside its
  configuration, `~/.counterparts/npm-live.json`, when it connects and as its sessions
  start; the plugin's hooks and server stand down while the note is recent and the program
  it names is still installed. `counterparts disconnect` and
  `uninstall` remove it.
- **Installed twice now recommends keeping one.** The session-start line, the stood-down
  server's note and `counterparts doctor` no longer say "nothing needs to change": both use
  the same memory, so nothing is lost either way, and they name both ways out, `counterparts
  disconnect` (keep the plugin) or `/plugin uninstall counterparts@…` (keep the npm install).
- **The sidebar says where you left off.** Under the last dream, the sidebar shows the first
  of these that has something: where you left off in this folder ("Last here"), what's
  coming up next (with its date as "Today", "Tomorrow" or "Oct 20"), or what happened
  yesterday. Click it to read all of it, as with the dream. It's the first thing to make room when the session fills the sidebar.
- **The sidebar's footer stops offering the intro once you've had it,** and while the fox
  shows it says how to hide it: `/counterparts avatar off`.
- **The "Mechanisms today" bars are on a log scale,** so a mechanism that fired once and one
  that fired a dozen times look different even beside one that fired a hundred times. The
  count beside each bar is unchanged.
- **The plugin's README says what the sidebar can reach.** A "What it can reach" section
  lists what it reads (the nine environment variables among them), runs, sends and keeps,
  how it treats text other hooks add, and the `claude plugin validate` lines that show it.
- **A chapter is stood for by a summary, not a full copy.** The `chapter` tool takes a
  `summary`: the memory that stands for the chapter, while the chapter keeps every word. When
  a session gives none, the engine writes a short one from the chapter's opening lines, and a
  summary the session writes later replaces it. Summaries are ordinary memories and fade like
  one; the full copies made before this release stay as they are. Dreams and reflections see a
  busy day's chapters as their summaries, so more of the day fits. Doctor has a `Chapter
  summaries` line: written vs automatic over the week. No store-format change.
- **The nightly reflection proposes closing stale open items.** It is shown up to five
  memories still open after four lived days untouched, and may propose closing the ones that
  look done; the proposal comes as one question in what it shares. Nothing closes until you
  say yes, and then the reflect tool's new `close` phase closes only what it proposed.
- **The wake lists more of what's open, coming up and relevant.** A long memory in "How I
  work", "Still open", "Might be relevant" or "Coming up" now shows as one line, its date,
  its title and its id, instead of its whole first paragraph, so many more fit beside the
  self page. The first item of "Still open" and of "Coming up" is still shown in full when
  there's room, and so is a reminder due today. Recall reads any of them in full by its id.
- **Doctor's Lookups line counts the wake too:** how many of the items it listed as a line a
  session then read in full.
- **The plugin's sidebar can be clicked again, in a few small ways.** In the terminal,
  "Meet your counterpart" sits at the top while the first meeting is waiting: a click puts `/counterparts:meet` in your
  prompt box, and you press Enter (a draft you are writing is left alone, and the row says so).
  The footer's Dashboard line does the same with `/counterparts:dashboard`. On the terminal,
  COUNTERPARTS ↗ links to the dashboard again; Counterparts now writes the dashboard's address
  into the sidebar's status file for it. The footer's view and avatar switches are back: one
  click closes the pane to quiet, or turns the fox on or off. The plugin directory's build of
  the sidebar is unchanged.
- **Recall reads "in the last month" as a rolling month.** "In the last month", "the past
  month" and "the past 3 months" (digits or words) now mean back from today, like "the past
  week"; plain "last month" is still the calendar month. Facts' event dates carry their
  weekday ("happened Mon 05-15").
- **A shorter, roomier wake.** The three tags at the top of a session's memory share one line;
  today's date is said once, on the `Now:` line (the header, "Yesterday" and the page's
  "Last revised" no longer repeat it, and item dates read "Oct 15 (due Oct 18)"); the header
  and the line under it are shorter. "How I work" no longer lists craft memories (they still
  come up when a conversation reaches them), and "Coming up" lists what is due today,
  with one line counting the rest by id (the overdue said so). The self page is now written to about
  4,600 bytes, with "How I work" as a few short lessons. The room goes to the lists.

## 0.3.24 — 2026-10-14

Forgetting now waits: a memory is put away only after 14 lived days under the floor, not 14 days after it was last used, and a release that changes how strength is read starts that wait fresh for everything it lowered. So nothing is archived for the first 14 lived days after you upgrade to this release; archived memories keep their words and stay readable by id. Old claims the claims era lowers now read at today's default all the way down. At the end-of-session ask Claude now also rates the memories it was shown, 0 to 3; the ratings are only recorded and change nothing yet. The `salience` field tells Claude to leave routine work at the default, a faded match is labelled "faded: weak, below reach", closing a reminder closes every memory it moved through, a revision with no title keeps the old one's, and `recall` takes `query` as another name for `question`. With both the plugin and the npm install, uninstalling the plugin and keeping the memories leaves the npm install's memory server and hooks working. The sidebar counts feelings under Emotion. If `/plugin update counterparts@counterparts` does nothing, run `/plugin marketplace update counterparts`, then `/plugin uninstall counterparts@counterparts` and `/plugin install counterparts@counterparts`. These are Claude Code's own plugin commands, not `/counterparts:uninstall`, and your memories in `~/.counterparts` are untouched. No store-format change (store v13, cache v6) and no wiring change: nothing to run after upgrading from 0.3.23, and `counterparts connect` is not needed. Going back to 0.3.23 gives up the wait: it counts 14 days from last use again.

- **A memory leaves only after 14 lived days under the floor.** The floor prune used to count
  its 14 days from a memory's last use, so a memory unused for weeks was archived the first
  night it faded under the floor. Now it waits 14 lived days under the floor first, and a
  build that changes how strength is read never archives anything the night it arrives: the
  wait for everything it lowered starts that night, so a store archives nothing for its
  first 14 lived days on this release, whichever release it upgraded from. Archived memories
  still keep their words and stay readable by id.
- **Old claims now read at today's default all the way down.** A memory written before the
  claims era whose claim the era lowers now reads at that default as a whole, instead of being
  held up by the relevance and predictive scores written alongside the old claim; a quarter
  of the lowered memories were not lowered at all before. Memories the era raises, and the
  ones it leaves alone (the core, the owner's own, protected, a pending or repeating date),
  read as before. No store-format change.
- **Claude now scores the memories it was shown.** At the end-of-session ask, Claude rates
  each footnote it was shown since it last wrote, and every memory it says it drew on, from
  0 (noise) to 3 (changed what it did or said). The scores are only recorded: they change
  nothing about any memory yet. `counterparts probe-oq4` prints them by day and by kind of
  showing, beside what the replies actually used.
- **Routine work is left at the default salience.** The `salience` field on `remember` and
  `session_end` now tells Claude to leave it unset for a routine work event or an ordinary
  work fact unless it changed something, and to claim 0.4 or more only for what struck it
  or changed how it will work, so weak work memories fade on their own. The owner's
  rulings and corrections still stay high.
- **A faded match is labelled "faded: weak, below reach".** Asking for facts used to label
  it "not used for a long while", which was false for a memory two days old that simply
  started weak. The dashboard's search says the same. Ranking is unchanged.
- **Closing a reminder closes all of it.** When a memory says a dated thing is done (its
  date dropped, or `status: done`), every earlier or later memory the same reminder moved
  through loses its date too, so one "done" stops it coming back. Other memories nearby
  that still hold a date are listed in the reply, by id and title, so Claude can close
  them in the same step if they are the same thing; they are never closed for it.
- **A revision keeps its title.** A memory that revises another (`updates`) and has no title
  of its own now takes the old one's, as it already took what it was about, who said it,
  its status and its date. When it closes something (a dated thing done, or any
  `status: done`), the old title would read as still open, so none is carried and the
  reply asks for a title. A confidential memory's title is never carried.
- **`recall` takes `query` as another name for `question`.** A recall sent with `query`
  used to be refused for having no question; it is now answered as one. A mode is still
  required.
- **Uninstalling the plugin no longer takes the npm install's memory server with it.** With
  both installed, the plugin's uninstall (keeping the memories) ran `claude mcp remove
  counterparts -s user`, which removed the server the npm install registered. The plugin
  never registers one there, so it now leaves it alone and says so; `counterparts
  uninstall` still removes its own.
- **Uninstalling the plugin leaves a working npm install's hooks alone too, and cleans up
  after one that is gone.** With both installed, the plugin's uninstall (keeping the
  memories) took the npm install's wake and recall hooks out of `~/.claude/settings.json`.
  It now removes a Counterparts hook or memory server only when the program it runs is no
  longer there, which is what an npm install removed without `counterparts uninstall`
  leaves behind. Run at a terminal, the plugin's uninstall now asks whether to delete the
  memories before it removes anything of the npm install's, so answering no leaves that
  install working. A hook line written as `~/…counterparts-hook`
  or `$HOME/…` now reads as live, here and in doctor and the plugin's stand-down, as the
  shell that runs it would read it.
- **The sidebar counts feelings under Emotion.** "Mechanisms today" showed Emotion at 0
  every day, because its only proof was a mood match, and mood matching is off. It now
  counts a memory saved with a feeling and a memory carrying a feeling that came to mind,
  and opening Emotion lists those memories with their feeling words. The dashboard's
  Emotion light reads the same proofs. `sidebar.json` gains a `felt` detail on those rows
  (its version stays 1).
- The sidebar's footer says "Dash · /counterparts:dashboard", which fits the docked pane
  on one line.

## 0.3.23 — 2026-10-14

The plugin's sidebar now shows your memory and does nothing else: it has no buttons and no links, runs no command, calls no tool and makes no network request. Its footer says how to do the rest yourself (`/counterparts:meet`, `/counterparts:dashboard`, say "pause memory here", `/counterparts quiet`). What it shows comes from a small file Counterparts writes for it, `~/.counterparts/sidebar.json`, only while the plugin is installed, so the dashboard no longer has to be running for the sidebar to show anything. The sidebar's brain is gone and the fox stays. The plugin directory's build of the plugin no longer reads Claude Code's user configuration file and leaves out the dashboard's 3D brain; beside an npm install it does not stand down, so keep one or the other. No store-format change (store v13, cache v6) and no wiring change: nothing to run after upgrading from 0.3.22, and `counterparts connect` is not needed.

- **The sidebar shows memory and no longer acts.** It has no buttons: the "Start the
  5-minute intro" row, the desktop's dashboard buttons, the folder switch (on, paused, off)
  and its confirm, and the view and avatar switches are gone. Its footer says how instead:
  `/counterparts:meet` for the intro, `/counterparts:dashboard` for the dashboard, say
  "pause memory here" to Claude to pause a folder, `/counterparts quiet` to hide it. A
  paused folder still says so, with how to resume; `/counterparts resume` now says how
  rather than resuming. COUNTERPARTS and a long memory's `more` are plain words, not links.
- **The sidebar makes no network request.** It used to ask the dashboard on 127.0.0.1;
  now Counterparts' own background processes (the one after each reply, and the memory
  server) write `~/.counterparts/sidebar.json` (mode 0600, beside `claude-code.json`) and
  the sidebar reads it every 15 to 30 seconds while it is open. The file holds the day and
  the count, today's counts, the last dream, recent activity and the memories it names
  (title and the first 800 characters; a confidential memory's text is withheld). It is
  written only while the plugin is installed; an npm-only install never writes it, and
  once the plugin is gone the next Counterparts process deletes it. A surfaced memory's
  title can take up to about 30 seconds to appear. `COUNTERPARTS_DASHBOARD_PORT` no longer
  matters to the sidebar.
- **The sidebar's brain is gone; the fox stays.** `/counterparts avatar` takes `animal` or
  `off`; a brain chosen before shows the fox. `/counterparts fps` is gone with it.
- **The directory build never reads `~/.claude.json`.** The plugin as built for
  Anthropic's directory does not open Claude Code's user configuration file. The cost: it
  can't see an npm install's memory server there, so beside a wired npm install it doesn't
  stand down; both run on the same memory and Claude is offered the memory tools twice.
  Keep one: `counterparts disconnect` and a restart keep only the plugin, uninstalling the
  plugin keeps only the npm install. The npm install's doctor tells the two plugin builds
  apart and says this. The marketplace's plugin (the full build) is unchanged and still
  stands down.
- **The directory build leaves out the dashboard's 3D brain** (and three.js); its home
  page draws without the picture. No file in that build is over 256 KiB.
- **Uninstalling the directory build with no `claude` on PATH keeps your memory.** It
  can't confirm the memory server registration is gone, so it stops before deleting or
  moving the store, and prints the `claude mcp remove` line to run.
- The dashboard's icon is now a file of its own (same address, same picture).

## 0.3.22 — 2026-10-14

The sidebar is ready for Anthropic's plugin directory, and the plugin now installs from a repository of its own. In the sidebar the search box is gone, COUNTERPARTS and a memory's `more` are links to the dashboard in a terminal and buttons in the desktop app, and the sidebar no longer runs a command to open a browser; `counterparts dashboard` opens the dashboard already running for your memory instead of failing on its port. The plugin's marketplace entry now names `counterparts-ai/counterparts-plugin`, a generated folder that holds only the plugin, so an install clones a few hundred files instead of the whole development repository; if you added the marketplace before, run `/plugin marketplace update counterparts` first, and your memory and the plugin's data folder stay where they are. Also: the memory tools tell a host which of them only read and which can take something away, and the context a session starts with offers the first meeting and its other steps instead of ordering them. No store-format change (store v13, cache v6) and no wiring change: nothing to run after upgrading from 0.3.21, and `counterparts connect` is not needed.

- **The plugin installs from its own repository.** The marketplace entry now names
  `https://github.com/counterparts-ai/counterparts-plugin.git` at the release tag: the
  plugin alone, generated from this repository at each release, without its tests, docs
  and development tools. The marketplace keeps its name, so the plugin's data folder and
  your memory are unchanged. If you added the marketplace before, run
  `/plugin marketplace update counterparts` first.
- **The memory tools now say what they do to a host.** Each one carries MCP's tool annotations: a
  short title, and whether it only reads (`status`), writes, or can take something away (`dream`,
  whose undo removes a dream's links and gists). A host can show these beside a tool or ask before
  a call.
- **Session context offers rather than orders.** The first-meeting line now offers the
  meeting to the person and describes the `meet` tool as where the script lives; the
  morning share and the contradiction note describe the `told` and `settle` steps instead
  of ordering a tool call nobody asked for.
- **The sidebar is ready for Anthropic's plugin directory.** The search box (hidden since
  0.3.20) is gone. In a terminal, COUNTERPARTS and a memory's `more` are now ordinary links
  to the dashboard, opened by your terminal (on some terminals with a ⌘- or Ctrl-click); in
  the desktop app they are buttons that run `/counterparts:dashboard`. The sidebar no
  longer runs a command to open a browser. The fox's pictures load from the plugin's own
  image files.
- **`counterparts dashboard` opens the dashboard that is already running** for your memory,
  instead of failing because its port is taken. A dashboard for another memory on that
  port still fails, and says so.

## 0.3.21 — 2026-10-13

Your conversation text is kept for less time, and never in a backup. The text of a conversation is now deleted 3 days after it has been written up and the session has ended (it was 7), and it is never kept more than 14 days after the session's last activity, written up or not; both numbers can be changed with `"retention": {"afterWriteUpDays": 3, "maxDays": 14}` in `claude-code.json`. The first time the new version runs on an existing memory, everything older than those limits is deleted in one go, so if you want to keep more, add the `retention` setting before your first session on 0.3.21. Daily backups stop copying conversation text; backups made before this update still hold it until they rotate out, or until you run `counterparts delete backups`. New `counterparts delete conversation-text`, `delete backups` and `delete activity-log` (and "Delete data…" on the dashboard's Memories page) each delete one kind of data after showing what they would delete. The few words recall carries from your last message are cleared once a session has been quiet past the same 14-day limit. Also: the plugin installs over HTTPS without a GitHub SSH key (run `/plugin marketplace update counterparts` first if you added the marketplace before), "installed twice" is said once, the first meeting says where the sidebar appears, and the sidebar's fox and its look in the Claude Desktop app are polished (the Desktop shows the fox, not the brain, this version). No store-format change (store v13, cache v6) and no wiring change: nothing to run after upgrading from 0.3.20, and `counterparts connect` is not needed.

- **The plugin installs without a GitHub SSH key.** On a computer with no SSH key that
  GitHub accepts, `/plugin install counterparts@counterparts` failed with "Permission denied
  (publickey)", even though adding the marketplace had worked. The marketplace now names the
  repository by its `https://` address, which needs no key. If you added the marketplace
  before, run `/plugin marketplace update counterparts` first, then install again.
- **"Installed twice" is said once.** With both the npm install and the plugin, the plugin
  stands down and said so at the start of every session, which read like an error. It now
  says it at the first session that finds both, then stays quiet; `counterparts doctor`
  still shows it. Nothing about how the two share the memory has changed.
- **Conversation text is kept for less time, and never in a backup.** The text of your
  conversations is deleted 3 days after it is written up and the session has ended (it
  was 7), and is never kept more than 14 days after the session's last activity, written
  up or not. Both can be changed in `claude-code.json`:
  `"retention": {"afterWriteUpDays": 3, "maxDays": 14}`. Daily backups no longer copy it
  at all, so restoring one loses whatever was not yet written up. Backups made before
  this update still hold it until they rotate out, or until you delete them.
- **Delete one kind of data at a time.** `counterparts delete conversation-text`,
  `delete backups` and `delete activity-log` each delete that one kind and nothing else.
  Each shows what it would delete first (for conversation text, how many sessions were
  still waiting to be written up and would be lost) and asks once; `--yes` skips the
  question for a script. The dashboard's Memories page has the same three under
  "Delete data…".
- **The first meeting says where the sidebar is.** In the plugin, the end of the first
  meeting now says the memory sidebar appears on the right once the window is wide
  enough.
- **The sidebar's fox is a little more alive, and calmer about it.** He does small things
  more often (a blink, a flick of his tail tip, an ear twitch, a glance), and flicks his tail
  within a few seconds of the sidebar opening. When something comes to mind he perks up,
  curious, with one ear raised. Left alone, he lies down after 45 seconds and naps after two
  minutes; anything you do gets him up. His small moves no longer make his whole body
  flicker, in the desktop app and in Ghostty or kitty. In iTerm, WezTerm and VS Code he
  now has his intended colours (a warmer orange, a cream chest), and his notepad shows.
- **A clearer hint when the window is too narrow for the sidebar.** The line under the
  prompt now says to widen the window, instead of naming a command that can't open it there.
- **Your words from a session's last turn no longer stay in the database.** Recall keeps a
  few words from your previous message to help with the next one. A session that ended,
  or was closed abruptly, kept its last few words indefinitely. Now they are cleared once
  the session has been quiet for the retention limit (14 days unless you changed it),
  including for sessions from before this update. Backups taken from then on don't
  contain them either.
- **The sidebar looks right in the Claude Desktop app.** It now uses the app's own colours (light or
  dark), has no lines of dashes, wraps its text to the app's font, leaves a blank row between
  items, and draws the "Mechanisms today" bars at a readable size. The fox no longer shows a dark
  edge on the light page and fits a narrower pane.
- **The memory count sits on the sidebar's title row, beside the day** ("1511 memories · day 22",
  shortened when the pane is narrow), in every app, and the search row appears only when search is
  switched on.
- **The sidebar's "quietly available" titles read cleanly.** "Earlier (now [id]): ..." shows as
  "Earlier: ...", "Unsettled - may be out of date, see [id]: ..." as "Unsettled: ...", "Corrected by
  [id]: ..." as "Corrected: ...", and the trailing "(earlier: [id])" and "(corrects [id])" are left
  off; a click on one opens that memory, not the one its note points at.
- **In the Desktop app the avatar is the fox or nothing.** The brain doesn't draw there yet, so the
  avatar row offers animal and off, and a brain chosen in the terminal shows the fox on the Desktop. The
  terminal keeps its brain.
- **Pressing the Counterparts switch in auto mode no longer shows an engine error.** When auto mode
  declines the press, a short note says so and tells you what to ask Claude instead ("pause
  Counterparts here"); the switch stays as it was.

## 0.3.20 — 2026-10-12

New installs from the plugin now remember from the second day. (Plugin first runs and scripted `install --yes` had never set a size limit for the wake, so every session opened on "No briefing has been composed yet"; earlier plugin installs had the same gap, and they are fixed automatically, with no action and no change to your configuration file; the first session after upgrading may still open on that line, and the wake is composed when that session ends.) The first meeting is the heart of this release. A new install now opens with a short, easy conversation where Claude introduces itself, asks one question at a time (all fine to pass), writes up what it learned right there, and ends with "What would you like to work on today?". Nothing interrupts it: no dream starts and the end-of-turn write-up waits, so the first dream comes the next day. Everyday words replace the internal ones: session starts say "Coming up:" and "Might be relevant:", dates read "Oct 11", and the dashboard uses the same words. A brand-new install's first `counterparts doctor` shows no ambers, a plugin install gets a one-line welcome, and the README is honest about what recall by meaning can and cannot find. The sidebar gains onboarding, a small fox, a second theme and the dashboard's store id; its Claude Code memory switch is gone, and the dead read of an A/B file in the home directory is removed. Reminders are no longer spent on a compaction nobody reads, and the wake never drops a section without saying so. No store-format change (store v13, cache v6) and no wiring change: nothing to run after upgrading from 0.3.19, and `counterparts connect` is not needed.

- **The sidebar's first-meeting prompt reads like a sentence.** The line Claude Code shows when the plugin asks Claude to say hello is now "Counterparts is installed. Claude would like to introduce itself."
- **The sidebar's quiet line reads as one phrase.** A fresh save shows as `Stored "title" — ` and as much of what was written as the width allows, cut at a word, instead of `stored: ` before a title that has its own prefix.
- **On the classic screen the sidebar's line suggests `/tui fullscreen`.** Where the pane cannot dock, the dim line under the prompt now says that `/tui fullscreen` shows the memory sidebar; nothing about the setting is changed for you.
- **The first meeting is no longer interrupted.** While you and Claude are getting to know each other, no dream starts and the end-of-turn write-up waits. When the meeting finishes, Claude writes it up right there and tells you in a few lines what it will remember. The first dream comes on your next day, not the first one.
- **The opening asks once.** Claude introduces itself in one line and asks whether you have five minutes in the question dialog only, not in the text as well.
- **Easier questions.** The meeting now asks about the highlight of your week, what you're enjoying working on, what you love about what you do, a good Saturday, and what got you started. One question at a time, at most one follow-up, and "pass" is always fine. It never asks your pronouns. Until you say them, Claude writes about you by name or as "they", in memories, chapters and dreams.
- **The meeting ends with what to do next.** It ends with "What would you like to work on today?" rather than a list of facts. Where your memory lives, what is kept and how to uninstall are given word for word when you ask.
- **Plugin installs are told what to say, not what to type.** The first-run line says to say "no dreams" and no longer gives a `counterparts` command. A dream's summary now says to say "undo that dream", and Claude can undo it through its own tools.
- **The README and the plugin's page say what recall by meaning can and can't find.** The
  small on-device model finds close paraphrases ("my doctor" finds a note about a
  physician), but not a description that never names the thing ("a pet that purrs" for a
  note about your cat). Exact words are strongest, and a short memory matches better than
  one padded with names and details.
- **A brand-new install's first `counterparts doctor` no longer goes amber while the first night run is still working.** On the first day your memory lives past midnight, the Sweep, Sleep, Backfill and Snapshots lines now say in green that the first night run starts today and writes them when it finishes; they turn amber only once a whole earlier day has passed with nothing written.
- **A reminder isn't spent on a session nobody reads.** When Claude compacts a long conversation (or a subagent compacts its own), a reminder due today is no longer said there and marked as told. It waits for the next message you type. The nightly dream run is also no longer handed the day's reminders as quiet hints, so it can't use up the nudges meant for your day.
- **Nothing in the wake disappears without a word.** When the wake is short of room, a section that
  can't fit all its items now always keeps a line saying how many more there are and the ids to open
  them, like a table of contents. Before, that line went in last and only when room was left over, so
  a whole section ("Still open" or "Arriving:") could vanish with no sign. A section that still lists
  something keeps its count right under it. Sections that list nothing fold into one line when they
  must: "More than this wake lists: 3 still open (recall ids: …); 2 on how I work (recall ids: …)". A
  plain reminder due today is still said in full.
- **"Nearby" says how many it left out, when there's room.** The hints the wake picked and then had no
  room for are counted with their ids, in room nothing else wants. They never push out "Last here" or
  another section's items. The rest of the store is still not counted: recall finds it by asking.
- **Doctor tells a step-down from a drop.** A section shown by count is the wake doing its job. A
  memory the wake picked and then left out of every line turns the Wake line red, as a bug to report.
- **The sidebar has a second look.** `/counterparts theme cozy` turns the pane warm (dark walnut, parchment text, leaf green and pumpkin) in every session; `/counterparts theme tron` brings back the black, cyan and amber it has always had, which stays the default.
- **The sidebar's button for a put-off first meeting says what it starts.** It reads "Start the 5-minute intro" (was "Meet your counterpart").
- **The sidebar no longer sounds broken when there is nothing to show.** With the dashboard closed, Mechanisms today says "Counts appear once the dashboard is open (/counterparts:dashboard)", the same for every install; with nothing new yet, the quiet line under the prompt reads "Watching quietly · nothing new yet".
- **Plainer first-week wording.** The privacy answer, the first-meeting style notes, the daily tidy-up line, the day-one health check, `counterparts --help` and the README now say things in everyday words. The style notes use your name (or "They") instead of "the owner", and the privacy answer spells out exactly how long session text is kept.
- **Dates read like dates.** The "Yesterday" and "Last here" lines at the start of a session say "Oct 11" instead of "10-11", say "2 sessions in other projects" instead of "chapters from 2 sessions in other directories", and no longer count chapters.
- **A friendlier first day.** Before a first page and identity exist, the assistant says "We've only just met" and "Still forming: I write this page after a few sessions". The session-start headings "Arriving:" and "Nearby, if it helps:" are now "Coming up:" and "Might be relevant:".
- **README.** Says the "who I am, who you are" opening arrives after the first few sessions, and that Windows is not yet supported.
- **The dashboard uses the same words as the session start.** Where the dashboard said "Arriving" and "memories nearby", it now says "Coming up" and "Might be relevant", the headings a session opens with. "Lived day 12" is now "day 12 of use", as the health check says it, and "the owner" is "you". Places your sessions ran are "projects", not "directories".
- **Clearer count lines at the session start.** When there's no room to list everything, the count line now says "3 more coming up" or "2 more might be relevant" rather than "arriving" or "nearby".
- **Status shows a readable date.** The opening line of `counterparts dashboard status` says "I have had 19 days of use — the latest Oct 11" in place of "I have lived 19 days — the last of them 2026-10-11".
- **Claude's first hello says the memory grows with you.** The first meeting's introduction now ends "so I can carry what matters from one session to the next, and grow along with you." When the sidebar's "Meet your new counterpart." starts the meeting, Claude reads it as the meeting and opens with that introduction.
- **A one-line welcome.** A new plugin install's first session now says "Counterparts is set up: a memory that stays on this computer, in ~/.counterparts. (Daily tidy-up, called dreaming, is on; say "no dreams" to turn it off.)" instead of three lines.
- **The dashboard says which memory it shows.** `GET /api/whoami` returns a short store id and the version, and `/api/onboarding` carries the same id. Each session start names the same id for the sidebar, so with two memories on one computer the sidebar can tell whether the dashboard on its port is the right one. The id never contains the folder's path.
- **A small fox now lives at the top of the sidebar.** Most of the time it sits still. Every so often it blinks, glances around, flicks an ear or swishes its tail, and after a few quiet minutes it curls up for a nap until your next message. It also shows what your memory is doing: it perks up with a spark when something comes to mind, writes on a notepad when a memory is saved, waves during your first meeting, and sleeps with a dream beside it while a dream runs.
- **The fox is drawn as finely as your terminal allows.** You get a full picture in kitty and Ghostty, fine block characters in iTerm2, WezTerm and VS Code, and half-blocks everywhere else. In the desktop app it is a drawing. `/counterparts avatar detail auto|images|fine|basic` picks one yourself, and `/counterparts avatar brain|animal|off` switches between the fox, the brain and no avatar. If you chose the brain before, you keep it.
- **"Start the 5-minute intro" starts the intro in any session.** The button now runs `/counterparts:meet`, so Claude knows what you asked for, even in a session days after you put the meeting off.
- **The sidebar starts the dashboard for you.** When the dashboard isn't running, the Mechanisms section says "Start the dashboard to see stats here", and clicking it runs `/counterparts:dashboard`.
- **The sidebar never shows another memory's numbers.** If the dashboard on your machine belongs to a different memory store (a trial store, say), the sidebar shows "This dashboard belongs to another memory." in place of its counts.
- **The sidebar's search box is hidden for now.** In some terminals it couldn't be clicked into. It will come back once that is fixed. Ask Claude to recall things in the meantime.
- **The sidebar no longer offers to turn off Claude Code's own memory.** The opt-in "Claude memory" switch is gone, along with the `COUNTERPARTS_SIDEBAR_CC_MEMORY` setting that showed it. If you had turned Claude Code's memory off with it, your MEMORY.md files and Claude Code's memory instructions come back from your next session.
- **Counterparts no longer reads a file outside its own directories.** The parallel run's
  switch, which could read an A/B assignment file in your home directory when a `parallel`
  setting was turned on, is gone; a configuration that still has a `parallel` key keeps
  working and the key is ignored.
- **New installs from the plugin now remember from the next session on.** An install made by the plugin's first run, or by `counterparts install` from a script, never set a size limit for the wake. With no limit, the briefing was never composed, so every session opened with "No briefing has been composed yet" even after days of use. Your memories were still saved, and recall still found them. Every Claude Code install now sets the same 9,000-byte limit the terminal install always set. An install made before this, without the setting, now uses 9,000 too, without any action from you; your configuration file is not changed. The first session after upgrading may still open on that line: the wake is composed when that session ends. `counterparts doctor`'s Config line says which limit is in use and whether it is the default.

## 0.3.19 — 2026-10-12

Reminders now arrive. A reminder due today stays under "Arriving:" in the wake all day, the near ones come first when a session starts, a reminder is no longer counted as told to a message nobody typed (an agent's hand-back or a task notification), and a memory that reads like a reminder but has no date now says so. Counterparts also reads far less of Claude Code's own files: the nightly run no longer scans `~/.claude/projects`, and the wake-arrival check is off unless you ask for it, which is what the plugin directory asked for. Underneath: the core can change (a kept promise can retire, a declared change moves it in about three days), the night folds memories that belong together and writes up everything it was owed, cards for people and projects are born at last, and the biggest source files are split so the plugin bundle fits the directory's file limit. No store-format change (store v13, cache v6), so there is no migration, and nothing to run after upgrading from 0.3.18.

- **The core can change now.** A core memory used to be write-once in practice: a kept promise could never
  retire the promise. A change you declare at one now counts at full daily weight, so it moves in about three
  days of saying so, and a plan the core held (with a status or a date) leaves it at once when a memory says it
  is done. Either can be undone.
- **A moved reminder's old memory steps back.** When a reminder moves to a newer memory, the one it left is
  marked as the earlier one and fades, instead of staying as current with its future-tense words. The few
  older ones get the same once.
- **One record for every "this replaces that".** A dream's merge, a settle, a write that updates a memory, the
  core's slow change and a moved reminder now all leave the same record and the same undo, and a settle over a
  memory with a date still to come carries the reminder to the newer one. A dream's merge keeps its originals
  as faded earlier versions behind the merged memory (hidden from what comes up on its own) until they fade
  out, instead of putting them away, and one original can be brought back on its own. A corrected memory hands
  its links to the one that holds.
- **"Done" ends a reminder.** A memory that says something is done no longer takes over the reminder of the
  plan it finishes, so it does not remind you on the day of something already done. The dashboard counts what was noticed (merges, newer states found) apart from what
  was declared, so nothing shows under both.
- **Earlier versions say so in more places.** A "meaning" answer marks an earlier moment with the memory that
  holds now, and a newer memory reached only through a link now stands in for its earlier version instead of
  showing beside it.
- **Cards for the people and projects you talk about are born at last.** A card used to be
  born only when a memory's title was exactly a name, which almost never happens, so a store
  in daily use for weeks had one card: yours. Now, once a day at the end of a session, the
  names your memories keep saying (in at least 3 memories on at least 2 days) get a card, ten
  a day at most, the most-said first. Capitalized words that are also ordinary words, and days
  and months, don't. A new card links every memory that names it, and a question by that name
  reads those links.
- **A card no longer shows up as a memory.** A newborn card holds only its name, so it isn't
  shown in a turn's recall or among the results of a question by name; the memories it links
  are.
- **A card you remove stays removed.** Removing a person's or project's card no longer lets
  the nightly count of names give it a new card from the same memories.
- **What keeps coming back can become core.** The slow road into the core asked for five separate days of use
  over three weeks, and nothing ever made it. Now it counts a memory together with its earlier and later states:
  used, cited in a reflection, or written about again, on four days, in three sessions, over a week, within the
  last month, as long as the memory itself was used. The newest state is the one that crosses.
- **The core is about me and us.** A memory about you alone, a fact, or a plan no longer becomes core. The ones
  already there that this moves out are not dropped: they show as "being reconsidered", in the wake's Still open
  list and on the dashboard's Self page, and stay core until one of us decides.
- **Nothing leaves the core without a decision.** A core memory that stops coming back for 60 lived days is
  reconsidered too, never dropped on its own. You keep one with `counterparts core --reaffirm <id> --reason "…"` or send
  it back with `--demote`. I can do the same, awake (`remember` with `core`) or when I reflect, and a flag lifts
  itself when its reason goes away (say a memory is re-marked as about us).
- **The night folds what belongs together.** When several memories are parts of one event or one stretch
  of work (a day's merges, a release, one book), the dream can now fold them into one memory that says what
  they add up to. The fold starts as strong as its strongest part, and the parts stay, marked earlier under it,
  at half their strength, so recall leads with the fold and the parts are there when you ask for detail.
  Readings, strongly felt memories about you or someone, and the core are never faded by a fold. At most five folds a night; any past that
  are counted and said in the morning line.
- **A correction reaches the summary.** When a memory a fold was made from is corrected, the fold is flagged
  beside the correction as possibly out of date, so it gets read again instead of carrying the old claim.
- **A personal fold can become core the ordinary way.** A fold is about you or about us only when most of its
  parts are. Once folded, what comes back counts toward the slow road into the core: the fold's own uses and
  its parts' later uses, across sessions and days. Its parts' history from before the fold does not.
- **A newer settle no longer stands an outdated memory back up.** Settling "B replaces A" after "C replaces B"
  used to make B current again over C. Now a settle speaks only about the two memories it names, and B stays
  earlier under C. To make B current again, settle B over C: that reorders the pair.
- **A catch-up no longer re-reads what a session already wrote up.** A long session that wrote its own
  chapters as it went left parts whose every word was already written up, and a catch-up handed each one to a
  reader anyway, about 24 KB at a time, only for it to answer "nothing new" in two seconds. Those parts are now
  passed over without a reader and cost a batch nothing, and the run's summary says how many there were
  ("16 parts written, 11 of them already written up in their own session"). On the first live catch-up's
  biggest session that is one child instead of three, with about the same memories kept.
- **A catch-up's "nothing worth keeping" says why.** In the nightly run or `counterparts catch-up`, an empty
  answer for a part that holds words not yet written up now needs a one-line reason; without one the part is
  not counted as written, stays owed for the next run, and doctor and `counterparts coverage` say how many
  parts were left unread. A live session's empty answer is unchanged.
- **`counterparts catch-up --reowe <run>`.** Owes again the parts a named run closed with nothing kept, when
  their words were not yet written up. It prints the plan first, then asks for the run's id typed back
  (`--yes` skips that, `--dry-run` stops at the plan), and refuses by name what it cannot do: a session the
  run went on to write up, parts after them that brought memories back, or words no longer kept. It reads the
  run from the log, which keeps a week.
- **A note no longer marks the whole session as written up.** A note written mid-session used to count everything
  said before it as written up, so one short note could leave hours of conversation that nothing ever wrote
  down. Now a note covers only the turn it was written in; the rest waits for the session's own write-up, a
  later session, or the night's catch-up, and the end-of-session ask still comes when it is due.
- **`counterparts coverage` agrees with the catch-up and doctor about who owes.** A small stretch from a session
  that was not a person's (`claude -p`, the Agent SDK) is listed as left to lapse, not as owed, and the line about
  parts a catch-up left unread shows only for today or for the date that run was on.
- **The night picks what to dream by what it is worth and how close it is to fading.** The dream used to read
  only the newest 2,000 not-yet-dreamed memories and keep each one waiting for at most a week. Now it reads all of
  them and ranks them by value (how much a memory mattered, how strongly it was felt, whether it is dated or on
  my mind) times how weakly it is held on its own forgetting curve. A memory waits as long as it is still within
  reach, however old, and one that fades below reach before a dream gets to it is counted and said, not dropped
  silently. The night's budget is the same as before.
- **A fold the night had no room for comes back.** When a night has already made its five folds, the parts of
  the next fold are carried to the next night, together and first in line, so it can be made then. Parts a fold
  would not fade (readings, strongly felt memories, dated ones, the core) are not carried.
- **A reminder due today stays under "Arriving:" all day.** A dated item that had already come up twice in
  conversation in the days before, or had come up once earlier the same day, dropped out of the wake's
  "Arriving:" list, sometimes on the very day it was due. A plain reminder told to the first session of its
  day also dropped out, even when that "session" was an agent's message at midnight that nobody read. Now
  the list keeps a dated item until its day is behind it. How often a reminder is raised mid-conversation is
  unchanged.
- **"Arriving:" no longer goes silent.** When a long self page left room for no dated line, the wake said
  nothing at all about what was arriving. Now it always gives the one-line count with the ids
  (`Arriving: 7 — no room to list them in this wake`), taking that room from "Work here", the Yesterday
  line's titles and the handoffs. Doctor's Wake line now counts these as renders of the wake, and its advice
  says what actually gives way.
- **A reminder written without a date now says so.** When a memory reads like a reminder ("remind", "don't forget", "follow up", "check back" beside a date such as "Oct 14", a weekday or "tomorrow") but is stored with no `eventDate`, the `remember` and `session_end` answers carry a one-line `reminderHint`: it will never come back on a date, and revising it with an `eventDate` makes it fire. The date is never guessed from the text and the write is never refused.
- **Fewer reads of Claude Code's own files.** The nightly run no longer looks through `~/.claude/projects` for
  its own background session's transcript: it reads what that session printed as it ran, and doctor's Tool
  results line says whether that output was read. Claude Code's compaction summaries, skill bodies, hook
  feedback and other lines it writes for itself are no longer kept with a session's words; a message another
  session sent to this one still is.
- **The wake-arrival check is off by default.** It read the start of the session's transcript only to confirm
  the wake arrived whole. Set `COUNTERPARTS_WAKE_CHECK=1` in Claude Code's environment to turn it back on;
  doctor's Wake line names the setting when no wake was checked.
- **A reminder is no longer "told" to a message nobody read.** When an agent's hand-back, a task
  notification or another session's message started a turn, a plain reminder due that day was said
  there and counted as told. Now it waits for the next message you type. The same goes for the
  morning's dream line and share.
- **Dated items due in the next few days come first when a session starts.** At session start, the
  "Arriving:" lines due today through three days ahead are listed first and take room before "Last
  here", "Last said here", "Today, elsewhere" and the older handoffs. The newest handoff always keeps
  its place.
- **A quiet dated item that already came up leaves after its day.** One that had been raised twice in
  the days before stayed under "Arriving:" for a week as "was due". Now it leaves once its day is past.

## 0.3.18 — 2026-10-11

A new install now starts with a first meeting: in its first session Counterparts offers,
once, to take about five minutes to get to know each other (where memory is on, what you're
working on, how you like to be talked to), and keeps each answer as an ordinary memory; the
plugin's sidebar opens that conversation itself, and dreaming is on for new installs. The
plugin is ready for Anthropic's plugin directory: Bun no longer fetches anything on its own,
`/counterparts:dashboard`, `/counterparts:meet` and `/counterparts:uninstall` work without a
`counterparts` command, and doctor's fixes fit how you installed. Older memories with no
salience of their own now read at today's default for what they are about, so memories about
you or the two of us written before your 0.3.17 upgrade come back into reach. The nightly run writes up every
session still owed (`counterparts catch-up` does it on demand) and reflects in a session of
its own, a memory that replaces another comes up in its place, and `counterparts uninstall`
offers to delete your memory, at a terminal, behind a typed phrase. **Nothing to run after
upgrading from 0.3.17**: the hooks, the memory server's registration and Claude Desktop's
entry are the same as 0.3.17's, and an existing memory keeps its dreaming setting and is
never offered the first meeting. **No store-format change** (still v13, and the search cache
v6): nothing is copied or upgraded, and 0.3.17 opens the same store. To go back to 0.3.17,
don't run `counterparts rollback`: it undoes a format upgrade, and within 14 days of 0.3.17's
it would offer to put back the copy taken before it, without everything remembered since.
Run `counterparts disconnect`, reinstall 0.3.17, then `counterparts connect`.

The first meeting (#419, #416, #424, #426, #393).

- **A first meeting, on every install.** A new install's first session offers, once and
  at the end of a reply, to take about five minutes to get to know each other: where memory
  is on (every folder, or just this one, unless a folder was already set), what you're working on, something you've loved,
  how you like to be talked to (straight to it, think it through with me, friendly and easy,
  or like a character you name) and a few more, each one skippable. Each answer is kept as
  an ordinary memory marked as from onboarding, a style becomes a few preferences that keep
  honest pushback, and the next session may bring one of them back on its own. "Later"
  offers it again another day (the offer comes on three days at most); Claude's new `meet` tool starts it any time. A memory that
  already existed is never offered it.
- **The sidebar starts the first meeting.** In the first session after an install, Claude
  speaks first ("Counterparts is installed. Say hello and introduce yourself.", shown as sent
  by the plugin), once per install, never in a `-p` run, in a folder that is paused or off,
  or after you've typed. If you put the meeting off, a **Meet your counterpart** row at the
  top of the sidebar starts it when you're ready.
- **`/counterparts:meet` starts the first meeting any time.** For a plugin install, the short getting-to-know-you conversation can be started with this command as well as with the sidebar's "Meet your counterpart" button, so someone in the quiet view, or past the first days' offers, still has a way in. It asks the memory server's `meet` tool for the meeting and runs nothing else.
- **Dreaming is on for new installs.** Once a day the first session starts a short
  background run that goes over what was saved, and the install, the plugin's first-run line
  and `counterparts doctor` say so and how to turn it off ("no dreams", or
  `counterparts dream --setting off`). An existing memory keeps its setting.
- **`counterparts start-fresh` begins with a first meeting**, and `--undo` brings back the
  parked memory as it was.
- **A new person's first day gets written up even with only a few memories.** With dreaming
  on its own, the nightly run used to start only when there was enough new to dream on, so
  someone who skipped the first meeting and saved one or two memories got no run on day 2,
  and their first day's conversations were never written up. Now the run also starts when
  sessions from an earlier day still owe a write-up: it writes them up quietly in the
  background and skips the dream, and `counterparts doctor` says "the catch-up alone" rather
  than a failed dream. Dreaming `ask` and `off` work as before.
- **A new install's doctor has no puzzling amber before the first session.** The Vectors line
  read amber, about embedding "per boundary", until the first session ended. Before then it
  is green and says the search by meaning builds after your first session; on a store that
  has had sessions, a real shortfall is still amber.

The plugin, ready for Anthropic's directory (#396, #394, #399, #416).

- **Bun no longer fetches the embedding table on its own.** When a plugin install's
  packages didn't install (the package manager its lockfile names wasn't on the PATH,
  Claude Code's 60-second limit, offline), Bun used to download the table from the npm registry the first time it was
  needed, at whatever version was newest, without saying so. Now nothing is fetched: recall
  matches on words, and `/counterparts:doctor` says the table is missing. npm and Bun
  installs of the package are unaffected.
- **Doctor's fixes fit how you installed.** When the model table is missing or damaged, or
  the search cache came from a newer build, doctor used to say `bun add -g …` even on a
  Claude Code plugin install, which may have no bun at all. A plugin install now gets
  `/plugin → Installed → counterparts → Update now` (or uninstall and install it again); the npm install keeps
  its `bun add -g` command; and where doctor can't tell which it is, it names both.
- **Plugin installs can start the dashboard: `/counterparts:dashboard`.** A plugin install
  has no `counterparts` command, so the sidebar's "start it with `counterparts dashboard`"
  couldn't work there. The new command starts the same dashboard from the plugin, in the
  background, until the session ends. With the dashboard down, the sidebar names the way
  that works for your install: `counterparts dashboard` for the npm install,
  `/counterparts:dashboard` for the plugin.
- **The sidebar finds a dashboard on another port.** When `COUNTERPARTS_DASHBOARD_PORT` is
  set, the sidebar reads and links to that port, as the dashboard itself does, instead of
  assuming 4747.
- **The sidebar's Counterparts switch has three positions: on · paused · off.** Paused and
  off each ask first and hold for every session in that folder; on resumes a pause at once,
  and turns a folder you set off back on after one confirmation ("Nothing from while it was
  off was kept."). It stays as careful as before: a state it couldn't read is never shown
  as on, and it changes only a folder with a setting of its own. A folder that is off or
  paused because a folder above it is, it explains, naming that folder, and leaves alone.
- **The "Claude memory" switch is hidden unless you ask for it.** It turns Claude Code's
  own memory (MEMORY.md) on and off, which most people don't need beside Counterparts. If
  you had already turned Claude Code's memory off, you keep the switch. To show it anyway,
  start Claude Code with `COUNTERPARTS_SIDEBAR_CC_MEMORY=1` in the environment (for
  example `export COUNTERPARTS_SIDEBAR_CC_MEMORY=1` in your shell profile). What it does
  when shown is unchanged.

Uninstalling (#414, #421, #425).

- **`counterparts uninstall` asks whether to delete your memory too.** Once Claude Code is
  disconnected, at a terminal, it lists every path that would go (the store, its snapshots,
  the configuration) with its size, says what it leaves (Claude Code's own files), and asks
  "Also delete all memories and related data? This can't be undone. [y/N]". Enter keeps your
  memory. A yes asks you to type `DELETE MEMORIES` before anything is deleted. It isn't asked
  from a pipe, with `--yes`, or with the new `--keep-memories`, and isn't offered while a
  Claude Code session, the dashboard or the worker has the memory open.
- **`--delete-memories` also waits for open sessions.** It now refuses while a Claude Code
  session's hooks ran on the store in the last ten minutes, or a memory server is recorded
  as running on it, not only while one shows up in the process list.
- **`counterparts uninstall --json`, for the plugin's own command.** On its own it prints
  the plan as one JSON object and changes nothing: what a delete would remove and leave, the
  count, and whether it can go ahead now. With `--keep-memories` it uninstalls and keeps your
  memory. It never deletes: that is always typed by you, at a terminal.
- **Uninstall's last lines fit a plugin install.** Run through the plugin, they name the
  plugin's own command line and Claude Code's `/plugin` to remove it, not `bun remove -g`.
- **`/counterparts:uninstall`, for a plugin install.** It shows what an uninstall would do,
  then asks whether to keep your memories or delete them too. Keep disconnects Counterparts
  and leaves your memories where they are; then you remove the plugin from `/plugin`. Delete
  runs nothing: it has you disable the plugin first (so it doesn't set itself up again when
  Claude Code next opens), then gives you the one command to type in a terminal with Claude
  Code closed, where you confirm the delete yourself. Claude can't delete your memories from inside a session.
- **Uninstalling with the plugin no longer leaves an empty memory folder behind.** After
  `uninstall` deletes or sets aside your memories, a plugin install is now told to remove the
  plugin right there in the terminal (`claude plugin uninstall …`), before opening Claude Code
  again. Opening Claude Code first let the still-enabled plugin set Counterparts up again, with
  a new, empty memory folder that stayed after the plugin was gone. If you have both the npm
  install and the plugin, it now names the plugin too.

Writing up what was said, at night (#401, #407, #413).

- **The nightly run catches up on everything owed.** Sessions that ended before they were
  written up used to wait for a new session in the same folder, or for the nightly run,
  which took at most four of them a night. The nightly run now writes up all of them,
  oldest first, in short batches, with a ceiling of 100 parts and an hour a night against
  runaway cost. What it leaves stays owed for the next night.
- **The nightly run's catch-up stops at 100 parts.** A typical morning owes 20 to 40 parts
  and clears in one night; a heavy day takes two, and what the night leaves stays owed for
  the next one. `counterparts catch-up`, which you run on purpose, still takes up to 400
  parts. Both still stop at an hour.
- **`counterparts catch-up` does it now.** It writes up every ended session that is still
  owed, through the same windowless `claude -p` the nightly run uses, while your other
  sessions stay open. It prints each batch, then how many sessions it caught up and how many
  sessions and parts are left. It uses your Claude subscription like any session.
- **New sessions no longer write up other sessions at the start.** With dreaming on `auto`,
  a new session isn't pointed at an older session's words any more; the nightly run and the
  command do that work. Your sessions' own write-ups are unchanged. With dreaming on `ask` or
  `off`, no nightly run happens, so the pointer stays.
- **Doctor says how far a catch-up got.** Its Catch-up line (it was Write-ups) and its
  Nightly run line count the parts written and the parts still owed. On 10-11, "wrote up 0 of
  1" was shown for a night that wrote 5 of a session's 17 parts. When the night has caught
  up, the next session is told in one line.
- **A nightly run cut off by an update says so.** If an install migrates the store while the
  nightly run is going, the run is recorded as unreadable after an update mid-run. It used
  to say the run had used none of its tools.
- **The nightly reflection starts with a fresh mind.** The background run now runs in two
  parts, one after the other: the page writer and the dream, then the reflection in a
  session of its own, which reads tonight's dream from memory instead of carrying the whole
  dream in its context, so a night needs far less room at its peak. If the dream fails or
  has nothing to do, the reflection still runs on the last few days. `counterparts dream
  --list` and doctor say which parts ran, as before.

What a memory is about, and how long it lasts (#395, #398, #400, #403).

- **Older memories read at today's defaults, the same as new ones.** A memory written before
  the upgrade with no salience of its own was given the old flat default, so a memory about
  you or us from the last few days faded within days, while the same memory written today
  starts higher and lasts weeks. It now reads at today's default for what it is about, higher
  or lower: about you or us 0.40, a finished piece of work 0.20. A salience someone actually
  set still reads as it did. Nothing is rewritten; `counterparts claims-era` and doctor's "Old
  claims" line say how many read lower and how many higher, and `--off` reads every one as
  stored again.
- **A merged memory keeps what it was about.** When a dream merges near-copies, the merged
  memory now takes what its strongest original was about, and a memory about you, us or me is
  never turned into a work one by merging it with one. It also fades the way its originals did:
  a memory written before the upgrade is still read at today's default after a merge, instead
  of starting over at the claim the old build gave it. `counterparts claims-era --off` reads it
  as stored, the same as the rest.
- **A revised memory keeps what it was about.** When you revise a memory (`updates`) without
  saying what the new one is about, it now takes the mark of the memory it revises, and counts
  for as much: a memory about you or the two of us, revised without restating `about`, stays
  yours and keeps its higher starting weight instead of dropping to the unmarked one. Saying
  `about` on the revision still wins.
- **A dream's pattern keeps what it is about.** A pattern a dream draws from memories about you
  or the two of us is now marked so, like the memories it came from, instead of coming out
  unmarked and counted as one folder's project work. It still starts low and rises only by
  coming back in your sessions.

What replaces what (#420, #408, #422).

- **A newer version of something is noticed without being named.** When a memory you write reads
  as the newer state of a recent one (the same release, a plan now done, the latest count), the
  older is marked as possibly out of date and faded a little, and the write says so; settle it
  then, or the night's dream confirms it or says they are two different things. Dated reminders,
  readings and core memories are never proposed.
- **What holds now comes up in place of what it replaced.** When recall reaches a memory a later
  one changed, it shows the later one, which names the earlier; the two no longer show side by
  side with the old one first.
- **A memory a later one changed is marked wherever it is listed.** When you write a memory,
  the close existing memories it comes back with no longer show an older version by its bare
  title: it reads `earlier (now mem_…)`, naming the one that holds now, or is left off when
  that one is already in view. Dreams and reflections see the same mark, and a reminder a
  later memory replaced no longer shows on the dream's "coming up".
- **"Earlier (now …)" names the latest version.** When a memory was changed and then
  changed again, recall's label points at the newest one, not the one in between, and a
  memory a later settle put back in place no longer reads as earlier.
- **Facts answers name the memory that holds now.** When a facts-mode `recall` shows an
  earlier version on its own, its "earlier — now …" line names the end of the chain (on
  A, then B, then C, it says C), the same memory recall's other labels and a write's
  neighbours name. An earlier version that a newer settle re-affirmed reads as current.
- **Updating a removed memory no longer fails the write.** A `remember` whose `updates`
  named a memory you had removed used to fail outright, and the new memory was lost with
  it. Now the new memory is stored on its own, unlinked, and the reply says the memory it
  named was removed. It is never attached to a similar memory in the removed one's place.
- **A memory's weight follows how it was last felt.** A later feeling recorded about a memory
  (awake, in a dream or in a reflection) is what its weight reads now, so a hurt that has been
  talked through can soften; the first feeling stays on record. Settling over a felt memory asks
  how it sits now.
- **Fewer wrong settles.** A reading is no longer faded by a fact that shares its topic (the two
  are kept side by side), a reminder still to come can't be settled over without the newer memory
  carrying it, and the check on a write's `updates` now measures how close is close in your own
  store. A settle closes the other open questions about the memory it moves, and a question left
  open for a week is asked again once.

Reminders (#393, #411).

- **A plain reminder keeps its place under "Arriving:".** The wake lists two arriving items,
  and two quiet ones due sooner could take both lines from a reminder you asked to be told
  about. Arriving now lists plain reminders first, then the nearest dates; whatever doesn't
  fit is still named in the "more arriving" line.
- **A reminder whose day you missed is still said, once.** If a reminder marked plain falls on
  a day you don't open a session (or no session that day had room for it), the next session
  within the week after says it once, with the day it was for: "This was for Mon 12 Oct 2026:
  pay your taxes". It is never said twice, and never after that week.
- **A reminder you've dealt with stops coming back.** When a session says it drew on a dated
  memory (`drewOn`), that memory stops coming back as a footnote for that date. A reminder
  marked plain is still said on its day.
- **The dashboard shows repeating dates.** The Mechanisms panel's "waiting" list now includes
  birthdays and other repeating dates, at their next occurrence ("every May 14").

Association (#423).

- **What you drew on together is linked.** The memories one `drewOn` names together each get a
  link to the others, as strong as two memories opened in the same reply.
- **A note is faintly linked to what was in mind.** A memory noted mid-conversation gets a faint
  link to the memories recall showed on that same turn. Memories written up at a session's end
  don't, since what was on screen then isn't what each of them was about. The link fades in about
  a month unless using them together strengthens it, and it never pushes out a link use made.
- **Dreams lay faint trails.** When a dream opens, each new memory it is shown is faintly linked
  to the older memories shown beside it. No model call; it is not one of the dream's changes, so
  undoing a dream leaves it.
- **Fewer dead links.** Links to a chapter copy that regrew, or to the originals a dream merged,
  are cleared once they've been handed on; undoing a dream's merge hands them back. Memories that
  faded keep their links, so one that comes back keeps them too. Temporal neighbours link one
  step apart now, not two.
- **Association says what it did.** The dashboard counts links laid, not rows rewritten, and a
  second number: memories a link brought to mind. Once a store has a couple of weeks behind it,
  Association shows amber when links were laid but none brought anything to mind that week; a new
  store shows it waiting instead.

The wake, recall and chapters (#392, #405, #404, #409, #415).

- **"Last said here."** A new session in a folder now gets one line pointing at the last
  exchange there: when, which session, and the first few words of the last message that
  session got, such as `Last said here, 18:42 (session 3fa9c1d2): "ok now let's fix the reserve…" —
  recall "last exchange"`. It comes from the most recent other session in the same folder,
  within about a day, and never from another folder. Asking `recall` for the handle
  `last exchange` returns both messages, the last message there and the assistant's last reply,
  with their times, each cut at a sentence. The end-of-session ask and its answer, text the host
  added (reminders, task notifications, subagent reports, skills, slash commands) and tool-only
  turns are skipped; text the host adds with no mark of its own (a coordinator's message) can
  still read as a message, so neither the line nor the handle says who sent it. It is read only
  from what Counterparts already captured in that
  folder, and never stored, and only in your own sessions: an observer folder, or a
  session that is not yours, gets no line and no answer. A session that was killed after you typed and before it
  finished replying is named by the last exchange it did finish. The line sits beside "Last
  here" and the handoffs, and is the first of them to give way. Dated items and the page
  always come first.
- **Recall shows the order of things said on the same day.** When two or more facts in one
  answer happened on the same day and were learned on the same day, each says the time it was
  learned (`learned 05-25 09:52`), so two updates from one day no longer read as a tie. A lone
  result, or results on different days, look as before.
- **Chapters ask for the day's details.** A chapter is now asked to be a diary of what happened, in order and in detail: what was said, what was decided and why, what went wrong, with a list or a pasted text kept word for word when it matters, and without what the repo or the logs already hold. The lessons and patterns go to the nightly reflection, which now says so.
- **A list or table you care about is kept word for word in the memory.** When a list, a table or a
  pasted text matters in its specifics, the assistant is now asked to keep it whole in the memory's
  own words rather than summarize it, with what it is, whose and when in the title and first line
  so it can be found. Asking for facts says when a memory holds one ("a list, 100 items; read whole
  by id"). A trial, to be looked at again after a few days.
- **Less room spent on tools and resumes.** The memory tools' descriptions are shorter
  (`session_end` about 21 KB to 15.5 KB as loaded, `remember` 19.6 to 16.2) and keep every
  rule that changes a call. A session you resume the same day gets one line pointing at the
  wake already above it, instead of a second wake of up to about 9 KB; after a compaction,
  on a later day, after `/clear` or in a fork, the full wake comes as before.

## 0.3.17 — 2026-10-11

The plugin's sidebar shows what memory is doing in 35 columns: what came to mind for your
last message, what was quietly offered, what this session saved, which mechanisms fired
today, and last night's dream. Forgetting now changes what comes to mind: each memory fades
on its own curve, slower the more it mattered, was felt or was used, and one that falls
below reach stops coming up on its own, though asking still finds it, labelled faded. One
under the floor for 14 lived days is archived, never deleted. Memories written before this
version are read at the defaults for what they are about (`counterparts claims-era` turns
that off). Claude's in-the-moment tool is `remember` now (`note` still works), the wake is
put together when a session starts and names the other folders worked in today, and
`counterparts rollback` is the way back. **Nothing to run after upgrading from 0.3.16**:
the hooks, the memory server's registration and Claude Desktop's entry are the same as
0.3.16's (coming from 0.3.14 or earlier, see those versions' notes on `counterparts
connect`). If your Claude Code settings allow `mcp__counterparts__note`, you'll be asked
once to allow `mcp__counterparts__remember`. **The store's format changes (v12 to v13, and
the search cache v5 to v6)**: the first open after the upgrade copies your memory to
`snapshots/…-pre-migration-v12-to-v13` and upgrades it. 0.3.16 refuses the upgraded store,
and a memory server still running 0.3.16 answers "Counterparts was updated" until it is
reconnected (`/mcp`) or restarted, so close your sessions, quit Claude Desktop and stop the
dashboard before installing. To go back to 0.3.16, run `counterparts rollback` while 0.3.17
is still installed, then QUICKSTART's "Going back to an earlier version": `counterparts
disconnect`, the 0.3.16 reinstall, then `counterparts connect`.

The sidebar mod, v0.2 (#375).

- **The sidebar shows what memory is doing, in 35 columns.** A small brain beside the
  title (click COUNTERPARTS for the dashboard), the day, the count and a search box; then
  **Memories**, what was said to Claude in full for your last message, and
  **Subconscious**, the titles it was quietly given (`↗ opened` on one it looked up);
  **Saved this session**, newest first; **Mechanisms today**, how many times each of the
  twelve fired today, as bars (a click on one lists what its firings were about: the
  memories that came to mind, what faded, what was merged, never bare counts); and **Last
  Dream**, its first sentence (a click opens more of the dream). Each item takes up to
  three lines, and when they don't all fit, fewer show. A click opens any item in place,
  and again closes it; a long one shows 20 lines and ends with **more**, which opens that
  memory on the dashboard (the dashboard now opens one memory by `#memories?id=`). Dates
  in titles read short ("Oct 9"; today's are dropped). A click on a section's heading
  gives it the room. Three rows of switches at the bottom: Counterparts in this folder
  and Claude Code's own memory (each as safe as before: a pause still asks first, and an
  unknown state is never shown as on), the view, and the brain. On a laptop screen the
  sections fold to fit, each keeping its heading.
- **Closed, it says the newest thing in one line.** `/counterparts quiet` (or the pane's
  ✕) shows it dim at the end of the line under the prompt, as in "remembered: …", "stored:
  …" or "dreamed: …", always ending with "· /counterparts opens it". The amber status line
  is gone except to warn that a folder is paused or off, and clearing it gives the row
  back. `/counterparts brain turning|still|off` (or the footer) sets the brain: turning
  sways gently, still lights only when something fires, off leaves it out. A view or brain
  you set before carries over; v0.1's "full" opens the sidebar, its "quiet" and "hidden"
  are quiet.
- **The dashboard counts each mechanism's firings today.** `/api/mechanisms` carries
  `firedToday` on every mechanism: how many times it fired on today's date, counting
  rows rather than amounts, and one dream once. With a dashboard from before this
  release the sidebar counts them itself from the activity feed.

Forgetting (#372, #377, #379, #385, #386).

- **Forgetting now changes what comes to mind (store v13).** Each memory fades on its own
  curve: steep at first and flat later, slower the more it mattered, the more it was felt,
  used or came back. A routine note leaves the working layer in about two days; a felt
  reading lasts months; a strong fact about a year. Under a line ("below reach") a memory
  stops coming up on its own — in turns, as a pointer from a link, or in the wake's work
  lines — but asking for it still finds it, labelled faded, and
  using it, opening it or a dream replaying it brings it back. A memory that has sat under
  the floor for 14 lived days (was 90) is archived — never deleted, still readable by id.
  A reminder is held at full strength until its date and the week after, then fades on its own curve as if it had
  never been held (so a routine one written weeks before its date is archived that night —
  never deleted, still readable by id); a repeating date is held
  around each time it comes round. Chapters, their copies and live handoffs are never let
  go. A feeling now counts once for how high a memory stands and once for how slowly it
  fades, and softens from the day it was recorded. The nightly pass reads only the
  memories whose standing changes that day. The dashboard counts "below reach now" and
  "exited" apart. Skills and places now count their salience as fully as any other memory
  (they counted it at 0.4, which left a quiet skill out of reach from the day it was written).
  The band-symmetry check now warns only when memories climb with nothing behind it; fading
  down a band is the curve working. The store upgrades to v13 on the first open, after taking a copy; a
  build from before refuses the upgraded store, and the copy is the way back. These are
  lightly held decisions; they are listed in `docs/IMPROVEMENTS.md` under "Decisions to
  review".
- **A dated memory goes back to fading normally once its day and the week after have
  passed.** It is still held at full strength until then, and a repeating date is still held
  around each time it comes round. After that it no longer fades faster: it reads as if it had
  never been held, counted from when it was made or last used. So an old routine reminder
  leaves at once, and one written weeks before its date is archived that same night — never
  deleted, still readable by id. A strongly felt dated fact lasts as long as any memory like it.
- **Old claims are read as defaults (an era, not a rewrite).** Memories written before this
  build reached the store, with a salience claim made under the old field text ("set it on
  anything that should last"), are read by the forgetting curve at the default for what they
  are about — a done work event 0.20, other work 0.25, the world 0.35, me 0.40 — when that is
  lower, so the store starts to fade. No claim is rewritten. The core, memories about you or
  about us, things marked as said by you (memories written since 10-08), protected memories
  and dated ones still ahead or repeating keep their claim; older rulings of yours with no
  such mark may fade. `counterparts claims-era` says whether it is on and how many memories it
  affects; `--off` reads every claim as stored again, `--on` puts it back; doctor shows the
  same in one line. The reading is what turns back: a memory let go at the floor while it
  was on stays archived (readable by id). A lightly held decision, listed in
  `docs/IMPROVEMENTS.md`.
- **Asking for facts shows faded memories in full, among the rest.** A match that has faded
  (below reach) is ranked with the live ones by how well it matched, its words shown and
  labelled faded, and the header counts them ("3 of them faded"). It was a title line after
  the main results, which left counting questions one item short. Things that come up on
  their own still leave faded memories out; being shown strengthens nothing, opening or
  quoting one does. Meaning mode is unchanged.
- **Say which memories you drew on.** `session_end` and `chapter` take an optional `drewOn`
  list: the ids of memories shown this session (a footnote, a recall result) that changed
  what was done or said. Each gets half a use, so it holds longer: once a day per memory, at
  most three per ask, and only ids this session was actually shown. An id it was not shown,
  a superseded memory or one faded under a newer one is refused by name. Opening it later
  the same day still lifts it to a full use. A wake line is still credited by opening it.
- **Each further use adds less.** What a memory gains from being used now levels off gently
  instead of climbing in a straight line to a cap at five uses.
- **The doctor counts it.** The Credit line says how many `drewOn` credits landed over the
  last week, beside the newest boundary's reading.

Writing memories (#369, #374, #383).

- **`note` is now `remember`, and memory is asked for by attention.** The tool Claude
  writes a memory with in the moment is called `remember`. **The old name `note` still
  works** for at least this release — a session that started before the upgrade keeps
  calling `note` and is served exactly as `remember`; only `remember` is listed. Its words
  changed with it: memory forms only from what Claude writes here and at the end-of-session
  ask (nothing reads the transcript afterwards), so it asks Claude to write in the moment,
  as things catch its attention — a line read and why it struck, something said about the
  person or about Claude, news, a decision, a work event — one idea per call. The
  end-of-session ask now asks for "what caught your attention since you last wrote, one idea
  each — what you read, what they said, what happened" (474 characters at most), and no
  longer says "nothing worth keeping is a real answer"; an empty list is still accepted, as
  the `memories` field says. The salience field gives an anchored scale by attention (about
  0.1–0.2 a routine merge or status change; 0.4 or more a line that struck, or a reading
  engaged with; the person's rulings, preferences and corrections high even about work), and
  `relevance` now means how much it bears on the person, on Claude or on the two of them —
  not only on the task. A dated decision, a kill or renew date and an outside deadline are
  named as `eventDate`s. The CLI's `counterparts note` keeps its name.
- **Three things you may notice after upgrading.** If your Claude Code settings already allow
  `mcp__counterparts__note`, you will be asked once to allow `mcp__counterparts__remember`.
  A few strongly felt memories claimed at 0.42–0.50 now start episodic rather than semantic.
  The text of a session that still owes a write-up is now kept up to 14 days of use plus the
  ordinary 7 days, not 2.
- **An unclaimed memory starts by what it is about.** A memory written without a salience
  used to start at 0.25 whatever it was. Now: 0.20 for a work event that is done, 0.25 for
  other work and for an unmarked one, 0.35 for the world (readings, news), 0.40 for the
  person, the two of you or Claude (or said by the person). All stay under the semantic
  floor, and a strong feeling on a silent memory lifts it to at most 0.49: a default sets how
  high a memory starts, never its band.
- **The core's fast lane can open again.** "Strongly felt" is read against the word's own
  default: a feeling at 0.6, or one at 0.5 or more that is 0.1 above what its word is stored
  at when nobody weighs it, now counts. Since the feelings wheel gave every word a default (all at or under 0.55),
  nothing written without a number could reach the old 0.6 bar. A word nobody weighed
  still never opens the lane on its own.
- **Mood no longer lifts memories in recall** (both weights 0, the code kept for a re-test):
  memories it lifted were used less than others (1.3% against 2.4%). Recall also stops
  reading recent feelings each turn while it is off.
- **What a session said and nobody wrote up stays owed for fourteen days of use**, not
  three, so the nightly write-up (oldest first, four sessions a night) reaches it; past that
  it is let go and said as lost. And a session at its ask limit for the day is still asked
  when it holds an unwritten stretch that is due.
- **A memory written with `remember` (or its old name `note`) reaches the next session's
  wake the same day.** Only write-ups, chapters and the self page used to bring the wake up
  to date between days, so a note left Still open, Nearby and Arriving as they were for up
  to a day, in every directory, a question it answered included. Now every memory that
  lands, and every handoff written or retired, re-renders the wake at that turn's end, in
  the background.
- **You can say what a memory is about.** `counterparts about <id>` prints its mark (me,
  us, owner, work or world) and who set it; `counterparts about <id> owner --why "..."`
  changes it as you, keeping the why, recorded the way a nightly reflection's re-mark is.
  It works on an archived memory too, and an earlier version's id marks the current one.
  The dashboard's memory card shows the mark and has a small picker that runs the same
  command. A personal memory written in a project, left unmarked or marked work, counts as
  that project's work and is shown only there; marking it owner or us shows it everywhere.
- **Claude can fix a mark in the moment.** `remember` takes `remark: {id, about, why}` for
  a memory the session was shown, recorded as set by the counterpart itself. A dream's or a
  reflection's words can only be moved toward work or world this way; you can mark them
  anything.
- **A full night still offers the unmarked memories to be marked.** The nightly
  reflection is offered up to five memories nobody has marked; on a busy night they were
  squeezed out of its bundle entirely (10-10: none). They now keep a small room of their
  own, a line each at least, and unmarked skills are offered too.

The wake, and other folders (#376, #380, #382, #387).

- **A session's wake is put together when the session starts.** "Still open", "Arriving:",
  the Yesterday line and the self page are read at that moment, so the morning's first
  sessions see yesterday's chapters and a question or reminder noted last night, not the
  wake the evening's last turn left. "Nearby" and "Who I am" still come from the last turn's
  end. Reads only, no model call: a few milliseconds.
- **"Today, elsewhere."** One line in the wake names the other folders worked in today:
  when, whether a session there is still open, how many memories it wrote, and its chapter's
  title when that chapter is about you or me (the "About me, from another directory" rule).
  Never what was said there, a work memory's title, or a handoff. Folders whose scope is not
  on are not named. It is at most 300 bytes (more folders become "+N more"), and it is
  given room ahead of "Nearby", "Still open" past its first item, "Work here", the
  Yesterday line's titles, "Last here" and the older handoffs, so it prints beside a long
  page. The page, "Arriving:", "Still open"'s first item and a plain reminder due today
  still come first, and on days no other folder was active the wake is unchanged.
- **"Since you started."** A session that is already open now hears what changed in other
  folders while it worked: one line for the assistant, at a prompt, such as "Since you
  started (10:40): ~/deadfront ended 11:05, 3 memories; ~/random open since 10:52, 2
  memories." Only when something changed there (a session started or ended, a
  chapter, new memories), never at the first prompt after the wake, and at most once an
  hour. The same rules as "Today, elsewhere": counts, not what was said; a chapter's title
  only when it is about you or me; folders whose scope is not on are not named. It takes
  only the room recall left, and waits for the next prompt when there is none. Reads only,
  no model call: about 5 ms on a prompt that checks, nothing in the hour after a line.
- **The Yesterday line keeps other folders' chapters to their folders.** At a session start
  it names a chapter from another folder by title only when that chapter is about you or me
  and that folder's scope is on, the rule "About me, from another directory" and "Today,
  elsewhere" already keep. Other chapters join the line's count ("and 2 more"); when that is
  all there was, the line says how many sessions wrote chapters in other folders. Chapters
  written in this folder are named as before.

Going back (#384, #382).

- **`counterparts rollback` takes your memory back to before an upgrade.** When an upgrade
  changed the store's format, the older version can't open it. This puts back the copy the
  upgrade made first (the newest one, or `--to` names another), says how many memories would
  be lost, and asks you to type a word. Nothing is deleted: the upgraded store and its cache
  are set aside in a `rollback-aside-…` folder beside it. It refuses while a session, a
  memory server or the dashboard has the store open, and says which. Until you install the
  older version, the newer one leaves the store alone, and its sessions say why. `--undo`
  puts the upgraded store back if nothing has written to the restored one, and
  `--upgrade-again` lets this version upgrade it again from a fresh copy, so rolling back
  twice on one day no longer reuses the first copy. `counterparts doctor` shows a Rollback
  line while a rollback is in place. After a rollback, a later version leaves the store alone
  too, until you run `counterparts rollback --upgrade-again` once on it.
- **A search cache from a newer build says so.** When only the search cache was written by a
  newer Counterparts (after going back to an older version, say), the memory tools no longer
  say "Counterparts was updated — run /mcp", which did not help. They say a newer build wrote
  the search cache: if that build is installed, reconnect; if you went back to an older one,
  delete `cache/cache.sqlite*` in the store (no memory is kept there; it is rebuilt) and then
  reconnect. `counterparts doctor` says the same. A store from a newer build keeps its message.

At ten times today's size (#368, #373).

- **Recall counts the memories instead of listing them on every turn.** At ten times
  today's size that list was about a sixth of a turn. A second speed-up, not looking up
  words found in almost every memory, is built but off: it changed what recall showed on
  small stores.
- **The sleep pass no longer reads forgotten memories to skip them.** The census, the
  duplicate check and the fading pass ask the database for the rows they need instead of
  reading every row, archived ones included. Their counts are unchanged.
- **The store reuses its prepared database statements.** It used to prepare each query
  again on every read. A new day's sleep pass at ten times today's size went from about
  3.7 to 1.1 seconds.
- **A night's dream starts in about a second at ten times today's size, not half a
  minute.** The cache keeps each memory's nearest memories from when it was written, so
  the dream reads them instead of comparing every queued memory against every stored one.
  A new memory's list is the older memories nearest it when it was written; one written
  before the upgrade gets its list the first night it is dreamed. The cache's format goes
  to v6 and fills itself in. An MCP server still running the previous build refuses its
  tools until it is reconnected (`/mcp`), as after a store-format change.
- **New memories in a dream part Claude Code cut go back in the queue.** When the nightly
  run's transcript shows a part of the dream was cut to a preview the run couldn't open
  (and it wasn't fetched again whole), the new memories that part carried are dreamed on
  another night instead of being marked as seen. Any the dream changed or looked up stay
  done. The morning's line about the cut says how many went back.
- **A reader for which memories recall shows and the replies ignore.** `probeMemoryHits`
  reads the ids the credit row already lists as shown and not used, and gives a hit rate
  per memory and per lane (loud, footnote, pointer). It only measures. Nothing reads it
  to change a memory's strength or how readily it comes to mind.

Fixes (#378, #382).

- **Two installs that meet a damaged claims file deliver the event once on Linux too.**
  When one hook moved the damaged file aside, the other, still holding the old file, could
  delete the new file's journal while the first hook was writing to it. That hook then
  gave up on its claim, and the event went out twice (2 of 30 runs of the twins test under
  load). Now a hook that finds its journal gone tries once more, and a claim that was
  already saved when that happened counts as made.
- **Hook claims hold up in three more corners.** A claims file another hook holds is given up
  on after one wait instead of three; a lock dated in the future after the clock steps back
  is treated as a dead process's instead of waited on; and a hook whose own claim landed while
  its write reported a failure delivers the event instead of standing down for itself.
- **A plugin's first run can't be held up from a shared /tmp.** Another user's directory at
  the first-run lock's name made the first run wait 20 seconds and fail; it is passed over
  now, and the install runs.
- **`counterparts self-page --write --short <file>` works.** The spaced form was refused;
  only `--short=<file>` worked, though the help and the page's room note print the spaced
  one. Both forms work now.

## 0.3.16 — 2026-10-10

The self page is kept whole up to 16 KB, and when it doesn't fit, the wake steps down to
something whole instead of cutting it: the page, a short version written with it, an
outline, the headings, or one line saying where to read it. At the default 9,000-byte
ceiling the page's room is now 5,681 bytes (it was 6,078). Dated items come before the
wake's furniture: an "Arriving:" item or a plain reminder due today is listed before the
handoffs, "Last here" and "Work here" take their room, and doctor's Wake line turns amber
when one still goes unlisted. A paused folder says so in one line when a session starts.
Each field of a hook's output is now held to Claude Code's 10,000-character limit on its
own, so a red doctor notice shows beside a full wake. A damaged claims file mends itself,
a late twin of a session's first start stands down, and every `counterparts scope` command
Claude is shown names its folder. The plugin's first-run line is back, and its sidebar
lights every mechanism an event proves. **Nothing to run after upgrading from 0.3.15**:
the hooks, the memory server's registration and Claude Desktop's entry are the same as
0.3.15's (coming from 0.3.14 or earlier, see those versions' notes on `counterparts
connect`). **No change to the store's format (still v12)**: a page's short version is kept
in the page's own record, which 0.3.15 reads past. Going back to 0.3.15 is the order in
QUICKSTART's "Going back to an earlier version": `counterparts disconnect` while 0.3.16 is
still installed, then the 0.3.15 reinstall, then `counterparts connect`.

The self page in the wake (#363).

- **A long self page is kept, not refused, and the wake steps down to something whole.**
  0.3.15 refused a page past 6,078 bytes. Now the page is kept whole up to 16,384 bytes,
  and the wake shows the first of these that fits, each one whole: the page; a short
  version its writer wrote with it; each section's heading and first sentence; the
  headings alone; or one line saying where to read it. Each starts with a line giving the
  page's size and the line it ends with — "if you don't see that line, it was cut off:
  read it whole with the self_page tool or `counterparts self-page`" — and ends with that
  line. The page's room at the default 9,000-byte ceiling is now 5,681 bytes (it was
  6,078; the new top and end lines and the wake's opening line take the difference): a
  page within it always shows whole, even on a day the wake also holds handoffs and
  "Work here" lines, and a longer one still shows whole on most days, borrowing the room
  held for "Work here". The nightly writer, the reflection and the self_page tool are told
  to aim under it and, when a page runs past it, asked for a short version in the same
  call (the tool's new `short`, the console's new `--short <file>`). A short version
  belongs to the page it was written with — a page rewritten without one shows its
  headings and first sentences, never an old short version — and crosses the same checks
  as the page, a reflection's included (no confidential memory's words, no dream marks).
  Adding a short version on its own never undoes a page written in between, and the
  wake's own top and end lines are never stored as part of the page. Doctor's Self page
  line says what the last wake showed: green for the page or its short version, amber
  below, with what to do. Every wake's opening line now also says: if a note says this
  was too large and saved to a file, read that file — which is what Claude Code does with
  a hook's output past 10,000 characters (measured on 2.1.296: the model then sees only
  the first 2,000 characters and is not told to look). Past 16,384 bytes a page is
  refused, never cut. Below a ceiling of about 530 bytes the wake is now larger than its
  ceiling, because of those fixed lines; the default is 9,000.

Dated items first in the wake (#367).

- **Dated items come before the wake's furniture.** A wake could say "Arriving: 1 — no
  room to list them in this wake" while it still printed yesterday's chapter titles and
  four handoffs: the room held for the handoffs and "Last here" was never offered to the
  rest of the wake. Now the wake follows one declared order of what gives way: when an
  "Arriving:" item has no room, "Work here" shows fewer lines first, then the Yesterday
  line swaps titles for chapter ids one at a time, then "Last here" is dropped and fewer
  handoffs are shown in full, the others named by id while there is room for them. The
  newest handoff's own room goes only to a plain reminder due that day; no other line
  can take it. Only then does a dated item go unlisted. An arriving item past the two
  the wake lists is no longer left out silently: the lane's "N more arriving" line names
  it by id, and when even that line has no room, doctor counts it as unlisted. "Still
  open" keeps its first item before Arriving's second line, as before, but now after
  those same lanes give way. A plain reminder due the day the wake is read comes first
  in "Arriving:" (and in the two the wake is offered), and it outranks the self page
  borrowing past its room: the page steps down to its short version or outline rather
  than leave it out. The page within its own room still comes first. Beside a page that
  borrowed, the Yesterday line was sometimes dropped whole; it now keeps its ids. If a
  dated item still goes unlisted, doctor's Wake line says so in amber, with what to do.

Paused folders and the scope commands (#362, #366).

- **A paused folder now says so when a session starts.** With memory paused in a folder
  (`counterparts scope . --pause`, or the sidebar's switch), a new, resumed, cleared or
  compacted session there shows one line naming the paused folder and the command that
  turns it back on, which works from any terminal. If the pause is on a parent folder, the
  line names that folder and the command resumes it there. Claude gets a matching line so
  it doesn't act as if it remembers.
  Nothing else changes: no memories are loaded or recorded, nothing is written, other
  hooks stay silent, and a folder turned `off` stays completely silent.
- **Every `counterparts scope` command Claude is shown now names the folder.** In a
  folder that is off or paused, the memory tools' refusal used to tell Claude to run
  `counterparts scope . --resume`, and the question a new folder gets in its first session
  said `counterparts scope . --on`. The `.` meant wherever the command was run, and from a
  subfolder `--resume` refuses. Now the command names the folder, and when the setting
  belongs to a parent folder it names that one ("paused for ~/work, which includes this
  directory"). Under the plugin it uses the plugin's own launcher, and with a
  configuration other than the default it adds `--config`, as the paused notice does.

The hooks: each output field, the claims file, late twins (#366).

- **A red doctor notice now shows beside a full wake.** Measured on Claude Code 2.1.296:
  the 10,000-character limit applies to each field of a hook's output, not to the output
  as a whole. Counterparts held the whole output to 9,500 characters, so on a morning with
  a full wake the doctor's notice was left out, and plain reminders, the dream question and
  the update notice waited for a later turn. Now each field is held to the limit on its
  own: they show beside a full wake or a full recall, and wait only when Claude's own text
  would pass the limit.
- **A damaged claims file repairs itself.** If `sessions/claims/hook-claims.sqlite`
  can't be read as a database, the next hook moves it aside (one copy is kept) and makes a
  new one, and the event is still delivered. Before, every event printed an error and the
  guard against double delivery stayed off until someone deleted the file. Doctor's new
  amber "Hook claims" line says when it happened, for a week. The claims folder and file
  are now private to you (0700 and 0600), like the log, and the log says why a claim
  could not be made instead of giving only the length of the message.
- **With two installs live, a session's first start runs once even on a busy machine.**
  The 0.3.15 release check found one double wake under load: the second hook started 45
  ms after the first had finished, so its claim read it as a new event. A session's first
  start, and a prompt Claude Code gives an id, are sent only once, so a second copy within
  15 seconds now always steps aside. Doctor's "Installed twice" line no longer says
  nothing was delivered twice; its fix also names `~/.claude/settings.json`.
  A correction to the 0.3.15 notes, which said the claim "works between any two
  versions": the plugin stepping aside is the main guard, and the claim is a backstop. It
  catches a second hook that runs at the same time; for a resumed or compacted session, a
  Stop, or a prompt without an id, one that starts after the first has finished can
  still deliver again on a busy machine.

The plugin (#360, #365).

- **The sidebar lights every mechanism an event proves.** Each event is one row and lights
  every mechanism it proves: a turn where a matching mood brought a memory closer lights
  Emotion beside Retrieval, and a dream that wrote a gist and merged near-copies lights
  Gist, Interference and Consolidation beside Dreaming.
- **A new plugin user is told their memory was set up, again.** In 0.3.15, the
  sidebar's hooks module makes Claude Code start the plugin's SessionStart hook later,
  after the plugin's server has already made the new memory, so the first session
  didn't show "Counterparts: first run — a new memory was set up". Now whichever of the
  two makes the memory leaves a note, and the first session start shows the line once,
  never again after. Beside a live npm install the plugin still stands down and says
  nothing about a first run. Nothing else changes.

## 0.3.15 — 2026-10-10

The self page is never cut in the wake. A page may now be at most 6,078 bytes, which the
wake prints whole at its default 9,000-byte ceiling; a longer one is refused and written
again shorter. A page written before this that is longer still prints whole, borrowing the
room held for "Work here", and doctor's Self page line is amber until the next revision
comes in under the limit. With the plugin and the npm install both connected, each event
runs once. `counterparts connect`, and `install` at a terminal, now rewrite Claude
Desktop's entry too, and doctor's Runtime line reads it. **If you connected Claude Desktop,
quit it and run `counterparts connect` once after upgrading**; until then doctor's Runtime
line is amber. Claude Code's hooks and server registration are the same as 0.3.14's, so
with Claude Code alone there is nothing to run (coming from 0.3.13 or earlier, run
`connect` once, as 0.3.14 said). The Claude Code plugin brings the sidebar mod (v0.1).
**No change to the store's format (still v12)**: the hooks keep their claims in a small
file of their own, `sessions/claims/hook-claims.sqlite`, which 0.3.14 leaves alone. Going
back to 0.3.14 is the order in QUICKSTART's "Going back to an earlier version":
`counterparts disconnect` while 0.3.15 is still installed, then the 0.3.14 reinstall, then
`counterparts connect`. The hook and server commands are the same in both versions, and
Claude Desktop's rewritten entry runs on 0.3.14 as it is.

The self page in the wake (#358).

- **The self page is never cut in the wake.** The page may now be at most 6,078 bytes,
  which is exactly what the wake prints whole at the default 9,000-byte ceiling, even on
  a day the wake also holds room for handoffs and "Work here" lines. Before, a page could
  be written up to 16,384 bytes and the wake showed only its first 6,078 to 6,144, cut
  with a marker. A longer page is refused, never cut: the self_page tool, the console and
  the nightly reflection say the limit and how many bytes to take out, and the writer
  says it shorter. The limit is in bytes, so accented letters, dashes and CJK count for
  more than one. A page written before this that is over the limit still prints whole
  when it fits with the room held for "Work here" lent to it (at 9,000, a page of about
  7,200 bytes fits even on the tightest day), and doctor's Self page line goes amber until the next revision comes in under
  the limit. Only a page that doesn't fit even then, or a ceiling set below what the page
  needs, gets one line instead, pointing to the self_page tool or `counterparts
  self-page` — never part of the page. If the nightly writer's page is refused as too
  long and the run moves on without sending it again shorter, that night now reads as
  failed, with the numbers, instead of "nothing to say". And "Still open" keeps its
  "N more" count beside its first item when a long page leaves no other room for it.

Claude Desktop's entry, and the way back (#354, #356).

- **`counterparts connect` now fixes Claude Desktop's entry too.** 0.3.14 told Bun to
  skip a project's `.env` and `bunfig.toml`, and `connect` rewrote the hooks and Claude
  Code's server registration to match. It left alone the entry that
  `install --host claude-desktop` puts in Claude Desktop's own config file. Now `connect`
  rewrites that entry as well: only the command that starts the server changes, and the
  store it names stays the same. Desktop rewrites that file while it's open, so with
  Desktop running `connect` leaves the entry as it was and asks you to quit Desktop and
  run `connect` again. Doctor's Runtime line now reads Desktop's entry too, and stays
  amber until it's done.
- **`counterparts install` at a terminal fixes Claude Desktop's entry the same way.**
  Running `install` again after an upgrade now rewrites Desktop's entry as `connect`
  does: only the command changes, a backup is kept, and nothing is written while Desktop
  is open. Its last line no longer promises a green doctor while Desktop's entry is left
  as it was. The scripted install (`--no-connect`, or not at a terminal) still reads no
  host file.
- **Going back to an earlier version is in the quickstart** ("Going back to an earlier
  version"): `disconnect` first, then the reinstall, then `connect`, and
  `install --host claude-desktop` again if you use Claude Desktop. Done in the other
  order, every hook breaks and the older version's doctor still reads green.

One delivery per event when two wirings are live (#355, #359).

- **With the plugin and the npm install both connected, each event now runs once.**
  The plugin is meant to step aside when the npm install's hooks are in your settings.
  A plugin from before 0.3.14 didn't recognise the hook lines 0.3.14's `connect` writes,
  so it didn't step aside, and every session got two wakes and two recall blocks per
  prompt. The plugin now recognises our hook by the script it runs, whatever flags a
  later version adds around it. As a backstop, each hook claims its event first: when
  two Counterparts hooks fire for the same event, the first does the work (the wake,
  the recall, the Stop's question, the capture, the background worker) and the other
  exits without output. This works between any two versions from this one on. The
  claims are kept in a small file of their own in the store's `sessions` folder, so
  the background worker writing to the store doesn't hold a claim up. With one install
  nothing changes; the claim adds two small writes per event, about a third of a
  millisecond.
  Doctor has a new amber line, "Installed twice", when a hook stepped aside this way in
  the last week, and says how to keep just one install. No change to the store's format.

Recall (#356).

- **Facts recall reads "by 1/5" asked in late December as the coming January.** A date
  with no year after "by", "until" or "before" now takes whichever year puts it nearest
  today: "by 1/5" asked on 12-28 runs through next year's January 5, where it ran through
  this year's and left out the year since. "Until Dec 30" asked on January 3 is still the
  one four days back. Asked in early October, "by 1/5" and "finish by 1/2" now mean the
  coming January too. "Since" and "after" still reach back to the last time the date came
  round.

The plugin's sidebar (#342).

- **The sidebar mod (v0.1), inside the Claude Code plugin.** In Claude Code's fullscreen
  layout, a pane beside the transcript shows the brain turning in braille, the twelve
  mechanisms, search, and what this session kept and recalled (with the night's dreams and
  fading, and other sessions folded into one line). It also has two switches,
  "Counterparts memory · this folder" and "Claude Code's own memory". Pausing Counterparts
  asks first; a folder paused for every session shows it in amber in the pane and says so
  in the status line; a state the sidebar hasn't read yet never shows as on. `‹` makes it
  quiet (narrow, nothing moving); its `✕` hides it to one status line; `/counterparts`
  opens it anywhere. Beside an npm install, a plugin run from a folder
  (`claude --plugin-dir`) now says that is expected, instead of suggesting
  `counterparts disconnect`, and the plugin's `/counterparts:doctor` shows the npm
  install's own doctor.

## 0.3.14 — 2026-10-09

The Claude Code plugin now runs on a Mac or Linux computer with neither Bun nor Node.js:
it downloads one prebuilt Counterparts program for that computer from this version's GitHub
release, checked against a sha256 the plugin carries. A project's `.env` and `bunfig.toml`
no longer reach into the hooks, the memory server or the `counterparts` command. **If you
installed through npm, run `counterparts connect` once after upgrading** to rewrite the
hooks and the server registration; until then doctor's Runtime line is amber. The wake keeps
the first "Still open" item beside a long self page and says when a reminder was due. Facts
recall names corrected memories with an id to open and reads amounts as amounts, meaning
recall says when the person asked about has no card, and the dashboard dates everything in
the configured zone. **No change to the store's format (still v12).** Going back to 0.3.13
takes three steps, in this order: `counterparts disconnect` while 0.3.14 is still installed,
then the 0.3.13 reinstall, then `counterparts connect`. 0.3.14's hook and server commands
name a file 0.3.13 doesn't ship, and 0.3.13's `connect` doesn't recognise them, so it would
add its own beside them.

A project's `.env` and `bunfig.toml` stay out (#349).

- **A project's `.env` and `bunfig.toml` no longer reach into Counterparts.** Bun reads
  both from the folder it starts in, and Claude Code starts the hooks and the memory
  server in your project. So a project whose `.env` set `COUNTERPARTS_DATA_DIR` or
  `COUNTERPARTS_CONFIG` could send the plugin's server, an npm install's hooks or the
  `counterparts` command to a different store, and a `bunfig.toml` with a `preload`
  ran its own code inside them. Every place Counterparts starts Bun now passes
  `--no-env-file` and `--config=` pointing at an empty bunfig in the package: the hook
  and server commands `install` and `connect` write, the plugin's launcher, the
  installed commands, and the workers and nightly run it starts itself. Node reads
  neither on its own. **If you installed through npm, run `counterparts connect`
  once** to rewrite your hooks and server registration. Until you do, doctor's Runtime
  line is amber and says so. Plugin users get the change when the plugin updates.

The plugin on a computer with no Bun or Node (#351).

- **The plugin works on a Mac or Linux computer with no Bun or Node.js.** Until now it
  gave up there. Now it downloads one prebuilt Counterparts program for that computer
  (55–75 MB, over HTTPS, from this repository's GitHub releases), checks it against a
  sha256 that ships inside the plugin, keeps it in the plugin's data folder, and runs
  that. It re-checks the kept program too: the whole file each time the memory server
  starts, and a quick stamp of it at every hook; one that changed is deleted and fetched
  again. Windows isn't offered a program yet; there, the plugin still says to install
  Bun or Node. The first session says it's getting ready and that memory starts in the
  next one. A failed download says so once and tries again later; nothing unchecked is
  ever run. `COUNTERPARTS_BINARY_DOWNLOAD=off` forbids the download. The program is the
  whole of Counterparts, with the model and the dashboard packed in. It starts a little
  faster than `bun` (a prompt's hook takes about 86 ms vs. about 102 ms). It won't wire
  Claude Code or Claude Desktop itself: `counterparts connect` from it says to use the
  npm install for that. How it is built and released: `docs/single-binary.md`.

The wake (#350).

- **"Still open" lists its first item beside a long self page, and never prints a heading
  over a count.** With a long page, the Yesterday line and the Arriving lines taking the
  room, a 9,000-byte wake could print "Still open:" with only "(20 more still open; recall
  ids …)" under it. The self page is still never cut for this: it prints whole up to its
  cap, as before. Instead "Still open" keeps its first item and its count, and the room
  comes, in order, from the "Work here" lines (fewer of them that morning), Arriving past
  its first line, and the Yesterday line's titles (fewer named, the rest counted). A lane
  that still has room for nothing says so in one line: "Still open: 20 — no room to list
  them in this wake; recall ids …".
- **An Arriving reminder past its date says it was due.** A one-off reminder stays under
  "Arriving:" for a week after its date, and the wake written the evening before is read
  the next morning, so "(due 2026-10-08)" was read on the 9th as if still to come. The
  line now reads "(was due yesterday, 2026-10-08)" the morning after and "(was due
  2026-10-05)" later. A reminder due on the day it was noted now reads "due 2026-10-08"
  rather than the date alone.
- **A plain reminder said on its day leaves "Arriving:" at the next turn.** When the
  day's wake was written before the reminder was said (a session running past midnight),
  it stayed under "Arriving:" all day and into the next morning.

Recall (#345, #347, #348, #352).

- **Facts recall no longer reads an amount as a date, or "since 10/25" as an empty
  window.** "7-8 hours", "3/4 cup", "5-10%" and "$5-10" were read as dates (July 8, March
  4, May 10) and filtered the answer to them; they are amounts now, and a date later in
  the question is still read. "Cut it by 1/2" or "reduced to 1/3" is a fraction, not a
  deadline of January 2; "finish by 1/2" still is one. And "since 10/25" or "after 10/25"
  asked before the 25th of this month means last year's 10/25, where it gave nothing (or
  only what is still to come). "Before", "until" and "by" a coming day keep this year's.
  "2-3 weeks ago" and "3 or 4 days ago" cover both ends, where only the far one was read,
  and a zero-padded "09-28" stays a date whatever word follows it.
  Questions with no time in them answer exactly as before.
- **Facts recall reads "by 12/20" asked in October as this year's December 20th.** A
  date with no year under "by", "until", "up to" or "before", in a month that has not
  begun yet, was read as last year's: "what's due by 12/20" asked on 10-09 kept only what
  happened through 2025-12-20 and hid the ten months since. It is now this year's
  whenever that is the nearer of the two, so those months are no longer cut off.
  "Until Dec 30" asked on January 3rd is still the one four days back, and "since" and
  "after" still reach back to last year's date as before.
- **Facts recall now names corrected memories, so they can be opened.** A memory
  settled as corrected (it was wrong) is never offered as a fact. Facts answers used to
  say only "1 corrected version hidden" under the memory that corrected it, with no way
  to reach it, even when the question named it. If the correction itself pointed at the
  wrong memory, a true memory became unreachable. Each one now gets a line under the
  memory that corrected it, marked as wrong, with its id:
  `corrected (was wrong): "…" (learned 09-10), corrected 09-11 · mem_…`. Opening that id
  with `recall` shows the whole memory and which memory corrected it. Up to three are
  named, the ones the question's words reach first, and any more are counted. The
  dashboard's Ask shows them the same way, with links. Answers that have no corrected
  versions are unchanged.
- **Meaning recall says when the person you asked about has no card.** "What has Han
  been to Mike?" on a store where only Mike has a card used to come back as Mike's story
  with no word about Han. Now the answer opens with "No card for Han yet; here is what
  mentions Han", follows the memories that name Han, and lists Mike's card as one to ask
  about. If nothing mentions Han, it says that instead. The name leads only when every
  card the question names is mentioned in passing ("been to Mike", "since Driftwood").
  When a card is asked about or named plainly ("how have Han and Oskar been?", "what did
  Oskar say about Han?"), the answer follows that card as before and opens by saying Han
  has none. The dashboard's Ask shows the same first line.
  A question that names no card at all ("what has Han been up to?") is answered as
  before, by its words and meaning. A first name of a card's longer name ("Marguerite"
  for Marguerite Solberg), an acronym ("API", "Q3") and a question typed in Title Case
  are never taken for a name with no card.

The dashboard, doctor and the tool descriptions (#343, #346, #347, #352).

- **The dashboard no longer says a repeating reminder is about to be put away.** A memory
  whose date still repeats is kept for its next time however faint it has grown, so the
  memories list no longer marks it "fading" and its card names no day it would be put
  away. The row says how often it comes round instead ("repeats every May 14"), and the
  card says "It comes round every May 14, so I'll keep it while it does." A protected
  memory's card no longer names such a day either, since the nightly cleanup never lets
  one go: it says "It's protected, so I'll keep it even if nobody uses it."
- **The dashboard dates everything in the zone the hooks use.** With a `timeZone` in the
  configuration that differs from the computer's, the dashboard used the computer's zone
  and the browser's own, so one page could show two days for one moment: a memory's
  "recorded" chip on one, its "Written" line on the next. The dashboard now reads the
  configuration's `timeZone` (the named one, else the one beside the store), every view
  dates in it, and the card's "Written" day and the Health cycle line come from the
  server already dated. The card's details row names that zone ("Sep 28th, 2026, 11:47
  MDT") instead of printing UTC, and the Flow page's fired footer names it instead of a
  stale "(UTC)". Without a `timeZone` set, nothing changes.
- **Doctor's prune line no longer reads BLOCKED over protected memories it was keeping
  anyway.** The nightly cleanup counted every protected memory (the self page is one) as
  a refusal every night, even when it was nowhere near being let go, and did the same for
  a memory in the middle of being corrected. It now counts `protected` and
  `in-live-revision-chain` only where that is what kept the memory, as it already did for
  `recurring`. Nothing is cleaned up differently.
- **Doctor counts held corrections.** When a new memory says it changes or corrects one
  that doesn't look related, the old one is left alone and the hold is recorded (0.3.13).
  Doctor's Contradictions line now says how many were held in the last 7 lived days and
  how many were settled by hand since ("2 corrections held because they didn't look
  related to the memory they named, 1 settled by hand since; if the other was meant,
  settle it with counterparts settle, which lists it"). It stays green. `counterparts
  settle` lists the ones still held, each with the command that settles it.
- **Three more reads keep the newest rows.** Past the number of rows each reads,
  `counterparts settle` (and doctor's held-corrections count) took the newest held
  corrections for never settled, and the self tab's page history left its newest
  versions and days undated. They read the newest now. Below those limits nothing
  changes.
- **Tool descriptions put how to call each tool first.** Claude Code shows the model only
  the first 2,048 characters of a tool's description when the tool is loaded up front:
  with tool search off, behind a custom base URL or proxy, or on a model without tool
  search. Seven of the nine descriptions are longer than that. Each tool's purpose, when
  to call it and every "Do NOT" were already inside that first part. The cut fell in
  the list of guarantees, so `note`, `recall`, `session_end` and `reflect` now lead
  that list with the claims about how to call them: which fields are fields, that a
  question needs a mode, that an empty `memories` is an answer. No wording changed, and
  nothing behaves differently.

## 0.3.13 — 2026-10-09

A dated memory can now repeat (daily, weekly, monthly or yearly), and a reminder that
repeats stays alive by coming round. A memory that says it corrects an unrelated one is held
instead of fading it. Facts recall reads "last Saturday" and "before 7/22" as meant, meaning
recall answers about the person you asked about, and the dashboard's Ask speaks both modes.
Doctor stops raising false alarms: the Fired line knows mechanisms that only wait or run
once, the Wake line no longer counts unchecked wakes as lost, and the nightly run now reads
its own transcript for Claude Code's cut. Counterparts can also be installed as a Claude Code
plugin. **No change to the store's format (still v12):** going back to 0.3.12 is a plain
reinstall, and there a repeating date reads as a one-off date that has passed.

Dates that repeat, and corrections that are held (#339, #340, #341).

- **Dates can repeat.** A dated memory can now say `recurring`: `daily`, `weekly`,
  `monthly` or `yearly`, counted from its date. A birthday saved as 1990-05-14 with
  `yearly` comes back every May 14 — a plain one is said on the day each year, once, and
  a quiet one can surface around it each year, at most twice. The wake's Arriving line
  and recall's open items show it beside the date: "due 2026-10-12, every Monday" (a
  daily one takes no Arriving line; it's every day, not arriving). Monthly on the 29th,
  30th or 31st falls on the last day of a shorter month, and yearly on February 29 falls
  on February 28 in other years. Only a single day can repeat (not a month or a range);
  every other week and "the first Monday" aren't supported. Revising the memory keeps
  the repeat unless you say otherwise, and never repeats a reminder already given that
  day. No change to the store's format.
- **A repeating reminder is no longer lost between its dates.** Each time a repeat
  comes due and is actually said or surfaced counts as a use of the memory, once per
  date, the way going over something keeps it fresh. A daily pill reminder or a weekly
  one now stays as strong as it was. A yearly one is used only once a year, which isn't
  enough to stay above the floor, so the nightly cleanup no longer lets go of a memory
  whose date still repeats (it is listed as `recurring` beside `protected` when that is
  what kept it). It may still fade in between, as before, but a reminder that still
  repeats comes round on its date even when it has faded: a quiet yearly one is still
  surfaced, and a plain one is still said. One-off dates are unchanged, and a reminder
  whose repeat you drop fades and is cleaned up like any other memory.
- **A memory can no longer fade or retire an unrelated one by mistake.** When a new memory
  says it changes or corrects an older one (`updates` with `how: changed` or `corrected`),
  Counterparts now checks the two are about the same thing first: by meaning, through the
  local embeddings, or by shared words when there are none. If they look unrelated, the
  new memory is stored but the old one is left as it was and the two are not linked. The
  reply shows the old memory's title and text and asks the model to settle it itself with
  `note` if it really meant the correction. In a benchmark with a smaller model, about two
  thirds of these pointers named the wrong memory (one about a mole removal retired a
  passport name change); on Opus they were right. Closing an open thread, moving or
  dropping a reminder's date, and changing a status still go straight through, however
  short the note. A write-up or the nightly catch-up has nobody to read the reply, so
  there the old memory simply stays. Each hold is recorded; the dashboard's flow shows
  them.

Recall and the dashboard's Ask (#329, #333, #334, #335, #338).

- **Facts recall reads "last Saturday" and "before 7/22" the way you mean them.** "Last
  Saturday" (any weekday, or "this past Saturday") was read as no time at all; it is now
  the most recent Saturday before today, so asked on a Saturday it is the one a week ago.
  "Before 7/22" kept only 07-22 itself; now it keeps every day before it, "after 7/22"
  every day after it, and "until 7/22" or "by 7/22" every day through it; when the date
  names something on that day ("before the 7/22 flight"), that day stays in. "Since 7/22" is
  unchanged: from that day to today. The same goes for `2023-07-22`, `7/22`, "July 22" and
  `7/22/2023`, and a year written with the date (`7/22/2023`, "July 22, 2023") is now the
  year used; it was ignored before. "This Saturday" and "on Saturday" are still not read,
  since either can mean the coming one.
- **Recall by meaning answers about the person you asked about.** A question naming two
  people, or you and someone else, was answered about whichever had more memories, which
  is usually you: "what has Ilya been to Mike" through the `recall` tool came back as
  Mike's story, with Ilya listed underneath. It now goes by how the question is worded and
  the order of the names ("what has Ilya been to Mike" is Ilya's; "how has Ilya changed
  since Nkechi arrived" is Ilya's). When two are asked about alike ("tell me about Ilya and
  Nkechi") it follows the first and says so. And "what have I been like" or "how have I
  changed", asked by meaning on the dashboard, finds your own card again.
- **The dashboard's Ask reads 0.3.12's answers.** After recall took a mode, the Memories
  page kept reading the old answer, so most dates, the "strong match" words and the "from
  chapter" links vanished, and "by meaning" got a facts answer. The switch beside the box
  now has three ways: **by word** (as you type, as before), **facts** (every memory that
  answers the question, counted and paged, each saying who said it, when it happened or was
  learned, and what it was before it changed) and **by meaning** (the chapters that hold a
  person, a project or a feeling, in time order, with their moments and whose feelings
  they were). The match-strength words are gone, as recall has none now.
- **`counterparts ask --mode meaning`** answers in meaning mode, as the `recall` tool's
  `mode: "meaning"` does; facts stays the default. `--page` pages either.
- **A memory id written inside a memory's words is a link.** On the Memories page,
  "(mem_cb6eea7a6b9f)" shows as "memory ↗" and opens that memory; a chapter's address
  opens its journal.
- **A chapter's memory keeps its links when the chapter grows.** Each journal chapter is
  also kept as an ordinary memory, and when the chapter grows that memory is rebuilt and
  the old one archived. The links the old one had learned (to what was written beside it,
  what was used with it, what a dream tied it to) stayed on the archived row, where they do
  nothing: about a quarter of the links in one real store. The rebuilt memory now inherits
  them, the way a dream's merged memory inherits its originals'. Links already left behind
  are carried over once, the first time the store is opened after the update.
- **Recall now records what it showed that no reply used.** At the end of each answer, the
  credit check now also notes which of the memories recall showed since the last check the
  reply neither opened nor quoted, by kind of showing (shown in full, a footnote, a pointer
  reached through links). Each showing is counted once. `counterparts probe-oq4` prints the
  resulting hit rate. This only measures: nothing is strengthened, weakened or ranked
  differently because of it.
- **A memory's card in the dashboard says the day it was written on your calendar.** "Written
  …" used the UTC date, so in Denver anything written in the evening showed the next day, and
  east of UTC anything written early in the morning showed the day before. It now uses this
  computer's date, the same day as the card's "recorded" line.

Doctor, and the nightly run (#325, #330, #337).

- **Doctor's Fired line no longer turns amber over a mechanism that simply had nothing to
  do.** Some mechanisms fire only when something happens: a reminder falls due, you erase,
  export or un-merge a memory, or something fails. One, the check after the v8 upgrade,
  runs only once. `counterparts mechanisms --all` now lists the first kind as **waiting**
  and a one-time job that ran as **done**, instead of "gone quiet" or "never fired", and
  doctor counts them the same way. One silence is still a fault: a reminder you marked
  plain that fell due on a day you used Claude Code and was not said. That turns the line
  amber, and the short `counterparts mechanisms` view says so on its Prospective line.
- **Doctor's Wake line no longer reports wakes as lost that were never checked.** Since
  about 09-25 Claude Code writes a session's transcript only after the first prompt, which
  is when the check read it, so nearly every session said its wake was "not found in the
  transcript". The check now waits: if the file is not there yet it reads again at the next
  prompt or when the first answer ends. Rows already in the store from before say "not
  checked (no transcript to read)" and are left out of "N of M arrived whole", and the
  dashboard no longer shows them in orange. A transcript still missing when the first answer
  ends, or one that could not be read, is named on its own.
- **The nightly run notices if Claude Code cut what it was handed.** Counterparts keeps every
  tool result under 40,000 characters, under Claude Code's limit of 50,000 — but Claude Code
  can lower that limit on its own, and a result past it reaches the model as a short preview.
  After each nightly run, Counterparts now reads that run's own transcript for Claude Code's
  marker on its tool results. If it finds one, doctor's Tool results line turns amber and
  says which result and how large, and the next morning your session tells you plainly that
  last night's run read only part of what it was handed. Memories that merely quote the
  marker are not counted. Doctor's green line also says whether the last night's transcript
  was found and read.
- **A reflection handed its bundle in parts is told, first thing, to read every part before
  it writes.** One finished without its second part during the 0.3.12 release check.
- **Doctor's Reflection line counts "returns this week" from your local midnight**, not
  UTC's. West of UTC it counted returns from the evening before the week; far to the east
  it missed the first hours of the week.
- **With `CLAUDE_CONFIG_DIR` set, `connect`, `install` and doctor use the settings file
  Claude Code actually reads**, `$CLAUDE_CONFIG_DIR/settings.json`. They used
  `$CLAUDE_CONFIG_DIR/.claude/settings.json`, which Claude Code never opens, so the hooks
  never ran while doctor, reading the same file, said they were connected. `install` also
  now recognises Claude Code from that directory. Nothing changes if you don't set the
  variable. If you do and ran `connect` before, run it again; the stray
  `.claude/settings.json` inside that directory can be deleted.

The wake, export and connect (#331, #332).

- **A plan changed after a handoff is shown with it.** When a session left a handoff and
  later wrote a note or a `session_end` memory that changed the plan (status `planned`,
  `proposed` or `asked`, or marked `unresolved`), the next session in that directory saw
  only the handoff. The handoff now has a "Since this handoff:" line under it naming up to
  three such memories by title and id, newest first, from any session working in that
  directory, including the one that wrote the handoff. Memories written in the same answer
  as the handoff are left out, and a memory named there is not repeated in "Work here"; an
  open question the wake already lists under "Still open:" is left to that list. When the
  wake has no room for the line, the handoff is shown as before.
- **The self page no longer prints "Last revised" twice.** A page that carried its own
  "(Last revised …)" line showed it under the wake's own date line. The wake now leaves the
  page's line out, and so does writing the page, so a stored page loses it the next time it
  is revised. Only a line that is a date goes: prose, a list entry, a quote, a code block or
  a page's own history that begins with the same words stays.
- **`counterparts export --markdown` now includes your dreams and reflections.** Each dream
  is a file under `dreams/`, by date: its journal and every change it made, undone ones
  marked. Each reflection is a file under `reflections/`: what it was asked, what it wrote,
  and its morning share and whether it was told. The README at the top of the export
  counts both. A dream or reflection that touched a memory you have since marked
  confidential is left out unless you pass `--include-confidential`, and the export says
  how many.
- **`connect` no longer calls every running memory server "the previous version".** It used
  to count every one on the machine as out of date, including your own sessions on the
  version you just installed and the session you typed the command into. Now it checks the
  version each server recorded. It says how many still run an older version (and which),
  how many already run this one, and how many it can't place, for example a server for
  another store. When it can tell, it names the session you ran it from.

The Claude Code plugin (#328).

- **Counterparts can be installed as a Claude Code plugin.** `/plugin marketplace add
  mlapeter/counterparts`, then `/plugin install counterparts@counterparts`. The first session
  sets up the memory in `~/.counterparts`, where the npm install keeps it, with no terminal
  step and no edit to `settings.json`; `/counterparts:doctor` runs doctor. It needs Bun 1.3+
  or Node 22.15+ on the computer. The marketplace names this release's tag, so a plugin
  install only ever gets a released version. If the npm install's hooks or server are wired
  too, the plugin stands down and says so once: `counterparts disconnect` moves you to the
  plugin, `counterparts install` moves you back, and the memories are the same either way.
  Doctor recognises the plugin. The plugin's tools are named
  `mcp__plugin_counterparts_counterparts__…`, so a permission rule written for
  `mcp__counterparts__…` doesn't match them. Nothing changes for an npm install.

## 0.3.12 — 2026-10-08

`recall` now asks which kind of question it is. Facts mode answers with every match,
counted and paged, each fact saying who said it, when it happened and whether it still
holds; meaning mode lays out a person's, a project's or a feeling's arc across chapters.
Memories record when the thing happened, who said it and what kind of thing it is, and
are linked to the people and projects they name. The nightly run reads its whole bundle
again (every tool result stays under 40,000 characters), and doctor checks what reached
the model, not only what ran. **The store's format changes (v11 → v12).** The first
process that writes to the store after the install copies it to
`snapshots/<time>-pre-migration-v11-to-v12` and then upgrades it; 0.3.11 cannot open a
v12 store, so going back to 0.3.11 means putting that copy back, and what was remembered
since is lost.

Deliberate recall: two modes, and what a memory records (#321, #322, #323).

- **`recall` asks which kind of question it is.** A question now needs `mode`: `facts` (what
  happened, who said it, when, and whether it still holds) or `meaning` (how something went
  and what it adds up to). There is no default; a question without one is refused with the
  two modes named. `ids` and `handle` are unchanged and take no mode, and `ids` / `handle`
  now also read one chapter by its address, `epi_…#2`. The vivid / quiet / dim tiers are
  gone.
- **Facts mode answers with every match.** It considers every memory the question's words
  reach, every memory about a person or project it names, and the 100 closest by meaning,
  and ranks them by how strongly and how many ways they matched. The answer opens with a
  count (`12 match · showing 10 · 2 more → page 2`) and pages with `page: 2`. Each fact says
  who said it, what kind of thing it is, when it happened and when it was learned, and whether
  it is current, with earlier versions folded under it. A time in the question ("last week",
  "in September", "around the cut-over", "where did we leave off") keeps only what is inside
  it and counts the rest. Memories that faded from long disuse are listed after the results.
  Quoting the words of a fact it showed you now counts as using that memory, as opening it by
  id does. `counterparts ask` answers in facts mode too; `--full` prints the whole answer.
- **Meaning mode lays out an arc.** Asked about a person, a project or "us", or about a
  feeling, it shows the chapters that hold the subject in time order, the feelings in each
  with whose they are, earlier readings from dreams and reflections, and what is still open,
  for you to read what it adds up to. Faded means the same in both modes.
- **Memories record when it happened, who said it, and what kind of thing it is (schema
  v12).** `note`, each `session_end` entry (write-ups included) and a dream's gist take three
  optional fields: `occurredOn` (a day, month, range or year — resolve "last week" to a date
  while you know it), `saidBy` (owner, self, inferred) and `status` (done, planned, proposed,
  asked). One that cannot be read is dropped and said beside the memory, which is stored all
  the same; revising a memory by its id carries them over unless new ones are sent. Facts mode
  reads them (above); old memories say "speaker unknown", and doctor's new `Write fields` line says how
  often each one is filled. The upgrade copies the store first, as every upgrade does; old
  memories keep empty fields.
- **Memories are linked to the people and projects they name.** Each memory is linked at its
  write to the entity cards its words name, a new card links the memories already naming it,
  and the memories from before the upgrade are linked once at the first open after it. Both
  recall modes read the links; a possessive ("Han's") names the card too.
- **A chapter has an address.** `epi_…#2` names the second chapter of an episode and resolves
  to its heading, its text, the stretch it wrote up and the memories its session wrote in that
  stretch. Chapters now record the moment they were written. Meaning mode names chapters this
  way, and `recall` with `ids` or `handle` opens one.

Follow-ups from 0.3.11 (#318, #319).

- **`docs/HANDOFF.md` is no longer in the repository.** The note one session leaves for the
  next is written locally and ignored; its history stays.
- **The wake is rebuilt after an install.** Until now the first wakes after an upgrade were
  the ones the old version composed, until the next write-up or nightly run, so a question
  the new version closes stayed in "Still open". Now the first turn-end after an install
  re-renders it: the session that was open during the install wakes once more with the old
  wake, and every session after it with the new.
- **A memory server left open across an install says so.** Every tool result, not only
  Desktop's wake, now carries a line saying Counterparts was updated and how to reconnect,
  because until then the server ignores anything newer, such as a field added to a tool. This
  starts with the servers of this version; one from before it says nothing.
- **Your own Claude Code sessions are the owner's in the memory tools too.** The hooks already
  were; the memory server was not, so closing an open question from another directory was
  refused while the wake dropped it from "Still open" anyway. Now the server Claude Code starts
  takes the install's `"owner": true`, and so does a Claude Code session from Desktop's Code
  tab: it can close a question opened anywhere, and confidential memories are said in its
  answers. A dream's and a reflection's bundles still leave confidential memories out, on
  every server. A Desktop chat is unchanged, the nightly run keeps its old stance, and
  `COUNTERPARTS_OWNER=0` on the server's launch turns it off. A close that is still refused
  now leaves the question in "Still open". Nothing to reinstall: it takes effect on upgrade,
  once the memory server reconnects.
- **"Work here" takes turns.** When a directory has more work than the wake shows, the newest
  line stays first and the others rotate from one day to the next, so the older work comes
  round too. A wake that had more work lines than it carried leaves a record, which doctor
  and the dashboard's wake bar read.
- **Doctor sees what a session start could not carry.** A hook's output past Claude Code's
  10,000-character cap, a session start over its reported ceiling, a notice dropped to make
  room, a part that waited for room, and a handoff or "Last here" line with no room are now
  recorded and read on the Wake line; the first two turn it amber. The Reflection line says
  how long a share has been waiting to be told.
- **Claude Desktop: wake first, and Always allow.** A Desktop chat whose tools still asked
  permission never called `wake`, answered "what do you remember about yesterday" from a
  search alone, and called that the full record. The install, the quickstart, the help and
  doctor's Claude Desktop line now say to set the counterparts tools to Always allow; the
  server's instructions and the `wake` tool tell the model to wake first in every new chat
  and never to present a search as the complete record.
- **Doctor's Spawn line sees a step that failed two days running.** It read only today's
  failures, so "the same step failed today and yesterday" could never be said.

The night run's bundles, and what reached the model (#315).

- **The nightly run reads its whole bundle again.** Claude Code does not hand a tool result
  over 50,000 characters to the model: it saves it to a file and shows a 2 KB preview, and the
  headless run cannot open the file. On the nights of 10-01 and 10-02 the dream's first part
  and its second, and the reflection's first, went that way, so the dream read about a third
  of what it was given. Every tool result is now kept under 40,000 characters: the dream and
  the reflection come in more, smaller parts, and the page writer's day shrinks to fit beside
  the page. A result that would still be too long is cut there, with a note saying so to the
  model, instead of vanishing.
- **Doctor checks what reached the model, not only what ran.** A new Tool results line goes
  amber when a result was cut to fit, or when a dream or reflection finished without reading
  a part it was handed. A new Wake line goes amber when a session's wake arrived cut short.
  The Spawn line goes amber when the background worker failed after it last started, or the
  same step failed two days running, and the Self page line says when the wake shows only the
  start of a long page.

Feelings, round 3 (#317).

- **The nightly reflection sees how feelings ran over the last four weeks.** Its bundle now
  carries a short pattern, a few hundred characters: how many feelings of each kind were
  recorded each week, mine and the owner's apart, what changed over the last two weeks, and
  the memories that pattern rests on, so it can cite them. It is counted from the recorded
  feelings, not from the text. It may say the pattern on the self page in its own words,
  citing those memories.
- **A memory can be felt again during a session.** When an old memory comes up and feels
  different now, `note` takes `feelingsNow`, with or without text. It records how the memory
  feels now beside the original feeling, which stays, the same way the nightly reflection
  does. It works only on a memory this session was shown, at most once a day per memory. The
  feeling is marked as recorded later, while awake. The core counts it only when it would
  count a feeling a reflection recorded later. Doctor's Reflection line says how many there
  are in all, how many are strong enough for the core's fast lane, and how many are the
  owner's. A memory such a feeling carries to the core is said apart from one a reflection's
  feeling carried ("became core on a feeling recorded looking back in a session"), and the
  morning share names only a reflection's.
- **The reflection is offered unmarked memories to mark.** A fact written in a project with
  no "about" mark counts as that project's work. So a personal one, like a note about a
  person, showed under "Work here". Each night the reflection is now offered up to five
  memories nobody has marked. Those with a feeling, an entity, or the owner's name come
  first, then the most used, then the oldest. It is asked to mark each as owner, us, work or
  world. A mark the writer set is never offered to be changed.
- **Fixed: a dream's merge no longer re-dates feelings.** Every feeling a merge carried used
  to be dated to the merge night. Each now keeps the moment it was first recorded, as trait
  nudges already did. A merge no longer sets the next morning's mood either.
- **Fixed: "fear" in a question now reaches scared and frightened, not only afraid.** A word
  the wheel reads as an alias (fear, thankful, touched) now counts as its wheel word.

## 0.3.11 — 2026-10-01

The nightly run now writes up the sessions that ended before they were written up, in
any directory, before it writes the page, and the wake gets a dated "Yesterday" line.
The wake splits work from personal: "Work here" lists the work done in the directory the
session opens in, and Nearby keeps what is personal, so a session in one project no
longer wakes to another project's plumbing. Counterparts runs under Node 22.15 or newer,
and on Linux. Claude Desktop's Code tab files its memories under its own session again,
asking by feeling finds more of what was felt, and the wake says when a handoff may be
out of date. **The store's format does not change** (still v11): nothing is upgraded and
no pre-migration copy is taken, and 0.3.10 can open a store 0.3.11 has used.

The morning catch-up and the "Yesterday" line (#308).

- **The nightly run writes up what was left unwritten, in any directory, before it
  writes the page.** Until now a conversation that ended before it was written up waited
  for the next session opened in the same directory, and a project nobody reopened within
  two days of use simply let it lapse. Now, when the day's first prompt starts the
  nightly run (dreaming `auto`), a short `claude -p` of its own goes first: it is allowed
  one tool (`session_end`), and it writes up at most 4 sessions or about 96 KB of their
  words a night, oldest first. What it leaves stays owed, for another night or a session
  in its directory. It costs one more `claude -p` start on a night with something owed,
  and nothing on a night without. That run can only write up: it can't write memories
  of its own, notes, chapters or handoffs. A run that stops early (a usage limit, say)
  is recorded as partial, and one whose process was killed has its permission ended at
  the next run.
- **A written-up memory belongs to the conversation it came from.** It carries that
  session and its directory, is marked as written up second-hand (and by whom), and its
  "happened" date is the day the conversation was lived. Its "learned" date stays the day
  it was written. The page writer reads it on the day it happened, not the day it was
  written. This is true of the in-session catch-up too.
- **The writer now sees both sides.** The part handed over carries the session's own
  replies, labelled `[its reply]` and each cut at about 1.5 KB, beside what was said to
  it. A part may hold a little less of what was said than before.
- **Two writers never write the same stretch.** Whoever fetches a stretch holds it until
  it comes back (at most two hours). The session-start pointer passes over one the
  nightly run holds, and a session that tries to fetch one gets "the nightly run is
  writing that session up now".
- **A conversation that crashed without an end can be written up from another
  directory.** "Ended" is now read the same way the rest of the write-up rule reads it:
  nothing captured since the date changed. A refusal always says why.
- **The wake has a "Yesterday" line**: yesterday's chapter titles with their ids, with
  the date in the line ("Yesterday, 09-30: …"), so a wake composed late at night still
  reads right in the morning. It takes its room from the wake's existing budget.
- **`counterparts doctor`** says what the nightly run's catch-up did (written up, left
  owed) on the Nightly run and Write-ups lines, and counts yesterday's Claude Desktop
  chats as unmeasured rather than lost. `counterparts log` shows an
  `adapter.night.writeup` line for it.

The wake: work here, and what is personal (#313).

- The wake's craft lane is now the work done in the directory the session opens in: "Work
  here, if it helps:" lists that directory's newest few work memories (marked `work`, or
  unmarked skills and facts written there), each a title, a short excerpt and its id.
  Nearby keeps what is personal, so a session in one project no longer wakes to another
  project's plumbing.
- The chapter tool takes `about` (me, us, owner, work or world), and the chapter's memory
  copy keeps it. A chapter marked me, us or owner reaches the wake in other directories;
  one marked work stays in its own.
- `note` and `session_end` entries take `unresolved: true` for an open question or a
  promise still pending; the wake shows those under "Still open:" (at most five). A later
  write that `updates` one with `unresolved: false`, or with `how: "changed"` and the
  answer, closes it.
- The end-of-session ask (and Desktop's write-up ask) now says to close anything dated or
  open that got done in the session, so a finished follow-up stops coming back.
- The day's lines (the dream line, the night run's report, plain reminders, the update
  notice) go only to a session someone can see: the terminal or Desktop's Code tab, not
  `claude -p` or the SDK. A headless session can still start the nightly run, and the next
  session you are in says so. The assistant now says the day's dream line itself, once, in
  its first reply; the terminal line is extra.

Node and Linux (#312).

- **Runs under Node 22.15 or newer, and on Linux.** `npm install -g counterparts` works
  without bun. The setup wires Claude Code to whichever runtime ran it (`bun run …` under
  bun, `node --import …/node-hooks.mjs …` under Node), and `counterparts doctor` has a
  Runtime line naming it and saying whether it is still there. The four commands now
  start under bun when bun is on PATH, else Node. On Linux, `install --host
  claude-desktop` says Claude Desktop is not available there instead of writing a config.
  Tested on Node 22 and 24, macOS and Linux (Debian, arm64); no daily user on Node yet.

Continuity, round 2 (#311).

- A handoff that may be out of date says so at the wake: "written 09-30 18:45 by session
  a1b2c3d4, before 0.3.10 was installed" when an older release wrote it, or "a newer chapter
  here since" when another session wrote a chapter in that directory after it. The end-of-
  session ask now says any session may retire a handoff here whose work is done.
- Recalled by its id, a handoff says who wrote it and when, not "an earlier session" and the
  date its row was first made.
- "Last here" shows the first sentence of the chapter the episode's title was written with
  (and "2 chapters" when there are more), not a later chapter's under the first one's title.
  A question about time in recall does the same (for "yesterday" or "this morning", the first
  chapter written then), and says how many chapters there are.
- A note written before the memory server knows its session is filed under the session its
  host opened in that directory, when that match is exact. An older such note, written
  inside exactly one session's stretch, says "session a1b2c3d4 (placed by when it was
  written)".
- Nearby leaves out what the self page already says, a memory a later one has settled
  (changed or corrected), and a memory already under Arriving; and it no longer ends with a
  "(331 more nearby; recall ids…)" line.
- A chapter about me written in another directory reaches the wake elsewhere, as one line,
  when its memory is marked about me, us or the owner, the directory it came from is on, and
  it is not confidential. A confidential chapter is named in "Last here" to the owner only.
- A "Last here" line dropped for room now leaves a record, and the dashboard's Health wake
  bar goes amber for it.
- recall says why `considered` can be above `consideredCap` (links between memories and a
  feeling the question named have their own bounds).
- With only Claude Desktop, an older store waiting for its upgrade says to open Desktop or
  start a new chat in it, not to quit and reopen it.

Claude Desktop's Code tab (#309).

- Claude Desktop's Code tab files its memories under its own session again. There, the
  counterparts tools the assistant sees turned out to be Claude Desktop's memory server, not
  the session's own (both are named `counterparts`, and Desktop's wins), so a Code-tab
  session's notes, chapters and write-ups were filed under the most recent Desktop chat, or
  refused. Now the Code tab's wake gives the assistant one line with its session id, and a
  call that passes that id is filed exactly as Claude Code would file it: in that session's
  folder, under that session, with no Desktop write-up reminder added. Only a session Claude
  Code's hooks recorded, and that is still running, is taken this way, and only for that one
  call, so it can't spill into a Desktop chat's next call. A Code-tab call that passes no id
  still lands under the most recent Desktop chat; its result now says which chat, and tells a
  Claude Code session to pass its own id. The `wake` tool's description no longer says it is
  never offered in Claude Code, and doctor's Claude Desktop line says the Code tab's tools
  come from Desktop's server. Terminal sessions are unchanged. Each prompt now also marks
  its session as still running, so a Code-tab session left idle for hours is recognised
  again at its next prompt, and a call whose session id wasn't accepted says why.

Recall by feeling, round 2 (#310).

- Asking recall by feeling finds more of what was felt. Any feeling word reaches its family on
  the wheel: "when was I afraid", with nothing recorded as afraid, answers with the strongest
  uneasy moments, and a moment recorded as afraid still comes first. Everyday words off the
  wheel ("shame", "dread", "relief"), forms like "happiest" or "sadness", and phrases like
  "caught out" are understood, and so is your name in the possessive ("Mike's feelings"). Asking for the most, the
  strongest, or "ever" ranks by how strongly something was felt at the time, not by how fresh
  it is. Memories that only talk about feelings (notes on the wheel itself, say) no longer
  crowd out the moments that were actually felt.

Dashboard Health (#306).

- A full wake is the normal state, so the Health wake bar is green for it ("The wake is
  full — normal: …"). It turns amber only when being full cost something (the self page
  cut or left out, a handoff a session start had no room for, the page writer held back
  for room), and the line names the cost.
- The archive list shows one line per memory: a chapter's copies are one item that says
  how many times, and opens the newest.
- The folded rows under "all fine" use the same plain words as the main rows ("… —
  harmless; nothing to do") and no longer say "You may remove".
- The last sleep shown is the last one that did something, not a check that found
  nothing to do. The map's `?` describes the three named rings.
- The Lookups row is "Looked up in dreams and reflections", in doctor's words. A dream's
  start says how many memories wait for the next night and how many aged out, and a merge
  the dream saw less than whole says so ("seen only as a line").

Small fixes (#307).

- The wake's "Arriving:" lines say when each thing is due, not only when it was learned:
  `2026-09-27 (due 2026-10-03) · …`.
- When the console or the dashboard meets a store still waiting for its upgrade, it says who
  will upgrade it in your hosts' words: with only Claude Desktop it no longer tells you to
  wait for a Claude Code session.
- Whoever rewrites the self page (the page writer, or the nightly reflection) is asked to name
  the model when a claim is about one model, to write dates rather than "tonight" or
  "today" (the page is read on later days), and not to add a revised-on line of its own.
- Wake labels: the line under the header no longer also starts "Counterparts memory", and it
  says only the listed memories open with a date (the page is dated on its own line); a
  memory whose words already start with its date shows that date once; and the closing
  comment says `page=1` beside `identity=0` when the wake carries the page.
- The install loop (`tools/install-loop`, in the package) reads what it captured with a
  here-string, so a long output can no longer fail a check that had matched.

Not proven here.

- No one uses Counterparts on Node daily yet. Linux was tested on arm64 Debian, in a
  container. Dreaming and the nightly run under Node go through the same wiring, but
  were not run, since that needs a real `claude`. Windows was not attempted.
- The night catch-up was checked in tests and in a throwaway home with a stand-in
  `claude` that drives the memory server as the real one's single tool would, never with
  a real `claude -p` or on a real store.
- The Code tab's sessions were measured read-only on a real Desktop, and the serving was
  checked in tests, not on a day's real use.

## 0.3.10 — 2026-09-30

Feelings now sit on a new wheel of seven cores — happy, warm, calm, curious, sad,
uneasy, angry — and every feeling already recorded is re-filed onto it. A feeling
written under a core is kept under that core, and every word carries default numbers,
so a note can name just the word. Several sessions working in one directory each keep
their own handoff now, and the wake says who left each one. A new session's wake has a
"Last here" line naming the latest chapter written in this directory, and asking "what
do you remember from our most recent session?" leads with that session. Every recall
result says which session it came from. **The store's format changes, v10 → v11, and a
pre-migration copy is taken.**

**The format change, and why every session must be closed.** The first Counterparts
process to open the store for writing after installing copies it (as every upgrade since
0.3.1 has) and upgrades it. Usually that is a Claude Code hook, even the next prompt in a
session left open. With only Claude Desktop, it is Desktop's memory server as it starts,
or, if Desktop was left running, the background worker its next chat starts. The upgrade
adds three
columns to `feelings` (`valence`, and `core_v10` / `emotion_v10`) and re-files every
recorded feeling onto the seven cores. A re-filed row keeps its old core and word beside
it, and nothing else in the store changes. Until the upgrade, `counterparts doctor` and
the dashboard can't read the store (a v10 store is older than they read) and say so.
**Close every Claude Code session before installing, and if you have connected Claude
Desktop, quit it.** A v11 store can't be opened by 0.3.9: anything of 0.3.9's that opens
it afterwards refuses at once (`SCHEMA_AHEAD`), and its hooks stand down. A memory server
that was already running keeps 0.3.9's code with the store already open. Its tools
re-read the format on every call and refuse ("Counterparts was updated and this server
is still running the old version, so this tool did nothing."), ending with `/mcp` →
Reconnect in Claude Code and "Quit and reopen Claude Desktop" in Desktop. The hooks are
fresh processes at every event, so they run the new code at once. To go back to 0.3.9
you reinstall it and put back the copy the upgrade took; anything remembered since is
lost.

The feelings wheel, v2 (#301).

- **Seven cores: happy, warm, calm, curious, sad, uneasy, angry**, in 37 groups,
  180 words in all (a group's name is a word too). Every word from the first wheel, its additions and aliases, and
  every word a counterpart has recorded in its own words has a home. Recognition is a
  group under curious (also warm). Guilt sits under uneasy, disgust is a word under
  angry, and hopeful is under happy.
- **Every word carries default numbers**: a valence (−1 to +1) and an intensity (0 to
  1). On `note` and `session_end`, `core` and `strength` may be left out: a feeling with
  no core takes its word's home core, and a feeling with no strength takes the word's
  intensity, capped at 0.55. A `valence` may be given to override the word's. A strength
  you give is never changed.
- **The writer's core is kept.** A word named under a core it doesn't sit under is
  stored under the core the writer chose, with nothing reported as moved. (0.3.9 moved
  it to the word's home and said so.) A first-wheel core name (`fear`, `anger`,
  `surprise`, `disgust`) sent by a session or dream still running is filed the way the
  upgrade files it, and comes back as a `core` repair.
- **The upgrade re-files every feeling.** fear → uneasy; anger and disgust → angry; sad
  stays sad, except guilty, remorseful and ashamed → uneasy. Rows under happy and
  surprise, and `other` words under them, go by the word: to its home core, unless the
  word can also be written under the old core (bittersweet under happy stays happy). A
  word off the wheel stays happy under happy and goes to curious under surprise. Each
  re-filed row keeps its old pair. It runs once. Doctor prints what moved ("Upgrade to
  v11: feelings use seven cores now … N of M recorded feelings re-filed (…), each keeping
  its old core beside it").
- **What a feeling does, by its valence.** How high a feeling holds a memory is
  unchanged. How fast that hold softens now depends on valence: a negative feeling's hold
  softens fastest (angry about 16 days), a positive one's slowest (happy and warm about
  26). Mood matching compares valence instead of core, and a low mood meeting a low
  feeling counts a quarter as much, so a low mood can't feed itself.
- **Recognition reaches the core's fast lane.** An unmarked memory carrying the
  counterpart's own recognition feeling (at least 0.6, felt in a session) counts as about
  itself for the fast lane only; a mark still wins, and the slow lane still needs one.
  Doctor counts it ("Recognition").
- **Readers.** The dashboard's radar, chips and dots show the seven cores in seven
  colours, warm pink and angry red ("dislike" for "disgust" is gone; disgust is a word
  under angry). In recall, a
  stamp also answers to its group's word, so "when was I afraid" still reaches scared.
  The dream and reflection prompts name the seven cores.

Handoffs, one per session (#295).

- **Each session in a directory keeps its own live handoff.** Writing again revises your
  own; another session's write makes a new one beside it. Until now the last session to
  end wrote over the others.
- **The wake shows every live handoff here, newest first, and who wrote each** (the
  session's short id and model, "this session" for your own). With several, a count line,
  up to three one-line entries, the older ones by id, and how to retire one.
- **Retiring.** `handoff: ""` retires only your own. `session_end` takes
  `retireHandoff: [ids]` to retire any handoff in this directory, whoever wrote it. A
  `handoff` write returns `others`, the other sessions' live handoffs here, so finished
  ones can go in the same call.
- **Claude Desktop:** a `session_end` with no session named can't leave or retire a
  handoff (`session-unnamed`); the rest of the call goes through.

Continuity (#300, #302).

- **"Last here" on the wake.** In a directory where a session wrote a chapter within the
  fortnight, the wake says which session it was, its model, when it ran and the
  chapter's title and first sentence. It is read from what is already stored, so chapters
  written before this release show at once. A finished session needs no handoff for it.
- **The handoff pointer says how far the work since is written up**: "written up to
  17:50 (chapter), 3 pieces after" instead of "not yet written up" when a chapter or a
  memory covers part of it.
- **A question about time leads with this directory's last session.** "What do you
  remember from our most recent session?", "where did we leave off", "this evening" and
  the like bring that session's latest chapter first, then the memories it wrote, newest
  first, each marked `recent`. The rest of the answer is ranked as before.
- **Every recall result says where it came from**: `from: "session a1b2c3d4, ~/garden,
  09-30 17:41"`, or "this session". Older rows say less (nothing is backfilled).
- **A note from before the session was known (#305).** In Claude Code the memory server
  learns which session it serves only at the first `chapter` or `session_end`; a `note`
  before that is filed under no session. Such a note now reads "a session that hadn't
  been identified yet" with its directory and time, never "this session". A question
  about time still brings a finished session's earlier notes back with it when they were
  written here, while that session was at work, and no other session was working here at
  the same moment.

Tests only (#303): child processes in the suite get the test's time zone, and two
fixtures moved, so the suite passes at every hour in any zone. No product change.

Not proven here.

- Nothing ran on a real store. The re-filing of your own recorded feelings, the writer's
  core on real notes, the softening and mood by valence, and the recognition lane were
  checked on a seeded store and in tests only.
- The upgrade from Claude Desktop's memory server (a Desktop-only user) was checked over
  stdio with a client that calls itself `claude-ai`, not against the real app.
- "Last here", the recency lead and handoffs from several sessions were checked with
  driven sessions in one throwaway directory, not across a real day's parallel sessions.

## 0.3.9 — 2026-09-30

Counterparts now reaches Claude Desktop's chat: one command connects it, a chat wakes
with the same memory a Claude Code session does, and each call says which chat it
belongs to. Underneath, the host-neutral part of a session moved out of the Claude Code
adapter so a second host could use it; Claude Code behaves as it did, apart from two
small, deliberate changes. Recall can now answer a question about how something felt,
and a journal chapter and the memory made from it come back as one. **The store's format
does not change** (it stays v10), so nothing is copied or upgraded. The hooks run the
new code at once; a session left open keeps 0.3.8's memory server until it is restarted
or `/mcp` → Reconnect.

Claude Desktop chat.

- **`counterparts install --host claude-desktop`** connects Desktop's chat. Quit Claude
  Desktop first: it rewrites its own config file while it runs, and can write over the
  change. The command makes (or keeps) the store and configuration exactly as the
  scripted install does, then merges one `counterparts` entry into Desktop's
  `claude_desktop_config.json`, found under the home directory it was given. The file is
  backed up first, every other server and setting in it is left exactly as it was, and
  a second run changes nothing ("already connected"). The file is written back as
  2-space JSON, the way Desktop writes it. If it replaces an entry that named a different
  store, it names that store: the memory there is still there. Plain `install` is
  unchanged and doesn't touch Desktop.
- **The `wake` tool** is Desktop's session start, and only Desktop is offered it. It
  starts a new session (host `claude-desktop`, in the `claude-desktop:` place) and
  returns what a Claude Code session start would: the wake, the clock, today's plain
  reminders, the day's dream line when it is an ask, the update and doctor notices, and
  the write-up pointer, sized for a tool result. It also starts the turn-end worker, as
  the hook does. It doesn't ask the first-launch question and doesn't start the headless
  nightly run. Desktop also lists one prompt, **"Start with Counterparts"**, which asks
  the chat to call `wake` first and keep the session id it gets.
- **Each call binds to a session, and says when it guessed.** One server serves every
  Desktop chat, and Desktop sends no chat id, so every Desktop tool takes an optional
  `session`. A call that names a live Desktop session is filed under it. A call that
  names none binds to the most recent live Desktop session and says so (`boundTo`,
  `boundBy: "most-recent"`, and one line). A tool that needs a session (`session_end`,
  `chapter`, `dream`, `reflect`) refuses a named id that is unknown or has gone quiet
  (`session-unknown`, `session-not-live`), and never swaps in another; with no live
  session at all it refuses and names `wake`. The other tools (`note`, `recall`,
  `status`, `scope`, `self_page`) run unbound in those cases, as they always could. Only a call that names its session keeps that session alive
  and counts toward its write-up ask; a guessed call moves nothing, because it may belong
  to another chat.
- **The write-up ask.** After 3 named calls and 20 minutes since the later of the wake,
  the last `session_end` or `chapter`, and the last ask, the next named result carries a
  write-up ask. `session_end` can be called again in the same chat; later calls add to
  what the first one wrote.
- **Desktop's own place.** `claude-desktop:` is a place, not a folder: `counterparts scope
  claude-desktop: --on` and the other mode flags work on it, the off and paused refusals
  are worded for Desktop, and observer is read on every call, so a change takes effect
  at once. Desktop never takes on the observer setting of the folder the server was
  started in.
- **Doctor has a Claude Desktop line.** It is quiet when Desktop has no entry, green with
  the last wake and last session when it has one, and amber only when the entry names
  another store.
- **`counterparts coverage` shows Desktop sessions as unmeasured**: "Claude Desktop: N
  sessions that day — unmeasured: Desktop chat keeps no transcript, so what they did not
  write up cannot be counted (not lost; what was written through the tools is kept)."
- **A Desktop session may write up a chat that went quiet, only when its launcher grants
  it.** A session's record can carry `mayWriteUp`, the ended sessions it may write up.
  Only a launcher writes it (`sessions.ts#grantWriteUps`); no tool can, and a
  `mayWriteUp` argument is ignored. The subject must be listed, ended, and owed, and its
  memories are filed where it was lived. Nothing in this release grants it yet.
- **How the server tells the hosts apart.** The client's name at `initialize` decides:
  `claude-ai` (chat) or `local-agent-mode-*` (Cowork) makes it Desktop's. A process whose
  environment carries Claude Code's markers (`CLAUDE_PROJECT_DIR`, `CLAUDECODE`,
  `CLAUDE_CODE_ENTRYPOINT`) was started by Claude Code and stays Claude Code's whatever
  its client says. Any other client gets the handshake, the nine tools and the refusals
  it always got: `wake` is an unknown tool there.

Claude Code: two deliberate changes.

- **`status` explains `owner: false`.** When the server isn't the owner's,
  `status.stance.ownerMeans` says in one phrase what that means: "owner: false is the
  ordinary setting — confidential memories are left out of this server's answers;
  nothing is wrong."
- **No scope question in Desktop's scratch folders.** The first-launch scope question is
  skipped in a Code-tab "No folder" workspace
  (`…/Library/Application Support/Claude/scratch-workspaces/…`).

The host seam (#292; no change in behaviour).

- **The host-neutral part of a session has its own module.** `src/adapters/lifecycle.ts`
  (`HostLifecycle`, `Lifecycle`) holds what any host does at a session's start, turn
  boundary and end: the registry record, the wake, recall and its record, capture, the
  ask pacer, the write-up ask, the worker. The Claude Code adapter extends it, and each
  hook runs the same steps in the same order. `src/adapters/hosts.ts` holds the wording
  that differs by host; Claude Code's strings are byte-identical.
- `config.ts` and `spawn.ts` moved from `src/adapters/claude-code/` to `src/adapters/`.
  The `./claude-code` export still re-exports everything that moved.
- **Registry records carry `host`.** A record written before this reads as `claude-code`.
- **New package exports**: `counterparts/lifecycle` and `counterparts/hosts`.

Recall and chapters.

- **Recall by feeling, for a deliberate question.** Asked "what have I felt most
  strongly" or "what moved me", the `recall` tool (and `counterparts ask`) answers from
  the feelings recorded on memories, strongest first. Stamps rank the answer only when
  the question is really about a feeling: a feel-word (`feel`, `felt`, `feeling`,
  `emotion`, `mood`), or a feeling word used about a person. Everyday phrasings don't
  trigger it: "the happy path", "moved the parser", "I feel like…", "I moved it to src",
  "is my build open" still work as ordinary words. "I" is whoever asks: the counterpart
  in `recall`, you in `counterparts ask`. "afraid" is now an alias of scared. The
  per-turn recall never opens this path.
- **A journal chapter and the memory made from it are one result**, and that memory now
  keeps the chapter's title (the next time its chapter grows; nothing is backfilled).
  The chapter is the row shown; credit reaches the copy only when recall showed the
  chapter this session.
- **`status` counts `replaced` apart from `exited`.** `symmetry.exited` now means only
  what left for good (let go, removed); a revision, a merge, a correction, or a journal
  copy rebuilt when its chapter grew is counted under the new `symmetry.replaced`. A
  store whose chapters keep growing used to read as losing its self-kind memories, so
  **any note comparing `exited` across days sees a step on the day this is installed.**
- **The dashboard's Ask shows a chapter as its journal entry** (it used to show the
  memory, with a "from chapter …" link), and the questions it rewrites into the
  counterpart's voice ask as the counterpart (`--voiced`): there "I" means the
  counterpart. An exact ask and a typed `counterparts ask` keep you as "I".

Not proven here.

- Desktop has never run against a real Claude Desktop app. The client names, the
  prompt, the per-call binding and the write-up ask were checked over stdio with a
  client that calls itself `claude-ai`.
- The Desktop Code tab's environment and client name were never measured live. A Code
  tab session is expected to carry Claude Code's markers and stay Claude Code's.
- A process that Claude Code did not launch, started in a folder set to observer, opens
  the store writable before `initialize` tells it which host it serves.
- A Desktop-only user on automatic dreaming gets no dream line: the wake leaves the
  headless run for a Claude Code session to start.

## 0.3.8 — 2026-09-30

When two memories disagree, Claude can now say how: the fact changed, the old one was
wrong, or it's still open, with a trail and an undo. What hasn't been written up is
counted in one place, and a debt lapses after a few days of use instead of waiting
forever. The wake keeps up with the day, a process log records what the hooks, the
worker, the nightly run and the memory server did, and the dashboard takes the 09-30
feedback. **The store's format changes (v9 → v10).**

**The format change, and why every session must be closed.** The first Claude Code
session after installing copies the store (as every upgrade since 0.3.1 has) and
upgrades it: two new tables for contradictions and their trail, and one new column on
every memory (`fade`, 1 unless a memory was settled as changed). Every contradiction a
dream flagged and nobody settled is carried onto the new table, with its "already
raised" mark. Nothing else changes, and all memories come through. Until that first
session, `counterparts doctor` and the dashboard can't read the store yet (a v9 store is
older than they read) and say so; the next session's hook does the upgrade. **Close
every Claude Code session before installing.** A v10 store can't be opened by 0.3.7:
anything of 0.3.7's that opens it afterwards refuses at once (`SCHEMA_AHEAD`), and its
hooks stand down. But a session that was already open when you installed keeps its own
memory server, still running 0.3.7's code with the store already open, and that open was
the one place the check ran. Its memory tools re-read the format on every call and
refuse ("Counterparts was updated and this server is still running the old version, so
this tool did nothing. Run /mcp and Reconnect to load it."), so in a session opened
before the install, don't rely on the memory tools: quit it and start a new one, or run
`/mcp` → Reconnect. The hooks are fresh processes at every event, so they run the new
code at once and are fine. To go back to 0.3.7 you reinstall it and put back the copy
the upgrade took; anything remembered since is lost.

Contradictions.

- **Three ways a disagreement is settled, each with its own outcome.** When Claude
  writes a memory that `updates` an older one, it says `how` (`changed` is the default):
  - **changed** — true then, not now. The older memory takes one strength cut (half) and
    stays recallable, labelled `Earlier (now [id])`. A later use resets its fading as
    always but doesn't lift the cut.
  - **corrected** — the older one was wrong. It is put away (archived): it leaves recall
    and stays readable by its own id, `Corrected by [id]`. Nothing is deleted.
  - **open** — both stand, and recall shows each with `(disagrees with [id])`.
- Beliefs, the core, current-state and protected memories keep their own paths; a `how`
  sent at one of those is not applied, and the answer says which path ran.
- **Claude notices at write time.** A `note` or `session_end` memory comes back with up to
  three of its nearest live memories and one line inviting a settle, if one of them
  disagrees. No model call.
- **Settling a pair that already exists**, from anywhere: `note` with `settle` (no new
  memory needed), the dream's new `settle` action (a reason is required), the
  reflection's `settle` phase (only on memories it was shown), and yours:
  **`counterparts settle`** lists what's unsettled and what was settled lately, settles
  one (`--pair … --holds … --how … --why "…"`), or undoes one (`--undo`). Settling an
  existing pair rewrites no memory.
- **Every settle and every undo leaves a trail row**: who (a session, a dream, the
  reflection, you), how, why, which memories, and when. An undo puts back exactly what
  the settle did: the strength, the archive, the flags it closed. Removing the memory
  that settled a pair puts the other one back.
- **Unsettled pairs are labelled.** The older memory of a pair nobody has settled reads
  `Unsettled — may be out of date, see [id]`, in recall and in the wake's lanes. Dream
  flags are raised once awake, as before, now naming the pair and the `note` settle.
- **A replaced memory is readable by its own id**, with `replaced by [id]`; `counterparts
  ask` prints a memory's standing above its words.
- Doctor has a **Contradictions** line (the last 7 days: flagged, settled by kind and by
  whom, undone, still open or unsettled) and an **Upgrade to v10** line.
  `counterparts mechanisms` counts reconsolidation as built and interference as partly
  built.

What is written up, and what is owed.

- **One place says what hasn't been written up yet.** A piece of conversation counts as
  written up only when something claims it: a memory from it, a write-up answered
  "nothing new" (`memories: []`), or a chapter. A handoff alone doesn't. Each claim is
  for the project it was made in.
- **One rule for what a session owes**: at least 3 unwritten pieces spanning 15 minutes
  or more, in a session that has ended or captured nothing since the date changed. It
  replaces the old asked/answered rule and the 12-hour silence window. Short sessions
  (1–2 pieces, or 3 or more inside 15 minutes) owe nothing. A small debt (under 6 pieces)
  gets the same pointer with one more sentence: "It was a short session: one line is
  enough, or memories: [] if nothing in it is worth keeping." The next session's pointer
  and caps are unchanged: two pointers a day across the store, this project only.
- **A debt lapses instead of waiting forever.** An owed stretch has two more days of use
  (days with a turn end) after the day of its latest piece; at the first turn end of the
  third, it lapses. Nothing is deleted: the session stops owing, and its text goes on the
  ordinary 7-day retention. On a store with old unwritten stretches, the first pass
  lapses them, one record each.
- **The in-session ask has a third reason**: three pieces not yet written up, half an
  hour after the later of the first of them and the last ask (`due-unwritten`). The
  day's cap on asks is unchanged, and an unanswered ask isn't repeated without new
  pieces.
- **The handoff pointer says how current it is**: `Where I left off in this directory
  (written 09-29 12:47): …`, and when work here ran after it, `(written 09-29 12:47; work
  here 13:02–15:41 since, not yet written up)` or `…, written up since`. The excerpt is
  the first real sentence, without a leading list marker.
- **`counterparts coverage [--date YYYY-MM-DD]`** says, in plain words, what was written
  up and what is not yet, for a day. Doctor's **Crash write-up** line is now **Write-ups**:
  yesterday's state, amber when a stretch the pointer can offer is still owed from
  yesterday or earlier, small debts it never offers named apart as "left to lapse", and
  the week's lapses. The 3-day wait is gone.

The wake.

- **The wake keeps up with the day.** It used to be written once, at the day's first
  turn end, so a self page written later, a write-up that landed, or the nightly run's
  page reached no session until the next day. Now each of those marks the wake behind,
  and the next turn end re-renders it; the nightly run re-renders it when it finishes.
  Re-renders on the same day are stable: the same Nearby memories, the identity lane
  rotating once a day.
- **The wake says what it trimmed.** A lane that lost memories to its cap or to the size
  budget gets one quiet line, like `(3 more still open; recall ids: mem_…, mem_…, mem_…)`,
  up to five ids that recall reads whole. Most wakes will carry a "(N more nearby…)"
  line.
- **A plain reminder, once told, leaves "Arriving"** for the rest of its grace week.
  Recall still finds it.
- **One size budget per hook message** (10,000 bytes; 9,500 for the JSON form). When a
  session start or a prompt is crowded, parts give way in a stated order and wait for a
  later turn; nothing is cut, and nothing is marked told that wasn't shown. The
  first-launch question is now measured against this budget, so it can fit beside a full
  wake.

The log.

- **A process log**: one line per event from the hooks, the turn-end worker, the nightly
  run and the memory server, in `sessions/log/<date>.log` inside the store (kept 7
  days). Ids, counts and codes, no conversation text. **`counterparts log [--date
  YYYY-MM-DD]`** prints a day, oldest first. Doctor has a green **Log** line (where it
  is, how many days it holds, today's failures).
- Two failures now leave a durable record: capture failing to write, and a write-up
  failing.

Cleanup.

- **The page writer's host mode is removed** (the windowless `claude -p` the worker
  started for the self page alone, off by default since the nightly run). A config that
  still says `pageWriter.mode: "host"` loads, reads as `session`, and doctor's "Old
  settings" line names what it ignores.

The dashboard.

- **Dates** in one style ("Sep 30th", with the year when it isn't this year). **Self**:
  the day-by-day note reads as a sentence, and Arriving items are titles that open the
  memory. **Memories**: a "by word | by meaning" switch beside the search box, matched
  words highlighted, close matches for typos, readable line lengths, and a row no longer
  repeats its own date. **Feelings**: "disgust" reads "dislike". **How well I remember**:
  one square per memory, scaling as memories grow.

## 0.3.7 — 2026-09-29

Dreaming asks where you can see it, and "on its own" now means a separate background
session the hook starts itself. Memory also fits more into a night, reads long
memories whole, and lets links bring a memory to mind. **The store's format does not
change** (it stays v9), so nothing is copied or upgraded. Close every session before
installing anyway: the hooks switch to the new code at once, while a session left open
keeps the old memory server. Run `/mcp` → Reconnect in any you missed.

Dreaming.

- **The day's question shows in your terminal.** On the first prompt of a new day, with
  memories waiting to be dreamed, you see: `Counterparts: I haven't dreamed since …
  (N new memories). Say "dream" to start, or "dream on your own" to let me do it each
  day.` Claude doesn't ask it again; it waits for your word.
- **`ask` is the default now** (it was `auto`). Say "dream" and the run starts in a
  background agent, as before.
- **"Dream on your own" means a headless nightly run.** With the setting `auto`, the
  first prompt of the day starts the run itself, in a separate, windowless `claude`
  session, and tells you: `Counterparts: dreaming in the background (a few minutes).
  Say "no dreams" to turn it off.` Nothing is asked of the session you're in. That
  session is locked down: it can use only the counterparts memory tools (dream,
  reflect, self page, recall), Claude Code's own tools that run commands, read or
  write files, reach the network or start agents are turned off, it loads only the
  counterparts MCP server, it starts in a neutral folder (the store's own, so no
  project's instructions or hooks load), and it has a turn limit and a 20-minute
  watchdog.
- **Every run leaves one record**: done, partial (with the parts that ran: writer,
  dream, reflection), failed, timed out, or could not start, with the reason. What the
  run did is told on the next prompt, in any session, once. `counterparts dream` and
  doctor's new **Nightly run** line show the latest run.
- **If the run can't start, it asks instead**, with the reason in one line: `I
  couldn't start dreaming on my own: the claude command was not found. Say "dream" to
  do it here.` The next day tries on its own again.
- **If you had set `auto` yourself before this version, it is set back to `ask`
  once**, and you're told once, in the terminal. `auto` used to mean "Claude starts a
  background agent in your session"; it now means a separate session, so it's yours to
  choose again ("dream on your own"). A store that never chose a setting simply gets
  the new default, `ask`.
- **"No dreams" takes effect from the next run**; a run already under way finishes,
  and it says so.
- The run's words say "while I slept" and "since you last slept", not "last night":
  it runs at the day's first session, usually the morning.
- **The reflection leans toward rewriting the page** each day, unless there's really
  nothing new; it's told when the page writer already revised it earlier in the run,
  and that every version is kept.
- **Fixed before release:** since 0.3.6, on the development branch, the dream and
  the reflection were shown only the counts of what they were handed, not the
  memories themselves. They see the memories again. (0.3.6 as published was not
  affected.)

Fitting more into a night.

- **New memories wait their turn instead of being dropped.** Memories not yet dreamed
  form a queue, ranked by how much they matter, not by how new they are. What fits in
  tonight's room is dreamed; the rest wait for the next night, and the dream says how
  many ("12 new memories wait for the next night"). A memory still not dreamed after
  seven days of use ages out, counted.
- **Detail by importance.** Every memory the dream is shown gets a line (what it is,
  its date, its strongest feeling, why it's here); the most important come whole.
  The reflection now sees the whole core and every memory from the last few days.
- **Journals as chapters.** A long journal is sent a chapter at a time, only the
  chapters added since the last dream, and entries that didn't fit are carried to the
  next night. Before, a grown journal was re-sent from chapter 1 and the newest
  chapters were the ones cut.
- **Long answers come in parts** ("part 1 of 3") rather than cut.
- **Recall by id reads up to 10 memories at once, each whole**, in parts when it is
  long, so a dream merge, a journal or a long episode can be read through the memory
  tool. Ids past the room wait, named, with the call that fetches them.
- **Doctor's new Lookups line** says how often the dream and the reflection looked up
  a memory they were shown only in part.
- `note`, `session_end` and `chapter` ask Claude for a one-line title.
- **Nightly upkeep resumes where it stopped.** Pruning and fading pick up after the
  last memory they looked at, instead of the same random slice each night.
- **Open things are found by state**, not among the newest few: a contradiction a
  dream flagged many nights ago is still raised, and a morning share not yet told is
  still carried. A flagged contradiction that keeps coming up is shown less each
  time, until one of its memories is used again.

Links between memories.

- **Links can bring a memory to mind.** When the memories a prompt calls up are
  strongly linked to another one that shares none of its words, that one may be shown
  quietly, at the end, marked `Linked:` (at most two). Doctor's **Association** line
  says how many were shown and how many Claude then opened.
- **Memories written close together in a session are linked**, lightly, when the
  session ends: each to the next one or two. Links still fade unless use strengthens
  them. What the nightly run writes is left out.
- **Steadier links.** A new link starts faint and a link's strength no longer depends
  on how many others its memory has. Links a dream or a summary proposes are added
  only where there's room; they never push out a link learned from use. Spreading
  goes strongest-first and stops when what it carries gets faint. Dead links are
  swept.
- Four fixes: a dream re-linking two memories no longer brought back a link's old
  strength; a memory used twice in one day still links with what it was used with;
  a link could no longer push a memory the prompt found strongly down the list; and
  importance is weighed before the list is cut, not after.

The dashboard.

- **Memories, round 4, so it reads for anyone.** One search box, "Find a memory"
  (type to find by words, Enter to ask by meaning; the answers replace the list).
  **How well I remember** (renamed, journal counted as its own part). Two rows of
  filters: kinds (about myself, people, things, skills, places, facts, journal, core)
  and the six feelings, with "kept · put away · both" beside them. Every row the same
  brightness; "fading" only where it is. The card is trimmed to the text, the
  feelings chart, one sentence on how well it's remembered and when it would be put
  away, why it mattered, and when it was written; the rest is under "details".
  "Archived" reads "put away". **"+ Add a memory"**. The "Reading here changes
  nothing" badge is gone from every page. Home and Memories share one feelings
  chart.
- **The Self map reads at a glance** (on Home and Self): its rings are named on the
  map ("who I am", "almost there", "about me and us"), the core and almost-there
  memories carry short names, and links show only when you hover or tap a dot. On
  Home, the brain is back on the right, beside Today.

## 0.3.6 — 2026-09-28

The nightly run: once a day, Claude writes its page, dreams and reflects in one
background run, and starts it on its own. **The store's format does not change** (it
stays v9), so nothing is copied or upgraded. Close every session before installing
anyway: a session left open keeps the old memory server while the hooks switch to the
new code at once, and the new dream start needs both. Run `/mcp` → Reconnect in any
you missed.

The nightly run.

- **One background run, once a calendar day: the page writer, then the dream, then
  the reflection.** The first prompt of a new day tells Claude to start it, when at
  least 3 memories are new since the last dream. Claude hands it to one background
  agent and tells you one line: "Dreaming in the background (a few minutes). Say 'no
  dreams' anytime to turn it off." With fewer than 3 new memories nothing runs, and
  they carry over to the next day.
- **Dreaming has a setting: auto, ask or off.** `auto` is the default: the run starts
  on its own and says so. `ask` asks you first, as 0.3.5 did. `off` asks nothing.
  Say "no dreams" in a session, or run `counterparts dream --setting off`; turn it
  back on the same way (`--setting auto`). `counterparts dream` and doctor's Dreaming
  line say which it is.
- **The page writer is back in the run.** It no longer waits for room in the session
  start, which is why it had stopped. It is handed the page whole and the day it
  reads, as the first step of the run.
- **Who wrote each version of the page.** A version the reflection wrote is now
  labelled "reflection", apart from the writer's. Both may write the page on the same
  night, and every version is kept. `counterparts self-page --versions` and the
  dashboard's Self tab say which.
- **A dream that was cut off picks up where it stopped.** If a dream began, changed
  something and then went quiet for 30 minutes (its session closed, say), the next
  session starts the run again and the dream resumes: what it already did stands. A
  dream that began and changed nothing is closed and a fresh one starts. A run that
  dreamed but was cut off before it reflected finishes only the reflection. At most
  twice a day.
- **"Dreamed today" and "reflected today" are calendar days**, not days of use.
- **The reflection sees what the dream saw**, every memory the dream was shown and
  what it made, and can cite them. It gets the self page whole. When all of that is
  too long for one answer, it comes in parts ("part 1 of 3"), and nothing is cut.
- **Page sections.** The self page's own headings ("Us", "How I work", anything) are
  read as sections, not only Core and Lately. The dashboard's Self tab, the `self_page`
  tool and the CLI list every one.
- Doctor no longer marks the page writer amber just because a night is owed. It is
  amber only when nightly runs went on for days without the writer, or it failed.

Fewer refusals.

- **Dreams and reflections are refused less, and repaired more.** An over-long or
  two-part feeling ("steadied: after the long week") is split: the first word is the
  feeling, the rest goes to what carried it. Texts over their limit are kept to the
  limit and the result says so; the limits for a morning share, a reflection's entry,
  a dream's journal and a merged memory are higher. Many refusals that protected
  nothing now write, with a note. The ones that stay (dream words never become lived
  memory, a confidential memory's words stay off the page, the page cites real
  memories) now say why, with the words or the id that tripped them.
- **The self page may quote a lived memory a dream also quoted.** The old check
  refused it.
- **A reflection can finish a second time the same day**, to supply what the first
  finish left out or had refused: the page, the share, feelings, what a memory is
  about, traits. It never writes a second entry. A share already told can't be
  replaced. The same feeling sent twice is recorded once.
- The instructions Claude reads now say which feeling field is which, before it
  writes.

Seeing it.

- **Newest first.** When a record held more events than a view read, several views
  kept the oldest and called them the newest: the dashboard's feed, a memory's days
  of use, Health's heatmap (today read empty), the flow view, contested beliefs, the
  page's version reasons, and a few doctor counts. They read the newest now.
- **"Of N".** A list that is cut says so: search says "the closest 25 of N matches",
  Health's archive "the newest 200 of N", dreams "the newest 12 of N".
  `counterparts dream --list --all` lists every dream.

**The dashboard's Home tab, round 4.** Home now holds the best pictures from the other
tabs, each a way in. A headline (the day, your name, how many memories, how many new
today) with a health dot that links to Health. The brain beside **Today**: a few plain
lines about what happened to memory today, each opening that thing. **How it feels**
(the feelings radar) and **Around the core** (the Self tab's map). Gone from Home: the
four tiles, the written/came-back strip, the Tonight box and the live feed. The
mechanism pills and "how it works" moved to the end of Health.

**Other dashboard fixes.** "How I act" puts the faint week-ago mark where it really
stood a week ago, counting memories archived since, and fits a phone. Day counts are
whole ("14 days of use", not "14.00"). Health names archived memories in words
("merged in a dream", not "dream-merge"), and says its memory count leaves out the
cards for people and projects. Home's chapter count matches Self's. The Self map's
ready dots no longer sit on top of each other.

## 0.3.5 — 2026-09-27

Claude reflects after a dream, tells you about it in the morning, and rewrites its self
page from what it reflected on; what a memory is about now decides the core. **The
store's format changes (v8 → v9).** The first Claude Code session after installing
copies the store (as every upgrade since 0.3.1 has) and upgrades it; until then
`counterparts doctor` says (amber) that the next session will upgrade it, and the
dashboard asks you to open a session. Close every session before installing, and run
`/mcp` → Reconnect in any you missed.

Reflecting.

- **After a dream, Claude reflects on it, awake.** The dream's background agent now
  dreams, writes its journal, then reflects, as three separate steps. The reflection is
  handed the dream (marked as dreamed), the last few days' chapters and memories, what is
  on its mind (dated things in the next two weeks, disagreements still standing, where
  the work stands), the self page and the core, and answers three questions that change
  from night to night. It sees memories and feelings, not the numbers behind the core.
- **What it writes.** An entry, kept as a memory titled "Reflected: …" when it rests on
  memories it names. An entry that names nothing counts as "nothing much": it is kept on
  the record, and nothing else is written or said. One reflection a lived day.
- **The self page is rewritten from the reflection.** The page had stopped changing: the
  morning writer needed room in the session start that a full wake no longer left it. Now
  the reflection rewrites the page from the memories it names (at least one from the core
  when there is a core), and that night's morning writer stands down. A dream's own
  pattern is never a source for the page, and its words may not go on it.
- **The morning share.** The reflection may leave a short note for you (at most 700
  characters, naming what it rests on). Claude tells it once: when the dream hands back,
  or, if that session has already ended, at the start of the next one.
- **Feelings recorded later.** The reflection may record how a memory it was shown feels
  now, marked as recorded later, on that day. It may feel stronger than anything felt at
  the time.
- **What a memory is about**: me, us, owner, work or world. Claude can say it when it
  writes (`note` and `session_end` take `about`), and the reflection can set or change it,
  with its reason. Each change is recorded; one that makes a memory about Claude, the two
  of you or you is said in the next morning share.
- **You are named, not "him".** What the reflection and the dream say about you uses
  your name as the store knows it (`install --name`), or "the owner" when there is none —
  never a pronoun that guesses.
- `reflect` is a ninth tool for the MCP server; `counterparts dream --show <id>` includes
  the dream's reflection, `--show rfl_…` shows one, and `--list` lists them. Undoing a
  dream leaves its reflection. Removing a memory also redacts any reflection that named
  it, and that reflection's entry. `pageWriter.mode: "off"` stops the reflection's page
  write too.

The core.

- **What a memory is about decides whether it can become core**, not its kind: about me
  (Claude), about us, or about the owner. A skill never becomes core. A memory marked
  work or world does not either.
- **Nothing changes overnight.** The upgrade marks memories by the old rule: every
  `self` memory is about me, and every memory about a person that names you is about the
  owner. So the candidates the morning after are the ones from the night before, and
  `doctor`'s Upgrade line says how many were marked each way.
- **A reflection naming a memory counts as it coming back.** It counts toward the fast
  way in (strongly felt and came back after a gap), and toward the slow way at most once
  a week per memory.
- **A memory can reach the core on reflection alone, and you can close that.** This is
  on by default: a feeling the reflection records later and a reflection naming the
  memory both count. When one gets there that way, the next morning share says so, and
  `doctor` counts it. `counterparts core --reflected-feeling off` closes it: the fast way
  then needs a feeling felt at the time and an ordinary use after a gap, and a reflection
  may only move what a memory is about toward work or world. `on` opens it again.
  `counterparts core` says which way it stands.

Traits.

- **A memory can carry a small note on how Claude acted in it**, on seven fixed scales
  (careful–bold, agreeable–candid, guarded–open, focused–curious, following–initiating,
  inward–outward, serious–playful). `note`, `session_end` and the reflection take them;
  most memories carry none. They are for display only: they change nothing about the
  core, fading, the self page or recall. `export --markdown` has a Traits section, and
  `counterparts fired` has a traits row.
- **The dashboard's Self tab shows them as "How I act"**: one bar per scale, marking
  where Claude has leaned lately and where it was a week ago. Tap a bar to see the
  memories behind it.

Seeing it.

- `doctor` has a Reflection line: when it last reflected, whether the page was
  rewritten, whether the share was told, the week's returns by where they came from
  (awake, reflection, dream), and how many memories became core on reflection alone.
- `counterparts mechanisms` counts reflections beside dreams, and a dream's core
  suggestions apart from its changes ("2 dreams this week (60 changes, 3 core
  suggestions)"). The dashboard says the same.
- The dashboard's core views ask the same question sleep asks, so they never show a
  memory as ready when sleep won't make it core (with `--reflected-feeling off` too).
  Home's Tonight box says whether Claude will ask to dream next session, and why not
  when it won't.

**The dashboard's Memories tab, round 3.** A memory's card says when one return would
make it core, and says "written, day N" until it is first used. Ask lists a chapter and
the memory it came from once. Version rows say when a dream merged near-copies. Ask now
reads your question in Claude's voice ("what do you remember about me?" searches "what
do I remember about" and your name) and shows what it searched, with "search exactly as
typed" to turn that off.

**The dashboard's Home tab, round 3.** Less on the page. The mechanism pills sit on one
line. Each mechanism shows one number, up to five of the memories behind it, and one line
on what it does; the rest is under "how it works". New: a strip of what was written and
what came back each day, a Tonight box (what the next sleep will do, what is close to the
core, what is near being let go), and how often what came to mind was used. Sleep checks
that did nothing move to the flow feed, and repeated lines fold into one. The core tile is
a count, and the chapters column is gone (both live on Self).

**The dashboard's Self tab, round 3.** The page's history is one strip, a dot a day: a
filled dot is a day it was rewritten, a hollow one says why it wasn't, in plain words. A
line above the page says when it has fallen behind. "Next time I wake, I start with:"
lists what the next session opens with. A map of the memories about Claude and the two of
you replaces the "closest to the core" list: the core in the middle, the closest near it.
The journal's day strip shows dates. The wake's size moved to Health.

**Health and empty pages.** Health no longer marks a step amber when it simply wasn't due
yet (consolidate and fade run every three lived days). Empty panels say "(none yet)" in
plain words.

## 0.3.4 — 2026-09-26

Memories stay strong by coming back, the core is for what is about the two of you, and
Counterparts can dream. **The store's format changes (v7 → v8).** The first Claude Code
session after installing copies the store (as every upgrade since 0.3.1 has) and upgrades
it; until then `counterparts doctor` says (amber) that the next session will upgrade it,
and the dashboard asks you to open a session. Close every session before installing, and
run `/mcp` → Reconnect in any you missed.

Staying strong.

- **A memory that comes back fades more slowly.** Each time a memory is used again on a
  later day, it gets harder to lose — a lot after a week or more, a little the next day,
  and never less than before. This replaces the one-time bonus a memory used to get for
  surviving its first day.
- **Nothing you already have moves down.** Every memory in your store keeps the old
  bonus path exactly, so no memory drops a band or will be let go sooner because of the
  upgrade. The first sleep after the upgrade checks this on every memory, and `doctor`
  prints what it found (an "Upgrade" line).
- **The days a memory was already used count as coming back.** At the upgrade, every
  day a memory was used before counts toward fading more slowly. A memory the old rules
  were about to make core but the new ones do not (a well-used fact, say) stays strong
  that way instead, and `doctor`'s Upgrade line says how many there were.
- **"Nearby, if it helps" takes turns.** The wake's "Nearby" lane no longer shows the
  same strong memory every day. A memory Claude uses because it was showing there still
  counts as a use, but not as coming back; one shown a lot gives way for a while, and
  returns to the lane over a few days.

The core.

- **Only memories about Claude, or about the two of you, become core** — kind `self`, and
  memories about a person that name you. Facts, skills and places never do, however often
  they come back.
- **Two ways in.** Strongly felt (by you or by Claude) and it came back at least once, a
  couple of days later. Or it kept coming back — on five separate days over three weeks.
- **At most three a night**, strongest first; the rest wait for the next sleep.
- **You can send one back.** `counterparts core` lists the core (with how each got
  there), what dreams nominated, and what you sent back; `counterparts core --demote <id>
  --reason "..."` returns a memory to ordinary fading from today and keeps it out.

Dreaming.

- **Once a day, when there is something new, Claude may ask you "I haven't dreamed since
  … — OK if I dream for a few minutes?"** at a natural moment. Say no and it will not
  ask again that day. Say yes and a background agent replays what you lived since the
  last dream beside what it resembles.
- **What a dream can do**: merge near-copies into one memory in better words (the
  originals are kept), link memories that belong together, replay what matters (it
  strengthens them a little), write down a pattern it notices (labelled "Dreamed", and
  it starts weak until it proves true), flag two memories that disagree (Claude raises
  them with you next session), record how an old feeling sits now, and nominate a
  memory for the core. It cannot delete anything, change the self page, make anything
  core, or rewrite a memory in place.
- **A dream journal.** Every dream keeps a journal entry, apart from your memories — a
  dream is never remembered as something that happened. `counterparts dream` lists
  them, `--show <id>` shows the journal and every change, and `--undo <id>` reverses a
  whole dream. The dashboard's self page shows the journal and what each dream changed.

Seeing it.

- `counterparts mechanisms` and the dashboard: Consolidation now lights up on real
  evidence (memories coming back, merges, memories becoming core); **Dreaming** is a new
  light beside it; Gist is partly built (a dream's pattern). The self page shows what
  became core lately and by which way, what you sent back, and what dreams nominated.
- `counterparts fired` has rows for returns, dream replays, dreams, dream changes, the
  daily ask, demotions and the upgrade check.

**The dashboard's Memories tab, round 2.** One idea across the tab: brighter means held
more firmly. The map of everything held plots strength against age, marks the core with a
★ and turns amber what would be let go within two weeks if it isn't used. Kinds are chips
in the list's filter row; each row shows a title, its date, the kind and its feelings, and
sorts newest or oldest first. A memory's card shows its strength curve, why it mattered,
the days it was used, its versions as one timeline, and the raw numbers under "details".

**The dashboard's Home tab, round 2.** One headline count, four small tiles (memories,
core with the closest candidate's progress, chapters, replaced), and the mechanism lights
as built, partly built or not built, with a new "waiting" ring for a mechanism that ran on
schedule with nothing to do. The dashboard and `counterparts mechanisms` now read the same
evidence for each light, so the two agree. Home's feed shows memory events only; the
housekeeping stays in the flow feed.

## 0.3.3 — 2026-09-26

Reminders with dates, and feelings start to matter. The store's format is unchanged (still
v7), so there is no upgrade step; close every Claude Code session before installing, and
run `/mcp` → Reconnect in any you missed.

Reminders work.

- **A memory can carry a date, and it comes back around then.** `note` and each
  `session_end` memory take an optional `eventDate`: a day `2026-10-15`, a month
  `2026-10`, or a range `2026-10-20..2026-10-31` (how to say "late October"). Claude writes
  the date itself; nothing is read out of the text, and a date that cannot be read is
  refused with the shapes that can. A year alone is kept but never comes back on its own.
- **Plain or quiet.** Beside the date, `remind: "plain"` for something that really has to
  happen — a deadline, an important day, or anything you say not to forget. On its day
  you see it in the terminal (`Today: pay your taxes`) and Claude has it in context, once;
  a month or a range is said on its first day and again on its last. Everything else is
  quiet, the default: it can come back as a footnote around the date, at most twice.
  Giving a memory a date is what makes it eligible, however ordinary the memory; one that
  has faded away or been archived still never comes back.
- **A plain line is spent only when you can see it.** If the morning's wake is too full
  for the terminal line, it waits for your first prompt instead of being used up unseen,
  and the update notice never pushes it out.
- **A quiet reminder is not repeated every turn.** A footnote that came back spends one of
  its two mentions, at most one a day. Month and range dates spread their warmth over the
  first week instead of all landing on the 1st, keep their second mention for after the
  dates pass, and never take one of the wake's two "Arriving" lines — those are for
  day-dated things, and a tie goes to the one happening sooner.
- **The gauge shows it.** `counterparts mechanisms` and the dashboard's Prospective light
  count dated memories held and reminders that came back this week, plain and quiet apart
  (the dashboard adds today's). Grey only when nothing is dated.
- **Revising a dated memory keeps its date.** A revision (`updates:`) that leaves the date
  or `remind` out carries them over, and the older memory stops coming back, so one
  reminder is never said twice; `eventDate: null` drops the date. The reminder is found
  where it moved even when a later revision names the older memory, and what was already
  said or used for the same window still counts after the move.
- **A date that has already passed is kept, and the reply says it won't come back**, so a
  wrong year can be caught when it is written.

**Feelings start to matter.** No change to the store's format.

- **A memory's strongest feeling holds it higher and makes it fade more slowly** — yours or
  Claude's, or its emotional score if that is stronger. This changes how existing memories
  fade too: the ones that carry feeling now last longer (a strongly felt note about 1.7
  times as long before it is let go). The first nightly cleanup after upgrading may move a
  few felt memories up a band. Feeling does not count toward becoming core: what it takes
  to reach identity is unchanged.
- **A recorded feeling softens faster than the memory it sits on.** The feeling is kept as
  it was recorded; the softened strength is what recall and the displays read.
- **Mood-matching.** When a feeling was recorded in the last few hours, memories that
  carried the same feeling for the same person come to mind more easily, and the other
  person's matching feelings help a little. It only helps a memory the conversation
  already reached — it never brings up one on its own.
- **An emotional score given on its own is no longer ignored by the memory gate.**
- **More words on the feelings wheel**, from real use: grateful, curious, tender,
  sheepish, relieved, moved, wistful, bittersweet, fond and intrigued (marked as
  additions, not the poster's), and "exposed" reads as vulnerable. Blends count under
  both their feelings (tender: sad and happy). A word that is not on the wheel is kept as
  your own, and the reply suggests a wheel word only for a near misspelling — "tender" is
  no longer offered "despair".
- **Showing it.** The dashboard's memory view and `counterparts ask --full` / `--id` show a
  memory's feelings as `you: … · me: …`. The Emotion light on the dashboard and in
  `counterparts mechanisms` now counts memories carrying feeling and turns where a mood
  brought memories closer.

**The dashboard's Self tab, round 2.** Lighter: one line on top, with the explanations
behind a small `?`. Beside the page, a side column says when it was last rewritten, what
the page writer did on its last night, the version dots and how much of the wake it
takes. A version's changes open on a click, settling is one compact chart, the journal is
a strip of days, and the tab refreshes itself while it is open. The Health row says how
many days since the page was rewritten.

## 0.3.2 — 2026-09-25

Dates and times follow your clock, and the store's format moves to v7.

**Before upgrading, close every Claude Code session.** The first session after the upgrade
saves a copy of the store and then updates its format; a session left open is still
running the old memory server, so in any you missed, run `/mcp` and choose Reconnect.
If your store is not in the default place (a `dataDir` outside `~/.counterparts/store`,
or `COUNTERPARTS_DATA_DIR`), set `snapshots.dir` in the config first: the upgrade will
not run without somewhere to save that copy, and memory stays off until it is set
(`doctor` says so).

- **Your day is your local day.** The day a memory was learned, "today", and the dates
  in `doctor` and `counterparts fired` now use this computer's time zone instead of UTC,
  so a memory saved at 11:50 pm belongs to that evening. Console commands read the zone
  from the config beside the store, as the hooks do. Memories saved before keep the
  dates they have. A `timeZone` setting in the config (for example `"America/Denver"`)
  pins a zone, for a machine set to UTC; install says which zone it found.
- **Sessions know what time it is.** The wake opens with a line like
  `Now: Fri 25 Sep 2026, 1:40 pm MDT`, and every turn carries the current time too.
- **Each memory records when it was written and changed, and which model wrote it.**
  Notes, end-of-session memories, journal chapters and the self page carry the model the
  session was using.
- **Feelings can be recorded on a memory** — several per memory, yours and Claude's side
  by side, each named on a feelings wheel (six core emotions and the finer words under
  them) with a strength and what carried it. `note` and `session_end` take them; a word
  not on the wheel is kept, and the reply suggests the nearest ones. They change nothing
  about how memories are held yet.
- **The store can hold a reminder's date** — a day, a month, or a range like
  `2026-10-20..2026-10-31` — ready for reminders to use in a later release.
- One module now does every date conversion, and a test keeps it that way.

**A new dashboard** (`counterparts dashboard`):

- **A new home page**: the brain beside a few plain counts, and the 11 mechanisms the
  site describes, each lit when it is working. Click one to see what it did lately.
- **Memories**: every memory in a list, newest first, with search, Ask, and filters for
  kind, band and archived.
- **Self**: the self page with its history, what is settling into the core, the
  briefing for the next session, and the journal by day.
- **Health**: "is it working?" as a checklist from `doctor`, the last sleep cycle, and
  where archived memories went.
- **Manage memory from the dashboard**: write a note, remove a memory, back up, export,
  rebrief, check the index, and ask, through the same code as the console. Removing
  asks you to confirm first.
- The site's fonts, served from the package.
- A store waiting for its upgrade shows a short page saying so, instead of an error.

## 0.3.1 — 2026-09-25

A small release of fixes. No change to the store's format, so no migration and no
Reconnect.

- **Cards for people, places and the identity core are no longer archived after about
  90 days of use** (#215). The nightly cleanup was treating them like ordinary memories.
  They now fade only through a gentle phase of their own: months of quiet on both the
  lived and the calendar clock (180 days, 365 for people), never while beliefs still
  hang on them, and never the identity core. Nobody's store is old enough to have been
  hit, which is why this ships now.
- **A faded card comes back when a saved memory names it** (#220), and **a card named
  in a saved memory counts as used** (#218), so the people and things you still talk
  about stay live.
- **Prompts typed while Claude is still working are saved** (#213). They were missed
  before, about one typed prompt in twelve.
- **A checked snapshot is taken before any change to the store's format** (#214). If the
  copy can't be made, the change waits. `doctor` shows a store that needs one: red when
  the copy can't be made, amber when it can.
- **Each journal chapter records the model that wrote it** (#217).
- **`counterparts fired` and `doctor` show fading** as a mechanism of its own.

## 0.3.0 — 2026-09-24

No API keys: nothing leaves the machine except through Claude Code. A quieter end-of-turn
ask, paced by what you type. `counterparts ask` searches by meaning.

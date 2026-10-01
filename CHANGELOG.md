# Changelog

## Unreleased

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
- Asking recall by feeling finds more of what was felt. Any feeling word reaches its family on
  the wheel: "when was I afraid", with nothing recorded as afraid, answers with the strongest
  uneasy moments, and a moment recorded as afraid still comes first. Everyday words off the
  wheel ("shame", "dread", "relief"), forms like "happiest" or "sadness", and phrases like
  "caught out" are understood, and so is your name in the possessive ("Mike's feelings"). Asking for the most, the
  strongest, or "ever" ranks by how strongly something was felt at the time, not by how fresh
  it is. Memories that only talk about feelings (notes on the wheel itself, say) no longer
  crowd out the moments that were actually felt.

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

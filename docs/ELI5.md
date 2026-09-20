# Counterparts in plain words

*Written 2026-09-04 for anyone who wants the shape of the thing without the code. The
technical map is `docs/module-map.md`; the law is `CONSTITUTION.md`. This page is a
working default like everything else, and it is allowed to be simple.*

## The app in one breath

Counterparts is a memory for an AI that forgets everything between conversations.
Instead of saving transcripts, it writes down what was learned, in the AI's own words,
lets unimportant things fade the way human memory does, keeps a sense of "who I am" that
survives across sessions, and quietly reminds the AI of relevant past things while you
talk. The AI is the author. A sweep of the transcript exists only for the day the author
never got to write.

## The core, the brain: knows nothing about any particular app

- **store** — the filing cabinet. One small database holds the memories themselves — their
  words, their earlier drafts, and everything the system knows about each one — with a
  throwaway cache beside it for search indexes that can always be rebuilt, a plain-markdown
  copy of the diary written as each chapter lands, and a snapshot taken once a day. You can
  read any memory in the console or the dashboard, and `counterparts export --markdown`
  writes them all out as files whenever you want them as files.
- **physics** — the one page of arithmetic. How strong a memory is, how fast it fades,
  how much a use reinforces it, how much pressure it takes to revise a belief. No
  opinions, no model calls.
- **encode** — the bouncer at the door. Strips secrets, refuses junk, scores how new and
  how important each memory is as it enters.
- **remember** — the front door itself. Takes what the AI writes at the end of a session
  and in the moment, and keeps the transcript sweep as the crash fallback.
- **recall** — the nudge in the ear. Turns what you just said into cues, activates
  related memories, and injects a few as quiet footnotes, rarely loudly. A chapter of
  the journal can come to mind the same way, and every one that does is labelled
  `Journal:` — an account is not a memory.
- **associate** — the web between memories. Things that come up together get linked,
  and activation spreads along the links.
- **schemas** — what the AI believes about people and things. Each entity has beliefs
  and current facts; beliefs are revised only under accumulated pressure, keeping their
  history.
- **self** — the autobiography. Identity, the episode journal written in chapters, and
  the wake-up briefing every session starts with.
- **prospective** — the calendar. Intentions for the future, cued by a date or a context.
- **sleep** — overnight housekeeping. Fades, prunes, promotes, merges duplicates,
  re-renders the wake-up briefing. Pure math, no model calls, and it never touches the
  journal.
- **the seams** (`counterpart`, `mint`, `retrieval`, `briefing`, `revision`, `bridge`) —
  the wiring between the organs, each in exactly one file so each rule lives in one
  place.

## The adapters: one per host

- **claude-code** — the hooks. Injects the wake at session start, runs recall on each
  prompt, captures each turn at Stop, asks for memories and the chapter, spawns the
  background worker.
- **mcp** — the tools the AI calls on purpose: `note`, `recall`, `status`, `session_end`,
  and `chapter`.
- **cli** — the owner's console. Status, backup, export, delete, and the one-off repairs.
- **dashboard** — the owner's window into the brain. What it remembered, what faded,
  what changed and why.
- **sessions** — the guest list the hooks keep so a tool can find out which session it
  belongs to.

## The tools: for building and judging it

- **replay** — feeds a recorded month of bansai's real inputs through Counterparts and
  compares against the baselines.
- **parallel** — the referee for the bansai-versus-Counterparts run. Reads both stores,
  writes only the run directory.
- **recall-bench** — runs real prompts against a copy of a store and reports what
  surfaced, so recall changes are measured, not trusted.

## How a day goes

1. A session starts. The wake arrives: a short header saying which system this is, which
   day, how big the store is, then who the AI has been, in its own words.
2. You talk. On each prompt, recall looks for cues, and a few related memories ride
   along as footnotes. Once in a while one is loud. What rides along may be a chapter
   rather than a memory, and it says which.
3. Every few turns the AI is asked, once, for two things: what it learned (memories)
   and the next chapter of the session's episode. It writes both itself.
4. Overnight, sleep fades what was not used, keeps what was, and re-renders tomorrow's
   wake. The journal is never faded.
5. If a session died before the AI could write, and only then, the sweep reads the
   transcript and writes what the AI would have.

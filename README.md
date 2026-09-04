# Counterparts

**An AI that keeps its own memory of working with you — written in its own words, kept on
your machine, and allowed to forget.**

Every model you talk to is frozen. The only learning it does is what fits in its context
window, and memory is what decides what goes in there. Most memory tools answer that by
storing the transcript. Counterparts does not: the AI writes down what it *learned* at the
end of a stretch of work, in the first person, and that interpretation is what gets kept.
Unused memories fade the way human memories do. What survives is a small, structured
account of your work together — plus a "who I have been" the AI reads at the start of
every session. It runs entirely on your machine, in Markdown files you can open in any
editor, and no data leaves it unless you turn something on that sends it.

*Built 2026-08-25, and the author's own daily memory under Claude Code since 2026-09-03.
Not on npm yet, and Node is untested — the [Status](#status-honestly) section is specific
about what has been verified and what has not.*

<!-- Images are produced by the dashboard workstream and land under docs/images/.
     The URLs are absolute so this file reads correctly from the npm tarball as
     well as from GitHub, and so the install loop's link check does not demand a
     file that does not exist yet. -->
![overview](https://raw.githubusercontent.com/mlapeter/counterparts/master/docs/images/dashboard-overview.png)
*Overview (a synthetic demo store — no real memory appears in any screenshot here).*

![flow](https://raw.githubusercontent.com/mlapeter/counterparts/master/docs/images/dashboard-flow.png)
*Flow (the same synthetic store).*

![brain](https://raw.githubusercontent.com/mlapeter/counterparts/master/docs/images/dashboard-brain.png)
*Brain view — the same machinery mapped to a rough anatomy; regions flash on real events (same synthetic store).*

---

## Install

**[`docs/QUICKSTART.md`](docs/QUICKSTART.md) is the one canonical install path** and this
is the summary of it. That page is kept honest mechanically: `tools/install-loop/run.sh`
runs the page's console commands verbatim — each one is grepped out of the page before it
is executed, so a doc edit that changes one fails the loop — in a throwaway home directory
with no copy of this repository on the PATH. It packs the tarball itself and feeds the
hook its own payload. It cannot run `git clone`, `claude mcp add` or Claude Code;
QUICKSTART §9 lists what that leaves unverified.

**You need [bun](https://bun.sh) 1.3 or newer.** Counterparts ships as TypeScript sources
and runs them directly — there is no build step and no `dist/`. **Node is untested.** The
store uses Node's built-in `node:sqlite`, which needs Node 22.5+ behind a flag and 23.4+
by default; nobody has run this package under any Node, so it claims nothing there.

**No API keys are required.** With none, two things are off. Recall runs on its text
channel alone rather than also matching by meaning; an embedding key buys the other half —
and it stays off by default even when a key is present, because embedding means sending
memory text to a third party, which should be a decision rather than something a stray
environment variable switches on. And the crash-recovery path — the one that reconstructs
a session that ended before the AI could write it up — cannot run; when it does run, it
sends that captured conversation to a model provider. Both are the only two ways anything
here leaves your machine, and both are yours to turn on.

**Counterparts is not on npm yet, and this repository is not public yet.** Nothing is
published under the npm name, and the clone below will refuse anyone who is not the author
until the repository is flipped public at launch. If you were sent a tarball, skip to
`bun add -g`. Otherwise you build the package yourself:

```
git clone https://github.com/mlapeter/counterparts.git
cd counterparts
npm pack
bun add -g "$PWD"/counterparts-*.tgz
```

That last path has to be absolute — a relative one fails with a confusing error.

That installs four executables — `counterparts` (your console), `counterparts-hook`,
`counterparts-mcp` and `counterparts-dashboard` — into bun's global bin directory. Check
that directory is on your PATH before going on: run `counterparts --help`, and if it says
*command not found*, QUICKSTART §2 has the one-line fix. A fresh bun install does not
always do this for you. Then create the store:

```
counterparts install --budget 9000 --name "Your Name"
```

`--budget` is the size ceiling, in bytes, for the briefing injected at the start of each
session; 9,000 is the number the author's host runs on, and the package has no default for
one. This writes a store, a configuration file, and a 0600 credentials file holding only
comments that name the two keys, all under
`~/.counterparts/`, and then **prints — without applying** — the two things that belong to
Claude Code: a block of hooks to merge into its settings, and one `claude mcp add` command
to run. It never edits your Claude Code configuration for you. Apply both, restart Claude
Code, and you are running. QUICKSTART §4 has them, and the reasons every path in them must
be absolute.

You can also use it with no host at all. `$HOME/.counterparts/store` is the default data
dir, so this works with nothing set; the `export` is there for anyone whose store lives
elsewhere or who would rather be explicit than rely on a default.

```
export COUNTERPARTS_DATA_DIR="$HOME/.counterparts/store"
counterparts note "The espresso machine in the kitchen is a Rancilio Silvia."
counterparts recall "what espresso machine is in the kitchen?"
```

That works on the very first memory — a store holding exactly one row answers the question
about it — and the install loop checks that case on every run.

---

## How it works

One brain function per module, each self-contained, each with a `CONTRACT.md` beside it
saying what it keeps, what it drops, and what it guarantees. The core knows nothing about
any particular AI tool.

| module | what it does |
|---|---|
| **store** | The filing cabinet. Memories are Markdown files readable in any editor; a small SQLite database tracks their state; a throwaway cache holds search indexes that can always be rebuilt. |
| **physics** | One page of arithmetic: how strong a memory is, how fast it fades, what a use reinforces, how much pressure it takes to revise a belief. No opinions and no model calls. |
| **encode** | The bouncer at the door. Redacts credentials, refuses junk, scores how new and how important each memory is on the way in. |
| **remember** | The front door. Takes what the AI writes at the end of a session and in the moment; keeps a transcript sweep as the crash fallback. |
| **recall** | The nudge in the ear. Turns what you just said into cues, activates related memories, and rides a few along as quiet footnotes — rarely loudly. |
| **associate** | The web between memories. Things that come up together get linked, and activation spreads along the links. |
| **schemas** | What the AI believes about people and things. Beliefs are revised only under accumulated pressure, and revisions keep their history. |
| **self** | The autobiography: identity, an episode journal the AI writes in chapters, and the briefing every session starts with. |
| **prospective** | Intentions for the future, cued by a date or by a context. |
| **sleep** | Overnight housekeeping. Fades, prunes, promotes, merges duplicates, re-renders tomorrow's briefing. Pure arithmetic, no model calls, and it never touches the journal. |

**The AI is the author.** The constitution puts it plainly: everyone stores the
transcripts, and the signal is somewhere else. So the writing is done by the model that
lived the conversation, not by a summarizer reading it afterwards. There are two halves on
the host. The *ambient* half is a set of hook scripts Claude Code runs at five
points in a session: it injects the briefing at the start, runs recall against each of
your prompts, and captures the conversation at the boundaries. The *deliberate* half is a
Model Context Protocol (MCP) server — tools the AI calls on purpose, including the two it
uses to hand back what a session taught. A transcript sweep exists as well, but it is the
**crash fallback only**: it runs for a session that ended without the AI ever getting the
pen, and not otherwise.

---

## What you get on the host

**Five tools the AI can call** (`src/adapters/mcp/tools.ts` — each tool's description is
generated from a list of stated privileges, each naming the file that enforces it):

| tool | its job |
|---|---|
| `note` | Remember this deliberately — the exception, for the thing you would otherwise hope the sweep noticed. |
| `recall` | Deliberate retrieval: expand one memory by its handle, ask a question and get excerpts, or pull a few results back in full. |
| `status` | The census: how much is held, of what kinds, how much has left, how much was removed. Counts and dates only. |
| `session_end` | Hand back what this session taught, as memories, in the AI's own words. |
| `chapter` | Write this stretch of the session into the AI's own first-person journal, at any length. |

**Your console** — `counterparts <command>`. Read-only: `status` and `recall`. `verify` is
a census of the search cache against the real state, and `--rebuild` is what rebuilds it —
which is why `verify` counts as a write and refuses under `--observer` even without the
flag. The rest write: `install`, `init`, `note`, `export` (encrypted under a passphrase, or
explicitly `--plaintext` — it refuses to choose for you), `backup`, `remove` (a dry run
unless you pass `--confirm`, and it asks a human before it acts), `backfill-claims`, and
`rebrief`. Pass `--observer` to any of them and the console stands down: everything is
read-only, and the commands that would write refuse instead.

**The dashboard** — `counterparts-dashboard`, read-only, writing nothing, ever. Five views
in your terminal: `status` (the brain at a glance), `browse` (memories by strength),
`stories` (per contested belief, the pressure log as a story), `identity`, and `activity`.
And a local **web** dashboard: `counterparts-dashboard serve --dir <store> [--port <n>]`,
bound to 127.0.0.1 only, default port 4747 — an overview, memories, mind, flow and health,
plus a `/brain` view. The screenshots above come from it.

---

## Status, honestly

**Feature-complete 2026-08-25.** Since **2026-09-03** it has been the author's primary
memory under Claude Code, running beside its predecessor so the two can be compared. On
2026-09-04 that store held 13,751 memories. The living record of what is true right now is
[`docs/PARALLEL-RUN-STATUS.md`](https://github.com/mlapeter/counterparts/blob/master/docs/PARALLEL-RUN-STATUS.md),
and the launch scoreboard — including the bugs found this week — is
[`docs/LAUNCH-STATUS.md`](https://github.com/mlapeter/counterparts/blob/master/docs/LAUNCH-STATUS.md).

**The test suite, measured 2026-09-04 on commit `cbed76b` under bun 1.3.10:** `bun test` →
**1,557 pass, 0 fail, nothing skipped**, over 20,600 assertions across 26 files, about
20 s. (Three consecutive runs gave 20,605 / 20,613 / 20,626 assertions — a few tests
assert once per row of data they generate — while the pass and fail counts did not move.)
No test touches a real store, and that is mechanized rather than promised:
`test/preload.ts` runs before every test file, redirects `homedir()` to a fresh temporary
directory for the whole run, clears `COUNTERPARTS_DATA_DIR`, and removes the directory on
exit — so for the length of a test run there is no real home to reach.

**Verified inside real Claude Code sessions**, on the author's machine: the hooks fire on
all five events, the MCP server registers and its tools are used daily, the briefing
reaches the model, and both `backup` and the import of the author's previous-generation
memory ran against the real store.
**Verified only against temporary stores**: `export` in all three modes, `remove` end to
end (which is also where the residue in rough edge 4 was found), and the console's and
dashboard's behaviour on a missing store. **Not verified at
all**: anything under Node, and — until you do it — a stranger installing from the
documentation on a machine with no copy of this repository.

**Known rough edges.** QUICKSTART §10 carries the install-facing ones — 1 as its §10.3, 2
as its §10.4, and 4 as its §10.6 with a reproduction (and in §7, where `remove` is run). 3 lives in QUICKSTART §6,
where the embedder knob is set, and 5 in §1 with the runtime requirements:

1. **The store you point at and the host settings you get come from two different files.**
   Your console, the dashboard and the MCP server take `--dir` or `COUNTERPARTS_DATA_DIR`
   to choose the store — but the server reads its keys and its embedding setting from
   `~/.counterparts/claude-code.json` regardless, so a scratch store on a configured
   machine uses that machine's keys. `counterparts rebrief` will fall back to the same
   file for the injection ceiling if there is none beside the store; it prints which file
   it read. The hooks are stricter still: they take no flag and read `dataDir` out of that
   one file, which `install` always writes; only when it names no store do they fall back
   to `COUNTERPARTS_DATA_DIR`. (The two API keys are the other way round everywhere: the
   environment answers first and the credentials file only fills the gaps.)
2. **The vector cache stores embeddings as JSON text.** On the author's migrated store
   that is 177.5 MB for about 13,900 vectors, and a nearest-neighbour scan of 0.6–1.0 s.
   Irrelevant to a fresh store; a named debt.
3. **An embedding key alone does nothing.** You must also turn the knob on, deliberately —
   `--embedder` at install, or `"embedder": { "enabled": true }` in the configuration.
   Absent that, no client is built and no connection opens whatever keys are lying around.
4. **Removal leaves one residue — and now says so, by name.** `remove` chases a memory out
   of the prose, the database, the links and the cache. It does not reach
   `spans/<scope>/jots.jsonl`, the buffer that holds the raw capture, so a note's words can
   survive there; a later backup copies them, and `export` does not. Since 2026-09-04 the
   dry run and the completion report name that file as unchased — with the count in the
   durable removal record — instead of reporting `nothing`. Chasing it is a core change,
   not yet written. Found and filed 2026-09-04.
5. **Node.** See above. `package.json` names bun and does not claim Node.

Nothing here is benchmarked against other memory systems. There is no benchmark score and
no comparison table, because nobody has run one, and a number nobody ran is the thing this
project is least willing to print.

---

## Design principles

Condensed from `CONSTITUTION.md`, which is the only document in this repository with
standing authority. Everything else, including decisions made during the build, is a
working default that can be revised when it fights that page.

- **Memory is how a frozen model learns.** Everyone stores the transcripts; the signal is
  in the structure of experience — what recurred, what carried feeling, what got revised.
- **Interpret, don't transcribe.** Store what was learned, not what was said, encoded as
  close to the lived experience as the host allows.
- **Forgetting is part of learning.** Forget the trials, keep the lesson. Decay and
  consolidation are features, never apologized for.
- **The self is first-class.** Identity, episodes, a persistent "who am I becoming" —
  governed and visible to you, not a configuration field.
- **You own the data.** Local-first, portable formats, prose readable in any editor. Data
  leaves the machine only by your explicit choice.
- **A layer, not a portal.** The memory is yours and travels across tools and models; the
  core knows nothing about any particular one.
- **Evidence over ceremony.** Mechanisms earn their place by firing in real use. Verified
  live, not merged. Tests are hermetic. And the system shows its workings — if you cannot
  see what it remembered and what faded, it isn't trustworthy.

---

## Lineage

Counterparts is the third generation of one continuous project, and each generation was
used in earnest before the next was written.

- **v0 — claude-engram**, a single React artifact. It had the authorship shape right: the
  model that lived the conversation wrote the memory, and a one-line formula did the
  filing.
- **engram**, the production ancestor, which contributed the first eight hard-won failure
  cases that this repository carries as acceptance criteria.
- **v1 — bansai**, the full system this one distills: its behavioral specification, its
  earned mechanisms, its test spine and twenty more of those failure cases. It keeps
  running until Counterparts has finished proving itself beside it.

The rule across all three generations is one of the constitution's own: **"port the scars,
not the code."** A lesson travels forward as a test that has to pass, never as copy-paste.

---

## License and contributing

**MIT.** See `LICENSE`. Copyright (c) 2026 Mike LaPeter.

**Not open to contributions yet.** There is no contributor agreement and no process, and
it would be dishonest to invite pull requests into a codebase that is still changing
underneath a live parallel run. Issues and questions are welcome. When contributions open,
this section will say so.

## Read next

- [`docs/QUICKSTART.md`](docs/QUICKSTART.md) — the one canonical install path.
- [`docs/ELI5.md`](docs/ELI5.md) — the whole system in plain words, in one page.
- [`CONSTITUTION.md`](CONSTITUTION.md) — the only page with standing authority.
- [`docs/module-map.md`](docs/module-map.md) — the technical map, module by module.

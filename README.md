# Counterparts

**An AI that keeps its own memory of working with you — written in its own words, kept on
your machine, and allowed to forget.**

Counterparts gives Claude Code a memory of you and your work. At the end of a stretch of
work the assistant writes down what it *learned*, in the first person, and that
interpretation is what gets kept. It all stays on your machine, in one small SQLite
database you can read, back up, or export as Markdown whenever you want.

## Install

```
curl -fsSL https://bun.sh/install | bash     # only if you don't have bun
bun add -g counterparts
counterparts
```

Check the middle line landed first: `counterparts --version` prints `counterparts 0.2.0`.
Then the bare command, with nothing set up, offers to do the rest — *No memory here yet.
Set it up now? [Y/n]*. `counterparts install` asks for the same conversation by name and is
also the repair: it is safe to run again. Nothing in it is compulsory:

- **your name** — what the memory calls you; Enter skips it;
- **Claude Code, connected for you.** It keeps a backup of your `~/.claude/settings.json`
  and says so, adds five hooks **beside** any hooks belonging to other tools, and registers
  the memory server. `counterparts disconnect` takes all of that back out and names the
  backup file; `--no-connect` means don't; no Claude Code on the machine is one line and
  the install carries on;
- **two optional API keys**, one at a time. Each is a `[y/N]` question with one line on
  what it buys — Enter is no — and only a yes shows the link and takes the key, typed
  hidden. **Skipping both is a supported way to run** — what you give up is written down,
  not glossed over.

Then **restart Claude Code** (the memory tools arrive when a session starts) and check that
it *works*:

```
counterparts doctor
```

Two checks, two moments: `--version` says the program is there, `doctor` says it is
running. Green is fine. **OFF** is one of the two optional things you never turned on — a
dim line, not a fault. Amber is worth a look; red is a part that is not running, and the
only grade that makes it exit non-zero.

**To remove it:**

```
counterparts uninstall
```

That disconnects Claude Code, **keeps your memory**, and names the one line that removes
the package itself. `--park` sets the whole `~/.counterparts` folder aside under a dated
name in one rename — and `counterparts install` finds it there and offers to bring it
back. `--delete-memories` destroys it instead, after listing every path with its size and
asking you to type `DELETE MEMORIES`; Esc, Enter or `cancel` at that prompt stops and says
nothing was deleted. Neither happens unless you ask for it.

The whole install path, with every flag and every reason:
[`docs/QUICKSTART.md`](docs/QUICKSTART.md) — §1 to §5 is all of it, and everything below
its "Reference" line is detail.

**You need [bun](https://bun.sh) 1.3 or newer**, and nothing else. Counterparts ships as
TypeScript sources and runs them directly — no build step, no `dist/`. **Node is
untested**; the [Status](#status-honestly) section is specific about what has been verified
and what has not.

<!-- Images are produced by the dashboard workstream and land under docs/images/.
     The URLs are absolute so this file reads correctly from the npm tarball as
     well as from GitHub, and so the install loop's link check does not demand a
     file that does not exist yet. -->
![overview](https://raw.githubusercontent.com/mlapeter/counterparts/master/docs/images/dashboard-overview.png)
*Overview (a synthetic demo store — no real memory appears in any screenshot here).*

![flow](https://raw.githubusercontent.com/mlapeter/counterparts/master/docs/images/dashboard-flow.png)
*Flow — the architecture, alive. A memory just typed at the console is arriving through the authored door, and only a real event ever moves anything here; the panel holds one mechanism (sleep, here), its brain analogy, and where that analogy deliberately breaks (the same synthetic store).*

![brain](https://raw.githubusercontent.com/mlapeter/counterparts/master/docs/images/dashboard-brain.png)
*Brain view — the same machinery mapped to a rough anatomy; regions flash on real events (same synthetic store).*

---

## Why

Every model you talk to is frozen. The only learning it does is what fits in its context
window, and memory is what decides what goes in there. Most memory tools answer that by
storing the transcript; this one stores the interpretation instead, and lets it fade —
unused memories decay the way human memories do. What survives is a small, structured
account of your work together, plus a "who I have been" the AI reads at the start of
every session.

**No API keys are required.** With none, two things are off. Recall runs on its text
channel alone rather than also matching by meaning; an embedding key buys the other half —
and it stays off by default even when a key is present, because embedding means sending
memory text to a third party, which should be a decision rather than something a stray
environment variable switches on. And the crash-recovery path — the one that reconstructs
a session that ended before the AI could write it up — cannot run; when it does run, it
sends that captured conversation to a model provider. Both are the only two ways anything
here leaves your machine, and both are yours to turn on. `counterparts doctor` grades a
store that has never had a key **OFF** — dim, optional, never turned on — rather than red
or amber, and says on the line what works without one, so a fresh keyless install reads as
a clean bill of health and not as an alarm.

**It works with no host at all.** `$HOME/.counterparts/store` is the default data dir, so
this works with nothing set:

```
counterparts note "The espresso machine in the kitchen is a Rancilio Silvia."
counterparts ask "what espresso machine is in the kitchen?"
```

That works on the very first memory — a store holding one memory answers the question
about it — and the install loop checks that case on every run.

**The hooks are registered once, globally**, so every directory you open a session in is
remembered by default. `counterparts scope . --off` says otherwise for one directory —
`--observer` for reads-only, `--pause` for an afternoon, `--resume` to put it back — and
the first session in a directory nobody has answered for asks you which you want.
QUICKSTART §8 has the rest.

**Starting over is one command.** If you want a blank memory — to see what a new user
sees, or because the first few days of a store are mostly you learning what it does —
close every Claude Code session and run:

```
counterparts start-fresh --config ~/.counterparts/claude-code.json
```

It renames your store beside itself as `store.parked-<today>` with a single atomic
rename, does the same with the snapshots folder, and creates a blank store back at the
same path. **It never copies, never deletes, and never opens the old store — not even
read-only.** Your configuration and your credentials are kept byte for byte, so there is
nothing to re-register; restart Claude Code and you are a new user. `--dry-run` prints
every rename and changes nothing, `counterparts start-fresh --undo` puts it all back, and
the same three moves are printed as guarded shell lines before anything moves.
QUICKSTART §9a has the whole of it.

---

## How it works

One brain function per module, each self-contained, each with a `CONTRACT.md` beside it
saying what it keeps, what it drops, and what it guarantees. The core knows nothing about
any particular AI tool.

| module | what it does |
|---|---|
| **store** | The filing cabinet. One small SQLite database holds the memories themselves — their words, their earlier versions and everything the system knows about them — with a throwaway cache beside it for search indexes that can always be rebuilt, a readable Markdown copy of the journal written as each chapter lands, and a rotating daily snapshot. `counterparts export --markdown` writes everything out as a tree of Markdown files; nothing reads any of those copies back. |
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

**Your console** — `counterparts <command>`. `counterparts --help` is fourteen commands in
three groups (Everyday, Setup, Your data), one line each; `counterparts help <command>` is
the detail for one; `counterparts help advanced` is the maintenance and developer half —
`note`, `fired`, `init`, `start-fresh`, `verify`, `rebrief`, the repairs, `probe-oq4`, and
the three flags that work everywhere. `counterparts --version` opens nothing.
Read-only: `ask` (the listed spelling of what the MCP tool still calls `recall`), `status`,
`doctor` (the one troubleshooting command, QUICKSTART §12), `fired`, `self-page` and
`probe-oq4` (the footnote-header probe, recall CONTRACT §7). `verify` is a census of the
search cache against the real state, and `--rebuild` is what rebuilds it — which is why
`verify` counts as a write and refuses under `--observer` even without the flag. `export`
is a read too: it copies the store — as one SQLite file, or, with `--markdown`, as a
readable tree of one file per memory plus the journal and the self page — encrypted under a
passphrase or explicitly `--plaintext`, because it refuses to choose for you. `--markdown`
omits confidential memories unless you pass `--include-confidential`, and says how many it
left out. The rest write: `install`, `init`, `connect`, `disconnect`, `uninstall`,
`credentials set`, `note`, `backup`, `start-fresh`, `backfill-claims`,
`repair-merged-beliefs` (a dry run unless you pass `--apply`), `rebrief`, and `remove` —
which at a terminal asks for an id or for words, numbers what it finds, lets you pick one
or several, shows the plan and asks once; `--confirm` is the scripted door, and anywhere
nobody can be asked it prints the plan and changes nothing. Pass
`--observer` to any of them and the console stands down: everything is read-only, and the
commands that would write refuse instead.

**The dashboard** — read-only, writing nothing, ever. `counterparts dashboard` starts the
local **web** dashboard on the store your configuration names — no `--dir` to get right —
prints `http://127.0.0.1:4747`, opens your browser, and stops on Ctrl-C. Bound to 127.0.0.1
only, it is where the screenshots above come from: an overview, memories, mind, flow and
health, plus a `/brain` view. The `counterparts-dashboard` binary is still there for the
five terminal views — `status` (the brain at a glance), `browse` (memories by strength),
`stories` (per contested belief, the pressure log as a story), `identity` and `activity` —
and for `serve --dir <store> [--port <n>]`, where `--dir` is not optional: without it,
`serve` refuses rather than opening the default store, names the store it would have
opened, and `--default-store` is how you say you meant it.

---

## Status, honestly

**First published on npm on 2026-09-21, as `counterparts@0.1.0`.** This is **0.2.0** — one
round of polish after the author installed that first release the way a stranger would,
and wrote down everything that was rough about it.

**It is the author's own daily memory under Claude Code.** Feature-complete 2026-08-25;
running beside him every day since 2026-09-03. On 2026-09-21 he parked the store that had
grown over those weeks, installed the published package from npm, and started again on a
blank memory — so the *store* he is running is new and the *code* is what has been
exercised daily for a month.

**2026-09-22 — the trial, and the round it produced.** The author took 0.2.0 as a tarball
into a plain terminal, with no Claude Code session and no help: swap the package, `--help`,
`doctor`, `uninstall --delete-memories` with the wrong phrase typed on purpose (refused,
nothing changed), `uninstall --park`, then `install` again. Every step did what the sheet
in front of him said it would, so what came back was not bugs but **words** — eleven of
them, written down as findings 17–27 in the repository's new-user-findings page and
answered one at a time. Six pull requests followed the same day (#170–#175), two of them
adversarially reviewed by a second agent first — the reviews are comments on PRs #170 and
#173, not files in this repository — and each review found a blocker: `remove` had been
deciding "is anybody there" from stdin alone, so a redirected stdout turned a dry run into
a live deletion; and `install --force` at a terminal silently replaced `claude-code.json`,
which on the new path could throw away a configuration a park had just handed back. Both
were fixed before merge.

**The test suite, measured 2026-09-22 on this branch under bun 1.3.10:** `bun test` →
**3,182 pass, 0 fail, nothing skipped**, around 41,000 assertions across 51 files, 80
seconds. The install loop runs 58/58. (The assertion count moves by a few hundred between
runs — a few tests assert once per row of data they generate — while the pass and fail
counts do not.)
No test touches a real store, and that is mechanized rather than promised:
`test/preload.ts` runs before every test file, redirects `homedir()` to a fresh temporary
directory for the whole run, clears `COUNTERPARTS_DATA_DIR`, and removes the directory on
exit — so for the length of a test run there is no real home to reach.

**The install loop, and what it cannot settle.** `tools/install-loop/run.sh` installs this
package the way a stranger would — from a tarball it packs itself, into a throwaway home
directory with no copy of this repository on its PATH — and runs 58 checks in about five
seconds: the store, the config, the credentials file, the hook fed a real payload, a note
and an `ask` on the console and again through the MCP server, the lazy session bind, the
scope switch, and the host's own files (`connect` merging beside another tool's hooks,
`disconnect` taking only ours back out, `uninstall` leaving the memory alone). It also runs
every console command on the QUICKSTART page verbatim, grepping each one out of the page
first, so a doc edit that changes a command fails the loop.
**What it cannot do**: reach the npm registry (it installs from disk), run `git clone`,
launch Claude Code, or run the real `claude mcp add` — a stub answers. And it runs
non-interactively, so the install conversation above is covered by unit tests and one run
on a real pty, not by the loop.

**Node is untested.** The store binds `bun:sqlite` under bun and `node:sqlite` under Node
(22.5+ behind a flag, 23.4+ by default), but nobody has run this package under any Node,
so it claims nothing there. `package.json` names bun and does not claim Node.

**Verified inside real Claude Code sessions**, on the author's machine: the hooks fire on
all five events, the MCP server registers and its tools are used daily, the briefing
reaches the model, and both `backup` and — in September 2026, with a one-shot tool this
repository no longer carries — the import of the author's previous-generation memory ran
against the real store. **There is no bulk import today.** A store this build writes starts
blank, and what comes over from an earlier generation is its own later conversation.
**Verified only against temporary stores**: `export` in all three modes, `remove` end to
end (which is also where the residue in rough edge 4 was found, and where the chase that
closed it is asserted — note, remove, grep the whole store, back it up and grep that), and
the console's and dashboard's behaviour on a missing store. **Not verified at
all**: anything under Node, and — until you do it — a stranger installing from this
documentation on a machine that is not the author's.

**Known rough edges.** QUICKSTART §11 carries the install-facing ones — 1 as its §11.3, 2
as its §11.4, and 4 as its §11.6 with a reproduction (and in §7, where `remove` is run). 3 lives in QUICKSTART §6,
where the embedder knob is set, and 5 in §1 with the runtime requirements:

1. **The store you point at and the host settings you get come from two different files —
   so you have to move both.** Your console, the dashboard and the MCP server take `--dir`
   or `COUNTERPARTS_DATA_DIR` to choose the store; the keys, the embedding setting and the
   injection ceiling come from a configuration file, and moving one does not move the
   other. A scratch store on a configured machine uses that machine's keys unless you say
   otherwise. Saying otherwise is one rule at every entry point — the console, the hook,
   its worker and the MCP server: `--config <absolute path>`, else `COUNTERPARTS_CONFIG`,
   else the default `~/.counterparts/claude-code.json` (the console looks beside the store
   first). A named path this cannot use — relative, or absolute and not there — is
   refused rather than quietly replaced by the default, and each entry point says
   which file it used: the console prints it, the server and the
   worker write a line to stderr, and the hook — whose only output channel belongs to the
   model — records it in the session file it writes under the store. The hooks keep the
   one asymmetry that is left: they have no `--dir`, so they take the store from the
   `dataDir` in whichever configuration they read, and fall back to
   `COUNTERPARTS_DATA_DIR` only when it names no store. (The two API keys are the other
   way round everywhere: the environment answers first and the credentials file only fills
   the gaps.)
2. **The vector cache stores embeddings as JSON text.** On the author's migrated store
   that is 177.5 MB for about 13,900 vectors, and a nearest-neighbour scan of 0.6–1.0 s.
   Irrelevant to a fresh store; a named debt.
3. **An embedding key alone does nothing.** You must also turn the knob on, deliberately.
   Since 2026-09-22 that is a command rather than a JSON edit: `counterparts credentials
   set VOYAGE_API_KEY`, typed at a terminal, saves the key and then asks whether to turn
   recall-by-meaning on with it (`--embedder` at install does the same, and
   `"embedder": { "enabled": true }` in the configuration is still what both of them
   write). Absent that, no client is built and no connection opens whatever keys are lying
   around — which is the point: a pipe, `--from-env` and CI are asked nothing and turn on
   nothing.
4. **Removal reaches every surface but one, and names the one.** `remove` chases a memory
   out of the database that holds its words and its earlier versions, out of the links, out
   of the search cache, out of the journal's markdown copy — and, since 2026-09-05, out of
   the raw-capture buffer under `spans/` (a 12-hex key per project, not the path), where a
   note's verbatim words wait to be interpreted. That last one was a real residue: found
   2026-09-04, a removed note's words stayed on disk and a later backup copied them.
   The buffer is a chased surface now, counted in the plan and in the report, and the
   struck span's hash is kept in the buffer's own ledger so the same words cannot be
   re-captured. Three things it names rather than takes, each on its own line: a
   conversation turn that merely QUOTES the note (transcript, many turns joined,
   belonging to no single memory — and **nothing prunes the buffer today**, so a `grep`
   of the store can still answer while the memory itself is gone); a memory whose words
   are already gone AND whose mint recorded no span hash, which has nothing left to
   address the buffer with; and a memory whose provenance records no scope — every row
   imported from a previous generation — where a chase by text would have to visit every
   project on the machine, so the command lists what it would have matched and stops
   unless you pass `--strike-by-content-across-scopes`.
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
- **You own the data.** Local-first, one portable file, every memory viewable — in the
  console, in the dashboard, or as Markdown you ask for. Data leaves the machine only by
  your explicit choice.
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
  earned mechanisms, its test spine and twenty more of those failure cases. It ran as the
  author's live memory until Counterparts took over.

The rule across all three generations is one of the constitution's own: **"port the scars,
not the code."** A lesson travels forward as a test that has to pass, never as copy-paste.

---

## License and contributing

**MIT.** See `LICENSE`. Copyright (c) 2026 Mike LaPeter.

**Not open to contributions yet.** There is no contributor agreement and no process, and
it would be dishonest to invite pull requests into a codebase that is still changing
week to week. Issues and questions are welcome. When contributions open, this section will
say so.

## Read next

- [`docs/QUICKSTART.md`](docs/QUICKSTART.md) — the one canonical install path.
- [`docs/ELI5.md`](docs/ELI5.md) — the whole system in plain words, in one page.
- [`CONSTITUTION.md`](CONSTITUTION.md) — the only page with standing authority.
- [`docs/module-map.md`](docs/module-map.md) — the technical map, module by module.

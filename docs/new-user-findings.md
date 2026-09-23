# New-user findings, and the plan for one round of polish

The owner installed `counterparts@0.1.0` from npm as a stranger on 2026-09-21. It works:
wake on a blank store, doctor 0 red, MCP tools connected. This page is what was rough, and
what we change before he uninstalls and installs again. Working notes, not a contract.

## What was rough (in the order he met it)

| # | What happened | Whose |
|---|---|---|
| 1 | `install` prints a 60-line JSON block and says "merge this yourself." He stopped here and asked for help. **The biggest barrier.** | owner |
| 2 | `counterparts credentials set ANTHROPIC_API_KEY` refused: "stdin is a terminal." A person at a terminal is the normal case. | owner |
| 3 | Nothing asks for the keys at all. Install should ask for the Anthropic key, then the optional Voyage key, and let him skip either. | owner |
| 4 | `counterparts --help` is 129 lines of dense paragraphs. As the "did it install?" check it is a wall of text. | owner |
| 5 | All terminal output is hard to read: long unbroken sentences, no spacing, no color. Doctor most of all. | owner |
| 6 | There is no `counterparts uninstall`. Today's removal was done by hand (hooks block, MCP registration, package, data folder). | owner |
| 7 | Doctor's "fix" for a missing key repeats the command that refuses (#2). | Claude |
| 8 | Doctor's Authorship line shows a week range (09-15→09-21) on a store made today. | Claude |
| 9 | Doctor's Sweep line stays amber "no-credential" after the key is added, until the next boundary. Reads like a fault. | Claude |
| 10 | QUICKSTART is 1,200+ lines and unreachable on the web while the repo is private. README Status section is stale; its images and two links point into the private repo. | Claude |
| 11 | New users do not have bun (Claude Code does not put it on PATH). One extra line, but the README should lead with it. | Claude |

## What a similar project does (hippo-memory)

`npm install -g hippo-memory && hippo init` — one line in the first screen of the README.
`init` finds Claude Code and patches its settings itself; `--no-hooks` opts out;
`hippo hook install|uninstall claude-code` repairs or removes the wiring. No keys needed.
No full uninstall. Worth taking: one line, wiring by default, a flag to opt out, a small
wiring sub-command. Not worth taking: scanning every repo, a machine-wide scheduler.

## The flow we want

```
curl -fsSL https://bun.sh/install | bash        # only if you have no bun
bun add -g counterparts
counterparts install
```

`install` then talks to the person, a few short questions, each skippable:

1. **Your name?** (what the memory calls you) — replaces `--name`.
2. **Wire Claude Code now?** Shows what it will add (5 hooks, 1 MCP server), backs up
   `~/.claude/settings.json` first, merges beside any hooks already there. `[Y/n]`
3. **Anthropic API key?** Hidden input. Enter to skip. One line on what it buys.
4. **Voyage key?** Hidden input. Enter to skip. Yes turns the embedder on too.
5. Ends with a short green summary and one instruction: "Restart Claude Code."

Flags keep the scripted path: `--name`, `--budget` (gets a default of 9000), `--yes`,
`--no-connect` (prints the blocks as today). Not a terminal → behaves as today, prints, asks
nothing. The install loop keeps passing because it runs non-interactive.

## The work, in five pieces

| Piece | What | Risk |
|---|---|---|
| A. Wiring | `counterparts wire` / `unwire` (install calls `wire`). Edits `~/.claude/settings.json` (backup, merge, never touch other hooks, refuse on JSON it cannot parse) and runs the `claude mcp add/remove` line. Idempotent. | **Highest** — it edits a stranger's host config. Adversarial review. |
| B. Uninstall | `counterparts uninstall`: `unwire`, then say how to remove the package (`bun remove -g counterparts` — a program cannot cleanly delete itself), and leave `~/.counterparts` alone unless `--park` (rename, dated) . Never deletes memory. | Medium. Review with A. |
| C. Keys | `credentials set <NAME>` prompts with hidden input at a terminal; stdin / `--from-env` unchanged. Install asks for both keys. Doctor's fix lines say the command that works. | Low |
| D. Words and color | One small formatter: color when it is a terminal and `NO_COLOR` is unset; doctor = a status word, a short line, the fix indented; blank lines between groups. `--help` becomes ~20 lines (one per command); `counterparts help <command>` holds today's detail. Install output rewritten short. | Low, but wide: many tests assert on output text. |
| E. Docs | README top = the three lines above. QUICKSTART §2–§6 rewritten around the interactive install; the long reference material moves below a line. Status section brought up to date. Doctor #8/#9 fixed or reworded. | Low |

How we build it: one builder per piece where files do not overlap (A+B together; C; D; E
after A–D land), Opus agents in their own worktrees, one adversarial review on A+B, the
coordinator runs the suite and the install loop on the combined branch. Then the owner
tries it **from a local tarball first** (`bun add -g /abs/path.tgz`) — so a bad round costs
no npm version — and only what he is happy with is published as **0.2.0**.

## The owner's answers (2026-09-21) — working defaults, not law

1. **Wire by default: yes, after asking first.** Preview, backup, then the change.
2. **Uninstall leaves `~/.counterparts` in place by default.** `--park` moves it aside under a
   dated name. `--delete-memories` deletes it, and only after a warning that counts what is
   about to go — `WARNING: this will delete 1,204 memories.` — and the person typing
   `DELETE MEMORIES` exactly. No `--yes` for that one.
3. **Trial from a local tarball first, then publish once as 0.2.0.**

Added by the owner the same day:

- Each key prompt carries **one line on what the key is for, and a link to where to get one**
  (Anthropic: console.anthropic.com → API keys; Voyage: dash.voyageai.com). Skipping is
  always offered and always fine.
- **Claude Code sessions will be open during an install.** Handle it gracefully: hooks and MCP
  servers are read when a session starts, so install says plainly "sessions that are open now
  will not have memory until you restart them" — and, where it can see them, how many. Same for
  upgrade (an open session keeps serving the old code) and for uninstall (an open session keeps
  its hooks until it closes; with `--park`/`--delete-memories` it must refuse while a Counterparts
  server or worker is running, and name what is running).

Also found on day 1: **#12** the `session_end` tool's schema does not list the `handoff` field
the Stop ask tells the model to set; sending a handoff with no memories is answered as an error
(`memories-required`) although the handoff was written.

## What 0.2.0 changed

One line per finding above, saying what happens now. Written 2026-09-21, from the branch
the five pieces landed on; the owner has not tried it from a tarball yet, so this is what
the code does rather than what he has seen.

| # | What happens now |
|---|---|
| 1 | At a terminal `install` asks `Wire Claude Code now? [Y/n]` and does it — backup first, the five hooks beside anything already there, `claude mcp add` for the server. A pipe, a script, CI and `--no-connect` still print the blocks and change nothing. (Superseded 09-22 by item 9: it no longer asks.) |
| 2 | `credentials set <NAME>` at a terminal asks for the value and reads it back without echoing; Enter skips and writes nothing. A pipe, `--from-env` and CI behave exactly as before. |
| 3 | `install`'s fourth step asks for the Anthropic key and then the Voyage key, one line each on what it buys and where to get one, hidden input, Enter to skip. A Voyage key offers to turn the embedder on with it. |
| 4 | `counterparts --help` is one line per command — about forty lines — and `counterparts help <command>` holds the old detail for one command at a time. |
| 5 | Colour when it is a terminal and `NO_COLOR` is unset, blank lines between groups, and `doctor` as a grade word, one short line and the fix indented under it. Piped and `--json` output is byte for byte what it was. |
| 6 | `counterparts uninstall` exists, with `wire` and `unwire` under it. It keeps your memory by default; `--park` renames the directory aside, `--delete-memories` counts first and takes a typed phrase. |
| 7 | Doctor's fix lines name commands that work: `credentials set` (which now prompts) for a missing key, `wire` for wiring that is missing or stale. |
| 8 | The store records the day it was made, and doctor clamps the Authorship window it *states* to that day — never the window it reads, so no count and no grade moves. |
| 9 | The Sweep line reads green when the newest gate row says `no-credential` **and** the file holds a key now, saying which two facts it looked at, and offers no fix, because there is nothing to do. |
| 10 | QUICKSTART's main path is §1–§5 and everything else is under a "Reference" line; the README leads with the install and its Status section is rewritten and dated. The two links into the private repo are gone rather than dead. |
| 11 | The README's install block leads with `curl -fsSL https://bun.sh/install \| bash`, marked "only if you don't have bun", and QUICKSTART §1 says the same. |
| 12 | `session_end`'s schema lists `handoff`, and a call that sets a handoff with an empty `memories` array is a success that says the handoff was written — not `memories-required`. |

## The 0.2.0 trial (2026-09-22) — what the owner found

He ran `TRIAL-0.2.0.md` from a plain terminal: swap to the tarball → `--help` → `doctor` →
`uninstall --delete-memories` with a wrong phrase (refused, nothing changed) →
`uninstall --park` → `install` (wired, both keys skipped). Every step did what the sheet
said. The doctor he pasted ran on the store 0.1.0 made, before the park. What was rough:

| # | What happened | Whose |
|---|---|---|
| 17 | The sheet and QUICKSTART §1 say "run `--help` to check it installed". He wants `doctor` to be the check — it says whether it *works*, not just whether it is on PATH. | owner |
| 18 | `--help` one-liners are not for a regular user: "Is the background half alive? Worst first, with fixes" (doctor), "Just a store — a second one, or a scratch one" (init — "what does that even mean and when would a user use it?"). | owner |
| 19 | Doctor's Embedder fix says to hand-edit `claude-code.json` (`Add "embedder": { "enabled": true } … read strictly: that exact shape`). Keys and switches should be commands, never JSON edits. | owner |
| 20 | Doctor's short descriptions are confusing: "owner: this host encodes" (Stance) named; the worker-internal lines (Sweep, Sleep, Credit, Clock, Fired, Spawn, Journal mode) read the same way. | owner |
| 21 | `--delete-memories`: once the typed-phrase prompt is up there is no visible way out. Esc / `cancel` / Enter should cancel, and the prompt should say so. (Ctrl-C already cancels — nothing tells you.) | owner |
| 22 | After `--park`, the undo is a pasted shell one-liner with an `if [ -e … ] … REFUSING … mv … fi` guard. "Doesn't make sense" — the undo should be a command, and its text plain. | owner |
| 23 | `counterparts --version` prints the help page. There is no version flag. | Claude |
| 24 | Three ambers for one missing optional key: Embedder off, Credentials "VOYAGE_API_KEY is missing", Vectors "35 with no vector". One optional thing, three problems on screen. | Claude |
| 25 | `fail  WARNING: this will delete 32 memories` — the `fail` tag in front of a warning that is not a failure. | Claude |
| 26 | The store was 6.7 MB in the delete plan and 1.4 MB in the park plan a minute later (a checkpoint or the worker finishing between the two runs, most likely). A person would wonder. | Claude |
| 27 | Small things: `[2/4]` tells a new user to edit `injectionBudgetBytes` in the JSON; `ok  Mike — the thing this memory is about`; "Everywhere:" as the label for the common flags; "Docs: docs/QUICKSTART.md, shipped with the package" points at a folder a new user cannot find; the park report's "which is why this arm does not print a count". | Claude |

## The owner's answers (2026-09-22) — the walk-through, one item at a time; working defaults

Agreed in conversation, item by item, after the trial. **The five rendered screens below are the
acceptance criteria**: a builder matches them, then keeps the facts the old screen carried.
Where this section contradicts 2026-09-21 above, this one wins (ruling 1 of 09-21, "after asking
first", is replaced by item 9 here).

1. **Two checks, two moments.** After `bun add -g`: `counterparts --version` (new) → `counterparts
   0.2.0`. After `install` and a restart: `counterparts doctor`. Never `--help` as the check.
2. **Help page** — the page below, verbatim. Everyday / Setup / Your data only; everything else
   under `counterparts help advanced` (note, fired, init, start-fresh, verify, rebrief,
   migrate-cache, backfill-claims, repair-dates, repair-merged-beliefs, probe-oq4, and the three
   global flags `--dir --config --observer`). Header drops "the owner's console" (the install
   loop's grep and `test/cli.test.ts` follow). The help↔`COMMANDS` test must count `help
   advanced` as listed.
3. **Names.** `ask` is the listed spelling of `recall` (recall still dispatches, unlisted).
   `wire`/`unwire` → `connect`/`disconnect` (they are new in 0.2.0, so no compatibility to keep;
   internal `wire()` can keep its name). With one host known, `connect` says "Connecting Claude
   Code…" and goes — no one-item menu; `connect <host>` skips any future menu; `disconnect`
   mirrors it. The MCP tool stays `recall`; doctor's "recall by meaning" wording stays.
4. **`dashboard`** (new, Everyday): starts the web view on the configured store — no `--dir` —
   prints `http://127.0.0.1:4747`, opens the browser (`open` / `xdg-open`), Ctrl-C stops it.
5. **Bare `counterparts`** on a terminal with nothing set up: "No memory here yet. Set it up now?
   [Y/n]" → runs install. Set up, or not a terminal: the help page (plus one line, off a TTY).
   The install loop runs QUICKSTART's commands without a terminal — bare must never block there.
   (Auto-running install from `bun add -g` is out: no terminal at that step, and bun blocks a
   package's postinstall by policy — editing settings.json on download is the malware pattern.)
6. **`credentials`** bare → lists which names are saved / missing (names only, never a value) and
   the `set` line. `credentials set VOYAGE_API_KEY` then offers "Turn on recall by meaning?" the
   way install does (`keys.ts#promptForKeys` already asks for a held key; the standalone path
   does not). Help line: "Add or change your API keys (Anthropic, Voyage)" — not "see".
7. **`remove`** interactive: bare asks "Memory id, or words to search for:"; an argument that is
   not an id searches; results numbered; pick one or several (`1,3`); the chosen titles are
   listed; one confirm; `--confirm` stays for scripts. No "dry run" wording on the help line.
8. **Every prompt in the package: Esc cancels**, and the prompt says so. An echoing raw-mode
   reader beside `ui.ts#hiddenPrompt` (bare ESC with nothing following for a moment — arrow keys
   start with ESC too); scripted-input tests need a path that resolves without the timer. `confirm`:
   Esc = no. `typed`: Esc or `cancel` or Enter = "Cancelled. Nothing was …". `ask` (the name):
   Esc aborts the command.
9. **`install` connects Claude Code by default on a terminal** — backup kept, one `ok` line naming
   it, `counterparts disconnect` undoes it, `--no-connect` for scripts. Off a TTY the
   non-interactive arm is unchanged: prints the blocks, edits nothing. Claude Code not on the
   machine: say so, move on.
10. **`install` keys, one at a time, y/N first**: "Add an Anthropic key? Optional — … [y/N]"; yes →
    the link, then the hidden paste; Enter = no. Then Voyage the same. The store step is silent
    (one line at the end: "Your memory lives at ~/.counterparts"). "Nice to meet you, Mike." /
    second run "Welcome back, Mike." No step numbers.
11. **`install` is the undo of `uninstall --park`.** With `~/.counterparts` missing and one or more
    `~/.counterparts.parked-*` beside it, install asks first: "Found memory set aside on
    2026-09-22 (7.6 MB). Bring it back, or start blank?" Newest first when there are several; the
    parked store is NEVER opened (the park arm's rule) — date and size from the filesystem, no
    memory count; a parked folder on the old floor (`preRowsMarkersIn` reads filenames only) is
    refused by name with the reason. Bring back = one rename into place, then connect. The guarded
    `mv` line moves to `help uninstall`. **Adversarial review** (moves a stranger's data).
12. **Doctor**: a new grade word **`OFF`** (dim) for an optional feature never turned on — a key
    that WAS here and is gone stays RED (doctor.ts "has this store ever had a working key"). All
    green internals fold into one `Background` line on a TTY; any red/amber prints in full with
    its fix; `doctor --all` prints every line as today. `--json` is complete and unfolded (a new
    `optional: true` field on those findings), not byte-identical. Every fix line is a command;
    none says to edit JSON (`keys.ts#embedderFixLine` is the one shared sentence).
13. **`uninstall`** screens below. `fail`-tagged WARNING → plain red WARNING. `~/…` for home paths
    on screen. Last line: "To remove the program too: bun remove -g counterparts".
14. **Stop hook verbosity** (#28) is NOT in this round.

Docs follow the code: README, QUICKSTART (§1 check = `--version`; step 2 = bare `counterparts`;
`ask`, `connect`), and a new `TRIAL-0.2.0.md` — the 09-21 sheet is obsolete. Reviews: item 11,
item 7, and a short re-check of item 9's non-TTY guard. Then the tail as before: suite on a clean
detached checkout, tarball from master, scan, his trial, publish on his word, then #15's
registry upgrade the same day.

### The screens

**Help page**

```
counterparts — a memory layer for AI

Everyday
  ask           Ask memory a question
  status        Memories held and recent activity
  doctor        Check that everything is working
  dashboard     Open the dashboard in your browser
  self-page     The assistant's identity page — who it is, who you are —
                read at the start of every session

Setup
  install       First-time setup: your memory and Claude Code — safe to run again
  connect       Connect an AI to your memory (Claude Code today; more soon)
  disconnect    Disconnect an AI
  credentials   Add or change your API keys (optional upgrades)
  scope         Turn memory on or off for a directory
  uninstall     Remove Counterparts; keeps your memory unless you say otherwise

Your data
  export        A copy of your memory you can take anywhere, encrypted by default
  backup        Save a snapshot of your memory to a folder
  remove        Delete one memory for good

counterparts help <command>   everything a command can do
counterparts help advanced    maintenance and developer commands
https://www.npmjs.com/package/counterparts
```

**Doctor** (fresh store, both keys skipped, everything else fine)

*Keyless round, 2026-09-23 (roadmap C3): recall by meaning is the local table, ON — written
by a terminal install, and assumed for any configuration with no `embedder` block unless a
Voyage key is saved — so on a fresh install that line reads green; `Crash write-up` is being
reworded by C2 (the next session writes an ended session up; the key becomes an opt-in), and
this screen shows it as it was until that lands. `OFF Recall by meaning` is now only for a
configuration that says `{ "enabled": false }` (or a 0.2.0 one beside a saved Voyage key):
`switched off in the configuration. Recall works on words; the local table lets it match
meaning too, and nothing leaves this machine.  Turn on: counterparts install --force --embedder`.*

```
counterparts doctor — 2026-09-23

OFF    Crash write-up      optional. An Anthropic key lets a session that ended too soon
                           get written up anyway.  Turn on: counterparts credentials set ANTHROPIC_API_KEY

GREEN  Memory              ~/.counterparts/store — 32 memories, opens fine
GREEN  Claude Code         connected: 5 hooks and the memory tools
GREEN  Recall by meaning   on — a local table (potion-base-8M, weights from the
                           counterparts-model-potion package); nothing leaves this machine
GREEN  Background          the nightly worker ran today; nothing failed
GREEN  Snapshots           last 2026-09-23, 2 kept
GREEN  Self page           not written yet — still forming

0 red, 0 amber, 1 off, 6 green.   Every line: counterparts doctor --all
```

**`uninstall --delete-memories`**

```
counterparts uninstall --delete-memories

This will delete, for good:
  ~/.counterparts/store             6.7 MB   your memory — 32 memories, 2 journal entries
  ~/.counterparts/claude-code.json  214 B    the configuration
  ~/.counterparts/credentials.env   758 B    your API keys
  ~/.counterparts/scopes.json       460 B    which directories memory is on for
  ~/.counterparts/snapshots         913 KB   the snapshots
  and the ~/.counterparts folder itself.

WARNING: nothing can bring these back afterwards.
         (counterparts uninstall --park sets them aside instead of deleting.)

Type DELETE MEMORIES to go ahead — Esc or "cancel" to stop:
```

Enter, Esc or `cancel` → `Cancelled. Nothing was deleted.`; any other text → `That was not
DELETE MEMORIES. Nothing was deleted.` Then the disconnect lines, `Deleted`, and the last line.

**`uninstall --park`**

```
counterparts uninstall --park

This will set aside (renamed, nothing copied, nothing deleted):
  ~/.counterparts  →  ~/.counterparts.parked-2026-09-22
     your memory, configuration, API keys, snapshots — 7.6 MB

Claude Code will be disconnected. Go ahead? [Y/n]   (Esc or n to stop)

Disconnecting Claude Code
  ok  5 hooks removed from ~/.claude/settings.json (backup: settings.json.counterparts-backup-2026-09-22T13-56-44Z)
  ok  memory server removed
      An open Claude Code session keeps working until you close it.

Set aside
  ok  ~/.counterparts  →  ~/.counterparts.parked-2026-09-22

To bring it back later: counterparts install — it finds this folder and asks.
To remove the program too: bun remove -g counterparts
```

**`install`** (first time, on a terminal)

*Keyless round, 2026-09-23 (roadmap C3): the two key questions are gone — both keys are
upgrades, added with `counterparts credentials set <NAME>` — and recall by meaning is switched
on silently with the local table, which sends nothing anywhere. Nothing else on the screen
changed. When the table's weights cannot be found (a from-source checkout, a dependency that
did not install), one warning and its fix print above `Done.`, and the last line stops
promising all green.*

```
counterparts install

What should this memory call you? Mike
Nice to meet you, Mike.

Connecting Claude Code…
  ok  connected — 5 hooks added to ~/.claude/settings.json (backup kept), memory tools registered

Done. Your memory lives at ~/.counterparts.
Restart Claude Code, then run `counterparts doctor` — it should be all green.
```

## What the 09-22 round changed

One line per finding above, written 2026-09-22 from the six merged PRs (#170–#175) on
master, from the code as it renders rather than from what was planned. #28 is not in this
round and is below.

| # | What happens now |
|---|---|
| 17 | Two checks, two moments, and `--help` is neither: `counterparts --version` right after `bun add -g` (it opens no store and reads no configuration), and `counterparts doctor` after the setup and a restart. QUICKSTART §2 and §4 say so, and the install loop's own step greps `^counterparts <n>.<n>` where it used to grep the help header. |
| 18 | The one-liners are a person's words now — `doctor: Check that everything is working`, and `init` is off the main page altogether: fourteen commands in Everyday / Setup / Your data, and `counterparts help advanced` holds `note`, `fired`, `init`, `start-fresh`, `verify`, `rebrief`, `migrate-cache`, the three repairs, `probe-oq4` and the three global flags. |
| 19 | Every fix line doctor prints is a command. The embedder's is `Turn on: counterparts credentials set VOYAGE_API_KEY`, and that command really does offer the switch after saving the key. Two fix lines still name a config edit because nothing exists behind them, and they are named in QUICKSTART §12: the snapshots directory, and taking `"observer"` back out. |
| 20 | `Stance` is `Mode`, and reads `remembering` (or `observer — reads memory, writes nothing`); it only appears under `--all`. The worker-internal lines — Sweep, Sleep, Backfill, Credit, Clock, Spawn, Authorship, Journal mode, Page writer, Fired — fold into one `GREEN  Background  the nightly worker ran today; nothing failed` while they are green, and unfold in full the moment one is not. |
| 21 | Esc cancels every prompt in the package, through a raw-mode reader that replaces `node:readline` (`readline` hands back a line and cannot tell Escape from an arrow key). The typed-phrase prompt says so in its own text — `Type DELETE MEMORIES to go ahead — Esc or "cancel" to stop:` — and Esc, Enter or `cancel` all print `Cancelled. Nothing was deleted.` and exit 0, where a wrong phrase still refuses. |
| 22 | The park screen ends `To bring it back later: counterparts install — it finds this folder and asks.` `install` with `~/.counterparts` missing and a parked folder beside it asks first, names its date and size, never opens it, and refuses five shapes by name. The guarded `mv` is still written down — in `counterparts help uninstall`, for anyone doing it by hand. |
| 23 | `counterparts --version` and `counterparts version` print `counterparts 0.2.0` and exit 0, opening no store and reading no configuration — so they answer even in a shell with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`. |
| 24 | One missing optional key is one dim line. `Recall by meaning` owns the knob and the Voyage key together; `Credentials` is a factual green line under `--all`; and `Vectors` produces no finding at all while the channel is off, because coverage of something that is not running is not a reading. |
| 25 | `WARNING:` is a plain red word with its continuation indented under it, never a `fail` tag, and it says the thing the list cannot — `nothing can bring these back afterwards.` The memory count moved onto the store's own line of the plan, where it is a count of something. |
| 26 | **Not addressed.** The two sizes a minute apart were never chased; a checkpoint or the worker finishing between the two runs is still the likely cause, and nothing in this round would have changed it. |
| 27 | `[2/4]` and the step numbers are gone (no numbers on the install screen at all); the store step prints no receipts, so there is no `ok  Mike — the thing this memory is about`; `Docs: docs/QUICKSTART.md, shipped with the package` is gone; the park report's "which is why this arm does not print a count" is gone. **`Everywhere` stayed** — it is still the label over `--dir`, `--config` and `--observer` on `help advanced` and on every command's flag page. |

## For the next round (not part of 0.2.0)

- **#8 is closed for NEW stores only.** Doctor's window is clamped to `store.created`, which
  only a store first opened by 0.2.0 carries. A store made by 0.1.0 still shows the week range.
  A fallback is needed for existing stores (the oldest event row's real timestamp, or the
  database file's birth time).
- **#14 — `bun add -g <tarball>` over a registry install fails** with
  `error: An internal error occurred (DependencyLoop)` (bun 1.3.10; measured 2026-09-21 in a
  throwaway `BUN_INSTALL`). `bun remove -g counterparts` first, then add the file. QUICKSTART §2a
  should say so for anyone moving from the npm install to a from-source one.
- **#15 — nobody has run the registry-to-registry upgrade.** QUICKSTART §9 tells people
  `bun add -g counterparts@latest`. It has never been run: there has only ever been one
  published version. Run it the day 0.2.0 is published, from a machine holding 0.1.0.
  **RUN 2026-09-22, the day 0.2.0 was published**, in a throwaway HOME holding 0.1.0 from the
  registry: it lands on 0.2.0 — with one caveat that is bun's, not ours. bun 1.3.10 reuses a
  package manifest it fetched within the registry's `max-age=300`, so a `@latest` run inside
  five minutes of an earlier fetch resolves to the OLD latest and reports "done" in a millisecond;
  `--no-cache` or waiting out the window fixes it. No real user upgrades within five minutes of
  installing, so the doc line stands. Also run from a tarball-file install (the owner's shape):
  `bun add -g counterparts@latest` replaces it with `^0.2.0` cleanly — the `DependencyLoop` error
  is file-over-registry only.
- **A store outside the home directory** refuses `uninstall --park` / `--delete-memories` with no
  way through (uninstall refuses `--dir`). The builder's proposal, not built: accept `--dir` on
  `uninstall` only when it equals the `dataDir` the configuration already names.
- The adversarial review's NITs n1–n5 (`docs/adversarial-review-onboarding-ab-2026-09-21.md`).
- `--help`'s Advanced group could collapse to a comma list (39 → ~31 lines) — the owner's call.
- **#16 — write up a silent session WITHOUT an Anthropic key** (owner's question, 2026-09-21).
  The key has exactly one job today: the crash-fallback sweep, which sends a session's captured
  text to Anthropic when that session ended before the assistant wrote it up
  (`bin/runner.ts` — every other background job runs with no key). The session itself already
  writes memories at every turn end, so the sweep only ever covers the tail after the last
  answered ask, or a session that never answered one. Proposal: at the next session start, the
  hook notices captured text that was never written up and asks the live assistant to write it
  — the same pattern the nightly page writer already uses ("the first session after a day is
  owed is asked"). No key, nothing sent beyond what Claude Code already sees, the write-up in the
  model's own voice. Costs: some of the next session's context (cap or chunk it); it waits for
  you to come back (a project you never reopen is never written up — a cross-project ask is
  possible but needs care with scopes); one more session-start ask, which must share pacing
  with #13. Quieter variant: the worker runs `claude -p` headless (the page writer's `host`
  mode — never yet run against a real host). Recommendation: keyless next-session write-up as
  the default, the API-key sweep as an opt-in upgrade for people who want it to happen without
  them; then no key is required OR suggested at install. Core behaviour — its own review; first
  item of the next round, after the 0.2.0 trial.


- **#28 — the Stop ask is a wall of text in the user's terminal** (owner, 2026-09-22, with a
  screenshot). After every turn Claude Code prints `Stop hook error:` followed by the whole
  nine-line ask (`src/adapters/claude-code/hooks.ts:381–387`) — "error" because the hook exits 2
  to hand the text to the assistant. The person reads it every time; it is written for the model.
  Levers: (a) the text — the field-level detail (`updates` is a field, `salience` is a floor,
  the session id twice) already lives in the tools' own descriptions, so the ask could be two
  lines; (b) how it is emitted — JSON `decision: "block"` + `reason` instead of stderr + exit 2
  may render more quietly (untested); (c) pacing, which is #13 below — an ask that fires only
  when something happened is one the person sees less. Owner: "make the stop hook a lot less
  verbose". Not part of 0.2.0.
- **#13 — the Stop ask has no pacing for a session that ends turns often** (found 2026-09-21,
  by the assistant living on the 0.1.0 install during a long coordinating session). The ask for
  memories + a chapter + a handoff arrives every time a turn ends — several times an hour while
  builders report in — and most of those stretches hold nothing new. The pull is to fill the form
  anyway. Left alone, a model either manufactures memories or learns to ignore the ask. Ideas to
  weigh, none chosen: ask only when enough has happened since the last answer (turns, tool calls,
  minutes); a one-word "nothing new" reply that costs nothing and is recorded as such; ask for
  the handoff only when work is actually left unfinished; let the per-day ask allowance (six today)
  count these. Where it lives: the Stop ask in `src/adapters/claude-code/hooks.ts` and the
  authorship pacer. Doctor's Authorship line already counts asks refused "for pacing" — check
  what that pacer measures before adding a second one.


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
`--no-wire` (prints the blocks as today). Not a terminal → behaves as today, prints, asks
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
| 1 | At a terminal `install` asks `Wire Claude Code now? [Y/n]` and does it — backup first, the five hooks beside anything already there, `claude mcp add` for the server. A pipe, a script, CI and `--no-wire` still print the blocks and change nothing. |
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

## For the next round (not part of 0.2.0)

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


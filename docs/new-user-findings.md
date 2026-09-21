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

# New-user findings

Every place a new user stalls, guesses, or needs something the page never gave them — the
install, the first session, the first day. One list, so the trial loop (use → findings →
fix → start fresh → repeat) has a single place to look.

**How to add to it.** Newest section on top, dated, with who or what produced it. One
finding per entry, in this shape:

- **A one-line title.**
  *Where:* the doc and section, or the command.
  *What happened:* what you actually saw.
  *Why a new user stalls:* the reader's side of it.
  *Severity:* BLOCKS INSTALL · CONFUSING · ROUGH · NIT.
  *Disposition:* "fixed in <PR>" or "a choice for the owner", with the options in a sentence.

Plain words. A finding nobody can act on without reading the code is not finished.

Today this file is not in `package.json`'s `files` list, so it does not ship in the
tarball — which also means a relative link to it from `README.md` or `docs/QUICKSTART.md`
fails the install loop's step 3, since that step checks every relative doc link against
what the package actually carries.

---

## 2026-09-20 — N1, building `start-fresh` (one finding, found while building it)

### 1. `install` on a KEPT configuration tells you no injection ceiling was written, when the file it kept has one

*Where:* `counterparts install` run a second time against an existing
`~/.counterparts/claude-code.json`, without `--budget`.

*What happened:* the run reports `kept …/claude-code.json`, and then prints

```
  NO "injectionBudgetBytes" was written: nobody told us this host's ceiling
  and this package invents none (scar §2.18). Re-run with --budget <bytes>,
  or add the key to …/claude-code.json.
```

The kept file already holds `"injectionBudgetBytes": 12000`.

*Why a new user stalls:* it is true of a cold start and false here — the paragraph sends a
reader to add a key he already has, to a file the same run has just told him was kept. It
is the last thing on the screen, so it is the thing he acts on.

*Severity:* CONFUSING.

*Disposition:* worked around in `start-fresh`, not fixed at the source. `start-fresh` hands
the ceiling it read out of the configuration back to `install` as `--budget`, so the
paragraph is skipped; because the file is kept, nothing is written either way. The real fix
is a choice for the owner: condition that paragraph on the configuration having been
WRITTEN (`config.what !== "kept"`) rather than on `--budget` being absent, which is a
one-line change to `installCommand` and a change to `install`'s output on a path other
commands and the install loop exercise — so it was left for him rather than taken here.

---

---

## 2026-09-18 — N2, the first stranger's dry run (hermetic, no live Claude Code)

An agent followed `README.md` and then `docs/QUICKSTART.md` literally, top to bottom, in a
throwaway `HOME` with no repository on its PATH and a stub `claude` that only logged its
arguments. `tools/install-loop/run.sh` ran green first: **52 checks, 52 pass, 0 fail.**
Then the walk by hand: pack → `bun add -g` → `counterparts --help` → `install` → the hooks
block → the MCP line → the SessionStart hook → `note`/`recall` → the MCP round trip over
stdio → `status` → `doctor` → `fired` → the dashboard → `rebrief` → the day-0 wake.

**The install itself is in good shape: nothing blocks it.** Sixteen findings — 0 BLOCKS
INSTALL, 4 CONFUSING, 9 ROUGH, 3 NIT. The trouble is all on the other side of the install —
what the tools *say* to somebody on day 1.

### 1. A new user with no API keys — which both pages call supported — gets a red doctor and a red line in the terminal every session

*Where:* `counterparts doctor` and the `SessionStart` notice, after a plain
`counterparts install --budget 9000 --name "Your Name"`.

*What happened:* `doctor` on the brand-new store printed **1 red, 2 amber, 11 green** and
exited 1. The red:

```
RED   Credentials …/credentials.env (mode 600) holds no key: ANTHROPIC_API_KEY is missing,
      so the worker will run without an interpreter; nothing is encoded
```

The same sentence arrives in the terminal on the very first `SessionStart`, as
QUICKSTART §12 says a red will. Meanwhile, in that same store with no key at all, `note`
through the MCP server minted a memory, `recall` returned it, and the install loop's
`session_end` deposited one. So memories *are* being encoded.

*Why a new user stalls:* README says "**No API keys are required**"; QUICKSTART §6 says
without `ANTHROPIC_API_KEY` the worker still runs the day and only skips the crash sweep —
"Nothing else changes — this is *not* the ordinary write path." QUICKSTART §12 says the
red notice fires only "for the things that mean part of the system is not running." All
three cannot be true at once. A careful reader concludes their fresh install is broken;
a trusting one goes and buys an API key the docs told them they did not need.

*Severity:* CONFUSING (it is the first thing the product says to a new user).

*Disposition:* **a choice for the owner.** Three ways out: (a) `doctor` grades the missing
interpreter key **amber** on a store that has never had one, and keeps red for the case it
was built for — a key that went away on a store that was using it; (b) keep it red and stop
calling no-key a supported mode, saying plainly in §1 and §6 that day-1 `doctor` is red
until you add a key; (c) keep it red but have `counterparts install` print one line warning
that this is coming, so it is expected rather than alarming. (a) matches §6.

### 2. `counterparts status` — the command the install tells you to check with — is mostly internal prose

*Where:* `counterparts status --dir …`, QUICKSTART §7 "Look at the store"; and the last
line `counterparts install` prints ("check it with: counterparts status --dir …").

*What happened:* the census a new user wants is four lines. Under it comes a ten-line
`Layout:` block written for whoever maintains the store:

```
    backed up  prose  — Box 1 — canonical prose. The memories themselves.
    excluded   cache  — Box 3 — rebuildable embeddings/FTS. Never backed up; its loss is a re-index.
  - excluded   sessions  — adapters/sessions.ts — the live-session registry a host's hooks
    leave for its tools, plus the notes one process leaves another inside it:
    adapters/expansions.ts' handle log and associate/pending.ts' co-activation deltas … 
```

plus `Permanent (enumerable on demand, §14.1 G9): 0`.

*Why a new user stalls:* "Box 1", "Box 3", `assertLayout()`, `adapters/expansions.ts`,
"§14.1 G9" and "archive-on-overwrite" are all things the reader has no way to look up. The
four numbers they came for are buried above it. §7 describes the first line carefully and
never mentions the Layout block at all, so the page and the command disagree about what
this command is.

*Severity:* CONFUSING. *Disposition:* **a choice for the owner** — the layout block behind
a `--layout` flag (or `--verbose`), or shortened to one line per directory with no file or
section references, or left alone and described in §7 so it is not a surprise.

### 3. `counterparts fired` and doctor's Fired line read like a catastrophe on a store that is simply new

*Where:* `counterparts fired`, and `doctor`'s Fired line, on a store minutes old.

*What happened:* `fired` opened with `NEVER (28) — the evidence exists and has never
carried a row` and then 28 mechanisms each reading `last never · 7d 0 · total 0`.
`doctor` said, in **green**: `0 of 47 mechanisms fired this week, 0 have gone quiet, 29
have never fired, 2 are too new to grade, 13 record nothing durable at all`.

*Why a new user stalls:* on day 1 nothing has fired because nothing has happened yet, but
neither surface says so. Twenty-eight "never" lines is what a broken install would look
like, and there is nothing on the page telling the reader that this is the expected day-1
reading.

*Severity:* CONFUSING. *Disposition:* **a choice for the owner** — `fired` opens with one
line when the store has lived zero days ("this store is N days old; nothing has fired
because nothing has happened yet"), or QUICKSTART gains a sentence saying so, or both.

### 4. Nothing checks the two steps the user does by hand, and nothing tells them how to know it worked

*Where:* QUICKSTART §4 (the hooks block and the `claude mcp add` line), §7, §12.

*What happened:* `install` prints both host steps and applies neither — correctly. But
`doctor` never reads `~/.claude/settings.json` or the MCP registration (confirmed: no such
read in `src/adapters/claude-code/doctor.ts`), so a user who pasted the hooks into the
wrong file, or into a project settings file instead of the user one, gets a fully green
`doctor` and total silence. §7's "Prove the hook works without opening Claude Code" proves
the *binary* runs; it cannot prove the *host* is calling it. Nothing anywhere says "after
you restart, here is how you know": no `/mcp` check, no "ask the assistant to call
`status`", no first-session expectation to match against.

*Why a new user stalls:* the failure mode is silence. The product's own §4 says a hook that
stands down "says so on stderr and exits 0 … and no hook will tell you."

*Severity:* CONFUSING. *Disposition:* **a choice for the owner** — a
`doctor` "Host" line that reads the settings file and the MCP registration and says which
of the five events it found; or a short "your first session should look like this"
paragraph in §4 (what the assistant sees, what `/mcp` should list); or both. The second is
cheap and helps even when the first is not possible.

### 5. README never mentions `counterparts doctor`

*Where:* `README.md`, "What you get on the host".

*What happened:* README enumerates the console — "Read-only: `status`, `recall`, and
`probe-oq4` … The rest write: `install`, `init`, `note`, `export`, `backup`, `remove`,
`backfill-claims`, `repair-merged-beliefs` … and `rebrief`" — which reads as a complete
list. `doctor` appears **zero times** in README, and so do `fired` and `credentials set`.
QUICKSTART §12 makes `doctor` the one troubleshooting command, and the red terminal notice
ends with `run: counterparts doctor`.

*Why a new user stalls:* someone who read only the README, saw the red line and went
looking for `doctor` in the page they had, would not find it.

*Severity:* ROUGH. *Disposition:* **fixed in this PR** — `doctor` and `fired` added to
README's read-only list. The rest of the console (`scope`, `credentials`, `migrate-cache`,
`repair-dates`) is still not enumerated there; leaving that, because completing the list is
a rewrite, not a fix.

### 6. README's prerequisites say bun; the first command needs Node and npm

*Where:* `README.md` "Install"; QUICKSTART §1 (which does say it).

*What happened:* README says "**You need bun 1.3 or newer**" and then the first command in
its own install block is `npm pack`. Run on a PATH with bun but no Node — exactly what
README's own `bun.sh` link produces — `npm pack` dies with `env: node: No such file or
directory`, which says nothing about installing Node.

*Why a new user stalls:* they followed the one prerequisite the page gave them and the
first command failed with an error about a program nobody mentioned.

*Severity:* ROUGH. *Disposition:* **fixed in this PR** — README now names `npm` as a
prerequisite, as QUICKSTART §1 already did.

### 7. `rebrief` and QUICKSTART §7 print two different byte counts for the same bundle

*Where:* QUICKSTART §7 "Give the wake something to say before a first real session".

*What happened:* on a store installed exactly as §3 says, `counterparts rebrief` printed
`elements 0, bytes 470`. The bundle it published carries `bytes=572`, which is the number
§7 quotes ("that bundle is 572 bytes").

*Why a new user stalls:* they run the documented command, get 470, read 572 on the page,
and have no way to tell which one is wrong. (Neither is: 470 is the composed body, and the
delivery preface added at injection is 102 bytes — measured, 470 + 102 = 572.)

*Severity:* ROUGH. *Disposition:* **fixed in this PR** — §7 now says both numbers and why
they differ.

### 8. The red terminal notice is cut off mid-word, before its instruction ends

*Where:* the `SessionStart` hook's `systemMessage`, on a fresh install.

*What happened:*

```
… Run: counterparts credentials set ANTHROPIC_API_KEY (the value on stdin; it is …
run: counterparts doctor
```

Two runs truncated at slightly different points (`it is …` and `it is neve…`).

*Why a new user stalls:* the one line the product gives them is the fix, and the fix is
what gets cut. The trailing `run: counterparts doctor` survives, so it is recoverable —
but the first impression is a truncated error.

*Severity:* ROUGH. *Disposition:* **a choice for the owner** — shorten the fix sentence so
it fits the budget, or put the shortest form (`counterparts credentials set
ANTHROPIC_API_KEY`) first and the parenthetical last so the cut falls on the optional part.

### 9. `doctor`'s Vectors line counts the identity core as a memory, and its fix line is jargon

*Where:* `counterparts doctor` on a store with nothing in it but the identity core.

*What happened:*

```
AMBER Vectors     1 live memories with no vector, 0 skipped after repeated embed failures
                  fix: The backfill embeds up to 64 per boundary; this number must fall run over run.
```

*Why a new user stalls:* three things at once. "1 live memories" is ungrammatical. The one
row is the identity core, which `status` is careful to count as a belief and not a memory,
so the two commands disagree. And the "fix" is not an instruction — it is a note to
whoever is debugging the backfill; with no embedder configured (which `doctor` says on the
line above) this number will never fall.

*Severity:* ROUGH. *Disposition:* **a choice for the owner** — pluralise; count the same
population `status` counts; and when `embedder.enabled` is not true, either suppress the
Vectors line or make its fix "turn the embedder on (see the Embedder line)". Not changed
here: `doctor.ts` is owned by several tracks in the current rebuild and a one-word edit
would be a merge conflict.

### 10. README's test-suite numbers are two weeks stale

*Where:* `README.md`, "Status, honestly".

*What happened:* README reports `bun test` → "1,572 pass, 0 fail … over 20,800 assertions
across 26 files, about 19 s", measured 2026-09-04 on commit `b29034c`. On master today
(`039cd5d`) it is **2,223 pass, 0 fail, 28,392 assertions across 38 files, about 51 s**.

*Why a new user stalls:* they do not, exactly — the claim is dated and pinned to a commit,
which is honest. But a reader who runs the suite to check the page gets numbers 40% larger
and has to work out whether the page is lying or just old.

*Severity:* ROUGH. *Disposition:* **a choice for the owner** — re-measure on the commit
that ships and restate, or drop the absolute numbers and say "the suite is green on every
commit; run `bun test`". Not changed here: restating means re-measuring the assertion count
and the timing on the shipping commit, which is not this branch.

### 11. §3 says omitting `--budget` injects unbounded; §7's next documented command refuses

*Where:* QUICKSTART §3 (`injectionBudgetBytes`) and §7 (`rebrief`).

*What happened:* installed with no `--budget`, `install` warns clearly and writes no key.
Then the §7 command `counterparts rebrief --dir "$HOME/.counterparts/store"` exits **2**:
`refused: no injection ceiling. … Looked, in order: …`.

*Why a new user stalls:* §3 tells them omitting the flag is a supported choice ("the wake
is injected unbounded"), and four sections later the documented check step refuses because
of it. Both messages are excellent on their own — `install`'s warning and `rebrief`'s
refusal each name the remedy — but nothing joins them up.

*Severity:* ROUGH. *Disposition:* **a choice for the owner** — one clause in §3 saying that
`rebrief` (§7) needs a number even though the hook does not, or a pointer the other way
in §7.

### 12. The hook path the docs show looks like a clone path; the one `install` prints is inside bun's global node_modules

*Where:* QUICKSTART §4 and README's install summary.

*What happened:* the doc's shape is
`"/abs/path/to/counterparts/src/adapters/claude-code/bin/hook.ts"`. What `install` actually
printed was
`…/.bun/install/global/node_modules/counterparts/src/adapters/claude-code/bin/hook.ts`.
§2's "Running from the clone instead of installing" paragraph describes a third path.

*Why a new user stalls:* someone with a clone on disk (which §2 told them to make) can
easily decide the printed path is wrong and "correct" it to their clone — which then
upgrades independently of `bun add -g`.

*Severity:* ROUGH. *Disposition:* **a choice for the owner** — one sentence in §4 saying
the printed path points inside bun's global install and that this is right, and that
pointing it at a clone is the §2 "running from the clone" mode, not a fix.

### 13. No uninstall (the start-over half is N1, already planned)

*Where:* nowhere. Neither page contains "uninstall", "start over", "start fresh" or
`bun remove -g`.

*What happened:* a stranger who wants to undo the install has no instructions, and a
stranger who wants a clean store has none either.

*Severity:* ROUGH. *Disposition:* **known to be coming** — the one-command "start fresh"
is N1 in the rebuild plan. The note here is where the docs will need a sentence when it
lands: a short §13 covering both halves (remove the three host entries and
`bun remove -g counterparts`; park the store and begin again with the new command), because
the host steps are the part `install` deliberately never touched and so cannot undo.

### 14. `counterparts-dashboard --help` tells you to run a source file you do not have

*Where:* `counterparts-dashboard --help`, after a tarball install.

*What happened:* the usage line reads
`bun run src/adapters/dashboard/bin/dashboard.ts <view> [flags]`. The other three
executables print their own name.

*Severity:* NIT. *Disposition:* **a choice for the owner** — print `counterparts-dashboard
<view> [flags]`. Not changed here (source file, not owned by this PR).

### 15. `counterparts-mcp` run by hand says almost nothing

*Where:* `counterparts-mcp`, which a curious user will try after registering it.

*What happened:* it printed one line — `[counterparts] config: …/claude-code.json (the
default)` — and exited 0 on empty stdin. Correct (it is a stdio server), but it tells a
person nothing.

*Severity:* NIT. *Disposition:* **a choice for the owner** — when stdin is a TTY, print one
sentence: this is an MCP server, it is launched by the host, here is the store and config
it would use, and `counterparts status` is the command for people.

### 16. The install loop's quoted timing is stale

*Where:* QUICKSTART preamble — "52 checks and runs end to end in two to three seconds".

*What happened:* 52/52 pass in **4 s** on this machine.

*Severity:* NIT. *Disposition:* **a choice for the owner** — widen to "a few seconds", or
leave it. Not changed here: `test/install-loop.test.ts` pins the number 52 in that same
sentence, so it is worth touching once rather than twice.

### What this dry run could not check

No Claude Code session was ever launched, and no real host configuration was read or
written. So all of these remain verified only by the owner's live parallel run, not by this
walk:

- that Claude Code reads the hooks block out of `~/.claude/settings.json` and runs the hook
  on all five events;
- that the wake text reaches the model's context;
- that the `Stop` ask arrives (stderr, exit 2);
- that `claude mcp add` registers a server the client then launches — the line was run
  against a stub that only logged its arguments, which confirms the line is well-formed and
  nothing more;
- `git clone` of the repository, which is private and refuses a stranger today;
- everything under Node.

One artefact of running hermetically, so nobody reads the outputs above wrong: the hooks
block printed `"/Users/mlapeter/.bun/bin/bun"` as the runtime because the walk borrowed the
machine's one bun binary into a throwaway `HOME`. A real stranger gets their own
`$HOME/.bun/bin/bun` there.

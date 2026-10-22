# tools/harness: the simulation harness (dev-only)

A second host for Counterparts: it feeds a stream of lived days into a fresh temp store and
measures what the memory physics makes of them. It's never shipped: `package.json#files`
publishes `src/` and `tools/install-loop/` only. It drives the store only through the
package's public seams (`test/harness-imports.test.ts`), so it also checks that those seams
are enough to build a host on. It *reads* stores (the source, and afterwards its own replay)
with plain SQL, as a measuring instrument.

Step 1 of the 2026-10-20 plan (lane 1) is **physics-only replay**. Steps 2–4 (the seat
interface, a model in the seat, a scripted new owner) build on it.

## Run it

```sh
# Copy a snapshot out of ~/.counterparts first. The replay refuses anything under it.
bun tools/harness/cli.ts corpus
#   --from <snapshot folder>   a named snapshot instead of the newest
#   --snapshots <dir>          another snapshots folder (default ~/.counterparts/snapshots)
#   --out <dir>                where the corpus folder goes (default ~/counterparts-backups)
#   --json <file>              write the record (path, schema, build, counts)

bun tools/harness/cli.ts replay --source ~/counterparts-backups/<date>-corpus-v<schema>-<build>/counterparts.sqlite
#   --returns derived|recorded   derive awake returns from the uses (default), or pin the recorded ones
#   --through-day N              stop after lived day N (skips the fidelity block)
#   --early-days N               how many days the early-core table covers (default 10)
#   --keep                       keep the replayed store and print where it is
#   --json <file>                write the whole run record
```

On a 29-day, 2,000-memory record a run takes about 15 seconds.

## A corpus (`corpus`)

`corpus` copies the newest snapshot (or the one `--from` names) out of
`~/.counterparts/snapshots/` into `~/counterparts-backups/<date>-corpus-v<schema>-<build>/`.
"Newest" goes by the instant in the folder's name. When a daily copy and a pre-migration copy
share an instant, it picks the pre-migration copy.

The name carries the snapshot's date, the schema, and the newest build in the store's build log.
A store that keeps no build log gets no build in the name.

Under `~/.counterparts` it lists `snapshots/` and copies one file. It opens nothing there as a
database and writes nothing there. It refuses:
- a source that isn't a snapshot folder directly inside the snapshots folder, such as a
  half copy (`.partial-…`) or the live store's own file;
- a source with a `-wal`, `-shm` or `-journal` file beside it;
- a target or a `--json` record under `~/.counterparts`;
- a corpus folder that's already there.

The copy is made under a temp name, checked byte for byte against the source, made read-only,
and then renamed into place. It prints the counts that say whether the copy is worth replaying:
- memories, live and archived;
- beliefs and their support rows (v14);
- tag rows and distinct tags (v14);
- subject links, and the cards with a subject kind (v14).

A v13 snapshot reads as having no tables for these.

## What it does

The harness starts from day 0 with an empty store. For each lived day, in the order live had
it, it first runs one boundary: `sessionEnd({date})` with the sweep skipped by name, as the night
worker does. Live ran many boundaries a day, but a once-a-day phase marks its day done even when
its budget runs out, and its cursor resumes the next day, so the rest ran only the clock. The run
record names any phase whose budget ran out. Then the day's recorded acts land, in the order of
their recorded instants, and never before the birth of a memory they touch.

| Act | Read from | Applied with |
|---|---|---|
| birth | `memories` (first version's body where one was kept) | `store.put` under its own id |
| about-mark | `core_events` `about` | `store.setAbout` |
| feeling | `feelings` on `recorded_day` | `store.addFeelings` |
| use | `recall.credit` (expanded, quoted, drewOn), `recall.rated` | `store.reinforce` |
| night return | `returns` sourced `dream` / `reflection` | `replayReturn` / `reflectReturn` |
| settle | `contradictions` settled + `contradiction_settles` actor | `settleContradiction` |
| merge | memories archived `dream-merge`, on the version's day | `store.archive` |

Bands, awake returns, promotions, decay and prunes are **outputs**. The run record compares
them against the record: per-memory uses, awake returns by id and day, promotions, archives,
and the band census.

## What it leaves out, and says so

- Episodes, places, and the episodes' chapter copies. Their lifecycle (regrow, clear) is the
  adapter's night, not physics.
- Credit paths that write no event row: recall surfacing, schemas mentions, and the self page
  citing a memory. The per-memory use diff shows how much they carried.
- Salience as it was at birth. The row holds today's values, which a dream may have revised.
- What was shown per turn and how many candidates it was shown against. The record doesn't
  keep it, so a "return weighted by the pool" test needs the model-in-seat mode, or a store
  change batched with wave 2.
- Rules that changed mid-record. The replay applies *today's* rules to the recorded acts, so
  some divergence is the rule change itself. The fidelity block splits returns by source to
  show it: ratings count as use since 0.3.27 (ontopic returns), drewOn is a full use, and
  promotions made under the pre-10-11 lanes aren't reproduced.
- Two more uses the record can't pin down exactly. Every quoted use counts as cued, but live
  cued only a memory recall surfaced loud on that same turn, so the replay's count is an upper
  bound. Shown-tier credits from unrated showings write no per-memory row, so they aren't in
  the replay.
- Merges as they were before 10-11: the original's returns and mark go to the merged memory,
  and the original is archived. A merge since then is a settle, and it replays as one.
- A lived day whose sleep-cycle row is gone gets a date from what was learned on it, or else
  the day after the previous day, but only if that date falls strictly between its dated
  neighbours. If no date fits, the source is refused rather than shifted. The record counts
  the days dated this way. If the replay's clock ever differs from the record's lived day,
  the run stops.

## A recorded night (`night`)

```sh
bun tools/harness/cli.ts night --dir ~/counterparts-backups/<date>-corpus/night-<date>
#   the folder holds pre-night.sqlite (a snapshot from the night's start), dream-child.jsonl and
#   reflection-child.jsonl (the night's children's transcripts), and ../counterparts.sqlite
#   (a copy from after the night). Since 2026-10-21 a night child runs with
#   --no-session-persistence, so Claude Code keeps no such transcript of a new night: the
#   recorded corpora (the 10-19 night) still replay; a new one has nothing to copy yet.
```

This is the harness's own seat (`night.ts#recordedSeat`). It answers the night's asks with the
calls the recorded night made, through the memory's own server, opened in-process as the
night's child opens it: not the owner's, told which act it serves, with the local static
embedder. It runs on a copy of the store from before that night, on that night's clock. No
model is involved. The night itself runs through the real `runNight`.

What it does and doesn't replay:
- Only ids both nights minted are paired (the dream's, the reflection's, a merge's). An id that
  existed before the night is the same memory in both runs.
- Calls the host refused, and calls to tools the ask didn't grant or withheld, are skipped and
  counted.
- A write-up owed (`catch-up`) isn't in the record. It's refused, and counted.
- The source must be a single file (a snapshot). A store in WAL mode is refused.

The record compares:
- the composed prompts: whether the words are the same once ids are mapped (by hash), and their
  lengths;
- each call's answer: refused, or the same once ids are mapped;
- what the store holds afterwards: the dream's state, title, standing changes by kind, and
  returns; the night's own reflection's state, page version, returns and cites.

Not reproduced: the owner's identity names, `pageWriter.mode`, and an embedder other than the
static table. Flags: `--time-zone`, `--budget`, `--no-embed`.

Replay on the code that ran the night. A recorded dream's proposals are tied to the bundle it
was shown, so on code that composes bundles differently, they land on memories this bundle never
showed (`not-shown-or-gone`). That is a finding about the code, not a fault in the replay.

On 2026-10-20 the 10-19 night replayed on 0.3.26, the build that ran it:
- both composed prompts were the same words as the night's;
- the reflection matched exactly;
- the dream matched except for 2 of 18 links and 1 of 8 replays. Its bundle's first part
  overlapped the night's by about 86%. The cause of that gap isn't known yet: composition has
  no randomness, and nothing was written between the snapshot and the dream's start.

On 0.3.27 and master, 10 of the 18 links land on memories the new bundle doesn't show.

## A model in the seat (`night --model`)

```sh
bun tools/harness/cli.ts night --dir <night folder> --model [<name>]
```

The same night, with headless Claude Code in the seat (`model-seat.ts`) instead of the
recorded calls: a real dream and reflection on a copy of the store from before that night,
on the owner's subscription (no key). The child is planned exactly as Claude Code's own night
child is (`planNightChild`: the same tools granted and denied, permission mode, turn ceiling,
watchdog). Three things change so it can't reach the owner's live store:
- **Its memory server is the harness's** (`serve-at.ts`): the same tools, served the same way,
  from the temp copy, on a clock that starts at the night's instant and runs on in real time.
  The product's server has no clock knob.
- **`--setting-sources project`, in an empty temp folder:** no user settings, so none of the
  owner's hooks load. Measured 2026-10-20: no session file, no event, no backup in the live
  store. Whether plugins load is not left to a guess: each child's own init line (its first
  stream-json line) is read, and the record shows the plugins it loaded and its MCP servers.
  Measured 2026-10-20: only Claude Code's own (`cc-plugin-agents-md`, `cc-plugin-telemetry`,
  `cc-plugin-plugin-authoring`), none of the owner's; one MCP server, the harness's
  `counterparts`.
- **Backups:**
  - `COUNTERPARTS_CONFIG` names a temp config on the temp store.
  - The night's quiet flag is set, as on every night child.
  - `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` is set on the child and its server.
  - No `COUNTERPARTS_*`, `CLAUDE_*` or `ANTHROPIC_*` variable of the parent reaches them; a
    key in the shell would bill the API, and the harness runs on the subscription.
- **Transcripts:** a night child keeps none (`--no-session-persistence`, 2026-10-21). A
  scripted person's turns (`week`) do, under `~/.claude/projects/<its folder>`, since they
  `--resume`; that folder is removed with the run, unless `--keep`.

On 2026-10-20 the 10-19 night with a model in the seat took about 4 minutes:
- the page writer ran;
- the dream journaled 13 links, 13 replays, 3 merges, 2 gists and 1 core nomination;
- the reflection cited 9 memories and revised the page;
- in the live store before and after: the same session count, and no event naming the run.

The comparison block reads the same as for the recorded night, but a model's night is its
own: the counts are for setting side by side, not for matching. A run spends subscription
usage.

## A scripted owner's first week (`week`)

```sh
bun tools/harness/cli.ts week [--script plain|meaningful] [--days N] [--no-nights] [--model <name>] --out <week.sqlite>
bun tools/harness/cli.ts replay --source <week.sqlite>      # then, under rule patches, compare
```

A fresh store, begun as a new install begins (the meeting offered, dreaming on), and a fixed
week of sessions by a fictional new owner (`owner-week.ts`: Dana, a ceramics teacher; 7 days,
11 short sessions). The same week every run, so a difference between runs belongs to the
memory, not the script.

The harness is the host. It builds Claude Code's own adapter (`ClaudeCodeAdapter`) in-process
on the harness's clock and calls its handlers in Claude Code's order:
- `sessionStart`;
- per scripted line, `userPromptSubmit`, then `stop` after the model's reply. An ask it returns
  is put to the model as the next message.
- at the end, `sessionEnd`.

**The product decides what runs.** Its spawner is the harness's, which records each ask: the
night (at a morning's first session, when the product's gate says one is due) and the worker
(at each Stop and session end). After each hook call the harness runs exactly those: the night
through `runNight` with the model seat (catch-up, dream, reflection), and the worker as the
boundary it runs. The harness also makes the claims Claude Code's delivery step makes (plain
reminders, the dream line), credits the model's recall calls as the turn's expansions, and
settles the folder registry as an owner who said "on".

Each turn is one `claude -p` (`--session-id`, then `--resume`) with the session's memory tools
from the harness's server, as the owner, under the same safety as the model seat.

One shape differs from a live session: a hook's words arrive in the prompt as a system
reminder, not as the host's attachment. Claude Code's own delivery step (`bin/hook.ts`) isn't
among the package's public seams, so its claims are made through the adapter's methods.

The week's store comes out as one file (`VACUUM INTO`). The rule variants are physics, so the
model runs the week once, and the record is replayed under each patch: identical acts,
seconds each.

On 2026-10-20 (as an install with the meeting, after two reviews), the week took about 14
minutes:
- memories: 20 after day 1, 49 by day 7;
- nights on the six mornings the gate chose;
- 54 worker boundaries;
- **core 0 every day under today's rules, the door closed, and spread.**

By the product's own verdict, the candidates (self, marked `us`, from the meeting) reached the
return gap (2 days) but not the feeling: 0.0 and 0.2, where 0.6 is needed. The `us` memories
felt at 0.5–0.6 were facts, and a fact isn't a core kind.

`--script meaningful` (2026-10-21) is the same week with meaning between owner and counterpart:
trust given, two tone corrections, firsts, callbacks, credit, and two strongly felt moments,
typed as people type to an assistant. It took about 20 minutes, ended with 59 memories, and gave
**core 0 every day.** The counterpart did write the relationship down as `us` memories, but:
- every one was a fact;
- each came back once, through the next night's reflection (a gap of 1), never in a session;
- in the moment, feelings sat at their words' defaults.

On replay, letting facts count plus a 1-day gap promotes 2; adding a 0.5 feeling bar promotes at least 4. That's a floor: the replay ends before one more consolidation. The bar is also a crude stand-in, because it lets unweighed default feelings through.
All of them come in on the reflection alone.

## Two sides, one table (`compare`)

```sh
bun tools/harness/cli.ts compare --mode replay --set physics.CORE_FAST_ACCEPTS_REFLECTED_FEELING=false
bun tools/harness/cli.ts compare --mode night --branch feat/x --runs 2 -- --dir <night folder> --model
bun tools/harness/cli.ts compare --mode week --base origin/master --set physics.CORE_FAST_GAP_DAYS=1 -- --script meaningful
```

Runs the same harness mode on a base and a variant and prints them side by side, with `≠`
where they differ:
- **A side** is a build plus its settings. The build is the current checkout, or `--base` /
  `--branch` refs in fresh detached worktrees, removed after.
- **`--set module.KEY=VALUE`** sets a top-level number or boolean tunable on the variant for
  the run (`--base-set` on the base). It's applied in the harness's process and in the server
  its model children call (`settings.ts`), and every record lists it. An unknown module or
  key, a wrong type, or a key set twice is refused before anything runs. This is how a switch
  is compared on and off within one build. Nothing in `src/` grows a knob: the tunables are
  plain objects read at use, and the harness sets a value on one. One value is captured at
  load and can't be set: `fit.OVERHEAD` in the dream.
- **Each run of each side is its own subprocess on its own copy**, so a base never opens a
  store the variant migrated.
- **Everything after `--` goes to the mode as given.** The compare owns `--json`, `--set`,
  `--page-out`, `--keep` and `--out`, and refuses them there.
- **`--runs N` repeats each side.** A model's run is one sample, so a cell shows each run's
  value when they disagree, and the page row shows how far a side's own runs differ from each
  other: the noise floor, next to the difference. The same build and settings on both sides is
  refused unless `--runs` is 2 or more (a noise check).
- **Tokens:** the record carries every model child's usage, read from its own stream-json
  `result` line (`usage.ts`), so a side's cost is in its row.
- **The page** (night and week) goes in the record by numbers only: version, bytes, the
  memories it cites, claims with no cite behind them. The compare diffs the words in its
  scratch and removes them; `--pages <dir>` keeps them for a human read. On the owner's
  snapshot they are his counterpart's page, so keep them out of any repo.

A key that some reader copies at load (the use-tier weights, the recurrence weights, the
prospective holds; `settings.ts#CAPTURED`) is refused, since setting it would change only some
of its readers. A compare stopped with Ctrl-C can leave a `harness-compare-*` worktree; remove
it with `git worktree remove --force <dir>`, or `git worktree prune`.

A replay's table shows these rows, beside the core:
- the semantic band on the last day;
- below reach on the last day (memories only), as that day's decay pass ranked them;
- memories pruned so far.

### Presets (`--preset`)

`--preset <name>` (`--base-preset` for the base) is a named list of `--set`s
(`settings.ts#PRESETS`). The list is expanded before anything runs and goes ahead of the
side's own `--set`s, so each setting is checked and recorded on its own. A key set by both a
preset and a `--set` is refused. The table's header names the preset, not its settings. `replay`,
`night` and `week` take `--preset` too.

**`physics-off`** is the "just files" side: the same record with the memory's arithmetic
switched off, as far as the top-level tunables reach.

| Part | Settings | Moves a replay? |
|---|---|---|
| decay, forgetting | `physics.S0=1e9` (the curve stays at 1), `physics.D_FLOOR_DAYS=1e9` (no prune), `physics.REACH=0` (everything in reach, as a file store) | yes |
| salience and feeling as weights | `physics.EMO_LIFT=0` (height); `STABILITY_GAIN=0`, `EMO_Q=0` (the curve: inert under S0=1e9, kept so the preset says off) | yes |
| reinforcement | `physics.REP_CAP=0`, `BETA=0`, `RETURN_GAIN=0`, `CONS_BONUS=0`, `BELIEF_SUPPORT_CAP=0`, and the dream, reflection and engaged return weights at 0 | yes |
| the core | `sleep.CORE_MAX_PER_SLEEP=0` (no lane promotes) | yes |
| learned association | `associate.HEBB_RATE`, `CO_USE_DEPOSIT`, `CONTIGUITY_RATE`, `SHOWN_TOGETHER_DEPOSIT`, `dream.LINK_WEIGHT`, `REPLAY_LINK_WEIGHT` at 0 | night and week only |
| recall's lifts | `recall.HOP_CEILING=0` (spreading), `PRIME_LINK_UNITS=0`, `PRIME_TRAIN_SHARE=0`, `TAGS_PRIME=false` (priming), `HABITUATION_BAR_LIFT=0`, `SAL_BAR_WEIGHT=0`, `SAL_SORT_WEIGHT=0` | night and week only |

S0 is set rather than `POWER_LAW_PSI=0`, because at ψ ≠ 1 the curve has no closed form for the
prune's day and walks up to 100,000 days a memory. At 1e9 a memory loses about 3e-8 of its
strength in 30 days. With the cap at 0 the core reads 0 by construction: that's the point.
Under physics-off the "semantic" row is the recorded salience labelled against `THETA_SEM`, and
nothing else: no recall reads the band differently once everything is in reach.

What no top-level tunable can switch off, so `physics-off` leaves it on:
- **salience as height**. A memory's height is still its recorded salience (`sal()`'s mean with
  its floor, the claimed defaults). The band still reads that height against `THETA_SEM`. "Off"
  would need flat salience, which is a row's value, not a tunable.
- **the use tiers** (`W_*`), **the recurrence weights**, `PHI_PRUNE`, and `HOLD_*`. They're
  captured at load (`CAPTURED`). With reinforcement's arms at 0, a use is still counted but adds
  nothing.
- `DECAY_SHAPE` and the per-kind table (`KINDS`), which aren't numbers or booleans.
- **the core lanes' own rules**. Only the nightly cap gates them.
- **revision and settles**: `CHANGED_FADE` and challenge pressure. These count as the record's
  acts, not physics, so they're left on.
- **beliefs** (`schemas.BELIEFS_BIRTH`, `recall.BELIEFS_IN_RECALL`). They're a model-written
  layer. Only their support arm is arithmetic, and that one is off.

A physics-only replay measures bands, promotions, reach and prunes. It doesn't measure whether
an answer was better: that needs a model in the seat on both sides (`--mode night` or `week`).

A side running a build from before `compare` ignores `--set`, and the table says so. Checked
2026-10-21 against the 10-20 run: replaying Mike's record with the reflected-feeling door
closed reproduced that run's core (0, 2, 4 on days 14, 21, 29, against 6, 9, 11 open).

## Safety

- The source is opened read-only, and the harness refuses any path under `~/.counterparts`.
- The target is always a fresh `mkdtemp` and is removed unless `--keep` is set. The harness
  refuses to run if `COUNTERPARTS_DATA_DIR` is set.
- The run record holds ids, counts and days. It never holds a body, a title, or a feeling's
  words.
- Events prune after 90 lived days. Keep a corpus copy aside before the record you want
  ages out. The record's header says if the source's event log starts later than day 0.

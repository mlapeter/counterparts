# `tools/parallel/` — the parallel run's instrument

`CONTRACT.md` is the design. This is the operator's half: what the three
commands do, what lands in the run directory, and what each check actually
verifies.

The instrument is an **observer**. The subjects — v1 (bansai) and Counterparts —
run their own production paths and write their own live stores; this tool reads
both and writes exactly one thing: the run directory you name. That is CONTRACT
§5 G1, and it is test-asserted two ways (see *Guarantee 1*, below).

## The three commands

```
bun tools/parallel/bin/preflight.ts --run-dir <dir> [options]
bun tools/parallel/bin/daily.ts     --run-dir <dir> --date <YYYY-MM-DD> [options]
bun tools/parallel/bin/restart.ts   --run-dir <dir> --date <YYYY-MM-DD> --reason "<text>"
```

Every real path is a flag. The defaults name the live locations, because that is
where the run happens; `bin/` is the only place in the tool that resolves a home
directory at all, so nothing else can reach one by accident.

| flag | what it points at | default |
|---|---|---|
| `--run-dir` | the run directory — **the only thing written** | *(required)* |
| `--v1-dir` | v1's data dir, read-only | `~/.bansai` |
| `--v2-data-dir` | v2's data dir, read-only — **announced when it falls to the default, refused under the guard** (below) | `~/.counterparts` |
| `--v2-config` | v2's adapter config JSON | — |
| `--engram-dir` | the third store, for the disjointness check | `~/.claude-engram` |
| `--ab-dir` | the primacy assignment directory | `$MEMORY_AB_DIR` or `~/.memory-ab` |
| `--replay-out` | the replay run's `--out` dir (holds `pass-record.json`) | — |
| `--transcripts` | a transcript file or directory; repeatable | — |
| `--phase` | `0` (the day-0 preflight) or `P` (the daily re-check). There is no `S` | `0` |
| `--v1-wake` / `--v2-wake` | a rendered wake, for the cross-encoding meter | — |
| `--v1-ritual` *(daily)* | v1's ritual ask text, as cross-encoding probes | — |
| `--engram-dir` / `--ab-dir` *(daily too)* | checked disjoint from `--run-dir` before anything is created | as above |
| `--date` *(daily)* | the lived day to record | *(required)* |
| `--seat` / `--vectors` | pinned into `run.json` | — |
| `--reason` *(restart)* | why the phase clock restarts, in one line | *(required)* |
| `--lived-day` *(daily)* | the store's lived day for this date, when known | — |

**Exit codes.** The preflight exits `1` on `ready: false`. The daily exits `1` on
ANY red-line — a cross-encoding breach, a v2 store not provably read-only, a
sqlite read error, a truncated event read, or a `contaminated` day. All three
exit `2` on a named REFUSAL (a run directory overlapping a live store, a corrupt
`run.json`, uncommitted bars, a day with no v1 cross-encoding probe, a
`--primacy` **or a stored `run.json` primacy** that disagrees with the assignment
file, a restart with no run record / no reason / an impossible date, **an unnamed
`--v2-data-dir` under an armed `COUNTERPARTS_REQUIRE_EXPLICIT_DIR`**). A gate that
prints red and exits 0 is a document.

### `--v2-data-dir` is announced, or refused

The #80 reviewer's finding on `bin/restart.ts` — *"writes a live path by naming
nothing"* — applies to all three bins, and to the one path of the four that the
product's own path guard does not cover. `~/.bansai` and `~/.claude-engram` are
on `store/paths.ts#FORBIDDEN_ROOT_NAMES`, so every store-open path in the product
refuses them by realpath with no variable involved; `~/.counterparts` is
deliberately **not** on that list, because the store has to be able to open its
own default. So v2's is the one path here where a default can silently choose a
live store — for a guard input, and, in the daily and the preflight, for a read.

The default stays. A default that has to be typed is a guard that is sometimes
skipped, and the overlap check needs the live stores named to have anything to
refuse. What changed is that it is never silent:

- **Named** (`--v2-data-dir <dir>` on the command line) — nothing is printed, and
  the guard is not consulted. Its question has only ever been about the fallback.
- **Unnamed** — one line on **stderr** naming the resolved path this run is being
  guarded against, so the choice is in the transcript.
- **Unnamed with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` armed** (`1`, `true` or `on`,
  trimmed, case-insensitive) — **REFUSED, exit 2**, naming the flag, before the
  overlap guard and before any directory is created. This is every agent shell in
  the repo, the install loop, and the test suite.
- **Unnamed with a value the guard will not guess at** — refused too, in the
  guard's own sentence, so the store door and this one teach one lesson. `0`,
  `false` and `off` mean off, exactly as at the store door.

`--v1-dir`, `--engram-dir` and `--ab-dir` keep their silent defaults: the first
two are covered structurally by the forbidden-roots list, and the third names an
assignment file rather than a store and already answers to `$MEMORY_AB_DIR`.

## The run directory

```
<run-dir>/
  bars.json               K, the cross-encoding bar (v1→v2, zero in every phase), the
                          meter's probe floor (crossEncodingMinLineChars), the v2→v1
                          ratio bar (crossEncodingRatioBar), a committedAt date and
                          preconditionDropDead. YOU write this, on day 0 before the flip
                          (§5 G7, G15). BOTH commands fail without it — there is no
                          default for any bar anywhere in the tool.
  ask-channel.json        precondition 8's observation, machine-read: {observedAt,
                          channel, exitCode, session}, written by YOU after the
                          throwaway-session probe. Binding at --phase 0.
  pricing.json            approvedBy / approvedAt (§5 precondition 7). You write this too.
  migration-report.json   the migrate tool's report, with source_readonly.identical (§5 P6).
  preflight.json          one row per check, four-valued, plus `ready`. No `deferred`
                          list: with the shadow phase gone, nothing is deferred.
  gate-sets.json          the three enumerated id sets AND the wiring-alive checks,
                          copied in as precondition 1 requires.
  run.json                start date, phase, primacy, active days PER PHASE, the
                          day-class list (each day stamped with its own phase), both
                          config hashes, the seat / vector pins, `surfaceSet` —
                          G12's hash of `surfaceSetFields()`, which precondition 9
                          reads — and `phaseRestart`, the latest declared restart of
                          the phase clock (below). Written tmp+rename; an unparsable
                          one THROWS rather than restarting the run.
  restarts.jsonl          one line per declared restart of the phase clock, ever: when,
                          from which day, why, and the surface-set hash at the time.
                          History, never rewritten — `run.json` carries only the latest.
  days/<date>.json        one lived day: class, counts, boundary grades, the graded
                          watches, the primacy check, mute evidence, tally, meter.
  v1-log-copies/events-<date>.jsonl
                          that day's DETECTOR lines, copied read-only — G2's evidence must
                          not depend on v1's 30-day log retention.
```

## What each preflight check verifies

| id | verifies |
|---|---|
| `assignment.health` | `override` is **exactly** `bansai` or `engram`, read through `primacy.ts` (never a second copy of the rule). `null`, absent or `"none"` is a FAILURE: it re-arms v1's alternate-day parity against a system that no longer exists while v2 mutes every day — silence, the one state neither resolver's fail direction produces alone (§5 G3). `mode` rides along advisory and never decides. |
| `assignment.realpath` | Both hook environments resolve the **same realpath**, and `MEMORY_AB_DIR` is unset for both — the variable can split the two processes onto different files, in the one file they must share (scar §2.13). |
| `datadirs.disjoint` | v2's data dir, v1's dir, the engram dir **and the run directory** are pairwise disjoint by **realpath**, none nested in another. Realpath only — a directory is never opened to find out. A path that does not exist yet is resolved through its nearest existing ancestor, so a not-yet-created nested dir cannot read as disjoint on a symlinked temp root. `RunDir.open` enforces the run-directory half structurally, before any mkdir. |
| `v2.config` | `parallel.enabled` is true, a data dir is set, both seats are `usable` per `seatStatus`, the embedder flag is reported, and credential **NAMES** are reported present/absent. A value never enters a report. |
| `replay.gate` | `parallelGateOpen` over the pass record at `<replay-out>/pass-record.json`. **No waiver, no signature** (RULED 2026-09-03): a `sample: true` record opens the gate on the same terms as a full re-run — `readOnlyProof`, `totalityOk`, the enumerated-set checks, and the three `WIRING_ALIVE` channels proven alive off the record's own rows (`preselect.meanSchemasShown` passing, `preselect.blindRate` below 1.0, `gate.refusalMix` computed). Band failures are the run's to re-earn (§5 G15) and do not shut it; MISSING evidence still does — an absent `sample` flag, an absent `counts.fail`, an unknown verdict string, a header that disagrees with its rows, an unreadable wiring row. The row prints the wiring readings it passed on. |
| `canary.transcripts` | Graded **by marker class**. v1's wake/recall markers (`FOREIGN_MARKERS` 2–4) inside a user/assistant **conversation** block are the red-line: that exclusion is carried by the host's transcript shape, so one here means the host changed. v1's **episode ask** (markers 0–1) in a user-role block is §5 G8's *designed* case — it passes, counted as `byDesign`, with `classifyBlock` asserted to agree it is `foreign`; a disagreement is its own red-line (recognizer drift). `tool_result` blocks and entries with no message role are counted as `attachmentHits`. With **no v1 marker seen anywhere** the row is `not-exercised`: an empty scan and a clean one are indistinguishable. |
| `host.hooks` | The host's hook execution model, **measured** from `hook_success` attachments, grouped **per session** (the transcript file) so hooks from different days cannot manufacture an overlap; per-hook duration min/median/max; and the **worst single session's** SessionEnd cost against the host's 1.5 s shared budget — summed when sequential, max when parallel, `Stop` excluded (a different event with a different budget). One hook alone reads `unknown`, and an unmeasured budget reads `not-exercised`. Neither is a pass (scar §2.18). |
| `bars.committed` | `bars.json` exists with `activeDayTurnFloor` (K), `crossEncodingBar`, `crossEncodingMinLineChars` (≥1), `crossEncodingRatioBar`, a dated `committedAt` and a dated `preconditionDropDead`. Undated — or `"yes"` — is a failure. A drop-dead already past fails **at `--phase 0` only**: it bars a run from STARTING (§9 OQ5), and the daily re-check runs every day of a ≥7-day run, all of them past 09-08 by arithmetic. At `--phase P` the row passes and says the date is behind us. |
| `store.schemaBytes` | Precondition 5's second reading: `self/identity.ts#schemaBytes` reproduced against a **read-only** handle (identity-band + self-kind rows, minus the F8 fallback quarantine, weighed by prose-body bytes), reported against the trip. An empty store reads `not-exercised`. |
| `precondition.2/3/4` | Carry the **names of the tests** that verify them (the G12 symmetry consumer, the `SCHEME_TAIL` bound, the poison-pill quarantine). The suite asserts those names still exist — a citation that has rotted is worse than none. |
| `precondition.5` | Follows the `store.schemaBytes` row, carrying its reading. |
| `precondition.6` | `migration-report.json` in the run directory with **`mode: "apply"`** (a dry run writes nothing, so its manifest proof is vacuous), a **`target` whose realpath is this run's `--v2-data-dir`**, and `source_readonly.identical: true` (OQ2 RULED migrated, 2026-09-03). |
| `precondition.7` | `pricing.json` with `approvedBy` and `approvedAt`. |
| `precondition.8` | `ask-channel.json` in the run directory recording `{observedAt (dated), channel, exitCode (numeric), session}` — the throwaway-session observation, machine-read rather than asserted in prose. Absent, `not-exercised`; present but incomplete, `fail`. The throwaway session must be one in which **v2 delivers**: its Stop ask never fires while it is standing down. |
| `precondition.9` | Two readings off real artifacts: the v2 store holds ≥1 durable `recall.decision` row (replay INTERFACE-GAPS §7 recorded them as not persisted — only the rows can say), **and** `run.json` carries a `surfaceSet` hash matching this build's `surfaceSetFields()`. A mismatch is G12's carry-forward rule firing. v2 records a decision only on a turn it DELIVERED, so the rows come from the same throwaway session as 8. |
| | 8 and 9 gate the **day-0 flip**. There is no S→P flip to defer them to. |

### Day 0, in order — and why the preflight is last

The full sequence with its owner-present steps lives in
`docs/PARALLEL-RUN-STATUS.md`; what belongs here is the ORDER the two commands
sit in, because it is not the obvious one:

```
… migrate, config, bars.json, wire v2's hooks, one ordinary muted session …
  daily.ts   --date <day-0> --phase 0     writes run.json + the G12 surfaceSet hash
  (throwaway session, override flipped to "engram" and back, no session open)
                                          leaves ask-channel.json + recall.decision rows
  preflight.ts --run-dir <dir> --phase 0  must exit 0: every row, 8 and 9 included
  (the flip: override -> "engram", tmp+rename, no session open, wall clock stamped)
  daily.ts   --date <day-1> --phase P --primacy v2   the flip, STAMPED into run.json
```

Three orderings that are load-bearing rather than stylistic:

- **The daily runs BEFORE the throwaway, once.** The throwaway is v2 speaking on
  a day whose primacy is still v1 — precisely the G4 contamination detector — so
  a daily re-run afterwards classes day 0 `contaminated` and exits 1, on rows
  from the one session that was supposed to speak.
- **The preflight runs LAST**, because preconditions 8 and 9 are read off the
  artifacts the two steps above leave behind.
- **The first daily AFTER the flip carries `--primacy v2`, once.** `run.json`
  holds the day-0 primacy (`v1`) and the daily inherits it when no flag is
  given, so without that one flag the run grades v2-primary days against a
  stale field. The daily now refuses rather than doing so, and `--primacy v2` —
  cross-checked against the assignment file before anything is written — is the
  deliberate act that re-stamps the record. Later days need no flag.

### `ready` means every row passed

The shadow phase is dropped (RULED 2026-09-03), so preconditions 8 and 9 gate
the day-0 flip and `--phase 0` binds them like everything else. `ready` is
therefore what the CONTRACT said in the first place — every row `pass` — and the
report carries no `deferred` list.

What makes 8 and 9 *reachable* at day 0 is the ORDER of the day-0 sequence, not a
softer rule: the throwaway session (which leaves the ask observation AND the
first `recall.decision` rows) and the day-0 daily run (which writes G12's
baseline hash into `run.json`) both come BEFORE the preflight. A row reading
`not-exercised` is telling you a step is still owed.

Two rows that look like candidates for an exemption and are deliberately not:
`store.schemaBytes` on an empty store (OQ2 ruled a MIGRATED starting store, so an
empty one is the setup not done) and `canary.transcripts` with no v1 marker in
the corpus (an empty scan and a clean one are indistinguishable). Both read
`not-exercised` and both sink `ready`.

The only thing `--phase` changes is the drop-dead: it binds the run's START.
One consequence for the daily re-check: at `--phase P` v1 is muted and emits no
wake markers, so point `--transcripts` at pre-flip days as well, or the canary
row reads `not-exercised` and sinks readiness on a corpus that never had a
marker to find.

## What the daily record says

**The day's class** (§5 "What counts as a day"). Days are stamped `0` (day 0,
before the flip) or `P` (the run, from day 1) — there is no `S`, and `run.json`'s
`activeDays` is keyed by phase, so only `P` days count toward the ≥7 minimum.
`active` requires that the day's boundary evidence held (the rule below) *and*
that the day carried at least K conversational turns. Everything else is recorded
with a class and does **not** count toward a phase minimum: `thin`,
`contaminated`, `mixed`, `silent`.

**Where the turns are counted from** (`turnSource` on the record). The committed
source is v1's per-turn capture row, `buffer.append` (`bars.json`), chosen because
v1 was the system NOT under test — a broken v2 could not grade its own day. That row
is written by bansai's Stop hook, and G38 (2026-09-10) removed that hook to stop its
per-turn encoding; from 2026-09-11 every day read "0 conversational turns" against
dozens of v2 boundaries and the phase count could never move — the instrument grading
a ruling as a failed day, the muted-consistent defect's shape. Owner ruling
2026-09-14: when v1 is **muted-consistent and logged no per-turn row at all**, the
floor is applied to `adapter.recall`, v2's one durable row per USER PROMPT, and the
record says `v2:adapter.recall`. The fallback is that narrow on purpose: one v1
`buffer.append` keeps v1 the referee, and a v1 nobody can show was alive gets no
substitute. Note the unit moves: a v1 turn is an assistant reply, a v2 turn is a
prompt. The `why` line names the source either way.

A day can match more than one, so every match is kept in `flags` and one wins
`class` by a stated precedence: **mixed → contaminated → silent → thin →
active**. Mixed goes first because a straddling session's later `ab.muted` *is*
the flip — the run's own act — not a revived instrument.

**Boundary evidence is graded per side, four-valued** (`boundaries` on the day
record), and this is the rule `thin` is derived from:

| side's grade | what it means |
|---|---|
| `pass` | that side reached a boundary this instrument can see — v1 by a `session.end` line, v2 by a `stop` primacy record (deliver **or** stand-down), an episode-ask record, or the durable `adapter.boundary` row |
| `muted-consistent` | the MUTED side reached no boundary, and that is what a working mute looks like: **v1's Stop hook logs no `ab.muted` at all**, so on a clean v2-primary day a correctly muted v1 leaves session-start and prompt-submit mute rows and no `session.end`. It requires v1's log to be PRESENT, to carry `ab.muted` rows, and to carry no delivery of its own. Its own value — never folded into `pass` |
| `fail` | boundary evidence that should be there and is not: the primary reaching no boundary, or a muted side with no `ab.muted` row at all (a side nobody can show was alive — §7's same-day encode pairing rests on v1 still encoding while muted) |
| `not-exercised` | no evidence either way: an absent v1 log for the day, or no v2 store at all. An unread log shows nothing, and never reads as a quiet one |

The day is boundary-clear when the **PRIMARY** side grades `pass` and the muted
side grades `pass` or `muted-consistent`; anything else is `thin`, and the `why`
says which side and which grade. The primary gets no exception — on a v1-primary
day (day 0) a v1 with no boundary is `thin`, as it always was.

*Why the rule moved (2026-09-04).* The old rule was `v1.sessionEnd > 0 &&
v2Boundaries > 0`, which classed day 1 of the real run `thin` on the sentence
"one of the two systems reached no session boundary on this day" — the
instrument reading the mute working as the mute broken, on a run where no
v2-primary day could then ever count.

**The primacy check runs on every daily, and it is not opt-in.** `primacyCheck`
on the day record says whether the primacy this day was graded with was
cross-checked against the assignment file's `override` — the one field both
resolvers actually read (§5 G3). The daily reads that file from `--ab-dir` (or
`--assignment`) whether or not you name one, and REFUSES with exit 2 when it
disagrees with either the `--primacy` flag **or** the primacy stored in
`run.json`. The stored half is the 2026-09-03 scar: the flip wrote its own log
and left `run.json.primacy` at `v1`, so every day after it graded
`contaminated` — "the muted v2 side delivered" — off a stale field nobody
compared. The refusal names both readings and the one deliberate act that heals
it: re-run with `--primacy <the file's value>`, which is itself cross-checked
against the file and re-stamps `run.json` (the record then says `RE-STAMPED`).
**The flip tooling lives outside this repo**, so this guard — not a flip command
— is what stands between a stale field and a run of misgraded days. When the
assignment file cannot be read at all the row prints `UNVERIFIED` with the
reason; it is never passed over in silence.

The check compares against the file's CURRENT state, which is the right
comparison for the day you are recording today and the wrong one for a
historical day whose primacy the file has since moved past. To re-record a
pre-flip day after the flip, point `--ab-dir` at the dated backup of the
assignment file taken at the flip — the file is the authority, so re-grading an
old day means reading the file as it was, never asserting a primacy over it.

**Mute evidence** is per channel, by named detector: v1's `ab.muted` split by
hook, and v2's durable `adapter.primacy.standdown` / `.deliver` split by hook.

A sixth class, **`unreadable`**, is not one of the CONTRACT's diagnoses but the
absence of one: a day whose durable v2 read errored or hit its row cap has
counts that are floors of unknown depth, so its contamination detectors read
`null` and it can never be `active`. A read that failed is not a day that was
quiet.

What the record names on its face rather than hiding:

- **`silent` is a per-session JOIN.** Every v2 adapter record carries
  `session: input.sessionId` — the host's own session id, the same one v1 stamps
  on its log lines — so a v1 session muted at start is silent when no v2
  *delivery* record names it. A stand-down is not speaking. Where v2's rows carry
  no session id at all the join is reported **UNAVAILABLE** rather than resolved
  as silence — but only rows from names that are *supposed* to carry one are
  asked (`readers.ts#SESSION_BEARING_EVENTS`, counted as
  `sessionBearingRowsForDate`). The worker's rows — `sweep.gate`, `sleep.cycle`,
  `self.briefing` — carry no session by design, and counting them made the join
  read unavailable on exactly the days v2 was quietest (G47(b), fixed
  2026-09-14). The note still prints the date's total row count beside the
  joinable one.
- **v2's durable boundary evidence is the `stop` hook's primacy record and the
  episode-ask record.** `session-end` and `pre-compact` reach `claim()` but never
  `deliveryVerdict`, and their own `adapter.boundary` event is **ring-only** — it
  is not in `DURABLE_EVENTS`. A day that ended only through those two paths is
  *unevidenced*, and the `why` says so instead of reading `thin`.
- **v1's `wake.rendered` and `wake.delivered` fire at one site** despite the
  names, so the wake channel counts the render rather than summing them into a
  double (§5 G4's closing note).
- **An absent v1 log reads `null`, never `{0,0,0}`.** v1 keeps 30 days; a run
  that outlives that must not report an unread day as a quiet one.

**The cross-encoding meter** (§5 G7) addresses every qualifying **line** of the
injected texts you point it at, and looks for those addresses in the other
side's store. Five things govern it:

- **A committed probe floor.** `crossEncodingMinLineChars` in `bars.json`, and
  there is no default. Without one `---`, `## Notes` and `Yes.` are probes:
  short structural lines that address identically in every store and manufacture
  verbatim "hits" out of markdown punctuation. Rejected probes are counted
  (`probesRejectedShort`); horizontal rules are dropped as structure before the
  floor is even applied.
- **The corpus is THIS DAY.** v2's spans by their own `at`, its prose by
  `memories.learned_on`, v1's buffer by the day its archive directory names.
  Scanning the whole store made one legitimate hit re-fire for the rest of the
  run. Lines whose date cannot be read are included and counted as
  `undatedScanned` — for a red-line, failing toward detection is right, and it
  is said out loud rather than assumed.
- **The rule is the DIRECTION's** (§9 OQ4, RULED 2026-09-03, mapped onto the
  single phase). **v1→v2** — v1's ritual text inside v2's capture — is a red-line
  on ANY hit, in every phase: that exclusion is carried by the host's transcript
  shape, so a hit means the host changed, and no denominator can buy it down.
  **v2→v1** is OQ4's accepted cost: a **named finding** at or below
  `crossEncodingRatioBar` (0.10) of v1's mints that day, a red-line above it,
  always reported with the ratio and its denominator. With no denominator the
  ratio is `null`, says so, and any hit red-lines. Before the flip (`--phase 0`)
  v2 delivers nothing, so both directions carry the zero bar.
- **v1's probe is required.** Without `--v1-wake` or `--v1-ritual` the v1→v2
  direction reads a silent zero, so the daily REFUSES rather than recording an
  unmetered day. v2's own probes come from the adapter's own `stopAsk()`,
  imported from the leaf module (`hooks.ts`) so the instrument does not pull
  `Counterpart` and `Store` into its own process. The probe unit is a LINE, and
  one line of that ask now carries the session id — that line is rendered with a
  placeholder and simply never matches; the other five are the recognizer.
- **Migrated rows are excluded by construction** — v1's text in v2's store is the
  migration, not contamination — joined on **realpaths**, because the store
  records one spelling of a path and a directory walk produces another.

A direction with **no probe** prints `UNMEASURED`, never `0/0` — a ratio of
zeroes reads as clean when it means nothing was asked. The meter carries
**addresses, never lines**. Its named blind spot — the semantic path, where the
assistant restates a delivered recall in its own words — rides beside it as
`exposureDenominator`, so the number can never be read without it.

## Restarting the phase clock

```
bun tools/parallel/bin/restart.ts --run-dir <dir> --date <YYYY-MM-DD> --reason "<text>" \
  --v2-data-dir <v2's data dir>
```

`--v2-data-dir` is written out because the shells this is typed in arm
`COUNTERPARTS_REQUIRE_EXPLICIT_DIR`, which refuses the built-in default (see
*`--v2-data-dir` is announced, or refused*, above). Without the guard the flag is
still optional and the default is announced on stderr.

CONTRACT §5 G12 prices mid-run change by class: an identical surface-set hash is
telemetry-only and the day count carries; a red-line fix restarts the clock for
the criteria whose surface set moved; **anything else restarts the phase**. The
owner ruled (2026-09-04) that the behavior-changing fixes landing during this run
take that last branch — the seven-day count starts again — and a rule with no
command behind it is a rule nobody applies. This is the command.

It writes only the run directory, like everything else here, and it refuses a run
directory that overlaps a live store before it creates anything (the same guard
the other two bins open with). What it does:

- **`activeDays` for the phase goes to zero**, and `--date` becomes the FIRST day
  of the restarted clock. Days before it, in that phase only, stop counting. A
  restart of `P` never rewrites day 0's count.
- **`run.json` gains `phaseRestart`** — `{restartedAt, date, phase, reason,
  surfaceSet, clearedActiveDays}`. This annotation is load-bearing, not
  decorative: the daily recomputes `activeDays` from `days[]` on every write, so
  a restart that only set the number would be undone by the next daily run. Both
  sides count through the one `countActiveDays` filter.
- **`restarts.jsonl` gains a line**, and keeps every earlier one.
- **`days/` is left exactly as it is.** A restarted clock is not a deleted
  history: the days stay, stamped with their class, and stop counting toward the
  minimum (§5 G10 — halt and *preserve*).

It refuses, named and with exit 2, on: a run directory with no `run.json`
(nothing to restart), a corrupt one (evidence, never a reason to start a fresh
clock), an empty `--reason` (§5 G12 records the class, and `""` is not a class),
a malformed date, and a date before the run began.

## Two gaps this tool makes visible rather than papers over

**1. Two detectors the CONTRACT names are recomputed, not rows — and the
delivery records that were not durable now are.** Box 2's `events` table takes
exactly the names in `DURABLE_EVENTS` — **sixteen** as of 2026-09-04, when the
crash gate's `sweep.gate` row joined them: after the sweep became a fallback in
fact, its ordinary day is silence, and a silent sweep and a dead worker have to
be different rows (constitution 16). On 2026-09-03 the four
delivery records (`adapter.wake.injected`, `adapter.wake.delivered`,
`adapter.recall`, `adapter.ask`) joined that list, each carrying `date`
and `session` in its payload, because on any day v2 is the muted side — day 0,
and any day the run reverts — they ARE the contamination
detectors on v2's side (§5 G4) and a detector that dies with the hook process
cannot be counted after the fact (§5 G2). This reader also counts
`recall.decision` (precondition 9's evidence) and `memory.pruned` /
`memory.merged` — the real exit path, since `Store.archive()` writes no
`versions` row and the old join against `versions.archived_at` could only ever
return a fabricated zero.

Since 2026-09-14 it also counts the two U9 rows, `sleep.cycle` and
`self.briefing` — one per cycle run and one per wake render, both carrying the
calendar `date` in their payload. Before them, the whole sleep cycle and the
whole wake render lived in a ring that died with the worker, and the only durable
evidence a cycle had run was its side effects, which a cycle that promoted,
pruned and merged nothing does not leave. `recall.credit` is counted too, ahead
of the branch that writes it (the §9.2 credit seam): a detector added after the
mechanism ships cannot say whether the first live boundary fired, which is the
I32 shape exactly.

**Reason splits (G47(a)).** Counting by NAME alone hid the keyless day: one
`sweep.gate` row a day saying `reason: "no-credential"` looked identical, in every
number the daily printed, to a healthy quiet sweep. So `byNameForDate` now carries
an extra key beside — never instead of — the total: `sweep.gate:no-credential`,
`recall.credit:credited` / `:failed` / `:budget-exceeded`, and
`sleep.cycle:failed`. The last is not a reason lookup: a bad night reaches the row
three ways — a cycle that ran end to end and lost a phase still reads
`reason: "ran"` (degrade, don't abort) and shows the loss only in `failed`, a
cycle that died reads `threw`, and one whose clock would not advance reads
`clock-failed` — and an operator asking "did the cycle have a bad night" wants one
number, so all three land in that key. `sweep.gate:refused` (G48, 2026-09-14) is the
second non-lookup split: the gate row's own `reason` reads `ran` on every
ordinary day, and what separates a quiet run from one worth reading is inside it,
in the per-reason `refusals` map. Quiet — `NO_CRASHED_SESSION`,
`NOTHING_TO_SWEEP`, `NOTHING_UNCLAIMED` — is the gate working;
`BELOW_MIN_CLAIM`, `IO_FAILED` and `OBSERVER` are a buffer that never drains, a
filesystem that refused a claim, and a stance mismatch. The list is imported from
`core/remember` so this reader cannot hold a stale copy of it, and a row written
before the map existed contributes nothing: its `otherRefusals` counter read 5–7
on every live day (a retired crashed session answers `NOTHING_TO_SWEEP` forever),
so counting it would rebuild the false signal G48 was filed about. A split key
counts rows the total already counts, so anything summing `byNameForDate` must
skip the keys with a ":" in them or it counts those rows twice; `record.ts`'s
`v2DateRows` does.

Four detectors remain non-rows by design and are named in `nonDurable` rather
than reported as zeros: `sleep.symmetry` (arithmetic over `band.transition`) and
`self.schema.*` (`schemaBytes` over the rows). A fifth, `memory.reinforced`, is
recomputed read-only from the `memories` table. **Each is GRADED**, on the day
record as `watches` and one line each in the daily's output — a value from the
four-value vocabulary plus the reason for it, never the bare comma-separated name
list that used to print (a string an operator reads past is not a verdict). `pass`
is unreachable for the first four: a watch with no reading behind it can never
render green (§5 G13). **`memory.reinforced` is the first watch here that can
actually go red** — it has a reading of its own, and on the live store today it is
expected to read `fail` until the credit seam lands. A `pass` on it should follow
the first `recall.credit:credited` row: that row is the wiring firing, this watch
is the consequence landing in the table.

| watch | value | why |
|---|---|---|
| `sleep.symmetry` | `needs-rater` when `band.transition` rows are attributable to the day, else `not-exercised` | the verdict is arithmetic OVER those rows and its rater is the G12 symmetry consumer in `src/core/sleep`, not this instrument. With no `--lived-day` nothing can be attributed at all, and the row says so rather than printing a zero |
| `self.schema.pressure` | `not-exercised` | no durable revision-pressure row exists in this build. **The revision-pressure path is being wired in a separate PR; once it lands this watch has durable `revision.pressure` events to read and its grading rule in `record.ts` should move with it.** |
| `self.schema.tripped` | `not-exercised` | the trip is `schemaBytes` over the self rows, recomputed read-only by the preflight's `store.schemaBytes` check; the daily takes no reading of its own |
| `self.schema.quarantined` | `not-exercised` | the F8 fallback quarantine is subtracted INSIDE `schemaBytes`; the SPAN quarantine ledger is a different thing and IS on the day record, as `quarantine` |
| `memory.reinforced` | `pass` / `fail` / `not-exercised` — **the one that can go red** | IMPROVEMENTS U10: has anything minted on this store since launch ever been reinforced? POST-LAUNCH is `source IS NOT NULL AND source <> 'migrated'` over live rows — `source` is the store's own record of who minted a row, `migrated` is the v1 importer's stamp, and NULL is a pre-v4 row that predates this store's minting path. `pass` when ≥ 1 of them carries `reinforced_days ≥ 1`; `not-exercised` when there are none, or when the OLDEST of them is younger than `N_PROMOTION_DAYS` (imported from physics, never restated) — deliberately the oldest and not the newest, because a store that mints at every boundary always has a newest row zero days old and a newest-row rule would hold this watch at `not-exercised` forever; otherwise `fail`, naming the counts and pointing at U10 |

The table is built by walking the reader's own `nonDurable` list, so a detector
added there with no grading rule still gets a row — `needs-rater`, saying exactly
that — rather than vanishing. One more detector,
`remember.span.quarantined`, is **recomputed here**: the line count of every
scope's `quarantine.jsonl`, on the day record as `quarantine`. Lines only — a
quarantined span is verbatim lived text.

**1b. The event read is SELECTED, not capped — and every failure is carried.**
`readV2Day` filters by detector name and by day/date in SQL, so the rows are
bounded by the day rather than by the head of the table (`ORDER BY seq ASC
LIMIT` kept the OLDEST rows on overflow; the backstop is now `DESC`). The handle
sets `busy_timeout`, because the subjects write these stores while this reads
them. A read that fails lands in `readErrors` instead of `[]`, and a day with
any read error — or a truncated read — has its contamination detectors poisoned
to `null` and takes the `unreadable` class. It can never read `active`.

**2. The core events carry no calendar date.** `gate.chunk`, `band.transition`,
`memory.pruned` and `memory.merged` write only the store's `day` column, which
is the **lived** day — no hook advances it. Every **adapter** event carries a
calendar `date` *and a `session`* in its payload (`hooks.ts#deliveryVerdict` and
`#record`), which is what makes the `silent` class a per-session join rather
than a difference of counts. So date attribution runs off the payload for the
adapter rows, and the core events — including the day's exits — are counted by
lived day only when you pass `--lived-day`. Without it the exit count is `null`
with its reason attached, never a zero.

## Guarantee 1 — the instrument writes nothing but its own run directory

Three structural guarantees, not a promise in a comment:

1. **Byte-identity.** `test/parallel.test.ts` manifests every fixture input
   directory (v1, v2, engram, the assignment dir, transcripts, the replay out
   dir, the config dir) before and after a full preflight **plus** a daily run,
   and asserts the manifests are identical — while also asserting the run
   directory is not empty, so the check cannot pass vacuously.
2. **A source scan.** Every `.ts` under `tools/parallel/`, `bin/` included, is
   scanned for filesystem write APIs. Only `writer.ts` may hold one, and the
   test asserts that it does — so the scan is not passing because nothing writes
   anywhere. `RunDir` also refuses any path that escapes its root (by
   **realpath**, so a symlink cannot walk out) and any run directory that
   overlaps a live store, in either direction, **before** it mkdirs anything.
3. **The write probe leaves nothing behind.** The read-only handle is proved by
   an attempted DDL write wrapped in `BEGIN IMMEDIATE` … `ROLLBACK` — the old
   probe was a bare `CREATE TABLE IF NOT EXISTS`, a real committed write into
   the owner's live store if the read-only flag ever failed to take. A handle
   that ACCEPTS the write makes the reader throw rather than report.

The scan covers `bin/restart.ts` like everything else: the restart engine holds
no write API at all — it returns artifacts and the bin hands them to `RunDir`,
which is why `restarts.jsonl` is appended by reading the file and writing the
whole text back rather than by opening it for append.

A fourth test holds the hermetic line: no module but `bin/` may import
`node:os` — every module in the directory is walked, so a new one cannot slip
past the rule.
`homedir()` does not read `$HOME` on Bun, so a module that used it would resolve
the real `~/.memory-ab` inside a test that believed it had redirected it.

# `tools/parallel/` — the parallel run's instrument

`CONTRACT.md` is the design. This is the operator's half: what the two commands
do, what lands in the run directory, and what each check actually verifies.

The instrument is an **observer**. The subjects — v1 (bansai) and Counterparts —
run their own production paths and write their own live stores; this tool reads
both and writes exactly one thing: the run directory you name. That is CONTRACT
§5 G1, and it is test-asserted two ways (see *Guarantee 1*, below).

## The two commands

```
bun tools/parallel/bin/preflight.ts --run-dir <dir> [options]
bun tools/parallel/bin/daily.ts     --run-dir <dir> --date <YYYY-MM-DD> [options]
```

Every real path is a flag. The defaults name the live locations, because that is
where the run happens; `bin/` is the only place in the tool that resolves a home
directory at all, so nothing else can reach one by accident.

| flag | what it points at | default |
|---|---|---|
| `--run-dir` | the run directory — **the only thing written** | *(required)* |
| `--v1-dir` | v1's data dir, read-only | `~/.bansai` |
| `--v2-data-dir` | v2's data dir, read-only | `~/.counterparts` |
| `--v2-config` | v2's adapter config JSON | — |
| `--engram-dir` | the third store, for the disjointness check | `~/.claude-engram` |
| `--ab-dir` | the primacy assignment directory | `$MEMORY_AB_DIR` or `~/.memory-ab` |
| `--replay-out` | the replay run's `--out` dir (holds `pass-record.json`) | — |
| `--transcripts` | a transcript file or directory; repeatable | — |
| `--phase` | `0`, `S` or `P` — which phase's gates to enforce | `0` |
| `--v1-wake` / `--v2-wake` | a rendered wake, for the cross-encoding meter | — |
| `--v1-ritual` *(daily)* | v1's ritual ask text, as cross-encoding probes | — |
| `--engram-dir` / `--ab-dir` *(daily too)* | checked disjoint from `--run-dir` before anything is created | as above |
| `--date` *(daily)* | the lived day to record | *(required)* |
| `--seat` / `--vectors` | pinned into `run.json` | — |
| `--lived-day` *(daily)* | the store's lived day for this date, when known | — |

**Exit codes.** The preflight exits `1` on `ready: false`. The daily exits `1` on
ANY red-line — a cross-encoding breach, a v2 store not provably read-only, a
sqlite read error, a truncated event read, or a `contaminated` day. Both exit `2`
on a named REFUSAL (a run directory overlapping a live store, a corrupt
`run.json`, uncommitted bars, a day with no v1 cross-encoding probe, a
`--primacy` that disagrees with the assignment file). A gate that prints red and
exits 0 is a document.

## The run directory

```
<run-dir>/
  bars.json               K, the cross-encoding bar, the meter's probe floor
                          (crossEncodingMinLineChars), Phase P's ratio bar
                          (crossEncodingRatioBar), a committedAt date and
                          preconditionDropDead. YOU write this, before Phase S day 1
                          (§5 G7, G15). BOTH commands fail without it — there is no
                          default for any bar anywhere in the tool.
  ask-channel.json        precondition 8's observation, machine-read: {observedAt,
                          channel, exitCode, session}, written by YOU after the
                          throwaway-session probe.
  pricing.json            approvedBy / approvedAt (§5 precondition 7). You write this too.
  waivers.json            owner-signed waivers. Precondition 1's is `{precondition: 1,
                          recordId, signedBy, signedAt, reason}` naming the replay record.
  migration-report.json   the migrate tool's report, with source_readonly.identical (§5 P6).
  preflight.json          one row per check, four-valued, plus `ready` and `deferred`.
  gate-sets.json          the three enumerated id sets, copied in as precondition 1 requires.
  run.json                start date, phase, primacy, active days PER PHASE, the
                          day-class list (each day stamped with its own phase), both
                          config hashes, the seat / vector pins, and `surfaceSet` —
                          G12's hash of `surfaceSetFields()`, which precondition 9
                          reads. Written tmp+rename; an unparsable one THROWS rather
                          than restarting the run.
  days/<date>.json        one lived day: class, counts, mute evidence, tally, meter.
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
| `replay.gate` | `parallelGateOpen` over the pass record at `<replay-out>/pass-record.json` and the waivers at `<run-dir>/waivers.json`. Every refusal names its reason. |
| `canary.transcripts` | Graded **by marker class**. v1's wake/recall markers (`FOREIGN_MARKERS` 2–4) inside a user/assistant **conversation** block are the red-line: that exclusion is carried by the host's transcript shape, so one here means the host changed. v1's **episode ask** (markers 0–1) in a user-role block is §5 G8's *designed* case — it passes, counted as `byDesign`, with `classifyBlock` asserted to agree it is `foreign`; a disagreement is its own red-line (recognizer drift). `tool_result` blocks and entries with no message role are counted as `attachmentHits`. With **no v1 marker seen anywhere** the row is `not-exercised`: an empty scan and a clean one are indistinguishable. |
| `host.hooks` | The host's hook execution model, **measured** from `hook_success` attachments, grouped **per session** (the transcript file) so hooks from different days cannot manufacture an overlap; per-hook duration min/median/max; and the **worst single session's** SessionEnd cost against the host's 1.5 s shared budget — summed when sequential, max when parallel, `Stop` excluded (a different event with a different budget). One hook alone reads `unknown`, and an unmeasured budget reads `not-exercised`. Neither is a pass (scar §2.18). |
| `bars.committed` | `bars.json` exists with `activeDayTurnFloor` (K), `crossEncodingBar`, `crossEncodingMinLineChars` (≥1), `crossEncodingRatioBar`, a dated `committedAt` and a dated `preconditionDropDead`. Undated — or `"yes"` — is a failure, and a drop-dead already past is a failure too (§5 P1, §9 OQ5). |
| `store.schemaBytes` | Precondition 5's second reading: `self/identity.ts#schemaBytes` reproduced against a **read-only** handle (identity-band + self-kind rows, minus the F8 fallback quarantine, weighed by prose-body bytes), reported against the trip. An empty store reads `not-exercised`. |
| `precondition.2/3/4` | Carry the **names of the tests** that verify them (the G12 symmetry consumer, the `SCHEME_TAIL` bound, the poison-pill quarantine). The suite asserts those names still exist — a citation that has rotted is worse than none. |
| `precondition.5` | Follows the `store.schemaBytes` row, carrying its reading. |
| `precondition.6` | `migration-report.json` in the run directory with **`mode: "apply"`** (a dry run writes nothing, so its manifest proof is vacuous), a **`target` whose realpath is this run's `--v2-data-dir`**, and `source_readonly.identical: true` (OQ2 RULED migrated, 2026-09-03). |
| `precondition.7` | `pricing.json` with `approvedBy` and `approvedAt`. |
| `precondition.8` | `ask-channel.json` in the run directory recording `{observedAt (dated), channel, exitCode (numeric), session}` — the throwaway-session observation, machine-read rather than asserted in prose. Absent, `not-exercised`; present but incomplete, `fail`. |
| `precondition.9` | Two readings off real artifacts: the v2 store holds ≥1 durable `recall.decision` row (replay INTERFACE-GAPS §7 recorded them as not persisted — only the rows can say), **and** `run.json` carries a `surfaceSet` hash matching this build's `surfaceSetFields()`. A mismatch is G12's carry-forward rule firing. |
| | 8 and 9 gate the **S→P flip**, not day 1 — run `--phase P` and they stop being deferred. |

### `ready` is phase-scoped, and why

The CONTRACT says preconditions 8 and 9 "gate the S→P flip, not day 1", so
before Phase P they are `not-exercised` by design. Every row therefore declares
which gate it holds, and `ready` is computed over the rows gating the phase you
are flying; the rest are listed in `deferred`. Run `--phase P` and the whole set
must pass.

## What the daily record says

**The day's class** (§5 "What counts as a day"). `active` requires that both
systems reached at least one session boundary *and* the day carried at least K
conversational turns. Everything else is recorded with a class and does **not**
count toward a phase minimum: `thin`, `contaminated`, `mixed`, `silent`.

A day can match more than one, so every match is kept in `flags` and one wins
`class` by a stated precedence: **mixed → contaminated → silent → thin →
active**. Mixed goes first because a straddling session's later `ab.muted` *is*
the flip — the run's own act — not a revived instrument.

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
  as silence.
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
- **The rule is the PHASE's** (§9 OQ4, RULED 2026-09-03). Phase S: any hit in
  either direction is a red-line — the host's transcript shape carries v1's
  exclusion, so a hit means the host changed. Phase P: any hit is a **named
  finding**, and a red-line only above `crossEncodingRatioBar` (0.10) of v1's
  mints that day, reported with the ratio and its denominator. With no
  denominator the ratio is `null` and says so.
- **v1's probe is required.** Without `--v1-wake` or `--v1-ritual` the v1→v2
  direction reads a silent zero, so the daily REFUSES rather than recording an
  unmetered day. v2's own probes come from the adapter's `AUTHORSHIP_ASK`
  constant, imported from the leaf module (`hooks.ts`) so the instrument does not
  pull `Counterpart` and `Store` into its own process.
- **Migrated rows are excluded by construction** — v1's text in v2's store is the
  migration, not contamination — joined on **realpaths**, because the store
  records one spelling of a path and a directory walk produces another.

A direction with **no probe** prints `UNMEASURED`, never `0/0` — a ratio of
zeroes reads as clean when it means nothing was asked. The meter carries
**addresses, never lines**. Its named blind spot — the semantic path, where the
assistant restates a delivered recall in its own words — rides beside it as
`exposureDenominator`, so the number can never be read without it.

## Two gaps this tool makes visible rather than papers over

**1. Two detectors the CONTRACT names are recomputed, not rows — and the
delivery records that were not durable now are.** Box 2's `events` table takes
exactly the **thirteen** names in `DURABLE_EVENTS`. On 2026-09-03 the four
delivery records (`adapter.wake.injected`, `adapter.wake.delivered`,
`adapter.recall`, `adapter.episode.ask`) joined that list, each carrying `date`
and `session` in its payload, because in Phase S they ARE the contamination
detectors on v2's side (§5 G4) and a detector that dies with the hook process
cannot be counted after the fact (§5 G2). This reader also counts
`recall.decision` (precondition 9's evidence) and `memory.pruned` /
`memory.merged` — the real exit path, since `Store.archive()` writes no
`versions` row and the old join against `versions.archived_at` could only ever
return a fabricated zero.

Two remain non-rows by design and are named in `nonDurable` rather than reported
as zeros: `sleep.symmetry` (arithmetic over `band.transition`) and
`self.schema.*` (`schemaBytes` over the rows). A third,
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

Two structural tests, not a promise in a comment:

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

A third test holds the hermetic line: no module but `bin/` may import `node:os`.
`homedir()` does not read `$HOME` on Bun, so a module that used it would resolve
the real `~/.memory-ab` inside a test that believed it had redirected it.

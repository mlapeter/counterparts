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
| `--date` *(daily)* | the lived day to record | *(required)* |
| `--seat` / `--vectors` | pinned into `run.json` | — |
| `--lived-day` *(daily)* | the store's lived day for this date, when known | — |

**Exit codes.** The preflight exits `1` on `ready: false`; the daily exits `1` on
a cross-encoding red-line. A gate that prints red and exits 0 is a document.

## The run directory

```
<run-dir>/
  bars.json               K, the cross-encoding bar, and a committedAt date. YOU write this,
                          before Phase S day 1 (§5 G7, G15). The preflight fails without it.
  pricing.json            approvedBy / approvedAt (§5 precondition 7). You write this too.
  waivers.json            owner-signed waivers. Precondition 1's is `{precondition: 1,
                          recordId, signedBy, signedAt, reason}` naming the replay record.
  migration-report.json   the migrate tool's report, with source_readonly.identical (§5 P6).
  preflight.json          one row per check, four-valued, plus `ready` and `deferred`.
  gate-sets.json          the three enumerated id sets, copied in as precondition 1 requires.
  run.json                start date, phase, primacy, active days per phase, the day-class
                          list, both config hashes, and the seat / vector pins.
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
| `datadirs.disjoint` | v2's data dir, v1's dir and the engram dir are pairwise disjoint by **realpath**, none nested in another. Realpath only — a directory is never opened to find out. A path that does not exist yet is resolved through its nearest existing ancestor, so a not-yet-created nested dir cannot read as disjoint on a symlinked temp root. |
| `v2.config` | `parallel.enabled` is true, a data dir is set, both seats are `usable` per `seatStatus`, the embedder flag is reported, and credential **NAMES** are reported present/absent. A value never enters a report. |
| `replay.gate` | `parallelGateOpen` over the pass record at `<replay-out>/pass-record.json` and the waivers at `<run-dir>/waivers.json`. Every refusal names its reason. |
| `canary.transcripts` | Zero `FOREIGN_MARKERS` hits inside user/assistant **conversation** blocks. `tool_result` blocks and entries with no message role are the host-carried exclusion and are counted separately as `attachmentHits` — so a host upgrade that starts routing them as messages shows up as the number moving between columns (§5 G8). |
| `host.hooks` | The host's hook execution model, **measured** from `hook_success` attachments (overlapping windows for one event ⇒ parallel), per-hook duration min/median/max, and the SessionEnd cost against the host's 1.5 s shared budget — summed when sequential, max when parallel. One hook alone reads `unknown`, which is not a pass (scar §2.18). |
| `bars.committed` | `bars.json` exists with `activeDayTurnFloor` (K), `crossEncodingBar`, and a `committedAt` that parses as a `YYYY-MM-DD` date. Undated — or `"yes"` — is a failure. |
| `store.schemaBytes` | Precondition 5's second reading: `self/identity.ts#schemaBytes` reproduced against a **read-only** handle (identity-band + self-kind rows, minus the F8 fallback quarantine, weighed by prose-body bytes), reported against the trip. An empty store reads `not-exercised`. |
| `precondition.2/3/4` | Carry the **names of the tests** that verify them (the G12 symmetry consumer, the `SCHEME_TAIL` bound, the poison-pill quarantine). The suite asserts those names still exist — a citation that has rotted is worse than none. |
| `precondition.5` | Follows the `store.schemaBytes` row, carrying its reading. |
| `precondition.6` | `migration-report.json` in the run directory with `source_readonly.identical: true` (OQ2 RULED migrated, 2026-09-03). |
| `precondition.7` | `pricing.json` with `approvedBy` and `approvedAt`. |
| `precondition.8/9` | Emitted `not-exercised` with the CONTRACT's own wording. They gate the **S→P flip**, not day 1 — run `--phase P` and they stop being free. |

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

Three approximations the record names on its face rather than hiding:

- **`silent` is a count difference, not a per-session join.** v2's durable
  primacy payload is `{hook, reason, system, date}` and carries **no session
  id**, so a v2 record cannot be matched to a v1 session. The class counts N v1
  sessions muted at start against M v2 session-start deliveries and reports
  `N − M`. The `why` says `COUNT-LEVEL` so the approximation travels with the
  number.
- **v2's boundary evidence is the `stop` hook only.** `sessionEnd` and
  `pre-compaction` never call `deliveryVerdict`, so a session-start primacy
  record is not a boundary and is not read as one.
- **v1's `wake.rendered` and `wake.delivered` fire at one site** despite the
  names, so the wake channel counts the render rather than summing them into a
  double (§5 G4's closing note).

**The cross-encoding meter** (§5 G7) addresses every non-empty **line** of the
injected texts you point it at, and looks for those addresses in the other
side's store — v2's captured spans and its non-`migrated` prose bodies, v1's
buffer. v2's own probes come from the adapter's `AUTHORSHIP_ASK` constant (one
recognizer list, one place, the rule `FOREIGN_MARKERS` follows); v1's ritual
text is a `--v1-ritual <file>`. A direction with **no probe** prints
`UNMEASURED`, never `0/0` — a ratio of zeroes reads as clean when it means
nothing was asked. Rows whose mint source is `migrated` are excluded by construction: v1's
text in v2's store is the migration, not contamination. Above the committed bar
it is a red-line and the command exits 1. The meter carries **addresses, never
lines**. Its named blind spot — the semantic path, where the assistant restates
a delivered recall in its own words — rides beside it as
`exposureDenominator`, so the number can never be read without it.

## Two gaps this tool makes visible rather than papers over

**1. Three detectors the CONTRACT names are recomputed, not rows — and four
that were not durable now are.** Box 2's `events` table takes exactly the names
in `DURABLE_EVENTS`. On 2026-09-03 the four delivery records
(`adapter.wake.injected`, `adapter.wake.delivered`, `adapter.recall`,
`adapter.episode.ask`) joined that list, each carrying `date` and `session` in
its payload, because in Phase S they ARE the contamination detectors on v2's
side (§5 G4) and a detector that dies with the hook process cannot be counted
after the fact (§5 G2). Three remain non-rows by design and are recomputed
read-only rather than fabricated as zeros: `sleep.symmetry` is arithmetic over
`band.transition`; `remember.span.quarantined` is the line count of each
scope's `quarantine.jsonl`; `self.schema.*` is `schemaBytes` over the rows.
They are returned in `nonDurable`, by name.

**1b. The event read is capped, and says when it capped.** `readV2Day` selects
with an explicit large limit (the store's own `eventLog` defaults to 500, which
a real day would blow past silently). When the read hits its cap the day record
carries `truncated: true` and the CLI prints it, because every count below it is
then a floor rather than a total.

**2. Two durable events carry no date.** `gate.chunk` and `band.transition`
write only the store's `day` column, which is the **lived** day — no hook
advances it. Only the adapter's primacy events carry a calendar `date` in their
payload. So date attribution runs off the payload for those, and the core events
are counted by lived day only when you pass `--lived-day`.

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
   anywhere. `RunDir` also refuses any path that escapes its root.

A third test holds the hermetic line: no module but `bin/` may import `node:os`.
`homedir()` does not read `$HOME` on Bun, so a module that used it would resolve
the real `~/.memory-ab` inside a test that believed it had redirected it.

# Mechanism fire-count audit (v1 → v2 greenfield)

*Run 2026-08-25. Source: `~/.bansai/logs/events-*.jsonl` (read-only), 26 files,
64,952 lines, 2026-07-27 through 2026-08-25, 0 JSON parse errors. Expected
vocabulary: `EVENT_TYPES` in `src/log.ts` (73 real entries — one string in a
comment false-matched the extraction regex and was discarded). 51 of 73 types
fired at least once in the window; 22 never fired. Purpose: per constitution
line 11 ("mechanisms earn their place by firing in real use"), decide what v2
inherits as load-bearing, what it inherits as insurance, and what it drops.*

## 1. Fire counts per event type

Sorted by count. `sessions` = distinct non-null `session` id values seen on
that event (many mechanisms run in the detached consolidation runner and log
`session: null` by design — see Caveats).

| type | count | first seen | last seen | distinct sessions |
|---|---:|---|---|---:|
| store.write | 46,932 | 2026-07-27 | 2026-08-25 | 0 (background) |
| op.applied | 7,568 | 2026-07-27 | 2026-08-25 | 3 |
| runner.done | 1,585 | 2026-07-27 | 2026-08-25 | 0 (background) |
| gradient.move | 895 | 2026-07-27 | 2026-08-25 | 0 (background) |
| wake.rendered | 790 | 2026-07-27 | 2026-08-25 | 3 |
| runner.start | 782 | 2026-07-27 | 2026-08-25 | 0 (background) |
| embed.refresh | 782 | 2026-07-27 | 2026-08-25 | 0 (background) |
| buffer.claim | 776 | 2026-07-27 | 2026-08-25 | 0 (background) |
| assimilate.done | 776 | 2026-07-27 | 2026-08-25 | 0 (background) |
| buffer.archive | 776 | 2026-07-27 | 2026-08-25 | 0 (background) |
| interpret.done | 774 | 2026-07-27 | 2026-08-25 | 0 (background) |
| encode.gated | 734 | 2026-07-27 | 2026-08-25 | 0 (background) |
| gradient.cross | 344 | 2026-08-15 | 2026-08-25 | 0 (background) |
| episode.ingested | 213 | 2026-07-29 | 2026-08-25 | 0 (background) |
| reinforce.miss | 172 | 2026-08-15 | 2026-08-25 | 0 (background) |
| selfindex.refresh | 163 | 2026-08-15 | 2026-08-25 | 0 (background) |
| episode.asked | 121 | 2026-07-29 | 2026-08-25 | 73 |
| episode.tail | 107 | 2026-07-27 | 2026-08-25 | 107 |
| buffer.append | 98 | 2026-08-19 | 2026-08-25 | 15 |
| episode.regrown | 92 | 2026-07-30 | 2026-08-25 | 0 (background) |
| surface.decision | 88 | 2026-07-30 | 2026-08-25 | 19 |
| thread.matchMiss | 56 | 2026-08-04 | 2026-08-19 | 0 (background) |
| thread.matched | 52 | 2026-08-04 | 2026-08-25 | 1 |
| op.rejected | 40 | 2026-07-29 | 2026-08-24 | 0 (background) |
| decay.tick | 26 | 2026-07-27 | 2026-08-25 | 0 (background) |
| backup.snapshot | 26 | 2026-07-27 | 2026-08-25 | 0 (background) |
| interpret.noSchemas | 22 | 2026-08-19 | 2026-08-25 | 0 (background) |
| prospective.suppressed | 18 | 2026-08-25 | 2026-08-25 | 0 (background) |
| prospective.fire | 15 | 2026-07-30 | 2026-08-17 | 0 (background) |
| decay.expire | 15 | 2026-08-17 | 2026-08-22 | 0 (background) |
| cursor.prune | 14 | 2026-08-19 | 2026-08-25 | 0 (background) |
| session.end | 14 | 2026-08-19 | 2026-08-25 | 14 |
| session.start | 14 | 2026-08-21 | 2026-08-25 | 14 |
| wake.delivered | 14 | 2026-08-21 | 2026-08-25 | 14 |
| op.deferred | 12 | 2026-07-29 | 2026-08-04 | 0 (background) |
| buffer.restore | 11 | 2026-07-29 | 2026-08-24 | 0 (background) |
| observer.skip | 9 | 2026-08-05 | 2026-08-15 | 1 |
| system.error | 7 | 2026-07-29 | 2026-08-05 | 1 |
| prospective.referenced | 6 | 2026-07-31 | 2026-08-17 | 6 |
| buffer.prune | 6 | 2026-08-19 | 2026-08-25 | 0 (background) |
| interpret.parseRetry | 5 | 2026-07-31 | 2026-08-04 | 0 (background) |
| edges.flush | 5 | 2026-08-22 | 2026-08-25 | 0 (background) |
| belief.minted | 3 | 2026-07-27 | 2026-07-30 | 0 (background) |
| selfindex.recompress | 3 | 2026-08-22 | 2026-08-22 | 0 (background) |
| note.append | 2 | 2026-07-30 | 2026-07-30 | 0 (background) |
| hygiene.run | 2 | 2026-08-04 | 2026-08-14 | 0 (background) |
| thread.openDeduped | 1 | 2026-08-08 | 2026-08-08 | 0 (background) |
| evidence.anchorMiss | 1 | 2026-08-18 | 2026-08-18 | 0 (background) |
| accommodate.invited | 1 | 2026-08-24 | 2026-08-24 | 0 (background) |
| accommodate.fired | 1 | 2026-08-24 | 2026-08-24 | 0 (background) |
| interpret.rejected | 1 | 2026-08-25 | 2026-08-25 | 0 (background) |

"0 (background)" means every occurrence logged `session: null` — these fire
from the detached consolidation runner (scar #4), which is scoped by
`scope`/`cycle`, not by an interactive session id. That is expected behavior,
not a defect.

## 2. Flags

### 2a. NEVER-FIRED event families (22 of 73 declared types)

Cross-checked against every `logEvent(...)` call site under `src/` and
`hooks/` (152 call sites; all use string-literal types except one generic
passthrough in `src/model/ops.ts:582`, which only ever forwards `op.applied`/
`op.deferred`/`op.rejected` — all three fire). No type appears in the logs
that is absent from `EVENT_TYPES` (zero schema drift).

- `store.archive` — `archiveCanonical()` in `src/store/files.ts` is called
  from exactly one place (`src/store/erase.ts:283`, the erase-cancel path).
  Since `erase.*` never fired (below), this never fired either. Distinct from
  `store.write`'s own `archived: true` flag (archive-on-overwrite), which
  fires routinely (38/1,262 store.write events sampled on 2026-08-19) — the
  *overwrite* archive path is alive; the *removal* archive path has never run.
- `schema.created`, `schema.birthRefused` — autonomous schema birth (item 18):
  zero knocks, not zero refusals. Matches CLAUDE.md's standing watch note.
- `ab.muted` — A/B alternation was paused 2026-07-17, before this log window
  opens (2026-07-27). Expected zero; not evidence the mechanism is dead, just
  that it's switched off upstream of the logging.
- `erase.requested`, `erase.canceled`, `erase.executed`, `erase.denied` — the
  owner-only erase op has never been invoked in the window. Matches
  CLAUDE.md: "no erase production run is needed... machinery stays built and
  ready, without a designated target."
- `protected.queued`, `protected.confirmed`, `protected.denied` — the
  second-signature queue (`bansai protected`, shipped 2026-08-19) has taken
  zero proposals through it in six days of window overlap.
- `selfstore.append`, `selfstore.encoded`, `selfstore.dedup`, `selfstore.clamp`
  — the self-store (item 18 piece A). Matches CLAUDE.md's own standing watch:
  `selfstore.append` still zero after the wake pointer shipped 08-24.
- `preselect.semanticSkip` — the option (b) semantic preselection channel
  shipped 2026-08-25, the last day of this window; zero fires is one day of
  exposure, not evidence of anything yet.
- `accommodate.refused`, `accommodate.declined` — accommodation fired exactly
  once (below) and was never refused/declined in the window; n is too small
  to call this either way.
- `ledger.reopenSuppressed`, `evidence.anchorFallback` — accommodation
  residuals (2026-07-25 vintage) with no observed trigger condition all month.
- `clock.clamp` — active-day clock guard (scar #8) never had to clamp
  anything; `decay.tick` ran cleanly 26 times without needing correction.
- `thread.matchAmbiguous` — of 108 thread-matching decisions (52 matched + 56
  missed), none were ambiguous enough to need this branch.

### 2b. RARE-BUT-CRITICAL fires — insurance mechanisms

| event | count | verdict |
|---|---:|---|
| `buffer.restore` | 11 | **Earned its keep.** 7 `partial` + 4 `full` restores across 8 distinct project scopes, 2026-07-29 through 2026-08-24 — spread across the whole window, not one incident. This is scar #6 (buffer-restore-on-throw) doing exactly its job: extraction/assimilation threw and the input buffer came back instead of being silently lost. |
| `op.rejected` | 40 | **Earned its keep.** Real rejections across 5 op kinds: `currentState.update` (15), `belief.supersede` (10), `thread.resolve` (8), `thread.add` (6), `ledger.open` (1). The guardrail is actively blocking bad writes, not a dead check. |
| `system.error` | 7 | **Earned its keep, narrowly.** 6 of 7 are `interpret.chunk` failures, 1 is `boundary.hebbian` — small blast radius, and scar #1 (chunked batches, per-chunk isolation) is presumably why these didn't cascade. Low count either means the pipeline is solid or that failure surfaces are still hard to trigger; can't distinguish from logs alone. |
| `observer.skip` | 9 | **Earned its keep.** 5 `boundary.encode` + 4 `stop.episodeAsk` skips — contract 7 (observer mode deposits nothing) firing on real observer sessions, not just passing a test. |
| `prospective.suppressed` | 18 | **Earned its keep, but note the shape.** All 18 fired on a single day (2026-08-25) with reason `prior-session-high-affect` — one prospective-memory episode, or a burst from one session, suppressing repeatedly. Real behavior, but n=18 is really "fired in anger once," not 18 independent proofs. |

## 3. Caveats (read before trusting any count above)

- **Bounded retention, ~1-month window.** Logs start 2026-07-27; nothing
  earlier survived pruning (`pruneLogs`, the one system-path exception to
  no-silent-destruction). A **zero count above does NOT mean "never fired in
  v1's lifetime"** — it means "not observed in the last ~29 days as of
  2026-08-25." `erase.*`, `selfstore.*`, `protected.*`, and `schema.*` are
  genuinely young/idle mechanisms per CLAUDE.md's own standing watches, but
  that's corroboration from the decision journal, not something the logs
  alone can prove — older evidence is gone by design.
- **`store.write` at 46,932 (72% of all events) reflects write churn, not
  importance.** Every canonical file touch — including strength-only
  frontmatter rewrites that skip archiving — logs one. It's the right count
  for "how much I/O does this system do," the wrong count for "how important
  is writing." Don't rank mechanism importance by raw event volume without
  correcting for this.
- **Reads-back are mostly not logged — the evidence gap for archival
  mechanisms.** This audit can show that `store.write` archives content
  (archive-on-overwrite) and that `backup.snapshot` ran 26 times, but there is
  **no `logEvent` call anywhere that fires when an archived copy, a backup
  snapshot, or a tombstone record is actually read back** by anyone (owner or
  system). `wake.rendered`/`wake.delivered` tell you memory was surfaced into
  context, and `episode.*` tells you episodes were asked/ingested/regrown —
  those are the closest things to "reads back" in this log, and even they
  measure delivery, not confirmed use. For backups, archive/, and tombstones
  specifically: **this audit has no data**, and none should be inferred. That
  gap is a v2 instrumentation decision (log the read), not a finding this
  data can answer.
- **`session: null` is not missing data.** The detached consolidation runner
  (scar #4) logs `scope`/`cycle` instead of `session` by design; treating
  those rows as "0 sessions used this" would be wrong. Distinguish
  interactive-session mechanisms (episode.*, wake.delivered, session.*,
  surface.decision, buffer.append, observer.skip, prospective.referenced —
  all show real distinct-session counts) from background-cycle mechanisms
  (everything else) before comparing "how many sessions touched this."
- **Small-n rare fires can look more or less earned than they are.**
  `prospective.suppressed`'s 18 fires are one day, one reason — real, but
  don't read it as 18 independent tests of the mechanism. Conversely
  `accommodate.fired`'s 1 fire is a single, well-corroborated event
  (`led_82975ae8c1c043e8`, cross-checked against CLAUDE.md's flow-walk
  acceptance note, matching exactly) — n=1 here is a landmark, not noise.

## 4. Verdict table for v2

LIVE = fires routinely across the window. INSURANCE-EARNED = rare, but fired
for real and did its job. UNTESTED = built, zero fires (or evidence gap too
large to call).

| family | representative events (count) | verdict |
|---|---|---|
| encode gates | `encode.gated` (734) | **LIVE.** Fires on essentially every consolidation cycle alongside interpret/assimilate. |
| interpretation | `interpret.done` (774), `.noSchemas` (22), `.parseRetry` (5), `.rejected` (1); `preselect.semanticSkip` (0) | **LIVE** core path; **UNTESTED** for the new semantic-preselect channel (shipped last day of window — too young to call, see Caveats). |
| assimilation | `assimilate.done` (776), `op.applied` (7,568), `gradient.move` (895), `reinforce.miss` (172), `belief.minted` (3) | **LIVE.** The busiest mechanism family in the system by volume and session coverage. |
| accommodation / ledger | `accommodate.invited`/`fired` (1 each); `.refused`/`.declined` (0); `ledger.reopenSuppressed`, `evidence.anchorFallback` (0) | **INSURANCE-EARNED.** One fire, but it's the flow-walk's final acceptance — corroborated externally, real end-to-end supersede. The refusal/decline/residual branches remain UNTESTED. |
| hebbian | `edges.flush` (5, logged only when nonzero) | **INSURANCE-EARNED.** Rare because most per-turn deltas apparently don't clear the nonzero-flush bar, but when they do, the flush lands (scar #5 lock discipline never produced a `system.error` here). |
| decay | `decay.tick` (26), `decay.expire` (15); `clock.clamp` (0) | **LIVE** for tick/expire (one per active day, tracks the ~1-month window almost exactly); the active-day clamp guard is **UNTESTED** — never needed. |
| prospective | `prospective.fire` (15), `.suppressed` (18), `.referenced` (6) | **LIVE**, though thin — real fires across multiple weeks and 6 distinct sessions for `.referenced`, but total volume is low relative to other families. |
| episodes | `episode.asked` (121, 73 sessions), `.ingested` (213), `.regrown` (92), `.tail` (107, 107 sessions) | **LIVE.** Best session-coverage of any family — this is a per-session, per-interaction mechanism, not a background sweep. |
| wake | `wake.rendered` (790), `.delivered` (14), `selfindex.refresh` (163), `.recompress` (3) | **LIVE** for render/refresh; `.delivered`'s low count (14) reflects it being a recent addition (first seen 08-21, hook-emitted) tracking actual interactive sessions, not a health problem. |
| observer | `observer.skip` (9) | **INSURANCE-EARNED.** Small n, but real observer sessions stood down cleanly on both call sites that exist (boundary.encode, stop.episodeAsk). `ab.muted` UNTESTED (feature paused before window). |
| backup | `backup.snapshot` (26) | **LIVE** for the write side (~1/day, tracks active days). **Evidence gap** on the read side — no logged restore-from-backup event exists to confirm backups are ever consulted (see Caveats). |
| erase | `erase.requested/canceled/executed/denied`, `store.archive` (all 0) | **UNTESTED.** Entirely idle this window — deliberately so, per CLAUDE.md ("no designated target"). Cannot distinguish "well-behaved dormancy" from "would break if invoked" from logs alone. |
| threads | `thread.matched` (52), `.matchMiss` (56), `.matchAmbiguous` (0), `.openDeduped` (1) | **LIVE** for match/miss (roughly even split, real signal); `.matchAmbiguous` UNTESTED — the tie-break branch has never been exercised. |

**Bottom line for the v2 rewrite:** the write/interpret/assimilate/wake/
episode spine is unambiguously load-bearing — keep it whole. Accommodation,
hebbian-flush, observer-skip, buffer-restore, and op-rejected are insurance
mechanisms that have each fired for real and caught something — keep them,
but they don't need the same engineering investment as the spine. Erase,
selfstore, protected-queue, schema-birth, and semantic-preselect are built
and structurally sound but functionally untested in production; v2 should
either carry them forward as declared-dormant-by-design (matching the owner's
own read of erase) or explicitly schedule the exercise that would test them,
rather than porting them on faith. The one evidence gap worth fixing in v2's
instrumentation regardless of mechanism: nothing anywhere logs a *read* of
archived/backup/tombstone content, so "did the archival mechanisms ever pay
for themselves" is currently unanswerable from telemetry alone.

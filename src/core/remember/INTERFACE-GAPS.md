# `remember/` — interface gaps for the coordinator

*Everything this module needs from a module it must not import, and everything
another module must change to meet it. `remember/` was built alongside `encode/`;
where the two touch, the seam here is a narrow injected function and the wiring is
listed below. Nothing in this list is implemented in `remember/`, on purpose.*

## 1. `store/paths.ts` — `LAYOUT` must classify `spans/` (BLOCKING at integration)

The span buffer lives at `<dataDir>/spans/`. `Store` asserts every top-level path is
classified, so **as of today `Store.open()` on a data dir that has captured spans
throws `LAYOUT_UNCLASSIFIED`.** The entry to add:

```ts
{
  name: "spans",
  match: "exact",
  backup: true,
  why: "Captured lived experience awaiting encoding. Not reconstructible from anything; its loss is the loss of the day.",
}
```

`backup: true` is the point — spans are the one thing in the data dir that is
neither the canonical database nor rebuildable cache, and dropping them from the
backup set is exactly the silent loss the buffer exists to prevent. (`store/`'s
own test asserts the whole backup set, so adding one is a line there too. Since
the floor, 2026-09-20, it is
`["counterparts.sqlite", "journal", "spans"]` — `prose` and `versions` went when
the bodies became rows.)

## 2. `encode/` — the `GateFn` (the gate battery)

`remember/` never gates. It calls an injected function and honors the verdict:

```ts
type GateFn = (input: GateInput) => GateVerdict | Promise<GateVerdict>;

interface GateInput {
  content: string;
  kind: Kind;
  aliases: readonly string[];
  feeling: { feeling: string; quote: string; subject: string } | null;
  /** The proposal's OWN span, when it has one — the emotion exemption is evaluated
   *  against THIS span by the engine that minted the proposal (encode §5 G5). */
  span: { hash: string; text: string } | null;
  source: "session-end" | "jot";
  day: number;
}

type GateVerdict =
  | { ok: true; content: string; aliases?: readonly string[]; feeling?: Feeling | null;
      novelty?: number | null;
      records?: readonly GateRecord[]; channels?: readonly ChannelRecord[] }
  | { ok: false; gate: string; reason: string; refusedByDesign?: boolean;
      records?: readonly GateRecord[]; channels?: readonly ChannelRecord[];
      blockedBy?: readonly string[] };
```

Notes for the wiring:
- **`records` / `channels` / `blockedBy` are a RELAY, added 2026-09-05 (replay
  INTERFACE-GAPS §2a).** `remember/` still never gates and still reads nothing out
  of them: they cross the seam so a caller that writes telemetry can record what
  the battery actually did instead of a first reason and a joined string. They are
  the one place this module names an `encode/` type — a TYPE-ONLY import in
  `proposals.ts`, erased at runtime, so the injected-gate property is unchanged.
  All three are optional: a gate that is not the battery (`NO_GATE`, a test
  double) has none, and "no battery ran" must stay distinguishable from "a
  battery ran and found nothing". `SubmitResult` carries them out, together with
  `kind` — the proposed kind, which now survives a refusal.
- **`content` on an `ok` verdict is the redacted/hedged text**, and it — never the
  draft — becomes the memory. That is how "the gate runs before anything durable"
  stays true from this side.
- The default when nothing is injected is `NO_GATE`, which **refuses**. A missing
  battery must never read as "everything passes".
- A gate that THROWS is treated as a refusal (`GATE_FAILED`), and the proposal
  claims no coverage.
- `remember/` does not implement the secrets-gate universality test; when `encode/`
  writes it, `submitProposal` is one of the callers it must find.

## 3. An adapter — the `InterpretFn` (the crash fallback's model call)

No SDK, no network, no streaming code exists in this module. The fallback injects:

```ts
type InterpretFn = (chunk: SweepChunk) => Promise<InterpretResult>;
interface InterpretResult { proposals?: readonly unknown[]; stopReason?: string }
```

The adapter owns, and this module deliberately does not: streaming (scar E3), token
headroom, retries, the client chokepoint (E2), **and detached execution with a
watchdog** (E4/E5). `validateWatchdog(timeoutMs, staleClaimMs)` is exported so the
adapter can assert its timeout fires inside `TUNABLES.STALE_CLAIM_MS` — a watchdog
slower than the staleness window lets two runs hold the same spans.

`chunk.prompt` is the prompt-side rendering (coverage marks included);
`chunk.spans[].text` is the ungated source text. Never send the former anywhere a
gate reads.

## 4. `store/` + `schemas/` — `updates:` candidates and id resolution

```ts
type IdResolver = (id: string) => string | null | Promise<string | null>;
type CandidateSource = (q: { scope: string; content: string; limit: number })
  => readonly Candidate[] | Promise<readonly Candidate[]>;
interface Candidate { id: string; text: string; aliases?: readonly string[] }
```

- `IdResolver` is `store.resolve()` with its throws turned into `null`
  (`ID_UNKNOWN` / `ID_DANGLING` are *misses*, not errors, on this path).
- `CandidateSource` is a recall-shaped query. Whether it should be `store.search()`,
  the schema slice the author was shown, or the union is a **decision for whoever
  wires it** — see CONTRACT open question 4 (showing a census of ids is what produced
  v1's confabulation incident, so the candidate set is a policy question, not a
  plumbing one).
- The two thresholds (`UPDATES_FLOOR`, `UPDATES_MARGIN`) are marked CAL and are
  **uncalibrated**: they need a measurement against a real corpus before anyone
  quotes a resolution rate (scar §2.8).

## 5. `observer.ts` should now be hoisted to `src/core/observer.ts`

`store/observer.ts`'s own header says: *"when a second core module needs it, MOVE
this file"*. `remember/` is that second consumer — it imports `isObserver` from
`../store/observer.js` today. The move is a move, not a rewrite (the file imports
nothing), and observer-mode.md G1's "exactly one definition" test wants the hoisted
location. `remember/` also adds stand-down sites: `WRITE_SITES` here is the
counterpart of `store/`'s `WRITE_METHODS`, and the cross-module totality test should
enumerate both.

## 6. `encode/` (or the prompt builder) — coverage marks

`markCovered()` / `renderForSweep()` produce the prompt-side rendering, and
`ALREADY_AUTHORED_MARK` is the mark. Contract §5 G7: marks never enter the text a
gate checks. Whoever builds the sweep prompt must consume `chunk.prompt`, and
whoever calls the gate must consume `span.text`. Crossing those two wires is the
failure this guarantee exists to prevent.

## 7. Whoever mints memories from proposals — the salience floor

A `Proposal` carries `salience.claimed` (nullable) and per-dimension hints, and
`remember/` never re-judges either. The clamp is
`physics.clampSalienceAtSeam(dims, claimed)`, applied at the proposal → memory seam,
and it emits on any lift. `remember/` deliberately does not call it: the seam is
downstream of this module, and calling it here would put the clamp in two places.

## 8. `Kind` defaulting

A draft with no `kind` mints as `"fact"`. If `encode/` classifies kind, that default
should move behind the gate seam (the verdict can return one) rather than being
guessed twice.

## 9. Nothing prunes `buffer.jsonl` for a session that ended normally — CLOSED 2026-09-23

**Closed by retention** (owner's ruling 2026-09-23; CONTRACT §5 G15, NOTES §16): a
session's captured text is deleted 7 days after it ended when it owes no write-up. The
answer to the question below — "may an UNCOVERED span be dropped on age alone?" — turned
out to be the pacer's, not coverage's: a session the pacer never found substance in owes
nothing and ages out; one it did and nobody answered is kept until it is written up.
What the rest of the tree still owes for it is §10–§12 below.

*The entry as filed, for the record:*

**Filed 2026-09-05**, by the adversarial review of the span chase (finding F5).

The strike gave the owner a way to destroy a span. It also made a claim the
console printed and two documents repeated — that a conversation turn quoting a
removed memory is "drained by the sweep" — and that claim is false.

`crashedSessions()` excludes any session that recorded a `session-end`
boundary, by design (§4's three clauses: the author who reached the host's own
end-of-session path got the pen, and what it chose not to write is forgotten
deliberately). A session that ends normally therefore never has its spans
claimed by the fallback, and **nothing else prunes `buffer.jsonl` at all** —
not `consume()`, which only truncates a claim; not the ledger trim, which is
bookkeeping; not any phase of sleep, which never looks under `spans/`.

So the live buffer grows without bound in ordinary use, and every conversational
turn stays on disk verbatim, indefinitely. Two consequences, both real:

1. **A removal cannot promise what a grep will find.** The console now says
   "nothing prunes the buffer today, so it stays there" instead of "the sweep
   drains it". Honest, and not a fix.
2. **`spans/` is `backup: true`.** A store that has been running for a year
   backs up a year of raw transcript beside the memories interpreted from it.

**What is missing.** A retention rule for the live buffer, owned by this module
because the buffer is: something on the order of "spans covered by an accepted
proposal, older than N lived days, are dropped — counted, in a record". The
pieces exist (`coveredHashes()` says what has been interpreted; the boundary
ledger says when a session ended; `strikes.jsonl` is the shape of the record).
What does not exist is the decision about N, and whether an UNCOVERED span may
ever be dropped on age alone — which is the same question the unaskable-stretch
bound (§5 G12) answers by refusing to pretend, and should probably answer the
same way here: bound it, count it, do not silently drop it.

**Not taken with the strike**, deliberately: retention is a policy about
forgetting, the strike is a mechanism for destroying on demand, and building the
first inside the second would have made a removal PR into a change of what the
system keeps.

## 10. The `remember.prune` row is not in the dashboard's vocabulary, nor under a mechanism

**Owner:** `adapters/dashboard/` and `adapters/fired.ts` — NOT this module. Filed 2026-09-23.
**Needed:** the retention job writes one durable `remember.prune` row per date
(`owes.ts#RETENTION_EVENT`, payload `retentionRow`: `date`, `reason`, `scopes`,
`deleted`, `keptOwed`, `keptYoung`, `keptLive`, `failed`, `lines`, `bytes`,
`retentionDays`; no `ref`; counts are SESSIONS; `reason` is `PRUNED`, `NOTHING`,
`IO_FAILED`, or — for a run that has not finished — `STARTED` / `LATCH_HELD`).
**Have:** the row is written, and nothing that renders the log knows its name. The totality
tests do not fail — they walk the registry, not the log — so the row is invisible rather
than wrong. To register it: `dashboard/registries.ts` (`DurableEventName` union and the
`DURABLE_EVENTS` gloss), `dashboard/web/flow.ts` (`EVENT_NODE`, the `spans` node),
`dashboard/web/narrate.ts` (a `NARRATORS` line), the `REF_KIND` table (`"none"`), and a
`MECHANISMS` row in `fired.ts` naming it as evidence. It is written with
`store.appendEvent` directly, not `noteAdapterEvent`, because that method's name list is
`counterpart.ts`'s.

## 11. Doctor does not show it yet

**Owner:** `adapters/claude-code/doctor.ts`. Filed 2026-09-23.
**Have:** `lastRetentionRun(store)` (exported from `remember/index.ts`) returns the newest
row as numbers. The line it was built for, worded so it does not over-promise (PR #189
review m4, m5): `Raw transcripts  7 days after a session ends (up to 21 counting the daily
snapshots) · <deleted> pruned <date> · <keptOwed> kept until written up · <keptLive> still
open` — green; amber when `failed > 0`, and amber when the newest row is `STARTED` or
`LATCH_HELD` on a date before today ("the pass on <date> started and did not finish");
"not run yet" on a store the worker has not reached, which is not a fault. Until the next-session write-up (C2) exists, "kept until
written up" means kept indefinitely, and the line should not imply otherwise. (C2 landed
2026-09-23 with its own line, `Crash write-up`, which counts the sessions awaiting one
from the plan; "kept until written up" is now true for every project that is reopened.)

## 12. `export` still says nothing about `spans/`

**Owner:** `adapters/cli/` (LAUNCH-STATUS §I3). Filed again 2026-09-23 with the words
retention makes true: after the export's `Kind:` line, one line —
`Not included: spans/ — the raw captured conversation, kept 7 days after a session ends,
or for as long as it waits to be written up.`



## 13. The API sweep can write up a session the next session already wrote up — CLOSED 2026-09-23 (C2)

**Owner:** was `remember/spans.ts#crashedSessions` / `fallback.ts`. Closed without
touching either: the worker hands the sweep an interpreter that reads the write-up marks
(`claude-code/bin/runner.ts#sweepAware`). A session already marked written up is not read
again — a chunk of only such sessions is retired with no model call, and in a mixed chunk
their words are marked already-authored — and a crashed session every one of whose
words was read and came back ok is marked written up `by: "api"` (added to
`write-up-seam.ts#WRITE_UP_BY`). A session with words left in QUARANTINE is NOT marked
(PR #192 review, MAJOR 5: quarantine is what the sweep failed to read — a revoked key for
three days quarantines everything); it stays owed and the next-session pointer offers it
(`adapters/sessions.ts#sweepOwns` hands it back once only quarantine is left). A session
whose spans were put back for a retry is not marked either. What would still be cleaner
here: `crashedPending` skipping a written-up session itself, so its spans are not claimed
at all and keep their seven days (today they are retired when the sweep claims them).

## 14. The sweep's gate row has one reason for a deliberate skip — CLOSED 2026-09-23 (C2)

`core/counterpart.ts#SweepSkipped` now has a second reason, `"not-opted-in"`, which the
worker writes when the owner has not opted into the API sweep (whatever key is present);
`"no-credential"` is left for opted in with no key. Doctor's `Sweep` line reads
`not-opted-in` — and a pre-C2 `no-credential` with the knob absent — as green `next
session`. Not taught here: the dashboard's narrator (`dashboard/web/narrate.ts`) has a
sentence for `no-credential` and none yet for `not-opted-in`.

## 15. A deposit cannot say whose words it covers — CLOSED 2026-09-23 (C2)

**Built:** `SubmitContext.cover` (`remember/proposals.ts`), passed through
`DepositContext.cover` (`core/counterpart.ts#deposit`): absent is the depositor's own
spans (unchanged), `{ session }` another session's in the same scope, `false` none — the
proposal and the memory stay the depositor's. The next-session write-up's door passes
`false` on an earlier part and the ended session on the last; the instance-level
shadowing of `SpanBuffer#claimCoverage` it replaced is gone (NOTES §17).

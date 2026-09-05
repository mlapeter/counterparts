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
neither canonical prose nor rebuildable cache, and dropping them from the backup set
is exactly the silent loss the buffer exists to prevent. (`store/`'s own test asserts
the backup set equals `["operational.sqlite", "prose", "versions"]`; that expectation
grows by one.)

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

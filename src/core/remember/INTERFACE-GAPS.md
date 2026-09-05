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
  | { ok: true; content: string; aliases?: readonly string[]; feeling?: Feeling | null }
  | { ok: false; gate: string; reason: string };
```

Notes for the wiring:
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

## 9. Nothing prunes `buffer.jsonl` for a session that ended normally

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

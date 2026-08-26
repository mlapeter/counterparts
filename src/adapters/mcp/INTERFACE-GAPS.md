# `adapters/mcp/` — INTERFACE-GAPS

*What this adapter needed from a module it may not edit, and what building it
found. Filed rather than hacked around; each entry says what exists today, what
the honest fix is, and where the proof lives. Written 2026-08-25 alongside
`test/mcp.test.ts`.*

---

## 1. `recall/` has no deliberate mode — the tiering lives here

**What exists.** `Recall.build()` is the pure half of the ambient path and is
public precisely so it can be reused ("a private half is a promise, not a seam",
`recall/index.ts`). It returns every candidate's verdict, so the information a
deeper look needs is all there.

**What is missing.** There is no `Recall.deliberate()`, and no per-call tunable
override — `RecallTunables` is fixed per instance. So "deliberate recall is a
deeper effort with different thresholds" (CONTRACT §3, [v1] §9.1 G2) is
implemented in `deliberate.ts` by RE-TIERING build's verdicts rather than by
running the gate at a different bar: soft verdicts (`below-bar`,
`below-strong-floor`, `capped`, `dedup-suppressed`, `cue-only-temporal`) are
admitted at a labeled `dim` tier; hard gates (`dark-uncued`, `below-floor`,
`cue-fraction`) are not.

**Why that is defensible, not just convenient.** The hard/soft split is already
`recall/`'s own vocabulary, and re-tiering cannot admit anything the activation
pass did not score — which is the property that keeps expansion from degrading
into search. What it CANNOT do is change the candidate SET: a lower bar with the
same `MAX_CANDIDATES` is a lower bar over the same shortlist.

**The honest fix.** `Recall.build(turn, { tunables })` — a per-call override so a
deliberate ask can raise `MAX_CANDIDATES` and lower `FLOOR_GLOBAL` on its own
terms. One optional argument, no new module.

## 2. Confidentiality is a prose-`meta` convention with one reader

`isConfidential(doc)` reads `meta.confidential` / `meta.confidentiality` and is
exported from `recall/activate.ts`. Nothing WRITES those fields: no tool, no
gate, no boundary sets them, so today a memory becomes confidential only if
something outside this package puts the key in the prose. The withholding
machinery is real and tested on both paths (stated for a lookup, silent in a
list) — the classifier is missing. Owner call: is confidentiality declared by
the experiencer at deposit, inferred by a gate, or set only by the owner from
the console? Until it is decided, the guarantee is enforceable but unreachable.

## 3. The entrance table (claude-code/INTERFACE-GAPS §4), extended

`claude-code/INTERFACE-GAPS.md` §4 asks the next adapter to extend the
gate-coverage enumeration. Both new entrances go through `Counterpart`, so they
inherit the wiring rather than adding to it:

| entrance | gate | wired at |
|---|---|---|
| `note` tool | `bridge.batteryGate()` (per proposal) | `Counterpart.submitJot` → `deposit()` |
| `session_end` tool | `bridge.batteryGate()` (per proposal) | `Counterpart.submitSessionEnd` → `deposit()` |
| `recall` tool | n/a — reads only, asserted byte-identical | `test/mcp.test.ts` |
| `status` tool | n/a — reads only, asserted byte-identical | `test/mcp.test.ts` |

**Nothing new is unguarded.** The proof is the same shape as the claude-code
totality test: a credential submitted through `note` is redacted, and one that is
nothing but a credential is refused as `empty-after-redaction`.

## 4. `note`'s span linkage depends on a hash the buffer returns positionally

`Counterpart.captureJot` returns a `CaptureResult`, and the jot's own span is
`result.spans[0]`. `submitJot({ ownSpanHash })` then withholds it from the sweep.
That linkage is load-bearing — without it a deliberate note costs two memories,
one from the tool and one from the crash fallback re-reading the jot — and it is
expressed as "index zero of an array". `SpanBuffer.jot` could return the span (or
its hash) as a named field instead. Proof it works today:
`test/mcp.test.ts` — "the note's own words ride the buffer as a span the deposit
claims".

## 5. `status` reports a census, and CONTRACT §7 OQ2 wanted counters

OQ2: "what does `status` show? The useful minimum is probably the symmetry
counters — created versus exited per kind — not a store census." Shipped: BOTH.
The census is small and the counters ride inside it as `symmetry`. If the census
half turns out to be noise in real use, deleting it is a two-line change and the
counters stay. Recorded so the choice is visible rather than assumed settled.

## 6. Deliberate recall has no session of its own

`build()` needs a `sessionId` and uses it to load per-session gate state (for
dedup). A server launched without a session uses the literal `"mcp"`, which means
two unbound servers share one gate-state row. It affects the `dedup-suppressed`
verdict only — and deliberate recall admits that verdict anyway — so the blast
radius is nil today. It would stop being nil the moment anything else keys off
that row.

# `tools/migrate/` — NOTES

Where the contract was silent, what was decided, and what a real run still has to
answer. (`CONTRACT.md` is the promise; this is the working record behind it.)

## 1. The span handed to the battery is the body itself

`hedgePrecision` softens specifics that do not appear in the span a proposal was
written from. An import has no span — the v1 body IS the record — so handing the
body to itself makes every specific sourced and nothing gets hedged. That is the
point: **this tool must not rewrite the owner's sentences.** The only edit it may
make to prose is the secrets gate's own redaction, and every one of those is
counted. `bridge.ts` takes the same shape at both of its own doors
(`span: input.span?.text ?? input.content`, `span: input.text`), so this is a
composition choice with precedent rather than a new rule.

## 2. Aliases go around the alias gate, not through it — on purpose

`gateAliases` drops any alias not verbatim in the span. v1's trace aliases are
gazetteer cues ("the discussion rule") that frequently do not appear in the body
they index; routing them through the battery would have silently stripped
legitimate retrieval keys and called it a gate fire. So each alias, handle and
entity name is scanned individually with `containsSecret` and dropped only for
carrying a credential shape. The ops rule holds — *a credential must never become
something the store indexes* — without importing the verbatim rule, which belongs
to authorship and not to a bulk import.

## 3. A dirty title drops the title, not the memory

The battery's ops rule rejects a whole proposal whose HANDLE carries a credential.
For an authored deposit that is right: the author can rewrite it. For an import
there is nobody to ask, and rejecting the proposal would throw away a memory to
punish its label. So `gate.ts` pre-scans the title, drops it (counted as
`namesDropped`), and sends the body through without it. Every other handle still
reaches the battery, so the rule still fires.

## 4. Idempotence is defined on writes, not on bytes

A sqlite file's pages move when you open it. "Run twice and diff the store" would
therefore be asserting on the wrong thing. The guarantee is *the second run
performs no write*: `WriteSummary.created` is zero, every object lands in
`existing`, and canonical `prose/` is byte-identical. Every write site checks
before it writes rather than relying on an overwrite being equal.

## 5. Element identity is the POST-gate statement

Documents are keyed by a content-derived id (`hashText(relPath#v1Id)`), but
elements get their ids from `schemas/`, so they are deduped by text. It has to be
the text AFTER the gate: a redacted statement re-gates to the same redacted text
on the second run, while the raw source statement would never match the stored
row and the run would add a duplicate. It is also `.trim()`ed, because
`addBelief` trims before it mints.

## 6. What a real run still has to answer

- **The gradient cut — MEASURED 2026-08-26, read-only, against the live store.**
  0.85 was borrowed from v2's `THETA_ID`; the histogram says the borrow landed
  well. 13,086 live traces: ~94% at gradient ≈ 0 (the gradient is sparse by
  design), a thin tail, and — the load-bearing fact — the `[0.80, 0.85)` bucket
  is EMPTY. The cut sits in a natural gap, not on a knife edge: lowering it to
  0.80 changes nothing at all. At `>= 0.85` sit exactly 19 traces (18 self, 1
  person, 0.15% of the store) — v1 mints gradient from salience at birth, so
  this cluster is "marked at the top tier when written" plus a few reinforced
  above it, and by title they are the genuine identity core (the porch
  conversation, the bansai-origin insight, the constitution stretch). The next
  cluster down (0.776–0.795, 22 traces) is session-chapter narrative that
  belongs in semantic, which is where the cut leaves it. Standing default:
  keep 0.85. Disabling (>1) would demote the real core at the first decay
  pass; 0.77 would promote diary chapters to permanence.
- **The ledger.** `LEDGER_TO_PRESSURE` is off and unwired. Whether v1's open
  ledgers should arrive as pressure is a question for after the parallel run, when
  "what does pressure mean in v2" has an empirical answer.
- **The floor.** `contentFloor` refuses bodies under 20 characters or 3 words. On
  fixtures nothing hits it; on the real store the refusal count is the number to
  read first, because those are memories that will NOT travel — reported by
  reason, but gone.
- **Scale.** Everything is planned in memory before anything is written. On ~780
  archived spans' worth of traces that is fine; if the real store is much larger,
  the plan is the thing to stream.

## 7. What deliberately does not travel

`logs/` (bounded-retention telemetry, not memory), `buffer/` and `buffer-archive/`
(raw material, and the replay harness's input — `tools/replay/`), `index.sqlite`
(a rebuildable cache on both sides), `archive/` and `pending-erase/` (v1's own
lineage substrate: the live rows carry what survived), and `config.json` (read for
context, never applied — v2's config is the owner's to set). Each absence is a
line in CONTRACT §7 rather than a silence.

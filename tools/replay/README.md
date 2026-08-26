# `tools/replay/` — the validation harness

Feeds v1's recorded month of real inputs through Counterparts and scores the
result against `docs/harvest/replay-baselines.md`, with an honest verdict
vocabulary. Contract: `CONTRACT.md`. Assumptions and open choices: `NOTES.md`.
What it cannot grade yet, and why: `INTERFACE-GAPS.md`.

```ts
import { replay } from "./tools/replay/index.js";

const result = await replay({
  corpusDir: "/Users/you/counterparts-replay-corpus", // READ-ONLY, always
  interpret: myInterpreter,        // streaming + stop_reason guard are ITS job
  seat: "claude-opus-5",           // the acting model seat (guarantee 8)
  vectors: "voyage-3-large",       // the pinned generation (guarantee 7)
  pinModel: "voyage-3-large",
  budgetBytes: 9000,               // the host's ceiling — never invented in src/
});
console.log(result.report);
result.cleanup();                  // removes ONLY the temp store it created
```

**The pieces**

| file | what it is |
|---|---|
| `corpus.ts` | the read-only reader: day-partitioned spans, event logs, the index. Tolerant of format drift and it **counts every tolerance** |
| `driver.ts` | day-by-day replay on the lived-day clock, through `Counterpart`'s own methods, into a fresh temp store |
| `baselines.ts` | one registry entry per number in `replay-baselines.md` §1 — each grades against a range, hands off to a rater, or says why it cannot be computed |
| `compare.ts` | the scorer and the totality tripwire. Imports nothing from `src/` — a shared bug must not grade itself |
| `decay-shapes.ts` | physics OQ1: the same corpus under flat / exponential / power-law, divergence per band. Evidence, not a verdict |
| `report.ts` | the renderer and the machine-readable pass record. Numbers, counts, verdicts — never memory text |

**Four verdicts, and no fifth:** `pass` / `fail` / `needs-rater` /
`not-exercised`. A run containing a `not-exercised` is never a clean pass, and
`gateOpen()` — what a runtime switch calls — refuses anything less.

**Safety.** The harness errors on a pre-set `COUNTERPARTS_DATA_DIR` rather than
honouring it, makes its own temp store, removes only what it made, and never
writes to the corpus: the reader's sqlite handle is opened read-only and proves
it by attempting a write, and `test/replay.test.ts` asserts the corpus directory
is byte-identical after a full run. `~/.bansai` and `~/.claude-engram` are
unreachable from every path here.

### Decided with Mike's go 2026-10-20 via BENCHMARK, lightly held, an experiment (facts answers: the title tail, and soft time words)

Done to help on benchmarks and product, lightly held, revisit. From the benchmark session's
10-20 loss read (`~/counterparts-bench/research/loss-read-1020.md`, "RECALL" and the ranked fix
list #2 and #7). Nothing benchmark-only at the real system's expense (Mike, 10-11): a real
session's Claude does not page either, and "lately" is how a person talks. Lands while
0.3.27's recall experiments are read (~10-22); it changes only deliberate facts answers, never
ambient footnotes, the wake or meaning mode. Check ~10-27 (`docs/CHECK-AFTER.md`).

- **The title tail.** After a facts answer's 10 bodies, the next 20 matches in rank order,
  one line each, under `next 20, titles only (open any by id):` — `11. <title, cut at 48> ·
  <id> · <event date, else learned> [· faded]` (`adapters/mcp/facts.ts#FACTS_TAIL_SIZE`,
  `FACTS_TAIL_TITLE_CHARS`). Why: the biggest single cause of benchmark misses was a memory
  that existed and never reached the answerer, buried among 50–100 matches and lacking the
  question's category word ("What pet does Caroline have?": the guinea pig 29th of 51). The
  zero-cost rank probe on the bench stores (the answerer's logged queries replayed): on the
  first call 17 of the 50 RECALL losses had the needed memory at ranks 11–30, and over all
  logged calls 21 of 50 would have had it in a 20-line tail where its body never showed.
  Listed is not shown: a tail id is not in `ids`, the seen set or the quotable record, so
  nothing is credited for being listed; opening it by id credits as any open does. The
  `mcp.recall` row keeps `tail` and `tailIds` apart so the check can join later opens to it.
  Paging, the header count and the 12,000-character room are unchanged; the tail is the
  first thing given up when room runs out (after excerpts reach 60). About 1.7 KB measured on
  bench answers (the brief said ~1.5 KB). **Size (20 lines, 48-character titles) and the
  wording are for Mike's review.** Revert: `FACTS_TAIL_SIZE = 0`.
- **Soft time words rank, they don't filter.** "lately", "recently", "these days",
  "nowadays" (`recall/time-ask.ts#SOFT_WORDS`) keep every match in a facts answer that asks
  something besides time; matches inside the past week gain a quarter of the best score, for
  the order only (`FACTS_SOFT_RECENT_BONUS`). A question that is only the soft word ("what
  happened lately?") keeps the past week as its filter; explicit windows ("last week", "in
  September", "since 10-12") are unchanged. Chosen over the fallback ("past the window when
  nothing on topic is inside it") because the report's own example had 11 matches inside the
  window, so the fallback would not have fired. Honest result: that example
  (loc-conv-49-122, gastritis) is still missed — unwindowed, the memory's words don't share
  the question's — but on the probe the change brought 5 other RECALL losses' memories into
  the answer. "of late" and "most recent" left out on purpose. Revert: drop `{ soft: true }`
  from the soft branch in `time-ask.ts`.
- **Not built: same-session neighbours** (fix list #3). It overlaps the tail; it waits on the
  tail's measurement.

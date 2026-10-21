/**
 * WHAT A RUN SPENT (2026-10-21, `harness compare`): every model child's
 * tokens, read from its own stream-json `result` line, summed for the
 * process. Each side of a compare is its own process, so the sum is that
 * side's run.
 */

export interface UsageTally {
  /** Children whose output carried a result line with usage. */
  readonly calls: number;
  /** Children that ran but said no usage (a crash, a timeout). */
  readonly unread: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreate: number;
  /** As the child reported it; on a subscription, a notional figure. */
  readonly costUsd: number;
}

const ZERO: UsageTally = { calls: 0, unread: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0, costUsd: 0 };
let tally: UsageTally = ZERO;

const n = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/** One child's usage from its stream-json output (the last `result` line); null when it said none. Pure. */
export function childUsage(output: string | undefined): Omit<UsageTally, "calls" | "unread"> | null {
  for (const line of (output ?? "").split("\n").reverse()) {
    if (!line.includes('"result"')) continue;
    try {
      const o = JSON.parse(line) as { type?: string; usage?: Record<string, unknown>; total_cost_usd?: unknown };
      if (o.type !== "result" || o.usage === undefined) continue;
      return {
        input: n(o.usage["input_tokens"]),
        output: n(o.usage["output_tokens"]),
        cacheRead: n(o.usage["cache_read_input_tokens"]),
        cacheCreate: n(o.usage["cache_creation_input_tokens"]),
        costUsd: n(o.total_cost_usd),
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** Add one child's output to this process's tally. */
export function recordUsage(output: string | undefined): void {
  const u = childUsage(output);
  if (u === null) {
    tally = { ...tally, unread: tally.unread + 1 };
    return;
  }
  tally = {
    calls: tally.calls + 1,
    unread: tally.unread,
    input: tally.input + u.input,
    output: tally.output + u.output,
    cacheRead: tally.cacheRead + u.cacheRead,
    cacheCreate: tally.cacheCreate + u.cacheCreate,
    costUsd: Math.round((tally.costUsd + u.costUsd) * 1e6) / 1e6,
  };
}

export function usageTally(): UsageTally {
  return tally;
}

/** Back to zero (tests). */
export function resetUsage(): void {
  tally = ZERO;
}

/** All tokens the model read or wrote, cached or not. */
export function totalTokens(u: UsageTally): number {
  return u.input + u.output + u.cacheRead + u.cacheCreate;
}

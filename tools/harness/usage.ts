/**
 * WHAT A RUN SPENT (2026-10-21, `harness compare`): every model child's
 * tokens, read from its own stream-json `result` line, summed for the
 * process. Each side of a compare is its own process, so the sum is that
 * side's run.
 */

import { childUsage } from "../../src/adapters/claude-code/index.js";

/** The parser lives with the night that reads it (2026-10-23, `claude-code/transcript.ts`); re-exported for the harness. */
export { childUsage };

/** One child's tokens, as the night's own parser reads them. */
type ChildTokens = NonNullable<ReturnType<typeof childUsage>>;

export interface UsageTally extends ChildTokens {
  /** Children whose output carried a result line with usage. */
  readonly calls: number;
  /** Children that ran but said no usage (a crash, a timeout). */
  readonly unread: number;
}

const ZERO: UsageTally = { calls: 0, unread: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0, costUsd: 0 };
let tally: UsageTally = ZERO;

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

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
/** The same tally per night act (`catch-up`, `writer`, `dream`, `reflection`, ...), for the children that said which (L2, 2026-10-26). */
let byAct: Record<string, UsageTally> = {};

function add(t: UsageTally, u: ChildTokens | null): UsageTally {
  if (u === null) return { ...t, unread: t.unread + 1 };
  return {
    calls: t.calls + 1,
    unread: t.unread,
    input: t.input + u.input,
    output: t.output + u.output,
    cacheRead: t.cacheRead + u.cacheRead,
    cacheCreate: t.cacheCreate + u.cacheCreate,
    costUsd: Math.round((t.costUsd + u.costUsd) * 1e6) / 1e6,
  };
}

/** Add one child's output to this process's tally — and, when it was a night's child, to its act's (`act`). */
export function recordUsage(output: string | undefined, act?: string): void {
  const u = childUsage(output);
  tally = add(tally, u);
  if (act !== undefined) byAct = { ...byAct, [act]: add(byAct[act] ?? ZERO, u) };
}

export function usageTally(): UsageTally {
  return tally;
}

/** The night children's tallies by act, so far this process. */
export function usageByAct(): Readonly<Record<string, UsageTally>> {
  return byAct;
}

/** Back to zero (tests). */
export function resetUsage(): void {
  tally = ZERO;
  byAct = {};
}

/** All tokens the model read or wrote, cached or not. */
export function totalTokens(u: UsageTally): number {
  return u.input + u.output + u.cacheRead + u.cacheCreate;
}

/**
 * The wake-briefing composition root — SEAMS item G closes here.
 *
 * `sleep/` guarantees ORDER (the re-render is the cycle's LAST content write, so
 * it sees this boundary's own supersedes, promotions, merges and prunes) and
 * nothing else; the atomic publish, the trim order and the sentinel counts stay
 * `self/`'s. Neither module imports the other, and a test on each side asserts
 * the absence. This file is the one line between them.
 *
 * Two numbers arrive from outside both modules, and that is the point:
 *
 *   - **`budgetBytes` is the HOST's reported injection ceiling** (scar §2.18 —
 *     the ceiling is a host capability, not a constant either module may invent).
 *     It rides in `SleepOptions.budgetBytes` so a wrong value is an argument
 *     somebody can see, and `self/` requires it: absent, this adapter REFUSES to
 *     render rather than guessing, because an invented ceiling is exactly the
 *     failure the scar names.
 *   - **`horizon` comes from `prospective/`**, never from `sleep/`
 *     (`self/INTERFACE-GAPS.md` §3: the lane, its heading and its trim position
 *     are already built; only the source was borrowed).
 */
import type { RenderFn } from "./sleep/index.js";

/** Structurally `Self`, so this file imports no class. */
export interface BriefingRenderer {
  boundary(req: {
    day: number;
    budgetBytes: number;
    horizon?: readonly { id: string }[];
    here?: { scope?: string | null; session?: string | null };
  }): { briefing: { bytes: number; elements: number } };
}

/** Structurally `Prospective.horizon()`. */
export interface HorizonSource {
  horizon(input: { at: string; day?: number }): { items: readonly { memoryId: string }[] };
}

export interface RendererOptions {
  /** The calendar date the horizon asks about. Without it, no horizon lane. */
  at?: string;
  prospective?: HorizonSource;
  /**
   * The scope and session the render is composed FOR (2026-09-25): the boundary
   * that triggered it. Handed to `self/` unread; it boosts same-scope hints.
   * Absent (rebrief, replay): no context boost.
   */
  here?: { scope?: string | null; session?: string | null };
  /** Telemetry only. A refusal must be loud, never a silently empty briefing. */
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
}

export function selfRenderer(self: BriefingRenderer, opts: RendererOptions = {}): RenderFn {
  return (ctx) => {
    if (ctx.budgetBytes === undefined) {
      // Fail toward saying so. An invented ceiling would publish a briefing the
      // host silently truncates, which is the failure mode scar §2.18 records.
      opts.onEvent?.("briefing.no-budget", { day: ctx.day });
      return;
    }
    const horizon =
      opts.prospective === undefined || opts.at === undefined
        ? undefined
        : opts.prospective
            .horizon({ at: opts.at, day: ctx.day })
            .items.map((i) => ({ id: i.memoryId }));
    const result = self.boundary({
      day: ctx.day,
      budgetBytes: ctx.budgetBytes,
      ...(horizon === undefined ? {} : { horizon }),
      ...(opts.here === undefined ? {} : { here: opts.here }),
    });
    return { bytes: result.briefing.bytes, elements: result.briefing.elements };
  };
}

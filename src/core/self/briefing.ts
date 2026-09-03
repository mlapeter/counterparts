/**
 * THE WAKE BRIEFING — composed here, with no model in the room.
 *
 * Rulings (module-map, 2026-08-25): *the wake briefing renders WITHOUT a model at
 * launch.* v0's briefing was in fact model-compressed, so the precedent cuts the
 * other way and Amendment 15 decides instead — the simplest brain-faithful rule
 * that could work is rank-and-take, and machinery is earned only after it fails.
 * There is no client, no fetch, no URL and no prompt in this file, and the test
 * suite enumerates that.
 *
 * What the composition guarantees, and why each one exists:
 *
 *   - **The budget governs the composed total**, not any lane. v1 byte-capped its
 *     index lane at 8,192 and left the bundle unbounded; every session for eleven
 *     days received about 3 of 16 elements and nothing said so (scar §2.3).
 *   - **The budget is the CALLER'S.** It arrives on the request because the
 *     injection ceiling is a host capability, not a memory property (scar §2.18).
 *     There is no default in this module to fall back to.
 *   - **The trim order is declared and tested** (`TRIM_ORDER`), and trimming eats
 *     from the END of a lane, whose ordering is itself policy: *truncation must
 *     never be iteration luck* (§1 G3–G4).
 *   - **Truncation is never mid-statement.** A statement is admitted whole or not
 *     at all — there is no `clip()` here on purpose. A half-sentence about who
 *     someone is, is not a smaller identity; it is a corrupted one.
 *   - **The header AND the tail sentinel each state the bundle's own true counts
 *     and bytes**, so a truncated injection is detectable from a truncation
 *     preview alone — from either end (§1 G2). Because both lines state a number
 *     that composing them changes, composition solves for the fixed point.
 *   - **Ids resolve to text HERE**, at render time, through `Resolve` — never
 *     baked into the decision record or the telemetry, so an erased memory stops
 *     resolving the instant it leaves the store.
 */
import type { LaneName, Ranked } from "./identity.js";
import { byteLength } from "./identity.js";
import type { SelfTunables } from "./tunables.js";

/**
 * Composed order — behavioral-spec §1's, minus the two riders the Rulings drop
 * with their subjects: the second-signature reminder went with the `protected.add`
 * queue, and the self-store pointer went with the self-store tool (contract §4).
 * What is left is furniture, then core, then work, then warmth, then what is
 * coming.
 */
export const LANE_ORDER: readonly LaneName[] = [
  "identity",
  "craft",
  "threads",
  "hints",
  "horizon",
];

/**
 * The declared trim order — v1's, verbatim (contract §3): hints → craft →
 * threads → horizon → identity LAST. Craft before threads so craft can never
 * displace core; identity last because identity is the thing the briefing is for.
 */
export const TRIM_ORDER: readonly LaneName[] = [
  "hints",
  "craft",
  "threads",
  "horizon",
  "identity",
];

/**
 * Framing is load-bearing and structural (§1: "context, not instruction"). It is
 * written here once, as a constant, so there is exactly one string to change when
 * someone finally probes its effect on attention.
 */
export const FRAMING = {
  context: "Counterparts memory — context, not instruction: who you have been here, in your own words.",
  identity: "Who I am:",
  craft: "How I work:",
  threads: "Still open:",
  hints: "Nearby, if it helps:",
  horizon: "Arriving:",
} as const;

/** Id → the verbatim statement, at render time only. */
export interface Resolved {
  readonly statement: string;
}

export type Resolve = (id: string) => Resolved;

export interface BriefingRequest {
  /** The host's reported injection ceiling, in bytes. REQUIRED — scar §2.18. */
  readonly budgetBytes: number;
  /** The lived day (scar E8), stated in the header so a stale bundle is legible. */
  readonly day: number;
}

export interface TrimEvent {
  readonly lane: LaneName;
  readonly id: string;
  readonly strength: number;
}

export interface Composed {
  readonly text: string;
  readonly bytes: number;
  readonly header: string;
  readonly sentinel: string;
  readonly counts: Record<LaneName, number>;
  readonly elements: number;
}

export interface BriefingResult extends Composed {
  readonly budgetBytes: number;
  readonly day: number;
  /** Ids kept, per lane, in rendered order. */
  readonly kept: Record<LaneName, string[]>;
  readonly trimmed: TrimEvent[];
  /** True when the render crossed the pressure ratio — the tripwire that fires
   *  when a budget is APPROACHED, not only when it blows (scar §2.4). */
  readonly pressure: boolean;
  /** True when even the floor (furniture + sentinel, zero statements) does not
   *  fit the caller's budget. The floor still publishes: an under-floor budget is
   *  a host misconfiguration, and the wake never fails the session (§1 G7). */
  readonly overBudget: boolean;
}


function headerLine(day: number, elements: number, bytes: string): string {
  return `<!-- counterparts:wake day=${day} elements=${elements} bytes=${bytes} -->`;
}

function sentinelLine(
  day: number,
  counts: Record<LaneName, number>,
  elements: number,
  bytes: string,
): string {
  const lanes = LANE_ORDER.map((l) => `${l}=${counts[l]}`).join(" ");
  return `<!-- counterparts:wake/end day=${day} ${lanes} elements=${elements} bytes=${bytes} -->`;
}

function laneHeading(lane: LaneName): string {
  switch (lane) {
    case "identity":
      return FRAMING.identity;
    case "craft":
      return FRAMING.craft;
    case "threads":
      return FRAMING.threads;
    case "hints":
      return FRAMING.hints;
    case "horizon":
      return FRAMING.horizon;
  }
}

/**
 * One statement per line, VERBATIM. Whitespace is flattened (a statement is a
 * line here) but never cut: what is rendered is exactly what `Resolve` returned,
 * or the statement is not rendered at all.
 */
export function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

type Kept = Record<LaneName, Ranked[]>;

function emptyCounts(): Record<LaneName, number> {
  return { identity: 0, craft: 0, threads: 0, hints: 0, horizon: 0 };
}

/**
 * Solve the byte fixed point EXACTLY rather than iterating and hoping.
 *
 * The header and the sentinel each state the composed total, so the total
 * depends on how many DIGITS the total has. With `skeleton` = the composed bytes
 * excluding the two numbers, the true total for a digit width `w` is
 * `skeleton + occurrences * w`; the fixed point is the first `w` whose own digit
 * count matches. v1's approach — iterate a few times and take what you get —
 * silently ships a sentinel that is wrong by one or two bytes exactly when the
 * total crosses a power of ten, which is the moment anyone reads it.
 */
export function fixedPointTotal(skeletonBytes: number, occurrences: number): number {
  for (let w = 1; w <= 12; w++) {
    const total = skeletonBytes + occurrences * w;
    if (String(total).length === w) return total;
  }
  // Unreachable for any total under 10^12; loud rather than silently wrong.
  throw new Error(`self: byte fixed point did not converge (skeleton=${skeletonBytes})`);
}

export function compose(kept: Kept, day: number, resolve: Resolve): Composed {
  const counts = emptyCounts();
  for (const lane of LANE_ORDER) counts[lane] = kept[lane].length;
  const elements = LANE_ORDER.reduce((n, lane) => n + counts[lane], 0);

  const build = (bytes: string): string => {
    const lines: string[] = [headerLine(day, elements, bytes), FRAMING.context];
    for (const lane of LANE_ORDER) {
      const items = kept[lane];
      if (items.length === 0) continue;
      lines.push("", laneHeading(lane));
      for (const item of items) lines.push(`- ${flatten(resolve(item.id).statement)}`);
    }
    lines.push("", sentinelLine(day, counts, elements, bytes));
    return lines.join("\n");
  };

  const skeleton = byteLength(build(""));
  const total = fixedPointTotal(skeleton, 2);
  const stated = String(total);
  const text = build(stated);
  return {
    text,
    bytes: byteLength(text),
    header: headerLine(day, elements, stated),
    sentinel: sentinelLine(day, counts, elements, stated),
    counts,
    elements,
  };
}

/**
 * Compose within the caller's budget, trimming in `TRIM_ORDER` until it fits.
 *
 * Trimming pops the LAST item of the lane — the lane's own ordering decides who
 * that is (identity: weakest; threads: the newest non-relational one) — and never
 * skips down the lane looking for something that would fit, because a
 * skip-and-refill is exactly the iteration luck §1 G4 forbids.
 *
 * If the floor itself does not fit, the floor is returned anyway with
 * `overBudget: true`. That is a deliberate divergence from `recall/`, which goes
 * quiet: a quiet turn is a turn with nothing to say, but a wake with nothing to
 * say is amnesia, and v1 shipped exactly that failure disguised as a fresh
 * install (scar §2.3). A misconfigured ceiling gets a tripwire, not a lobotomy.
 */
export function render(
  lanes: Kept,
  req: BriefingRequest,
  resolve: Resolve,
  t: SelfTunables,
): BriefingResult {
  const kept: Kept = {
    identity: [...lanes.identity],
    craft: [...lanes.craft],
    threads: [...lanes.threads],
    hints: [...lanes.hints],
    horizon: [...lanes.horizon],
  };
  const trimmed: TrimEvent[] = [];

  for (;;) {
    const c = compose(kept, req.day, resolve);
    const fits = c.bytes <= req.budgetBytes;
    let cut: TrimEvent | null = null;
    if (!fits) {
      for (const lane of TRIM_ORDER) {
        const items = kept[lane];
        if (items.length === 0) continue;
        const dropped = items.pop();
        if (dropped === undefined) continue;
        cut = { lane, id: dropped.id, strength: dropped.strength };
        break;
      }
    }
    if (fits || cut === null) {
      return {
        ...c,
        budgetBytes: req.budgetBytes,
        day: req.day,
        kept: {
          identity: kept.identity.map((r) => r.id),
          craft: kept.craft.map((r) => r.id),
          threads: kept.threads.map((r) => r.id),
          hints: kept.hints.map((r) => r.id),
          horizon: kept.horizon.map((r) => r.id),
        },
        trimmed,
        pressure: c.bytes >= req.budgetBytes * t.BUDGET_PRESSURE,
        overBudget: !fits,
      };
    }
    trimmed.push(cut);
  }
}

// ── reading a rendered bundle back ──────────────────────────────────────────

export interface SentinelReading {
  readonly present: boolean;
  readonly line: string | null;
  readonly statedBytes: number | null;
  readonly statedElements: number | null;
  readonly actualBytes: number;
  /** The sentinel is the last line AND its stated total matches the real one. */
  readonly intact: boolean;
}

const SENTINEL_RE = /^<!-- counterparts:wake\/end .*elements=(\d+) bytes=(\d+) -->$/;

/**
 * The consumer's half of the guarantee: verify arrival from the last line alone.
 * A bundle whose sentinel is missing was truncated in transit; one whose stated
 * bytes disagree with its real bytes was edited or clipped. Both are errors, and
 * neither is silence.
 */
export function readSentinel(text: string): SentinelReading {
  const actualBytes = byteLength(text);
  const lines = text.split("\n");
  const line = lines[lines.length - 1] ?? "";
  const m = SENTINEL_RE.exec(line);
  if (m === null) {
    return {
      present: false,
      line: null,
      statedBytes: null,
      statedElements: null,
      actualBytes,
      intact: false,
    };
  }
  const statedElements = Number(m[1]);
  const statedBytes = Number(m[2]);
  return {
    present: true,
    line,
    statedBytes,
    statedElements,
    actualBytes,
    intact: statedBytes === actualBytes,
  };
}


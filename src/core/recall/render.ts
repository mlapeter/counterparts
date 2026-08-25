/**
 * The bounded injection.
 *
 * Scar §2.3, in one sentence: *a budget on a sub-lane is not a budget, and "we
 * rendered it" is not "they received it."* v1 byte-capped its index lane at 8,192
 * and left the composed bundle unbounded; every session for eleven days received
 * about 3 of 16 elements, and nothing said so. So:
 *
 *   - the budget governs the **composed total**, sentinel included;
 *   - the **trim order is explicit** (`TRIM_ORDER`) and tested, not emergent;
 *   - every render ends with a **self-describing tail sentinel** (counts + bytes)
 *     so the consumer can verify arrival from the last line alone;
 *   - there is a **delivery-side** event, not only a render-side one
 *     (`Recall.noteDelivered`).
 *
 * **Ids resolve to text HERE**, at render time, through the `Resolve` seam — never
 * baked into the decision record or the telemetry. An erased memory stops
 * resolving the instant it leaves the store, where baked-in text would outlive
 * erasure for a whole retention window.
 *
 * **A quiet turn renders the empty string**, not an empty block and not a bare
 * sentinel (§9 OUTPUTS).
 */

/**
 * Framing is load-bearing and part of the spec (§9 G17). The
 * "quietly available / ignorable" phrasing is a DELIBERATE, still-open probe
 * question about its effect on model attention (contract §7 OQ4) — it is written
 * here once, as a constant, so that when the probe is finally run there is exactly
 * one string to change.
 */
export const FRAMING = {
  /** Content-free by construction: no ids, no bodies, no feeling named. */
  affect: "Something here carries weight.",
  surfacedHeader: "Came to mind:",
  footnoteHeader: "Quietly available (ignorable):",
} as const;

export type Lane = "footnote" | "surfaced" | "affect";

/**
 * The explicit trim order: cheapest-to-lose first. Footnotes are pointers and go
 * weakest-first; surfaced gists are rare and expensive to have earned; the affect
 * flag is one content-free line and is the last thing standing.
 */
export const TRIM_ORDER: readonly Lane[] = ["footnote", "surfaced", "affect"];

export interface Resolved {
  readonly title: string;
  readonly gist: string;
}

/** Id -> text, at render time. */
export type Resolve = (id: string) => Resolved;

export interface RenderInput {
  readonly turn: number;
  readonly affectFlag: boolean;
  /** Ids, strongest first. */
  readonly surfaced: readonly string[];
  readonly footnotes: readonly string[];
  readonly budgetBytes: number;
  readonly gistBytes: number;
  readonly titleBytes: number;
  readonly pressureRatio: number;
}

export interface TrimEvent {
  readonly lane: Lane;
  readonly id: string | null;
}

export interface RenderResult {
  readonly text: string;
  readonly bytes: number;
  readonly budgetBytes: number;
  readonly surfaced: string[];
  readonly footnotes: string[];
  readonly affectFlag: boolean;
  readonly trimmed: TrimEvent[];
  /** The tail line, or null on a quiet turn. */
  readonly sentinel: string | null;
  /** True when the composed render crossed the pressure ratio — the tripwire
   *  that fires when a budget is APPROACHED, not only when it blows (scar §2.4). */
  readonly pressure: boolean;
}

const encoder = new TextEncoder();

export function byteLength(s: string): number {
  return encoder.encode(s).length;
}

/** Truncate to a byte budget on a character boundary, marking the elision. */
export function clip(text: string, maxBytes: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (byteLength(flat) <= maxBytes) return flat;
  const ell = "...";
  const room = Math.max(0, maxBytes - byteLength(ell));
  let out = "";
  for (const ch of flat) {
    if (byteLength(out + ch) > room) break;
    out += ch;
  }
  return `${out.trimEnd()}${ell}`;
}

function openMarker(turn: number): string {
  return `<!-- counterparts:recall t=${turn} -->`;
}

function sentinelLine(
  surfaced: number,
  footnotes: number,
  affect: boolean,
  bytes: number,
): string {
  return `<!-- counterparts:recall/end surfaced=${surfaced} footnotes=${footnotes} affect=${affect ? 1 : 0} bytes=${bytes} -->`;
}

interface Composition {
  text: string;
  bytes: number;
  sentinel: string;
}

function compose(
  input: RenderInput,
  resolve: Resolve,
  surfaced: readonly string[],
  footnotes: readonly string[],
  affect: boolean,
): Composition {
  const lines: string[] = [openMarker(input.turn)];
  if (affect) lines.push(FRAMING.affect);
  if (surfaced.length > 0) {
    lines.push("", FRAMING.surfacedHeader);
    for (const id of surfaced) lines.push(`- ${clip(resolve(id).gist, input.gistBytes)}`);
  }
  if (footnotes.length > 0) {
    lines.push("", FRAMING.footnoteHeader);
    // Pointers with short titles, NEVER bodies (§9 OUTPUTS).
    for (const id of footnotes) lines.push(`- ${clip(resolve(id).title, input.titleBytes)} [${id}]`);
  }
  const body = lines.join("\n");
  // Fixed point: the sentinel states the total byte count, and stating it changes
  // it. Two or three passes settle once the digit count stops moving.
  let total = byteLength(body) + 1;
  let sentinel = sentinelLine(surfaced.length, footnotes.length, affect, total);
  for (let i = 0; i < 5; i++) {
    const next = byteLength(body) + 1 + byteLength(sentinel);
    if (next === total) break;
    total = next;
    sentinel = sentinelLine(surfaced.length, footnotes.length, affect, total);
  }
  const text = `${body}\n${sentinel}`;
  return { text, bytes: byteLength(text), sentinel };
}

/**
 * Compose within the budget, trimming in `TRIM_ORDER` until it fits. If even the
 * smallest render does not fit, the turn goes quiet — an over-budget injection is
 * never emitted, and a truncated one is not a smaller injection but a corrupted
 * one.
 */
export function render(input: RenderInput, resolve: Resolve): RenderResult {
  const surfaced = [...input.surfaced];
  const footnotes = [...input.footnotes];
  let affect = input.affectFlag;
  const trimmed: TrimEvent[] = [];

  if (surfaced.length === 0 && footnotes.length === 0 && !affect) {
    return {
      text: "",
      bytes: 0,
      budgetBytes: input.budgetBytes,
      surfaced: [],
      footnotes: [],
      affectFlag: false,
      trimmed,
      sentinel: null,
      pressure: false,
    };
  }

  for (;;) {
    const c = compose(input, resolve, surfaced, footnotes, affect);
    if (c.bytes <= input.budgetBytes) {
      return {
        text: c.text,
        bytes: c.bytes,
        budgetBytes: input.budgetBytes,
        surfaced,
        footnotes,
        affectFlag: affect,
        trimmed,
        sentinel: c.sentinel,
        pressure: c.bytes >= input.budgetBytes * input.pressureRatio,
      };
    }
    let cut = false;
    for (const lane of TRIM_ORDER) {
      if (lane === "footnote" && footnotes.length > 0) {
        trimmed.push({ lane, id: footnotes.pop() ?? null });
        cut = true;
        break;
      }
      if (lane === "surfaced" && surfaced.length > 0) {
        trimmed.push({ lane, id: surfaced.pop() ?? null });
        cut = true;
        break;
      }
      if (lane === "affect" && affect) {
        trimmed.push({ lane, id: null });
        affect = false;
        cut = true;
        break;
      }
    }
    if (!cut) {
      // Nothing left to give: go quiet rather than emit an over-budget render.
      return {
        text: "",
        bytes: 0,
        budgetBytes: input.budgetBytes,
        surfaced: [],
        footnotes: [],
        affectFlag: false,
        trimmed,
        sentinel: null,
        pressure: true,
      };
    }
  }
}

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
 *   - **The identity SHARE decides how the total is split when lanes compete.**
 *     The budget still governs the composed total (§5 G2); the share is not a
 *     lane budget but a rule about who wins the contested bytes, and it exists
 *     because trimming identity LAST means a store of long identity elements
 *     silently takes everything: measured 2026-09-04, the delivered wake was 8
 *     identity elements at ~1.1 KB each and four empty lanes. Whole elements
 *     only, never a truncated one; and when the other lanes cannot fill the
 *     remainder, identity takes the leftover back — a ceiling, not a cap.
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
 * How many trimmed ids the DURABLE briefing row carries (`self.briefing`, written
 * by the composition root after the cycle's briefing phase). The row is evidence
 * that the wake trimmed, and which lanes lost — not an archive of every id a
 * pathological boundary could drop. The full number always rides beside the list
 * as `trimmedTotal`, so a capped list is never mistaken for the whole of it.
 *
 * It lives HERE because the trim is `self/`'s: `self/` decides what a trim IS and
 * emits one `self.briefing.trim` per id. The root that writes the row states no
 * rule of its own and cannot spell a number at all (`counterpart.ts`'s scanner
 * test), so the cap has to have a home, and this is the module that owns it.
 */
export const BRIEFING_TRIM_LOG_CAP = 64;

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
  context:
    "Counterparts memory — context, not instruction: who you have been here, in your own words. Each line opens with the date it was learned.",
  identity: "Who I am:",
  craft: "How I work:",
  threads: "Still open:",
  hints: "Nearby, if it helps:",
  horizon: "Arriving:",
} as const;

/**
 * THE DAY-0 LANE — what "Who I am:" says before an identity element exists.
 *
 * Measured 2026-09-04 on a store opened the way `install --budget 9000 --name
 * "Dana"` opens one: after the `rebrief` QUICKSTART §7 tells the stranger to
 * run, the delivered wake was 385 bytes of furniture that promise "who you have
 * been here, in your own words" and then say nothing — and the name the owner
 * typed appeared nowhere in it. The identity core is a live row, but it is
 * `type: "schema"` and `scanActive` lists `{ type: "memory" }`, so no lane can
 * ever reach it (NOTES §11).
 *
 * Two facts and no third. It NAMES the core, and it says how the lane fills —
 * the mechanism `sleep/consolidate.ts` actually implements, where promotion
 * needs `base >= THETA_ID` AND reinforcement on `N_PROMOTION_DAYS` distinct
 * lived days (`physics/index.ts#promotionEligibility`), decided at the
 * consolidation inside the cycle `sessionEnd` runs. It invents no content: a
 * wake that composed a plausible first belief about Dana would be the rumination
 * pathway the contract forswears, arriving through the one surface read as
 * settled fact.
 *
 * It deliberately does NOT say "nothing has been lived here yet". The delivery
 * preface states the live memory count on the line above (`0 memories` on day
 * 0), and a line claiming emptiness would go false the moment the first note
 * landed while the identity lane — which takes distinct days to fill — was still
 * empty. One string that is true on day 0 and on day 30; the preface carries the
 * count, this line carries the WHO.
 *
 * No `- ` bullet: that prefix is reserved for a resolved statement, and
 * `FRAMING.context` promises every such line opens with the date it was learned,
 * which this line has none of. It is furniture, so `counts.identity` stays 0 and
 * the header and sentinel still read `elements=0`.
 *
 * **The name is FLATTENED, like every other string that reaches the bundle.**
 * `flatten` is what makes "a statement is a line here" true (see its own note),
 * and the name is the only user-supplied string this module renders — so it is
 * held to the same rule, at the one place the line is built. Adversarial review
 * of PR #71: a name carrying newlines injected lines into the delivered wake,
 * including a forged `- <date> <claim>` bullet that reads as a resolved
 * statement and that the dashboard's lane splitter then filed under a heading
 * the store had no rows for. Not a privilege boundary — the name is the owner's
 * own, and the sentinel still verified — but the "furniture, not an element"
 * property is exactly what a second line defeats, and a prose file the owner is
 * promised they may hand-edit (constitution 6) is a paste accident away.
 */
export function identityCoreLine(name: string): string {
  return `This memory is for ${flatten(name)}. No identity has formed here yet — identity is earned at the boundary that ends a session, from what recurs across distinct days.`;
}

/**
 * THE PAGE, IN "WHO I AM" — furniture, like the day-0 line, and for the same
 * reason: it is not a ranked element, it carries no `- ` bullet, and `counts`
 * and the sentinel's `elements=` stay true of a bundle that holds it.
 *
 * The page prints FIRST and AS IS. Not re-wrapped, not re-ordered, not
 * summarised: a page reassembled here would be a page this module wrote, and
 * what the owner and the session are promised is the thing they wrote.
 * `FRAMING.context`'s "each line opens with the date it was learned" is a claim
 * about the element lines — the day-0 line has carried no date since it shipped
 * — and the page carries its own date on its own line instead.
 */
export interface PageBlock {
  /** The page as it will be injected: already cut to the cap, marker included. */
  readonly text: string;
  /** The page's own "last revised" line, or null when the page carries no date. */
  readonly dateline: string | null;
  /** True when the cap cut it — `text` already carries the marker that says so. */
  readonly truncated: boolean;
  /** The page's own bytes, whole, whatever was rendered. */
  readonly wholeBytes: number;
}

/**
 * What "Who I am" prints BESIDE the ranked elements. Both fields are decided by
 * `render` from the tunables and handed down, so `compose` stays a renderer with
 * no policy of its own.
 */
export interface IdentityBlock {
  /** The written page, when one exists. It replaces the list (spec §15 item 4). */
  readonly page: PageBlock | null;
  /** Printed when there is NO page and the list has been switched off. */
  readonly forming: string | null;
}

/** What "Who I am" says when no page has been written and the list is off. */
export const PAGE_FORMING_LINE =
  "Still forming — no page has been written here yet. It is written at a boundary, from what recurs, and can be amended by hand.";

/**
 * The page's own date, under the page. It states the DATE and — when the page
 * has gone stale — how long the silence was allowed to be, rather than "N days
 * ago": the bundle is composed at a boundary and then served unchanged until
 * the next one, so a delta computed here goes wrong while a date does not.
 */
export function pageDateline(revisedOn: string, stale: boolean, staleDays: number): string | null {
  const on = revisedOn.trim();
  // A page with no readable date SAYS SO. Returning null printed the page with
  // no date and no staleness signal at all while every other surface called it
  // stale — the one state where the wake said less than it knew (adversarial
  // review m6). Only reachable on a hand-minted or hand-edited row.
  if (on === "" || !/^\d{4}-\d{2}-\d{2}$/.test(on) || !Number.isFinite(Date.parse(`${on}T00:00:00Z`))) {
    return "(Last revised — the page carries no readable date.)";
  }
  return stale
    ? `(Last revised ${on} — more than ${staleDays} days before this wake was composed.)`
    : `(Last revised ${on}.)`;
}

/** Id → the verbatim statement AND its dates, at render time only. */
export interface Resolved {
  readonly statement: string;
  /**
   * The encode date (`ProseDoc.learnedOn`), at whatever precision it was stated.
   * Absent or blank means undated — the store writes `learned_on = ''` on a
   * chased row — and an undated element renders with no prefix rather than an
   * empty one.
   */
  readonly learnedOn?: string;
  /** The content date (`ProseDoc.happenedOn`), rendered only when it DIFFERS. */
  readonly happenedOn?: string;
  /**
   * True when the encode date is only an UPPER BOUND — the element was known BY
   * then, not learned then. Set for migrated elements, whose `learned_on` is
   * v1's date when v1 carried one and the IMPORT date when it did not, with
   * nothing in the row to tell the two apart. See `datePrefix`.
   */
  readonly boundedDate?: boolean;
}

export type Resolve = (id: string) => Resolved;

export interface BriefingRequest {
  /** The host's reported injection ceiling, in bytes. REQUIRED — scar §2.18. */
  readonly budgetBytes: number;
  /** The lived day (scar E8), stated in the header so a stale bundle is legible. */
  readonly day: number;
  /**
   * The identity core's name, when the caller found one AND the identity lane is
   * empty — the day-0 lane (`identityCoreLine`, NOTES §11). Absent means render
   * nothing, which is what a store with no core has always rendered. The lookup
   * is the caller's because it reads prose, and `self/` invents no name.
   */
  readonly coreName?: string;
  /**
   * THE WRITTEN SELF PAGE, already cut to its cap and dated by the caller
   * (`Self.build` → `page.ts#renderPage`). Present means "Who I am" prints this
   * and NOT the rotating list; absent means the list renders as it always has,
   * or — when `PAGE_EMPTY_SHOWS_LIST` is off — the still-forming line does.
   *
   * It arrives ready because the cap is a byte decision that needs the caller's
   * budget and the page's own prose, and this module composes rather than reads.
   */
  readonly page?: PageBlock;
  /**
   * TRUE when the store HAS a page, whatever this render could fit of it. A
   * ceiling with no room for the wake's own furniture carries no page block at
   * all, and without this the renderer could not tell that from a store that has
   * never been written to — so with `PAGE_EMPTY_SHOWS_LIST` off it printed "no
   * page has been written here yet" over a store holding one (adversarial review
   * MINOR-D). Absent means the caller did not say, which reads as "no page".
   */
  readonly pageExists?: boolean;
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
  /** The page as it RENDERED — null when no page was handed to this render. The
   *  bytes are the injected ones (the marker included), so a cut page's cost and
   *  its true size are both readable. */
  readonly page: { readonly bytes: number; readonly truncated: boolean; readonly wholeBytes: number } | null;
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

/**
 * THE DATE, IN FRONT OF THE CLAIM.
 *
 * Measured 2026-09-04: the wake rendered every element with no date of any kind,
 * and a migrated element learned 2026-07-26 ("the credential fix sits
 * uncommitted pending review") was read as a current fact and repeated to the
 * owner as one. The delivery preface dates the WAKE; nothing dated the ELEMENTS,
 * and a reader with no age cannot discount one.
 *
 * LEADING, not trailing, for three reasons: the age is read before the claim
 * rather than after it has landed; the element's own text still ENDS the line,
 * so "a statement is admitted whole" stays checkable by its own final
 * punctuation and nothing that follows can be mistaken for part of it; and it is
 * the cheaper of the two forms — 14 bytes at day precision (`YYYY-MM-DD` plus
 * ` · `), against 21 for a trailing `(learned YYYY-MM-DD)`, on every element in
 * every lane. The word "learned" is stated ONCE, in `FRAMING.context`, instead
 * of once per element.
 *
 * The element text itself is never touched: the annotation lives outside it, so
 * a belief still renders verbatim for contradiction detection.
 *
 * A differing content date is named inline and neutrally — `(of 2026-06-01)` —
 * because the horizon lane's dates are in the FUTURE (an arriving occasion), and
 * "happened" would be a lie about half of them.
 *
 * **`by` — the upper bound, and why a MIGRATED element gets one.** Run live on
 * 2026-09-05, the first dated wake read `2026-09-03 ·` on all eleven elements,
 * including a July incident and a mid-August finding: the importer writes the
 * IMPORT date as `learned_on` for every row v1 carried no date for, and nothing
 * in the row distinguishes those from the ones that kept v1's own. A wrong date
 * is worse than no date — it is a claim, made confidently, in the one line the
 * reader uses to discount everything else — so a migrated element states what is
 * actually known: `by 2026-09-03 ·`, three bytes for a date that is true
 * whichever of the two it is.
 *
 * A migrated element carrying a CONTENT date is the exception and renders
 * plainly, as everything else does: `happened_on` is evidence about the thing
 * itself, it survived the import unaltered, and hedging real evidence would make
 * `by` mean nothing. *Named cost: a migrated row that did keep v1's own date and
 * has no content date is hedged too — "by 2026-07-26" instead of "2026-07-26".
 * Weaker, never wrong, and the alternative needs a per-row discriminator the
 * import did not record.*
 */
export const DATE_SEP = " · ";
export const DATE_BOUND = "by ";

export function datePrefix(r: Resolved): string {
  const learned = (r.learnedOn ?? "").trim();
  if (learned === "") return "";
  const happened = (r.happenedOn ?? "").trim();
  if (happened !== "" && happened !== learned) return `${learned} (of ${happened})${DATE_SEP}`;
  const bound = r.boundedDate === true ? DATE_BOUND : "";
  return `${bound}${learned}${DATE_SEP}`;
}

/**
 * ONE rendered line for one element — the single place the shape is decided, so
 * the byte accounting (`elementBytes`, and through it the identity share) can
 * never disagree with what `compose` actually writes.
 */
export function elementLine(item: Ranked, resolve: Resolve): string {
  const r = resolve(item.id);
  return `- ${datePrefix(r)}${flatten(r.statement)}`;
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

export function compose(
  kept: Kept,
  day: number,
  resolve: Resolve,
  coreName?: string,
  identity?: IdentityBlock,
): Composed {
  const counts = emptyCounts();
  for (const lane of LANE_ORDER) counts[lane] = kept[lane].length;
  const elements = LANE_ORDER.reduce((n, lane) => n + counts[lane], 0);
  // The day-0 lane: a heading and one line of furniture, never an element. The
  // counts and `elements` above are untouched, so `elements=0` in the header and
  // `identity=0` in the sentinel stay true of a bundle that carries it. The same
  // is true of the page and the still-forming line below.
  const page = identity?.page ?? null;
  const forming = identity?.forming ?? null;
  const dayZero =
    page === null && kept.identity.length === 0 && coreName !== undefined && coreName.length > 0
      ? coreName
      : null;

  const build = (bytes: string): string => {
    const lines: string[] = [headerLine(day, elements, bytes), FRAMING.context];
    for (const lane of LANE_ORDER) {
      const items = kept[lane];
      if (lane === "identity") {
        const furniture = page !== null || forming !== null || dayZero !== null;
        if (items.length === 0 && !furniture) continue;
        lines.push("", laneHeading(lane));
        // THE PAGE FIRST, and then nothing else that speaks for the same thing:
        // `render` empties the lane when a page exists, so the loop below is a
        // no-op there. A direct caller that hands both is rendered both rather
        // than silently cut, because `counts.identity` would otherwise state a
        // number the bundle does not carry.
        if (page !== null) {
          lines.push(page.text);
          if (page.dateline !== null) lines.push(page.dateline);
        } else {
          if (forming !== null) lines.push(forming);
          if (dayZero !== null) lines.push(identityCoreLine(dayZero));
        }
        for (const item of items) lines.push(elementLine(item, resolve));
        continue;
      }
      if (items.length === 0) continue;
      lines.push("", laneHeading(lane));
      for (const item of items) lines.push(elementLine(item, resolve));
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

/** What one element costs the composition: its own rendered line, exactly —
 *  the DATE included, so the share bounds what is actually written. */
function elementBytes(item: Ranked, resolve: Resolve): number {
  return byteLength(`${elementLine(item, resolve)}\n`);
}

/** The identity lane's ceiling in bytes while other lanes are competing for it. */
export function identityShareBytes(budgetBytes: number, t: SelfTunables): number {
  return Math.floor(budgetBytes * t.IDENTITY_SHARE);
}

/**
 * Cut the identity lane down to its share, BY WHOLE ELEMENTS, and return what
 * was held back (in rank order) so the leftover pass can offer it the room.
 *
 * Two rules keep this from becoming a lane budget:
 *
 *   - **No other lane has content ⇒ no share at all.** A store that is nothing
 *     but identity is not a store competing with itself, and half a budget of
 *     white space is not a smaller wake, it is a worse one.
 *   - **The first element always survives the cut.** An element is admitted
 *     whole or not at all, so a single element longer than the share would
 *     otherwise empty the lane the briefing exists for. The BUDGET may still
 *     take it later, in `TRIM_ORDER` position, which is where that decision
 *     belongs.
 */
function withheldForShare(
  kept: Kept,
  budgetBytes: number,
  resolve: Resolve,
  t: SelfTunables,
): Ranked[] {
  const competing = LANE_ORDER.some((l) => l !== "identity" && kept[l].length > 0);
  if (!competing || kept.identity.length === 0) return [];
  const share = identityShareBytes(budgetBytes, t);
  let used = 0;
  let n = 0;
  for (const item of kept.identity) {
    const cost = elementBytes(item, resolve);
    if (n > 0 && used + cost > share) break;
    used += cost;
    n += 1;
  }
  return kept.identity.splice(n);
}

/**
 * Give identity back the bytes nobody else could use. Elements return in rank
 * order and only while the whole composition still fits, so the result is the
 * same prefix of the identity lane a larger share would have produced.
 */
function offerLeftover(
  kept: Kept,
  held: Ranked[],
  composed: Composed,
  req: BriefingRequest,
  resolve: Resolve,
  coreName: string | undefined,
  identity: IdentityBlock,
): Composed {
  let current = composed;
  while (held.length > 0) {
    const next = held[0];
    if (next === undefined) break;
    kept.identity.push(next);
    const candidate = compose(kept, req.day, resolve, coreName, identity);
    if (candidate.bytes > req.budgetBytes) {
      kept.identity.pop();
      break;
    }
    held.shift();
    current = candidate;
  }
  return current;
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
  // THE DAY-0 GUARD, DECIDED ONCE, HERE — on the lane as it ARRIVED.
  //
  // Adversarial review of PR #71: gating the lookup on the ranked lane and the
  // render on the post-trim copy is two predicates, and the trim loop pops from
  // `kept.identity` last but it does pop. A day-30 store with two real identity
  // beliefs and a 400-byte ceiling trimmed both and then asserted "No identity
  // has formed here yet" — identity amnesia printed over a store that has
  // identity, which is this module's own worst failure (scar §2.3). Unreachable
  // through `Self`, which never sets `coreName` on a non-empty lane; reachable
  // by any caller of this exported function, and the CONTRACT's "guarded by the
  // empty lane" has to be true at the seam that renders, not only at the seam
  // that looks the name up. A store that HAS identity says nothing about not
  // having it, whatever the budget did to the lane.
  const coreName = lanes.identity.length === 0 ? req.coreName : undefined;
  // THE PAGE REPLACES THE LIST (spec §15 item 4), and it replaces it HERE — by
  // emptying the lane before the share, the trim order or the counts see it —
  // so `counts.identity` and the sentinel's `elements=` state what the bundle
  // actually carries. The lane's elements are not "trimmed": nothing was
  // dropped for want of room, so no `TrimEvent` is written for them, and the
  // rotation memory (`RENDERED_PREFIX`) simply stops advancing while a page is
  // what renders.
  //
  // THE STILL-FORMING LINE, which is about the PAGE and never about identity,
  // and which prints on ONE value of the switch: the list has been turned off
  // and no page has been written, so the line stands in the list's place.
  //
  // **It deliberately does NOT print under the default, on a lane that happens
  // to be empty**, and the reason is measured rather than tidy. It is FURNITURE
  // — untrimmable, like the day-0 line — so printing it whenever the lane is
  // empty adds ~127 bytes to the floor of every such wake. A host reporting a
  // 400-byte ceiling then composes 539 and publishes `overBudget`, which is the
  // host-budget guarantee (§1, scar §2.18) paying for a sentence. On a
  // brand-new store the day-0 line already says the same thing in the words
  // this module chose for it — "No identity has formed here yet — identity is
  // earned at the boundary…" — so the honesty the plan asks for on a first wake
  // is already there, and the switch's other value is one word away for an
  // owner who wants the sentence verbatim. See NOTES §12.
  const page = req.page ?? null;
  const exists = page !== null || req.pageExists === true;
  const suppressList = page !== null || !t.PAGE_EMPTY_SHOWS_LIST;
  if (suppressList) kept.identity.length = 0;
  const identity: IdentityBlock = {
    page,
    // A page this ceiling could not carry is still a page, so the line that says
    // none has been written stays off it (MINOR-D).
    forming: !exists && !t.PAGE_EMPTY_SHOWS_LIST ? PAGE_FORMING_LINE : null,
  };
  // THE SHARE, applied BEFORE the trim order rather than inside it: identity
  // trims last by policy, so by the time the trim loop could bound identity
  // every other lane is already gone. Held-back elements are not trimmed —
  // nothing is dropped here, and `held` is offered the leftover below.
  const held = withheldForShare(kept, req.budgetBytes, resolve, t);

  for (;;) {
    const c = compose(kept, req.day, resolve, coreName, identity);
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
      // The leftover clause. Only when NOTHING had to be trimmed: a lane that
      // lost an element wanted the room, and handing it to identity instead
      // would make the share decide the opposite of what it was set for. When
      // the other lanes are all present and the budget is still not spent, the
      // held-back identity elements take it back, in rank order, whole.
      const composed =
        trimmed.length === 0 ? offerLeftover(kept, held, c, req, resolve, coreName, identity) : c;
      return {
        ...composed,
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
        pressure: composed.bytes >= req.budgetBytes * t.BUDGET_PRESSURE,
        overBudget: !fits,
        page:
          identity.page === null
            ? null
            : {
                bytes: byteLength(identity.page.text),
                truncated: identity.page.truncated,
                wholeBytes: identity.page.wholeBytes,
              },
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


// ── the delivery preface (composed at INJECTION, never at sleep) ─────────────

/**
 * THE ONE LINE THE BODY CANNOT WRITE FOR ITSELF.
 *
 * The bundle is composed at a boundary and then served, unchanged, to every
 * session until the next one. On 2026-09-03 the memory system under this host
 * was switched from v1 to Counterparts mid-day; the stored wake still carried a
 * v1-era finding ("bansai's surprise pipeline has never fired") as a current
 * fact, nothing in the body said which system was speaking or how old the
 * render was, and the model repeated it as current until the owner corrected
 * it. Only the HTML comment named the system, and comments are furniture.
 *
 * So one line, composed where and when the bundle is DELIVERED — which system,
 * which lived day, today's date, how big the store is — and it says out loud
 * that the body below was composed at the last boundary. Constitution 16: if
 * the owner (or the waking session) cannot see it, it isn't trustworthy.
 *
 * It is deliberately not per-session: nothing in it varies between two sessions
 * on the same day in the same store, so the delivery check the next hook makes
 * (§2.3) compares a sentinel that is stable for as long as the bundle is.
 */
export const WAKE_SYSTEM = "Counterparts";

/**
 * The room the composed budget leaves for the preface, in bytes. It is the
 * preface's OWN cap, asserted by a test at the widest plausible day, date and
 * store size — one number, not a lane cap that can drift from what it bounds.
 * Structural, not tunable: the renderer must reserve exactly what delivery adds.
 *
 * Raised 128 → 160 on 2026-09-14 with U4's second number: the widest line is now
 * 126 bytes (a six-digit day and a billion rows on both counts), and a cap two
 * bytes above its own worst case is a cap that fails the first time the line
 * gains a word.
 */
export const PREFACE_RESERVE_BYTES = 160;

/**
 * THE ROOM THE WAKE'S OWN FURNITURE TAKES AROUND THE PAGE, in bytes — the
 * number `Self.build` subtracts from the caller's ceiling before it caps the
 * page. Structural, not tunable, and measured rather than guessed: a test
 * composes the widest plausible furniture (a six-digit day and six-digit lane
 * counts in both comment lines, the stale dateline at a six-digit threshold)
 * and asserts it fits under this.
 *
 * It exists because of the adversarial review of PR #138. The page's cap was
 * clamped to the WHOLE budget, so a long page filled the budget exactly and the
 * header, `FRAMING.context`, the heading, the dateline and the sentinel pushed
 * the composition past it — and nothing could trim it back, because the identity
 * lane is empty by then and the page is furniture the trim loop cannot pop. An
 * 8,657-byte page published `overBudget: true` at host budgets of 400, 900,
 * 2,000 and 6,000. That is scar §2.18's guarantee paying for a block of prose,
 * and it is the same measurement that kept the still-forming line out of the
 * default switch (NOTES §12a) — applied to the page this time.
 *
 * Widest measured furniture: 444 bytes. 512 is that plus room for a line to
 * gain a word.
 */
export const PAGE_FLOOR_RESERVE_BYTES = 512;

/**
 * The smallest room worth rendering a PAGE into. Below it the wake says the
 * page exists and does not fit, in one short line, rather than handing the
 * reader a sentence and a marker — a fragment of a self is not a smaller self.
 */
export const PAGE_MIN_RENDER_BYTES = 240;

/** The one short line a wake with no room for the page prints instead of it. */
export function pageTooLargeLine(bytes: number): string {
  return `(My page is ${bytes} bytes — no room for it in this wake. Read it with 'counterparts self-page'.)`;
}

export interface PrefaceFacts {
  /** Which memory system composed and is delivering this. */
  readonly system: string;
  /** The lived day (scar E8) — days lived, never calendar days. */
  readonly day: number;
  /** Today's calendar date as the HOST reports it. Absent ⇒ no date is stated. */
  readonly date?: string;
  /** Live memories in the store AT DELIVERY, not at the render:
   *  `countMemories({ type: "memory", archived: false })`. */
  readonly memories: number;
  /**
   * EVERY live row at delivery — memories, journal episodes, beliefs and
   * entities: `countMemories({ archived: false })` (IMPROVEMENTS U4).
   *
   * The header said "14,002 memories" while recall said "considered 41 of 14,701
   * live rows" in the same session, and nothing on either surface said why the
   * two differed by ~700. Both numbers were right and neither was labelled: the
   * header counts `type: "memory"` rows, recall's `storeSize` is
   * `list({ archived: false }).length`, the same WHERE minus the type clause, so
   * the gap is exactly the live episodes and schema rows (superseded rows are
   * `archived = 1` and are outside both). Stating both, in recall's own words —
   * "live rows" — is what makes the model's two readings one vocabulary.
   *
   * Required, not optional: a line that sometimes carries the second number and
   * sometimes does not is a line whose absence a reader has to interpret.
   */
  readonly liveRows: number;
}

/** Thousands, hand-rolled: `toLocaleString` varies with the runtime's ICU. */
export function groupDigits(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return n < 0 ? `-${out}` : out;
}

/** One line, under `PREFACE_RESERVE_BYTES`, stating what the body cannot — and
 *  saying WHICH population each of its two counts is (U4). */
export function prefaceLine(f: PrefaceFacts): string {
  const when = f.date === undefined ? `day ${f.day}` : `day ${f.day} (${f.date})`;
  return (
    `${f.system} memory, ${when}, ${groupDigits(f.memories)} memories of ` +
    `${groupDigits(f.liveRows)} live rows — composed at the last boundary.`
  );
}

export interface PrefacedBundle {
  readonly text: string;
  readonly bytes: number;
  /** The sentinel of the DELIVERED text — what the next hook must see. */
  readonly sentinel: string | null;
  /** False when the bundle was not a well-formed render and was left alone. */
  readonly applied: boolean;
}

const BYTES_FIELD = /bytes=\d+/;
const OPEN_RE = /^<!-- counterparts:wake .*elements=(\d+) bytes=(\d+) -->$/;

/**
 * Splice the preface INSIDE the wake block, above the composed body, and re-solve
 * the byte fixed point so the opening comment and the tail sentinel both state
 * the delivered total. The alternative — adding bytes and leaving the two lines
 * describing something smaller — would hand every reader a sentinel that fails
 * the check it exists to pass (§1 G2).
 *
 * A bundle that is not a well-formed render (bootstrap line, clipped, edited) is
 * returned UNTOUCHED: rewriting the byte count of a damaged bundle would erase
 * the damage, which is the one thing the sentinel is for.
 */
export function applyPreface(text: string, preface: string): PrefacedBundle {
  const lines = text.split("\n");
  const open = lines[0] ?? "";
  const tail = lines[lines.length - 1] ?? "";
  if (lines.length < 2 || !OPEN_RE.test(open) || !SENTINEL_RE.test(tail)) {
    return {
      text,
      bytes: byteLength(text),
      sentinel: SENTINEL_RE.test(tail) ? tail : null,
      applied: false,
    };
  }
  const build = (stated: string): string[] => [
    open.replace(BYTES_FIELD, `bytes=${stated}`),
    preface,
    ...lines.slice(1, -1),
    tail.replace(BYTES_FIELD, `bytes=${stated}`),
  ];
  const skeleton = byteLength(build("").join("\n"));
  const composed = build(String(fixedPointTotal(skeleton, 2)));
  const out = composed.join("\n");
  return {
    text: out,
    bytes: byteLength(out),
    sentinel: composed[composed.length - 1] ?? null,
    applied: true,
  };
}

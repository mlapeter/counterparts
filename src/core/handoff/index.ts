/**
 * THE HANDOFF — where the work in THIS directory stands, for the next session
 * that opens here.
 *
 * It is not a memory, and that is the whole of its design. A memory is an
 * interpretation of what was learned; a handoff is working context — "what I was
 * doing here" — which is true for a fortnight and then is not true at all. v1
 * had the same lane under the name `task-state`, expiring; the spec's §6.4 is
 * where it comes back, and the owner's words for why (§15 item 6) are that today
 * he types "prep a handoff so we can pick up from here in a new session" and
 * wants that to happen on its own.
 *
 * **Never a memory** — every clause below is a mechanism, not a promise:
 *
 *   - **Not recalled.** `recall/activate.ts` skips the row in the scan, the way
 *     it skips the self page, and `creditReferences` refuses it a use even when
 *     a session expands it by id. Nothing here ever accrues `uses` or
 *     `reinforced_days`, so `physics#promotionEligibility` — which needs
 *     reinforcement on N distinct lived days — can never be satisfied and the
 *     row can never cross into the identity band.
 *   - **Not consolidated, never identity, never in "Who I am".** `scanActive`
 *     lists `{ type: "memory" }` and this is a schema row, so no briefing lane
 *     can reach it. The pointer the wake prints is FURNITURE, like the page and
 *     the day-0 line: the lane counts and the sentinel's `elements=` are
 *     untouched by it.
 *   - **Exempt from dedup**, free, by `sleep/types.ts#isSchemaRow`: a schema row
 *     is not a duplicate candidate.
 *   - **Invisible to `schemas/`**: `toMetaRecord` returns null for any role but
 *     entity, belief and current-state, so the index build skips it.
 *   - **It is let go by the ordinary means.** The row is NOT `protected` — the
 *     one thing the self page is and this is not. It is born in the episodic
 *     band with nothing on any salience dimension, so it decays like anything
 *     else and `physics#pruneVerdict` archives it once it is under the floor and
 *     has dwelt `D_FLOOR_DAYS`. Nothing new forgets it; the existing forgetting
 *     does.
 *
 * **One live pointer per directory.** A newer handoff for the same scope is an
 * ordinary `store.revise` of the SAME row, so the one it replaces becomes an
 * ordinary version and the row keeps its whole chain — the self page's
 * precedent (`self/page.ts`, "ONE ROW FOR THE LIFE OF THE PAGE"), chosen over an
 * archived row because a superseded row is one more thing `revise`'s readers
 * have to find and because `pruneSupersededVersions` already bounds versions at
 * the ordinary retention. Two sessions ending at once: last writer wins, and the
 * loser is kept as the version underneath it.
 *
 * **It expires in LIVED days** (`store.livedDay()`), not calendar days, because
 * a fortnight of holidays is not a fortnight of work. An expired handoff stops
 * being shown and stops being written over: the row is simply left to the prune.
 */
import type { ProseDoc, Store } from "../store/index.js";

/** The `meta.role` that makes a schema row a handoff. One per scope. */
export const HANDOFF_ROLE = "handoff";

/**
 * The `kind` the row carries. A handoff is about a DIRECTORY — a place of work —
 * and `kind` is the row's subject everywhere else in the store (the self page is
 * `kind: "self"`). It also keeps the recall scan's exemption cheap: the prose
 * read is gated on `type === "schema" && kind === "place"`, so only schema rows
 * about places pay for it.
 */
export const HANDOFF_KIND = "place";

/** The durable row every accepted handoff leaves. Read by `fired`. */
export const HANDOFF_WRITTEN_EVENT = "handoff.written";

/** The durable row every pointer shown at a wake leaves. Read by `fired`. */
export const HANDOFF_SHOWN_EVENT = "handoff.shown";

/**
 * The durable row every REFUSED handoff leaves, beside the accepted ones rather
 * than instead of them — owner ruling 2's corollary (2026-09-18): a cap reports
 * what it refused where the owner will see it.
 */
export const HANDOFF_REFUSED_EVENT = "handoff.refused";

/**
 * The durable row a RETIRED pointer leaves. A session that finished the work
 * says so by sending the field empty, and "there is nothing to pick up here
 * any more" is a fact about this directory worth one row.
 */
export const HANDOFF_CLEARED_EVENT = "handoff.cleared";

/**
 * THE WRITE CAP. Refused past it, never cut: what gets cut at write time is the
 * only copy (the page's rule, `self/index.ts#revisePage`). A handoff is a
 * paragraph or two about where a directory stands — 2 KB is a generous ceiling
 * for that and a small one against the 16 KB the page may have.
 */
export const HANDOFF_MAX_BYTES = 2048;

/** The excerpt's cap in the pointer line. The body is never shown whole at a
 *  wake; the id is the door to the whole of it. */
export const HANDOFF_EXCERPT_BYTES = 160;

/**
 * THE CEILING ON THE RESERVE, in bytes — the widest block this module can
 * produce, measured by a test at a full-width excerpt, a real id and a six-digit
 * lived day. It is a CEILING and not the reserve: see `reserveBytes`.
 */
export const HANDOFF_RESERVE_MAX_BYTES = 448;

/**
 * Slack on top of the block that actually exists, so a reserve taken at one
 * boundary still covers the block delivered at the next wake. Only two things
 * move between them — the days-left number gains or loses a digit, and a
 * cleared-then-rewritten pointer changes length — and the second is bounded by
 * the reserve's own ceiling.
 */
export const HANDOFF_RESERVE_MARGIN_BYTES = 48;

/**
 * THE SHARE RULE — the reserve is taken only when the budget is at least this
 * many times the reserve.
 *
 * The adversarial review measured what the flat 448-byte reserve cost
 * (MAJOR-1): at a 1,200-byte ceiling a session in a directory with NO handoff
 * lost 4 of its 6 identity elements, at 2,000 it lost 4 of 13, at 3,000 five of
 * 23 — because the reserve is store-wide and the bundle is one. At the budget
 * the parallel run uses (9,000) the lane caps bind first and the cost is zero.
 *
 * A pointer is a fortnight of working context. It is not worth a third of a
 * small wake's memories, and on a ceiling that tight the honest answer is to
 * carry no pointer at all — which is what returning 0 does: nothing is
 * reserved, nothing is trimmed, and the splice at delivery simply finds no room
 * and drops the pointer whole. Eight is chosen so that the reserve can never
 * cost more than an eighth of the bundle, which at the measured block size
 * turns the reserve on from about 2,400 bytes up.
 *
 * One comparison, not a second budgeter: nothing here decides what to trim.
 */
export const HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE = 8;

/**
 * THE ROOM THE POINTER TAKES IN THE WAKE — what `Counterpart` subtracts from the
 * compose budget at a boundary, beside `PREFACE_RESERVE_BYTES`.
 *
 * Three properties, in the order they matter:
 *
 *   1. **No live handoff anywhere ⇒ zero.** That is what makes a store with no
 *      handoff compose the wake it composed before this module existed, byte
 *      for byte.
 *   2. **Sized to the block that EXISTS**, not to the widest one that could. The
 *      review measured 295 bytes of ceiling left unused at budget 2,000 — five
 *      memories spent to buy two lines and a third of a kilobyte of nothing.
 *      The boundary already knows which handoffs are live and what their
 *      pointers say, so it can ask.
 *   3. **Off entirely below the share rule**, because the reserve is store-wide
 *      and the bundle is one: a directory that will never be shown a pointer
 *      pays for it otherwise, and on a small ceiling it pays in memories.
 *
 * Pure. The caller passes the live blocks' byte lengths and its ceiling.
 */
export function reserveBytes(blockBytes: readonly number[], budgetBytes: number): number {
  const widest = blockBytes.reduce((n, b) => Math.max(n, b), 0);
  if (widest <= 0) return 0;
  const want = Math.min(widest + HANDOFF_RESERVE_MARGIN_BYTES, HANDOFF_RESERVE_MAX_BYTES);
  return want * HANDOFF_RESERVE_MIN_BUDGET_MULTIPLE <= budgetBytes ? want : 0;
}

/**
 * How long a pointer shows, in LIVED days since it was written. About a
 * fortnight of use (spec §15 item 6). After it the pointer stops showing; the
 * row is then let go by the ordinary prune, which is the only forgetting this
 * module has.
 */
export const HANDOFF_LIFE_DAYS = 14;

/** Prose meta the row keeps beside its body. */
export const HANDOFF_META_SCOPE = "scope";
export const HANDOFF_META_WRITTEN_ON = "writtenOn";
export const HANDOFF_META_WRITTEN_DAY = "writtenDay";
export const HANDOFF_META_SESSION = "session";

/**
 * The wake's own structural markers, refused in a handoff body for the reason
 * `revisePage` refuses them: the excerpt is spliced INSIDE the wake block, so a
 * body carrying an end-of-wake comment would put a false end in front of real
 * lanes for the model reading it. The constant's owner is
 * `self/index.ts#WAKE_MARKER`; it is spelled here rather than imported because
 * `handoff/` depends on `store/` and nothing else.
 */
export const WAKE_MARKER = "<!-- counterparts:wake";

export type HandoffRefusal =
  | "observer"
  | "no-scope"
  | "empty"
  | "empty-after-gate"
  | "not-text"
  | "nothing-to-clear"
  | "no-room"
  | "store-refused"
  | "too-large"
  | "forged-markers"
  | "gate-refused";

export interface HandoffWrite {
  readonly written: boolean;
  /** `created`, `revised` or `cleared` when written; the refusal otherwise. */
  readonly reason: HandoffRefusal | "created" | "revised" | "cleared";
  readonly id: string | null;
  readonly version: number | null;
  readonly bytes: number;
  /** The gate that turned it away, when one did. */
  readonly gate: { readonly gate: string; readonly reason: string } | null;
  /** Set when the battery took something out on the way in (a credential). */
  readonly redacted: { readonly gate: string; readonly bytesBefore: number } | null;
  /** Lived days this pointer will show for, counting the day it was written. */
  readonly showsForDays: number | null;
}

export interface Handoff {
  readonly id: string;
  readonly scope: string;
  /** The handoff, verbatim. Never truncated here — see `excerpt`. */
  readonly body: string;
  readonly bytes: number;
  /** The calendar date it was written, `YYYY-MM-DD`; "" when unrecorded. */
  readonly writtenOn: string;
  /** The lived day it was written; null when unrecorded. */
  readonly writtenDay: number | null;
  readonly session: string | null;
  /** `revision` on the row: 0 for one written once and never replaced. */
  readonly version: number;
}

/** The gate every entrance passes (SEAMS H). Shaped like `bridge.EpisodeGate`,
 *  restated as a parameter so this module imports no gate of its own. */
export type HandoffGate = (input: {
  text: string;
  handles: readonly string[];
  sessionId: string;
}) => { ok: true; text?: string } | { ok: false; gate: string; reason: string };

function byteLengthOf(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * A statement is a line here, as it is in the wake (`briefing.ts#flatten`) —
 * AND nothing in it can steer a terminal or a reader.
 *
 * `\s+` is `\n \r \t` and friends. It is not NUL, not ESC, and not U+202E:
 * measured by the adversarial review (MINOR-4), a right-to-left override in a
 * handoff reversed the display of everything after it in the delivered wake for
 * any reader that honours bidi, and an ANSI escape landed in a prompt that is
 * sometimes rendered in a terminal. Line injection was already blocked — the CR
 * case folds here and only one line is ever excerpted — and this closes the
 * rest of the class in the same place, so there is one function to check.
 *
 * `\p{Cc}` is the C0/C1 controls, `\p{Cf}` the format characters (the bidi
 * overrides and embeddings, the zero-width joiner, the byte-order mark). They
 * are DROPPED rather than replaced: a handoff is prose about work, and a
 * visible substitute for an invisible character is noise in a two-line pointer.
 */
export function flatten(text: string): string {
  // A control that IS whitespace becomes a space — `\n` must not join two words
  // into one — and everything else in the two classes is dropped. Then the
  // ordinary collapse, so a dropped character cannot leave a double space.
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (/\s/u.test(c) ? " " : ""))
    .replace(/\s+/g, " ")
    .trim();
}

// ── finding it ──────────────────────────────────────────────────────────────

/**
 * Is this document a handoff? Read STRUCTURALLY by `recall/` for the reason
 * `isSelfPage` is: a shape check that fails reads as "not a handoff", which is
 * the direction that only ever costs a candidate slot.
 */
export function isHandoffDoc(doc: ProseDoc): boolean {
  return doc.type === "schema" && doc.meta["role"] === HANDOFF_ROLE;
}

/** `isHandoffDoc` by id, for callers holding rows rather than documents. */
export function isHandoffRow(store: Store, id: string): boolean {
  const row = store.row(id);
  if (row === undefined || row.type !== "schema" || row.kind !== HANDOFF_KIND) return false;
  try {
    return isHandoffDoc(store.readProse(id));
  } catch {
    return false;
  }
}

/** One live handoff row, read far enough to rank it. */
interface LiveRow {
  readonly id: string;
  readonly scope: string;
  readonly writtenDay: number | null;
}

/**
 * Every live handoff row in the store, whatever its scope, with the two fields
 * every caller here ranks by. One walk, one prose read per row.
 */
export function liveHandoffRows(store: Store): LiveRow[] {
  const out: LiveRow[] = [];
  for (const id of store.list({ type: "schema", kind: HANDOFF_KIND, archived: false })) {
    try {
      const meta = store.readProse(id).meta;
      if (meta["role"] !== HANDOFF_ROLE) continue;
      const scope = meta[HANDOFF_META_SCOPE];
      const day = meta[HANDOFF_META_WRITTEN_DAY];
      out.push({
        id,
        scope: typeof scope === "string" ? scope : "",
        writtenDay: typeof day === "number" ? day : null,
      });
    } catch {
      continue;
    }
  }
  return out;
}

/** Ids only, for the callers that do not rank. */
export function handoffRows(store: Store): string[] {
  return liveHandoffRows(store).map((r) => r.id);
}

/**
 * THE NEWEST live row per scope. Two rows for one directory should be
 * impossible — `write` mints only when `findHandoffRow` returns null — but
 * `findHandoffRow` → `put` is not one transaction, and the deployment is one
 * process per hook and one server per session, so a cross-process race is
 * narrow rather than closed (adversarial review MINOR-8). When it happens the
 * loser used to be picked by `list()`'s id ordering, silently, and went on
 * holding the reserve open while being invisible to every read.
 *
 * Newest `writtenDay` wins, id as the tiebreak so the answer is stable. The
 * losers are named so `write` can retire them.
 */
export function newestPerScope(rows: readonly LiveRow[]): Map<string, LiveRow> {
  const best = new Map<string, LiveRow>();
  for (const r of rows) {
    if (r.scope.length === 0) continue;
    const held = best.get(r.scope);
    if (
      held === undefined ||
      (r.writtenDay ?? -1) > (held.writtenDay ?? -1) ||
      ((r.writtenDay ?? -1) === (held.writtenDay ?? -1) && r.id > held.id)
    ) {
      best.set(r.scope, r);
    }
  }
  return best;
}

/**
 * THIS DIRECTORY'S row, live or expired, or null — the newest one when a race
 * has left more than one.
 *
 * Box 2 has no meta query (`schemas/INTERFACE-GAPS §2`), so the scope match is a
 * body read, exactly as `findSelfPage` reads for the role.
 */
export function findHandoffRow(store: Store, scope: string): string | null {
  const want = scope.trim();
  if (want.length === 0) return null;
  return newestPerScope(liveHandoffRows(store)).get(want)?.id ?? null;
}

/** The OTHER live rows for this scope — a race's losers, which `write` retires. */
export function duplicateHandoffRows(store: Store, scope: string): string[] {
  const want = scope.trim();
  if (want.length === 0) return [];
  const rows = liveHandoffRows(store).filter((r) => r.scope === want);
  const winner = newestPerScope(rows).get(want)?.id ?? null;
  return rows.filter((r) => r.id !== winner).map((r) => r.id);
}

/** The handoff as a value, or null. A row whose prose will not read is absent
 *  to every reader here, never a throw (`self/` §5 G7's rule, borrowed). */
export function readHandoff(store: Store, scope: string): Handoff | null {
  const id = findHandoffRow(store, scope);
  return id === null ? null : handoffOf(store, { id, scope, writtenDay: null });
}

/** The same read, for a caller that has already walked and holds the row. */
function handoffOf(store: Store, live: LiveRow): Handoff | null {
  const id = live.id;
  let doc: ProseDoc;
  try {
    doc = store.readProse(id);
  } catch {
    return null;
  }
  const scope = live.scope;
  const row = store.row(id);
  const writtenDay = doc.meta[HANDOFF_META_WRITTEN_DAY];
  const writtenOn = doc.meta[HANDOFF_META_WRITTEN_ON];
  const session = doc.meta[HANDOFF_META_SESSION];
  return {
    id,
    scope,
    body: doc.body,
    bytes: byteLengthOf(doc.body),
    writtenOn: typeof writtenOn === "string" ? writtenOn : "",
    writtenDay: typeof writtenDay === "number" ? writtenDay : null,
    session: typeof session === "string" && session.length > 0 ? session : null,
    version: row?.revision ?? 0,
  };
}

/**
 * Has this one run out? A handoff with no recorded lived day has: an undated
 * pointer cannot be aged, and showing one forever is the failure the expiry
 * exists to prevent.
 */
export function expired(h: Handoff, day: number, lifeDays = HANDOFF_LIFE_DAYS): boolean {
  if (h.writtenDay === null) return true;
  return daysLeft(h.writtenDay, day, lifeDays) <= 0;
}

/**
 * LIVED DAYS THIS POINTER HAS LEFT, counting the day it was written as the
 * first of them. Zero or less means it has run out.
 *
 * The first draft was `day - writtenDay > lifeDays`, which showed the pointer on
 * days 0…14 — fifteen days, while every word around it said fourteen — and made
 * `pointerDoor` print "It stops showing after 0 more days of use." on the last
 * one, which reads as a bug to anyone who sees it (adversarial review NIT 1 and
 * 2). One function, so the constant, the prose and the sentence cannot disagree.
 */
export function daysLeft(writtenDay: number, day: number, lifeDays = HANDOFF_LIFE_DAYS): number {
  return lifeDays - (day - writtenDay);
}

// ── what the wake prints ────────────────────────────────────────────────────

/** The marker a cut excerpt ends with. Three bytes, and the cut reserves them. */
export const ELLIPSIS = "\u2026";

/**
 * A heading line \u2014 Markdown ATX or a Setext underline \u2014 or a blank one. Not
 * what the pointer is for; see `excerpt`.
 */
function isHeading(line: string): boolean {
  const t = line.trim();
  return t.length === 0 || /^#{1,6}\s/.test(t) || /^[=-]{3,}$/.test(t);
}

/** The first line of a handoff, flattened and cut to fit, with an ellipsis when
 *  it was cut. Cuts at a word where one is near the end, never mid-word when a
 *  space is within the last fifth of the room. */
export function excerpt(body: string, capBytes = HANDOFF_EXCERPT_BYTES): string {
  const lines = body.split("\n");
  // The first line with SUBSTANCE on it: not blank, and not the title the
  // writer put above the substance. A model asked for a handoff writes a titled
  // note about as often as a bare paragraph, and `"# Handoff\n\nThe empty-input
  // case still fails…"` produced a pointer that said nothing at all
  // (adversarial review MINOR-6).
  const line = lines.find((l) => !isHeading(l)) ?? lines.find((l) => l.trim().length > 0) ?? body;
  const first = flatten(line);
  if (byteLengthOf(first) <= capBytes) return first;
  // The ellipsis is THREE bytes, not one: `…` is U+2026. Reserving a character
  // rather than its bytes is how a cap that says 160 renders 161 — measured,
  // not reasoned about.
  const room = Math.max(0, capBytes - byteLengthOf(ELLIPSIS));
  const bytes = new TextEncoder().encode(first);
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, room));
  const clean = prefix.replace(/�+$/u, "");
  const space = clean.lastIndexOf(" ");
  const kept = space > clean.length * 0.8 ? clean.slice(0, space) : clean;
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

/** The pointer's first line: the date and the first line of what was written. */
export function pointerLine(h: Handoff, capBytes = HANDOFF_EXCERPT_BYTES): string {
  const when = /^\d{4}-\d{2}-\d{2}$/.test(h.writtenOn.trim()) ? h.writtenOn.trim() : "an unrecorded date";
  return `Where I left off in this directory (${when}): ${excerpt(h.body, capBytes)}`;
}

/** The pointer's second line: the door to the whole of it, and its life. */
export function pointerDoor(h: Handoff, day: number, lifeDays = HANDOFF_LIFE_DAYS): string {
  const left = h.writtenDay === null ? lifeDays : daysLeft(h.writtenDay, day, lifeDays);
  // Never "0 more days": `pointerBlock` returns null once `daysLeft` reaches 0,
  // so the smallest number this line can print is 1 — the last day it shows.
  const days = left === 1 ? "one more day" : `${Math.max(1, left)} more days`;
  return `(The whole of it is ${h.id} — expand it with the counterparts recall tool. It stops showing after ${days} of use.)`;
}

/**
 * THE BLOCK the wake splices in, or null when this one has run out.
 *
 * Two lines and no heading: the pointer is FURNITURE, and furniture that opens
 * its own section costs a blank line and a heading for two lines of content.
 * Both lines are flattened, so a handoff body can never inject a line into the
 * bundle — the scar `identityCoreLine` carries (a name with newlines in it
 * forged a resolved statement into the wake).
 */
export function pointerBlock(h: Handoff, day: number, lifeDays = HANDOFF_LIFE_DAYS): string | null {
  if (expired(h, day, lifeDays)) return null;
  return [flatten(pointerLine(h)), flatten(pointerDoor(h, day, lifeDays))].join("\n");
}

// ── the module ──────────────────────────────────────────────────────────────

export interface HandoffsOptions {
  readonly store: Store;
  readonly gate: HandoffGate;
  readonly observer?: boolean;
  readonly onEvent?: (e: {
    at: number;
    name: string;
    ref?: string;
    data?: Record<string, string | number | boolean | null>;
  }) => void;
  readonly now?: () => number;
}

export interface WriteInput {
  readonly body: string;
  /** The canonical directory this handoff is about. Required and non-empty. */
  readonly scope: string;
  readonly session?: string | null;
  readonly day?: number;
}

export class Handoffs {
  private readonly store: Store;
  private readonly gate: HandoffGate;
  private readonly observer: boolean;
  private readonly onEvent: HandoffsOptions["onEvent"];
  private readonly nowFn: () => number;

  constructor(opts: HandoffsOptions) {
    this.store = opts.store;
    this.gate = opts.gate;
    this.observer = opts.observer === true;
    this.onEvent = opts.onEvent;
    this.nowFn = opts.now ?? Date.now;
  }

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    this.onEvent?.({
      at: this.nowFn(),
      name,
      ...(ref === undefined ? {} : { ref }),
      ...(data === undefined ? {} : { data }),
    });
  }

  /** This directory's live, unexpired handoff, or null. */
  read(scope: string, day?: number): Handoff | null {
    const h = readHandoff(this.store, scope);
    if (h === null) return null;
    return expired(h, day ?? this.store.livedDay()) ? null : h;
  }

  /** This directory's row whatever its age — the door `write` revises. */
  readAny(scope: string): Handoff | null {
    return readHandoff(this.store, scope);
  }

  /**
   * DOES ANY DIRECTORY HOLD A LIVE POINTER? Kept because it reads as the
   * question it is, and because the doctor and the tests ask it.
   */
  anyLive(day?: number): boolean {
    return this.liveBlockBytes(day).length > 0;
  }

  /**
   * THE BYTE LENGTHS OF EVERY LIVE POINTER BLOCK, one per DIRECTORY — what the
   * boundary hands `reserveBytes`.
   *
   * Per directory and not per row: a race's loser is invisible to every read,
   * and before `newestPerScope` it went on holding the reserve open until it
   * expired (adversarial review MINOR-8). The walk is bounded by the number of
   * directories the owner has worked in, and it never throws — a store that
   * will not answer reserves nothing, which composes the wake master composes.
   */
  liveBlockBytes(day?: number): number[] {
    const d = day ?? this.store.livedDay();
    const out: number[] = [];
    // ONE walk, not one per directory. The first draft called `readHandoff`
    // per scope, and each of those walks the store again — D+1 walks for D
    // directories, at every boundary, for a number that is the same shape as
    // the one already in hand.
    for (const [, row] of newestPerScope(liveHandoffRows(this.store))) {
      if (row.writtenDay === null || daysLeft(row.writtenDay, d) <= 0) continue;
      const h = handoffOf(this.store, row);
      if (h === null) continue;
      const block = pointerBlock(h, d);
      if (block !== null) out.push(byteLengthOf(block));
    }
    return out;
  }

  /**
   * THE ONE SEAM THAT WRITES A HANDOFF. Refusals are named and durable, as the
   * page's are: there is no silent no-op on this path.
   */
  write(input: WriteInput): HandoffWrite {
    const day = input.day ?? this.store.livedDay();
    const draft = input.body.replace(/\r\n/g, "\n").trim();
    let bytes = byteLengthOf(draft);
    const scope = input.scope.trim();
    const session = input.session ?? null;
    const none = { id: null, version: null, gate: null, redacted: null, showsForDays: null } as const;
    const refuse = (
      reason: HandoffRefusal,
      detail: Record<string, string | number | boolean> = {},
      extra: Partial<HandoffWrite> = {},
    ): HandoffWrite => this.refuse(reason, { day, session, bytes, ...detail }, { ...none, ...extra });

    if (this.observer) {
      // The stand-down writes nothing at all, the durable row included: an
      // instrument that logged its own refusal would be changing the store it is
      // reading (observer-mode G3).
      this.emit("handoff.observer.standdown", undefined, { site: "write" });
      return { ...none, written: false, reason: "observer", bytes };
    }
    // NO SCOPE, NO POINTER — and the rule lives HERE rather than at the MCP
    // door, which is what makes the refusal durable (adversarial review
    // MAJOR-2a: the adapter's own short-circuit wrote a ring event and no row,
    // so guarantee 3 was false on the only live entrance).
    //
    // Two shapes of "no place to be about": a host that named no directory at
    // all, and one whose only answer was the STORE'S OWN directory — which is
    // `resolveScope`'s last resort, "a bad answer… kept only because a server
    // with no scope at all cannot deposit". A pointer filed there is about
    // nowhere and every session in every project would be handed it.
    if (scope.length === 0 || sameDirectory(scope, this.store.dir)) {
      return refuse("no-scope", {});
    }
    // AN EMPTY BODY IS A CLEAR, not a refusal, and the caller decides which it
    // meant by what it passed: `write("")` is unreachable from the live door,
    // which routes a present-but-blank field to `clear()`. A direct caller that
    // reaches here with nothing still gets the named, durable refusal.
    if (draft.length === 0) return refuse("empty", {});
    if (bytes > HANDOFF_MAX_BYTES) {
      return refuse("too-large", { bytes, limit: HANDOFF_MAX_BYTES });
    }
    if (draft.includes(WAKE_MARKER)) return refuse("forged-markers", { bytes });
    // THE BATTERY, on the handoff as on the page and the journal (SEAMS H). A
    // handoff is written in a hurry at the end of a session and is exactly the
    // kind of prose a token gets pasted into.
    const verdict = this.gate({ text: draft, handles: [], sessionId: `handoff:${session ?? ""}` });
    if (!verdict.ok) {
      return refuse(
        "gate-refused",
        { bytes, gate: verdict.gate, gateReason: verdict.reason },
        { gate: { gate: verdict.gate, reason: verdict.reason } },
      );
    }
    // THE GATE'S TEXT, and never the draft as a fallback. The first draft read
    // `verdict.text.length > 0 ? verdict.text : draft`, so a gate that ever
    // accepted a body that redacted down to NOTHING would have stored the
    // ORIGINAL, unredacted words — a trapdoor pointing the wrong way
    // (adversarial review MINOR-7). Unreachable today, because
    // `empty-after-redaction` refuses that case first; a latent hole in a
    // redaction path is worth one line whether or not anything can reach it.
    const text = verdict.text ?? draft;
    if (text.length === 0) return refuse("empty-after-gate", {});
    const redacted = text === draft ? null : { gate: "secrets", bytesBefore: bytes };
    bytes = byteLengthOf(text);

    const meta: Record<string, unknown> = {
      role: HANDOFF_ROLE,
      [HANDOFF_META_SCOPE]: scope,
      [HANDOFF_META_WRITTEN_ON]: this.store.today(),
      [HANDOFF_META_WRITTEN_DAY]: day,
      [HANDOFF_META_SESSION]: session,
    };
    const existing = findHandoffRow(this.store, scope);
    let id: string;
    let version: number;
    // THE STORE'S OWN REFUSALS ARE NAMED TOO. `put` and `revise` refuse inputs
    // of their own — a body that is whitespace or NUL only, a lone surrogate
    // (F5, the floor) — and an uncaught throw here would leave the caller a
    // thrown error and the owner no row, which is MAJOR-2's shape on a
    // different input. The store's verdict is the truth and is reported as
    // such rather than second-guessed: nothing here pre-strips a body to get
    // past a refusal that exists for a reason.
    try {
      if (existing === null) {
        id = this.store.put({
          type: "schema",
          kind: HANDOFF_KIND,
          title: handoffTitle(scope),
          body: text,
          meta,
          learnedOn: this.store.today(),
          // NOT protected, on purpose: this is the one standing row in the
          // store that is meant to be let go, and `protected` is what would
          // stop the prune from ever doing it.
        });
        version = 0;
      } else {
        id = existing;
        version = this.store.revise(id, {
          body: text,
          title: handoffTitle(scope),
          meta,
          reason: "handoff",
        });
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      return refuse("store-refused", { bytes, code: typeof code === "string" ? code : "UNKNOWN" });
    }
    // THE DWELL CLOCK, RESET. `store.revise` writes the body and a version row
    // and touches no physics column, so a row born on day 1 and rewritten on day
    // 200 still reads `lastUsedDay = 1` — dwell 199, strength under the floor,
    // and `pruneVerdict` archives a pointer that was written this morning.
    // Moving the clock to the write is what makes "a live pointer is never
    // pruned out from under the wake" true rather than hoped for.
    this.store.updatePhysics(id, { lastUsedDay: day });
    // A RACE'S LOSERS ARE RETIRED HERE, where a write for this scope is already
    // happening. `findHandoffRow` now picks the newest, so a duplicate is
    // already invisible to every read; archiving it is what stops it holding
    // the reserve open until it expires (adversarial review MINOR-8).
    for (const stale of duplicateHandoffRows(this.store, scope)) {
      if (stale === id) continue;
      try {
        this.store.archive(stale, "handoff-duplicate");
        this.emit("handoff.duplicate.retired", stale, {});
      } catch {
        /* a duplicate that will not archive is still not the one that is read */
      }
    }
    this.store.appendEvent({
      name: HANDOFF_WRITTEN_EVENT,
      day,
      ref: id,
      payload: {
        // THE SCOPE AS A LENGTH, never the path: telemetry is ids, counts,
        // bytes, reasons and flags, and a directory path is neither (store §5
        // G10). Which directory it was is on the row, where the owner reads it.
        session,
        bytes,
        version,
        created: existing === null,
        ...(redacted === null ? {} : { redacted: true, redactedBy: redacted.gate }),
        lifeDays: HANDOFF_LIFE_DAYS,
      },
    });
    this.emit(HANDOFF_WRITTEN_EVENT, id, {
      bytes,
      version,
      created: existing === null,
    });
    return {
      written: true,
      reason: existing === null ? "created" : "revised",
      id,
      version,
      bytes,
      gate: null,
      redacted,
      showsForDays: HANDOFF_LIFE_DAYS,
    };
  }

  /**
   * THE POINTER FOR THIS WAKE, or null. Pure — it writes nothing, so a caller
   * that finds no room can drop it without having claimed it was shown.
   */
  pointer(scope: string, day?: number): { block: string; handoff: Handoff } | null {
    const d = day ?? this.store.livedDay();
    const h = this.read(scope, d);
    if (h === null) return null;
    const block = pointerBlock(h, d);
    return block === null ? null : { block, handoff: h };
  }

  /**
   * The durable row a SHOWN pointer leaves — ONCE per directory per lived day.
   *
   * It was one row per wake, which is consistent with `wake.injected` and is
   * still the wrong shape for the one question the row exists to answer.
   * CONTRACT §8 names `handoff.shown`'s `ageDays` as the measurement that would
   * settle the fortnight; measured, 40 wakes of one session in one directory
   * wrote 40 rows (adversarial review MINOR-2), so that distribution would have
   * been dominated by a session re-waking rather than by distinct pickups.
   *
   * `dedupKey` is the store's own latch and returns 0 when it refuses a repeat,
   * so "recorded" and "already recorded today" stay tellable apart. The key is
   * the ROW's id and the lived day — never the directory, which is a path
   * (§5 G10).
   */
  noteShown(h: Handoff, opts: { bytes: number; session?: string | null; day?: number }): void {
    if (this.observer) {
      this.emit("handoff.observer.standdown", undefined, { site: "noteShown" });
      return;
    }
    const day = opts.day ?? this.store.livedDay();
    let seq = 0;
    try {
      seq = this.store.appendEvent({
        name: HANDOFF_SHOWN_EVENT,
        day,
        ref: h.id,
        dedupKey: `${HANDOFF_SHOWN_EVENT}:${h.id}:${day}`,
        payload: {
          session: opts.session ?? null,
          bytes: opts.bytes,
          ageDays: h.writtenDay === null ? null : day - h.writtenDay,
          version: h.version,
        },
      });
    } catch {
      /* a pointer that was shown and could not be logged was still shown */
    }
    this.emit(HANDOFF_SHOWN_EVENT, h.id, { bytes: opts.bytes, first: seq !== 0 });
  }

  /**
   * NO ROOM FOR THE POINTER at this ceiling — the documented one-boundary lag,
   * and a tripwire if it ever stops being temporary.
   *
   * It was ring-only, and `Counterpart.emit` pushes to an in-process ring while
   * every hook is its own process, so the exact shape the brief asked the
   * reviewer to hunt — "the pointer stops being delivered and nothing says so" —
   * was real for the whole lag window (adversarial review MINOR-1). It is a
   * REFUSAL row rather than a fourth event name: a cap turning the pointer away
   * is this mechanism working out loud, which is what `handoff.refused` already
   * means. Deduped per row per lived day, so a lag that lasts a day is one row
   * and a lag that lasts a fortnight is fourteen.
   */
  noteNoRoom(h: Handoff, opts: { bytes: number; budget: number; day?: number }): void {
    if (this.observer) return;
    const day = opts.day ?? this.store.livedDay();
    this.refuse(
      "no-room",
      { day, session: null, bytes: opts.bytes, budget: opts.budget },
      { id: h.id, version: null, gate: null, redacted: null, showsForDays: null },
      `${HANDOFF_REFUSED_EVENT}:no-room:${h.id}:${day}`,
      h.id,
    );
  }

  /**
   * CLEAR THIS DIRECTORY'S POINTER — the retirement that had no door.
   *
   * CONTRACT open question 3, closed: the ask fires up to six times a session,
   * so a session can write "half done" at the first and finish the work by the
   * last, and leaving the field out leaves the stale pointer standing for
   * whoever opens the directory next. A model that means "it is done" reaches
   * for `handoff: ""`, which used to be total silence (adversarial review
   * MAJOR-2b). A PRESENT but blank field is now this.
   *
   * The row is ARCHIVED, which is the ordinary means: the words stay readable
   * on the row for an owner who asks for it by id, every reader here filters
   * `archived: false` so the pointer is gone from the wake and from the
   * reserve, and the next handoff for this directory mints a fresh row rather
   * than reviving a retired one. An ABSENT field still means "leave what
   * stands"; that is the ordinary case and it is right.
   */
  clear(scope: string, opts: { session?: string | null; day?: number } = {}): HandoffWrite {
    const day = opts.day ?? this.store.livedDay();
    const session = opts.session ?? null;
    const none = { id: null, version: null, gate: null, redacted: null, showsForDays: null } as const;
    if (this.observer) {
      this.emit("handoff.observer.standdown", undefined, { site: "clear" });
      return { ...none, written: false, reason: "observer", bytes: 0 };
    }
    const trimmed = scope.trim();
    if (trimmed.length === 0 || sameDirectory(trimmed, this.store.dir)) {
      return this.refuse("no-scope", { day, session, bytes: 0 }, none);
    }
    const h = readHandoff(this.store, trimmed);
    if (h === null) {
      // NOTHING TO CLEAR is not a failure and not a silence: a session that
      // finished work in a directory that never had a pointer said something
      // true, and the row says so.
      return this.refuse("nothing-to-clear", { day, session, bytes: 0 }, none);
    }
    for (const id of [h.id, ...duplicateHandoffRows(this.store, trimmed)]) {
      this.store.archive(id, "handoff-cleared");
    }
    this.store.appendEvent({
      name: HANDOFF_CLEARED_EVENT,
      day,
      ref: h.id,
      payload: { session, bytes: h.bytes, version: h.version },
    });
    this.emit(HANDOFF_CLEARED_EVENT, h.id, { bytes: h.bytes });
    return { ...none, written: true, reason: "cleared", id: h.id, bytes: h.bytes };
  }

  /**
   * A NAMED REFUSAL FROM A DOOR, for the shapes this module cannot judge for
   * itself — today, a `handoff` field that is present and is not text. The
   * adapter knows what arrived on the wire; the durable row is still this
   * module's to write, so guarantee 3 has one owner.
   */
  refuseWrite(
    reason: HandoffRefusal,
    opts: { session?: string | null; day?: number } = {},
  ): HandoffWrite {
    const none = { id: null, version: null, gate: null, redacted: null, showsForDays: null } as const;
    if (this.observer) {
      this.emit("handoff.observer.standdown", undefined, { site: "refuseWrite" });
      return { ...none, written: false, reason: "observer", bytes: 0 };
    }
    return this.refuse(
      reason,
      { day: opts.day ?? this.store.livedDay(), session: opts.session ?? null, bytes: 0 },
      none,
    );
  }

  /** One refusal, one ring event and one durable row. Every named refusal in
   *  this module comes through here, which is what makes guarantee 3 checkable
   *  in one place rather than at six call sites. */
  private refuse(
    reason: HandoffRefusal,
    detail: { day: number; session: string | null; bytes: number } & Record<
      string,
      string | number | boolean | null
    >,
    base: Omit<HandoffWrite, "written" | "reason" | "bytes">,
    dedupKey?: string,
    ref?: string,
  ): HandoffWrite {
    const { day, ...payload } = detail;
    this.emit(HANDOFF_REFUSED_EVENT, ref, { reason, bytes: detail.bytes });
    try {
      this.store.appendEvent({
        name: HANDOFF_REFUSED_EVENT,
        day,
        ...(ref === undefined ? {} : { ref }),
        ...(dedupKey === undefined ? {} : { dedupKey }),
        payload: { reason, ...payload },
      });
    } catch {
      /* a refusal that cannot be recorded is still a refusal */
    }
    return { ...base, written: false, reason, bytes: detail.bytes };
  }
}

/**
 * Two directory strings naming the same place, for the one comparison this
 * module makes: is the scope the store's own directory? Canonicalisation is the
 * ADAPTER's (`adapters/sessions.ts#canonicalScope`), and both live callers do
 * it; this only has to survive a trailing slash.
 */
function sameDirectory(a: string, b: string): boolean {
  const norm = (s: string): string => s.replace(/\/+$/, "");
  return norm(a.trim()) === norm(b.trim());
}

/** The title the row carries, so every id-listing surface names it in words. */
export function handoffTitle(scope: string): string {
  return `Handoff — ${scope}`;
}

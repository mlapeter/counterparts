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
 * THE ROOM THE POINTER TAKES IN THE WAKE, in bytes — what `Counterpart` reserves
 * out of the compose budget at a boundary when the store holds a live handoff,
 * exactly as it reserves `PREFACE_RESERVE_BYTES` for the delivery preface.
 * Structural, not tunable, and measured rather than guessed: a test composes the
 * widest possible block (a full-width excerpt, the longest id, a six-digit day)
 * and asserts it fits under this.
 *
 * It is a RESERVE and not a lane cap because the pointer is spliced at DELIVERY,
 * after the bundle was composed: without the reserve, a store whose composition
 * already fills the ceiling would drop the pointer at every wake and the only
 * symptom would be `handoff.shown` going quiet.
 */
export const HANDOFF_RESERVE_BYTES = 448;

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
  | "too-large"
  | "forged-markers"
  | "gate-refused";

export interface HandoffWrite {
  readonly written: boolean;
  /** `created` or `revised` when written; the refusal's name otherwise. */
  readonly reason: HandoffRefusal | "created" | "revised";
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

/** A statement is a line here, as it is in the wake (`briefing.ts#flatten`). */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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

/** Every live handoff row in the store, whatever its scope. Ids only. */
export function handoffRows(store: Store): string[] {
  const out: string[] = [];
  for (const id of store.list({ type: "schema", kind: HANDOFF_KIND, archived: false })) {
    try {
      if (store.readProse(id).meta["role"] === HANDOFF_ROLE) out.push(id);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * THIS DIRECTORY'S row, live or expired, or null. There is at most one by
 * construction: `Handoffs.write` mints only when this returns null.
 *
 * Box 2 indexes type/kind/band/archived and has no meta query (`schemas/
 * INTERFACE-GAPS §2`), so the scope match is a prose read, exactly as
 * `findSelfPage` reads prose for the role.
 */
export function findHandoffRow(store: Store, scope: string): string | null {
  const want = scope.trim();
  if (want.length === 0) return null;
  for (const id of handoffRows(store)) {
    try {
      if (store.readProse(id).meta[HANDOFF_META_SCOPE] === want) return id;
    } catch {
      continue;
    }
  }
  return null;
}

/** The handoff as a value, or null. A row whose prose will not read is absent
 *  to every reader here, never a throw (`self/` §5 G7's rule, borrowed). */
export function readHandoff(store: Store, scope: string): Handoff | null {
  const id = findHandoffRow(store, scope);
  if (id === null) return null;
  let doc: ProseDoc;
  try {
    doc = store.readProse(id);
  } catch {
    return null;
  }
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
  return day - h.writtenDay > lifeDays;
}

// ── what the wake prints ────────────────────────────────────────────────────

/** The marker a cut excerpt ends with. Three bytes, and the cut reserves them. */
export const ELLIPSIS = "\u2026";

/** The first line of a handoff, flattened and cut to fit, with an ellipsis when
 *  it was cut. Cuts at a word where one is near the end, never mid-word when a
 *  space is within the last fifth of the room. */
export function excerpt(body: string, capBytes = HANDOFF_EXCERPT_BYTES): string {
  const first = flatten(body.split("\n").find((l) => l.trim().length > 0) ?? body);
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
  const left = h.writtenDay === null ? lifeDays : Math.max(0, lifeDays - (day - h.writtenDay));
  const days = left === 1 ? "1 more day" : `${left} more days`;
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
   * DOES ANY DIRECTORY HOLD A LIVE POINTER? The one question the boundary asks,
   * and the reason the reserve is conditional: a store that has never had a
   * handoff composes its wake to exactly the budget it composed before this
   * module existed, byte for byte.
   */
  anyLive(day?: number): boolean {
    const d = day ?? this.store.livedDay();
    for (const id of handoffRows(this.store)) {
      try {
        const doc = this.store.readProse(id);
        const written = doc.meta[HANDOFF_META_WRITTEN_DAY];
        if (typeof written === "number" && d - written <= HANDOFF_LIFE_DAYS) return true;
      } catch {
        continue;
      }
    }
    return false;
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
    ): HandoffWrite => {
      this.emit(HANDOFF_REFUSED_EVENT, undefined, { reason, ...detail });
      try {
        this.store.appendEvent({
          name: HANDOFF_REFUSED_EVENT,
          day,
          payload: { reason, session, ...detail },
        });
      } catch {
        /* a refusal that cannot be recorded is still a refusal */
      }
      return { ...none, written: false, reason, bytes, ...extra };
    };

    if (this.observer) {
      // The stand-down writes nothing at all, the durable row included: an
      // instrument that logged its own refusal would be changing the store it is
      // reading (observer-mode G3).
      this.emit("handoff.observer.standdown", undefined, { site: "write" });
      return { ...none, written: false, reason: "observer", bytes };
    }
    // NO SCOPE, NO POINTER. A handoff is about a place; a session whose host
    // named no directory has none to be about, and a pointer filed under the
    // store's own directory would be shown to every session everywhere.
    if (scope.length === 0) return refuse("no-scope", { bytes });
    if (draft.length === 0) return refuse("empty", { bytes: 0 });
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
    const text = verdict.text !== undefined && verdict.text.length > 0 ? verdict.text : draft;
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
    if (existing === null) {
      id = this.store.put({
        type: "schema",
        kind: HANDOFF_KIND,
        title: handoffTitle(scope),
        body: text,
        meta,
        learnedOn: this.store.today(),
        // NOT protected, on purpose: this is the one standing row in the store
        // that is meant to be let go, and `protected` is what would stop the
        // prune from ever doing it.
      });
      version = 0;
    } else {
      id = existing;
      version = this.store.revise(id, { body: text, title: handoffTitle(scope), meta, reason: "handoff" });
    }
    // THE DWELL CLOCK, RESET. `store.revise` writes prose and versions and
    // touches no physics column, so a row born on day 1 and rewritten on day 200
    // still reads `lastUsedDay = 1` — dwell 199, strength under the floor, and
    // `pruneVerdict` archives a pointer that was written this morning. Moving
    // the clock to the write is what makes "a live pointer is never pruned out
    // from under the wake" true rather than hoped for.
    this.store.updatePhysics(id, { lastUsedDay: day });
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

  /** The durable row a SHOWN pointer leaves. Called only once the bundle the
   *  session receives really carries it. */
  noteShown(h: Handoff, opts: { bytes: number; session?: string | null; day?: number }): void {
    if (this.observer) {
      this.emit("handoff.observer.standdown", undefined, { site: "noteShown" });
      return;
    }
    const day = opts.day ?? this.store.livedDay();
    try {
      this.store.appendEvent({
        name: HANDOFF_SHOWN_EVENT,
        day,
        ref: h.id,
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
    this.emit(HANDOFF_SHOWN_EVENT, h.id, { bytes: opts.bytes });
  }
}

/** The title the row carries, so every id-listing surface names it in words. */
export function handoffTitle(scope: string): string {
  return `Handoff — ${scope}`;
}

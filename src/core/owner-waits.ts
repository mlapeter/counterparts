/**
 * WHAT WAITS ON THE OWNER: RAISED, BACKED OFF, PARKED (SO1 step 4, revised;
 * Mike 11-07 12:04, all lightly held; `~/counterparts-notes/2026-11-07-briefs/SO1-still-open.md`).
 *
 * An item waiting on the owner is an open memory marked `asked` (the store's
 * own mark for a question to the owner), or a handoff whose lead waits on the
 * owner and that WK3 sank (`counterpart-wake-shape.ts#waitsOnOwner`, meta
 * `wake.handoff.led`). Before this, an `asked` item was never parked
 * (`self/identity.ts#carriesOpen`) and sat in every wake's "Still open"; a
 * sunk handoff sat below the others with no end date. Now:
 *
 *   - RAISED: shown to the owner, in a session someone attends (not a headless
 *     or agent run), as the wake's one mention. Each raise is recorded once per
 *     item per lived day, store-wide: the day latch is an event with a dedup
 *     key (`open.owner.raised:<id>:<day>`), so of two sessions racing for the
 *     same item one writes it; the chain (`wake.owner.raised` meta) is written
 *     only by the winner.
 *   - BACKED OFF: after each unanswered raise, wait `OWNER_RAISE_STEPS` lived
 *     days (3, then 7, then 14); the session-start mention also waits at least
 *     `OWNER_MENTION_EVERY` (a week) since the last raise.
 *   - PARKED: after the last step, the item parks: out of the wake, still
 *     listed (marked parked) under `recall "still open"`. Not closed.
 *   - ANSWERED: a revision of the item (its `revision`, a handoff's `version`)
 *     starts the chain again; an item no longer open is no longer a candidate
 *     at all, and its chain is dropped at the next raise written. An `asked`
 *     mark only decides which door says it (the mention, or a "Still open"
 *     line on the roads where `asked` items are lines).
 *   - STILL OPEN'S LINES (the putty, 2026-11-13): every open memory listed as a
 *     line of the lane is raised on the same chain (`noteLaneShown`), listed
 *     only on its steps (`laneState`, no week floor), and parks after the last.
 *     With no chain at all (an upgrade, or one the bound let go) an item
 *     untouched `OPEN_CARRY_DAYS` lived days is parked, a fresher one new.
 *
 * Meta and events only: no store-format change. Never throws: a chain that
 * won't read is an item never raised (it may be raised again), never one hidden.
 */
import { everydayFactor, informativeness } from "./recall/cues.js";
import { TUNABLES as RECALL_TUNABLES } from "./recall/tunables.js";
import { SELF_TUNABLES, WAKE_SHAPE_LIMITS as SHAPE } from "./self/tunables.js";
import { tokenize } from "./store/index.js";
import type { Store } from "./store/index.js";
import { stemTerm } from "./store/stem.js";

/** The meta key holding each item's raise chain: `{ [id]: { version, days, kind, scope? } }`. */
export const OWNER_RAISED_KEY = "wake.owner.raised";
/** The event one raise writes (ref the item; payload: session, version, kind, via, scope). Its dedup key is the day latch. */
export const OWNER_RAISED_EVENT = "open.owner.raised";

/** One item's raises at one version of it. */
export interface RaiseChain {
  /** The item's version the raises were made at: a `revision` (memory) or `version` (handoff). */
  readonly version: number;
  /** The lived days it was raised on, oldest first. */
  readonly days: readonly number[];
  readonly kind: "memory" | "handoff";
  readonly scope?: string;
}

type RaiseRecord = Record<string, RaiseChain>;

type ReadStore = Pick<Store, "getMeta">;

/** The whole record; `{}` when absent or unreadable. */
export function raiseRecord(store: ReadStore): RaiseRecord {
  try {
    const v = JSON.parse(store.getMeta(OWNER_RAISED_KEY) ?? "{}") as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as RaiseRecord) : {};
  } catch {
    return {};
  }
}

/** The lived days `id` was raised on at `version`: none when its chain is for another version (a revision answers). */
export function raisesAt(record: RaiseRecord, id: string, version: number): readonly number[] {
  const c = record[id];
  if (c === undefined || c.version !== version || !Array.isArray(c.days)) return [];
  return c.days.filter((d) => typeof d === "number" && Number.isFinite(d));
}

/** Where an item stands in its backoff on lived day `today`. */
export type WaitState =
  /** May be mentioned at session start today. */
  | { readonly kind: "due"; readonly raised: number }
  /** Raised, and waiting out its step (or the week, or today's latch). */
  | { readonly kind: "waiting"; readonly raised: number; readonly from: number }
  /** Every step waited out unanswered: out of the wake, listed parked. */
  | { readonly kind: "parked"; readonly raised: number };

/**
 * THE BACKOFF ITSELF, on one item's raise days. With n raises, the last on day
 * L: n = 0 is due; n at the last step parks once `today - L` reaches that
 * step; otherwise it is due once `today - L` reaches the larger of its step
 * and the week (`OWNER_MENTION_EVERY`). Raised today: waiting, whatever the
 * steps (the shared day latch). Pure.
 */
export function waitState(days: readonly number[], today: number, steps: readonly number[] = SHAPE.OWNER_RAISE_STEPS, every: number = SHAPE.OWNER_MENTION_EVERY): WaitState {
  const raised = days.length;
  if (raised === 0) return { kind: "due", raised };
  const last = Math.max(...days);
  const step = steps[Math.min(raised, steps.length) - 1] ?? 0;
  const gone = today - last;
  if (raised >= steps.length) return gone >= step ? { kind: "parked", raised } : { kind: "waiting", raised, from: last + step };
  const wait = Math.max(step, every, 1);
  return gone >= wait ? { kind: "due", raised } : { kind: "waiting", raised, from: last + wait };
}

/**
 * "STILL OPEN"'S LINES FOLLOW THE SAME SCHEDULE (2026-11-13, the putty: a
 * counterpart's own open questions were listed in every wake, and one subject
 * was raised 11 times in 10 days). An open memory listed as one of the lane's
 * lines is a raise (`noteLaneShown`), on the SAME chain and record as the turn
 * lane's and the wake's mention, and is listed again only when the turn lane's
 * steps let it through (3, 7, 14 lived days, no weekly floor), then parks.
 * Listed all of the day it was raised on (the day latch), so every wake that
 * day says it. Pure.
 */
export type LaneState = "list" | "waiting" | "parked";

export function laneState(days: readonly number[], today: number, steps: readonly number[] = SHAPE.OWNER_RAISE_STEPS): LaneState {
  if (days.includes(today)) return "list";
  const st = waitState(days, today, steps, 0);
  return st.kind === "due" ? "list" : st.kind;
}

/**
 * THE OPEN THREADS WITH NO CHAIN THAT COUNT AS PARKED (review of #819): an
 * open memory never raised at its current version (an upgrade, or a chain the
 * record's bound let go) and untouched `OPEN_CARRY_DAYS` lived days or more
 * (`Store#openThreadTouches`, the carry rule's own reading of a touch). Only a
 * fresher one is "new". Decided at read time: no flag, no migration. Without
 * this a store with hundreds of old open items would list a different few as
 * new every day for weeks. Dated items are left to their date; an `asked` one
 * is raised first (the carry rule never parks it either). Never throws.
 */
function unchainedParked(store: Pick<Store, "openThreadTouches" | "today">, record: RaiseRecord, today: number, rows: (id: string) => { readonly revision: number; readonly band?: string | null } | undefined): Set<string> {
  const out = new Set<string>();
  try {
    for (const f of store.openThreadTouches({ at: store.today() })) {
      // An `asked` one is raised first, on any road (its mention, or its line), then backs off: never parked unseen.
      if (f.dated || f.asked || today - f.touchedDay < SELF_TUNABLES.OPEN_CARRY_DAYS) continue;
      const row = rows(f.id);
      // A core memory being reconsidered keeps its own rule.
      if (row === undefined || row.band === "identity" || raisesAt(record, f.id, row.revision).length > 0) continue;
      out.add(f.id);
    }
  } catch {
    /* none: listed, never hidden */
  }
  return out;
}

/**
 * What holds an open memory out of "Still open"'s lines on lived day `today`:
 * "waiting" (raised, its step not yet waited out: counted as more open),
 * "parked" (every step waited out, or never raised and untouched a fortnight:
 * `unchainedParked`), or null (listed). One record read for all. The caller
 * exempts what keeps its own rule (a dated item, a core memory being
 * reconsidered). Never throws: unreadable is listed, never hidden.
 */
export function laneHeld(store: Pick<Store, "getMeta" | "row" | "openThreadTouches" | "today">, today: number): (id: string) => "waiting" | "parked" | null {
  let record: RaiseRecord = {};
  try {
    record = raiseRecord(store);
  } catch {
    record = {};
  }
  const old = unchainedParked(store, record, today, (id) => store.row(id));
  return (id) => {
    try {
      if (old.has(id)) return "parked";
      if (record[id] === undefined) return null;
      const row = store.row(id);
      if (row === undefined) return null;
      const st = laneState(raisesAt(record, id, row.revision), today);
      return st === "list" ? null : st;
    } catch {
      return null;
    }
  };
}

/**
 * RECORD THE LANE'S LINES AS RAISED (the putty, 2026-11-13): each id a
 * delivered wake listed under "Still open" that is an open memory with no date
 * of its own and not a core memory being reconsidered, through `noteRaised`
 * (`via: "lane"`), so the day latch dedups it with any other raise that day.
 * The caller has decided the wake was delivered to a session (not a night's
 * own run, not observer). How many it raised. Never throws.
 */
export function noteLaneShown(store: Pick<Store, "appendEvent" | "getMeta" | "setMeta" | "row" | "readProse" | "openThreadIds">, ids: readonly string[], at: { readonly day: number; readonly session: string }): number {
  let n = 0;
  for (const id of new Set(ids)) {
    try {
      const row = store.row(id);
      if (row === undefined || row.type !== "memory" || row.band === "identity" || row.archived !== 0) continue;
      const doc = store.readProse(id);
      if (doc.meta["unresolved"] !== true || (doc.eventDate !== undefined && doc.eventDate.trim() !== "")) continue;
      // Only a showing the schedule lets through counts: a bundle composed on an
      // earlier day may still list one waiting its step, which is no step taken.
      if (laneState(raisesAt(raiseRecord(store), id, row.revision), at.day) !== "list") continue;
      if (noteRaised(store, { id, version: row.revision, kind: "memory", scope: row.origin_scope ?? null }, { day: at.day, session: at.session, via: "lane" })) n += 1;
    } catch {
      /* not raised: listed again, never hidden */
    }
  }
  return n;
}

/**
 * THE OPEN MEMORIES PARKED BY THE BACKOFF on lived day `today`: their chain is
 * at the row's current `revision` and every step is waited out. Any status
 * since the putty (2026-11-13): a lane line raised to the end parks as an
 * `asked` item does. And an item with no chain that is a fortnight untouched
 * and not `asked` (`unchainedParked`). Read by "Still open" (the wake and the handle), which lists them
 * parked. Never throws.
 */
export function ownerParked(store: Pick<Store, "getMeta" | "row" | "openThreadTouches" | "today">, today: number): ReadonlySet<string> {
  const out = new Set<string>();
  try {
    const record = raiseRecord(store);
    for (const id of unchainedParked(store, record, today, (x) => store.row(x))) out.add(id);
    for (const [id, c] of Object.entries(record)) {
      if (c.kind !== "memory") continue;
      const row = store.row(id);
      if (row === undefined) continue;
      if (waitState(raisesAt({ [id]: c }, id, row.revision), today).kind === "parked") out.add(id);
    }
  } catch {
    /* nothing parked: shown, never hidden */
  }
  return out;
}

/**
 * RECORD ONE RAISE: the day latch first (an event whose dedup key is the item
 * and the lived day), and the chain only when this call wrote it. True when
 * this call raised it. A raise at a new version starts the chain again. The
 * caller has already decided the session is attended and the line was shown.
 * Never throws.
 */
export function noteRaised(
  store: Pick<Store, "appendEvent" | "getMeta" | "setMeta" | "openThreadIds">,
  item: { readonly id: string; readonly version: number; readonly kind: "memory" | "handoff"; readonly scope?: string | null },
  at: { readonly day: number; readonly session: string; readonly via: "wake" | "turn" | "lane" },
): boolean {
  try {
    const seq = store.appendEvent({
      name: OWNER_RAISED_EVENT,
      day: at.day,
      ref: item.id,
      dedupKey: `${OWNER_RAISED_EVENT}:${item.id}:${String(at.day)}`,
      payload: { session: at.session, version: item.version, kind: item.kind, via: at.via, ...(item.scope ? { scope: item.scope } : {}) },
    });
    if (seq <= 0) return false;
    const was = raiseRecord(store);
    const before = raisesAt(was, item.id, item.version);
    const { [item.id]: _old, ...rest } = was;
    const chain: RaiseChain = { version: item.version, days: [...before, at.day], kind: item.kind, ...(item.scope ? { scope: item.scope } : {}) };
    // A memory no longer open has nothing left to raise: its chain goes (review
    // of #819: kept, closed items' chains pushed a parked item's out, and it came
    // back as new). Then, past the bound, the oldest go; one let go that is a
    // fortnight untouched reads as parked (`unchainedParked`), not new.
    let open: ReadonlySet<string> | null = null;
    try {
      open = new Set(store.openThreadIds());
    } catch {
      open = null;
    }
    const live = Object.entries(rest).filter(([id, c]) => open === null || c.kind !== "memory" || open.has(id));
    const kept = live.slice(-(SHAPE.OWNER_RAISES_KEPT - 1));
    store.setMeta(OWNER_RAISED_KEY, JSON.stringify(Object.fromEntries([...kept, [item.id, chain]])));
    return true;
  } catch {
    return false;
  }
}

// ── what a turn touches (the relevance lane's match, round 3 of #796) ──────────

/**
 * One item's words, each by its index term with its weight (rarity × how
 * un-everyday it is), and which of them are SUBJECT words: weighing at least
 * `OWNER_TURN_SUBJECT`, or, with the embedder's word table loaded, a word the
 * table holds no whole-word row for (a name, a tool, jargon: "npm"), over the
 * floor. A turn has to share one of these (round 4 of #796: "want" and "talk"
 * clear the floor, and together raised an item about wanting to talk).
 */
export interface TermWeights {
  readonly w: Readonly<Record<string, number>>;
  readonly subject: readonly string[];
}

/** No words. */
export const NO_TERMS: TermWeights = { w: {}, subject: [] };

/** A text's index terms (`stem.ts#stemTerm`), each with the surface forms it came from, as recall's cue step reads a turn. */
export function termsOf(text: string, minLength: number = RECALL_TUNABLES.MIN_CUE_LENGTH): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const tok of tokenize(text)) {
    if (tok.length < minLength) continue;
    const key = stemTerm(tok);
    const forms = out.get(key);
    if (forms === undefined) out.set(key, [tok]);
    else if (!forms.includes(tok)) forms.push(tok);
  }
  return out;
}

/**
 * WEIGH ITEMS' WORDS AS RECALL WEIGHS A CUE: the store's document frequency
 * (`informativeness`, the IDF recall's `cue` step reads, so a word in most
 * memories is worth about nothing and no stoplist is needed), scaled by the
 * embedder's everyday factor (`everydayFactor`; 1 with no table). ONE
 * `docFrequency` read for every text's words together. Never throws:
 * unreadable is {} for each.
 */
export function weighMany(store: Pick<Store, "docFrequency" | "countMemories" | "wordNorm">, texts: readonly string[], size?: number): TermWeights[] {
  try {
    const each = texts.map((t) => termsOf(t));
    const keys = new Set<string>();
    for (const terms of each) for (const forms of terms.values()) keys.add(forms.join(" "));
    if (keys.size === 0) return texts.map(() => NO_TERMS);
    const n = size ?? store.countMemories({ archived: false });
    const df = store.docFrequency([...keys]);
    // Is the word table there at all? Without it every word reads as un-tabled, and only weight makes a subject word.
    const table = store.wordNorm("the") !== null;
    const norm = new Map<string, number | null>();
    return each.map((terms) => {
      const out: Record<string, number> = {};
      const subject: string[] = [];
      for (const [key, forms] of terms) {
        const surface = forms[0] ?? key;
        if (!norm.has(surface)) norm.set(surface, store.wordNorm(surface));
        const raw = norm.get(surface) ?? null;
        const w = informativeness(df.get(forms.join(" ")) ?? 0, n) * everydayFactor(raw, RECALL_TUNABLES);
        if (!(w > 0)) continue;
        out[key] = w;
        if (w >= SHAPE.OWNER_TURN_SUBJECT || (table && raw === null && w >= SHAPE.OWNER_TURN_WORD_FLOOR)) subject.push(key);
      }
      return { w: out, subject };
    });
  } catch {
    return texts.map(() => NO_TERMS);
  }
}

/** One text's weighed words (`weighMany` of one). */
export function weighTerms(store: Pick<Store, "docFrequency" | "countMemories" | "wordNorm">, text: string, size?: number): TermWeights {
  return weighMany(store, [text], size)[0] ?? NO_TERMS;
}

/** What a turn's terms share with an item's: how many words at or over `OWNER_TURN_WORD_FLOOR`, and their summed weight; the `aside` terms (the owner's name) count for nothing. */
export function sharedWeight(item: TermWeights, turn: ReadonlySet<string>, aside: ReadonlySet<string> = new Set()): { n: number; sum: number; subject: boolean } {
  let n = 0;
  let sum = 0;
  const subject = (item.subject ?? []).some((k) => turn.has(k) && !aside.has(k));
  for (const [k, w] of Object.entries(item.w ?? {})) {
    // A word below the floor is one most memories hold: it counts for nothing, not even towards `n`.
    if (aside.has(k) || !turn.has(k) || w < SHAPE.OWNER_TURN_WORD_FLOOR) continue;
    n += 1;
    sum += w;
  }
  return { n, sum, subject };
}

/** A turn touches an item: at least `OWNER_TURN_SHARED` shared words, together weighing `OWNER_TURN_WEIGHT`, one of them a subject word. */
export function touches(s: { n: number; sum: number; subject: boolean }): boolean {
  return s.subject && s.n >= SHAPE.OWNER_TURN_SHARED && s.sum >= SHAPE.OWNER_TURN_WEIGHT;
}

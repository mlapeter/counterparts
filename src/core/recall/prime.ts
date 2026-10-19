/**
 * CONTEXT PRIMING — an experiment, 2026-10-19 (check ~10-22, two lived days
 * after install; revert by setting `PRIME_LINK_UNITS` and `PRIME_TRAIN_SHARE`
 * to 0, or by reverting the PR). Brief:
 * `~/counterparts-notes/2026-10-19-context-priming-brief.md`.
 *
 * Walk into the kitchen and kitchen things come to mind more easily. Until
 * this, ambient recall started from zero every turn — this prompt's words and
 * meaning only, no train of thought. Trying a head start for memories
 * connected to what the session is doing, to see whether they win the close
 * calls they should (primed footnotes rated more useful than unprimed) without
 * the same cluster winning turn after turn. The downward half of the loop
 * #523/#525 opened upward.
 *
 * **What primes (sources).** What this session USED (credited at the
 * referenced, engaged or useful tier: opened, quoted, named in `drewOn`, rated
 * 2–3 at an earlier boundary — `GateState.credited`), what it WROTE (the echo
 * set, #523: never shown back, but its older neighbours are warmed), and what
 * is OPEN in this folder (the open threads this session's wake listed, and
 * this directory's live handoffs), read once a session. Not the self page.
 *
 * **How it travels.** Along LINKS: each source passes its decayed edge weight
 * × its own weight × `PRIME_LINK_UNITS` cue units to each linked partner, one
 * hop (`PartnersFn`, injected at the composition root — `recall/` imports no
 * neighbour). Along MEANING: a running vector of this session's prompts,
 * decayed by turn (`PRIME_TRAIN_DECAY`), with each source's vector folded in
 * once when it first counts — the train of thought. A candidate close to it
 * gets `PRIME_TRAIN_SHARE` of what this turn's own meaning would give at the
 * same cosine. The train is scored against the turn's candidates only (a
 * vector read each), never ranked over the store, so its cost does not grow
 * with the store.
 *
 * **How strong, and its limits** (`activate.ts`, `gate.ts`). Priming adds to a
 * candidate's activation, before the cut, so it can lift a memory into the cut
 * and past the turn's bar — but only a candidate this turn's words or meaning
 * already reached (cue + semantic > 0), at most `PRIME_CEILING` times what they
 * gave it, never a memory this session wrote (the echo set is never a target),
 * and never past the absolute floors (they are checked on the activation
 * without it). It is kept out of the turn's background, as a stamp is, so a
 * primed cluster does not raise every other candidate's bar. Out of
 * `cueFraction` both halves, as hops are. Habituation's raised bar applies
 * after it, unchanged. A first prompt with nothing open here primes nothing.
 *
 * **State.** Per session, in gate state (box 2's `gate_session`, kind
 * `prime`) — no store-format change: `train` holds the running vector, which
 * sources were folded in and when, and whether the folder was read; `wake`
 * holds the threads this session's wake listed, written by the host at the
 * wake. The train is derived from what the person typed, so it is emptied in a
 * session idle past the retention ceiling, as carried cues are
 * (`session.ts#clearIdleCarries`).
 */
import type { UseTier } from "../physics/index.js";
import type { Store } from "../store/index.js";
import { RATED_EVENT_NAME } from "./habituation.js";
import type { GateState } from "./session.js";
import type { RecallTunables } from "./tunables.js";

/** The `gate_session.kind` priming owns. `loadGateState` never reads it. */
export const PRIME_KIND = "prime";
/** The running train of thought. */
export const TRAIN_REF = "train";
/** The open threads this session's wake listed. */
export const WAKE_OPEN_REF = "wake";
export const PRIME_STATE_VERSION = 1;

export type PrimeSourceKind = "used" | "wrote" | "open";

/** Credit tiers that mean this session USED a memory (not a glimpse, not "on topic"). */
export const USED_TIERS: ReadonlySet<UseTier> = new Set<UseTier>(["referenced", "engaged", "useful"]);

/** Ids → each one's live linked partners with the edge's DECAYED weight (one hop). */
export type PartnersFn = (ids: readonly string[], day: number) => ReadonlyMap<string, readonly { id: string; weight: number }[]>;

/** What is open in this folder, read once a session: memory ids (link and
 *  meaning sources) and texts' vectors that are not memories (a handoff). */
export interface OpenHere {
  readonly ids: readonly string[];
  readonly vectors: readonly (readonly number[])[];
}

/**
 * The turn's priming input, set by `Counterpart#recallForTurn` and by nothing
 * on the deliberate path. Absent: priming does not run.
 */
export interface PrimeInput {
  /** This turn's own vector (its stripped text), the train's next step. Null: no embedder. */
  readonly vector?: readonly number[] | null;
  /** One hop along links (`Associate#partnersOf`). Absent: the link channel is dark. */
  readonly partners?: PartnersFn;
  /** What is open here — called only on a turn the folder has not yet been read. */
  readonly open?: () => OpenHere;
}

/** The train, as kept between turns. */
export interface TrainState {
  /** The session's served turn when it was saved. */
  readonly turn: number;
  /** The embedder box 3 recorded when it was saved; a different one discards `vec`. */
  readonly identity: string | null;
  readonly vec: number[] | null;
  /** Each source first counted on which turn, and as what. */
  readonly seen: ReadonlyMap<string, { turn: number; kind: PrimeSourceKind }>;
  /** The folder has been read for this session. */
  readonly open: boolean;
}

interface TrainPayload {
  v: number;
  turn: number;
  identity: string | null;
  vec: number[];
  seen: Record<string, [number, PrimeSourceKind]>;
  open: boolean;
  /** When saved, wall-clock ms: the idle clear reads it. */
  at: number;
}

/** How much of a text the train embeds: the head, as the in-line rank clips (`session.ts`). */
export const PRIME_TEXT_CHARS = 2000;

/** A rating at or above this is a use, as a source (2 "useful background", 3 "changed what I said"). */
export const USED_MIN_SCORE = 2;

/** This session's ratings, the last score per id, from its `recall.rated` rows (indexed by session). Never throws. */
function sessionRatings(store: Store, sessionId: string): Map<string, number> {
  const out = new Map<string, number>();
  try {
    for (const row of store.eventLog({ name: RATED_EVENT_NAME, ref: sessionId, order: "asc" })) {
      const p = JSON.parse(row.payload ?? "null") as { ratings?: unknown } | null;
      if (p === null || !Array.isArray(p.ratings)) continue;
      for (const r of p.ratings as { id?: unknown; score?: unknown }[]) {
        if (typeof r?.id === "string" && typeof r.score === "number") out.set(r.id, r.score);
      }
    }
  } catch {
    /* unread ratings prime nothing */
  }
  return out;
}

/** At most this many `seen` entries kept, newest first: a bound, not a knob. */
const SEEN_MAX = 200;
/** Train components are kept to this many decimals: ~2 KB a row at 256 dims. */
const VEC_DECIMALS = 5;

export function loadTrain(store: Store, sessionId: string): TrainState | null {
  try {
    const row = store.gateRecords(sessionId, PRIME_KIND).find((r) => r.ref === TRAIN_REF);
    if (row === undefined || row.value === null || row.value === undefined) return null;
    const p = JSON.parse(row.value) as Partial<TrainPayload> | null;
    if (p === null || typeof p !== "object" || p.v !== PRIME_STATE_VERSION) return null;
    const seen = new Map<string, { turn: number; kind: PrimeSourceKind }>();
    for (const [id, pair] of Object.entries(p.seen ?? {})) {
      if (Array.isArray(pair) && typeof pair[0] === "number" && (pair[1] === "used" || pair[1] === "wrote" || pair[1] === "open")) {
        seen.set(id, { turn: pair[0], kind: pair[1] });
      }
    }
    const vec = Array.isArray(p.vec) && p.vec.length > 0 && p.vec.every((x) => typeof x === "number" && Number.isFinite(x)) ? p.vec : null;
    return {
      turn: typeof p.turn === "number" ? p.turn : row.turn,
      identity: typeof p.identity === "string" ? p.identity : null,
      vec,
      seen,
      open: p.open === true,
    };
  } catch {
    return null;
  }
}

export function saveTrain(store: Store, sessionId: string, state: TrainState, lastDay: number): void {
  const seen = [...state.seen].sort((a, b) => b[1].turn - a[1].turn).slice(0, SEEN_MAX);
  const k = 10 ** VEC_DECIMALS;
  const payload: TrainPayload = {
    v: PRIME_STATE_VERSION,
    turn: state.turn,
    identity: state.identity,
    vec: (state.vec ?? []).map((x) => Math.round(x * k) / k),
    seen: Object.fromEntries(seen.map(([id, s]) => [id, [s.turn, s.kind] as [number, PrimeSourceKind]])),
    open: state.open,
    at: store.now(),
  };
  store.setGateRecords([{ sessionId, kind: PRIME_KIND, ref: TRAIN_REF, turn: state.turn, lastDay, value: JSON.stringify(payload) }]);
}

/** The host's record of the open threads this session's wake listed. A gate write: an observer's store refuses it. */
export function noteWakeOpen(store: Store, sessionId: string, ids: readonly string[], lastDay: number): void {
  store.setGateRecords([
    { sessionId, kind: PRIME_KIND, ref: WAKE_OPEN_REF, turn: 0, lastDay, value: JSON.stringify({ v: PRIME_STATE_VERSION, ids: [...ids] }) },
  ]);
}

/** The open threads this session's wake listed; empty when none were recorded. Never throws. */
export function wakeOpenIds(store: Store, sessionId: string): string[] {
  try {
    const row = store.gateRecords(sessionId, PRIME_KIND).find((r) => r.ref === WAKE_OPEN_REF);
    if (row === undefined || typeof row.value !== "string") return [];
    const p = JSON.parse(row.value) as { v?: unknown; ids?: unknown } | null;
    if (p === null || p.v !== PRIME_STATE_VERSION || !Array.isArray(p.ids)) return [];
    return p.ids.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

/** What `activate()` takes: the link head starts (raw, before units), the train, who may not be primed. */
export interface PrimeActivation {
  /** Partner id → Σ source weight × decayed edge weight, and which kinds of source sent it. */
  readonly link: ReadonlyMap<string, { readonly weight: number; readonly from: ReadonlySet<PrimeSourceKind> }>;
  /** The train of thought this turn is primed by (not unit length), or null. */
  readonly train: readonly number[] | null;
  /** Never primed: what this session wrote (the echo set). */
  readonly exclude: ReadonlySet<string>;
}

export interface PrimePlan {
  readonly activation: PrimeActivation;
  /** How many sources of each kind counted this turn — "on, nothing primed" vs "off". */
  readonly sources: { used: number; wrote: number; open: number };
  /** The train to save at the record step (this turn's prompt added). */
  readonly next: TrainState;
}

function unit(v: readonly number[]): number[] | null {
  let n = 0;
  for (const x of v) n += x * x;
  if (!(n > 0) || !Number.isFinite(n)) return null;
  const s = 1 / Math.sqrt(n);
  return v.map((x) => x * s);
}

function addInto(acc: number[] | null, v: readonly number[], w: number): number[] | null {
  if (acc === null) return v.map((x) => x * w);
  if (acc.length !== v.length) return acc;
  for (let i = 0; i < acc.length; i++) acc[i] = (acc[i] as number) + w * (v[i] as number);
  return acc;
}

/** Cosine of two vectors; 0 on a dimension mismatch or a zero vector. */
export function cosine(a: readonly number[], b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * The turn's priming, PLANNED: reads only (the train row, box-3 vectors of new
 * sources, the folder once, the partners' edges). Nothing is written here;
 * `next` is saved by the record step, so a latency abort leaves the train as
 * it was (recall §5 G2).
 */
export function planPrime(input: {
  store: Store;
  sessionId: string;
  state: GateState;
  turnNo: number;
  day: number;
  echo: ReadonlySet<string> | undefined;
  prime: PrimeInput;
  t: RecallTunables;
}): PrimePlan {
  const { store, state, turnNo, t } = input;
  let identity: string | null = null;
  try {
    identity = store.rankingIdentity();
  } catch {
    identity = null;
  }
  const prev = loadTrain(store, input.sessionId);
  const sameModel = prev !== null && (prev.identity === null || identity === null || prev.identity === identity);
  // The saved train, decayed for any turn it missed (an aborted or failed save).
  const missed = prev === null ? 0 : Math.max(0, state.turn - prev.turn);
  let train: number[] | null =
    prev !== null && sameModel && prev.vec !== null ? prev.vec.map((x) => x * t.PRIME_TRAIN_DECAY ** missed) : null;

  const seen = new Map(prev?.seen ?? []);
  /** This turn's sources: id → kind. A memory written here AND used counts as written. */
  const current = new Map<string, PrimeSourceKind>();
  for (const [id, c] of Object.entries(state.credited)) if (USED_TIERS.has(c.tier)) current.set(id, "used");
  // And what it RATED 2–3, read off its rating rows: physics refuses a use on
  // a memory's birth day, which leaves no credit record, but the session still
  // said the memory mattered. The last score for an id counts.
  for (const [id, score] of sessionRatings(store, input.sessionId)) {
    if (score >= USED_MIN_SCORE) current.set(id, "used");
  }
  for (const id of input.echo ?? []) current.set(id, "wrote");
  for (const [id, s] of seen) if (s.kind === "open" && !current.has(id)) current.set(id, "open");

  // THE FOLDER, ONCE: the wake's open threads and this directory's handoffs.
  let openRead = prev?.open === true;
  const openVectors: (readonly number[])[] = [];
  if (!openRead && input.prime.open !== undefined) {
    openRead = true;
    try {
      const here = input.prime.open();
      for (const id of here.ids) if (!current.has(id)) current.set(id, "open");
      openVectors.push(...here.vectors);
    } catch {
      /* an unread folder primes nothing */
    }
  }

  // New sources count from this turn; their meaning joins the train once.
  const fresh: { id: string; kind: PrimeSourceKind }[] = [];
  for (const [id, kind] of current) {
    if (!seen.has(id)) {
      seen.set(id, { turn: turnNo, kind });
      fresh.push({ id, kind });
    }
  }
  const W = t.PRIME_SOURCE_WEIGHT;
  if (t.PRIME_TRAIN_SHARE > 0) {
    let folded: number[] | null = null;
    let mass = 0;
    for (const { id, kind } of fresh.slice(0, t.PRIME_MAX_SOURCES)) {
      const v = store.vectorOf(id);
      const u = v === null ? null : unit(v);
      if (u === null) continue;
      folded = addInto(folded, u, W[kind]);
      mass += W[kind];
    }
    for (const v of openVectors) {
      const u = unit(v);
      if (u === null) continue;
      folded = addInto(folded, u, W.open);
      mass += W.open;
    }
    // A turn's new sources together weigh at most one prompt in the train.
    const fu = folded === null ? null : unit(folded);
    if (fu !== null) train = addInto(train, fu, Math.min(1, mass));
  }

  // The live sources, newest first, each weighted and decayed by its age in turns.
  const live = [...current]
    .map(([id, kind]) => ({ id, kind, turn: seen.get(id)?.turn ?? turnNo }))
    .sort((a, b) => b.turn - a.turn || (a.id < b.id ? -1 : 1))
    .slice(0, t.PRIME_MAX_SOURCES);
  const link = new Map<string, { weight: number; from: Set<PrimeSourceKind> }>();
  if (t.PRIME_LINK_UNITS > 0 && input.prime.partners !== undefined && live.length > 0) {
    let partners: ReadonlyMap<string, readonly { id: string; weight: number }[]> = new Map();
    try {
      partners = input.prime.partners(
        live.map((s) => s.id),
        input.day,
      );
    } catch {
      partners = new Map();
    }
    for (const s of live) {
      const w = W[s.kind] * t.PRIME_SOURCE_DECAY ** Math.max(0, turnNo - s.turn);
      if (!(w > 0)) continue;
      for (const p of partners.get(s.id) ?? []) {
        if (!(p.weight > 0) || p.id === s.id) continue;
        const had = link.get(p.id) ?? { weight: 0, from: new Set<PrimeSourceKind>() };
        had.weight += w * p.weight;
        had.from.add(s.kind);
        link.set(p.id, had);
      }
    }
  }

  const sources = { used: 0, wrote: 0, open: 0 };
  for (const s of live) sources[s.kind] += 1;

  // The next step: this turn's prompt joins at weight 1, everything before it decays.
  const own = input.prime.vector === undefined || input.prime.vector === null ? null : unit(input.prime.vector);
  let nextVec: number[] | null = train === null ? null : train.map((x) => x * t.PRIME_TRAIN_DECAY);
  if (own !== null) nextVec = nextVec !== null && nextVec.length !== own.length ? own : addInto(nextVec, own, 1);

  return {
    activation: { link, train, exclude: input.echo ?? new Set<string>() },
    sources,
    next: { turn: turnNo, identity, vec: nextVec, seen, open: openRead },
  };
}

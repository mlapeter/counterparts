/**
 * `/api/mechanism?id=<id>` — what the home page's mechanism panel shows for the
 * picked mechanism: its last few firings, narrated, and a small picture of THIS
 * store's real data where the site shows a demo.
 *
 *   decay            — the fade curves of a few real memories, from their last use
 *   retrieval        — the last turns that brought memories to mind, and whether
 *                      each one has been used since
 *   consolidation    — memories climbing toward the core, and how far each has to go
 *   salience         — recent memories and the score each was written with
 *   association      — the graph hubs: what the most is wired to
 *   reconsolidation  — recent corrections weighed against old memories
 *
 * A grey mechanism (not built) gets no picture and no activity: it has none.
 * Which rows count as a firing is `MECHANISM_PROOFS`, in `mechanisms.ts`.
 *
 * Read-only, like everything in this directory. Memory words go through
 * `reveal`, so a confidential row is withheld here exactly as everywhere else.
 */
import { TUNABLES, promotionEligibility, strength } from "../../../../core/physics/index.js";
import { isJournal } from "../../../../core/sleep/index.js";
import type { EventRow } from "../../../../core/store/index.js";
import type { Band, Kind } from "../../../../core/types.js";
import type { DashboardSource } from "../../source.js";
import { narrate } from "../narrate.js";
import type { NarratedEvent } from "../narrate.js";
import { reveal, revealHere } from "../reveal.js";
import { MECHANISM_PROOFS, amount, payloadOf } from "./mechanisms.js";
import { census } from "./shared.js";
import type { MemoryLine } from "./shared.js";

/** How many narrated firings the panel lists. */
export const PANEL_ACTIVITY = 4;
/** How far back, per event name, the panel looks for them. */
const ACTIVITY_LOOKBACK = 200;
/** How many lived days ahead a fade curve is drawn. */
export const FADE_AHEAD = 60;
/** How many lived days behind "now" a fade curve may start. */
export const FADE_BEHIND = 60;

interface Said {
  readonly id: string;
  readonly text: string;
  readonly confidential: boolean;
}

function said(src: DashboardSource, id: string, width = 72): Said {
  const r = reveal(src.store, id, width);
  return { id, text: r.text ?? r.label, confidential: r.confidential };
}

function saidLine(m: MemoryLine): Said {
  return { id: m.id, text: m.text, confidential: m.confidential };
}

export interface FadeCurve extends Said {
  readonly kind: Kind;
  readonly band: Band;
  readonly lastUsedDay: number;
  readonly now: number;
  /** [lived day, strength] pairs, one per day, from the curve's start. */
  readonly points: readonly (readonly [number, number])[];
  /** The first lived day ahead on which it falls below the archive line, if unused. */
  readonly archiveDay: number | null;
}

export type Picture =
  | {
      readonly kind: "decay";
      readonly day: number;
      readonly from: number;
      readonly to: number;
      /** Below this a memory drops out of the semantic band. */
      readonly semanticFloor: number;
      /** Below this a memory can be archived. */
      readonly archiveLine: number;
      readonly curves: readonly FadeCurve[];
    }
  | {
      readonly kind: "retrieval";
      readonly turns: readonly {
        readonly seq: number;
        readonly day: number;
        readonly turn: number;
        readonly memories: readonly (Said & { readonly said: boolean; readonly usedSince: boolean })[];
      }[];
    }
  | {
      readonly kind: "consolidation";
      readonly threshold: number;
      readonly requiredDays: number;
      readonly climbing: readonly (Said & { readonly base: number; readonly days: number })[];
      readonly promoted: readonly (Said & { readonly day: number })[];
      readonly core: number;
    }
  | {
      readonly kind: "salience";
      readonly memories: readonly (Said & { readonly salience: number; readonly bornDay: number; readonly memKind: Kind })[];
    }
  | {
      readonly kind: "association";
      readonly hubs: readonly (Said & { readonly weight: number; readonly degree: number })[];
      readonly links: number;
    }
  | {
      readonly kind: "reconsolidation";
      readonly revisions: readonly {
        readonly seq: number;
        readonly day: number;
        readonly target: Said;
        readonly challenger: Said;
        readonly pressure: number;
        readonly bar: number;
        readonly crossed: boolean;
      }[];
    };

export interface MechanismPanelView {
  readonly id: string;
  readonly found: boolean;
  readonly built: boolean;
  readonly livedDay: number;
  /** The newest few rows that count as this mechanism firing, narrated. */
  readonly activity: readonly NarratedEvent[];
  /** Null for a grey mechanism, and for a built one with no picture of its own. */
  readonly picture: Picture | null;
}

export function mechanismPanel(src: DashboardSource, id: string): MechanismPanelView {
  const store = src.store;
  const livedDay = store.livedDay();
  const proof = MECHANISM_PROOFS.find((m) => m.id === id);
  if (proof === undefined) return { id, found: false, built: false, livedDay, activity: [], picture: null };
  if (!proof.built) return { id, found: true, built: false, livedDay, activity: [], picture: null };

  const backing: EventRow[] = [];
  for (const p of proof.proofs) {
    for (const row of store.eventLog({ name: p.event, order: "desc", limit: ACTIVITY_LOOKBACK })) {
      if (amount(p, payloadOf(row)) > 0) backing.push(row);
    }
  }
  const seen = new Set<number>();
  const activity = backing
    .sort((a, b) => b.seq - a.seq)
    .filter((r) => (seen.has(r.seq) ? false : (seen.add(r.seq), true)))
    .slice(0, PANEL_ACTIVITY)
    .map((r) => narrate(store, r));

  return { id, found: true, built: true, livedDay, activity, picture: pictureOf(src, id, livedDay) };
}

function pictureOf(src: DashboardSource, id: string, day: number): Picture | null {
  switch (id) {
    case "decay":
      return decayPicture(src, day);
    case "retrieval":
      return retrievalPicture(src);
    case "consolidation":
      return consolidationPicture(src);
    case "salience":
      return saliencePicture(src);
    case "association":
      return associationPicture(src);
    case "reconsolidation":
      return reconsolidationPicture(src);
    default:
      return null;
  }
}

// ── forgetting ──────────────────────────────────────────────────────────────

/**
 * Up to four real memories, spread across how strong they are today — the
 * strongest one that can still fade, the faintest, and two between — each drawn
 * from its last use to sixty lived days ahead, as the physics computes it. The
 * core identity band does not fade, so it is left out rather than drawn flat.
 */
function decayPicture(src: DashboardSource, day: number): Picture {
  const store = src.store;
  const fading = census(src).filter((m) => !m.schema && !m.promoted && !m.unreadable);
  const picks: MemoryLine[] = [];
  if (fading.length <= 4) picks.push(...fading);
  else {
    for (const q of [0, 0.35, 0.7, 1]) {
      const m = fading[Math.round(q * (fading.length - 1))];
      if (m !== undefined && !picks.includes(m)) picks.push(m);
    }
  }
  const to = day + FADE_AHEAD;
  let from = day;
  const curves: FadeCurve[] = picks.map((m) => {
    const physics = store.physicsOf(m.id);
    const start = Math.max(physics.lastUsedDay, day - FADE_BEHIND);
    from = Math.min(from, start);
    const points: [number, number][] = [];
    let archiveDay: number | null = null;
    for (let d = start; d <= to; d++) {
      const s = strength(physics, d);
      points.push([d, round(s)]);
      if (archiveDay === null && d > day && s < TUNABLES.PHI_PRUNE) archiveDay = d;
    }
    return { ...saidLine(m), kind: m.kind, band: m.band, lastUsedDay: physics.lastUsedDay, now: round(m.strength), points, archiveDay };
  });
  return {
    kind: "decay",
    day,
    from,
    to,
    semanticFloor: TUNABLES.THETA_SEM,
    archiveLine: TUNABLES.PHI_PRUNE,
    curves,
  };
}

// ── retrieval ───────────────────────────────────────────────────────────────

function idsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") out.push(item);
    else if (item !== null && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
      out.push((item as { id: string }).id);
    }
  }
  return out;
}

/**
 * The last few turns that brought anything to mind: what was said out loud and
 * what was kept as a footnote, and whether each memory has been USED since —
 * read off the memory's own physics (its last credited use is on or after that
 * turn's day, and after its birth), not guessed from the turn.
 */
function retrievalPicture(src: DashboardSource): Picture {
  const store = src.store;
  const turns: Extract<Picture, { kind: "retrieval" }>["turns"][number][] = [];
  for (const row of store.eventLog({ name: "recall.decision", order: "desc", limit: ACTIVITY_LOOKBACK })) {
    const p = payloadOf(row);
    const surfaced = idsOf(p["surfaced"]);
    const footnotes = idsOf(p["footnotes"]);
    if (surfaced.length + footnotes.length === 0) continue;
    const memories = [
      ...surfaced.map((id) => ({ id, said: true })),
      ...footnotes.map((id) => ({ id, said: false })),
    ].slice(0, 6).map(({ id, said: aloud }) => {
      let usedSince = false;
      try {
        const physics = store.physicsOf(id);
        usedSince = physics.lastUsedDay >= row.day && physics.lastUsedDay > physics.birthDay;
      } catch {
        usedSince = false;
      }
      return { ...said(src, id, 64), said: aloud, usedSince };
    });
    const turn = typeof p["turn"] === "number" ? p["turn"] : 0;
    turns.push({ seq: row.seq, day: row.day, turn, memories });
    if (turns.length >= 3) break;
  }
  return { kind: "retrieval", turns };
}

// ── consolidation ───────────────────────────────────────────────────────────

/**
 * Becoming core takes two things at once: a strong enough base, and real use on
 * three separate lived days. Each climber shows both, against the bar; the
 * nearest six are listed, with the last few that made it.
 */
function consolidationPicture(src: DashboardSource): Picture {
  const store = src.store;
  const rows = census(src).filter((m) => !m.schema && !m.unreadable);
  const core = rows.filter((m) => m.promoted).length;
  const climbing = rows
    .filter((m) => !m.promoted)
    .map((m) => {
      const v = promotionEligibility(store.physicsOf(m.id));
      const progress = Math.min(1, v.base / v.threshold) + Math.min(1, v.reinforcedDays / v.requiredDays);
      return { m, base: v.base, days: v.reinforcedDays, progress };
    })
    .sort((a, b) => b.progress - a.progress || (a.m.id < b.m.id ? -1 : 1))
    .slice(0, 6)
    .map((c) => ({ ...saidLine(c.m), base: round(c.base), days: c.days }));
  const promoted = store
    .eventLog({ name: "band.promoted", order: "desc", limit: 3 })
    .filter((r) => r.ref !== null)
    .map((r) => ({ ...said(src, r.ref as string), day: r.day }));
  return {
    kind: "consolidation",
    threshold: TUNABLES.THETA_ID,
    requiredDays: TUNABLES.N_PROMOTION_DAYS,
    climbing,
    promoted,
    core,
  };
}

// ── salience ────────────────────────────────────────────────────────────────

/** The most recent memories, newest first, with the score each was written with. */
function saliencePicture(src: DashboardSource): Picture {
  const memories = census(src)
    .filter((m) => !m.schema && !m.unreadable)
    .sort((a, b) => b.bornDay - a.bornDay || (a.id < b.id ? -1 : 1))
    .slice(0, 8)
    .map((m) => ({ ...saidLine(m), salience: round(m.salience), bornDay: m.bornDay, memKind: m.kind }));
  return { kind: "salience", memories };
}

// ── association ─────────────────────────────────────────────────────────────

/** The graph hubs: what the most is wired to, by summed link weight. */
function associationPicture(src: DashboardSource): Picture {
  const store = src.store;
  const weight = new Map<string, { w: number; d: number }>();
  let links = 0;
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || isJournal(row)) continue;
    for (const edge of store.edgesFrom(id)) {
      links += 1;
      for (const end of [id, edge.dst]) {
        const cur = weight.get(end) ?? { w: 0, d: 0 };
        cur.w += edge.weight;
        cur.d += 1;
        weight.set(end, cur);
      }
    }
  }
  const hubs = [...weight.entries()]
    .sort((a, b) => b[1].w - a[1].w || (a[0] < b[0] ? -1 : 1))
    .slice(0, 6)
    .map(([id, v]) => ({ ...said(src, id), weight: round(v.w), degree: v.d }));
  return { kind: "association", hubs, links };
}

// ── reconsolidation ─────────────────────────────────────────────────────────

/**
 * The last few corrections weighed against an old memory: which memory argued,
 * with which one, and how far the pressure is toward the bar it would take to
 * change it. The target is read AS IT STOOD (unfollowed), like the feed does.
 */
function reconsolidationPicture(src: DashboardSource): Picture {
  const store = src.store;
  const revisions = store.eventLog({ name: "revision.pressure", order: "desc", limit: 5 }).map((row) => {
    const p = payloadOf(row);
    const targetId = typeof p["targetId"] === "string" ? p["targetId"] : (row.ref ?? "");
    const challengerId = typeof p["challengerId"] === "string" ? p["challengerId"] : "";
    const here = revealHere(store, targetId, 72);
    const pressure = typeof p["pressureAfter"] === "number" ? p["pressureAfter"] : 0;
    const bar = typeof p["bar"] === "number" ? p["bar"] : 0;
    return {
      seq: row.seq,
      day: row.day,
      target: { id: targetId, text: here.text ?? here.label, confidential: here.confidential },
      challenger: said(src, challengerId),
      pressure: round(pressure),
      bar: round(bar),
      crossed: bar > 0 && pressure >= bar,
    };
  });
  return { kind: "reconsolidation", revisions };
}

function round(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0;
}


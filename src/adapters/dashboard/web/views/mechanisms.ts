/**
 * `/api/mechanisms` — the eleven memory mechanisms the site names, each with a
 * light: grey (not built), green (built, and fired in the last 7 LIVED days),
 * amber (built, and not firing).
 *
 * The list, its order and its four families are the site's
 * (`counterparts-site/features/home-v2/content/regions.ts`, minus the two it
 * parks). What each one says about Counterparts lives beside the page, in
 * `web/mechanisms/<id>/index.js`; this file owns only the one question the page
 * cannot answer for itself: did it fire, and which rows say so.
 *
 * BUILT OR NOT comes from `docs/research/mechanism-audit-2026-09-24.md`, not
 * from the site's "in development" badge — the two disagree on consolidation
 * (site: in development; audit: built, narrow) and association (site: in
 * development; audit: built but starved). The light answers "does the code
 * run", so it takes the audit's word; the badge stays the site's, on the
 * client module.
 *
 * Read-only, like everything in this directory: `eventLog` reads and nothing
 * else. Rules 1–4 of `views.ts` apply; no row text is emitted, only counts and
 * event `seq`s the page can open with `/api/event`.
 */
import type { EventRow } from "../../../../core/store/index.js";
import type { DurableEventName } from "../../registries.js";
import type { DashboardSource } from "../../source.js";

/** The window: today's lived day and the six before it. */
export const MECHANISM_DAYS = 7;
/** How many backing event seqs each mechanism hands the page. */
export const RECENT_IDS = 3;
/** Ceiling on one name's read inside the window — reported, never silent. */
const WINDOW_CEILING = 50_000;
/** How far back an amber row looks for "last seen", newest first. */
const LOOKBACK = 500;

export type Family = "encoding" | "storage" | "retrieval" | "transformation";
export const FAMILIES: readonly Family[] = ["encoding", "storage", "retrieval", "transformation"];

type Payload = Record<string, unknown>;

/** One kind of row that proves a mechanism fired. */
interface Proof {
  readonly event: DurableEventName;
  /** What a unit of it is, after the number — [one, many]:
   *  ["memory archived at the floor", "memories archived at the floor"]. */
  readonly says: readonly [string, string];
  /** Sum this numeric payload field instead of counting rows; a row whose
   *  field is not a number above zero does not count at all (the `positive`
   *  rule of `adapters/fired.ts`: a row that lands whether or not the
   *  mechanism did anything is not a firing). */
  readonly sum?: string;
  /** Only rows this accepts count. */
  readonly where?: (p: Payload) => boolean;
}

interface MechanismProof {
  readonly id: string;
  readonly family: Family;
  /** Per the audit. A mechanism that is not built is grey and never counted. */
  readonly built: boolean;
  /** Empty when not built. */
  readonly proofs: readonly Proof[];
  /** For a grey light: the one plain line it shows instead of evidence. */
  readonly grey?: string;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// ── THE TABLE ───────────────────────────────────────────────────────────────
// One row per mechanism, in the site's order. Read it top to bottom: what
// counts as the mechanism firing, in the rows the store already keeps.
export const MECHANISM_PROOFS: readonly MechanismProof[] = [
  // ── Encoding ──
  {
    // Salience writes no row of its own: the score is columns on the memory.
    // Every memory is scored at the gate, so the gate's row IS the scoring.
    id: "salience",
    family: "encoding",
    built: true,
    proofs: [
      { event: "gate.deposit", sum: "accepted", says: ["memory scored as it was written", "memories scored as they were written"] },
      { event: "gate.chunk", sum: "accepted", says: ["memory scored from a crash write-up", "memories scored from a crash write-up"] },
    ],
  },
  {
    // The quoted feeling is stored as a label with no weight, the classifier
    // ships off, and the numeric emotional score rides the salience columns —
    // there is no row that could say "feeling changed this memory".
    id: "emotional",
    family: "encoding",
    built: false,
    proofs: [],
    grey: "In development: a feeling is stored as a label but does not yet weigh anything.",
  },
  // ── Storage ──
  {
    id: "decay",
    family: "storage",
    built: true,
    proofs: [
      { event: "band.transition", where: (p) => p["site"] === "decay", says: ["memory faded a band", "memories faded a band"] },
      { event: "memory.pruned", says: ["memory archived at the floor", "memories archived at the floor"] },
      // The entity-card fade has no row of its own; it is a count on the
      // nightly cycle row, so only nights that faded something count.
      { event: "sleep.cycle", sum: "faded", says: ["unused card faded", "unused cards faded"] },
    ],
  },
  {
    // Only byte-identical bodies merge (that is consolidation's, below); two
    // near-duplicates are left alone on purpose. Nothing competes.
    id: "interference",
    family: "storage",
    built: false,
    proofs: [],
    grey: "In development: similar memories do not compete yet.",
  },
  // ── Retrieval ──
  {
    id: "retrieval",
    family: "retrieval",
    built: true,
    proofs: [
      {
        event: "recall.decision",
        where: (p) => num(p["surfacedCount"]) + num(p["footnoteCount"]) > 0,
        says: ["turn brought memories to mind", "turns brought memories to mind"],
      },
      { event: "mcp.recall", says: ["deliberate look-up", "deliberate look-ups"] },
      { event: "recall.credit", sum: "credited", says: ["memory strengthened by being used", "memories strengthened by being used"] },
    ],
  },
  {
    // Built but starved (audit): links form only between memories used in
    // the same turn, and a hop only boosts what the turn already reached. A
    // flush that wrote no link rows is not a firing.
    id: "association",
    family: "retrieval",
    built: true,
    proofs: [{ event: "associate.flush", sum: "rows", says: ["link written", "links written"] }],
  },
  {
    // `prospective.fire` exists and only the demo seeder calls `fire()`: no
    // live path spends the budget, so the rows prove nothing about real use.
    id: "prospective",
    family: "retrieval",
    built: false,
    proofs: [],
    grey: "In development: dated reminders can be stored, but nothing brings them back on the day yet.",
  },
  // ── Transformation ──
  {
    // Narrow (audit): only exact duplicates merge, promotion needs a high score
    // and use on three separate days, and it runs every three lived days.
    // The cycle row itself is NOT a proof: it lands every night regardless.
    id: "consolidation",
    family: "transformation",
    built: true,
    proofs: [
      { event: "band.promoted", says: ["memory became core", "memories became core"] },
      { event: "memory.merged", says: ["exact duplicate merged", "exact duplicates merged"] },
      { event: "band.transition", where: (p) => p["site"] === "consolidate", says: ["memory rose a band", "memories rose a band"] },
    ],
  },
  {
    // Partial (audit): it revises only what a writer declared with `updates:`,
    // for beliefs and identity lines, under pressure over several days. The
    // supersede itself (`memory.superseded`) is not durable; the pressure row is.
    id: "reconsolidation",
    family: "transformation",
    built: true,
    proofs: [{ event: "revision.pressure", says: ["correction weighed against an old memory", "corrections weighed against old memories"] }],
  },
  {
    // A band label only; nothing distils episodes into knowledge.
    id: "episodic-semantic",
    family: "transformation",
    built: false,
    proofs: [],
    grey: "In development: sessions do not turn into general knowledge yet.",
  },
  {
    // Beliefs have no live producer (`addBelief` is called only by the demo
    // seeder). `revision.pressure` is shared with reconsolidation above and is
    // counted there, not here.
    id: "schema",
    family: "transformation",
    built: false,
    proofs: [],
    grey: "In development: beliefs about people and projects are not formed yet.",
  },
];

export type MechanismStatus = "grey" | "green" | "amber";

export interface MechanismLight {
  readonly id: string;
  readonly family: Family;
  readonly status: MechanismStatus;
  /** One plain-English line. */
  readonly evidence: string;
  /** The newest few event `seq`s that back a green light. Empty otherwise. */
  readonly events: readonly number[];
}

export interface MechanismsView {
  readonly livedDay: number;
  /** The first lived day inside the window. */
  readonly fromDay: number;
  readonly days: number;
  readonly mechanisms: readonly MechanismLight[];
  /** A read hit its ceiling, so some counts are floors. */
  readonly truncated: boolean;
}

function payloadOf(row: EventRow): Payload {
  if (row.payload === null) return {};
  try {
    const v: unknown = JSON.parse(row.payload);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Payload) : {};
  } catch {
    return {};
  }
}

/** The amount this row contributes, or 0 when it does not count. */
function amount(proof: Proof, p: Payload): number {
  if (proof.where !== undefined && !proof.where(p)) return 0;
  if (proof.sum === undefined) return 1;
  const v = num(p[proof.sum]);
  return v > 0 ? v : 0;
}

export function mechanismsView(src: DashboardSource): MechanismsView {
  const store = src.store;
  let livedDay = 0;
  try {
    livedDay = store.livedDay();
  } catch {
    livedDay = 0;
  }
  const fromDay = Math.max(0, livedDay - (MECHANISM_DAYS - 1));
  let truncated = false;
  // One read per event name, shared by every proof that names it.
  const windowRows = new Map<string, EventRow[]>();
  const rowsFor = (name: string): EventRow[] => {
    let rows = windowRows.get(name);
    if (rows === undefined) {
      rows = store.eventLog({ name, sinceDay: fromDay, limit: WINDOW_CEILING, order: "desc" });
      if (rows.length >= WINDOW_CEILING) truncated = true;
      windowRows.set(name, rows);
    }
    return rows;
  };

  const mechanisms = MECHANISM_PROOFS.map((m): MechanismLight => {
    if (!m.built) {
      return { id: m.id, family: m.family, status: "grey", evidence: m.grey ?? "Not built yet.", events: [] };
    }
    const parts: string[] = [];
    const backing: EventRow[] = [];
    for (const proof of m.proofs) {
      let total = 0;
      for (const row of rowsFor(proof.event)) {
        const n = amount(proof, payloadOf(row));
        if (n > 0) {
          total += n;
          backing.push(row);
        }
      }
      if (total > 0) parts.push(`${total} ${total === 1 ? proof.says[0] : proof.says[1]}`);
    }
    if (parts.length > 0) {
      const events = backing
        .sort((a, b) => b.seq - a.seq)
        .slice(0, RECENT_IDS)
        .map((r) => r.seq);
      return { id: m.id, family: m.family, status: "green", evidence: `${parts.join(", ")} in the last ${MECHANISM_DAYS} lived days.`, events };
    }
    // Built, and nothing inside the window: when was it last seen at all? Only
    // the newest LOOKBACK rows of each name are searched, so a name with that
    // many non-counting rows since its last real firing reads "no record" —
    // acceptable for a scaffold; a real "last fired" wants its own query.
    let lastDay: number | null = null;
    for (const proof of m.proofs) {
      for (const row of store.eventLog({ name: proof.event, order: "desc", limit: LOOKBACK })) {
        if (amount(proof, payloadOf(row)) > 0) {
          if (lastDay === null || row.day > lastDay) lastDay = row.day;
          break;
        }
      }
    }
    const evidence =
      lastDay === null
        ? `Built, and no record of it firing yet.`
        : `Built, but quiet for ${MECHANISM_DAYS} lived days (last fired on lived day ${lastDay}).`;
    return { id: m.id, family: m.family, status: "amber", evidence, events: [] };
  });

  return { livedDay, fromDay, days: MECHANISM_DAYS, mechanisms, truncated };
}

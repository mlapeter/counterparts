/**
 * `/api/memory` — one memory, opened.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { band, rep, sal, strength } from "../../../../core/physics/index.js";
import { isJournal } from "../../../../core/sleep/index.js";
import type { Band, Kind } from "../../../../core/types.js";
import type { DashboardSource } from "../../source.js";
import { WITHHELD, gistOfDoc, reveal } from "../reveal.js";

// ─────────────────────────────────────────────────────────────────────────────
// one memory, opened
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryDetail {
  readonly found: boolean;
  readonly id: string;
  readonly headId: string | null;
  readonly askedFor: string | null;
  /**
   * True when this row is a JOURNAL entry rather than a memory. It matters on
   * an inspection surface: an episode is the source a memory was made from, it
   * sits outside every sleep phase, and the physics below it is recorded but
   * never acted on. Printing its strength without saying that would invite the
   * owner to read a number the engine ignores.
   */
  readonly journal: boolean;
  readonly title: string;
  readonly text: string;
  readonly confidential: boolean;
  /**
   * Which record this is — the revision it is on, and the hash of the text
   * above.
   *
   * This pair replaced the memory file's path in the modal's subtitle. The path
   * named a filesystem layout, and a store is not its layout: what identifies a
   * memory is its id, and what identifies THIS reading of it is the revision and
   * the hash. The id the copy button hands over is `id`.
   *
   * `contentHash` is blank when the body is withheld — see below.
   */
  readonly revision: number;
  readonly contentHash: string;
  readonly kind: Kind;
  readonly band: Band;
  readonly recordedBand: string;
  readonly strength: number;
  readonly salience: { relevance: number; emotional: number; predictive: number; novelty: number | null; claimed: number | null; combined: number };
  readonly repetition: number;
  readonly uses: number;
  readonly reinforcedDays: number;
  readonly bornDay: number;
  readonly lastUsedDay: number;
  readonly learnedOn: string;
  readonly happenedOn: string | null;
  readonly consolidated: boolean;
  readonly promoted: boolean;
  readonly protected: boolean;
  readonly pressure: number;
  readonly bar: number | null;
  readonly archived: string | null;
  readonly removal: { stage: string; actor: string; reason: string | null; at: number }[];
  readonly edges: { id: string; text: string; weight: number; confidential: boolean }[];
  readonly points: { role: string; id: string; text: string }[];
  readonly versions: { seq: number; reason: string; day: number; became: string }[];
  readonly prospective: { date: string; state: string; fires: number; precision: string }[];
  readonly absence: string | null;
}

export function memoryDetail(src: DashboardSource, id: string): MemoryDetail {
  const store = src.store;
  const day = store.livedDay();
  const r = reveal(store, id, 120);
  const empty = {
    found: false,
    id,
    headId: r.headId,
    askedFor: null,
    journal: false,
    title: "",
    text: "",
    confidential: false,
    revision: 0,
    contentHash: "",
    kind: "fact" as Kind,
    band: "episodic" as Band,
    recordedBand: "—",
    strength: 0,
    salience: { relevance: 0, emotional: 0, predictive: 0, novelty: null, claimed: null, combined: 0 },
    repetition: 0,
    uses: 0,
    reinforcedDays: 0,
    bornDay: 0,
    lastUsedDay: 0,
    learnedOn: "—",
    happenedOn: null,
    consolidated: false,
    promoted: false,
    protected: false,
    pressure: 0,
    bar: null,
    archived: null,
    removal: store.removalRecord(id).map((x) => ({ stage: x.stage, actor: x.actor, reason: x.reason, at: x.at })),
    edges: [],
    points: [],
    versions: [],
    prospective: [],
    absence: r.label,
  } satisfies MemoryDetail;

  if (!r.present || r.headId === null) return empty;
  const headId = r.headId;
  let doc;
  let row;
  let physics;
  try {
    doc = store.readProse(headId);
    row = store.row(headId);
    physics = store.physicsOf(headId);
  } catch {
    return empty;
  }
  const g = gistOfDoc(doc, 120);

  const points: { role: string; id: string; text: string }[] = [];
  const push = (role: string, target: unknown): void => {
    if (typeof target !== "string") return;
    const rr = reveal(store, target, 80);
    points.push({ role, id: target, text: rr.text ?? rr.label });
  };
  if (row?.superseded_by !== null && row?.superseded_by !== undefined) push("became", row.superseded_by);
  push("hangs on", doc.meta["entityId"]);
  push("revised", doc.meta["updates"]);
  const grounded = doc.meta["groundedIn"];
  if (Array.isArray(grounded)) for (const gid of grounded) push("grounded in", gid);

  return {
    found: true,
    id: headId,
    headId,
    askedFor: headId === id ? null : id,
    journal: row === undefined ? false : isJournal(row),
    title: doc.title ?? "",
    // The BODY is the memory, and this is the owner's own window onto their own
    // store (constitution line 6). A confidential body is the one exception, and
    // it is withheld here exactly as it is withheld in recall.
    text: g.confidential ? WITHHELD : doc.body.trim(),
    confidential: g.confidential,
    revision: row?.revision ?? 0,
    // A hash of a withheld body is a derivative of withheld text, on the one
    // surface whose job is withholding it. It is a confirmation oracle for an
    // exactly-guessed secret rather than a way to recover one, but this is the
    // wrong place to be interesting. The modal renders `""` as `—`.
    contentHash: g.confidential ? "" : (row?.content_hash ?? ""),
    kind: physics.kind,
    band: band(physics, day),
    recordedBand: `${row?.band ?? "—"} (set day ${row?.band_day ?? "—"})`,
    strength: strength(physics, day),
    salience: {
      relevance: physics.salience.relevance,
      emotional: physics.salience.emotional,
      predictive: physics.salience.predictive,
      novelty: physics.salience.novelty,
      claimed: physics.salience.claimed ?? null,
      combined: sal(physics.salience),
    },
    repetition: rep(physics),
    uses: physics.uses,
    reinforcedDays: physics.reinforcedDays ?? 0,
    bornDay: physics.birthDay,
    lastUsedDay: physics.lastUsedDay,
    learnedOn: doc.learnedOn,
    happenedOn: doc.happenedOn ?? null,
    consolidated: physics.consolidated === true,
    promoted: physics.promotedIdentity === true,
    protected: physics.protected === true,
    pressure: physics.pressure,
    bar: physics.pressure > 0 ? barFor(src, headId) : null,
    archived: row?.archived === 1 ? (row.archived_reason ?? "archived") : null,
    removal: store.removalRecord(headId).map((x) => ({ stage: x.stage, actor: x.actor, reason: x.reason, at: x.at })),
    edges: store.edgesFrom(headId).map((edge) => {
      const rr = reveal(store, edge.dst, 72);
      return { id: edge.dst, text: rr.text ?? rr.label, weight: edge.weight, confidential: rr.confidential };
    }),
    points,
    versions: store.versions(headId).map((v) => ({
      seq: v.seq,
      reason: v.reason,
      day: v.version_day,
      became: v.successor_id === null ? "revised in place" : (reveal(store, v.successor_id, 72).label),
    })),
    prospective: store.prospectiveFor(headId).map((p) => ({
      date: p.event_date,
      state: p.state,
      fires: p.fires,
      precision: p.precision,
    })),
    absence: null,
  };
}

function barFor(src: DashboardSource, id: string): number | null {
  try {
    return src.schemas.story(id).bar;
  } catch {
    return null;
  }
}

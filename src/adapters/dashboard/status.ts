/**
 * `status` — the brain at a glance, in the brain's own voice.
 *
 * This is the view the totality guarantee is really about (CONTRACT §3/§5 [M]).
 * Three registries are enumerated here and every member of each gets a line:
 * every KIND physics knows, every BAND, every PHASE of the cycle. A member with
 * nothing to report prints an absence marker rather than vanishing, because a
 * vanished row reads as "quiet" and quiet is how v1's starved curation path hid
 * for months (scar §2.17).
 *
 * Narration is first person and plain (CONTRACT §3, "narration in the system's
 * own voice") — the owner's fastest read is a sentence, not a legend.
 *
 * One honesty constraint shapes the cycle block. There is no durable per-cycle
 * outcome record: `CycleReport` is returned to its caller and then gone, and the
 * promotion / prune / merge records live under meta keys nothing can enumerate
 * (`INTERFACE-GAPS.md` §2). What IS durable is each phase's completion marker and
 * each row's archived-with-reason state. So the phase table carries the per-cycle
 * truth — *which lived day did this last finish* — and the exit counts are
 * labelled SINCE BIRTH. A number invented to look like "last cycle" would be scar
 * §2.17 committed by the very view that exists to prevent it.
 */
import { strength } from "../../core/physics/index.js";
import { TUNABLES as SCHEMA_TUNABLES } from "../../core/schemas/index.js";
import {
  MARKER_UNSET,
  MERGE_ARCHIVE_REASON,
  PRUNE_ARCHIVE_REASON,
  readMarker,
} from "../../core/sleep/index.js";
import type { Band, Kind } from "../../core/types.js";
import { PLAIN } from "./ansi.js";
import type { Style } from "./ansi.js";
import {
  NEVER,
  NONE,
  heading,
  indent,
  meter,
  num,
  plural,
  stack,
  subheading,
  table,
} from "./layout.js";
import { BANDS, CYCLE_PHASES, KINDS, countBy } from "./registries.js";
import { contestedBeliefs } from "./stories.js";
import type { DashboardSource } from "./source.js";

export interface StatusOptions {
  readonly style?: Style;
}

interface Tally {
  readonly byKind: Map<Kind, number>;
  readonly byBand: Map<Band, number>;
  readonly meanStrength: Map<Kind, number>;
  readonly exits: Map<string, number>;
  promoted: number;
  guarded: number;
  /** Rows carrying pressure right now. */
  contested: number;
  /** Beliefs that have EVER taken a credited challenge — a different question. */
  everContested: number;
  live: number;
  archived: number;
}

function tally(src: DashboardSource, day: number): Tally {
  const store = src.store;
  const out: Tally = {
    byKind: new Map(),
    byBand: new Map(),
    meanStrength: new Map(),
    exits: new Map(),
    promoted: 0,
    guarded: 0,
    contested: 0,
    everContested: contestedBeliefs(src).length,
    live: 0,
    archived: 0,
  };
  const strengths = new Map<Kind, number[]>();

  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined) continue;
    if (row.archived === 1) {
      out.archived += 1;
      const reason = row.archived_reason ?? "no reason recorded";
      out.exits.set(reason, (out.exits.get(reason) ?? 0) + 1);
      continue;
    }
    out.live += 1;
    out.byKind.set(row.kind, (out.byKind.get(row.kind) ?? 0) + 1);
    out.byBand.set(row.band, (out.byBand.get(row.band) ?? 0) + 1);
    if (row.promoted_identity === 1) out.promoted += 1;
    if (row.protected === 1) out.guarded += 1;
    if (row.pressure > 0) out.contested += 1;
    try {
      const list = strengths.get(row.kind) ?? [];
      list.push(strength(store.physicsOf(id), day));
      strengths.set(row.kind, list);
    } catch {
      // A row whose physics will not read is not worth failing a glance over.
    }
  }
  for (const [kind, list] of strengths) {
    out.meanStrength.set(kind, list.reduce((a, b) => a + b, 0) / Math.max(1, list.length));
  }
  return out;
}

export function renderStatus(src: DashboardSource, opts: StatusOptions = {}): string {
  const style = opts.style ?? PLAIN;
  const day = src.store.livedDay();
  const t = tally(src, day);
  const lastActive = src.store.getMeta("lastActiveDate") ?? "";

  const opening =
    `I have lived ${plural(day, "day")}` +
    (lastActive === "" ? "" : ` — the last of them ${lastActive}`) +
    ". " +
    (t.live + t.archived === 0
      ? "I am holding nothing yet."
      : `I am holding ${plural(t.live, "memory", "memories")}` +
        (t.archived === 0 ? "." : `, and ${t.archived} more sit archived.`));

  return stack(
    heading("What I am, right now", style),
    opening,
    kindBlock(t, style),
    bandBlock(t, style),
    cycleBlock(src, day, style),
    keepBlock(t, style),
    briefingBlock(src, style),
  );
}

// ── by kind ──────────────────────────────────────────────────────────────────

function kindBlock(t: Tally, style: Style): string {
  const peak = Math.max(1, ...KINDS.map((k) => t.byKind.get(k) ?? 0));
  const rows = countBy(KINDS, t.byKind).map((axis) => {
    if (axis.absent) return [axis.axis, "0", style.warn(NONE), ""];
    const mean = t.meanStrength.get(axis.axis as Kind) ?? 0;
    return [axis.axis, String(axis.count), meter(axis.count / peak), `mean strength ${num(mean)}`];
  });
  return `${subheading("By kind — every kind I know how to hold", style)}\n${indent(
    table(rows, { right: [1] }),
  )}`;
}

// ── by band ──────────────────────────────────────────────────────────────────

const BAND_GLOSS: Record<Band, string> = {
  episodic: "still an episode; forgettable",
  semantic: "settled into what I know",
  identity: "constitutive, and physics can still move it",
};

function bandBlock(t: Tally, style: Style): string {
  const peak = Math.max(1, ...BANDS.map((b) => t.byBand.get(b) ?? 0));
  const rows = countBy(BANDS, t.byBand).map((axis) =>
    axis.absent
      ? [axis.axis, "0", style.warn(NONE), ""]
      : [axis.axis, String(axis.count), meter(axis.count / peak), BAND_GLOSS[axis.axis as Band]],
  );
  return `${subheading("By band — how settled each memory is", style)}\n${indent(
    table(rows, { right: [1] }),
  )}`;
}

// ── the cycle ────────────────────────────────────────────────────────────────

function cycleBlock(src: DashboardSource, day: number, style: Style): string {
  const rows = CYCLE_PHASES.map((phase) => {
    const marker = readMarker(src.store, phase);
    if (marker.health === "torn") {
      return [phase, style.warn("torn marker"), style.warn(`unreadable value ${marker.raw ?? ""}`)];
    }
    if (marker.day === MARKER_UNSET) return [phase, style.warn(NEVER), ""];
    const age = day - marker.day;
    return [phase, `last finished day ${marker.day}`, age <= 0 ? "today" : `${plural(age, "day")} ago`];
  });
  return `${subheading("My last cycle — what finished, and when", style)}\n${indent(table(rows))}`;
}

// ── what I have kept, and what I let go ──────────────────────────────────────

function keepBlock(t: Tally, style: Style): string {
  const named: [string, string][] = [
    [PRUNE_ARCHIVE_REASON, "let go at the floor"],
    [MERGE_ARCHIVE_REASON, "merged into a duplicate"],
    [SCHEMA_TUNABLES.FADE_REASON, "faded out of my vocabulary"],
  ];
  const rows: string[][] = named.map(([reason, gloss]) => {
    const n = t.exits.get(reason) ?? 0;
    return [reason, n === 0 ? style.warn(NONE) : String(n), gloss];
  });
  for (const [reason, n] of t.exits) {
    if (named.some(([r]) => r === reason)) continue;
    // Every other reason a row carries — supersession's `revised-by-pressure`
    // among them. Listed rather than folded away: an exit I cannot gloss is
    // still an exit, and hiding it would be the silence this block prevents.
    rows.push([reason, String(n), "recorded by whatever archived it"]);
  }

  const sentence =
    `${t.promoted === 0 ? "Nothing" : plural(t.promoted, "memory", "memories")} ` +
    `${t.promoted === 1 || t.promoted === 0 ? "has" : "have"} crossed into identity; ` +
    `${t.guarded === 0 ? "nothing is" : `${plural(t.guarded, "memory", "memories")} ${t.guarded === 1 ? "is" : "are"}`} protected; ` +
    `${t.contested === 0 ? "no belief is" : `${plural(t.contested, "belief")} ${t.contested === 1 ? "is" : "are"}`} under challenge right now.`;

  // Standing pressure and having-been-argued-with are different questions, and a
  // revision resets the first — so a store can read "nothing under challenge"
  // while `stories` has a story to tell. Reconciled here rather than left as an
  // apparent contradiction between two views.
  const ever = t.everContested;
  const history =
    ever === 0
      ? "No belief has ever taken a credited challenge."
      : `${plural(ever, "belief")} ${ever === 1 ? "has" : "have"} been argued with at some point — \`stories\` tells each one.`;

  const body = [
    sentence,
    history,
    "",
    "Ways out, counted since birth — never a per-cycle number I do not durably hold:",
    indent(table(rows, { right: [1] })),
  ].join("\n");
  return `${subheading("What I have kept, and what I let go", style)}\n${indent(body)}`;
}

// ── the briefing ─────────────────────────────────────────────────────────────

function briefingBlock(src: DashboardSource, style: Style): string {
  // `self.wake()` is a pure read (self/ §1 G8: no model, no network, no write).
  // Only its SHAPE is printed — the briefing text itself belongs in the wake
  // bundle, not in an instrument's output.
  const wake = src.self.wake();
  const line = wake.ok
    ? `I have a briefing composed and waiting: ${plural(wake.bytes, "byte")}.`
    : style.warn(`I have no briefing waiting to give (${wake.reason}).`);
  return `${subheading("What I would say on waking", style)}\n${indent(line)}`;
}

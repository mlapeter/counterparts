/**
 * THE OQ4 PROBE — is the "quietly available / ignorable" framing actually
 * ignorable to a model? (CONTRACT §7, open question 4; v1 shipped the phrasing
 * as a deliberate probe and never measured it.)
 *
 * The measurement, from rows the store already keeps and nothing else:
 *
 *   `recall.decision`  — per turn, the footnote ids DELIVERED (`footnotes[].id`)
 *   `recall.credit`    — per session-ending boundary, the ids the assistant
 *                        EXPANDED through deliberate recall (`expandedIds`)
 *
 * For each session: footnotes delivered (distinct ids), and how many of those
 * the assistant later expanded — the one behaviour the header is meant to
 * invite or not. Aggregated by calendar date so a change to the header (one
 * string, `render.ts#FRAMING.footnoteHeader`) reads as a before/after on the
 * same table. No model, no prose, no ranking; ids and counts only.
 *
 * What this does NOT claim: causation. A session that expanded nothing may
 * have had nothing worth expanding. The probe answers "did the behaviour move
 * when the string moved", which is the question OQ4 asks, and leaves the
 * ruling to the owner.
 */

export interface ProbeRow {
  readonly name: string;
  readonly day: number;
  /** JSON as stored. Unparseable rows are counted, never thrown on. */
  readonly payload: string | null;
}

export interface ProbeSession {
  readonly session: string;
  readonly date: string | null;
  readonly turns: number;
  readonly footnotesDelivered: number;
  readonly loudDelivered: number;
  readonly expanded: number;
  /** Footnote ids delivered in this session that were later expanded in it. */
  readonly footnotesExpanded: number;
}

export interface ProbeDay {
  readonly date: string;
  readonly sessions: number;
  readonly turns: number;
  readonly footnotesDelivered: number;
  readonly footnotesExpanded: number;
  readonly expanded: number;
  /** footnotesExpanded / footnotesDelivered, or null when nothing was delivered. */
  readonly ratio: number | null;
}

export interface ProbeReport {
  readonly sessions: ProbeSession[];
  readonly days: ProbeDay[];
  readonly decisions: number;
  readonly credits: number;
  readonly unparseable: number;
  readonly totals: {
    readonly footnotesDelivered: number;
    readonly footnotesExpanded: number;
    readonly ratio: number | null;
  };
}

interface Acc {
  session: string;
  date: string | null;
  turns: number;
  footnotes: Set<string>;
  loud: Set<string>;
  expanded: Set<string>;
}

function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string") out.push(x);
    else if (x !== null && typeof x === "object" && typeof (x as { id?: unknown }).id === "string") {
      out.push((x as { id: string }).id);
    }
  }
  return out;
}

export function probeOQ4(rows: readonly ProbeRow[]): ProbeReport {
  const acc = new Map<string, Acc>();
  let decisions = 0;
  let credits = 0;
  let unparseable = 0;
  const get = (session: string, date: string | null): Acc => {
    let a = acc.get(session);
    if (a === undefined) {
      a = { session, date, turns: 0, footnotes: new Set(), loud: new Set(), expanded: new Set() };
      acc.set(session, a);
    }
    if (a.date === null && date !== null) a.date = date;
    return a;
  };
  for (const row of rows) {
    if (row.name !== "recall.decision" && row.name !== "recall.credit") continue;
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(row.payload ?? "") as Record<string, unknown>;
      if (p === null || typeof p !== "object") throw new Error("not an object");
    } catch {
      unparseable += 1;
      continue;
    }
    const session = typeof p["session"] === "string" ? p["session"] : null;
    if (session === null) {
      unparseable += 1;
      continue;
    }
    const date = typeof p["date"] === "string" ? p["date"] : null;
    const a = get(session, date);
    if (row.name === "recall.decision") {
      decisions += 1;
      a.turns += 1;
      for (const id of ids(p["footnotes"])) a.footnotes.add(id);
      for (const id of ids(p["surfaced"])) a.loud.add(id);
    } else {
      credits += 1;
      for (const id of ids(p["expandedIds"])) a.expanded.add(id);
    }
  }

  const sessions: ProbeSession[] = [];
  for (const a of acc.values()) {
    let hit = 0;
    for (const id of a.footnotes) if (a.expanded.has(id)) hit += 1;
    sessions.push({
      session: a.session,
      date: a.date,
      turns: a.turns,
      footnotesDelivered: a.footnotes.size,
      loudDelivered: a.loud.size,
      expanded: a.expanded.size,
      footnotesExpanded: hit,
    });
  }
  sessions.sort((x, y) => (x.date ?? "").localeCompare(y.date ?? "") || x.session.localeCompare(y.session));

  const byDay = new Map<string, { sessions: number; turns: number; fd: number; fe: number; ex: number }>();
  for (const s of sessions) {
    const key = s.date ?? "undated";
    const d = byDay.get(key) ?? { sessions: 0, turns: 0, fd: 0, fe: 0, ex: 0 };
    d.sessions += 1;
    d.turns += s.turns;
    d.fd += s.footnotesDelivered;
    d.fe += s.footnotesExpanded;
    d.ex += s.expanded;
    byDay.set(key, d);
  }
  const days: ProbeDay[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      sessions: d.sessions,
      turns: d.turns,
      footnotesDelivered: d.fd,
      footnotesExpanded: d.fe,
      expanded: d.ex,
      ratio: d.fd === 0 ? null : d.fe / d.fd,
    }));

  const fd = days.reduce((n, d) => n + d.footnotesDelivered, 0);
  const fe = days.reduce((n, d) => n + d.footnotesExpanded, 0);
  return {
    sessions,
    days,
    decisions,
    credits,
    unparseable,
    totals: { footnotesDelivered: fd, footnotesExpanded: fe, ratio: fd === 0 ? null : fe / fd },
  };
}

/** The table a console prints. One line per day, then the totals. */
export function renderProbe(report: ProbeReport): string[] {
  const lines: string[] = [];
  lines.push("OQ4 probe — footnotes delivered vs. later expanded, by calendar date");
  lines.push(`rows: ${report.decisions} recall.decision, ${report.credits} recall.credit, ${report.unparseable} unparseable`);
  lines.push("");
  lines.push("date        sessions  turns  footnotes  expanded-footnotes  expanded-total  ratio");
  for (const d of report.days) {
    lines.push(
      `${d.date.padEnd(11)} ${String(d.sessions).padStart(8)}  ${String(d.turns).padStart(5)}  ${String(d.footnotesDelivered).padStart(9)}  ${String(d.footnotesExpanded).padStart(18)}  ${String(d.expanded).padStart(14)}  ${d.ratio === null ? "   -" : d.ratio.toFixed(3)}`,
    );
  }
  lines.push("");
  const t = report.totals;
  lines.push(
    `total: ${t.footnotesDelivered} footnotes delivered, ${t.footnotesExpanded} later expanded${t.ratio === null ? "" : ` (${(t.ratio * 100).toFixed(1)}%)`}`,
  );
  return lines;
}

/**
 * `mechanisms` — the short answer to "is my memory working?", one line per
 * memory mechanism the site names.
 *
 * **Why it exists** (2026-09-25). The owner ran `counterparts fired` and got 57
 * rows mixing the eleven mechanisms with plumbing, sorted by state, in code
 * words — and rows like "NEVER: a copy of the store could not be made" read as
 * alarms when they are good news. This view is the page a regular user reads;
 * `--all` still prints the full `fired` report, unchanged, for the diagnosis.
 *
 * **It reads nothing of its own.** Every count comes off the rows `fired.ts`
 * already computed. The table below only says which of those rows are the
 * evidence for which mechanism, and how to say the count in plain words.
 *
 * **Deliberately light.** The grouping and the words are this console's own,
 * for now. The site and the dashboard have their own lists and are all still
 * moving, so nothing here is shared with them or tested against them — the
 * only coupling is to `MECHANISMS`, whose ids this table names.
 *
 * The truth per mechanism is `docs/research/mechanism-audit-2026-09-24.md`.
 */
import type { FiredReport, FiredRow } from "../fired.js";

/** The three lights. */
export const LIGHT = {
  working: "●",
  idle: "◐",
  notBuilt: "○",
} as const;
export type Light = (typeof LIGHT)[keyof typeof LIGHT];

export type Group = "Encoding" | "Storage" | "Retrieval" | "Transformation";

/** The evidence rows, by `MECHANISMS` id, as the view reads them. */
type Rows = (id: string) => FiredRow | undefined;

export interface MemoryMechanism {
  readonly name: string;
  readonly group: Group;
  /** `MECHANISMS` ids that are this mechanism's evidence. */
  readonly evidence: readonly string[];
  /** The light and one plain line, from the evidence rows. */
  readonly read: (rows: Rows) => { light: Light; says: string };
}

/** Rows landed in the window, summed over the named ids. */
function week(rows: Rows, ...ids: string[]): number {
  let n = 0;
  for (const id of ids) n += rows(id)?.firedInWindow ?? 0;
  return n;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

const NOT_BUILT = (why: string) => (): { light: Light; says: string } => ({
  light: LIGHT.notBuilt,
  says: `not built yet: ${why}`,
});

/**
 * THE ELEVEN, in the site's four groups and its order. `evidence` lists every
 * id a `read` looks at, so the test can check each one still exists.
 */
export const MEMORY_MECHANISMS: readonly MemoryMechanism[] = [
  // ── Encoding ──
  {
    name: "Salience",
    group: "Encoding",
    evidence: ["deposit", "chunk-gate"],
    read: (rows) => {
      const n = week(rows, "deposit", "chunk-gate");
      return n > 0
        ? { light: LIGHT.working, says: `${plural(n, "memory", "memories")} written and scored` }
        : { light: LIGHT.idle, says: "built, not firing yet: no memories written this week" };
    },
  },
  {
    name: "Emotion",
    group: "Encoding",
    evidence: ["emotion"],
    // The audit's verdict: a feeling is recorded as a label and carries no
    // weight, and the classifier ships off. Idle whatever the counts say.
    read: (rows) => ({
      light: LIGHT.idle,
      says:
        rows("emotion")?.state === "disabled"
          ? "built, held back: the feeling classifier is off, so feelings carry no weight yet"
          : "built, not firing yet: feelings are recorded but carry no weight yet",
    }),
  },
  // ── Storage ──
  {
    name: "Forgetting",
    group: "Storage",
    evidence: ["decay", "prune", "fade", "sleep-cycle"],
    read: (rows) => {
      // `memory.pruned` and `band.transition` are one row per memory; the fade
      // is one row per night that faded a card.
      const letGo = week(rows, "prune");
      const dropped = week(rows, "decay");
      const faded = week(rows, "fade");
      const cycles = week(rows, "sleep-cycle");
      const parts: string[] = [];
      if (letGo > 0) parts.push(`${plural(letGo, "memory", "memories")} let go at the floor`);
      if (dropped > 0) parts.push(`${plural(dropped, "memory", "memories")} faded a band`);
      if (faded > 0) parts.push("unused names faded");
      if (parts.length > 0) {
        if (letGo === 0) parts.push("nothing at the floor yet");
        return { light: LIGHT.working, says: parts.join("; ") };
      }
      if (cycles > 0) {
        return {
          light: LIGHT.working,
          says: `decay ran in ${plural(cycles, "sleep cycle")}; nothing at the floor yet`,
        };
      }
      return { light: LIGHT.idle, says: "built, not firing yet: no sleep cycle ran this week" };
    },
  },
  {
    name: "Interference",
    group: "Storage",
    evidence: [],
    read: NOT_BUILT("only exact duplicates are merged"),
  },
  // ── Retrieval ──
  {
    name: "Retrieval",
    group: "Retrieval",
    evidence: ["recall-decision", "credit"],
    read: (rows) => {
      const turns = week(rows, "recall-decision");
      // `recall.credit` is one row per session end, not per memory — so it is
      // said as a fact, never as a count of memories.
      const credited = week(rows, "credit") > 0;
      if (turns === 0) {
        return { light: LIGHT.idle, says: "built, not firing yet: no turns checked this week" };
      }
      return {
        light: LIGHT.working,
        says: credited
          ? `${plural(turns, "turn")} checked; memories used were strengthened`
          : `${plural(turns, "turn")} checked; nothing used yet, so nothing strengthened`,
      };
    },
  },
  {
    name: "Association",
    group: "Retrieval",
    evidence: ["association-saved", "association"],
    read: (rows) => {
      const saved = week(rows, "association-saved");
      const held = rows("association")?.total ?? 0;
      if (saved > 0) {
        return {
          light: LIGHT.working,
          says: `links saved after ${plural(saved, "session")}; ${plural(held, "link")} held`,
        };
      }
      return {
        light: LIGHT.idle,
        says:
          held > 0
            ? `built, not firing yet: no new links this week (${plural(held, "link")} held)`
            : "built, not firing yet: no links formed",
      };
    },
  },
  {
    name: "Prospective",
    group: "Retrieval",
    evidence: ["prospective-armed", "prospective-fired"],
    // Nothing in live use can put a date on a memory yet (audit: DRAFT_FIELDS),
    // and nothing spends a fire. A store that holds dated intentions anyway has
    // the half that is built; one that holds none has nothing of it.
    read: (rows) => {
      const armed = rows("prospective-armed")?.total ?? 0;
      return armed > 0
        ? {
            light: LIGHT.idle,
            says: `built, not firing yet: ${plural(armed, "dated reminder")} held, and nothing brings one back yet`,
          }
        : { light: LIGHT.notBuilt, says: "not built yet: nothing can put a date on a memory" };
    },
  },
  // ── Transformation ──
  {
    name: "Consolidation",
    group: "Transformation",
    evidence: ["sleep-cycle", "promotion", "dedup"],
    read: (rows) => {
      const cycles = week(rows, "sleep-cycle");
      if (cycles === 0) {
        return { light: LIGHT.idle, says: "built, not firing yet: no sleep cycle ran this week" };
      }
      const promoted = week(rows, "promotion");
      const merged = week(rows, "dedup");
      const extra: string[] = [];
      if (promoted > 0) extra.push(`${plural(promoted, "memory", "memories")} became core`);
      if (merged > 0) extra.push(`${plural(merged, "duplicate")} merged`);
      return {
        light: LIGHT.working,
        says: `${plural(cycles, "sleep cycle")} ran${extra.length > 0 ? `; ${extra.join(", ")}` : ""}`,
      };
    },
  },
  {
    name: "Reconsolidation",
    group: "Transformation",
    evidence: ["revision", "accommodation"],
    read: (rows) => {
      const pressed = week(rows, "revision");
      const replaced = week(rows, "accommodation");
      if (pressed + replaced > 0) {
        const parts: string[] = [];
        if (replaced > 0) parts.push(`${plural(replaced, "memory", "memories")} corrected, old version kept`);
        if (pressed > 0) parts.push(`${plural(pressed, "belief")} challenged`);
        return { light: LIGHT.working, says: parts.join("; ") };
      }
      return { light: LIGHT.idle, says: "built, not firing yet: nothing corrected this week" };
    },
  },
  {
    name: "Schemas",
    group: "Transformation",
    // Entity cards are built; beliefs about them have no live producer.
    evidence: ["entity-birth"],
    read: NOT_BUILT("nothing forms beliefs about people and projects yet"),
  },
  {
    name: "Gist",
    group: "Transformation",
    evidence: ["gist"],
    read: NOT_BUILT("many episodes are not yet distilled into one lasting memory"),
  },
];

/**
 * THE PLUMBING ROWS WHOSE FIRING MEANS SOMETHING FAILED, with the words to say
 * it in. Every other plumbing row — a failure that never happened, an owner
 * action never taken, a part blind by design — is not a problem, and the one
 * line never makes it read like one.
 */
const TROUBLE: Readonly<Record<string, string>> = {
  "worker-trouble": "the background worker failed or was refused",
  "snapshot-trouble": "a copy of the store could not be made",
};

/** Every `MECHANISMS` id the eleven account for; the rest are plumbing. */
export function mechanismIds(): Set<string> {
  return new Set(MEMORY_MECHANISMS.flatMap((m) => m.evidence));
}

/** The plumbing line: how many parts ran this week, and only what failed. */
export function plumbingLine(report: FiredReport): string {
  const mine = mechanismIds();
  const plumbing = report.rows.filter((r) => !mine.has(r.id));
  const running = plumbing.filter((r) => r.state === "firing" && TROUBLE[r.id] === undefined).length;
  const failing: string[] = [];
  for (const r of plumbing) {
    const words = TROUBLE[r.id];
    if (words !== undefined && r.firedInWindow > 0) {
      failing.push(`${words} (${plural(r.firedInWindow, "time")})`);
    }
  }
  const head = `Plumbing: ${plural(running, "part")} running`;
  return failing.length === 0 ? `${head}, none failing.` : `${head}; failing: ${failing.join("; ")}.`;
}

/** The whole short view, as plain lines: one per mechanism in the site's four
 *  groups and order, then the plumbing in one line. */
export function mechanismsLines(report: FiredReport): string[] {
  const byId = new Map(report.rows.map((r) => [r.id, r]));
  const rows: Rows = (id) => byId.get(id);
  const width = Math.max(...MEMORY_MECHANISMS.map((m) => m.name.length)) + 2;
  const lines = [`Memory mechanisms — last 7 days (${report.from} to ${report.today}, UTC)`, ""];
  if (report.young) {
    lines.push("This memory is new, so most of these have had nothing to do yet.", "");
  }
  for (const m of MEMORY_MECHANISMS) {
    const { light, says } = m.read(rows);
    lines.push(`${light} ${m.name.padEnd(width)}${says}`);
  }
  lines.push(
    "",
    `${LIGHT.working} working this week  ${LIGHT.idle} built, not firing  ${LIGHT.notBuilt} not built yet`,
    plumbingLine(report),
    "Every detail: counterparts mechanisms --all",
  );
  return lines;
}

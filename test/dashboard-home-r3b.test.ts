/**
 * The home tab, round 3b (2026-09-27 — a try, not a rule): less on the page,
 * and what remains is about OUR memories.
 *
 *   1. the pills are one small line that scrolls sideways, the stage a colour mark;
 *   2. every mechanism's panel is one big number, those memories, one line —
 *      the rest behind a "how it works" fold that stays open across refreshes;
 *   3. each thing lives on one page: the core, chapters and dreams on Self,
 *      linked from Home rather than repeated.
 *
 * Round 4 (2026-09-28) moved the pills and the panel to the Health tab
 * (`pages/health/sections/mechanisms.js`) unchanged; Tonight left Home.
 *
 * Hermetic: a demo store seeded into a temp dir, removed after.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../src/core/counterpart.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { router } from "../src/adapters/dashboard/web/server.js";
import { PICTURE_ROWS } from "../src/adapters/dashboard/web/views/mechanism-panel.js";
import { LEADS, MECHANISM_DAYS, MECHANISM_PROOFS, leadOf, mechanismsView } from "../src/adapters/dashboard/web/views/mechanisms.js";
import { mechanismEvidence } from "../src/adapters/mechanism-evidence.js";
import { seedDemo } from "../tools/demo/seed.js";

const WEB = fileURLToPath(new URL("../src/adapters/dashboard/web/", import.meta.url));
const HOST = "127.0.0.1:4747";
const DATE = "2026-07-13";

let dir: string;
let felt = "";
let gistId = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-home-r3b-"));
  await seedDemo({ dir });
  const c = Counterpart.open({ dir, owner: true });
  try {
    c.store.advanceClock(DATE);
    const day = c.store.livedDay();
    let n = 0;
    for (const id of c.store.list({ archived: false })) {
      const row = c.store.row(id);
      if (row === undefined || row.type !== "memory" || n >= 3) continue;
      if (day - c.store.physicsOf(id).lastUsedDay >= 4 && c.store.reinforce(id, day).ret?.counted === true) n += 1;
    }
    // A memory written today, with a recorded feeling: the newest one a feeling holds higher.
    felt = c.store.put({ type: "memory", kind: "fact", body: "The harbour office keeps the tide tables.", salience: { relevance: 0.6, emotional: 0.2, predictive: 0.5 }, physics: { birthDay: day, lastUsedDay: day } });
    c.store.addFeelings(felt, [{ whose: "owner", core: "happy", emotion: "proud", strength: 0.8 }]);
    const begun = c.dreams.begin({ session: "s-dream", scope: null });
    if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
    const shown = Object.keys(begun.bundle.memories).filter((id) => c.store.row(id)?.source !== "dreamed");
    const out = c.dreams.propose({
      dream: begun.bundle.dream,
      session: "s-dream",
      changes: [
        ...shown.slice(0, 7).map((id) => ({ action: "replayed", id })),
        { action: "gist", text: "We come back to the harbour whenever plans change.", sources: shown.slice(0, 2) },
      ] as never,
    });
    if (!out.ok) throw new Error("propose refused");
    gistId = out.results.find((r) => r.action === "gist" && r.ok)?.id ?? "";
    c.dreams.journal({ dream: begun.bundle.dream, session: "s-dream", title: "Harbour", text: "I dreamed of tide tables." });
    c.store.appendEvent({
      name: "recall.decision",
      day,
      ref: "s-mood",
      payload: { session: "s-mood", turn: 3, day, surfacedCount: 1, footnoteCount: 2, moodMatched: 2, surfaced: [], footnotes: [] },
    });
  } finally {
    c.close();
  }
}, 120_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function withSource<T>(fn: (src: DashboardSource) => T): T {
  const dash = Dashboard.open({ dir });
  try {
    return fn(dash.source);
  } finally {
    dash.close();
  }
}

function get(src: DashboardSource, path: string): Record<string, unknown> {
  const reply = router(new URL(`http://${HOST}${path}`), HOST, src);
  expect(reply.status).toBe(200);
  return JSON.parse(reply.body) as Record<string, unknown>;
}

const read = (p: string): string => readFileSync(join(WEB, p), "utf8");

describe("1. the pills: one small line", () => {
  test("no stage headings; each pill carries its stage as a colour mark, and the line scrolls, never wraps", () => {
    const explorer = read("pages/health/sections/mechanisms.js");
    expect(explorer).not.toContain("mech-fam");
    expect(explorer).not.toContain("mech-group");
    expect(explorer).toContain('class="mech-stage"');
    expect(explorer).toContain("--pin:");
    // keyboard: the arrow keys walk the line, and a pick is brought into view inside the strip
    expect(explorer).toContain('"ArrowRight"');
    expect(explorer).toContain("function revealPill(");
    const css = read("pages/health/health.css");
    expect(css).toMatch(/\.mechs\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/);
    expect(css).toMatch(/\.mech-pill\{flex:none/);
    expect(css).not.toContain(".mech-fam");
  });
});

describe("2. the panel: one number, those memories, one line", () => {
  test("the big number is one part of the evidence the light was judged by", () => {
    withSource((src) => {
      const view = mechanismsView(src);
      const { verdicts } = mechanismEvidence(src.store, { sinceDay: view.fromDay, today: view.livedDay });
      const returns = src.store.returnCounts({ sinceDay: view.fromDay });
      for (const l of view.mechanisms) {
        const v = verdicts.find((x) => x.id === l.id)!;
        if (l.build === "not") {
          expect(`${l.id}: ${String(l.lead)}`).toBe(`${l.id}: null`);
          continue;
        }
        expect(LEADS[l.id]).toBeDefined();
        expect(l.lead).toEqual(leadOf(v, { awake: returns.awake, dream: returns.dream }));
        // Every candidate names parts the shared table (or the returns split, or `held`) really has.
        const keys = new Set([...v.parts.map((p) => p.key), "awake", "dream", "held"]);
        for (const c of LEADS[l.id]!) for (const k of c.keys) expect(`${l.id}.${k}: ${keys.has(k)}`).toBe(`${l.id}.${k}: true`);
      }
      const emotion = view.mechanisms.find((m) => m.id === "emotional")!;
      expect(emotion.lead).toEqual({ n: 2, words: "memories a matching mood brought closer this week" });
      const cons = view.mechanisms.find((m) => m.id === "consolidation")!;
      expect(cons.lead).toEqual({ n: returns.awake, words: "came back in conversation this week" });
    });
    // The first candidate above zero wins; all at zero says zero with the first's words.
    const v = { id: "decay", family: "storage", build: "built", fired: true, events: [], today: null, held: null, lastFiredDay: null, schedule: null } as const;
    expect(leadOf({ ...v, parts: [{ key: "faded", count: 0, says: ["", ""] }, { key: "pruned", count: 1, says: ["", ""] }] } as never)).toEqual({ n: 1, words: "memory exited (archived) this week" });
    expect(leadOf({ ...v, parts: [{ key: "faded", count: 0, says: ["", ""] }] } as never)).toEqual({ n: 0, words: "memories below reach now" });
    expect(MECHANISM_DAYS).toBe(7);
  });

  test("every built mechanism has a picture, of at most five of our memories, each opening its card", async () => {
    const index = (await import(join(WEB, "mechanisms/index.js"))) as { PANELS: Record<string, { picture(p: unknown): string }> };
    withSource((src) => {
      for (const m of MECHANISM_PROOFS) {
        const pic = get(src, `/api/mechanism?id=${m.id}`)["picture"] as Record<string, unknown> | null;
        if (m.build === "not") {
          expect(pic).toBeNull();
          continue;
        }
        expect(`${m.id}: ${pic?.["kind"]}`).toBe(`${m.id}: ${m.id}`);
        const html = index.PANELS[m.id]!.picture(pic);
        const rows = (html.match(/class="pic-mem/g) ?? []).length;
        // reconsolidation names two memories per correction
        expect(`${m.id}: ${rows <= (m.id === "reconsolidation" ? 2 * PICTURE_ROWS : PICTURE_ROWS)}`).toBe(`${m.id}: true`);
        expect(html).not.toContain("<script");
      }
    });
  });

  test("Emotion lists the memories a feeling holds higher, with the feeling", async () => {
    const { picture } = (await import(join(WEB, "mechanisms/emotional/panel.js"))) as { picture(p: unknown): string };
    withSource((src) => {
      const p = get(src, "/api/mechanism?id=emotional")["picture"] as { memories: { id: string; emotional: number; feelings: { word: string; strength: number }[] }[] };
      expect(p.memories.length).toBeGreaterThan(0);
      expect(p.memories[0]!.id).toBe(felt);
      expect(p.memories[0]!.feelings.map((f) => f.word)).toEqual(["proud"]);
      for (const m of p.memories) expect(m.emotional > 0 || m.feelings.some((f) => f.strength > 0)).toBe(true);
      const html = picture(p);
      expect(html).toContain("proud · you");
      expect(html).toContain(`openMemory('${felt}')`);
    });
  });

  test("Dreaming lists the memories the last dream changed and links the journal on Self; the gist panel lists the pattern", async () => {
    const dreaming = (await import(join(WEB, "mechanisms/dreaming/panel.js"))) as { picture(p: unknown): string };
    withSource((src) => {
      const p = get(src, "/api/mechanism?id=dreaming")["picture"] as { dream: { id: string; title: string; changes: number }; memories: { id: string; did: string }[] };
      const changes = src.store.dreamChanges(p.dream.id).filter((c) => c.undone === 0);
      expect(p.dream.title).toBe("Harbour");
      expect(p.dream.changes).toBe(changes.length);
      expect(p.memories.map((m) => m.id)).toEqual([...new Set(changes.map((c) => c.ref as string))].slice(0, PICTURE_ROWS));
      expect(p.memories[0]!.did).toBe("replayed it");
      const html = dreaming.picture(p);
      expect(html).toContain('href="#self/dreams"');
      expect(html).not.toContain("I dreamed of tide tables"); // the journal lives on Self
      expect(gistId).not.toBe("");
      const g = get(src, "/api/mechanism?id=episodic-semantic")["picture"] as { gists: { id: string }[] };
      expect(g.gists.map((x) => x.id)).toEqual([gistId]);
    });
  });

  test("Prospective lists reminders that came back, then dated memories still waiting", () => {
    withSource((src) => {
      const p = get(src, "/api/mechanism?id=prospective")["picture"] as { came: { id: string }[]; waiting: { id: string; date: string }[] };
      expect(p.came.length + p.waiting.length).toBeGreaterThan(0);
      expect(p.came.length + p.waiting.length).toBeLessThanOrEqual(PICTURE_ROWS);
      const dated = new Map(src.store.datedMemories("0001-01-01", "9999-12-31").map((d) => [d.id, d.eventDate]));
      for (const w of p.waiting) expect(dated.get(w.id)).toBe(w.date);
    });
  });

  test("everything else is behind one fold, closed by default, remembered for the session", () => {
    const explorer = read("pages/health/sections/mechanisms.js");
    expect(explorer).toContain('<details class="mech-how"');
    expect(explorer).toContain("how it works");
    expect(explorer).toContain('(howOpen ? " open" : "")');
    expect(explorer).toContain("sessionStorage");
    // the headline quote, the long paragraph, what's built, Lately and the guide link sit inside the fold
    const fold = explorer.slice(explorer.indexOf('<details class="mech-how"'), explorer.indexOf("</details>"));
    for (const part of ["m.tagline", "m.explainer", "What’s built", "Still in development", "mech-feed", "guideUrl("]) {
      expect(`${part}: ${fold.includes(part)}`).toBe(`${part}: true`);
    }
    expect(explorer).toContain("m.does");
  });
});

describe("3. each thing lives on one page", () => {
  test("no Latest chapters column on Home; the chapters widget went with it", () => {
    const home = read("pages/home/index.js");
    expect(home).not.toContain("recentChapters");
    expect(existsSync(join(WEB, "pages/home/sections/recent-chapters.js"))).toBe(false);
    expect(existsSync(join(WEB, "shared/widgets/chapters.js"))).toBe(false);
  });

  test("the consolidation picture has no candidate list and no core history", async () => {
    const { picture } = (await import(join(WEB, "mechanisms/consolidation/panel.js"))) as { picture(p: unknown): string };
    withSource((src) => {
      const p = get(src, "/api/mechanism?id=consolidation")["picture"] as Record<string, unknown>;
      expect(Object.keys(p).sort()).toEqual(["kind", "memories", "merges", "returns"]);
      const html = picture(p);
      expect(html).not.toContain("Recently became core");
      expect(html).not.toContain("slow lane");
    });
  });
});

describe("looking still writes nothing", () => {
  test("every panel read leaves the store byte-identical", () => {
    const snapshot = (): Map<string, string> => {
      const out = new Map<string, string>();
      const walk = (p: string): void => {
        for (const e of readdirSync(p, { withFileTypes: true })) {
          const full = join(p, e.name);
          if (e.isDirectory()) walk(full);
          else if (e.isFile()) out.set(relative(dir, full), createHash("sha256").update(readFileSync(full)).digest("hex"));
        }
      };
      walk(dir);
      return out;
    };
    withSource((src) => {
      const before = snapshot();
      get(src, "/api/mechanisms");
      get(src, "/api/overview");
      for (const m of MECHANISM_PROOFS) get(src, `/api/mechanism?id=${m.id}`);
      expect(snapshot()).toEqual(before);
    });
  });
});

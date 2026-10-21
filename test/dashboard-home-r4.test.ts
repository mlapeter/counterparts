/**
 * The home tab, round 4 (2026-09-28 — a try, judged when seen): the best
 * pictures from the other tabs, each a way into its own tab.
 *
 *   1. "Today": a few plain lines about memory only — no event names, bytes or
 *      paths; memories open their cards, the core and the dream go to Self,
 *      what was let go to the memories list; an empty today falls back to the
 *      most recent lived day and says which;
 *   2. the brain: a region opens its mechanism on Health;
 *   3. Health's new bottom section, "How the memory works" (the pills and the
 *      panel that were Home's);
 *   4. the radar and the self map are the other tabs' own components;
 *   5. the health dot is doctor's reading in a few words;
 *   6. the header lost its store and day chips.
 *
 * Hermetic: demo stores seeded into temp dirs, removed after.
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
import { TODAY_LINES, todayView, wordEnd } from "../src/adapters/dashboard/web/views/today.js";
import type { TodayLine, TodayView } from "../src/adapters/dashboard/web/views/today.js";
import { seedDemo } from "../tools/demo/seed.js";

const WEB = fileURLToPath(new URL("../src/adapters/dashboard/web/", import.meta.url));
const HOST = "127.0.0.1:4747";
const DATE = "2026-07-13";

let dir: string;
let quietDir: string;
const made = { written: [] as string[], promoted: "", pruned: "", secret: "" };

/** The browser modules touch `window` at load (`window.openMemory = …`); give them one. */
(globalThis as { window?: unknown }).window ??= globalThis;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-home-r4-"));
  quietDir = mkdtempSync(join(tmpdir(), "counterparts-home-r4-quiet-"));
  await seedDemo({ dir });
  await seedDemo({ dir: quietDir });
  const c = Counterpart.open({ dir });
  try {
    c.store.advanceClock(DATE);
    const day = c.store.livedDay();
    for (let i = 0; i < 7; i++) {
      made.written.push(c.store.put({
        type: "memory",
        kind: "fact",
        body: `The ferry to the island leaves at ${7 + i} o'clock on market days.`,
        salience: { relevance: 0.6, emotional: 0.2, predictive: 0.5 },
        physics: { birthDay: day, lastUsedDay: day },
      }));
    }
    // The secret must be the newest written: step past the last put's millisecond,
    // or a same-millisecond tie orders them by random id (a 1-in-10 flake).
    for (const t = Date.now(); Date.now() <= t; );
    made.secret = c.store.put({
      type: "memory",
      kind: "fact",
      body: "The code for the studio's side door is on the card in the drawer.",
      meta: { confidential: true },
      salience: { relevance: 0.6, emotional: 0.2, predictive: 0.5 },
      physics: { birthDay: day, lastUsedDay: day },
    });
    const begun = c.dreams.begin({ session: "s-dream", scope: null });
    if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
    const shown = Object.keys(begun.bundle.memories).filter((id) => c.store.row(id)?.source !== "dreamed");
    c.dreams.propose({ dream: begun.bundle.dream, session: "s-dream", changes: shown.slice(0, 3).map((id) => ({ action: "replayed", id })) as never });
    c.dreams.journal({ dream: begun.bundle.dream, session: "s-dream", title: "The harbour at low tide", text: "I dreamed of tide tables." });
    made.promoted = c.store.list({ archived: false }).find((id) => {
      const r = c.store.row(id);
      return r !== undefined && r.type === "memory" && r.kind === "self" && r.band !== "identity";
    }) ?? "";
    c.store.appendCoreEvent({ memoryId: made.promoted, action: "promoted", day, lane: "fast", actor: "sleep" });
    made.pruned = c.store.list({ archived: false }).find((id) => {
      const r = c.store.row(id);
      return r !== undefined && r.type === "memory" && r.birth_day < day - 10;
    }) ?? "";
    c.store.appendEvent({ name: "memory.pruned", day, ref: made.pruned, payload: { kind: "fact", band: "episodic", birthDay: 1, lastUsedDay: 2, uses: 1, strength: 0.05 } });
  } finally {
    c.close();
  }
  // The quiet store: a lived day passes with nothing in it.
  const q = Counterpart.open({ dir: quietDir });
  try {
    q.store.advanceClock(DATE);
    q.store.put({ type: "memory", kind: "fact", body: "The last thing written before a quiet day.", salience: { relevance: 0.5, emotional: 0.1, predictive: 0.4 }, physics: { birthDay: q.store.livedDay(), lastUsedDay: q.store.livedDay() } });
    q.store.advanceClock("2026-07-14");
  } finally {
    q.close();
  }
}, 180_000);

afterAll(() => {
  for (const d of [dir, quietDir]) rmSync(d, { recursive: true, force: true });
});

function withSource<T>(at: string, fn: (src: DashboardSource) => T): T {
  const dash = Dashboard.open({ dir: at });
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

/** Where a Today line may go: a memory's card, or one of these places. */
const PLACES = ["self/settling", "self/dreams", "memories?state=archived", "memories?state=live"];

describe("1. Today: memory only, each line a way in", () => {
  test("today's lines: the written memories, the core, the dream, the let-go — newest first, at most six", () => {
    withSource(dir, (src) => {
      const t = get(src, "/api/overview")["today"] as unknown as TodayView;
      expect(t).toEqual(todayView(src) as unknown as TodayView);
      expect(t.label).toBe("Today");
      expect(t.fallback).toBe(false);
      expect(t.day).toBe(src.store.livedDay());
      expect(t.lines.length).toBeLessThanOrEqual(TODAY_LINES);
      const kinds = t.lines.map((l) => l.kind);
      for (const k of ["core", "dream", "let-go", "written", "more"]) expect(`${k}: ${kinds.includes(k as TodayLine["kind"])}`).toBe(`${k}: true`);
      // The rare lines are always kept; written memories fill the rest; "and N more" closes.
      expect(kinds[kinds.length - 1]).toBe("more");
      expect(t.newToday).toBe(made.written.length + 1); // the confidential one was written too
      const shownWritten = t.lines.filter((l) => l.kind === "written").length;
      expect(t.lines.find((l) => l.kind === "more")!.text).toBe(`and ${t.newToday - shownWritten} more`);

      const dream = t.lines.find((l) => l.kind === "dream")!;
      expect(dream.text).toBe("Dreamed: The harbour at low tide");
      expect(dream.to).toEqual({ hash: "self/dreams" });
      const core = t.lines.find((l) => l.kind === "core")!;
      expect(core.text).toMatch(/^“.+” became part of who I am$/);
      expect(core.to).toEqual({ hash: "self/settling" });
      const gone = t.lines.find((l) => l.kind === "let-go")!;
      expect(gone.text).toMatch(/^Let go of “.+” — it had faded$/);
      expect(gone.to).toEqual({ hash: "memories?state=archived" });
      for (const l of t.lines.filter((x) => x.kind === "written")) {
        expect(made.written.concat(made.secret)).toContain((l.to as { memory: string }).memory);
      }
    });
  });

  test("no event names, no bytes, no paths, no handoffs; every link is a card or a place, never a raw record", () => {
    withSource(dir, (src) => {
      const t = todayView(src);
      const words = JSON.stringify(t.lines.map((l) => l.text));
      for (const bad of [/gate\.deposit/, /\b[a-z]+\.[a-z]+\.[a-z]+\b/, /\bbytes?\b/i, /\/[\w.-]+\/[\w.-]+/, /\.md\b/, /handoff/i, /every gate was clear/i, /journal\//]) {
        expect(`${bad}: ${bad.test(words)}`).toBe(`${bad}: false`);
      }
      for (const l of t.lines) {
        const to = l.to as { memory?: string; hash?: string };
        if (to.memory !== undefined) expect(src.store.row(to.memory)?.type).toBe("memory");
        else expect(PLACES).toContain(to.hash!);
      }
    });
    const client = read("pages/home/sections/today.js");
    expect(client).toContain("window.openMemory(b.dataset.id)");
    expect(client).not.toContain("openEvent");
    expect(client).not.toContain("event-modal");
    expect(read("pages/home/index.js")).not.toContain("registerLiveFeed");
  });

  test("a memory carrying the retired confidential key is a line in its own words (2026-10-21)", () => {
    withSource(dir, (src) => {
      const all = todayView(src);
      const secret = all.lines.find((l) => (l.to as { memory?: string }).memory === made.secret);
      expect(secret).toBeDefined(); // the newest written: it is shown
      expect(secret!.confidential).toBe(false);
      expect(JSON.stringify(all)).toContain("side door");
    });
  });

  test("an empty today falls back to the most recent lived day, and says which", () => {
    withSource(quietDir, (src) => {
      const t = todayView(src);
      expect(t.fallback).toBe(true);
      expect(t.label).toBe("Yesterday");
      expect(t.day).toBe(src.store.livedDay() - 1);
      expect(t.newToday).toBe(0);
      expect(t.lines.some((l) => l.kind === "written" && l.text.includes("quiet day"))).toBe(true);
      // The headline says nothing is new today rather than "0 new today".
      expect((get(src, "/api/overview")["hero"] as { headline: string }).headline).not.toContain("new today");
    });
  });

  test("a clipped line ends at a whole word", () => {
    expect(wordEnd("the cheapest measure of whethe…")).toBe("the cheapest measure of…");
    expect(wordEnd("a whole sentence.")).toBe("a whole sentence.");
    expect(wordEnd("one, two, thr…")).toBe("one, two…");
  });
});

describe("2. the brain: a region opens its mechanism on Health", () => {
  test("each clickable region goes to its first mechanism on Health; the cerebellum goes nowhere", async () => {
    const { REGIONS } = (await import(join(WEB, "mechanisms/regions.js"))) as { REGIONS: { key: string; active: boolean; mechanisms: string[] }[] };
    const { routeOf, mechanismOf } = (await import(join(WEB, "pages/home/sections/brain.js"))) as {
      routeOf(key: string): string | null;
      mechanismOf(key: string): string | null;
    };
    for (const r of REGIONS) {
      if (r.mechanisms.length === 0) {
        expect(routeOf(r.key)).toBeNull();
        continue;
      }
      expect(mechanismOf(r.key)).toBe(r.mechanisms[0]!);
      expect(routeOf(r.key)).toBe(`health/mechanisms?id=${r.mechanisms[0]}`);
    }
    expect(routeOf("amygdala")).toBe("health/mechanisms?id=salience");
    // Health takes the route: the section, that mechanism picked.
    const health = read("pages/health/index.js");
    expect(health).toMatch(/route\(\{ anchor, params \}\) \{\s*if \(anchor === "mechanisms"\) mechanisms\.open\(params\.get\("id"\)\);/);
    const mech = read("pages/health/sections/mechanisms.js");
    expect(mech).toContain("export function open(id)");
  });

  test("the brain drives no panel on Home: no pick, and a point's name shows only on hover", () => {
    const brain = read("pages/home/brain.js");
    expect(brain).not.toContain("select(key, tint, label)");
    expect(brain).not.toContain("uLock");
    const css = read("pages/home/home.css");
    expect(css).toMatch(/\.brain-pin-name\{display:none;/);
    expect(css).toContain(".brain-pin:hover .brain-pin-name");
    expect(existsSync(join(WEB, "pages/home/sections/explorer.js"))).toBe(false);
    for (const gone of ["tiles.js", "written.js", "tonight.js", "live-activity.js"]) {
      expect(`${gone}: ${existsSync(join(WEB, "pages/home/sections", gone))}`).toBe(`${gone}: false`);
    }
  });
});

describe("3. Health: How the memory works, at the bottom", () => {
  test("the section is Health's last, titled plainly, with the pills and the panel", async () => {
    const health = read("pages/health/index.js");
    const order = ["checks.markup", "cycle.markup", "wake.markup", "archive.markup", "verify.markup", "mechanisms.markup"].map((m) => health.indexOf("${" + m + "}"));
    for (const at of order) expect(at).toBeGreaterThan(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(health).toContain("mechanisms.render()");
    expect(health).toContain("mechanisms.refresh()");
    const { markup } = (await import(join(WEB, "pages/health/sections/mechanisms.js"))) as { markup: string };
    expect(markup).toContain(">How the memory works</h2>");
    for (const id of ["mech-panel", "mech-strip", "mech-body"]) expect(markup).toContain(`id="${id}"`);
    // Its styles moved with it.
    expect(read("pages/health/health.css")).toContain(".mech-card{");
    expect(read("pages/home/home.css")).not.toContain(".mech-");
    // Home no longer asks for a mechanism's panel.
    for (const f of ["pages/home/index.js", "pages/home/sections/brain.js"]) expect(read(f)).not.toContain("/api/mechanism?id=");
  });
});

describe("4. the radar and the self map are their tabs' own components", () => {
  test("Home imports them rather than copying them, and its payload carries their data", () => {
    // The radar is ONE shared component both tabs draw (Memories round 4, M3).
    for (const f of ["pages/home/sections/feel.js", "pages/memories/sections/feel.js"]) {
      const feel = read(f);
      expect(feel).toContain('from "../../../shared/widgets/feel-radar.js"');
      expect(feel).toContain("radarHtml(");
      expect(feel).not.toContain("<svg");
    }
    expect(read("pages/home/sections/feel.js")).toContain('go("memories?feeling="');
    const map = read("pages/home/sections/map.js");
    expect(map).toContain('from "../../self/sections/map.js"');
    expect(map).toContain('{ count: false }');
    expect(map).toContain('href="#self"');
    // The memories tab opens at a feeling.
    expect(read("pages/memories/index.js")).toContain('params.get("feeling")');
    withSource(dir, (src) => {
      const o = get(src, "/api/overview");
      const m = get(src, "/api/memories");
      expect(o["feelings"]).toEqual(m["feelings"]);
      const mind = get(src, "/api/mind");
      expect(o["map"]).toEqual(mind["map"]);
    });
  });

  test("the radar draws the same SVG on both tabs", async () => {
    const { radarSvg } = (await import(join(WEB, "shared/widgets/feel-radar.js"))) as { radarSvg(f: unknown, picked: string | null): string };
    withSource(dir, (src) => {
      const f = get(src, "/api/overview")["feelings"];
      const svg = radarSvg(f, null);
      expect(svg).toStartWith('<svg class="feel-svg"');
      expect((svg.match(/data-core="/g) ?? []).length).toBe(7);
    });
  });
});

describe("5. the health dot is doctor's reading in a few words", () => {
  test("All good, or how many things to look at, graded the way the checklist grades them", async () => {
    const { verdictOf, gradeOf } = (await import(join(WEB, "shared/doctor.js"))) as {
      verdictOf(r: unknown): { look: number; grade: string; words: string };
      gradeOf(f: unknown): string;
    };
    const f = (key: string, severity: string, extra: Record<string, unknown> = {}) => ({ key, severity, ...extra });
    expect(verdictOf({ red: 0, findings: [f("store", "green"), f("host", "green")] })).toEqual({ look: 0, grade: "green", words: "All good" });
    expect(verdictOf({ red: 0, findings: [f("store", "green"), f("snapshot", "amber")] })).toEqual({ look: 1, grade: "amber", words: "1 thing to look at" });
    expect(verdictOf({ red: 1, findings: [f("store", "red"), f("snapshot", "amber")] })).toEqual({ look: 2, grade: "red", words: "2 things to look at" });
    // An optional feature nobody turned on is not a thing to look at.
    expect(verdictOf({ red: 0, findings: [f("embedder", "amber", { optional: true })] }).look).toBe(0);
    expect(gradeOf(f("config", "amber", { data: { reason: "not-read" } }))).toBe("grey");
    const hero = read("pages/home/sections/hero.js");
    expect(hero).toContain('href="#health"');
    expect(hero).toContain("onDoctor(");
    // One run serves both: the checklist uses the same reading.
    const checks = read("pages/health/sections/checks.js");
    expect(checks).toContain('from "../../../shared/doctor.js"');
    expect(checks).not.toContain('act("doctor"');
  });
});

describe("6. the header", () => {
  test("no store chip, no day chip, no last-event chip, and no reassurance badge (Memories round 4, M8)", () => {
    const html = read("app.html");
    expect(html).not.toContain("Reading here changes nothing");
    expect(html).not.toContain('class="badge');
    for (const id of ['id="dir"', 'id="clock"', 'id="seen"']) expect(html).not.toContain(id);
    for (const f of ["app.js", "shell/pulse.js"]) {
      const s = read(f);
      for (const id of ['$("dir")', '$("clock")', '$("seen")']) expect(`${f} ${id}: ${s.includes(id)}`).toBe(`${f} ${id}: false`);
    }
  });
});

describe("looking still writes nothing", () => {
  test("the new reads leave the store byte-identical", () => {
    const snapshot = (at: string): Map<string, string> => {
      const out = new Map<string, string>();
      const walk = (d: string): void => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          const full = join(d, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) out.set(relative(at, full), createHash("sha256").update(readFileSync(full)).digest("hex"));
        }
      };
      walk(at);
      return out;
    };
    withSource(dir, (src) => {
      const before = snapshot(dir);
      get(src, "/api/overview");
      todayView(src);
      expect(snapshot(dir)).toEqual(before);
    });
  });
});

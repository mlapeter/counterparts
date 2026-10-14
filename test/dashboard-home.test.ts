/**
 * The home page: the headline (`/api/overview`'s `hero`), the mechanism
 * panel's data (`/api/mechanism?id=`), the pictures each mechanism draws
 * (`web/mechanisms/<id>/panel.js`), the brain's region table, the vendored
 * three.js, and the retired `/brain` page. Hermetic: two stores seeded into
 * temp dirs, removed after.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { Dashboard } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { DURABLE_EVENT_NAMES } from "../src/adapters/dashboard/registries.js";
import { LANES, laneOf } from "../src/adapters/dashboard/web/lanes.js";
import { narrate } from "../src/adapters/dashboard/web/narrate.js";
import { router, withBrainSwitch } from "../src/adapters/dashboard/web/server.js";
import { mergeRepeats } from "../src/adapters/dashboard/web/views/mechanism-panel.js";
import { heroHeadline, ownerName } from "../src/adapters/dashboard/web/views/overview.js";
import { memoriesHeld, memoriesLive } from "../src/adapters/dashboard/web/views/shared.js";
import { MECHANISM_PROOFS, mechanismsView } from "../src/adapters/dashboard/web/views/mechanisms.js";
import { seedDemo, seedEmpty } from "../tools/demo/seed.js";

const WEB = fileURLToPath(new URL("../src/adapters/dashboard/web/", import.meta.url));
const HOST = "127.0.0.1:4747";
const IDS = MECHANISM_PROOFS.map((m) => m.id);
// Since home round 3b every built mechanism has a picture of our own memories.
const PICTURED = MECHANISM_PROOFS.filter((m) => m.build !== "not").map((m) => m.id);

let richDir: string;
let emptyDir: string;

beforeAll(async () => {
  richDir = mkdtempSync(join(tmpdir(), "counterparts-home-rich-"));
  emptyDir = mkdtempSync(join(tmpdir(), "counterparts-home-empty-"));
  await seedDemo({ dir: richDir });
  seedEmpty({ dir: emptyDir });
});

afterAll(() => {
  for (const d of [richDir, emptyDir]) rmSync(d, { recursive: true, force: true });
});

function withSource<T>(dir: string, fn: (src: DashboardSource) => T): T {
  const dash = Dashboard.open({ dir });
  try {
    return fn(dash.source);
  } finally {
    dash.close();
  }
}

function get(src: DashboardSource, path: string): { status: number; headers: Record<string, string>; json: Record<string, unknown> } {
  const reply = router(new URL(`http://${HOST}${path}`), HOST, src);
  const json = (reply.headers["content-type"] ?? "").startsWith("application/json")
    ? (JSON.parse(reply.body) as Record<string, unknown>)
    : {};
  return { status: reply.status, headers: reply.headers, json };
}

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.set(relative(dir, full), createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}

describe("the headline (round 4, 2026-09-28)", () => {
  type HeroJson = { headline: string; memories: number; newToday: number };

  test("one line: the day and whose memory it is, the one memory count, how many are new today", () => {
    withSource(richDir, (src) => {
      const d = get(src, "/api/overview").json;
      const hero = d["hero"] as HeroJson;
      const today = d["today"] as { newToday: number };
      const live = memoriesLive(src);
      const owner = ownerName(src);
      expect(owner).not.toBeNull();
      const tail = today.newToday > 0 ? ` · ${today.newToday} new today` : "";
      expect(hero.headline).toBe(`Day ${src.store.livedDay()} with ${owner} · ${live} memories${tail}`);
      expect(Object.keys(hero).sort()).toEqual(["headline", "memories", "newToday"]);
      expect(hero.memories).toBe(live);
      expect(hero.newToday).toBe(today.newToday);
      // No mechanism score and no tiles: those went to Health, or went.
      expect(hero.headline).not.toContain("built");
      expect(hero.headline).not.toContain("active this week");
    });
    expect(heroHeadline({ day: 7, lived: true, owner: "Mike", memories: 306, newToday: 13 })).toBe("Day 7 with Mike · 306 memories · 13 new today");
    expect(heroHeadline({ day: 7, lived: true, owner: null, memories: 1, newToday: 0 })).toBe("Day 7 · 1 memory");
  });

  test("ONE memory count: home, the memories header and the list's live chip say the same number", () => {
    withSource(richDir, (src) => {
      const hero = get(src, "/api/overview").json["hero"] as HeroJson;
      const header = get(src, "/api/memories").json as { total: number };
      const list = get(src, "/api/memories/list?state=live").json as { counts: { live: number } };
      expect(hero.memories).toBe(list.counts.live);
      expect(header.total).toBe(list.counts.live);
      // It includes the people and project cards the console counts apart.
      expect(memoriesLive(src)).toBeGreaterThan(memoriesHeld(src));
    });
    const page = readFileSync(join(WEB, "pages/memories/index.js"), "utf8");
    expect(page).toContain('return d.total + (d.total === 1 ? " memory" : " memories")');
  });

  test("home's memory count is doctor's plus the people and project cards (the health line says so)", () => {
    withSource(richDir, (src) => {
      const doctor = src.store.countMemories({ type: "memory", archived: false });
      const cards = src.store.countMemories({ type: "schema", archived: false });
      expect(cards).toBeGreaterThan(0);
      expect(memoriesLive(src)).toBe(doctor + cards);
    });
  });

  test("a store that has lived nothing says so, and counts nothing", () => {
    withSource(emptyDir, (src) => {
      const hero = get(src, "/api/overview").json["hero"] as HeroJson;
      expect(hero.headline).toBe("Nothing lived yet · 0 memories");
      expect(hero.newToday).toBe(0);
    });
  });
});

describe("the feeds (round 2)", () => {
  test("the overview's feed is memory events only; the split is one table covering every durable event", () => {
    for (const name of DURABLE_EVENT_NAMES) expect(Object.keys(LANES)).toContain(name);
    withSource(richDir, (src) => {
      const feed = get(src, "/api/overview").json["feed"] as { name: string; lane: string; icon: string | null }[];
      expect(feed.length).toBeGreaterThan(0);
      for (const e of feed) {
        expect(`${e.name}: ${e.lane}`).toBe(`${e.name}: home`);
        expect(e.icon).not.toBeNull();
      }
      // The flow tab's feed still carries the housekeeping.
      const flow = get(src, "/api/flow").json["feed"] as { lane: string }[];
      expect(flow.some((e) => e.lane === "flow")).toBe(true);
    });
    for (const name of ["adapter.embed.backfill", "adapter.semantic.lag", "self.briefing", "adapter.boundary", "recall.decision"]) {
      expect(`${name}: ${laneOf(name, {})}`).toBe(`${name}: flow`);
    }
    expect(laneOf("recall.credit", { credited: 0 })).toBe("flow");
    expect(laneOf("recall.credit", { credited: 2 })).toBe("home");
    expect(laneOf("recall.credit", { credited: 0, reason: "failed" })).toBe("home");
  });

  test("the live feed is the flow tab's alone now: Home has no feed (round 4)", () => {
    const flow = readFileSync(join(WEB, "pages/flow/sections/feed.js"), "utf8");
    expect(flow).toContain('registerLiveFeed("flow-feed")');
    expect(existsSync(join(WEB, "pages/home/sections/live-activity.js"))).toBe(false);
    expect(readFileSync(join(WEB, "pages/home/index.js"), "utf8")).not.toContain("registerLiveFeed");
  });

  test("orange is for real problems: a semantic cue that worked is calm", () => {
    withSource(emptyDir, (src) => {
      const row = (payload: Record<string, unknown>) =>
        ({ seq: 1, at: 0, day: 0, name: "adapter.semantic.lag", ref: null, payload: JSON.stringify(payload) }) as Parameters<typeof narrate>[1];
      expect(narrate(src.store, row({ reason: "ok", hits: 4 })).tone).toBe("calm");
      expect(narrate(src.store, row({ reason: "embedder-off", hits: 0 })).tone).toBe("calm");
      expect(narrate(src.store, row({ reason: "embed-failed", hits: 0 })).tone).toBe("amber");
    });
  });

  test("the panel's Lately merges neighbours that read the same, keeping the newest record", () => {
    const line = (seq: number, text: string) => ({ seq, text, name: "gate.deposit" }) as unknown as Parameters<typeof mergeRepeats>[0][number];
    const merged = mergeRepeats([line(9, "a"), line(8, "a"), line(7, "b"), line(6, "a")]);
    expect(merged.map((m) => [m.seq, m.text, m.repeats])).toEqual([[9, "a", 2], [7, "b", 1], [6, "a", 1]]);
    withSource(richDir, (src) => {
      const act = get(src, "/api/mechanism?id=salience").json["activity"] as { text: string; repeats: number }[];
      expect(act.length).toBeGreaterThan(0);
      for (let i = 1; i < act.length; i++) expect(act[i]!.text).not.toBe(act[i - 1]!.text);
      expect(act.some((a) => a.repeats > 1)).toBe(true);
    });
  });
});

describe("/api/mechanism — the panel's data", () => {
  test("every mechanism answers; a grey one has no picture and no activity; a stranger is a 404", () => {
    withSource(richDir, (src) => {
      const lights = Object.fromEntries(mechanismsView(src).mechanisms.map((m) => [m.id, m.status]));
      for (const id of IDS) {
        const res = get(src, `/api/mechanism?id=${id}`);
        expect(`${id} → ${res.status}`).toBe(`${id} → 200`);
        const built = (MECHANISM_PROOFS.find((m) => m.id === id)?.build ?? "not") !== "not";
        expect(res.json["built"]).toBe(built);
        if (!built) {
          expect(lights[id]).toBe("grey");
          expect(res.json["picture"]).toBeNull();
          expect(res.json["activity"]).toEqual([]);
        }
        const picture = res.json["picture"] as { kind: string } | null;
        if (PICTURED.includes(id)) expect(picture?.kind).toBe(id);
      }
      expect(get(src, "/api/mechanism?id=telepathy").status).toBe(404);
      expect(get(src, "/api/mechanism").status).toBe(404);
    });
  });

  test("the pictures are this store's: real curves, real turns, real climbers, real hubs, real corrections", () => {
    withSource(richDir, (src) => {
      const pic = (id: string): Record<string, unknown> => get(src, `/api/mechanism?id=${id}`).json["picture"] as Record<string, unknown>;
      const decay = pic("decay") as { curves: { points: [number, number][]; now: number }[]; day: number };
      expect(decay.curves.length).toBe(4);
      for (const c of decay.curves) {
        // strength only falls along an unused curve
        for (let i = 1; i < c.points.length; i++) expect(c.points[i]![1]).toBeLessThanOrEqual(c.points[i - 1]![1] + 1e-9);
        expect(c.points.find((p) => p[0] === decay.day)?.[1]).toBe(c.now);
      }
      expect((pic("retrieval")["turns"] as unknown[]).length).toBeGreaterThan(0);
      // Consolidation shows what it did this week, never a list of core candidates (3b).
      expect(pic("consolidation")["climbing"]).toBeUndefined();
      expect(Array.isArray(pic("consolidation")["memories"])).toBe(true);
      expect((pic("association")["hubs"] as unknown[]).length).toBeGreaterThan(0);
      const revs = pic("reconsolidation")["revisions"] as { crossed: boolean; pressure: number; bar: number }[];
      expect(revs.length).toBeGreaterThan(0);
      for (const r of revs) expect(r.crossed).toBe(r.bar > 0 && r.pressure >= r.bar);
      // Activity lines are firings that COUNT: a crossing up is not forgetting.
      const decayActivity = get(src, "/api/mechanism?id=decay").json["activity"] as { name: string; text: string }[];
      for (const e of decayActivity) expect(e.text).not.toContain("moved up");
    });
  });

  test("an empty store draws empty pictures, never a crash", () => {
    withSource(emptyDir, (src) => {
      for (const id of IDS) expect(get(src, `/api/mechanism?id=${id}`).status).toBe(200);
    });
  });

  test("looking writes nothing: every panel read leaves the store byte-identical", () => {
    withSource(richDir, (src) => {
      const before = snapshot(richDir);
      for (const id of IDS) get(src, `/api/mechanism?id=${id}`);
      get(src, "/api/overview");
      get(src, "/brain");
      expect(snapshot(richDir)).toEqual(before);
    });
  });
});

describe("the pictures and the brain's map (client modules)", () => {
  test("every picture renders from a real payload, an empty one and none at all", async () => {
    const index = (await import(join(WEB, "mechanisms/index.js"))) as {
      PANELS: Record<string, { picture(p: unknown): string }>;
      guideUrl(id: string): string;
    };
    expect(Object.keys(index.PANELS).sort()).toEqual([...PICTURED].sort());
    for (const dir of [richDir, emptyDir]) {
      withSource(dir, (src) => {
        for (const id of PICTURED) {
          const payload = get(src, `/api/mechanism?id=${id}`).json["picture"];
          const html = index.PANELS[id]!.picture(payload);
          expect(`${id}: ${typeof html === "string" && html.length > 20}`).toBe(`${id}: true`);
          expect(typeof index.PANELS[id]!.picture(null)).toBe("string");
        }
      });
    }
    for (const id of IDS) expect(index.guideUrl(id)).toMatch(/^https:\/\/counterparts\.ai\/(ecosystem\/)?#/);
    expect(index.guideUrl("association")).toBe("https://counterparts.ai/#brain");
  });

  test("the brain's regions carry every mechanism exactly once, in the site's mapping", async () => {
    const { REGIONS } = (await import(join(WEB, "mechanisms/regions.js"))) as {
      REGIONS: { key: string; active: boolean; mechanisms: string[] }[];
    };
    const placed = REGIONS.flatMap((r) => r.mechanisms);
    expect([...placed].sort()).toEqual([...IDS].sort());
    expect(new Set(placed).size).toBe(placed.length);
    expect(REGIONS.find((r) => r.key === "cerebellum")?.active).toBe(false);
    for (const r of REGIONS) if (r.active) expect(r.mechanisms.length).toBeGreaterThan(0);
  });
});

describe("the brain moved home", () => {
  test("/brain redirects to the home tab, and brain.html is gone", () => {
    withSource(emptyDir, (src) => {
      const res = get(src, "/brain");
      expect(res.status).toBe(302);
      expect(res.headers["location"]).toBe("/#home");
    });
    expect(existsSync(join(WEB, "brain.html"))).toBe(false);
    expect(readFileSync(join(WEB, "app.html"), "utf8")).not.toContain('href="/brain"');
  });

  test("three.js is vendored, pinned and licensed, and nothing under web/ reaches a CDN", () => {
    const three = readFileSync(join(WEB, "shared/vendor/three.module.min.js"), "utf8");
    expect(three.slice(0, 400)).toContain('const t="169"');
    expect(readFileSync(join(WEB, "shared/vendor/MIT-three.txt"), "utf8")).toContain("MIT License");
    expect(readFileSync(join(WEB, "pages/home/brain.js"), "utf8")).toContain('from "../../shared/vendor/three.module.min.js"');
    const walk = (at: string, out: string[] = []): string[] => {
      for (const e of readdirSync(at, { withFileTypes: true })) {
        const full = join(at, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (/\.(js|css|html)$/.test(e.name) && !full.includes("/vendor/")) out.push(full);
      }
      return out;
    };
    for (const file of walk(WEB)) expect(`${relative(WEB, file)}: ${readFileSync(file, "utf8").includes("cdn.jsdelivr")}`).toBe(`${relative(WEB, file)}: false`);
  });

  // THE PLUGIN DIRECTORY'S BUNDLE carries no three.js (2026-10-14): the
  // server says so in the page, and the home tab draws without the picture.
  test("the page says whether the picture's library is here; without it the home tab never asks for the picture", async () => {
    const app = readFileSync(join(WEB, "app.html"), "utf8");
    expect(app.split('<meta name="counterparts-brain" content="on">').length).toBe(2);
    withSource(emptyDir, (src) => {
      expect(router(new URL(`http://${HOST}/`), HOST, src).body).toContain('<meta name="counterparts-brain" content="on">');
    });
    const off = withBrainSwitch(app, false);
    expect(off).toContain('<meta name="counterparts-brain" content="off">');
    expect(off).not.toContain('content="on"');
    expect(withBrainSwitch(app, true)).toBe(app);
    // The section loads the picture only on "on", and never by a static import.
    const section = readFileSync(join(WEB, "pages/home/sections/brain.js"), "utf8");
    expect(section).not.toMatch(/^import[^\n]*["']\.\.\/brain\.js["']/m);
    const { pictureServed } = (await import(join(WEB, "pages/home/sections/brain.js"))) as { pictureServed: (doc: unknown) => boolean };
    const docWith = (content: string | null) => ({ querySelector: () => (content === null ? null : { getAttribute: () => content }) });
    expect(pictureServed(docWith("on"))).toBe(true);
    expect(pictureServed(docWith(null))).toBe(true);
    expect(pictureServed(docWith("off"))).toBe(false);
  });
});

describe("the feed prints bytes as whole numbers", () => {
  test("no narrated line in the demo store says `.00 bytes`", () => {
    withSource(richDir, (src) => {
      const lines = src.store.eventLog({ limit: 5000 }).map((r) => narrate(src.store, r).text);
      const withBytes = lines.filter((t) => t.includes(" bytes"));
      expect(withBytes.length).toBeGreaterThan(0);
      for (const t of withBytes) expect(t).not.toMatch(/\d\.\d+ bytes/);
    });
  });
});

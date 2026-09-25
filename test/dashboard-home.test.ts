/**
 * The home page: the hero's words (`/api/overview`'s `hero`), the mechanism
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
import { narrate } from "../src/adapters/dashboard/web/narrate.js";
import { router } from "../src/adapters/dashboard/web/server.js";
import { archiveEntry } from "../src/adapters/dashboard/web/views/archive-words.js";
import { memoriesHeld } from "../src/adapters/dashboard/web/views/shared.js";
import { MECHANISM_PROOFS, mechanismsView } from "../src/adapters/dashboard/web/views/mechanisms.js";
import { seedDemo, seedEmpty } from "../tools/demo/seed.js";

const WEB = fileURLToPath(new URL("../src/adapters/dashboard/web/", import.meta.url));
const HOST = "127.0.0.1:4747";
const IDS = MECHANISM_PROOFS.map((m) => m.id);
const PICTURED = ["salience", "decay", "retrieval", "association", "consolidation", "reconsolidation"];

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

describe("the hero", () => {
  test("one headline line and four plain counts that agree with the console", () => {
    withSource(richDir, (src) => {
      const hero = get(src, "/api/overview").json["hero"] as {
        headline: string; counts: { label: string; value: string }[]; working: number; mechanisms: number;
      };
      const held = memoriesHeld(src);
      const working = mechanismsView(src).mechanisms.filter((m) => m.status === "green").length;
      expect(hero.headline).toBe(`Day ${src.store.livedDay()}. Holding ${held} memories. ${working} of 11 mechanisms working.`);
      expect(hero.counts.map((c) => c.label)).toEqual(["memories held", "core memories", "chapters written", "archived"]);
      expect(hero.counts[0]?.value).toBe(String(held));
      expect([hero.working, hero.mechanisms]).toEqual([working, 11]);
    });
  });

  test("the archived count names its most common reason in the shared plain words", () => {
    withSource(richDir, (src) => {
      const counts = get(src, "/api/overview").json["hero"] as { counts: { label: string; note: string }[] };
      const note = counts.counts.find((c) => c.label === "archived")?.note ?? "";
      const tally = new Map<string, number>();
      for (const id of src.store.list()) {
        const row = src.store.row(id);
        if (row?.archived === 1 && row.archived_reason !== null) tally.set(row.archived_reason, (tally.get(row.archived_reason) ?? 0) + 1);
      }
      const top = [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      const words = top === undefined ? undefined : archiveEntry(top[0]);
      expect(note).toContain(words === undefined ? "set aside" : words.many);
      expect(note).toContain("kept, not deleted");
    });
  });

  test("each hero count is a link to where it is shown in full", () => {
    const tiles = readFileSync(join(WEB, "pages/home/sections/tiles.js"), "utf8");
    for (const [label, to] of [
      ["memories held", "memories?state=live"],
      ["core memories", "self/settling"],
      ["chapters written", "self/journal"],
      ["archived", "memories?state=archived"],
    ]) expect(tiles).toContain(`"${label}": "${to}"`);
  });

  test("a store that has lived nothing says so, and counts nothing", () => {
    withSource(emptyDir, (src) => {
      const hero = get(src, "/api/overview").json["hero"] as { headline: string; counts: { absent: boolean }[] };
      expect(hero.headline).toBe("Nothing lived yet. Holding 0 memories. 0 of 11 mechanisms working.");
      expect(hero.counts.every((c) => c.absent)).toBe(true);
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
        const built = MECHANISM_PROOFS.find((m) => m.id === id)?.built === true;
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
      expect((pic("consolidation")["climbing"] as unknown[]).length).toBeGreaterThan(0);
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

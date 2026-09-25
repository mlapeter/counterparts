/**
 * `/api/mechanisms` and `web/mechanisms/` — the eleven lights.
 *
 * Hermetic: every store here is a temp dir this file creates and removes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../src/core/counterpart.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import { DURABLE_EVENT_NAMES } from "../src/adapters/dashboard/registries.js";
import { router } from "../src/adapters/dashboard/web/server.js";
import {
  FAMILIES,
  MECHANISM_DAYS,
  MECHANISM_PROOFS,
  mechanismsView,
} from "../src/adapters/dashboard/web/views/mechanisms.js";
import type { MechanismsView } from "../src/adapters/dashboard/web/views/mechanisms.js";
import { seedDemo, seedEmpty } from "../tools/demo/seed.js";

const WEB = fileURLToPath(new URL("../src/adapters/dashboard/web/", import.meta.url));
const SITE_IDS = [
  "salience", "emotional", "decay", "interference", "retrieval", "association",
  "prospective", "consolidation", "reconsolidation", "episodic-semantic", "schema",
];

let richDir: string;
let emptyDir: string;
const temps: string[] = [];
const tempDir = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};

beforeAll(async () => {
  richDir = tempDir("counterparts-mech-rich-");
  emptyDir = tempDir("counterparts-mech-empty-");
  await seedDemo({ dir: richDir });
  seedEmpty({ dir: emptyDir });
});

afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function viewOf(dir: string): MechanismsView {
  const dash = Dashboard.open({ dir });
  try {
    return mechanismsView(dash.source);
  } finally {
    dash.close();
  }
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

describe("the mapping", () => {
  test("covers every non-parked site mechanism, once, in the site's order", () => {
    expect(MECHANISM_PROOFS.map((m) => m.id)).toEqual(SITE_IDS);
    for (const m of MECHANISM_PROOFS) expect(FAMILIES).toContain(m.family);
  });

  test("every client module matches the server table: same ids, same families, an explainer each", async () => {
    const folders = readdirSync(join(WEB, "mechanisms"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(folders).toEqual([...SITE_IDS].sort());
    const index = (await import(join(WEB, "mechanisms/index.js"))) as {
      MECHANISMS: {
        id: string; family: string; name: string; short: string; explainer: string; inDev: boolean;
        built: string[]; inDevelopment: string[];
      }[];
      FAMILIES: { key: string }[];
    };
    expect(index.MECHANISMS.map((m) => m.id)).toEqual(SITE_IDS);
    expect(index.FAMILIES.map((f) => f.key)).toEqual([...FAMILIES]);
    for (const m of index.MECHANISMS) {
      const row = MECHANISM_PROOFS.find((p) => p.id === m.id);
      expect(`${m.id}: ${m.family}`).toBe(`${m.id}: ${row?.family}`);
      expect(m.name.length).toBeGreaterThan(2);
      expect(m.short.length).toBeGreaterThan(2);
      // One or two plain sentences.
      const sentences = m.explainer.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
      expect(`${m.id}: ${sentences.length}`).toMatch(/: [12]$/);
      // What's built / what's still in development: 2–4 plain bullets in all.
      const bullets = m.built.length + m.inDevelopment.length;
      expect(`${m.id}: ${bullets >= 1 && bullets <= 4}`).toBe(`${m.id}: true`);
      // A grey mechanism claims nothing built beyond what exists without firing.
      const proof = MECHANISM_PROOFS.find((p) => p.id === m.id);
      if (proof && !proof.built) expect(m.inDevelopment.length).toBeGreaterThan(0);
    }
  });

  test("a built mechanism names durable events; a grey one names none and says why", () => {
    for (const m of MECHANISM_PROOFS) {
      if (m.built) {
        expect(`${m.id}: ${m.proofs.length > 0}`).toBe(`${m.id}: true`);
        for (const p of m.proofs) expect(DURABLE_EVENT_NAMES).toContain(p.event);
      } else {
        expect(`${m.id}: ${m.proofs.length}`).toBe(`${m.id}: 0`);
        expect((m.grey ?? "").length).toBeGreaterThan(10);
      }
    }
  });
});

describe("the lights, on a seeded store", () => {
  test("the demo store: what fired is green and backed by real rows inside the window", () => {
    const v = viewOf(richDir);
    expect(v.livedDay).toBeGreaterThan(MECHANISM_DAYS);
    expect(v.fromDay).toBe(v.livedDay - (MECHANISM_DAYS - 1));
    const by = Object.fromEntries(v.mechanisms.map((m) => [m.id, m]));
    for (const id of ["salience", "decay", "retrieval", "consolidation", "reconsolidation"]) {
      expect(`${id}: ${by[id]?.status}`).toBe(`${id}: green`);
    }
    // The seeder never flushes an association, so it is built and quiet.
    expect(by["association"]?.status).toBe("amber");
    expect(by["association"]?.events).toEqual([]);

    const dash = Dashboard.open({ dir: richDir });
    try {
      for (const m of v.mechanisms.filter((x) => x.status === "green")) {
        const names = MECHANISM_PROOFS.find((p) => p.id === m.id)!.proofs.map((p) => p.event as string);
        expect(m.events.length).toBeGreaterThan(0);
        expect(m.evidence).toMatch(/^\d+ /);
        for (const seq of m.events) {
          const row = dash.source.store.eventLog({ sinceDay: v.fromDay, limit: 100_000 }).find((r) => r.seq === seq);
          expect(`${m.id} #${seq}: ${row === undefined ? "missing" : "in window"}`).toBe(`${m.id} #${seq}: in window`);
          expect(names).toContain(row!.name);
        }
      }
    } finally {
      dash.close();
    }
  });

  test("grey never claims activity — even when the log holds rows that look like it", () => {
    const v = viewOf(richDir);
    // The demo seeder calls `fire()` by hand, so the log holds `prospective.fire`
    // rows no live path could write. The light must not borrow them.
    const dash = Dashboard.open({ dir: richDir });
    try {
      expect(dash.source.store.eventLog({ name: "prospective.fire", limit: 10 }).length).toBeGreaterThan(0);
    } finally {
      dash.close();
    }
    const greys = v.mechanisms.filter((m) => m.status === "grey");
    expect(greys.map((m) => m.id).sort()).toEqual(
      ["emotional", "episodic-semantic", "interference", "prospective", "schema"],
    );
    for (const m of greys) {
      expect(m.events).toEqual([]);
      expect(m.evidence).not.toMatch(/\d/);
      expect(m.evidence).toMatch(/^In development/);
    }
  });

  test("an empty store: nothing is green, built ones say they have no record yet", () => {
    const v = viewOf(emptyDir);
    for (const m of v.mechanisms) {
      expect(m.status).not.toBe("green");
      expect(m.events).toEqual([]);
      if (MECHANISM_PROOFS.find((p) => p.id === m.id)!.built) {
        expect(m.status).toBe("amber");
        expect(m.evidence).toContain("no record");
      }
    }
  });

  test("the window is LIVED days, and a row that lands whether or not the mechanism acted does not count", () => {
    const dir = tempDir("counterparts-mech-window-");
    const c = Counterpart.open({ dir, owner: true });
    try {
      // Ten lived days.
      for (let i = 1; i <= 10; i++) c.store.advanceClock(`2026-01-${String(i).padStart(2, "0")}`);
      const day = c.store.livedDay();
      expect(day).toBeGreaterThanOrEqual(9);
      // Decay fired on a day outside the window; retrieval inside it; a cycle
      // that faded nothing is not decay; a flush that wrote no rows is not
      // association.
      c.store.appendEvent({ name: "memory.pruned", day: day - MECHANISM_DAYS, payload: {} });
      c.store.appendEvent({ name: "sleep.cycle", day, payload: { faded: 0 } });
      c.store.appendEvent({ name: "associate.flush", day, payload: { rows: 0 } });
      c.store.appendEvent({ name: "recall.decision", day, ref: "s1", payload: { surfacedCount: 2, footnoteCount: 0 } });
    } finally {
      c.close();
    }
    const v = viewOf(dir);
    const by = Object.fromEntries(v.mechanisms.map((m) => [m.id, m]));
    expect(by["decay"]?.status).toBe("amber");
    expect(by["decay"]?.evidence).toContain(`lived day ${v.livedDay - MECHANISM_DAYS}`);
    expect(by["association"]?.status).toBe("amber");
    expect(by["retrieval"]?.status).toBe("green");
    expect(by["retrieval"]?.evidence).toStartWith("1 turn brought memories to mind");
  });
});

describe("observer guarantees", () => {
  test("the view and its route write nothing — not a byte of the store moves", () => {
    const before = snapshot(richDir);
    const dash = Dashboard.open({ dir: richDir });
    try {
      mechanismsView(dash.source);
      const reply = router(new URL("http://127.0.0.1:4747/api/mechanisms"), "127.0.0.1:4747", dash.source);
      expect(reply.status).toBe(200);
      expect(String(reply.headers["content-type"])).toContain("application/json");
    } finally {
      dash.close();
    }
    expect(snapshot(richDir)).toEqual(before);
  });
});

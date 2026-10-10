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
import { sourceOf } from "../src/adapters/dashboard/source.js";
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
  "prospective", "consolidation", "dreaming", "reconsolidation", "episodic-semantic", "schema",
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
      // The panel's one short line (home round 3b): a sentence or two, short.
      const does = (m as unknown as { does?: string }).does ?? "";
      expect(`${m.id}: ${does.length > 10 && does.length <= 110}`).toBe(`${m.id}: true`);
      // What's built / what's still in development: 2–4 plain bullets in all.
      const bullets = m.built.length + m.inDevelopment.length;
      expect(`${m.id}: ${bullets >= 1 && bullets <= 4}`).toBe(`${m.id}: true`);
      // A grey mechanism claims nothing built beyond what exists without firing.
      const proof = MECHANISM_PROOFS.find((p) => p.id === m.id);
      if (proof && proof.build === "not") expect(m.inDevelopment.length).toBeGreaterThan(0);
    }
  });

  test("a built mechanism names durable events; a grey one names none and says why", () => {
    for (const m of MECHANISM_PROOFS) {
      if (m.build !== "not") {
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
    // The seeder's boundaries flush their co-use and contiguity links in-process,
    // and since 2026-09-28 the boundary writes an associate.flush row for that.
    expect(by["association"]?.status).toBe("green");
    expect(by["association"]?.events.length).toBeGreaterThan(0);

    const dash = Dashboard.open({ dir: richDir });
    try {
      for (const m of v.mechanisms.filter((x) => x.status === "green")) {
        const proof = MECHANISM_PROOFS.find((p) => p.id === m.id)!;
        const names = proof.proofs.map((p) => p.event as string);
        // Green is backed by rows: event rows, or — for the one mechanism whose
        // firing is arithmetic on a row (emotion, part A) — the census of rows
        // it acted on inside the window, which backs no event seq.
        if (proof.census === undefined) expect(m.events.length).toBeGreaterThan(0);
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
    const greys = v.mechanisms.filter((m) => m.status === "grey");
    // Gist is partly built since 2026-09-26 (a dream's pattern), and
    // interference since 2026-09-29 (merges, flags, the changed fade): not grey.
    expect(greys.map((m) => m.id).sort()).toEqual(["schema"]);
    for (const m of greys) {
      expect(m.events).toEqual([]);
      expect(m.evidence).not.toMatch(/\d/);
      expect(m.evidence).toMatch(/^In development/);
    }
  });

  test("prospective, on the demo store: built, it holds dated memories, and says how many (2026-09-26)", () => {
    const v = viewOf(richDir);
    const m = v.mechanisms.find((x) => x.id === "prospective");
    expect(["green", "amber"]).toContain(m?.status ?? "missing");
    expect(m?.evidence).toMatch(/\d+ dated memor(y|ies) held\./);
  });

  test("an empty store: nothing is green, built ones say they have no record yet", () => {
    const v = viewOf(emptyDir);
    for (const m of v.mechanisms) {
      expect(m.status).not.toBe("green");
      expect(m.events).toEqual([]);
      const proof = MECHANISM_PROOFS.find((p) => p.id === m.id)!;
      if (proof.build !== "not" && proof.held !== undefined) {
        // Built, but holding nothing it could act on: waiting (never grey, which means not built), and it says why.
        expect(m.status).toBe("waiting");
        expect(m.evidence).toBe(proof.held.none);
      } else if (proof.build !== "not") {
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

describe("times fired today (the sidebar's “Mechanisms today”, 2026-10-10)", () => {
  /** A store whose rows land at the given moments: `at` is the writer's clock. */
  function seedToday(dir: string): void {
    const now = Date.now();
    let t = now - 2 * 86_400_000; // two calendar days ago
    const c = Counterpart.open({ dir, owner: true, now: () => t });
    try {
      for (let i = 1; i <= 9; i++) c.store.advanceClock(`2026-01-${String(i).padStart(2, "0")}`);
      const day = c.store.livedDay();
      // Two days ago, inside the seven lived days but not today.
      c.store.appendEvent({ name: "gate.deposit", day, payload: { accepted: 4 } });
      c.store.appendEvent({ name: "recall.decision", day, ref: "s0", payload: { surfacedCount: 1, footnoteCount: 0 } });
      t = now;
      // Today: a deposit of three memories is ONE firing of Salience, not three.
      c.store.appendEvent({ name: "gate.deposit", day, payload: { accepted: 3 } });
      c.store.appendEvent({ name: "gate.deposit", day, payload: { accepted: 1 } });
      // A deposit that accepted nothing is no firing at all.
      c.store.appendEvent({ name: "gate.deposit", day, payload: { accepted: 0 } });
      // A flush that wrote eight links: one firing of Association.
      c.store.appendEvent({ name: "associate.flush", day, payload: { rows: 8 } });
      // One dream: its journal and its changes are ONE firing of Dreaming;
      // its merge proves Interference and Consolidation, its gist Gist.
      c.store.appendEvent({ name: "dream.journaled", day, ref: "drm_one", payload: { chars: 400 } });
      c.store.appendEvent({ name: "dream.changed", day, ref: "drm_one", payload: { applied: 12, merge: 1, gist: 2, link: 9 } });
    } finally {
      c.close();
    }
  }

  test("rows that proved it on the calendar day, not amounts; a dream's rows once; null when not built", () => {
    const dir = tempDir("counterparts-mech-today-");
    seedToday(dir);
    const v = viewOf(dir);
    const dash = Dashboard.open({ dir });
    try {
      expect(v.today).toBe(dash.source.store.today());
    } finally {
      dash.close();
    }
    const today = Object.fromEntries(v.mechanisms.map((m) => [m.id, m.firedToday]));
    expect(today).toEqual({
      salience: 2,
      emotional: 0,
      decay: 0,
      interference: 1,
      retrieval: 0, // its only turn was two days ago
      association: 1,
      prospective: 0,
      consolidation: 1,
      dreaming: 1,
      reconsolidation: 0,
      "episodic-semantic": 1,
      schema: null,
    });
    // The seven-day evidence still counts amounts, as it always has.
    const by = Object.fromEntries(v.mechanisms.map((m) => [m.id, m]));
    expect(by["salience"]?.evidence).toStartWith("8 memories scored as they were written");
    expect(by["retrieval"]?.status).toBe("green");
  });

  test("today is the person's zone's calendar day: a minute before its midnight is yesterday, a minute after is today", () => {
    // Honolulu (UTC-10, no summer time): both rows fall on 2026-10-10 in UTC, a day apart on the person's clock.
    const zone = "Pacific/Honolulu";
    const dir = tempDir("counterparts-mech-today-zone-");
    let t = Date.parse("2026-10-10T09:59:00Z"); // Oct 9, 23:59 in Honolulu
    const c = Counterpart.open({ dir, owner: true, timeZone: zone, now: () => t });
    try {
      for (let i = 1; i <= 9; i++) c.store.advanceClock(`2026-10-0${String(i)}`);
      const day = c.store.livedDay();
      c.store.appendEvent({ name: "associate.flush", day, payload: { rows: 2 } });
      t = Date.parse("2026-10-10T10:01:00Z"); // Oct 10, 00:01 in Honolulu
      c.store.appendEvent({ name: "associate.flush", day, payload: { rows: 2 } });
    } finally {
      c.close();
    }
    const now = Date.parse("2026-10-10T20:00:00Z"); // Oct 10, 10:00 in Honolulu
    const o = Counterpart.open({ dir, observer: true, timeZone: zone, now: () => now });
    try {
      const v = mechanismsView(sourceOf(o));
      expect(v.today).toBe("2026-10-10");
      expect(v.mechanisms.find((m) => m.id === "association")?.firedToday).toBe(1);
    } finally {
      o.close();
    }
  });

  test("the route carries it, and reads nothing it should not: not a byte of the store moves", () => {
    const dir = tempDir("counterparts-mech-today-route-");
    seedToday(dir);
    const before = snapshot(dir);
    const dash = Dashboard.open({ dir });
    try {
      const reply = router(new URL("http://127.0.0.1:4747/api/mechanisms"), "127.0.0.1:4747", dash.source);
      expect(reply.status).toBe(200);
      const body = JSON.parse(reply.body) as MechanismsView;
      expect(typeof body.today).toBe("string");
      expect(body.mechanisms.find((m) => m.id === "salience")?.firedToday).toBe(2);
    } finally {
      dash.close();
    }
    expect(snapshot(dir)).toEqual(before);
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

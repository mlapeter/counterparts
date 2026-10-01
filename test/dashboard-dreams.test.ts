/**
 * The dashboard's dream journal and the core's history (2026-09-26, dreaming
 * + consolidation): `/api/dreams`, the `dreams` part of `/api/mind`, and the
 * settling section's "became core / sent back / nominated" lists — plus the
 * durable names a dream leaves, registered, narrated and given a home.
 *
 * Read-only by construction, like every dashboard view: the store is
 * byte-identical after every read here. Hermetic: fresh temp dirs, removed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { DURABLE_EVENT_NAMES, DURABLE_EVENTS } from "../src/adapters/dashboard/registries.js";
import { EVENT_NODE } from "../src/adapters/dashboard/web/flow.js";
import { NARRATORS, REF_KIND } from "../src/adapters/dashboard/web/narrate.js";
import { router } from "../src/adapters/dashboard/web/server.js";
import { mindView } from "../src/adapters/dashboard/web/views.js";
import { coreHistory, dreamsView } from "../src/adapters/dashboard/web/views/dreams.js";

let dir: string;
let emptyDir: string;
const ids: Record<string, string> = {};
const id = (k: string): string => ids[k] as string;
let dreamId = "";

function mem(c: Counterpart, body: string, kind: "fact" | "self" | "person", day: number, meta?: Record<string, unknown>): string {
  return c.store.put({
    type: "memory",
    kind,
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...(meta === undefined ? {} : { meta }),
  });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-dash-dreams-"));
  emptyDir = mkdtempSync(join(tmpdir(), "counterparts-dash-dreams-empty-"));
  Counterpart.open({ dir: emptyDir, owner: true }).close();

  Counterpart.open({ dir, owner: true, identity: { name: "Mike" } }).close();
  const c = Counterpart.open({ dir, owner: true });
  try {
    c.store.advanceClock("2026-09-10");
    ids["old"] = mem(c, "The deploy script needs the migration step before the container starts.", "fact", c.store.livedDay());
    for (let d = 11; d <= 26; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    const day = c.store.livedDay();
    ids["a"] = mem(c, "The migration step must run before the container boots, or it boots empty.", "fact", day);
    ids["b"] = mem(c, "Run the migration before starting the container, otherwise it starts empty.", "fact", day);
    ids["self"] = mem(c, "I say what I do not know before I guess.", "self", day);
    ids["secret"] = mem(c, "A confidential note about the deploy migration container.", "fact", day, { confidential: true });

    const begun = c.dreams.begin({ session: "s-dream", scope: "/proj" });
    if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
    dreamId = begun.bundle.dream;
    const out = c.dreams.propose({
      dream: dreamId,
      session: "s-dream",
      changes: [
        { action: "merge", ids: [ids["a"] as string, ids["b"] as string], text: "Migrations run before the container boots." },
        { action: "link", a: ids["secret"] as string, b: ids["old"] as string },
        { action: "nominate-core", id: ids["self"] as string, why: "It is how I work." },
      ],
    });
    if (!out.ok) throw new Error("propose refused");
    ids["merged"] = out.results[0]?.id as string;
    c.dreams.journal({ dream: dreamId, session: "s-dream", title: "Boot order", text: "I dreamed the container kept **booting empty**." });

    // The core's history: a crossing with its lane, and the owner's door out.
    c.store.appendCoreEvent({ memoryId: ids["self"] as string, action: "promoted", day, lane: "fast", actor: "sleep" });
    c.store.updatePhysics(ids["self"] as string, { promotedIdentity: true });
    c.store.setBand(ids["self"] as string, "identity", day);
    const demoted = c.demoteCore(ids["self"] as string, { reason: "not who I am" });
    if (!demoted.ok) throw new Error(`demote refused: ${demoted.reason}`);
  } finally {
    c.close();
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(emptyDir, { recursive: true, force: true });
});

function withSource<T>(at: string, fn: (src: DashboardSource) => T): T {
  const dash = Dashboard.open({ dir: at });
  try {
    return fn(dash.source);
  } finally {
    dash.close();
  }
}

function snapshot(at: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (p: string): void => {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.set(relative(at, full), createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(at);
  return out;
}

describe("the dream journal view", () => {
  test("each dream: its state, title, journal, and every change naming the memories it touched", () => {
    const v = withSource(dir, (src) => dreamsView(src));
    expect(v.dreams.length).toBe(1);
    expect(v.more).toBe(0);
    const d = v.dreams[0];
    expect(d).toMatchObject({ id: dreamId, state: "journaled", title: "Boot order" });
    expect(d?.journal).toContain("booting empty");
    expect(d?.counts).toEqual({ merge: 1, link: 1, "nominate-core": 1 });
    expect(d?.changes.map((c) => c.action)).toEqual(["merge", "link", "nominate-core"]);
    // The merge names the memory it made, then the originals AS THEY STOOD
    // (their own words, not the merged memory's through the forwarding address).
    const merge = d?.changes[0];
    expect(merge?.memories.map((m) => m.id)).toEqual([id("merged"), id("a"), id("b")]);
    expect(merge?.memories[1]?.text).toContain("boots empty");
    expect(merge?.undone).toBe(false);
  });

  test("a confidential memory a dream touched is withheld here, as everywhere", () => {
    const v = withSource(dir, (src) => dreamsView(src));
    const link = v.dreams[0]?.changes.find((c) => c.action === "link");
    const secret = link?.memories.find((m) => m.id === ids["secret"]);
    expect(secret?.confidential).toBe(true);
    expect(secret?.text).not.toContain("confidential note");
  });

  test("it rides in /api/mind, and on its own route; a store that never dreamed says so", () => {
    withSource(dir, (src) => {
      const m = mindView(src);
      expect(m.dreams.dreams[0]?.id).toBe(dreamId);
      expect(m.dreamsAbsent).toBeNull();
      const reply = router(new URL("http://127.0.0.1:4747/api/dreams"), "127.0.0.1:4747", src);
      expect(reply.status).toBe(200);
      expect(JSON.parse(reply.body).dreams[0].id).toBe(dreamId);
    });
    withSource(emptyDir, (src) => {
      const m = mindView(src);
      expect(m.dreams.dreams).toEqual([]);
      expect(m.dreamsAbsent).not.toBeNull();
    });
  });
});

describe("what crossed lately", () => {
  test("became core with its lane, sent back with the owner's reason, nominated by a dream", () => {
    const h = withSource(dir, (src) => coreHistory(src));
    expect(h.promoted.map((r) => [r.id, r.lane])).toEqual([[id("self"), "fast"]]);
    expect(h.demoted.map((r) => [r.id, r.reason])).toEqual([[id("self"), "not who I am"]]);
    // The dream's own reason rides along when the gate battery kept it (a
    // short line can be refused by it, and is then simply absent).
    expect(h.nominated.map((r) => [r.id, r.dream])).toEqual([[id("self"), dreamId]]);
    const settling = withSource(dir, (src) => mindView(src).settling);
    expect(settling.history).toEqual(h);
  });
});

describe("a dream's durable rows have somewhere to go", () => {
  test("registered, glossed, narrated, given a node and a ref kind", () => {
    const names = [
      "dream.begun",
      "dream.changed",
      "dream.journaled",
      "dream.undone",
      "dream.ask",
      "band.demoted",
      "physics.upgrade.census",
    ];
    for (const name of names) {
      expect(DURABLE_EVENT_NAMES as readonly string[]).toContain(name);
      expect((DURABLE_EVENTS as Record<string, string>)[name]?.length ?? 0).toBeGreaterThan(20);
      expect(name in NARRATORS).toBe(true);
      expect(name in EVENT_NODE).toBe(true);
      expect(name in REF_KIND).toBe(true);
    }
    // The rows this store actually wrote are all names the dashboard knows.
    withSource(dir, (src) => {
      const seen = new Set(src.store.eventLog({ limit: 10_000 }).map((r) => r.name));
      expect(seen.has("dream.journaled")).toBe(true);
      expect(seen.has("band.demoted")).toBe(true);
      for (const name of seen) expect(DURABLE_EVENT_NAMES as readonly string[]).toContain(name);
    });
  });
});

describe("f8's follow-ups from #277 (2026-10-01)", () => {
  test("a merge's originals say how the dream saw them when it was less than whole", () => {
    const at = mkdtempSync(join(tmpdir(), "counterparts-dash-dreams-fidelity-"));
    try {
      Counterpart.open({ dir: at, owner: true }).close();
      const c = Counterpart.open({ dir: at, owner: true });
      const local: Record<string, string> = {};
      let dream = "";
      try {
        c.store.advanceClock("2026-09-20");
        const day = c.store.livedDay();
        local["made"] = mem(c, "The kettle in the studio needs descaling every month.", "fact", day);
        local["x"] = mem(c, "Descale the studio kettle once a month.", "fact", day);
        local["y"] = mem(c, "The studio kettle gets limescale fast; monthly descaling.", "fact", day);
        local["z"] = mem(c, "Limescale builds up in the studio kettle within a month.", "fact", day);
        const begun = c.dreams.begin({ session: "s-fid", scope: "/proj" });
        if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
        dream = begun.bundle.dream;
        // The shape `dreams.ts` writes (core/dream/index.ts#propose): the
        // originals and, per original, the fidelity the night's index gave it.
        c.store.recordDreamChange(dream, {
          action: "merge",
          ref: local["made"] as string,
          detail: { from: [local["x"], local["y"], local["z"]], fidelity: { [local["x"] as string]: "whole", [local["y"] as string]: "line", [local["z"] as string]: "excerpt" } },
        });
      } finally {
        c.close();
      }
      const v = withSource(at, (src) => dreamsView(src));
      const merge = v.dreams.find((d) => d.id === dream)?.changes.find((ch) => ch.action === "merge");
      const seen = new Map(merge?.memories.map((m) => [m.id, m.seen]));
      expect(seen.get(local["made"] as string)).toBeUndefined(); // what it made has no fidelity
      expect(seen.get(local["x"] as string)).toBeUndefined(); // whole: nothing to say
      expect(seen.get(local["y"] as string)).toBe("seen only as a line");
      expect(seen.get(local["z"] as string)).toBe("seen as an excerpt");
      // The page draws it beside the memory.
      const page = readFileSync(join(import.meta.dir, "../src/adapters/dashboard/web/pages/self/sections/dreams.js"), "utf8");
      expect(page).toContain('class="dr-seen"');
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  });

  test("dream.begun says what waits for the next night and what aged out, only when there is some", () => {
    const say = (p: Record<string, unknown>): string => NARRATORS["dream.begun"]({ store: null as never, row: {} as never, p }).text;
    expect(say({ fresh: 12, shown: 30 })).toBe("I began to dream, over 12 new memories and 30 in all.");
    expect(say({ fresh: 12, shown: 30, waiting: 0, agedOut: 0 })).toBe("I began to dream, over 12 new memories and 30 in all.");
    expect(say({ fresh: 40, shown: 52, waiting: 7, agedOut: 2 })).toBe(
      "I began to dream, over 40 new memories and 52 in all. 7 more wait for the next night; 2 grew too old to be dreamed and will fade as usual.",
    );
    expect(say({ fresh: 40, shown: 52, waiting: 1 })).toBe("I began to dream, over 40 new memories and 52 in all. 1 more waits for the next night.");
  });
});

describe("read-only", () => {
  test("the views and the route write nothing — not a byte of the store moves", () => {
    const before = snapshot(dir);
    withSource(dir, (src) => {
      dreamsView(src);
      coreHistory(src);
      mindView(src);
      router(new URL("http://127.0.0.1:4747/api/dreams"), "127.0.0.1:4747", src);
    });
    expect(snapshot(dir)).toEqual(before);
  });
});

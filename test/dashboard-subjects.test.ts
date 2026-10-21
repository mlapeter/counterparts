/**
 * The subjects tab (wave 2 lane D, 2026-10-21): `/api/subjects`,
 * `/api/subject?id=`, `/api/tag?tag=`, and the memory card's link to a
 * subject's page.
 *
 * What this file proves:
 *   1. An empty store answers every subjects endpoint with its absence named.
 *   2. Cards are subjects (an unjudged card as "not sorted yet"); the cloud
 *      is subjects alone until a memory carries a tag, then tags join it, a
 *      tag that is a subject's name merges into that subject, and concept
 *      edges ride on each word.
 *   3. A subject's page lists its beliefs strongest first, each with its
 *      counted support (once per memory), what argues against it, and its
 *      cited sources; its memories newest first, by name and by tag; and
 *      `me` resolves to the subject that is me once it exists.
 *   4. A belief made AFTER the dashboard opened shows up (read from the
 *      store, not from `schemas`' open-time copy).
 *   5. Every endpoint leaves the data dir byte-identical (observer).
 *
 * Hermetic: fresh temp dirs, removed after.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Dashboard, NEVER, NONE } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { router } from "../src/adapters/dashboard/web/server.js";
import type { SubjectPage, SubjectsView, TagView } from "../src/adapters/dashboard/web/views.js";

const HOST = "127.0.0.1:4747";
let temps: string[] = [];

afterEach(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
  temps = [];
});

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "counterparts-subjects-"));
  temps.push(d);
  return d;
}

function get<T>(src: DashboardSource, path: string): { status: number; json: T } {
  const reply = router(new URL(`http://localhost${path}`), HOST, src);
  return { status: reply.status, json: JSON.parse(reply.body) as T };
}

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(p, createHash("sha256").update(readFileSync(p)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}

/** A store with Mike (a person), a project nobody has sorted, memories naming them, and tags. */
function seeded(dir: string): { mike: string; dash: string; mem: Record<"a" | "b" | "c", string> } {
  const c = Counterpart.open({ dir });
  try {
    const day = c.store.livedDay();
    const mike = c.schemas.mention({ name: "Mike", kind: "person", source: "Mike", chunkRef: "card-mike", day }).id as string;
    const dash = c.schemas.mention({ name: "Dashboard", kind: "entity", source: "Dashboard", chunkRef: "card-dash", day }).id as string;
    c.store.setSubjectKind(mike, "person");
    const mem: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };
    mem["a"] = c.store.put({ type: "memory", kind: "fact", body: "Mike walked the Dashboard page by page." });
    mem["b"] = c.store.put({ type: "memory", kind: "fact", body: "Mike wants decisions kept light." });
    mem["c"] = c.store.put({ type: "memory", kind: "fact", body: "Taxes are due in April." });
    c.store.tagMemory(mem["a"], ["mike", "dashboard", "walk"], "write");
    c.store.tagMemory(mem["b"], ["mike", "decisions"], "write");
    c.store.tagMemory(mem["c"], ["taxes", "deadlines"], "write");
    return { mike, dash, mem };
  } finally {
    c.close();
  }
}

describe("the subjects endpoints over an empty store", () => {
  test("each names its absence, and nothing is an error", () => {
    const dir = tempDir();
    Counterpart.open({ dir }).close();
    const d = Dashboard.open({ dir });
    try {
      const all = get<SubjectsView>(d.source, "/api/subjects");
      expect(all.status).toBe(200);
      expect(all.json.cloud).toEqual([]);
      expect(all.json.groups).toEqual([]);
      expect(all.json.tagged).toBe(false);
      expect(all.json.self).toBeNull();
      expect([NONE, NEVER]).toContain(all.json.absent as string);
      expect([NONE, NEVER]).toContain(all.json.cloudAbsent as string);

      const me = get<SubjectPage>(d.source, "/api/subject?id=me");
      expect(me.status).toBe(200);
      expect(me.json.found).toBe(false);
      if (!me.json.found) expect(me.json.absent).toContain(NONE);

      const nope = get<SubjectPage>(d.source, "/api/subject?id=sch_000000000000");
      expect(nope.json.found).toBe(false);
      expect(get<{ error: string }>(d.source, "/api/subject").status).toBe(400);

      const tag = get<TagView>(d.source, "/api/tag?tag=taxes");
      expect(tag.json.total).toBe(0);
      expect(tag.json.absent).toBe(NONE);
      expect(get<{ error: string }>(d.source, "/api/tag?tag=%20").status).toBe(400);
    } finally {
      d.close();
    }
  });
});

describe("the subjects endpoints over a store with cards, tags and beliefs", () => {
  test("cards are subjects; the cloud merges a name tag into its subject and carries concept edges", () => {
    const dir = tempDir();
    const { mike, dash } = seeded(dir);
    const d = Dashboard.open({ dir });
    try {
      const v = get<SubjectsView>(d.source, "/api/subjects").json;
      expect(v.total).toBe(2);
      expect(v.tagged).toBe(true);
      const people = v.groups.find((g) => g.kind === "person");
      expect(people?.subjects.map((s) => s.id)).toEqual([mike]);
      const unsorted = v.groups.find((g) => g.kind === null);
      expect(unsorted?.label).toBe("Not sorted yet");
      expect(unsorted?.subjects.map((s) => s.id)).toEqual([dash]);

      const words = new Map(v.cloud.map((w) => [w.key, w]));
      // "mike" the tag IS Mike the subject: one word, opening his page.
      expect(words.has("t:mike")).toBe(false);
      expect(words.get(`s:${mike}`)?.subject).toBe(mike);
      expect(words.get("t:taxes")?.subject).toBeNull();
      expect(words.get("t:taxes")?.near).toContain("t:deadlines");
      expect(words.get(`s:${mike}`)?.near).toContain("t:decisions");
      // Alphabetical, sized 1–5.
      const order = v.cloud.map((w) => w.word.toLowerCase());
      expect(order).toEqual([...order].sort((a, b) => a.localeCompare(b)));
      for (const w of v.cloud) expect(w.size >= 1 && w.size <= 5).toBe(true);
    } finally {
      d.close();
    }
  });

  test("a subject's page: beliefs strongest first with support counted once, sources, and its memories by name and tag", () => {
    const dir = tempDir();
    const { mike, mem } = seeded(dir);
    const d = Dashboard.open({ dir });
    // Beliefs written AFTER the dashboard opened — what a night does while it runs.
    const c = Counterpart.open({ dir });
    let strong = "";
    let weak = "";
    try {
      const day = c.store.livedDay();
      strong = c.schemas.addBelief({ entityId: mike, statement: "Mike wants decisions kept light.", day, claimedSalience: 0.9, groundedIn: [mem["b"] as string] }).id as string;
      weak = c.schemas.addBelief({ entityId: mike, statement: "Mike walks pages one by one.", day, claimedSalience: 0.1 }).id as string;
      c.store.setBeliefFields(strong, { birthRoute: "reflection" });
      expect(c.store.fileSupport({ beliefId: strong, memoryId: mem["b"] as string, stance: "support", route: "lived", day, weight: 1 })).toBe(true);
      // Counted once: a second filing of the same memory adds nothing.
      expect(c.store.fileSupport({ beliefId: strong, memoryId: mem["b"] as string, stance: "support", route: "reflection", day, weight: 1 })).toBe(false);
      c.store.fileSupport({ beliefId: strong, memoryId: mem["a"] as string, stance: "contrary", route: "lived", day, weight: 1 });
    } finally {
      c.close();
    }
    try {
      const before = snapshot(dir);
      const p = get<SubjectPage>(d.source, `/api/subject?id=${mike}`).json;
      expect(p.found).toBe(true);
      if (!p.found) return;
      expect(p.name).toBe("Mike");
      expect(p.kind).toBe("person");
      expect(p.beliefs.map((b) => b.id)).toEqual([strong, weak]);
      const b = p.beliefs[0];
      expect(b?.support).toBe(1);
      expect(b?.contrary).toBe(1);
      expect(b?.route).toBe("reflection");
      // The support row and the contrary row; the cited source is the counted one, not listed twice.
      expect(b?.sources.map((s) => [s.id, s.stance])).toEqual([[mem["b"], "support"], [mem["a"], "contrary"]]);
      expect(p.beliefs[1]?.support).toBe(0);
      expect(p.beliefsAbsent).toBeNull();
      // Its memories: both name him; neither belief is listed among them.
      expect(new Set(p.memories.map((m) => m.id))).toEqual(new Set([mem["a"], mem["b"]]));
      expect(p.memories.every((m) => m.via === "both")).toBe(true);
      expect(p.near.map((n) => n.tag)).toContain("decisions");

      // The memory card links a belief to its subject's page, and a card to its own.
      const card = get<{ subject: { id: string; name: string; isCard: boolean; self: boolean } | null }>(d.source, `/api/memory?id=${strong}`).json;
      expect(card.subject).toEqual({ id: mike, name: "Mike", isCard: false, self: false });
      const own = get<{ subject: { id: string; isCard: boolean } | null }>(d.source, `/api/memory?id=${mike}`).json;
      expect(own.subject?.isCard).toBe(true);
      expect(get<{ subject: unknown }>(d.source, `/api/memory?id=${mem["c"]}`).json.subject).toBeNull();

      for (const path of ["/api/subjects", `/api/subject?id=${mike}`, "/api/subject?id=me", "/api/tag?tag=taxes"]) {
        expect(get<{ error?: string }>(d.source, path).json.error).toBeUndefined();
      }
      const tag = get<TagView>(d.source, "/api/tag?tag=Taxes").json;
      expect(tag.memories.map((m) => m.id)).toEqual([mem["c"]]);
      expect(tag.near.map((n) => n.tag)).toEqual(["deadlines"]);
      // Observer: nothing above wrote a byte.
      expect(snapshot(dir)).toEqual(before);
    } finally {
      d.close();
    }
  });

  test("`me` is the subject that is me once it exists, with its beliefs", () => {
    const dir = tempDir();
    seeded(dir);
    // Lane C's door: `Schemas#ensureSelfSubject` registers the card, so a belief can be minted on it at once.
    const c = Counterpart.open({ dir });
    const self = c.schemas.ensureSelfSubject();
    const belief = c.schemas.addBelief({ entityId: self, statement: "I say plainly what I checked.", day: c.store.livedDay() }).id as string;
    c.close();
    const d = Dashboard.open({ dir });
    try {
      const v = get<SubjectsView>(d.source, "/api/subjects").json;
      expect(v.self).toBe(self);
      expect(v.groups.find((g) => g.kind === "self")?.label).toBe("Me");
      const p = get<SubjectPage>(d.source, "/api/subject?id=me").json;
      expect(p.found).toBe(true);
      if (!p.found) return;
      expect(p.id).toBe(self);
      expect(p.self).toBe(true);
      expect(p.name).toBe("Me");
      expect(p.beliefs.map((b) => b.id)).toEqual([belief]);
      const card = get<{ subject: { self: boolean } | null }>(d.source, `/api/memory?id=${belief}`).json;
      expect(card.subject?.self).toBe(true);
    } finally {
      d.close();
    }
  });
});

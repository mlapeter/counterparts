/**
 * The memories tab's list (`/api/memories/list`) and the words the tab now
 * speaks in (kinds in plain words, archive reasons in plain words, strength by
 * band for the picture's margin).
 *
 * Hermetic: fresh temp stores, seeded through `tools/demo`, removed after.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { Dashboard, NEVER, NONE } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { buildArgv } from "../src/adapters/dashboard/web/actions.js";
import { router } from "../src/adapters/dashboard/web/server.js";
import { LIST_MAX, archiveWords, memoriesView, memoryListView } from "../src/adapters/dashboard/web/views.js";
import type { MemoryListView } from "../src/adapters/dashboard/web/views.js";
import { seedDemo, seedEmpty } from "../tools/demo/seed.js";

const HOST = "127.0.0.1:4747";
let richDir: string;
let emptyDir: string;

beforeAll(async () => {
  richDir = mkdtempSync(join(tmpdir(), "counterparts-memlist-rich-"));
  emptyDir = mkdtempSync(join(tmpdir(), "counterparts-memlist-empty-"));
  await seedDemo({ dir: richDir });
  seedEmpty({ dir: emptyDir });
});

afterAll(() => {
  for (const d of [richDir, emptyDir]) rmSync(d, { recursive: true, force: true });
});

function withSrc<T>(dir: string, fn: (src: DashboardSource) => T): T {
  const dash = Dashboard.open({ dir });
  try {
    return fn(dash.source);
  } finally {
    dash.close();
  }
}

function getList(src: DashboardSource, qs: string): MemoryListView {
  const reply = router(new URL(`http://${HOST}/api/memories/list${qs}`), HOST, src);
  expect(reply.status).toBe(200);
  return JSON.parse(reply.body) as MemoryListView;
}

/** Box 1 and box 2, hashed — box 3 (cache/) is the rebuildable index. */
function canonical(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const rel = relative(dir, full);
        if (rel.startsWith("cache/")) continue;
        out.set(rel, `${statSync(full).size}:${createHash("sha256").update(readFileSync(full)).digest("hex")}`);
      }
    }
  };
  walk(dir);
  return out;
}

describe("the list: every memory, newest first, paged by the server", () => {
  test("live by default, newest first, and its counts agree with the census", () => {
    withSrc(richDir, (src) => {
      const d = getList(src, "");
      const view = memoriesView(src);
      expect(d.state).toBe("live");
      expect(d.total).toBe(view.total);
      expect(d.counts.live).toBe(view.total);
      expect(d.rows.length).toBe(Math.min(50, d.total));
      for (let i = 1; i < d.rows.length; i++) {
        expect(d.rows[i - 1]!.bornDay).toBeGreaterThanOrEqual(d.rows[i]!.bornDay);
      }
      for (const r of d.rows) {
        expect(r.line.length).toBeGreaterThan(0);
        expect(r.archived).toBeNull();
        expect(r.livedDays).toBe(Math.max(0, d.day - r.bornDay));
      }
      // Every kind and band has a count, zero included (totality).
      expect(Object.keys(d.counts.kinds).length).toBe(6);
      expect(Object.keys(d.counts.bands).length).toBe(3);
    });
  });

  test("pages are disjoint and together are the whole list", () => {
    withSrc(richDir, (src) => {
      const first = getList(src, "?state=all&limit=40");
      const seen = new Set<string>();
      for (let off = 0; off < first.total; off += 40) {
        for (const r of getList(src, `?state=all&limit=40&offset=${off}`).rows) {
          expect(seen.has(r.id)).toBe(false);
          seen.add(r.id);
        }
      }
      expect(seen.size).toBe(first.total);
      expect(first.total).toBe(first.counts.live + first.counts.archived);
      // A schema row says whether it is an entity or a belief; a memory says nothing.
      const all = getList(src, "?state=all&limit=200");
      const roles = new Set(all.rows.filter((r) => r.schema).map((r) => r.schemaRole));
      expect(roles.has("entity")).toBe(true);
      expect(roles.has("belief")).toBe(true);
      for (const r of all.rows) if (!r.schema) expect(r.schemaRole).toBeNull();
    });
  });

  test("filters narrow; junk parameters are ignored, and the page size is capped", () => {
    withSrc(richDir, (src) => {
      const facts = getList(src, "?kind=fact&limit=200");
      expect(facts.total).toBe(facts.counts.kinds["fact"] ?? -1);
      for (const r of facts.rows) expect(r.kind).toBe("fact");
      const sem = getList(src, "?band=semantic&limit=200");
      for (const r of sem.rows) expect(r.band).toBe("semantic");
      const junk = getList(src, "?kind=nonsense&band=%3Cb%3E&state=whatever&limit=99999&offset=-4");
      expect(junk.kind).toBeNull();
      expect(junk.band).toBeNull();
      expect(junk.state).toBe("live");
      expect(junk.limit).toBe(LIST_MAX);
      expect(junk.offset).toBe(0);
    });
  });

  test("archived rows say why, in plain words, and show their OWN words", () => {
    withSrc(richDir, (src) => {
      const d = getList(src, "?state=archived&limit=200");
      expect(d.total).toBeGreaterThan(0);
      for (const r of d.rows) {
        expect(r.archived).not.toBeNull();
        expect(String(r.archived).length).toBeGreaterThan(3);
        if (r.archivedReason === "pruned") expect(r.archived).toContain("let go at the floor");
        // A revised row is listed with what IT said, not what replaced it.
        const row = src.store.row(r.id);
        if (row !== undefined && row.superseded_by !== null && row.confidential !== 1) {
          const own = row.body.split("\n").map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith("#")) ?? "";
          expect(r.line.startsWith(own.slice(0, 40))).toBe(true);
        }
      }
    });
  });

  test("the plain words for every reason the core writes", () => {
    expect(archiveWords("pruned", false)).toContain("let go at the floor");
    expect(archiveWords("handoff-cleared", false)).toBe("old handoff note cleared");
    expect(archiveWords("revised-by-pressure", true)).toContain("revised");
    expect(archiveWords("something-new", false)).toBe("archived (something-new)");
    expect(archiveWords(null, false)).toBe("archived, no reason recorded");
  });

  test("an empty store names its absence rather than going blank", () => {
    withSrc(emptyDir, (src) => {
      const d = getList(src, "");
      expect(d.rows.length).toBe(0);
      expect([NONE, NEVER]).toContain(String(d.absent));
    });
  });

  test("reading the list, archived rows included, leaves the store byte-identical", () => {
    const before = canonical(richDir);
    withSrc(richDir, (src) => {
      for (const qs of ["", "?state=archived&limit=200", "?state=all&offset=50", "?kind=self&band=identity"]) {
        getList(src, qs);
      }
      router(new URL(`http://${HOST}/api/memories`), HOST, src);
    });
    expect([...canonical(richDir).entries()]).toEqual([...before.entries()]);
  });
});

describe("the memories view speaks in words", () => {
  test("every kind carries plain words and a fade speed; strength-by-band covers every row", () => {
    withSrc(richDir, (src) => {
      const v = memoriesView(src);
      expect(v.kinds.length).toBe(6);
      for (const k of v.kinds) {
        expect(k.plain.label.length).toBeGreaterThan(0);
        expect(k.plain.fades.length).toBeGreaterThan(0);
        expect(k.fadeSpeed).toBeGreaterThan(0);
        expect(k.fadeSpeed).toBeLessThanOrEqual(1);
      }
      expect(v.memories + v.schemas).toBe(v.total);
      expect(v.schemas).toBeGreaterThan(0);
      const fact = v.kinds.find((k) => k.kind === "fact");
      expect(fact?.fadeSpeed).toBe(1);
      const sum = v.strengthByBand.reduce((a, s) => a + Object.values(s.bands).reduce((x, y) => x + y, 0), 0);
      expect(sum).toBe(v.total);
    });
  });

  test("an empty band has no colour to paint: identity is zero on an empty store", () => {
    withSrc(emptyDir, (src) => {
      const v = memoriesView(src);
      for (const s of v.strengthByBand) expect(s.bands["identity"]).toBe(0);
    });
  });
});

describe("ask can answer as data", () => {
  test("json: true adds --json, and nothing else changes", () => {
    const ctx = { dir: "/tmp/somewhere" };
    const plain = buildArgv("ask", { question: "tea" }, ctx).argv;
    const json = buildArgv("ask", { question: "tea", json: true }, ctx).argv;
    expect(plain).not.toContain("--json");
    expect(json).toContain("--json");
    expect(json.filter((a) => a !== "--json")).toEqual(plain);
    expect(json.indexOf("--json")).toBeLessThan(json.indexOf("--"));
  });
});

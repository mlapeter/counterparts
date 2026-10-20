/**
 * Reading last night (2026-10-20): `recall` opens a dream's id (`drm_…`) and a
 * reflection's (`rfl_…`) as a read-only summary, and the console's `night`
 * prints them with no write at all — so a session can review the night with
 * the owner without reaching for `dream`, which also undoes.
 *
 * Hermetic: a fresh temp store per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { nightKindOf } from "../src/adapters/mcp/nights.js";
import type { DreamSummary, ReflectionSummary } from "../src/adapters/mcp/nights.js";
import { run } from "../src/adapters/cli/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";

const SESSION = "sess_night_1";
const SECRET = "ZQSECRET the clinic appointment about the migraines";

let root: string;
let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-night-read-"));
  dir = join(root, "store");
  Counterpart.open({ dir }).close();
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

interface Night {
  dream: string;
  reflection: string;
  a: string;
  b: string;
  third: string;
  merged: string;
  gist: string;
  sources: string[];
}

/** One night: a dream that linked, merged and drew a gist, then a reflection after it. */
function night(): Night {
  const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" } });
  try {
    c.store.advanceClock("2026-09-20");
    const a = mem(c, "The migration step must run before the container boots, or it boots empty.");
    const b = mem(c, "Run the migration before starting the container, otherwise it starts empty.");
    const third = mem(c, "The health check should fail when the tables are missing.");
    const s1 = mem(c, "The dashboard's memory list sorts by lived day now.");
    const s2 = mem(c, "The dashboard deploys when main is pushed.");
    c.store.advanceClock("2026-09-21");
    const begun = c.dreams.begin({ session: SESSION });
    if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
    const dream = begun.bundle.dream;
    const proposed = c.dreams.propose({
      dream,
      session: SESSION,
      changes: [
        { action: "link", a, b: third },
        { action: "merge", ids: [a, b], text: "Run the migration before the container boots, or it boots empty." },
        { action: "gist", text: "The dashboard work is about being understood.", sources: [s1, s2] },
      ],
    });
    if (!proposed.ok) throw new Error("propose refused");
    const merged = proposed.results[1]?.id as string;
    const gist = proposed.results[2]?.id as string;
    const j = c.dreams.journal({ dream, session: SESSION, title: "Boot order", text: "I dreamed the container kept booting empty." });
    if (!j.ok) throw new Error("journal refused");
    const r = c.reflections.begin({ session: SESSION, dream });
    if (!r.ok) throw new Error(`reflect begin refused: ${r.reason}`);
    const done = c.reflections.finish({
      reflection: r.bundle.reflection,
      session: SESSION,
      title: "boot order",
      entry: "The dream kept the container booting empty. Order matters more than I said.",
      cites: [third],
      share: { text: "Last night I kept dreaming about boot order.", cites: [third] },
    });
    if (!done.ok) throw new Error(`reflect finish refused: ${done.reason}`);
    return { dream, reflection: r.bundle.reflection, a, b, third, merged, gist, sources: [s1, s2] };
  } finally {
    c.close();
  }
}

function server(owner: boolean, observer = false): McpServer {
  const s = openServer({ dir, session: SESSION, scope: "/scope/night", owner, ...(observer ? { observer: true } : {}) });
  open.push(s.counterpart);
  return s;
}

function payload(r: ToolResult): Record<string, unknown> {
  return r.structuredContent;
}

/** Mark a memory confidential after the night that was shown it. */
function markConfidential(id: string, body?: string): void {
  const s = Store.open({ dir });
  try {
    s.revise(id, { ...(body === undefined ? {} : { body }), meta: { confidential: true } });
  } finally {
    s.close();
  }
}

async function cli(argv: readonly string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run([...argv, "--dir", dir], { io: { out: (l) => out.push(l), err: (l) => err.push(l) } });
  return { code, out, err };
}

describe("nightKindOf", () => {
  test("a dream's id, a reflection's, and anything else", () => {
    expect(nightKindOf("drm_2d59c0837388")).toBe("dream");
    expect(nightKindOf(" rfl_0a1b2c ")).toBe("reflection");
    expect(nightKindOf("mem_2d59c0837388")).toBeNull();
    expect(nightKindOf("drm_")).toBeNull();
    expect(nightKindOf("drm_ZZ")).toBeNull();
  });
});

describe("recall opens a night by its id", () => {
  test("a dream: date, title, counts, the ids by kind, its gist's words, the reflection after it — and no memory", async () => {
    const n = night();
    const s = server(true);
    const before = s.counterpart.store.physicsOf(n.third);
    const res = await s.call("recall", { handle: n.dream });
    const p = payload(res);
    expect(res.isError).not.toBe(true);
    expect(p["reason"]).toBe("expanded");
    expect(p["memories"]).toEqual([]);
    expect(String(p["nightsGloss"])).toContain("changes nothing");
    const d = (p["nights"] as DreamSummary[])[0] as DreamSummary;
    expect(d.kind).toBe("dream");
    expect(d.id).toBe(n.dream);
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.title).toBe("Boot order");
    expect(d.journal).toContain("booting empty");
    expect(d.counts).toMatchObject({ link: 1, merge: 1, gist: 1 });
    expect(d.touched["link"]?.ids).toEqual(expect.arrayContaining([n.a, n.third]));
    expect(d.touched["merge"]?.ids).toEqual(expect.arrayContaining([n.merged, n.a, n.b]));
    expect(d.gists).toEqual([{ id: n.gist, text: "The dashboard work is about being understood." }]);
    expect(d.reflections).toEqual([n.reflection]);
    // Opening a night credits nothing: no memory was delivered, and the
    // memories it names are untouched.
    expect(s.counterpart.store.physicsOf(n.third)).toEqual(before);
  });

  test("a reflection: entry, share and whether it was told, what it cited, closes, and the page", async () => {
    const n = night();
    const s = server(true);
    const p = payload(await s.call("recall", { handle: n.reflection }));
    expect(p["reason"]).toBe("expanded");
    const r = (p["nights"] as ReflectionSummary[])[0] as ReflectionSummary;
    expect(r.kind).toBe("reflection");
    expect(r.dream).toBe(n.dream);
    expect(r.title).toBe("boot order");
    expect(r.entry).toContain("Order matters");
    expect(r.share).toContain("boot order");
    expect(r.shareState).toBe("offered");
    expect(r.told).toBe(false);
    expect(r.cites.ids).toContain(n.third);
    expect(r.closes).toEqual({ proposed: [], closed: [] });
    expect(r.pageVersion).toBeNull();
  });

  test("ids: a night beside a memory — each answered, the memory as a memory", async () => {
    const n = night();
    const s = server(true);
    const p = payload(await s.call("recall", { ids: [n.dream, n.third, n.reflection] }));
    expect(p["reason"]).toBe("expanded");
    expect((p["memories"] as { id: string }[]).map((m) => m.id)).toEqual([n.third]);
    expect((p["nights"] as { id: string }[]).map((x) => x.id)).toEqual([n.dream, n.reflection]);
    expect((p["perId"] as { reason: string }[]).map((x) => x.reason)).toEqual(["expanded", "expanded", "expanded"]);
  });

  test("an unknown dream or reflection id is handle-unknown, said as a night", async () => {
    night();
    const s = server(true);
    for (const id of ["drm_000000000000", "rfl_000000000000"]) {
      const res = await s.call("recall", { handle: id });
      const p = payload(res);
      expect(res.isError).toBe(true);
      expect(p["reason"]).toBe("handle-unknown");
      expect(String(p["notFound"])).toContain(id.startsWith("drm_") ? "No dream" : "No reflection");
      expect(p["nights"]).toBeUndefined();
    }
    const mixed = payload(await s.call("recall", { ids: ["drm_000000000000"] }));
    expect(mixed["perId"]).toEqual([{ id: "drm_000000000000", reason: "handle-unknown" }]);
  });

  test("a night resting on a confidential memory is withheld whole from a session not the owner's, and no body leaks", async () => {
    const n = night();
    markConfidential(n.gist, SECRET);
    const stranger = server(false);
    for (const id of [n.dream]) {
      const res = await stranger.call("recall", { handle: id });
      const p = payload(res);
      expect(p["reason"]).toBe("handle-confidential-withheld");
      expect(String(p["withheld"])).toContain("That dream rests on a memory marked confidential");
      expect(JSON.stringify(res)).not.toContain("ZQSECRET");
      expect(JSON.stringify(res)).not.toContain("being understood");
    }
    // The reflection after it was shown the gist too, so it rests on it as well.
    expect(payload(await stranger.call("recall", { handle: n.reflection }))["reason"]).toBe("handle-confidential-withheld");
    // A memory it never touched is still a memory, read as one.
    expect(payload(await stranger.call("recall", { handle: n.third }))["reason"]).toBe("expanded");
  });

  test("the owner reads the same dream — and its summary still carries no confidential body", async () => {
    const n = night();
    markConfidential(n.gist, SECRET);
    const res = await server(true).call("recall", { handle: n.dream });
    const d = (payload(res)["nights"] as DreamSummary[])[0] as DreamSummary;
    expect(d.gists).toEqual([{ id: n.gist, confidential: true }]);
    expect(JSON.stringify(res)).not.toContain("ZQSECRET");
  });

  test("a reflection that cited a confidential memory is withheld from a stranger", async () => {
    const n = night();
    markConfidential(n.third);
    const p = payload(await server(false).call("recall", { handle: n.reflection }));
    expect(p["reason"]).toBe("handle-confidential-withheld");
    expect(String(p["withheld"])).toContain("That reflection");
  });

  test("under observer, recall stands down for a night as for a memory", async () => {
    const n = night();
    const res = await server(true, true).call("recall", { handle: n.dream });
    expect(payload(res)["stoodDown"]).toBe(true);
  });
});

describe("counterparts night — read-only", () => {
  test("the list, last, last-reflection, an id and show <id> — each under --observer too, and nothing changes", async () => {
    const n = night();
    const census = (): string => {
      const s = Store.open({ dir, observer: true });
      try {
        return JSON.stringify({ d: s.dreams({ limit: 10 }), r: s.reflections({ limit: 10 }), live: s.list({ archived: false }).length });
      } finally {
        s.close();
      }
    };
    const was = census();
    for (const extra of [[], ["--observer"]]) {
      const list = await cli(["night", ...extra]);
      expect(list.code).toBe(0);
      const text = list.out.join("\n");
      expect(text).toContain(n.dream);
      expect(text).toContain(n.reflection);
      expect(text).toContain("counterparts night <id>");
      expect(text).not.toContain("counterparts dream --show");

      const last = await cli(["night", "last", ...extra]);
      expect(last.code).toBe(0);
      expect(last.out[0]).toContain(`Dream ${n.dream}`);
      expect(last.out.join("\n")).toContain(`Reflection ${n.reflection}`);

      const lr = await cli(["night", "last-reflection", ...extra]);
      expect(lr.out[0]).toContain(`Reflection ${n.reflection}`);

      const one = await cli(["night", "show", n.reflection, ...extra]);
      expect(one.code).toBe(0);
      expect(one.out.join("\n")).toContain("Order matters");

      const byId = await cli(["night", n.dream, ...extra]);
      expect(byId.out.join("\n")).toContain("I dreamed the container kept booting empty.");
    }
    expect(census()).toBe(was);
  });

  test("an unknown id is refused by name; show with nothing after it is a usage error; an empty store says so", async () => {
    expect((await cli(["night", "last"])).out).toEqual(["No dreams yet."]);
    night();
    const unknown = await cli(["night", "drm_000000000000"]);
    expect(unknown.code).toBe(2);
    expect(unknown.err[0]).toContain("no dream or reflection drm_000000000000");
    expect((await cli(["night", "mem_123"])).code).toBe(2);
    expect((await cli(["night", "show"])).code).toBe(1);
  });

  test("its help says it changes nothing, and dream's reading still works under --observer", async () => {
    const help = await cli(["help", "night"]);
    expect(help.out.join("\n")).toContain("It changes nothing");
    const n = night();
    const show = await cli(["dream", "--show", n.dream, "--observer"]);
    expect(show.code).toBe(0);
    expect((await cli(["dream", "--observer"])).code).toBe(0);
  });

  test("the console's ask --id opens a night as the night's lines", async () => {
    const n = night();
    const out = await cli(["ask", "--id", n.dream]);
    expect(out.code).toBe(0);
    expect(out.out.join("\n")).toContain(`Dream ${n.dream}`);
    expect(out.out.join("\n")).not.toContain("NOTHING CAME BACK");
  });
});

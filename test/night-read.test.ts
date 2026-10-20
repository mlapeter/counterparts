/**
 * Reading last night (2026-10-20): `recall` opens a dream's id (`drm_…`) and a
 * reflection's (`rfl_…`) as a read-only summary, and the console's `night`
 * prints them with no write at all — so a session can review the night with
 * the owner without reaching for `dream`, which also undoes.
 *
 * Hermetic: a fresh temp store per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { NIGHT_IDS_PER_KIND, nightKindOf } from "../src/adapters/mcp/nights.js";
import type { DreamSummary, ReflectionSummary } from "../src/adapters/mcp/nights.js";
import { run } from "../src/adapters/cli/index.js";
import { RECALL_ID_RESULT_CHARS } from "../src/adapters/mcp/deliberate.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import { wireChars } from "../src/core/fit/index.js";
import { narrate } from "../src/adapters/dashboard/web/narrate.js";
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

// ── Review of #538: the awkward nights, built on purpose ─────────────────────

/** A dream begun and journaled with no changes, in the owner's store; returns its id. */
function bareDream(c: Counterpart, title = "Quiet", at = "2026-09-22"): string {
  const begun = c.dreams.begin({ session: SESSION, at });
  if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
  const j = c.dreams.journal({ dream: begun.bundle.dream, session: SESSION, title, text: `I dreamed something ${title.toLowerCase()}.` });
  if (!j.ok) throw new Error("journal refused");
  return begun.bundle.dream;
}

/** Every file under the temp root, by size and mtime — the SQLite shared-memory index aside. */
function files(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      // `-shm` is SQLite's WAL index: any reader of a WAL database marks it,
      // `dream --observer` included. It holds no rows; `-wal` and the
      // database itself are what a write would move.
      else if (!p.endsWith("-shm")) {
        const st = statSync(p);
        out[p] = `${String(st.size)}:${String(st.mtimeMs)}`;
      }
    }
  };
  walk(root);
  return out;
}

describe("review of #538 — awkward nights", () => {
  test("a dream of hundreds of changes names 12 ids per kind and 12 gists, counts the rest, and stays small", async () => {
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" } });
    let dream: string;
    try {
      c.store.advanceClock("2026-09-20");
      const many = Array.from({ length: 40 }, (_, i) => mem(c, `Bulk memory number ${String(i)}, with enough words to be a gist of its own when quoted. `.repeat(3)));
      c.store.advanceClock("2026-09-21");
      dream = bareDream(c, "Busy");
      // Past what one dream's limits allow through `propose`: written straight
      // to the record, the way a long history of nights could add up.
      for (let i = 0; i < 300; i++) c.store.recordDreamChange(dream, { action: "link", ref: many[i % 40] as string, ref2: many[(i + 1) % 40] as string });
      for (let i = 0; i < 200; i++) c.store.recordDreamChange(dream, { action: "gist", ref: many[i % 40] as string, detail: { sources: [many[(i + 2) % 40]] } });
    } finally {
      c.close();
    }
    const res = await server(true).call("recall", { handle: dream });
    const d = (payload(res)["nights"] as DreamSummary[])[0] as DreamSummary;
    expect(d.touched["link"]?.ids.length).toBe(NIGHT_IDS_PER_KIND);
    expect(d.touched["link"]?.more).toBe(40 - NIGHT_IDS_PER_KIND);
    expect(d.touched["gist"]?.ids.length).toBe(NIGHT_IDS_PER_KIND);
    expect(d.gists.length).toBe(NIGHT_IDS_PER_KIND);
    expect(d.gistsMore).toBe(200 - NIGHT_IDS_PER_KIND);
    expect(d.counts).toMatchObject({ link: 300, gist: 200 });
    expect(wireChars(JSON.stringify(res.structuredContent))).toBeLessThan(10_000);
  });

  test("ten long reflections by id share the answer's room: the ones past it wait by id", async () => {
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" } });
    const made: string[] = [];
    try {
      c.store.advanceClock("2026-09-20");
      const cited = mem(c, "The thing every reflection kept coming back to.");
      for (let i = 0; i < 10; i++) {
        c.store.advanceClock(`2026-09-${String(21 + i)}`);
        const r = c.reflections.begin({ session: SESSION, at: `2026-09-${String(21 + i)}` });
        if (!r.ok) throw new Error(`begin refused: ${r.reason}`);
        const done = c.reflections.finish({
          reflection: r.bundle.reflection,
          session: SESSION,
          title: `night ${String(i)}`,
          entry: `Night ${String(i)}: ${"I kept turning the same thought over, slowly and from every side. ".repeat(60)}`,
          cites: [cited],
          share: { text: "Last night I kept turning one thought over.", cites: [cited] },
        });
        if (!done.ok) throw new Error(`finish refused: ${done.reason}`);
        made.push(r.bundle.reflection);
      }
    } finally {
      c.close();
    }
    const res = await server(true).call("recall", { ids: made });
    const p = payload(res);
    const shipped = (p["nights"] as { id: string }[]).map((n) => n.id);
    const waiting = p["waiting"] as string[];
    expect(shipped.length).toBeGreaterThan(0);
    expect(waiting.length).toBeGreaterThan(0);
    expect([...shipped, ...waiting]).toEqual(made);
    expect(String(p["more"])).toContain(waiting[0] as string);
    // Under the room the memories' path keeps, weighed the same way.
    expect(2 * wireChars(JSON.stringify(p["nights"], null, 2))).toBeLessThanOrEqual(RECALL_ID_RESULT_CHARS);
    // Asked again for the ones that waited, they come.
    const next = payload(await server(true).call("recall", { ids: waiting.slice(0, 3) }));
    expect((next["nights"] as { id: string }[]).map((n) => n.id)).toEqual(waiting.slice(0, 3));
  });

  test("a dream whose merge folded a memory marked confidential later is withheld from a stranger", async () => {
    const n = night();
    markConfidential(n.b);
    const p = payload(await server(false).call("recall", { handle: n.dream }));
    expect(p["reason"]).toBe("handle-confidential-withheld");
    expect(JSON.stringify(p)).not.toContain("Boot order");
  });

  test("a reflection whose share cites a confidential memory is withheld from a stranger; the owner reads it", async () => {
    const n = night();
    markConfidential(n.third);
    expect(payload(await server(false).call("recall", { handle: n.reflection }))["reason"]).toBe("handle-confidential-withheld");
    expect(payload(await server(true).call("recall", { handle: n.reflection }))["reason"]).toBe("expanded");
  });

  test("an entry that became a confidential memory is not quoted, the owner's session and the console included", async () => {
    const n = night();
    const entryId = Store.open({ dir, observer: true }).reflection(n.reflection)?.entry_id as string;
    expect(entryId).toMatch(/^mem_/);
    markConfidential(entryId);
    const res = await server(true).call("recall", { handle: n.reflection });
    const r = (payload(res)["nights"] as ReflectionSummary[])[0] as ReflectionSummary;
    expect(r.entry).toBeNull();
    expect(r.entryConfidential).toBe(true);
    expect(JSON.stringify(res)).not.toContain("Order matters");
    const shown = (await cli(["night", n.reflection])).out.join("\n");
    expect(shown).toContain("[confidential]");
    expect(shown).not.toContain("Order matters");
  });

  test("mixed ids for a stranger: the withheld night leaks nothing past its own id; the rest answer", async () => {
    // A night before any of the others' memories existed, so it was shown none of them.
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" } });
    let other: string;
    try {
      c.store.advanceClock("2026-09-19");
      mem(c, "An older thing, nothing to do with the rest.");
      other = bareDream(c, "Unrelated", "2026-09-19");
    } finally {
      c.close();
    }
    const n = night();
    markConfidential(n.gist, SECRET);
    const res = await server(false).call("recall", { ids: [n.dream, other, n.third] });
    const p = payload(res);
    expect(p["reason"]).toBe("expanded");
    expect((p["perId"] as { id: string; reason: string }[]).map((x) => x.reason)).toEqual(["handle-confidential-withheld", "expanded", "expanded"]);
    expect((p["nights"] as { id: string }[]).map((x) => x.id)).toEqual([other]);
    const wire = JSON.stringify(res);
    for (const leak of ["Boot order", "booting empty", "ZQSECRET", "being understood", n.gist, n.merged, n.reflection]) expect(wire).not.toContain(leak);
  });

  test("an undone dream: its state, what was undone counted, nothing undone listed or quoted", async () => {
    const n = night();
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" } });
    try {
      expect(c.dreams.undo(n.dream).ok).toBe(true);
    } finally {
      c.close();
    }
    const d = (payload(await server(true).call("recall", { handle: n.dream }))["nights"] as DreamSummary[])[0] as DreamSummary;
    expect(d.state).toBe("undone");
    expect(d.undone).toBe(3);
    expect(d.touched).toEqual({});
    expect(d.gists).toEqual([]);
    expect(Object.values(d.counts).every((x) => x === 0)).toBe(true);
    // The reflection after it is lived and stays.
    expect(d.reflections).toEqual([n.reflection]);
  });

  test("an interrupted night: a dream begun and never journaled, a reflection begun and never finished, one with no dream", async () => {
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" } });
    let dream: string;
    let reflection: string;
    try {
      c.store.advanceClock("2026-09-20");
      mem(c, "Something to be shown.");
      const begun = c.dreams.begin({ session: SESSION });
      if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
      dream = begun.bundle.dream;
      const r = c.reflections.begin({ session: SESSION });
      if (!r.ok) throw new Error(`reflect begin refused: ${r.reason}`);
      reflection = r.bundle.reflection;
    } finally {
      c.close();
    }
    const s = server(true);
    const d = (payload(await s.call("recall", { handle: dream }))["nights"] as DreamSummary[])[0] as DreamSummary;
    expect(d.state).toBe("begun");
    expect(d.title).toBeNull();
    expect(d.journal).toBeUndefined();
    expect(d.reflections).toEqual([]);
    const r = (payload(await s.call("recall", { handle: reflection }))["nights"] as ReflectionSummary[])[0] as ReflectionSummary;
    expect(r.state).toBe("begun");
    expect(r.dream).toBeNull();
    expect(r.entry).toBeNull();
    expect(r.shareState).toBe("none");
    // The console reads both.
    expect((await cli(["night", "last"])).out[0]).toContain(`Dream ${dream}`);
    expect((await cli(["night", "last-reflection"])).out[0]).toContain(`Reflection ${reflection}`);
  });

  test("counterparts night and ask --id write nothing: the database, its WAL and every file beside it stand still", async () => {
    const n = night();
    const eventsWere = (): number => {
      const st = Store.open({ dir, observer: true });
      try {
        return st.eventLog({ limit: 100_000 }).length;
      } finally {
        st.close();
      }
    };
    const events = eventsWere();
    const was = files();
    for (const argv of [["night"], ["night", "list", "--all"], ["night", "last"], ["night", "last-reflection"], ["night", n.dream], ["night", "show", n.reflection], ["night", "drm_000000000000"], ["ask", "--id", n.dream], ["ask", "--id", n.reflection]]) {
      await cli(argv);
    }
    expect(files()).toEqual(was);
    expect(eventsWere()).toBe(events);
  });

  test("in a folder switched off, a night's id is refused like every read there", async () => {
    const n = night();
    const file = join(root, "scopes.json");
    writeScopes(file, setScope(null, "/scope/night", "off", { at: "2026-09-21" }));
    const s = openServer({ dir, session: SESSION, scope: "/scope/night", owner: true, scopesFile: file });
    open.push(s.counterpart);
    const p = payload(await s.call("recall", { handle: n.dream }));
    expect(p["reason"]).toBe("scope-off");
    expect(JSON.stringify(p)).not.toContain("Boot order");
  });

  test("the recall row counts a night apart from the memories it opened", async () => {
    const n = night();
    const s = server(true);
    await s.call("recall", { ids: [n.dream, n.reflection] });
    const row = s.counterpart.store.eventLog({ name: "mcp.recall", order: "desc", limit: 1 })[0];
    const p = JSON.parse(String(row?.payload)) as Record<string, unknown>;
    expect(p["expanded"]).toBe(0);
    expect(p["nights"]).toBe(2);
    expect(p["chars"]).toBe(0);
    // The dashboard says a night was read, not that the address held nothing.
    const said = narrate(s.counterpart.store, row as NonNullable<typeof row>).text;
    expect(said).toContain("read back by id");
    expect(said).not.toContain("nothing at that address");
  });
});

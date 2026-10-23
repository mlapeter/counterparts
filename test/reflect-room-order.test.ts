/**
 * THE REFLECTION'S ROOM, REORDERED (lane D1, 2026-10-23; Mike's go 15:32,
 * lightly held; `dream.REFLECT_ROOM_ORDER`). The reflection is the morning's
 * long view, so its room is filled in that order: the small fixed parts, then
 * the whole core, every core candidate and the most felt — a line each at
 * least, whatever the room — then the last few days' chapters by their
 * summaries, then what the dream changed and the OLDER memories it saw (at
 * most `SAW_OLDER`; tonight's new ones come once, through `recent`), then the
 * rest. Off: the room as it was filled before, exactly.
 *
 * Every check goes through the MCP doors a night's children use: the dream
 * tool's `begin`/`propose`/`journal`, the reflect tool's `begin`/`part`.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_TUNABLES } from "../src/core/dream/index.js";
import type { ReflectBundle } from "../src/core/dream/index.js";
import { REFLECT_LEAN_LEGEND_ORDER, REFLECT_LOOKUP, REFLECT_LOOKUP_ORDER } from "../src/core/dream/reflect.js";
import { AliasMap, readIndex } from "../src/core/fit/index.js";
import { SELF_TUNABLES } from "../src/core/self/index.js";
import type { PutInput } from "../src/core/store/index.js";

const D = DREAM_TUNABLES as unknown as Record<string, number | boolean>;
const DSAVED = { ...D };
const SF = SELF_TUNABLES as { CORE_FROM_BELIEFS: boolean };
const CFB_WAS = SF.CORE_FROM_BELIEFS;
const NIGHT = "s-night";
let root: string;
let dir: string;
let clock = Date.parse("2026-10-14T12:00:00Z");
let substance = 0;
const open: Counterpart[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-room-order-"));
  dir = join(root, "store");
  clock = Date.parse("2026-10-14T12:00:00Z");
  substance = 0;
  D["REFLECT_ROOM_ORDER"] = true;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  for (const k of Object.keys(DSAVED)) D[k] = DSAVED[k] as number | boolean;
  SF.CORE_FROM_BELIEFS = CFB_WAS;
  rmSync(root, { recursive: true, force: true });
});

function brain(): Counterpart {
  const c = Counterpart.open({ dir, snapshotsDir: join(root, "snaps"), identity: { name: "Mike" }, now: () => clock });
  open.push(c);
  return c;
}

function server(c: Counterpart, child: string): McpServer {
  return new McpServer({ counterpart: c, session: NIGHT, scope: "/proj", env: { COUNTERPARTS_NIGHT_CHILD: child, COUNTERPARTS_NIGHT_RUN: "nrn_room" }, now: () => clock });
}

const sc = (r: ToolResult): Record<string, unknown> => r.structuredContent;

const WORDS = ["kiln", "glaze", "cone", "bisque", "wedge", "slip", "trim", "throw", "fire", "cool", "shelf", "stilt", "wax", "rim", "foot", "handle", "lid", "spout", "crawl", "pinhole", "craze", "shiver", "reduction", "oxidation", "ash", "celadon", "tenmoku", "shino", "porcelain", "stoneware"];

/** A memory's words: distinct enough that each has its own neighbours. */
function words(i: number, n = 14): string {
  const out: string[] = [];
  for (let k = 0; k < n; k += 1) out.push(WORDS[(i * 7 + k * 3 + Math.floor(i / 5)) % WORDS.length] as string);
  return `Note ${String(i)} on the ${out.join(" ")}.`;
}

interface World {
  core: string[];
  candidates: string[];
  felt: string[];
  fresh: string[];
  older: string[];
  episodes: string[];
  summaries: string[];
}

/**
 * A busy few weeks: a big core and many candidates from the first day, a
 * crowd of older memories, three days of long chapters with their summaries,
 * and a night with many new memories.
 */
function busy(c: Counterpart, opts: { core?: number; candidates?: number } = {}): World {
  // A dream with room for the whole night, so it is shown 300 and more (a
  // busy live night: 267 on 10-22). Put back after each test.
  D["FRESH_LIST_CHARS"] = 200_000;
  D["NIGHT_CHARS"] = 400_000;
  D["NIGHT_ROOM_BASE"] = 400_000;
  c.store.advanceClock("2026-10-01");
  const put = (body: string, over: Partial<PutInput> = {}): string => {
    const day = c.store.livedDay();
    return c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, ...over });
  };
  const core: string[] = [];
  for (let i = 0; i < (opts.core ?? 30); i += 1) {
    const day = c.store.livedDay();
    core.push(put(`Who I am, ${String(i)}: ${words(1000 + i, 40)} ${"I hold to this across the work. ".repeat(6)}`, { kind: "self", about: "me", physics: { birthDay: day, lastUsedDay: day, promotedIdentity: true } }));
  }
  const candidates: string[] = [];
  for (let i = 0; i < (opts.candidates ?? 60); i += 1) candidates.push(put(`About me, ${String(i)}: ${words(2000 + i, 30)}`, { kind: "self", about: "me" }));
  const felt: string[] = [];
  for (let i = 0; i < 15; i += 1) {
    const id = put(`Mira, ${String(i)}: ${words(3000 + i, 20)}`, { kind: "person", salience: { relevance: 0.6, emotional: 0.9, predictive: 0.6 } });
    c.store.addFeelings(id, [{ whose: "self", core: "warm", emotion: "grateful", strength: 0.5 + i * 0.02 }]);
    felt.push(id);
  }
  const older: string[] = [];
  for (let i = 0; i < 360; i += 1) { const q = String(Math.floor(i / 4)); older.push(put(`${words(i)} Marked zq${q}alpha zq${q}beta zq${q}gamma zq${q}delta.`)); }
  for (let d = 2; d <= 10; d += 1) c.store.advanceClock(`2026-10-${String(d).padStart(2, "0")}`);
  // Three days of long chapters, each with its summary.
  const episodes: string[] = [];
  const summaries: string[] = [];
  for (const [n, date] of [[11, "2026-10-11"], [12, "2026-10-12"], [13, "2026-10-13"]] as const) {
    c.store.advanceClock(date);
    clock = Date.parse(`${date}T12:00:00Z`);
    for (let k = 1; k <= 3; k += 1) {
      const session = `s-${String(n)}-${String(k)}`;
      substance += 400;
      expect(c.episodeAsk(session, { turns: substance, bytes: substance * 1_000 }).asked).toBe(true);
      const summary = `Day ${String(n)}, session ${String(k)}: settled the zqhold${String(n)}${String(k)} with Mira.`;
      const body = `The whole of day ${String(n)} session ${String(k)} at the kiln. ${"We went through every firing log, cone by cone, and argued the hold time out loud. ".repeat(60)}`;
      const w = c.appendEpisode(session, body, { summary, title: `Kiln day ${String(n)}.${String(k)}` });
      episodes.push(w.episodeId as string);
      summaries.push(summary);
    }
  }
  c.store.advanceClock("2026-10-14");
  clock = Date.parse("2026-10-14T12:00:00Z");
  const fresh: string[] = [];
  for (let i = 0; i < 90; i += 1) fresh.push(put(`Tonight zq${String(i)}alpha zq${String(i)}beta zq${String(i)}gamma zq${String(i)}delta came back, ${String(i)}.`));
  return { core, candidates, felt, fresh, older, episodes, summaries };
}

/** Every line of the reflection's bundle, across its parts. */
async function reflectAll(c: Counterpart): Promise<{ dreamId: string; shown: string[]; texts: string[]; bundle: ReflectBundle | null; rid: string }> {
  const ds = server(c, "dream");
  const begin = await ds.call("dream", { phase: "begin", session: NIGHT });
  expect(begin.isError ?? false).toBe(false);
  const dreamId = String(sc(begin)["dream"]);
  await ds.call("dream", { phase: "journal", session: NIGHT, dream: dreamId, text: "A dream that changed nothing." });
  const shown = JSON.parse(c.store.dream(dreamId)?.shown ?? "[]") as string[];
  const rs = server(c, "reflection");
  const rb = await rs.call("reflect", { phase: "begin", session: NIGHT, dream: dreamId });
  expect(rb.isError ?? false).toBe(false);
  const rid = String(sc(rb)["reflection"]);
  const texts = [String(sc(rb)["bundle"])];
  const of = Number(/parts: part 1 of (\d+)/.exec(texts[0] as string)?.[1] ?? /"parts":\{"part":1,"of":(\d+)/.exec(texts[0] as string)?.[1] ?? "1");
  for (let p = 2; p <= of; p += 1) {
    const r = await rs.call("reflect", { phase: "part", session: NIGHT, reflection: rid, part: p });
    expect(r.isError ?? false).toBe(false);
    texts.push(String(sc(r)["bundle"]));
  }
  // The bundle itself when it went out as JSON (the lean bundle off): its first part.
  const first = texts[0] as string;
  const bundle = first.includes("\n{") ? (JSON.parse(first.slice(first.indexOf("\n") + 1)) as ReflectBundle) : null;
  return { dreamId, shown, texts, bundle, rid };
}

/** The lines under "## <name>", across every part. */
function section(texts: readonly string[], name: string): string[] {
  const out: string[] = [];
  for (const t of texts) {
    let inside = false;
    for (const line of t.split("\n")) {
      if (line.startsWith("## ")) {
        inside = line.startsWith(`## ${name}`);
        continue;
      }
      if (inside) out.push(line);
    }
  }
  return out;
}

describe("a busy night: the long view first, and always", () => {
  test("core, candidates and felt all shown; chapters by their summaries; dreamSaw only older and at most SAW_OLDER; tonight's new ones once, in recent", async () => {
    const c = brain();
    const w = busy(c);
    const { dreamId, shown, texts, rid } = await reflectAll(c);
    expect(shown.length).toBeGreaterThanOrEqual(300);
    const aliases = c.reflections.aliasesOf(rid) as AliasMap;
    const real = (line: string): string => aliases.resolve(line.split(" · ")[0]?.trim() ?? "") ?? "";
    const memLines = section(texts, "memories").map(real);
    // The long view, a line each at least: every core memory, every candidate, the most felt.
    for (const id of [...w.core, ...w.candidates]) expect(memLines).toContain(id);
    const head = texts[0] as string;
    const feltLine = head.split("\n").find((l) => l.startsWith("felt (of ")) ?? "";
    const felt = feltLine.slice(feltLine.indexOf("): ") + 3).split(" ").map((x) => aliases.resolve(x) ?? x);
    expect(felt).toHaveLength(10);
    for (const id of felt) {
      expect(w.felt).toContain(id);
      expect(memLines).toContain(id);
    }
    expect(head).toContain(REFLECT_LEAN_LEGEND_ORDER.split("\n")[1] as string);
    expect(head).not.toContain("core: none");
    // The chapters, by their summaries, a line with its address — never the entry whole.
    const chapters = section(texts, "chapters");
    for (const s of w.summaries) expect(chapters.some((l) => l.includes(s))).toBe(true);
    expect(chapters.join("\n")).not.toContain("argued the hold time out loud. We went through");
    expect(chapters.filter((l) => /^ {2}c\d+#\d+ · /.test(l))).toHaveLength(9);
    // What the dream saw: the older ones only, at most SAW_OLDER; none of tonight's new.
    const saw = section(texts, "dreamSaw").map(real);
    const index = readIndex(c.store, "dream");
    expect(index?.ref).toBe(dreamId);
    const fresh = new Set(index?.fresh ?? []);
    expect(fresh.size).toBeGreaterThan(0);
    expect(saw.length).toBeGreaterThan(0);
    expect(saw.length).toBeLessThanOrEqual(DREAM_TUNABLES.SAW_OLDER);
    for (const id of saw) {
      expect(fresh.has(id)).toBe(false);
      expect(shown).toContain(id);
    }
    // No memory's words twice: not in the long view and in dreamSaw, nor in two parts.
    const all = [...memLines, ...saw];
    expect(new Set(all).size).toBe(all.length);
    // The fresh ones are named in recent, and never in dreamSaw.
    const recentLine = head.split("\n").find((l) => l.startsWith("recent: ")) ?? "";
    const recent = recentLine.slice("recent: ".length).split(" ").map((x) => aliases.resolve(x) ?? x);
    expect(recent.filter((x) => fresh.has(x)).length).toBeGreaterThan(0);
    // The room is recorded as filled: the fit on the row, the shape for `part`.
    const detail = JSON.parse(c.store.reflection(rid)?.detail ?? "{}") as Record<string, unknown>;
    expect(detail["chaptersAs"]).toBe("summaries");
    const fitRec = detail["fit"] as { whole: number; excerpt: number; lined: number; notShown: number };
    expect(fitRec.whole + fitRec.excerpt + fitRec.lined).toBeGreaterThanOrEqual(w.core.length + w.candidates.length + 9);
  });

  test("what the dream changed comes first in dreamSaw, while it stands: a merge's new memory, a link's older end — never tonight's new ones", async () => {
    const c = brain();
    const w = busy(c);
    const ds = server(c, "dream");
    const begin = await ds.call("dream", { phase: "begin", session: NIGHT });
    const dreamId = String(sc(begin)["dream"]);
    const shown = JSON.parse(c.store.dream(dreamId)?.shown ?? "[]") as string[];
    const older = shown.find((id) => w.older.includes(id)) as string;
    const [f1, f2, f3] = w.fresh as [string, string, string];
    const p = await ds.call("dream", {
      phase: "propose",
      session: NIGHT,
      dream: dreamId,
      changes: [
        { action: "merge", ids: [f1, f2], text: "Two of tonight's notes, as one." },
        { action: "link", a: f3, b: older },
      ],
    });
    expect(sc(p)["landed"]).toMatchObject({ merged: 1, linked: 1 });
    const merged = c.store.dreamChanges(dreamId).find((x) => x.action === "merge")?.ref as string;
    await ds.call("dream", { phase: "journal", session: NIGHT, dream: dreamId, text: "A dream." });
    const rs = server(c, "reflection");
    const rb = await rs.call("reflect", { phase: "begin", session: NIGHT, dream: dreamId });
    const rid = String(sc(rb)["reflection"]);
    const texts = [String(sc(rb)["bundle"])];
    const of = Number(/parts: part 1 of (\d+)/.exec(texts[0] as string)?.[1] ?? "1");
    for (let n = 2; n <= of; n += 1) texts.push(String(sc(await rs.call("reflect", { phase: "part", session: NIGHT, reflection: rid, part: n }))["bundle"]));
    const aliases = c.reflections.aliasesOf(rid) as AliasMap;
    const saw = section(texts, "dreamSaw").map((l) => aliases.resolve(l.split(" · ")[0]?.trim() ?? "") ?? "");
    expect(saw.slice(0, 2)).toEqual([merged, older]);
    for (const f of [f1, f2, f3]) expect(saw).not.toContain(f);
    expect(saw.length).toBeLessThanOrEqual(DREAM_TUNABLES.SAW_OLDER + 2);
  });

  test("a core bigger than the room: every core memory still a line, the bundle in more parts", async () => {
    const c = brain();
    const w = busy(c, { core: 260, candidates: 120 });
    const { texts, rid } = await reflectAll(c);
    const aliases = c.reflections.aliasesOf(rid) as AliasMap;
    const memLines = section(texts, "memories").map((l) => aliases.resolve(l.split(" · ")[0]?.trim() ?? "") ?? "");
    for (const id of [...w.core, ...w.candidates]) expect(memLines).toContain(id);
    const coreLine = (texts[0] as string).split("\n").find((l) => l.startsWith("core: ")) ?? "";
    expect(coreLine.slice("core: ".length).split(" ")).toHaveLength(w.core.length);
    expect(texts.length).toBeGreaterThan(1);
  });

  test("with the spine on (`CORE_FROM_BELIEFS`), the long view is still first and whole", async () => {
    SF.CORE_FROM_BELIEFS = true;
    const c = brain();
    const w = busy(c);
    const { texts, rid } = await reflectAll(c);
    expect(texts[0]).toContain("## spine");
    const aliases = c.reflections.aliasesOf(rid) as AliasMap;
    const memLines = section(texts, "memories").map((l) => aliases.resolve(l.split(" · ")[0]?.trim() ?? "") ?? "");
    for (const id of [...w.core, ...w.candidates]) expect(memLines).toContain(id);
  });

  test("JSON (the lean bundle off): the same order, said in the lookup; parts by their summaries", async () => {
    D["LEAN_BUNDLE"] = false;
    const c = brain();
    const w = busy(c);
    const { texts, bundle: b } = await reflectAll(c);
    const bundle = b as ReflectBundle;
    expect(bundle.chaptersAs).toBe("summaries");
    expect(bundle.lookup).toBe(REFLECT_LOOKUP_ORDER);
    const json = texts.join("\n");
    for (const s of w.summaries) expect(json).toContain(s);
    expect(json).not.toContain("argued the hold time out loud. We went through");
    for (const id of w.core) expect(json).toContain(id);
  });
});

describe("the switch off: the room as it was filled before", () => {
  test("every memory the dream was shown in dreamSaw, the chapters fitted from their words, the old lookup and legend", async () => {
    D["REFLECT_ROOM_ORDER"] = false;
    D["LEAN_BUNDLE"] = false;
    const c = brain();
    busy(c);
    const { shown, bundle: b, texts } = await reflectAll(c);
    const bundle = b as ReflectBundle;
    expect(bundle.chaptersAs).toBeUndefined();
    expect(bundle.lookup).toBe(REFLECT_LOOKUP);
    // Across every part: each is its opener, then its JSON.
    const saw = new Set(texts.flatMap((t) => ((JSON.parse(t.slice(t.indexOf("\n") + 1)) as { dreamSaw?: { id: string }[] }).dreamSaw ?? []).map((s) => s.id)));
    expect(shown.length).toBeGreaterThanOrEqual(300);
    for (const id of shown) if (c.store.row(id)?.source !== "reflection") expect(saw.has(id)).toBe(true);
    expect(texts.join("\n")).not.toContain('"chaptersAs"');
  });
});

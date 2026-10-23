/**
 * LEAN NIGHT BUNDLES (2026-10-23, Mike's go 10-23; lane N2). The dream's and
 * the reflection's bundles go out as plain lines with short ids for the run
 * (m1…, c1…), the dream's journal as its chapters' summaries with their
 * addresses, `propose` and `finish` answer short, and the dream's room scales
 * with the day. Every check here goes through the MCP doors the night uses:
 * the short ids must read back the same in `propose`, `part`, `recall`, after
 * a resume, and in the reflection that follows; real ids must still be taken;
 * words must never be touched; and the switch puts it all back.
 *
 * Hermetic: each test opens its own temp store and removes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_TUNABLES, REFLECT_TUNABLES } from "../src/core/dream/index.js";
import { AliasMap, readIndex } from "../src/core/fit/index.js";
import type { PutInput } from "../src/core/store/index.js";

const T = DREAM_TUNABLES as unknown as Record<string, number | boolean>;
const SAVED = { ...T };
const R = REFLECT_TUNABLES as unknown as Record<string, number>;
const RSAVED = { ...R };

let root: string;
let dir: string;
let clock = Date.parse("2026-10-14T12:00:00Z");
const open: Counterpart[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-lean-"));
  dir = join(root, "store");
  clock = Date.parse("2026-10-14T12:00:00Z");
  substance = 0;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  for (const k of Object.keys(SAVED)) T[k] = SAVED[k] as number | boolean;
  for (const k of Object.keys(RSAVED)) R[k] = RSAVED[k] as number;
  rmSync(root, { recursive: true, force: true });
});

function brain(): Counterpart {
  const c = Counterpart.open({ dir, snapshotsDir: join(root, "snaps"), identity: { name: "Mike" }, now: () => clock });
  open.push(c);
  return c;
}

function server(c: Counterpart, session: string, env: Record<string, string> = {}): McpServer {
  return new McpServer({ counterpart: c, session, scope: "/proj", env, now: () => clock });
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, ...over });
}

let substance = 0;
/** A chapter written through the `chapter` tool, as a session ends one. */
async function chapter(c: Counterpart, s: McpServer, session: string, text: string, summary: string): Promise<Record<string, unknown>> {
  substance += 400;
  expect(c.episodeAsk(session, { turns: substance, bytes: substance * 1_000 }).asked).toBe(true);
  const out = await s.call("chapter", { text, summary, title: "A day at the kiln" });
  expect(out.isError ?? false).toBe(false);
  return out.structuredContent;
}

const sc = (r: ToolResult): Record<string, unknown> => r.structuredContent;
const bundleText = (r: ToolResult): string => String(sc(r)["bundle"]);

/** The lines under a "## <name>" heading, up to the next heading. */
function section(text: string, name: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      inside = line.startsWith(`## ${name}`);
      continue;
    }
    if (inside) out.push(line);
  }
  return out;
}

/** A store with older days behind it, a few old memories, then today's new ones. */
function lived(c: Counterpart, newCount = 6): { older: string[]; fresh: string[] } {
  c.store.advanceClock("2026-10-01");
  const older = [
    mem(c, "The kiln's cone-six ramp holds at 1,100 degrees for thirty-five minutes."),
    mem(c, "Mira glazes on Thursdays and fires on Fridays."),
    mem(c, "The zqbowl rims crawl when the glaze goes on too thick."),
  ];
  for (let d = 2; d <= 13; d += 1) c.store.advanceClock(`2026-10-${String(d).padStart(2, "0")}`);
  const bodies = [
    "The cone-six hold at the kiln is thirty-five minutes at 1,100 degrees.",
    "Hold the kiln at 1,100 degrees for thirty-five minutes on a cone-six firing.",
    "Mira asked me to keep the firing log on the kiln door.",
    "I say what I do not know before I guess.",
    "Mike likes to talk decisions through out loud before he commits.",
    "The zqbowl glaze crawled again; it went on too thick.",
  ];
  const fresh: string[] = [];
  for (let i = 0; i < newCount; i += 1) fresh.push(mem(c, `${bodies[i % bodies.length] as string}${i >= bodies.length ? ` (again, ${String(i)})` : ""}`, { kind: i === 3 ? "self" : i === 4 ? "person" : "fact" }));
  return { older, fresh };
}

// ═══════════════════════════════════════════════════════════════════════════

describe("the dream's bundle in plain lines, its short ids taken at every door", () => {
  test("begin: lines, not JSON; a legend once; m1… and c1…; the journal by its summaries with their addresses", async () => {
    const c = brain();
    lived(c);
    const s = server(c, "s-night");
    const ch = await chapter(c, s, "s-night", "We spent the afternoon on the zqkiln firing schedule with Mira. ".repeat(20), "Settled the zqkiln hold at 35 minutes with Mira.");
    const begin = await s.call("dream", { phase: "begin", session: "s-night" });
    expect(begin.isError ?? false).toBe(false);
    const text = bundleText(begin);
    // No JSON inside the result's JSON: the bundle is words, one escaping.
    expect(text).not.toContain('{"');
    expect(text).not.toContain('\\"');
    expect(text.split("Short ids: m1…").length).toBe(2);
    const dreamId = String(sc(begin)["dream"]);
    const aliases = c.dreams.aliasesOf(dreamId);
    expect(aliases).not.toBeNull();
    // Every memory shown has one line, opening with its short id, which reads back to a shown memory.
    const lines = section(text, "memories");
    const shown = new Set(JSON.parse(c.store.dream(dreamId)?.shown ?? "[]") as string[]);
    expect(lines.length).toBe(shown.size);
    for (const line of lines) {
      const short = line.split(" · ")[0] as string;
      expect(short).toMatch(/^m\d+$/);
      expect(shown.has(aliases?.resolve(short) ?? "")).toBe(true);
    }
    // Tonight's new come first, numbered from m1.
    const fresh = section(text, "fresh");
    expect(fresh[0]?.startsWith("m1")).toBe(true);
    // The journal: its head, and each chapter by its summary and address — not its whole words.
    const journal = section(text, "journal");
    const episode = String(ch["episodeId"]);
    expect(aliases?.resolve("c1")).toBe(episode);
    expect(journal[0]?.startsWith("c1 · ")).toBe(true);
    expect(journal.some((l) => l.includes("c1#1") && l.includes("Settled the zqkiln hold at 35 minutes with Mira."))).toBe(true);
    expect(text).not.toContain("We spent the afternoon on the zqkiln firing schedule with Mira. We spent");
    // The summary memory is shown too, and the chapter's line names it.
    const summaryId = String((ch["summary"] as Record<string, unknown>)["memoryId"]);
    if (aliases?.has(summaryId) === true) expect(journal.some((l) => l.includes(`summary ${aliases.short(summaryId)}`))).toBe(true);
    // The chapter's address reads it whole through recall.
    const read = await s.call("recall", { handle: "c1#1" });
    expect(read.isError ?? false).toBe(false);
    const got = (sc(read)["memories"] as { address?: string; excerpt?: string; body?: string }[])[0];
    expect(got?.address).toBe(`${episode}#1`);
    // …and by ids, as the legend says, the journal's own id too.
    const byIds = await s.call("recall", { ids: ["c1#1", "c1"] });
    const ms = sc(byIds)["memories"] as { id: string; address?: string }[];
    expect(ms.some((m) => m.address === `${episode}#1`)).toBe(true);
    expect(ms.some((m) => m.id === episode && m.address === undefined)).toBe(true);
  });

  test("propose: short ids land on their memories, real ids still do, an unknown one is refused by name, words are never touched; the answer is short", async () => {
    const c = brain();
    const { older } = lived(c);
    const s = server(c, "s-night");
    const begin = await s.call("dream", { phase: "begin", session: "s-night" });
    const dreamId = String(sc(begin)["dream"]);
    const aliases = c.dreams.aliasesOf(dreamId) as AliasMap;
    const m1 = aliases.resolve("m1") as string;
    const m2 = aliases.resolve("m2") as string;
    const real3 = aliases.resolve("m3") as string;
    const out = await s.call("dream", {
      phase: "propose",
      session: "s-night",
      dream: dreamId,
      changes: [
        { action: "link", a: "m1", b: "m2" },
        { action: "replayed", id: real3 },
        { action: "link", a: "m1", b: "m999" },
        { action: "gist", text: "m1 and m2 say the same thing, so I keep one hold time.", title: "m1 is the hold", sources: ["m1", "m2"] },
      ],
    });
    expect(out.isError ?? false).toBe(false);
    const p = sc(out);
    expect(p["results"]).toBeUndefined();
    // A replay on its birth day lands, not counted: said by its reason.
    const landed = p["landed"] as Record<string, number>;
    expect(landed["linked"]).toBe(1);
    expect(landed["dreamed"]).toBe(1);
    expect(Object.entries(landed).filter(([k]) => k.startsWith("replayed")).map(([, n]) => n)).toEqual([1]);
    const refused = p["refused"] as { index: number; action: string; reason: string; detail?: string }[];
    expect(refused.length).toBe(1);
    expect(refused[0]).toMatchObject({ index: 2, action: "link" });
    expect(String(refused[0]?.detail)).toContain("m999");
    expect(String(p["again"])).toContain("1 change was not applied");
    const made = p["made"] as { action: string; id: string }[];
    expect(made.length).toBe(1);
    // What landed names the real ids.
    const changes = c.store.dreamChanges(dreamId);
    const link = changes.find((x) => x.action === "link");
    expect([link?.ref, link?.ref2].sort()).toEqual([m1, m2].sort());
    expect(changes.find((x) => x.action === "replayed")?.ref).toBe(real3);
    // The gist's words are its own: "m1" stays "m1", and its sources are the real ids.
    const gist = c.store.readProse(made[0]?.id as string);
    expect(gist.body).toContain("m1 and m2 say the same thing");
    expect(gist.title).toContain("m1 is the hold");
    expect(JSON.stringify(gist.meta)).toContain(m1);
    expect(older.length).toBe(3);
  });

  test("parts, a recall between them, and a resume: the same numbers all the way", async () => {
    T["RESULT_CHARS"] = 14_000;
    T["PART_CHARS"] = 9_000;
    // A room too small for every whole text: most come as lines, a lookup away.
    T["NIGHT_CHARS"] = 24_000;
    const c = brain();
    c.store.advanceClock("2026-10-01");
    const long = "a detail of the firing worth keeping whole, ".repeat(10);
    for (let i = 0; i < 20; i += 1) mem(c, `Older firing note ${String(i)}: ${long}`);
    for (let d = 2; d <= 13; d += 1) c.store.advanceClock(`2026-10-${String(d).padStart(2, "0")}`);
    for (let i = 0; i < 40; i += 1) mem(c, `New firing note ${String(i)}: ${long}`, { kind: i % 2 === 0 ? "self" : "fact" });
    const a = server(c, "s-a");
    const begin = await a.call("dream", { phase: "begin", session: "s-a" });
    expect(begin.isError ?? false).toBe(false);
    const dreamId = String(sc(begin)["dream"]);
    const of = (sc(begin)["parts"] as { of: number } | undefined)?.of ?? 1;
    expect(of).toBeGreaterThan(1);
    const before = (c.dreams.aliasesOf(dreamId) as AliasMap).toJSON();
    const part2 = await a.call("dream", { phase: "part", session: "s-a", dream: dreamId, part: 2 });
    expect(part2.isError ?? false).toBe(false);
    const p2 = bundleText(part2);
    expect(p2).not.toContain('{"');
    // One shown in part 2 only as a line (its whole length at its end).
    const later = section(p2, "memories").filter((l) => /\(\d+\)$/.test(l)).map((l) => l.split(" · ")[0] as string);
    expect(later.length).toBeGreaterThan(0);
    const short = later[later.length - 1] as string;
    const real = (c.dreams.aliasesOf(dreamId) as AliasMap).resolve(short) as string;
    expect(JSON.parse(c.store.dream(dreamId)?.shown ?? "[]")).toContain(real);
    // A recall by the short id reads the real memory — and the lookup's
    // rewrite of the index keeps the short ids.
    const r = await a.call("recall", { ids: [short] });
    expect(r.isError ?? false).toBe(false);
    expect((sc(r)["memories"] as { id: string }[]).map((m) => m.id)).toEqual([real]);
    expect(readIndex(c.store, "dream")?.looked).toContain(real);
    expect((c.dreams.aliasesOf(dreamId) as AliasMap).toJSON()).toEqual(before);
    // The part, fetched again, is the same words.
    expect(bundleText(await a.call("dream", { phase: "part", session: "s-a", dream: dreamId, part: 2 }))).toBe(p2);
    // A change by a later part's short id lands.
    const linked = sc(await a.call("dream", { phase: "propose", session: "s-a", dream: dreamId, changes: [{ action: "link", a: "m1", b: short }] }));
    expect(linked["landed"]).toEqual({ linked: 1 });
    // The session closes; the next one resumes the dream with every number it had.
    clock += (DREAM_TUNABLES.ABANDONED_AFTER_MS as number) + 60_000;
    const b = server(c, "s-b");
    const resumed = await b.call("dream", { phase: "begin", session: "s-b" });
    expect(resumed.isError ?? false).toBe(false);
    expect(sc(resumed)["resumed"]).toBe(true);
    expect(sc(resumed)["dream"]).toBe(dreamId);
    const after = (c.dreams.aliasesOf(dreamId) as AliasMap).toJSON();
    expect(after.m.slice(0, before.m.length)).toEqual([...before.m]);
    expect(after.c.slice(0, before.c.length)).toEqual([...before.c]);
    // The old short id still names the same memory, in the new session's propose.
    const again = sc(await b.call("dream", { phase: "propose", session: "s-b", dream: dreamId, changes: [{ action: "replayed", id: short }] }));
    expect(again["landed"]).toMatchObject({});
    expect(c.store.dreamChanges(dreamId).filter((x) => x.action === "replayed").map((x) => x.ref)).toEqual([real]);
  });

  test("a recall by short id from a session that is not the night's reads nothing of it", async () => {
    const c = brain();
    lived(c);
    const night = server(c, "s-night");
    await night.call("dream", { phase: "begin", session: "s-night" });
    const day = server(c, "s-day");
    const r = await day.call("recall", { ids: ["m1"] });
    expect((sc(r)["memories"] as unknown[] | undefined) ?? []).toEqual([]);
  });
});

describe("the reflection after a lean dream", () => {
  test("its numbers start as the dream's; finish and settle take them, real ids too; words untouched; the answer is short", async () => {
    const c = brain();
    lived(c);
    const s = server(c, "s-night");
    const begin = await s.call("dream", { phase: "begin", session: "s-night" });
    const dreamId = String(sc(begin)["dream"]);
    const dreamMap = (c.dreams.aliasesOf(dreamId) as AliasMap).toJSON();
    await s.call("dream", { phase: "journal", session: "s-night", dream: dreamId, title: "The kiln", text: "I dreamed of m1 and the kiln." });
    // The journal's words are its own.
    expect(c.store.dream(dreamId)?.journal).toContain("I dreamed of m1 and the kiln.");
    const rb = await s.call("reflect", { phase: "begin", session: "s-night", dream: dreamId });
    expect(rb.isError ?? false).toBe(false);
    const rid = String(sc(rb)["reflection"]);
    const text = bundleText(rb);
    expect(text).not.toContain('{"');
    const map = c.reflections.aliasesOf(rid) as AliasMap;
    expect(map.toJSON().m.slice(0, dreamMap.m.length)).toEqual([...dreamMap.m]);
    // What the dream saw is listed by the dream's own numbers.
    const saw = section(text, "dreamSaw").map((l) => l.split(" · ")[0] as string);
    expect(saw.length).toBeGreaterThan(0);
    for (const x of saw) expect(map.resolve(x)).toBe(new AliasMap(dreamMap).resolve(x) ?? map.resolve(x));
    const m1 = map.resolve("m1") as string;
    const m2 = map.resolve("m2") as string;
    // A recall in the reflection reads by its numbers.
    const r = await s.call("recall", { ids: ["m2"] });
    expect((sc(r)["memories"] as { id: string }[]).map((m) => m.id)).toEqual([m2]);
    const fin = await s.call("reflect", {
      phase: "finish",
      session: "s-night",
      reflection: rid,
      entry: "Looking back at m1, the hold time mattered.",
      cites: ["m1", m2],
      feelings: [{ id: "m1", core: "calm", emotion: "steady", strength: 0.4, carried_by: "m2 felt the same" }],
    });
    expect(fin.isError ?? false).toBe(false);
    const f = sc(fin);
    expect(f["refusedCites"]).toBeUndefined();
    // Returns on their birth day are not counted, and said by their short ids.
    const returned = f["returned"] as { written: number; notWritten?: { id: string; reason: string }[] };
    expect(returned.written + (returned.notWritten ?? []).length).toBe(2);
    for (const x of returned.notWritten ?? []) expect(["m1", "m2"]).toContain(x.id);
    expect(f["feelings"]).toMatchObject({ written: 1 });
    const row = c.store.reflection(rid);
    expect(row?.entry).toContain("Looking back at m1, the hold time mattered.");
    const felt = c.store.feelingsFor(m1).find((x) => x.emotion === "steady" || x.other_word === "steady");
    expect(felt?.carried_by).toContain("m2 felt the same");
    // Settle by short ids: the pair is the real one.
    const settled = sc(await s.call("reflect", { phase: "settle", session: "s-night", reflection: rid, holds: "m1", over: "m2", how: "corrected", why: "m1 says it plainly." }));
    expect(settled["settle"]).toMatchObject({ ok: true, holds: m1, over: m2 });
  });
});

describe("the switch: LEAN_BUNDLE off puts the bundle and the answers back as they were", () => {
  test("JSON with real ids and the long answer; a dream begun lean stays lean for its life", async () => {
    T["LEAN_BUNDLE"] = false;
    const c = brain();
    const { fresh } = lived(c);
    const s = server(c, "s-night");
    const begin = await s.call("dream", { phase: "begin", session: "s-night" });
    const dreamId = String(sc(begin)["dream"]);
    const text = bundleText(begin);
    const body = JSON.parse(text.split("\n").slice(1).join("\n")) as { memories: Record<string, unknown> };
    expect(Object.keys(body.memories)).toContain(fresh[0] as string);
    expect(c.dreams.aliasesOf(dreamId)).toBeNull();
    const out = sc(await s.call("dream", { phase: "propose", session: "s-night", dream: dreamId, changes: [{ action: "replayed", id: fresh[0] }] }));
    expect(Array.isArray(out["results"])).toBe(true);
    // A short id means nothing to a dream that handed none out.
    const none = sc(await s.call("dream", { phase: "propose", session: "s-night", dream: dreamId, changes: [{ action: "replayed", id: "m1" }] }));
    expect((none["results"] as { ok: boolean }[])[0]?.ok).toBe(false);
  });

  test("turned off mid-run, a lean dream's parts and doors stay lean", async () => {
    T["RESULT_CHARS"] = 14_000;
    T["PART_CHARS"] = 9_000;
    const c = brain();
    c.store.advanceClock("2026-10-01");
    for (let d = 2; d <= 13; d += 1) c.store.advanceClock(`2026-10-${String(d).padStart(2, "0")}`);
    for (let i = 0; i < 40; i += 1) mem(c, `New firing note ${String(i)}: ${"worth keeping, ".repeat(30)}`);
    const s = server(c, "s-night");
    const begin = await s.call("dream", { phase: "begin", session: "s-night" });
    const dreamId = String(sc(begin)["dream"]);
    expect((sc(begin)["parts"] as { of: number } | undefined)?.of ?? 1).toBeGreaterThan(1);
    T["LEAN_BUNDLE"] = false;
    const p2 = bundleText(await s.call("dream", { phase: "part", session: "s-night", dream: dreamId, part: 2 }));
    expect(p2).not.toContain('{"');
    expect(sc(await s.call("dream", { phase: "propose", session: "s-night", dream: dreamId, changes: [{ action: "replayed", id: "m1" }] }))["landed"]).toBeDefined();
  });
});

describe("a room that scales with the day", () => {
  /** A quiet day: three new memories, each among long older neighbours. */
  function quiet(c: Counterpart): void {
    c.store.advanceClock("2026-10-01");
    const long = "The firing log says the kiln held and the glaze stayed put; ".repeat(60);
    for (let i = 0; i < 14; i += 1) mem(c, `Kiln firing ${String(i)}: ${long}`);
    for (let d = 2; d <= 13; d += 1) c.store.advanceClock(`2026-10-${String(d).padStart(2, "0")}`);
    for (let i = 0; i < 3; i += 1) mem(c, `Kiln firing tonight ${String(i)}: ${long}`);
  }

  async function shownAs(): Promise<{ whole: number; line: number; notShown: number; parts: number; wake: boolean; fresh: number }> {
    const c = brain();
    quiet(c);
    c.revisePage("## Core\n\nI keep the kiln log honest.", { reason: "a page", by: "owner" });
    const s = server(c, "s-night");
    const begin = await s.call("dream", { phase: "begin", session: "s-night" });
    expect(begin.isError ?? false).toBe(false);
    const ev = c.store.eventLog({ name: "dream.begun", limit: 1 })[0] as { payload?: string } | undefined;
    const p = JSON.parse(String(ev?.payload ?? "{}")) as Record<string, number>;
    const text = bundleText(begin);
    const lines = text.split("\n");
    const wakeAt = lines.findIndex((l) => l.startsWith("## wake"));
    c.close();
    open.splice(open.indexOf(c), 1);
    rmSync(dir, { recursive: true, force: true });
    return { whole: p["whole"] ?? -1, line: p["lined"] ?? -1, notShown: p["notShown"] ?? -1, parts: p["parts"] ?? -1, wake: wakeAt >= 0 && lines[wakeAt + 1] !== "none", fresh: p["fresh"] ?? -1 };
  }

  test("a quiet day spends less on whole words; every memory still shown, every new one taken, no more parts, the wake in part 1", async () => {
    T["NIGHT_ROOM_BASE"] = T["NIGHT_CHARS"] as number;
    const full = await shownAs();
    T["NIGHT_ROOM_BASE"] = SAVED["NIGHT_ROOM_BASE"] as number;
    const scaled = await shownAs();
    expect(full.notShown).toBe(0);
    expect(scaled.notShown).toBe(0);
    expect(scaled.fresh).toBe(3);
    expect(scaled.fresh).toBe(full.fresh);
    expect(scaled.whole + scaled.line).toBe(full.whole + full.line);
    expect(scaled.whole).toBeLessThan(full.whole);
    expect(scaled.parts).toBeLessThanOrEqual(full.parts);
    // The room never takes the wake: it is in part 1 whenever the full room's is.
    expect(scaled.wake).toBe(full.wake);
  });

  test("never below a line each: with no room to spare, every memory is still shown as a line", async () => {
    T["NIGHT_ROOM_BASE"] = 0;
    T["NIGHT_ROOM_PER_NEW"] = 0;
    const tight = await shownAs();
    expect(tight.notShown).toBe(0);
    expect(tight.fresh).toBe(3);
  });
});

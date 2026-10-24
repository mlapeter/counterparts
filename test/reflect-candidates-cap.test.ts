/**
 * THE REFLECTION'S CORE CANDIDATES, CAPPED AND ROTATED (R1, 2026-10-24;
 * `REFLECT_TUNABLES.CANDIDATES`, switch `dream.REFLECT_CANDIDATES_CAP`). The
 * reflection is shown at most `CANDIDATES` core candidates a night: the
 * strongest felt and newest first, and `CANDIDATES_ROTATED` of those slots go
 * to the rest, the least recently shown first — so a candidate past the head
 * still comes round to be cited, felt and marked. The rest are counted in one
 * line, never listed. The per-lane shown counts are kept on the reflection's
 * row (`detail.lanes`) beside `fit`, and they and `chaptersAs` survive the
 * finish (the D1 check reads a finished row). Off: every candidate, as before.
 *
 * Every check goes through the MCP doors a night's reflection child uses: the
 * reflect tool's `begin`/`part`/`finish`.
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
import { DREAM_TUNABLES, REFLECT_TUNABLES } from "../src/core/dream/index.js";
import { REFLECT_LOOKUP_ORDER, REFLECT_LOOKUP_ORDER_CAPPED } from "../src/core/dream/reflect.js";
import type { ReflectBundle } from "../src/core/dream/index.js";
import type { AliasMap } from "../src/core/fit/index.js";
import type { PutInput } from "../src/core/store/index.js";

const D = DREAM_TUNABLES as unknown as Record<string, number | boolean>;
const DSAVED = { ...D };
const NIGHT = "s-night";
let root: string;
let dir: string;
let clock = Date.parse("2026-10-14T12:00:00Z");
const open: Counterpart[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-candidates-cap-"));
  dir = join(root, "store");
  clock = Date.parse("2026-10-14T12:00:00Z");
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
  rmSync(root, { recursive: true, force: true });
});

function brain(): Counterpart {
  const c = Counterpart.open({ dir, snapshotsDir: join(root, "snaps"), identity: { name: "Mike" }, now: () => clock });
  open.push(c);
  return c;
}

function server(c: Counterpart): McpServer {
  return new McpServer({ counterpart: c, session: NIGHT, scope: "/proj", env: { COUNTERPARTS_NIGHT_CHILD: "reflection", COUNTERPARTS_NIGHT_RUN: "nrn_cap" }, now: () => clock });
}

const sc = (r: ToolResult): Record<string, unknown> => r.structuredContent;

interface World {
  core: string[];
  candidates: string[];
  felt: string[];
}

/** A store a few weeks in: a small core, `n` core candidates (some felt), a few felt people. */
function world(c: Counterpart, n = 60): World {
  c.store.advanceClock("2026-10-01");
  const put = (body: string, over: Partial<PutInput> = {}): string => {
    const day = c.store.livedDay();
    return c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, ...over });
  };
  const core: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const day = c.store.livedDay();
    core.push(put(`Who I am, ${String(i)}: I hold to the slow way of firing, kiln ${String(i)}.`, { kind: "self", about: "me", physics: { birthDay: day, lastUsedDay: day, promotedIdentity: true } }));
  }
  const candidates: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = put(`About me, ${String(i)}: a note on how I work at glaze ${String(i)}, cone ${String(i % 7)}.`, { kind: "self", about: "me" });
    // A few candidates felt, so the head is not only the newest.
    if (i % 9 === 0) c.store.addFeelings(id, [{ whose: "self", core: "warm", emotion: "grateful", strength: 0.4 + i * 0.005 }]);
    candidates.push(id);
  }
  const felt: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const id = put(`Mira, ${String(i)}: she showed me the ash glaze ${String(i)}.`, { kind: "person", salience: { relevance: 0.6, emotional: 0.9, predictive: 0.6 } });
    c.store.addFeelings(id, [{ whose: "self", core: "warm", emotion: "grateful", strength: 0.6 + i * 0.02 }]);
    felt.push(id);
  }
  for (let d = 2; d <= 13; d += 1) c.store.advanceClock(`2026-10-${String(d).padStart(2, "0")}`);
  c.store.advanceClock("2026-10-14");
  clock = Date.parse("2026-10-14T12:00:00Z");
  return { core, candidates, felt };
}

/** One reflection through its doors: every part's text, the row's id and its short ids. */
async function reflect(c: Counterpart): Promise<{ texts: string[]; rid: string; aliases: AliasMap | null; s: McpServer }> {
  const s = server(c);
  const rb = await s.call("reflect", { phase: "begin", session: NIGHT });
  expect(rb.isError ?? false).toBe(false);
  const rid = String(sc(rb)["reflection"]);
  const texts = [String(sc(rb)["bundle"])];
  const of = Number(/parts: part 1 of (\d+)/.exec(texts[0] as string)?.[1] ?? /"parts":\{"part":1,"of":(\d+)/.exec(texts[0] as string)?.[1] ?? "1");
  for (let p = 2; p <= of; p += 1) {
    const r = await s.call("reflect", { phase: "part", session: NIGHT, reflection: rid, part: p });
    expect(r.isError ?? false).toBe(false);
    texts.push(String(sc(r)["bundle"]));
  }
  return { texts, rid, aliases: c.reflections.aliasesOf(rid), s };
}

/** A lane's ids from the lean head ("candidates: m1 m2 …"), as real ids. */
function lane(head: string, prefix: string, aliases: AliasMap): string[] {
  const line = head.split("\n").find((l) => l.startsWith(prefix)) ?? "";
  const rest = line.slice(line.indexOf(": ") + 2);
  return rest === "none" || rest.length === 0 ? [] : rest.split(" ").map((x) => aliases.resolve(x) ?? x);
}

const detailOf = (c: Counterpart, rid: string): Record<string, unknown> => JSON.parse(c.store.reflection(rid)?.detail ?? "{}") as Record<string, unknown>;

async function finish(s: McpServer, rid: string): Promise<void> {
  const fin = await s.call("reflect", { phase: "finish", session: NIGHT, reflection: rid, entry: "A quiet night at the kiln." });
  expect(fin.isError ?? false).toBe(false);
}

describe("the reflection's core candidates, capped", () => {
  test("more than the cap: CANDIDATES shown, the rest counted in one line, no id in two lanes", async () => {
    const c = brain();
    const w = world(c);
    const { texts, rid, aliases } = await reflect(c);
    const head = texts[0] as string;
    const al = aliases as AliasMap;
    const shownCandidates = lane(head, "candidates: ", al);
    expect(shownCandidates).toHaveLength(REFLECT_TUNABLES.CANDIDATES);
    for (const id of shownCandidates) expect(w.candidates).toContain(id);
    const more = w.candidates.length - REFLECT_TUNABLES.CANDIDATES;
    expect(head).toContain(`+${String(more)} more candidates, not shown`);
    // The head of the order is all there: the felt candidates first.
    const feltCandidates = w.candidates.filter((_, i) => i % 9 === 0);
    for (const id of feltCandidates) expect(shownCandidates).toContain(id);
    // Nothing in two lanes: a cut candidate may be in felt, never in both.
    const felt = lane(head, "felt (of ", al);
    const core = lane(head, "core: ", al);
    const all = [...shownCandidates, ...felt, ...core];
    expect(new Set(all).size).toBe(all.length);
    // The per-lane shown counts, kept beside `fit` at begin.
    const lanes = detailOf(c, rid)["lanes"] as Record<string, number>;
    expect(lanes).toEqual({ core: w.core.length, candidates: REFLECT_TUNABLES.CANDIDATES, felt: felt.length, candidatesNotShown: more, feltFromCut: felt.filter((x) => w.candidates.includes(x) && !shownCandidates.includes(x)).length });
  });

  test("felt candidates past the cap come into the felt lane, and the row counts them (lanes.feltFromCut)", async () => {
    const c = brain();
    const w = world(c);
    // Every candidate felt, so the cut ones compete for felt's slots.
    w.candidates.forEach((id, i) => c.store.addFeelings(id, [{ whose: "self", core: "warm", emotion: "proud", strength: 0.3 + i * 0.001 }]));
    const { texts, rid, aliases } = await reflect(c);
    const head = texts[0] as string;
    const al = aliases as AliasMap;
    const shownCandidates = lane(head, "candidates: ", al);
    const felt = lane(head, "felt (of ", al);
    const fromCut = felt.filter((x) => w.candidates.includes(x) && !shownCandidates.includes(x));
    expect(fromCut.length).toBeGreaterThan(0);
    for (const x of felt) expect(shownCandidates).not.toContain(x);
    expect((detailOf(c, rid)["lanes"] as Record<string, number>)["feltFromCut"]).toBe(fromCut.length);
  });

  test("the lane counts and chaptersAs survive the finish, beside fit", async () => {
    const c = brain();
    world(c);
    const { rid, s } = await reflect(c);
    const begun = detailOf(c, rid);
    expect(begun["chaptersAs"]).toBe("summaries");
    await finish(s, rid);
    const done = detailOf(c, rid);
    expect(c.store.reflection(rid)?.state).toBe("reflected");
    expect(done["fit"]).toEqual(begun["fit"]);
    expect(done["lanes"]).toEqual(begun["lanes"]);
    expect(done["chaptersAs"]).toBe("summaries");
    // The D1 check's query finds the finished row and its counts.
    const row = c.store.reflections({ limit: 5 }).find((r) => r.id === rid);
    const d = JSON.parse(row?.detail ?? "{}") as { chaptersAs?: string; lanes?: { candidates: number; candidatesNotShown: number } };
    expect(d.chaptersAs).toBe("summaries");
    expect(d.lanes?.candidates).toBe(REFLECT_TUNABLES.CANDIDATES);
    expect(d.lanes?.candidatesNotShown).toBe(30);
    // A second finish (the reflection finishing again) keeps them too.
    const again = await s.call("reflect", { phase: "finish", session: NIGHT, reflection: rid, entry: "A quiet night at the kiln, said again." });
    expect(again.isError ?? false).toBe(false);
    const twice = detailOf(c, rid);
    expect(twice["lanes"]).toEqual(begun["lanes"]);
    expect(twice["chaptersAs"]).toBe("summaries");
  });

  test("rotated: night after night the tail comes round, the least recently shown first, until every candidate was shown", async () => {
    const c = brain();
    const w = world(c);
    // Shown in any lane counts (a cut candidate may come in through felt): what the row's `shown` says.
    const seen = new Set<string>();
    const rows: Set<string>[] = [];
    const lanes: string[][] = [];
    const nights = Math.ceil((w.candidates.length - REFLECT_TUNABLES.CANDIDATES) / REFLECT_TUNABLES.CANDIDATES_ROTATED) + 1;
    for (let n = 0; n < nights; n += 1) {
      const { texts, rid, aliases, s } = await reflect(c);
      const shown = lane(texts[0] as string, "candidates: ", aliases as AliasMap);
      expect(shown).toHaveLength(REFLECT_TUNABLES.CANDIDATES);
      lanes.push(shown);
      const row = new Set(JSON.parse(c.store.reflection(rid)?.shown ?? "[]") as string[]);
      for (const id of shown) expect(row.has(id)).toBe(true);
      rows.push(row);
      for (const id of row) seen.add(id);
      await finish(s, rid);
      const date = `2026-10-${String(15 + n)}`;
      c.store.advanceClock(date);
      clock = Date.parse(`${date}T12:00:00Z`);
    }
    // The head stays; the rotated slots on the second night are ones the first night did not show at all.
    const headN = REFLECT_TUNABLES.CANDIDATES - REFLECT_TUNABLES.CANDIDATES_ROTATED;
    const second = (lanes[1] as string[]).filter((x) => !(lanes[0] as string[]).includes(x));
    expect(second).toHaveLength(REFLECT_TUNABLES.CANDIDATES_ROTATED);
    for (const id of second) expect((rows[0] as Set<string>).has(id)).toBe(false);
    expect((lanes[1] as string[]).filter((x) => (lanes[0] as string[]).includes(x))).toHaveLength(headN);
    // Every candidate was shown on some night.
    for (const id of w.candidates) expect(seen.has(id)).toBe(true);
  }, 60_000);

  test("at or under the cap: every candidate, no count line", async () => {
    const c = brain();
    const w = world(c, 25);
    const { texts, rid, aliases } = await reflect(c);
    const shown = lane(texts[0] as string, "candidates: ", aliases as AliasMap);
    expect(new Set(shown)).toEqual(new Set(w.candidates));
    expect(texts[0]).not.toContain("more candidates, not shown");
    expect((detailOf(c, rid)["lanes"] as Record<string, number>)["candidatesNotShown"]).toBe(0);
  });

  test("the switch off: every candidate shown and no count line, exactly as before (lean and JSON)", async () => {
    D["REFLECT_CANDIDATES_CAP"] = false;
    const c = brain();
    const w = world(c);
    const { texts, rid, aliases } = await reflect(c);
    const head = texts[0] as string;
    const al = aliases as AliasMap;
    const shown = lane(head, "candidates: ", al);
    expect(shown).toHaveLength(w.candidates.length);
    expect(head).not.toContain("more candidates, not shown");
    // feltOf counts no candidate: every one is in the candidates lane.
    const feltLine = head.split("\n").find((l) => l.startsWith("felt (of ")) ?? "";
    expect(feltLine.startsWith(`felt (of ${String(w.felt.length)})`)).toBe(true);
    expect((detailOf(c, rid)["lanes"] as Record<string, number>)["candidatesNotShown"]).toBe(0);
    // And the JSON bundle carries no count either.
    D["LEAN_BUNDLE"] = false;
    const date = "2026-10-15";
    c.store.advanceClock(date);
    clock = Date.parse(`${date}T12:00:00Z`);
    const s = server(c);
    const rb = await s.call("reflect", { phase: "begin", session: NIGHT });
    const first = String(sc(rb)["bundle"]);
    const bundle = JSON.parse(first.slice(first.indexOf("\n") + 1)) as ReflectBundle & { candidatesMore?: number };
    expect(bundle.candidates).toHaveLength(w.candidates.length);
    expect(bundle.candidatesMore).toBeUndefined();
    expect(bundle.lookup).toBe(REFLECT_LOOKUP_ORDER);
  });

  test("JSON with the cap on: the count rides the bundle as candidatesMore", async () => {
    D["LEAN_BUNDLE"] = false;
    const c = brain();
    const w = world(c);
    const s = server(c);
    const rb = await s.call("reflect", { phase: "begin", session: NIGHT });
    const first = String(sc(rb)["bundle"]);
    const bundle = JSON.parse(first.slice(first.indexOf("\n") + 1)) as ReflectBundle & { candidatesMore?: number };
    expect(bundle.candidates).toHaveLength(REFLECT_TUNABLES.CANDIDATES);
    expect(bundle.candidatesMore).toBe(w.candidates.length - REFLECT_TUNABLES.CANDIDATES);
    expect(bundle.lookup).toBe(REFLECT_LOOKUP_ORDER_CAPPED);
    expect(bundle.lookup).toContain("at most 30 a night");
  });
});

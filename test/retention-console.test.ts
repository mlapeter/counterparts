/**
 * THE SHARED "console" BUCKET GOES LINE BY LINE TOO (2026-11-01).
 *
 * `counterparts note` files its raw copy under the literal id `CONSOLE_SESSION`,
 * and each new note restarted the clocks for the rest, as `"mcp"` did
 * (`test/retention-unbound.test.ts` is that one, and the rule's edges). Driven
 * the way it happens: the real command (`run`), then the real worker (`runOnce`),
 * on a clock the test turns (`setSystemTime`, which both read).
 *
 * Hermetic: a fresh temp dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/adapters/cli/commands.js";
import { retentionJob, runOnce } from "../src/adapters/claude-code/bin/runner.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import { WRITE_UP_ASK_COUNT_KEY, WRITE_UP_ASK_DATE_KEY } from "../src/adapters/claude-code/hooks.js";
import { narrate } from "../src/adapters/dashboard/web/narrate.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { WRITE_UP_PART_BYTES, progressKey, readWriteUpProgress, recordSession, saveWriteUpProgress } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { STATIC_WEIGHTS_ENV } from "../src/core/embed/static.js";
import { keyFor, lastRetentionRun, planRetention, retentionSources } from "../src/core/remember/index.js";
import { planUnboundLines } from "../src/core/remember/owes.js";
import { pruneRetention } from "../src/core/remember/retention.js";
import { CONSOLE_SESSION, UNBOUND_SESSION } from "../src/core/types.js";

const DAY = 86_400_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const SCOPE = "/scope/console";
const T0 = Date.parse("2026-11-01T15:00:00Z");

let root: string;
let dir: string;
const closers: (() => unknown)[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-console-")));
  dir = join(root, "store");
  setSystemTime(new Date(T0));
  // The store the commands find, made the way a first open makes it.
  Counterpart.open({ dir }).close();
});

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) {
    try {
      await c();
    } catch {
      /* already closed */
    }
  }
  setSystemTime();
  rmSync(root, { recursive: true, force: true });
});

const at = (day: number): number => T0 + day * DAY;
const dateOf = (day: number): string => new Date(at(day)).toISOString().slice(0, 10);

/** One real command, as the console runs it. No meaning table: words alone is a real install too, and quick. */
async function cli(args: readonly string[], scope = SCOPE): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run([...args, "--dir", dir], {
    io: { out: (l) => out.push(l), err: (l) => err.push(l) },
    env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", [STATIC_WEIGHTS_ENV]: join(root, "no-table-here") },
    home: join(root, "home"),
    scope,
  });
  return { code, out, err };
}

/** A note that lands; its memory's id. */
async function note(text: string, scope = SCOPE): Promise<string> {
  const { code, out } = await cli(["note", text], scope);
  expect(code).toBe(0);
  const id = /^Remembered (mem_\S+) /.exec(out.find((l) => l.startsWith("Remembered ")) ?? "")?.[1];
  expect(id).toBeDefined();
  return id as string;
}

/** A note captured and then refused: `--kind` is read after the raw copy is on disk. */
async function refusedNote(text: string): Promise<void> {
  const { code, err } = await cli(["note", text, "--kind", "not-a-kind"]);
  expect(code).not.toBe(0);
  expect(err.join("\n")).toContain("not stored");
}

const words = (day: number): string =>
  `Field note for day ${String(day)}: the survey of the south ridge counted ${String(day * 5 + 2)} nests and the wind dropped.`;

async function worker(day: number): Promise<Awaited<ReturnType<typeof runOnce>>> {
  return runOnce({ config: { dataDir: dir, updateCheck: false, snapshots: { dir: join(root, "snaps") } }, date: dateOf(day) });
}

function rawLines(name: string, scope = SCOPE): string[] {
  const file = join(dir, "spans", keyFor(scope), name);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0);
}

function jotsOf(session: string, scope = SCOPE): { text: string; at: number }[] {
  return rawLines("jots.jsonl", scope)
    .map((l) => JSON.parse(l) as { text: string; at: number; session: string })
    .filter((s) => s.session === session);
}

/** Every file under `spans/`, with its bytes: what a read must leave as it found. */
function spansTree(from = join(dir, "spans")): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(from)) return out;
  for (const name of readdirSync(from)) {
    const path = join(from, name);
    if (statSync(path).isDirectory()) Object.assign(out, spansTree(path));
    else out[path] = readFileSync(path, "utf8");
  }
  return out;
}

describe("a note every 2 days, through the real command and the real worker", () => {
  test("day 0's raw copy goes on its own age while newer notes keep coming, every memory reads back, and doctor and the dashboard say so", async () => {
    const memories = new Map<number, string>();
    const held: Record<number, number> = {};
    for (let day = 0; day <= 20; day += 2) {
      setSystemTime(new Date(at(day)));
      memories.set(day, await note(words(day)));
      const pass = await worker(day);
      expect(pass.retention?.reason).toBe("ran");
      held[day] = jotsOf(CONSOLE_SESSION).length;
      for (const line of jotsOf(CONSOLE_SESSION)) expect(at(day) - line.at).toBeLessThan(3 * DAY);
    }
    // Filed under the console's id, and day 0 outlived one pass and went at the next.
    expect(held[0]).toBe(1);
    expect(held[2]).toBe(2);
    expect(held[4]).toBe(2);
    expect(jotsOf(CONSOLE_SESSION).map((l) => l.text)).toEqual([words(18), words(20)]);

    // The memories are not touched: all 11, words intact, by the real `ask --id`.
    expect(memories.size).toBe(11);
    for (const [day, id] of memories) {
      const asked = await cli(["ask", "--id", id]);
      expect(asked.code).toBe(0);
      expect(asked.out.join("\n")).toContain(words(day));
    }

    // Doctor's line and the dashboard's count the line that went, as a note.
    const c = Counterpart.open({ dir });
    closers.push(() => c.close());
    const newest = lastRetentionRun(c.store);
    expect(newest).toMatchObject({ reason: "PRUNED", unboundLines: 1, lines: 1, deleted: 0 });
    const doctor = await cli(["doctor", "--all"]);
    expect(doctor.out.join("\n")).toContain("1 old note with no session let go");
    const row = c.store.eventLog({ name: "remember.prune", limit: 200 }).at(-1);
    expect(row).toBeDefined();
    expect(narrate(c.store, row as NonNullable<typeof row>).text).toBe("The raw copy of 1 old note with no session was let go.");
  }, 60_000);

  test("the first pass after an upgrade takes the whole backlog at once, counted truly", async () => {
    const memories = new Map<number, string>();
    for (let day = 0; day <= 20; day += 2) {
      setSystemTime(new Date(at(day)));
      memories.set(day, await note(words(day)));
    }
    expect(jotsOf(CONSOLE_SESSION)).toHaveLength(11);
    const pass = await worker(20);
    expect(pass.retention?.report).toMatchObject({ reason: "PRUNED", deleted: 0, unboundLines: 9, lines: 9, failed: 0 });
    expect(jotsOf(CONSOLE_SESSION).map((l) => l.text)).toEqual([words(18), words(20)]);
    for (const [day, id] of memories) expect((await cli(["ask", "--id", id])).out.join("\n")).toContain(words(day));
  }, 60_000);

  test("a note the console refused owes: kept to the ceiling, then it goes, whatever it owes", async () => {
    const REFUSED = "The refused note about the ridge survey, kept only as a raw copy.";
    await refusedNote(REFUSED);
    expect(jotsOf(CONSOLE_SESSION).map((l) => l.text)).toEqual([REFUSED]);
    for (let day = 2; day <= 14; day += 2) {
      setSystemTime(new Date(at(day)));
      await note(words(day));
      await worker(day);
      if (day < 14) expect(jotsOf(CONSOLE_SESSION).some((l) => l.text === REFUSED)).toBe(true);
    }
    expect(jotsOf(CONSOLE_SESSION).map((l) => l.text)).toEqual([words(12), words(14)]);
  }, 60_000);

  test("a repeated note writes no second line, and its one line still goes on its first time", async () => {
    await note(words(0));
    setSystemTime(new Date(at(1)));
    const again = await cli(["note", words(0)]);
    expect(again.out.join("\n") + again.err.join("\n")).toContain("duplicate");
    expect(jotsOf(CONSOLE_SESSION).map((l) => l.at)).toEqual([at(0)]);
    setSystemTime(new Date(at(2)));
    await note(words(2));
    setSystemTime(new Date(at(4)));
    await note(words(4));
    expect((await worker(4)).retention?.report?.unboundLines).toBe(1);
    expect(jotsOf(CONSOLE_SESSION).map((l) => l.text)).toEqual([words(2), words(4)]);
  }, 60_000);
});

describe("what else goes by that id", () => {
  test("asking writes no raw line: a question, a question by meaning and an exact id all leave spans/ byte for byte", async () => {
    const id = await note(words(0));
    const before = spansTree();
    expect((await cli(["ask", "how many nests on the south ridge"])).code).toBe(0);
    expect((await cli(["ask", "how many nests on the south ridge", "--mode", "meaning"])).code).toBe(0);
    expect((await cli(["ask", "--id", id])).code).toBe(0);
    expect(spansTree()).toEqual(before);
    expect(jotsOf(CONSOLE_SESSION)).toHaveLength(1);
  }, 60_000);

  test("the two buckets are judged apart: the same words under the other id are not named, and a young line there shields nothing here", async () => {
    await note(words(0));
    const [own] = rawLines("jots.jsonl");
    const live = join(dir, "spans", keyFor(SCOPE), "jots.jsonl");
    // The same hash under the other shared id, young, as a capture after a strike could leave it.
    const twin = JSON.stringify({ ...(JSON.parse(own as string) as object), session: UNBOUND_SESSION, at: at(4) });
    appendFileSync(live, `${twin}\n`, "utf8");
    setSystemTime(new Date(at(4)));
    await note(words(4));

    const c = Counterpart.open({ dir });
    closers.push(() => c.close());
    const sources = retentionSources(c.store);
    expect(planUnboundLines(c.spans, sources).map((a) => [a.session, a.lines])).toEqual([[CONSOLE_SESSION, 1]]);
    const report = pruneRetention(c.spans, sources, { date: dateOf(4) });
    expect(report).toMatchObject({ unboundLines: 1, unboundSessions: [CONSOLE_SESSION] });
    expect(rawLines("jots.jsonl")).toContain(twin);
    expect(jotsOf(CONSOLE_SESSION).map((l) => l.text)).toEqual([words(4)]);
  }, 60_000);
});

describe("a real session is judged as it was", () => {
  test("in the same file: its lines are the same bytes and its verdict the same, before and after the console's lines go", async () => {
    const REAL = "console-but-a-real-session";
    const real = openServer({ dir, scope: SCOPE, env: {}, manifestVersion: () => null, session: REAL });
    closers.push(() => real.counterpart.close());
    const remember = async (text: string): Promise<void> => {
      await real.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "remember", arguments: { text } } });
    };
    await remember("The real session's first note, about the east ridge.");
    await note(words(0));
    setSystemTime(new Date(at(2)));
    await remember("The real session's second note, about the east ridge at dusk.");
    setSystemTime(new Date(at(4)));
    await note(words(4));

    const c = real.counterpart;
    const sources = retentionSources(c.store);
    const mine = (): string[] => rawLines("jots.jsonl").filter((l) => l.includes(`"session":"${REAL}"`));
    const before = mine();
    const verdict = planRetention(c.spans, sources).find((h) => h.session === REAL);
    expect(before).toHaveLength(2);

    expect(pruneRetention(c.spans, sources, { date: dateOf(4) }).unboundLines).toBe(1);
    expect(jotsOf(CONSOLE_SESSION).map((l) => l.text)).toEqual([words(4)]);
    expect(mine()).toEqual(before);
    expect(planRetention(c.spans, sources).find((h) => h.session === REAL)).toEqual(verdict);
  }, 60_000);
});

describe("a write-up of the bucket part way through", () => {
  const consoleKey = progressKey(CONSOLE_SESSION, SCOPE);
  const mcpKey = progressKey(UNBOUND_SESSION, SCOPE);
  const part = { chunk: WRITE_UP_PART_BYTES, parts: 3, handedAt: T0 };

  test("starts again only for the bucket that lost lines: the other's parts did not move", async () => {
    await note(words(0));
    setSystemTime(new Date(at(2)));
    await note(words(2));
    setSystemTime(new Date(at(4)));
    await note(words(4));
    const c = Counterpart.open({ dir });
    closers.push(() => c.close());
    saveWriteUpProgress(c.store, consoleKey, { ...part, done: 2 });
    saveWriteUpProgress(c.store, mcpKey, { ...part, done: 2 });
    expect(retentionJob({ counterpart: c, date: dateOf(4) }).report?.unboundSessions).toEqual([CONSOLE_SESSION]);
    expect(readWriteUpProgress(c.store)[consoleKey]).toMatchObject({ done: 0, rewound: true });
    expect(readWriteUpProgress(c.store)[mcpKey]?.done).toBe(2);
    expect(readWriteUpProgress(c.store)[mcpKey]?.rewound).toBeUndefined();
  }, 60_000);

  test("a writer holding a part across the pass, through the real door: what moved is still served", async () => {
    /** 3 KB of words that name themselves, so what the door served can be counted. */
    const tagged = (i: number): string => {
      const unit = `TAG${String(i).padStart(3, "0")}END the ridge survey counted nests by the water. `;
      return unit.repeat(Math.ceil(3000 / unit.length)).slice(0, 3000);
    };
    // Twelve refused on day 0 (past the ceiling at the pass), twelve on day 5: three parts.
    let i = 0;
    for (const base of [0, 5]) {
      for (let n = 0; n < 12; n++) {
        setSystemTime(new Date(at(base) + n * 10 * MIN));
        await refusedNote(tagged(i));
        i += 1;
      }
    }
    const served = new Set<string>();
    const pointed = (live: string): boolean => {
      const c = Counterpart.open({ dir });
      c.store.setMeta(WRITE_UP_ASK_DATE_KEY, "1999-01-01");
      c.store.setMeta(WRITE_UP_ASK_COUNT_KEY, "0");
      c.close();
      recordSession(dir, { sessionId: live, scope: SCOPE, phase: "start", at: Date.now() });
      const a = openAdapter({ dataDir: dir }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 4242 }), scope: { mode: "on", matched: SCOPE, entry: null } });
      const out = a.sessionStart({ sessionId: live, scope: SCOPE, at: new Date().toISOString().slice(0, 10) });
      a.counterpart.close();
      return (out.ask ?? "").includes(`writeUp: ${CONSOLE_SESSION}`);
    };
    const server = (): McpServer => {
      const s = openServer({ dir, scope: SCOPE, env: {}, manifestVersion: () => null });
      closers.push(() => s.counterpart.close());
      return s;
    };
    const fetchPart = async (s: McpServer, live: string): Promise<number> => {
      const out = (await s.call("session_end", { session: live, writeUp: CONSOLE_SESSION })).structuredContent;
      for (const m of String(out["text"]).matchAll(/TAG(\d+)END/g)) served.add(m[1] as string);
      return out["part"] as number;
    };
    const answer = async (s: McpServer, live: string): Promise<unknown> =>
      (await s.call("session_end", { session: live, writeUp: CONSOLE_SESSION, memories: [] })).structuredContent["reason"];

    // One writer finishes part 1; the next is holding part 2 when the pass runs.
    setSystemTime(new Date(at(13)));
    expect(pointed("writer-a")).toBe(true);
    const a = server();
    expect(await fetchPart(a, "writer-a")).toBe(1);
    expect(await answer(a, "writer-a")).toBe("part-written");
    setSystemTime(new Date(at(13) + 3 * HOUR));
    expect(pointed("writer-b")).toBe(true);
    const b = server();
    expect(await fetchPart(b, "writer-b")).toBe(2);

    setSystemTime(new Date(at(14) + 3 * HOUR));
    const c = Counterpart.open({ dir });
    expect(retentionJob({ counterpart: c, date: dateOf(14) }).report?.unboundLines).toBe(12);
    c.close();
    expect(await answer(b, "writer-b")).toBe("part-written");

    // Later sessions, one part each, until the bucket reads as written up.
    let finished = false;
    for (let w = 0; w < 8 && !finished; w++) {
      setSystemTime(new Date(at(14) + (4 + w) * HOUR));
      const live = `later-${String(w)}`;
      expect(pointed(live)).toBe(true);
      const s = server();
      await fetchPart(s, live);
      finished = (await answer(s, live)) === "written-up";
    }
    expect(finished).toBe(true);
    // Every word that outlived the pass, day 5's, was served to someone.
    for (let n = 12; n < 24; n++) expect(served.has(String(n).padStart(3, "0"))).toBe(true);
  }, 90_000);
});

/**
 * THE SHARED "mcp" BUCKET GOES LINE BY LINE (2026-11-01).
 *
 * A `remember` with no live session files its raw copy under the literal id
 * `UNBOUND_SESSION`, and retention judged all of those as one session: each new
 * note restarted the clocks for the rest. Driven here the way it happens:
 * `remember` through the real MCP door, then the real worker (`runOnce`), on a
 * clock the test turns (`setSystemTime`, which both read).
 *
 * The hosted tenant's shape of the same is in `hosted/test/retention-unbound.test.ts`.
 *
 * Hermetic: a fresh temp dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { NO_HOST_EVIDENCE, SpanBuffer, keyFor, lastRetentionRun, planRetention, retentionRow, retentionSources } from "../src/core/remember/index.js";
import type { RetentionSources } from "../src/core/remember/index.js";
import { planUnboundLines } from "../src/core/remember/owes.js";
import { pruneRetention } from "../src/core/remember/retention.js";
import { UNBOUND_SESSION } from "../src/core/types.js";
import { retentionClocks } from "../src/adapters/config.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { WRITE_UP_PART_BYTES, progressKey, readWriteUpProgress, saveWriteUpProgress } from "../src/adapters/sessions.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { retentionJob, runOnce } from "../src/adapters/claude-code/bin/runner.js";

const DAY = 86_400_000;
const SCOPE = "/scope/unbound";
const REAL_SESSION = "real-session-1";
const T0 = Date.parse("2026-11-01T15:00:00Z");

let root: string;
let dir: string;
const closers: (() => unknown)[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-unbound-")));
  dir = join(root, "store");
  setSystemTime(new Date(T0));
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

/** A server with no session, as one is when nobody woke it in four hours. */
function sessionless(opts: Parameters<typeof openServer>[0] = {}): McpServer {
  const s = openServer({
    dir,
    scope: SCOPE,
    env: {},
    manifestVersion: () => null,
    lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) },
    ...opts,
  });
  closers.push(() => s.counterpart.close());
  return s;
}

/** One `remember` through the JSON-RPC door a client talks to. */
async function remember(s: McpServer, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "remember", arguments: args } });
  const result = (res as { result?: { structuredContent?: Record<string, unknown> } } | null)?.result;
  return result?.structuredContent ?? {};
}

const note = (day: number): string =>
  `Field note for day ${String(day)}: the survey of the north ridge counted ${String(day * 7 + 3)} nests and the weather held.`;

/** The whole worker, once, on the clock as it stands. */
async function worker(day: number): Promise<Awaited<ReturnType<typeof runOnce>>> {
  return runOnce({ config: { dataDir: dir, updateCheck: false, snapshots: { dir: join(root, "snaps") } }, date: dateOf(day) });
}

/** Every raw line of a file, as the bytes hold it. */
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

function sources(c: Counterpart, clocks: { retentionMs?: number; maxMs?: number } = {}): RetentionSources {
  return retentionSources(c.store, clocks);
}

/** Is this memory still there, with these words? */
async function memoryHolds(s: McpServer, id: unknown, words: string): Promise<boolean> {
  const res = await s.call("recall", { handle: id });
  return JSON.stringify(res).includes(words);
}

describe("a note every 2 days, through the door and the worker", () => {
  test("day 0's raw copy goes on its own age while newer notes keep coming, and every memory stays", async () => {
    const s = sessionless();
    const held: Record<number, number> = {};
    const memories = new Map<number, unknown>();
    for (let day = 0; day <= 40; day += 2) {
      setSystemTime(new Date(at(day)));
      const out = await remember(s, { text: note(day) });
      expect(out["stored"]).toBe(true);
      memories.set(day, out["id"]);
      const run = await worker(day);
      expect(run.retention?.reason).toBe("ran");
      held[day] = jotsOf(UNBOUND_SESSION).length;
      // Nothing past the 3-day clock survives a pass, at any point in the run.
      for (const line of jotsOf(UNBOUND_SESSION)) expect(at(day) - line.at).toBeLessThan(3 * DAY);
    }
    // Filed where the brief says it is, and day 0 outlived only one pass.
    expect(held[0]).toBe(1);
    expect(held[2]).toBe(2);
    expect(held[4]).toBe(2);
    // At the end: the two newest, nothing else, 20 days after the last gap could have cleared it.
    expect(jotsOf(UNBOUND_SESSION).map((l) => l.text)).toEqual([note(38), note(40)]);

    // The memories themselves are not touched: all 21, words intact.
    for (const [day, id] of memories) expect(await memoryHolds(s, id, note(day))).toBe(true);

    // The row says what went, in lines, with the bucket not counted as a session.
    const newest = lastRetentionRun(s.counterpart.store);
    expect(newest?.reason).toBe("PRUNED");
    expect(newest?.unboundLines).toBe(1);
    expect(newest?.deleted).toBe(0);
  }, 60_000);

  test("a note whose memory did not land is kept to the ceiling, then goes, whatever it owes", async () => {
    const s = sessionless();
    // Captured, then refused: `feelings` is read after the raw copy is on disk.
    const refused = await remember(s, { text: "The refused note about the ridge survey, kept only as a raw copy.", feelings: "not a list" });
    expect(refused["reason"]).toBe("feelings-malformed");
    expect(jotsOf(UNBOUND_SESSION)).toHaveLength(1);

    for (let day = 2; day <= 14; day += 2) {
      setSystemTime(new Date(at(day)));
      await remember(s, { text: note(day) });
      await worker(day);
      // It owes, so it outlives the 3-day clock the notes around it go on...
      if (day < 14) expect(jotsOf(UNBOUND_SESSION).some((l) => l.text.startsWith("The refused note"))).toBe(true);
    }
    // ...and at 14 days it goes, while a note from 12 days later stays.
    expect(jotsOf(UNBOUND_SESSION).map((l) => l.text)).toEqual([note(12), note(14)]);
  }, 60_000);

  test("the first pass after an upgrade takes every line past its limit at once, and only those", async () => {
    // A bucket the old rule let grow: a note every 2 days for 40 days, no worker.
    const s = sessionless();
    const memories = new Map<number, unknown>();
    for (let day = 0; day <= 40; day += 2) {
      setSystemTime(new Date(at(day)));
      memories.set(day, (await remember(s, { text: note(day) }))["id"]);
    }
    expect(jotsOf(UNBOUND_SESSION)).toHaveLength(21);
    const run = await worker(40);
    expect(run.retention?.report).toMatchObject({ reason: "PRUNED", deleted: 0, unboundLines: 19, lines: 19, failed: 0 });
    expect(jotsOf(UNBOUND_SESSION).map((l) => l.text)).toEqual([note(38), note(40)]);
    for (const [day, id] of memories) expect(await memoryHolds(s, id, note(day))).toBe(true);
  }, 60_000);
});

describe("a real session is judged as it was", () => {
  test("in the same file: its lines are the same bytes, and its verdict the same, before and after the bucket's lines go", async () => {
    const real = sessionless({ session: REAL_SESSION });
    const unbound = sessionless();
    await remember(real, { text: "The real session's first note, about the south ridge." });
    await remember(unbound, { text: note(0) });
    setSystemTime(new Date(at(2)));
    await remember(real, { text: "The real session's second note, about the south ridge at dusk." });
    setSystemTime(new Date(at(4)));
    await remember(unbound, { text: note(4) });

    const c = unbound.counterpart;
    const realBefore = rawLines("jots.jsonl").filter((l) => l.includes(`"session":"${REAL_SESSION}"`));
    const verdictBefore = planRetention(c.spans, sources(c)).find((h) => h.session === REAL_SESSION);
    expect(realBefore).toHaveLength(2);

    const report = pruneRetention(c.spans, sources(c), { date: dateOf(4) });
    expect(report.unboundLines).toBe(1);
    expect(jotsOf(UNBOUND_SESSION).map((l) => l.text)).toEqual([note(4)]);

    expect(rawLines("jots.jsonl").filter((l) => l.includes(`"session":"${REAL_SESSION}"`))).toEqual(realBefore);
    expect(planRetention(c.spans, sources(c)).find((h) => h.session === REAL_SESSION)).toEqual(verdictBefore);
  });

  test("a real session that keeps being appended to keeps its old lines, as it did: only the bucket is line by line", async () => {
    const real = sessionless({ session: REAL_SESSION });
    for (let day = 0; day <= 20; day += 2) {
      setSystemTime(new Date(at(day)));
      await remember(real, { text: `A note of the long session on day ${String(day)}, about the east ridge.` });
    }
    const c = real.counterpart;
    const report = pruneRetention(c.spans, sources(c), { date: dateOf(20) });
    expect(report).toMatchObject({ reason: "NOTHING", unboundLines: 0, lines: 0 });
    expect(jotsOf(REAL_SESSION)).toHaveLength(11);
  });

  test("the same words under a real session are not named by the bucket's strike", async () => {
    const unbound = sessionless();
    await remember(unbound, { text: note(0) });
    // The same hash under a real session, as a capture from before the ledger trimmed it would hold.
    const [own] = rawLines("jots.jsonl");
    const twin = JSON.stringify({ ...(JSON.parse(own as string) as object), session: REAL_SESSION, at: at(4) });
    appendFileSync(join(dir, "spans", keyFor(SCOPE), "jots.jsonl"), `${twin}\n`, "utf8");
    setSystemTime(new Date(at(4)));
    // A newer note, so this is the line-by-line path and not the bucket clearing.
    await remember(unbound, { text: note(4) });

    const c = unbound.counterpart;
    expect(pruneRetention(c.spans, sources(c), { date: dateOf(4) }).unboundLines).toBe(1);
    expect(rawLines("jots.jsonl")).toContain(twin);
    expect(jotsOf(UNBOUND_SESSION).map((l) => l.text)).toEqual([note(4)]);
  });

  test("another scope with no aged line is not rewritten at all, and a torn line in the rewritten file stays", async () => {
    const unbound = sessionless();
    const elsewhere = sessionless({ scope: "/scope/elsewhere", session: REAL_SESSION });
    await remember(unbound, { text: note(0) });
    // A half-written line, as a crash leaves it.
    const torn = `{"hash":"half","session":"${UNBOUND_SESSION}","te`;
    appendFileSync(join(dir, "spans", keyFor(SCOPE), "jots.jsonl"), `${torn}\n`, "utf8");

    setSystemTime(new Date(at(4)));
    await remember(unbound, { text: note(4) });
    await remember(elsewhere, { text: "The real session's note in another folder, about the lake." });
    const before = readFileSync(join(dir, "spans", keyFor("/scope/elsewhere"), "jots.jsonl"), "utf8");
    const c = unbound.counterpart;
    expect(pruneRetention(c.spans, sources(c), { date: dateOf(4) }).unboundLines).toBe(1);

    expect(rawLines("jots.jsonl")).toContain(torn);
    expect(readFileSync(join(dir, "spans", keyFor("/scope/elsewhere"), "jots.jsonl"), "utf8")).toBe(before);
  });
});

describe("the plan's edges", () => {
  test("the bucket cleared by the session's own rule is one deleted session, not counted twice", async () => {
    const s = sessionless();
    await remember(s, { text: note(0) });
    await remember(s, { text: note(1) });
    setSystemTime(new Date(at(5)));
    const c = s.counterpart;
    const report = pruneRetention(c.spans, sources(c), { date: dateOf(5) });
    expect(report).toMatchObject({ deleted: 1, unboundLines: 0, lines: 2 });
    expect(jotsOf(UNBOUND_SESSION)).toHaveLength(0);
  });

  test("a line whose time will not read is never judged; a hash still on a young line stays", () => {
    const buffer = new SpanBuffer({ dir: join(root, "plan"), now: () => at(30), day: () => 30 });
    buffer.jot({ session: UNBOUND_SESSION, scope: SCOPE, text: "A line that gets a broken time." });
    const file = join(root, "plan", "spans", keyFor(SCOPE), "jots.jsonl");
    const [line] = readFileSync(file, "utf8").split("\n");
    const broken = { ...(JSON.parse(line as string) as object), at: "yesterday" };
    rmSync(file);
    appendFileSync(file, `${JSON.stringify(broken)}\n`, "utf8");
    const src: RetentionSources = { host: () => NO_HOST_EVIDENCE, zone: "UTC" };
    expect(planUnboundLines(buffer, src)).toEqual([]);

    // One hash on an aged line and a young one: nothing is named.
    const aged = { ...broken, at: at(0) };
    const young = { ...broken, at: at(30) };
    rmSync(file);
    appendFileSync(file, `${JSON.stringify(aged)}\n${JSON.stringify(young)}\n`, "utf8");
    expect(planUnboundLines(buffer, src)).toEqual([]);
  });

  test("the configuration's clocks are the ones it reads, and a write-up clock past the ceiling stops at the ceiling", async () => {
    const s = sessionless();
    await remember(s, { text: note(0) });
    const c = s.counterpart;
    const clocks = (afterWriteUpDays: number, maxDays: number): { retentionMs: number; maxMs: number } => {
      const { retentionMs, maxMs } = retentionClocks({ dataDir: dir, retention: { afterWriteUpDays, maxDays } });
      return { retentionMs, maxMs };
    };
    setSystemTime(new Date(at(2)));
    expect(planUnboundLines(c.spans, sources(c, clocks(3, 14)))).toEqual([]);
    expect(planUnboundLines(c.spans, sources(c, clocks(1, 14)))).toHaveLength(1);
    expect(planUnboundLines(c.spans, sources(c, clocks(30, 2)))).toHaveLength(1);
    expect(planUnboundLines(c.spans, sources(c, clocks(30, 3)))).toEqual([]);
  });

  test("a row written before this keeps reading: no count is 0", () => {
    const row = retentionRow({ reason: "NOTHING", scopes: 0, deleted: 0, keptOwed: 0, keptYoung: 0, keptLive: 0, failed: 0, lines: 0, bytes: 0, unboundLines: 0 }, "2026-11-01");
    expect(row["unboundLines"]).toBe(0);
    const c = Counterpart.open({ dir });
    closers.push(() => c.close());
    const { unboundLines: _gone, ...old } = row;
    c.store.appendEvent({ name: "remember.prune", day: 0, payload: old, dedupKey: "old-row" });
    expect(lastRetentionRun(c.store)?.unboundLines).toBe(0);
  });
});

describe("a write-up of the bucket part way through", () => {
  const key = progressKey(UNBOUND_SESSION, SCOPE);
  const part = { chunk: WRITE_UP_PART_BYTES, parts: 3, handedAt: T0 };

  test("starts again when lines go from its head: served twice, never skipped", async () => {
    const s = sessionless();
    await remember(s, { text: note(0) });
    const c = s.counterpart;
    saveWriteUpProgress(c.store, key, { ...part, done: 2 });
    setSystemTime(new Date(at(2)));
    await remember(s, { text: note(2) });
    setSystemTime(new Date(at(4)));
    await remember(s, { text: note(4) });
    const job = retentionJob({ counterpart: c, date: dateOf(4) });
    expect(job.report?.unboundLines).toBe(1);
    expect(readWriteUpProgress(c.store)[key]?.done).toBe(0);
  });

  test("is left alone when nothing went, and a real session's never moves", async () => {
    const s = sessionless();
    await remember(s, { text: note(0) });
    const c = s.counterpart;
    const real = progressKey(REAL_SESSION, SCOPE);
    saveWriteUpProgress(c.store, key, { ...part, done: 1 });
    saveWriteUpProgress(c.store, real, { ...part, done: 1 });
    expect(retentionJob({ counterpart: c, date: dateOf(0) }).report?.unboundLines).toBe(0);
    expect(readWriteUpProgress(c.store)[key]?.done).toBe(1);

    setSystemTime(new Date(at(2)));
    await remember(s, { text: note(2) });
    setSystemTime(new Date(at(4)));
    await remember(s, { text: note(4) });
    expect(retentionJob({ counterpart: c, date: dateOf(4) }).report?.unboundLines).toBe(1);
    expect(readWriteUpProgress(c.store)[real]?.done).toBe(1);
  });
});

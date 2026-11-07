/**
 * SO1 STEP 1 — THE NIGHT CLOSES OPEN ITEMS ITSELF (2026-11-07). A later
 * release in the same series closes the earlier release steps still open
 * (`src/core/open-close.ts`, the night's `close` phase); what it would not
 * close is listed as "may be done" under `recall "still open"`; the next
 * wake names what closed; a touch reopens it.
 *
 * The real path: items written through the MCP `remember` and `session_end`
 * tools, the night run by the boundary (`Counterpart#sessionEnd`), the next
 * wake read through `Counterpart#wake`, and Still open through the MCP
 * `recall` handle.
 *
 * Hermetic: every store is a temp dir made and removed here; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { MAY_BE_DONE_META, NIGHT_CLOSE_EVENT, NIGHT_CLOSE_RULE, NIGHT_REOPEN_EVENT, nightClosedOf } from "../src/core/open-close.js";
import { INTERFERENCE_SOURCE } from "../src/core/interference.js";
import { PHASES } from "../src/core/sleep/index.js";
import { WAKE_SHAPE_KEY } from "../src/core/self/tunables.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ZONE = "UTC";
const BUDGET = 9_000;
const S = "1f0e0000-0000-4000-8000-0000000000c1";

let root: string;
let HERE: string;
let ELSEWHERE: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-night-close-")));
  HERE = join(root, "shop");
  ELSEWHERE = join(root, "bakery");
  mkdirSync(HERE, { recursive: true });
  mkdirSync(ELSEWHERE, { recursive: true });
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

interface World {
  c: Counterpart;
  today(): string;
  toDay(n: number): void;
  tools(scope?: string, session?: string): McpServer;
  night(): Promise<Awaited<ReturnType<Counterpart["sessionEnd"]>>>;
  wake(scope: string, session: string): string;
}

function world(): World {
  let now = Date.parse("2026-11-01T09:00:00Z");
  const c = Counterpart.open({ dir: join(root, "store"), budgetBytes: BUDGET, now: () => now, timeZone: ZONE });
  open.push(c);
  const today = (): string => new Date(now).toISOString().slice(0, 10);
  c.store.advanceClock(today());
  return {
    c,
    today,
    toDay(n) {
      while (c.store.livedDay() < n) {
        now += DAY;
        c.store.advanceClock(today());
      }
      expect(c.store.livedDay()).toBe(n);
    },
    tools: (scope = HERE, session = S) => new McpServer({ counterpart: c, session, scope, now: () => now }),
    night: () => c.sessionEnd({ date: today(), budgetBytes: BUDGET, session: S }),
    wake(scope, session) {
      const w = c.wake(BUDGET, { date: today() }, { scope, session });
      expect(w.ok).toBe(true);
      return w.text;
    },
  };
}

async function remember(s: McpServer, args: Record<string, unknown>): Promise<string> {
  const r = await s.call("remember", { about: "work", ...args });
  expect(r.isError ?? false).toBe(false);
  const id = r.structuredContent["id"];
  expect(typeof id).toBe("string");
  return id as string;
}

function idOf(w: World, words: string): string {
  const id = w.c.store.list({ type: "memory" }).find((x) => w.c.store.readProse(x).body.includes(words));
  if (id === undefined) throw new Error(`no memory says ${words}`);
  return id;
}

const isOpen = (w: World, id: string): boolean => w.c.store.readProse(id).meta["unresolved"] === true;

async function stillOpen(s: McpServer): Promise<{ items: Record<string, unknown>[]; note: string }> {
  const r = await s.call("recall", { handle: "still open" });
  expect(r.isError ?? false).toBe(false);
  return { items: (r.structuredContent["items"] ?? []) as Record<string, unknown>[], note: String(r.structuredContent["note"] ?? "") };
}

/** Three release steps, an asked one, a pinned one and a check, then 0.3.50 released two days on. */
interface Week {
  ready: string;
  after: string;
  cut: string;
  pinned: string;
  asked: string;
  check: string;
  sameVersion: string;
  elsewhere: string;
  released: string;
}

async function releaseWeek(w: World): Promise<Week> {
  const s = w.tools();
  w.toDay(1);
  const ready = await remember(s, { text: "0.3.46 ready for the owner to publish: tarball built, sheet written.", unresolved: true, settlesWhen: "the owner publishes 0.3.46" });
  const after = await remember(s, { text: "0.3.47 after-publish steps: tag pushed, release notes to the site.", unresolved: true });
  const ended = await s.call("session_end", { session: S, memories: [{ content: "0.3.48 cut from the release branch; waiting on the owner's publish.", about: "work", unresolved: true, status: "planned" }] });
  expect(ended.isError ?? false).toBe(false);
  const cut = idOf(w, "0.3.48 cut from the release branch");
  // Wrong shapes, never closed by a release.
  const pinned = await remember(s, { text: "0.3.49 pinned at a commit; the release agent is on it.", unresolved: true });
  const asked = await remember(s, { text: "0.3.46 ready: should it go out tonight or wait for the till fix?", unresolved: true, status: "asked" });
  const check = await remember(s, { text: "Check after 0.3.47 published: read whether the shelf counts held.", unresolved: true });
  const sameVersion = await remember(s, { text: "0.3.50 after-publish steps: site notes and the plugin bump.", unresolved: true });
  const elsewhere = await remember(w.tools(ELSEWHERE), { text: "0.3.20 ready to publish in the bakery: the oven timer.", unresolved: true });
  w.toDay(3);
  const released = await remember(s, { text: "0.3.50 released to npm; the shop install updated cleanly.", status: "done" });
  return { ready, after, cut, pinned, asked, check, sameVersion, elsewhere, released };
}

// ═══════════════════════════════════════════════════════════════════════════
describe("the night closes what a later release shows done", () => {
  test("a release closes the older ready / after-publish / cut items in its series and folder, each recorded with its reason and evidence", async () => {
    const w = world();
    const m = await releaseWeek(w);
    const report = await w.night();
    expect(report.cycle.order).toEqual([...PHASES]);
    const phase = report.cycle.phases.find((p) => p.phase === "close");
    expect(phase?.status).toBe("ran");
    expect(report.cycle.closed.map((x) => x.id).sort()).toEqual([m.ready, m.after, m.cut].sort());
    for (const id of [m.ready, m.after, m.cut]) {
      expect(isOpen(w, id)).toBe(false);
      const by = nightClosedOf(w.c.store.readProse(id).meta);
      expect(by?.rule).toBe(NIGHT_CLOSE_RULE);
      expect(by?.shows).toBe(m.released);
      expect(by?.why).toBe("0.3.50 released");
    }
    const events = w.c.store.eventLog({ name: NIGHT_CLOSE_EVENT }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>);
    expect(events.map((e) => e["id"]).sort()).toEqual([m.ready, m.after, m.cut].sort());
    for (const e of events) {
      expect(e["shows"]).toBe(m.released);
      expect(e["reason"]).toBe("0.3.50 released");
    }
    // The night's durable row counts them.
    const row = w.c.store.eventLog({ name: "sleep.cycle", order: "asc" }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>).at(-1) ?? {};
    expect(row["closed"]).toBe(3);
  });

  test("the wrong shapes stay open: a pinned item, the same version's own after-publish, a check, another folder's series, and a question to the owner", async () => {
    const w = world();
    const m = await releaseWeek(w);
    await w.night();
    for (const id of [m.pinned, m.sameVersion, m.check, m.elsewhere, m.asked]) expect(isOpen(w, id)).toBe(true);
    // The asked one names the same release step a closed one does: similarity is not the owner's answer.
    expect(isOpen(w, m.ready)).toBe(false);
  });

  test("the unsure ones are listed as may be done under recall \"still open\", and nobody is asked", async () => {
    const w = world();
    const m = await releaseWeek(w);
    await w.night();
    const listed = JSON.parse(w.c.store.getMeta(MAY_BE_DONE_META) ?? "{}") as { items?: { id: string }[] };
    const ids = (listed.items ?? []).map((x) => x.id);
    expect(ids).toContain(m.pinned);
    expect(ids).toContain(m.asked);
    expect(ids).not.toContain(m.check);
    const { items, note } = await stillOpen(w.tools());
    const pinned = items.find((i) => i["id"] === m.pinned);
    expect(String(pinned?.["mayBeDone"] ?? "")).toContain("0.3.50 released since");
    expect(String(pinned?.["mayBeDone"] ?? "")).toContain(m.released);
    expect(items.find((i) => i["id"] === m.check)?.["mayBeDone"]).toBeUndefined();
    expect(note).toContain("mayBeDone");
    // The closed ones are not listed at all.
    expect(items.some((i) => i["id"] === m.ready)).toBe(false);
  });

  test("the next wake names what closed and why in its own folder, and not in another", async () => {
    const w = world();
    const m = await releaseWeek(w);
    await w.night();
    // The shaped wake (WK2): on for every new install and the owner's store.
    w.c.store.setMeta(WAKE_SHAPE_KEY, "on");
    w.toDay(4);
    const here = w.wake(HERE, "1f0e0000-0000-4000-8000-0000000000d1");
    const line = here.split("\n").find((l) => l.startsWith("Closed by the night")) ?? "";
    expect(line).toContain("Closed by the night (3)");
    expect(line).toContain(`0.3.50 released [${m.ready}]`);
    expect(line).toContain('"reopen"');
    const there = w.wake(ELSEWHERE, "1f0e0000-0000-4000-8000-0000000000d2");
    expect(there).not.toContain("Closed by the night");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("a touch reopens it, recorded", () => {
  test("the reflect tool's phase reopen, by the item's id alone, puts it back in Still open — even after a later night faded it under the release", async () => {
    const w = world();
    const m = await releaseWeek(w);
    await w.night();
    // A second night: the interference sweep may now fade the closed item (no settlesWhen) under the release.
    w.toDay(4);
    await w.night();
    const faded = w.c.store.contradictions({ limit: 1_000 }).some((p) => p.source === INTERFERENCE_SOURCE && p.a === m.after && p.state === "settled");
    expect(faded).toBe(true);
    const s = w.tools();
    const r = await s.call("reflect", { phase: "reopen", reopen: [m.after] });
    expect(r.isError ?? false).toBe(false);
    expect(isOpen(w, m.after)).toBe(true);
    const back = await stillOpen(s);
    expect(back.items.some((i) => i["id"] === m.after)).toBe(true);
    const ev = w.c.store.eventLog({ name: NIGHT_REOPEN_EVENT }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>);
    expect(ev.at(-1)?.["id"]).toBe(m.after);
    expect(ev.at(-1)?.["by"]).toBe("reopen");
    // No night closes it again on its own: it may only be listed.
    w.toDay(5);
    await w.night();
    expect(isOpen(w, m.after)).toBe(true);
  });

  test("a write that updates it and says unresolved carries the thread on, recorded, and the night leaves the new row open", async () => {
    const w = world();
    const m = await releaseWeek(w);
    await w.night();
    w.toDay(4);
    const s = w.tools();
    const next = await remember(s, { text: "0.3.46 ready: not actually published, the npm login failed.", unresolved: true, updates: m.ready });
    expect(isOpen(w, next)).toBe(true);
    const ev = w.c.store.eventLog({ name: NIGHT_REOPEN_EVENT }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>);
    expect(ev.at(-1)?.["id"]).toBe(m.ready);
    expect(ev.at(-1)?.["by"]).toBe("updates");
    expect(ev.at(-1)?.["successor"]).toBe(next);
    // The trigger carried with the thread.
    expect(w.c.store.readProse(next).meta["settlesWhen"]).toBe("the owner publishes 0.3.46");
    w.toDay(5);
    await w.night();
    expect(isOpen(w, next)).toBe(true);
  });

  test("recalling a closed item by id is not a touch: it stays closed", async () => {
    const w = world();
    const m = await releaseWeek(w);
    await w.night();
    const s = w.tools();
    const r = await s.call("recall", { handle: m.ready });
    expect(r.isError ?? false).toBe(false);
    expect(isOpen(w, m.ready)).toBe(false);
  });
});

/**
 * The reflection proposes closing stale open threads; a yes closes them
 * (2026-10-16, #489 D — a lightly held default). The nightly reflection is
 * shown a few open threads nobody has touched for `STALE_OPEN_DAYS` lived
 * days, may name the ones that look done (`finish`'s `close`, ids from that
 * list only), the share asks the owner, and the reflect tool's phase `close`
 * — only on that yes — clears the flag. Nothing closes without it.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is
 * called. Dates follow the test clock (`localDate`), never hard-coded.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { REFLECT_TUNABLES } from "../src/core/dream/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { addDays, localDate } from "../src/core/time.js";

let dir: string;
const open: Counterpart[] = [];
let dateN = 0;
const BASE = Date.now();
const SESSION = "s-close";

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-close-proposals-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function brain(): Counterpart {
  const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" }, now: () => BASE + dateN * 86_400_000 });
  open.push(c);
  return c;
}

/** The next calendar day on the lived clock, from the test clock. */
function nextDay(c: Counterpart): number {
  dateN += 1;
  c.store.advanceClock(addDays(localDate(BASE), dateN));
  return c.store.livedDay();
}

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

const openFlag = (c: Counterpart, id: string): unknown => c.store.readProse(id).meta["unresolved"];

/** A stale open thread, a stale closed memory, and a fresh open thread. */
function world(c: Counterpart): { stale: string; staleToo: string; closedOld: string; fresh: string } {
  nextDay(c);
  const stale = mem(c, "Open: does the tarball in the backups folder need signing?", { meta: { unresolved: true } });
  const staleToo = mem(c, "Open: which day does the store move?", { meta: { unresolved: true } });
  const closedOld = mem(c, "The deploy freeze ended on the 20th.");
  for (let i = 0; i < REFLECT_TUNABLES.STALE_OPEN_DAYS + 1; i += 1) nextDay(c);
  const fresh = mem(c, "Open: should the glance open on a click?", { meta: { unresolved: true } });
  return { stale, staleToo, closedOld, fresh };
}

describe("stale open threads, proposed closed", () => {
  test("the bundle lists only open threads untouched for STALE_OPEN_DAYS lived days", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const ids = begun.bundle.staleOpen.map((x) => x.id);
    expect(ids).toContain(w.stale);
    expect(ids).toContain(w.staleToo);
    expect(ids).not.toContain(w.fresh);
    expect(ids).not.toContain(w.closedOld);
    for (const s of begun.bundle.staleOpen) expect(s.untouched).toBeGreaterThanOrEqual(REFLECT_TUNABLES.STALE_OPEN_DAYS);
    expect(begun.instructions).toContain("staleOpen");
  });

  test("the list is capped at STALE_OPEN", () => {
    const c = brain();
    nextDay(c);
    for (let i = 0; i < REFLECT_TUNABLES.STALE_OPEN + 3; i += 1) mem(c, `Open question number ${String(i)} about the build.`, { meta: { unresolved: true } });
    for (let i = 0; i < REFLECT_TUNABLES.STALE_OPEN_DAYS; i += 1) nextDay(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.bundle.staleOpen.length).toBe(REFLECT_TUNABLES.STALE_OPEN);
  });

  test("finish proposes only listed ids, closes nothing, and the share asks", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "A quiet look back.",
      close: [w.stale, w.fresh],
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.close.proposed).toEqual([w.stale]);
    expect(done.outcome.close.refused).toEqual([{ id: w.fresh, reason: "not-offered" }]);
    // Nothing closed by the proposal.
    expect(openFlag(c, w.stale)).toBe(true);
    // The share is offered even on a night that cites nothing, and asks.
    expect(done.outcome.share.offered).toBe(true);
    const row = c.store.reflection(begun.bundle.reflection);
    expect(row?.share ?? "").toContain(w.stale);
    expect(row?.share ?? "").toContain("Shall I close it?");
    expect(done.outcome.handBack).toContain('phase "close"');
  });

  test("a second finish keeps one question, not two", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.reflection;
    c.reflections.finish({ reflection: id, session: SESSION, entry: "First.", close: [w.stale] });
    const again = c.reflections.finish({ reflection: id, session: SESSION, close: [w.staleToo] });
    if (!again.ok) throw new Error(again.reason);
    expect(again.outcome.close.proposed).toEqual([w.stale, w.staleToo]);
    const share = c.store.reflection(id)?.share ?? "";
    expect(share.match(/Shall I close/g)?.length).toBe(1);
    expect(share).toContain(w.staleToo);
  });

  test("close closes only proposed ids; again says already; the carried line tells the session how", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.reflection;
    c.reflections.finish({ reflection: id, session: SESSION, entry: "A look back.", close: [w.stale] });

    const carried = c.reflections.carryLine({ session: "s-next", reflection: id });
    expect(carried ?? "").toContain('phase "close"');
    expect(carried ?? "").toContain(w.stale);

    const out = c.reflections.close({ reflection: id, session: "s-next", ids: [w.stale, w.staleToo] });
    if (!out.ok) throw new Error(out.reason);
    expect(out.closed).toEqual([w.stale]);
    expect(out.refused).toEqual([{ id: w.staleToo, reason: "not-proposed" }]);
    expect(openFlag(c, w.stale)).toBe(false);
    expect(openFlag(c, w.staleToo)).toBe(true);
    expect(c.store.openThreadIds()).not.toContain(w.stale);

    const twice = c.reflections.close({ reflection: id, session: "s-next", ids: [w.stale] });
    if (!twice.ok) throw new Error(twice.reason);
    expect(twice.closed).toEqual([]);
    expect(twice.already).toEqual([w.stale]);
  });

  test("a reflection that proposed nothing closes nothing", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, entry: "Nothing much." });
    expect(c.reflections.close({ reflection: begun.bundle.reflection, session: SESSION, ids: [w.stale] })).toEqual({ ok: false, reason: "nothing-proposed" });
    expect(openFlag(c, w.stale)).toBe(true);
  });
  test("from a session that is not the owner's, close refuses a thread written in another directory", () => {
    let c = brain();
    nextDay(c);
    const there = mem(c, "Open: is the other project's deploy done?", { meta: { unresolved: true }, origin: { scope: "/a" } });
    for (let i = 0; i < REFLECT_TUNABLES.STALE_OPEN_DAYS + 1; i += 1) nextDay(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.reflection;
    const done = c.reflections.finish({ reflection: id, session: SESSION, entry: "A look back.", close: [there] });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.close.proposed).toEqual([there]);
    c.close();
    open.splice(0);
    c = Counterpart.open({ dir, owner: false, identity: { name: "Mike" }, now: () => BASE + dateN * 86_400_000 });
    open.push(c);
    const elsewhere = c.reflections.close({ reflection: id, session: "s-guest", ids: [there], scope: "/b" });
    if (!elsewhere.ok) throw new Error(elsewhere.reason);
    expect(elsewhere.closed).toEqual([]);
    expect(elsewhere.refused).toEqual([{ id: there, reason: "other-directory" }]);
    expect(openFlag(c, there)).toBe(true);
    const here = c.reflections.close({ reflection: id, session: "s-guest", ids: [there], scope: "/a" });
    if (!here.ok) throw new Error(here.reason);
    expect(here.closed).toEqual([there]);
    expect(openFlag(c, there)).toBe(false);
  });
});

describe("the reflect tool's close phase", () => {
  test("finish proposes through the tool; close on a yes clears the flag", async () => {
    const c = brain();
    const w = world(c);
    c.close();
    open.splice(0);
    recordSession(dir, { sessionId: SESSION, scope: "/proj", phase: "start" });
    const s = openServer({ dir, session: SESSION, scope: "/proj", owner: true, now: () => BASE + dateN * 86_400_000 });
    try {
      const begin = await s.call("reflect", { phase: "begin", session: SESSION });
      expect(begin.isError ?? false).toBe(false);
      const id = begin.structuredContent["reflection"] as string;
      const finish = await s.call("reflect", { phase: "finish", session: SESSION, reflection: id, entry: "A look back.", close: [w.stale] });
      expect(finish.isError ?? false).toBe(false);
      expect((finish.structuredContent["close"] as { proposed: string[] }).proposed).toEqual([w.stale]);
      expect(s.counterpart.store.readProse(w.stale).meta["unresolved"]).toBe(true);

      const none = await s.call("reflect", { phase: "close", session: SESSION, reflection: id });
      expect(none.isError).toBe(true);

      const yes = await s.call("reflect", { phase: "close", session: SESSION, reflection: id, close: [w.stale] });
      expect(yes.isError ?? false).toBe(false);
      expect(yes.structuredContent["closed"]).toEqual([w.stale]);
      expect(s.counterpart.store.readProse(w.stale).meta["unresolved"]).toBe(false);
    } finally {
      s.counterpart.close();
    }
  });
});

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
  const c = Counterpart.open({ dir, identity: { name: "Mike" }, now: () => BASE + dateN * 86_400_000 });
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
  test("close takes a thread written in another directory, from any session (the folder check went with the yours/guest split, 2026-10-21)", () => {
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
    c = Counterpart.open({ dir, identity: { name: "Mike" }, now: () => BASE + dateN * 86_400_000 });
    open.push(c);
    const elsewhere = c.reflections.close({ reflection: id, session: "s-guest", ids: [there], scope: "/b" });
    if (!elsewhere.ok) throw new Error(elsewhere.reason);
    expect(elsewhere.closed).toEqual([there]);
    expect(elsewhere.refused).toEqual([]);
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
    const s = openServer({ dir, session: SESSION, scope: "/proj", now: () => BASE + dateN * 86_400_000 });
    try {
      const begin = await s.call("reflect", { phase: "begin", session: SESSION });
      expect(begin.isError ?? false).toBe(false);
      const id = begin.structuredContent["reflection"] as string;
      const finish = await s.call("reflect", { phase: "finish", session: SESSION, reflection: id, entry: "A look back.", close: [w.stale] });
      expect(finish.isError ?? false).toBe(false);
      // Lean (2026-10-23): the answer names it as the reflection knows it.
      expect((finish.structuredContent["close"] as { proposed: string[] }).proposed).toEqual([s.counterpart.reflections.aliasesOf(id)?.short(w.stale) ?? w.stale]);
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

/**
 * The reflection closes the plainly done ones itself (2026-10-20, an
 * experiment agreed with Mike): `finish`'s `closeNow`, each with a why, said
 * in the share with the way back (`reopen`); the unsure ones are still asked.
 */
describe("stale open threads, closed when plainly done", () => {
  test("a self-close closes, records its why on the memory and the row, and the share names it", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.reflection;
    expect(begun.instructions).toContain("closeNow");
    expect(begun.instructions).toContain("never close one just because it is old");
    const done = c.reflections.finish({
      reflection: id,
      session: SESSION,
      entry: "A look back.",
      closeNow: [{ id: w.stale, why: "The tarball was signed on the 12th.", shows: w.closedOld }],
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.close.closed).toEqual([{ id: w.stale, why: "The tarball was signed on the 12th.", shows: w.closedOld }]);
    expect(done.outcome.close.proposed).toEqual([]);
    expect(openFlag(c, w.stale)).toBe(false);
    expect(c.store.openThreadIds()).not.toContain(w.stale);
    expect(c.store.readProse(w.stale).meta["threadClosedBy"]).toEqual({ reflection: id, why: "The tarball was signed on the 12th.", shows: w.closedOld });
    const row = c.store.reflection(id);
    expect(JSON.parse(row?.detail ?? "{}")["selfClosed"]).toEqual([{ id: w.stale, why: "The tarball was signed on the 12th.", shows: w.closedOld }]);
    // The share says it, with the why and the way back; nothing is asked.
    expect(done.outcome.share.offered).toBe(true);
    const share = row?.share ?? "";
    expect(share).toContain("I closed one open thread that looked done");
    expect(share).toContain(w.stale);
    expect(share).toContain("signed on the 12th");
    expect(share).toContain("I'll reopen it");
    expect(share).not.toContain("Shall I close");
    // The waking session is told what was closed and how to reopen one.
    expect(done.outcome.handBack).toContain('phase "reopen"');
    expect(done.outcome.handBack).not.toContain('phase "close"');
    const carried = c.reflections.carryLine({ session: "s-next", reflection: id });
    expect(carried ?? "").toContain('phase "reopen"');
    expect(carried ?? "").toContain(w.stale);
  });

  test("an id not in staleOpen, or one sent without a why, is refused and stays open", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "A look back.",
      closeNow: [
        { id: w.fresh, why: "It was answered." },
        { id: w.stale, why: "   " },
      ],
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.close.closed).toEqual([]);
    expect(done.outcome.close.refused).toEqual([
      { id: w.fresh, reason: "not-offered" },
      { id: w.stale, reason: "why-required" },
    ]);
    expect(openFlag(c, w.fresh)).toBe(true);
    expect(openFlag(c, w.stale)).toBe(true);
    expect(done.outcome.retry ?? "").toContain("why-required");
  });

  test("the unsure ones are still asked, beside what was closed", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.reflection;
    const done = c.reflections.finish({
      reflection: id,
      session: SESSION,
      entry: "A look back.",
      closeNow: [{ id: w.stale, why: "Signed." }],
      close: [w.staleToo],
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.close.closed.map((x) => x.id)).toEqual([w.stale]);
    expect(done.outcome.close.proposed).toEqual([w.staleToo]);
    expect(openFlag(c, w.stale)).toBe(false);
    expect(openFlag(c, w.staleToo)).toBe(true);
    const share = c.store.reflection(id)?.share ?? "";
    expect(share).toContain("I closed one open thread");
    expect(share).toContain("Shall I close it?");
    expect(share.indexOf("I closed")).toBeLessThan(share.indexOf("Shall I close"));
    expect(done.outcome.handBack).toContain('phase "reopen"');
    expect(done.outcome.handBack).toContain('phase "close"');
    // A second finish says the lines once; one already asked is not closed instead.
    const again = c.reflections.finish({ reflection: id, session: SESSION, closeNow: [{ id: w.staleToo, why: "Moved on the 3rd." }] });
    if (!again.ok) throw new Error(again.reason);
    expect(again.outcome.close.refused).toEqual([{ id: w.staleToo, reason: "already-asked" }]);
    expect(openFlag(c, w.staleToo)).toBe(true);
    const after = c.store.reflection(id)?.share ?? "";
    expect(after.match(/I closed/g)?.length).toBe(1);
    expect(after.match(/Shall I close/g)?.length).toBe(1);
  });

  test("asked and closed together keep to STALE_OPEN a night", () => {
    const c = brain();
    nextDay(c);
    const ids: string[] = [];
    for (let i = 0; i < REFLECT_TUNABLES.STALE_OPEN + 3; i += 1) ids.push(mem(c, `Open question number ${String(i)} about the build.`, { meta: { unresolved: true } }));
    for (let i = 0; i < REFLECT_TUNABLES.STALE_OPEN_DAYS; i += 1) nextDay(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const offered = begun.bundle.staleOpen.map((x) => x.id);
    expect(offered.length).toBe(REFLECT_TUNABLES.STALE_OPEN);
    const notOffered = ids.filter((x) => !offered.includes(x));
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "A look back.",
      closeNow: [...offered.slice(0, 3), ...notOffered].map((x) => ({ id: x, why: "Done." })),
      close: offered.slice(3),
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.close.closed.length + done.outcome.close.proposed.length).toBe(REFLECT_TUNABLES.STALE_OPEN);
    expect(done.outcome.close.refused.map((r) => r.reason)).toEqual(notOffered.map(() => "not-offered"));
    for (const x of notOffered) expect(openFlag(c, x)).toBe(true);
    expect(c.store.reflection(begun.bundle.reflection)?.share ?? "").toContain("I closed three open threads");
  });

  test("a share already told takes no self-close: the thread stays open", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.reflection;
    c.reflections.finish({ reflection: id, session: SESSION, entry: "A look back.", close: [w.staleToo] });
    expect(c.reflections.told({ reflection: id, session: "s-next" }).ok).toBe(true);
    const again = c.reflections.finish({ reflection: id, session: SESSION, closeNow: [{ id: w.stale, why: "Signed." }] });
    if (!again.ok) throw new Error(again.reason);
    expect(again.outcome.close.refused).toEqual([{ id: w.stale, reason: "share-already-told" }]);
    expect(openFlag(c, w.stale)).toBe(true);
  });

  test("reopen puts a self-closed thread back; after it, the reflection may only ask about it", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.reflection;
    c.reflections.finish({ reflection: id, session: SESSION, entry: "A look back.", closeNow: [{ id: w.stale, why: "Signed." }], close: [w.staleToo] });
    expect(openFlag(c, w.stale)).toBe(false);

    // Only what this reflection closed itself.
    const out = c.reflections.reopen({ reflection: id, session: "s-next", ids: [w.stale, w.staleToo] });
    if (!out.ok) throw new Error(out.reason);
    expect(out.reopened).toEqual([w.stale]);
    expect(out.refused).toEqual([{ id: w.staleToo, reason: "not-closed-by-this-reflection" }]);
    expect(openFlag(c, w.stale)).toBe(true);
    expect(c.store.openThreadIds()).toContain(w.stale);
    expect(c.store.readProse(w.stale).meta["threadReopenedBy"]).toBe(id);
    expect(JSON.parse(c.store.reflection(id)?.detail ?? "{}")["reopened"]).toEqual([w.stale]);
    const twice = c.reflections.reopen({ reflection: id, session: "s-next", ids: [w.stale] });
    if (!twice.ok) throw new Error(twice.reason);
    expect(twice.already).toEqual([w.stale]);

    // A reflection that closed nothing itself has nothing to reopen.
    nextDay(c);
    const next = c.reflections.begin({ session: "s-night-2" });
    if (!next.ok) throw new Error(next.reason);
    expect(c.reflections.reopen({ reflection: next.bundle.reflection, session: "s-next", ids: [w.stale] })).toEqual({ ok: false, reason: "nothing-closed" });
    // The next night shows it as reopened: closing it again is refused, asking is not.
    const shown = next.bundle.staleOpen.find((x) => x.id === w.stale);
    expect(shown?.reopened).toBe(true);
    expect(next.instructions).toContain("ask, never close");
    const done = c.reflections.finish({ reflection: next.bundle.reflection, session: "s-night-2", entry: "Again.", closeNow: [{ id: w.stale, why: "Signed." }] });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.close.closed).toEqual([]);
    expect(done.outcome.close.proposed).toEqual([w.stale]);
    expect(done.outcome.close.notes ?? []).toEqual([`${w.stale}: asked instead of closed (reopened-by-owner).`]);
    expect(openFlag(c, w.stale)).toBe(true);
    expect(c.store.reflection(next.bundle.reflection)?.share ?? "").toContain("Shall I close it?");
  });

  // Mike, 2026-10-20 09:38: "i think its ok for nightly run to close threads
  // from other folders" — for the reflection's self-close and its undo only.
  test("from a session that is not the owner's, as the nightly run is, a stale thread from another folder self-closes, and reopen reaches it", () => {
    let c = brain();
    nextDay(c);
    const there = mem(c, "Open: is the other project's deploy done?", { meta: { unresolved: true }, origin: { scope: "/a" } });
    const here = mem(c, "Open: is this project's deploy done?", { meta: { unresolved: true }, origin: { scope: "/b" } });
    for (let i = 0; i < REFLECT_TUNABLES.STALE_OPEN_DAYS + 1; i += 1) nextDay(c);
    c.close();
    open.splice(0);
    c = Counterpart.open({ dir, identity: { name: "Mike" }, now: () => BASE + dateN * 86_400_000 });
    open.push(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.reflection;
    const done = c.reflections.finish({
      reflection: id,
      session: SESSION,
      entry: "A look back.",
      closeNow: [
        { id: there, why: "Deployed." },
        { id: here, why: "Deployed too." },
      ],
      scope: "/b",
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.close.closed.map((x) => x.id)).toEqual([there, here]);
    expect(done.outcome.close.proposed).toEqual([]);
    expect(done.outcome.close.refused).toEqual([]);
    expect(openFlag(c, there)).toBe(false);
    expect(openFlag(c, here)).toBe(false);
    const back = c.reflections.reopen({ reflection: id, session: "s-guest", ids: [there], scope: "/b" });
    if (!back.ok) throw new Error(back.reason);
    expect(back.reopened).toEqual([there]);
    expect(openFlag(c, there)).toBe(true);
  });

  test("a thread carrying the retired confidential mark is self-closed like any other, from a session not the owner's too (2026-10-21)", () => {
    const c = Counterpart.open({ dir, identity: { name: "Mike" }, now: () => BASE + dateN * 86_400_000 });
    open.push(c);
    nextDay(c);
    const secret = mem(c, "Open: did the private terms with the supplier renew?", { meta: { unresolved: true, confidential: true } });
    for (let i = 0; i < REFLECT_TUNABLES.STALE_OPEN_DAYS + 1; i += 1) nextDay(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    expect(begun.bundle.staleOpen.map((x) => x.id)).toContain(secret);
    const id = begun.bundle.reflection;
    const done = c.reflections.finish({ reflection: id, session: SESSION, entry: "A look back.", closeNow: [{ id: secret, why: "Renewed." }] });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.close.closed.map((x) => x.id)).toEqual([secret]);
    expect(done.outcome.close.proposed).toEqual([]);
    expect(openFlag(c, secret)).toBe(false);
  });

  test("a night write-up closes a thread opened in another folder (the 10-02 rule went with the yours/guest split, 2026-10-21)", async () => {
    let c = brain();
    nextDay(c);
    const there = mem(c, "Open: is the other project's deploy done?", { meta: { unresolved: true }, origin: { scope: "/a" } });
    c.close();
    open.splice(0);
    c = Counterpart.open({ dir, identity: { name: "Mike" }, now: () => BASE + dateN * 86_400_000 });
    open.push(c);
    const out = await c.submitJot({ content: "The other project's deploy went out on Tuesday.", updates: there, unresolved: false }, { session: "s-night", scope: "/b" });
    expect(out.thread).toEqual({ from: there, closed: true });
    expect(openFlag(c, there)).toBe(false);
  });
});

/**
 * The awkward states (review of #535): an id in both lists, and the order of
 * writes — the row that says a self-close lands before the flag flips.
 */
describe("self-closes, the awkward states", () => {
  test("an id sent in both close and closeNow is asked, not closed", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const done = c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, entry: "A look back.", closeNow: [{ id: w.stale, why: "Signed." }], close: [w.stale] });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.close.closed).toEqual([]);
    expect(done.outcome.close.proposed).toEqual([w.stale]);
    expect(done.outcome.close.notes ?? []).toEqual([`${w.stale}: sent in both close and closeNow, so asked, not closed.`]);
    expect(openFlag(c, w.stale)).toBe(true);
  });

  test("when the row's write throws (a locked database), nothing closed: the thread stays open and a retry closes and says it", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.reflection;
    const store = c.store as unknown as { updateReflection: (rid: string, patch: Record<string, unknown>) => boolean };
    const real = store.updateReflection.bind(c.store);
    store.updateReflection = (rid, patch) => {
      if (patch["state"] === "reflected") throw new Error("database is locked");
      return real(rid, patch);
    };
    expect(() => c.reflections.finish({ reflection: id, session: SESSION, entry: "A look back.", closeNow: [{ id: w.stale, why: "Signed." }] })).toThrow("database is locked");
    store.updateReflection = real;
    expect(openFlag(c, w.stale)).toBe(true);
    expect(c.store.reflection(id)?.share ?? null).toBeNull();
    const retry = c.reflections.finish({ reflection: id, session: SESSION, entry: "A look back.", closeNow: [{ id: w.stale, why: "Signed." }] });
    if (!retry.ok) throw new Error(retry.reason);
    expect(retry.outcome.close.closed.map((x) => x.id)).toEqual([w.stale]);
    expect(openFlag(c, w.stale)).toBe(false);
    expect(c.store.reflection(id)?.share ?? "").toContain(w.stale);
  });

  test("one whose flag fails to flip is not said: the share, the row and the counts leave it out", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.reflection;
    const store = c.store as unknown as { revise: (mid: string, patch: Record<string, unknown>) => number };
    const real = store.revise.bind(c.store);
    store.revise = (mid, patch) => {
      if (mid === w.staleToo) throw new Error("database is locked");
      return real(mid, patch);
    };
    const done = c.reflections.finish({
      reflection: id,
      session: SESSION,
      entry: "A look back.",
      closeNow: [
        { id: w.stale, why: "Signed." },
        { id: w.staleToo, why: "Moved." },
      ],
    });
    store.revise = real;
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.close.closed.map((x) => x.id)).toEqual([w.stale]);
    expect(done.outcome.close.refused).toEqual([{ id: w.staleToo, reason: "failed: database is locked" }]);
    expect(openFlag(c, w.stale)).toBe(false);
    expect(openFlag(c, w.staleToo)).toBe(true);
    const row = c.store.reflection(id);
    const share = row?.share ?? "";
    expect(share).toContain("I closed one open thread");
    expect(share).not.toContain(w.staleToo);
    const detail = JSON.parse(row?.detail ?? "{}");
    expect(detail["selfClosed"].map((x: { id: string }) => x.id)).toEqual([w.stale]);
    expect(detail["counts"]["selfClosed"]).toBe(1);
    expect(done.outcome.handBack).not.toContain(w.staleToo);
  });

  test("when the only thing the share said failed to close, there is no share", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.reflection;
    const store = c.store as unknown as { revise: (mid: string, patch: Record<string, unknown>) => number };
    const real = store.revise.bind(c.store);
    store.revise = () => {
      throw new Error("database is locked");
    };
    const done = c.reflections.finish({ reflection: id, session: SESSION, entry: "A look back.", closeNow: [{ id: w.stale, why: "Signed." }] });
    store.revise = real;
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.share.offered).toBe(false);
    expect(openFlag(c, w.stale)).toBe(true);
    const row = c.store.reflection(id);
    expect(row?.share ?? null).toBeNull();
    expect(row?.share_state).toBe("none");
    expect(JSON.parse(row?.detail ?? "{}")["selfClosed"]).toBeUndefined();
  });
});

describe("the reflect tool's closeNow and reopen", () => {
  test("finish closes through the tool; reopen on the owner's word puts it back", async () => {
    const c = brain();
    const w = world(c);
    c.close();
    open.splice(0);
    recordSession(dir, { sessionId: SESSION, scope: "/proj", phase: "start" });
    const s = openServer({ dir, session: SESSION, scope: "/proj", now: () => BASE + dateN * 86_400_000 });
    try {
      const begin = await s.call("reflect", { phase: "begin", session: SESSION });
      expect(begin.isError ?? false).toBe(false);
      const id = begin.structuredContent["reflection"] as string;
      const finish = await s.call("reflect", {
        phase: "finish",
        session: SESSION,
        reflection: id,
        entry: "A look back.",
        closeNow: [{ id: w.stale, why: "Signed on the 12th." }],
      });
      expect(finish.isError ?? false).toBe(false);
      expect((finish.structuredContent["close"] as { closed: { id: string }[] }).closed.map((x) => x.id)).toEqual([s.counterpart.reflections.aliasesOf(id)?.short(w.stale) ?? w.stale]);
      expect(s.counterpart.store.readProse(w.stale).meta["unresolved"]).toBe(false);
      expect(finish.structuredContent["handBack"] as string).toContain('phase "reopen"');

      const none = await s.call("reflect", { phase: "reopen", session: SESSION, reflection: id });
      expect(none.isError).toBe(true);

      const back = await s.call("reflect", { phase: "reopen", session: SESSION, reflection: id, reopen: [w.stale] });
      expect(back.isError ?? false).toBe(false);
      expect(back.structuredContent["reopened"]).toEqual([w.stale]);
      expect(s.counterpart.store.readProse(w.stale).meta["unresolved"]).toBe(true);
    } finally {
      s.counterpart.close();
    }
  });

  test("reopen through the tool takes the thread's id alone", async () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, entry: "A look back.", closeNow: [{ id: w.stale, why: "Signed." }] });
    c.close();
    open.splice(0);
    recordSession(dir, { sessionId: "s-later", scope: "/proj", phase: "start" });
    const s = openServer({ dir, session: "s-later", scope: "/proj", now: () => BASE + dateN * 86_400_000 });
    try {
      const none = await s.call("reflect", { phase: "reopen", session: "s-later" });
      expect(none.isError).toBe(true);
      const back = await s.call("reflect", { phase: "reopen", session: "s-later", reopen: [w.stale] });
      expect(back.isError ?? false).toBe(false);
      expect(back.structuredContent["reopened"]).toEqual([w.stale]);
      expect(s.counterpart.store.readProse(w.stale).meta["unresolved"]).toBe(true);
    } finally {
      s.counterpart.close();
    }
  });
});

/**
 * THE WAY BACK FROM THE THREAD'S ID ALONE (review of #535): the share is told
 * in the morning, and "that one wasn't done" may come in a later session that
 * never saw the reflection's id. The memory names the reflection that closed it.
 */
describe("reopen from the thread's id alone", () => {
  test("a later session reopens a self-closed thread with no reflection id; the hand-back says the id is enough", () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const id = begun.bundle.reflection;
    const done = c.reflections.finish({ reflection: id, session: SESSION, entry: "A look back.", closeNow: [{ id: w.stale, why: "Signed." }] });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.handBack).toContain(`reopen: [that id]`);
    expect(done.outcome.handBack).not.toContain(`reflection: ${id}, reopen`);
    expect(done.outcome.handBack).toContain("the thread's id is enough");

    nextDay(c);
    nextDay(c);
    const out = c.reflections.reopen({ session: "s-much-later", ids: [w.stale] });
    if (!out.ok) throw new Error(out.reason);
    expect(out.reopened).toEqual([w.stale]);
    expect(openFlag(c, w.stale)).toBe(true);
    expect(c.store.readProse(w.stale).meta["threadReopenedBy"]).toBe(id);
    expect(JSON.parse(c.store.reflection(id)?.detail ?? "{}")["reopened"]).toEqual([w.stale]);
    const twice = c.reflections.reopen({ session: "s-much-later", ids: [w.stale] });
    if (!twice.ok) throw new Error(twice.reason);
    expect(twice.already).toEqual([w.stale]);
  });

  test("only a thread a reflection closed itself: one only asked about, or closed by a write-up, is refused", async () => {
    const c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, entry: "A look back.", close: [w.staleToo] });
    const closedByWriteUp = mem(c, "Open: does the glance need a second line?", { meta: { unresolved: true } });
    const jot = await c.submitJot({ content: "The glance got its second line.", updates: closedByWriteUp, unresolved: false }, { session: "s-next", scope: "" });
    expect(jot.thread).toEqual({ from: closedByWriteUp, closed: true });
    const out = c.reflections.reopen({ session: "s-next", ids: [w.staleToo, closedByWriteUp] });
    if (!out.ok) throw new Error(out.reason);
    expect(out.reopened).toEqual([]);
    expect(out.refused).toEqual([
      { id: w.staleToo, reason: "not-closed-by-a-reflection" },
      { id: closedByWriteUp, reason: "not-closed-by-a-reflection" },
    ]);
    expect(openFlag(c, closedByWriteUp)).toBe(false);
  });

  test("from a session that is not the owner's, a thread carrying the retired confidential mark is reopened like any other (2026-10-21)", () => {
    let c = brain();
    const w = world(c);
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    c.reflections.finish({ reflection: begun.bundle.reflection, session: SESSION, entry: "A look back.", closeNow: [{ id: w.stale, why: "Signed." }] });
    c.store.revise(w.stale, { meta: { confidential: true } });
    c.close();
    open.splice(0);
    c = Counterpart.open({ dir, identity: { name: "Mike" }, now: () => BASE + dateN * 86_400_000 });
    open.push(c);
    const out = c.reflections.reopen({ session: "s-guest", ids: [w.stale] });
    if (!out.ok) throw new Error(out.reason);
    expect(out.reopened).toEqual([w.stale]);
    expect(openFlag(c, w.stale)).toBe(true);
  });
});

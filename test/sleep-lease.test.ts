/**
 * ONE CYCLE AT A TIME, PER STORE (2026-10-21, `sleep/lease.ts`).
 *
 * A closing session's Stop and SessionEnd workers both run the cycle; on the
 * owner's store the two ran side by side, ~94 ms apart, and the births phase
 * gave 40 names two cards. The cycle now takes a lease first. The four cases
 * the root fix has to hold, each its own test: two at once make one cycle and
 * both flushes; a holder killed mid-cycle leaves a lease that expires and the
 * next cycle finishes the work; a WEDGED holder whose lease was reclaimed stops
 * at its next phase (the fence), so two never run at once; an observer never
 * takes it.
 *
 * Hermetic: every test makes a fresh temp data dir and removes only that path.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Store } from "../src/core/store/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import {
  CYCLE_LEASE_KEY,
  CycleKilled,
  CycleLeaseLost,
  PHASES,
  TUNABLES,
  markerKey,
  phaseReport,
  readLease,
  releaseLease,
  runCycle,
  takeLease,
} from "../src/core/sleep/index.js";
import type { FadeFn, BirthsFn } from "../src/core/sleep/index.js";
import { TUNABLES as REMEMBER } from "../src/core/remember/index.js";
import { TUNABLES as ADAPTER } from "../src/adapters/config.js";

const NOW = Date.parse("2026-03-02T12:00:00Z");
const NO_FADE: FadeFn = () => ({ examined: 0, faded: [], blocked: {}, anchored: 0, skippedForLimit: 0 });
const NO_BIRTHS: BirthsFn = () => ({ memories: 0, offered: 0, born: [], refused: {}, skippedForLimit: 0 });

let dir: string;
const opened: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-sleep-lease-"));
});

afterEach(() => {
  for (const s of opened.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed by the test */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function store(opts: { now?: () => number; observer?: boolean } = {}): Store {
  const s = Store.open({ dir, now: opts.now ?? (() => NOW), ...(opts.observer === true ? { observer: true } : {}) });
  opened.push(s);
  return s;
}

/** Another process's lease, written as its `takeLease` would have. */
function foreignLease(s: Store, at: number, until: number): void {
  s.setMeta(CYCLE_LEASE_KEY, JSON.stringify({ owner: "other-worker", pid: 4242, at, until }));
}

function cycle(s: Store, onStep?: Parameters<typeof runCycle>[0]["onStep"]): ReturnType<typeof runCycle> {
  return runCycle({
    store: s,
    date: "2026-03-02",
    render: () => ({ bytes: 64 }),
    fade: NO_FADE,
    births: NO_BIRTHS,
    ...(onStep === undefined ? {} : { onStep }),
  });
}

describe("the lease itself", () => {
  test("free is taken; held is refused at once with its holder; expired or unreadable is reclaimed", () => {
    const s = store();
    const a = takeLease(s, { owner: "a", now: 1_000 });
    expect(a.taken).toBe(true);
    const b = takeLease(s, { owner: "b", now: 2_000 });
    expect(b).toEqual({ taken: false, holder: { owner: "a", pid: null, at: 1_000, until: 1_000 + TUNABLES.CYCLE_LEASE_MS } });
    const late = takeLease(s, { owner: "b", now: 1_000 + TUNABLES.CYCLE_LEASE_MS + 1 });
    expect(late.taken && late.reclaimed?.owner).toBe("a");
    s.setMeta(CYCLE_LEASE_KEY, "{torn");
    const torn = takeLease(s, { owner: "c", now: 5_000 });
    expect(torn.taken && torn.torn).toBe(true);
  });

  test("only the owner gives it back: a reclaimer's row is never deleted", () => {
    const s = store();
    takeLease(s, { owner: "a", now: 0 });
    takeLease(s, { owner: "b", now: TUNABLES.CYCLE_LEASE_MS + 1 });
    expect(releaseLease(s, "a")).toBe(false);
    expect(readLease(s.getMeta(CYCLE_LEASE_KEY))?.owner).toBe("b");
    expect(releaseLease(s, "b")).toBe(true);
    expect(s.getMeta(CYCLE_LEASE_KEY)).toBeUndefined();
  });

  test("a worker's watchdog fires before its lease can be reclaimed", () => {
    // `adapters/spawn.ts` refuses a watchdog at or past `STALE_CLAIM_MS`; the
    // lease is not shorter, so that refusal also keeps the kill inside the lease.
    expect(TUNABLES.CYCLE_LEASE_MS).toBeGreaterThanOrEqual(REMEMBER.STALE_CLAIM_MS);
    expect(ADAPTER.WATCHDOG_MS).toBeLessThan(TUNABLES.CYCLE_LEASE_MS);
  });
});

describe("the cycle under the lease", () => {
  test("a cycle finds another holding the store and stands aside: no phase, no marker, no wait", () => {
    const s = store();
    foreignLease(s, NOW - 1_000, NOW + 60_000);
    const report = cycle(s);
    expect(report.held).toEqual({ owner: "other-worker", pid: 4242, since: NOW - 1_000, until: NOW + 60_000 });
    expect(report.order).toEqual([]);
    expect(report.phases).toEqual([]);
    for (const phase of PHASES) expect(s.getMeta(markerKey(phase))).toBeUndefined();
    expect(report.events.map((e) => e.name)).toEqual(["sleep.cycle.held"]);
    // The holder's row is untouched.
    expect(readLease(s.getMeta(CYCLE_LEASE_KEY))?.owner).toBe("other-worker");
  });

  test("a cycle that ran gives its lease back", () => {
    const s = store();
    const report = cycle(s);
    expect(report.held).toBeUndefined();
    expect(report.order).toEqual([...PHASES]);
    expect(s.getMeta(CYCLE_LEASE_KEY)).toBeUndefined();
  });

  test("a worker KILLED mid-cycle: its lease expires, and the next cycle finishes the work", async () => {
    // A real process death, so its `finally` never runs and the row stays.
    const child = join(dir, "killed-child.ts");
    const module = fileURLToPath(new URL("../src/core/sleep/index.ts", import.meta.url));
    const storeModule = fileURLToPath(new URL("../src/core/store/index.ts", import.meta.url));
    const storeDir = join(dir, "store");
    writeFileSync(
      child,
      [
        `import { runCycle } from ${JSON.stringify(module)};`,
        `import { Store } from ${JSON.stringify(storeModule)};`,
        `const s = Store.open({ dir: process.argv[2] as string, now: () => ${NOW} });`,
        `runCycle({`,
        `  store: s, date: "2026-03-02", render: () => ({ bytes: 64 }),`,
        `  fade: () => ({ examined: 0, faded: [], blocked: {}, anchored: 0, skippedForLimit: 0 }),`,
        `  births: () => ({ memories: 0, offered: 0, born: [], refused: {}, skippedForLimit: 0 }),`,
        `  onStep: (st) => { if (st.phase === "births" && st.stage === "start") process.exit(9); },`,
        `});`,
      ].join("\n"),
      "utf8",
    );
    mkdirSync(storeDir);
    Store.open({ dir: storeDir, now: () => NOW }).close();
    const kid = Bun.spawn([process.execPath, child, storeDir], { stdout: "pipe", stderr: "pipe" });
    expect(await kid.exited).toBe(9);

    const inside = Store.open({ dir: storeDir, now: () => NOW + 60_000 });
    opened.push(inside);
    // The dead worker's lease is still there, and the phases before births are done.
    expect(readLease(inside.getMeta(CYCLE_LEASE_KEY))?.owner).toBeDefined();
    expect(inside.getMeta(markerKey("fade"))).toBeDefined();
    expect(inside.getMeta(markerKey("births"))).toBeUndefined();
    const early = runCycle({ store: inside, date: "2026-03-02", render: () => ({ bytes: 64 }), fade: NO_FADE, births: NO_BIRTHS });
    expect(early.held).toBeDefined();
    inside.close();

    const later = Store.open({ dir: storeDir, now: () => NOW + TUNABLES.CYCLE_LEASE_MS + 1 });
    opened.push(later);
    const report = runCycle({ store: later, date: "2026-03-02", render: () => ({ bytes: 64 }), fade: NO_FADE, births: NO_BIRTHS });
    expect(report.held).toBeUndefined();
    expect(report.events.some((e) => e.name === "sleep.lease.reclaimed")).toBe(true);
    // The phases the dead worker finished are done; the one it died in runs now.
    expect(phaseReport(report, "fade").reason).not.toBe("completed");
    expect(phaseReport(report, "births").status).not.toBe("did-not-run");
    expect(later.getMeta(markerKey("births"))).toBeDefined();
    expect(later.getMeta(CYCLE_LEASE_KEY)).toBeUndefined();
  }, 60_000);

  test("a WEDGED worker whose lease was reclaimed stops at its next phase: never two cycles at once", () => {
    const s = store();
    let thrown: unknown = null;
    try {
      cycle(s, (st) => {
        // Stuck past its lease inside `prune`: another cycle reclaims the store.
        if (st.phase === "prune" && st.stage === "start") {
          const took = takeLease(s, { owner: "reclaimer", now: NOW + TUNABLES.CYCLE_LEASE_MS + 1 });
          expect(took.taken).toBe(true);
        }
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CycleLeaseLost);
    expect(thrown).toBeInstanceOf(CycleKilled);
    // It finished the phase it was in, and went no further.
    expect((thrown as CycleLeaseLost).phase).toBe("fade");
    expect(s.getMeta(markerKey("prune"))).toBeDefined();
    expect(s.getMeta(markerKey("fade"))).toBeUndefined();
    // And it did not take the reclaimer's lease away on its way out.
    expect(readLease(s.getMeta(CYCLE_LEASE_KEY))?.owner).toBe("reclaimer");
  });

  test("an observer never takes the lease, and is not stopped by one", () => {
    store().close();
    opened.length = 0;
    const watcher = store({ observer: true });
    const report = cycle(watcher);
    expect(report.held).toBeUndefined();
    expect(report.order).toEqual([...PHASES]);
    expect(watcher.getMeta(CYCLE_LEASE_KEY)).toBeUndefined();
    watcher.close();
    opened.length = 0;

    const writer = store();
    foreignLease(writer, NOW, NOW + 60_000);
    writer.close();
    opened.length = 0;
    const again = cycle(store({ observer: true }));
    expect(again.held).toBeUndefined();
    expect(again.order).toEqual([...PHASES]);
  });
});

describe("through the boundary: the flush runs, the cycle stands aside", () => {
  function brain(): Counterpart {
    const c = Counterpart.open({ dir: join(dir, "store"), now: () => NOW });
    opened.push(c);
    return c;
  }

  test("a boundary that finds the store held does its flush and leaves one row saying so", async () => {
    const c = brain();
    const a = c.store.put({ type: "memory", kind: "fact", body: "The harbour ferry leaves at seven on weekdays.", physics: { birthDay: 0, lastUsedDay: 0 } });
    const b = c.store.put({ type: "memory", kind: "fact", body: "The bakery by the pier opens before the first ferry.", physics: { birthDay: 0, lastUsedDay: 0 } });
    c.store.advanceClock("2026-03-01");
    c.recallForTurn({ sessionId: "s1", text: "the harbour ferry and the bakery by the pier" });
    c.resolveUses("s1", [
      { memoryId: a, tier: "referenced" },
      { memoryId: b, tier: "referenced" },
    ]);
    expect(c.associate.pendingDeltas().length).toBeGreaterThan(0);
    foreignLease(c.store, NOW - 50, NOW + 60_000);

    const report = await c.sessionEnd({ date: "2026-03-02" });
    // The flush is this boundary's own, held or not.
    expect(c.associate.pendingDeltas()).toEqual([]);
    expect(c.associate.linked(a, b)).toBe(true);
    // The cycle is not.
    expect(report.cycle.held?.pid).toBe(4242);
    expect(c.store.eventLog({ name: "sleep.cycle" })).toEqual([]);
    expect(c.store.eventLog({ name: "self.briefing" })).toEqual([]);
    const held = c.store.eventLog({ name: "sleep.cycle.held" });
    expect(held).toHaveLength(1);
    expect(JSON.parse(held[0]?.payload ?? "{}")).toMatchObject({ reason: "held-elsewhere", date: "2026-03-02", holderPid: 4242, heldMs: 50 });
  });

  test("two worker PROCESSES released together: births run once, and each boundary is a cycle or a stand-aside", async () => {
    // Real children: the property is the lease between connections. Whether
    // the second arrives while the first holds it is the scheduler's call, so
    // what is asserted is what holds either way.
    const storeDir = join(dir, "store");
    const seed = Counterpart.open({ dir: storeDir, now: () => NOW });
    for (const [body, day] of [
      ["Dinner at the harbour with Wren, who wants to try the new ferry route.", 1],
      ["Wren is a nurse on night shifts this month, so mornings are quiet.", 2],
      ["Booked the ferry for the two of us; Wren picked the window seats.", 3],
    ] as const) {
      seed.store.put({ type: "memory", kind: "fact", body, physics: { birthDay: day, lastUsedDay: day } });
    }
    seed.close();
    const gate = join(dir, "gate");
    mkdirSync(gate);
    const child = join(dir, "boundary-child.ts");
    const module = fileURLToPath(new URL("../src/core/counterpart.ts", import.meta.url));
    writeFileSync(
      child,
      [
        `import { existsSync, writeFileSync } from "node:fs";`,
        `import { join } from "node:path";`,
        `import { Counterpart } from ${JSON.stringify(module)};`,
        `const [store, gate, tag] = process.argv.slice(2) as [string, string, string];`,
        `const c = Counterpart.open({ dir: store });`,
        `writeFileSync(join(gate, "ready-" + tag), "");`,
        `while (!existsSync(join(gate, "go"))) Bun.sleepSync(2);`,
        `const r = await c.sessionEnd({ date: "2026-03-02" });`,
        `c.close();`,
        `console.log(JSON.stringify({ held: r.cycle.held !== undefined, flushed: typeof r.edges.reason === "string" }));`,
      ].join("\n"),
      "utf8",
    );
    const tags = ["stop", "session-end"];
    const kids = tags.map((tag) => Bun.spawn([process.execPath, child, storeDir, gate, tag], { stdout: "pipe", stderr: "pipe" }));
    const ready = (): boolean => tags.every((tag) => existsSync(join(gate, `ready-${tag}`)));
    for (let waited = 0; !ready() && waited < 30_000; waited += 10) await Bun.sleep(10);
    expect(ready()).toBe(true);
    writeFileSync(join(gate, "go"), "");
    expect(await Promise.all(kids.map((k) => k.exited))).toEqual([0, 0]);
    const outs = (await Promise.all(kids.map((k) => new Response(k.stdout).text()))).map(
      (o) => JSON.parse(o.trim()) as { held: boolean; flushed: boolean },
    );
    expect(outs.every((o) => o.flushed)).toBe(true);

    const after = Store.open({ dir: storeDir, now: () => NOW });
    opened.push(after);
    const cycles = after.eventLog({ name: "sleep.cycle" });
    const held = after.eventLog({ name: "sleep.cycle.held" });
    expect(cycles.length + held.length).toBe(2);
    expect(held.length).toBe(outs.filter((o) => o.held).length);
    // Whatever the interleave, the births phase ran in exactly one of them.
    const birthsRan = cycles.filter((row) =>
      (JSON.parse(row.payload ?? "{}") as { phases: { phase: string; status: string }[] }).phases.some(
        (p) => p.phase === "births" && (p.status === "ran" || p.status === "ran-nothing-found"),
      ),
    );
    expect(birthsRan).toHaveLength(1);
    expect(after.getMeta(CYCLE_LEASE_KEY)).toBeUndefined();
  }, 60_000);
});

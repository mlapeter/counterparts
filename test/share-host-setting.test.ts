/**
 * THE HOST'S MORNING-SHARE SETTING (2026-11-13, an experiment, lightly held;
 * `CounterpartOptions.shares` / `sharesPerWeek`, `core/dream/reflect.ts#shareHeld`).
 * A host may turn the nightly morning share off, or cap it at so many told a
 * week (the last 7 lived days). Held, the reflection still writes its entry;
 * the share is simply not offered, with the reason on the outcome and the row.
 * Default: on, no cap — today's behavior.
 *
 * The night cases go through the reflect tool on a night child's server, as
 * the dream's reflection calls it. Hermetic: a temp dir made and removed here;
 * every word invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, shareOptions } from "../src/adapters/config.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import type { CounterpartOptions } from "../src/core/counterpart-types.js";
import { REFLECT_TUNABLES } from "../src/core/dream/reflect.js";
import type { PutInput } from "../src/core/store/index.js";
import { addDays } from "../src/core/time.js";

const HOUR = 3_600_000;
const START = "2026-10-01";
const at = (ymd: string, h: number): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR;
const SESSION = "c4c4c4c4-0000-4000-8000-0000000000aa";
const NEXT = "c4c4c4c4-0000-4000-8000-0000000000bb";

let root: string;
let storeDir: string;
let clock = at(START, 7);
let dayN = 0;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-share-host-")));
  storeDir = join(root, "store");
  clock = at(START, 7);
  dayN = 0;
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

function brain(opts: Pick<CounterpartOptions, "shares" | "sharesPerWeek"> = {}, dir = storeDir): Counterpart {
  const c = Counterpart.open({ dir, snapshotsDir: join(root, "snaps"), now: () => clock, timeZone: "UTC", identity: { name: "Wren" }, ...opts });
  open.push(c);
  return c;
}

/** The next calendar day, on the test clock and the lived clock. */
function nextDay(c: Counterpart): string {
  dayN += 1;
  const ymd = addDays(START, dayN);
  clock = at(ymd, 7);
  c.store.advanceClock(ymd);
  return ymd;
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({ type: "memory", kind: "fact", body, about: "work", salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, ...over });
}

/** The night's reflection child's server, as the dream run starts it. */
function nightDoor(c: Counterpart): McpServer {
  return new McpServer({
    counterpart: c,
    session: SESSION,
    scope: join(root, "garden"),
    registryDir: join(root, "registry"),
    now: () => clock,
    env: { COUNTERPARTS_NIGHT_CHILD: "reflection", COUNTERPARTS_NIGHT_RUN: "1" },
    scopesFile: join(root, "scopes.json"),
  });
}

/** One night's reflection through the tool: a memory from today, begun, finished with a share citing it. */
async function night(c: Counterpart, s: McpServer, more: Record<string, unknown> = {}): Promise<{ id: string; out: Record<string, unknown> }> {
  const m = mem(c, `The broad beans went in by the fence on day ${String(dayN)}.`);
  clock += 20 * HOUR;
  const begun = (await s.call("reflect", { phase: "begin", session: SESSION })).structuredContent;
  const id = String(begun["reflection"]);
  const out = (
    await s.call("reflect", {
      phase: "finish",
      session: SESSION,
      reflection: id,
      entry: "A short look back at the week in the garden.",
      cites: [m],
      share: { text: "I keep thinking about the beans by the fence.", cites: [m] },
      ...more,
    })
  ).structuredContent;
  return { id, out };
}

const share = (out: Record<string, unknown>): Record<string, unknown> => (out["share"] ?? {}) as Record<string, unknown>;
const detail = (c: Counterpart, id: string): Record<string, unknown> => JSON.parse(c.store.reflection(id)?.detail ?? "{}") as Record<string, unknown>;

describe("the host's morning-share setting, through the night's reflect tool", () => {
  test("default: on, no cap — the share is offered, as today", async () => {
    const c = brain();
    const s = nightDoor(c);
    nextDay(c);
    const { id, out } = await night(c, s);
    expect(share(out)).toMatchObject({ offered: true, reason: "offered" });
    expect(c.store.reflection(id)?.share_state).toBe("offered");
    expect(detail(c, id)["shareHeld"]).toBeUndefined();
    expect(String(out["handBack"])).toContain("Morning share for Wren");
    expect(c.reflections.pendingShare({ session: NEXT })?.id).toBe(id);
  });

  test("off: the entry is written, the share is not offered (host-off), no retry, and the wake has nothing to tell", async () => {
    const c = brain({ shares: "off" });
    const s = nightDoor(c);
    nextDay(c);
    const { id, out } = await night(c, s);
    expect(share(out)).toMatchObject({ offered: false, reason: "host-off" });
    expect(String(share(out)["detail"])).toContain("morning share off");
    expect(out["retry"] ?? null).toBeNull();
    const row = c.store.reflection(id);
    expect(row?.state).toBe("reflected");
    expect(row?.entry_id).not.toBeNull();
    expect(row?.share).toBeNull();
    expect(row?.share_state).toBe("none");
    expect(detail(c, id)["shareHeld"]).toBe("host-off");
    expect((detail(c, id)["counts"] as Record<string, unknown>)["share"]).toBe(false);
    // What the wake and the hosted road read: nothing pending, the hand-back says so, last night says none.
    expect(String(out["handBack"])).toContain("nothing to share this morning");
    expect(String(out["handBack"])).not.toContain("Morning share for");
    expect(c.reflections.pendingShare({ session: NEXT })).toBeNull();
    expect(c.reflections.carryLine({ session: NEXT, reflection: id })).toBeNull();
    const last = (await nightDoor(c).call("recall", { handle: "last night" })).structuredContent;
    const r = (last["reflection"] ?? {}) as Record<string, unknown>;
    expect(r["shareState"]).toBe("none");
    expect(r["share"]).toBeNull();
  });

  test("a weekly cap: every share offered by the last 7 lived days' nights counts, told or not yet; the window's last day holds, the next offers", async () => {
    const c = brain({ sharesPerWeek: 1 });
    const s = nightDoor(c);
    const dayOf = (id: string): number => c.store.reflection(id)?.day ?? -1;
    // Night 1: offered and not told yet. It stays deliverable, so it counts.
    nextDay(c);
    const one = await night(c, s);
    expect(share(one.out)).toMatchObject({ offered: true });
    expect(c.store.reflection(one.id)?.share_state).toBe("offered");
    // Night 2: the cap is one — held.
    nextDay(c);
    const two = await night(c, s);
    expect(dayOf(two.id)).toBe(dayOf(one.id) + 1);
    expect(share(two.out)).toMatchObject({ offered: false, reason: "weekly-cap" });
    expect(String(share(two.out)["detail"])).toContain("1 morning share a week and 1 was offered");
    expect(two.out["retry"] ?? null).toBeNull();
    expect(c.store.reflection(two.id)?.share_state).toBe("none");
    expect(c.store.reflection(two.id)?.entry_id).not.toBeNull();
    expect(detail(c, two.id)["shareHeld"]).toBe("weekly-cap");
    // Told, it still counts once (by the night that wrote it), and a held night counts nothing.
    expect(c.reflections.carryLine({ session: NEXT, reflection: one.id })).not.toBeNull();
    expect(c.store.reflection(one.id)?.share_state).toBe("told");
    // The window's last lived day (night 1's day + 6) still holds...
    let last = two;
    while (dayOf(last.id) < dayOf(one.id) + REFLECT_TUNABLES.SHARE_WEEK_DAYS - 1) {
      nextDay(c);
      last = await night(c, s);
      expect(share(last.out)).toMatchObject({ offered: false, reason: "weekly-cap" });
    }
    expect(dayOf(last.id)).toBe(dayOf(one.id) + REFLECT_TUNABLES.SHARE_WEEK_DAYS - 1);
    // ...and the next day is past it: offered again.
    nextDay(c);
    const after = await night(c, s);
    expect(dayOf(after.id)).toBe(dayOf(one.id) + REFLECT_TUNABLES.SHARE_WEEK_DAYS);
    expect(share(after.out)).toMatchObject({ offered: true });
  });

  test("off, with no share words at all: a line that would have made one (a re-label into me) is not offered either", async () => {
    const relabelNight = async (c: Counterpart): Promise<{ id: string; out: Record<string, unknown> }> => {
      const s = nightDoor(c);
      c.store.advanceClock(addDays(START, 1));
      const m = mem(c, "I like keeping the seed packets in date order.");
      clock = at(addDays(START, 2), 3);
      const begun = (await s.call("reflect", { phase: "begin", session: SESSION })).structuredContent;
      const id = String(begun["reflection"]);
      const out = (await s.call("reflect", { phase: "finish", session: SESSION, reflection: id, entry: "A look back.", cites: [m], about: [{ id: m, about: "me", why: "it is how I keep things" }] })).structuredContent;
      return { id, out };
    };
    // Without the setting, that line is the share (so the case below is not vacuous).
    const plain = await relabelNight(brain({}, join(root, "plain")));
    expect(share(plain.out)).toMatchObject({ offered: true, reason: "relabeled" });
    clock = at(START, 7);
    const c = brain({ shares: "off" });
    const { id, out } = await relabelNight(c);
    expect(out["about"]).toEqual({ written: 1 });
    expect(share(out)).toMatchObject({ offered: false, reason: "host-off" });
    expect(c.store.reflection(id)?.share).toBeNull();
    expect(c.store.reflection(id)?.share_state).toBe("none");
    expect(detail(c, id)["shareHeld"]).toBe("host-off");
  });

  test("held, nothing that rides in a share happens: a self-close is listed as may be done, not closed", async () => {
    const c = brain({ shares: "off" });
    const s = nightDoor(c);
    nextDay(c);
    const stale = mem(c, "Open: does the tarball in the backups folder need signing?", { meta: { unresolved: true } });
    for (let i = 0; i < REFLECT_TUNABLES.STALE_OPEN_DAYS + 1; i += 1) nextDay(c);
    const m = mem(c, "The tarball was signed on the 12th.");
    clock += 20 * HOUR;
    const begun = (await s.call("reflect", { phase: "begin", session: SESSION })).structuredContent;
    const id = String(begun["reflection"]);
    expect(String(begun["bundle"])).toContain("## staleOpen\n- m2 · untouched");
    const out = (
      await s.call("reflect", {
        phase: "finish",
        session: SESSION,
        reflection: id,
        entry: "A look back.",
        cites: [m],
        closeNow: [{ id: stale, why: "The tarball was signed on the 12th.", shows: m }],
      })
    ).structuredContent;
    const close = out["close"] as Record<string, unknown>;
    expect(close["closed"]).toEqual([]);
    expect(close["proposed"]).toEqual(["m2"]);
    expect(detail(c, id)["closeProposed"]).toEqual([stale]);
    expect(c.store.readProse(stale).meta["unresolved"]).toBe(true);
    expect(share(out)["offered"]).toBe(false);
    expect(out["retry"] ?? null).toBeNull();
    expect(c.store.reflection(id)?.share_state).toBe("none");
    expect(detail(c, id)["shareHeld"]).toBe("host-off");
  });
});

describe("where a host sets it", () => {
  test("the configuration file: read leniently, only what was set handed on", () => {
    expect(shareOptions(loadConfig({ shares: "off", sharesPerWeek: 2 }).config)).toEqual({ shares: "off", sharesPerWeek: 2 });
    expect(shareOptions(loadConfig({}).config)).toEqual({});
    const odd = loadConfig({ shares: "sometimes", sharesPerWeek: -1 });
    expect(odd.ok).toBe(true);
    expect(shareOptions(odd.config)).toEqual({});
  });
});

/**
 * THE HOST'S MORNING-SHARE SETTING (2026-11-13, an experiment, lightly held;
 * `CounterpartOptions.shares` / `sharesPerWeek`, `core/dream/reflect.ts#shareHeld`).
 * A host may turn the nightly morning share off, or cap it at so many offered a
 * week (the reflections dated in the last 7 calendar days; every offered share
 * counts, told or not yet; 0 is off). Held, the reflection still writes its
 * entry; the share is simply not offered, with the reason on the outcome and
 * the row, and nothing that would change the self unsaid is applied (a
 * re-label into me, a core retire: deferred). Off, a share offered before is
 * not delivered. Default: on, no cap — today's behavior.
 *
 * The night cases go through the reflect tool on a night child's server, as
 * the dream's reflection calls it. Hermetic: a temp dir made and removed here;
 * every word invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { loadConfig, shareOptions } from "../src/adapters/config.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import type { CounterpartOptions } from "../src/core/counterpart-types.js";
import { REFLECT_TUNABLES } from "../src/core/dream/reflect.js";
import { Store } from "../src/core/store/index.js";
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

  test("a weekly cap: every share offered by the nights dated in the last 7 calendar days counts, told or not yet; the window's last day holds, the next offers", async () => {
    const c = brain({ sharesPerWeek: 1 });
    const s = nightDoor(c);
    const dateOf = (id: string): string => c.store.reflection(id)?.date ?? "";
    // Night 1: offered and not told yet. It stays deliverable, so it counts.
    nextDay(c);
    const one = await night(c, s);
    expect(share(one.out)).toMatchObject({ offered: true });
    expect(c.store.reflection(one.id)?.share_state).toBe("offered");
    // Night 2: the cap is one — held.
    nextDay(c);
    const two = await night(c, s);
    expect(dateOf(two.id)).toBe(addDays(dateOf(one.id), 1));
    expect(share(two.out)).toMatchObject({ offered: false, reason: "weekly-cap" });
    expect(String(share(two.out)["detail"])).toContain("1 morning share a week and 1 was offered");
    expect(two.out["retry"] ?? null).toBeNull();
    expect(c.store.reflection(two.id)?.share_state).toBe("none");
    expect(c.store.reflection(two.id)?.entry_id).not.toBeNull();
    expect(detail(c, two.id)["shareHeld"]).toBe("weekly-cap");
    // Told, it still counts once (by the night that wrote it); a held night counts nothing.
    expect(c.reflections.carryLine({ session: NEXT, reflection: one.id })).not.toBeNull();
    expect(c.store.reflection(one.id)?.share_state).toBe("told");
    // The window's last calendar day (night 1's date + 6) still holds...
    let last = two;
    while (dateOf(last.id) < addDays(dateOf(one.id), REFLECT_TUNABLES.SHARE_WEEK_DAYS - 1)) {
      nextDay(c);
      last = await night(c, s);
      expect(share(last.out)).toMatchObject({ offered: false, reason: "weekly-cap" });
    }
    expect(dateOf(last.id)).toBe(addDays(dateOf(one.id), REFLECT_TUNABLES.SHARE_WEEK_DAYS - 1));
    // ...and the next day is past it: offered again.
    nextDay(c);
    const after = await night(c, s);
    expect(dateOf(after.id)).toBe(addDays(dateOf(one.id), REFLECT_TUNABLES.SHARE_WEEK_DAYS));
    expect(share(after.out)).toMatchObject({ offered: true });
  });

  test("the week is calendar days: away 30 days (one lived day later), the cap no longer holds", async () => {
    const c = brain({ sharesPerWeek: 1 });
    const s = nightDoor(c);
    nextDay(c);
    const one = await night(c, s);
    expect(share(one.out)).toMatchObject({ offered: true });
    const dayBefore = c.store.livedDay();
    dayN += 29;
    nextDay(c);
    expect(c.store.livedDay()).toBe(dayBefore + 1);
    const back = await night(c, s);
    expect(c.store.reflection(back.id)?.day).toBe((c.store.reflection(one.id)?.day ?? 0) + 1);
    expect(share(back.out)).toMatchObject({ offered: true });
  });

  test("sharesPerWeek 0 is off: host-off, not weekly-cap", async () => {
    const c = brain({ sharesPerWeek: 0 });
    const s = nightDoor(c);
    nextDay(c);
    const { out } = await night(c, s);
    expect(share(out)).toMatchObject({ offered: false, reason: "host-off" });
  });

  test("a share offered before the host turned shares off is not delivered after", async () => {
    const before = brain();
    const s = nightDoor(before);
    nextDay(before);
    const { id, out } = await night(before, s);
    expect(share(out)).toMatchObject({ offered: true });
    before.close();
    open.splice(open.indexOf(before), 1);
    const c = brain({ shares: "off" });
    expect(c.reflections.pendingShare({ session: NEXT })).toBeNull();
    expect(c.reflections.carryLine({ session: NEXT, reflection: id })).toBeNull();
    expect(c.store.reflection(id)?.share_state).toBe("offered");
    // A cap (not off) still lets an older offered share be delivered.
    c.close();
    open.splice(open.indexOf(c), 1);
    const capped = brain({ sharesPerWeek: 1 });
    expect(capped.reflections.pendingShare({ session: NEXT })?.id).toBe(id);
  });

  test("held, the self does not change unsaid: a core retire and a re-label into me are deferred, and a night that may share still can", async () => {
    const c = brain({ shares: "off" });
    const s = nightDoor(c);
    nextDay(c);
    const coreId = mem(c, "I keep the seed tin by the back door.", { about: "me" });
    c.store.updatePhysics(coreId, { promotedIdentity: true });
    c.store.setBand(coreId, "identity", c.store.livedDay());
    c.store.appendCoreEvent({ memoryId: coreId, action: "promoted", day: c.store.livedDay(), lane: "fast", actor: "sleep" });
    const plain = mem(c, "I like keeping the seed packets in date order.");
    const heldNight = async (srv: McpServer): Promise<{ id: string; out: Record<string, unknown> }> => {
      clock += 20 * HOUR;
      const begun = (await srv.call("reflect", { phase: "begin", session: SESSION })).structuredContent;
      const id = String(begun["reflection"]);
      const out = (
        await srv.call("reflect", {
          phase: "finish",
          session: SESSION,
          reflection: id,
          entry: "A look back.",
          cites: [plain],
          about: [{ id: plain, about: "me", why: "it is how I keep things" }],
          core: [{ id: coreId, decision: "retire", why: "A habit, not who I am." }],
        })
      ).structuredContent;
      return { id, out };
    };
    const { id, out } = await heldNight(s);
    expect(out["retry"] ?? null).toBeNull();
    expect(c.store.physicsOf(coreId).promotedIdentity).toBe(true);
    expect(c.store.row(plain)?.about ?? null).not.toBe("me");
    expect(detail(c, id)["deferred"]).toEqual([
      { id: plain, part: "about", to: "me" },
      { id: coreId, part: "core", to: "retire" },
    ]);
    expect(detail(c, id)["shareHeld"]).toBe("host-off");
    expect(share(out)["offered"]).toBe(false);
    expect(c.store.reflection(id)?.share_state).toBe("none");
    // The next night, with shares on, acts on both, and says them.
    c.close();
    open.splice(open.indexOf(c), 1);
    const d = brain();
    nextDay(d);
    const later = await heldNight(nightDoor(d));
    expect(d.store.physicsOf(coreId).promotedIdentity).toBe(false);
    expect(d.store.row(plain)?.about).toBe("me");
    expect(share(later.out)).toMatchObject({ offered: true });
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

/** One JSON-RPC exchange after another with `mcp/bin/serve.ts` as a child over stdio (as `hold-local.test.ts` does). */
async function overStdio(env: Record<string, string>, calls: (call: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath, ["run", resolve(import.meta.dir, "../src/adapters/mcp/bin/serve.ts")], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise<void>((r) => child.on("exit", () => r()));
  const waiting = new Map<number, (m: Record<string, unknown>) => void>();
  let buf = "";
  let err = "";
  let next = 1;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d: string) => (err += d));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d: string) => {
    buf += d;
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim().length === 0) continue;
      const m = JSON.parse(line) as Record<string, unknown>;
      if (typeof m["id"] === "number") waiting.get(m["id"])?.(m);
    }
  });
  const rpc = (method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> =>
    new Promise((res, rej) => {
      const id = next++;
      const timer = setTimeout(() => rej(new Error(`no answer to ${method}: ${err.slice(-400)}`)), 30_000);
      waiting.set(id, (m) => {
        clearTimeout(timer);
        res(m);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
  try {
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.0.0" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    await calls(async (name, args) => {
      const m = await rpc("tools/call", { name, arguments: args });
      const result = m["result"] as Record<string, unknown> | undefined;
      if (result === undefined) throw new Error(`${name}: ${JSON.stringify(m)}`);
      return (result["structuredContent"] ?? {}) as Record<string, unknown>;
    });
  } finally {
    child.stdin.end();
    const killer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(killer);
  }
}

describe("the configuration file, through the night's own server", () => {
  test("\"shares\": \"off\" in the file the night's serve.ts reads: its reflection offers no share", async () => {
    const home = join(root, "home");
    mkdirSync(home, { recursive: true });
    const configPath = join(root, "claude-code.json");
    writeFileSync(configPath, JSON.stringify({ dataDir: storeDir, snapshots: { daily: false }, shares: "off" }), "utf8");
    const s = Store.open({ dir: storeDir });
    const m = s.put({ type: "memory", kind: "fact", body: "The cold frame lid sticks in the morning damp.", salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: s.livedDay(), lastUsedDay: s.livedDay() } });
    s.close();
    await overStdio(
      {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        HOME: home,
        COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
        COUNTERPARTS_UPDATE_CHECK: "off",
        COUNTERPARTS_DATA_DIR: storeDir,
        COUNTERPARTS_CONFIG: configPath,
        COUNTERPARTS_SESSION: SESSION,
        COUNTERPARTS_SCOPE: root,
        COUNTERPARTS_NIGHT_CHILD: "reflection",
        COUNTERPARTS_NIGHT_RUN: "nrn_share_host",
        CLAUDE_PROJECT_DIR: root,
      },
      async (call) => {
        const begun = await call("reflect", { phase: "begin", session: SESSION });
        const reflection = String(begun["reflection"]);
        const out = await call("reflect", { phase: "finish", session: SESSION, reflection, entry: "A short look back.", cites: [m], share: { text: "The lid keeps sticking.", cites: [m] } });
        expect(share(out)).toMatchObject({ offered: false, reason: "host-off" });
      },
    );
  }, 60_000);
});

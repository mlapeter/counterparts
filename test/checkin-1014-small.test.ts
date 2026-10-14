/**
 * The 2026-10-14 Group 1 check-in's small fixes (A–F), lightly held. Each
 * test that opens a store runs on a fresh temp dir it removes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer, toolSpec } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";
import { findable } from "./store-fixture.js";

const ENV = "COUNTERPARTS_DATA_DIR";
let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-checkin-1014-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
});

function server(): McpServer {
  const s = openServer({ dir, session: "sess_checkin", scope: "/scope/one", owner: true });
  findable(s.counterpart.store);
  open.push(s.counterpart);
  return s;
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent;
}

const fieldDescription = (tool: string, ...path: string[]): string => {
  let node = toolSpec(tool)?.inputSchema as Record<string, unknown> | undefined;
  for (const key of path) node = (node?.[key] as Record<string, unknown> | undefined) ?? undefined;
  return String(node?.["description"] ?? "");
};

// ── A. salience guidance ─────────────────────────────────────────────────────

describe("A. salience: routine work and ordinary work facts are left unset", () => {
  const item = ["properties", "memories", "items", "properties"];
  const cases: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["remember", ["properties", "salience"]],
    ["session_end", [...item, "salience"]],
  ];
  for (const [tool, path] of cases) {
    test(`${tool}: the salience field says to leave routine work unset, 0.4+ only for what struck you`, () => {
      const d = fieldDescription(tool, ...path);
      expect(d).toContain("Leave it UNSET for a routine work event");
      expect(d).toContain("ordinary work fact or step unless it changed something");
      expect(d).toContain("0.4 or more only for what struck you");
      expect(d).toContain("Their rulings, preferences and corrections stay high even about work");
      // No numeric anchor invites a claim for routine work any more.
      expect(d).not.toContain("About 0.2 a routine work event");
    });
  }
});

// ── E. recall: `query` is `question` ────────────────────────────────────────

describe("E. recall accepts `query` as another name for `question`", () => {
  test("the schema names it", () => {
    expect(fieldDescription("recall", "properties", "query")).toContain("question");
  });

  test("`query` with a mode is answered as a question; without a mode it still needs one", async () => {
    const s = server();
    const id = s.counterpart.store.put({ type: "memory", kind: "fact", body: "The zqharbour ferry runs twice a day in winter." });
    const got = payload(await s.call("recall", { query: "zqharbour ferry", mode: "facts" }));
    expect(got["reason"]).not.toBe("no-argument");
    expect(got["ids"] as string[]).toContain(id);
    const bare = payload(await s.call("recall", { query: "zqharbour ferry" }));
    expect(bare["reason"]).toBe("mode-required");
  });

  test("`question` wins when both are sent", async () => {
    const s = server();
    const id = s.counterpart.store.put({ type: "memory", kind: "fact", body: "The zqharbour ferry runs twice a day in winter." });
    const got = payload(await s.call("recall", { question: "zqharbour ferry", query: "nothing like it", mode: "facts" }));
    expect(got["ids"] as string[]).toContain(id);
  });
});

// ── C. closing a reminder closes its chain, and lists dated neighbours ───────

describe("C. a close clears the whole reminder chain and lists other dated memories nearby", () => {
  const TAX = "Pay the zqtax estimated payment to the county before the deadline";

  async function chain(s: McpServer): Promise<string[]> {
    const ids: string[] = [];
    const first = payload(await s.call("remember", { text: `${TAX}.`, eventDate: "2027-04-15" }));
    ids.push(String(first["id"]));
    for (const [n, date] of [["second", "2027-04-16"], ["third", "2027-04-17"], ["fourth", "2027-04-18"]] as const) {
      const r = payload(await s.call("remember", { text: `${TAX}, moved a ${n} time.`, updates: ids[ids.length - 1], eventDate: date }));
      ids.push(String(r["id"]));
    }
    return ids;
  }

  test("updates + eventDate null: every dated memory of the chain is cleared, both ways; a separate one is listed, not closed", async () => {
    const s = server();
    const store = s.counterpart.store;
    const [a, b, c, d] = await chain(s);
    expect(store.row(d!)?.event_date).toBe("2027-04-18");
    // The leak the check-in found: earlier memories of the chain kept a date.
    store.revise(a!, { eventDate: "2027-04-15" });
    store.revise(c!, { eventDate: "2027-04-17" });
    const list = String(payload(await s.call("remember", { text: `Checklist: ${TAX}, and file the zqtax forms.`, eventDate: "2027-04-15" }))["id"]);

    const r = payload(await s.call("remember", { text: `Paid the zqtax estimated payment to the county. ${TAX} is done.`, updates: b, eventDate: null }));
    for (const id of [a, b, c, d]) expect(store.row(id!)?.event_date).toBeNull();
    expect(store.row(String(r["id"]))?.event_date).toBeNull();
    const reminder = r["reminder"] as Record<string, unknown>;
    expect(reminder["cleared"]).toBe(true);
    expect([...(reminder["alsoClosed"] as string[])].sort()).toEqual([a!, d!].sort());
    // The separate memory of the same obligation is listed, by id and title, and left dated.
    const still = r["stillDated"] as { id: string; title: string | null; eventDate: string }[];
    expect(still.map((x) => x.id)).toContain(list);
    expect(still.find((x) => x.id === list)?.eventDate).toBe("2027-04-15");
    expect(String(r["stillDatedHint"])).toContain("close it too");
    expect(store.row(list)?.event_date).toBe("2027-04-15");
  });

  test("status done on a dated memory closes its chain too", async () => {
    const s = server();
    const store = s.counterpart.store;
    const [a, b, , d] = await chain(s);
    // The leak's shape: the first memory got its date back; the fourth holds the real one.
    store.revise(a!, { eventDate: "2027-04-15" });
    const r = payload(await s.call("remember", { text: `Paid it: ${TAX}.`, updates: a, status: "done" }));
    for (const id of [a!, b!, d!]) expect(store.row(id)?.event_date).toBeNull();
    expect((r["reminder"] as Record<string, unknown>)["alsoClosed"]).toEqual([d!]);
    expect(store.row(String(r["id"]))?.event_date).toBeNull();
    expect((r["reminder"] as Record<string, unknown>)["cleared"]).toBe(true);
  });

  test("session_end's entry says the same: the chain closed, the separate one listed", async () => {
    const s = server();
    const store = s.counterpart.store;
    const [a, , , d] = await chain(s);
    store.revise(a!, { eventDate: "2027-04-15" });
    const list = String(payload(await s.call("remember", { text: `Checklist: ${TAX}, and file the zqtax forms.`, eventDate: "2027-04-15" }))["id"]);
    const body = payload(
      await s.call("session_end", {
        session: "sess_checkin",
        memories: [{ content: `Paid the zqtax estimated payment to the county. ${TAX} is done.`, updates: d, eventDate: null }],
      }),
    );
    const out = (body["outcomes"] as Record<string, unknown>[])[0]!;
    expect(out["stored"]).toBe(true);
    expect((out["reminder"] as Record<string, unknown>)["alsoClosed"]).toEqual([a!]);
    expect((out["stillDated"] as { id: string }[]).map((x) => x.id)).toContain(list);
    expect(store.row(a!)?.event_date).toBeNull();
    expect(store.row(d!)?.event_date).toBeNull();
    expect(store.row(list)?.event_date).toBe("2027-04-15");
  });

  test("a reschedule moves the date and closes nothing else", async () => {
    const s = server();
    const store = s.counterpart.store;
    const [a, , , d] = await chain(s);
    store.revise(a!, { eventDate: "2027-04-15" });
    const r = payload(await s.call("remember", { text: `${TAX}, moved again.`, updates: d, eventDate: "2027-05-01" }));
    expect(store.row(String(r["id"]))?.event_date).toBe("2027-05-01");
    expect(store.row(a!)?.event_date).toBe("2027-04-15");
    expect(r["stillDated"]).toBeUndefined();
  });
});

// ── D. a revision carries its title, unless it closes something ─────────────

describe("D. a revision with no title carries the old one, except when it closes a dated memory", () => {
  test("an untitled revision takes the old memory's title, and says so", async () => {
    const s = server();
    const store = s.counterpart.store;
    const old = String(payload(await s.call("remember", { text: "The zqharbour ferry runs twice a day in winter.", title: "Zqharbour ferry times" }))["id"]);
    const r = payload(await s.call("remember", { text: "The zqharbour ferry runs three times a day in winter now.", updates: old }));
    expect(store.readProse(String(r["id"])).title).toBe("Zqharbour ferry times");
    expect(r["titleCarried"]).toEqual({ title: "Zqharbour ferry times", from: old });
    expect(r["titleAsked"]).toBeUndefined();
  });

  test("a sent title wins", async () => {
    const s = server();
    const store = s.counterpart.store;
    const old = String(payload(await s.call("remember", { text: "The zqharbour ferry runs twice a day in winter.", title: "Zqharbour ferry times" }))["id"]);
    const r = payload(await s.call("remember", { text: "The zqharbour ferry stopped for the season.", updates: old, title: "Zqharbour ferry stopped" }));
    expect(store.readProse(String(r["id"])).title).toBe("Zqharbour ferry stopped");
    expect(r["titleCarried"]).toBeUndefined();
  });

  test("closing a dated memory (eventDate null) carries no title and asks for one", async () => {
    const s = server();
    const store = s.counterpart.store;
    const old = String(payload(await s.call("remember", { text: "Renew the zqharbour mooring permit at the office.", title: "Renew mooring permit", eventDate: "2027-02-01" }))["id"]);
    const r = payload(await s.call("remember", { text: "Renewed the zqharbour mooring permit at the office.", updates: old, eventDate: null }));
    expect(store.readProse(String(r["id"])).title ?? null).toBeNull();
    expect(r["titleCarried"]).toBeUndefined();
    expect(String(r["titleAsked"])).toContain("A title is asked for");
  });

  test("status done on a dated memory carries no title either; on session_end too", async () => {
    const s = server();
    const store = s.counterpart.store;
    const old = String(payload(await s.call("remember", { text: "Renew the zqharbour mooring permit at the office.", title: "Renew mooring permit", eventDate: "2027-02-01" }))["id"]);
    const body = payload(
      await s.call("session_end", {
        session: "sess_checkin",
        memories: [{ content: "Renewed the zqharbour mooring permit at the office this morning.", updates: old, status: "done" }],
      }),
    );
    const out = (body["outcomes"] as Record<string, unknown>[])[0]!;
    expect(out["stored"]).toBe(true);
    expect(store.readProse(String(out["id"])).title ?? null).toBeNull();
    expect(String(out["titleAsked"])).toContain("A title is asked for");
  });

  test("status done on an undated memory carries no title either, and asks for one (review of #493)", async () => {
    const s = server();
    const store = s.counterpart.store;
    const old = String(payload(await s.call("remember", { text: "Plan: repaint the zqharbour boathouse door.", title: "Repaint boathouse door", status: "planned" }))["id"]);
    const r = payload(await s.call("remember", { text: "Repainted the zqharbour boathouse door green.", updates: old, status: "done" }));
    expect(store.readProse(String(r["id"])).title ?? null).toBeNull();
    expect(String(r["titleAsked"])).toContain("A title is asked for");
  });

  test("a confidential memory's title is never carried, even for the owner", async () => {
    const s = server();
    const store = s.counterpart.store;
    const old = String(payload(await s.call("remember", { text: "The zqharbour mooring fee is owed to my cousin.", title: "Zqharbour mooring debt" }))["id"]);
    store.revise(old, { meta: { confidential: true } });
    expect(store.row(old)?.confidential).toBe(1);
    const r = payload(await s.call("remember", { text: "The zqharbour mooring fee owed to my cousin is now half.", updates: old }));
    expect(store.readProse(String(r["id"])).title ?? null).toBeNull();
    expect(r["titleCarried"]).toBeUndefined();
  });
});

// ── C, after review: guards, raw pointers, a cycle ──────────────────────────

describe("C (review of #493). the chain close keeps closeThread's guards and its own pointers", () => {
  const BODY = "Pay the zqtax estimated payment to the county before the deadline";

  /** A dated memory put directly, its chain pointers and flags as given. */
  function dated(s: McpServer, body: string, opts: { date?: string; meta?: Record<string, unknown>; scope?: string; protect?: boolean } = {}): string {
    return s.counterpart.store.put({
      type: "memory",
      kind: "fact",
      body,
      ...(opts.date === undefined ? {} : { eventDate: opts.date }),
      ...(opts.meta === undefined ? {} : { meta: opts.meta }),
      origin: { session: "sess_checkin", scope: opts.scope ?? "/scope/one" },
      ...(opts.protect === true ? { physics: { protected: true } as never } : {}),
    });
  }

  function link(s: McpServer, from: string, to: string): void {
    s.counterpart.store.revise(from, { meta: { reminderMovedTo: to } });
    s.counterpart.store.revise(to, { meta: { reminderFrom: from } });
  }

  test("a protected chain memory keeps its date and is listed as skipped", async () => {
    const s = server();
    const store = s.counterpart.store;
    const a = dated(s, `${BODY}, first note.`, { date: "2027-04-15", protect: true });
    const b = dated(s, `${BODY}, moved.`, { date: "2027-04-16" });
    link(s, a, b);
    const r = payload(await s.call("remember", { text: `Paid it: ${BODY}.`, updates: b, eventDate: null }));
    expect(store.row(b)?.event_date).toBeNull();
    expect(store.row(a)?.event_date).toBe("2027-04-15");
    const still = r["stillDated"] as { id: string; skipped?: boolean }[];
    expect(still.find((x) => x.id === a)?.skipped).toBe(true);
  });

  test("for a session that is not the owner's, a confidential or another directory's chain memory is skipped", async () => {
    const s = openServer({ dir, session: "sess_guest", scope: "/scope/one", owner: false });
    findable(s.counterpart.store);
    open.push(s.counterpart);
    const store = s.counterpart.store;
    const secret = dated(s, `${BODY}, the private note.`, { date: "2027-04-14", meta: { confidential: true } });
    const elsewhere = dated(s, `${BODY}, written elsewhere.`, { date: "2027-04-15", scope: "/scope/two" });
    const b = dated(s, `${BODY}, moved.`, { date: "2027-04-16" });
    link(s, secret, elsewhere);
    link(s, elsewhere, b);
    const r = payload(await s.call("remember", { text: `Paid it: ${BODY}.`, updates: b, eventDate: null }));
    expect(store.row(b)?.event_date).toBeNull();
    expect(store.row(secret)?.event_date).toBe("2027-04-14");
    expect(store.row(elsewhere)?.event_date).toBe("2027-04-15");
    const skipped = (r["stillDated"] as { id: string; title: string | null; skipped?: boolean }[]).filter((x) => x.skipped === true);
    expect(skipped.map((x) => x.id).sort()).toEqual([secret, elsewhere].sort());
    expect(skipped.find((x) => x.id === secret)?.title).toBeNull();
  });

  test("a cycle in the pointers ends; every dated memory on it is closed once and marked spent", async () => {
    const s = server();
    const store = s.counterpart.store;
    const a = dated(s, `${BODY}, first.`, { date: "2027-04-15" });
    const b = dated(s, `${BODY}, second.`, { date: "2027-04-16" });
    const c = dated(s, `${BODY}, third.`, { date: "2027-04-17" });
    link(s, a, b);
    link(s, b, c);
    link(s, c, a);
    const r = payload(await s.call("remember", { text: `Paid it: ${BODY}.`, updates: b, eventDate: null }));
    for (const id of [a, b, c]) expect(store.row(id)?.event_date).toBeNull();
    expect([...((r["reminder"] as Record<string, unknown>)["alsoClosed"] as string[])].sort()).toEqual([a, c].sort());
    expect(store.readProse(a).meta["reminderSpentBy"]).toBe(String(r["id"]));
  });

  test("a pointer at a superseded memory is not followed to its successor: closing B leaves X's date", async () => {
    const s = server();
    const store = s.counterpart.store;
    const y = dated(s, `${BODY}, an old draft.`);
    // Y was superseded by X — another obligation's memory, dated.
    const x = store.supersede(y, { type: "memory", kind: "fact", body: "Renew the zqharbour mooring permit at the office.", eventDate: "2027-06-01" });
    const b = dated(s, `${BODY}, moved.`, { date: "2027-04-16" });
    link(s, b, y);
    await s.call("remember", { text: `Paid it: ${BODY}.`, updates: b, eventDate: null });
    expect(store.row(b)?.event_date).toBeNull();
    expect(store.row(x)?.event_date).toBe("2027-06-01");
  });
});

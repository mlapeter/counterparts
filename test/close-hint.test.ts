/**
 * A WRITE LISTS THE OPEN ITEMS IT LOOKS LIKE IT SETTLES (2026-11-07, SO1
 * step 1b, `core/close-hint.ts`). The proof an item is done lives in the
 * session that did the work, which never knew the item existed; so a
 * `remember` or `session_end` entry's result names open items from ANY
 * folder whose subject it matches, and the writing model decides.
 *
 *   1. Folder A leaves "0.3.46 ready to publish" open (settles when 0.3.46
 *      published); folder B's session_end "0.3.47 published" lists it, with
 *      A's folder. Closing it through `updates` counts a close beside the
 *      shown row.
 *   2. An unrelated write lists nothing (no key at all).
 *   3. "#760 merged" lists an item naming #760.
 *   4. An item asked of the owner carries the note.
 *   5. At most three, nearest first.
 *   6. Nothing for an entry about the owner, nor for a plan.
 *   7. The cost, on 150 open items in three folders.
 *
 * Through the real doors (MCP `remember` and `session_end`). Hermetic: a
 * fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "../src/adapters/mcp/index.js";
import { MAY_CLOSE_HINT } from "../src/adapters/mcp/server-words.js";
import { Counterpart } from "../src/core/counterpart.js";
import { recordSession } from "../src/adapters/sessions.js";
import { CLOSE_HINT_CLOSED_EVENT, CLOSE_HINT_SHOWN_EVENT, closeHints } from "../src/core/close-hint.js";
import { prKeys } from "../src/core/interference.js";

const BASE = Date.parse("2026-09-01T12:00:00Z");
const A = "/work/alpha";
const B = "/work/beta";
let dir: string;
const opened: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-close-hint-"));
});

afterEach(() => {
  for (const c of opened.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

const now = (): number => BASE;

function brain(): Counterpart {
  const c = Counterpart.open({ dir, now, timeZone: "UTC" });
  opened.push(c);
  return c;
}

function as(c: Counterpart, session: string, scope: string): McpServer {
  recordSession(dir, { sessionId: session, scope, phase: "start" });
  return new McpServer({ counterpart: c, session, scope, registryDir: dir, now });
}

async function remember(s: McpServer, args: Record<string, unknown>): Promise<{ id: string; result: Record<string, unknown> }> {
  const r = await s.call("remember", args);
  expect(r.isError ?? false).toBe(false);
  const id = r.structuredContent["id"];
  expect(typeof id).toBe("string");
  return { id: id as string, result: r.structuredContent };
}

async function open(s: McpServer, content: string, extra: Record<string, unknown> = {}): Promise<string> {
  return (await remember(s, { text: content, kind: "fact", unresolved: true, ...extra })).id;
}

type Listed = { id: string; title: string; folder?: string; settlesWhen?: string; note?: string };
const listed = (r: Record<string, unknown>): Listed[] => (r["mayClose"] as Listed[] | undefined) ?? [];

describe("1. across folders, by version", () => {
  test("A's open publish item is listed beside B's session_end '0.3.47 published', with A's folder; a close is counted", async () => {
    const c = brain();
    const a = as(c, "s-alpha", A);
    const b = as(c, "s-beta", B);
    const item = await open(a, "0.3.46 ready to publish", { settlesWhen: "0.3.46 published" });

    const r = await b.call("session_end", { session: "s-beta", memories: [{ content: "0.3.47 published to npm; the plugin picked it up.", kind: "fact" }] });
    expect(r.isError ?? false).toBe(false);
    const entry = (r.structuredContent["memories"] ?? r.structuredContent["outcomes"]) as Record<string, unknown>[] | undefined;
    const outcome = (entry ?? []).find((o) => o["stored"] === true) ?? {};
    const hints = listed(outcome);
    expect(hints.map((h) => h.id)).toEqual([item]);
    expect(hints[0]?.folder).toBe(A);
    expect(hints[0]?.settlesWhen).toBe("0.3.46 published");
    expect(outcome["mayCloseHint"]).toBe(MAY_CLOSE_HINT);
    expect(MAY_CLOSE_HINT).toContain("unresolved: false");

    const shown = c.store.eventLog({ name: CLOSE_HINT_SHOWN_EVENT });
    expect(shown.length).toBe(1);
    expect(shown[0]?.ref).toBe(outcome["id"] as string);
    const payload = JSON.parse(shown[0]?.payload ?? "{}") as { ids: string[]; ms: number };
    expect(payload.ids).toEqual([item]);
    expect(typeof payload.ms).toBe("number");

    // The model closes it, from B, through updates.
    const closed = await remember(b, { text: "0.3.46 publish item settled: 0.3.47 is out.", kind: "fact", updates: item, unresolved: false });
    expect((closed.result["thread"] as { closed: string } | undefined)?.closed).toBe(item);
    expect(c.store.readProse(item).meta["unresolved"]).toBe(false);
    const taken = c.store.eventLog({ name: CLOSE_HINT_CLOSED_EVENT });
    expect(taken.map((e) => e.ref)).toEqual([item]);
    expect(listed(closed.result)).toEqual([]);
  });

  test("a remember from another folder lists it too; the same version only as the trigger names it", async () => {
    const c = brain();
    const a = as(c, "s-alpha", A);
    const b = as(c, "s-beta", B);
    const item = await open(a, "Mike's step after the release: plugin update", { settlesWhen: "0.3.46 published" });
    const same = await remember(b, { text: "0.3.46 published to npm this morning.", kind: "fact" });
    expect(listed(same.result).map((h) => h.id)).toEqual([item]);
    // An older version does not reach it.
    const older = await remember(b, { text: "0.3.45 released (backfill note).", kind: "fact" });
    expect(listed(older.result)).toEqual([]);
  });
});

describe("2. an unrelated write lists nothing", () => {
  test("no key at all", async () => {
    const c = brain();
    const a = as(c, "s-alpha", A);
    const b = as(c, "s-beta", B);
    await open(a, "0.3.46 ready to publish", { settlesWhen: "0.3.46 published" });
    await open(a, "Confirm #735's help-block edit");
    const r = await remember(b, { text: "The kiln class moved to Tuesdays in the north studio.", kind: "fact" });
    expect("mayClose" in r.result).toBe(false);
    expect("mayCloseHint" in r.result).toBe(false);
    // Names the version, but no done verb beside it.
    const plan = await remember(b, { text: "Will publish 0.3.47 tomorrow.", kind: "fact" });
    expect("mayClose" in plan.result).toBe(false);
    expect(c.store.eventLog({ name: CLOSE_HINT_SHOWN_EVENT }).length).toBe(0);
  });
});

describe("3. a pull request", () => {
  test("'#760 merged' lists an item naming #760, and not one naming #76", async () => {
    const c = brain();
    const a = as(c, "s-alpha", A);
    const b = as(c, "s-beta", B);
    const item = await open(a, "Confirm #760's help-block edit with Mike");
    await open(a, "Review #76 before Friday");
    const r = await remember(b, { text: "#760 merged after review.", kind: "fact" });
    expect(listed(r.result).map((h) => h.id)).toEqual([item]);
    const verbFirst = await remember(b, { text: "Merged PR #760 (help block).", kind: "fact" });
    expect(listed(verbFirst.result).map((h) => h.id)).toEqual([item]);
  });

  test("prKeys reads the verb beside the number only", () => {
    expect([...prKeys("#760 merged")]).toEqual([760]);
    expect([...prKeys("PR #760 is merged")]).toEqual([760]);
    expect([...prKeys("merged #760")]).toEqual([760]);
    expect([...prKeys("will merge #760 tomorrow")]).toEqual([]);
    expect([...prKeys("#760 merged tomorrow")]).toEqual([]);
    expect([...prKeys("Notes on #760 and what merged elsewhere")]).toEqual([]);
    expect([...prKeys("Confirm #735's help-block edit", "any")]).toEqual([735]);
  });
});

describe("4. an item asked of the owner", () => {
  test("carries the note", async () => {
    const c = brain();
    const a = as(c, "s-alpha", A);
    const b = as(c, "s-beta", B);
    const item = await open(a, "Asked Mike: may the next release go out tonight?", { status: "asked", settlesWhen: "Mike says 0.3.47 may go out" });
    const r = await remember(b, { text: "0.3.47 released to npm this morning.", kind: "fact" });
    const hints = listed(r.result);
    expect(hints.map((h) => h.id)).toEqual([item]);
    expect(hints[0]?.note).toMatch(/^asked of .+: close only if this is .+'s answer$/);
  });
});

describe("5. the cap", () => {
  test("at most three, nearest first", async () => {
    const c = brain();
    const a = as(c, "s-alpha", A);
    const b = as(c, "s-beta", B);
    const far = await open(a, "0.3.40 ready to publish");
    const near: string[] = [];
    for (const v of [44, 45, 46, 47]) near.push(await open(a, `0.3.${String(v)} ready to publish`));
    const r = await remember(b, { text: "0.3.48 published to npm this morning.", kind: "fact" });
    const ids = listed(r.result).map((h) => h.id);
    expect(ids).toEqual([near[3] ?? "", near[2] ?? "", near[1] ?? ""]);
    expect(ids).not.toContain(far);
  });
});

describe("6. personal entries and plans", () => {
  test("an entry about the owner lists nothing; nor does a planned one", async () => {
    const c = brain();
    const a = as(c, "s-alpha", A);
    const b = as(c, "s-beta", B);
    await open(a, "0.3.46 ready to publish", { settlesWhen: "0.3.46 published" });
    const owner = await remember(b, { text: "0.3.47 published: Mike was glad it finally went out.", kind: "fact", about: "owner" });
    expect("mayClose" in owner.result).toBe(false);
    // Text that would match on its own: only the status keeps it out.
    const planned = await remember(b, { text: "0.3.47 published, planned for Friday's window.", kind: "fact", status: "planned" });
    expect("mayClose" in planned.result).toBe(false);
  });
});

describe("7. the cost", () => {
  test("150 open items in three folders: the read stays small", async () => {
    const c = brain();
    const folders = [A, B, "/work/gamma"];
    const writers = folders.map((f, i) => as(c, `s-${String(i)}`, f));
    for (let i = 0; i < 150; i++) {
      const w = writers[i % 3] as McpServer;
      const subject = i % 10 === 0 ? `0.3.${String(i)} ready to publish` : i % 7 === 0 ? `Check #${String(1000 + i)} after it lands` : `Open question ${String(i)} about the kiln schedule and the glaze order`;
      await open(w, subject);
    }
    const b = writers[1] as McpServer;
    const ms: number[] = [];
    for (let k = 0; k < 5; k++) {
      await remember(b, { text: `0.3.${String(200 + k)} published (run ${String(k)}).`, kind: "fact" });
      const last = c.store.eventLog({ name: CLOSE_HINT_SHOWN_EVENT, order: "desc", limit: 1 })[0];
      ms.push((JSON.parse(last?.payload ?? "{}") as { ms: number }).ms);
    }
    // A done write that matches nothing pays the full read and lists nothing.
    const none: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      closeHints(c.store, { id: "mem_none", title: null, body: `0.9.${String(k)} released elsewhere.`, about: null, status: null }, { day: c.store.livedDay(), carryDays: 14, glimpses: false });
      none.push(performance.now() - t0);
    }
    none.sort((x, y) => x - y);
    console.log(`close hint, done write matching nothing over 150 open items: p50 ${none[2]?.toFixed(2) ?? "?"} ms`);
    ms.sort((x, y) => x - y);
    console.log(`close hint over 150 open items: p50 ${String(ms[2])} ms, max ${String(ms[4])} ms`);
    expect(ms[2]).toBeLessThan(50);
  }, 60_000);
});

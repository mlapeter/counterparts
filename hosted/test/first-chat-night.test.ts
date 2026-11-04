/**
 * HN1 (2026-11-04): on claude.ai, the first chat of the day runs the night.
 * Driven through the hosted server's real /mcp socket, with claude.ai's words
 * (every tenant is opened as claude.ai's host):
 *
 *   - the first wake of a day that owes a night carries the instruction (answer
 *     first, then the one line, then `dream` launch with this session), and
 *     claims the day; a second wake that day carries nothing;
 *   - `ask` makes it ask first; `off` says nothing and claims nothing;
 *   - of two connections waking at once, one is told; a night started by one
 *     connection blocks a second (its wake is told nothing, its `begin` is
 *     refused); a routine's launch first leaves the day's chats untold;
 *   - the launch prompt names the session on `propose` and `journal`, and a
 *     `propose` that names it lands under that session even with a newer chat
 *     open (one that doesn't is filed under the newer chat, and refused).
 *
 * Hermetic: a temp root per test, removed after; a stub spawner (no worker
 * runs); tokens generated per test; every word is invented.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { CLAUDE_AI_NIGHT_SAID, claudeAiNightLine } from "../../src/adapters/mcp/server-words.js";
import type { SpawnPlan } from "../../src/adapters/spawn.js";
import { addDays } from "../../src/core/time.js";
import { createHostedServer } from "../src/server.js";
import type { Caller, HostedCallRecord } from "../src/server.js";
import { Tenants } from "../src/tenants.js";
import { listen, rpc, storeId, tempRoot } from "./helpers.js";

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];

beforeEach(() => {
  tmp = tempRoot("first-chat-night");
});

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) {
    try {
      await c();
    } catch {
      /* already closed */
    }
  }
  tmp.remove();
});

interface Rig {
  url: string;
  tenants: Tenants;
  caller: Caller;
  headers: Record<string, string>;
  calls: HostedCallRecord[];
  plans: SpawnPlan[];
}

async function rig(): Promise<Rig> {
  const plans: SpawnPlan[] = [];
  const tenants = new Tenants({ root: join(tmp.root, "tenants"), embedder: null, spawner: (p) => (plans.push(p), { pid: 4242 }) });
  closers.push(() => tenants.closeAll());
  const caller: Caller = { personId: "person-a", storeId: storeId(), timeZone: "UTC" };
  const token = randomBytes(24).toString("base64url");
  const calls: HostedCallRecord[] = [];
  const server = createHostedServer({
    tenants,
    publicOrigin: "https://app.counterparts.ai",
    authenticate: async (t) => (t === token ? caller : null),
    onCall: (r) => calls.push(r),
  });
  const { base, close } = await listen(server);
  closers.push(close);
  return { url: `${base}/mcp`, tenants, caller, headers: { authorization: `Bearer ${token}` }, calls, plans };
}

interface Answer {
  isError: boolean;
  text: string;
  out: Record<string, unknown>;
}

async function call(r: Rig, name: string, args: Record<string, unknown>): Promise<Answer> {
  const a = await rpc(r.url, "tools/call", { name, arguments: args }, r.headers);
  assert.equal(a.status, 200);
  const result = a.body["result"] as { isError?: boolean; content: { text: string }[]; structuredContent: Record<string, unknown> };
  assert.ok(result !== undefined, JSON.stringify(a.body));
  return { isError: result.isError === true, text: result.content[0]?.text ?? "", out: result.structuredContent };
}

/**
 * A store with a night owed today: ten lived days behind it, the first meeting
 * done, and four lived memories nobody has dreamed. Written before the
 * tenant's first wake, as an account with a past would be.
 */
async function owed(r: Rig, setting: "auto" | "ask" | "off" = "auto"): Promise<string> {
  return r.tenants.withTenant(r.caller.storeId, {}, async (_t, server) => {
    const c = server.counterpart;
    const today = c.store.today();
    c.store.setMeta("onboarding.meet", "done");
    for (let d = 10; d >= 1; d -= 1) c.store.advanceClock(addDays(today, -d));
    for (const body of ["The cold frame lid sticks in the morning damp.", "Wren talks plans through out loud first.", "The rain barrel overflows toward the shed.", "Wren wants the bean trellis taller this year."]) {
      const day = c.store.livedDay();
      c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.5, emotional: 0, predictive: 0.5 }, physics: { birthDay: day, lastUsedDay: day } });
    }
    assert.equal(c.dreams.setSetting(setting, { by: "owner" }).ok, true);
    return today;
  });
}

async function dayRow(r: Rig, today: string): Promise<{ state: string; session: string | null } | undefined> {
  return r.tenants.withTenant(r.caller.storeId, {}, async (_t, server) => server.counterpart.store.dreamAsk(today));
}

const told = (text: string): boolean => text.includes(CLAUDE_AI_NIGHT_SAID) || text.includes("dreaming asks first");

describe("the first chat of the day runs the night (HN1)", () => {
  test("the first wake with a night owed carries the instruction and claims the day; a second wake that day carries nothing", async () => {
    const r = await rig();
    const today = await owed(r);
    const first = await call(r, "wake", {});
    const session = String(first.out["session"]);
    const line = claudeAiNightLine({ session, setting: "auto", reflects: null, who: "the person" });
    assert.ok(first.text.includes(line), first.text);
    // Answer first, then the one line, then the launch, naming this session.
    assert.ok(line.indexOf("First answer") < line.indexOf(CLAUDE_AI_NIGHT_SAID));
    assert.ok(line.includes(`phase "launch", session: ${session}`));
    // The person's things come first: the line rides after the wake itself.
    assert.ok(first.text.indexOf("<!-- counterparts:wake/end") < first.text.indexOf(line));
    assert.deepEqual(await dayRow(r, today).then((x) => ({ state: x?.state, session: x?.session })), { state: "launched", session });
    // No run is started: the chat's own tool calls are the night.
    for (const p of r.plans) assert.equal(p.env["COUNTERPARTS_NIGHT_RUN"], undefined);
    const second = await call(r, "wake", {});
    assert.equal(told(second.text), false, second.text);
  });

  test("ask: the first wake asks first, in claude.ai's words, and the day is offered, not launched; off: nothing, and no claim", async () => {
    const r = await rig();
    const today = await owed(r, "ask");
    const first = await call(r, "wake", {});
    const session = String(first.out["session"]);
    assert.ok(first.text.includes(claudeAiNightLine({ session, setting: "ask", reflects: null, who: "the person" })), first.text);
    assert.equal(first.text.includes(CLAUDE_AI_NIGHT_SAID), false);
    assert.doesNotMatch(first.text, /terminal|Agent tool/);
    assert.equal((await dayRow(r, today))?.state, "offered");
    assert.equal(told((await call(r, "wake", {})).text), false);

    const r2 = await rig();
    const today2 = await owed(r2, "off");
    const off = await call(r2, "wake", {});
    assert.equal(told(off.text), false, off.text);
    assert.equal(await dayRow(r2, today2), undefined);
  });

  test("two connections waking at once: one is told; a night started by one blocks a second", async () => {
    const r = await rig();
    await owed(r);
    const [a, b] = await Promise.all([call(r, "wake", {}), call(r, "wake", {})]);
    assert.equal([a, b].filter((w) => told(w.text)).length, 1);
    const winner = told(a.text) ? a : b;
    const loser = winner === a ? b : a;
    const s = String(winner.out["session"]);
    assert.equal((await call(r, "dream", { phase: "launch", session: s })).isError, false);
    await call(r, "dream", { phase: "writer", session: s });
    const begun = await call(r, "dream", { phase: "begin", session: s });
    assert.equal(begun.isError, false, begun.text);
    // A third chat while it runs is told nothing; the loser's own try at the dream is refused.
    assert.equal(told((await call(r, "wake", {})).text), false);
    const second = await call(r, "dream", { phase: "begin", session: String(loser.out["session"]) });
    assert.equal(second.isError, true);
    assert.equal(second.out["reason"], "dreaming-now");
    // Once journaled, a later chat is told nothing either.
    await call(r, "dream", { phase: "journal", session: s, dream: String(begun.out["dream"]), title: "The cold frame", text: "I dreamed the lid would not close." });
    assert.equal(told((await call(r, "wake", {})).text), false);
  });

  test("a routine's launch first: the day's chats are told nothing", async () => {
    const r = await rig();
    await owed(r);
    const night = String((await call(r, "wake", { night: true })).out["session"]);
    assert.equal((await call(r, "dream", { phase: "launch", session: night })).isError, false);
    assert.equal(told((await call(r, "wake", {})).text), false);
  });

  test("the launch prompt names the session on propose and journal; a propose that names it lands under it with a newer chat open", async () => {
    const r = await rig();
    await owed(r);
    const s = String((await call(r, "wake", {})).out["session"]);
    const prompt = String((await call(r, "dream", { phase: "launch", session: s })).out["prompt"]);
    assert.ok(prompt.includes(`call phase "propose" with dream: <id>, session: ${s}`), prompt);
    assert.ok(prompt.includes(`Call phase "journal" with dream: <id>, session: ${s}`), prompt);
    await call(r, "dream", { phase: "writer", session: s });
    const begun = await call(r, "dream", { phase: "begin", session: s });
    const dream = String(begun.out["dream"]);
    // A second chat opens meanwhile: it is now the most recent claude.ai session.
    const other = String((await call(r, "wake", {})).out["session"]);
    assert.notEqual(other, s);
    // Unnamed, the call is filed under the newer chat, which does not own the dream: refused.
    const unnamed = await call(r, "dream", { phase: "propose", dream, changes: [] });
    assert.equal(unnamed.isError, true);
    assert.equal(unnamed.out["boundTo"], other);
    // Named, it lands under this chat's session, with no bind note.
    const named = await call(r, "dream", { phase: "propose", session: s, dream, changes: [] });
    assert.equal(named.isError, false, named.text);
    assert.equal(named.out["bindNote"], undefined);
    const record = r.calls.filter((c) => c.tool === "dream").at(-1);
    assert.equal(record?.session, s);
    assert.equal(record?.ok, true);
  });
});

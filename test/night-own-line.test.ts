/**
 * THE NIGHT'S OWN LINE (NL1, 2026-10-30, `core/dream/reflect.ts#ownLine`): after
 * the page, the reflection may send one or two whole sentences for whoever wakes
 * tomorrow. Kept on the row's `detail`, shown by `recall "last night"`, and in no
 * wake until WK2 reads it. Never cut: past its room it comes back once, then
 * stays empty.
 *
 * Every case goes through the tool doors. Hermetic: a temp dir made and removed
 * here; every word invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeCodeAdapter } from "../src/adapters/claude-code/index.js";
import type { HookInput } from "../src/adapters/claude-code/index.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeMode, ScopeVerdict } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";
import { ownLineAsk, REFLECT_TUNABLES, reflectionOpener } from "../src/core/dream/reflect.js";
import { chaseRemoved } from "../src/core/store/owner-op-seam.js";

const HOUR = 3_600_000;
const D1 = "2026-10-23";
const D2 = "2026-10-24";
const at = (ymd: string, h: number): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR;
const SESSION = "b8b8b8b8-0000-4000-8000-0000000000aa";
const MAX = REFLECT_TUNABLES.OWN_LINE_BYTES;
const LINE = "Wren left the greenhouse key under the blue pot, and I only found it when she asked me where it was. The seedlings had already gone out by then.";
const WORDS = "The broad beans went in by the fence, netted against the pigeons before the rain came on Sunday.";

let root: string;
let storeDir: string;
let scopesFile: string;
let HERE: string;
let SHUT: string;
let clock = at(D1, 7);
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-own-line-")));
  storeDir = join(root, "store");
  scopesFile = join(root, "scopes.json");
  HERE = join(root, "garden");
  SHUT = join(root, "bakery");
  for (const d of [HERE, SHUT]) mkdirSync(d, { recursive: true });
  clock = at(D1, 7);
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

function brain(name: string | null = "Wren"): Counterpart {
  const c = Counterpart.open({ dir: storeDir, snapshotsDir: join(root, "snaps"), now: () => clock, timeZone: "UTC", ...(name === null ? {} : { identity: { name } }) });
  open.push(c);
  return c;
}

function remembered(c: Counterpart, body: string, scope = HERE): string {
  c.store.advanceClock(D1);
  const day = c.store.livedDay();
  return c.store.put({ type: "memory", kind: "fact", body, about: "work", salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, origin: { session: "e1e1e1e1-0000-4000-8000-000000000005", scope } });
}

function door(c: Counterpart, scope = HERE, session = SESSION, kind: string | null = "reflection"): McpServer {
  return new McpServer({
    counterpart: c,
    session,
    scope,
    registryDir: join(root, "registry"),
    now: () => clock,
    env: kind === null ? {} : { COUNTERPARTS_NIGHT_CHILD: kind, COUNTERPARTS_NIGHT_RUN: "1" },
    scopesFile,
  });
}

function setting(modes: Readonly<Record<string, ScopeMode>>): void {
  let reg = null;
  for (const [dir, mode] of Object.entries(modes)) reg = setScope(reg, dir, mode, { at: D1 });
  if (reg !== null) writeScopes(scopesFile, reg);
}

async function begun(s: McpServer): Promise<{ reflection: string; how: string }> {
  clock = at(D2, 4);
  const out = (await s.call("reflect", { phase: "begin", session: SESSION })).structuredContent;
  return { reflection: String(out["reflection"]), how: JSON.stringify(out) };
}

function finish(s: McpServer, reflection: string, more: Record<string, unknown>): Promise<Record<string, unknown>> {
  return s.call("reflect", { phase: "finish", session: SESSION, reflection, ...more }).then((r) => r.structuredContent);
}

const FIRST = { entry: "A short look back at the week in the garden." };
const detail = (c: Counterpart, id: string): Record<string, unknown> => JSON.parse(c.store.reflection(id)?.detail ?? "{}") as Record<string, unknown>;
async function lastNight(s: McpServer): Promise<Record<string, unknown>> {
  const out = (await s.call("recall", { handle: "last night" })).structuredContent;
  return (out["reflection"] ?? {}) as Record<string, unknown>;
}

describe("the night's own line", () => {
  test("it's asked for last among finish's fields, in the owner's name; a store with no name drops that clause", async () => {
    const named = await begun(door(brain()));
    const asked = ownLineAsk("Wren");
    expect(asked).toContain("using Wren's name on first mention");
    expect(named.how).toContain(`- line (optional): ${asked}`);
    expect(named.how).not.toContain("Mike");
    expect(ownLineAsk(null)).not.toContain("name");
    expect(ownLineAsk(null)).toContain("in the first person. One point is enough.");
  });

  test("sent with the page: kept on the row, shown by recall \"last night\", and in neither the hand-back nor the share nor the wake", async () => {
    const c = brain();
    const m = remembered(c, WORDS);
    const s = door(c);
    const { reflection } = await begun(s);
    const out = await finish(s, reflection, { ...FIRST, cites: [m], share: { text: "The beans are in.", cites: [m] }, line: LINE });
    expect(out["line"]).toEqual({ kept: true, reason: "kept" });
    expect(out["again"]).toBeUndefined();
    expect(detail(c, reflection)["line"]).toBe(LINE);
    expect((await lastNight(s))["line"]).toBe(LINE);
    expect(JSON.stringify((await s.call("recall", { handle: reflection })).structuredContent)).toContain("greenhouse key");
    expect(String(out["handBack"])).not.toContain("greenhouse key");
    expect(c.store.reflection(reflection)?.share).not.toContain("greenhouse key");

    const verdict = { mode: "on", matched: HERE, entry: null } as ScopeVerdict;
    const a = new ClaudeCodeAdapter({ counterpart: c, config: { dataDir: storeDir, injectionBudgetBytes: 9_000 }, configPath: join(root, "claude-code.json"), now: () => clock, scope: verdict, command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 4242 }) });
    const woke = a.sessionStart({ sessionId: "a7a7a7a7-0000-4000-8000-000000000002", scope: HERE, at: D2, source: "startup" } as HookInput).injection;
    expect(woke).not.toContain("greenhouse key");
  });

  test("the room is in bytes, and exactly the room is kept", async () => {
    const c = brain();
    const s = door(c);
    const { reflection } = await begun(s);
    const fits = "é".repeat(MAX / 2);
    expect((await finish(s, reflection, { ...FIRST, line: fits }))["line"]).toEqual({ kept: true, reason: "kept" });
    expect(detail(c, reflection)["line"]).toBe(fits);
    // 151 characters, 302 bytes: under a character count, past the room. The line that stands, stands.
    const past = await finish(s, reflection, { line: "é".repeat(MAX / 2 + 1) });
    expect((past["line"] as Record<string, unknown>)["kept"]).toBe(true);
    expect((past["line"] as Record<string, unknown>)["reason"]).toBe("past-room");
    expect(detail(c, reflection)["line"]).toBe(fits);
    expect(detail(c, reflection)["lineRefused"]).toBeUndefined();
  });

  test("past its room: sent back once and never cut; a second time it stays empty, and that closes it", async () => {
    const c = brain();
    const s = door(c);
    const { reflection } = await begun(s);
    const long = `${LINE} ${LINE} ${LINE}`;

    const first = await finish(s, reflection, { ...FIRST, line: long });
    expect((first["line"] as Record<string, unknown>)["reason"]).toBe("past-room");
    expect(String(first["again"])).toContain("line — past-room");
    expect(String(first["say"])).toContain("call finish again");
    expect(detail(c, reflection)["line"]).toBeUndefined();
    expect((await lastNight(s))["line"]).toBeUndefined();

    const second = await finish(s, reflection, { line: long });
    expect((second["line"] as Record<string, unknown>)["reason"]).toBe("kept-empty");
    expect(second["again"]).toBeUndefined();
    expect(String(second["say"])).toBe("Return `handBack` as your final message, unchanged.");
    expect(detail(c, reflection)["line"]).toBe("");
    expect((await lastNight(s))["line"]).toBeUndefined();

    // Closed: one that would fit doesn't reopen it.
    await finish(s, reflection, { line: "A short one." });
    expect(detail(c, reflection)["line"]).toBe("");
  });

  test("past its room, then a line that fits: that one is kept whole", async () => {
    const c = brain();
    const s = door(c);
    const { reflection } = await begun(s);
    await finish(s, reflection, { ...FIRST, line: `${LINE} ${LINE} ${LINE}` });
    const again = await finish(s, reflection, { line: LINE });
    expect(again["line"]).toEqual({ kept: true, reason: "kept" });
    expect(again["again"]).toBeUndefined();
    expect((await lastNight(s))["line"]).toBe(LINE);
  });

  test("left empty: kept empty, whitespace too, and shown as nothing", async () => {
    const c = brain();
    const s = door(c);
    const { reflection } = await begun(s);
    const out = await finish(s, reflection, { ...FIRST, line: "  \n " });
    expect(out["line"]).toEqual({ kept: false, reason: "empty" });
    expect(out["again"]).toBeUndefined();
    expect(detail(c, reflection)["line"]).toBe("");
    expect((await lastNight(s))["line"]).toBeUndefined();
  });

  test("never sent, as on every older row: no key, no field in the answer, nothing shown", async () => {
    const c = brain();
    const s = door(c);
    const { reflection } = await begun(s);
    const out = await finish(s, reflection, FIRST);
    expect(out["line"]).toBeUndefined();
    expect("line" in detail(c, reflection)).toBe(false);
    const shown = await lastNight(s);
    expect(shown["id"]).toBe(reflection);
    expect("line" in shown).toBe(false);
  });

  test("it survives a later finish that sends something else, and it lies on one line", async () => {
    const c = brain();
    const s = door(c);
    const { reflection } = await begun(s);
    await finish(s, reflection, { ...FIRST, line: "First I found the key.\n\nThen the seedlings." });
    expect(detail(c, reflection)["line"]).toBe("First I found the key. Then the seedlings.");
    const out = await finish(s, reflection, { title: "A later word" });
    expect(out["line"]).toEqual({ kept: true, reason: "kept-earlier" });
    expect(detail(c, reflection)["line"]).toBe("First I found the key. Then the seedlings.");
  });

  test("the scan reads it: a credential doesn't land, and a dream's mark comes back", async () => {
    const c = brain();
    const s = door(c);
    const { reflection } = await begun(s);
    const key = `sk-ant-api03-${"A".repeat(90)}AA`;
    await finish(s, reflection, { ...FIRST, line: `The key was ${key}.` });
    expect(JSON.stringify(detail(c, reflection))).not.toContain(key);
    await finish(s, reflection, { line: "" });
    const marked = await finish(s, reflection, { line: `${reflectionOpener("rfl_x")} A word.` });
    expect((marked["line"] as Record<string, unknown>)["reason"]).toBe("dream-mark-in-text");
    expect(detail(c, reflection)["line"]).toBe("");
  });
});

describe("the fence and the removal", () => {
  test("a reflection's line is written with the closed folder out of its hands, the sent-back try included", async () => {
    const c = brain();
    const secret = remembered(c, "The quarter closed at a loss from the van repair.", SHUT);
    setting({ [HERE]: "on", [SHUT]: "off" });
    const s = door(c);
    const { reflection, how } = await begun(s);
    expect(how).not.toContain("closed at a loss");
    await finish(s, reflection, { ...FIRST, line: `${LINE} ${LINE} ${LINE}` });
    const asked = (await s.call("recall", { ids: [secret] })).structuredContent;
    expect(JSON.stringify(asked)).not.toContain("closed at a loss");
  });

  test("a night from a folder since closed: its line isn't read from another folder's recall", async () => {
    const c = brain();
    setting({ [HERE]: "on", [SHUT]: "on" });
    const m = remembered(c, WORDS, SHUT);
    clock = at(D2, 3);
    const dreamer = door(c, SHUT, SESSION, "dream");
    const began = (await dreamer.call("dream", { phase: "begin", session: SESSION })).structuredContent;
    const dream = String(began["dream"]);
    await dreamer.call("dream", { phase: "journal", session: SESSION, dream, title: "A night", text: "A short dream." });
    const s = door(c, SHUT);
    const out = (await s.call("reflect", { phase: "begin", session: SESSION, dream })).structuredContent;
    await finish(s, String(out["reflection"]), { ...FIRST, cites: [m], line: LINE });
    expect((await lastNight(door(c, SHUT, "c9c9c9c9-0000-4000-8000-000000000003", null)))["line"]).toBe(LINE);

    setting({ [HERE]: "on", [SHUT]: "off" });
    const elsewhere = (await door(c, HERE, "d0d0d0d0-0000-4000-8000-000000000004", null).call("recall", { handle: "last night" })).structuredContent;
    expect(JSON.stringify(elsewhere)).not.toContain("greenhouse key");
  });

  test("the owner's removal empties the line of a reflection that was shown the memory", async () => {
    const c = brain();
    const m = remembered(c, WORDS);
    const s = door(c);
    const { reflection } = await begun(s);
    await finish(s, reflection, { ...FIRST, cites: [m], line: LINE });
    c.store.appendRemovalRecord({ memoryId: m, stage: "requested", actor: "owner", reason: "test" });
    c.store.appendRemovalRecord({ memoryId: m, stage: "dark", actor: "owner", reason: "test" });
    expect(chaseRemoved(c.store, m).neutralized).toContainEqual({ surface: "operational.reflections", count: 1 });
    expect(detail(c, reflection)["line"]).toBe("");
    expect((await lastNight(s))["line"]).toBeUndefined();
    // The rest of what the row knows stays.
    expect(detail(c, reflection)["title"]).toBeDefined();
  });

  test("the removal reads the line for a quote, on a reflection never shown the memory", async () => {
    const c = brain();
    const s = door(c);
    const { reflection } = await begun(s);
    const late = remembered(c, WORDS);
    await finish(s, reflection, { ...FIRST, line: WORDS });
    expect(c.store.reflection(reflection)?.entry).not.toContain("redacted");
    c.store.appendRemovalRecord({ memoryId: late, stage: "requested", actor: "owner", reason: "test" });
    c.store.appendRemovalRecord({ memoryId: late, stage: "dark", actor: "owner", reason: "test" });
    chaseRemoved(c.store, late);
    expect(detail(c, reflection)["line"]).toBe("");
    expect(c.store.reflection(reflection)?.entry).toContain("redacted");
  });
});

/**
 * A LONG LIST ITEM IS A LINE, AND THE TOP ITEMS ARE WHOLE WHEN THERE IS ROOM
 * (#489 C, 2026-10-16; Mike, lightly held).
 *
 * Measured 2026-10-15: the wake printed every listed memory as its whole first
 * paragraph (350–1,100 bytes), so beside the page only 3–4 items fit and the
 * rest were bare ids. Now an item in "How I work", "Still open", "Might be
 * relevant" or "Coming up" longer than `WAKE_LINE_BYTES` prints as
 * `date · title [id]` — and the first item of "Still open" and of "Coming up"
 * goes back to whole text when that fits in the room left over.
 *
 * Pinned here:
 *   - the line form, the threshold, the untitled fallback (`fit/lineOf`);
 *   - a plain reminder due the day the wake is read stays whole, and so does
 *     the identity list on a store with no page;
 *   - the id prints once, also beside a standing that already names it;
 *   - the first-item upgrade, lane by lane, only in leftover room;
 *   - a production-scale composition at 9,000 bytes: the page whole and ten
 *     or more lane elements beside it;
 *   - the session start's lookup ledger (`fit.index.wake`), the recall tool
 *     counting an expansion of a line, and doctor's Lookups line saying so.
 *
 * Hermetic: every test opens a fresh temp dir and removes it; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { lookupFindings } from "../src/adapters/claude-code/doctor.js";
import { episodeGate } from "../src/core/bridge.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { McpServer } from "../src/adapters/mcp/server.js";
import type { ScopeVerdict } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";
import { WAKE_INJECTED_EVENT } from "../src/core/counterpart.js";
import { lineOf, readIndex } from "../src/core/fit/index.js";
import { FRAMING, SELF_TUNABLES, Self, compose, readSentinel, render } from "../src/core/self/index.js";
import type { Ranked, Resolve, Resolved } from "../src/core/self/index.js";
import type { LaneName } from "../src/core/self/identity.js";
import { Store } from "../src/core/store/index.js";
import { localDate } from "../src/core/time.js";

const ZONE = "UTC";
const BUDGET = 9_000;
const T0 = Date.parse("2026-10-14T08:00:00Z");

let root: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-lines-")));
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

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");
/** A body of at least `n` bytes, opening with `head`. */
const longBody = (head: string, n = 520): string => {
  let body = head;
  while (bytes(body) < n) body += " The detail goes on, as a real memory's first paragraph does, with the steps and the reasons.";
  return body;
};
/** The listed lines under a heading, up to the next blank line. */
const laneLines = (text: string, heading: string): string[] => {
  const lines = text.split("\n");
  const at = lines.indexOf(heading);
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() === "") break;
    if (l.startsWith("- ")) out.push(l);
  }
  return out;
};
/** A day this year prints short (`Oct 16`, 2026-10-16); any other, whole. */
const DATED = /^- (?:\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2} \d{1,2}) · /;

function freshStore(): Store {
  const s = Store.open({ dir: mkdtempSync(join(root, "s-")) });
  open.push(s);
  return s;
}

function craft(s: Store, body: string, title?: string): string {
  return s.put({ type: "memory", kind: "skill", body, ...(title === undefined ? {} : { title }), salience: { relevance: 1, emotional: 1, predictive: 1 } });
}

function thread(s: Store, body: string, title?: string): string {
  return s.put({ type: "memory", kind: "fact", body, ...(title === undefined ? {} : { title }), meta: { unresolved: true }, salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 } });
}

function hint(s: Store, body: string, title?: string): string {
  return s.put({ type: "memory", kind: "fact", body, ...(title === undefined ? {} : { title }), salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 } });
}

function dated(s: Store, body: string, title?: string): string {
  return s.put({ type: "memory", kind: "person", body, ...(title === undefined ? {} : { title }), salience: { relevance: 0.8, emotional: 0.8, predictive: 0.8 } });
}

/** Store-wide craft, so "How I work" is a lane of the composition. */
const STORE_CRAFT = { CRAFT_AT_DELIVERY: false, CRAFT_IN_WAKE: true } as const;

describe("a long list item is a line: date · title [id]", () => {
  test("past the threshold a titled item is its title and id; under it, whole; the threshold is the tunable", () => {
    const s = freshStore();
    const longId = craft(s, longBody("Draining the hose before a frost: the long account."), "Drain the hose before a frost");
    const shortText = "Label the seed trays the day they are sown.";
    const shortId = craft(s, shortText, "Label the trays");
    // Exactly at the threshold stays whole; one byte past it is a line.
    const edge = "x".repeat(SELF_TUNABLES.WAKE_LINE_BYTES - 10);
    const atId = craft(s, `${edge}${"y".repeat(10)}`, "At the threshold");
    const overId = craft(s, `${edge}${"z".repeat(11)}`, "One byte over");
    const out = new Self({ store: s, tunables: STORE_CRAFT }).build({ budgetBytes: 40_000, day: 0 });
    const lines = laneLines(out.text, FRAMING.craft);
    expect(lines.length).toBe(4);
    for (const l of lines) expect(l).toMatch(DATED);
    expect(lines.some((l) => l.endsWith(` · Drain the hose before a frost [${longId}]`))).toBe(true);
    expect(lines.some((l) => l.endsWith(` · ${shortText}`))).toBe(true);
    expect(lines.some((l) => l.endsWith(`${edge}${"y".repeat(10)}`))).toBe(true);
    expect(lines.some((l) => l.endsWith(` · One byte over [${overId}]`))).toBe(true);
    expect(out.text).not.toContain("Draining the hose before a frost: the long account.");
    expect([...(out.lined ?? [])].sort()).toEqual([longId, overId].sort());
    expect(out.lined).not.toContain(shortId);
    expect(out.lined).not.toContain(atId);
    expect(readSentinel(out.text).intact).toBe(true);

    // A higher threshold keeps the long one whole.
    const roomy = new Self({ store: s, tunables: { ...STORE_CRAFT, WAKE_LINE_BYTES: 10_000 } }).build({ budgetBytes: 40_000, day: 0 });
    expect(roomy.text).toContain("Draining the hose before a frost: the long account.");
    expect(roomy.lined).toEqual([]);
  });

  test("an untitled long item falls back to fit's line — its first line, the cut said with …", () => {
    const s = freshStore();
    const body = longBody("No title on this one: the compost heap by the shed runs warm through the winter, and the long reasons why follow here.");
    const id = craft(s, body);
    const out = new Self({ store: s, tunables: STORE_CRAFT }).build({ budgetBytes: 40_000, day: 0 });
    const [line] = laneLines(out.text, FRAMING.craft);
    const expected = lineOf({ body });
    expect(expected.endsWith("…")).toBe(true);
    expect(line).toMatch(DATED);
    expect(line?.endsWith(` · ${expected} [${id}]`)).toBe(true);
  });

  test("the identity list on a store with no page stays whole", () => {
    const s = freshStore();
    const body = longBody("I say what I do not know before I guess, and here is the long version of that.");
    s.put({ type: "memory", kind: "self", body, title: "Say what I do not know", band: "identity", salience: { relevance: 0.8, emotional: 0.5, predictive: 0.5 }, physics: { promotedIdentity: true } });
    const out = new Self({ store: s }).build({ budgetBytes: 40_000, day: 0 });
    expect(out.page).toBeNull();
    expect(out.counts.identity).toBe(1);
    expect(out.text).toContain(body);
    expect(out.lined).toEqual([]);
  });

  test("a plain reminder due the day the wake is read stays whole; an ordinary dated item is a line", () => {
    const s = freshStore();
    const dueBody = longBody("Remind him today: the seed order closes at noon, and the list is in the green folder.");
    const due = dated(s, dueBody, "Seed order closes at noon");
    const later = dated(s, longBody("The kiln shelves want a second coat of wash before the next firing."), "Kiln shelves want wash");
    const today = localDate(s.now(), s.zone());
    const out = new Self({ store: s }).build({
      budgetBytes: 2_400,
      day: 0,
      horizon: [
        { id: due, due: today, plainDue: true },
        { id: later, due: today },
      ],
    });
    const lines = laneLines(out.text, FRAMING.horizon);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain(dueBody);
    expect(lines[1]?.endsWith(` · Kiln shelves want wash [${later}]`)).toBe(true);
    expect(out.lined).toEqual([later]);
  });

  test("a composition that omits (the background sweep's, read with no recall tool) prints every item whole", () => {
    const s = freshStore();
    const body = longBody("Draining the hose before a frost: the long account.");
    const id = craft(s, body, "Drain the hose before a frost");
    const out = new Self({ store: s, tunables: STORE_CRAFT }).build({ budgetBytes: 40_000, day: 0, omit: () => false });
    expect(out.text).toContain(body);
    expect(out.text).not.toContain(`[${id}]`);
    expect(out.lined).toEqual([]);
  });
});

// ── render-level: the id once, and the first-item upgrade ───────────────────

const rank = (id: string, lane: LaneName, extra: Partial<Ranked> = {}): Ranked => ({
  id,
  lane,
  kind: "fact",
  band: "episodic",
  strength: 0.5,
  protected: false,
  bornDay: 0,
  personScoped: false,
  lastRendered: -1,
  ...extra,
});

const WHOLE = (id: string): string => `The whole of ${id}: ${"what was decided, and why, in the words it was written in. ".repeat(6)}`.trim();

function resolver(extra: Record<string, Partial<Resolved>> = {}): Resolve {
  return (id) => ({ statement: WHOLE(id), learnedOn: "2026-10-01", line: `Title of ${id}`, ...extra[id] });
}

const lanesOf = (k: Partial<Record<LaneName, Ranked[]>>) => ({
  identity: k.identity ?? [],
  craft: k.craft ?? [],
  threads: k.threads ?? [],
  hints: k.hints ?? [],
  horizon: k.horizon ?? [],
});

describe("the id once, and the top items whole on leftover room", () => {
  test("a standing that already names the item's id: the line does not name it again", () => {
    const id = "mem_core0000001";
    const resolve = resolver({ [id]: { standing: { prefix: `Core, being reconsidered — keep or retire it (remember core) [${id}]: `, suffix: "" } } });
    const other = "mem_open0000002";
    // Two items, so the upgrade (first item only) leaves the core's line as a line.
    const lanes = lanesOf({ threads: [rank(other, "threads"), rank(id, "threads")] });
    const out = render(lanes, { budgetBytes: 40_000, day: 0 }, resolve, SELF_TUNABLES);
    const line = laneLines(out.text, FRAMING.threads).find((l) => l.includes(`Title of ${id}`)) ?? "";
    expect(line).toBe(`- 2026-10-01 · Core, being reconsidered — keep or retire it (remember core) [${id}]: Title of ${id}`);
    expect(line.split(`[${id}]`).length - 1).toBe(1);
  });

  test("with room, the first item of Still open and of Coming up is whole, the rest lines; Nearby and craft are not upgraded", () => {
    const resolve = resolver();
    const lanes = lanesOf({
      craft: [rank("c1", "craft")],
      threads: [rank("t1", "threads"), rank("t2", "threads")],
      hints: [rank("n1", "hints")],
      horizon: [rank("h1", "horizon"), rank("h2", "horizon")],
    });
    const out = render(lanes, { budgetBytes: 40_000, day: 0 }, resolve, SELF_TUNABLES);
    expect(laneLines(out.text, FRAMING.threads)).toEqual([`- 2026-10-01 · ${WHOLE("t1")}`, "- 2026-10-01 · Title of t2 [t2]"]);
    expect(laneLines(out.text, FRAMING.horizon)).toEqual([`- 2026-10-01 · ${WHOLE("h1")}`, "- 2026-10-01 · Title of h2 [h2]"]);
    expect(laneLines(out.text, FRAMING.craft)).toEqual(["- 2026-10-01 · Title of c1 [c1]"]);
    expect(laneLines(out.text, FRAMING.hints)).toEqual(["- 2026-10-01 · Title of n1 [n1]"]);
    expect(out.lined).toEqual(["c1", "t2", "n1", "h2"]);
  });

  test("only in leftover room, and in lane order: Still open first, then Coming up; nothing else gives way for it", () => {
    const resolve = resolver();
    const lanes = lanesOf({
      threads: [rank("t1", "threads"), rank("t2", "threads")],
      horizon: [rank("h1", "horizon"), rank("h2", "horizon")],
    });
    const asLines = compose(lanes, 0, resolve).bytes;
    const extra = bytes(WHOLE("t1")) - bytes("Title of t1 [t1]");
    // No room past the lines: nothing upgraded, and nothing dropped either.
    const tight = render(lanes, { budgetBytes: asLines + 10, day: 0 }, resolve, SELF_TUNABLES);
    expect(tight.lined).toEqual(["t1", "t2", "h1", "h2"]);
    expect(tight.more).toEqual({});
    // Room for one: Still open's first item, not Coming up's.
    const one = render(lanes, { budgetBytes: asLines + extra + 20, day: 0 }, resolve, SELF_TUNABLES);
    expect(one.lined).toEqual(["t2", "h1", "h2"]);
    expect(one.bytes).toBeLessThanOrEqual(asLines + extra + 20);
    expect(one.more).toEqual({});
    // Room for both.
    const both = render(lanes, { budgetBytes: asLines + 2 * extra + 40, day: 0 }, resolve, SELF_TUNABLES);
    expect(both.lined).toEqual(["t2", "h2"]);
  });

  test("an upgrade never costs a lane its count", () => {
    const resolve = resolver();
    const lanes = { ...lanesOf({ threads: [rank("t1", "threads")] }), overflow: { threads: ["t2", "t3"] } };
    const counted = render(lanes, { budgetBytes: 40_000, day: 0 }, resolve, SELF_TUNABLES);
    expect(counted.more).toEqual({ threads: 2 });
    expect(counted.lined).toEqual([]);
    // Room for the line and its count, not for the whole item beside the count.
    const lines = render(lanes, { budgetBytes: counted.bytes - 20, day: 0 }, resolve, SELF_TUNABLES);
    expect(lines.more).toEqual({ threads: 2 });
    expect(lines.lined).toEqual(["t1"]);
  });
});

// ── production scale ────────────────────────────────────────────────────────

describe("at production scale (the 2026-10-15 measurement's shape)", () => {
  test("9,000 bytes, a page at its room, 3 craft, 25 open, 8 warm, 2 dated — all ~550-byte titled items: the page whole and ten or more lane elements", () => {
    const s = freshStore();
    const self = new Self({ store: s, gate: episodeGate(), tunables: STORE_CRAFT });
    const para = "I keep the garden's ledger, I name what I do not know before I guess, and I write down what held.";
    let page = "## Core\n\n";
    while (bytes(page) < 5_681 - bytes(para) - 2) page += `${para}\n\n`;
    expect(self.revisePage(page.trim(), { by: "owner", reason: "a long page" }).written).toBe(true);
    for (let i = 0; i < 3; i += 1) craft(s, longBody(`Craft ${String(i)}: how the beds are turned.`, 550), `How bed ${String(i)} is turned`);
    for (let i = 0; i < 25; i += 1) thread(s, longBody(`Open ${String(i)}: whether bed ${String(i)} wants lime.`, 550), `Does bed ${String(i)} want lime?`);
    for (let i = 0; i < 8; i += 1) hint(s, longBody(`Warm ${String(i)}: the compost heap ${String(i)} runs warm.`, 550), `Compost heap ${String(i)} runs warm`);
    const d1 = dated(s, longBody("The clay order arrives; check the invoice against the slip.", 550), "Clay order arrives");
    const d2 = dated(s, longBody("The glaze supplier calls back about the cobalt.", 550), "Glaze supplier calls back");
    const today = localDate(s.now(), s.zone());
    const out = self.build({ budgetBytes: BUDGET, day: 0, horizon: [{ id: d1, due: today }, { id: d2, due: today }] });
    expect(readSentinel(out.text).intact).toBe(true);
    expect(out.bytes).toBeLessThanOrEqual(BUDGET);
    expect(out.page?.rung).toBe("whole");
    expect(out.text).toContain(page.trim());
    const lanes = out.counts.craft + out.counts.threads + out.counts.hints + out.counts.horizon;
    expect(lanes).toBeGreaterThanOrEqual(10);
    expect(out.counts.horizon).toBe(2);
    // Nothing dropped without a word.
    expect(out.untold).toEqual({});
    // The same composition with whole items only (the habit before #489 C).
    const before = new Self({ store: s, gate: episodeGate(), tunables: { ...STORE_CRAFT, WAKE_LINE_BYTES: Number.POSITIVE_INFINITY } }).build({ budgetBytes: BUDGET, day: 0, horizon: [{ id: d1, due: today }, { id: d2, due: today }] });
    const was = before.counts.craft + before.counts.threads + before.counts.hints + before.counts.horizon;
    expect(lanes).toBeGreaterThan(was);
  });
});

// ── the lookup ledger ───────────────────────────────────────────────────────

describe("the wake's lines join the lookup ledger", () => {
  test("a session start writes fit.index.wake with the ids it listed as lines; recall counts an expansion; doctor says so", async () => {
    const storeDir = join(root, "store");
    const HERE = join(root, "garden");
    mkdirSync(HERE, { recursive: true });
    let now = T0;
    const c = Counterpart.open({ dir: storeDir, owner: true, budgetBytes: BUDGET, now: () => now, timeZone: ZONE });
    open.push(c);
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) ids.push(c.store.put({ type: "memory", kind: "fact", title: `Does bed ${String(i)} want lime?`, body: longBody(`Open ${String(i)}: whether bed ${String(i)} wants lime this autumn.`), meta: { unresolved: true }, salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 } }));
    const day = localDate(now, ZONE);
    expect(c.rebrief({ budgetBytes: BUDGET, at: day }).published).toBe(true);
    now += 60_000;
    const hooks = new ClaudeCodeAdapter({
      counterpart: c,
      config: { dataDir: storeDir, owner: true, injectionBudgetBytes: BUDGET, timeZone: ZONE },
      configPath: join(root, "claude-code.json"),
      now: () => now,
      scope: { mode: "on", matched: HERE, entry: null } as ScopeVerdict,
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 4242 }),
    });
    const session = "b5b6b7b8-0000-4000-8000-00000000000b";
    const injection = hooks.sessionStart({ sessionId: session, scope: HERE, at: day, transcriptPath: join(root, `${session}.jsonl`) } as HookInput).injection;
    const index = readIndex(c.store, "wake");
    expect(index?.ref).toBe(`wake:${session}`);
    const lined = index?.offered.line ?? [];
    expect(lined.length).toBeGreaterThan(0);
    for (const id of lined) expect(injection).toContain(`[${id}]`);
    const row = c.store.eventLog({ name: WAKE_INJECTED_EVENT, order: "desc", limit: 1 })[0];
    expect(JSON.parse(row?.payload ?? "{}")).toMatchObject({ lined: lined.length });

    now += 60_000;
    const server = new McpServer({ counterpart: c, session, scope: HERE, owner: true, now: () => now });
    const first = lined[0] ?? "";
    const r = await server.call("recall", { ids: [first] });
    expect(r.isError ?? false).toBe(false);
    const recall = c.store.eventLog({ name: "mcp.recall", order: "desc", limit: 1 })[0];
    expect(JSON.parse(recall?.payload ?? "{}").fromIndex).toEqual({ wake: 1 });
    const [f] = lookupFindings(c.store);
    expect(f?.detail).toContain(`wake: 1 looked up of ${String(lined.length)} offered in part, over 1 session start`);
    expect(f?.data).toMatchObject({ wakeOffered: lined.length, wakeLooked: 1, wakes: 1 });
  });
});

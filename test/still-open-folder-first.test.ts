/**
 * O2 (roadmap 10-26; Mike agreed 08:44, lightly held): "Still open", this
 * folder's first — through the real doors, the SessionStart render
 * (`ClaudeCodeAdapter#sessionStart`) and the MCP `recall` handle
 * `still open`:
 *
 *   1. this folder's open threads (and its joined project folders') lead;
 *   2. personal ones — about me, us or the owner, wherever written — follow;
 *   3. another folder's WORK is in neither, as "Work here" keeps it (Mike's
 *      10-20 direction), and the tail counts only what could show here.
 *
 * Within each group the order is today's (`byThreadLive`). A thread with no
 * folder recorded (from before folders, or a host with no directory) has no
 * folder to be another's work in, so it is shown with the personal ones.
 * A folder turned off later keeps what it shared before (Mike, 2026-10-26:
 * as it is today), so its personal threads still show; a joined folder set
 * off is no longer "here", so its work leaves with it.
 *
 * Hermetic: every store is a temp dir made and removed here; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeCodeAdapter } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { scopesPath, setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeRegistry, ScopeVerdict } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";
import { FRAMING, SELF_TUNABLES, countedLanes } from "../src/core/self/index.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ZONE = "UTC";
const BUDGET = 9_000;
const D2 = "2026-10-25";
const at = (ymd: string, h: number, m = 0): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR + m * MIN;

const S = "5e550000-0000-4000-8000-0000000000a2";

let root: string;
let storeDir: string;
let config: string;
let HERE: string;
let THERE: string;
let SITE: string;
let QUIET: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-open-first-")));
  config = join(root, "claude-code.json");
  HERE = join(root, "garden");
  THERE = join(root, "workshop");
  SITE = join(root, "garden-site");
  QUIET = join(root, "ledger");
  for (const d of [HERE, THERE, SITE, QUIET]) mkdirSync(d, { recursive: true });
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

interface World {
  c: Counterpart;
  set(t: number): void;
  now(): number;
  today(): string;
}

let worlds = 0;
function world(start: number, budget = BUDGET): World {
  storeDir = join(root, `store-${String((worlds += 1))}`);
  let now = start - 15 * HOUR;
  const c = Counterpart.open({ dir: storeDir, budgetBytes: budget, now: () => now, timeZone: ZONE });
  open.push(c);
  c.rebrief({ budgetBytes: budget, at: new Date(now).toISOString().slice(0, 10) });
  now = start;
  return { c, set: (t) => void (now = t), now: () => now, today: () => new Date(now).toISOString().slice(0, 10) };
}

function toDay(w: World, n: number): void {
  while (w.c.store.livedDay() < n) {
    w.set(w.now() + DAY);
    w.c.store.advanceClock(w.today());
  }
}

/** The folder settings file the hooks and the server both read. */
function folders(registry: ScopeRegistry | null): void {
  if (registry !== null) writeScopes(scopesPath(config), registry);
}

/** The wake SessionStart delivers to a session in `dir`, now. */
function wake(w: World, dir = HERE, budget = BUDGET): string {
  const verdict = { mode: "on", matched: dir, entry: null } as ScopeVerdict;
  const a = new ClaudeCodeAdapter({
    counterpart: w.c,
    config: { dataDir: storeDir, injectionBudgetBytes: budget },
    configPath: config,
    now: () => w.now(),
    scope: verdict,
    command: "/bin/true",
    args: ["runner"],
    spawner: () => ({ pid: 4242 }),
  });
  const text = a.sessionStart({ sessionId: S, scope: dir, at: w.today(), source: "startup" } as HookInput).injection;
  expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(budget + 200);
  return text;
}

/** The recall tool bound to this session in `dir`, reading the same folder settings. */
function tools(w: World, dir = HERE): McpServer {
  return new McpServer({ counterpart: w.c, session: S, scope: dir, now: () => w.now(), scopesFile: scopesPath(config) });
}

type Item = { id: string; title: string };
async function handle(s: McpServer): Promise<{ items: Item[]; total: number; notCarried: number }> {
  const r = (await s.call("recall", { handle: "still open" })).structuredContent;
  return { items: r["items"] as Item[], total: r["total"] as number, notCarried: (r["notCarried"] as number | undefined) ?? 0 };
}

function lane(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i] !== ""; i++) out.push(lines[i] ?? "");
  return out;
}
const listed = (text: string): string[] => lane(text, FRAMING.threads).filter((l) => l.startsWith("- "));
const tailCount = (text: string): number => countedLanes(lane(text, FRAMING.threads).at(-1) ?? "").threads ?? 0;
/** The tag each listed line starts its title with (`HERE-1`, `OWNER`, …). */
const tags = (lines: readonly string[]): string[] => lines.map((l) => /([A-Z]+(?:-[A-Z0-9]+)*) /.exec(l)?.[1] ?? "?");

const SAL = { relevance: 0.9, emotional: 0.6, predictive: 0.7 } as const;
/** An open thread written in `folder` (null: no folder recorded), marked `about` (null: unmarked). */
function openIn(w: World, folder: string | null, title: string, about: "work" | "owner" | "us" | "me" | null = "work"): string {
  return w.c.store.put({
    type: "memory",
    kind: "fact",
    title,
    body: `${title} The detail of it.`,
    meta: { unresolved: true },
    ...(about === null ? {} : { about }),
    ...(folder === null ? {} : { origin: { scope: folder } }),
    salience: SAL,
  });
}

/**
 * THE REALISTIC FIXTURE: random-cc's 0.3.37 wake, in placeholder words. The
 * newest touched is a personal tax question asked in another folder; this
 * folder has older work of its own; another folder has fresher work.
 */
function fixture(w: World): void {
  toDay(w, 2);
  openIn(w, HERE, "HERE-1 does the trellis need another post?");
  openIn(w, HERE, "HERE-2 is the drip line's timer on the right circuit?");
  toDay(w, 3);
  openIn(w, THERE, "THERE-1 does the lathe belt need a spare?");
  openIn(w, THERE, "THERE-2 is the bandsaw blade the right pitch?");
  openIn(w, null, "LEGACY did the seed catalogue come?", null);
  toDay(w, 4);
  openIn(w, THERE, "OWNER does the accountant want the booking-system export before the filing?", "owner");
  openIn(w, THERE, "US are we still taking the long walk on Saturday?", "us");
  w.c.rebrief({ budgetBytes: BUDGET, at: w.today() });
}

// ═══════════════════════════════════════════════════════════════════════════
describe("O2. Still open: this folder's first, personal after, other folders' work not at all", () => {
  test("the wake and the handle: order, exclusion and the same list", async () => {
    const w = world(at(D2, 9));
    fixture(w);
    const text = wake(w);
    const shown = listed(text);
    // This folder's, then personal (and the folderless) in today's order,
    // then nothing from the workshop's work.
    expect(new Set(tags(shown).slice(0, 2))).toEqual(new Set(["HERE-1", "HERE-2"]));
    expect(tags(shown).slice(2)).toEqual(["OWNER", "US", "LEGACY"].slice(0, shown.length - 2));
    expect(text).not.toContain("THERE-");
    const got = await handle(tools(w));
    const order = tags(got.items.map((i) => `${i.title} `));
    expect(new Set(order.slice(0, 2))).toEqual(new Set(["HERE-1", "HERE-2"]));
    expect(order.slice(2)).toEqual(["OWNER", "US", "LEGACY"]);
    // The same order as the wake's listed lines.
    expect(order.slice(0, shown.length)).toEqual(tags(shown));
    expect(JSON.stringify(got)).not.toContain("THERE-");
    expect(got.total).toBe(5);
    expect(shown.length + tailCount(text)).toBe(got.total);
    // The workshop's own wake: everything written there first (the personal
    // two were written there too, and are newest), the folderless one after,
    // ours gone.
    const theirs = tags(listed(wake(w, THERE)));
    expect(theirs).toEqual(["OWNER", "US", ...theirs.slice(2, 4), "LEGACY"]);
    expect(new Set(theirs.slice(2, 4))).toEqual(new Set(["THERE-1", "THERE-2"]));
    const there = tags((await handle(tools(w, THERE))).items.map((i) => `${i.title} `));
    expect(there).toEqual(theirs);
  });

  test("marked me and unmarked-but-personal kinds follow this folder's too; an unmarked fact from another folder is its work", async () => {
    const w = world(at(D2, 9));
    toDay(w, 2);
    openIn(w, HERE, "HERE-1 does the trellis need another post?");
    toDay(w, 3);
    openIn(w, THERE, "ME am I still keeping the ledger the old way?", "me");
    openIn(w, THERE, "UNMARKED does the lathe want new oil?", null);
    w.c.store.put({ type: "memory", kind: "person", title: "PERSON is the neighbour back from the coast?", body: "PERSON is the neighbour back from the coast? The detail.", meta: { unresolved: true }, origin: { scope: THERE }, salience: SAL });
    w.c.rebrief({ budgetBytes: BUDGET, at: w.today() });
    const text = wake(w);
    expect(tags(listed(text))[0]).toBe("HERE-1");
    expect(new Set(tags(listed(text)).slice(1))).toEqual(new Set(["ME", "PERSON"]));
    expect(text).not.toContain("UNMARKED");
    expect(JSON.stringify(await handle(tools(w)))).not.toContain("UNMARKED");
  });

  test("no folder recorded: shown after this folder's, marked work or not — there is no folder it could be another's work in", async () => {
    const w = world(at(D2, 9));
    toDay(w, 2);
    openIn(w, HERE, "HERE-1 does the trellis need another post?");
    toDay(w, 3);
    openIn(w, null, "LEGACY-WORK is the old greenhouse plan still the plan?", "work");
    openIn(w, null, "LEGACY-PLAIN did the seed catalogue come?", null);
    w.c.rebrief({ budgetBytes: BUDGET, at: w.today() });
    const text = wake(w);
    expect(tags(listed(text))[0]).toBe("HERE-1");
    expect(new Set(tags(listed(text)).slice(1))).toEqual(new Set(["LEGACY-WORK", "LEGACY-PLAIN"]));
    const got = await handle(tools(w));
    expect(got.items[0]?.title).toStartWith("HERE-1");
    expect(got.total).toBe(3);
  });

  test("a joined folder's work is here; set off, it leaves with the folder — and an off folder's personal thread still shows (shared before, kept)", async () => {
    const w = world(at(D2, 9));
    toDay(w, 2);
    expect(w.c.joinProject({ folder: SITE, project: HERE, by: "owner" }).ok).toBe(true);
    openIn(w, HERE, "HERE-1 does the trellis need another post?");
    toDay(w, 3);
    openIn(w, SITE, "SITE-1 does the plant list page need the new photos?");
    openIn(w, QUIET, "QUIETOWNER is the ledger's year-end box still in the attic?", "owner");
    openIn(w, QUIET, "QUIETWORK does the ledger export want a new column?");
    w.c.rebrief({ budgetBytes: BUDGET, at: w.today() });

    folders(setScope(null, QUIET, "off", { at: D2 }));
    const on = wake(w);
    // Both of the project's folders lead (newest touched first), then the personal one.
    expect(tags(listed(on))).toEqual(["SITE-1", "HERE-1", "QUIETOWNER"]);
    expect(on).not.toContain("QUIETWORK");
    expect(tags((await handle(tools(w))).items.map((i) => `${i.title} `))).toEqual(["SITE-1", "HERE-1", "QUIETOWNER"]);

    folders(setScope(setScope(null, QUIET, "off", { at: D2 }), SITE, "off", { at: D2 }));
    const off = wake(w);
    expect(tags(listed(off))).toEqual(["HERE-1", "QUIETOWNER"]);
    expect(off).not.toContain("SITE-1");
    const got = await handle(tools(w));
    expect(tags(got.items.map((i) => `${i.title} `))).toEqual(["HERE-1", "QUIETOWNER"]);
    expect(JSON.stringify(got)).not.toContain("SITE-1");
  });

  test("the tail counts only what could show here, and the handle's not-carried count too", async () => {
    const w = world(at(D2, 9));
    toDay(w, 2);
    // Old ones, left untouched past the carry: two of ours, five of the workshop's work.
    for (let i = 0; i < 2; i += 1) openIn(w, HERE, `HEREOLD-${String(i)} is the old fence line right?`);
    for (let i = 0; i < 5; i += 1) openIn(w, THERE, `THEREOLD-${String(i)} is the old jig still square?`);
    toDay(w, 2 + SELF_TUNABLES.OPEN_CARRY_DAYS + 1);
    for (let i = 0; i < 7; i += 1) openIn(w, HERE, `HERE-${String(i)} does bed ${String(i)} want lime?`);
    for (let i = 0; i < 9; i += 1) openIn(w, THERE, `THERE-${String(i)} does jig ${String(i)} need a stop?`);
    openIn(w, THERE, "OWNER does the accountant want the export?", "owner");
    w.c.rebrief({ budgetBytes: BUDGET, at: w.today() });
    const text = wake(w);
    const shown = listed(text);
    expect(shown.length).toBe(SELF_TUNABLES.THREADS_MAX);
    expect(text).not.toContain("THERE-");
    // 7 of ours and 1 personal could show; the rest of those 8 is the tail.
    expect(tailCount(text)).toBe(8 - shown.length);
    const got = await handle(tools(w));
    expect(got.total).toBe(8);
    expect(got.items.at(-1)?.title).toStartWith("OWNER");
    // Not carried: our two old ones, not the workshop's five.
    expect(got.notCarried).toBe(2);
  });

  test("a tight wake keeps this folder's first item, not the personal one", () => {
    const w = world(at(D2, 9), 2_000);
    toDay(w, 2);
    openIn(w, HERE, "HERE-1 does the trellis need another post?");
    toDay(w, 3);
    for (let i = 0; i < 6; i += 1) openIn(w, THERE, `OWNER-${String(i)} does the accountant want form ${String(i)}?`, "owner");
    let kept = 0;
    for (let budget = 1_600; budget <= 3_000; budget += 200) {
      // Published at this ceiling, so the session start assembles (a bundle
      // for another ceiling is delivered as published: self INTERFACE-GAPS).
      w.c.rebrief({ budgetBytes: budget, at: w.today() });
      const text = wake(w, HERE, budget);
      const first = listed(text)[0];
      if (first === undefined) continue;
      expect(first, String(budget)).toContain("HERE-1");
      kept += 1;
    }
    expect(kept).toBeGreaterThan(0);
  });
});

/**
 * THE PUBLISHED BUNDLE'S "MIGHT BE RELEVANT" ON THE FALLBACK ROAD (P1,
 * 2026-10-25; a release blocker for 0.3.37). The review of Y2 (96f90bbc)
 * kept a chapter's summary from a folder set off, paused or to observe out of
 * another folder's SessionStart wake — on the ASSEMBLED road
 * (`Self#assemble`'s `hintKeptOut`). A start that cannot assemble delivers
 * the published bundle as it is: a bundle an older build published (no
 * record beside it), a host on another ceiling, no date, or a damaged bundle.
 * That road listed the summary still. Now it takes the same read
 * (`Self#wake`'s `hintKeptOut`, `briefing-delivery.ts#hintsForReader`).
 *
 * Every state is built on purpose and every wake is the one the real door
 * hands: `ClaudeCodeAdapter#sessionStart` (the CLI install, the plugin and
 * Desktop's Code tab), and the MCP `wake` tool (Desktop chat). The chapters
 * are written through the real `chapter` tool; the host's scopes file says
 * which folders are off.
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
import { DESKTOP_HOST } from "../src/adapters/hosts.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeMode, ScopeVerdict } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";
import { BRIEFING_KEY, WAKE_SHOWN_KEY, hintsForReader, readSentinel } from "../src/core/self/index.js";

const HOUR = 3_600_000;
const BUDGET = 9_000;
/** Another host's ceiling: the published record names BUDGET, so this cannot assemble. */
const OTHER = 9_400;
const D0 = "2026-10-22";
const D2 = "2026-10-24";
const at = (ymd: string, h: number): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR;

const S1 = "c9c9c9c9-0000-4000-8000-000000000001";
const S2 = "c9c9c9c9-0000-4000-8000-000000000002";
const S3 = "c9c9c9c9-0000-4000-8000-000000000003";
const READER = "d0d0d0d0-0000-4000-8000-00000000000f";

const CHAPTER =
  "We spent the morning on the broad beans: two rows by the fence, netted against the pigeons, the spare seed kept dry in the shed for a second sowing in three weeks.";

const OWN = "Sowing the broad beans";
const OFF = "The winter oven schedule";
const ON = "Fencing the lower paddock";

let root: string;
let storeDir: string;
let config: string;
let HERE: string;
let BAKERY: string;
let FARM: string;
let clock = at(D0, 7);
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-p1-")));
  storeDir = join(root, "store");
  config = join(root, "claude-code.json");
  HERE = join(root, "garden");
  BAKERY = join(root, "bakery");
  FARM = join(root, "farm");
  for (const d of [HERE, BAKERY, FARM]) mkdirSync(d, { recursive: true });
  clock = at(D0, 7);
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

function brain(): Counterpart {
  const c = Counterpart.open({ dir: storeDir, snapshotsDir: join(root, "snaps"), budgetBytes: BUDGET, now: () => clock, timeZone: "UTC" });
  open.push(c);
  return c;
}

/** A chapter written through the real `chapter` tool in `scope`; its summary's memory id. */
async function chapterVia(o: { session: string; scope: string; hour: number; title: string }): Promise<string> {
  clock = at(D0, o.hour);
  const c = brain();
  const s = new McpServer({ counterpart: c, session: o.session, scope: o.scope, registryDir: join(root, "registry"), now: () => clock });
  const out = (await s.call("chapter", { text: CHAPTER, title: o.title, summary: `${o.title}, done.` })).structuredContent;
  const summary = c.store.list({ type: "memory", source: "episode", originRef: String(out["episodeId"]), archived: false })[0] as string;
  c.close();
  open.splice(open.indexOf(c), 1);
  return summary;
}

/** Three folders' chapters: HERE's own, BAKERY's (set off below), FARM's (on). */
async function threeFolders(): Promise<{ own: string; off: string; on: string }> {
  const own = await chapterVia({ session: S1, scope: HERE, hour: 8, title: OWN });
  const off = await chapterVia({ session: S2, scope: BAKERY, hour: 10, title: OFF });
  const on = await chapterVia({ session: S3, scope: FARM, hour: 12, title: ON });
  return { own, off, on };
}

function scopes(modes: Readonly<Record<string, ScopeMode>>): void {
  let reg = null;
  for (const [dir, mode] of Object.entries(modes)) reg = setScope(reg, dir, mode, { at: D0 });
  if (reg !== null) writeScopes(join(root, "scopes.json"), reg);
}

/** Publish at the turn-end's ceiling (BUDGET), for D2. */
function publish(c: Counterpart): string {
  clock = at(D2, 8);
  c.rebrief({ budgetBytes: BUDGET, at: D2 });
  return c.store.getMeta(BRIEFING_KEY) ?? "";
}

/** The wake SessionStart hands a session opening in HERE on D2, under `budget`. */
function sessionStart(c: Counterpart, budget: number, o: { configPath?: string | null; at?: string } = {}): { text: string; ok: boolean } {
  clock = at(D2, 9);
  const adapter = new ClaudeCodeAdapter({
    counterpart: c,
    config: { dataDir: storeDir, injectionBudgetBytes: budget },
    ...(o.configPath === null ? {} : { configPath: o.configPath ?? config }),
    now: () => clock,
    scope: { mode: "on", matched: HERE, entry: null } as ScopeVerdict,
    command: "/bin/true",
    args: ["runner"],
    spawner: () => ({ pid: 4242 }),
  });
  const input = { sessionId: READER, scope: HERE, ...(o.at === null ? {} : { at: o.at ?? D2 }) } as HookInput;
  const out = adapter.sessionStart(input);
  return { text: out.injection, ok: out.ok };
}

/** The wake block itself, from its opening comment to its sentinel. */
const block = (wake: string): string => {
  const i = wake.indexOf("<!-- counterparts:wake ");
  const end = wake.indexOf("-->", wake.indexOf("<!-- counterparts:wake/end", i));
  return wake.slice(i, end + 3);
};

const nearby = (wake: string): string => {
  const i = wake.lastIndexOf("\nMight be relevant:");
  if (i < 0) return "";
  const j = wake.indexOf("\n\n", i + 1);
  return wake.slice(i + 1, j < 0 ? undefined : j);
};

/** Did this start deliver the published bundle (no assembly)? */
const fellBack = (c: Counterpart): boolean => c.events("counterpart.wake.assembled").length === 0;

describe("SessionStart delivering the published bundle: another folder's chapter summary by its scope setting", () => {
  test("another host's ceiling: off, paused or observer left out; on and this folder's own still listed; the block still states its own truth", async () => {
    const { off } = await threeFolders();
    const c = brain();
    scopes({ [HERE]: "on", [BAKERY]: "on", [FARM]: "on" });
    const published = publish(c);
    // The state on purpose: all three listed in the published bundle.
    expect(published).toContain(`${OFF}, done.`);
    expect(published).toContain(`${ON}, done.`);
    expect(published).toContain(`${OWN}, done.`);
    const all = sessionStart(c, OTHER);
    expect(fellBack(c)).toBe(true);
    expect(nearby(all.text)).toContain(`${OFF}, done.`);
    for (const mode of ["off", "paused", "observer"] as const) {
      scopes({ [HERE]: "on", [BAKERY]: mode, [FARM]: "on" });
      const before = c.events("counterpart.wake.assembled").length;
      const wake = sessionStart(c, OTHER);
      expect(c.events("counterpart.wake.assembled").length).toBe(before);
      expect(wake.ok).toBe(true);
      expect(wake.text).not.toContain(`${OFF}, done.`);
      expect(wake.text).not.toContain(off);
      expect(nearby(wake.text)).toContain(`${ON}, done.`);
      expect(nearby(wake.text)).toContain(`${OWN}, done.`);
      expect(readSentinel(block(wake.text)).intact).toBe(true);
    }
    // The sentinel's counts tell one listed line fewer than the published.
    const hints = (t: string): number => Number(/counterparts:wake\/end .*\bhints=(\d+)/.exec(t)?.[1]);
    expect(hints(block(sessionStart(c, OTHER).text))).toBe(hints(published) - 1);
    const told = c.self.events("self.wake").filter((e) => e.data?.["hintsKeptOut"] !== undefined);
    expect(told.length).toBeGreaterThan(0);
  });

  test("no scope setting to read (no config): every other folder's chapter summary left out, this folder's own kept", async () => {
    const { off, on } = await threeFolders();
    const c = brain();
    publish(c);
    const wake = sessionStart(c, OTHER, { configPath: null });
    expect(fellBack(c)).toBe(true);
    for (const id of [off, on]) expect(wake.text).not.toContain(id);
    expect(wake.text).not.toContain(`${OFF}, done.`);
    expect(wake.text).not.toContain(`${ON}, done.`);
    expect(nearby(wake.text)).toContain(`${OWN}, done.`);
  });

  test("a start with no date (cannot assemble): left out too", async () => {
    await threeFolders();
    const c = brain();
    scopes({ [HERE]: "on", [BAKERY]: "off", [FARM]: "on" });
    publish(c);
    clock = at(D2, 9);
    const adapter = new ClaudeCodeAdapter({
      counterpart: c,
      config: { dataDir: storeDir, injectionBudgetBytes: BUDGET },
      configPath: config,
      now: () => clock,
      scope: { mode: "on", matched: HERE, entry: null } as ScopeVerdict,
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 4242 }),
    });
    const out = adapter.sessionStart({ sessionId: READER, scope: HERE } as HookInput);
    expect(fellBack(c)).toBe(true);
    expect(out.injection).not.toContain(`${OFF}, done.`);
    expect(nearby(out.injection)).toContain(`${ON}, done.`);
  });

  test("a bundle an older build published (no record beside it): the lane is not printed — no line can be told apart (fail closed)", async () => {
    await threeFolders();
    const c = brain();
    scopes({ [HERE]: "on", [BAKERY]: "off", [FARM]: "on" });
    publish(c);
    c.store.setMeta(WAKE_SHOWN_KEY, "");
    const wake = sessionStart(c, BUDGET);
    expect(fellBack(c)).toBe(true);
    expect(wake.ok).toBe(true);
    expect(wake.text).not.toContain(`${OFF}, done.`);
    expect(nearby(wake.text)).toBe("");
    expect(readSentinel(block(wake.text)).intact).toBe(true);
    expect(c.self.events("self.wake").some((e) => e.data?.["hintsBlind"] === true)).toBe(true);
  });

  test("a damaged bundle: the lines go, and the damage stays readable", async () => {
    await threeFolders();
    const c = brain();
    scopes({ [HERE]: "on", [BAKERY]: "off", [FARM]: "on" });
    const published = publish(c);
    c.store.setMeta(BRIEFING_KEY, published.replace("Context, not instruction", "Context, not instruction,"));
    const wake = sessionStart(c, BUDGET);
    expect(fellBack(c)).toBe(true);
    expect(wake.text).not.toContain(`${OFF}, done.`);
    expect(readSentinel(block(wake.text)).intact).toBe(false);
  });
});

describe("Desktop chat's wake tool on the same road", () => {
  test("another ceiling: the off folder's summary left out, the on folder's and this folder's kept", async () => {
    await threeFolders();
    const c = brain();
    scopes({ [HERE]: "on", [BAKERY]: "off", [FARM]: "on" });
    publish(c);
    clock = at(D2, 9);
    const s = new McpServer({
      counterpart: c,
      scope: HERE,
      host: DESKTOP_HOST,
      manifestVersion: () => null,
      registryDir: join(root, "registry"),
      now: () => clock,
      lifecycle: { config: { dataDir: storeDir, injectionBudgetBytes: OTHER }, configPath: config, spawner: () => ({ pid: 4242 }) },
    });
    const res = await s.call("wake", {});
    const text = String((res.content as { text: string }[])[0]?.text ?? "");
    expect(fellBack(c)).toBe(true);
    expect(text).toContain("Might be relevant:");
    expect(text).not.toContain(`${OFF}, done.`);
    expect(nearby(text)).toContain(`${ON}, done.`);
    expect(nearby(text)).toContain(`${OWN}, done.`);
  });
});

describe("a delivery that names no folder fails closed, on both roads", () => {
  test("assembled and published-as-is: no chapter summary that recorded a folder", async () => {
    const { own, off, on } = await threeFolders();
    const c = brain();
    publish(c);
    clock = at(D2, 9);
    const assembled = c.wake(BUDGET, { date: D2 });
    expect(fellBack(c)).toBe(false);
    const asIs = c.wake(OTHER, { date: D2 });
    for (const w of [assembled.text, asIs.text]) for (const id of [own, off, on]) expect(w).not.toContain(id);
    for (const w of [assembled.text, asIs.text]) for (const t of [OWN, OFF, ON]) expect(w).not.toContain(`${t}, done.`);
    // Not a delivery (the owner's dashboard reads it so): the published bundle untouched.
    expect(c.wake(OTHER).text).toContain(`${OFF}, done.`);
  });
});

describe("hintsForReader: every shape of the lane's lines", () => {
  const wrap = (body: string[]): string =>
    ["<!-- counterparts:wake elements=3 bytes=0 -->", "Context.", ...body, "", "<!-- counterparts:wake/end day=1 identity=0 craft=0 threads=0 hints=3 horizon=0 elements=3 bytes=0 -->"].join("\n");
  const no = (ids: readonly string[]) => (id: string): boolean => ids.includes(id);

  test("a listed line by the record's order; the count line told one less", () => {
    const t = wrap(["", "Might be relevant:", "- Oct 1 · a [mem_x]", "- Oct 2 · b", "- Oct 3 · c", "(3 more might be relevant; recall ids: mem_d, mem_e, mem_f)"]);
    const r = hintsForReader(t, ["mem_a", "mem_b", "mem_c"], no(["mem_b", "mem_e"]));
    expect(r.text).toContain("- Oct 1 · a [mem_x]");
    expect(r.text).not.toContain("· b");
    expect(r.text).toContain("(2 more might be relevant; recall ids: mem_d, mem_f)");
    expect(r.lines).toBe(1);
    expect(r.ids).toBe(1);
  });

  test("every listed line kept out: the count becomes the lane's collapsed line; with no count, no lane", () => {
    const t = wrap(["", "Might be relevant:", "- a", "(7 more might be relevant; recall ids (the first 5): mem_d, mem_e, mem_f, mem_g, mem_h)"]);
    const r = hintsForReader(t, ["mem_a"], no(["mem_a", "mem_d"]));
    expect(r.text).toContain("Might be relevant: 6 — no room to list them in this wake; recall ids (the first 4): mem_e, mem_f, mem_g, mem_h");
    expect(r.text).not.toContain("\n- a");
    const bare = hintsForReader(wrap(["", "Might be relevant:", "- a"]), ["mem_a"], no(["mem_a"]));
    expect(bare.text).not.toContain("Might be relevant");
    expect(bare.text.split("\n").filter((l) => l === "").length).toBe(1);
  });

  test("the collapsed line and the folded part name fewer; a part naming only kept-out ids goes", () => {
    const collapsed = wrap(["", "Might be relevant: 2 — no room to list them in this wake; recall ids: mem_a, mem_b"]);
    expect(hintsForReader(collapsed, [], no(["mem_a"])).text).toContain("Might be relevant: 1 — no room to list them in this wake; recall ids: mem_b");
    expect(hintsForReader(collapsed, [], no(["mem_a", "mem_b"])).text).not.toContain("Might be relevant");
    const folded = wrap(["", "More than this wake lists: 2 coming up (recall ids: mem_h, mem_i); 5 might be relevant (recall ids: mem_a, mem_b, mem_c, and 2 more)"]);
    expect(hintsForReader(folded, [], no(["mem_b"])).text).toContain("; 4 might be relevant (recall ids: mem_a, mem_c, and 2 more)");
    const only = wrap(["", "More than this wake lists: 1 might be relevant (recall ids: mem_a)"]);
    expect(hintsForReader(only, [], no(["mem_a"])).text).not.toContain("More than this wake lists");
  });

  test("the old heading and noun are read too; a page line that reads like the heading is left alone", () => {
    const old = wrap(["", "Nearby, if it helps:", "- a", "(2 more nearby; recall ids: mem_d, mem_e)"]);
    const r = hintsForReader(old, ["mem_a"], no(["mem_d"]));
    expect(r.text).toContain("(1 more nearby; recall ids: mem_e)");
    const page = wrap(["", "Who I am:", "", "Might be relevant:", "- from the page", "(End of my page.)", "", "Still open:", "- x"]);
    expect(hintsForReader(page, null, () => true).text).toBe(page);
  });

  test("nothing kept out: the text untouched, byte for byte", () => {
    const t = wrap(["", "Might be relevant:", "- a", "(1 more might be relevant; recall ids: mem_d)"]);
    expect(hintsForReader(t, ["mem_a"], () => false).text).toBe(t);
  });
});

/**
 * THE WAKE KNOWS YESTERDAY'S NEWS (WF1, 2026-11-03). Through the real
 * session-start hook (`bin/hook.ts`, a child process) on stores built like the
 * two cases of Dana's week (`~/counterparts-notes/2026-11-03-new-user-week-rerun.md`):
 *
 *   d6s1  the notes folder's wake, the day after the shop launched a day early:
 *         the launch was saved in the shop folder, `us`, after the last night.
 *   d2s2  the shop folder's wake on the afternoon of the surgery: the good news
 *         was saved in the notes folder that morning, just before the night ran.
 *
 * Hermetic (CLAUDE.md): a fresh temp data dir per test, removed afterwards. Every
 * word is invented placeholder prose.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_CODE_BUDGET_BYTES } from "../src/adapters/config.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeMode } from "../src/adapters/scopes.js";
import { EXIT, run } from "../src/adapters/cli/index.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart, plantTold } from "../src/core/counterpart.js";
import { WAKE_SHAPE_KEY } from "../src/core/counterpart-wake-shape.js";
import { WAKE_SHAPE_LIMITS as SHAPE } from "../src/core/self/tunables.js";
import { readSentinel } from "../src/core/self/index.js";
import { DATABASE_FILE, Store } from "../src/core/store/index.js";
import { monthDay } from "../src/core/time.js";

const BUDGET = CLAUDE_CODE_BUDGET_BYTES;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DANA = "aaaa1111-0000-4000-8000-000000000001";
const READER = "cccc3333-0000-4000-8000-000000000003";

let root: string;
let storeDir: string;
let conf: string;
let NOTES: string;
let SHOP: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-news-")));
  storeDir = join(root, "store");
  conf = join(root, "conf");
  NOTES = join(root, "notes");
  SHOP = join(root, "shop");
  for (const d of [NOTES, SHOP, conf]) mkdirSync(d, { recursive: true });
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

const NOW = Date.now();
const START_OF_TODAY = Date.UTC(new Date(NOW).getUTCFullYear(), new Date(NOW).getUTCMonth(), new Date(NOW).getUTCDate());

function brain(): { c: Counterpart; at(t: number): void; today: string } {
  let clock = NOW;
  const c = Counterpart.open({ dir: storeDir, now: () => clock, timeZone: "UTC", budgetBytes: BUDGET });
  open.push(c);
  c.store.setMeta(WAKE_SHAPE_KEY, "on");
  return { c, at: (t) => void (clock = t), today: c.store.today() };
}

/** A memory as a session writes it: its folder, its mark, how strong. */
function note(c: Counterpart, title: string, more: { scope: string; about: "owner" | "us" | "work" | "me"; strength?: number; felt?: number; status?: "done" | "planned"; eventDate?: string; session?: string }): string {
  const s = more.strength ?? 0.4;
  return c.store.put({
    type: "memory",
    kind: "fact",
    title,
    body: `${title}.`,
    about: more.about,
    ...(more.status === undefined ? {} : { status: more.status }),
    ...(more.eventDate === undefined ? {} : { eventDate: more.eventDate }),
    salience: { relevance: s, emotional: more.felt ?? 0, predictive: s },
    origin: { session: more.session ?? DANA, scope: more.scope },
  });
}

/** A night that folded news in: a journaled dream and a reflected reflection, begun at the clock's time. */
function night(c: Counterpart, n: number): void {
  const date = c.store.today();
  c.store.openDream({ id: `drm_00000000a00${String(n)}`, day: c.store.livedDay(), date });
  c.store.updateDream(`drm_00000000a00${String(n)}`, { state: "journaled", title: `A night ${String(n)}`, journal: "PRIVATE." });
  c.store.openReflection({ id: `rfl_00000000b00${String(n)}`, day: c.store.livedDay(), date, questions: [], shown: [] });
  c.store.updateReflection(`rfl_00000000b00${String(n)}`, { state: "reflected", entry: "PRIVATE." });
}

function scopes(modes: Readonly<Record<string, ScopeMode>>): void {
  let reg = null;
  for (const [dir, mode] of Object.entries(modes)) reg = setScope(reg, dir, mode, { at: "2026-09-22" });
  if (reg !== null) writeScopes(join(conf, "scopes.json"), reg);
}

/** The real hook, a child process, a session starting in `cwd`. The wake block, and the hook's row. */
function hook(cwd: string): { wake: string; row: Record<string, unknown> } {
  const config = join(conf, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: storeDir, injectionBudgetBytes: BUDGET, timeZone: "UTC" }));
  if (!existsSync(join(conf, "scopes.json"))) scopes({ [NOTES]: "on", [SHOP]: "on" });
  const r = spawnSync(process.execPath, ["run", new URL("../src/adapters/claude-code/bin/hook.ts", import.meta.url).pathname], {
    encoding: "utf8",
    input: JSON.stringify({ session_id: READER, hook_event_name: "SessionStart", source: "startup", cwd }),
    env: { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_DATA_DIR: storeDir, COUNTERPARTS_CONFIG: config, HOME: join(root, "home") },
  });
  expect(r.status).toBe(0);
  const full = r.stdout.startsWith("{") ? String((JSON.parse(r.stdout) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? "") : r.stdout;
  const at = full.indexOf("<!-- counterparts:wake ");
  const end = full.indexOf("\n", full.indexOf("<!-- counterparts:wake/end"));
  const wake = at < 0 ? full : full.slice(at, end < 0 ? undefined : end);
  const db = new Database(join(storeDir, DATABASE_FILE), { readonly: true });
  const row = db.query("select payload from events where name = 'adapter.wake.injected' order by seq desc limit 1").get() as { payload: string } | null;
  db.close();
  return { wake, row: row === null ? {} : (JSON.parse(row.payload) as Record<string, unknown>) };
}

function section(wake: string, head: string): string {
  return wake.split("\n\n").find((p) => p.startsWith(head)) ?? "";
}

const LAUNCH = "Dana's shop launched — 11 pieces sold in the first two hours";
const SURGERY = "Biscuit's knee surgery went well; Dana told me first";

/** Dana's d6s1: the last night two days back at 15:00, the launch since, in the shop; the reader in notes. */
function d6s1(c: Counterpart, at: (t: number) => void): void {
  at(NOW - 60 * HOUR);
  note(c, "Dana nervous before the shop launch on Saturday", { scope: SHOP, about: "owner", strength: 0.9, felt: 0.7 });
  at(NOW - 42 * HOUR);
  night(c, 1);
  at(NOW - 24 * HOUR);
  note(c, LAUNCH, { scope: SHOP, about: "us", strength: 0.85, felt: 0.9, status: "done" });
  note(c, "Oat Milk mugs sold out first at launch", { scope: SHOP, about: "work", strength: 0.9 });
  note(c, "Dana's kiln is booked Thursdays and Sundays", { scope: NOTES, about: "owner", strength: 0.4 });
  at(NOW);
}

describe("since the last night", () => {
  test("d6s1: the notes wake carries the launch from the shop folder, and nothing from before the night", () => {
    const { c, at } = brain();
    d6s1(c, at);
    c.close();
    const { wake, row } = hook(NOTES);
    expect(readSentinel(wake).intact).toBe(true);
    const block = section(wake, "Since the last night:");
    expect(block).toContain(`- ${LAUNCH} (24 hours)`);
    // Before the night: the page's. Work: Elsewhere's. Weak: no news.
    expect(block).not.toContain("nervous before");
    expect(block).not.toContain("Oat Milk");
    expect(block).not.toContain("kiln");
    // Titles only, inside its room, ahead of the folder's own section.
    expect(block).not.toMatch(/mem_[0-9a-f]{12}/);
    expect(Buffer.byteLength(`${block}\n\n`)).toBeLessThanOrEqual(SHAPE.ROOM.news);
    expect(wake.indexOf("Since the last night:")).toBeLessThan(wake.indexOf("Where this folder stands:"));
    expect(row["sec_news"]).toBe(Buffer.byteLength(`${block}\n\n`));
    // Nothing open, nothing dated, nobody else here: those sections aren't there at all.
    for (const empty of ["Still open:", "Nothing open.", "Coming up:", "Nothing dated.", "Open here now:"]) expect(wake).not.toContain(empty);
    expect(row["sec_threads"]).toBeUndefined();
    expect(row["sec_horizon"]).toBeUndefined();
  });

  test("d2s2: the shop wake on the surgery's afternoon carries the news from notes, written just before the night", () => {
    const { c, at } = brain();
    const span = Math.max(4, NOW - START_OF_TODAY);
    at(START_OF_TODAY + Math.floor(span * 0.3));
    note(c, SURGERY, { scope: NOTES, about: "us", strength: 0.75, status: "done" });
    at(START_OF_TODAY + Math.floor(span * 0.6));
    night(c, 1);
    at(NOW);
    c.close();
    const { wake } = hook(SHOP);
    expect(section(wake, "Since the last night:")).toContain(`- ${SURGERY}`);
  });

  test("a folder that is off, paused or observing keeps its news home; this folder's own is always here", () => {
    for (const mode of ["off", "paused", "observer"] as const) {
      const { c, at } = brain();
      d6s1(c, at);
      at(NOW - HOUR);
      note(c, "Dana trusted me with the next call", { scope: NOTES, about: "us", strength: 0.7 });
      at(NOW);
      c.close();
      scopes({ [NOTES]: "on", [SHOP]: mode });
      const { wake } = hook(NOTES);
      expect(wake).not.toContain(LAUNCH);
      expect(section(wake, "Since the last night:")).toContain("- Dana trusted me with the next call (1 hour)");
      rmSync(storeDir, { recursive: true, force: true });
      rmSync(join(conf, "scopes.json"), { force: true });
    }
  });

  test("nothing new since the night: no section, not a line saying so; starter memories never count", () => {
    const { c, at } = brain();
    plantTold(c.store, "local");
    at(NOW - 30 * HOUR);
    note(c, LAUNCH, { scope: SHOP, about: "us", strength: 0.85, felt: 0.9 });
    at(NOW - 20 * HOUR);
    night(c, 1);
    at(NOW);
    c.close();
    const { wake, row } = hook(NOTES);
    expect(wake).not.toContain("Since the last night");
    expect(wake).not.toContain("Since yesterday:");
    expect(row["sec_news"]).toBeUndefined();
  });

  test("a dated item is Coming up's, never news; an echo of a stronger title is said once", () => {
    const { c, at } = brain();
    at(NOW - 42 * HOUR);
    night(c, 1);
    at(NOW - 20 * HOUR);
    note(c, LAUNCH, { scope: SHOP, about: "us", strength: 0.85, felt: 0.9 });
    note(c, "Dana's shop launched, 11 pieces sold", { scope: NOTES, about: "owner", strength: 0.7 });
    note(c, "Dana's dog has a check-up next week", { scope: NOTES, about: "owner", strength: 0.9, eventDate: "2099-01-01" });
    at(NOW);
    c.close();
    const block = section(hook(NOTES).wake, "Since the last night:");
    expect(block).toContain(LAUNCH);
    expect(block).not.toContain("11 pieces sold\n");
    expect(block.split("\n").length).toBe(2);
  });
});

describe("a stale handoff steps down", () => {
  const PLATFORM = "next: build Dana's product page (waiting on Dana to pick a platform). Layout agreed: photos first, then the glaze badge.";
  const SEAT1 = "eeee0001-0000-4000-8000-000000000000";

  /** Dana's shop: the day-1 handoff, then sessions here that left no handoff of their own. */
  function shop(c: Counterpart, at: (t: number) => void, sessionsSince: number): string {
    at(NOW - 5 * 24 * HOUR);
    recordSession(storeDir, { sessionId: SEAT1, scope: SHOP, phase: "start", at: NOW - 5 * 24 * HOUR });
    const id = c.writeHandoff(PLATFORM, { scope: SHOP, session: SEAT1 }).id ?? "";
    for (let i = 0; i < sessionsSince; i++) {
      const t = NOW - (4 - i) * 24 * HOUR;
      at(t);
      const s = `ffff000${String(i)}-0000-4000-8000-000000000000`;
      recordSession(storeDir, { sessionId: s, scope: SHOP, phase: "start", at: t });
      note(c, `Shop voice: friendly, not cutesy ${String(i)}`, { scope: SHOP, about: "work", session: s, status: "done" });
    }
    at(NOW);
    return id;
  }

  test("five days old with sessions here since: one line with its age, after what came since, not whole", () => {
    const { c, at } = brain();
    const id = shop(c, at, 3);
    c.close();
    const { wake } = hook(SHOP);
    const stands = section(wake, "Where this folder stands:");
    expect(stands).not.toContain("waiting on Dana to pick a platform");
    expect(stands).not.toContain("Layout agreed");
    const lines = stands.split("\n");
    const last = lines.findIndex((l) => l.startsWith("Last handoff, session eeee0001, "));
    expect(lines[last]).toBe(`Last handoff, session eeee0001, ${monthDay(new Date(NOW - 5 * 24 * HOUR).toISOString().slice(0, 10))} (5 days old; 3 sessions here since): recall ${id}`);
    expect(lines.findIndex((l) => l === "Since, here:")).toBeLessThan(last);
    expect(stands).not.toContain("Nothing here since.");
  });

  test("no session here since, or not yet half a day: the handoff stays whole and first", () => {
    const { c, at } = brain();
    shop(c, at, 0);
    c.close();
    expect(section(hook(SHOP).wake, "Where this folder stands:")).toContain("waiting on Dana to pick a platform");
    rmSync(storeDir, { recursive: true, force: true });
    const fresh = brain();
    fresh.at(NOW - 2 * HOUR);
    recordSession(storeDir, { sessionId: SEAT1, scope: SHOP, phase: "start", at: NOW - 2 * HOUR });
    fresh.c.writeHandoff(PLATFORM, { scope: SHOP, session: SEAT1 });
    fresh.at(NOW - HOUR);
    recordSession(storeDir, { sessionId: "ffff0009-0000-4000-8000-000000000000", scope: SHOP, phase: "start", at: NOW - HOUR });
    fresh.at(NOW);
    fresh.c.close();
    const stands = section(hook(SHOP).wake, "Where this folder stands:");
    expect(stands).toContain("waiting on Dana to pick a platform");
    expect(stands).toStartWith("Where this folder stands:\nHandoff, session eeee0001");
  });

  test("a check-in since that left nothing here, ended or still open: the handoff stays whole (review of #734)", () => {
    for (const phase of ["end", "start"] as const) {
      const { c, at } = brain();
      at(NOW - 20 * HOUR);
      recordSession(storeDir, { sessionId: SEAT1, scope: SHOP, phase: "start", at: NOW - 20 * HOUR });
      c.writeHandoff(PLATFORM, { scope: SHOP, session: SEAT1 });
      const s = "ffff0001-0000-4000-8000-000000000000";
      at(NOW - 2 * HOUR);
      recordSession(storeDir, { sessionId: s, scope: SHOP, phase: "start", at: NOW - 2 * HOUR });
      if (phase === "end") recordSession(storeDir, { sessionId: s, scope: SHOP, phase: "end", at: NOW - 2 * HOUR + 5 * MIN });
      at(NOW);
      c.close();
      const stands = section(hook(SHOP).wake, "Where this folder stands:");
      expect(stands).toContain("waiting on Dana to pick a platform");
      expect(stands).not.toContain("Last handoff,");
      rmSync(storeDir, { recursive: true, force: true });
    }
  });

  test("a session still open beside this one, writing here, doesn't step the handoff down (review of #734)", () => {
    const { c, at } = brain();
    at(NOW - 20 * HOUR);
    recordSession(storeDir, { sessionId: SEAT1, scope: SHOP, phase: "start", at: NOW - 20 * HOUR });
    c.writeHandoff(PLATFORM, { scope: SHOP, session: SEAT1 });
    const s = "ffff0002-0000-4000-8000-000000000000";
    at(NOW - HOUR);
    recordSession(storeDir, { sessionId: s, scope: SHOP, phase: "start", at: NOW - HOUR });
    note(c, "Shop voice: friendly, not cutesy", { scope: SHOP, about: "work", session: s, status: "done" });
    at(NOW);
    c.close();
    const stands = section(hook(SHOP).wake, "Where this folder stands:");
    expect(stands).toContain("waiting on Dana to pick a platform");
    expect(stands).not.toContain("Last handoff,");
  });
});

describe("a dated item that already happened settles", () => {
  const LAUNCH_DAY = "Shop launch day: Saturday 7 Mar 2026 — Dana nervous nobody will buy";
  const S1 = "dddd0001-0000-4000-8000-000000000000";
  const S2 = "dddd0002-0000-4000-8000-000000000000";

  /** Dana's WK2 d6s1: the launch set for today as a plain reminder, then a done memory the day before, both through remember. */
  async function launch(news: string): Promise<void> {
    const { c, at, today } = brain();
    at(NOW - 3 * 24 * HOUR);
    recordSession(storeDir, { sessionId: S1, scope: SHOP, phase: "start", at: NOW - 3 * 24 * HOUR });
    await new McpServer({ counterpart: c, scope: SHOP, registryDir: storeDir, session: S1 }).call("remember", { kind: "fact", title: LAUNCH_DAY, text: "Dana's pottery shop launches today; nervous nobody will buy.", eventDate: today, remind: "plain", status: "planned", about: "work" });
    at(NOW - 24 * HOUR);
    recordSession(storeDir, { sessionId: S2, scope: SHOP, phase: "start", at: NOW - 24 * HOUR });
    await new McpServer({ counterpart: c, scope: SHOP, registryDir: storeDir, session: S2 }).call("remember", { kind: "fact", title: news, text: `${news}.`, status: "done", about: "us" });
    at(NOW);
    c.close();
  }

  /** The hook's whole context, the plain reminder included, as a session in notes reads it. */
  function full(cwd: string): string {
    const config = join(conf, "claude-code.json");
    writeFileSync(config, JSON.stringify({ dataDir: storeDir, injectionBudgetBytes: BUDGET, timeZone: "UTC" }));
    if (!existsSync(join(conf, "scopes.json"))) scopes({ [NOTES]: "on", [SHOP]: "on" });
    const r = spawnSync(process.execPath, ["run", new URL("../src/adapters/claude-code/bin/hook.ts", import.meta.url).pathname], {
      encoding: "utf8",
      input: JSON.stringify({ session_id: READER, hook_event_name: "SessionStart", source: "startup", cwd }),
      env: { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_DATA_DIR: storeDir, COUNTERPARTS_CONFIG: config, HOME: join(root, "home") },
    });
    expect(r.status).toBe(0);
    return r.stdout.startsWith("{") ? String((JSON.parse(r.stdout) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? "") : r.stdout;
  }

  test("the shop launched a day early: not today's plain reminder, not due today in Coming up", async () => {
    await launch("Shop launched: 11 pieces sold in the first two hours");
    const text = full(SHOP);
    expect(text).toContain("Shop launched: 11 pieces sold");
    expect(text).not.toContain("Plain reminder (they asked to be told)");
    expect(text).not.toContain("Shop launch day");
    expect(text).not.toContain("pottery shop launches today");
  });

  /** A dated item, then a done memory that shares its words, each through remember in notes. */
  async function visit(item: { title: string; date: string; ago: number; plain?: boolean }, done: { title: string; ago: number }): Promise<void> {
    const { c, at } = brain();
    at(NOW - item.ago);
    recordSession(storeDir, { sessionId: S1, scope: NOTES, phase: "start", at: NOW - item.ago });
    await new McpServer({ counterpart: c, scope: NOTES, registryDir: storeDir, session: S1 }).call("remember", { kind: "fact", title: item.title, text: `${item.title}.`, eventDate: item.date, ...(item.plain === true ? { remind: "plain" } : {}), status: "planned", about: "owner" });
    at(NOW - done.ago);
    recordSession(storeDir, { sessionId: S2, scope: NOTES, phase: "start", at: NOW - done.ago });
    await new McpServer({ counterpart: c, scope: NOTES, registryDir: storeDir, session: S2 }).call("remember", { kind: "fact", title: done.title, text: `${done.title}.`, status: "done", about: "owner" });
    at(NOW);
    c.close();
  }

  test("a visit not yet due isn't settled by an earlier one of the same name (review of #734)", async () => {
    const soon = new Date(NOW + 2 * 24 * HOUR).toISOString().slice(0, 10);
    await visit({ title: "Dentist appointment: cleaning and x-ray", date: soon, ago: 3 * 24 * HOUR }, { title: "Dentist appointment for the kids went fine", ago: 24 * HOUR });
    expect(section(hook(NOTES).wake, "Coming up:")).toContain("Dentist appointment: cleaning and x-ray");
  });

  test("today's reminder isn't settled by a done memory from days before its day (review of #734)", async () => {
    const today = new Date(NOW).toISOString().slice(0, 10);
    await visit({ title: "Biscuit's vet check-up", date: today, ago: 10 * 24 * HOUR, plain: true }, { title: "Stitches out at the vet for Biscuit, all good", ago: 5 * 24 * HOUR });
    const text = full(NOTES);
    expect(text).toContain("Plain reminder (they asked to be told) — Today: Biscuit's vet check-up");
    expect(section(text.slice(text.indexOf("<!-- counterparts:wake ")), "Coming up:")).toContain("Biscuit's vet check-up");
  });

  test("a done memory that names the launch but not the shop's launch settles nothing", async () => {
    await launch("Drafted Dana's launch post, short and long versions");
    const text = full(SHOP);
    expect(text).toContain(`Plain reminder (they asked to be told) — Today: ${LAUNCH_DAY}`);
    expect(section(text.slice(text.indexOf("<!-- counterparts:wake ")), "Coming up:")).toContain("- Due today · Dana's pottery shop launches today");
  });
});

describe("the wake's shape is on for a new store, and only a new one", () => {
  const quiet = { out: (): void => undefined, err: (): void => undefined };

  /** The real hook on the store an install's config names. */
  function wakeOf(cfg: string, dir: string): string {
    const r = spawnSync(process.execPath, ["run", new URL("../src/adapters/claude-code/bin/hook.ts", import.meta.url).pathname], {
      encoding: "utf8",
      input: JSON.stringify({ session_id: READER, hook_event_name: "SessionStart", source: "startup", cwd: SHOP }),
      env: { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_DATA_DIR: dir, COUNTERPARTS_CONFIG: cfg, HOME: join(root, "home") },
    });
    expect(r.status).toBe(0);
    return r.stdout;
  }

  test("install into a store it creates: on, by the store's own word, and the first wake is shaped", async () => {
    const cfg = join(root, "cp", "claude-code.json");
    const dir = join(root, "cp", "store");
    mkdirSync(join(root, "home"), { recursive: true });
    expect(await run(["install", "--config", cfg, "--no-connect"], { io: quiet, env: {}, home: join(root, "home") })).toBe(EXIT.ok);
    const s = Store.open({ dir });
    expect(s.getMeta(WAKE_SHAPE_KEY)).toBe("on");
    s.close();
    const c = Counterpart.open({ dir });
    expect(c.self.tunables.WAKE_SHAPE).toBe(false);
    expect(c.wakeShapeOn()).toBe(true);
    c.close();
    expect(wakeOf(cfg, dir)).toContain("Where this folder stands:");
  });

  test("a store that already existed keeps its setting through install: off stays the build's default", async () => {
    const cfg = join(root, "cp", "claude-code.json");
    const dir = join(root, "cp", "store");
    mkdirSync(join(root, "home"), { recursive: true });
    const old = Store.open({ dir });
    old.put({ type: "memory", kind: "fact", body: "A memory from before WF1." });
    old.close();
    expect(await run(["install", "--config", cfg, "--no-connect"], { io: quiet, env: {}, home: join(root, "home") })).toBe(EXIT.ok);
    const s = Store.open({ dir });
    expect(s.getMeta(WAKE_SHAPE_KEY)).toBeUndefined();
    s.close();
    const c = Counterpart.open({ dir });
    expect(c.wakeShapeOn()).toBe(false);
    c.close();
    expect(wakeOf(cfg, dir)).not.toContain("Where this folder stands:");
  });
});

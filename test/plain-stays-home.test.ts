/**
 * SO1 STEP 3 (2026-11-07): EACH ITEM SHOWS WHERE IT CAN BE ACTED ON. Another
 * folder's work plain reminder is said in its own folder (and the folders
 * joined to it), not in this folder's wake, its lines above, or to the person;
 * a personal one (me, us, owner) still crosses, folded once told. An open
 * thread marked world stays in its folder's Still open.
 *
 * Through the doors: the real session-start and prompt hook (`bin/hook.ts`, a
 * child process) on a store this test built, two folders in one store.
 *
 * Hermetic (CLAUDE.md): a fresh temp data dir per test, removed afterwards.
 * Every word is invented placeholder prose.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_CODE_BUDGET_BYTES } from "../src/adapters/config.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";
import { WAKE_SHAPE_KEY } from "../src/core/counterpart-wake-shape.js";
import { DATABASE_FILE } from "../src/core/store/index.js";

const BUDGET = CLAUDE_CODE_BUDGET_BYTES;
const S = (n: number): string => `${String(n).padStart(4, "0")}aaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;

let root: string;
let storeDir: string;
let conf: string;
let GARDEN: string;
let BAKERY: string;
let SHED: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-home-")));
  storeDir = join(root, "store");
  conf = join(root, "conf");
  GARDEN = join(root, "garden");
  BAKERY = join(root, "bakery");
  SHED = join(root, "shed");
  for (const d of [GARDEN, BAKERY, SHED, conf]) mkdirSync(d, { recursive: true });
  let reg = null;
  for (const dir of [GARDEN, BAKERY, SHED]) reg = setScope(reg, dir, "on", { at: "2026-09-22" });
  if (reg !== null) writeScopes(join(conf, "scopes.json"), reg);
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

function brain(): { c: Counterpart; today: string } {
  const c = Counterpart.open({ dir: storeDir, timeZone: "UTC", budgetBytes: BUDGET });
  open.push(c);
  c.store.setMeta(WAKE_SHAPE_KEY, "on");
  return { c, today: c.store.today() };
}

function memory(c: Counterpart, body: string, more: { title: string; scope: string; about?: string; eventDate?: string; meta?: Record<string, unknown> }): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    title: more.title,
    ...(more.eventDate === undefined ? {} : { eventDate: more.eventDate }),
    ...(more.meta === undefined ? {} : { meta: more.meta }),
    about: (more.about ?? "work") as "work",
    salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 },
    origin: { session: S(99), scope: more.scope },
  });
}

/** The real hook, a child process: the wake block, what's above it, and what the person is shown. */
function hook(session: string, cwd: string, event: "SessionStart" | "UserPromptSubmit" = "SessionStart"): { wake: string; above: string; model: string; person: string } {
  const config = join(conf, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: storeDir, injectionBudgetBytes: BUDGET, timeZone: "UTC" }));
  const r = spawnSync(process.execPath, ["run", new URL("../src/adapters/claude-code/bin/hook.ts", import.meta.url).pathname], {
    encoding: "utf8",
    input: JSON.stringify({ session_id: session, hook_event_name: event, cwd, ...(event === "UserPromptSubmit" ? { prompt: "Tell me a little about the weather on the hill." } : { source: "startup" }) }),
    env: { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_DATA_DIR: storeDir, COUNTERPARTS_CONFIG: config, HOME: join(root, "home") },
  });
  expect(r.status).toBe(0);
  const out = (r.stdout.startsWith("{") ? JSON.parse(r.stdout) : { hookSpecificOutput: { additionalContext: r.stdout } }) as { systemMessage?: string; hookSpecificOutput?: { additionalContext?: string } };
  const model = out.hookSpecificOutput?.additionalContext ?? "";
  const at = model.indexOf("<!-- counterparts:wake ");
  const end = model.indexOf("\n", model.indexOf("<!-- counterparts:wake/end"));
  return { wake: at < 0 ? "" : model.slice(at, end < 0 ? undefined : end), above: at < 0 ? model : model.slice(0, at), model, person: out.systemMessage ?? "" };
}

function section(wake: string, head: string): string {
  return wake.split("\n\n").find((p) => p.startsWith(head)) ?? "";
}

function latches(id: string): number {
  const db = new Database(join(storeDir, DATABASE_FILE), { readonly: true });
  const row = db.query("select count(*) as n from events where name = 'prospective.plain' and ref = ?").get(id) as { n: number };
  db.close();
  return row.n;
}

describe("SO1 step 3: a plain reminder is said where it can be acted on", () => {
  test("another folder's work: not in the bakery's wake, above it, to the person or at a prompt, even waking first; whole in the garden's first wake", () => {
    const { c, today } = brain();
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    const id = memory(c, "Hplain: re-pot the seedlings on the east bench.", { title: "Hplain seedlings", scope: GARDEN, eventDate: today, meta: { remind: "plain" } });
    c.close();

    // The bakery wakes first that day.
    const b1 = hook(S(1), BAKERY);
    expect(b1.model).not.toContain("Hplain");
    expect(b1.person).not.toContain("Hplain");
    expect(b1.wake).not.toContain(id);
    expect(section(b1.wake, "Coming up:")).toBe(`Coming up:\n(1 in other folders; recall "coming up")`);
    const prompt = hook(S(1), BAKERY, "UserPromptSubmit");
    expect(prompt.model).not.toContain(id);
    expect(prompt.person).not.toContain("Hplain");
    expect(latches(id)).toBe(0);

    // The garden's first wake: whole, and told.
    const g1 = hook(S(2), GARDEN);
    expect(section(g1.wake, "Coming up:")).toContain(`- Due today · Hplain: re-pot the seedlings on the east bench. [${id}]`);
    expect(g1.wake).not.toContain("shown earlier");
    expect(g1.person).toContain("Hplain seedlings");
    expect(latches(id)).toBe(1);

    // The bakery again: still another folder's, never "shown earlier" here.
    const b2 = hook(S(3), BAKERY);
    expect(section(b2.wake, "Coming up:")).toBe(`Coming up:\n(1 in other folders; recall "coming up")`);
    // The garden again: folded, once told.
    expect(section(hook(S(4), GARDEN).wake, "Coming up:")).toBe(`Coming up:\n(1 due today, shown earlier; recall "coming up")`);
  });

  test("a folder joined to the garden as one project is its own folder: the shed's wake says the garden's reminder", () => {
    const { c, today } = brain();
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    const id = memory(c, "Hjoined: oil the shed's hinges.", { title: "Hjoined hinges", scope: GARDEN, eventDate: today, meta: { remind: "plain" } });
    for (const folder of [GARDEN, SHED]) c.joinProject({ folder, project: "Allotment", by: "owner" });
    c.close();
    expect(hook(S(1), BAKERY).person).not.toContain("Hjoined");
    const shed = hook(S(2), SHED);
    expect(section(shed.wake, "Coming up:")).toContain(`- Due today · Hjoined: oil the shed's hinges. [${id}]`);
    expect(shed.person).toContain("Hjoined hinges");
    expect(latches(id)).toBe(1);
  });

  test("a personal one (owner) crosses: whole in the bakery's first wake, then folded in the garden's", () => {
    const { c, today } = brain();
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    const id = memory(c, "Hown: ring the dentist about Thursday.", { title: "Hown dentist", scope: GARDEN, about: "owner", eventDate: today, meta: { remind: "plain" } });
    c.close();
    const b1 = hook(S(1), BAKERY);
    expect(section(b1.wake, "Coming up:")).toContain(`- Due today · Hown: ring the dentist about Thursday. [${id}]`);
    expect(b1.person).toContain("Hown dentist");
    expect(latches(id)).toBe(1);
    const g1 = hook(S(2), GARDEN);
    expect(section(g1.wake, "Coming up:")).toBe(`Coming up:\n(1 due today, shown earlier; recall "coming up")`);
    expect(g1.person).not.toContain("Hown");
  });
});

describe("SO1 step 3: an open thread marked world stays in its folder", () => {
  test("not in the bakery's Still open; in the garden's; one marked me still crosses", () => {
    const { c } = brain();
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    const world = memory(c, "Hworld: the seed merchant hasn't answered about the spring order.", { title: "Hworld seed merchant", scope: GARDEN, about: "world", meta: { unresolved: true, settlesWhen: "the merchant answers" } });
    const me = memory(c, "Hme: I want to get better at reading soil.", { title: "Hme soil reading", scope: GARDEN, about: "me", meta: { unresolved: true } });
    c.close();
    const bakery = section(hook(S(1), BAKERY).wake, "Still open:");
    expect(bakery).not.toContain(world);
    expect(bakery).toContain(me);
    const garden = section(hook(S(2), GARDEN).wake, "Still open:");
    expect(garden).toContain(world);
    expect(garden).toContain(me);
  });
});

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

import { run } from "../src/adapters/cli/commands.js";
import { CLAUDE_CODE_BUDGET_BYTES } from "../src/adapters/config.js";
import { CLAUDE_AI_HOST, DESKTOP_HOST } from "../src/adapters/hosts.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { WAKE_SHAPE_KEY } from "../src/core/counterpart-wake-shape.js";
import { PROSPECTIVE_PLAIN_CROSSED_EVENT } from "../src/core/prospective/index.js";
import { DATABASE_FILE } from "../src/core/store/index.js";
import { addDays } from "../src/core/time.js";

const DAY = 24 * 60 * 60_000;

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

function brain(): { c: Counterpart; today: string; at(t: number): void } {
  let clock = Date.now();
  const c = Counterpart.open({ dir: storeDir, timeZone: "UTC", budgetBytes: BUDGET, now: () => clock });
  open.push(c);
  c.store.setMeta(WAKE_SHAPE_KEY, "on");
  return { c, today: c.store.today(), at: (t) => void (clock = t) };
}

function memory(c: Counterpart, body: string, more: { title: string; scope: string; about?: string; eventDate?: string; learnedOn?: string; meta?: Record<string, unknown> }): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    title: more.title,
    ...(more.eventDate === undefined ? {} : { eventDate: more.eventDate }),
    ...(more.learnedOn === undefined ? {} : { learnedOn: more.learnedOn }),
    ...(more.meta === undefined ? {} : { meta: more.meta }),
    about: (more.about ?? "work") as "work",
    salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 },
    origin: { session: S(99), scope: more.scope },
  });
}

/** The real hook, a child process: the wake block, what's above it, and what the person is shown. */
function hook(session: string, cwd: string, event: "SessionStart" | "UserPromptSubmit" = "SessionStart", entrypoint?: string): { wake: string; above: string; model: string; person: string } {
  const config = join(conf, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: storeDir, injectionBudgetBytes: BUDGET, timeZone: "UTC" }));
  const r = spawnSync(process.execPath, ["run", new URL("../src/adapters/claude-code/bin/hook.ts", import.meta.url).pathname], {
    encoding: "utf8",
    input: JSON.stringify({ session_id: session, hook_event_name: event, cwd, ...(event === "UserPromptSubmit" ? { prompt: "Tell me a little about the weather on the hill." } : { source: "startup" }) }),
    env: { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_DATA_DIR: storeDir, COUNTERPARTS_CONFIG: config, HOME: join(root, "home"), CLAUDE_CODE_ENTRYPOINT: entrypoint ?? "cli", CLAUDE_CODE_SESSION_ATTENDED: entrypoint === undefined ? "1" : "0" },
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

function latches(id: string, name = "prospective.plain"): number {
  const db = new Database(join(storeDir, DATABASE_FILE), { readonly: true });
  const row = db.query("select count(*) as n from events where name = ? and ref = ?").get(name, id) as { n: number };
  db.close();
  return row.n;
}
const crossed = (id: string): number => latches(id, PROSPECTIVE_PLAIN_CROSSED_EVENT);

describe("SO1 step 3: a plain reminder is said where it can be acted on", () => {
  test("another folder's work: not in the bakery's wake, above it, to the person or at a prompt, even waking first; whole in the garden's first wake", () => {
    const { c, today } = brain();
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    const id = memory(c, "Hplain: re-pot the seedlings on the east bench.", { title: "Hplain seedlings", scope: GARDEN, eventDate: today, meta: { remind: "plain" } });
    c.close();

    // The bakery wakes first that day.
    const b1 = hook(S(1), BAKERY);
    // Named by its folder and title in the count (fix round, d), never its words or id; not told.
    expect(b1.model).not.toContain("re-pot");
    expect(b1.above).not.toContain("Hplain");
    expect(b1.person).not.toContain("Hplain");
    expect(b1.wake).not.toContain(id);
    expect(section(b1.wake, "Coming up:")).toBe(`Coming up:\n(1 in other folders (garden: Hplain seedlings); recall "coming up")`);
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
    expect(section(b2.wake, "Coming up:")).toBe(`Coming up:\n(1 in other folders (garden: Hplain seedlings); recall "coming up")`);
    // The garden again, another session: by title, once told (WK3: never "shown earlier" across sessions).
    expect(section(hook(S(4), GARDEN).wake, "Coming up:")).toBe(`Coming up:\n- Due today · Hplain seedlings [${id}]`);
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
    expect(section(g1.wake, "Coming up:")).toBe(`Coming up:\n- Due today · Hown dentist [${id}]`);
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

describe("SO1 step 3 fix round: a chat with no folder is told only personal reminders", () => {
  test("claude.ai's wake: the garden's work isn't told or shown, the owner's is; and a chat's told mark doesn't fold the garden's", async () => {
    const { c, today } = brain();
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    const work = memory(c, "Hchat: sweep the potting shed floor.", { title: "Hchat sweep", scope: GARDEN, eventDate: today, meta: { remind: "plain" } });
    const owner = memory(c, "Hchatown: post the birthday card.", { title: "Hchatown card", scope: GARDEN, about: "owner", eventDate: today, meta: { remind: "plain" } });
    const web = new McpServer({ counterpart: c, host: CLAUDE_AI_HOST, env: {}, lifecycle: { spawner: () => ({ pid: 1 }), config: { injectionBudgetBytes: BUDGET } }, manifestVersion: () => null } as never);
    const text = (await web.call("wake", {})).content.map((x) => ("text" in x ? String(x.text) : "")).join("\n");
    expect(text).not.toContain(work);
    expect(text).not.toContain("Hchat: sweep");
    expect(text).toContain(`[${owner}]`);
    expect(latches(work)).toBe(0);
    expect(latches(owner)).toBe(1);
    // A told mark from a chat (as before this change, or any session outside the garden) isn't "shown" for the garden.
    recordSession(storeDir, { sessionId: S(7), scope: "claude-ai:", phase: "start" });
    const due = c.plainDueToday({ at: today }).find((r) => r.memoryId === work);
    expect(due).toBeDefined();
    expect(c.claimPlainReminder(due as NonNullable<typeof due>, { at: today, session: S(7) })).toBe(true);
    c.close();
    const g = hook(S(2), GARDEN);
    expect(section(g.wake, "Coming up:")).toContain(`- Due today · Hchat: sweep the potting shed floor. [${work}]`);
  });
});

/** A person's session start on `date` in `folder`, as the log's presence row (`adapter.wake.injected`) says it. */
function startedOn(c: Counterpart, date: string, session: string, folder: string, interactive = true): void {
  c.store.appendEvent({ name: "adapter.wake.injected", day: c.store.livedDay(), payload: { date, session, interactive, folder } });
}

describe("SO1 step 3 fix round: a work reminder unsaid in its silent folder crosses once", () => {
  test("two lived days past its day: not at a prompt, not headless; told once at the bakery's start with its folder named; not again anywhere; no late beat at home after", () => {
    const { c, today } = brain();
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    const id = memory(c, "Hcross: send the seed invoice to the allotment board.", { title: "Hcross invoice", scope: GARDEN, eventDate: addDays(today, -3), learnedOn: addDays(today, -9), meta: { remind: "plain" } });
    // Too soon: due yesterday, one lived day (today) past it.
    const soon = memory(c, "Hsoon: oil the gate.", { title: "Hsoon gate", scope: GARDEN, eventDate: addDays(today, -1), learnedOn: addDays(today, -9), meta: { remind: "plain" } });
    // One of my own checks: waits for its folder.
    const check = memory(c, "Check due ~: the wake's room after the trims.", { title: "Check due ~ the wake's room", scope: GARDEN, eventDate: addDays(today, -3), learnedOn: addDays(today, -9), meta: { remind: "plain" } });
    // The person started a session in the bakery two days ago (the presence row); the garden had none.
    startedOn(c, addDays(today, -2), S(10), BAKERY);
    c.close();

    const prompt = hook(S(1), BAKERY, "UserPromptSubmit");
    expect(prompt.model).not.toContain("Hcross");
    expect(prompt.person).not.toContain("Hcross");
    const headless = hook(S(1), BAKERY, "SessionStart", "sdk-cli");
    expect(headless.model).not.toContain("Hcross");
    expect(crossed(id)).toBe(0);

    const b = hook(S(2), BAKERY);
    expect(b.person).toContain("garden: Hcross invoice, due ");
    expect(b.person).toContain("(not said yet: no session there while it was due)");
    expect(b.above).toContain(`[${id}]`);
    expect(b.person).not.toContain("Hsoon");
    expect(b.person).not.toContain("Check due");
    expect([crossed(id), crossed(soon), crossed(check)]).toEqual([1, 0, 0]);
    // A crossing is no telling on its day: the beat latch stays unwritten.
    expect(latches(id)).toBe(0);

    // Once, across every folder; and its own folder's late beat (inside its grace) doesn't say it again.
    expect(hook(S(3), BAKERY).person).not.toContain("Hcross");
    expect(hook(S(4), SHED).person).not.toContain("Hcross");
    const home = hook(S(5), GARDEN);
    expect(home.person).not.toContain("Hcross");
    expect(home.above).not.toContain("Hcross");
    // The check, in its own folder, is told there as its late beat.
    expect(home.person).toContain("Check due ~ the wake's room");
    expect([crossed(id), latches(id)]).toEqual([1, 0]);

    // And the next day: nothing left to cross.
    const next = brain();
    next.at(Date.now() + 86_400_000);
    expect(next.c.plainCrossing({ at: addDays(today, 1), lived: () => new Set([addDays(today, -2), today]) }).map((r) => r.memoryId)).not.toContain(id);
  });

  test("lived days are the log's presence rows: a registry record with no session-start row doesn't count, an unattended start doesn't either", () => {
    const { c, today } = brain();
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    const id = memory(c, "Hlived: renew the allotment lease.", { title: "Hlived lease", scope: GARDEN, eventDate: addDays(today, -3), learnedOn: addDays(today, -9), meta: { remind: "plain" } });
    startedOn(c, addDays(today, -2), S(11), BAKERY, false);
    c.close();
    recordSession(storeDir, { sessionId: S(12), scope: BAKERY, phase: "start", at: Date.now() - 2 * DAY });
    expect(hook(S(2), BAKERY).person).not.toContain("Hlived");
    expect(crossed(id)).toBe(0);
    const again = brain();
    startedOn(again.c, addDays(today, -2), S(13), BAKERY);
    again.c.close();
    expect(hook(S(3), BAKERY).person).toContain("garden: Hlived lease, due ");
    expect(crossed(id)).toBe(1);
  });

  test("a wake tool call crosses only when the host says a person is there, and never into a chat with no folder", async () => {
    const { c, today } = brain();
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    const id = memory(c, "Htool: file the water-rate form.", { title: "Htool form", scope: GARDEN, eventDate: addDays(today, -3), learnedOn: addDays(today, -9), meta: { remind: "plain" } });
    startedOn(c, addDays(today, -2), S(14), BAKERY);
    const config = { injectionBudgetBytes: BUDGET };
    const wake = async (o: { scope?: string; attended?: boolean; host?: string }): Promise<string> => {
      const s = new McpServer({ counterpart: c, ...(o.host === undefined ? {} : { host: o.host }), ...(o.scope === undefined ? {} : { scope: o.scope }), registryDir: storeDir, env: o.attended === true ? { CLAUDE_CODE_SESSION_ATTENDED: "1" } : {}, lifecycle: { spawner: () => ({ pid: 1 }), config }, manifestVersion: () => null } as never);
      return JSON.stringify((await s.call("wake", {})).structuredContent);
    };
    // A routine's wake in the bakery, nobody said to be there: not claimed.
    const routine = await wake({ host: DESKTOP_HOST, scope: BAKERY });
    expect(routine).toContain("counterparts:wake ");
    expect(routine).not.toContain("garden: Htool");
    expect(crossed(id)).toBe(0);
    // claude.ai, attended, with no folder: rule (a), not there either.
    expect(await wake({ host: CLAUDE_AI_HOST, attended: true })).not.toContain("Htool");
    expect(crossed(id)).toBe(0);
    // Attended, in a folder: crosses.
    expect(await wake({ host: DESKTOP_HOST, scope: BAKERY, attended: true })).toContain("garden: Htool form, due ");
    expect(crossed(id)).toBe(1);
  });

  test("a month item crosses past its last day; a personal one never does (it was told wherever a session ran)", () => {
    const { c } = brain();
    // Pinned: `plainCrossing` reads the day it is asked about, not the clock.
    const today = "2026-11-07";
    const lastMonth = "2026-10";
    const id = memory(c, "Hmonth: un-pause the crons.", { title: "Hmonth crons", scope: GARDEN, eventDate: lastMonth, learnedOn: `${lastMonth}-01`, meta: { remind: "plain" } });
    const mine = memory(c, "Hmine: renew the library card.", { title: "Hmine card", scope: GARDEN, about: "owner", eventDate: lastMonth, learnedOn: `${lastMonth}-01`, meta: { remind: "plain" } });
    const out = c.plainCrossing({ at: today, lived: () => new Set(["2026-11-01"]) });
    expect(out.find((r) => r.memoryId === id)?.crossFrom).toBe("garden");
    expect(out.map((r) => r.memoryId)).not.toContain(mine);
    // One lived day past it (today alone): not yet.
    expect(c.plainCrossing({ at: today, lived: () => new Set() }).map((r) => r.memoryId)).not.toContain(id);
  });
});

describe("SO1 step 3 fix round: doctor reads a silent folder as info, a missed crossing as a miss", () => {
  async function doctor(): Promise<string> {
    const config = join(conf, "claude-code.json");
    writeFileSync(config, JSON.stringify({ dataDir: storeDir, injectionBudgetBytes: BUDGET, timeZone: "UTC" }));
    const out: string[] = [];
    await run(["doctor", `--config=${config}`], { io: { out: (l) => out.push(l), err: () => undefined }, env: { PATH: "/usr/bin:/bin", COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" }, home: join(root, "home") });
    return out.join("\n");
  }
  /** A person's session in the bakery on `date`: its start's presence row and a prompt's. */
  function bakeryOn(c: Counterpart, date: string, n: number): void {
    startedOn(c, date, S(n), BAKERY);
    c.store.appendEvent({ name: "recall.decision", day: c.store.livedDay(), payload: { date, reason: "rendered", session: S(n) } });
  }
  function seeded(now: number): { c: Counterpart; at(t: number): void; today: string } {
    const w = brain();
    w.at(now - 20 * DAY);
    w.c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    w.c.store.appendEvent({ name: "recall.decision", day: w.c.store.livedDay(), payload: { date: addDays(w.today, -20), reason: "rendered" } });
    return w;
  }

  test("due yesterday and only the bakery came: an info line, green", async () => {
    const NOW = Date.now();
    const { c, at, today } = seeded(NOW);
    memory(c, "Hdoc: label the seed trays.", { title: "Hdoc trays", scope: GARDEN, eventDate: addDays(today, -1), meta: { remind: "plain" } });
    at(NOW - DAY);
    bakeryOn(c, addDays(today, -1), 21);
    at(NOW);
    c.close();
    const info = await doctor();
    expect(info).toContain("1 plain reminder was due while its folder had no session");
    expect(info).not.toContain("did not fire");
    expect(info).not.toContain("Hdoc");
  });

  test("due four days ago, two bakery days since and never crossed: a miss; crossed: said", async () => {
    const NOW = Date.now();
    const { c, at, today } = seeded(NOW);
    const late = memory(c, "Hdoc2: stake the beans.", { title: "Hdoc2 beans", scope: GARDEN, eventDate: addDays(today, -4), meta: { remind: "plain" } });
    for (const [k, n] of [[4, 31], [3, 32], [2, 33]] as const) {
      at(NOW - k * DAY);
      bakeryOn(c, addDays(today, -k), n);
    }
    at(NOW);
    const missed = await doctor();
    expect(missed).toContain("1 plain reminder was due where a session could say it, and not said");
    expect(missed).toContain("did not fire");
    const r = c.plainCrossing({ at: today, lived: () => new Set([addDays(today, -3), addDays(today, -2)]) }).find((x) => x.memoryId === late);
    expect(r).toBeDefined();
    expect(c.claimPlainReminder(r as NonNullable<typeof r>, { at: today })).toBe(true);
    c.close();
    const said = await doctor();
    expect(said).not.toContain("not said");
    expect(said).not.toContain("had no session");
  });
});

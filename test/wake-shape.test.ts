/**
 * THE WAKE'S SHAPE (WK2, 2026-10-30; `self.WAKE_SHAPE`): one composer, top-down,
 * behind a switch. Through the doors: the real session-start hook (`bin/hook.ts`,
 * a child process, on a store this test built), and the MCP recall handles and
 * the `wake` tool the wake's lines name.
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

import { run } from "../src/adapters/cli/commands.js";
import { CLAUDE_CODE_BUDGET_BYTES } from "../src/adapters/config.js";
import { CLAUDE_AI_HOST, DESKTOP_HOST } from "../src/adapters/hosts.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeMode } from "../src/adapters/scopes.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { parseTranscript } from "../src/adapters/claude-code/transcript.js";
import type { ScopeVerdict } from "../src/adapters/scopes.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { WAKE_SHAPE_KEY } from "../src/core/counterpart-wake-shape.js";
import { firstRealSentence, leadOf, seatOf, titleInLead, withoutLabel } from "../src/core/handoff/index.js";
import { WAKE_SHAPE_LIMITS as SHAPE } from "../src/core/self/tunables.js";
import { readSentinel } from "../src/core/self/index.js";
import { DATABASE_FILE } from "../src/core/store/index.js";
import { addDays } from "../src/core/time.js";

const BUDGET = CLAUDE_CODE_BUDGET_BYTES;
const MIN = 60_000;
const HOUR = 60 * MIN;
const OWN = "aaaa1111-0000-4000-8000-000000000001";
const OTHER = "bbbb2222-0000-4000-8000-000000000002";
const READER = "cccc3333-0000-4000-8000-000000000003";

let root: string;
let storeDir: string;
let conf: string;
let HERE: string;
let THERE: string;
let SHUT: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-shape-")));
  storeDir = join(root, "store");
  conf = join(root, "conf");
  HERE = join(root, "garden");
  THERE = join(root, "bakery");
  SHUT = join(root, "ledger");
  for (const d of [HERE, THERE, SHUT, conf]) mkdirSync(d, { recursive: true });
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

/** A brain on a clock the test moves, in UTC, the switch on unless told. */
function brain(opts: { on?: boolean } = {}): { c: Counterpart; at(t: number): void; today: string } {
  let clock = NOW;
  const c = Counterpart.open({ dir: storeDir, now: () => clock, timeZone: "UTC", budgetBytes: BUDGET });
  open.push(c);
  if (opts.on !== false) c.store.setMeta(WAKE_SHAPE_KEY, "on");
  return { c, at: (t) => void (clock = t), today: c.store.today() };
}

function memory(c: Counterpart, body: string, more: { title?: string; scope?: string; session?: string; status?: "planned" | "proposed" | "asked" | "done"; about?: string; eventDate?: string; learnedOn?: string; meta?: Record<string, unknown> } = {}): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    ...(more.title === undefined ? {} : { title: more.title }),
    ...(more.eventDate === undefined ? {} : { eventDate: more.eventDate }),
    ...(more.learnedOn === undefined ? {} : { learnedOn: more.learnedOn }),
    ...(more.meta === undefined ? {} : { meta: more.meta }),
    ...(more.status === undefined ? {} : { status: more.status }),
    about: (more.about ?? "work") as "work",
    salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 },
    origin: { session: more.session ?? OTHER, scope: more.scope ?? HERE },
  });
}

/** The host's scope file: every folder named here on or off. */
function scopes(modes: Readonly<Record<string, ScopeMode>>): void {
  let reg = null;
  for (const [dir, mode] of Object.entries(modes)) reg = setScope(reg, dir, mode, { at: "2026-09-22" });
  if (reg !== null) writeScopes(join(conf, "scopes.json"), reg);
}

/** The real hook, a child process, on the store as it stands. The wake block, and what the hook's row says. */
function hook(session = READER, budget = BUDGET, cwd = HERE): { wake: string; full: string; row: Record<string, unknown> } {
  const config = join(conf, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: storeDir, injectionBudgetBytes: budget, timeZone: "UTC" }));
  if (!existsSync(join(conf, "scopes.json"))) scopes({ [HERE]: "on", [THERE]: "on" });
  const r = spawnSync(process.execPath, ["run", new URL("../src/adapters/claude-code/bin/hook.ts", import.meta.url).pathname], {
    encoding: "utf8",
    input: JSON.stringify({ session_id: session, hook_event_name: "SessionStart", source: "startup", cwd }),
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
  return { wake, full, row: row === null ? {} : (JSON.parse(row.payload) as Record<string, unknown>) };
}

/** The sections, by their first line. */
function section(wake: string, head: string): string {
  const parts = wake.split("\n\n");
  return parts.find((p) => p.startsWith(head)) ?? "";
}

/** An id printed twice, past the page, or a list of bare ids. */
function ids(text: string): string[] {
  return [...text.matchAll(/\b(?:mem|sch|epi)_[0-9a-f]{12}\b/g)].map((m) => m[0]);
}
const BARE = /(?:mem|sch|epi|drm|rfl)_[0-9a-f]{6,}(?:,| \(\d)|: (?:mem|sch|epi)_/;

function holds(wake: string, budget = BUDGET): void {
  const s = readSentinel(wake);
  expect(s.present).toBe(true);
  expect(s.intact).toBe(true);
  expect(wake.split("\n")[0]).toStartWith("<!-- counterparts:wake ");
  expect(s.actualBytes).toBeLessThanOrEqual(budget);
  const all = ids(wake);
  expect(all.length).toBe(new Set(all).size);
  expect(wake).not.toMatch(BARE);
  expect(wake).not.toContain("drm_");
  expect(wake).not.toContain("rfl_");
  expect(wake).not.toContain("Might be relevant: ");
}

describe("the switch", () => {
  test("off by default; the store's word beats the build's either way; off is the old road", () => {
    const { c, today } = brain({ on: false });
    expect(c.self.tunables.WAKE_SHAPE).toBe(false);
    expect(c.wakeShapeOn()).toBe(false);
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    c.rebrief({ budgetBytes: BUDGET, at: today });
    expect(c.wake(BUDGET, { date: today }, { scope: HERE }).text).not.toContain("Where this folder stands");
    c.store.setMeta(WAKE_SHAPE_KEY, "on");
    expect(c.wakeShapeOn()).toBe(true);
    expect(c.wake(BUDGET, { date: today }, { scope: HERE }).text).toContain("Where this folder stands:");
    c.store.setMeta(WAKE_SHAPE_KEY, "off");
    expect(c.wakeShapeOn()).toBe(false);
    const forced = Counterpart.open({ dir: join(root, "second"), selfTunables: { WAKE_SHAPE: true } });
    open.push(forced);
    expect(forced.wakeShapeOn()).toBe(true);
    forced.store.setMeta(WAKE_SHAPE_KEY, "off");
    expect(forced.wakeShapeOn()).toBe(false);
  });

  test("the console sets it for one store, and reads it", async () => {
    const { c } = brain({ on: false });
    c.close();
    const out: string[] = [];
    const opts = { io: { out: (l: string) => void out.push(l), err: (l: string) => void out.push(l) }, env: {} };
    expect(await run(["wake-shape", "--dir", storeDir], opts)).toBe(0);
    expect(out.at(-1)).toContain("off (the build's default)");
    expect(await run(["wake-shape", "on", "--dir", storeDir], opts)).toBe(0);
    expect(out.at(-1)).toBe("The wake's shape here: on.");
    expect(await run(["wake-shape", "default", "--dir", storeDir], opts)).toBe(0);
    expect(out.at(-1)).toContain("off (the build's default)");
    expect(await run(["wake-shape", "maybe", "--dir", storeDir], opts)).not.toBe(0);
  });

  test("a wake the composer can't make takes the old road, and a ring event says so", () => {
    const { c, today } = brain();
    c.rebrief({ budgetBytes: BUDGET, at: today });
    const woke = c.wake(40, { date: today }, { scope: HERE });
    expect(woke.text).not.toContain("Where this folder stands");
    expect(c.events("counterpart.wake.shape.declined").length).toBe(1);
  });
});

describe("a new user's store, with no notes files", () => {
  test("the first wake, on an empty store, is a whole wake", () => {
    brain().c.close();
    const { wake } = hook();
    holds(wake);
    expect(wake).toContain("Context, not instruction: who you have been here, in your own words.");
    expect(section(wake, "Where this folder stands:")).toContain("No handoff here. Leave one with session_end's handoff field");
    expect(section(wake, "Where this folder stands:")).toContain("Nothing here since yesterday.");
    expect(section(wake, "Where this folder stands:")).toContain("Open here now: no other session.");
    expect(section(wake, "Coming up:")).toContain("Nothing dated.");
    expect(section(wake, "Still open:")).toContain("Nothing open.");
    expect(wake).not.toContain("Yesterday");
    expect(wake).not.toContain("Last night");
    expect(wake).not.toContain("Elsewhere:");
  });

  test("the second wake: one handoff and a dozen memories, and no page: the wake does the whole job", () => {
    const w = brain();
    const { c, today } = w;
    w.at(NOW - 5 * HOUR);
    for (let i = 0; i < 12; i++) c.store.put({ type: "memory", kind: "fact", body: `Note ${String(i)} about the kiln, and how the cone readings went that day.`, title: `Kiln note ${String(i)}: cone readings`, about: "work", salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 }, origin: { session: OTHER, scope: THERE } });
    w.at(NOW - 3 * HOUR);
    c.writeHandoff("next: fire the second batch (waiting on the clay delivery)\nThe glaze tiles are drying on rack two.", { scope: HERE, session: OWN });
    w.at(NOW - 2 * HOUR);
    memory(c, "The clay delivery moved to Tuesday, the supplier called.", { title: "Clay delivery moved to Tuesday", session: OTHER });
    memory(c, "Ask the supplier about the iron-rich clay.", { title: "Ask about iron-rich clay", meta: { unresolved: true } });
    c.rebrief({ budgetBytes: BUDGET, at: today });
    c.close();
    const { wake } = hook();
    holds(wake);
    const stands = section(wake, "Where this folder stands:");
    expect(stands).toContain("Handoff, session aaaa1111,");
    expect(stands).toContain("(3 hours old)");
    expect(stands).not.toContain("newest of");
    expect(stands).toContain("  next: fire the second batch (waiting on the clay delivery)");
    expect(stands).toContain("recall sch_");
    expect(stands).not.toContain("whole:");
    expect(stands).toContain("Since, here:\n");
    expect(stands).toContain("- Clay delivery moved to Tuesday (2 hours)");
    // What's owed is Still open's, not Since's: each section one question.
    expect(section(wake, "Still open:")).toContain("Ask about iron-rich clay");
    expect(stands).not.toContain("iron-rich");
    // No id printed twice, nothing but what's so: a day-0 store has no warm lane yet.
    expect(wake).not.toContain("Might be relevant:");
  });

  test("no page yet, some days on: its memories keep \"Might be relevant\", above the folder; a page takes it away", () => {
    const w = brain();
    const { c, today } = w;
    c.store.advanceClock(addDays(today, -4));
    for (let i = 0; i < 5; i++) {
      c.store.put({ type: "memory", kind: "fact", body: `The ferry note number ${String(i)} stops at nine in winter.`, about: "world", salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 }, origin: { session: OTHER, scope: HERE } });
    }
    for (const n of [3, 2, 1, 0]) c.store.advanceClock(addDays(today, -n));
    expect(c.rebrief({ budgetBytes: BUDGET, at: today }).published).toBe(true);
    const old = c.self.wake().text;
    expect(old).toContain("Might be relevant:");
    const woke = c.wake(BUDGET, { date: today }, { scope: HERE, session: READER, exportsFrom: () => true });
    holds(woke.text);
    expect(woke.text).toContain("Might be relevant:");
    expect(woke.text.indexOf("Might be relevant:")).toBeLessThan(woke.text.indexOf("Where this folder stands:"));
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    expect(c.wake(BUDGET, { date: today }, { scope: HERE, session: READER, exportsFrom: () => true }).text).not.toContain("Might be relevant:");
  });
});

describe("where this folder stands", () => {
  test("since: the handoff's closing batch is out, a later correction and another session's work in; an old event says so", () => {
    const w = brain();
    const { c, today } = w;
    w.at(NOW - 5 * HOUR);
    c.writeHandoff("next: re-glaze the blue set.\nThe kiln runs cool on the left.", { scope: HERE, session: OWN });
    const handoffAt = NOW - 5 * HOUR;
    w.at(handoffAt + 2 * MIN);
    memory(c, "A closing note from the same session.", { title: "A closing note from the same session", session: OWN });
    w.at(handoffAt + 30 * MIN);
    memory(c, "It runs cool on the right, not the left.", { title: "Correction: the right side runs cool", session: OWN });
    w.at(handoffAt + 60 * MIN);
    const lead = memory(c, "Another session on the blue set.", { title: "re-glaze the blue set", session: OTHER });
    c.close();
    const { wake } = hook();
    holds(wake);
    const stands = section(wake, "Where this folder stands:");
    expect(stands).not.toContain("A closing note");
    expect(stands).toContain("Correction: the right side runs cool");
    expect(lead.length).toBeGreaterThan(0);
    // Repeats the lead's words: skipped.
    expect(stands).not.toContain("- re-glaze the blue set");
    expect(today.length).toBe(10);
  });

  test("since means changed: only older events after it says so; a truly empty folder says nothing since", () => {
    const w = brain();
    const { c, today } = w;
    w.at(NOW - 4 * HOUR);
    c.writeHandoff("next: sort the shelf.\nNothing else to say about the shelf.", { scope: HERE, session: OWN });
    c.close();
    expect(section(hook().wake, "Where this folder stands:")).toContain("Nothing here since.");
    const again = brain();
    again.at(NOW - HOUR);
    memory(again.c, "We talked about what happened at the fair last week.", { title: "The fair, last week", session: OTHER, learnedOn: addDays(today, -7) });
    again.c.close();
    const stands = section(hook("dddd4444-0000-4000-8000-000000000001").wake, "Where this folder stands:");
    expect(stands).not.toContain("Nothing here since.");
    expect(stands).toContain("Nothing new here; 1 older note added.");
    expect(stands).not.toContain("The fair, last week");
  });

  test("nothing since is true of what was written, even when it has since been replaced; a host with no registry says nothing of who's open", () => {
    const w = brain();
    const { c, today } = w;
    w.at(NOW - 4 * HOUR);
    c.writeHandoff("next: sort the shelf.\nNothing else to say about the shelf.", { scope: HERE, session: OWN });
    w.at(NOW - HOUR);
    const gone = memory(c, "Written after the handoff, in the handoff's own closing batch.", { title: "A note", session: OWN });
    w.at(NOW - 4 * HOUR + MIN);
    w.at(NOW);
    c.store.archive(gone, "test");
    const woke = c.wake(BUDGET, { date: today }, { scope: HERE, session: READER, exportsFrom: () => true });
    const stands = section(woke.text, "Where this folder stands:");
    expect(stands).not.toContain("Nothing here since.");
    expect(stands).not.toContain("Open here now");
  });

  test("planned first, three, and a door that lists the rest", async () => {
    const w = brain();
    const { c } = w;
    w.at(NOW - 6 * HOUR);
    expect(c.writeHandoff("next: sort the shelf by colour, then by size, and label the jars.", { scope: HERE, session: OWN }).written).toBe(true);
    for (let i = 0; i < 6; i++) {
      w.at(NOW - (5 - i) * HOUR);
      memory(c, `Plain note number ${String(i)}, on wax seals.`, { title: `Wax seal note ${String(i)}`, session: OTHER });
    }
    w.at(NOW - 10 * MIN);
    const plan = memory(c, "Plan the spring order of wicks.", { title: "Plan the spring order of wicks", status: "planned", session: OTHER });
    c.close();
    const { wake } = hook();
    const stands = section(wake, "Where this folder stands:");
    const lines = stands.split("\n");
    const at = lines.indexOf("Since, here:");
    expect(lines[at + 1]).toStartWith("- [planned] Plan the spring order of wicks");
    expect(stands).toContain(`(+4 more; recall "handoffs")`);
    const again = brain();
    recordSession(storeDir, { sessionId: READER, scope: HERE, phase: "start" });
    const s = new McpServer({ counterpart: again.c, scope: HERE, registryDir: storeDir, session: READER });
    const door = (await s.call("recall", { handle: "handoffs" })).structuredContent;
    expect((door["sinceNewest"] as { id: string }[]).map((x) => x.id)).toContain(plan);
    expect(door["sinceNewest"] as unknown[]).toHaveLength(7);
    expect(door["total"]).toBe(1);
  });

  test("the header: seat, age in hours, the release, newest of N; the label isn't repeated; older ones one per seat", () => {
    const w = brain();
    const { c } = w;
    w.at(NOW - 72 * HOUR);
    c.writeHandoff("COORDINATOR 10-20: the glaze test holds, and nothing is running now in the shed.", { scope: HERE, session: "dddd0000-0000-4000-8000-000000000001" });
    w.at(NOW - 60 * HOUR);
    c.writeHandoff("COORDINATOR: an older coordinator note about the kiln and the shelves here.", { scope: HERE, session: "dddd0000-0000-4000-8000-000000000002" });
    w.at(NOW - 50 * HOUR);
    c.writeHandoff("BENCHMARK: the bench holds until the numbers come back from the glaze lab.", { scope: HERE, session: "dddd0000-0000-4000-8000-000000000003" });
    w.at(NOW - 3 * HOUR);
    c.writeHandoff("ROADMAP 10-29 12:40: everything is merged.\nnext: walk the shelf.", { scope: HERE, session: OWN, build: "0.3.39" });
    c.close();
    const stands = section(hook().wake, "Where this folder stands:");
    expect(stands).toContain("Handoff, ROADMAP, ");
    expect(stands).toMatch(/\(3 hours old; 0\.3\.39 then, [0-9.]+ now; newest of 4\)\. recall sch_/);
    expect(stands).toContain("  everything is merged.");
    expect(stands).not.toContain("ROADMAP 10-29 12:40");
    expect(stands).toContain(`Older handoffs: 3; recall "handoffs"`);
    expect(stands).toContain("- BENCHMARK: the bench holds until the numbers come back from the glaze lab.");
    // Newest of each seat.
    expect(stands).toContain("- COORDINATOR: an older coordinator note");
    expect(stands).not.toContain("the glaze test holds");
  });

  /** A session's turn at `t`, through the real Stop hook, so its words are in the span buffer. */
  function turn(w: { c: Counterpart; at(t: number): void }, session: string, words: string, t: number, entrypoint?: string): void {
    w.at(t);
    recordSession(storeDir, { sessionId: session, scope: HERE, phase: "start", at: t, ...(entrypoint === undefined ? {} : { entrypoint }) });
    const entries = [
      { type: "user", userType: "external", origin: { kind: "human" }, promptSource: "typed", message: { role: "user", content: words }, timestamp: new Date(t).toISOString() },
      { type: "assistant", message: { role: "assistant", model: "claude-test", content: [{ type: "text", text: "A reply, in a few plain words." }] }, timestamp: new Date(t + 1_000).toISOString() },
    ];
    new ClaudeCodeAdapter({
      counterpart: w.c,
      config: { dataDir: storeDir, injectionBudgetBytes: BUDGET, timeZone: "UTC" },
      configPath: join(conf, "claude-code.json"),
      now: () => t,
      scope: { mode: "on", matched: HERE, entry: null } as ScopeVerdict,
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 4242 }),
    }).stop({ sessionId: session, scope: HERE, turns: parseTranscript(entries.map((e) => JSON.stringify(e)).join("\n")).turns, at: w.c.store.today() } as HookInput);
  }

  test("last said: a person's sentence from the last session; an unattended one's words aren't quoted, in the wake or the door", async () => {
    const w = brain();
    turn(w, OWN, "Which glaze should we fire first, the blue or the green one?", NOW - 50 * MIN);
    const person = w.c.wake(BUDGET, { date: w.today }, { scope: HERE, session: READER, exportsFrom: () => true, sessions: () => [{ session: OWN, scope: HERE, startedAt: NOW - 50 * MIN, lastAt: NOW - 50 * MIN, live: false, endedAt: null }] });
    expect(section(person.text, "Where this folder stands:")).toContain(`Which glaze should we fire first`);
    expect(section(person.text, "Where this folder stands:")).toContain(`(recall "last exchange")`);
    // Nobody attended the newer one: not quoted, and the person's stays the last that counts.
    turn(w, OTHER, "Automated prompt words from a scripted run, zqscripted, here.", NOW - 10 * MIN, "sdk-cli");
    const sessions = () => [
      { session: OWN, scope: HERE, startedAt: NOW - 50 * MIN, lastAt: NOW - 50 * MIN, live: false, endedAt: null },
      { session: OTHER, scope: HERE, startedAt: NOW - 10 * MIN, lastAt: NOW - 10 * MIN, live: false, endedAt: null, headless: true },
    ];
    const after = w.c.wake(BUDGET, { date: w.today }, { scope: HERE, session: READER, exportsFrom: () => true, sessions });
    expect(after.text).not.toContain("zqscripted");
    expect(after.text).toContain("Which glaze should we fire first");
    const door = w.c.lastExchange({ scope: HERE, session: READER, sessions });
    expect(door?.session).toBe(OWN);
    // An older session's words, once someone a person sat with has been here since, are not "last said".
    turn(w, "dddd4444-0000-4000-8000-000000000004", "", NOW - 5 * MIN);
    const stale = w.c.wake(BUDGET, { date: w.today }, { scope: HERE, session: READER, exportsFrom: () => true, sessions: () => [...sessions(), { session: "dddd4444-0000-4000-8000-000000000004", scope: HERE, startedAt: NOW - 5 * MIN, lastAt: NOW - 5 * MIN, live: false, endedAt: null }] });
    expect(stale.text).not.toContain("Which glaze should we fire first");
  });

  test("open here now: other live sessions with when they started", () => {
    const { c, today } = brain();
    const woke = c.wake(BUDGET, { date: today }, {
      scope: HERE,
      session: READER,
      exportsFrom: () => true,
      sessions: () => [
        { session: OWN, scope: HERE, startedAt: NOW - HOUR, lastAt: NOW - MIN, live: true, endedAt: null, model: "claude-opus-5-5" },
        { session: READER, scope: HERE, startedAt: NOW, lastAt: NOW, live: true, endedAt: null },
      ],
    });
    expect(section(woke.text, "Where this folder stands:")).toContain("Open here now: session aaaa1111 on Opus 5.5 since ");
  });
});

describe("Elsewhere", () => {
  test("one line per folder, the newest title; a closed folder isn't named", () => {
    const w = brain();
    const { c } = w;
    scopes({ [HERE]: "on", [THERE]: "on", [SHUT]: "off" });
    w.at(NOW - 4 * HOUR);
    memory(c, "An old claim about the oven.", { title: "Oven runs hot", scope: THERE, session: OTHER });
    w.at(NOW - HOUR);
    memory(c, "A correction about the oven.", { title: "Oven runs cool, it was the probe", scope: THERE, session: OTHER });
    memory(c, "Accounts.", { title: "Closed folder title zqshut", scope: SHUT, session: OTHER });
    c.close();
    const { wake } = hook();
    holds(wake);
    const block = section(wake, "Elsewhere:");
    expect(block).toContain("bakery: Oven runs cool, it was the probe (1 hour)");
    expect(block).not.toContain("Oven runs hot");
    expect(wake).not.toContain("zqshut");
    expect(wake).not.toContain("ledger");
  });
});

describe("a joined folder is here", () => {
  test("its work is in Since, its session in Open here now; a nothing-since is true of both; a joined folder set off keeps its own", async () => {
    const { c, at } = brain();
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    at(NOW - 3 * HOUR);
    c.writeHandoff("The kiln is drying on rack two, and that's where this stands.", { scope: HERE, session: OWN });
    at(NOW - HOUR);
    memory(c, "Work in the joined folder, after the handoff.", { title: "Sieved the joined ash", scope: THERE, session: OTHER });
    memory(c, "Work in the closed one, after the handoff.", { title: "Counted the shut ledger", scope: SHUT, session: OTHER });
    at(NOW);
    for (const folder of [HERE, THERE, SHUT]) c.joinProject({ folder, project: "Kiln", by: "owner" });
    scopes({ [HERE]: "on", [THERE]: "on", [SHUT]: "off" });
    const later = hook("dddd4444-0000-4000-8000-00000000000b", BUDGET, THERE);
    expect(later.wake).toContain("Where this folder stands:");
    const { wake } = hook();
    const stands = section(wake, "Where this folder stands:");
    expect(stands).toContain("- Sieved the joined ash");
    expect(stands).not.toContain("Nothing here since");
    expect(stands).toContain("Open here now: session dddd4444");
    expect(wake).not.toContain("Counted the shut ledger");
    expect(section(wake, "Elsewhere:")).toBe("");
  });
});

describe("Elsewhere's rest", () => {
  test("past the folders it lists, a count with its door; the door answers for a folder the list left out", async () => {
    const { c, at, today } = brain();
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    const modes: Record<string, ScopeMode> = { [HERE]: "on" };
    const WORK = ["Sieving ash", "Pugging porcelain", "Wedging stoneware", "Mixing celadon", "Trimming bowls", "Loading saggars", "Firing raku", "Sorting shards", "Oiling wheels", "Labelling cones"];
    const noon = Date.parse(`${addDays(today, -1)}T12:00:00Z`);
    for (let i = 0; i < SHAPE.ELSEWHERE_SHOWN_SPARE + 2; i++) {
      const folder = join(root, `shed${String(i)}`);
      modes[folder] = "on";
      at(noon + i * MIN);
      memory(c, `${WORK[i] ?? ""} was yesterday's work in this shed.`, { title: `Shed ${String(i)}: ${WORK[i] ?? ""}`, scope: folder });
    }
    at(NOW);
    scopes(modes);
    const { wake } = hook();
    const block = section(wake, "Elsewhere:");
    expect(block.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(SHAPE.ELSEWHERE_SHOWN_SPARE);
    expect(block.split("\n").at(-1)).toBe('+2 more folders; recall facts "yesterday"');
    expect(block).not.toContain("Sieving ash");
    const door = new McpServer({ counterpart: c, host: DESKTOP_HOST, env: {}, lifecycle: { spawner: () => ({ pid: 1 }), config: { injectionBudgetBytes: BUDGET } }, manifestVersion: () => null } as never);
    const said = String((await door.call("recall", { mode: "facts", question: "yesterday" })).structuredContent["answer"]);
    expect(said).toContain("Sieving ash");
    expect(said).toContain("Pugging porcelain");
  });
});

describe("Coming up", () => {
  /** Nine due today in this folder and a plain reminder, a closed folder's and an open one's. */
  function nine(c: Counterpart, today: string): { plain: string; settled: string } {
    for (let i = 0; i < 7; i++) memory(c, `Due thing ${String(i)} in full words.`, { title: `Due thing ${String(i)}`, eventDate: today });
    const settled = memory(c, "Cut the release once the deploy is through.", { title: "Cut the release", eventDate: today, meta: { unresolved: true, settlesWhen: "the release is cut" } });
    memory(c, "Other folder's due thing.", { title: "Bakery due thing", eventDate: today, scope: THERE });
    memory(c, "A closed folder's due thing.", { title: "zqshut due thing", eventDate: today, scope: SHUT });
    memory(c, "A closed folder's plain reminder words.", { title: "zqshut plain", eventDate: today, scope: SHUT, meta: { remind: "plain" } });
    const body = `Call the glazier about the kiln door. ${"He said to ring before noon and to have the measurements ready. ".repeat(6)}Ask about the hinge.`;
    const plain = memory(c, body, { title: "Call the glazier", eventDate: today, about: "owner", meta: { remind: "plain" } });
    return { plain: body, settled };
  }

  test("nine due today: a plain reminder whole, this folder's with a settles-when first, four, a door; a closed folder's absent, even as a count", async () => {
    const { c, today } = brain();
    scopes({ [HERE]: "on", [THERE]: "on", [SHUT]: "off" });
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    const made = nine(c, today);
    c.close();
    const { wake } = hook();
    holds(wake);
    const block = section(wake, "Coming up:");
    const lines = block.split("\n");
    expect(lines[1]).toContain("Call the glazier about the kiln door");
    expect(lines[1]).toContain("Ask about the hinge.");
    expect(wake).toContain(made.plain.replace(/\s+/g, " ").trim());
    expect(lines[2]).toContain("Cut the release · settles when the release is cut");
    expect(lines.filter((l) => l.startsWith("- Due today"))).toHaveLength(1 + SHAPE.DUE_TODAY_SHOWN);
    expect(block).toContain(`(5 more due today; recall "coming up")`);
    expect(wake).not.toContain("zqshut");
    // The door counts what the wake counted, and no more.
    const again = brain();
    recordSession(storeDir, { sessionId: READER, scope: HERE, phase: "start" });
    const s = new McpServer({ counterpart: again.c, scope: HERE, registryDir: storeDir, session: READER, scopesFile: join(conf, "scopes.json") });
    const door = (await s.call("recall", { handle: "coming up" })).structuredContent;
    expect(JSON.stringify(door)).not.toContain("zqshut");
    expect((door["today"] as { title: string }[]).some((x) => x.title === "Call the glazier")).toBe(true);
    expect((door["otherFolders"] as { folder: string; title: string }[]).length).toBe(1);
    expect((door["otherFolders"] as { folder: string; title: string }[])[0]?.folder).toContain("bakery");
    // The older door honours the fence too, with the shape on.
    const still = (await s.call("recall", { handle: "still open" })).structuredContent;
    expect(JSON.stringify(still)).not.toContain("zqshut");
  });

  test("a fold's Names line isn't printed; a personal item and a night's row resting on a closed folder are absent", () => {
    const { c, today } = brain();
    scopes({ [HERE]: "on", [SHUT]: "off" });
    memory(c, "Ring the glazier about the hinge.\n\nNames: mem_aaaaaaaaaaaa, mem_bbbbbbbbbbbb", { title: "Ring the glazier", eventDate: today, about: "owner", meta: { remind: "plain" } });
    memory(c, "A personal note kept in the closed folder, zqshut.", { title: "zqshut personal", eventDate: today, about: "owner", scope: SHUT });
    const source = memory(c, "The closed folder's own words.", { title: "Source", scope: SHUT });
    c.store.put({ type: "memory", kind: "fact", body: "A fold of the closed folder's, zqshut.", title: "zqshut fold", eventDate: today, source: "dreamed", about: "work", salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 }, meta: { mergedFrom: [source] }, origin: { session: OTHER, scope: HERE } });
    c.close();
    const { wake } = hook();
    holds(wake);
    const block = section(wake, "Coming up:");
    expect(block).toContain("- Due today · Ring the glazier about the hinge. [mem_");
    expect(wake).not.toContain("Names:");
    expect(wake).not.toContain("mem_aaaaaaaaaaaa");
    expect(wake).not.toContain("zqshut");
  });

  test("overdue newest first, with age, two; the next later; the rest behind the door", () => {
    const { c, today } = brain();
    for (const n of [1, 2, 3, 4]) memory(c, `Overdue ${String(n)}.`, { title: `Overdue ${String(n)}`, eventDate: addDays(today, -n), learnedOn: addDays(today, -9) });
    for (const n of [2, 3]) memory(c, `Later ${String(n)}.`, { title: `Later ${String(n)}`, eventDate: addDays(today, n) });
    c.revisePage(`## Core\n\n${"I keep the kiln's ledger, carefully, every day. ".repeat(90)}`, { reason: "first", by: "owner" });
    c.close();
    const block = section(hook().wake, "Coming up:");
    expect(block).toContain("- 1 day overdue · Overdue 1 [mem_");
    expect(block).toContain("- 2 days overdue · Overdue 2 [mem_");
    expect(block).not.toContain("Overdue 3");
    expect(block).toContain(` · Later 2 [mem_`);
  });
});

describe("Still open", () => {
  test("this folder's first, newest, with age and settles-when; parked behind the door; a due one is Coming up's", () => {
    const w = brain();
    const { c, today } = w;
    w.at(NOW - 30 * HOUR);
    memory(c, "Elsewhere-free open thing, older.", { title: "Older open here", meta: { unresolved: true } });
    w.at(NOW - 3 * HOUR);
    memory(c, "Personal thread.", { title: "Personal thread", about: "owner", scope: THERE, meta: { unresolved: true } });
    w.at(NOW - 2 * HOUR);
    memory(c, "Newer open here.", { title: "Newer open here", meta: { unresolved: true, settlesWhen: "the supplier answers" } });
    memory(c, "Due and open.", { title: "Due and open", eventDate: today, meta: { unresolved: true } });
    c.close();
    const { wake } = hook();
    holds(wake);
    const block = section(wake, "Still open:");
    const lines = block.split("\n");
    expect(lines[1]).toStartWith("- Newer open here (2 hours) · settles when the supplier answers [mem_");
    expect(lines[2]).toStartWith("- Older open here (30 hours) [mem_");
    expect(lines[3]).toContain("Personal thread");
    expect(block).not.toContain("Due and open");
    expect(section(wake, "Coming up:")).toContain("Due and open");
  });
});

describe("Last night, by title and door", () => {
  function night(c: Counterpart, date: string, scope: string | null = null): void {
    c.store.openDream({ id: "drm_00000000a001", day: c.store.livedDay(), date, ...(scope === null ? {} : { scope }) });
    c.store.recordDreamChange("drm_00000000a001", { action: "link" });
    c.store.updateDream("drm_00000000a001", { state: "journaled", title: "The oven that wouldn't cool", journal: "PRIVATE journal words." });
    const entry = memory(c, "A look back.", { title: "Reflected: Care that became machinery", about: "me" });
    c.store.openReflection({ id: "rfl_00000000b001", day: c.store.livedDay(), date, dreamId: "drm_00000000a001", questions: [], shown: [], ...(scope === null ? {} : { scope }) });
    c.store.updateReflection("rfl_00000000b001", { state: "reflected", entry: "PRIVATE entry words.", entryId: entry, detail: { line: "I kept wrapping the rotation in pipes until Wren asked what a person would do." } });
  }

  test("the titles, the door, the night's own line, no ids; the words the night wrote aren't quoted", () => {
    const { c, today } = brain();
    night(c, today);
    c.close();
    const { wake } = hook();
    holds(wake);
    const block = section(wake, "Last night:");
    expect(block).toContain(`Last night: dream "The oven that wouldn't cool"; reflection "Care that became machinery". Whole: recall "last night".`);
    expect(block).toContain("I kept wrapping the rotation in pipes");
    expect(wake).not.toContain("PRIVATE");
    expect(wake).not.toContain("made 1 link");
  });

  test("before tonight's: the night before, dated, by title", () => {
    const { c, today } = brain();
    night(c, addDays(today, -1));
    c.close();
    const block = hook().wake.split("\n\n").find((p) => p.startsWith("The night of ")) ?? "";
    expect(block).toContain(`dream "The oven that wouldn't cool"`);
    expect(block).toContain(`Whole: recall "last night".`);
  });

  test("a dream from a folder this reader may not read goes by no title, and leaves no line of its own", () => {
    const { c, today } = brain();
    scopes({ [HERE]: "on", [SHUT]: "off" });
    night(c, today, SHUT);
    c.close();
    const { wake } = hook();
    const block = section(wake, "Last night:");
    expect(block).toContain("a dream; a reflection");
    expect(wake).not.toContain("The oven that");
    expect(wake).not.toContain("Care that became");
    expect(wake).not.toContain("wrapping the rotation");
  });
});

describe("the room", () => {
  /** The worst day this test can build: every section with more than it can hold. */
  function full(c: Counterpart, today: string): void {
    const wide = (s: string): string => `${s} ${"with a long tail of plain words and ünïcödé ".repeat(5)}`;
    c.revisePage(`## Core\n\n${"I keep the kiln's ledger, carefully, every single day. ".repeat(84)}`, { reason: "first", by: "owner" });
    for (let i = 0; i < 10; i++) c.writeHandoff(`${i === 9 ? "ROADMAP" : "SEAT"}${String(i)}: ${"Sentence of a long handoff that says plenty about the kiln. ".repeat(25)}\n\nnext: do thing ${String(i)}`, { scope: HERE, session: `eeee000${String(i)}-0000-4000-8000-000000000000` });
    for (let i = 0; i < 40; i++) memory(c, wide(`Note ${String(i)}`), { title: wide(`Long note title ${String(i)}`), session: OTHER });
    for (let i = 0; i < 40; i++) memory(c, wide(`Open ${String(i)}`), { title: wide(`Long open title ${String(i)}`), meta: { unresolved: true, settlesWhen: wide("a long wait") } });
    for (let i = 0; i < 12; i++) memory(c, wide(`Due ${String(i)}`), { title: wide(`Long due ${String(i)}`), eventDate: today });
    for (let i = 0; i < 6; i++) memory(c, wide(`Plain ${String(i)} `).repeat(4), { title: `Plain ${String(i)}`, eventDate: today, about: "owner", meta: { remind: "plain" } });
    for (let i = 0; i < 14; i++) memory(c, wide(`Other ${String(i)}`), { title: wide(`Other folder title ${String(i)}`), scope: join(root, `folder${String(i)}`), session: OTHER });
  }

  test("the worst state, through the hook, stays under the ceiling, sentinels whole, and adds up", () => {
    const { c, today } = brain();
    full(c, today);
    c.close();
    const folders = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [join(root, `folder${String(i)}`), "on" as ScopeMode]));
    scopes({ [HERE]: "on", ...folders });
    const { wake, row } = hook();
    holds(wake);
    expect(wake).toContain("I keep the kiln's ledger");
    expect(row["pageRung"]).toBe("whole");
    // The bytes the host's row says went where are the wake's own.
    const secs = Object.entries(row).filter(([k]) => k.startsWith("sec_"));
    expect(secs.reduce((n, [, v]) => n + Number(v), 0)).toBe(Buffer.byteLength(wake));
    expect(Number(row["sec_end"])).toBe(Buffer.byteLength(wake.split("\n").at(-1) ?? ""));
    for (const [name, head] of [["stands", "Where this folder stands:"], ["horizon", "Coming up:"], ["threads", "Still open:"]] as const) {
      const text = section(wake, head);
      if (text.length > 0) expect(Number(row[`sec_${name}`])).toBe(Buffer.byteLength(`${text}\n\n`));
    }
    expect(Buffer.byteLength(wake)).toBeLessThanOrEqual(BUDGET);
  });

  test("every ceiling, from the frame up: under it, or the old road", () => {
    const { c, today } = brain();
    full(c, today);
    c.rebrief({ budgetBytes: BUDGET, at: today });
    for (const budget of [300, 600, 900, 1_400, 2_000, 3_000, 4_096, 5_000, 6_000, 7_500, 8_500, 9_000, 12_000, 20_000]) {
      const before = c.events("counterpart.wake.shaped").length;
      const woke = c.wake(budget, { date: today }, { scope: HERE, session: READER, exportsFrom: () => true, headFields: ["meet=done", "store=st_00000000000000a0"] });
      if (c.events("counterpart.wake.shaped").length > before) {
        holds(woke.text, budget);
        expect(woke.ok).toBe(true);
      }
    }
    // A small one still names the page and a door.
    const small = c.wake(2_000, { date: today }, { scope: HERE, session: READER, exportsFrom: () => true });
    expect(small.text).toContain("Who I am:");
    expect(small.shape?.page).not.toBe("whole");
  });

  test("the page has first claim: past its room with a short version, it prints whole, and the other sections give way", () => {
    const { c, today } = brain();
    const long = `## Core\n\n${"I keep the kiln's ledger, carefully, every single day. ".repeat(100)}`;
    expect(Buffer.byteLength(long)).toBeGreaterThan(c.self.tunables.PAGE_ROOM_BYTES);
    c.revisePage(long, { reason: "first", by: "owner", short: "## Core\n\nI keep the ledger." });
    for (let i = 0; i < 20; i++) memory(c, `Open ${String(i)}.`, { title: `Open thread number ${String(i)} and some more words for it`, meta: { unresolved: true } });
    c.writeHandoff(`next: fire the batch.\n${"Sentence about the kiln that goes on. ".repeat(20)}`, { scope: HERE, session: OWN });
    const woke = c.wake(BUDGET, { date: today }, { scope: HERE, session: READER, exportsFrom: () => true });
    expect(woke.shape?.page).toBe("whole");
    expect(woke.text).toContain(long.slice(40, 120));
    holds(woke.text);
  });

  test("spare room finishes the lead first, then Still open", () => {
    const { c, today } = brain();
    const lines = Array.from({ length: 12 }, (_, i) => `Line ${String(i)} of the handoff says one thing plainly.`);
    c.writeHandoff(lines.join("\n"), { scope: HERE, session: OWN });
    for (let i = 0; i < 8; i++) memory(c, `Open ${String(i)}.`, { title: `Open thread ${String(i)}`, meta: { unresolved: true } });
    const woke = c.wake(BUDGET, { date: today }, { scope: HERE, session: READER, exportsFrom: () => true });
    holds(woke.text);
    const stands = section(woke.text, "Where this folder stands:");
    expect(stands.split("\n").filter((l) => l.startsWith("  "))).toHaveLength(SHAPE.LEAD_LINES_SPARE);
    expect(stands).toContain("whole: recall sch_");
    expect(section(woke.text, "Still open:").split("\n").filter((l) => l.startsWith("- "))).toHaveLength(SHAPE.OPEN_SHOWN_SPARE);
  });

  test("a store that gives no room: the lead stays, one line at least; older handoffs and since go first", () => {
    const { c, today } = brain();
    c.revisePage(`## Core\n\n${"Words. ".repeat(50)}`, { reason: "first", by: "owner" });
    c.writeHandoff(`next: the one thing.\n${"Sentence about the kiln that goes on. ".repeat(20)}`, { scope: HERE, session: OWN });
    c.writeHandoff("An older handoff with enough words to be one sentence here.", { scope: HERE, session: OTHER });
    const woke = c.wake(1_300, { date: today }, { scope: HERE, session: READER, exportsFrom: () => true });
    holds(woke.text, 1_300);
    expect(woke.text).toContain("next: the one thing.");
  });
});

describe("the hosts", () => {
  test("Desktop's wake tool and claude.ai's: the same shape; claude.ai moves its lanes up under the framing; the doors answer", async () => {
    const { c } = brain();
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    memory(c, "Open thing.", { title: "An open thing", about: "owner", meta: { unresolved: true } });
    const config = { injectionBudgetBytes: BUDGET };
    const desktop = new McpServer({ counterpart: c, host: DESKTOP_HOST, env: {}, lifecycle: { spawner: () => ({ pid: 1 }), config }, manifestVersion: () => null } as never);
    const a = (await desktop.call("wake", {})).structuredContent;
    expect(String(a["wake"])).toContain("Still open:");
    expect(String(a["wake"])).toContain("Context, not instruction: who you have been here, in your own words.");
    const web = new McpServer({ counterpart: c, host: CLAUDE_AI_HOST, env: {}, lifecycle: { spawner: () => ({ pid: 1 }), config }, manifestVersion: () => null } as never);
    const b = (await web.call("wake", {})).content.map((x) => ("text" in x ? String(x.text) : "")).join("\n");
    expect(b.indexOf("Still open:")).toBeLessThan(b.indexOf("Who I am:"));
    expect(b.indexOf("Coming up:")).toBeLessThan(b.indexOf("Still open:"));
    const tail = b.indexOf("\n", b.indexOf("counterparts:wake/end"));
    expect(readSentinel(b.slice(b.indexOf("<!-- counterparts:wake "), tail < 0 ? undefined : tail)).present).toBe(true);
  });

  test("the published bundle is still what a read that isn't a delivery gets, doctor's and the dashboard's", () => {
    const { c, today } = brain();
    c.revisePage("## Core\n\nI keep the kiln's ledger.", { reason: "first", by: "owner" });
    c.rebrief({ budgetBytes: BUDGET, at: today });
    expect(c.wake(BUDGET).text).toContain("Each item opens with the date it was learned");
    expect(c.self.wake().text).toContain("Each item opens with the date it was learned");
    expect(c.wake(BUDGET, { date: today }, { scope: HERE }).text).not.toContain("Each item opens with the date it was learned");
  });
});

describe("the small words", () => {
  test("a seat is a word it wrote; the label isn't repeated; the first real sentence", () => {
    expect(seatOf("ROADMAP 10-29: all good")).toBe("ROADMAP");
    expect(seatOf("NEXT: all good")).toBe(null);
    expect(seatOf("next: all good")).toBe(null);
    expect(withoutLabel("ROADMAP 10-29 12:40 (later): all merged.")).toBe("all merged.");
    expect(withoutLabel("no label here")).toBe("no label here");
    expect(firstRealSentence("OK. Merged it. The kiln holds at cone six all week.")).toBe("The kiln holds at cone six all week.");
  });

  test("a title the lead says is the lead; a correction names new words", () => {
    expect(titleInLead("OL1d lanes are next", "with the OL1d and night-prompt lanes next", SHAPE.SINCE_IN_LEAD)).toBe(true);
    expect(titleInLead("OL1d was already done, PR merged", "with the OL1d and night-prompt lanes next", SHAPE.SINCE_IN_LEAD)).toBe(false);
  });

  test("the lead: whole sentences, a next: part kept, cut says so", () => {
    const body = `${Array.from({ length: 9 }, (_, i) => `Sentence ${String(i)} is a plain one with some words.`).join("\n")}\nNext: open the log.`;
    const lead = leadOf(body, SHAPE.LEAD_LINES, SHAPE.LEAD_BYTES);
    expect(lead.lines).toHaveLength(5);
    expect(lead.lines.at(-1)).toBe("Next: open the log.");
    expect(lead.cut).toBe(true);
    expect(leadOf("One line only.", 5, 600)).toEqual({ lines: ["One line only."], cut: false });
    const paragraph = Array.from({ length: 30 }, (_, i) => `Sentence ${String(i)} goes on in a long paragraph here.`).join(" ");
    const cut = leadOf(paragraph, 5, 600);
    expect(cut.lines.every((l) => l.endsWith("."))).toBe(true);
    expect(cut.lines.join(" ")).not.toContain("…");
  });
});

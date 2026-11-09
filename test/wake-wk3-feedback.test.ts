/**
 * WK3 (2026-11-09): THE WAKE, AS A COUNTERPART READ IT FIVE MORNINGS RUNNING.
 *
 * A counterpart's own feedback on its session-start wake (roadmap brief WK3,
 * lightly held), each point checked on the bytes the real SessionStart hook
 * prints — a child process, on a store this file builds:
 *
 *   1. "N due today, shown earlier" only when the telling is in THIS
 *      session's context (a resume); a new session, a compaction or a /clear
 *      gets the items by title and id instead;
 *   2. one telling of a moment per wake: the night's own line is not a page
 *      sentence again, and the same line two mornings running is a clause;
 *   3. overdue items are a count with a door, never folded into "more here";
 *   4. a handoff whose lead waits on the owner with nothing since sinks below a
 *      fresher one, and one past a week that nothing refers to isn't listed;
 *      an Elsewhere line always says when and what;
 *   5. "Last said" quotes a whole sentence when one fits; "under way" never
 *      after the dream journaled; the wake names its session.
 *
 * Hermetic (CLAUDE.md): a fresh temp dir per test, removed afterwards; the hook
 * runs with COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 and a temp HOME. Every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_CODE_BUDGET_BYTES } from "../src/adapters/config.js";
import { recordSession } from "../src/adapters/sessions.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeMode } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";
import { WAKE_SHAPE_KEY } from "../src/core/counterpart-wake-shape.js";
import type { WakeSession } from "../src/core/counterpart-types.js";
import { readSentinel } from "../src/core/self/index.js";
import { addDays, monthDay } from "../src/core/time.js";
import { LAST_EXCHANGE_SENTENCE_BYTES, quoteOf } from "../src/core/handoff/last-exchange.js";

const BUDGET = CLAUDE_CODE_BUDGET_BYTES;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const OWN = "aaaa1111-0000-4000-8000-000000000001";
const OTHER = "bbbb2222-0000-4000-8000-000000000002";
const READER = "cccc3333-0000-4000-8000-000000000003";

let root: string;
let storeDir: string;
let conf: string;
let HERE: string;
let THERE: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-wk3-")));
  storeDir = join(root, "store");
  conf = join(root, "conf");
  HERE = join(root, "garden");
  THERE = join(root, "bakery");
  for (const d of [HERE, THERE, conf]) mkdirSync(d, { recursive: true });
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

function brain(): { c: Counterpart; at(t: number): void; today: string } {
  let clock = NOW;
  const c = Counterpart.open({ dir: storeDir, now: () => clock, timeZone: "UTC", budgetBytes: BUDGET, identity: { name: "Wren" } });
  open.push(c);
  c.store.setMeta(WAKE_SHAPE_KEY, "on");
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

function scopes(modes: Readonly<Record<string, ScopeMode>>): void {
  let reg = null;
  for (const [dir, mode] of Object.entries(modes)) reg = setScope(reg, dir, mode, { at: "2026-09-22" });
  if (reg !== null) writeScopes(join(conf, "scopes.json"), reg);
}

/** The real SessionStart hook, a child process: the wake block as the model gets it. */
function hook(session = READER, o: { cwd?: string; source?: string } = {}): string {
  const config = join(conf, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: storeDir, injectionBudgetBytes: BUDGET, timeZone: "UTC" }));
  if (!existsSync(join(conf, "scopes.json"))) scopes({ [HERE]: "on", [THERE]: "on" });
  const r = spawnSync(process.execPath, ["run", new URL("../src/adapters/claude-code/bin/hook.ts", import.meta.url).pathname], {
    encoding: "utf8",
    input: JSON.stringify({ session_id: session, hook_event_name: "SessionStart", source: o.source ?? "startup", cwd: o.cwd ?? HERE }),
    env: { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_DATA_DIR: storeDir, COUNTERPARTS_CONFIG: config, HOME: join(root, "home") },
  });
  expect(r.status).toBe(0);
  const model = r.stdout.startsWith("{") ? String((JSON.parse(r.stdout) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? "") : r.stdout;
  const at = model.indexOf("<!-- counterparts:wake ");
  const end = model.indexOf("\n", model.indexOf("<!-- counterparts:wake/end"));
  const wake = at < 0 ? model : model.slice(at, end < 0 ? undefined : end);
  if (process.env["WK3_DUMP"] === "1") console.log(`\n===== ${session} ${o.source ?? "startup"} (${String(Buffer.byteLength(wake, "utf8"))} B)\n${wake}`);
  return wake;
}

function section(wake: string, head: string): string {
  return wake.split("\n\n").find((p) => p.startsWith(head)) ?? "";
}

function intact(wake: string): void {
  const s = readSentinel(wake);
  expect(s.present).toBe(true);
  expect(s.intact).toBe(true);
  expect(s.actualBytes).toBeLessThanOrEqual(BUDGET);
}

const PAGE_MOMENT = "On the third I left the kiln door open overnight and the whole glaze batch cracked.";
const PAGE = `## Core\n\nI keep the kiln's ledger, and I check the door before I leave.\n\n## Lately\n\n${PAGE_MOMENT} I own that slip, and the ledger now has a door line.`;

function night(c: Counterpart, date: string, id: string, line: string): void {
  const dream = `drm_${id}`;
  c.store.openDream({ id: dream, day: c.store.livedDay(), date });
  c.store.recordDreamChange(dream, { action: "link" });
  c.store.updateDream(dream, { state: "journaled", title: "The cooling shelf", journal: "PRIVATE journal words." });
  const entry = memory(c, "A look back at the week.", { title: "Reflected: A ledger with a door line", about: "me" });
  c.store.openReflection({ id: `rfl_${id}`, day: c.store.livedDay(), date, dreamId: dream, questions: [], shown: [] });
  c.store.updateReflection(`rfl_${id}`, { state: "reflected", entry: "PRIVATE entry words.", entryId: entry, detail: { line } });
}

const plain = (c: Counterpart, title: string, today: string): string => memory(c, `${title}: carry the seed trays to the cold frame before noon.`, { title, eventDate: today, meta: { remind: "plain" } });

describe("1. \"shown earlier\" points at something", () => {
  test("a new session gets the items told in another session by title and id; only a resume of the same session folds them", () => {
    const { c, today } = brain();
    c.revisePage(PAGE, { reason: "first", by: "owner" });
    const ids = ["Tray one", "Tray two", "Tray three"].map((t) => plain(c, t, today));
    c.close();
    // A minute back, not an hour: "started today" must hold in a run just after midnight.
    recordSession(storeDir, { sessionId: OWN, scope: HERE, phase: "start", at: NOW - MIN });
    const first = hook(OWN);
    for (const id of ids) expect(section(first, "Coming up:")).toContain(`[${id}]`);
    expect(first).not.toContain("shown earlier");

    // Another session, the same day: the telling is not in its context.
    const second = hook(READER);
    intact(second);
    const coming = section(second, "Coming up:");
    expect(coming).not.toContain("shown earlier");
    for (const [i, id] of ids.entries()) expect(coming).toContain(`- Due today · ${["Tray one", "Tray two", "Tray three"][i] ?? ""} [${id}]`);
    // By title: the body is not told again.
    expect(coming).not.toContain("carry the seed trays");

    // A compaction or a /clear of the first session: its model lost what it was shown.
    for (const source of ["compact", "clear"]) {
      const lost = section(hook(OWN, { source }), "Coming up:");
      expect(lost).not.toContain("shown earlier");
      for (const id of ids) expect(lost).toContain(`[${id}]`);
    }
    // A resume hands no new wake ("the wake it was handed … still holds"); a wake
    // composed again for the same session, its context kept, is the one that folds.
    expect(hook(OWN, { source: "resume" })).not.toContain("Coming up:");
    // The hooks give a session one wake (a second start of it is turned away), so the
    // fold is read where it is composed: a wake for that same session, its context kept.
    const { c: again } = brain();
    const sessions = (): WakeSession[] => [{ session: OWN, scope: HERE, startedAt: NOW - MIN, lastAt: NOW, live: true }];
    const woke = again.wake(BUDGET, { date: today }, { scope: HERE, session: OWN, source: "startup", sessions, exportsFrom: () => true });
    expect(section(woke.text, "Coming up:")).toBe(`Coming up:\n(3 due today, shown earlier in this session; recall "coming up")`);
    // The same read for another session shows them by title.
    const other = again.wake(BUDGET, { date: today }, { scope: HERE, session: READER, source: "startup", sessions, exportsFrom: () => true });
    expect(section(other.text, "Coming up:")).toContain(`- Due today · Tray one [${ids[0] ?? ""}]`);
  });
});

describe("2. one telling of a moment", () => {
  test("the night's own line restating a page sentence is not the wake's last line; a line that carries something forward is", () => {
    const { c, today } = brain();
    c.revisePage(PAGE, { reason: "first", by: "owner" });
    night(c, today, "00000000a001", `${PAGE_MOMENT}`);
    c.close();
    const wake = hook();
    intact(wake);
    expect(wake.split(PAGE_MOMENT).length - 1).toBe(1);
    const last = section(wake, "Last night:");
    expect(last).toContain(`Whole: recall "last night".`);
    expect(last).not.toContain("glaze batch cracked");
  });

  test("a line that isn't on the page stays, whole", () => {
    const { c, today } = brain();
    c.revisePage(PAGE, { reason: "first", by: "owner" });
    night(c, today, "00000000a002", "Next I want to try the slower cooling curve on the small shelf first.");
    c.close();
    expect(section(hook(), "Last night:")).toContain("Next I want to try the slower cooling curve on the small shelf first.");
  });

  test("the same line two mornings running: the second morning it is a clause", () => {
    const w = brain();
    const { c, today } = w;
    c.revisePage(PAGE, { reason: "first", by: "owner" });
    const line = "The cracked batch still sits with me; next time the door gets checked twice, and the shelf log gets a line.";
    w.at(NOW - DAY);
    c.store.advanceClock(addDays(today, -1));
    night(c, addDays(today, -1), "00000000a003", line);
    c.close();
    // Yesterday's wake told it whole.
    const y = brain();
    y.at(NOW - DAY + HOUR);
    y.c.close();
    const yesterday = hook(OWN);
    expect(yesterday).toContain(line);
    const t = brain();
    t.c.store.advanceClock(today);
    night(t.c, today, "00000000a004", "The cracked batch still sits with me; next time the door gets checked twice, and the shelf log gets its line.");
    t.c.close();
    const last = section(hook(), "Last night:");
    expect(last).toContain("The cracked batch still sits with me");
    expect(last).not.toContain("shelf log");
  });
});

describe("3. overdue items are said", () => {
  test("past what's listed, a count with its oldest date and the door", () => {
    const { c, today } = brain();
    c.revisePage(PAGE, { reason: "first", by: "owner" });
    const days = [1, 2, 3, 4, 5];
    for (const d of days) memory(c, `Overdue note ${String(d)}: repaint the potting shed's north door.`, { title: `Repaint shed door, part ${String(d)}`, eventDate: addDays(today, -d) });
    c.close();
    const wake = hook();
    intact(wake);
    const coming = section(wake, "Coming up:");
    expect(coming).toContain("overdue");
    // Two listed, newest first; the rest counted with the oldest date, never folded into "more here".
    expect(coming).toContain(`(3 more overdue (oldest ${monthDay(addDays(today, -5))}); recall "coming up")`);
    expect(coming).not.toContain("more here");
    expect(coming).toContain(`recall "coming up"`);
  });

  test("another folder's overdue items are counted as overdue there, never listed here", () => {
    const { c, today } = brain();
    c.revisePage(PAGE, { reason: "first", by: "owner" });
    for (const d of [2, 4, 6]) memory(c, `Bakery overdue ${String(d)}: descale the proofing drawer.`, { title: `Descale proofing drawer ${String(d)}`, eventDate: addDays(today, -d), scope: THERE });
    c.close();
    const coming = section(hook(), "Coming up:");
    expect(coming).toBe(`Coming up:\n(3 in other folders (3 overdue, oldest ${monthDay(addDays(today, -6))}); recall "coming up")`);
  });
});

describe("4. stale handoffs sink", () => {
  test("a handoff whose lead waits on the owner with nothing since ranks below a fresher one", () => {
    const w = brain();
    const { c } = w;
    c.revisePage(PAGE, { reason: "first", by: "owner" });
    w.at(NOW - 61 * HOUR);
    const asked = memory(c, "Which glaze should the spring batch use? Wren to pick.", { title: "Spring glaze: Wren to pick", status: "asked", session: OWN });
    w.at(NOW - 60 * HOUR);
    c.writeHandoff("SHELF: build the cooling rack once the stain dries.\nThe rack sizes are in the shelf log.", { scope: HERE, session: OTHER });
    w.at(NOW - 40 * HOUR);
    c.writeHandoff(`GLAZE: waiting on Wren to pick the spring glaze [${asked}].\nThe test tiles are on rack two.`, { scope: HERE, session: OWN });
    // Its own closing batch, written just after it: an echo of the sunk handoff, not news under the new lead.
    w.at(NOW - 40 * HOUR + 2 * MIN);
    memory(c, "The test tiles for the spring glaze sit on rack two.", { title: "Glaze test tiles on rack two", session: OWN });
    c.close();
    const wake = hook();
    intact(wake);
    expect(wake).not.toContain("Glaze test tiles on rack two");
    const stands = section(wake, "Where this folder stands:");
    expect(stands.indexOf("build the cooling rack")).toBeGreaterThanOrEqual(0);
    expect(stands.indexOf("build the cooling rack")).toBeLessThan(stands.indexOf("glaze"));
    // It says a newer one sank, so "newest" is never untrue; the sunk one is still listed.
    expect(stands).toContain("1 newer one waiting on an answer, below");
    expect(stands).not.toContain("newest of");
    expect(stands).toContain(`- GLAZE: waiting on Wren to pick the spring glaze [${asked}].`);
  });

  test("a signal since (a memory here on its subject) keeps it leading; so does being fresh", () => {
    const w = brain();
    const { c } = w;
    c.revisePage(PAGE, { reason: "first", by: "owner" });
    w.at(NOW - 61 * HOUR);
    const asked = memory(c, "Which glaze should the spring batch use? Wren to pick.", { title: "Spring glaze: Wren to pick", status: "asked", session: OWN });
    w.at(NOW - 60 * HOUR);
    c.writeHandoff("SHELF: build the cooling rack once the stain dries.\nThe rack sizes are in the shelf log.", { scope: HERE, session: OTHER });
    w.at(NOW - 40 * HOUR);
    c.writeHandoff(`GLAZE: waiting on Wren to pick the spring glaze [${asked}].\nThe test tiles are on rack two.`, { scope: HERE, session: OWN });
    w.at(NOW - 3 * HOUR);
    memory(c, "Wren leaned towards the celadon for the spring glaze, a final word tomorrow.", { title: "Spring glaze: Wren leaning celadon", session: READER.replace("cccc", "ffff") });
    c.close();
    const stands = section(hook(), "Where this folder stands:");
    expect(stands.indexOf("GLAZE")).toBeLessThan(stands.indexOf("SHELF"));
    expect(stands).toContain("newest of 2");
  });

  test("a handoff past a week that nothing refers to isn't listed; one referred to is", () => {
    const w = brain();
    const { c, today } = w;
    c.revisePage(PAGE, { reason: "first", by: "owner" });
    c.store.advanceClock(addDays(today, -10));
    w.at(NOW - 10 * DAY);
    c.writeHandoff("FENCE: mend the fence by the gate before the sheep come back.", { scope: HERE, session: "dddd4444-0000-4000-8000-000000000004" });
    c.store.advanceClock(addDays(today, -9));
    w.at(NOW - 9 * DAY);
    const kept = c.writeHandoff("WELL: test the well pump before the dry week starts.", { scope: HERE, session: "eeee5555-0000-4000-8000-000000000005" });
    for (const n of [8, 3, 2, 1]) c.store.advanceClock(addDays(today, -n));
    w.at(NOW - 2 * HOUR);
    memory(c, `Pump test moved, see ${kept.id ?? ""}.`, { title: "Pump test moved", session: OTHER });
    c.writeHandoff("BEDS: turn the compost in bed three after the frost lifts.", { scope: HERE, session: OWN });
    c.store.advanceClock(today);
    c.close();
    const stands = section(hook(), "Where this folder stands:");
    expect(stands).toContain("turn the compost");
    expect(stands).toContain("test the well pump");
    expect(stands).not.toContain("mend the fence");
  });
});

describe("4b. Elsewhere says when and what", () => {
  test("a live folder with nothing written says since when and that it's quiet; every titled line carries its age", () => {
    const w = brain();
    const { c } = w;
    c.revisePage(PAGE, { reason: "first", by: "owner" });
    w.at(NOW - 2 * HOUR);
    memory(c, "The proofing drawer holds at 27 degrees now.", { title: "Proofing drawer holds steady", scope: join(root, "pantry") });
    memory(c, "The sourdough starter was fed twice today.", { title: "Starter fed twice", scope: join(root, "cellar") });
    c.close();
    mkdirSync(join(root, "pantry"), { recursive: true });
    mkdirSync(join(root, "cellar"), { recursive: true });
    scopes({ [HERE]: "on", [THERE]: "on", [join(root, "pantry")]: "on", [join(root, "cellar")]: "on" });
    recordSession(storeDir, { sessionId: OTHER, scope: THERE, phase: "start", at: NOW - 30 * MIN });
    const lines = section(hook(), "Elsewhere:").split("\n");
    const live = lines.find((l) => l.startsWith("- bakery"));
    expect(live).toMatch(/^- bakery \(live\): open since \d\d:\d\d, nothing written there since yesterday$/);
    // Same age, each line still says it.
    for (const l of lines.filter((x) => x.startsWith("- pantry") || x.startsWith("- cellar"))) expect(l).toMatch(/\(2 hours\)$/);
  });
});

describe("5. the small things", () => {
  test("\"Last said\" quotes a first sentence whole when it fits, and marks what follows", () => {
    expect(quoteOf("Tomorrow I finish the seed-tray ladder and then the watering log. After that, the gate.")).toBe("Tomorrow I finish the seed-tray ladder and then the watering log. …");
    expect(quoteOf("Short and done.")).toBe("Short and done.");
    const long = `${"a very long run of words without an end ".repeat(8)}here.`;
    expect(quoteOf(long).endsWith("…")).toBe(true);
    expect(Buffer.byteLength(quoteOf(long), "utf8")).toBeLessThanOrEqual(LAST_EXCHANGE_SENTENCE_BYTES);
  });

  test("the wake names its session, for the tools that need it", () => {
    const { c } = brain();
    c.revisePage(PAGE, { reason: "first", by: "owner" });
    c.close();
    const wake = hook(READER);
    intact(wake);
    expect(wake).toContain(READER);
  });

  test("a journaled dream with the run flag still set is not \"under way\"", () => {
    const { c, today } = brain();
    c.revisePage(PAGE, { reason: "first", by: "owner" });
    night(c, today, "00000000a005", "Next I want to try the slower cooling curve on the small shelf first.");
    c.dreams.recordNightRun({ run: "nrn_00000000c001", date: today, state: "started", kind: "night", session: OWN, startedAt: NOW - 10 * MIN, endedAt: null, reason: null, detail: null, code: null, dream: null, reflection: null, timeoutMs: HOUR });
    c.close();
    const wake = hook();
    expect(wake).not.toContain("under way");
    expect(section(wake, "Last night:")).toContain(`dream "The cooling shelf"`);
  });

  test("a journaled dream and a reflection still to finish: the dream, then \"the reflection is under way\"", () => {
    const { c, today } = brain();
    c.revisePage(PAGE, { reason: "first", by: "owner" });
    c.store.openDream({ id: "drm_00000000a006", day: c.store.livedDay(), date: today });
    c.store.recordDreamChange("drm_00000000a006", { action: "link" });
    c.store.updateDream("drm_00000000a006", { state: "journaled", title: "The cooling shelf", journal: "PRIVATE journal words." });
    c.store.openReflection({ id: "rfl_00000000b006", day: c.store.livedDay(), date: today, dreamId: "drm_00000000a006", questions: [], shown: [] });
    c.dreams.recordNightRun({ run: "nrn_00000000c002", date: today, state: "started", kind: "night", session: OWN, startedAt: NOW - 10 * MIN, endedAt: null, reason: null, detail: null, code: null, dream: null, reflection: null, timeoutMs: HOUR });
    c.close();
    const block = section(hook(), "Last night:");
    expect(block).toStartWith(`Last night: dream "The cooling shelf"; the reflection is under way.`);
    expect(block).not.toContain("begun, not finished");
    expect(block).not.toContain("PRIVATE");
  });
});

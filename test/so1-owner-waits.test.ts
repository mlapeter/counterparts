/**
 * SO1 STEP 4, REVISED (Mike 11-07, lightly held): WHAT WAITS ON THE OWNER IS
 * RAISED BY RELEVANCE, BACKS OFF, THEN PARKS.
 *
 * Checked on the bytes the real SessionStart hook prints (a child process, on a
 * store this file builds), over simulated lived days (the store's `livedDay`):
 *
 *   1. an `asked` item is said once per wake, as "Waiting on <owner>, ask when
 *      it fits", never as one of Still open's lines; after each unanswered
 *      raise it waits its step (at session start at least a week), and after
 *      the last step it parks: out of the wake, listed parked under
 *      `recall "still open"`; a revision starts the chain again;
 *   2. one raise per item per lived day, shared by every session and folder
 *      (the day latch), and a headless (agent) session neither sees nor raises;
 *   3. a handoff WK3 sank (it waits on the owner and led twice) gets the same
 *      mention, or it would be hidden for good (coordinator, 11-09);
 *   4. the order is by relevance to this folder's week, then the oldest.
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
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeMode } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";
import { OWNER_ITEMS_KEY, WAKE_SHAPE_KEY } from "../src/core/counterpart-wake-shape.js";
import { OWNER_RAISED_EVENT, OWNER_RAISED_KEY, raiseRecord, waitState } from "../src/core/owner-waits.js";
import { readSentinel } from "../src/core/self/index.js";
import { WAKE_SHAPE_LIMITS } from "../src/core/self/tunables.js";

const BUDGET = CLAUDE_CODE_BUDGET_BYTES;
const MIN = 60_000;
const HOUR = 60 * MIN;
const OWN = "aaaa1111-0000-4000-8000-000000000001";
const OTHER = "bbbb2222-0000-4000-8000-000000000002";
/** A fresh session id per wake, all the same length (the wake's head names it). */
const sid = (n: number): string => `cccc3333-0000-4000-8000-${String(n).padStart(12, "0")}`;
const START = 20;

let root: string;
let storeDir: string;
let conf: string;
let HERE: string;
let THERE: string;
const open: { close(): void }[] = [];
let next = 0;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-so1-4-")));
  storeDir = join(root, "store");
  conf = join(root, "conf");
  HERE = join(root, "garden");
  THERE = join(root, "bakery");
  for (const d of [HERE, THERE, conf]) mkdirSync(d, { recursive: true });
  next = 100;
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

function brain(): { c: Counterpart; at(t: number): void } {
  let clock = NOW;
  const c = Counterpart.open({ dir: storeDir, now: () => clock, timeZone: "UTC", budgetBytes: BUDGET, identity: { name: "Wren" } });
  open.push(c);
  c.store.setMeta(WAKE_SHAPE_KEY, "on");
  c.store.setMeta("livedDay", String(START));
  return { c, at: (t) => void (clock = t) };
}

function asked(c: Counterpart, body: string, title: string, more: { scope?: string; about?: string; settlesWhen?: string } = {}): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    title,
    status: "asked",
    meta: { unresolved: true, ...(more.settlesWhen === undefined ? {} : { settlesWhen: more.settlesWhen }) },
    about: (more.about ?? "work") as "work",
    salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 },
    origin: { session: OWN, scope: more.scope ?? HERE },
  });
}

function note(c: Counterpart, body: string, title: string, more: { unresolved?: boolean } = {}): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    title,
    ...(more.unresolved === true ? { meta: { unresolved: true } } : {}),
    about: "work" as const,
    salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 },
    origin: { session: OTHER, scope: HERE },
  });
}

function scopes(modes: Readonly<Record<string, ScopeMode>>): void {
  let reg = null;
  for (const [dir, mode] of Object.entries(modes)) reg = setScope(reg, dir, mode, { at: "2026-09-22" });
  if (reg !== null) writeScopes(join(conf, "scopes.json"), reg);
}

/** The real SessionStart hook, a child process, in a new session: the wake block as the model gets it. */
function hook(o: { cwd?: string; session?: string; entrypoint?: string } = {}): string {
  const config = join(conf, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: storeDir, injectionBudgetBytes: BUDGET, timeZone: "UTC" }));
  if (!existsSync(join(conf, "scopes.json"))) scopes({ [HERE]: "on", [THERE]: "on" });
  const session = o.session ?? sid((next += 1));
  const env: Record<string, string | undefined> = { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_DATA_DIR: storeDir, COUNTERPARTS_CONFIG: config, HOME: join(root, "home") };
  if (o.entrypoint === undefined) delete env["CLAUDE_CODE_ENTRYPOINT"];
  else env["CLAUDE_CODE_ENTRYPOINT"] = o.entrypoint;
  delete env["CLAUDE_CODE_SESSION_ATTENDED"];
  const r = spawnSync(process.execPath, ["run", new URL("../src/adapters/claude-code/bin/hook.ts", import.meta.url).pathname], {
    encoding: "utf8",
    input: JSON.stringify({ session_id: session, hook_event_name: "SessionStart", source: "startup", cwd: o.cwd ?? HERE }),
    env,
  });
  expect(r.status).toBe(0);
  const model = r.stdout.startsWith("{") ? String((JSON.parse(r.stdout) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? "") : r.stdout;
  const at = model.indexOf("<!-- counterparts:wake ");
  const end = model.indexOf("\n", model.indexOf("<!-- counterparts:wake/end"));
  const wake = at < 0 ? model : model.slice(at, end < 0 ? undefined : end);
  if (process.env["SO1_DUMP"] === "1") console.log(`\n===== ${session} (${String(Buffer.byteLength(wake, "utf8"))} B)\n${wake}`);
  const s = readSentinel(wake);
  expect(s.present).toBe(true);
  expect(s.intact).toBe(true);
  return wake;
}

/** The real UserPromptSubmit hook, a child process: what the model is handed with the turn. */
function prompt(text: string, o: { cwd?: string; session?: string; entrypoint?: string } = {}): string {
  const config = join(conf, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: storeDir, injectionBudgetBytes: BUDGET, timeZone: "UTC" }));
  if (!existsSync(join(conf, "scopes.json"))) scopes({ [HERE]: "on", [THERE]: "on" });
  const session = o.session ?? sid((next += 1));
  const env: Record<string, string | undefined> = { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_DATA_DIR: storeDir, COUNTERPARTS_CONFIG: config, HOME: join(root, "home"), CLAUDE_CODE_ENTRYPOINT: o.entrypoint ?? "cli" };
  delete env["CLAUDE_CODE_SESSION_ATTENDED"];
  const r = spawnSync(process.execPath, ["run", new URL("../src/adapters/claude-code/bin/hook.ts", import.meta.url).pathname], {
    encoding: "utf8",
    input: JSON.stringify({ session_id: session, hook_event_name: "UserPromptSubmit", prompt: text, cwd: o.cwd ?? HERE }),
    env,
  });
  expect(r.status).toBe(0);
  const out = r.stdout.startsWith("{") ? String((JSON.parse(r.stdout) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? "") : r.stdout;
  if (process.env["SO1_DUMP"] === "1") console.log(`\n----- turn ${session}\n${out}`);
  return out;
}

function section(wake: string, head: string): string {
  return wake.split("\n\n").find((p) => p.startsWith(head)) ?? "";
}

/** The lived day the store believes: what a night's clock would have moved it to. */
function liveOn(c: Counterpart, day: number): void {
  c.store.setMeta("livedDay", String(day));
}

const WAITING = "Waiting on Wren, ask when it fits:";

describe("the backoff, as a rule", () => {
  test("3, then 7, then 14 lived days after each unanswered raise, then parked (no weekly floor)", () => {
    const steps = WAKE_SHAPE_LIMITS.OWNER_RAISE_STEPS;
    expect([...steps]).toEqual([3, 7, 14]);
    // Raised on day 0: due again on day 3, not before.
    expect(waitState([0], 2, steps, 0).kind).toBe("waiting");
    expect(waitState([0], 3, steps, 0).kind).toBe("due");
    // Then on day 10 (3 + 7), then waiting out 14 more, then parked on day 24.
    expect(waitState([0, 3], 9, steps, 0).kind).toBe("waiting");
    expect(waitState([0, 3], 10, steps, 0).kind).toBe("due");
    expect(waitState([0, 3, 10], 23, steps, 0).kind).toBe("waiting");
    expect(waitState([0, 3, 10], 24, steps, 0).kind).toBe("parked");
    // Raised today: the day latch, whatever the steps.
    expect(waitState([5], 5, [0, 0, 0], 0).kind).toBe("waiting");
  });

  test("at session start the week is the floor: 7, 7, 14, then parked", () => {
    expect(waitState([0], 6).kind).toBe("waiting");
    expect(waitState([0], 7).kind).toBe("due");
    expect(waitState([0, 7], 13).kind).toBe("waiting");
    expect(waitState([0, 7], 14).kind).toBe("due");
    expect(waitState([0, 7, 14], 27).kind).toBe("waiting");
    expect(waitState([0, 7, 14], 28).kind).toBe("parked");
  });
});

describe("1. an item waiting on the owner backs off, then parks", () => {
  test("raised on day 0, quiet on day 3, raised on days 7 and 14, parked from day 28; a revision starts again", () => {
    const { c } = brain();
    const id = asked(c, "Which glaze should the spring batch use? Wren picks between celadon and tenmoku.", "Spring glaze: celadon or tenmoku", { settlesWhen: "Wren picks one" });
    const plain = note(c, "Build the cooling rack once the stain dries.", "Cooling rack to build", { unresolved: true });
    const raised = (): number[] => [...(raiseRecord(c.store)[id]?.days ?? [])];

    // Day 0: said once, as the ask, with what settles it; the plain open item is a line as before.
    const w0 = section(hook(), "Still open:");
    expect(w0).toContain(`${WAITING} Spring glaze: celadon or tenmoku`);
    expect(w0).toContain("· settles when Wren picks one");
    expect(w0).toContain(`[${id}]`);
    expect(w0).toContain(`[${plain}]`);
    expect(w0.split(id).length - 1).toBe(1);
    expect(raised()).toEqual([START]);

    // Day 3: inside the week: not said, and not one of Still open's lines either.
    liveOn(c, START + 3);
    const w3 = hook();
    expect(w3).not.toContain(id);
    expect(section(w3, "Still open:")).toContain(`[${plain}]`);

    // Day 7: raised again, and it says it was raised before.
    liveOn(c, START + 7);
    const w7 = section(hook(), "Still open:");
    expect(w7).toContain(`${WAITING} Spring glaze: celadon or tenmoku`);
    expect(w7).toContain("raised 1 time before, unanswered");
    liveOn(c, START + 14);
    expect(section(hook(), "Still open:")).toContain("raised 2 times before, unanswered");
    expect(raised()).toEqual([START, START + 7, START + 14]);

    // Day 27: waiting out the last step; day 28: parked. Out of the wake, counted parked, listed parked.
    liveOn(c, START + 27);
    expect(hook()).not.toContain(id);
    liveOn(c, START + 28);
    const w28 = hook();
    expect(w28).not.toContain(id);
    // Two: this one, and the cooling rack, untouched past P2's 14 lived days.
    expect(section(w28, "Still open:")).toContain("2 parked");
    expect(c.stillOpen({ scope: HERE }).items.find((i) => i.id === plain)?.parked).toBe(true);
    const listed = c.stillOpen({ scope: HERE }).items.find((i) => i.id === id);
    expect(listed?.parked).toBe(true);
    expect(raised()).toEqual([START, START + 7, START + 14]);
    expect(c.store.eventLog({ name: OWNER_RAISED_EVENT, ref: id }).length).toBe(3);

    // A revision answers it: the chain starts again at the new version.
    c.store.revise(id, { body: "Which glaze should the spring batch use? Wren now leans celadon, a last look at the tiles first." });
    liveOn(c, START + 29);
    expect(section(hook(), "Still open:")).toContain(WAITING);
    expect(c.stillOpen({ scope: HERE }).items.find((i) => i.id === id)?.parked).toBeUndefined();
  });
});

describe("2. one raise a day, shared; nobody there, no raise", () => {
  test("a personal item: raised in one folder, not again that day in another session or folder; again a week on, in either", () => {
    const { c } = brain();
    const id = asked(c, "Wren's passport renewal: which photo to send.", "Passport photo: Wren to choose", { about: "owner" });
    expect(section(hook({ cwd: HERE }), "Still open:")).toContain(`${WAITING} Passport photo: Wren to choose`);
    // The same lived day: another session here, and one in another folder, say nothing of it.
    expect(hook({ cwd: HERE })).not.toContain(id);
    expect(hook({ cwd: THERE })).not.toContain(id);
    expect(c.store.eventLog({ name: OWNER_RAISED_EVENT, ref: id }).length).toBe(1);
    // A week on, the other folder raises it (it may cross: it's personal), and the first folder then doesn't.
    liveOn(c, START + 7);
    expect(section(hook({ cwd: THERE }), "Still open:")).toContain(`${WAITING} Passport photo: Wren to choose`);
    expect(hook({ cwd: HERE })).not.toContain(id);
    expect(raiseRecord(c.store)[id]?.days).toEqual([START, START + 7]);
  });

  test("a work item stays in its own folder: another folder never says it", () => {
    const { c } = brain();
    const id = asked(c, "Which flour supplier for the spring loaves? Wren to pick.", "Flour supplier: Wren to pick", { scope: THERE });
    expect(hook({ cwd: HERE })).not.toContain(id);
    expect(c.store.getMeta(OWNER_RAISED_KEY)).toBeUndefined();
    expect(section(hook({ cwd: THERE }), "Still open:")).toContain(`${WAITING} Flour supplier: Wren to pick`);
  });

  test("a headless (agent) session neither says it nor raises it; the next attended one does", () => {
    const { c } = brain();
    const id = asked(c, "Which glaze should the spring batch use? Wren to pick.", "Spring glaze: Wren to pick");
    const agent = hook({ entrypoint: "sdk-cli" });
    expect(agent).not.toContain(id);
    expect(c.store.eventLog({ name: OWNER_RAISED_EVENT, ref: id }).length).toBe(0);
    expect(section(hook({ entrypoint: "cli" }), "Still open:")).toContain(`${WAITING} Spring glaze: Wren to pick`);
    expect(c.store.eventLog({ name: OWNER_RAISED_EVENT, ref: id }).length).toBe(1);
  });
});

describe("3. a handoff WK3 sank gets its weekly mention", () => {
  test("waits on the owner, led twice, sank below a fresher one: said as the ask, then backs off like the rest", () => {
    const w = brain();
    const { c } = w;
    w.at(NOW - 60 * HOUR);
    c.writeHandoff("SHELF: build the cooling rack once the stain dries.\nThe rack sizes are in the shelf log.", { scope: HERE, session: OTHER });
    w.at(NOW - 40 * HOUR);
    const glaze = c.writeHandoff("GLAZE: waiting on Wren to pick the spring glaze.\nThe test tiles are on rack two.", { scope: HERE, session: OWN });
    const gid = glaze.id ?? "";
    expect(gid.length).toBeGreaterThan(0);
    w.at(NOW);
    // It leads two wakes (no mention yet: it hasn't sunk), then sinks.
    for (let i = 0; i < WAKE_SHAPE_LIMITS.LEAD_SHOWN_SINK; i++) expect(section(hook(), "Still open:")).not.toContain(WAITING);
    const sunk = hook();
    const stands = section(sunk, "Where this folder stands:");
    expect(stands).toContain("Handoff, SHELF");
    expect(stands).toContain("1 newer one waiting on an answer, below");
    // Shown once: said as the ask below, so not also its pointer line here.
    expect(stands).not.toContain("- GLAZE");
    const still = section(sunk, "Still open:");
    expect(still).toContain(`${WAITING} GLAZE: waiting on Wren to pick the spring glaze.`);
    expect(still).toContain(`· a handoff, below the others [${gid}]`);
    expect(raiseRecord(c.store)[gid]).toMatchObject({ kind: "handoff", days: [START] });
    // Not again today; a week on, again.
    expect(section(hook(), "Still open:")).not.toContain(gid);
    liveOn(c, START + 7);
    expect(section(hook(), "Still open:")).toContain("raised 1 time before, unanswered");
  });
});

describe("4. the order is by relevance to this folder's week", () => {
  test("the item this week's work is about comes first, though younger; the other comes in the next session", () => {
    const w = brain();
    const { c } = w;
    w.at(NOW - 5 * 24 * HOUR);
    const old = asked(c, "Which invoice template for the market stall? Wren to choose.", "Stall invoice template: Wren to choose");
    w.at(NOW - 2 * 24 * HOUR);
    const kiln = asked(c, "Which kiln shelf wash to order? Wren to choose.", "Kiln shelf wash: Wren to choose");
    w.at(NOW - 3 * HOUR);
    note(c, "Loaded the kiln shelves for the bisque firing; the shelf wash is flaking.", "Kiln shelves loaded, wash flaking");
    w.at(NOW);
    const first = section(hook(), "Still open:");
    expect(first).toContain(`[${kiln}]`);
    expect(first).not.toContain(old);
    // One a wake: the next session says the other, the kiln one waiting its week.
    const second = section(hook(), "Still open:");
    expect(second).toContain(`[${old}]`);
    expect(second).not.toContain(kiln);
  });

  test("with nothing to tell them apart, the oldest first", () => {
    const w = brain();
    const { c } = w;
    w.at(NOW - 5 * 24 * HOUR);
    const older = asked(c, "Which ribbon colour for the fair stall? Wren to choose.", "Fair ribbon colour: Wren to choose");
    w.at(NOW - 2 * 24 * HOUR);
    asked(c, "Which lid style for the honey jars? Wren to choose.", "Honey jar lids: Wren to choose");
    w.at(NOW);
    expect(section(hook(), "Still open:")).toContain(`[${older}]`);
  });
});

describe("5. the relevance lane: a turn that touches it raises it", () => {
  const KILN = "Which kiln shelf wash to order? Wren to choose between the two suppliers.";
  const ASK = "Waiting on Wren, ask when it fits";
  /** Rarity needs a store to be rare in: forty everyday notes, so a word only the item holds weighs what it would on a lived store. */
  const WORDS = ["garden", "kettle", "ladder", "window", "basket", "pencil", "blanket", "lantern", "bucket", "hammer", "teapot", "mirror", "candle", "saddle", "wagon", "button", "pillow", "carpet", "drawer", "shovel"];
  const filled = (): ReturnType<typeof brain> => {
    const b = brain();
    for (let i = 0; i < 40; i++) note(b.c, `Moved the ${WORDS[i % WORDS.length] ?? ""} beside the ${WORDS[(i * 7 + 3) % WORDS.length] ?? ""} today.`, `Day note ${String(i)}`);
    return b;
  };

  test("touched: raised, marked, with what it needs and how long; not again that day; silent on day 2, raised on day 3", () => {
    const w = filled();
    const { c } = w;
    w.at(NOW - 2 * 24 * HOUR);
    const id = asked(c, KILN, "Kiln shelf wash: Wren to choose", { settlesWhen: "Wren picks a supplier" });
    w.at(NOW);
    const first = prompt("The kiln shelf is flaking again; the old wash came off in the bisque firing.");
    expect(first).toContain(`Waiting on Wren, ask when it fits: Kiln shelf wash: Wren to choose · needs: Wren picks a supplier · waiting 2 days [${id}]`);
    const ev = c.store.eventLog({ name: OWNER_RAISED_EVENT, ref: id });
    expect(ev.length).toBe(1);
    expect(JSON.parse(ev[0]?.payload ?? "{}")).toMatchObject({ via: "turn" });
    // Another session, the same lived day: the latch holds.
    expect(prompt("Back at the kiln shelf: the wash is still flaking.")).not.toContain(ASK);
    // Day 2: inside the 3-day step. Day 3: raised again, saying so.
    liveOn(c, START + 2);
    expect(prompt("The kiln shelf wash question again, before the glaze firing.")).not.toContain(ASK);
    liveOn(c, START + 3);
    expect(prompt("The kiln shelf wash question again, before the glaze firing.")).toContain(`raised 1 time before, unanswered [${id}]`);
    expect(raiseRecord(c.store)[id]?.days).toEqual([START, START + 3]);
  });

  test("a turn that doesn't touch it says nothing of it, and raises nothing", () => {
    const { c } = filled();
    const id = asked(c, KILN, "Kiln shelf wash: Wren to choose");
    expect(prompt("Watered the tomatoes and tied up the beans along the fence.")).not.toContain(ASK);
    expect(prompt("The kiln is cooling.")).not.toContain(ASK);
    expect(c.store.eventLog({ name: OWNER_RAISED_EVENT, ref: id }).length).toBe(0);
  });

  test("one backoff: a turn raise on day 0 holds the session-start mention back until the week; another folder's turn never raises it; nor an agent's", () => {
    const { c } = filled();
    const id = asked(c, KILN, "Kiln shelf wash: Wren to choose");
    expect(prompt("The kiln shelf wash is flaking.", { cwd: THERE })).not.toContain(ASK);
    expect(prompt("The kiln shelf wash is flaking.", { entrypoint: "sdk-cli" })).not.toContain(ASK);
    expect(c.store.eventLog({ name: OWNER_RAISED_EVENT, ref: id }).length).toBe(0);
    expect(prompt("The kiln shelf wash is flaking.")).toContain(`${ASK}: Kiln shelf wash: Wren to choose`);
    liveOn(c, START + 3);
    expect(hook()).not.toContain(id);
    liveOn(c, START + 7);
    expect(section(hook(), "Still open:")).toContain(`${WAITING} Kiln shelf wash: Wren to choose`);
  });

  test("a sunk handoff the turn touches comes up too", () => {
    const w = filled();
    const { c } = w;
    w.at(NOW - 60 * HOUR);
    c.writeHandoff("SHELF: build the cooling rack once the stain dries.", { scope: HERE, session: OTHER });
    w.at(NOW - 40 * HOUR);
    const gid = c.writeHandoff("GLAZE: waiting on Wren to pick the spring glaze recipe.", { scope: HERE, session: OWN }).id ?? "";
    w.at(NOW);
    // It leads twice, sinks, and the third wake's mention raises it; a week on, a turn touches it on its 7-day step.
    for (let i = 0; i <= WAKE_SHAPE_LIMITS.LEAD_SHOWN_SINK; i++) hook();
    expect(raiseRecord(c.store)[gid]?.days).toEqual([START]);
    liveOn(c, START + 7);
    expect(prompt("Mixing a test batch of the spring glaze recipe today.")).toContain(`(a handoff) · raised 1 time before, unanswered [${gid}]`);
  });
});

describe("6. rarity, not plain shared words (round 3 of #796)", () => {
  const ASK = "Waiting on Wren, ask when it fits";
  const WORDS = ["garden", "kettle", "ladder", "window", "basket", "pencil", "blanket", "lantern", "bucket", "hammer"];
  /** Forty notes that all say "moved" and "today": two words most of this store holds. */
  const filled = (): ReturnType<typeof brain> => {
    const b = brain();
    for (let i = 0; i < 40; i++) note(b.c, `Moved the ${WORDS[i % WORDS.length] ?? ""} today.`, `Day note ${String(i)}`);
    return b;
  };

  test("two shared words that most memories hold weigh nothing; one rare word alone isn't enough", () => {
    const { c } = filled();
    asked(c, "The kiln was moved today; which shelf does Wren want it on?", "Kiln moved today: Wren to pick its shelf");
    // "moved" and "today" are in every note: worth ~0, so they don't make two words.
    expect(prompt("I moved the basket and the lantern today, the garden looks good.")).not.toContain(ASK);
    // "kiln" alone is one word, however rare.
    expect(prompt("The kiln took ages to cool down this evening, finally.")).not.toContain(ASK);
    expect(prompt("Which shelf should the kiln go on, it's still on the floor?")).toContain(`${ASK}: Kiln moved today: Wren to pick its shelf`);
  });

  test("the folder's list is cached for the day, and a new asked item is seen on the next turn", () => {
    const { c } = filled();
    const S = sid(900);
    expect(prompt("Which shelf should the kiln go on, it's still on the floor?", { session: S })).not.toContain(ASK);
    expect(c.store.getMeta(OWNER_ITEMS_KEY)).toBeDefined();
    asked(c, "The kiln was moved; which shelf does Wren want it on?", "Kiln shelf: Wren to pick");
    expect(prompt("Which shelf should the kiln go on, it's still on the floor?", { session: S })).toContain(`${ASK}: Kiln shelf: Wren to pick`);
  });

  test("a turn of fewer than three content words doesn't look", () => {
    const { c } = filled();
    const id = asked(c, "Which kiln shelf wash to order? Wren to choose.", "Kiln shelf wash: Wren to choose");
    expect(prompt("kiln shelf")).not.toContain(ASK);
    expect(c.store.eventLog({ name: OWNER_RAISED_EVENT, ref: id }).length).toBe(0);
  });

  test("one subject, one chain: a sunk handoff naming an asked memory is that memory's, at the wake and in a turn", () => {
    const w = filled();
    const { c } = w;
    w.at(NOW - 61 * HOUR);
    const id = asked(c, "Which glaze should the spring batch use? Wren to pick.", "Spring glaze recipe: Wren to pick");
    w.at(NOW - 60 * HOUR);
    c.writeHandoff("SHELF: build the cooling rack once the stain dries.", { scope: HERE, session: OTHER });
    w.at(NOW - 40 * HOUR);
    const gid = c.writeHandoff(`GLAZE: waiting on Wren to pick the spring glaze [${id}].`, { scope: HERE, session: OWN }).id ?? "";
    w.at(NOW);
    for (let i = 0; i <= WAKE_SHAPE_LIMITS.LEAD_SHOWN_SINK; i++) hook();
    // The handoff sank, but the memory stands for the subject: its chain, never the handoff's.
    expect(raiseRecord(c.store)[gid]).toBeUndefined();
    expect(raiseRecord(c.store)[id]?.days).toEqual([START]);
    liveOn(c, START + 7);
    expect(prompt("Mixing a test batch of the spring glaze recipe today.")).toContain(`raised 1 time before, unanswered [${id}]`);
    expect(raiseRecord(c.store)[gid]).toBeUndefined();
  });
});

/**
 * THE ELSEWHERE LINES' TITLES IN THE AWKWARD STATES (review of #543,
 * 2026-10-20). `elsewhere-titles.test.ts` pins the rule; this file builds the
 * states a reviewer would worry about, through the real wake and hooks:
 *   - a folder kept apart (off, paused), a confidential memory, one re-marked
 *     owner or confidential after it was written: no title, no count change;
 *   - a status mark does not make a personal memory work: an unmarked person
 *     or self memory, or an unmarked fact from Desktop chat (a name scope),
 *     with a status mark, is not named;
 *   - a credential: in a title the battery refuses the whole entry; in a body
 *     with no title, the first words named are the redacted ones;
 *   - an open thread is never named, in the wake or at a prompt;
 *   - the nightly run's: a write-up the night's runner filed under a folder is
 *     not named by title, and the runner's own record is never "Here, also
 *     open";
 *   - a session idle 3h59m is still open here, 4h01m is not; one that ended
 *     is not;
 *   - the room: four live sessions here and three other folders on long
 *     paths, in a full 9,000-byte wake with the head tag, never push "Last
 *     here" or a dated item out.
 *
 * Hermetic: every test opens a fresh temp dir and removes it; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import type { WakeSession } from "../src/core/counterpart-types.js";
import { Lifecycle } from "../src/adapters/lifecycle.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeVerdict } from "../src/adapters/scopes.js";
import { grantWriteUps, recordSession } from "../src/adapters/sessions.js";
import { readSentinel } from "../src/core/self/index.js";
import { readableDate } from "../src/core/time.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const ZONE = "UTC";
const BUDGET = 9_000;
const D1 = "2026-10-19";
const D2 = "2026-10-20";
const at = (ymd: string, h: number, m = 0): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR + m * MIN;

const S = "5e550000-0000-4000-8000-000000000001";
const A = "a1b2c3d4-0000-4000-8000-00000000000a";
const P = "25e12e7d-0000-4000-8000-000000000025";

let root: string;
let storeDir: string;
let config: string;
let HERE: string;
let THERE: string;
let FAR: string;
let REST: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-states-")));
  storeDir = join(root, "store");
  config = join(root, "claude-code.json");
  HERE = join(root, "garden");
  THERE = join(root, "bakery");
  FAR = join(root, "ledger");
  REST = join(root, "cellar");
  for (const d of [HERE, THERE, FAR, REST]) mkdirSync(d, { recursive: true });
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
}

function world(start: number): World {
  let now = at(D1, 18);
  const c = Counterpart.open({ dir: storeDir, owner: true, budgetBytes: BUDGET, now: () => now, timeZone: ZONE });
  open.push(c);
  c.rebrief({ budgetBytes: BUDGET, at: D1 });
  let reg = setScope(null, FAR, "off", { at: D2 });
  reg = setScope(reg, REST, "paused", { at: D2 });
  writeScopes(join(root, "scopes.json"), reg);
  now = start;
  return { c, set: (t) => void (now = t), now: () => now };
}

function wakeText(w: World, session = S): string {
  const lc = new Lifecycle({ counterpart: w.c, config: { dataDir: storeDir }, configPath: config, now: () => w.now() });
  const text = lc.composeWake({ sessionId: session, scope: HERE, at: D2 }, BUDGET).text;
  expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(BUDGET);
  return text;
}

const elsewhereOf = (text: string): string =>
  text
    .split("\n")
    .filter((l) => l.startsWith("Today, elsewhere: ") || l.startsWith("Here, also open: "))
    .join("\n");

function memory(
  w: World,
  t: number,
  o: { session: string; scope: string; title?: string; body: string; kind?: "fact" | "person" | "self"; about?: "me" | "us" | "owner" | "work" | "world"; status?: "planned" | "done" | "asked"; meta?: Record<string, unknown> },
): string {
  w.set(t);
  return w.c.store.put({
    type: "memory",
    kind: o.kind ?? "fact",
    body: o.body,
    salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 },
    ...(o.title === undefined ? {} : { title: o.title }),
    ...(o.about === undefined ? {} : { about: o.about }),
    ...(o.status === undefined ? {} : { status: o.status }),
    ...(o.meta === undefined ? {} : { meta: o.meta }),
    origin: { session: o.session, scope: o.scope },
  });
}

function hooks(w: World): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter({
    counterpart: w.c,
    config: { dataDir: storeDir, owner: true },
    configPath: config,
    now: () => w.now(),
    scope: { mode: "on", matched: HERE, entry: null } as ScopeVerdict,
    command: "/bin/true",
    args: ["runner"],
    spawner: () => ({ pid: 4242 }),
  });
}

function prompt(w: World, t: number): string | undefined {
  w.set(t);
  return hooks(w)
    .userPromptSubmit({ sessionId: S, scope: HERE, at: D2, prompt: "where were we?" } as HookInput)
    .injection.split("\n")
    .find((l) => l.startsWith("Since "));
}

describe("kept apart, and marked after", () => {
  test("a folder off or paused: no title and no count; a memory re-marked owner or confidential after it was written is not named, and the count is the store's", () => {
    const w = world(at(D2, 8));
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(D2, 8) });
    recordSession(storeDir, { sessionId: "c9cacbcc-0000-4000-8000-00000000000c", scope: FAR, phase: "start", at: at(D2, 8) });
    memory(w, at(D2, 8, 1), { session: "c9cacbcc-0000-4000-8000-00000000000c", scope: FAR, title: "LEDGERFOLDER quarterly totals", body: "Totals.", about: "work", status: "planned" });
    memory(w, at(D2, 8, 2), { session: A, scope: REST, title: "CELLARFOLDER stock count", body: "Stock.", about: "work" });
    const owner = memory(w, at(D2, 8, 3), { session: A, scope: THERE, title: "REMARKEDOWNER the rent talk", body: "The rent talk went fine.", about: "work" });
    const secret = memory(w, at(D2, 8, 4), { session: A, scope: THERE, title: "REMARKEDCONFIDENTIAL the loan", body: "The loan terms.", about: "work", status: "planned" });
    const ok = memory(w, at(D2, 8, 5), { session: A, scope: THERE, title: "Oven seven offset", body: "Eleven degrees hot.", about: "work" });
    w.set(at(D2, 8, 30));
    w.c.store.setAbout(owner, "owner", { by: "owner", why: "it was personal" });
    // The retired confidential mark (2026-10-21) keeps a title in: named like any other.
    w.c.store.revise(secret, { meta: { confidential: true } });
    w.set(at(D2, 9));
    const line = elsewhereOf(wakeText(w));
    expect(line).toContain(`"Oven seven offset" (${ok})`);
    expect(line).toContain(secret);
    for (const never of ["LEDGERFOLDER", "CELLARFOLDER", "REMARKEDOWNER", "ledger", "cellar"]) expect(line).not.toContain(never);
    // The owner's count is every memory written there today, as before titles.
    expect(line).toContain(", 3 memories:");
  });

  test("a status mark does not make a personal memory work: an unmarked person or self memory, or an unmarked fact from Desktop chat, is not named", () => {
    const w = world(at(D2, 8));
    const DESKTOP = "claude-desktop:";
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(D2, 8) });
    memory(w, at(D2, 8, 1), { session: A, scope: THERE, kind: "person", title: "PERSONSTATUS asked Dana about her surgery", body: "Asked Dana how the surgery went.", status: "asked" });
    memory(w, at(D2, 8, 2), { session: A, scope: THERE, kind: "self", title: "SELFSTATUS planned to rest more", body: "Planned to rest more.", status: "planned" });
    memory(w, at(D2, 8, 3), { session: "d0d0d0d0-0000-4000-8000-0000000000d0", scope: DESKTOP, title: "DESKTOPSTATUS call the lawyer", body: "Planned: call the lawyer.", status: "planned" });
    const ok = memory(w, at(D2, 8, 4), { session: A, scope: THERE, title: "Scored the loaves", body: "Scored.", about: "work", status: "done" });
    w.set(at(D2, 9));
    const line = elsewhereOf(wakeText(w));
    expect(line).toContain(`"Scored the loaves" (${ok})`);
    for (const never of ["PERSONSTATUS", "SELFSTATUS", "DESKTOPSTATUS"]) expect(line).not.toContain(never);
  });
});

describe("what the words may carry", () => {
  test("a credential in a title refuses the entry; a memory with no title is named by its first words, after the battery redacted them", async () => {
    const w = world(at(D2, 8));
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(D2, 8) });
    w.set(at(D2, 8, 10));
    const refused = await w.c.submitJot(
      { content: "The oven controller's deploy key needs rotating before the morning bake.", kind: "fact", title: "deploy key AKIAIOSFODNN7EXAMPLE" },
      { session: A, scope: THERE },
    );
    expect(refused.deposited).toBe(false);
    w.set(at(D2, 8, 20));
    const kept = await w.c.submitJot(
      { content: "AKIAIOSFODNN7EXAMPLE is the oven controller's key; rotate it before the morning bake.", kind: "fact" },
      { session: A, scope: THERE },
    );
    expect(kept.deposited).toBe(true);
    w.set(at(D2, 9));
    const line = elsewhereOf(wakeText(w));
    expect(line).toContain(kept.memoryId as string);
    expect(line).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  test("an open thread is never named by title, in the wake or at a prompt", () => {
    const w = world(at(D2, 9));
    recordSession(storeDir, { sessionId: A, scope: THERE, phase: "start", at: at(D2, 9) });
    w.set(at(D2, 10));
    hooks(w).sessionStart({ sessionId: S, scope: HERE, at: D2 } as HookInput);
    expect(prompt(w, at(D2, 10, 1))).toBeUndefined(); // arms
    memory(w, at(D2, 10, 20), { session: A, scope: THERE, title: "OPENTHREAD whether the rye wants salt", body: "Whether the rye wants more salt.", about: "work", meta: { unresolved: true } });
    const done = memory(w, at(D2, 10, 30), { session: A, scope: THERE, title: "Scored the loaves", body: "Scored.", about: "work", status: "done" });
    const line = prompt(w, at(D2, 10, 45)) ?? "";
    expect(line).toContain(`"Scored the loaves" (${done})`);
    expect(line).not.toContain("OPENTHREAD");
  });
});

describe("the nightly run's", () => {
  test("a write-up the night's runner filed under a folder is not named by title, and the runner's record is never another session open here", () => {
    const w = world(at(D2, 3));
    const ended = "e0e0e0e0-0000-4000-8000-0000000000e0";
    const runner = "writeup-20261020";
    recordSession(storeDir, { sessionId: ended, scope: THERE, phase: "start", at: at(D1, 20) });
    recordSession(storeDir, { sessionId: ended, scope: THERE, phase: "end", at: at(D1, 21) });
    // The runner, launched from a session in HERE, is recorded in HERE.
    expect(grantWriteUps(storeDir, { runner, scope: HERE, subjects: [ended], at: at(D2, 3) })).toBe(true);
    memory(w, at(D2, 3, 5), { session: ended, scope: THERE, title: "WRITTENUP last night's bake", body: "The evening bake, written up.", about: "work", meta: { secondHand: true, writtenUpBy: runner } });
    w.set(at(D2, 3, 30));
    const text = wakeText(w);
    expect(text).not.toContain("WRITTENUP");
    expect(text).not.toContain("Here, also open");
    expect(text).not.toContain("writeup-");
  });
});

describe("open here, by the registry's clock", () => {
  test("idle 3h59m is still open here; 4h01m is not; ended is not", () => {
    const w = world(at(D2, 6));
    recordSession(storeDir, { sessionId: P, scope: HERE, phase: "start", at: at(D2, 6) });
    const theirs = memory(w, at(D2, 6, 10), { session: P, scope: HERE, title: "Roadmap: the notes module", body: "Notes.", about: "work", status: "planned" });
    w.set(at(D2, 9, 59));
    expect(elsewhereOf(wakeText(w))).toContain(`Here, also open: session 25e12e7d since 06:00: "Roadmap: the notes module" (${theirs}).`);
    w.set(at(D2, 10, 1));
    expect(elsewhereOf(wakeText(w))).not.toContain("Here, also open");
    recordSession(storeDir, { sessionId: P, scope: HERE, phase: "boundary", at: at(D2, 10, 2) });
    w.set(at(D2, 10, 3));
    expect(elsewhereOf(wakeText(w))).toContain("Here, also open: session 25e12e7d");
    recordSession(storeDir, { sessionId: P, scope: HERE, phase: "end", at: at(D2, 10, 4) });
    w.set(at(D2, 10, 5));
    expect(elsewhereOf(wakeText(w))).not.toContain("Here, also open");
  });

  test("a resumed session is not named to itself", () => {
    const w = world(at(D2, 8));
    recordSession(storeDir, { sessionId: S, scope: HERE, phase: "start", at: at(D2, 8) });
    memory(w, at(D2, 8, 10), { session: S, scope: HERE, title: "MINE the wake check", body: "Mine.", about: "work", status: "planned" });
    w.set(at(D2, 9));
    const woke = hooks(w).sessionStart({ sessionId: S, scope: HERE, at: D2, source: "resume" } as HookInput).injection;
    // Its own work may be a work line here; never "another session open here".
    expect(elsewhereOf(woke)).not.toContain("MINE");
    expect(woke).not.toContain("Here, also open");
  });
});

describe("the room", () => {
  test("four live sessions here and three folders on long paths, in a full 9,000-byte wake with the head tag: Last here and every dated item stay", () => {
    const long = (n: string): string => join(root, "clients", "a-rather-long-client-name-for-the-folder", "projects", `the-${n}-project-with-a-long-name`);
    const FOLDERS = ["north", "south", "east"].map(long);
    for (const d of FOLDERS) mkdirSync(d, { recursive: true });
    const HERES = [1, 2, 3, 4].map((i) => `4e4e4e4${String(i)}-0000-4000-8000-00000000004${String(i)}`);
    const OTHERS = [1, 2, 3].map((i) => `0f0f0f0${String(i)}-0000-4000-8000-0000000000f${String(i)}`);
    let checked = 0;
    for (let budget = 8_700; budget <= 9_300; budget += 50) {
      for (const c of open.splice(0)) c.close();
      rmSync(storeDir, { recursive: true, force: true });
      let now = at(D1, 8);
      const c = Counterpart.open({ dir: storeDir, owner: true, budgetBytes: budget, now: () => now, timeZone: ZONE });
      open.push(c);
      const set = (t: number): void => void (now = t);
      c.revisePage(`## Core\n\n${"I keep the garden's ledger and say what I do not know, and I say it plainly when asked. ".repeat(60)}\n\n## Lately\n\n${"The beans are in and the frost is coming. ".repeat(20)}`, { by: "owner", reason: "seed" });
      for (let i = 0; i < 60; i++) {
        c.store.put({ type: "memory", kind: "fact", body: `Open question ${String(i)}: whether bed ${String(i)} wants lime this autumn, given the pH reading and the rain.`, meta: { unresolved: true }, salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 } });
      }
      const dated: string[] = [];
      for (let i = 0; i < 4; i++) {
        dated.push(c.store.put({ type: "memory", kind: "fact", body: `Seed order ${String(i)} closes at noon; the list is in the green folder number ${String(i)}.`, learnedOn: "2026-10-11", eventDate: i < 2 ? D2 : `2026-10-2${String(i + 1)}`, salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 } }));
      }
      set(at(D1, 15));
      const newest = c.store.put({
        type: "episode",
        kind: "self",
        title: "The bench run that ran out",
        body: `## chapter 1 — ${readableDate(D1)} · lived day 1\n\nWhat happened in the bench run.\n`,
        meta: { sessionId: "a1b2c3d4-0000-4000-8000-000000000003", chapters: 1 },
        source: "episode",
        origin: { session: "a1b2c3d4-0000-4000-8000-000000000003", scope: HERE },
      });
      // Today: work by title in every folder, and by each session here.
      const hereIds: string[] = [];
      HERES.forEach((s, i) => {
        set(at(D2, 7, 10 + i));
        hereIds.push(c.store.put({ type: "memory", kind: "fact", title: `Here session ${String(i)} is calibrating the seventh oven before the rush`, body: `Calibrating oven ${String(i)}.`, about: "work", status: "planned", origin: { session: s, scope: HERE } }));
      });
      FOLDERS.forEach((f, i) => {
        set(at(D2, 7, 20 + i));
        c.store.put({ type: "memory", kind: "fact", title: `Folder ${String(i)} is writing the long migration notes for the client`, body: `Migration notes ${String(i)}.`, about: "work", origin: { session: OTHERS[i] as string, scope: f } });
      });
      set(at(D2, 8));
      expect(c.rebrief({ budgetBytes: budget, at: D2 }).published).toBe(true);
      const sessions: WakeSession[] = [
        ...HERES.map((s, i) => ({ session: s, scope: HERE, startedAt: at(D2, 7, i), lastAt: at(D2, 7, 30), live: true, model: "claude-opus-5-5" })),
        ...OTHERS.map((s, i) => ({ session: s, scope: FOLDERS[i] as string, startedAt: at(D2, 7, i), lastAt: at(D2, 7, 30), live: true })),
      ];
      const head = ["meet=done", "store=st_0123456789abcdef"];
      const quiet = c.wake(budget, { date: D2 }, { scope: HERE, session: S, headFields: head, exportsFrom: () => false });
      const busy = c.wake(budget, { date: D2 }, { scope: HERE, session: S, headFields: head, exportsFrom: () => true, sessions: () => sessions });
      expect(busy.bytes).toBeLessThanOrEqual(budget);
      expect(readSentinel(busy.text).intact).toBe(true);
      expect(busy.text).toContain("Here, also open");
      expect(busy.text.includes("Last here: ")).toBe(quiet.text.includes("Last here: "));
      if (quiet.text.includes(newest)) expect(busy.text).toContain(newest);
      for (const id of dated) expect(busy.text.includes(id)).toBe(quiet.text.includes(id));
      const line = elsewhereOf(busy.text);
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(300);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);

  test("Work here: a memory the clause names is not repeated; one it gave up for room still shows", () => {
    const w = world(at(D2, 8));
    const HERES = [1, 2, 3, 4].map((i) => `4e4e4e4${String(i)}-0000-4000-8000-00000000004${String(i)}`);
    const ids: string[] = [];
    HERES.forEach((s, i) => {
      recordSession(storeDir, { sessionId: s, scope: HERE, phase: "start", at: at(D2, 7, i), model: "claude-opus-5-5" });
      ids.push(memory(w, at(D2, 7, 10 + i), { session: s, scope: HERE, title: `Session ${String(i)} is calibrating the seventh oven before the rush`, body: `Oven ${String(i)} runs eleven degrees hot; the offset goes in the controller.`, about: "work", status: "planned" }));
      ids.push(memory(w, at(D2, 7, 20 + i), { session: s, scope: HERE, title: `Session ${String(i)} wrote the proofing schedule for the week`, body: `Proofing ${String(i)}: the schedule is on the board by the door.`, about: "work" }));
    });
    w.set(at(D2, 9));
    // The bundle leaves the work lines their room at a boundary.
    w.c.rebrief({ budgetBytes: BUDGET, at: D2 });
    const text = wakeText(w);
    const line = elsewhereOf(text);
    expect(line).toStartWith("Here, also open: ");
    expect(text).toContain("Work here");
    const inLine = ids.filter((id) => line.includes(id));
    const dropped = ids.filter((id) => !line.includes(id));
    expect(inLine.length).toBeGreaterThan(0);
    expect(dropped.length).toBeGreaterThan(0);
    for (const id of inLine) expect(text.split(id).length - 1).toBe(1);
    // Work here shows at most its own few lines; every one it shows of these
    // is one the clause gave up, and it shows at least one.
    const work = text.split("\n").filter((l) => l.startsWith("- ") && ids.some((id) => l.includes(id)));
    expect(work.length).toBeGreaterThan(0);
    for (const l of work) expect(dropped.some((id) => l.includes(id))).toBe(true);
  });
});

/**
 * THE NIGHT PROPOSES A PROJECT (2026-10-21, wave 2 lane G, design §8): two
 * folders written in on the same lived days, naming the same subjects, are
 * asked about in the reflection's morning share; the owner's yes — the
 * reflect tool's phase "join" — joins them, `by: night`. A subject every
 * folder names counts for nothing; a pair asked about rests; a folder the
 * host keeps home is never proposed; `PROJECT_JOIN_ASK` off stops it.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is
 * called; every word is invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_TUNABLES } from "../src/core/dream/tunables.js";
import { pairKey, proposeJoin } from "../src/core/dream/project-ask.js";
import { addDays, localDate } from "../src/core/time.js";
import { parseSetting } from "../tools/harness/settings.js";

let root: string;
let dir: string;
let A: string;
let B: string;
let C: string;
let dateN = 0;
const BASE = Date.UTC(2026, 9, 1, 15, 0);
const SESSION = "s-join";
const open: Counterpart[] = [];

beforeEach(() => {
  dateN = 0;
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-project-ask-")));
  dir = join(root, "store");
  A = join(root, "lantern");
  B = join(root, "lantern-site");
  C = join(root, "garden");
  for (const d of [A, B, C]) mkdirSync(d, { recursive: true });
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  (DREAM_TUNABLES as { PROJECT_JOIN_ASK: boolean }).PROJECT_JOIN_ASK = true;
  rmSync(root, { recursive: true, force: true });
});

function brain(): Counterpart {
  const c = Counterpart.open({ dir, identity: { name: "Mike" }, now: () => BASE + dateN * 86_400_000 });
  open.push(c);
  return c;
}

function nextDay(c: Counterpart): void {
  dateN += 1;
  c.store.advanceClock(addDays(localDate(BASE), dateN));
}

function mem(c: Counterpart, body: string, scope: string): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    about: "work",
    aboutBy: "writer",
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    origin: { scope, session: "s-old" },
  });
}

/** A and B: the same four days, naming Quillon, Brasswick and Ferrolux; C: the same days, naming only Mike (every folder does). */
function world(c: Counterpart): void {
  for (const [name, i] of [["Quillon", 0], ["Brasswick", 1], ["Ferrolux", 2], ["Mike", 3]] as const) {
    c.schemas.mention({ name, kind: name === "Mike" ? "person" : "entity", source: name, chunkRef: `c${String(i)}`, day: c.store.livedDay() });
  }
  c.close();
  open.splice(0);
  const d = brain();
  for (let i = 0; i < 4; i++) {
    nextDay(d);
    mem(d, `Quillon and Brasswick need the Ferrolux build on day ${String(i)}; Mike checked.`, A);
    mem(d, `The Quillon page shows Brasswick and Ferrolux on day ${String(i)}; Mike looked.`, B);
    mem(d, `Mike watered the tomatoes on day ${String(i)}.`, C);
  }
  d.close();
  open.splice(0);
}

describe("proposeJoin (dream/project-ask.ts)", () => {
  test("proposes the pair used on the same days naming the same things; a subject every folder names counts for nothing", () => {
    const c0 = brain();
    world(c0);
    const c = brain();
    const p = proposeJoin(c.store, { day: c.store.livedDay() });
    expect(p).not.toBeNull();
    expect([p?.into, p?.folder].sort()).toEqual([A, B].sort());
    expect(p?.days).toBe(4);
    expect([...(p?.subjects ?? [])].sort()).toEqual(["Brasswick", "Ferrolux", "Quillon"]);
    // Rested, the same project already, kept home, or switched off: nothing.
    expect(proposeJoin(c.store, { day: c.store.livedDay(), rested: new Set([pairKey(A, B)]) })).toBeNull();
    expect(proposeJoin(c.store, { day: c.store.livedDay(), folderOn: (f) => f !== B })).toBeNull();
    (DREAM_TUNABLES as { PROJECT_JOIN_ASK: boolean }).PROJECT_JOIN_ASK = false;
    expect(proposeJoin(c.store, { day: c.store.livedDay() })).toBeNull();
    (DREAM_TUNABLES as { PROJECT_JOIN_ASK: boolean }).PROJECT_JOIN_ASK = true;
    c.joinProject({ folder: B, project: A, by: "owner" });
    expect(proposeJoin(c.store, { day: c.store.livedDay() })).toBeNull();
  });

  test("its switches are compare-settable", () => {
    expect(parseSetting("dream.PROJECT_JOIN_ASK=false").value).toBe(false);
    expect(parseSetting("dream.PROJECT_JOIN_DAYS=4").value).toBe(4);
  });
});

describe("in the reflection's share, and the owner's yes", () => {
  test("finish asks in the share; the reflect tool's phase join joins them, by the night; asked once, it rests", async () => {
    const c0 = brain();
    world(c0);
    recordSession(dir, { sessionId: SESSION, scope: A, phase: "start" });
    const s = openServer({ dir, session: SESSION, scope: A, now: () => BASE + dateN * 86_400_000 });
    try {
      const begin = await s.call("reflect", { phase: "begin", session: SESSION });
      expect(begin.isError ?? false).toBe(false);
      const id = begin.structuredContent["reflection"] as string;
      const finish = await s.call("reflect", { phase: "finish", session: SESSION, reflection: id, entry: "A look back." });
      expect(finish.isError ?? false).toBe(false);
      const row = s.counterpart.store.reflection(id);
      expect(row?.share ?? "").toContain("look like one piece of work");
      expect(row?.share ?? "").toContain("lantern-site");
      expect(JSON.stringify(finish.structuredContent)).toContain('phase \\"join\\"');
      expect(s.counterpart.store.projectOfFolder(B)).toBeNull();

      const yes = await s.call("reflect", { phase: "join", session: SESSION, reflection: id });
      expect(yes.isError ?? false).toBe(false);
      const joined = s.counterpart.store.projectOfFolder(yes.structuredContent["joined"] as string);
      expect(joined?.via).toBe("night");
      expect(s.counterpart.store.projectOfFolder(A)?.project_id).toBe(joined?.project_id);
      const again = await s.call("reflect", { phase: "join", session: SESSION, reflection: id });
      expect(again.isError).toBe(true);
    } finally {
      s.counterpart.close();
    }
  });
});

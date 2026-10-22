/**
 * THE NIGHT PROPOSES A PROJECT (2026-10-21, wave 2 lane G, design §8): two
 * folders written in on the same lived days, naming the same subjects, are
 * asked about in the reflection's morning share; the owner's yes — the
 * reflect tool's phase "join", after the share was told — joins them,
 * `by: night`. A subject every folder names counts for nothing; a general
 * folder is never proposed; a folder that would join must be alone in its
 * project; a pair asked about rests; a folder the host keeps home is never
 * proposed; a stale yes (old, projects changed, folder now kept home) is
 * refused; the nightly run cannot say yes; `PROJECT_JOIN_ASK` off stops it.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is
 * called; every word is invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { NIGHT_CHILD_ENV } from "../src/adapters/spawn.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_TUNABLES } from "../src/core/dream/tunables.js";
import { joinSentence, joinStillStands, pairKey, proposeJoin } from "../src/core/dream/project-ask.js";
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

/**
 * A and B: the same four days, naming Quillon, Brasswick and Ferrolux (A a
 * little more); C: the same days, naming only Mike (every folder does).
 * `others`: more folders on the same days, each naming its own things.
 */
function world(others: readonly string[] = []): void {
  const c = brain();
  for (const [name, i] of [["Quillon", 0], ["Brasswick", 1], ["Ferrolux", 2], ["Mike", 3]] as const) {
    c.schemas.mention({ name, kind: name === "Mike" ? "person" : "entity", source: name, chunkRef: `c${String(i)}`, day: c.store.livedDay() });
  }
  c.close();
  open.splice(0);
  const d = brain();
  for (let i = 0; i < 4; i++) {
    nextDay(d);
    mem(d, `Quillon and Brasswick need the Ferrolux build on day ${String(i)}; Mike checked.`, A);
    mem(d, `Quillon notes, part two, on day ${String(i)}.`, A);
    mem(d, `The Quillon page shows Brasswick and Ferrolux on day ${String(i)}; Mike looked.`, B);
    mem(d, `Mike watered the tomatoes on day ${String(i)}.`, C);
    for (const o of others) mem(d, `Mike sorted the ${o.split("/").pop() ?? "x"} shelf on day ${String(i)}.`, o);
  }
  d.close();
  open.splice(0);
}

describe("proposeJoin (dream/project-ask.ts)", () => {
  test("proposes the pair used on the same days naming the same things, the less-written joining; a subject every folder names counts for nothing", () => {
    world();
    const c = brain();
    const p = proposeJoin(c.store, { day: c.store.livedDay() });
    expect(p?.into).toBe(A);
    expect(p?.folder).toBe(B);
    expect(p?.days).toBe(4);
    expect(p?.day).toBe(c.store.livedDay());
    expect(p?.intoProject ?? null).toBeNull();
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

  test("a folder that would join while it shares a project with others is never proposed: a yes must not pull it out", () => {
    world();
    const c = brain();
    c.joinProject({ folder: C, project: B, by: "owner" });
    expect(proposeJoin(c.store, { day: c.store.livedDay() })).toBeNull();
  });

  test("a general folder — on the same days as three others or more — is never proposed", () => {
    const D = join(root, "shelf-d");
    const E = join(root, "shelf-e");
    for (const d of [D, E]) mkdirSync(d, { recursive: true });
    world([D, E]);
    const c = brain();
    expect(proposeJoin(c.store, { day: c.store.livedDay() })).toBeNull();
  });

  test("the question is flat and capped, and says the whole folder's work would show", () => {
    const p = { into: A, folder: B, days: 4, subjects: [`Quillon\n\nand ${"x".repeat(200)}`], day: 0, intoProject: null, folderProject: null };
    const line = joinSentence(p);
    expect(line).not.toContain("\n");
    expect(line).toContain("…");
    expect(line).toContain("all of");
    expect(line).toContain("wake");
  });

  test("its switches are compare-settable", () => {
    expect(parseSetting("dream.PROJECT_JOIN_ASK=false").value).toBe(false);
    expect(parseSetting("dream.PROJECT_JOIN_EXPIRE_DAYS=5").value).toBe(5);
    expect(parseSetting("dream.PROJECT_JOIN_OVERLAP_MAX=0.3").value).toBe(0.3);
  });
});

describe("in the reflection's share, and the owner's yes", () => {
  async function asked(): Promise<{ s: McpServer; id: string }> {
    world();
    recordSession(dir, { sessionId: SESSION, scope: A, phase: "start" });
    const s = openServer({ dir, session: SESSION, scope: A, env: {}, now: () => BASE + dateN * 86_400_000 });
    const begin = await s.call("reflect", { phase: "begin", session: SESSION });
    expect(begin.isError ?? false).toBe(false);
    const id = begin.structuredContent["reflection"] as string;
    const finish = await s.call("reflect", { phase: "finish", session: SESSION, reflection: id, entry: "A look back." });
    expect(finish.isError ?? false).toBe(false);
    return { s, id };
  }

  test("finish asks in the share; join waits for the share told; then joins them by the night, once", async () => {
    const { s, id } = await asked();
    try {
      const row = s.counterpart.store.reflection(id);
      expect(row?.share ?? "").toContain("look like one piece of work");
      expect(row?.share ?? "").toContain("lantern-site");
      expect(s.counterpart.store.projectOfFolder(B)).toBeNull();
      const early = await s.call("reflect", { phase: "join", session: SESSION, reflection: id });
      expect(early.isError).toBe(true);
      expect(JSON.stringify(early.structuredContent)).toContain("share-not-told");
      await s.call("reflect", { phase: "told", session: SESSION, reflection: id });
      const yes = await s.call("reflect", { phase: "join", session: SESSION, reflection: id });
      expect(yes.isError ?? false).toBe(false);
      expect(s.counterpart.store.projectOfFolder(B)?.via).toBe("night");
      expect(s.counterpart.store.projectOfFolder(A)?.project_id).toBe(s.counterpart.store.projectOfFolder(B)?.project_id);
      const again = await s.call("reflect", { phase: "join", session: SESSION, reflection: id });
      expect(again.isError).toBe(true);
    } finally {
      s.counterpart.close();
    }
  });

  test("a stale yes is refused: projects changed since, or the question too old", async () => {
    const { s, id } = await asked();
    try {
      await s.call("reflect", { phase: "told", session: SESSION, reflection: id });
      const store = s.counterpart.store;
      const p = s.counterpart.reflections.joinProposal(id);
      if (p === null) throw new Error("no proposal");
      expect(joinStillStands(store, p, { day: p.day })).toBeNull();
      expect(joinStillStands(store, p, { day: p.day + DREAM_TUNABLES.PROJECT_JOIN_EXPIRE_DAYS + 1 })?.reason).toBe("proposal-expired");
      expect(joinStillStands(store, p, { day: p.day, folderOn: (f) => f !== B })?.reason).toBe("folder-kept-home");
      s.counterpart.joinProject({ folder: B, project: C, by: "owner" });
      const late = await s.call("reflect", { phase: "join", session: SESSION, reflection: id });
      expect(late.isError).toBe(true);
      expect(JSON.stringify(late.structuredContent)).toContain("projects-changed");
      expect(store.projectOfFolder(B)?.via).toBe("owner");
    } finally {
      s.counterpart.close();
    }
  });

  test("the nightly run cannot say yes", async () => {
    const { s, id } = await asked();
    s.counterpart.close();
    const night = openServer({ dir, session: SESSION, scope: A, env: { [NIGHT_CHILD_ENV]: "reflection" }, now: () => BASE + dateN * 86_400_000 });
    try {
      const r = await night.call("reflect", { phase: "join", session: SESSION, reflection: id });
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r.structuredContent)).toContain("night-run");
      expect(night.counterpart.store.projectOfFolder(B)).toBeNull();
    } finally {
      night.counterpart.close();
    }
  });
});

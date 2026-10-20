/**
 * PERSONAL NEWS FLOWS ACROSS FOLDERS (2026-10-20, Mike's go, lightly held, an
 * experiment). An unmarked fact written in a project counts as that project's
 * work and is shown only there; the nightly reflection is offered the unmarked
 * ones to mark by meaning — 24 a night now (was 5), the most likely personal
 * first — and marked owner or us they reach every folder's wake. The night
 * runs as not-the-owner (10-02); that stance never gated a mark. The owner's
 * own `--reflected-feeling off` (ruling D1 on #256) still does.
 *
 * Every memory here is invented for the test. Hermetic: a fresh temp data dir
 * per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import { toolSpec } from "../src/adapters/mcp/tools.js";
import { Counterpart } from "../src/core/counterpart.js";
import { REFLECT_TUNABLES } from "../src/core/dream/index.js";
import { PERSONAL_WORDS, orderUnmarked, personNames, unmarkedRanker } from "../src/core/dream/unmarked.js";
import type { UnmarkedCandidate } from "../src/core/dream/unmarked.js";
import { FRAMING } from "../src/core/self/index.js";
import { REFLECTED_FEELING_KEY } from "../src/core/sleep/index.js";
import type { PutInput } from "../src/core/store/index.js";

const NOW = Date.UTC(2026, 9, 20, 15, 0);
const SESSION = "s-night";

let root: string;
let dir: string;
let WORKSHOP: string;
let LIBRARY: string;
const open: Counterpart[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-unmarked-offer-")));
  dir = join(root, "store");
  WORKSHOP = join(root, "workshop");
  LIBRARY = join(root, "library");
  mkdirSync(WORKSHOP, { recursive: true });
  mkdirSync(LIBRARY, { recursive: true });
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

/** The night's stance by default: not the owner (night-run.ts, 10-02). */
function brain(owner = false): Counterpart {
  const c = Counterpart.open({ dir, owner, identity: { name: "Dana" }, now: () => NOW, timeZone: "UTC" });
  open.push(c);
  return c;
}

function closeAll(): void {
  for (const c of open.splice(0)) c.close();
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

function begin(c: Counterpart) {
  const b = c.reflections.begin({ session: SESSION });
  if (!b.ok) throw new Error(b.reason);
  return b;
}

describe("the door: what makes a night closed, and what a night as not-the-owner may mark", () => {
  test("a night as not-the-owner, the switch at its default: owner and us marks land on offered unmarked memories, and the share says so", () => {
    const c = brain(false);
    const visit = mem(c, "Dana was worn out after the visit from her sister.", { origin: { scope: WORKSHOP } });
    const lunch = mem(c, "Lunch with the two of us on the porch was the best part of the week.", { origin: { scope: WORKSHOP } });
    const b = begin(c);
    expect(c.store.getMeta(REFLECTED_FEELING_KEY)).toBeFalsy();
    expect(b.bundle.unmarked).toContain(visit);
    expect(b.bundle.unmarked).toContain(lunch);
    expect(b.instructions).toContain("owner or us when it is personal (then it reaches every folder)");
    const done = c.reflections.finish({
      reflection: b.bundle.reflection,
      session: SESSION,
      entry: "A quiet night.",
      about: [
        { id: visit, about: "owner", why: "Her sister's visit is her life, not the build." },
        { id: lunch, about: "us", why: "A moment the two of us shared." },
      ],
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.about.map((a) => a.reason)).toEqual(["marked", "marked"]);
    expect(c.store.read(visit).about).toBe("owner");
    expect(c.store.read(visit).aboutBy).toBe("reflection");
    expect(c.store.read(lunch).about).toBe("us");
  });

  test("the owner's switch off (ruling D1 on #256) is what closes it: work or world only, then and now", () => {
    const c = brain(false);
    const visit = mem(c, "Dana was worn out after the visit from her sister.", { origin: { scope: WORKSHOP } });
    c.store.setMeta(REFLECTED_FEELING_KEY, "off");
    const b = begin(c);
    expect(b.bundle.unmarked).toContain(visit);
    expect(b.instructions).toContain("Tonight a mark may only be work or world");
    const done = c.reflections.finish({
      reflection: b.bundle.reflection,
      session: SESSION,
      entry: "A quiet night.",
      about: [{ id: visit, about: "owner", why: "Her sister's visit." }],
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.about[0]?.reason).toBe("door-closed-work-or-world-only");
    expect(c.store.read(visit).about ?? null).toBeNull();
  });

  test("a confidential memory is never offered, never re-marked by the night, and the night's remark cannot find it", () => {
    const c = brain(false);
    const secret = mem(c, "A private worry Dana shared about her sister's health.", { origin: { scope: WORKSHOP }, meta: { confidential: true } });
    const plain = mem(c, "Dana's friend is visiting this weekend.", { origin: { scope: WORKSHOP } });
    const b = begin(c);
    expect(b.bundle.unmarked).toContain(plain);
    expect(b.bundle.unmarked).not.toContain(secret);
    expect(b.bundle.memories[secret]).toBeUndefined();
    const done = c.reflections.finish({
      reflection: b.bundle.reflection,
      session: SESSION,
      entry: "A quiet night.",
      about: [{ id: secret, about: "owner", why: "It is hers." }],
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.about[0]?.reason).toBe("not-shown-or-gone");
    expect(c.markAbout({ id: secret, mark: "owner", by: "self", why: "It is hers.", owner: false, night: true }).ok).toBe(false);
    expect(c.store.read(secret).about ?? null).toBeNull();
  });
});

describe("the offer: 24 a night, the most likely personal first", () => {
  test("the cap is 24 and the about limit makes room for all of them and more", () => {
    expect(REFLECT_TUNABLES.UNMARKED).toBe(24);
    expect(REFLECT_TUNABLES.LIMITS.about).toBeGreaterThan(REFLECT_TUNABLES.UNMARKED);
    expect(REFLECT_TUNABLES.UNMARKED_REST_NIGHTS).toBe(3);
  });

  test("on a store with more than the cap, the personal-looking ones come first, ahead of better-used work", () => {
    const c = brain(false);
    // A person the store knows, by a person memory (personal wherever written, so not offered itself).
    mem(c, "Priya is an old friend from school who lives up the coast.", { kind: "person", title: "Priya", meta: { name: "Priya" } });
    const work: string[] = [];
    for (let i = 0; i < REFLECT_TUNABLES.UNMARKED + 6; i += 1) {
      work.push(mem(c, `The pipeline step number ${String(i)} caches its output under the build folder.`, { origin: { scope: WORKSHOP }, physics: { birthDay: c.store.livedDay(), lastUsedDay: c.store.livedDay(), uses: 50 + i } }));
    }
    const priya = mem(c, "Priya called about the reunion.", { origin: { scope: WORKSHOP } });
    const tired = mem(c, "Long weekend; everyone was tired by Sunday.", { origin: { scope: WORKSHOP } });
    const felt = mem(c, "The release went out late.", { origin: { scope: WORKSHOP } });
    c.store.addFeelings(felt, [{ whose: "owner", core: "uneasy", emotion: "worried", strength: 0.5 }]);
    const b = begin(c);
    const u = b.bundle.unmarked;
    expect(u.length).toBe(REFLECT_TUNABLES.UNMARKED);
    // The feeling (2) and the named person (2) ahead of the word (1), all ahead of the work.
    expect(u.slice(0, 2).sort()).toEqual([felt, priya].sort());
    expect(u[2]).toBe(tired);
    // Then the work, most used first.
    expect(u[3]).toBe(work[work.length - 1] as string);
    expect(b.instructions).toContain("The likeliest personal come first.");
  });

  test("a person card's name or alias counts as a person named", () => {
    const c = brain(false);
    c.store.put({
      type: "schema",
      kind: "person",
      title: "Ravi",
      body: "Ravi",
      meta: { role: "entity", name: "Ravi", aliases: ["Rav"] },
      salience: { relevance: 0, emotional: 0, predictive: 0 },
      physics: { birthDay: c.store.livedDay(), lastUsedDay: c.store.livedDay() },
    });
    const work = [0, 1, 2].map((i) => mem(c, `Pipeline note ${String(i)}.`, { origin: { scope: WORKSHOP }, physics: { birthDay: c.store.livedDay(), lastUsedDay: c.store.livedDay(), uses: 9 } }));
    const rav = mem(c, "Rav fixed the fence.", { origin: { scope: WORKSHOP } });
    const u = begin(c).bundle.unmarked;
    expect(u[0]).toBe(rav);
    for (const w of work) expect(u).toContain(w);
  });

  test("the rank, pure: each sign and its weight; the order breaks ties by uses, then age, then id; rotation puts lately-offered last", () => {
    const names = { owner: ["dana"], people: personNames([{ title: "Priya", meta: "{}" }, { title: "A long sentence about someone", meta: '{"name":"Sam"}' }, { title: "Dana", meta: "{}" }], ["dana"]) };
    expect(names.people.sort()).toEqual(["priya", "sam"]);
    const rank = unmarkedRanker(names);
    const c = (id: string, body: string, over: Partial<UnmarkedCandidate> = {}): UnmarkedCandidate => ({ id, kind: "fact", title: null, body, uses: 0, createdAt: 0, felt: false, ...over });
    expect(rank(c("a", "The build cache lives under tmp."))).toBe(0);
    expect(rank(c("b", "Sam fixed the bike."))).toBe(2);
    expect(rank(c("c", "We had dinner late."))).toBe(1);
    expect(rank(c("d", "Dana approved the merge."))).toBe(1);
    expect(rank(c("e", "Han thread", { kind: "entity" }))).toBe(1);
    expect(rank(c("f", "Shipped.", { felt: true }))).toBe(2);
    // Whole words only: "visitors" counts, "revisit" does not; the build's own words never count.
    expect(rank(c("g", "We revisit the dream and sleep phases and the feelings wheel on the Health page."))).toBe(0);
    expect(PERSONAL_WORDS).not.toContain("feeling");
    const list = [c("x", "plain", { uses: 1 }), c("y", "plain", { uses: 3 }), c("z", "dinner with Sam"), c("w", "plain", { uses: 3, createdAt: -5 })];
    expect(orderUnmarked(list, names, new Set(), 10)).toEqual(["z", "w", "y", "x"]);
    expect(orderUnmarked(list, names, new Set(["z"]), 10)).toEqual(["w", "y", "x", "z"]);
    expect(orderUnmarked(list, names, new Set(), 2)).toEqual(["z", "w"]);
  });

  test("many re-labels into the owner are said in the share, the first two by name and the rest in one sentence", () => {
    const c = brain(false);
    const ids = [0, 1, 2, 3, 4].map((i) => mem(c, `Dana's friend number ${String(i)} is visiting this weekend.`, { origin: { scope: WORKSHOP } }));
    const b = begin(c);
    for (const id of ids) expect(b.bundle.unmarked).toContain(id);
    const done = c.reflections.finish({
      reflection: b.bundle.reflection,
      session: SESSION,
      entry: "A quiet night.",
      about: ids.map((id) => ({ id, about: "owner", why: "Her friends, not the build." })),
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.outcome.about.every((a) => a.reason === "marked")).toBe(true);
    const share = c.store.reflection(b.bundle.reflection)?.share ?? "";
    expect(share.match(/I've come to think "/g)?.length).toBe(2);
    expect(share).toContain("And 3 more I've come to think are personal, not work (3 about you), so every folder hears them now.");
  });
});

describe("a re-marked memory reaches another folder by the existing rules", () => {
  test("unmarked, the visit is the workshop's work and the library's wake does not carry it; marked owner by the night, the library's Nearby does, and recall there finds it", async () => {
    const BUDGET = 9_000;
    const wakeIn = (c: Counterpart, scope: string): string => {
      c.rebrief({ budgetBytes: BUDGET, at: "2026-10-20" });
      return c.wake(BUDGET, { date: "2026-10-20" }, { scope, session: "s-reader", exportsFrom: () => true }).text;
    };
    const nearby = (text: string): string => {
      const lines = text.split("\n");
      const at = lines.indexOf(FRAMING.hints);
      const out: string[] = [];
      for (let i = at + 1; at >= 0 && i < lines.length && (lines[i] ?? "").length > 0; i++) out.push(lines[i] as string);
      return out.join("\n");
    };
    let c = brain(true);
    const visit = mem(c, "Dana was worn out after her sister's visit, and slept most of Sunday.", { origin: { scope: WORKSHOP } });
    expect(nearby(wakeIn(c, LIBRARY))).not.toContain("worn out after her sister");
    expect(wakeIn(c, WORKSHOP)).toContain(visit);
    closeAll();

    // The night: not the owner.
    c = brain(false);
    const b = begin(c);
    expect(b.bundle.unmarked).toContain(visit);
    const done = c.reflections.finish({
      reflection: b.bundle.reflection,
      session: SESSION,
      entry: "A quiet night.",
      about: [{ id: visit, about: "owner", why: "Her sister's visit is her life, not the build." }],
    });
    if (!done.ok) throw new Error(done.reason);
    closeAll();

    c = brain(true);
    expect(nearby(wakeIn(c, LIBRARY))).toContain("worn out after her sister");
    closeAll();
    const s = openServer({ dir, session: "s-library", scope: LIBRARY, owner: true, timeZone: "UTC" });
    try {
      const r = await s.call("recall", { query: "sister visit worn out", mode: "facts" });
      expect(JSON.stringify(r.structuredContent)).toContain(visit);
    } finally {
      s.counterpart.close();
    }
  });
});

describe("the tool text for about", () => {
  test("remember and session_end: personal marked owner or us reaches every folder; work stays with its folder, its title may be seen; unmarked is this folder's", () => {
    for (const tool of ["remember", "session_end"]) {
      const spec = toolSpec(tool)?.inputSchema as { properties: Record<string, unknown> };
      const about =
        tool === "remember"
          ? (spec.properties["about"] as { description: string })
          : ((spec.properties["memories"] as { items: { properties: Record<string, { description: string }> } }).items.properties["about"] as { description: string });
      expect(about.description).toContain("owner or us, so it reaches every folder");
      expect(about.description).toContain("Work belongs to the folder it was written in, though sessions elsewhere may see its title.");
      expect(about.description).toContain("counts as this folder's work and is shown only here — so mark the personal ones.");
    }
    const chapter = (toolSpec("chapter")?.inputSchema as { properties: Record<string, { description: string }> }).properties["about"];
    expect(chapter?.description).toContain("stays with this folder, though sessions elsewhere may see its title");
  });
});

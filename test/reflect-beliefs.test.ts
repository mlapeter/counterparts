/**
 * THE REFLECTION WRITES AND FILES BELIEFS (wave 2 lane C2, 2026-10-21).
 *
 * The reflection is shown the beliefs on the subjects in play — me (and us)
 * first, then the cards tonight's memories name — with their strength and
 * how many memories back them, so it can file support rather than write a
 * belief again. It may birth a few (born weak, each lived cite its first
 * support), file a memory for or against one, and let a contested one go.
 * One switch, `schemas.BELIEFS_BIRTH`, turns the ask off.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is
 * called: the "reflecting mind" is the test.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as PHYSICS, sal } from "../src/core/physics/index.js";
import { TUNABLES as SCHEMAS } from "../src/core/schemas/tunables.js";
import type { PutInput } from "../src/core/store/index.js";
import type { ReflectBundle, ReflectFinish } from "../src/core/dream/reflect.js";

let dir: string;
const open: Counterpart[] = [];
const SESSION = "s-beliefs";
let dateN = 0;

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-reflect-beliefs-"));
});

afterEach(() => {
  (SCHEMAS as { BELIEFS_BIRTH: boolean }).BELIEFS_BIRTH = true;
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function brain(): Counterpart {
  const c = Counterpart.open({ dir, identity: { name: "Mike" }, now: () => Date.UTC(2026, 8, 1, 12) + dateN * 86_400_000 });
  open.push(c);
  return c;
}

function nextDay(c: Counterpart): number {
  dateN += 1;
  c.store.advanceClock(new Date(Date.UTC(2026, 8, 1) + dateN * 86_400_000).toISOString().slice(0, 10));
  return c.store.livedDay();
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    origin: { session: `sess-${String(day)}`, scope: "/work" },
    ...over,
  });
}

function begin(c: Counterpart): ReflectBundle & { instructions: string } {
  const b = c.reflections.begin({ session: SESSION });
  if (!b.ok) throw new Error(`begin refused: ${b.reason}`);
  return { ...b.bundle, instructions: b.instructions };
}

function finish(c: Counterpart, bundle: ReflectBundle, extra: Partial<ReflectFinish> = {}) {
  const done = c.reflections.finish({
    reflection: bundle.reflection,
    session: SESSION,
    entry: "Looking back over the last few days, a few things stand out.",
    cites: [],
    ...extra,
  });
  if (!done.ok) throw new Error(`finish refused: ${done.reason}`);
  return done.outcome;
}

/** A store with Wren's card, a belief about her, and a few days of memories. */
function world(): { c: Counterpart; wren: string; held: string; dawn: string; told: string; chose: string } {
  const c = brain();
  const day = nextDay(c);
  const wren = c.schemas.mention({ name: "Wren", kind: "person", source: "Wren", chunkRef: "t", day }).id as string;
  const held = c.schemas.addBelief({ entityId: wren, statement: "Wren likes early ferries.", day, birthRoute: "reflection" }).id as string;
  nextDay(c);
  const dawn = mem(c, "Wren took the six o'clock ferry again and said it was the best part of her week.");
  const told = mem(c, "Mike said our dawn sessions are when we do our best work together.", { saidBy: "owner" });
  const chose = mem(c, "I chose to keep the dawn slot for the hard problems.", { saidBy: "self" });
  return { c, wren, held, dawn, told, chose };
}

describe("what the reflection is shown", () => {
  test("me (and us) first, then the cards tonight's memories name, each belief with strength and support — and a belief is not a memory it can cite", () => {
    const { c, wren, held, dawn } = world();
    const b = begin(c);
    const subjects = b.beliefs?.subjects ?? [];
    expect(subjects[0]?.name).toBe("me (and us)");
    expect(subjects[0]?.kind).toBe("me");
    const w = subjects.find((s) => s.id === wren);
    expect(w?.name).toBe("Wren");
    expect(w?.beliefs.map((x) => x.id)).toEqual([held]);
    expect(w?.beliefs[0]).toMatchObject({ statement: "Wren likes early ferries.", support: 0, against: 0 });
    expect(b.beliefs?.births).toBe(SCHEMAS.BELIEF_BIRTHS_PER_REFLECTION);
    expect(b.memories[dawn]).toBeDefined();
    // The ask, in plain words.
    expect(b.instructions).toContain("A belief is a claim life has to back");
    expect(b.instructions).toContain("Filing support for a belief already here beats writing a new one");
    // A belief's id is not citable, feelable or markable.
    const o = finish(c, b, { cites: [held, dawn], feelings: [{ id: held, core: "warm", emotion: "fond", strength: 0.5 }] });
    expect(o.refusedCites.some((x) => x.startsWith(held))).toBe(true);
    expect(o.feelings[0]?.ok).toBe(false);
  });
});

describe("births", () => {
  test("a belief about us, born weak on the self subject, its lived cites its first support — testimony and choice read off the memories", () => {
    const { c, told, chose } = world();
    const b = begin(c);
    const o = finish(c, b, { beliefs: { births: [{ subject: "us", statement: "We do our best work at dawn.", cites: [told, chose] }] } });
    const born = o.beliefs.births[0];
    expect(born?.ok).toBe(true);
    expect(born?.reason).toBe("born");
    const id = born?.id as string;
    const row = c.store.row(id);
    expect(row?.birth_route).toBe("reflection");
    expect(row?.about).toBe("us");
    expect(c.store.row(JSON.parse(row?.meta ?? "{}").entityId)?.subject_kind).toBe("self");
    expect(sal(c.store.physicsOf(id).salience)).toBeLessThanOrEqual(PHYSICS.BELIEF_BIRTH_CEILING + 1e-9);
    expect(c.store.supportOf(id).map((r) => [r.memoryId, r.route])).toEqual(
      expect.arrayContaining([
        [told, "testimony"],
        [chose, "choice"],
      ]),
    );
    expect(born?.note).toContain("Born weak");
  });

  test("refused: a subject not shown, no lived cite, a near-duplicate (with the belief to file to), and past the night's births", () => {
    const { c, wren, held, dawn, told, chose } = world();
    const b = begin(c);
    const dreamt = c.store.put({ type: "memory", kind: "fact", body: "Dreamed: ferries at dawn.", source: "dreamed" });
    const o = finish(c, b, {
      beliefs: {
        births: [
          { subject: "sch_nobody", statement: "Someone likes ferries.", cites: [dawn] },
          { subject: wren, statement: "Wren is a morning person.", cites: [dreamt] },
          { subject: wren, statement: "Wren likes the early ferries.", cites: [dawn] },
          { subject: "me", statement: "I keep the hard problems for dawn.", cites: [chose] },
          { subject: "us", statement: "We do our best work at dawn.", cites: [told] },
          { subject: wren, statement: "Wren values quiet mornings on the water.", cites: [dawn] },
          { subject: "me", statement: "I like the sound of the ferry horn.", cites: [chose] },
        ],
      },
    });
    const reasons = o.beliefs.births.map((x) => x.reason);
    expect(reasons).toEqual(["subject-not-shown", "needs-a-lived-cite", "near-duplicate", "born", "born", "born", "limit-reached"]);
    expect(o.beliefs.births[2]?.id).toBe(held);
    expect(o.beliefs.births[2]?.detail).toContain("beliefs.filings");
    expect(o.retry).toContain("beliefs.births");
  });

  test("the night's births count across a second finish", () => {
    const { c, chose, told, dawn, wren } = world();
    const b = begin(c);
    finish(c, b, { beliefs: { births: [{ subject: "me", statement: "I keep the hard problems for dawn.", cites: [chose] }, { subject: "us", statement: "We do our best work early.", cites: [told] }] } });
    const again = finish(c, b, {
      entry: undefined,
      beliefs: { births: [{ subject: wren, statement: "Wren values quiet mornings.", cites: [dawn] }, { subject: "me", statement: "I enjoy ferry horns.", cites: [chose] }] },
    });
    expect(again.beliefs.births.map((x) => x.reason)).toEqual(["born", "limit-reached"]);
  });
});

describe("filings", () => {
  test("a shown memory filed for a shown belief counts once; again it adds nothing; an unshown belief or a bad stance is refused", () => {
    const { c, held, dawn } = world();
    const b = begin(c);
    const first = finish(c, b, {
      beliefs: {
        filings: [
          { belief: held, memory: dawn, stance: "support" },
          { belief: "sch_unshown", memory: dawn, stance: "support" },
          { belief: held, memory: dawn, stance: "maybe" },
        ],
      },
    });
    expect(first.beliefs.filings.map((x) => x.reason)).toEqual(["filed", "belief-not-shown", "stance-is-support-or-contrary"]);
    const uses = c.store.physicsOf(held).support;
    expect(uses).toBeGreaterThan(0);
    const again = finish(c, b, { entry: undefined, beliefs: { filings: [{ belief: held, memory: dawn, stance: "support" }] } });
    expect(again.beliefs.filings[0]).toMatchObject({ ok: true, reason: "already-counted" });
    expect(c.store.physicsOf(held).support).toBe(uses as number);
  });

  test("a belief this reflection bore may be filed to on its next finish", () => {
    const { c, chose, dawn } = world();
    const b = begin(c);
    const o = finish(c, b, {
      beliefs: { births: [{ subject: "me", statement: "I keep the hard problems for dawn.", cites: [chose] }] },
    });
    const id = o.beliefs.births[0]?.id as string;
    const again = finish(c, b, { entry: undefined, beliefs: { filings: [{ belief: id, memory: dawn, stance: "support" }] } });
    expect(again.beliefs.filings[0]?.reason).toBe("filed");
    expect(c.store.supportOf(id).map((r) => r.memoryId)).toContain(dawn);
  });
});

describe("contested beliefs, and the switch", () => {
  test("a contested belief is shown as contested; retire lets it go through the settle door, its words and support kept", () => {
    const c = brain();
    const day = nextDay(c);
    const me = c.schemas.ensureSelfSubject();
    const b0 = c.schemas.addBelief({ entityId: me, statement: "We work best at dawn.", day, birthRoute: "reflection", about: "us" }).id as string;
    c.schemas.fileSupport({ beliefId: b0, memoryId: mem(c, "Mike: dawn sessions are our best.", { saidBy: "owner" }), stance: "support", day });
    const against = mem(c, "Mike: honestly the late nights are where we do our best work.", { saidBy: "owner", salience: { claimed: 0.9 } });
    expect(c.schemas.fileSupport({ beliefId: b0, memoryId: against, stance: "contrary", day }).revision?.reason).toBe("contested");
    nextDay(c);
    mem(c, "A late session shipped the parser.");
    const b = begin(c);
    expect(b.beliefs?.subjects[0]?.beliefs[0]).toMatchObject({ id: b0, contested: true });
    expect(b.instructions).toContain("retire");
    const o = finish(c, b, { beliefs: { retire: [{ belief: b0, why: "Mike said the late nights are ours." }] } });
    expect(o.beliefs.retire[0]).toMatchObject({ ok: true, reason: "retired" });
    expect(c.store.row(b0)?.archived).toBe(1);
    expect(c.store.row(b0)?.body).toBe("We work best at dawn.");
    expect(c.store.supportOf(b0)).toHaveLength(2);
  });

  test("retire refuses a belief life has not contested: the night cannot unmake a belief it did not like", () => {
    const { c, held } = world();
    const b = begin(c);
    const o = finish(c, b, { beliefs: { retire: [{ belief: held, why: "I don't like it." }] } });
    expect(o.beliefs.retire[0]).toMatchObject({ ok: false, reason: "not-contested" });
    expect(c.store.row(held)?.archived).toBe(0);
  });

  test("a birth that replaces a contested belief says it better: the new one is born weak, the old one let go", () => {
    const c = brain();
    const day = nextDay(c);
    const me = c.schemas.ensureSelfSubject();
    const b0 = c.schemas.addBelief({ entityId: me, statement: "We work best at dawn.", day, birthRoute: "reflection", about: "us" }).id as string;
    const against = mem(c, "Mike: honestly the late nights are where we do our best work.", { saidBy: "owner", salience: { claimed: 0.9 } });
    c.schemas.fileSupport({ beliefId: b0, memoryId: against, stance: "contrary", day });
    nextDay(c);
    const late = mem(c, "Mike: the late session last night was our best this month.", { saidBy: "owner" });
    const b = begin(c);
    const o = finish(c, b, { beliefs: { births: [{ subject: "us", statement: "We do our best work late at night.", cites: [late], replaces: b0 }] } });
    expect(o.beliefs.births[0]?.reason).toBe("born");
    expect(o.beliefs.retire[0]).toMatchObject({ id: b0, ok: true, reason: "retired" });
    expect(c.store.row(b0)?.archived).toBe(1);
  });

  test("switched off (schemas.BELIEFS_BIRTH = false): no beliefs shown, none asked, what is sent refused; rows already written stay", () => {
    const { c, held, dawn, chose } = world();
    (SCHEMAS as { BELIEFS_BIRTH: boolean }).BELIEFS_BIRTH = false;
    const b = begin(c);
    expect(b.beliefs).toBeNull();
    expect(b.instructions).not.toContain("beliefs.subjects");
    const o = finish(c, b, { beliefs: { births: [{ subject: "me", statement: "I like dawn.", cites: [chose] }], filings: [{ belief: held, memory: dawn, stance: "support" }] } });
    expect(o.beliefs.births[0]?.reason).toBe("beliefs-off");
    expect(o.beliefs.filings[0]?.reason).toBe("beliefs-off");
    expect(c.store.row(held)?.archived).toBe(0);
    expect(c.store.supportOf(held)).toEqual([]);
  });
});

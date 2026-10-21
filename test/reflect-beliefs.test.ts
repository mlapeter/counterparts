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
import { REFLECT_TUNABLES } from "../src/core/dream/reflect.js";

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

/** Wren's card id (the world's person). */
function wren0(c: Counterpart): string {
  return c.schemas.entities().find((e) => e.name === "Wren")?.id as string;
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

  test("replaces only a contested belief this reflection was shown, on the same subject", () => {
    const { c, wren, held, dawn, told } = world();
    const me = c.schemas.ensureSelfSubject();
    const mine = c.schemas.addBelief({ entityId: me, statement: "We work best at dawn.", day: c.store.livedDay(), birthRoute: "reflection", about: "us" }).id as string;
    c.schemas.fileSupport({
      beliefId: mine,
      memoryId: mem(c, "Mike: honestly the late nights are where we do our best work.", { saidBy: "owner", salience: { claimed: 0.9 } }),
      stance: "contrary",
      day: c.store.livedDay(),
    });
    const b = begin(c);
    const o = finish(c, b, {
      beliefs: {
        births: [
          // Uncontested: no exemption from the near-duplicate check, and refused.
          { subject: wren, statement: "Wren likes the early ferries.", cites: [dawn], replaces: held },
          // Contested, but about me: not Wren's to replace.
          { subject: wren, statement: "Wren rides the dawn boat for the quiet.", cites: [dawn], replaces: mine },
        ],
      },
    });
    expect(o.beliefs.births.map((x) => x.reason)).toEqual(["replaces-not-contested", "replaces-other-subject"]);
    expect(c.store.row(held)?.archived).toBe(0);
    expect(c.store.row(mine)?.archived).toBe(0);
    void told;
  });

  test("a replacement must say something else than the contested belief it replaces", () => {
    const { c } = world();
    const me = c.schemas.ensureSelfSubject();
    const b0 = c.schemas.addBelief({ entityId: me, statement: "We work best at dawn.", day: c.store.livedDay(), birthRoute: "reflection", about: "us" }).id as string;
    const late = mem(c, "Mike: honestly the late nights are where we do our best work.", { saidBy: "owner", salience: { claimed: 0.9 } });
    c.schemas.fileSupport({ beliefId: b0, memoryId: late, stance: "contrary", day: c.store.livedDay() });
    const b = begin(c);
    const o = finish(c, b, {
      beliefs: {
        births: [
          { subject: "us", statement: "We work best at dawn!", cites: [late], replaces: b0 },
          { subject: "us", statement: "We  work best, at dawn.", cites: [late], replaces: b0 },
        ],
      },
    });
    expect(o.beliefs.births.map((x) => x.reason)).toEqual(["replaces-same-claim", "replaces-same-claim"]);
    expect(c.store.row(b0)?.archived).toBe(0);
    // A negation is what the contrary evidence says: a replacement, whatever it reads.
    const turned = finish(c, b, { entry: undefined, beliefs: { births: [{ subject: "us", statement: "We don't work best at dawn.", cites: [late], replaces: b0 }] } });
    expect(turned.beliefs.births[0]?.reason).toBe("born");
    expect(c.store.row(b0)?.archived).toBe(1);
  });

  test("a memory pasted in is not a belief; a statement is one line", () => {
    const { c, dawn, chose } = world();
    const b = begin(c);
    const o = finish(c, b, {
      beliefs: {
        births: [
          { subject: wren0(c), statement: "Wren took the six o'clock ferry again and said it was the best part of her week.", cites: [dawn] },
          { subject: "me", statement: "I keep\n  the hard problems\tfor dawn.", cites: [chose] },
        ],
      },
    });
    expect(o.beliefs.births.map((x) => x.reason)).toEqual(["pasted-from-memory", "born"]);
    expect(c.store.row(o.beliefs.births[1]?.id as string)?.body).toBe("I keep the hard problems for dawn.");
  });

  test("the births budget is on the row at each birth: a finish cut short after its births cannot birth past it on retry", () => {
    const { c, chose, told, dawn } = world();
    const b = begin(c);
    const store = c.store as unknown as { updateReflection: (id: string, patch: Record<string, unknown>) => void };
    const real = store.updateReflection.bind(c.store);
    store.updateReflection = (id, patch) => {
      if ("entry" in patch) throw new Error("cut short");
      real(id, patch);
    };
    expect(() =>
      c.reflections.finish({
        reflection: b.reflection,
        session: SESSION,
        entry: "Three beliefs tonight.",
        cites: [],
        beliefs: {
          births: [
            { subject: "me", statement: "I keep the hard problems for dawn.", cites: [chose] },
            { subject: "us", statement: "We do our best work early.", cites: [told] },
            { subject: "me", statement: "I notice quiet mornings help me think.", cites: [dawn] },
          ],
        },
      }),
    ).toThrow();
    store.updateReflection = real;
    const retry = finish(c, b, { beliefs: { births: [{ subject: "me", statement: "I prefer short replies.", cites: [chose] }] } });
    expect(retry.beliefs.births[0]?.reason).toBe("limit-reached");
  });

  test("the section is held to its share of the room, statements shown short; the weakest go to more", () => {
    const { c, wren, dawn } = world();
    const long = (i: number): string => `Wren ${String(i)} ${"really ".repeat(55)}likes ferries in her own particular way number ${String(i)}.`;
    for (let i = 0; i < 40; i += 1) {
      c.schemas.addBelief({ entityId: wren, statement: long(i), day: c.store.livedDay(), birthRoute: "reflection" });
    }
    void dawn;
    const b = begin(c);
    const section = JSON.stringify(b.beliefs);
    expect(section.length).toBeLessThanOrEqual(REFLECT_TUNABLES.ROOM_CHARS * REFLECT_TUNABLES.BELIEF_SHARE);
    const w = b.beliefs?.subjects.find((x) => x.id === wren);
    for (const x of w?.beliefs ?? []) expect(x.statement.length).toBeLessThanOrEqual(REFLECT_TUNABLES.BELIEF_SHOWN_CHARS + 1);
    expect((w?.more ?? 0) + (w?.beliefs.length ?? 0)).toBe(41);
  });

  test("the trim is round-robin: me (and us) keep theirs while the room allows, the fullest subject gives first", () => {
    const { c, wren } = world();
    const me = c.schemas.ensureSelfSubject();
    const long = (who: string, i: number): string => `${who} ${String(i)} ${"really ".repeat(55)}particular claim number ${String(i)}.`;
    for (let i = 0; i < 12; i += 1) {
      // Mine weaker (claimed low), Wren's at the ceiling.
      c.schemas.addBelief({ entityId: me, statement: long("I", i), day: c.store.livedDay(), birthRoute: "reflection", about: "me", claimedSalience: 0.1 });
      c.schemas.addBelief({ entityId: wren, statement: long("Wren", i), day: c.store.livedDay(), birthRoute: "reflection" });
    }
    const b = begin(c);
    const mine = b.beliefs?.subjects.find((x) => x.id === me);
    const hers = b.beliefs?.subjects.find((x) => x.id === wren);
    expect(mine?.beliefs.length).toBeGreaterThanOrEqual(REFLECT_TUNABLES.BELIEFS_KEPT_PER_SUBJECT);
    expect(Math.abs((mine?.beliefs.length ?? 0) - (hers?.beliefs.length ?? 0))).toBeLessThanOrEqual(1);
  });

  test("switched off (schemas.BELIEFS_BIRTH = false): no beliefs shown, none asked, what is sent refused; rows already written stay", () => {
    const { c, held, dawn, chose } = world();
    (SCHEMAS as { BELIEFS_BIRTH: boolean }).BELIEFS_BIRTH = false;
    const b = begin(c);
    // Byte for byte as before beliefs: no key, no filings limit.
    expect("beliefs" in b).toBe(false);
    expect("beliefFilings" in b.limits).toBe(false);
    expect(b.instructions).not.toContain("beliefs.subjects");
    const o = finish(c, b, { beliefs: { births: [{ subject: "me", statement: "I like dawn.", cites: [chose] }], filings: [{ belief: held, memory: dawn, stance: "support" }] } });
    expect(o.beliefs.births[0]?.reason).toBe("beliefs-off");
    expect(o.beliefs.filings[0]?.reason).toBe("beliefs-off");
    expect(c.store.row(held)?.archived).toBe(0);
    expect(c.store.supportOf(held)).toEqual([]);
  });
});

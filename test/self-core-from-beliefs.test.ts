/**
 * THE SELF'S CORE FROM BELIEFS (wave 2 lane F, 2026-10-22; design §6, lightly
 * held), behind `self.CORE_FROM_BELIEFS` (default off).
 *
 * Off, the night's reflection is byte for byte what it was before lane F: the
 * golden below was written from master 48c7fd05 BEFORE any of lane F's code
 * existed (`UPDATE_GOLDEN=1` rewrites it; a deliberate change says so in its
 * PR). On, the core the page rests on is the strongest beliefs about me and
 * us that pass the floors, the reflection is shown them as the spine, and a
 * page may cite them.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called:
 * the "reflecting mind" is the test, calling the MCP `reflect` tool the way the
 * night's launch prompt says to.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { applySettings, restoreSettings } from "../tools/harness/settings.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart, coreBeliefFloors, coreBeliefMiss, coreFromBeliefs } from "../src/core/counterpart.js";
import type { CoreBelief } from "../src/core/counterpart.js";
import type { ReflectBundle } from "../src/core/dream/reflect.js";
import { pageTrace } from "../src/core/self/measures.js";
import { pageClaims, pageSections } from "../src/core/self/page.js";
import type { SelfPage } from "../src/core/self/page.js";
import { SELF_TUNABLES as SELF } from "../src/core/self/tunables.js";
import type { PutInput } from "../src/core/store/index.js";

const GOLDEN = join(import.meta.dir, "fixtures", "self-core-off.golden.json");
const T0 = Date.UTC(2026, 8, 1, 12);
const DAY_MS = 86_400_000;
const SESSION = "s-core-beliefs";

let dir: string;
let dateN = 0;
const open: Counterpart[] = [];

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-core-beliefs-"));
});

afterEach(() => {
  (SELF as { CORE_FROM_BELIEFS: boolean }).CORE_FROM_BELIEFS = false;
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
  const c = Counterpart.open({ dir, identity: { name: "Mike" }, timeZone: "UTC", now: () => T0 + dateN * DAY_MS });
  open.push(c);
  return c;
}

function nextDay(c: Counterpart): number {
  dateN += 1;
  c.store.advanceClock(new Date(T0 + dateN * DAY_MS).toISOString().slice(0, 10));
  return c.store.livedDay();
}

let memN = 0;
function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  memN += 1;
  return c.store.put({
    id: `mem_f${String(memN).padStart(5, "0")}`,
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    origin: { session: `sess-${String(day)}`, scope: "/work" },
    ...over,
  });
}

/** Minted ids out (beliefs, the self subject, the reflection); what is left is what the night decided. */
function normalize(s: string): string {
  const seen = new Map<string, string>();
  return s.replace(/\b(rfl|mem|sch|ent|epi|drm|bel|ctr|fel)_[0-9a-f]{6,16}\b/g, (id, p: string) => {
    if (!seen.has(id)) seen.set(id, `${p}_<${String(seen.size)}>`);
    return seen.get(id) as string;
  });
}

/**
 * THE FIXTURE: a few lived days, the self subject with three beliefs about me
 * and us — one backed by the owner's words and my choices on three days, one
 * backed only by a reflection's finds filed on one night, one barely backed —
 * and a core memory the lanes promoted.
 */
interface World {
  c: Counterpart;
  backed: string;
  found: string;
  thin: string;
  told: string[];
  finds: string[];
  core: string;
}

function world(): World {
  memN = 0;
  const c = brain();
  let day = nextDay(c);
  const me = c.schemas.ensureSelfSubject();
  const core = mem(c, "I say what I do not know before I guess.", { kind: "self", about: "me", physics: { birthDay: day, lastUsedDay: day, promotedIdentity: true } });
  const told: string[] = [];
  const finds: string[] = [];
  told.push(mem(c, "Mike said our dawn sessions are when we do our best work together.", { saidBy: "owner", about: "us", origin: { session: "sess-a", scope: "/work" } }));
  finds.push(mem(c, "We spent the morning untangling the migration, and it went quickly.", { about: "us", origin: { session: "sess-a", scope: "/work" } }));
  day = nextDay(c);
  told.push(mem(c, "I chose to keep the dawn slot for the hard problems.", { saidBy: "self", about: "me", origin: { session: "sess-b", scope: "/home" } }));
  finds.push(mem(c, "The hard refactor landed before nine; Mike was pleased.", { about: "us", origin: { session: "sess-b", scope: "/home" } }));
  day = nextDay(c);
  told.push(mem(c, "Mike: the early sessions are the ones I look forward to.", { saidBy: "owner", about: "us", origin: { session: "sess-c", scope: "/site" } }));
  mem(c, "Plain work: the build cache was cleared.");
  day = nextDay(c);
  const backed = c.schemas.addBelief({ entityId: me, statement: "We do our best work at dawn.", day, birthRoute: "reflection", about: "us" }).id as string;
  const found = c.schemas.addBelief({ entityId: me, statement: "Our mornings go quickly when we untangle things together.", day, birthRoute: "reflection", about: "us" }).id as string;
  const thin = c.schemas.addBelief({ entityId: me, statement: "I keep the hard problems for first thing.", day, birthRoute: "reflection", about: "me" }).id as string;
  // Lived support, filed tonight: each counts its memory's own day.
  for (const m of told) expect(c.schemas.fileSupport({ beliefId: backed, memoryId: m, stance: "support", day }).ok).toBe(true);
  // A reflection's finds, filed on ONE night: un-echoed, they count the filing day.
  for (const m of finds) expect(c.schemas.fileSupport({ beliefId: found, memoryId: m, stance: "support", route: "found", day }).ok).toBe(true);
  expect(c.schemas.fileSupport({ beliefId: found, memoryId: told[0] as string, stance: "support", route: "found", day: day }).ok).toBe(true);
  expect(c.schemas.fileSupport({ beliefId: thin, memoryId: told[1] as string, stance: "support", day }).ok).toBe(true);
  nextDay(c);
  return { c, backed, found, thin, told, finds, core };
}

const PAGE = [
  "## Core",
  "",
  "I say what I do not know before I guess.",
  "We do our best work at dawn.",
  "I am patient with long migrations.",
  "",
  "## Lately",
  "",
  "Mornings with Mike have been the good part of the week.",
].join("\n");

/** The night's reflection through the core door, begin to finish, and what it left. */
function night(w: World): Record<string, unknown> {
  const { c } = w;
  const b = c.reflections.begin({ session: SESSION });
  if (!b.ok) throw new Error(`begin refused: ${b.reason}`);
  const done = c.reflections.finish({
    reflection: b.bundle.reflection,
    session: SESSION,
    entry: "Looking back over the last few days, the mornings stand out.",
    cites: [w.told[0] as string, w.core],
    page: {
      text: PAGE,
      cites: [w.core, w.told[0] as string],
      claims: [
        { text: "I say what I do not know before I guess.", cites: [w.core] },
        { text: "We do our best work at dawn.", cites: [w.backed, w.told[0] as string] },
        { text: "Mornings with Mike have been the good part of the week.", cites: [w.told[2] as string] },
      ],
    },
  });
  if (!done.ok) throw new Error(`finish refused: ${done.reason}`);
  const page = c.selfPage();
  return JSON.parse(
    normalize(
      JSON.stringify({
        text: b.text,
        instructions: b.instructions,
        outcome: done.outcome,
        page: page === null ? null : { body: page.body, trace: page.trace },
      }),
    ),
  ) as Record<string, unknown>;
}

describe("off, the night is what it was", () => {
  test("the reflection's bundle, its ask, its finish and the page written match the pre-lane-F golden byte for byte", () => {
    const got = night(world());
    if (process.env["UPDATE_GOLDEN"] === "1" || !existsSync(GOLDEN)) {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    }
    expect(JSON.stringify(got, null, 2)).toBe(readFileSync(GOLDEN, "utf8").trimEnd());
  });
});

// ── on ──────────────────────────────────────────────────────────────────────

function on(): void {
  (SELF as { CORE_FROM_BELIEFS: boolean }).CORE_FROM_BELIEFS = true;
}

function server(c: Counterpart): McpServer {
  recordSession(dir, { sessionId: SESSION, scope: "/proj", phase: "start", at: T0 + dateN * DAY_MS });
  return new McpServer({ counterpart: c, scope: "/proj", registryDir: dir, now: () => T0 + dateN * DAY_MS });
}

function textOf(res: { content?: readonly { text?: string }[] }): string {
  return res.content?.[0]?.text ?? "";
}

/** The bundle a `begin` handed, as JSON (the line after the opener). */
function bundleOf(res: { content?: readonly { text?: string }[] }): ReflectBundle {
  const text = String((JSON.parse(textOf(res)) as { bundle: string }).bundle);
  return JSON.parse(text.split("\n").slice(1).join("\n")) as ReflectBundle;
}

/**
 * A STORE WITH A BELIEF ABOUT US THAT LIFE BACKED: the owner's words and my
 * own choice on four lived days, in four sessions and folders, felt at the
 * time — and two that did not earn the core: one with a single memory, one
 * about a person (not the self subject).
 */
function dawnWorld(): { c: Counterpart; dawn: string; thin: string; wren: string; lived: string[]; plain: string } {
  memN = 100;
  const c = brain();
  const lived: string[] = [];
  const felt = { relevance: 0.6, emotional: 0.6, predictive: 0.6 };
  const words = [
    "Mike: our dawn sessions are the best of the week.",
    "I chose the dawn slot for the hard problems again.",
    "Mike said he looks forward to the early sessions.",
    "Mike: we do our clearest thinking before nine.",
  ];
  for (let i = 0; i < 4; i++) {
    nextDay(c);
    lived.push(
      mem(c, words[i] as string, {
        saidBy: i === 1 ? "self" : "owner",
        about: "us",
        salience: felt,
        origin: { session: `sess-dawn-${String(i)}`, scope: `/d${String(i)}` },
      }),
    );
  }
  const plain = mem(c, "We moved the long review to a morning, and it went well.", { about: "us" });
  const day = nextDay(c);
  const me = c.schemas.ensureSelfSubject();
  const dawn = c.schemas.addBelief({ entityId: me, statement: "We do our best work at dawn.", day, birthRoute: "reflection", about: "us" }).id as string;
  const thin = c.schemas.addBelief({ entityId: me, statement: "I keep the hard problems for first thing.", day, birthRoute: "reflection", about: "me" }).id as string;
  const wrenCard = c.schemas.mention({ name: "Wren", kind: "person", source: "Wren", chunkRef: "t", day }).id as string;
  const wren = c.schemas.addBelief({ entityId: wrenCard, statement: "Wren likes early ferries.", day, birthRoute: "reflection" }).id as string;
  for (const m of lived) {
    expect(c.schemas.fileSupport({ beliefId: dawn, memoryId: m, stance: "support", day }).ok).toBe(true);
    expect(c.schemas.fileSupport({ beliefId: wren, memoryId: m, stance: "support", route: "found", day }).ok).toBe(true);
  }
  expect(c.schemas.fileSupport({ beliefId: thin, memoryId: lived[1] as string, stance: "support", day }).ok).toBe(true);
  nextDay(c);
  return { c, dawn, thin, wren, lived, plain };
}

describe("the core from beliefs: the reading", () => {
  afterEach(() => restoreSettings());

  test("the strongest beliefs about me and us that pass the floors — not a person's, not one with a single memory — and nothing is written", () => {
    const { c, dawn, thin, wren } = dawnWorld();
    const before = c.store.physicsOf(dawn);
    const r = coreFromBeliefs(c.store, c.store.livedDay());
    expect(r.elements.map((e) => e.id)).toEqual([dawn]);
    expect(r.considered).toBe(2);
    const d = r.elements[0] as CoreBelief;
    expect(d).toMatchObject({ about: "us", memories: 4, days: 4, contested: false, statement: "We do our best work at dawn." });
    expect(d.strength).toBeGreaterThanOrEqual(SELF.CORE_BELIEF_STRENGTH);
    expect(r.held.strength + r.held.memories).toBe(1);
    expect(r.elements.some((e) => e.id === wren || e.id === thin)).toBe(false);
    // A read: the belief's physics are as they were, and it is never promoted.
    expect(c.store.physicsOf(dawn)).toEqual(before);
    expect(c.store.row(dawn)?.promoted_identity).toBe(0);
  });

  test("the floors and the switch are a run's to set (`harness compare --set self.…`), read at use", () => {
    const { c, dawn, thin } = dawnWorld();
    applySettings(["self.CORE_FROM_BELIEFS=true", "self.CORE_BELIEF_STRENGTH=0", "self.CORE_BELIEF_MEMORIES=1", "self.CORE_BELIEF_DAYS=1"]);
    expect(SELF.CORE_FROM_BELIEFS).toBe(true);
    expect(coreFromBeliefs(c.store, c.store.livedDay()).elements.map((e) => e.id)).toEqual([dawn, thin]);
    applySettings(["self.CORE_BELIEF_DAYS=5"]);
    expect(coreFromBeliefs(c.store, c.store.livedDay()).held.days).toBe(2);
    restoreSettings();
    expect(SELF.CORE_FROM_BELIEFS).toBe(false);
    expect(coreFromBeliefs(c.store, c.store.livedDay(), { ...coreBeliefFloors(), max: 0 }).held.cap).toBe(1);
  });

  test("a contested belief is not settled, whatever its numbers", () => {
    const b: CoreBelief = { id: "x", statement: "s", about: "us", strength: 0.9, memories: 9, days: 9, contested: true };
    expect(coreBeliefMiss(b, coreBeliefFloors())).toBe("contested");
    expect(coreBeliefMiss({ ...b, contested: false }, coreBeliefFloors())).toBeNull();
  });
});

describe("the core from beliefs: the night's reflection, through the reflect tool", () => {
  afterEach(() => restoreSettings());

  test("off: no spine, and a belief is not the page's to cite (lane C's rule stands)", async () => {
    const { c, dawn, lived } = dawnWorld();
    const s = server(c);
    const begin = await s.call("reflect", { phase: "begin", session: SESSION });
    expect(begin.isError ?? false).toBe(false);
    const b = bundleOf(begin);
    expect(b.spine).toBeUndefined();
    const fin = await s.call("reflect", {
      phase: "finish",
      session: SESSION,
      reflection: b.reflection,
      entry: "The mornings stand out.",
      cites: [lived[3]],
      page: { text: "## Core\n\nWe do our best work at dawn.", cites: [dawn, lived[3]], claims: [{ text: "We do our best work at dawn.", cites: [dawn] }] },
    });
    expect(fin.isError ?? false).toBe(false);
    expect((fin.structuredContent["refusedCites"] as string[]).some((x) => x.startsWith(dawn))).toBe(true);
  });

  test("on: the core is the beliefs — shown as the spine, cited on the page, never strengthened by it — and a Core line with no belief is not settled", async () => {
    on();
    const { c, dawn, thin, lived, plain } = dawnWorld();
    const s = server(c);
    const before = c.store.physicsOf(dawn);
    const begin = await s.call("reflect", { phase: "begin", session: SESSION });
    expect(begin.isError ?? false).toBe(false);
    const b = bundleOf(begin);
    // THE SPINE: the belief about us that life backed, with what stands behind it.
    expect(b.spine?.map((x) => x.id)).toEqual([dawn]);
    expect(b.spine?.[0]).toMatchObject({ statement: "We do our best work at dawn.", about: "us", memories: 4, days: 4 });
    const how = String(begin.structuredContent["how"]);
    expect(how).toContain("Its spine is the beliefs in spine");
    expect(how).toContain('Under "## Core", state as settled only what a spine belief says');
    // The thin belief is still shown to file to (lane C), but it is no part of the core.
    expect(b.beliefs?.subjects[0]?.beliefs.some((x) => x.id === thin)).toBe(true);

    const page = [
      "## Core",
      "",
      "We do our best work at dawn, and the hard problems wait for it.",
      "I am patient with long migrations.",
      "We trust each other with the unfinished parts.",
      "",
      "## Lately",
      "",
      "The long review moved to a morning and went well.",
    ].join("\n");
    const fin = await s.call("reflect", {
      phase: "finish",
      session: SESSION,
      reflection: b.reflection,
      entry: "The mornings stand out.",
      // The entry may not cite a belief, nor a feeling be put on one; the page may cite it.
      cites: [lived[3], dawn],
      feelings: [{ id: dawn, core: "warm", emotion: "fond", strength: 0.6 }],
      page: {
        text: page,
        cites: [dawn],
        claims: [
          { text: "We do our best work at dawn, and the hard problems wait for it.", cites: [dawn, lived[3]] },
          // A Core line resting on a memory only: lived, not settled.
          { text: "I am patient with long migrations.", cites: [lived[3]] },
          // "We trust each other…" cites nothing: a hypothesis, and not settled.
          { text: "The long review moved to a morning and went well.", cites: [plain] },
        ],
      },
    });
    expect(fin.isError ?? false).toBe(false);
    const sc = fin.structuredContent;
    const pageOut = sc["page"] as { written: boolean; reason: string; note?: string };
    expect(pageOut.written).toBe(true);
    const refused = (sc["refusedCites"] as string[] | undefined) ?? [];
    expect(refused.filter((x) => x.startsWith(dawn))).toEqual([`${dawn}:not-shown`]);
    expect((sc["feelings"] as { ok: boolean }[])[0]?.ok).toBe(false);
    // Cited on the page, the belief does not come back: no return, no strength.
    const returned = sc["returned"] as { id: string; counted: boolean; reason: string }[];
    expect(returned.find((x) => x.id === dawn)).toEqual({ id: dawn, counted: false, reason: "a-belief-is-not-returned" });
    expect(c.store.physicsOf(dawn)).toEqual(before);
    expect(c.store.returnsOf(dawn)).toEqual([]);
    // It rests on the spine, so no "cites none" note; two Core lines rest on no belief, and are said.
    expect(pageOut.note ?? "").not.toContain("cites none of the beliefs in the spine");
    expect(pageOut.note).toContain('2 sentences under "## Core" rest on no belief in the spine');
    expect(pageOut.note).toContain("I am patient with long migrations.");
    expect(JSON.parse(c.store.reflection(b.reflection)?.detail ?? "{}")).toMatchObject({ spine: [dawn], coreUnsettled: 2 });

    // The page as stored: the settled line cites the belief; the others do not.
    const stored = c.selfPage();
    const trace = stored?.trace?.claims ?? [];
    const cites = (start: string): readonly string[] => trace.find((x) => x.text.startsWith(start))?.cites ?? [];
    expect(cites("We do our best work at dawn")).toContain(dawn);
    expect(cites("I am patient")).not.toContain(dawn);
    expect(cites("We trust each other")).toEqual([]);
    expect(pageTrace(c.store, stored as SelfPage).hypotheses).toEqual(["We trust each other with the unfinished parts."]);
    // Settled = a Core line citing a belief: one of the three.
    const core = pageClaims(pageSections(stored?.body ?? "").core);
    expect(core).toHaveLength(3);
    expect(core.filter((sentence) => cites(sentence).some((id) => c.store.row(id)?.meta.includes('"belief"') === true))).toHaveLength(1);
  });

  test("on: a page that cites no belief of the spine is written, and told so", async () => {
    on();
    const { c, lived } = dawnWorld();
    const s = server(c);
    const b = bundleOf(await s.call("reflect", { phase: "begin", session: SESSION }));
    const fin = await s.call("reflect", {
      phase: "finish",
      session: SESSION,
      reflection: b.reflection,
      entry: "Quiet.",
      cites: [lived[3]],
      page: { text: "## Lately\n\nThe mornings were good.", cites: [lived[3]], claims: [{ text: "The mornings were good.", cites: [lived[3]] }] },
    });
    const pageOut = fin.structuredContent["page"] as { written: boolean; note?: string };
    expect(pageOut.written).toBe(true);
    expect(pageOut.note).toContain("It cites none of the beliefs in the spine");
    // No "## Core": nothing stated there as settled.
    expect(JSON.parse(c.store.reflection(b.reflection)?.detail ?? "{}")["coreUnsettled"]).toBe(0);
  });

  test("on, with nothing earned: an empty spine, and the ask says the core is still forming", async () => {
    on();
    memN = 200;
    const c = brain();
    nextDay(c);
    mem(c, "We started working together today.", { about: "us" });
    nextDay(c);
    const begin = await server(c).call("reflect", { phase: "begin", session: SESSION });
    expect(bundleOf(begin).spine).toEqual([]);
    expect(String(begin.structuredContent["how"])).toContain("No belief about me or us has earned the core yet");
  });

  test("on: one night's finds are one lived day — the belief waits for life to echo them (≥2 days, as C's resistance counts)", async () => {
    // Strength and memories out of the way, so the days floor alone decides.
    applySettings(["self.CORE_FROM_BELIEFS=true", "self.CORE_BELIEF_STRENGTH=0", "self.CORE_BELIEF_MEMORIES=2", "self.CORE_BELIEF_DAYS=2"]);
    memN = 300;
    const c = brain();
    const plain: string[] = [];
    const words = ["We untangled the migration together in an hour.", "The refactor landed early; it felt easy between us.", "Another clean morning of pairing on the queue."];
    for (let i = 0; i < 3; i++) {
      nextDay(c);
      plain.push(mem(c, words[i] as string, { about: "us", origin: { session: `sess-f-${String(i)}`, scope: `/f${String(i)}` } }));
    }
    const me = c.schemas.ensureSelfSubject();
    const found = c.schemas.addBelief({ entityId: me, statement: "We untangle hard things well together.", day: c.store.livedDay(), birthRoute: "reflection", about: "us" }).id as string;
    nextDay(c);
    const s = server(c);

    // NIGHT 1: the reflection files its finds — three memories from three lived days, on one night.
    let b = bundleOf(await s.call("reflect", { phase: "begin", session: SESSION }));
    expect(b.spine).toEqual([]);
    for (const m of plain) expect(b.memories[m]).toBeDefined();
    let fin = await s.call("reflect", {
      phase: "finish",
      session: SESSION,
      reflection: b.reflection,
      entry: "A pattern in how we work.",
      cites: plain,
      beliefs: { filings: plain.map((m) => ({ belief: found, memory: m, stance: "support" })) },
    });
    expect(fin.isError ?? false).toBe(false);
    expect(c.store.supportOf(found).map((r) => r.route)).toEqual(["found", "found", "found"]);
    // Un-echoed, the finds count the day they were FILED: one lived day.
    let read = coreFromBeliefs(c.store, c.store.livedDay());
    expect(read.elements).toEqual([]);
    expect(read.held.days).toBe(1);
    expect(c.store.physicsOf(found).supportDays).toBe(1);

    // NIGHT 2: still one day, so no spine. Then life echoes it: the owner's words, later.
    nextDay(c);
    const echo = mem(c, "Mike: we're good at untangling the hard stuff together.", { saidBy: "owner", about: "us", origin: { session: "sess-echo", scope: "/echo" } });
    nextDay(c);
    b = bundleOf(await s.call("reflect", { phase: "begin", session: SESSION }));
    expect(b.spine).toEqual([]);
    fin = await s.call("reflect", {
      phase: "finish",
      session: SESSION,
      reflection: b.reflection,
      entry: "Mike said it too.",
      cites: [echo],
      beliefs: { filings: [{ belief: found, memory: echo, stance: "support" }] },
    });
    expect(fin.isError ?? false).toBe(false);
    // Echoed: each find now counts its memory's own day.
    read = coreFromBeliefs(c.store, c.store.livedDay());
    expect(read.elements.map((e) => e.id)).toEqual([found]);
    expect((read.elements[0] as CoreBelief).days).toBeGreaterThanOrEqual(2);

    // NIGHT 3: the spine carries it.
    nextDay(c);
    b = bundleOf(await s.call("reflect", { phase: "begin", session: SESSION }));
    expect(b.spine?.map((x) => x.id)).toEqual([found]);
  });
});

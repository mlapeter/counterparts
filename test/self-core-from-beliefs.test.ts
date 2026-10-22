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

import { Counterpart } from "../src/core/counterpart.js";
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

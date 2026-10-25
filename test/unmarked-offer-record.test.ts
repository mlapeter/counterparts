/**
 * THE UNMARKED OFFER, ON THE RECORD (2026-10-24, D1). From 10-10 to 10-23 no
 * reflection row recorded `detail.unmarked`: on a night with a dream, the fixed
 * parts (the dream's saw list, chapters, page) filled the room, the offer's
 * reserve was bounded by what was left (0), every offered id waited, and an
 * empty offer wrote no key. Now each night the reflection is offered up to
 * `UNMARKED` unmarked memories whatever the room (with `REFLECT_ROOM_ORDER`),
 * and its row always says what it was offered and which of them it marked —
 * an empty list too.
 *
 * Every check goes through the MCP `reflect` tool, the door the night's
 * reflection child uses. Every memory is invented for the test. Hermetic: a
 * fresh temp data dir per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_TUNABLES, REFLECT_TUNABLES, unmarkedOfferCap } from "../src/core/dream/index.js";
import { FIT_TUNABLES, lineOf, readIndex, wireChars } from "../src/core/fit/index.js";
import type { PutInput } from "../src/core/store/index.js";

const NOW = Date.UTC(2026, 9, 24, 15, 0);
const R = REFLECT_TUNABLES as unknown as Record<string, number>;
const ROOM_WAS = R["ROOM_CHARS"] as number;
const D = DREAM_TUNABLES as unknown as Record<string, boolean>;
const ORDER_WAS = D["REFLECT_ROOM_ORDER"] as boolean;

let root: string;
let dir: string;
let WORKSHOP: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-unmarked-record-")));
  dir = join(root, "store");
  WORKSHOP = join(root, "workshop");
  mkdirSync(WORKSHOP, { recursive: true });
  D["REFLECT_ROOM_ORDER"] = true;
});

afterEach(() => {
  R["ROOM_CHARS"] = ROOM_WAS;
  D["REFLECT_ROOM_ORDER"] = ORDER_WAS;
  rmSync(root, { recursive: true, force: true });
});

/** Write some memories in a closed brain, then close it: the night opens its own. */
function seed(write: (put: (body: string, over?: Partial<PutInput>) => string) => void): void {
  const c = Counterpart.open({ dir, identity: { name: "Dana" }, now: () => NOW, timeZone: "UTC" });
  try {
    write((body, over = {}) => {
      const day = c.store.livedDay();
      return c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.9, emotional: 0.6, predictive: 0.8 }, physics: { birthDay: day, lastUsedDay: day }, ...over });
    });
  } finally {
    c.close();
  }
}

interface Night {
  offered: string[];
  detail: Record<string, unknown>;
  about: string | null;
}

/** One night's reflection through the MCP door: begin, then finish marking `mark` (id → mark). */
async function night(session: string, mark: Record<string, string> = {}, look: string | null = null): Promise<Night> {
  const s = openServer({ dir, session, scope: WORKSHOP, timeZone: "UTC" });
  try {
    const b = await s.call("reflect", { phase: "begin", session });
    expect(b.isError ?? false).toBe(false);
    const rid = b.structuredContent["reflection"] as string;
    const begun = JSON.parse(s.counterpart.store.reflection(rid)?.detail ?? "{}") as Record<string, unknown>;
    // The begin always says what was offered, an empty list included.
    expect(Array.isArray(begun["unmarked"])).toBe(true);
    const offered = begun["unmarked"] as string[];
    const f = await s.call("reflect", {
      phase: "finish",
      session,
      reflection: rid,
      entry: "A quiet night.",
      ...(Object.keys(mark).length > 0 ? { about: Object.entries(mark).map(([id, about]) => ({ id, about, why: "By what it says." })) } : {}),
    });
    expect(f.isError ?? false).toBe(false);
    const detail = JSON.parse(s.counterpart.store.reflection(rid)?.detail ?? "{}") as Record<string, unknown>;
    return { offered, detail, about: look === null ? null : (s.counterpart.store.read(look).about ?? null) };
  } finally {
    s.counterpart.close();
  }
}

const counts = (d: Record<string, unknown>): Record<string, number> => d["counts"] as Record<string, number>;

describe("the unmarked offer, on the record", () => {
  test("unmarked folder work is offered, and the finished row says offered N, marked 0", async () => {
    const ids: string[] = [];
    seed((put) => {
      ids.push(put("Dana's sister is visiting next weekend.", { origin: { scope: WORKSHOP } }));
      ids.push(put("The kiln's cone 6 hold went to twenty minutes.", { origin: { scope: WORKSHOP } }));
      ids.push(put("The glaze shelf was moved to the north wall.", { origin: { scope: WORKSHOP } }));
      // Marked at write: never offered.
      put("The bisque firing log lives in the red binder.", { origin: { scope: WORKSHOP }, about: "work" });
    });
    const n = await night("s-night-1");
    expect([...n.offered].sort()).toEqual([...ids].sort());
    // The likeliest personal first.
    expect(n.offered[0]).toBe(ids[0]);
    expect(n.detail["unmarked"]).toEqual(n.offered);
    expect(n.detail["unmarkedMarked"]).toEqual([]);
    expect(counts(n.detail)["unmarkedOffered"]).toBe(3);
    expect(counts(n.detail)["unmarkedMarked"]).toBe(0);
  });

  test("a mark of owner on an offered one changes its about mark, and the row names it", async () => {
    let visit = "";
    let kiln = "";
    seed((put) => {
      visit = put("Dana's sister is visiting next weekend.", { origin: { scope: WORKSHOP } });
      kiln = put("The kiln's cone 6 hold went to twenty minutes.", { origin: { scope: WORKSHOP } });
    });
    const n = await night("s-night-1", { [visit]: "owner" }, visit);
    expect(n.offered).toContain(visit);
    expect(n.offered).toContain(kiln);
    expect(n.about).toBe("owner");
    expect(n.detail["unmarkedMarked"]).toEqual([visit]);
    expect(counts(n.detail)["unmarkedOffered"]).toBe(2);
    expect(counts(n.detail)["unmarkedMarked"]).toBe(1);
  });

  test("no unmarked memories: the row says offered 0, marked 0", async () => {
    seed((put) => {
      put("The kiln's cone 6 hold went to twenty minutes.", { origin: { scope: WORKSHOP }, about: "work" });
      put("Dana's sister is visiting next weekend.", { origin: { scope: WORKSHOP }, about: "owner" });
    });
    const n = await night("s-night-1");
    expect(n.offered).toEqual([]);
    expect(n.detail["unmarked"]).toEqual([]);
    expect(n.detail["unmarkedMarked"]).toEqual([]);
    expect(counts(n.detail)["unmarkedOffered"]).toBe(0);
    expect(counts(n.detail)["unmarkedMarked"]).toBe(0);
  });

  test("a night whose fixed parts fill the room (10-23's case) is still offered them, a line each", async () => {
    const ids: string[] = [];
    seed((put) => {
      for (let i = 0; i < 6; i += 1) ids.push(put(`Workshop note ${String(i)}: the slip bucket was topped up and the wedging table scraped clean.`, { origin: { scope: WORKSHOP } }));
      // A long core: the long view and the earlier parts take the room first.
      for (let i = 0; i < 8; i += 1) put(`Who I am, ${String(i)}: ${"I keep the hard problems for first thing and say what I do not know. ".repeat(20)}`, { kind: "self", about: "me", physics: { birthDay: 0, lastUsedDay: 0, promotedIdentity: true } });
    });
    // No room at all past the fixed parts: before, the offer's reserve was
    // bounded by it and came to nothing.
    R["ROOM_CHARS"] = 1;
    const n = await night("s-night-1");
    expect([...n.offered].sort()).toEqual([...ids].sort());
    expect(counts(n.detail)["unmarkedOffered"]).toBe(6);
  });

  test("past the room the offer is UNMARKED lines at most, never excerpts: a stated bound (review of #619)", async () => {
    const cap = REFLECT_TUNABLES.UNMARKED;
    const bodies = new Map<string, string>();
    seed((put) => {
      // Long and wide: each body far past DETAIL_CHARS, its first line past
      // LINE_BYTES, with non-ASCII so the wire cost is at its widest.
      for (let i = 0; i < cap + 4; i += 1) {
        const body = `Atelier note ${String(i)} — ${"émail céladon, cuisson réduite, ".repeat(30)}\n${"Le four a tenu la palier vingt minutes et la glaçure a coulé sur l'étagère. ".repeat(80)}`;
        bodies.set(put(body, { origin: { scope: WORKSHOP } }), body);
      }
      for (let i = 0; i < 8; i += 1) put(`Who I am, ${String(i)}: ${"I keep the hard problems for first thing and say what I do not know. ".repeat(20)}`, { kind: "self", about: "me", physics: { birthDay: 0, lastUsedDay: 0, promotedIdentity: true } });
    });
    R["ROOM_CHARS"] = 1;
    const s = openServer({ dir, session: "s-bound", scope: WORKSHOP, timeZone: "UTC" });
    try {
      const b = await s.call("reflect", { phase: "begin", session: "s-bound" });
      expect(b.isError ?? false).toBe(false);
      const rid = b.structuredContent["reflection"] as string;
      const offered = (JSON.parse(s.counterpart.store.reflection(rid)?.detail ?? "{}") as Record<string, unknown>)["unmarked"] as string[];
      expect(offered).toHaveLength(cap);
      // How the fit showed them: a line each (or whole, when the whole is no
      // longer than its line) — never an excerpt or a bare id.
      const index = readIndex(s.counterpart.store, "reflection");
      expect(index?.ref).toBe(rid);
      const asLine = new Set([...(index?.offered.line ?? []), ...(index?.offered.whole ?? [])]);
      for (const id of offered) {
        expect(asLine.has(id)).toBe(true);
        expect(index?.offered.excerpt ?? []).not.toContain(id);
        expect(index?.offered.id ?? []).not.toContain(id);
      }
      // What they cost, measured as the fit measures it, within the bound.
      const cost = offered.reduce((n, id) => n + FIT_TUNABLES.OVERHEAD + wireChars(lineOf({ body: bodies.get(id) ?? "" }, REFLECT_TUNABLES.LINE_BYTES)), 0);
      expect(cost).toBeLessThanOrEqual(unmarkedOfferCap());
      expect(unmarkedOfferCap()).toBe(cap * (FIT_TUNABLES.OVERHEAD + Math.ceil(REFLECT_TUNABLES.LINE_BYTES * 1.5)));
    } finally {
      s.counterpart.close();
    }
  });

  test("at most UNMARKED a night", async () => {
    const cap = REFLECT_TUNABLES.UNMARKED;
    seed((put) => {
      for (let i = 0; i < cap + 5; i += 1) put(`Workshop note ${String(i)}: shelf ${String(i)} was relabelled.`, { origin: { scope: WORKSHOP } });
    });
    const n = await night("s-night-1");
    expect(n.offered).toHaveLength(cap);
    expect(counts(n.detail)["unmarkedOffered"]).toBe(cap);
  });
});

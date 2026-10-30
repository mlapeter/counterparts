/**
 * THE WAKE WITHOUT REPEATS (2026-10-20; Mike's go, lightly held, an
 * experiment — docs/decisions.d/fix-wake-dedupe-1020.md). From the 10-20
 * morning wakes: every Oct 19 episode was named twice (Yesterday, then "Last
 * here" / "+2 more here" / "About me, from another project"), a Yesterday
 * item with no room for its title printed as a bare id, and three tags opened
 * the wake. Also here: a plain reminder due tomorrow is not "due today" at a
 * session start, and a "Coming up" item carries its own id.
 *
 * Hermetic: every store is a temp dir made and removed here.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ONE_TAG, markerField, sessionTag, tagLead } from "../src/adapters/store-id.js";
import { Counterpart } from "../src/core/counterpart.js";
import { ELSEWHERE_HEAD } from "../src/core/handoff/last-here.js";
import { standsLadder } from "../src/core/handoff/stands.js";
import type { LastHere } from "../src/core/handoff/last-here.js";
import { CUE_MODE_META } from "../src/core/prospective/index.js";
import { FRAMING, HORIZON_OWN_ID, elementLine, readSentinel, withHeadFields } from "../src/core/self/index.js";
import type { Ranked, Resolve } from "../src/core/self/index.js";
import { readableDate } from "../src/core/time.js";

const HOUR = 3_600_000;
const BUDGET = 9_000;
const D0 = "2026-10-16";
const D1 = "2026-10-19";
const D2 = "2026-10-20";
const at = (ymd: string, h: number): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR;

const S1 = "a1b2c3d4-0000-4000-8000-000000000001";
const S2 = "a1b2c3d4-0000-4000-8000-000000000002";
const S3 = "a1b2c3d4-0000-4000-8000-000000000003";
const S4 = "a1b2c3d4-0000-4000-8000-000000000004";
const S5 = "a1b2c3d4-0000-4000-8000-000000000005";
const READER = "b5b6b7b8-0000-4000-8000-00000000000b";

let root: string;
let storeDir: string;
let HERE: string;
let THERE: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-dedupe-")));
  storeDir = join(root, "store");
  HERE = join(root, "garden");
  THERE = join(root, "site");
  for (const d of [HERE, THERE]) mkdirSync(d, { recursive: true });
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

function store(start: number): { c: Counterpart; set(t: number): void } {
  let now = start;
  const c = Counterpart.open({ dir: storeDir, budgetBytes: BUDGET, now: () => now, timeZone: "UTC" });
  open.push(c);
  return {
    c,
    set(t: number): void {
      now = t;
    },
  };
}

function episode(k: { c: Counterpart; set(t: number): void }, opts: { session: string; scope: string; title: string; date: string; hour: number; aboutMe?: boolean }): string {
  k.set(at(opts.date, opts.hour));
  const id = k.c.store.put({
    type: "episode",
    kind: "self",
    title: opts.title,
    body: `## chapter 1 — ${readableDate(opts.date)} · lived day 1\n\nWhat happened in ${opts.title}.\n`,
    meta: { sessionId: opts.session, chapters: 1 },
    source: "episode",
    origin: { session: opts.session, scope: opts.scope },
  });
  if (opts.aboutMe === true) {
    k.c.store.put({ type: "memory", kind: "self", body: `About me: ${opts.title}.`, source: "episode", origin: { session: opts.session, scope: opts.scope, ref: id }, about: "me" });
  }
  return id;
}

function wakeFor(c: Counterpart, scope: string): string {
  return c.wake(BUDGET, { date: D2 }, { scope, session: READER, exportsFrom: () => true }).text;
}

const count = (text: string, id: string): number => text.split(id).length - 1;
const lineStarting = (text: string, head: string): string | undefined => text.split("\n").find((l) => l.startsWith(head));

describe("each episode once", () => {
  test("yesterday's four (three here, one about me elsewhere): Last here names the newest here, Yesterday the rest, and nothing repeats", () => {
    const k = store(at(D1, 8));
    const visit = episode(k, { session: S1, scope: HERE, title: "The visit went great", date: D1, hour: 9 });
    const seo = episode(k, { session: S2, scope: THERE, title: "Planning the SEO push", date: D1, hour: 10, aboutMe: true });
    const averages = episode(k, { session: S3, scope: HERE, title: "The overnight averages", date: D1, hour: 12 });
    const bench = episode(k, { session: S4, scope: HERE, title: "The bench run that ran out", date: D1, hour: 15 });
    k.set(at(D2, 7));
    expect(k.c.rebrief({ budgetBytes: BUDGET, at: D2 }).published).toBe(true);
    const text = wakeFor(k.c, HERE);
    expect(readSentinel(text).intact).toBe(true);
    // Every one of them named, and named once.
    for (const id of [visit, seo, averages, bench]) expect(count(text, id)).toBe(1);
    // "Last here" names the newest written here; Yesterday the others, by title.
    expect(lineStarting(text, "Where this folder stands: ")).toContain(`(${bench})`);
    const yesterday = lineStarting(text, "Yesterday: ") ?? "";
    for (const title of ["The visit went great", "Planning the SEO push", "The overnight averages"]) expect(yesterday).toContain(title);
    expect(yesterday).not.toContain(bench);
    // So the block has no older entry to repeat them in, no line lists them by
    // bare id, and the about-me line leaves its chapter to Yesterday.
    expect(text).not.toMatch(/^Before that: /m);
    expect(text).not.toMatch(/^\+\d+ more here/m);
    expect(text).not.toContain(ELSEWHERE_HEAD);
    // No item is a bare id.
    expect(yesterday).not.toMatch(/(?:: |; )epi_[0-9a-f]+/);
  });

  test("an about-me chapter from an earlier day keeps its line, which says where and what it is", () => {
    const k = store(at(D0, 8));
    const away = episode(k, { session: S5, scope: THERE, title: "Who I am when I write the site", date: D0, hour: 9, aboutMe: true });
    episode(k, { session: S1, scope: HERE, title: "Potting on", date: D1, hour: 9 });
    k.set(at(D2, 7));
    k.c.rebrief({ budgetBytes: BUDGET, at: D2 });
    const text = wakeFor(k.c, HERE);
    const line = lineStarting(text, ELSEWHERE_HEAD) ?? "";
    expect(line).toStartWith(`${ELSEWHERE_HEAD} ${THERE.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~")}: session a1b2c3d4, Oct 16 — "Who I am when I write the site" (${away}).`);
    expect(count(text, away)).toBe(1);
  });

  test("the block leaves out what the body names, never the newest", () => {
    const mk = (id: string, title: string): LastHere => ({
      chapter: { id, session: `${id}-0000-4000-8000-000000000000`, model: null, title, excerpt: "", chapters: 1, writtenAt: 0, createdAt: 0, writtenDay: 1, scope: null },
      when: "Oct 19 09:00–10:00",
      date: "Oct 19",
    });
    // Since WK1 (2026-10-30) the line names the newest alone, never "+N more" by
    // bare id; a named one stays, because the line is what says when.
    const line = standsLadder({ handoffs: [], chapter: { entry: mk("epi_000000000001", "Newest"), at: 1 }, day: 1, named: () => true })[0]?.block ?? "";
    expect(line).toStartWith("Where this folder stands: ");
    expect(line).toContain("epi_000000000001");
    expect(line).not.toContain("more here");
  });
});

describe("one tag", () => {
  test("the head carries the fields, both byte counts re-solved; anything that is not a clean render, or not a field, is left alone", () => {
    const k = store(at(D1, 8));
    k.c.store.put({ type: "memory", kind: "fact", body: "The kiln is lit on Tuesdays." });
    k.set(at(D2, 7));
    k.c.rebrief({ budgetBytes: BUDGET, at: D2 });
    const bare = k.c.wake(BUDGET, { date: D2 }).text;
    const head = withHeadFields(bare, ["meet=done", "store=st_0123456789abcdef"]);
    expect(head.applied).toBe(true);
    expect(head.text.split("\n")[0]).toMatch(/^<!-- counterparts:wake meet=done store=st_0123456789abcdef elements=\d+ bytes=\d+ -->$/);
    expect(readSentinel(head.text).intact).toBe(true);
    expect(head.sentinel).toContain(`bytes=${String(head.bytes)}`);
    for (const bad of [["bytes=1"], ["meet=a b"], ["x=>"], []]) expect(withHeadFields(bare, bad).applied).toBe(false);
    expect(withHeadFields("No briefing has been composed yet.", ["meet=done"]).applied).toBe(false);
    // The delivery puts them in itself, inside the ceiling, and says so.
    const delivered = k.c.wake(BUDGET, { date: D2 }, { scope: HERE, session: READER, headFields: ["meet=done"] });
    expect(delivered.tagged).toBe(true);
    expect(delivered.text).toStartWith("<!-- counterparts:wake meet=done ");
    expect(delivered.bytes).toBeLessThanOrEqual(BUDGET);
    expect(readSentinel(delivered.text).intact).toBe(true);
  });

  test("at a full wake the fields never cost 'Last here' — the only line naming its episode (review of #536)", () => {
    // Put in before the furniture was spliced, the ~43 bytes took the room
    // "Last here" fitted into on some ceilings (8,700, 8,760 and 8,850 among
    // these), and the newest episode, left out of Yesterday for that line,
    // was in no line at all.
    for (let budget = 8_700; budget <= 8_850; budget += 30) {
      for (const c of open.splice(0)) c.close();
      rmSync(storeDir, { recursive: true, force: true });
      let now = at(D1, 8);
      const c = Counterpart.open({ dir: storeDir, budgetBytes: budget, now: () => now, timeZone: "UTC" });
      open.push(c);
      const k = { c, set: (t: number): void => void (now = t) };
      c.revisePage(`## Core\n\n${"I keep the garden's ledger and say what I do not know, and I say it plainly when asked. ".repeat(60)}\n\n## Lately\n\n${"The beans are in and the frost is coming. ".repeat(20)}`, { by: "owner", reason: "seed" });
      for (let i = 0; i < 80; i++) {
        c.store.put({ type: "memory", kind: "fact", body: `Open question ${String(i)}: whether bed ${String(i)} wants lime this autumn, given the pH reading and the rain we had in the last weeks of summer.`, meta: { unresolved: true }, salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 } });
      }
      for (let i = 0; i < 40; i++) {
        c.store.put({ type: "memory", kind: "self", body: `Who I am ${String(i)}: I keep careful notes and say when I am unsure about bed ${String(i)}.`, salience: { relevance: 1, emotional: 1, predictive: 1 } });
      }
      for (let i = 0; i < 6; i++) {
        c.store.put({ type: "memory", kind: "person", body: `Seed order ${String(i)} closes at noon; the list is in the green folder number ${String(i)}.`, learnedOn: "2026-10-11", eventDate: i < 2 ? D2 : `2026-10-2${String(i + 1)}`, salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 } });
      }
      episode(k, { session: S1, scope: HERE, title: "The visit went great", date: D1, hour: 9 });
      episode(k, { session: S2, scope: HERE, title: "The overnight averages", date: D1, hour: 12 });
      const newest = episode(k, { session: S3, scope: HERE, title: "The bench run that ran out", date: D1, hour: 15 });
      k.set(at(D2, 7));
      expect(c.rebrief({ budgetBytes: budget, at: D2 }).published).toBe(true);
      const bare = c.wake(budget, { date: D2 }, { scope: HERE, session: READER });
      const tagged = c.wake(budget, { date: D2 }, { scope: HERE, session: READER, headFields: ["meet=not_started", "store=st_0123456789abcdef"] });
      expect(tagged.bytes).toBeLessThanOrEqual(budget);
      expect(readSentinel(tagged.text).intact).toBe(true);
      if (bare.text.includes(newest)) expect(tagged.text).toContain(newest);
      expect(tagged.text.includes("Where this folder stands: ")).toBe(bare.text.includes("Where this folder stands: "));
    }
  });

  test("the markers' fields, and the session tag for a wake with no head", () => {
    expect(ONE_TAG).toBe(true);
    expect(markerField("<!-- counterparts:onboarding meet=not_started -->")).toBe("meet=not_started");
    expect(markerField("<!-- counterparts:store id=st_0123456789abcdef -->")).toBe("store=st_0123456789abcdef");
    expect(markerField("")).toBeNull();
    const tags = ["<!-- counterparts:onboarding meet=done -->", "<!-- counterparts:store id=st_0123456789abcdef -->"];
    expect(sessionTag(tags)).toBe("<!-- counterparts:session meet=done store=st_0123456789abcdef -->");
    expect(tagLead(tags, "anything", true)).toBe("");
    expect(tagLead(tags, "Counterparts: this session was resumed.", false)).toBe("<!-- counterparts:session meet=done store=st_0123456789abcdef -->\n");
    expect(tagLead(["", ""], "anything", false)).toBe("");
  });
});

describe("Coming up", () => {
  test("a plain reminder due tomorrow is counted at a session start, not listed; today's is listed whole with its own id", () => {
    const k = store(at(D1, 8));
    const today = k.c.store.put({ type: "memory", kind: "person", title: "Back up the store", body: "Back up the store to the drive.", eventDate: D2, salience: { relevance: 0.8, emotional: 0.5, predictive: 0.8 }, meta: { [CUE_MODE_META]: "plain" } });
    const tomorrow = k.c.store.put({ type: "memory", kind: "person", title: "Call the vet", body: "Call the vet about the dog's jab.", eventDate: "2026-10-21", salience: { relevance: 0.8, emotional: 0.5, predictive: 0.8 }, meta: { [CUE_MODE_META]: "plain" } });
    k.set(at(D2, 7));
    k.c.rebrief({ budgetBytes: BUDGET, at: D2 });
    const text = wakeFor(k.c, HERE);
    const lines = text.split("\n");
    const start = lines.indexOf(FRAMING.horizon);
    expect(start).toBeGreaterThan(-1);
    const lane: string[] = [];
    for (let i = start + 1; i < lines.length && lines[i] !== ""; i++) lane.push(lines[i] ?? "");
    const listed = lane.filter((l) => l.startsWith("- "));
    expect(listed.some((l) => l.includes("Back up the store to the drive.") && l.includes(`[${today}]`))).toBe(true);
    expect(listed.some((l) => l.includes("Call the vet"))).toBe(false);
    // Counted under the door that lists it, not by bare id (WK1, 2026-10-30).
    expect(lane).toContain('(1 more coming up; recall "still open" lists them)');
    expect(lane.join("\n")).not.toContain(tomorrow);
  });

  test("a whole item names its own id before the earlier occurrence's pointer", () => {
    expect(HORIZON_OWN_ID).toBe(true);
    const item = { id: "mem_00000000000a", lane: "horizon", kind: "fact", band: "episodic", strength: 1, protected: false, bornDay: 1, personScoped: false, lastRendered: -1, due: true } as unknown as Ranked;
    const resolve = (() => ({ statement: "Back up the store to the drive.", standing: { prefix: "", suffix: " (earlier: [mem_00000000000b])", note: "" } })) as unknown as Resolve;
    expect(elementLine(item, resolve)).toBe("- Back up the store to the drive. [mem_00000000000a] (earlier: [mem_00000000000b])");
    // Another lane's whole item is as it was.
    const open = { ...item, lane: "threads" } as unknown as Ranked;
    expect(elementLine(open, resolve)).toBe("- Back up the store to the drive. (earlier: [mem_00000000000b])");
  });
});

describe("at least once (review of #536)", () => {
  test("a full wake with no handoff here, swept across ceilings: when 'Last here' has no room, Yesterday names its episode, and every episode appears once", () => {
    let dropped = 0;
    let carried = 0;
    // Re-tuned at WK1 (2026-10-30): with "Might be relevant" off this wake tops
    // out near 8.1K, so the window where the line gives way moved down. It is
    // narrow (measured around 7,140), so the sweep is fine-grained.
    for (let budget = 7_060; budget <= 7_320; budget += 5) {
      for (const c of open.splice(0)) c.close();
      rmSync(storeDir, { recursive: true, force: true });
      let now = at(D1, 8);
      const c = Counterpart.open({ dir: storeDir, budgetBytes: budget, now: () => now, timeZone: "UTC" });
      open.push(c);
      const k = { c, set: (t: number): void => void (now = t) };
      c.revisePage(`## Core\n\n${"I keep the garden's ledger and say what I do not know, and I say it plainly when asked. ".repeat(60)}\n\n## Lately\n\n${"The beans are in and the frost is coming. ".repeat(20)}`, { by: "owner", reason: "seed" });
      for (let i = 0; i < 80; i++) {
        c.store.put({ type: "memory", kind: "fact", body: `Open question ${String(i)}: whether bed ${String(i)} wants lime this autumn, given the pH reading and the rain we had in the last weeks of summer.`, meta: { unresolved: true }, salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 } });
      }
      for (let i = 0; i < 40; i++) {
        c.store.put({ type: "memory", kind: "self", body: `Who I am ${String(i)}: I keep careful notes and say when I am unsure about bed ${String(i)}.`, salience: { relevance: 1, emotional: 1, predictive: 1 } });
      }
      for (let i = 0; i < 6; i++) {
        c.store.put({ type: "memory", kind: "person", body: `Seed order ${String(i)} closes at noon; the list is in the green folder number ${String(i)}.`, learnedOn: "2026-10-11", eventDate: i < 2 ? D2 : `2026-10-2${String(i + 1)}`, salience: { relevance: 0.9, emotional: 0.8, predictive: 0.8 } });
      }
      const first = episode(k, { session: S1, scope: HERE, title: "The visit went great", date: D1, hour: 9 });
      const second = episode(k, { session: S2, scope: HERE, title: "The overnight averages", date: D1, hour: 12 });
      const newest = episode(k, { session: S3, scope: HERE, title: "The bench run that ran out", date: D1, hour: 15 });
      k.set(at(D2, 7));
      expect(c.rebrief({ budgetBytes: budget, at: D2 }).published).toBe(true);
      const woke = c.wake(budget, { date: D2 }, { scope: HERE, session: READER, headFields: ["meet=done", "store=st_0123456789abcdef"] });
      expect(woke.bytes).toBeLessThanOrEqual(budget);
      expect(readSentinel(woke.text).intact).toBe(true);
      const yesterday = lineStarting(woke.text, "Yesterday: ") ?? "";
      if (woke.text.includes("Where this folder stands: ")) {
        carried += 1;
        expect(count(woke.text, newest)).toBe(1);
        expect(yesterday).not.toContain(newest);
      } else {
        dropped += 1;
        // Yesterday's: by title, or in its count when the title had no room —
        // never in no line, never a bare id.
        const named = count(woke.text, newest) === 1 && yesterday.includes(newest);
        const counted = count(woke.text, newest) === 0 && /; and \d+ more/.test(yesterday);
        expect(named || counted).toBe(true);
      }
      for (const id of [first, second]) expect(count(woke.text, id)).toBeLessThanOrEqual(1);
      expect(yesterday).not.toMatch(/(?:: |; )epi_[0-9a-f]+/);
    }
    // The sweep crosses the room where the line gives way.
    expect(dropped).toBeGreaterThan(0);
    expect(carried).toBeGreaterThan(0);
  }, 120_000);
});

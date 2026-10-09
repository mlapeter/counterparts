/**
 * The memories tab, round 4 (2026-09-28 — a try, judged when seen): the page
 * reads for someone who knows roughly what it is and none of the details.
 *
 *   M1 who "I" is: named once, in one place; "Mike's / mine"; "about myself";
 *   M2 one find box: typing finds, Enter asks, the answers take the list's place;
 *   M3 one feelings chart, shared by Home and Memories; no pinned word readout;
 *   M4 "How well I remember": the journal a fourth part, so the parts add up;
 *   M5 two rows of chips with hover hints; "showing: kept · put away · both";
 *      the kinds' fading words moved to Health;
 *   M6 rows at one brightness; "fading" only when it applies; journal titles;
 *      no tag for facts; twenty a page;
 *   M7 the card: chart, one sentence, why it mattered, the date once, the rest folded;
 *   M8 "+ Add a memory"; no header badge;
 *   M9 the count once, like Home; put-away versions grouped.
 *
 * Hermetic: a demo store seeded into a temp dir, removed after.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../src/core/counterpart.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { router } from "../src/adapters/dashboard/web/server.js";
import type { MemoryListView } from "../src/adapters/dashboard/web/views.js";
import { FIRM_AHEAD_DAYS, NEAR_LET_GO_DAYS } from "../src/adapters/dashboard/web/views/memories.js";
import { archiveWords } from "../src/adapters/dashboard/web/views/archive-words.js";
import { firstSentence, shownOf, stripChapterLead } from "../src/adapters/dashboard/web/views/memory-words.js";
import { seedDemo } from "../tools/demo/seed.js";

const WEB = fileURLToPath(new URL("../src/adapters/dashboard/web/", import.meta.url));
const HOST = "127.0.0.1:4747";
const read = (p: string): string => readFileSync(join(WEB, p), "utf8");

/** The browser modules touch `window` at load (`window.openMemory = …`); give them one. */
(globalThis as { window?: unknown }).window ??= globalThis;

let dir: string;
const ids = { head: "", fading: "", felt: [] as string[] };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-memories-r4-"));
  await seedDemo({ dir });
  const c = Counterpart.open({ dir, owner: true });
  try {
    const s = c.store;
    const day = s.livedDay();
    // One memory put away three times over: three older versions, one head.
    let id = s.put({ type: "memory", kind: "place", body: "The quiet room is past the linen cupboard.", source: "authored" });
    for (const b of ["The quiet room is past the linen cupboard, on the left.", "The quiet room moved past the lifts.", "The quiet room is past the lifts; the key is at the desk."]) {
      // Each version a millisecond apart, so "newest" is defined, not a random-id tie.
      for (const t = Date.now(); Date.now() <= t; );
      id = s.supersede(id, { type: "memory", kind: "place", body: b, source: "authored" });
    }
    ids.head = id;
    const people = s.list({ type: "memory", kind: "person", archived: false });
    ids.felt = people.slice(0, 3);
    s.addFeelings(people[0] as string, [{ whose: "owner", core: "happy", emotion: "proud", strength: 0.8 }]);
    s.addFeelings(people[1] as string, [{ whose: "self", core: "happy", emotion: "joyful", strength: 0.5 }, { whose: "owner", core: "uneasy", emotion: "anxious", strength: 0.4 }]);
    s.addFeelings(people[2] as string, [{ whose: "self", core: "sad", emotion: "lonely", strength: 0.4 }]);
    ids.fading = s.put({ type: "memory", kind: "fact", body: "A small thing nobody has needed in months.", salience: { relevance: 0.05, emotional: 0, predictive: 0 }, source: "authored" });
    s.updatePhysics(ids.fading, { birthDay: day - 400, lastUsedDay: day - 400 });
  } finally {
    c.close();
  }
}, 180_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function withSrc<T>(fn: (src: DashboardSource) => T): T {
  const dash = Dashboard.open({ dir });
  try {
    return fn(dash.source);
  } finally {
    dash.close();
  }
}

function get<T = Record<string, unknown>>(src: DashboardSource, path: string): T {
  const reply = router(new URL(`http://${HOST}${path}`), HOST, src);
  expect(reply.status).toBe(200);
  return JSON.parse(reply.body) as T;
}

interface MemoriesJson {
  total: number;
  newToday: number;
  owner: string | null;
  hold: { firm: number; settling: number; fading: number; journal: number };
  feelings: { owner: string | null; carrying: number; cores: { core: string }[] };
}

describe("M1 who is talking", () => {
  test("the name is kept in one place; the intro says it once, with the owner's name", async () => {
    const voice = read("shared/voice.js");
    expect(voice).toContain('export const MY_NAME = "Claude";');
    for (const f of ["pages/memories/index.js", "pages/memories/sections/tools.js", "pages/memories/sections/search.js", "shared/widgets/feel-radar.js"]) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(`${f}: ${/\bClaude\b/.test(code)}`).toBe(`${f}: false`);
    }
    const { intro, count } = (await import(join(WEB, "pages/memories/index.js"))) as {
      intro(o: string | null): string;
      count(d: { total: number; newToday: number }): string;
    };
    expect(intro("Mike")).toBe("I'm Claude. This is what I've kept from working with Mike.");
    expect(intro(null)).toBe("I'm Claude. This is what I've kept from working with you.");
    // M9: the count once, like Home's headline.
    expect(count({ total: 320, newToday: 23 })).toBe("320 memories · 23 new today");
    expect(count({ total: 1, newToday: 0 })).toBe("1 memory");
  });

  test("the chart's legend is the owner's name and mine; the kind is 'about myself'", async () => {
    const { ownersWord } = (await import(join(WEB, "shared/voice.js"))) as { ownersWord(o: string | null): string };
    expect(ownersWord("Mike")).toBe("Mike's");
    expect(ownersWord("James")).toBe("James'");
    expect(ownersWord(null)).toBe("yours");
    const { radarLegend } = (await import(join(WEB, "shared/widgets/feel-radar.js"))) as { radarLegend(o: string | null): string };
    expect(radarLegend("Mike")).toContain("Mike&#39;s</span>");
    expect(radarLegend("Mike")).toContain("mine</span>");
    const { kindOf } = (await import(join(WEB, "shared/memory-marks.js"))) as { kindOf(k: string): { label: string } };
    expect(kindOf("self").label).toBe("about myself");
    withSrc((src) => {
      const m = get<MemoriesJson>(src, "/api/memories");
      const o = get<{ feelings: MemoriesJson["feelings"]; hero: { memories: number; newToday: number } }>(src, "/api/overview");
      expect(m.owner).toBe(o.feelings.owner);
      expect(m.feelings.owner).toBe(m.owner);
      expect(typeof m.owner).toBe("string");
      // The top line's numbers are Home's.
      expect(m.total).toBe(o.hero.memories);
      expect(m.newToday).toBe(o.hero.newToday);
    });
  });
});

describe("M2 one find box", () => {
  test("one box and a by word / facts / by meaning switch; the answers go where the list is", async () => {
    const search = read("pages/memories/sections/search.js");
    expect(search).toContain(">Find a memory</label>");
    expect(search).not.toContain('id="ask-q"');
    expect(search).not.toContain("searched as");
    expect(search).toContain('e.key === "Enter"');
    expect(search).toContain('$("mlist").innerHTML');
    expect(search).toContain('id="q-x"');
    const mod = (await import(join(WEB, "pages/memories/sections/search.js"))) as {
      MODES: Record<string, { label: string; placeholder: string }>;
    };
    // The confidence tiers left recall with 0.3.12 (facts and meaning modes);
    // the page carries no word for them (2026-10-09).
    expect("TIER" in mod).toBe(false);
    expect(search).not.toContain("strong match");
    // 2026-09-30: a visible switch beside the one box; Enter never flips it.
    // 2026-10-09: a third way, as recall took a mode — facts, and meaning.
    expect(Object.keys(mod.MODES)).toEqual(["word", "facts", "meaning"]);
    expect(mod.MODES["word"]?.label).toBe("by word");
    expect(mod.MODES["facts"]?.label).toBe("facts");
    expect(mod.MODES["meaning"]?.label).toBe("by meaning");
    expect(search).toContain('id="q-mode"');
    expect(search).toContain('if (find.mode === "word") runSearch(); else ask(box.value.trim(), find.mode, 1);');
    expect(read("pages/memories/state.js")).toContain('mode: "word"');
    // The box sits with the list, under the charts, not above them.
    const list = read("pages/memories/sections/list.js");
    expect(list).toContain("${search.markup}");
    const page = read("pages/memories/index.js");
    expect(page).not.toContain("search.markup");
    expect(page.indexOf("hold.markup")).toBeLessThan(page.indexOf("list.markup"));
  });
});

describe("M3 one feelings chart", () => {
  test("both tabs draw the shared component; no pinned word readout; a short `?`", async () => {
    for (const f of ["pages/home/sections/feel.js", "pages/memories/sections/feel.js"]) {
      const s = read(f);
      expect(s).toContain('from "../../../shared/widgets/feel-radar.js"');
      expect(s).not.toContain("feel-detail");
      expect(s).not.toContain("data-word");
    }
    const { feelTip } = (await import(join(WEB, "shared/widgets/feel-radar.js"))) as { feelTip(o: string | null): string };
    const tip = feelTip("Mike");
    expect(tip.split(". ").length).toBeLessThanOrEqual(2);
    expect(tip).not.toMatch(/wheel|square root/i);
    expect(tip).toContain("Mike's");
  });

  test("the axis lit on Memories is the list's filter and nothing else", async () => {
    const { radarSvg } = (await import(join(WEB, "shared/widgets/feel-radar.js"))) as { radarSvg(f: unknown, picked: string | null): string };
    withSrc((src) => {
      const f = get<MemoriesJson>(src, "/api/memories").feelings;
      expect((radarSvg(f, null).match(/class="feel-axis on/g) ?? []).length).toBe(0);
      expect((radarSvg(f, "happy").match(/class="feel-axis on/g) ?? []).length).toBe(1);
      // Wheel v2 (2026-09-30): seven axes, each called by its stored core.
      const svg = radarSvg(f, "warm");
      expect(svg).toContain('data-core="warm"');
      expect(svg).toContain(">warm</text>");
      expect((svg.match(/class="feel-axis/g) ?? []).length).toBe(7);
      expect(svg).not.toMatch(/>dislike</);
    });
    expect(read("pages/memories/sections/feel.js")).toContain("radarHtml(data, filters.feelingCore)");
  });

  test("M1: a memory shows its own feeling word; a bare core falls back to its display name", async () => {
    const { feelingName, feelingWord, feelingDots } = (await import(join(WEB, "shared/memory-marks.js"))) as {
      feelingName(c: string): string; feelingWord(f: unknown): string; feelingDots(f: unknown[], w?: boolean): string;
    };
    // Since the wheel v2 a core is called by its own name ("disgust" read "dislike" before).
    expect(feelingName("uneasy")).toBe("uneasy");
    expect(feelingName("sad")).toBe("sad");
    expect(feelingWord({ core: "sad", word: "disappointed" })).toBe("disappointed");
    expect(feelingWord({ core: "uneasy", word: "uneasy" })).toBe("uneasy");
    expect(feelingWord({ core: "uneasy", word: "" })).toBe("uneasy");
    const dots = feelingDots([{ core: "sad", word: "disappointed" }, { core: "happy", word: "proud" }, { core: "uneasy", word: "uneasy" }], true);
    expect(dots).toContain('title="felt: disappointed, proud, uneasy"');
    expect(dots).toContain('<span class="fwords">disappointed, proud +1</span>');
    expect(feelingDots([{ core: "warm", word: "warm" }])).toContain("#ff79c6");
  });
});

describe("M4 how well I remember", () => {
  test("four parts that add up to the count at the top; two plain sentences behind the `?`", async () => {
    withSrc((src) => {
      const m = get<MemoriesJson>(src, "/api/memories");
      expect(m.hold.firm + m.hold.settling + m.hold.fading + m.hold.journal).toBe(m.total);
      expect(m.hold.journal).toBeGreaterThan(0);
    });
    const hold = read("pages/memories/sections/hold.js");
    expect(hold).toContain(">How well I remember<");
    expect(hold).toContain('data-hold="journal"');
    const { HOLD_TIP, PARTS, NONE_FADING } = (await import(join(WEB, "pages/memories/sections/hold.js"))) as {
      HOLD_TIP: string; PARTS: [string, string, string][]; NONE_FADING: string;
    };
    expect(HOLD_TIP).toBe("Firm: I'll still know it a month from now even if it's never used. " +
      "Fading: unless it's used, I may put it away within my next two weeks of use.");
    // Each sentence says what `holdOf` measures: firm is 30 lived days ahead, fading is prune within 14.
    expect(FIRM_AHEAD_DAYS).toBe(30);
    expect(NEAR_LET_GO_DAYS).toBe(14);
    expect(PARTS.map((p) => p[0])).toEqual(["firm", "settling", "fading"]);
    expect(PARTS[0]?.[2]).toContain("a month from now");
    expect(PARTS[2]?.[2]).toContain("two weeks of use");
    expect(NONE_FADING).toBe("None right now; nothing is about to be put away.");
  });

  test("one square per memory while it fits; past that a square is 2, 5, 10, 20 … memories, and no state vanishes", async () => {
    const { waffleScale, scaleSteps, scaleWords } = (await import(join(WEB, "pages/memories/sections/hold.js"))) as {
      waffleScale(c: Record<string, number>, cap: number): { per: number; squares: { firm: number; settling: number; fading: number } };
      scaleSteps(max: number): number[];
      scaleWords(per: number): string;
    };
    expect(scaleSteps(2000).slice(0, 11)).toEqual([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]);
    const mike = { firm: 87, settling: 277, fading: 0 };
    expect(waffleScale(mike, 600)).toEqual({ per: 1, squares: { firm: 87, settling: 277, fading: 0 } });
    expect(waffleScale(mike, 300)).toEqual({ per: 2, squares: { firm: 44, settling: 139, fading: 0 } });
    const big = { firm: 700, settling: 1290, fading: 3 };
    const s = waffleScale(big, 400);
    expect(s.per).toBe(5);
    expect(s.squares).toEqual({ firm: 140, settling: 258, fading: 1 });
    expect(s.squares.firm + s.squares.settling + s.squares.fading).toBeLessThanOrEqual(400);
    expect(scaleWords(1)).toBe("");
    expect(scaleWords(5)).toBe("each square is 5 memories");
  });
});

describe("M5 filters", () => {
  test("kinds with journal and core, then the seven feelings with counts; every chip has a hint; no kinds `?`", async () => {
    const { KIND_HINT, SHOWING, PAGE } = (await import(join(WEB, "pages/memories/sections/list.js"))) as {
      KIND_HINT: Record<string, string>;
      SHOWING: [string, string, string][];
      PAGE: number;
    };
    for (const k of ["self", "person", "entity", "skill", "place", "fact"]) {
      const words = (KIND_HINT[k] ?? "").split(" ").length;
      expect(`${k}: ${words >= 3 && words <= 6}`).toBe(`${k}: true`);
    }
    expect(SHOWING.map(([v, w]) => [v, w])).toEqual([["live", "kept"], ["archived", "put away"], ["all", "both"]]);
    expect(PAGE).toBe(20);
    const list = read("pages/memories/sections/list.js");
    expect(list).not.toContain('q("kinds"');
    expect(list).toContain("showing:");
    withSrc((src) => {
      const d = get<MemoryListView>(src, "/api/memories/list");
      expect(Object.keys(d.counts.feelings)).toEqual(["happy", "warm", "calm", "curious", "sad", "uneasy", "angry"]);
      expect(d.counts.feelings["happy"]).toBe(2);
      expect(d.counts.feelings["uneasy"]).toBe(1);
      // A chip's count is what its filter shows.
      for (const core of ["happy", "sad", "uneasy"]) {
        expect(get<MemoryListView>(src, `/api/memories/list?feelingCore=${core}&limit=200`).total).toBe(d.counts.feelings[core]!);
      }
      expect(get<MemoryListView>(src, "/api/memories/list?feelingCore=happy").rows.map((r) => r.id).sort()).toEqual(ids.felt.slice(0, 2).sort());
      expect(d.limit).toBe(50); // the server's default is unchanged; the page asks for twenty
    });
  });

  test("the kinds' fading and correcting words are on Health now", async () => {
    const { markup, KINDS_LINE } = (await import(join(WEB, "pages/health/sections/mechanisms.js"))) as { markup: string; KINDS_LINE: string };
    expect(markup).toContain(KINDS_LINE);
    expect(KINDS_LINE).toMatch(/facts fade fastest/i);
    expect(KINDS_LINE).toMatch(/skills slowest/i);
  });
});

describe("M6 rows", () => {
  test("one brightness, no meter; 'fading' only when it applies; no tag for a fact; journal titled by its day", async () => {
    const { memRow, journalTitle } = (await import(join(WEB, "pages/memories/row.js"))) as {
      memRow(r: Record<string, unknown>, o?: Record<string, unknown>): string;
      journalTitle(d: string | null): string;
    };
    const base = { id: "mem_1", title: null, text: "A plain fact.", confidential: false, kind: "fact", date: "2026-09-27", dateFrom: "recorded",
      core: false, protected: false, journal: false, feelings: [], archived: null, hold: "settling", versions: 1, schemaRole: null };
    const plain = memRow(base);
    expect(plain).not.toMatch(/lit-\d|smeter/);
    expect(plain).not.toContain("mkind");
    expect(plain).not.toContain("fading");
    expect(memRow({ ...base, hold: "fading" })).toContain('class="mfading"');
    // A date that still repeats (2026-10-09): never "fading", and it says how often instead.
    const repeat = memRow({ ...base, repeats: "every May 14" });
    expect(repeat).toContain('<span class="mrepeats" title="it comes round every May 14, so I&#39;ll keep it while it does">repeats every May 14</span>');
    expect(repeat).not.toContain("fading");
    expect(plain).not.toContain("mrepeats");
    expect(memRow({ ...base, kind: "person" })).toContain("people");
    expect(journalTitle("2026-09-27")).toMatch(/^Journal · Sun, Sep 27th(, 2026)?$/);
    expect(journalTitle(null)).toBe("Journal");
    const j = memRow({ ...base, kind: "self", journal: true, text: "Mike came back to the castle game." });
    expect(j).toContain("Journal · Sun, Sep 27th");
    expect(j).not.toContain("mkind");
    // M5 (2026-09-30): a search's words are marked in the title and the words, escaped first.
    const found = memRow({ ...base, title: "The castle <game>", text: "A castle & a moat; castles differ. CASTLE." }, { mark: ["castle"] });
    expect(found).toContain('<div class="mtitle">The <mark>castle</mark> &lt;game&gt;</div>');
    expect(found).toContain("A <mark>castle</mark> &amp; a moat; castles differ. <mark>CASTLE</mark>.");
    expect(memRow({ ...base, text: "<b>amp</b>" }, { mark: ["amp", "b"] })).toContain("&lt;<mark>b</mark>&gt;<mark>amp</mark>&lt;/<mark>b</mark>&gt;");
    expect(memRow({ ...base, confidential: true, text: "withheld" }, { mark: ["withheld"] })).not.toContain("<mark>");
    const { searchWords } = (await import(join(WEB, "pages/memories/row.js"))) as { searchWords(q: string): string[] };
    expect(searchWords("The castle-game, a 2nd try")).toEqual(["the", "castle", "game", "2nd", "try"]);
    const { questionWords, findHead } = (await import(join(WEB, "pages/memories/sections/search.js"))) as {
      questionWords(q: string): string[]; findHead(s: number, t: number, c: number): string;
    };
    // M4: the close matches are counted apart from the exact ones.
    expect(findHead(0, 0, 3)).toBe("no exact match · 3 close matches");
    expect(findHead(2, 2, 1)).toBe("2 matches · 1 close match");
    expect(findHead(25, 40, 0)).toBe("the closest 25 of 40 matches");
    expect(questionWords("What do you remember about the castle game?")).toEqual(["castle", "game"]);
    // M6 (2026-09-30): the row's own date, said again in its words, is left out of the row only.
    const { withoutRowDate } = (await import(join(WEB, "pages/memories/row.js"))) as {
      withoutRowDate(t: string | null, x: string, d: string | null): { title: string | null; text: string };
    };
    const same = withoutRowDate("Working as second opinion to a Fable session (2026-09-30)",
      "On 2026-09-30 Mike ran two sessions on the morning's problems.", "2026-09-30");
    expect(same).toEqual({ title: "Working as second opinion to a Fable session", text: "Mike ran two sessions on the morning's problems." });
    expect(withoutRowDate(null, "2026-09-30: the build passed.", "2026-09-30").text).toBe("The build passed.");
    expect(withoutRowDate("Title [2026-09-30]", "x", "2026-09-30").title).toBe("Title");
    // A different date stays; so does a date in the middle, and anything with no row date.
    expect(withoutRowDate("An older date stays (2026-06-12)", "On 2026-06-12 it began.", "2026-09-30"))
      .toEqual({ title: "An older date stays (2026-06-12)", text: "On 2026-06-12 it began." });
    expect(withoutRowDate("Seen (2026-09-30) twice", "Late on 2026-09-30 it ran.", "2026-09-30"))
      .toEqual({ title: "Seen (2026-09-30) twice", text: "Late on 2026-09-30 it ran." });
    expect(withoutRowDate("T (2026-09-30)", "On 2026-09-30 x", null)).toEqual({ title: "T (2026-09-30)", text: "On 2026-09-30 x" });
    const dated = memRow({ ...base, date: "2026-09-30", title: "A session (2026-09-30)", text: "On 2026-09-30 Mike ran two." });
    expect(dated).toContain('<div class="mtitle">A session</div>');
    expect(dated).toContain('<div class="mtext">Mike ran two.</div>');
    const away = memRow({ ...base, archived: "replaced by a newer version", versions: 3 });
    expect(away).toContain("put away: replaced by a newer version · 3 versions");
  });

  test("a journal chapter's bare heading (date · model · lived day) is lifted off; its row is the first sentence", () => {
    const bare = stripChapterLead("Sun 27 Sep 2026 · claude-opus-5-5 · lived day 6 Mike wanted a lighter session. Then more.");
    expect(bare).toEqual({ rest: "Mike wanted a lighter session. Then more.", date: "2026-09-27" });
    expect(stripChapterLead("Nothing to lift here.")).toEqual({ rest: "Nothing to lift here.", date: null });
    const shown = shownOf("Sun 27 Sep 2026 · claude-opus-5-5 · lived day 6\nMike wanted a lighter session.", { chapter: true, learnedOn: "2026-09-28", confidential: false });
    expect(shown.text).toBe("Mike wanted a lighter session.");
    expect(shown.date).toBe("2026-09-27");
    expect(firstSentence("Mike wanted a lighter session. Then he asked how I was.")).toBe("Mike wanted a lighter session.");
    expect(firstSentence("no end here")).toBe("no end here");
    withSrc((src) => {
      const rows = get<MemoryListView>(src, "/api/memories/list?journal=1&limit=200").rows;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.text).not.toMatch(/lived day \d+/);
        expect(r.text).not.toMatch(/claude-[a-z0-9-]+/);
      }
    });
  });

  test("the fading row carries its hold", () => {
    withSrc((src) => {
      const rows = get<MemoryListView>(src, "/api/memories/list?hold=fading&limit=200").rows;
      expect(rows.map((r) => r.id)).toContain(ids.fading);
      expect(rows.every((r) => r.hold === "fading")).toBe(true);
    });
  });
});

describe("M7 the card", () => {
  test("chart, one plain sentence, why it mattered, written once; the rest under details", async () => {
    const { memoryCard, rememberLine } = (await import(join(WEB, "shared/memory-modal.js"))) as {
      memoryCard(d: unknown): string;
      rememberLine(now: number, c: { archiveDay: number | null; archiveLine: number; to: number; day: number; repeats?: string | null }): string;
    };
    expect(rememberLine(0.41, { archiveDay: 67, archiveLine: 0.1, to: 90, day: 30 })).toBe("I remember this at 41%. If nobody uses it, I'll put it away around day 67.");
    expect(rememberLine(0.85, { archiveDay: null, archiveLine: 0.1, to: 90, day: 30 })).toBe("I remember this at 85%. Even if nobody uses it, I'll keep it for at least the next 60 days.");
    expect(rememberLine(0.05, { archiveDay: null, archiveLine: 0.1, to: 90, day: 30 })).toContain("low enough that I could put it away soon");
    // A date that still repeats is kept however faint (2026-10-09): no let-go day, and not "soon".
    expect(rememberLine(0.01, { archiveDay: null, archiveLine: 0.1, to: 90, day: 30, repeats: "every May 14" })).toBe(
      "I remember this at 1%. It comes round every May 14, so I'll keep it while it does.",
    );
    withSrc((src) => {
      const d = get(src, `/api/memory?id=${ids.felt[0]}`);
      const html = memoryCard(d);
      const fold = html.indexOf('<details class="mc-details">');
      expect(fold).toBeGreaterThan(0);
      for (const top of ["How well I remember", "Why it mattered", "Written "]) {
        const at = html.indexOf(top);
        expect(`${top}: ${at > 0 && at < fold}`).toBe(`${top}: true`);
      }
      for (const folded of [">Standing<", "mc-chip", ">The record<"]) {
        expect(`${folded}: ${html.indexOf(folded) > fold}`).toBe(`${folded}: true`);
      }
      expect((html.match(/Written /g) ?? []).length).toBe(1);
      expect(html).not.toContain("let-go line");
      expect(html.slice(0, fold)).not.toContain("lived day");
      expect(html).toContain("copy id");
      expect(html).toContain("remove…");
    });
    // One card for every page: nothing else draws its own.
    for (const f of ["pages/home/sections/today.js", "pages/self/index.js", "pages/memories/row.js"]) {
      expect(read(f)).not.toContain("function memoryCard");
    }
  });
});

describe("M8 buttons and header", () => {
  test("'+ Add a memory', a placeholder in my name, no hint about the console; no header badge", () => {
    const tools = read("pages/memories/sections/tools.js");
    expect(tools).toContain(">+ Add a memory</button>");
    expect(tools).toContain('placeholder="something for ${MY_NAME} to remember"');
    expect(tools).toContain(">Remember</button>");
    expect(tools).not.toContain("np-hint");
    for (const b of ["backup-open", "export-open"]) expect(tools).toContain(`id="${b}"`);
    expect(read("app.html")).not.toContain("Reading here changes nothing");
  });
});

describe("M9 repeats", () => {
  test("the list heading is just 'Every memory'; the range is said by the pager; no 'click … below' hints", async () => {
    const list = read("pages/memories/sections/list.js");
    expect(list).toContain('<h2 id="mlist-h">Every memory</h2>');
    expect(list).not.toContain("mlist-sub");
    const { rangeWords } = (await import(join(WEB, "pages/memories/sections/list.js"))) as { rangeWords(o: number, s: number, t: number): string };
    expect(rangeWords(0, 20, 320)).toBe("1–20 of 320");
    for (const f of ["pages/memories/sections/hold.js", "pages/memories/sections/feel.js", "shared/widgets/feel-radar.js", "pages/memories/sections/list.js"]) {
      expect(`${f}: ${/click[^"]*below/i.test(read(f))}`).toBe(`${f}: false`);
    }
  });

  test("put-away versions of one memory are one row, with how many; the words say 'replaced by a newer version'", () => {
    expect(archiveWords("episode-regrown", false)).toBe("replaced by a newer version");
    withSrc((src) => {
      const d = get<MemoryListView>(src, "/api/memories/list?state=archived&limit=200");
      const grouped = d.rows.filter((r) => r.versions > 1);
      expect(grouped.length).toBe(1);
      expect(grouped[0]!.versions).toBe(3);
      expect(grouped[0]!.text).toContain("moved past the lifts"); // the newest put-away version stands for them
      // The pager pages over rows as shown; the chip still counts every put-away row.
      expect(d.total).toBe(d.counts.archived - 2);
      expect(get<MemoryListView>(src, "/api/memories/list?state=live&limit=200").rows.some((r) => r.id === ids.head)).toBe(true);
    });
  });
});

describe("looking still writes nothing", () => {
  test("the new reads leave the store byte-identical", () => {
    const snapshot = (at: string): Map<string, string> => {
      const out = new Map<string, string>();
      const walk = (d: string): void => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          const full = join(d, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) out.set(relative(at, full), createHash("sha256").update(readFileSync(full)).digest("hex"));
        }
      };
      walk(at);
      return out;
    };
    withSrc((src) => {
      const before = snapshot(dir);
      get(src, "/api/memories");
      get(src, "/api/memories/list?state=all&feelingCore=happy");
      get(src, "/api/memories/list?state=archived");
      expect(snapshot(dir)).toEqual(before);
    });
  });
});

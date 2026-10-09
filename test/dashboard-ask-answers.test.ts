/**
 * Ask, on the memories page, draws what `counterparts ask --json` really
 * returns (2026-10-09).
 *
 * 0.3.12 gave recall a required mode (#323: facts, every match counted and
 * paged; meaning, an arc across chapters), and the page kept reading the old
 * answer's shape — a confidence tier, a "from chapter" link, a date at the
 * front of the words — so the match words, the links and most dates quietly
 * vanished, and "by meaning" got a facts answer. Its tests were fed answers
 * written by hand in the old shape, so nothing failed.
 *
 * So no answer here is written by hand. A demo store is seeded into a temp
 * dir, the states it does not reach are written through the store's own API,
 * and every answer comes through the dashboard's own action
 * (`runAction("ask", …)`: the console's `ask --json --mode`, the call the
 * browser makes). The page's own pure functions
 * (`pages/memories/sections/search.js`) draw it, and each assertion reads the
 * field it checks off the TYPED answer (`FactsResult`, `MeaningResult`) — so a
 * field renamed there fails to compile here before it can vanish from the page.
 *
 * And the rows: a memory id written in a memory's words is a link to that
 * memory, not its digits (the list's real rows, through `/api/memories/list`).
 *
 * Hermetic: the temp store is removed after.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../src/core/counterpart.js";
import { settle } from "../src/core/contradictions.js";
import { ownerNames } from "../src/core/sleep/index.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import { runAction } from "../src/adapters/dashboard/web/actions.js";
import { router } from "../src/adapters/dashboard/web/server.js";
import type { MemoryListView } from "../src/adapters/dashboard/web/views.js";
import { FACTS_PAGE_SIZE } from "../src/adapters/mcp/facts.js";
import type { FactItem, FactsResult } from "../src/adapters/mcp/facts.js";
import type { MeaningEntry, MeaningResult } from "../src/adapters/mcp/meaning.js";
import { seedDemo } from "../tools/demo/seed.js";

const WEB = fileURLToPath(new URL("../src/adapters/dashboard/web/", import.meta.url));
const HOST = "127.0.0.1:4747";

/** The browser modules touch `window` at load (`window.openMemory = …`); give them one. */
(globalThis as { window?: unknown }).window ??= globalThis;

interface Page {
  MODES: Record<string, { label: string }>;
  FACTS_PAGE: number;
  SAID: Record<string, string>;
  factsHead(r: FactsResult): string;
  factsRows(r: FactsResult, q: string): string;
  factRow(m: FactItem, words: string[]): string;
  timeWords(t: FactsResult["time"]): string;
  meaningHead(r: MeaningResult): string;
  meaningRows(r: MeaningResult): string;
  askPager(r: FactsResult | MeaningResult): string;
}
let page: Page;
let dates: { dateOr(v: string | null, o?: Record<string, unknown>): string };
let rows: { memRow(r: Record<string, unknown>, o?: Record<string, unknown>): string; journalTitle(d: string | null): string };
let marks: { withIdMarks(text: string, quiet?: boolean): string };

let dir: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  page = (await import(join(WEB, "pages/memories/sections/search.js"))) as Page;
  dates = (await import(join(WEB, "shared/dates.js"))) as typeof dates;
  rows = (await import(join(WEB, "pages/memories/row.js"))) as typeof rows;
  marks = (await import(join(WEB, "shared/memory-marks.js"))) as typeof marks;
  dir = mkdtempSync(join(tmpdir(), "counterparts-ask-answers-"));
  await seedDemo({ dir });
  const c = Counterpart.open({ dir, owner: true });
  try {
    const s = c.store;
    // Who said it, its status, and when it happened (v12's three fields).
    ids.said = s.put({ type: "memory", kind: "fact", body: "The zqrota review moved to Thursday mornings.", saidBy: "owner", status: "done", occurredOn: "2026-06-04" });
    // A fact that changed: the old one folds under the new.
    ids.old = s.put({ type: "memory", kind: "fact", title: "Gym at 7", body: "The zqswim session is at 7am." });
    ids.now = s.put({ type: "memory", kind: "fact", title: "Gym moved", body: "The zqswim session moved to 6am." });
    expect(settle(s, { holds: ids.now, over: ids.old, how: "changed", why: "the time changed", actor: "session" }).ok).toBe(true);
    // A wrong one, corrected: hidden, and counted.
    ids.wrong = s.put({ type: "memory", kind: "fact", body: "The zqboat is moored at pier 4." });
    ids.right = s.put({ type: "memory", kind: "fact", body: "The zqboat is moored at pier 9." });
    expect(settle(s, { holds: ids.right, over: ids.wrong, how: "corrected", why: "it was pier 9", actor: "session" }).ok).toBe(true);
    // Two that disagree, left open.
    ids.eight = s.put({ type: "memory", kind: "fact", body: "The zqcafe opens at eight." });
    ids.nine = s.put({ type: "memory", kind: "fact", body: "The zqcafe opens at nine." });
    expect(settle(s, { holds: ids.eight, over: ids.nine, how: "open", why: "unsure", actor: "session" }).ok).toBe(true);
    // Ids written in the words: a memory's, and a chapter's address.
    const episode = s.list({ type: "episode", archived: false })[0] as string;
    ids.episode = episode;
    ids.cites = s.put({ type: "memory", kind: "fact", body: `The zqmerge note folds (${ids.said}) and ${ids.now} together; see ${episode}#2.` });
  } finally {
    c.close();
  }
}, 180_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** One ask through the dashboard's own action: the console's `ask --json`. */
async function ask<T>(body: Record<string, unknown>): Promise<{ answer: T; command: string }> {
  const r = await runAction("ask", { json: true, ...body }, { dir });
  expect(r.status).toBe(200);
  expect(r.body.exit).toBe(0);
  return { answer: JSON.parse((r.body.out ?? []).join("\n")) as T, command: r.body.command ?? "" };
}

/** What a reader sees: the markup's words, with no tag or attribute. */
const seen = (html: string): string =>
  html.replace(/<[^>]*>/g, "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("facts: every match, counted and paged", () => {
  test("the head counts every match; the pager says where this page is and asks the same question for the next", async () => {
    expect(page.FACTS_PAGE).toBe(FACTS_PAGE_SIZE);
    const q = "halfmoon rota";
    const { answer: one, command } = await ask<FactsResult>({ question: q, mode: "facts" });
    expect(command).not.toContain("--mode");
    expect(one.mode).toBe("facts");
    expect(one.pages).toBeGreaterThan(1);
    expect(page.factsHead(one)).toStartWith(`${one.matched} memories answer it, best first`);
    if (one.subjects.length > 0) expect(seen(page.factsHead(one))).toContain(`about ${one.subjects.map((x) => x.name).join(", ")}`);
    const pager = page.askPager(one);
    expect(seen(pager)).toContain(`1–${one.memories.length} of ${one.matched}`);
    expect(seen(pager)).toContain(`page 1 of ${one.pages}`);
    expect(pager).toContain('data-ask-page="2"');
    const drawn = page.factsRows(one, q);
    for (const m of one.memories) expect(drawn).toContain(`data-id="${m.id}"`);
    // The confidence tiers and the "from chapter" link left with 0.3.12.
    expect(drawn).not.toContain("mtier");
    expect(drawn).not.toContain("strong match");
    expect(drawn).not.toContain("from chapter");

    const { answer: two } = await ask<FactsResult>({ question: q, mode: "facts", page: 2 });
    expect(two.page).toBe(2);
    expect(seen(page.askPager(two))).toContain(`${FACTS_PAGE_SIZE + 1}–`);
    expect(two.memories.map((m) => m.id).some((id) => one.memories.some((m) => m.id === id))).toBe(false);
  });

  test("who said it, its status, when it happened and when it was learned", async () => {
    const { answer } = await ask<FactsResult>({ question: "zqrota review", mode: "facts" });
    const m = answer.memories.find((x) => x.id === ids.said) as FactItem;
    expect(m.saidBy).toBe("owner");
    expect(m.status).toBe("done");
    expect(m.occurredOn).toBe("2026-06-04");
    const row = page.factRow(m, []);
    expect(seen(row)).toContain(`${page.SAID.owner} · done`);
    expect(page.SAID.owner).toBe("you said");
    // The right-hand date is when it happened; when it was learned is said under the words.
    expect(row).toContain(`title="the day it happened">${dates.dateOr(m.occurredOn)}<`);
    expect(m.learned).not.toBe(m.occurredOn);
    expect(seen(row)).toContain(`learned ${dates.dateOr(m.learned)}`);
    // A fact with none of the three says none of them, and is dated by when it was learned.
    const bare = answer.memories.find((x) => x.saidBy === null && !x.journal && x.occurredOn === null);
    if (bare !== undefined) {
      const plain = page.factRow(bare, []);
      expect(plain).not.toContain("speaker unknown");
      expect(plain).toContain(`title="the day I learned it">${dates.dateOr(bare.learned)}<`);
    }
  });

  test("current, and what it was before: an earlier version folds under it; a corrected one is counted; a disagreement links", async () => {
    const swim = (await ask<FactsResult>({ question: "zqswim", mode: "facts" })).answer;
    const now = swim.memories[0] as FactItem;
    expect(now.id).toBe(ids.now as string);
    expect(now.current).toBe(true);
    const earlier = now.earlier[0];
    expect(earlier?.id).toBe(ids.old as string);
    const row = page.factRow(now, []);
    expect(seen(row)).toContain(`earlier: “${earlier?.text ?? ""}”`);
    expect(seen(row)).toContain(`changed ${dates.dateOr(earlier?.changed ?? null)}`);
    expect(row).toContain(`data-open="${ids.old}"`);

    const boat = (await ask<FactsResult>({ question: "zqboat pier", mode: "facts" })).answer;
    const right = boat.memories.find((x) => x.id === ids.right) as FactItem;
    expect(right.corrected).toBe(1);
    expect(seen(page.factRow(right, []))).toContain("1 corrected version hidden");
    expect(boat.memories.map((x) => x.id)).not.toContain(ids.wrong);

    const cafe = (await ask<FactsResult>({ question: "zqcafe", mode: "facts" })).answer;
    const open = cafe.memories.find((x) => x.standing.length > 0) as FactItem;
    expect(open.standing.join(" ")).toContain("disagrees with");
    const other = open.id === ids.eight ? ids.nine : ids.eight;
    const drawn = page.factRow(open, []);
    expect(seen(drawn)).toContain("disagrees with memory ↗");
    expect(drawn).toContain(`data-open="${other}"`);
    // The id is a link, not digits on the page.
    expect(seen(drawn)).not.toContain(other as string);
  });

  test("a journal chapter is titled by its day, without its heading at the front of its words", async () => {
    const { answer } = await ask<FactsResult>({ question: "what happened in early June", mode: "facts" });
    expect(answer.time).not.toBeNull();
    const words = page.timeWords(answer.time);
    expect(words).toContain(answer.time?.cue ?? "?");
    expect(words).toContain(dates.dateOr(answer.time?.said?.from ?? null));
    expect(seen(page.factsHead(answer))).toContain(words);
    const chapter = answer.memories.find((x) => x.journal) as FactItem;
    expect(chapter.body).toMatch(/^chapter \d+/);
    const row = page.factRow(chapter, []);
    expect(seen(row)).toContain(rows.journalTitle(chapter.learned));
    expect(seen(row)).not.toMatch(/chapter \d+ — /);
    expect(seen(row)).not.toContain("lived day");
  });

  test("a cutoff reads as one: \"before\" is through the day before, \"after\" from the day after on (2026-10-09)", async () => {
    const before = (await ask<FactsResult>({ question: "zqrota before 2026-06-05", mode: "facts" })).answer;
    expect(before.time?.cue).toBe("before 2026-06-05");
    expect(before.memories.map((x) => x.id)).toContain(ids.said as string);
    const words = page.timeWords(before.time);
    expect(words).toContain(`through ${dates.dateOr("2026-06-04")}`);
    expect(words).not.toContain("0001");
    const after = (await ask<FactsResult>({ question: "zqrota after 2026-06-04", mode: "facts" })).answer;
    expect(after.memories.map((x) => x.id)).not.toContain(ids.said as string);
    expect(page.timeWords(after.time)).toContain(`${dates.dateOr("2026-06-05")} onward`);
    expect(page.timeWords(after.time)).not.toContain("9999");
  });

  test("nothing answers: said so, with what to try", async () => {
    const { answer } = await ask<FactsResult>({ question: "zqnothingholdsthis", mode: "facts" });
    expect(answer.matched).toBe(0);
    expect(page.factsHead(answer)).toStartWith("nothing answers it");
    expect(seen(page.factsRows(answer, "zqnothingholdsthis"))).toContain("Nothing I hold answers that");
    expect(page.askPager(answer)).toBe("");
  });
});

describe("by meaning: the switch asks in meaning mode, and the arc is drawn", () => {
  test("a card's arc: chapters in time order open their journal, their moments are links, a session's moments open nothing", async () => {
    expect(Object.keys(page.MODES)).toEqual(["word", "facts", "meaning"]);
    const { answer, command } = await ask<MeaningResult>({ question: "what has Halfmoon been to me", mode: "meaning" });
    expect(command).toContain("--mode meaning");
    expect(answer.mode).toBe("meaning");
    expect(answer.lens?.kind).toBe("card");
    const head = seen(page.meaningHead(answer));
    expect(head).toStartWith(`${answer.lens?.name ?? "?"} · ${answer.counts.chapters} chapters`);
    for (const n of answer.notes) expect(head).toContain(n);
    const drawn = page.meaningRows(answer);
    const entries = answer.arc.flatMap((l) => (l.fold ? [] : [l.entry]));
    const dated = entries.map((e) => e.date ?? "").filter((d) => d.length > 0);
    expect([...dated].sort()).toEqual(dated);
    for (const e of entries) {
      if (e.kind === "chapter") {
        expect(drawn).toContain(`data-id="${e.episodeId}"`);
        expect(seen(drawn)).toContain(rows.journalTitle(e.date));
      }
      for (const m of e.moments) expect(drawn).toContain(`class="mmoment" data-open="${m.id}"`);
    }
    const session = entries.find((e) => e.kind === "session");
    if (session !== undefined) expect(seen(drawn)).toContain(session.unplaced ? "Moments outside that session's chapters" : "A session with no chapter written");
    expect(drawn).not.toContain('data-id="null"');
    if (answer.pages === 1) expect(page.askPager(answer)).toBe("");
  });

  test("feelings recorded in a chapter, whose they are, side by side", async () => {
    const first = (await ask<MeaningResult>({ question: "what has Halfmoon been to me", mode: "meaning" })).answer;
    const entry = first.arc.flatMap((l) => (l.fold ? [] : [l.entry])).find((e) => e.kind === "chapter" && e.moments.length > 0) as MeaningEntry;
    const c = Counterpart.open({ dir, owner: true });
    try {
      c.store.addFeelings(entry.moments[0]?.id as string, [
        { whose: "owner", core: "happy", emotion: "proud", strength: 0.8 },
        { whose: "self", core: "curious", emotion: "intrigued", strength: 0.6 },
      ]);
    } finally {
      c.close();
    }
    const { answer } = await ask<MeaningResult>({ question: "what has Halfmoon been to me", mode: "meaning" });
    const felt = answer.arc.flatMap((l) => (l.fold ? [] : [l.entry])).find((e) => e.address === entry.address) as MeaningEntry;
    expect(felt.feelings.owner.length).toBeGreaterThan(0);
    expect(felt.feelings.self.length).toBeGreaterThan(0);
    // The dashboard asks in my voice (`--voiced`), so "mine" is mine.
    expect(answer.whose.self).toBe("mine");
    const drawn = seen(page.meaningRows(answer));
    expect(drawn).toContain(`${answer.whose.self}: ${felt.feelings.self.map((f) => f.word).join(", ")}`);
    expect(drawn).toContain(`${answer.whose.owner}: ${felt.feelings.owner.map((f) => f.word).join(", ")}`);
  });

  test("a long arc pages: the pager asks the same question for the next page", async () => {
    const q = "what has Nkechi Abernathy been to me";
    const { answer: one } = await ask<MeaningResult>({ question: q, mode: "meaning" });
    expect(one.pages).toBeGreaterThan(1);
    const pager = page.askPager(one);
    expect(seen(pager)).toContain(`page 1 of ${one.pages}`);
    expect(pager).toContain('data-ask-page="2"');
    expect(pager).toContain('data-ask-page="0" disabled');
    const { answer: two } = await ask<MeaningResult>({ question: q, mode: "meaning", page: 2 });
    expect(two.page).toBe(2);
    expect(seen(page.askPager(two))).toContain(`page 2 of ${two.pages}`);
  });

  test("with the owner's name known, as the server hands it, \"… to me\" is about the person asked of, not the owner (review of #333)", async () => {
    // The server passes the owner's name (`server.ts#ownerNameOf`); the
    // rewrite once turned "me" into it, and meaning took the owner's own card
    // (more memories than this person's) as the subject.
    const c = Counterpart.open({ dir, owner: true });
    let ownerName: string | null;
    let person: { name: string; count: number } | undefined;
    let ownerCount = 0;
    try {
      ownerName = ownerNames(c.store)[0] ?? null;
      for (const id of c.store.list({ type: "schema", archived: false })) {
        const name = c.schemas.entity(id)?.name ?? null;
        const count = c.store.memoriesNaming(id).length;
        if (name === null || count === 0) continue;
        if (ownerName !== null && name.toLowerCase() === ownerName.toLowerCase()) ownerCount = count;
      }
      for (const id of c.store.list({ type: "schema", archived: false })) {
        const name = c.schemas.entity(id)?.name ?? null;
        const count = c.store.memoriesNaming(id).length;
        if (name === null || count === 0 || count >= ownerCount || name.toLowerCase() === ownerName?.toLowerCase()) continue;
        if (c.schemas.entity(id)?.kind === "person" && (person === undefined || count > person.count)) person = { name, count };
      }
    } finally {
      c.close();
    }
    expect(ownerName).not.toBeNull();
    expect(person).toBeDefined();
    const q = `what has ${person?.name} been to me`;
    const r = await runAction("ask", { json: true, question: q, mode: "meaning" }, { dir, ownerName });
    expect(r.body.exit).toBe(0);
    const answer = JSON.parse((r.body.out ?? []).join("\n")) as MeaningResult;
    expect(answer.lens?.name).toBe(person?.name as string);
    expect(answer.others.map((o) => o.name.toLowerCase())).not.toContain(ownerName?.toLowerCase());
    // His feelings are still his: in my voice "you" is the owner.
    expect(answer.whose.self).toBe("mine");
  });

  test('"what have I been like", by meaning, is the owner\'s own card again (2026-10-09)', async () => {
    // #333 turned his "I" into "you" in meaning mode, which named no card, so
    // the question was read by its words ("like"). In my voice "you" asked
    // about is his card (`meaning.ts#subjectOf`).
    const c = Counterpart.open({ dir, owner: true });
    let ownerName: string | null;
    try {
      ownerName = ownerNames(c.store)[0] ?? null;
    } finally {
      c.close();
    }
    expect(ownerName).not.toBeNull();
    for (const question of ["what have I been like", "how have I changed?"]) {
      const r = await runAction("ask", { json: true, question, mode: "meaning" }, { dir, ownerName });
      expect(r.body.exit).toBe(0);
      expect(r.body.searched?.text).toContain("you");
      const answer = JSON.parse((r.body.out ?? []).join("\n")) as MeaningResult;
      expect(answer.lens?.kind).toBe("card");
      expect(answer.lens?.name.toLowerCase()).toBe(ownerName as string);
      expect(seen(page.meaningHead(answer))).toStartWith(answer.lens?.name as string);
    }
  });

  test("nothing holds it: said so, with what to try", async () => {
    const { answer } = await ask<MeaningResult>({ question: "zqnothingholdsthis", mode: "meaning" });
    expect(answer.reason).toBe("nothing-came");
    if (answer.lens === null) expect(page.meaningHead(answer)).toBe("nothing came");
    else expect(seen(page.meaningHead(answer))).toStartWith(answer.lens.name);
    expect(seen(page.meaningRows(answer))).toContain("or ask for the facts");
    expect(page.askPager(answer)).toBe("");
  });
});

describe("an id in a memory's words is a link to that memory", () => {
  test("on the list's rows: a memory's id and a chapter's address are links, not digits", () => {
    const dash = Dashboard.open({ dir });
    let list: MemoryListView;
    try {
      list = JSON.parse(router(new URL(`http://${HOST}/api/memories/list?limit=200`), HOST, dash.source).body) as MemoryListView;
    } finally {
      dash.close();
    }
    const row = list.rows.find((r) => r.id === ids.cites);
    expect(row).toBeDefined();
    const html = rows.memRow(row as unknown as Record<string, unknown>);
    expect(html).toContain(`data-open="${ids.said}"`);
    expect(html).toContain(`data-open="${ids.now}"`);
    // The chapter's address opens its journal, and says which chapter.
    expect(html).toContain(`data-open="${ids.episode}"`);
    expect(seen(html)).toContain("journal chapter 2 ↗");
    expect(seen(html)).toContain("(memory ↗)");
    for (const id of [ids.said, ids.now, ids.episode]) expect(seen(html)).not.toContain(id as string);
  });

  test("marked words never land inside an id; inside something clickable an id is drawn quietly, not linked", () => {
    const id = "mem_cb6eea7a6b9f";
    const html = rows.memRow({ id: "mem_000000000001", title: null, text: `the cb6eea7a6b9f mem (${id})`, kind: "fact", feelings: [] }, { mark: ["mem", "cb6eea7a6b9f"] });
    expect(html).toContain("<mark>cb6eea7a6b9f</mark> <mark>mem</mark> (");
    expect(html).toContain(`data-open="${id}"`);
    const quiet = marks.withIdMarks(`see ${id}`, true);
    expect(quiet).toContain('class="idref quiet"');
    expect(quiet).not.toContain("data-open");
    expect(marks.withIdMarks("<b> mem_x is not one", false)).toBe("&lt;b&gt; mem_x is not one");
  });
});

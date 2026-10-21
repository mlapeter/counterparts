/**
 * CHAPTER SUMMARIES (2026-10-15, P1 — approved by Mike that day). A chapter
 * used to be ingested as a FULL COPY of its episode, rebuilt (and the old one
 * archived) each time the chapter grew; the journal's words were kept three
 * times. Now:
 *
 *   1. the `chapter` call takes a `summary` — the memory that stands for the
 *      chapter, in the session's words — written once per chapter;
 *   2. it has the copy's shape (`source: episode`, `origin_ref` = the chapter's
 *      id, `meta.episodeId`) plus `meta.chapter`, and the names in the CHAPTER
 *      are credited to it and linked to it as subjects;
 *   3. a chapter with none gets an AUTOMATIC one at the boundary (its opening
 *      lines), counted apart by doctor;
 *   4. a summary FADES like an ordinary memory; a frozen full copy does not;
 *   5. nothing regrows; a frozen copy's chapters get no summary;
 *   6. an append keeps no version row (`store#appendBody`, prefix-only);
 *   7. the dream, the reflection and the nightly page writer show a chapter's
 *      line as its written summary, and the writer sees the day's chapters.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chapterSummaryFindings } from "../src/adapters/claude-code/doctor-open.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { SUMMARY_LINE_BYTES, chapterEntries, dayJournal, entryLine, fitEpisodes, summaryLineBytes, withSummaries } from "../src/core/dream/slices.js";
import { belowReach } from "../src/core/physics/index.js";
import { foldCredited } from "../src/core/recall/activate.js";
import { isJournalCopy } from "../src/core/sleep/types.js";
import { AUTO_SUMMARY_CHARS, automaticSummaryText, chapterSummaries, chaptersCoveredByCopies, summaryTitle } from "../src/core/self/summaries.js";
import { writerInstruction } from "../src/core/self/writer.js";
import { chaptersOf } from "../src/core/handoff/last-here.js";
import { Store, isStoreError, paths, reachExempt, rowToPhysics } from "../src/core/store/index.js";
import { localDate } from "../src/core/time.js";

const SESSION = "sess_summaries";
let root: string;
let dir: string;
let clock = Date.parse("2026-10-14T15:00:00Z");
const open: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-chapter-summaries-"));
  dir = join(root, "store");
  clock = Date.parse("2026-10-14T15:00:00Z");
  substance = 0;
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

function brain(): Counterpart {
  const c = Counterpart.open({ dir, snapshotsDir: join(root, "snaps"), now: () => clock });
  open.push(c);
  return c;
}

function server(): McpServer {
  const s = openServer({ dir, snapshotsDir: join(root, "snaps"), session: SESSION, scope: "/proj/one", now: () => clock });
  open.push(s.counterpart);
  return s;
}

function payload(r: ToolResult): Record<string, unknown> {
  return r.structuredContent;
}

/** Open the next chapter, as the boundary ask does — on more substance each time. */
let substance = 0;
function nextChapter(c: Counterpart): void {
  substance += 400;
  const ask = c.episodeAsk(SESSION, { turns: substance, bytes: substance * 1_000 });
  expect(ask.asked).toBe(true);
}

function summariesOf(c: Counterpart, episodeId: string): { id: string; body: string; meta: Record<string, unknown> }[] {
  return c.store
    .list({ type: "memory", source: "episode", originRef: episodeId, archived: false })
    .map((id) => ({ id, body: c.store.readProse(id).body, meta: c.store.readProse(id).meta }))
    .sort((a, b) => Number(a.meta["chapter"]) - Number(b.meta["chapter"]));
}

/** A full chapter copy as the builds before 2026-10-15 wrote one. */
function legacyCopy(c: Counterpart, episodeId: string): string {
  const body = c.store.readProse(episodeId).body;
  return c.store.put({
    type: "memory",
    kind: "self",
    body,
    meta: { episodeId, episodeKey: `${episodeId}:x`, sessionId: SESSION, handles: [] },
    source: "episode",
    origin: { session: SESSION, ref: episodeId },
  });
}

const CHAPTER_ONE =
  "We spent the afternoon on the zqkiln firing schedule with Mira. She wanted the cone-six ramp held at 1,100 degrees for forty minutes; I argued for thirty. We settled on thirty-five and wrote it on the kiln door.";
const SUMMARY_ONE = "Settled the zqkiln cone-six hold at 35 minutes (Mira wanted 40, I said 30); written on the kiln door.";

// ═══════════════════════════════════════════════════════════════════════════
// 6. an append is not a revision
// ═══════════════════════════════════════════════════════════════════════════

describe("store#appendBody — an append keeps no version, and refuses anything that is not one", () => {
  test("the new body must begin with the stored one whole; nothing is written otherwise", () => {
    const s = Store.open({ dir });
    open.push(s);
    const id = s.put({ type: "episode", kind: "self", body: "## chapter 1 — lived day 0\n\nThe first stretch.\n", meta: { sessionId: SESSION } });
    s.appendBody(id, { body: "## chapter 1 — lived day 0\n\nThe first stretch.\n\nAnd more of it.\n", meta: { chapters: 1 } });
    expect(s.versions(id)).toEqual([]);
    expect(s.readProse(id).body).toContain("And more of it.");
    expect(s.readProse(id).meta["sessionId"]).toBe(SESSION);
    expect(s.row(id)?.revision).toBe(0);

    let refused: unknown = null;
    try {
      s.appendBody(id, { body: "## chapter 1 — lived day 0\n\nA rewritten first stretch.\n" });
    } catch (err) {
      refused = err;
    }
    expect(isStoreError(refused, "APPEND_NOT_PREFIX")).toBe(true);
    expect(s.readProse(id).body).toContain("And more of it.");
    // Adding nothing is not an append either.
    expect(() => s.appendBody(id, { body: s.readProse(id).body })).toThrow("APPEND_NOT_PREFIX");
  });

  test("an observer's append is refused at the store's seam", () => {
    const w = Store.open({ dir });
    const id = w.put({ type: "episode", kind: "self", body: "Words.", meta: {} });
    w.close();
    const o = Store.open({ dir, observer: true });
    open.push(o);
    expect(() => o.appendBody(id, { body: "Words. More." })).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1–2. the chapter call's summary
// ═══════════════════════════════════════════════════════════════════════════

describe("the `chapter` call writes ONE summary memory per chapter, in the copy's shape", () => {
  test("written: the shape, the mark, the default floor, the title, the day, and the tool says so", async () => {
    const s = server();
    const c = s.counterpart;
    nextChapter(c);
    const out = payload(await s.call("chapter", { text: CHAPTER_ONE, summary: SUMMARY_ONE, title: "The zqkiln afternoon", about: "us" }));
    expect(out["stored"]).toBe(true);
    const summary = out["summary"] as Record<string, unknown>;
    expect(summary["outcome"]).toBe("written");
    expect(summary["chapter"]).toBe(1);
    const id = summary["memoryId"] as string;
    const row = c.store.row(id);
    expect(row?.type).toBe("memory");
    expect(row?.kind).toBe("self");
    expect(row?.source).toBe("episode");
    expect(row?.origin_ref).toBe(out["episodeId"] as string);
    expect(row?.about).toBe("us");
    expect(row?.title).toBe("The zqkiln afternoon");
    // The day its chapter's heading names.
    expect(row?.happened_on).toBe(chaptersOf(c.store.readProse(out["episodeId"] as string).body)[0]?.date ?? "");
    const doc = c.store.readProse(id);
    expect(doc.body).toBe(SUMMARY_ONE);
    expect(doc.meta["episodeId"]).toBe(out["episodeId"]);
    expect(doc.meta["chapter"]).toBe(1);
    expect(doc.meta["chapterSummary"]).toBe("written");
    expect(doc.meta["claimedDefault"]).toBe(true);
    // An ordinary self-kind memory's floor, so it is in reach from its first day.
    expect(c.store.read(id).physics.salience.claimed).toBe(0.4);
    expect(belowReach(rowToPhysics(row!), c.store.livedDay())).toBe(false);
  });

  test("written ONCE: a second summary for the same chapter is kept out, and says why", async () => {
    const s = server();
    const c = s.counterpart;
    nextChapter(c);
    const first = payload(await s.call("chapter", { text: CHAPTER_ONE, summary: SUMMARY_ONE }));
    const again = payload(await s.call("chapter", { text: "And Mira came back to check the cones at six.", summary: "A different summary of the same chapter, which should not land." }));
    expect(again["chapter"]).toBe(1);
    const said = again["summary"] as Record<string, unknown>;
    expect(said["outcome"]).toBe("kept");
    expect(said["memoryId"]).toBe((first["summary"] as Record<string, unknown>)["memoryId"]);
    expect(String(said["note"])).toContain("written once");
    expect(summariesOf(c, first["episodeId"] as string).length).toBe(1);
  });

  test("each chapter its own: a second chapter gets its own summary, numbered, titled, its own mark", async () => {
    const s = server();
    const c = s.counterpart;
    nextChapter(c);
    const one = payload(await s.call("chapter", { text: CHAPTER_ONE, summary: SUMMARY_ONE, title: "The zqkiln afternoon", about: "us" }));
    nextChapter(c);
    const two = payload(await s.call("chapter", { text: "The evening went to the glaze tests and the crawling on the zqbowl rims.", summary: "Glaze tests in the evening: the zqbowl rims crawled again, likely too thick.", about: "work" }));
    expect(two["chapter"]).toBe(2);
    const all = summariesOf(c, one["episodeId"] as string);
    expect(all.map((x) => x.meta["chapter"])).toEqual([1, 2]);
    expect(c.store.row(all[1]!.id)?.title).toBe("The zqkiln afternoon — chapter 2");
    // Each chapter's summary keeps its own chapter's mark.
    expect(c.store.row(all[0]!.id)?.about).toBe("us");
    expect(c.store.row(all[1]!.id)?.about).toBe("work");
  });

  test("the names the CHAPTER says are linked to its summary, though the summary does not say them", async () => {
    const s = server();
    const c = s.counterpart;
    const ada = c.schemas.mention({ name: "Adaline", kind: "person", source: "Adaline", chunkRef: "card-adaline", day: c.store.livedDay() });
    expect(ada.ok).toBe(true);
    nextChapter(c);
    const out = payload(await s.call("chapter", { text: `${CHAPTER_ONE} Adaline dropped by with the new thermocouple.`, summary: SUMMARY_ONE }));
    const id = (out["summary"] as Record<string, unknown>)["memoryId"] as string;
    expect(c.store.readProse(id).body.includes("Adaline")).toBe(false);
    expect(c.store.subjectsOf(id)).toContain(ada.id as string);
  });

  test("a chapter's use credits only the summaries recall folded into it, not every chapter's", () => {
    const c = brain();
    for (const body of [
      "Ran the morning loop around the reservoir before breakfast.",
      "The tax filing deadline moved to October this year.",
      "Prefers dense espresso over filter coffee at home.",
      "The garage door opener needs a new battery soon.",
      "Rebasing keeps the history readable for reviewers.",
      "The neighbour's cat sits on the fence every evening.",
      "Bought hiking boots that finally fit properly.",
      "The library closes early on Sundays now.",
      "Wrote a short letter to an old teacher.",
      "The kitchen tap drips when the pressure is high.",
      "Set up a standing desk in the spare bedroom.",
      "The bus route changed and adds ten minutes.",
    ]) c.store.put({ type: "memory", kind: "fact", body });
    nextChapter(c);
    const one = c.appendEpisode(SESSION, CHAPTER_ONE, { summary: SUMMARY_ONE });
    nextChapter(c);
    const two = c.appendEpisode(SESSION, "In the evening the zqbarometer fell fast and we covered the kiln shed against the storm.", {
      summary: "The zqbarometer fell fast in the evening; we covered the kiln shed before the storm.",
    });
    const episodeId = one.episodeId as string;
    c.store.advanceClock("2030-01-01");
    const shown = c.recall.recall({ sessionId: "credit-sess", text: "the zqbarometer storm" });
    expect([...shown.decision.surfaced, ...shown.decision.footnotes]).toContain(episodeId);
    expect(c.recall.gateState("credit-sess").folded?.[two.summary?.id as string]).toBe(episodeId);
    const before = { one: c.store.row(one.summary?.id as string)?.uses ?? 0, two: c.store.row(two.summary?.id as string)?.uses ?? 0 };
    expect(c.resolveUse("credit-sess", episodeId, "referenced").reason).toBe("credited");
    expect(c.store.row(two.summary?.id as string)?.uses).toBeGreaterThan(before.two);
    expect(c.store.row(one.summary?.id as string)?.uses).toBe(before.one);
  });

  test("the half-share bar is the pair's FINAL match, judged after every fold, weak sibling first (review of e6920860)", () => {
    // Episode body 0.2, then S1 0.3, then S2 0.9, in that fold order. Judged
    // as they folded, S1 passed 0.3 >= 0.5 x 0.2; against the final 0.9 it
    // carries a third and is not credited.
    const credited = foldCredited(
      new Map([["epi_x", ["s1_weak", "s2_strong"]]]),
      new Map([["s1_weak", 0.3], ["s2_strong", 0.9]]),
      () => Math.max(0.2, 0.3, 0.9),
    );
    expect(credited.get("epi_x")).toEqual(["s2_strong"]);
    expect(foldCredited(new Map([["epi_y", ["a"]]]), new Map([["a", 0.3]]), () => null).size).toBe(0);
  });

  test("through recall: the summary that out-matches its episode is credited, its weak sibling is not", () => {
    // A summary that out-matches its episode's body, and a weak sibling: the
    // sibling is under half of the final match. Several fresh stores (ids are
    // random), so no one store's order decides it.
    for (let round = 0; round < 8; round += 1) {
      rmSync(dir, { recursive: true, force: true });
      substance = 0;
      const c = brain();
      for (let i = 0; i < 12; i += 1) c.store.put({ type: "memory", kind: "fact", body: `Filler memory number ${String(i)} about the garden, the bus and the library.` });
      nextChapter(c);
      const weak = c.appendEpisode(
        SESSION,
        "A long afternoon of sorting the shelves, labelling boxes, sweeping, and in passing a zqquartz offcut turned up under the bench among the rest of the clutter we cleared.",
        { summary: "Sorted the shelves and boxes; a zqquartz offcut turned up under the bench among the clutter we cleared." },
      );
      nextChapter(c);
      const strong = c.appendEpisode(SESSION, "The evening went to the glaze buckets, and nothing much else happened worth saying.", {
        summary: "The zqgeode split clean: zqgeode halves, a zqgeode shell, and zqquartz inside it.",
      });
      const episodeId = weak.episodeId as string;
      const shown = c.recall.recall({ sessionId: `order-${String(round)}`, text: "the zqquartz zqgeode" });
      expect([...shown.decision.surfaced, ...shown.decision.footnotes]).toContain(episodeId);
      const folded = c.recall.gateState(`order-${String(round)}`).folded ?? {};
      expect(folded[strong.summary?.id as string]).toBe(episodeId);
      expect(folded[weak.summary?.id as string]).toBeUndefined();
      c.close();
      open.splice(open.indexOf(c), 1);
    }
  });

  test("a summary the gate refuses costs the summary, never the chapter", () => {
    const c = brain();
    nextChapter(c);
    const written = c.appendEpisode(SESSION, CHAPTER_ONE, { summary: "ok" });
    expect(written.appended).toBe(true);
    expect(written.summary?.outcome).toBe("refused");
    expect(summariesOf(c, written.episodeId as string)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. automatic summaries
// ═══════════════════════════════════════════════════════════════════════════

describe("a chapter the session gave no summary gets an AUTOMATIC one at the boundary", () => {
  test("its opening lines, marked automatic; the tool said none was given; a later written one replaces it IN PLACE", async () => {
    const s = server();
    const c = s.counterpart;
    nextChapter(c);
    const out = payload(await s.call("chapter", { text: CHAPTER_ONE }));
    const said = out["summary"] as Record<string, unknown>;
    expect(said["outcome"]).toBe("absent");
    expect(String(said["note"])).toContain("opening lines");
    const episodeId = out["episodeId"] as string;
    expect(summariesOf(c, episodeId)).toEqual([]);

    const report = await c.sessionEnd({ date: "2026-10-14" });
    expect(report.episodes.ingested).toBe(1);
    const [auto] = summariesOf(c, episodeId);
    expect(auto?.meta["chapterSummary"]).toBe("automatic");
    expect(auto?.body).toBe(CHAPTER_ONE);

    // The session writes one after all, appending to the same chapter.
    const later = payload(await s.call("chapter", { text: "Mira phoned at nine: the cones bent right.", summary: SUMMARY_ONE }));
    expect((later["summary"] as Record<string, unknown>)["outcome"]).toBe("rewritten");
    const [now] = summariesOf(c, episodeId);
    expect(now?.id).toBe(auto?.id);
    expect(now?.meta["chapterSummary"]).toBe("written");
    expect(now?.body).toBe(SUMMARY_ONE);
    // The engine's words are the row's earlier version.
    expect(c.store.versions(now?.id as string).map((v) => v.body)).toEqual([CHAPTER_ONE]);
    // And the next boundary writes nothing more.
    expect((await c.sessionEnd({ date: "2026-10-14" })).episodes.ingested).toBe(0);
  });

  test("an automatic summary takes ITS chapter's mark, not the episode's latest", async () => {
    const c = brain();
    nextChapter(c);
    const one = c.appendEpisode(SESSION, CHAPTER_ONE, { about: "us" });
    nextChapter(c);
    c.appendEpisode(SESSION, "The second stretch went to cleaning the zqshelves and nothing else much happened.", { about: "work" });
    await c.sessionEnd({ date: "2026-10-14" });
    const all = summariesOf(c, one.episodeId as string);
    expect(all.map((x) => [x.meta["chapter"], c.store.row(x.id)?.about])).toEqual([
      [1, "us"],
      [2, "work"],
    ]);
  });

  test("an UNMARKED chapter's summary is unmarked — never a later chapter's mark (review of e6920860)", async () => {
    const c = brain();
    nextChapter(c);
    const one = c.appendEpisode(SESSION, CHAPTER_ONE);
    nextChapter(c);
    c.appendEpisode(SESSION, "The second stretch went to cleaning the zqshelves and nothing else much happened.", { summary: "Cleaned the zqshelves; nothing else much happened that afternoon." });
    nextChapter(c);
    c.appendEpisode(SESSION, "Then Mike talked about his week, and the worry under it, for a long while.", { about: "owner" });
    await c.sessionEnd({ date: "2026-10-14" });
    const all = summariesOf(c, one.episodeId as string);
    expect(all.map((x) => [x.meta["chapter"], c.store.row(x.id)?.about ?? null])).toEqual([
      [1, null],
      [2, null],
      [3, "owner"],
    ]);
    // The unmarked one has the floor of an unmarked self-kind memory, not the owner mark's choice.
    expect(c.store.row(all[0]!.id)?.about_by ?? null).toBeNull();
  });

  test("an episode from before per-chapter marks (no `abouts`) still lends its latest mark", async () => {
    const c = brain();
    nextChapter(c);
    const one = c.appendEpisode(SESSION, CHAPTER_ONE, { about: "us" });
    const episodeId = one.episodeId as string;
    // As a pre-2026-10-15 episode reads: the latest mark, no per-chapter map.
    const db = new Database(paths.operational(dir));
    const meta = JSON.parse((db.query("SELECT meta FROM memories WHERE id = ?").get(episodeId) as { meta: string }).meta) as Record<string, unknown>;
    delete meta["abouts"];
    db.run("UPDATE memories SET meta = ? WHERE id = ?", [JSON.stringify(meta), episodeId]);
    db.close();
    expect(c.store.readProse(episodeId).meta["abouts"]).toBeUndefined();
    expect(meta["about"]).toBe("us");
    await c.sessionEnd({ date: "2026-10-14" });
    const [s] = summariesOf(c, episodeId);
    expect(c.store.row(s!.id)?.about).toBe("us");
  });

  test("two live summaries of one chapter (a boundary and a chapter call crossing) are settled: the session's stands", () => {
    const c = brain();
    nextChapter(c);
    const written = c.appendEpisode(SESSION, CHAPTER_ONE, { summary: SUMMARY_ONE });
    const episodeId = written.episodeId as string;
    // What a boundary in another process would have written between the check and the put.
    const stray = c.store.put({
      type: "memory",
      kind: "self",
      body: CHAPTER_ONE,
      meta: { episodeId, chapter: 1, chapterSummary: "automatic" },
      source: "episode",
      origin: { session: SESSION, ref: episodeId },
    });
    const stands = (c.self as unknown as { settleSummaries(e: string, ch: number, d: number): string | null }).settleSummaries(episodeId, 1, c.store.livedDay());
    expect(stands).toBe(written.summary?.id as string);
    expect(c.store.row(stray)?.archived).toBe(1);
    expect(c.store.row(stray)?.archived_reason).toBe("summary-duplicate");
    expect(summariesOf(c, episodeId).map((x) => x.id)).toEqual([written.summary?.id as string]);
  });

  test("a long chapter's automatic summary is its opening, cut at a sentence, never past the room", () => {
    const long = `${"The first sentence is about the zqkiln. ".repeat(10)}${"And then it went on and on without stopping for breath ".repeat(20)}`;
    const auto = automaticSummaryText(long);
    expect(auto.length).toBeLessThanOrEqual(AUTO_SUMMARY_CHARS + 2);
    expect(auto.endsWith("…")).toBe(true);
    expect(auto.startsWith("The first sentence")).toBe(true);
    expect(automaticSummaryText("## chapter 3 — lived day 4\n\nShort and whole.")).toBe("Short and whole.");
    expect(summaryTitle("Kiln day", 1)).toBe("Kiln day");
    expect(summaryTitle("Kiln day", 3)).toBe("Kiln day — chapter 3");
    expect(summaryTitle(null, 2)).toBeUndefined();
  });

  test("doctor counts written against automatic, and is silent with neither", async () => {
    const c = brain();
    expect(chapterSummaryFindings(c.store)).toEqual([]);
    nextChapter(c);
    c.appendEpisode(SESSION, CHAPTER_ONE, { summary: SUMMARY_ONE });
    nextChapter(c);
    c.appendEpisode(SESSION, "The second stretch went to cleaning the zqshelves and nothing else much happened.");
    await c.sessionEnd({ date: "2026-10-14" });
    const [line] = chapterSummaryFindings(c.store);
    expect(line?.severity).toBe("green");
    expect(line?.data).toEqual({ written: 1, automatic: 1, days: 7 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4–5. fading, and the frozen copies
// ═══════════════════════════════════════════════════════════════════════════

describe("summaries fade; the frozen full copies keep their exemption and are not regrown", () => {
  test("a summary is neither reach-exempt nor a journal copy; a legacy full copy is both", () => {
    const c = brain();
    nextChapter(c);
    const written = c.appendEpisode(SESSION, CHAPTER_ONE, { summary: SUMMARY_ONE });
    const summary = c.store.row(written.summary?.id as string)!;
    expect(reachExempt(summary)).toBe(false);
    expect(isJournalCopy(summary)).toBe(false);
    const copy = c.store.row(legacyCopy(c, written.episodeId as string))!;
    expect(reachExempt(copy)).toBe(true);
    expect(isJournalCopy(copy)).toBe(true);
  });

  test("the chapters a frozen copy stands for get no summary; a chapter written after it does", async () => {
    const c = brain();
    nextChapter(c);
    const one = c.appendEpisode(SESSION, CHAPTER_ONE);
    const episodeId = one.episodeId as string;
    const copy = legacyCopy(c, episodeId);
    expect(chaptersCoveredByCopies(c.store, episodeId)).toBe(1);
    nextChapter(c);
    c.appendEpisode(SESSION, "The evening went to the glaze tests and the crawling on the zqbowl rims.");

    await c.sessionEnd({ date: "2026-10-14" });
    const all = summariesOf(c, episodeId).filter((x) => x.meta["chapterSummary"] !== undefined);
    expect(all.map((x) => x.meta["chapter"])).toEqual([2]);
    // The copy is as it was: live, not regrown, not archived.
    expect(c.store.row(copy)?.archived).toBe(0);
    expect(c.store.readProse(copy).body.includes("glaze")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. the whole-day views
// ═══════════════════════════════════════════════════════════════════════════

describe("whole-day views show a chapter's line as its summary", () => {
  test("a written summary is the entry's line; an automatic one leaves the first words", () => {
    const body = "## chapter 1 — Tue 14 Oct 2026 · lived day 3\n\nFirst words of chapter one.\n\n## chapter 2 — Tue 14 Oct 2026 · lived day 3\n\nFirst words of chapter two.\n";
    const entries = withSummaries(
      chapterEntries(body),
      new Map([
        [1, { kind: "written" as const, body: "What chapter one was, as its session put it." }],
        [2, { kind: "automatic" as const, body: "First words of chapter two." }],
      ]),
    );
    expect(entryLine(entries[0]!, 200)).toBe("What chapter one was, as its session put it.");
    // A later part renders only what was there when its fit ran (`asOf`).
    const later = withSummaries(chapterEntries(body), new Map([[1, { kind: "written" as const, body: "Written after the fit.", writtenAt: 2_000 }]]), 1_000);
    expect(entryLine(later[0]!, 200)).toBe("First words of chapter one.");
    expect(entryLine(entries[1]!, 200)).toBe("First words of chapter two.");
    const fitted = fitEpisodes([{ row: { id: "epi_x", title: null }, at: 1, fresh: entries, earlier: 0 }], {
      room: 10_000,
      owner: [],
      day: 3,
      lineBytes: 200,
      entryChars: 6_000,
    });
    // The room took both whole; the line is what a tight room would show.
    expect(fitted.chapters[0]?.entries.length).toBe(2);
  });

  test("a summary's line is as long as the room allows: a quiet day reads it whole, a busy one its opening", () => {
    // 40% of the room over the entries in view, between an ordinary line and SUMMARY_LINE_BYTES.
    expect(summaryLineBytes(30_000, 10, 200)).toBe(SUMMARY_LINE_BYTES);
    expect(summaryLineBytes(30_000, 51, 200)).toBe(235);
    expect(summaryLineBytes(24_000, 150, 200)).toBe(200);
    const long = "A summary that runs on. ".repeat(60);
    const entries = withSummaries(chapterEntries("## chapter 1 — lived day 1\n\nShort chapter words.\n"), new Map([[1, { kind: "written" as const, body: long }]]));
    const fitted = fitEpisodes([{ row: { id: "epi_y", title: null }, at: 1, fresh: entries, earlier: 0 }], { room: 300, owner: [], day: 1, lineBytes: 200, entryChars: 6_000 });
    expect(fitted.summaryBytes).toBe(200);
  });

  test("the dream's queue leaves the journal's own memories out: the chapter comes once, in the journal", async () => {
    const c = brain();
    nextChapter(c);
    const written = c.appendEpisode(SESSION, CHAPTER_ONE, { summary: SUMMARY_ONE });
    const queued = (c.dreams as unknown as { queue(o: { owner: boolean }): { ids: string[] } }).queue({ owner: true });
    expect(queued.ids).not.toContain(written.summary?.id);
  });

  test("the nightly writer sees the day's chapters (summaries as their lines), and the summaries are not listed again as memories", async () => {
    const c = brain();
    nextChapter(c);
    const written = c.appendEpisode(SESSION, CHAPTER_ONE, { summary: SUMMARY_ONE, title: "The zqkiln afternoon" });
    c.store.put({ type: "memory", kind: "fact", body: "The zqkiln shelf paper is nearly out; order more this week." });
    // The clock's own local day, so the suite's far-ahead time zone reads the same day.
    const about = localDate(clock, c.store.zone());
    const day = dayJournal(c.store, { about, room: 14_000, owner: [], day: c.store.livedDay(), lineBytes: 200, entryChars: 6_000 });
    expect(day.entries).toBe(1);
    expect(day.chapters[0]?.id).toBe(written.episodeId as string);

    clock += 24 * 3_600_000;
    const input = c.pageWriterInput({ about });
    expect(input.journal?.total).toBe(1);
    expect(input.journal?.entries[0]?.episode).toBe(written.episodeId as string);
    expect(input.memories.map((m) => m.id)).not.toContain(written.summary?.id);
    const text = writerInstruction(input, { tool: "counterparts self_page" });
    expect(text).toContain(`The journal on ${about}`);
    expect(text).toContain("zqkiln");
  });

  test("a tight room shows the written summary as the chapter's line", () => {
    const c = brain();
    nextChapter(c);
    const long = `${CHAPTER_ONE} ${"The rest of the afternoon was more of the same kiln talk, at length. ".repeat(80)}`;
    const written = c.appendEpisode(SESSION, long, { summary: SUMMARY_ONE });
    const byEpisode = chapterSummaries(c.store, [written.episodeId as string]);
    expect(byEpisode.get(written.episodeId as string)?.get(1)?.kind).toBe("written");
    const day = dayJournal(c.store, { about: localDate(clock, c.store.zone()), room: 400, owner: [], day: c.store.livedDay(), lineBytes: 200, entryChars: 6_000 });
    expect(day.chapters[0]?.entries[0]?.fidelity).toBe("line");
    expect(day.chapters[0]?.entries[0]?.text).toBe(SUMMARY_ONE);
  });
});

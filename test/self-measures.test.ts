/**
 * TWO CHEAP READINGS OF THE SELF, AND THE PAGE IN LAYERS (2026-10-20, wave 1
 * lane 2; experiments, lightly held).
 *
 * These tests pin:
 *   1. the page's claims are its sentences (`pageClaims`), and a sent trace
 *      names them by their words or an opening of them (`traceFor`);
 *   2. the page's one door stores the trace beside the text, tied to it, and
 *      never changes the words; restore and a held page kept at the run's end
 *      carry it; a rewrite without one reads as untraced;
 *   3. the reflection takes cites per passage (`page.claims`), filtered like
 *      the whole page's, and says how many named no sentence;
 *   4. doctor's two lines: the page's claims and what they rest on (an old
 *      page reads as "not kept per claim", never as all hypotheses), and the
 *      support behind each core element;
 *   5. the dashboard's layers: how each section read across kept versions,
 *      and how far back they reach.
 *
 * Hermetic: a fresh temp data dir per test, removed afterwards.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SELF_TUNABLES } from "../src/core/self/tunables.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { coreSupportFindings, selfPageTraceFindings } from "../src/adapters/claude-code/doctor.js";
import { coreListLines } from "../src/adapters/cli/dream-core.js";
import { Counterpart } from "../src/core/counterpart.js";
import { episodeGate } from "../src/core/bridge.js";
import { PAGE_ROOM_BYTES, Self, byteLength, claimKey, pageClaims, readSelfPage, traceFor } from "../src/core/self/index.js";
import { coreSupport, pageTrace } from "../src/core/self/measures.js";
import type { PutInput } from "../src/core/store/index.js";
import { Store } from "../src/core/store/index.js";
// @ts-expect-error — a plain browser module, no declarations
import { pageLayers, reachWords, sectionsOf, storyWords } from "../src/adapters/dashboard/web/pages/self/sections/layers.js";

let dir: string;
let dateN = 0;
const open: { close(): void }[] = [];
const SESSION = "s-measures-1020";

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-self-measures-"));
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

function date(n: number): string {
  return new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString().slice(0, 10);
}

function brain(): Counterpart {
  const c = Counterpart.open({
    dir,
    identity: { name: "Mike" },
    now: () => Date.now() + dateN * 86_400_000,
  });
  open.push(c);
  return c;
}

function store(): Store {
  const s = Store.open({ dir });
  open.push(s);
  return s;
}

function selfOn(s: Store): Self {
  return new Self({ store: s, gate: episodeGate() });
}

function nextDay(s: Store): void {
  dateN += 1;
  s.advanceClock(date(dateN));
}

function mem(s: Store, body: string, over: Partial<PutInput> = {}): string {
  const day = s.livedDay();
  return s.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

const PAGE = [
  "## Core",
  "",
  "I keep things plain, e.g. short sentences. I say what I do not know.",
  "",
  "- Small steps, checked twice.",
  "- **Mike** and I build this together",
  "",
  "## Lately",
  "",
  "The release went out on the 19th.",
  "",
  "```",
  "not. a. claim.",
  "```",
].join("\n");

// ═══════════════════════════════════════════════════════════════════════════
// 1. Claims are sentences
// ═══════════════════════════════════════════════════════════════════════════

describe("1. the page's claims, and a trace naming them", () => {
  test("sentences of paragraphs and list entries; no headings, nothing fenced, abbreviations kept whole", () => {
    expect(pageClaims(PAGE)).toEqual([
      "I keep things plain, e.g. short sentences.",
      "I say what I do not know.",
      "Small steps, checked twice.",
      "**Mike** and I build this together",
      "The release went out on the 19th.",
    ]);
    expect(pageClaims("")).toEqual([]);
    expect(pageClaims("## Core\n\n## Lately")).toEqual([]);
  });

  test("a passage names its sentence by its words (emphasis and spacing aside), an opening of them, or several at once", () => {
    const t = traceFor(PAGE, {
      cites: ["mem_a"],
      claims: [
        { text: "I keep things plain, e.g.   short sentences. I say what I do not know.", cites: ["mem_b"] },
        { text: "Mike and I build this together", cites: ["mem_c"] },
        { text: "The release went out on", cites: ["mem_d"] },
        { text: "Something the page never says.", cites: ["mem_e"] },
        { text: "Small steps", cites: ["mem_f"] },
      ],
    });
    expect(t.claims).toBe(5);
    // The 23-character opening is too short to name a sentence; so is "Small steps".
    expect(t.unmatched).toBe(3);
    expect(t.cited).toBe(3);
    expect(t.trace.claims?.map((c) => c.cites)).toEqual([["mem_b"], ["mem_b"], ["mem_c"]]);
    expect(t.trace.claims?.[2]?.of).toBe(claimKey("**Mike** and I build this together"));
    // Every claim's ids are the whole page's too.
    expect(t.trace.cites).toEqual(["mem_a", "mem_b", "mem_c"]);
    expect(traceFor(PAGE, { cites: ["mem_a"], claims: [{ text: "The release went out on the", cites: ["mem_d"] }] }).cited).toBe(1);
  });

  test("a passage quoted with its list mark, its heading or a quote mark names the same sentence; an initial does not end one (review of #550)", () => {
    const body = "## Core\n\nY. I keep the notes plain and short.\n\n- Small steps, checked twice over.\n\n> We build it together, slowly.";
    expect(pageClaims(body)).toEqual(["Y. I keep the notes plain and short.", "Small steps, checked twice over.", "We build it together, slowly."]);
    const t = traceFor(body, {
      cites: [],
      claims: [
        { text: "## Core\n\nY. I keep the notes plain and short.", cites: ["mem_a"] },
        { text: "- Small steps, checked twice over.", cites: ["mem_b"] },
        { text: "> We build it together, slowly.", cites: ["mem_c"] },
        // The initial read as a sentence's end: the rest names nothing.
        { text: "I keep the notes plain and short.", cites: ["mem_d"] },
      ],
    });
    expect(t.unmatched).toBe(1);
    expect(t.trace.claims?.map((c) => c.cites)).toEqual([["mem_a"], ["mem_b"], ["mem_c"]]);
  });

  test("with no passages sent, the trace is the whole page's list and claims are not recorded", () => {
    const t = traceFor(PAGE, { cites: ["mem_a", "mem_a"] });
    expect(t.trace).toMatchObject({ cites: ["mem_a"], claims: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Stored with the page, tied to its text
// ═══════════════════════════════════════════════════════════════════════════

describe("2. the page's door keeps the trace beside the text", () => {
  test("stored on the row's meta, the words untouched, read back per claim with the uncited ones empty", () => {
    const s = store();
    const me = selfOn(s);
    const w = me.revisePage(PAGE, {
      by: "reflection",
      reason: "test",
      trace: { cites: ["mem_a"], claims: [{ text: "I say what I do not know.", cites: ["mem_b"] }] },
    });
    expect(w.written).toBe(true);
    expect(w.traced).toEqual({ claims: 5, cited: 1, unmatched: 0 });
    const page = readSelfPage(s);
    expect(page?.body).toBe(PAGE);
    expect(page?.trace?.cites).toEqual(["mem_a", "mem_b"]);
    expect(page?.trace?.claims?.map((c) => c.cites.length)).toEqual([0, 1, 0, 0, 0]);
  });

  test("the same text written again without one keeps it; a new text without one reads as untraced", () => {
    const s = store();
    const me = selfOn(s);
    me.revisePage(PAGE, { by: "reflection", reason: "a", trace: { cites: ["mem_a"], claims: [] } });
    me.revisePage(PAGE, { by: "owner", reason: "same words" });
    expect(readSelfPage(s)?.trace).toMatchObject({ cites: ["mem_a"] });
    me.revisePage(`${PAGE}\n\nOne more line.`, { by: "session", reason: "new words" });
    expect(readSelfPage(s)?.trace).toBeNull();
  });

  test("a clear lets the trace go: the same words written after it start untraced (review of #550)", () => {
    const s = store();
    const me = selfOn(s);
    me.revisePage(PAGE, { by: "reflection", reason: "a", trace: { cites: ["mem_a"], claims: [{ text: "I say what I do not know.", cites: ["mem_a"] }] } });
    me.clearPage({ reason: "cleared" });
    me.revisePage(PAGE, { by: "owner", reason: "the same words again" });
    expect(readSelfPage(s)?.trace).toBeNull();
    // The version cleared keeps its own, for a restore.
    me.restorePage(1);
    expect(readSelfPage(s)?.trace?.cites).toEqual(["mem_a"]);
  });

  test("a restore brings back the version's own trace; a version from before traces comes back untraced", () => {
    const s = store();
    const me = selfOn(s);
    // The reflection's whole page, as written (the page split by section off, 2026-10-23).
    const split = SELF_TUNABLES.PAGE_SPLIT;
    (SELF_TUNABLES as { PAGE_SPLIT: boolean }).PAGE_SPLIT = false;
    try {
    me.revisePage("## Core\n\nAn old page, before traces.", { by: "session", reason: "old" });
    me.revisePage(PAGE, { by: "reflection", reason: "traced", trace: { cites: ["mem_a"], claims: [{ text: "Small steps, checked twice.", cites: ["mem_a"] }] } });
    me.revisePage("## Core\n\nSomething else.", { by: "owner", reason: "else" });
    me.restorePage(2);
    expect(readSelfPage(s)?.body).toBe(PAGE);
    expect(readSelfPage(s)?.trace?.claims?.find((c) => c.cites.length > 0)?.text).toBe("Small steps, checked twice.");
    me.restorePage(1);
    expect(readSelfPage(s)?.trace).toBeNull();
    } finally {
      (SELF_TUNABLES as { PAGE_SPLIT: boolean }).PAGE_SPLIT = split;
    }
  });

  test("a held page kept at the run's end keeps its trace (keys and ids only on the refusal row)", () => {
    const s = store();
    const me = selfOn(s);
    me.revisePage("## Core\n\nBefore.", { by: "owner", reason: "before" });
    const para = "The kilns ran all week and the glaze tests came back even. ";
    let body = "## Core\n\nI keep a careful account of the studio.\n\n## Lately\n\n";
    while (byteLength(body) <= PAGE_ROOM_BYTES + 200) body += para;
    const held = me.revisePage(body.trim(), {
      by: "reflection",
      reason: "the reflection",
      session: SESSION,
      trace: { cites: ["mem_a"], claims: [{ text: "I keep a careful account of the studio.", cites: ["mem_a"] }] },
    });
    expect(held.reason).toBe("past-room");
    const row = s.eventLog({ name: "self.page.refused", order: "desc", limit: 1 })[0];
    expect(row?.payload ?? "").not.toContain("I keep a careful account of the studio.\"");
    expect(me.keepHeldPage()?.written).toBe(true);
    const trace = readSelfPage(s)?.trace;
    expect(trace?.claims?.[0]).toEqual({ text: "I keep a careful account of the studio.", cites: ["mem_a"] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The reflection's ask and writer
// ═══════════════════════════════════════════════════════════════════════════

describe("3. the reflection sends cites per passage", () => {
  function reflecting(): { c: Counterpart; cite: string; dreamed: string; reflection: string } {
    const c = brain();
    nextDay(c.store);
    nextDay(c.store);
    const cite = mem(c.store, "Mike and I finished the release together and he said thank you.", { kind: "person", about: "us" });
    const dreamed = mem(c.store, "A dreamed gist about releases.", { source: "dreamed", about: "us" });
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
    return { c, cite, dreamed, reflection: begun.bundle.reflection };
  }

  test("the ask names page.claims; passages' ids count for the page, through the same filters; the words are stored as sent", () => {
    const { c, cite, dreamed, reflection } = reflecting();
    const text = "## Core\n\nI finished the release with Mike. I like plain words.\n";
    const done = c.reflections.finish({
      reflection,
      session: SESSION,
      entry: "The release mattered.",
      cites: [cite],
      page: {
        text,
        cites: [],
        claims: [
          { text: "I finished the release with Mike.", cites: [cite, dreamed] },
          { text: "A sentence the page does not have.", cites: [cite] },
        ],
      },
    });
    expect(done.ok ? "" : done.reason).toBe("");
    if (!done.ok) return;
    expect(done.outcome.page).toMatchObject({ written: true });
    expect(String(done.outcome.page.note ?? "")).toContain("1 of page.claims matched no sentence");
    const page = readSelfPage(c.store);
    expect(page?.body).toBe(text.trim());
    // The dreamed gist was refused as a source, from the passage too.
    expect(page?.trace?.cites).toEqual([cite]);
    expect(page?.trace?.claims).toEqual([
      { text: "I finished the release with Mike.", cites: [cite] },
      { text: "I like plain words.", cites: [] },
    ]);
  });

  test("an empty page.claims is cites for the whole page only, never every sentence uncited", () => {
    const { c, cite, reflection } = reflecting();
    const done = c.reflections.finish({
      reflection,
      session: SESSION,
      entry: "The release mattered.",
      cites: [cite],
      page: { text: "## Core\n\nI finished the release with Mike.", cites: [cite], claims: [] },
    });
    expect(done.ok ? "" : done.reason).toBe("");
    expect(readSelfPage(c.store)?.trace).toEqual({ cites: [cite], claims: null });
  });

  test("a page cited only by passage, every id refused (not shown, a dream's gist): sent back naming them (review of #550)", () => {
    const { c, cite } = reflecting();
    // A dreamed gist is never a page's source (the confidential case this test used was retired 2026-10-21).
    const secret = mem(c.store, "A dreamed thought about Mike's health.", { about: "owner", source: "dreamed" });
    const begun = c.reflections.begin({ session: `${SESSION}-2` });
    if (!begun.ok) throw new Error(begun.reason);
    const text = "## Core\n\nI finished the release with Mike. I like plain words.";
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: `${SESSION}-2`,
      entry: "The release mattered.",
      cites: [cite],
      page: { text, cites: [], claims: [{ text: "I finished the release with Mike.", cites: ["mem_notshown0", secret] }] },
    });
    expect(done.ok ? "" : done.reason).toBe("");
    if (!done.ok) return;
    expect(done.outcome.page).toMatchObject({ written: false, reason: "page-needs-cites" });
    const detail = String(done.outcome.page.detail ?? "");
    expect(detail).toContain("page.cites and page.claims name no memory");
    expect(detail).toContain("mem_notshown0:not-shown");
    expect(detail).toContain(`${secret}:`);
  });

  test("a sentence the gate redacted reads as uncited, and nothing of it is kept but its key (review of #550)", () => {
    const { c, cite, reflection } = reflecting();
    const key = "AKIAIOSFODNN7EXAMPLE";
    const done = c.reflections.finish({
      reflection,
      session: SESSION,
      entry: "The release mattered.",
      cites: [cite],
      page: {
        text: `## Core\n\nI once saw the key ${key} in a log. I finished the release with Mike.`,
        cites: [cite],
        claims: [
          { text: `I once saw the key ${key} in a log.`, cites: [cite] },
          { text: "I finished the release with Mike.", cites: [cite] },
        ],
      },
    });
    expect(done.ok ? "" : done.reason).toBe("");
    if (!done.ok) return;
    expect(String(done.outcome.page.note ?? "")).toContain("1 of page.claims matched no sentence");
    const page = readSelfPage(c.store);
    expect(page?.body).not.toContain(key);
    expect(page?.trace?.claims?.map((x) => x.cites.length)).toEqual([0, 1]);
    const row = page === null ? null : c.store.readProse(page.id);
    expect(JSON.stringify(row?.meta ?? {})).not.toContain(key);
  });

  test("the instructions ask for it in one clause", () => {
    const { c } = reflecting();
    const begun = c.reflections.begin({ session: SESSION });
    const how = begun.ok ? begun.instructions : "";
    expect(how).toContain("In page.claims, give each sentence the ids it rests on");
    expect(how).toContain("a sentence with none stands as a hypothesis");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Doctor's two lines
// ═══════════════════════════════════════════════════════════════════════════

describe("4. doctor: the page's claims, and the core's support", () => {
  test("no page: no claims line", () => {
    expect(selfPageTraceFindings(store())).toEqual([]);
  });

  test("a page with no cites at all (a session's, an old one) says so, and does not call its claims hypotheses", () => {
    const s = store();
    selfOn(s).revisePage(PAGE, { by: "session", reason: "by hand" });
    const [f] = selfPageTraceFindings(s);
    expect(f?.severity).toBe("green");
    expect(f?.detail).toBe("5 claims; no cites kept with it (written by session)");
    expect(f?.data["uncited"]).toBeNull();
  });

  test("a page written before traces, by a reflection, falls back to its reflection's record", () => {
    const s = store();
    const a = mem(s, "One.");
    expect(selfOn(s).revisePage(PAGE, { by: "reflection", reason: "reflection rfl_0000aa" }).written).toBe(true);
    const read = readSelfPage(s);
    if (read === null) throw new Error("no page");
    expect(read.trace).toBeNull();
    const fake = { row: (id: string) => s.row(id), reflection: () => ({ cites: JSON.stringify([a, "mem_gone00"]) }) } as unknown as Parameters<typeof pageTrace>[0];
    expect(pageTrace(fake, read)).toMatchObject({ source: "reflection", cites: 2, live: 1, archivedOrMissing: 1, uncited: null, hypotheses: null });
  });

  test("a traced page: its cites by where they stand, and its claims with none behind them", () => {
    const s = store();
    const live = mem(s, "Live.");
    const gone = mem(s, "Archived.");
    s.archive(gone, "test");
    selfOn(s).revisePage(PAGE, {
      by: "reflection",
      reason: "test",
      trace: { cites: [live, gone, "mem_missing0"], claims: [{ text: "I say what I do not know.", cites: [live] }] },
    });
    const [f] = selfPageTraceFindings(s);
    expect(f?.detail).toBe("5 claims; cites 3 memories, 1 live, 2 archived or missing; 4 claims with no memory behind them");
    expect(f?.data).toMatchObject({ claims: 5, cites: 3, live: 1, archivedOrMissing: 2, uncited: 4 });
  });

  test("a traced page with no per-claim record says the claims were not kept per claim", () => {
    const s = store();
    selfOn(s).revisePage(PAGE, { by: "reflection", reason: "test", trace: { cites: [mem(s, "x")] } });
    expect(selfPageTraceFindings(s)[0]?.detail).toBe("5 claims; cites 1 memory, 1 live, 0 archived or missing; cites were not kept per claim for this version");
  });

  test("core support: returns, derivations and links as three counts; days and contexts spanned; one episode counted", () => {
    const s = store();
    expect(coreSupportFindings(s)[0]?.detail).toBe("no elements yet");
    const parent = mem(s, "The first time we shipped.", { origin: { scope: "/work/a" } });
    nextDay(s);
    nextDay(s);
    const fresh = mem(s, "Born core today, alone.");
    s.updatePhysics(fresh, { promotedIdentity: true });
    const earned = mem(s, "We ship together.", { meta: { mergedFrom: [parent] }, origin: { scope: "/work/b" } });
    s.updatePhysics(earned, { promotedIdentity: true });
    const friend = mem(s, "A linked memory.");
    s.link({ src: friend, dst: earned, weight: 0.5, day: s.livedDay() });
    // Its only parent archived: still counted, as what it was made from.
    s.archive(parent, "test");
    const sup = coreSupport(s);
    const e = sup.elements.find((x) => x.id === earned);
    const f = sup.elements.find((x) => x.id === fresh);
    expect(e).toMatchObject({ returns: 0, derivations: 1, links: 1, days: 2, contexts: 2 });
    expect(f).toMatchObject({ returns: 0, derivations: 0, links: 0, days: 1, contexts: 0 });
    expect(sup.oneEpisode).toBe(1);
    const [line] = coreSupportFindings(s);
    expect(line?.severity).toBe("green");
    expect(line?.detail).toMatch(/^2 elements; 1 with one episode behind it; span 1–2 days, /);
    expect(line?.detail).toContain("returns 0, derivations 0–1, links 0–1");
  });

  test("links widen neither span; the episode a memory was born from counts once, beside its meta", () => {
    const s = store();
    const old = mem(s, "A memory from long ago, elsewhere.", { origin: { scope: "/work/old" } });
    for (let i = 0; i < 5; i++) nextDay(s);
    // Born from an episode (origin_ref), and its meta names the same episode: one derivation.
    const born = mem(s, "We ship together.", { origin: { scope: "/work/b", ref: "epi_00aa11" }, meta: { episodeId: "epi_00aa11" } });
    s.updatePhysics(born, { promotedIdentity: true });
    // Linked to a memory from another day and project: a link, not a wider span.
    s.link({ src: old, dst: born, weight: 0.5, day: s.livedDay() });
    // A dream's ref is not a lived episode.
    const dreamt = mem(s, "A pattern I noticed.", { origin: { ref: "dream:drm_00bb22" } });
    s.updatePhysics(dreamt, { promotedIdentity: true });
    const sup = coreSupport(s);
    expect(sup.elements.find((x) => x.id === born)).toMatchObject({ derivations: 1, links: 1, days: 1, contexts: 1 });
    expect(sup.elements.find((x) => x.id === dreamt)).toMatchObject({ derivations: 0, links: 0, days: 1 });
    expect(sup.oneEpisode).toBe(2);
    const [line] = coreSupportFindings(s);
    expect(line?.detail).toBe("2 elements; 2 with one episode behind them; span 1 day, 0–1 contexts; returns 0, derivations 0–1, links 0–1");
  });

  test("core --list shows the three columns under each element", () => {
    const c = brain();
    const id = mem(c.store, "We ship together.", { kind: "self", about: "us" });
    c.store.updatePhysics(id, { promotedIdentity: true });
    const lines = coreListLines(c);
    const at = lines.findIndex((l) => l.includes(id));
    expect(lines[at + 1]).toBe("      returns 0 · derivations 0 · links 0 · 1 lived day · 0 contexts");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The page in layers
// ═══════════════════════════════════════════════════════════════════════════

describe("5. the dashboard's layers", () => {
  const step = (seq: number, date: string, body: string | null, current = false) => ({ n: seq, seq, current, day: seq, date, by: "reflection", reason: null, body, bytes: 0 });

  test("each section's runs of versions, oldest first; unchanged ones say so; a gone section is last", () => {
    const l = pageLayers([
      step(4, "2026-09-22", "## Core\n\nI thought X.\n\n## Us\n\nWe met.\n\n## Old\n\nGone soon."),
      step(5, "2026-09-30", "## Core\n\nI thought X.\n\n## Us\n\nWe met."),
      step(6, "2026-10-05", "## Core\n\nBy now, Y.\n\n## Us\n\nWe   met.", true),
    ]);
    expect(l.pruned).toBe(3);
    expect(l.versions).toBe(3);
    expect(l.reach).toMatchObject({ seq: 4, date: "2026-09-22" });
    expect(l.sections.map((s: { heading: string }) => s.heading)).toEqual(["Core", "Us", "Old"]);
    const core = l.sections[0];
    expect(core.layers.map((x: { date: string; text: string }) => [x.date, x.text])).toEqual([
      ["2026-09-22", "I thought X."],
      ["2026-10-05", "By now, Y."],
    ]);
    expect(storyWords(core)).toBe("Changed 1 time.");
    expect(l.sections[1].layers.length).toBe(1);
    expect(storyWords(l.sections[2])).toMatch(/^Read so on Sep 22nd/);
    expect(reachWords(l)).toContain("(3 versions; 3 older ones have gone under the ordinary retention)");
  });

  test("a section that came or went is not counted as reading the same in every version (review of #550)", () => {
    const l = pageLayers([
      step(1, "2026-10-01", "## Core\n\nI keep it plain."),
      step(2, "2026-10-02", "## Core\n\nI keep it plain.\n\n## Lately\n\nThe release went out."),
      step(3, "2026-10-03", "## Core\n\nI keep it plain.\n\n## How I work\n\nSmall steps.", true),
    ]);
    const by = (h: string): { inAll: boolean; layers: unknown[] } => l.sections.find((s: { heading: string }) => s.heading === h);
    expect(by("Core").inAll).toBe(true);
    expect(by("Lately").inAll).toBe(false);
    expect(storyWords(by("How I work"))).toBe("On the page since Oct 3rd, unchanged.");
    expect(storyWords(by("Lately"))).toBe("Read so on Oct 2nd, and no longer on the page.");
  });

  test("one version only, or none readable: nothing to layer", () => {
    expect(pageLayers([step(1, "2026-10-01", "## Core\n\nOnly.", true)])).toMatchObject({ versions: 1, pruned: 0 });
    expect(pageLayers([step(2, "2026-10-01", null)])).toMatchObject({ versions: 0, reach: null, sections: [] });
    expect(sectionsOf("Just prose.")).toEqual([{ heading: "(opening)", body: "Just prose." }]);
  });
});

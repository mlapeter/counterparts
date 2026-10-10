/**
 * REVIEW OF #363 (2026-10-10): three holes in the page's ladder, each proved
 * here before it was closed.
 *
 *   1. A reflection's short version is injected into every wake exactly like
 *      the page, so it crosses the reflection's own gates too — the dream's
 *      mark and a confidential memory's words — not only the page's battery.
 *   2. A short version added on its own is a revision of the page AS IT WAS
 *      READ: a page another process wrote in between is never reverted by it.
 *   3. The wake's own frame around the page — a rung's top line and end line —
 *      copied out of a wake and written back, is left out like the page's
 *      datelines: a stored one would print a stale size and an end line in
 *      the middle of the page, after which a cut would look whole.
 *
 * Hermetic: a fresh temp data dir per test, removed afterwards; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { episodeGate } from "../src/core/bridge.js";
import { DREAM_MARK } from "../src/core/dream/index.js";
import {
  BRIEFING_KEY,
  PAGE_END_LINES,
  PAGE_ROOM_BYTES,
  Self,
  byteLength,
  findPageRow,
  pageTooLargeLine,
  pageTopLine,
} from "../src/core/self/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { Store } from "../src/core/store/index.js";

let dir: string;
const open: { close(): void }[] = [];
const SESSION = "s-review-363";

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-page-ladder-review-"));
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

let dateN = 0;
function date(n: number): string {
  return new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString().slice(0, 10);
}

function brain(): Counterpart {
  const c = Counterpart.open({
    dir,
    owner: true,
    bundlesAsOwner: true,
    identity: { name: "Mike" },
    now: () => Date.now() + dateN * 86_400_000,
  });
  open.push(c);
  return c;
}

function nextDay(c: Counterpart): void {
  dateN += 1;
  c.store.advanceClock(date(dateN));
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

/** A page past the room, of plain placeholder prose that quotes nothing. */
function longPage(): string {
  const para = "I keep a careful account of the studio and the people in it, and I say what I do not know before I guess.";
  let page = "## Core\n\n";
  while (byteLength(page) <= PAGE_ROOM_BYTES + 200) page += `${para}\n\n`;
  return `${page}## Lately\n\nThe kiln and the cone readings.`;
}

const SECRET = "Mike told me about the health scare he has not told anyone else about yet.";

/** A reflection with a confidential memory and an open one shown to it. */
function setUp(): { c: Counterpart; open: string; reflection: string } {
  const c = brain();
  nextDay(c);
  nextDay(c);
  const secret = mem(c, SECRET, { kind: "person", about: "owner", meta: { confidential: true } });
  const plain = mem(c, "Mike and I finished the release together and he said thank you.", { kind: "person", about: "us" });
  expect(c.store.row(secret)?.confidential).toBe(1);
  const begun = c.reflections.begin({ session: SESSION });
  if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
  return { c, open: plain, reflection: begun.bundle.reflection };
}

describe("1. a reflection's short version crosses the reflection's own gates", () => {
  for (const [what, short] of [
    ["a confidential memory's words", `## Core\n\n${SECRET}`],
    ["the dream's mark", `## Core\n\nI keep a careful account. ${DREAM_MARK} a dream]`],
  ] as const) {
    test(`beside the page: a short version carrying ${what} is not kept — the page is, and the note says why`, () => {
      const { c, open: cite, reflection } = setUp();
      const done = c.reflections.finish({
        reflection,
        session: SESSION,
        entry: "Looking back over the last few days, a few things stand out.",
        cites: [cite],
        page: { text: longPage(), cites: [cite], short },
      });
      if (!done.ok) throw new Error(String(done.reason));
      expect(done.outcome.page).toMatchObject({ written: true, reason: "rewritten" });
      expect(c.selfPage()?.body).toBe(longPage());
      expect(c.selfPage()?.short).toBeNull();
      const note = (done.outcome.page as { note?: string }).note ?? "";
      expect(note).toContain("The short version was not kept");
      expect(note).toContain("call finish again with page.short alone");
      // Nothing of it reached the store's page row.
      const id = findPageRow(c.store);
      expect(id).not.toBeNull();
      expect(JSON.stringify(c.store.readProse(id as string).meta)).not.toContain("health scare");
      expect(JSON.stringify(c.store.readProse(id as string).meta)).not.toContain(DREAM_MARK);
    });

    test(`alone, on a second finish: a short version carrying ${what} is refused, and the page written earlier stands`, () => {
      const { c, open: cite, reflection } = setUp();
      const first = c.reflections.finish({
        reflection,
        session: SESSION,
        entry: "Looking back over the last few days, a few things stand out.",
        cites: [cite],
        page: { text: longPage(), cites: [cite] },
      });
      if (!first.ok) throw new Error(String(first.reason));
      const version = c.selfPage()?.version;
      const again = c.reflections.finish({ reflection, session: SESSION, page: { short } });
      if (!again.ok) throw new Error(String(again.reason));
      expect(again.outcome.page.written).toBe(false);
      expect(c.selfPage()?.version).toBe(version);
      expect(c.selfPage()?.short).toBeNull();
    });
  }
});

describe("2. a short version added on its own never reverts a page written in between", () => {
  test("another process rewrites the page while the short version is being gated: the newer page stands, and the short version is refused", () => {
    const s = Store.open({ dir });
    open.push(s);
    const other = Store.open({ dir });
    open.push(other);
    const otherSelf = new Self({ store: other, gate: episodeGate() });
    const real = episodeGate();
    let raced = false;
    const self = new Self({
      store: s,
      // The battery, with the other process's write landing in the window
      // between this process reading the page and writing it back.
      gate: (input) => {
        if (!raced && input.sessionId.startsWith("page-short:")) {
          raced = true;
          expect(otherSelf.revisePage(`${longPage()}\n\nA newer line, from the other process.`, { by: "session", reason: "the other process" }).written).toBe(true);
        }
        return real(input);
      },
    });
    expect(self.revisePage(longPage(), { by: "owner", reason: "first" }).written).toBe(true);
    const added = self.addPageShort("## Core\n\nI keep a careful account.", { by: "owner" });
    expect(raced).toBe(true);
    expect(added.written).toBe(false);
    expect(added.reason).toBe("version-moved");
    // The other process's page is the one standing — not the one read before it.
    expect(self.page()?.body).toContain("A newer line, from the other process.");
    expect(self.page()?.short).toBeNull();
  });
});

describe("3. the wake's own frame around the page is never stored as part of it", () => {
  test("a page copied out of the wake — top line, page, dateline, end line — is stored as the page alone, and the next wake frames it once", () => {
    const c = brain();
    const page = "## Core\n\nI keep a careful account of the studio.\n\n## Lately\n\nThe kiln.";
    expect(c.revisePage(page, { by: "owner", reason: "first" }).written).toBe(true);
    c.rebrief({ budgetBytes: 9_000 });
    const wake = c.store.getMeta(BRIEFING_KEY) ?? "";
    const top = pageTopLine("whole", byteLength(page)) ?? "";
    const from = wake.indexOf(top);
    const to = wake.indexOf(`\n${PAGE_END_LINES.whole}\n`) + PAGE_END_LINES.whole.length + 1;
    expect(from).toBeGreaterThan(0);
    const copied = wake.slice(from, to);
    expect(copied.startsWith(top)).toBe(true);
    expect(copied.endsWith(PAGE_END_LINES.whole)).toBe(true);

    const w = c.revisePage(`${copied}\n\nOne new line.`, { by: "session", reason: "copied from the wake" });
    expect(w.written).toBe(true);
    const stored = c.selfPage()?.body ?? "";
    expect(stored).toBe(`${page}\n\nOne new line.`);

    c.rebrief({ budgetBytes: 9_000 });
    const next = c.store.getMeta(BRIEFING_KEY) ?? "";
    expect(next.split("\n").filter((l) => l.startsWith("(My page, ")).length).toBe(1);
    expect(next.split("\n").filter((l) => l === PAGE_END_LINES.whole).length).toBe(1);
  });

  test("every rung's top and end lines, and the one line, are left out of a page and of a short version; a sentence that only mentions one is kept", () => {
    const c = brain();
    const frame = [
      pageTopLine("short", 7_012) ?? "",
      pageTopLine("outline", 7_012) ?? "",
      pageTopLine("headings", 7_012) ?? "",
      pageTooLargeLine(7_012),
      PAGE_END_LINES.short,
      PAGE_END_LINES.outline,
      PAGE_END_LINES.headings,
    ];
    const kept = `I end my page with a line of my own, not "${PAGE_END_LINES.whole}" — that one is the wake's.`;
    const body = `${frame.join("\n")}\n${longPage()}\n\n${kept}`;
    const short = `${pageTopLine("short", 7_012) ?? ""}\n## Core\n\nI keep a careful account.\n${PAGE_END_LINES.short}`;
    const w = c.revisePage(body, { by: "owner", reason: "frames", short });
    expect(w.written).toBe(true);
    expect(c.selfPage()?.body).toBe(`${longPage()}\n\n${kept}`);
    expect(c.selfPage()?.short?.body).toBe("## Core\n\nI keep a careful account.");
  });

  test("a page stored with its frame before this check prints it once — the wake leaves the stored frame out", () => {
    const c = brain();
    const page = "## Core\n\nI keep a careful account of the studio.";
    expect(c.revisePage(page, { by: "owner", reason: "first" }).written).toBe(true);
    // A page written before the check, frame and all, straight onto its row.
    const id = findPageRow(c.store);
    if (id === null) throw new Error("no page row");
    c.store.revise(id, { body: `${pageTopLine("whole", 70) ?? ""}\n${page}\n${PAGE_END_LINES.whole}`, reason: "an older build" });
    c.rebrief({ budgetBytes: 9_000 });
    const wake = c.store.getMeta(BRIEFING_KEY) ?? "";
    expect(wake).toContain(`${pageTopLine("whole", byteLength(page)) ?? ""}\n${page}\n`);
    expect(wake.split("\n").filter((l) => l.startsWith("(My page, ")).length).toBe(1);
    expect(wake.split("\n").filter((l) => l === PAGE_END_LINES.whole).length).toBe(1);
  });
});

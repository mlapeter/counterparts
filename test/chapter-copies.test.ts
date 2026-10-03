/**
 * CHAPTER COPIES (2026-09-30, U13's "seen alongside"). Every journal chapter is
 * also ingested as an ordinary self-kind memory with the same body, and three
 * things followed from that on the live store:
 *
 *   (a) the copy was untitled — it now keeps its chapter's title;
 *   (b) recall showed a chapter and its own copy as two results — now one (the
 *       chapter), with use credit landing on the copy too;
 *   (c) the `status` census counted every rebuilt copy as an EXIT — now
 *       `replaced`, apart from real exits, from the one table the dashboard's
 *       archive words read too (`core/leaving.ts`).
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Counterpart } from "../src/core/counterpart.js";
import { LEAVING, REMOVED_BY_OWNER, leftAs } from "../src/core/leaving.js";
import type { LeftAs } from "../src/core/leaving.js";
import { REMOVED_REASON } from "../src/core/store/owner-op-seam.js";
import { gatedSal } from "../src/core/recall/index.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";
import { ARCHIVE_WORDS, archiveGroup } from "../src/adapters/dashboard/web/views/archive-words.js";

const ENV = "COUNTERPARTS_DATA_DIR";
let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-chapter-copies-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
});

function server(): McpServer {
  const s = openServer({ dir, session: "sess_copies", scope: "/scope/one", owner: true });
  open.push(s.counterpart);
  return s;
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent;
}

/** Enough unremarkable memories that the gate leaves the cold-start regime. */
const FILLER: readonly string[] = [
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
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
  "Planted three tomato seedlings in the planter.",
  "Fixed the wobbling chair leg with a shim.",
];

function seed(c: Counterpart): void {
  for (const body of FILLER) c.store.put({ type: "memory", kind: "fact", body });
}

/** One chapter, ingested: the `epi_` row and its self-kind copy. */
function chapterWithCopy(c: Counterpart, text: string, title?: string): { episodeId: string; copyId: string } {
  c.episodeAsk("s1", { turns: 12, bytes: 9_000 });
  const written = c.appendEpisode("s1", text, title === undefined ? {} : { title });
  const out = c.ingestEpisode({ sessionId: "s1" });
  expect(out.ingested).toBe(true);
  return { episodeId: written.episodeId as string, copyId: out.memoryId as string };
}

describe("(a) the copy keeps its chapter's title", () => {
  test("a titled chapter's copy carries the same title; an untitled one stays untitled", () => {
    const s = server();
    const { episodeId, copyId } = chapterWithCopy(s.counterpart, "The afternoon the lighthouse keeper wrote back.", "The lighthouse letter");
    expect(s.counterpart.store.readProse(episodeId).title).toBe("The lighthouse letter");
    expect(s.counterpart.store.readProse(copyId).title).toBe("The lighthouse letter");
    // The link recall reads is the row's own columns.
    const row = s.counterpart.store.row(copyId);
    expect(row?.source).toBe("episode");
    expect(row?.origin_ref).toBe(episodeId);
  });

  test("a short title is kept — the content floor is for bodies, not titles (review B3)", () => {
    const s = server();
    const { copyId } = chapterWithCopy(s.counterpart, "The release went out before lunch and nobody paged anyone.", "Launch day");
    expect(s.counterpart.store.readProse(copyId).title).toBe("Launch day");
  });

  test("a credential in a title is redacted on the copy", () => {
    const s = server();
    const { copyId } = chapterWithCopy(s.counterpart, "Rotated the deploy key and slept well after.", "Key AKIAIOSFODNN7EXAMPLE rotated");
    const title = s.counterpart.store.readProse(copyId).title ?? "";
    expect(title).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(title).toContain("rotated");
  });

  test("no title is invented for an untitled chapter", () => {
    const s = server();
    const { copyId } = chapterWithCopy(s.counterpart, "An untitled evening with the quiet kind of progress.");
    expect(s.counterpart.store.readProse(copyId).title ?? null).toBe(null);
  });
});

describe("(b) recall shows a chapter and its own copy as ONE result", () => {
  test("deliberate recall returns the chapter, not the copy, and the freed slot goes on", async () => {
    const s = server();
    seed(s.counterpart);
    const { episodeId, copyId } = chapterWithCopy(
      s.counterpart,
      "Walked the zqharbour breakwater at dusk and finally understood the tide tables.",
      "The zqharbour evening",
    );
    const other = s.counterpart.store.put({
      type: "memory",
      kind: "fact",
      body: "The zqharbour ferry runs twice a day in winter.",
    });
    // Facts mode (2026-10-03) rebuilds the fold: a chapter and its own copy
    // are one result, the chapter.
    const result = payload(await s.call("recall", { question: "zqharbour", mode: "facts" }));
    const ids = result["ids"] as string[];
    expect(ids).toContain(episodeId);
    expect(ids).not.toContain(copyId);
    expect(ids).toContain(other);
    // The chapter is labeled journal, under its own title.
    const answer = result["answer"] as string;
    expect(answer).toContain(`[journal] The zqharbour evening · ${episodeId}`);
    expect(answer).not.toContain(copyId);
  });

  test("the ambient path shares the step: one of the pair is a candidate, never both", () => {
    const s = server();
    seed(s.counterpart);
    const { episodeId, copyId } = chapterWithCopy(s.counterpart, "The zqkiln firing cracked two bowls and saved the third.");
    const built = s.counterpart.recall.build({ sessionId: "amb", text: "the zqkiln firing" });
    const seen = built.decision.verdicts.map((v) => v.id);
    expect(seen).toContain(episodeId);
    expect(seen).not.toContain(copyId);
  });

  test("a copy whose chapter was not reached stays itself", () => {
    const s = server();
    seed(s.counterpart);
    const { episodeId, copyId } = chapterWithCopy(s.counterpart, "The zqloom threads held under tension.");
    s.counterpart.store.archive(episodeId, "test-archived-chapter");
    const built = s.counterpart.recall.build({ sessionId: "amb2", text: "zqloom threads" });
    const seen = built.decision.verdicts.map((v) => v.id);
    expect(seen).toContain(copyId);
  });

  test("use credit for a chapter RECALL SHOWED also lands on its copy", () => {
    const s = server();
    seed(s.counterpart);
    const { episodeId, copyId } = chapterWithCopy(s.counterpart, "The zqcanal lock opened on the third try.");
    // A use on the day a memory was born credits nothing (physics' birth-day rule).
    s.counterpart.store.advanceClock("2030-01-01");
    // The ambient turn shows the pair — as the chapter.
    const shown = s.counterpart.recall.recall({ sessionId: "credit-sess", text: "the zqcanal lock" });
    expect([...shown.decision.surfaced, ...shown.decision.footnotes]).toContain(episodeId);
    const usesBefore = s.counterpart.store.row(copyId)?.uses ?? 0;
    const r = s.counterpart.resolveUse("credit-sess", episodeId, "referenced");
    expect(r.reason).toBe("credited");
    const after = s.counterpart.store.row(copyId)?.uses ?? 0;
    expect(after).toBeGreaterThan(usesBefore);
    // Once a day, per copy: a second use the same day does not add to it.
    s.counterpart.resolveUse("credit-sess", episodeId, "referenced");
    expect(s.counterpart.store.row(copyId)?.uses).toBe(after);
  });

  test("a chapter used without recall showing it (the wake, the chapter tool) credits the chapter alone", () => {
    const s = server();
    seed(s.counterpart);
    const { episodeId, copyId } = chapterWithCopy(s.counterpart, "The zqferry left an hour late.");
    s.counterpart.store.advanceClock("2030-01-01");
    const usesBefore = s.counterpart.store.row(copyId)?.uses ?? 0;
    expect(s.counterpart.resolveUse("wake-sess", episodeId, "referenced").reason).toBe("credited");
    expect(s.counterpart.store.row(copyId)?.uses).toBe(usesBefore);
  });

  test("the pair keeps the copy's salience (S2) and the copy's links (S1)", () => {
    const s = server();
    seed(s.counterpart);
    const c = s.counterpart;
    const { episodeId, copyId } = chapterWithCopy(c, "The zqgarden gate was painted green at last.");
    // Salience sits on the copy, the row the ingestion minted.
    c.store.updatePhysics(copyId, { salience: { novelty: 1, relevance: 1, emotional: 0, predictive: 1 } });
    const copyOwn = gatedSal(c.store.physicsOf(copyId), false);
    expect(copyOwn).toBeGreaterThan(gatedSal(c.store.physicsOf(episodeId), false));
    const pairSal = c.recall.build({ sessionId: "sal", text: "zqgarden gate painted" }).decision.verdicts.find((v) => v.id === episodeId)?.sal;
    expect(pairSal).toBeCloseTo(copyOwn, 6);

    // A link that points at the COPY reaches the pair: a hop to the copy lands on the chapter.
    const other = c.store.put({ type: "memory", kind: "fact", body: "A zqgarden gate needs two coats of paint in the cold." });
    let received = 0;
    const built = c.recall.build({
      sessionId: "hop",
      text: "zqgarden gate",
      spread: (seeds) => {
        const seeded = new Set(seeds.map((x) => x.id));
        // The copy seeds beside its chapter; the neighbour hands the copy something.
        if (seeded.has(copyId)) received += 1;
        return { contributions: seeded.has(other) ? [] : [{ id: copyId, activation: 0.5, from: { [other]: 0.5 } }] };
      },
    });
    expect(received).toBe(1);
    expect(built.decision.verdicts.map((v) => v.id)).not.toContain(copyId);
  });
});

describe("(c) the census counts replaced copies apart from real exits", () => {
  test("a regrown copy is `replaced`, a removal is still `exited`", async () => {
    const s = server();
    const c = s.counterpart;
    chapterWithCopy(c, "The morning part of the zqorchard day.");
    // The chapter grows; the next ingestion rebuilds the copy and archives the old one.
    c.episodeAsk("s1", { turns: 40, bytes: 40_000 });
    c.appendEpisode("s1", "And the evening, which mattered more.");
    const grown = c.ingestEpisode({ sessionId: "s1" });
    expect(grown.reason).toBe("regrown");
    expect(grown.archived.length).toBe(1);
    expect(c.store.row(grown.archived[0] as string)?.archived_reason).toBe("episode-regrown");

    const removed = c.store.put({ type: "memory", kind: "self", body: "A self-note the owner took back." });
    c.store.appendRemovalRecord({ memoryId: removed, stage: "requested", actor: "owner" });
    c.store.appendRemovalRecord({ memoryId: removed, stage: "complete", actor: "owner" });

    const census = payload(await s.call("status", {}));
    const symmetry = census["symmetry"] as Record<string, Record<string, number>>;
    expect(symmetry["created"]?.["self"]).toBe(3);
    expect(symmetry["replaced"]?.["self"]).toBe(1);
    expect(symmetry["exited"]?.["self"]).toBe(1);
    expect(String(census["counts"])).toContain("replaced");
  });

  test("an unknown reason is never filed as replaced unless something superseded it", () => {
    expect(leftAs("episode-regrown")).toBe("replaced");
    expect(leftAs("dream-merge")).toBe("replaced");
    expect(leftAs("corrected")).toBe("replaced");
    expect(leftAs("pruned")).toBe("let-go");
    expect(leftAs(REMOVED_BY_OWNER)).toBe("removed");
    expect(leftAs("something-new")).toBe(null);
    expect(leftAs("something-new", true)).toBe("replaced");
    expect(leftAs("toString")).toBe(null);
    expect(leftAs(null)).toBe(null);
  });

  test("every archive reason the SOURCE writes has an entry — a new one fails here, not silently as an exit", () => {
    const root = join(import.meta.dir, "..", "src");
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const path = join(d, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith(".ts")) files.push(path);
      }
    };
    walk(root);
    const found = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // `store.archive(id, "literal")`, SQL that sets or matches a reason, the
      // reason constants, and `supersede`'s default.
      for (const m of src.matchAll(/\.archive\([^,()]+,\s*"([^"]+)"/g)) found.add(m[1] as string);
      for (const m of src.matchAll(/archived_reason = '([^']+)'/g)) found.add(m[1] as string);
      for (const m of src.matchAll(/\b[A-Z_]*_REASON\s*[:=]\s*"([^"]+)"/g)) found.add(m[1] as string);
      for (const m of src.matchAll(/reason = "([^"]+)"\): string/g)) found.add(m[1] as string);
    }
    found.delete("reason"); // self/page.ts#PAGE_META_REASON: a meta key, not an archive reason
    expect(found.size).toBeGreaterThan(8);
    for (const reason of found) expect(`${reason}: ${Object.hasOwn(LEAVING, reason)}`).toBe(`${reason}: true`);
  });

  test("the dashboard's archive words and the census read ONE table", () => {
    expect(REMOVED_BY_OWNER).toBe(REMOVED_REASON);
    const worded = new Set(ARCHIVE_WORDS.map((w) => w.reason));
    expect([...worded].sort()).toEqual(Object.keys(LEAVING).sort());
    for (const w of ARCHIVE_WORDS) {
      expect(w.group).toBe(LEAVING[w.reason] as LeftAs);
      expect(archiveGroup(w.reason)).toBe(leftAs(w.reason));
    }
  });
});

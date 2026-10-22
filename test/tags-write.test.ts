/**
 * TAGS, THE WRITE SIDE (wave 2 lane B, 2026-10-21; store v14's `memory_tags`).
 * Covered:
 *
 *   - `remember` and each `session_end` entry take an optional `tags` list,
 *     normalized and screened at the door, loose first: a tag that cannot be
 *     kept is dropped and said, and the memory lands all the same;
 *   - the tags land in the SAME transaction as the row (`insertOne`), so a
 *     write refused leaves none behind;
 *   - a revision by `updates:` carries its memory's tags over unless it sends
 *     its own, and `null` sends none;
 *   - the tool schemas publish the field;
 *   - NOTHING READS THEM YET: a recall over the same memories returns the same
 *     results with and without tags (lane E brings tags to recall).
 *
 * Hermetic: a fresh temp dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TOOLS, openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";
import { readTags, TAGS_PER_MEMORY } from "../src/adapters/mcp/server-args.js";
import { run } from "../src/adapters/cli/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { UNRESOLVED_META_KEY } from "../src/core/mint.js";
import { StoreError } from "../src/core/store/index.js";

let root: string;
let clock = Date.parse("2026-10-21T09:00:00Z");
const open: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-tags-write-"));
  clock = Date.parse("2026-10-21T09:00:00Z");
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

function server(name = "store", session = "sess_tags"): McpServer {
  const s = openServer({ dir: join(root, name), snapshotsDir: join(root, `${name}-snaps`), session, scope: "/proj/one", now: () => clock });
  open.push(s.counterpart);
  return s;
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent;
}

function tagsOn(s: McpServer, id: string): { tag: string; via: string }[] {
  return s.counterpart.store.tagsOf(id).map((t) => ({ tag: t.tag, via: t.via }));
}

function countTagRows(s: McpServer): number {
  return s.counterpart.store.tagCounts().reduce((n, t) => n + t.memories, 0);
}

describe("the door reads tags loose first", () => {
  test("normalized, deduplicated; a comma-separated string is its parts", () => {
    expect(readTags({ tags: ["  Taxes ", "taxes", "Back  ups", ""] })).toEqual({ sent: ["taxes", "back ups"], dropped: [] });
    expect(readTags({ tags: "taxes, Katie ,castle game" })).toEqual({ sent: ["taxes", "katie", "castle game"], dropped: [] });
  });

  test("absent is not sent; null or an empty list is sent as none; all blanks are not sent", () => {
    expect(readTags({})).toEqual({ dropped: [] });
    expect(readTags({ tags: null })).toEqual({ sent: null, dropped: [] });
    expect(readTags({ tags: [] })).toEqual({ sent: null, dropped: [] });
    // Review of #570: blanks are not an explicit "none", so a revision still inherits.
    expect(readTags({ tags: "" })).toEqual({ dropped: [] });
    expect(readTags({ tags: ["  ", ""] })).toEqual({ dropped: [] });
  });

  test("what cannot be kept is dropped and said; all dropped reads as not sent", () => {
    const read = readTags({ tags: ["taxes", 7, "x".repeat(80), "AKIAIOSFODNN7EXAMPLE"] });
    expect(read.sent).toEqual(["taxes"]);
    expect(read.dropped).toHaveLength(3);
    expect(read.dropped.join(" ")).toContain("not text");
    expect(read.dropped.join(" ")).toContain("longer than");
    expect(read.dropped.join(" ")).toContain("secret");
    const none = readTags({ tags: [7] });
    expect(none.sent).toBeUndefined();
    expect(none.dropped).toHaveLength(1);
  });

  test(`past ${String(TAGS_PER_MEMORY)} tags the rest are dropped and named`, () => {
    const many = Array.from({ length: TAGS_PER_MEMORY + 2 }, (_, i) => `topic ${String(i)}`);
    const read = readTags({ tags: many });
    expect(read.sent).toHaveLength(TAGS_PER_MEMORY);
    expect(read.dropped[0]).toContain(`"topic ${String(TAGS_PER_MEMORY)}"`);
  });
});

describe("remember and session_end write tags with the row", () => {
  test("remember: the tags land via write, and the answer says what was stored", async () => {
    const s = server();
    const out = payload(await s.call("remember", { text: "Mike filed the quarterly estimated taxes on time this quarter.", tags: ["Taxes", "quarterly estimates", 3] }));
    const id = out["id"] as string;
    expect(out["stored"]).toBe(true);
    expect(tagsOn(s, id)).toEqual([
      { tag: "quarterly estimates", via: "write" },
      { tag: "taxes", via: "write" },
    ]);
    expect(out["tags"]).toEqual({ stored: true, tags: ["taxes", "quarterly estimates"], dropped: ["a tag that was not text"] });
  });

  test("remember with no tags writes none and says nothing about them", async () => {
    const s = server();
    const out = payload(await s.call("remember", { text: "The backup drive is the grey one on the shelf." }));
    expect(tagsOn(s, out["id"] as string)).toEqual([]);
    expect(out["tags"]).toBeUndefined();
  });

  test("a write that does not land leaves no tags: a duplicate, and a refusal", async () => {
    const s = server();
    const text = "The castle game save lives in the second slot.";
    await s.call("remember", { text, tags: ["castle game"] });
    const before = countTagRows(s);
    const dup = payload(await s.call("remember", { text, tags: ["castle game", "saves"] }));
    expect(dup["stored"]).toBe(false);
    expect(dup["tags"]).toEqual({ stored: false, reason: "memory-not-stored", note: "This memory was already stored; these tags were not added to it." });
    const refused = payload(await s.call("remember", { text: "  ", tags: ["nothing"] }));
    expect(refused["stored"]).not.toBe(true);
    expect(countTagRows(s)).toBe(before);
    expect(s.counterpart.store.memoriesTagged("saves")).toEqual([]);
    expect(s.counterpart.store.memoriesTagged("nothing")).toEqual([]);
  });

  test("the store writes them inside the row's own transaction: an id refused leaves no tags", () => {
    const s = server();
    const store = s.counterpart.store;
    const id = store.put({ type: "memory", kind: "fact", body: "Katie's birthday dinner is at the usual place.", tags: ["Katie", "birthdays"] });
    expect(store.tagsOf(id).map((t) => t.tag)).toEqual(["birthdays", "katie"]);
    expect(() => store.put({ id, type: "memory", kind: "fact", body: "Something else entirely.", tags: ["other"] })).toThrow(StoreError);
    expect(store.memoriesTagged("other")).toEqual([]);
    // A non-memory row takes none (memories only, like the subject links).
    const card = store.put({ type: "schema", kind: "person", body: "Katie: a person.", meta: { role: "entity", name: "Katie", aliases: [] }, tags: ["katie"] });
    expect(store.tagsOf(card)).toEqual([]);
  });

  test("session_end: each entry its own tags, isolated", async () => {
    const s = server();
    const out = payload(
      await s.call("session_end", {
        memories: [
          { content: "We moved the nightly backups to run at two in the morning.", tags: ["backups", "nightly run"] },
          { content: "Katie asked about the castle game's next level.", tags: "katie, castle game" },
          { content: "The tax extension was not needed after all." },
        ],
      }),
    );
    const outcomes = out["outcomes"] as Record<string, unknown>[];
    expect(outcomes).toHaveLength(3);
    const [a, b, c] = outcomes.map((o) => o["id"] as string);
    expect(tagsOn(s, a as string).map((t) => t.tag)).toEqual(["backups", "nightly run"]);
    expect(tagsOn(s, b as string).map((t) => t.tag)).toEqual(["castle game", "katie"]);
    expect(tagsOn(s, c as string)).toEqual([]);
    expect(outcomes[1]?.["tags"]).toEqual({ stored: true, tags: ["katie", "castle game"] });
    expect(outcomes[2]?.["tags"]).toBeUndefined();
  });
});

describe("the core screens tags at its own seam (review of #570)", () => {
  test("an embedder's submitJot: a secret and an overlong tag are dropped, the rest kept", async () => {
    const s = server();
    const c = s.counterpart;
    const out = await c.submitJot(
      { content: "The quarterly estimates went out from the business account." },
      { session: "sess_embed", scope: "/proj/one", tags: ["AKIAIOSFODNN7EXAMPLE", "x".repeat(200), "Taxes"] },
    );
    expect(out.deposited).toBe(true);
    const id = out.memoryId as string;
    expect(c.store.tagsOf(id).map((t) => t.tag)).toEqual(["taxes"]);
    expect(out.tags?.tags).toEqual(["taxes"]);
    expect(out.tags?.dropped).toHaveLength(2);
    expect(JSON.stringify(out.tags)).not.toContain("akia");
    expect(JSON.stringify(out.tags)).not.toContain("AKIA");
    expect(c.store.memoriesTagged("akiaiosfodnn7example")).toEqual([]);
  });

  test("a revision whose sent tags are all blank or all dropped still inherits", async () => {
    const s = server();
    const first = payload(await s.call("remember", { text: "The boiler service is every October.", tags: ["boiler", "house"] }));
    const a = first["id"] as string;
    clock += 60_000;
    const second = payload(await s.call("remember", { text: "The boiler service moved to every November.", updates: a, tags: "" }));
    expect(tagsOn(s, second["id"] as string).map((t) => t.tag)).toEqual(["boiler", "house"]);
    clock += 60_000;
    const embedded = await s.counterpart.submitJot(
      { content: "The boiler service is every November, booked with the same firm.", updates: second["id"] as string },
      { session: "sess_embed", scope: "/proj/one", tags: ["  ", "AKIAIOSFODNN7EXAMPLE"] },
    );
    expect(s.counterpart.store.tagsOf(embedded.memoryId as string).map((t) => t.tag)).toEqual(["boiler", "house"]);
    expect(embedded.tags?.from).toBe(second["id"] as string);
    expect(embedded.tags?.dropped).toEqual(["a tag that looked like a secret"]);
  });
});

describe("a revision keeps its memory's tags unless it sends its own", () => {
  test("carried over by updates; own tags win; null sends none; the old memory keeps its own", async () => {
    const s = server();
    const first = payload(await s.call("remember", { text: "The gym moved to seven in the morning.", tags: ["gym", "mornings"] }));
    const a = first["id"] as string;

    clock += 60_000;
    const second = payload(await s.call("remember", { text: "The gym moved again, to six in the morning.", updates: a }));
    const b = second["id"] as string;
    expect(tagsOn(s, b)).toEqual([
      { tag: "gym", via: "carried" },
      { tag: "mornings", via: "carried" },
    ]);
    expect(second["tags"]).toEqual({ stored: true, tags: ["gym", "mornings"], carriedFrom: a });
    expect(tagsOn(s, a).map((t) => t.tag)).toEqual(["gym", "mornings"]);

    clock += 60_000;
    const third = payload(await s.call("remember", { text: "The gym is at half past six now, Mondays only.", updates: b, tags: ["gym", "mondays"] }));
    expect(tagsOn(s, third["id"] as string)).toEqual([
      { tag: "gym", via: "write" },
      { tag: "mondays", via: "write" },
    ]);

    clock += 60_000;
    const fourth = payload(await s.call("remember", { text: "No gym this month at all, the membership is paused.", updates: third["id"] as string, tags: null }));
    expect(tagsOn(s, fourth["id"] as string)).toEqual([]);
    expect(fourth["tags"]).toEqual({ stored: true, tags: [] });
  });

  test("a revision of a memory with no tags carries none and says nothing", async () => {
    const s = server();
    const first = payload(await s.call("remember", { text: "The ferry runs twice a day in winter." }));
    clock += 60_000;
    const second = payload(await s.call("remember", { text: "The ferry runs three times a day from March.", updates: first["id"] as string }));
    expect(tagsOn(s, second["id"] as string)).toEqual([]);
    expect(second["tags"]).toBeUndefined();
  });
});

describe("the tool schemas", () => {
  test("remember and each session_end entry publish tags", () => {
    const note = JSON.stringify(TOOLS.find((t) => t.name === "remember")?.inputSchema);
    const end = JSON.stringify(TOOLS.find((t) => t.name === "session_end")?.inputSchema);
    for (const text of [note, end]) {
      expect(text).toContain('"tags"');
      expect(text).toContain("Not a date");
    }
  });
});

describe("nothing reads tags yet (lane E)", () => {
  const BODIES = [
    { title: "Quarterly taxes", body: "Mike pays the quarterly estimated taxes from the business account in April.", tags: ["taxes", "money", "backups"] },
    { title: "Backup drive", body: "The nightly backups go to the grey drive and a cloud copy on Sundays.", tags: ["backups", "taxes"] },
    // Open, so it reaches the wake's "Still open" lane (follow-up to the review of #570).
    { title: "Castle game", body: "Katie and Mike are building a castle game together on weekends; the next level is still undecided.", tags: ["castle game", "katie", "taxes"], open: true },
    { title: "Ferry times", body: "The harbour ferry runs twice a day in winter and more often from March.", tags: ["ferry", "backups"] },
  ];

  function seed(name: string, tagged: boolean): McpServer {
    const s = server(name);
    for (const m of BODIES) {
      s.counterpart.store.put({
        type: "memory",
        kind: "fact",
        title: m.title,
        body: m.body,
        salience: { novelty: null, relevance: 0.7, emotional: 0.3, predictive: 0.5 },
        physics: { birthDay: 0, lastUsedDay: 0 },
        ...("open" in m ? { meta: { [UNRESOLVED_META_KEY]: true } } : {}),
        ...(tagged ? { tags: m.tags } : {}),
      });
    }
    return s;
  }

  function byTitle(c: Counterpart, ids: readonly string[]): string[] {
    return ids.map((id) => c.store.row(id)?.title ?? id);
  }

  test("the ambient recall and a facts question return the same memories with and without tags", async () => {
    const plainServer = seed("plain", false);
    const taggedServer = seed("tagged", true);
    const plain = plainServer.counterpart;
    const tagged = taggedServer.counterpart;
    expect(tagged.store.tagCounts().length).toBeGreaterThan(0);
    // The wake reads the same, ids aside (review of #570): both stores live a
    // boundary — the night's tag work runs on the tagged one — and the open
    // memory must be in it, so the comparison is not of two empty wakes.
    const masked = (t: string): string => t.replace(/\b(mem|sch|epi)_[A-Za-z0-9]+/g, "<id>");
    const wake = (c: Counterpart): string => masked(c.wake(9_000, { date: "2026-10-21" }, { scope: "/proj/one", session: "sess_wake" }).text);
    // A first wake reports the host's budget, which the boundary's render needs.
    wake(plain);
    wake(tagged);
    await plain.sessionEnd({ date: "2026-10-21" });
    await tagged.sessionEnd({ date: "2026-10-21" });
    const plainWake = wake(plain);
    expect(plainWake).toContain("castle game together");
    expect(wake(tagged)).toEqual(plainWake);
    let reached = 0;
    for (const text of ["when do the quarterly taxes get paid", "where do the backups go", "the castle game with Katie"]) {
      const p = plain.recallForTurn({ sessionId: "s1", text }).decision;
      const t = tagged.recallForTurn({ sessionId: "s1", text }).decision;
      reached += t.surfaced.length + t.footnotes.length;
      expect(byTitle(tagged, t.surfaced)).toEqual(byTitle(plain, p.surfaced));
      expect(byTitle(tagged, t.footnotes)).toEqual(byTitle(plain, p.footnotes));
    }
    expect(reached).toBeGreaterThan(0);
    const ask = async (s: McpServer, c: Counterpart): Promise<string[]> => {
      const ids = payload(await s.call("recall", { question: "taxes", mode: "facts" }))["ids"] as string[];
      return byTitle(c, ids);
    };
    const asked = await ask(taggedServer, tagged);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked).toEqual(await ask(plainServer, plain));
    // Meaning mode too (review of #570), its answer word for word, ids aside.
    const mean = async (s: McpServer): Promise<string> =>
      masked(String(payload(await s.call("recall", { question: "what has the castle game with Katie been", mode: "meaning" }))["answer"] ?? ""));
    const meant = await mean(taggedServer);
    expect(meant.length).toBeGreaterThan(0);
    expect(meant).toEqual(await mean(plainServer));
  });
});

describe("counterparts note takes tags (2026-10-22)", () => {
  test("--tags a,b lands through the same read and write path a session's remember uses; a secret is left off and said", async () => {
    const dir = join(root, "console");
    Counterpart.open({ dir, snapshotsDir: join(root, "console-snaps") }).close();
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
    const env = { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };
    const code = await run(["note", "Katie planted the garlic in the raised bed by the shed.", "--tags", "Garden, katie,AKIAIOSFODNN7EXAMPLE", "--dir", dir], { io, env, home: join(root, "home") });
    expect(err).toEqual([]);
    expect(code).toBe(0);
    const id = /^Remembered (mem_\S+) /.exec(out.find((l) => l.startsWith("Remembered ")) ?? "")?.[1] as string;
    expect(out).toContain("  Tags: garden, katie.");
    expect(out.find((l) => l.startsWith("  Tags left off: "))).toContain("secret");
    expect(out.join("\n")).not.toContain("AKIA");
    const c = Counterpart.open({ dir, snapshotsDir: join(root, "console-snaps") });
    open.push(c);
    expect(c.store.tagsOf(id).map((t) => `${t.tag}:${t.via}`)).toEqual(["garden:write", "katie:write"]);

    // Without the flag, no tags, as before.
    const plain: string[] = [];
    expect(await run(["note", "The shed roof needs new felt before the winter rains.", "--dir", dir], { io: { out: (l) => plain.push(l), err: () => undefined }, env, home: join(root, "home") })).toBe(0);
    const other = /^Remembered (mem_\S+) /.exec(plain.find((l) => l.startsWith("Remembered ")) ?? "")?.[1] as string;
    expect(plain.some((l) => l.includes("Tags"))).toBe(false);
    expect(c.store.tagsOf(other)).toEqual([]);
  });
});

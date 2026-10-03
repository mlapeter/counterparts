/**
 * THE WRITE SIDE OF DELIBERATE RECALL (Release A, 2026-10-03, schema v12).
 * What is written and stored changes; recall's behaviour does not. Covered:
 *
 *   - store v12: three columns on `memories` and `versions`, the
 *     `memory_subjects` table, a fresh open and a migrated one converging, the
 *     upgrade's moment recorded, and an observer still reading a v11 file;
 *   - the writer's three fields on `note`, `session_end` entries and dream
 *     gists — loose-first (an unreadable one is dropped and said, the memory
 *     kept), carried over by an `updates` revision unless sent;
 *   - subject links: at write, at a card's birth, on a revise of the words,
 *     gone with a removal, and the once-per-store backfill; the scanner the
 *     backfill uses gives exactly `matchesIn`'s hits;
 *   - chapter addresses `epi_…#N`: parsed, resolved to heading, text, span and
 *     the session's memories, from stored moments or from versions;
 *   - doctor's informational `Write fields` line.
 *
 * Hermetic: a fresh temp dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeFieldFindings } from "../src/adapters/claude-code/doctor.js";
import { TOOLS, openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";
import { Counterpart, SUBJECTS_BACKFILL_META } from "../src/core/counterpart.js";
import { AliasIndex } from "../src/core/schemas/aliases.js";
import {
  CHAPTER_AT_META,
  CHAPTER_MOMENT_GRACE_MS,
  chapterAddress,
  parseChapterAddress,
  resolveChapter,
} from "../src/core/self/index.js";
import {
  OBSERVER_READ_FLOOR,
  SCHEMA_VERSION,
  Store,
  V12_UPGRADE_KEY,
  paths,
} from "../src/core/store/index.js";
import { chaseRemoved } from "../src/core/store/owner-op-seam.js";

let root: string;
let dir: string;
const open: { close(): void }[] = [];
let clock = Date.parse("2026-10-03T09:00:00Z");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-write-side-"));
  dir = join(root, "store");
  clock = Date.parse("2026-10-03T09:00:00Z");
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
  const c = Counterpart.open({ dir, snapshotsDir: join(root, "snaps"), owner: true, now: () => clock });
  open.push(c);
  return c;
}

function server(session = "sess_write_side"): McpServer {
  const s = openServer({ dir, snapshotsDir: join(root, "snaps"), session, scope: "/proj/one", owner: true, now: () => clock });
  open.push(s.counterpart);
  return s;
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent;
}

function cols(path: string, table: string): string {
  const d = new Database(path, { readonly: true });
  try {
    return JSON.stringify(d.query(`PRAGMA table_info(${table})`).all());
  } finally {
    d.close();
  }
}

/** A store made by this build, turned back into a v11 file. */
function v11Store(): string {
  const s = Store.open({ dir, snapshotsDir: join(root, "snaps") });
  const id = s.put({ type: "memory", kind: "fact", body: "Mira moved the standup to nine on Mondays." });
  s.close();
  const db = new Database(paths.operational(dir));
  for (const t of ["memories", "versions"]) {
    for (const c of ["status", "said_by", "occurred_on"]) db.run(`ALTER TABLE ${t} DROP COLUMN ${c}`);
  }
  db.run("DROP TABLE memory_subjects");
  db.run("DELETE FROM meta WHERE key = ?", [V12_UPGRADE_KEY]);
  db.run("UPDATE meta SET value = '11' WHERE key = 'schemaVersion'");
  db.close();
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════
// store v12
// ═══════════════════════════════════════════════════════════════════════════

describe("store v12", () => {
  test("the version is 12 and the observer floor stays at 11", () => {
    expect(SCHEMA_VERSION).toBe(12);
    expect(OBSERVER_READ_FLOOR).toBe(11);
  });

  test("a v11 store migrates after a copy: the three columns, the link table, the upgrade's moment; fresh and migrated converge", () => {
    const id = v11Store();
    // An observer reads the v11 file as it stands (the floor did not move).
    const reader = Store.open({ dir, observer: true });
    expect(reader.getMeta("schemaVersion")).toBe("11");
    expect(reader.row(id)?.body).toContain("Mira");
    expect(reader.writeFieldShare(null)).toBeNull();
    expect(reader.subjectsOf(id)).toEqual([]);
    expect(writeFieldFindings(reader)).toEqual([]);
    reader.close();

    const s = Store.open({ dir, snapshotsDir: join(root, "snaps"), now: () => clock });
    open.push(s);
    expect(s.getMeta("schemaVersion")).toBe("12");
    const up = JSON.parse(s.getMeta(V12_UPGRADE_KEY) ?? "{}") as Record<string, unknown>;
    expect(up["from"]).toBe("11");
    expect(up["memories"]).toBe(1);
    expect(typeof up["at"]).toBe("number");
    const row = s.row(id);
    expect(row?.occurred_on).toBeNull();
    expect(row?.said_by).toBeNull();
    expect(row?.status).toBeNull();
    s.close();
    open.splice(0);

    const fresh = join(root, "fresh");
    Store.open({ dir: fresh, snapshotsDir: join(root, "snaps2") }).close();
    for (const t of ["memories", "versions", "memory_subjects"]) {
      expect(cols(paths.operational(dir), t)).toBe(cols(paths.operational(fresh), t));
    }
  });

  test("put, revise and the versions carry the three fields; a revise can clear one", () => {
    const s = Store.open({ dir, now: () => clock });
    open.push(s);
    const id = s.put({ type: "memory", kind: "fact", body: "The gym moved to six in the morning.", occurredOn: "2026-09-28", saidBy: "owner", status: "done" });
    expect([s.row(id)?.occurred_on, s.row(id)?.said_by, s.row(id)?.status]).toEqual(["2026-09-28", "owner", "done"]);
    s.revise(id, { body: "The gym moved to six in the morning, from seven.", status: null });
    expect([s.row(id)?.occurred_on, s.row(id)?.said_by, s.row(id)?.status]).toEqual(["2026-09-28", "owner", null]);
    const v = s.versions(id)[0];
    expect([v?.occurred_on, v?.said_by, v?.status]).toEqual(["2026-09-28", "owner", "done"]);
    // The belt: an unreadable date or an unknown word stores NULL, never refuses.
    const loose = s.put({ type: "memory", kind: "fact", body: "Something with a bad date on it.", occurredOn: "last week", saidBy: "nobody" as never });
    expect([s.row(loose)?.occurred_on, s.row(loose)?.said_by]).toEqual([null, null]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// the write tools
// ═══════════════════════════════════════════════════════════════════════════

describe("the three fields on note and session_end", () => {
  test("note stores them, says what it stored, and a revision carries them over unless sent", async () => {
    const s = server();
    const first = payload(
      await s.call("note", { text: "Mike said the gym moved from seven to six in the morning.", occurredOn: "2026-09-28", saidBy: "owner", status: "done" }),
    );
    expect(first["stored"]).toBe(true);
    expect(first["facts"]).toEqual({ stored: true, occurredOn: "2026-09-28", saidBy: "owner", status: "done" });
    const id = first["id"] as string;
    expect(s.counterpart.store.row(id)?.said_by).toBe("owner");

    const second = payload(await s.call("note", { text: "The gym is at six now, and on Saturdays at eight.", updates: id, status: "planned" }));
    expect(second["stored"]).toBe(true);
    const next = second["id"] as string;
    const row = s.counterpart.store.row(next);
    expect([row?.occurred_on, row?.said_by, row?.status]).toEqual(["2026-09-28", "owner", "planned"]);
    expect(second["facts"]).toMatchObject({ stored: true, carriedOver: ["occurredOn", "saidBy"], from: id });
    // The old memory keeps its own three: nothing moves.
    expect(s.counterpart.store.row(id)?.occurred_on).toBe("2026-09-28");

    // Null is "none": nothing is carried for it.
    const third = payload(await s.call("note", { text: "The gym time is not settled after all, ask again.", updates: next, occurredOn: null }));
    expect(s.counterpart.store.row(third["id"] as string)?.occurred_on).toBeNull();
    expect(s.counterpart.store.row(third["id"] as string)?.said_by).toBe("owner");
  });

  test("an unreadable date or an unknown word is dropped and said; the memory is stored all the same", async () => {
    const s = server();
    const out = payload(
      await s.call("note", { text: "We shipped the dashboard fix to everyone this morning.", occurredOn: "last week", saidBy: "the owner", status: "done" }),
    );
    expect(out["stored"]).toBe(true);
    const facts = out["facts"] as Record<string, unknown>;
    expect(facts["status"]).toBe("done");
    const dropped = facts["dropped"] as { field: string; note: string }[];
    expect(dropped.map((d) => d.field)).toEqual(["occurredOn", "saidBy"]);
    expect(dropped[0]?.note).toContain("last week");
    expect(dropped[0]?.note).toContain('"2026-09-24"');
    const row = s.counterpart.store.row(out["id"] as string);
    expect([row?.occurred_on, row?.said_by, row?.status]).toEqual([null, null, "done"]);
  });

  test("a date in the future is kept, with a note that a reminder date is eventDate", async () => {
    const s = server();
    const out = payload(await s.call("note", { text: "The offsite with the whole team is set for the spring.", occurredOn: "2027-04" }));
    expect((out["facts"] as Record<string, unknown>)["occurredOn"]).toBe("2027-04");
    expect(String((out["facts"] as Record<string, unknown>)["note"])).toContain("eventDate");
  });

  test("a note that sends none of them says nothing about them", async () => {
    const s = server();
    const out = payload(await s.call("note", { text: "Prefers short pull requests with one idea each." }));
    expect(out["stored"]).toBe(true);
    expect(out["facts"]).toBeUndefined();
  });

  test("session_end entries take them per entry; a bad one costs its field, not its entry or its siblings", async () => {
    const s = server();
    const out = payload(
      await s.call("session_end", {
        memories: [
          { content: "Mike asked whether the bench numbers could be published yet.", saidBy: "owner", status: "asked", occurredOn: "2026-10-02" },
          { content: "I proposed folding the earlier versions under the current one.", saidBy: "self", status: "proposed", occurredOn: "yesterday-ish" },
        ],
      }),
    );
    expect(out["deposited"]).toBe(2);
    const outcomes = out["outcomes"] as Record<string, unknown>[];
    const a = s.counterpart.store.row(outcomes[0]?.["id"] as string);
    const b = s.counterpart.store.row(outcomes[1]?.["id"] as string);
    expect([a?.occurred_on, a?.said_by, a?.status]).toEqual(["2026-10-02", "owner", "asked"]);
    expect([b?.occurred_on, b?.said_by, b?.status]).toEqual([null, "self", "proposed"]);
    expect(((outcomes[1]?.["facts"] as Record<string, unknown>)["dropped"] as unknown[]).length).toBe(1);
  });

  test("the tool schemas publish the three fields, and the eventDate text points at occurredOn", () => {
    const note = JSON.stringify(TOOLS.find((t) => t.name === "note")?.inputSchema);
    const end = JSON.stringify(TOOLS.find((t) => t.name === "session_end")?.inputSchema);
    for (const text of [note, end]) {
      expect(text).toContain('"occurredOn"');
      expect(text).toContain('"saidBy"');
      expect(text).toContain('"status"');
      expect(text).toContain("when it already happened, that is occurredOn");
    }
  });
});

describe("the three fields on a dream's gist", () => {
  test("a gist takes them; one that cannot be read is left off with a note and the gist is written", () => {
    const c = brain();
    c.store.advanceClock("2026-09-30");
    const day = c.store.livedDay();
    const at = { physics: { birthDay: day, lastUsedDay: day }, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 } };
    const a = c.store.put({ type: "memory", kind: "fact", body: "The migration step must run before the container boots.", ...at });
    const b = c.store.put({ type: "memory", kind: "fact", body: "Run the migration before starting the container or it starts empty.", ...at });
    const begun = c.dreams.begin({ session: "s-dream", scope: "/proj" });
    if (!begun.ok) throw new Error(begun.reason);
    const out = c.dreams.propose({
      dream: begun.bundle.dream,
      session: "s-dream",
      changes: [
        { action: "gist", text: "Boot order keeps biting: migrations first.", sources: [a, b], occurredOn: "2026-09-21..2026-09-30", saidBy: "inferred", status: "done" },
        { action: "gist", text: "Container starts keep needing their migrations run first.", sources: [a], occurredOn: "lately", saidBy: "inferred" },
      ],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const g1 = c.store.row(out.results[0]?.id as string);
    expect([g1?.occurred_on, g1?.said_by, g1?.status]).toEqual(["2026-09-21..2026-09-30", "inferred", "done"]);
    expect(out.results[1]?.ok).toBe(true);
    const g2 = c.store.row(out.results[1]?.id as string);
    expect([g2?.occurred_on, g2?.said_by]).toEqual([null, "inferred"]);
    expect(out.results[1]?.note).toContain("occurredOn");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// subject links
// ═══════════════════════════════════════════════════════════════════════════

function card(c: Counterpart, name: string, aliases: string[] = []): string {
  const out = c.schemas.mention({ name, kind: "person", source: `${name} ${aliases.join(" ")}`, chunkRef: `card-${name}`, aliases, day: c.store.livedDay() });
  if (!out.ok || out.id === null) throw new Error(`no card for ${name}: ${out.reason}`);
  return out.id;
}

describe("subject links", () => {
  test("a memory is linked at its write to the live cards it names, by name or alias, as a whole word", () => {
    const c = brain();
    const mira = card(c, "Mira", ["Mira Chen"]);
    const id = c.store.put({ type: "memory", kind: "fact", body: "Mira Chen moved the standup to nine." });
    const not = c.store.put({ type: "memory", kind: "fact", body: "Miranda brought pastries to the standup." });
    expect(c.store.subjectsOf(id)).toEqual([mira]);
    expect(c.store.subjectsOf(not)).toEqual([]);
    expect(c.store.subjectLinksOf(id)[0]?.via).toBe("write");
    expect(c.store.memoriesNaming(mira)).toEqual([id]);
  });

  test("a card born after the memories that name it links them (via birth)", () => {
    const c = brain();
    const before = c.store.put({ type: "memory", kind: "fact", body: "Talked to Oskar about the harbour project budget." });
    const elsewhere = c.store.put({ type: "memory", kind: "fact", body: "The harbour project budget is due on Friday." });
    const oskar = card(c, "Oskar");
    expect(c.store.subjectsOf(before)).toEqual([oskar]);
    expect(c.store.subjectLinksOf(before)[0]?.via).toBe("birth");
    expect(c.store.subjectsOf(elsewhere)).toEqual([]);
  });

  test("a revise of the words relinks; a meta-only revise leaves the links alone", () => {
    const c = brain();
    const mira = card(c, "Mira");
    const oskar = card(c, "Oskar");
    const id = c.store.put({ type: "memory", kind: "fact", body: "Mira owns the release checklist now." });
    expect(c.store.subjectsOf(id)).toEqual([mira]);
    c.store.revise(id, { body: "Oskar owns the release checklist now." });
    expect(c.store.subjectsOf(id)).toEqual([oskar]);
    c.store.revise(id, { meta: { note: true } });
    expect(c.store.subjectsOf(id)).toEqual([oskar]);
  });

  test("a deposit through note is linked, and the owner's removal takes the links both ways", async () => {
    const s = server();
    const c = s.counterpart;
    const mira = card(c, "Mira");
    const out = payload(await s.call("note", { text: "Mira wants the bench numbers checked twice before anything is published." }));
    const id = out["id"] as string;
    expect(c.store.subjectsOf(id)).toEqual([mira]);
    c.store.appendRemovalRecord({ memoryId: id, stage: "requested", actor: "owner", reason: "test" });
    c.store.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner", reason: "test" });
    chaseRemoved(c.store, id);
    expect(c.store.subjectsOf(id)).toEqual([]);
    expect(c.store.memoriesNaming(mira, { archived: true })).toEqual([]);
  });

  test("the backfill links what was written before, once, and latches", () => {
    // Written by a bare store: no finder installed, so no links.
    const bare = Store.open({ dir, snapshotsDir: join(root, "snaps"), now: () => clock });
    const first = bare.put({ type: "memory", kind: "fact", body: "Mira and Oskar split the launch checklist between them." });
    bare.close();
    const c = brain();
    const mira = card(c, "Mira");
    // Born now, the card looked back already; the backfill latch was set at open.
    expect(c.store.subjectsOf(first)).toEqual([mira]);
    const record = JSON.parse(c.store.getMeta(SUBJECTS_BACKFILL_META) ?? "{}") as Record<string, unknown>;
    expect(typeof record["at"]).toBe("number");
    c.close();
    open.splice(0);

    // A store whose cards existed before its links: drop the links, unlatch, reopen.
    const db = new Database(paths.operational(dir));
    db.run("DELETE FROM memory_subjects");
    db.run("DELETE FROM meta WHERE key = ?", [SUBJECTS_BACKFILL_META]);
    db.close();
    const again = brain();
    expect(again.store.subjectsOf(first)).toEqual([mira]);
    expect(again.store.subjectLinksOf(first)[0]?.via).toBe("backfill");
    const rec = JSON.parse(again.store.getMeta(SUBJECTS_BACKFILL_META) ?? "{}") as Record<string, unknown>;
    expect(rec["links"]).toBe(1);
    expect(rec["memories"]).toBe(1);
    again.close();
    open.splice(0);
    // Latched: a third open links nothing new and leaves the record as it was.
    const third = brain();
    expect(third.store.getMeta(SUBJECTS_BACKFILL_META)).toBe(JSON.stringify(rec));
  });

  test("a handle two cards hold names neither", () => {
    const c = brain();
    const one = card(c, "Sam");
    const id0 = c.store.put({ type: "memory", kind: "fact", body: "Sam fixed the flaky deploy test." });
    expect(c.store.subjectsOf(id0)).toEqual([one]);
    // A second card holding "Sam" is refused at birth; one written by another
    // process (a row of its own) is how the handle becomes two cards'.
    c.store.put({ type: "schema", kind: "person", title: "Samuel", body: "Samuel, also Sam.", meta: { role: "entity", name: "Samuel", aliases: ["Sam"] } });
    c.close();
    open.splice(0);
    const again = brain();
    expect(again.schemas.subjectsIn("Sam fixed it again.")).toEqual([]);
    const id1 = again.store.put({ type: "memory", kind: "fact", body: "Sam fixed the other flaky test." });
    expect(again.store.subjectsOf(id1)).toEqual([]);
  });

  test("the scanner gives exactly matchesIn's hits", () => {
    const idx = new AliasIndex();
    idx.register("sch_a", "Mira", ["Mira Chen", "M.C."]);
    idx.register("sch_b", "Oskar", ["Osk"]);
    idx.register("sch_c", "C++", []);
    idx.register("sch_d", "self", []);
    idx.register("sch_e", "the harbour project", ["harbour"]);
    const scan = idx.scanner();
    const texts = [
      "Mira Chen and Oskar met.",
      "mira chen, MIRA, mira's notes",
      "Osk wrote C++ all day; C++ is hard.",
      "self-contained, not self.",
      "The Harbour Project slipped; harbour-front is a place.",
      "M.C. signed it. Nothing else here.",
      "",
      "Oskarsson is not Oskar's.",
    ];
    for (const t of texts) expect(scan(t)).toEqual(idx.matchesIn(t));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// chapter addresses
// ═══════════════════════════════════════════════════════════════════════════

describe("chapter addresses", () => {
  test("an address is the episode id and a 1-based number", () => {
    expect(chapterAddress("epi_abc123", 2)).toBe("epi_abc123#2");
    expect(parseChapterAddress("epi_abc123#2")).toEqual({ episodeId: "epi_abc123", chapter: 2 });
    expect(parseChapterAddress("epi_abc123#0")).toBeNull();
    expect(parseChapterAddress("mem_abc123#1")).toBeNull();
    expect(parseChapterAddress("epi_abc123")).toBeNull();
  });

  test("it resolves to heading, text, span and the session's memories — those written just after a chapter count as its own", async () => {
    const session = "sess_chapters";
    const c = brain();
    const ctx = { session, scope: "/proj/one" };
    const t0 = clock;
    // Stretch one: a note, then the chapter, then the dump a minute after it.
    const early = await c.submitJot({ content: "Picked the facts mode result shape with Mike this morning." }, ctx);
    clock = t0 + 10 * 60_000;
    c.episodeAsk(session, { turns: 12, bytes: 9_000 });
    const one = c.appendEpisode(session, "We settled how a facts answer reads, line by line.", { title: "Facts mode" });
    clock += 60_000;
    const dump = await c.submitSessionEnd({ content: "Facts results show two dates kept apart, event and learned." }, ctx);
    // Stretch two, well after the grace.
    clock += CHAPTER_MOMENT_GRACE_MS + 20 * 60_000;
    const later = await c.submitJot({ content: "Meaning mode answers with an arc of chapters, in time order." }, ctx);
    clock += 10 * 60_000;
    c.episodeAsk(session, { turns: 30, bytes: 30_000 });
    c.appendEpisode(session, "Then meaning mode: arcs, feelings side by side, earlier readings.", {});

    const episodeId = one.episodeId as string;
    expect(c.store.readProse(episodeId).meta[CHAPTER_AT_META]).toBeDefined();
    const first = resolveChapter(c.store, `${episodeId}#1`);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.chapter.of).toBe(2);
    expect(first.chapter.heading).toMatch(/^## chapter 1 — /);
    expect(first.chapter.text).toBe("We settled how a facts answer reads, line by line.");
    expect(first.chapter.session).toBe(session);
    expect(first.chapter.span.from).toBeNull();
    expect(first.chapter.span.to).toBe(t0 + 10 * 60_000);
    expect(first.chapter.momentsFrom).toBe("stored");
    expect(first.chapter.moments).toEqual([early.memoryId as string, dump.memoryId as string]);

    const second = resolveChapter(c.store, `${episodeId}#2`);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.chapter.span.from).toBe(t0 + 10 * 60_000);
    expect(second.chapter.moments).toEqual([later.memoryId as string]);
    expect(second.chapter.text).toContain("meaning mode");

    expect(resolveChapter(c.store, `${episodeId}#3`)).toEqual({ ok: false, reason: "no-such-chapter", of: 2 });
    expect(resolveChapter(c.store, "epi_nothere#1")).toEqual({ ok: false, reason: "no-episode" });
    expect(resolveChapter(c.store, "nonsense")).toEqual({ ok: false, reason: "not-an-address" });
  });

  test("an episode from before stored moments is read from its versions", () => {
    const session = "sess_legacy";
    const c = brain();
    c.episodeAsk(session, { turns: 12, bytes: 9_000 });
    const one = c.appendEpisode(session, "The first stretch, written before chapters kept their moments.", {});
    const t1 = clock;
    clock += 30 * 60_000;
    c.episodeAsk(session, { turns: 30, bytes: 30_000 });
    c.appendEpisode(session, "The second stretch, also from before.", {});
    const episodeId = one.episodeId as string;
    // Take the stored moments away, as an episode written before v12 has none.
    const db = new Database(paths.operational(dir));
    const meta = JSON.parse((db.query("SELECT meta FROM memories WHERE id = ?").get(episodeId) as { meta: string }).meta) as Record<string, unknown>;
    delete meta[CHAPTER_AT_META];
    db.run("UPDATE memories SET meta = ? WHERE id = ?", [JSON.stringify(meta), episodeId]);
    db.close();
    const second = resolveChapter(c.store, `${episodeId}#2`);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.chapter.momentsFrom).toBe("versions");
    expect(second.chapter.span).toEqual({ from: t1, to: t1 + 30 * 60_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// doctor
// ═══════════════════════════════════════════════════════════════════════════

describe("doctor's Write fields line", () => {
  test("informational: the share of each field among the memories the write doors wrote, and the links", async () => {
    const s = server();
    await s.call("note", { text: "Mike said the bench numbers stay private for now.", saidBy: "owner", status: "done", occurredOn: "2026-10-02" });
    await s.call("note", { text: "I think the s500 losses are mostly breadth, not ranking.", saidBy: "inferred" });
    // A memory no write door wrote is not counted (a bare put is unrecorded).
    s.counterpart.store.put({ type: "memory", kind: "fact", body: "Written by no door that takes the fields." });
    const [f] = writeFieldFindings(s.counterpart.store);
    expect(f?.severity).toBe("green");
    expect(f?.title).toBe("Write fields");
    expect(f?.data).toMatchObject({ written: 2, occurredOn: 1, saidBy: 2, status: 1, all: 1 });
    expect(f?.detail).toContain("when it happened 50%");
    expect(f?.detail).toContain("who said it 100%");
  });
});

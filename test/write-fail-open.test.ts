/**
 * THE WRITE TOOLS FAIL OPEN (2026-11-13): `remember` and `session_end` keep
 * the memory whatever an optional field says. A field that cannot be read is
 * dropped and named in `dropped`; a value read as something else is echoed in
 * `readAs`. Unit tests per rule of the cleaning (`server-normalize.ts`), the
 * loose date reader (`core/loose-date.ts`) and the feeling placement
 * (`core/feelings-place.ts`, `core/feelings-thesaurus.ts`), then the real path
 * through `McpServer.call` for every refusal this removed.
 *
 * Hermetic (CLAUDE.md): a fresh temp dir per test, removed in `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MCP_WRITE_EVENT } from "../src/core/counterpart.js";
import { ALIASES, CORE_EMOTIONS, FEELINGS_WHEEL } from "../src/core/feelings-wheel.js";
import type { CoreEmotion } from "../src/core/feelings-wheel.js";
import { FEELINGS_THESAURUS, thesaurusCore } from "../src/core/feelings-thesaurus.js";
import { placeFeelingWord } from "../src/core/feelings-place.js";
import { readLooseDate } from "../src/core/loose-date.js";
import { parseCalendarDate } from "../src/core/time.js";
import { CLAUDE_AI_HOST } from "../src/adapters/hosts.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import {
  MEANING_PLACE_MARGIN,
  MEANING_PLACE_MIN,
  WriteNotes,
  meaningPlacer,
  normalizeMemoryFields,
  parseFeelingString,
} from "../src/adapters/mcp/server-normalize.js";

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-fail-open-"));
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

const SESSION = "sess_fail_open";
/** Friday 2026-11-13, noon UTC. */
const NOON = Date.parse("2026-11-13T12:00:00Z");
const TODAY = "2026-11-13";

type Embedder = { vector(text: string): Promise<number[] | null> };

function server(opts: { embedder?: Embedder; host?: string } = {}): McpServer {
  const s = openServer({
    dir,
    session: SESSION,
    scope: "/scope/fail-open",
    now: () => NOON,
    timeZone: "UTC",
    ...(opts.embedder === undefined ? {} : { embedder: opts.embedder }),
    ...(opts.host === undefined ? {} : { host: opts.host, env: {} }),
  });
  open.push(s.counterpart);
  return s;
}

const body = (r: { structuredContent: Record<string, unknown> }): Record<string, unknown> => r.structuredContent;

/** A fake embedder: every wheel and thesaurus word on its core's axis; listed extra words where the test puts them. */
function fakeEmbedder(extra: Record<string, number[]>): Embedder {
  const axis = (core: CoreEmotion): number[] => CORE_EMOTIONS.map((c) => (c === core ? 1 : 0));
  const known = new Map<string, number[]>();
  for (const e of FEELINGS_WHEEL) known.set(e.key, axis(e.core));
  for (const [w, c] of FEELINGS_THESAURUS) known.set(w, axis(c));
  for (const [w, v] of Object.entries(extra)) known.set(w, v);
  return { vector: async (text: string) => known.get(text) ?? null };
}

const ctx = { today: TODAY };

// ── the loose date reader ───────────────────────────────────────────────────

describe("loose dates in the eventDate and occurredOn fields", () => {
  test("words read against today, leaning ahead or back, every answer an exact shape", () => {
    const cases: [string, string, string][] = [
      // value, ahead (eventDate), back (occurredOn)
      ["tomorrow", "2026-11-14", "2026-11-14"],
      ["yesterday", "2026-11-12", "2026-11-12"],
      ["next Friday", "2026-11-20", "2026-11-20"],
      ["last Tuesday", "2026-11-10", "2026-11-10"],
      ["Tuesday", "2026-11-17", "2026-11-10"],
      ["Oct 15", "2027-10-15", "2026-10-15"],
      ["15 October", "2027-10-15", "2026-10-15"],
      ["December 3rd", "2026-12-03", "2025-12-03"],
      ["late October", "2027-10-21..2027-10-31", "2026-10-21..2026-10-31"],
      ["early December", "2026-12-01..2026-12-10", "2025-12-01..2025-12-10"],
      ["next month", "2026-12", "2026-12"],
      ["last month", "2026-10", "2026-10"],
      ["in two weeks", "2026-11-27", "2026-11-27"],
      ["3 days ago", "2026-11-10", "2026-11-10"],
      ["next week", "2026-11-16..2026-11-22", "2026-11-16..2026-11-22"],
      ["the 20th", "2026-11-20", "2026-10-20"],
      ["2026-10-15", "2026-10-15", "2026-10-15"],
      ["2026-10-20..2026-10-31", "2026-10-20..2026-10-31", "2026-10-20..2026-10-31"],
    ];
    for (const [value, ahead, back] of cases) {
      const a = readLooseDate(value, TODAY, "ahead");
      const b = readLooseDate(value, TODAY, "back");
      expect({ value, ahead: a?.text, back: b?.text }).toEqual({ value, ahead, back });
      expect(parseCalendarDate(a?.text)).not.toBeNull();
      expect(a?.words).toBe(parseCalendarDate(value) === null);
    }
  });

  test("a sentence, a time alone or nonsense is not a date: never fished out of words around it", () => {
    for (const value of ["dentist next friday at 3", "sometime", "when the beta closes", "3pm", "feb 30", "", 20261015, null, {}]) {
      expect(readLooseDate(value, TODAY, "ahead")).toBeNull();
    }
  });
});

// ── the feeling placement ───────────────────────────────────────────────────

describe("placing a feeling word on a core", () => {
  test("the thesaurus is a few hundred words, none on the wheel or an alias, each under one core", () => {
    expect(FEELINGS_THESAURUS.size).toBeGreaterThanOrEqual(300);
    const wheel = new Set(FEELINGS_WHEEL.map((e) => e.key));
    for (const word of FEELINGS_THESAURUS.keys()) {
      expect(wheel.has(word)).toBe(false);
      expect(Object.hasOwn(ALIASES, word)).toBe(false);
    }
    for (const core of CORE_EMOTIONS) expect([...FEELINGS_THESAURUS.values()].filter((c) => c === core).length).toBeGreaterThan(40);
    expect(thesaurusCore(" Chuffed ")).toBe("happy");
  });

  test("thesaurus, inflection, misspelling — and never a negation, an opposite prefix, or a word too short to tell", () => {
    const placed = (w: string): [string, string] | null => {
      const p = placeFeelingWord(w);
      return p === null ? null : [p.core, p.by];
    };
    expect(placed("chuffed")).toEqual(["happy", "thesaurus"]);
    expect(placed("very stressed")).toEqual(["uneasy", "thesaurus"]);
    expect(placed("worrying")).toEqual(["uneasy", "stem"]);
    expect(placed("frustrating")).toEqual(["angry", "stem"]);
    expect(placed("releived")).toEqual(["calm", "spelling"]);
    expect(placed("lonley")).toEqual(["sad", "spelling"]);
    expect(placed("embarassed")).toEqual(["uneasy", "spelling"]);
    expect(placed("not happy")).toBeNull();
    expect(placed("no longer afraid")).toBeNull();
    expect(placed("uncaring")).toBeNull();
    expect(placed("zorbish")).toBeNull();
    expect(placed("meep")).toBeNull();
  });

  test("a real word one slip from a feeling word is not a misspelling of it: never placed", () => {
    // Each sits one edit (or one inflection) from a wheel or thesaurus word with a core it does not mean.
    for (const w of ["better", "worse", "wired", "tried", "yucky", "closed", "opened", "presented", "crossed", "alerted", "safer", "believed", "discussed", "demoted"]) {
      expect({ w, placed: placeFeelingWord(w) }).toEqual({ w, placed: null });
    }
    // …while the slips a writer makes still place.
    for (const [w, core] of [["lonley", "sad"], ["happpy", "happy"], ["exicted", "happy"], ["worreid", "uneasy"], ["hopefull", "happy"], ["frustated", "angry"], ["dissapointed", "sad"], ["surprized", "curious"]] as const) {
      expect({ w, core: placeFeelingWord(w)?.core }).toEqual({ w, core });
    }
  });

  test("by meaning only when sure: the bar and the margin, never a negation or a prefixed opposite", async () => {
    const at = (core: CoreEmotion, s: number): number[] => CORE_EMOTIONS.map((c) => (c === core ? s : 0));
    const lean = (a: CoreEmotion, b: CoreEmotion, sa: number, sb: number): number[] => CORE_EMOTIONS.map((c) => (c === a ? sa : c === b ? sb : 0));
    const place = meaningPlacer(
      fakeEmbedder({
        zorbish: at("happy", 1),
        blorpy: lean("happy", "calm", 0.7, 0.66),
        unhappy: at("happy", 1),
      }),
    );
    expect(await place("zorbish")).toBe("happy");
    // Close to two cores at once: no margin, no core.
    expect(await place("blorpy")).toBeNull();
    // "unhappy" is "happy" with a negating prefix: never by meaning, whatever the vector says.
    expect(await place("unhappy")).toBeNull();
    expect(await place("not zorbish")).toBeNull();
    // Nothing the embedder knows.
    expect(await place("quuxly")).toBeNull();
    expect(MEANING_PLACE_MIN).toBe(0.6);
    expect(MEANING_PLACE_MARGIN).toBe(0.15);
  });
});

// ── the cleaning, per rule ──────────────────────────────────────────────────

describe("the cleaning, rule by rule", () => {
  test("string feelings: whose before a colon (default self), the word, what carried it", () => {
    expect(parseFeelingString("self: relieved — the test passed")).toEqual({ whose: "self", emotion: "relieved", carried_by: "the test passed" });
    expect(parseFeelingString("owner: frustrated")).toEqual({ whose: "owner", emotion: "frustrated" });
    expect(parseFeelingString("proud because it shipped")).toEqual({ whose: "self", emotion: "proud", carried_by: "it shipped" });
    expect(parseFeelingString("user: worried: the deadline moved")).toEqual({ whose: "owner", emotion: "worried", carried_by: "the deadline moved" });
    expect(parseFeelingString("  ")).toBeNull();
    // A name where whose goes is kept as sent, so the feeling is dropped as whose-unknown, not stored as "Mike".
    expect(parseFeelingString("Mike: frustrated")).toEqual({ whose: "Mike", emotion: "frustrated" });
    expect(parseFeelingString("relieved: the test passed")).toEqual({ whose: "self", emotion: "relieved", carried_by: "the test passed" });
  });

  test("remind: true is plain, false quiet", async () => {
    const yes = await normalizeMemoryFields({ text: "x", eventDate: "2026-12-01", remind: true }, "text", ctx, new WriteNotes());
    const no = await normalizeMemoryFields({ text: "x", eventDate: "2026-12-01", remind: false }, "text", ctx, new WriteNotes());
    expect([yes["remind"], no["remind"]]).toEqual(["plain", "quiet"]);
  });

  test("enum synonyms are read and said; an unknown word is dropped and said", async () => {
    const notes = new WriteNotes();
    const out = await normalizeMemoryFields(
      {
        text: "x",
        kind: "lesson",
        how: "fix",
        remind: "important",
        recurring: "annually",
        eventDate: "2026-12-01",
        about: "user",
        saidBy: "assistant",
        status: "todo",
      },
      "text",
      ctx,
      notes,
    );
    expect(out).toMatchObject({ kind: "skill", how: "corrected", remind: "plain", recurring: "yearly", about: "owner", saidBy: "self", status: "planned" });
    expect(notes.readAs.map((r) => r.field).sort()).toEqual(["about", "how", "kind", "recurring", "remind", "saidBy", "status"]);
    const bad = new WriteNotes();
    const worse = await normalizeMemoryFields({ text: "x", kind: "vibe", how: "sideways", about: "galaxy", remind: "maybe" }, "text", ctx, bad);
    expect(worse["kind"]).toBeUndefined();
    expect(worse["how"]).toBeUndefined();
    expect(worse["about"]).toBeUndefined();
    expect(bad.dropped.map((d) => `${d.field}:${d.reason}`).sort()).toEqual(["about:about-unknown", "how:how-unknown", "kind:kind-unknown", "remind:remind-unknown"]);
  });

  test("numbers sent as text are read; out of range clamped and said; not a number dropped", async () => {
    const notes = new WriteNotes();
    const out = await normalizeMemoryFields({ text: "x", salience: "0.7", relevance: 7, emotional: -1, predictive: "lots" }, "text", ctx, notes);
    expect(out).toMatchObject({ salience: 0.7, relevance: 1, emotional: 0 });
    expect(out["predictive"]).toBeUndefined();
    expect(notes.readAs).toEqual([
      { field: "salience", sent: "0.7", readAs: "0.7" },
      { field: "relevance", sent: "7", readAs: "1" },
      { field: "emotional", sent: "-1", readAs: "0" },
    ]);
    expect(notes.dropped.map((d) => d.field)).toEqual(["predictive"]);
  });

  test("text and content are one field; remove given as an id means {id}; recurring beside a month keeps the date", async () => {
    const notes = new WriteNotes();
    const out = await normalizeMemoryFields({ content: "words", remove: "mem_1", eventDate: "2026-12", recurring: "monthly" }, "text", ctx, notes);
    expect(out["text"]).toBe("words");
    expect(out["content"]).toBeUndefined();
    expect(out["remove"]).toEqual({ id: "mem_1" });
    expect(out["eventDate"]).toBe("2026-12");
    expect(out["recurring"]).toBeUndefined();
    expect(notes.dropped.map((d) => `${d.field}:${d.reason}`)).toEqual(["recurring:recurring-needs-day"]);
    const entry = await normalizeMemoryFields({ text: "entry words" }, "content", ctx, new WriteNotes());
    expect(entry["content"]).toBe("entry words");
  });

  test("a done memory's date in words leans back, so it becomes when it happened", async () => {
    const out = await normalizeMemoryFields({ text: "x", status: "done", eventDate: "Tuesday" }, "text", ctx, new WriteNotes());
    expect(out["eventDate"]).toBe("2026-11-10");
  });

  test("feelings: one feeling dropped alone, beneath renumbered past it", async () => {
    const notes = new WriteNotes();
    const out = await normalizeMemoryFields(
      {
        text: "x",
        feelings: [
          { whose: "self", emotion: "zorbish" },
          { whose: "self", core: "uneasy", emotion: "afraid" },
          { whose: "self", core: "angry", emotion: "furious", beneath: 1 },
        ],
      },
      "text",
      ctx,
      notes,
    );
    const list = out["feelings"] as Record<string, unknown>[];
    expect(list.map((f) => f["emotion"])).toEqual(["afraid", "furious"]);
    expect(list[1]?.["beneath"]).toBe(0);
    expect(notes.unplaced).toEqual(["zorbish"]);
    expect(notes.dropped[0]).toMatchObject({ field: "feelings[0]", reason: "feeling-unplaced", sent: "zorbish" });
  });
});

// ── the real path, through the server ───────────────────────────────────────

describe("remember: every former refusal keeps the memory, names the field in dropped", () => {
  const TEXT = (n: number): string => `The north ridge survey counted ${String(30 + n)} nests on the far slope this morning.`;
  const cases: [string, Record<string, unknown>, string, string][] = [
    // [label, extra args, the field dropped, its reason]
    ["eventDate unreadable", { eventDate: "whenever the beta closes" }, "eventDate", "event-date-unreadable"],
    ["remind unknown", { eventDate: "2026-12-01", remind: "maybe" }, "remind", "remind-unknown"],
    ["recurring unknown", { eventDate: "2026-12-01", recurring: "fortnightly" }, "recurring", "recurring-unknown"],
    ["recurring beside a month", { eventDate: "2026-12", recurring: "yearly" }, "recurring", "recurring-needs-day"],
    ["feelings not a list", { feelings: 42 }, "feelings", "feelings-not-a-list"],
    ["feeling off the wheel, no core", { feelings: [{ whose: "self", emotion: "zorbish" }] }, "feelings[0]", "feeling-unplaced"],
    ["feeling whose unknown", { feelings: [{ whose: "both", emotion: "happy" }] }, "feelings[0]", "whose-unknown"],
    ["about unknown", { about: "galaxy" }, "about", "about-unknown"],
    ["traits malformed", { traits: [{ axis: "bravery", toward: "brave" }] }, "traits[0]", "trait-invalid"],
    ["salience not a number", { salience: "high" }, "salience", "not-a-number"],
    ["dimension not a number", { relevance: "very" }, "relevance", "not-a-number"],
    ["kind unknown", { kind: "vibe" }, "kind", "kind-unknown"],
    ["how unknown", { how: "sideways" }, "how", "how-unknown"],
    ["title not text", { title: { a: 1 } }, "title", "title-not-text"],
    ["updates not text", { updates: 42 }, "updates", "updates-not-text"],
    ["core malformed beside text", { core: "keep it" }, "core", "core-malformed"],
    ["remark malformed beside text", { remark: 7 }, "remark", "remark-malformed"],
    ["settle malformed beside text", { settle: "the newer one" }, "settle", "settle-malformed"],
    ["feelingsNow malformed beside text", { feelingsNow: 42 }, "feelingsNow", "feelings-now-malformed"],
    ["remove malformed beside text", { remove: 42 }, "remove", "remove-malformed"],
  ];
  for (const [n, [label, extra, field, reason]] of cases.entries()) {
    test(label, async () => {
      const s = server();
      const out = body(await s.call("remember", { text: TEXT(n), ...extra }));
      expect(out["stored"]).toBe(true);
      expect(out["dropped"]).toContainEqual(expect.objectContaining({ field, reason }));
      const id = out["id"] as string;
      const row = s.counterpart.store.row(id);
      expect(row).not.toBeNull();
      // The field is absent from what was stored.
      if (field === "eventDate") expect(row?.event_date ?? null).toBeNull();
      if (field === "about") expect(s.counterpart.store.read(id).about).toBeNull();
      if (field.startsWith("feelings")) expect(s.counterpart.store.feelingsFor(id)).toEqual([]);
      if (field.startsWith("traits")) expect(s.counterpart.store.traitsFor(id)).toEqual([]);
      if (field === "recurring") expect(row?.event_date).not.toBeNull();
    });
  }

  test("each optional field against junk: the memory is stored every time", async () => {
    const s = server();
    const fields = ["eventDate", "remind", "recurring", "occurredOn", "saidBy", "status", "about", "kind", "how", "title", "updates", "salience", "relevance", "emotional", "predictive", "feelings", "traits", "tags", "unresolved", "settlesWhen", "belief", "story"];
    const junk: unknown[] = [null, 7, -1, "", "junk words here", {}, [], [null], { nested: [1, 2] }];
    let n = 0;
    for (const field of fields) {
      for (const value of junk) {
        n += 1;
        const text = `Fuzz note ${String(n)}: the ${field} field sent ${JSON.stringify(value)} beside a real memory about the kiln.`;
        const out = body(await s.call("remember", { text, [field]: value }));
        expect({ field, value, stored: out["stored"] }).toEqual({ field, value, stored: true });
      }
    }
  });

  test("each side operation against junk, beside text: the text is stored every time", async () => {
    const s = server();
    const junk: unknown[] = [null, 7, "", "junk", [], [null], { nested: [1] }, true];
    let n = 0;
    for (const field of ["core", "remark", "remove", "settle", "feelingsNow"]) {
      for (const value of junk) {
        n += 1;
        const text = `Side note ${String(n)}: ${field} sent ${JSON.stringify(value)} beside a real memory about the greenhouse vents.`;
        const out = body(await s.call("remember", { text, [field]: value }));
        expect({ field, value, stored: out["stored"] }).toEqual({ field, value, stored: true });
      }
    }
  });

  test("an unreadable date beside reminder-like text: dropped, and the reminderHint still says it won't come back", async () => {
    const s = server();
    const out = body(await s.call("remember", { text: "Remind me to call the plumber on Friday about the kitchen leak.", eventDate: "whenever he's free" }));
    expect(out["stored"]).toBe(true);
    expect(out["dropped"]).toContainEqual(expect.objectContaining({ field: "eventDate", reason: "event-date-unreadable" }));
    expect(String(out["reminderHint"])).toContain("has no eventDate");
  });

  test("a name where whose goes drops that feeling by name; a phrase nothing placed is logged as a phrase, never its words", async () => {
    const s = server();
    const out = body(
      await s.call("remember", {
        text: "The biopsy results came back clear after two weeks of waiting.",
        feelings: ["Mike: frustrated", "self: the diagnosis scared me half to death"],
      }),
    );
    expect(out["stored"]).toBe(true);
    const dropped = out["dropped"] as Record<string, unknown>[];
    expect(dropped.map((d) => `${String(d["field"])}:${String(d["reason"])}`)).toEqual(["feelings[0]:whose-unknown", "feelings[1]:feeling-unplaced"]);
    const row = JSON.parse(s.counterpart.store.eventLog({ name: MCP_WRITE_EVENT, limit: 1 })[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(row["unplaced"]).toEqual(["(phrase)"]);
    expect(JSON.stringify(row)).not.toContain("diagnosis");
  });

  test("claude.ai: remove beside text deletes nothing and keeps the text (it was lost before)", async () => {
    const s = server({ host: CLAUDE_AI_HOST });
    const kept = body(await s.call("remember", { text: "Wren's bike lock code changed to 5582 last week.", kind: "fact" }));
    expect(kept["stored"]).toBe(true);
    const both = body(await s.call("remember", { text: "Wren moved the bike to the shed for winter.", remove: { id: kept["id"] } }));
    expect(both["stored"]).toBe(true);
    expect(both["dropped"]).toContainEqual(expect.objectContaining({ field: "remove", reason: "remove-moved" }));
    expect(s.counterpart.store.row(kept["id"] as string)).not.toBeNull();
    // Alone, it is still the refusal that says where the delete went.
    const alone = body(await s.call("remember", { remove: { id: kept["id"] } }));
    expect(alone["reason"]).toBe("remove-moved");
  });

  test("string feelings are stored with the right whose, core and carried_by", async () => {
    const s = server();
    const out = body(
      await s.call("remember", {
        text: "The migration test finally passed after three days of chasing a clock bug.",
        feelings: ["self: relieved — the test passed", "owner: frustrated", "proud"],
      }),
    );
    expect(out["stored"]).toBe(true);
    const rows = s.counterpart.store.feelingsFor(out["id"] as string).map((f) => [f.whose, f.core, f.emotion, f.carried_by]);
    expect(rows).toEqual([
      ["self", "calm", "relieved", "the test passed"],
      ["owner", "angry", "frustrated", ""],
      ["self", "happy", "proud", ""],
    ]);
    // One string where the list goes is that one feeling.
    const one = body(await s.call("remember", { text: "The kiln reached cone six without a single crack.", feelings: "self: delighted" }));
    expect(s.counterpart.store.feelingsFor(one["id"] as string).map((f) => f.emotion)).toEqual(["delighted"]);
  });

  test("a thesaurus word and a misspelling are placed, the writer's word kept; an unplaceable one is dropped alone", async () => {
    const s = server();
    const out = body(
      await s.call("remember", {
        text: "He said the garden beds finally came in, and we planned the spring planting together.",
        feelings: ["self: chuffed — he asked me first", "owner: releived", "self: zorbish"],
      }),
    );
    expect(out["stored"]).toBe(true);
    const rows = s.counterpart.store.feelingsFor(out["id"] as string).map((f) => [f.whose, f.core, f.emotion, f.other_word]);
    expect(rows).toEqual([
      ["self", "happy", "other", "chuffed"],
      ["owner", "calm", "other", "releived"],
    ]);
    expect(out["readAs"]).toContainEqual({ field: "feelings[0].core", sent: "chuffed", readAs: "happy" });
    expect(out["readAs"]).toContainEqual({ field: "feelings[1].core", sent: "releived", readAs: "calm" });
    expect(out["dropped"]).toContainEqual(expect.objectContaining({ field: "feelings[2]", reason: "feeling-unplaced", sent: "zorbish" }));
    // The miss is counted on the durable row: the word, codes, no memory text.
    const rows2 = s.counterpart.store.eventLog({ name: MCP_WRITE_EVENT, limit: 10 });
    expect(rows2.length).toBe(1);
    const payload = JSON.parse(rows2[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(payload).toMatchObject({ tool: "remember", entries: 1, stored: 1, unplaced: ["zorbish"], dropped: { "feelings[]:feeling-unplaced": 1 } });
    expect(JSON.stringify(payload)).not.toContain("garden");
  });

  test("by meaning, through the door: a word only the embedder knows is placed when it is sure", async () => {
    const s = server({ embedder: fakeEmbedder({ zorbish: CORE_EMOTIONS.map((c) => (c === "curious" ? 1 : 0)) }) });
    const out = body(await s.call("remember", { text: "The old notebook turned out to hold his grandfather's star charts.", feelings: ["self: zorbish"] }));
    expect(s.counterpart.store.feelingsFor(out["id"] as string).map((f) => [f.core, f.other_word])).toEqual([["curious", "zorbish"]]);
  });

  test('"next Friday" as eventDate resolves under the fixed clock and is echoed', async () => {
    const s = server();
    const out = body(await s.call("remember", { text: "Dentist appointment for the cracked molar, downtown office.", eventDate: "next Friday", remind: "plain" }));
    expect(out["stored"]).toBe(true);
    expect(out["readAs"]).toContainEqual({ field: "eventDate", sent: "next Friday", readAs: "2026-11-20" });
    expect(out["reminder"]).toMatchObject({ eventDate: "2026-11-20", remind: "plain" });
    expect(s.counterpart.store.row(out["id"] as string)?.event_date).toBe("2026-11-20");
  });

  test("a write that lands whole leaves no durable row", async () => {
    const s = server();
    body(await s.call("remember", { text: "The kiln's left shelf runs hot, so glaze tests go on the right.", kind: "fact", salience: 0.5 }));
    expect(s.counterpart.store.eventLog({ name: MCP_WRITE_EVENT, limit: 10 })).toEqual([]);
  });
});

describe("session_end: every entry lands", () => {
  test("five entries, two malformed in different ways and one a bare string, all five stored", async () => {
    const s = server();
    const out = body(
      await s.call("session_end", {
        session: SESSION,
        memories: [
          { content: "We decided the release waits for the migration fix, not the docs.", kind: "decision", status: "decided" },
          { content: "Mike's knee surgery is tomorrow morning at the clinic on Fifth.", eventDate: "tomorrow", feelings: ["owner: nervous"] },
          { content: "The CI runner kept timing out on the macOS job all afternoon.", eventDate: "after lunch sometime", salience: 3, feelings: 12 },
          "The staging database was restored from last night's snapshot without loss.",
          { text: "Biscuit the dog learned to open the back gate by himself.", about: "them", traits: ["playful — laughed about the gate"], recurring: "biweekly", how: "sideways" },
        ],
      }),
    );
    expect(out["entries"]).toBe(5);
    expect(out["deposited"]).toBe(5);
    expect(out["refused"]).toBe(0);
    const outcomes = out["outcomes"] as Record<string, unknown>[];
    expect(outcomes.every((o) => o["stored"] === true)).toBe(true);
    expect(outcomes[0]?.["readAs"]).toEqual([
      { field: "kind", sent: "decision", readAs: "fact" },
      { field: "status", sent: "decided", readAs: "planned" },
    ]);
    expect(outcomes[1]?.["readAs"]).toContainEqual({ field: "eventDate", sent: "tomorrow", readAs: "2026-11-14" });
    expect(s.counterpart.store.row(outcomes[1]?.["id"] as string)?.event_date).toBe("2026-11-14");
    expect((outcomes[2]?.["dropped"] as Record<string, unknown>[]).map((d) => `${String(d["field"])}:${String(d["reason"])}`)).toEqual([
      "eventDate:event-date-unreadable",
      "feelings:feelings-not-a-list",
    ]);
    expect(outcomes[2]?.["readAs"]).toContainEqual({ field: "salience", sent: "3", readAs: "1" });
    expect(outcomes[3]?.["readAs"]).toEqual([{ field: "entry", sent: "(text)", readAs: "{content}" }]);
    expect(s.counterpart.store.read(outcomes[4]?.["id"] as string).about).toBe("owner");
    expect(s.counterpart.store.traitsFor(outcomes[4]?.["id"] as string).map((t) => t.toward)).toEqual(["playful"]);
    expect((outcomes[4]?.["dropped"] as Record<string, unknown>[]).map((d) => d["field"]).sort()).toEqual(["how", "recurring"]);
    // The durable row: no refusals, the drops by field and code, no memory text.
    const rows = s.counterpart.store.eventLog({ name: MCP_WRITE_EVENT, limit: 10 });
    const payload = JSON.parse(rows[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(payload).toMatchObject({ tool: "session_end", entries: 5, stored: 5, refused: {} });
    expect(payload["dropped"]).toMatchObject({ "eventDate:event-date-unreadable": 1, "feelings:feelings-not-a-list": 1, "how:how-unknown": 1 });
    expect(JSON.stringify(payload)).not.toContain("Biscuit");
  });

  test("each optional field against junk on an entry: every entry is stored", async () => {
    const s = server();
    const fields = ["eventDate", "remind", "recurring", "occurredOn", "saidBy", "status", "about", "kind", "how", "title", "updates", "salience", "relevance", "emotional", "predictive", "feelings", "traits", "tags", "unresolved", "settlesWhen"];
    const junk: unknown[] = [null, 7, -1, "", "junk words here", {}, [], [null], { nested: [1, 2] }];
    let n = 0;
    const memories: Record<string, unknown>[] = [];
    for (const field of fields) {
      for (const value of junk) {
        n += 1;
        memories.push({ content: `Entry fuzz ${String(n)}: the ${field} field sent ${JSON.stringify(value)} beside a real memory about the orchard.`, [field]: value });
      }
    }
    const out = body(await s.call("session_end", { session: SESSION, memories }));
    const outcomes = out["outcomes"] as Record<string, unknown>[];
    const lost = outcomes.map((o, i) => ({ i, sent: memories[i], reason: o["reason"] })).filter((_, i) => outcomes[i]?.["stored"] !== true);
    expect(lost).toEqual([]);
    expect(out["deposited"]).toBe(memories.length);
  });

  test("the session_end log line carries per-entry refusal codes, not just a count", async () => {
    const s = server();
    await s.call("session_end", {
      session: SESSION,
      memories: [{ content: "TODO" }, 42, { content: "A real entry about the kiln's new thermocouple holding steady." }],
    });
    const e = s.events("mcp.session_end").at(-1);
    expect(e?.data?.["refused"]).toBe(2);
    const codes = Object.keys(e?.data ?? {}).filter((k) => k.startsWith("refused."));
    expect(codes.length).toBeGreaterThan(0);
    const row = JSON.parse(s.counterpart.store.eventLog({ name: MCP_WRITE_EVENT, limit: 1 })[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(Object.values(row["refused"] as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(2);
  });
});

/**
 * `counterparts ask` — BY MEANING, AND SHORT BY DEFAULT (2026-09-24).
 *
 *   1. The question is embedded with the local table the configuration turns on,
 *      the way the MCP `recall` embeds it, so a memory that shares no word with
 *      the question can still come back. Without the table — or with recall by
 *      meaning switched off — it answers by words and says which.
 *   2. The default page is a header in plain words and the top five, one line
 *      each. `--full` is the page `ask` printed before; `--id` is one memory in
 *      full; `--json` is the payload.
 *
 * Hermetic: every test makes its own temp store and removes it. The meaning
 * tests need the weights package; they skip, saying so, where it is absent.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStaticEmbedder } from "../src/adapters/claude-code/embed-client.js";
import { ASK_GIST_CHARS, ASK_SHOWN, EXIT, askGist, askMeta, printAskList, run } from "../src/adapters/cli/commands.js";
import type { Io } from "../src/adapters/cli/commands.js";
import { STATIC_WEIGHTS_ENV, resolveStaticWeights } from "../src/core/embed/static.js";
import { Store, paths } from "../src/core/store/index.js";
import type { Embedder, EmbedderIdentity } from "../src/core/store/index.js";
import { openDb } from "../src/core/store/db.js";
import type { DeliberateResult } from "../src/adapters/mcp/deliberate.js";

const WEIGHTS = resolveStaticWeights({ env: {} });

let work: string;
let dir: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "counterparts-ask-"));
  dir = join(work, "store");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function consoleOf(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

/** An env with no configuration named and the guard armed: the default applies. */
function env(extra: Record<string, string> = {}): Record<string, string | undefined> {
  return { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", ...extra };
}

async function ask(args: readonly string[], e = env()): Promise<{ code: number; out: string[]; err: string[] }> {
  const c = consoleOf();
  const code = await run(["ask", ...args, "--dir", dir], { io: c.io, env: e, home: join(work, "home") });
  return { code, out: c.out, err: c.err };
}

const FILLER = [
  "The kitchen tap drips when the washer is worn.",
  "Rye flour ferments faster than wheat.",
  "The blue mug chipped in the move.",
  "The bus to town leaves on the hour.",
  "Cedar smells sharpest after rain.",
  "The heating pipes knock in the morning.",
  "The library closes early on Thursdays.",
  "Basil wilts if the pot dries out once.",
  "The garden gate sticks in humid weather.",
  "The attic hatch needs a longer ladder.",
  "Wool socks dry slower than cotton.",
  "Old plaster crumbles when you drill it.",
];

/** Seven memories about the lighthouse, among filler — more than one page. */
function seedLighthouse(embed?: Embedder): string[] {
  const s = Store.open({ dir, ...(embed === undefined ? {} : { embed }) });
  try {
    for (const body of FILLER) s.put({ type: "memory", kind: "fact", body });
    const ids: string[] = [];
    for (let i = 1; i <= 6; i += 1) {
      ids.push(
        s.put({
          type: "memory",
          kind: "fact",
          title: `Lighthouse note ${String(i)}`,
          body: `The lighthouse at Fernbrook Point, note ${String(i)}: the keeper logged the lamp every night.`,
        }),
      );
    }
    // No title, a long body over several lines: its line is the first words,
    // newlines collapsed, cut with an ellipsis.
    ids.push(
      s.put({
        type: "memory",
        kind: "place",
        body:
          "The lighthouse at Fernbrook Point\nstands on a granite shelf above the harbour,\n\nand its lamp was turned by clockwork until the keeper left in 1974, after which nobody climbed it.",
      }),
    );
    return ids;
  } finally {
    s.close();
  }
}

/** The header sentence: how many, and by which channel. */
const HEADER = /^(\d+) (memory|memories) found, by (meaning and words|words only — .+)\.( The top \d+:)?$/;

/** The ids on the answer's quieter lines, in the order shown. */
function shownIds(out: readonly string[]): string[] {
  return out.flatMap((l) => {
    const m = / · ((?:mem|epi)_\S+)$/.exec(l);
    return m === null || !l.startsWith("     ") ? [] : [m[1] as string];
  });
}

describe("ask is short by default", () => {
  test("a header sentence, then the answers numbered — the words, and a quieter line under them", async () => {
    seedLighthouse();
    const r = await ask(["the lighthouse at Fernbrook Point"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out[0]).toBe(`Store: ${dir}`);
    expect(r.out[1]).toMatch(HEADER);
    const found = Number(HEADER.exec(r.out[1] ?? "")?.[1] ?? "0");
    expect(found).toBeGreaterThan(0);
    const shown = Math.min(found, ASK_SHOWN);
    // Header, then per answer a blank line, the words and the quiet line, then
    // a blank line and the one "More:" line.
    expect(r.out.length).toBe(2 + shown * 3 + 2);
    for (let i = 0; i < shown; i += 1) {
      expect(r.out[2 + i * 3]).toBe("");
      expect(r.out[3 + i * 3]).toMatch(new RegExp(`^ {2}${String(i + 1)}\\. \\S`));
      // Not a TTY here: plain, no escape anywhere.
      expect(r.out[4 + i * 3]).toMatch(/^ {5}(fact|place) · \w{3} \d{1,2} \w{3} \d{4} · mem_\S+$/);
    }
    expect(shownIds(r.out).length).toBe(shown);
    expect(r.out[r.out.length - 1]).toMatch(/^More: --full for /);
    const printed = r.out.join("\n");
    expect(printed).not.toContain("\u001b[");
    // The leads-not-answers line is gone from the short answer (owner,
    // 2026-09-24); --full's tier legend keeps it.
    expect(printed).not.toContain("treat these as leads");
    expect(printed).not.toContain("vividly");
    // None of the full page's machinery.
    expect(printed).not.toContain("considered ");
    expect(printed).not.toContain("vivid = ");
  });

  test("the gist: a title when there is one, else the first words, newlines collapsed, cut with an ellipsis", () => {
    expect(askGist("Fernbrook Point", "whatever the body says")).toBe("Fernbrook Point");
    const body = "The lighthouse\nstands on a granite shelf\n\n" + "and its lamp turned by clockwork ".repeat(10);
    const gist = askGist(null, body);
    expect(gist.includes("\n")).toBe(false);
    expect(gist.startsWith("The lighthouse stands on a granite shelf and its lamp")).toBe(true);
    expect(gist.endsWith("…")).toBe(true);
    expect(gist.length).toBeLessThanOrEqual(ASK_GIST_CHARS + 1);
    expect(askGist(null, "short\nbody")).toBe("short body");
  });

  test("the gist takes a chapter's heading off the front — either form, stacked or not — and heading marks off", () => {
    // The two shapes the owner's live store printed on 2026-09-24.
    expect(askGist(null, "## chapter 1 — lived day 2\n\nMike opened by telling me my memory had been swapped.")).toBe(
      "Mike opened by telling me my memory had been swapped.",
    );
    expect(askGist(null, "## chapter 1 — lived day 3\n\n## chapter 1\n\nMike opened a planning session.")).toBe(
      "Mike opened a planning session.",
    );
    // The form written since.
    expect(askGist(null, "## chapter 2 — Wed 23 Sep 2026 · lived day 2\n\nThe evening.")).toBe("The evening.");
    // Other markdown headings lose their marks, not their words.
    expect(askGist(null, "# The plan\n\n### step one\nread it")).toBe("The plan step one read it");
    expect(askGist("## A titled chapter", "## chapter 1 — lived day 0\n\nbody")).toBe("A titled chapter");
    // A heading and nothing else still gets a line rather than a blank.
    expect(askGist(null, "## chapter 1 — lived day 0\n")).toBe("chapter 1 — lived day 0");
    // Words that merely mention a chapter are left alone.
    expect(askGist(null, "chapter 3 of the book was slow")).toBe("chapter 3 of the book was slow");
  });

  test("the quiet line: kind, chapter, the date, the lived day, the id — the heading's date first, else learnedOn", () => {
    const base = { id: "mem_0a1b2c3d4e5f", kind: "self", journal: false };
    expect(askMeta({ ...base, body: "## chapter 1 — lived day 2\n\nMike opened." }, "2026-09-23")).toBe(
      "self · chapter 1 · Wed 23 Sep 2026 · lived day 2 · mem_0a1b2c3d4e5f",
    );
    // The heading's own (local) date outranks the UTC provenance date.
    expect(askMeta({ ...base, body: "## chapter 1 — Thu 24 Sep 2026 · lived day 3\n\nLate." }, "2026-09-25")).toBe(
      "self · chapter 1 · Thu 24 Sep 2026 · lived day 3 · mem_0a1b2c3d4e5f",
    );
    // A journal opens with `journal`, and a multi-chapter one names the span.
    expect(
      askMeta(
        { id: "epi_0f1e2d3c4b5a", kind: "self", journal: true, body: "## chapter 1 — lived day 2\n\nA.\n\n## chapter 3 — lived day 2\n\nB." },
        "2026-09-23",
      ),
    ).toBe("journal · chapters 1–3 · Wed 23 Sep 2026 · lived day 2 · epi_0f1e2d3c4b5a");
    // A plain memory: kind, date, id.
    expect(askMeta({ id: "mem_5a4b3c2d1e0f", kind: "entity", journal: false, body: "Han asked." }, "2026-09-23")).toBe(
      "entity · Wed 23 Sep 2026 · mem_5a4b3c2d1e0f",
    );
    // No date to say: none is invented.
    expect(askMeta({ id: "mem_x", kind: "fact", journal: false, body: "b" }, null)).toBe("fact · mem_x");
  });

  test("on a terminal the quiet line is dim; NO_COLOR and a pipe keep it plain", async () => {
    seedLighthouse();
    const run2 = async (tty: boolean, e: Record<string, string | undefined>): Promise<string[]> => {
      const c = consoleOf();
      const io: Io = { ...c.io, tty: { stdin: false, stdout: tty } };
      await run(["ask", "the lighthouse at Fernbrook Point", "--dir", dir], { io, env: e, home: join(work, "home") });
      return c.out;
    };
    const lit = await run2(true, env({ TERM: "xterm" }));
    const quiet = lit.filter((l) => l.startsWith("     "));
    expect(quiet.length).toBeGreaterThan(0);
    for (const l of quiet) expect(l).toMatch(/^ {5}\u001b\[2m.* · mem_\S+\u001b\[0m$/);
    // Only the quiet line: the words line is never painted.
    for (const l of lit.filter((l) => /^ {2}\d\. /.test(l))) expect(l).not.toContain("\u001b[");
    expect((await run2(true, env({ TERM: "xterm", NO_COLOR: "1" }))).join("\n")).not.toContain("\u001b[");
    expect((await run2(false, env({ TERM: "xterm" }))).join("\n")).not.toContain("\u001b[");
  });

  test("more than five: 'The top 5', the first five in the answer's own order, and --full named", () => {
    // A fresh store's answers are all `dim`, and the dim tier is capped at five
    // (`DELIBERATE_DIM_CAP`), so a lived-in store's longer answer is built here.
    const memories = Array.from({ length: 8 }, (_, i) => ({
      id: `mem_${String(i).padStart(12, "0")}`,
      tier: i < 2 ? "vivid" : "quiet",
      kind: i === 3 ? "place" : "fact",
      title: i % 2 === 0 ? `Title ${String(i)}` : null,
      journal: i === 4,
      body: `Body ${String(i)}\nsecond line`,
      strength: 1,
      activation: 1,
    }));
    const result = {
      path: "question",
      semantic: "in-line",
      reason: "answered",
      memories,
      considered: 40,
      storeSize: 90,
      ambiguous: [],
    } as unknown as DeliberateResult;
    const c = consoleOf();
    printAskList(c.io, result, "by meaning and words", "ask", {
      learnedOn: (id) => (id.endsWith("3") ? "2026-09-23" : null),
    });
    expect(c.out).toEqual([
      "8 memories found, by meaning and words. The top 5:",
      "",
      "  1. Title 0",
      "     fact · mem_000000000000",
      "",
      "  2. Body 1 second line",
      "     fact · mem_000000000001",
      "",
      "  3. Title 2",
      "     fact · mem_000000000002",
      "",
      "  4. Body 3 second line",
      "     place · Wed 23 Sep 2026 · mem_000000000003",
      "",
      "  5. Title 4",
      "     journal · mem_000000000004",
      "",
      "More: --full for all of them with detail, or --id <id> for one in full.",
    ]);
  });

  test("five or fewer: no 'top', and every one is listed", async () => {
    const s = Store.open({ dir });
    for (const body of FILLER) s.put({ type: "memory", kind: "fact", body });
    const id = s.put({ type: "memory", kind: "fact", title: "Fernbrook Point", body: "The lighthouse at Fernbrook Point stopped turning in 1974." });
    s.close();
    const r = await ask(["the lighthouse at Fernbrook Point"]);
    expect(r.out[1]).toMatch(/^\d (memory|memories) found, by [^:]+\.$/);
    expect(r.out[r.out.length - 1]).toBe("More: --full for detail, or --id <id> for one in full.");
    const at = r.out.findIndex((l) => / {2}\d\. Fernbrook Point$/.test(l));
    expect(at).toBeGreaterThan(0);
    expect(r.out[at + 1]).toMatch(new RegExp(`^ {5}fact · \\w{3} \\d{1,2} \\w{3} \\d{4} · ${id}$`));
  });

  test("nothing found is still an answer, and says what to try next", async () => {
    seedLighthouse();
    const r = await ask(["xylophone quokka"], env({ [STATIC_WEIGHTS_ENV]: join(work, "no-table-here") }));
    expect(r.out[1]).toBe("Nothing found (by words only — the meaning table could not be loaded).");
    expect(r.out.join("\n")).toContain("counterparts ask --id <mem_...>");
  });

  test("--full is the page ask printed before: the path line, every body in full, the tier legend", async () => {
    seedLighthouse();
    const r = await ask(["the lighthouse at Fernbrook Point", "--full"]);
    expect(r.out[0]).toBe(`Store: ${dir}`);
    expect(r.out[1]).toMatch(
      /^question · answered · semantic \S+ · considered \d+ of \d+ live rows · returned \d+$/,
    );
    const printed = r.out.join("\n");
    // Every answer the payload holds, each with its body indented beneath it.
    const json = await ask(["the lighthouse at Fernbrook Point", "--json"]);
    const answers = (JSON.parse(json.out.join("\n")) as { memories: { id: string; body: string }[] }).memories;
    expect(answers.length).toBeGreaterThan(0);
    for (const m of answers) {
      expect(printed).toContain(`  ${m.id}  [`);
      expect(printed).toContain(`    ${m.body.split("\n")[0] ?? ""}`);
    }
    expect(printed).toMatch(/ {2}(vivid|quiet|dim) = /);
  });

  test("--id is one memory in full, however short the default has become", async () => {
    const ids = seedLighthouse();
    const id = ids[6] as string;
    const r = await ask(["--id", id]);
    expect(r.code).toBe(EXIT.ok);
    const printed = r.out.join("\n");
    expect(printed).toContain("expanded");
    expect(printed).toContain("    and its lamp was turned by clockwork until the keeper left in 1974, after which nobody climbed it.");
  });

  test("--json is unchanged: the payload, and nothing else", async () => {
    seedLighthouse();
    const r = await ask(["the lighthouse at Fernbrook Point", "--json"]);
    const payload = JSON.parse(r.out.join("\n")) as Record<string, unknown>;
    expect(payload["path"]).toBe("question");
    expect(Array.isArray(payload["memories"])).toBe(true);
    expect((payload["memories"] as unknown[]).length).toBeGreaterThan(0);
    expect(r.out.some((l) => l.startsWith("Store:"))).toBe(false);
  });
});

describe("ask searches by meaning", () => {
  test("recall by meaning switched OFF in the configuration: words only, and the header says so", async () => {
    seedLighthouse();
    const config = join(work, "claude-code.json");
    writeFileSync(config, JSON.stringify({ dataDir: dir, embedder: { enabled: false } }));
    const r = await ask(["the lighthouse at Fernbrook Point"], env({ COUNTERPARTS_CONFIG: config }));
    expect(r.out[1]).toContain("found, by words only — recall by meaning is off.");
    const full = await ask(["the lighthouse at Fernbrook Point", "--full"], env({ COUNTERPARTS_CONFIG: config }));
    expect(full.out[1]).toContain("semantic embedder-off");
    // The flag names the same file the variable does.
    const flagged = await ask(["the lighthouse at Fernbrook Point", "--config", config]);
    expect(flagged.code).toBe(EXIT.ok);
    expect(flagged.out[1]).toContain("found, by words only — recall by meaning is off.");
  });

  test("a configuration that will not resolve is not a reason to refuse a question", async () => {
    seedLighthouse();
    const r = await ask(["the lighthouse at Fernbrook Point"], env({ COUNTERPARTS_CONFIG: "relative/claude-code.json" }));
    expect(r.code).toBe(EXIT.ok);
    expect(r.out[1]).toMatch(HEADER);
  });

  test.skipIf(WEIGHTS === null)(
    "WITH the table: a memory that shares no word with the question comes back, and the header says by meaning",
    async () => {
      // The store's rows are embedded at write time, as a hook's are.
      const table = openStaticEmbedder({ env: {} });
      const s = Store.open({ dir, embed: table.embed });
      for (const body of FILLER) s.put({ type: "memory", kind: "fact", body });
      const target = s.put({
        type: "memory",
        kind: "fact",
        body: "My physician prescribed antibiotics for the chest infection.",
      });
      s.close();
      const question = "which medicine did the doctor give me";
      // Not one word in common, stop words aside.
      const words = (t: string): Set<string> => new Set(t.toLowerCase().match(/[a-z]+/g) ?? []);
      const shared = [...words(question)].filter((w) => words("My physician prescribed antibiotics for the chest infection.").has(w));
      expect(shared.filter((w) => !["the", "for", "my", "me", "did", "which"].includes(w))).toEqual([]);

      const r = await ask([question], env({}));
      expect(r.out[1]).toMatch(/^\d+ (memory|memories) found, by meaning and words\./);
      expect(shownIds(r.out)).toContain(target);

      // And by words alone the same question does not reach it: the meaning did.
      const config = join(work, "off.json");
      writeFileSync(config, JSON.stringify({ dataDir: dir, embedder: { enabled: false } }));
      const off = await ask([question, "--json"], env({ COUNTERPARTS_CONFIG: config }));
      const ids = (JSON.parse(off.out.join("\n")) as { memories: { id: string }[] }).memories.map((m) => m.id);
      expect(ids).not.toContain(target);
    },
  );
});

describe("note embeds on write", () => {
  const TARGET = "My physician prescribed antibiotics for the chest infection.";
  const QUESTION = "which medicine did the doctor give me";
  const NO_TABLE = (): Record<string, string | undefined> => env({ [STATIC_WEIGHTS_ENV]: join(work, "no-table-here") });

  async function note(text: string, e = env()): Promise<{ code: number; out: string[]; err: string[] }> {
    const c = consoleOf();
    const code = await run(["note", text, "--dir", dir], { io: c.io, env: e, home: join(work, "home") });
    return { code, out: c.out, err: c.err };
  }

  function idOf(out: readonly string[]): string {
    const id = /^Remembered (mem_\S+) /.exec(out.find((l) => l.startsWith("Remembered ")) ?? "")?.[1];
    expect(id).toBeDefined();
    return id as string;
  }

  /** Box 3 read directly: the widths held for one id, every width held, and the tag. */
  function box3(id: string): { dims: number[]; widths: number[]; tag: string | undefined } {
    const db = openDb(paths.cache(dir));
    try {
      return {
        dims: db.all<{ dim: number }>("SELECT dim FROM embeddings WHERE memory_id = ?", id).map((r) => r.dim),
        widths: db.all<{ dim: number }>("SELECT DISTINCT dim FROM embeddings").map((r) => r.dim),
        tag: db.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = 'embedder'")?.value,
      };
    } finally {
      db.close();
    }
  }

  function seedFiller(embed?: Embedder): void {
    const s = Store.open({ dir, ...(embed === undefined ? {} : { embed }) });
    try {
      for (const body of FILLER) s.put({ type: "memory", kind: "fact", body });
    } finally {
      s.close();
    }
  }

  test.skipIf(WEIGHTS === null)(
    "a CLI note carries a vector at once, and a paraphrase sharing no content word finds it — no worker ran",
    async () => {
      seedFiller();
      const n = await note(TARGET);
      expect(n.code).toBe(EXIT.ok);
      expect(n.err).toEqual([]);
      const id = idOf(n.out);
      const table = openStaticEmbedder({ env: {} });
      const held = box3(id);
      expect(held.dims).toEqual([table.embed.identity?.dim as number]);
      expect(held.tag).toBe(`${table.model}@${String(table.embed.identity?.dim)}`);

      const r = await ask([QUESTION]);
      expect(r.out[1]).toMatch(/^\d+ (memory|memories) found, by meaning and words\./);
      expect(shownIds(r.out)).toContain(id);

      // By words alone the same question does not reach it: the note's vector did.
      const config = join(work, "off.json");
      writeFileSync(config, JSON.stringify({ dataDir: dir, embedder: { enabled: false } }));
      const off = await ask([QUESTION, "--json"], env({ COUNTERPARTS_CONFIG: config }));
      const ids = (JSON.parse(off.out.join("\n")) as { memories: { id: string }[] }).memories.map((m) => m.id);
      expect(ids).not.toContain(id);
    },
  );

  test("without the table the note still lands, by words alone, and says nothing of it", async () => {
    seedFiller();
    const n = await note(TARGET, NO_TABLE());
    expect(n.code).toBe(EXIT.ok);
    expect(n.err).toEqual([]);
    expect(n.out).toEqual([`Store: ${dir}`, expect.stringMatching(/^Remembered mem_\S+ — /)]);
    const id = idOf(n.out);
    expect(box3(id).dims).toEqual([]);
    const r = await ask(["physician antibiotics chest infection"], NO_TABLE());
    expect(shownIds(r.out)).toContain(id);
  });

  test("recall by meaning switched off in the configuration: the note writes no vector", async () => {
    seedFiller();
    const config = join(work, "off.json");
    writeFileSync(config, JSON.stringify({ dataDir: dir, embedder: { enabled: false } }));
    for (const e of [env({ COUNTERPARTS_CONFIG: config }), env()]) {
      const c = consoleOf();
      const flagged = e["COUNTERPARTS_CONFIG"] === undefined ? ["--config", config] : [];
      const text = flagged.length === 0 ? TARGET : "The boiler was serviced in March by the new plumber.";
      const code = await run(["note", text, "--dir", dir, ...flagged], { io: c.io, env: e, home: join(work, "home") });
      expect(code).toBe(EXIT.ok);
      expect(box3(idOf(c.out)).dims).toEqual([]);
    }
  });

  test.skipIf(WEIGHTS === null)(
    "a store whose vectors are another model's: the note lands without a vector, and the tag is untouched",
    async () => {
      // A paid seat's rows are held, never dropped, and no second model's vector
      // is written beside them (`store/cache.ts#reconcileEmbedder`).
      const paid: EmbedderIdentity = { model: "paid-elsewhere", dim: 8, rebuild: "external" };
      seedFiller(Object.assign((): number[] => [1, 0, 0, 0, 0, 0, 0, 0], { identity: paid }));
      expect(box3("none").tag).toBe("paid-elsewhere@8");

      const n = await note(TARGET);
      expect(n.code).toBe(EXIT.ok);
      expect(n.err).toEqual([]);
      const after = box3(idOf(n.out));
      expect(after.dims).toEqual([]);
      expect(after.tag).toBe("paid-elsewhere@8");
      expect(after.widths).toEqual([8]);
    },
  );
});

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
import { ASK_GIST_CHARS, ASK_SHOWN, EXIT, askGist, printAskList, run } from "../src/adapters/cli/commands.js";
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

describe("ask is short by default", () => {
  test("a header in plain words, then the answers — one line each: id, kind, title or first words", async () => {
    seedLighthouse();
    const r = await ask(["the lighthouse at Fernbrook Point"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out[0]).toBe(`Store: ${dir}`);
    const found = Number(/^(\d+) found /.exec(r.out[1] ?? "")?.[1] ?? "0");
    expect(found).toBeGreaterThan(0);
    expect(r.out[1]).toMatch(/^\d+ found \(by (meaning and words|words only — [^)]+)\)/);
    const rows = r.out.slice(2).filter((l) => /^ {2}mem_/.test(l));
    expect(rows.length).toBe(Math.min(found, ASK_SHOWN));
    for (const row of rows) {
      expect(row).toMatch(/^ {2}mem_\S+ {2}\S+ +\S.*$/);
      expect(row.includes("\n")).toBe(false);
    }
    // Nothing else but, at most, the one leads-not-answers line.
    const rest = r.out.slice(2).filter((l) => !/^ {2}mem_/.test(l));
    expect(rest.length).toBeLessThanOrEqual(1);
    for (const line of rest) expect(line).toContain("treat these as leads");
    // None of the full page's machinery.
    const printed = r.out.join("\n");
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

  test("more than five: 'showing 5', the first five in the answer's own order, and --full named", () => {
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
    printAskList(c.io, result, "by meaning and words", "ask");
    expect(c.out[0]).toBe("8 found (by meaning and words) · showing 5 — --full for all, --id <id> for one");
    expect(c.out.slice(1)).toEqual([
      "  mem_000000000000  fact     Title 0",
      "  mem_000000000001  fact     Body 1 second line",
      "  mem_000000000002  fact     Title 2",
      "  mem_000000000003  place    Body 3 second line",
      "  mem_000000000004  journal  Title 4",
    ]);
  });

  test("five or fewer: no 'showing', and every one is listed", async () => {
    const s = Store.open({ dir });
    for (const body of FILLER) s.put({ type: "memory", kind: "fact", body });
    const id = s.put({ type: "memory", kind: "fact", title: "Fernbrook Point", body: "The lighthouse at Fernbrook Point stopped turning in 1974." });
    s.close();
    const r = await ask(["the lighthouse at Fernbrook Point"]);
    expect(r.out[1]).toMatch(/^\d found \(by [^)]+\) — --full for detail, --id <id> for one$/);
    expect(r.out.some((l) => l.startsWith(`  ${id}  fact  Fernbrook Point`))).toBe(true);
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
    expect(r.out[1]).toContain("(by words only — recall by meaning is off)");
    const full = await ask(["the lighthouse at Fernbrook Point", "--full"], env({ COUNTERPARTS_CONFIG: config }));
    expect(full.out[1]).toContain("semantic embedder-off");
    // The flag names the same file the variable does.
    const flagged = await ask(["the lighthouse at Fernbrook Point", "--config", config]);
    expect(flagged.code).toBe(EXIT.ok);
    expect(flagged.out[1]).toContain("(by words only — recall by meaning is off)");
  });

  test("a configuration that will not resolve is not a reason to refuse a question", async () => {
    seedLighthouse();
    const r = await ask(["the lighthouse at Fernbrook Point"], env({ COUNTERPARTS_CONFIG: "relative/claude-code.json" }));
    expect(r.code).toBe(EXIT.ok);
    expect(r.out[1]).toMatch(/^\d+ found \(by /);
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
      expect(r.out[1]).toMatch(/^\d+ found \(by meaning and words\)/);
      expect(r.out.some((l) => l.startsWith(`  ${target}  `))).toBe(true);

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
      expect(r.out[1]).toMatch(/^\d+ found \(by meaning and words\)/);
      expect(r.out.some((l) => l.startsWith(`  ${id}  `))).toBe(true);

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
    expect(r.out.some((l) => l.startsWith(`  ${id}  `))).toBe(true);
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

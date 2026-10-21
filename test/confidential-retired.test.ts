/**
 * CONFIDENTIAL MEMORIES, RETIRED (2026-10-21, Mike's call). The `confidential`
 * meta key a caller could pass through the store API is inert: the column is
 * written 0 and no core or MCP gate reads it, so a memory carrying the key is
 * answered like any other. The one-time count of rows still holding 1 is
 * written once, and doctor names it only while any remain. Since v14 (the
 * same day) the column is gone: the upgrade that drops it takes the count
 * first, so an "older store" here is a v13 file (`stripV14`) with the column
 * at 1.
 *
 * Hermetic: a fresh temp store per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import { run } from "../src/adapters/cli/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { confidentialRetiredFindings } from "../src/adapters/claude-code/doctor.js";
import { CONFIDENTIAL_RETIRED_KEY, Store, paths } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { Database } from "bun:sqlite";
import { stripV14 } from "./store-fixture.js";

const SESSION = "sess_conf_retired";
const SCOPE = "/scope/conf-retired";
const WORDS = "The zqmarble clinic appointment about the migraines is on Thursday.";

let root: string;
let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-confidential-retired-"));
  dir = join(root, "store");
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

function put(s: Store, body: string, over: Partial<PutInput> = {}): string {
  const day = s.livedDay();
  return s.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    origin: { scope: SCOPE },
    ...over,
  });
}

function payload(r: ToolResult): Record<string, unknown> {
  return r.structuredContent;
}

/** This (closed) store, back to v13 with the retired column, `marked` at 1 and no count yet. */
function backToV13(marked: readonly string[], counted = false): void {
  const db = new Database(paths.operational(dir));
  stripV14(db);
  for (const id of marked) db.run("UPDATE memories SET confidential = 1 WHERE id = ?", [id]);
  if (!counted) db.run("DELETE FROM meta WHERE key = ?", [CONFIDENTIAL_RETIRED_KEY]);
  db.run("UPDATE meta SET value = '13' WHERE key = 'schemaVersion'");
  db.close();
}

describe("the meta key is inert", () => {
  test("there is no column to write (v14): the key is kept in meta as given, on a write and on a revise", () => {
    const s = Store.open({ dir });
    open.push(s);
    expect(s.hasColumn("memories", "confidential")).toBe(false);
    const a = put(s, WORDS, { meta: { confidential: true } });
    const b = put(s, "A second zqmarble note, classed the old way.", { meta: { confidentiality: "secret" } });
    expect(s.read(a).doc.meta["confidential"]).toBe(true);
    expect(s.read(b).doc.meta["confidentiality"]).toBe("secret");
    const c = put(s, "A plain zqmarble memory, marked later.");
    s.revise(c, { meta: { confidential: true }, reason: "test" });
    expect(s.read(c).doc.meta["confidential"]).toBe(true);
  });

  test("a session that is not the owner's recalls it by question, by id and by meaning, and nothing says withheld", async () => {
    const seed = Store.open({ dir });
    const id = put(seed, WORDS, { meta: { confidential: true } });
    seed.close();
    const guest = openServer({ dir, session: SESSION, scope: SCOPE });
    open.push(guest.counterpart);

    const byId = payload(await guest.call("recall", { ids: [id] }));
    expect(byId["reason"]).toBe("expanded");
    expect(JSON.stringify(byId)).toContain("zqmarble clinic");
    expect(JSON.stringify(byId)).not.toContain("withheld");

    const byHandle = payload(await guest.call("recall", { handle: id }));
    expect(byHandle["reason"]).toBe("expanded");
    expect(byHandle["withheld"]).toBeUndefined();

    const facts = await guest.call("recall", { question: "zqmarble clinic appointment", mode: "facts" });
    expect(JSON.stringify(facts)).toContain(id);
    expect(JSON.stringify(facts)).not.toContain("confidential");

    const meaning = await guest.call("recall", { question: "What is the zqmarble clinic appointment about?", mode: "meaning" });
    expect(JSON.stringify(meaning)).not.toContain("confidential");
  });
});

describe("the one-time count of rows still marked", () => {
  /** A store as an older build left it (v13): two live rows holding 1, one archived, and no record yet. */
  function olderStore(): { marked: string[] } {
    const s = Store.open({ dir });
    const a = put(s, "Old marked one.");
    const b = put(s, "Old marked two.");
    const gone = put(s, "Old marked, archived.");
    put(s, "Old plain one.");
    s.archive(gone, "test");
    s.close();
    backToV13([a, b, gone]);
    return { marked: [a, b].sort() };
  }

  test("counted once at the next writable open (the v14 upgrade, before its drop), amber in doctor, and a second open does not rewrite it", () => {
    const { marked } = olderStore();
    const s = Store.open({ dir });
    const raw = s.getMeta(CONFIDENTIAL_RETIRED_KEY);
    expect(raw).toBeDefined();
    const record = JSON.parse(raw as string) as { count: number; ids: string[]; at: number; day: string };
    expect(record.count).toBe(2);
    expect(record.ids).toEqual(marked);
    const [line] = confidentialRetiredFindings(s);
    expect(line?.severity).toBe("amber");
    expect(line?.detail).toContain("2 memories marked confidential through the store API are still here (2 when counted)");
    expect(line?.fix).toContain("counterparts remove");
    expect(String(line?.data["ids"])).toBe(marked.join(", "));
    // Nothing else was changed: the rows are live, with their words; the column is gone.
    for (const id of marked) expect(s.read(id).doc.body).toContain("Old marked");
    expect(s.hasColumn("memories", "confidential")).toBe(false);
    s.close();

    const again = Store.open({ dir });
    open.push(again);
    expect(again.getMeta(CONFIDENTIAL_RETIRED_KEY)).toBe(raw as string);
  });

  test("the line counts what is still here: one removed leaves 1, both removed and doctor is no longer amber; the record stays as counted", async () => {
    const { marked } = olderStore();
    Store.open({ dir }).close();
    const remove = async (id: string): Promise<void> => {
      // The owner's own door, confirmed by typing the id, as at a terminal.
      const said: string[] = [];
      const io = {
        out: (l: string) => said.push(l),
        err: (l: string) => said.push(l),
        prompt: async (): Promise<string> => id,
        tty: { stdin: true, stdout: true },
      };
      const code = await run(["remove", id, "--confirm", "--dir", dir], { io, env: {} });
      expect({ code, said: said.join("\n") }).toMatchObject({ code: 0 });
    };
    await remove(marked[0] as string);
    let s = Store.open({ dir, observer: true });
    const [one] = confidentialRetiredFindings(s);
    expect(one?.severity).toBe("amber");
    expect(one?.detail).toContain("1 memory marked confidential through the store API is still here (2 when counted)");
    expect(String(one?.data["ids"])).toBe(marked[1] as string);
    s.close();
    await remove(marked[1] as string);
    s = Store.open({ dir, observer: true });
    open.push(s);
    expect(confidentialRetiredFindings(s)).toEqual([]);
    expect(JSON.parse(s.getMeta(CONFIDENTIAL_RETIRED_KEY) as string)).toMatchObject({ count: 2, ids: marked });
  });

  test("past the 50 ids the record keeps, the rest are counted as still here, and the line says so", () => {
    const s = Store.open({ dir });
    open.push(s);
    s.setMeta(CONFIDENTIAL_RETIRED_KEY, JSON.stringify({ count: 52, ids: [], at: 0, day: "2026-10-21" }));
    const [line] = confidentialRetiredFindings(s);
    expect(line?.severity).toBe("amber");
    expect(line?.detail).toContain("52 memories");
    expect(line?.detail).toContain("the other 52 are counted as still here");
  });

  test("an observer open writes nothing; a fresh store records 0 and doctor says nothing", () => {
    olderStore();
    const watcher = Store.open({ dir, observer: true });
    expect(watcher.getMeta(CONFIDENTIAL_RETIRED_KEY)).toBeUndefined();
    expect(confidentialRetiredFindings(watcher)).toEqual([]);
    watcher.close();

    const freshDir = join(root, "fresh");
    const fresh = Store.open({ dir: freshDir });
    open.push(fresh);
    expect(JSON.parse(fresh.getMeta(CONFIDENTIAL_RETIRED_KEY) as string)).toMatchObject({ count: 0, ids: [] });
    expect(confidentialRetiredFindings(fresh)).toEqual([]);
  });
});

describe("an upgraded store's marked rows (the column at 1 before the v14 drop) on the adapters' surfaces", () => {
  /** One memory as an older build left it (v13): the meta key, and the column at 1. */
  function oldMarked(): string {
    const s = Store.open({ dir });
    const id = put(s, "ZQOLDMARK The clinic appointment about the migraines is on Thursday.", { meta: { confidential: true } });
    s.close();
    backToV13([id], true);
    return id;
  }

  function console_(): { out: string[]; err: string[]; io: { out(l: string): void; err(l: string): void } } {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (l) => out.push(l), err: (l) => err.push(l) } };
  }

  test("export --markdown carries it, with no omitted line on the terminal or in the manifest", async () => {
    const id = oldMarked();
    const target = join(root, "tree");
    const c = console_();
    expect(await run(["export", "--dir", dir, "--out", target, "--markdown", "--plaintext"], { io: c.io, env: {} })).toBe(0);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(target, "memories", "fact", `${id}.md`), "utf8")).toContain("ZQOLDMARK");
    // (The temp path itself holds the word "confidential", so the check is for the old sentences.)
    expect(c.out.join("\n")).not.toMatch(/left out|omitted|withheld/i);
    expect(readFileSync(join(target, "README.md"), "utf8")).not.toMatch(/confidential|omitted/i);
  });

  test("the remove list prints its words and no [confidential] marker", async () => {
    const id = oldMarked();
    const c = console_();
    const io = { ...c.io, prompt: async (): Promise<string> => "n", tty: { stdin: true, stdout: true } };
    // `env: {}`, never the runner's own: with `CI` set (GitHub Actions sets it)
    // the console is not interactive and `remove` reads the words as an id.
    await run(["remove", "--dir", dir, "ZQOLDMARK"], { io, env: {} });
    const printed = c.out.join("\n");
    expect(printed).toContain(id);
    expect(printed).toContain("ZQOLDMARK");
    expect(printed).not.toContain("[confidential]");
  });
});

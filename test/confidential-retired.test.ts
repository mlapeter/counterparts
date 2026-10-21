/**
 * CONFIDENTIAL MEMORIES, RETIRED (2026-10-21, Mike's call). The `confidential`
 * meta key a caller could pass through the store API is inert: the column is
 * written 0 and no core or MCP gate reads it, so a memory carrying the key is
 * answered like any other in a session that is not the owner's. What stays is
 * checked beside it: the stance still keeps a thread opened in another
 * directory, and the last exchange, to the owner. The one-time count of rows
 * still holding 1 is written once, and doctor names it only when above 0.
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
import { Counterpart } from "../src/core/counterpart.js";
import { CONFIDENTIAL_RETIRED_KEY, Store } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";

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

function column(s: Store, id: string): number {
  return (s["ops"].get("SELECT confidential FROM memories WHERE id = ?", id) as { confidential: number }).confidential;
}

describe("the meta key is inert", () => {
  test("a write stores 0 whatever the meta says, and a revise that sets the key stores 0 too", () => {
    const s = Store.open({ dir });
    open.push(s);
    const a = put(s, WORDS, { meta: { confidential: true } });
    const b = put(s, "A second zqmarble note, classed the old way.", { meta: { confidentiality: "secret" } });
    expect(column(s, a)).toBe(0);
    expect(column(s, b)).toBe(0);
    expect(s.read(a).doc.meta["confidential"]).toBe(true);
    const c = put(s, "A plain zqmarble memory, marked later.");
    s.revise(c, { meta: { confidential: true }, reason: "test" });
    expect(column(s, c)).toBe(0);
  });

  test("a session that is not the owner's recalls it by question, by id and by meaning, and nothing says withheld", async () => {
    const seed = Store.open({ dir });
    const id = put(seed, WORDS, { meta: { confidential: true } });
    seed.close();
    const guest = openServer({ dir, session: SESSION, scope: SCOPE, owner: false });
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

describe("what the stance still decides", () => {
  test("not the owner's (the night run's COUNTERPARTS_OWNER=0): a thread written in another directory is still not closed, a marked one here is", async () => {
    const guest = Counterpart.open({ dir, owner: false });
    open.push(guest);
    const thread = put(guest.store, "Is the zqmarble invoice paid yet?", { origin: { scope: "/scope/elsewhere" }, meta: { unresolved: true } });
    const there = await guest.submitJot({ content: "The zqmarble invoice was paid on Monday; nothing is owed now.", updates: thread, unresolved: false }, { session: "s-night", scope: SCOPE });
    expect(there.thread).toEqual({ from: thread, closed: false, refused: "other-directory" });
    expect(guest.store.read(thread).doc.meta["unresolved"]).toBe(true);
    const marked = put(guest.store, "Is the zqmarble lease renewed yet?", { meta: { unresolved: true, confidential: true } });
    const here = await guest.submitJot({ content: "The zqmarble lease renewed for two more years.", updates: marked, unresolved: false }, { session: "s-night", scope: SCOPE });
    expect(here.thread).toEqual({ from: marked, closed: true });
  });

  test("not the owner's: the last exchange is still owner-only", async () => {
    Counterpart.open({ dir }).close();
    const guest = openServer({ dir, session: SESSION, scope: SCOPE, owner: false });
    open.push(guest.counterpart);
    const got = payload(await guest.call("recall", { handle: "last exchange" }));
    expect(got["reason"]).toBe("owner-only");
  });
});

describe("the one-time count of rows still marked", () => {
  /** A store as an older build left it: two live rows holding 1, one archived, and no record yet. */
  function olderStore(): { marked: string[] } {
    const s = Store.open({ dir });
    const a = put(s, "Old marked one.");
    const b = put(s, "Old marked two.");
    const gone = put(s, "Old marked, archived.");
    put(s, "Old plain one.");
    s.archive(gone, "test");
    s["ops"].run("UPDATE memories SET confidential = 1 WHERE id IN (?, ?, ?)", a, b, gone);
    s["ops"].run("DELETE FROM meta WHERE key = ?", CONFIDENTIAL_RETIRED_KEY);
    s.close();
    return { marked: [a, b].sort() };
  }

  test("counted once at the next writable open, amber in doctor, and a second open does not rewrite it", () => {
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
    // Nothing was changed: the rows are live and still hold what they held.
    for (const id of marked) expect(column(s, id)).toBe(1);
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
      const code = await run(["remove", id, "--confirm", "--dir", dir], { io });
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

describe("an upgraded store's marked rows (the column still 1) on the adapters' surfaces", () => {
  /** One memory as an older build left it: the meta key, and the column at 1. */
  function oldMarked(): string {
    const s = Store.open({ dir });
    const id = put(s, "ZQOLDMARK The clinic appointment about the migraines is on Thursday.", { meta: { confidential: true } });
    s["ops"].run("UPDATE memories SET confidential = 1 WHERE id = ?", id);
    s.close();
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
    expect(await run(["export", "--dir", dir, "--out", target, "--markdown", "--plaintext"], { io: c.io })).toBe(0);
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
    await run(["remove", "--dir", dir, "ZQOLDMARK"], { io });
    const printed = c.out.join("\n");
    expect(printed).toContain(id);
    expect(printed).toContain("ZQOLDMARK");
    expect(printed).not.toContain("[confidential]");
  });
});

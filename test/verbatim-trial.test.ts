/**
 * The verbatim trial, 2026-10-11 (very lightly held; docs/CHECK-AFTER.md): a
 * list, a table or a pasted text whose specifics matter is kept word for word
 * in the memory's own body. What it rests on: the writing tools ask for it;
 * nothing on the write path cuts a long body (`remember` and `session_end`
 * store it whole, `recall` by id reads it whole, in parts past 8,000
 * characters); and a facts line says when its excerpt hides a list or a table.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { blockOf } from "../src/adapters/mcp/facts.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { TOOLS } from "../src/adapters/mcp/tools.js";

const SCOPE = "/Users/someone/proj";
let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-verbatim-"));
  dir = join(root, "store");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A ~6 KB list, the shape the benchmark lost: a hundred items, each with its specifics. */
function list(where: string): string {
  const items = Array.from(
    { length: 100 },
    (_, i) => `${String(i + 1)}. ${["Red", "Blue", "Green", "Amber"][i % 4]!} bracket, ${where} bay ${String(i % 7)}, qty ${String(i * 3)}, reordered on ${String(1 + (i % 28))} September`,
  );
  return `Mike's ${where} inventory as he pasted it on 2026-10-11:\n${items.join("\n")}`;
}

type Result = { isError?: boolean; structuredContent: Record<string, unknown>; content?: { text: string }[] };

describe("the writing tools ask for lists, tables and pasted texts word for word", () => {
  test("remember's text and session_end's content say so, with the search words in the title and first line", () => {
    const field = (tool: string): Record<string, unknown> => {
      const props = TOOLS.find((t) => t.name === tool)!.inputSchema["properties"] as Record<string, Record<string, unknown>>;
      return tool === "remember" ? props["text"]! : ((props["memories"]!["items"] as Record<string, unknown>)["properties"] as Record<string, Record<string, unknown>>)["content"]!;
    };
    for (const tool of ["remember", "session_end"]) {
      const text = String(field(tool)["description"]);
      expect(text).toContain("A list, a table or a pasted text whose specifics matter: keep it here word for word, not summarized");
      expect(text).toContain("the words someone would search for (what it is, whose, when) in the title and the first line");
    }
    expect(String(field("remember")["description"])).toMatch(/Required unless `settle`, `feelingsNow`, `remark` or `core` is sent\.$/);
  });
});

describe("nothing on the write path cuts a long body", () => {
  test("remember and session_end store a 6 KB list whole; recall by id reads it whole", async () => {
    const shelf = list("shelf");
    const garage = list("garage");
    expect(shelf.length).toBeGreaterThan(6_000);
    const s = openServer({ dir, session: "s-verbatim", scope: SCOPE });
    try {
      const a = (await s.call("remember", { text: shelf, title: "Mike's shelf inventory, 100 items (2026-10-11)" })) as Result;
      expect(a.structuredContent["stored"]).toBe(true);
      const e = (await s.call("session_end", {
        session: "s-verbatim",
        memories: [{ content: garage, title: "Mike's garage inventory, 100 items (2026-10-11)" }],
      })) as Result;
      const outcome = (e.structuredContent["outcomes"] as { stored: boolean; id: string }[])[0]!;
      expect(outcome.stored).toBe(true);
      const ids = [String(a.structuredContent["id"]), outcome.id];
      expect(s.counterpart.store.read(ids[0]!).doc.body).toBe(shelf);
      expect(s.counterpart.store.read(ids[1]!).doc.body).toBe(garage);
      const back = (await s.call("recall", { ids })) as Result;
      const memories = back.structuredContent["memories"] as { id: string; excerpt: string; truncated?: boolean }[];
      expect(memories.find((m) => m.id === ids[0])!.excerpt).toBe(shelf);
      expect(memories.find((m) => m.id === ids[1])!.excerpt).toBe(garage);
    } finally {
      s.counterpart.close();
    }
  });

  test("a body past one result comes back in parts that join to the whole", async () => {
    const pasted = Array.from({ length: 4 }, (_, i) => list(`room ${String(i)}`)).join("\n\n");
    expect(pasted.length).toBeGreaterThan(8_000 * 2);
    const s = openServer({ dir, session: "s-verbatim", scope: SCOPE });
    try {
      const a = (await s.call("remember", { text: pasted, title: "Mike's four room inventories (2026-10-11)" })) as Result;
      const id = String(a.structuredContent["id"]);
      let joined = "";
      let parts = 1;
      for (let part = 1; part <= parts; part++) {
        const r = (await s.call("recall", { ids: [id], part })) as Result;
        const m = (r.structuredContent["memories"] as { excerpt: string; parts?: number }[])[0]!;
        parts = m.parts ?? 1;
        joined += m.excerpt;
      }
      expect(parts).toBeGreaterThan(1);
      expect(joined).toBe(pasted);
    } finally {
      s.counterpart.close();
    }
  });
});

describe("a facts line says when its excerpt hides a list or a table", () => {
  test("a remembered list is found by its title's words, and its excerpt ends saying it is a list of 100", async () => {
    const w = openServer({ dir, session: "s-write", scope: SCOPE });
    let id: string;
    try {
      const a = (await w.call("remember", { text: list("shelf"), title: "Mike's shelf inventory, 100 items (2026-10-11)" })) as Result;
      id = String(a.structuredContent["id"]);
      await w.call("remember", { text: "Mike keeps the spare brackets in the blue tote by the door." });
    } finally {
      w.counterpart.close();
    }
    const r = openServer({ dir, session: "s-read", scope: SCOPE });
    try {
      const f = (await r.call("recall", { question: "Mike's shelf inventory", mode: "facts" })) as Result;
      const answer = String(f.structuredContent["answer"]);
      expect(f.structuredContent["ids"]).toContain(id);
      expect(answer).toContain("… (a list, 100 items; read whole by id)");
      // A short memory with no list says nothing of the kind.
      const g = (await r.call("recall", { question: "spare brackets blue tote", mode: "facts" })) as Result;
      expect(String(g.structuredContent["answer"])).toContain("blue tote");
      expect(String(g.structuredContent["answer"])).not.toContain("read whole by id)");
    } finally {
      r.counterpart.close();
    }
  });

  test("two different lists of the same shape are two results; one list pasted twice is one (review of #409)", async () => {
    const w = openServer({ dir, session: "s-write", scope: SCOPE });
    const ids: string[] = [];
    try {
      for (const where of ["shelf", "attic", "basement"]) {
        const a = (await w.call("remember", { text: list(where), title: `Mike's ${where} inventory, 100 items (2026-10-11)` })) as Result;
        ids.push(String(a.structuredContent["id"]));
      }
      // The shelf list again, retitled, one count fixed: a repost, not a new list.
      const again = (await w.call("remember", { text: list("shelf").replace("qty 9,", "qty 10,"), title: "Shelf stock as pasted" })) as Result;
      expect(again.structuredContent["stored"]).toBe(true);
      // Other memories, so "inventory" is not in every one (a word in all of them weighs nothing).
      for (const n of ["the dog walk at dusk", "the oolong tea", "the river path", "the blue tote"]) await w.call("remember", { text: `Mike mentioned ${n}.` });
    } finally {
      w.counterpart.close();
    }
    const r = openServer({ dir, session: "s-read", scope: SCOPE });
    try {
      const f = (await r.call("recall", { question: "inventory", mode: "facts" })) as Result;
      const got = f.structuredContent["ids"] as string[];
      for (const id of ids.slice(1)) expect(got).toContain(id);
      expect(got.length).toBe(3);
      expect(String(f.structuredContent["answer"])).toContain("1 near-duplicate of a result shown left out");
    } finally {
      r.counterpart.close();
    }
  });

  test("blockOf names a list or a table, and not a few lines", () => {
    expect(blockOf(list("shelf"))).toBe("a list, 100 items");
    expect(blockOf("- one\n- two\n* three\n• four\n+ five")).toBe("a list, 5 items");
    expect(blockOf("Shifts:\n1. Ann\n2. Bo\nthat is all")).toBeNull();
    const table = ["| day | who | hours |", "|---|---|---|", "| Mon | Ann | 9-5 |", "| Tue | Bo | 10-6 |", "| Wed | Cy | 9-1 |"].join("\n");
    expect(blockOf(table)).toBe("a table, 3 rows");
    expect(blockOf("A paragraph of prose, nothing listed in it. Another sentence follows.")).toBeNull();
  });
});

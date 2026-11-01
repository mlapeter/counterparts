/**
 * A MEMORY THAT DID NOT LAND IS NOT CLAIMED (2026-11-01).
 *
 * The claim (the content ledger's row, the coverage marks) was written before the
 * mint. A mint that threw left a ledger row refusing the retry as a duplicate and
 * marks calling the words written up, with no memory behind either: the note was
 * gone, and its raw line went on the 3-day clock.
 *
 * Through the real door on a temp store. The lock is a real second connection
 * holding `BEGIN IMMEDIATE`; only the server's busy wait is shortened, so a test
 * isn't five seconds each. The kill is a real child process, SIGKILLed inside its
 * busy wait. The write-up door's own case is in `write-up.test.ts`, beside the
 * helpers that point a session at a part.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SpanBuffer, keyFor, retentionSources } from "../src/core/remember/index.js";
import type { ProposalRecord } from "../src/core/remember/index.js";
import { planUnboundLines } from "../src/core/remember/owes.js";
import { DATABASE_FILE } from "../src/core/store/paths.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";

const SESSION = "11111111-1111-4111-8111-111111111111";
const NOTE = "The owner keeps the cabin booking for the third week of March, whatever the agent says.";
const ENTRY = { content: "The cabin's lake view room was confirmed for the spring by its owner.", kind: "fact" };

let root: string;
let dir: string;
let scope: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-mint-claim-")));
  dir = join(root, "store");
  scope = join(root, "project");
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

function server(session: string | null = SESSION): McpServer {
  const s = openServer({ dir, scope, ...(session === null ? {} : { session }) });
  open.push(s.counterpart);
  // A real lock, and no need to sit out the five seconds of it.
  shortWait(s);
  return s;
}

function shortWait(s: McpServer): void {
  const store = s.counterpart.store as unknown as { ops: { exec(sql: string): void }; cache: { exec(sql: string): void } };
  store.ops.exec("PRAGMA busy_timeout = 50");
  store.cache.exec("PRAGMA busy_timeout = 50");
}

/** A second connection holding the write lock, for as long as `body` runs. */
async function withLock<T>(file: string, body: () => Promise<T>): Promise<T> {
  const lock = new Database(file);
  lock.exec("BEGIN IMMEDIATE");
  try {
    return await body();
  } finally {
    lock.exec("ROLLBACK");
    lock.close();
  }
}

const storeFile = (): string => join(dir, DATABASE_FILE);
const cacheFile = (): string => join(dir, "cache", "cache.sqlite");
const memoryIds = (s: McpServer): string[] => s.counterpart.store.list({ type: "memory" });
const payload = (r: { structuredContent?: Record<string, unknown> }): Record<string, unknown> => r.structuredContent ?? {};
const ledger = (s: McpServer): ProposalRecord[] => s.counterpart.spans.proposalRecords<ProposalRecord>(scope);
const lineHashes = (s: McpServer): string[] => s.counterpart.spans.spans(scope).filter((x) => x.kind === "jot").map((x) => x.hash);

describe("remember: a mint that threw, through the real door under a real lock", () => {
  test("told plainly, nothing claimed, the line kept; the retry lands exactly one memory, and the next is a duplicate", async () => {
    const s = server();
    const failed = await withLock(storeFile(), () => s.call("remember", { text: NOTE }));
    // The caller is told, with what to do.
    expect(failed.isError).toBe(true);
    expect(payload(failed)["stored"]).toBe(false);
    expect(payload(failed)["reason"]).toBe("threw");
    expect(String(payload(failed)["detail"])).toContain("database is locked");
    expect(String(payload(failed)["detail"])).toContain("send the same thing again");

    // Nothing on disk says it landed: no memory, no ledger row, no claim. Its line is there.
    expect(memoryIds(s)).toEqual([]);
    expect(ledger(s)).toEqual([]);
    expect(s.counterpart.spans.coverage(scope)).toEqual([]);
    expect(lineHashes(s)).toHaveLength(1);

    // The lock is gone, the same call again.
    const retried = await s.call("remember", { text: NOTE });
    expect(payload(retried)["stored"]).toBe(true);
    const id = payload(retried)["id"] as string;
    expect(memoryIds(s)).toEqual([id]);

    // The memory, its ledger row and its claim name one proposal, and it took its own
    // line: one line still, claimed now, and the span removal chases.
    const records = ledger(s);
    expect(records).toHaveLength(1);
    const row = s.counterpart.store.row(id);
    expect(row?.origin_ref).toBe(records[0]?.id as string);
    expect(lineHashes(s)).toHaveLength(1);
    const marks = s.counterpart.spans.coverage(scope);
    expect(marks.map((m) => m.spanHash)).toEqual(lineHashes(s));
    expect(marks[0]?.proposalId).toBe(records[0]?.id as string);
    expect(marks[0]?.own).toBe(true);
    expect(records[0]?.covers).toEqual(lineHashes(s));

    // A third send is what a repeat has always been.
    const third = await s.call("remember", { text: NOTE });
    expect(payload(third)["reason"]).toBe("duplicate-content");
    expect(memoryIds(s)).toEqual([id]);
    expect(ledger(s)).toHaveLength(1);
  });

  test("a note nobody retried reads as owed: it passes the 3-day clock and goes at the 14-day ceiling", async () => {
    // Sessionless, the bucket whose lines go on their own age (`owes.ts#planUnboundLines`).
    const s = server(null);
    await withLock(storeFile(), () => s.call("remember", { text: NOTE }));
    expect(memoryIds(s)).toEqual([]);
    const at = s.counterpart.spans.spans(scope)[0]?.at as number;
    const due = (days: number): number => {
      const later = new SpanBuffer({ dir, now: () => at + days * 86_400_000 });
      return planUnboundLines(later, retentionSources(s.counterpart.store)).reduce((n, a) => n + a.lines, 0);
    };
    expect(due(4)).toBe(0);
    expect(due(13)).toBe(0);
    expect(due(15)).toBe(1);
  });

  test("a store that took the row and threw at its index: the memory stands, claimed, and a retry doesn't mint a twin", async () => {
    const s = server();
    const failed = await withLock(cacheFile(), () => s.call("remember", { text: NOTE }));
    expect(payload(failed)["reason"]).toBe("threw");
    const ids = memoryIds(s);
    expect(ids).toHaveLength(1);
    expect(ledger(s)).toHaveLength(1);
    expect(s.counterpart.store.row(ids[0] as string)?.origin_ref).toBe(ledger(s)[0]?.id as string);
    expect(s.counterpart.spans.coverage(scope)).toHaveLength(1);
    expect(s.counterpart.events().some((e) => e.name === "counterpart.deposit.mint.failed" && e.data?.["landed"] === true)).toBe(true);

    const retried = await s.call("remember", { text: NOTE });
    expect(payload(retried)["reason"]).toBe("duplicate-content");
    expect(memoryIds(s)).toEqual(ids);
  });

  test("a memory that landed and later faded still answers duplicate-content", async () => {
    const s = server();
    const id = payload(await s.call("remember", { text: NOTE }))["id"] as string;
    s.counterpart.store.archive(id, "test");
    const again = await s.call("remember", { text: NOTE });
    expect(payload(again)["reason"]).toBe("duplicate-content");
    expect(memoryIds(s)).toEqual([id]);
  });

  test("the failure leaves a row the log and doctor read", async () => {
    const s = server();
    await withLock(storeFile(), () => s.call("remember", { text: NOTE }));
    const event = s.counterpart.events().find((e) => e.name === "counterpart.deposit.mint.failed");
    expect(event?.data).toMatchObject({ source: "jot", landed: false });
    // Ids and codes only: the note's words are in no event.
    expect(JSON.stringify(s.counterpart.events())).not.toContain("cabin");
  });
});

describe("a real kill inside the mint", () => {
  test("SIGKILL during the store's busy wait: no claim on disk, and a new process's retry lands one memory", async () => {
    const child = join(root, "kid.ts");
    const mcp = fileURLToPath(new URL("../src/adapters/mcp/index.ts", import.meta.url));
    const started = join(root, "started");
    writeFileSync(
      child,
      [
        `import { writeFileSync } from "node:fs";`,
        `import { openServer } from ${JSON.stringify(mcp)};`,
        `const [dir, scope, session, text, started, go] = process.argv.slice(2) as [string, string, string, string, string, string];`,
        `const s = openServer({ dir, scope, session });`,
        `writeFileSync(started, "ready");`,
        `while (!(await Bun.file(go).exists())) await Bun.sleep(5);`,
        `await s.call("remember", { text });`,
        `process.exit(7);`,
      ].join("\n"),
      "utf8",
    );
    const go = join(root, "go");
    const kid = Bun.spawn([process.execPath, child, dir, scope, SESSION, NOTE, started, go], { stdout: "ignore", stderr: "ignore" });
    while (!existsSync(started)) await Bun.sleep(10);

    const lock = new Database(storeFile());
    lock.exec("BEGIN IMMEDIATE");
    writeFileSync(go, "");
    // The line lands before the mint, so once it's there the child is at the gate or
    // in the store's five-second wait, well inside it for what follows.
    const jots = join(dir, "spans", keyFor(scope), "jots.jsonl");
    while (!existsSync(jots) || readFileSync(jots, "utf8").length === 0) await Bun.sleep(10);
    await Bun.sleep(1_000);
    kid.kill("SIGKILL");
    expect(await kid.exited).not.toBe(7);
    lock.exec("ROLLBACK");
    lock.close();

    const s = server();
    expect(memoryIds(s)).toEqual([]);
    expect(ledger(s)).toEqual([]);
    expect(s.counterpart.spans.coverage(scope)).toEqual([]);
    expect(lineHashes(s)).toHaveLength(1);

    const retried = await s.call("remember", { text: NOTE });
    expect(payload(retried)["stored"]).toBe(true);
    expect(memoryIds(s)).toHaveLength(1);
    expect(lineHashes(s)).toHaveLength(1);
    expect(s.counterpart.spans.coverage(scope)).toHaveLength(1);
  }, 30_000);
});

describe("session_end: a mint that threw", () => {
  test("the session's words stay unclaimed, and the retry lands and claims them", async () => {
    const s = server();
    s.counterpart.captureSpans({ session: SESSION, scope, turns: [{ role: "user", text: "A long talk about the cabin and the lake in the spring, with the dates still open." }] });
    const spans = s.counterpart.spans.spans(scope).length;
    expect(spans).toBeGreaterThan(0);

    const failed = await withLock(storeFile(), () => s.call("session_end", { session: SESSION, memories: [ENTRY] }));
    const outcome = (payload(failed)["outcomes"] as Record<string, unknown>[])[0];
    expect(outcome?.["reason"]).toBe("threw");
    expect(failed.isError).toBe(true);
    expect(memoryIds(s)).toEqual([]);
    expect(ledger(s)).toEqual([]);
    // The first entry of a session_end claims all it has said: this is where a
    // thrown mint cost the most, a whole stretch read as written up on the 3-day clock.
    expect(s.counterpart.spans.coverage(scope)).toEqual([]);

    const retried = await s.call("session_end", { session: SESSION, memories: [ENTRY] });
    expect(payload(retried)["deposited"]).toBe(1);
    expect(memoryIds(s)).toHaveLength(1);
    expect(s.counterpart.spans.coverage(scope)).toHaveLength(spans);
    const third = await s.call("session_end", { session: SESSION, memories: [ENTRY] });
    expect((payload(third)["outcomes"] as Record<string, unknown>[])[0]?.["reason"]).toBe("duplicate-content");
    expect(memoryIds(s)).toHaveLength(1);
  });
});

describe("the ledger still decides first when it can't be written", () => {
  test("no memory, no claim, and the same answer as ever", async () => {
    const s = server();
    await s.call("remember", { text: "A first note, so the scope and its ledger file are there on disk." });
    const before = s.counterpart.spans.coverage(scope).length;
    const file = join(dir, "spans", keyFor(scope), "proposals.jsonl");
    chmodSync(file, 0o400);
    const out = await s.call("remember", { text: NOTE });
    chmodSync(file, 0o600);
    expect(payload(out)["reason"]).toBe("io-failed");
    expect(memoryIds(s)).toHaveLength(1);
    expect(s.counterpart.spans.coverage(scope)).toHaveLength(before);
    expect(payload(await s.call("remember", { text: NOTE }))["stored"]).toBe(true);
    expect(memoryIds(s)).toHaveLength(2);
  });
});

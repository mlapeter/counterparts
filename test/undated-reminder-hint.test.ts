/**
 * An undated reminder is SAID at write time (2026-10-12): a `remember` or a
 * `session_end` entry that reads like a reminder (a reminder word and a date
 * shape) but carries no `eventDate` comes back with a `reminderHint`. It never
 * sets or guesses the date and never refuses. Hermetic: a fresh temp dir.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer, ToolResult } from "../src/adapters/mcp/index.js";
import { readsLikeReminder } from "../src/adapters/mcp/server-args.js";

let dir: string;
const open: { close(): void }[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-undated-"));
});
afterEach(() => {
  for (const c of open.splice(0)) c.close();
  rmSync(dir, { recursive: true, force: true });
});
function server(): McpServer {
  const s = openServer({ dir, session: "sess_undated", scope: "/scope/one" });
  open.push(s.counterpart);
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03"]) s.counterpart.store.advanceClock(d);
  return s;
}
const payload = (r: ToolResult): Record<string, unknown> => JSON.parse(r.content[0]?.text ?? "{}") as Record<string, unknown>;

describe("readsLikeReminder", () => {
  test("positives: a reminder word and a date shape", () => {
    for (const t of [
      "Remind Mike to vote (1 of 3, Oct 14): has his ballot arrived?",
      "Remind Mike to vote (2 of 3, Oct 17): did he mail it?",
      "Remind Mike to vote (3 of 3, Oct 20): last day, check it was counted.",
      "Don't forget the dentist on 2026-11-03",
      "Follow up with Dana next week about the lease",
      "Check back on 14 October about the permit",
      "Remind me tomorrow to call the bank",
      "Remind him Friday",
      "remind me on the 15th",
      "remind him in 2 weeks",
      "Reminder: pay taxes by Oct 15",
    ]) expect(readsLikeReminder(t)).toBe(true);
  });
  test("negatives: a memory about a reminder, a date alone, a reminder word alone", () => {
    for (const t of [
      "Why a told reminder still showed under Arriving",
      "Wake bug: a dated reminder was crowded out",
      "The tax deadline drops off Arriving two days before it's due",
      "Mike votes in October",
      "Remind Mike to stretch",
      "Why the 10-12 reminder was told to a hand-back turn",
      "Reminder: stretch more",
    ]) expect(readsLikeReminder(t)).toBe(false);
  });
});

describe("the write-time hint", () => {
  const TITLE = "Remind Mike to vote (1 of 3, Oct 14): has his ballot arrived?";
  test("remember: warns beside the stored result, and does not set a date", async () => {
    const srv = server();
    const out = payload(await srv.call("remember", { title: TITLE, text: "Ask Mike on Oct 14 whether his ballot arrived." }));
    expect(out["id"]).toBeDefined();
    expect(String(out["reminderHint"])).toContain(`updates: ${String(out["id"])}`);
    expect(srv.counterpart.store.row(String(out["id"]))?.event_date).toBeNull();
  });
  test("remember: no warning with an eventDate, or for a memory about a reminder", async () => {
    const srv = server();
    expect(payload(await srv.call("remember", { title: TITLE, text: "Ask Mike whether his ballot arrived.", eventDate: "2026-10-14" }))["reminderHint"]).toBeUndefined();
    expect(payload(await srv.call("remember", { text: "Wake bug: a dated reminder was crowded out of the list." }))["reminderHint"]).toBeUndefined();
  });
  test("a revision that carries the date over is not warned", async () => {
    const srv = server();
    const first = String(payload(await srv.call("remember", { text: "Ask Mike about the ballot.", eventDate: "2099-10-14" }))["id"]);
    const out = payload(await srv.call("remember", { text: "Remind Mike on Oct 14 about the ballot, it was mailed.", updates: first }));
    expect(out["reminderHint"]).toBeUndefined();
  });
  test("session_end: warns on the undated entry only", async () => {
    const srv = server();
    const out = payload(
      await srv.call("session_end", {
        memories: [
          { title: TITLE, content: "Ask Mike on Oct 14 whether his ballot arrived." },
          { title: TITLE, content: "Ask Mike whether the ballot arrived.", eventDate: "2026-10-14" },
        ],
      }),
    );
    const outcomes = out["outcomes"] as Record<string, unknown>[];
    expect(outcomes[0]?.["stored"]).toBe(true);
    expect(outcomes[0]?.["reminderHint"]).toBeDefined();
    expect(outcomes[1]?.["reminderHint"]).toBeUndefined();
  });
});

/**
 * Each journal chapter records the model that wrote it (self NOTES §24).
 *
 * The relay: the transcript's last assistant `message.model` → the session
 * registry record (written at every boundary) → the `chapter` tool → the
 * chapter's heading and the episode's `meta.models`. Transcript lines here are
 * synthetic, in the host's shapes; none is copied from a real transcript.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { ClaudeCodeAdapter } from "../src/adapters/claude-code/index.js";
import { parseTranscript } from "../src/adapters/claude-code/transcript.js";
import { askMeta } from "../src/adapters/cli/commands.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { readSession, recordSession } from "../src/adapters/sessions.js";
import { chapterHeading, chapterModels, isModelId, journalFilesFor, readChapterLead } from "../src/core/self/index.js";

const SESSION = "s-chapter-model";
const OPUS = "claude-opus-5-5";
const FABLE = "claude-fable-5-1";

let work: string;
let store: string;
let project: string;
const closers: (() => void)[] = [];

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "counterparts-chapter-model-"));
  store = join(work, "store");
  project = join(work, "project");
  mkdirSync(project, { recursive: true });
});

afterEach(() => {
  for (const close of closers.splice(0)) {
    try {
      close();
    } catch {
      /* already closed */
    }
  }
  rmSync(work, { recursive: true, force: true });
});

const typed = (text: string): Record<string, unknown> => ({
  type: "user",
  origin: { kind: "human" },
  promptSource: "typed",
  message: { role: "user", content: text },
});
const answer = (model: string, text: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "assistant",
  message: { role: "assistant", model, content: [{ type: "text", text }] },
  ...extra,
});
/** The host's stand-in for a failed API call. */
const apiError = (): Record<string, unknown> =>
  answer("<synthetic>", "API Error: overloaded", { isApiErrorMessage: true });

const jsonl = (entries: readonly Record<string, unknown>[]): string =>
  `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;

function adapter(): ClaudeCodeAdapter {
  const a = openAdapter(
    { dataDir: store, injectionBudgetBytes: 9000, owner: true },
    { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 4242 }) },
  );
  closers.push(() => a.counterpart.close());
  return a;
}

function server(): McpServer {
  const s = openServer({ dir: store, scope: project, owner: true });
  closers.push(() => s.counterpart.close());
  return s;
}

function payload(result: { structuredContent?: unknown }): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

describe("the transcript names the model that last answered", () => {
  test("the newest real assistant entry wins; synthetic, API-error and sidechain entries are ignored", () => {
    const read = parseTranscript(
      jsonl([
        typed("Start the parser move."),
        answer(FABLE, "On it."),
        typed("Now the shim."),
        answer(OPUS, "Done."),
        answer("claude-subagent-x", "A subagent's line.", { isSidechain: true }),
        apiError(),
        answer("<synthetic>", "No response requested."),
      ]),
    );
    expect(read.model).toBe(OPUS);
  });

  test("no assistant entry with a model: no model at all", () => {
    expect(parseTranscript(jsonl([typed("Hello.")])).model).toBeUndefined();
    expect(parseTranscript(jsonl([typed("Hello."), apiError()])).model).toBeUndefined();
  });
});

describe("the session record carries it", () => {
  test("a Stop reads it from the transcript onto the record, and a later write without one keeps it", () => {
    const a = adapter();
    recordSession(store, { sessionId: SESSION, scope: project, phase: "start" });
    expect(readSession(store, SESSION)?.model).toBeUndefined();
    const path = join(work, "t.jsonl");
    writeFileSync(path, jsonl([typed("Hello there."), answer(OPUS, "Hi."), apiError()]), "utf8");
    a.stop(toHookInput({ session_id: SESSION, transcript_path: path }, { scope: project }));
    expect(readSession(store, SESSION)?.model).toBe(OPUS);
    // A phase written by a process that knows no model keeps the one there.
    recordSession(store, { sessionId: SESSION, scope: project, phase: "boundary" });
    expect(readSession(store, SESSION)?.model).toBe(OPUS);
    // A /model switch shows at the next boundary.
    recordSession(store, { sessionId: SESSION, scope: project, phase: "boundary", model: FABLE });
    expect(readSession(store, SESSION)?.model).toBe(FABLE);
  });

  test("a value that is not a plain model id is no mark", () => {
    recordSession(store, { sessionId: SESSION, scope: project, phase: "start", model: "<synthetic>" });
    expect(readSession(store, SESSION)?.model).toBeUndefined();
    recordSession(store, { sessionId: SESSION, scope: project, phase: "boundary", model: "two words · lived day 9" });
    expect(readSession(store, SESSION)?.model).toBeUndefined();
    expect(isModelId("claude-opus-5-5[1m]")).toBe(true);
  });
});

describe("the chapter records the model that wrote it", () => {
  test("ACCEPTANCE: two chapters under two models each record their own — heading, meta, markdown copy", async () => {
    const a = adapter();
    recordSession(store, { sessionId: SESSION, scope: project, phase: "start" });
    const path = join(work, "t.jsonl");
    const first = [typed("Let's plan the week."), answer(OPUS, "Here is a plan.")];
    writeFileSync(path, jsonl(first), "utf8");
    a.stop(toHookInput({ session_id: SESSION, transcript_path: path }, { scope: project }));

    const s = server();
    const one = payload(await s.call("chapter", { session: SESSION, text: "The first stretch, in my own words." }));
    expect(one["stored"]).toBe(true);
    expect(one["chapter"]).toBe(1);
    const episodeId = one["episodeId"] as string;
    let doc = s.counterpart.store.readProse(episodeId);
    expect(doc.body).toMatch(/^## chapter 1 — \w{3} \d{1,2} \w{3} \d{4} · claude-opus-5-5 · lived day \d+\n/);
    expect(chapterModels(doc.meta)).toEqual({ "1": OPUS });

    // The person switches model; the next Stop records it.
    writeFileSync(path, jsonl([...first, typed("Switch it up."), answer(FABLE, "Switched.")]), "utf8");
    a.stop(toHookInput({ session_id: SESSION, transcript_path: path }, { scope: project }));
    expect(readSession(store, SESSION)?.model).toBe(FABLE);

    expect(s.counterpart.episodeAsk(SESSION, { turns: 40, bytes: 40_000 }).chapter).toBe(2);
    const two = payload(await s.call("chapter", { session: SESSION, text: "The second stretch, after the switch." }));
    expect(two["chapter"]).toBe(2);
    doc = s.counterpart.store.readProse(episodeId);
    expect(doc.body).toMatch(/\n## chapter 2 — \w{3} \d{1,2} \w{3} \d{4} · claude-fable-5-1 · lived day \d+\n/);
    expect(doc.body).toContain("· claude-opus-5-5 ·");
    expect(chapterModels(doc.meta)).toEqual({ "1": OPUS, "2": FABLE });

    // A further append inside chapter 2 keeps both entries (meta merges shallowly).
    await s.call("chapter", { session: SESSION, text: "And one more line." });
    expect(chapterModels(s.counterpart.store.readProse(episodeId).meta)).toEqual({ "1": OPUS, "2": FABLE });

    // The markdown copy carries the same headings.
    const files = journalFilesFor(store, episodeId);
    expect(files.length).toBe(1);
    const copy = readFileSync(join(store, files[0] as string), "utf8");
    expect(copy).toMatch(/## chapter 1 — [^\n]* · claude-opus-5-5 · lived day \d+/);
    expect(copy).toMatch(/## chapter 2 — [^\n]* · claude-fable-5-1 · lived day \d+/);
  });

  test("unknown model: the heading is the dated form, with no placeholder and no meta entry", async () => {
    recordSession(store, { sessionId: SESSION, scope: project, phase: "start" });
    const s = server();
    const one = payload(await s.call("chapter", { session: SESSION, text: "An older session, no model on record." }));
    const doc = s.counterpart.store.readProse(one["episodeId"] as string);
    expect(doc.body).toMatch(/^## chapter 1 — \w{3} \d{1,2} \w{3} \d{4} · lived day \d+\n/);
    expect(doc.body).not.toContain("unknown");
    expect(doc.meta["models"]).toBeUndefined();
  });
});

describe("the heading and its readers", () => {
  test("date · model · lived day, and the reader reads every form", () => {
    expect(chapterHeading(1, 2, "2026-09-23", OPUS)).toBe("## chapter 1 — Wed 23 Sep 2026 · claude-opus-5-5 · lived day 2");
    expect(chapterHeading(1, 2, "2026-09-23")).toBe("## chapter 1 — Wed 23 Sep 2026 · lived day 2");
    expect(chapterHeading(1, 2, "2026-09-23", "<synthetic>")).toBe("## chapter 1 — Wed 23 Sep 2026 · lived day 2");
    expect(chapterHeading(1, 2, undefined, OPUS)).toBe("## chapter 1 — claude-opus-5-5 · lived day 2");

    expect(readChapterLead("## chapter 3 — Wed 23 Sep 2026 · claude-opus-5-5[1m] · lived day 2\n\n## chapter 3\n\nWords.")).toEqual({
      chapters: [3],
      livedDay: 2,
      date: "Wed 23 Sep 2026",
      model: "claude-opus-5-5[1m]",
      rest: "Words.",
    });
    expect(readChapterLead("## chapter 1 — Wed 23 Sep 2026 · lived day 2\n\nWords.").model).toBeNull();
  });

  test("`ask`'s meta line shows the model beside the date, and nothing when there is none", () => {
    const row = { id: "mem_0a1b2c3d4e5f", kind: "self", journal: true };
    expect(askMeta({ ...row, body: `${chapterHeading(1, 2, "2026-09-23", OPUS)}\n\nWords.` }, "2026-09-23")).toBe(
      "journal · chapter 1 · Wed 23 Sep 2026 · claude-opus-5-5 · lived day 2 · mem_0a1b2c3d4e5f",
    );
    expect(askMeta({ ...row, body: `${chapterHeading(1, 2, "2026-09-23")}\n\nWords.` }, "2026-09-23")).toBe(
      "journal · chapter 1 · Wed 23 Sep 2026 · lived day 2 · mem_0a1b2c3d4e5f",
    );
  });
});

describe("the row records it too — schema v7's `model` column (2026-09-25)", () => {
  test("a bound session's chapter, note, session_end entry and page write each carry the model", async () => {
    recordSession(store, { sessionId: SESSION, scope: project, phase: "start", model: OPUS });
    const s = server();
    const chapter = payload(await s.call("chapter", { session: SESSION, text: "The stretch so far, in my own words." }));
    expect(s.counterpart.store.read(chapter["episodeId"] as string).model).toBe(OPUS);

    const note = payload(await s.call("note", { text: "The kiln at the studio runs hot on the left side, so glaze tests go right." }));
    expect(note["stored"]).toBe(true);
    expect(s.counterpart.store.read(note["id"] as string).model).toBe(OPUS);

    const ended = payload(
      await s.call("session_end", {
        session: SESSION,
        memories: [{ content: "The studio's second kiln needs its thermocouple replaced before the next firing." }],
      }),
    );
    const entry = (ended["outcomes"] as Record<string, unknown>[])[0] ?? {};
    expect(entry["stored"]).toBe(true);
    expect(s.counterpart.store.read(entry["id"] as string).model).toBe(OPUS);

    const page = payload(await s.call("self_page", { body: "## Who I am\n\nSomeone who keeps glaze notes." }));
    expect(page["stored"]).toBe(true);
    const pageId = s.counterpart.selfPage()?.id as string;
    expect(s.counterpart.store.read(pageId).model).toBe(OPUS);
  });

  test("an unbound note records NULL — never a guess", async () => {
    const s = server();
    const note = payload(await s.call("note", { text: "A note from a server that never learned its session's model." }));
    expect(note["stored"]).toBe(true);
    expect(s.counterpart.store.read(note["id"] as string).model).toBeNull();
  });
});

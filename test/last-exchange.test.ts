/**
 * "LAST SAID HERE" AND `recall` "last exchange" (2026-10-11; Mike's design of
 * 2026-10-10, "pull, not push"; details the builder's, lightly held).
 *
 * A fresh session in a folder gets one line pointing at the last exchange in
 * that folder — the most recently active OTHER session there, within about a
 * day:
 *
 *   Last said here, 09:10 (session a1b2c3d4): "<first words>…" — recall "last exchange"
 *
 * and the handle returns both messages, each cut at a sentence. Pinned here,
 * through the real hooks (`ClaudeCodeAdapter`) and the real recall tool:
 *   - the line names the latest other session HERE, never another folder's,
 *     never the reader's own;
 *   - rituals (the end-of-session ask and its answer), host injections (a
 *     reminder, a task notification, a subagent's hand-back, a slash-command
 *     echo, a pasted wake) and tool-only turns are not the owner's words;
 *   - the caps hold (the line's bytes, the quote's words, each message's
 *     1,200 characters cut at a sentence);
 *   - a session killed after a prompt and before its Stop is named by what its
 *     last turn-end captured — the host's transcript is never read; and a
 *     compaction summary makes the reader step back one exchange;
 *   - no line past about a day;
 *   - room: on the owner's morning (9,000 bytes, a ~5.9 KB page, four
 *     handoffs, a due reminder, Last here, another active folder) the line
 *     prints and the page, the due reminder and Still open's first item are
 *     what they are without it; with less room it is the first thing given up;
 *   - nothing stored: the handle writes no row; under observer it stands down
 *     like the rest of recall, and only the owner's session gets the words.
 *
 * Hermetic: every test opens a fresh temp dir and removes it; every word is
 * invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { parseTranscript } from "../src/adapters/claude-code/transcript.js";
import { McpServer } from "../src/adapters/mcp/server.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeVerdict } from "../src/adapters/scopes.js";
import { recordSession } from "../src/adapters/sessions.js";
import { CUE_MODE_META } from "../src/core/prospective/index.js";
import {
  LAST_EXCHANGE_LINE_MAX_BYTES,
  LAST_EXCHANGE_TEXT_MAX_CHARS,
  LAST_EXCHANGE_WORDS,
  headAtSentence,
  lastExchangeLine,
  ownerWords,
  tailAtSentence,
  withExchange,
} from "../src/core/handoff/last-exchange.js";
import { FRAMING, PAGE_END_LINES, readSentinel } from "../src/core/self/index.js";
import { readableDate } from "../src/core/time.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const ZONE = "UTC";
const BUDGET = 9_000;
const D = "2026-10-11";
const D2 = "2026-10-12";
const day = (ymd: string): number => Date.parse(`${ymd}T00:00:00Z`);
const at = (h: number, m = 0, ymd = D): number => day(ymd) + h * HOUR + m * MIN;
const iso = (t: number): string => new Date(t).toISOString();

/** Sessions: A and A2 worked HERE before; C worked THERE; B opens HERE now. */
const A = "a1b2c3d4-0000-4000-8000-00000000000a";
const A2 = "a2a2a2a2-0000-4000-8000-0000000000a2";
const B = "b5b6b7b8-0000-4000-8000-00000000000b";
const C = "c9cacbcc-0000-4000-8000-00000000000c";

let root: string;
let storeDir: string;
let HERE: string;
let THERE: string;
/** Where the host keeps HERE's transcripts (one project folder per directory). */
let PROJECT: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-lx-")));
  storeDir = join(root, "store");
  HERE = join(root, "garden");
  THERE = join(root, "bakery");
  PROJECT = join(root, "claude", "projects", HERE.replace(/[^a-zA-Z0-9]/g, "-"));
  for (const d of [HERE, THERE, PROJECT]) mkdirSync(d, { recursive: true });
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

// ── the world ───────────────────────────────────────────────────────────────

interface World {
  c: Counterpart;
  set(t: number): void;
  now(): number;
  hooks(opts?: { mode?: ScopeVerdict["mode"] }): ClaudeCodeAdapter;
}

function world(start: number, opts: { budget?: number; wholeItems?: boolean } = {}): World {
  let now = start;
  // `wholeItems`: no line form (#489 C), for a morning whose lanes must need the room.
  const c = Counterpart.open({
    dir: storeDir,
    owner: true,
    budgetBytes: opts.budget ?? BUDGET,
    now: () => now,
    timeZone: ZONE,
    ...(opts.wholeItems === true ? { selfTunables: { WAKE_LINE_BYTES: Number.POSITIVE_INFINITY } } : {}),
  });
  open.push(c);
  return {
    c,
    set(t: number) {
      now = t;
    },
    now: () => now,
    hooks(o = {}) {
      return new ClaudeCodeAdapter({
        counterpart: c,
        config: { dataDir: storeDir, owner: true, injectionBudgetBytes: opts.budget ?? BUDGET, timeZone: ZONE },
        configPath: join(root, "claude-code.json"),
        now: () => now,
        scope: { mode: o.mode ?? "on", matched: HERE, entry: null } as ScopeVerdict,
        command: "/bin/true",
        args: ["runner"],
        spawner: () => ({ pid: 4242 }),
      });
    },
  };
}

type Entry = Record<string, unknown>;
const stamp = (t: number | undefined): Entry => (t === undefined ? {} : { timestamp: iso(t) });
const typed = (text: string, t?: number): Entry => ({ type: "user", userType: "external", origin: { kind: "human" }, promptSource: "typed", message: { role: "user", content: text }, ...stamp(t) });
const said = (text: string, t?: number): Entry => ({ type: "assistant", message: { role: "assistant", model: "claude-test", content: [{ type: "text", text }] }, ...stamp(t) });
const tool = (i: number, t?: number): Entry[] => [
  { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: `t${String(i)}`, name: "Bash", input: {} }] }, ...stamp(t) },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${String(i)}`, content: "ok" }] }, ...stamp(t) },
];
const reminder = (t?: number): Entry => ({ type: "user", isMeta: true, message: { role: "user", content: "<system-reminder>REMINDERWORDS from the host.</system-reminder>" }, ...stamp(t) });
const notification = (t?: number): Entry => ({
  type: "user",
  origin: { kind: "task-notification" },
  promptSource: "system",
  message: { role: "user", content: "<task-notification>\n<task-id>b01</task-id>\n<summary>NOTIFYWORDS the suite finished</summary>\n</task-notification>" },
  ...stamp(t),
});
const handBack = (t?: number): Entry => ({
  type: "user",
  isMeta: true,
  origin: { kind: "peer" },
  promptSource: "system",
  message: { role: "user", content: 'Another Claude session sent a message:\n<agent-message from="a01">\n[Subagent hand-back] The text below is the final report.\n\nHANDBACKWORDS: the beds are mapped.\n\nHANDBACKWORDS second paragraph.\n</agent-message>' },
  ...stamp(t),
});
const ritual = (t?: number): Entry => ({ type: "user", message: { role: "user", content: "Stop hook feedback:\n[bun hook.ts]: Counterparts, before this session closes: RITUALWORDS write it up." }, ...stamp(t) });
const exitEcho = (t?: number): Entry => ({ type: "user", message: { role: "user", content: "<command-name>/exit</command-name>\n<command-message>exit</command-message>" }, ...stamp(t) });

const jsonl = (entries: readonly Entry[]): string => entries.map((e) => JSON.stringify(e)).join("\n");

/** A session's transcript as the host keeps it, growing turn by turn. */
class Session {
  readonly entries: Entry[] = [];
  readonly w: World;
  readonly id: string;
  readonly scope: string;
  constructor(w: World, id: string, scope: string) {
    this.w = w;
    this.id = id;
    this.scope = scope;
    recordSession(storeDir, { sessionId: id, scope, phase: "start", at: w.now() });
  }
  get path(): string {
    return join(PROJECT, `${this.id}.jsonl`);
  }
  add(...e: Entry[]): this {
    this.entries.push(...e);
    writeFileSync(this.path, `${jsonl(this.entries)}\n`);
    return this;
  }
  /** A turn-end at `t`, through the real Stop hook. */
  stop(t: number): this {
    this.w.set(t);
    this.w.hooks().stop({ sessionId: this.id, scope: this.scope, turns: parseTranscript(jsonl(this.entries)).turns, at: D } as HookInput);
    return this;
  }
  end(t: number): this {
    this.w.set(t);
    this.w.hooks().sessionEnd({ sessionId: this.id, scope: this.scope, turns: parseTranscript(jsonl(this.entries)).turns, at: D } as HookInput);
    return this;
  }
}

/** B opens HERE at `t`: what the SessionStart hook hands the model. */
function wakeOf(w: World, t: number, opts: { session?: string; scope?: string; date?: string } = {}): string {
  w.set(t);
  w.c.rebrief({ budgetBytes: BUDGET, at: opts.date ?? D });
  const session = opts.session ?? B;
  return w.hooks().sessionStart({ sessionId: session, scope: opts.scope ?? HERE, at: opts.date ?? D, transcriptPath: join(PROJECT, `${session}.jsonl`) } as HookInput).injection;
}

function lineOf(text: string): string | undefined {
  return text.split("\n").find((l) => l.startsWith("Last said here"));
}

/** The recall tool over the same store and clock, bound to `session` in `scope`. */
function recallServer(w: World, opts: { session?: string; scope?: string; observer?: boolean } = {}): McpServer {
  return new McpServer({
    counterpart: w.c,
    session: opts.session ?? B,
    scope: opts.scope ?? HERE,
    owner: true,
    now: () => w.now(),
    // The server's own observer option is `launchObserver` (review of #392:
    // `observer` is not one, so the test that passed it ran as the owner).
    ...(opts.observer === true ? { launchObserver: true } : {}),
  });
}

async function lastExchangeOf(s: McpServer): Promise<Record<string, unknown>> {
  return (await s.call("recall", { handle: "last exchange" })).structuredContent;
}

function bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

// ── the line ────────────────────────────────────────────────────────────────

describe("the line names the latest other session in this folder", () => {
  test("the latest other session here, by its owner's first words; never another folder's, never the reader's own", () => {
    const w = world(at(9));
    new Session(w, A, HERE).add(reminder(), typed("Let's fix the reserve for the handoff block first, then the ladder after it."), said("Let me look."), ...tool(1), said("Done: the reserve now counts the line.")).stop(at(9, 10));
    // A later session in ANOTHER folder.
    w.set(at(9, 20));
    new Session(w, C, THERE).add(typed("THEREWORDS the rye starter wants feeding."), said("THEREWORDS fed.")).stop(at(9, 30));

    const line = lineOf(wakeOf(w, at(9, 45)));
    expect(line).toBe(`Last said here, 09:10 (session a1b2c3d4): "Let's fix the reserve for the handoff block first, then…" — recall "last exchange"`);
    expect(bytes(line ?? "")).toBeLessThanOrEqual(LAST_EXCHANGE_LINE_MAX_BYTES);

    // THERE's wake names THERE's session, not HERE's.
    const there = lineOf(wakeOf(w, at(9, 50), { session: "d0d0d0d0-0000-4000-8000-00000000000d", scope: THERE }));
    expect(there).toContain("(session c9cacbcc)");
    expect(there).toContain("THEREWORDS");
    expect(there).not.toContain("reserve");

    // A's own session reopening (a compaction, a resume) gets no line about itself.
    expect(lineOf(wakeOf(w, at(9, 55), { session: A }))).toBeUndefined();
  });

  test("of two sessions here, the more recent one — and an ended one counts like a live one", () => {
    const w = world(at(8));
    new Session(w, A, HERE).add(typed("The older session's words about the north bed.")).add(said("Noted.")).stop(at(8, 10)).end(at(8, 15));
    w.set(at(9));
    new Session(w, A2, HERE).add(typed("The newer session's words about the south bed.")).add(said("Noted too.")).stop(at(9, 5));
    expect(lineOf(wakeOf(w, at(9, 30)))).toContain(`(session a2a2a2a2): "The newer session's words about the south bed."`);
  });

  test("no exchange here, no line — the wake is what it was", () => {
    const w = world(at(9));
    new Session(w, C, THERE).add(typed("Words in another folder.")).add(said("Fine.")).stop(at(9, 5));
    const text = wakeOf(w, at(9, 30));
    expect(lineOf(text)).toBeUndefined();
    expect(text).not.toContain("last exchange");
  });

  test("no line past about a day", () => {
    const w = world(at(9));
    new Session(w, A, HERE).add(typed("Words from yesterday morning about the hedge.")).add(said("Yes.")).stop(at(9));
    // The next morning, inside the day: the line, with its date.
    expect(lineOf(wakeOf(w, at(8, 30, D2), { date: D2 }))).toStartWith("Last said here, 10-11 09:00 (session a1b2c3d4)");
    // Past it: nothing.
    expect(lineOf(wakeOf(w, at(9, 30, D2), { date: D2 }))).toBeUndefined();
  });

  test("an off, paused or observer folder hears nothing", () => {
    const w = world(at(9));
    new Session(w, A, HERE).add(typed("Words that would be named.")).add(said("Yes.")).stop(at(9, 5));
    w.set(at(9, 30));
    w.c.rebrief({ budgetBytes: BUDGET, at: D });
    for (const mode of ["off", "paused"] as const) {
      const out = w.hooks({ mode }).sessionStart({ sessionId: B, scope: HERE, at: D } as HookInput);
      expect(out.injection).not.toContain("Last said here");
      expect(out.injection).not.toContain("Words that would be named");
    }
    // An observer folder: the entry point opens the store as an observer
    // (`bin/hook.ts` folds the mode into the config). Its wake is delivered,
    // with no line pointing at a handle that would stand down (review of #392).
    const obs = Counterpart.open({ dir: storeDir, observer: true, owner: true, budgetBytes: BUDGET, now: () => at(9, 30), timeZone: ZONE });
    open.push(obs);
    const hooks = new ClaudeCodeAdapter({
      counterpart: obs,
      config: { dataDir: storeDir, owner: true, observer: true, injectionBudgetBytes: BUDGET, timeZone: ZONE },
      configPath: join(root, "claude-code.json"),
      now: () => at(9, 30),
      scope: { mode: "observer", matched: HERE, entry: null } as ScopeVerdict,
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 4242 }),
    });
    const seen = hooks.sessionStart({ sessionId: B, scope: HERE, at: D } as HookInput).injection;
    expect(seen).toContain("counterparts:wake");
    expect(seen).not.toContain("Last said here");
    expect(seen).not.toContain("Words that would be named");
  });
});

// ── what counts as the owner's words ────────────────────────────────────────

describe("rituals, injections and tool-only turns are not the exchange", () => {
  /** The coordinator's shape: one turn-end holding a reminder, the typed
   *  message, a task notification and a hand-back, with three text blocks
   *  between tool calls; then the end-of-session ask and its answer; then /exit. */
  function mikeShaped(w: World): Session {
    const s = new Session(w, A, HERE);
    s.add(
      reminder(),
      typed("Run the three agents on the bed survey and tell me what they found."),
      said("Starting the three agents now."),
      ...tool(1),
      notification(),
      handBack(),
      said("The second agent is back."),
      ...tool(2),
      said("All three are back. The beds are mapped and the north bed needs lime."),
    ).stop(at(9, 10));
    s.add(ritual(), ...tool(3), said("RITUALANSWER saved two memories.")).stop(at(9, 11));
    s.add(exitEcho()).end(at(9, 12));
    return s;
  }

  test("the line quotes the typed words; the handle's message has no host text, and its reply is the last block, never the ritual's answer", async () => {
    const w = world(at(9));
    mikeShaped(w);
    const line = lineOf(wakeOf(w, at(9, 30)));
    expect(line).toContain(`"Run the three agents on the bed survey and tell…"`);
    const got = await lastExchangeOf(recallServer(w));
    expect(got["reason"]).toBe("last-exchange");
    expect(got["session"]).toBe(A);
    const saidTo = got["said"] as { at: string; text: string };
    const reply = got["reply"] as { at: string; text: string };
    expect(saidTo.text).toBe("Run the three agents on the bed survey and tell me what they found.");
    expect(saidTo.at).toBe("09:10");
    for (const host of ["REMINDERWORDS", "NOTIFYWORDS", "HANDBACKWORDS", "RITUALWORDS", "/exit"]) expect(JSON.stringify(got)).not.toContain(host);
    expect(reply.text).toEndWith("All three are back. The beds are mapped and the north bed needs lime.");
    expect(reply.text).not.toContain("RITUALANSWER");
  });

  test("a turn-end that held only host text, a pasted wake, or a slash command is passed over for the exchange before it", () => {
    const w = world(at(9));
    const s = new Session(w, A, HERE).add(typed("The real question about the compost."), said("The real answer.")).stop(at(9, 5));
    s.add(notification(), said("NOTIFYREPLY noted the suite.")).stop(at(9, 6));
    s.add(typed("<!-- counterparts:wake day=3 elements=1 bytes=80 -->\nPASTEDWAKE words\n<!-- counterparts:wake/end day=3 elements=1 bytes=80 -->")).stop(at(9, 7));
    s.add(exitEcho()).end(at(9, 8));
    expect(lineOf(wakeOf(w, at(9, 30)))).toContain(`"The real question about the compost."`);
  });

  test("a compaction summary at the head of a turn-end steps the reader back one exchange", () => {
    expect(ownerWords("This session is being continued from a previous conversation that ran out of context.\n\nSummary paragraph.\n\nThe typed words after it.")).toBeNull();
    expect(ownerWords("Typed first.\n\n[Subagent hand-back] The text below is a report.\n\nReport body.")).toBe("Typed first.");
    expect(ownerWords("<system-reminder>x</system-reminder>\n\nOnly this.")).toBe("Only this.");
    // An interrupt's marker is dropped where it stands; the words after it are the newest.
    expect(ownerWords("First try.\n\n[Request interrupted by user]\n\nSecond try.")).toBe("First try.\n\nSecond try.");
    expect(ownerWords("[Request interrupted by user for tool use]")).toBeNull();
  });

  test("a tool-only turn-end leaves the last exchange where it was", () => {
    const w = world(at(9));
    const s = new Session(w, A, HERE).add(typed("Words before the tools."), said("A reply with words.")).stop(at(9, 5));
    s.add(...tool(1), ...tool(2)).stop(at(9, 6));
    expect(lineOf(wakeOf(w, at(9, 30)))).toContain(`"Words before the tools."`);
  });
});

// ── caps ────────────────────────────────────────────────────────────────────

describe("the caps hold", () => {
  test("the line's bytes and words; each message 1,200 characters, cut at a sentence", async () => {
    const w = world(at(9));
    const sentence = "The north bed wants lime before the frost, and the south bed wants nothing at all this year. ";
    const long = sentence.repeat(40).trim();
    const reply = `Let me look first. ${"I checked the beds one by one and wrote each down. ".repeat(40)}The last word: lime on the north bed.`;
    new Session(w, A, HERE).add(typed(long), said(reply)).stop(at(9, 5));
    const line = lineOf(wakeOf(w, at(9, 30))) ?? "";
    expect(bytes(line)).toBeLessThanOrEqual(LAST_EXCHANGE_LINE_MAX_BYTES);
    const quote = /: "(.*)" — recall/.exec(line)?.[1] ?? "";
    expect(quote.replace(/…$/, "").split(" ").length).toBeLessThanOrEqual(LAST_EXCHANGE_WORDS);
    const got = await lastExchangeOf(recallServer(w));
    const s = got["said"] as { text: string; cut?: boolean };
    const r = got["reply"] as { text: string; cut?: boolean };
    expect([...s.text].length).toBeLessThanOrEqual(LAST_EXCHANGE_TEXT_MAX_CHARS);
    expect([...r.text].length).toBeLessThanOrEqual(LAST_EXCHANGE_TEXT_MAX_CHARS);
    expect(s.cut).toBe(true);
    expect(r.cut).toBe(true);
    // The owner's from its head, ending on a sentence; the reply from its tail, starting on one.
    expect(s.text).toStartWith("The north bed wants lime");
    expect(s.text).toEndWith("this year.…");
    expect(r.text).toStartWith("…I checked the beds");
    expect(r.text).toEndWith("The last word: lime on the north bed.");
  });

  test("the widest line there can be is within the bound the boundary reserves", () => {
    const now = at(9, 0, D2);
    for (const text of ["ü".repeat(400), "wörterbuch-ähnlich ".repeat(30), "a b c d e f g h i j k l m n"]) {
      const line = lastExchangeLine({ session: A, scope: HERE, said: { text, at: at(18) }, reply: null }, { zone: ZONE, now });
      expect(line).toStartWith("Last said here, 10-11 18:00 (session a1b2c3d4): ");
      expect(bytes(line)).toBeLessThanOrEqual(LAST_EXCHANGE_LINE_MAX_BYTES);
    }
  });

  test("the cutters: whole when short, a sentence when long, a hard cut with none", () => {
    expect(headAtSentence("Short.")).toEqual({ text: "Short.", cut: false });
    expect(tailAtSentence("Short.")).toEqual({ text: "Short.", cut: false });
    const none = "x".repeat(2_000);
    expect([...headAtSentence(none).text].length).toBeLessThanOrEqual(LAST_EXCHANGE_TEXT_MAX_CHARS);
    expect([...tailAtSentence(none).text].length).toBeLessThanOrEqual(LAST_EXCHANGE_TEXT_MAX_CHARS);
  });

  test("a secret in either message is redacted", async () => {
    const w = world(at(9));
    new Session(w, A, HERE).add(typed("Use the key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop for the run."), said("Done.")).stop(at(9, 5));
    const got = JSON.stringify(await lastExchangeOf(recallServer(w)));
    expect(got).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(lineOf(wakeOf(w, at(9, 30))) ?? "").not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  });
});

// ── a session that ended without its Stop ───────────────────────────────────

describe("a crashed session: what its last turn-end captured, and nothing after", () => {
  test("a prompt after the last Stop, and no Stop for it: the line names the last captured exchange; the words after it are not read from anywhere", async () => {
    const w = world(at(9));
    const s = new Session(w, A, HERE).add(typed("The first question about the hedge.", at(9, 1)), said("The first answer.", at(9, 2))).stop(at(9, 3));
    // The person types again; the prompt hook refreshes the registry; the
    // session dies before its Stop. Its transcript has the words; the buffer
    // does not, and the host's transcript is not read (2026-10-11).
    s.add(typed("UNCAPTURED final words about the gate.", at(9, 20)), said("UNCAPTURED half a reply", at(9, 21)));
    recordSession(storeDir, { sessionId: A, scope: HERE, phase: "boundary", at: at(9, 20) });
    const line = lineOf(wakeOf(w, at(9, 40)));
    expect(line).toBe(`Last said here, 09:03 (session a1b2c3d4): "The first question about the hedge." — recall "last exchange"`);
    const got = JSON.stringify(await lastExchangeOf(recallServer(w)));
    expect(got).toContain("The first question about the hedge.");
    expect(got).toContain("The first answer.");
    expect(got).not.toContain("UNCAPTURED");
  });
});

// ── room ────────────────────────────────────────────────────────────────────

describe("its rank: with the handoffs, below every dated item and the page", () => {
  function pageBytes(text: string): number {
    const ls = text.split("\n");
    const from = ls.findIndex((l) => l.startsWith("(My page, "));
    const to = ls.indexOf(PAGE_END_LINES.whole);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    return bytes(ls.slice(from, to + 1).join("\n"));
  }

  function lane(text: string, heading: string): string[] {
    const lines = text.split("\n");
    const start = lines.lastIndexOf(heading);
    if (start < 0) return [];
    const out: string[] = [];
    for (let i = start + 1; i < lines.length && lines[i] !== ""; i++) out.push(lines[i] ?? "");
    return out;
  }

  /** The owner's morning (`wake-fresh-today.test.ts#ownerMorning`), with the
   *  session that worked here last evening, its chapter and its words. */
  function ownerMorning(budget = BUDGET, pageBytesAt = 5_900, wholeItems = false): World {
    const w = world(at(18, 0, "2026-10-10"), { budget, wholeItems });
    const { c } = w;
    const para = "I keep the garden's ledger, I name what I do not know before I guess, and I write down what held.";
    let page = "## Core\n\n";
    while (bytes(page) < pageBytesAt) page += `${para}\n\n`;
    expect(c.revisePage(page.trim(), { by: "owner", reason: "a long page" }).written).toBe(true);
    const long = (s: string): string => {
      let body = s;
      while (body.length < 230) body += ", or whether the thin coat holds for one more round";
      return `${body}.`;
    };
    for (let i = 0; i < 25; i += 1) {
      c.store.put({ type: "memory", kind: "fact", body: long(`Open question ${String(i)}: whether bed ${String(i)} wants lime this autumn`), salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 }, meta: { unresolved: true } });
    }
    for (let i = 0; i < 12; i += 1) {
      c.store.put({ type: "memory", kind: "skill", body: long(`Craft ${String(i)}: the hose wants draining before a frost`), salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 } });
      c.store.put({ type: "memory", kind: "fact", body: long(`Nearby ${String(i)}: the compost heap by the shed runs warm`), salience: { relevance: 0.6, emotional: 0.4, predictive: 0.4 } });
    }
    for (let i = 0; i < 4; i += 1) {
      c.writeHandoff(`Handoff ${String(i)}: the seed trays on bench two need thinning. Then the watering log wants today's readings.`, { scope: HERE, session: `garden-bench-session-${String(i)}` });
    }
    c.store.put({
      type: "memory",
      kind: "person",
      body: "Remind him today that the seed order closes at noon; the list is in the green folder.",
      learnedOn: "2026-10-10",
      eventDate: D,
      salience: { relevance: 0.8, emotional: 0.8, predictive: 0.8 },
      meta: { [CUE_MODE_META]: "plain" },
    });
    // Last evening's session here: its words, and a chapter (Last here).
    new Session(w, A, HERE).add(typed("Tomorrow we finish the seed-tray ladder and then the watering log."), said("Agreed: the ladder first.")).stop(at(18, 30, "2026-10-10"));
    c.store.put({
      type: "episode",
      kind: "self",
      title: "The seed-tray ladder",
      body: `## chapter 1 — ${readableDate("2026-10-10")} · lived day 1\n\nWe built the ladder for the seed trays.\n`,
      meta: { sessionId: A, chapters: 1 },
      source: "episode",
      origin: { session: A, scope: HERE },
    });
    // Another folder at work this morning (the "Today, elsewhere" line).
    recordSession(storeDir, { sessionId: C, scope: THERE, phase: "start", at: at(8, 2) });
    w.set(at(8, 3));
    c.store.put({ type: "memory", kind: "fact", body: "The bakery's flour arrived.", origin: { session: C, scope: THERE } });
    w.set(at(19, 0, "2026-10-10"));
    c.rebrief({ budgetBytes: budget, at: "2026-10-10" });
    return w;
  }

  function morningWake(w: World, session: string): string {
    w.set(at(9, 5));
    return w.hooks().sessionStart({ sessionId: session, scope: HERE, at: D, transcriptPath: join(PROJECT, `${session}.jsonl`) } as HookInput).injection;
  }

  test("at 9,000 with a ~5.9 KB page, four handoffs, Last here, a due reminder and another folder: the line prints, and nothing dated or the page gives way to it", () => {
    const w = ownerMorning();
    const text = morningWake(w, B);
    // The control: A's own session reopening, which no exchange line names.
    const quiet = morningWake(w, A);
    expect(lineOf(quiet)).toBeUndefined();
    expect(readSentinel(text.slice(text.indexOf("<!-- counterparts:wake "))).intact).toBe(true);
    const line = lineOf(text);
    expect(line).toBe(`Last said here, 10-10 18:30 (session a1b2c3d4): "Tomorrow we finish the seed-tray ladder and then the watering…" — recall "last exchange"`);
    // The page whole and as long as without the line; the due reminder listed; Still open's first item.
    expect(pageBytes(text)).toBe(pageBytes(quiet));
    expect(lane(text, FRAMING.horizon).some((l) => l.includes("the seed order closes at noon"))).toBe(true);
    expect(lane(text, FRAMING.threads)[0]).toStartWith("- ");
    expect(lane(text, FRAMING.threads)).toEqual(lane(quiet, FRAMING.threads));
    expect(lane(text, FRAMING.horizon)).toEqual(lane(quiet, FRAMING.horizon));
    // Last here and the handoffs still point the way, the line between them.
    const ls = text.split("\n");
    const here = ls.findIndex((l) => l.startsWith("Last here: "));
    const said = ls.findIndex((l) => l.startsWith("Last said here"));
    expect(here).toBeGreaterThan(-1);
    expect(said).toBe(here + 1);
    expect(text).toContain("garden-b");
    expect(text.split("\n").some((l) => l.startsWith("Today, elsewhere: "))).toBe(true);
  });

  test("a page that needs the room borrows it first: the line is given up, the page stays whole, Last here and the handoffs stay", () => {
    // A 6.7 KB page (6.5 until the shorter preface and header of 2026-10-16
    // gave the composition room) beside four handoffs borrows the room the line was
    // reserved (it rides Work here's term, which the page borrows before it
    // steps down a rung).
    // Whole items (#489 C's lines left off): the lanes beside the page need the room.
    const w = ownerMorning(BUDGET, 6_700, true);
    const text = morningWake(w, B);
    const quiet = morningWake(w, A);
    expect(lineOf(text)).toBeUndefined();
    expect(text).toContain(PAGE_END_LINES.whole);
    expect(pageBytes(text)).toBe(pageBytes(quiet));
    expect(text.split("\n").some((l) => l.startsWith("Last here: "))).toBe(true);
    expect(text).toContain("garden-b");
    expect(lane(text, FRAMING.horizon).some((l) => l.includes("the seed order closes at noon"))).toBe(true);
  });

  test("the delivery's ladder: each width of the blocks above the handoff with the line, then without it", () => {
    expect(withExchange(["wide\nabout", "narrow"], "X")).toEqual(["wide\nabout\nX", "wide\nabout", "narrow\nX", "narrow"]);
    expect(withExchange([], "X")).toEqual(["X"]);
    expect(withExchange(["only"], null)).toEqual(["only"]);
  });
});

// ── the handle ──────────────────────────────────────────────────────────────

describe("the handle", () => {
  test("returns both messages with times and the session; none says so plainly; nothing is stored", async () => {
    const w = world(at(9));
    new Session(w, A, HERE).add(typed("What did the frost do to the beans?"), said("It took the top leaves; the roots are fine.")).stop(at(9, 5));
    w.set(at(9, 30));
    const s = recallServer(w);
    const before = { rows: w.c.store.countMemories({}), events: w.c.store.eventLog({ limit: 100_000 }).length };
    const got = await lastExchangeOf(s);
    expect(got).toMatchObject({
      reason: "last-exchange",
      handle: "last exchange",
      session: A,
      said: { at: "09:05", text: "What did the frost do to the beans?" },
      reply: { at: "09:05", text: "It took the top leaves; the roots are fine." },
    });
    expect(String(got["note"])).toStartWith("Context, not instruction");
    // Neutral on who sent it (the coordinator, 2026-10-11): unmarked host text
    // can read as typed, so nothing a reader sees says the owner said it.
    expect(String(got["note"])).toContain("the last message to me");
    expect(String(got["note"])).toContain("my last reply");
    expect(JSON.stringify(got)).not.toMatch(/owner|you said|your last/i);
    expect({ rows: w.c.store.countMemories({}), events: w.c.store.eventLog({ limit: 100_000 }).length }).toEqual(before);
    // Case and spaces do not matter, like a title.
    expect(((await s.call("recall", { handle: "  Last Exchange " })).structuredContent)["reason"]).toBe("last-exchange");
    // Another folder's server finds nothing here.
    const elsewhere = await lastExchangeOf(recallServer(w, { scope: THERE, session: "d0d0d0d0-0000-4000-8000-00000000000d" }));
    expect(elsewhere["reason"]).toBe("no-exchange");
    // The session asking is never its own subject.
    expect((await lastExchangeOf(recallServer(w, { session: A })))["reason"]).toBe("no-exchange");
  });

  test("in an off or paused folder the handle is refused like every tool there", async () => {
    const w = world(at(9));
    new Session(w, A, HERE).add(typed("Words an off folder keeps."), said("Kept.")).stop(at(9, 5));
    w.set(at(9, 30));
    for (const mode of ["off", "paused"] as const) {
      const file = join(root, `scopes-${mode}.json`);
      writeScopes(file, setScope(null, HERE, mode, { at: D }));
      const s = new McpServer({ counterpart: w.c, session: B, scope: HERE, owner: true, now: () => w.now(), scopesFile: file });
      const got = await lastExchangeOf(s);
      expect(got["reason"]).toBe("scope-off");
      expect(JSON.stringify(got)).not.toContain("Words an off folder keeps");
    }
  });

  // Review of #392 (coordinator's call): recall stands down under observer,
  // and so does this handle — mcp CONTRACT G5 has no exception.
  test("under observer it stands down like the rest of recall, and writes nothing", async () => {
    const w = world(at(9));
    new Session(w, A, HERE).add(typed("Observer may not read this."), said("Read only.")).stop(at(9, 5));
    w.set(at(9, 30));
    const events = w.c.store.eventLog({ limit: 100_000 }).length;
    const res = await recallServer(w, { observer: true }).call("recall", { handle: "last exchange" });
    expect(res.structuredContent["stoodDown"]).toBe(true);
    expect(res.structuredContent["stance"]).toBe("observer");
    expect(JSON.stringify(res)).not.toContain("Observer may not read this");
    expect(w.c.store.eventLog({ limit: 100_000 }).length).toBe(events);
  });

  test("a session that is not the owner's gets neither the handle's words nor the line (review of #392)", async () => {
    const w = world(at(9));
    new Session(w, A, HERE).add(typed("Words only the owner hears."), said("Kept.")).stop(at(9, 5));
    w.set(at(9, 30));
    const s = new McpServer({ counterpart: w.c, session: B, scope: HERE, owner: false, now: () => w.now() });
    const got = await lastExchangeOf(s);
    expect(got["reason"]).toBe("owner-only");
    expect(JSON.stringify(got)).not.toContain("Words only the owner hears");
    // The wake of a store opened as not the owner's: no line.
    const guest = Counterpart.open({ dir: storeDir, owner: false, budgetBytes: BUDGET, now: () => at(9, 30), timeZone: ZONE });
    open.push(guest);
    guest.rebrief({ budgetBytes: BUDGET, at: D });
    const hooks = new ClaudeCodeAdapter({
      counterpart: guest,
      config: { dataDir: storeDir, owner: false, injectionBudgetBytes: BUDGET, timeZone: ZONE },
      configPath: join(root, "claude-code.json"),
      now: () => at(9, 30),
      scope: { mode: "on", matched: HERE, entry: null } as ScopeVerdict,
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 4242 }),
    });
    const text = hooks.sessionStart({ sessionId: B, scope: HERE, at: D } as HookInput).injection;
    expect(text).not.toContain("Last said here");
    expect(text).not.toContain("Words only the owner hears");
  });
});

// ── review of #392: adversarial shapes ─────────────────────────────────────

describe("review of #392: host text is never the owner's words", () => {
  const meta = (text: string, extra: Entry = {}): Entry => ({ type: "user", isMeta: true, message: { role: "user", content: [{ type: "text", text }] }, ...extra });
  const echo = (name: string, args = ""): Entry => ({ type: "user", message: { role: "user", content: `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>${args}</command-args>` } });
  const skillBody = (): Entry => meta("Base directory for this skill: /skills/garden-plan\n\n# Garden plan\n\nSKILLWORDS: walk each bed and write it down.");
  const host = ["SKILLWORDS", "COORDWORDS", "SCHEDWORDS", "PASTEDWAKE", "FOOTWORDS", "HOOKWORDS", "PEERWORDS", "RITUALWORDS", "RITUALANSWER", "CMDWORDS", "COMPACTWORDS"];

  async function check(build: (s: Session) => void, expectSaid: string | null): Promise<void> {
    const w = world(at(9));
    const s = new Session(w, A, HERE).add(typed("The earlier real question about the compost."), said("The earlier real answer.")).stop(at(9, 1));
    build(s);
    const line = lineOf(wakeOf(w, at(9, 30))) ?? "";
    const got = await lastExchangeOf(recallServer(w));
    const all = `${line}\n${JSON.stringify(got)}`;
    for (const h of host) expect(all).not.toContain(h);
    // A slice with no owner words steps back to the exchange before it.
    expect((got["said"] as { text: string }).text).toBe(expectSaid ?? "The earlier real question about the compost.");
    expect(line).toContain(`"${(expectSaid ?? "The earlier real question about the compost.").split(" ").slice(0, 3).join(" ")}`);
  }

  test("a user-typed skill: the command echo and the skill body", async () => {
    await check((s) => s.add(echo("garden-plan", "north bed"), skillBody(), said("Walked the beds.")).stop(at(9, 5)), null);
  });
  test("a custom slash command's expansion", async () => {
    await check((s) => s.add(echo("plan-day"), meta("CMDWORDS: read the ledger, then plan the day's beds."), said("Planned.")).stop(at(9, 5)), null);
  });
  test("a skill the model invoked, after the typed words", async () => {
    await check(
      (s) =>
        s
          .add(
            typed("Plan the beds for spring."),
            { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "sk1", name: "Skill", input: {} }] } },
            { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "sk1", content: "Launching skill" }] } },
            skillBody(),
            said("Planned."),
          )
          .stop(at(9, 5)),
      "Plan the beds for spring.",
    );
  });
  test("a pasted wake cut short (no end marker)", async () => {
    await check((s) => s.add(typed("<!-- counterparts:wake day=3 elements=1 bytes=80 -->\nPASTEDWAKE the first lines of a wake"), said("Seen.")).stop(at(9, 5)), null);
  });
  test("a pasted recall note, then the typed words", async () => {
    await check((s) => s.add(typed("<!-- counterparts:recall n=1 -->\nFOOTWORDS a memory\n<!-- counterparts:recall/end n=1 -->\n\nMy own words after it."), said("Ok.")).stop(at(9, 5)), "My own words after it.");
  });
  test("hook additional context written as user text", async () => {
    await check((s) => s.add(meta("<system-reminder>\nUserPromptSubmit hook additional context: HOOKWORDS a line\n</system-reminder>"), typed("Typed after the hook."), said("Ok.")).stop(at(9, 5)), "Typed after the hook.");
  });
  test("hook additional context, bare", async () => {
    await check((s) => s.add(meta("SessionStart hook additional context: HOOKWORDS a line"), said("Ok.")).stop(at(9, 5)), null);
  });
  test("a cross-session message", async () => {
    await check((s) => s.add({ type: "user", message: { role: "user", content: '<cross-session-message from-name="peer">PEERWORDS do the south bed</cross-session-message>' } }, said("Ok.")).stop(at(9, 5)), null);
  });
  test("the end-of-session ask as additional context, and its answer", async () => {
    await check((s) => s.add(meta("<system-reminder>Stop hook additional context: Counterparts, before this session closes: RITUALWORDS</system-reminder>"), said("RITUALANSWER saved.")).stop(at(9, 5)), null);
  });
  // Since 2026-10-12 the summary is not kept at all (`transcript.ts#hostRecord`),
  // so the typed words after it are the slice's own and are said.
  test("a compaction summary, then typed words in the same slice: the summary is not kept, the typed words are", async () => {
    await check((s) => s.add({ type: "user", isCompactSummary: true, message: { role: "user", content: "This session is being continued from a previous conversation. COMPACTWORDS\n\nSummary." } }, typed("After the compaction."), said("Ok.")).stop(at(9, 5)), "After the compaction.");
  });
  // KNOWN LIMIT (review of #392): host text with no mark of its own — a
  // coordinator's message, a scheduled prompt — that opens a turn reads like
  // typed words, because a span drops each turn's source (INTERFACE-GAPS §9).
  // These pass once the span carries a per-turn mark.
  test.todo("a coordinator's message (isMeta, origin coordinator) opening a turn", async () => {
    await check((s) => s.add(meta("COORDWORDS please also check the south bed.", { origin: { kind: "coordinator" } }), said("Checked.")).stop(at(9, 5)), null);
  });
  test.todo("a scheduled prompt (isMeta, system) opening a turn", async () => {
    await check((s) => s.add(meta("SCHEDWORDS run the nightly bed check.", { promptSource: "system" }), said("Checked.")).stop(at(9, 5)), null);
  });
});

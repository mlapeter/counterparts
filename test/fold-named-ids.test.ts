/**
 * FI1 (2026-10-30): A FOLD OR MERGE KEEPS THE MEMORY IDS ITS SOURCES NAMED.
 *
 * A fold's sources fade and stand behind it, and a memory held back brings no
 * see-also, so an id only a source named was lost at the fold. Now the fold or
 * merge keeps it on a last line of its own, and recall's see-also reads it there.
 *
 * Every case goes through the doors: the sources through `remember`, the fold
 * through the dream tool as a night's child calls it, the turn through the
 * UserPromptSubmit hook, the folder setting from its file. No model is called:
 * the dreamer is the test. Hermetic: a temp dir made and removed here; every
 * word invented.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { scopesPath, setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeMode } from "../src/adapters/scopes.js";
import { SEE_ALSO_NAMES_READ, FRAMING, namedIds } from "../src/core/recall/index.js";
import { stemTerm } from "../src/core/store/index.js";
import { findable } from "./store-fixture.js";

const ZONE = "UTC";
const WRITER = "a7a7a7a7-0000-4000-8000-000000000002";
const NIGHT = "b8b8b8b8-0000-4000-8000-0000000000aa";
const RULE = "A bare 'ring' from the owner just checks the line: the reply is 'bell' and nothing else.";
const WORD = "ring";

let root: string;
let config: string;
let HERE: string;
let SHUT: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-fi1-")));
  config = join(root, "config.json");
  writeFileSync(config, "{}\n");
  HERE = join(root, "garden");
  SHUT = join(root, "bakery");
  for (const d of [HERE, SHUT]) mkdirSync(d, { recursive: true });
  setSystemTime(new Date("2026-10-30T15:00:00.000Z"));
});

afterEach(() => {
  setSystemTime();
  for (const c of closers.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

type Adapter = ReturnType<typeof openAdapter>;

function adapter(): Adapter {
  const a = openAdapter(
    { dataDir: join(root, "store"), injectionBudgetBytes: 9_000, timeZone: ZONE },
    { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null, configPath: config },
  );
  closers.push(a.counterpart);
  return a;
}

function setting(modes: Record<string, ScopeMode>): void {
  let reg = null;
  for (const [dir, mode] of Object.entries(modes)) reg = setScope(reg, dir, mode, { at: "2026-10-30" });
  if (reg !== null) writeScopes(scopesPath(config), reg);
}

function writer(a: Adapter, scope: string): McpServer {
  return new McpServer({ counterpart: a.counterpart, session: WRITER, scope, registryDir: root });
}

async function remember(a: Adapter, scope: string, args: Record<string, unknown>): Promise<string> {
  const r = await writer(a, scope).call("remember", args);
  expect(r.isError).not.toBe(true);
  return r.structuredContent["id"] as string;
}

/** The dream tool, as the nightly run's child calls it, in `HERE`. */
function dreamer(a: Adapter): McpServer {
  return new McpServer({
    counterpart: a.counterpart,
    session: NIGHT,
    scope: HERE,
    registryDir: root,
    scopesFile: scopesPath(config),
    env: { COUNTERPARTS_NIGHT_CHILD: "dream", COUNTERPARTS_NIGHT_RUN: "1" },
  });
}

async function begin(a: Adapter): Promise<{ s: McpServer; dream: string }> {
  const s = dreamer(a);
  const began = await s.call("dream", { phase: "begin", session: NIGHT });
  return { s, dream: String(began.structuredContent["dream"]) };
}

interface Proposed {
  id: string;
  note?: string;
}

/** One change through the door; it must land. */
async function propose(a: Adapter, s: McpServer, dream: string, change: Record<string, unknown>): Promise<Proposed> {
  const out = (await s.call("dream", { phase: "propose", session: NIGHT, dream, changes: [change] })).structuredContent;
  expect(out["refused"] ?? []).toEqual([]);
  const made = a.counterpart.store.dreamChanges(dream).at(-1);
  const note = (out["notes"] as { note: string }[] | undefined)?.[0]?.note;
  return { id: String(made?.ref), ...(note === undefined ? {} : { note }) };
}

function bodyOf(a: Adapter, id: string): string {
  return a.counterpart.store.readProse(id).body;
}

function prompt(a: Adapter, session: string, text: string, scope: string = HERE) {
  const input = toHookInput(
    { session_id: session, hook_event_name: "UserPromptSubmit", cwd: scope, prompt: text },
    { scope, timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: join(root, "store") },
  );
  return a.userPromptSubmit(input);
}

function decisionRow(a: Adapter, session: string): { footnotes: { id: string; via?: string; seeAlso?: { by: string } }[] } {
  const row = a.counterpart.store.eventLog({ name: "recall.decision", ref: session, order: "desc", limit: 1 })[0];
  return JSON.parse(row?.payload ?? "{}") as { footnotes: { id: string; via?: string; seeAlso?: { by: string } }[] };
}

/** The shape of the 10-27 fold: filler enough for a bar, many memories saying the word, a rule under its bar. */
function filler(a: Adapter): void {
  const store = findable(a.counterpart.store);
  for (let i = 0; i < 200; i++) store.put({ type: "memory", kind: "fact", body: `Unrelated record ${String(i)} about item${String(i)} and widget${String(i)}.` });
  for (let i = 0; i < 12; i++) store.put({ type: "memory", kind: "fact", body: `The door ${WORD} number ${String(i)} went unanswered in block${String(i)}.` });
}

/** The fold's own learned pair, as the turn that first showed it left it: `ring → fold`. */
function wire(a: Adapter, id: string): void {
  const store = a.counterpart.store;
  store.writeCueEdges([{ token: stemTerm(WORD), memoryId: id, weight: 0.727, lastDay: store.livedDay(), source: "test-seed" }]);
}

describe("FI1: the real path", () => {
  test("a NEW fold keeps the id its source named, and a bare word brings the memory it names as see-also", async () => {
    const a = adapter();
    filler(a);
    const rule = await remember(a, HERE, { title: "Ring means bell", text: RULE });
    const note = await remember(a, HERE, { title: "A ring miss", text: `A bare ring got a long answer; the rule I missed is ${rule}, and it holds.` });
    const other = await remember(a, HERE, { title: "The bell plan", text: "The plan for the bell is queued for next week." });

    const { s, dream } = await begin(a);
    const words = "A ring gets a bell, and the fix for the miss is queued for next week.";
    const fold = await propose(a, s, dream, { action: "gist", fold: true, sources: [note, other], text: words, title: "The ring and the bell" });

    // The fold's own words, then the id. Not its sources': they are linked as earlier versions.
    expect(bodyOf(a, fold.id)).toBe(`${words}\n\nNames: ${rule}`);
    expect(namedIds(bodyOf(a, fold.id))).toEqual([rule]);

    wire(a, fold.id);
    const t = prompt(a, "sess-fi1-1", WORD);
    expect([...t.surfaced, ...t.footnotes]).toContain(fold.id);
    expect(t.footnotes).toContain(rule);
    expect(t.injection).toContain(`${FRAMING.seeAlso} Ring means bell [${rule}]`);
    // The source stands behind the fold, and a memory held back brings nothing of its own.
    expect([...t.surfaced, ...t.footnotes]).not.toContain(note);
    const marked = decisionRow(a, "sess-fi1-1").footnotes.find((f) => f.id === rule);
    expect(marked?.via).toBe("see-also");
    expect(marked?.seeAlso?.by).toBe(fold.id);

    // The change's row says what it kept, so a later read can find it.
    const change = a.counterpart.store.dreamChanges(dream).find((c) => c.ref === fold.id);
    expect((JSON.parse(change?.detail ?? "{}") as { names?: string[] }).names).toEqual([rule]);
  });

  test("a fold whose sources named nothing: its words alone, and no see-also", async () => {
    const a = adapter();
    filler(a);
    const rule = await remember(a, HERE, { title: "Ring means bell", text: RULE });
    const note = await remember(a, HERE, { title: "A ring miss", text: "A bare ring got a long answer; the rule was missed, and it holds." });
    const other = await remember(a, HERE, { title: "The bell plan", text: "The plan for the bell is queued for next week." });
    const { s, dream } = await begin(a);
    const words = "A ring gets a bell, and the fix for the miss is queued for next week.";
    const fold = await propose(a, s, dream, { action: "gist", fold: true, sources: [note, other], text: words, title: "The ring and the bell" });
    expect(bodyOf(a, fold.id)).toBe(words);
    wire(a, fold.id);
    const t = prompt(a, "sess-fi1-2", WORD);
    expect(t.injection).not.toContain(FRAMING.seeAlso);
    expect(decisionRow(a, "sess-fi1-2").footnotes.find((f) => f.id === rule)?.via).toBeUndefined();
  });
});

describe("FI1: what it keeps", () => {
  test("a merge keeps them too, and a plain gist, whose sources stay as they were, doesn't", async () => {
    const a = adapter();
    const named = await remember(a, HERE, { title: "The kept one", text: "The kept one stands on its own." });
    const x = await remember(a, HERE, { title: "Copy one", text: `The shed key hangs by the door, as ${named} says.` });
    const y = await remember(a, HERE, { title: "Copy two", text: "The key to the shed hangs beside the door." });
    const z = await remember(a, HERE, { title: "A third", text: `The compost goes behind the shed, near ${named}.` });
    const w = await remember(a, HERE, { title: "A fourth", text: "The compost bin is emptied in spring." });
    const { s, dream } = await begin(a);
    const merged = await propose(a, s, dream, { action: "merge", ids: [x, y], text: "The shed key hangs by the door." });
    expect(bodyOf(a, merged.id)).toBe(`The shed key hangs by the door.\n\nNames: ${named}`);
    const gist = await propose(a, s, dream, { action: "gist", sources: [z, w], text: "The compost and the shed go together." });
    expect(bodyOf(a, gist.id)).toBe("The compost and the shed go together.");
  });

  test("the sources' own ids, one the words already say, one archived: not kept; a corrected one: the memory that holds now", async () => {
    const a = adapter();
    const store = a.counterpart.store;
    const said = await remember(a, HERE, { title: "Said outright", text: "The words already name this one." });
    const gone = await remember(a, HERE, { title: "Archived", text: "This one is archived before the night." });
    const old = await remember(a, HERE, { title: "The old fence", text: "The fence is two metres." });
    const now = await remember(a, HERE, { title: "The new fence", text: "The fence is three metres.", updates: old });
    const second = await remember(a, HERE, { title: "Second part", text: "The second part names nothing." });
    const first = await remember(a, HERE, { title: "First part", text: `Names ${second}, ${said}, ${gone} and ${old}.` });
    store.archive(gone, "test");
    const { s, dream } = await begin(a);
    const words = `The parts add up, as ${said} says.`;
    const fold = await propose(a, s, dream, { action: "gist", fold: true, sources: [first, second], text: words });
    expect(bodyOf(a, fold.id)).toBe(`${words}\n\nNames: ${now}`);
  });

  test(`at most ${String(SEE_ALSO_NAMES_READ)} named in all, the words' own first; the rest counted and said`, async () => {
    const a = adapter();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await remember(a, HERE, { title: `Named ${String(i)}`, text: `Named memory number ${String(i)} of block${String(i)}.` }));
    const p1 = await remember(a, HERE, { title: "Part one", text: `Part one: ${(ids.slice(0, 3)).join(", ")}.` });
    const p2 = await remember(a, HERE, { title: "Part two", text: `Part two: ${(ids.slice(3)).join(", ")}.` });
    const { s, dream } = await begin(a);
    const words = `What they add up to, beside ${ids[5] as string}.`;
    const fold = await propose(a, s, dream, { action: "gist", fold: true, sources: [p1, p2], text: words });
    expect(bodyOf(a, fold.id)).toBe(`${words}\n\nNames: ${ids.slice(0, 3).join(", ")}`);
    expect(namedIds(bodyOf(a, fold.id))).toHaveLength(SEE_ALSO_NAMES_READ);
    expect(fold.note).toContain("named 2 more");
    const change = a.counterpart.store.dreamChanges(dream).find((c) => c.ref === fold.id);
    expect((JSON.parse(change?.detail ?? "{}") as { namesPast?: number }).namesPast).toBe(2);
  });
});

describe("FI1: a named id doesn't carry a closed folder's memory across", () => {
  const SECRET_WORK = "The van repair closed the quarter at a loss.";
  const SECRET_OWN = "The owner would rather sell the bakery than the van.";

  async function shutRows(a: Adapter): Promise<{ work: string; own: string }> {
    return {
      work: await remember(a, SHUT, { title: "The van repair", text: SECRET_WORK, about: "work" }),
      own: await remember(a, SHUT, { title: "Rather sell", text: SECRET_OWN, about: "owner" }),
    };
  }

  test("closed at the fold: not kept, whatever the row is about", async () => {
    const a = adapter();
    filler(a);
    const { work, own } = await shutRows(a);
    const note = await remember(a, HERE, { title: "A ring miss", text: `A bare ring got a long answer; see ${work} and ${own}.` });
    const other = await remember(a, HERE, { title: "The bell plan", text: "The plan for the bell is queued for next week." });
    setting({ [HERE]: "on", [SHUT]: "off" });
    const { s, dream } = await begin(a);
    const words = "A ring gets a bell.";
    const fold = await propose(a, s, dream, { action: "gist", fold: true, sources: [note, other], text: words, title: "The ring and the bell" });
    expect(bodyOf(a, fold.id)).toBe(words);
    wire(a, fold.id);
    const t = prompt(a, "sess-fi1-closed", WORD);
    expect([...t.surfaced, ...t.footnotes]).toContain(fold.id);
    expect([...t.surfaced, ...t.footnotes]).not.toContain(work);
    expect([...t.surfaced, ...t.footnotes]).not.toContain(own);
    expect(t.injection).not.toContain("van");
  });

  test("closed after the fold: the turn doesn't bring it, whatever it's about, and the fold still shows", async () => {
    const a = adapter();
    filler(a);
    const { work, own } = await shutRows(a);
    const note = await remember(a, HERE, { title: "A ring miss", text: `A bare ring got a long answer; see ${work} and ${own}.` });
    const other = await remember(a, HERE, { title: "The bell plan", text: "The plan for the bell is queued for next week." });
    setting({ [HERE]: "on", [SHUT]: "on" });
    const { s, dream } = await begin(a);
    const words = "A ring gets a bell.";
    const fold = await propose(a, s, dream, { action: "gist", fold: true, sources: [note, other], text: words, title: "The ring and the bell" });
    expect(bodyOf(a, fold.id)).toBe(`${words}\n\nNames: ${work}, ${own}`);
    wire(a, fold.id);

    // On: a personal memory rides along as ever, another project's work doesn't.
    const open = prompt(a, "sess-fi1-on", WORD);
    expect(open.footnotes).toContain(own);
    expect(open.footnotes).not.toContain(work);

    // Set off: neither, and the fold still shows.
    setting({ [HERE]: "on", [SHUT]: "off" });
    const t = prompt(a, "sess-fi1-off", WORD);
    expect([...t.surfaced, ...t.footnotes]).toContain(fold.id);
    expect([...t.surfaced, ...t.footnotes]).not.toContain(work);
    expect([...t.surfaced, ...t.footnotes]).not.toContain(own);
    expect(t.injection).not.toContain("Rather sell");
    expect(t.injection).not.toContain("van repair");
  });

  test("named in the dream's own words, or in any memory's: the turn doesn't bring it; a turn in its own folder does; ordinary recall isn't fenced", async () => {
    const a = adapter();
    filler(a);
    const { own } = await shutRows(a);
    const note = await remember(a, HERE, { title: "A ring miss", text: "A bare ring got a long answer." });
    const other = await remember(a, HERE, { title: "The bell plan", text: "The plan for the bell is queued for next week." });
    const inShut = await remember(a, SHUT, { title: "The bakery ring", text: `The bakery ring, as ${own} says.` });
    wire(a, inShut);
    setting({ [HERE]: "on", [SHUT]: "off" });
    const { s, dream } = await begin(a);
    const words = `A ring gets a bell, as ${own} says.`;
    const fold = await propose(a, s, dream, { action: "gist", fold: true, sources: [note, other], text: words, title: "The ring and the bell" });
    wire(a, fold.id);
    const t = prompt(a, "sess-fi1-words", WORD);
    expect([...t.surfaced, ...t.footnotes]).toContain(fold.id);
    expect(t.footnotes).not.toContain(own);

    // Its own folder's turn: nothing crosses, so it comes.
    const home = prompt(a, "sess-fi1-home", WORD, SHUT);
    expect([...home.surfaced, ...home.footnotes]).toContain(inShut);
    expect(home.footnotes).toContain(own);

    // Asked for, by a session anywhere: as #688 left it.
    const asked = await writer(a, HERE).call("recall", { ids: [own] });
    expect(JSON.stringify(asked.structuredContent)).toContain("sell the bakery");
  });

  test("a night's row resting on a closed one, filed in the turn's own folder: not brought; with that folder on, it comes", async () => {
    const a = adapter();
    filler(a);
    const { own } = await shutRows(a);
    const merged = a.counterpart.store.put({ type: "memory", kind: "fact", title: "A merge of it", body: `Merged: ${SECRET_OWN}`, source: "dreamed", salience: { claimed: 0.5 }, meta: { dream: "d", mergedFrom: [own] }, origin: { session: NIGHT, scope: HERE, ref: "dream:d" } });
    const note = await remember(a, HERE, { title: "A ring miss", text: `A bare ring got a long answer; see ${merged}.` });
    wire(a, note);
    setting({ [HERE]: "on", [SHUT]: "off" });
    const t = prompt(a, "sess-fi1-night", WORD);
    expect([...t.surfaced, ...t.footnotes]).toContain(note);
    expect(t.footnotes).not.toContain(merged);
    setting({ [HERE]: "on", [SHUT]: "on" });
    expect(prompt(a, "sess-fi1-night-on", WORD).footnotes).toContain(merged);
  });

  test("a setting that won't read brings no memory with a folder; one with none still comes", async () => {
    const a = adapter();
    filler(a);
    const { own } = await shutRows(a);
    const free = a.counterpart.store.put({ type: "memory", kind: "fact", title: "No folder", body: "This one has no folder at all.", salience: { claimed: 0.5 } });
    const note = await remember(a, HERE, { title: "A ring miss", text: `A bare ring got a long answer; see ${own}.` });
    const second = await remember(a, HERE, { title: "A ring again", text: `Another ring, and ${free} with it.` });
    wire(a, note);
    wire(a, second);
    writeFileSync(scopesPath(config), "{ not json");
    const t = prompt(a, "sess-fi1-broken", WORD);
    expect([...t.surfaced, ...t.footnotes]).toContain(note);
    expect(t.footnotes).not.toContain(own);
    expect(t.footnotes).toContain(free);
  });
});

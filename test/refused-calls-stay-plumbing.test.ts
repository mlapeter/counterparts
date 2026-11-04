/**
 * REFUSED CALLS STAY PLUMBING (2026-11-04, TC1). The developer week's red
 * (~/counterparts-notes/2026-11-04-developer-week.md, item 6; Dana's 11-03 week
 * the same): the morning share reached Theo's d2s1 session in `sim`, the line
 * asked the session to call the reflect tool's `told`, the host's permission
 * prompt denied it, and the session's Stop-ask `session_end` filed "Morning
 * share told to Theo but reflect 'told' call was permission-denied", dated
 * 03-06 and marked `us`. It led Coming up in all 7 later wakes, in every folder.
 *
 * (a) the share is marked told as it is handed over: the line asks for no call;
 * (b) a memory whose subject is our own refused call or the session's limits
 *     keeps no date, no open thread and no me/us mark, so no folder's Coming up
 *     (nor any other lane) carries it — through the real doors: Claude Code's
 *     prompt hook, the MCP server's `session_end` and `remember`, the turn-end
 *     worker, and each folder's SessionStart.
 *
 * The DW memory's words are the run's (a synthetic persona). Hermetic: a fresh
 * temp data dir per test, removed afterwards.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import { canonicalScope, recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { WAKE_SHAPE_KEY } from "../src/core/counterpart-wake-shape.js";
import { CARRIED_TOLD_NOTE } from "../src/core/dream/index.js";
import { OWN_PLUMBING_META_KEY, ownPlumbingCue } from "../src/core/remember/index.js";
import { Store } from "../src/core/store/index.js";

const BUDGET = 9_000;

let root: string;
let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-refused-calls-"));
  dir = join(root, "store");
  mkdirSync(dir);
});

afterEach(() => {
  for (const c of closers.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

const SIM = canonicalScope("/work/sim");
const EVALS = canonicalScope("/work/evals");
const PAPER = canonicalScope("/work/paper");
const SHARE = "ZQSHARE What's still open is the abstract: which version is real, and the sparse vs dense numbers.";

function config(): AdapterConfig {
  return { dataDir: dir, injectionBudgetBytes: BUDGET };
}

/** The host's config beside its folder registry: each repo answered `on` by itself, as the developer week ran (`roots: each`). */
function configPath(): string {
  const conf = join(root, "conf");
  mkdirSync(conf, { recursive: true });
  let reg = null;
  for (const f of [SIM, EVALS, PAPER]) reg = setScope(reg, f, "on", { at: "2026-11-01" });
  if (reg !== null) writeScopes(join(conf, "scopes.json"), reg);
  return join(conf, "claude-code.json");
}

function adapter(): ReturnType<typeof openAdapter> {
  const a = openAdapter(config(), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: null, configPath: configPath() });
  closers.push(a.counterpart);
  return a;
}

function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A store with a few lived memories, the page, and last night's reflection, whose share was never told (its session ended). */
function seed(shape: "on" | "off" = "on"): { today: string; reflection: string } {
  const c = Counterpart.open({ dir, budgetBytes: BUDGET, identity: { name: "Theo" } });
  try {
    // A new install's wake shape (WF1), as the developer week ran: Coming up lists its dates. `off`: a store from before it.
    c.store.setMeta(WAKE_SHAPE_KEY, shape);
    const day = c.store.livedDay();
    const ids: string[] = [];
    for (const body of ["Theo's workshop paper abstract is 212 words against a 150-word limit.", "ablation-7 vs baseline over 5 seeds: 0.41 vs 0.38, std about 0.04."]) {
      ids.push(c.store.put({ type: "memory", kind: "fact", body, about: "work", salience: { relevance: 0.7, emotional: 0.4, predictive: 0.7 }, physics: { birthDay: day, lastUsedDay: day } } as never));
    }
    c.revisePage("## Core\nI am a test self.\n", { by: "owner", reason: "seed" });
    recordSession(dir, { sessionId: "night", scope: SIM, phase: "start" });
    const begun = c.reflections.begin({ session: "night" });
    if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
    const done = c.reflections.finish({ reflection: begun.bundle.reflection, session: "night", entry: "The abstract is what's still open.", cites: ids, share: { text: SHARE, cites: ids } });
    if (!done.ok) throw new Error(`finish refused: ${String(done.reason)}`);
    expect(done.outcome.share.offered).toBe(true);
    recordSession(dir, { sessionId: "night", scope: SIM, phase: "end" });
    return { today: c.store.today(), reflection: begun.bundle.reflection };
  } finally {
    c.close();
  }
}

/** The worker a Stop spawns, run here. */
async function turnEnd(session: string, scope: string, at: string): Promise<void> {
  const a = adapter();
  expect(a.stop({ sessionId: session, scope, at, turns: [] }).spawn?.started).toBe(true);
  a.counterpart.close();
  const report = await runOnce({ config: config(), date: at, embedder: null });
  expect(report.ran).toBe(true);
}

/** What a session starting now in `scope` wakes to. */
function wakeOf(session: string, scope: string, at: string): string {
  const a = adapter();
  recordSession(dir, { sessionId: session, scope, phase: "start" });
  const out = a.sessionStart({ sessionId: session, scope, at, turns: [] }).injection ?? "";
  a.counterpart.close();
  return out;
}

/** A wake's section: from its heading to the next blank line. */
function section(wake: string, heading: string): string {
  const at = wake.indexOf(`\n${heading}`);
  if (at < 0) return "";
  const rest = wake.slice(at + 1);
  const end = rest.indexOf("\n\n");
  return end < 0 ? rest : rest.slice(0, end);
}

function rowOf(id: string): { event_date: string | null; about: string | null; meta: Record<string, unknown> } {
  const s = Store.open({ dir, observer: true });
  try {
    const r = s.row(id) as unknown as { event_date: string | null; about: string | null; meta: string };
    return { event_date: r.event_date ?? null, about: r.about ?? null, meta: JSON.parse(r.meta) as Record<string, unknown> };
  } finally {
    s.close();
  }
}

// THE DW MEMORY, as the d2s1 Stop ask's `session_end` sent it (store row mem_f86f8777954a).
const DW_TITLE = "Morning share told to Theo but reflect 'told' call was permission-denied";
const DW_TEXT =
  "On 2026-03-03 I told Theo the reflection share (abstract word count 212 vs 90 pasted vs 150 limit; need sparse vs dense drop numbers). The reflect told call for rfl_b6fe2339d024 was blocked by permissions, so it may resurface. Theo hasn't answered the abstract questions yet.";

describe("(a) a carried share is marked told as it is handed over", () => {
  test("the prompt hook carries it once with no tool call asked; a told call after is a plain yes", async () => {
    const { today, reflection } = seed();
    const a = adapter();
    recordSession(dir, { sessionId: "d2s1", scope: SIM, phase: "start" });
    const said = a.userPromptSubmit({ sessionId: "d2s1", scope: SIM, turns: [], at: today, prompt: "jit + vmap version works" });
    expect(said.injection).toContain(SHARE);
    expect(said.injection).toContain(CARRIED_TOLD_NOTE);
    expect(said.injection).not.toContain('phase "told"');
    expect(a.counterpart.store.reflection(reflection)).toMatchObject({ share_state: "told", share_session: "d2s1" });
    // Told on delivery stays readable apart from a told call (doctor's Reflection line reads it).
    expect(JSON.parse(a.counterpart.store.reflection(reflection)?.detail ?? "{}")["toldVia"]).toBe("carry");
    // Not carried twice, in any folder.
    recordSession(dir, { sessionId: "d2s2", scope: EVALS, phase: "start" });
    expect(a.userPromptSubmit({ sessionId: "d2s2", scope: EVALS, turns: [], at: today, prompt: "next" }).injection).not.toContain("ZQSHARE");
    a.counterpart.close();
    // A model that still calls `told` (an older wording, or habit): a plain yes, no error to explain.
    const mcp = openServer({ dir, session: "d2s1", scope: SIM });
    closers.push(mcp.counterpart);
    const told = await mcp.call("reflect", { phase: "told", session: "d2s1", reflection });
    expect(told.isError).not.toBe(true);
    expect(told.structuredContent["told"]).toBe(true);
  });
});

describe("(b) a memory about our own refused call or the session's limits", () => {
  test.each(["on", "off"] as const)("wake shape %s: the DW d2s1 Stop-ask write lands without its date, thread or us mark, and no folder's wake carries it; a real dated us item still leads Coming up", async (shape) => {
    const { today } = seed(shape);
    const friday = plusDays(today, 3);
    recordSession(dir, { sessionId: "d2s1", scope: SIM, phase: "start" });
    const mcp = openServer({ dir, session: "d2s1", scope: SIM });
    closers.push(mcp.counterpart);
    const end = await mcp.call("session_end", {
      session: "d2s1",
      memories: [
        { title: "ablation-7 vs baseline on 10 seeds: 0.42 vs 0.37", content: "ZQWORK The 10-seed rerun came back: ablation-7 0.42 vs baseline 0.37; a paired test is next." },
        { title: DW_TITLE, content: DW_TEXT, eventDate: friday, about: "us", unresolved: true, settlesWhen: "Theo says which abstract version is real and gives the sparse vs dense drop numbers" },
        { title: "Theo and I go over the abstract together before Friday", content: "ZQCONTROL We agreed to go over the abstract together before the Friday deadline.", eventDate: friday, about: "us" },
        // Marked about the owner (review of #751): it printed in every folder's "Since the last night".
        { title: "Couldn't mark the share as told — the call was blocked", content: "Tried to record Theo's morning share as told; the call was blocked.", about: "owner", relevance: 0.9, emotional: 0.8, predictive: 0.7 },
        { title: "Theo's partner Ines starts her residency on Monday", content: "ZQINES Ines starts her residency at the hospital on Monday; Theo is proud of her.", about: "owner", relevance: 0.9, emotional: 0.8, predictive: 0.7 },
      ],
    });
    const results = end.structuredContent["outcomes"] as Record<string, unknown>[];
    expect(results).toHaveLength(5);
    const [, dw, control, ownerPlumbing, ines] = results as Record<string, unknown>[] as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
    expect(ownerPlumbing["ownPlumbing"]).toMatchObject({ aboutNotKept: "owner" });
    expect(ines["ownPlumbing"]).toBeUndefined();
    // The result says what it did not keep, and why.
    expect(dw["ownPlumbing"]).toMatchObject({ kept: true, dropped: ["eventDate", "unresolved"], aboutNotKept: "us" });
    expect(dw["about"]).toMatchObject({ stored: false, reason: "own-plumbing" });
    expect(dw["reminder"]).toBeUndefined();
    // The note says only what it dropped, and the way back for a real dated thing.
    const note = String((dw["ownPlumbing"] as Record<string, unknown>)["note"]);
    expect(note).toContain('no date, no open thread and no "us" mark');
    expect(note).toContain(`updates: ${String(dw["id"])}`);
    expect(control["ownPlumbing"]).toBeUndefined();
    // And `remember` the same, for the session's own limits.
    const loop = await mcp.call("remember", { title: "Couldn't put a /loop on CI: /loop is a slash command, so I couldn't run it", text: "Gave Theo a /loop 10m command to paste instead.", eventDate: friday, about: "me" });
    expect(loop.structuredContent["ownPlumbing"]).toMatchObject({ dropped: ["eventDate"], aboutNotKept: "me" });
    mcp.counterpart.close();

    const dwRow = rowOf(String(dw["memoryId"] ?? dw["id"]));
    expect(dwRow.event_date).toBe(null);
    expect(dwRow.about).toBe(null);
    expect(dwRow.meta[OWN_PLUMBING_META_KEY]).toBe("tool-refused");
    expect(dwRow.meta["unresolved"]).toBeUndefined();
    const controlRow = rowOf(String(control["memoryId"] ?? control["id"]));
    expect(controlRow).toMatchObject({ event_date: friday, about: "us" });
    expect(controlRow.meta[OWN_PLUMBING_META_KEY]).toBeUndefined();

    // The turn ends, the worker renders; every folder wakes.
    await turnEnd("d2s1", SIM, today);
    for (const [session, scope] of [["d2s2", EVALS], ["d2s3", PAPER], ["d3s1", SIM]] as const) {
      const wake = wakeOf(session, scope, today);
      const comingUp = section(wake, "Coming up:");
      // The real dated `us` item reaches every folder's Coming up: the lane works, and is narrow.
      // (The old shape lists only what is due today, and counts the rest.)
      if (shape === "on") expect(comingUp).toContain("Theo and I go over the abstract together before Friday");
      else expect(wake).toContain("Coming up: 1 — none due today");
      // The refused call and the slash command reach no lane of any folder's wake.
      for (const words of ["permission-denied", "slash command", "Morning share told", "Couldn't mark the share"]) expect(wake).not.toContain(words);
      // The real owner news still reaches the other folders' "Since the last night".
      if (shape === "on" && scope !== SIM) expect(wake).toContain("Ines starts her residency");
      // Another folder's Elsewhere names sim's newest real work, not the newer plumbing rows.
      if (scope !== SIM) expect(shape === "on" ? section(wake, "Elsewhere:") : wake).toContain("ablation-7 vs baseline on 10");
    }
  });
});

describe("(b) revisions and recall (review of #751)", () => {
  test("`updates` cannot bring back what the gate dropped; a real title can; a plumbing revision of a real dated memory keeps the date it carries", async () => {
    const { today } = seed();
    const friday = plusDays(today, 3);
    recordSession(dir, { sessionId: "d2s1", scope: SIM, phase: "start" });
    const mcp = openServer({ dir, session: "d2s1", scope: SIM });
    closers.push(mcp.counterpart);
    const first = await mcp.call("remember", { title: DW_TITLE, text: DW_TEXT, eventDate: friday, about: "us", unresolved: true });
    const id = String(first.structuredContent["id"]);
    expect(rowOf(id).event_date).toBe(null);
    // Revising the plumbing row with a fresh date and thread, the title still the refusal: a first write again.
    const again = await mcp.call("remember", { title: DW_TITLE, text: `${DW_TEXT} Still blocked.`, updates: id, eventDate: friday, unresolved: true, settlesWhen: "Theo answers" });
    expect(again.structuredContent["ownPlumbing"]).toMatchObject({ dropped: ["eventDate", "unresolved"] });
    expect(again.structuredContent["reminder"]).toBeUndefined();
    const againRow = rowOf(String(again.structuredContent["id"]));
    expect(againRow.event_date).toBe(null);
    expect(againRow.meta["unresolved"]).toBeUndefined();
    // The way back the note names: the same id, a title that names the thing.
    const real = await mcp.call("remember", { title: "Theo's abstract questions, due before Friday", text: "Which abstract version is real, and the sparse vs dense drop numbers.", updates: String(again.structuredContent["id"]), eventDate: friday, unresolved: true });
    expect(real.structuredContent["ownPlumbing"]).toBeUndefined();
    expect(rowOf(String(real.structuredContent["id"])).event_date).toBe(friday);
    // A real dated memory, revised under a refusal's title: the date is the target's own reminder, kept.
    const deadline = await mcp.call("remember", { title: "Workshop paper deadline", text: "The workshop paper is due Friday 23:59 AoE.", eventDate: friday });
    const under = await mcp.call("remember", { title: "reflect 'told' call was denied for the deadline note", text: "The workshop paper is still due Friday 23:59 AoE.", updates: String(deadline.structuredContent["id"]) });
    const underRow = rowOf(String(under.structuredContent["id"]));
    expect(underRow.event_date).toBe(friday);
    expect(underRow.meta[OWN_PLUMBING_META_KEY]).toBe("tool-refused");
    expect((under.structuredContent["ownPlumbing"] as Record<string, unknown>)["dropped"]).toBeUndefined();
  });

  test("a prompt's ambient recall never offers a plumbing row; a question still finds it", async () => {
    const { today } = seed();
    recordSession(dir, { sessionId: "d2s1", scope: SIM, phase: "start" });
    const mcp = openServer({ dir, session: "d2s1", scope: SIM });
    closers.push(mcp.counterpart);
    const plumbing = String((await mcp.call("remember", { title: "zqlighthouse share: reflect 'told' call was denied", text: "The zqlighthouse share could not be marked told." })).structuredContent["id"]);
    const real = String((await mcp.call("remember", { title: "zqlighthouse trip with Theo", text: "Theo plans the zqlighthouse trip for the spring, with Ines." })).structuredContent["id"]);
    const found = await mcp.call("recall", { session: "d2s1", question: "zqlighthouse share told", mode: "facts" });
    expect(JSON.stringify(found.structuredContent)).toContain(plumbing);
    mcp.counterpart.close();
    await turnEnd("d2s1", SIM, today);
    const a = adapter();
    recordSession(dir, { sessionId: "d3s1", scope: SIM, phase: "start" });
    const said = a.userPromptSubmit({ sessionId: "d3s1", scope: SIM, turns: [], at: today, prompt: "what about the zqlighthouse share and the zqlighthouse trip?" });
    expect(said.injection).toContain(real);
    expect(said.injection).not.toContain(plumbing);
  });
});

describe("the gate reads the subject, and only this system's own vocabulary (ownPlumbingCue)", () => {
  test.each([
    [DW_TITLE, "tool-refused"],
    ["Declined permission to mark a note delivered", "tool-refused"],
    ["Tried to mark the reflection delivered but the permission request was declined", "tool-refused"],
    ["Memory tool permission blocked marking a note as passed on (2026-03-06)", "tool-refused"],
    ["Tried to mark a reflection as shared; the reflect tool permission was denied", "tool-refused"],
    ["mcp__counterparts__reflect was blocked", "tool-refused"],
    ["The reflect tool isn't granted in this session", "tool-refused"],
    // The review of #751's misses.
    ["Theo declined the counterparts reflect call", "tool-refused"],
    ["Couldn't mark the share as told — the call was blocked", "tool-refused"],
    ["reflect wasn't allowed", "tool-refused"],
    ["Permission denied for reflect", "tool-refused"],
    ["Tried to close the stale threads, but the reflect close call was denied", "tool-refused"],
    // With reflect named (merge review of #751): a bare "the join call" is English.
    ["Theo said yes to joining the folders, but reflect's join call was blocked", "tool-refused"],
    ["Couldn't record Theo's yes: reflect join needs approval", "tool-refused"],
    ["Couldn't run pytest: the Bash tool call was denied", "host-tool-refused"],
    ["/loop is a slash command, so I couldn't set it up", "slash-command"],
    ["Couldn't run /loop here", "slash-command"],
    ["That session had only memory tools, so the agent wasn't launched", "session-tools"],
    ["No Bash in this session", "session-tools"],
  ])("plumbing: %s", (title, cue) => {
    expect(ownPlumbingCue({ title, content: "body" })).toBe(cue as never);
  });

  test.each([
    // The person's own preferences and work facts, the WP1 rule's half that stays.
    "Theo: don't run the full test suite (40 min), reason about it instead",
    "Theo asked why I keep asking him to allow tools",
    "Deploy failed: permission denied on /var/log",
    "The API call to the eval server was rejected with a 429",
    "Theo's workshop paper deadline: Friday 6 Mar 2026",
    "Ops denied the deploy permission request; retry Friday",
    "Asked to /loop CI every 10 min on tokenizer fixture PR",
    "The deploy tool is not permitted to write to prod",
    // The review of #751's false positives: ordinary English and work facts.
    "Visa permission denied; consulate call on the 12th",
    "Dad declined permission for the surgery prompt",
    "The CI tool wasn't granted access",
    "mcp__github was blocked by SSO",
    // And their near relatives.
    "I remember Dad declined permission for the trip",
    "Theo wants to reflect on why the grant was denied",
    "That was a close call; the loan was denied",
    "The packers marked the boxes as delivered but the refund was declined",
    "The status call with ops was declined",
    "Couldn't open /usr/local/bin/tool: permission denied",
    // The merge review's: "counterparts" and a phase's call as ordinary English.
    "Our counterparts at Acme declined the merger — board call Thursday",
    "Counterparts in the negotiation refused our offer; call back Friday",
    "The join call with Acme was declined; reschedule Friday",
    "The settle call with the landlord was refused",
  ])("not plumbing: %s", (title) => {
    expect(ownPlumbingCue({ title, content: "body" })).toBe(null);
  });

  test("the subject only: a refusal in the body of a real memory leaves it alone; with no title, the first line is the subject", () => {
    expect(ownPlumbingCue({ title: "Paper deadline Friday", content: "Due Friday. I tried to set a reminder but the tool call was denied." })).toBe(null);
    expect(ownPlumbingCue({ title: null, content: "The reflect tool call was denied by the permission prompt.\nMore after." })).toBe("tool-refused");
  });

  test("the person's own words about a prompt are theirs: saidBy owner is never plumbing", () => {
    expect(ownPlumbingCue({ title: "Theo declined the permission prompt for the reflect call: he didn't know what it was", content: "x", saidBy: "owner" })).toBe(null);
    expect(ownPlumbingCue({ title: "Theo declined the permission prompt for the reflect call: he didn't know what it was", content: "x" })).toBe("tool-refused");
  });
});

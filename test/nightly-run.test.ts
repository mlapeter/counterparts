/**
 * THE NIGHTLY RUN (2026-09-28) — the page writer, the dream and the reflection
 * in one background agent, started once a calendar day; the owner's dreaming
 * setting (auto | ask | off); a run left behind that the next session picks
 * up; the calendar-day gates; the reflection handed what the dream saw and the
 * whole page, in parts when it is long; the reflection's own page author; and
 * a page read by any heading.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called:
 * the "background agent" is the test, calling the modules and the MCP tools
 * the way the launch prompt says to.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/adapters/cli/index.js";
import { pageWriterFindings } from "../src/adapters/claude-code/doctor.js";
import { writerWords } from "../src/adapters/dashboard/web/views/mind.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAMING_SETTING_KEY, DREAM_TUNABLES, REFLECT_TUNABLES, RELAUNCHED_KEY, dreamingSetting, nightNext, nightOrder } from "../src/core/dream/index.js";
import { PAGE_LIMIT_BYTES, dayBefore, pageSections, pageTooLargeDetail, pageWriterNight } from "../src/core/self/index.js";
import { Self } from "../src/core/self/index.js";
import { episodeGate } from "../src/core/bridge.js";
import type { PutInput } from "../src/core/store/index.js";

/**
 * A page written BEFORE the limit (2026-10-09, `PAGE_LIMIT_BYTES`), when the
 * seam took up to 16 KB: a store can still hold one, and the night has to
 * carry it whole. Written the way it was then — the seam at its old limit.
 */
function longPageWritten(c: Counterpart, body: string, reason = "a long page"): boolean {
  return new Self({ store: c.store, gate: episodeGate(), tunables: { PAGE_MAX_BYTES: 16_384 } }).revisePage(body, { reason, by: "owner" }).written;
}

let dir: string;
const open: Counterpart[] = [];
let offsetMs = 0;
const DAY_MS = 86_400_000;
const SESSION = "s-night";

/**
 * Moves the test clock to noon today. A test that steps the clock past
 * ABANDONED_AFTER_MS and still expects `today` fails in the last half hour of
 * a day (bun test runs in UTC: 23:30-24:00) unless it starts well inside one.
 */
function atNoon(): void {
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  offsetMs = noon.getTime() - Date.now();
}

beforeEach(() => {
  offsetMs = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-nightly-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function brain(opts: { owner?: boolean; observer?: boolean; pageWriterMode?: "off" | "session" } = {}): Counterpart {
  const c = Counterpart.open({
    dir,
    owner: opts.owner ?? true,
    ...(opts.observer === true ? { observer: true } : { identity: { name: "Mike" } }),
    ...(opts.pageWriterMode === undefined ? {} : { pageWriterMode: opts.pageWriterMode }),
    now: () => Date.now() + offsetMs,
  });
  open.push(c);
  return c;
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

/** A store with lived days behind it and four new memories. */
function lived(c: Counterpart): string[] {
  c.store.advanceClock("2026-09-10");
  for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
  return [
    mem(c, "The migration step must run before the container boots, or it boots empty."),
    mem(c, "Run the migration before starting the container, otherwise the container starts empty."),
    mem(c, "Mike likes to talk decisions through out loud before he commits to one.", { kind: "person" }),
    mem(c, "I say what I do not know before I guess.", { kind: "self" }),
  ];
}

/** The day's line as the HOOK takes it: offered, then claimed — a headless offer included. */
function takeLine(c: Counterpart, input: { at: string; session: string }): string | null {
  const o = c.dreams.offer(input);
  return o !== null && c.dreams.claimOffer(o) ? o.context : null;
}

/**
 * The session is stamped on the TEST clock, the one the server reads. Stamped on
 * the real clock, a test that called `atNoon()` after 00:00 UTC (noon then lies
 * ~12h ahead) finds its session silent past the TTL and refused as not live.
 */
function server(c: Counterpart, session?: string): McpServer {
  if (session !== undefined) recordSession(dir, { sessionId: session, scope: "/proj", phase: "start", at: Date.now() + offsetMs });
  return new McpServer({ counterpart: c, scope: "/proj", owner: true, registryDir: dir, now: () => Date.now() + offsetMs });
}

// ---------------------------------------------------------------------------
// the order
// ---------------------------------------------------------------------------

describe("the run's order: writer, then dream, then reflection (the owner's call)", () => {
  test("the order, and what each part hands on to", () => {
    expect(nightOrder()).toEqual(["writer", "dream", "reflection"]);
    expect(nightNext("writer")).toBe("dream");
    expect(nightNext("dream")).toBe("reflection");
    expect(nightNext("reflection")).toBeNull();
    const prompt = brain().dreams.launchPrompt({ session: SESSION });
    expect(prompt.indexOf('phase "writer"')).toBeLessThan(prompt.indexOf('phase "begin"'));
    // The writer runs first: there is no dream id to hand it yet.
    expect(prompt).toContain(`phase "writer", session: ${SESSION}.`);
  });
});

// ---------------------------------------------------------------------------
// the setting
// ---------------------------------------------------------------------------

describe("dreaming: auto | ask | off, durable and reversible", () => {
  test("ask by default (2026-09-29); auto: the line starts the run and says how to turn it off", () => {
    const c = brain();
    lived(c);
    expect(c.dreams.setting()).toBe("ask");
    expect(c.dreams.setSetting("auto", { by: "owner" })).toEqual({ ok: true, setting: "auto", before: "ask" });
    // HEADLESS since 2026-09-29: the host starts the run; the model launches nothing.
    const offer = c.dreams.offer({ at: c.store.today(), session: SESSION });
    expect(offer?.headless).toBe(true);
    expect(offer?.notice).toBe('Counterparts: dreaming in the background (a few minutes). Say "no dreams" to turn it off.');
    // `askLine` starts nothing, so it neither claims nor says a headless offer (review finding 9).
    expect(c.dreams.askLine({ at: c.store.today(), session: SESSION })).toBeNull();
    expect(c.store.dreamAsk(c.store.today())).toBeUndefined();
    const line = takeLine(c, { at: c.store.today(), session: SESSION }) ?? "";
    expect(line).not.toContain('phase "launch"');
    expect(line).toContain("there is nothing for you to launch");
    expect(line).toContain("it updates your self page, then dreams, then reflects");
    expect(line).toContain('phase "setting"');
    expect(c.store.dreamAsk(c.store.today())?.state).toBe("launched");
  });

  test("off: nothing is started and nothing asks; on again, the line comes back", () => {
    const c = brain();
    lived(c);
    expect(c.dreams.setSetting("off", { by: "session", session: SESSION })).toEqual({ ok: true, setting: "off", before: "ask" });
    expect(c.store.getMeta(DREAMING_SETTING_KEY)).toBe("off");
    expect(c.dreams.status(c.store.today()).reason).toBe("off");
    expect(c.dreams.askLine({ at: c.store.today(), session: SESSION })).toBeNull();
    expect(c.dreams.setSetting("ask", { by: "owner" }).ok).toBe(true);
    expect(c.dreams.askLine({ at: c.store.today(), session: SESSION })).not.toBeNull();
  });

  test("ask: the person is shown the question; the model waits for their word", () => {
    const c = brain();
    lived(c);
    c.dreams.setSetting("ask", { by: "owner" });
    const offer = c.dreams.offer({ at: c.store.today(), session: SESSION });
    expect(offer?.notice).toBe('Counterparts: I haven\'t dreamed yet (4 new memories). Say "dream" to start, or "dream on your own" to let me do it each day.');
    // An offer claims nothing: the host claims it once the person's line is leaving.
    expect(c.store.dreamAsk(c.store.today())).toBeUndefined();
    const line = c.dreams.askLine({ at: c.store.today(), session: SESSION }) ?? "";
    // Said once by the session, in its first reply (lane 8, build 4); then it waits.
    expect(line).toContain("this once, in your first reply, as one plain sentence of your own.");
    expect(line).toContain("Then do not ask again — wait for their word.");
    expect(line).toContain('value: "auto", then start today\'s run exactly as for "dream"');
    expect(c.store.dreamAsk(c.store.today())?.state).toBe("offered");
  });

  test("a value that is not a setting is refused; an observer changes nothing; an unreadable value reads as the default", () => {
    const c = brain();
    expect(c.dreams.setSetting("sometimes", { by: "owner" })).toEqual({ ok: false, reason: "not-a-setting" });
    c.store.setMeta(DREAMING_SETTING_KEY, "garbled");
    expect(dreamingSetting(c.store)).toBe("ask");
    c.close();
    open.splice(0);
    const o = brain({ observer: true });
    expect(o.dreams.setSetting("off", { by: "owner" })).toEqual({ ok: false, reason: "observer" });
  });

  test("'no dreams' in conversation is the dream tool's `setting` phase", async () => {
    const c = brain();
    const s = server(c, SESSION);
    const res = await s.call("dream", { phase: "setting", session: SESSION, value: "off" });
    expect(res.isError ?? false).toBe(false);
    expect(res.structuredContent["setting"]).toBe("off");
    expect(String(res.structuredContent["said"])).toContain("No dreams");
    expect(c.dreams.setting()).toBe("off");
    const bad = await s.call("dream", { phase: "setting", session: SESSION, value: "never" });
    expect(bad.isError).toBe(true);
  });

  test("the console sets it, and `counterparts dream` prints it", async () => {
    brain().close();
    open.splice(0);
    const out: string[] = [];
    const err: string[] = [];
    const io = { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
    expect(await run(["dream", "--setting", "auto", "--dir", dir], io)).toBe(0);
    expect(out.join("\n")).toContain("Dreaming: auto (was ask).");
    out.length = 0;
    expect(await run(["dream", "--dir", dir], io)).toBe(0);
    expect(out[0]).toStartWith("Dreaming: auto.");
    expect(await run(["dream", "--setting", "maybe", "--dir", dir], io)).not.toBe(0);
    expect(err.join("\n")).toContain("--setting takes auto, ask or off");
  });
});

// ---------------------------------------------------------------------------
// the calendar day
// ---------------------------------------------------------------------------

describe("the once-a-day gates follow the CALENDAR date, not the lived day", () => {
  test("a dream journaled today holds the day even when the lived clock moves; the next calendar day is new", () => {
    const c = brain();
    lived(c);
    const begun = c.dreams.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const today = c.store.today();
    expect(c.store.dream(begun.bundle.dream)).toMatchObject({ date: today });
    c.dreams.journal({ dream: begun.bundle.dream, session: SESSION, text: "A dream." });
    // The lived clock advances inside a sleep cycle; the calendar has not.
    c.store.advanceClock("2026-09-21");
    for (let i = 0; i < 4; i += 1) mem(c, `A new thing learned, number ${String(i)}.`);
    expect(c.dreams.status(today).reason).toBe("dreamed-today");
    expect(c.dreams.begin({ session: SESSION })).toEqual({ ok: false, reason: "dreamed-today" });
    // The next calendar day.
    offsetMs += DAY_MS;
    expect(c.dreams.status(c.store.today()).reason).toBe("due");
  });

  test("a reflection finished today holds the day; tomorrow it may reflect again", () => {
    const c = brain();
    const ids = lived(c);
    const r = c.reflections.begin({ session: SESSION });
    if (!r.ok) throw new Error(r.reason);
    c.reflections.finish({ reflection: r.bundle.reflection, session: SESSION, entry: "A quiet look back.", cites: [ids[3] as string] });
    c.store.advanceClock("2026-09-21");
    expect(c.reflections.begin({ session: SESSION })).toEqual({ ok: false, reason: "reflected-today" });
    offsetMs += DAY_MS;
    expect(c.reflections.begin({ session: SESSION }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// a run left behind
// ---------------------------------------------------------------------------

describe("a dream left behind does not use up the day", () => {
  test("while a run is busy, another session's begin is refused and no line goes out", () => {
    const c = brain();
    lived(c);
    expect(c.dreams.askLine({ at: c.store.today(), session: "s-a" })).not.toBeNull();
    const a = c.dreams.begin({ session: "s-a" });
    if (!a.ok) throw new Error(a.reason);
    offsetMs += 5 * 60_000;
    expect(c.dreams.begin({ session: "s-b" })).toEqual({ ok: false, reason: "dreaming-now" });
    expect(c.dreams.status(c.store.today()).reason).toBe("dreaming-now");
    expect(c.dreams.askLine({ at: c.store.today(), session: "s-b" })).toBeNull();
  });

  test("begun, changed something, and gone quiet: the next session's line starts it again and `begin` RESUMES it", () => {
    atNoon();
    const c = brain();
    const ids = lived(c);
    const today = c.store.today();
    expect(c.dreams.askLine({ at: today, session: "s-a" })).not.toBeNull();
    const a = c.dreams.begin({ session: "s-a" });
    if (!a.ok) throw new Error(a.reason);
    const id = a.bundle.dream;
    const linked = c.dreams.propose({ dream: id, session: "s-a", changes: [{ action: "link", a: ids[0] as string, b: ids[1] as string }] });
    expect(linked.ok).toBe(true);
    // The session closes; the background agent goes with it.
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    const status = c.dreams.status(today);
    expect(status).toMatchObject({ due: true, reason: "due" });
    expect(status.leftBehind?.id).toBe(id);
    const line = c.dreams.askLine({ at: today, session: "s-b" }) ?? "";
    expect(line).toContain("was cut off");
    // Once: a third session is not told again while this run is fresh.
    expect(c.dreams.askLine({ at: today, session: "s-c" })).toBeNull();
    const b = c.dreams.begin({ session: "s-b" });
    if (!b.ok) throw new Error(b.reason);
    expect(b.resumed).toBe(true);
    expect(b.bundle.dream).toBe(id);
    expect(b.bundle.resumed?.changes).toEqual({ link: 1 });
    expect(b.text).toContain("RESUMED");
    expect(c.store.dream(id)).toMatchObject({ session: "s-b", state: "begun", date: today });
    // The resumed dream is this session's now: it journals, and the day is dreamed.
    const done = c.dreams.journal({ dream: id, session: "s-b", text: "Finished the dream." });
    expect(done.ok).toBe(true);
    expect(c.dreams.status(today).reason).toBe("dreamed-today");
    // Its limits counted what it had already done.
    expect(c.dreams.counts(id)).toEqual({ link: 1 });
  });

  test("yesterday's dream left behind is resumed today; one begun and did nothing is closed and a fresh one opens", () => {
    const c = brain();
    const ids = lived(c);
    const a = c.dreams.begin({ session: "s-a" });
    if (!a.ok) throw new Error(a.reason);
    c.dreams.propose({ dream: a.bundle.dream, session: "s-a", changes: [{ action: "replayed", id: ids[2] as string }] });
    offsetMs += DAY_MS;
    const b = c.dreams.begin({ session: "s-b" });
    if (!b.ok) throw new Error(b.reason);
    expect(b.bundle.dream).toBe(a.bundle.dream);
    expect(c.store.dream(a.bundle.dream)?.date).toBe(c.store.today());
    c.dreams.journal({ dream: b.bundle.dream, session: "s-b", text: "Done." });

    // Tomorrow, a dream begun that did nothing, and left: closed, a fresh one opens.
    offsetMs += DAY_MS;
    for (let i = 0; i < 4; i += 1) mem(c, `Something new on the third day, number ${String(i)}.`);
    const idle = c.dreams.begin({ session: "s-c" });
    if (!idle.ok) throw new Error(idle.reason);
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    const fresh = c.dreams.begin({ session: "s-d" });
    if (!fresh.ok) throw new Error(fresh.reason);
    expect(fresh.resumed).toBe(false);
    expect(fresh.bundle.dream).not.toBe(idle.bundle.dream);
    expect(c.store.dream(idle.bundle.dream)?.state).toBe("undone");
  });

  test("auto: a launch no dream followed is started again after a while — at most RELAUNCHES_PER_DAY times", () => {
    const c = brain();
    lived(c);
    c.dreams.setSetting("auto", { by: "owner" });
    const today = c.store.today();
    expect(takeLine(c, { at: today, session: "s-1" })).not.toBeNull();
    // Soon after: the run may still be starting.
    expect(takeLine(c, { at: today, session: "s-2" })).toBeNull();
    let again = 0;
    for (let i = 0; i < DREAM_TUNABLES.RELAUNCHES_PER_DAY + 2; i += 1) {
      offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
      if (takeLine(c, { at: today, session: `s-r${String(i)}` }) !== null) again += 1;
    }
    expect(again).toBe(DREAM_TUNABLES.RELAUNCHES_PER_DAY);
  });

  test("ask: an ask nobody answered is not asked again (that would be nagging)", () => {
    const c = brain();
    lived(c);
    c.dreams.setSetting("ask", { by: "owner" });
    const today = c.store.today();
    expect(c.dreams.askLine({ at: today, session: "s-1" })).not.toBeNull();
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    expect(c.dreams.askLine({ at: today, session: "s-2" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the reflection: what the dream saw, the page whole, in parts when long
// ---------------------------------------------------------------------------

describe("the reflection sees what the dream saw, and the whole page", () => {
  test("every memory the dream was shown, a line each, and the page whole — past the old 6,000-character cut", () => {
    const c = brain();
    lived(c);
    const page = `## Core\n\n${"I keep what matters and let the rest go. ".repeat(200)}\n\n## Us\n\nWe talk things through.`;
    expect(page.length).toBeGreaterThan(6_000);
    expect(longPageWritten(c, page)).toBe(true);
    const d = c.dreams.begin({ session: SESSION });
    if (!d.ok) throw new Error(d.reason);
    c.dreams.journal({ dream: d.bundle.dream, session: SESSION, text: "A dream." });
    const r = c.reflections.begin({ session: SESSION, dream: d.bundle.dream });
    if (!r.ok) throw new Error(r.reason);
    expect(r.bundle.selfPage).toBe(page);
    const saw = r.bundle.dreamSaw.map((x) => x.id);
    for (const id of Object.keys(d.bundle.memories)) expect(saw).toContain(id);
    for (const x of r.bundle.dreamSaw) expect(x.text.length).toBeGreaterThan(0);
    expect(r.bundle.parts).toBeNull();
  });

  test("a bundle too long for one result comes in PARTS — said up front, fetched with `part`, nothing cut", async () => {
    // The ceilings are tunables; this store's bundle is about 40k characters,
    // so the test lowers them (and puts them back) rather than building a
    // store big enough to pass the real ones.
    const T = REFLECT_TUNABLES as { RESULT_CHARS: number; PART_CHARS: number };
    const saved = { RESULT_CHARS: T.RESULT_CHARS, PART_CHARS: T.PART_CHARS };
    T.RESULT_CHARS = 24_000;
    T.PART_CHARS = 8_000;
    try {
      await partsCase();
    } finally {
      T.RESULT_CHARS = saved.RESULT_CHARS;
      T.PART_CHARS = saved.PART_CHARS;
    }
  });

  async function partsCase(): Promise<void> {
    const c = brain();
    lived(c);
    const long = "a detail worth keeping in full, ".repeat(12);
    for (let i = 0; i < 60; i += 1) mem(c, `Memory ${String(i)} of a busy day: ${long}`, { kind: i % 2 === 0 ? "person" : "self", about: "us" });
    const page = `## Core\n\n${"A sentence of the page that goes on for a while. ".repeat(300)}`;
    longPageWritten(c, page);
    const s = server(c, SESSION);
    const d = await s.call("dream", { phase: "begin", session: SESSION });
    const dreamId = d.structuredContent["dream"] as string;
    await s.call("dream", { phase: "journal", session: SESSION, dream: dreamId, text: "A long dream." });
    const begin = await s.call("reflect", { phase: "begin", session: SESSION, dream: dreamId });
    expect(begin.isError ?? false).toBe(false);
    const parts = begin.structuredContent["parts"] as { part: number; of: number; next: string } | undefined;
    expect(parts?.part).toBe(1);
    expect(parts?.of ?? 0).toBeGreaterThan(1);
    expect(parts?.next).toContain('phase "part"');
    expect(String((JSON.parse(textOf(begin)) as { bundle: string }).bundle).length).toBeLessThanOrEqual(REFLECT_TUNABLES.RESULT_CHARS);
    const rid = begin.structuredContent["reflection"] as string;
    // Every memory the reflection was handed is in exactly one part.
    const first = JSON.parse(String((JSON.parse(textOf(begin)) as { bundle: string }).bundle).split("\n").slice(1).join("\n")) as {
      memories: Record<string, unknown>;
      dreamSaw: { id: string }[];
    };
    const seen = new Set<string>([...Object.keys(first.memories), ...first.dreamSaw.map((x) => `saw:${x.id}`)]);
    let laterId: string | null = null;
    for (let k = 2; k <= (parts?.of ?? 1); k += 1) {
      const p = await s.call("reflect", { phase: "part", session: SESSION, reflection: rid, part: k });
      expect(p.isError ?? false).toBe(false);
      const text = String((JSON.parse(textOf(p)) as { bundle: string }).bundle);
      expect(text.length).toBeLessThanOrEqual(REFLECT_TUNABLES.PART_CHARS + 2_000);
      const body = JSON.parse(text.split("\n").slice(1).join("\n")) as { memories: Record<string, unknown>; dreamSaw: { id: string }[] };
      for (const id of Object.keys(body.memories)) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        laterId ??= id;
      }
      for (const x of body.dreamSaw) {
        expect(seen.has(`saw:${x.id}`)).toBe(false);
        seen.add(`saw:${x.id}`);
        laterId ??= x.id;
      }
    }
    expect(laterId).not.toBeNull();
    const bad = await s.call("reflect", { phase: "part", session: SESSION, reflection: rid, part: (parts?.of ?? 1) + 1 });
    expect(bad.isError).toBe(true);
    // A memory handed in a later part can be cited like any other.
    const fin = await s.call("reflect", { phase: "finish", session: SESSION, reflection: rid, entry: "It was a full day.", cites: [laterId as string] });
    expect(fin.isError ?? false).toBe(false);
    expect(fin.structuredContent["refusedCites"]).toBeUndefined();
  }

  test("the reflection's page write is its OWN author, and records no page-writer run", () => {
    const c = brain();
    const ids = lived(c);
    const r = c.reflections.begin({ session: SESSION });
    if (!r.ok) throw new Error(r.reason);
    const done = c.reflections.finish({
      reflection: r.bundle.reflection,
      session: SESSION,
      entry: "Looking back, I say what I don't know.",
      cites: [ids[3] as string],
      page: { text: "## Core\n\nI say what I do not know before I guess.", cites: [ids[3] as string] },
    });
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.page.written).toBe(true);
    const page = c.selfPage();
    expect(page?.by).toBe("reflection");
    expect(page?.reason).toContain(r.bundle.reflection);
    expect(c.pageWriterRuns()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// the review of #271
// ---------------------------------------------------------------------------

function textOf(res: { content?: readonly { text?: string }[] }): string {
  return res.content?.[0]?.text ?? "";
}

/** Memories learned on the night the writer will read. */
function seedYesterday(c: Counterpart, bodies: readonly string[]): void {
  const about = pageWriterNight(c.store).about;
  for (const body of bodies) c.store.put({ type: "memory", kind: "fact", body, learnedOn: about });
}

describe("review of #271: a run left behind, and the writer's claim", () => {
  test("A: a dream that began, changed nothing and died does NOT use up the day — the line goes out again and a fresh dream opens", () => {
    const c = brain();
    lived(c);
    c.dreams.setSetting("auto", { by: "owner" });
    const today = c.store.today();
    expect(takeLine(c, { at: today, session: "s-a" })).not.toBeNull();
    const dead = c.dreams.begin({ session: "s-a" });
    if (!dead.ok) throw new Error(dead.reason);
    // It changed nothing, and its session closed.
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    expect(c.dreams.status(today).reason).toBe("due");
    expect(takeLine(c, { at: today, session: "s-b" })).not.toBeNull();
    const fresh = c.dreams.begin({ session: "s-b" });
    if (!fresh.ok) throw new Error(fresh.reason);
    expect(fresh.resumed).toBe(false);
    expect(fresh.bundle.dream).not.toBe(dead.bundle.dream);
    expect(c.store.dream(dead.bundle.dream)?.state).toBe("undone");
  });

  test("B: a resumed dream is busy again at once — another session cannot take it, and the agent that resumed it keeps it", () => {
    const c = brain();
    const ids = lived(c);
    const a = c.dreams.begin({ session: "s-a" });
    if (!a.ok) throw new Error(a.reason);
    c.dreams.propose({ dream: a.bundle.dream, session: "s-a", changes: [{ action: "link", a: ids[0] as string, b: ids[1] as string }] });
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    const b = c.dreams.begin({ session: "s-b" });
    if (!b.ok) throw new Error(b.reason);
    expect(b.resumed).toBe(true);
    const started = c.store.dream(a.bundle.dream)?.started_at ?? 0;
    expect(started).toBeGreaterThan(Date.now() + offsetMs - 5_000);
    // A third session a minute later: the run is under way.
    offsetMs += 60_000;
    expect(c.dreams.begin({ session: "s-c" })).toEqual({ ok: false, reason: "dreaming-now" });
    expect(c.dreams.status(c.store.today()).reason).toBe("dreaming-now");
    // The resuming agent goes on as its own.
    const more = c.dreams.propose({ dream: a.bundle.dream, session: "s-b", changes: [{ action: "replayed", id: ids[2] as string }] });
    expect(more.ok).toBe(true);
    // "New since" for the next dream counts from the resume.
    const later = mem(c, "Learned after the resumed dream began.");
    expect(c.store.newMemoryIds({ sinceAt: started, sinceDay: c.store.livedDay(), limit: 10 })).toEqual([later]);
  });

  test("D(a): with the night's claim open, a page write that does not NAME the session is the session's, even on a server the run bound", async () => {
    const c = brain();
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    const s = server(c, SESSION);
    const w = await s.call("dream", { phase: "writer", session: SESSION });
    expect(w.structuredContent["writer"]).toBe(true);
    // The run's call bound the server to SESSION; the owner now asks the
    // session to edit the page, and the call names no session.
    expect(s.session).toBe(SESSION);
    await s.call("self_page", { body: "## Core\n\nThe owner's edit.", reason: "the owner asked" });
    expect(c.selfPage()?.by).toBe("session");
    // The writer, naming the session, is still the writer.
    const version = c.selfPage()?.version ?? -1;
    await s.call("self_page", { body: "## Core\n\nThe night's revision.", reason: "the night", session: SESSION, ifVersion: version });
    expect(c.selfPage()?.by).toBe("writer");
  });

  test("D(b): the run moving on from the writer without a write answers the night `nothing-to-say`, and a later page write is ordinary", async () => {
    const c = brain();
    const about = pageWriterNight(c.store).about;
    seedYesterday(c, ["A placeholder thing noticed yesterday."]);
    lived(c);
    const s = server(c, SESSION);
    expect((await s.call("dream", { phase: "writer", session: SESSION })).structuredContent["writer"]).toBe(true);
    // No self_page write. The run goes on to its dream.
    await s.call("dream", { phase: "begin", session: SESSION });
    const status = c.pageWriterStatus(about);
    expect(status.outcome).toBe("nothing-to-say");
    expect(status.derived).toBe(false);
    expect(c.nightClaimFor(SESSION)).toBeNull();
    await s.call("self_page", { body: "## Core\n\nLater that day, a page written by the session itself, long enough to pass the gate.", session: SESSION });
    expect(c.selfPage()?.by).toBe("session");
  });

  test("a writer phase with nothing to read leaves a non-closing `skipped` row, so doctor reads an every-other-day store as working", () => {
    const c = brain();
    lived(c);
    // Two days ago was lived; yesterday had nothing in it — a store used every other day.
    c.store.put({ type: "memory", kind: "fact", body: "Something from two days back.", learnedOn: dayBefore(pageWriterNight(c.store).about) });
    const out = c.claimNightWriter({ session: SESSION, run: "drm_x" });
    expect(out).toMatchObject({ claimed: false, reason: "no-memories" });
    const runs = c.pageWriterRuns();
    expect(runs.map((r) => [r.outcome, r.detail])).toEqual([["skipped", "no-memories"]]);
    // Once a night.
    c.claimNightWriter({ session: SESSION, run: "drm_x" });
    expect(c.pageWriterRuns()).toHaveLength(1);
  });
});

describe("review of #271: retries", () => {
  test("ask: a launch after the owner's yes flips the day to `launched`, so a run that dies before its dream begins is started again", async () => {
    const c = brain();
    lived(c);
    c.dreams.setSetting("ask", { by: "owner" });
    const today = c.store.today();
    expect(c.dreams.askLine({ at: today, session: "s-1" })).toContain('Say "dream" to start');
    const s = server(c, "s-1");
    await s.call("dream", { phase: "launch", session: "s-1" });
    expect(c.store.dreamAsk(today)?.state).toBe("launched");
    // The session closed before the agent began.
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    expect(c.dreams.askLine({ at: today, session: "s-2" })).not.toBeNull();
  });

  test("a dream journaled today whose reflection was cut off: the next line starts the REFLECTION alone, under the same cap", async () => {
    atNoon();
    const c = brain();
    lived(c);
    const today = c.store.today();
    expect(c.dreams.askLine({ at: today, session: "s-a" })).not.toBeNull();
    const d = c.dreams.begin({ session: "s-a" });
    if (!d.ok) throw new Error(d.reason);
    c.dreams.journal({ dream: d.bundle.dream, session: "s-a", text: "A dream." });
    // Right after: the run is about to reflect.
    expect(c.dreams.status(today).reason).toBe("dreamed-today");
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    const st = c.dreams.status(today);
    expect(st).toMatchObject({ due: true, reason: "due" });
    expect(st.reflectOnly?.id).toBe(d.bundle.dream);
    const line = c.dreams.askLine({ at: today, session: "s-b" }) ?? "";
    expect(line).toContain("cut off before it reflected");
    expect(line).toContain(`reflect tool with phase "launch", session: s-b, dream: ${d.bundle.dream}`);
    expect(line).not.toContain('dream tool with phase "launch"');
    // The reflect launch names the dream.
    const s = server(c, "s-b");
    const launch = await s.call("reflect", { phase: "launch", session: "s-b", dream: d.bundle.dream });
    expect(String(launch.structuredContent["prompt"])).toContain(`dream: ${d.bundle.dream}`);
    // Once the reflection finishes, the day is done.
    const r = c.reflections.begin({ session: "s-b", dream: d.bundle.dream });
    if (!r.ok) throw new Error(r.reason);
    c.reflections.finish({ reflection: r.bundle.reflection, session: "s-b", entry: "Nothing much tonight." });
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    expect(c.dreams.status(today).reason).toBe("dreamed-today");
  });

  test("the relaunch count is ONE key, overwritten by a new day — nothing to prune", () => {
    const c = brain();
    lived(c);
    c.dreams.setSetting("auto", { by: "owner" });
    const today = c.store.today();
    takeLine(c, { at: today, session: "s-1" });
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    expect(takeLine(c, { at: today, session: "s-2" })).not.toBeNull();
    expect(c.store.getMeta(RELAUNCHED_KEY)).toBe(`${today}:1`);
    expect([...c.store.metaWithPrefix("dream.relaunched").keys()]).toEqual([RELAUNCHED_KEY]);
  });
});

describe("review of #271: the reflection's result at the REAL limit", () => {
  test("a big night's begin result, AS IT LEAVES the MCP server, stays under RESULT_CHARS; every part under PART_CHARS; a part still fetches after a finish", async () => {
    const c = brain();
    c.store.advanceClock("2026-09-10");
    const long = "\"said\" \"so\" \"plainly\" ".repeat(20);
    // Older memories, outside a first dream's week: each new one is shown its neighbours among them.
    for (let i = 0; i < 120; i += 1) mem(c, `Older memory ${String(i)} of a busy week: ${long}`, { kind: "fact" });
    for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    for (let i = 0; i < 90; i += 1) {
      mem(c, `Memory ${String(i)} of a busy day: ${long}`, { kind: i % 3 === 0 ? "person" : i % 3 === 1 ? "self" : "fact", about: i % 2 === 0 ? "us" : "me" });
    }
    const page = `## Core\n\n${"\"A\" \"quoted\" \"page\". ".repeat(700)}`;
    expect(longPageWritten(c, page)).toBe(true);
    const s = server(c, SESSION);
    const d = await s.call("dream", { phase: "begin", session: SESSION });
    const dreamId = d.structuredContent["dream"] as string;
    await s.call("dream", { phase: "journal", session: SESSION, dream: dreamId, text: "A long dream." });
    const begin = await s.call("reflect", { phase: "begin", session: SESSION, dream: dreamId });
    expect(begin.isError ?? false).toBe(false);
    const parts = begin.structuredContent["parts"] as { of: number } | undefined;
    expect(parts?.of ?? 1).toBeGreaterThan(1);
    expect(textOf(begin).length).toBeLessThanOrEqual(REFLECT_TUNABLES.RESULT_CHARS);
    const rid = begin.structuredContent["reflection"] as string;
    for (let k = 2; k <= (parts?.of ?? 1); k += 1) {
      const p = await s.call("reflect", { phase: "part", session: SESSION, reflection: rid, part: k });
      expect(p.isError ?? false).toBe(false);
      expect(textOf(p).length).toBeLessThanOrEqual(REFLECT_TUNABLES.PART_CHARS);
    }
    await s.call("reflect", { phase: "finish", session: SESSION, reflection: rid, entry: "A full day." });
    const after = await s.call("reflect", { phase: "part", session: SESSION, reflection: rid, part: 2 });
    expect(after.isError ?? false).toBe(false);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// the page, by any heading
// ---------------------------------------------------------------------------

describe("the page's sections: any heading, Core and Lately by convention", () => {
  test("Us and How I work are sections; Core and Lately still read by name", () => {
    const body = "Before any heading.\n\n## Core\n\nWho I am.\n\n## Us\n\nThe two of us.\n\n## How I work\n\nThe craft.\n\n## Lately\n\nThis week.";
    const s = pageSections(body);
    expect(s.headed).toBe(true);
    expect(s.preamble).toBe("Before any heading.");
    expect(s.sections.map((x) => x.heading)).toEqual(["Core", "Us", "How I work", "Lately"]);
    expect(s.sections.find((x) => x.heading === "Us")?.body).toBe("The two of us.");
    expect(s.core).toBe("Who I am.");
    expect(s.lately).toBe("This week.");
  });

  test("a page with only other headings is headed; one with none is prose", () => {
    expect(pageSections("## Us\n\nThe two of us.")).toMatchObject({ headed: true, core: "", lately: "" });
    expect(pageSections("Just prose.")).toEqual({ core: "", lately: "", preamble: "Just prose.", headed: false, sections: [] });
    // `##Core` without a space reads as it always did.
    expect(pageSections("##Core\nWho I am.").core).toBe("Who I am.");
  });
});

// ---------------------------------------------------------------------------
// the review of #358: a writer that writes too much
// ---------------------------------------------------------------------------

/** A page of exactly `n` bytes, in plain paragraphs, as a writer would send one. */
function pageOfBytes(n: number): string {
  const para = "I keep a careful account of the work and the people in it, and I say what I do not know before I guess.";
  let page = "## Core\n\n";
  while (Buffer.byteLength(page) + Buffer.byteLength(para) + 2 <= n - 60) page += `${para}\n\n`;
  page += "## Lately\n\n";
  const tail = "The days have been full and mostly good. ";
  while (Buffer.byteLength(page) + Buffer.byteLength(tail) <= n - 1) page += tail;
  page += ".".repeat(n - Buffer.byteLength(page));
  expect(Buffer.byteLength(page)).toBe(n);
  return page;
}

describe("review of #358: a page writer that writes 6,200 bytes, through the real doors", () => {
  const LIMIT = PAGE_LIMIT_BYTES;
  const STANDING = "## Core\n\nI say what I do not know before I guess.\n\n## Lately\n\nA steady week of migrations.";

  async function nightWithLongPage(): Promise<{ c: Counterpart; s: McpServer; about: string; before: { body: string; version: number } }> {
    const c = brain();
    const about = pageWriterNight(c.store).about;
    seedYesterday(c, ["A placeholder thing noticed yesterday, about the migration order."]);
    lived(c);
    expect(c.revisePage(STANDING, { by: "owner", reason: "the page before the night" }).written).toBe(true);
    const page = c.selfPage();
    if (page === null) throw new Error("no page");
    const s = server(c, SESSION);
    const w = await s.call("dream", { phase: "writer", session: SESSION });
    expect(w.structuredContent["writer"]).toBe(true);
    // Told before it writes: the limit in the block, and what to do with a refusal.
    expect(String(w.structuredContent["read"])).toContain(`of at most ${String(LIMIT)}`);
    expect(String(w.structuredContent["how"])).toContain("refuses the page as too-large");
    expect(String(w.structuredContent["how"])).toContain("send the whole page again before you go on");
    const res = await s.call("self_page", { body: pageOfBytes(6_200), reason: "the night", session: SESSION, ifVersion: page.version });
    // Refused, with the numbers and plain words.
    expect(res.isError ?? false).toBe(true);
    expect(res.structuredContent).toMatchObject({ stored: false, reason: "too-large", bytes: 6_200, limit: LIMIT, over: 6_200 - LIMIT });
    expect(String(res.structuredContent["detail"])).toContain("Say the same thing shorter");
    // Never half-written: the page stands, byte for byte, at its version.
    expect(c.selfPage()?.body).toBe(page.body);
    expect(c.selfPage()?.version).toBe(page.version);
    return { c, s, about, before: { body: page.body, version: page.version } };
  }

  test("the night run is told how many bytes to cut, and the same run sends it again shorter — the night reads `revised`, by the writer", async () => {
    const { c, s, about, before } = await nightWithLongPage();
    // The refusal does not close the night: the same run may still write it.
    expect(c.nightClaimFor(SESSION)).not.toBeNull();
    const refused = c.pageWriterStatus(about);
    expect(refused.outcome).toBe("refused");
    expect(refused.run?.detail).toBe(pageTooLargeDetail(6_200, LIMIT));
    const shorter = pageOfBytes(LIMIT - 100);
    const ok = await s.call("self_page", { body: shorter, reason: "the night, tightened", session: SESSION, ifVersion: before.version });
    expect(ok.structuredContent["stored"]).toBe(true);
    expect(c.selfPage()?.body).toBe(shorter);
    expect(c.selfPage()?.by).toBe("writer");
    expect(c.pageWriterStatus(about).outcome).toBe("revised");
    // Moving on now answers nothing further: the night is settled.
    await s.call("dream", { phase: "begin", session: SESSION });
    expect(c.pageWriterStatus(about).outcome).toBe("revised");
  });

  test("a run that moves on without sending it again closes the night `failed` with the numbers — never `nothing-to-say`; doctor amber, the dashboard says why", async () => {
    const { c, s, about, before } = await nightWithLongPage();
    await s.call("dream", { phase: "begin", session: SESSION });
    const status = c.pageWriterStatus(about);
    expect(status.outcome).not.toBe("nothing-to-say");
    expect(status.outcome).toBe("failed");
    expect(status.derived).toBe(false);
    expect(status.run?.detail).toBe(`${pageTooLargeDetail(6_200, LIMIT)}; not sent again before the run moved on to the dream`);
    // The night is closed: a later write by the session is its own, not the writer's.
    expect(c.nightClaimFor(SESSION)).toBeNull();
    expect(c.selfPage()?.body).toBe(before.body);
    // Doctor: amber, the numbers on the line.
    const f = pageWriterFindings(c.store, { dataDir: dir, owner: true })[0];
    expect(f?.severity).toBe("amber");
    expect(f?.detail).toContain(`failed, too-large: 6200 bytes, ${String(6_200 - LIMIT)} over the`);
    // The dashboard: in plain words, and that tonight's run tries again.
    const words = writerWords({ about, outcome: status.outcome, derived: status.derived, run: { detail: status.run?.detail ?? "" } }, about);
    expect(words.what).toBe(
      `couldn't rewrite it — the page it sent was 6200 bytes, ${String(6_200 - LIMIT)} over the ${String(LIMIT)}-byte limit, and was not sent again before the run moved on to the dream`,
    );
    expect(words.next).toBe("Tonight's run tries again.");
  });

  test("the reflection: refused with how many bytes to cut, nothing written, and a second finish with the page alone writes it", () => {
    const c = brain();
    const ids = lived(c);
    const r = c.reflections.begin({ session: SESSION });
    if (!r.ok) throw new Error(r.reason);
    const cite = ids[3] as string;
    const first = c.reflections.finish({
      reflection: r.bundle.reflection,
      session: SESSION,
      entry: "Looking back, I say what I don't know.",
      cites: [cite],
      page: { text: pageOfBytes(6_200), cites: [cite] },
    });
    if (!first.ok) throw new Error(String(first.reason));
    expect(first.outcome.page).toMatchObject({ written: false, reason: "too-large" });
    const detail = (first.outcome.page as { detail?: string }).detail ?? "";
    expect(detail).toContain(`6200 bytes, past the ${String(LIMIT)}-byte limit`);
    expect(detail).toContain(`Say it in ${String(6_200 - LIMIT)} fewer bytes`);
    expect(first.outcome.retry).toContain("Not written: page — too-large");
    expect(first.outcome.retry).toContain("call finish again");
    expect(c.selfPage()).toBeNull();
    // The same run, shorter.
    const shorter = pageOfBytes(LIMIT - 200);
    const again = c.reflections.finish({ reflection: r.bundle.reflection, session: SESSION, page: { text: shorter, cites: [cite] } });
    if (!again.ok) throw new Error(String(again.reason));
    expect(again.outcome.page.written).toBe(true);
    expect(c.selfPage()?.body).toBe(shorter);
    expect(c.selfPage()?.by).toBe("reflection");
  });
});

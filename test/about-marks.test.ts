/**
 * The about-marks lane, 2026-10-11 — what a memory is about, changed on
 * purpose: the core's one door (`Counterpart.markAbout`), the owner's console
 * command (`counterparts about`), the dashboard's action and card control
 * (which run that command), and `remember`'s `remark` (by self). The fit fix
 * for the reflection's unmarked offer is tested beside the offer, in
 * `feelings-round3.test.ts`.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "../src/adapters/cli/index.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import { buildArgv, runAction } from "../src/adapters/dashboard/web/actions.js";
import { memoryDetail } from "../src/adapters/dashboard/web/views/memory.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { NIGHT_CHILD_ENV, NIGHT_RUN_ENV } from "../src/adapters/spawn.js";
import { Counterpart } from "../src/core/counterpart.js";
import { REFLECTED_FEELING_KEY } from "../src/core/sleep/index.js";
import type { PutInput } from "../src/core/store/index.js";

const WEB = fileURLToPath(new URL("../src/adapters/dashboard/web/", import.meta.url));
/** The memory card touches `window` at load (`window.openMemory = …`); give it one. */
(globalThis as { window?: unknown }).window ??= globalThis;
const SESSION = "s-about-marks";
const SCOPE = "/Users/someone/proj";

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-about-marks-"));
  dir = join(root, "store");
  Counterpart.open({ dir }).close();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function withBrain<T>(fn: (c: Counterpart) => T, opts: { observer?: boolean } = {}): T {
  const c = Counterpart.open({ dir, ...(opts.observer === true ? { observer: true } : {}) });
  try {
    return fn(c);
  } finally {
    c.close();
  }
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    origin: { scope: SCOPE },
    ...over,
  });
}

async function cli(argv: readonly string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run([...argv, "--dir", dir], { io: { out: (l) => out.push(l), err: (l) => err.push(l) } });
  return { code, out, err };
}

/** The `about` rows the core keeps for a memory, newest first. */
function aboutEvents(c: Counterpart, id: string): { actor: string | null; reason: string | null }[] {
  return c.store.coreEvents({ action: "about" }).filter((e) => e.memory_id === id).map((e) => ({ actor: e.actor, reason: e.reason }));
}

describe("the core's door: Counterpart.markAbout", () => {
  test("the owner marks an unmarked memory; the record is the reflection's kind: column, setter, and a core event with what it was and why", () => {
    withBrain((c) => {
      const id = mem(c, "Winter plan: Mike wants infrastructure first, then research credibility.");
      const out = c.markAbout({ id, mark: "owner", by: "owner", why: "His plans for his winter." });
      expect(out).toMatchObject({ ok: true, id, mark: "owner", before: null, changed: true, archived: false });
      expect(c.store.read(id).about).toBe("owner");
      expect(c.store.read(id).aboutBy).toBe("owner");
      expect(aboutEvents(c, id)).toEqual([{ actor: "owner", reason: "owner (was unmarked): His plans for his winter." }]);
      // Again, the same mark: recorded, unchanged.
      const again = c.markAbout({ id, mark: "owner", by: "owner" });
      expect(again).toMatchObject({ ok: true, changed: false, before: "owner" });
      expect(aboutEvents(c, id)[0]).toEqual({ actor: "owner", reason: "owner (was owner)" });
    });
  });

  test("refuses an unknown mark, an unknown id, a journal entry; under observer nothing is written", () => {
    const id = withBrain((c) => mem(c, "A fact about the build."));
    withBrain((c) => {
      expect(c.markAbout({ id, mark: "personal", by: "owner" })).toMatchObject({ ok: false, reason: "about-is-me-us-owner-work-or-world" });
      expect(c.markAbout({ id: "mem_doesnotexist", mark: "us", by: "owner" })).toMatchObject({ ok: false, reason: "unknown-id" });
      const epi = c.store.put({ type: "episode", kind: "fact", body: "A chapter of the afternoon.", salience: { relevance: 0.5, emotional: 0.2, predictive: 0.5 } });
      expect(c.markAbout({ id: epi, mark: "us", by: "owner" })).toMatchObject({ ok: false, reason: "not-a-memory" });
      expect(c.store.read(id).about ?? null).toBeNull();
    });
    withBrain((c) => {
      expect(c.markAbout({ id, mark: "us", by: "owner" })).toMatchObject({ ok: false, reason: "observer" });
    }, { observer: true });
  });

  test("an archived memory is marked, and says so; an earlier version forwards to the current one", () => {
    withBrain((c) => {
      const gone = mem(c, "Reading practice: how it works, started 2026-09-26.");
      c.store.archive(gone, "pruned");
      const a = c.markAbout({ id: gone, mark: "us", by: "owner" });
      expect(a).toMatchObject({ ok: true, archived: true });
      expect(a.ok && a.note).toContain("archived");
      expect(c.store.read(gone).about).toBe("us");

      const old = mem(c, "The taxes are due on the 15th.");
      const head = c.store.supersede(old, { type: "memory", kind: "fact", body: "The taxes are due on October 15.", salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 } });
      const f = c.markAbout({ id: old, mark: "owner", by: "owner" });
      expect(f).toMatchObject({ ok: true, id: head, forwardedFrom: old });
      expect(c.store.read(head).about).toBe("owner");
    });
  });

  test("by self: a dream's words move only toward work or world; a confidential one outside the owner's session is not found; no why is recorded as such", () => {
    withBrain((c) => {
      const gist = mem(c, "Dreamed: running isn't reaching.", { source: "dreamed", kind: "skill" });
      expect(c.markAbout({ id: gist, mark: "us", by: "self", why: "It is about how we work." })).toMatchObject({ ok: false, reason: "dreamed-is-a-suggestion" });
      expect(c.markAbout({ id: gist, mark: "work", by: "self", why: "The craft." })).toMatchObject({ ok: true });
      // The owner may mark it anything.
      expect(c.markAbout({ id: gist, mark: "us", by: "owner" })).toMatchObject({ ok: true });

      // The retired confidential mark (2026-10-21) is an inert meta key: found like any other.
      const secret = mem(c, "A private worry Mike shared.", { meta: { confidential: true } });
      expect(c.markAbout({ id: secret, mark: "owner", by: "self", why: "His." })).toMatchObject({ ok: true });

      const plain = mem(c, "Mike's sister visited in September.");
      const n = c.markAbout({ id: plain, mark: "owner", by: "self" });
      expect(n.ok && n.note).toContain("No why was given");
      expect(c.store.read(plain).aboutBy).toBe("self");
      expect(aboutEvents(c, plain)[0]).toEqual({ actor: "self", reason: "owner (was unmarked): no why given" });
    });
  });
});

describe("the owner's console door: counterparts about", () => {
  test("reads a mark; changes it as the owner with the why kept; refuses what it cannot do", async () => {
    const id = withBrain((c) => mem(c, "Han thread: left as is; Mike won't be the bridge."));
    const read = await cli(["about", id]);
    expect(read.code).toBe(0);
    expect(read.out[0]).toBe(`${id} is unmarked.`);

    const set = await cli(["about", id, "us", "--why", "It is about the two of us."]);
    expect(set.code).toBe(0);
    expect(set.out[0]).toBe(`Marked ${id} about us (it was unmarked), as you.`);
    expect(set.out.join("\n")).toContain("Why, as recorded: It is about the two of us.");
    withBrain((c) => {
      expect(c.store.read(id).about).toBe("us");
      expect(c.store.read(id).aboutBy).toBe("owner");
      expect(aboutEvents(c, id)[0]).toEqual({ actor: "owner", reason: "us (was unmarked): It is about the two of us." });
    });
    const after = await cli(["about", id]);
    expect(after.out[0]).toBe(`${id} is about us — marked by you.`);

    const bad = await cli(["about", id, "personal"]);
    expect(bad.code).not.toBe(0);
    expect(bad.err.join(" ")).toContain('"personal" is not a mark');
    const unknown = await cli(["about", "mem_nope", "us"]);
    expect(unknown.code).not.toBe(0);
    expect(unknown.err.join(" ")).toContain("No memory mem_nope");
    expect((await cli(["about"])).code).not.toBe(0);
    expect((await cli(["about", id, "us", "extra"])).code).not.toBe(0);
    expect((await cli(["about", id, "--why", "no mark"])).code).not.toBe(0);
    const watching = await cli(["about", id, "work", "--observer"]);
    expect(watching.code).not.toBe(0);
    expect(watching.err.join(" ")).toContain("observer");
    withBrain((c) => expect(c.store.read(id).about).toBe("us"));
  });

  test("an earlier version's id reads and marks the current one", async () => {
    const { old, head } = withBrain((c) => {
      const o = mem(c, "The taxes are due on the 15th.");
      const h = c.store.supersede(o, { type: "memory", kind: "fact", body: "The taxes are due on October 15.", salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 } });
      return { old: o, head: h };
    });
    const read = await cli(["about", old]);
    expect(read.out[0]).toBe(`${head} is unmarked.`);
    expect(read.out[1]).toContain(`${old} is an earlier version`);
    const set = await cli(["about", old, "owner"]);
    expect(set.out[0]).toBe(`Marked ${head} about owner (it was unmarked), as you.`);
    expect(set.out[1]).toContain(`${old} is an earlier version`);
  });

  test("its help page names the marks and the one flag", async () => {
    const help = await run(["help", "about"], { io: { out: () => undefined, err: () => undefined } });
    expect(help).toBe(0);
    const lines: string[] = [];
    await run(["about", "--help"], { io: { out: (l) => lines.push(l), err: (l) => lines.push(l) } });
    const page = lines.join("\n");
    expect(page).toContain("me|us|owner|work|world");
    expect(page).toContain("--why");
  });
});

describe("the dashboard's door: the about action and the card's control", () => {
  test("the argv is the console's about command, positionals after --; a mark not in the five is refused before anything runs", async () => {
    const built = buildArgv("about", { id: "mem_abc123", about: "owner", why: "His plans." }, { dir });
    expect(built.argv).toEqual(["about", "--dir", dir, "--why=His plans.", "--", "mem_abc123", "owner"]);
    const res = await runAction("about", { id: "mem_abc123", about: "personal" }, { dir });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("about is one of");
  });

  test("running it marks the memory as the owner, and the card reads the mark back", async () => {
    const id = withBrain((c) => mem(c, "Design thought: the self-page reads like a facade."));
    const res = await runAction("about", { id, about: "me", why: "About who I am." }, { dir });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.out?.[0]).toBe(`Marked ${id} about me (it was unmarked), as you.`);
    const dash = Dashboard.open({ dir });
    try {
      const d = memoryDetail(dash.source, id);
      expect(d.about).toBe("me");
      expect(d.aboutBy).toBe("owner");
      const { aboutControl } = (await import(join(WEB, "shared/memory-modal.js"))) as { aboutControl(d: unknown): string };
      const html = aboutControl(d);
      expect(html).toContain("About me — who I am");
      expect(html).toContain("marked by you");
      expect(html).toContain('<option value="me" selected>');
      expect(html).toContain("markAbout(this)");
      expect(aboutControl({ ...d, about: null, aboutBy: null })).toContain("Not marked");
      expect(aboutControl({ ...d, journal: true })).toBe("");
    } finally {
      dash.close();
    }
  });
});

describe("the session's door: remember's remark, by self", () => {
  test("only on a memory this session was shown; then recorded as mine with the why; alone or beside a note", async () => {
    const id = withBrain((c) => mem(c, "Reading practice: how it works, started 2026-09-26.", { kind: "skill" }));
    const s = openServer({ dir, session: SESSION, scope: SCOPE });
    try {
      const early = await s.call("remember", { remark: { id, about: "us", why: "How the two of us read together." } });
      expect(early.isError).toBe(true);
      expect(early.structuredContent["reason"]).toBe("remark-only");
      expect((early.structuredContent["remark"] as { reason: string }).reason).toBe("not-shown-or-gone");

      await s.call("recall", { ids: [id] });
      const now = await s.call("remember", { remark: { id, about: "us", why: "How the two of us read together." } });
      expect(now.isError).not.toBe(true);
      expect(now.structuredContent["stored"]).toBe(false);
      expect(now.structuredContent["remark"]).toMatchObject({ ok: true, id, mark: "us", before: null, changed: true });
      const store = s.counterpart.store;
      expect(store.read(id).about).toBe("us");
      expect(store.read(id).aboutBy).toBe("self");
      expect(store.coreEvents({ action: "about" }).find((e) => e.memory_id === id)?.actor).toBe("self");

      // Beside a note: both land.
      const both = await s.call("remember", { text: "Mike asked me to keep a reading notes file for the posts we read.", remark: { id, about: "work", why: "On reflection it is a technique." } });
      expect(both.structuredContent["stored"]).toBe(true);
      expect(both.structuredContent["remark"]).toMatchObject({ ok: true, mark: "work", before: "us" });

      const bad = await s.call("remember", { remark: [id] });
      expect(bad.structuredContent["reason"]).toBe("remark-malformed");
    } finally {
      s.counterpart.close();
    }
  });
});

describe("--reflected-feeling off reaches a night child's remark, not an awake one (review of #383)", () => {
  test("the core door: from a night run with the switch off, only work or world; awake, or the switch on, any mark", () => {
    withBrain((c) => {
      const id = mem(c, "The walk by the canal on the evening the move was settled.");
      c.store.setMeta(REFLECTED_FEELING_KEY, "off");
      const night = c.markAbout({ id, mark: "us", by: "self", why: "It was ours.", night: true });
      expect(night).toMatchObject({ ok: false, reason: "door-closed-work-or-world-only" });
      expect(c.store.read(id).about ?? null).toBeNull();
      // Toward work or world stays open to the night, as it does for the reflection.
      expect(c.markAbout({ id, mark: "world", by: "self", why: "A place, mostly.", night: true }).ok).toBe(true);
      // An awake session's re-mark is not the reflection's: the switch does not reach it.
      expect(c.markAbout({ id, mark: "us", by: "self", why: "It was ours." })).toMatchObject({ ok: true, mark: "us" });
      // Nor the owner's own door.
      expect(c.markAbout({ id, mark: "owner", by: "owner", night: true }).ok).toBe(true);
      c.store.setMeta(REFLECTED_FEELING_KEY, "on");
      expect(c.markAbout({ id, mark: "me", by: "self", why: "Mine.", night: true })).toMatchObject({ ok: true, mark: "me" });
    });
  });

  test("the session's door: a server whose environment names a night run is held to it; one that does not is not", async () => {
    const id = withBrain((c) => {
      c.store.setMeta(REFLECTED_FEELING_KEY, "off");
      return mem(c, "The first morning in the new flat, boxes everywhere.");
    });
    // Either mark: the child's name on the server (the night's MCP configuration), or the run's id.
    for (const env of [{ [NIGHT_CHILD_ENV]: "reflection" }, { [NIGHT_RUN_ENV]: "run_test" }]) {
      const night = openServer({ dir, session: SESSION, scope: SCOPE, env });
      try {
        await night.call("recall", { ids: [id] });
        const r = await night.call("remember", { remark: { id, about: "us", why: "Ours." } });
        expect((r.structuredContent["remark"] as { reason: string }).reason).toBe("door-closed-work-or-world-only");
        expect(night.counterpart.store.read(id).about ?? null).toBeNull();
      } finally {
        night.counterpart.close();
      }
    }
    const awake = openServer({ dir, session: SESSION, scope: SCOPE, env: {} });
    try {
      await awake.call("recall", { ids: [id] });
      const r = await awake.call("remember", { remark: { id, about: "us", why: "Ours." } });
      expect(r.structuredContent["remark"]).toMatchObject({ ok: true, mark: "us" });
    } finally {
      awake.counterpart.close();
    }
  });
});

describe("remark beside each other part: an error only when nothing landed (review of #383)", () => {
  type R = { isError?: boolean; structuredContent: Record<string, unknown> };
  const err = (r: R): boolean => r.isError === true;
  const remarkOk = (r: R): boolean => (r.structuredContent["remark"] as { ok?: boolean } | undefined)?.ok === true;

  async function serverWith(): Promise<{ s: ReturnType<typeof openServer>; shown: string; other: string; a: string; b: string }> {
    const ids = withBrain((c) => {
      c.store.advanceClock("2026-09-01");
      const shown = mem(c, "Winter plan: which projects Mike keeps going through the cold months.");
      const other = mem(c, "The night run pins its token line with an env var.");
      const a = mem(c, "Retro is on Fridays.");
      const b = mem(c, "Retro is on Thursdays.");
      for (const d of ["2026-09-02", "2026-09-03", "2026-09-04"]) c.store.advanceClock(d);
      return { shown, other, a, b };
    });
    const s = openServer({ dir, session: SESSION, scope: SCOPE });
    await s.call("recall", { ids: [ids.shown, ids.other] });
    return { s, ...ids };
  }

  test("beside text: text lands + remark fails, not an error; text refused + remark lands, not an error; both fail, an error", async () => {
    const { s, shown } = await serverWith();
    try {
      const r1 = (await s.call("remember", { text: "A brand new note about the release checklist order.", remark: { id: "mem_nope", about: "us" } })) as R;
      expect(r1.structuredContent["stored"]).toBe(true);
      expect(remarkOk(r1)).toBe(false);
      expect(err(r1)).toBe(false);

      // An early refusal of the note (salience not a number): the remark still lands.
      const r2 = (await s.call("remember", { text: "Another note.", salience: "high", remark: { id: shown, about: "owner", why: "His plans." } })) as R;
      expect(r2.structuredContent["reason"]).toBe("salience-not-a-number");
      expect(remarkOk(r2)).toBe(true);
      expect(err(r2)).toBe(false);
      expect(s.counterpart.store.read(shown).about).toBe("owner");

      const r3 = (await s.call("remember", { text: "Another note.", salience: "high", remark: { id: "mem_nope", about: "us" } })) as R;
      expect(err(r3)).toBe(true);
      // A bad mark on a shown memory is a failed remark too.
      const r4 = (await s.call("remember", { text: "Another note.", salience: "high", remark: { id: shown, about: "personal" } })) as R;
      expect((r4.structuredContent["remark"] as { reason: string }).reason).toBe("about-is-me-us-owner-work-or-world");
      expect(err(r4)).toBe(true);
    } finally {
      s.counterpart.close();
    }
  });

  test("beside a settle: each failing in turn", async () => {
    const { s, shown, a, b } = await serverWith();
    try {
      const r1 = (await s.call("remember", { settle: { holds: b, over: a, how: "changed", why: "moved" }, remark: { id: "mem_nope", about: "us" } })) as R;
      expect((r1.structuredContent["settle"] as { ok: boolean }).ok).toBe(true);
      expect(remarkOk(r1)).toBe(false);
      expect(err(r1)).toBe(false);

      const r2 = (await s.call("remember", { settle: { holds: "mem_x1", over: "mem_x2", how: "changed", why: "x" }, remark: { id: shown, about: "us", why: "Ours." } })) as R;
      expect((r2.structuredContent["settle"] as { ok: boolean }).ok).toBe(false);
      expect(remarkOk(r2)).toBe(true);
      expect(err(r2)).toBe(false);

      const r3 = (await s.call("remember", { settle: { holds: "mem_x1", over: "mem_x2", how: "changed", why: "x" }, remark: { id: "mem_nope", about: "us" } })) as R;
      expect(err(r3)).toBe(true);
    } finally {
      s.counterpart.close();
    }
  });

  test("beside feelings now: each failing in turn", async () => {
    const { s, shown, other } = await serverWith();
    try {
      const feel = (id: string) => [{ id, core: "calm", emotion: "relieved", strength: 0.9, carried_by: "It held." }];
      const r1 = (await s.call("remember", { feelingsNow: feel(other), remark: { id: "mem_nope", about: "us" } })) as R;
      expect((r1.structuredContent["feelingsNow"] as { recorded: number }).recorded).toBe(1);
      expect(remarkOk(r1)).toBe(false);
      expect(err(r1)).toBe(false);

      const r2 = (await s.call("remember", { feelingsNow: feel("mem_nope"), remark: { id: shown, about: "us", why: "Ours." } })) as R;
      expect((r2.structuredContent["feelingsNow"] as { recorded: number }).recorded).toBe(0);
      expect(remarkOk(r2)).toBe(true);
      expect(err(r2)).toBe(false);

      const r3 = (await s.call("remember", { feelingsNow: feel("mem_nope"), remark: { id: "mem_nope", about: "us" } })) as R;
      expect(err(r3)).toBe(true);
    } finally {
      s.counterpart.close();
    }
  });

  test("a why with a credential in it is redacted before it reaches the record, from either door", async () => {
    const { s, shown } = await serverWith();
    const key = "sk-ant-api03-" + "A".repeat(90) + "AA";
    try {
      const r = (await s.call("remember", { remark: { id: shown, about: "owner", why: `His plans; the key was ${key}` } })) as R;
      expect(remarkOk(r)).toBe(true);
    } finally {
      s.counterpart.close();
    }
    const token = "ghp_" + "b".repeat(36);
    const out = await cli(["about", shown, "work", "--why", `typed ${token}`]);
    expect(out.code).toBe(0);
    // The console (and the dashboard, which shows its output) echoes the why as recorded.
    expect(out.out.join("\n")).not.toContain(token);
    expect(out.out.join("\n")).toContain("Why, as recorded: typed [REDACTED");
    withBrain((c) => {
      const reasons = aboutEvents(c, shown).map((e) => e.reason ?? "");
      expect(reasons.length).toBe(2);
      for (const why of reasons) {
        expect(why).not.toContain(key);
        expect(why).not.toContain(token);
      }
    });
  });
});

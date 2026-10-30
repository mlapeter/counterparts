/**
 * THE CATCH-UP LEAVES OUT A FOLDER THAT IS NOT ON (2026-10-30).
 *
 * A session captured while its folder was on, the folder then set off, observer
 * or paused: a later night writes no memories from it, grants it to no child,
 * counts it in nothing owed, and starts no night for it. The real doors: the
 * night's `runNight` and `counterparts catch-up`, with a child that drives the
 * real MCP server as the runner; the hook's prompt and session start. A paused
 * folder resumed is owed again, and nothing about the session was changed.
 *
 * Hermetic (CLAUDE.md): a fresh temp store per test, removed after. No model
 * and no `claude`: the child is an injected starter.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { AdapterConfig } from "../src/adapters/config.js";
import { defaultConfigPath } from "../src/adapters/config-path.js";
import type { ChildPlan, ChildResult } from "../src/adapters/claude-code/child.js";
import { owedFolders, readOwed } from "../src/adapters/claude-code/doctor-write-ups.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { NOTHING_OWED_BEFORE_KEY, catchUpOf, runCatchUp } from "../src/adapters/claude-code/night-catch-up.js";
import { claudeCodeSeat, openNightCounterpart, runNight } from "../src/adapters/claude-code/night-run.js";
import { EXIT, run } from "../src/adapters/cli/index.js";
import { coverageLines, coverageReading } from "../src/adapters/cli/coverage.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { emptyRegistry, foldersOn, readScopes, scopesPath, setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeMode } from "../src/adapters/scopes.js";
import { WRITE_UP_PART_BYTES, readSession, readWriteUpProgress, recordSession, writeUpEntries, writeUpPartsDated, writeUpPlan } from "../src/adapters/sessions.js";
import { SCOPE_ENV, SESSION_ENV } from "../src/adapters/spawn.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { Counterpart } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import { localDate } from "../src/core/time.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NIGHTLY = "/pkg/bin/nightly.ts";

let root: string;
let dir: string;
let cfg: string;
let on: string;
let turned: string;
let launch: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-respects-off-")));
  dir = join(root, "store");
  cfg = join(root, "claude-code.json");
  on = join(root, "on");
  turned = join(root, "turned");
  launch = join(root, "launch");
  for (const d of [dir, on, turned, launch]) mkdirSync(d, { recursive: true });
  writeFileSync(cfg, `${JSON.stringify({ dataDir: dir })}\n`);
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

const config = (): AdapterConfig => ({ dataDir: dir, injectionBudgetBytes: 9000 });
const TODAY = (): string => localDate(Date.now());

function yesterday10(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - 14 * HOUR;
}

/** A session that talked in `scope` yesterday and ended, owing its write-up. */
function lived(id: string, scope: string, opts: { pieces?: number; filed?: string } = {}): void {
  mkdirSync(scope, { recursive: true });
  let at = yesterday10();
  const c = Counterpart.open({ dir, now: () => at });
  try {
    recordSession(dir, { sessionId: id, scope: opts.filed ?? scope, phase: "start", at });
    const turns: { role: "user" | "assistant"; text: string }[] = [];
    for (let i = 0; i < (opts.pieces ?? 6); i++) {
      at += 8 * MIN;
      turns.push({ role: "user", text: `${id} #${String(i)}: the relief valve on loop ${String(i)} is seated before the pump runs.` });
      turns.push({ role: "assistant", text: `(${id} #${String(i)}) Understood, the valve on loop ${String(i)} first.` });
      c.captureSpans({ session: id, scope, turns: [...turns] });
    }
    c.boundary({ session: id, scope, kind: "stop" });
    recordSession(dir, { sessionId: id, scope, phase: "boundary", at });
    c.boundary({ session: id, scope, kind: "session-end" });
    recordSession(dir, { sessionId: id, scope, phase: "end", at: at + 1 });
  } finally {
    c.close();
  }
}

/** The folder setting, as `counterparts scope` writes it, beside the configuration. */
function setFolder(folder: string, mode: ScopeMode): void {
  const file = scopesPath(cfg);
  writeScopes(file, setScope(readScopes(file).registry, folder, mode, { at: new Date().toISOString() }));
}

/** The catch-up child, as its one tool drives it: fetch, answer, until done. */
function drivingChild(seen: ChildPlan[]): (plan: ChildPlan) => Promise<ChildResult> {
  return async (plan) => {
    seen.push(plan);
    const runner = plan.env[SESSION_ENV] as string;
    const ids = [...plan.stdin.matchAll(/^- ([A-Za-z0-9._-]+):/gm)].map((m) => m[1] as string);
    const s = openServer({ dir, session: runner, scope: plan.env[SCOPE_ENV] as string });
    try {
      for (const id of ids) {
        for (let guard = 0; guard < 10; guard++) {
          const f = (await s.call("session_end", { session: runner, writeUp: id })).structuredContent;
          if (f["reason"] !== "part") break;
          const part = f["part"] as number;
          const memories = [{ content: `Written up from ${id}, part ${String(part)}: the relief valve is seated before the pump runs.`, kind: "fact" }];
          const a = (await s.call("session_end", { session: runner, writeUp: id, part, memories })).structuredContent;
          if (a["reason"] !== "part-written") break;
        }
      }
    } finally {
      s.counterpart.close();
    }
    return { code: 0, timedOut: false, error: null };
  };
}

/** One night through its real door, the dream's own child a no-op. */
async function night(runId: string, seen: ChildPlan[], opts: { noConfig?: boolean } = {}): Promise<void> {
  await runNight({
    open: () => openNightCounterpart(config()),
    config: config(),
    ...(opts.noConfig === true ? {} : { configPath: cfg }),
    run: runId,
    session: "s-launch",
    scope: launch,
    kind: { kind: "night" },
    date: TODAY(),
    baseEnv: { PATH: "/usr/bin:/bin" },
    startCatchUp: drivingChild(seen),
    start: async () => ({ code: 0, timedOut: false, error: null }),
  });
}

/** Who has live memories written from them, by origin session. */
function writtenFrom(): string[] {
  const c = openNightCounterpart(config());
  try {
    return [...new Set(c.store.list({ type: "memory", archived: false }).map((id) => c.store.row(id)?.origin_session ?? ""))].filter((s) => s.length > 0).sort();
  } finally {
    c.close();
  }
}

function heldOf(id: string): ReturnType<typeof writeUpPlan>[number] | undefined {
  const c = openNightCounterpart(config());
  try {
    return writeUpPlan({ store: c.store, spans: c.spans }).find((h) => h.session === id);
  } finally {
    c.close();
  }
}

describe("through the night's door, on and not-on side by side", () => {
  for (const mode of ["off", "observer", "paused"] as const) {
    test(`a folder set ${mode} after its session was captured: no write-up, no grant, no claim; the on folder's is written up`, async () => {
      lived("s-on", on);
      lived("s-turned", turned);
      // A subfolder inherits its ancestor's entry, as it does for the hook.
      lived("s-sub", join(turned, "sub"));
      setFolder(turned, mode);

      const seen: ChildPlan[] = [];
      await night("nrn_side", seen);

      expect(writtenFrom()).toEqual(["s-on"]);
      expect(seen.length).toBe(1);
      const prompt = (seen[0] as ChildPlan).stdin;
      expect(prompt).toContain("- s-on:");
      expect(prompt).not.toContain("s-turned");
      expect(prompt).not.toContain("s-sub");
      const runner = (seen[0] as ChildPlan).env[SESSION_ENV] as string;
      expect(readSession(dir, runner)?.mayWriteUp).toEqual([]);

      const c = openNightCounterpart(config());
      closers.push(c);
      // Nothing about the left-out sessions was touched: no progress, no
      // claim, and the row says nothing is left.
      for (const key of Object.keys(readWriteUpProgress(c.store))) expect(key.startsWith("s-on|")).toBe(true);
      expect(catchUpOf(c.store, "nrn_side")).toMatchObject({ state: "done", granted: 1, written: 1, left: 0, partsLeft: 0 });
    });
  }

  test("only a not-on folder owed: no child starts and no row is written, a quiet night", async () => {
    lived("s-turned", turned);
    setFolder(turned, "off");
    const seen: ChildPlan[] = [];
    await night("nrn_quiet", seen);
    expect(seen.length).toBe(0);
    const c = openNightCounterpart(config());
    closers.push(c);
    expect(catchUpOf(c.store, "nrn_quiet")).toBeNull();
  });

  test("a subfolder's own `on` entry beats its ancestor's `off`, longest prefix first", async () => {
    const sub = join(turned, "sub");
    lived("s-sub", sub);
    lived("s-turned", turned);
    setFolder(turned, "off");
    setFolder(sub, "on");
    const seen: ChildPlan[] = [];
    await night("nrn_sub", seen);
    expect(writtenFrom()).toEqual(["s-sub"]);
  });

  test("a session with words in an on folder and an off one is set aside whole, the hook's most restrictive rule", async () => {
    lived("s-both", on);
    lived("s-both", turned);
    setFolder(turned, "off");
    const seen: ChildPlan[] = [];
    await night("nrn_both", seen);
    expect(seen.length).toBe(0);
    expect(writtenFrom()).toEqual([]);
  });

  test("a session filed under an off folder is set aside, whatever folder its words are under", async () => {
    lived("s-filed", on, { filed: turned });
    expect(readSession(dir, "s-filed")?.scope).toBe(turned);
    setFolder(turned, "off");
    const seen: ChildPlan[] = [];
    await night("nrn_filed", seen);
    expect(seen.length).toBe(0);
  });

  test("no setting at all, or no configuration named: every folder is on, as before", async () => {
    lived("s-a", on);
    const seen: ChildPlan[] = [];
    await night("nrn_none", seen);
    expect(writtenFrom()).toEqual(["s-a"]);

    lived("s-b", turned);
    setFolder(turned, "off");
    await night("nrn_unnamed", seen, { noConfig: true });
    expect(writtenFrom()).toEqual(["s-a", "s-b"]);
  });

  test("a setting that will not read takes nothing, and the debt stands until it is fixed", async () => {
    lived("s-on", on);
    writeFileSync(scopesPath(cfg), "{ not json");
    const seen: ChildPlan[] = [];
    await night("nrn_broken", seen);
    expect(seen.length).toBe(0);
    expect(writtenFrom()).toEqual([]);

    rmSync(scopesPath(cfg));
    await night("nrn_fixed", seen);
    expect(writtenFrom()).toEqual(["s-on"]);
  });
});

describe("what becomes of what it left out", () => {
  test("a paused folder resumed is owed again, its text untouched, and is written up", async () => {
    lived("s-paused", turned);
    setFolder(turned, "paused");
    const seen: ChildPlan[] = [];
    await night("nrn_while", seen);
    expect(seen.length).toBe(0);

    // Still held and still the ledger's debt: retention reads it unchanged.
    expect(heldOf("s-paused")?.owes).toBe(true);
    const c = openNightCounterpart(config());
    expect(writeUpEntries(c.spans, { session: "s-paused", scopes: [turned] }).length).toBeGreaterThan(0);
    c.close();

    setFolder(turned, "on");
    await night("nrn_after", seen);
    expect(writtenFrom()).toEqual(["s-paused"]);
    expect(heldOf("s-paused")?.owes).toBe(false);
  });

  test("an off folder's session stays the ledger's debt, so retention's clocks are the ones it goes by; only the asking stops", () => {
    lived("s-off", turned);
    setFolder(turned, "off");
    const s = Store.open({ dir, observer: true });
    closers.push(s);
    const row = coverageReading(s, foldersOn(scopesPath(cfg))).find((e) => e.session === "s-off");
    expect(row).toMatchObject({ owed: true, person: false });
  });
});

describe("the readers of the debt", () => {
  test("doctor's reading does not count it, and counts it again on resume", () => {
    lived("s-on", on);
    lived("s-off", turned);
    lived("s-short", join(turned, "sub"), { pieces: 2 });
    setFolder(turned, "off");
    const s = Store.open({ dir, observer: true });
    closers.push(s);
    const before = readOwed(s, foldersOn(scopesPath(cfg)));
    expect(before).toMatchObject({ waiting: 1, unpointed: 0 });
    setFolder(turned, "on");
    const after = readOwed(s, foldersOn(scopesPath(cfg)));
    expect(after).toMatchObject({ waiting: 3 });
  });

  test("doctor keeps counting when the setting will not read, so a night that can take nothing shows", () => {
    lived("s-on", on);
    lived("s-off", turned);
    setFolder(turned, "off");
    const s = Store.open({ dir, observer: true });
    closers.push(s);
    expect(readOwed(s, owedFolders(cfg))).toMatchObject({ waiting: 1 });
    writeFileSync(scopesPath(cfg), "{ not json");
    expect(readOwed(s, owedFolders(cfg))).toMatchObject({ waiting: 2 });
  });

  test("`counterparts coverage` says why, by session id and with no folder in the sentence", () => {
    lived("s-on", on);
    lived("s-off", turned);
    setFolder(turned, "off");
    const s = Store.open({ dir, observer: true });
    closers.push(s);
    const date = localDate(yesterday10());
    const printed = coverageLines({ store: s, date, today: TODAY(), folders: foldersOn(scopesPath(cfg)) }).join("\n");
    expect(printed).toContain("Owed now: 1 session — s-on (");
    expect(printed).toContain("Not asked for (folder off, observer or paused): 1 session — s-off.");
    expect(printed).toContain("its folder is off, observer or paused: not written up while it stays so");
  });

  test("`counterparts catch-up --config` takes the setting beside that configuration", async () => {
    lived("s-on", on);
    lived("s-off", turned);
    setFolder(turned, "off");
    const seen: ChildPlan[] = [];
    const io = { out: (): void => undefined, err: (): void => undefined };
    const code = await run(["catch-up", "--config", cfg], { io, env: { PATH: "/usr/bin:/bin", COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" }, catchUpStart: drivingChild(seen) });
    expect(code).toBe(EXIT.ok);
    expect(writtenFrom()).toEqual(["s-on"]);
  });
});

describe("through the console's doors", () => {
  const doctorLine = async (args: string[]): Promise<{ line: string; fix: string }> => {
    const out: string[] = [];
    await run(["doctor", ...args], { io: { out: (l) => out.push(l), err: () => undefined }, env: { PATH: "/usr/bin:/bin", COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" } });
    const at = out.findIndex((l) => l.includes("Catch-up"));
    return { line: out[at] ?? "", fix: out[at + 1] ?? "" };
  };

  test("`counterparts doctor --config`: an off folder's session is nothing owed, an on folder's is owed", async () => {
    lived("s-off", turned);
    setFolder(turned, "off");
    expect((await doctorLine(["--config", cfg])).line).toContain("nothing owed");
    lived("s-on", on);
    expect((await doctorLine(["--config", cfg])).line).toContain("1 session to catch up");
  });

  test("a setting that will not read, by every door: named, counted, and never called nothing owed", async () => {
    lived("s-on", on);
    writeFileSync(scopesPath(cfg), "{ not json");

    const doc = await doctorLine(["--config", cfg]);
    expect(doc.line).toContain("AMBER");
    expect(doc.line).toContain("1 session to catch up");
    expect(doc.line).toContain("scopes.json will not read");
    expect(doc.fix).toContain("Fix or remove");
    expect(doc.fix).not.toContain("Run counterparts catch-up");

    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (l: string): void => void out.push(l), err: (l: string): void => void err.push(l) };
    const seen: ChildPlan[] = [];
    const code = await run(["catch-up", "--config", cfg], { io, env: { PATH: "/usr/bin:/bin", COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" }, catchUpStart: drivingChild(seen) });
    expect(code).toBe(3);
    expect(seen.length).toBe(0);
    expect(out.join("\n")).not.toContain("every ended session is written up");
    expect(err.join("\n")).toContain("Nothing was caught up");
    expect(err.join("\n")).toContain("scopes.json");
    expect(err.join("\n")).toContain("write-ups stop");
    expect(err.join("\n")).toContain("text that ages out meanwhile is lost");
  });

  test("`counterparts coverage` on the default store: the setting beside the default configuration, and its trouble", async () => {
    // The preload's temporary home, never a real one.
    const home = process.env["HOME"] as string;
    expect(home).toContain("counterparts-test-home-");
    const config_ = defaultConfigPath(home);
    const store_ = join(dirname(config_), "store");
    mkdirSync(store_, { recursive: true });
    writeFileSync(config_, `${JSON.stringify({ dataDir: store_ })}\n`);
    const [dirWas, cfgWas] = [dir, cfg];
    dir = store_;
    cfg = config_;
    try {
      lived("s-on", on);
      lived("s-off", turned);
      setFolder(turned, "off");
      const coverage = async (): Promise<{ out: string; err: string }> => {
        const out: string[] = [];
        const err: string[] = [];
        expect(await run(["coverage"], { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, env: { PATH: "/usr/bin:/bin" }, home })).toBe(EXIT.ok);
        return { out: out.join("\n"), err: err.join("\n") };
      };
      const set = await coverage();
      expect(set.out).toContain("Owed now: 1 session — s-on (");
      expect(set.out).toContain("Not asked for (folder off, observer or paused): 1 session — s-off.");

      // Broken, it agrees with doctor: both still counted, neither called off.
      writeFileSync(scopesPath(config_), "{ not json");
      const broken = await coverage();
      expect(broken.out).toContain("Owed now: 2 sessions");
      expect(broken.out).not.toContain("Not asked for (folder off");
      expect(broken.err).toContain("write-ups stop");
    } finally {
      dir = dirWas;
      cfg = cfgWas;
      rmSync(dirname(config_), { recursive: true, force: true });
    }
  });
});

test("what a stopped run says is left counts only what it could take: `partsLeft` over a big on-folder session beside an off one", async () => {
  // Past one part (`WRITE_UP_PART_BYTES`), so a run allowed one part leaves some.
  const long = "the relief valve on this loop is seated before the pump runs, and checked again after. ".repeat(40);
  mkdirSync(on, { recursive: true });
  let at = yesterday10();
  const c = Counterpart.open({ dir, now: () => at });
  recordSession(dir, { sessionId: "s-big", scope: on, phase: "start", at });
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  for (let i = 0; i < 40; i++) {
    at += 2 * MIN;
    turns.push({ role: "user", text: `#${String(i)} ${long}` });
    turns.push({ role: "assistant", text: `(#${String(i)}) ${long}` });
    c.captureSpans({ session: "s-big", scope: on, turns: [...turns] });
  }
  c.boundary({ session: "s-big", scope: on, kind: "session-end" });
  recordSession(dir, { sessionId: "s-big", scope: on, phase: "end", at });
  c.close();
  lived("s-off", turned);
  setFolder(turned, "off");

  const seen: ChildPlan[] = [];
  await runCatchUp({
    open: () => openNightCounterpart(config()),
    config: config(),
    configPath: cfg,
    run: "cup_parts",
    scope: dir,
    now: () => Date.now(),
    parts: 1,
    seat: claudeCodeSeat({ config: config(), open: () => openNightCounterpart(config()), startCatchUp: drivingChild(seen) }),
  });
  const read = openNightCounterpart(config());
  closers.push(read);
  const row = catchUpOf(read.store, "cup_parts");
  expect(row).toMatchObject({ written: 0, left: 1 });
  const parts = writeUpPartsDated(writeUpEntries(read.spans, { session: "s-big", scopes: [on] }), WRITE_UP_PART_BYTES).length;
  expect(parts).toBeGreaterThan(1);
  // The big session's own remainder and no more: the off session's part is not in it.
  expect(row?.partsLeft).toBe(parts - 1);
});

describe("through the hook", () => {
  const plans: SpawnPlan[] = [];
  beforeEach(() => {
    plans.length = 0;
  });
  function hooksAt(setting: "auto" | "ask"): ClaudeCodeAdapter {
    const counterpart = Counterpart.open({ dir, now: () => Date.now() });
    closers.push(counterpart);
    counterpart.dreams.setSetting(setting, { by: "owner" });
    return new ClaudeCodeAdapter({
      counterpart,
      config: config(),
      configPath: cfg,
      command: "/usr/bin/bun",
      args: ["run", "/pkg/bin/runner.ts"],
      nightArgs: ["run", NIGHTLY],
      spawner: (p) => {
        plans.push(p);
        return { pid: 4242 };
      },
      now: () => Date.now(),
    });
  }
  const nights = (): SpawnPlan[] => plans.filter((p) => p.args.includes(NIGHTLY));
  const prompt = (a: ClaudeCodeAdapter): void => {
    recordSession(dir, { sessionId: "today-1", scope: launch, phase: "start" });
    a.userPromptSubmit({ sessionId: "today-1", scope: launch, turns: [], at: TODAY(), prompt: "good morning" } as HookInput);
  };

  test("only a not-on folder owed starts no night for its catch-up, and the day's zero is remembered", () => {
    lived("s-off", turned);
    setFolder(turned, "off");
    const a = hooksAt("auto");
    prompt(a);
    expect(nights()).toHaveLength(0);
    expect(a.counterpart.store.getMeta(NOTHING_OWED_BEFORE_KEY)).toBe(TODAY());
  });

  test("an on folder's debt still starts it", () => {
    lived("s-on", on);
    const a = hooksAt("auto");
    prompt(a);
    expect(nights()).toHaveLength(1);
  });

  test("the session-start pointer does not name a session that touched an off folder", () => {
    lived("s-both", on);
    lived("s-both", turned);
    setFolder(turned, "off");
    const a = hooksAt("ask");
    const start = a.sessionStart({ sessionId: "here-1", scope: on, at: TODAY() } as HookInput);
    expect(start.ask ?? "").not.toContain("writeUp: s-both");
  });

  test("and an off folder's full debt holds no small one back in an on folder", () => {
    lived("s-full", turned);
    lived("s-small", on, { pieces: 2 });
    setFolder(turned, "off");
    const a = hooksAt("ask");
    const start = a.sessionStart({ sessionId: "here-1", scope: on, at: TODAY() } as HookInput);
    expect(start.ask ?? "").toContain("writeUp: s-small");
  });

  test("the on folder's own pointer is untouched", () => {
    lived("s-on", on);
    lived("s-off", turned);
    setFolder(turned, "off");
    const a = hooksAt("ask");
    const start = a.sessionStart({ sessionId: "here-1", scope: on, at: TODAY() } as HookInput);
    expect(start.ask ?? "").toContain("writeUp: s-on");
  });
});

test("runCatchUp with only a not-on folder returns null: no row, as nothing was owed", async () => {
  lived("s-off", turned);
  setFolder(turned, "off");
  const seen: ChildPlan[] = [];
  const out = await runCatchUp({
    open: () => openNightCounterpart(config()),
    config: config(),
    configPath: cfg,
    run: "cup_null",
    scope: dir,
    now: () => Date.now(),
    seat: claudeCodeSeat({ config: config(), open: () => openNightCounterpart(config()), startCatchUp: drivingChild(seen) }),
  });
  expect(out).toBeNull();
  expect(seen.length).toBe(0);
});

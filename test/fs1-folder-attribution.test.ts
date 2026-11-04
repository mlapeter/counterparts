/**
 * FOLDER ATTRIBUTION (FS1, 2026-11-04; the developer week's three ambers):
 *
 *   1. a dream files what it writes under its sources' folder, not the folder of
 *      the session that launched the night (one they share, else none);
 *   2. another folder's dated work isn't "Due today" in this folder's Coming up:
 *      it's counted in other folders, while a personal dated item is due everywhere;
 *   3. Elsewhere names a folder by its name, and by its path only when two have
 *      the same name.
 *
 * Through the doors: the real session-start hook (`bin/hook.ts`, a child process)
 * in two folders under separate roots, each set on by itself (the harness's
 * `--roots each`); and the night's dream child at its MCP door, launched from one
 * folder, merging and folding rows of others.
 *
 * Hermetic (CLAUDE.md): a fresh temp data dir per test, removed afterwards. Every
 * word is invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_CODE_BUDGET_BYTES } from "../src/adapters/config.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { setScope, writeScopes } from "../src/adapters/scopes.js";
import type { ScopeMode } from "../src/adapters/scopes.js";
import { Counterpart } from "../src/core/counterpart.js";
import { WAKE_SHAPE_KEY } from "../src/core/counterpart-wake-shape.js";

const BUDGET = CLAUDE_CODE_BUDGET_BYTES;
const HOUR = 3_600_000;
const WRITER = "aaaa1111-0000-4000-8000-000000000001";
const READER = "cccc3333-0000-4000-8000-000000000003";
const NIGHT = "b8b8b8b8-0000-4000-8000-0000000000aa";

let root: string;
let storeDir: string;
let conf: string;
let EVALS: string;
let SIM: string;
let PAPER: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(existsSync("/tmp") ? "/tmp" : tmpdir(), "cp-fs1-")));
  storeDir = join(root, "store");
  conf = join(root, "conf");
  // Separate roots, as a person's repos are: nothing registers a parent of both.
  EVALS = join(root, "work", "evals");
  SIM = join(root, "code", "sim");
  PAPER = join(root, "writing", "paper");
  for (const d of [EVALS, SIM, PAPER, conf]) mkdirSync(d, { recursive: true });
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

const NOW = Date.now();

function brain(now = NOW): { c: Counterpart; today: string } {
  const c = Counterpart.open({ dir: storeDir, now: () => now, timeZone: "UTC", budgetBytes: BUDGET });
  open.push(c);
  c.store.setMeta(WAKE_SHAPE_KEY, "on");
  return { c, today: c.store.today() };
}

function memory(c: Counterpart, scope: string, body: string, more: { title?: string; about?: string; eventDate?: string } = {}): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    ...(more.title === undefined ? {} : { title: more.title }),
    ...(more.eventDate === undefined ? {} : { eventDate: more.eventDate }),
    about: (more.about ?? "work") as "work",
    salience: { relevance: 0.7, emotional: 0.3, predictive: 0.5 },
    origin: { session: WRITER, scope },
  });
}

/** Each folder on by itself (`--roots each`); no root above them is registered. */
function scopes(modes: Readonly<Record<string, ScopeMode>>): void {
  let reg = null;
  for (const [dir, mode] of Object.entries(modes)) reg = setScope(reg, dir, mode, { at: "2026-09-22" });
  if (reg !== null) writeScopes(join(conf, "scopes.json"), reg);
}

/** The real SessionStart hook, a child process, in `cwd`: the wake block. */
function hook(cwd: string, session = READER): string {
  const config = join(conf, "claude-code.json");
  writeFileSync(config, JSON.stringify({ dataDir: storeDir, injectionBudgetBytes: BUDGET, timeZone: "UTC" }));
  const r = spawnSync(process.execPath, ["run", new URL("../src/adapters/claude-code/bin/hook.ts", import.meta.url).pathname], {
    encoding: "utf8",
    input: JSON.stringify({ session_id: session, hook_event_name: "SessionStart", source: "startup", cwd }),
    env: { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_DATA_DIR: storeDir, COUNTERPARTS_CONFIG: config, HOME: join(root, "home") },
  });
  expect(r.status).toBe(0);
  const full = r.stdout.startsWith("{") ? String((JSON.parse(r.stdout) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? "") : r.stdout;
  const at = full.indexOf("<!-- counterparts:wake ");
  return at < 0 ? full : full.slice(at);
}

function section(wake: string, head: string): string {
  return wake.split("\n\n").find((p) => p.startsWith(head)) ?? "";
}

describe("Coming up: another folder's dated work stays in its folder (FS1 item 2)", () => {
  test("sim's work due today is counted in evals, not listed as due; it is due in sim; a personal dated item is due in both", async () => {
    const { c, today } = brain();
    c.revisePage("## Core\n\nI keep the lab notebook.", { reason: "first", by: "owner" });
    memory(c, SIM, "The moving-walls env: API sketched, coding planned for today.", { title: "sim moving-walls env coding", eventDate: today });
    memory(c, EVALS, "Rerun the probe sweep on the twelve checkpoints.", { title: "evals probe sweep rerun", eventDate: today });
    memory(c, SIM, "Theo's sister lands at the airport this evening.", { title: "Pick up Ana at the airport", eventDate: today, about: "owner" });
    c.close();
    scopes({ [EVALS]: "on", [SIM]: "on" });

    const inEvals = section(hook(EVALS), "Coming up:");
    expect(inEvals).toContain("- Due today · evals probe sweep rerun");
    expect(inEvals).toContain("- Due today · Pick up Ana at the airport");
    expect(inEvals).not.toContain("sim moving-walls env coding");
    expect(inEvals).toContain("1 in other folders");

    const inSim = section(hook(SIM, "dddd4444-0000-4000-8000-000000000004"), "Coming up:");
    expect(inSim).toContain("- Due today · sim moving-walls env coding");
    expect(inSim).toContain("- Due today · Pick up Ana at the airport");
    expect(inSim).not.toContain("evals probe sweep rerun");

    // The door the count names lists it, by folder name.
    const again = brain();
    const s = new McpServer({ counterpart: again.c, scope: EVALS, registryDir: storeDir, session: READER, scopesFile: join(conf, "scopes.json") });
    const door = (await s.call("recall", { handle: "coming up" })).structuredContent;
    const other = door["otherFolders"] as { folder: string; title: string }[];
    expect(other.map((o) => o.title)).toEqual(["sim moving-walls env coding"]);
    expect(other[0]?.folder).toBe("sim");
  });
});

describe("Elsewhere names a folder by its name (FS1 item 3)", () => {
  test("another root's folder is 'sim', not its path", () => {
    const { c } = brain();
    memory(c, SIM, "Vectorized the env step with a fixed-shape mask.", { title: "sim step vectorized" });
    memory(c, PAPER, "The ablation table still waits on its stds.", { title: "ablation table stds pending" });
    c.close();
    scopes({ [EVALS]: "on", [SIM]: "on", [PAPER]: "on" });
    const wake = hook(EVALS);
    const block = section(wake, "Elsewhere:");
    expect(block).toContain("- sim: sim step vectorized");
    expect(block).toContain("- paper: ablation table stds pending");
    expect(wake).not.toContain(SIM);
    expect(wake).not.toContain(PAPER);
    expect(wake).not.toContain(root);
  });

  test("two folders with the same name each say their path", () => {
    const OTHER_SIM = join(root, "old", "sim");
    mkdirSync(OTHER_SIM, { recursive: true });
    const { c } = brain();
    memory(c, SIM, "Vectorized the env step with a fixed-shape mask.", { title: "sim step vectorized" });
    memory(c, OTHER_SIM, "The old simulator's seeds are archived.", { title: "old sim seeds archived" });
    memory(c, PAPER, "The ablation table still waits on its stds.", { title: "ablation table stds pending" });
    c.close();
    scopes({ [EVALS]: "on", [SIM]: "on", [OTHER_SIM]: "on", [PAPER]: "on" });
    const block = section(hook(EVALS), "Elsewhere:");
    expect(block).toContain(`- ${SIM}: sim step vectorized`);
    expect(block).toContain(`- ${OTHER_SIM}: old sim seeds archived`);
    expect(block).toContain("- paper: ablation table stds pending");
  });
});

describe("a dream files what it writes under its sources' folder (FS1 item 1)", () => {
  const D1 = "2026-10-23";
  const D2 = "2026-10-24";
  const at = (ymd: string, h: number): number => Date.parse(`${ymd}T00:00:00Z`) + h * HOUR;

  function nightBrain(): { c: Counterpart; set(t: number): void } {
    let clock = at(D1, 10);
    const c = Counterpart.open({ dir: storeDir, snapshotsDir: join(root, "snaps"), budgetBytes: 9_000, now: () => clock, timeZone: "UTC" });
    open.push(c);
    c.store.advanceClock(D1);
    return { c, set: (t) => void (clock = t) };
  }

  function worked(c: Counterpart, scope: string, body: string): string {
    const day = c.store.livedDay();
    return c.store.put({ type: "memory", kind: "fact", body, about: "work", salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, origin: { session: WRITER, scope } });
  }

  test("launched from evals: sim's merge is sim's, a fold across sim and paper has no folder, evals' own fold is evals'", async () => {
    const { c, set } = nightBrain();
    const sim1 = worked(c, SIM, "Ablation-7 against baseline: five seeds, 0.41 against 0.38.");
    const sim2 = worked(c, `${SIM}/`, "Ablation-7 against baseline, five seeds: 0.41 to 0.38.");
    const sim3 = worked(c, SIM, "Theo launched a ten-seed rerun of ablation-7.");
    const paper1 = worked(c, PAPER, "Ablation-7 against baseline in the paper: ten seeds, 0.42 against 0.37, stds pending.");
    const ev1 = worked(c, EVALS, "The probe sweep over twelve checkpoints: probe accuracy 0.61 rising.");
    const ev2 = worked(c, EVALS, "No fixed seed is recorded for the evals sweeps.");
    scopes({ [EVALS]: "on", [SIM]: "on", [PAPER]: "on" });
    set(at(D2, 3));
    // The night's dream child, launched from a session in evals.
    const s = new McpServer({
      counterpart: c,
      session: NIGHT,
      scope: EVALS,
      registryDir: join(root, "registry"),
      now: () => at(D2, 3),
      scopesFile: join(conf, "scopes.json"),
      env: { COUNTERPARTS_NIGHT_CHILD: "dream", COUNTERPARTS_NIGHT_RUN: "1" },
    });
    const began = (await s.call("dream", { phase: "begin", session: NIGHT })).structuredContent;
    const dream = String(began["dream"]);
    expect(dream).toStartWith("drm_");
    const out = (
      await s.call("dream", {
        phase: "propose",
        session: NIGHT,
        dream,
        changes: [
          { action: "merge", ids: [sim1, sim2], text: "Ablation-7 against baseline: five seeds, 0.41 against 0.38.", why: "the same result twice" },
          { action: "gist", fold: true, sources: [sim3, paper1], text: "Ablation-7 against baseline, where it stands: a ten-seed rerun in sim, the paper's table waiting on stds.", why: "one thread" },
          { action: "gist", fold: true, sources: [ev1, ev2], text: "The evals probe sweep: accuracy rising, its seed unrecorded.", why: "one sweep" },
        ],
      })
    ).structuredContent;
    expect(out["refused"] ?? []).toEqual([]);
    const made = c.store.dreamChanges(dream).filter((x) => x.action === "merge" || x.action === "gist").map((x) => String(x.ref));
    expect(made.length).toBe(3);
    const scopeOf = (id: string | undefined): string | null => c.store.row(String(id))?.origin_scope ?? null;
    expect(scopeOf(made[0])).toBe(SIM);
    expect(scopeOf(made[1])).toBeNull();
    expect(scopeOf(made[2])).toBe(EVALS);
    // Its session is still the launching one: the night wrote it.
    expect(c.store.row(String(made[0]))?.origin_session).toBe(NIGHT);
  });
});

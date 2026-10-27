/**
 * A FAILED NIGHT CHILD SAYS WHY (2026-10-27, R4).
 *
 * Night run nrn_8f332b7d176d failed with every child exiting 1 in a few
 * seconds, and its row said only "claude exited with an error (exit 1)": the
 * children keep no transcript, and nothing the host said was kept. Now the
 * failing child's own line — its `stream-json` error result, else its last
 * STDERR line — lands on the row's `detail`, on its child's line, on the
 * event, in the words, and in doctor; scrubbed of anything token- or
 * key-shaped. A line that reads as a lost sign-in (the 10-27 cause: an
 * account switched mid-run) ends the run `could-not-start` / `signed-out`, so
 * the next session's existing fallback line says so and asks.
 *
 * Through the real night runner and the real starter, with a stand-in
 * `claude` (a shell script) as the command; one case through `bin/nightly.ts`
 * with the stand-in first on PATH. The result line is the one 2.1.311 wrote
 * with no sign-in (measured 10-27). Hermetic: a fresh temp store per test.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { childErrorText, oneLine, scrubSecrets, signedOutShaped } from "../src/adapters/claude-code/child-error.js";
import { startChild } from "../src/adapters/claude-code/child.js";
import type { ChildPlan } from "../src/adapters/claude-code/child.js";
import { nightRunFindings } from "../src/adapters/claude-code/doctor.js";
import type { DoctorInput } from "../src/adapters/claude-code/doctor.js";
import { catchUpOf, catchUpWords } from "../src/adapters/claude-code/night-catch-up.js";
import { openNightCounterpart, runNight } from "../src/adapters/claude-code/night-run.js";
import type { AdapterConfig } from "../src/adapters/config.js";
import { recordSession } from "../src/adapters/sessions.js";
import { SCOPE_ENV, SESSION_ENV } from "../src/adapters/spawn.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { Counterpart, NIGHT_WRITE_UP_EVENT } from "../src/core/counterpart.js";
import type { CounterpartEvent } from "../src/core/counterpart.js";
import { NIGHT_RUN_EVENT, nightRunWords } from "../src/core/dream/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { TUNABLES as SCHEMAS_TUNABLES } from "../src/core/schemas/index.js";

let root: string;
let dir: string;
let bin: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-night-error-"));
  dir = join(root, "store");
  bin = join(root, "bin");
  mkdirSync(dir);
  mkdirSync(bin);
  (SCHEMAS_TUNABLES as { TAGS_NIGHT: boolean }).TAGS_NIGHT = false;
});

afterEach(() => {
  (SCHEMAS_TUNABLES as { TAGS_NIGHT: boolean }).TAGS_NIGHT = true;
  for (const c of closers.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

const config = (over: Partial<AdapterConfig> = {}): AdapterConfig => ({ dataDir: dir, identity: { name: "Mike" }, injectionBudgetBytes: 20_000, ...over });

/** What `claude -p --output-format stream-json --verbose` wrote on 2.1.311 with no sign-in (trimmed). */
const NOT_LOGGED_IN = [
  JSON.stringify({ type: "system", subtype: "init", session_id: "9cd7b3c1-1763-4a0d-b8a2-4bcdbde57e83", tools: [], mcp_servers: [] }),
  JSON.stringify({ type: "assistant", message: { model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "Not logged in · Please run /login" }], usage: { input_tokens: 0, output_tokens: 0 } } }),
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: true,
    api_error_status: null,
    terminal_reason: "api_error",
    result: "Not logged in · Please run /login",
    num_turns: 1,
    duration_ms: 60,
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }),
];

const KEY = "sk-ant-api03-Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0LzXcVbNm";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIzNDU2";

/** A stand-in `claude`: reads its prompt, records how often it ran, then runs `body`. */
function stub(body: string[], name = "claude"): string {
  const path = join(bin, name);
  writeFileSync(path, ["#!/bin/sh", "cat > /dev/null", `echo run >> ${JSON.stringify(join(bin, "runs"))}`, ...body].join("\n"), "utf8");
  chmodSync(path, 0o755);
  return path;
}

/** Print each line on STDOUT, shell-quoted. */
const printLines = (lines: readonly string[]): string[] => lines.map((l) => `printf '%s\\n' '${l.replace(/'/g, "'\\''")}'`);

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day }, ...over });
}

/** Lived days behind the store and four new memories: the dream is due. Returns the store's today. */
function lived(): string {
  const c = openNightCounterpart(config());
  try {
    c.store.advanceClock("2026-09-10");
    for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    mem(c, "The migration step must run before the container boots, or it boots empty.");
    mem(c, "Run the migration before starting the container, otherwise the container starts empty.");
    mem(c, "Mike likes to talk decisions through out loud before he commits to one.", { kind: "person" });
    mem(c, "I say what I do not know before I guess.", { kind: "self" });
    return c.store.today();
  } finally {
    c.close();
  }
}

function nightOf(command: string, events: CounterpartEvent[], over: Partial<Parameters<typeof runNight>[0]> = {}): Parameters<typeof runNight>[0] {
  const cfg = over.config ?? config();
  return {
    open: () => openNightCounterpart(cfg, (e) => events.push(e)),
    config: cfg,
    run: "nrn_r4",
    session: "s1",
    scope: root,
    kind: { kind: "night" },
    baseEnv: { PATH: "/usr/bin:/bin" },
    command,
    onEvent: (e) => events.push(e),
    ...over,
  };
}

function opened(): Counterpart {
  const c = openNightCounterpart(config());
  closers.push(c);
  return c;
}

/** The newest night-run event row's payload. */
function nightEvent(c: Counterpart): Record<string, unknown> {
  const row = c.store.eventLog({ name: NIGHT_RUN_EVENT, order: "desc", limit: 1 })[0];
  return JSON.parse(row?.payload ?? "{}") as Record<string, unknown>;
}

function runs(): number {
  try {
    return readFileSync(join(bin, "runs"), "utf8").trim().split("\n").length;
  } catch {
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════

describe("the line itself: read from what the child said, one line, bounded, scrubbed", () => {
  test("an error result wins; a successful last result says nothing; else the last STDERR line; nothing for exit 0 or a watchdog", () => {
    expect(childErrorText({ code: 1, timedOut: false, output: NOT_LOGGED_IN.join("\n") })).toBe("api_error: Not logged in · Please run /login");
    const ok = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Here is what I remembered about Mike's day." });
    // A successful result's text is prose, never read: its STDERR is.
    expect(childErrorText({ code: 1, timedOut: false, output: ok, stderr: "boom\n" })).toBe("boom");
    expect(childErrorText({ code: 1, timedOut: false, output: ok })).toBeNull();
    expect(childErrorText({ code: 1, timedOut: false, stderr: "a warning\nerror: unknown option '--tools'\n\n" })).toBe("error: unknown option '--tools'");
    expect(childErrorText({ code: 0, timedOut: false, stderr: "error: x" })).toBeNull();
    expect(childErrorText({ code: null, timedOut: true, stderr: "error: x" })).toBeNull();
    expect(childErrorText({ code: 1, timedOut: false })).toBeNull();
    const status = JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, api_error_status: 529, result: "Overloaded" });
    expect(childErrorText({ code: 1, timedOut: false, output: status })).toBe("error_during_execution 529: Overloaded");
  });

  test("scrubbed by shape, not by name: keys, tokens, labelled values and long digit-bearing runs; words and short numbers stay", () => {
    const line = scrubSecrets(`API Error: 401 invalid x-api-key ${KEY} Authorization: Bearer ${JWT} token=abcd1234wxyz password: hunter22 request req_011CUabcdefGHIJ123456789`);
    expect(line).not.toContain(KEY);
    expect(line).not.toContain(JWT);
    expect(line).not.toContain("abcd1234wxyz");
    expect(line).not.toContain("hunter22");
    expect(line).not.toContain("req_011CUabcdefGHIJ123456789");
    expect(line).toContain("API Error: 401 invalid x-api-key");
    expect(scrubSecrets("Not logged in · Please run /login")).toBe("Not logged in · Please run /login");
    expect(scrubSecrets("Invalid API key provided")).toBe("Invalid API key provided");
    const long = oneLine(`first\nsecond\t\u001b[31mred\u001b[0m ${"word ".repeat(200)}`);
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long).not.toContain("\n");
    expect(long.startsWith("first second red word")).toBe(true);
  });

  test("a lost sign-in, loosely", () => {
    for (const s of ["api_error: Not logged in · Please run /login", "API Error: 401 Unauthorized", "authentication_error: invalid x-api-key", "Invalid API key · Please run /login", "OAuth token has expired", "error: token revoked"]) expect(signedOutShaped(s)).toBe(true);
    for (const s of ["error: unknown option '--tools'", "Overloaded", "exit 1", "error_max_turns", null]) expect(signedOutShaped(s)).toBe(false);
  });

  test("the real starter keeps the tail of STDERR, every child", async () => {
    const plan: ChildPlan = { command: stub(["echo one >&2", "echo 'two: the last' >&2", "exit 3"]), args: [], stdin: "x", env: { PATH: "/usr/bin:/bin" }, timeoutMs: 10_000 };
    const r = await startChild(plan);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("two: the last");
    expect(childErrorText(r)).toBe("two: the last");
  });
});

describe("through the real night runner, a stand-in claude", () => {
  test("a child that prints a stream-json error result (signed out) and exits 1: `signed-out`, said on the row, each child, the event, the words, doctor and the next session's line", async () => {
    const today = lived();
    const events: CounterpartEvent[] = [];
    const out = await runNight(nightOf(stub([...printLines(NOT_LOGGED_IN), "exit 1"]), events, { date: today }));
    expect(out).toMatchObject({ state: "could-not-start", reason: "signed-out", code: 1, detail: "api_error: Not logged in · Please run /login" });
    // Each child that ran says it; the reflection was not started after a quick exit.
    const dream = out.children?.find((ch) => ch.child === "dream");
    expect(dream?.detail).toBe("api_error: Not logged in · Please run /login");
    expect(out.children?.find((ch) => ch.child === "reflection")?.skipped).toBe("quick-exit");
    expect(nightRunWords(out)).toBe("Claude Code was signed out: api_error: Not logged in · Please run /login");
    const c = opened();
    expect(c.dreams.nightRun()).toMatchObject({ reason: "signed-out", detail: "api_error: Not logged in · Please run /login" });
    expect(c.dreams.nightRun()?.children?.find((ch) => ch.child === "dream")?.detail).toBe("api_error: Not logged in · Please run /login");
    const ev = nightEvent(c);
    expect(ev).toMatchObject({ state: "could-not-start", reason: "signed-out", detail: "api_error: Not logged in · Please run /login" });
    expect((ev["childDetails"] as Record<string, string>)["dream"]).toBe("api_error: Not logged in · Please run /login");
    const f = nightRunFindings({ today, config: config() } as unknown as DoctorInput, c.store)[0];
    expect(f?.detail).toContain("could not start");
    expect(f?.detail).toContain("Claude Code was signed out: api_error: Not logged in");
    expect(f?.fix).toContain("signed in");
    // THE NEXT SESSION'S LINE, the existing fallback: says it, and asks.
    expect(c.dreams.setSetting("auto", { by: "owner" }).ok).toBe(true);
    const offer = c.dreams.offer({ at: today, session: "s2" });
    expect(offer?.headless).toBe(false);
    expect(offer?.notice).toContain("I couldn't start dreaming on my own: Claude Code was signed out");
    expect(offer?.notice).toContain('Say "dream" to do it here.');
  });

  test("a child that only writes STDERR and exits 1: its last line, through the plain retry, on a `quick-exit` row", async () => {
    const events: CounterpartEvent[] = [];
    const out = await runNight(nightOf(stub(["echo 'warming up' >&2", "echo \"error: unknown option '--no-session-persistence'\" >&2", "exit 1"]), events, { date: lived() }));
    // Nothing on STDOUT and a quick exit: the child was retried plain once, and that one said the same.
    expect(runs()).toBe(2);
    expect(out).toMatchObject({ state: "could-not-start", reason: "quick-exit", code: 1, detail: "error: unknown option '--no-session-persistence'" });
    expect(nightRunWords(out)).toContain("claude stopped straight away (exit 1): error: unknown option '--no-session-persistence' — is it logged in?");
    expect(nightEvent(opened())["detail"]).toBe("error: unknown option '--no-session-persistence'");
  });

  test("a child that prints a secret-shaped string: scrubbed before the row, the event and the process log", async () => {
    const events: CounterpartEvent[] = [];
    const said = JSON.stringify({ type: "result", subtype: "success", is_error: true, api_error_status: 401, result: `API Error: 401 {"error":{"type":"authentication_error","message":"invalid x-api-key ${KEY}"}} Authorization: Bearer ${JWT}` });
    const out = await runNight(nightOf(stub([...printLines([said]), `echo 'auth header Bearer ${JWT} key=${KEY}' >&2`, "exit 1"]), events, { date: lived() }));
    expect(out.reason).toBe("signed-out");
    expect(out.detail).toContain("error 401: API Error: 401");
    expect(out.detail).toContain("[redacted]");
    const c = opened();
    expect(c.store.getMeta("dream.night") ?? "").toContain("[redacted]");
    expect(events.some((e) => JSON.stringify(e).includes("[redacted]"))).toBe(true);
    const everywhere = [JSON.stringify(out), c.store.getMeta("dream.night") ?? "", ...c.store.eventLog({ limit: 200 }).map((r) => r.payload ?? ""), JSON.stringify(events)].join("\n");
    expect(everywhere).toContain("[redacted]");
    expect(everywhere).not.toContain(KEY);
    expect(everywhere).not.toContain(JWT);
    expect(everywhere).not.toContain("Zx9Qw8Er7Ty6");
  });

  test("end to end through bin/nightly.ts, the stand-in first on PATH: the row says signed out", () => {
    lived();
    stub([...printLines(NOT_LOGGED_IN), "exit 1"]);
    const configPath = join(root, "claude-code.json");
    writeFileSync(configPath, JSON.stringify({ dataDir: dir, owner: true, identity: { name: "Mike" } }), "utf8");
    const nightly = join(import.meta.dir, "..", "src", "adapters", "claude-code", "bin", "nightly.ts");
    const proc = Bun.spawnSync([process.execPath, "run", nightly], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: root,
        COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
        COUNTERPARTS_CONFIG: configPath,
        COUNTERPARTS_DATA_DIR: dir,
        COUNTERPARTS_SESSION: "s1",
        COUNTERPARTS_SCOPE: root,
        COUNTERPARTS_NIGHT_RUN: "nrn_r4e2e",
        COUNTERPARTS_NIGHT_KIND: "night",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    expect(opened().dreams.nightRun()).toMatchObject({ run: "nrn_r4e2e", state: "could-not-start", reason: "signed-out", detail: "api_error: Not logged in · Please run /login" });
  }, 30_000);
});

describe("the write-up runner, failing mid-batch", () => {
  const HOUR = 3_600_000;

  /** A session that talked yesterday in `scope` and ended: owed a write-up. */
  function owed(id: string, scope: string): void {
    const d = new Date();
    let at = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - 14 * HOUR;
    const c = Counterpart.open({ dir, now: () => at });
    try {
      recordSession(dir, { sessionId: id, scope, phase: "start", at });
      const turns: { role: "user" | "assistant"; text: string }[] = [];
      for (let i = 0; i < 6; i++) {
        at += 8 * 60_000;
        turns.push({ role: "user", text: `${id} #${String(i)}: the relief valve on loop ${String(i)} is seated before the pump runs, or the loop loses pressure.` });
        turns.push({ role: "assistant", text: `(${id} #${String(i)}) Understood — seat the valve on loop ${String(i)} first.` });
        c.captureSpans({ session: id, scope, turns: [...turns] });
      }
      c.boundary({ session: id, scope, kind: "stop" });
      c.boundary({ session: id, scope, kind: "session-end" });
      recordSession(dir, { sessionId: id, scope, phase: "end", at: at + 1 });
    } finally {
      c.close();
    }
  }

  test("it writes one part through the door, then its real child exits 1 saying why on STDERR: the write-up row, its words, and the night's row carry the line", async () => {
    const proj = join(root, "proj");
    mkdirSync(proj);
    owed("old-1", proj);
    const failing = stub(["echo 'request failed: ECONNRESET token=abcd1234wxyz5678' >&2", "exit 1"], "claude-writeup");
    const events: CounterpartEvent[] = [];
    const out = await runNight(
      nightOf(failing, events, {
        kind: { kind: "night", dreamSkipped: "too-little-new" },
        // The batch's child: one part fetched and answered through the real door, as its tool would; then the real stand-in, which fails.
        startCatchUp: async (plan) => {
          const runner = plan.env[SESSION_ENV] as string;
          const s = openServer({ dir, session: runner, scope: plan.env[SCOPE_ENV] as string });
          try {
            const f = (await s.call("session_end", { session: runner, writeUp: "old-1" })).structuredContent;
            if (f["reason"] === "part") {
              await s.call("session_end", { session: runner, writeUp: "old-1", part: f["part"] as number, memories: [{ content: "Written up from old-1: the relief valve is seated before the pump runs.", kind: "fact" }] });
            }
          } finally {
            s.counterpart.close();
          }
          return await startChild(plan);
        },
      }),
    );
    const said = "request failed: ECONNRESET token=[redacted]";
    expect(out).toMatchObject({ state: "failed", reason: "exit", code: 1, detail: `catch-up: ${said}` });
    expect(nightRunWords(out)).toBe(`claude exited with an error (exit 1): catch-up: ${said}`);
    const c = opened();
    const row = catchUpOf(c.store, "nrn_r4");
    expect(row).toMatchObject({ state: "failed", code: 1, detail: said, batches: 1 });
    expect(catchUpWords(row as NonNullable<typeof row>)).toContain(`before it failed (${said})`);
    const payload = JSON.parse(c.store.eventLog({ name: NIGHT_WRITE_UP_EVENT, order: "desc", limit: 1 })[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["detail"]).toBe(said);
    expect(JSON.stringify(events)).not.toContain("abcd1234wxyz5678");
    expect(JSON.stringify(payload)).not.toContain("abcd1234wxyz5678");
  });
});

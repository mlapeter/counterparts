/**
 * THE DAY'S LINES REACH SOMEONE WHO CAN SEE THEM (2026-10-01, lane 8 — the
 * 09-30 plan's build 4).
 *
 * Found that morning: the day's first prompt came from an SDK-launched session
 * (`entrypoint: sdk-cli`) with no terminal. It started the nightly run, which
 * was fine, and claimed the once-a-day dream line, which nobody saw. Only an
 * interactive session claims the day's told lines now; a headless one may
 * still start the run, and its line waits for the next session someone is
 * watching, which says it once, in its first reply.
 *
 * Hermetic: every test makes its own temp directory and removes it. Every
 * memory is invented for the test.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeCodeAdapter, isInteractive } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import type { AdapterConfig } from "../src/adapters/claude-code/index.js";
import { attendedOf, deliverTurn, toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import { NIGHT_UNTOLD_KEY } from "../src/core/dream/index.js";

let dir: string;
const open: { close(): void }[] = [];
const AT = "2026-09-29";
let spawned = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-wake-told-"));
  spawned = 0;
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

/** An adapter whose spawner counts instead of starting anything. */
function hooks(): ClaudeCodeAdapter {
  const config: AdapterConfig = { dataDir: dir, injectionBudgetBytes: 20_000, owner: true, identity: { name: "Dana" } };
  const counterpart = Counterpart.open({ dir, owner: true, identity: { name: "Dana" } });
  open.push(counterpart);
  return new ClaudeCodeAdapter({
    counterpart,
    config,
    command: "/usr/bin/bun",
    args: ["run", "/pkg/bin/runner.ts"],
    nightArgs: ["run", "/pkg/bin/nightly.ts"],
    spawner: () => {
      spawned += 1;
      return { pid: 4242 };
    },
  });
}

function input(session: string, entrypoint: string | undefined): HookInput {
  const hook: HookInput = {
    sessionId: session,
    scope: "proj",
    turns: [],
    at: AT,
    prompt: "good morning",
    ...(entrypoint === undefined ? {} : { entrypoint }),
  };
  recordSession(dir, { sessionId: session, scope: "proj", phase: "start", ...(entrypoint === undefined ? {} : { entrypoint }) });
  return hook;
}

/** Lived days behind the store, and enough new memory that the day's line is due. */
function lived(a: ClaudeCodeAdapter): void {
  const c = a.counterpart;
  c.store.advanceClock("2026-09-10");
  for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
  const day = c.store.livedDay();
  for (const body of [
    "The kiln needs an hour to cool before the shelves come out.",
    "Glaze runs if the coat is thicker than a fingernail.",
    "Dana likes to see a test tile before committing a whole batch.",
    "I say what I do not know before I guess.",
  ]) {
    c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
  }
}

function doors(a: ClaudeCodeAdapter): Parameters<typeof deliverTurn>[4] {
  return { updateNotice: () => null, markUpdateNotice: () => false, claimDream: a.claimDream.bind(a), claimHeld: a.claimHeld.bind(a) };
}

describe("who is watching (`isInteractive`)", () => {
  test("the terminal and Desktop's Code tab are; claude -p and the SDKs are not; an unknown or absent value is", () => {
    expect(isInteractive({ entrypoint: "cli" })).toBe(true);
    expect(isInteractive({ entrypoint: "claude-desktop" })).toBe(true);
    expect(isInteractive({})).toBe(true);
    expect(isInteractive({ entrypoint: "something-new" })).toBe(true);
    for (const e of ["sdk-cli", "sdk-ts", "sdk-py", "mcp", "claude-code-github-action"]) expect(isInteractive({ entrypoint: e })).toBe(false);
  });

  test("the host's CLAUDE_CODE_SESSION_ATTENDED decides when it is there; the entrypoint list is the fallback", () => {
    expect(isInteractive({ entrypoint: "sdk-cli", attended: true })).toBe(true);
    expect(isInteractive({ entrypoint: "cli", attended: false })).toBe(false);
    expect(attendedOf("1")).toEqual({ attended: true });
    expect(attendedOf("0")).toEqual({ attended: false });
    expect(attendedOf(undefined)).toEqual({});
    expect(attendedOf("maybe")).toEqual({});
    const payload = { session_id: "s1", cwd: "/tmp", hook_event_name: "UserPromptSubmit", prompt: "hi" };
    expect(toHookInput(payload, { scope: "/tmp", env: { CLAUDE_CODE_SESSION_ATTENDED: "0", CLAUDE_CODE_ENTRYPOINT: "cli" } }).attended).toBe(false);
  });
});

describe("auto: a headless session starts the run; its line waits for a watched one", () => {
  test("the SDK prompt starts ONE run and is told nothing; the next terminal prompt says it once, and claims it", () => {
    const a = hooks();
    lived(a);
    expect(a.counterpart.dreams.setSetting("auto", { by: "owner" }).ok).toBe(true);

    const sdk = a.userPromptSubmit(input("s-sdk", "sdk-cli"));
    expect(spawned).toBe(1);
    expect(a.counterpart.dreams.nightRun()).toMatchObject({ state: "started", session: "s-sdk", date: AT });
    expect(a.counterpart.store.dreamAsk(AT)?.state).toBe("launched");
    expect(sdk.dream).toBeUndefined();
    expect(sdk.injection).not.toContain("nightly run");

    const cli = a.userPromptSubmit(input("s-cli", "cli"));
    expect(spawned).toBe(1);
    const told = cli.dream;
    if (told === undefined) throw new Error("no held line");
    expect(told.held).toBe(a.counterpart.dreams.nightRun()?.run);
    expect(told.notice).toBe('Counterparts: dreaming in the background (a few minutes). Say "no dreams" to turn it off.');
    expect(cli.injection).toContain("this once, in your first reply, as one plain sentence of your own");
    expect(cli.injection).toContain("session: s-cli");
    const out = deliverTurn("user-prompt-submit", cli, {}, null, doors(a), input("s-cli", "cli"));
    expect((JSON.parse(out.stdout) as { systemMessage: string }).systemMessage).toBe(told.notice);
    expect(a.counterpart.store.getMeta(NIGHT_UNTOLD_KEY)).toBe("");

    // Told once: the next watched session hears nothing more of it.
    const later = a.userPromptSubmit(input("s-cli-2", "cli"));
    expect(later.dream).toBeUndefined();
  });

  test("a watched session that loses the claim race strips the model's line too", () => {
    const a = hooks();
    lived(a);
    a.counterpart.dreams.setSetting("auto", { by: "owner" });
    a.userPromptSubmit(input("s-sdk", "sdk-cli"));
    const one = a.userPromptSubmit(input("s-cli", "cli"));
    const two = a.userPromptSubmit(input("s-cli-2", "cli"));
    deliverTurn("user-prompt-submit", one, {}, null, doors(a), input("s-cli", "cli"));
    const lost = deliverTurn("user-prompt-submit", two, {}, null, doors(a), input("s-cli-2", "cli"));
    expect(lost.stdout).not.toContain("systemMessage");
    expect(lost.stdout).not.toContain("from a session nobody was watching");
  });

  test("a run that ended before anyone watched hands back what it did instead: the held line is not said", () => {
    const a = hooks();
    lived(a);
    a.counterpart.dreams.setSetting("auto", { by: "owner" });
    a.userPromptSubmit(input("s-sdk", "sdk-cli"));
    const night = a.counterpart.dreams.nightRun();
    if (night === null) throw new Error("no run");
    a.counterpart.dreams.recordNightRun({ ...night, state: "failed", endedAt: Date.now(), reason: "exit" });
    expect(a.counterpart.dreams.heldTold(AT, "s-cli")).toBeNull();
  });
});

describe("ask: a headless session leaves the day's ask unclaimed", () => {
  test("nothing is claimed or said to the SDK session; the terminal session is asked, once, and says it in its first reply", () => {
    const a = hooks();
    lived(a);
    const sdk = a.userPromptSubmit(input("s-sdk", "sdk-cli"));
    expect(sdk.dream).toBeUndefined();
    expect(a.counterpart.store.dreamAsk(AT)).toBeUndefined();
    expect(spawned).toBe(0);
    const cli = a.userPromptSubmit(input("s-cli", "cli"));
    const told = cli.dream;
    if (told === undefined) throw new Error("no ask");
    expect(told.offer).not.toBeNull();
    expect(cli.injection).toContain("Tell Dana this once, in your first reply, as one plain sentence of your own.");
    deliverTurn("user-prompt-submit", cli, {}, null, doors(a), input("s-cli", "cli"));
    expect(a.counterpart.store.dreamAsk(AT)?.state).toBe("offered");
  });
});

describe("the update notice waits for a watched session too", () => {
  test("an SDK session is never told", () => {
    const a = hooks();
    expect(a.updateNotice(input("s-sdk", "sdk-cli"))).toBeNull();
  });
});

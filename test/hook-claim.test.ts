/**
 * ONE DELIVERY PER EVENT, HOWEVER MANY WIRINGS FIRE IT (2026-10-09,
 * `adapters/claude-code/claim.ts`).
 *
 * Seen live: the npm install's hooks and an older plugin's both ran every
 * event, and every session got two wakes and two recall blocks per prompt,
 * two boundaries per Stop and two background workers. The claim is the
 * backstop: the first hook process to claim an event does its whole job and
 * the other exits with no output.
 *
 * Hermetic: every case mints its own temp directory, store and configuration,
 * and every hook process runs with a curated environment (temp HOME, an empty
 * PATH, no keys) and `--config` naming this test's own file.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  CLAIMS_ROW,
  CLAIM_KEEP,
  CLAIM_WAIT_MS,
  CLAIM_WINDOW_MS,
  SET_ASIDE_LOCK,
  claimDelivery,
  claimsPath,
  deliveryClaimKey,
  finishClaim,
  firesOnce,
} from "../src/adapters/claude-code/claim.js";
import type { ClaimDoors } from "../src/adapters/claude-code/claim.js";
import { claimFindings, doctorFindings } from "../src/adapters/claude-code/doctor.js";
import { BOUNDARY_EVENT, Counterpart, HOOK_CLAIM_LOST_EVENT } from "../src/core/counterpart.js";
import { openDb } from "../src/core/store/db.js";
import { pruneSessions } from "../src/adapters/sessions.js";

const HOOK_SCRIPT = resolve(import.meta.dir, "../src/adapters/claude-code/bin/hook.ts");

let work: string;
let store: string;
let configPath: string;
let home: string;
let emptyBin: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "counterparts-claim-"));
  home = join(work, "home");
  emptyBin = join(work, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(emptyBin, { recursive: true });
  store = join(work, "store");
  configPath = join(work, "claude-code.json");
  writeFileSync(configPath, JSON.stringify({ dataDir: store, injectionBudgetBytes: 9000 }), "utf8");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

// ── the key ─────────────────────────────────────────────────────────────────

describe("deliveryClaimKey", () => {
  const prompt = { session_id: "s1", hook_event_name: "UserPromptSubmit", prompt: "hello", prompt_id: "p1", cwd: "/x" };

  test("the twins of one event share a key; nothing else does", () => {
    expect(deliveryClaimKey("user-prompt-submit", prompt)).toBe(deliveryClaimKey("user-prompt-submit", { ...prompt }));
    // Fields that are not identity (the directory, the transcript) do not move it.
    expect(deliveryClaimKey("user-prompt-submit", { ...prompt, cwd: "/y", transcript_path: "/t" })).toBe(
      deliveryClaimKey("user-prompt-submit", prompt),
    );
    const others = [
      deliveryClaimKey("user-prompt-submit", { ...prompt, prompt_id: "p2" }),
      deliveryClaimKey("user-prompt-submit", { ...prompt, prompt: "hello again" }),
      deliveryClaimKey("user-prompt-submit", { ...prompt, session_id: "s2" }),
      deliveryClaimKey("stop", prompt),
      deliveryClaimKey("stop", { ...prompt, stop_hook_active: true }),
      deliveryClaimKey("stop", { ...prompt, last_assistant_message: "done" }),
      deliveryClaimKey("session-start", { ...prompt, source: "compact" }),
      deliveryClaimKey("session-end", { ...prompt, reason: "clear" }),
      deliveryClaimKey("pre-compact", { ...prompt, trigger: "manual" }),
    ];
    const all = [deliveryClaimKey("user-prompt-submit", prompt), ...others];
    expect(new Set(all).size).toBe(all.length);
  });

  test("no session id, no key — and the key carries no word of the prompt", () => {
    expect(deliveryClaimKey("user-prompt-submit", { prompt: "hello" })).toBeNull();
    expect(deliveryClaimKey("user-prompt-submit", { session_id: "", prompt: "hello" })).toBeNull();
    const key = deliveryClaimKey("user-prompt-submit", { session_id: "s1", prompt: "my secret plan" }) ?? "";
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });
});

// ── the claim, against a real store ─────────────────────────────────────────

describe("claimDelivery", () => {
  function claimRow(cp: Counterpart): Record<string, unknown> {
    const db = openDb(claimsPath(cp.store.dir));
    try {
      return JSON.parse(db.get<{ value: string }>("SELECT value FROM claims WHERE key = ?", CLAIMS_ROW)?.value ?? "{}") as Record<string, unknown>;
    } finally {
      db.close();
    }
  }

  test("the first claim wins; a twin (started before the holder finished) loses and is recorded", () => {
    const cp = Counterpart.open({ dir: store });
    try {
      const t0 = 1_800_000_000_000;
      const base = { hook: "user-prompt-submit" as const, sessionId: "s1", observer: false };
      // Both processes started at t0; the settings hook claims first.
      const first = claimDelivery(cp, { ...base, key: "k1", side: "settings", started: t0, now: t0 + 90 });
      expect(first).toEqual({ outcome: "won", at: t0 + 90 });
      // Its twin, while the holder still runs.
      expect(claimDelivery(cp, { ...base, key: "k1", side: "plugin", started: t0 + 2, now: t0 + 140 })).toEqual({ outcome: "lost", heldBy: "settings" });
      const rows = cp.store.eventLog({ name: HOOK_CLAIM_LOST_EVENT });
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]?.payload ?? "{}")).toEqual({ hook: "user-prompt-submit", session: "s1", lost: "plugin", won: "settings" });
      // Prunable telemetry: no latch, so retention sweeps it.
      expect(rows[0]?.dedup_key).toBeNull();
      // The holder finishes; a twin that STARTED before that still loses, however late it claims.
      expect(finishClaim(cp, "k1", t0 + 90, t0 + 300)).toBe(true);
      expect(claimDelivery(cp, { ...base, key: "k1", side: "plugin", started: t0 + 40, now: t0 + 5_000 }).outcome).toBe("lost");
      // A different event is its own.
      expect(claimDelivery(cp, { ...base, key: "k2", side: "plugin", started: t0, now: t0 + 100 }).outcome).toBe("won");
    } finally {
      cp.close();
    }
  });

  test("the same key from a process that started after the holder finished is a separate event, and delivers", () => {
    const cp = Counterpart.open({ dir: store });
    try {
      const t0 = 1_800_000_000_000;
      const base = { hook: "user-prompt-submit" as const, sessionId: "s1", side: "settings" as const, observer: false };
      // A host with no prompt_id, the same words twice, a second apart.
      const first = claimDelivery(cp, { ...base, key: "same", started: t0, now: t0 + 80 });
      expect(finishClaim(cp, "same", first.at ?? 0, t0 + 200)).toBe(true);
      const again = claimDelivery(cp, { ...base, key: "same", started: t0 + 1_000, now: t0 + 1_080 });
      expect(again.outcome).toBe("won");
      expect(cp.store.eventLog({ name: HOOK_CLAIM_LOST_EVENT })).toHaveLength(0);
      // Only a process's own claim is stamped: the first's `at` no longer names it.
      expect(finishClaim(cp, "same", first.at ?? 0, t0 + 1_300)).toBe(false);
      expect(finishClaim(cp, "nobody", t0, t0 + 1_300)).toBe(false);
    } finally {
      cp.close();
    }
  });

  test("an event the host sends ONCE: a twin whose runtime came up after the holder finished still loses (the 0.3.15 check's 45 ms)", () => {
    const cp = Counterpart.open({ dir: store });
    try {
      const t0 = 1_800_000_000_000;
      const base = { hook: "session-start" as const, sessionId: "s1", observer: false };
      // Measured 2026-10-10 under load: the twin's runtime started 45 ms after the winner finished.
      for (const key of ["by-start-time", "sent-once"]) {
        const first = claimDelivery(cp, { ...base, key, side: "settings", started: t0, now: t0 + 90, once: key === "sent-once" });
        expect(finishClaim(cp, key, first.at ?? 0, t0 + 200)).toBe(true);
      }
      // By start time alone it reads as a new event, and delivers a second wake…
      expect(claimDelivery(cp, { ...base, key: "by-start-time", side: "plugin", started: t0 + 245, now: t0 + 260 }).outcome).toBe("won");
      // …unless the host sends it once: then any same-key process in the window is the twin.
      expect(claimDelivery(cp, { ...base, key: "sent-once", side: "plugin", started: t0 + 245, now: t0 + 260, once: true })).toEqual({
        outcome: "lost",
        heldBy: "settings",
      });
      // The window still bounds it.
      expect(
        claimDelivery(cp, { ...base, key: "sent-once", side: "plugin", started: t0 + CLAIM_WINDOW_MS + 300, now: t0 + CLAIM_WINDOW_MS + 300, once: true }).outcome,
      ).toBe("won");
    } finally {
      cp.close();
    }
  });

  test("which events the host sends once: a start that opens a session id, and a prompt with its id", () => {
    for (const source of ["startup", "clear", "fork"]) expect(firesOnce("session-start", { source })).toBe(true);
    for (const source of ["resume", "compact", ""]) expect(firesOnce("session-start", { source })).toBe(false);
    expect(firesOnce("user-prompt-submit", { prompt: "x", prompt_id: "p-1" })).toBe(true);
    expect(firesOnce("user-prompt-submit", { prompt: "x" })).toBe(false);
    for (const name of ["stop", "session-end", "pre-compact"] as const) expect(firesOnce(name, { prompt_id: "p-1", source: "startup" })).toBe(false);
  });

  test("a holder that never finished holds for the window and no longer; the row keeps only the window", () => {
    const cp = Counterpart.open({ dir: store });
    try {
      const t0 = 1_800_000_000_000;
      const base = { hook: "stop" as const, sessionId: "s1", side: "settings" as const, observer: false };
      claimDelivery(cp, { ...base, key: "k1", started: t0, now: t0 + 50 });
      claimDelivery(cp, { ...base, key: "k2", started: t0, now: t0 + 60 });
      expect(claimDelivery(cp, { ...base, key: "k1", started: t0 + 9_000, now: t0 + 9_050 }).outcome).toBe("lost");
      expect(claimDelivery(cp, { ...base, key: "k1", started: t0 + CLAIM_WINDOW_MS + 100, now: t0 + CLAIM_WINDOW_MS + 150 }).outcome).toBe("won");
      // k2 aged out on that write; k1 is the new claim.
      expect(Object.keys(claimRow(cp))).toEqual(["k1"]);
    } finally {
      cp.close();
    }
  });

  test("the row is bounded, newest kept", () => {
    const cp = Counterpart.open({ dir: store });
    try {
      const at = 1_800_000_000_000;
      for (let i = 0; i < CLAIM_KEEP + 30; i += 1) {
        claimDelivery(cp, { hook: "stop", key: `k${String(i)}`, sessionId: "s", side: "settings", observer: false, now: at + i });
      }
      const keys = Object.keys(claimRow(cp));
      expect(keys).toHaveLength(CLAIM_KEEP);
      expect(keys).toContain(`k${String(CLAIM_KEEP + 29)}`);
      expect(keys).not.toContain("k0");
    } finally {
      cp.close();
    }
  });

  test("fail-open: no session, an observer, or a claims file that cannot be made all deliver", () => {
    // A store "directory" that is a plain file: no sessions/ can be made under it.
    const notADir = join(work, "not-a-dir");
    writeFileSync(notADir, "", "utf8");
    const refusing: ClaimDoors = {
      store: { dir: notADir },
      noteAdapterEvent: () => {
        throw new Error("not reached");
      },
    };
    const base = { hook: "session-start" as const, sessionId: "s1", side: "settings" as const };
    expect(claimDelivery(refusing, { ...base, key: null, observer: false })).toEqual({ outcome: "unclaimed", detail: "no session id" });
    expect(claimDelivery(refusing, { ...base, key: "k", observer: true })).toEqual({ outcome: "unclaimed", detail: "observer" });
    const failed = claimDelivery(refusing, { ...base, key: "k", observer: false });
    expect(failed.outcome).toBe("unclaimed");
    expect(failed.detail ?? "").toMatch(/ENOTDIR|EEXIST|not a directory/i);
    // A fault, not contention: the hook says this one on stderr.
    expect(failed.busy).toBeUndefined();
    expect(finishClaim(refusing, "k", 1)).toBe(false);
  });

  test("the claims live in their own file in a directory under sessions/, and the store's meta is not touched", () => {
    const cp = Counterpart.open({ dir: store });
    try {
      expect(claimDelivery(cp, { hook: "stop", key: "k1", sessionId: "s", side: "settings", observer: false }).outcome).toBe("won");
      expect(claimsPath(store)).toBe(join(store, "sessions", "claims", "hook-claims.sqlite"));
      expect(Object.keys(claimRow(cp))).toEqual(["k1"]);
      expect(cp.store.getMeta(CLAIMS_ROW)).toBeUndefined();
    } finally {
      cp.close();
    }
  });
});

// ── two real hook processes, one event ──────────────────────────────────────

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function hookEnv(): Record<string, string> {
  return { PATH: emptyBin, HOME: home, USERPROFILE: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
}

/** One real hook process, started now; resolves when it exits. */
function startHook(input: Record<string, unknown>): Promise<Ran> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ["run", HOOK_SCRIPT, "--config", configPath], { env: hookEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

function payload(event: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { hook_event_name: event, session_id: "claim-session-1", cwd: work, transcript_path: join(work, "t.jsonl"), ...extra };
}

const CLAIMED = "stood down by claim";

function events(name: string): number {
  const cp = Counterpart.open({ dir: store });
  try {
    return cp.store.eventLog({ name, limit: 1000 }).length;
  } finally {
    cp.close();
  }
}

describe("two wirings fire one event", () => {
  test(
    "SessionStart, a prompt and a Stop each run once: one wake, one recall, one boundary, and the twin says nothing",
    async () => {
      // The store exists first, as it does on any machine with two wirings.
      Counterpart.open({ dir: store }).close();
      for (const [event, extra] of [
        ["SessionStart", { source: "startup" }],
        ["UserPromptSubmit", { prompt: "what did we decide about the store?", prompt_id: "p-1" }],
        ["Stop", { stop_hook_active: false, prompt_id: "p-1", last_assistant_message: "We kept it." }],
      ] as const) {
        const input = payload(event, extra);
        const [a, b] = await Promise.all([startHook(input), startHook(input)]);
        expect([a.code, b.code]).toEqual([0, 0]);
        const lost = [a, b].filter((r) => r.stderr.includes(CLAIMED));
        expect(lost).toHaveLength(1);
        expect(lost[0]?.stdout).toBe("");
        const won = [a, b].find((r) => !r.stderr.includes(CLAIMED));
        if (event === "SessionStart") expect((won?.stdout ?? "").length).toBeGreaterThan(0);
      }
      expect(events(HOOK_CLAIM_LOST_EVENT)).toBe(3);
      expect(events(BOUNDARY_EVENT)).toBe(1);
    },
    120_000,
  );

  test(
    "one wiring is untouched: every event delivers, nothing is claimed away, nothing is recorded",
    async () => {
      Counterpart.open({ dir: store }).close();
      const runs: Ran[] = [];
      runs.push(await startHook(payload("SessionStart", { source: "startup" })));
      // The same words twice, as two prompts: the host gives each its own id.
      runs.push(await startHook(payload("UserPromptSubmit", { prompt: "again", prompt_id: "p-1" })));
      runs.push(await startHook(payload("Stop", { prompt_id: "p-1", last_assistant_message: "ok" })));
      runs.push(await startHook(payload("UserPromptSubmit", { prompt: "again", prompt_id: "p-2" })));
      runs.push(await startHook(payload("Stop", { prompt_id: "p-2", last_assistant_message: "ok" })));
      // And a host that sends no prompt_id: byte-identical events, one after the
      // other, are separate events (each started after the last finished).
      runs.push(await startHook(payload("UserPromptSubmit", { prompt: "again" })));
      runs.push(await startHook(payload("Stop", {})));
      runs.push(await startHook(payload("UserPromptSubmit", { prompt: "again" })));
      runs.push(await startHook(payload("Stop", {})));
      for (const r of runs) {
        expect(r.code).toBe(0);
        expect(r.stderr).not.toContain(CLAIMED);
        expect(r.stderr).not.toContain("delivered unclaimed");
      }
      expect((runs[0]?.stdout ?? "").length).toBeGreaterThan(0);
      expect(events(HOOK_CLAIM_LOST_EVENT)).toBe(0);
    },
    120_000,
  );
});

// ── a twin that came up late (the 0.3.15 release check) ─────────────────────

describe("a twin whose runtime came up after the first hook finished", () => {
  test(
    "a session's first start, and an identified prompt, still run once: the late twin stands down",
    async () => {
      Counterpart.open({ dir: store }).close();
      // One after the other: the second process starts after the first has
      // finished, which is what a loaded machine did to a real twin.
      for (const [event, extra] of [
        ["SessionStart", { source: "startup" }],
        ["UserPromptSubmit", { prompt: "what did we decide?", prompt_id: "p-late" }],
      ] as const) {
        const first = await startHook(payload(event, extra));
        const late = await startHook(payload(event, extra));
        expect([first.code, late.code]).toEqual([0, 0]);
        expect(first.stderr).not.toContain(CLAIMED);
        if (event === "SessionStart") expect(first.stdout.length).toBeGreaterThan(0);
        expect(late.stderr).toContain(CLAIMED);
        expect(late.stdout).toBe("");
      }
      expect(events(HOOK_CLAIM_LOST_EVENT)).toBe(2);
    },
    120_000,
  );
});

// ── never a false twin (review of #355) ────────────────────────────────────
//
// The worst thing the claim can do is silence a real event because it looked
// like a twin. Each case below is a REAL event a host sends, run through the
// real hook entry; none of them may lose a claim.

describe("separate events are never taken for twins", () => {
  test(
    "fired AT ONCE: two sessions with the same prompt, one prompt sent twice under two ids, /clear, resume and startup, and a Stop with its re-fire",
    async () => {
      Counterpart.open({ dir: store }).close();
      const at = (session: string, event: string, extra: Record<string, unknown>): Record<string, unknown> => ({
        ...payload(event, extra),
        session_id: session,
      });
      const inputs: Record<string, unknown>[] = [
        // The key is per session: the same words, even the same prompt_id, in two sessions.
        at("sess-a", "UserPromptSubmit", { prompt: "what did we decide?", prompt_id: "p-same" }),
        at("sess-b", "UserPromptSubmit", { prompt: "what did we decide?", prompt_id: "p-same" }),
        // The same words typed twice in one session: the host gives each its own id.
        at("sess-c", "UserPromptSubmit", { prompt: "again", prompt_id: "p-c1" }),
        at("sess-c", "UserPromptSubmit", { prompt: "again", prompt_id: "p-c2" }),
        // One session id, three ways in.
        at("sess-d", "SessionStart", { source: "startup" }),
        at("sess-d", "SessionStart", { source: "clear" }),
        at("sess-d", "SessionStart", { source: "resume" }),
        // A Stop and the host's re-fire after a block: same prompt, same last words.
        at("sess-e", "Stop", { prompt_id: "p-e", stop_hook_active: false, last_assistant_message: "Done." }),
        at("sess-e", "Stop", { prompt_id: "p-e", stop_hook_active: true, last_assistant_message: "Done." }),
      ];
      const runs = await Promise.all(inputs.map((i) => startHook(i)));
      runs.forEach((r, i) => {
        expect({ i, code: r.code, claimed: r.stderr.includes(CLAIMED) }).toEqual({ i, code: 0, claimed: false });
        if (inputs[i]?.["hook_event_name"] === "SessionStart") expect(r.stdout.length).toBeGreaterThan(0);
      });
      expect(events(HOOK_CLAIM_LOST_EVENT)).toBe(0);
    },
    120_000,
  );

  test(
    "ONE AFTER ANOTHER with the same key: two auto-compactions under one prompt, a session resumed twice, two Stops with the same last words and no prompt_id",
    async () => {
      Counterpart.open({ dir: store }).close();
      const sequence: Record<string, unknown>[] = [
        payload("PreCompact", { trigger: "auto", prompt_id: "p-long", custom_instructions: null }),
        payload("PreCompact", { trigger: "auto", prompt_id: "p-long", custom_instructions: null }),
        payload("SessionStart", { source: "resume" }),
        payload("SessionStart", { source: "resume" }),
        payload("Stop", { stop_hook_active: false, last_assistant_message: "Done." }),
        payload("Stop", { stop_hook_active: false, last_assistant_message: "Done." }),
      ];
      for (const input of sequence) {
        const r = await startHook(input);
        const event = input["hook_event_name"];
        expect({ event, code: r.code, claimed: r.stderr.includes(CLAIMED) }).toEqual({ event, code: 0, claimed: false });
        if (event === "SessionStart") expect(r.stdout.length).toBeGreaterThan(0);
      }
      expect(events(HOOK_CLAIM_LOST_EVENT)).toBe(0);
    },
    120_000,
  );
});

// ── the race itself (review of #355) ────────────────────────────────────────

describe("two processes claim in the same millisecond", () => {
  test(
    "50 rounds, two real processes released at the same instant each round: exactly one wins every time",
    async () => {
      Counterpart.open({ dir: store }).close();
      const claimModule = resolve(import.meta.dir, "../src/adapters/claude-code/claim.ts");
      const coreModule = resolve(import.meta.dir, "../src/core/counterpart.ts");
      const racer = join(work, "racer.ts");
      // Each racer opens its own connection, then at every round's instant both
      // claim the round's key. Half the rounds the winner stamps its finish at
      // once (a fast holder), half it never does (a holder still running).
      // Each round's "process" started a millisecond before it claims, as a
      // real hook's does (by tens of milliseconds): a holder that finished in
      // the very millisecond its twin started is not a case a host produces.
      writeFileSync(
        racer,
        [
          `import { claimDelivery, finishClaim } from ${JSON.stringify(claimModule)};`,
          `import { Counterpart } from ${JSON.stringify(coreModule)};`,
          `const [dir, side, t0, rounds, gap] = [process.argv[2], process.argv[3], Number(process.argv[4]), Number(process.argv[5]), Number(process.argv[6])];`,
          `const cp = Counterpart.open({ dir });`,
          `const out = [];`,
          `for (let i = 0; i < rounds; i += 1) {`,
          `  const at = t0 + i * gap;`,
          `  while (Date.now() < at) {}`,
          `  const key = "race-" + i;`,
          `  const late = Date.now() - at;`,
          `  const c = claimDelivery(cp, { hook: "user-prompt-submit", key, sessionId: "race", side, observer: false, started: at - 1 });`,
          `  if (c.outcome === "won" && i % 2 === 0) finishClaim(cp, key, c.at);`,
          `  out.push([i, c.outcome, late]);`,
          `}`,
          `cp.close();`,
          `process.stdout.write(JSON.stringify(out));`,
        ].join("\n"),
        "utf8",
      );
      const rounds = 50;
      const gap = 40;
      const t0 = Date.now() + 1_500;
      const run = (side: string): Promise<Ran> =>
        new Promise((done, fail) => {
          const child = spawn(process.execPath, ["run", racer, store, side, String(t0), String(rounds), String(gap)], {
            env: hookEnv(),
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
          child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
          child.on("error", fail);
          child.on("close", (code) => done({ code: code ?? -1, stdout, stderr }));
        });
      const [a, b] = await Promise.all([run("settings"), run("plugin")]);
      expect([a.code, b.code, a.stderr, b.stderr]).toEqual([0, 0, "", ""]);
      const ra = JSON.parse(a.stdout) as [number, string, number][];
      const rb = JSON.parse(b.stdout) as [number, string, number][];
      expect(ra).toHaveLength(rounds);
      expect(rb).toHaveLength(rounds);
      for (let i = 0; i < rounds; i += 1) {
        expect({ i, outcomes: [ra[i]?.[1], rb[i]?.[1]].sort() }).toEqual({ i, outcomes: ["lost", "won"] });
      }
      // And they really did meet: in most rounds both had ENTERED the claim
      // within a few milliseconds of the instant (loose, so a loaded machine
      // does not flake it), so neither was still starting while the other
      // claimed alone. Entered, not finished: a finish waits on the disk (an
      // fsync per commit, nearly free on macOS and not on Linux, where a CI
      // runner finished both within 5 ms in only 23 of 50 rounds, 2026-10-09).
      const close = ra.filter((x, i) => x[2] <= 5 && (rb[i]?.[2] ?? 99) <= 5).length;
      expect(close).toBeGreaterThan(rounds / 2);
      expect(events(HOOK_CLAIM_LOST_EVENT)).toBe(rounds);
    },
    60_000,
  );
});

// ── a store somebody holds (review of #355) ─────────────────────────────────

describe("a locked store", () => {
  const base = { hook: "user-prompt-submit" as const, key: "k", sessionId: "s", side: "settings" as const, observer: false };

  test("a store somebody holds does not hold the claim: it is made at once, beside the held lock", () => {
    // What CI hit on master a78e1dae: the worker the previous Stop started held
    // the store's write lock for longer than the claim would wait.
    const cp = Counterpart.open({ dir: store });
    const holder = Counterpart.open({ dir: store });
    try {
      let claim: ReturnType<typeof claimDelivery> | null = null;
      let finished = false;
      let took = -1;
      // A second connection holds the STORE's write lock for the whole claim.
      holder.store.updateMeta("review.lock.holder", () => {
        const t = Date.now();
        claim = claimDelivery(cp, base);
        if (claim.at !== undefined) finished = finishClaim(cp, "k", claim.at);
        took = Date.now() - t;
        return "held";
      });
      expect((claim as ReturnType<typeof claimDelivery> | null)?.outcome).toBe("won");
      expect(finished).toBe(true);
      expect(took).toBeLessThan(CLAIM_WAIT_MS);
    } finally {
      holder.close();
      cp.close();
    }
  });

  test("a claims file another claim holds: the claim gives up after CLAIM_WAIT_MS, delivers unclaimed, and says it was contention", () => {
    const cp = Counterpart.open({ dir: store });
    try {
      // Made once, so the holder below has a file to lock.
      expect(claimDelivery(cp, { ...base, key: "first" }).outcome).toBe("won");
      const holder = openDb(claimsPath(store));
      let claim: ReturnType<typeof claimDelivery> | null = null;
      let took = -1;
      try {
        holder.transaction(() => {
          holder.run("UPDATE claims SET value = value WHERE key = ?", CLAIMS_ROW);
          const t = Date.now();
          claim = claimDelivery(cp, base);
          took = Date.now() - t;
        });
      } finally {
        holder.close();
      }
      expect((claim as ReturnType<typeof claimDelivery> | null)?.outcome).toBe("unclaimed");
      expect((claim as ReturnType<typeof claimDelivery> | null)?.detail ?? "").toMatch(/locked|busy/i);
      expect((claim as ReturnType<typeof claimDelivery> | null)?.busy).toBe(true);
      expect(took).toBeGreaterThanOrEqual(CLAIM_WAIT_MS - 50);
      expect(took).toBeLessThan(CLAIM_WAIT_MS + 1_500);
      // And with the lock gone, the claim is made.
      expect(claimDelivery(cp, base).outcome).toBe("won");
    } finally {
      cp.close();
    }
  });
});

// ── a claims file that is not a database (review of #359) ───────────────────

describe("a claims file that is not a database", () => {
  const base = { hook: "session-start" as const, key: "k", sessionId: "s", side: "settings" as const, observer: false };
  const garbage = "this was never a sqlite file, and every hook used to say so on stderr\n".repeat(80);

  function corrupt(): void {
    mkdirSync(dirname(claimsPath(store)), { recursive: true });
    writeFileSync(claimsPath(store), garbage, "utf8");
    // A stale log beside it must go with it, never be replayed into the new file.
    writeFileSync(`${claimsPath(store)}-wal`, "stale log", "utf8");
  }

  test("is set aside (with its log) and made again, once; the claim is made on the new file and doctor reads the copy", () => {
    const cp = Counterpart.open({ dir: store });
    try {
      expect(claimFindings(cp.store)).toEqual([]);
      corrupt();
      const first = claimDelivery(cp, base);
      expect(first.outcome).toBe("won");
      const aside = first.setAside ?? "";
      expect(basename(aside)).toMatch(/^hook-claims\.unreadable-\d+\.sqlite$/);
      expect(readFileSync(aside, "utf8")).toBe(garbage);
      expect(readFileSync(`${aside}-wal`, "utf8")).toBe("stale log");
      // The live file is a database again, holding this claim; nothing else changed.
      expect(claimDelivery(cp, { ...base, side: "plugin", now: Date.now() })).toEqual({ outcome: "lost", heldBy: "settings" });
      expect(finishClaim(cp, "k", first.at ?? 0)).toBe(true);
      // Once: the next claim finds a healthy file.
      expect(claimDelivery(cp, { ...base, key: "k2" }).setAside).toBeUndefined();
      // A second bad file replaces the first copy: one is kept, never a pile.
      corrupt();
      const again = claimDelivery(cp, { ...base, key: "k3" });
      expect(again.outcome).toBe("won");
      const copy = basename(again.setAside ?? "");
      const copies = readdirSync(dirname(claimsPath(store))).filter((n) => n.startsWith("hook-claims.unreadable-"));
      expect(copies.every((n) => n.startsWith(copy))).toBe(true);
      expect(copies).toContain(copy);
      expect(copies).toContain(`${copy}-wal`);
      // The durable trace: doctor's amber line names the copy.
      // (The twin above also lost a claim, so "Installed twice" is there too.)
      const lines = claimFindings(cp.store).filter((f) => f.title === "Hook claims");
      expect(lines.map((f) => f.severity)).toEqual(["amber"]);
      expect(lines[0]?.detail).toContain(basename(again.setAside ?? ""));
      expect(lines[0]?.detail).toContain("every event was still delivered");
    } finally {
      cp.close();
    }
  });

  test("a copy older than the week says nothing", () => {
    const cp = Counterpart.open({ dir: store });
    try {
      mkdirSync(dirname(claimsPath(store)), { recursive: true });
      const old = Date.now() - 8 * 86_400_000;
      writeFileSync(join(dirname(claimsPath(store)), `hook-claims.unreadable-${String(old)}.sqlite`), garbage, "utf8");
      expect(claimFindings(cp.store)).toEqual([]);
    } finally {
      cp.close();
    }
  });

  test(
    "through the hook: said once on stderr, the event delivered; the next event is clean",
    async () => {
      Counterpart.open({ dir: store }).close();
      corrupt();
      const start = await startHook(payload("SessionStart", { source: "startup" }));
      expect(start.code).toBe(0);
      expect(start.stdout.length).toBeGreaterThan(0);
      expect(start.stderr).toContain("the claims file could not be read; set aside as");
      expect(start.stderr).not.toContain("delivered unclaimed");
      const next = await startHook(payload("UserPromptSubmit", { prompt: "and now?", prompt_id: "p-9" }));
      expect(next.code).toBe(0);
      expect(next.stderr).not.toContain("set aside");
      expect(next.stderr).not.toContain("delivered unclaimed");
    },
    60_000,
  );

  test(
    "a claims file that cannot be made: the event is delivered, and the log's end line keeps the reason as a code",
    async () => {
      Counterpart.open({ dir: store }).close();
      // `claims` is a FILE, so the directory cannot be made: a lasting fault.
      mkdirSync(join(store, "sessions"), { recursive: true });
      writeFileSync(dirname(claimsPath(store)), "", "utf8");
      const r = await startHook(payload("UserPromptSubmit", { prompt: "anything", prompt_id: "p-1" }));
      expect(r.code).toBe(0);
      expect(r.stderr).toContain("delivered unclaimed");
      const ends = readdirSync(join(store, "sessions", "log"))
        .flatMap((f) => readFileSync(join(store, "sessions", "log", f), "utf8").split("\n"))
        .filter((l) => l.includes('"process.end"'))
        .map((l) => JSON.parse(l) as { proc: string; data: Record<string, unknown> });
      const end = ends.find((e) => e.proc === "hook:user-prompt-submit");
      expect(end?.data["busy"]).toBe(false);
      expect(String(end?.data["unclaimed"])).toMatch(/^(EEXIST|ENOTDIR)$/);
    },
    60_000,
  );

  /**
   * Two hook processes (twins) that meet a bad claims file at the same moment,
   * `rounds` times, each round on a store of its own, `gap` ms apart. With
   * `staleLock`, each round's directory also holds the set-aside lock a dead
   * holder left an hour ago, so both twins race to take it over. Returns each
   * round's two outcomes and codes, and what is left beside the file.
   */
  async function twinsMeetBadFiles(
    rounds: number,
    gap: number,
    staleLock: boolean,
  ): Promise<{ readonly i: number; readonly outcomes: string[]; readonly codes: (string | null)[]; readonly left: string[] }[]> {
    const claimModule = resolve(import.meta.dir, "../src/adapters/claude-code/claim.ts");
    const racer = join(work, "bad-file-racer.ts");
    writeFileSync(
      racer,
      [
        `import { claimDelivery } from ${JSON.stringify(claimModule)};`,
        `const [root, side, t0, rounds, gap] = [process.argv[2], process.argv[3], Number(process.argv[4]), Number(process.argv[5]), Number(process.argv[6])];`,
        `const out = [];`,
        `for (let i = 0; i < rounds; i += 1) {`,
        `  const at = t0 + i * gap;`,
        `  while (Date.now() < at) {}`,
        `  const doors = { store: { dir: root + "/r" + i }, noteAdapterEvent: () => true };`,
        `  const c = claimDelivery(doors, { hook: "session-start", key: "k", sessionId: "s", side, observer: false, started: at - 1, once: true });`,
        `  out.push([i, c.outcome, c.code ?? null]);`,
        `}`,
        `process.stdout.write(JSON.stringify(out));`,
      ].join("\n"),
      "utf8",
    );
    const root = join(work, "rounds");
    const hourAgo = (Date.now() - 3_600_000) / 1000;
    for (let i = 0; i < rounds; i += 1) {
      const path = claimsPath(join(root, `r${String(i)}`));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, garbage, "utf8");
      writeFileSync(`${path}-wal`, "stale log", "utf8");
      if (staleLock) {
        const lock = join(dirname(path), SET_ASIDE_LOCK);
        mkdirSync(lock);
        utimesSync(lock, hourAgo, hourAgo);
      }
    }
    const t0 = Date.now() + 1_500;
    const run = (side: string): Promise<Ran> =>
      new Promise((done, fail) => {
        const child = spawn(process.execPath, ["run", racer, root, side, String(t0), String(rounds), String(gap)], {
          env: hookEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
        child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
        child.on("error", fail);
        child.on("close", (code) => done({ code: code ?? -1, stdout, stderr }));
      });
    const [a, b] = await Promise.all([run("settings"), run("plugin")]);
    expect([a.code, b.code, a.stderr, b.stderr]).toEqual([0, 0, "", ""]);
    const ra = JSON.parse(a.stdout) as [number, string, string | null][];
    const rb = JSON.parse(b.stdout) as [number, string, string | null][];
    return Array.from({ length: rounds }, (_, i) => ({
      i,
      outcomes: [ra[i]?.[1] ?? "none", rb[i]?.[1] ?? "none"].sort(),
      codes: [ra[i]?.[2] ?? null, rb[i]?.[2] ?? null],
      left: readdirSync(dirname(claimsPath(join(root, `r${String(i)}`)))).filter(
        (n) => (n.startsWith("hook-claims.unreadable-") && n.endsWith(".sqlite")) || n.startsWith(SET_ASIDE_LOCK),
      ),
    }));
  }

  test(
    "two twins meet one bad file (review of #366): exactly one delivers every round, and the copy is kept",
    async () => {
      // Before: both passed `stillUnreadable`, the one that lost the move threw
      // ENOENT (or, on macOS, SQLITE_IOERR_VNODE from a file moved while open)
      // and delivered unclaimed beside the winner — every round of 30 — and it
      // had removed "older" copies first, once the winner's own.
      for (const round of await twinsMeetBadFiles(20, 80, false)) {
        expect({ i: round.i, outcomes: round.outcomes, codes: round.codes, copies: round.left.length }).toEqual({
          i: round.i,
          outcomes: ["lost", "won"],
          codes: [null, null],
          copies: 1,
        });
      }
    },
    60_000,
  );

  test(
    "two twins meet one bad file AND a dead holder's set-aside lock (review of #366): one takes it over, one delivers, every round",
    async () => {
      // Before: both twins judged the lock stale and both took it over (the
      // second's rm removed the first's fresh lock), or one looked in the gap
      // between the other's rm and mkdir, found no lock and did not wait: 4 to
      // 16 rounds in 60 delivered twice on macOS. 300 rounds, so a race of 1
      // in 70 shows (it would pass unseen about 1 run in 75).
      const rounds = await twinsMeetBadFiles(300, 40, true);
      const wrong = rounds.filter(
        (r) =>
          r.outcomes.join() !== "lost,won" ||
          r.codes.some((c) => c !== null) ||
          r.left.length !== 1 ||
          !r.left[0]?.startsWith("hook-claims.unreadable-"),
      );
      expect(wrong).toEqual([]);
    },
    90_000,
  );

  test("the set-aside lock: a live one is waited on and the event still delivers; one a dead holder left is taken over", () => {
    const cp = Counterpart.open({ dir: store });
    try {
      corrupt();
      const lock = join(dirname(claimsPath(store)), SET_ASIDE_LOCK);
      mkdirSync(lock);
      // A twin is setting it aside (its lock is fresh) but never finishes: this
      // one waits its bound, finds the bad file still there, and delivers.
      const t0 = Date.now();
      const waited = claimDelivery(cp, base);
      expect(waited.outcome).toBe("unclaimed");
      expect(waited.setAside).toBeUndefined();
      expect(Date.now() - t0).toBeGreaterThanOrEqual(CLAIM_WAIT_MS - 50);
      expect(readFileSync(claimsPath(store), "utf8")).toBe(garbage);
      // The holder died: past 5 s its lock is taken over, once, and the file is mended.
      const old = (Date.now() - 6_000) / 1000;
      utimesSync(lock, old, old);
      const mended = claimDelivery(cp, { ...base, key: "k2" });
      expect(mended.outcome).toBe("won");
      expect(basename(mended.setAside ?? "")).toMatch(/^hook-claims\.unreadable-\d+\.sqlite$/);
      expect(existsSync(lock)).toBe(false);
    } finally {
      cp.close();
    }
  });

  test("the directory is 0700 and the file 0600, and SQLite's log and index take the file's mode", () => {
    const cp = Counterpart.open({ dir: store });
    // A reader holding the file open keeps the `-wal` and `-shm` after the claim's own connection closes.
    let held: ReturnType<typeof openDb> | null = null;
    try {
      expect(claimDelivery(cp, base).outcome).toBe("won");
      held = openDb(claimsPath(store), { wal: true });
      held.get("SELECT count(*) AS n FROM claims");
      expect(claimDelivery(cp, { ...base, key: "k2" }).outcome).toBe("won");
      const mode = (p: string): string => (statSync(p).mode & 0o777).toString(8);
      expect(mode(dirname(claimsPath(store)))).toBe("700");
      expect(mode(claimsPath(store))).toBe("600");
      expect(mode(`${claimsPath(store)}-wal`)).toBe("600");
      expect(mode(`${claimsPath(store)}-shm`)).toBe("600");
    } finally {
      held?.close();
      cp.close();
    }
  });
});

describe("the sessions prune leaves directories alone", () => {
  test("an old file goes; an old directory — claims/, log/, association/, any — stays with what is in it", () => {
    const sessions = join(store, "sessions");
    const old = (Date.now() - 30 * 86_400_000) / 1000;
    mkdirSync(join(sessions, "claims"), { recursive: true });
    mkdirSync(join(sessions, "association"), { recursive: true });
    mkdirSync(join(sessions, "empty-and-old"), { recursive: true });
    writeFileSync(join(sessions, "claims", "hook-claims.sqlite"), "", "utf8");
    writeFileSync(join(sessions, "stale-record.json"), "{}", "utf8");
    for (const p of ["claims", "association", "empty-and-old", "stale-record.json"]) utimesSync(join(sessions, p), old, old);
    expect(pruneSessions(store)).toBe(1);
    expect(readdirSync(sessions).sort()).toEqual(["association", "claims", "empty-and-old"]);
    expect(readdirSync(join(sessions, "claims"))).toEqual(["hook-claims.sqlite"]);
  });
});

// ── doctor ──────────────────────────────────────────────────────────────────

describe("doctor's Installed twice line", () => {
  test("silent with no claim lost; amber, naming both sides and both ways out, once one is", () => {
    const cp = Counterpart.open({ dir: store });
    try {
      expect(claimFindings(cp.store)).toEqual([]);
      const base = { sessionId: "s1", observer: false, started: Date.now() };
      claimDelivery(cp, { ...base, hook: "session-start", key: "a", side: "plugin" });
      claimDelivery(cp, { ...base, hook: "session-start", key: "a", side: "settings" });
      claimDelivery(cp, { ...base, hook: "user-prompt-submit", key: "b", side: "settings" });
      claimDelivery(cp, { ...base, hook: "user-prompt-submit", key: "b", side: "plugin" });
      const plugin = { id: "counterparts@counterparts", installPath: null, version: "0.3.13", enabled: true };
      const [f] = claimFindings(cp.store, plugin);
      expect(f?.severity).toBe("amber");
      expect(f?.title).toBe("Installed twice");
      expect(f?.detail).toContain("two Counterparts wirings are live (the Claude Code plugin's hooks and the hooks in your settings): 2 hook runs");
      expect(f?.detail).toContain("(session-start, user-prompt-submit)");
      // It counts the twins the claim stopped and says no more (the 0.3.15 check measured a late one).
      expect(f?.detail).toContain("the claim is a backstop");
      expect(f?.detail).not.toContain("nothing was delivered twice");
      expect(f?.fix).toContain("counterparts disconnect");
      expect(f?.fix).toContain("claude plugin uninstall counterparts@counterparts");
      // And the reading carries it.
      const all = doctorFindings({
        configPath,
        configReason: "loaded",
        config: { dataDir: store },
        dir: store,
        store: cp.store,
        today: cp.store.today(),
        refusals: {},
      });
      expect(all.filter((x) => x.key === "claim")).toHaveLength(1);
    } finally {
      cp.close();
    }
  });
});

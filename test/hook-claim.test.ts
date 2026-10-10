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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  CLAIMS_META_KEY,
  CLAIM_KEEP,
  CLAIM_WAIT_MS,
  CLAIM_WINDOW_MS,
  claimDelivery,
  deliveryClaimKey,
  finishClaim,
} from "../src/adapters/claude-code/claim.js";
import type { ClaimDoors } from "../src/adapters/claude-code/claim.js";
import { claimFindings, doctorFindings } from "../src/adapters/claude-code/doctor.js";
import { BOUNDARY_EVENT, Counterpart, HOOK_CLAIM_LOST_EVENT } from "../src/core/counterpart.js";

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
    return JSON.parse(cp.store.getMeta(CLAIMS_META_KEY) ?? "{}") as Record<string, unknown>;
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

  test("fail-open: no session, an observer, or a store that refuses the write all deliver", () => {
    const refusing: ClaimDoors = {
      store: {
        updateMeta: () => {
          throw new Error("SQLITE_BUSY: database is locked");
        },
      },
      noteAdapterEvent: () => {
        throw new Error("not reached");
      },
    };
    const base = { hook: "session-start" as const, sessionId: "s1", side: "settings" as const };
    expect(claimDelivery(refusing, { ...base, key: null, observer: false })).toEqual({ outcome: "unclaimed", detail: "no session id" });
    expect(claimDelivery(refusing, { ...base, key: "k", observer: true })).toEqual({ outcome: "unclaimed", detail: "observer" });
    expect(claimDelivery(refusing, { ...base, key: "k", observer: false })).toEqual({
      outcome: "unclaimed",
      detail: "SQLITE_BUSY: database is locked",
    });
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
          `  const c = claimDelivery(cp, { hook: "user-prompt-submit", key, sessionId: "race", side, observer: false, started: at - 1 });`,
          `  if (c.outcome === "won" && i % 2 === 0) finishClaim(cp, key, c.at);`,
          `  out.push([i, c.outcome, Date.now() - at]);`,
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
      // And they really did meet: in most rounds both claimed within a millisecond of the instant.
      const close = ra.filter((x, i) => x[2] <= 1 && (rb[i]?.[2] ?? 99) <= 1).length;
      expect(close).toBeGreaterThan(rounds / 2);
      expect(events(HOOK_CLAIM_LOST_EVENT)).toBe(rounds);
    },
    60_000,
  );
});

// ── a store somebody holds (review of #355) ─────────────────────────────────

describe("a locked store", () => {
  test("the claim gives up after CLAIM_WAIT_MS, not the store's five seconds, delivers unclaimed, and puts the wait back", () => {
    const cp = Counterpart.open({ dir: store });
    const holder = Counterpart.open({ dir: store });
    try {
      const base = { hook: "user-prompt-submit" as const, key: "k", sessionId: "s", side: "settings" as const, observer: false };
      let claim: ReturnType<typeof claimDelivery> | null = null;
      let took = -1;
      // A second connection holds the write lock for the whole claim.
      holder.store.updateMeta("review.lock.holder", () => {
        const t = Date.now();
        claim = claimDelivery(cp, base);
        took = Date.now() - t;
        return "held";
      });
      expect((claim as ReturnType<typeof claimDelivery> | null)?.outcome).toBe("unclaimed");
      expect((claim as ReturnType<typeof claimDelivery> | null)?.detail ?? "").toMatch(/locked|busy/i);
      expect(took).toBeGreaterThanOrEqual(CLAIM_WAIT_MS - 50);
      expect(took).toBeLessThan(CLAIM_WAIT_MS + 1_500);
      // The connection's own wait is back where it was.
      expect(Object.values(cp.store["ops"].get<Record<string, number>>("PRAGMA busy_timeout") ?? {})[0]).toBe(5_000);
      // And with the lock gone, the claim is made.
      expect(claimDelivery(cp, base).outcome).toBe("won");
    } finally {
      holder.close();
      cp.close();
    }
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

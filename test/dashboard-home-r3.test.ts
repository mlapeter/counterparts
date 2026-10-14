/**
 * The home tab, round 3 (2026-09-27 — a try, not a rule): the consolidation
 * panel's returns said by source and nominations said as suggestions (0), the
 * live feed folding repeats and sending sleep CHECKS to the flow feed (1), the
 * Emotion panel's Lately in the mood's words (2), merged repeats showing their
 * span (3) and the retrieval panel's used-rate (6). "Written vs came back"
 * (4) and the Tonight box (5) left Home in round 4 (2026-09-28), and their
 * views and tests with them.
 *
 * Every "who is close to the core" answer is checked against physics'
 * `promotionEligibility` directly, so the dashboard can never be re-deriving
 * it. Hermetic: stores seeded into temp dirs, removed after.
 */
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../src/core/counterpart.js";
import { promotionEligibility } from "../src/core/physics/index.js";
import { V8_UPGRADE_KEY, aboutMe, ownerNames } from "../src/core/sleep/index.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { isSleepCheck, laneOf } from "../src/adapters/dashboard/web/lanes.js";
import { NOMINATION_CAVEAT, narrate } from "../src/adapters/dashboard/web/narrate.js";
import { router } from "../src/adapters/dashboard/web/server.js";
import { mergeRepeats, recallUse } from "../src/adapters/dashboard/web/views/mechanism-panel.js";
import { lightOf, mechanismsView, returnWords } from "../src/adapters/dashboard/web/views/mechanisms.js";
import { seedDemo } from "../tools/demo/seed.js";

const WEB = fileURLToPath(new URL("../src/adapters/dashboard/web/", import.meta.url));
const HOST = "127.0.0.1:4747";
const DATE = "2026-07-13";

let dir: string;
let upgradedDir: string;
let nominated = 0;
let replays = 0;
let legacyDay = 0;
let demotedId = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-home-r3-"));
  upgradedDir = mkdtempSync(join(tmpdir(), "counterparts-home-r3-upg-"));
  await seedDemo({ dir });

  // A new lived day: awake returns, memories written, a dream that replays and
  // nominates, one mood-matched turn, then one real sleep and three checks.
  const c = Counterpart.open({ dir, owner: true });
  try {
    c.store.advanceClock(DATE);
    const day = c.store.livedDay();
    legacyDay = day;
    let n = 0;
    for (const id of c.store.list({ archived: false })) {
      const row = c.store.row(id);
      if (row === undefined || row.type !== "memory" || n >= 4) continue;
      if (day - c.store.physicsOf(id).lastUsedDay >= 4 && c.store.reinforce(id, day).ret?.counted === true) n += 1;
    }
    for (const body of ["The harbour office keeps the tide tables.", "The kiln settles for twenty minutes first."]) {
      c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.2, predictive: 0.5 }, physics: { birthDay: day, lastUsedDay: day } });
    }
    const begun = c.dreams.begin({ session: "s-dream", scope: null });
    if (!begun.ok) throw new Error(`begin refused: ${begun.reason}`);
    const shown = Object.keys(begun.bundle.memories);
    const changes: Record<string, unknown>[] = shown.slice(0, 6).map((id) => ({ action: "replayed", id }));
    for (const id of shown) {
      const row = c.store.row(id);
      if (row?.kind === "self" && row.promoted_identity === 0) changes.push({ action: "nominate-core", id, why: "It is how I work." });
    }
    const out = c.dreams.propose({ dream: begun.bundle.dream, session: "s-dream", changes: changes as never });
    if (!out.ok) throw new Error("propose refused");
    nominated = out.results.filter((r) => r.ok && r.action === "nominate-core").length;
    replays = out.results.filter((r) => r.ok && r.action === "replayed").length;
    c.dreams.journal({ dream: begun.bundle.dream, session: "s-dream", title: "Harbour", text: "I dreamed of tide tables." });
    c.store.appendEvent({
      name: "recall.decision",
      day,
      ref: "s-mood",
      payload: { session: "s-mood", turn: 3, day, surfacedCount: 1, footnoteCount: 2, moodMatched: 2, surfaced: [], footnotes: [] },
    });
  } finally {
    c.close();
  }
  for (let i = 0; i < 4; i++) {
    const k = Counterpart.open({ dir, owner: true });
    try {
      await k.sessionEnd({ date: DATE, at: DATE });
    } finally {
      k.close();
    }
  }
  // A memory the owner took OUT of the core, which was one return away: it
  // must read as neither ready nor one return away anywhere here.
  const k = Counterpart.open({ dir, owner: true });
  try {
    const owner = ownerNames(k.store);
    const day = k.store.livedDay();
    for (const id of k.store.list({ archived: false })) {
      const row = k.store.row(id);
      if (row === undefined || row.type !== "memory" || !aboutMe(k.store, row, owner)) continue;
      const v = promotionEligibility(k.store.physicsOf(id), { aboutMe: true, day });
      if (v.fast.intensity < v.fast.needIntensity || v.fast.met || v.eligible) continue;
      k.store.appendCoreEvent({ memoryId: id, action: "promoted", day, lane: "fast", actor: "sleep" });
      k.store.updatePhysics(id, { promotedIdentity: true });
      k.store.setBand(id, "identity", day);
      if (!k.demoteCore(id, { reason: "not who I am" }).ok) throw new Error("demote refused");
      demotedId = id;
      break;
    }
  } finally {
    k.close();
  }
  // A LEGACY return on today — the kind the v8 upgrade carries over. It must
  // never be counted as a return anyone saw.
  const db = new Database(join(dir, "counterparts.sqlite"));
  try {
    const id = (db.query("SELECT id FROM memories WHERE type = 'memory' AND archived = 0 ORDER BY id LIMIT 1").get() as { id: string }).id;
    db.run("INSERT OR IGNORE INTO returns (memory_id, day, source, weight, gap, dream_id, at) VALUES (?, ?, 'legacy', 1, 3, NULL, 0)", [id, legacyDay]);
  } finally {
    db.close();
  }

  // A store that went through the v8 upgrade on lived day 3.
  Counterpart.open({ dir: upgradedDir, owner: true }).close();
  const u = Counterpart.open({ dir: upgradedDir, owner: true });
  try {
    for (let d = 1; d <= 5; d++) u.store.advanceClock(`2026-01-0${String(d)}`);
    u.store.setMeta(V8_UPGRADE_KEY, JSON.stringify({ from: "7", day: 3, at: 0 }));
  } finally {
    u.close();
  }
}, 120_000);

afterAll(() => {
  for (const d of [dir, upgradedDir]) rmSync(d, { recursive: true, force: true });
});

function withSource<T>(at: string, fn: (src: DashboardSource) => T): T {
  const dash = Dashboard.open({ dir: at });
  try {
    return fn(dash.source);
  } finally {
    dash.close();
  }
}

function get(src: DashboardSource, path: string): Record<string, unknown> {
  const reply = router(new URL(`http://${HOST}${path}`), HOST, src);
  expect(reply.status).toBe(200);
  return JSON.parse(reply.body) as Record<string, unknown>;
}

function snapshot(at: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (p: string): void => {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.set(relative(at, full), createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(at);
  return out;
}

/** Returns per source on one lived day, straight from the table. */
function returnsOn(day: number): { awake: number; dream: number; legacy: number } {
  const db = new Database(join(dir, "counterparts.sqlite"), { readonly: true });
  try {
    const rows = db.query("SELECT source, COUNT(*) AS n FROM returns WHERE day = ? GROUP BY source").all(day) as { source: string; n: number }[];
    const of = (s: string): number => rows.find((r) => r.source === s)?.n ?? 0;
    return { awake: of("awake"), dream: of("dream"), legacy: of("legacy") };
  } finally {
    db.close();
  }
}

// ── 0 ──────────────────────────────────────────────────────────────────────

describe("0. the consolidation panel tells the truth about returns and nominations", () => {
  test("the evidence line says returns by source, conversation first; the dream's are apart", () => {
    expect(returnWords({ awake: 2, dream: 31 })).toEqual(["2 came back in conversation", "31 replayed in a dream"]);
    expect(returnWords({ awake: 0, dream: 5 })).toEqual(["5 replayed in a dream"]);
    withSource(dir, (src) => {
      const light = mechanismsView(src).mechanisms.find((m) => m.id === "consolidation")!;
      const r = src.store.returnCounts({ sinceDay: mechanismsView(src).fromDay });
      expect(r.dream).toBeGreaterThan(0);
      expect(light.status).toBe("green");
      expect(light.evidence).toContain(`${r.awake} came back in conversation`);
      expect(light.evidence).toContain(`${r.dream} replayed in a dream`);
      expect(light.evidence).not.toMatch(/\d+ returns? that/);
    });
  });

  test("without the split (the console's path), the shared words are untouched", () => {
    withSource(dir, (src) => {
      const v = mechanismsView(src);
      expect(v.mechanisms.length).toBe(12);
    });
    const v = {
      id: "consolidation", family: "transformation", build: "built", fired: true,
      parts: [{ key: "returns", count: 3, says: ["return", "returns"] }], events: [], today: null, held: null, lastFiredDay: null, schedule: null,
    } as const;
    expect(lightOf(v as never).evidence).toContain("3 returns");
    expect(lightOf(v as never, { awake: 1, dream: 2 }).evidence).toContain("1 came back in conversation, 2 replayed in a dream");
  });

  test("the picture's returns match the table, legacy never counted; its rows are real returns by source (3b: no candidate list)", () => {
    withSource(dir, (src) => {
      const p = (get(src, "/api/mechanism?id=consolidation")["picture"]) as {
        returns: { awake: number; dream: number; days: number };
        memories: { id: string; how: string; day: number; times: number }[];
        climbing?: unknown;
      };
      const day = src.store.livedDay();
      expect(returnsOn(day).legacy).toBeGreaterThan(0);
      const r = src.store.returnCounts({ sinceDay: day - (p.returns.days - 1) });
      expect(p.returns).toEqual({ awake: r.awake, dream: r.dream, days: 7 });
      expect(p.climbing).toBeUndefined();
      expect(p.memories.length).toBeGreaterThan(0);
      expect(p.memories.length).toBeLessThanOrEqual(5);
      // Both sources that happened keep a row, conversation first.
      expect(p.memories.some((m) => m.how === "awake")).toBe(true);
      expect(p.memories.some((m) => m.how === "dream")).toBe(true);
      expect(p.memories[0]!.how).toBe("awake");
      for (const m of p.memories.filter((x) => x.how !== "merged")) {
        const mine = src.store.returnsOf(m.id).filter((x) => x.source === m.how && x.day >= day - 6);
        expect(`${m.id} ${m.times} ${m.day}`).toBe(`${m.id} ${mine.length} ${Math.max(...mine.map((x) => x.day))}`);
      }
    });
  });

  test("a dream's nominations are said as suggestions nothing acts on", () => {
    expect(nominated).toBeGreaterThan(0);
    withSource(dir, (src) => {
      const row = src.store.eventLog({ name: "dream.changed", order: "desc", limit: 1 })[0]!;
      const text = narrate(src.store, row).text;
      expect(text).toContain(`suggested ${nominated} ${nominated === 1 ? "memory" : "memories"} for the core — ${NOMINATION_CAVEAT}`);
      expect(text).not.toContain("nominate-core");
      expect(text).toContain(`In a dream I changed ${replays} things (${replays} replayed)`);
    });
    const dreaming = readFileSync(join(WEB, "mechanisms/dreaming/index.js"), "utf8");
    expect(dreaming).toContain("nothing acts on these");
  });
});

// ── 1 ──────────────────────────────────────────────────────────────────────

describe("1. live activity folds repeats, and a sleep check is not a sleep", () => {
  test("a check: the clock found nothing and no other phase ran", () => {
    const phases = (status: string, reason: string) => [
      { phase: "clock", status: "ran-nothing-found", reason: "nothing-to-do" },
      { phase: "decay", status, reason },
      { phase: "consolidate", status: "did-not-run", reason: "not-due-this-cadence" },
    ];
    expect(isSleepCheck({ reason: "ran", failed: 0, phases: phases("did-not-run", "already-done-today") })).toBe(true);
    expect(isSleepCheck({ reason: "ran", failed: 0, phases: phases("ran", "completed") })).toBe(false);
    expect(isSleepCheck({ reason: "ran", failed: 0, phases: phases("ran-nothing-found", "nothing-to-do") })).toBe(false);
    expect(isSleepCheck({ reason: "ran", failed: 1, phases: phases("failed", "failed") })).toBe(false);
    expect(isSleepCheck({ reason: "threw", phases: phases("did-not-run", "already-done-today") })).toBe(false);
    expect(isSleepCheck({ reason: "ran", phases: [] })).toBe(false);
    expect(laneOf("sleep.cycle", { reason: "ran", phases: phases("did-not-run", "already-done-today") })).toBe("flow");
    expect(laneOf("sleep.cycle", { reason: "ran", phases: phases("ran", "completed") })).toBe("home");
  });

  test("the store's own checks go to the flow feed, with their own words; the real sleep stays home", () => {
    withSource(dir, (src) => {
      const today = src.store.eventLog({ name: "sleep.cycle", order: "desc", limit: 10 }).filter((r) => r.day === src.store.livedDay());
      const checks = today.filter((r) => isSleepCheck(JSON.parse(r.payload ?? "{}") as Record<string, unknown>));
      expect(checks.length).toBe(3);
      expect(today.length - checks.length).toBe(1);
      for (const r of checks) {
        const line = narrate(src.store, r);
        expect([line.lane, line.icon, line.text]).toEqual(["flow", null, "I checked whether it was time to sleep: nothing was due."]);
      }
      const feed = get(src, "/api/overview")["feed"] as { seq: number; name: string; text: string }[];
      const checkSeqs = new Set(checks.map((r) => r.seq));
      expect(feed.some((e) => checkSeqs.has(e.seq))).toBe(false);
      expect(feed.some((e) => e.name === "sleep.cycle" && e.text.startsWith("I slept"))).toBe(true);
    });
  });

  test("the home feed folds neighbours that read the same, and counts lines, not rows", () => {
    withSource(dir, (src) => {
      const feed = get(src, "/api/overview")["feed"] as { name: string; text: string; repeats: number; fromDay: number; day: number }[];
      expect(feed.length).toBe(40);
      for (let i = 1; i < feed.length; i++) {
        expect(`${feed[i]!.name}|${feed[i]!.text}` === `${feed[i - 1]!.name}|${feed[i - 1]!.text}`).toBe(false);
      }
      expect(feed.some((e) => e.repeats > 1)).toBe(true);
      for (const e of feed) expect(e.fromDay).toBeLessThanOrEqual(e.day);
    });
  });
});

// ── 2 ──────────────────────────────────────────────────────────────────────

describe("2. the Emotion panel's Lately says the mood, never a bare recall line", () => {
  // Since 2026-10-14 a turn that brought a memory carrying a feeling is an Emotion line too, naming it
  // (dashboard-mechanisms.test.ts); this demo's turns bring none, so its lines are the mood's.
  test("a mood-matched turn reads as the lift it carries", () => {
    withSource(dir, (src) => {
      const act = get(src, "/api/mechanism?id=emotional")["activity"] as { name: string; text: string }[];
      expect(act.length).toBeGreaterThan(0);
      for (const a of act) {
        expect(a.text).toContain("a matching mood brought");
        expect(a.text).not.toContain("footnote");
      }
      expect(act[0]!.text).toBe("On turn 3 a matching mood brought 2 memories closer (3 came to mind).");
      // The flow feed's reading of the same row is unchanged.
      const row = src.store.eventLog({ name: "recall.decision", order: "desc", limit: 1 })[0]!;
      expect(narrate(src.store, row).text).not.toContain("mood");
    });
  });
});

// ── 3 ──────────────────────────────────────────────────────────────────────

describe("3. merged repeats show their span", () => {
  test("mergeRepeats keeps the oldest day of the run beside the newest", () => {
    const line = (seq: number, day: number, text: string) => ({ seq, day, text, name: "gate.deposit" }) as unknown as Parameters<typeof mergeRepeats>[0][number];
    const merged = mergeRepeats([line(9, 6, "a"), line(8, 4, "a"), line(7, 1, "a"), line(6, 1, "b")]);
    expect(merged.map((m) => [m.seq, m.day, m.fromDay, m.repeats])).toEqual([[9, 6, 1, 3], [6, 1, 1, 1]]);
  });

  test("salience's Lately on the demo store spans several days, and the feed prints the range", async () => {
    withSource(dir, (src) => {
      const act = get(src, "/api/mechanism?id=salience")["activity"] as { repeats: number; fromDay: number; day: number }[];
      expect(act.some((a) => a.repeats > 1 && a.fromDay < a.day)).toBe(true);
    });
    const feed = readFileSync(join(WEB, "shared/widgets/feed.js"), "utf8");
    expect(feed).toContain('"days " + e.fromDay + "–" + e.day');
  });
});

// ── 4 ──────────────────────────────────────────────────────────────────────

describe("6. the retrieval panel's used-rate", () => {
  test("once per memory per day, said out loud and footnotes apart, used by the turns' own test", () => {
    withSource(dir, (src) => {
      const day = src.store.livedDay();
      const u = recallUse(src, day);
      expect(u.days).toBe(7);
      expect(u.perDay.length).toBe(7);
      // Recomputed here, independently.
      const byDay = new Map<number, Map<string, boolean>>();
      for (const row of src.store.eventLog({ name: "recall.decision", sinceDay: day - 6, limit: 20_000 })) {
        const p = JSON.parse(row.payload ?? "{}") as { surfaced?: { id: string }[]; footnotes?: { id: string }[] };
        const m = byDay.get(row.day) ?? new Map<string, boolean>();
        byDay.set(row.day, m);
        for (const x of p.surfaced ?? []) m.set(x.id, true);
        for (const x of p.footnotes ?? []) if (!m.has(x.id)) m.set(x.id, false);
      }
      let brought = 0;
      let used = 0;
      let said = 0;
      for (const [d, m] of byDay) {
        for (const [id, aloud] of m) {
          brought += 1;
          if (aloud) said += 1;
          const ph = src.store.physicsOf(id);
          if (ph.lastUsedDay >= d && ph.lastUsedDay > ph.birthDay) used += 1;
        }
      }
      expect([u.brought, u.used, u.said.brought]).toEqual([brought, used, said]);
      expect(u.said.brought + u.footnote.brought).toBe(u.brought);
      expect(u.said.used + u.footnote.used).toBe(u.used);
      expect(u.perDay.reduce((s, x) => s + x.brought, 0)).toBe(u.brought);
      expect(u.brought).toBeGreaterThan(0);
      const pic = get(src, "/api/mechanism?id=retrieval")["picture"] as { use: unknown };
      expect(pic.use).toEqual(u as unknown);
    });
  });

  test("the pictures draw the new lines", async () => {
    const index = (await import(join(WEB, "mechanisms/index.js"))) as { PANELS: Record<string, { picture(p: unknown): string }> };
    withSource(dir, (src) => {
      const ret = index.PANELS["retrieval"]!.picture(get(src, "/api/mechanism?id=retrieval")["picture"]);
      expect(ret).toContain("got used (said out loud:");
      const cons = index.PANELS["consolidation"]!.picture(get(src, "/api/mechanism?id=consolidation")["picture"]);
      expect(cons).toContain("came back in conversation");
      expect(cons).toContain("replayed in a dream");
      expect(cons).not.toContain("one return away");
    });
  });
});

describe("looking still writes nothing", () => {
  test("every new read leaves the store byte-identical", () => {
    withSource(dir, (src) => {
      const before = snapshot(dir);
      get(src, "/api/overview");
      get(src, "/api/mechanisms");
      for (const m of mechanismsView(src).mechanisms) get(src, `/api/mechanism?id=${m.id}`);
      expect(snapshot(dir)).toEqual(before);
    });
  });
});

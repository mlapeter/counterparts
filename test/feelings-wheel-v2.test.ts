/**
 * The feelings wheel v2 (2026-09-30, schema v11): seven cores, numbers on
 * every word, the writer's core kept, the one migration that re-files the
 * first wheel's feelings, and the small mechanism that reads valence
 * (softening, mood) and recognition (the core's fast lane).
 *
 * The migration is tested against a synthetic v10 store holding every word
 * the emotion walk found in the live store (`~/counterparts-notes/
 * 2026-09-30-emotion-walk.md`, "Live store"), under the cores the notes list
 * them with — and, where the notes do not say, under the core the first wheel
 * would have stored them with. Nothing here opens a real store.
 *
 * Hermetic: a fresh temp directory per test, removed after.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { upgradeV11Findings } from "../src/adapters/claude-code/doctor.js";
import { TOOLS, openServer } from "../src/adapters/mcp/index.js";
import { CORE_EMOTIONS, remapV10Feeling } from "../src/core/feelings-wheel.js";
import { feelingSofteningDays, promotionEligibility, salArm, softenedFeeling, stability, TUNABLES } from "../src/core/physics/index.js";
import type { MemoryPhysics } from "../src/core/types.js";
import { readFeelingAsk } from "../src/core/recall/index.js";
import { coreContextFor, selfRelevantFeeling } from "../src/core/sleep/consolidate.js";
import { recognitionLaneFindings } from "../src/adapters/claude-code/doctor.js";
import { openDb } from "../src/core/store/db.js";
import {
  DEFAULT_STRENGTH_CAP,
  OBSERVER_READ_FLOOR,
  SCHEMA_VERSION,
  Store,
  V11_UPGRADE_KEY,
  feelingValence,
  isStoreError,
  paths,
  refileFeelingsV11,
  refileStrayV10Cores,
  restoreFeelingsV10,
} from "../src/core/store/index.js";
import type { StoreOptions } from "../src/core/store/index.js";

let root: string;
let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-wheel-v2-"));
  dir = join(root, "store");
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function store(opts: Omit<StoreOptions, "dir"> = {}): Store {
  const s = Store.open({ dir, snapshotsDir: join(root, "snaps"), ...opts });
  open.push(s);
  return s;
}

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return isStoreError(err) ? `${err.code}:${String(err.detail["reason"] ?? "")}` : String(err);
  }
}

const mem = (s: Store, body = "the afternoon the build went green") => s.put({ type: "memory", kind: "fact", body });

// ═══════════════════════════════════════════════════════════════════════════
// the writer's core wins
// ═══════════════════════════════════════════════════════════════════════════
describe("the writer's core wins", () => {
  test("a word under a core that is not its home is stored under the writer's core, with its own numbers, and nothing is said to move", () => {
    const s = store();
    const id = mem(s);
    const out = s.addFeelings(id, [
      { whose: "owner", core: "sad", emotion: "hurt", strength: 0.5 },
      { whose: "self", core: "happy", emotion: "grateful", strength: 0.4 },
    ]);
    expect(out.repairs).toEqual([]);
    expect(out.notices).toEqual([]);
    const rows = s.feelingsFor(id);
    expect(rows.map((r) => [r.core, r.emotion])).toEqual([
      ["sad", "hurt"],
      ["happy", "grateful"],
    ]);
    // Hurt is a blend of angry and sad, so its own −0.7 applies under sad; grateful
    // under happy, a core it does not sit under, takes happy's valence (M3).
    expect(rows.map((r) => feelingValence(r))).toEqual([-0.7, 0.7]);
    s.addFeelings(id, [{ whose: "self", core: "happy", emotion: "furious", strength: 0.4 }]);
    const furious = s.feelingsFor(id).at(-1);
    expect(furious).toMatchObject({ core: "happy", emotion: "furious" });
    expect(feelingValence(furious!)).toBe(0.7);
  });

  test("no core: the word's home; a word off the wheel with no core cannot be placed", () => {
    const s = store();
    const id = mem(s);
    s.addFeelings(id, [{ whose: "self", emotion: "steadied", strength: 0.4 }]);
    expect(s.feelingsFor(id)[0]).toMatchObject({ core: "calm", emotion: "steadied" });
    expect(code(() => s.addFeelings(id, [{ whose: "self", emotion: "unclenched", strength: 0.4 }]))).toBe("FEELING_INVALID:core-unknown");
    expect(code(() => s.addFeelings(id, [{ whose: "self", core: "boredom", emotion: "hopeful", strength: 0.4 }]))).toBe("FEELING_INVALID:core-unknown");
  });

  test("a first-wheel core name still reads, as the upgrade files it, and the caller is told", () => {
    const s = store();
    const id = mem(s);
    const out = s.addFeelings(id, [
      { whose: "owner", core: "fear", emotion: "anxious", strength: 0.5 },
      { whose: "owner", core: "surprise", emotion: "amazed", strength: 0.5 },
      { whose: "owner", core: "surprise", emotion: "excited", strength: 0.5 },
      { whose: "owner", core: "disgust", emotion: "revolted", strength: 0.5 },
      { whose: "owner", core: "anger", emotion: "frustrated", strength: 0.5 },
    ]);
    expect(s.feelingsFor(id).map((r) => r.core)).toEqual(["uneasy", "curious", "happy", "angry", "angry"]);
    expect(out.repairs.map((r) => [r.field, r.was, r.now])).toEqual([
      ["core", "fear", "uneasy"],
      ["core", "surprise", "curious"],
      ["core", "surprise", "happy"],
      ["core", "disgust", "angry"],
      ["core", "anger", "angry"],
    ]);
    expect(out.repairs[0]?.note).toContain("not one of the cores now");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// the numbers
// ═══════════════════════════════════════════════════════════════════════════
describe("numbers on each feeling", () => {
  test("strength left out is the word's intensity; valence left out stays NULL and reads as the word's", () => {
    const s = store();
    const id = mem(s);
    s.addFeelings(id, [
      { whose: "self", core: "curious", emotion: "confused" },
      { whose: "self", core: "angry", emotion: "furious", strength: 0.3 },
      { whose: "self", core: "warm", emotion: "moved", strength: 0.4, valence: 0.2 },
      { whose: "self", core: "calm", emotion: "unclenched" },
    ]);
    const [confused, furious, moved, own] = s.feelingsFor(id);
    expect(confused).toMatchObject({ strength: 0.45, valence: null });
    expect(feelingValence(confused!)).toBe(-0.2);
    // The writer's strength is kept as given, never the word's.
    expect(furious).toMatchObject({ strength: 0.3, valence: null });
    expect(feelingValence(furious!)).toBe(-0.8);
    // The writer's valence is stored and read first.
    expect(moved).toMatchObject({ valence: 0.2 });
    expect(feelingValence(moved!)).toBe(0.2);
    // A word of the writer's own takes its core's numbers.
    expect(own).toMatchObject({ emotion: "other", other_word: "unclenched", strength: 0.35 });
    expect(feelingValence(own!)).toBe(0.5);
    expect(code(() => s.addFeelings(id, [{ whose: "self", core: "calm", emotion: "settled", valence: -2 }]))).toBe("FEELING_INVALID:valence-out-of-range");
  });

  test("a strength left out never opens the fast lane: the default is capped below CORE_FAST_FEELING (m2)", () => {
    expect(DEFAULT_STRENGTH_CAP).toBeLessThan(TUNABLES.CORE_FAST_FEELING);
    const s = store();
    const id = mem(s);
    s.addFeelings(id, [
      { whose: "self", core: "uneasy", emotion: "terrified" },
      { whose: "self", core: "happy", emotion: "ecstatic" },
      { whose: "self", core: "uneasy", emotion: "terrified", strength: 0.9 },
    ]);
    expect(s.feelingsFor(id).map((r) => r.strength)).toEqual([DEFAULT_STRENGTH_CAP, DEFAULT_STRENGTH_CAP, 0.9]);
  });

  test("an `other` whose word is on the wheel now reads that word's numbers", () => {
    expect(feelingValence({ core: "uneasy", emotion: "other", other_word: "sheepish" })).toBe(-0.5);
    // Under a core the word does not sit under, the writer's core decides the valence (M3).
    expect(feelingValence({ core: "sad", emotion: "other", other_word: "moved" })).toBe(-0.6);
    expect(feelingValence({ core: "curious", emotion: "other", other_word: "confused" })).toBe(-0.2);
    expect(feelingValence({ core: "sad", emotion: "other", other_word: "glowing" })).toBe(-0.6);
  });

  test("the MCP door: core and strength may be left out, valence given; the enum is the seven", async () => {
    const s = openServer({ dir, scope: "/tmp/wheel-v2-project", owner: true });
    open.push({ close: () => s.counterpart.close() });
    const out = (await s.call("remember", {
      text: "The handoff note was read the next morning and it held.",
      feelings: [
        { whose: "self", emotion: "trusted" },
        { whose: "owner", core: "warm", emotion: "moved", strength: 0.4, valence: 0.3 },
      ],
    })).structuredContent as Record<string, unknown>;
    expect(out["stored"]).toBe(true);
    const rows = s.counterpart.store.feelingsFor(out["id"] as string);
    expect(rows.map((r) => [r.core, r.emotion, r.strength, r.valence])).toEqual([
      ["warm", "trusted", 0.5, null],
      ["warm", "moved", 0.4, 0.3],
    ]);
    const text = JSON.stringify(TOOLS.find((t) => t.name === "remember")?.inputSchema);
    expect(text).toContain(JSON.stringify([...CORE_EMOTIONS]));
    expect(text).not.toContain('"fear"');
    expect(text).not.toContain("sheepish (fear");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// the migration (v10 → v11)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every word the emotion walk found in the live store, as the first wheel
 * would have stored it — `[old core, emotion, other_word, expected core,
 * expected emotion]`. A word on the first wheel is its key; a word off it is
 * `other` with the word kept. Cores the notes name: surprise as a catch-all
 * (recognized, unsettled, caught, confused, curious, amazed, excited), and the
 * words already under two cores (moved happy/sad, sheepish fear/sad, curious
 * happy/surprise).
 */
const LIVE: readonly (readonly [string, string, string | null, string, string])[] = [
  // Mine, most used.
  ["happy", "hopeful", null, "happy", "hopeful"],
  ["fear", "sheepish", null, "uneasy", "sheepish"],
  ["sad", "other", "sheepish", "sad", "other"], // sad maps one to one: the writer's core wins (M3)
  ["happy", "amused", null, "happy", "amused"],
  ["happy", "moved", null, "warm", "moved"],
  ["sad", "other", "moved", "sad", "other"],
  ["sad", "wistful", null, "sad", "wistful"],
  ["happy", "other", "steadied", "calm", "other"],
  ["happy", "curious", null, "curious", "curious"],
  ["surprise", "other", "curious", "curious", "other"],
  ["happy", "fond", null, "warm", "fond"],
  ["happy", "grateful", null, "warm", "grateful"],
  ["happy", "other", "kinship", "warm", "other"],
  ["happy", "relieved", null, "calm", "relieved"],
  ["sad", "other", "rueful", "sad", "other"],
  ["sad", "tender", null, "sad", "tender"],
  ["surprise", "other", "recognized", "curious", "other"],
  ["happy", "other", "recognized", "curious", "other"],
  ["surprise", "other", "unsettled", "uneasy", "other"],
  ["fear", "other", "unsettled", "uneasy", "other"],
  // Mine, singles.
  ["sad", "vulnerable", null, "sad", "vulnerable"], // "exposed", read through the first wheel's alias
  ["fear", "other", "exposed", "uneasy", "other"],
  ["fear", "other", "seen", "uneasy", "other"],
  ["happy", "other", "anticipating", "happy", "other"],
  ["happy", "other", "clarified", "curious", "other"],
  ["happy", "other", "completion", "calm", "other"],
  ["happy", "other", "encouraged", "happy", "other"],
  ["happy", "other", "engaged", "happy", "other"],
  ["happy", "other", "glad", "happy", "other"],
  ["happy", "other", "settled", "calm", "other"],
  ["happy", "other", "trust", "warm", "other"],
  ["happy", "other", "trusted", "warm", "other"],
  ["happy", "other", "warm", "warm", "other"],
  ["happy", "other", "entrusted", "warm", "other"],
  ["sad", "lonely", null, "sad", "lonely"],
  ["surprise", "other", "caught", "uneasy", "other"],
  ["surprise", "confused", null, "curious", "confused"],
  ["surprise", "amazed", null, "curious", "amazed"],
  ["surprise", "other", "recognition", "curious", "other"],
  // Mike's, as recorded.
  ["anger", "frustrated", null, "angry", "frustrated"],
  ["anger", "hurt", null, "angry", "hurt"],
  ["fear", "other", "wary", "uneasy", "other"],
  ["happy", "interested", null, "curious", "interested"],
  ["happy", "other", "validated", "warm", "other"],
  ["sad", "other", "bummed", "sad", "other"],
  ["sad", "guilty", null, "uneasy", "guilty"],
  ["surprise", "excited", null, "happy", "excited"],
  // The first wheel's edges: qualified keys, a core named alone, disgust, and words that left their core.
  ["fear", "fear.insecure", null, "uneasy", "insecure"],
  ["anger", "anger.insecure", null, "angry", "insecure"],
  ["sad", "sad.inferior", null, "sad", "inferior"],
  ["fear", "fear", null, "uneasy", "afraid"],
  ["anger", "anger", null, "angry", "angry"],
  ["surprise", "surprise", null, "curious", "surprised"],
  ["disgust", "disgust", null, "angry", "disgusted"],
  ["disgust", "disappointed", null, "angry", "disappointed"],
  ["surprise", "disillusioned", null, "sad", "disillusioned"],
  ["surprise", "startled", null, "uneasy", "startled"],
  ["happy", "bittersweet", null, "happy", "bittersweet"],
  ["happy", "peaceful", null, "calm", "peaceful"],
  ["happy", "accepted", null, "warm", "accepted"],
  ["sad", "remorseful", null, "uneasy", "remorseful"],
  ["happy", "happy", null, "happy", "happy"],
  ["happy", "other", "glowing", "happy", "other"],
  ["surprise", "other", "jolted", "curious", "other"],
];

/** A v11 store with one memory and the LIVE rows written under the first wheel, turned back into v10. Returns the feeling ids in LIVE order. */
function v10Store(): { memory: string; ids: string[] } {
  const s = Store.open({ dir, snapshotsDir: join(root, "snaps") });
  const memory = mem(s, "Everything the walk found, on one memory.");
  s.close();
  const db = new Database(paths.operational(dir));
  const ids = LIVE.map((_, i) => `fel_live${String(i).padStart(3, "0")}`);
  const insert = db.prepare(
    `INSERT INTO feelings (id, memory_id, whose, core, emotion, other_word, strength, carried_by, created_at, updated_at, source)
     VALUES (?, ?, 'self', ?, ?, ?, 0.4, '', ?, ?, 'session')`,
  );
  LIVE.forEach(([core, emotion, word], i) => insert.run(ids[i] as string, memory, core, emotion, word, 1_000 + i, 1_000 + i));
  db.run("ALTER TABLE feelings DROP COLUMN valence");
  db.run("ALTER TABLE feelings DROP COLUMN core_v10");
  db.run("ALTER TABLE feelings DROP COLUMN emotion_v10");
  db.run("DELETE FROM meta WHERE key = ?", [V11_UPGRADE_KEY]);
  db.run("UPDATE meta SET value = '10' WHERE key = 'schemaVersion'");
  db.close();
  return { memory, ids };
}

describe("schema v11: the one migration", () => {
  test("the observer floor is 11 (v12, 2026-10-03, kept it there)", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(11);
    expect(OBSERVER_READ_FLOOR).toBe(11);
  });

  test("every live word is re-filed onto the seven, the old pair kept on each row it moved, after a copy", () => {
    const { memory, ids } = v10Store();
    const s = store();
    expect(s.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    expect(readdirSync(join(root, "snaps")).some((n) => n.includes("v10"))).toBe(true);
    const rows = new Map(s.feelingsFor(memory).map((r) => [r.id, r]));
    LIVE.forEach(([core, emotion, word, wantCore, wantEmotion], i) => {
      const r = rows.get(ids[i] as string);
      const label = `${core}/${emotion}${word === null ? "" : `/${word}`}`;
      expect(`${label} → ${String(r?.core)}/${String(r?.emotion)}`).toBe(`${label} → ${wantCore}/${wantEmotion}`);
      expect(r?.other_word ?? null).toBe(word);
      const moved = wantCore !== core || wantEmotion !== emotion;
      expect(`${label}: ${String(r?.core_v10)}/${String(r?.emotion_v10)}`).toBe(`${label}: ${moved ? `${core}/${emotion}` : "null/null"}`);
      expect(r?.valence).toBeNull();
      expect(CORE_EMOTIONS as readonly string[]).toContain(r?.core as string);
    });
    // The record doctor reads: what it read and what it moved, from where to where.
    const note = JSON.parse(s.getMeta(V11_UPGRADE_KEY) ?? "{}") as { from: string; feelings: number; refiled: number; moves: Record<string, number> };
    expect(note.from).toBe("10");
    expect(note.feelings).toBe(LIVE.length);
    expect(note.refiled).toBe(LIVE.filter(([c, e, , wc, we]) => c !== wc || e !== we).length);
    expect(note.moves["fear → uneasy"]).toBe(LIVE.filter(([c]) => c === "fear").length);
    expect(note.moves["happy → warm"]).toBeGreaterThan(0);
    const [line] = upgradeV11Findings(s);
    expect(line?.detail).toContain(`${String(note.refiled)} of ${String(LIVE.length)} recorded feelings re-filed`);
    expect(line?.detail).toContain("fear → uneasy");
  });

  test("the rule the migration uses is the one table above, row by row (pure)", () => {
    for (const [core, emotion, word, wantCore, wantEmotion] of LIVE) {
      expect(remapV10Feeling(core, emotion, word)).toEqual({ core: wantCore, emotion: wantEmotion });
    }
  });

  test("a second run moves nothing — not even a feeling written since under a core the writer chose", () => {
    const { memory } = v10Store();
    const s = store();
    s.addFeelings(memory, [{ whose: "self", core: "happy", emotion: "grateful", strength: 0.5 }]);
    const before = JSON.stringify(s.feelingsFor(memory));
    s.close();
    open.splice(0);
    const db = openDb(paths.operational(dir));
    try {
      expect(db.transaction(() => refileFeelingsV11(db))).toEqual({ feelings: 0, refiled: 0, moves: {} });
    } finally {
      db.close();
    }
    const again = store();
    expect(JSON.stringify(again.feelingsFor(memory))).toBe(before);
    expect(again.feelingsFor(memory).at(-1)).toMatchObject({ core: "happy", emotion: "grateful" });
  });

  test("the way back gives every row exactly what the first wheel stored", () => {
    const { memory, ids } = v10Store();
    const s = store();
    s.close();
    open.splice(0);
    const db = openDb(paths.operational(dir));
    try {
      expect(restoreFeelingsV10(db)).toBe(LIVE.filter(([c, e, , wc, we]) => c !== wc || e !== we).length);
      const rows = db.all<{ id: string; core: string; emotion: string; other_word: string | null; core_v10: string | null }>(
        "SELECT id, core, emotion, other_word, core_v10 FROM feelings WHERE memory_id = ?",
        memory,
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      LIVE.forEach(([core, emotion, word], i) => {
        expect(byId.get(ids[i] as string)).toEqual({ id: ids[i] as string, core, emotion, other_word: word, core_v10: null });
      });
    } finally {
      db.close();
    }
  });

  test("a fresh store and a migrated one have the same feelings columns; an observer waits for a writer", () => {
    v10Store();
    let refused: string | null = null;
    try {
      store({ observer: true });
    } catch (err) {
      refused = isStoreError(err) ? err.code : "other";
    }
    expect(refused).toBe("STORE_UNINITIALIZED");
    const migrated = store();
    migrated.close();
    open.splice(0);
    const cols = (path: string): string => {
      const d = new Database(path, { readonly: true });
      try {
        return JSON.stringify(d.query("PRAGMA table_info(feelings)").all());
      } finally {
        d.close();
      }
    };
    const freshDir = join(root, "fresh");
    Store.open({ dir: freshDir, snapshotsDir: join(root, "snaps2") }).close();
    expect(cols(paths.operational(dir))).toBe(cols(paths.operational(freshDir)));
  });

  test("a stray first-wheel core is swept at a writer's open, keeping its old pair; a second open finds nothing (m3)", () => {
    const s = store();
    const id = mem(s);
    s.close();
    open.splice(0);
    const db = new Database(paths.operational(dir));
    db.run(
      `INSERT INTO feelings (id, memory_id, whose, core, emotion, other_word, strength, carried_by, created_at, updated_at, source)
       VALUES ('fel_stray', ?, 'self', 'fear', 'worried', NULL, 0.4, '', 1, 1, 'session')`,
      [id],
    );
    db.close();
    const again = store();
    expect(again.feelingsFor(id)[0]).toMatchObject({ core: "uneasy", emotion: "worried", core_v10: "fear", emotion_v10: "worried" });
    again.close();
    open.splice(0);
    const ops = openDb(paths.operational(dir));
    try {
      expect(refileStrayV10Cores(ops)).toBe(0);
    } finally {
      ops.close();
    }
  });

  test("doctor is silent on a store born at v11", () => {
    const s = store();
    expect(upgradeV11Findings(s)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// the mechanism
// ═══════════════════════════════════════════════════════════════════════════
describe("the mechanism", () => {
  test("an unpleasant feeling softens faster than a pleasant one; a neutral one on the old clock", () => {
    expect(feelingSofteningDays(0)).toBe(TUNABLES.S_FEELING);
    expect(feelingSofteningDays(undefined)).toBe(TUNABLES.S_FEELING);
    expect(feelingSofteningDays(-1)).toBe(TUNABLES.S_FEELING_NEGATIVE);
    expect(feelingSofteningDays(1)).toBe(TUNABLES.S_FEELING_POSITIVE);
    expect(feelingSofteningDays(-0.7)).toBeCloseTo(15.8, 10);
    expect(feelingSofteningDays(0.7)).toBeCloseTo(25.6, 10);
    const at = (v: number | undefined): number => softenedFeeling(0.6, 20, v);
    expect(at(-0.7)).toBeLessThan(at(0));
    expect(at(0)).toBeLessThan(at(0.7));
    expect(at(undefined)).toBeCloseTo(0.6 * Math.exp(-1), 10);
    // Fresh is fresh, whatever the valence.
    expect(softenedFeeling(0.6, 0, -1)).toBe(0.6);
  });

  test("valence never reaches the memory: an angry and a happy feeling of one strength hold it the same", () => {
    const s = store();
    const angry = mem(s, "The deploy failed for the third time on the same error.");
    const happy = mem(s, "The deploy went out on the first try this morning.");
    s.addFeelings(angry, [{ whose: "owner", core: "angry", emotion: "furious", strength: 0.7 }]);
    s.addFeelings(happy, [{ whose: "owner", core: "happy", emotion: "joyful", strength: 0.7 }]);
    const a = s.physicsOf(angry);
    const h = s.physicsOf(happy);
    expect(a.feelingPeak).toBe(0.7);
    expect(h.feelingPeak).toBe(0.7);
    expect(stability(a)).toBe(stability(h));
    expect(salArm(a)).toBe(salArm(h));
  });

  test("recognition: an unmarked memory carrying it is on the fast lane as about me; a mark wins; the slow lane still needs one", () => {
    const s = store();
    const unmarked = mem(s, "Reading the old handoff, I saw how I write when I am careful.");
    const work = mem(s, "The build cache keys on the lockfile hash.");
    s.setAbout(work, "work", { by: "writer" });
    const plain = mem(s, "The cache was warm the second time.");
    s.addFeelings(unmarked, [{ whose: "self", core: "curious", emotion: "recognized", strength: 0.7 }]);
    expect(recognitionLaneFindings(s)[0]?.detail).toContain("1 unmarked memory is on the core's fast lane");
    s.addFeelings(work, [{ whose: "self", core: "curious", emotion: "that's me", strength: 0.7 }]);
    s.addFeelings(plain, [{ whose: "self", core: "curious", emotion: "clarified", strength: 0.7 }]);
    const day = s.livedDay();
    const ctx = (id: string) => coreContextFor(s, s.row(id) as never, day);
    expect(ctx(unmarked)).toMatchObject({ aboutMe: false, selfRelevantFeeling: true });
    expect(ctx(work).selfRelevantFeeling).toBeUndefined();
    expect(ctx(plain).selfRelevantFeeling).toBeUndefined();
    // The fast lane: strongly felt, and it came back after a gap.
    const p = (over: Partial<MemoryPhysics>): MemoryPhysics => ({ ...s.physicsOf(unmarked), ...over });
    const fast = p({ feelingPeak: 0.7, lastReturnDay: 5, firstReturnDay: 5, returnDays: 1, birthDay: 0 });
    expect(promotionEligibility(fast, { aboutMe: false, selfRelevantFeeling: true, day: 5 })).toMatchObject({ eligible: true, lane: "fast" });
    expect(promotionEligibility(fast, { aboutMe: false, day: 5 }).blockedBy).toContain("not-about-me");
    // Not strongly felt: recognition alone does not open the slow lane.
    const slow = p({ feelingPeak: 0.2, salience: { relevance: 0, emotional: 0, predictive: 0, novelty: 0 }, lastReturnDay: 40, firstReturnDay: 2, returnDays: 12, birthDay: 0 });
    expect(promotionEligibility(slow, { aboutMe: false, selfRelevantFeeling: true }).blockedBy).toContain("not-about-me");
  });
});

describe("which recognition counts (review of #301, M1)", () => {
  test("mine, strong on its own, felt in a session — a reflection's only with the door open, a dream's never", () => {
    const s = store();
    const cases: [string, Parameters<Store["addFeelings"]>[1][number], Parameters<Store["addFeelings"]>[2]][] = [
      ["mine, strong, session", { whose: "self", core: "curious", emotion: "recognized", strength: 0.6 }, {}],
      ["the owner's", { whose: "owner", core: "curious", emotion: "recognized", strength: 0.9 }, {}],
      ["mine, faint", { whose: "self", core: "curious", emotion: "recognized", strength: 0.5 }, {}],
      ["a dream's", { whose: "self", core: "curious", emotion: "recognized", strength: 0.9 }, { source: "dream" }],
      ["a reflection's", { whose: "self", core: "curious", emotion: "familiar", strength: 0.9 }, { source: "reflection", recordedLater: "2026-09-30" }],
    ];
    const read = (open: boolean) =>
      cases.map(([label, input, opts]) => {
        const id = mem(s, `A memory for the case: ${label}.`);
        s.addFeelings(id, [input], opts);
        return `${label}: ${String(selfRelevantFeeling(s, s.row(id) as never, open))}`;
      });
    expect(read(false)).toEqual([
      "mine, strong, session: true",
      "the owner's: false",
      "mine, faint: false",
      "a dream's: false",
      "a reflection's: false",
    ]);
    expect(read(true).at(-1)).toBe("a reflection's: true");
    // A strong memory carrying a faint recognition is not enough: the feeling's own strength counts.
    const strong = s.put({ type: "memory", kind: "fact", body: "A strongly felt memory with a faint recognition on it.", salience: { relevance: 0.6, emotional: 0.9, predictive: 0.6, novelty: 0 } });
    s.addFeelings(strong, [{ whose: "self", core: "curious", emotion: "recognized", strength: 0.3 }]);
    expect(selfRelevantFeeling(s, s.row(strong) as never, true)).toBe(false);
  });
});

describe("everyday words name a feeling only in a feeling's frame (review of #301, m1)", () => {
  const self = { asker: "self" as const };
  test("questions about things do not rank as questions about feeling", () => {
    for (const q of [
      "I settled on the second option, which one was it?",
      "is my PR still open",
      "what's the most important thing I said about the scheduler",
      "when was the queue empty last",
      "what have I seen about rate limits",
      "which test caught my timezone bug",
      "I engaged the retry path in which release?",
      "how close am I to finishing the importer",
      // The reviewer's, verbatim: after "to be", a preposition next makes it a state of a thing.
      "are you close to done with the migration",
      "what was I engaged with last week",
      "is this familiar to you",
    ]) {
      expect(`${q}: ${String(readFeelingAsk(q, self, new Set(), 3).ranked)}`).toBe(`${q}: false`);
    }
  });

  test("the same words in a feeling's frame still do", () => {
    for (const q of [
      "when did I feel close to Mike",
      "was I content after the merge",
      "when was I content",
      "times I felt seen",
      "when was I afraid",
      // The reviewer's, verbatim, either way allowed: kept RANKED — "am I sorry"
      // is a question about how I feel about a choice, not about a thing.
      "am I sorry I picked sqlite",
    ]) {
      expect(`${q}: ${String(readFeelingAsk(q, self, new Set(), 3).ranked)}`).toBe(`${q}: true`);
    }
  });
});

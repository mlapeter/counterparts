/**
 * The chunk gate's record, PERSISTED — `gate.chunk` in box 2's durable log.
 *
 * `encodeChunk` returns a full `EncodeResult` and the composition root used to
 * emit five counts from it into an in-process ring, dropping the rest. Three of
 * the replay harness's baselines were `not-computable` as a direct consequence
 * (`gate.refusalMix`, `preselect.meanSchemasShown`, `preselect.channelMix` —
 * `tools/replay/INTERFACE-GAPS.md` §1), and "not computable" for a metric means
 * the parallel run cannot check it.
 *
 * The four properties this suite holds:
 *
 *   1. **It is durable.** The record survives the process that wrote it, because
 *      the only evidence a parallel run ever leaves is a store.
 *   2. **It covers the FULLY-GATED chunk.** Those are most of what a refusal
 *      distribution is made of; recording only the productive ones would grade
 *      the gate by the chunks it let through.
 *   3. **It is content-by-reference** (store §5 G10, scar §2.20): ids, counts,
 *      gate names, closed-vocabulary reasons. A suite-wide marker planted in
 *      every span and every proposal must not appear anywhere in the log.
 *   4. **It is idempotent under replay** and stands down under observer.
 *
 * Hermetic: a fresh temp data dir per test, removed after.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import type { InterpretFn, SweepChunk } from "../src/core/remember/index.js";

const ENV = "COUNTERPARTS_DATA_DIR";

/** Planted in every span and every proposal below. A log containing one of
 *  these is a log carrying content, which is the honeypot the design rejects. */
const SPAN_MARKER = "ZQGATESPANMARKER";
const PROPOSAL_MARKER = "ZQGATEPROPOSALMARKER";

let dir: string;
let priorEnv: string | undefined;
const open: Counterpart[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-gate-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
});

function brain(opts: Parameters<typeof Counterpart.open>[0] = {}): Counterpart {
  const c = Counterpart.open({ dir, owner: true, ...opts });
  open.push(c);
  return c;
}

const TURNS = [
  {
    role: "user" as const,
    text: `${SPAN_MARKER} We settled the storage split today: canonical prose on disk, one small operational database, and a cache nobody backs up.`,
  },
  {
    role: "assistant" as const,
    text: `${SPAN_MARKER} Recorded. The cache being rebuildable is what keeps the backup set small enough to be honest about.`,
  },
  {
    role: "user" as const,
    text: `${SPAN_MARKER} Right — a backup you cannot verify is a backup you do not have.`,
  },
];

function interpreter(proposals: readonly unknown[], stopReason = "end_turn"): InterpretFn {
  return async (_chunk: SweepChunk) => ({ proposals, stopReason });
}

/** One captured session, one boundary, one swept chunk. */
async function sweepOnce(
  c: Counterpart,
  proposals: readonly unknown[],
  session = "s1",
): Promise<void> {
  c.captureSpans({ session, scope: "proj", turns: TURNS });
  c.boundary({ session, scope: "proj", kind: "stop" });
  await c.sweepFallback({ interpret: interpreter(proposals) });
}

function records(c: Counterpart): { day: number; ref: string | null; payload: Record<string, unknown> }[] {
  return c.store.eventLog({ name: "gate.chunk", limit: 1000 }).map((row) => ({
    day: row.day,
    ref: row.ref,
    payload: JSON.parse(row.payload ?? "{}") as Record<string, unknown>,
  }));
}

const GOOD = {
  content: `${PROPOSAL_MARKER} The cache is rebuildable from canonical files, which is exactly why it never enters the backup set.`,
  kind: "fact",
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. The record exists, durably, per chunk
// ═══════════════════════════════════════════════════════════════════════════
describe("the chunk gate's record reaches the DURABLE log", () => {
  test("a swept chunk writes one `gate.chunk` row, addressed by a content key", async () => {
    const c = brain();
    await sweepOnce(c, [GOOD]);

    const rows = records(c);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row?.payload["accepted"]).toBe(1);
    expect(row?.payload["refused"]).toBe(0);
    expect(row?.payload["fullyGated"]).toBe(false);
    expect(row?.payload["scope"]).toBe("proj");
    expect(row?.payload["session"]).toBe("s1");
    // The correlation id the harness had to guess at: content, not arrival
    // order — chunk indices restart at 0 for every scope `sweepAll` visits.
    expect(typeof row?.payload["chunkKey"]).toBe("string");
    expect(row?.ref).toBe(row?.payload["chunkKey"] as string);
    expect((row?.payload["chunkKey"] as string).length).toBeGreaterThan(0);
  });

  test("it SURVIVES the process: a second brain over the same dir reads it back", async () => {
    const first = brain();
    await sweepOnce(first, [GOOD]);
    const written = records(first);
    first.close();

    const second = brain();
    const read = records(second);
    expect(read.length).toBe(written.length);
    expect(read[0]?.payload["chunkKey"]).toBe(written[0]?.payload["chunkKey"]);
    // This is the whole point: a metric computable only from an in-process
    // event ring cannot be recomputed from the store a parallel run leaves.
    expect(read[0]?.payload["shown"]).toBe(written[0]?.payload["shown"]);
  });

  test("the relayed event carries the same key, so the two can be joined", async () => {
    const c = brain();
    await sweepOnce(c, [GOOD]);
    const relayed = c.events("counterpart.sweep.chunk")[0];
    expect(relayed?.data?.chunkKey).toBe(records(c)[0]?.payload["chunkKey"] as string);
    expect(relayed?.data?.scope).toBe("proj");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The fully-gated chunk — the one the distribution is made of
// ═══════════════════════════════════════════════════════════════════════════
describe("a FULLY GATED chunk is recorded, and still moves no durable state", () => {
  test("the record is written even though the chunk minted nothing", async () => {
    const c = brain();
    // Every proposal is a stub: the content floor refuses all of them.
    await sweepOnce(c, [
      { content: "placeholder", kind: "fact" },
      { content: "TBD", kind: "fact" },
    ]);

    const rows = records(c);
    expect(rows.length).toBe(1);
    expect(rows[0]?.payload["fullyGated"]).toBe(true);
    expect(rows[0]?.payload["accepted"]).toBe(0);
    expect(rows[0]?.payload["refused"]).toBe(2);
    // Recording the refusal is telemetry. Gated still means gated:
    expect(rows[0]?.payload["effects"]).toBe(0);
    expect(c.store.list({ type: "memory" })).toEqual([]);
    expect(c.events("counterpart.sweep.minted")).toEqual([]);
  });

  test("the REFUSAL MIX is recoverable: which gate acted, and why each proposal fell", async () => {
    const c = brain();
    await sweepOnce(c, [
      { content: "TBD", kind: "fact" },
      { content: "x", kind: "fact" },
    ]);

    const payload = records(c)[0]?.payload ?? {};
    const fires = payload["fires"] as Record<string, number>;
    const byReason = payload["refusalsByReason"] as Record<string, number>;
    // The battery counts its own fires — one `gate.<name>` event per acting
    // gate — and the record relays that count rather than re-deriving it.
    expect(fires["floor"]).toBe(2);
    expect(Object.values(byReason).reduce((a, b) => a + b, 0)).toBe(2);
    for (const reason of Object.keys(byReason)) expect(reason).toContain("content-");

    // And per proposal: the FIRST blocking reason and every one of them.
    const refusals = payload["refusals"] as { ref: string; reason: string; blockedBy: string[] }[];
    expect(refusals.length).toBe(2);
    for (const r of refusals) {
      expect(typeof r.ref).toBe("string");
      expect(r.blockedBy.length).toBeGreaterThan(0);
      expect(r.blockedBy).toContain(r.reason);
    }
  });

  test("a SECRET in a proposal is recorded as a secrets fire, and the secret is not", async () => {
    const c = brain();
    await sweepOnce(c, [
      {
        content: `${PROPOSAL_MARKER} The deploy key we rotated is AKIAIOSFODNN7EXAMPLE and it now lives only in the manager.`,
        kind: "fact",
      },
    ]);

    const payload = records(c)[0]?.payload ?? {};
    expect((payload["fires"] as Record<string, number>)["secrets"]).toBe(1);
    // Content-by-reference, at the sharpest point: the family and the count
    // reach the log; the credential never does, and neither does a hash of it
    // (hashing a low-entropy credential is reversible — store §16 G9).
    expect(JSON.stringify(payload)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Preselection: the count behind `blind`, and the channel that reached it
// ═══════════════════════════════════════════════════════════════════════════
describe("the record carries what the author was SHOWN, not only whether it was blind", () => {
  test("`shown`, the channel split, and the semantic channel's STATE all land", async () => {
    const c = brain();
    await sweepOnce(c, [GOOD]);

    const payload = records(c)[0]?.payload ?? {};
    expect(payload["blind"]).toBe(true);
    expect(payload["shown"]).toBe(0);
    expect(payload["candidates"]).toBe(0);
    expect(payload["shownLexicalOnly"]).toBe(0);
    expect(payload["shownSemanticOnly"]).toBe(0);
    expect(payload["shownBoth"]).toBe(0);
    // A zero under `skipped` is NEVER-ASKED, not "the channel found nothing"
    // (scar §2.4). The state is what tells the two apart, and it travels.
    expect(payload["semanticState"]).toBe("skipped");
    expect(payload["shownIds"]).toEqual([]);
    // Channel records travel whole: name, state, reason.
    const channels = payload["channels"] as { channel: string; state: string; reason: string }[];
    expect(channels.length).toBeGreaterThan(0);
    for (const ch of channels) {
      expect(typeof ch.channel).toBe("string");
      expect(["ran", "off", "skipped"]).toContain(ch.state);
      expect(ch.reason.length).toBeGreaterThan(0);
    }
  });

  test("novelty is null WITH A REASON when the chunk was shown nothing (scar §2.9)", async () => {
    const c = brain();
    await sweepOnce(c, [GOOD]);
    const payload = records(c)[0]?.payload ?? {};
    expect(payload["novelty"]).toBe(null);
    expect(typeof payload["noveltyReason"]).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Content-by-reference, replay idempotence, and the observer
// ═══════════════════════════════════════════════════════════════════════════
describe("the log stays telemetry: no text, one row per crossing, nothing under observer", () => {
  test("NO span text and NO proposal text reaches the durable log, anywhere", async () => {
    const c = brain();
    await sweepOnce(c, [
      GOOD,
      { content: "placeholder", kind: "fact" },
      {
        content: `${PROPOSAL_MARKER} An aliased claim about the storage split that carries a title.`,
        kind: "fact",
        title: `${PROPOSAL_MARKER} storage split`,
        aliases: [`${PROPOSAL_MARKER} the split`],
      },
    ]);

    const whole = JSON.stringify(c.store.eventLog({ limit: 1000 }));
    expect(whole).not.toContain(SPAN_MARKER);
    expect(whole).not.toContain(PROPOSAL_MARKER);
    // …and the record is genuinely there, so the assertion above is not vacuous.
    expect(records(c).length).toBe(1);
  });

  test("a REPLAYED day appends nothing a second time (the dedup latch, sleep §5 G3)", async () => {
    const c = brain();
    await sweepOnce(c, [GOOD], "s1");
    const first = records(c);
    expect(first.length).toBe(1);
    const key = first[0]?.payload["chunkKey"] as string;
    const day = first[0]?.day as number;

    // The latch, exercised DIRECTLY rather than by re-running a sweep whose
    // spans the buffer has already consumed — a second sweep that claims
    // nothing would never reach the append at all, and the test would pass
    // having proved nothing. `appendEvent` returns 0 when the latch refuses.
    expect(
      c.store.appendEvent({
        name: "gate.chunk",
        day,
        ref: key,
        dedupKey: `gate.chunk:${key}:${day}`,
        payload: { chunkKey: key, replayed: true },
      }),
    ).toBe(0);
    expect(records(c).length).toBe(1);
    // And the FIRST write is what stands: the replay did not overwrite it.
    expect(records(c)[0]?.payload["replayed"]).toBeUndefined();
    expect(records(c)[0]?.payload["accepted"]).toBe(1);
  });

  test("a DIFFERENT chunk is a different key, so the latch is not a blanket", async () => {
    const c = brain();
    await sweepOnce(c, [GOOD], "s1");
    c.captureSpans({
      session: "s2",
      scope: "proj",
      turns: [
        {
          role: "user" as const,
          text:
            `${SPAN_MARKER} A different conversation entirely, about the lived-day clock: decay and gisting run on days actually ` +
            "lived, never on calendar days, so a week away must not decay a week's worth of memory. The rule is small and the " +
            "consequence is large, which is why it sits in physics rather than in whoever happens to call it.",
        },
      ],
    });
    c.boundary({ session: "s2", scope: "proj", kind: "stop" });
    await c.sweepFallback({ interpret: interpreter([GOOD]) });

    const rows = records(c);
    expect(rows.length).toBe(2);
    expect(rows[0]?.payload["chunkKey"]).not.toBe(rows[1]?.payload["chunkKey"]);
  });

  test("an OBSERVER records nothing — the instrument leaves the store as it found it", async () => {
    const c = brain({ observer: true });
    await sweepOnce(c, [GOOD]);
    expect(records(c)).toEqual([]);
    expect(c.store.list({ type: "memory" })).toEqual([]);
  });
});

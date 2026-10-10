/**
 * The sidebar mod keeps its own copy of the dashboard's table of which events
 * prove which mechanism. A hooks module reaches nothing outside its plugin
 * folder, so `hooks/sidebar/hooks/feed.ts` (`RULES`) copies
 * `src/adapters/mechanism-evidence.ts` (`MECHANISM_EVIDENCE`) rather than
 * importing it. This fails when the copy drifts.
 *
 * Why it exists (2026-10-10): the copy gave each event ONE mechanism, while
 * core's table lets one event prove several. So Emotion (a mood-matched
 * `recall.decision`) and Gist (a `dream.changed` with a gist) never lit in
 * the sidebar, and Interference and Consolidation missed a dream's merges.
 *
 * In scope: the event proofs of every built or partly built mechanism, by
 * name and by payload. Out of scope:
 *   - census-only evidence (emotion's lift, consolidation's returns, dreaming's
 *     reflections): arithmetic on the store, no event, so no ACTIVITY row can
 *     show it;
 *   - `stands` (a dream or a settle undone no longer counts): read against
 *     the store, and an `/api/activity` row carries no mark that it was undone.
 *
 * Why a dynamic import: feed.ts is a hooks module's source, written for the
 * engine's loader (extensionless imports, a contract `.d.ts` that augments the
 * engine's `claude-code` module) and type-checked by `tsc -p hooks/sidebar`.
 * A static import would pull it into this repository's NodeNext `tsc` and
 * fail there. A specifier tsc can't follow keeps it out of that program; bun
 * loads it as it is. The two small types below are all this file relies on.
 */
import { describe, expect, test } from "bun:test";
import { MECHANISM_EVIDENCE, amount } from "../src/adapters/mechanism-evidence.js";
import type { Payload, Proof } from "../src/adapters/mechanism-evidence.js";

type DashEvent = { seq: number; at: number; name: string; text: string; detail: { key: string; value: string }[] };
type Feed = {
  RULES: readonly { name: string; mech: string }[];
  classify: (e: DashEvent) => { mech: string; mechs: string[] } | null;
};
type Mechanisms = { MECHS: readonly { id: string; notBuilt?: true }[] };

const FEED: string = "../hooks/sidebar/hooks/feed.ts";
const MECHANISMS: string = "../hooks/sidebar/hooks/mechanisms.ts";
const feed = (await import(FEED)) as Feed;
const { MECHS } = (await import(MECHANISMS)) as Mechanisms;

const BUILT = MECHANISM_EVIDENCE.filter((m) => m.build !== "not");
const PROOFS = BUILT.flatMap((m) => m.proofs.map((proof) => ({ mech: m.id, proof })));

/**
 * A payload core counts, for each proof with a condition (`where`) the test
 * can't guess. A proof that sums a field gets that field at 1; one with
 * neither counts an empty payload.
 */
const SAMPLES: Readonly<Record<string, Payload>> = {
  "decay.faded": { site: "decay", direction: "down" },
  "interference.faded": { how: "changed" },
  "retrieval.turns": { surfacedCount: 1, footnoteCount: 0 },
  "consolidation.rose": { site: "consolidate", direction: "up" },
};

function sampleFor(mech: string, proof: Proof): Payload | null {
  const given = SAMPLES[`${mech}.${proof.key}`];
  if (given !== undefined) return given;
  if (proof.where !== undefined) return null;
  return proof.sum === undefined ? {} : { [proof.sum]: 1 };
}

/** Mixed and refused payloads besides the samples: several proofs at once, and rows that prove nothing. */
const MORE: readonly { event: string; payload: Payload }[] = [
  { event: "dream.changed", payload: { applied: 49, merge: 1, gist: 2, link: 20, "nominate-core": 2 } },
  { event: "dream.changed", payload: { applied: 0, refused: 8 } },
  { event: "dream.changed", payload: { "nominate-core": 1 } },
  { event: "recall.decision", payload: { surfacedCount: 2, footnoteCount: 1, moodMatched: 1 } },
  { event: "recall.decision", payload: { surfacedCount: 0, footnoteCount: 0, moodMatched: 0 } },
  { event: "band.transition", payload: { site: "decay", direction: "up" } }, // the crossing into identity, not a fade
  { event: "contradiction.settled", payload: { how: "open" } },
  { event: "contradiction.settled", payload: { how: "corrected" } }, // live beside "changed" (2 of 50 on 2026-10-10)
  { event: "associate.flush", payload: { rows: 0, pairs: 0 } },
  { event: "gate.deposit", payload: { accepted: 0 } },
];

/** What core says a row of `event` with `payload` proves. */
function coreProves(event: string, payload: Payload): string[] {
  return [...new Set(PROOFS.filter(({ proof }) => proof.event === event && amount(proof, payload) > 0).map(({ mech }) => mech))].sort();
}

/** What the sidebar lights for the same row, as `/api/activity` narrates it (detail values as strings). */
function sidebarLights(event: string, payload: Payload): string[] {
  const detail = Object.entries(payload).map(([key, v]) => ({ key, value: typeof v === "string" ? v : JSON.stringify(v) }));
  const row = feed.classify({ seq: 1, at: 0, name: event, text: "", detail });
  return row === null ? [] : [...new Set(row.mechs)].sort();
}

describe("the sidebar's copy of MECHANISM_EVIDENCE", () => {
  test("every event core proves a built or partly built mechanism from, the sidebar maps to that mechanism", () => {
    const missing = PROOFS.filter(({ mech, proof }) => !feed.RULES.some((r) => r.name === proof.event && r.mech === mech)).map(
      ({ mech, proof }) => `${proof.event} → ${mech} (core proof "${proof.key}")`,
    );
    expect(missing).toEqual([]);
  });

  test("every event-to-mechanism rule the sidebar keeps is a proof core makes", () => {
    const extra = feed.RULES.filter((r) => !PROOFS.some(({ mech, proof }) => proof.event === r.name && mech === r.mech)).map(
      (r) => `${r.name} → ${r.mech}`,
    );
    expect(extra).toEqual([]);
  });

  test("by payload: a row lights exactly the mechanisms core says it proves", () => {
    const unsampled: string[] = [];
    const cases: { event: string; payload: Payload }[] = [...MORE];
    for (const { mech, proof } of PROOFS) {
      const payload = sampleFor(mech, proof);
      if (payload === null) {
        unsampled.push(`${mech}.${proof.key}: add a payload core counts to SAMPLES`);
        continue;
      }
      // The sample must be one core counts, or it checks nothing.
      expect({ proof: `${mech}.${proof.key}`, counted: amount(proof, payload) > 0 }).toEqual({ proof: `${mech}.${proof.key}`, counted: true });
      cases.push({ event: proof.event, payload });
    }
    for (const event of new Set(PROOFS.map(({ proof }) => proof.event))) cases.push({ event, payload: {} });
    expect(unsampled).toEqual([]);
    const disagree = cases
      .map(({ event, payload }) => ({ event, payload, core: coreProves(event, payload), sidebar: sidebarLights(event, payload) }))
      .filter((c) => c.core.join() !== c.sidebar.join());
    expect(disagree).toEqual([]);
  });

  test("the twelve mechanisms in core's order and ids, with the one not built drawn hollow", () => {
    expect(MECHS.map((m) => m.id)).toEqual(MECHANISM_EVIDENCE.map((m) => m.id));
    expect(MECHS.filter((m) => m.notBuilt === true).map((m) => m.id)).toEqual(
      MECHANISM_EVIDENCE.filter((m) => m.build === "not").map((m) => m.id),
    );
  });
});

/**
 * FOLDING, GROUP 3 PART B (2026-10-11; item 15, review 11, D6).
 *
 *   - a fold is a dream gist flagged `fold: true`, written THROUGH the one
 *     door: the fold holds `changed` over each part (source `fold`), the part
 *     fades x0.5, stays live and is labelled earlier under it;
 *   - readings, felt memories, the core (and dated ones, a dream's own words,
 *     earlier versions) are kept at their own weight, still cited;
 *   - the fold starts at its sources' strength (at most 0.6), at most 5 a
 *     night, the overflow counted and said;
 *   - the dream picks its kind, and it inherits the me/us mark by "personal
 *     wins"; a heavily used personal fold crosses into the core by the slow lane;
 *   - a correction to a source flags the folds made from it;
 *   - ride-along: a settle reorders only the pair it names.
 *
 * Hermetic: every test opens its own temp store and removes it. No model is
 * called: the "dreamer" is the test, calling the module as the MCP tool does.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Dashboard } from "../src/adapters/dashboard/index.js";
import { dreamsView } from "../src/adapters/dashboard/web/views/dreams.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_TUNABLES } from "../src/core/dream/index.js";
import { TUNABLES as PHYSICS, strength } from "../src/core/physics/index.js";
import { headOf, standingOf } from "../src/core/recall/index.js";
import { FOLD_SOURCE, FOLD_SOURCE_CORRECTED, proposeSlot, settle, undo } from "../src/core/reconsolidation.js";
import { settledOver } from "../src/core/self/index.js";
import { coreRecurrence, runCycle, slotOf } from "../src/core/sleep/index.js";
import type { PutInput } from "../src/core/store/index.js";
import { LEGACY_SLOT_FADE, useSlotFade } from "./slot-fade-fixture.js";

let dir: string;
const open: Counterpart[] = [];
let dateN = 0;

beforeEach(() => {
  dateN = 0;
  dir = mkdtempSync(join(tmpdir(), "counterparts-dream-fold-"));
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

const SESSION = "s-dream";
const PROVISIONAL = LEGACY_SLOT_FADE;
// The provisional cut's arithmetic, at the cut a revert restores (flag only since 2026-10-19).
useSlotFade(LEGACY_SLOT_FADE);

function brain(): Counterpart {
  const c = Counterpart.open({ dir, identity: { name: "Mike" }, now: () => Date.now() + dateN * 86_400_000 });
  open.push(c);
  return c;
}
function date(n: number): string {
  return new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString().slice(0, 10);
}
function nextDay(c: Counterpart): number {
  dateN += 1;
  c.store.advanceClock(date(dateN));
  return c.store.livedDay();
}
function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    about: "work",
    body,
    salience: { relevance: 0.5, emotional: 0.1, predictive: 0.5 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  } as PutInput);
}
function begin(c: Counterpart): string {
  const out = c.dreams.begin({ session: SESSION, scope: "/proj" });
  if (!out.ok) throw new Error(`begin refused: ${out.reason}`);
  return out.bundle.dream;
}
function propose(c: Counterpart, dream: string, changes: Record<string, unknown>[]) {
  const out = c.dreams.propose({ dream, session: SESSION, changes: changes as never });
  if (!out.ok) throw new Error(`propose refused: ${out.reason}`);
  return out.results;
}
function fadeOf(c: Counterpart, id: string): number {
  return c.store.row(id)?.fade ?? 1;
}

/** A lived day behind, then a release day's three work events. */
function releaseDay(c: Counterpart): { a: string; b: string; d: string } {
  nextDay(c);
  nextDay(c);
  const a = mem(c, "Merged the sidebar pull request after the second review round.");
  const b = mem(c, "Published version 0.3.15 with the sidebar mod in it.");
  const d = mem(c, "Installed 0.3.15 on the live machine; doctor came back green.");
  return { a, b, d };
}

describe("a fold goes through the one door", () => {
  test("the fold holds `changed` over each part: faded x0.5, still live, earlier under it; it starts at its parts' strength", () => {
    const c = brain();
    const m = releaseDay(c);
    const day = c.store.livedDay();
    const before = Math.max(...[m.a, m.b, m.d].map((id) => strength(c.store.physicsOf(id), day)));
    const dream = begin(c);
    const [r] = propose(c, dream, [
      { action: "gist", fold: true, kind: "fact", title: "0.3.15 shipped with the sidebar", text: "The sidebar mod shipped in 0.3.15 and runs on the live machine.", sources: [m.a, m.b, m.d] },
    ]);
    expect(r).toMatchObject({ ok: true, reason: "folded" });
    const fold = r?.id as string;
    const row = c.store.row(fold)!;
    expect(row.source).toBe("dreamed");
    // Its own title, no "Dreamed:" prefix; `meta.fold` and `meta.sources` keep where it came from.
    expect(row.title).toBe("0.3.15 shipped with the sidebar");
    const meta = JSON.parse(row.meta ?? "{}") as Record<string, unknown>;
    expect(meta["fold"]).toBe(true);
    expect(meta["sources"]).toEqual([m.a, m.b, m.d]);
    // Its strength: the strongest part's, held to [0.3, 0.6].
    const claimed = c.store.physicsOf(fold).salience.claimed ?? 0;
    expect(claimed).toBeCloseTo(Math.min(PHYSICS.FOLD_CLAIM_CEILING, Math.max(PHYSICS.DREAMED_CLAIM_CEILING, before)), 2);
    expect(claimed).toBeGreaterThan(PHYSICS.DREAMED_CLAIM_CEILING);
    for (const id of [m.a, m.b, m.d]) {
      const pair = c.store.contradictionBetween(fold, id);
      expect(pair).toMatchObject({ state: "settled", how: "changed", holds: fold, over: id, source: FOLD_SOURCE });
      expect(fadeOf(c, id)).toBeCloseTo(0.5, 6);
      expect(c.store.row(id)?.archived).toBe(0);
      expect(headOf(c.store, id)).toBe(fold);
      expect(standingOf(c.store, id)?.prefix).toBe(`Earlier (now [${fold}]): `);
    }
    // The parts are in the fold's slot, so their settled uses count for it.
    expect(slotOf(c.store, fold).sort()).toEqual([fold, m.a, m.b, m.d].sort());
    // "Which folds came from X" is a query over meta.sources.
    expect(c.store.foldsCiting(m.b)).toEqual([fold]);
    // Counted as a fold, not as a pattern.
    expect(c.dreams.counts(dream)).toMatchObject({ fold: 1 });
    expect(c.dreams.counts(dream)["gist"]).toBeUndefined();
  });

  test("a part kept at its own weight does not lift the fold's start: weak work beside a core memory starts at the floor", () => {
    const c = brain();
    nextDay(c);
    // Weak, yet still within reach tonight: a memory below reach is not queued (Group 3 part C).
    const weak = { salience: { relevance: 0.25, emotional: 0, predictive: 0.25 } } as Partial<PutInput>;
    const w1 = mem(c, "Renamed a helper in the benchmark script.", weak);
    const w2 = mem(c, "Fixed a typo in the benchmark README.", weak);
    const core = mem(c, "I check a number before I trust it.", { kind: "self", about: "me" });
    c.store.updatePhysics(core, { promotedIdentity: true });
    c.store.setBand(core, "identity", c.store.livedDay());
    nextDay(c);
    const day = c.store.livedDay();
    const workMax = Math.max(strength(c.store.physicsOf(w1), day), strength(c.store.physicsOf(w2), day));
    expect(strength(c.store.physicsOf(core), day)).toBeGreaterThan(PHYSICS.DREAMED_CLAIM_CEILING + 0.1);
    expect(workMax).toBeLessThan(PHYSICS.DREAMED_CLAIM_CEILING);
    const dream = begin(c);
    const [r] = propose(c, dream, [{ action: "gist", fold: true, text: "The benchmark got its small cleanups.", sources: [w1, w2, core] }]);
    expect(r?.ok).toBe(true);
    expect(c.store.physicsOf(r?.id as string).salience.claimed).toBe(PHYSICS.DREAMED_CLAIM_CEILING);
  });

  test("the dashboard's dreams page counts a fold as a fold and says what it did", () => {
    const c = brain();
    const m = releaseDay(c);
    const dream = begin(c);
    propose(c, dream, [
      { action: "gist", fold: true, text: "0.3.15 shipped.", sources: [m.a, m.b, m.d] },
      { action: "gist", text: "Releases go smoother in rounds.", sources: [m.a, m.b] },
    ]);
    c.close();
    open.splice(open.indexOf(c), 1);
    const dash = Dashboard.open({ dir });
    try {
      const v = dreamsView(dash.source).dreams.find((d) => d.id === dream);
      expect(v?.counts).toMatchObject({ fold: 1, gist: 1 });
      expect(v?.changes.find((x) => x.said.startsWith("folded"))?.said).toBe("folded 3 memories into what they add up to (3 faded under it)");
    } finally {
      dash.close();
    }
  });

  test("an insight gist is unchanged: 0.3, `Dreamed:`, its sources untouched", () => {
    const c = brain();
    const m = releaseDay(c);
    const dream = begin(c);
    const [r] = propose(c, dream, [{ action: "gist", text: "Shipping goes smoother when the review is done in rounds.", sources: [m.a, m.b] }]);
    expect(r).toMatchObject({ ok: true, reason: "dreamed" });
    expect(c.store.row(r?.id as string)?.title?.startsWith("Dreamed: ")).toBe(true);
    expect(c.store.physicsOf(r?.id as string).salience.claimed).toBe(PHYSICS.DREAMED_CLAIM_CEILING);
    expect(fadeOf(c, m.a)).toBe(1);
    expect(c.store.contradictionBetween(r?.id as string, m.a)).toBeUndefined();
  });

  test("a fold takes two or more parts", () => {
    const c = brain();
    const m = releaseDay(c);
    const dream = begin(c);
    const [r] = propose(c, dream, [{ action: "gist", fold: true, text: "Merged it.", sources: [m.a] }]);
    expect(r).toMatchObject({ ok: false, reason: "fold-takes-two-or-more" });
  });

  test("a part's open question stays open: a fold answers none of them", () => {
    const c = brain();
    const m = releaseDay(c);
    const other = mem(c, "The sidebar pull request is still waiting on its second review.");
    const dream = begin(c);
    const results = propose(c, dream, [{ action: "contradiction", a: other, b: m.a }, { action: "gist", fold: true, text: "The sidebar shipped.", sources: [m.a, m.b] }]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(c.store.contradictionBetween(other, m.a)?.state).toBe("unsettled");
  });
});

describe("what a fold keeps at its own weight", () => {
  test("a reading, a strongly felt person memory, the core and a dated memory are cited and tied, never faded or settled", () => {
    const c = brain();
    nextDay(c);
    nextDay(c);
    const plain = mem(c, "Read three chapters of the Essays tonight.");
    const reading = mem(c, "\"Have you not lived? That is not only the fundamental but the most illustrious of your occupations.\"", { title: "Reading: Of Experience, a line" });
    const felt = mem(c, "Mike read me the last page of Of Experience late at night; he was quietly moved.", { kind: "person", about: "us" });
    c.store.addFeelings(felt, [{ whose: "self", core: "warm", emotion: "tender", strength: 0.6 }]);
    // A mild feeling on a routine memory does not keep it out (review 11 C3: felt self/person memories).
    const mild = mem(c, "Ordered the second volume of the Essays.");
    c.store.addFeelings(mild, [{ whose: "self", core: "calm", emotion: "content", strength: 0.3 }]);
    const core = mem(c, "I read slowly when a book bites.", { kind: "self", about: "me" });
    c.store.updatePhysics(core, { promotedIdentity: true });
    c.store.setBand(core, "identity", c.store.livedDay());
    const dated = mem(c, "Finish the Essays by the end of the month.", { eventDate: "2099-12-31" } as Partial<PutInput>);
    const dream = begin(c);
    const [r] = propose(c, dream, [
      { action: "gist", fold: true, kind: "fact", text: "The evening went to Montaigne's Of Experience.", sources: [plain, reading, felt, core, dated, mild] },
    ]);
    expect(r?.ok).toBe(true);
    const fold = r?.id as string;
    expect(r?.note).toContain("not faded");
    expect(fadeOf(c, plain)).toBeCloseTo(0.5, 6);
    expect(fadeOf(c, mild)).toBeCloseTo(0.5, 6);
    for (const id of [reading, felt, core, dated]) {
      expect(fadeOf(c, id)).toBe(1);
      expect(c.store.contradictionBetween(fold, id)).toBeUndefined();
      expect(headOf(c.store, id)).toBeNull();
    }
    // The core stays the core.
    expect(c.store.row(core)?.promoted_identity).toBe(1);
    // The reminder stays where it was.
    expect(c.store.row(dated)?.event_date).toBe("2099-12-31");
    // All six are still its sources.
    expect(JSON.parse(c.store.row(fold)?.meta ?? "{}")["sources"]).toEqual([plain, reading, felt, core, dated, mild]);
    const change = c.dreams.show(dream)?.changes.find((x) => x.action === "gist");
    const detail = JSON.parse(change?.detail ?? "{}") as { faded: string[]; exempt: { id: string; why: string }[] };
    expect(detail.faded).toEqual([plain, mild]);
    expect(Object.fromEntries(detail.exempt.map((e) => [e.id, e.why]))).toEqual({ [reading]: "reading", [felt]: "felt", [core]: "core", [dated]: "dated" });
  });

  test("an earlier version is not settled under the fold: it keeps its head", () => {
    const c = brain();
    nextDay(c);
    nextDay(c);
    const old = mem(c, "The release is planned for Thursday.");
    const now = mem(c, "The release moved to Friday.");
    expect(settle(c.store, { holds: now, over: old, how: "changed", actor: "owner" }).ok).toBe(true);
    const other = mem(c, "The release notes are drafted.");
    const dream = begin(c);
    const [r] = propose(c, dream, [{ action: "gist", fold: true, text: "The release is ready for Friday.", sources: [old, now, other] }]);
    const fold = r?.id as string;
    expect(headOf(c.store, old)).toBe(fold); // through `now`, which the fold holds over
    expect(c.store.contradictionBetween(fold, old)).toBeUndefined();
    expect(c.store.contradictionBetween(fold, now)?.source).toBe(FOLD_SOURCE);
  });
});

describe("the fold's kind and mark", () => {
  test("the dream picks the kind; the mark is me/us only when most of its parts are (random-06's ruling)", () => {
    const c = brain();
    nextDay(c);
    nextDay(c);
    const work = mem(c, "Spent the morning on the benchmark rebuild.");
    const me = mem(c, "I stop and say so when a number looks too good.", { kind: "self", about: "me" });
    const me2 = mem(c, "I asked what the benchmark measured before I read its score.", { kind: "self", about: "me" });
    const dream = begin(c);
    const [r] = propose(c, dream, [{ action: "gist", fold: true, kind: "self", text: "I check a good number before I trust it.", sources: [work, me, me2] }]);
    const row = c.store.row(r?.id as string)!;
    expect(row.kind).toBe("self");
    expect(row.about).toBe("me");
  });

  test("a work cluster with one `us` part stays work; a tie is not personal", () => {
    const c = brain();
    nextDay(c);
    nextDay(c);
    const w1 = mem(c, "Merged the cards pull request after review.");
    const w2 = mem(c, "Published the release with the cards fix.");
    const w3 = mem(c, "Installed it on the live machine; doctor green.");
    const us = mem(c, "Mike and I agreed to ship cards before folding.", { kind: "entity", about: "us" });
    const dream = begin(c);
    const [r1, r2] = propose(c, dream, [
      { action: "gist", fold: true, kind: "fact", text: "The cards fix shipped and runs live.", sources: [w1, w2, w3, us] },
      { action: "gist", fold: true, kind: "fact", text: "We shipped cards first.", sources: [w1, us] },
    ]);
    expect(c.store.row(r1?.id as string)?.about).toBe("work");
    expect(c.store.row(r2?.id as string)?.about).toBe("work");
    // An insight gist keeps "personal wins".
    const [g] = propose(c, dream, [{ action: "gist", text: "Shipping in a set order keeps us calm.", sources: [w2, us] }]);
    expect(c.store.row(g?.id as string)?.about).toBe("us");
  });
});

describe("five folds a night, the overflow counted", () => {
  test("a sixth fold is refused and counted; the insight gists keep their own three", () => {
    const c = brain();
    nextDay(c);
    nextDay(c);
    const ids = Array.from({ length: 14 }, (_, i) => mem(c, `Release step ${String(i)} of the week went through without a hitch number ${String(i)}.`));
    const dream = begin(c);
    const folds = Array.from({ length: DREAM_TUNABLES.FOLDS + 1 }, (_, i) => ({ action: "gist", fold: true, text: `Stretch ${String(i)} shipped.`, sources: [ids[2 * i], ids[2 * i + 1]] }));
    const results = propose(c, dream, [...folds, { action: "gist", text: "Steps go through when they are small.", sources: [ids[12], ids[13]] }]);
    expect(results.slice(0, DREAM_TUNABLES.FOLDS).every((r) => r.ok && r.reason === "folded")).toBe(true);
    expect(results[DREAM_TUNABLES.FOLDS]).toMatchObject({ ok: false, reason: "limit-reached" });
    expect(results[DREAM_TUNABLES.FOLDS + 1]).toMatchObject({ ok: true, reason: "dreamed" });
    // The overflow's parts wait as they are.
    expect(fadeOf(c, ids[10] as string)).toBe(1);
    const changed = c.store.eventLog({ name: "dream.changed", ref: dream });
    const payload = JSON.parse(changed[changed.length - 1]?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["foldOverflow"]).toBe(1);
    expect(payload["fold"]).toBe(DREAM_TUNABLES.FOLDS);
    expect(payload["gist"]).toBe(1);
    const journaled = c.dreams.journal({ dream, session: SESSION, title: "A week of releases", text: "I folded the week." });
    expect(journaled.ok).toBe(true);
    const back = c.dreams.handBackOf(dream) ?? "";
    expect(back).toContain("1 more fold was past the night's 5");
  });
});

describe("undo", () => {
  test("a dream's undo puts each part's strength back, withdraws the pairs and archives the fold", () => {
    const c = brain();
    const m = releaseDay(c);
    const dream = begin(c);
    const [r] = propose(c, dream, [{ action: "gist", fold: true, text: "0.3.15 shipped.", sources: [m.a, m.b, m.d] }]);
    const fold = r?.id as string;
    expect(c.dreams.undo(dream)).toMatchObject({ ok: true, kept: 0 });
    expect(c.store.row(fold)?.archived).toBe(1);
    for (const id of [m.a, m.b, m.d]) {
      expect(fadeOf(c, id)).toBeCloseTo(1, 6);
      expect(c.store.contradictionBetween(fold, id)).toBeUndefined();
      expect(headOf(c.store, id)).toBeNull();
    }
  });
});

describe("undo with a slot proposal under the fold (stacking)", () => {
  /** X with a pending slot proposal (Y the newer state of X, X cut x0.8), folded with Z, then the slot confirmed. */
  function stacked(c: Counterpart): { x: string; pair: string; dream: string } {
    nextDay(c);
    nextDay(c);
    const x = mem(c, "The release is planned for Thursday.");
    const y = mem(c, "The release is planned for Friday now.");
    const z = mem(c, "The release notes are drafted.");
    const slot = proposeSlot(c.store, { holds: y, candidate: { over: x, cosine: 0.9, rule: "cosine", sameSession: false } });
    if (!slot.ok) throw new Error(slot.reason);
    expect(fadeOf(c, x)).toBeCloseTo(PROVISIONAL, 9);
    const dream = begin(c);
    const [r] = propose(c, dream, [{ action: "gist", fold: true, text: "The release is ready.", sources: [x, z] }]);
    expect(r?.ok).toBe(true);
    expect(fadeOf(c, x)).toBeCloseTo(PROVISIONAL * 0.5, 9);
    // Confirmed: the provisional cut is lifted, the confirmed cut lands on the fold's.
    const ok = settle(c.store, { pair: slot.pair, holds: y, how: "changed", actor: "session" });
    expect(ok.ok).toBe(true);
    expect(fadeOf(c, x)).toBeCloseTo(0.25, 9);
    return { x, pair: slot.pair, dream };
  }

  test("fold undone first, then the confirmation: X is back at its provisional cut, exactly", () => {
    const c = brain();
    const { x, pair, dream } = stacked(c);
    expect(c.dreams.undo(dream).ok).toBe(true);
    expect(fadeOf(c, x)).toBeCloseTo(0.5, 9);
    expect(undo(c.store, { pair, actor: "owner" }).ok).toBe(true);
    expect(fadeOf(c, x)).toBeCloseTo(PROVISIONAL, 9);
    expect(undo(c.store, { pair, actor: "owner" }).ok).toBe(true); // the proposal withdrawn
    expect(fadeOf(c, x)).toBe(1);
  });

  test("the confirmation undone first, then the fold: the same, exactly", () => {
    const c = brain();
    const { x, pair, dream } = stacked(c);
    expect(undo(c.store, { pair, actor: "owner" }).ok).toBe(true);
    expect(fadeOf(c, x)).toBeCloseTo(PROVISIONAL * 0.5, 9);
    expect(c.dreams.undo(dream).ok).toBe(true);
    expect(fadeOf(c, x)).toBeCloseTo(PROVISIONAL, 9);
  });
});

describe("a correction to a source flags the folds made from it", () => {
  test("flagged beside the corrector, unsettled; the correction's undo withdraws the flag", () => {
    const c = brain();
    const m = releaseDay(c);
    const dream = begin(c);
    const [r] = propose(c, dream, [{ action: "gist", fold: true, text: "0.3.15 shipped and runs on the live machine.", sources: [m.a, m.b, m.d] }]);
    const fold = r?.id as string;
    nextDay(c);
    const right = mem(c, "The live install was 0.3.14, not 0.3.15: the upgrade waits for tomorrow.");
    const out = settle(c.store, { holds: right, over: m.d, how: "corrected", actor: "session", why: "misread the version" });
    expect(out.ok).toBe(true);
    const flag = c.store.contradictionBetween(fold, right);
    expect(flag).toMatchObject({ state: "unsettled", source: FOLD_SOURCE_CORRECTED, a: fold });
    // The fold reads as possibly out of date.
    expect(standingOf(c.store, fold)?.prefix).toContain(`Unsettled — may be out of date, see [${right}]`);
    if (!out.ok) return;
    expect(undo(c.store, { pair: out.pair, actor: "owner" }).ok).toBe(true);
    expect(c.store.contradiction(flag?.id as string)?.state).toBe("withdrawn");
  });
});

describe("fold → core is open in practice (D6), by recurrence after the fold (random-06's ruling)", () => {
  /** Four personal memories, by four sessions, over six lived days, folded into one `self`/me fold. */
  function personalFold(c: Counterpart): { fold: string; parts: string[] } {
    nextDay(c);
    const personal = { kind: "self", about: "me", salience: { relevance: 0.7, emotional: 0.1, predictive: 0.6 } } as Partial<PutInput>;
    const s1 = mem(c, "I say when I am not sure before I guess.", { ...personal, origin: { session: "s1" } });
    nextDay(c);
    nextDay(c);
    const s2 = mem(c, "I told Mike plainly I did not know the answer yet.", { ...personal, origin: { session: "s2" } });
    nextDay(c);
    nextDay(c);
    const s3 = mem(c, "I flagged my own guess as a guess in the review.", { ...personal, origin: { session: "s3" } });
    nextDay(c);
    const s4 = mem(c, "I asked before assuming what the benchmark measured.", { ...personal, origin: { session: "s4" } });
    // Each part used awake before the fold: none of it is recurrence of the fold.
    for (const [i, p] of [s1, s2, s3, s4].entries()) c.resolveUse(`pre${String(i)}`, p, "referenced");
    const dream = begin(c);
    const [r] = propose(c, dream, [{ action: "gist", fold: true, kind: "self", text: "I say what I do not know before I guess: it has held all week.", sources: [s1, s2, s3, s4] }]);
    expect(r).toMatchObject({ ok: true, reason: "folded" });
    const fold = r?.id as string;
    expect(c.store.row(fold)).toMatchObject({ kind: "self", about: "me" });
    return { fold, parts: [s1, s2, s3, s4] };
  }

  test("its parts' births and pre-fold uses do not cross it, even with one use of its own", () => {
    const c = brain();
    const { fold } = personalFold(c);
    nextDay(c);
    expect(coreRecurrence(c.store, fold, c.store.livedDay())).toMatchObject({ anchored: false, days: 0 });
    expect(c.resolveUse("s5", fold, "referenced").credited).toBe(true);
    const rec = coreRecurrence(c.store, fold, c.store.livedDay());
    expect(rec).toMatchObject({ anchored: true, days: 1, sessions: 1 });
    const crossed = runCycle({ store: c.store, date: date(++dateN), cadence: { consolidate: 1 } }).promoted;
    expect(crossed.map((p) => p.id)).not.toContain(fold);
  });

  test("a heavily used personal fold, its content coming back after the fold, crosses by the slow lane", () => {
    const c = brain();
    const { fold, parts } = personalFold(c);
    // Real awake uses after the fold, of it and of its parts, by three sessions over eight lived days.
    nextDay(c);
    expect(c.resolveUse("s5", fold, "referenced").credited).toBe(true);
    nextDay(c);
    nextDay(c);
    nextDay(c);
    expect(c.resolveUse("s6", parts[1] as string, "referenced").credited).toBe(true);
    nextDay(c);
    nextDay(c);
    expect(c.resolveUse("s6", fold, "referenced").credited).toBe(true);
    nextDay(c);
    nextDay(c);
    expect(c.resolveUse("s7", fold, "referenced").credited).toBe(true);
    const rec = coreRecurrence(c.store, fold, c.store.livedDay());
    expect(rec).toMatchObject({ anchored: true, days: 4, sessions: 3 });
    const crossed = runCycle({ store: c.store, date: date(++dateN), cadence: { consolidate: 1 } }).promoted;
    expect(crossed.map((p) => p.id)).toContain(fold);
    expect(crossed.find((p) => p.id === fold)?.lane).toBe("slow");
    // The parts stayed earlier under it, not core.
    for (const id of parts) expect(c.store.row(id)?.promoted_identity).toBe(0);
  });
});

describe("ride-along: a settle reorders only the pair it names (random-06)", () => {
  test("B over A made after C over B leaves B under C, and A's head is C", () => {
    const c = brain();
    nextDay(c);
    const a = mem(c, "The launch is planned for March.");
    const b = mem(c, "The launch moved to April.");
    const cc = mem(c, "The launch moved again, to May.");
    expect(settle(c.store, { holds: cc, over: b, how: "changed", actor: "owner" }).ok).toBe(true);
    nextDay(c);
    expect(settle(c.store, { holds: b, over: a, how: "changed", actor: "owner" }).ok).toBe(true);
    expect(headOf(c.store, b)).toBe(cc);
    expect(headOf(c.store, a)).toBe(cc);
    expect(settledOver(c.store).has(b)).toBe(true);
    expect(standingOf(c.store, b)?.prefix).toBe(`Earlier (now [${cc}]): `);
  });

  test("to make B current again, settle B over C: the pair it names is reordered (a session over a session's settle, the owner over his own)", () => {
    const cases: { first: "owner" | "session"; then: "owner" | "session" }[] = [
      { first: "session", then: "session" },
      { first: "owner", then: "owner" },
      { first: "session", then: "owner" },
    ];
    for (const { first, then } of cases) {
      const c = brain();
      nextDay(c);
      const a = mem(c, "The launch is planned for March.");
      const b = mem(c, "The launch moved to April.");
      const cc = mem(c, "The launch moved again, to May.");
      expect(settle(c.store, { holds: cc, over: b, how: "changed", actor: first }).ok).toBe(true);
      expect(settle(c.store, { holds: b, over: a, how: "changed", actor: "owner" }).ok).toBe(true);
      expect(fadeOf(c, b)).toBeCloseTo(0.5, 9);
      nextDay(c);
      const out = settle(c.store, { holds: b, over: cc, how: "changed", actor: then, why: "May fell through; April stands" });
      expect(out.ok).toBe(true);
      expect(out.ok ? out.note : "").toContain("reordered");
      // B's cut lifted, C's applied; B is the head again, C and A earlier under it.
      expect(fadeOf(c, b)).toBe(1);
      expect(fadeOf(c, cc)).toBeCloseTo(0.5, 9);
      expect(headOf(c.store, b)).toBeNull();
      expect(headOf(c.store, cc)).toBe(b);
      expect(headOf(c.store, a)).toBe(b);
      const over = settledOver(c.store);
      expect(over.has(b)).toBe(false);
      expect(over.has(cc)).toBe(true);
      expect(standingOf(c.store, cc)?.prefix).toBe(`Earlier (now [${b}]): `);
      // One standing pair between them, the new way round.
      expect(c.store.contradictionBetween(b, cc)).toMatchObject({ state: "settled", holds: b, over: cc });
      c.close();
      open.splice(open.indexOf(c), 1);
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "counterparts-dream-fold-"));
    }
  });

  test("a session may not reverse the owner's settle: refused, told he settled it and how he can change it", () => {
    const c = brain();
    nextDay(c);
    const b = mem(c, "The launch moved to April.");
    const cc = mem(c, "The launch moved again, to May.");
    const owned = settle(c.store, { holds: cc, over: b, how: "changed", actor: "owner" });
    expect(owned.ok).toBe(true);
    const out = settle(c.store, { holds: b, over: cc, how: "changed", actor: "session", why: "April stands" });
    expect(out).toMatchObject({ ok: false, reason: "already-settled" });
    const detail = out.ok ? "" : out.detail;
    expect(detail).toContain(`the owner settled ${cc} over ${b}`);
    expect(detail).toContain(`counterparts settle --holds ${b} --against ${cc}`);
    expect(detail).toContain("counterparts settle --undo");
    // Nothing moved.
    expect(fadeOf(c, b)).toBeCloseTo(0.5, 9);
    expect(fadeOf(c, cc)).toBe(1);
    expect(headOf(c.store, b)).toBe(cc);
    // A settle the owner undid is no longer his standing settle: a later session settle can be reversed by a session.
    if (owned.ok) expect(undo(c.store, { pair: owned.pair, actor: "owner" }).ok).toBe(true);
    expect(settle(c.store, { holds: cc, over: b, how: "changed", actor: "session" }).ok).toBe(true);
    expect(settle(c.store, { holds: b, over: cc, how: "changed", actor: "session" }).ok).toBe(true);
    expect(headOf(c.store, cc)).toBe(b);
  });

  test("a dream may not reorder a settle, and a corrected pair is not reordered: both are told which way it stands and what to do", () => {
    const c = brain();
    nextDay(c);
    const b = mem(c, "The launch moved to April.");
    const cc = mem(c, "The launch moved again, to May.");
    expect(settle(c.store, { holds: cc, over: b, how: "changed", actor: "session" }).ok).toBe(true);
    const dreamed = settle(c.store, { holds: b, over: cc, how: "changed", actor: "dream" });
    expect(dreamed).toMatchObject({ ok: false, reason: "already-settled" });
    expect(dreamed.ok ? "" : dreamed.detail).toContain(`${cc} holds over ${b}`);
    expect(dreamed.ok ? "" : dreamed.detail).toContain("tell the owner");
    expect(fadeOf(c, b)).toBeCloseTo(0.5, 9);
    const x = mem(c, "The venue holds 200.");
    const y = mem(c, "The venue holds 150.");
    expect(settle(c.store, { holds: y, over: x, how: "corrected", actor: "owner" }).ok).toBe(true);
    const back = settle(c.store, { holds: x, over: y, how: "changed", actor: "owner" });
    expect(back).toMatchObject({ ok: false, reason: "already-settled" });
    expect(back.ok ? "" : back.detail).toContain("Undo it first");
  });

  test("a fold's part that later holds over another stays earlier under the fold", () => {
    const c = brain();
    const m = releaseDay(c);
    const dream = begin(c);
    const [r] = propose(c, dream, [{ action: "gist", fold: true, text: "0.3.15 shipped.", sources: [m.a, m.b] }]);
    const fold = r?.id as string;
    nextDay(c);
    const older = mem(c, "Planned to publish 0.3.15 on Saturday.");
    expect(settle(c.store, { holds: m.b, over: older, how: "changed", actor: "owner" }).ok).toBe(true);
    expect(headOf(c.store, m.b)).toBe(fold);
    expect(headOf(c.store, older)).toBe(fold);
  });
});

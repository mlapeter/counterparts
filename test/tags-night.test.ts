/**
 * TAGS AT NIGHT (wave 2 lane B, second PR, 2026-10-21; design §1). Covered:
 *
 *   - the tags phase, after `births`: a card's name written as a tag on the
 *     memories linked to it (`via: card`, budgeted, never the identity
 *     core's), stem merges (`via: stem`), a merge whose words no memory
 *     carries let go, nothing under observer, nothing with `TAGS_NIGHT` off;
 *   - topic births (`Schemas#birthsFromTags`): the bar (memories, days,
 *     sessions), use and feeling lifting it, the stop list, a name already a
 *     card, the nightly limit, and the card's shape — no name, so recall's
 *     aliases are unchanged;
 *   - the tagging ask (`dream/tags.ts`): its bundle, its answer written as
 *     the night's (and refused by item), a "not the same" never asked again,
 *     and the whole night undone;
 *   - the dream tool's `tags` phase, and the night's third child;
 *   - the dream's intake is the same with tags present and the work done.
 *
 * Hermetic: a fresh temp dir per test, removed after. `TAGS_NIGHT` and the
 * topic numbers are set per test and put back.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { runNight, planNightChild } from "../src/adapters/claude-code/night-run.js";
import type { NightAnswer } from "../src/adapters/claude-code/night-run.js";
import { TUNABLES as ADAPTER } from "../src/adapters/config.js";
import { Counterpart, SEAT_TOOLS } from "../src/core/counterpart.js";
import type { Seat, SeatAsk } from "../src/core/counterpart.js";
import { applyTagsAnswer, tagsBundle, undoNightTags, TAGS_NIGHT_PREFIX } from "../src/core/dream/index.js";
import { TUNABLES as SCHEMAS, isStopTag, nightTagWork, stemKey, tallyTags } from "../src/core/schemas/index.js";
import { PHASES, phaseReport } from "../src/core/sleep/index.js";
import type { Store } from "../src/core/store/index.js";

let root: string;
let clock = Date.parse("2026-10-21T09:00:00Z");
const open: { close(): void }[] = [];
const saved = { ...SCHEMAS } as Record<string, unknown>;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-tags-night-")));
  clock = Date.parse("2026-10-21T09:00:00Z");
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  for (const [k, v] of Object.entries(saved)) (SCHEMAS as unknown as Record<string, unknown>)[k] = v;
  rmSync(root, { recursive: true, force: true });
});

function set(key: keyof typeof SCHEMAS, value: unknown): void {
  (SCHEMAS as unknown as Record<string, unknown>)[key] = value;
}

function brain(name = "store"): Counterpart {
  const c = Counterpart.open({ dir: join(root, name), snapshotsDir: join(root, `${name}-snaps`), now: () => clock, budgetBytes: 9_000 });
  open.push(c);
  return c;
}

let seq = 0;
/** A memory on lived day `day`, in session `session`, with tags. */
function mem(s: Store, body: string, opts: { day?: number; session?: string; tags?: string[]; title?: string } = {}): string {
  seq += 1;
  return s.put({
    type: "memory",
    kind: "fact",
    body: `${body} (${String(seq)})`,
    ...(opts.title === undefined ? {} : { title: opts.title }),
    origin: { session: opts.session ?? "s1", scope: "/proj/one" },
    physics: { birthDay: opts.day ?? 0, lastUsedDay: opts.day ?? 0 },
    ...(opts.tags === undefined ? {} : { tags: opts.tags }),
  });
}

function tagsOf(s: Store, id: string): string[] {
  return s.tagsOf(id).map((t) => `${t.tag}:${t.via}`);
}

describe("the tags phase", () => {
  test("runs right after births", () => {
    expect(PHASES.indexOf("tags")).toBe(PHASES.indexOf("births") + 1);
  });

  test("a linked card's name becomes a tag, never the identity core's; observer and budget", () => {
    const c = brain();
    const a = mem(c.store, "Wren fixed the gate hinge on Saturday.");
    const b = mem(c.store, "Wren and I planned the garden beds.", { tags: ["garden"] });
    c.schemas.mention({ name: "Wren", kind: "person", source: "Wren fixed the gate. Wren planned the beds.", chunkRef: "t:1", day: 0 });
    expect(c.store.subjectsOf(a).length).toBe(1);

    const dry = nightTagWork(c.store, { day: 1, apply: false, budget: 10 });
    expect(dry.cardTagged).toBe(2);
    expect(tagsOf(c.store, a)).toEqual([]);

    const one = nightTagWork(c.store, { day: 1, apply: true, budget: 1 });
    expect(one.cardTagged).toBe(1);
    expect(one.skippedForLimit).toBe(1);
    const rest = nightTagWork(c.store, { day: 1, apply: true, budget: 10 });
    expect(rest.cardTagged).toBe(1);
    expect(tagsOf(c.store, a)).toEqual(["wren:card"]);
    expect(tagsOf(c.store, b)).toEqual(["garden:write", "wren:card"]);
    // Done: nothing offered again.
    expect(nightTagWork(c.store, { day: 2, apply: true, budget: 10 }).cardOffered).toBe(0);
  });

  test("tags whose stems match are merged into the more-carried; a merge no memory carries is let go", () => {
    const c = brain();
    mem(c.store, "The backup ran.", { tags: ["backups"] });
    mem(c.store, "Another backup ran.", { tags: ["backups"] });
    const one = mem(c.store, "A single backup note.", { tags: ["backup"] });
    expect(stemKey("backups")).toBe(stemKey("backup"));
    const r = nightTagWork(c.store, { day: 1, apply: true, budget: 10 });
    expect(r.stemMerged).toBe(1);
    expect(c.store.tagMerges().map((m) => [m.alias, m.tag, m.via])).toEqual([["backup", "backups", "stem"]]);
    // The tally reads the merge: one tag, three memories.
    expect(tallyTags(c.store).find((t) => t.tag === "backups")?.memories.length).toBe(3);

    // A merge between words nobody carries any more goes (review of #569).
    c.store.recordTagMerge("colour", "color", "night");
    c.store.untagMemory(one);
    const again = nightTagWork(c.store, { day: 2, apply: true, budget: 10 });
    expect(again.mergesPruned).toBe(1);
    // "backup" is on no memory now but "backups" is: that merge stays.
    expect(c.store.tagMerges().map((m) => m.alias)).toEqual(["backup"]);
  });

  test("switched off: nothing read, nothing written, the phase says so", async () => {
    const c = brain();
    const a = mem(c.store, "Wren fixed the gate hinge.");
    c.schemas.mention({ name: "Wren", kind: "person", source: "Wren fixed the gate hinge.", chunkRef: "t:1", day: 0 });
    set("TAGS_NIGHT", false);
    c.wake(9_000);
    const report = await c.sessionEnd({ date: "2026-10-21" });
    const tags = phaseReport(report.cycle, "tags");
    expect(tags.skipped["switched-off"]).toBe(1);
    expect(tagsOf(c.store, a)).toEqual([]);
    set("TAGS_NIGHT", true);
    const on = await (async () => {
      clock += 86_400_000;
      return c.sessionEnd({ date: "2026-10-22" });
    })();
    expect(phaseReport(on.cycle, "tags").status).toBe("ran");
    expect(tagsOf(c.store, a)).toEqual(["wren:card"]);
  });
});

describe("a tag that matters becomes a topic", () => {
  function spread(s: Store, tag: string, n: number, opts: { days?: number; sessions?: number } = {}): string[] {
    const days = opts.days ?? 3;
    const sessions = opts.sessions ?? 2;
    return Array.from({ length: n }, (_, i) => mem(s, `Something about ${tag} on day ${String(i % days)}.`, { day: i % days, session: `s${String(i % sessions)}`, tags: [tag] }));
  }

  test("the bar: memories, lived days and sessions; the card has no name and leaves recall's aliases alone", () => {
    const c = brain();
    spread(c.store, "backups", 5);
    spread(c.store, "taxes", 4);
    spread(c.store, "ferry", 6, { days: 2 });
    spread(c.store, "boiler", 6, { sessions: 1 });
    const aliasesBefore = JSON.stringify([...c.schemas.aliasMap()]);
    const r = c.schemas.birthsFromTags(5, { limit: 5 });
    expect(r.offered).toBe(1);
    expect(r.born).toHaveLength(1);
    const id = r.born[0] as string;
    const row = c.store.row(id);
    expect(row?.subject_kind).toBe("topic");
    expect(row?.title).toBe("backups");
    expect(JSON.parse(row?.meta ?? "{}")).toMatchObject({ role: "entity", name: "", aliases: [], topic: "backups" });
    expect(JSON.stringify([...c.schemas.aliasMap()])).toBe(aliasesBefore);
    expect(c.schemas.subjectsIn("what about backups")).toEqual([]);
    // Born once.
    expect(c.schemas.birthsFromTags(6, { limit: 5 }).born).toEqual([]);
  });

  test("a merge that moves the canonical word does not birth the cluster twice", () => {
    const c = brain();
    spread(c.store, "backups", 5);
    expect(c.schemas.birthsFromTags(5, { limit: 5 }).born).toHaveLength(1);
    spread(c.store, "backup copies", 7);
    c.store.recordTagMerge("backups", "backup copies", "night");
    expect(tallyTags(c.store)[0]?.tag).toBe("backup copies");
    expect(c.schemas.birthsFromTags(6, { limit: 5 }).born).toEqual([]);
  });

  test("use and feeling lift a topic over the bar", () => {
    const c = brain();
    const ids = spread(c.store, "castle game", 3);
    expect(c.schemas.birthsFromTags(5, { limit: 5 }).offered).toBe(0);
    for (const id of ids) c.store.reinforce(id, 4);
    c.store.addFeelings(ids[1] as string, [{ whose: "owner", core: "happy", emotion: "proud", strength: 0.8 }]);
    c.store.addFeelings(ids[2] as string, [{ whose: "owner", core: "happy", emotion: "proud", strength: 0.8 }]);
    const t = tallyTags(c.store).find((x) => x.tag === "castle game");
    expect(t?.weight).toBe(3 + 3 * SCHEMAS.TOPIC_USED_WEIGHT + 2 * SCHEMAS.TOPIC_FELT_WEIGHT);
    expect(c.schemas.birthsFromTags(5, { limit: 5 }).born).toHaveLength(1);
  });

  test("October stays a tag; a name a card holds is not a topic; the limit holds; a dry run writes nothing", () => {
    const c = brain();
    spread(c.store, "october", 6);
    spread(c.store, "2026 taxes", 6);
    spread(c.store, "wren", 6);
    c.schemas.mention({ name: "Wren", kind: "person", source: "Wren", chunkRef: "t:1", day: 0 });
    for (const t of ["alpha", "beta", "gamma"]) spread(c.store, t, 5);
    expect(isStopTag("October")).toBe(true);
    expect(isStopTag("monday morning")).toBe(true);
    expect(isStopTag("castle game")).toBe(false);
    const dry = c.schemas.birthsFromTags(5, { limit: 2, dryRun: true });
    expect(dry.born).toEqual([]);
    expect(dry.offered).toBe(3);
    expect(dry.skippedForLimit).toBe(1);
    expect(dry.refused).toEqual({ "stays-a-tag": 2, "a-name-already": 1 });
    expect(c.store.topicCards().size).toBe(0);
    const r = c.schemas.birthsFromTags(5, { limit: 2 });
    expect(r.born).toHaveLength(2);
    expect(r.skippedForLimit).toBe(1);
  });

  test("off: nothing born", () => {
    const c = brain();
    spread(c.store, "backups", 6);
    set("TAGS_NIGHT", false);
    expect(c.schemas.birthsFromTags(5, { limit: 5 })).toMatchObject({ on: false, born: [] });
  });
});

describe("the night's tagging ask", () => {
  test("the bundle: untagged memories newest first, look-alike pairs, cards with no kind", () => {
    const c = brain();
    const old = mem(c.store, "An old untagged note.", { day: 0 });
    const fresh = mem(c.store, "A fresh untagged note.", { day: 3 });
    mem(c.store, "Tagged.", { tags: ["castle"] });
    mem(c.store, "Tagged too.", { tags: ["castle"] });
    mem(c.store, "Tagged three.", { tags: ["castle game"] });
    c.schemas.mention({ name: "Driftwood", kind: "entity", source: "Driftwood", chunkRef: "t:1", day: 0 });
    const b = tagsBundle(c.store);
    expect(b.on).toBe(true);
    expect(b.memories.map((m) => m.id)).toEqual([fresh, old]);
    expect(b.untagged).toBe(2);
    expect(b.pairs.map((p) => [p.a, p.b])).toEqual([["castle", "castle game"]]);
    expect(b.cards.map((x) => x.name)).toEqual(["Driftwood"]);
    set("TAGS_NIGHT", false);
    expect(tagsBundle(c.store).on).toBe(false);
  });

  test("a chapter's copy (the journal's own row) is neither offered for tags nor given a card's name (review of #573)", () => {
    const c = brain();
    const copy = c.store.put({ type: "memory", kind: "fact", body: "Wren and I walked the garden; a chapter's retelling.", source: "episode", origin: { session: "s1", scope: "/proj/one", ref: "epi_test#1" } });
    const lived = mem(c.store, "Wren fixed the gate hinge.");
    c.schemas.mention({ name: "Wren", kind: "person", source: "Wren fixed the gate hinge.", chunkRef: "t:1", day: 0 });
    expect(tagsBundle(c.store).memories.map((m) => m.id)).toEqual([lived]);
    nightTagWork(c.store, { day: 1, apply: true, budget: 10 });
    expect(tagsOf(c.store, lived)).toEqual(["wren:card"]);
    expect(tagsOf(c.store, copy)).toEqual([]);
  });

  test("the answer, written as the night's and refused by item; a no is not asked again; the night undone", () => {
    const c = brain();
    const startedAt = clock;
    const a = mem(c.store, "Untagged one.");
    const writer = mem(c.store, "Writer-tagged.", { tags: ["castle"] });
    mem(c.store, "Another castle.", { tags: ["castle"] });
    mem(c.store, "Game.", { tags: ["castle game"] });
    mem(c.store, "Colour.", { tags: ["colour"] });
    mem(c.store, "Color.", { tags: ["color"] });
    mem(c.store, "Color two.", { tags: ["color"] });
    c.schemas.mention({ name: "Driftwood", kind: "entity", source: "Driftwood", chunkRef: "t:1", day: 0 });
    const card = c.schemas.entities().find((e) => e.name === "Driftwood")?.id as string;

    const out = applyTagsAnswer(
      c.store,
      {
        tagged: [
          { id: a, tags: ["Garden", "AKIAIOSFODNN7EXAMPLE"] },
          { id: writer, tags: ["other"] },
          { id: "mem_nope", tags: ["x"] },
        ],
        merges: [
          { a: "castle", b: "castle game", same: false },
          { a: "colour", b: "color", same: true },
          { a: "nothing", b: "color", same: true },
        ],
        kinds: [
          { id: card, kind: "project" },
          { id: a, kind: "topic" },
        ],
      },
      { run: "nrn_test" },
    );
    expect(out).toMatchObject({ on: true, memories: 1, tags: 1, merged: 1, notSame: 1, kinds: 1 });
    expect(out.refused).toHaveLength(4);
    expect(tagsOf(c.store, a)).toEqual(["garden:night"]);
    expect(tagsOf(c.store, writer)).toEqual(["castle:write"]);
    expect(c.store.tagMerges().map((m) => [m.alias, m.tag, m.via])).toEqual([["colour", "color", "night"]]);
    expect(c.store.row(card)?.subject_kind).toBe("project");
    expect(c.store.getMeta(`${TAGS_NIGHT_PREFIX}nrn_test`)).toContain('"tags":1');
    // The pair answered "no" is not asked again.
    expect(tagsBundle(c.store).pairs).toEqual([]);

    const undone = undoNightTags(c.store, startedAt);
    expect(undone).toEqual({ tags: 1, merges: 1, kinds: 1 });
    expect(tagsOf(c.store, a)).toEqual([]);
    expect(tagsOf(c.store, writer)).toEqual(["castle:write"]);
    expect(c.store.tagMerges()).toEqual([]);
    expect(c.store.row(card)?.subject_kind).toBeNull();
  });

  test("through the dream tool's tags phase", async () => {
    const s = openServer({ dir: join(root, "srv"), snapshotsDir: join(root, "srv-snaps"), session: "sess_tags", scope: "/proj/one", now: () => clock });
    open.push(s.counterpart);
    const id = mem(s.counterpart.store, "The gate hinge squeaks again.");
    const payload = (r: ToolResult): Record<string, unknown> => r.structuredContent;
    const bundle = payload(await s.call("dream", { phase: "tags", session: "sess_tags" }));
    expect(String(bundle["read"])).toContain(id);
    const done = payload(await s.call("dream", { phase: "tags", session: "sess_tags", tagged: [{ id, tags: ["gate", "house"] }] }));
    expect(done).toMatchObject({ phase: "tags", tagged: 1, tags: 2 });
    expect(tagsOf(s.counterpart.store, id)).toEqual(["gate:night", "house:night"]);
  });
});

describe("the night's third child", () => {
  function scripted(asks: SeatAsk[]): Seat<NightAnswer> {
    return {
      name: "test",
      answer(ask) {
        asks.push(ask);
        return Promise.resolve({ refused: null, started: true, code: 0, timedOut: false, error: null, ms: 1 });
      },
    };
  }

  function night(dir: string, seat: Seat<NightAnswer>): ReturnType<typeof runNight> {
    return runNight({
      open: () => Counterpart.open({ dir, budgetBytes: 9_000 }),
      config: { dataDir: dir, injectionBudgetBytes: 9_000 },
      run: "nrn_tags",
      session: "ses-launch",
      scope: root,
      kind: { kind: "night" },
      seat,
    });
  }

  test("after the reflection, on the dream tool alone, under its own small limits; skipped when off; not started with nothing to ask", async () => {
    const dir = join(root, "night");
    mkdirSync(dir, { recursive: true });
    // Nothing to ask: no child, no line.
    const empty: SeatAsk[] = [];
    const quiet = await night(dir, scripted(empty));
    expect(empty.map((a) => a.act)).toEqual(["dream", "reflection"]);
    expect(quiet.children?.map((c) => c.child)).toEqual(["dream", "reflection"]);

    const c = Counterpart.open({ dir, budgetBytes: 9_000 });
    mem(c.store, "An untagged memory for the night.");
    c.close();
    const asks: SeatAsk[] = [];
    const out = await night(dir, scripted(asks));
    expect(asks.map((a) => a.act)).toEqual(["dream", "reflection", "tags"]);
    const tags = asks[2] as SeatAsk;
    expect(tags.tools).toEqual(SEAT_TOOLS.tags.tools);
    expect(tags.tools).toEqual(["dream"]);
    expect(tags.limits).toEqual({ turns: ADAPTER.NIGHT_TAGS_MAX_TURNS, ms: ADAPTER.NIGHT_TAGS_MS });
    expect(tags.prompt).toContain('phase "tags"');
    expect(out.children?.[2]).toEqual({ child: "tags", code: 0, ms: 1 });

    set("TAGS_NIGHT", false);
    const off: SeatAsk[] = [];
    const offRun = await night(dir, scripted(off));
    expect(off.map((a) => a.act)).toEqual(["dream", "reflection"]);
    expect(offRun.children?.map((c) => c.child)).toEqual(["dream", "reflection"]);
  });

  test("the tagging child's claude -p runs on the small model", () => {
    const dir = join(root, "plan");
    const plan = planNightChild({ config: { dataDir: dir, injectionBudgetBytes: 9_000 }, run: "r", prompt: "p", scope: "/x", session: "s", child: "tags", model: ADAPTER.NIGHT_TAGS_MODEL });
    const at = plan.args.indexOf("--model");
    expect(plan.args[at + 1]).toBe(ADAPTER.NIGHT_TAGS_MODEL);
  });
});

describe("the dream's intake is the same with tags present", () => {
  test("tonight's new memories, as the dream's bundle has them, with the night's tag work done on one store", async () => {
    const bodies = ["Wren fixed the gate hinge.", "The backups moved to two in the morning.", "Taxes are due in April.", "The ferry runs twice a day.", "Wren planned the garden beds."];
    const fresh = async (name: string, tagged: boolean): Promise<string[]> => {
      const c = brain(name);
      for (const [i, b] of bodies.entries()) {
        c.store.put({
          type: "memory",
          kind: "fact",
          body: b,
          origin: { session: "s1", scope: "/proj/one" },
          salience: { novelty: null, relevance: 0.8, emotional: 0.5, predictive: 0.6 },
          physics: { birthDay: 0, lastUsedDay: 0 },
          ...(tagged ? { tags: [`topic ${String(i % 2)}`, "house"] } : {}),
        });
      }
      if (tagged) nightTagWork(c.store, { day: 0, apply: true, budget: 100 });
      const begun = c.dreams.begin({ session: "sess_dream" });
      if (!begun.ok) throw new Error(begun.reason);
      // As a set: equal-weight memories are ordered by id, and ids are random per store.
      return begun.bundle.fresh.map((f) => c.store.row(f.id)?.body ?? f.id).sort();
    };
    const plain = await fresh("plain", false);
    expect(plain.length).toBeGreaterThan(0);
    expect(await fresh("tagged", true)).toEqual(plain);
  });
});

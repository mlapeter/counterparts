/**
 * THE TWIN CARDS, MERGED ONCE (2026-10-22, wave 2 follow-ups). Two live cards
 * with one name — the race #578 closed — are merged by the night's births
 * phase, once per store: the second-born is archived `card-twin` under the
 * elder, recorded, and the owner's undo (`counterparts dream --undo-twins`,
 * through `owner-op-seam#unarchiveTwin`) puts it back. A pair that differs in
 * anything a merge could lose is left alone and counted.
 *
 * Hermetic: a fresh temp dir per test, removed after. The switch is put back.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/adapters/cli/index.js";
import { leftAs } from "../src/core/leaving.js";
import { Counterpart } from "../src/core/counterpart.js";
import { TUNABLES as SCHEMAS, TWINS_MERGED_KEY, TWIN_PREFIX } from "../src/core/schemas/index.js";
import { phaseReport } from "../src/core/sleep/index.js";
import { Store, V14_UPGRADE_KEY } from "../src/core/store/index.js";
import { upgradeV14Findings } from "../src/adapters/claude-code/doctor.js";
import { CARD_TWIN_ARCHIVE_REASON, TWIN_RECORD_PREFIX, unarchiveTwin } from "../src/core/store/owner-op-seam.js";

let root: string;
let dir: string;
let clock = Date.parse("2026-10-21T09:00:00Z");
const open: { close(): void }[] = [];
const saved = { ...SCHEMAS } as Record<string, unknown>;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-card-twins-")));
  dir = join(root, "store");
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

function brain(): Counterpart {
  const c = Counterpart.open({ dir, snapshotsDir: join(root, "snaps"), now: () => clock, budgetBytes: 9_000 });
  open.push(c);
  return c;
}

let seq = 0;
function mem(c: Counterpart, body: string): string {
  seq += 1;
  return c.store.put({ type: "memory", kind: "fact", body: `${body} (${String(seq)})`, origin: { session: "s1", scope: "/proj/one" } });
}

/** A card as a racing worker left it: written straight to the store, linked to `memories`. */
function card(c: Counterpart, name: string, memories: readonly string[], over: { kind?: "entity" | "person"; aliases?: string[] } = {}): string {
  clock += 1;
  const id = c.store.put({ type: "schema", kind: over.kind ?? "entity", title: name, body: name, meta: { role: "entity", name, aliases: over.aliases ?? [] } });
  c.store.linkSubjects(
    memories.map((m) => ({ memoryId: m, subjectId: id })),
    "birth",
  );
  return id;
}

function twins(c: Counterpart): { [k in "wrenOld" | "wrenNew" | "inesOld" | "inesNew" | "bram1" | "bram2" | "bram3" | "tomasOld" | "tomasNew"]: string } {
  const a = mem(c, "Wren fixed the gate hinge on Saturday.");
  const b = mem(c, "Wren and I planned the garden beds.");
  const i = mem(c, "Ines brought the seedlings round.");
  const j = mem(c, "Ines asked about the greenhouse.");
  const k = mem(c, "Bram mended the fence by the lane.");
  const p = mem(c, "Tomas helped move the compost bins.");
  return {
    wrenOld: card(c, "Wren", [a, b]),
    wrenNew: card(c, "wren", [a, b]),
    // Links differ: left alone.
    inesOld: card(c, "Ines", [i, j]),
    inesNew: card(c, "Ines", [i]),
    // Three: not a pair.
    bram1: card(c, "Bram", [k]),
    bram2: card(c, "Bram", [k]),
    bram3: card(c, "Bram", [k]),
    // Aliases differ: left alone.
    tomasOld: card(c, "Tomas", [p], { aliases: ["Tom"] }),
    tomasNew: card(c, "Tomas", [p]),
  };
}

const archived = (s: Store, id: string): string | null => (s.row(id)?.archived === 1 ? (s.row(id)?.archived_reason ?? "") : null);

describe("the twin pass, through the night", () => {
  test("the second-born of a pair that differs in nothing is archived under the elder, once, recorded; the rest are counted", async () => {
    const c = brain();
    const t = twins(c);
    // An observer's dry run: what it would do, nothing written.
    const dry = c.schemas.mergeTwinCards(0, { dryRun: true });
    expect(dry.merged.map((m) => [m.keep, m.gone])).toEqual([[t.wrenOld, t.wrenNew]]);
    expect(dry.skipped).toEqual({ "links-differ": 1, "not-a-pair": 1, "aliases-differ": 1 });
    expect(archived(c.store, t.wrenNew)).toBeNull();
    expect(c.store.getMeta(TWINS_MERGED_KEY)).toBeUndefined();

    c.wake(9_000);
    const report = await c.sessionEnd({ date: "2026-10-21" });
    expect(phaseReport(report.cycle, "births").status).toStartWith("ran");
    expect(archived(c.store, t.wrenNew)).toBe(CARD_TWIN_ARCHIVE_REASON);
    expect(archived(c.store, t.wrenOld)).toBeNull();
    for (const id of [t.inesOld, t.inesNew, t.bram1, t.bram2, t.bram3, t.tomasOld, t.tomasNew]) expect(archived(c.store, id as string)).toBeNull();
    expect(JSON.parse(c.store.getMeta(`${TWIN_PREFIX}${t.wrenNew}`) ?? "{}")).toMatchObject({ keep: t.wrenOld });
    const record = JSON.parse(c.store.getMeta(TWINS_MERGED_KEY) ?? "{}") as { merged: unknown[]; skipped: Record<string, number> };
    expect(record.merged).toEqual([{ keep: t.wrenOld, gone: t.wrenNew, name: "Wren" }]);
    expect(record.skipped).toEqual({ "links-differ": 1, "not-a-pair": 1, "aliases-differ": 1 });
    // The elder holds the name alone now; the twin left as "replaced".
    expect(c.schemas.subjectsIn("Wren came by again.")).toEqual([t.wrenOld]);
    expect(leftAs(CARD_TWIN_ARCHIVE_REASON)).toBe("replaced");

    // Once per store: a pair made since is not looked for.
    const later = mem(c, "Ola dropped off the ladder.");
    const ola1 = card(c, "Ola", [later]);
    const ola2 = card(c, "Ola", [later]);
    clock += 86_400_000;
    await c.sessionEnd({ date: "2026-10-22" });
    expect([archived(c.store, ola1), archived(c.store, ola2)]).toEqual([null, null]);
    expect(c.schemas.mergeTwinCards(2).ran).toBe(false);
  });

  test("a belief, a folder, protection or a different kind keeps a pair apart", () => {
    const c = brain();
    const m = mem(c, "Juno and Kit and Lev and Mo all came.");
    const juno1 = card(c, "Juno", [m]);
    card(c, "Juno", [m]);
    c.store.updatePhysics(juno1, { protected: true });
    card(c, "Kit", [m]);
    card(c, "Kit", [m], { kind: "person" });
    const lev1 = card(c, "Lev", [m]);
    card(c, "Lev", [m]);
    c.store.setFolderProject("/proj/lev", lev1, "owner");
    // A card this index holds, so a belief can attach to it; its twin raced in beside it.
    const mo1 = (c.schemas.mention({ name: "Mo", kind: "entity", source: "Juno and Kit and Lev and Mo all came.", chunkRef: "t:mo", day: 0 }) as { id?: string }).id as string;
    expect(c.store.memoriesNaming(mo1)).toEqual([m]);
    card(c, "Mo", [m]);
    const born = c.schemas.addBelief({ entityId: mo1, statement: "Mo keeps the spare key under the mat.", day: 0, birthRoute: "session" });
    expect(born.ok).toBe(true);
    const r = c.schemas.mergeTwinCards(0);
    expect(r.merged).toEqual([]);
    expect(r.skipped).toEqual({ protected: 1, "kinds-differ": 1, "has-folders": 1, "has-beliefs": 1 });
  });

  test("switched off: no pass and no record, so it runs the first night it is on", async () => {
    const c = brain();
    const t = twins(c);
    (SCHEMAS as unknown as Record<string, unknown>)["TWINS_MERGE"] = false;
    c.wake(9_000);
    await c.sessionEnd({ date: "2026-10-21" });
    expect(archived(c.store, t.wrenNew)).toBeNull();
    expect(c.store.getMeta(TWINS_MERGED_KEY)).toBeUndefined();
    (SCHEMAS as unknown as Record<string, unknown>)["TWINS_MERGE"] = true;
    clock += 86_400_000;
    await c.sessionEnd({ date: "2026-10-22" });
    expect(archived(c.store, t.wrenNew)).toBe(CARD_TWIN_ARCHIVE_REASON);
  });
});

describe("review of #593", () => {
  test("a memory written while the twins lived — linked to neither — is linked to the keeper after the night", async () => {
    const c = brain();
    const t = twins(c);
    // Written between the twin births and the merge: two live cards hold "Wren", so neither takes it.
    const between = (
      await c.submitJot({ content: "Wren dropped off the spare gate key this morning on the way to work." }, { session: "s2", scope: "/proj/one" })
    ).memoryId as string;
    expect(c.store.subjectsOf(between)).toEqual([]);
    // As an upgraded store's record reads, so doctor's v14 line shows (a store born at v14 has none).
    c.store.setMeta(V14_UPGRADE_KEY, JSON.stringify({ from: "13", day: 3, confidentialDropped: true, confidentialCounted: 0, subjects: {} }));
    expect(upgradeV14Findings(c.store)[0]?.detail).not.toContain("twin");
    c.wake(9_000);
    await c.sessionEnd({ date: "2026-10-21" });
    expect(archived(c.store, t.wrenNew)).toBe(CARD_TWIN_ARCHIVE_REASON);
    expect(c.store.subjectsOf(between)).toEqual([t.wrenOld]);
    expect(c.store.subjectLinksOf(between)[0]?.via).toBe("birth");
    // Doctor says what the pass came to, and the way back.
    expect(upgradeV14Findings(c.store)[0]?.detail).toContain(
      "On 2026-10-21 the night merged 1 twin card (one name, two cards) into the older card of each pair, which gained the links of 1 memory written while the twins lived; counterparts dream --undo-twins puts them back.",
    );
    // A write after the merge links to the keeper at once.
    const after = (await c.submitJot({ content: "Wren came back for the ladder he lent us last spring." }, { session: "s3", scope: "/proj/one" })).memoryId as string;
    expect(c.store.subjectsOf(after)).toEqual([t.wrenOld]);
  });

  test("an archive that throws on the second pair: the plan stands, the next night finishes it, and nothing is recorded for a twin still live", async () => {
    const c = brain();
    const m1 = mem(c, "Sol and Uma painted the porch.");
    const sol1 = card(c, "Sol", [m1]);
    const sol2 = card(c, "Sol", [m1]);
    const uma1 = card(c, "Uma", [m1]);
    const uma2 = card(c, "Uma", [m1]);
    const real = c.store.archive.bind(c.store);
    let calls = 0;
    c.store.archive = (id: string, reason: string): void => {
      if (reason === CARD_TWIN_ARCHIVE_REASON && ++calls === 2) throw new Error("disk full");
      real(id, reason);
    };
    const first = c.schemas.mergeTwinCards(0);
    // Whichever pair came first went; the second's archive threw.
    expect(first.merged).toHaveLength(1);
    const went = first.merged[0]?.gone as string;
    const stuck = went === sol2 ? uma2 : sol2;
    expect([archived(c.store, went), archived(c.store, stuck)]).toEqual([CARD_TWIN_ARCHIVE_REASON, null]);
    expect(c.store.getMeta(`${TWIN_PREFIX}${stuck}`)).toBeUndefined();
    // The undo door has nothing to say about a twin the pass never archived.
    expect(() => unarchiveTwin(c.store, stuck)).toThrow(/UNTWIN_NOT_A_TWIN/);
    c.store.archive = real;
    // A racing worker's empty plan does not stand over the first's.
    const plan = c.store.getMeta(TWINS_MERGED_KEY);
    expect((JSON.parse(plan ?? "{}") as { merged: unknown[] }).merged).toHaveLength(2);
    // The next night finishes the job, through the night entry.
    c.wake(9_000);
    await c.sessionEnd({ date: "2026-10-21" });
    expect([archived(c.store, sol1), archived(c.store, sol2), archived(c.store, uma1), archived(c.store, uma2)]).toEqual([null, CARD_TWIN_ARCHIVE_REASON, null, CARD_TWIN_ARCHIVE_REASON]);
    expect(JSON.parse(c.store.getMeta(`${TWIN_PREFIX}${stuck}`) ?? "{}")).toMatchObject({ keep: stuck === uma2 ? uma1 : sol1 });
    const after = JSON.parse(c.store.getMeta(TWINS_MERGED_KEY) ?? "{}") as { merged: unknown[]; archived: number };
    expect(after.merged).toEqual((JSON.parse(plan ?? "{}") as { merged: unknown[] }).merged);
    expect(after.archived).toBe(2);
    expect(c.schemas.mergeTwinCards(1).ran).toBe(false);
  });

  test("undo on a planned twin still live (a record the first build wrote before its archive) marks the record, so the pass never takes it", () => {
    const c = brain();
    const m = mem(c, "Vic fixed the bike.");
    const vic1 = card(c, "Vic", [m]);
    const vic2 = card(c, "Vic", [m]);
    const real = c.store.archive.bind(c.store);
    c.store.archive = (): void => {
      throw new Error("disk full");
    };
    c.schemas.mergeTwinCards(0);
    c.store.archive = real;
    expect(archived(c.store, vic2)).toBeNull();
    // What the first version of this PR left: the twin's record, written before an archive that failed.
    c.store.setMeta(`${TWIN_PREFIX}${vic2}`, JSON.stringify({ keep: vic1, day: 0, at: 0 }));
    const out = unarchiveTwin(c.store, vic2);
    expect(out).toEqual({ id: vic2, keep: vic1, noop: true });
    expect(JSON.parse(c.store.getMeta(`${TWIN_PREFIX}${vic2}`) ?? "{}")).toHaveProperty("undone");
    expect(c.schemas.mergeTwinCards(1).ran).toBe(false);
    expect(archived(c.store, vic2)).toBeNull();
  });
});

describe("the undo door", () => {
  async function cli(argv: readonly string[]): Promise<{ code: number; out: string[]; err: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run([...argv, "--dir", dir], { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" } });
    return { code, out, err };
  }

  test("counterparts dream --undo-twins puts the twin back, marks its record, keeps the elder's backlinks, says the cost, and the night does not merge it again", async () => {
    const c = brain();
    const t = twins(c);
    const between = (await c.submitJot({ content: "Wren dropped off the spare gate key this morning on the way to work." }, { session: "s2", scope: "/proj/one" })).memoryId as string;
    c.wake(9_000);
    await c.sessionEnd({ date: "2026-10-21" });
    expect(archived(c.store, t.wrenNew)).toBe(CARD_TWIN_ARCHIVE_REASON);
    expect(c.store.subjectsOf(between)).toEqual([t.wrenOld]);
    for (const x of open.splice(0)) x.close();

    expect((await cli(["dream", "--undo-twins", "--observer"])).code).toBe(2);
    expect((await cli(["dream", "--undo-twins", t.inesNew as string])).err[0]).toContain("not a twin card the night archived");
    expect((await cli(["dream", "--undo-twins", "--undo-tags"])).code).toBe(1);
    const back = await cli(["dream", "--undo-twins"]);
    expect(back.code).toBe(0);
    expect(back.out).toContain(`  ${t.wrenNew as string} (stood under ${t.wrenOld as string}) is back`);
    expect(back.out).toContain("Put back 1 twin card; each record is kept, marked undone.");
    expect(back.out.join("\n")).toContain("a new memory naming it links to neither");
    expect(back.out.join("\n")).toContain("stay: they are true");
    const again = await cli(["dream", "--undo-twins"]);
    expect(again.code).toBe(2);

    const c2 = brain();
    expect(archived(c2.store, t.wrenNew)).toBeNull();
    expect(JSON.parse(c2.store.getMeta(`${TWIN_RECORD_PREFIX}${t.wrenNew}`) ?? "{}")).toMatchObject({ keep: t.wrenOld, undone: expect.any(String) });
    // The backlinks the pass added stay on the elder: they are true links.
    expect(c2.store.subjectsOf(between)).toEqual([t.wrenOld]);
    clock += 86_400_000;
    await c2.sessionEnd({ date: "2026-10-22" });
    expect(archived(c2.store, t.wrenNew)).toBeNull();
  });

  test("the door undoes one reason: a faded card is refused by name, a removed one first", () => {
    const c = brain();
    const m = mem(c, "Pia painted the shed.");
    const id = card(c, "Pia", [m]);
    c.store.archive(id, SCHEMAS.FADE_REASON);
    expect(() => unarchiveTwin(c.store, id)).toThrow(/UNTWIN_NOT_A_TWIN/);
    const live = card(c, "Quill", [m]);
    expect(() => unarchiveTwin(c.store, live)).toThrow(/UNTWIN_NOT_A_TWIN/);
  });

  test("the store spells the reason and the record's prefix as schemas does", () => {
    expect(CARD_TWIN_ARCHIVE_REASON).toBe(SCHEMAS.TWIN_REASON);
    expect(TWIN_RECORD_PREFIX).toBe(TWIN_PREFIX);
  });
});

/**
 * PROJECTS, AND WHERE KNOWLEDGE TRAVELS (2026-10-21, wave 2 lane G, design §8).
 *
 *   - a folder belongs to a project (`folder_projects`), by default its own,
 *     with no row and no card written to say so;
 *   - the owner joins folders (`counterparts project join`), and a joined
 *     folder's "Work here" reads every folder of the project; another
 *     project's folders stay elsewhere, a joined folder's are here;
 *   - an unmarked skill is craft, not work: a few may be work lines in any
 *     folder, from a folder the host lets be named elsewhere; a skill marked
 *     `work` stays with its project;
 *   - `PROJECTS_TRAVEL` off is the rule before, in every one of those.
 *
 * Hermetic: every test makes its own temp directory and removes it. The clock
 * is pinned and the zone is UTC; every word is invented placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/adapters/cli/index.js";
import { parseSetting } from "../tools/harness/settings.js";
import { Counterpart } from "../src/core/counterpart.js";
import { CRAFT_SINCE_KEY, SELF_TUNABLES, WORK_HERE_HEADING, isCraft, isWorkMemory, projectFolder, projectFolders, workHere } from "../src/core/self/index.js";
import type { AboutMark } from "../src/core/store/index.js";
import type { Kind } from "../src/core/types.js";

const ZONE = "UTC";
const NOW = Date.UTC(2026, 9, 21, 15, 0);
const DATE = "2026-10-21";
const BUDGET = 9_000;

let root: string;
let storeDir: string;
let BUILD: string;
let SITE: string;
let GARDEN: string;
let QUIET: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  clock = NOW - 86_400_000;
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-projects-")));
  storeDir = join(root, "store");
  BUILD = join(root, "build");
  SITE = join(root, "build-site");
  GARDEN = join(root, "garden");
  QUIET = join(root, "quiet");
  for (const d of [BUILD, SITE, GARDEN, QUIET]) mkdirSync(d, { recursive: true });
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

/** Memories are written the day before the wake reads them, unless a test says otherwise: a
 *  memory written today is named by the "Today, elsewhere" line, and "Work here" leaves out
 *  what that line names. */
let clock = NOW - 86_400_000;

function counterpart(tunables?: Record<string, unknown>, observer = false): Counterpart {
  const c = Counterpart.open({
    dir: storeDir,
    now: () => clock,
    timeZone: ZONE,
    ...(observer ? { observer: true } : {}),
    ...(tunables === undefined ? {} : { selfTunables: tunables }),
  });
  open.push(c);
  return c;
}

function put(c: Counterpart, body: string, opts: { kind?: Kind; about?: AboutMark; scope?: string; title?: string; session?: string } = {}): string {
  return c.store.put({
    type: "memory",
    kind: opts.kind ?? "fact",
    body,
    salience: { relevance: 0.9, emotional: 0.6, predictive: 0.8 },
    ...(opts.title === undefined ? {} : { title: opts.title }),
    ...(opts.about === undefined ? {} : { about: opts.about, aboutBy: "writer" as const }),
    ...(opts.scope === undefined ? {} : { origin: { scope: opts.scope, ...(opts.session === undefined ? {} : { session: opts.session }) } }),
  });
}

function wake(c: Counterpart, scope: string, here: { exportsFrom?: (s: string) => boolean; sessions?: () => never[] } = { exportsFrom: () => true }): string {
  clock = NOW;
  c.rebrief({ budgetBytes: BUDGET, at: DATE });
  return c.wake(BUDGET, { date: DATE }, { scope, session: "s-reader", ...here }).text;
}

function under(text: string, heading: string): string {
  const lines = text.split("\n");
  const at = lines.indexOf(heading);
  if (at < 0) return "";
  const out: string[] = [];
  for (let i = at + 1; i < lines.length && (lines[i] ?? "").length > 0; i++) out.push(lines[i] as string);
  return out.join("\n");
}

describe("what is work, and what is craft (self/work.ts)", () => {
  const base = { originScope: "/w", journal: false };
  test("with craft travelling an unmarked skill is craft, not work; a skill marked work stays work", () => {
    expect(isWorkMemory({ ...base, about: null, kind: "skill" }, { craftTravels: true })).toBe(false);
    expect(isCraft({ ...base, about: null, kind: "skill" })).toBe(true);
    expect(isWorkMemory({ ...base, about: "work", kind: "skill" }, { craftTravels: true })).toBe(true);
    expect(isCraft({ ...base, about: "work", kind: "skill" })).toBe(false);
    // Marked world is craft; marked me, us or owner is personal, never a work line.
    expect(isCraft({ ...base, about: "world", kind: "skill" })).toBe(true);
    expect(isCraft({ ...base, about: "me", kind: "skill" })).toBe(false);
    // Grandfathered: born before craft started travelling, still its folder's work.
    expect(isWorkMemory({ ...base, about: null, kind: "skill", bornDay: 2 }, { craftTravels: true, craftSince: 3 })).toBe(true);
    expect(isCraft({ ...base, about: null, kind: "skill", bornDay: 3 }, { craftSince: 3 })).toBe(true);
    // Facts are as before: unmarked in a folder is that folder's work.
    expect(isWorkMemory({ ...base, about: null, kind: "fact" }, { craftTravels: true })).toBe(true);
    expect(isCraft({ ...base, about: null, kind: "fact" })).toBe(false);
    // A journal copy is neither.
    expect(isCraft({ ...base, about: null, kind: "skill", journal: true })).toBe(false);
  });

  test("the rule before is the default: an unmarked skill is work", () => {
    expect(isWorkMemory({ ...base, about: null, kind: "skill" })).toBe(true);
    expect(isWorkMemory({ ...base, about: null, kind: "skill" }, { craftTravels: false })).toBe(true);
  });

  test("the switch is on, and compare-settable", () => {
    expect(SELF_TUNABLES.PROJECTS_TRAVEL).toBe(true);
    expect(parseSetting("self.PROJECTS_TRAVEL=false").value).toBe(false);
    expect(parseSetting("self.WORK_HERE_CRAFT_MAX=1").value).toBe(1);
  });
});

describe("a folder's project (projectFolders)", () => {
  test("with no row a folder is its own project, and reading writes nothing", () => {
    const c = counterpart();
    expect(projectFolders(c.store, `${BUILD}/`, true)).toEqual([BUILD]);
    expect(c.store.folderProjects()).toEqual([]);
    expect(c.store.subjectsOfKind("project")).toEqual([]);
  });

  test("joined, every folder of the project, this one first; off, the folder alone", () => {
    const c = counterpart();
    const out = c.joinProject({ folder: SITE, project: BUILD, by: "owner" });
    expect(out.ok).toBe(true);
    expect(projectFolders(c.store, SITE, true)).toEqual([SITE, BUILD]);
    expect(projectFolders(c.store, BUILD, true)).toEqual([BUILD, SITE]);
    expect(projectFolders(c.store, SITE, false)).toEqual([SITE]);
    expect(projectFolder(`  ${BUILD}//`)).toBe(BUILD);
  });
});

describe("joining and leaving (Counterpart.joinProject / leaveProject)", () => {
  test("joining by a folder names the project after it: a card, a project subject, the first folder by default", () => {
    const c = counterpart();
    const out = c.joinProject({ folder: SITE, project: BUILD, by: "owner" });
    if (!out.ok) throw new Error(out.detail);
    expect(out.born).toBe(true);
    expect(out.changed).toBe(true);
    expect(out.project.name).toBe("build");
    const row = c.store.row(out.project.id);
    expect(row?.type).toBe("schema");
    expect(row?.subject_kind).toBe("project");
    expect(c.store.projectOfFolder(BUILD)?.via).toBe("default");
    expect(c.store.projectOfFolder(SITE)?.via).toBe("owner");
    // A second time changes nothing.
    const again = c.joinProject({ folder: SITE, project: BUILD, by: "owner" });
    expect(again.ok && again.changed).toBe(false);
    expect(c.projects().map((p) => p.folders.length)).toEqual([2]);
  });

  test("a project card is minted, never taken over: a place, a person or a topic card keeps its kind", () => {
    const c = counterpart();
    const place = c.schemas.mention({ name: "Lantern", kind: "place", source: "Lantern", chunkRef: "t", day: 0 });
    const person = c.schemas.mention({ name: "Dana", kind: "person", source: "Dana", chunkRef: "t2", day: 0 });
    const kindBefore = c.store.row(place.id as string)?.subject_kind ?? null;
    const out = c.joinProject({ folder: GARDEN, project: "lantern", by: "owner" });
    if (!out.ok) throw new Error(out.detail);
    expect(out.born).toBe(true);
    expect(out.project.id).not.toBe(place.id as string);
    expect(out.project.name).toBe("lantern");
    expect(c.store.row(place.id as string)?.subject_kind ?? null).toBe(kindBefore);
    const dana = c.joinProject({ folder: QUIET, project: "Dana", by: "owner" });
    expect(dana.ok && dana.project.id !== person.id).toBe(true);
    // A second join by the same name finds the project card.
    const again = c.joinProject({ folder: SITE, project: "Lantern", by: "owner" });
    expect(again.ok && again.project.id).toBe(out.project.id);
  });

  test("a project card links nothing: no alias, no look-back to memories using its word", () => {
    const c = counterpart();
    const uses = put(c, "I picked a random seed for the test.", { scope: BUILD });
    const out = c.joinProject({ folder: join(root, "random"), project: BUILD, by: "owner" });
    if (!out.ok) throw new Error(out.detail);
    const out2 = c.joinProject({ folder: GARDEN, project: join(root, "random"), by: "owner" });
    if (!out2.ok) throw new Error(out2.detail);
    expect(c.schemas.aliasIndex().lookup("random")).toEqual([]);
    expect(c.store.subjectsOf(uses)).not.toContain(out2.project.id);
  });

  test("a faded project card does not split its project, and the card is protected while it has folders", () => {
    const c = counterpart();
    const first = c.joinProject({ folder: GARDEN, project: "Gizmo", by: "owner" });
    if (!first.ok) throw new Error(first.detail);
    expect(c.store.row(first.project.id)?.protected).toBe(1);
    c.store.archive(first.project.id, "faded-by-decay");
    const second = c.joinProject({ folder: QUIET, project: "Gizmo", by: "owner" });
    expect(second.ok && second.project.id).toBe(first.project.id);
    expect(projectFolders(c.store, QUIET, true).sort()).toEqual([GARDEN, QUIET].sort());
    c.leaveProject(GARDEN);
    c.leaveProject(QUIET);
    expect(c.store.row(first.project.id)?.protected).toBe(0);
  });

  test("the whole disk and the store's own folder are refused", () => {
    const c = counterpart();
    const disk = c.joinProject({ folder: "/", project: "Gizmo", by: "owner" });
    expect(disk.ok ? "" : disk.reason).toBe("folder-too-wide");
    const mem = c.joinProject({ folder: storeDir, project: "Gizmo", by: "owner" });
    expect(mem.ok ? "" : mem.reason).toBe("folder-is-the-store");
    const anchor = c.joinProject({ folder: GARDEN, project: "/", by: "owner" });
    expect(anchor.ok ? "" : anchor.reason).toBe("folder-too-wide");
    expect(c.store.folderProjects()).toEqual([]);
  });

  test("a folder is refused as a project of its own, and a non-folder is not a folder", () => {
    const c = counterpart();
    const same = c.joinProject({ folder: BUILD, project: `${BUILD}/`, by: "owner" });
    expect(same.ok ? "" : same.reason).toBe("same-folder");
    const pseudo = c.joinProject({ folder: "claude-desktop:", project: "Lantern", by: "owner" });
    expect(pseudo.ok ? "" : pseudo.reason).toBe("folder-not-a-directory");
  });

  test("leaving makes a folder its own project again; the rest of the project stays", () => {
    const c = counterpart();
    c.joinProject({ folder: SITE, project: BUILD, by: "owner" });
    expect(c.leaveProject(SITE).left).not.toBeNull();
    expect(projectFolders(c.store, SITE, true)).toEqual([SITE]);
    expect(c.store.projectOfFolder(BUILD)).not.toBeNull();
    expect(c.leaveProject(SITE).left).toBeNull();
  });

  test("under observer a join refuses at the store's seam and writes nothing", () => {
    counterpart().close();
    const c = counterpart(undefined, true);
    expect(() => c.joinProject({ folder: SITE, project: "Lantern", by: "owner" })).toThrow();
    expect(c.store.folderProjects()).toEqual([]);
  });
});

describe("travel by project, in the wake", () => {
  test("a joined folder's \"Work here\" reads the whole project; an unjoined one does not", () => {
    const c = counterpart();
    const built = put(c, "The release script tags before it publishes.", { about: "work", scope: BUILD });
    const sited = put(c, "The landing page reads the version from the package file.", { scope: SITE });
    expect(under(wake(c, SITE), WORK_HERE_HEADING)).not.toContain(built);
    c.joinProject({ folder: SITE, project: BUILD, by: "owner" });
    const site = under(wake(c, SITE), WORK_HERE_HEADING);
    expect(site).toContain(built);
    expect(site).toContain(sited);
    expect(under(wake(c, BUILD), WORK_HERE_HEADING)).toContain(sited);
    // Another project's work stays there.
    expect(under(wake(c, GARDEN), WORK_HERE_HEADING)).not.toContain(built);
  });

  test("this folder keeps half the ranked places beside a busier joined folder", () => {
    const c = counterpart();
    for (let i = 0; i < 10; i++) put(c, `Build note number ${String(i)} about the release script.`, { about: "work", scope: BUILD });
    clock += 1;
    const sited = [0, 1, 2, 3, 4].map((i) => put(c, `Site note number ${String(i)} about the landing page.`, { about: "work", scope: SITE }));
    clock += 1;
    for (let i = 10; i < 20; i++) put(c, `Build note number ${String(i)} about the release script.`, { about: "work", scope: BUILD });
    c.joinProject({ folder: SITE, project: BUILD, by: "owner" });
    const pool = workHere(c.store, SITE, { day: c.store.livedDay(), max: 4, pool: 8, excerpt: 60, folders: projectFolders(c.store, SITE, true), craftTravels: true });
    expect(pool.length).toBe(8);
    expect(sited.filter((id) => pool.join("\n").includes(id)).length).toBe(4);
  });

  test("a joined folder the host keeps home (off or paused) shows nothing in the others: no work, no craft, no session", () => {
    clock = NOW;
    const c = counterpart();
    c.joinProject({ folder: SITE, project: BUILD, by: "owner" });
    clock = NOW - 86_400_000;
    const sited = put(c, "The landing page reads the version from the package file.", { about: "work", scope: SITE });
    const craft = put(c, "I check the page on a phone before I ship it.", { kind: "skill", scope: SITE });
    const sessions = (): never[] => [{ session: "s-site", scope: SITE, startedAt: NOW - 3_600_000, lastAt: NOW - 60_000, live: true, endedAt: null }] as never[];
    const text = wake(c, BUILD, { exportsFrom: (f) => f !== SITE, sessions });
    expect(text).not.toContain(sited);
    expect(text).not.toContain(craft);
    expect(text).not.toContain("s-site");
    // Its own wake still has its own work.
    expect(under(wake(c, SITE, { exportsFrom: (f) => f !== SITE }), WORK_HERE_HEADING)).toContain(sited);
  });

  test("off, wakes with folder rows are byte-identical to wakes without them", () => {
    const c = counterpart({ PROJECTS_TRAVEL: false });
    put(c, "The release script tags before it publishes.", { about: "work", scope: BUILD });
    put(c, "The landing page reads the version from the package file.", { scope: SITE });
    const card = put(c, "I read the failing test before the code it covers.", { kind: "skill", scope: GARDEN });
    c.close();
    const twin = join(root, "twin");
    cpSync(storeDir, twin, { recursive: true });
    const other = Counterpart.open({ dir: twin, now: () => clock, timeZone: ZONE, selfTunables: { PROJECTS_TRAVEL: false } });
    open.push(other);
    other.store.setFolderProject(BUILD, card, "default");
    other.store.setFolderProject(SITE, card, "owner");
    const again = counterpart({ PROJECTS_TRAVEL: false });
    const sessions = (): never[] => [{ session: "s-site", scope: SITE, startedAt: NOW - 3_600_000, lastAt: NOW - 60_000, live: true, endedAt: null }] as never[];
    for (const scope of [BUILD, SITE, GARDEN]) {
      const a = wake(again, scope, { exportsFrom: () => true, sessions });
      const b = wake(other, scope, { exportsFrom: () => true, sessions });
      expect(b).toBe(a);
    }
  });

  test("off, a joined folder reads only itself", () => {
    const c = counterpart({ PROJECTS_TRAVEL: false });
    const built = put(c, "The release script tags before it publishes.", { about: "work", scope: BUILD });
    c.joinProject({ folder: SITE, project: BUILD, by: "owner" });
    expect(under(wake(c, SITE), WORK_HERE_HEADING)).not.toContain(built);
  });

  test("a joined folder is here, never named elsewhere; another project's folder still is", () => {
    const c = counterpart();
    c.joinProject({ folder: SITE, project: BUILD, by: "owner" });
    clock = NOW;
    const today = NOW - 60_000;
    const sessions = (): never[] =>
      [
        { session: "s-site", scope: SITE, startedAt: today - 3_600_000, lastAt: today, live: true, endedAt: null },
        { session: "s-garden", scope: GARDEN, startedAt: today - 3_600_000, lastAt: today, live: false, endedAt: today },
      ] as never[];
    put(c, "Footer links moved under the fold.", { about: "work", scope: SITE, title: "Footer links", session: "s-site" });
    put(c, "Tomato stakes go in before the rain.", { about: "work", scope: GARDEN, title: "Tomato stakes", session: "s-garden" });
    const text = wake(c, BUILD, { exportsFrom: () => true, sessions });
    const line = text.split("\n").find((l) => l.startsWith("Today, elsewhere: ")) ?? "";
    const [elsewhere = "", hereAlso = ""] = line.split("Here, also open:");
    expect(elsewhere).toContain("garden");
    expect(elsewhere).not.toContain("build-site");
    // Its open session is this project's: "Here, also open", naming its folder.
    expect(hereAlso).toContain("s-site");
    expect(hereAlso).toContain("build-site");
  });
});

describe("craft travels", () => {
  test("an unmarked skill learned in one folder is a work line in another; one marked work stays home", () => {
    const c = counterpart();
    const craft = put(c, "I read the failing test before the code it covers.", { kind: "skill", scope: BUILD });
    const pinned = put(c, "The release needs the changelog fragment first.", { kind: "skill", about: "work", scope: BUILD });
    const garden = under(wake(c, GARDEN), WORK_HERE_HEADING);
    expect(garden).toContain(craft);
    expect(garden).not.toContain(pinned);
    // And it is still here, where it was learned.
    expect(under(wake(c, BUILD), WORK_HERE_HEADING)).toContain(craft);
  });

  test("craft from a folder the host keeps home does not cross; with no way to ask, none does", () => {
    const c = counterpart();
    const craft = put(c, "I read the failing test before the code it covers.", { kind: "skill", scope: BUILD });
    expect(under(wake(c, GARDEN, { exportsFrom: (s) => s !== BUILD }), WORK_HERE_HEADING)).not.toContain(craft);
    expect(under(wake(c, GARDEN, {}), WORK_HERE_HEADING)).not.toContain(craft);
  });

  test("at most WORK_HERE_CRAFT_MAX from elsewhere, newest first", () => {
    const c = counterpart({ WORK_HERE_CRAFT_MAX: 1 });
    const older = put(c, "I keep commits small enough to read in one sitting.", { kind: "skill", scope: BUILD });
    const ids = [older, put(c, "I name a refusal where it will be seen.", { kind: "skill", scope: QUIET })];
    const garden = under(wake(c, GARDEN), WORK_HERE_HEADING);
    expect(ids.filter((id) => garden.includes(id)).length).toBe(1);
  });

  test("old skills are grandfathered: born before craft started travelling, an unmarked skill stays its folder's work", () => {
    const c = counterpart();
    c.store.setMeta(CRAFT_SINCE_KEY, String(c.store.livedDay() + 1));
    const old = put(c, "I read the failing test before the code it covers.", { kind: "skill", scope: BUILD });
    expect(under(wake(c, GARDEN), WORK_HERE_HEADING)).not.toContain(old);
    expect(under(wake(c, BUILD), WORK_HERE_HEADING)).toContain(old);
  });

  test("a revision of a grandfathered skill stays grandfathered: the successor keeps the day it was first learned", () => {
    const c = counterpart();
    const today = c.store.livedDay();
    c.store.setMeta(CRAFT_SINCE_KEY, String(today));
    const old = c.store.put({
      type: "memory",
      kind: "skill",
      body: "Tiny Castles: don't share a save file between two builds.",
      salience: { relevance: 0.9, emotional: 0.6, predictive: 0.8 },
      origin: { scope: BUILD },
      physics: { birthDay: today - 3, lastUsedDay: today - 3 },
    });
    const next = c.store.supersede(old, {
      type: "memory",
      kind: "skill",
      body: "Tiny Castles: never share one save file between two builds.",
      salience: { relevance: 0.9, emotional: 0.6, predictive: 0.8 },
      origin: { scope: BUILD },
    });
    expect(c.store.row(next)?.birth_day).toBe(today);
    expect(c.store.readProse(next).meta["craftBornDay"]).toBe(today - 3);
    expect(under(wake(c, GARDEN), WORK_HERE_HEADING)).not.toContain(next);
    expect(under(wake(c, BUILD), WORK_HERE_HEADING)).toContain(next);
    // A skill learned today and revised today travels as before.
    clock = NOW - 86_400_000;
    const fresh = put(c, "I name the branch after the brief.", { kind: "skill", scope: BUILD });
    const freshNext = c.store.supersede(fresh, { type: "memory", kind: "skill", body: "I name each branch after its brief.", salience: { relevance: 0.9, emotional: 0.6, predictive: 0.8 }, origin: { scope: BUILD } });
    expect(c.store.readProse(freshNext).meta["craftBornDay"]).toBeUndefined();
    expect(under(wake(c, GARDEN), WORK_HERE_HEADING)).toContain(freshNext);
  });

  test("the first writable open with the switch on records the day craft started travelling, once", () => {
    const c = counterpart();
    const day = c.store.getMeta(CRAFT_SINCE_KEY);
    expect(day).toBe(String(c.store.livedDay()));
    c.close();
    clock += 5 * 86_400_000;
    const again = counterpart();
    expect(again.store.getMeta(CRAFT_SINCE_KEY)).toBe(day);
  });

  test("a skill marked me, us or owner is not a work line; one marked world is craft; a line from elsewhere says where", () => {
    const c = counterpart();
    const owner = put(c, "The owner bakes bread on Sundays with a slow rise.", { kind: "skill", about: "owner", scope: BUILD });
    const world = put(c, "Bread rises faster in a warm kitchen.", { kind: "skill", about: "world", scope: BUILD });
    const garden = under(wake(c, GARDEN), WORK_HERE_HEADING);
    expect(garden).not.toContain(owner);
    expect(under(wake(c, BUILD), WORK_HERE_HEADING)).not.toContain(owner);
    expect(garden).toContain(world);
    expect(garden).toContain(`(from build) (${world})`);
  });

  test("off, an unmarked skill is its folder's work, as before", () => {
    const c = counterpart({ PROJECTS_TRAVEL: false });
    const craft = put(c, "I read the failing test before the code it covers.", { kind: "skill", scope: BUILD });
    expect(under(wake(c, GARDEN), WORK_HERE_HEADING)).not.toContain(craft);
    expect(under(wake(c, BUILD), WORK_HERE_HEADING)).toContain(craft);
  });

  test("workHere direct: craft with no folder travels; craft from the project's own folders is here", () => {
    const c = counterpart();
    const nowhere = put(c, "I say the short answer first.", { kind: "skill" });
    const lines = workHere(c.store, GARDEN, {
      day: c.store.livedDay(),
      max: 4,
      excerpt: 60,
      craftTravels: true,
      craft: { max: 2, from: () => false },
    });
    expect(lines.join("\n")).toContain(nowhere);
  });
});

describe("the console: counterparts project", () => {
  async function cli(argv: readonly string[]): Promise<{ code: number; out: string[]; err: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run([...argv, "--dir", storeDir], { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, home: root });
    return { code, out, err };
  }

  test("list, join by folder, join by name, leave", async () => {
    counterpart().close();
    open.length = 0;
    let r = await cli(["project"]);
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toContain("Every folder is its own project");
    r = await cli(["project", "join", "~/build-site/", "~/build"]);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out[0]).toContain("Joined ~/build-site to build");
    r = await cli(["project", "join", "~/garden", "Lantern Works"]);
    expect(r.code).toBe(0);
    r = await cli(["project", "list"]);
    const listed = r.out.join("\n");
    expect(listed).toContain("build (");
    expect(listed).toContain("~/build-site  — joined by you");
    expect(listed).toContain("Lantern Works (");
    r = await cli(["project", "leave", "~/garden"]);
    expect(r.code).toBe(0);
    expect(r.out[0]).toContain("its own project again");
    r = await cli(["project", "join", "~/garden"]);
    expect(r.code).not.toBe(0);
    r = await cli(["project", "join", "/", "Gizmo"]);
    expect(r.code).not.toBe(0);
    expect(r.err.join("\n")).toContain('"/" is the whole disk');
    r = await cli(["project", "join", "~/not-made-yet", "Gizmo"]);
    expect(r.code).toBe(0);
    expect(r.err.join("\n")).toContain("~/not-made-yet does not exist (yet)");
    r = await cli(["project", "join", "~/garden", "Lantern", "--observer"]);
    expect(r.code).not.toBe(0);
    expect(r.err.join("\n")).toContain("observer");
  });
});

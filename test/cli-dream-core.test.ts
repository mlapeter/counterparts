/**
 * The console's two windows onto dreaming + consolidation (2026-09-26):
 * `counterparts dream` (--list / --show / --undo) and `counterparts core`
 * (--list / --demote) — plus the rows `fired` keeps for them and the two doctor
 * lines (the v8 upgrade's proof, and dreaming).
 *
 * Hermetic: a fresh temp store per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dreamingFindings, upgradeV8Findings } from "../src/adapters/claude-code/doctor.js";
import type { DoctorInput } from "../src/adapters/claude-code/doctor.js";
import { run } from "../src/adapters/cli/index.js";
import { MECHANISMS, firedReport } from "../src/adapters/fired.js";
import { Counterpart } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import type { PutInput } from "../src/core/store/index.js";

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-cli-dream-"));
  dir = join(root, "store");
  Counterpart.open({ dir }).close();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function cli(argv: readonly string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run([...argv, "--dir", dir], {
    io: { out: (l) => out.push(l), err: (l) => err.push(l) },
  });
  return { code, out, err };
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    ...over,
  });
}

/** One journaled dream that merged two memories and drew a link. */
function dreamed(): { id: string; a: string; b: string; c: string; merged: string } {
  const c = Counterpart.open({ dir, owner: true });
  try {
    c.store.advanceClock("2026-09-20");
    const day = c.store.livedDay();
    const at = { physics: { birthDay: day, lastUsedDay: day } };
    const a = mem(c, "The migration step must run before the container boots, or it boots empty.", at);
    const b = mem(c, "Run the migration before starting the container, otherwise it starts empty.", at);
    const third = mem(c, "The health check should fail when the tables are missing.", at);
    c.store.advanceClock("2026-09-21");
    const out = c.dreams.begin({ session: "s-cli" });
    if (!out.ok) throw new Error(`begin refused: ${out.reason}`);
    const id = out.bundle.dream;
    const proposed = c.dreams.propose({
      dream: id,
      session: "s-cli",
      changes: [
        { action: "link", a, b: third },
        { action: "merge", ids: [a, b], text: "Run the migration before the container boots, or it boots empty." },
      ],
    });
    if (!proposed.ok) throw new Error("propose refused");
    const merged = proposed.results[1]?.id as string;
    const j = c.dreams.journal({ dream: id, session: "s-cli", title: "Boot order", text: "I dreamed the container kept booting empty." });
    if (!j.ok) throw new Error("journal refused");
    return { id, a, b, c: third, merged };
  } finally {
    c.close();
  }
}

describe("counterparts dream", () => {
  test("--list on a store that never dreamed says so", async () => {
    const { code, out } = await cli(["dream"]);
    expect(code).toBe(0);
    // The setting comes first (2026-09-28), then the list; `ask` by default (2026-09-29).
    expect(out[0]).toStartWith("Dreaming: ask.");
    expect(out).toContain("No dreams yet.");
  });

  test("--list, --show and --undo", async () => {
    const d = dreamed();
    const list = await cli(["dream", "--list"]);
    expect(list.code).toBe(0);
    const row = list.out.find((l) => l.startsWith(d.id)) ?? "";
    expect(row).toContain('"Boot order"');
    expect(row).toContain("journaled");
    expect(row).toContain("1 merge");
    expect(row).toContain("1 link");

    const show = await cli(["dream", "--show", d.id]);
    expect(show.code).toBe(0);
    const text = show.out.join("\n");
    expect(text).toContain("I dreamed the container kept booting empty.");
    expect(text).toContain(`merge into ${d.merged}`);
    expect(text).toContain(`from ${d.a}`);
    expect(text).toContain("link:");

    const undo = await cli(["dream", "--undo", d.id]);
    expect(undo.code).toBe(0);
    expect(undo.out[0]).toContain("2 changes reversed");
    const s = Store.open({ dir, observer: true });
    try {
      expect(s.row(d.a)?.archived).toBe(0);
      expect(s.row(d.b)?.archived).toBe(0);
      expect(s.row(d.merged)?.archived).toBe(1);
      expect(s.dream(d.id)?.state).toBe("undone");
    } finally {
      s.close();
    }
    const after = await cli(["dream", "--show", d.id]);
    expect(after.out.join("\n")).toContain("[undone]");
  });

  test("refusals: no id, an unknown id, two modes, and an observer's undo", async () => {
    const d = dreamed();
    expect((await cli(["dream", "--undo"])).code).toBe(1);
    const unknown = await cli(["dream", "--show", "drm_nope"]);
    expect(unknown.code).toBe(2);
    expect(unknown.err[0]).toContain("no dream drm_nope");
    expect((await cli(["dream", "--show", d.id, "--undo", d.id])).code).toBe(1);
    const stood = await cli(["dream", "--undo", d.id, "--observer"]);
    expect(stood.code).toBe(2);
    expect(stood.err[0]).toContain("observer");
  });
});

describe("counterparts core", () => {
  function promoted(): string {
    const c = Counterpart.open({ dir, owner: true });
    try {
      const id = mem(c, "I say what I do not know before I guess.", { kind: "self" });
      c.store.updatePhysics(id, { promotedIdentity: true });
      c.store.setBand(id, "identity", c.store.livedDay());
      c.store.appendCoreEvent({ memoryId: id, action: "promoted", day: c.store.livedDay(), lane: "fast", actor: "sleep" });
      return id;
    } finally {
      c.close();
    }
  }

  test("--list on an empty core", async () => {
    const { code, out } = await cli(["core"]);
    expect(code).toBe(0);
    expect(out[0]).toContain("The core is empty");
  });

  test("--list shows the lane; --demote needs a reason and sends it back to ordinary fading", async () => {
    const id = promoted();
    const list = await cli(["core", "--list"]);
    expect(list.out.join("\n")).toContain(`${id}  self   fast lane`);

    const bare = await cli(["core", "--demote", id]);
    expect(bare.code).toBe(1);
    expect(bare.err[0]).toContain("needs a reason");

    const done = await cli(["core", "--demote", id, "--reason", "it was a phase, not me"]);
    expect(done.code).toBe(0);
    expect(done.out.join("\n")).toContain("lanes will not promote it again");
    const s = Store.open({ dir, observer: true });
    try {
      expect(s.physicsOf(id).promotedIdentity).toBe(false);
      expect(s.coreDemoted(id)).toBe(true);
      expect(s.eventLog({ name: "band.demoted", limit: 5 }).length).toBe(1);
    } finally {
      s.close();
    }
    const after = await cli(["core"]);
    expect(after.out.join("\n")).toContain("it was a phase, not me");

    const again = await cli(["core", "--demote", id, "--reason", "twice"]);
    expect(again.code).toBe(2);
    expect(again.err[0]).toContain("is not in the core");
  });

  test("an observer console reads the core and refuses the demotion", async () => {
    const id = promoted();
    const stood = await cli(["core", "--demote", id, "--reason", "no", "--observer"]);
    expect(stood.code).toBe(2);
    expect(stood.err[0]).toContain("observer");
    expect((await cli(["core", "--observer"])).code).toBe(0);
  });

  test("--reason without --demote is refused", async () => {
    expect((await cli(["core", "--reason", "why"])).code).toBe(1);
  });
});

describe("fired: the rows for dreaming and consolidation", () => {
  test("every new row exists, and a dream, a return and a gist fire", () => {
    const ids = new Set(MECHANISMS.map((m) => m.id));
    for (const id of ["returns", "dream", "dream-changes", "dream-ask", "dream-replays", "core-demote", "upgrade-census", "gist"]) {
      expect(ids.has(id), id).toBe(true);
    }
    const c = Counterpart.open({ dir, owner: true });
    let today = "";
    try {
      c.store.advanceClock("2026-09-20");
      const day = c.store.livedDay();
      const a = mem(c, "The deploy needs the migration first.", { physics: { birthDay: day, lastUsedDay: day } });
      const b = mem(c, "The container boots before its tables exist.", { physics: { birthDay: day, lastUsedDay: day } });
      mem(c, "A health check would have caught it.", { physics: { birthDay: day, lastUsedDay: day } });
      for (const date of ["2026-09-21", "2026-09-22", "2026-09-23"]) c.store.advanceClock(date);
      c.store.reinforce(a, c.store.livedDay(), "referenced");
      const out = c.dreams.begin({ session: "s-f" });
      if (!out.ok) throw new Error(out.reason);
      c.dreams.propose({
        dream: out.bundle.dream,
        session: "s-f",
        changes: [{ action: "gist", text: "Order matters at boot: migrations first.", sources: [a, b] }],
      });
      const j = c.dreams.journal({
        dream: out.bundle.dream,
        session: "s-f",
        text: "I dreamed of containers waking before their tables, and the pattern was plain: order matters at boot.",
      });
      expect(j.ok).toBe(true);
      today = c.store.today();
    } finally {
      c.close();
    }
    const s = Store.open({ dir, observer: true });
    try {
      const report = firedReport(s, today);
      const row = (id: string) => report.rows.find((r) => r.id === id);
      expect(row("returns")?.state).toBe("firing");
      expect(row("dream")?.state).toBe("firing");
      expect(row("dream-changes")?.state).toBe("firing");
      expect(row("gist")?.state).toBe("firing");
      // core-demote never fired here. It is the owner's door out of the core,
      // so its silence is an occasion that has not come: "waiting", on any
      // calendar (2026-10-09; it read "new", then "never", before).
      const since = MECHANISMS.find((m) => m.id === "core-demote")?.since as string;
      expect(row("core-demote")?.state).toBe("waiting");
      expect(firedReport(s, since).rows.find((r) => r.id === "core-demote")?.state).toBe("waiting");
    } finally {
      s.close();
    }
  });
});

describe("doctor: the v8 upgrade and dreaming", () => {
  function withStore<T>(fn: (s: Store) => T): T {
    const s = Store.open({ dir });
    try {
      return fn(s);
    } finally {
      s.close();
    }
  }

  test("a store born at v8 gets no upgrade line", () => {
    withStore((s) => expect(upgradeV8Findings(s)).toEqual([]));
  });

  test("amber before the census, green when it read zero down, red when it did not", () => {
    withStore((s) => {
      s.setMeta("physics.v8.upgrade", JSON.stringify({ from: "7", day: 3, rows: 12, consolidated: 4, identity: 1 }));
      expect(upgradeV8Findings(s)[0]?.severity).toBe("amber");
      s.setMeta(
        "physics.v8.census",
        JSON.stringify({ checked: 11, bandDown: 0, bandUp: 0, weaker: 0, pruneSooner: 0, pruneLater: 0, legacy: 11, consolidated: 4 }),
      );
      const green = upgradeV8Findings(s)[0];
      expect(green?.severity).toBe("green");
      expect(green?.detail).toBe(
        "Upgrade to v8: 11 memories checked by the old arithmetic and the new; none changed band, none weaker, none prunes sooner; 4 kept their old consolidation",
      );
      // What the self-comparison cannot see: rows the old rules were about to make core.
      s.setMeta(
        "physics.v8.census",
        JSON.stringify({ checked: 11, bandDown: 0, bandUp: 0, weaker: 0, pruneSooner: 0, pruneLater: 0, legacy: 11, consolidated: 4, v7WouldPromote: 2 }),
      );
      const road = upgradeV8Findings(s)[0];
      expect(road?.severity).toBe("green");
      expect(road?.detail).toContain("2 were on the old road to the core and take the durability route now");
      s.setMeta(
        "physics.v8.census",
        JSON.stringify({ checked: 11, bandDown: 1, bandUp: 0, weaker: 0, pruneSooner: 0, pruneLater: 0, legacy: 11, consolidated: 4 }),
      );
      expect(upgradeV8Findings(s)[0]?.severity).toBe("red");
    });
  });

  test("the dreaming line says when it last dreamed and what today's ask did", () => {
    const input = { today: "2026-09-21" } as unknown as DoctorInput;
    // The setting leads the line (2026-09-28).
    withStore((s) => expect(dreamingFindings(input, s)[0]?.detail).toBe("ask; has not dreamed yet; not started today"));
    dreamed();
    withStore((s) => {
      s.setDreamAsk({ date: "2026-09-21", state: "declined", day: s.livedDay() });
      const detail = dreamingFindings(input, s)[0]?.detail ?? "";
      expect(detail).toContain('"Boot order"');
      expect(detail).toContain("the owner said not today");
    });
  });
});

/**
 * THE PER-DIRECTORY HANDOFF (E1) — the row, its exemptions, the pointer at the
 * wake, the expiry, and the proof that a store with no handoff composes exactly
 * the wake it composed before this module existed.
 *
 * Hermetic by construction (CLAUDE.md): every test makes a fresh temp data dir
 * in `beforeEach` and removes only that path in `afterEach`, on failure too.
 *
 * The handoff bodies here are NEUTRAL PLACEHOLDER PROSE, for the reason the
 * page's fixtures are: a fixture that reads like real working context is one
 * somebody later mistakes for some.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { episodeGate } from "../src/core/bridge.js";
import { Counterpart } from "../src/core/counterpart.js";
import {
  HANDOFF_EXCERPT_BYTES,
  HANDOFF_KIND,
  HANDOFF_LIFE_DAYS,
  HANDOFF_MAX_BYTES,
  HANDOFF_RESERVE_MARGIN_BYTES,
  HANDOFF_RESERVE_MAX_BYTES,
  HANDOFF_CLEARED_EVENT,
  HANDOFF_REFUSED_EVENT,
  HANDOFF_ROLE,
  HANDOFF_SHOWN_EVENT,
  HANDOFF_WRITTEN_EVENT,
  Handoffs,
  excerpt,
  findHandoffRow,
  handoffRows,
  handoffTitle,
  isHandoffRow,
  pointerBlock,
  readHandoff,
  reserveBytes,
} from "../src/core/handoff/index.js";
import type { Handoff } from "../src/core/handoff/index.js";
import { isHandoff } from "../src/core/recall/index.js";
import { runCycle } from "../src/core/sleep/index.js";
import { Store } from "../src/core/store/index.js";
import { readSentinel } from "../src/core/self/index.js";
import { MECHANISMS, firedReport } from "../src/adapters/fired.js";
import { DURABLE_EVENT_NAMES } from "../src/adapters/dashboard/registries.js";
import { REF_KIND } from "../src/adapters/dashboard/web/narrate.js";
import { TOOL_NAMES, openServer, toolSpec } from "../src/adapters/mcp/index.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import { canonicalScope } from "../src/adapters/sessions.js";
import { run as cliRun } from "../src/adapters/cli/index.js";

const HERE = "/tmp/placeholder-project-a";
const THERE = "/tmp/placeholder-project-b";
const BODY = "Placeholder: the parser rewrite is half done; the failing case is the empty input.";
const BODY_TWO = "Placeholder: the parser rewrite landed; next is the error messages.";

let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env["COUNTERPARTS_DATA_DIR"];
  dir = mkdtempSync(join(tmpdir(), "counterparts-handoff-"));
  process.env["COUNTERPARTS_DATA_DIR"] = dir;
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed by the test */
    }
  }
  rmSync(dir, { recursive: true, force: true });
  if (priorEnv === undefined) delete process.env["COUNTERPARTS_DATA_DIR"];
  else process.env["COUNTERPARTS_DATA_DIR"] = priorEnv;
});

function store(opts: Parameters<typeof Store.open>[0] = {}): Store {
  const s = Store.open({ dir, ...opts });
  open.push(s);
  return s;
}

/** A `Handoffs` with the REAL battery, which is what the root injects. */
function handoffs(s: Store, observer = false): Handoffs {
  return new Handoffs({ store: s, gate: episodeGate(), observer });
}

function counterpart(opts: Parameters<typeof Counterpart.open>[0] = {}): Counterpart {
  const c = Counterpart.open({ dir, ...opts });
  open.push(c.store);
  return c;
}

function eventNames(s: Store): string[] {
  return s.eventLog({ limit: 1000 }).map((r) => r.name);
}

/** A console the CLI can write to, and answer prompts from. */
function consoleLines(answers: readonly string[] = []): {
  io: CliIo;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const queue = [...answers];
  return {
    io: {
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
      ...(answers.length > 0
        ? { prompt: async (): Promise<string> => queue.shift() ?? "" }
        : {}),
    },
    out,
    err,
  };
}

function runCli(argv: readonly string[], io: Parameters<typeof cliRun>[1]["io"]): Promise<number> {
  return cliRun(argv, { io, env: { COUNTERPARTS_DATA_DIR: dir } });
}

type CliIo = Parameters<typeof cliRun>[1]["io"];

// ── the row ─────────────────────────────────────────────────────────────────

describe("the handoff's row", () => {
  test("a blank store has no handoff for any directory", () => {
    const s = store();
    expect(findHandoffRow(s, HERE)).toBeNull();
    expect(readHandoff(s, HERE)).toBeNull();
    expect(handoffs(s).read(HERE)).toBeNull();
    expect(handoffs(s).anyLive()).toBe(false);
  });

  test("the seam writes ONE schema row, filed under the directory, and NOT protected", () => {
    const s = store();
    const out = handoffs(s).write({ body: BODY, scope: HERE, session: "s1" });
    expect(out.written).toBe(true);
    expect(out.reason).toBe("created");
    expect(out.version).toBe(0);
    expect(out.showsForDays).toBe(HANDOFF_LIFE_DAYS);

    const id = out.id as string;
    const row = s.row(id);
    expect(row?.type).toBe("schema");
    expect(row?.kind).toBe(HANDOFF_KIND);
    expect(row?.archived).toBe(0);
    // NOT PROTECTED is the load-bearing half: `protected` is the one flag that
    // would stop `pruneVerdict` ever letting this row go, and a handoff is the
    // one standing row in the store that is MEANT to be let go.
    expect(row?.protected).toBe(0);

    const doc = s.readProse(id);
    expect(doc.meta["role"]).toBe(HANDOFF_ROLE);
    expect(doc.meta["scope"]).toBe(HERE);
    expect(doc.meta["writtenDay"]).toBe(s.livedDay());
    expect(doc.meta["writtenOn"]).toBe(s.today());
    expect(doc.meta["session"]).toBe("s1");
    expect(doc.title).toBe(handoffTitle(HERE));
    expect(doc.body).toBe(BODY);
    expect(out.gate).toBeNull();
    expect(out.redacted).toBeNull();
  });

  test("two directories keep two rows, and neither can see the other's", () => {
    const s = store();
    const h = handoffs(s);
    h.write({ body: BODY, scope: HERE });
    h.write({ body: BODY_TWO, scope: THERE });
    expect(h.read(HERE)?.body).toBe(BODY);
    expect(h.read(THERE)?.body).toBe(BODY_TWO);
    expect(s.list({ type: "schema", kind: HANDOFF_KIND, archived: false })).toHaveLength(2);
  });

  test("a newer handoff REVISES the same row; the one it replaced is kept as a version", () => {
    const s = store();
    const h = handoffs(s);
    const first = h.write({ body: BODY, scope: HERE, session: "s1" });
    const second = h.write({ body: BODY_TWO, scope: HERE, session: "s2" });
    expect(second.reason).toBe("revised");
    expect(second.id).toBe(first.id as string);
    expect(second.version).toBe(1);
    // ONE row, still.
    expect(s.list({ type: "schema", kind: HANDOFF_KIND, archived: false })).toHaveLength(1);
    expect(h.read(HERE)?.body).toBe(BODY_TWO);
    // And the loser is readable, which is what "last writer wins, loser kept"
    // means: two sessions closing in one directory at the same moment.
    const versions = s.versions(first.id as string);
    expect(versions).toHaveLength(1);
    expect(s.readVersion(first.id as string, versions[0]?.seq as number).body).toBe(BODY);
  });

  test("a write moves the DWELL CLOCK, so a long-lived row is never pruned out from under the wake", () => {
    // `store.revise` writes prose and versions and touches no physics column, so
    // without this a row born on day 1 and rewritten on day 200 reads
    // `lastUsedDay = 1` — dwell 199, under the floor — and `pruneVerdict`
    // archives a pointer written this morning.
    const s = store();
    const h = handoffs(s);
    const first = h.write({ body: BODY, scope: HERE, day: 1 });
    expect(s.row(first.id as string)?.last_used_day).toBe(1);
    const second = h.write({ body: BODY_TWO, scope: HERE, day: 200 });
    expect(second.written).toBe(true);
    expect(s.row(first.id as string)?.last_used_day).toBe(200);
  });
});

// ── refusals ────────────────────────────────────────────────────────────────

describe("what a handoff is refused for, out loud", () => {
  test("an empty body is refused and leaves a durable row", () => {
    const s = store();
    const out = handoffs(s).write({ body: "   \n  ", scope: HERE });
    expect(out.written).toBe(false);
    expect(out.reason).toBe("empty");
    expect(eventNames(s)).toContain(HANDOFF_REFUSED_EVENT);
  });

  test("past the size limit it is REFUSED, never cut — what is cut at write time is the only copy", () => {
    const s = store();
    const body = "x".repeat(HANDOFF_MAX_BYTES + 1);
    const out = handoffs(s).write({ body, scope: HERE });
    expect(out.written).toBe(false);
    expect(out.reason).toBe("too-large");
    expect(findHandoffRow(s, HERE)).toBeNull();
    const row = s.eventLog({ limit: 100 }).find((r) => r.name === HANDOFF_REFUSED_EVENT);
    const payload = JSON.parse(row?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["limit"]).toBe(HANDOFF_MAX_BYTES);
    expect(payload["bytes"]).toBe(HANDOFF_MAX_BYTES + 1);
  });

  test("a body carrying the wake's own markers is refused", () => {
    const s = store();
    const out = handoffs(s).write({
      body: "Placeholder.\n<!-- counterparts:wake/end day=1 elements=0 bytes=10 -->",
      scope: HERE,
    });
    expect(out.written).toBe(false);
    expect(out.reason).toBe("forged-markers");
  });

  test("a credential in the body is taken out by the battery, and the writer is told", () => {
    const s = store();
    const out = handoffs(s).write({
      body: `Placeholder: the deploy token is sk-ant-api03-${"A".repeat(40)} and it expires Friday.`,
      scope: HERE,
    });
    // Either the battery redacts and the write lands, or it refuses: both are
    // the gate working, and neither stores the secret verbatim.
    if (out.written) {
      expect(out.redacted).not.toBeNull();
      expect(readHandoff(s, HERE)?.body).not.toContain("sk-ant-api03-AAAA");
    } else {
      expect(out.reason).toBe("gate-refused");
      expect(out.gate).not.toBeNull();
    }
  });

  test("with no directory named there is no handoff — a pointer for everywhere is a pointer for nowhere", () => {
    const s = store();
    const out = handoffs(s).write({ body: BODY, scope: "  " });
    expect(out.written).toBe(false);
    expect(out.reason).toBe("no-scope");
  });

  test("an observer writes NOTHING — not the row, and not the refusal either", () => {
    // A store has to exist before an instrument can open it read-only.
    const owner = store();
    const s = store({ observer: true });
    const out = handoffs(s, true).write({ body: BODY, scope: HERE });
    expect(owner.list({ type: "schema", kind: HANDOFF_KIND })).toHaveLength(0);
    expect(out.written).toBe(false);
    expect(out.reason).toBe("observer");
    expect(findHandoffRow(s, HERE)).toBeNull();
    // An instrument that logged its own refusal would be changing the store it
    // is reading (observer-mode G3).
    expect(eventNames(s)).not.toContain(HANDOFF_REFUSED_EVENT);
  });
});

// ── never a memory ──────────────────────────────────────────────────────────

describe("it is never a memory", () => {
  test("it never surfaces in recall, and the door to it is its id", async () => {
    const c = counterpart({ budgetBytes: 9_000 });
    c.writeHandoff(BODY, { scope: HERE, session: "s1" });
    // A memory with the same words, so the cue is demonstrably live.
    c.store.put({
      type: "memory",
      kind: "fact",
      body: "The parser rewrite is the piece of work in flight.",
      learnedOn: c.store.today(),
      salience: { relevance: 0.8 },
    });
    const out = c.recallForTurn({ sessionId: "s1", text: "where did the parser rewrite get to?" });
    const reached = [...out.decision.surfaced, ...out.decision.footnotes];
    expect(reached).not.toContain(c.readHandoff(HERE)?.id as string);
  });

  test("expanding it by id credits NOTHING — working context never reinforces", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    const written = c.writeHandoff(BODY, { scope: HERE, session: "s1" });
    const id = written.id as string;
    const before = c.store.row(id);
    expect(before?.uses).toBe(0);
    expect(before?.reinforced_days).toBe(0);

    const summary = c.creditReferences("s1", {
      assistantTurns: [`I read ${id} and picked up where it left off.`],
      expansions: [id],
    });
    expect(summary.credited).toBe(0);
    const after = c.store.row(id);
    expect(after?.uses).toBe(0);
    expect(after?.reinforced_days).toBe(0);
  });

  test("a full sleep cycle leaves it live, unmerged, unpromoted and out of every lane", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    const id = c.writeHandoff(BODY, { scope: HERE, session: "s1" }).id as string;
    // A second row with the SAME words, which is what dedup exists to merge.
    c.store.put({
      type: "memory",
      kind: "fact",
      body: BODY,
      learnedOn: c.store.today(),
      salience: { relevance: 0.5 },
    });
    for (let i = 2; i < 8; i++) {
      runCycle({
        store: c.store,
        date: `2026-09-0${i}`,
        render: () => ({ bytes: 1 }),
      });
    }
    const row = c.store.row(id);
    expect(row?.archived).toBe(0);
    expect(row?.superseded_by).toBeNull();
    expect(row?.promoted_identity).toBe(0);
    expect(row?.band).not.toBe("identity");
    expect(c.readHandoff(HERE)?.body).toBe(BODY);
    // And it is in no briefing lane: `scanActive` lists `{ type: "memory" }`.
    const brief = c.rebrief({ budgetBytes: 9_000 });
    expect(brief.rendered).toBe(true);
    const woke = c.wake(9_000);
    expect(woke.text).not.toContain(BODY);
  });

  test("the predicates agree — `recall/`'s structural read and `handoff/`'s row read", () => {
    const s = store();
    const id = handoffs(s).write({ body: BODY, scope: HERE }).id as string;
    expect(isHandoff(s.readProse(id))).toBe(true);
    expect(isHandoffRow(s, id)).toBe(true);
    const other = s.put({ type: "memory", kind: "fact", body: "Placeholder." });
    expect(isHandoffRow(s, other)).toBe(false);
    expect(isHandoff(s.readProse(other))).toBe(false);
  });
});

// ── the pointer at the wake ─────────────────────────────────────────────────

describe("the pointer at the wake", () => {
  test("the directory that has one is handed two lines of it, with its id", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    c.writeHandoff(BODY, { scope: HERE, session: "s1" });
    c.rebrief({ budgetBytes: 9_000, at: "2026-09-20" });
    const woke = c.wake(9_000, { date: "2026-09-20" }, { scope: HERE, session: "s2" });
    const id = c.readHandoff(HERE)?.id as string;
    expect(woke.text).toContain("Where I left off in this directory (2026-09-20):");
    expect(woke.text).toContain(BODY);
    expect(woke.text).toContain(id);
    expect(woke.text).toContain("expand it with the counterparts recall tool");
  });

  test("another directory's wake carries nothing of it", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    c.writeHandoff(BODY, { scope: HERE });
    c.rebrief({ budgetBytes: 9_000, at: "2026-09-20" });
    const woke = c.wake(9_000, { date: "2026-09-20" }, { scope: THERE });
    expect(woke.text).not.toContain("Where I left off");
    expect(woke.text).not.toContain(BODY);
  });

  test("the SENTINEL still verifies, and its lane counts are untouched by the pointer", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    c.store.put({
      type: "memory",
      kind: "self",
      body: "Placeholder identity element.",
      band: "identity",
      learnedOn: c.store.today(),
      salience: { relevance: 0.8, emotional: 0.5, predictive: 0.5 },
      physics: { promotedIdentity: true },
    });
    c.rebrief({ budgetBytes: 9_000, at: "2026-09-20" });
    const plain = c.wake(9_000, { date: "2026-09-20" }, { scope: THERE });
    c.writeHandoff(BODY, { scope: HERE });
    const withPointer = c.wake(9_000, { date: "2026-09-20" }, { scope: HERE });

    const a = readSentinel(plain.text);
    const b = readSentinel(withPointer.text);
    expect(a.intact).toBe(true);
    // The pointer is FURNITURE: the bundle is bigger and carries no more
    // elements, so the counts are the same and both numbers are still true.
    expect(b.intact).toBe(true);
    expect(b.statedElements).toBe(a.statedElements);
    expect(b.statedBytes).toBe(withPointer.bytes);
    expect(withPointer.bytes).toBeGreaterThan(plain.bytes);
    expect(withPointer.sentinel).toBe(b.line);
    // The HEADER states the delivered total too, from the other end (§1 G2).
    expect(withPointer.text.split("\n")[0]).toContain(`bytes=${withPointer.bytes}`);
  });

  test("the pointer sits at the FOOT of the bundle, above the sentinel and below every lane", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    c.writeHandoff(BODY, { scope: HERE });
    c.rebrief({ budgetBytes: 9_000, at: "2026-09-20" });
    const text = c.wake(9_000, { date: "2026-09-20" }, { scope: HERE }).text;
    const lines = text.split("\n");
    const pointerAt = lines.findIndex((l) => l.startsWith("Where I left off"));
    expect(pointerAt).toBeGreaterThan(0);
    expect(lines[lines.length - 1]).toContain("counterparts:wake/end");
    expect(pointerAt).toBeLessThan(lines.length - 1);
  });

  test("a read that is NOT a delivery gets the published bundle, pointer and all left off", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    c.writeHandoff(BODY, { scope: HERE });
    c.rebrief({ budgetBytes: 9_000, at: "2026-09-20" });
    // The dashboard and replay read this way: no `delivery`, no preface, and so
    // no pointer either — a bundle nobody is being handed is nobody's directory.
    const woke = c.wake(9_000);
    expect(woke.text).not.toContain("Where I left off");
  });

  test("shown writes ONE durable row, after the splice, naming the age and the cost", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    c.writeHandoff(BODY, { scope: HERE });
    c.rebrief({ budgetBytes: 9_000, at: "2026-09-20" });
    const before = c.wake(9_000, { date: "2026-09-20" }, { scope: THERE });
    expect(eventNames(c.store)).not.toContain(HANDOFF_SHOWN_EVENT);
    expect(before.text).not.toContain("Where I left off");

    c.wake(9_000, { date: "2026-09-20" }, { scope: HERE, session: "s2" });
    const row = c.store.eventLog({ limit: 200 }).find((r) => r.name === HANDOFF_SHOWN_EVENT);
    expect(row).toBeDefined();
    const payload = JSON.parse(row?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["session"]).toBe("s2");
    expect(payload["ageDays"]).toBe(0);
    expect(typeof payload["bytes"]).toBe("number");
    expect(payload["bytes"] as number).toBeGreaterThan(0);
  });

  test("the block never grows past its reserve, at the widest it can be", () => {
    // The reserve is what the boundary subtracts from the ceiling; a block that
    // could outgrow it is a wake that blows the host's cliff by its own last
    // line. Widest: a full-width excerpt, a real id, a six-digit lived day.
    const widest: Handoff = {
      id: "sch_ffffffffffff",
      scope: HERE,
      body: "Ω".repeat(HANDOFF_MAX_BYTES / 2),
      bytes: HANDOFF_MAX_BYTES,
      writtenOn: "2026-09-20",
      writtenDay: 999_999,
      session: "s1",
      version: 9,
    };
    const block = pointerBlock(widest, 999_999) as string;
    expect(block).not.toBeNull();
    expect(new TextEncoder().encode(block).length).toBeLessThanOrEqual(HANDOFF_RESERVE_MAX_BYTES);
    // And the excerpt itself stays inside its own cap.
    expect(new TextEncoder().encode(excerpt(widest.body)).length).toBeLessThanOrEqual(
      HANDOFF_EXCERPT_BYTES,
    );
    // …and on plain ASCII too, where the cut lands on a different boundary.
    expect(
      new TextEncoder().encode(excerpt("word ".repeat(200))).length,
    ).toBeLessThanOrEqual(HANDOFF_EXCERPT_BYTES);
  });

  test("a ceiling with no room drops the pointer whole rather than cutting it", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    c.writeHandoff(BODY, { scope: HERE });
    // Composed at a generous ceiling, delivered at a mean one: one boundary's
    // lag, which is how every wake fact behaves.
    c.rebrief({ budgetBytes: 9_000, at: "2026-09-20" });
    const woke = c.wake(300, { date: "2026-09-20" }, { scope: HERE });
    expect(woke.text).not.toContain("Where I left off");
    expect(eventNames(c.store)).not.toContain(HANDOFF_SHOWN_EVENT);
    expect(c.events("counterpart.handoff.noroom")).toHaveLength(1);
  });
});

// ── the expiry ──────────────────────────────────────────────────────────────

describe("it expires, in lived days", () => {
  test("the pointer shows through the fortnight and stops the day after", () => {
    const s = store();
    const h = handoffs(s);
    const written = h.write({ body: BODY, scope: HERE, day: 10 });
    expect(written.written).toBe(true);
    const at = (day: number): Handoff | null => h.read(HERE, day);
    expect(at(10)?.body).toBe(BODY);
    // FOURTEEN lived days counting the one it was written on, so the last day
    // it shows is `writtenDay + 13` and the first it does not is `+ 14`.
    expect(at(10 + HANDOFF_LIFE_DAYS - 1)?.body).toBe(BODY);
    expect(at(10 + HANDOFF_LIFE_DAYS)).toBeNull();
    // The ROW is still there — nothing new forgets it. The ordinary prune does.
    expect(findHandoffRow(s, HERE)).not.toBeNull();
    expect(h.readAny(HERE)?.body).toBe(BODY);
  });

  test("an expired pointer is never spliced, and no row claims it was shown", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    c.writeHandoff(BODY, { scope: HERE, day: 0 });
    // The lived clock advances ONE day per distinct date the store is told
    // about — that is the point of it, and a fortnight of use takes a fortnight
    // of dates whatever the wall clock did in between.
    for (let i = 1; i <= HANDOFF_LIFE_DAYS + 1; i++) {
      c.store.advanceClock(`2026-10-${String(i).padStart(2, "0")}`);
    }
    expect(c.store.livedDay()).toBeGreaterThan(HANDOFF_LIFE_DAYS);
    c.rebrief({ budgetBytes: 9_000, at: "2026-10-20" });
    const woke = c.wake(9_000, { date: "2026-10-20" }, { scope: HERE });
    expect(woke.text).not.toContain("Where I left off");
    expect(eventNames(c.store)).not.toContain(HANDOFF_SHOWN_EVENT);
  });

  test("a handoff with no recorded lived day has already run out", () => {
    // Only reachable on a hand-minted row. An undated pointer cannot be aged,
    // and showing one forever is the failure the expiry exists to prevent.
    const s = store();
    const id = s.put({
      type: "schema",
      kind: HANDOFF_KIND,
      title: handoffTitle(HERE),
      body: BODY,
      meta: { role: HANDOFF_ROLE, scope: HERE },
    });
    expect(readHandoff(s, HERE)?.id).toBe(id);
    expect(handoffs(s).read(HERE)).toBeNull();
  });

  test("writing again renews it — the clock runs from the last write, not the first", () => {
    const s = store();
    const h = handoffs(s);
    h.write({ body: BODY, scope: HERE, day: 0 });
    h.write({ body: BODY_TWO, scope: HERE, day: 12 });
    expect(h.read(HERE, 20)?.body).toBe(BODY_TWO);
    expect(h.read(HERE, 12 + HANDOFF_LIFE_DAYS - 1)?.body).toBe(BODY_TWO);
    expect(h.read(HERE, 12 + HANDOFF_LIFE_DAYS)).toBeNull();
  });
});

// ── the reserve ─────────────────────────────────────────────────────────────

describe("the reserve is conditional, which is what keeps a blank store honest", () => {
  test("no handoff anywhere ⇒ the compose budget is master's, to the byte", () => {
    const c = counterpart();
    const report = c.rebrief({ budgetBytes: 9_000 });
    // 160 is `PREFACE_RESERVE_BYTES`, and it is the whole of the subtraction.
    expect(report.composeBudget).toBe(9_000 - 160);
  });

  test("one live handoff ANYWHERE ⇒ room is reserved, sized to the block that EXISTS", () => {
    const c = counterpart();
    c.writeHandoff(BODY, { scope: HERE });
    const blocks = c.handoffs.liveBlockBytes();
    expect(blocks).toHaveLength(1);
    const report = c.rebrief({ budgetBytes: 9_000 });
    expect(report.composeBudget).toBe(9_000 - 160 - ((blocks[0] as number) + HANDOFF_RESERVE_MARGIN_BYTES));
    // …and the block that exists is well under the ceiling the flat reserve
    // used to take: the review measured 295 bytes of ceiling spent on nothing.
    expect((blocks[0] as number) + HANDOFF_RESERVE_MARGIN_BYTES).toBeLessThan(HANDOFF_RESERVE_MAX_BYTES);
  });

  test("a ceiling too small for the share rule reserves NOTHING, so no lane pays for it", () => {
    // The review's measurement (MAJOR-1): at a 1,200-byte ceiling a session in
    // a directory with NO handoff lost 4 of its 6 identity elements to a
    // store-wide reserve it would never be handed anything for.
    const a = counterpart();
    for (let i = 0; i < 40; i++) {
      a.store.put({
        id: `mem_reserve0000${String(i).padStart(2, "0")}`,
        type: "memory",
        kind: "self",
        body: `Placeholder identity element ${i}, long enough to compete for a tight budget.`,
        band: "identity",
        learnedOn: a.store.today(),
        salience: { relevance: 0.9, emotional: 0.6, predictive: 0.6 },
        physics: { promotedIdentity: true },
      });
    }
    const before = a.rebrief({ budgetBytes: 1_200, at: "2026-09-20" });
    a.writeHandoff(BODY, { scope: HERE });
    const after = a.rebrief({ budgetBytes: 1_200, at: "2026-09-20" });
    // The COMPOSE BUDGET is the property: nothing was taken out of it, so no
    // lane was trimmed for a pointer this ceiling will not carry. (The element
    // COUNT is not comparable across two boundaries — the identity lane rotates
    // at every one, by design.)
    expect(after.composeBudget).toBe(before.composeBudget);
    expect(after.composeBudget).toBe(1_200 - 160);
    expect(a.handoffs.liveBlockBytes()).toHaveLength(1);
    // A session in ANOTHER directory is handed nothing and has lost nothing.
    const woke = a.wake(1_200, { date: "2026-09-20" }, { scope: THERE });
    expect(woke.text).not.toContain("Where I left off");
  });

  test("the share rule is one comparison, and it is stated where it is decided", () => {
    // Pure, so the rule can be read without a store in the room.
    expect(reserveBytes([], 9_000)).toBe(0);
    expect(reserveBytes([250], 9_000)).toBe(250 + HANDOFF_RESERVE_MARGIN_BYTES);
    // Never past the measured widest block.
    expect(reserveBytes([10_000], 1_000_000)).toBe(HANDOFF_RESERVE_MAX_BYTES);
    // Off below the share: a 250-byte block needs 8 × 298 = 2,384 bytes of ceiling.
    expect(reserveBytes([250], 2_383)).toBe(0);
    expect(reserveBytes([250], 2_384)).toBe(250 + HANDOFF_RESERVE_MARGIN_BYTES);
    // The WIDEST live block decides, not the first.
    expect(reserveBytes([100, 300, 200], 9_000)).toBe(300 + HANDOFF_RESERVE_MARGIN_BYTES);
  });

  test("once every handoff has expired the reserve goes away again", () => {
    const c = counterpart();
    c.writeHandoff(BODY, { scope: HERE, day: 0 });
    for (let i = 1; i <= HANDOFF_LIFE_DAYS + 1; i++) {
      c.store.advanceClock(`2026-10-${String(i).padStart(2, "0")}`);
    }
    expect(c.rebrief({ budgetBytes: 9_000 }).composeBudget).toBe(9_000 - 160);
  });

  test("the reserved room is enough: a full store still delivers the pointer inside the ceiling", () => {
    // The failure this guards is silent and slow — a store whose composition
    // fills the ceiling drops the pointer at every wake and only
    // `handoff.shown` going quiet says so.
    const c = counterpart();
    for (let i = 0; i < 60; i++) {
      c.store.put({
        type: "memory",
        kind: "self",
        body: `Placeholder identity element ${i}, written long enough to compete for the budget.`,
        band: "identity",
        learnedOn: c.store.today(),
        salience: { relevance: 0.9, emotional: 0.6, predictive: 0.6 },
        physics: { promotedIdentity: true },
      });
    }
    c.writeHandoff(BODY, { scope: HERE });
    for (const budget of [2_500, 4_096, 9_000]) {
      c.rebrief({ budgetBytes: budget, at: "2026-09-20" });
      const woke = c.wake(budget, { date: "2026-09-20" }, { scope: HERE });
      expect(woke.text).toContain("Where I left off in this directory");
      expect(woke.bytes).toBeLessThanOrEqual(budget);
    }
  });
});

// ── the registries ──────────────────────────────────────────────────────────

describe("the owner can see it fire", () => {
  test("all three names are registered, and two mechanisms account for them", () => {
    expect(DURABLE_EVENT_NAMES).toContain(HANDOFF_WRITTEN_EVENT);
    expect(DURABLE_EVENT_NAMES).toContain(HANDOFF_SHOWN_EVENT);
    expect(DURABLE_EVENT_NAMES).toContain(HANDOFF_REFUSED_EVENT);
    const ids = MECHANISMS.map((m) => m.id);
    expect(ids).toContain("handoff-written");
    expect(ids).toContain("handoff-shown");
  });

  test("the fired view reads both rows once a session has left one and one has been handed it", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    c.writeHandoff(BODY, { scope: HERE, session: "s1" });
    c.rebrief({ budgetBytes: 9_000, at: "2026-09-20" });
    c.wake(9_000, { date: "2026-09-20" }, { scope: HERE, session: "s2" });
    const report = firedReport(c.store, c.store.today(), { probes: false });
    const written = report.rows.find((m) => m.id === "handoff-written");
    const shown = report.rows.find((m) => m.id === "handoff-shown");
    expect(written?.total).toBeGreaterThan(0);
    expect(shown?.total).toBeGreaterThan(0);
    expect(written?.state).not.toBe("blind");
    expect(shown?.state).not.toBe("blind");
  });
});

// ── the field on the ask ────────────────────────────────────────────────────

describe("the field on the session_end ask", () => {
  const SESSION = "sess_handoff_1";

  function mcp(opts: Parameters<typeof openServer>[0] = {}): ReturnType<typeof openServer> {
    const s = openServer({ dir, session: SESSION, scope: HERE, owner: true, ...opts });
    open.push(s.counterpart);
    return s;
  }

  function payload(result: { structuredContent?: unknown }): Record<string, unknown> {
    return (result.structuredContent ?? {}) as Record<string, unknown>;
  }

  test("the tool ADVERTISES it, as a field and never as a tool of its own", () => {
    const schema = toolSpec("session_end")?.inputSchema as Record<string, unknown>;
    const props = schema["properties"] as Record<string, Record<string, unknown>>;
    expect(props["handoff"]?.["type"]).toBe("string");
    // Not required, and not inside an entry: it is about the DIRECTORY, not
    // about any one thing that was learned.
    expect(schema["required"]).toEqual(["memories"]);
    const item = (props["memories"]?.["items"] as Record<string, unknown>)["properties"] as Record<
      string,
      unknown
    >;
    expect(item["handoff"]).toBeUndefined();
    // And it stays the same list of tools: a field is not a door.
    expect(TOOL_NAMES).not.toContain("handoff");
  });

  test("a dump carrying the field lands both halves, and the result says so", async () => {
    const s = mcp();
    const out = payload(
      await s.call("session_end", {
        session: SESSION,
        memories: [{ content: "The parser rewrite needs the empty-input case before it can land." }],
        handoff: BODY,
      }),
    );
    expect(out["deposited"]).toBe(1);
    const handoff = out["handoff"] as Record<string, unknown>;
    expect(handoff["written"]).toBe(true);
    expect(handoff["reason"]).toBe("created");
    expect(handoff["showsForDays"]).toBe(HANDOFF_LIFE_DAYS);
    expect(s.counterpart.readHandoff(HERE)?.body).toBe(BODY);
  });

  test("no field, no handoff — a session that finished what it started leaves nothing", async () => {
    const s = mcp();
    const out = payload(
      await s.call("session_end", {
        session: SESSION,
        memories: [{ content: "The empty-input case is handled and the rewrite is done." }],
      }),
    );
    expect(out["handoff"]).toBeUndefined();
    expect(s.counterpart.readHandoff(HERE)).toBeNull();
  });

  test("a malformed memories array still leaves the handoff — the two halves are not one fate", async () => {
    const s = mcp();
    const out = payload(
      await s.call("session_end", { session: SESSION, memories: [], handoff: BODY }),
    );
    expect(out["reason"]).toBe("memories-required");
    expect((out["handoff"] as Record<string, unknown>)["written"]).toBe(true);
    expect(s.counterpart.readHandoff(HERE)?.body).toBe(BODY);
  });

  test("a server the host named no directory for writes none — a pointer for everywhere is for nowhere", async () => {
    // There is no "general" or anonymous scope in this tree. The nearest thing
    // is `resolveScope`'s last resort — the STORE's own directory — and a
    // handoff filed there would be handed to every session in every project.
    // Reached here by passing it as the scope, which is the route that reads as
    // deliberate and is the one worth guarding.
    const s = mcp({ scope: dir });
    const out = payload(
      await s.call("session_end", {
        session: SESSION,
        memories: [{ content: "Something learned with no directory to belong to." }],
        handoff: BODY,
      }),
    );
    expect((out["handoff"] as Record<string, unknown>)["reason"]).toBe("no-scope");
    expect(s.counterpart.store.list({ type: "schema", kind: HANDOFF_KIND })).toHaveLength(0);
    // …and the refusal is DURABLE, which is what MAJOR-2a was about: this door
    // used to short-circuit with a ring-only event and no row at all.
    expect(eventNames(s.counterpart.store)).toContain(HANDOFF_REFUSED_EVENT);
  });

  test("a PRESENT but blank field retires this directory's pointer, over the wire", async () => {
    const s = mcp();
    await s.call("session_end", {
      session: SESSION,
      memories: [{ content: "The empty-input case is the one still failing in the rewrite." }],
      handoff: BODY,
    });
    expect(s.counterpart.readHandoff(HERE)?.body).toBe(BODY);
    const out = payload(
      await s.call("session_end", {
        session: SESSION,
        memories: [{ content: "The empty-input case is handled and the rewrite is done." }],
        handoff: "   ",
      }),
    );
    const handoff = out["handoff"] as Record<string, unknown>;
    expect(handoff["written"]).toBe(true);
    expect(handoff["reason"]).toBe("cleared");
    expect(s.counterpart.readHandoff(HERE)).toBeNull();
    expect(eventNames(s.counterpart.store)).toContain(HANDOFF_CLEARED_EVENT);
  });

  test("a field that is not text is a NAMED, durable refusal — never a silence", async () => {
    const s = mcp();
    const out = payload(
      await s.call("session_end", {
        session: SESSION,
        memories: [{ content: "Something learned while the handoff field carried a number." }],
        handoff: 42,
      }),
    );
    expect((out["handoff"] as Record<string, unknown>)["reason"]).toBe("not-text");
    expect(eventNames(s.counterpart.store)).toContain(HANDOFF_REFUSED_EVENT);
    expect(s.counterpart.readHandoff(HERE)).toBeNull();
  });

  test("an observer stands down over the wire, handoff and all", async () => {
    const owner = mcp();
    await owner.call("session_end", {
      session: SESSION,
      memories: [{ content: "A first memory so the store exists and holds something." }],
    });
    const instrument = mcp({ observer: true });
    const out = payload(
      await instrument.call("session_end", {
        session: SESSION,
        memories: [{ content: "An instrument's dump, which lands nowhere." }],
        handoff: BODY,
      }),
    );
    expect(out["stoodDown"]).toBe(true);
    expect(owner.counterpart.readHandoff(HERE)).toBeNull();
  });

  test("the handoff written through the ask is expandable by its id, and credits nothing", async () => {
    const s = mcp();
    await s.call("session_end", {
      session: SESSION,
      memories: [{ content: "The parser rewrite needs the empty-input case before it can land." }],
      handoff: BODY,
    });
    const id = s.counterpart.readHandoff(HERE)?.id as string;
    const out = payload(await s.call("recall", { handle: id }));
    expect(out["reason"]).toBe("expanded");
    expect(JSON.stringify(out["memories"])).toContain(BODY);
    // Expanded, and still not a memory: the read is allowed, the CREDIT is not.
    const summary = s.counterpart.creditReferences(SESSION, {
      assistantTurns: [`Picked up from ${id}.`],
      expansions: [id],
    });
    expect(summary.credited).toBe(0);
    expect(s.counterpart.store.row(id)?.uses).toBe(0);
  });
});

// ── what the adversarial review of 2026-09-20 found ─────────────────────────

describe("the review's findings, each with the thing that was wrong", () => {
  test("MAJOR-2a: a handoff with no directory to be about leaves a DURABLE row", () => {
    // The rule used to live at the MCP door, which emitted a ring-only event
    // and wrote nothing, so guarantee 3 was false on the only live entrance.
    const s = store();
    const h = handoffs(s);
    for (const scope of ["", "   ", s.dir, `${s.dir}/`]) {
      const before = s.eventLog({ limit: 500 }).length;
      const out = h.write({ body: BODY, scope });
      expect(out.written).toBe(false);
      expect(out.reason).toBe("no-scope");
      const rows = s.eventLog({ limit: 500 });
      expect(rows.length).toBe(before + 1);
      expect(rows[rows.length - 1]?.name).toBe(HANDOFF_REFUSED_EVENT);
    }
    expect(findHandoffRow(s, HERE)).toBeNull();
  });

  test("MAJOR-2b: a PRESENT but blank field retires the pointer, and says so", () => {
    const s = store();
    const h = handoffs(s);
    h.write({ body: BODY, scope: HERE, session: "s1" });
    expect(h.read(HERE)?.body).toBe(BODY);
    const out = h.clear(HERE, { session: "s2" });
    expect(out.written).toBe(true);
    expect(out.reason).toBe("cleared");
    // Gone from every read, gone from the reserve, and the words are still
    // there on the archived row for an owner who asks for it by id.
    expect(h.read(HERE)).toBeNull();
    expect(h.readAny(HERE)).toBeNull();
    expect(h.anyLive()).toBe(false);
    expect(s.row(out.id as string)?.archived).toBe(1);
    expect(s.readProse(out.id as string).body).toBe(BODY);
    expect(eventNames(s)).toContain(HANDOFF_CLEARED_EVENT);
    // And the next handoff here mints a fresh row rather than reviving one.
    const again = h.write({ body: BODY_TWO, scope: HERE });
    expect(again.reason).toBe("created");
    expect(again.id).not.toBe(out.id as string);
  });

  test("MAJOR-2b: clearing a directory that has no pointer is a named, durable fact", () => {
    const s = store();
    const out = handoffs(s).clear(HERE);
    expect(out.written).toBe(false);
    expect(out.reason).toBe("nothing-to-clear");
    expect(eventNames(s)).toContain(HANDOFF_REFUSED_EVENT);
  });

  test("MINOR-1: no room for the pointer leaves a durable row, deduped by day", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    c.writeHandoff(BODY, { scope: HERE });
    c.rebrief({ budgetBytes: 9_000, at: "2026-09-20" });
    for (let i = 0; i < 3; i++) c.wake(300, { date: "2026-09-20" }, { scope: HERE });
    const rows = c.store
      .eventLog({ limit: 500 })
      .filter((r) => r.name === HANDOFF_REFUSED_EVENT)
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>)
      .filter((p) => p["reason"] === "no-room");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["budget"]).toBe(300);
  });

  test("MINOR-2: `handoff.shown` is one row per directory per lived day", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    c.writeHandoff(BODY, { scope: HERE });
    c.rebrief({ budgetBytes: 9_000, at: "2026-09-20" });
    for (let i = 0; i < 12; i++) {
      c.wake(9_000, { date: "2026-09-20" }, { scope: HERE, session: `s${i}` });
    }
    const shown = c.store.eventLog({ limit: 500 }).filter((r) => r.name === HANDOFF_SHOWN_EVENT);
    expect(shown).toHaveLength(1);
  });

  test("MINOR-4: a control character or a bidi override never reaches the wake", () => {
    const c = counterpart({ budgetBytes: 9_000 });
    c.writeHandoff(
      "Placeholder\u0000 with \u001b[31m an escape ‮ and an override, work half done.",
      { scope: HERE },
    );
    c.rebrief({ budgetBytes: 9_000, at: "2026-09-20" });
    const text = c.wake(9_000, { date: "2026-09-20" }, { scope: HERE }).text;
    expect(text).toContain("Where I left off");
    expect(text).not.toContain("\u0000");
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("‮");
    // And the line-injection block the scar asks for is untouched.
    expect(text.split("\n").filter((l) => l.startsWith("Where I left off"))).toHaveLength(1);
  });

  test("MINOR-6: a TITLED handoff still points at its substance", () => {
    expect(excerpt("# Handoff for the parser work\n\nThe empty-input case still fails.")).toBe(
      "The empty-input case still fails.",
    );
    expect(excerpt("Handoff\n=======\n\nThe empty-input case still fails.")).toBe("Handoff");
    expect(excerpt("### A heading\n## Another\n\nSubstance here.")).toBe("Substance here.");
    // A page that is nothing BUT headings still says something rather than nothing.
    expect(excerpt("# Only a heading")).toBe("# Only a heading");
  });

  test("MINOR-7: a body the gate empties is refused, never stored unredacted", () => {
    const s = store();
    // A gate that accepts and hands back nothing — the trapdoor the old
    // `|| draft` fallback pointed at.
    const emptying = new Handoffs({
      store: s,
      gate: () => ({ ok: true, text: "" }),
    });
    const out = emptying.write({ body: BODY, scope: HERE });
    expect(out.written).toBe(false);
    expect(out.reason).toBe("empty-after-gate");
    expect(findHandoffRow(s, HERE)).toBeNull();
    expect(eventNames(s)).toContain(HANDOFF_REFUSED_EVENT);
  });

  test("a refusal the STORE raises is named and durable too — not a throw out of the seam", () => {
    // F5's floor refuses inputs of its own (a whitespace- or NUL-only body, a
    // lone surrogate). An uncaught throw here would hand the caller an error
    // and the owner no row, which is MAJOR-2's shape on a different input.
    const s = store();
    const refusing = new Handoffs({
      store: new Proxy(s, {
        get(target, prop, recv) {
          if (prop === "put") {
            return () => {
              throw Object.assign(new Error("STORE_REFUSED"), { code: "MEMORY_BODY_EMPTY" });
            };
          }
          return Reflect.get(target, prop, recv) as unknown;
        },
      }) as Store,
      gate: episodeGate(),
    });
    const out = refusing.write({ body: BODY, scope: HERE });
    expect(out.written).toBe(false);
    expect(out.reason).toBe("store-refused");
    const row = s.eventLog({ limit: 100 }).find((r) => r.name === HANDOFF_REFUSED_EVENT);
    expect(row).toBeDefined();
    const payload = JSON.parse(row?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["reason"]).toBe("store-refused");
    expect(payload["code"]).toBe("MEMORY_BODY_EMPTY");
    expect(findHandoffRow(s, HERE)).toBeNull();
  });

  test("a body the floor itself refuses never reaches the store unnamed", () => {
    // The live shapes F5 named. Today the battery turns all of these away
    // first, which is why the row says `gate-refused` — but either way it is a
    // NAMED refusal with a durable row, never a throw and never silence.
    const s = store();
    const h = handoffs(s);
    for (const body of ["\u0000\u0000", "\u0000 x \u0000", "\ud800\ud800", "​​"]) {
      const before = s.eventLog({ limit: 500 }).length;
      const out = h.write({ body, scope: HERE });
      expect(out.written).toBe(false);
      expect(["gate-refused", "empty", "empty-after-gate", "store-refused"]).toContain(out.reason);
      expect(s.eventLog({ limit: 500 }).length).toBe(before + 1);
    }
    expect(findHandoffRow(s, HERE)).toBeNull();
  });

  test("MINOR-8: two rows for one directory — newest wins, and the loser stops holding the reserve", () => {
    const s = store();
    const h = handoffs(s);
    const meta = (day: number): Record<string, unknown> => ({
      role: HANDOFF_ROLE,
      scope: HERE,
      writtenOn: s.today(),
      writtenDay: day,
      session: null,
    });
    // Minted directly, which is what a cross-process race would leave behind.
    const older = s.put({
      type: "schema",
      kind: HANDOFF_KIND,
      title: handoffTitle(HERE),
      body: BODY,
      meta: meta(1),
    });
    const newer = s.put({
      type: "schema",
      kind: HANDOFF_KIND,
      title: handoffTitle(HERE),
      body: BODY_TWO,
      meta: meta(4),
    });
    expect(findHandoffRow(s, HERE)).toBe(newer);
    expect(h.read(HERE, 4)?.body).toBe(BODY_TWO);
    // The reserve counts DIRECTORIES, not rows.
    expect(h.liveBlockBytes(4)).toHaveLength(1);
    // And the next write retires the loser.
    h.write({ body: "Placeholder: a third handoff for this directory.", scope: HERE, day: 5 });
    expect(s.row(older)?.archived).toBe(1);
    expect(handoffRows(s)).toHaveLength(1);
  });

  test("MINOR-9: a handoff is never queued for embedding — and the self page still is", () => {
    const c = counterpart();
    const hid = c.writeHandoff(BODY, { scope: HERE }).id as string;
    const mid = c.store.put({ type: "memory", kind: "fact", body: "An ordinary memory." });
    const pid = c.revisePage("## Core\n\nPlaceholder.\n\n## Lately\n\nPlaceholder.", {
      reason: "probe",
      by: "owner",
    }).id as string;
    const missing = c.store.missingVectors();
    expect(missing).not.toContain(hid);
    expect(missing).toContain(mid);
    // NOT fixed here, on purpose, and asserted so the day somebody fixes it in
    // `self/` this line is what tells them E1 was watching: the self page is in
    // exactly the same position and is S1's question, not this seam's.
    expect(missing).toContain(pid);
    // The backlog doctor watches gets no floor from handoffs.
    expect(c.store.unembeddedCount()).toBe(missing.length);
  });

  test("NIT 1 and 2: the life is fourteen lived days, and the last one never says zero", () => {
    const s = store();
    const h = handoffs(s);
    h.write({ body: BODY, scope: HERE, day: 0 });
    const shown = (day: number): string | null => h.pointer(HERE, day)?.block ?? null;
    expect(shown(0) ?? "").toContain(`${HANDOFF_LIFE_DAYS} more days`);
    expect(shown(HANDOFF_LIFE_DAYS - 2) ?? "").toContain("2 more days");
    expect(shown(HANDOFF_LIFE_DAYS - 1) ?? "").toContain("one more day");
    expect(shown(HANDOFF_LIFE_DAYS)).toBeNull();
    // Fourteen days of showing, counting the day it was written — which is what
    // every word around the constant says.
    let days = 0;
    for (let d = 0; d < 40; d++) if (shown(d) !== null) days += 1;
    expect(days).toBe(HANDOFF_LIFE_DAYS);
    expect(shown(0) ?? "").not.toContain("0 more days");
  });

  test("NIT 3: the refusal row's bytes and the returned bytes agree", () => {
    const s = store();
    const out = handoffs(s).write({ body: "   \n\n  ", scope: HERE });
    const row = s.eventLog({ limit: 100 }).find((r) => r.name === HANDOFF_REFUSED_EVENT);
    const payload = JSON.parse(row?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["bytes"]).toBe(out.bytes);
  });

  test("NIT 5: a handoff row resolves through its OWN door on the dashboard", () => {
    expect(REF_KIND["handoff.written"]).toBe("handoff");
    expect(REF_KIND["handoff.shown"]).toBe("handoff");
    expect(REF_KIND["handoff.written"]).not.toBe("memory");
  });
});

// ── MAJOR-3, answered on the v6 floor ───────────────────────────────────────

/**
 * A HANDOFF ROW WHOSE WORDS ARE GONE, in the two shapes F5 tells apart.
 *
 * Before the floor landed, both stood every session down out of `Schemas.load`
 * — s1c's MAJOR-1 with a new row class, and E1 is what multiplies the rows it
 * can happen to, since there is one per directory and it is written
 * automatically. On v6 they are two different worlds, and this is the pair of
 * tests that says which.
 */
describe("a handoff row whose words are gone", () => {
  /** Reach into box 2 the way a half-written repair or a disk event would. */
  function blank(s: Store, id: string, tombstone: boolean): void {
    const db = (s as unknown as { ops: { run: (sql: string, ...a: unknown[]) => void } }).ops;
    if (tombstone) db.run("UPDATE memories SET body = '', content_hash = '' WHERE id = ?", id);
    else db.run("UPDATE memories SET body = '' WHERE id = ?", id);
  }

  test("TOMBSTONED (body and hash both blank): the session starts, and the pointer is simply absent", () => {
    const first = counterpart();
    const id = first.writeHandoff(BODY, { scope: HERE }).id as string;
    blank(first.store, id, true);
    first.store.close();
    open.length = 0;

    // F5 taught `Schemas.load` to skip a tombstone by name, so this no longer
    // stands the session down — the row is gone from the index and from every
    // reader here, and the wake goes out as if the directory had no handoff.
    const c = counterpart();
    expect(c.readHandoff(HERE)).toBeNull();
    expect(c.handoffs.anyLive()).toBe(false);
    c.rebrief({ budgetBytes: 9_000, at: "2026-09-20" });
    const woke = c.wake(9_000, { date: "2026-09-20" }, { scope: HERE });
    expect(woke.ok).toBe(true);
    expect(woke.text).not.toContain("Where I left off");
  });

  test("FAULTED (blank body, real hash): the session stands down — and `remove` is the exit", async () => {
    const first = counterpart();
    const id = first.writeHandoff(BODY, { scope: HERE }).id as string;
    blank(first.store, id, false);
    first.store.close();
    open.length = 0;

    // This IS the named fault F5 introduced, and it is loud on purpose: an
    // empty body with a hash that still names it is a state no write path in
    // this build produces.
    expect(() => counterpart()).toThrow();

    // `verify` names the row — the id is the only handle there is on this
    // floor — and exits non-zero rather than printing a green census over it.
    const before = consoleLines();
    expect(await runCli(["verify"], before.io)).not.toBe(0);
    expect(before.err.join("\n")).toContain(id);
    expect(before.err.join("\n")).toContain("Rows whose words are missing");

    // And the exit the message names works for a handoff row like any other:
    // removing it tombstones it, and sessions start again.
    const c = consoleLines([id]);
    const code = await runCli(["remove", id, "--confirm", "--reason", "faulted row"], c.io);
    expect(`${String(code)} ${c.err.join(" | ")}`).toBe("0 ");
    const after = counterpart();
    expect(after.readHandoff(HERE)).toBeNull();
    after.rebrief({ budgetBytes: 9_000, at: "2026-09-20" });
    expect(after.wake(9_000, { date: "2026-09-20" }, { scope: HERE }).ok).toBe(true);
  });
});

// ── the two ends meet ───────────────────────────────────────────────────────

/**
 * THE ONE TEST WHERE THE WRITER AND THE READER ARE DIFFERENT PROCESSES' CODE.
 *
 * Everywhere above, both ends are handed the same literal string, so the scope
 * match is asserted against itself. The live path is not that: the MCP server
 * canonicalises the directory the host named at launch (`hostScope` ->
 * `canonicalScope`) and writes it into `meta.scope`; the SessionStart hook gets
 * its own from the session registry or `startDirectory`, canonicalised by the
 * same function, and `findHandoffRow` compares the two as exact strings. On
 * this platform `/var` is a symlink to `/private/var`, so a temp directory is
 * exactly the shape that would catch the two ends disagreeing.
 */
describe("the session that writes it and the session that reads it", () => {
  test("written through the ask in a directory, handed back at the next wake there", async () => {
    // A real directory, named the way a host names one — unresolved.
    const here = mkdtempSync(join(tmpdir(), "counterparts-scope-"));
    try {
      const s = openServer({ dir, session: "sess_a", scope: here, owner: true });
      open.push(s.counterpart);
      await s.call("session_end", {
        session: "sess_a",
        memories: [{ content: "The empty-input case is the one still failing in the rewrite." }],
        handoff: BODY,
      });
      await s.counterpart.sessionEnd({ date: "2026-09-20", budgetBytes: 9_000 });
      s.counterpart.close();
      open.length = 0;

      // A DIFFERENT adapter, in a different process's shape, given the scope the
      // hook entry point would have resolved.
      const a = openAdapter(
        { dataDir: dir, injectionBudgetBytes: 9_000, owner: true },
        { command: "/bin/true", args: ["runner"] },
      );
      open.push(a.counterpart);
      const out = a.sessionStart({
        sessionId: "sess_b",
        scope: canonicalScope(here),
        at: "2026-09-20",
      });
      expect(out.ok).toBe(true);
      expect(out.injection).toContain("Where I left off in this directory (2026-09-20):");
      expect(out.injection).toContain(BODY);
      // The sentinel the hook records as the delivery expectation is the
      // DELIVERED one — the pointer included.
      expect(out.sentinel).toContain(`bytes=${out.bytes}`);
      expect(out.injection.trimEnd().endsWith(out.sentinel as string)).toBe(true);
      // And the durable row says a session was handed it, not merely that one
      // existed (scar §2.3).
      const row = a.counterpart.store
        .eventLog({ limit: 200 })
        .find((r) => r.name === HANDOFF_SHOWN_EVENT);
      expect(row).toBeDefined();
      expect((JSON.parse(row?.payload ?? "{}") as Record<string, unknown>)["session"]).toBe(
        "sess_b",
      );
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
  });

  test("a session waking in a NEIGHBOURING directory is handed nothing", async () => {
    const here = mkdtempSync(join(tmpdir(), "counterparts-scope-"));
    const there = mkdtempSync(join(tmpdir(), "counterparts-scope-"));
    try {
      const s = openServer({ dir, session: "sess_a", scope: here, owner: true });
      open.push(s.counterpart);
      await s.call("session_end", {
        session: "sess_a",
        memories: [{ content: "The empty-input case is the one still failing in the rewrite." }],
        handoff: BODY,
      });
      await s.counterpart.sessionEnd({ date: "2026-09-20", budgetBytes: 9_000 });
      s.counterpart.close();
      open.length = 0;

      const a = openAdapter(
        { dataDir: dir, injectionBudgetBytes: 9_000, owner: true },
        { command: "/bin/true", args: ["runner"] },
      );
      open.push(a.counterpart);
      const out = a.sessionStart({
        sessionId: "sess_b",
        scope: canonicalScope(there),
        at: "2026-09-20",
      });
      expect(out.injection).not.toContain("Where I left off");
      expect(eventNames(a.counterpart.store)).not.toContain(HANDOFF_SHOWN_EVENT);
    } finally {
      rmSync(here, { recursive: true, force: true });
      rmSync(there, { recursive: true, force: true });
    }
  });
});

/**
 * `doctor`, the session-start notice, and `credentials set` — I32's three
 * answers, against real temp stores.
 *
 * The incident: for a week the detached worker was refused at every boundary
 * (a credentials file rewritten to the template), the clock froze, no sleep
 * cycle ran, nothing was embedded — and every visible surface read healthy. The
 * evidence became durable in #95; these are the surfaces that READ it, and the
 * properties asserted here are the ones that make the difference between
 * evidence and a warning:
 *
 *   - the console's credential reading comes from the FILE, not from the shell
 *     that ran it (the owner's shell exports both names; hook processes inherit
 *     neither, measured day 0 — a doctor that counted its own environment would
 *     reproduce I32 inside the diagnostic);
 *   - a red finding reaches the TERMINAL as `systemMessage`, and the wake it
 *     travels with is byte-identical to the plain one;
 *   - a healthy day prints exactly what it printed before — plain stdout, no
 *     JSON wrapper on a transport nobody has measured;
 *   - `credentials set` never lets the value reach argv, stdout or stderr.
 *
 * Hermetic by construction (CLAUDE.md): fresh temp dirs per test, removed in
 * `afterEach`, and every `git` reading is INJECTED — a test whose verdict
 * depended on the developer's own `git status` would pass and fail with it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ADAPTER_ASK_EVENT,
  BOUNDARY_EVENT,
  CHECKOUT_EVENT,
  Counterpart,
  EMBED_BACKFILL_EVENT,
  GATE_DEPOSIT_EVENT,
  RECALL_CREDIT_EVENT,
  SLEEP_CYCLE_EVENT,
  SNAPSHOT_TAKEN_EVENT,
  SPAWN_REFUSED_EVENT,
  SWEEP_GATE_EVENT,
} from "../src/core/counterpart.js";
import { DATABASE_FILE, STORE_CREATED_KEY, Store, dateOf } from "../src/core/store/index.js";
import {
  JOURNAL_COPY_FAILED_EVENT,
  JOURNAL_COPY_WRITTEN_EVENT,
} from "../src/core/self/journal-file.js";
import { journalModeOf, openDb } from "../src/core/store/db.js";
import {
  CHECKOUT_BUDGET_MS,
  NOTICE_MAX_CHARS,
  NOTICE_TAIL,
  SPAWN_REFUSAL_PREFIX,
  TUNABLES,
  anyRed,
  RESTORE_STEPS,
  doctorFindings,
  loadConfig,
  noticeMessage,
  openAdapter,
  readCheckout,
  reportJson,
  reportLines,
} from "../src/adapters/claude-code/index.js";
import type { CheckoutReading, DoctorInput, Finding, GitRunner } from "../src/adapters/claude-code/index.js";
import { EMBEDDER_ON_COMMAND } from "../src/adapters/claude-code/doctor.js";
import { ENVELOPE_MAX_CHARS, hostDelivery } from "../src/adapters/claude-code/bin/hook.js";
import {
  EXIT,
  HOST_EVENTS,
  MCP_SERVER_NAME,
  STORE_STARTED_KEY,
  readHost,
  run,
} from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { MODEL_FILE, STATIC_WEIGHTS_ENV } from "../src/core/embed/static.js";

const SECRET = "sk-ant-not-a-real-key-0123456789";

let root: string;
let dir: string;
let configPath: string;
/** Where an older install kept its API keys. Nothing reads it now; the tests
 *  that write one prove that. */
let credsPath: string;
let savedWeights: string | undefined;
const open: Counterpart[] = [];
const stores: Store[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-doctor-"));
  dir = join(root, "store");
  configPath = join(root, "claude-code.json");
  credsPath = join(root, "credentials.env");
  // THE LOCAL TABLE, found: a weights folder holding the table file, named by
  // the one environment variable, so the Recall line grades the configuration
  // and not whether this checkout has the weights package installed.
  const weights = join(root, "weights");
  mkdirSync(weights, { recursive: true });
  writeFileSync(join(weights, MODEL_FILE), "a table");
  savedWeights = process.env[STATIC_WEIGHTS_ENV];
  process.env[STATIC_WEIGHTS_ENV] = weights;
});

afterEach(() => {
  for (const s of stores.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (savedWeights === undefined) delete process.env[STATIC_WEIGHTS_ENV];
  else process.env[STATIC_WEIGHTS_ENV] = savedWeights;
  rmSync(root, { recursive: true, force: true });
});

/**
 * A snapshot directory beside the store — the default location, which is
 * `<root>/snapshots` because `dir` is `<root>/store`. It holds a file the
 * store's layout classifies, because that is what makes a directory one this
 * package wrote rather than one that merely wears the name.
 */
function fakeSnapshot(name: string): void {
  const path = join(root, "snapshots", name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "counterparts.sqlite"), "a copy");
}

/**
 * A copy of the owner's PRE-ROWS store, with `spans/` — which is what made a
 * real v5 snapshot look like one of ours and therefore rotatable (review B,
 * MAJOR-2): `spans` was in the old backup set and is still in the new `LAYOUT`.
 */
function preRowsSnapshot(name: string): void {
  const path = join(root, "snapshots", name);
  mkdirSync(join(path, "prose", "memories"), { recursive: true });
  mkdirSync(join(path, "spans", "default"), { recursive: true });
  writeFileSync(join(path, "operational.sqlite"), "a v5 database");
  writeFileSync(join(path, "prose", "memories", "mem_aaaaaaaaaaaa.md"), "old-floor words");
  writeFileSync(join(path, "spans", "default", "jots.jsonl"), "{}\n");
}

/** A real store at `dir`, minted the way every other surface mints one. */
function mintStore(): void {
  const c = Counterpart.open({ dir });
  c.close();
}

function store(): Store {
  const s = Store.open({ dir });
  stores.push(s);
  return s;
}

function writeConfig(over: Record<string, unknown> = {}): void {
  writeFileSync(
    configPath,
    JSON.stringify({
      dataDir: dir,
      injectionBudgetBytes: 9000,
      embedder: { enabled: true },
      ...over,
    }),
  );
}

/**
 * A RED, the way a real store earns one now that no key can go missing: the
 * worker refused at every boundary past the escalation threshold, persisted in
 * box 2's meta where the adapter and the console both read it.
 */
function markRefused(): void {
  const s = Store.open({ dir });
  try {
    s.setMeta(`${SPAWN_REFUSAL_PREFIX}WATCHDOG_EXCEEDS_STALENESS`, String(TUNABLES.ESCALATE_AFTER + 1));
  } finally {
    s.close();
  }
}

/**
 * A STORE OLD ENOUGH TO GRADE (2026-09-20, finding 2). The `Fired` and
 * `Authorship` lines both stand down on a store younger than a lived day or
 * two: their readings are ratios, and a ratio over a handful of rows is not a
 * reading. A test about what those lines SAY has to get past that first.
 */
function livedAWeek(s: Store): void {
  for (const date of ["2026-09-08", "2026-09-09", "2026-09-10"]) s.advanceClock(date);
}

/** The clean, green reading — every knob deliberately set, so each test below
 *  changes exactly one thing and the finding it moves is unambiguous. */
function input(over: Partial<DoctorInput> = {}): DoctorInput {
  const s = over.store === undefined ? store() : over.store;
  return {
    configPath,
    configReason: "loaded",
    config: { dataDir: dir, embedder: { enabled: true } },
    dir,
    store: s,
    today: "2026-09-14",
    refusals: {},
    checkout: onMaster,
    ...over,
  };
}

function by(findings: readonly Finding[], key: string): Finding {
  const f = findings.find((x) => x.key === key);
  if (f === undefined) throw new Error(`no finding '${key}' in ${findings.map((x) => x.key).join(", ")}`);
  return f;
}

/** A console that collects both streams, so an assertion can be made about
 *  EVERYTHING the command said — which is how "the value never appears" is
 *  checked at all. */
function consoleWith(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

/**
 * THE TWO STEPS `install` PRINTS AND DOES NOT PERFORM, performed — inside the
 * throwaway HOME this suite already uses, never anywhere near a real one.
 *
 * The paths and shapes are the host's, verified against its documentation on
 * 2026-09-20: a user-scope hooks block lives in `<home>/.claude/settings.json`
 * and a `-s user` MCP registration in `<home>/.claude.json` under `mcpServers`.
 */
function installHostSteps(
  over: { events?: readonly string[]; mcp?: boolean; stale?: boolean } = {},
): void {
  // A REAL FILE at the path the block names — because since 2026-09-20 a block
  // pointing at a checkout that is not there is graded as a fault, not as an
  // install. `stale: true` is how a test asks for the opposite.
  const installed = join(root, "install", "counterparts-hook");
  mkdirSync(dirname(installed), { recursive: true });
  writeFileSync(installed, "#!/usr/bin/env bun\n");
  const target = over.stale === true ? join(root, "deleted-checkout", "counterparts-hook") : installed;
  const hooks: Record<string, unknown> = {};
  for (const event of over.events ?? HOST_EVENTS) {
    hooks[event] = [{ hooks: [{ type: "command", command: `/bin/bun ${target}` }] }];
  }
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ hooks }));
  if (over.mcp !== false) {
    writeFileSync(
      join(root, ".claude.json"),
      JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: "counterparts-mcp" } } }),
    );
  }
}

const onMaster: CheckoutReading = {
  reason: "master",
  root: "/repo",
  branch: "master",
  head: "abc1234",
  dirty: 0,
  behindBy: null,
  originMaster: "abc1234",
  atMaster: true,
  timedOut: false,
};

// ── the findings ────────────────────────────────────────────────────────────

describe("doctor — the reading", () => {
  test("a healthy store is all green, and nothing is red", () => {
    mintStore();
    writeConfig();
    const findings = doctorFindings(input());
    expect(anyRed(findings)).toBe(false);
    expect(noticeMessage(findings)).toBe(null);
    expect(findings.find((x) => x.key === "credentials")).toBeUndefined();
    expect(by(findings, "store").severity).toBe("green");
    expect(by(findings, "embedder").severity).toBe("green");
  });

  /**
   * THE NUMBER ON THE MEMORY LINE IS THE ONE `status` PRINTS — the wake
   * preface's own count (`countMemories({ type: "memory", archived: false })`),
   * which is what `status`'s aside says its `Memories:` is. The one way the two
   * could drift is the journal: episodes are rows, `status` walks them out by
   * `isJournal`, and this query excludes them by TYPE. So a journal row is in
   * the fixture on purpose.
   */
  test("the Memory line counts memories the way status does — and the journal is not one", () => {
    mintStore();
    writeConfig();
    const s = store();
    for (let i = 0; i < 3; i += 1) {
      s.put({
        type: "memory",
        kind: "fact",
        body: `A memory number ${String(i)}, long enough to be one and written today.`,
        learnedOn: "2026-09-14",
        source: "authored",
        title: `Fixture ${String(i)}`,
      });
    }
    s.put({
      type: "episode",
      kind: "self",
      body: "A chapter of the journal, which is a row and is not a memory.",
      learnedOn: "2026-09-14",
      source: "authored",
      title: "Chapter",
    });
    const f = by(doctorFindings(input({ store: s })), "store");
    expect(f.detail).toContain("3 memories");
    expect(f.data["memories"]).toBe(3);
    // The path, and the `Store open` reading said as one sentence with it.
    expect(f.detail).toContain(dir);
    expect(f.detail).not.toContain("opens fine"); // no `open` reading was handed in
  });

  test("there is no Credentials line at all, and the crash write-up line is the next session's (keyless, 2026-09-24)", () => {
    mintStore();
    writeConfig();
    const findings = doctorFindings(input());
    expect(findings.find((f) => f.key === "credentials")).toBeUndefined();
    expect(findings.find((f) => f.key === "credentials-mode")).toBeUndefined();
    expect(findings.find((f) => f.key === "crash-writeup")).toBeUndefined();
    const crash = by(findings, "crash-write-up");
    expect(crash.title).toBe("Crash write-up");
    expect(crash.severity).toBe("green");
    expect(crash.detail).toContain("next session");
    expect(anyRed(findings)).toBe(false);
    expect(noticeMessage(findings)).toBe(null);
  });

  test("recall by meaning switched off is ONE OFF line, not three ambers (finding #24)", () => {
    mintStore();
    writeConfig();
    // The knob OFF. Since 2026-09-23 an ABSENT block is the local table
    // (config.ts#resolveEmbedder), so "off" is an explicit block.
    const findings = doctorFindings(
      input({ config: { dataDir: dir, embedder: { enabled: false } } }),
    );
    // Before: Embedder amber, Credentials amber, Vectors amber. After: one.
    const off = findings.filter((f) => f.optional === true);
    expect(off.map((f) => f.key)).toEqual(["embedder"]);
    expect(by(findings, "embedder").title).toBe("Recall by meaning");
    // KEYLESS (roadmap C3): the local table is what "turn on" means now, and
    // a Voyage key is never the advice for a knob that is off.
    expect(by(findings, "embedder").detail).toContain(
      "switched off in the configuration. Recall works on words; the local table lets it match meaning too, and nothing leaves this machine.",
    );
    expect(by(findings, "embedder").fix).toBe("Turn on: counterparts install --force --embedder");
    expect(by(findings, "embedder").fix).toBe(`Turn on: ${EMBEDDER_ON_COMMAND}`);
    expect(`${by(findings, "embedder").detail} ${by(findings, "embedder").fix}`).not.toContain("Voyage");
    // NOTHING TO EMBED, NOTHING TO SAY: the coverage line is not a reading while
    // the channel it measures is switched off.
    expect(findings.find((f) => f.key === "vectors")).toBeUndefined();
    expect(noticeMessage(findings)).toBe(null);
    expect(anyRed(findings)).toBe(false);
  });

  test("a store that HAS embedded and now has the embedder off is amber, never OFF", () => {
    // OFF claims nobody ever turned this on. Here somebody did, and it has
    // stopped — the distinction `keyHistory` exists to make.
    mintStore();
    writeConfig();
    const s = store();
    s.appendEvent({
      name: EMBED_BACKFILL_EVENT,
      day: s.livedDay(),
      payload: { embedded: 12, failed: 0, remaining: 0, skipped: 0, date: "2026-09-13" },
    });
    const f = by(
      doctorFindings(
        input({ store: s, config: { dataDir: dir, embedder: { enabled: false } } }),
      ),
      "embedder",
    );
    expect(f.severity).toBe("amber");
    expect(f.optional).toBeUndefined();
    expect(f.detail).toContain("HAS embedded before");
  });

  test("an OLD configuration's key settings are a quiet note — never red, never amber — and the old file's content appears nowhere", () => {
    // The owner's live configuration carries `credentialsFile` from the install
    // that wrote it (keyless, 2026-09-24). Each retired setting is read, ignored
    // and named on one green line; none of them costs a grade.
    mintStore();
    writeFileSync(credsPath, `SOME_OLD_KEY=${SECRET}\n`, { mode: 0o600 });
    const loaded = loadConfig({
      dataDir: dir,
      credentialsFile: credsPath,
      embedder: { enabled: true, kind: "voyage" },
      pageWriter: { mode: "session", command: "/bin/true" },
      crashWriteUp: "api",
      models: { interpret: { id: "claude-opus-5" } },
      // The owner's own configuration says this too (the Stop ask's B1 switch,
      // retired 2026-09-24).
      stopAskShape: "stderr",
    });
    expect(loaded.ok).toBe(true);
    const findings = doctorFindings(input({ config: loaded.config }));
    const retired = by(findings, "retired");
    expect(retired.severity).toBe("green");
    expect(retired.title).toBe("Old settings");
    expect(retired.data["count"]).toBe(6);
    expect(retired.detail).toContain('"stopAskShape" is no longer used');
    expect(retired.detail).toContain('"credentialsFile" is no longer used');
    expect(retired.detail).toContain(credsPath);
    expect(retired.detail).toContain('"pageWriter.command" is no longer used');
    expect(retired.detail).toContain('"embedder.kind" "voyage"');
    expect(retired.detail).toContain('"crashWriteUp" is no longer used');
    for (const key of ["config", "retired", "embedder", "crash-write-up", "page-writer", "sweep"]) {
      const f = findings.find((x) => x.key === key);
      if (f !== undefined) expect({ key, severity: f.severity }).toEqual({ key, severity: "green" });
    }
    expect(findings.find((x) => x.key === "credentials")).toBeUndefined();
    const rendered = [...reportLines(findings, "2026-09-14"), JSON.stringify(reportJson(findings, "2026-09-14"))].join("\n");
    expect(rendered).not.toContain(SECRET);
    expect(rendered).not.toContain(SECRET.slice(0, 8));
    expect(anyRed(findings)).toBe(false);
  });

  test("the embedder knob is read literally: anything but true is OFF, and says what still works", () => {
    mintStore();
    writeConfig();
    const findings = doctorFindings(input({ config: { dataDir: dir, embedder: { enabled: false } } }));
    const f = by(findings, "embedder");
    expect(f.optional).toBe(true);
    // It says what the store CAN still do (2026-09-20, finding 1): lexical
    // recall is a working channel, not a degraded mode, and a day-1 line that
    // reads like a broken install is what sends a new user to buy a key.
    expect(f.detail).toContain("Recall works on words");
    // NEVER A JSON EDIT (#19): one command, and it is the whole of the fix
    // line. Since 2026-09-23 it turns on the local table (a Voyage key saved
    // here changes nothing: Voyage is frozen, roadmap C3).
    expect(f.fix).toBe(`Turn on: ${EMBEDDER_ON_COMMAND}`);
    expect(f.fix).not.toContain("enabled");
    expect(f.fix).not.toContain("VOYAGE");
  });

  test("no store at the dir is red, and the store-reading groups are not attempted", () => {
    writeConfig();
    const findings = doctorFindings(input({ store: null }));
    expect(by(findings, "store").severity).toBe("red");
    expect(findings.find((f) => f.key === "clock")).toBeUndefined();
    expect(findings.find((f) => f.key === "vectors")).toBeUndefined();
  });

  test("a --dir that disagrees with the config's dataDir is amber, and names both", () => {
    mintStore();
    writeConfig();
    const findings = doctorFindings(input({ config: { dataDir: "/elsewhere/store", embedder: { enabled: true } } }));
    expect(by(findings, "store").severity).toBe("amber");
    expect(by(findings, "store").detail).toContain("/elsewhere/store");
    expect(by(findings, "store").detail).toContain(dir);
  });

  /** I32's signature, in one line: boundaries are happening and the clock is not
   *  moving, which means no worker has opened the store. */
  test("lastActiveDate older than the newest boundary is amber and states both dates", () => {
    mintStore();
    writeConfig();
    const s = store();
    s.setMeta("lastActiveDate", "2026-09-04");
    s.appendEvent({ name: BOUNDARY_EVENT, day: s.livedDay(), payload: { date: "2026-09-11" } });
    const findings = doctorFindings(input({ store: s }));
    expect(by(findings, "clock").severity).toBe("amber");
    expect(by(findings, "clock").detail).toContain("2026-09-04");
    expect(by(findings, "clock").detail).toContain("2026-09-11");
  });

  test("a sleep cycle whose reason is not 'ran' is red", () => {
    mintStore();
    writeConfig();
    const s = store();
    s.appendEvent({ name: SLEEP_CYCLE_EVENT, day: s.livedDay(), payload: { reason: "ran", failed: 0, date: "2026-09-13" } });
    expect(by(doctorFindings(input({ store: s })), "sleep").severity).toBe("green");
    s.appendEvent({ name: SLEEP_CYCLE_EVENT, day: s.livedDay(), payload: { reason: "threw", failed: 2, failedPhase: "dedup", date: "2026-09-14" } });
    const findings = doctorFindings(input({ store: s }));
    expect(by(findings, "sleep").severity).toBe("red");
    expect(by(findings, "sleep").detail).toContain("dedup");
  });

  /**
   * A phase that stopped at its cap is SAID, and is not a severity. With a resume
   * cursor a big store is meant to take several nights over a full pass, so
   * grading that amber would teach the reader to ignore the line. What hid the
   * consolidate truncation for two weeks was not that it happened but that
   * nothing said so (`docs/promotion-diagnosis-2026-09-17.md`).
   */
  test("a phase that stopped at its budget is named on the Sleep line, with the rows it did not reach", () => {
    mintStore();
    writeConfig();
    const s = store();
    s.appendEvent({
      name: SLEEP_CYCLE_EVENT,
      day: s.livedDay(),
      payload: {
        reason: "ran",
        failed: 0,
        date: "2026-09-14",
        phases: [
          { phase: "decay", status: "ran", reason: "completed", budgetExhausted: false },
          {
            phase: "consolidate",
            status: "ran",
            reason: "completed",
            budgetExhausted: true,
            skippedForBudget: 10_292,
          },
        ],
      },
    });
    const sleep = by(doctorFindings(input({ store: s })), "sleep");
    expect(sleep.severity).toBe("green");
    expect(sleep.detail).toContain("consolidate ran out of budget (10292 rows not reached this run)");
    expect(sleep.detail).not.toContain("decay ran out");
    expect(sleep.data["budgetTruncated"]).toBe(1);
  });

  test("an older sleep.cycle row, from before the budget fields, says nothing about budgets", () => {
    mintStore();
    writeConfig();
    const s = store();
    s.appendEvent({
      name: SLEEP_CYCLE_EVENT,
      day: s.livedDay(),
      // The shape written before 2026-09-18: phases, no `budgetExhausted`. A
      // reader that turned that absence into a zero would be claiming a
      // measurement nobody took (scar §2.4).
      payload: {
        reason: "ran",
        failed: 0,
        date: "2026-09-14",
        phases: [{ phase: "consolidate", status: "ran", reason: "completed" }],
      },
    });
    const sleep = by(doctorFindings(input({ store: s })), "sleep");
    expect(sleep.detail).not.toContain("budget");
    expect(sleep.data["budgetTruncated"]).toBe(0);
  });

  /** I33: one bad backfill is a flaky provider; the same zero twice is a
   *  poisoned input that will never clear itself. */
  test("a backfill that embedded nothing twice running is red; once is amber", () => {
    mintStore();
    writeConfig();
    const s = store();
    s.appendEvent({
      name: EMBED_BACKFILL_EVENT,
      day: s.livedDay(),
      payload: { embedded: 0, failed: 64, remaining: 177, skipped: 0, codes: "http_400:400" },
    });
    expect(by(doctorFindings(input({ store: s })), "backfill").severity).toBe("amber");
    s.appendEvent({
      name: EMBED_BACKFILL_EVENT,
      day: s.livedDay(),
      payload: { embedded: 0, failed: 64, remaining: 177, skipped: 0, codes: "http_400:400" },
    });
    const findings = doctorFindings(input({ store: s }));
    expect(by(findings, "backfill").severity).toBe("red");
    expect(by(findings, "backfill").detail).toContain("http_400:400");
  });

  test("the newest row is the one reported, not the first one written", () => {
    mintStore();
    writeConfig();
    const s = store();
    for (const date of ["2026-09-10", "2026-09-11", "2026-09-12"]) {
      s.appendEvent({ name: SWEEP_GATE_EVENT, day: s.livedDay(), payload: { reason: "ran", ran: 1, scopes: 2, date } });
    }
    expect(by(doctorFindings(input({ store: s })), "sweep").detail).toContain("2026-09-12");
  });

  /**
   * THE ANSWER THAT WOULD HAVE BEEN CONFIDENTLY WRONG.
   *
   * `eventLog` is `ORDER BY seq ASC LIMIT`, so once a name holds more rows than
   * the read's limit and they all sit outside every bounded day window, every
   * window comes back FULL. The bounded ones were discarded for that reason and
   * the unbounded one was not — so the read handed back the limit-th OLDEST row
   * and the finding graded the store on it. Here the 4,000th row says a cycle
   * threw and the newest says it ran: the old reading was red about a night a
   * year ago, which is worse than not knowing.
   */
  test("more rows than the read's limit, none inside a window, is UNKNOWN — never the oldest row wearing the newest row's name", () => {
    mintStore();
    writeConfig();
    const s = store();
    // Day 0, so every bounded window (0, 2, 7, 30 days back) spans them all and
    // comes back at the limit — the shape a long-lived store reaches on its own.
    for (let i = 0; i < 4001; i += 1) {
      s.appendEvent({
        name: SLEEP_CYCLE_EVENT,
        day: 0,
        payload: { reason: i === 3999 ? "threw" : "ran", failed: 0, date: "2026-09-14" },
      });
    }
    const sleep = by(doctorFindings(input({ store: s })), "sleep");
    expect(sleep.severity).toBe("green");
    expect(sleep.detail).toContain("could not be determined");
    expect(sleep.detail).toContain(SLEEP_CYCLE_EVENT);
    expect(sleep.detail).not.toContain("threw");
  });

  /**
   * THE JOURNAL COPY LINE (F6) — a line only when one is owed.
   *
   * The copy is derived and refills itself, so "how many files are there" is a
   * number nobody needs and a permanently green row is one more line the reader
   * learns to skip. A STANDING failure is the one reading worth printing.
   */
  test("the journal copy is SILENT when nothing has failed, and amber while a failure stands", () => {
    mintStore();
    writeConfig();
    const s = store();
    // Nothing at all: no line. Not a green one.
    expect(doctorFindings(input({ store: s })).some((f) => f.key === "journal-copy")).toBe(false);
    // A successful copy is still not a line.
    s.appendEvent({
      name: JOURNAL_COPY_WRITTEN_EVENT,
      day: s.livedDay(),
      ref: "epi_aaa",
      payload: { date: "2026-09-19", file: "journal/2026/2026-09-19-epi_aaa.md", bytes: 412 },
    });
    expect(doctorFindings(input({ store: s })).some((f) => f.key === "journal-copy")).toBe(false);

    // A failure with nothing after it is a standing fault: amber, naming the
    // episode and the reason code, and saying the chapter itself is safe.
    s.appendEvent({
      name: JOURNAL_COPY_FAILED_EVENT,
      day: s.livedDay(),
      ref: "epi_bbb",
      payload: { date: "2026-09-20", reason: "write-failed" },
    });
    const amber = by(doctorFindings(input({ store: s })), "journal-copy");
    expect(amber.severity).toBe("amber");
    expect(amber.detail).toContain("epi_bbb");
    expect(amber.detail).toContain("write-failed");
    expect(amber.detail).toContain("unharmed");
    expect(amber.fix.length).toBeGreaterThan(0);

    // A later success IS the fix, and a fixed fault is not a line.
    s.appendEvent({
      name: JOURNAL_COPY_WRITTEN_EVENT,
      day: s.livedDay(),
      ref: "epi_bbb",
      payload: { date: "2026-09-20", file: "journal/2026/2026-09-20-epi_bbb.md", bytes: 501 },
    });
    expect(doctorFindings(input({ store: s })).some((f) => f.key === "journal-copy")).toBe(false);
  });

  /**
   * THE SNAPSHOT LINE — "if this database were wiped this afternoon, what would
   * come back". Amber, never red: a missing backup is not a broken memory, and
   * one colour for both teaches the reader to read past the one that matters.
   */
  test("the snapshot line counts what is ON DISK: last taken, how many kept, the oldest", () => {
    mintStore();
    writeConfig();
    const s = store();
    for (const d of ["2026-09-01", "2026-09-13", "2026-09-14"]) fakeSnapshot(`${d}T03-00-00-000Z`);
    s.appendEvent({
      name: SNAPSHOT_TAKEN_EVENT,
      day: s.livedDay(),
      payload: { date: "2026-09-14", name: "2026-09-14T03-00-00-000Z", files: 16_400, kept: 3 },
    });
    const snap = by(doctorFindings(input({ store: s })), "snapshot");
    expect(snap.severity).toBe("green");
    expect(snap.detail).toContain("last 2026-09-14");
    expect(snap.detail).toContain("3 kept");
    // THE OLDEST IS A `--json` FACT NOW (2026-09-22): the screen answers "when
    // was the last one and how many are there"; the rotation's other end is
    // still on the row, for whoever is reasoning about it.
    expect(snap.detail).not.toContain("oldest");
    expect(snap.data["oldest"]).toBe("2026-09-01T03-00-00-000Z");
  });

  /**
   * MAJOR-3 OF THE F2 REVIEW, proved and then fixed: the line used to be computed
   * entirely from the newest `snapshot.taken` row, so deleting every copy from
   * disk left it reading green, "1 kept", for a full day — and after two days it
   * went amber for the wrong reason, still claiming a copy existed. A row says
   * what a run once wrote. The directory says what you have.
   */
  test("a row that claims a copy the directory does not hold is amber, and says there is nothing to restore from", () => {
    mintStore();
    writeConfig();
    const s = store();
    s.appendEvent({
      name: SNAPSHOT_TAKEN_EVENT,
      day: s.livedDay(),
      payload: { date: "2026-09-14", name: "2026-09-14T03-00-00-000Z", kept: 14, oldest: "2026-09-01T03-00-00-000Z" },
    });
    // No directory at all — the copies were tidied away, or never survived.
    const snap = by(doctorFindings(input({ store: s })), "snapshot");
    expect(snap.severity).toBe("amber");
    expect(snap.detail).toContain("nothing to restore from");
    expect(snap.detail).not.toContain("14 kept");
    // And the remedy is the restore procedure, because this is the line somebody
    // reads on the day they need it.
    expect(snap.fix).toContain("--rebuild");
  });

  test("a PRE-ROWS copy is named, not counted, and NOT graded a fault (review B, MAJOR-2)", () => {
    // After cut-over the owner's snapshots directory holds his old floor's
    // copies permanently — never rotated, because this build cannot open one to
    // know what is in it. That is the right outcome and it must not read as a
    // problem: a permanently amber Snapshot line is a line people learn to skip.
    mintStore();
    writeConfig();
    const s = store();
    for (const d of ["2026-09-01", "2026-09-02"]) preRowsSnapshot(`${d}T03-00-00-000Z`);
    fakeSnapshot("2026-09-14T03-00-00-000Z");
    const snap = by(doctorFindings(input({ store: s })), "snapshot");
    expect(snap.severity).toBe("green");
    expect(snap.detail).toContain("2 older-format copies this build cannot open");
    expect(snap.detail).toContain("kept, never rotated");
    expect(snap.detail).toContain("floor/v5-last");
    expect(snap.data?.["preRows"]).toBe(2);
    // NOT counted as copies of this store — otherwise they would push his real
    // ones out of the `keep` window.
    expect(snap.data?.["onDisk"]).toBe(1);
    // And the restore steps say what they are, so the next panic is not about
    // them (B-NIT-3).
    expect(RESTORE_STEPS).toContain("BEFORE the floor changed");
    expect(RESTORE_STEPS).toContain("floor/v5-last");
  });

  test("a snapshot older than two days is amber", () => {
    mintStore();
    writeConfig();
    const s = store();
    // `today` in the fixture is 2026-09-14, so this copy is three days behind —
    // a daily mechanism that has missed one.
    fakeSnapshot("2026-09-11T03-00-00-000Z");
    const snap = by(doctorFindings(input({ store: s })), "snapshot");
    expect(snap.severity).toBe("amber");
    expect(snap.detail).toContain("2 days ago or more");
    // THE BOUNDARY DAY, pinned rather than left to a reader's guess: two
    // calendar days back is a daily mechanism that has already missed one.
    fakeSnapshot("2026-09-12T03-00-00-000Z");
    expect(by(doctorFindings(input({ store: s })), "snapshot").severity).toBe("amber");
    // And one taken yesterday is not.
    fakeSnapshot("2026-09-13T03-00-00-000Z");
    expect(by(doctorFindings(input({ store: s })), "snapshot").severity).toBe("green");
  });

  test("no snapshot is green on a store that has never reached a boundary, amber once it has", () => {
    mintStore();
    writeConfig();
    const s = store();
    // A fresh install: nothing has run, so an amber here would be decoration.
    expect(by(doctorFindings(input({ store: s })), "snapshot").severity).toBe("green");
    s.appendEvent({ name: BOUNDARY_EVENT, day: s.livedDay(), payload: { date: "2026-09-13" } });
    const snap = by(doctorFindings(input({ store: s })), "snapshot");
    expect(snap.severity).toBe("amber");
    expect(snap.detail).toContain("no snapshot has ever been taken");
  });

  test("a configuration value the snapshots block could not read is named on the line", () => {
    mintStore();
    writeConfig();
    const s = store();
    fakeSnapshot("2026-09-14T03-00-00-000Z");
    const findings = doctorFindings(
      input({
        store: s,
        config: {
          dataDir: dir,
          snapshots: { ignored: ['"snapshots.keep" was 0; using 14'] },
        },
      }),
    );
    const snap = by(findings, "snapshot");
    // A backup preference that could not be read costs the preference and says
    // so — it no longer costs the whole configuration (F2 review, MAJOR-2).
    expect(snap.severity).toBe("amber");
    expect(snap.detail).toContain('"snapshots.keep" was 0; using 14');
  });

  test("a directory that is named like a snapshot but is not one is counted and NAMED", () => {
    mintStore();
    writeConfig();
    const s = store();
    fakeSnapshot("2026-09-14T03-00-00-000Z");
    // What a copy taken on an older floor looks like once the layout moves on:
    // correctly named, holding nothing this package recognises. It is kept — we
    // never delete what we cannot prove we made — but it is also never rotated,
    // so without this line it would be permanent invisible residue in the one
    // directory the owner relies on (second F2 review, MAJOR-A).
    const strange = join(root, "snapshots", "2026-08-01T00-00-00-000Z");
    mkdirSync(strange, { recursive: true });
    writeFileSync(join(strange, "an-older-floor.db"), "unrecognised");

    const snap = by(doctorFindings(input({ store: s })), "snapshot");
    expect(snap.severity).toBe("amber");
    expect(snap.detail).toContain("will never be rotated");
    expect(snap.detail).toContain("2026-08-01T00-00-00-000Z");
    expect(snap.data["unrecognised"]).toBe(1);
    // And it is not counted as a copy you could restore from.
    expect(snap.data["onDisk"]).toBe(1);
  });

  test("a copy dated in the future is counted and named, never deleted", () => {
    mintStore();
    writeConfig();
    const s = store();
    fakeSnapshot("2026-09-14T03-00-00-000Z");
    // One clock-skewed boundary plants a name that holds a `keep` slot forever.
    fakeSnapshot("2099-01-01T00-00-00-000Z");
    const snap = by(doctorFindings(input({ store: s })), "snapshot");
    expect(snap.severity).toBe("amber");
    expect(snap.detail).toContain("dated in the future");
    expect(existsSync(join(root, "snapshots", "2099-01-01T00-00-00-000Z"))).toBe(true);
  });

  test("a store outside the package's layout says WHY no copy is being taken", () => {
    mintStore();
    writeConfig();
    const s = store();
    // The one skip that leaves no durable row at all — it is a configuration
    // fact, not an event, so this line is the whole surface for it.
    const snap = by(doctorFindings(input({ store: s, dir: root })), "snapshot");
    expect(snap.severity).toBe("amber");
    expect(snap.detail).toContain("no default place to keep copies");
    expect(snap.fix).toContain('"snapshots"');
  });

  test("spawn refusals at the escalation threshold are red and name the reason", () => {
    mintStore();
    writeConfig();
    const s = store();
    s.appendEvent({
      name: SPAWN_REFUSED_EVENT,
      day: s.livedDay(),
      payload: { reason: "NO_CREDENTIAL", date: "2026-09-11" },
    });
    const below = doctorFindings(input({ store: s, refusals: { NO_CREDENTIAL: TUNABLES.ESCALATE_AFTER - 1 } }));
    expect(by(below, "spawn").severity).toBe("amber");
    const at = doctorFindings(input({ store: s, refusals: { NO_CREDENTIAL: TUNABLES.ESCALATE_AFTER } }));
    expect(by(at, "spawn").severity).toBe("red");
    expect(by(at, "spawn").detail).toContain("NO_CREDENTIAL");
    expect(by(at, "spawn").detail).toContain(SPAWN_REFUSED_EVENT);
    // An older build's refusal reason is still named; the fix reads the row.
    expect(by(at, "spawn").fix).toContain("adapter.spawn.refused");
  });

  test("the recall.credit row is reported when there is one, and its quiet reasons are green", () => {
    mintStore();
    writeConfig();
    const s = store();
    expect(doctorFindings(input({ store: s })).find((f) => f.key === "credit")).toBeUndefined();
    s.appendEvent({
      name: RECALL_CREDIT_EVENT,
      day: s.livedDay(),
      payload: { reason: "no-candidates", credited: 0, considered: 0, date: "2026-09-14" },
    });
    expect(by(doctorFindings(input({ store: s })), "credit").severity).toBe("green");
  });

  /**
   * FINDING 12'S OWN READING — who did the week's writing, in rows the store
   * already keeps. The two comparisons that go amber are the two the diagnosis
   * of 2026-09-17 measured: the session's own ask allowance refusing more asks
   * than it raises, and the fallback sweep out-writing the author.
   */
  describe("authorship — a week of who wrote the memory", () => {
    /** One `adapter.ask` row, on a calendar date, with an outcome and — for a
     *  `capped` one — the rule that capped it. */
    function ask(s: Store, date: string, outcome: string, reason?: string): void {
      s.appendEvent({
        name: ADAPTER_ASK_EVENT,
        day: s.livedDay(),
        payload: reason === undefined ? { date, outcome } : { date, outcome, reason },
      });
    }
    /** One authored memory, learned on a calendar date. */
    function memory(s: Store, date: string, source: "authored" | "fallback", n: number): void {
      for (let i = 0; i < n; i += 1) {
        s.put({
          type: "memory",
          kind: "fact",
          body: `A ${source} memory written on ${date}, number ${String(i)}, long enough to be a memory.`,
          learnedOn: date,
          source,
        });
      }
    }

    test("a healthy week is green and reads in plain language", () => {
      mintStore();
      writeConfig();
      const s = store();
      for (const date of ["2026-09-12", "2026-09-13", "2026-09-14"]) {
        ask(s, date, "asked");
        ask(s, date, "paced");
        s.appendEvent({ name: GATE_DEPOSIT_EVENT, day: s.livedDay(), payload: { accepted: true } });
        memory(s, date, "authored", 2);
      }
      memory(s, "2026-09-14", "fallback", 1);
      const f = by(doctorFindings(input({ store: s })), "authorship");
      expect(f.severity).toBe("green");
      expect(f.detail).toBe(
        "2026-09-08→2026-09-14: the session was invited to write 3 times, refused 0 on a cap and 3 for pacing; " +
          "it answered with 3 deposits; 6 live memories of that week are its own, 1 was written for it by the fallback sweep",
      );
      expect(f.fix).toBe("");
      expect(f.data["asked"]).toBe(3);
      expect(f.data["authored"]).toBe(6);
      expect(f.data["fallback"]).toBe(1);
    });

    test("AMBER when a session's own ask allowance refuses more than it raises", () => {
      mintStore();
      writeConfig();
      const s = store();
      livedAWeek(s);
      ask(s, "2026-09-14", "asked");
      for (let i = 0; i < 9; i += 1) ask(s, "2026-09-14", "capped", "session-ask-cap");
      memory(s, "2026-09-14", "authored", 3);
      const f = by(doctorFindings(input({ store: s })), "authorship");
      expect(f.severity).toBe("amber");
      expect(f.detail).toContain("refused 9 on a cap (9 by a session's own allowance for the day)");
      // The mechanism the hint sends the reader after must be the one that
      // exists: per session since 2026-09-17, per session per day since
      // 2026-09-18, never a ration SHARED by the day.
      expect(f.fix).toContain("A session's own allowance for the day (6 asks)");
      expect(f.fix).not.toContain("shared");
      expect(anyRed(doctorFindings(input({ store: s })))).toBe(false);
    });

    /**
     * THE SPLIT. Until 2026-09-17 a `capped` row meant the ration four sessions
     * of one lived day shared (`day-chapter-cap`); since then it means this
     * session's own allowance (`session-ask-cap`). Both spellings are inside a
     * seven-day window right now, and a line that added them together blamed the
     * per-session allowance for refusals it never made.
     */
    test("the two caps are counted apart, and only the NEW one can raise the amber", () => {
      mintStore();
      writeConfig();
      const s = store();
      ask(s, "2026-09-14", "asked");
      for (let i = 0; i < 9; i += 1) ask(s, "2026-09-14", "capped", "day-chapter-cap");
      ask(s, "2026-09-14", "capped", "session-ask-cap");
      // One from before either reason was written at all.
      ask(s, "2026-09-14", "capped");
      memory(s, "2026-09-14", "authored", 3);
      const f = by(doctorFindings(input({ store: s })), "authorship");
      expect(f.detail).toContain(
        "refused 11 on a cap (1 by a session's own allowance for the day, 9 by the old shared day cap, 1 naming no cap)",
      );
      expect(f.data["capped"]).toBe(11);
      expect(f.data["cappedBySession"]).toBe(1);
      expect(f.data["cappedByDay"]).toBe(9);
      // Nine old-cap refusals against one invitation do NOT amber: that rule is
      // not in force any more, and its rows only age out of the window.
      expect(f.severity).toBe("green");
      expect(f.fix).toBe("");
    });

    test("neither amber fires on a store too new to grade (finding 2)", () => {
      // Both of this line's ambers are RATIOS — "the cap refused more often
      // than it offered", "the sweep wrote more than the session did" — and a
      // ratio over a handful of rows is not a reading. The SENTENCE still
      // stands; only the colour and the hint stand down.
      mintStore();
      writeConfig();
      const s = store();
      ask(s, "2026-09-14", "asked");
      memory(s, "2026-09-14", "authored", 2);
      memory(s, "2026-09-13", "fallback", 20);
      const f = by(doctorFindings(input({ store: s })), "authorship");
      expect(f.severity).toBe("green");
      expect(f.detail).toContain("20 were written for it by the fallback sweep");
      expect(f.detail).toContain("too new to grade");
      expect(f.fix).toBe("");
      expect(f.data["young"]).toBe(true);
    });

    test("a store whose WORKER died still gets graded — the young rule uses two clocks (MINOR 8)", () => {
      /**
       * The lived clock is advanced ONLY by the sleep cycle
       * (`store.advanceClock()` has one caller). Sessions ask and deposit at
       * every boundary whether or not the worker ever runs. So a store whose
       * worker has been dead since day 1 — spawn refused, no credential, a
       * broken checkout — piles up a fortnight of asks and deposits with a
       * perfectly meaningful cap/sweep ratio, and read GREEN "too new to grade"
       * for ever on the one-clock rule. That is the exact store
       * `FiredReport.young`'s two-clock rule was written to protect.
       */
      mintStore();
      writeConfig();
      const s = store();
      // livedDay stays 0: nothing here advances the clock.
      expect(s.livedDay()).toBe(0);
      ask(s, "2026-09-09", "asked");
      memory(s, "2026-09-09", "authored", 2);
      memory(s, "2026-09-09", "fallback", 20);

      const f = by(doctorFindings(input({ store: s })), "authorship");
      expect(f.data["livedDay"]).toBe(0);
      expect(f.data["young"]).toBe(false);
      expect(f.severity).toBe("amber");
      expect(f.detail).not.toContain("too new to grade");
      expect(f.fix).toContain("session-end boundary");
    });

    test("AMBER when the fallback sweep out-writes the author", () => {
      mintStore();
      writeConfig();
      const s = store();
      livedAWeek(s);
      ask(s, "2026-09-14", "asked");
      memory(s, "2026-09-14", "authored", 2);
      memory(s, "2026-09-13", "fallback", 20);
      const f = by(doctorFindings(input({ store: s })), "authorship");
      expect(f.severity).toBe("amber");
      expect(f.detail).toContain("20 were written for it by the fallback sweep");
      expect(f.fix).toContain("session-end boundary");
    });

    test("the window is CALENDAR days, and a row with no outcome is counted apart", () => {
      mintStore();
      writeConfig();
      const s = store();
      // Eight days back: outside the window even though its lived day is today's.
      ask(s, "2026-09-06", "asked");
      memory(s, "2026-09-06", "authored", 5);
      // A row from before the single pacer: no `outcome` at all. Counted apart,
      // never folded into one of the three — a `reason` on its own does not make
      // a row a refusal.
      s.appendEvent({
        name: ADAPTER_ASK_EVENT,
        day: s.livedDay(),
        payload: { date: "2026-09-14", reason: "session-ask-cap" },
      });
      const f = by(doctorFindings(input({ store: s })), "authorship");
      expect(f.data["asked"]).toBe(0);
      expect(f.data["capped"]).toBe(0);
      expect(f.data["authored"]).toBe(0);
      expect(f.data["unlabelled"]).toBe(1);
      expect(f.detail).toContain("1 older rows name no outcome");
    });
  });

  /**
   * WHAT FIRED — constitution 11's last sentence, as one line. The amber is the
   * only thing on it that says something CHANGED; a count of never-fired
   * mechanisms is a standing fact about the build, and ambering on that every
   * morning is how a warning teaches its reader to skip it.
   */
  describe("fired — the roll-call of mechanisms", () => {
    test("a store where nothing has fallen silent is green, and the line counts every state", () => {
      mintStore();
      writeConfig();
      const s = store();
      livedAWeek(s);
      s.appendEvent({ name: BOUNDARY_EVENT, day: s.livedDay(), payload: { date: "2026-09-14" } });
      const f = by(doctorFindings(input({ store: s })), "fired");
      expect(f.severity).toBe("green");
      expect(f.title).toBe("Fired");
      expect(f.detail).toContain("2026-09-08→2026-09-14");
      expect(f.detail).toContain("mechanisms fired this week");
      expect(f.detail).toContain("record nothing durable at all");
      expect(f.detail).toContain("Nothing that fired last week has fallen silent this week.");
      expect(f.data["firing"]).toBe(1);
      expect(Number(f.data["blind"])).toBeGreaterThan(0);
      expect(f.fix).toBe("");
    });

    test("a store too new to grade says so, instead of '28 have never fired' (finding 2)", () => {
      // On a store minutes old the roll-call is true and reads like a broken
      // install: nothing has fired because nothing has happened yet, and no
      // surface said so. GREEN, because there is nothing here to fix.
      mintStore();
      writeConfig();
      const f = by(doctorFindings(input()), "fired");
      expect(f.severity).toBe("green");
      expect(f.detail).toContain("too new to grade");
      expect(f.detail).toContain("nothing has happened yet");
      expect(f.detail).not.toContain("have never fired");
      expect(f.data["young"]).toBe(true);
      expect(f.fix).toBe("");

    });

    test("something already BLOCKED is said even on a store too new to grade", () => {
      // The one thing worth saying on day 1: a mechanism that was reached and
      // turned away is not a mechanism that has had nothing to do.
      mintStore();
      writeConfig();
      const s = store();
      s.appendEvent({
        name: "adapter.spawn.refused",
        day: s.livedDay(),
        payload: { date: "2026-09-14", reason: "NO_CREDENTIAL", count: 4 },
      });
      const f = by(doctorFindings(input({ store: s })), "fired");
      expect(f.severity).toBe("green");
      expect(f.detail).toContain("too new to grade");
      expect(f.detail).toContain("already stopped by something");
      expect(f.fix).toContain("counterparts fired");
      expect(f.data["blocked"]).toBe(1);
    });

    test("a mechanism that fired last week and was STOPPED all this week is amber, not green", () => {
      /**
       * THE TRAP THE `blocked` STATE SET, AND THE GUARD AGAINST IT.
       *
       * `blocked` outranks `quiet` in the state machine — it says more, and it
       * should. But this finding used to grade on `wentQuiet` alone, so the
       * worker starting every day last week and being refused every day this
       * week would have LEFT that list and taken the amber with it. A state
       * that says more must never make a diagnostic read safer than it did
       * before that state existed.
       */
      mintStore();
      writeConfig();
      const s = store();
      livedAWeek(s);
      // Last week it started; this week it has only ever been refused.
      s.appendEvent({
        name: "adapter.spawn.started",
        day: s.livedDay(),
        payload: { date: "2026-09-05", count: 3 },
      });
      for (const date of ["2026-09-12", "2026-09-13", "2026-09-14"]) {
        s.appendEvent({
          name: "adapter.spawn.refused",
          day: s.livedDay(),
          payload: { date, reason: "NO_CREDENTIAL", count: 9 },
        });
      }
      const f = by(doctorFindings(input({ store: s })), "fired");
      expect(f.severity).toBe("amber");
      expect(f.detail).toContain("Fired last week and STOPPED this week");
      expect(f.detail).toContain("NO_CREDENTIAL");
      expect(f.fix).toContain("counterparts fired");
      expect(f.data["wentBlocked"]).toContain("NO_CREDENTIAL");
      // And the roll-call says how many, so the number and the list agree.
      expect(f.data["blocked"]).toBe(1);
      expect(f.detail).toContain("stopped by something that said so");
    });

    test("AMBER, by NAME, for a mechanism that fired last week and not once this week", () => {
      mintStore();
      writeConfig();
      const s = store();
      // Eight days back: inside the previous window, outside this one.
      s.appendEvent({ name: SWEEP_GATE_EVENT, day: s.livedDay(), payload: { date: "2026-09-06" } });
      s.appendEvent({ name: BOUNDARY_EVENT, day: s.livedDay(), payload: { date: "2026-09-14" } });
      const findings = doctorFindings(input({ store: s }));
      const f = by(findings, "fired");
      expect(f.severity).toBe("amber");
      expect(f.detail).toContain("Fired last week and not once this week:");
      expect(f.detail).toContain("the crash fallback");
      expect(f.data["wentQuiet"]).toContain("the crash fallback");
      expect(f.fix).toContain("counterparts fired");
      // Never red in this first version: a silence is a diagnosis to make, not
      // an emergency to raise (constitution 11).
      expect(anyRed(findings)).toBe(false);
    });

    test("a mechanism that has simply never fired does not raise the amber", () => {
      mintStore();
      writeConfig();
      const s = store();
      const f = by(doctorFindings(input({ store: s })), "fired");
      expect(f.severity).toBe("green");
      expect(Number(f.data["never"])).toBeGreaterThan(0);
    });

    /**
     * The roll-call is the only reading here whose SQL is not bounded by a lived
     * day — it walks the whole log, and the table probes cost a query per memory
     * on top. A hook does not pay for that, and it would buy nothing there: the
     * session-start notice carries reds only and this finding is never red.
     */
    test("a budgeted reading does not take the roll-call at all, and says so", () => {
      mintStore();
      writeConfig();
      const s = store();
      s.appendEvent({ name: SWEEP_GATE_EVENT, day: s.livedDay(), payload: { date: "2026-09-06" } });
      // The console reads it, and on this store that is the amber.
      expect(by(doctorFindings(input({ store: s })), "fired").severity).toBe("amber");
      // A budgeted reading, with time to spare, still does not.
      const budgeted = by(doctorFindings(input({ store: s, budgetMs: 10_000 })), "fired");
      expect(budgeted.severity).toBe("green");
      expect(budgeted.data["read"]).toBe(false);
      expect(budgeted.detail).toContain("not read at session start");
    });
  });

  test("the vector census is the one verify prints, and it is reused rather than recomputed", () => {
    mintStore();
    writeConfig();
    const s = store();
    const findings = doctorFindings(input({ store: s }));
    expect(by(findings, "vectors").data["unembedded"]).toBe(s.unembeddedCount());
    expect(by(findings, "vectors").data["skipped"]).toBe(s.skippedVectorIds().length);
  });

  test("the journal mode is read and reported — green in wal, amber when a conversion did not take", () => {
    mintStore();
    writeConfig();
    // A writer minted this store, so it is in WAL. Nothing to say.
    const green = by(doctorFindings(input()), "journal");
    expect({ severity: green.severity, mode: green.data["mode"], fix: green.fix }).toEqual({
      severity: "green",
      mode: "wal",
      fix: "",
    });

    // A store standing in DELETE — what a store built by the previous build
    // looks like, and what one looks like after an older build opened it and set
    // the mode back. `VACUUM INTO` writes a fresh database in the default mode.
    const at = mkdtempSync(join(tmpdir(), "counterparts-doctor-delete-"));
    try {
      const src = openDb(join(dir, "counterparts.sqlite"));
      try {
        src.exec(`VACUUM INTO '${join(at, "counterparts.sqlite")}'`);
      } finally {
        src.close();
      }
      const behind = Store.open({ dir: at, observer: true });
      stores.push(behind);
      const amber = by(doctorFindings(input({ store: behind })), "journal");
      expect({ severity: amber.severity, mode: amber.data["mode"] }).toEqual({
        severity: "amber",
        mode: "delete",
      });
      expect(amber.fix).toContain("converts it");
      // AND THE READING CONVERTED NOTHING. A console that fixed the thing it was
      // asked to report would be writing while standing down.
      expect(journalModeOf(join(at, "counterparts.sqlite"))).toBe("delete");
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  });

  /** The hot path's own guarantee: what the budget cut off is a FINDING, never a
   *  silent omission. */
  test("a blown time budget stops the reading and says what it did not read", () => {
    mintStore();
    writeConfig();
    let t = 0;
    const findings = doctorFindings(
      input({
        budgetMs: 10,
        now: () => {
          t += 100;
          return t;
        },
      }),
    );
    expect(by(findings, "budget").severity).toBe("amber");
    expect(by(findings, "budget").detail).toContain("spawn");
    expect(findings.find((f) => f.key === "vectors")).toBeUndefined();
    // The config was answered BEFORE the clock ran out.
    expect(by(findings, "config")).toBeDefined();
  });

  test("the report is worst first and the JSON carries the same order", () => {
    mintStore();
    writeConfig();
    // A worker refused past the escalation threshold, so there is a red to sort
    // to the top.
    const findings = doctorFindings(input({ refusals: { WATCHDOG_EXCEEDS_STALENESS: TUNABLES.ESCALATE_AFTER + 1 } }));
    const json = reportJson(findings, "2026-09-14") as {
      red: number;
      findings: { key: string; severity: string }[];
    };
    expect(json.red).toBeGreaterThan(0);
    expect(json.findings[0]?.severity).toBe("red");
    const lines = reportLines(findings, "2026-09-14");
    expect(lines[0]).toContain("counterparts doctor — 2026-09-14");
    expect(lines.find((l) => l.startsWith("RED"))).toBeDefined();
    expect(lines.some((l) => l.includes("fix:"))).toBe(true);
  });
});

// ── the two steps the user does BY HAND (2026-09-20, finding 4) ─────────────

/**
 * `install` prints the hooks block and the `claude mcp add` line and applies
 * neither. Nothing then checked them, so a user who pasted the block into a
 * project settings file instead of the user one — or who never restarted — got
 * a fully green `doctor` and total silence. The failure mode of this product is
 * silence; this is the line that breaks it.
 *
 * Every read here is inside the suite's throwaway HOME.
 */
describe("the Host line reads the host's own files", () => {
  test("both steps installed is green, and it names where the MCP server was found", () => {
    mintStore();
    writeConfig();
    installHostSteps();
    const host = readHost(root, root, {});
    expect(host.events).toEqual([...HOST_EVENTS].sort());
    expect(host.mcp).toBe(true);
    const finding = by(doctorFindings(input({ host })), "host");
    expect(finding.severity).toBe("green");
    // THE LINE THE PERSON CAME FOR (the owner's screen, 2026-09-22): the label
    // is the assistant's name and the sentence is "connected", the verb the
    // command has. Every event name and every path is still in `data`.
    expect(finding.title).toBe("Claude Code");
    expect(finding.detail).toBe(`connected: ${String(HOST_EVENTS.length)} hooks and the memory tools`);
    expect(String(finding.data["mcpFile"])).toBe(join(root, ".claude.json"));
  });

  test("nothing installed is AMBER — never red — and says exactly what to run", () => {
    mintStore();
    writeConfig();
    const host = readHost(root, root, {});
    const finding = by(doctorFindings(input({ host })), "host");
    // Amber, because this reads somebody else's files in a format that is not
    // ours to depend on: a wrong answer must cost a second look, not a panic.
    expect(finding.severity).toBe("amber");
    expect(finding.detail).toContain("no hook of ours is connected");
    // `connect`, not `install` (2026-09-21, renamed 2026-09-22): the fix is the
    // command that DOES the paste, not the one that prints a block for the
    // reader to paste.
    expect(finding.fix).toContain("counterparts connect");
    expect(finding.fix).not.toContain("counterparts wire");
    expect(finding.fix).toContain("restart");
    // And it NAMES what it looked at, so a path that has moved is visible to
    // the reader rather than reported as "you did not install it".
    expect(finding.detail).toContain("no host settings file was readable");
    expect(finding.detail).toContain(join(root, ".claude.json"));
  });

  /**
   * GO-PUBLIC PHASE C WALK (2026-09-23): with no `claude` on the PATH, `connect`
   * cannot register the memory tools — it prints the `claude mcp add …` line
   * instead — so doctor's fix names THAT line, not `connect` again.
   */
  test("hooks in, memory tools missing, and no `claude` on the PATH: the fix is the `claude mcp add` line", () => {
    mintStore();
    writeConfig();
    installHostSteps({ mcp: false });
    const line = 'claude mcp add counterparts -s user -e COUNTERPARTS_DATA_DIR="/x/store" -- "/bun" run "/serve.ts"';
    const host = { ...readHost(root, root, {}), claudeOnPath: false, mcpAddLine: line };
    const finding = by(doctorFindings(input({ host })), "host");
    expect(finding.severity).toBe("amber");
    expect(finding.fix).toContain(line);
    expect(finding.fix).toContain("`claude` is not on this PATH");
    expect(finding.fix).not.toContain("Run: counterparts connect");
    // Not looked (no PATH to search): the fix stays `connect`, as before.
    const unknown = by(doctorFindings(input({ host: { ...host, claudeOnPath: null } })), "host");
    expect(unknown.fix).toContain("Run: counterparts connect");
    expect(unknown.fix).not.toContain(line);
  });

  test("nothing connected and no `claude`: connect for the hooks, the printed line for the tools", () => {
    mintStore();
    writeConfig();
    const line = "claude mcp add counterparts -s user -- x";
    const host = { ...readHost(root, root, {}), claudeOnPath: false, mcpAddLine: line };
    const finding = by(doctorFindings(input({ host })), "host");
    expect(finding.fix).toContain("Run: counterparts connect");
    expect(finding.fix).toContain("adds the hooks");
    expect(finding.fix).not.toContain("registers the memory tools");
    expect(finding.fix).toContain(line);
  });

  test("a PARTIAL paste is named event by event — the case a green doctor used to hide", () => {
    mintStore();
    writeConfig();
    installHostSteps({ events: ["SessionStart", "Stop"] });
    const finding = by(doctorFindings(input({ host: readHost(root, root, {}) })), "host");
    expect(finding.severity).toBe("amber");
    expect(finding.detail).toContain("connected on SessionStart, Stop");
    expect(finding.detail).toContain("NOT on UserPromptSubmit, SessionEnd, PreCompact");
  });

  test("hooks MERGE across the host's settings files, so a project file counts", () => {
    mintStore();
    const project = join(root, "project");
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(
      join(project, ".claude", "settings.local.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "bun /a/claude-code/bin/hook.ts" }] }],
        },
      }),
    );
    const host = readHost(root, project, {});
    expect(host.events).toEqual(["SessionStart"]);
    expect(host.settingsRead).toEqual([join(project, ".claude", "settings.local.json")]);
  });

  test("CLAUDE_CONFIG_DIR moves both files, and is honoured", () => {
    mintStore();
    const moved = join(root, "elsewhere");
    mkdirSync(join(moved, ".claude"), { recursive: true });
    writeFileSync(
      join(moved, ".claude", "settings.json"),
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "counterparts-hook stop" }] }] },
      }),
    );
    writeFileSync(
      join(moved, ".claude.json"),
      JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: {} } }),
    );
    const host = readHost(root, root, { CLAUDE_CONFIG_DIR: moved });
    expect(host.events).toEqual(["Stop"]);
    expect(host.mcp).toBe(true);
    expect(host.mcpFile).toBe(join(moved, ".claude.json"));
  });

  test("a settings file that is not JSON is not read, and is not counted as absent either", () => {
    mintStore();
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.json"), "{ this is not json");
    writeFileSync(join(root, ".claude.json"), "also not json");
    const host = readHost(root, root, {});
    expect(host.settingsRead).toEqual([]);
    expect(host.mcp).toBe(false);
    // The MCP file EXISTS and would not parse, which is a different fact from
    // "there is no registration" — and the line says so rather than telling
    // somebody to re-run a command they have already run.
    expect(host.mcpUnreadable).toBe(true);
    const finding = by(doctorFindings(input({ host })), "host");
    expect(finding.detail).toContain("could not be read");
    expect(finding.fix).not.toContain("claude mcp add");
  });

  test("the hook command is matched as a SUBSTRING, so a clone or a worktree counts", () => {
    mintStore();
    mkdirSync(join(root, ".claude"), { recursive: true });
    for (const command of [
      "/Users/x/.bun/bin/bun /Users/x/src/counterparts/src/adapters/claude-code/bin/hook.ts",
      "counterparts-hook",
      "/opt/homebrew/bin/bun /w/.claude/worktrees/a/src/adapters/claude-code/bin/hook.ts session-start",
    ]) {
      writeFileSync(
        join(root, ".claude", "settings.json"),
        JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } }),
      );
      expect(readHost(root, root, {}).events, command).toEqual(["SessionStart"]);
    }
    // Somebody else's hook on the same event is not ours.
    writeFileSync(
      join(root, ".claude", "settings.json"),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hello" }] }] },
      }),
    );
    expect(readHost(root, root, {}).events).toEqual([]);
  });

  test("a block pointing at a checkout that is GONE is a fault, not an install (review MINOR 1)", () => {
    // "GREEN while nothing fires" is the one outcome this line was added to
    // prevent. A settings block left behind by a deleted checkout matches the
    // command mark perfectly and fails at every session start, silently.
    mintStore();
    writeConfig();
    installHostSteps({ stale: true });
    const host = readHost(root, root, {});
    // It IS installed — the block is there — and it cannot work.
    expect(host.events).toEqual([...HOST_EVENTS].sort());
    expect(host.stale.map((s) => s.event)).toEqual([...HOST_EVENTS].sort());
    expect(host.mcp).toBe(true);

    const f = by(doctorFindings(input({ host })), "host");
    expect(f.severity).toBe("amber");
    expect(f.detail).toContain("which is not there");
    expect(f.detail).toContain("deleted-checkout");
    expect(f.fix).toContain("the path this install actually has");

    // A LIVE entry on the same event wins: one event may carry several, and a
    // working one is a working one.
    const settings = join(root, ".claude", "settings.json");
    writeFileSync(
      settings,
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: `/bin/bun ${join(root, "gone", "hook.ts")}` }] },
            { hooks: [{ type: "command", command: `/bin/bun ${join(root, "install", "counterparts-hook")}` }] },
          ],
        },
      }),
    );
    expect(readHost(root, root, {}).stale).toEqual([]);
  });

  test("a settings file that EXISTS and will not open is named, not dropped (review MINOR 2)", () => {
    // A mode-000 file and a DIRECTORY with that name both used to vanish from
    // the report, so the reader was told to paste a block they had pasted.
    mintStore();
    mkdirSync(join(root, ".claude"), { recursive: true });
    const bad = join(root, ".claude", "settings.json");
    writeFileSync(bad, "{ not json");
    // A directory where a file is expected — the reviewer's fixture (g).
    mkdirSync(join(root, ".claude", "settings.local.json"), { recursive: true });

    const host = readHost(root, root, {});
    expect(host.settingsRead).toEqual([]);
    expect(host.settingsUnreadable).toContain(bad);
    expect(host.settingsUnreadable).toContain(join(root, ".claude", "settings.local.json"));

    const f = by(doctorFindings(input({ host })), "host");
    expect(f.detail).toContain("could not read");
    expect(f.detail).toContain(bad);
    // And absent is still a different sentence from unreadable.
    rmSync(join(root, ".claude"), { recursive: true, force: true });
    const empty = readHost(root, root, {});
    expect(empty.settingsUnreadable).toEqual([]);
    expect(by(doctorFindings(input({ host: empty })), "host").detail).toContain(
      "no host settings file was readable",
    );
  });

  test("the command mark matches a COMMAND, not prose that mentions one (review NIT 3)", () => {
    mintStore();
    mkdirSync(join(root, ".claude"), { recursive: true });
    const settings = join(root, ".claude", "settings.json");
    const withCommand = (command: string): string[] => {
      writeFileSync(
        settings,
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }),
      );
      return [...readHost(root, root, {}).events];
    };
    // Ours, in the shapes `install` prints and a clone produces.
    expect(withCommand("counterparts-hook")).toEqual(["Stop"]);
    expect(withCommand("/x/.bun/bin/counterparts-hook")).toEqual(["Stop"]);
    expect(withCommand("/b/bun /x/src/adapters/claude-code/bin/hook.ts stop")).toEqual(["Stop"]);
    // Not ours: a command that merely says the word.
    expect(withCommand("echo installing-counterparts-hooks-later")).toEqual([]);
    expect(withCommand("echo 'see counterparts-hookup docs'")).toEqual([]);
  });

  test("with no host reading handed in, there is no Host finding at all", () => {
    // The hook's case: it is already running BECAUSE the hooks are installed,
    // and it does not pay for four more file reads. Absence, not a guess.
    mintStore();
    writeConfig();
    expect(doctorFindings(input()).find((f) => f.key === "host")).toBeUndefined();
  });
});

// ── the checkout finding (which code is live) ───────────────────────────────

/**
 * The hooks are invoked by ABSOLUTE PATH out of the host's settings, so the
 * install tree's working state is the code that runs against the owner's
 * memory. A peer session's unmerged branch sat in that tree and was live for
 * seven minutes.
 */
describe("doctor — which checkout is running", () => {
  /** A git that answers from a table. `null` means "this call failed with a
   *  status", which is how git says "not a repository". */
  function fakeGit(answers: Record<string, string | null>, failed: "missing" | "timeout" | null = null): GitRunner {
    return (args) => {
      if (failed !== null) return { ok: false, out: "", failed };
      const key = args.join(" ");
      const value = answers[key];
      if (value === undefined || value === null) return { ok: false, out: "", failed: "status" };
      return { ok: true, out: value, failed: null };
    };
  }

  const ORIGIN = "refs/remotes/origin/master";
  /** HEAD IS origin/master, on the master branch, with a clean tree. */
  const CLEAN: Record<string, string | null> = {
    "rev-parse --git-dir": ".git\n",
    "symbolic-ref -q --short HEAD": "master\n",
    "rev-parse --short HEAD": "abc1234\n",
    "status --porcelain --untracked-files=no": "",
    [`rev-parse --short ${ORIGIN}`]: "abc1234\n",
  };

  test("HEAD at origin/master and clean is green", () => {
    const reading = readCheckout({ root: "/repo", git: fakeGit(CLEAN) });
    expect(reading.reason).toBe("master");
    expect(reading.dirty).toBe(0);
    expect(reading.atMaster).toBe(true);
    expect(reading.originMaster).toBe("abc1234");
    mintStore();
    writeConfig();
    expect(by(doctorFindings(input({ checkout: reading })), "checkout").severity).toBe("green");
  });

  /**
   * THE DEPLOY STATE, and it is not a fault: the install tree is often detached
   * AT origin/master. Grading on the branch name alone would have called the
   * intended state red.
   */
  test("DETACHED AT origin/master is green — that is the deploy state", () => {
    const reading = readCheckout({
      root: "/repo",
      git: fakeGit({ ...CLEAN, "symbolic-ref -q --short HEAD": null }),
    });
    expect(reading.reason).toBe("master");
    expect(reading.branch).toBe(null);
    expect(reading.atMaster).toBe(true);
  });

  /**
   * THE CASE THAT SET THE RULE (2026-09-14): a merge to origin/master does NOT
   * deploy. This tree sat at an older sha for thirty minutes afterwards, and
   * every hook in that window ran the old code while "it's merged" was true.
   */
  test("behind origin/master is AMBER — merged code, but old code, and it says so", () => {
    const reading = readCheckout({
      root: "/repo",
      git: fakeGit({
        ...CLEAN,
        "rev-parse --short HEAD": "old0001\n",
        "merge-base --is-ancestor HEAD refs/remotes/origin/master": "",
        [`rev-list --count HEAD..${ORIGIN}`]: "3\n",
      }),
    });
    expect(reading.reason).toBe("behind");
    expect(reading.behindBy).toBe(3);
    mintStore();
    writeConfig();
    const findings = doctorFindings(input({ checkout: reading }));
    expect(by(findings, "checkout").severity).toBe("amber");
    expect(by(findings, "checkout").detail).toContain("behind origin/master by 3 commits");
    // AMBER NEVER REACHES THE TERMINAL: `doctor` prints it, the hook does not.
    expect(noticeMessage(findings)).toBe(null);
  });

  test("an UNTRACKED file leaves it green: the shared tree carries some by design", () => {
    // `--untracked-files=no` is the whole point — `docs/IMPROVEMENTS.md` and
    // `.claude/worktrees/` live in that tree and change nothing about what runs.
    const reading = readCheckout({ root: "/repo", git: fakeGit(CLEAN) });
    expect(reading.reason).toBe("master");
    expect(reading.dirty).toBe(0);
  });

  test("a modified TRACKED file is red, and the count is one", () => {
    const reading = readCheckout({
      root: "/repo",
      git: fakeGit({ ...CLEAN, "status --porcelain --untracked-files=no": " M src/core/counterpart.ts\n" }),
    });
    expect(reading.reason).toBe("dirty");
    expect(reading.dirty).toBe(1);
    mintStore();
    writeConfig();
    const findings = doctorFindings(input({ checkout: reading }));
    expect(by(findings, "checkout").severity).toBe("red");
    expect(by(findings, "checkout").detail).toContain("1 tracked file");
  });

  test("an unmerged branch is red and names the branch and the sha", () => {
    const reading = readCheckout({
      root: "/repo",
      git: fakeGit({
        ...CLEAN,
        "symbolic-ref -q --short HEAD": "feat/something\n",
        "rev-parse --short HEAD": "fee1234\n",
      }),
    });
    expect(reading.reason).toBe("branch");
    mintStore();
    writeConfig();
    const findings = doctorFindings(input({ checkout: reading }));
    expect(by(findings, "checkout").severity).toBe("red");
    expect(by(findings, "checkout").detail).toContain("feat/something@fee1234");
    expect(by(findings, "checkout").detail).toContain("not an ancestor of origin/master");
    expect(by(findings, "checkout").fix).toContain("checkout master");
  });

  test("a detached HEAD that is NOT origin/master and not an ancestor of it is red", () => {
    const reading = readCheckout({
      root: "/repo",
      git: fakeGit({
        ...CLEAN,
        "symbolic-ref -q --short HEAD": null,
        "rev-parse --short HEAD": "dead001\n",
      }),
    });
    expect(reading.reason).toBe("detached");
    mintStore();
    writeConfig();
    expect(by(doctorFindings(input({ checkout: reading })), "checkout").severity).toBe("red");
  });

  test("a repository with no origin/master ref is neutral — there is nothing to grade against", () => {
    const reading = readCheckout({
      root: "/repo",
      git: fakeGit({ ...CLEAN, [`rev-parse --short ${ORIGIN}`]: null }),
    });
    expect(reading.reason).toBe("unreadable");
    expect(reading.originMaster).toBe(null);
    mintStore();
    writeConfig();
    const findings = doctorFindings(input({ checkout: reading }));
    expect(by(findings, "checkout").severity).toBe("green");
    expect(by(findings, "checkout").detail).toContain("nothing to grade against");
  });

  test("not a repository is neutral — an installed package has nothing to grade", () => {
    const reading = readCheckout({ root: "/repo", git: fakeGit({}) });
    expect(reading.reason).toBe("not-a-repo");
    mintStore();
    writeConfig();
    const findings = doctorFindings(input({ checkout: reading }));
    expect(by(findings, "checkout").severity).toBe("green");
    expect(anyRed(findings)).toBe(false);
  });

  test("a git that never answers is neutral, never an exception on the hot path", () => {
    const reading = readCheckout({ root: "/repo", git: fakeGit({}, "missing") });
    expect(reading.reason).toBe("unreadable");
    const timedOut = readCheckout({ root: "/repo", git: fakeGit({}, "timeout") });
    expect(timedOut.reason).toBe("unreadable");
  });

  /**
   * THE READING'S OWN BUDGET, measured against a git that really blocks.
   *
   * `readCheckout` runs BEFORE `doctorFindings`, so the notice's 150 ms never
   * covered it: seven `spawnSync` calls at `CHECKOUT_TIMEOUT_MS` each is
   * fourteen seconds of foreground session start, and the reviewer of this PR
   * reproduced 7.81 s of it with a shim exactly like this one. The whole
   * reading is now one budget, and what it costs when git will not answer is
   * that budget once.
   */
  test("a git that sleeps costs ONE budget, not one timeout per call", () => {
    const bin = mkdtempSync(join(tmpdir(), "counterparts-gitshim-"));
    writeFileSync(join(bin, "git"), "#!/bin/sh\nsleep 1.2\necho never\n");
    chmodSync(join(bin, "git"), 0o755);
    const started = Date.now();
    const reading = readCheckout({
      root,
      // The PATH is injected rather than mutated: `spawnSync` under bun resolves
      // the binary against the environment it is GIVEN, and a test that mutated
      // `process.env` would measure the developer's own git instead.
      env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` },
    });
    const elapsed = Date.now() - started;
    rmSync(bin, { recursive: true, force: true });
    expect(reading.reason).toBe("unreadable");
    expect(reading.timedOut).toBe(true);
    // One budget plus the spawn itself — never the 8.4 s seven sleeping calls
    // would have cost.
    expect(elapsed).toBeLessThan(CHECKOUT_BUDGET_MS + 500);
  });

  test("once the budget is spent no further git call is made at all", () => {
    let calls = 0;
    let clock = 0;
    const reading = readCheckout({
      root: "/repo",
      budgetMs: 100,
      now: () => clock,
      git: (args) => {
        calls += 1;
        clock += 60; // each call eats more than half the budget
        return fakeGit(CLEAN)(args);
      },
    });
    // Two calls fit inside 100 ms; the third finds the budget gone.
    expect(calls).toBe(2);
    expect(reading.reason).toBe("unreadable");
    expect(reading.timedOut).toBe(true);
  });

  test("no package root at all resolves to not-a-repo without running git", () => {
    let calls = 0;
    const reading = readCheckout({
      root: null,
      git: () => {
        calls += 1;
        return { ok: false, out: "", failed: "status" };
      },
    });
    expect(reading.reason).toBe("not-a-repo");
    expect(calls).toBe(0);
  });
});

// ── the session-start notice ────────────────────────────────────────────────

describe("the session-start notice", () => {
  function adapterOn(over: Record<string, unknown> = {}): ReturnType<typeof openAdapter> {
    const a = openAdapter(
      { dataDir: dir, injectionBudgetBytes: 9000, embedder: { enabled: true }, ...over },
      {
        command: "/bin/true",
        args: ["runner"],
        spawner: () => ({ pid: 1 }),
        configPath,
      },
    );
    open.push(a.counterpart);
    return a;
  }

  const hookInput = { sessionId: "s1", scope: "/tmp/scope", turns: [], at: "2026-09-14" };

  test("a red finding produces a notice naming it; a healthy store produces none", () => {
    mintStore();
    writeConfig();
    markRefused();
    const sick = adapterOn();
    const notice = sick.notice(hookInput, { checkout: onMaster });
    expect(notice).not.toBe(null);
    expect(notice).toContain("WATCHDOG_EXCEEDS_STALENESS");
    expect(notice?.endsWith("run: counterparts doctor")).toBe(true);
  });

  test("a healthy store produces no notice at all", () => {
    mintStore();
    writeConfig();
    expect(adapterOn().notice(hookInput, { checkout: onMaster })).toBe(null);
  });

  test("amber never reaches the terminal: recall by meaning switched off says nothing", () => {
    mintStore();
    writeConfig();
    expect(adapterOn({ embedder: { enabled: false } }).notice(hookInput, { checkout: onMaster })).toBe(null);
  });

  test("an observer says nothing, and writes no checkout row", () => {
    mintStore();
    writeConfig();
    const a = adapterOn({ observer: true });
    expect(a.notice(hookInput, { checkout: onMaster })).toBe(null);
    const s = store();
    expect(s.eventLog({ name: CHECKOUT_EVENT }).length).toBe(0);
  });

  test("a doctor reading that throws degrades to no notice PLUS a ring event", () => {
    mintStore();
    writeConfig();
    const a = adapterOn();
    // The store is closed under it — the sharpest version of "the reading
    // failed", and the one that would otherwise throw inside a foreground hook.
    a.counterpart.close();
    expect(a.notice(hookInput, { checkout: onMaster })).toBe(null);
    expect(a.events("adapter.doctor.failed").length).toBe(1);
  });

  test("ONE durable checkout row per session start, latched per date, head, dirtiness and reason", () => {
    mintStore();
    writeConfig();
    const a = adapterOn();
    a.notice(hookInput, { checkout: onMaster });
    a.notice(hookInput, { checkout: onMaster });
    a.counterpart.close();
    const s = store();
    const rows = s.eventLog({ name: CHECKOUT_EVENT });
    expect(rows.length).toBe(1);
    const payload = JSON.parse(rows[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["reason"]).toBe("master");
    expect(payload["branch"]).toBe("master");
    expect(payload["head"]).toBe("abc1234");
    expect(payload["dirty"]).toBe(0);
    expect(payload["date"]).toBe("2026-09-14");
  });

  test("a branch leaves a row whose reason is 'branch', beside the day's master row", () => {
    mintStore();
    writeConfig();
    const a = adapterOn();
    a.notice(hookInput, { checkout: onMaster });
    const onBranch: CheckoutReading = {
      reason: "branch",
      root: "/repo",
      branch: "feat/x",
      head: "def5678",
      dirty: 0,
      behindBy: null,
      originMaster: "abc1234",
      atMaster: false,
      timedOut: false,
    };
    const notice = a.notice(hookInput, { checkout: onBranch });
    expect(notice).toContain("feat/x@def5678");
    a.counterpart.close();
    const rows = store().eventLog({ name: CHECKOUT_EVENT });
    expect(rows.length).toBe(2);
    expect(rows.map((r) => (JSON.parse(r.payload ?? "{}") as { reason: string }).reason).sort()).toEqual([
      "branch",
      "master",
    ]);
  });

  test("a checkout that could not be graded leaves no row and one ring event", () => {
    mintStore();
    writeConfig();
    const a = adapterOn();
    a.notice(hookInput, {
      checkout: {
        reason: "unreadable",
        root: "/repo",
        branch: null,
        head: null,
        dirty: 0,
        behindBy: null,
        originMaster: null,
        atMaster: false,
        timedOut: false,
      },
    });
    expect(a.events("adapter.checkout.unreadable").length).toBe(1);
    expect(a.events("adapter.checkout.unreadable")[0]?.data["why"]).toBe("git");
    a.counterpart.close();
    expect(store().eventLog({ name: CHECKOUT_EVENT }).length).toBe(0);
  });

  /** A git that ran out of time says something different from a git that
   *  answered: the row is the only place that difference survives. */
  test("a checkout reading that ran out of its budget leaves a timeout ring row and no durable row", () => {
    mintStore();
    writeConfig();
    const a = adapterOn();
    a.notice(hookInput, {
      checkout: {
        reason: "unreadable",
        root: "/repo",
        branch: null,
        head: null,
        dirty: 0,
        behindBy: null,
        originMaster: null,
        atMaster: false,
        timedOut: true,
      },
    });
    const rows = a.events("adapter.checkout.unreadable");
    expect(rows.length).toBe(1);
    expect(rows[0]?.data["why"]).toBe("timeout");
    a.counterpart.close();
    expect(store().eventLog({ name: CHECKOUT_EVENT }).length).toBe(0);
  });

  /**
   * THE LATCH HAS TO CARRY THE REASON. Same head, same clean tree, same day —
   * and a `git fetch` in the shared tree between two sessions moves
   * origin/master under it, so the morning's `master` becomes the afternoon's
   * `behind`. Latching on date+head+dirty alone left the day's record saying
   * `master` for a tree that spent the afternoon behind it.
   */
  test("a day that FLIPS from master to behind leaves two rows, not one latched master", () => {
    mintStore();
    writeConfig();
    const a = adapterOn();
    a.notice(hookInput, { checkout: onMaster });
    // The fetch happened: the same clean head is now two commits behind.
    a.notice(hookInput, {
      checkout: { ...onMaster, reason: "behind", behindBy: 2, originMaster: "fff9999", atMaster: false },
    });
    a.notice(hookInput, { checkout: onMaster });
    a.counterpart.close();
    const rows = store().eventLog({ name: CHECKOUT_EVENT });
    expect(rows.map((r) => (JSON.parse(r.payload ?? "{}") as { reason: string }).reason)).toEqual(["master", "behind"]);
  });

  /**
   * THE NOTICE MAY NOT COST THE WAKE. The host caps every hook output string at
   * 10,000 characters, so a notice is a tax on the one thing the session cannot
   * start without — and `NOTICE_MAX_CHARS` is the ceiling on that tax. What is
   * cut is the explanation; what survives is the way to read the whole of it.
   */
  test("a notice is capped and still ends with the command that prints the rest", () => {
    const huge: Finding = {
      key: "spawn",
      severity: "red",
      title: "Spawn",
      detail: "d".repeat(5000),
      fix: "f".repeat(500),
      data: {},
    };
    const msg = noticeMessage([huge]);
    expect(msg).not.toBe(null);
    expect((msg ?? "").length).toBeLessThanOrEqual(NOTICE_MAX_CHARS);
    expect((msg ?? "").endsWith("run: counterparts doctor")).toBe(true);
    expect(msg).toContain("…");
    // And a short one is untouched — the cap is a ceiling, not a format.
    const small = noticeMessage([{ ...huge, detail: "refused", fix: "read it" }]);
    expect(small).toBe("counterparts: Spawn — refused. read it\nrun: counterparts doctor");
  });

  test("a dropped notice is recorded with the lengths that dropped it", () => {
    mintStore();
    writeConfig();
    const a = adapterOn();
    a.noteNoticeDropped({ noticeChars: 352, envelopeChars: 9618, limitChars: ENVELOPE_MAX_CHARS });
    const rows = a.events("adapter.notice.dropped");
    expect(rows.length).toBe(1);
    expect(rows[0]?.data["envelopeChars"]).toBe(9618);
    expect(rows[0]?.data["noticeChars"]).toBe(352);
  });
});

// ── the delivery channel ────────────────────────────────────────────────────

/**
 * The measured channel, and the documented one:
 * https://code.claude.com/docs/en/hooks — `systemMessage` is a top-level field
 * shown to the user; SessionStart's `hookSpecificOutput` carries
 * `hookEventName` and `additionalContext`; and when stdout parses as JSON the
 * raw stdout is NOT also added to context, so the wake must ride entirely in
 * `additionalContext`.
 */
describe("hostDelivery — the notice's channel", () => {
  const wake = { injection: "WAKE BUNDLE\n\nsecond paragraph", ask: null };

  test("a healthy session start is byte-identical to what it printed before", () => {
    const before = hostDelivery("session-start", wake, {});
    const after = hostDelivery("session-start", wake, {}, null);
    expect(after.stdout).toBe(before.stdout);
    expect(after.stdout).toBe("WAKE BUNDLE\n\nsecond paragraph");
    // NOT JSON: the plain form is the one measured on this host since day 0.
    expect(after.stdout.startsWith("{")).toBe(false);
    expect(after.exitCode).toBe(0);
  });

  test("a red notice makes it JSON, and additionalContext is the plain wake byte for byte", () => {
    const plain = hostDelivery("session-start", wake, {}).stdout;
    const out = hostDelivery("session-start", wake, {}, "counterparts: Credentials — …\nrun: counterparts doctor");
    const parsed = JSON.parse(out.stdout) as {
      systemMessage: string;
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.systemMessage).toContain("run: counterparts doctor");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toBe(plain);
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBe(0);
  });

  /**
   * THE RED DAY'S OWN TRAP, computed by the reviewer of this PR and reproduced
   * here: the wake the live host injects is ~9 KB, JSON escaping adds a
   * character per newline, and the envelope for a 9,038-byte wake plus a
   * 352-character notice measures 9,618 characters — past `ENVELOPE_MAX_CHARS`
   * and one bad morning from the host's 10,000-character cap, where the stdout
   * is replaced with a preview, stops parsing as JSON, and takes the whole wake
   * with it. So the notice is what gets dropped, never the memory.
   */
  test("an envelope that would not fit falls back to the PLAIN wake and says it dropped the notice", () => {
    const wake = `${"w".repeat(68)}\n`.repeat(131).slice(0, 9038);
    const notice = `${"n".repeat(352 - 1 - NOTICE_TAIL.length)}\n${NOTICE_TAIL}`;
    expect(wake.length).toBe(9038);
    expect(notice.length).toBe(352);
    const out = hostDelivery("session-start", { injection: wake, ask: null }, {}, notice);
    // The wake, byte for byte what the plain form would have printed.
    expect(out.stdout).toBe(hostDelivery("session-start", { injection: wake, ask: null }, {}).stdout);
    expect(out.stdout.startsWith("{")).toBe(false);
    expect(out.dropped?.noticeChars).toBe(352);
    expect(out.dropped?.envelopeChars).toBeGreaterThan(ENVELOPE_MAX_CHARS);
    expect(out.dropped?.limitChars).toBe(ENVELOPE_MAX_CHARS);
  });

  test("an envelope that fits still carries both, and reports nothing dropped", () => {
    const out = hostDelivery("session-start", wake, {}, `short\n${NOTICE_TAIL}`);
    expect(out.stdout.startsWith("{")).toBe(true);
    expect(out.stdout.length).toBeLessThanOrEqual(ENVELOPE_MAX_CHARS);
    expect(out.dropped).toBe(null);
  });

  test("user-prompt-submit never emits JSON WITHOUT a notice, and the doctor's is never handed to it", () => {
    // The doctor notice is asked at session start only (`bin/hook.ts`): a
    // warning, not a nag. The ONE line a prompt carries is roadmap E's update
    // notice, once per session (2026-09-23) — `test/schema-gate.test.ts`
    // "hostDelivery at a prompt" pins that envelope.
    expect(hostDelivery("user-prompt-submit", { injection: "recall", ask: null }, {}).stdout).toBe("recall");
    expect(hostDelivery("user-prompt-submit", { injection: "recall", ask: null }, {}, null).stdout).toBe("recall");
  });

  test("Stop keeps its own channel, and the notice never rides it", () => {
    // The one shape (2026-09-24): the Stop's own one line is the
    // `systemMessage`, never the SessionStart notice; the ask is the feedback.
    const out = hostDelivery("stop", { injection: null, ask: "write the episode" }, {}, "a notice");
    expect(out.exitCode).toBe(0);
    expect(out.stderr).toBe("");
    const parsed = JSON.parse(out.stdout) as Record<string, unknown>;
    expect(parsed["decision"]).toBeUndefined();
    expect(parsed["hookSpecificOutput"]).toEqual({ hookEventName: "Stop", additionalContext: "write the episode" });
    expect(parsed["systemMessage"]).not.toContain("a notice");
  });
});

// ── the console ─────────────────────────────────────────────────────────────

describe("counterparts doctor", () => {
  test("prints the report and exits 1 when anything is red", async () => {
    mintStore();
    writeConfig();
    markRefused();
    const c = consoleWith();
    const code = await run(["doctor", `--config=${configPath}`], {
      io: c.io,
      env: {},
      home: root,
      checkout: onMaster,
    });
    expect(code).toBe(1);
    const said = c.out.join("\n");
    expect(said).toContain("RED");
    expect(said).toContain("WATCHDOG_EXCEEDS_STALENESS");
  });

  test("exits 0 when nothing is red", async () => {
    mintStore();
    writeConfig();
    // The two steps the user does BY HAND, installed (finding 4). Without them
    // the Host line is amber, which is the whole point of it existing.
    installHostSteps();
    const c = consoleWith();
    const code = await run(["doctor", `--config=${configPath}`], {
      io: c.io,
      env: {},
      home: root,
      checkout: onMaster,
    });
    expect(code).toBe(EXIT.ok);
    // THE COUNTS, ALWAYS (the owner's answer 12): "Nothing to fix." is gone.
    // A screen that reads `0 red, 0 amber, 2 off, 5 green.` on a terminal and a
    // sentence in a pipe is two reports of one store.
    expect(c.out[c.out.length - 1]).toMatch(/^0 red, 0 amber, \d+ green\.$/);
  });

  test("--json is machine-readable, ids and counts only", async () => {
    mintStore();
    writeConfig();
    const c = consoleWith();
    await run(["doctor", `--config=${configPath}`, "--json"], { io: c.io, env: {}, home: root, checkout: onMaster });
    const json = JSON.parse(c.out.join("\n")) as { date: string; red: number; findings: unknown[] };
    expect(json.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.red).toBe(0);
    expect(json.findings.length).toBeGreaterThan(5);
  });

  /**
   * `--json` IS THE READING, NEVER THE SCREEN (the owner's answer 12). The
   * terminal folds thirteen green lines into one and hides nothing else; this
   * output carries every finding whatever a terminal would have done with it,
   * because a script that stopped seeing `sweep` on the day a store went quiet
   * is a script that cannot tell quiet from gone.
   */
  test("--json is complete and unfolded, and an OFF finding is amber plus `optional`", async () => {
    mintStore();
    // The embedder knob OFF — written, because since 2026-09-23 an absent block
    // reads as the local table (config.ts#resolveEmbedder).
    writeConfig({ embedder: { enabled: false } });
    installHostSteps();
    const c = consoleWith();
    const code = await run(["doctor", `--config=${configPath}`, "--json"], {
      io: c.io,
      env: {},
      home: root,
      checkout: onMaster,
    });
    const json = JSON.parse(c.out.join("\n")) as {
      red: number;
      amber: number;
      off: number;
      green: number;
      findings: { key: string; severity: string; optional?: boolean; fix: string }[];
    };
    const keys = json.findings.map((f) => f.key);
    // Every worker-internal line the terminal would have folded away is here.
    for (const k of ["sweep", "sleep", "backfill", "clock", "spawn", "journal", "stance", "checkout"]) {
      expect(keys).toContain(k);
    }
    // THE OFF FINDING: amber underneath, so nothing that switches on a
    // severity moves; `optional: true` for a reader that wants the new word.
    // (One now: the crash write-up is #192's green `next session` line.)
    const offs = json.findings.filter((f) => f.optional === true);
    expect(offs.map((f) => f.key)).toEqual(["embedder"]);
    for (const f of offs) expect(f.severity).toBe("amber");
    // …and the counts at the top split them, so the JSON and the screen cannot
    // disagree about how many warnings there are.
    expect(json.off).toBe(1);
    expect(json.amber).toBe(json.findings.filter((f) => f.severity === "amber" && f.optional !== true).length);
    expect(json.red + json.amber + json.off + json.green).toBe(json.findings.length);
    // AN OFF FINDING DOES NOT MOVE THE EXIT CODE: nothing is wrong.
    expect(json.red).toBe(0);
    expect(code).toBe(EXIT.ok);
  });

  test("it reads the store the CONFIG names, not the one the environment does", async () => {
    mintStore();
    writeConfig();
    const elsewhere = join(root, "other-store");
    const c = consoleWith();
    await run(["doctor", `--config=${configPath}`, "--json"], {
      io: c.io,
      env: { COUNTERPARTS_DATA_DIR: elsewhere },
      home: root,
      checkout: onMaster,
    });
    const json = JSON.parse(c.out.join("\n")) as { findings: { key: string; data: Record<string, unknown> }[] };
    expect(json.findings.find((f) => f.key === "store")?.data["dir"]).toBe(dir);
  });

  /** The same door `verify`'s census meets: a store nobody named is refused. */
  test("a store named only by the armed explicit-dir guard is refused, as verify refuses it", async () => {
    writeFileSync(configPath, JSON.stringify({ owner: true }));
    const c = consoleWith();
    const code = await run(["doctor", `--config=${configPath}`], {
      io: c.io,
      env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      home: root,
      checkout: onMaster,
    });
    expect(code).toBe(EXIT.refused);
    expect(c.err.join("\n")).toContain("--dir");
  });

  /**
   * THE CASE THE TEST ABOVE DOES NOT COVER, AND THE ONE THAT HAPPENED.
   *
   * That config names no `dataDir`, so the reading fell through to `resolveDir`
   * and met the guard there. Every real machine's config DOES name one — that is
   * what `install` writes — so the guard was never reached at all, and the
   * reviewer ran `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 counterparts doctor` on
   * the owner's own machine and watched it print his live paths. A configuration
   * nobody named does not get to name the store.
   */
  test("a DEFAULT-LOCATED config that names a dataDir is refused under the guard, and reads nothing", async () => {
    mintStore();
    // Exactly where `resolveConfigPath` looks when nobody names one.
    const defaultConfig = join(root, ".counterparts", "claude-code.json");
    mkdirSync(join(root, ".counterparts"), { recursive: true });
    writeFileSync(defaultConfig, JSON.stringify({ dataDir: dir }));
    const c = consoleWith();
    const code = await run(["doctor"], {
      io: c.io,
      env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      home: root,
      checkout: onMaster,
    });
    expect(code).toBe(EXIT.refused);
    const said = c.err.join("\n");
    expect(said).toContain("refused: COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1");
    expect(said).toContain(defaultConfig);
    // Nothing was read and nothing was printed about the store it named.
    expect(c.out.join("\n")).toBe("");
    expect(said).not.toContain(dir);
  });

  /**
   * `--dir` IS A NAME (2026-09-20, finding 6).
   *
   * The guard exists so nothing nobody named gets opened, and `--dir <store>`
   * names one — so the refusal was really about the CONFIGURATION beside it,
   * which is the owner's live one. `doctor` now
   * declines to read that file at all and grades the store on its own. On
   * cut-over day this is the difference between "point doctor at the parked
   * store" and a refusal with nothing to do.
   */
  test("--dir alone works read-only under the guard, and says which questions went unasked", async () => {
    mintStore();
    // The DEFAULT config exists and names a different store, exactly as it does
    // on a real machine. Nothing here may open it.
    const defaultConfig = join(root, ".counterparts", "claude-code.json");
    mkdirSync(join(root, ".counterparts"), { recursive: true });
    const liveCreds = join(root, ".counterparts", "credentials.env");
    writeFileSync(liveCreds, `SOME_OLD_KEY=${SECRET}\n`, { mode: 0o600 });
    writeFileSync(
      defaultConfig,
      JSON.stringify({ dataDir: "/somewhere/else", credentialsFile: liveCreds }),
    );

    const c = consoleWith();
    const code = await run(["doctor", `--dir=${dir}`], {
      io: c.io,
      env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      home: root,
      checkout: onMaster,
    });
    const said = c.out.join("\n");
    expect(code).toBe(EXIT.ok);

    // THE STORE WAS GRADED. That is the whole point.
    expect(said).toContain(dir);
    expect(said).toContain("GREEN  Memory");
    expect(said).toContain("Clock");

    // AND THE CONFIGURATION WAS NOT READ — not its dataDir, and above all not
    // the credentials file it names, which is the thing the guard protects.
    expect(said).toContain("not read");
    expect(said).toContain("--config");
    expect(said).not.toContain("/somewhere/else");
    expect(said).not.toContain(SECRET);
    expect(said).not.toContain(liveCreds);
    expect(said).not.toContain("Credentials");
    expect(said).not.toContain("Embedder");
  });

  test("the guard does NOT refuse a configuration somebody named — that is the way through", async () => {
    mintStore();
    writeConfig();
    const c = consoleWith();
    const code = await run(["doctor", `--config=${configPath}`], {
      io: c.io,
      env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      home: root,
      checkout: onMaster,
    });
    expect(code).toBe(EXIT.ok);
    expect(c.out.join("\n")).toContain(dir);
  });

  test("it writes nothing: the store is byte-for-byte what it was", async () => {
    mintStore();
    writeConfig();
    const s = store();
    const before = s.eventLog({ limit: 1000 }).length;
    s.close();
    const c = consoleWith();
    await run(["doctor", `--config=${configPath}`], { io: c.io, env: {}, home: root, checkout: onMaster });
    expect(store().eventLog({ limit: 1000 }).length).toBe(before);
  });
});

describe("a store younger than the window it is graded over (findings 8, 9)", () => {
  test("a store made TODAY says 'since <today>', and not a week it did not exist for", () => {
    mintStore();
    writeConfig();
    const s = store();
    s.setMeta(STORE_CREATED_KEY, "2026-09-14");
    const f = by(doctorFindings(input({ store: s })), "authorship");
    expect(f.detail.startsWith("since 2026-09-14: ")).toBe(true);
    expect(f.detail).not.toContain("2026-09-08");
    // "of that week" is part of the same claim and goes with it.
    expect(f.detail).toContain("in that time");
    expect(f.detail).not.toContain("of that week");
    // The READING is untouched: the counts are still taken over the full window.
    expect(f.data["from"]).toBe("2026-09-08");
    expect(f.data["shownFrom"]).toBe("2026-09-14");
    expect(f.severity).toBe("green");
  });

  test("a store made THREE DAYS AGO names those three days", () => {
    mintStore();
    writeConfig();
    const s = store();
    s.setMeta(STORE_CREATED_KEY, "2026-09-11");
    const f = by(doctorFindings(input({ store: s })), "authorship");
    expect(f.detail.startsWith("2026-09-11→2026-09-14: ")).toBe(true);
  });

  test("`start-fresh`'s own record is read too, and the EARLIEST evidence wins", () => {
    mintStore();
    writeConfig();
    const s = store();
    // The key `start-fresh` writes. `doctor.ts` spells it out rather than
    // importing it (that would be a cycle), so this test is what holds the two
    // strings to each other: rename `STORE_STARTED_KEY` and this fails.
    s.setMeta(STORE_STARTED_KEY, "2026-09-12");
    s.setMeta(STORE_CREATED_KEY, "2026-09-13");
    const f = by(doctorFindings(input({ store: s })), "authorship");
    expect(f.detail.startsWith("2026-09-12→2026-09-14: ")).toBe(true);
  });

  test("a store OLDER than the window keeps the full seven days", () => {
    mintStore();
    writeConfig();
    const s = store();
    s.setMeta(STORE_CREATED_KEY, "2026-01-01");
    const f = by(doctorFindings(input({ store: s })), "authorship");
    expect(f.detail.startsWith("2026-09-08→2026-09-14: ")).toBe(true);
    expect(f.detail).toContain("of that week");
  });

  test("a store with no record of its beginning that dates itself AFTER today clamps nothing", () => {
    // Every store made before 2026-09-21 has no `store.created`, and since
    // 2026-09-23 the reading falls back to the store's own evidence (the tests
    // below). Here that evidence — no events, and a database file born
    // just now — lands after this test's `today`, which is a clock nobody
    // should trust, so the sentence is the one it always was.
    mintStore();
    writeConfig();
    const s = store();
    s.setMeta(STORE_CREATED_KEY, "");
    expect(s.eventLog({ limit: 1 })).toHaveLength(0);
    const f = by(doctorFindings(input({ store: s })), "authorship");
    expect(f.detail.startsWith("2026-09-08→2026-09-14: ")).toBe(true);
  });

  // ── #8 for the stores 0.1.0 made (2026-09-23) ─────────────────────────────

  test("no `store.created`: the OLDEST EVENT ROW's write time says when it began", () => {
    // `at`, the moment the row was written, on the store's provenance clock —
    // not `rowDate`, which prefers the day a payload is ABOUT. The payload here
    // claims a date a year back, and it must not be believed.
    const clock = Date.parse("2026-09-12T10:00:00Z");
    const c = Counterpart.open({ dir, now: () => clock });
    c.close();
    writeConfig();
    const s = Store.open({ dir, now: () => clock });
    stores.push(s);
    s.setMeta(STORE_CREATED_KEY, "");
    s.appendEvent({
      name: SWEEP_GATE_EVENT,
      day: s.livedDay(),
      payload: { reason: "ran", ran: 1, scopes: 1, date: "2025-09-12" },
    });
    const f = by(doctorFindings(input({ store: s })), "authorship");
    expect(f.detail.startsWith("2026-09-12→2026-09-14: ")).toBe(true);
    expect(f.data["shownFrom"]).toBe("2026-09-12");
    // The READING is untouched, as for `store.created`.
    expect(f.data["from"]).toBe("2026-09-08");
  });

  test("the oldest event is the smallest `at`, not the first row written (#188 review M2)", () => {
    // A row written LATER (higher seq) with an EARLIER clock — replay tooling,
    // a clock that was wrong and was fixed — is the older evidence.
    const later = Date.parse("2026-09-12T10:00:00Z");
    const earlier = Date.parse("2026-09-10T10:00:00Z");
    const c = Counterpart.open({ dir, now: () => later });
    c.close();
    writeConfig();
    const first = Store.open({ dir, now: () => later });
    first.setMeta(STORE_CREATED_KEY, "");
    first.appendEvent({ name: SWEEP_GATE_EVENT, day: first.livedDay(), payload: { reason: "ran" } });
    first.close();
    const s = Store.open({ dir, now: () => earlier });
    stores.push(s);
    s.appendEvent({ name: SWEEP_GATE_EVENT, day: s.livedDay(), payload: { reason: "ran" } });
    expect(s.eventLog({ limit: 1 })[0]?.at).toBe(later);
    const f = by(doctorFindings(input({ store: s })), "authorship");
    expect(f.detail.startsWith("2026-09-10→2026-09-14: ")).toBe(true);
  });

  /** Make the database file's change time later than its birth, as any store
   *  that has been written since it was made has — a filesystem that keeps no
   *  birth time reports one no earlier than the change time, which is read as
   *  "no answer". */
  function touchDatabase(): number {
    const file = join(dir, DATABASE_FILE);
    const at = new Date();
    utimesSync(file, at, at);
    const st = statSync(file);
    expect(st.ctimeMs).toBeGreaterThan(st.birthtimeMs);
    return st.birthtimeMs;
  }

  test("no `store.created` and no events: the DATABASE FILE's birth time says when it began", () => {
    // The file is born now, so `today` three days on puts that birth inside
    // the window — which is exactly the store 0.1.0 made on a morning and was
    // graded that week.
    mintStore();
    writeConfig();
    const s = store();
    s.setMeta(STORE_CREATED_KEY, "");
    expect(s.eventLog({ limit: 1 })).toHaveLength(0);
    const born = touchDatabase();
    if (!(born > 0)) return; // a filesystem that keeps no birth time: nothing to read
    const bornOn = dateOf(born);
    const today = dateOf(born + 3 * 86_400_000);
    const f = by(doctorFindings(input({ store: s, today })), "authorship");
    expect(f.detail.startsWith(`${bornOn}→${today}: `)).toBe(true);
    expect(f.data["shownFrom"]).toBe(bornOn);
  });

  test("installed, then idle: the file's birth is EARLIER than the first event, and it wins (#188 review M2)", () => {
    // `install` writes no event, so a 0.1.0 store installed on one day and first
    // used days later has its oldest row on the later day. Taking that alone
    // hid the idle days — the silence the Authorship line exists to show.
    mintStore();
    writeConfig();
    const born = touchDatabase();
    if (!(born > 0)) return;
    const firstUse = born + 4 * 86_400_000;
    const s = Store.open({ dir, now: () => firstUse });
    stores.push(s);
    s.setMeta(STORE_CREATED_KEY, "");
    s.appendEvent({ name: SWEEP_GATE_EVENT, day: s.livedDay(), payload: { reason: "ran" } });
    const today = dateOf(born + 6 * 86_400_000);
    const f = by(doctorFindings(input({ store: s, today })), "authorship");
    expect(f.detail.startsWith(`${dateOf(born)}→${today}: `)).toBe(true);
  });

  test("and when the event is the earlier of the two — a file restored from a copy — the event wins", () => {
    mintStore();
    writeConfig();
    const born = touchDatabase();
    if (!(born > 0)) return;
    const firstRow = born - 3 * 86_400_000;
    const s = Store.open({ dir, now: () => firstRow });
    stores.push(s);
    s.setMeta(STORE_CREATED_KEY, "");
    s.appendEvent({ name: SWEEP_GATE_EVENT, day: s.livedDay(), payload: { reason: "ran" } });
    const today = dateOf(born + 2 * 86_400_000);
    const f = by(doctorFindings(input({ store: s, today })), "authorship");
    expect(f.detail.startsWith(`${dateOf(firstRow)}→${today}: `)).toBe(true);
  });

  test("a `store.created` that IS there wins: the fallbacks are fallbacks", () => {
    const clock = Date.parse("2026-09-09T10:00:00Z");
    mintStore();
    writeConfig();
    const s = Store.open({ dir, now: () => clock });
    stores.push(s);
    s.appendEvent({ name: SWEEP_GATE_EVENT, day: s.livedDay(), payload: { reason: "ran" } });
    s.setMeta(STORE_CREATED_KEY, "2026-09-13");
    const f = by(doctorFindings(input({ store: s })), "authorship");
    expect(f.detail.startsWith("2026-09-13→2026-09-14: ")).toBe(true);
  });

  test("a beginning AFTER today is a clock nobody should trust, and clamps nothing", () => {
    // Which is also every store in this file: they are minted now and graded
    // against a `today` in the past.
    mintStore();
    writeConfig();
    const s = store();
    s.setMeta(STORE_CREATED_KEY, "2026-09-20");
    const f = by(doctorFindings(input({ store: s })), "authorship");
    expect(f.detail.startsWith("2026-09-08→2026-09-14: ")).toBe(true);
  });

  test("a fresh store stamps the day it was made, on the provenance clock", () => {
    const made = join(root, "made-on-a-known-day");
    const c = Counterpart.open({ dir: made, now: () => Date.parse("2026-03-04T10:00:00Z") });
    c.close();
    // A SECOND open, on a different day, must not restamp it: a store that was
    // already there is never given a beginning it did not have.
    const again = Store.open({ dir: made, now: () => Date.parse("2026-05-06T10:00:00Z") });
    try {
      expect(again.getMeta(STORE_CREATED_KEY)).toBe("2026-03-04");
    } finally {
      again.close();
    }
    rmSync(made, { recursive: true, force: true });
  });

  test("Sweep: green `next session` — whether the row says `not-opted-in` or an older build's `no-credential`", () => {
    mintStore();
    writeConfig();
    {
      for (const reason of ["not-opted-in", "no-credential"]) {
        const s = store();
        s.appendEvent({
          name: SWEEP_GATE_EVENT,
          day: s.livedDay(),
          payload: { reason, ran: 0, scopes: 0, date: "2026-09-14" },
        });
        const findings = doctorFindings(input({ store: s }));
        const f = by(findings, "sweep");
        expect({ reason, severity: f.severity, fix: f.fix }).toEqual({ reason, severity: "green", fix: "" });
        expect(f.detail).toContain("next session");
        // Neither line points at a command.
        expect(by(findings, "crash-write-up").fix).toBe("");
        s.close();
        stores.splice(stores.indexOf(s), 1);
      }
    }
  });

  test("Sweep: every OTHER stand-down reason is still amber", () => {
    mintStore();
    writeConfig();
    const s = store();
    s.appendEvent({
      name: SWEEP_GATE_EVENT,
      day: s.livedDay(),
      payload: { reason: "observer", ran: 0, scopes: 0, date: "2026-09-14" },
    });
    const f = by(doctorFindings(input({ store: s })), "sweep");
    expect(f.severity).toBe("amber");
    expect(f.fix).toBe("The sweep stood down; the reason names why.");
  });
});

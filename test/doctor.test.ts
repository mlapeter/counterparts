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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { Store } from "../src/core/store/index.js";
import { journalModeOf, openDb } from "../src/core/store/db.js";
import {
  API_KEY_ENV,
  CHECKOUT_BUDGET_MS,
  EMBED_KEY_ENV,
  NOTICE_MAX_CHARS,
  NOTICE_TAIL,
  SPAWN_REFUSAL_PREFIX,
  TUNABLES,
  anyRed,
  doctorFindings,
  loadCredentials,
  noticeMessage,
  openAdapter,
  readCheckout,
  reportJson,
  reportLines,
} from "../src/adapters/claude-code/index.js";
import type { CheckoutReading, DoctorInput, Finding, GitRunner } from "../src/adapters/claude-code/index.js";
import { ENVELOPE_MAX_CHARS, hostDelivery } from "../src/adapters/claude-code/bin/hook.js";
import {
  EXIT,
  HOST_EVENTS,
  MCP_SERVER_NAME,
  credentialsTemplate,
  readHost,
  run,
} from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";

const SECRET = "sk-ant-not-a-real-key-0123456789";

let root: string;
let dir: string;
let configPath: string;
let credsPath: string;
const open: Counterpart[] = [];
const stores: Store[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-doctor-"));
  dir = join(root, "store");
  configPath = join(root, "claude-code.json");
  credsPath = join(root, "credentials.env");
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
  writeFileSync(join(path, "operational.sqlite"), "a copy");
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
      credentialsFile: credsPath,
      injectionBudgetBytes: 9000,
      embedder: { enabled: true },
      ...over,
    }),
  );
}

/** A credentials file holding exactly these names, 0600, like `install`'s. */
function writeCredentials(names: readonly string[]): void {
  writeFileSync(credsPath, names.map((n) => `${n}=${SECRET}`).join("\n") + "\n", { mode: 0o600 });
}

/**
 * A STORE THAT HAS INTERPRETED BEFORE (2026-09-20, finding 1).
 *
 * `gate.chunk` is the crash sweep's own row and the sweep is the only
 * interpreted write path, so one such row is the store's own proof that the
 * interpreter key worked here. It is what separates "a key went away" — the
 * case the RED was written for — from "this store has never had one", which
 * README and QUICKSTART §6 both call a supported way to run.
 */
function hasInterpreted(s: Store): void {
  s.appendEvent({ name: "gate.chunk", day: s.livedDay(), payload: { date: "2026-09-13" } });
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

/** The same fact, for a test that does not hold a store of its own. */
function markInterpreted(): void {
  const s = Store.open({ dir });
  try {
    hasInterpreted(s);
  } finally {
    s.close();
  }
}

/** The clean, green reading — every knob deliberately set, so each test below
 *  changes exactly one thing and the finding it moves is unambiguous. */
function input(over: Partial<DoctorInput> = {}): DoctorInput {
  const s = over.store === undefined ? store() : over.store;
  return {
    configPath,
    configReason: "loaded",
    config: { dataDir: dir, credentialsFile: credsPath, embedder: { enabled: true } },
    dir,
    credentials: loadCredentials(credsPath, {}),
    credentialsPath: credsPath,
    shellNames: [],
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    const findings = doctorFindings(input());
    expect(anyRed(findings)).toBe(false);
    expect(noticeMessage(findings)).toBe(null);
    expect(by(findings, "credentials").severity).toBe("green");
    expect(by(findings, "store").severity).toBe("green");
    expect(by(findings, "embedder").severity).toBe("green");
  });

  /**
   * I32 ITSELF. The file is exactly `install`'s template — 0 non-comment lines
   * — which is what a forced install leaves behind, and what ran for a week.
   */
  test("a key that WAS here and is gone is RED, names the missing name, and names the repair", () => {
    // The case this red was written for (I32): something that was running has
    // stopped. `gate.chunk` is the store's own proof the interpreter ran here.
    mintStore();
    writeConfig();
    writeFileSync(credsPath, credentialsTemplate(), { mode: 0o600 });
    const s = store();
    hasInterpreted(s);
    const findings = doctorFindings(input({ store: s }));
    const cred = by(findings, "credentials");
    expect(cred.severity).toBe("red");
    expect(cred.detail).toContain(API_KEY_ENV);
    expect(cred.detail).toContain("HAS interpreted before");
    expect(cred.detail).toContain("encodes nothing");
    expect(cred.fix).toContain(`counterparts credentials set ${API_KEY_ENV}`);
    expect(anyRed(findings)).toBe(true);

    // Worst first, and the notice says the worst thing first.
    expect(findings[0]?.severity).toBe("red");
    const notice = noticeMessage(findings);
    expect(notice).not.toBe(null);
    expect(notice).toContain(API_KEY_ENV);
    expect(notice?.endsWith("run: counterparts doctor")).toBe(true);
  });

  test("a store that has NEVER had a key is amber, and says what works without one (finding 1)", () => {
    // README: "No API keys are required." QUICKSTART §6: without the key the
    // worker still runs the day and only skips the crash sweep. `doctor` on a
    // brand-new keyless store printed a red and exited 1, so all three could
    // not be true — and the first thing the product said to a new user was
    // that their fresh install was broken.
    mintStore();
    writeConfig();
    writeFileSync(credsPath, credentialsTemplate(), { mode: 0o600 });
    const findings = doctorFindings(input());
    const cred = by(findings, "credentials");
    expect(cred.severity).toBe("amber");
    expect(cred.detail).toContain("no key has ever been used here");
    expect(cred.detail).toContain("supported way to run");
    // It says what DOES work, in words a new user can check against the page.
    expect(cred.detail).toContain("note, session_end, the journal, recall, the wake");
    // And what a key would add, so the choice is informed rather than nagged.
    expect(cred.detail).toContain("crash sweep");
    expect(cred.fix).toContain("Optional.");

    // NOTHING IS RED, so the command exits 0 and the SessionStart notice — the
    // one line the product gets in the terminal every session — stays quiet.
    expect(anyRed(findings)).toBe(false);
    expect(noticeMessage(findings)).toBe(null);

    // The discriminator is on the row, so a reader can check the verdict.
    expect(cred.data["everInterpreted"]).toBe(false);
  });

  test("a missing embed key is amber, not red — recall still works, lexically", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV]);
    const findings = doctorFindings(input());
    expect(by(findings, "credentials").severity).toBe("amber");
    expect(noticeMessage(findings)).toBe(null);
  });

  test("a group- or world-readable credentials file is its own amber finding", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    chmodSync(credsPath, 0o644);
    const findings = doctorFindings(input({ credentials: loadCredentials(credsPath, {}) }));
    expect(by(findings, "credentials-mode").severity).toBe("amber");
    expect(by(findings, "credentials-mode").fix).toContain("chmod 600");
  });

  test("NO VALUE, EVER: the file's content appears nowhere in the report or the JSON", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    const findings = doctorFindings(input());
    const rendered = [...reportLines(findings, "2026-09-14"), JSON.stringify(reportJson(findings, "2026-09-14"))].join("\n");
    expect(rendered).not.toContain(SECRET);
    // And not a prefix of it either — a "first four characters" convenience is
    // how a key ends up in a log.
    expect(rendered).not.toContain(SECRET.slice(0, 8));
    // The NAMES are there, which is the whole point.
    expect(rendered).toContain(API_KEY_ENV);
  });

  test("the embedder knob is read literally: anything but true is amber and says why", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    const findings = doctorFindings(input({ config: { dataDir: dir, credentialsFile: credsPath } }));
    expect(by(findings, "embedder").severity).toBe("amber");
    // It says what the store CAN still do (2026-09-20, finding 1): lexical
    // recall is a working channel, not a degraded mode, and a day-1 line that
    // reads like a broken install is what sends a new user to buy a key.
    expect(by(findings, "embedder").detail).toContain("matches on words, not on meaning");
    expect(by(findings, "embedder").fix).toContain("Optional.");
  });

  test("no store at the dir is red, and the store-reading groups are not attempted", () => {
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    const findings = doctorFindings(input({ store: null }));
    expect(by(findings, "store").severity).toBe("red");
    expect(findings.find((f) => f.key === "clock")).toBeUndefined();
    expect(findings.find((f) => f.key === "vectors")).toBeUndefined();
  });

  test("a --dir that disagrees with the config's dataDir is amber, and names both", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    const findings = doctorFindings(input({ config: { dataDir: "/elsewhere/store", credentialsFile: credsPath, embedder: { enabled: true } } }));
    expect(by(findings, "store").severity).toBe("amber");
    expect(by(findings, "store").detail).toContain("/elsewhere/store");
    expect(by(findings, "store").detail).toContain(dir);
  });

  /** I32's signature, in one line: boundaries are happening and the clock is not
   *  moving, which means no worker has opened the store. */
  test("lastActiveDate older than the newest boundary is amber and states both dates", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
   * THE SNAPSHOT LINE — "if this database were wiped this afternoon, what would
   * come back". Amber, never red: a missing backup is not a broken memory, and
   * one colour for both teaches the reader to read past the one that matters.
   */
  test("the snapshot line counts what is ON DISK: last taken, how many kept, the oldest", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    const s = store();
    for (const d of ["2026-09-01", "2026-09-13", "2026-09-14"]) fakeSnapshot(`${d}T03-00-00-000Z`);
    s.appendEvent({
      name: SNAPSHOT_TAKEN_EVENT,
      day: s.livedDay(),
      payload: { date: "2026-09-14", name: "2026-09-14T03-00-00-000Z", files: 16_400, kept: 3 },
    });
    const snap = by(doctorFindings(input({ store: s })), "snapshot");
    expect(snap.severity).toBe("green");
    expect(snap.detail).toContain("last snapshot 2026-09-14");
    expect(snap.detail).toContain("3 kept");
    expect(snap.detail).toContain("oldest 2026-09-01");
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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

  test("a snapshot older than two days is amber", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    const s = store();
    fakeSnapshot("2026-09-14T03-00-00-000Z");
    const findings = doctorFindings(
      input({
        store: s,
        config: {
          dataDir: dir,
          credentialsFile: credsPath,
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    expect(by(at, "spawn").fix).toContain("credentials set");
  });

  test("the recall.credit row is reported when there is one, and its quiet reasons are green", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    const s = store();
    const findings = doctorFindings(input({ store: s }));
    expect(by(findings, "vectors").data["unembedded"]).toBe(s.unembeddedCount());
    expect(by(findings, "vectors").data["skipped"]).toBe(s.skippedVectorIds().length);
  });

  test("the journal mode is read and reported — green in wal, amber when a conversion did not take", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      const src = openDb(join(dir, "operational.sqlite"));
      try {
        src.exec(`VACUUM INTO '${join(at, "operational.sqlite")}'`);
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
      expect(journalModeOf(join(at, "operational.sqlite"))).toBe("delete");
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  });

  /** The hot path's own guarantee: what the budget cut off is a FINDING, never a
   *  silent omission. */
  test("a blown time budget stops the reading and says what it did not read", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    // The config and the credentials were answered BEFORE the clock ran out:
    // they are the two that carry I32's own signature.
    expect(by(findings, "credentials")).toBeDefined();
  });

  test("the report is worst first and the JSON carries the same order", () => {
    mintStore();
    writeConfig();
    writeFileSync(credsPath, credentialsTemplate(), { mode: 0o600 });
    // A key that WENT AWAY, so there is a red to sort to the top: a store that
    // never had one is amber now (finding 1).
    markInterpreted();
    const findings = doctorFindings(input());
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    installHostSteps();
    const host = readHost(root, root, {});
    expect(host.events).toEqual([...HOST_EVENTS].sort());
    expect(host.mcp).toBe(true);
    const finding = by(doctorFindings(input({ host })), "host");
    expect(finding.severity).toBe("green");
    expect(finding.detail).toContain(`all ${String(HOST_EVENTS.length)} hook events are installed`);
    expect(finding.detail).toContain(join(root, ".claude.json"));
  });

  test("nothing installed is AMBER — never red — and says exactly what to run", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    const host = readHost(root, root, {});
    const finding = by(doctorFindings(input({ host })), "host");
    // Amber, because this reads somebody else's files in a format that is not
    // ours to depend on: a wrong answer must cost a second look, not a panic.
    expect(finding.severity).toBe("amber");
    expect(finding.detail).toContain("no hook of ours is installed");
    expect(finding.fix).toContain("counterparts install");
    expect(finding.fix).toContain("restart");
    // And it NAMES what it looked at, so a path that has moved is visible to
    // the reader rather than reported as "you did not install it".
    expect(finding.detail).toContain("no host settings file was readable");
    expect(finding.detail).toContain(join(root, ".claude.json"));
  });

  test("a PARTIAL paste is named event by event — the case a green doctor used to hide", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    installHostSteps({ events: ["SessionStart", "Stop"] });
    const finding = by(doctorFindings(input({ host: readHost(root, root, {}) })), "host");
    expect(finding.severity).toBe("amber");
    expect(finding.detail).toContain("installed on SessionStart, Stop");
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    const findings = doctorFindings(input({ checkout: reading }));
    expect(by(findings, "checkout").severity).toBe("green");
    expect(by(findings, "checkout").detail).toContain("nothing to grade against");
  });

  test("not a repository is neutral — an installed package has nothing to grade", () => {
    const reading = readCheckout({ root: "/repo", git: fakeGit({}) });
    expect(reading.reason).toBe("not-a-repo");
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      { dataDir: dir, credentialsFile: credsPath, injectionBudgetBytes: 9000, embedder: { enabled: true }, ...over },
      {
        command: "/bin/true",
        args: ["runner"],
        spawner: () => ({ pid: 1 }),
        credentials: loadCredentials(credsPath, {}),
        configPath,
      },
    );
    open.push(a.counterpart);
    return a;
  }

  const hookInput = { sessionId: "s1", scope: "/tmp/scope", turns: [], at: "2026-09-14" };

  test("a red credentials finding produces a notice naming the fix; a healthy store produces none", () => {
    mintStore();
    writeConfig();
    writeFileSync(credsPath, credentialsTemplate(), { mode: 0o600 });
    // The notice fires for a key that WENT AWAY. On a store that never had one
    // there is nothing red and the terminal stays quiet, which is the whole of
    // finding 1: the first line the product says to a new user.
    markInterpreted();
    const sick = adapterOn();
    const notice = sick.notice(hookInput, { checkout: onMaster });
    expect(notice).not.toBe(null);
    expect(notice).toContain(API_KEY_ENV);
    expect(notice).toContain("counterparts credentials set");
    expect(notice?.endsWith("run: counterparts doctor")).toBe(true);
    // The VALUE never enters it — there is none here, so assert the shape that
    // would carry one if there were.
    expect(notice).not.toContain(SECRET);
  });

  /**
   * THE HOOK'S OWN BLINDNESS, ruled out.
   *
   * The hook hands `notice()` the load it performed against `process.env`, which
   * raises the obvious worry: a terminal that launched Claude Code with
   * `ANTHROPIC_API_KEY` exported would put the name in `skippedPresent` and the
   * notice would read green off a blank file — I32 reproduced one process along.
   * It cannot: `loadCredentials` only ever pushes a name onto `loaded` or
   * `skippedPresent` if the FILE holds a line for it, so a template file answers
   * nothing whatever the environment carries. Asserted here rather than reasoned
   * about, because the whole PR turns on it.
   */
  test("a key in the hook process's environment does NOT make a blank file read green", () => {
    mintStore();
    writeConfig();
    writeFileSync(credsPath, credentialsTemplate(), { mode: 0o600 });
    markInterpreted();
    const env: NodeJS.ProcessEnv = { [API_KEY_ENV]: SECRET, [EMBED_KEY_ENV]: SECRET };
    const load = loadCredentials(credsPath, env);
    expect(load.loaded).toEqual([]);
    expect(load.skippedPresent).toEqual([]);
    const a = openAdapter(
      { dataDir: dir, credentialsFile: credsPath, injectionBudgetBytes: 9000 },
      { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), credentials: load, configPath },
    );
    open.push(a.counterpart);
    const notice = a.notice(hookInput, { checkout: onMaster });
    expect(notice).not.toBe(null);
    expect(notice).toContain(API_KEY_ENV);
    expect(notice).not.toContain(SECRET);
  });

  test("a healthy store produces no notice at all", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    expect(adapterOn().notice(hookInput, { checkout: onMaster })).toBe(null);
  });

  test("amber never reaches the terminal: a missing embed key says nothing", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV]);
    expect(adapterOn().notice(hookInput, { checkout: onMaster })).toBe(null);
  });

  test("an observer says nothing, and writes no checkout row", () => {
    mintStore();
    writeConfig();
    writeFileSync(credsPath, credentialsTemplate(), { mode: 0o600 });
    const a = adapterOn({ observer: true });
    expect(a.notice(hookInput, { checkout: onMaster })).toBe(null);
    const s = store();
    expect(s.eventLog({ name: CHECKOUT_EVENT }).length).toBe(0);
  });

  test("a doctor reading that throws degrades to no notice PLUS a ring event", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
      key: "credentials",
      severity: "red",
      title: "Credentials",
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
    const small = noticeMessage([{ ...huge, detail: "no key", fix: "set it" }]);
    expect(small).toBe("counterparts: Credentials — no key. set it\nrun: counterparts doctor");
  });

  test("a dropped notice is recorded with the lengths that dropped it", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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

  test("user-prompt-submit NEVER emits JSON, notice or no notice", () => {
    const out = hostDelivery("user-prompt-submit", { injection: "recall", ask: null }, {}, "a notice");
    expect(out.stdout).toBe("recall");
  });

  test("Stop keeps its blocking channel untouched", () => {
    const out = hostDelivery("stop", { injection: null, ask: "write the episode" }, {}, "a notice");
    expect(out.stdout).toBe("");
    expect(out.stderr).toBe("write the episode");
    expect(out.exitCode).toBe(2);
  });
});

// ── the console ─────────────────────────────────────────────────────────────

describe("counterparts doctor", () => {
  test("prints the report and exits 1 when anything is red", async () => {
    mintStore();
    writeConfig();
    writeFileSync(credsPath, credentialsTemplate(), { mode: 0o600 });
    markInterpreted();
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
    expect(said).toContain(API_KEY_ENV);
    expect(said).toContain("counterparts credentials set");
  });

  test("exits 0 when nothing is red", async () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    expect(c.out.join("\n")).toContain("Nothing to fix.");
  });

  /**
   * THE READING THAT WOULD HAVE CAUGHT I32 ON THE OWNER'S OWN MACHINE. His
   * `~/.zshrc` exports both names; the hook processes inherit neither. A doctor
   * that counted its own shell would have read green all week.
   */
  test("the credentials come from the FILE, not from the shell that ran the console", async () => {
    mintStore();
    writeConfig();
    writeFileSync(credsPath, credentialsTemplate(), { mode: 0o600 });
    markInterpreted();
    const c = consoleWith();
    const code = await run(["doctor", `--config=${configPath}`, "--json"], {
      io: c.io,
      // The shell HAS the key. The file does not.
      env: { [API_KEY_ENV]: SECRET, [EMBED_KEY_ENV]: SECRET },
      home: root,
      checkout: onMaster,
    });
    expect(code).toBe(1);
    const json = JSON.parse(c.out.join("\n")) as { findings: { key: string; severity: string; detail: string }[] };
    const cred = json.findings.find((f) => f.key === "credentials");
    expect(cred?.severity).toBe("red");
    expect(cred?.detail).toContain("your shell exports");
    expect(c.out.join("\n")).not.toContain(SECRET);
  });

  test("--json is machine-readable, ids and counts only", async () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    const c = consoleWith();
    await run(["doctor", `--config=${configPath}`, "--json"], { io: c.io, env: {}, home: root, checkout: onMaster });
    const json = JSON.parse(c.out.join("\n")) as { date: string; red: number; findings: unknown[] };
    expect(json.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.red).toBe(0);
    expect(json.findings.length).toBeGreaterThan(5);
  });

  test("it reads the store the CONFIG names, not the one the environment does", async () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeFileSync(configPath, JSON.stringify({ credentialsFile: credsPath }));
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
    writeFileSync(defaultConfig, JSON.stringify({ dataDir: dir, credentialsFile: credsPath }));
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
   * whose `credentialsFile` points at the owner's live keys. `doctor` now
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
    writeFileSync(liveCreds, `${API_KEY_ENV}=${SECRET}\n`, { mode: 0o600 });
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
    expect(said).toContain("GREEN Store");
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
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
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    const s = store();
    const before = s.eventLog({ limit: 1000 }).length;
    s.close();
    const c = consoleWith();
    await run(["doctor", `--config=${configPath}`], { io: c.io, env: {}, home: root, checkout: onMaster });
    expect(store().eventLog({ limit: 1000 }).length).toBe(before);
  });
});

// ── credentials set ─────────────────────────────────────────────────────────

describe("counterparts credentials", () => {
  function piped(value: string): { isTty: boolean; read: () => Promise<string> } {
    return { isTty: false, read: () => Promise.resolve(value) };
  }

  async function set(
    name: string,
    value: string,
    over: { env?: Record<string, string | undefined>; argv?: string[] } = {},
  ): Promise<{ code: number; out: string[]; err: string[] }> {
    const c = consoleWith();
    const code = await run(["credentials", "set", name, `--config=${configPath}`, ...(over.argv ?? [])], {
      io: c.io,
      env: over.env ?? {},
      home: root,
      stdin: piped(value),
    });
    return { code, out: c.out, err: c.err };
  }

  test("set on a missing file creates it 0600 with exactly one line", async () => {
    writeConfig();
    expect(existsSync(credsPath)).toBe(false);
    const r = await set(API_KEY_ENV, `${SECRET}\n`);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toEqual([`set ${API_KEY_ENV} in ${credsPath}`]);
    const text = readFileSync(credsPath, "utf8");
    expect(text).toBe(`${API_KEY_ENV}=${SECRET}\n`);
    expect((statSync(credsPath).mode & 0o777).toString(8)).toBe("600");
    // And the loader reads it back as the value that went in.
    const env: NodeJS.ProcessEnv = {};
    expect(loadCredentials(credsPath, env).loaded).toEqual([API_KEY_ENV]);
    expect(env[API_KEY_ENV]).toBe(SECRET);
  });

  test("set on the template replaces the placeholder line and keeps every comment", async () => {
    writeConfig();
    writeFileSync(credsPath, credentialsTemplate(), { mode: 0o600 });
    const comments = credentialsTemplate().split("\n").filter((l) => l.startsWith("#")).length;
    const r = await set(API_KEY_ENV, SECRET);
    expect(r.code).toBe(EXIT.ok);
    const lines = readFileSync(credsPath, "utf8").split("\n");
    // The placeholder BECAME the line, in place: one active line, and every
    // other comment still there.
    expect(lines.filter((l) => l === `${API_KEY_ENV}=${SECRET}`).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("#")).length).toBe(comments - 1);
    // The OTHER name's placeholder is untouched.
    expect(lines.some((l) => l.startsWith(`# ${EMBED_KEY_ENV}=`))).toBe(true);
    expect(loadCredentials(credsPath, {}).loaded).toEqual([API_KEY_ENV]);
    // AND THE COMMENT BLOCK STILL READS AS ONE. The placeholder owns the
    // indented lines under it ("Without it the worker…"); putting the live line
    // where the placeholder stood left them dangling under a secret, as if they
    // explained it. The line goes after them instead.
    const at = lines.indexOf(`${API_KEY_ENV}=${SECRET}`);
    expect(lines[at - 1]).toMatch(/^#\s{4,}\S/);
    expect(lines[at + 1] ?? "").toStartWith(`# ${EMBED_KEY_ENV}=`);
  });

  /**
   * I32'S OWN SHAPE, made impossible. The file was EMPTY from 09-04 — the
   * worker refused `NO_CREDENTIAL` at every boundary for a week — and a
   * truncate-then-write is one crash away from producing exactly that. The
   * write goes to a sibling and is RENAMED over the target, so the file is
   * never observed empty and the secret is never on disk at 0644.
   */
  test("the target is REPLACED, never truncated: a new inode, 0600, and no temp file left", async () => {
    writeConfig();
    // The hostile starting state: an existing file, world-readable, with content
    // that must survive.
    writeFileSync(credsPath, `# keep me\n${EMBED_KEY_ENV}=keep-me\n`, { mode: 0o644 });
    const before = statSync(credsPath);
    const r = await set(API_KEY_ENV, SECRET);
    expect(r.code).toBe(EXIT.ok);
    const after = statSync(credsPath);
    // A rename, not a truncate: the path points at a different file than it did.
    expect(after.ino).not.toBe(before.ino);
    expect((after.mode & 0o777).toString(8)).toBe("600");
    expect(existsSync(`${credsPath}.tmp`)).toBe(false);
    expect(readFileSync(credsPath, "utf8")).toContain(`${EMBED_KEY_ENV}=keep-me`);
  });

  test("set on a file that already holds the name replaces that line and nothing else", async () => {
    writeConfig();
    writeFileSync(credsPath, `# mine\n${API_KEY_ENV}=old-value\n${EMBED_KEY_ENV}=keep-me\n`, { mode: 0o600 });
    await set(API_KEY_ENV, "new-value");
    expect(readFileSync(credsPath, "utf8")).toBe(`# mine\n${API_KEY_ENV}=new-value\n${EMBED_KEY_ENV}=keep-me\n`);
  });

  test("an existing file's permissions are FIXED, not inherited", async () => {
    writeConfig();
    writeFileSync(credsPath, "# nothing yet\n", { mode: 0o644 });
    await set(API_KEY_ENV, SECRET);
    expect((statSync(credsPath).mode & 0o777).toString(8)).toBe("600");
  });

  test("THE VALUE NEVER APPEARS in stdout or stderr", async () => {
    writeConfig();
    const r = await set(API_KEY_ENV, SECRET);
    const said = [...r.out, ...r.err].join("\n");
    expect(said).not.toContain(SECRET);
    expect(said).not.toContain(SECRET.slice(0, 10));
    expect(said).toContain(API_KEY_ENV);
  });

  test("a name this package does not read is refused, naming the ones it does", async () => {
    writeConfig();
    const r = await set("OPENAI_API_KEY", SECRET);
    expect(r.code).toBe(EXIT.usage);
    expect(r.err.join("\n")).toContain(API_KEY_ENV);
    expect(r.err.join("\n")).toContain(EMBED_KEY_ENV);
    expect(r.err.join("\n")).toContain("Nothing was written.");
    expect(existsSync(credsPath)).toBe(false);
  });

  test("an empty value is refused and nothing is written", async () => {
    writeConfig();
    const r = await set(API_KEY_ENV, "   \n");
    expect(r.code).toBe(EXIT.refused);
    expect(r.err.join("\n")).toContain("empty");
    expect(existsSync(credsPath)).toBe(false);
  });

  test("a value that spans two lines is refused — it would mint a second entry", async () => {
    writeConfig();
    const r = await set(API_KEY_ENV, "one\ntwo\n");
    expect(r.code).toBe(EXIT.refused);
    expect(existsSync(credsPath)).toBe(false);
  });

  test("--from-env reads the named variable, and refuses when it is not set", async () => {
    writeConfig();
    const ok = await set(API_KEY_ENV, "", { argv: ["--from-env", "MY_KEY"], env: { MY_KEY: SECRET } });
    expect(ok.code).toBe(EXIT.ok);
    expect(readFileSync(credsPath, "utf8")).toContain(`${API_KEY_ENV}=${SECRET}`);
    const missing = await set(EMBED_KEY_ENV, "", { argv: ["--from-env", "NOPE"], env: {} });
    expect(missing.code).toBe(EXIT.refused);
    expect(missing.err.join("\n")).toContain("$NOPE");
  });

  test("stdin that is a terminal is refused rather than left hanging", async () => {
    writeConfig();
    const c = consoleWith();
    const code = await run(["credentials", "set", API_KEY_ENV, `--config=${configPath}`], {
      io: c.io,
      env: {},
      home: root,
      stdin: { isTty: true, read: () => Promise.reject(new Error("never read")) },
    });
    expect(code).toBe(EXIT.usage);
    expect(c.err.join("\n")).toContain("--from-env");
  });

  test("list says which names the file holds, and never a value", async () => {
    writeConfig();
    writeCredentials([EMBED_KEY_ENV]);
    const c = consoleWith();
    const code = await run(["credentials", "list", `--config=${configPath}`], { io: c.io, env: {}, home: root });
    expect(code).toBe(EXIT.ok);
    const said = c.out.join("\n");
    expect(said).toContain(`${EMBED_KEY_ENV.padEnd(20)} present`);
    expect(said).toContain(`${API_KEY_ENV.padEnd(20)} missing`);
    expect(said).not.toContain(SECRET);
  });

  test("a subcommand that is neither is refused, and names both", async () => {
    writeConfig();
    const c = consoleWith();
    const code = await run(["credentials", "rotate", `--config=${configPath}`], { io: c.io, env: {}, home: root });
    expect(code).toBe(EXIT.usage);
    expect(c.err.join("\n")).toContain("'set <NAME>' or 'list'");
  });

  test("an observer refuses the whole command — an instrument does not hand a host a key", async () => {
    writeConfig();
    const c = consoleWith();
    const code = await run(["credentials", "set", API_KEY_ENV, `--config=${configPath}`, "--observer"], {
      io: c.io,
      env: {},
      home: root,
      stdin: piped(SECRET),
    });
    expect(code).toBe(EXIT.refused);
    expect(c.err.join("\n")).toContain("observer stance");
    expect(existsSync(credsPath)).toBe(false);
  });

  test("with the explicit-dir guard armed, a configuration nobody named is refused", async () => {
    const c = consoleWith();
    const code = await run(["credentials", "set", API_KEY_ENV], {
      io: c.io,
      env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      home: root,
      stdin: piped(SECRET),
    });
    expect(code).toBe(EXIT.refused);
    expect(existsSync(join(root, ".counterparts"))).toBe(false);
  });

  test("the credentials file's directory is created when the config names one that is not there", async () => {
    const nested = join(root, "deep", "creds.env");
    mkdirSync(join(root, "cfg"), { recursive: true });
    const cfg = join(root, "cfg", "claude-code.json");
    writeFileSync(cfg, JSON.stringify({ dataDir: dir, credentialsFile: nested }));
    const c = consoleWith();
    const code = await run(["credentials", "set", API_KEY_ENV, `--config=${cfg}`], {
      io: c.io,
      env: {},
      home: root,
      stdin: piped(SECRET),
    });
    expect(code).toBe(EXIT.ok);
    expect(readFileSync(nested, "utf8")).toBe(`${API_KEY_ENV}=${SECRET}\n`);
  });
});

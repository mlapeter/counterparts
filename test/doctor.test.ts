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
import { join } from "node:path";

import {
  BOUNDARY_EVENT,
  CHECKOUT_EVENT,
  Counterpart,
  EMBED_BACKFILL_EVENT,
  RECALL_CREDIT_EVENT,
  SLEEP_CYCLE_EVENT,
  SPAWN_REFUSED_EVENT,
  SWEEP_GATE_EVENT,
} from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import {
  API_KEY_ENV,
  EMBED_KEY_ENV,
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
import { hostDelivery } from "../src/adapters/claude-code/bin/hook.js";
import { EXIT, credentialsTemplate, run } from "../src/adapters/cli/index.js";
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

const onMaster: CheckoutReading = {
  reason: "master",
  root: "/repo",
  branch: "master",
  head: "abc1234",
  dirty: 0,
  behindBy: null,
  originMaster: "abc1234",
  atMaster: true,
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
  test("a credentials file with no key is RED, names the missing name, and names the repair", () => {
    mintStore();
    writeConfig();
    writeFileSync(credsPath, credentialsTemplate(), { mode: 0o600 });
    const findings = doctorFindings(input());
    const cred = by(findings, "credentials");
    expect(cred.severity).toBe("red");
    expect(cred.detail).toContain(API_KEY_ENV);
    expect(cred.detail).toContain("nothing is encoded");
    expect(cred.fix).toContain(`counterparts credentials set ${API_KEY_ENV}`);
    expect(anyRed(findings)).toBe(true);

    // Worst first, and the notice says the worst thing first.
    expect(findings[0]?.severity).toBe("red");
    const notice = noticeMessage(findings);
    expect(notice).not.toBe(null);
    expect(notice).toContain(API_KEY_ENV);
    expect(notice?.endsWith("run: counterparts doctor")).toBe(true);
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
    expect(by(findings, "embedder").detail).toContain("no semantic channel");
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

  test("the vector census is the one verify prints, and it is reused rather than recomputed", () => {
    mintStore();
    writeConfig();
    writeCredentials([API_KEY_ENV, EMBED_KEY_ENV]);
    const s = store();
    const findings = doctorFindings(input({ store: s }));
    expect(by(findings, "vectors").data["unembedded"]).toBe(s.unembeddedCount());
    expect(by(findings, "vectors").data["skipped"]).toBe(s.skippedVectorIds().length);
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

  test("ONE durable checkout row per session start, latched per date, head and dirtiness", () => {
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
      },
    });
    expect(a.events("adapter.checkout.unreadable").length).toBe(1);
    a.counterpart.close();
    expect(store().eventLog({ name: CHECKOUT_EVENT }).length).toBe(0);
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

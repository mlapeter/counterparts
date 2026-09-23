/**
 * `adapters/cli/` — the owner's console, against real temp stores.
 *
 * Nothing is faked but the console: `Io` collects stdout/stderr into arrays and
 * supplies a scripted answer for the confirmation prompt. Every store is real,
 * every copy is a real copy, and the removal really removes.
 *
 * Two tests here are the ones the contract cares most about, and both are
 * scars rather than features:
 *
 *   §2.11 — the canonical database is copied while a writer holds an OPEN,
 *   uncommitted transaction, and the copy is then opened and read. v1 copied a
 *   live SQLite file with no checkpoint and got away with it because the
 *   database was a declared rebuildable cache; rescope 1 removed exactly that
 *   mitigation.
 *
 *   §16 G2 — the caller-universality test over the import graph. `removal.ts`
 *   may be imported by this directory and nothing else. That test failing is
 *   the point of having it.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp data dir per test, removed
 * in `afterEach`, and `store/paths.ts` structurally refuses `~/.bansai`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { TUNABLES } from "../src/core/physics/index.js";
import { STORE_EXPORT_EVENT } from "../src/core/counterpart.js";
import {
  BRIEFING_KEY,
  PREFACE_RESERVE_BYTES,
  Self,
  byteLength,
  journalFileEpisodeId,
  journalFiles,
  journalFilesFor,
  readSentinel,
  SELF_PAGE_ROLE,
} from "../src/core/self/index.js";
import { PHASES, TUNABLES as SLEEP_TUNABLES, markerKey } from "../src/core/sleep/index.js";
import { findIdentityCore } from "../src/core/self/index.js";
// Box 3 directly, for the two things `verify`'s guard is about: seeding a
// vector the way the backfill seeds one, and counting what is still there.
import {
  convertVectorBatch,
  decodeVector,
  indexDoc,
  openCache,
  setEmbedding,
} from "../src/core/store/cache.js";
import { openDb } from "../src/core/store/db.js";
import { CONFIG_FLAG } from "../src/adapters/config-path.js";
import { EMBED_FAILED_PREFIX, EMBED_SKIP_AFTER, LAYOUT, Store, isDatabaseSidecar, paths } from "../src/core/store/index.js";
import { makeBodyUnreadable } from "./store-fixture.js";
import {
  BLOB_NAME,
  EXPORT_SCRATCH_STALE_MS,
  CONFIG_FILE,
  COMMANDS,
  COMMAND_BLURB,
  COMMAND_FLAGS,
  COMMON_FLAGS,
  CREDENTIALS_FILE,
  DASHBOARD_DEFAULT_PORT,
  commandHelp,
  EXIT,
  HOOK_SCRIPT,
  HOST_EVENTS,
  MCP_SCRIPT,
  OWNER_OPS,
  installLayout,
  layoutRefusal,
  tempRoots,
  throwawayDefaultRefusal,
  mcpCommand,
  openCounterpart,
  runCommand,
  settingsBlock,
  unknownFlag,
  assertSafeTarget,
  decryptBundle,
  run,
  snapshot,
  vacuumInto,
} from "../src/adapters/cli/index.js";
import type { DashboardSeam, Io, RunningView } from "../src/adapters/cli/index.js";
// The abort a prompt throws instead of returning an answer: `remove`'s
// interactive door has to read it as a No rather than let it out of the command.
import { PromptAborted } from "../src/adapters/cli/ui.js";
import { ownerRemoval, planRemoval, verifyRemoval } from "../src/adapters/cli/removal.js";
// The box-2 half of the destruction path. Imported HERE for the same reason
// `removal.ts` is: this is the directory allowed to reach it, and the
// caller-universality test below pins that nothing else does.
import { chaseRemoved, unarchiveMerged } from "../src/core/store/owner-op-seam.js";
// The schemas module, to build (and then read back) the thing the repair is
// about: a belief that stopped being a belief.
import { Schemas } from "../src/core/schemas/index.js";
import { applyRevision } from "../src/core/revision.js";

const ENV = "COUNTERPARTS_DATA_DIR";

let dir: string;
let outside: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-cli-"));
  outside = mkdtempSync(join(tmpdir(), "counterparts-out-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

interface Console_ {
  io: Io;
  out: string[];
  err: string[];
  asked: string[];
}

function consoleWith(answers: readonly string[] = []): Console_ {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const queue = [...answers];
  const io: Io = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ...(answers.length > 0
      ? {
          prompt: async (question: string): Promise<string> => {
            asked.push(question);
            return queue.shift() ?? "";
          },
        }
      : {}),
  };
  return { io, out, err, asked };
}

function store(opts: Parameters<typeof Store.open>[0] = {}): Store {
  const s = Store.open({ dir, ...opts });
  open.push(s);
  return s;
}

function text(lines: readonly string[]): string {
  return lines.join("\n");
}

/** Every canonical byte, so "this command wrote nothing" is checkable. */
function fingerprint(root: string): string {
  const parts: string[] = [];
  const walk = (path: string, rel: string): void => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(join(path, name), `${rel}/${name}`);
      return;
    }
    parts.push(`${rel}:${readFileSync(path).toString("base64")}`);
  };
  // The `-wal` is in the list on purpose: under WAL a commit lives in the
  // sidecar until a checkpoint moves it into the file, so hashing the database
  // file alone would pass over the write this is watching for. (The `-shm` is
  // not: it is the index every reader writes read-marks into.)
  for (const name of ["prose", "versions", "spans", "counterparts.sqlite", "counterparts.sqlite-wal"]) {
    walk(join(root, name), name);
  }
  return parts.join("|");
}

// ── status ──────────────────────────────────────────────────────────────────

describe("status", () => {
  test("reports the absence of a store rather than creating one by looking — and exits non-zero", async () => {
    const empty = join(outside, "no-store-here");
    const c = consoleWith();
    const code = await run(["status", "--dir", empty], { io: c.io });
    // NOT 0. "There is no store here" is not a census: a script that asks a
    // store what it holds and gets an answer about nothing at all has not
    // succeeded, and `set -e` around `counterparts status` sailed straight past
    // a typo'd `--dir` (cold-stranger review, 2026-09-04, #11). `usage`, not
    // `failed`: nothing broke — the line named a place with no store in it.
    expect(code).toBe(EXIT.usage);
    // On stderr, because a non-zero exit whose only output is on stdout is half
    // a refusal.
    expect(text(c.err)).toContain("No store at");
    expect(text(c.out)).toBe("");
    // And the remedy carries the dir that was actually passed: `counterparts
    // init` alone would have created the store in the DEFAULT place.
    expect(text(c.err)).toContain(`Run 'counterparts init --dir ${empty}'`);
    // The wart this avoids: an instrument that mints the thing it inspects.
    expect(existsSync(empty)).toBe(false);
  });

  test("counts the journal APART from live memories, never as one of them", async () => {
    // The bug this pins: `store.list()` returns every row and episodes are
    // rows, so a census that counts what is left after archived/superseded
    // counts the journal as memories — with a `self` kind and an `episodic`
    // band no episode earned. Two of three census surfaces (the dashboard,
    // the MCP `status` tool) already separated it; the owner's own console
    // did not.
    const brain = openCounterpart(dir);
    open.push(brain);
    brain.store.put({ type: "memory", kind: "fact", body: "One ordinary memory." });
    const written = brain.appendEpisode(
      "s1",
      "The day the console learned to tell a journal from a memory.",
    );
    expect(written.appended).toBe(true);
    brain.close();

    const c = consoleWith();
    expect(await run(["status", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("Memories: 1");
    expect(printed).toContain("Journal: 1 episode");
    // And a belief is neither: its own label, so no surface adds it into
    // "memories" and then disagrees with the wake preface (round 8).
    expect(printed).toContain("Beliefs and entities: 0");
    // And the kind/band breakdowns are over memories only.
    expect(printed).toContain("fact 1");
    expect(printed).toContain("self 0");
  });

  test("the numbers first, then the record and the list; the layout only when asked (finding 3)", async () => {
    const s = store();
    const kept = s.put({ type: "memory", kind: "person", title: "Ada", body: "Ada reads the logs first." });
    s.updatePhysics(kept, { protected: true });
    const gone = s.put({ type: "memory", kind: "fact", body: "A fact that was later removed." });
    s.appendRemovalRecord({ memoryId: gone, stage: "complete", actor: "owner" });
    s.close();

    const before = fingerprint(dir);
    const c = consoleWith();
    const code = await run(["status"], { io: c.io, env: { [ENV]: dir } });
    const printed = text(c.out);

    expect(code).toBe(EXIT.ok);
    expect(printed).toContain("Memories:");
    expect(printed).toContain("person 1");
    expect(printed).toContain(`Removed: 1`);
    expect(printed).toContain(gone);
    // §14.1 G9: everything permanent is enumerable on demand — a list, not a cadence.
    expect(printed).toContain("Permanent");
    expect(printed).toContain(kept);
    expect(printed).toContain("protected");

    // THE CENSUS COMES FIRST (2026-09-20, finding 3). This command is what
    // `install` tells a new user to check with, and the four numbers they came
    // for used to sit under a ten-line block naming `assertLayout()`, "Box 3"
    // and `adapters/expansions.ts` — none of which a reader can look up.
    const lines = printed.split("\n").filter((l) => l.trim().length > 0);
    expect(lines[0]?.startsWith("Store: ")).toBe(true);
    expect(lines[1]?.startsWith("Memories: ")).toBe(true);
    // The day's facts are one line, and the store's shape is the next.
    expect(printed).toMatch(/Today \(\d{4}-\d{2}-\d{2}\): \d+ new/);
    expect(printed).toContain("Lived day 0");
    expect(printed).toContain("Last boundary never");
    expect(printed).toContain("Self page: none yet");
    expect(printed).toContain("Journal mode: wal");
    // `Today` counts the SAME population the line above it does, or the two
    // numbers on one page disagree: two rows exist, one is removed, one is a
    // live memory born today.
    expect(printed).toContain("Today (");
    expect(printed).toContain(": 1 new");

    // AND THE LAYOUT IS NOT PRINTED unless it is asked for.
    for (const entry of LAYOUT) expect(printed).not.toContain(entry.why);
    const withLayout = consoleWith();
    expect(await run(["status", "--layout"], { io: withLayout.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    for (const entry of LAYOUT) expect(text(withLayout.out)).toContain(entry.name);

    // §5 G9: reads are pure.
    expect(fingerprint(dir)).toBe(before);
  });
});

// ── init ────────────────────────────────────────────────────────────────────

describe("init", () => {
  test("creates a store and PRINTS the hook steps rather than installing them", async () => {
    const fresh = join(outside, "fresh-store");
    const c = consoleWith();
    const code = await run(["init", "--dir", fresh], { io: c.io });
    const printed = text(c.out);

    expect(code).toBe(EXIT.ok);
    expect(existsSync(paths.operational(fresh))).toBe(true);
    // Both shapes, because both are real installs: the packaged executables
    // and the entry scripts a `git clone` runs under bun.
    expect(printed).toContain("counterparts-hook");
    expect(printed).toContain("counterparts-mcp");
    expect(printed).toContain("bin/hook.ts");
    expect(printed).toContain("bin/serve.ts");
    expect(printed).toContain("injectionBudgetBytes");
    // The claims audit's F6, in the CLI's own text: with no flag the hook reads
    // one path, and it does fall back to the environment for the store. "No flag
    // and no environment override" was printed here for a while and is not true
    // (`hook.ts#hostConfig`, `dataDir: loaded.dataDir ?? dataDir()`). Since the
    // one-config rule (2026-09-05) the same paragraph says how to name another
    // file, because "the hooks read one path" without that sentence is the
    // half-truth the flag exists to end.
    expect(printed).toContain("with no flag they read");
    expect(printed).toContain("COUNTERPARTS_DATA_DIR");
    expect(printed).toContain("--config <absolute path>");
    expect(printed).toContain("$COUNTERPARTS_CONFIG");
    expect(printed).not.toContain("no environment override");
    // And the exit rule, with its one exception, wherever the exit rule is said.
    expect(printed).not.toContain("every hook exits 0");
    expect(printed).toContain("exits 2 on purpose");
    // Printed, not written: no host configuration file was created.
    expect(existsSync(join(fresh, "claude-code.json"))).toBe(false);
  });

  test("refuses a forbidden data dir via the constructor guard, before anything is created", async () => {
    const forbidden = join(homedir(), ".bansai", "cli-test-must-not-exist");
    const c = consoleWith();
    const code = await run(["init", "--dir", forbidden], { io: c.io });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("DATA_DIR_FORBIDDEN");
    expect(existsSync(forbidden)).toBe(false);
  });

  test("with the explicit-dir guard armed, a command that names no store is REFUSED before any open, in a sentence (I21)", async () => {
    // `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` is read from THIS invocation's
    // environment (`resolveDir` → `dataDir(env)`), so the case is constructed
    // here rather than inherited from the preload — and the unarmed case can be
    // constructed the same way, below.
    const fallback = join(homedir(), ".counterparts", "store");
    const armed = { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };

    const note = consoleWith();
    expect(await run(["note", "This must not land anywhere."], { io: note.io, env: armed })).toBe(
      EXIT.refused,
    );
    const err = text(note.err);
    expect(err).toContain("refused:");
    expect(err).toContain("COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1");
    expect(err).toContain(fallback);
    expect(err).toContain("--dir");
    expect(err).toContain(ENV);
    expect(err).not.toContain("    at ");
    // Not the raw `${code} ${detail}` line: the operator armed this on purpose
    // and is owed a sentence, the way every other console refusal is one.
    expect(err).not.toContain('{"guard"');
    expect(text(note.out)).toBe("");
    // `status` would only have READ the default; it refuses the same way.
    const status = consoleWith();
    expect(await run(["status"], { io: status.io, env: armed })).toBe(EXIT.refused);
    expect(text(status.err)).toContain("COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1");
    // Nothing opened, nothing minted, nothing created — not even the parent.
    expect(existsSync(join(homedir(), ".counterparts"))).toBe(false);

    // Inherited from the process (the shape an agent shell produces): the
    // preload arms it, the fixture's COUNTERPARTS_DATA_DIR is stood down for
    // one call, and `run` with no `env` reads `process.env`.
    delete process.env[ENV];
    try {
      const inherited = consoleWith();
      expect(await run(["status"], { io: inherited.io })).toBe(EXIT.refused);
      expect(text(inherited.err)).toContain("COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1");
    } finally {
      process.env[ENV] = dir;
    }

    // Armed + `--dir`: opens. Armed + COUNTERPARTS_DATA_DIR: opens. The guard is
    // about the fallback, not about a caller who said which store they meant.
    expect(await run(["init", "--dir", dir], { io: consoleWith().io, env: armed })).toBe(EXIT.ok);
    const byFlag = consoleWith();
    expect(
      await run(["note", "The espresso machine in the kitchen is a Rancilio Silvia.", "--dir", dir], {
        io: byFlag.io,
        env: armed,
      }),
    ).toBe(EXIT.ok);
    expect(text(byFlag.out)).toContain(`Store: ${dir}`);
    const byEnv = consoleWith();
    expect(
      await run(["note", "Postgres in dev listens on port 5433, not 5432."], {
        io: byEnv.io,
        env: { ...armed, [ENV]: dir },
      }),
    ).toBe(EXIT.ok);
    expect(text(byEnv.out)).toContain(`Store: ${dir}`);

    // Unarmed: today's behaviour, byte for byte. No store is named, the
    // fallback resolves (to the temp home), and `note` says there is no store
    // there — it still creates nothing on the way.
    const unarmed = consoleWith();
    expect(await run(["note", "Nowhere to land."], { io: unarmed.io, env: {} })).toBe(EXIT.failed);
    expect(text(unarmed.err)).toContain(`no store at ${fallback}`);
    expect(existsSync(join(homedir(), ".counterparts"))).toBe(false);

    // A value the guard cannot read is REFUSED, in a sentence, rather than
    // falling to the default (the #80 review's fail-open finding): `=yes` gets
    // told the value and the two that work. Beside `--dir` it is not consulted.
    const typo = consoleWith();
    expect(await run(["status"], { io: typo.io, env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "yes" } })).toBe(
      EXIT.refused,
    );
    expect(text(typo.err)).toContain("refused:");
    expect(text(typo.err)).toContain("'yes'");
    expect(text(typo.err)).toContain("1, true, on");
    expect(text(typo.err)).not.toContain('{"guard"');
    expect(existsSync(join(homedir(), ".counterparts"))).toBe(false);
    const typoNamed = consoleWith();
    expect(
      await run(["status", "--dir", dir], { io: typoNamed.io, env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "yes" } }),
    ).toBe(EXIT.ok);
    // And `true` arms, as it does for COUNTERPARTS_OBSERVER.
    const byTrue = consoleWith();
    expect(await run(["status"], { io: byTrue.io, env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "true" } })).toBe(
      EXIT.refused,
    );
    expect(text(byTrue.err)).toContain("COUNTERPARTS_REQUIRE_EXPLICIT_DIR=true");
  });

  test("--name seeds the identity core, through the same door install uses", async () => {
    // §3 routes second and scratch stores to `init` and then says the identity
    // core has no default anywhere — so an `init` that could not seed one left
    // the documented path unable to produce the thing the page says matters.
    const named = join(outside, "named-store");
    const c = consoleWith();
    expect(await run(["init", "--dir", named, "--name", "Ada Lovelace"], { io: c.io })).toBe(
      EXIT.ok,
    );
    expect(text(c.out)).toContain("identity core seeded for Ada Lovelace");

    const brain = openCounterpart(named);
    open.push(brain);
    const coreId = findIdentityCore(brain.store);
    expect(coreId).not.toBe(null);
    expect(brain.store.readProse(coreId as string).meta["name"]).toBe("Ada Lovelace");
    brain.close();

    // ENSURE, not create: a second init with the same name mints no second core.
    const again = consoleWith();
    expect(await run(["init", "--dir", named, "--name", "Ada Lovelace"], { io: again.io })).toBe(
      EXIT.ok,
    );
    const after = openCounterpart(named);
    open.push(after);
    expect(findIdentityCore(after.store)).toBe(coreId);
    after.close();
  });

  test("install and init seed the SAME core, so the two paths make the same store", async () => {
    // §3 says both commands mean the same thing by `--name`. Until 2026-09-04
    // they did not: `init` minted the core, `install` deferred it to the first
    // hook, and a reader who followed §3 and then §7 saw a different live-row
    // count than the page had captured. One assertion, both doors.
    const viaInstall = join(outside, "same-install", "store");
    const viaInit = join(outside, "same-init");
    await run(["install", "--dir", viaInstall, "--budget", "9000", "--name", "Ada"], {
      io: consoleWith().io,
      env: {},
      home: join(outside, "home", "same"),
    });
    await run(["init", "--dir", viaInit, "--name", "Ada"], { io: consoleWith().io });

    for (const d of [viaInstall, viaInit]) {
      const brain = openCounterpart(d);
      open.push(brain);
      const core = findIdentityCore(brain.store);
      expect(core).not.toBe(null);
      expect(brain.store.readProse(core as string).meta["name"]).toBe("Ada");
      // One live row each, and it is the core — the shape §7's capture counts on.
      expect(brain.store.list({ archived: false }).length).toBe(1);
      brain.close();
    }
  });

  test("without --name it says the store has no identity core and how to seed one", async () => {
    const bare = join(outside, "bare-store");
    const c = consoleWith();
    expect(await run(["init", "--dir", bare], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("no identity core");
    expect(printed).toContain("--name");

    const brain = openCounterpart(bare);
    open.push(brain);
    expect(findIdentityCore(brain.store)).toBe(null);
    brain.close();
  });

  test("is idempotent: a second init reports the store it found", async () => {
    const fresh = join(outside, "twice");
    await run(["init", "--dir", fresh], { io: consoleWith().io });
    const c = consoleWith();
    expect(await run(["init", "--dir", fresh], { io: c.io })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("already present");
  });
});

// ── backup ──────────────────────────────────────────────────────────────────

describe("backup", () => {
  test("the canonical DB is snapshotted MID-WRITE and the copy opens and reads the committed row", () => {
    const s = store();
    const id = s.put({
      type: "memory",
      kind: "fact",
      title: "Committed",
      body: "Written inside the window that precedes the copy.",
    });

    // A writer holds an OPEN, uncommitted transaction across the copy. This is
    // the shape that tore v1's file copies: live state in a sidecar and a main
    // file that is not, on its own, the database. Under WAL (2026-09-18) the
    // sidecar is the `-wal`, and BOTH halves of the shape are asserted here
    // rather than assumed, because the `-wal` exists from the moment the store
    // opens and an uncommitted write never reaches it — so its mere presence
    // would prove nothing where the `-journal`'s did.
    const writer = openDb(paths.operational(dir));
    writer.exec("BEGIN IMMEDIATE");
    writer.run("INSERT INTO meta (key, value) VALUES (?, ?)", "uncommitted", "never-visible");
    // (a) the committed row really is in the `-wal`, so a copy of the database
    // file alone would be short — which is why the copy below is not one.
    expect(statSync(`${paths.operational(dir)}-wal`).size).toBeGreaterThan(0);
    // (b) the write transaction really is open across the copy: a connection
    // that will not wait cannot take the lock.
    const impatient = openDb(paths.operational(dir));
    impatient.exec("PRAGMA busy_timeout = 0");
    expect(() => impatient.exec("BEGIN IMMEDIATE")).toThrow();
    impatient.close();

    const target = join(outside, "snap");
    const report = snapshot(s, target);
    writer.exec("COMMIT");
    writer.close();

    const db = report.copied.find((e) => e.name === "counterparts.sqlite");
    expect(db?.method).toBe("vacuum-into");
    expect(db?.ok).toBe(true);

    // Open the copy and read a row written inside the pre-copy write window.
    const copy = openDb(join(target, "counterparts.sqlite"));
    const row = copy.get<{ id: string }>("SELECT id FROM memories WHERE id = ?", id);
    expect(row?.id).toBe(id);
    // And the uncommitted write is NOT in the copy: a consistent snapshot, not
    // a smear of whatever the file happened to hold.
    expect(copy.get("SELECT value FROM meta WHERE key = ?", "uncommitted")).toBeUndefined();
    copy.close();
  });

  test("MAJOR-5: a snapshot does NOT carry the journal's copies, and a restore REGENERATES them", () => {
    // THE FLIP, and the reason for it. `journal: backup: true` meant every
    // rotating snapshot held every episode's words as plain greppable markdown
    // — so a removal emptied the live store (proved by byte grep elsewhere) and
    // left the words in fourteen copies that any grep, Spotlight index or
    // synced folder can read. A database in an old snapshot is a file somebody
    // must know to open; a markdown file in one is a search result.
    //
    // It costs nothing to stop copying it, because the copy is DERIVED: the
    // rows are in the snapshot and the next backfill pass writes the files
    // again. Scar §2.11 does not apply — that was about losing the CANONICAL
    // journal from a backup, and this one is not canonical.
    const s = store();
    const self = new Self({ store: s, gate: () => ({ ok: true }) });
    const ids: string[] = [];
    self.openChapter("s1", { turns: 9, bytes: 6_000 });
    ids.push(self.appendChapter("s1", "ZQSNAPSHOTJOURNAL — the chapter.").episodeId as string);
    // MORE than one pass's ordinary budget, so "brings every copy back" is not
    // a vacuous claim about a store small enough not to need the cold bound.
    for (let i = 0; i < 30; i += 1) {
      ids.push(
        s.put({
          type: "episode",
          kind: "self",
          body: `## chapter 1 — lived day 0\n\nZQSNAPSHOTJOURNAL episode ${i}\n`,
          meta: { sessionId: `e${i}`, chapters: 1 },
        }),
      );
    }
    self.boundary({ budgetBytes: 4_000, day: 0 });
    self.boundary({ budgetBytes: 4_000, day: 0 });
    expect(journalFiles(dir).length).toBe(ids.length);

    const target = join(outside, "no-journal");
    expect(snapshot(s, target).ok).toBe(true);
    s.close();
    // NOT in the copy — not the directory, not one file, not one byte.
    expect(existsSync(join(target, "journal"))).toBe(false);
    for (const name of readdirSync(target)) {
      expect({
        name,
        holds: readFileSync(join(target, name)).toString("latin1").includes("ZQSNAPSHOTJOURNAL"),
      }).toEqual({ name, holds: name === "counterparts.sqlite" });
    }

    // …and the restore brings them back, at the first boundary, all of them.
    const restored = Store.open({ dir: target });
    open.push(restored);
    expect(journalFiles(target)).toEqual([]);
    new Self({ store: restored, gate: () => ({ ok: true }) }).boundary({ budgetBytes: 4_000, day: 0 });
    expect(journalFiles(target).length).toBe(ids.length);
    for (const id of ids) expect(journalFilesFor(target, id).length).toBe(1);
  });

  test("the backup set IS the layout's, and every top-level path is classified", async () => {
    const s = store();
    s.put({ type: "memory", kind: "fact", body: "Something worth keeping a copy of." });
    const backupSet = s.backupSet();
    s.close();

    const c = consoleWith();
    const code = await run(["backup", "--out", outside], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.ok);

    const snapDir = join(outside, readdirSync(outside)[0] as string);
    for (const entry of LAYOUT) {
      const present = existsSync(join(snapDir, entry.name));
      if (entry.backup && existsSync(join(dir, entry.name))) expect(present).toBe(true);
      if (!entry.backup) expect(present).toBe(false);
    }
    // The list is derived from the store's own classification, never a second
    // hand-maintained one (scar §2.11: v1's allowlist silently omitted the
    // canonical journal for three weeks).
    expect(backupSet).toEqual(LAYOUT.filter((e) => e.backup).map((e) => e.name));
    // Box 3 is excluded on purpose, and the report SAYS so rather than omitting it.
    expect(text(c.out)).toContain("cache");
    expect(existsSync(join(snapDir, "cache"))).toBe(false);
  });

  test("a destination inside the store it is copying is refused, both sides resolved first", () => {
    const s = store();
    // The v1 shape: a trailing slash and a relative segment pointing back at
    // live data. `assertSafeTarget` resolves before it compares.
    expect(() => assertSafeTarget(dir, join(dir, "backups/"))).toThrow();
    expect(() => assertSafeTarget(dir, join(dir, "..", "..", "..", "..", "..", "..", "tmp"))).not.toThrow();
    expect(() => assertSafeTarget(dir, join(homedir(), ".bansai"))).toThrow();
    const report = snapshot(s, join(dir, "inside"));
    expect(report.ok).toBe(false);
    expect(report.errors.length).toBe(1);
  });

  test("MAJOR-4 — a destination reached THROUGH A SYMLINK into the store is refused too", () => {
    // `resolve()` normalises `..` but never reads the filesystem, so a target
    // that passes through a link into the store was judged "outside" and
    // written anyway. The review put a whole export tree inside `<store>/journal/`
    // that way. The guard is shared with `backup`, so both are asserted here.
    const s = store();
    mkdirSync(join(dir, "journal"), { recursive: true });
    const link = join(outside, "lnk");
    symlinkSync(join(dir, "journal"), link);
    expect(() => assertSafeTarget(dir, join(link, "sub"))).toThrow(/inside the store/);
    const report = snapshot(s, join(link, "snap"));
    expect(report.ok).toBe(false);
    expect(String(report.errors[0])).toContain("inside the store");
    expect(readdirSync(join(dir, "journal"))).toEqual([]);
  });

  test("MAJOR-4 — a DANGLING symlink target is refused by name, not by an mkdir errno", () => {
    // A guard that holds because `mkdirSync` throws EEXIST on a dangling link
    // is not a guard, and the console printed the raw errno at the owner.
    const dangling = join(outside, "nowhere-link");
    symlinkSync(join(outside, "does-not-exist"), dangling);
    expect(() => assertSafeTarget(dir, dangling)).toThrow(/dangling symlink/);
  });

  test("MAJOR-4 — a target symlinked into ~/.bansai or ~/.claude-engram refuses under a FAKE HOME", () => {
    // The case the reviewer named as most needing a run and did not run: the
    // forbidden-root guard reads `homedir()` and resolves both sides, but a
    // symlink whose DESTINATION is inside a live v1 store is the shape that
    // slipped past `resolve()`. Both sides are realpath'd now, the roots
    // included — which on macOS matters twice over, because `$TMPDIR` is itself
    // a symlink (`/var` → `/private/var`).
    // IN A CHILD PROCESS, because `os.homedir()` under bun reads the passwd
    // entry and ignores a `HOME` set in this process (measured) — an in-process
    // fake home would have made this test pass while proving nothing.
    const fakeHome = mkdtempSync(join(tmpdir(), "counterparts-cli-home-"));
    const script = join(outside, "roots-probe.ts");
    writeFileSync(
      script,
      [
        `import { mkdirSync, symlinkSync } from "node:fs";`,
        `import { join } from "node:path";`,
        `import { assertSafeTarget } from ${JSON.stringify(resolve(import.meta.dir, "../src/adapters/cli/snapshot.ts"))};`,
        `const home = ${JSON.stringify(fakeHome)};`,
        `const store = ${JSON.stringify(dir)};`,
        `const out: string[] = [];`,
        `for (const root of [".bansai", ".claude-engram"]) {`,
        `  mkdirSync(join(home, root, "store"), { recursive: true });`,
        `  const link = join(home, "link-" + root);`,
        `  symlinkSync(join(home, root), link);`,
        `  for (const [label, path] of [["through-the-link", join(link, "store", "export")], ["plain", join(home, root, "x")]] as const) {`,
        `    try { assertSafeTarget(store, path); out.push(root + " " + label + ": ALLOWED"); }`,
        `    catch { out.push(root + " " + label + ": refused"); }`,
        `  }`,
        `}`,
        `console.log(out.join("\\n"));`,
      ].join("\n"),
      "utf8",
    );
    const probe = Bun.spawnSync([process.execPath, "run", script], {
      env: {
        ...process.env,
        HOME: fakeHome,
        // A spawned bun with a fake HOME must not write a transpiler cache into it.
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      },
    });
    const said = probe.stdout.toString().trim().split("\n").sort();
    expect(said).toEqual([
      ".bansai plain: refused",
      ".bansai through-the-link: refused",
      ".claude-engram plain: refused",
      ".claude-engram through-the-link: refused",
    ]);
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test("`backup` survives a store another process is WRITING — the live repro (§5 G8)", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", title: "Held", body: "Committed before the lock." });
    s.close();
    open.length = 0;

    // Exactly the live shape (live-verify 2026-08-25): a second process holds an
    // open write transaction on counterparts.sqlite while the owner runs a
    // backup. Before the fix the CONSTRUCTOR wrote at open, hit the lock, and
    // threw "database is locked" out of `run()` — no report, no exit code, a
    // stack trace on the owner's terminal.
    const holder = openDb(paths.operational(dir));
    holder.exec("BEGIN IMMEDIATE");
    holder.run("INSERT INTO meta (key, value) VALUES (?, ?)", "held", "1");

    const c = consoleWith();
    let code: number | undefined;
    try {
      code = await run(["backup", "--out", outside], { io: c.io, env: { [ENV]: dir } });
    } finally {
      holder.exec("COMMIT");
      holder.close();
    }

    // A report with an exit code — and, because the open no longer writes and
    // `VACUUM INTO` only needs a read, the backup actually SUCCEEDS through the
    // contention rather than merely failing politely.
    expect(code).toBe(EXIT.ok);
    expect(text(c.out)).toContain("ok  ");
    const snapDir = join(outside, readdirSync(outside)[0] as string);
    const copy = openDb(join(snapDir, "counterparts.sqlite"));
    expect(copy.get<{ id: string }>("SELECT id FROM memories WHERE id = ?", id)?.id).toBe(id);
    copy.close();
  });

  test("an open that fails is a report too, not a stack trace", async () => {
    const s = store();
    // A store a schema behind refuses to be migrated by an instrument — and the
    // backup command turns that refusal into a line and an exit code.
    s.setMeta("schemaVersion", "0");
    s.close();
    open.length = 0;

    const c = consoleWith();
    const code = await run(["backup", "--out", outside], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.failed);
    expect(text(c.out)).toContain("nothing was copied");
    expect(text(c.err)).toContain("STORE_UNINITIALIZED");
  });

  test("a backup problem is a REPORT, never a throw (§5 G8)", () => {
    const s = store();
    expect(() => snapshot(s, join(homedir(), ".bansai", "nope"))).not.toThrow();
    expect(snapshot(s, join(homedir(), ".bansai", "nope")).ok).toBe(false);
    expect(vacuumInto(join(dir, "does-not-exist.sqlite"), join(outside, "x.sqlite")).ok).toBe(false);
  });
});

// ── export ──────────────────────────────────────────────────────────────────

describe("export", () => {
  /** Every file in an export, relative to its root and sorted. Paths only. */
  function treeFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (at: string, rel: string): void => {
      for (const name of readdirSync(at).sort()) {
        const full = join(at, name);
        const next = rel === "" ? name : `${rel}/${name}`;
        if (statSync(full).isDirectory()) walk(full, next);
        else out.push(next);
      }
    };
    walk(root, "");
    return out;
  }

  test("refuses to choose for you: neither --passphrase nor --plaintext is a refusal", async () => {
    store().put({ type: "memory", kind: "fact", body: "A memory that is not leaving quietly." });
    const c = consoleWith();
    const code = await run(["export", "--out", join(outside, "e")], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("--passphrase");
    expect(existsSync(join(outside, "e", BLOB_NAME))).toBe(false);
  });

  test("--plaintext is portable: one file, and the words are in it", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", title: "Portable", body: "Readable in any editor." });
    s.close();
    const target = join(outside, "plain");
    const c = consoleWith();
    expect(await run(["export", "--out", target, "--plaintext"], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );

    // THE BUNDLE IS THE DATABASE. `prose/**.md` was half of it until the floor;
    // the words are columns now, so the one file has to carry them — which is
    // what is asserted, rather than that the file merely exists.
    const copy = openDb(join(target, "counterparts.sqlite"));
    expect(copy.get<{ body: string }>("SELECT body FROM memories WHERE id = ?", id)?.body).toContain(
      "Readable in any editor.",
    );
    copy.close();
    expect(readFileSync(join(target, "README.md"), "utf8")).toContain("UNENCRYPTED");
    // And the `VACUUM INTO` scratch did not land in the bundle — or, since
    // `tmp/` went with the floor, in the STORE, where it would fail the next
    // `assertLayout()` as an unclassified top-level path.
    expect(readdirSync(target).sort()).toEqual(["README.md", "counterparts.sqlite"]);
    Store.open({ dir, observer: true }).assertLayout();
  });

  test("an INTERRUPTED --passphrase export leaves no plaintext in the target (review B, MAJOR-4)", async () => {
    // THE SCRATCH IS A PLAINTEXT COPY OF THE WHOLE STORE. It lived in the
    // TARGET until this fix, and the target of a `--passphrase` export is by
    // definition the place the copy is going — an external disk, a synced
    // folder, the directory the owner is about to hand somebody. A kill during
    // the vacuum left a timestamped file there that nothing would ever
    // overwrite or sweep.
    const s = store();
    const secret = "ZQEXPORTSCRATCHPROBE the migraine clinic appointment";
    // BIG ENOUGH THAT THE WINDOW IS NOT A RACE. At 4,000 short bodies the
    // vacuum finished before the poll could catch it about one run in three;
    // ~60 MB of bodies makes `VACUUM INTO` take long enough that the kill lands
    // inside it every time, and the assertion below is what would catch a
    // regression back to a race.
    const bulk = "padding that makes this memory large enough to matter. ".repeat(260);
    for (let i = 0; i < 4000; i += 1) {
      s.put({ type: "memory", kind: "fact", body: `${secret} ${i} ${bulk}` });
    }
    s.close();
    const target = join(outside, "killed");
    mkdirSync(target, { recursive: true });

    const script = join(outside, "exporter.ts");
    writeFileSync(
      script,
      [
        `import { run } from ${JSON.stringify(resolve(import.meta.dir, "../src/adapters/cli/index.ts"))};`,
        `await run(["export", "--out", ${JSON.stringify(target)}, "--passphrase", "correct horse battery", "--dir", ${JSON.stringify(dir)}],`,
        `  { io: { out: () => {}, err: () => {}, prompt: async () => "" } });`,
      ].join("\n"),
      "utf8",
    );
    // POLL FOR THE SCRATCH, do not sleep at it. The first version slept 220 ms
    // and the reviewer's own probe suggested the child had usually finished the
    // vacuum and run its `finally` before the kill landed — so the test was
    // asserting a clean target for a case it never reached (review f5c, NIT-4).
    // Now the kill is landed WHILE the plaintext copy exists, which is the
    // window the finding is about.
    const child = Bun.spawn([process.execPath, "run", script], { stdout: "ignore", stderr: "ignore" });
    const scratchOf = (): string | null => {
      for (const name of readdirSync(tmpdir())) {
        if (!name.startsWith("counterparts-export-")) continue;
        const inner = join(tmpdir(), name, "scratch.sqlite");
        if (existsSync(inner) && statSync(inner).size > 0) return inner;
      }
      return null;
    };
    const deadline = Date.now() + 30_000;
    let caught: string | null = null;
    while (caught === null && Date.now() < deadline && child.exitCode === null) {
      caught = scratchOf();
      if (caught === null) await Bun.sleep(1);
    }
    child.kill("SIGKILL");
    await child.exited;
    // Non-vacuous: we really did catch it mid-vacuum with the plaintext on disk.
    expect(caught).not.toBeNull();
    // AND THIS TEST CLEANS UP AFTER ITSELF. The killed child's `finally` never
    // ran — that is the whole point — so its scratch directory is exactly the
    // leak the production sweep exists for, on a one-hour bound no suite run
    // will reach. A test removes what it creates (CLAUDE.md).
    rmSync(join(caught as string, ".."), { recursive: true, force: true });

    // NOT ONE PLAINTEXT BYTE IN THE TARGET, whatever stage it died at. Read as
    // bytes: a SQLite file is binary and a utf8 read could pull the needle
    // apart, passing for the wrong reason.
    const left = readdirSync(target);
    for (const name of left) {
      const holds = readFileSync(join(target, name)).toString("latin1").includes(secret);
      expect({ name, holdsThePlaintext: holds }).toEqual({ name, holdsThePlaintext: false });
    }
    expect(left.filter((n) => n.startsWith(".export-scratch-"))).toEqual([]);
  }, 120_000);

  test("NEW-MINOR-6: an abandoned scratch in the TEMP dir is swept, and the sweep is bounded", async () => {
    // Moving the scratch out of the target was the big win; this is the rest of
    // it. An interrupted `--passphrase` export leaves a PLAINTEXT copy of the
    // whole store in `$TMPDIR/counterparts-export-*` and nothing swept it.
    const s = store();
    const secret = "ZQTEMPSWEEPPROBE";
    s.put({ type: "memory", kind: "fact", body: `a memory holding ${secret}` });
    s.close();

    // One abandoned scratch, aged past the bound; one FRESH one, which stands
    // for a concurrent export and must survive.
    const old = mkdtempSync(join(tmpdir(), "counterparts-export-"));
    writeFileSync(join(old, "scratch.sqlite"), `a plaintext copy holding ${secret}`, "utf8");
    const aged = Date.now() - EXPORT_SCRATCH_STALE_MS - 60_000;
    utimesSync(old, aged / 1000, aged / 1000);
    const fresh = mkdtempSync(join(tmpdir(), "counterparts-export-"));
    writeFileSync(join(fresh, "scratch.sqlite"), "a live export's work", "utf8");

    try {
      const target = join(outside, "sweep");
      const c = consoleWith();
      expect(
        await run(["export", "--out", target, "--passphrase", "correct horse battery"], {
          io: c.io,
          env: { [ENV]: dir },
        }),
      ).toBe(EXIT.ok);
      // The abandoned one is gone and the report SAYS so — it is the owner's
      // plaintext, not housekeeping to do in silence.
      expect(existsSync(old)).toBe(false);
      expect(text(c.out)).toContain("abandoned scratch");
      expect(text(c.out)).toContain("unencrypted copy of the store");
      // THE BOUND: a concurrent export's directory is untouched. Without it
      // this sweep would introduce the collision the target sweep cannot have.
      expect(existsSync(join(fresh, "scratch.sqlite"))).toBe(true);
    } finally {
      rmSync(old, { recursive: true, force: true });
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test("a stale scratch from an older build is swept at the start of the next export", async () => {
    // Nothing writes that name any more; this is how the ones already on disk
    // go. The window was real: a build between the floor landing and the fix
    // wrote its scratch into the target.
    const s = store();
    const secret = "ZQSTALESCRATCHPROBE";
    s.put({ type: "memory", kind: "fact", body: `a memory holding ${secret}` });
    s.close();
    const target = join(outside, "stale");
    mkdirSync(target, { recursive: true });
    const stale = join(target, ".export-scratch-1789921802515.sqlite");
    writeFileSync(stale, `a plaintext copy holding ${secret}`, "utf8");

    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--passphrase", "correct horse battery"], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.ok);
    expect(existsSync(stale)).toBe(false);
    for (const name of readdirSync(target)) {
      const holds = readFileSync(join(target, name)).toString("latin1").includes(secret);
      expect({ name, holdsThePlaintext: holds }).toEqual({ name, holdsThePlaintext: false });
    }
  });

  test("--passphrase round-trips, and a wrong passphrase does not open it", async () => {
    const s = store();
    const secret = "The migraine clinic appointment is on the fourteenth.";
    const id = s.put({ type: "memory", kind: "person", body: secret });
    s.close();
    const target = join(outside, "sealed");
    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--passphrase", "correct horse battery"], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.ok);

    const blob = readFileSync(join(target, BLOB_NAME));
    // The ciphertext does not carry the plaintext, checked rather than assumed.
    expect(blob.toString("utf8")).not.toContain(secret);
    const opened = decryptBundle(blob, "correct horse battery");
    expect([...opened.keys()]).toEqual(["counterparts.sqlite"]);
    // The words are inside the sealed database, and come back out of it.
    expect((opened.get("counterparts.sqlite") as Buffer).toString("latin1")).toContain(secret);
    expect(() => decryptBundle(blob, "wrong passphrase")).toThrow();
  });

  // ── F7: the readable tree ─────────────────────────────────────────────────

  /** A store with one of everything the markdown tree has a place for. */
  function furnished(): { plain: string; secret: string; page: string; removed: string } {
    const s = store();
    const plain = s.put({
      type: "memory",
      kind: "fact",
      title: "Plain",
      body: "ZQPLAINROW — an ordinary memory, readable in any editor. ZQOLDWORDING.",
    });
    const secret = s.put({
      type: "memory",
      kind: "person",
      body: "ZQSECRETROW — the migraine clinic appointment.",
      meta: { confidential: true },
    });
    const removed = s.put({ type: "memory", kind: "fact", body: "ZQREMOVEDROW — gone by the time this exports." });
    const self = new Self({ store: s, gate: () => ({ ok: true }) });
    self.openChapter("s1", { turns: 9, bytes: 6_000 });
    self.appendChapter("s1", "ZQCHAPTERROW — the afternoon it worked.");
    const page = self.revisePage("ZQPAGEROW — who I am, so far.", { by: "owner", reason: "test" }).id as string;
    // A revision, so there is an earlier wording for `--with-versions`: the
    // OLD one carries `ZQOLDWORDING` and the live one does not.
    s.revise(plain, { body: "ZQPLAINROW — revised, and the first wording is gone from here." });
    // And a removal, so the tree can be asked what it does with a tombstone.
    s.appendRemovalRecord({ memoryId: removed, stage: "requested", actor: "owner", reason: "test" });
    s.appendRemovalRecord({ memoryId: removed, stage: "dark", actor: "owner", reason: "test" });
    chaseRemoved(s, removed);
    s.close();
    return { plain, secret, page, removed };
  }

  test("--markdown writes a readable tree: memories by kind, the journal as is, the page on its own", async () => {
    const { plain, page } = furnished();
    const target = join(outside, "tree");
    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--markdown", "--plaintext"], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.ok);

    // Grouped by KIND, and the FILENAME IS THE ID — never a title, which can be
    // as sensitive as a body and which a directory listing shows to anyone.
    const written = readFileSync(join(target, "memories", "fact", `${plain}.md`), "utf8");
    expect(written).toContain("ZQPLAINROW");
    expect(written).toContain("title: Plain");
    // Only `fact/`: the one `person` row here is confidential, and an omitted
    // row does not even leave its kind's directory behind as a hint.
    expect(readdirSync(join(target, "memories")).sort()).toEqual(["fact"]);
    // The self page is its own file at the top of the tree.
    expect(readFileSync(join(target, "self-page.md"), "utf8")).toContain("ZQPAGEROW");
    expect(readFileSync(join(target, "self-page.md"), "utf8")).toContain(`id: ${page}`);
    // The journal is rendered from the SAME rows and the SAME renderer as the
    // copy under `<store>/journal/`, so "as is" is kept by using its code
    // rather than by copying its files — which also means a stale copy of a
    // removed episode could never be exported.
    const journalFile = journalFiles(dir)[0] as string;
    expect(readFileSync(join(target, journalFile), "utf8")).toBe(
      readFileSync(join(dir, journalFile), "utf8"),
    );
    // Versions are behind their own flag.
    expect(existsSync(join(target, "versions"))).toBe(false);
    // …and the manifest names the flag that would have written them, spelled
    // the way the console takes it.
    expect(readFileSync(join(target, "README.md"), "utf8")).toContain("Pass `--with-versions`");
  });

  test("ARCHIVED memories are in the tree, and the manifest says how many", async () => {
    // A memory that faded, was superseded or was merged is still the owner's
    // own words. Dropping them quietly would be a copy he could not tell was
    // partial — the same failure the confidential count exists to prevent, one
    // class over. Only a REMOVED row is absent.
    const s = store();
    const faded = s.put({ type: "memory", kind: "fact", body: "ZQARCHIVEDROW — let go at the floor." });
    s.put({ type: "memory", kind: "fact", body: "ZQLIVEROW — still standing." });
    s.archive(faded, "decayed");
    s.close();
    const target = join(outside, "archived");
    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--markdown", "--plaintext"], { io: c.io, env: { [ENV]: dir } }),
    ).toBe(EXIT.ok);
    expect(readFileSync(join(target, "memories", "fact", `${faded}.md`), "utf8")).toContain(
      "ZQARCHIVEDROW",
    );
    expect(readFileSync(join(target, "README.md"), "utf8")).toContain("1 of them is ARCHIVED");
  });

  test("--markdown OMITS confidential rows, and SAYS how many — on the terminal and in the tree", async () => {
    const { secret } = furnished();
    const target = join(outside, "omitted");
    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--markdown", "--plaintext"], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.ok);
    // Ruling 4, both halves: omitted, and said.
    expect(existsSync(join(target, "memories", "person", `${secret}.md`))).toBe(false);
    expect(text(c.out)).toContain("1 confidential row was left out");
    // …and said INSIDE the artefact, because the terminal scrolls away and six
    // months later the directory is all there is.
    expect(readFileSync(join(target, "README.md"), "utf8")).toContain(
      "Confidential memories omitted: **1**",
    );
    // NOT ONE BYTE of it anywhere in the tree.
    for (const path of treeFiles(target)) {
      const holds = readFileSync(join(target, path)).toString("latin1").includes("ZQSECRETROW");
      expect({ path, holdsTheSecret: holds }).toEqual({ path, holdsTheSecret: false });
    }

    // …and the opt-in takes it, and says THAT rather than a count.
    const opened = join(outside, "opened");
    const c2 = consoleWith();
    expect(
      await run(["export", "--out", opened, "--markdown", "--plaintext", "--include-confidential"], {
        io: c2.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.ok);
    expect(readFileSync(join(opened, "memories", "person", `${secret}.md`), "utf8")).toContain(
      "ZQSECRETROW",
    );
    expect(text(c2.out)).toContain("Confidential rows are INCLUDED");
  });

  test("a REMOVED row is never exported, and --with-versions takes the earlier wordings", async () => {
    const { plain, removed } = furnished();
    const target = join(outside, "versions");
    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--markdown", "--plaintext", "--with-versions"], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.ok);
    // The tombstone has no words left and is not in the tree under any name.
    expect(existsSync(join(target, "memories", "fact", `${removed}.md`))).toBe(false);
    expect(treeFiles(target).some((p) => p.includes(removed))).toBe(false);
    for (const path of treeFiles(target)) {
      expect(readFileSync(join(target, path)).toString("latin1").includes("ZQREMOVEDROW")).toBe(false);
    }
    // The earlier wording is its own file, and it really is the OLD words.
    const priorDir = join(target, "versions", plain);
    expect(readdirSync(priorDir)).toEqual(["0001.md"]);
    expect(readFileSync(join(priorDir, "0001.md"), "utf8")).toContain("ZQOLDWORDING");
    // …and the live file is the CURRENT wording, not the old one.
    expect(readFileSync(join(target, "memories", "fact", `${plain}.md`), "utf8")).not.toContain(
      "ZQOLDWORDING",
    );
  });

  test("--markdown --passphrase is supported PROPERLY: not one plaintext byte in the target", async () => {
    // The pair is supported rather than refused, and this is the assertion that
    // earns that: the tree is rendered into memory, sealed, and only then
    // written. There is no scratch at all on this path — not in the target, not
    // in the temp dir — so review B's MAJOR-4 shape cannot arise here.
    furnished();
    const target = join(outside, "sealed-tree");
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith("counterparts-export-")).length;
    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--markdown", "--passphrase", "correct horse battery"], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.ok);
    expect(readdirSync(target).sort()).toEqual(["README.md", BLOB_NAME].sort());
    for (const name of readdirSync(target)) {
      const bytes = readFileSync(join(target, name)).toString("latin1");
      for (const mark of ["ZQPLAINROW", "ZQCHAPTERROW", "ZQPAGEROW"]) {
        expect({ name, mark, holds: bytes.includes(mark) }).toEqual({ name, mark, holds: false });
      }
    }
    // No scratch directory was made for this path at all.
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith("counterparts-export-")).length).toBe(before);
    // And it opens: the readable tree is inside the blob, file by file.
    const opened = decryptBundle(readFileSync(join(target, BLOB_NAME)), "correct horse battery");
    expect([...opened.keys()].some((k) => k.startsWith("memories/"))).toBe(true);
    expect([...opened.keys()]).toContain("README.md");
    expect([...opened.keys()].some((k) => k.startsWith("journal/"))).toBe(true);
  });

  test("MINOR-1/2: a CONFIDENTIAL page is omitted, not 'absent', and rows and versions count apart", async () => {
    const s = store();
    const self = new Self({ store: s, gate: () => ({ ok: true }) });
    const pageId = self.revisePage("ZQPAGESECRET — who I am.", { by: "owner", reason: "t" }).id as string;
    // The page exists and is confidential. The manifest used to print the "no
    // page" branch for this store, which is the one thing the manifest exists
    // to make impossible: a directory that reads as complete.
    s.revise(pageId, { body: "ZQPAGESECRET — who I am, still.", meta: { confidential: true } });
    const openRow = s.put({ type: "memory", kind: "fact", body: "An open memory, first wording." });
    s.revise(openRow, { body: "An open memory, second wording.", meta: { confidential: true } });
    // …and back to open. `revise` MERGES meta into the prior meta, so the class
    // has to be cleared by name. The LIVE row is open and one of its earlier
    // wordings is not — the shape the two counters exist for.
    s.revise(openRow, { body: "An open memory, third wording.", meta: { confidential: false } });
    expect(s.row(openRow)?.confidential).toBe(0);
    s.close();

    const target = join(outside, "counted");
    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--markdown", "--plaintext", "--with-versions"], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.ok);
    const readme = readFileSync(join(target, "README.md"), "utf8");
    expect(readme).toContain("omitted as confidential");
    expect(readme).not.toContain("this store has no written self page");
    // TWO UNITS, counted apart: one row (the page) and one earlier wording.
    expect(readme).toContain("Confidential memories omitted: **1**");
    expect(readme).toContain("earlier wording");
    expect(text(c.out)).toContain("1 confidential row");
    // Nothing of either leaked into the tree.
    for (const path of treeFiles(target)) {
      expect({
        path,
        holds: readFileSync(join(target, path)).toString("latin1").includes("ZQPAGESECRET"),
      }).toEqual({ path, holds: false });
    }
  });

  test("MINOR-3: --into-non-empty does not silently replace a file; --overwrite says which", async () => {
    furnished();
    const target = join(outside, "collide");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "README.md"), "SOMEBODY ELSE'S README — irreplaceable.", "utf8");
    writeFileSync(join(target, "keepme.txt"), "keep", "utf8");

    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--markdown", "--plaintext", "--into-non-empty"], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("README.md");
    expect(readFileSync(join(target, "README.md"), "utf8")).toContain("SOMEBODY ELSE'S README");

    const c2 = consoleWith();
    expect(
      await run(
        ["export", "--out", target, "--markdown", "--plaintext", "--into-non-empty", "--overwrite"],
        { io: c2.io, env: { [ENV]: dir } },
      ),
    ).toBe(EXIT.ok);
    expect(text(c2.out)).toContain("Replaced 1 existing file");
    expect(text(c2.out)).toContain("README.md");
    expect(readFileSync(join(target, "README.md"), "utf8")).toContain("Counterparts export");
    // Nothing else was touched.
    expect(readFileSync(join(target, "keepme.txt"), "utf8")).toBe("keep");
  });

  test("it refuses a target that is not empty, unless told", async () => {
    furnished();
    const target = join(outside, "occupied");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "somebody-elses-notes.md"), "not ours", "utf8");
    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--markdown", "--plaintext"], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("not empty");
    expect(readdirSync(target)).toEqual(["somebody-elses-notes.md"]);
    // Told, it writes.
    const c2 = consoleWith();
    expect(
      await run(["export", "--out", target, "--markdown", "--plaintext", "--into-non-empty"], {
        io: c2.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.ok);
    expect(existsSync(join(target, "README.md"))).toBe(true);
  });

  test("it refuses a target inside the store, and one inside a live v1 store, and writes nothing", async () => {
    furnished();
    const inside = join(dir, "export-here");
    const c = consoleWith();
    expect(
      await run(["export", "--out", inside, "--markdown", "--plaintext"], { io: c.io, env: { [ENV]: dir } }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("inside the store");
    expect(existsSync(inside)).toBe(false);
    // The store is still layout-clean: the refusal did not leave a directory in it.
    Store.open({ dir, observer: true }).assertLayout();

    const v1 = join(homedir(), ".bansai", "nope");
    const c2 = consoleWith();
    expect(
      await run(["export", "--out", v1, "--markdown", "--plaintext"], { io: c2.io, env: { [ENV]: dir } }),
    ).toBe(EXIT.refused);
    expect(existsSync(v1)).toBe(false);

    // MAJOR-4 end to end: the review put a whole export tree inside
    // `<store>/journal/` by pointing a link at it. Through the console, now.
    mkdirSync(join(dir, "journal"), { recursive: true });
    const link = join(outside, "export-lnk");
    symlinkSync(join(dir, "journal"), link);
    const c3 = consoleWith();
    expect(
      await run(["export", "--out", join(link, "sub"), "--markdown", "--plaintext"], {
        io: c3.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.refused);
    expect(text(c3.err)).toContain("inside the store");
    // `journal/` still holds exactly its own copies and no smuggled export.
    expect(existsSync(join(dir, "journal", "sub"))).toBe(false);
    expect(journalFiles(dir).every((f) => journalFileEpisodeId(f) !== null)).toBe(true);
  });

  test("a store this build cannot open is refused in the SAME sentence, and the target is never made", async () => {
    // F5's refusal, reached through this door: the words, not a bare code and a
    // JSON blob — and nothing is created on either side.
    const old = join(outside, "v5-store");
    mkdirSync(join(old, "prose"), { recursive: true });
    writeFileSync(join(old, "operational.sqlite"), "an older floor's database", "utf8");
    const target = join(outside, "from-the-old-one");
    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--markdown", "--plaintext"], { io: c.io, env: { [ENV]: old } }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("was written before this build's floor");
    expect(text(c.err)).toContain("NOTHING WAS TOUCHED");
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(old).sort()).toEqual(["operational.sqlite", "prose"]);
  });

  test("the flags that are about the tree refuse a database export BY NAME", async () => {
    furnished();
    const c = consoleWith();
    expect(
      await run(["export", "--out", join(outside, "no"), "--plaintext", "--include-confidential"], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("--markdown");
    expect(text(c.err)).toContain("carries every row");
    // MINOR-4: a refusal that names a flag the parser rejects is a second
    // refusal. The flag is `--with-versions`.
    expect(text(c.err)).toContain("--with-versions");
    expect(text(c.err)).not.toMatch(/(?<!-with)--versions/);
  });

  test("an export leaves a durable row — counts and flags, never the target path", async () => {
    furnished();
    const target = join(outside, "rowed");
    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--markdown", "--plaintext"], { io: c.io, env: { [ENV]: dir } }),
    ).toBe(EXIT.ok);
    const rows = store({ observer: true }).eventLog({ name: STORE_EXPORT_EVENT });
    expect(rows.length).toBe(1);
    const payload = JSON.parse((rows[0] as { payload: string | null }).payload as string) as Record<string, unknown>;
    expect(payload["kind"]).toBe("markdown");
    expect(payload["encrypted"]).toBe(false);
    expect(payload["omittedConfidential"]).toBe(1);
    expect(payload["rows"]).toBeGreaterThan(0);
    // WHERE the memories went is more than the row needs, and the terminal has
    // already said it (§5 G10). No body, no title, no path.
    const json = JSON.stringify(payload);
    expect(json).not.toContain(target);
    expect(json).not.toContain("ZQPLAINROW");
    expect(json).not.toContain("Plain");
  });

  test("an export is a READ, so it works under --observer — and writes no row, and says so", async () => {
    furnished();
    const target = join(outside, "instrument");
    const c = consoleWith();
    expect(
      await run(["export", "--out", target, "--markdown", "--plaintext", "--observer"], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.ok);
    expect(readFileSync(join(target, "README.md"), "utf8")).toContain("Counterparts export");
    expect(text(c.out)).toContain("No store.export row was written");
    expect(store({ observer: true }).eventLog({ name: STORE_EXPORT_EVENT }).length).toBe(0);
  });

  test("a refusal never echoes a memory body", async () => {
    furnished();
    const occupied = join(outside, "echo-check");
    mkdirSync(occupied, { recursive: true });
    writeFileSync(join(occupied, "x"), "x", "utf8");
    const refusals: string[] = [];
    for (const argv of [
      ["export", "--out", occupied, "--markdown", "--plaintext"],
      ["export", "--out", join(dir, "inside"), "--markdown", "--plaintext"],
      ["export", "--out", join(outside, "nochoice"), "--markdown"],
      ["export", "--out", join(outside, "nomd"), "--plaintext", "--with-versions"],
    ]) {
      const c = consoleWith();
      expect(await run(argv, { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
      refusals.push(text(c.err));
    }
    for (const said of refusals) {
      for (const mark of ["ZQPLAINROW", "ZQSECRETROW", "ZQCHAPTERROW", "ZQPAGEROW"]) {
        expect({ mark, echoed: said.includes(mark) }).toEqual({ mark, echoed: false });
      }
    }
  });
});

// ── remove ──────────────────────────────────────────────────────────────────

describe("remove — the loud removal", () => {
  test("dry run is the default: the plan prints, ids only, and nothing changes", async () => {
    const s = store();
    const secret = "A private thing that the owner decided to remove.";
    const id = s.put({ type: "memory", kind: "fact", body: secret });
    s.close();

    const before = fingerprint(dir);
    const c = consoleWith();
    const code = await run(["remove", id], { io: c.io, env: { [ENV]: dir } });
    const printed = text(c.out);

    expect(code).toBe(EXIT.ok);
    expect(printed).toContain("Dry run");
    expect(printed).toContain("chase prose");
    // The box-2 rows are a chase surface now, not a confession (BUILD-STATUS 3,
    // closed 2026-08-25): the plan names them alongside the prose, and the
    // "CANNOT chase" line — which used to name three surviving surfaces — has
    // nothing left to print. The LINE stays in the code, because a chase that
    // half-works at run time still has to say so (§16 G15).
    expect(printed).toContain("chase operational rows");
    expect(printed).not.toContain("CANNOT chase");
    // §16 G15: ids only. The contamination scan never prints what it matched.
    expect(printed).not.toContain(secret);
    expect(fingerprint(dir)).toBe(before);
    expect(Store.open({ dir, observer: true }).deniedIds()).toEqual([]);
  });

  test("--confirm without a matching typed id changes nothing", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "Still here after a fumbled confirmation." });
    s.close();
    const before = fingerprint(dir);
    const c = consoleWith(["not-the-id"]);
    const code = await run(["remove", id, "--confirm"], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("did not match");
    expect(fingerprint(dir)).toBe(before);
  });

  test("a non-interactive console refuses outright — a destructive op needs a human", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "Not removable by a pipe." });
    s.close();
    const c = consoleWith();
    expect(await run(["remove", id, "--confirm"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    expect(text(c.err)).toContain("interactive confirmation");
  });

  test("confirmed: the record is appended at every stage, the deny-list holds, the prose is gone", async () => {
    const s = store();
    const secret = "A credential-shaped regret the owner wants gone.";
    const id = s.put({ type: "memory", kind: "fact", title: "Regret", body: secret });
    s.put({ type: "memory", kind: "fact", body: "An unrelated memory that survives." });
    s.close();

    const c = consoleWith([id]);
    const code = await run(["remove", id, "--confirm", "--reason", "owner asked"], {
      io: c.io,
      env: { [ENV]: dir },
    });
    expect(code).toBe(EXIT.ok);
    expect(c.asked.length).toBe(1);

    const after = store({ observer: true });
    // The record is canonical, append-only, and carries every stage in order.
    const stages = after.removalRecord(id).map((r) => r.stage);
    expect(stages).toEqual(["requested", "dark", "chased", "complete"]);
    expect(after.removalRecord(id).every((r) => r.actor === "owner")).toBe(true);
    // No body, no content hash, anywhere in the record (§16 G9, scar §2.20).
    const recordText = JSON.stringify(after.removalRecord(id));
    expect(recordText).not.toContain(secret);
    expect(recordText).not.toContain("contentHash");

    // The deny-list holds, and the canonical prose is gone.
    expect(after.deniedIds()).toContain(id);
    const verdict = verifyRemoval(after, id);
    expect(verdict.denied).toBe(true);
    expect(verdict.bodyGone).toBe(true);
    expect(storeHolds(dir, secret)).toBe(false);
    // The survivor is untouched: removal chases one memory, not a neighbourhood.
    expect(after.list().filter((other) => other !== id).length).toBe(1);
  });

  test("the chase completes: box-2 rows die with it, and `unchased` is empty", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", title: "Doomed", body: "The doomed one." });
    const neighbour = s.put({ type: "memory", kind: "fact", body: "A neighbour it conducts to." });
    s.link({ src: id, dst: neighbour, weight: 0.8, day: 0 });
    s.link({ src: neighbour, dst: id, weight: 0.8, day: 0 });
    s.setProspective({
      memoryId: id,
      windowKey: "w1",
      eventDate: "2026-09",
      precision: "month",
      state: "armed",
    });
    s.setGateRecords([
      { sessionId: "s1", kind: "surfaced", ref: id, turn: 1, lastDay: 0 },
      { sessionId: "s1", kind: "surfaced", ref: neighbour, turn: 1, lastDay: 0 },
    ]);
    s.close();

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("unchased (dark via the deny-list, never silently dropped): nothing");

    const after = store({ observer: true });
    // §16 G14: an erased id left in the graph keeps CONDUCTING between its
    // former neighbours. Both directions are gone, not just the outbound one.
    expect(after.edgesFrom(id)).toEqual([]);
    expect(after.edgesFrom(neighbour)).toEqual([]);
    expect(after.prospectiveFor(id)).toEqual([]);
    expect(after.gateRecords("s1").map((r) => r.ref)).toEqual([neighbour]);

    const verdict = verifyRemoval(after, id);
    expect(verdict).toMatchObject({ denied: true, bodyGone: true, rowTombstoned: true, darkState: 0 });
    // The skeleton that stays is stripped of every content pointer, and of the
    // physics that would let it go on ranking, conducting or resisting.
    const skeleton = after.row(id);
    expect(skeleton).toMatchObject({
      content_hash: "",
      title: null,
      body: "",
      meta: "{}",
      confidential: 0,
      protected: 0,
      promoted_identity: 0,
      uses: 0,
      archived: 1,
      archived_reason: "removed-by-owner",
    });
    // …and the tombstone says what it WAS, in flags and counts only.
    const tombstone = after.tombstones();
    expect(tombstone.length).toBe(1);
    expect(tombstone[0]).toMatchObject({
      id,
      kind: "fact",
      stage: "complete",
      rowSurvives: true,
      chased: { versions: 0, edges: 2, prospective: 1, gateRows: 1 },
    });
    expect(JSON.stringify(tombstone)).not.toContain("Doomed");
  });

  test("a chase without a record is refused — the record comes first, always (§16 G10)", () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "Alive and not going anywhere." });
    expect(() => chaseRemoved(s, id)).toThrow(/REMOVAL_NOT_DARK/);
    expect(s.row(id)?.body).not.toBe("");
    expect(s.removalRecord().length).toBe(0);
  });

  test("an instrument cannot chase: the seam crosses the same stance check", () => {
    const w = store();
    const id = w.put({ type: "memory", kind: "fact", body: "Dark, but nobody may chase it." });
    w.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner" });
    w.close();

    const observer = store({ observer: true });
    expect(() => chaseRemoved(observer, id)).toThrow(/OBSERVER_REFUSED/);
    expect(observer.events("store.observer.standdown").at(-1)?.data?.site).toBe("chaseRemoved");
    // Nothing moved: the row is intact, words and all.
    expect(observer.row(id)?.body).not.toBe("");
    expect(observer.tombstones()).toEqual([]);
  });

  test("a removed id is skipped and COUNTED at rebuild, never quietly resurrected", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "Removed, then rebuilt around." });
    s.put({ type: "memory", kind: "fact", body: "The one that stays indexed." });
    s.close();
    await run(["remove", id, "--confirm"], { io: consoleWith([id]).io, env: { [ENV]: dir } });

    const c = consoleWith();
    expect(await run(["verify", "--rebuild", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("Skipped as removed (deny-list): 1");
    expect(printed).toContain("Re-indexed: 1");
    expect(printed).toContain("Every canonical row is accounted for.");
  });

  test("an id that is not a memory-bearing row is refused, and nothing is recorded", async () => {
    store().close();
    const c = consoleWith();
    expect(await run(["remove", "mem_notarealid", "--confirm"], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(text(c.err)).toContain("unknown-id");
    // A typo must not put an id on the deny-list on the strength of being typed.
    expect(store({ observer: true }).removalRecord().length).toBe(0);
  });

  test("the port itself refuses an invalid target before writing a single stage", () => {
    const s = store();
    expect(planRemoval(s, "mem_nope").valid).toBe(false);
    expect(() =>
      ownerRemoval(s, { targetId: "mem_nope", actor: "owner", reason: "typo", requestedAt: 0 }),
    ).toThrow();
    expect(s.removalRecord().length).toBe(0);
  });
});

// ── remove: the interactive door ────────────────────────────────────────────

/**
 * `counterparts remove` with nothing after it, at a terminal (the owner's answer
 * 7 of 2026-09-22, after the 0.2.0 trial): ask for an id or for words, find it,
 * show it, ask ONCE.
 *
 * These tests are written for the adversarial review this piece gets, so most of
 * them are about the ways a person can fail to choose: a number that is not on
 * the list, an empty answer, a No. **The assertion in every one of those is the
 * same pair** — nothing on the deny-list, and NOT ONE ROW in the removal record.
 * The record's first stage is `requested`, written before anything moves (§16
 * G10), so an empty record is the proof that the destruction path was never
 * entered rather than entered and turned back.
 *
 * The console is the one the rest of this file uses: `prompt` exists exactly
 * when answers are scripted, which is the same seam `bin/counterparts.ts` binds
 * only on a terminal — so a console with answers IS the terminal case and one
 * without IS the pipe.
 */
describe("remove — the interactive door", () => {
  const SECRET = "The culvert gate key is kept under the third fence post.";

  /** One findable memory, and one that shares none of its words. */
  function seed(): { doomed: string; other: string } {
    const s = store();
    const doomed = s.put({ type: "memory", kind: "fact", title: "The culvert gate", body: SECRET });
    const other = s.put({ type: "memory", kind: "fact", title: "Espresso", body: "Grind finer on humid mornings." });
    s.close();
    return { doomed, other };
  }

  /** Denied ids and record rows — the two facts every cancel test asserts. */
  function aftermath(): { denied: string[]; records: number } {
    const after = store({ observer: true });
    return { denied: after.deniedIds(), records: after.removalRecord().length };
  }

  /**
   * A console that reports a TERMINAL on both streams — which is what this door
   * now requires, because `isInteractive` wants the prompt, both streams and
   * `CI` unset (review B1). `consoleWith` sets no `tty`, so it is the pipe, and
   * the two can finally be told apart from a test.
   *
   * `answers` is scripted the same way, and running the queue dry returns `""` —
   * an empty answer, which every prompt here treats as "stop". A test that
   * under-supplies therefore cancels rather than silently agreeing.
   */
  function terminal(answers: readonly string[] = []): Console_ {
    const out: string[] = [];
    const err: string[] = [];
    const asked: string[] = [];
    const queue = [...answers];
    const io: Io = {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      prompt: async (question: string): Promise<string> => {
        asked.push(question);
        return queue.shift() ?? "";
      },
      tty: { stdin: true, stdout: true },
    };
    return { io, out, err, asked };
  }

  test("bare: it asks for words, numbers what it found, and one confirm removes it", async () => {
    const { doomed, other } = seed();
    const c = terminal(["culvert", "1", "y"]);

    expect(await run(["remove"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    const printed = text(c.out);

    // The three questions, in the owner's words — and only the words this
    // command owns. What `ui.ts` appends to them (the `[y/N]` tag, and whatever
    // it grows to say about Esc) is that module's sentence and its tests', not
    // a thing to pin from here.
    expect(c.asked[0]).toContain("Memory id, or words to search for:");
    expect(c.asked[1]).toContain("Which one?");
    expect(c.asked[2]).toContain("Delete this memory for good?");
    expect(c.asked.length).toBe(3);

    // The listing: number, id, kind, title, date.
    expect(printed).toContain(`1. ${doomed}  fact — The culvert gate  (`);
    expect(printed).not.toContain(other);
    // The outcome, in the words the scripted door has always used.
    expect(printed).toContain(`Removed ${doomed}.`);
    expect(printed).toContain("chased:");
    expect(printed).toContain("unchased (dark via the deny-list, never silently dropped):");
    expect(printed).toContain("left on purpose (not a failure");
    expect(printed).toContain("removal record: 4 stages appended");
    // This memory HAS a title, so the list shows the title and its body appears
    // nowhere — not in the plan, not in the report, not in the record. What an
    // UNTITLED memory shows is a different question and has its own test; the
    // review was right that this assertion alone did not answer it.
    expect(printed).not.toContain(SECRET);

    const after = store({ observer: true });
    expect(after.deniedIds()).toEqual([doomed]);
    expect(after.removalRecord(doomed).map((r) => r.stage)).toEqual([
      "requested",
      "dark",
      "chased",
      "complete",
    ]);
    expect(verifyRemoval(after, doomed).bodyGone).toBe(true);
    // The neighbour is untouched: this door picks one memory, not a subject.
    expect(after.row(other)?.body).toBe("Grind finer on humid mornings.");
  });

  test("an id TYPED at the opening question skips the search — it is the first thing asked for", async () => {
    const { doomed } = seed();
    const c = terminal([doomed, "y"]);
    expect(await run(["remove"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(c.asked.length).toBe(2);
    expect(c.asked[1]).toContain("Delete this memory for good?");
    expect(text(c.out)).not.toContain("Which one?");
    expect(aftermath().denied).toEqual([doomed]);
  });

  test("an argument that is not an id is searched for, and never taken as an id", async () => {
    const { doomed } = seed();
    const c = terminal(["1", "y"]);
    expect(await run(["remove", "culvert", "gate"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    // No opening question: the words were on the command line.
    expect(c.asked[0]).toContain("Which one?");
    expect(text(c.out)).toContain(`1. ${doomed}`);
    expect(aftermath().denied).toEqual([doomed]);
  });

  test("an id on a terminal, without --confirm: its title and date, then one confirm", async () => {
    const { doomed } = seed();
    const c = terminal(["y"]);
    expect(await run(["remove", doomed], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    // ONE question, and it is the confirm — no search, no picking.
    expect(c.asked.length).toBe(1);
    expect(c.asked[0]).toContain("Delete this memory for good?");
    expect(text(c.out)).toContain(`${doomed}  fact — The culvert gate  (`);
    expect(aftermath().denied).toEqual([doomed]);
  });

  test("No at the confirm: nothing is deleted, and nothing is recorded", async () => {
    const { doomed } = seed();
    const before = fingerprint(dir);
    const c = terminal(["culvert", "1", "n"]);
    expect(await run(["remove"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    expect(text(c.out)).toContain("Cancelled. Nothing was deleted.");
    expect(aftermath()).toEqual({ denied: [], records: 0 });
    expect(store({ observer: true }).row(doomed)?.body).toBe(SECRET);
    expect(fingerprint(dir)).toBe(before);
  });

  test("a number that is not on the list: one re-ask, then it stops", async () => {
    seed();
    const c = terminal(["culvert", "9", "12", "y"]);
    expect(await run(["remove"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    const printed = text(c.out);
    expect(printed).toContain("Answer with a number from 1 to 1, or several like 1,3.");
    expect(printed).toContain("Cancelled. Nothing was deleted.");
    // The scripted `y` was never reached: two bad answers end it, and a third
    // question would be the trap `ui.ts#confirm`'s own one-re-ask rule refuses.
    expect(c.asked.filter((q) => q.includes("Delete")).length).toBe(0);
    expect(aftermath()).toEqual({ denied: [], records: 0 });
  });

  test("a pick that is half in range is refused WHOLE — 1,9 removes nothing", async () => {
    seed();
    const c = terminal(["culvert", "1,9", "1,9"]);
    expect(await run(["remove"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    expect(text(c.out)).toContain("Cancelled. Nothing was deleted.");
    expect(aftermath()).toEqual({ denied: [], records: 0 });
  });

  test("an empty pick stops it, and so does an empty opening answer", async () => {
    seed();
    const picked = terminal(["culvert", "", ""]);
    expect(await run(["remove"], { io: picked.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    expect(text(picked.out)).toContain("Cancelled. Nothing was deleted.");

    const opened = terminal([""]);
    expect(await run(["remove"], { io: opened.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    expect(text(opened.out)).toContain("Cancelled. Nothing was deleted.");
    expect(opened.asked.length).toBe(1);

    expect(aftermath()).toEqual({ denied: [], records: 0 });
  });

  test("two picks, two removals, each one recorded in full", async () => {
    const s = store();
    const first = s.put({ type: "memory", kind: "fact", title: "Culvert one", body: "The culvert gate key, one." });
    const second = s.put({ type: "memory", kind: "fact", title: "Culvert two", body: "The culvert gate key, two." });
    const kept = s.put({ type: "memory", kind: "fact", title: "Culvert three", body: "The culvert gate key, three." });
    s.close();

    const c = terminal(["culvert gate", "1 2", "y"]);
    expect(await run(["remove"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    // The question counts the memories, and it is asked ONCE for both.
    expect(c.asked[2]).toContain("Delete these 2 memories for good?");
    expect(c.asked.filter((q) => q.includes("Delete")).length).toBe(1);

    // WHICH two, read off the screen rather than assumed: all three share the
    // same words, so the index's order between them is its own business and a
    // test that guessed it would be testing the ranking, not the picker.
    const numbered = new Map<number, string>();
    for (const line of c.out) {
      const match = /^ {2}([123])\. (mem_[0-9a-f]+) /.exec(line);
      if (match !== null) numbered.set(Number(match[1]), match[2] as string);
    }
    expect(numbered.size).toBe(3);
    const gone = [numbered.get(1) as string, numbered.get(2) as string];
    const survivor = numbered.get(3) as string;
    expect([first, second, kept].sort()).toEqual([...gone, survivor].sort());

    const after = store({ observer: true });
    expect(after.deniedIds().sort()).toEqual([...gone].sort());
    for (const id of gone) {
      expect(after.removalRecord(id).map((r) => r.stage)).toEqual([
        "requested",
        "dark",
        "chased",
        "complete",
      ]);
      expect(text(c.out)).toContain(`Removed ${id}.`);
    }
    // The one nobody picked is whole — words, record and all.
    expect(after.removalRecord(survivor).length).toBe(0);
    expect(after.row(survivor)?.body).toContain("The culvert gate key");
  });

  test("a chapter in the list is marked [journal], the way recall marks one", async () => {
    const s = store();
    const chapter = s.put({
      type: "episode",
      kind: "fact",
      title: "The day of the culvert",
      body: "We spent the afternoon at the culvert gate.",
    });
    s.close();

    const c = terminal(["culvert", "1", "n"]);
    expect(await run(["remove"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    // THE JOURNAL SAYS SO (owner ruling 2026-09-04, §I14): a chapter is never
    // presented as a memory, and this list is a place somebody decides from.
    expect(text(c.out)).toContain(`1. ${chapter}  [journal] fact — The day of the culvert  (`);
    expect(aftermath()).toEqual({ denied: [], records: 0 });
  });

  test("a search that matches nothing says so, by the words that were typed", async () => {
    seed();
    const c = terminal(["pelican"]);
    expect(await run(["remove"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    const printed = text(c.out);
    expect(printed).toContain("Nothing matched");
    expect(printed).toContain("pelican");
    expect(printed).toContain("Cancelled. Nothing was deleted.");
    // It asked once and stopped: there is nothing to pick from.
    expect(c.asked.length).toBe(1);
    expect(aftermath()).toEqual({ denied: [], records: 0 });
  });

  test("an id that does not exist is refused as an id, never searched for", async () => {
    seed();
    const c = terminal(["y"]);
    expect(await run(["remove", "mem_notarealid"], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(text(c.err)).toContain("refused: unknown-id (mem_notarealid)");
    expect(text(c.out)).toContain("Cancelled. Nothing was deleted.");
    // Nothing was asked: an id-shaped string is an id, and a wrong one is wrong.
    expect(c.asked.length).toBe(0);
    expect(aftermath()).toEqual({ denied: [], records: 0 });
  });

  test("the self page is refused by name, and the picker never offers it", async () => {
    const s = store();
    const page = s.put({
      type: "schema",
      kind: "self",
      title: "The culvert page",
      body: "A page about the culvert gate.",
      meta: { role: SELF_PAGE_ROLE },
    });
    s.close();

    // Named outright: the sentence that sends him one door along.
    const named = terminal(["y"]);
    expect(await run(["remove", page], { io: named.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    expect(text(named.err)).toContain("self-page --clear");

    // AND IT IS SKIPPED, which is a different claim from "nothing matched" —
    // the review's finding was that an empty list proves nothing about the skip,
    // since a page that was never indexed looks the same. A findable memory
    // beside it makes the list non-empty, so the page's ABSENCE from it is the
    // assertion.
    const s2 = store();
    const ordinary = s2.put({
      type: "memory",
      kind: "fact",
      title: "The culvert gate",
      body: "A memory about the culvert gate.",
    });
    s2.close();
    const searched = terminal(["culvert", "n"]);
    expect(await run(["remove"], { io: searched.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    const listed = text(searched.out);
    expect(listed).toContain(`1. ${ordinary}`);
    expect(listed).not.toContain(page);
    expect(listed).not.toContain("The culvert page");
    expect(aftermath()).toEqual({ denied: [], records: 0 });
  });

  test("an already-removed memory is never offered a second time", async () => {
    const { doomed } = seed();
    const s = store();
    const survivor = s.put({ type: "memory", kind: "fact", title: "Culvert notes", body: "More about the culvert gate." });
    s.close();
    await run(["remove", doomed, "--confirm"], { io: terminal([doomed]).io, env: { [ENV]: dir } });

    const c = terminal(["culvert", "1", "n"]);
    expect(await run(["remove"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    const printed = text(c.out);
    expect(printed).toContain(`1. ${survivor}`);
    expect(printed).not.toContain(`${doomed}  fact`);
  });

  test("--confirm is untouched: the old typed-id question, and only that one", async () => {
    const { doomed } = seed();
    // A console WITH a prompt — so the new door was available and not taken.
    const c = terminal([doomed]);
    expect(await run(["remove", doomed, "--confirm"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(c.asked).toEqual([`Type the id to remove it permanently [${doomed}]: `]);
    const printed = text(c.out);
    // The plan still prints, above the confirmation, exactly as it did.
    expect(printed).toContain(`Removal plan for ${doomed}:`);
    expect(printed).toContain("chase prose");
    expect(printed).toContain("other memories whose text overlaps (ids only): 0");
    expect(printed).not.toContain("Delete this memory for good?");
    expect(aftermath().denied).toEqual([doomed]);
  });

  test("no prompt at all: still a dry run, and bare it still asks for an id", async () => {
    const { doomed } = seed();
    const before = fingerprint(dir);

    const dry = consoleWith();
    expect(await run(["remove", doomed], { io: dry.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(dry.out)).toContain("Dry run. Nothing has changed. Re-run with --confirm to remove.");

    const bare = consoleWith();
    expect(await run(["remove"], { io: bare.io, env: { [ENV]: dir } })).toBe(EXIT.usage);
    expect(text(bare.err)).toContain("remove needs a memory id");

    expect(fingerprint(dir)).toBe(before);
    expect(aftermath()).toEqual({ denied: [], records: 0 });
  });

  /**
   * THE BLOCKER THE ADVERSARIAL REVIEW FOUND (B1), in three shapes.
   *
   * The door used to open on stdin alone, so `counterparts remove <id> > log`
   * wrote the question into the log and deleted the memory on a `y` the person
   * was typing at a terminal that showed them nothing — and a CI job with a pty
   * got a live delete where it had always got a dry run. The door is
   * `isInteractive` now: prompt, BOTH streams, and `CI` unset.
   */
  describe("a console that only looks interactive gets the dry run", () => {
    const shapes: { name: string; io: (c: Console_) => Io; env?: Record<string, string> }[] = [
      {
        name: "CI is set, both streams are terminals",
        io: (c) => c.io,
        env: { CI: "true" },
      },
      {
        name: "stdout is redirected — the question would land in the file",
        io: (c) => ({ ...c.io, tty: { stdin: true, stdout: false } }),
      },
      {
        name: "stdin is a pipe",
        io: (c) => ({ ...c.io, tty: { stdin: false, stdout: true } }),
      },
    ];
    for (const shape of shapes) {
      test(shape.name, async () => {
        const { doomed } = seed();
        const before = fingerprint(dir);
        // A console that WOULD say yes to anything, so the only thing stopping
        // the removal is the door.
        const c = terminal(["y", "y", "y"]);
        const code = await run(["remove", doomed], {
          io: shape.io(c),
          env: { [ENV]: dir, ...(shape.env ?? {}) },
        });
        expect(code).toBe(EXIT.ok);
        expect(text(c.out)).toContain("Dry run. Nothing has changed. Re-run with --confirm to remove.");
        expect(c.asked).toEqual([]);
        expect(fingerprint(dir)).toBe(before);
        expect(aftermath()).toEqual({ denied: [], records: 0 });
      });
    }
  });

  test("Esc at either question reads as No — the abort is caught, not crashed on", async () => {
    const { doomed } = seed();
    // `ui.ts#ask` throws `PromptAborted` on the cancel sentinel rather than
    // returning a line. This console throws the same error by name, at the Nth
    // question, so both the opening question and the CONFIRM are covered — the
    // review's finding was that only the first one was.
    const abortAt = async (n: number, answers: readonly string[]): Promise<string[]> => {
      const out: string[] = [];
      const queue = [...answers];
      let asked = 0;
      const io: Io = {
        out: (line) => out.push(line),
        err: () => {},
        prompt: async (): Promise<string> => {
          asked += 1;
          if (asked === n) throw new PromptAborted("cancelled", "cancelled.");
          return queue.shift() ?? "";
        },
        tty: { stdin: true, stdout: true },
      };
      expect(await run(["remove"], { io, env: { [ENV]: dir } })).toBe(EXIT.refused);
      return out;
    };

    expect(text(await abortAt(1, []))).toContain("Cancelled. Nothing was deleted.");
    // The third question is the confirm: words, pick, then the yes/no.
    expect(text(await abortAt(3, ["culvert", "1"]))).toContain("Cancelled. Nothing was deleted.");
    expect(aftermath()).toEqual({ denied: [], records: 0 });
    expect(store({ observer: true }).row(doomed)?.body).toBe(SECRET);
  });

  test("a memory removed under the confirm: named, not removed, and the rest still go", async () => {
    const s = store();
    const first = s.put({ type: "memory", kind: "fact", title: "Culvert one", body: "The culvert gate, one." });
    const second = s.put({ type: "memory", kind: "fact", title: "Culvert two", body: "The culvert gate, two." });
    s.close();

    // THE RACE, as a seam rather than a second process: the console's own answer
    // to the confirm removes one of the picks first. Everything this door holds
    // open is closed by then (scar E5), so the nested run is exactly what
    // another session would be.
    let racedId: string | null = null;
    const out: string[] = [];
    const err: string[] = [];
    const queue = ["culvert gate", "1 2"];
    const io: Io = {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      prompt: async (question: string): Promise<string> => {
        if (!question.startsWith("Delete")) return queue.shift() ?? "";
        // Whichever the picker numbered 1 — read off the screen, like the
        // two-pick test, because the ranking between equals is its own business.
        const listed = out.map((line) => /^ {2}1\. (mem_[0-9a-f]+) /.exec(line)).find((m) => m !== null);
        racedId = (listed as RegExpExecArray)[1] as string;
        await run(["remove", racedId, "--confirm"], {
          io: consoleWith([racedId]).io,
          env: { [ENV]: dir },
        });
        return "y";
      },
      tty: { stdin: true, stdout: true },
    };

    // ONE refused, one removed → `refused`, the code the scripted door uses for
    // the same condition (review m2), never `failed`.
    expect(await run(["remove"], { io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    const raced = racedId as unknown as string;
    const survivor = raced === first ? second : first;

    // THE SENTENCE THE REVIEW FOUND (M1): it names the id, and it does not say
    // "Nothing has changed" over a removal that is about to happen two lines
    // down.
    expect(text(err)).toContain(`refused after re-plan: already-removed (${raced}). That memory is untouched.`);
    expect(text(err)).not.toContain("Nothing has changed.");
    expect(text(out)).toContain(`Removed ${survivor}.`);
    // …and the tail is the only line that claims anything about all of it.
    expect(text(out)).toContain("1 of 2 removed. The 1 not removed is untouched, and named above.");

    const after = store({ observer: true });
    expect(after.deniedIds().sort()).toEqual([first, second].sort());
    // The raced one has ONE record — the nested run's — not two.
    expect(after.removalRecord(raced).length).toBe(4);
  });

  test("an untitled confidential memory shows no words at all", async () => {
    const s = store();
    const secret = s.put({
      type: "memory",
      kind: "fact",
      body: "PASSWORD hunter2 for the culvert gate control panel.",
      meta: { confidential: true },
    });
    const plain = s.put({ type: "memory", kind: "fact", body: "The culvert gate sticks in October." });
    s.close();

    const c = terminal(["culvert", "1,2", "n"]);
    expect(await run(["remove"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    const printed = text(c.out);
    // `export` omits confidential memories by default even for the owner; this
    // list may not be the one surface that prints one unmarked (review m1).
    expect(printed).toContain(`${secret}  [confidential] fact — (untitled)  (`);
    expect(printed).not.toContain("hunter2");
    expect(printed).not.toContain("PASSWORD");
    // An ORDINARY untitled memory still shows its first line — that is what the
    // person searched for and how they tell the numbers apart.
    expect(printed).toContain(`${plain}  fact — The culvert gate sticks in October.  (`);
    expect(aftermath()).toEqual({ denied: [], records: 0 });
  });

  test("several ids on the command line are several ids, not a sentence", async () => {
    const s = store();
    const one = s.put({ type: "memory", kind: "fact", title: "One", body: "The first." });
    const two = s.put({ type: "memory", kind: "fact", title: "Two", body: "The second." });
    s.close();

    const c = terminal(["y"]);
    expect(await run(["remove", one, two], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    // No search, no picking: two ids were named, so two memories are confirmed.
    expect(c.asked.length).toBe(1);
    expect(c.asked[0]).toContain("Delete these 2 memories for good?");
    expect(store({ observer: true }).deniedIds().sort()).toEqual([one, two].sort());
  });

  test("a trailing space on an id is trimmed by BOTH doors", async () => {
    const { doomed } = seed();
    const scripted = consoleWith([doomed]);
    expect(
      await run(["remove", `${doomed} `, "--confirm"], { io: scripted.io, env: { [ENV]: dir } }),
    ).toBe(EXIT.ok);
    expect(text(scripted.err)).not.toContain("unknown-id");
    expect(aftermath().denied).toEqual([doomed]);
  });

  test("an uppercase id is not an id: nothing is looked up under a name it does not have", async () => {
    const { doomed } = seed();
    const c = terminal([]);
    // Case-sensitive on purpose (review n1): lowercasing it before the lookup
    // would let one typed string become a different row's id, on the one
    // command that cannot take that back.
    expect(await run(["remove", doomed.toUpperCase()], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(text(c.out)).toContain("Nothing matched");
    expect(aftermath()).toEqual({ denied: [], records: 0 });
  });

  test("the plan is on the screen before the yes — surfaces, spans and the overlap count", async () => {
    const { doomed } = seed();
    // ONE transcript, questions and output in the order they happened, because
    // the claim here is about ORDER: the plan has to be readable before the
    // question, not merely somewhere in the scrollback.
    const transcript: string[] = [];
    const answers = [doomed, "n"];
    const io: Io = {
      out: (line) => transcript.push(line),
      err: (line) => transcript.push(`ERR ${line}`),
      prompt: async (question: string): Promise<string> => {
        transcript.push(`ASKED ${question}`);
        return answers.shift() ?? "";
      },
      tty: { stdin: true, stdout: true },
    };
    expect(await run(["remove"], { io, env: { [ENV]: dir } })).toBe(EXIT.refused);

    const printed = text(transcript);
    // The same block the scripted door prints (review M3): the person at the
    // terminal is the less expert caller and was getting strictly less before
    // the irreversible yes.
    expect(printed).toContain(`Removal plan for ${doomed}:`);
    expect(printed).toContain("chase prose: 1");
    expect(printed).toContain("chase operational rows: 1");
    expect(printed).toContain("spans: not applicable");
    expect(printed).toContain("other memories whose text overlaps (ids only): 0");
    const plannedAt = transcript.findIndex((line) => line.startsWith("Removal plan for"));
    const confirmedAt = transcript.findIndex((line) => line.startsWith("ASKED Delete"));
    expect(plannedAt).toBeGreaterThan(-1);
    expect(confirmedAt).toBeGreaterThan(plannedAt);
    expect(aftermath()).toEqual({ denied: [], records: 0 });
  });
});

/**
 * THE SCRIPTED DOOR'S EXACT OUTPUT, as a golden (review's §"what the tests do
 * not prove", 6). The interactive door was allowed in on the promise that this
 * one did not move; three `toContain`s could not have caught a reword, and a
 * script reading these lines is a caller nobody can ask about one.
 *
 * Ids and dates are the only things normalized. Everything else is byte for
 * byte what `counterparts remove` printed before this door existed.
 */
describe("remove — the scripted door, byte for byte", () => {
  /** Ids and dates out, so the golden is about the sentences. */
  function normalize(lines: readonly string[], id: string): string[] {
    return lines.map((line) =>
      line
        .replaceAll(id, "<ID>")
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<DATE>")
        .replace(/mem_[0-9a-f]+/g, "<OTHER>"),
    );
  }

  test("the dry run, the confirmation, the refusals", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", title: "Regret", body: "A thing to forget." });
    s.close();

    const dry = consoleWith();
    expect(await run(["remove", id], { io: dry.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(normalize(dry.out, id)).toEqual([
      "Removal plan for <ID>:",
      "  chase prose: 1",
      "  chase versions: 0",
      "  chase edges: 0",
      "  chase prospective: 0",
      "  chase operational rows: 1",
      "  chase cache: 1",
      "  chase journal: 0",
      "  chase spans: 0",
      "  spans: not applicable — there is no capture buffer at spans/ for this memory, so nothing of it rode one.",
      "  other memories whose text overlaps (ids only): 0",
      "",
      "Dry run. Nothing has changed. Re-run with --confirm to remove.",
    ]);
    expect(dry.err).toEqual([]);

    const noId = consoleWith();
    expect(await run(["remove"], { io: noId.io, env: { [ENV]: dir } })).toBe(EXIT.usage);
    expect(noId.err).toEqual(["remove needs a memory id"]);
    expect(noId.out).toEqual([]);

    const badId = consoleWith();
    expect(await run(["remove", "mem_notarealid"], { io: badId.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(badId.err).toEqual(["refused: unknown-id (mem_notarealid)"]);
    expect(badId.out).toEqual([]);

    const noPrompt = consoleWith();
    expect(await run(["remove", id, "--confirm"], { io: noPrompt.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(noPrompt.err).toEqual([
      "refused: removal requires an interactive confirmation and this console has no prompt.",
    ]);

    const mismatch = consoleWith(["not-the-id"]);
    expect(await run(["remove", id, "--confirm"], { io: mismatch.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(mismatch.err).toEqual(["refused: the confirmation did not match. Nothing has changed."]);

    // And the whole thing through: the plan, the question, the report.
    const done = consoleWith([id]);
    expect(await run(["remove", id, "--confirm"], { io: done.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(done.asked).toEqual([`Type the id to remove it permanently [${id}]: `]);
    expect(normalize(done.out, id)).toEqual([
      "Removal plan for <ID>:",
      "  chase prose: 1",
      "  chase versions: 0",
      "  chase edges: 0",
      "  chase prospective: 0",
      "  chase operational rows: 1",
      "  chase cache: 1",
      "  chase journal: 0",
      "  chase spans: 0",
      "  spans: not applicable — there is no capture buffer at spans/ for this memory, so nothing of it rode one.",
      "  other memories whose text overlaps (ids only): 0",
      '  cli.removal.stage {"stage":"requested","target":"<ID>"}',
      '  cli.removal.stage {"stage":"dark","target":"<ID>"}',
      '  cli.removal.stage {"stage":"chased","target":"<ID>"}',
      '  cli.removal.stage {"stage":"complete","target":"<ID>"}',
      '  cli.removal.complete {"target":"<ID>","chased":9,"unchased":0,"contamination":0}',
      "",
      "Removed <ID>.",
      "  chased: operational.edges(0), operational.prospective(0), operational.gate_session(0), operational.memories(1, tombstoned), operational.versions(0, tombstoned), journal(0, nothing beside the row), cache, write-ahead log and freed pages, cache write-ahead log and freed pages",
      "  unchased (dark via the deny-list, never silently dropped): nothing",
      "  left on purpose (not a failure — this removal was never entitled to it): nothing",
      "  removal record: 4 stages appended",
    ]);
    expect(done.err).toEqual([]);
  });
});

// ── removal residue: the span buffer ────────────────────────────────────────

/**
 * LAUNCH-STATUS §I2, and the owner's ruling on it (option A): a note is CAPTURED
 * into `spans/<scope>/jots.jsonl` before it is minted, nothing prunes that file,
 * and `remove` used to report `unchased: nothing` while the words were still on
 * disk — a backup taken afterwards copied them. The chase is core work; saying
 * so is this console's.
 *
 * The probe is §I2's own: a marker string, and a grep of the store afterwards,
 * so the test asserts the RESIDUE as well as the report about it.
 */
describe("remove — the span buffer is CHASED, and what it cannot reach it names", () => {
  const MARKER = "ZQRESIDUEPROBE the culvert gate key is kept under the third fence post.";

  /**
   * Store-relative paths of every file holding `needle`. Ids and paths, no text.
   *
   * Read as BYTES, not as UTF-8 text: since the floor the memory's words live
   * inside `counterparts.sqlite` and its `-wal`, and a `readFileSync(_, "utf8")`
   * over a binary file replaces invalid sequences and can pull a needle apart.
   * `latin1` is byte-for-byte, so a needle that is in the file is found.
   */
  function grepStore(root: string, needle: string): string[] {
    const hits: string[] = [];
    const walk = (at: string, rel: string): void => {
      for (const name of readdirSync(at).sort()) {
        const full = join(at, name);
        const next = rel === "" ? name : `${rel}/${name}`;
        if (statSync(full).isDirectory()) walk(full, next);
        else if (readFileSync(full).toString("latin1").includes(needle)) hits.push(next);
      }
    };
    walk(root, "");
    return hits;
  }

  /** True while the memory's own words are anywhere under the store — the
   *  database, its sidecars, or the span buffer. `prose/` is gone. */
  function canonicalHolds(root: string, needle: string): boolean {
    return grepStore(root, needle).some((p) => !p.startsWith("spans/"));
  }

  function idFrom(lines: readonly string[]): string {
    const line = lines.find((l) => l.includes("Remembered mem_")) ?? "";
    return /mem_[0-9a-f]+/.exec(line)?.[0] ?? "";
  }

  /**
   * The MCP `note` tool's own two steps (`adapters/mcp/server.ts:337-362`), which
   * is exactly what `counterparts note` runs: `captureJot` FIRST — the verbatim
   * text into `spans/<key>/jots.jsonl` — then `submitJot` carrying that span's
   * hash as `ownSpanHash`. This is the door that made the residue.
   */
  async function noteThroughTheJotDoor(text: string): Promise<string> {
    const w = consoleWith();
    expect(await run(["note", text, "--dir", dir], { io: w.io })).toBe(EXIT.ok);
    return idFrom(w.out);
  }

  test("the words a note rode in on are struck out of the buffer, and a later backup has none of them", async () => {
    store().close();
    const id = await noteThroughTheJotDoor(MARKER);
    expect(id).toMatch(/^mem_/);
    // The residue itself, before anything is removed: the prose AND the buffer.
    const seeded = grepStore(dir, "ZQRESIDUEPROBE");
    expect(seeded.some((p) => p.startsWith("spans/") && p.endsWith("jots.jsonl"))).toBe(true);
    // The canonical copy is IN THE DATABASE now, not a file under `prose/`.
    expect(canonicalHolds(dir, "ZQRESIDUEPROBE")).toBe(true);

    // The DRY RUN counts it as a surface to chase, and says so above the closing
    // line — a disclosure under "Nothing has changed" is one the reader has
    // already stopped reading.
    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    const planned = text(plan.out);
    expect(planned).toContain("chase spans: 1");
    expect(planned).toContain("chased — spans/");
    expect(planned).toContain("the removal strikes them out of it");
    expect(planned.indexOf("chased — spans/")).toBeLessThan(
      planned.indexOf("Dry run. Nothing has changed."),
    );
    // §16 G15 still holds: the report names a file, never a word of its contents.
    expect(planned).not.toContain("culvert gate key");
    // A dry run strikes nothing.
    expect(grepStore(dir, "ZQRESIDUEPROBE").some((p) => p.startsWith("spans/"))).toBe(true);

    // THE REAL REMOVAL. The buffer is in `chased` with a count, `unchased` is
    // empty, and the completion event says so.
    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("spans(1 line in 1 file)");
    expect(printed).toContain("consumed.jsonl so nothing re-captures the words");
    expect(printed).toContain("unchased (dark via the deny-list, never silently dropped): nothing");
    expect(printed).toContain('"unchased":0');
    expect(printed).not.toContain("culvert gate key");

    // AND THE REPORT IS TRUE. This is LAUNCH-STATUS §I2's own grep, and the
    // whole point of the workstream: nothing under the data dir answers.
    expect(grepStore(dir, "ZQRESIDUEPROBE")).toEqual([]);

    // The blast radius the finding measured: a snapshot taken AFTER the removal
    // used to carry the words. It does not now.
    const out = join(outside, "after-removal");
    const b = consoleWith();
    expect(await run(["backup", "--dir", dir, "--out", out], { io: b.io })).toBe(EXIT.ok);
    expect(grepStore(out, "ZQRESIDUEPROBE")).toEqual([]);
  });

  test("the durable strike record carries counts and no content, and the hash is kept so nothing re-captures it", async () => {
    store().close();
    const id = await noteThroughTheJotDoor(MARKER);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: consoleWith([id]).io })).toBe(
      EXIT.ok,
    );

    const scopes = readdirSync(join(dir, "spans")).filter((n) => /^[0-9a-f]{12}$/.test(n));
    expect(scopes.length).toBe(1);
    const scopeDir = join(dir, "spans", scopes[0] as string);

    const strikes = readFileSync(join(scopeDir, "strikes.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(strikes.length).toBe(1);
    expect(strikes[0]?.["struck"]).toBe(1);
    expect(strikes[0]?.["by"]).toBe("owner");
    // §16 G9: a record of a destruction carries no hash of what it destroyed.
    expect(Object.keys(strikes[0] ?? {}).sort()).toEqual(
      ["at", "by", "day", "files", "ledgered", "struck"],
    );

    // The terminal ledger holds the hash, which is what stops the words being
    // re-admitted by a re-capture, a restore, or a crashed run's orphan merge.
    const consumed = readFileSync(join(scopeDir, "consumed.jsonl"), "utf8");
    expect(consumed.trim().length).toBeGreaterThan(0);
    expect(consumed).not.toContain("culvert gate key");
  });

  test("a note taken TWICE loses only the removed one — the strike is not a truncation", async () => {
    store().close();
    const keeper = "ZQKEEPER the north gate is padlocked and the key hangs in the tack room.";
    const doomedId = await noteThroughTheJotDoor(MARKER);
    await noteThroughTheJotDoor(keeper);

    expect(
      await run(["remove", doomedId, "--confirm", "--dir", dir], { io: consoleWith([doomedId]).io }),
    ).toBe(EXIT.ok);

    // NOT ONE BYTE ANYWHERE UNDER THE STORE, database and `-wal` included.
    //
    // This is the assertion the floor could most easily have weakened without
    // anyone noticing. An `UPDATE ... SET body = ''` in WAL mode leaves the page
    // holding the old text in `counterparts.sqlite-wal` until a checkpoint moves
    // it — measured on this branch, and why the removal now chases the
    // write-ahead log as a surface of its own (`cli/removal.ts`).
    expect(grepStore(dir, "ZQRESIDUEPROBE")).toEqual([]);
    // The other note's capture is untouched: in the buffer AND in the database.
    const kept = grepStore(dir, "ZQKEEPER");
    expect(kept.some((p) => p.startsWith("spans/") && p.endsWith("jots.jsonl"))).toBe(true);
    expect(canonicalHolds(dir, "ZQKEEPER")).toBe(true);
  });

  test("review B, MAJOR-1: BOTH databases' logs are folded in, and the whole directory is clean", async () => {
    // Box 3 is in WAL too, and the `rebuildCache()` one step inside the
    // ceremony rewrites its `doc_tokens` rows — so the OLD pages sit in
    // `cache/cache.sqlite*` until something folds them over. The chase visited
    // box 2 only, and the console printed `unchased: nothing`: the owner told
    // the directory was clean when reviewer B had found the removed word still
    // in `cache/cache.sqlite` in 3 of 5 runs.
    //
    // **I could not reproduce that residue here** — 0 hits across 12 shapes
    // (200/600/1500 fillers x two body sizes x with and without a forced
    // pre-removal checkpoint), and 5 rounds of the real ceremony with the fix
    // disabled. So this pins the MECHANISM, which is deterministic, rather than
    // a byte pattern I cannot summon: box 3's log is TRUNCATED by the removal,
    // which is the thing that folds those pages over, and the whole directory
    // is grepped anyway so the residue is caught if the shape ever arises.
    const WORD = "ZQCACHERESIDUEPROBE";
    const s = store();
    for (let i = 0; i < 300; i += 1) {
      s.put({ type: "memory", kind: "fact", body: `filler ${i} ${"pad ".repeat(40)}` });
    }
    const id = s.put({ type: "memory", kind: "fact", body: `a doomed memory holding ${WORD}` });
    s.revise(id, { body: `revised, still holding ${WORD}` });
    s.close();
    // Box 3's log carries real frames going in, so truncating it is a change.
    expect(statSync(`${paths.cache(dir)}-wal`).size).toBeGreaterThan(0);

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    // Reported as its OWN surface, so "cache" keeps meaning the index and this
    // keeps meaning the file. Both logs named, neither implied.
    expect(printed).toContain("write-ahead log");
    expect(printed).toContain("cache write-ahead log");
    // THE MECHANISM: box 3's log is folded back and truncated to nothing, which
    // is what moves those pages. Box 2's is NOT zero afterwards and must not be
    // asserted so — the `complete` stage of the removal record is appended
    // after the checkpoint, on purpose: the checkpoint runs while it is still
    // guaranteed to run, and a removal record carries no body (§16 G9).
    expect(statSync(`${paths.cache(dir)}-wal`).size).toBe(0);
    // …and the whole directory, read as bytes — both databases, both logs, the
    // `-shm`s, `sessions/`, `spans/`, the journal and the version rows.
    expect(grepStore(dir, WORD)).toEqual([]);
  }, 30_000);

  test("F6: removing an episode takes its markdown copy, and the whole directory is clean", async () => {
    // A SECOND ON-DISK COPY OF MEMORY WORDS IS A SURFACE. That is the finding
    // the reviews raised twice on this floor (B MAJOR-1, C NEW-MAJOR-1) and the
    // span buffer's scar before them: a file the chase does not visit while the
    // console prints `unchased: nothing` is not a behaviour gap, it is the
    // report lying. `journal/` is backed up, so a leftover would ride into
    // every snapshot too.
    const WORD = "ZQJOURNALRESIDUEPROBE";
    const s = store();
    const self = new Self({ store: s, gate: () => ({ ok: true }) });
    self.openChapter("s1", { turns: 9, bytes: 6_000 });
    const episodeId = self.appendChapter("s1", `The chapter holding ${WORD}.`).episodeId as string;
    s.close();

    // The residue exists before anything is removed: the row AND the file.
    const seeded = grepStore(dir, WORD);
    expect(seeded.some((p) => p.startsWith("journal/") && p.endsWith(".md"))).toBe(true);

    // The dry run counts the surface — at its real count, not by implication.
    const plan = consoleWith();
    expect(await run(["remove", episodeId, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    expect(text(plan.out)).toContain("journal: 1");
    // A dry run removes nothing.
    expect(grepStore(dir, WORD).some((p) => p.startsWith("journal/"))).toBe(true);

    const c = consoleWith([episodeId]);
    expect(await run(["remove", episodeId, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("journal(1 markdown copy)");
    // MAJOR-5: the copies a removal cannot reach are SAID, in the completion
    // report and not only in the plan.
    expect(printed).toContain("TAKEN BEFORE TODAY");
    expect(printed).toContain("Snapshots taken from today carry no journal/ at all.");
    expect(printed).toContain("unchased (dark via the deny-list, never silently dropped): nothing");
    // §16 G15: the report names a file, never a word of its contents.
    expect(printed).not.toContain(WORD);
    // NOT ONE BYTE ANYWHERE UNDER THE STORE — the journal included.
    expect(grepStore(dir, WORD)).toEqual([]);
  }, 30_000);

  test("F6: a memory whose words a CHAPTER quotes is left alone, and said out loud", async () => {
    // The journal is the counterpart's own account of a day. A memory made from
    // it is a different row, and removing that memory does not remove the
    // account — exactly as a spans echo is left. What may not happen is
    // silence: the plan names the episodes, by id, with no text.
    const WORD = "ZQJOURNALECHOPROBE";
    const s = store();
    const self = new Self({ store: s, gate: () => ({ ok: true }) });
    self.openChapter("s1", { turns: 9, bytes: 6_000 });
    self.appendChapter("s1", `Today I finally understood ${WORD}, and it mattered.`);
    const memoryId = s.put({
      type: "memory",
      kind: "fact",
      body: `Today I finally understood ${WORD}, and it mattered.`,
    });
    s.close();

    const plan = consoleWith();
    expect(await run(["remove", memoryId, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    const planned = text(plan.out);
    expect(planned).toContain("journal echo:");
    expect(planned).toContain("Left on purpose");
    expect(planned).toMatch(/epi_[0-9a-f]+/);
    expect(planned).not.toContain(WORD);

    // The real removal takes the memory and leaves the chapter — its row and
    // its file alike, because the file says what the row says.
    const c = consoleWith([memoryId]);
    expect(await run(["remove", memoryId, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    // The two lines may not disagree: "nothing beside the row" must not read as
    // "this surface is clean" two lines under a disclosure that it is not.
    expect(text(c.out)).toContain("journal(0 of its own");
    expect(text(c.out)).toContain("left on purpose");
    expect(grepStore(dir, WORD).some((p) => p.startsWith("journal/"))).toBe(true);
  }, 30_000);

  test("MAJOR-3: the journal echo is EXACT, not a ranked top-20 that goes silent on a big store", async () => {
    // The review's P8b: one chapter quoting the words, one memory with the same
    // sentence, then twenty-five near-identical memories — the ordinary shape of
    // a store that has thought about one subject for a while. The disclosure was
    // computed from `store.search(body, 20)`, so the episode fell off the end of
    // a ranked list and the report printed `chase journal: 0` and
    // `unchased: nothing` over a plain .md file that still held the sentence.
    const WORD = "ZQECHOSILENT";
    const sentence = `The ${WORD} question, and what it turned out to mean.`;
    const s = store();
    const self = new Self({ store: s, gate: () => ({ ok: true }) });
    self.openChapter("s1", { turns: 9, bytes: 6_000 });
    // A REAL CHAPTER: the sentence inside a long first-person account, which is
    // what an episode actually looks like — and what makes length
    // normalisation push it below twenty short memories that say almost the
    // same thing. That is the whole shape of the finding.
    self.appendChapter(
      "s1",
      `${sentence}\n\n${"Then the afternoon went on, and other things happened that had nothing to do with it. ".repeat(60)}`,
    );
    const memoryId = s.put({ type: "memory", kind: "fact", body: sentence });
    for (let i = 0; i < 25; i += 1) {
      s.put({ type: "memory", kind: "fact", body: `The ${WORD} question, and what it turned out to mean (${i}).` });
    }
    s.close();

    const plan = consoleWith();
    expect(await run(["remove", memoryId, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    const planned = text(plan.out);
    // NON-VACUOUS, and this is the assertion that says so: the ranked search the
    // disclosure used to ride on does NOT surface the episode here — the
    // contamination list is twenty memories deep and holds no `epi_` id at all —
    // and the echo line names it anyway.
    const contamination = planned.slice(planned.indexOf("other memories whose text overlaps"));
    expect(contamination).not.toMatch(/epi_[0-9a-f]+/);
    expect(planned).toContain("journal echo:");
    expect(planned).toMatch(/epi_[0-9a-f]+/);
    // The brief asks for the COMMAND, not just the id.
    expect(planned).toMatch(/counterparts remove epi_[0-9a-f]+ --confirm/);
    // …and the words themselves never appear in the report (§16 G15).
    expect(planned).not.toContain(WORD);
  }, 30_000);

  test("MAJOR-3: a bounded echo check SAYS it was bounded", async () => {
    const WORD = "ZQECHOBOUND";
    const s = store();
    const self = new Self({ store: s, gate: () => ({ ok: true }) });
    self.openChapter("s1", { turns: 9, bytes: 6_000 });
    self.appendChapter("s1", `A chapter about ${WORD}.`);
    for (let i = 0; i < 6; i += 1) {
      s.put({
        type: "episode",
        kind: "self",
        body: `## chapter 1 — lived day 0\n\nfiller episode ${i}\n`,
        meta: { sessionId: `f${i}`, chapters: 1 },
      });
    }
    const memoryId = s.put({ type: "memory", kind: "fact", body: `A chapter about ${WORD}.` });
    s.close();

    // A bound is survivable; a SILENT bound is not. With the scan cut to three
    // episodes the report must say what it did not look at.
    const plan = consoleWith();
    expect(
      await run(["remove", memoryId, "--dir", dir, "--echo-scan", "3"], { io: plan.io }),
    ).toBe(EXIT.ok);
    expect(text(plan.out)).toContain("checked 3 of 7");
  }, 30_000);

  test("NEW-MAJOR-1: a removed body on OVERFLOW pages leaves no freed page holding it", async () => {
    // THE FINDING THE PREVIOUS VERSION OF THIS TEST MISSED, and it missed it for
    // a reason worth writing down: its marker sat at the START of the body, and
    // the page holding the start of an overflow chain gets reused. The middle
    // and the end do not. So the assertion passed as a property of where the
    // word sat, not of the store.
    //
    // Blanking a long body frees whole OVERFLOW pages, and `secure_delete` is 2
    // (FAST) by default — it zeroes the slack of a page being rewritten, never a
    // whole freed page. A second checkpoint does not help: the checkpoint is
    // what MATERIALISES those stale pages into the main file. Only VACUUM (then
    // a checkpoint, since in WAL mode the VACUUM itself writes to the log)
    // rebuilds the file from live pages alone. Measured deterministic 5/5.
    const MARKS = ["ZQOVERFLOWSTART", "ZQOVERFLOWMIDDLE", "ZQOVERFLOWEND"];
    const pad = "the quick brown fox jumps over the lazy dog. ".repeat(450);
    const bodyOf = (tag: string): string =>
      `${MARKS[0] as string} ${tag} ${pad} ${MARKS[1] as string} ${pad} ${MARKS[2] as string}`;

    const s = store();
    for (let i = 0; i < 200; i += 1) {
      s.put({ type: "memory", kind: "fact", body: `filler ${i} ${"pad ".repeat(60)}` });
    }
    const id = s.put({ type: "memory", kind: "fact", body: bodyOf("one") });
    // The revision matters: it frees the first body's pages, so this covers
    // residue left by an EARLIER write as well as by the removal itself.
    s.revise(id, { body: bodyOf("two") });
    s.close();

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    // The surface is named for what it now does, on both databases.
    const printed = text(c.out);
    expect(printed).toContain("write-ahead log and freed pages");
    expect(printed).toContain("cache write-ahead log and freed pages");

    // NOT ONE MARK, ANYWHERE UNDER THE STORE — every file read as bytes, both
    // databases and both logs. Each mark asserted by name so a failure says
    // WHICH part of the body survived.
    for (const mark of MARKS) {
      expect({ mark, residue: grepStore(dir, mark) }).toEqual({ mark, residue: [] });
    }
    // Freed pages really were reclaimed, not merely absent from this shape.
    const db = openDb(paths.operational(dir));
    try {
      expect(db.get<{ freelist_count: number }>("PRAGMA freelist_count")?.freelist_count).toBe(0);
    } finally {
      db.close();
    }
  }, 60_000);

  test("NEW-MAJOR-1: `verify --rebuild` really does reclaim, since the removal names it", async () => {
    // When the reclaim is contended the removal says the words may remain and
    // names this command. Measured before this fix: `verify --rebuild` left the
    // residue exactly where it was, because rebuilding box 3 says nothing about
    // box 2's free list. A remedy that does not remedy is worse than none.
    const MARK = "ZQREMEDYPROBE";
    const pad = "the quick brown fox jumps over the lazy dog. ".repeat(450);
    const s = store();
    for (let i = 0; i < 200; i += 1) {
      s.put({ type: "memory", kind: "fact", body: `filler ${i} ${"pad ".repeat(60)}` });
    }
    const id = s.put({ type: "memory", kind: "fact", body: `head ${pad} ${MARK}` });
    s.revise(id, { body: `head two ${pad} ${MARK}` });
    // Manufacture the residue state: take the rows dark and chase them WITHOUT
    // the reclaim, which is what a contended removal leaves behind.
    s.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner" });
    chaseRemoved(s, id);
    s.rebuildCache();
    s.close();
    const ck = openDb(paths.operational(dir));
    ck.get("PRAGMA wal_checkpoint(TRUNCATE)");
    ck.close();
    expect(grepStore(dir, MARK)).not.toEqual([]);

    const c = consoleWith();
    expect(
      await run(["verify", "--dir", dir, "--rebuild", "--drop-vectors"], { io: c.io }),
    ).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Reclaimed free pages in the database");
    expect(grepStore(dir, MARK)).toEqual([]);
  }, 60_000);

  test("review B, MAJOR-1: a CONTENDED cache checkpoint is reported, never claimed", async () => {
    // The same rule box 2 already had: a reader holding an older snapshot means
    // the log cannot be truncated, and the honest answer is to say so rather
    // than to throw or to claim it. The removal's rows have already gone by
    // then; a checkpoint problem is a line in the report.
    //
    // It takes about five seconds on purpose — the rebuild inside the ceremony
    // waits out `BUSY_TIMEOUT_MS` against the held read transaction before it
    // proceeds. That is F1's busy timeout doing its job, not this fix.
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "ZQCONTENDEDPROBE doomed" });
    s.close();

    const holder = openDb(paths.cache(dir));
    holder.exec("BEGIN");
    holder.get("SELECT count(*) AS n FROM doc_tokens");
    try {
      const c = consoleWith([id]);
      expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
      const printed = text(c.out);
      // Named as unchased, with the reason and what clears it — not silence,
      // and not a claim that it was done.
      expect(printed).toContain("cache write-ahead log and freed pages (");
      // It says WHY, what is still true, and the command that finishes it —
      // never silence and never a claim that it was done.
      expect(printed).toContain("the memory's rows are gone, but its words may remain");
      expect(printed).toContain("counterparts verify --dir <store> --rebuild");
      expect(printed).not.toContain("unchased (dark via the deny-list, never silently dropped): nothing");
      // AND THE DURABLE RECORD SAYS SO TOO. The console's sentence is
      // ephemeral; the record is what a reader has months later, and
      // `complete` on its own would read as "everything was reached".
      const after = Store.open({ dir, observer: true });
      try {
        const done = after.removalRecord(id).filter((r) => r.stage === "complete");
        expect(done.length).toBe(1);
        expect(done[0]?.reason).toContain("surface unchased");
      } finally {
        after.close();
      }
    } finally {
      try {
        holder.exec("ROLLBACK");
      } catch {
        /* the removal may have taken it already */
      }
      holder.close();
    }
  }, 30_000);

  test("with the prose GONE, the coverage mark alone still chases it — which is why old rows need no migration", async () => {
    // The retroactive half, isolated. Deleting the prose file takes away BOTH
    // the other two keys at once: the `origin.spanHash` meta this branch added,
    // and the body the option-A console matched on. What is left is what the
    // store has always held — `origin_ref` on the row and an `own: true` mark in
    // the scope's `coverage.jsonl` — and it is enough. That is why a memory
    // minted months before this branch is chaseable with no migration.
    store().close();
    const id = await noteThroughTheJotDoor(MARKER);

    const s = store();
    const ref = s.row(id)?.origin_ref ?? "";
    makeBodyUnreadable(s, id);
    s.close();
    expect(ref).toMatch(/^prp_/);

    // The mark this chase runs on, on disk since long before the feature.
    const scopes = readdirSync(join(dir, "spans")).filter((n) => /^[0-9a-f]{12}$/.test(n));
    const coverage = readFileSync(join(dir, "spans", scopes[0] as string, "coverage.jsonl"), "utf8");
    expect(coverage).toContain(`"proposalId":"${ref}"`);
    expect(coverage).toContain('"own":true');

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    // Not `unknown`, which is what this same store says when the mark is missing
    // (the blind-spot test below): the buffer is addressed by identity here.
    expect(text(plan.out)).toContain("chase spans: 1");
    expect(text(plan.out)).toContain("chased — spans/");
    expect(text(plan.out)).toContain("matched by the span hash its mint recorded");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("spans(1 line in 1 file)");
    expect(text(c.out)).toContain('"unchased":0');
    expect(grepStore(dir, "ZQRESIDUEPROBE")).toEqual([]);
  });

  test("a conversation turn that QUOTES the note is disclosed and left — the plan's count is the strike's count", async () => {
    // The live shape the CLI-only fixtures cannot make: on the owner's machine a
    // note is taken mid-conversation, so the Stop hook has already captured the
    // turn in which the words were SAID into `buffer.jsonl`. That span belongs
    // to no single memory — it is many turns joined — and striking it because
    // one memory quoted it would destroy material nobody named. So it is left,
    // and it is SAID (§16 G15), and the plan's number matches the strike's.
    store().close();
    const s = store();
    s.close();
    const counterpart = openCounterpart(dir);
    try {
      counterpart.captureSpans({
        session: "live",
        scope: process.cwd(),
        turns: [
          { role: "user", text: `Please remember this for me: ${MARKER} And then let us move on.` },
        ],
      });
    } finally {
      counterpart.close();
    }
    const id = await noteThroughTheJotDoor(MARKER);
    expect(grepStore(dir, "ZQRESIDUEPROBE").filter((p) => p.startsWith("spans/")).sort()).toEqual([
      expect.stringContaining("buffer.jsonl"),
      expect.stringContaining("jots.jsonl"),
    ]);

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    const planned = text(plan.out);
    // ONE line struck, not two: the jot's own capture.
    expect(planned).toContain("chase spans: 1");
    expect(planned).toContain("1 line of conversation under spans/");
    expect(planned).toContain("transcript, not this memory's own capture, and left alone");
    // Matched BY WHAT, said out loud — the two chases are not equally strong.
    expect(planned).toContain("matched by the span hash its mint recorded");
    // The echo is LEFT, which is neither a chase nor a failure, and it never
    // appears under "CANNOT chase … the id goes dark instead" — a conversation
    // turn has no id and no tombstone.
    expect(planned).toContain("LEFT on purpose — spans echo:");
    expect(planned).not.toContain("CANNOT chase spans echo");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    // The plan said 1, the strike took 1.
    expect(printed).toContain("spans(1 line in 1 file)");
    // And the leftover is COUNTED, by name, on its own line — not filed under
    // "unchased (dark via the deny-list…)", which is about failure.
    expect(printed).toContain("left on purpose (not a failure");
    expect(printed).toContain("spans echo: 1 line of conversation");
    expect(printed).toContain('"unchased":0');

    const left = grepStore(dir, "ZQRESIDUEPROBE");
    expect(left.some((p) => p.endsWith("jots.jsonl"))).toBe(false);
    expect(left.some((p) => p.endsWith("buffer.jsonl"))).toBe(true);
    expect(canonicalHolds(dir, "ZQRESIDUEPROBE")).toBe(false);
  });

  test("the CONTENT fallback may only ever take a jot — a conversation turn is never struck by shape", async () => {
    // The other half of the echo rule, and the one that matters most: a row with
    // NO recorded hash (migrated, or minted before provenance) is chased by
    // matching its body, and a body that happens to appear verbatim inside a
    // live conversation turn must not take that turn with it. The predicate is
    // restricted to `kind: "jot"` in the seam AND in the plan's count, so this
    // is not a rule one caller could forget.
    store().close();
    const BODY = "ZQFALLBACK the boathouse combination is the year the pier was rebuilt.";
    const counterpart = openCounterpart(dir);
    try {
      counterpart.captureSpans({
        session: "live",
        scope: process.cwd(),
        turns: [{ role: "user", text: `We talked about it: ${BODY} Anyway.` }],
      });
    } finally {
      counterpart.close();
    }

    // A row with no origin at all: no spanHash meta, no origin_ref, so nothing
    // but the body can address the buffer.
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: BODY });
    s.close();
    expect(s.row).toBeDefined();

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    const planned = text(plan.out);
    // Nothing to strike — the only line holding these words is a conversation
    // turn, and no jot matched — so the state is the honest `unknown` (a row
    // with no provenance cannot prove it never rode the buffer) AND the
    // conversation line is disclosed. Both, neither hiding the other.
    expect(planned).toContain("NOT chased — spans/");
    expect(planned).toContain("if a jot is there");
    expect(planned).toContain("1 line of conversation under spans/");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    expect(text(c.out)).not.toContain("spans(1 line");
    expect(text(c.out)).toContain("spans echo: 1 line of conversation");
    expect(text(c.out)).toContain('"unchased":1');
    // THE POINT: the conversation is untouched.
    expect(grepStore(dir, "ZQFALLBACK").some((p) => p.endsWith("buffer.jsonl"))).toBe(true);
    expect(canonicalHolds(dir, "ZQFALLBACK")).toBe(false);
  });

  test("a memory that never rode the buffer reads 'not applicable', and unchased stays 0", async () => {
    // A buffer EXISTS in this store — the note above is what puts one there — so
    // "not applicable" is a statement about this memory, not about an empty
    // directory. The row is shaped the way a sweep mint shapes one:
    // `channel: "fallback"`, `ownSpanHash: null`, an origin that names the scope.
    store().close();
    expect(await run(["note", MARKER, "--dir", dir], { io: consoleWith().io })).toBe(EXIT.ok);

    const s = store();
    const id = s.put({
      type: "memory",
      kind: "fact",
      body: "A memory the sweep wrote about a conversation, never captured as a jot.",
      source: "fallback",
      origin: { session: "s1", scope: process.cwd(), ref: "prp_test" },
    });
    s.close();

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    expect(text(plan.out)).toContain("spans: not applicable");
    expect(text(plan.out)).toContain("a 'fallback' memory is not captured as a jot");
    expect(text(plan.out)).toContain("no jot under spans/");
    expect(text(plan.out)).toContain("chase spans: 0");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("unchased (dark via the deny-list, never silently dropped): nothing");
    expect(printed).toContain('"unchased":0');
    // And the other note's capture is still there — a removal that struck an
    // unrelated scope's buffer would be the worst failure this seam can have.
    expect(grepStore(dir, "ZQRESIDUEPROBE").some((p) => p.startsWith("spans/"))).toBe(true);
  });

  test("removing a migrated row does NOT reach into other projects' jots — it lists them and refuses", async () => {
    // REVIEW F4, and the reason it blocks the live store: `tools/migrate/apply.ts`
    // writes `origin: { ref }` and NOTHING else, so every one of ~12,000 migrated
    // rows has no scope and no span hash. The only chase left is by content — and
    // a content chase with no scope visits every project on the machine.
    // Measured before the fix: removing "buy milk" destroyed two unrelated jots
    // in two unrelated projects and ledgered both their hashes.
    store().close();
    const counterpart = openCounterpart(dir);
    try {
      counterpart.captureJot({ session: "a", scope: "/Users/test/project-a", text: "ZQMILK buy milk" });
      counterpart.captureJot({
        session: "b",
        scope: "/Users/test/project-b",
        text: "ZQMILK buy milk and call the vet about the spaniel",
      });
    } finally {
      counterpart.close();
    }

    const s = store();
    const id = s.put({
      type: "memory",
      kind: "fact",
      body: "ZQMILK buy milk",
      source: "migrated",
      origin: { ref: "v1_trace_00891" },
    });
    s.close();

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    const planned = text(plan.out);
    expect(planned).toContain("NOT chased — spans/");
    expect(planned).toContain("would have to visit EVERY project on this machine");
    expect(planned).toContain("--strike-by-content-across-scopes");
    // The candidate is NAMED — file and count — and its words are not printed.
    expect(planned).toMatch(/1 jot line whose whole text is this memory's body would have matched, in spans\/[0-9a-f]{12}\/jots\.jsonl \(1\)/);
    expect(planned).not.toContain("call the vet");
    // The longer jot is not even a candidate: exact-line equality, not substring.
    expect(planned).toContain("(1)");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    // NOTHING was struck, and BOTH other projects' jots are exactly as they were.
    expect(text(c.out)).not.toContain("spans(");
    expect(text(c.out)).toContain('"unchased":1');
    const left = grepStore(dir, "ZQMILK");
    expect(left.filter((p) => p.startsWith("spans/")).length).toBe(2);
    // And no hash was ledgered on their behalf.
    for (const scope of readdirSync(join(dir, "spans")).filter((n) => /^[0-9a-f]{12}$/.test(n))) {
      expect(existsSync(join(dir, "spans", scope, "consumed.jsonl"))).toBe(false);
    }
  });

  test("--strike-by-content-across-scopes performs it, and STILL only takes the exact jot", async () => {
    store().close();
    const counterpart = openCounterpart(dir);
    try {
      counterpart.captureJot({ session: "a", scope: "/Users/test/project-a", text: "ZQMILK buy milk" });
      counterpart.captureJot({
        session: "b",
        scope: "/Users/test/project-b",
        text: "ZQMILK buy milk and call the vet about the spaniel",
      });
    } finally {
      counterpart.close();
    }
    const s = store();
    const id = s.put({
      type: "memory",
      kind: "fact",
      body: "ZQMILK buy milk",
      source: "migrated",
      origin: { ref: "v1_trace_00891" },
    });
    s.close();

    const plan = consoleWith();
    expect(
      await run(["remove", id, "--strike-by-content-across-scopes", "--dir", dir], { io: plan.io }),
    ).toBe(EXIT.ok);
    expect(text(plan.out)).toContain("chase spans: 1");
    expect(text(plan.out)).toContain("matched by content across every scope, on your say-so");

    const c = consoleWith([id]);
    expect(
      await run(["remove", id, "--confirm", "--strike-by-content-across-scopes", "--dir", dir], {
        io: c.io,
      }),
    ).toBe(EXIT.ok);
    expect(text(c.out)).toContain("spans(1 line in 1 file)");
    // The one whose WHOLE text was the body is gone; the one that merely
    // contains the words — somebody else's memory — is untouched.
    const left = grepStore(dir, "ZQMILK").filter((p) => p.startsWith("spans/") && p.endsWith("jots.jsonl"));
    expect(left.length).toBe(1);
    expect(readFileSync(join(dir, left[0] as string), "utf8")).toContain("call the vet");
  });

  test("a crashed strike's .striking aside is SEEN by the plan and folded back by the next one", async () => {
    // REVIEW F1 + F2 + F3. An aside is a crashed strike's survivors: invisible
    // to `claimFiles()`, invisible to the sweep, and — before the fix —
    // invisible to the residue walk, so a second `remove` said "not applicable"
    // while the words sat on disk and `backup` copied them.
    store().close();
    const id = await noteThroughTheJotDoor(MARKER);
    const scope = readdirSync(join(dir, "spans")).find((n) => /^[0-9a-f]{12}$/.test(n)) as string;
    const jots = join(dir, "spans", scope, "jots.jsonl");
    // Stage the crash: the rename landed, the append-back never did.
    renameSync(jots, `${jots}.striking`);
    expect(existsSync(jots)).toBe(false);
    expect(grepStore(dir, "ZQRESIDUEPROBE").some((p) => p.endsWith(".striking"))).toBe(true);

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    // SEEN, not "not applicable".
    expect(text(plan.out)).toContain("chase spans: 1");
    expect(text(plan.out)).toContain(".striking");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    // The aside is gone, the words are gone, and nothing is stranded.
    expect(existsSync(`${jots}.striking`)).toBe(false);
    expect(grepStore(dir, "ZQRESIDUEPROBE")).toEqual([]);
  });

  test("an unrelated strike RECOVERS a stranded aside — repair is not gated on having something to strike", async () => {
    // REVIEW F3. The survivors in an aside belong to nobody's removal, so
    // folding them back must not wait for a removal that happens to match them.
    store().close();
    const keeper = "ZQKEEPER the north gate is padlocked and the key hangs in the tack room.";
    await noteThroughTheJotDoor(keeper);
    const doomedId = await noteThroughTheJotDoor(MARKER);
    const scope = readdirSync(join(dir, "spans")).find((n) => /^[0-9a-f]{12}$/.test(n)) as string;
    const jots = join(dir, "spans", scope, "jots.jsonl");

    // A crashed strike left BOTH notes' captures in an aside.
    renameSync(jots, `${jots}.striking`);

    expect(
      await run(["remove", doomedId, "--confirm", "--dir", dir], { io: consoleWith([doomedId]).io }),
    ).toBe(EXIT.ok);

    // The doomed one is gone; the OTHER note's capture came home to the live
    // stream, where the buffer can see it again.
    expect(existsSync(`${jots}.striking`)).toBe(false);
    expect(grepStore(dir, "ZQRESIDUEPROBE")).toEqual([]);
    expect(readFileSync(jots, "utf8")).toContain("ZQKEEPER");
  });

  test("the honest line survives for the one state left blind: prose gone, no hash recorded", async () => {
    store().close();
    expect(await run(["note", MARKER, "--dir", dir], { io: consoleWith().io })).toBe(EXIT.ok);

    // A row minted before provenance existed: `source` NULL, no origin at all,
    // and its prose file removed underneath the store. There is nothing left to
    // address the buffer with, and the console says exactly that.
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "A pre-provenance memory." });
    makeBodyUnreadable(s, id);
    s.close();

    const plan = consoleWith();
    expect(await run(["remove", id, "--dir", dir], { io: plan.io })).toBe(EXIT.ok);
    const planned = text(plan.out);
    expect(planned).toContain("NOT chased — spans/");
    expect(planned).toContain("no span hash was recorded");
    expect(planned).toContain("a later backup would copy it");

    const c = consoleWith([id]);
    expect(await run(["remove", id, "--confirm", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("unchased (dark via the deny-list, never silently dropped): spans/");
    expect(text(c.out)).toContain('"unchased":1');
  });
});

// ── verify ──────────────────────────────────────────────────────────────────

describe("verify", () => {
  /** A vector in box 3, put there the way the backfill puts one there. */
  function seedVector(id: string): void {
    const db = openCache(paths.cache(dir));
    try {
      setEmbedding(db, id, [0.1, 0.2, 0.3]);
    } finally {
      db.close();
    }
  }

  /** Box 3 as it looked before I13: a dead row's tokens still in the index. */
  function reindexDead(id: string, text: string): void {
    const db = openCache(paths.cache(dir));
    try {
      indexDoc(db, id, text);
    } finally {
      db.close();
    }
  }

  /**
   * EVERY file under the data dir, cache included — the dashboard suite's
   * protocol (`test/dashboard.test.ts`'s `snapshot`), not `fingerprint`, which
   * skips box 3 and would let a census that rewrote `doc_tokens` through.
   */
  function everyByte(root: string): string {
    const parts: string[] = [];
    const walk = (at: string): void => {
      for (const name of readdirSync(at).sort()) {
        // Bar a database's `-shm`: under WAL every connection writes read-marks
        // into it, a read-only one included. The `-wal` is hashed with the file —
        // a commit lives there until a checkpoint moves it in.
        if (isDatabaseSidecar(name)) continue;
        const full = join(at, name);
        if (statSync(full).isDirectory()) walk(full);
        else parts.push(`${full}:${readFileSync(full).toString("base64")}`);
      }
    };
    walk(root);
    return parts.join("|");
  }

  /** What box 3 holds, read the way the census reads it. */
  function embeddings(): number {
    if (!existsSync(paths.cache(dir))) return 0;
    const db = openDb(paths.cache(dir));
    try {
      return db.get<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings")?.n ?? 0;
    } finally {
      db.close();
    }
  }

  test("the bare command is a CENSUS: it counts box 3 and drops nothing", async () => {
    // The sharp edge: `rebuildCache()` starts with `resetCache`, which drops
    // `embeddings`, and this console has no embedder — so a bare `verify` used
    // to cost one paid network call per vector to undo. On the live store that
    // was ~13,700 of them.
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "The memory whose vector must survive a look." });
    s.put({ type: "memory", kind: "fact", body: "A second memory, with no vector of its own." });
    // A durable log with history: three unlatched rows and one record from day
    // 0, one row from today, and a clock that has moved past the window for the
    // old ones — so the census has real numbers to print, and prints them
    // without sweeping (this is a look, not the cycle).
    for (let i = 0; i < 3; i++) s.appendEvent({ name: "recall.decision", day: 0, ref: `s${i}` });
    s.appendEvent({ name: "memory.pruned", day: 0, ref: kept, dedupKey: `sleep.pruned.${kept}` });
    for (let d = 1; d <= 91; d++) s.advanceClock(new Date(Date.UTC(2026, 0, d)).toISOString().slice(0, 10));
    s.appendEvent({ name: "recall.decision", day: 91, ref: "today" });
    s.close();
    seedVector(kept);

    const before = fingerprint(dir);
    const everyByteBefore = everyByte(dir);
    const c = consoleWith();
    expect(await run(["verify"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("Canonical rows: 2");
    // WHERE THE WORDS ARE. Two census lines counting how the path columns were
    // spelled and how many of their files were on disk used to stand here — a
    // report ON the file layout, which went with the columns. What replaces it
    // is the one fact an owner looking for his markdown needs, and a store that
    // still had any prose files would be one this build refused to open.
    expect(printed).toContain("Floor: schema v6 · bodies in rows · prose files: none");
    expect(printed).not.toContain("Prose paths:");
    // F1's line is still there, beside it.
    expect(printed).toContain("Journal mode: wal (busy timeout");
    // The log, read-only: what is held, how old, and what the next sweep takes.
    expect(printed).toContain("Events: 5 held (1 latched records)   oldest: lived day 0 (");
    expect(printed).toContain("window: 90 lived days (cutoff day 1)");
    expect(printed).toContain(
      `past the window: 3 unlatched (the next sleep pass deletes 3, cap ${SLEEP_TUNABLES.BUDGETS.log} per pass), 1 latched records kept`,
    );
    expect(printed).toContain("embeddings: 1");
    expect(printed).toContain("live memories with no vector: 1");
    // "live", not "canonical": since I13 the index covers the LIVE rows and an
    // archived one is deliberately absent from it.
    expect(printed).toContain("live rows: 2");
    expect(printed).toContain("indexed but not live (archived or superseded): 0");
    expect(printed).toContain("The cache covers every live row");
    // Nothing canonical moved, and — the whole point — the vector is still there.
    expect(fingerprint(dir)).toBe(before);
    expect(embeddings()).toBe(1);
    // And not a byte anywhere in the directory, box 3 included: `openCache` is
    // version-idempotent now, so the census may claim the strong form the
    // dashboard suite could only claim across renders (its INTERFACE-GAPS §1).
    expect(everyByte(dir)).toBe(everyByteBefore);
  });

  test("--prune-index is the cheap repair for a store written before I13", async () => {
    // A store that archived rows BEFORE `archive` deindexed them still holds
    // their tokens, where they count toward document frequency against a live
    // denominator. `--rebuild` would fix it and drop every embedding on the way,
    // and refuses outright while it holds any — so it is not a repair the owner
    // of a real store can run. This one is, and the vector survives it.
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "The zygomorphic orchid bloomed after the frost." });
    const gone = s.put({ type: "memory", kind: "fact", body: "The zygomorphic orchid was moved indoors." });
    s.archive(gone, "duplicate");
    s.close();
    // Put the pre-I13 state back by hand, through box 3's own door: archived in
    // box 2, still indexed in box 3, which is what every store written before
    // this change looks like.
    reindexDead(gone, "The zygomorphic orchid was moved indoors.");
    seedVector(kept);

    const before = consoleWith();
    expect(await run(["verify"], { io: before.io, env: { [ENV]: dir } })).toBe(EXIT.failed);
    expect(text(before.out)).toContain("indexed but not live (archived or superseded): 1");
    expect(text(before.err)).toContain("--prune-index");

    const c = consoleWith();
    expect(await run(["verify", "--prune-index", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Dropped from the text index (archived or superseded): 1");
    expect(embeddings()).toBe(1);

    const after = consoleWith();
    expect(await run(["verify"], { io: after.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(after.out)).toContain("indexed but not live (archived or superseded): 0");
  });

  test("--retry-skipped is the way BACK for an id the backfill gave up on", async () => {
    // THE SKIP IS SELF-SEALING (I33). `missingVectors` stops offering an id once
    // its `embed.failed` counter reaches the limit, so the backfill never tries
    // it, so the counter can never be cleared by a run that lands — and
    // `--rebuild` has no embedder to recompute a vector with and never touches
    // box 2. Without this flag a repaired title had no door at all.
    const s = store();
    const stuck = s.put({ type: "memory", kind: "fact", body: "A memory with a poisoned title, once." });
    const fine = s.put({ type: "memory", kind: "fact", body: "A memory nothing ever objected to." });
    s.setMeta(`${EMBED_FAILED_PREFIX}${stuck}`, String(EMBED_SKIP_AFTER));
    expect(s.skippedVectorIds()).toEqual([stuck]);
    expect(s.missingVectors(64)).toEqual([fine]);
    // The census says so, and names the remedy rather than one that cannot work.
    s.close();

    const census = consoleWith();
    await run(["verify"], { io: census.io, env: { [ENV]: dir } });
    const printed = text(census.out);
    expect(printed).toContain("skipped after repeated embed failures: 1");
    expect(printed).toContain("--retry-skipped");
    expect(printed).not.toContain("rebuild box 3");

    const c = consoleWith();
    expect(await run(["verify", "--retry-skipped", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    const said = text(c.out);
    expect(said).toContain("Embed-failure counters cleared: 1");
    expect(said).toContain("Back in the backfill's rotation: 1");
    expect(said).toContain(stuck);

    const after = store();
    expect(after.skippedVectorIds()).toEqual([]);
    expect(after.missingVectors(64).sort()).toEqual([stuck, fine].sort());
    // It cleared a counter and NOTHING else: both rows are still live and the
    // one that was never stuck is untouched.
    expect(after.list({ archived: false }).sort()).toEqual([stuck, fine].sort());
    after.close();

    // And on a store with nothing skipped it says so rather than inventing work.
    const idle = consoleWith();
    expect(await run(["verify", "--retry-skipped", "--dir", dir], { io: idle.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    expect(text(idle.out)).toContain("Nothing was being skipped");
  });

  test("--rebuild REFUSES while box 3 holds vectors nothing here can recompute", async () => {
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "A memory whose vector cost a network call." });
    s.close();
    seedVector(kept);

    const before = fingerprint(dir);
    const c = consoleWith();
    expect(await run(["verify", "--rebuild", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    expect(text(c.err)).toContain("the 1 embedding it holds would be gone");
    expect(text(c.err)).toContain("paid network call");
    expect(text(c.err)).toContain("--drop-vectors");
    // A refusal that had already opened a writable store would be no refusal.
    expect(fingerprint(dir)).toBe(before);
    expect(embeddings()).toBe(1);
  });

  test("--rebuild --drop-vectors proceeds, and says how many it dropped", async () => {
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "A memory whose vector the owner chose to lose." });
    s.close();
    seedVector(kept);

    const c = consoleWith();
    expect(await run(["verify", "--rebuild", "--drop-vectors", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    const printed = text(c.out);
    expect(printed).toContain("Dropped on your say-so (--drop-vectors): 1 embedding.");
    expect(printed).toContain("Re-indexed: 1");
    expect(embeddings()).toBe(0);
  });

  test("--rebuild rebuilds box 3 from canonical state and accounts for every row", async () => {
    const s = store();
    for (let i = 0; i < 5; i++) s.put({ type: "memory", kind: "fact", body: `Canonical memory ${i} of five.` });
    s.close();
    rmSync(paths.cacheDir(dir), { recursive: true, force: true });

    // No vectors to lose, so no flag is needed: the guard is about cost, not ceremony.
    const c = consoleWith();
    expect(await run(["verify", "--rebuild", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Re-indexed: 5");
    // What cannot be recomputed is DECLARED, with an owner and a repair (§5 G8).
    expect(text(c.out)).toContain("declared: embeddings");
  });

  test("--rebuild refuses when the vector count CANNOT be taken — the guard fails closed", async () => {
    // The realistic version of this is contention: box 3 is the file the Stop
    // worker writes vectors into, so a locked read is ordinary. An unreadable
    // file reproduces the same branch without a second process. A guard that
    // read zero from a failure would drop what it could not count.
    const s = store();
    s.put({ type: "memory", kind: "fact", body: "A memory whose index went unreadable." });
    s.close();
    writeFileSync(paths.cache(dir), "not a database");
    // The sidecars go with it. Box 3 is in WAL since 2026-09-18, and a `-wal`
    // left beside a garbled main file is a database SQLite recovers from — the
    // fixture would stop reproducing the branch it is here to reproduce.
    for (const side of ["-wal", "-shm"]) rmSync(`${paths.cache(dir)}${side}`, { force: true });

    const c = consoleWith();
    expect(await run(["verify", "--rebuild", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
    expect(text(c.err)).toContain("could not be read");
    expect(readFileSync(paths.cache(dir)).toString()).toBe("not a database");

    // The census over the same store cannot even open it — `Store.open` builds
    // box 3 on the way in — and that is a reported failure, not a stack trace
    // and not a repair.
    const look = consoleWith();
    expect(await run(["verify"], { io: look.io, env: { [ENV]: dir } })).toBe(EXIT.failed);
    expect(text(look.err)).toContain("verify failed:");
    expect(readFileSync(paths.cache(dir)).toString()).toBe("not a database");
  });

  test("the same garbling WITH the sidecars in place is not unreadable at all — SQLite recovers it", async () => {
    // The shape the fixture above had to remove, decided rather than deleted:
    // on a live store a garbled main file normally has a real `-wal` beside it,
    // and under WAL that `-wal` is the database. So this is not the guard's
    // branch — the file opens, the rows are there, and `--rebuild` does its
    // ordinary work. The guard's branch is the sidecar-free one above.
    const s = store();
    s.put({ type: "memory", kind: "fact", body: "A memory whose index survives its main file." });
    s.close();
    open.length = 0;
    writeFileSync(paths.cache(dir), "not a database");
    expect(existsSync(`${paths.cache(dir)}-wal`)).toBe(true);

    const c = consoleWith(["yes"]);
    expect(await run(["verify", "--rebuild", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Re-indexed: 1");
  });

  test("the census says so when box 3 is missing, rather than rebuilding it", async () => {
    const s = store();
    s.put({ type: "memory", kind: "fact", body: "A memory whose index was deleted underneath it." });
    s.close();
    rmSync(paths.cacheDir(dir), { recursive: true, force: true });

    const c = consoleWith();
    expect(await run(["verify"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.failed);
    expect(text(c.err)).toContain("verify --rebuild");
  });

  test("the census names the SHAPE the vectors are in", async () => {
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "A memory with a vector in the new shape." });
    s.close();
    seedVector(kept);

    const c = consoleWith();
    expect(await run(["verify"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("vector format: 1 float32 BLOB (v4)");

    // Age that row back to v3's JSON text and the census says which, and what
    // to run — a mixed cache is a state the readers tolerate and the owner
    // still has to finish.
    writeJsonVector(dir, kept, [0.1, 0.2, 0.3]);
    const look = consoleWith();
    expect(await run(["verify"], { io: look.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(look.out)).toContain("1 JSON text (v3)");
    expect(text(look.out)).toContain("counterparts migrate-cache");
  });

  test("--rebuild --keep-vectors re-indexes the text side and keeps every vector", async () => {
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "A memory whose vector must survive a rebuild." });
    s.close();
    seedVector(kept);

    const c = consoleWith();
    expect(await run(["verify", "--rebuild", "--keep-vectors", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    const printed = text(c.out);
    expect(printed).toContain("Vectors kept: 1");
    expect(printed).toContain("dropped as no longer canonical: 0");
    expect(printed).toContain("Re-indexed: 1");
    // Nothing is declared, because nothing is missing — the console has no
    // embedder and did not need one.
    expect(printed).not.toContain("declared: embeddings");
    expect(embeddings()).toBe(1);
  });

  test("--drop-vectors and --keep-vectors together are refused, not guessed at", async () => {
    const s = store();
    const kept = s.put({ type: "memory", kind: "fact", body: "A memory caught between two contradictory flags." });
    s.close();
    seedVector(kept);

    const c = consoleWith();
    expect(
      await run(["verify", "--rebuild", "--drop-vectors", "--keep-vectors", "--dir", dir], {
        io: c.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("opposite things");
    expect(embeddings()).toBe(1);
  });
});

// ── migrate-cache ───────────────────────────────────────────────────────────

/** Age one of box 3's rows back to v3's shape: `JSON.stringify` into `vec`. */
function writeJsonVector(at: string, id: string, vec: readonly number[]): void {
  const db = openDb(paths.cache(at));
  try {
    db.run(
      "INSERT OR REPLACE INTO embeddings (memory_id, dim, vec) VALUES (?, ?, ?)",
      id,
      vec.length,
      JSON.stringify(vec),
    );
  } finally {
    db.close();
  }
}

describe("migrate-cache — the conversion that is not a rebuild", () => {
  function shapes(): { blob: number; text: number } {
    const db = openDb(paths.cache(dir));
    try {
      const n = (t: string): number =>
        db.get<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings WHERE typeof(vec) = ?", t)?.n ?? 0;
      return { blob: n("blob"), text: n("text") };
    } finally {
      db.close();
    }
  }

  /** Memories with v3-shaped vectors — the state the live store is in. */
  function seedJsonStore(n = 2, dim = 3): string[] {
    const s = store();
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(s.put({ type: "memory", kind: "fact", body: `A memory whose vector is still JSON text, number ${i}.` }));
    }
    s.close();
    const db = openCache(paths.cache(dir));
    db.close();
    ids.forEach((id, i) =>
      writeJsonVector(dir, id, Array.from({ length: dim }, (_, k) => Math.fround((i + k + 1) / 17))),
    );
    return ids;
  }

  test("the dry run is READ-ONLY — not a byte moves, on a v3-stamped cache either", async () => {
    // `ec31994` made this honest; the review found honest is not read-only.
    // `openCache` stamps `cache_meta.schemaVersion`, which changed the file's
    // hash under a line saying nothing had changed. Every question the dry run
    // asks is a SELECT, so `openDb` is the right door.
    seedJsonStore();
    const aged = openDb(paths.cache(dir));
    aged.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', '3')");
    aged.close();
    const before = readFileSync(paths.cache(dir)).toString("base64");

    const c = consoleWith();
    expect(await run(["migrate-cache"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("JSON text: 2");
    expect(printed).toContain("float32 BLOB: 0");
    expect(printed).toContain("schema v3");
    expect(printed).toContain("Sample:");
    expect(printed).toContain("largest coordinate change in this row:");
    expect(printed).toContain("Dry run. Nothing was changed");
    // THE HINT NAMES THE PROTECTION THAT EXISTS (G40). It used to say "take a
    // 'counterparts backup --out <dir>' first" — and `backup` has box 3 on its
    // explicit exclusion list, so that snapshot holds no copy of the file
    // `--apply` rewrites. The `cp` of `cache.sqlite` is the only real cover,
    // and the sentence has to say the two things that make it one: WHICH file,
    // and that `backup` skips it deliberately rather than by oversight.
    expect(printed).toContain(`cp ${paths.cache(dir)} ${paths.cache(dir)}.bak-<date>`);
    expect(printed).toContain("skips the cache on purpose");
    expect(printed).toContain("every session closed");
    expect(printed).not.toContain("Take a 'counterparts backup");
    // The claim in full: byte-identical, with the cache still stamped v3.
    expect(readFileSync(paths.cache(dir)).toString("base64")).toBe(before);
    expect(shapes()).toEqual({ blob: 0, text: 2 });
  });

  test("--apply REFUSES a store nobody named, and COUNTERPARTS_DATA_DIR does not name it", async () => {
    // THE REVIEWER'S EXACT CASE (#77 review, 2026-09-05). This line used to
    // walk through: `migrate-cache` counted the environment variable as having
    // named the store, while `repair-dates` — one command over, the same night
    // — refused the identical line. `--yes` skips a confirmation and nothing
    // else; the `--dir` FLAG names the store, and it is the only thing that
    // does. On a real machine what the variable names is the owner's live
    // memory, and the guard runs before this command looks at a single path.
    seedJsonStore();
    const before = readFileSync(paths.cache(dir)).toString("base64");
    const c = consoleWith();
    expect(await run(["migrate-cache", "--apply", "--yes"], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(text(c.err)).toContain("will not run against a store nobody named");
    expect(text(c.err)).toContain("Name the store: --dir <path>.");
    // It stopped AT THE DOOR, not one step in at box 3's "nothing to convert"
    // refusal: both exit 2, and only the report tells them apart.
    expect(text(c.out)).not.toContain("Store:");
    expect(readFileSync(paths.cache(dir)).toString("base64")).toBe(before);

    // With nothing naming a store at all, the same refusal.
    const d = consoleWith();
    expect(await run(["migrate-cache", "--apply", "--yes"], { io: d.io, env: {} })).toBe(EXIT.refused);
    expect(text(d.err)).toContain("Name the store: --dir <path>.");
  });

  test("--apply asks before it writes, and takes no for an answer", async () => {
    seedJsonStore();
    const before = readFileSync(paths.cache(dir)).toString("base64");

    // No prompt and no --yes: refuse rather than proceed unconfirmed.
    const mute = consoleWith();
    expect(await run(["migrate-cache", "--apply", "--dir", dir], { io: mute.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(text(mute.err)).toContain("--yes");
    expect(readFileSync(paths.cache(dir)).toString("base64")).toBe(before);

    // Asked and declined.
    const no = consoleWith(["no"]);
    expect(await run(["migrate-cache", "--apply", "--dir", dir], { io: no.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(no.asked.join("")).toContain("Type 'yes'");
    expect(text(no.err)).toContain("not confirmed");
    expect(shapes()).toEqual({ blob: 0, text: 2 });

    // Asked and confirmed.
    const yes = consoleWith(["yes"]);
    expect(await run(["migrate-cache", "--apply", "--dir", dir], { io: yes.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(shapes()).toEqual({ blob: 2, text: 0 });
  });

  test("--apply --yes converts in place, keeps every vector, and compacts the file", async () => {
    seedJsonStore();
    const c = consoleWith();
    expect(
      await run(["migrate-cache", "--apply", "--yes", "--batch", "1", "--dir", dir], { io: c.io, env: { [ENV]: dir } }),
    ).toBe(EXIT.ok);
    const printed = text(c.out);
    expect(printed).toContain("Converted 2 vectors in 2 batches."); // batched, per --batch
    expect(printed).toContain("Vectors now: float32 BLOB 2, JSON text 0");
    expect(printed).toContain("Cache file:");
    // The count is the whole point: a migration that lost a vector would be a
    // rebuild wearing a different name.
    expect(shapes()).toEqual({ blob: 2, text: 0 });
  });

  test("a store CONVERTED BUT NOT COMPACTED has a door — the 177 MiB is not stranded", async () => {
    // The review's M2, reproduced: `VACUUM` is the step most likely to fail (it
    // takes an exclusive lock), and the old "already converted" refusal fired
    // BEFORE it — so a lost lock left the whole debt unreachable through the
    // tool that exists to pay it. `PRAGMA freelist_count` reads 0 in this
    // state; the win is defragmentation, so the probe is a real `VACUUM INTO`.
    seedJsonStore(400, 256);
    const db = openCache(paths.cache(dir));
    let after: string | undefined;
    for (;;) {
      const r = convertVectorBatch(db, 50, after);
      if (r.examined === 0) break;
      after = r.lastId ?? undefined;
      if (after === undefined) break;
    }
    db.close(); // committed, never vacuumed
    const stranded = statSync(paths.cache(dir)).size;
    expect(shapes()).toEqual({ blob: 400, text: 0 });

    // The dry run NAMES it rather than saying "already converted, nothing to do".
    const look = consoleWith();
    expect(await run(["migrate-cache"], { io: look.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(look.out)).toContain("Converted, NOT yet compacted:");
    expect(text(look.out)).toContain("reclaimable");
    expect(statSync(paths.cache(dir)).size).toBe(stranded); // still read-only

    // And `--apply` compacts it, converting nothing.
    const c = consoleWith();
    expect(await run(["migrate-cache", "--apply", "--yes", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    expect(text(c.out)).toContain("Cache file:");
    expect(statSync(paths.cache(dir)).size).toBeLessThan(stranded);
    expect(shapes()).toEqual({ blob: 400, text: 0 });
  });

  test("a fat `-wal` is not reclaimable space — the size is the PAGES, not the file set", async () => {
    // The other direction of the test above, and the bug between them: measuring
    // the database as `file + -wal` reported the whole `-wal` as space a VACUUM
    // would give back, because the `-wal` holds COPIES of pages the file already
    // counts. On a cache with nothing to reclaim that was 4.1 MB of phantom
    // debt — over `worthCompacting`'s floor, so `--apply` would have taken box
    // 3's exclusive lock for a full VACUUM of an already-compact file and then
    // reported a reclaim that did not happen. `page_count * page_size` is true
    // wherever the pages are sitting.
    seedJsonStore(400, 256);
    const converted = consoleWith();
    expect(
      await run(["migrate-cache", "--apply", "--yes", "--dir", dir], {
        io: converted.io,
        env: { [ENV]: dir },
      }),
    ).toBe(EXIT.ok);

    // A fat `-wal` beside it, with not one byte of garbage in the database: one
    // pass that rewrites every page and commits, below SQLite's autocheckpoint.
    const db = openCache(paths.cache(dir));
    db.exec("UPDATE embeddings SET dim = dim");
    db.close();
    expect(statSync(`${paths.cache(dir)}-wal`).size).toBeGreaterThan(1024 * 1024);

    const look = consoleWith();
    expect(await run(["migrate-cache", "--dir", dir], { io: look.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    expect(text(look.out)).toContain("Converted and compacted. Nothing to do.");
    expect(text(look.out)).not.toContain("reclaimable");
  });

  test("a second --apply REFUSES once there is nothing left to convert OR reclaim", async () => {
    seedJsonStore();
    const first = consoleWith();
    expect(await run(["migrate-cache", "--apply", "--yes", "--dir", dir], { io: first.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );

    const again = consoleWith();
    expect(await run(["migrate-cache", "--apply", "--yes", "--dir", dir], { io: again.io, env: { [ENV]: dir } })).toBe(
      EXIT.refused,
    );
    expect(text(again.err)).toContain("already float32");
    expect(shapes()).toEqual({ blob: 2, text: 0 });

    // The dry run over the same store is not an error — it was asked a
    // question and it answered it.
    const look = consoleWith();
    expect(await run(["migrate-cache"], { io: look.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(look.out)).toContain("Converted and compacted.");
  });

  test("one unparseable row is skipped, named, and left exactly as it was", async () => {
    const ids = seedJsonStore(3);
    const bad = ids[1] as string;
    const db = openDb(paths.cache(dir));
    db.run("UPDATE embeddings SET vec = ? WHERE memory_id = ?", "not json at all", bad);
    db.close();

    const c = consoleWith();
    // Loud: the store is not fully converted, and the exit code says so.
    expect(await run(["migrate-cache", "--apply", "--yes", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.failed,
    );
    const printed = text(c.out);
    expect(printed).toContain("Converted 2 vectors");
    expect(printed).toContain(`SKIPPED, left exactly as it was: ${bad}`);
    expect(shapes()).toEqual({ blob: 2, text: 1 });
    const check = openDb(paths.cache(dir));
    expect(check.get<{ vec: string }>("SELECT vec FROM embeddings WHERE memory_id = ?", bad)?.vec).toBe(
      "not json at all",
    );
    check.close();
  });

  test("it refuses a store it cannot find and a cache that was never built", async () => {
    const empty = mkdtempSync(join(tmpdir(), "counterparts-cli-"));
    try {
      const c = consoleWith();
      expect(await run(["migrate-cache"], { io: c.io, env: { [ENV]: empty } })).toBe(EXIT.failed);
      expect(text(c.err)).toContain("no store at");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }

    const s = store();
    s.put({ type: "memory", kind: "fact", body: "A memory whose index was deleted underneath it." });
    s.close();
    rmSync(paths.cacheDir(dir), { recursive: true, force: true });
    const c = consoleWith();
    expect(await run(["migrate-cache"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.failed);
    expect(text(c.err)).toContain("never been built here");
    // And it did not mint the box it was inspecting.
    expect(existsSync(paths.cache(dir))).toBe(false);
  });

  test("an instrument does not migrate the store it is reading", async () => {
    seedJsonStore();
    const c = consoleWith();
    expect(
      await run(["migrate-cache", "--apply", "--yes", "--observer", "--dir", dir], { io: c.io, env: { [ENV]: dir } }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("observer stance");
    expect(shapes()).toEqual({ blob: 0, text: 2 });
  });
});


// ── backfill-claims ─────────────────────────────────────────────────────────

describe("backfill-claims — the one-shot repair for rows minted before the floor existed", () => {
  /**
   * The pre-PR shape, which no seam can produce any more: an AUTHORED row with
   * no claim and no dimensions. Everything the command must NOT touch is here
   * too, so "only the intended rows" is a fact about this store, not a hope.
   */
  function seedMixed(s: Store): Record<string, string> {
    return {
      // The two targets.
      unclaimedA: s.put({
        type: "memory",
        kind: "fact",
        body: "An authored memory from before the default floor existed.",
        source: "authored",
      }),
      unclaimedB: s.put({
        type: "memory",
        kind: "self",
        body: "A second authored memory, also silent about its salience.",
        source: "authored",
      }),
      // Testimony: an explicit low claim is never overwritten.
      claimedLow: s.put({
        type: "memory",
        kind: "fact",
        body: "An authored memory whose author said, explicitly, barely.",
        source: "authored",
        salience: { claimed: 0.05 },
      }),
      // The other channel: the fallback's ceiling and dims stay as they are.
      swept: s.put({
        type: "memory",
        kind: "fact",
        body: "A swept memory that claimed nothing, and stays that way.",
        source: "fallback",
      }),
      // A pre-v4 row: provenance unrecorded is not provenance claimed.
      unrecorded: s.put({
        type: "memory",
        kind: "fact",
        body: "A memory whose minting channel was never recorded at all.",
      }),
    };
  }

  test("the dry run is the default: it names the rows and changes nothing", async () => {
    const s = store();
    const ids = seedMixed(s);
    const before = fingerprint(dir);
    s.close();

    const c = consoleWith();
    const code = await run(["backfill-claims"], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.ok);
    const out = text(c.out);
    expect(out).toContain("Authored memories with no claimed salience: 2");
    expect(out).toContain(ids["unclaimedA"] as string);
    expect(out).toContain(ids["unclaimedB"] as string);
    expect(out).toContain("Dry run. Nothing has changed.");
    // Ids and numbers only — a repair report never prints a body.
    expect(out).not.toContain("before the default floor existed");
    expect(fingerprint(dir)).toBe(before);
  });

  test("--apply writes the floor to exactly the intended rows, flags them, and logs the run", async () => {
    const s = store();
    const ids = seedMixed(s);
    s.close();

    const c = consoleWith();
    const code = await run(["backfill-claims", "--apply", "--dir", dir], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Applied the default floor to 2 memories.");

    const after = store({ observer: true });
    for (const key of ["unclaimedA", "unclaimedB"]) {
      const id = ids[key] as string;
      expect(after.row(id)?.claimed).toBe(TUNABLES.AUTHORED_DEFAULT_CLAIM);
      expect(after.readProse(id).meta["claimedDefault"]).toBe(true);
      // The dimensions are not invented along the way: the floor is a floor.
      expect(after.row(id)?.relevance).toBe(0);
    }
    // Untouched, all three, for three different reasons.
    expect(after.row(ids["claimedLow"] as string)?.claimed).toBe(0.05);
    expect(after.row(ids["swept"] as string)?.claimed).toBeNull();
    expect(after.row(ids["unrecorded"] as string)?.claimed).toBeNull();
    for (const key of ["claimedLow", "swept", "unrecorded"]) {
      expect(after.readProse(ids[key] as string).meta["claimedDefault"]).toBeUndefined();
    }
    const logged = after.eventLog({ name: "salience.defaulted" });
    expect(logged.length).toBe(2);
    expect(logged.map((e) => e.ref).sort()).toEqual(
      [ids["unclaimedA"] as string, ids["unclaimedB"] as string].sort(),
    );
  });

  test("a second --apply is a no-op: the first run left nothing that still qualifies", async () => {
    const s = store();
    seedMixed(s);
    s.close();
    await run(["backfill-claims", "--apply", "--dir", dir], { io: consoleWith().io, env: { [ENV]: dir } });
    const mid = fingerprint(dir);

    const c = consoleWith();
    expect(await run(["backfill-claims", "--apply", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Authored memories with no claimed salience: 0");
    expect(fingerprint(dir)).toBe(mid);
  });
});

// ── repair-merged-beliefs ───────────────────────────────────────────────────

/**
 * THE REPAIR FOR PROBE H, and the owner-op door under it.
 *
 * The bug is fixed in `sleep/dedup.ts` as of the same night — a `type:
 * "schema"` row is no longer a dedup candidate at all — so this store cannot be
 * poisoned by running a real cycle any more. `merge()` below therefore does
 * exactly the four writes the pass used to do, in the same order, and the
 * fixture is the bug's OUTPUT rather than its mechanism. That is the honest
 * shape for a repair test: what has to be undone is the state, not the code
 * path that produced it.
 */
describe("repair-merged-beliefs — putting back the beliefs dedup ate", () => {
  const STATEMENT = "Ada prefers async review over a live walkthrough";

  /** `sleep/dedup.ts`'s merge, by hand: record, event, credit, archive. */
  function merge(s: Store, candidateId: string, originalId: string, day: number): void {
    const record = {
      event: "memory.merged",
      day,
      candidateId,
      originalId,
      reason: "identical-content-hash",
      usesDelta: 1,
    };
    s.setMeta(`sleep.merged.${candidateId}`, JSON.stringify(record));
    s.appendEvent({
      name: "memory.merged",
      day,
      ref: candidateId,
      dedupKey: `sleep.merged.${candidateId}`,
      payload: { ...record },
    });
    const p = s.physicsOf(originalId);
    s.updatePhysics(originalId, { uses: p.uses + 1 });
    s.archive(candidateId, "merged");
  }

  /** A belief eaten by a memory that says the same sentence. */
  // `beforeMerge` runs once the belief is live and before the merge archives
  // it — the one moment a test can measure "while live" now that `archive()`
  // deindexes for real (#64, on this tree).
  function poison(
    s: Store,
    beforeMerge?: (beliefId: string) => void,
  ): { entityId: string; beliefId: string; memoryId: string } {
    const sc = Schemas.open({ store: s });
    const entityId = sc.mention({
      name: "Ada",
      kind: "person",
      source: STATEMENT,
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const beliefId = sc.addBelief({
      entityId,
      statement: STATEMENT,
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    const memoryId = s.put({
      type: "memory",
      kind: "person",
      body: STATEMENT,
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    beforeMerge?.(beliefId);
    merge(s, beliefId, memoryId, 0);
    return { entityId, beliefId, memoryId };
  }

  test("the dry run names the belief, the entity, the memory and the day — and writes nothing", async () => {
    const s = store();
    const ids = poison(s);
    const before = fingerprint(dir);
    s.close();

    const c = consoleWith();
    const code = await run(["repair-merged-beliefs", "--dry-run"], { io: c.io, env: { [ENV]: dir } });
    expect(code).toBe(EXIT.ok);
    const out = text(c.out);
    expect(out).toContain("Beliefs and current-state rows archived as duplicates: 1");
    // WHICH STORE, before the list. `--dir` is optional and the default is the
    // owner's live memory; this is the command G23 asks them to type `--apply` at.
    expect(out).toContain(`Store: ${dir}`);
    expect(out).toContain(ids.beliefId);
    expect(out).toContain("Ada");
    expect(out).toContain("lived day 0");
    expect(out).toContain(ids.memoryId);
    expect(out).toContain(STATEMENT);
    expect(out).toContain("Dry run. Nothing has changed.");
    // Dry run is the default too, `--dry-run` or not.
    expect(fingerprint(dir)).toBe(before);
    const plain = consoleWith();
    expect(await run(["repair-merged-beliefs"], { io: plain.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(fingerprint(dir)).toBe(before);
  });

  test("--apply restores the belief, records the unmerge, and leaves the credit standing", async () => {
    const s = store();
    const ids = poison(s);
    const usesAfterMerge = s.physicsOf(ids.memoryId).uses;
    s.close();

    const c = consoleWith();
    expect(await run(["repair-merged-beliefs", "--apply", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    expect(text(c.out)).toContain("Put 1 elements back.");

    const after = store({ observer: true });
    expect(after.row(ids.beliefId)?.archived).toBe(0);
    expect(after.row(ids.beliefId)?.archived_reason).toBeNull();
    // It is a BELIEF again, which is the thing that was actually lost.
    const sc = Schemas.open({ store: after });
    expect(sc.beliefs(ids.entityId).map((b) => b.id)).toEqual([ids.beliefId]);

    // The credit STANDS, and the record says so rather than the code hoping so.
    expect(after.physicsOf(ids.memoryId).uses).toBe(usesAfterMerge);
    const logged = after.eventLog({ name: "memory.unmerged" });
    expect(logged.length).toBe(1);
    expect(logged[0]?.ref).toBe(ids.beliefId);
    const payload = JSON.parse(logged[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["originalId"]).toBe(ids.memoryId);
    expect(payload["usesDelta"]).toBe(1);
    expect(payload["mergedOnDay"]).toBe(0);
    // IDS AND NUMBERS ONLY (§5 G10). The console prints the statement and the
    // entity's name so the owner can decide; the DURABLE record carries neither,
    // and this is the assertion that keeps those two facts apart.
    expect(Object.keys(payload).sort()).toEqual(
      ["candidateId", "day", "event", "mergedOnDay", "originalId", "usesDelta"],
    );
    expect(logged[0]?.payload ?? "").not.toContain("Ada");
    expect(logged[0]?.payload ?? "").not.toContain("async review");

    // Constitution 7: the repair erases no history. The merge record and the
    // merge event are both exactly where they were.
    expect(after.getMeta(`sleep.merged.${ids.beliefId}`)).toContain(ids.memoryId);
    expect(after.eventLog({ name: "memory.merged" }).length).toBe(1);
  });

  test("a second --apply changes nothing and appends no second record", async () => {
    const s = store();
    poison(s);
    s.close();
    await run(["repair-merged-beliefs", "--apply", "--dir", dir], { io: consoleWith().io, env: { [ENV]: dir } });
    const mid = fingerprint(dir);

    const c = consoleWith();
    expect(await run(["repair-merged-beliefs", "--apply", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    expect(text(c.out)).toContain("Beliefs and current-state rows archived as duplicates: 0");
    expect(text(c.out)).toContain("[already live]");
    expect(fingerprint(dir)).toBe(mid);
    const after = store({ observer: true });
    expect(after.eventLog({ name: "memory.unmerged" }).length).toBe(1);
  });

  test("a store with nothing to repair says so, and an absent store is not created", async () => {
    const s = store();
    s.put({ type: "memory", kind: "fact", body: "An ordinary memory nobody merged." });
    s.close();
    const c = consoleWith();
    expect(await run(["repair-merged-beliefs"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Beliefs and current-state rows archived as duplicates: 0");
    expect(text(c.out)).toContain("Dry run. Nothing to repair on this store.");

    const missing = join(outside, "no-store-for-repair");
    const c2 = consoleWith();
    expect(await run(["repair-merged-beliefs", "--dir", missing], { io: c2.io, env: {} })).toBe(
      EXIT.failed,
    );
    expect(existsSync(missing)).toBe(false);
  });

  test("the repair is an owner operation: an instrument refuses it, plan and all", async () => {
    const s = store();
    poison(s);
    const before = fingerprint(dir);
    s.close();
    const c = consoleWith();
    expect(
      await run(["repair-merged-beliefs", "--observer"], { io: c.io, env: { [ENV]: dir } }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("owner operation");
    expect(fingerprint(dir)).toBe(before);
  });

  test("the door undoes ONE archive reason and refuses every other by name", () => {
    // The reason this is not a general `unarchive`: a prune, a revision and a
    // removal are all archived, and each is archived for a reason a repair
    // tool has no business reversing.
    const s = store();
    const pruned = s.put({ type: "memory", kind: "fact", body: "A memory let go at the floor." });
    s.archive(pruned, "pruned");
    expect(() => unarchiveMerged(s, pruned)).toThrow(/UNMERGE_NOT_A_MERGE/);
    expect(s.row(pruned)?.archived).toBe(1);

    // A superseded row: restoring it would put two live versions in one chain.
    const target = s.put({ type: "memory", kind: "fact", body: "A belief about the weather." });
    s.supersede(
      target,
      { type: "memory", kind: "fact", body: "A better belief about the weather." },
      "revised-by-pressure",
    );
    expect(() => unarchiveMerged(s, target)).toThrow(/UNMERGE_SUPERSEDED/);

    expect(() => unarchiveMerged(s, "mem_000000000000")).toThrow(/ID_UNKNOWN/);

    // And a merge is restored — the one case it accepts.
    const original = s.put({ type: "memory", kind: "fact", body: "One sentence, noted twice." });
    const duplicate = s.put({
      id: "mem_ffffffffffff",
      type: "memory",
      kind: "fact",
      body: "One sentence, noted twice.",
    });
    s.archive(duplicate, "merged");
    const report = unarchiveMerged(s, duplicate);
    expect(report.noop).toBe(false);
    expect(s.row(duplicate)?.archived).toBe(0);
    // No merge event existed, so the record says so instead of inventing one.
    expect(report.record.originalId).toBeNull();
    expect(report.record.usesDelta).toBeNull();
    expect(original).not.toBe(duplicate);

    // A LIVE row is a no-op that records NOTHING. A `memory.unmerged` row here
    // would read "the owner put this back" about a restore that never
    // happened, and the door has to be honest without the CLI's help.
    const live = s.put({ type: "memory", kind: "fact", body: "A memory nobody merged." });
    const before = s.eventLog({ name: "memory.unmerged" }).length;
    expect(unarchiveMerged(s, live).noop).toBe(true);
    expect(s.eventLog({ name: "memory.unmerged" }).length).toBe(before);
  });

  test("a restored belief is FINDABLE again, even when the archive deindexed it", async () => {
    // The cross-PR hazard, made a test rather than a hope. `archive()` leaves
    // box 3 alone on master today, but PR #64 (`overnight/df-live-rows`) adds
    // `deindexDoc` to it so document frequency is counted over live rows —
    // and then a restore that touched only box 2 would put back a row that is
    // live, listed in `beliefs(entity)`, and invisible to lexical recall, with
    // no cheap repair (a rebuild without an embedder drops every vector).
    //
    // On the batch tree #64 IS merged, so the deindex is no longer simulated:
    // the live count is taken before the merge archives the belief, and the
    // zero after it is asserted rather than produced by hand.
    const tokensFor = (id: string): number => {
      const box3 = openDb(paths.cache(dir));
      try {
        return (
          box3.get<{ n: number }>("SELECT COUNT(*) AS n FROM doc_tokens WHERE memory_id = ?", id)?.n ??
          0
        );
      } finally {
        box3.close();
      }
    };
    const s = store();
    let indexedWhileLive = 0;
    const ids = poison(s, (beliefId) => {
      indexedWhileLive = tokensFor(beliefId);
    });
    s.close();
    expect(indexedWhileLive).toBeGreaterThan(0);
    // The archive took the rows out of the text index (I13) — the hazard is real.
    expect(tokensFor(ids.beliefId)).toBe(0);

    expect(
      await run(["repair-merged-beliefs", "--apply", "--dir", dir], { io: consoleWith().io, env: { [ENV]: dir } }),
    ).toBe(EXIT.ok);

    const after = store({ observer: true });
    // Box 3 holds the row's tokens again, and exactly as many as it did.
    expect(tokensFor(ids.beliefId)).toBe(indexedWhileLive);
    // The property, not the table: the cue finds it.
    expect(after.search("walkthrough async review").map((h) => h.id)).toContain(ids.beliefId);
    after.close();

    // And through the door the owner actually uses.
    const r = consoleWith();
    expect(await run(["recall", "what does Ada prefer for review?", "--dir", dir], { io: r.io })).toBe(
      EXIT.ok,
    );
    expect(text(r.out)).toContain("prefers async review");
  });

  test("the restore never touches an embedding it cannot recompute", () => {
    // A repair that made a paid embedding call, or dropped a vector nothing in
    // this process can recompute, would be a worse bug than the one it fixes.
    // `reindexLexical` hands `indexDoc` no vector, and `indexDoc` writes the
    // `embeddings` table only when it is handed one.
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "A memory with a vector of its own." });
    const cache = openCache(paths.cache(dir));
    setEmbedding(cache, id, [0.5, 0.25, 0.125]);
    cache.close();
    s.archive(id, "merged");

    unarchiveMerged(s, id);

    const box3 = openDb(paths.cache(dir));
    const row = box3.get<{ dim: number; vec: string | Uint8Array }>(
      "SELECT dim, vec FROM embeddings WHERE memory_id = ?",
      id,
    );
    box3.close();
    expect(row?.dim).toBe(3);
    // Read through the cache's own decoder: box 3 stores float32 BLOBs (#66,
    // on this tree), and these three values are float32-exact.
    expect(Array.from(decodeVector(row?.vec ?? "[]"))).toEqual([0.5, 0.25, 0.125]);
  });

  test("a belief restored and later revised is not offered again — the run stays green", async () => {
    // The sequence the owner hits by running this twice across weeks: merged,
    // restored, then legitimately revised (archived `revised`, with a
    // successor). Listing it as an open target would make the seam refuse with
    // UNMERGE_SUPERSEDED and the whole run exit FAILED on a store where
    // nothing is wrong.
    const s = store();
    const ids = poison(s);
    s.close();
    await run(["repair-merged-beliefs", "--apply", "--dir", dir], { io: consoleWith().io, env: { [ENV]: dir } });

    const writable = store();
    const sc = Schemas.open({ store: writable });
    const challengerId = writable.put({
      type: "memory",
      kind: "person",
      body: "Ada asked for a live walkthrough instead",
      meta: { updates: ids.beliefId },
      salience: { novelty: null, relevance: 0.9, emotional: 0.9, predictive: 0.9 },
      physics: { birthDay: 1, lastUsedDay: 1 },
    });
    for (const day of [1, 2, 3]) {
      applyRevision(writable, sc, { updates: ids.beliefId, challengerId, day, method: "declared" }, {});
    }
    expect(writable.row(ids.beliefId)?.superseded_by).not.toBeNull();
    writable.close();

    const c = consoleWith();
    expect(await run(["repair-merged-beliefs", "--apply", "--dir", dir], { io: c.io, env: { [ENV]: dir } })).toBe(
      EXIT.ok,
    );
    expect(text(c.err)).not.toContain("FAILED");
    expect(text(c.out)).not.toContain(ids.beliefId);
  });

  test("an instrument may not unarchive either — the seam crosses the same stance check", () => {
    const writable = store();
    const id = writable.put({ type: "memory", kind: "fact", body: "A merged duplicate." });
    writable.archive(id, "merged");
    writable.close();
    const reader = store({ observer: true });
    expect(() => unarchiveMerged(reader, id)).toThrow(/OBSERVER_REFUSED/);
    expect(reader.row(id)?.archived).toBe(1);
  });
});

// ── stance ──────────────────────────────────────────────────────────────────

describe("rebrief — the owner's out-of-band wake re-render", () => {
  /** An identity element with an explicit encode date, so the wake can show it. */
  function element(s: Store, body: string, learnedOn: string): string {
    return s.put({
      type: "memory",
      kind: "self",
      body,
      band: "identity",
      salience: { relevance: 0.9, emotional: 0.5, predictive: 0.5 },
      physics: { promotedIdentity: true },
      learnedOn,
    });
  }

  /** Every sleep marker, so "no marker moved" is checkable rather than asserted. */
  function markers(s: Store): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const phase of PHASES) out[phase] = s.getMeta(markerKey(phase));
    return out;
  }

  test("republishes the bundle NOW, prints the lane counts and bytes, and moves no marker", async () => {
    const s = store();
    element(s, "The credential fix sits uncommitted pending review.", "2026-07-26");
    element(s, "The parallel run started this morning.", "2026-09-04");
    s.put({
      type: "memory",
      kind: "skill",
      body: "I read the whole file before editing one line of it.",
      salience: { relevance: 1, emotional: 1, predictive: 1 },
      learnedOn: "2026-08-14",
    });
    for (const phase of PHASES) s.setMeta(markerKey(phase), "7");
    const before = markers(s);
    const day = s.livedDay();
    expect(s.getMeta(BRIEFING_KEY)).toBeUndefined();
    s.close();

    const c = consoleWith();
    const code = await run(["rebrief", "--budget", "9000"], {
      io: c.io,
      env: { [ENV]: dir },
      home: join(outside, "rebrief-home"),
    });
    const printed = text(c.out);

    expect(code).toBe(EXIT.ok);
    expect(printed).toContain("Re-rendered the wake bundle");
    expect(printed).toContain("identity 2");
    expect(printed).toContain("craft 1");
    expect(printed).toContain("elements 3");
    expect(printed).toContain("budget 9000 bytes from --budget");
    expect(printed).toContain("published");

    const after = store({ observer: true });
    const bundle = after.getMeta(BRIEFING_KEY) ?? "";
    // The bundle is really there, and every element in it carries its date.
    expect(bundle).toContain("- 2026-07-26 · The credential fix sits uncommitted pending review.");
    expect(bundle).toContain("- 2026-09-04 · The parallel run started this morning.");
    expect(bundle).toContain("- 2026-08-14 · I read the whole file before editing one line of it.");
    expect(readSentinel(bundle).intact).toBe(true);
    // The preface's room is reserved exactly as `sessionEnd` reserves it, so the
    // first delivered line cannot blow the host's ceiling.
    expect(byteLength(bundle)).toBeLessThanOrEqual(9000 - PREFACE_RESERVE_BYTES);
    expect(printed).toContain(`bytes ${byteLength(bundle)}`);

    // NOT a sleep cycle: no marker advanced, and the day did not move.
    expect(markers(after)).toEqual(before);
    expect(after.livedDay()).toBe(day);
  });

  test("without a ceiling it refuses and names both ways to give it one (§2.18)", async () => {
    store().close();
    const c = consoleWith();
    // A throwaway home: with no ceiling beside the store, `hostCeiling` falls
    // back to the hooks' own `~/.counterparts/claude-code.json`, and a test that
    // used the real one would be reading the owner's live configuration.
    const code = await run(["rebrief"], {
      io: c.io,
      env: { [ENV]: dir },
      home: join(outside, "rebrief-home"),
    });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("no injection ceiling");
    expect(text(c.err)).toContain("--budget");
    expect(text(c.err)).toContain("injectionBudgetBytes");
    expect(store({ observer: true }).getMeta(BRIEFING_KEY)).toBeUndefined();
  });

  test("the host config BESIDE the store supplies the ceiling when no flag does", async () => {
    // The deployed shape (measured 2026-09-03): the config cannot live INSIDE
    // the data dir — the layout totality check refuses an unclassified file
    // there — so it sits beside it and `dataDir` names the subdirectory.
    const inner = join(dir, "store");
    const s = Store.open({ dir: inner });
    open.push(s);
    element(s, "Something true about how I work.", "2026-08-01");
    s.close();
    const config = join(dir, "claude-code.json");
    writeFileSync(config, JSON.stringify({ dataDir: inner, injectionBudgetBytes: 4096 }));

    const c = consoleWith();
    const code = await run(["rebrief", "--dir", inner], {
      io: c.io,
      env: { [ENV]: dir },
      home: join(outside, "rebrief-home"),
    });
    expect(c.err).toEqual([]);
    expect(code).toBe(EXIT.ok);
    expect(text(c.out)).toContain(`budget 4096 bytes from ${config}`);
    expect(text(c.out)).toContain("claude-code.json");

    const after = Store.open({ dir: inner, observer: true });
    open.push(after);
    expect(byteLength(after.getMeta(BRIEFING_KEY) ?? "")).toBeLessThanOrEqual(
      4096 - PREFACE_RESERVE_BYTES,
    );
  });

  test("the lookup order is flag, then beside the store, then the hooks' own config — and it SAYS which", async () => {
    // The finding this pins (cold-stranger review 2026-09-04, issue 3): a
    // stranger ran `rebrief --dir <scratch>` and it composed under a ceiling
    // read out of `~/.counterparts/claude-code.json` — a file outside the
    // directory they had named — while the page claimed in bold that no console
    // command reads that file at all. The fallback is legitimate; the silence
    // was not. Every branch below asserts the PRINTED source, not just the number.
    const home = join(outside, "order-home");
    const hooksConfig = join(home, ".counterparts", "claude-code.json");
    mkdirSync(join(home, ".counterparts"), { recursive: true });
    const inner = join(dir, "store");
    const beside = join(dir, "claude-code.json");
    const s = Store.open({ dir: inner });
    open.push(s);
    element(s, "Something true about how I work.", "2026-08-01");
    s.close();

    // (3) only the hooks' config exists: the fallback answers, and names itself.
    writeFileSync(hooksConfig, JSON.stringify({ dataDir: inner, injectionBudgetBytes: 7000 }));
    const fallback = consoleWith();
    expect(await run(["rebrief", "--dir", inner], { io: fallback.io, env: {}, home })).toBe(EXIT.ok);
    expect(text(fallback.out)).toContain(`budget 7000 bytes from ${hooksConfig}`);

    // (2) a config beside the store WINS over the hooks' config.
    writeFileSync(beside, JSON.stringify({ dataDir: inner, injectionBudgetBytes: 4096 }));
    const nearer = consoleWith();
    expect(await run(["rebrief", "--dir", inner], { io: nearer.io, env: {}, home })).toBe(EXIT.ok);
    expect(text(nearer.out)).toContain(`budget 4096 bytes from ${beside}`);
    expect(text(nearer.out)).not.toContain(hooksConfig);

    // (1) the flag beats both, and reads no file at all.
    const flagged = consoleWith();
    expect(
      await run(["rebrief", "--dir", inner, "--budget", "5000"], { io: flagged.io, env: {}, home }),
    ).toBe(EXIT.ok);
    expect(text(flagged.out)).toContain("budget 5000 bytes from --budget");
    expect(text(flagged.out)).not.toContain("claude-code.json");

    // NEVER inside the data dir. A config there fails the layout check and the
    // store stops opening, so it is not a place this lookup may find one.
    rmSync(beside);
    rmSync(hooksConfig);
    writeFileSync(join(inner, "claude-code.json"), JSON.stringify({ injectionBudgetBytes: 1234 }));
    const inside = consoleWith();
    expect(await run(["rebrief", "--dir", inner], { io: inside.io, env: {}, home })).toBe(
      EXIT.refused,
    );
    expect(text(inside.err)).toContain("no injection ceiling");
    // And the refusal names EVERY place it looked, in order, so "where should I
    // put it" is answered by the failure itself.
    expect(text(inside.err)).toContain(join(dir, "claude-code.json"));
    expect(text(inside.err)).toContain(hooksConfig);
    rmSync(join(inner, "claude-code.json"));
  });

  test("under observer it refuses and publishes nothing — an instrument makes no content write", async () => {
    const s = store();
    element(s, "Something true about how I work.", "2026-08-01");
    s.close();

    const c = consoleWith();
    const code = await run(["rebrief", "--budget", "9000", "--observer"], {
      io: c.io,
      env: { [ENV]: dir },
    });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("observer stance");
    expect(store({ observer: true }).getMeta(BRIEFING_KEY)).toBeUndefined();
  });
});

// ── observer ────────────────────────────────────────────────────────────────

describe("owner operations never run under observer", () => {
  test("every owner op refuses, and says which stance refused it", async () => {
    store().close();
    for (const command of OWNER_OPS) {
      const c = consoleWith();
      // Only flags every command declares: the stance refusal precedes each
      // command's own arguments, and since 2026-09-04 an undeclared flag is
      // itself a refusal, so passing `--out` to `note` would test that instead.
      const code = await run([command, "--observer", "x"], {
        io: c.io,
        env: { [ENV]: dir },
      });
      expect(code).toBe(EXIT.refused);
      expect(text(c.err)).toContain("observer stance");
    }
  });

  test("status still works under observer — an instrument may read", async () => {
    store().close();
    const c = consoleWith();
    expect(await run(["status", "--observer"], { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Memories:");
  });

  test("the environment can stand the console down too, not only the flag", async () => {
    store().close();
    const c = consoleWith();
    const code = await run(["backup", "--out", outside], {
      io: c.io,
      env: { [ENV]: dir, COUNTERPARTS_OBSERVER: "1" },
    });
    expect(code).toBe(EXIT.refused);
  });

  /**
   * G39, the console's half. The variable used to be matched here by exact,
   * untrimmed string — `"1"` or `"true"` — while the explicit-dir guard one
   * directory over took `1|true|on`, trimmed and case-insensitive, and
   * `store/paths.ts` described itself as "a SUPERSET of the two
   * `COUNTERPARTS_OBSERVER` accepts". A person reasoning from that sentence and
   * exporting `=on` got an OWNER console: `backup`, `export`, `remove` all
   * reachable, from a shell they believed was an instrument.
   */
  test("COUNTERPARTS_OBSERVER=on stands the console down — the guard's whole vocabulary (G39)", async () => {
    store().close();
    for (const value of ["on", "ON", "True", " 1 ", "\ttrue "]) {
      const c = consoleWith();
      const code = await run(["backup", "--out", outside], {
        io: c.io,
        env: { [ENV]: dir, COUNTERPARTS_OBSERVER: value },
      });
      expect(`${JSON.stringify(value)} → ${code}`).toBe(`${JSON.stringify(value)} → ${EXIT.refused}`);
      expect(text(c.err)).toContain("observer stance");
    }
    // OFF means off — a stood-down variable does not stand the console down,
    // exactly as an absent one does not (the #80 owner ruling, same words).
    for (const value of ["0", "off", "FALSE", ""]) {
      const c = consoleWith();
      const code = await run(["status"], { io: c.io, env: { [ENV]: dir, COUNTERPARTS_OBSERVER: value } });
      expect(`${JSON.stringify(value)} → ${code}`).toBe(`${JSON.stringify(value)} → ${EXIT.ok}`);
    }
  });

  test("a value the console cannot read STANDS DOWN, and names itself doing it (G5)", async () => {
    // Fail toward standing down (`docs/observer-mode.md` G5), NOT toward the
    // guard's refusal: a stood-down console still answers every read, so it is
    // the cheaper failure, and the line on stderr is what keeps it from being a
    // silent one. `status` proves the read still works; `backup` proves the
    // owner operation does not.
    store().close();
    const reads = consoleWith();
    expect(await run(["status"], { io: reads.io, env: { [ENV]: dir, COUNTERPARTS_OBSERVER: "yes" } })).toBe(
      EXIT.ok,
    );
    expect(text(reads.err)).toContain("COUNTERPARTS_OBSERVER is set to 'yes'");
    expect(text(reads.err)).toContain("standing down to observer stance");
    expect(text(reads.err)).toContain("1, true, on");

    const writes = consoleWith();
    expect(
      await run(["backup", "--out", outside], {
        io: writes.io,
        env: { [ENV]: dir, COUNTERPARTS_OBSERVER: "yes" },
      }),
    ).toBe(EXIT.refused);
    expect(text(writes.err)).toContain("observer stance");
  });
});

// ── the import graph ────────────────────────────────────────────────────────

describe("the destruction path is importable from this directory only", () => {
  test("no core module, no other adapter, and no test but this one imports removal.ts", () => {
    const root = join(import.meta.dir, "..", "src");
    const offenders: string[] = [];
    const walk = (path: string): void => {
      for (const name of readdirSync(path)) {
        const full = join(path, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith(".ts")) continue;
        const body = readFileSync(full, "utf8");
        if (!body.includes("removal.js") && !body.includes("removal.ts")) continue;
        if (full.includes(join("adapters", "cli"))) continue;
        offenders.push(full);
      }
    };
    walk(root);
    // §16 G2, earned-mechanism #14: THIS TEST FAILING IS THE POINT.
    expect(offenders).toEqual([]);
  });

  test("the seam's CHASE is imported by this directory only — a type import is not a caller", () => {
    const root = join(import.meta.dir, "..", "src");
    const offenders: string[] = [];
    const walk = (path: string): void => {
      for (const name of readdirSync(path)) {
        const full = join(path, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith(".ts")) continue;
        const body = readFileSync(full, "utf8");
        // A VALUE import of the seam. `export type { … } from "./owner-op-seam.js"`
        // and `import type { … }` are erased at runtime and reach no function.
        for (const line of body.split("\n")) {
          if (!/from\s+"[^"]*owner-op-seam\.js"/.test(line)) continue;
          if (/^\s*(?:import|export)\s+type\b/.test(line)) continue;
          if (full.includes(join("adapters", "cli"))) continue;
          // Store's constructor HANDS the capability over; it never calls the
          // chase, and the test below pins that it re-exports no such name.
          if (full.endsWith(join("core", "store", "index.ts"))) continue;
          offenders.push(`${full}: ${line.trim()}`);
        }
        // A multi-line import block hides the module name from the line scan.
        if (
          /import\s*\{[^}]*\}\s*from\s+"[^"]*owner-op-seam\.js"/s.test(body) &&
          !full.includes(join("adapters", "cli")) &&
          !full.endsWith(join("core", "store", "index.ts")) &&
          !/import\s+type\s*\{[^}]*\}\s*from\s+"[^"]*owner-op-seam\.js"/s.test(body)
        ) {
          offenders.push(`${full}: multi-line value import`);
        }
      }
    };
    walk(root);
    // §16 G2 again, for the half that landed on 2026-08-25.
    expect(offenders).toEqual([]);
  });

  /**
   * EVERY WAY A FILE CAN REACH A MODULE, for the seam pins below (PR #189
   * re-review, N1): `from "…"` and `from '…'` (an `import` or an `export … from`),
   * a dynamic `import("…")`, and `require("…")`. Type-only imports carry no code
   * and are not counted. Returns `file: line` for every hit whose file is not
   * allowed.
   */
  function seamImporters(
    root: string,
    module: string,
    allowed: (full: string) => boolean,
  ): { offenders: string[]; allowedHits: string[] } {
    const esc = module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const spec = `["'][^"'\\n]*\\/${esc}["']`;
    const reach = new RegExp(`(?:\\bfrom\\s+${spec}|\\bimport\\s*\\(\\s*${spec}|\\brequire\\s*\\(\\s*${spec})`);
    const offenders: string[] = [];
    const allowedHits: string[] = [];
    const walk = (path: string): void => {
      for (const name of readdirSync(path)) {
        const full = join(path, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith(".ts")) continue;
        if (full.endsWith(join("remember", module.replace(/\.js$/, ".ts")))) continue;
        const body = readFileSync(full, "utf8");
        for (const line of body.split("\n")) {
          if (!reach.test(line)) continue;
          if (/^\s*(?:import|export)\s+type\b/.test(line)) continue;
          if (allowed(full)) allowedHits.push(full);
          else offenders.push(`${full}: ${line.trim()}`);
        }
      }
    };
    walk(root);
    return { offenders, allowedHits };
  }

  const SRC = join(import.meta.dir, "..", "src");
  const STRIKE_ALLOWED = (full: string): boolean =>
    full.includes(join("adapters", "cli")) ||
    full.endsWith(join("core", "remember", "spans.ts")) ||
    full.endsWith(join("core", "remember", "retention.ts"));
  const RETENTION_ALLOWED = (full: string): boolean =>
    full.endsWith(join("adapters", "claude-code", "bin", "runner.ts"));
  /** `remember/` itself (the grantor), and the TWO paths that may mark a
   *  session written up (roadmap C2, built 2026-09-23): the next-session
   *  write-up's door, and the worker whose opt-in API sweep marks a crashed
   *  session it has finished with (`by: "api"`). */
  const WRITE_UP_C2_DOOR = join("adapters", "mcp", "write-up.ts");
  const WRITE_UP_SWEEP = join("adapters", "claude-code", "bin", "runner.ts");
  const WRITE_UP_ALLOWED = (full: string): boolean =>
    full.includes(join("core", "remember") + "/") || full.endsWith(WRITE_UP_C2_DOOR) || full.endsWith(WRITE_UP_SWEEP);

  test("the buffer's STRIKE is imported by this directory and its own grantor only", () => {
    // The same pin as the box-2 chase, for the seam that landed 2026-09-05.
    // THREE files in `src/` may reach `remember/owner-strike-seam.ts`:
    // `remember/spans.ts`, which HANDS OVER the capability in its constructor
    // and never calls the strike; `adapters/cli/removal.ts`, the owner's
    // destruction path; and — since 2026-09-23, a DECISION and not an import —
    // `remember/retention.ts`, the deleting half of the 7-day rule the owner
    // set. That third file is itself pinned below: `remember/index.ts` does not
    // re-export it and only the background worker imports it (PR #189 review,
    // B1 — an index export once let anything holding a `Counterpart` delete
    // spans with facts of its own making). So a `Counterpart` — which the MCP
    // server holds, and a model talks to — holds a `SpanBuffer` and reaches the
    // strike by neither road (§16 G2, and `store/owner-op-seam.ts`'s own
    // reasoning).
    expect(seamImporters(SRC, "owner-strike-seam.js", STRIKE_ALLOWED).offenders).toEqual([]);
  });

  test("the RETENTION delete is imported by the background worker only, and no index re-exports it", async () => {
    // `remember/retention.ts#pruneRetention` takes a buffer and a set of facts
    // and deletes through the strike. Reached through `remember/index.ts` —
    // which the MCP server and the hooks import — it let any holder of the
    // public `Counterpart.spans` delete a session that owed a write-up by
    // handing it facts that said otherwise (PR #189 review, B1). ONE file in
    // `src/` may import it: the worker that runs the once-a-date pass.
    const { offenders, allowedHits } = seamImporters(SRC, "retention.js", RETENTION_ALLOWED);
    expect(offenders).toEqual([]);
    // NOT VACUOUS: the worker really does import it.
    expect(allowedHits.length).toBe(1);
    const index = readFileSync(join(SRC, "core", "remember", "index.ts"), "utf8");
    expect(/["']\.\/retention\.js["']/.test(index)).toBe(false);
    const exported = Object.keys(await import("../src/core/remember/index.js"));
    expect(exported).not.toContain("pruneRetention");
    expect(exported).not.toContain("strikeSpans");
  });

  test("the WRITE-UP mark is reached from remember/, the C2 door and the worker's sweep only, and no index re-exports it", async () => {
    // `remember/write-up-seam.ts#recordWriteUp` ends a session's debt, which
    // makes its text deletable 7 days later — a deletion on a fuse. It was a
    // public `SpanBuffer` method, so everything holding a `Counterpart` could
    // light it (PR #189 re-review, R1). Now it is a grant, like the strike:
    // `remember/spans.ts` hands it over, and the only other files that may
    // import it are the next-session write-up's door (roadmap C2,
    // `adapters/mcp/write-up.ts`) and the worker whose opt-in API sweep marks
    // what it swept (`adapters/claude-code/bin/runner.ts`, `by: "api"`).
    const { offenders, allowedHits } = seamImporters(SRC, "write-up-seam.js", WRITE_UP_ALLOWED);
    expect(offenders).toEqual([]);
    // NOT VACUOUS: the grantor imports it, and so do the door and the sweep.
    expect(allowedHits.some((f) => f.endsWith(join("core", "remember", "spans.ts")))).toBe(true);
    expect(allowedHits.some((f) => f.endsWith(WRITE_UP_C2_DOOR))).toBe(true);
    expect(allowedHits.some((f) => f.endsWith(WRITE_UP_SWEEP))).toBe(true);
    const index = readFileSync(join(SRC, "core", "remember", "index.ts"), "utf8");
    expect(/["']\.\/write-up-seam\.js["']/.test(index)).toBe(false);
    const exported = Object.keys(await import("../src/core/remember/index.js"));
    expect(exported).not.toContain("recordWriteUp");
    expect(exported).not.toContain("grantWriteUp");
  });

  test("the pins CATCH a stray importer — double quotes, single quotes, a dynamic import(), a require()", () => {
    // Proved against a scratch tree rather than trusted: each module a stray
    // file might use to reach a seam, in every spelling the scanner claims to see.
    const scratch = mkdtempSync(join(tmpdir(), "counterparts-pin-"));
    try {
      const stray = join(scratch, "core", "self");
      mkdirSync(stray, { recursive: true });
      const spellings = (module: string): string[] => [
        `import { x } from "../remember/${module}";`,
        `import { x } from '../remember/${module}';`,
        `export * from "../remember/${module}";`,
        `const m = await import("../remember/${module}");`,
        `const m = await import('../remember/${module}');`,
        `const m = require("../remember/${module}");`,
      ];
      const pins: [string, (full: string) => boolean][] = [
        ["owner-strike-seam.js", STRIKE_ALLOWED],
        ["retention.js", RETENTION_ALLOWED],
        ["write-up-seam.js", WRITE_UP_ALLOWED],
      ];
      for (const [module, allowed] of pins) {
        const lines = spellings(module);
        lines.forEach((line, i) => writeFileSync(join(stray, `stray-${module}-${String(i)}.ts`), `${line}\n`, "utf8"));
        const { offenders } = seamImporters(scratch, module, allowed);
        expect({ module, caught: offenders.length }).toEqual({ module, caught: lines.length });
        // ...and a TYPE-only import is not a reach.
        writeFileSync(join(stray, `typed-${module}.ts`), `import type { X } from "../remember/${module}";\n`, "utf8");
        expect(seamImporters(scratch, module, allowed).offenders.length).toBe(lines.length);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("the WALKING read is imported by two files, and is on no class anyone holds", () => {
    // `store/walk-seam.ts` skips the archived-read telemetry AND the deny-list,
    // so it is deliberately not a `Store` method: `Counterpart.store` is public,
    // and a method beside `read` would hand every adapter a removal bypass it
    // did not ask for (§16 G2, the same reasoning as `chaseRemoved` above).
    // TWO files may reach it — the index build and the repair plan — and the
    // list is short on purpose. Adding a third is a decision, not an import.
    const ALLOWED = [
      join("core", "schemas", "index.ts"),
      join("adapters", "cli", "commands.ts"),
    ];
    const root = join(import.meta.dir, "..", "src");
    const offenders: string[] = [];
    const walk = (path: string): void => {
      for (const name of readdirSync(path)) {
        const full = join(path, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith(".ts")) continue;
        if (full.endsWith(join("core", "store", "walk-seam.ts"))) continue;
        const body = readFileSync(full, "utf8");
        if (!/walk-seam\.js/.test(body)) continue;
        if (ALLOWED.some((suffix) => full.endsWith(suffix))) continue;
        offenders.push(full);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
    // NOT VACUOUS: both allowed files really do import it, so this cannot pass
    // because the seam went away.
    for (const suffix of ALLOWED) {
      const body = readFileSync(join(root, suffix), "utf8");
      expect(`${suffix} imports the seam: ${/walk-seam\.js/.test(body)}`).toBe(
        `${suffix} imports the seam: true`,
      );
    }
    // And it is not re-exported from the store's index, so `import { … } from
    // "../store/index.js"` cannot reach it either.
    const index = readFileSync(join(import.meta.dir, "..", "src/core/store/index.ts"), "utf8");
    expect(index).not.toContain("walk-seam");
    expect(index).not.toContain("readProseWalking");
  });

  test("the strike is not re-exported from remember's index either", () => {
    const index = readFileSync(join(import.meta.dir, "..", "src/core/remember/index.ts"), "utf8");
    expect(index).not.toContain("owner-strike-seam");
  });

  test("the destruction path is not even re-exported from the adapter's index", () => {
    const index = readFileSync(join(import.meta.dir, "..", "src/adapters/cli/index.ts"), "utf8");
    expect(index).not.toContain('from "./removal.js"');
  });

  test("the core imports nothing from adapters/cli", () => {
    const root = join(import.meta.dir, "..", "src", "core");
    const offenders: string[] = [];
    const walk = (path: string): void => {
      for (const name of readdirSync(path)) {
        const full = join(path, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        // An IMPORT, not a mention: `store/owner-op-seam.ts` names this adapter
        // in prose (it is the seam's other half) and that is documentation, not
        // a dependency.
        if (name.endsWith(".ts") && /from\s+"[^"]*adapters\/cli/.test(readFileSync(full, "utf8"))) {
          offenders.push(full);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  test("no egress: neither adapter opens a socket, and export is the only way out", () => {
    const roots = ["src/adapters/cli", "src/adapters/mcp"];
    const offenders: string[] = [];
    for (const root of roots) {
      const base = join(import.meta.dir, "..", root);
      const walk = (path: string): void => {
        for (const name of readdirSync(path)) {
          const full = join(path, name);
          if (statSync(full).isDirectory()) {
            walk(full);
            continue;
          }
          if (!name.endsWith(".ts")) continue;
          const body = readFileSync(full, "utf8");
          for (const shape of ["fetch(", "node:http", "node:https", "node:net", "WebSocket"]) {
            if (body.includes(shape)) offenders.push(`${full}: ${shape}`);
          }
        }
      };
      walk(base);
    }
    expect(offenders).toEqual([]);
  });
});

// ── the console's own shape ─────────────────────────────────────────────────

describe("usage", () => {
  test("--help is an answered question, and so is a bare invocation — both exit 0", async () => {
    // Two commands apart in a stranger's first minute, and they used to share
    // the failing code: `counterparts --help` set $? to 1 and any `set -e`
    // wrapper died on the help text. `--help` was fixed then; the BARE call
    // stayed a usage error, on the reasoning that an invocation naming nothing
    // is a mistake. On 2026-09-22 the owner gave it a job — it is QUICKSTART's
    // step 2, the thing a person types straight after installing — so a
    // documented step that exits 1 is the same `set -e` trap one door along.
    const helped = consoleWith();
    expect(await run(["--help"], { io: helped.io })).toBe(EXIT.ok);
    expect(text(helped.out)).toContain("counterparts — a memory layer for AI");

    const bare = consoleWith();
    expect(await run([], { io: bare.io })).toBe(EXIT.ok);
    expect(text(bare.out)).toContain("counterparts — a memory layer for AI");
    // Off a terminal — which every test console is — it names the command that
    // sets it up, and asks nothing. The install loop runs QUICKSTART's commands
    // with no terminal and this one must never block there.
    expect(text(bare.out)).toContain("counterparts install");

    const perCommand = consoleWith();
    expect(await run(["status", "--help"], { io: perCommand.io })).toBe(EXIT.ok);
  });

  /**
   * `counterparts <command> --help` ANSWERS THE QUESTION IT WAS ASKED.
   *
   * It printed the whole console's usage, so the flags a command actually takes
   * were listed nowhere a person could ask for them — the only surface that
   * knew was the refusal you got AFTER typing one wrong (cold-stranger review,
   * 2026-09-04, #9). The table that refusal reads is the table this prints, so
   * this walks every command and holds the two to each other.
   */
  test("every command's own --help lists exactly the flags that command takes", async () => {
    for (const command of COMMANDS) {
      const c = consoleWith();
      expect(await run([command, "--help"], { io: c.io })).toBe(EXIT.ok);
      const said = text(c.out);
      // It is about THIS command, and it says what the command is for.
      expect(said.startsWith(`counterparts ${command} — `)).toBe(true);
      expect(said).toContain(COMMAND_BLURB[command]);

      // Every flag it takes is listed — with a sentence, not as a bare name.
      for (const flag of [...COMMAND_FLAGS[command], ...COMMON_FLAGS]) {
        expect(said).toContain(`--${flag}`);
        expect(said).not.toContain(`--${flag} `.padEnd(21) + "(undocumented)");
      }
      expect(said).not.toContain("(undocumented)");

      // And no flag it would REFUSE. `unknownFlag` is the authority on that, so
      // ask it rather than keeping a second list here.
      for (const other of COMMANDS) {
        for (const flag of COMMAND_FLAGS[other]) {
          if (COMMAND_FLAGS[command].includes(flag) || COMMON_FLAGS.includes(flag)) continue;
          expect(unknownFlag(command, [`--${flag}`])).not.toBeNull();
          expect(said).not.toContain(`--${flag}`);
        }
      }

      // Nothing was opened: a help page is a read of a table, not of a store.
      expect(text(c.err)).toBe("");
    }

    // The same page, reachable as a pure function for anything that wants it.
    expect(commandHelp("remove")).toContain("--confirm");
    expect(commandHelp("remove")).toContain("<id>");
    expect(commandHelp("status")).toContain("--layout");
    // TOTAL, rather than naming one command that happens to have no flags
    // today: `status` and `fired` both gained one on 2026-09-20 and this
    // assertion had to move twice. A command with none says so; a command with
    // some lists them under its own heading.
    for (const command of COMMANDS) {
      const page = commandHelp(command);
      if (COMMAND_FLAGS[command].length === 0) {
        expect(page, command).toContain("takes no flags of its own");
      } else {
        expect(page, command).toContain(`Flags for ${command}:`);
        expect(page, command).not.toContain("takes no flags of its own");
      }
    }
  });
});

// ── unknown flags ───────────────────────────────────────────────────────────

/**
 * A flag the command does not take is a refusal, before anything opens.
 *
 * The measured failure (cold-stranger review, 2026-09-04):
 * `counterparts note "…" --dirr <store2>` printed `Remembered mem_… — minted.`
 * and store2 stayed empty — the note went to the DEFAULT store, which on a real
 * machine is the owner's live memory, and nothing in the output named it. The
 * parser runs `strict: false` because a strict parse throws, and a throw is a
 * stack trace on the owner's terminal; the price was silence.
 */
describe("unknown flags", () => {
  test("every command refuses a flag it does not declare, and names the nearest one", async () => {
    for (const command of COMMANDS) {
      const c = consoleWith();
      const code = await run([command, "--dirr", dir], { io: c.io, env: { [ENV]: dir } });
      expect(code).toBe(EXIT.refused);
      const said = text(c.err);
      expect(said).toContain("unknown flag --dirr");
      expect(said).toContain("did you mean --dir?");
      // It says what this command DOES take, so the reader is not sent to --help.
      expect(said).toContain("--dir");
      expect(said).toContain("Nothing was opened and nothing was written.");
    }
  });

  test("the refusal happens before any store is opened or created", async () => {
    const untouched = join(outside, "never-opened");
    mkdirSync(untouched, { recursive: true });
    const before = readdirSync(untouched);
    for (const argv of [
      ["note", "a memory", "--dirr", untouched],
      ["install", "--budget", "9000", "--nmae", "Ada"],
      ["init", "--dir", untouched, "--bugdet", "9000"],
      ["status", "--totally-bogus-flag"],
      ["remove", "mem_x", "--confrim"],
    ]) {
      const c = consoleWith();
      expect(await run(argv, { io: c.io, env: {}, home: join(outside, "flag-home") })).toBe(
        EXIT.refused,
      );
      expect(text(c.err)).toContain("unknown flag");
    }
    // Byte-identical: no store minted, no config written, nothing touched.
    expect(readdirSync(untouched)).toEqual(before);
    expect(existsSync(join(outside, "flag-home"))).toBe(false);
  });

  test("a flag that wants a value and gets none is refused, not read as absent", () => {
    // `strict: false` turns a trailing `--dir` into the BOOLEAN true, which every
    // reader in this file treats as "not given" — the same silence one step on.
    expect(unknownFlag("status", ["status", "--dir"])).toContain("--dir needs a value");
    expect(unknownFlag("note", ["note", "x", "--title"])).toContain("--title needs a value");
    expect(unknownFlag("rebrief", ["rebrief", "--budget", "--observer"])).toContain(
      "--budget needs a value",
    );
    // `--flag=value` supplies its own value, and a boolean switch needs none.
    expect(unknownFlag("status", ["status", "--dir=/tmp/x"])).toBe(null);
    expect(unknownFlag("recall", ["recall", "q", "--json"])).toBe(null);
  });

  test("each command's declared set is exactly what its usage promises", () => {
    // Totality: a flag added to `parse` and forgotten here would be refused at
    // runtime, so the table is the contract and this walks it.
    for (const command of COMMANDS) {
      const allowed = [...COMMON_FLAGS, ...(COMMAND_FLAGS[command] ?? [])];
      for (const flag of allowed) {
        expect(unknownFlag(command, [command, `--${flag}=x`])).toBe(null);
      }
    }
    // And a flag one command owns is not silently available to another.
    expect(unknownFlag("status", ["status", "--confirm"])).toContain("unknown flag --confirm");
    expect(unknownFlag("note", ["note", "x", "--rebuild"])).toContain("unknown flag --rebuild");
  });
});

// ── note / recall ───────────────────────────────────────────────────────────

/**
 * The console's own two memory acts. They exist because the cold-stranger
 * review of 2026-09-04 reached the end of the install page with no way to test
 * the one thing the product is for, and hand-wrote MCP JSON-RPC instead.
 */
describe("note and recall", () => {
  test("a note round-trips: stored by one call, found by the next", async () => {
    store().close();
    const w = consoleWith();
    expect(
      await run(["note", "The espresso machine in the kitchen is a Rancilio Silvia.", "--dir", dir], {
        io: w.io,
      }),
    ).toBe(EXIT.ok);
    expect(text(w.out)).toContain("Remembered mem_");
    // A SECOND, unrelated memory, so this test asks its question of a store
    // holding more than the answer. The one-memory case is its own test above,
    // deliberately, because a bug at n=1 is invisible to every test that seeds
    // two rows — which is how PR #38's bug survived to a stranger's first minute.
    await run(["note", "An unrelated second memory about the fire escape.", "--dir", dir], {
      io: consoleWith().io,
    });

    const r = consoleWith();
    expect(await run(["recall", "what espresso machine?", "--dir", dir], { io: r.io })).toBe(EXIT.ok);
    const printed = text(r.out);
    expect(printed).toContain("Rancilio Silvia");
    // The console opens no socket, so the answer says which channel ran.
    expect(printed).toContain("semantic embedder-off");
  });

  test("the denominator is labelled LIVE ROWS, and counts the identity core", async () => {
    // The word, not the number. `storeSize` is `list({ archived: false })` —
    // memories, schemas (the identity core included) and journal episodes — so
    // on a store made the documented way it reads one higher than the memory
    // count, and `live` alone read as "live memories". §7's capture is this
    // line, and it is only reproducible while the label names the population.
    const named = join(outside, "live-rows");
    await run(["init", "--dir", named, "--name", "Ada"], { io: consoleWith().io });
    await run(["note", "The espresso machine in the kitchen is a Rancilio Silvia.", "--dir", named], {
      io: consoleWith().io,
    });
    const c = consoleWith();
    expect(await run(["recall", "what espresso machine?", "--dir", named], { io: c.io })).toBe(
      EXIT.ok,
    );
    // One memory, one core: two live rows, one of them considered.
    expect(text(c.out)).toContain("considered 1 of 2 live rows");
    const brain = openCounterpart(named);
    open.push(brain);
    expect(brain.store.list({ archived: false }).length).toBe(2);
    brain.close();
  });

  // THE FIRST THING EVERY NEW USER DOES, and for a while the one thing that did
  // not work: at store size one the question path scored no candidates at all
  // (`considered: 0`) and answered `nothing-came`, while the same memory came
  // back fine by id — the write and the index were sound and only the search
  // path was blind at n=1. Reproduced on four independent fresh stores by the
  // cold-stranger review of 2026-09-04 and fixed the same day (PR #38: rarity
  // was exactly zero when the store held one memory). This test was written
  // then and skipped; it is live now, and it stays live, because a bug at n=1
  // is invisible to every test that seeds two rows.
  test("recalls the FIRST memory in a fresh store", async () => {
    store().close();
    await run(["note", "The espresso machine in the kitchen is a Rancilio Silvia.", "--dir", dir], {
      io: consoleWith().io,
    });
    const c = consoleWith();
    expect(await run(["recall", "what espresso machine?", "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("Rancilio Silvia");
  });

  test("both name the store they wrote to or read from, first line", async () => {
    // The other half of the silent-write fix: even with the flags right, a
    // command whose destination is invisible cannot be checked by the person
    // running it. `status` has always led with `Store:`; these two did not.
    store().close();
    const w = consoleWith();
    await run(["note", "A memory that says where it went.", "--dir", dir], { io: w.io });
    expect(w.out[0]).toBe(`Store: ${dir}`);

    const r = consoleWith();
    await run(["recall", "where did it go?", "--dir", dir], { io: r.io });
    expect(r.out[0]).toBe(`Store: ${dir}`);

    // --json is a machine surface: the payload must still parse on its own.
    const j = consoleWith();
    await run(["recall", "where did it go?", "--dir", dir, "--json"], { io: j.io });
    expect(() => JSON.parse(text(j.out))).not.toThrow();
  });

  test("note takes the SAME two doors the MCP tool does: the span is captured, then claimed", async () => {
    // The order is the rule: without the claim, the end-of-session sweep finds
    // the jot's own words in the buffer and mints them a second time.
    const s = store();
    s.close();
    await run(["note", "Marisol keeps the postgres runbook in her head.", "--dir", dir], {
      io: consoleWith().io,
    });
    const spans = join(dir, "spans");
    expect(existsSync(spans)).toBe(true);
    // One memory, not two: the deposit claimed the span it rode in on.
    const after = openCounterpart(dir);
    open.push(after);
    expect(after.store.list({ archived: false }).length).toBe(1);
    after.close();
  });

  test("recall --id is the exact address, and answers where a question may not", async () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "The heron is blue in October." });
    s.close();
    const c = consoleWith();
    expect(await run(["recall", "--id", id, "--dir", dir], { io: c.io })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("The heron is blue in October.");
    expect(text(c.out)).toContain("expanded");
  });

  test("a chapter comes back marked [journal], and a memory beside it does not (I14)", async () => {
    // The third door on the same result. QUICKSTART §5a and the recall CONTRACT
    // both now say the console marks a chapter; stated is mechanized here.
    const s = store();
    // Unrelated filler, so rarity has a population to discriminate against: on a
    // two-row store every shared content word has `df === storeSize` and scores
    // nothing (`recall/NOTES.md` #12), which would make this test assert nothing.
    for (const body of [
      "The kitchen tap drips when the washer is worn.",
      "Rye flour ferments faster than wheat.",
      "The blue mug chipped in the move.",
      "The bus to town leaves on the hour.",
      "Cedar smells sharpest after rain.",
      "The heating pipes knock in the morning.",
      "The library closes early on Thursdays.",
      "Basil wilts if the pot dries out once.",
      "The garden gate sticks in humid weather.",
      "Coffee ground too fine chokes the machine.",
      "The attic hatch needs a longer ladder.",
      "Wool socks dry slower than cotton.",
      "The porch light flickers before it fails.",
      "Old plaster crumbles when you drill it.",
      "Bicycle brake pads wear out in a wet winter.",
      "The neighbour's cat sits on the fence at dusk.",
    ]) {
      s.put({ type: "memory", kind: "fact", body });
    }
    const chapter = s.put({
      type: "episode",
      kind: "self",
      title: "The lighthouse conversation",
      body: "## the lighthouse conversation\n\nWe talked for an hour about the lighthouse at Fernbrook Point and why it stopped turning.",
      source: "episode",
    });
    const memory = s.put({
      type: "memory",
      kind: "fact",
      title: "Fernbrook Point",
      body: "The lighthouse at Fernbrook Point stopped turning in 1974 when the keeper left.",
    });
    s.close();
    const c = consoleWith();
    expect(
      await run(["recall", "the lighthouse at Fernbrook Point", "--dir", dir], { io: c.io }),
    ).toBe(EXIT.ok);
    const lines = text(c.out).split("\n");
    const lineFor = (id: string): string => lines.find((l) => l.includes(id)) ?? "";
    // The chapter is DELIVERED — the ruling keeps it recallable — and marked.
    expect(lineFor(chapter)).not.toBe("");
    expect(lineFor(chapter)).toContain("[journal]");
    // And the memory beside it is not: a mark on everything marks nothing.
    expect(lineFor(memory)).not.toBe("");
    expect(lineFor(memory)).not.toContain("[journal]");
    // The word is glossed where the tier legend is, not left bare.
    expect(text(c.out)).toContain("journal = a chapter");
  });

  test("an empty recall is an ANSWER, and says what to try next", async () => {
    store().close();
    const c = consoleWith();
    expect(await run(["recall", "xylophone quokka nothing", "--dir", dir], { io: c.io })).toBe(
      EXIT.ok,
    );
    const printed = text(c.out);
    expect(printed).toContain("NOTHING CAME BACK");
    expect(printed).toContain("counterparts recall --id");
  });

  test("an answer says which TIER it came back at, so a footnote is not read as an answer", async () => {
    // `answered` means the question reached something, never that the something
    // is right. The cold-stranger review asked a one-row store what colour the
    // sky is on Mars, got the espresso machine, and had nothing on screen to
    // tell that apart from the right answer to a real question — the `[quiet]`
    // marker sat on both. The tier is the only confidence signal there is, so
    // the output now says what each tier it printed actually means.
    store().close();
    await run(["note", "The espresso machine in the kitchen is a Rancilio Silvia.", "--dir", dir], {
      io: consoleWith().io,
    });
    const c = consoleWith();
    expect(await run(["recall", "what espresso machine is in the kitchen?", "--dir", dir], { io: c.io })).toBe(
      EXIT.ok,
    );
    const printed = text(c.out);
    // Whatever tier came back, its gloss is on screen beside it.
    const tier = /\[(vivid|quiet|dim)\]/.exec(printed)?.[1];
    expect(tier).toBeDefined();
    expect(printed).toContain(`${tier as string} = `);
    // Nothing vivid means the caller is told these are leads, not answers.
    if (tier !== "vivid") expect(printed).toContain("leads rather than answers");
  });

  test("note refuses empty text, refuses an out-of-range salience, and refuses under observer", async () => {
    store().close();
    const empty = consoleWith();
    expect(await run(["note", "--dir", dir], { io: empty.io })).toBe(EXIT.usage);

    const bad = consoleWith();
    expect(await run(["note", "x", "--salience", "7", "--dir", dir], { io: bad.io })).toBe(
      EXIT.refused,
    );
    expect(text(bad.err)).toContain("--salience");

    // An instrument may LOOK at a memory and may not add to one.
    expect(OWNER_OPS).toContain("note");
    expect(OWNER_OPS).not.toContain("recall");
    const obs = consoleWith();
    expect(await run(["note", "x", "--observer", "--dir", dir], { io: obs.io })).toBe(EXIT.refused);
  });

  test("recall refuses a question AND an --id together, and needs one of them", async () => {
    store().close();
    const both = consoleWith();
    expect(await run(["recall", "a question", "--id", "mem_x", "--dir", dir], { io: both.io })).toBe(
      EXIT.usage,
    );
    const neither = consoleWith();
    expect(await run(["recall", "--dir", dir], { io: neither.io })).toBe(EXIT.usage);
  });

  test("--json prints the tool's own payload, whose storeSize is the real one", async () => {
    store().close();
    await run(["note", "A canary for the payload shape.", "--dir", dir], { io: consoleWith().io });
    const c = consoleWith();
    expect(await run(["recall", "canary payload", "--dir", dir, "--json"], { io: c.io })).toBe(
      EXIT.ok,
    );
    const payload = JSON.parse(text(c.out)) as Record<string, unknown>;
    expect(payload["path"]).toBe("question");
    expect(payload["storeSize"]).toBe(1);
  });
});

// ── install ─────────────────────────────────────────────────────────────────

/**
 * `counterparts install` — the cold start.
 *
 * Every assertion below is about the ONE split that command exists to make:
 * the store, the config and the credential file are ours and get written; the
 * host's `settings.json` and MCP registration are printed and never touched.
 * The hermetic rule stands — every path here is a temp dir, and the layout
 * helper is exercised against an injected home rather than the real one.
 */
describe("install", () => {
  /** A throwaway HOME per test. `install` writes to `~/.counterparts` BY DESIGN
   *  — that is the one path the hooks read — so a test that used the real one
   *  would write the owner's live configuration. */
  function fakeHome(name: string): string {
    return join(outside, "home", name);
  }

  test("writes the store, and the config under ~/.counterparts whatever --dir says", async () => {
    const home = fakeHome("cold");
    const store = join(outside, "cold", "store");
    const c = consoleWith();
    const code = await run(["install", "--dir", store, "--budget", "9000", "--name", "Ada"], {
      io: c.io,
      env: {},
      home,
    });
    const printed = text(c.out);

    expect(code).toBe(EXIT.ok);
    expect(existsSync(paths.operational(store))).toBe(true);

    // THE PATH THE HOOKS READ WHEN NOTHING NAMES ANOTHER.
    // `claude-code/bin/hook.ts` and `bin/runner.ts` resolve
    // `join(homedir(), ".counterparts", "claude-code.json")` unless `--config` or
    // `COUNTERPARTS_CONFIG` says otherwise (`adapters/config-path.ts`), and a
    // hook that finds no config stands down at exit 0 — so a config written
    // somewhere else with NOTHING POINTING AT IT is an ambient half that never
    // fires and never says why. `--dir` therefore moves the STORE and only the
    // store; moving the configuration is `--config`'s job, tested in
    // `test/config-rule.test.ts`.
    const config = join(home, ".counterparts", CONFIG_FILE);
    expect(existsSync(config)).toBe(true);
    expect(existsSync(join(store, CONFIG_FILE))).toBe(false);
    expect(existsSync(join(outside, "cold", CONFIG_FILE))).toBe(false);
    const parsed = JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>;
    expect(parsed["dataDir"]).toBe(store);
    expect(parsed["credentialsFile"]).toBe(join(home, ".counterparts", CREDENTIALS_FILE));
    expect(parsed["injectionBudgetBytes"]).toBe(9000);
    expect(parsed["owner"]).toBe(true);
    expect(parsed["identity"]).toEqual({ name: "Ada" });
    // AND THE CORE EXISTS NOW, not at the first hook. `install` used to write
    // the name into the config and leave the minting to `openAdapter` at the
    // first session, while `init --name` minted immediately — so the two
    // commands §3 calls interchangeable produced different stores, and §7's
    // captured `considered N of M live rows` was reproducible only on one of
    // them (2026-09-04).
    expect(printed).toContain("identity core seeded for Ada");
    const brain = openCounterpart(store);
    open.push(brain);
    const core = findIdentityCore(brain.store);
    expect(core).not.toBe(null);
    expect(brain.store.readProse(core as string).meta["name"]).toBe("Ada");
    brain.close();
    // The egress knob is a DECISION, never a side effect of installing.
    expect(parsed["embedder"]).toBeUndefined();
    // Nor is the parallel-run knob: that one is the run's, not a stranger's.
    expect(parsed["parallel"]).toBeUndefined();

    const creds = join(home, ".counterparts", CREDENTIALS_FILE);
    expect(existsSync(creds)).toBe(true);
    expect((statSync(creds).mode & 0o777).toString(8)).toBe("600");
    // Names, never values: the template mentions the two variables and holds none.
    expect(readFileSync(creds, "utf8")).toContain("ANTHROPIC_API_KEY");
    expect(readFileSync(creds, "utf8")).toContain("VOYAGE_API_KEY");

    // A moved store is SAID OUT LOUD, because the thing that did not move is
    // the thing the reader would otherwise assume followed it.
    expect(printed).toContain("--dir moved the STORE only");
    expect(printed).toContain(config);
    // And it says so without F6's phrase: the hook DOES fall back to
    // COUNTERPARTS_DATA_DIR when the config names no store, so "no environment
    // override" is wrong here for the same reason it was wrong in `init`.
    expect(printed).not.toContain("no environment override");
    // The sentence moved with the one-config rule (2026-09-05): the hooks read
    // this path when NOTHING NAMES ANOTHER — `--config` / `COUNTERPARTS_CONFIG`
    // do, and this install passed neither.
    expect(printed).toContain("the path the hooks read when nothing names another one");

    // The host's two steps are PRINTED, and they name absolute paths.
    expect(printed).toContain("claude mcp add counterparts");
    expect(printed).toContain(`COUNTERPARTS_DATA_DIR="${store}"`);
    expect(printed).toContain(HOOK_SCRIPT);
    expect(printed).toContain(MCP_SCRIPT);
    for (const event of HOST_EVENTS) expect(printed).toContain(event);
    expect(printed).toContain("printed, not applied");
  });

  test("refuses a --dir that would put the config inside the data dir", async () => {
    // `--dir ~/.counterparts` is the shape that creates a store and then never
    // opens again: the layout totality check refuses an unclassified top-level
    // entry, and `claude-code.json` is one. Caught before anything is written.
    const home = fakeHome("selfeating");
    const c = consoleWith();
    const code = await run(["install", "--dir", join(home, ".counterparts")], {
      io: c.io,
      env: {},
      home,
    });
    expect(code).toBe(EXIT.refused);
    expect(text(c.err)).toContain("INSIDE the data dir");
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });

  test("the printed host commands survive a PATH with no bun on it", () => {
    // The failure this pins is invisible: a host whose PATH lacks `~/.bun/bin`
    // runs `counterparts-hook` (shebang `#!/usr/bin/env bun`) and gets "command
    // not found" on every event — no memory, no error the owner ever sees. The
    // host's process environment is not the login shell's; `credentials.ts`
    // measured exactly that on day 0 for the API keys.
    for (const cmd of [settingsBlock(), mcpCommand("/tmp/store")]) {
      // No bare executable NAME may appear as something to run: every runnable
      // token in these blocks is an absolute path.
      expect(cmd).not.toMatch(/"command": "counterparts-hook"/);
      expect(cmd).not.toMatch(/--\s+counterparts-mcp\s*$/);
    }
    expect(existsSync(HOOK_SCRIPT)).toBe(true);
    expect(existsSync(MCP_SCRIPT)).toBe(true);
    // `run` against the real runtime this process is using, absolute both sides.
    expect(runCommand(HOOK_SCRIPT)).toBe(`"${process.execPath}" run "${HOOK_SCRIPT}"`);
    // A path with a space stays one argument.
    expect(runCommand("/a b/c.ts", "/x y/bun")).toBe('"/x y/bun" run "/a b/c.ts"');
  });

  test("--embedder is the only way the egress knob is written", async () => {
    const home = fakeHome("egress");
    const store = join(outside, "egress", "store");
    await run(["install", "--dir", store, "--budget", "9000", "--embedder"], {
      io: consoleWith().io,
      env: {},
      home,
    });
    const parsed = JSON.parse(
      readFileSync(join(home, ".counterparts", CONFIG_FILE), "utf8"),
    ) as Record<string, unknown>;
    expect(parsed["embedder"]).toEqual({ enabled: true });
  });

  test("invents no injection ceiling, and says so (scar §2.18)", async () => {
    const home = fakeHome("noceiling");
    const store = join(outside, "noceiling", "store");
    const c = consoleWith();
    expect(await run(["install", "--dir", store], { io: c.io, env: {}, home })).toBe(EXIT.ok);
    const parsed = JSON.parse(
      readFileSync(join(home, ".counterparts", CONFIG_FILE), "utf8"),
    ) as Record<string, unknown>;
    expect(parsed["injectionBudgetBytes"]).toBeUndefined();
    expect(text(c.out)).toContain("invents none");
  });

  test("refuses a --budget that is not a positive whole number, before anything is created", async () => {
    const home = fakeHome("badbudget");
    const store = join(outside, "badbudget", "store");
    const c = consoleWith();
    expect(
      await run(["install", "--dir", store, "--budget", "lots"], { io: c.io, env: {}, home }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("--budget");
    expect(existsSync(store)).toBe(false);
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });

  test("is idempotent: a second install keeps both files, and --force replaces them", async () => {
    const home = fakeHome("twice-install");
    const store = join(outside, "twice-install", "store");
    const config = join(home, ".counterparts", CONFIG_FILE);
    await run(["install", "--dir", store, "--budget", "9000"], {
      io: consoleWith().io,
      env: {},
      home,
    });
    writeFileSync(config, JSON.stringify({ dataDir: store, injectionBudgetBytes: 1234 }));

    const second = consoleWith();
    expect(
      await run(["install", "--dir", store, "--budget", "9000"], { io: second.io, env: {}, home }),
    ).toBe(EXIT.ok);
    expect(text(second.out)).toContain("kept");
    // The file pointing at somebody's live memory is never silently rewritten.
    expect(
      (JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>)["injectionBudgetBytes"],
    ).toBe(1234);

    const third = consoleWith();
    expect(
      await run(["install", "--dir", store, "--budget", "9000", "--force"], {
        io: third.io,
        env: {},
        home,
      }),
    ).toBe(EXIT.ok);
    expect(
      (JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>)["injectionBudgetBytes"],
    ).toBe(9000);
  });

  test("--force KEEPS a credentials file that holds a key (I32)", async () => {
    // 2026-09-04, the second clobbered field. A forced install rewrote the
    // owner's `credentials.env` with the template; the detached worker was then
    // refused at every boundary for a week, the lived-day clock froze at 185,
    // and every visible surface — wake, recall, capture, the daily — read
    // healthy. A config is regenerable from this command's own flags. A key is
    // not, and `--force` was typed to fix a config.
    const home = fakeHome("force-keeps-key");
    const store = join(outside, "force-keeps-key", "store");
    const creds = join(home, ".counterparts", CREDENTIALS_FILE);
    await run(["install", "--dir", store, "--budget", "9000"], {
      io: consoleWith().io,
      env: {},
      home,
    });
    const SECRET = "sk-ant-A-KEY-NOBODY-CAN-REGENERATE";
    writeFileSync(creds, `# mine\nANTHROPIC_API_KEY=${SECRET}\n`, { mode: 0o600 });

    const forced = consoleWith();
    expect(
      await run(["install", "--dir", store, "--budget", "9000", "--force"], {
        io: forced.io,
        env: {},
        home,
      }),
    ).toBe(EXIT.ok);

    // The file is untouched, and the key is still in it.
    expect(readFileSync(creds, "utf8")).toContain(SECRET);
    const printed = text(forced.out);
    expect(printed).toContain("kept even under --force");
    // NAMES ONLY. The command reads the file to count what it holds and must
    // never print — or otherwise move — a value.
    expect(printed).toContain("ANTHROPIC_API_KEY");
    expect(printed).not.toContain(SECRET);
    // And it does NOT tell the reader to pass --force: they just did, and that
    // sentence would send them back into the incident.
    expect(printed).not.toContain("pass --force to replace it");

    // The CONFIG half of --force is unchanged: it is still overwritten.
    const config = join(home, ".counterparts", CONFIG_FILE);
    writeFileSync(config, JSON.stringify({ dataDir: store, injectionBudgetBytes: 1234 }));
    await run(["install", "--dir", store, "--budget", "9000", "--force"], {
      io: consoleWith().io,
      env: {},
      home,
    });
    expect(
      (JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>)["injectionBudgetBytes"],
    ).toBe(9000);
    expect(readFileSync(creds, "utf8")).toContain(SECRET);

    // A file holding NO key is still replaced — --force means what it says for
    // a template nobody has filled in.
    writeFileSync(creds, "# nothing in here but comments\n", { mode: 0o600 });
    const again = consoleWith();
    await run(["install", "--dir", store, "--budget", "9000", "--force"], {
      io: again.io,
      env: {},
      home,
    });
    expect(text(again.out)).toContain("replaced");
    expect(readFileSync(creds, "utf8")).toContain("Counterparts reads exactly two names");
  });

  test("refuses a forbidden data dir before a single file is written", async () => {
    const home = fakeHome("forbidden");
    const forbidden = join(homedir(), ".bansai", "cli-install-must-not-exist", "store");
    const c = consoleWith();
    expect(await run(["install", "--dir", forbidden], { io: c.io, env: {}, home })).toBe(
      EXIT.refused,
    );
    expect(text(c.err)).toContain("DATA_DIR_FORBIDDEN");
    expect(existsSync(forbidden)).toBe(false);
  });

  test("refuses to point the DEFAULT config at a throwaway store — the 2026-09-04 incident's shape", async () => {
    // On 2026-09-04 a suite run that had lost `test/preload.ts`'s home mock
    // rewrote the owner's real `~/.counterparts/claude-code.json` with a temp
    // `dataDir`. That file is what the hook, the worker and the MCP server read
    // with no flag, so his memory recorded nothing for three days. A throwaway
    // store may not become the live default.
    //
    // The home here is deliberately OUTSIDE the temp tree — a home under
    // `os.tmpdir()` is a clean room (the install loop's, this suite's), whose
    // default config is throwaway too and is not what this protects. Nothing
    // is ever created at it: the refusal comes before the first mkdir.
    const home = join("/", `counterparts-not-a-real-home-${process.pid}`);
    const store = join(outside, "throwaway", "store");
    const c = consoleWith();
    // env `{}` — the explicit-dir guard is NOT armed. The incident's shell had
    // neither the guard nor the mock, so this refusal may not depend on either.
    expect(await run(["install", "--dir", store, "--budget", "9000"], { io: c.io, env: {}, home })).toBe(
      EXIT.refused,
    );
    const said = text(c.err);
    expect(said).toContain("refused:");
    expect(said).toContain(join(home, ".counterparts", CONFIG_FILE));
    expect(said).toContain(store);
    expect(said).toContain(CONFIG_FLAG);
    expect(existsSync(home)).toBe(false);
    expect(existsSync(store)).toBe(false);

    // `--force` does not buy past it: `--force` overwrites a file you named,
    // and this is the file nobody named.
    const forced = consoleWith();
    expect(
      await run(["install", "--dir", store, "--force"], { io: forced.io, env: {}, home }),
    ).toBe(EXIT.refused);
    expect(existsSync(home)).toBe(false);

    // COUNTERPARTS_DATA_DIR is the same door and gets the same answer.
    const viaEnv = consoleWith();
    expect(
      await run(["install"], { io: viaEnv.io, env: { COUNTERPARTS_DATA_DIR: store }, home }),
    ).toBe(EXIT.refused);
    expect(existsSync(home)).toBe(false);

    // `--config <elsewhere>` is the way through: it moves the configuration,
    // the credentials and the store together, so the scratch install is scratch
    // all the way down and the default file is untouched.
    const named = join(outside, "throwaway-named", "claude-code.json");
    const ok = consoleWith();
    expect(
      await run(["install", CONFIG_FLAG, named, "--budget", "9000"], { io: ok.io, env: {}, home }),
    ).toBe(EXIT.ok);
    expect(existsSync(named)).toBe(true);
    expect(existsSync(home)).toBe(false);

    // The unit, stated directly. A store outside the temp tree is fine at the
    // default config; a clean-room home (one UNDER the temp tree) is fine with
    // a temp store, which is what keeps `tools/install-loop/run.sh` green.
    expect(throwawayDefaultRefusal(installLayout(store, {}, home), {}, home)).not.toBe(null);
    expect(
      throwawayDefaultRefusal(installLayout(join(outside, "x"), {}, home), {}, home),
    ).not.toBe(null);
    expect(
      throwawayDefaultRefusal(installLayout("/opt/counterparts/store", {}, home), {}, home),
    ).toBe(null);
    const cleanRoom = join(outside, "clean-home");
    expect(
      throwawayDefaultRefusal(installLayout(undefined, {}, cleanRoom), {}, cleanRoom),
    ).toBe(null);
    expect(
      throwawayDefaultRefusal(installLayout(store, {}, cleanRoom), {}, cleanRoom),
    ).toBe(null);
    // A NAMED configuration is out of its business whatever the store is.
    expect(
      throwawayDefaultRefusal(installLayout(store, {}, home, named), {}, home),
    ).toBe(null);

    // The roots it compares against carry both spellings of the same directory,
    // because macOS hands out `/var/folders/…` and `/private/var/folders/…` for
    // it and a prefix test that knows one silently answers "no" to the other.
    const roots = tempRoots({});
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.some((r: string) => outside.startsWith(r))).toBe(true);
  });

  test("is an owner operation: an observer console refuses it", async () => {
    expect(OWNER_OPS).toContain("install");
    const home = fakeHome("obs");
    const c = consoleWith();
    expect(
      await run(["install", "--dir", join(outside, "obs", "store"), "--observer"], {
        io: c.io,
        env: {},
        home,
      }),
    ).toBe(EXIT.refused);
    expect(existsSync(join(outside, "obs"))).toBe(false);
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });

  test("the config dir is ~/.counterparts always; only the store moves", () => {
    const home = join(outside, "layout-home");
    const layout = installLayout(undefined, {}, home);
    expect(layout.base).toBe(join(home, ".counterparts"));
    expect(layout.store).toBe(join(home, ".counterparts", "store"));
    expect(layout.config).toBe(join(home, ".counterparts", CONFIG_FILE));
    expect(layout.credentials).toBe(join(home, ".counterparts", CREDENTIALS_FILE));

    // A named store — flag or environment — moves the STORE and nothing else,
    // because the hooks read one hardcoded configuration path and no other.
    const named = installLayout(join(outside, "elsewhere", "s"), {}, home);
    expect(named.store).toBe(join(outside, "elsewhere", "s"));
    expect(named.config).toBe(join(home, ".counterparts", CONFIG_FILE));
    const fromEnv = installLayout(
      undefined,
      { COUNTERPARTS_DATA_DIR: join(outside, "e", "s") },
      home,
    );
    expect(fromEnv.store).toBe(join(outside, "e", "s"));
    expect(fromEnv.config).toBe(join(home, ".counterparts", CONFIG_FILE));

    // And the one shape that must be refused rather than created.
    expect(layoutRefusal(layout)).toBe(null);
    expect(layoutRefusal(installLayout(join(home, ".counterparts"), {}, home))).toContain(
      "INSIDE the data dir",
    );
  });

  test("the printed settings block is one command on all five events, and is only printed", () => {
    const block = JSON.parse(settingsBlock()) as {
      hooks: Record<string, { hooks: { type: string; command: string }[] }[]>;
    };
    expect(Object.keys(block.hooks).sort()).toEqual([...HOST_EVENTS].sort());
    for (const event of HOST_EVENTS) {
      expect(block.hooks[event]?.[0]?.hooks?.[0]?.command).toBe(runCommand(HOOK_SCRIPT));
    }
    // The host's own settings file is never named as a thing we open.
    expect(settingsBlock()).not.toContain("settings.json");
  });
});

// ── the one door in front of a bulk write ───────────────────────────────────

/**
 * ONE DEFINITION OF "NAMED", ON EVERY COMMAND THAT WRITES IN BULK.
 *
 * The disagreement (#77 review, 2026-09-05): `migrate-cache --apply` counted
 * `COUNTERPARTS_DATA_DIR` as having named the store and walked through on the
 * variable alone, while `repair-dates --apply` — landed the same night —
 * refused the identical line, and the shared `--yes` help sentence asserted the
 * two agreed. `backfill-claims --apply` and `repair-merged-beliefs --apply`,
 * bulk writes of the same shape, had no door at all.
 *
 * The owner's ruling: `--yes` only ever skips an interactive confirmation, and
 * a BULK WRITE always requires the `--dir` flag — neither `--yes` nor the
 * environment variable stands in for it. Ordinary per-memory commands keep
 * today's behaviour, which QUICKSTART §3a teaches, and so do the dry runs.
 *
 * Every door is walked from both sides here, and the refusal is proven to have
 * left the store byte-identical rather than merely to have printed something.
 */
describe("a bulk write names its store with --dir, and nothing else names it", () => {
  /** Every byte under the store, so a refusal can be shown to have changed none. */
  const fingerprint = (root: string): string => {
    const walk = (path: string): string[] => {
      if (!existsSync(path)) return [];
      if (statSync(path).isDirectory()) {
        return readdirSync(path)
          .sort()
          .flatMap((name) => walk(join(path, name)));
      }
      return [`${path} ${createHash("sha256").update(readFileSync(path)).digest("hex")}`];
    };
    return walk(root).join("\n");
  };

  /** Each door, as the owner would type it. */
  const DOORS: readonly (readonly [string, readonly string[]])[] = [
    ["repair-dates --apply", ["repair-dates", "--apply"]],
    ["migrate-cache --apply --yes", ["migrate-cache", "--apply", "--yes"]],
    ["backfill-claims --apply", ["backfill-claims", "--apply"]],
    ["repair-merged-beliefs --apply", ["repair-merged-beliefs", "--apply"]],
    ["verify --rebuild", ["verify", "--rebuild"]],
    ["verify --prune-index", ["verify", "--prune-index"]],
    ["verify --retry-skipped", ["verify", "--retry-skipped"]],
    ["verify --drop-vectors", ["verify", "--drop-vectors"]],
  ];

  beforeEach(() => {
    const s = Store.open({ dir });
    s.put({ type: "memory", kind: "fact", body: "A row for a bulk repair to walk over." });
    s.close();
  });

  for (const [name, argv] of DOORS) {
    test(`'${name}' on COUNTERPARTS_DATA_DIR alone is refused, and changes nothing`, async () => {
      const before = fingerprint(dir);
      const c = consoleWith(["yes"]);
      expect(await run(argv, { io: c.io, env: { [ENV]: dir } })).toBe(EXIT.refused);
      expect(text(c.err)).toContain("will not run against a store nobody named");
      // It says WHICH store it would have been, and names the one remedy.
      expect(text(c.err)).toContain(dir);
      expect(text(c.err)).toContain("Name the store: --dir <path>.");
      expect(text(c.err)).toContain("Nothing has changed.");
      expect(fingerprint(dir)).toBe(before);
    });

    test(`'${name} --dir <store>' goes through the door`, async () => {
      const c = consoleWith(["yes"]);
      const code = await run([...argv, "--dir", dir], { io: c.io, env: {} });
      expect(text(c.err)).not.toContain("will not run against a store nobody named");
      expect(code).not.toBe(EXIT.usage);
    });
  }

  test("the DRY RUNS still read COUNTERPARTS_DATA_DIR — the door is only in front of the write", async () => {
    for (const argv of [
      ["repair-dates"],
      ["migrate-cache"],
      ["backfill-claims"],
      ["repair-merged-beliefs"],
      ["verify"],
    ]) {
      const c = consoleWith();
      await run(argv, { io: c.io, env: { [ENV]: dir } });
      expect(text(c.err)).not.toContain("will not run against a store nobody named");
    }
  });
});

/**
 * True when any CANONICAL byte under the store still holds `needle` — the
 * database and its sidecars, which is where a memory's words live since the
 * floor. The span buffer is `remember/`'s own surface and is excluded here; the
 * tests that care about it name it directly.
 *
 * Bytes, not UTF-8: a `readFileSync(_, "utf8")` over a SQLite file replaces
 * invalid sequences and can pull the needle apart, which would make this pass
 * for the wrong reason.
 */
function storeHolds(root: string, needle: string): boolean {
  const db = paths.operational(root);
  return [db, `${db}-wal`, `${db}-shm`].some(
    (p) => existsSync(p) && readFileSync(p).toString("latin1").includes(needle),
  );
}

// ── --version, the bare console, ask, and the dashboard ─────────────────────

/**
 * The four surfaces the 2026-09-22 round added or re-pointed, and each one is
 * something a person meets in their first minute.
 */
describe("counterparts --version", () => {
  test("the flag and the verb print the same line, out of the package's own manifest", async () => {
    const said = `counterparts ${
      (JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
        version: string;
      }).version
    }`;
    const flag = consoleWith();
    expect(await run(["--version"], { io: flag.io, env: {} })).toBe(EXIT.ok);
    expect(text(flag.out)).toBe(said);
    expect(said).toMatch(/^counterparts \d+\.\d+\.\d+$/);

    const verb = consoleWith();
    expect(await run(["version"], { io: verb.io, env: {} })).toBe(EXIT.ok);
    expect(text(verb.out)).toBe(said);
  });

  test("it opens nothing, so a shell with the guard armed still gets an answer", async () => {
    // The check a person runs straight after `bun add -g`, on a machine that may
    // have no store at all.
    const c = consoleWith();
    expect(
      await run(["--version"], { io: c.io, env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" } }),
    ).toBe(EXIT.ok);
    expect(text(c.out)).toContain("counterparts ");
    expect(text(c.err)).toBe("");
  });

  test("`self-page --version <seq>` is untouched: that one carries a value", async () => {
    // `--version` is declared as a STRING (self-page takes it), so `strict:
    // false` hands back the boolean `true` only when nothing follows it. The
    // version flag reads exactly that boolean, and nothing else.
    const s = store();
    s.close();
    const c = consoleWith();
    // No such version, but the point is that it reached `self-page` at all
    // rather than printing a version line.
    await run(["self-page", "--version", "1", "--dir", dir], { io: c.io, env: {} });
    expect(text(c.out)).not.toContain("counterparts 0.");
  });

  test("on a command line that names a command, --version is refused like any other typo", async () => {
    const c = consoleWith();
    expect(await run(["status", "--version", "--dir", dir], { io: c.io, env: {} })).toBe(
      EXIT.refused,
    );
    expect(text(c.err)).toContain("unknown flag --version");
  });
});

describe("a bare `counterparts`", () => {
  /** A console with a person at it: a terminal, and answers to give. */
  function terminal(answers: readonly string[]): Console_ {
    const c = consoleWith(answers.length > 0 ? answers : [""]);
    return {
      ...c,
      io: {
        ...c.io,
        tty: { stdin: true, stdout: true },
        promptHidden: async (): Promise<string> => "",
      },
    };
  }

  test("off a terminal it prints the map and the one line that sets it up, and exits 0", async () => {
    const c = consoleWith();
    expect(await run([], { io: c.io, env: {}, home: outside })).toBe(EXIT.ok);
    expect(text(c.out)).toContain("counterparts — a memory layer for AI");
    expect(text(c.out)).toContain("`counterparts install` does it");
    // NOTHING WAS ASKED. The install loop runs QUICKSTART's commands with no
    // terminal, and a question there is a hang that never times out.
    expect(c.asked).toEqual([]);
  });

  test("at a terminal with nothing set up it offers to set it up, and 'no' prints the map", async () => {
    const c = terminal(["n"]);
    expect(await run([], { io: c.io, env: {}, home: outside })).toBe(EXIT.ok);
    expect(c.asked[0]).toContain("No memory here yet. Set it up now?");
    expect(c.asked[0]).toContain("[Y/n]");
    expect(text(c.out)).toContain("counterparts — a memory layer for AI");
    // And nothing was created by asking.
    expect(existsSync(join(outside, ".counterparts"))).toBe(false);
  });

  test("'yes' runs install — the same command, through the same door", async () => {
    const c = terminal(["y", "Ada", "n"]);
    const code = await run([], {
      io: c.io,
      env: {},
      home: outside,
      spawner: () => ({ missing: false, code: 0, out: "", err: "" }),
      processes: () => ({ looked: true, processes: [] }),
    });
    expect(code).toBe(EXIT.ok);
    expect(text(c.out)).toContain("counterparts install");
    expect(existsSync(join(outside, ".counterparts", CONFIG_FILE))).toBe(true);
  });

  test("at a terminal WITH a configuration there is no question at all", async () => {
    mkdirSync(join(outside, ".counterparts"), { recursive: true });
    writeFileSync(join(outside, ".counterparts", CONFIG_FILE), JSON.stringify({ dataDir: dir }));
    const c = terminal(["y"]);
    expect(await run([], { io: c.io, env: {}, home: outside })).toBe(EXIT.ok);
    expect(c.asked).toEqual([]);
    expect(text(c.out)).toContain("counterparts — a memory layer for AI");
  });

  test("with the explicit-dir guard armed it asks nothing and stats nothing", async () => {
    // The guard's whole point is that nothing nobody named gets touched, and
    // "is there a configuration at the default path" is a question about
    // exactly that path.
    const c = terminal(["y"]);
    expect(
      await run([], {
        io: c.io,
        env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
        home: outside,
      }),
    ).toBe(EXIT.ok);
    expect(c.asked).toEqual([]);
    expect(text(c.out)).toContain("counterparts — a memory layer for AI");
  });
});

describe("ask, and recall under its older name", () => {
  test("both spellings reach the same command and answer the same question", async () => {
    store().close();
    await run(
      ["note", "The espresso machine in the kitchen is a Rancilio Silvia.", "--dir", dir],
      { io: consoleWith().io },
    );
    const asked = consoleWith();
    expect(await run(["ask", "what espresso machine?", "--dir", dir], { io: asked.io })).toBe(
      EXIT.ok,
    );
    const recalled = consoleWith();
    expect(await run(["recall", "what espresso machine?", "--dir", dir], { io: recalled.io })).toBe(
      EXIT.ok,
    );
    expect(text(asked.out)).toBe(text(recalled.out));
    expect(text(asked.out)).toContain("Rancilio");
  });

  test("the refusal says back the word the person typed", async () => {
    const said = consoleWith();
    expect(await run(["ask", "--dir", dir], { io: said.io })).toBe(EXIT.usage);
    expect(text(said.err)).toContain("ask takes a question");
    expect(text(said.err)).toContain('counterparts ask "..."');

    const older = consoleWith();
    expect(await run(["recall", "--dir", dir], { io: older.io })).toBe(EXIT.usage);
    expect(text(older.err)).toContain("recall takes a question");
  });

  test("`ask` is the listed name and both take the same flags", () => {
    expect(COMMAND_FLAGS["ask"]).toEqual(COMMAND_FLAGS["recall"]);
    expect(unknownFlag("ask", ["--json"])).toBeNull();
    expect(unknownFlag("ask", ["--kind", "fact"])).not.toBeNull();
  });
});

describe("counterparts dashboard", () => {
  /** A dashboard that never binds a port. */
  function seam(port = DASHBOARD_DEFAULT_PORT): {
    seam: DashboardSeam;
    started: { dir: string; port: number | undefined }[];
    opened: string[];
    stopped: number;
  } {
    const started: { dir: string; port: number | undefined }[] = [];
    const opened: string[] = [];
    const box = { stopped: 0 };
    return {
      started,
      opened,
      get stopped(): number {
        return box.stopped;
      },
      seam: {
        start: async (o): Promise<RunningView> => {
          started.push({ dir: o.dir, port: o.port });
          return {
            url: `http://127.0.0.1:${String(o.port ?? port)}`,
            dir: o.dir,
            stop: async (): Promise<void> => {
              box.stopped += 1;
            },
          };
        },
        open: (url: string): void => {
          opened.push(url);
        },
        until: async (): Promise<void> => {
          /* a real run waits for Ctrl-C; a test does not wait at all */
        },
      },
    };
  }

  /** A configuration naming this test's store, where the hooks would read it. */
  function configured(): void {
    store().close();
    mkdirSync(join(outside, ".counterparts"), { recursive: true });
    writeFileSync(join(outside, ".counterparts", CONFIG_FILE), JSON.stringify({ dataDir: dir }));
  }

  test("it opens the CONFIGURED store with no --dir, prints the one line, and opens a browser", async () => {
    configured();
    const s = seam();
    const c = consoleWith();
    expect(await run(["dashboard"], { io: c.io, env: {}, home: outside, dashboard: s.seam })).toBe(
      EXIT.ok,
    );
    expect(s.started).toEqual([{ dir, port: undefined }]);
    expect(text(c.out)).toContain("Dashboard: http://127.0.0.1:4747  (Ctrl-C stops it)");
    // Which store is on that socket is never a guess.
    expect(text(c.out)).toContain(`reading ${dir}`);
    expect(s.opened).toEqual(["http://127.0.0.1:4747"]);
    // Ctrl-C came back: the server was stopped rather than left listening.
    expect(s.stopped).toBe(1);
  });

  test("--no-open serves it and opens nothing", async () => {
    configured();
    const s = seam();
    const c = consoleWith();
    expect(
      await run(["dashboard", "--no-open"], {
        io: c.io,
        env: {},
        home: outside,
        dashboard: s.seam,
      }),
    ).toBe(EXIT.ok);
    expect(s.opened).toEqual([]);
    expect(text(c.out)).toContain("Dashboard: ");
  });

  test("--dir names another store, and --port another port", async () => {
    configured();
    const other = join(outside, "second-store");
    Store.open({ dir: other }).close();
    const s = seam();
    const c = consoleWith();
    expect(
      await run(["dashboard", "--dir", other, "--port", "5050", "--no-open"], {
        io: c.io,
        env: {},
        home: outside,
        dashboard: s.seam,
      }),
    ).toBe(EXIT.ok);
    expect(s.started).toEqual([{ dir: other, port: 5050 }]);
    expect(text(c.out)).toContain("http://127.0.0.1:5050");
  });

  test("a port that is not a port is refused, and nothing is opened", async () => {
    configured();
    const s = seam();
    const c = consoleWith();
    expect(
      await run(["dashboard", "--port", "haystack"], {
        io: c.io,
        env: {},
        home: outside,
        dashboard: s.seam,
      }),
    ).toBe(EXIT.refused);
    expect(text(c.err)).toContain("is not a port number");
    expect(s.started).toEqual([]);
  });

  test("with no configuration it refuses and names the three ways forward", async () => {
    const s = seam();
    const c = consoleWith();
    expect(await run(["dashboard"], { io: c.io, env: {}, home: outside, dashboard: s.seam })).toBe(
      EXIT.refused,
    );
    expect(text(c.err)).toContain("there is no configuration at");
    expect(text(c.err)).toContain("counterparts install");
    expect(text(c.err)).toContain("--dir");
    expect(s.started).toEqual([]);
  });

  test("a configuration naming a store that is not there says so rather than serving nothing", async () => {
    mkdirSync(join(outside, ".counterparts"), { recursive: true });
    writeFileSync(
      join(outside, ".counterparts", CONFIG_FILE),
      JSON.stringify({ dataDir: join(outside, "nowhere") }),
    );
    const s = seam();
    const c = consoleWith();
    expect(await run(["dashboard"], { io: c.io, env: {}, home: outside, dashboard: s.seam })).toBe(
      EXIT.failed,
    );
    expect(text(c.err)).toContain("no store at");
    expect(s.started).toEqual([]);
  });

  test("an unnamed configuration is refused while the explicit-dir guard is armed", async () => {
    const s = seam();
    const c = consoleWith();
    expect(
      await run(["dashboard"], {
        io: c.io,
        env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
        home: outside,
        dashboard: s.seam,
      }),
    ).toBe(EXIT.refused);
    expect(s.started).toEqual([]);

    // …and `--dir` IS a name, so it goes through — the same sentence `doctor`
    // carries.
    configured();
    const named = consoleWith();
    expect(
      await run(["dashboard", "--dir", dir, "--no-open"], {
        io: named.io,
        env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
        home: outside,
        dashboard: s.seam,
      }),
    ).toBe(EXIT.ok);
    expect(s.started).toEqual([{ dir, port: undefined }]);
  });

  test("the default port it names is the server's own", async () => {
    // Restated rather than imported, so a console that is not serving anything
    // never pulls the server into its module graph. The two are held together
    // here instead.
    const { DEFAULT_PORT } = await import("../src/adapters/dashboard/web/server.js");
    expect(DASHBOARD_DEFAULT_PORT).toBe(DEFAULT_PORT);
  });
});

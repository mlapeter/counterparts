/**
 * store/ — the three boxes and the one seam.
 *
 * Hermetic by construction (CLAUDE.md): every test makes a fresh temp data dir in
 * beforeEach and removes ONLY that path in afterEach. Nothing here can reach a real
 * store — and `dataDir()`'s own guard is tested below.
 *
 * Assertions name the REASON (`StoreError.code`, the SQLite constraint), not just
 * "it threw".
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import {
  CACHE_SCHEMA_VERSION,
  DATA_DIR_ENV,
  DEFAULT_RETENTION_DAYS,
  EXPLICIT_DIR_ARMING_VALUES,
  EXPLICIT_DIR_DISARMING_VALUES,
  LAYOUT,
  OBSERVER_READ_FLOOR,
  REQUIRE_EXPLICIT_DIR_ENV,
  SCHEMA_VERSION,
  StoreError,
  Store,
  WRITE_METHODS,
  classifyTopLevel,
  convertVectorBatch,
  countNonFinite,
  dataDir,
  decodeVector,
  defaultDataDir,
  describeGuardRefusal,
  encodeVector,
  explicitDirMalformedRefusal,
  explicitDirRequired,
  explicitDirSetting,
  hashText,
  newId,
  parseProse,
  paths,
  serializeProse,
  storeExists,
  vectorFormats,
} from "../src/core/store/index.js";
import type { ProseDoc, PutInput } from "../src/core/store/index.js";
import { openDb } from "../src/core/store/db.js";
// The word `sleep/dedup.ts` writes when it archives a duplicate, imported so
// the seam's copy of it is pinned equal rather than hoped equal.
import { MERGE_ARCHIVE_REASON } from "../src/core/sleep/index.js";

const STORE_SRC = fileURLToPath(new URL("../src/core/store/", import.meta.url));

let dir: string;
let priorEnv: string | undefined;
const open: Store[] = [];

function store(opts: Parameters<typeof Store.open>[0] = {}): Store {
  const s = Store.open(opts);
  open.push(s);
  return s;
}

/** Deterministic stand-in for a real embedder: same text ⇒ same vector, always. */
function fakeEmbed(text: string): number[] {
  const h = hashText(text);
  const v: number[] = [];
  for (let i = 0; i < 8; i++) v.push(parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255);
  return v;
}

function mem(body: string, extra: Partial<PutInput> = {}): PutInput {
  return { type: "memory", kind: "fact", body, ...extra };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof StoreError ? err.code : `NOT_STORE_ERROR:${String(err)}`;
  }
  return "NO_THROW";
}

beforeEach(() => {
  priorEnv = process.env[DATA_DIR_ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-"));
  process.env[DATA_DIR_ENV] = dir;
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
  if (priorEnv === undefined) delete process.env[DATA_DIR_ENV];
  else process.env[DATA_DIR_ENV] = priorEnv;
});

// ── dataDir(): resolved at call time ─────────────────────────────────────────

describe("dataDir", () => {
  test("reads the environment at call time, not at import time", () => {
    expect(dataDir()).toBe(dir);
    const second = mkdtempSync(join(tmpdir(), "counterparts-"));
    try {
      process.env[DATA_DIR_ENV] = second;
      expect(dataDir()).toBe(second);
    } finally {
      process.env[DATA_DIR_ENV] = dir;
      rmSync(second, { recursive: true, force: true });
    }
    expect(dataDir()).toBe(dir);
  });

  test("falls back to ~/.counterparts/store when the variable is absent or blank — the base dir is the host adapters', and an unclassified file in the data dir is a store that will not open (§5 G11)", () => {
    // The preload arms the explicit-dir guard for the whole run; a test OF the
    // fallback stands it down for its own body and re-arms it in `finally`.
    delete process.env[REQUIRE_EXPLICIT_DIR_ENV];
    try {
      delete process.env[DATA_DIR_ENV];
      expect(dataDir()).toBe(join(homedir(), ".counterparts", "store"));
      process.env[DATA_DIR_ENV] = "   ";
      expect(dataDir()).toBe(join(homedir(), ".counterparts", "store"));
    } finally {
      process.env[REQUIRE_EXPLICIT_DIR_ENV] = "1";
      process.env[DATA_DIR_ENV] = dir;
    }
  });

  // ── the explicit-dir guard (LAUNCH-STATUS I21, owner ruling 2026-09-05) ────
  //
  // `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` makes the fallback REFUSE. The preload
  // arms it for the suite, so "guard set" is the ambient state here and "guard
  // unset" is the case a test has to construct.

  test("guard set + no dir + no env → IMPLICIT_DEFAULT_DIR_REFUSED, naming the guard, the dir and the remedy, and nothing is created", () => {
    expect(process.env[REQUIRE_EXPLICIT_DIR_ENV]).toBe("1");
    delete process.env[DATA_DIR_ENV];
    try {
      const fallback = join(homedir(), ".counterparts", "store");
      expect(defaultDataDir()).toBe(fallback);
      let thrown: unknown;
      try {
        dataDir();
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(StoreError);
      const err = thrown as StoreError;
      expect(err.code).toBe("IMPLICIT_DEFAULT_DIR_REFUSED");
      // The message names all three: which guard, which dir, what to do.
      expect(err.message).toContain(REQUIRE_EXPLICIT_DIR_ENV);
      expect(err.message).toContain(fallback);
      expect(err.message).toContain(DATA_DIR_ENV);
      expect(err.message).toContain("--dir");
      expect(err.detail["dir"]).toBe(fallback);
      // Refused on path arithmetic alone: the default's parent was never made.
      expect(existsSync(join(homedir(), ".counterparts"))).toBe(false);

      // Every door the store has goes through the same fallback.
      expect(code(() => Store.open({}))).toBe("IMPLICIT_DEFAULT_DIR_REFUSED");
      expect(code(() => Store.open({ observer: true }))).toBe("IMPLICIT_DEFAULT_DIR_REFUSED");
      expect(code(() => storeExists())).toBe("IMPLICIT_DEFAULT_DIR_REFUSED");
      expect(existsSync(join(homedir(), ".counterparts"))).toBe(false);
    } finally {
      process.env[DATA_DIR_ENV] = dir;
    }
  });

  test("guard set + an explicit dir opens; guard set + COUNTERPARTS_DATA_DIR opens — the env-set case returns before the guard is read", () => {
    expect(process.env[REQUIRE_EXPLICIT_DIR_ENV]).toBe("1");
    // Explicit `dir`, variable UNSET: the guard is about the fallback, not about
    // callers who said which store they meant.
    delete process.env[DATA_DIR_ENV];
    try {
      const s = store({ dir });
      expect(s.dir).toBe(dir);
      s.close();
    } finally {
      process.env[DATA_DIR_ENV] = dir;
    }
    // The variable names the store.
    expect(dataDir()).toBe(dir);
    const s2 = store();
    expect(s2.dir).toBe(dir);
    s2.close();
    // An injected environment is honoured on its own terms.
    expect(dataDir({ [DATA_DIR_ENV]: dir, [REQUIRE_EXPLICIT_DIR_ENV]: "1" })).toBe(dir);
  });

  test("the value matrix: `1`/`true`/`on` arm it, `0`/`false`/`off` and blank stand it down, and ANY other value is refused rather than read as off", () => {
    const fallback = join(homedir(), ".counterparts", "store");
    const envWith = (value: string | undefined): Record<string, string | undefined> =>
      value === undefined ? {} : { [REQUIRE_EXPLICIT_DIR_ENV]: value };

    // OFF: absent, blank, or a word that MEANS off. Today's behaviour, byte for
    // byte. `=0` refusing would trip the shell of the person the guard protects
    // — off means off (owner ruling on the #80 review round); it is JUNK that
    // must not be read as off, which is the case below.
    for (const value of [undefined, "", "   ", "\t", "0", "false", "off", "OFF", " False ", "Off"]) {
      expect(explicitDirSetting(envWith(value))).toEqual({ armed: false, malformed: null });
      expect(explicitDirRequired(envWith(value))).toBe(false);
      expect(dataDir(envWith(value))).toBe(fallback);
    }

    // ARMED: a SUPERSET of the two `COUNTERPARTS_OBSERVER` takes, trimmed and
    // case-insensitive, so a person who exports `=true` or `=on` by analogy is
    // protected. (`COUNTERPARTS_OBSERVER` itself is deliberately not widened:
    // it is read on the live MCP server's launch path.)
    expect(EXPLICIT_DIR_ARMING_VALUES).toEqual(["1", "true", "on"]);
    expect(EXPLICIT_DIR_DISARMING_VALUES).toEqual(["0", "false", "off"]);
    for (const value of ["1", "true", "on", " 1", "1 ", " true\n", "TRUE", "True", "ON"]) {
      expect(explicitDirSetting(envWith(value))).toEqual({ armed: true, value: value.trim() });
      expect(explicitDirRequired(envWith(value))).toBe(true);
      let thrown: unknown;
      try {
        dataDir(envWith(value));
      } catch (e) {
        thrown = e;
      }
      expect((thrown as StoreError).code).toBe("IMPLICIT_DEFAULT_DIR_REFUSED");
      // The guard names the value that armed it, not a hard-coded `1`.
      expect((thrown as StoreError).detail["guard"]).toBe(`${REQUIRE_EXPLICIT_DIR_ENV}=${value.trim()}`);
    }

    // MALFORMED: neither an on-word nor an off-word. The #80 review measured
    // several of these falling silently to the default. A safety guard that
    // cannot read its own switch fails CLOSED — at the decision point, with a
    // distinct code and a sentence. Junk is not "off"; junk is a question this
    // will not answer.
    for (const value of ["yes", "no", "01", "1 1", "enabled", "y", "n", "2", "-1", "tru"]) {
      expect(explicitDirSetting(envWith(value))).toEqual({ armed: false, malformed: value });
      expect(code(() => explicitDirRequired(envWith(value)))).toBe("EXPLICIT_DIR_GUARD_MALFORMED");
      let thrown: unknown;
      try {
        dataDir(envWith(value));
      } catch (e) {
        thrown = e;
      }
      const err = thrown as StoreError;
      expect(err.code).toBe("EXPLICIT_DIR_GUARD_MALFORMED");
      expect(err.detail["value"]).toBe(value);
      expect(err.detail["accepted"]).toBe("1|true|on");
      expect(err.detail["off"]).toBe("0|false|off");
      expect(err.message).toContain(REQUIRE_EXPLICIT_DIR_ENV);
      // And the sentence a surface prints for it names the value, the words
      // that arm it and the words that turn it off.
      const sentence = describeGuardRefusal(err, "irrelevant here");
      expect(sentence).toContain(`'${value}'`);
      expect(sentence).toContain("1, true, on");
      expect(sentence).toContain("0, false, off");
      expect(sentence).toContain("fails closed");
      expect(sentence).toBe(explicitDirMalformedRefusal(value));
    }
    // A malformed value beside a NAMED store is not consulted: the guard's one
    // question is about the fallback, and the env-set arm returns first.
    expect(dataDir({ [DATA_DIR_ENV]: dir, [REQUIRE_EXPLICIT_DIR_ENV]: "yes" })).toBe(dir);

    // `describeGuardRefusal` is the ONE rendering every surface uses; the
    // remedy is the surface's own, and any other error is not its business.
    let armedErr: unknown;
    try {
      dataDir(envWith("1"));
    } catch (e) {
      armedErr = e;
    }
    const rendered = describeGuardRefusal(armedErr, "Say --dir.");
    expect(rendered).toContain(`${REQUIRE_EXPLICIT_DIR_ENV}=1`);
    expect(rendered).toContain(fallback);
    expect(rendered).toContain("Say --dir.");
    expect(rendered?.startsWith("refused:")).toBe(true);
    expect(describeGuardRefusal(new StoreError("STORE_UNINITIALIZED"), "x")).toBe(null);
    expect(describeGuardRefusal(new Error("plain"), "x")).toBe(null);

    // And through `process.env`, the way every real caller reaches it.
    delete process.env[REQUIRE_EXPLICIT_DIR_ENV];
    delete process.env[DATA_DIR_ENV];
    try {
      expect(dataDir()).toBe(fallback);
      process.env[REQUIRE_EXPLICIT_DIR_ENV] = "true";
      expect(code(() => dataDir())).toBe("IMPLICIT_DEFAULT_DIR_REFUSED");
      process.env[REQUIRE_EXPLICIT_DIR_ENV] = "0";
      expect(dataDir()).toBe(fallback);
      process.env[REQUIRE_EXPLICIT_DIR_ENV] = "yes";
      expect(code(() => dataDir())).toBe("EXPLICIT_DIR_GUARD_MALFORMED");
      expect(code(() => Store.open({}))).toBe("EXPLICIT_DIR_GUARD_MALFORMED");
    } finally {
      process.env[REQUIRE_EXPLICIT_DIR_ENV] = "1";
      process.env[DATA_DIR_ENV] = dir;
    }
    // Nothing above created the default's parent, whichever way it went.
    expect(existsSync(join(homedir(), ".counterparts"))).toBe(false);
  });

  test("no source file names a live store's directory — the forbidden list and the read-only assignment resolver are the only two (parallel-run G9)", () => {
    // The store seam refuses the directories (the tests below); this is the
    // tripwire against the OTHER way a v1 path gets opened — someone hardcoding
    // it in a hook, a tool, or a worker. Allowed: `store/paths.ts`, which names
    // them precisely to forbid them, and `claude-code/primacy.ts`, which reads
    // the shared assignment file and imports no write API.
    const here = fileURLToPath(new URL(".", import.meta.url));
    const roots = [join(here, "..", "src"), join(here, "..", "tools")];
    const forbidden = [".bansai", ".claude-engram", ".memory-ab"];
    // Also allowed: the parallel-run instrument's CLIs, which carry the real
    // read-only paths as DEFAULTS — `test/parallel.test.ts` proves nothing in
    // that tool but its run-dir writer imports a write API. `bin/restart.ts`
    // carries them for the same reason the other two do: the run directory's
    // overlap guard needs the live stores NAMED to refuse a run dir inside one,
    // and a default that has to be typed is a guard that is sometimes skipped.
    const allowed = new Set([
      "src/core/store/paths.ts",
      "src/adapters/claude-code/primacy.ts",
      "tools/parallel/bin/preflight.ts",
      "tools/parallel/bin/daily.ts",
      "tools/parallel/bin/restart.ts",
      // Same ground as the three above: the demo seeder names the live-store
      // roots in `REFUSED_ROOT_NAMES` precisely to REFUSE them, because
      // `store/paths.ts` does not refuse `~/.counterparts` and a seeder with no
      // guard of its own could be pointed at the owner's memory. It imports the
      // core's list rather than retyping it; `.memory-ab` is the one name it
      // adds, and `test/demo-seed.test.ts` proves every entry is refused.
      "tools/demo/seed.ts",
    ]);
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) {
          const rel = full.slice(join(here, "..").length + 1);
          if (allowed.has(rel)) continue;
          // Comments may cite the scars by name; code may not build the path.
          const code = readFileSync(full, "utf8")
            .split("\n")
            .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
            .join("\n");
          for (const name of forbidden) if (code.includes(name)) hits.push(`${rel}: ${name}`);
        }
      }
    };
    for (const r of roots) if (existsSync(r)) walk(r);
    expect(hits).toEqual([]);
    // And the one allowed reader really is read-only.
    const primacy = readFileSync(join(here, "..", "src/adapters/claude-code/primacy.ts"), "utf8");
    for (const api of ["writeFileSync", "appendFileSync", "mkdirSync", "renameSync", "rmSync", "unlinkSync"]) {
      expect(primacy).not.toContain(api);
    }
  });

  test("refuses a pointer at a live v1 store — resolved before compared (scar §2.13)", () => {
    process.env[DATA_DIR_ENV] = join(homedir(), ".bansai");
    expect(code(() => dataDir())).toBe("DATA_DIR_FORBIDDEN");
    process.env[DATA_DIR_ENV] = join(homedir(), ".bansai", "prose", "..", "x");
    expect(code(() => dataDir())).toBe("DATA_DIR_FORBIDDEN");
    process.env[DATA_DIR_ENV] = join(homedir(), ".claude-engram");
    expect(code(() => dataDir())).toBe("DATA_DIR_FORBIDDEN");
    process.env[DATA_DIR_ENV] = dir;
    expect(existsSync(join(homedir(), ".counterparts"))).toBe(
      existsSync(join(homedir(), ".counterparts")),
    ); // nothing was created by the guard
  });

  test("the guard runs on an EXPLICIT dir too — Store.open cannot be pointed at a live store", () => {
    // The wound: a test once deposited a v2 skeleton inside ~/.bansai because
    // the guard only ran inside dataDir(). Now the constructor guards every path.
    expect(code(() => Store.open({ dir: join(homedir(), ".bansai", "anywhere") }))).toBe(
      "DATA_DIR_FORBIDDEN",
    );
    expect(code(() => Store.open({ dir: join(homedir(), ".claude-engram", "x") }))).toBe(
      "DATA_DIR_FORBIDDEN",
    );
  });

  test("Store.open() with no dir uses the call-time value", () => {
    const s = store();
    expect(s.dir).toBe(dir);
  });
});

// ── destruction enforced by absence ──────────────────────────────────────────

describe("no deletion surface (contract §5 G2, §16 G1)", () => {
  const FORBIDDEN_WORDS = new Set([
    "delete",
    "deletes",
    "deleted",
    "remove",
    "removes",
    "removed",
    "unlink",
    "rm",
    "rmdir",
    "destroy",
    "erase",
    "purge",
    "wipe",
    "del",
    "truncate",
    "obliterate",
  ]);

  const words = (name: string): string[] =>
    name
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[\s_]+/)
      .map((w) => w.toLowerCase())
      .filter(Boolean);

  /**
   * The ONE file allowed to name destruction — the owner-op seam, which is the
   * structurally distinct owner path the contract sends removal down (§16 G1).
   * Before 2026-08-25 it exported nothing at all and the ban was total; the
   * box-2 chase had to live SOMEWHERE, and "somewhere" is a single file whose
   * exports are pinned by name below and whose importers are pinned by the
   * caller-universality test in `test/cli.test.ts`.
   */
  const SEAM = "owner-op-seam.ts";

  test("no export name in the module is a deletion verb", async () => {
    const files = readdirSync(STORE_SRC).filter((f) => f.endsWith(".ts") && f !== SEAM);
    expect(files.length).toBeGreaterThan(5);
    const seen: string[] = [];
    for (const file of files) {
      const mod = (await import(pathToFileURL(join(STORE_SRC, file)).href)) as Record<
        string,
        unknown
      >;
      for (const name of Object.keys(mod)) {
        seen.push(`${file}:${name}`);
        for (const w of words(name)) {
          expect({ name, word: w, offending: FORBIDDEN_WORDS.has(w) }).toEqual({
            name,
            word: w,
            offending: false,
          });
        }
      }
    }
    expect(seen.length).toBeGreaterThan(20);
  });

  test("no method on Store (public OR private) is a deletion verb", () => {
    // Private methods are still prototype properties at runtime — an export-name-only
    // check would miss `store.deleteX()`, so enumerate the prototype too.
    const names = Object.getOwnPropertyNames(Store.prototype).concat(
      Object.getOwnPropertyNames(Store),
    );
    expect(names).toContain("put");
    for (const name of names) {
      for (const w of words(name)) {
        expect({ name, offending: FORBIDDEN_WORDS.has(w) }).toEqual({ name, offending: false });
      }
    }
  });

  test("no file in the module calls a filesystem removal API", () => {
    // Names, not comments: the module DOCUMENTS what it refuses to do.
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const banned = /\b(unlinkSync|unlink|rmSync|rmdirSync|rmdir|rimraf)\b|\bfs\.rm\b|\brm\s*\(/;
    for (const file of readdirSync(STORE_SRC).filter((f) => f.endsWith(".ts"))) {
      const src = stripComments(readFileSync(join(STORE_SRC, file), "utf8"));
      expect({ file, callsRemoval: banned.test(src) }).toEqual({ file, callsRemoval: false });
    }
  });

  test("the owner-removal seam exports EXACTLY the destruction path, and nothing else does", async () => {
    const mod = (await import(pathToFileURL(join(STORE_SRC, SEAM)).href)) as Record<
      string,
      unknown
    >;
    // Pinned by name, so a further export cannot appear here quietly.
    // `grantOwnerOps` is the capability handed over by Store's constructor;
    // `chaseRemoved` is the box-2 chase; `REMOVED_REASON` is the word a
    // neutralized row carries. Added 2026-09-05: `unarchiveMerged` is the one
    // repair on this seam — it puts back a row the dedup pass archived as a
    // duplicate and refuses every OTHER archive reason by name, which is what
    // keeps it from being the general resurrection verb the store does not
    // have; `MERGED_ARCHIVE_REASON` is the one reason it undoes and
    // `UNMERGE_EVENT` the durable name it appends.
    expect(Object.keys(mod).filter((k) => k !== "default").sort()).toEqual([
      "MERGED_ARCHIVE_REASON",
      "REMOVED_REASON",
      "UNMERGE_EVENT",
      "chaseRemoved",
      "grantOwnerOps",
      "unarchiveMerged",
    ]);
    expect(typeof mod["chaseRemoved"]).toBe("function");
    expect(typeof mod["unarchiveMerged"]).toBe("function");
  });

  test("the seam's merge reason is the word `sleep/` actually writes", async () => {
    // `store/` sits below `sleep/` and must not import it, so the reason is
    // spelled twice. This is the pin that stops a rename from making the
    // repair door match nothing at all.
    const mod = (await import(pathToFileURL(join(STORE_SRC, SEAM)).href)) as Record<
      string,
      unknown
    >;
    expect(mod["MERGED_ARCHIVE_REASON"]).toBe(MERGE_ARCHIVE_REASON);
  });

  test("the chase is not reachable from the store's own surface", async () => {
    // The seam is where you go to destroy something; `store/index.ts` is not,
    // and re-exporting the chase from it would make every existing importer of
    // the store a caller of the destruction path (§16 G1–G2).
    const index = (await import(pathToFileURL(join(STORE_SRC, "index.ts")).href)) as Record<
      string,
      unknown
    >;
    for (const name of Object.keys(index)) {
      for (const w of words(name)) {
        expect({ name, offending: FORBIDDEN_WORDS.has(w) }).toEqual({ name, offending: false });
      }
    }
    expect(index["chaseRemoved"]).toBeUndefined();
    expect(readFileSync(join(STORE_SRC, "index.ts"), "utf8")).not.toContain(
      "export { chaseRemoved",
    );
  });
});

// ── box 1: prose ─────────────────────────────────────────────────────────────

describe("box 1 — canonical prose", () => {
  const doc = (over: Partial<ProseDoc> = {}): ProseDoc => ({
    id: "mem_0123456789ab",
    type: "memory",
    learnedOn: "2026-08-25",
    bornDay: 4,
    meta: {},
    body: "Mike prefers prose over chips.\n",
    ...over,
  });

  test("round-trips byte-for-byte, body included", () => {
    const d = doc({ title: "Preference", happenedOn: "2026-08", meta: { tier: 2, aliases: ["x"] } });
    const text = serializeProse(d);
    expect(parseProse(text)).toEqual(d);
    expect(serializeProse(parseProse(text))).toBe(text);
  });

  test("unrecognized metadata survives parse → serialize untouched (§4.2 G6)", () => {
    const d = doc({ meta: { fromTheFuture: { nested: [1, 2] }, provenance: "hook" } });
    const parsed = parseProse(serializeProse(d));
    expect(parsed.meta).toEqual({ fromTheFuture: { nested: [1, 2] }, provenance: "hook" });
  });

  test("omitted-when-absent: an unused field emits no line (§4.2 G8)", () => {
    const bare = serializeProse(doc());
    expect(bare).not.toContain("title:");
    expect(bare).not.toContain("happened:");
    // Adding then clearing the field returns the exact same bytes.
    const withTitle = serializeProse(doc({ title: "T" }));
    expect(withTitle).toContain("title: T");
    expect(serializeProse(parseProse(bare))).toBe(bare);
  });

  test("the parser reads the payload, not the human lines", () => {
    const text = serializeProse(doc({ title: "real" }));
    const tampered = text.replace("title: real", "title: a lie");
    expect(parseProse(tampered).title).toBe("real");
  });

  test("a body that opens with a fence does not confuse the parser", () => {
    const d = doc({ body: "---\nnot frontmatter\n---\n" });
    expect(parseProse(serializeProse(d)).body).toBe("---\nnot frontmatter\n---\n");
  });

  test("ambiguity is refused loudly, with the reason", () => {
    expect(code(() => parseProse("no frontmatter here"))).toBe("PROSE_FRONTMATTER_MISSING");
    expect(code(() => parseProse("---\nid: x\n"))).toBe("PROSE_FRONTMATTER_MISSING");
    expect(code(() => parseProse("---\nid: x\n---\nbody"))).toBe("PROSE_PAYLOAD_MISSING");
    expect(code(() => parseProse("---\npayload: {oops\n---\nbody"))).toBe("PROSE_PAYLOAD_MALFORMED");
    expect(code(() => parseProse('---\npayload: {"id":"x"}\n---\nbody'))).toBe(
      "PROSE_PAYLOAD_MALFORMED",
    );
    expect(code(() => serializeProse(doc({ body: 42 as unknown as string })))).toBe(
      "PROSE_BODY_INVALID",
    );
    expect(
      code(() => serializeProse(doc({ meta: { bad: () => 1 } as Record<string, unknown> }))),
    ).toBe("PROSE_META_UNSERIALIZABLE");
  });

  test("write → read round-trip through the store, on disk as readable markdown", () => {
    const s = store();
    const id = s.put(mem("Cold brew, not iced coffee.", { title: "Coffee", happenedOn: "2026-08-24" }));
    const file = paths.proseFile(dir, "memory", id);
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, "utf8");
    expect(raw.startsWith("---\n")).toBe(true);
    expect(raw).toContain("Cold brew, not iced coffee.");
    const back = s.readProse(id);
    expect(back.body).toBe("Cold brew, not iced coffee.");
    expect(back.title).toBe("Coffee");
    expect(back.happenedOn).toBe("2026-08-24");
  });

  test("a filename/payload disagreement is a hard error, not a repair", () => {
    const s = store();
    const id = s.put(mem("body"));
    const file = paths.proseFile(dir, "memory", id);
    writeFileSync(file, readFileSync(file, "utf8").replaceAll(id, "mem_ffffffffffff"), "utf8");
    expect(code(() => s.readProse(id))).toBe("PROSE_PAYLOAD_MISMATCH");
  });

  test("ids are type-prefixed, and a taken id is never reused", () => {
    const s = store();
    expect(newId("episode").startsWith("epi_")).toBe(true);
    expect(code(() => s.put(mem("x", { id: "epi_abc" })))).toBe("ID_MALFORMED");
    const id = s.put(mem("x"));
    expect(code(() => s.put(mem("y", { id })))).toBe("ID_TAKEN");
    expect(s.readProse(id).body).toBe("x");
  });
});

// ── box 2: operational ───────────────────────────────────────────────────────

describe("box 2 — canonical operational state", () => {
  test("physics, band cache, edges, prospective, meta and clock round-trip", () => {
    const s = store();
    const a = s.put(
      mem("A", {
        kind: "person",
        band: "semantic",
        salience: { relevance: 0.7, emotional: 0.4, claimed: 0.8 },
        physics: { protected: true, pressure: 0.25 },
      }),
    );
    const b = s.put(mem("B"));

    const read = s.read(a);
    expect(read.physics.kind).toBe("person");
    expect(read.physics.salience).toEqual({
      novelty: null, // a blind write is recorded as null, never defaulted (scar §2.9)
      relevance: 0.7,
      emotional: 0.4,
      predictive: 0,
      claimed: 0.8, // the author's claimed FLOOR survives the round-trip
    });
    expect(read.physics.protected).toBe(true);
    expect(read.physics.pressure).toBe(0.25);
    expect(read.band).toBe("semantic");
    expect(s.physicsOf(b).salience.claimed).toBe(null); // never defaulted to a number
    expect(s.physicsOf(b).reinforcedDays).toBe(0);

    s.updatePhysics(a, { uses: 3, consolidated: true, lastChallengedDay: 2 });
    expect(s.physicsOf(a).uses).toBe(3);
    expect(s.physicsOf(a).consolidated).toBe(true);
    expect(s.physicsOf(a).lastChallengedDay).toBe(2);
    s.updatePhysics(a, { reinforcedDays: 2 });
    expect(s.physicsOf(a).reinforcedDays).toBe(2);
    const credit = s.reinforce(a, 5); // tier defaults to "referenced" (w = 1)
    expect(credit.credited).toBe(true);
    expect(credit.reason).toBe("credited");
    expect(credit.next).toMatchObject({ uses: 4, reinforcedDays: 3, lastUsedDay: 5 });
    expect(s.physicsOf(a).uses).toBe(4);
    expect(s.physicsOf(a).reinforcedDays).toBe(3);
    expect(s.physicsOf(a).lastUsedDay).toBe(5);

    s.setBand(a, "identity", 5);
    expect(s.read(a).band).toBe("identity");
    expect(s.list({ band: "identity" })).toEqual([a]);

    s.link({ src: a, dst: b, weight: 0.5, day: 5 });
    expect(s.edgesFrom(a)).toMatchObject([{ src: a, dst: b, weight: 0.5, last_day: 5 }]);

    s.setProspective({
      memoryId: b,
      windowKey: "2026-09",
      eventDate: "2026-09",
      precision: "month",
      state: "armed",
    });
    expect(s.prospectiveFor(b)).toMatchObject([{ window_key: "2026-09", state: "armed", fires: 0 }]);

    s.setMeta("gate.session", "42");
    expect(s.getMeta("gate.session")).toBe("42");
  });

  test("crediting is physics.creditUse's rule — the store applies, never re-decides (§5.3/§5.5)", () => {
    const s = store();
    const id = s.put(mem("A")); // birthDay 0
    // Birth-day refusal comes from physics, through the store, for free.
    expect(s.reinforce(id, 0, "surfaced")).toMatchObject({ credited: false, reason: "birth-day" });
    expect(s.reinforce(id, 1, "surfaced").next).toMatchObject({ uses: 0.25, reinforcedDays: 1 });
    // Same-day second credit refused (not summed, as the old store rule did).
    expect(s.reinforce(id, 1, "surfaced")).toMatchObject({ credited: false, reason: "already-credited-today" });
    // Ignorable tier never trains.
    expect(s.reinforce(id, 2, "footnoted")).toMatchObject({ credited: false, reason: "ignorable-tier" });
    expect(s.reinforce(id, 2, "referenced").next).toMatchObject({ uses: 1.25, reinforcedDays: 2 });
    expect(s.physicsOf(id).uses).toBe(1.25);
    expect(s.physicsOf(id).reinforcedDays).toBe(2);
  });

  test("the clock counts lived days, not calendar days (scar E8)", () => {
    const s = store();
    expect(s.livedDay()).toBe(0);
    expect(s.advanceClock("2026-08-25")).toBe(1);
    expect(s.advanceClock("2026-08-25")).toBe(1); // same day: no second tick
    expect(s.advanceClock("2026-09-30")).toBe(2); // a month away is ONE lived day
    expect(code(() => s.advanceClock("2026-01-01"))).toBe("CLOCK_BACKWARDS");
  });

  test("physics bookkeeping never rewrites prose (the strength-only exemption, structurally)", () => {
    const s = store();
    const id = s.put(mem("unchanged"));
    const before = readFileSync(paths.proseFile(dir, "memory", id), "utf8");
    s.updatePhysics(id, { uses: 99, pressure: 0.9 });
    s.reinforce(id, 7);
    expect(readFileSync(paths.proseFile(dir, "memory", id), "utf8")).toBe(before);
    expect(s.versions(id)).toEqual([]);
  });

  test("referential integrity is enforced by the store, not by the caller", () => {
    const s = store();
    const a = s.put(mem("A"));
    let message = "";
    try {
      s.link({ src: a, dst: "mem_doesnotexist", weight: 1, day: 0 });
    } catch (err) {
      message = String(err);
    }
    expect(message).toMatch(/FOREIGN KEY/i);
    expect(s.edgesFrom(a)).toEqual([]);
    expect(code(() => s.reinforce("mem_nope", 1))).toBe("ID_UNKNOWN");
    expect(code(() => s.setProspective({
      memoryId: "mem_nope",
      windowKey: "w",
      eventDate: "2026-09",
      precision: "month",
      state: "armed",
    }))).toBe("ID_UNKNOWN");
  });
});

// ── transactionality ─────────────────────────────────────────────────────────

describe("transactionality — a killed multi-row mutation leaves no partial state", () => {
  test("an aborted putMany persists neither rows nor prose files", () => {
    const s = store();
    const good = "mem_aaaaaaaaaaaa";
    const bad = "mem_bbbbbbbbbbbb";
    expect(
      code(() =>
        s.putMany([
          mem("first", { id: good }),
          mem("", { id: bad }), // empty body: rejected mid-batch
          mem("third"),
        ]),
    ),
    ).toBe("PROSE_BODY_INVALID");
    expect(s.list()).toEqual([]);
    expect(s.has(good)).toBe(false);
    expect(existsSync(paths.proseFile(dir, "memory", good))).toBe(false);
    expect(
      readdirSync(paths.prose(dir), { recursive: true }).filter((f) => String(f).endsWith(".md")),
    ).toEqual([]);
    // The staged temp survives (nothing here deletes) but is inert: it is not a .md
    // under prose/, so no loader can mistake it for the memory it would have been.
    expect(readdirSync(paths.tmp(dir)).every((f) => f.endsWith(".tmp"))).toBe(true);
  });

  test("an aborted linkMany persists none of its rows", () => {
    const s = store();
    const a = s.put(mem("A"));
    const b = s.put(mem("B"));
    let message = "";
    try {
      s.linkMany([
        { src: a, dst: b, weight: 0.1, day: 0 },
        { src: a, dst: "mem_ghost000000", weight: 0.2, day: 0 },
      ]);
    } catch (err) {
      message = String(err);
    }
    expect(message).toMatch(/FOREIGN KEY/i);
    expect(s.edgesFrom(a)).toEqual([]);
  });

  test("an aborted supersede leaves the original untouched", () => {
    const s = store();
    const oldId = s.put(mem("original"));
    const taken = s.put(mem("already here"));
    expect(code(() => s.supersede(oldId, mem("replacement", { id: taken })))).toBe("ID_TAKEN");
    expect(s.read(oldId).supersededBy).toBe(null);
    expect(s.read(oldId).archived).toBe(false);
    expect(s.versions(oldId)).toEqual([]);
    expect(s.readProse(taken).body).toBe("already here");
  });

  test("per-item isolation is opt-in, and the skip is logged (§16 G6)", () => {
    const s = store();
    const ids = s.putMany([mem("first"), mem(""), mem("third")], { isolate: true });
    expect(ids.length).toBe(2);
    expect(s.list().length).toBe(2);
    const skipped = s.events("store.put.skipped");
    expect(skipped.length).toBe(1);
    expect(skipped[0]?.data?.reason).toBe("PROSE_BODY_INVALID");
  });
});

// ── revision, supersession, retention ────────────────────────────────────────

describe("revision + bounded versioning", () => {
  test("an overwrite archives the prior version first, and it stays readable", () => {
    const s = store();
    const id = s.put(mem("first draft", { title: "T" }));
    const seq = s.revise(id, { body: "second draft", reason: "correction" });
    expect(s.readProse(id).body).toBe("second draft");
    const version = s.readVersion(id, seq);
    expect(version.body).toBe("first draft");
    expect(s.versions(id)).toMatchObject([{ seq, reason: "correction" }]);
    // §5 G13: reading archived content emits an event, so archival can be shown to pay.
    expect(s.events("store.version.read").length).toBe(1);
  });

  test("two archivals of the same content cannot silently overwrite each other", () => {
    const s = store();
    const id = s.put(mem("same"));
    const first = s.revise(id, { body: "same" }); // archives "same"
    const second = s.revise(id, { body: "same" }); // archives identical bytes again
    expect(second).not.toBe(first);
    expect(s.versions(id).length).toBe(2);
    expect(new Set(s.versions(id).map((v) => v.path)).size).toBe(2);
  });

  test("supersede leaves a forwarding address; the old id resolves forever", () => {
    const s = store();
    const v1 = s.put(mem("Mike works at Acme"));
    const v2 = s.supersede(v1, mem("Mike works at Beta"), "accommodated");
    expect(s.resolve(v1)).toBe(v2);
    expect(s.resolve(v2)).toBe(v2);
    expect(s.readProse(v1).body).toBe("Mike works at Acme"); // old prose retained
    expect(s.read(v1).archived).toBe(true);
    expect(s.read(v1).archivedReason).toBe("accommodated");
    const v3 = s.supersede(v2, mem("Mike works at Gamma"));
    expect(s.resolve(v1)).toBe(v3); // resolution follows the whole chain
    expect(code(() => s.resolve("mem_nothing0000"))).toBe("ID_UNKNOWN");
  });

  test("version rows past H lived days are pruned; resolution is NOT", () => {
    const s = store({ retentionDays: 3 });
    const v1 = s.put(mem("old belief"));
    const v2 = s.supersede(v1, mem("new belief"));
    expect(s.versions(v1).length).toBe(1);

    let report = s.pruneSupersededVersions();
    expect(report.pruned).toBe(0); // nothing is old yet
    for (const d of ["26", "27", "28", "29", "30"]) s.advanceClock(`2026-08-${d}`);
    expect(s.livedDay()).toBe(5);

    report = s.pruneSupersededVersions();
    expect(report).toEqual({ pruned: 1, cutoffDay: 2, retentionDays: 3 });
    expect(s.versions(v1)).toEqual([]);
    // What prunes is the version ROW. The forwarding address and the prose remain.
    expect(s.resolve(v1)).toBe(v2);
    expect(s.readProse(v1).body).toBe("old belief");
    const pruneEvents = s.events("store.versions.pruned");
    expect(pruneEvents.at(-1)?.data).toEqual({ count: 1, cutoffDay: 2, retentionDays: 3 });
  });

  test("H defaults to 90 lived days and is tunable", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(90);
    expect(store().retentionDays).toBe(90);
    expect(store({ retentionDays: 14 }).retentionDays).toBe(14);
  });
});

// ── box 3: the rebuildable cache ─────────────────────────────────────────────

describe("box 3 — deleting the cache loses nothing canonical", () => {
  test("rebuild from canonical answers the same cues identically", () => {
    let s = store({ embed: fakeEmbed });
    const ids = s.putMany([
      mem("Cold brew every morning, never iced coffee"),
      mem("The dashboard renders ids at render time"),
      mem("Prospective memory holds debts and loses deadlines"),
    ]);
    const cues = ["coffee", "render time dashboard", "memory debts"];
    const before = cues.map((c) => s.search(c));
    const vectorBefore = s.nearestTo(fakeEmbed("Cold brew every morning, never iced coffee"), 3);
    const proseBefore = ids.map((id) => readFileSync(paths.proseFile(dir, "memory", id), "utf8"));
    const physicsBefore = ids.map((id) => s.physicsOf(id));
    expect(before[0]?.[0]?.id).toBe(ids[0] as string);

    // The cache is a separate FILE — losing it is the whole point of box 3.
    s.close();
    open.length = 0;
    rmSync(paths.cacheDir(dir), { recursive: true, force: true });
    expect(existsSync(paths.cache(dir))).toBe(false);

    s = store({ embed: fakeEmbed });
    expect(s.search("coffee")).toEqual([]); // really gone, not a stale handle
    const report = s.rebuildCache();
    // `skippedArchived` joined the report with I13: a rebuild reproduces the
    // LIVE index, so a canonical row that is archived or superseded is counted
    // out rather than silently dropped. Three live rows here, so it is zero.
    expect(report).toEqual({
      indexed: 3,
      skippedDenied: 0,
      skippedArchived: 0,
      unrecomputed: 0,
      declared: [],
      keptVectors: 0,
      droppedVectors: 0,
    });

    expect(cues.map((c) => s.search(c))).toEqual(before);
    expect(s.nearestTo(fakeEmbed("Cold brew every morning, never iced coffee"), 3)).toEqual(
      vectorBefore,
    );
    expect(ids.map((id) => readFileSync(paths.proseFile(dir, "memory", id), "utf8"))).toEqual(
      proseBefore,
    );
    expect(ids.map((id) => s.physicsOf(id))).toEqual(physicsBefore);
  });

  test("the v2→v3 migration derives document lengths from the index and KEEPS the embeddings", () => {
    // The scar this pins: box 3's embeddings cost a network call each (13,868 of
    // them on the live store), and `resetCache` drops them. A schema addition
    // that reaches for `rebuildCache()` in a process with no embedder configured
    // would silently zero the vector channel. Lengths are a pure function of
    // `doc_tokens`, so the migration is one aggregate and touches nothing else.
    const s = store({ embed: fakeEmbed });
    s.putMany([
      mem("Cold brew every morning, never iced coffee"),
      mem("The dashboard renders ids at render time"),
      mem("Prospective memory holds debts and loses deadlines"),
    ]);
    s.close();
    open.length = 0;

    // Age the cache back to v2 by hand: drop the table and restamp the version.
    const aged = openDb(paths.cache(dir));
    aged.exec("DROP TABLE doc_lens");
    aged.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', '2')");
    const embeddingsBefore = aged.get<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings")?.n;
    const docsInIndex = aged.get<{ n: number }>(
      "SELECT COUNT(DISTINCT memory_id) AS n FROM doc_tokens",
    )?.n;
    aged.close();
    expect(embeddingsBefore).toBe(3);

    // Reopening is the migration — with NO embedder, which is the dangerous case.
    const migrated = store();
    const cache = openDb(paths.cache(dir));
    expect(cache.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = 'schemaVersion'")?.value).toBe(
      String(CACHE_SCHEMA_VERSION),
    );
    expect(cache.get<{ n: number }>("SELECT COUNT(*) AS n FROM doc_lens")?.n).toBe(docsInIndex);
    // The vectors survived a schema change made by a process that could not
    // have recomputed them.
    expect(cache.get<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings")?.n).toBe(3);
    // The lengths are the index's own numbers, not a re-read of prose.
    const byAggregate = cache.all<{ memory_id: string; len: number }>(
      "SELECT memory_id, SUM(tf) AS len FROM doc_tokens GROUP BY memory_id ORDER BY memory_id",
    );
    const stored = cache.all<{ memory_id: string; len: number }>(
      "SELECT memory_id, len FROM doc_lens ORDER BY memory_id",
    );
    expect(stored).toEqual(byAggregate);
    cache.close();
    // And the migrated cache answers cues — normalization has lengths to use.
    expect(migrated.search("coffee").length).toBe(1);
  });

  test("what rebuild cannot recompute is declared, counted, and logged (§5 G8)", () => {
    const s = store(); // no embedder configured
    s.putMany([mem("one"), mem("two")]);
    const report = s.rebuildCache();
    expect(report.indexed).toBe(2);
    expect(report.unrecomputed).toBe(2);
    expect(report.declared).toEqual([
      {
        what: "embeddings",
        owner: "encode/ (the embedder)",
        repair: "Store.open({ embed }) then rebuildCache()",
      },
    ]);
    expect(s.events("cache.rebuild").at(-1)?.data).toMatchObject({
      indexed: 2,
      unrecomputed: 2,
      declaredKinds: "embeddings",
    });
    expect(s.search("one").length).toBe(1); // the text index rebuilt regardless
  });

  test("a removed id is denied at read and skipped-and-logged at rebuild (§16 G12)", () => {
    const s = store();
    const id = s.put(mem("doomed"));
    s.appendRemovalRecord({ memoryId: id, stage: "requested", actor: "owner", reason: "owner op" });
    expect(s.readProse(id).body).toBe("doomed"); // requested is not yet dark
    s.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner" });
    expect(code(() => s.read(id))).toBe("REMOVED");
    expect(s.deniedIds()).toEqual([id]);
    const report = s.rebuildCache();
    expect(report).toMatchObject({ indexed: 0, skippedDenied: 1 });
    expect(s.search("doomed")).toEqual([]);
    // The record is append-only history, not a mutable status field (§16 G8).
    expect(s.removalRecord(id).map((r) => r.stage)).toEqual(["requested", "dark"]);
    // …and it carries no body and no content hash (§16 G9).
    const columns = Object.keys(s.removalRecord(id)[0] ?? {});
    expect(columns).toEqual(["seq", "memory_id", "stage", "at", "actor", "reason"]);
  });
});

// ── the deny-list, consulted at the seam ─────────────────────────────────────

describe("a removed id refuses BY NAME on every read path (§16 G12)", () => {
  /** Dark, then chased: the state a real removal leaves behind. */
  function removed(s: Store, id: string): void {
    s.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner", reason: "test" });
  }

  test("read, readProse, physicsOf and readVersion all name the refusal — never ENOENT", () => {
    const s = store();
    const id = s.put(mem("the doomed one"));
    s.revise(id, { body: "the doomed one, revised" });
    removed(s, id);
    for (const call of [
      () => s.read(id),
      () => s.readProse(id),
      () => s.physicsOf(id),
      () => s.readVersion(id, 1),
    ]) {
      expect(code(call)).toBe("REMOVED");
    }
    // The reason travels with the code: ids and actors, never body text (§5 G10).
    try {
      s.read(id);
    } catch (err) {
      expect((err as StoreError).detail).toEqual({ id, by: "owner" });
    }
  });

  test("an id that never existed is still ID_UNKNOWN — removal is a different absence", () => {
    const s = store();
    expect(code(() => s.read("mem_ffffffffffff"))).toBe("ID_UNKNOWN");
  });

  test("resolve STOPS at a removed id: a lineage pointer lands on it, never past it", () => {
    const s = store();
    const first = s.put(mem("the first belief"));
    const second = s.supersede(first, mem("what it became"));
    removed(s, second);
    // The predecessor's forwarding address still leads somewhere nameable …
    expect(s.resolve(first)).toBe(second);
    // … and what is there refuses by name, which is what makes a renderer print
    // "[removed by the owner]" rather than "a forwarding address with nothing
    // at the end". Dangling and removed are different facts.
    expect(code(() => s.readProse(s.resolve(first)))).toBe("REMOVED");
    expect(s.resolve(second)).toBe(second);
  });

  test("a removed id can never be reborn at the same address", () => {
    const s = store();
    const id = s.put(mem("gone"));
    removed(s, id);
    expect(code(() => s.put(mem("a stray copy restored from a backup", { id })))).toBe("ID_TAKEN");
  });

  test("a stray row is skipped and LOGGED at rebuild, never deleted (§16 G12)", () => {
    const s = store({ embed: fakeEmbed });
    const id = s.put(mem("the doomed one"));
    s.put(mem("a survivor"));
    removed(s, id);
    const report = s.rebuildCache();
    expect(report).toMatchObject({ indexed: 1, skippedDenied: 1 });
    expect(s.events("cache.rebuild.denied").map((e) => e.ref)).toEqual([id]);
    // The row is still THERE — the store deleted nothing; it refused to index it.
    expect(s.row(id)).toBeDefined();
  });
});

// ── opening writes nothing when there is nothing to write ────────────────────

describe("an instrument does not write at open (live-verify 2026-08-25)", () => {
  test("an observer open of a current store leaves the database byte-identical", () => {
    const writer = store();
    writer.put(mem("something to hold"));
    writer.advanceClock("2026-08-25");
    writer.close();
    open.length = 0;
    const before = readFileSync(paths.operational(dir));

    const instrument = store({ observer: true });
    expect(instrument.list().length).toBe(1);
    expect(instrument.livedDay()).toBe(1);
    instrument.close();
    open.length = 0;

    // The bug this pins: the constructor used to run the DDL and four meta
    // upserts on EVERY open, which takes SQLite's write lock — so an instrument
    // could be refused, or refuse someone else, purely by opening. A live
    // `counterparts backup` threw "database is locked" that way.
    expect(readFileSync(paths.operational(dir))).toEqual(before);
  });

  test("a writer opening a current store does not rewrite it either", () => {
    const first = store();
    first.put(mem("already here"));
    first.close();
    open.length = 0;
    const before = readFileSync(paths.operational(dir));
    store().close();
    open.length = 0;
    expect(readFileSync(paths.operational(dir))).toEqual(before);
  });

  test("a store BELOW the read floor refuses under observer rather than migrating itself", () => {
    const writer = store();
    writer.setMeta("schemaVersion", "1");
    writer.close();
    open.length = 0;
    expect(code(() => store({ observer: true }))).toBe("STORE_UNINITIALIZED");
    // A writer may still migrate it — and does, in one transaction, at open.
    const migrated = store();
    expect(migrated.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
  });

  test("the observer read floor is re-decided at EVERY schema bump — it never drifts", () => {
    // The floor is a claim: "every reader of the current version tolerates a
    // store of the floor version as it stands". That claim was true for v5 over
    // v4 because v5 changed only a spelling. A v6 that adds a column would make
    // it false for v4, silently — a v6 instrument would select a column a v4
    // store does not have, the exact failure the v3→v4 refusal existed to
    // prevent. So the constant is pinned to one version behind, and whoever
    // bumps SCHEMA_VERSION must raise the floor (or drop it back to the new
    // version, refusing everything older) on purpose, here.
    expect(OBSERVER_READ_FLOOR).toBe(SCHEMA_VERSION - 1);
  });

  test("a v4 store — the read floor — OPENS under observer, reads, and is left byte-identical", () => {
    // v5 changed only the SPELLING of two path columns and every v5 reader
    // resolves both spellings, so an instrument may read a v4 store as it
    // stands. Refusing would have taken `status`, `verify` and `backup` away
    // from the owner between the merge and the first writer open.
    const writer = store();
    const id = writer.put(mem("readable through a v5 instrument while still v4"));
    writer.setMeta("schemaVersion", String(OBSERVER_READ_FLOOR));
    writer.close();
    open.length = 0;
    const before = readFileSync(paths.operational(dir));
    const observer = store({ observer: true });
    expect(observer.getMeta("schemaVersion")).toBe(String(OBSERVER_READ_FLOOR));
    expect(observer.read(id).doc.body).toBe("readable through a v5 instrument while still v4");
    observer.close();
    open.length = 0;
    expect(readFileSync(paths.operational(dir))).toEqual(before);
    // The writer that follows migrates it, as before.
    expect(store().getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
  });

  test("a v3 store gains the v4 source columns at open — old rows read UNRECORDED, never a fabricated default", async () => {
    const writer = store();
    const id = writer.put(mem("born before provenance existed"));
    writer.close();
    open.length = 0;

    // Regress the file to v3: drop the v4 columns, stamp the old version —
    // a REAL older schema, not a simulated flag.
    const { Database } = await import("bun:sqlite");
    const db = new Database(paths.operational(dir));
    for (const col of ["source", "origin_session", "origin_scope", "origin_ref"]) {
      db.exec(`ALTER TABLE memories DROP COLUMN ${col}`);
    }
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', '3')");
    db.close();

    // A writer migrates at open, in one transaction; the old row's provenance
    // is NULL — unrecorded by name — because a default would fabricate it.
    const migrated = store();
    expect(migrated.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    expect(migrated.row(id)?.source).toBeNull();
    const recorded = migrated.put({
      type: "memory",
      kind: "fact",
      body: "born after the doctrine, with its provenance recorded",
      source: "authored",
      origin: { session: "s9", scope: "proj", ref: "prop_x" },
    });
    expect({
      source: migrated.row(recorded)?.source,
      ref: migrated.row(recorded)?.origin_ref,
    }).toEqual({ source: "authored", ref: "prop_x" });
    migrated.close();
    open.length = 0;

    // The migrated schema and a fresh one MUST be identical, column for column.
    const freshDir = join(dir, "fresh");
    Store.open({ dir: freshDir }).close();
    const info = (path: string): string[] => {
      const d = new Database(path, { readonly: true });
      const rows = d
        .prepare("PRAGMA table_info(memories)")
        .all() as { name: string; type: string; notnull: number; dflt_value: unknown }[];
      // Indexes too (PR-2 review nit): a future ADDED_COLUMNS entry carrying an
      // index would otherwise diverge under a green test.
      const indexes = d.prepare("PRAGMA index_list(memories)").all() as { name: string }[];
      d.close();
      return [
        ...rows.map((r) => `${r.name} ${r.type} ${r.notnull} ${String(r.dflt_value)}`),
        ...indexes.map((i) => `index ${i.name}`),
      ].sort();
    };
    expect(info(paths.operational(dir))).toEqual(info(paths.operational(freshDir)));
  });

  test("a store from a NEWER build is refused, never stamped backwards (SCHEMA_AHEAD)", async () => {
    store().close();
    open.length = 0;
    const { Database } = await import("bun:sqlite");
    const db = new Database(paths.operational(dir));
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', '99')");
    db.close();
    // v4 is the first version doing column surgery: "migrating" a future file
    // would mean rewriting state this build does not understand.
    expect(code(() => store())).toBe("SCHEMA_AHEAD");
    expect(code(() => store({ observer: true }))).toBe("SCHEMA_AHEAD");
  });

  test("an ABSENT store refuses under observer — and leaves NOTHING behind (cli §7)", () => {
    // The wart this closes: an instrument that MINTS a data dir by looking at
    // one. A stood-down hook with an unreadable config was a live path here.
    expect(readdirSync(dir)).toEqual([]);
    expect(code(() => store({ observer: true }))).toBe("STORE_UNINITIALIZED");
    // Refused BEFORE the first mkdir: not a directory, not a cache, not a byte.
    expect(readdirSync(dir)).toEqual([]);
    // The owner mints it; the instrument may then read it.
    store().close();
    open.length = 0;
    expect(store({ observer: true }).list()).toEqual([]);
  });
});

// ── observer mode, at the seam ───────────────────────────────────────────────

describe("observer mode is enforced at the store seam", () => {
  const args: Record<string, unknown[]> = {
    put: [mem("x")],
    putMany: [[mem("x")]],
    revise: ["mem_000000000000", { body: "y" }],
    supersede: ["mem_000000000000", mem("y")],
    archive: ["mem_000000000000", "reason"],
    updatePhysics: ["mem_000000000000", { uses: 1 }],
    reinforce: ["mem_000000000000", 1],
    setBand: ["mem_000000000000", "semantic", 1],
    link: [{ src: "mem_000000000000", dst: "mem_000000000000", weight: 1, day: 0 }],
    linkMany: [[{ src: "mem_000000000000", dst: "mem_000000000000", weight: 1, day: 0 }]],
    setProspective: [
      {
        memoryId: "mem_000000000000",
        windowKey: "w",
        eventDate: "2026-09",
        precision: "month",
        state: "armed",
      },
    ],
    advanceClock: ["2026-08-26"],
    setMeta: ["k", "v"],
    setGateRecords: [[{ sessionId: "s1", kind: "surfaced", ref: "mem_000000000000", turn: 1, lastDay: 0 }]],
    pruneGateSessions: [],
    appendEvent: [{ name: "probe", day: 0 }],
    pruneEvents: [],
    setRanking: [[{ id: "mem_000000000000", strength: 0.5, band: "episodic", day: 0 }]],
    pruneSupersededVersions: [],
    appendRemovalRecord: [{ memoryId: "mem_000000000000", stage: "requested", actor: "owner" }],
    rebuildCache: [],
    pruneDeadIndex: [],
    embedOne: ["mem_0"],
  };

  function populated(): { id: string; snapshot: string } {
    const writer = store();
    const id = writer.put(mem("Mike prefers plain chat over chips"));
    writer.advanceClock("2026-08-25");
    const snapshot = readFileSync(paths.proseFile(dir, "memory", id), "utf8");
    writer.close();
    open.length = 0;
    return { id, snapshot };
  }

  test("every write method refuses, names the site, and leaves a stand-down event", () => {
    const { id, snapshot } = populated();
    const s = store({ observer: true });
    expect(s.observer).toBe(true);
    for (const method of WRITE_METHODS) {
      const call = args[method];
      expect({ method, hasFixture: call !== undefined }).toEqual({ method, hasFixture: true });
      const fn = (s as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[
        method
      ];
      expect(typeof fn).toBe("function");
      expect(code(() => (fn as (...a: unknown[]) => unknown).call(s, ...(call as unknown[])))).toBe(
        "OBSERVER_REFUSED",
      );
      const standdowns = s.events("store.observer.standdown");
      expect(standdowns.at(-1)?.data?.site).toBe(method);
    }
    expect(s.events("store.observer.standdown").length).toBe(WRITE_METHODS.length);
    // Deposits nothing: the canonical prose is byte-identical afterwards.
    expect(readFileSync(paths.proseFile(dir, "memory", id), "utf8")).toBe(snapshot);
    expect(s.list()).toEqual([id]);
    expect(s.livedDay()).toBe(1);
  });

  test("an observer still reads normally, and strengthens nothing", () => {
    const { id } = populated();
    const s = store({ observer: true });
    expect(s.readProse(id).body).toBe("Mike prefers plain chat over chips");
    expect(s.resolve(id)).toBe(id);
    expect(s.physicsOf(id).uses).toBe(0);
    expect(code(() => s.reinforce(id, 1))).toBe("OBSERVER_REFUSED");
    expect(s.physicsOf(id).uses).toBe(0);
  });

  test("the WRITE_METHODS list is total: every stand-down site is in it, and vice versa", () => {
    const src = readFileSync(join(STORE_SRC, "index.ts"), "utf8");
    const sites = new Set<string>();
    for (const m of src.matchAll(/this\.(?:mutate|assertWritable)\(\s*"([a-zA-Z]+)"/g)) {
      sites.add(m[1] as string);
    }
    expect([...sites].sort()).toEqual([...WRITE_METHODS].sort());
    for (const method of WRITE_METHODS) {
      expect(typeof (Store.prototype as unknown as Record<string, unknown>)[method]).toBe(
        "function",
      );
    }
    expect(Object.keys(args).sort()).toEqual([...WRITE_METHODS].sort());
  });

  test("an unreadable stance fails toward standing down (observer-mode.md G5)", () => {
    // The stance needs a store to read: an observer no longer mints one (§7).
    store().close();
    open.length = 0;
    expect(store({ observer: "yes" as unknown as boolean }).observer).toBe(true);
    expect(store({}).observer).toBe(false);
    expect(store({ observer: false }).observer).toBe(false);
  });
});

// ── layout classification ────────────────────────────────────────────────────

describe("layout", () => {
  test("every top-level path is classified as backed-up or explicitly excluded (§5 G11)", () => {
    const s = store({ embed: fakeEmbed });
    s.put(mem("something"));
    s.revise(s.list()[0] as string, { body: "something else" });
    for (const name of readdirSync(dir)) {
      expect({ name, classified: classifyTopLevel(name) !== undefined }).toEqual({
        name,
        classified: true,
      });
    }
    expect(s.backupSet().sort()).toEqual(["operational.sqlite", "prose", "spans", "versions"]);
    // The three rebuildable/ephemeral families: box 3, the write staging area,
    // and the adapters' live-session registry (`adapters/sessions.ts`).
    expect(LAYOUT.filter((e) => !e.backup).map((e) => e.name).sort()).toEqual([
      "cache",
      "sessions",
      "tmp",
    ]);
    s.assertLayout();
  });

  test("an unclassified new directory fails loudly", () => {
    const s = store();
    writeFileSync(join(dir, "surprise-sidecar.json"), "{}", "utf8");
    expect(code(() => s.assertLayout())).toBe("LAYOUT_UNCLASSIFIED");
  });
});

// ── box 3's vectors: float32 BLOBs, and the conversion that gets there ───────

/**
 * The measured debt (LAUNCH-STATUS §E-W1(4)): 177.5 MB of JSON text at ~13.9K
 * vectors, and a `nearest` scan of 590-1,040 ms that `JSON.parse`d every row.
 *
 * The property that had to hold before the shape could move is the one this
 * block leads with: **for a vector whose values are already float32-exact, the
 * scan's scores are BIT-IDENTICAL before and after**. That is not a claim about
 * float32 being lossless in general — it is not, and the general case is pinned
 * separately, as same-order and under 1e-6 — it is the claim that matters here,
 * because an embedder computes and serves single precision and JSON text was
 * storing float64 room that never held float64 information.
 */
describe("vectors are float32 BLOBs (cache v4)", () => {
  /** float32-exact by construction: `Math.fround(x) === x` for every value. */
  function f32Vec(seed: number, dim = 32): number[] {
    const v: number[] = [];
    let x = seed;
    for (let i = 0; i < dim; i++) {
      x = (x * 1664525 + 1013904223) % 4294967296;
      v.push(Math.fround((x / 4294967296) * 2 - 1));
    }
    return v;
  }

  /** Write box 3's rows the way v3 wrote them: `JSON.stringify` into `vec`. */
  function writeJsonVectors(cachePath: string, vecs: Map<string, number[]>): void {
    const db = openDb(cachePath);
    try {
      for (const [id, v] of vecs) {
        db.run(
          "INSERT OR REPLACE INTO embeddings (memory_id, dim, vec) VALUES (?, ?, ?)",
          id,
          v.length,
          JSON.stringify(v),
        );
      }
    } finally {
      db.close();
    }
  }

  /** A vector straight into box 3, bypassing the store — for the orphan case. */
  function setEmbeddingDirect(cachePath: string, id: string, vec: readonly number[]): void {
    const db = openDb(cachePath);
    try {
      db.run(
        "INSERT OR REPLACE INTO embeddings (memory_id, dim, vec) VALUES (?, ?, ?)",
        id,
        vec.length,
        encodeVector(vec),
      );
    } finally {
      db.close();
    }
  }

  test("a written vector is a blob of dim × 4 bytes", () => {
    const s = store({ embed: fakeEmbed });
    const id = s.put(mem("cold brew"));
    s.close();
    open.length = 0;
    const db = openDb(paths.cache(dir));
    const row = db.get<{ dim: number; t: string; bytes: number }>(
      "SELECT dim, typeof(vec) AS t, LENGTH(vec) AS bytes FROM embeddings WHERE memory_id = ?",
      id,
    );
    db.close();
    expect(row?.t).toBe("blob");
    expect(row?.bytes).toBe((row?.dim ?? 0) * 4);
  });

  test("encode/decode round-trips a float32-exact vector EXACTLY", () => {
    const v = f32Vec(7, 64);
    expect(Array.from(decodeVector(encodeVector(v)))).toEqual(v);
  });

  test("the nearest scan is bit-identical before and after the conversion", () => {
    // Build a store, then REPLACE box 3's vectors with v3-shaped JSON text —
    // the exact state the live store is in this morning.
    const s = store();
    const ids = s.putMany([mem("one"), mem("two"), mem("three"), mem("four"), mem("five")]);
    const vecs = new Map(ids.map((id, i) => [id, f32Vec(i + 1, 48)]));
    s.close();
    open.length = 0;
    writeJsonVectors(paths.cache(dir), vecs);

    const probe = f32Vec(99, 48);
    const before = store().nearestTo(probe, 5);
    expect(before.length).toBe(5);
    // Every row really was JSON text when that answer was produced.
    const pre = openDb(paths.cache(dir));
    expect(
      pre.get<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings WHERE typeof(vec) = 'text'")?.n,
    ).toBe(5);
    pre.close();

    const db = openDb(paths.cache(dir));
    expect(convertVectorBatch(db, 2).converted).toBe(2); // batched, not one statement
    expect(convertVectorBatch(db, 2).converted).toBe(2);
    expect(convertVectorBatch(db, 2).converted).toBe(1);
    expect(convertVectorBatch(db, 2).examined).toBe(0); // idempotent: nothing left
    expect(vectorFormats(db)).toMatchObject({ total: 5, float32: 5, jsonText: 0, other: 0 });
    db.close();

    const after = store().nearestTo(probe, 5);
    // Not `toBeCloseTo`, and not just the order: the SAME BITS. `Object.is`
    // rather than `===` so a -0 or a NaN could not slip through as equal.
    expect(after.map((h) => h.id)).toEqual(before.map((h) => h.id));
    for (let i = 0; i < after.length; i++) {
      expect(Object.is(after[i]?.score, before[i]?.score)).toBe(true);
    }
  });

  test("a float64 vector is not float32-exact, and the movement is bounded and ordered", () => {
    // The honest other half. A vector that did NOT come from an embedder — a
    // fixture, a re-serialized float64 — moves by up to one float32 ulp, and
    // the claim that survives is same-order, under 1e-6 on the score.
    const s = store();
    const ids = s.putMany([mem("a"), mem("b"), mem("c"), mem("d")]);
    const rnd = (seed: number, dim: number): number[] => {
      const v: number[] = [];
      let x = seed;
      for (let i = 0; i < dim; i++) {
        x = (x * 48271) % 2147483647;
        v.push(x / 2147483647 - 0.5); // float64, almost never float32-exact
      }
      return v;
    };
    const vecs = new Map(ids.map((id, i) => [id, rnd(i * 977 + 13, 64)]));
    expect([...vecs.values()].every((v) => v.every((x) => Math.fround(x) === x))).toBe(false);
    s.close();
    open.length = 0;
    writeJsonVectors(paths.cache(dir), vecs);

    const probe = rnd(4242, 64);
    const before = store().nearestTo(probe, 4);
    const db = openDb(paths.cache(dir));
    while (convertVectorBatch(db, 3).examined > 0) {
      /* drain */
    }
    db.close();
    const after = store().nearestTo(probe, 4);
    expect(after.map((h) => h.id)).toEqual(before.map((h) => h.id));
    for (let i = 0; i < after.length; i++) {
      expect(Math.abs((after[i]?.score ?? 0) - (before[i]?.score ?? 0))).toBeLessThan(1e-6);
    }
  });

  test("a MIXED cache — an interrupted migration — is read, not crashed on", () => {
    const s = store();
    const ids = s.putMany([mem("one"), mem("two"), mem("three")]);
    const vecs = new Map(ids.map((id, i) => [id, f32Vec(i + 40, 16)]));
    s.close();
    open.length = 0;
    writeJsonVectors(paths.cache(dir), vecs);

    const db = openDb(paths.cache(dir));
    expect(convertVectorBatch(db, 1).converted).toBe(1); // stop one row in
    expect(vectorFormats(db)).toMatchObject({ float32: 1, jsonText: 2 });
    db.close();

    // Both shapes answer, and the converted row still scores its own vector at
    // exactly 1.0 — the decode is not approximating anything.
    const first = ids[0] as string;
    const mixed = store().nearestTo(vecs.get(first) as number[], 3);
    expect(mixed.length).toBe(3);
    expect(mixed[0]?.id).toBe(first);
    expect(Object.is(mixed[0]?.score, 1)).toBe(true);
  });

  test("a v3 table declaring `vec TEXT` still stores a bound BLOB as a BLOB", () => {
    // Affinity, not a constraint — this is why the migration needs no table
    // rewrite. Asserted rather than assumed, because the whole write path
    // depends on SQLite's TEXT affinity leaving a BLOB alone.
    const scratch = mkdtempSync(join(tmpdir(), "counterparts-affinity-"));
    const db = openDb(join(scratch, "affinity.sqlite"));
    db.exec(
      "CREATE TABLE embeddings (memory_id TEXT PRIMARY KEY, dim INTEGER NOT NULL, vec TEXT NOT NULL)",
    );
    db.run(
      "INSERT INTO embeddings (memory_id, dim, vec) VALUES (?, ?, ?)",
      "mem_x",
      4,
      encodeVector([1, 2, 3, 4]),
    );
    expect(db.get<{ t: string }>("SELECT typeof(vec) AS t FROM embeddings")?.t).toBe("blob");
    const back = db.get<{ vec: Uint8Array }>("SELECT vec FROM embeddings")?.vec;
    expect(Array.from(decodeVector(back ?? null))).toEqual([1, 2, 3, 4]);
    db.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  test("embeddingCount() is what box 3 HOLDS — not unembeddedCount()", () => {
    const s = store({ embed: fakeEmbed });
    s.putMany([mem("one"), mem("two")]);
    expect(s.embeddingCount()).toBe(2);
    expect(s.unembeddedCount()).toBe(0);
    const bare = store(); // no embedder: the next row gets no vector
    bare.put(mem("three"));
    expect(bare.embeddingCount()).toBe(2); // still two — the numerator did not move
    expect(bare.unembeddedCount()).toBe(1); // the denominator did
  });

  test("rebuildCache({ keepVectors }) re-indexes the text side and keeps the vectors", () => {
    const s = store({ embed: fakeEmbed });
    const ids = s.putMany([mem("cold brew"), mem("the dashboard"), mem("doomed")]);
    const doomed = ids[2] as string;
    const probeBefore = s.nearestTo(fakeEmbed("cold brew"), 3);
    // One removed id and one orphan: a kept vector must still not survive
    // either of those (§16 G12), or the census would report an orphan forever.
    s.appendRemovalRecord({ memoryId: doomed, stage: "chased", actor: "owner", reason: "owner op" });
    s.close();
    open.length = 0;
    setEmbeddingDirect(paths.cache(dir), "mem_orphan_not_canonical", f32Vec(3, 8));

    // No embedder in the rebuilding process — the dangerous case, and the one
    // `verify --rebuild --keep-vectors` is actually run in.
    const bare = store();
    const report = bare.rebuildCache({ keepVectors: true });
    expect(report.indexed).toBe(2);
    expect(report.skippedDenied).toBe(1);
    // The vectors were there, so nothing is un-recomputed and nothing is declared.
    expect(report.unrecomputed).toBe(0);
    expect(report.declared).toEqual([]);
    expect(report.keptVectors).toBe(2);
    expect(report.droppedVectors).toBe(2); // the removed id and the orphan
    expect(bare.embeddingCount()).toBe(2);
    expect(bare.nearestTo(fakeEmbed("cold brew"), 3).map((h) => h.id)).toEqual(
      probeBefore.filter((h) => h.id !== doomed).map((h) => h.id),
    );
    expect(bare.search("brew").length).toBe(1); // the text index really was rebuilt
  });

  test("a NaN never reaches the scan — it is coerced to 0 and counted", () => {
    // v3 coerced it BY ACCIDENT: `JSON.stringify(NaN)` is `"null"` and
    // `JSON.parse` gave back `null ?? 0`. Writing NaN through would have been a
    // regression dressed as a format change — `nearest` scores it NaN, and the
    // comparator `b.score - a.score || id` reads `NaN - x` as falsy and falls
    // through to the id tiebreak, so one such row sorts anywhere at all.
    expect(Array.from(decodeVector(encodeVector([Number.NaN, 0.5, Infinity, -Infinity])))).toEqual([
      0, 0.5, 0, 0,
    ]);
    expect(countNonFinite([Number.NaN, 0.5, Infinity])).toBe(2);

    const s = store();
    const id = s.putMany([mem("one"), mem("two")])[0] as string;
    s.close();
    open.length = 0;
    writeJsonVectors(paths.cache(dir), new Map([[id, f32Vec(5, 8)]]));
    // A JSON row carrying `null` (which is what v3 wrote for a NaN) converts to
    // a zero, not to a NaN.
    const db = openDb(paths.cache(dir));
    db.run("UPDATE embeddings SET vec = ? WHERE memory_id = ?", "[null,0.5,null]", id);
    const report = convertVectorBatch(db, 10);
    expect(report.converted).toBe(1);
    expect(report.coerced).toBe(2);
    expect(
      Array.from(decodeVector(db.get<{ vec: Uint8Array }>("SELECT vec FROM embeddings")?.vec ?? null)),
    ).toEqual([0, 0.5, 0]);
    db.close();
    expect(store().nearestTo([0, 1, 0], 2).every((h) => Number.isFinite(h.score))).toBe(true);
  });

  test("one unparseable row costs ONE row, not the whole migration", () => {
    // The first version parsed inside the batch transaction: a throw rolled the
    // batch back, the `ORDER BY memory_id LIMIT ?` selection re-picked the same
    // row, and every row after it stayed in the old shape forever.
    const s = store();
    const ids = s.putMany([mem("a"), mem("b"), mem("c"), mem("d")]);
    s.close();
    open.length = 0;
    writeJsonVectors(paths.cache(dir), new Map(ids.map((id, i) => [id, f32Vec(i + 1, 8)])));
    const bad = ids[1] as string;
    const db = openDb(paths.cache(dir));
    db.run("UPDATE embeddings SET vec = ? WHERE memory_id = ?", "not json at all", bad);

    let converted = 0;
    const skipped: string[] = [];
    let after: string | undefined;
    let rounds = 0;
    for (;;) {
      const r = convertVectorBatch(db, 2, after);
      if (r.examined === 0) break;
      converted += r.converted;
      skipped.push(...r.skipped);
      after = r.lastId ?? undefined;
      if (after === undefined || ++rounds > 10) break;
    }
    expect(converted).toBe(3);
    expect(skipped).toEqual([bad]);
    // The bad row is LEFT EXACTLY AS IT WAS — nothing here repairs data it
    // cannot read.
    expect(db.get<{ vec: string }>("SELECT vec FROM embeddings WHERE memory_id = ?", bad)?.vec).toBe(
      "not json at all",
    );
    expect(vectorFormats(db)).toMatchObject({ float32: 3, jsonText: 1 });
    db.close();
  });

  test("a blob whose length is not a multiple of four is unreadable, not truncated", () => {
    // A silently shortened vector is a cosine over a prefix: a wrong number
    // with no signal on it. Empty scores 0 and the census names the row.
    expect(Array.from(decodeVector(new Uint8Array([1, 2, 3, 4, 5])))).toEqual([]);
    const s = store({ embed: fakeEmbed });
    const id = s.put(mem("one"));
    s.close();
    open.length = 0;
    const db = openDb(paths.cache(dir));
    db.run("UPDATE embeddings SET vec = ? WHERE memory_id = ?", new Uint8Array([1, 2, 3, 4, 5]), id);
    expect(vectorFormats(db)).toMatchObject({ total: 1, float32: 0, jsonText: 0, other: 1 });
    db.close();
    expect(store().nearestTo(fakeEmbed("one"), 2)).toEqual([{ id, score: 0 }]);
  });

  test("keepVectors does NOT re-embed a row that already has a vector", () => {
    // The name picks the behaviour. The first version called the embedder for
    // every row and let `indexDoc` overwrite what it had just promised to
    // preserve — a paid network call per row, reported as `keptVectors`.
    const s = store({ embed: fakeEmbed });
    const id = s.put(mem("cold brew"));
    const held = s.nearestTo(fakeEmbed("cold brew"), 1);
    s.close();
    open.length = 0;

    let calls = 0;
    const different = (text: string): number[] => {
      calls += 1;
      return fakeEmbed(text).map((x) => 1 - x);
    };
    const s2 = store({ embed: different });
    const report = s2.rebuildCache({ keepVectors: true });
    expect(calls).toBe(0); // not asked, not charged
    expect(report.keptVectors).toBe(1);
    expect(s2.nearestTo(fakeEmbed("cold brew"), 1)).toEqual(held); // the SAME vector
    expect(s2.search("brew").length).toBe(1); // and the text index still rebuilt

    // A row with NO vector is still embedded — keep is about what is held.
    const fresh = s2.put(mem("a second memory"));
    s2.close();
    open.length = 0;
    const bare = store();
    const db = openDb(paths.cache(dir));
    db.run("DELETE FROM embeddings WHERE memory_id = ?", fresh);
    db.close();
    calls = 0;
    const s3 = Store.open({ dir, embed: different });
    open.push(s3);
    const r3 = s3.rebuildCache({ keepVectors: true });
    expect(calls).toBe(1); // exactly the one that had nothing
    expect(r3.keptVectors).toBe(1);
    expect(bare.embeddingCount()).toBe(2);
  });

  test("the default rebuild still drops the vectors — keepVectors is opt-in", () => {
    const s = store({ embed: fakeEmbed });
    s.putMany([mem("one"), mem("two")]);
    expect(s.embeddingCount()).toBe(2);
    s.close();
    open.length = 0;
    const bare = store();
    const report = bare.rebuildCache();
    expect(bare.embeddingCount()).toBe(0);
    expect(report.unrecomputed).toBe(2);
    expect(report.keptVectors).toBe(0);
  });
});

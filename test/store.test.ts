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
  DATA_DIR_ENV,
  DEFAULT_RETENTION_DAYS,
  LAYOUT,
  SCHEMA_VERSION,
  StoreError,
  Store,
  WRITE_METHODS,
  classifyTopLevel,
  dataDir,
  hashText,
  newId,
  parseProse,
  paths,
  serializeProse,
} from "../src/core/store/index.js";
import type { ProseDoc, PutInput } from "../src/core/store/index.js";

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

  test("falls back to ~/.counterparts when the variable is absent or blank", () => {
    delete process.env[DATA_DIR_ENV];
    expect(dataDir()).toBe(join(homedir(), ".counterparts"));
    process.env[DATA_DIR_ENV] = "   ";
    expect(dataDir()).toBe(join(homedir(), ".counterparts"));
    process.env[DATA_DIR_ENV] = dir;
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
    // Also allowed: the parallel-run instrument's two CLIs, which carry the real
    // read-only paths as DEFAULTS — `test/parallel.test.ts` proves nothing in
    // that tool but its run-dir writer imports a write API.
    const allowed = new Set([
      "src/core/store/paths.ts",
      "src/adapters/claude-code/primacy.ts",
      "tools/parallel/bin/preflight.ts",
      "tools/parallel/bin/daily.ts",
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
    // Pinned by name, so a fourth export cannot appear here quietly. `grantOwnerOps`
    // is the capability handed over by Store's constructor; `chaseRemoved` is the
    // box-2 chase; `REMOVED_REASON` is the word a neutralized row carries.
    expect(Object.keys(mod).filter((k) => k !== "default").sort()).toEqual([
      "REMOVED_REASON",
      "chaseRemoved",
      "grantOwnerOps",
    ]);
    expect(typeof mod["chaseRemoved"]).toBe("function");
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
    expect(report).toEqual({ indexed: 3, skippedDenied: 0, unrecomputed: 0, declared: [] });

    expect(cues.map((c) => s.search(c))).toEqual(before);
    expect(s.nearestTo(fakeEmbed("Cold brew every morning, never iced coffee"), 3)).toEqual(
      vectorBefore,
    );
    expect(ids.map((id) => readFileSync(paths.proseFile(dir, "memory", id), "utf8"))).toEqual(
      proseBefore,
    );
    expect(ids.map((id) => s.physicsOf(id))).toEqual(physicsBefore);
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

  test("a store a schema BEHIND refuses under observer rather than migrating itself", () => {
    const writer = store();
    writer.setMeta("schemaVersion", "1");
    writer.close();
    open.length = 0;
    expect(code(() => store({ observer: true }))).toBe("STORE_UNINITIALIZED");
    // A writer may still migrate it — and does, in one transaction, at open.
    const migrated = store();
    expect(migrated.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
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

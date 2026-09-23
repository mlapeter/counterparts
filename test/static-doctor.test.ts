/**
 * Doctor, for the static tier and for the states in which the store has taken
 * the vector channel away (review of #190, MAJOR 3 and MAJOR 4).
 *
 *   - `kind: "static"` never advises a Voyage key; the `Recall by meaning` line
 *     says what the WORKER saw (its durable backfill row: which table, where
 *     its weights came from, or the code it refused with).
 *   - `held` and `cache-ahead` are read DURABLY by doctor's observer handle and
 *     graded amber with their own ways out; a backfill that could not run is
 *     never green; the Vectors line never promises a count that cannot fall.
 *
 * Hermetic: a fresh temp store and a scratch credentials file per test; the
 * weights resolution in this process is pinned by clearing the one env var.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EMBED_BACKFILL_EVENT } from "../src/core/counterpart.js";
import { STATIC_WEIGHTS_ENV, resolveStaticWeights } from "../src/core/embed/static.js";
import { HELD_EXITS, Store, paths } from "../src/core/store/index.js";
import type { EmbedderIdentity } from "../src/core/store/index.js";
import { openDb } from "../src/core/store/db.js";
import { EMBED_KEY_ENV, doctorFindings, loadCredentials } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig, DoctorInput, Finding } from "../src/adapters/claude-code/index.js";

let root: string;
let dir: string;
let credsPath: string;
let savedEnv: string | undefined;
const opened: Store[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cp-static-doctor-"));
  dir = join(root, "store");
  credsPath = join(root, "credentials.env");
  writeFileSync(credsPath, "", { mode: 0o600 });
  savedEnv = process.env[STATIC_WEIGHTS_ENV];
  delete process.env[STATIC_WEIGHTS_ENV];
});
afterEach(() => {
  for (const s of opened.splice(0)) {
    try {
      s.close();
    } catch {
      // closed
    }
  }
  if (savedEnv === undefined) delete process.env[STATIC_WEIGHTS_ENV];
  else process.env[STATIC_WEIGHTS_ENV] = savedEnv;
  rmSync(root, { recursive: true, force: true });
});

const STATIC: AdapterConfig["embedder"] = { enabled: true, kind: "static" };

function writer(): Store {
  const s = Store.open({ dir });
  opened.push(s);
  return s;
}

/** Doctor's own handle: an observer, exactly as the console and the hook open it. */
function reading(embedder: AdapterConfig["embedder"]): Finding[] {
  const s = Store.open({ dir, observer: true });
  opened.push(s);
  const input: DoctorInput = {
    configPath: join(root, "claude-code.json"),
    configReason: "loaded",
    config: { dataDir: dir, credentialsFile: credsPath, ...(embedder === undefined ? {} : { embedder }) },
    dir,
    credentials: loadCredentials(credsPath, {}),
    credentialsPath: credsPath,
    shellNames: [],
    store: s,
    today: "2026-09-23",
    refusals: {},
  };
  return doctorFindings(input);
}

function by(findings: readonly Finding[], key: string): Finding {
  const f = findings.find((x) => x.key === key);
  if (f === undefined) throw new Error(`no finding '${key}' in ${findings.map((x) => x.key).join(", ")}`);
  return f;
}

function backfillRow(payload: Record<string, string | number | null>): void {
  const s = writer();
  s.appendEvent({ name: EMBED_BACKFILL_EVENT, day: s.livedDay(), payload });
  s.close();
  opened.length = 0;
}

describe("Recall by meaning, for the local table", () => {
  test("the worker could not load the table: amber, the install fix, and never a Voyage key", () => {
    writer().put({ type: "memory", kind: "fact", body: "one memory" });
    opened.splice(0).forEach((s) => s.close());
    backfillRow({ embedded: 0, failed: 0, remaining: 1, attempted: 0, reason: "embedder-unavailable", codes: "NO_WEIGHTS", skipped: 0, kind: "static", weights: null, model: null });
    const f = by(reading(STATIC), "embedder");
    expect(f.severity).toBe("amber");
    expect(f.detail).toContain("NO_WEIGHTS");
    expect(f.fix).toContain("bun add -g counterparts-model-potion");
    expect(f.fix).toContain(STATIC_WEIGHTS_ENV);
    expect(`${f.detail} ${f.fix}`).not.toContain(EMBED_KEY_ENV);
  });

  test("the worker loaded it: green, naming the table and where its weights came from", () => {
    backfillRow({ embedded: 3, failed: 0, remaining: 0, attempted: 3, reason: "ran", codes: "", skipped: 0, kind: "static", weights: "package", model: "potion-base-8M" });
    const f = by(reading(STATIC), "embedder");
    expect(f.severity).toBe("green");
    expect(f.detail).toContain("potion-base-8M");
    expect(f.detail).toContain("package");
    expect(f.detail).not.toContain(EMBED_KEY_ENV);
  });

  test("no worker row yet and no table found from here: amber 'weights not found', with the fix", () => {
    writer();
    opened.splice(0).forEach((s) => s.close());
    const f = by(reading(STATIC), "embedder");
    if (resolveStaticWeights({ env: {} }) !== null) {
      // The package is installed beside this checkout: the line is green instead.
      expect(f.severity).toBe("green");
      return;
    }
    expect(f.severity).toBe("amber");
    expect(f.detail).toContain("weights were not found");
    expect(f.fix).toContain("counterparts-model-potion");
    expect(`${f.detail} ${f.fix}`).not.toContain(EMBED_KEY_ENV);
  });

  test("a table whose bytes do not match its package's declaration: amber, reinstall", () => {
    backfillRow({ embedded: 0, failed: 0, remaining: 0, attempted: 0, reason: "embedder-unavailable", codes: "HASH_MISMATCH", skipped: 0, kind: "static", weights: null, model: null });
    const f = by(reading(STATIC), "embedder");
    expect(f.severity).toBe("amber");
    expect(f.fix).toContain("Reinstall");
  });

  test("a backfill that could not run is NOT green", () => {
    backfillRow({ embedded: 0, failed: 0, remaining: 5, attempted: 0, reason: "embedder-unavailable", codes: "NO_WEIGHTS", skipped: 0, kind: "static", weights: null, model: null });
    expect(by(reading(STATIC), "backfill").severity).toBe("amber");
  });
});

describe("held and cache-ahead, read durably by doctor's observer handle", () => {
  function heldStore(): void {
    const a = Object.assign((t: string): number[] | null => [t.length, 1, 2], {
      identity: { model: "voyage-3-large", dim: null, rebuild: "external" } satisfies EmbedderIdentity,
    });
    const s = Store.open({ dir, embed: a });
    s.put({ type: "memory", kind: "fact", body: "The otter holt is by the river." });
    s.put({ type: "memory", kind: "fact", body: "The survey resumes after the flood." });
    s.close();
    const b = Object.assign((): number[] | null => null, {
      identity: { model: "voyage-3.5", dim: null, rebuild: "external" } satisfies EmbedderIdentity,
    });
    Store.open({ dir, embed: b }).close();
  }

  test("held: amber, both counts named, and the two ways out", () => {
    heldStore();
    const f = by(reading({ enabled: true }), "embedder");
    expect(f.severity).toBe("amber");
    expect(f.detail).toContain("held");
    expect(f.detail).toContain("voyage-3-large@3");
    expect(f.detail).toContain("voyage-3.5");
    expect(f.fix).toContain("verify --rebuild --drop-vectors");
    expect(f.fix).toContain("put the embedder configuration back");
    expect(HELD_EXITS).toContain("verify --rebuild --drop-vectors");
  });

  test("held: the withdrawn backfill row is amber, and the Vectors line does not promise to fall", () => {
    heldStore();
    backfillRow({ embedded: 0, failed: 0, remaining: 0, attempted: 0, reason: "vectors-withdrawn", codes: "held", skipped: 0, kind: "voyage", weights: null, model: "voyage-3.5" });
    const findings = reading({ enabled: true });
    expect(by(findings, "backfill").severity).toBe("amber");
    expect(by(findings, "backfill").detail).toContain("withdrawn");
    const v = by(findings, "vectors");
    expect(v.detail).toContain("withdrawn (held)");
    expect(v.fix).not.toContain("must fall");
  });

  test("cache-ahead: amber, update and reconnect", () => {
    writer().put({ type: "memory", kind: "fact", body: "one memory" });
    opened.splice(0).forEach((s) => s.close());
    const db = openDb(paths.cache(dir));
    db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', '6')");
    db.close();
    const f = by(reading(STATIC), "embedder");
    expect(f.severity).toBe("amber");
    expect(f.detail).toContain("cache v6");
    expect(f.fix).toContain("/mcp");
    expect(f.fix).toContain("Reconnect");
  });
});

/**
 * THE RUNTIME DEFAULT FOR AN ABSENT `embedder` BLOCK (roadmap C3, coordinator's
 * ruling 2026-09-23): the local table, ON — unless the credentials FILE holds a
 * Voyage key, which keeps a 0.2.0 setup as it was.
 *
 *   - the rule itself (`config.ts#resolveEmbedder` / `withEmbedderDefault`);
 *   - every seam that builds a process's configuration applies it the same way:
 *     the hook (`hostConfig`), the worker (`runnerConfig`), the MCP server
 *     (`questionEmbedder`) and the console (doctor's reading);
 *   - "saved" is the FILE, never the environment.
 *
 * Hermetic: a fresh temp dir per test; the weights are pinned by the one
 * environment variable (an empty folder) so no test depends on whether the
 * weights package is installed in this checkout.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { STATIC_WEIGHTS_ENV } from "../src/core/embed/static.js";
import {
  DEFAULT_EMBEDDER,
  EMBED_KEY_ENV,
  resolveEmbedder,
  withEmbedderDefault,
} from "../src/adapters/claude-code/config.js";
import { hostConfig } from "../src/adapters/claude-code/bin/hook.js";
import { runnerConfig } from "../src/adapters/claude-code/bin/runner.js";
import { questionEmbedder } from "../src/adapters/mcp/bin/serve.js";
import { Store } from "../src/core/store/index.js";
import { EXIT, run } from "../src/adapters/cli/index.js";
import { openEmbedder } from "../src/adapters/claude-code/embed-client.js";

let root: string;
let configPath: string;
let credsPath: string;
let savedWeights: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cp-embedder-default-"));
  configPath = join(root, "claude-code.json");
  credsPath = join(root, "credentials.env");
  savedWeights = process.env[STATIC_WEIGHTS_ENV];
  const empty = join(root, "no-table");
  mkdirSync(empty, { recursive: true });
  process.env[STATIC_WEIGHTS_ENV] = empty;
});

afterEach(() => {
  if (savedWeights === undefined) delete process.env[STATIC_WEIGHTS_ENV];
  else process.env[STATIC_WEIGHTS_ENV] = savedWeights;
  rmSync(root, { recursive: true, force: true });
});

function writeConfig(over: Record<string, unknown> = {}): void {
  writeFileSync(
    configPath,
    JSON.stringify({ dataDir: join(root, "store"), credentialsFile: credsPath, owner: true, ...over }, null, 2),
  );
}

function writeCreds(lines: readonly string[]): void {
  writeFileSync(credsPath, `${lines.join("\n")}\n`, { mode: 0o600 });
}

describe("resolveEmbedder — the rule", () => {
  test("an explicit block is used exactly as written, on or off, either kind", () => {
    for (const embedder of [
      { enabled: false },
      { enabled: true, kind: "voyage" as const },
      { enabled: true },
      { enabled: false, kind: "static" as const },
    ]) {
      for (const saved of [true, false]) {
        const r = resolveEmbedder({ embedder }, saved);
        expect(r.source).toBe("explicit");
        expect(r.block).toEqual(embedder);
      }
    }
  });

  test("no block and no Voyage key saved: the local table, ON", () => {
    const r = resolveEmbedder({ dataDir: "/x" }, false);
    expect(r.source).toBe("default-static");
    expect(r.block).toEqual({ enabled: true, kind: "static" });
    expect(withEmbedderDefault({ dataDir: "/x" }, false).embedder).toEqual(DEFAULT_EMBEDDER);
  });

  test("no block and a Voyage key saved: nothing assumed — the 0.2.0 reading", () => {
    const r = resolveEmbedder({ dataDir: "/x" }, true);
    expect(r.source).toBe("absent-voyage-key");
    expect(r.block).toBeUndefined();
    expect(withEmbedderDefault({ dataDir: "/x" }, true).embedder).toBeUndefined();
  });

  test("an observer — which is what an unreadable configuration becomes — has nothing assumed", () => {
    const r = resolveEmbedder({ observer: true }, false);
    expect(r.source).toBe("absent-observer");
    expect(withEmbedderDefault({ observer: true }, false).embedder).toBeUndefined();
  });
});

describe("every process applies the same default", () => {
  test("the hook: no block → the local table; a Voyage key in the FILE → nothing", () => {
    writeConfig();
    writeCreds(["# nothing"]);
    expect(hostConfig(configPath, {}).config.embedder).toEqual({ enabled: true, kind: "static" });
    writeCreds([`${EMBED_KEY_ENV}=pa-not-a-real-key-0123`]);
    expect(hostConfig(configPath, {}).config.embedder).toBeUndefined();
  });

  test("the hook: a Voyage key the ENVIRONMENT answers, but the file holds too, still counts as saved", () => {
    writeConfig();
    writeCreds([`${EMBED_KEY_ENV}=pa-not-a-real-key-0123`]);
    // The environment wins the VALUE (`skippedPresent`); the file still holds the name.
    expect(hostConfig(configPath, { [EMBED_KEY_ENV]: "pa-from-the-shell" }).config.embedder).toBeUndefined();
  });

  test("the hook: a Voyage key only in the ENVIRONMENT is not 'saved' — the table is on", () => {
    writeConfig();
    writeCreds(["# nothing"]);
    expect(hostConfig(configPath, { [EMBED_KEY_ENV]: "pa-from-the-shell" }).config.embedder).toEqual({
      enabled: true,
      kind: "static",
    });
  });

  test("the hook: an explicit { enabled: false } stays off", () => {
    writeConfig({ embedder: { enabled: false } });
    writeCreds(["# nothing"]);
    expect(hostConfig(configPath, {}).config.embedder).toEqual({ enabled: false });
  });

  test("the worker reads the same default as the hook", () => {
    writeConfig();
    writeCreds(["# nothing"]);
    expect(runnerConfig(configPath, {}).config.embedder).toEqual({ enabled: true, kind: "static" });
    writeCreds([`${EMBED_KEY_ENV}=pa-not-a-real-key-0123`]);
    expect(runnerConfig(configPath, {}).config.embedder).toBeUndefined();
  });

  test("the MCP server builds an embedder for the default, and none beside a saved Voyage key", () => {
    writeConfig();
    writeCreds(["# nothing"]);
    // The table is pinned to an empty folder: the embedder is BUILT (it names
    // its refusal when used), which is the difference from no embedder at all.
    expect(questionEmbedder(configPath, {}).embedder).not.toBeNull();
    writeCreds([`${EMBED_KEY_ENV}=pa-not-a-real-key-0123`]);
    expect(questionEmbedder(configPath, {}).embedder).toBeNull();
  });
});

describe("doctor, on a configuration with no embedder block", () => {
  async function doctorJson(): Promise<{ key: string; severity: string; optional?: boolean; detail: string; fix: string }[]> {
    Store.open({ dir: join(root, "store") }).close();
    const out: string[] = [];
    await run(["doctor", `--config=${configPath}`, "--json"], {
      io: { out: (l) => out.push(l), err: () => {} },
      env: {},
      home: root,
    });
    return (JSON.parse(out.join("\n")) as { findings: { key: string; severity: string; optional?: boolean; detail: string; fix: string }[] }).findings;
  }

  test("no Voyage key: Recall by meaning is the local table's line, not OFF", async () => {
    writeConfig();
    writeCreds(["# nothing"]);
    const f = (await doctorJson()).find((x) => x.key === "embedder");
    expect(f?.optional).toBeUndefined();
    expect(f?.detail).toContain("a local table");
    // The table is pinned to an empty folder here, so the line is amber with its fix.
    expect(f?.severity).toBe("amber");
    expect(f?.fix).toContain("counterparts-model-potion");
  });

  test("a Voyage key saved: OFF, and it SAYS why the table was not assumed, with the command that turns it on", async () => {
    writeConfig();
    writeCreds([`${EMBED_KEY_ENV}=pa-not-a-real-key-0123`]);
    const findings = await doctorJson();
    const f = findings.find((x) => x.key === "embedder");
    expect(f?.optional).toBe(true);
    expect(f?.detail).toContain("a Voyage key is saved here and this configuration names no embedder");
    expect(f?.fix).toBe("Turn on: counterparts install --force --embedder");
    // Nothing to embed, nothing to count.
    expect(findings.find((x) => x.key === "vectors")).toBeUndefined();
  });
});

// ── review of #195, MAJOR 1: the fix line never switches Voyage on ─────────

describe("following doctor's `Turn on:` line opens no socket", () => {
  const VOYAGE_KEY_LINE = `${EMBED_KEY_ENV}=pa-not-a-real-key-0123`;

  /** Run the command doctor's fix line names, piped (the scripted arm). */
  async function followTheFixLine(): Promise<void> {
    const out: string[] = [];
    const code = await run(["install", "--config", configPath, "--force", "--embedder", "--budget", "9000"], {
      io: { out: (l) => out.push(l), err: (l) => out.push(l) },
      env: {},
      home: root,
    });
    expect(code, out.join("\n")).toBe(EXIT.ok);
  }

  /**
   * Every `fetch` counted, none answered. The config is loaded the way the hook
   * loads it — the credentials file fills THIS process's environment, so the
   * Voyage key really is present — and the embedder the hook would build is
   * asked for a vector and a batch.
   */
  async function socketsAfter(): Promise<{ calls: number; kind: string | undefined }> {
    const saved = process.env[EMBED_KEY_ENV];
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    try {
      const { config } = hostConfig(configPath, process.env);
      const embedder = openEmbedder(config);
      if (embedder !== null) {
        await embedder.vector("the espresso machine in the kitchen");
        await embedder.warm(["postgres in dev listens on 5433", "a second memory"]);
      }
      return { calls, kind: config.embedder?.kind };
    } finally {
      globalThis.fetch = realFetch;
      if (saved === undefined) delete process.env[EMBED_KEY_ENV];
      else process.env[EMBED_KEY_ENV] = saved;
    }
  }

  const shapes: readonly { name: string; block: Record<string, unknown> }[] = [
    { name: "kind-less { enabled: false } beside a saved Voyage key", block: { enabled: false } },
    { name: '{ enabled: false, kind: "voyage" }', block: { enabled: false, kind: "voyage" } },
    { name: "a 0.2.0 Voyage setup switched OFF by --force --no-embedder", block: { enabled: true } },
  ];

  for (const shape of shapes) {
    test(`${shape.name} → the local table, and ZERO network calls`, async () => {
      writeConfig({ embedder: shape.block });
      writeCreds([VOYAGE_KEY_LINE]);
      if (shape.block["enabled"] === true) {
        // The third shape is reached through the command a person would type.
        const out: string[] = [];
        expect(
          await run(["install", "--config", configPath, "--force", "--no-embedder", "--budget", "9000"], {
            io: { out: (l) => out.push(l), err: (l) => out.push(l) },
            env: {},
            home: root,
          }),
        ).toBe(EXIT.ok);
      }
      await followTheFixLine();
      const after = await socketsAfter();
      expect(after.kind).toBe("static");
      expect(after.calls).toBe(0);
    });
  }

  test("the trap is real: a RUNNING Voyage block does reach for the network (the control)", async () => {
    writeConfig({ embedder: { enabled: true, kind: "voyage" } });
    writeCreds([VOYAGE_KEY_LINE]);
    const after = await socketsAfter();
    expect(after.kind).toBe("voyage");
    expect(after.calls).toBeGreaterThan(0);
  });
});

// ── review of #195, MINOR 3: a config that names no credentials file ───────

describe("a hand-written configuration with NO credentialsFile, and a sibling credentials.env", () => {
  test("the hook, the worker, the server AND doctor agree: the sibling is not read, so the table is ON", async () => {
    // Only `dataDir` and `owner` — install always writes `credentialsFile`, so
    // this is the hand-written shape. The sibling holds a Voyage key that no
    // hook reads (config.ts: a file the config NAMES, never one by convention).
    writeFileSync(configPath, JSON.stringify({ dataDir: join(root, "store"), owner: true }, null, 2));
    writeCreds([`${EMBED_KEY_ENV}=pa-not-a-real-key-0123`]);
    const want = { enabled: true, kind: "static" as const };
    expect(hostConfig(configPath, {}).config.embedder).toEqual(want);
    expect(runnerConfig(configPath, {}).config.embedder).toEqual(want);
    expect(questionEmbedder(configPath, {}).embedder).not.toBeNull();

    Store.open({ dir: join(root, "store") }).close();
    const out: string[] = [];
    await run(["doctor", `--config=${configPath}`, "--json"], {
      io: { out: (l) => out.push(l), err: () => {} },
      env: {},
      home: root,
    });
    const findings = (JSON.parse(out.join("\n")) as { findings: { key: string; optional?: boolean; detail: string }[] }).findings;
    const embedder = findings.find((f) => f.key === "embedder");
    expect(embedder?.optional).toBeUndefined();
    expect(embedder?.detail).toContain("a local table");
    // And the credentials line reports what the hooks have: no file.
    expect(findings.find((f) => f.key === "credentials")?.detail).toContain("no credentialsFile in the config");
  });
});

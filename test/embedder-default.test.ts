/**
 * THE RUNTIME DEFAULT FOR AN ABSENT `embedder` BLOCK (roadmap C3, coordinator's
 * ruling 2026-09-23): the local table, ON. (Until 2026-09-24 a saved Voyage key
 * kept an absent block off; the keys were removed, and so was that exception.)
 *
 *   - the rule itself (`config.ts#resolveEmbedder` / `withEmbedderDefault`);
 *   - every seam that builds a process's configuration applies it the same way:
 *     the hook (`hostConfig`), the worker (`runnerConfig`), the MCP server
 *     (`questionEmbedder`) and the console (doctor's reading);
 *   - a configuration that still names the removed Voyage seat, or still names
 *     a credentials file, gets the local table and opens no socket.
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
import { DEFAULT_EMBEDDER, loadConfig, resolveEmbedder, withEmbedderDefault } from "../src/adapters/claude-code/config.js";
import { hostConfig } from "../src/adapters/claude-code/bin/hook.js";
import { runnerConfig } from "../src/adapters/claude-code/bin/runner.js";
import { questionEmbedder } from "../src/adapters/mcp/bin/serve.js";
import { Store } from "../src/core/store/index.js";
import { EXIT, run } from "../src/adapters/cli/index.js";
import { openEmbedder } from "../src/adapters/claude-code/embed-client.js";

let root: string;
let configPath: string;
let savedWeights: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cp-embedder-default-"));
  configPath = join(root, "claude-code.json");
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
  writeFileSync(configPath, JSON.stringify({ dataDir: join(root, "store"), owner: true, ...over }, null, 2));
}

describe("resolveEmbedder — the rule", () => {
  test("an explicit block is used exactly as written, on or off", () => {
    for (const embedder of [{ enabled: false }, { enabled: true }, { enabled: false, kind: "static" as const }]) {
      const r = resolveEmbedder({ embedder });
      expect(r.source).toBe("explicit");
      expect(r.block).toEqual(embedder);
    }
  });

  test("no block: the local table, ON", () => {
    const r = resolveEmbedder({ dataDir: "/x" });
    expect(r.source).toBe("default-static");
    expect(r.block).toEqual({ enabled: true, kind: "static" });
    expect(withEmbedderDefault({ dataDir: "/x" }).embedder).toEqual(DEFAULT_EMBEDDER);
  });

  test("an observer — which is what an unreadable configuration becomes — has nothing assumed", () => {
    const r = resolveEmbedder({ observer: true });
    expect(r.source).toBe("absent-observer");
    expect(withEmbedderDefault({ observer: true }).embedder).toBeUndefined();
  });

  test('`kind: "voyage"` — the removed seat — is read as the local table, and named, never refused', () => {
    for (const enabled of [true, false]) {
      const loaded = loadConfig({ dataDir: "/x", embedder: { enabled, kind: "voyage" } });
      expect(loaded.ok).toBe(true);
      expect(loaded.config.observer).toBeUndefined();
      expect(loaded.config.embedder).toEqual({ enabled, kind: "static" });
      expect((loaded.config.retired ?? []).join(" ")).toContain('"embedder.kind" "voyage" is no longer available');
    }
    // Any OTHER kind on an enabled block is still unreadable, not guessed at.
    const typo = loadConfig({ dataDir: "/x", embedder: { enabled: true, kind: "statik" } });
    expect(typo.ok).toBe(false);
    expect(typo.unreadableKeys).toEqual(["embedder.kind"]);
  });
});

describe("every process applies the same default", () => {
  test("the hook: no block → the local table, whatever a credentials file beside it holds", () => {
    writeConfig({ credentialsFile: join(root, "credentials.env") });
    writeFileSync(join(root, "credentials.env"), "VOYAGE_" + "API_KEY=pa-not-a-real-key-0123\n", { mode: 0o600 });
    expect(hostConfig(configPath).config.embedder).toEqual({ enabled: true, kind: "static" });
  });

  test("the hook: an explicit { enabled: false } stays off", () => {
    writeConfig({ embedder: { enabled: false } });
    expect(hostConfig(configPath).config.embedder).toEqual({ enabled: false });
  });

  test("the worker reads the same default as the hook", () => {
    writeConfig();
    expect(runnerConfig(configPath, {}).config.embedder).toEqual({ enabled: true, kind: "static" });
  });

  test("the MCP server builds an embedder for the default", () => {
    writeConfig();
    // The table is pinned to an empty folder: the embedder is BUILT (it names
    // its refusal when used), which is the difference from no embedder at all.
    expect(questionEmbedder(configPath).embedder).not.toBeNull();
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

  test("Recall by meaning is the local table's line, not OFF", async () => {
    writeConfig();
    const findings = await doctorJson();
    const f = findings.find((x) => x.key === "embedder");
    expect(f?.optional).toBeUndefined();
    expect(f?.detail).toContain("a local table");
    // The table is pinned to an empty folder here, so the line is amber with its fix.
    expect(f?.severity).toBe("amber");
    expect(f?.fix).toContain("counterparts-model-potion");
    // No credentials line of any kind: there are no keys.
    expect(findings.find((x) => x.key === "credentials")).toBeUndefined();
    expect(findings.find((x) => x.key === "credentials-mode")).toBeUndefined();
  });
});

// ── a configuration that still names the removed seat opens no socket ──────

describe("a configuration naming Voyage, or a credentials file, opens no socket", () => {
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
   * loads it, and the embedder the hook would build is asked for a vector and a
   * batch.
   */
  async function socketsAfter(): Promise<{ calls: number; kind: string | undefined }> {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    try {
      const { config } = hostConfig(configPath);
      const embedder = openEmbedder(config);
      if (embedder !== null) {
        await embedder.vector("the espresso machine in the kitchen");
        await embedder.warm(["postgres in dev listens on 5433", "a second memory"]);
      }
      return { calls, kind: config.embedder?.kind };
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  const shapes: readonly { name: string; block: Record<string, unknown> }[] = [
    { name: '{ enabled: true, kind: "voyage" } (a running 0.2.0 Voyage setup)', block: { enabled: true, kind: "voyage" } },
    { name: '{ enabled: false, kind: "voyage" }', block: { enabled: false, kind: "voyage" } },
    { name: "kind-less { enabled: true } (how 0.2.0 said Voyage)", block: { enabled: true } },
  ];

  for (const shape of shapes) {
    test(`${shape.name}, beside a credentials file holding a key → the local table, and ZERO network calls`, async () => {
      const creds = join(root, "credentials.env");
      writeFileSync(creds, "VOYAGE_" + "API_KEY=pa-not-a-real-key-0123\n", { mode: 0o600 });
      writeConfig({ embedder: shape.block, credentialsFile: creds });
      if (shape.block["enabled"] === true) {
        const before = await socketsAfter();
        expect(before.calls).toBe(0);
      }
      await followTheFixLine();
      const after = await socketsAfter();
      expect(after.kind).toBe("static");
      expect(after.calls).toBe(0);
    });
  }
});

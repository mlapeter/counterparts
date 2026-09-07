/**
 * THE ONE CONFIG RULE, at every entry point that reads a `claude-code.json`.
 *
 * `--config <absolute path>`, else `COUNTERPARTS_CONFIG`, else the documented
 * default — and the default has not moved. That last clause is the one that
 * matters most here: `claude-code/bin/hook.ts` runs on the owner's live host at
 * the next hook event, and it passes neither the flag nor the variable, so the
 * no-flag no-env case must resolve exactly what it resolved before this rule
 * existed (`test("the default is unchanged…")` below, and the process-level
 * proof at the bottom).
 *
 * Six of the tests here run REAL PROCESSES, which is what makes them worth
 * having: the flag has to survive `bun run <script> --config <path>` (bun has a
 * `--config` of its own), and "wrote to the scratch store and NOT to the home
 * one" is a claim about a filesystem, not about a function. Each spawn gets an
 * explicit `env` carrying a temp `HOME` — the preload's rule for children — and
 * no API keys at all, so no worker starts and nothing is ever billed.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  CONFIG_ENV,
  CONFIG_FILE_EVENT,
  CONFIG_FLAG,
  configFlag,
  configLine,
  defaultConfigPath,
  implicitConfigRefusal,
  isNamed,
  namedConfigRefusal,
  namedUnreadableRefusal,
  resolveConfigPath,
} from "../src/adapters/config-path.js";
import { REQUIRE_EXPLICIT_DIR_ENV } from "../src/core/store/index.js";
import { recordSession, readSession } from "../src/adapters/sessions.js";
import { CONFIG_PATH as HOOK_CONFIG_PATH, hookConfigChoice } from "../src/adapters/claude-code/bin/hook.js";
import {
  CONFIG_PATH as RUNNER_CONFIG_PATH,
  runnerConfigChoice,
} from "../src/adapters/claude-code/bin/runner.js";
import {
  CONFIG_PATH as SERVE_CONFIG_PATH,
  serverConfigChoice,
} from "../src/adapters/mcp/bin/serve.js";
import { CONFIG_ENV as SPAWN_CONFIG_ENV, planSpawn } from "../src/adapters/claude-code/spawn.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import { EXIT, hostCeiling, run } from "../src/adapters/cli/commands.js";
import type { Io } from "../src/adapters/cli/commands.js";
import { hookCommand, mcpCommand, installLayout } from "../src/adapters/cli/install.js";

const HOOK_SCRIPT = resolve(import.meta.dir, "../src/adapters/claude-code/bin/hook.ts");
const RUNNER_SCRIPT = resolve(import.meta.dir, "../src/adapters/claude-code/bin/runner.ts");
const SERVE_SCRIPT = resolve(import.meta.dir, "../src/adapters/mcp/bin/serve.ts");

let work: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "counterparts-config-rule-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(work, { recursive: true, force: true });
});

function consoleWith(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

/** A config file naming a store, written where the test says. */
function writeConfig(path: string, body: Record<string, unknown>): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
  return path;
}

/**
 * Every file under `root`, hashed by relative path and content.
 *
 * The subtree the hook tests hash is `<home>/.counterparts` — OURS. The temp
 * home also collects `Library/Caches/bun`, the runtime's own transpiler cache,
 * written by bun on any run of any script; it says nothing about what this
 * package touched.
 */
function treeHash(root: string): string {
  const h = createHash("sha256");
  const walk = (dir: string, prefix: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      const rel = `${prefix}${name}`;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        h.update(`D ${rel}\n`);
        walk(full, `${rel}/`);
      } else {
        h.update(`F ${rel} `);
        try {
          h.update(readFileSync(full));
        } catch {
          h.update("<unreadable>");
        }
        h.update("\n");
      }
    }
  };
  walk(root, "");
  return h.digest("hex");
}

describe("the rule itself", () => {
  test("the default is unchanged: ~/.counterparts/claude-code.json, and nothing else", () => {
    const home = join(work, "home");
    expect(defaultConfigPath(home)).toBe(join(home, ".counterparts", "claude-code.json"));
    // The three entry points' own constants resolve THE SAME default path, from
    // the real (test-redirected) home. This is the master-parity assertion: a
    // no-flag, no-env run resolves what it resolved before the rule existed.
    const expected = join(homedir(), ".counterparts", "claude-code.json");
    expect(HOOK_CONFIG_PATH).toBe(expected);
    expect(RUNNER_CONFIG_PATH).toBe(expected);
    expect(SERVE_CONFIG_PATH).toBe(expected);
    expect(resolveConfigPath([], {}, homedir()).path).toBe(expected);
    expect(resolveConfigPath([], {}, homedir()).source).toBe("default");
    expect(resolveConfigPath([], {}, homedir()).refusal).toBe(null);
  });

  test("flag beats environment beats default, at every entry point", () => {
    const home = join(work, "home");
    const flagged = join(work, "flag", "claude-code.json");
    const fromEnv = join(work, "env", "claude-code.json");
    const env = { [CONFIG_ENV]: fromEnv };

    for (const choose of [
      (argv: string[], e: Record<string, string | undefined>) => resolveConfigPath(argv, e, home),
      (argv: string[], e: Record<string, string | undefined>) => hookConfigChoice(argv, e),
      (argv: string[], e: Record<string, string | undefined>) => runnerConfigChoice(argv, e),
      (argv: string[], e: Record<string, string | undefined>) => serverConfigChoice(argv, e),
    ]) {
      expect(choose([CONFIG_FLAG, flagged], env).path).toBe(flagged);
      expect(choose([CONFIG_FLAG, flagged], env).source).toBe(CONFIG_FLAG);
      expect(choose([], env).path).toBe(fromEnv);
      expect(choose([], env).source).toBe(CONFIG_ENV);
      expect(choose([], {}).source).toBe("default");
    }
  });

  test("`--config=<path>` is the same flag, and other arguments are left alone", () => {
    const path = join(work, "a", "claude-code.json");
    expect(configFlag([`${CONFIG_FLAG}=${path}`])).toBe(path);
    expect(configFlag(["--dir", "/x", CONFIG_FLAG, path, "--owner"])).toBe(path);
    expect(configFlag(["--dir", "/x"])).toBeUndefined();
  });

  test("a relative path, or a flag with nothing after it, REFUSES — it never falls back", () => {
    const bad = resolveConfigPath([CONFIG_FLAG, "claude-code.json"], {}, work);
    expect(bad.refusal).toContain("ABSOLUTE");
    // The refusal names no default: falling back to one is the failure this
    // whole rule exists to prevent (a scratch run writing into a live store).
    expect(bad.path).toBe("claude-code.json");
    expect(resolveConfigPath([CONFIG_FLAG], {}, work).refusal).toContain("given nothing");
    expect(resolveConfigPath([CONFIG_FLAG, "--dir"], {}, work).refusal).toContain("given nothing");
    expect(resolveConfigPath([], { [CONFIG_ENV]: "rel/path.json" }, work).refusal).toContain(
      "ABSOLUTE",
    );
  });

  test("a NAMED file that is not there refuses; an absent DEFAULT is ordinary", () => {
    // The hole the first review of this rule found: an absolute path to a file
    // that does not exist was honoured silently — read as an absent config,
    // resolved to observer, and then fallen through to `dataDir()`, which on a
    // machine with an install is the live store.
    const missing = join(work, "nowhere", "claude-code.json");
    expect(namedConfigRefusal(resolveConfigPath([CONFIG_FLAG, missing], {}, work))).toContain(
      "could not be read",
    );
    expect(namedConfigRefusal(resolveConfigPath([], { [CONFIG_ENV]: missing }, work))).toContain(
      "could not be read",
    );
    // The DEFAULT is allowed to be absent: a fresh machine has no config and the
    // hook still has to stand up as an observer.
    expect(namedConfigRefusal(resolveConfigPath([], {}, join(work, "fresh-home")))).toBe(null);
    // A named file that is there, and is an object, is honoured.
    const good = writeConfig(join(work, "good", "claude-code.json"), { dataDir: work });
    expect(namedConfigRefusal(resolveConfigPath([CONFIG_FLAG, good], {}, work))).toBe(null);
    // A named file that is NOT a JSON object would resolve to observer — a
    // stand-down nobody asked for. It says so instead.
    const junk = join(work, "junk", "claude-code.json");
    mkdirSync(join(junk, ".."), { recursive: true });
    writeFileSync(junk, "not json at all\n");
    expect(namedConfigRefusal(resolveConfigPath([CONFIG_FLAG, junk], {}, work))).toContain(
      "not a JSON object",
    );
  });

  test("the PINNED DEFAULT is not a named config, however it arrived", () => {
    // The collision found while reviewing the missing-file refusal: `spawn.ts`
    // pins the parent's resolved path onto every worker, the default included,
    // so a machine with NO `~/.counterparts/claude-code.json` — which is
    // ordinary, the hook stands up as an observer — would hand its worker a
    // "named" config that is not there, and the worker would stand down.
    // Nothing would ever sweep or sleep on such a machine. The test is the
    // PATH, the same rule `install` uses to decide whether to print a flag.
    const emptyHome = join(work, "empty-home");
    const pinnedDefault = {
      path: defaultConfigPath(emptyHome),
      source: CONFIG_ENV,
      refusal: null,
    } as const;
    expect(isNamed(pinnedDefault, emptyHome)).toBe(false);
    expect(namedConfigRefusal(pinnedDefault, undefined, emptyHome)).toBe(null);
    expect(namedUnreadableRefusal(pinnedDefault, "unreadable", emptyHome)).toBe(null);
    // A path that really is elsewhere is still named, however it arrived.
    const elsewhere = {
      path: join(work, "elsewhere", "claude-code.json"),
      source: CONFIG_ENV,
      refusal: null,
    } as const;
    expect(isNamed(elsewhere, emptyHome)).toBe(true);
  });

  test("a NAMED config that parses but does not typecheck refuses; a default does not", () => {
    // `loadConfig` reports `unreadable` for a file whose fields are the wrong
    // type and resolves it to `{ observer: true }` — the right fail direction
    // for a config nobody named, and the wrong one for a file the operator
    // pointed at, because the store then falls through to the DEFAULT and is
    // opened as an instrument.
    const named = { path: join(work, "x", "claude-code.json"), source: CONFIG_FLAG, refusal: null } as const;
    expect(namedUnreadableRefusal(named, "unreadable")).toContain("could not be understood");
    expect(namedUnreadableRefusal(named, "loaded")).toBe(null);
    expect(namedUnreadableRefusal(named, "absent")).toBe(null);
    const dflt = { path: defaultConfigPath(work), source: "default", refusal: null } as const;
    expect(namedUnreadableRefusal(dflt, "unreadable", work)).toBe(null);
  });

  test("an EMPTY environment variable is absent, not a refusal", () => {
    // `-e COUNTERPARTS_CONFIG=` is a shape a static registration can produce by
    // accident; nobody meant a path by it.
    const choice = resolveConfigPath([], { [CONFIG_ENV]: "" }, work);
    expect(choice.source).toBe("default");
    expect(choice.refusal).toBe(null);
    expect(resolveConfigPath([], { [CONFIG_ENV]: "   " }, work).source).toBe("default");
  });

  test("the printed line names the file and how it was chosen", () => {
    expect(configLine(resolveConfigPath([], {}, work))).toContain("(the default)");
    expect(configLine(resolveConfigPath([CONFIG_FLAG, "/a/b.json"], {}, work))).toBe(
      `/a/b.json (named by ${CONFIG_FLAG})`,
    );
  });
});

describe("the worker's pin", () => {
  test("planSpawn pins the parent's config onto the child, and the child reads it", () => {
    const configPath = join(work, "scratch", "claude-code.json");
    const plan = planSpawn({
      config: { dataDir: join(work, "store") },
      command: "/bin/echo",
      args: ["worker"],
      baseEnv: { ANTHROPIC_API_KEY: "k", [CONFIG_ENV]: "/somebody/elses.json" },
      configPath,
    });
    expect(plan.ok).toBe(true);
    // Pinned LAST: what the caller exported does not survive the line.
    expect(plan.env[SPAWN_CONFIG_ENV]).toBe(configPath);
    // And the worker, handed that environment, resolves exactly it.
    expect(runnerConfigChoice([], plan.env).path).toBe(configPath);
    expect(runnerConfigChoice([], plan.env).source).toBe(CONFIG_ENV);
  });

  test("a hook told nothing pins nothing, and the child falls to the same default", () => {
    const plan = planSpawn({
      config: { dataDir: join(work, "store") },
      command: "/bin/echo",
      args: ["worker"],
      baseEnv: { ANTHROPIC_API_KEY: "k" },
    });
    expect(plan.env[SPAWN_CONFIG_ENV]).toBeUndefined();
    expect(runnerConfigChoice([], plan.env).path).toBe(RUNNER_CONFIG_PATH);
  });
});

describe("what the hook RECORDS", () => {
  test("the session registry record carries the config, and carries it forward", () => {
    const dir = join(work, "store");
    mkdirSync(dir, { recursive: true });
    const configPath = join(work, "scratch", "claude-code.json");
    const started = recordSession(dir, {
      sessionId: "s1",
      scope: work,
      phase: "start",
      config: configPath,
    });
    expect(started?.config).toBe(configPath);
    // The record is rewritten whole at every phase; a later phase written by a
    // process that was told nothing must not lose the answer.
    const later = recordSession(dir, { sessionId: "s1", scope: work, phase: "boundary" });
    expect(later?.config).toBe(configPath);
    expect(readSession(dir, "s1")?.config).toBe(configPath);
    // A record from before this field existed still parses — every live session
    // on the owner's host has one of those at the moment this ships.
    writeFileSync(
      join(dir, "sessions", "old.json"),
      `${JSON.stringify({ sessionId: "old", scope: work, startedAt: 1, lastBoundaryAt: 2, endedAt: null })}\n`,
    );
    const old = readSession(dir, "old");
    expect(old).not.toBe(null);
    expect(old?.config).toBeUndefined();
  });

  test("the adapter leaves ONE ring event naming the file this process read", () => {
    const dir = join(work, "store");
    const configPath = join(work, "scratch", "claude-code.json");
    const adapter = openAdapter({ dataDir: dir }, { configPath });
    open.push(adapter.counterpart);
    const events = adapter.events(CONFIG_FILE_EVENT);
    expect(events.length).toBe(1);
    expect(events[0]?.data["path"]).toBe(configPath);
    // An adapter nobody told says nothing rather than guessing.
    const quiet = openAdapter({ dataDir: join(work, "store2") });
    open.push(quiet.counterpart);
    expect(quiet.events(CONFIG_FILE_EVENT).length).toBe(0);
  });
});

describe("the console", () => {
  test("a named config replaces the two-step search, and rebrief says which file", async () => {
    const store = join(work, "store");
    const named = writeConfig(join(work, "named", "claude-code.json"), {
      injectionBudgetBytes: 4321,
    });
    // Beside the store, a DIFFERENT ceiling — the one the search would find.
    writeConfig(join(work, "claude-code.json"), { injectionBudgetBytes: 9999 });

    const seeded = hostCeiling(store, undefined, work);
    expect("bytes" in seeded ? seeded.bytes : null).toBe(9999);

    const chosen = hostCeiling(store, undefined, work, resolveConfigPath([CONFIG_FLAG, named], {}, work));
    expect("bytes" in chosen ? chosen.bytes : null).toBe(4321);
    expect("searched" in chosen ? [...chosen.searched] : []).toEqual([named]);
    expect("namedBy" in chosen ? chosen.namedBy : undefined).toBe(CONFIG_FLAG);

    const c = consoleWith();
    expect(await run(["init", "--dir", store], { io: c.io, env: {} })).toBe(0);
    const r = consoleWith();
    const code = await run(["rebrief", "--dir", store, CONFIG_FLAG, named], {
      io: r.io,
      env: {},
      home: work,
    });
    expect(code).toBe(0);
    const printed = r.out.join("\n");
    expect(printed).toContain(`budget 4321 bytes from ${named}`);
    expect(printed).toContain(`(named by ${CONFIG_FLAG})`);
  });

  test("the environment is the flag's equivalent, and a relative one is refused", async () => {
    const store = join(work, "store");
    const named = writeConfig(join(work, "named", "claude-code.json"), {
      injectionBudgetBytes: 4321,
    });
    const c = consoleWith();
    expect(await run(["init", "--dir", store], { io: c.io, env: {} })).toBe(0);

    const viaEnv = consoleWith();
    expect(
      await run(["rebrief", "--dir", store], {
        io: viaEnv.io,
        env: { [CONFIG_ENV]: named },
        home: work,
      }),
    ).toBe(0);
    expect(viaEnv.out.join("\n")).toContain(`budget 4321 bytes from ${named}`);
    expect(viaEnv.out.join("\n")).toContain(`(named by ${CONFIG_ENV})`);

    // A named config that is not there refuses here too, by the route this
    // command already had: it is the only path `hostCeiling` searched, and the
    // refusal lists it as absent. `rebrief` composes nothing under a ceiling
    // from a file the caller did not name.
    const missing = consoleWith();
    expect(
      await run(["rebrief", "--dir", store, CONFIG_FLAG, join(work, "nowhere.json")], {
        io: missing.io,
        env: {},
        home: work,
      }),
    ).toBe(2);
    expect(missing.err.join("\n")).toContain("no injection ceiling");
    expect(missing.err.join("\n")).toContain("(absent)");
    expect(missing.err.join("\n")).toContain(join(work, "nowhere.json"));

    const bad = consoleWith();
    expect(
      await run(["rebrief", "--dir", store, CONFIG_FLAG, "relative.json"], {
        io: bad.io,
        env: {},
        home: work,
      }),
    ).toBe(2);
    expect(bad.err.join("\n")).toContain("ABSOLUTE");
    // Refused BEFORE anything was read: no ceiling was reported at all.
    expect(bad.out.join("\n")).not.toContain("budget");
  });

  test("a stale COUNTERPARTS_CONFIG does not refuse a command that reads none", async () => {
    // The guard fires on the two commands that read or write a configuration.
    // A refusal on `note` — which takes its store from `--dir` and touches no
    // config at all — is a guard people learn to unset rather than to read.
    const store = join(work, "store");
    const seed = consoleWith();
    expect(await run(["init", "--dir", store], { io: seed.io, env: {} })).toBe(0);
    const c = consoleWith();
    const code = await run(["note", "The espresso machine in the kitchen is a Rancilio Silvia.", "--dir", store], {
      io: c.io,
      env: { [CONFIG_ENV]: "relative.json" },
    });
    expect(code).toBe(0);
    expect(c.err.join("\n")).not.toContain("ABSOLUTE");
  });

  test("a command that reads no configuration does not take the flag", async () => {
    const c = consoleWith();
    const code = await run(["note", "hello", "--dir", join(work, "store"), CONFIG_FLAG, "/a/b.json"], {
      io: c.io,
      env: {},
    });
    expect(code).toBe(2);
    expect(c.err.join("\n")).toContain(`unknown flag ${CONFIG_FLAG}`);
    expect(c.err.join("\n")).toContain("Nothing was opened and nothing was written.");
  });
});

describe("the explicit-dir guard at the config door (I21)", () => {
  const GUARD = { [REQUIRE_EXPLICIT_DIR_ENV]: "1" };

  test("armed + default → a refusal naming the guard, the file and both ways to name one; named or unarmed → null", () => {
    const home = join(work, "home");
    const byDefault = resolveConfigPath([], GUARD, home);
    expect(byDefault.source).toBe("default");
    // `resolveConfigPath` itself does not refuse: `rebrief` resolves through it
    // for a budget NUMBER against a store already named by `--dir`, and a
    // guard that fired there is one people learn to unset.
    expect(byDefault.refusal).toBe(null);
    const refusal = implicitConfigRefusal(byDefault, GUARD);
    expect(refusal).not.toBe(null);
    expect(refusal).toContain(`${REQUIRE_EXPLICIT_DIR_ENV}=1`);
    expect(refusal).toContain(defaultConfigPath(home));
    expect(refusal).toContain(CONFIG_FLAG);
    expect(refusal).toContain(CONFIG_ENV);

    // Named, by either rule: not this refusal's business.
    const named = join(work, "named", "claude-code.json");
    expect(implicitConfigRefusal(resolveConfigPath([CONFIG_FLAG, named], GUARD, home), GUARD)).toBe(null);
    expect(implicitConfigRefusal(resolveConfigPath([], { ...GUARD, [CONFIG_ENV]: named }, home), GUARD)).toBe(
      null,
    );
    // Unarmed: absent or blank.
    expect(implicitConfigRefusal(byDefault, {})).toBe(null);
    expect(implicitConfigRefusal(byDefault, { [REQUIRE_EXPLICIT_DIR_ENV]: "  " })).toBe(null);
    // `true` arms it too (parity with COUNTERPARTS_OBSERVER), and the sentence
    // quotes the value that armed it.
    expect(implicitConfigRefusal(byDefault, { [REQUIRE_EXPLICIT_DIR_ENV]: "true" })).toContain(
      `${REQUIRE_EXPLICIT_DIR_ENV}=true`,
    );
    // A value the guard cannot read is refused at the default — the same
    // sentence the store uses — and is not consulted for a NAMED configuration.
    const malformed = implicitConfigRefusal(byDefault, { [REQUIRE_EXPLICIT_DIR_ENV]: "yes" });
    expect(malformed).toContain("'yes'");
    expect(malformed).toContain("1 or true");
    expect(malformed).toContain("fails closed");
    expect(implicitConfigRefusal(byDefault, { [REQUIRE_EXPLICIT_DIR_ENV]: "0" })).toContain("'0'");
    expect(
      implicitConfigRefusal(resolveConfigPath([CONFIG_FLAG, named], {}, home), { [REQUIRE_EXPLICIT_DIR_ENV]: "yes" }),
    ).toBe(null);
  });

  test("the three bins' choice functions all feed it, so all three stand down on the same sentence", () => {
    for (const choose of [hookConfigChoice, runnerConfigChoice, serverConfigChoice]) {
      expect(implicitConfigRefusal(choose([], GUARD), GUARD)).toContain(`${REQUIRE_EXPLICIT_DIR_ENV}=1`);
      expect(implicitConfigRefusal(choose([], { ...GUARD, [CONFIG_ENV]: "/named/claude-code.json" }), GUARD)).toBe(
        null,
      );
      expect(implicitConfigRefusal(choose([], {}), {})).toBe(null);
    }
  });

  test("install with no --config is REFUSED under the guard and writes nothing under the home; --config elsewhere is the way through", async () => {
    // `installLayout` builds `~/.counterparts` from `homedir()` itself and never
    // calls `dataDir()`, so the store guard would have left this door open: an
    // agent's `counterparts install` in a guarded shell would write the live
    // base — config, credentials, store.
    const home = join(work, "home-install-guarded");
    const c = consoleWith();
    expect(await run(["install", "--budget", "9000", "--name", "Ada"], { io: c.io, env: GUARD, home })).toBe(
      EXIT.refused,
    );
    expect(c.err.join("\n")).toContain(`${REQUIRE_EXPLICIT_DIR_ENV}=1`);
    expect(c.err.join("\n")).toContain(CONFIG_FLAG);
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
    expect(existsSync(home)).toBe(false);

    const configPath = join(work, "elsewhere", "claude-code.json");
    const named = consoleWith();
    expect(
      await run(["install", "--budget", "9000", "--name", "Ada", CONFIG_FLAG, configPath], {
        io: named.io,
        env: GUARD,
        home,
      }),
    ).toBe(EXIT.ok);
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(join(work, "elsewhere", "store", "operational.sqlite"))).toBe(true);
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });
});

describe("install", () => {
  test("by default it prints the two host lines WITHOUT the flag", async () => {
    const home = join(work, "home");
    const c = consoleWith();
    const code = await run(["install", "--budget", "9000", "--name", "Ada"], {
      io: c.io,
      env: {},
      home,
    });
    expect(code).toBe(0);
    const printed = c.out.join("\n");
    expect(printed).toContain(join(home, ".counterparts", "claude-code.json"));
    // The default path IS the rule: a hooks block that spelled it out would
    // teach the reader that the flag is part of the wiring.
    expect(printed).not.toContain(CONFIG_FLAG);
    expect(printed).not.toContain(CONFIG_ENV);
    expect(hookCommand()).not.toContain(CONFIG_FLAG);
    expect(mcpCommand(join(home, ".counterparts", "store"))).not.toContain(CONFIG_ENV);
  });

  test("--config spelling out the DEFAULT path is the default install, flagless", async () => {
    // "Non-default" is a fact about the PATH, not about how it was named. A
    // hooks block carrying `--config <the default>` — under a sentence saying
    // the config is NOT at the default — would be false twice over.
    const home = join(work, "home");
    const c = consoleWith();
    const code = await run(
      ["install", "--budget", "9000", CONFIG_FLAG, join(home, ".counterparts", "claude-code.json")],
      { io: c.io, env: {}, home },
    );
    expect(code).toBe(0);
    const printed = c.out.join("\n");
    expect(printed).not.toContain(CONFIG_FLAG);
    expect(printed).not.toContain("because it is NOT at");
    expect(existsSync(join(home, ".counterparts", "store", "operational.sqlite"))).toBe(true);
  });

  test("--config moves the config, the credentials and the default store, and is PRINTED", async () => {
    const home = join(work, "home");
    const configPath = join(work, "scratch", "claude-code.json");
    const c = consoleWith();
    const code = await run(["install", "--budget", "9000", "--name", "Ada", CONFIG_FLAG, configPath], {
      io: c.io,
      env: {},
      home,
    });
    expect(code).toBe(0);
    // Written where it was told, with the credentials beside it and the store
    // beneath it — never under the home directory, which on a real machine is
    // the live install.
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(join(work, "scratch", "credentials.env"))).toBe(true);
    expect(existsSync(join(work, "scratch", "store", "operational.sqlite"))).toBe(true);
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
    expect(JSON.parse(readFileSync(configPath, "utf8"))["dataDir"]).toBe(
      join(work, "scratch", "store"),
    );

    const printed = c.out.join("\n");
    // The hooks block carries the flag (JSON-escaped inside the block, so the
    // command itself is asserted whole); the MCP line carries the variable,
    // because a static registration has no command line to write into.
    expect(hookCommand(configPath)).toContain(`${CONFIG_FLAG} "${configPath}"`);
    expect(printed).toContain(`${CONFIG_FLAG} \\"${configPath}\\"`);
    expect(printed).toContain(`-e ${CONFIG_ENV}="${configPath}"`);
    expect(printed).toContain("because it is NOT at");
    expect(installLayout(undefined, {}, home, configPath).credentials).toBe(
      join(work, "scratch", "credentials.env"),
    );
  });
});

describe("the hook, as a real process", () => {
  /** A hook run with a curated environment: a temp home, no API keys at all. */
  function runHook(
    args: readonly string[],
    env: Record<string, string>,
    sessionId: string,
  ): { code: number; stdout: string; stderr: string } {
    const payload = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: sessionId,
      cwd: work,
    });
    const r = spawnSync(process.execPath, ["run", HOOK_SCRIPT, ...args], {
      input: payload,
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", ...env },
      timeout: 60_000,
    });
    return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }

  test(
    "--config sends the hook to the scratch store and NOWHERE near the default one",
    () => {
      // A home that already HAS an install — the case every reviewer on a real
      // machine is in, and the one nobody could test before this flag existed.
      const home = join(work, "home");
      const decoyStore = join(home, ".counterparts", "store");
      writeConfig(join(home, ".counterparts", "claude-code.json"), {
        dataDir: decoyStore,
        injectionBudgetBytes: 9000,
      });
      const before = treeHash(join(home, ".counterparts"));

      const scratchConfig = writeConfig(join(work, "scratch", "claude-code.json"), {
        dataDir: join(work, "scratch", "store"),
        injectionBudgetBytes: 9000,
      });

      const r = runHook([CONFIG_FLAG, scratchConfig], { HOME: home, USERPROFILE: home }, "flagged");
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("has not lived a boundary");

      // It wrote the scratch store, and RECORDED which configuration sent it
      // there — the durable half of "a hook cannot print to the owner".
      const record = join(work, "scratch", "store", "sessions", "flagged.json");
      expect(existsSync(record)).toBe(true);
      expect(JSON.parse(readFileSync(record, "utf8"))["config"]).toBe(scratchConfig);

      // And the home install is byte for byte what it was: no store minted, no
      // session recorded, nothing read into existence.
      expect(treeHash(join(home, ".counterparts"))).toBe(before);
      expect(existsSync(decoyStore)).toBe(false);
    },
    60_000,
  );

  test(
    "COUNTERPARTS_CONFIG does the same, and no flag at all still means the home path",
    () => {
      const home = join(work, "home2");
      const decoyStore = join(home, ".counterparts", "store");
      const decoyConfig = writeConfig(join(home, ".counterparts", "claude-code.json"), {
        dataDir: decoyStore,
        injectionBudgetBytes: 9000,
      });
      const scratchConfig = writeConfig(join(work, "scratch2", "claude-code.json"), {
        dataDir: join(work, "scratch2", "store"),
        injectionBudgetBytes: 9000,
      });

      const viaEnv = runHook(
        [],
        { HOME: home, USERPROFILE: home, [CONFIG_ENV]: scratchConfig },
        "env-driven",
      );
      expect(viaEnv.code).toBe(0);
      expect(
        existsSync(join(work, "scratch2", "store", "sessions", "env-driven.json")),
      ).toBe(true);
      expect(existsSync(decoyStore)).toBe(false);

      // THE LIVE-HOST CASE. No flag, no variable: the hook reads
      // `~/.counterparts/claude-code.json` and works on the store it names,
      // exactly as it did before any of this existed.
      const plain = runHook([], { HOME: home, USERPROFILE: home }, "default-driven");
      expect(plain.code).toBe(0);
      const record = join(decoyStore, "sessions", "default-driven.json");
      expect(existsSync(record)).toBe(true);
      expect(JSON.parse(readFileSync(record, "utf8"))["config"]).toBe(decoyConfig);
    },
    60_000,
  );

  test(
    "COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1 stands the hook down on an UNNAMED config — the other door into the live store (I21)",
    () => {
      // The shape an agent shell on the owner's machine produces: a home that
      // HAS an install, whose default config names the live store. The store
      // guard alone never fires here — `hostConfig` takes the dir from the file
      // and `dataDir()` is not called — so the config resolver has to refuse the
      // default itself.
      const home = join(work, "home-guarded");
      const decoyStore = join(home, ".counterparts", "store");
      writeConfig(join(home, ".counterparts", "claude-code.json"), {
        dataDir: decoyStore,
        injectionBudgetBytes: 9000,
      });
      const before = treeHash(join(home, ".counterparts"));
      const armed = { HOME: home, USERPROFILE: home, [REQUIRE_EXPLICIT_DIR_ENV]: "1" };

      const plain = runHook([], armed, "guarded-default");
      expect(plain.code).toBe(0);
      expect(plain.stdout).toBe("");
      expect(plain.stderr).toContain("hook stood down");
      expect(plain.stderr).toContain(`${REQUIRE_EXPLICIT_DIR_ENV}=1`);
      expect(plain.stderr).toContain(CONFIG_FLAG);
      expect(existsSync(decoyStore)).toBe(false);
      expect(treeHash(join(home, ".counterparts"))).toBe(before);

      // A NAMED configuration is the way through, guard and all.
      const scratchConfig = writeConfig(join(work, "scratch-guarded", "claude-code.json"), {
        dataDir: join(work, "scratch-guarded", "store"),
        injectionBudgetBytes: 9000,
      });
      const named = runHook([CONFIG_FLAG, scratchConfig], armed, "guarded-named");
      expect(named.code).toBe(0);
      expect(named.stdout).toContain("has not lived a boundary");
      expect(existsSync(join(work, "scratch-guarded", "store", "sessions", "guarded-named.json"))).toBe(true);
      expect(existsSync(decoyStore)).toBe(false);

      // The gap between the two doors: a NAMED configuration that names no
      // store. `implicitConfigRefusal` is not its business (the config was
      // named), so `hostConfig` runs and its `loaded.dataDir ?? dataDir()`
      // meets the STORE guard instead — thrown, not returned, and the entry
      // point's rejection handler turns it into the same stand-down line. Exit
      // 0, nothing on stdout, nothing minted anywhere.
      const storeless = writeConfig(join(work, "storeless", "claude-code.json"), {
        injectionBudgetBytes: 9000,
      });
      const gap = runHook([CONFIG_FLAG, storeless], armed, "guarded-storeless");
      expect(gap.code).toBe(0);
      expect(gap.stdout).toBe("");
      expect(gap.stderr).toContain("hook stood down");
      expect(gap.stderr).toContain(`${REQUIRE_EXPLICIT_DIR_ENV}=1`);
      // A SENTENCE with the HOOK's remedy — the field in the file it read — and
      // not the console's flag, which a hook does not have (#80 review, 4).
      expect(gap.stderr).toContain(`Set "dataDir" in ${storeless}`);
      expect(gap.stderr).toContain("COUNTERPARTS_DATA_DIR");
      expect(gap.stderr).not.toContain("--dir");
      expect(gap.stderr).not.toContain('{"guard"');
      expect(existsSync(decoyStore)).toBe(false);
      expect(existsSync(join(work, "storeless", "store"))).toBe(false);
      expect(treeHash(join(home, ".counterparts"))).toBe(before);

      // A value the guard cannot read stands the hook down too, on the same
      // sentence the store uses, rather than falling to the decoy.
      const typo = runHook([], { HOME: home, USERPROFILE: home, [REQUIRE_EXPLICIT_DIR_ENV]: "yes" }, "guarded-typo");
      expect(typo.code).toBe(0);
      expect(typo.stdout).toBe("");
      expect(typo.stderr).toContain("hook stood down");
      expect(typo.stderr).toContain("'yes'");
      expect(typo.stderr).toContain("1 or true");
      expect(existsSync(decoyStore)).toBe(false);
    },
    60_000,
  );

  test(
    "the WORKER and the MCP SERVER say why in that same gap, where both used to exit silently (#80 review, 3)",
    () => {
      // Same shape as the hook's gap above — a NAMED configuration that names
      // no store, guard armed, no `COUNTERPARTS_DATA_DIR` — at the two entry
      // points whose rejection handlers used to discard the error: the worker
      // exited 0 with an empty stderr and the server exited 1 with an empty
      // stderr, so a Claude Code user saw "MCP server failed" and no reason.
      // Nothing about the refusal changed; only that it is now SAID.
      const home = join(work, "home-gap-bins");
      const storeless = writeConfig(join(work, "storeless-bins", "claude-code.json"), {
        injectionBudgetBytes: 9000,
      });
      const armed = {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        HOME: home,
        USERPROFILE: home,
        [REQUIRE_EXPLICIT_DIR_ENV]: "1",
      };

      // The worker: exit 0 always (nothing about a failed run may reach the
      // host), and the reason on stderr, with the WORKER's remedy — the field
      // in the file it read, not the console's `--dir`.
      const worker = spawnSync(process.execPath, ["run", RUNNER_SCRIPT], {
        encoding: "utf8",
        env: { ...armed, [CONFIG_ENV]: storeless },
        timeout: 60_000,
      });
      expect(worker.status).toBe(0);
      expect(worker.stderr ?? "").toContain("worker stood down");
      expect(worker.stderr ?? "").toContain(`${REQUIRE_EXPLICIT_DIR_ENV}=1`);
      expect(worker.stderr ?? "").toContain(`Set "dataDir" in ${storeless}`);
      expect(worker.stderr ?? "").not.toContain("--dir");
      expect(worker.stderr ?? "").not.toContain('{"guard"');

      // The server: exit 1, stdout untouched (it is the wire), and the same
      // sentence with the SERVER's remedy, which does have `--dir`.
      const server = spawnSync(process.execPath, ["run", SERVE_SCRIPT, CONFIG_FLAG, storeless], {
        input:
          '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}\n',
        encoding: "utf8",
        env: armed,
        timeout: 60_000,
      });
      expect(server.status).toBe(1);
      expect(server.stdout ?? "").toBe("");
      expect(server.stderr ?? "").toContain("refused:");
      expect(server.stderr ?? "").toContain(`${REQUIRE_EXPLICIT_DIR_ENV}=1`);
      expect(server.stderr ?? "").toContain("--dir <path>");
      expect(server.stderr ?? "").not.toContain('{"guard"');

      // Neither minted anything: not the store the config failed to name, not
      // the default one under the temp home.
      expect(existsSync(join(work, "storeless-bins", "store"))).toBe(false);
      expect(existsSync(join(home, ".counterparts"))).toBe(false);
    },
    60_000,
  );

  test(
    "an absolute --config that is NOT THERE stands the hook down and writes nothing",
    () => {
      // The reviewer's reproduction, as a test: a mistyped path used to exit 0,
      // print a wake, and mint a store — at `dataDir()`, which is the live store
      // on any machine with an install. The data dir is named here so that a
      // regression writes into this temp dir and is caught, rather than
      // anywhere else.
      const home = join(work, "home-missing");
      const dataDir = join(work, "data-missing");
      const r = runHook(
        [CONFIG_FLAG, join(work, "nowhere", "claude-code.json")],
        { HOME: home, USERPROFILE: home, COUNTERPARTS_DATA_DIR: dataDir },
        "missing",
      );
      expect(r.code).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("stood down");
      expect(r.stderr).toContain("could not be read");
      // Nothing was minted anywhere: not at the named path's store, not at the
      // data dir the environment offered, not under the home.
      expect(existsSync(dataDir)).toBe(false);
      expect(existsSync(join(home, ".counterparts"))).toBe(false);
    },
    60_000,
  );

  test(
    "a named config whose fields do not typecheck stands the hook down",
    () => {
      const home = join(work, "home-junk");
      const dataDir = join(work, "data-junk");
      // Parses as an object; `dataDir` is a number, so `loadConfig` reports
      // `unreadable` and resolves to observer — which would then read the
      // DEFAULT store rather than the one this file was supposed to name.
      const bad = writeConfig(join(work, "badtypes", "claude-code.json"), { dataDir: 123 });
      const r = runHook(
        [CONFIG_FLAG, bad],
        { HOME: home, USERPROFILE: home, COUNTERPARTS_DATA_DIR: dataDir },
        "badtypes",
      );
      expect(r.code).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("could not be understood");
      expect(existsSync(dataDir)).toBe(false);
      expect(existsSync(join(home, ".counterparts"))).toBe(false);
    },
    60_000,
  );

  test(
    "the WORKER refuses a named config that is not there, and opens no store",
    () => {
      const home = join(work, "home-worker");
      const dataDir = join(work, "data-worker");
      const r = spawnSync(process.execPath, ["run", RUNNER_SCRIPT], {
        encoding: "utf8",
        env: {
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
          HOME: home,
          USERPROFILE: home,
          COUNTERPARTS_DATA_DIR: dataDir,
          [CONFIG_ENV]: join(work, "nowhere", "claude-code.json"),
        },
        timeout: 60_000,
      });
      // A worker never fails the host either: it says so and exits 0.
      expect(r.status).toBe(0);
      expect(r.stderr ?? "").toContain("worker stood down");
      expect(existsSync(dataDir)).toBe(false);
    },
    60_000,
  );

  test(
    "the MCP SERVER refuses a named config that is not there, and serves nothing",
    () => {
      const home = join(work, "home-serve");
      const dataDir = join(work, "data-serve");
      const r = spawnSync(
        process.execPath,
        ["run", SERVE_SCRIPT, CONFIG_FLAG, join(work, "nowhere", "claude-code.json")],
        {
          input:
            '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}\n',
          encoding: "utf8",
          env: {
            PATH: process.env["PATH"] ?? "/usr/bin:/bin",
            HOME: home,
            USERPROFILE: home,
            COUNTERPARTS_DATA_DIR: dataDir,
          },
          timeout: 60_000,
        },
      );
      // Unlike the two hook-side processes, a server that cannot start SAYS so
      // with a non-zero exit: nothing downstream is waiting on it to be quiet.
      expect(r.status).toBe(1);
      expect(r.stdout ?? "").toBe("");
      expect(r.stderr ?? "").toContain("could not be read");
      expect(existsSync(dataDir)).toBe(false);
    },
    60_000,
  );

  test(
    "a relative --config stands the hook down: exit 0, nothing injected, nothing written",
    () => {
      const home = join(work, "home3");
      const decoyStore = join(home, ".counterparts", "store");
      writeConfig(join(home, ".counterparts", "claude-code.json"), {
        dataDir: decoyStore,
        injectionBudgetBytes: 9000,
      });
      const before = treeHash(join(home, ".counterparts"));
      const r = runHook([CONFIG_FLAG, "claude-code.json"], { HOME: home, USERPROFILE: home }, "bad");
      // A hook NEVER fails the host (§5 G2) — and it never quietly uses the
      // default store instead of the one it was told to use.
      expect(r.code).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("stood down");
      expect(treeHash(join(home, ".counterparts"))).toBe(before);
      expect(existsSync(decoyStore)).toBe(false);
    },
    60_000,
  );
});

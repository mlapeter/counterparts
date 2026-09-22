/**
 * `adapters/cli/keys.ts`, and `credentials set` at a terminal — new-user
 * findings #2 and #3.
 *
 * The stranger who installed `counterparts@0.1.0` on 2026-09-21 was never asked
 * for a key (#3), and when he went looking for the command that sets one it
 * refused him for standing at a terminal (#2). These tests hold the two answers
 * and, above both, the one rule neither may bend:
 *
 *   1. **A KEY VALUE REACHES NOTHING.** Every test that supplies one asserts it
 *      appears in neither stream, and the two that matter most assert it of a
 *      prefix of the value as well — a console that printed half a key has
 *      printed a key.
 *   2. **Not a terminal → exactly today's bytes.** `promptForKeys` asks nothing
 *      and writes nothing; `credentials set` keeps its refusal and its one
 *      output line verbatim, because `tools/install-loop/run.sh` and the suite
 *      read them.
 *   3. **Skipping is always offered and always fine** (the owner, 2026-09-21):
 *      since 2026-09-22 the offer is the FIRST thing each key asks (`[y/N]`,
 *      Enter is no), an empty paste after a yes is a skip too, and neither is
 *      an error.
 *   4. **The embedder moves only on an explicit yes**, and only into the exact
 *      shape `loadConfig` reads and `doctor`'s fix line names — embedding sends
 *      memory text to a third party, so a key is not consent.
 *
 * Hermetic (CLAUDE.md): a fresh temp dir per test, removed in `afterEach`, and
 * every console is a fake. Nothing here touches a real store, a real config or
 * a real credentials file.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { API_KEY_ENV, EMBED_KEY_ENV } from "../src/adapters/claude-code/config.js";
import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import {
  KEY_LINKS,
  enableEmbedder,
  promptForKeys,
  writeCredential,
} from "../src/adapters/cli/keys.js";
import type { KeyPromptContext } from "../src/adapters/cli/keys.js";
import { PromptAborted, ui } from "../src/adapters/cli/ui.js";

const ANTHROPIC_KEY = "sk-ant-not-a-real-key-0123456789";
const VOYAGE_KEY = "pa-not-a-real-embed-key-0123456789";

let root: string;
let configPath: string;
let credsPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-keys-"));
  configPath = join(root, "claude-code.json");
  credsPath = join(root, "credentials.env");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeConfig(over: Record<string, unknown> = {}): void {
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        dataDir: join(root, "store"),
        credentialsFile: credsPath,
        owner: true,
        injectionBudgetBytes: 9000,
        identity: { name: "Placeholder" },
        ...over,
      },
      null,
      2,
    )}\n`,
  );
}

interface Fake {
  io: Io;
  out: string[];
  err: string[];
  asked: string[];
  askedHidden: string[];
  /** EVERYTHING this console said, on either stream and in either question,
   *  with the colour escapes stripped and the wrapping folded back out. A
   *  terminal console colours and wraps (that is the point of it), and an
   *  assertion about WHAT was said should not also be an assertion about where
   *  the eighty-first character fell. A key has no whitespace in it, so
   *  `not.toContain(KEY)` still means what it says. */
  said: () => string;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function flat(lines: readonly string[]): string {
  return lines.join(" ").replace(ANSI, "").replace(/\s+/g, " ").trim();
}

/**
 * A console. `tty` absent means "not a terminal", which is what every existing
 * test console says and is why none of them changed behaviour.
 *
 * THE TRAP `ui.ts` NAMES: a console that declares a tty must also supply
 * `promptHidden`, or `askHidden` refuses rather than falling back to the
 * echoing reader. `terminal()` below supplies both.
 */
function fake(
  opts: {
    answers?: readonly string[] | null;
    hidden?: readonly string[] | null;
    tty?: { stdin: boolean; stdout: boolean; columns?: number };
  } = {},
): Fake {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const askedHidden: string[] = [];
  const answers = opts.answers === undefined ? [] : opts.answers;
  const queue = answers === null ? [] : [...answers];
  const hiddenQueue = opts.hidden === undefined || opts.hidden === null ? [] : [...opts.hidden];
  const io: Io = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ...(answers === null
      ? {}
      : {
          prompt: (question: string): Promise<string> => {
            asked.push(question);
            return Promise.resolve(queue.shift() ?? "");
          },
        }),
    ...(opts.hidden === undefined || opts.hidden === null
      ? {}
      : {
          promptHidden: (question: string): Promise<string> => {
            askedHidden.push(question);
            const next = hiddenQueue.shift();
            // A scripted Ctrl-C: the one way a test can reach the abort path
            // without a real terminal.
            if (next === "\u0003") return Promise.reject(new PromptAborted("interrupt", "cancelled."));
            return Promise.resolve(next ?? "");
          },
        }),
    ...(opts.tty === undefined ? {} : { tty: opts.tty }),
  };
  return {
    io,
    out,
    err,
    asked,
    askedHidden,
    said: () => flat([...out, ...err, ...asked, ...askedHidden]),
  };
}

/** A terminal: both ends a tty, a prompt, and a hidden reader. */
function terminal(opts: { answers?: readonly string[]; hidden?: readonly string[] } = {}): Fake {
  return fake({
    answers: opts.answers ?? [],
    hidden: opts.hidden ?? [],
    tty: { stdin: true, stdout: true },
  });
}

const NO_ENV: Record<string, string | undefined> = {};

function context(f: Fake, over: Partial<KeyPromptContext> = {}): KeyPromptContext {
  return {
    ui: ui(f.io, NO_ENV),
    configPath,
    credentialsPath: credsPath,
    held: [],
    ...over,
  };
}

// ── nobody to ask ───────────────────────────────────────────────────────────

describe("promptForKeys with no terminal", () => {
  test("asks nothing, writes nothing, says nothing, and reports that it did not", async () => {
    writeConfig();
    const f = fake({ answers: ["y"], hidden: [ANTHROPIC_KEY] });
    const r = await promptForKeys(f.io, NO_ENV, context(f));
    expect(r).toEqual({
      asked: false,
      anthropic: "not-asked",
      voyage: "not-asked",
      embedder: "not-asked",
    });
    expect(f.out).toEqual([]);
    expect(f.err).toEqual([]);
    expect(f.asked).toEqual([]);
    expect(f.askedHidden).toEqual([]);
    expect(existsSync(credsPath)).toBe(false);
    // And the configuration is byte for byte what it was.
    expect(JSON.parse(readFileSync(configPath, "utf8"))["embedder"]).toBeUndefined();
  });

  test("a tty whose caller opted out is also nobody to ask", async () => {
    writeConfig();
    const f = terminal({ hidden: [ANTHROPIC_KEY, VOYAGE_KEY] });
    const r = await promptForKeys(f.io, NO_ENV, {
      ...context(f),
      ui: ui(f.io, NO_ENV, { nonInteractive: true }),
    });
    expect(r.asked).toBe(false);
    expect(existsSync(credsPath)).toBe(false);
  });
});

// ── the asking ──────────────────────────────────────────────────────────────

describe("promptForKeys at a terminal", () => {
  test("both keys land in the file, and NEITHER VALUE reaches any stream", async () => {
    writeConfig();
    // y to the Anthropic question, y to the Voyage one, n to the knob.
    const f = terminal({ hidden: [ANTHROPIC_KEY, VOYAGE_KEY], answers: ["y", "y", "n"] });
    const r = await promptForKeys(f.io, NO_ENV, context(f));
    expect(r.asked).toBe(true);
    expect(r.anthropic).toBe("set");
    expect(r.voyage).toBe("set");
    const text = readFileSync(credsPath, "utf8");
    expect(text).toContain(`${API_KEY_ENV}=${ANTHROPIC_KEY}`);
    expect(text).toContain(`${EMBED_KEY_ENV}=${VOYAGE_KEY}`);
    expect((statSync(credsPath).mode & 0o777).toString(8)).toBe("600");
    const said = f.said();
    expect(said).not.toContain(ANTHROPIC_KEY);
    expect(said).not.toContain(VOYAGE_KEY);
    // Not even a prefix of one: a console that printed half a key printed a key.
    expect(said).not.toContain(ANTHROPIC_KEY.slice(0, 12));
    expect(said).not.toContain(VOYAGE_KEY.slice(0, 12));
    // WHAT IT SAYS INSTEAD, since 2026-09-22: one word per key. The screen the
    // owner signed off on carries no path and no variable name — `install`'s
    // own last line says where the folder is, and `counterparts credentials`
    // lists the file and the names whenever somebody wants them.
    expect(said).toContain("ok saved");
    expect(said).not.toContain(credsPath);
  });

  /**
   * THE SHAPE THE OWNER SETTLED ON, 2026-09-22 (item 10): the y/N comes FIRST,
   * and everything else is behind the yes. The two sentences are the acceptance
   * criterion's own, word for word.
   */
  test("each key is one y/N question, and a yes shows the link then reads without echo", async () => {
    writeConfig();
    const f = terminal({ answers: ["y", "y"], hidden: ["", ""] });
    await promptForKeys(f.io, NO_ENV, context(f));
    const asked = f.asked.join("\n");
    expect(asked).toContain(
      "Add an Anthropic key? Optional — lets a session that ended too soon get written up anyway. [y/N]",
    );
    expect(asked).toContain(
      "Add a Voyage key? Optional — lets recall match by meaning, not just words. [y/N]",
    );
    // The link, only after the yes, and where to get one is the owner's ask.
    const said = f.said();
    expect(said).toContain(KEY_LINKS[API_KEY_ENV] as string);
    expect(said).toContain(KEY_LINKS[EMBED_KEY_ENV] as string);
    expect(f.askedHidden).toEqual(["  Paste it here (hidden): ", "  Paste it here (hidden): "]);
  });

  test("Enter at both questions is a no: nothing is read, nothing is written, no error", async () => {
    writeConfig();
    const f = terminal({ answers: [], hidden: [ANTHROPIC_KEY, VOYAGE_KEY] });
    const r = await promptForKeys(f.io, NO_ENV, context(f));
    expect(r.anthropic).toBe("skipped");
    expect(r.voyage).toBe("skipped");
    expect(r.embedder).toBe("not-asked");
    // THE HIDDEN READER IS NEVER REACHED — a person who said no is not shown a
    // paste prompt, and no link is printed at them either.
    expect(f.askedHidden).toEqual([]);
    expect(f.said()).not.toContain(KEY_LINKS[API_KEY_ENV] as string);
    expect(existsSync(credsPath)).toBe(false);
    expect(f.err).toEqual([]);
  });

  test("an empty paste after a yes is a skip, and says so", async () => {
    writeConfig();
    const f = terminal({ answers: ["y"], hidden: [""] });
    const r = await promptForKeys(f.io, NO_ENV, context(f));
    expect(r.anthropic).toBe("skipped");
    expect(existsSync(credsPath)).toBe(false);
    expect(f.said()).toContain("skipped");
  });

  test("a key that is already saved is KEPT on Enter, and nothing is written", async () => {
    writeConfig();
    writeFileSync(credsPath, `${API_KEY_ENV}=already-there\n`, { mode: 0o600 });
    const before = readFileSync(credsPath, "utf8");
    const f = terminal({ answers: ["n"], hidden: [] });
    const r = await promptForKeys(f.io, NO_ENV, context(f, { held: [API_KEY_ENV] }));
    expect(r.anthropic).toBe("kept");
    expect(readFileSync(credsPath, "utf8")).toBe(before);
    // Still y/N FIRST, and the default is the answer that changes nothing.
    expect(f.asked[0]).toContain("An Anthropic key is already saved. Replace it?");
    expect(f.asked[0]).toContain("[y/N]");
  });

  test("a yes on a saved key asks for a new one, and Enter there STILL keeps the old one", async () => {
    writeConfig();
    writeFileSync(credsPath, `${API_KEY_ENV}=already-there\n`, { mode: 0o600 });
    const f = terminal({ answers: ["y"], hidden: [""] });
    const r = await promptForKeys(f.io, NO_ENV, context(f, { held: [API_KEY_ENV] }));
    expect(r.anthropic).toBe("kept");
    expect(readFileSync(credsPath, "utf8")).toContain("already-there");
  });

  test("a yes on a saved key followed by a value replaces that line and nothing else", async () => {
    writeConfig();
    writeFileSync(credsPath, `# mine\n${API_KEY_ENV}=already-there\n`, { mode: 0o600 });
    const f = terminal({ answers: ["y"], hidden: [ANTHROPIC_KEY] });
    const r = await promptForKeys(f.io, NO_ENV, context(f, { held: [API_KEY_ENV] }));
    expect(r.anthropic).toBe("set");
    expect(readFileSync(credsPath, "utf8")).toBe(`# mine\n${API_KEY_ENV}=${ANTHROPIC_KEY}\n`);
  });

  test("a value with a space in it is NOT written — a broken key reads as present", async () => {
    writeConfig();
    const f = terminal({ answers: ["y"], hidden: ["sk-ant-half of a paste"] });
    const r = await promptForKeys(f.io, NO_ENV, context(f));
    expect(r.anthropic).toBe("skipped");
    expect(existsSync(credsPath)).toBe(false);
    expect(f.said()).toContain("space in it");
    // And the thing it refused is not echoed back for anyone to read.
    expect(f.said()).not.toContain("half of a paste");
  });

  test("a key with an unexpected prefix is WARNED about and saved anyway", async () => {
    writeConfig();
    const f = terminal({ answers: ["y"], hidden: ["definitely-not-a-prefix-anybody-uses"] });
    const r = await promptForKeys(f.io, NO_ENV, context(f));
    expect(r.anthropic).toBe("set");
    expect(readFileSync(credsPath, "utf8")).toContain(API_KEY_ENV);
    expect(f.said()).toContain("sk-ant-");
    expect(f.said()).not.toContain("definitely-not-a-prefix");
  });

  test("the same name exported in this shell earns one line about which value wins", async () => {
    writeConfig();
    const f = terminal({ answers: ["y"], hidden: [ANTHROPIC_KEY] });
    await promptForKeys(f.io, { [API_KEY_ENV]: "something-else" }, context(f));
    expect(f.said()).toContain("that value wins");
    expect(f.said()).not.toContain("something-else");
  });

  test("Ctrl-C PROPAGATES, and a key written before it stays written", async () => {
    writeConfig();
    const f = terminal({ answers: ["y", "y"], hidden: [ANTHROPIC_KEY, "\u0003"] });
    await expect(promptForKeys(f.io, NO_ENV, context(f))).rejects.toThrow("cancelled.");
    expect(readFileSync(credsPath, "utf8")).toContain(`${API_KEY_ENV}=${ANTHROPIC_KEY}`);
    expect(f.said()).not.toContain(ANTHROPIC_KEY);
  });
});

// ── the embedder knob ───────────────────────────────────────────────────────

describe("the embedder is a second yes", () => {
  test("a Voyage key plus a yes writes the exact shape, and keeps everything else", async () => {
    writeConfig();
    const f = terminal({ answers: ["n", "y", "y"], hidden: [VOYAGE_KEY] });
    const r = await promptForKeys(f.io, NO_ENV, context(f));
    expect(r.voyage).toBe("set");
    expect(r.embedder).toBe("enabled");
    const body = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    // THE EXACT SHAPE `loadConfig` reads and `doctor`'s fix line names.
    expect(body["embedder"]).toEqual({ enabled: true });
    // …and every other field survived, values and all.
    expect(body["dataDir"]).toBe(join(root, "store"));
    expect(body["credentialsFile"]).toBe(credsPath);
    expect(body["injectionBudgetBytes"]).toBe(9000);
    expect(body["identity"]).toEqual({ name: "Placeholder" });
    expect(f.asked.join("\n")).toContain("Turn on recall by meaning now?");
  });

  test("a Voyage key plus a NO leaves the knob alone — a key is not consent", async () => {
    writeConfig();
    const f = terminal({ answers: ["n", "y", "n"], hidden: [VOYAGE_KEY] });
    const r = await promptForKeys(f.io, NO_ENV, context(f));
    expect(r.voyage).toBe("set");
    expect(r.embedder).toBe("declined");
    expect(JSON.parse(readFileSync(configPath, "utf8"))["embedder"]).toBeUndefined();
    expect(readFileSync(credsPath, "utf8")).toContain(EMBED_KEY_ENV);
  });

  /**
   * RE-RUNNING `install` IS THE ORDINARY CASE, not the odd one — the owner's own
   * trial of 0.2 is a re-install. A saved Voyage key with the knob off is
   * somebody who has the key and is not getting what it is for, so the question
   * is asked for a key that was KEPT exactly as for one just typed.
   */
  test("a Voyage key that was already saved is offered the knob too", async () => {
    writeConfig();
    writeFileSync(credsPath, `${EMBED_KEY_ENV}=already-there\n`, { mode: 0o600 });
    // Anthropic: not held, Enter is no. Voyage: held, Enter keeps it, then on.
    const f = terminal({ answers: ["n", "n", "y"], hidden: [] });
    const r = await promptForKeys(f.io, NO_ENV, context(f, { held: [EMBED_KEY_ENV] }));
    expect(r.voyage).toBe("kept");
    expect(r.embedder).toBe("enabled");
    expect(f.asked.join("\n")).toContain("Turn on recall by meaning now?");
    expect(JSON.parse(readFileSync(configPath, "utf8"))["embedder"]).toEqual({ enabled: true });
    // The key itself was not rewritten — keeping it means keeping it.
    expect(readFileSync(credsPath, "utf8")).toBe(`${EMBED_KEY_ENV}=already-there\n`);
  });

  test("a saved Voyage key plus a NO still leaves the knob alone", async () => {
    writeConfig();
    writeFileSync(credsPath, `${EMBED_KEY_ENV}=already-there\n`, { mode: 0o600 });
    const f = terminal({ answers: ["n", "n", "n"], hidden: [] });
    const r = await promptForKeys(f.io, NO_ENV, context(f, { held: [EMBED_KEY_ENV] }));
    expect(r.voyage).toBe("kept");
    expect(r.embedder).toBe("declined");
    expect(JSON.parse(readFileSync(configPath, "utf8"))["embedder"]).toBeUndefined();
  });

  test("a Voyage key SKIPPED at the prompt is offered nothing — there is no key", async () => {
    writeConfig();
    const f = terminal({ answers: ["n", "y"], hidden: [""] });
    const r = await promptForKeys(f.io, NO_ENV, context(f));
    expect(r.voyage).toBe("skipped");
    expect(r.embedder).toBe("not-asked");
    expect(f.asked.join("\n")).not.toContain("recall by meaning");
  });

  test("no Voyage key, no question about the knob", async () => {
    writeConfig();
    const f = terminal({ answers: ["n", "n"], hidden: [] });
    const r = await promptForKeys(f.io, NO_ENV, context(f));
    expect(r.embedder).toBe("not-asked");
    expect(f.asked.join("\n")).not.toContain("recall by meaning");
  });

  test("a knob already on is not asked about again", async () => {
    writeConfig({ embedder: { enabled: true } });
    const f = terminal({ answers: ["n", "y"], hidden: [VOYAGE_KEY] });
    const r = await promptForKeys(f.io, NO_ENV, context(f, { embedderOn: true }));
    expect(r.embedder).toBe("already-on");
    expect(f.asked.join("\n")).not.toContain("recall by meaning");
  });

  test("a config that cannot be edited leaves the KEY written and names the fix", async () => {
    // No config file at all: the knob cannot move, and the key still should.
    const f = terminal({ answers: ["n", "y", "y"], hidden: [VOYAGE_KEY] });
    const r = await promptForKeys(f.io, NO_ENV, context(f));
    expect(r.voyage).toBe("set");
    expect(r.embedder).toBe("failed");
    // A COMMAND, NEVER A JSON EDIT (finding #19, 2026-09-22): the one sentence
    // this console and `doctor` share names `credentials set`, which saves the
    // key and offers the switch again.
    expect(r.embedderFix).toBe(`Turn on: counterparts credentials set ${EMBED_KEY_ENV}`);
    expect(r.embedderFix).not.toContain('"enabled": true');
    expect(readFileSync(credsPath, "utf8")).toContain(EMBED_KEY_ENV);
    expect(f.said()).toContain("The key is saved.");
    expect(f.said()).not.toContain(VOYAGE_KEY);
  });
});

describe("enableEmbedder", () => {
  test("refuses a file that is not JSON, and leaves it exactly as it was", () => {
    writeFileSync(configPath, "{ not json");
    const r = enableEmbedder(configPath);
    expect(r.ok).toBe(false);
    expect(readFileSync(configPath, "utf8")).toBe("{ not json");
    expect(existsSync(`${configPath}.tmp`)).toBe(false);
  });

  test("refuses a JSON file that is not an object", () => {
    writeFileSync(configPath, "[1, 2, 3]");
    expect(enableEmbedder(configPath).ok).toBe(false);
    expect(readFileSync(configPath, "utf8")).toBe("[1, 2, 3]");
  });

  test("REPLACES the file rather than truncating it, and leaves no temp behind", () => {
    writeConfig();
    const before = statSync(configPath);
    expect(enableEmbedder(configPath).ok).toBe(true);
    const after = statSync(configPath);
    expect(after.ino).not.toBe(before.ino);
    expect(existsSync(`${configPath}.tmp`)).toBe(false);
    expect((after.mode & 0o777).toString(8)).toBe((before.mode & 0o777).toString(8));
  });

  test("an existing knob set to false is turned on, not doubled", () => {
    writeConfig({ embedder: { enabled: false } });
    expect(enableEmbedder(configPath).ok).toBe(true);
    const body = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    expect(body["embedder"]).toEqual({ enabled: true });
  });
});

// ── `credentials set` at a terminal (finding #2) ────────────────────────────

describe("counterparts credentials set, typed at a terminal", () => {
  /** The console `bin/counterparts.ts` builds on a real terminal: a prompt, a
   *  hidden reader, and both streams reporting a tty. */
  function atTerminal(hidden: readonly string[]): Fake {
    return terminal({ hidden });
  }

  async function set(
    f: Fake,
    name: string,
    over: { argv?: string[]; isTty?: boolean } = {},
  ): Promise<number> {
    return run(["credentials", "set", name, `--config=${configPath}`, ...(over.argv ?? [])], {
      io: f.io,
      env: {},
      home: root,
      stdin: {
        isTty: over.isTty ?? true,
        read: () => Promise.reject(new Error("stdin must not be read at a terminal")),
      },
    });
  }

  test("the key is read without echo, written, and the value reaches no stream", async () => {
    writeConfig();
    const f = atTerminal([ANTHROPIC_KEY]);
    expect(await set(f, API_KEY_ENV)).toBe(EXIT.ok);
    expect(readFileSync(credsPath, "utf8")).toContain(`${API_KEY_ENV}=${ANTHROPIC_KEY}`);
    expect((statSync(credsPath).mode & 0o777).toString(8)).toBe("600");
    const said = f.said();
    expect(said).not.toContain(ANTHROPIC_KEY);
    expect(said).not.toContain(ANTHROPIC_KEY.slice(0, 12));
    // One short line: the NAME and the FILE.
    expect(flat(f.out)).toContain(`set ${API_KEY_ENV} in ${credsPath}`);
    expect(f.err).toEqual([]);
  });

  test("Enter writes nothing, says so, and exits 0 — skipping is fine", async () => {
    writeConfig();
    const f = atTerminal([""]);
    expect(await set(f, API_KEY_ENV)).toBe(EXIT.ok);
    expect(existsSync(credsPath)).toBe(false);
    expect(f.out.join("\n")).toContain("nothing written");
    expect(f.err).toEqual([]);
  });

  test("Ctrl-C writes nothing and exits non-zero", async () => {
    writeConfig();
    const f = atTerminal(["\u0003"]);
    const code = await set(f, API_KEY_ENV);
    expect(code).not.toBe(EXIT.ok);
    expect(existsSync(credsPath)).toBe(false);
    expect(f.err.join("\n")).toContain("Nothing was written.");
  });

  /**
   * ITEM 6, AND WHAT MAKES DOCTOR'S FIX LINE TRUE.
   *
   * `doctor` now answers a missing embedder with `counterparts credentials set
   * VOYAGE_API_KEY` — a command, never an instruction to hand-edit JSON. That
   * sentence is only true if this command turns the thing on, so it asks the
   * same question the install asks, through the same function.
   */
  test("a typed VOYAGE_API_KEY offers the knob, and a yes writes the exact shape", async () => {
    writeConfig();
    const f = terminal({ hidden: [VOYAGE_KEY], answers: ["y"] });
    expect(await set(f, EMBED_KEY_ENV)).toBe(EXIT.ok);
    expect(readFileSync(credsPath, "utf8")).toContain(`${EMBED_KEY_ENV}=${VOYAGE_KEY}`);
    expect(f.asked.join("\n")).toContain("Turn on recall by meaning now?");
    expect(JSON.parse(readFileSync(configPath, "utf8"))["embedder"]).toEqual({ enabled: true });
    expect(f.said()).not.toContain(VOYAGE_KEY);
  });

  /**
   * ENTER IS NOT AN EXPLICIT YES (adversarial review M3). The question was
   * `[Y/n]`, so a bare Enter — the same key the person has just pressed twice
   * to decline the two optional keys above it — turned a third-party egress on,
   * one line under a docstring saying the knob moves on an explicit yes and on
   * nothing else.
   */
  test("ENTER at the embedder question leaves it off: the question is [y/N]", async () => {
    writeConfig();
    const f = terminal({ hidden: [VOYAGE_KEY], answers: [] });
    expect(await set(f, EMBED_KEY_ENV)).toBe(EXIT.ok);
    expect(readFileSync(credsPath, "utf8")).toContain(EMBED_KEY_ENV);
    expect(f.asked.join("\n")).toContain("Turn on recall by meaning now? [y/N]");
    expect(JSON.parse(readFileSync(configPath, "utf8"))["embedder"]).toBeUndefined();
  });

  test("a no leaves the knob alone, and the key is still saved — a key is not consent", async () => {
    writeConfig();
    const f = terminal({ hidden: [VOYAGE_KEY], answers: ["n"] });
    expect(await set(f, EMBED_KEY_ENV)).toBe(EXIT.ok);
    expect(readFileSync(credsPath, "utf8")).toContain(EMBED_KEY_ENV);
    expect(JSON.parse(readFileSync(configPath, "utf8"))["embedder"]).toBeUndefined();
  });

  test("the ANTHROPIC key is never asked about the embedder", async () => {
    writeConfig();
    const f = terminal({ hidden: [ANTHROPIC_KEY], answers: ["y"] });
    expect(await set(f, API_KEY_ENV)).toBe(EXIT.ok);
    expect(f.asked.join("\n")).not.toContain("recall by meaning");
    expect(JSON.parse(readFileSync(configPath, "utf8"))["embedder"]).toBeUndefined();
  });

  test("a PIPED Voyage key is asked nothing: an egress is not turned on for a script", async () => {
    writeConfig();
    const f = terminal({ hidden: ["must not be asked"] });
    const code = await run(["credentials", "set", EMBED_KEY_ENV, `--config=${configPath}`], {
      io: f.io,
      env: {},
      home: root,
      stdin: { isTty: false, read: () => Promise.resolve(`${VOYAGE_KEY}\n`) },
    });
    expect(code).toBe(EXIT.ok);
    expect(f.asked).toEqual([]);
    // The old single line, unwrapped and unmarked.
    expect(f.out).toEqual([`set ${EMBED_KEY_ENV} in ${credsPath}`]);
    expect(JSON.parse(readFileSync(configPath, "utf8"))["embedder"]).toBeUndefined();
  });

  test("an existing file's other lines survive a typed set", async () => {
    writeConfig();
    writeFileSync(credsPath, `# mine\n${EMBED_KEY_ENV}=keep-me\n`, { mode: 0o600 });
    const f = atTerminal([ANTHROPIC_KEY]);
    expect(await set(f, API_KEY_ENV)).toBe(EXIT.ok);
    const text = readFileSync(credsPath, "utf8");
    expect(text).toContain("# mine");
    expect(text).toContain(`${EMBED_KEY_ENV}=keep-me`);
  });

  /**
   * THE BYTES THAT MAY NOT MOVE. Every scripted caller — the suite, a CI job,
   * `tools/install-loop/run.sh` — reaches `credentials set` through a console
   * that declares no terminal, and that arm is untouched.
   */
  test("a console with no tty keeps the old refusal, word for word", async () => {
    writeConfig();
    const f = fake({ answers: null });
    const code = await run(["credentials", "set", API_KEY_ENV, `--config=${configPath}`], {
      io: f.io,
      env: {},
      home: root,
      stdin: { isTty: true, read: () => Promise.reject(new Error("never read")) },
    });
    expect(code).toBe(EXIT.usage);
    expect(f.err.join("\n")).toContain("refused: stdin is a terminal.");
    expect(f.err.join("\n")).toContain("--from-env");
    expect(existsSync(credsPath)).toBe(false);
  });

  test("a PIPE still reads stdin, and an empty pipe is still refused", async () => {
    writeConfig();
    const f = terminal({ hidden: ["must not be asked"] });
    const piped = await run(["credentials", "set", API_KEY_ENV, `--config=${configPath}`], {
      io: f.io,
      env: {},
      home: root,
      stdin: { isTty: false, read: () => Promise.resolve(`${ANTHROPIC_KEY}\n`) },
    });
    expect(piped).toBe(EXIT.ok);
    // The old single line, unwrapped and unmarked.
    expect(f.out).toEqual([`set ${API_KEY_ENV} in ${credsPath}`]);
    expect(f.askedHidden).toEqual([]);

    const g = terminal({ hidden: ["must not be asked"] });
    const empty = await run(["credentials", "set", EMBED_KEY_ENV, `--config=${configPath}`], {
      io: g.io,
      env: {},
      home: root,
      stdin: { isTty: false, read: () => Promise.resolve("  \n") },
    });
    expect(empty).toBe(EXIT.refused);
    expect(g.err.join("\n")).toContain("empty");
  });

  test("--stdin at a terminal still means read all of stdin", async () => {
    writeConfig();
    const f = terminal({ hidden: ["must not be asked"] });
    const code = await run(
      ["credentials", "set", API_KEY_ENV, `--config=${configPath}`, "--stdin"],
      {
        io: f.io,
        env: {},
        home: root,
        stdin: { isTty: true, read: () => Promise.resolve(`${ANTHROPIC_KEY}\n`) },
      },
    );
    expect(code).toBe(EXIT.ok);
    expect(f.askedHidden).toEqual([]);
    expect(readFileSync(credsPath, "utf8")).toContain(API_KEY_ENV);
  });

  test("--from-env at a terminal is unchanged and asks nothing", async () => {
    writeConfig();
    const f = terminal({ hidden: ["must not be asked"] });
    const code = await run(
      ["credentials", "set", API_KEY_ENV, `--config=${configPath}`, "--from-env", "MY_KEY"],
      {
        io: f.io,
        env: { MY_KEY: ANTHROPIC_KEY },
        home: root,
        stdin: { isTty: true, read: () => Promise.reject(new Error("never read")) },
      },
    );
    expect(code).toBe(EXIT.ok);
    expect(f.askedHidden).toEqual([]);
    expect(readFileSync(credsPath, "utf8")).toContain(`${API_KEY_ENV}=${ANTHROPIC_KEY}`);
  });

  test("CI set turns the terminal arm off, so a runner meets the refusal", async () => {
    writeConfig();
    const f = terminal({ hidden: [ANTHROPIC_KEY] });
    const code = await run(["credentials", "set", API_KEY_ENV, `--config=${configPath}`], {
      io: f.io,
      env: { CI: "1" },
      home: root,
      stdin: { isTty: true, read: () => Promise.reject(new Error("never read")) },
    });
    expect(code).toBe(EXIT.usage);
    expect(f.askedHidden).toEqual([]);
    expect(existsSync(credsPath)).toBe(false);
  });
});

// ── the one function that puts a secret on disk ─────────────────────────────

describe("writeCredential", () => {
  test("creates the file 0600 with one line, and never leaves a temp behind", () => {
    writeCredential(credsPath, API_KEY_ENV, ANTHROPIC_KEY);
    expect(readFileSync(credsPath, "utf8")).toBe(`${API_KEY_ENV}=${ANTHROPIC_KEY}\n`);
    expect((statSync(credsPath).mode & 0o777).toString(8)).toBe("600");
    expect(existsSync(`${credsPath}.tmp`)).toBe(false);
  });

  test("puts a 0644 file back to 0600 and replaces the inode", () => {
    writeFileSync(credsPath, "# nothing yet\n", { mode: 0o644 });
    const before = statSync(credsPath);
    writeCredential(credsPath, API_KEY_ENV, ANTHROPIC_KEY);
    const after = statSync(credsPath);
    expect((after.mode & 0o777).toString(8)).toBe("600");
    expect(after.ino).not.toBe(before.ino);
  });
});

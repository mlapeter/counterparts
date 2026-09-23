/**
 * `adapters/cli/keys.ts`, and `credentials set` at a terminal — new-user
 * finding #2, and the keyless round (roadmap C3, 2026-09-23).
 *
 * The stranger who installed `counterparts@0.1.0` on 2026-09-21 went looking
 * for the command that sets a key and it refused him for standing at a
 * terminal (#2). Since 2026-09-23 `install` asks about no key at all — both are
 * upgrades — and `credentials set` is the one door. These tests hold that door
 * and, above everything, the one rule it may not bend:
 *
 *   1. **A KEY VALUE REACHES NOTHING.** Every test that supplies one asserts it
 *      appears in neither stream, and the two that matter most assert it of a
 *      prefix of the value as well — a console that printed half a key has
 *      printed a key.
 *   2. **Not a terminal → today's bytes.** `credentials set` keeps its refusal
 *      and its one output line verbatim, because `tools/install-loop/run.sh`
 *      and the suite read them — plus, for the Voyage key only, the one line
 *      that says nothing turns on with it.
 *   3. **Skipping is always offered and always fine** (the owner, 2026-09-21):
 *      Enter at the hidden prompt writes nothing and is not an error.
 *   4. **An egress moves only on an explicit yes.** The Anthropic key's upgrade
 *      — the worker writing an ended session up at once, which sends it to
 *      Anthropic — is a `[y/N]` question after the key is saved, never the key
 *      itself. The Voyage key turns nothing on: Voyage is frozen.
 *
 * Hermetic (CLAUDE.md): a fresh temp dir per test, removed in `afterEach`, and
 * every console is a fake. Nothing here touches a real store, a real config or
 * a real credentials file.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { API_KEY_ENV, EMBED_KEY_ENV } from "../src/adapters/claude-code/config.js";
import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import {
  CRASH_WRITE_UP_API,
  CRASH_WRITE_UP_KEY,
  offerCrashWriteUp,
  setConfigKeys,
  tempSibling,
  voyageKeyLine,
  writeCredential,
} from "../src/adapters/cli/keys.js";
import { ownedKind } from "../src/adapters/cli/uninstall.js";
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

function configBody(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
}

// ── the configuration edit ──────────────────────────────────────────────────

describe("setConfigKeys", () => {
  test("refuses a file that is not JSON, and leaves it exactly as it was", () => {
    writeFileSync(configPath, "{ not json");
    const r = setConfigKeys(configPath, { [CRASH_WRITE_UP_KEY]: CRASH_WRITE_UP_API });
    expect(r.ok).toBe(false);
    expect(readFileSync(configPath, "utf8")).toBe("{ not json");
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  test("refuses a JSON file that is not an object", () => {
    writeFileSync(configPath, "[1, 2, 3]");
    expect(setConfigKeys(configPath, { a: 1 }).ok).toBe(false);
    expect(readFileSync(configPath, "utf8")).toBe("[1, 2, 3]");
  });

  test("never CREATES a configuration: an absent file is refused", () => {
    expect(setConfigKeys(configPath, { a: 1 }).ok).toBe(false);
    expect(existsSync(configPath)).toBe(false);
  });

  test("REPLACES the file rather than truncating it, and leaves no temp behind", () => {
    writeConfig();
    const before = statSync(configPath);
    expect(setConfigKeys(configPath, { [CRASH_WRITE_UP_KEY]: CRASH_WRITE_UP_API }).ok).toBe(true);
    const after = statSync(configPath);
    expect(after.ino).not.toBe(before.ino);
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect((after.mode & 0o777).toString(8)).toBe((before.mode & 0o777).toString(8));
  });

  // REVIEW OF #195, NIT 7: the file keeps its layout — the sniffing `connect`
  // uses on a settings file (#188), plus: a one-line configuration stays one line.
  test("a 4-space, CRLF, no-final-newline file keeps all three", () => {
    const body = { dataDir: "/x", identity: { name: "A" } };
    const text = JSON.stringify(body, null, 4).replace(/\n/g, "\r\n");
    writeFileSync(configPath, text);
    expect(setConfigKeys(configPath, { [CRASH_WRITE_UP_KEY]: CRASH_WRITE_UP_API }).ok).toBe(true);
    const after = readFileSync(configPath, "utf8");
    expect(after).toBe(
      JSON.stringify({ ...body, [CRASH_WRITE_UP_KEY]: CRASH_WRITE_UP_API }, null, 4).replace(/\n/g, "\r\n"),
    );
  });

  test("a tab-indented file stays tab-indented, with its final newline", () => {
    const body = { dataDir: "/x" };
    writeFileSync(configPath, `${JSON.stringify(body, null, "\t")}\n`);
    expect(setConfigKeys(configPath, { a: 1 }).ok).toBe(true);
    expect(readFileSync(configPath, "utf8")).toBe(`${JSON.stringify({ ...body, a: 1 }, null, "\t")}\n`);
  });

  test("a configuration written on ONE line stays on one line", () => {
    writeFileSync(configPath, `{"dataDir":"/x","owner":true}\n`);
    expect(setConfigKeys(configPath, { a: 1 }).ok).toBe(true);
    expect(readFileSync(configPath, "utf8")).toBe(`{"dataDir":"/x","owner":true,"a":1}\n`);
  });

  test("every other key survives, in its order; a new key is appended and an old one replaced", () => {
    writeConfig({ embedder: { enabled: true, kind: "static" }, [CRASH_WRITE_UP_KEY]: "old" });
    const keysBefore = Object.keys(configBody());
    expect(setConfigKeys(configPath, { [CRASH_WRITE_UP_KEY]: CRASH_WRITE_UP_API, extra: 1 }).ok).toBe(true);
    const body = configBody();
    expect(Object.keys(body)).toEqual([...keysBefore, "extra"]);
    expect(body[CRASH_WRITE_UP_KEY]).toBe(CRASH_WRITE_UP_API);
    expect(body["embedder"]).toEqual({ enabled: true, kind: "static" });
    expect(body["identity"]).toEqual({ name: "Placeholder" });
  });
});

// ── the Anthropic key's one upgrade ─────────────────────────────────────────

describe("offerCrashWriteUp — a key is not consent", () => {
  test("a yes writes the switch, and says where", async () => {
    writeConfig();
    const f = terminal({ answers: ["y"] });
    expect(await offerCrashWriteUp(f.io, ui(f.io, NO_ENV), configPath)).toBe("enabled");
    expect(f.asked.join("\n")).toContain("Write up ended sessions with the API from now on? [y/N]");
    expect(configBody()[CRASH_WRITE_UP_KEY]).toBe(CRASH_WRITE_UP_API);
    // The egress is said BEFORE the question, not after the yes.
    expect(f.said()).toContain("sends that conversation to Anthropic");
  });

  test("Enter is no: the configuration is untouched", async () => {
    writeConfig();
    const before = readFileSync(configPath, "utf8");
    const f = terminal({ answers: [""] });
    expect(await offerCrashWriteUp(f.io, ui(f.io, NO_ENV), configPath)).toBe("declined");
    expect(readFileSync(configPath, "utf8")).toBe(before);
    expect(f.said()).toContain("still wait for the next session");
  });

  test("a switch already on is not asked about again", async () => {
    writeConfig({ [CRASH_WRITE_UP_KEY]: CRASH_WRITE_UP_API });
    const f = terminal({ answers: ["n"] });
    expect(await offerCrashWriteUp(f.io, ui(f.io, NO_ENV), configPath)).toBe("already-on");
    expect(f.asked).toEqual([]);
  });

  test("a configuration that cannot be edited says so, and names the command to try again", async () => {
    writeFileSync(configPath, "{ not json");
    const f = terminal({ answers: ["y"] });
    expect(await offerCrashWriteUp(f.io, ui(f.io, NO_ENV), configPath)).toBe("failed");
    expect(readFileSync(configPath, "utf8")).toBe("{ not json");
    expect(f.said()).toContain(`counterparts credentials set ${API_KEY_ENV}`);
  });
});

// ── the Voyage key, frozen ──────────────────────────────────────────────────

describe("voyageKeyLine", () => {
  test("a configuration that names Voyage is told the key is used, and that Voyage is deprecated", () => {
    for (const embedder of [{ enabled: true }, { enabled: true, kind: "voyage" as const }]) {
      const line = voyageKeyLine({ embedder });
      expect(line).toContain("names Voyage");
      expect(line).toContain("deprecated");
    }
  });

  test("anything else is told nothing turns on, and that the local table is the default", () => {
    for (const config of [
      {},
      { embedder: { enabled: false } },
      { embedder: { enabled: true, kind: "static" as const } },
      { embedder: { enabled: false, kind: "voyage" as const } },
    ]) {
      const line = voyageKeyLine(config);
      expect(line).toContain("Nothing turns on");
      expect(line).toContain("local table");
    }
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
   * VOYAGE IS FROZEN (ROADMAP §"Amendments", 2026-09-23). Saving the key no
   * longer offers to switch the paid embedder on — nothing asks anything — and
   * the one line after the receipt says which of the two cases this is.
   */
  test("a typed VOYAGE_API_KEY is saved, asks NOTHING, and turns nothing on", async () => {
    writeConfig();
    const f = terminal({ hidden: [VOYAGE_KEY], answers: ["y"] });
    expect(await set(f, EMBED_KEY_ENV)).toBe(EXIT.ok);
    expect(readFileSync(credsPath, "utf8")).toContain(`${EMBED_KEY_ENV}=${VOYAGE_KEY}`);
    expect(f.asked).toEqual([]);
    expect(f.said()).toContain("Nothing turns on");
    expect(f.said()).not.toContain(VOYAGE_KEY);
  });

  /**
   * …AND TURNS NOTHING OFF (config.ts#resolveEmbedder). An absent block is the
   * local table unless the credentials file holds a Voyage key, so a FIRST key
   * saved into a configuration with no block would switch recall by meaning
   * off on the next process. The block the default stood for is written first,
   * and the screen says so.
   */
  /**
   * REVIEW OF #195, MINOR 5: THE PIN GOES FIRST. A key write that fails after
   * it (here: a dangling symlink where the credentials file should be) leaves
   * the configuration pinned to what the default already meant — never a key
   * saved beside no block, which is OFF.
   */
  test("the pin is written BEFORE the key: a key write that fails leaves the table pinned, and no key", async () => {
    writeConfig();
    symlinkSync(join(root, "not-there", "credentials.env"), credsPath);
    const f = terminal({ hidden: [VOYAGE_KEY] });
    const code = await set(f, EMBED_KEY_ENV);
    expect(code).not.toBe(EXIT.ok);
    expect(configBody()["embedder"]).toEqual({ enabled: true, kind: "static" });
    expect(lstatSync(credsPath).isSymbolicLink()).toBe(true);
    expect(existsSync(join(root, "not-there"))).toBe(false);
  });

  test("a first Voyage key into a configuration with NO block writes the local table, so nothing switches off", async () => {
    writeConfig();
    const f = terminal({ hidden: [VOYAGE_KEY] });
    expect(await set(f, EMBED_KEY_ENV)).toBe(EXIT.ok);
    expect(configBody()["embedder"]).toEqual({ enabled: true, kind: "static" });
    expect(f.said()).toContain("Recall by meaning stays on the local table");
  });

  test("a Voyage key the file ALREADY held, or a block that is there, is left as it was", async () => {
    writeConfig();
    writeFileSync(credsPath, `${EMBED_KEY_ENV}=pa-old-key-0123\n`, { mode: 0o600 });
    const f = terminal({ hidden: [VOYAGE_KEY] });
    expect(await set(f, EMBED_KEY_ENV)).toBe(EXIT.ok);
    expect(configBody()["embedder"]).toBeUndefined();
    expect(f.said()).not.toContain("stays on the local table");
    // REVIEW OF #195, MINOR 4: this is the one case the default is OFF, and the
    // line says so rather than "a local table by default".
    expect(f.said()).toContain("Recall by meaning is OFF here");
    expect(f.said()).toContain("counterparts install --force --embedder");
    expect(f.said()).not.toContain("Nothing turns on");

    writeConfig({ embedder: { enabled: false } });
    rmSync(credsPath, { force: true });
    const g = terminal({ hidden: [VOYAGE_KEY] });
    expect(await set(g, EMBED_KEY_ENV)).toBe(EXIT.ok);
    expect(configBody()["embedder"]).toEqual({ enabled: false });
  });

  test("a typed VOYAGE_API_KEY on a configuration that names Voyage is told it is used", async () => {
    writeConfig({ embedder: { enabled: true } });
    const f = terminal({ hidden: [VOYAGE_KEY] });
    expect(await set(f, EMBED_KEY_ENV)).toBe(EXIT.ok);
    expect(f.said()).toContain("names Voyage");
    // Left exactly as it was: no kind written, nothing flipped.
    expect(configBody()["embedder"]).toEqual({ enabled: true });
  });

  /**
   * THE ONE UPGRADE A KEY STILL OFFERS (roadmap C2/C3). Saving the Anthropic
   * key asks once whether the worker should write ended sessions up at once —
   * `[y/N]`, with the egress said above the question.
   */
  test("a typed ANTHROPIC_API_KEY offers the crash write-up switch, and a yes writes it", async () => {
    writeConfig();
    const f = terminal({ hidden: [ANTHROPIC_KEY], answers: ["y"] });
    expect(await set(f, API_KEY_ENV)).toBe(EXIT.ok);
    expect(f.asked.join("\n")).toContain("Write up ended sessions with the API from now on? [y/N]");
    expect(configBody()[CRASH_WRITE_UP_KEY]).toBe(CRASH_WRITE_UP_API);
    expect(configBody()["embedder"]).toBeUndefined();
    expect(f.said()).not.toContain(ANTHROPIC_KEY);
  });

  test("ENTER at that question leaves it off — the key is still saved", async () => {
    writeConfig();
    const f = terminal({ hidden: [ANTHROPIC_KEY], answers: [] });
    expect(await set(f, API_KEY_ENV)).toBe(EXIT.ok);
    expect(readFileSync(credsPath, "utf8")).toContain(API_KEY_ENV);
    expect(configBody()[CRASH_WRITE_UP_KEY]).toBeUndefined();
  });

  test("a PIPED key is asked nothing: an egress is not turned on for a script", async () => {
    writeConfig();
    const f = terminal({ hidden: ["must not be asked"], answers: ["y"] });
    const code = await run(["credentials", "set", API_KEY_ENV, `--config=${configPath}`], {
      io: f.io,
      env: {},
      home: root,
      stdin: { isTty: false, read: () => Promise.resolve(`${ANTHROPIC_KEY}\n`) },
    });
    expect(code).toBe(EXIT.ok);
    expect(f.asked).toEqual([]);
    expect(f.out).toEqual([`set ${API_KEY_ENV} in ${credsPath}`]);
    expect(configBody()[CRASH_WRITE_UP_KEY]).toBeUndefined();
  });

  test("a PIPED Voyage key keeps its receipt line and gains the one line about Voyage", async () => {
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
    expect(f.out[0]).toBe(`set ${EMBED_KEY_ENV} in ${credsPath}`);
    expect(f.out[1]).toBe(voyageKeyLine({}));
    // A script is told the one config edit too — the local table written in, so
    // the saved key does not switch the default off.
    expect(f.out[2]).toContain("Recall by meaning stays on the local table");
    expect(f.out).toHaveLength(3);
    expect(configBody()["embedder"]).toEqual({ enabled: true, kind: "static" });
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

// ── review n4: a temp name of each process's own ───────────────────────────

/**
 * `writeCredential` and `enableEmbedder` both wrote through a FIXED
 * `<path>.tmp`, so two writers at once shared one temp file, and a rename that
 * failed left the 0600 temp behind. The name is `<path>.<pid>.tmp` now, a
 * failure removes it, and it stays a name `uninstall` counts as ours.
 */
describe("review n4 — the temp file", () => {
  const temps = (): string[] => readdirSync(root).filter((n) => n.endsWith(".tmp"));

  test("is `<path>.<pid>.tmp`, and uninstall still reads it as a sidecar of ours", () => {
    expect(tempSibling(credsPath)).toBe(`${credsPath}.${String(process.pid)}.tmp`);
    const owned = {
      config: "claude-code.json",
      credentials: "credentials.env",
      scopes: "scopes.json",
      snapshots: null,
      store: null,
    };
    for (const path of [credsPath, configPath]) {
      const name = tempSibling(path).slice(root.length + 1);
      expect(ownedKind(name, owned)).toBe("sidecar");
    }
  });

  test("the OLD fixed name in the way stops neither writer", () => {
    // A directory at `<path>.tmp` made the old `writeFileSync(tmp, …)` throw.
    mkdirSync(`${credsPath}.tmp`);
    writeCredential(credsPath, API_KEY_ENV, ANTHROPIC_KEY);
    expect(readFileSync(credsPath, "utf8")).toBe(`${API_KEY_ENV}=${ANTHROPIC_KEY}\n`);
    writeConfig();
    mkdirSync(`${configPath}.tmp`);
    expect(setConfigKeys(configPath, { [CRASH_WRITE_UP_KEY]: CRASH_WRITE_UP_API }).ok).toBe(true);
    // Only the two directories this test made; no temp FILE of ours is left.
    expect(temps().sort()).toEqual(["claude-code.json.tmp", "credentials.env.tmp"]);
  });

  test("a rename that fails takes its temp file with it — the secret is not left beside the target", () => {
    // The target is a DIRECTORY, so the rename over it fails after the temp
    // file (holding the key) has been written.
    mkdirSync(credsPath);
    writeFileSync(join(credsPath, "keep"), "x");
    expect(() => writeCredential(credsPath, API_KEY_ENV, ANTHROPIC_KEY)).toThrow();
    expect(temps()).toEqual([]);
    expect(existsSync(tempSibling(credsPath))).toBe(false);
  });

  test("success leaves no temp of any name", () => {
    writeCredential(credsPath, API_KEY_ENV, ANTHROPIC_KEY);
    writeConfig();
    expect(setConfigKeys(configPath, { [CRASH_WRITE_UP_KEY]: CRASH_WRITE_UP_API }).ok).toBe(true);
    expect(temps()).toEqual([]);
  });
});

// ── #188 review M4: a symlinked file is written THROUGH, never replaced ─────

describe("a symlinked credentials or configuration file (#188 review M4)", () => {
  test("writeCredential writes the key into the file the link points at, and the link survives", () => {
    const secrets = join(root, "secrets");
    mkdirSync(secrets);
    const real = join(secrets, "creds.env");
    writeFileSync(real, "# mine\n", { mode: 0o644 });
    symlinkSync(real, credsPath);

    writeCredential(credsPath, API_KEY_ENV, ANTHROPIC_KEY);

    // The LINK is still a link, pointing where it pointed.
    expect(lstatSync(credsPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(credsPath)).toBe(real);
    // The key is in the real file, which is 0600 now, beside what was there.
    expect(readFileSync(real, "utf8")).toBe(`# mine\n${API_KEY_ENV}=${ANTHROPIC_KEY}\n`);
    expect((statSync(real).mode & 0o777).toString(8)).toBe("600");
    // And no temp file is left in either directory.
    for (const dir of [root, secrets]) {
      expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    }
  });

  test("a second key through the same link replaces nothing but its own line", () => {
    const real = join(root, "elsewhere.env");
    writeFileSync(real, "", { mode: 0o600 });
    symlinkSync(real, credsPath);
    writeCredential(credsPath, API_KEY_ENV, ANTHROPIC_KEY);
    writeCredential(credsPath, EMBED_KEY_ENV, VOYAGE_KEY);
    expect(lstatSync(credsPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, "utf8")).toBe(
      `${API_KEY_ENV}=${ANTHROPIC_KEY}\n${EMBED_KEY_ENV}=${VOYAGE_KEY}\n`,
    );
  });

  test("a DANGLING link is refused by name, and nothing is created at either end", () => {
    const missing = join(root, "not-mounted", "creds.env");
    symlinkSync(missing, credsPath);
    expect(() => writeCredential(credsPath, API_KEY_ENV, ANTHROPIC_KEY)).toThrow(
      "is a symbolic link to",
    );
    expect(lstatSync(credsPath).isSymbolicLink()).toBe(true);
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(join(root, "not-mounted"))).toBe(false);
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  test("setConfigKeys writes through a symlinked configuration too, keeping its mode", () => {
    const real = join(root, "dotfiles-config.json");
    writeFileSync(real, `${JSON.stringify({ dataDir: "/x" }, null, 2)}\n`, { mode: 0o640 });
    symlinkSync(real, configPath);
    expect(setConfigKeys(configPath, { [CRASH_WRITE_UP_KEY]: CRASH_WRITE_UP_API }).ok).toBe(true);
    expect(lstatSync(configPath).isSymbolicLink()).toBe(true);
    const body = JSON.parse(readFileSync(real, "utf8")) as Record<string, unknown>;
    expect(body[CRASH_WRITE_UP_KEY]).toBe(CRASH_WRITE_UP_API);
    expect(body["dataDir"]).toBe("/x");
    expect((statSync(real).mode & 0o777).toString(8)).toBe("640");
  });
});

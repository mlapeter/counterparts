/**
 * `counterparts install` AS THE UNDO OF `counterparts uninstall --park`.
 *
 * The owner's item 11 of 2026-09-22, and the trial finding behind it (#22): the
 * way back from a park was a pasted shell line carrying an `if [ -e … ] …
 * REFUSING … mv … fi` guard. "Doesn't make sense." So the undo is the command a
 * person runs when they come back, and this file is the guard, in tests.
 *
 * ── WHAT EVERY TEST HERE IS ULTIMATELY ABOUT ────────────────────────────────
 *
 * This is the one piece of the round that MOVES SOMEBODY'S DATA, so the claims
 * are stated as things that must not happen:
 *
 *   1. **The parked folder is never opened** — not the store, not the config,
 *      not any file in it. What the fingerprint below proves is the OUTER half
 *      of that: nothing under the folder was moved, renamed, resized or
 *      WRITTEN (names, sizes and mtimes, before and after, on every path that
 *      leaves it parked). It cannot prove "not opened" — `openSync`, a
 *      `readFileSync` and a read-only SQLite open that never checkpoints all
 *      leave those three alone — so the not-opened half is held by the second
 *      spy test below, which fails if anything under a parked folder is passed
 *      to `open`, and by `install.ts`'s own call list.
 *   2. **It moves by ONE rename, never a copy** — proved by the directory's
 *      inode, which a copy would not preserve.
 *   3. **Nothing moves without a typed answer.** Enter is not consent, an
 *      unrecognised answer twice stops the command, and a console that is not a
 *      terminal is never asked at all.
 *   4. **Anything that cannot be brought back is refused BY NAME, with the
 *      reason, and left exactly where it is** — a symlink above all, because a
 *      link renamed into place would point `~/.counterparts` at whatever it
 *      names, and the next `Store.open` would open that.
 *
 * Hermetic (CLAUDE.md): every test mints its own temp HOME under the OS temp
 * dir and removes it; the store it parks is a REAL one made by this package's
 * own non-interactive install, so nothing here hand-forges a database; `claude`
 * is never run (the spawner is injected) and no host file is touched.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import {
  bringParkedBack,
  parkedNameParts,
  parkedSiblings,
} from "../src/adapters/cli/install.js";
import { pairedSuffix } from "../src/adapters/cli/start-fresh.js";
import { PromptAborted } from "../src/adapters/cli/ui.js";
import type { ProcessLister, SpawnResult, Spawner } from "../src/adapters/cli/wire.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "counterparts-parked-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const ENV: Record<string, string | undefined> = { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };
const OK: SpawnResult = { missing: false, code: 0, out: "", err: "" };
const noProcesses: ProcessLister = () => ({ looked: true, processes: [] });
const spawner: Spawner = () => OK;

const base = (): string => join(home, ".counterparts");
const configPath = (): string => join(base(), "claude-code.json");

interface Console_ {
  io: Io;
  out: string[];
  err: string[];
  asked: string[];
}

/** A console that says it is a terminal — and therefore also supplies
 *  `promptHidden`, the trap `ui.ts` names. The key questions are answered by an
 *  empty prompt, which is "no". */
function terminal(answers: readonly string[]): Console_ {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const queue = [...answers];
  return {
    out,
    err,
    asked,
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      tty: { stdin: true, stdout: true },
      prompt: (question: string): Promise<string> => {
        asked.push(question);
        return Promise.resolve(queue.shift() ?? "");
      },
      promptHidden: (): Promise<string> => Promise.resolve(""),
    },
  };
}

/** A console with no terminal at all: the scripted arm. */
function piped(): Console_ {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    asked: [],
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
  };
}

const text = (lines: readonly string[]): string => lines.join("\n");

/** The same lines with the colour escapes stripped and the wrapping folded back
 *  out. A terminal console colours and wraps — that is the point of it — and an
 *  assertion about WHAT was said should not also be an assertion about where the
 *  eightieth character fell. (`test/keys.test.ts` carries the same helper, for
 *  the same reason.) */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const flat = (lines: readonly string[]): string =>
  lines.join(" ").replace(ANSI, "").replace(/\s+/g, " ").trim();

async function install(io: Io, argv: readonly string[] = []): Promise<number> {
  return run(["install", "--config", configPath(), ...argv], {
    io,
    env: ENV,
    home,
    spawner,
    processes: noProcesses,
  });
}

/**
 * A REAL parked memory: this package's own install, run without a terminal,
 * then renamed the way `uninstall --park` renames it (one `rename`, dated
 * suffix). Nothing here forges a store by hand — the point of the whole feature
 * is a directory that opens afterwards.
 */
async function park(date = "2026-09-20", name = "Ada"): Promise<string> {
  const code = await install(piped().io, ["--budget", "9000", "--name", name]);
  expect(code).toBe(EXIT.ok);
  const parked = `${base()}.parked-${date}`;
  renameSync(base(), parked);
  return parked;
}

/** Every path under a tree with its size and mtime: the evidence that nothing
 *  under it was moved, added, removed, resized or written. NOT evidence that
 *  nothing was opened — see the spy test for that half. */
function fingerprint(root: string): string[] {
  const out: string[] = [];
  const walk = (path: string): void => {
    const stat = lstatSync(path);
    out.push(
      `${relative(root, path)} ${stat.isDirectory() ? "d" : "f"} ${String(stat.size)} ${String(stat.mtimeMs)}`,
    );
    if (!stat.isDirectory()) return;
    for (const entry of readdirSync(path).sort()) walk(join(path, entry));
  };
  walk(root);
  return out.sort();
}

/** `dev:ino` — a rename keeps it, a copy cannot. */
function identity(path: string): string {
  const stat = statSync(path);
  return `${String(stat.dev)}:${String(stat.ino)}`;
}

// ── the question, and the two answers ───────────────────────────────────────

describe("install finds a parked memory", () => {
  test("asks before anything else, and `back` brings it home in ONE rename", async () => {
    const parked = await park();
    const was = identity(parked);
    const c = terminal(["back"]);
    expect(await install(c.io)).toBe(EXIT.ok);

    // The question came first — before the name, before the store, before the
    // host — and it named the date and a size.
    expect(c.asked[0]).toContain("Found memory set aside on 2026-09-20");
    expect(c.asked[0]).toContain("Bring it back, or start blank? [back/blank]");

    // ONE RENAME: the same directory, at the new path.
    expect(existsSync(parked)).toBe(false);
    expect(identity(base())).toBe(was);
    expect(existsSync(join(base(), "store"))).toBe(true);

    // And the conversation carried on as the second run it now is.
    const said = text(c.out);
    expect(said).toContain("Welcome back, Ada.");
    expect(said).not.toContain("What should this memory call you?");
    expect(said).toContain("Done. Your memory lives at ~/.counterparts.");
    // No count, and it says why rather than leaving the gap unexplained.
    expect(said).toContain("nothing was opened");
  });

  /**
   * A FLAG THAT IS SILENTLY DROPPED IS ONE SOMEBODY RE-PASSES FOREVER (review
   * m2). The identity core is an ENSURE and the configuration is kept, so
   * `--name` against a memory that already has one was accepted, ignored and
   * invisible.
   */
  test("`--name` against a restored memory says it was not used, and changes nothing", async () => {
    await park("2026-09-20", "Ada");
    const c = terminal(["back"]);
    expect(await install(c.io, ["--name", "Zed"])).toBe(EXIT.ok);
    const said = flat(c.out);
    expect(said).toContain("Welcome back, Ada.");
    expect(said).toContain("--name was not used: this memory is already called Ada.");
    expect(
      (JSON.parse(readFileSync(configPath(), "utf8")) as { identity?: { name?: string } }).identity
        ?.name,
    ).toBe("Ada");
  });

  test("`--name` that matches the name it already has says nothing at all", async () => {
    await park("2026-09-20", "Ada");
    const c = terminal(["back"]);
    expect(await install(c.io, ["--name", "Ada"])).toBe(EXIT.ok);
    expect(flat(c.out)).not.toContain("--name was not used");
  });

  test("`blank` moves nothing, says the folder is untouched, and starts a store", async () => {
    const parked = await park();
    const before = fingerprint(parked);
    const c = terminal(["blank", "Mike"]);
    expect(await install(c.io)).toBe(EXIT.ok);

    // THE PARKED TREE IS BYTE-FOR-BYTE WHAT IT WAS: same names, same sizes,
    // same mtimes. Nothing opened it, and nothing moved it.
    expect(fingerprint(parked)).toEqual(before);
    expect(flat(c.out)).toContain("is untouched, exactly as it was");
    // And the blank start really is one: a new store, and a name was asked for.
    expect(text(c.asked)).toContain("What should this memory call you?");
    expect(existsSync(join(base(), "store"))).toBe(true);
    expect(text(c.out)).toContain("Nice to meet you, Mike.");
  });

  test("Enter is not an answer: asked once more, then stopped with nothing moved", async () => {
    const parked = await park();
    const before = fingerprint(parked);
    const c = terminal(["", ""]);
    expect(await install(c.io)).toBe(EXIT.refused);
    expect(fingerprint(parked)).toEqual(before);
    expect(existsSync(base())).toBe(false);
    expect(c.asked).toHaveLength(2);
    expect(text(c.err)).toContain("Nothing was changed");
  });

  test("a word that is neither is asked once more, and a good answer then works", async () => {
    const parked = await park();
    const c = terminal(["yes please", "back"]);
    expect(await install(c.io)).toBe(EXIT.ok);
    expect(existsSync(parked)).toBe(false);
    // The re-ask NAMES the answers rather than pointing back at the brackets.
    expect(text(c.out)).toContain("Answer back or blank.");
  });

  test("a cancelled prompt (Esc, Ctrl-C) leaves everything where it is", async () => {
    const parked = await park();
    const before = fingerprint(parked);
    const c = terminal([]);
    // The reader that aborts rather than answering — what `ui.ts`'s hidden
    // reader throws for Ctrl-C, and what Esc raises at every prompt.
    const io: Io = {
      ...c.io,
      prompt: () => Promise.reject(new PromptAborted("interrupt", "cancelled.")),
    };
    expect(await install(io)).toBe(EXIT.refused);
    expect(fingerprint(parked)).toEqual(before);
    expect(existsSync(base())).toBe(false);
    expect(text(c.out)).toContain("stopped; nothing else was changed");
    expect(text(c.out)).toContain("No store was created");
  });
});

/**
 * THE NOT-OPENED HALF, WHICH A FINGERPRINT CANNOT SEE (review m3).
 *
 * `fingerprint` proves nothing under the folder was written. It says nothing
 * about a file being READ — `openSync`, `readFileSync` and a read-only SQLite
 * open that never checkpoints all leave names, sizes and mtimes exactly as they
 * were. So this spies the module's own `node:fs` for the length of a run and
 * fails if ANY opening call is handed a path under a parked folder.
 */
describe("nothing under a parked folder is ever opened", () => {
  test("no open, no read, no file handle — on the path that leaves it parked", async () => {
    const parked = await park();
    const fs = await import("node:fs");
    const touched: string[] = [];
    const watch = ["openSync", "readFileSync", "createReadStream", "opendirSync"] as const;
    const originals = watch.map((name) => [name, Reflect.get(fs, name) as unknown] as const);
    for (const [name, fn] of originals) {
      Reflect.set(fs, name, (...args: unknown[]) => {
        const first = args[0];
        if (typeof first === "string" && first.startsWith(parked)) touched.push(`${name} ${first}`);
        return (fn as (...a: unknown[]) => unknown)(...args);
      });
    }
    try {
      const c = terminal(["blank", "Mike"]);
      expect(await install(c.io)).toBe(EXIT.ok);
    } finally {
      for (const [name, fn] of originals) Reflect.set(fs, name, fn);
    }
    expect(touched).toEqual([]);
  });
});

// ── more than one ───────────────────────────────────────────────────────────

describe("several parked memories", () => {
  test("are listed newest first and picked by number", async () => {
    const older = await park("2026-09-18", "Ada");
    const newer = await park("2026-09-20", "Mike");
    const c = terminal(["2"]);
    expect(await install(c.io)).toBe(EXIT.ok);

    const said = text(c.out);
    // NEWEST FIRST, so the numbers a person types are stable and the one they
    // probably want is 1.
    const first = said.indexOf("2026-09-20");
    const second = said.indexOf("2026-09-18");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(c.asked[0]).toContain("[1/2/blank]");

    // 2 is the OLDER one, and it is the one that moved.
    expect(existsSync(older)).toBe(false);
    expect(existsSync(newer)).toBe(true);
    expect(said).toContain("Welcome back, Ada.");
  });

  test("a second park on the same day sorts above the first", () => {
    mkdirSync(join(home, ".counterparts.parked-2026-09-20", "store"), { recursive: true });
    mkdirSync(join(home, ".counterparts.parked-2026-09-20-2", "store"), { recursive: true });
    const found = parkedSiblings(base(), home);
    expect(found.map((one) => one.ordinal)).toEqual([2, 1]);
  });

  test("`blank` with several says all of them are untouched", async () => {
    const a = await park("2026-09-18");
    const b = await park("2026-09-20");
    const before = [fingerprint(a), fingerprint(b)];
    const c = terminal(["blank", "Mike"]);
    expect(await install(c.io)).toBe(EXIT.ok);
    expect([fingerprint(a), fingerprint(b)]).toEqual(before);
  });
});

// ── the refusals ────────────────────────────────────────────────────────────

describe("what will not be brought back", () => {
  /**
   * THE SHARP ONE. `~/.counterparts.parked-<date> -> ~/.bansai` renamed into
   * place makes `~/.counterparts` a link into v1's live memory, and the very
   * next `Store.open` opens it. CLAUDE.md forbids that twice over.
   */
  test("a SYMLINK is refused by name, and the link is not moved", async () => {
    const elsewhere = join(home, "somewhere-else");
    mkdirSync(join(elsewhere, "store"), { recursive: true });
    const parked = join(home, ".counterparts.parked-2026-09-20");
    symlinkSync(elsewhere, parked);
    const c = terminal(["Mike"]);
    expect(await install(c.io)).toBe(EXIT.ok);

    const said = flat(c.out);
    expect(said).toContain("SYMBOLIC LINK");
    expect(said).toContain("cannot be brought back");
    // The FOLDER's own clause, named — not the one inside it, which writes a
    // different sentence about a `store` path.
    expect(said).toContain("Renaming a link moves the link");
    // The link is still a link, pointing where it pointed.
    expect(lstatSync(parked).isSymbolicLink()).toBe(true);
    expect(existsSync(join(elsewhere, "store"))).toBe(true);
    // And this was a first install, so it asked for a name.
    expect(text(c.asked)).toContain("What should this memory call you?");
  });

  /**
   * A STORE FROM BEFORE THE ROWS FLOOR. `preRowsMarkersIn` reads FILENAMES and
   * opens nothing, which is the only reason this check may be made at all —
   * and it is why the fixture here is the filenames themselves rather than an
   * old-floor database: the claim is about what the names say.
   */
  test("an OLD-FLOOR store is refused by name, with the reason, and left where it is", async () => {
    const parked = join(home, ".counterparts.parked-2026-09-20");
    mkdirSync(join(parked, "store", "prose"), { recursive: true });
    writeFileSync(join(parked, "store", "operational.sqlite"), "not a database");
    const before = fingerprint(parked);
    const c = terminal(["Mike"]);
    expect(await install(c.io)).toBe(EXIT.ok);

    const said = flat(c.out);
    expect(said).toContain("before the rows floor");
    expect(said).toContain("operational.sqlite");
    expect(said).toContain("floor/v5-last");
    expect(fingerprint(parked)).toEqual(before);
    // Nothing was offered, so nothing was asked about it — paired with a
    // positive, so an early exit could not pass this by saying nothing.
    expect(text(c.asked)).toContain("What should this memory call you?");
    expect(text(c.asked)).not.toContain("Bring it back");
  });

  /**
   * THE SAME CLAUSE ONE DIRECTORY DOWN, and the reason it is not redundant: a
   * REAL parked directory holding `store -> somewhere-else` clears the folder's
   * own symlink test and the home-containment test. Without this clause
   * `preRowsMarkersIn` would `readdir` through the link — a read of whatever it
   * names, which on a real machine is `~/.bansai/store` — and, finding no
   * pre-rows filenames, would let the rename put `~/.counterparts/store` on top
   * of somebody else's memory. `assertSafeDataDir` is string math and follows
   * no links, so nothing downstream would catch it.
   */
  test("a SYMLINKED store INSIDE a real parked folder is refused before anything reads it", async () => {
    const elsewhere = join(home, "not-this-install");
    mkdirSync(join(elsewhere, "cache"), { recursive: true });
    writeFileSync(join(elsewhere, "counterparts.sqlite"), "somebody else's memory");
    const parked = join(home, ".counterparts.parked-2026-09-20");
    mkdirSync(parked, { recursive: true });
    symlinkSync(elsewhere, join(parked, "store"));
    const before = fingerprint(elsewhere);

    const c = terminal(["Mike"]);
    expect(await install(c.io)).toBe(EXIT.ok);
    const said = flat(c.out);
    // THE INNER CLAUSE, BY ITS OWN WORDS. The folder-level clause emits
    // "SYMBOLIC LINK" too, so that string alone would pass even if the clause
    // this test exists to pin never ran. The `store` path and the sentence only
    // this branch writes are what distinguish them.
    expect(said).toContain(join(parked, "store"));
    expect(said).toContain("nothing in it was read");
    expect(said).toContain("cannot be brought back");
    // The link is still a link, and what it points at is untouched.
    expect(lstatSync(join(parked, "store")).isSymbolicLink()).toBe(true);
    expect(fingerprint(elsewhere)).toEqual(before);
    // It was never a candidate, so it was never offered — and the run really
    // did get as far as the questions, which an empty `asked` alone would not
    // tell us.
    expect(text(c.asked)).toContain("What should this memory call you?");
    expect(text(c.asked)).not.toContain("Bring it back");
    // …and `bringParkedBack` refuses it too, which is what guards the rename
    // itself against a folder that changed between the question and the answer.
    const r = bringParkedBack(parked, join(home, ".counterparts-elsewhere"), home);
    expect(r.ok).toBe(false);
  });

  test("a folder with no store in it is refused: the memory was parked separately", async () => {
    const parked = join(home, ".counterparts.parked-2026-09-20");
    mkdirSync(parked, { recursive: true });
    writeFileSync(join(parked, "claude-code.json"), "{}");
    const c = terminal(["Mike"]);
    expect(await install(c.io)).toBe(EXIT.ok);
    expect(flat(c.out)).toContain("holds no 'store' directory");
    expect(existsSync(parked)).toBe(true);
  });

  /**
   * THE TWO ENDS OF THE SAME FEATURE, PINNED TO EACH OTHER. `uninstall --park`
   * builds its suffix with `start-fresh#pairedSuffix`; this file recognises a
   * parked folder with a regular expression. A change to either that the other
   * does not follow is an undo that silently stops finding anything — so the
   * name the park WRITES is checked against the name this READS, rather than
   * both being written out twice.
   */
  test("the name `uninstall --park` writes is the name this reads", () => {
    for (const taken of [[], [`${base()}.parked-2026-09-20`]]) {
      const suffix = pairedSuffix([base()], "2026-09-20", (c) => taken.includes(c));
      const parts = parkedNameParts(`.counterparts${suffix}`, ".counterparts");
      expect(parts).not.toBeNull();
      expect(parts?.date).toBe("2026-09-20");
    }
  });

  test("a name this package does not write is not a candidate at all", () => {
    mkdirSync(join(home, ".counterparts.parked-yesterday"), { recursive: true });
    mkdirSync(join(home, ".counterparts.backup-2026-09-20"), { recursive: true });
    mkdirSync(join(home, ".counterparts-parked-2026-09-20"), { recursive: true });
    expect(parkedSiblings(base(), home)).toEqual([]);
    expect(parkedNameParts(".counterparts.parked-2026-09-20", ".counterparts")).toEqual({
      date: "2026-09-20",
      ordinal: 1,
    });
    expect(parkedNameParts(".counterparts.parked-2026-09-20-3", ".counterparts")).toEqual({
      date: "2026-09-20",
      ordinal: 3,
    });
  });
});

// ── the rename's own guard ──────────────────────────────────────────────────

describe("bringParkedBack", () => {
  /**
   * THE GUARD IS RE-MADE AGAINST THE GROUND, immediately before the call: the
   * person has been at a prompt in between, and a plan made before somebody
   * went to make coffee is a plan about a filesystem that may have changed
   * (scar §2.13). A `rename` onto a directory that is there is how one folder
   * ends up INSIDE another (review M3, measured on macOS).
   */
  test("refuses when the destination exists by then, and moves nothing", async () => {
    const parked = await park();
    mkdirSync(base(), { recursive: true });
    writeFileSync(join(base(), "claude-code.json"), "{}");
    const before = fingerprint(parked);
    const r = bringParkedBack(parked, base(), home);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("exists again");
    expect(fingerprint(parked)).toEqual(before);
    expect(readFileSync(join(base(), "claude-code.json"), "utf8")).toBe("{}");
    // And nothing was nested inside it.
    expect(readdirSync(base())).toEqual(["claude-code.json"]);
  });

  test("refuses a DANGLING symlink at the destination — something is at that path", async () => {
    const parked = await park();
    symlinkSync(join(home, "not-there"), base());
    const r = bringParkedBack(parked, base(), home);
    expect(r.ok).toBe(false);
    // THE DESTINATION clause, by name: `existsSync` answers false for a
    // dangling link, so a refusal for any other reason would hide the bug this
    // test is about.
    if (!r.ok) expect(r.reason).toContain("exists again");
    expect(existsSync(parked)).toBe(true);
  });

  test("refuses a source outside the home, however it was named", async () => {
    const outside = mkdtempSync(join(tmpdir(), "counterparts-outside-"));
    try {
      mkdirSync(join(outside, "store"), { recursive: true });
      const r = bringParkedBack(outside, base(), home);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("outside your home directory");
      expect(existsSync(join(outside, "store"))).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

// ── the scripted arm, which must not move anything ever ─────────────────────

describe("off a terminal", () => {
  test("no question, no rename — the non-interactive install is exactly as before", async () => {
    const parked = await park();
    const before = fingerprint(parked);
    const c = piped();
    expect(await install(c.io, ["--budget", "9000"])).toBe(EXIT.ok);
    expect(fingerprint(parked)).toEqual(before);
    expect(existsSync(join(base(), "store"))).toBe(true);
    expect(text(c.out)).toContain("Two steps left");
  });

  test("--no-connect at a terminal is the scripted arm too: nothing is offered", async () => {
    const parked = await park();
    const before = fingerprint(parked);
    const c = terminal(["back"]);
    expect(await install(c.io, ["--no-connect", "--budget", "9000"])).toBe(EXIT.ok);
    expect(fingerprint(parked)).toEqual(before);
    expect(c.asked).toEqual([]);
  });
});

// ── what a FORCED install must not forget (review B1) ───────────────────────

describe("install --force over a configuration that is already there", () => {
  /**
   * THE BLOCKER THE ADVERSARIAL REVIEW FOUND, ON THE PATH THAT MAKES IT WORST.
   *
   * `configObject` writes `identity` only from `--name` and `embedder` only
   * from `--embedder`, and the interactive arm injected a 9000-byte ceiling
   * when none was given — so `install --force` rewrote the file with three of
   * the owner's own settings missing, and `quiet` had swallowed the one line
   * that said the file had been replaced at all. One line after the screen said
   * the parked folder came back untouched.
   */
  async function parkRich(): Promise<string> {
    const code = await install(piped().io, [
      "--budget",
      "40000",
      "--name",
      "Ada",
      "--embedder",
    ]);
    expect(code).toBe(EXIT.ok);
    const parked = `${base()}.parked-2026-09-20`;
    renameSync(base(), parked);
    return parked;
  }

  test("keeps the name, the embedder setting and the ceiling — and SAYS it replaced the file", async () => {
    const parked = await parkRich();
    const before = readFileSync(join(parked, "claude-code.json"), "utf8");
    const c = terminal(["back"]);
    expect(await install(c.io, ["--force"])).toBe(EXIT.ok);

    // Byte for byte what the parked folder carried: `--force` is consent to
    // rewrite a file, never consent to forget what it said.
    expect(readFileSync(configPath(), "utf8")).toBe(before);
    const body = JSON.parse(before) as Record<string, unknown>;
    expect(body["identity"]).toEqual({ name: "Ada" });
    // `--embedder` means the local table since 2026-09-23 (roadmap C3).
    expect(body["embedder"]).toEqual({ enabled: true, kind: "static" });
    expect(body["injectionBudgetBytes"]).toBe(40000);

    // AND THE REPLACEMENT IS NEVER SILENT, even on the quiet arm.
    const said = flat(c.out);
    expect(said).toContain(`replaced ${configPath()}`);
    expect(said).toContain("kept from the file it replaced");
    expect(said).toContain("Welcome back, Ada.");
  });

  test("a flag on the line still wins over what the old file said", async () => {
    await parkRich();
    const c = terminal(["back"]);
    expect(await install(c.io, ["--force", "--budget", "1234"])).toBe(EXIT.ok);
    const body = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    expect(body["injectionBudgetBytes"]).toBe(1234);
    // …and everything it did not name is still there.
    expect(body["identity"]).toEqual({ name: "Ada" });
    expect(body["embedder"]).toEqual({ enabled: true, kind: "static" });
  });

  test("a key an owner added by hand survives a forced write too", async () => {
    await install(piped().io, ["--budget", "9000", "--name", "Ada"]);
    const path = configPath();
    const body = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    body["somethingOwnersAdded"] = { keep: "me" };
    writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
    const c = piped();
    expect(await install(c.io, ["--force", "--budget", "9000"])).toBe(EXIT.ok);
    const after = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(after["somethingOwnersAdded"]).toEqual({ keep: "me" });
    expect(text(c.out)).toContain(`replaced ${path}`);
  });

  test("--force MOVES an install: dataDir and credentialsFile are never carried", async () => {
    await install(piped().io, ["--budget", "9000", "--name", "Ada"]);
    const elsewhere = join(home, "elsewhere", "store");
    const c = piped();
    expect(await install(c.io, ["--force", "--dir", elsewhere, "--budget", "9000"])).toBe(EXIT.ok);
    const body = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    expect(body["dataDir"]).toBe(elsewhere);
    expect(body["credentialsFile"]).toBe(join(base(), "credentials.env"));
    expect(body["identity"]).toEqual({ name: "Ada" });
  });

  test("the interactive default ceiling is injected only when the config is NEW", async () => {
    // A fresh install at a terminal gets the 9000 the conversation supplies…
    const first = terminal(["Mike"]);
    expect(await install(first.io)).toBe(EXIT.ok);
    expect(
      (JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>)[
        "injectionBudgetBytes"
      ],
    ).toBe(9000);
    // …and a config that says 40000 keeps it through a forced re-run, because
    // an injected default is a value nobody typed.
    const path = configPath();
    const body = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    body["injectionBudgetBytes"] = 40000;
    writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
    const again = terminal([]);
    expect(await install(again.io, ["--force"])).toBe(EXIT.ok);
    expect(
      (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>)["injectionBudgetBytes"],
    ).toBe(40000);
  });
});

// ── which embedder a (forced) install writes (roadmap C3; #190 MINOR 4) ─────

describe("install and the embedder block: the local table, and a kind is never flipped", () => {
  const read = (): Record<string, unknown> =>
    JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;

  /** An existing install whose configuration says `embedder` = `block`, with a
   *  Voyage key saved or not. Written by the scripted arm, then edited. */
  async function existing(block: unknown, voyageKey: boolean): Promise<void> {
    expect(await install(piped().io, ["--budget", "9000", "--name", "Ada"])).toBe(EXIT.ok);
    const body = read();
    if (block === undefined) delete body["embedder"];
    else body["embedder"] = block;
    writeFileSync(configPath(), `${JSON.stringify(body, null, 2)}\n`);
    if (voyageKey) {
      writeFileSync(join(base(), "credentials.env"), "VOYAGE_API_KEY=pa-not-a-real-key-0123\n", { mode: 0o600 });
    }
  }

  test("a scripted install with no flag writes NO embedder block — the scripted arm's bytes do not move", async () => {
    expect(await install(piped().io, ["--budget", "9000", "--name", "Ada"])).toBe(EXIT.ok);
    expect(read()["embedder"]).toBeUndefined();
  });

  test("a scripted --embedder writes the local table", async () => {
    expect(await install(piped().io, ["--budget", "9000", "--embedder"])).toBe(EXIT.ok);
    expect(read()["embedder"]).toEqual({ enabled: true, kind: "static" });
  });

  test("MINOR 4: --force --embedder over a STATIC configuration keeps static", async () => {
    await existing({ enabled: true, kind: "static" }, false);
    expect(await install(piped().io, ["--force", "--embedder", "--budget", "9000"])).toBe(EXIT.ok);
    expect(read()["embedder"]).toEqual({ enabled: true, kind: "static" });
  });

  test("--force --embedder over a configuration that names voyage keeps voyage", async () => {
    await existing({ enabled: false, kind: "voyage" }, true);
    expect(await install(piped().io, ["--force", "--embedder", "--budget", "9000"])).toBe(EXIT.ok);
    expect(read()["embedder"]).toEqual({ enabled: true, kind: "voyage" });
  });

  test("a 0.2.0 kind-less block beside a saved Voyage key stays kind-less — a paid setup is not flipped", async () => {
    await existing({ enabled: false }, true);
    expect(await install(piped().io, ["--force", "--embedder", "--budget", "9000"])).toBe(EXIT.ok);
    expect(read()["embedder"]).toEqual({ enabled: true });
  });

  test("a kind-less block with NO Voyage key becomes the local table", async () => {
    await existing({ enabled: true }, false);
    expect(await install(piped().io, ["--force", "--embedder", "--budget", "9000"])).toBe(EXIT.ok);
    expect(read()["embedder"]).toEqual({ enabled: true, kind: "static" });
  });

  test("a configuration with no block at all gets the local table from --force --embedder (the doctor fix line)", async () => {
    await existing(undefined, false);
    expect(await install(piped().io, ["--force", "--embedder", "--budget", "9000"])).toBe(EXIT.ok);
    expect(read()["embedder"]).toEqual({ enabled: true, kind: "static" });
    // …and nothing else the file said was lost.
    expect(read()["identity"]).toEqual({ name: "Ada" });
  });

  test("a Voyage configuration and its key are left ALONE by a plain --force, and by a terminal re-run", async () => {
    await existing({ enabled: true, kind: "voyage" }, true);
    const before = readFileSync(configPath(), "utf8");
    expect(await install(piped().io, ["--force", "--budget", "9000"])).toBe(EXIT.ok);
    expect(read()["embedder"]).toEqual({ enabled: true, kind: "voyage" });
    expect(readFileSync(join(base(), "credentials.env"), "utf8")).toContain("VOYAGE_API_KEY=");
    // A terminal re-run keeps the file byte for byte (install rule 2).
    const now = readFileSync(configPath(), "utf8");
    const again = terminal([]);
    expect(await install(again.io)).toBe(EXIT.ok);
    expect(readFileSync(configPath(), "utf8")).toBe(now);
    expect(JSON.parse(before)["embedder"]).toEqual({ enabled: true, kind: "voyage" });
  });

  test("--no-embedder keeps the kind the file names, switched off", async () => {
    await existing({ enabled: true, kind: "voyage" }, true);
    expect(await install(piped().io, ["--force", "--no-embedder", "--budget", "9000"])).toBe(EXIT.ok);
    expect(read()["embedder"]).toEqual({ enabled: false, kind: "voyage" });
  });

  test("--embedder and --no-embedder together are refused before anything is written", async () => {
    const c = piped();
    expect(await install(c.io, ["--embedder", "--no-embedder", "--budget", "9000"])).toBe(EXIT.usage);
    expect(text(c.err)).toContain("--embedder and --no-embedder");
    expect(existsSync(base())).toBe(false);
  });
});

// ── the scripted arm names what it is walking past (review M4) ──────────────

describe("a parked memory and nobody to ask", () => {
  const arms: readonly { readonly what: string; readonly argv: readonly string[]; readonly tty: boolean }[] = [
    { what: "a pipe", argv: ["--budget", "9000"], tty: false },
    { what: "--yes", argv: ["--budget", "9000", "--yes"], tty: false },
    { what: "--no-connect at a terminal", argv: ["--budget", "9000", "--no-connect"], tty: true },
    { what: "--name, piped", argv: ["--budget", "9000", "--name", "Zed"], tty: false },
  ];

  for (const arm of arms) {
    test(`${arm.what}: the parked folder is NAMED, nothing is asked, nothing is moved`, async () => {
      const parked = await park();
      const before = fingerprint(parked);
      const c = arm.tty ? terminal([]) : piped();
      expect(await install(c.io, arm.argv)).toBe(EXIT.ok);

      const said = flat(c.out);
      // The folder, its size, and the two ways forward.
      expect(said).toContain("~/.counterparts.parked-2026-09-20");
      expect(said).toContain("is NOT being brought back");
      expect(said).toContain("SECOND, blank store");
      expect(said).toContain("counterparts install` at a terminal");
      // PRINTED, NEVER ASKED, AND NEVER MOVED: the exit code and the folder are
      // exactly what they were before this notice existed.
      expect(c.asked).toEqual([]);
      expect(fingerprint(parked)).toEqual(before);
      expect(existsSync(join(base(), "store"))).toBe(true);
    });
  }

  test("a refused candidate is named too, without a size it did not measure", async () => {
    const parked = join(home, ".counterparts.parked-2026-09-20");
    mkdirSync(join(parked, "store", "prose"), { recursive: true });
    writeFileSync(join(parked, "store", "operational.sqlite"), "not a database");
    const c = piped();
    expect(await install(c.io, ["--budget", "9000"])).toBe(EXIT.ok);
    const said = flat(c.out);
    expect(said).toContain("cannot be brought back");
    expect(said).toContain("run install at a terminal for the reason");
  });

  test("no parked folder, no paragraph — the scripted install is what it was", async () => {
    const c = piped();
    expect(await install(c.io, ["--budget", "9000"])).toBe(EXIT.ok);
    expect(text(c.out)).not.toContain("NOT being brought back");
    expect(text(c.out)).toContain("Two steps left");
  });
});

// ── the four shapes the reviewer measured by hand (review m6) ───────────────

describe("shapes that are not a parked memory", () => {
  test("a .parked-<date> entry that is a FILE is refused and nothing moves", async () => {
    const parked = join(home, ".counterparts.parked-2026-09-20");
    writeFileSync(parked, "not a directory");
    const c = terminal(["Mike"]);
    expect(await install(c.io)).toBe(EXIT.ok);
    expect(flat(c.out)).toContain("is not a directory, so it is not a parked memory");
    expect(lstatSync(parked).isFile()).toBe(true);
  });

  test("a DANGLING parked symlink is refused, and the link is left alone", async () => {
    const parked = join(home, ".counterparts.parked-2026-09-20");
    symlinkSync(join(home, "nowhere"), parked);
    const c = terminal(["Mike"]);
    expect(await install(c.io)).toBe(EXIT.ok);
    expect(flat(c.out)).toContain("SYMBOLIC LINK");
    expect(lstatSync(parked).isSymbolicLink()).toBe(true);
    expect(existsSync(base())).toBe(true); // the blank install went ahead
  });

  test("a parked symlink whose target is OUTSIDE the home is refused, target untouched", async () => {
    const outside = mkdtempSync(join(tmpdir(), "counterparts-outside-"));
    try {
      mkdirSync(join(outside, "store"), { recursive: true });
      const before = fingerprint(outside);
      symlinkSync(outside, join(home, ".counterparts.parked-2026-09-20"));
      const c = terminal(["Mike"]);
      expect(await install(c.io)).toBe(EXIT.ok);
      // The symlink clause fires FIRST, before the home test — either refusal
      // is correct, and what must hold is that the target is untouched.
      expect(flat(c.out)).toContain("cannot be brought back");
      expect(fingerprint(outside)).toEqual(before);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  /**
   * THE SCAR-§2.13 RE-CHECK, THROUGH THE ACTUAL SEAM. `bringParkedBack` is
   * tested directly above; this is the only shape that exercises the window the
   * guard exists for — the destination appearing while the person was at the
   * prompt.
   */
  test("a destination created BETWEEN the question and the answer is refused", async () => {
    const parked = await park();
    const before = fingerprint(parked);
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      tty: { stdin: true, stdout: true },
      prompt: (): Promise<string> => {
        // Somebody else installs while the question is on screen.
        mkdirSync(base(), { recursive: true });
        writeFileSync(join(base(), "claude-code.json"), "{}");
        return Promise.resolve("back");
      },
      promptHidden: (): Promise<string> => Promise.resolve(""),
    };
    expect(await install(io)).not.toBe(EXIT.ok);
    expect(flat(err)).toContain("exists again");
    expect(fingerprint(parked)).toEqual(before);
    // Nothing was nested inside the destination, which is what a plain `mv`
    // would have done (review M3 of the park arm, measured on macOS).
    expect(readdirSync(base())).toEqual(["claude-code.json"]);
  });
});

// ── names that are not names this package writes (review n1, n2) ────────────

describe("the date and the ordinal are real", () => {
  test("a day that is not on the calendar is not a candidate", () => {
    expect(parkedNameParts(".counterparts.parked-2099-13-45", ".counterparts")).toBeNull();
    expect(parkedNameParts(".counterparts.parked-2026-02-30", ".counterparts")).toBeNull();
    expect(parkedNameParts(".counterparts.parked-2026-09-20", ".counterparts")).not.toBeNull();
  });

  test("an impossible date cannot sort itself above a real one", async () => {
    const real = await park("2026-09-20");
    mkdirSync(join(home, ".counterparts.parked-2099-13-45", "store"), { recursive: true });
    const found = parkedSiblings(base(), home);
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe(real);
  });

  test("an ordinal below 2 is not a name `pairedSuffix` writes", () => {
    expect(parkedNameParts(".counterparts.parked-2026-09-20-0", ".counterparts")).toBeNull();
    expect(parkedNameParts(".counterparts.parked-2026-09-20-1", ".counterparts")).toBeNull();
    expect(parkedNameParts(".counterparts.parked-2026-09-20-2", ".counterparts")?.ordinal).toBe(2);
  });
});

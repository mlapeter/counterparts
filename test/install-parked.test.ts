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
 *      not any file in it. Proved rather than asserted: the whole tree's names,
 *      sizes and mtimes are recorded before the run and compared after, on
 *      every path that leaves it parked.
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

/** Every path under a tree with its size and mtime — the evidence that nothing
 *  opened it. A database that was opened read-only still moves its `-wal`. */
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

  test("`blank` moves nothing, says the folder is untouched, and starts a store", async () => {
    const parked = await park();
    const before = fingerprint(parked);
    const c = terminal(["blank", "Mike"]);
    expect(await install(c.io)).toBe(EXIT.ok);

    // THE PARKED TREE IS BYTE-FOR-BYTE WHAT IT WAS: same names, same sizes,
    // same mtimes. Nothing opened it, and nothing moved it.
    expect(fingerprint(parked)).toEqual(before);
    expect(text(c.out)).toContain("is untouched, exactly as it was");
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
    expect(text(c.out)).toContain("Please answer with one of the words in brackets.");
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

    const said = text(c.out);
    expect(said).toContain("SYMBOLIC LINK");
    expect(said).toContain("cannot be brought back");
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

    const said = text(c.out);
    expect(said).toContain("before the rows floor");
    expect(said).toContain("operational.sqlite");
    expect(said).toContain("floor/v5-last");
    expect(fingerprint(parked)).toEqual(before);
    // Nothing was offered, so nothing was asked about it.
    expect(text(c.asked)).not.toContain("Bring it back");
  });

  test("a folder with no store in it is refused: the memory was parked separately", async () => {
    const parked = join(home, ".counterparts.parked-2026-09-20");
    mkdirSync(parked, { recursive: true });
    writeFileSync(join(parked, "claude-code.json"), "{}");
    const c = terminal(["Mike"]);
    expect(await install(c.io)).toBe(EXIT.ok);
    expect(text(c.out)).toContain("holds no 'store' directory");
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

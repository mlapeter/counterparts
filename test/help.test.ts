/**
 * The console's two help pages, and the rule that keeps them honest.
 *
 * The finding (new-user findings #4, 2026-09-21): `counterparts --help` was 129
 * lines of dense paragraphs, and it is the SECOND thing a stranger types — the
 * "did that install work?" check. It is now about forty lines, grouped, one
 * short line per command, and the detail moved to `counterparts help <command>`.
 *
 * Two properties are worth a test, and they are the two that decay on their own:
 *
 *   1. **TOTALITY.** Every dispatched command has a short line AND a page. A
 *      command added to `COMMANDS` without help for it fails here rather than
 *      printing as a name nobody can look up — which is exactly how the old page
 *      drifted (`COMMAND_ARGS`, `FLAG_HELP` and the page had to be kept in step
 *      by hand).
 *   2. **NOTHING WAS LOST.** The short page is short because the detail MOVED,
 *      not because it was deleted. The phrase list below is lifted out of the
 *      old 129-line page, and each phrase must still print on the page of the
 *      command it was about.
 *
 * Opens no store, writes nothing, reads no configuration: the console's help is
 * a read of a table, and these tests say so by passing no `home` and an empty
 * environment.
 */
import { describe, expect, test } from "bun:test";

import {
  COMMANDS,
  COMMAND_DETAIL,
  EXIT,
  GROUPS,
  PENDING_COMMANDS,
  SHORT,
  SHORT_LIMIT,
  commandHelp,
  run,
  shortHelp,
  usage,
} from "../src/adapters/cli/index.js";
import type { Command, Io } from "../src/adapters/cli/index.js";

function consoleWith(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    },
    out,
    err,
  };
}

const text = (lines: readonly string[]): string => lines.join("\n");

/** Every command listed in a group, in the order the page prints them. */
const LISTED: readonly string[] = GROUPS.flatMap((g) => g.commands);

describe("the short page", () => {
  test("it is short, and it still says the words the install loop greps for", () => {
    const page = shortHelp();
    const lines = page.split("\n");
    // The loop (`tools/install-loop/run.sh`) decides whether the install
    // produced a working console at all by grepping this phrase, and
    // `test/cli.test.ts` asserts it for both `--help` and a bare invocation.
    expect(lines[0]).toContain("the owner's console");
    // A number with room in it, not a target: the point is that it CANNOT grow
    // back into a wall of text one command at a time. Today it is 39.
    expect(lines.length).toBeLessThanOrEqual(45);
    // `usage()` is the same page — the two names are one thing.
    expect(usage()).toBe(page);
  });

  test("every description is one short line", () => {
    for (const [name, said] of Object.entries(SHORT)) {
      expect(said.length, name).toBeLessThanOrEqual(SHORT_LIMIT);
      expect(said.includes("\n"), name).toBe(false);
      expect(said.trim(), name).toBe(said);
    }
  });

  test("every dispatched command has a short line, and appears on the page", () => {
    const page = shortHelp();
    for (const command of COMMANDS) {
      expect(SHORT[command], command).toBeString();
      expect(page, command).toContain(command);
      // `help` is printed in the footer rather than in a group — a list of
      // commands whose last entry is "the command that prints this list" reads
      // as a joke at the reader's expense.
      if (command !== "help") expect(LISTED, command).toContain(command);
    }
  });

  test("a name on the page that is not dispatched yet is one we have declared", () => {
    // `wire`, `unwire` and `uninstall` are built in parallel and listed here so
    // the map is the map of the console a person is about to have. The check
    // runs BOTH ways: a name that has since arrived must come off the list, or
    // "pending" stops meaning anything.
    for (const name of LISTED) {
      if ((COMMANDS as readonly string[]).includes(name)) continue;
      expect(PENDING_COMMANDS, name).toContain(name);
    }
    for (const name of PENDING_COMMANDS) {
      expect(LISTED, name).toContain(name);
      expect(
        (COMMANDS as readonly string[]).includes(name) ? `${name} has landed — take it off PENDING_COMMANDS` : name,
      ).toBe(name);
    }
  });

  test("no command is listed in two groups, and no group is empty", () => {
    expect(new Set(LISTED).size).toBe(LISTED.length);
    for (const group of GROUPS) expect(group.commands.length, group.title).toBeGreaterThan(0);
  });
});

describe("counterparts help", () => {
  test("with no argument it prints the short page and exits 0", async () => {
    const c = consoleWith();
    expect(await run(["help"], { io: c.io, env: {} })).toBe(EXIT.ok);
    expect(text(c.out)).toBe(shortHelp());
    expect(text(c.err)).toBe("");
  });

  test("with a command it prints that command's page — the same page as `<command> --help`", async () => {
    for (const command of COMMANDS) {
      const verb = consoleWith();
      expect(await run(["help", command], { io: verb.io, env: {} }), command).toBe(EXIT.ok);
      expect(text(verb.out), command).toBe(commandHelp(command));
      expect(text(verb.err), command).toBe("");

      const flag = consoleWith();
      expect(await run([command, "--help"], { io: flag.io, env: {} }), command).toBe(EXIT.ok);
      expect(text(flag.out), command).toBe(text(verb.out));
    }
  });

  test("a command name nobody has is one line and then the map", async () => {
    const c = consoleWith();
    expect(await run(["help", "recal"], { io: c.io, env: {} })).toBe(EXIT.usage);
    expect(text(c.err)).toBe("no such command: recal");
    expect(text(c.out)).toBe(shortHelp());
  });

  test("it opens nothing, so the explicit-dir guard has nothing to refuse", async () => {
    // A shell armed with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` — this repo's own
    // sessions are — must still be able to ask what the commands are.
    const c = consoleWith();
    expect(
      await run(["help", "doctor"], { io: c.io, env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" } }),
    ).toBe(EXIT.ok);
    expect(text(c.out)).toBe(commandHelp("doctor"));
  });

  test("a flag it does not take is refused like every other typo", async () => {
    const c = consoleWith();
    expect(await run(["help", "--dirr", "/nowhere"], { io: c.io, env: {} })).toBe(EXIT.refused);
    expect(text(c.err)).toContain("unknown flag --dirr");
  });

  test("its own page does not offer --dir in the synopsis: it opens no store", async () => {
    const page = commandHelp("help");
    expect(page.split("\n")[2]).toBe("  counterparts help [<command>]");
    // It is still a common flag, and the page still says so under "Everywhere".
    expect(page).toContain("Everywhere:");
    expect(page).toContain("--dir <value>");
  });
});

describe("nothing of the old page was lost", () => {
  /**
   * PHRASES OUT OF THE 129-LINE `usage()` THAT WAS REPLACED, each with the
   * command whose page must still carry it.
   *
   * Lifted verbatim where the wording survived and shortened to its load-bearing
   * clause where it was re-wrapped. This is the guard on the one risk of the
   * split: that "move the detail to the per-command page" quietly became "drop
   * the detail".
   */
  const MOVED: readonly (readonly [Command, string])[] = [
    ["install", "--dir moves the STORE only"],
    ["install", "moves the CONFIG"],
    ["install", "the credentials beside it and the default store beneath it"],
    ["init", "No host config, no credentials file, nothing under ~/.counterparts/"],
    ["init", "seeds the identity core"],
    ["start-fresh", "REFUSED on this command"],
    ["start-fresh", "--nothing-is-open"],
    ["start-fresh", "--undo"],
    ["note", "--salience"],
    ["recall", "--id"],
    ["export", "--include-confidential"],
    ["export", "--with-versions"],
    ["verify", "refuses while the cache holds embeddings"],
    ["verify", "--keep-vectors"],
    ["verify", "--prune-index"],
    ["verify", "--retry-skipped"],
    ["migrate-cache", "never resolved from COUNTERPARTS_DATA_DIR"],
    ["migrate-cache", "--batch"],
    ["repair-dates", "rewrites thousands of canonical documents"],
    ["repair-dates", "--confidence"],
    ["repair-dates", "--import-day"],
    ["credentials", "never touches your shell history"],
    ["credentials", "--from-env"],
    ["rebrief", "Never a config INSIDE the data dir"],
    ["rebrief", "where the hooks read"],
    ["rebrief", "advances no sleep marker"],
    ["probe-oq4", "recall CONTRACT §7"],
    ["fired", "SILENT FIRST"],
    ["self-page", "reaches the wake at the next boundary"],
    ["self-page", "--versions"],
    ["scope", "scopes.json"],
    ["scope", "which entry decided"],
    ["doctor", "worst first"],
    // The two console-wide sentences the old page's footer carried. They are on
    // EVERY command's page now, because whether this command runs under observer
    // is a question a reader has while looking at exactly that page.
    ["status", "Owner operations never run under observer"],
    ["status", "owner-in-the-loop is a short, named list"],
    ["doctor", "counterparts-hook and counterparts-mcp take the same flag"],
  ];

  test("every sentence the old page carried still prints on a page a reader can ask for", () => {
    // WHITESPACE-NORMALIZED on both sides. The detail below is pre-wrapped, so
    // a sentence sits across a line break — and this test is about whether the
    // words are still there, not about where the page happens to fold them.
    const flat = (s: string): string => s.replace(/\s+/g, " ");
    for (const [command, phrase] of MOVED) {
      expect(flat(commandHelp(command)), `${command}: ${phrase}`).toContain(flat(phrase));
    }
  });

  test("the detail table names commands, and nothing else", () => {
    const known = [...COMMANDS, ...PENDING_COMMANDS];
    for (const name of Object.keys(COMMAND_DETAIL)) expect(known, name).toContain(name);
  });

  test("a detail entry is pre-wrapped, because it is printed verbatim", () => {
    for (const [name, lines] of Object.entries(COMMAND_DETAIL)) {
      for (const line of lines) {
        expect(line.includes("\n"), name).toBe(false);
        expect(line.length, `${name}: ${line}`).toBeLessThanOrEqual(78);
      }
    }
  });
});

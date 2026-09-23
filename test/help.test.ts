/**
 * The console's two help pages, and the rule that keeps them honest.
 *
 * The finding (new-user findings #4, 2026-09-21): `counterparts --help` was 129
 * lines of dense paragraphs, and it is the SECOND thing a stranger types — the
 * "did that install work?" check. It is now twenty-six lines, grouped, one
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
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ADVANCED,
  COMMANDS,
  COMMAND_DETAIL,
  EXIT,
  GLOBAL_FLAGS,
  GROUPS,
  PENDING_COMMANDS,
  SHORT,
  SHORT_LIMIT,
  UNLISTED,
  advancedHelp,
  commandHelp,
  linesOf,
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

/** Every command listed in a group on the SHORT page, in printed order. */
const LISTED: readonly string[] = GROUPS.flatMap((g) => g.commands);

/** The short page, the advanced page, and the declared omissions — the three
 *  places a dispatched command may be accounted for, and no fourth. */
const ACCOUNTED: readonly string[] = [...LISTED, ...ADVANCED, ...Object.keys(UNLISTED)];

describe("the short page", () => {
  test("it is short, and it says what this thing IS", () => {
    const page = shortHelp();
    const lines = page.split("\n");
    // It said "counterparts — the owner's console for a Counterparts memory
    // store" until 2026-09-22: a sentence about whose console this is, to a
    // reader who does not yet know what the thing is. `tools/install-loop/run.sh`
    // greps `counterparts --version` for its "did the install work" check now,
    // which is the question it was actually asking.
    expect(lines[0]).toBe("counterparts — a memory layer for AI");
    expect(page).not.toContain("the owner's console");
    // EXACTLY 26 (2026-09-23). It used to be a ceiling of 32 with room in it;
    // the page is now the owner's own, line for line (next test), so its length
    // is a fact rather than a budget, and a change to it is a change to his
    // screen. The "Advanced group collapses to a comma list, 39 → ~31 lines"
    // item on the 0.2.0 trial's list was written 2026-09-21, against the page
    // before the 09-22 split moved the whole Advanced group to `help advanced`;
    // this page has had no Advanced group since, and is shorter than the target.
    expect(lines).toHaveLength(26);
    expect(page).not.toContain("\nAdvanced\n");
    // `usage()` is the same page — the two names are one thing.
    expect(usage()).toBe(page);
    // Both ways further in are on it.
    expect(page).toContain("counterparts help <command>");
    expect(page).toContain("counterparts help advanced");
  });

  test("it is the page the owner drew, byte for byte", () => {
    // `docs/new-user-findings.md` §"The screens" is the acceptance criterion the
    // 2026-09-22 round was built to ("the five rendered screens below are the
    // acceptance criteria"), and the help page is the first of them. A change
    // to this page is a change to that screen: make it there too, on his word.
    const doc = readFileSync(join(import.meta.dir, "..", "docs", "new-user-findings.md"), "utf8");
    const at = doc.indexOf("**Help page**");
    expect(at).toBeGreaterThan(0);
    const start = doc.indexOf("```\n", at) + 4;
    const end = doc.indexOf("\n```", start);
    expect(shortHelp()).toBe(doc.slice(start, end));
  });

  test("every description is one short line — or the two the owner wrote", () => {
    for (const name of Object.keys(SHORT)) {
      const said = linesOf(name);
      expect(said.length, name).toBeGreaterThan(0);
      for (const line of said) {
        expect(line.length, `${name}: ${line}`).toBeLessThanOrEqual(SHORT_LIMIT);
        expect(line.includes("\n"), name).toBe(false);
        expect(line.trim(), name).toBe(line);
      }
    }
  });

  test("every dispatched command has a short line and is accounted for on exactly one page", () => {
    const advancedPage = advancedHelp();
    const page = shortHelp();
    for (const command of COMMANDS) {
      expect(SHORT[command], command).toBeDefined();
      // ONE of the three places, and the reader can find it there.
      expect(ACCOUNTED, command).toContain(command);
      if (LISTED.includes(command)) expect(page, command).toContain(command);
      else if (ADVANCED.includes(command)) expect(advancedPage, command).toContain(command);
      // …otherwise it is declared unlisted, WITH A REASON. `help` is in the
      // footer of both pages, `recall` is the older spelling of `ask`, and
      // `version` is what `counterparts --version` reaches.
      else expect(UNLISTED[command]?.length ?? 0, command).toBeGreaterThan(10);
    }
  });

  test("a name on either page that is not dispatched yet is one we have declared", () => {
    // `wire`, `unwire` and `uninstall` were built in parallel and listed here so
    // the map was the map of the console a person was about to have. The check
    // runs BOTH ways: a name that has since arrived must come off the list, or
    // "pending" stops meaning anything.
    for (const name of [...LISTED, ...ADVANCED]) {
      if ((COMMANDS as readonly string[]).includes(name)) continue;
      expect(PENDING_COMMANDS, name).toContain(name);
    }
    for (const name of PENDING_COMMANDS) {
      expect([...LISTED, ...ADVANCED], name).toContain(name);
      expect(
        (COMMANDS as readonly string[]).includes(name) ? `${name} has landed — take it off PENDING_COMMANDS` : name,
      ).toBe(name);
    }
  });

  test("nothing is listed twice, no group is empty, and every omission names a real command", () => {
    expect(new Set(ACCOUNTED).size).toBe(ACCOUNTED.length);
    for (const group of GROUPS) expect(group.commands.length, group.title).toBeGreaterThan(0);
    expect(ADVANCED.length).toBeGreaterThan(0);
    // An omission for a command that does not exist is a stale excuse.
    for (const name of Object.keys(UNLISTED)) {
      expect([...COMMANDS, ...PENDING_COMMANDS], name).toContain(name);
    }
  });
});

describe("counterparts help advanced", () => {
  test("it prints the shelf and the three flags, and exits 0", async () => {
    const c = consoleWith();
    expect(await run(["help", "advanced"], { io: c.io, env: {} })).toBe(EXIT.ok);
    const page = text(c.out);
    expect(page).toBe(advancedHelp());
    for (const name of ADVANCED) expect(page, name).toContain(name);
    for (const { flag } of GLOBAL_FLAGS) expect(page, flag).toContain(flag);
    expect(GLOBAL_FLAGS.map((f) => f.flag.split(" ")[0])).toEqual([
      "--dir",
      "--config",
      "--observer",
    ]);
  });

  test("it opens nothing either, guard armed or not", async () => {
    const c = consoleWith();
    expect(
      await run(["help", "advanced"], {
        io: c.io,
        env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      }),
    ).toBe(EXIT.ok);
    expect(text(c.out)).toBe(advancedHelp());
  });

  test("`advanced` is not a command, so `counterparts advanced` is still unknown", async () => {
    const c = consoleWith();
    expect(await run(["advanced"], { io: c.io, env: {} })).toBe(EXIT.usage);
    expect(text(c.err)).toContain("unknown command: advanced");
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
    expect(page.split("\n")[2]).toBe("  counterparts help [advanced | <command>]");
    // It is still a common flag, and the page still says so under the common-flags label.
    expect(page).toContain("Options every command takes:");
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

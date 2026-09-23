/**
 * The commands `README.md` and `docs/QUICKSTART.md` show a reader are real: every
 * `counterparts <command> ...` line inside a code block names a command the CLI
 * has, with only flags that command accepts. `tools/install-loop/run.sh` runs a
 * handful of those lines; this catches the rest — a renamed command or a dropped
 * flag that leaves a line in the docs nobody can run.
 *
 * Read-only on two repo files. Opens no store.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMANDS, COMMAND_FLAGS, COMMON_FLAGS } from "../src/adapters/cli/commands.js";

const ROOT = join(import.meta.dir, "..");
const DOCS = ["README.md", "docs/QUICKSTART.md"];

/** Every `counterparts ...` line inside a fenced block, comment stripped. */
function shownCommands(text: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (inFence && /^counterparts( |$)/.test(line)) lines.push(line);
  }
  return lines;
}

describe("the commands the docs show are real", () => {
  for (const doc of DOCS) {
    const shown = shownCommands(readFileSync(join(ROOT, doc), "utf8"));

    test(`${doc} shows at least one command`, () => {
      expect(shown.length).toBeGreaterThan(0);
    });

    for (const line of shown) {
      test(`${doc}: ${line}`, () => {
        const words = line.split(/\s+/).slice(1);
        const command = words.find((w) => !w.startsWith("-"));
        const flags = words.filter((w) => w.startsWith("--")).map((w) => w.slice(2));
        // The bare command, and `--help` / `--version`, are the top level.
        if (command === undefined) {
          for (const f of flags) expect(["help", "version"]).toContain(f);
          return;
        }
        expect(COMMANDS as readonly string[]).toContain(command);
        const accepted = [...COMMON_FLAGS, ...(COMMAND_FLAGS as Record<string, readonly string[]>)[command]!];
        for (const f of flags) expect(accepted).toContain(f);
      });
    }
  }
});

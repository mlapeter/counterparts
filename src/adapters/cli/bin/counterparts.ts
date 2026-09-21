#!/usr/bin/env bun
/**
 * The `counterparts` executable.
 *
 * Thin by design: it binds stdout, stderr and a real interactive prompt to
 * `run()`, and turns the returned exit code into a process exit. Every decision
 * lives in `commands.ts`, where it can be tested against a temp dir with a faked
 * console instead of a subprocess.
 *
 * The prompt is `node:readline` — no dependency, and it exists at all because
 * removal requires an interactive confirmation (§5 G2). A non-interactive run
 * (a pipe, a CI job) has no prompt, and removal REFUSES there rather than
 * proceeding unconfirmed.
 *
 * Since 2026-09-21 it binds two more things, both from `ui.ts` and both
 * additive: the NO-ECHO read (`promptHidden`), so `credentials set` can take a
 * key from the person standing at the terminal without putting it in a
 * scrollback buffer, and what the host knows about its TERMINAL (`tty`), which
 * is the only input `ui.ts` decides colour, wrapping and interactivity from.
 * Neither changes a non-interactive run: a pipe reports no terminal, and every
 * gate in `ui.ts` is false when it does.
 */
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "../commands.js";
import { hiddenPrompt } from "../ui.js";

/** Everything piped in, as one string. Never logged, never echoed: the one
 *  caller is `credentials set`, and what comes through here is a secret. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAnswer) => {
    rl.question(question, (answer) => {
      rl.close();
      resolveAnswer(answer);
    });
  });
}

async function main(): Promise<number> {
  return run(process.argv.slice(2), {
    io: {
      out: (line) => {
        process.stdout.write(`${line}\n`);
      },
      err: (line) => {
        process.stderr.write(`${line}\n`);
      },
      // Interactive only. `process.stdin.isTTY` is the host telling us whether
      // a human is there; absent, the prompt is not offered at all.
      ...(process.stdin.isTTY ? { prompt: ask } : {}),
      // THE NO-ECHO READ, bound to the real streams (2026-09-21, finding #2).
      // `ui.ts` shipped `hiddenPrompt` unwired; `credentials set` is the first
      // command that needs it, and the install prompts are the second. Bound
      // UNCONDITIONALLY, unlike `prompt`: `askHidden` is reached only from an
      // arm that has already established there is a terminal, and a
      // `promptHidden` that existed only on a terminal would make the seam's
      // own refusal (`no-hidden-input`) unreachable where it matters.
      promptHidden: hiddenPrompt(process.stdin, process.stdout),
      // WHAT THIS HOST KNOWS ABOUT ITS TERMINAL — the one input `ui.ts` decides
      // colour, wrapping and "is anyone there" from. A pipe reports neither
      // stream as a terminal, so `isInteractive` is false, nothing wraps,
      // nothing colours and nothing asks: every scripted caller, the install
      // loop included, keeps exactly the bytes it had.
      tty: {
        stdin: process.stdin.isTTY === true,
        stdout: process.stdout.isTTY === true,
        ...(typeof process.stdout.columns === "number"
          ? { columns: process.stdout.columns }
          : {}),
      },
    },
    // STANDARD INPUT, for the one command that takes its argument that way
    // (`credentials set`, whose value must never be argv). Read lazily: nothing
    // touches stdin unless a command asks for it, so every other command
    // behaves exactly as it did.
    stdin: { isTty: process.stdin.isTTY === true, read: readStdin },
  });
}

/** True only when this file is the process entry point. */
export function isEntryPoint(argv1: string | undefined, url: string): boolean {
  if (argv1 === undefined) return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  void main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${String((err as Error).message ?? err)}\n`);
      process.exit(3);
    },
  );
}

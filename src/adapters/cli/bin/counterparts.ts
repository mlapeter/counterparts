#!/usr/bin/env bun
/**
 * The `counterparts` executable.
 *
 * Thin by design: it binds stdout, stderr and a real interactive prompt to
 * `run()`, and turns the returned exit code into a process exit. Every decision
 * lives in `commands.ts`, where it can be tested against a temp dir with a faked
 * console instead of a subprocess.
 *
 * The prompt exists at all because removal requires an interactive confirmation
 * (§5 G2). A non-interactive run (a pipe, a CI job) has no prompt, and removal
 * REFUSES there rather than proceeding unconfirmed.
 *
 * Since 2026-09-21 it binds two more things, both from `ui.ts` and both
 * additive: the NO-ECHO read (`promptHidden`), for a value that must not land in
 * a scrollback buffer (its first caller, `credentials set`, was removed with the
 * API keys on 2026-09-24), and what the host knows about its TERMINAL (`tty`), which
 * is the only input `ui.ts` decides colour, wrapping and interactivity from.
 * Neither changes a non-interactive run: a pipe reports no terminal, and every
 * gate in `ui.ts` is false when it does.
 *
 * **2026-09-22: `node:readline` is gone from this file.** The ordinary line
 * prompt is now `ui.ts#echoPrompt` — the same raw-mode reader the hidden one is
 * built from, echoing. `readline` hands back a line and nothing else, so it
 * cannot tell Escape from an arrow key, and Esc is the way out of every prompt
 * in the package now (owner, 2026-09-22, item 8). Everything `readline` was
 * doing for us the reader does, review m4's two endings included: a Ctrl-C and
 * a stdin that closes under the question both reject with `PromptAborted`
 * rather than resolving as an answer nobody gave.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "../commands.js";
import { echoPrompt, hiddenPrompt } from "../ui.js";

/** Everything piped in, as one string. Never logged, never echoed
 *  (`self-page --write --stdin` reads the page through it). */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * One line of text, and **Ctrl-C is not an answer** (review m4).
 *
 * The first version of this — `readline` — closed on SIGINT and on EOF and
 * simply never resolved: the process ended silently with **exit 0**. At the
 * name prompt nothing had been created yet; at the wire question the store, the
 * config and the 0600 credentials file all existed and nothing said so — and a
 * `&&` chain or a wrapper script reads exit 0 as "installed". `echoPrompt`
 * rejects on both endings with the `PromptAborted` the hidden reader already
 * throws, so every caller's existing handling — "stopped; nothing else was
 * changed", a non-zero code — covers them with no new branching.
 */
const ask = echoPrompt(process.stdin, process.stdout);

async function main(): Promise<number> {
  return run(process.argv.slice(2), {
    io: {
      out: (line) => {
        process.stdout.write(`${line}\n`);
      },
      err: (line) => {
        process.stderr.write(`${line}\n`);
      },
      // Interactive only, and now doubly so: `process.stdin.isTTY` is the host
      // telling us whether a human is there, and `ask` is a RAW-MODE reader
      // that has nothing to offer anything else. Absent a terminal the prompt
      // is not offered at all, `ui.ts`'s gates are false, and every scripted
      // caller keeps the bytes it had.
      ...(process.stdin.isTTY ? { prompt: ask } : {}),
      // THE NO-ECHO READ, bound to the real streams (2026-09-21, finding #2).
      // `ui.ts` shipped `hiddenPrompt` unwired; `credentials set` was the first
      // command that needed it (removed 2026-09-24). Bound
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
    // STANDARD INPUT, for a command that takes its argument that way
    // (`self-page --write --stdin`). Read lazily: nothing
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

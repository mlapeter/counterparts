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
 */
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "../commands.js";

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
    },
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

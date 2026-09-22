/**
 * `adapters/cli/ui.ts` — the console's shared primitives.
 *
 * Nothing here opens a store, so nothing here needs a temp dir: the whole module
 * is pure but for the `Io` it is handed, and every test drives it through a
 * console that collects its lines. The environment is ALWAYS passed explicitly —
 * a test that read `process.env` would pass or fail with the developer's
 * `NO_COLOR` and `CI`.
 *
 * The four things these tests exist to hold:
 *
 *   1. **A non-terminal console behaves exactly as it does today.** No colour,
 *      no wrapping, one logical line per item, and nothing asked — so every
 *      existing test, every pipe and `tools/install-loop/run.sh` keep their
 *      greps.
 *   2. **`NO_COLOR` wins over everything**, and `FORCE_COLOR` turns colour on
 *      WITHOUT turning wrapping on.
 *   3. **A hidden value reaches no output.** Not `io.out`, not `io.err`, not the
 *      terminal the raw reader writes to.
 *   4. **`statusLine`'s plain arm is byte-identical to `doctor.ts/reportLines`**
 *      — the two renderings of one doctor line cannot drift apart silently.
 */
import { describe, expect, test } from "bun:test";

import type { Io } from "../src/adapters/cli/commands.js";
import {
  FALLBACK_WIDTH,
  PLAIN,
  PROMPT_CANCEL,
  PromptAborted,
  ask,
  askHidden,
  confirm,
  echoPrompt,
  fold,
  hiddenPrompt,
  isCancel,
  isInteractive,
  isPromptAborted,
  paint,
  terminalWidth,
  typed,
  ui,
  useColor,
  wraps,
} from "../src/adapters/cli/ui.js";
import type { Grade, RawInput } from "../src/adapters/cli/ui.js";
import { reportLines } from "../src/adapters/claude-code/doctor.js";
import type { Finding } from "../src/adapters/claude-code/doctor.js";

const ESC = String.fromCharCode(27);

interface Tty {
  readonly stdin: boolean;
  readonly stdout: boolean;
  readonly columns?: number;
}

interface Fake {
  io: Io;
  out: string[];
  err: string[];
  asked: string[];
  askedHidden: string[];
}

/**
 * A console. `answers === null` means NO PROMPT AT ALL — the non-interactive
 * console, exactly as `test/start-fresh.test.ts` builds it.
 */
function fake(
  opts: {
    answers?: readonly string[] | null;
    hidden?: readonly string[] | null;
    tty?: Tty;
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
          prompt: async (question: string): Promise<string> => {
            asked.push(question);
            return queue.shift() ?? "";
          },
        }),
    ...(opts.hidden === undefined || opts.hidden === null
      ? {}
      : {
          promptHidden: async (question: string): Promise<string> => {
            askedHidden.push(question);
            return hiddenQueue.shift() ?? "";
          },
        }),
    ...(opts.tty === undefined ? {} : { tty: opts.tty }),
  };
  return { io, out, err, asked, askedHidden };
}

/** A terminal console: both ends a tty, a prompt, and a hidden reader. */
function terminal(
  opts: { answers?: readonly string[]; hidden?: readonly string[]; columns?: number } = {},
): Fake {
  return fake({
    answers: opts.answers ?? [],
    hidden: opts.hidden ?? [],
    tty: { stdin: true, stdout: true, ...(opts.columns === undefined ? {} : { columns: opts.columns }) },
  });
}

const NO_ENV: Record<string, string | undefined> = {};

// ── isInteractive ───────────────────────────────────────────────────────────

describe("isInteractive", () => {
  test("a terminal at both ends with a prompt and no CI is interactive", () => {
    expect(isInteractive(terminal().io, NO_ENV)).toBe(true);
  });

  test("every existing test console is NOT interactive — no tty was ever declared", () => {
    expect(isInteractive(fake({ answers: ["yes"] }).io, NO_ENV)).toBe(false);
    expect(isInteractive(fake({ answers: null }).io, NO_ENV)).toBe(false);
  });

  test("stdout alone is not enough, and neither is stdin alone", () => {
    expect(isInteractive(fake({ answers: [], tty: { stdin: true, stdout: false } }).io, NO_ENV)).toBe(false);
    expect(isInteractive(fake({ answers: [], tty: { stdin: false, stdout: true } }).io, NO_ENV)).toBe(false);
  });

  test("a terminal with no way to ask is not interactive", () => {
    expect(isInteractive(fake({ answers: null, tty: { stdin: true, stdout: true } }).io, NO_ENV)).toBe(false);
  });

  test("CI set to anything non-empty turns it off; empty reads as unset", () => {
    expect(isInteractive(terminal().io, { CI: "true" })).toBe(false);
    expect(isInteractive(terminal().io, { CI: "1" })).toBe(false);
    expect(isInteractive(terminal().io, { CI: "" })).toBe(true);
    expect(isInteractive(terminal().io, { CI: undefined })).toBe(true);
  });

  test("the caller's own flag outranks the terminal", () => {
    expect(isInteractive(terminal().io, NO_ENV, { nonInteractive: true })).toBe(false);
    expect(isInteractive(terminal().io, NO_ENV, { nonInteractive: false })).toBe(true);
  });
});

// ── useColor ────────────────────────────────────────────────────────────────

describe("useColor", () => {
  test("a terminal colours, a pipe does not", () => {
    expect(useColor(terminal().io, NO_ENV)).toBe(true);
    expect(useColor(fake().io, NO_ENV)).toBe(false);
  });

  test("NO_COLOR wins over the terminal and over FORCE_COLOR, whatever its value", () => {
    expect(useColor(terminal().io, { NO_COLOR: "1" })).toBe(false);
    // The VALUE is never interpreted: `0` disables too.
    expect(useColor(terminal().io, { NO_COLOR: "0" })).toBe(false);
    expect(useColor(terminal().io, { NO_COLOR: "anything" })).toBe(false);
    expect(useColor(terminal().io, { NO_COLOR: "1", FORCE_COLOR: "1" })).toBe(false);
  });

  test("NO_COLOR empty reads as unset — one definition with dashboard/ansi.ts", () => {
    expect(useColor(terminal().io, { NO_COLOR: "" })).toBe(true);
  });

  test("FORCE_COLOR turns colour on for a pipe, and 0 does not", () => {
    expect(useColor(fake().io, { FORCE_COLOR: "1" })).toBe(true);
    expect(useColor(fake().io, { FORCE_COLOR: "0" })).toBe(false);
    expect(useColor(fake().io, { FORCE_COLOR: "" })).toBe(false);
  });

  test("TERM=dumb is a terminal that does not want escapes", () => {
    expect(useColor(terminal().io, { TERM: "dumb" })).toBe(false);
    expect(useColor(terminal().io, { TERM: "xterm-256color" })).toBe(true);
  });

  test("colour off returns the plain string from every helper", () => {
    const p = paint(fake().io, NO_ENV);
    expect(p.enabled).toBe(false);
    for (const f of [p.green, p.yellow, p.red, p.dim, p.bold, p.cyan]) expect(f("x")).toBe("x");
    expect(p).toBe(PLAIN);
  });

  test("colour on wraps and resets, and leaves an empty string alone", () => {
    const p = paint(terminal().io, NO_ENV);
    expect(p.enabled).toBe(true);
    expect(p.green("ok")).toBe(`${ESC}[32mok${ESC}[0m`);
    expect(p.red("x")).toBe(`${ESC}[31mx${ESC}[0m`);
    expect(p.yellow("x")).toBe(`${ESC}[33mx${ESC}[0m`);
    expect(p.dim("x")).toBe(`${ESC}[2mx${ESC}[0m`);
    expect(p.bold("x")).toBe(`${ESC}[1mx${ESC}[0m`);
    expect(p.cyan("x")).toBe(`${ESC}[36mx${ESC}[0m`);
    expect(p.green("")).toBe("");
  });
});

// ── width and folding ───────────────────────────────────────────────────────

describe("width and folding", () => {
  test("no terminal, no width report, or a silly one: the fallback", () => {
    expect(terminalWidth(fake().io)).toBe(FALLBACK_WIDTH);
    expect(terminalWidth(terminal().io)).toBe(FALLBACK_WIDTH);
    expect(terminalWidth(terminal({ columns: 120 }).io)).toBe(120);
    // A 4-column terminal folds every word onto its own line; a floor is kinder.
    expect(terminalWidth(terminal({ columns: 4 }).io)).toBe(30);
  });

  test("zero columns means UNKNOWN, and takes the fallback rather than the floor", () => {
    // A fresh pty starts 0x0 and a terminal mid-resize can say the same. Read
    // as a width it lays the whole console out at 30; read as "I do not know"
    // it lays out at 80, which is what it is (measured on a pty, 2026-09-21).
    expect(terminalWidth(terminal({ columns: 0 }).io)).toBe(FALLBACK_WIDTH);
    expect(terminalWidth(terminal({ columns: -1 }).io)).toBe(FALLBACK_WIDTH);
    expect(terminalWidth(terminal({ columns: -200 }).io)).toBe(FALLBACK_WIDTH);
    expect(terminalWidth(terminal({ columns: 0.5 }).io)).toBe(FALLBACK_WIDTH);
    expect(terminalWidth(terminal({ columns: Number.NaN }).io)).toBe(FALLBACK_WIDTH);
    expect(terminalWidth(terminal({ columns: Number.POSITIVE_INFINITY }).io)).toBe(FALLBACK_WIDTH);
    // And the floor is untouched for a width a terminal really reported.
    expect(terminalWidth(terminal({ columns: 1 }).io)).toBe(30);
  });

  test("wrapping keys off stdout being a terminal, not off colour", () => {
    expect(wraps(fake().io)).toBe(false);
    expect(wraps(terminal().io)).toBe(true);
  });

  test("a hanging indent, and the prefix only on the first line", () => {
    const lines = fold("ok    ", "one two three four five six seven eight", 24, 6);
    expect(lines[0]).toBe("ok    one two three four");
    expect(lines[1]).toBe("      five six seven");
    expect(lines[2]).toBe("      eight");
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(24);
  });

  test("a token longer than the room goes out whole rather than broken", () => {
    const long = "/Users/somebody/.counterparts/snapshots/2026-09-21T00-00-00Z/store.sqlite3";
    const lines = fold("", `see ${long} now`, 30, 4);
    expect(lines).toContain(`    ${long}`);
    expect(lines.join(" ")).toContain(long);
  });

  test("nothing to fold is one line, never an empty array", () => {
    expect(fold("", "", 80, 0)).toEqual([""]);
    expect(fold("fix: ", "   ", 80, 0)).toEqual(["fix:"]);
  });
});

// ── ask ─────────────────────────────────────────────────────────────────────

describe("ask", () => {
  test("the question is used verbatim, with one space after it", async () => {
    const c = fake({ answers: ["Mike"] });
    expect(await ask(c.io, "What should memory call you?")).toBe("Mike");
    expect(c.asked[0]).toBe("What should memory call you? ");
  });

  test("a default is shown and taken on Enter", async () => {
    const c = fake({ answers: [""] });
    expect(await ask(c.io, "Name?", { default: "Mike" })).toBe("Mike");
    expect(c.asked[0]).toBe("Name? [Mike] ");
  });

  test("an answer beats the default", async () => {
    const c = fake({ answers: ["Robin"] });
    expect(await ask(c.io, "Name?", { default: "Mike" })).toBe("Robin");
  });

  test("no console to ask: the default, and nothing printed", async () => {
    const c = fake({ answers: null });
    expect(await ask(c.io, "Name?", { default: "Mike" })).toBe("Mike");
    expect(await ask(c.io, "Name?")).toBe("");
    expect(c.out).toEqual([]);
    expect(c.err).toEqual([]);
  });

  test("Esc ABORTS the command rather than taking the default", async () => {
    // A default is what somebody who pressed Enter meant. Somebody who pressed
    // Esc meant to leave, and this one's callers are mid-install.
    const c = fake({ answers: [PROMPT_CANCEL] });
    let caught: unknown = null;
    try {
      await ask(c.io, "Name?", { default: "Mike" });
    } catch (e) {
      caught = e;
    }
    expect(isPromptAborted(caught)).toBe(true);
    expect((caught as PromptAborted).reason).toBe("cancelled");
  });
});

// ── confirm ─────────────────────────────────────────────────────────────────

describe("confirm", () => {
  test("the default is the capital letter", async () => {
    const yes = fake({ answers: [""] });
    await confirm(yes.io, "Wire Claude Code now?", { default: true });
    expect(yes.asked[0]).toBe("Wire Claude Code now? [Y/n] ");
    const no = fake({ answers: [""] });
    await confirm(no.io, "Delete it?", { default: false });
    expect(no.asked[0]).toBe("Delete it? [y/N] ");
  });

  test("Enter takes the default, either way", async () => {
    expect(await confirm(fake({ answers: [""] }).io, "q", { default: true })).toBe(true);
    expect(await confirm(fake({ answers: [""] }).io, "q", { default: false })).toBe(false);
  });

  test("y / yes / n / no, in any case, with surrounding space", async () => {
    for (const word of ["y", "Y", "yes", "YES", "Yes", " y ", "yes\n"]) {
      expect(await confirm(fake({ answers: [word] }).io, "q", { default: false })).toBe(true);
    }
    for (const word of ["n", "N", "no", "NO", "No", " n "]) {
      expect(await confirm(fake({ answers: [word] }).io, "q", { default: true })).toBe(false);
    }
  });

  test("garbage is re-asked ONCE, then the default is taken", async () => {
    const c = fake({ answers: ["maybe", "sure"] });
    expect(await confirm(c.io, "q", { default: true })).toBe(true);
    expect(c.asked.length).toBe(2);
    expect(c.out).toEqual(["Please answer y or n."]);
  });

  test("the re-ask is a real second chance", async () => {
    const c = fake({ answers: ["maybe", "n"] });
    expect(await confirm(c.io, "q", { default: true })).toBe(false);
    expect(c.asked.length).toBe(2);
  });

  test("no console to ask is FALSE, never the default", async () => {
    const c = fake({ answers: null });
    expect(await confirm(c.io, "Wire Claude Code now?", { default: true })).toBe(false);
    expect(c.out).toEqual([]);
  });

  test("Esc is NO whatever the default is, and is not a garbage answer", async () => {
    const c = fake({ answers: [PROMPT_CANCEL] });
    expect(await confirm(c.io, "Go ahead?", { default: true })).toBe(false);
    // Asked ONCE: a person reaching for the way out has answered the question.
    expect(c.asked.length).toBe(1);
    expect(c.out).toEqual([]);
    expect(await confirm(fake({ answers: [PROMPT_CANCEL] }).io, "q", { default: false })).toBe(false);
  });

  test("the hint is printed after the tag, and only when the caller asks for one", async () => {
    const c = fake({ answers: [""] });
    await confirm(c.io, "Claude Code will be disconnected. Go ahead?", {
      default: true,
      hint: "(Esc or n to stop)",
    });
    expect(c.asked[0]).toBe(
      "Claude Code will be disconnected. Go ahead? [Y/n]   (Esc or n to stop) ",
    );
    // The install screen's key prompts carry a bare tag, so this is opt-in.
    const bare = fake({ answers: [""] });
    await confirm(bare.io, "Add an Anthropic key?", { default: false });
    expect(bare.asked[0]).toBe("Add an Anthropic key? [y/N] ");
  });
});

// ── typed ───────────────────────────────────────────────────────────────────

describe("typed", () => {
  const phrase = "DELETE MEMORIES";

  test("the exact phrase, and only the exact phrase", async () => {
    expect(await typed(fake({ answers: [phrase] }).io, phrase, "Type it: ")).toBe("typed");
    expect(await typed(fake({ answers: [`${phrase}\n`] }).io, phrase, "Type it: ")).toBe("typed");
    expect(await typed(fake({ answers: [`${phrase}\r\n`] }).io, phrase, "Type it: ")).toBe("typed");
  });

  test("case matters, and so does a stray space", async () => {
    expect(await typed(fake({ answers: ["delete memories"] }).io, phrase, "p")).toBe("mismatch");
    expect(await typed(fake({ answers: [`${phrase} `] }).io, phrase, "p")).toBe("mismatch");
    expect(await typed(fake({ answers: [` ${phrase}`] }).io, phrase, "p")).toBe("mismatch");
    expect(await typed(fake({ answers: ["yes"] }).io, phrase, "p")).toBe("mismatch");
  });

  test("THREE ways out, and all of them are cancelled rather than wrong", async () => {
    // Finding #21: a prompt this loud with no visible way out is one people
    // answer by closing the terminal. An empty Enter used to read as a
    // mismatch, which told somebody who had decided against it that they had
    // typed the phrase wrong.
    expect(await typed(fake({ answers: [""] }).io, phrase, "p")).toBe("cancelled");
    expect(await typed(fake({ answers: ["\n"] }).io, phrase, "p")).toBe("cancelled");
    expect(await typed(fake({ answers: ["   "] }).io, phrase, "p")).toBe("cancelled");
    expect(await typed(fake({ answers: ["cancel"] }).io, phrase, "p")).toBe("cancelled");
    expect(await typed(fake({ answers: ["CANCEL"] }).io, phrase, "p")).toBe("cancelled");
    expect(await typed(fake({ answers: [" Cancel \n"] }).io, phrase, "p")).toBe("cancelled");
    expect(await typed(fake({ answers: [PROMPT_CANCEL] }).io, phrase, "p")).toBe("cancelled");
  });

  test("the prompt is passed through untouched", async () => {
    const c = fake({ answers: [phrase] });
    await typed(c.io, phrase, `Type ${phrase} to go ahead: `);
    expect(c.asked[0]).toBe(`Type ${phrase} to go ahead: `);
  });

  test("no console to ask is never `typed` — rule 4", async () => {
    expect(await typed(fake({ answers: null }).io, phrase, "p")).toBe("mismatch");
  });
});

// ── askHidden ───────────────────────────────────────────────────────────────

describe("askHidden", () => {
  const key = "sk-ant-notarealkey-0123456789";

  test("the hidden reader is used, and the value reaches no output", async () => {
    const c = terminal({ hidden: [key] });
    expect(await askHidden(c.io, "Anthropic API key (Enter to skip): ")).toBe(key);
    expect(c.askedHidden).toEqual(["Anthropic API key (Enter to skip): "]);
    expect(c.out).toEqual([]);
    expect(c.err).toEqual([]);
    expect(c.asked).toEqual([]);
  });

  test("Enter on empty is a skip, not a failure", async () => {
    const c = terminal({ hidden: [""] });
    expect(await askHidden(c.io, "Voyage key: ")).toBe("");
  });

  test("a terminal with NO hidden reader refuses rather than echo", async () => {
    const c = fake({ answers: [key], tty: { stdin: true, stdout: true } });
    let caught: unknown = null;
    try {
      await askHidden(c.io, "key: ");
    } catch (e) {
      caught = e;
    }
    expect(isPromptAborted(caught)).toBe(true);
    expect((caught as PromptAborted).reason).toBe("no-hidden-input");
    // It never asked the echoing reader.
    expect(c.asked).toEqual([]);
    expect(c.out).toEqual([]);
  });

  test("a test console (no terminal) falls back to the scripted answer", async () => {
    const c = fake({ answers: [key] });
    expect(await askHidden(c.io, "key: ")).toBe(key);
    expect(c.asked).toEqual(["key: "]);
    expect(c.out).toEqual([]);
  });

  test("no console at all is a skip", async () => {
    expect(await askHidden(fake({ answers: null }).io, "key: ")).toBe("");
  });

  test("the trailing end-of-line is stripped and nothing else is", async () => {
    expect(await askHidden(terminal({ hidden: [`${key}\r\n`] }).io, "k")).toBe(key);
    expect(await askHidden(terminal({ hidden: [` ${key}`] }).io, "k")).toBe(` ${key}`);
  });

  test("Esc is the skip this prompt already offers — not an abort, and nothing written", async () => {
    const c = terminal({ hidden: [PROMPT_CANCEL] });
    expect(await askHidden(c.io, "Voyage key: ")).toBe("");
    expect(c.out).toEqual([]);
    expect(c.err).toEqual([]);
    // And on the no-terminal fallback path too.
    expect(await askHidden(fake({ answers: [PROMPT_CANCEL] }).io, "k")).toBe("");
  });
});

// ── the raw hidden reader ───────────────────────────────────────────────────

class FakeInput implements RawInput {
  isTTY = true;
  readonly raw: boolean[] = [];
  paused = 0;
  resumed = 0;
  private readonly listeners = new Map<string, ((chunk: unknown) => void)[]>();

  setRawMode(mode: boolean): void {
    this.raw.push(mode);
  }
  resume(): void {
    this.resumed += 1;
  }
  pause(): void {
    this.paused += 1;
  }
  on(event: string, listener: (chunk: unknown) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }
  off(event: string, listener: (chunk: unknown) => void): void {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      list.filter((l) => l !== listener),
    );
  }
  count(event: string): number {
    return (this.listeners.get(event) ?? []).length;
  }
  emit(event: string, chunk?: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(chunk);
  }
}

/** The ESC wait, shortened so the suite does not sit out the real one. */
const ESC_MS = 5;
const waitForEsc = (): Promise<void> =>
  new Promise((done) => setTimeout(done, ESC_MS * 4));

function rig(): { input: FakeInput; written: string[]; read: (q: string) => Promise<string> } {
  const input = new FakeInput();
  const written: string[] = [];
  return {
    input,
    written,
    read: hiddenPrompt(input, { write: (s) => written.push(s) }, ESC_MS),
  };
}

/** The same rig, echoing — `Io.prompt` as the entry point binds it. */
function echoRig(): { input: FakeInput; written: string[]; read: (q: string) => Promise<string> } {
  const input = new FakeInput();
  const written: string[] = [];
  return {
    input,
    written,
    read: echoPrompt(input, { write: (s) => written.push(s) }, ESC_MS),
  };
}

describe("hiddenPrompt", () => {
  const key = "sk-ant-notarealkey-0123456789";

  test("Enter in raw mode is \\r, and the value comes back", async () => {
    const r = rig();
    const p = r.read("Key: ");
    r.input.emit("data", `${key}\r`);
    expect(await p).toBe(key);
  });

  test("\\n works too, and so does a chunk-per-character typist", async () => {
    const r = rig();
    const p = r.read("Key: ");
    for (const ch of "abc") r.input.emit("data", ch);
    r.input.emit("data", "\n");
    expect(await p).toBe("abc");
  });

  test("the terminal is put in raw mode and taken back out", async () => {
    const r = rig();
    const p = r.read("Key: ");
    expect(r.input.raw).toEqual([true]);
    r.input.emit("data", "x\r");
    await p;
    expect(r.input.raw).toEqual([true, false]);
    expect(r.input.paused).toBe(1);
    expect(r.input.resumed).toBe(1);
    expect(r.input.count("data")).toBe(0);
    expect(r.input.count("end")).toBe(0);
    expect(r.input.count("error")).toBe(0);
  });

  test("the question is written and the VALUE never is", async () => {
    const r = rig();
    const p = r.read("Anthropic API key: ");
    r.input.emit("data", `${key}\r`);
    await p;
    expect(r.written).toEqual(["Anthropic API key: ", "\n"]);
    expect(r.written.join("")).not.toContain(key);
    expect(r.written.join("")).not.toContain("sk-ant");
  });

  test("Ctrl-C aborts, restores the terminal, and writes no value", async () => {
    const r = rig();
    const p = r.read("Key: ");
    r.input.emit("data", "sk-half");
    r.input.emit("data", "\u0003");
    let caught: unknown = null;
    try {
      await p;
    } catch (e) {
      caught = e;
    }
    expect(isPromptAborted(caught)).toBe(true);
    expect((caught as PromptAborted).reason).toBe("interrupt");
    expect((caught as Error).message).not.toContain("sk-half");
    expect(r.input.raw).toEqual([true, false]);
    expect(r.input.paused).toBe(1);
    expect(r.input.count("data")).toBe(0);
    expect(r.written.join("")).not.toContain("sk-half");
  });

  test("backspace deletes, so a typo is fixable", async () => {
    const r = rig();
    const p = r.read("Key: ");
    r.input.emit("data", "abX");
    r.input.emit("data", "\u007f");
    r.input.emit("data", "c");
    r.input.emit("data", "\b\b");
    r.input.emit("data", "bc\r");
    expect(await p).toBe("abc");
  });

  test("backspace on an empty value is harmless", async () => {
    const r = rig();
    const p = r.read("Key: ");
    r.input.emit("data", "\u007f\u007f");
    r.input.emit("data", "\r");
    expect(await p).toBe("");
  });

  test("an arrow key does not end up inside a credential", async () => {
    const r = rig();
    const p = r.read("Key: ");
    // The three bytes an up-arrow sends — swallowed whole, not just the ESC.
    r.input.emit("data", `${ESC}[A`);
    r.input.emit("data", "abc");
    // Home, and a parameterised sequence, both arriving mid-word.
    r.input.emit("data", `${ESC}OH`);
    r.input.emit("data", `${ESC}[1;5D`);
    r.input.emit("data", "def\r");
    expect(await p).toBe("abcdef");
  });

  test("an escape sequence split across two chunks is still swallowed", async () => {
    const r = rig();
    const p = r.read("Key: ");
    r.input.emit("data", `ab${ESC}`);
    r.input.emit("data", "[");
    r.input.emit("data", "B");
    r.input.emit("data", "c\r");
    expect(await p).toBe("abc");
  });

  test("a bare ESC swallows one character and no more", async () => {
    const r = rig();
    const p = r.read("Key: ");
    r.input.emit("data", `a${ESC}zbc\r`);
    expect(await p).toBe("abc");
  });

  test("everything after the first end-of-line in one chunk is ignored", async () => {
    const r = rig();
    const p = r.read("Key: ");
    r.input.emit("data", `${key}\rnot-part-of-it\r`);
    expect(await p).toBe(key);
  });

  test("Ctrl-D ends the read where it stands", async () => {
    const r = rig();
    const p = r.read("Key: ");
    r.input.emit("data", "ab\u0004");
    expect(await p).toBe("ab");
    expect(r.input.raw).toEqual([true, false]);
  });

  test("a closed stream resolves rather than hanging, and restores the terminal", async () => {
    const r = rig();
    const p = r.read("Key: ");
    r.input.emit("data", "ab");
    r.input.emit("end");
    expect(await p).toBe("ab");
    expect(r.input.raw).toEqual([true, false]);
    expect(r.input.count("data")).toBe(0);
  });

  test("a stream ERROR aborts — half a key is never returned as the key", async () => {
    const r = rig();
    const p = r.read("Key: ");
    r.input.emit("data", "sk-half");
    r.input.emit("error", new Error("EIO"));
    let caught: unknown = null;
    try {
      await p;
    } catch (e) {
      caught = e;
    }
    expect(isPromptAborted(caught)).toBe(true);
    expect((caught as PromptAborted).reason).toBe("interrupt");
    expect((caught as Error).message).not.toContain("sk-half");
    expect(r.input.raw).toEqual([true, false]);
    expect(r.input.paused).toBe(1);
    expect(r.input.count("error")).toBe(0);
    expect(r.written.join("")).not.toContain("sk-half");
  });

  test("Ctrl-C works mid escape sequence, and after a bare ESC", async () => {
    for (const lead of [ESC, `${ESC}[`, `${ESC}[1;`]) {
      const r = rig();
      const p = r.read("Key: ");
      r.input.emit("data", "sk-half");
      r.input.emit("data", lead);
      r.input.emit("data", "\u0003");
      let caught: unknown = null;
      try {
        await p;
      } catch (e) {
        caught = e;
      }
      expect(isPromptAborted(caught)).toBe(true);
      expect((caught as PromptAborted).reason).toBe("interrupt");
      expect(r.input.raw).toEqual([true, false]);
    }
  });

  test("a stream that is not a terminal is never put in raw mode", async () => {
    const r = rig();
    r.input.isTTY = false;
    const p = r.read("Key: ");
    r.input.emit("data", "abc\r");
    expect(await p).toBe("abc");
    expect(r.input.raw).toEqual([]);
  });

  test("Esc comes back as the cancel sentinel here too, and the value is dropped", async () => {
    const r = rig();
    const p = r.read("Key: ");
    r.input.emit("data", "sk-half");
    r.input.emit("data", ESC);
    const answer = await p;
    expect(answer).toBe(PROMPT_CANCEL);
    expect(isCancel(answer)).toBe(true);
    expect(r.input.raw).toEqual([true, false]);
    expect(r.written.join("")).not.toContain("sk-half");
  });
});

// ── the echoing reader ──────────────────────────────────────────────────────

/**
 * `Io.prompt` on a real terminal, since 2026-09-22. Same loop as above, three
 * differences, and each one has a test here: it echoes, a backspace ERASES, and
 * the end of the stream is not an answer (review m4 — a `confirm` whose Enter
 * is a yes must never be answered by a stdin that closed).
 */
describe("echoPrompt", () => {
  test("Enter is \\r, the line comes back, and every character was echoed", async () => {
    const r = echoRig();
    const p = r.read("Name? ");
    r.input.emit("data", "Mike\r");
    expect(await p).toBe("Mike");
    expect(r.written.join("")).toBe("Name? Mike\n");
  });

  test("a paste arrives as one chunk and stops at the first end-of-line", async () => {
    const r = echoRig();
    const p = r.read("Name? ");
    r.input.emit("data", "DELETE MEMORIES\rand whatever came after\r");
    expect(await p).toBe("DELETE MEMORIES");
  });

  test("backspace erases on the screen as well as in the value", async () => {
    const r = echoRig();
    const p = r.read("q ");
    r.input.emit("data", "abX");
    r.input.emit("data", "\u007f");
    r.input.emit("data", "c\r");
    expect(await p).toBe("abc");
    expect(r.written.join("")).toBe("q abX\b \bc\n");
  });

  test("backspace on an empty line writes nothing at all", async () => {
    const r = echoRig();
    const p = r.read("q ");
    r.input.emit("data", "\u007f\b");
    r.input.emit("data", "\r");
    expect(await p).toBe("");
    expect(r.written.join("")).toBe("q \n");
  });

  test("a bare ESC cancels once the wait is over, and the terminal is restored", async () => {
    const r = echoRig();
    const p = r.read("Go ahead? [Y/n] ");
    r.input.emit("data", "ye");
    r.input.emit("data", ESC);
    expect(await p).toBe(PROMPT_CANCEL);
    expect(isCancel(PROMPT_CANCEL)).toBe(true);
    expect(r.input.raw).toEqual([true, false]);
    expect(r.input.paused).toBe(1);
    expect(r.input.count("data")).toBe(0);
  });

  test("an ARROW KEY is not a cancel, whether it arrives whole or in pieces", async () => {
    // The whole reason the wait exists: an arrow key starts with the same byte.
    const r = echoRig();
    const p = r.read("q ");
    r.input.emit("data", `${ESC}[A`);
    await waitForEsc();
    r.input.emit("data", "ok\r");
    expect(await p).toBe("ok");

    const split = echoRig();
    const q = split.read("q ");
    split.input.emit("data", ESC);
    // The rest of the sequence arrives INSIDE the wait, which is what a real
    // terminal does; the timer is cleared by the next byte, not by the ESC.
    split.input.emit("data", "[B");
    await waitForEsc();
    split.input.emit("data", "fine\r");
    expect(await q).toBe("fine");
  });

  test("an ESC whose wait has already elapsed cannot be un-cancelled", async () => {
    const r = echoRig();
    const p = r.read("q ");
    r.input.emit("data", ESC);
    await waitForEsc();
    // Whatever arrives now has nobody listening: the reader is detached.
    r.input.emit("data", "abc\r");
    expect(await p).toBe(PROMPT_CANCEL);
  });

  test("Ctrl-C aborts from every state, escape sequence included", async () => {
    for (const lead of ["", ESC, `${ESC}[`, `${ESC}[1;`]) {
      const r = echoRig();
      const p = r.read("q ");
      r.input.emit("data", "half");
      if (lead.length > 0) r.input.emit("data", lead);
      r.input.emit("data", "\u0003");
      let caught: unknown = null;
      try {
        await p;
      } catch (e) {
        caught = e;
      }
      expect(isPromptAborted(caught)).toBe(true);
      expect((caught as PromptAborted).reason).toBe("interrupt");
      expect(r.input.raw).toEqual([true, false]);
      expect(r.input.paused).toBe(1);
    }
  });

  test("THE END OF THE STREAM IS NOT AN ANSWER — review m4, in this reader", async () => {
    // `confirm`'s Enter is a yes on half the screens in this package, so a
    // stdin that closed under the question must not come back as an empty line.
    for (const ending of ["end", "eot"] as const) {
      const r = echoRig();
      const p = r.read("Go ahead? [Y/n] ");
      r.input.emit("data", "y");
      if (ending === "end") r.input.emit("end");
      else r.input.emit("data", "\u0004");
      let caught: unknown = null;
      try {
        await p;
      } catch (e) {
        caught = e;
      }
      expect(isPromptAborted(caught)).toBe(true);
      expect((caught as Error).message).toContain("the input ended");
      expect(r.input.raw).toEqual([true, false]);
      expect(r.input.count("data")).toBe(0);
    }
  });

  test("a stream error aborts rather than resolving half a line", async () => {
    const r = echoRig();
    const p = r.read("q ");
    r.input.emit("data", "ab");
    r.input.emit("error", new Error("EIO"));
    let caught: unknown = null;
    try {
      await p;
    } catch (e) {
      caught = e;
    }
    expect(isPromptAborted(caught)).toBe(true);
    expect(r.input.raw).toEqual([true, false]);
    expect(r.input.count("error")).toBe(0);
  });

  test("a stream that is not a terminal is never put in raw mode, and never waits", async () => {
    // Nothing binds this reader off a terminal — but if anything ever does, an
    // ESC in a scripted stream must not hold the answer for a timer.
    const r = echoRig();
    r.input.isTTY = false;
    const p = r.read("q ");
    r.input.emit("data", ESC);
    await waitForEsc();
    // Still reading — and the `z` is the character a bare ESC swallows.
    r.input.emit("data", "zabc\r");
    expect(await p).toBe("abc");
    expect(r.input.raw).toEqual([]);
  });
});

// ── layout ──────────────────────────────────────────────────────────────────

const LONG =
  "the credentials file the configuration names holds no ANTHROPIC_API_KEY, so every boundary refused with NO_CREDENTIAL";

describe("layout, not a terminal", () => {
  test("one logical line per item, whatever its length", () => {
    const c = fake();
    const u = ui(c.io, NO_ENV);
    u.ok(LONG);
    u.warn(LONG);
    u.fail(LONG);
    u.hint(LONG);
    u.heading(LONG);
    u.step(2, 5, LONG);
    expect(c.out.length).toBe(6);
    for (const line of c.out) expect(line).toContain("NO_CREDENTIAL");
  });

  test("no escapes anywhere", () => {
    const c = fake();
    const u = ui(c.io, NO_ENV);
    u.heading("Wiring");
    u.step(1, 3, "backing up ~/.claude/settings.json");
    u.ok("wrote the hooks block");
    u.warn("one session is open");
    u.fail("could not parse the file");
    u.hint("run: counterparts doctor");
    u.blank();
    u.statusLine("RED", "Credentials", "none held", "run: counterparts credentials set");
    expect(c.out.join("\n")).not.toContain(ESC);
    expect(c.err).toEqual([]);
  });

  test("the shapes, exactly", () => {
    const c = fake();
    const u = ui(c.io, NO_ENV);
    u.heading("Wiring");
    u.step(2, 5, "wiring Claude Code");
    u.ok("done");
    u.warn("careful");
    u.fail("no");
    u.hint("an aside");
    u.blank();
    expect(c.out).toEqual([
      "Wiring",
      "[2/5] wiring Claude Code",
      "ok    done",
      "warn  careful",
      "fail  no",
      "      an aside",
      "",
    ]);
  });

  test("WARNING is a red word, not a `fail` tag, and its extra lines line up under it", () => {
    // Finding #25: the screen read `fail  WARNING: this will delete 32
    // memories`, and a `fail` tag in front of what a command is ABOUT to do
    // says something failed.
    const c = fake();
    ui(c.io, NO_ENV).warning(
      "nothing can bring these back afterwards.",
      "(counterparts uninstall --park sets them aside instead of deleting.)",
    );
    expect(c.out).toEqual([
      "WARNING: nothing can bring these back afterwards.",
      "         (counterparts uninstall --park sets them aside instead of deleting.)",
    ]);
    expect(c.out.join("")).not.toContain("fail");
  });

  test("the WARNING word is painted and nothing else on the line is", () => {
    const c = terminal({ columns: 100 });
    ui(c.io, NO_ENV).warning("this is about to happen.");
    expect(c.out[0]).toBe(`${ESC}[31mWARNING:${ESC}[0m this is about to happen.`);
  });

  test("fail writes to out, beside ok and warn — err stays the refusal channel", () => {
    const c = fake();
    ui(c.io, NO_ENV).fail("no");
    expect(c.err).toEqual([]);
    expect(c.out).toEqual(["fail  no"]);
  });

  test("the bound flags say what this console is", () => {
    const u = ui(fake().io, NO_ENV);
    expect(u.color).toBe(false);
    expect(u.wraps).toBe(false);
    expect(u.interactive).toBe(false);
    expect(u.width).toBe(FALLBACK_WIDTH);
    expect(u.paint).toBe(PLAIN);
  });
});

describe("layout, a terminal", () => {
  test("long text folds with a hanging indent into the same gutter", () => {
    const c = terminal({ columns: 50 });
    const u = ui(c.io, { NO_COLOR: "1" });
    u.ok(LONG);
    expect(c.out.length).toBeGreaterThan(1);
    expect(c.out[0]?.startsWith("ok    ")).toBe(true);
    for (const line of c.out.slice(1)) expect(line.startsWith("      ")).toBe(true);
    for (const line of c.out) expect(line.length).toBeLessThanOrEqual(50);
  });

  test("the grade word is painted and the column is still six wide", () => {
    const c = terminal({ columns: 100 });
    const u = ui(c.io, NO_ENV);
    u.statusLine("GREEN", "Store", "/tmp/store");
    const line = c.out[0] ?? "";
    expect(line.startsWith(`${ESC}[32mGREEN${ESC}[0m`)).toBe(true);
    // Strip the escapes and the line is the plain one, column for column.
    expect(line.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "")).toBe(
      "GREEN Store       /tmp/store",
    );
  });

  test("AMBER is yellow, RED is red, and the fix line is dim", () => {
    const c = terminal({ columns: 100 });
    const u = ui(c.io, NO_ENV);
    u.statusLine("AMBER", "Sweep", "no boundary yet", "wait for the next one");
    u.statusLine("RED", "Store", "absent");
    expect(c.out[0]?.startsWith(`${ESC}[33mAMBER${ESC}[0m`)).toBe(true);
    expect(c.out[1]?.startsWith(`${ESC}[2m`)).toBe(true);
    expect(c.out[1]).toContain("fix: wait for the next one");
    expect(c.out[2]?.startsWith(`${ESC}[31mRED${ESC}[0m`)).toBe(true);
  });

  test("FORCE_COLOR on a pipe colours WITHOUT wrapping — greps keep working", () => {
    const c = fake();
    const u = ui(c.io, { FORCE_COLOR: "1" });
    expect(u.color).toBe(true);
    expect(u.wraps).toBe(false);
    u.statusLine("RED", "Credentials", LONG, "run: counterparts credentials set ANTHROPIC_API_KEY");
    expect(c.out.length).toBe(2);
    expect(c.out[0]).toContain(ESC);
    expect(c.out[0]).toContain("NO_CREDENTIAL");
  });

  test("NO_COLOR on a terminal still wraps", () => {
    const c = terminal({ columns: 40 });
    const u = ui(c.io, { NO_COLOR: "1" });
    expect(u.color).toBe(false);
    expect(u.wraps).toBe(true);
    u.hint(LONG);
    expect(c.out.length).toBeGreaterThan(1);
    expect(c.out.join("")).not.toContain(ESC);
  });

  test("a terminal console is interactive, and the flag still overrides", () => {
    const c = terminal();
    expect(ui(c.io, NO_ENV).interactive).toBe(true);
    expect(ui(c.io, NO_ENV, { nonInteractive: true }).interactive).toBe(false);
  });
});

// ── statusLine against doctor's own renderer ────────────────────────────────

describe("statusLine is doctor's line", () => {
  function doctorLine(f: Finding): string[] {
    // `reportLines` = [header, ""] + the finding's lines + ["", summary].
    return reportLines([f], "2026-09-21").slice(2, -2);
  }

  function ours(f: Finding): string[] {
    const c = fake();
    ui(c.io, NO_ENV).statusLine(
      f.severity.toUpperCase() as Grade,
      f.title,
      f.detail,
      f.fix.length === 0 ? undefined : f.fix,
    );
    return c.out;
  }

  const cases: readonly Finding[] = [
    { key: "store", severity: "green", title: "Store", detail: "/tmp/x/store", fix: "", data: {} },
    {
      key: "credentials",
      severity: "red",
      title: "Credentials",
      detail: "the file holds no names",
      fix: "run: counterparts credentials set ANTHROPIC_API_KEY",
      data: {},
    },
    {
      key: "sweep",
      severity: "amber",
      title: "Sweep",
      detail: "no boundary since 2026-09-20",
      fix: "nothing to do; the next boundary clears it",
      data: {},
    },
    // The 2026-09-20 fix: a title exactly as wide as its column still gets its
    // space. Without it this renders "AMBER Journal modewal".
    {
      key: "journal",
      severity: "amber",
      title: "Journal mode",
      detail: "wal (busy timeout 5000 ms)",
      fix: "",
      data: {},
    },
    {
      key: "long",
      severity: "red",
      title: "A very long title indeed",
      detail: "short",
      fix: "and a fix",
      data: {},
    },
  ];

  for (const f of cases) {
    test(`byte-identical for ${f.key}`, () => {
      expect(ours(f)).toEqual(doctorLine(f));
    });
  }
});

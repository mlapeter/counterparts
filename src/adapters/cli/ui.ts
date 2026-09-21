/**
 * `adapters/cli/ui.ts` — the console's shared primitives: asking, colour, layout.
 *
 * Every interactive command the 0.2 install flow adds (wiring, uninstall, the
 * credential prompts, the reshaped `--help` and `doctor`) is built out of this
 * one file, so that a person meets ONE set of manners rather than four. Zero
 * runtime dependencies, as the rest of this package: the escapes are eight
 * strings and the line reader is `Io`.
 *
 * ── The four rules the whole module exists to hold ──────────────────────────
 *
 *   1. **Not a terminal → exactly as before.** `isInteractive` is false for a
 *      pipe, a CI job and every test console, and nothing here wraps, colours or
 *      asks when it is false. A command that gates on it keeps its current bytes
 *      for every scripted caller — the install loop included.
 *   2. **`NO_COLOR` is obeyed** (https://no-color.org), and so is `TERM=dumb`.
 *      Colour may only emphasize what the words already say: the dashboard's
 *      scar §2.4 — an absence is DISPLAYED, never merely un-highlighted — and a
 *      grade word (`GREEN`/`AMBER`/`RED`) is written out in both arms.
 *   3. **A hidden value is never echoed and never written.** `askHidden` returns
 *      it and writes nothing but the question and one newline. It is not passed
 *      to `io.out`, `io.err`, an error message, or a log — a secret that reaches
 *      a console has reached a scrollback buffer.
 *   4. **Nothing proceeds unconfirmed.** With no `io.prompt`, `confirm` is
 *      `false` and `typed` is `false` whatever their default says — the same
 *      stance `Io.prompt`'s own docstring takes. `ask` alone falls back to its
 *      default, because a name is not a consent.
 *
 * ── Wrapping and colour are decided separately, on purpose ──────────────────
 *
 * Wrapping keys off `io.tty.stdout`; colour keys off `useColor`, which
 * `FORCE_COLOR` can turn on for a pipe. So a coloured pipe still gets ONE
 * logical line per item and every existing `grep` in the suite and in
 * `tools/install-loop/run.sh` keeps working.
 *
 * ── The seam, and the one trap in it ────────────────────────────────────────
 *
 * Everything reads the console through `Io` (`commands.ts`), extended here-ward
 * with two OPTIONAL members — `promptHidden` and `tty` — so every existing
 * caller and every existing test compiles and behaves unchanged. Absent `tty`
 * means "no terminal", which is the truth for all of them.
 *
 * THE TRAP: a test that drives the interactive arm by setting
 * `tty: { stdin: true, stdout: true }` must ALSO supply `promptHidden`, or
 * `askHidden` refuses (`PromptAborted`, reason `no-hidden-input`) rather than
 * fall back to the echoing reader. That refusal is rule 3 defending itself: the
 * fallback to `io.prompt` is offered only to a console that has told us it is
 * not a terminal, where there is no terminal to echo to.
 */

import type { Io } from "./commands.js";

/** The environment, as `RunOptions` passes it. Never read from `process.env`
 *  here: a suite that did would pass or fail with the developer's shell. */
export type UiEnv = Record<string, string | undefined>;

// ── colour ──────────────────────────────────────────────────────────────────

// Built from the code point rather than written as a literal, exactly as
// `dashboard/ansi.ts` does: a raw control byte in a source file survives only
// as long as nothing reformats the file.
const CSI = `${String.fromCharCode(27)}[`;
const RESET = `${CSI}0m`;

function sgr(code: string, s: string): string {
  return s.length === 0 ? s : `${CSI}${code}m${s}${RESET}`;
}

/** The six colours this console has. Anything a command wants to say beyond
 *  them, it says in words. */
export interface Paint {
  readonly enabled: boolean;
  green(s: string): string;
  yellow(s: string): string;
  red(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
  cyan(s: string): string;
}

const IDENTITY = (s: string): string => s;

/** Escapes off — the default for every pipe, every test and every `NO_COLOR`. */
export const PLAIN: Paint = {
  enabled: false,
  green: IDENTITY,
  yellow: IDENTITY,
  red: IDENTITY,
  dim: IDENTITY,
  bold: IDENTITY,
  cyan: IDENTITY,
};

const COLOUR: Paint = {
  enabled: true,
  green: (s) => sgr("32", s),
  yellow: (s) => sgr("33", s),
  red: (s) => sgr("31", s),
  dim: (s) => sgr("2", s),
  bold: (s) => sgr("1", s),
  cyan: (s) => sgr("36", s),
};

/**
 * Should this run colour its output?
 *
 * The precedence is fixed and tested in both orders:
 *
 *   1. `NO_COLOR` set to anything non-empty → **no**, whatever else is true.
 *      The VALUE is never interpreted: `NO_COLOR=0` means no colour, because the
 *      standard is about the variable's presence. (Empty string is treated as
 *      unset — the reading `dashboard/ansi.ts` already takes, and one repo
 *      should not hold two definitions of one variable.)
 *   2. `FORCE_COLOR` set, non-empty and not `"0"` → **yes**, even on a pipe.
 *      This does NOT turn wrapping on; see the file docstring.
 *   3. Otherwise: stdout is a terminal and `TERM` is not `dumb`.
 */
export function useColor(io: Io, env: UiEnv): boolean {
  const no = env["NO_COLOR"];
  if (typeof no === "string" && no.length > 0) return false;
  const force = env["FORCE_COLOR"];
  if (typeof force === "string" && force.length > 0 && force !== "0") return true;
  if (io.tty?.stdout !== true) return false;
  return env["TERM"] !== "dumb";
}

/** The `Paint` for this console and this environment. */
export function paint(io: Io, env: UiEnv): Paint {
  return useColor(io, env) ? COLOUR : PLAIN;
}

// ── am I talking to a person? ───────────────────────────────────────────────

export interface InteractiveOptions {
  /** The command's own `--yes` / `--no-input` / `--no-wire`: the caller has
   *  said it does not want to be asked, and that outranks the terminal. */
  readonly nonInteractive?: boolean;
}

/**
 * True only when there is a person at a keyboard who can answer.
 *
 * Four conjuncts, and every one of them has to hold: the caller did not opt out,
 * this console can actually ask (`io.prompt`), stdin AND stdout are terminals,
 * and `CI` is unset. stdout matters as much as stdin: a run whose answers come
 * from a terminal but whose output is being captured is a script, and a question
 * it never sees is a hang.
 */
export function isInteractive(io: Io, env: UiEnv, opts: InteractiveOptions = {}): boolean {
  if (opts.nonInteractive === true) return false;
  if (io.prompt === undefined) return false;
  if (io.tty?.stdin !== true || io.tty.stdout !== true) return false;
  const ci = env["CI"];
  if (typeof ci === "string" && ci.length > 0) return false;
  return true;
}

// ── width and wrapping ──────────────────────────────────────────────────────

/** The width assumed when the terminal will not say. */
export const FALLBACK_WIDTH = 80;

/** Narrower than this and wrapping does more harm than the long line. */
const MIN_WIDTH = 30;

/** How wide to lay out for. Only ever the terminal's own report; `COLUMNS` is
 *  not read, because a stale export is worse than the fallback. */
export function terminalWidth(io: Io): number {
  const c = io.tty?.columns;
  if (typeof c !== "number" || !Number.isFinite(c)) return FALLBACK_WIDTH;
  const n = Math.floor(c);
  return n < MIN_WIDTH ? MIN_WIDTH : n;
}

/** Wrapping happens for a terminal and nowhere else, so a pipe and a test get
 *  one logical line per item and every existing `grep` keeps working. */
export function wraps(io: Io): boolean {
  return io.tty?.stdout === true;
}

/**
 * `prefix + text`, folded to `width` with a hanging indent of `hanging` spaces.
 *
 * Greedy, on runs of whitespace, and a token longer than the room available is
 * emitted WHOLE on a line of its own — a path or a URL is worse broken than
 * over-long, and a wrapper that could not place a token would otherwise loop.
 * Only the TEXT is folded; `prefix` is placed verbatim on the first line, so a
 * caller that built a padded column keeps it.
 */
export function fold(prefix: string, text: string, width: number, hanging: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [prefix.length === 0 ? "" : prefix.replace(/\s+$/, "")];
  const pad = " ".repeat(Math.max(0, hanging));
  const firstRoom = Math.max(1, width - prefix.length);
  const restRoom = Math.max(1, width - pad.length);
  const out: string[] = [];
  let line = "";
  let room = firstRoom;
  for (const word of words) {
    if (line.length === 0) {
      line = word;
      continue;
    }
    if (line.length + 1 + word.length <= room) {
      line = `${line} ${word}`;
      continue;
    }
    out.push(out.length === 0 ? prefix + line : pad + line);
    line = word;
    room = restRoom;
  }
  out.push(out.length === 0 ? prefix + line : pad + line);
  return out;
}

// ── asking ──────────────────────────────────────────────────────────────────

export type AbortReason = "interrupt" | "no-hidden-input";

/**
 * A question that did not get an answer and must not be treated as one.
 *
 * Thrown rather than returned as a null, deliberately: a forgotten check on a
 * nullable return turns Ctrl-C into "the person skipped it", which for a key
 * prompt means an install that silently continues without the key the person was
 * in the middle of cancelling. Uncaught, it still exits non-zero through the
 * `bin/` entry's own rejection handler.
 */
export class PromptAborted extends Error {
  readonly reason: AbortReason;
  constructor(reason: AbortReason, message: string) {
    super(message);
    this.name = "PromptAborted";
    this.reason = reason;
  }
}

/** `instanceof` across module instances is not a thing to rely on; the name is. */
export function isPromptAborted(e: unknown): e is PromptAborted {
  return e instanceof Error && e.name === "PromptAborted";
}

/** ONE trailing end-of-line and nothing else. Not `trim()`: what a person typed
 *  between the prompt and the newline is what they meant, and a typed
 *  confirmation compares exactly. */
function stripEol(s: string): string {
  if (s.endsWith("\r\n")) return s.slice(0, -2);
  if (s.endsWith("\n") || s.endsWith("\r")) return s.slice(0, -1);
  return s;
}

export interface AskOptions {
  /** Shown as `[default]` and returned for an empty answer. */
  readonly default?: string;
}

/**
 * One line of free text.
 *
 * The question is used VERBATIM and a space is appended, so the caller owns its
 * own punctuation; a default is shown as `[…]` before it. With no console to ask
 * (a pipe, a test with no scripted answers) the default comes back — a name or a
 * budget is a value, not a consent, so falling back is honest here and is not in
 * `confirm`.
 */
export async function ask(io: Io, question: string, opts: AskOptions = {}): Promise<string> {
  const fallback = opts.default ?? "";
  if (io.prompt === undefined) return fallback;
  const hint = opts.default === undefined || opts.default.length === 0 ? "" : ` [${opts.default}]`;
  const answer = stripEol(await io.prompt(`${question}${hint} `));
  return answer.length === 0 ? fallback : answer;
}

export interface ConfirmOptions {
  /** Required: an unanswerable yes/no has to know which way Enter goes. */
  readonly default: boolean;
}

/**
 * Yes or no, with the default in capitals — `[Y/n]` or `[y/N]`.
 *
 * `y`/`yes`/`n`/`no` in any case, Enter for the default, and ONE re-ask on
 * anything else before the default is taken: a person who has typed two
 * non-answers is not reading, and a third identical question is a trap rather
 * than a kindness.
 *
 * **With no `io.prompt` this is `false`, never the default.** Every caller of
 * this function is about to do something to somebody's machine; `Io`'s own
 * docstring already says an absent prompt means a destructive command refuses
 * rather than proceeds, and a `{ default: true }` that wired a stranger's
 * settings.json over a pipe would be that rule failing quietly.
 */
export async function confirm(io: Io, question: string, opts: ConfirmOptions): Promise<boolean> {
  if (io.prompt === undefined) return false;
  const tag = opts.default ? "[Y/n]" : "[y/N]";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = stripEol(await io.prompt(`${question} ${tag} `)).trim().toLowerCase();
    if (raw.length === 0) return opts.default;
    if (raw === "y" || raw === "yes") return true;
    if (raw === "n" || raw === "no") return false;
    if (attempt === 0) io.out("Please answer y or n.");
  }
  return opts.default;
}

/**
 * The typed confirmation, as `start-fresh` and `remove` already use it: true
 * only when what came back IS the phrase.
 *
 * Case-sensitive, and nothing is trimmed but the trailing end-of-line, so
 * `DELETE MEMORIES ` is not `DELETE MEMORIES`. That is the whole point of asking
 * for a phrase instead of a letter: it cannot be answered by reflex.
 */
export async function typed(io: Io, exactPhrase: string, prompt: string): Promise<boolean> {
  if (io.prompt === undefined) return false;
  return stripEol(await io.prompt(prompt)) === exactPhrase;
}

/**
 * A secret, read without echo.
 *
 * Three consoles, three behaviours:
 *
 *   - `io.promptHidden` present → that, and only that.
 *   - absent, and stdin is a TERMINAL → **refuse** (`PromptAborted`,
 *     `no-hidden-input`). Falling back to the echoing reader here would put an
 *     API key in a scrollback buffer, which is the one thing this function
 *     exists to prevent.
 *   - absent, and not a terminal (a test console, a pipe) → `io.prompt`, or `""`
 *     when there is none. There is no terminal to echo to.
 *
 * Empty means SKIP and is an ordinary answer: every key this console asks for is
 * optional. The value is returned and nowhere else — not printed, not logged,
 * not put in an error.
 */
export async function askHidden(io: Io, question: string): Promise<string> {
  if (io.promptHidden !== undefined) return stripEol(await io.promptHidden(question));
  if (io.tty?.stdin === true) {
    throw new PromptAborted(
      "no-hidden-input",
      "this console cannot read a value without echoing it back",
    );
  }
  if (io.prompt === undefined) return "";
  return stripEol(await io.prompt(question));
}

// ── the hidden reader itself ────────────────────────────────────────────────

/** The half of `process.stdin` this needs, as a seam a test can supply. */
export interface RawInput {
  readonly isTTY?: boolean | undefined;
  setRawMode?(mode: boolean): void;
  resume?(): void;
  pause?(): void;
  on(event: string, listener: (chunk: unknown) => void): void;
  off?(event: string, listener: (chunk: unknown) => void): void;
  removeListener?(event: string, listener: (chunk: unknown) => void): void;
}

/** The half of `process.stdout` this needs. */
export interface RawOutput {
  write(s: string): void;
}

const ETX = "\u0003"; // Ctrl-C
const EOT = "\u0004"; // Ctrl-D
const DEL = "\u007f";
const BS = "\b";
const ESC = String.fromCharCode(27);

/**
 * Build a `promptHidden` over real streams: raw mode, no echo, no dependency.
 *
 * Exported and NOT yet wired into `bin/counterparts.ts` — this change adds no
 * behaviour to any command. The entry point binds it when the first command
 * needs it.
 *
 * What the character loop has to get right, and why each one is here:
 *
 *   - **Enter in raw mode is `\r`, not `\n`.** A reader waiting for `\n` hangs
 *     on a real terminal forever.
 *   - **A paste arrives as one chunk**, key and newline together, so the loop
 *     is per character and stops at the first end-of-line.
 *   - **Backspace** (`\x7f` and `\b`) must work, or a typo in a 100-character
 *     key can only be fixed by starting the command again.
 *   - **`setEncoding` is never called.** It is sticky on `process.stdin`, and
 *     `bin/counterparts.ts` reads the same stream for `credentials set`.
 *   - **The terminal is restored on every exit path** — Enter, Ctrl-C, Ctrl-D,
 *     `end`, `error` — and the listener is detached and the stream paused, or
 *     the process does not exit.
 *   - Control and escape bytes below `0x20` are DROPPED rather than stored, so
 *     an arrow key does not end up inside a credential.
 */
export function hiddenPrompt(
  input: RawInput,
  output: RawOutput,
): (question: string) => Promise<string> {
  return (question: string) =>
    new Promise<string>((resolve, reject) => {
      let value = "";
      let settled = false;
      /**
       * WHERE THE ESCAPE-SEQUENCE READER IS.
       *
       * An arrow key sends `ESC [ A`. Dropping only the ESC byte — which is all
       * a "below 0x20" rule does — leaves `[A` INSIDE the value, where nothing
       * echoes it and nobody can see it: a credential silently wrong. So the
       * sequence is swallowed whole: `csi` after `ESC [` or `ESC O`, consuming
       * until a final byte in `@`..`~`; `esc` after a bare ESC, swallowing one
       * more character.
       */
      let escape: "no" | "esc" | "csi" = "no";

      const detach = (): void => {
        if (input.off !== undefined) input.off("data", onData);
        else if (input.removeListener !== undefined) input.removeListener("data", onData);
        if (input.off !== undefined) input.off("end", onEnd);
        else if (input.removeListener !== undefined) input.removeListener("end", onEnd);
        if (input.off !== undefined) input.off("error", onEnd);
        else if (input.removeListener !== undefined) input.removeListener("error", onEnd);
      };

      /** The ONE way out: restore, detach, newline, then settle. */
      const finish = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        detach();
        try {
          if (input.isTTY === true) input.setRawMode?.(false);
        } catch {
          /* a terminal that will not leave raw mode is not a reason to lose the
             answer, and there is nothing further this can do about it */
        }
        try {
          input.pause?.();
        } catch {
          /* likewise */
        }
        // The newline the echo would have written. Never the value.
        output.write("\n");
        settle();
      };

      function onEnd(): void {
        finish(() => {
          resolve(value);
        });
      }

      function onData(chunk: unknown): void {
        // Decoded here rather than through `setEncoding`, which would be sticky
        // on the shared stream. Keys are ASCII; a multi-byte character split
        // across two chunks is the known and accepted limit.
        const text = typeof chunk === "string" ? chunk : String(chunk);
        for (const ch of text) {
          if (escape === "csi") {
            const c = ch.codePointAt(0) ?? 0;
            // The FINAL byte of a CSI sequence is `@`..`~`; everything before it
            // is a parameter or an intermediate.
            if (c >= 0x40 && c <= 0x7e) escape = "no";
            continue;
          }
          if (escape === "esc") {
            escape = ch === "[" || ch === "O" ? "csi" : "no";
            continue;
          }
          if (ch === ESC) {
            escape = "esc";
            continue;
          }
          if (ch === ETX) {
            finish(() => {
              reject(new PromptAborted("interrupt", "cancelled."));
            });
            return;
          }
          if (ch === "\r" || ch === "\n") {
            const answer = value;
            finish(() => {
              resolve(answer);
            });
            return;
          }
          if (ch === EOT) {
            const answer = value;
            finish(() => {
              resolve(answer);
            });
            return;
          }
          if (ch === DEL || ch === BS) {
            value = value.slice(0, -1);
            continue;
          }
          // Everything below a space is a control or the start of an escape
          // sequence, and none of it belongs in a credential.
          const code = ch.codePointAt(0) ?? 0;
          if (code < 0x20) continue;
          value += ch;
        }
      }

      output.write(question);
      try {
        if (input.isTTY === true) input.setRawMode?.(true);
      } catch {
        /* no raw mode available: the read still works, the terminal may echo,
           and that is the host's own doing rather than something to hide */
      }
      input.on("data", onData);
      input.on("end", onEnd);
      input.on("error", onEnd);
      input.resume?.();
    });
}

// ── layout ──────────────────────────────────────────────────────────────────

export type Grade = "GREEN" | "AMBER" | "RED";

/**
 * The two columns `statusLine` lays out in, and they are NOT free numbers:
 * they are `claude-code/doctor.ts`'s `SEVERITY_COLUMN` and `TITLE_COLUMN`, so
 * that a doctor line rendered here is byte-identical to `reportLines`'s when
 * wrapping is off. `test/ui.test.ts` holds the two files to each other.
 */
const GRADE_COLUMN = 6;
const LABEL_COLUMN = 12;
const GUTTER = GRADE_COLUMN + LABEL_COLUMN;

/** The six-space gutter `ok`/`warn`/`fail`/`hint` share, so a run of them reads
 *  as one column of words and one column of messages. */
const MARK_COLUMN = 6;

/** A label as wide as its column still gets its space: `padEnd` is a floor, not
 *  a gap (doctor's 2026-09-20 fix, kept identical here). */
function labelCell(label: string): string {
  return label.length >= LABEL_COLUMN ? `${label} ` : label.padEnd(LABEL_COLUMN);
}

/**
 * The console's layout, bound to one `Io` and one environment.
 *
 * Every method WRITES — to `io.out`, all of them, `fail` included. The error
 * channel stays what it already is in this console: a refusal, `io.err`, the
 * word `refused:` and an exit code. Splitting one flow's step lines across two
 * file descriptors by severity is the surprise, not the consistency.
 */
export interface Ui {
  readonly paint: Paint;
  /** Whether colour is on — for a caller that wants to paint something itself. */
  readonly color: boolean;
  /** Whether a person can be asked. `nonInteractive` is folded in already. */
  readonly interactive: boolean;
  /** Whether long lines are folded. False for every pipe and every test. */
  readonly wraps: boolean;
  /** The width being laid out for. `FALLBACK_WIDTH` when nobody said. */
  readonly width: number;
  /** One empty line. The only spacing primitive; groups are separated by it. */
  blank(): void;
  /** A short bold title over a group. */
  heading(text: string): void;
  /** `[2/5] Wiring Claude Code` — the counter dim, the text plain. */
  step(n: number, total: number, text: string): void;
  ok(text: string): void;
  warn(text: string): void;
  fail(text: string): void;
  /** An aside under the line above it: dim, and indented into the gutter. */
  hint(text: string): void;
  /** A doctor-shaped line: the grade in colour, the label in its column, a
   *  SHORT message, and the fix on its own indented dim line. */
  statusLine(grade: Grade, label: string, message: string, fix?: string): void;
}

export function ui(io: Io, env: UiEnv, opts: InteractiveOptions = {}): Ui {
  const p = paint(io, env);
  const folds = wraps(io);
  const width = terminalWidth(io);

  /** `prefix + text`, folded only when this console folds. */
  const emit = (prefix: string, text: string, hanging: number): string[] =>
    folds ? fold(prefix, text, width, hanging) : [`${prefix}${text}`];

  /** A marked line — `ok`, `warn`, `fail` — with the word painted and the
   *  padding computed from the PLAIN word, so the column is not thrown out by
   *  the escapes around it. */
  const marked = (word: string, colour: (s: string) => string, text: string): void => {
    const cell = word.padEnd(MARK_COLUMN);
    const lines = emit(cell, text, MARK_COLUMN);
    const first = lines[0] ?? "";
    io.out(colour(word) + first.slice(word.length));
    for (const line of lines.slice(1)) io.out(line);
  };

  return {
    paint: p,
    color: p.enabled,
    interactive: isInteractive(io, env, opts),
    wraps: folds,
    width,

    blank(): void {
      io.out("");
    },

    heading(text: string): void {
      const lines = emit("", text, 0);
      for (const line of lines) io.out(p.bold(line));
    },

    step(n: number, total: number, text: string): void {
      const cell = `[${String(n)}/${String(total)}] `;
      const lines = emit(cell, text, cell.length);
      const first = lines[0] ?? "";
      io.out(p.dim(cell.trimEnd()) + first.slice(cell.trimEnd().length));
      for (const line of lines.slice(1)) io.out(line);
    },

    ok(text: string): void {
      marked("ok", p.green, text);
    },

    warn(text: string): void {
      marked("warn", p.yellow, text);
    },

    fail(text: string): void {
      marked("fail", p.red, text);
    },

    hint(text: string): void {
      const cell = " ".repeat(MARK_COLUMN);
      for (const line of emit(cell, text, MARK_COLUMN)) io.out(p.dim(line));
    },

    statusLine(grade: Grade, label: string, message: string, fix?: string): void {
      const gradeCell = grade.padEnd(GRADE_COLUMN);
      const prefix = `${gradeCell}${labelCell(label)}`;
      const lines = emit(prefix, message, prefix.length);
      const first = lines[0] ?? "";
      const colour = grade === "GREEN" ? p.green : grade === "AMBER" ? p.yellow : p.red;
      io.out(colour(grade) + first.slice(grade.length));
      for (const line of lines.slice(1)) io.out(line);
      if (fix === undefined || fix.length === 0) return;
      // The fix indent is the CONSTANT gutter, not `prefix.length`: an
      // over-long label pushes its own line out and leaves the fix where every
      // other fix on the screen is — which is what `reportLines` does.
      const fixPrefix = `${" ".repeat(GUTTER)}fix: `;
      for (const line of emit(fixPrefix, fix, GUTTER + 5)) io.out(p.dim(line));
    },
  };
}

/**
 * `adapters/cli/report.ts` — the two readings a person actually looks at,
 * rendered for a terminal.
 *
 * ── The finding ─────────────────────────────────────────────────────────────
 *
 * New-user findings #5 (2026-09-21), in the owner's words: "all prompts/
 * terminal instructions should be more user friendly, better formatted, etc. if
 * we can use color for doctor we should." `doctor` and `status` are the two
 * commands a new install is CHECKED with, and both printed a dense block of
 * long unbroken lines with no spacing and no colour.
 *
 * ── The one rule this file exists to hold ───────────────────────────────────
 *
 * **PLAIN OUTPUT NEVER CHANGES.** Not a byte. A pipe, a test console, a CI job,
 * `tools/install-loop/run.sh`, `--json` — every one of them gets exactly what it
 * got before, from exactly the function it got it from (`reportLines`, and the
 * `io.out` sequence `statusCommand` already had). The new layout is reached only
 * when the console has told us it is a terminal (`io.tty`) or that it wants
 * colour anyway (`FORCE_COLOR`), which is `ui.ts`'s existing split between
 * wrapping and colour.
 *
 * That is why both functions take the findings/the view rather than the store:
 * the READING is one thing, computed once, and this file only decides how it is
 * laid out. A second renderer that recomputed anything would be a second reading
 * that could disagree with the first.
 *
 * ── Why the grouping and not just colour ────────────────────────────────────
 *
 * `reportLines` is already worst-first (`worstFirst`), and QUICKSTART §12 says
 * so — that order is kept exactly. What the terminal arm adds is a BLANK LINE
 * between the reds, the ambers and the greens, so that "how bad is it" is
 * answered by the shape of the screen before a word is read, and a message that
 * runs past the width is folded with a hanging indent instead of wrapping back
 * into column zero where it reads as a new finding.
 */

import type { Finding, Severity } from "../claude-code/doctor.js";
import { reportLines } from "../claude-code/doctor.js";
import type { Io } from "./commands.js";
import type { Grade, Paint, Ui, UiEnv } from "./ui.js";
import { fold, ui } from "./ui.js";

/** `Severity` (the reading's word) to `Grade` (the layout's word). */
const GRADE: Record<Severity, Grade> = { red: "RED", amber: "AMBER", green: "GREEN" };

/**
 * Does this console get the laid-out arm at all?
 *
 * Either half of `ui.ts`'s split is enough: a terminal (so the fold is wanted)
 * or colour asked for on a pipe (`FORCE_COLOR`, so the escapes are wanted). A
 * console with neither — every test, every pipe, the install loop — takes the
 * byte-identical arm, and that is the whole safety property of this file.
 */
function laidOut(u: Ui): boolean {
  return u.wraps || u.color;
}

/** The colour a grade is written in, from the one `Paint` this console has. */
function painter(p: Paint, severity: Severity): (s: string) => string {
  return severity === "red" ? p.red : severity === "amber" ? p.yellow : p.green;
}

/**
 * `counterparts doctor`, on a terminal.
 *
 * Worst first, unchanged. One blank line between the severities. The grade word
 * in colour and also IN WORDS (the dashboard's scar §2.4 — an absence is
 * displayed, never merely un-highlighted — which is why `statusLine` writes
 * `RED`/`AMBER`/`GREEN` in both arms). The fix dim, on its own line, in the
 * constant gutter. The summary last, coloured by the worst thing in the report.
 */
export function printDoctorReport(
  io: Io,
  env: UiEnv,
  findings: readonly Finding[],
  today: string,
): void {
  const u = ui(io, env);
  if (!laidOut(u)) {
    for (const line of reportLines(findings, today)) io.out(line);
    return;
  }
  // `reportLines` is the authority on ORDER and on the summary's arithmetic, so
  // this arm asks it for both rather than sorting and counting a second time.
  const lines = reportLines(findings, today);
  const header = lines[0] ?? "";
  const summary = lines[lines.length - 1] ?? "";

  io.out(u.paint.bold(header));
  u.blank();
  let printed = 0;
  let worst: Severity = "green";
  for (const severity of ["red", "amber", "green"] as const) {
    const group = findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    if (printed > 0) u.blank();
    if (printed === 0) worst = severity;
    printed += 1;
    // The reading's own order within a severity is the order the findings
    // arrived in — `worstFirst` is stable, so filtering preserves it exactly.
    for (const f of group) u.statusLine(GRADE[severity], f.title, f.detail, f.fix);
  }
  u.blank();
  io.out(painter(u.paint, worst)(summary));
}

// ── status ──────────────────────────────────────────────────────────────────

/** One labelled number or fact under a heading. */
export interface StatusRow {
  readonly label: string;
  readonly value: string;
  /** Emit the value VERBATIM, never folded. For a value whose own spacing is
   *  the layout — `by kind: self 1  person 0  …` groups its pairs with double
   *  spaces, and a greedy fold rejoins on single ones and loses the grouping. */
  readonly verbatim?: boolean;
}

/** A heading and the rows beneath it. */
export interface StatusBlock {
  readonly title: string;
  readonly rows: readonly StatusRow[];
  /** Lines printed under the rows, dim and indented — the asides. */
  readonly notes?: readonly string[];
}

/**
 * Everything `status` says, as data.
 *
 * `statusCommand` computes this ONCE and hands it to whichever renderer this
 * console gets, so the two layouts cannot disagree about a number. `plain` is
 * the exact `io.out` sequence the command has always produced, carried here as
 * strings rather than rebuilt — the only way to promise byte-identity is to keep
 * the bytes.
 */
export interface StatusView {
  readonly plain: readonly string[];
  readonly dir: string;
  readonly blocks: readonly StatusBlock[];
  readonly notes: readonly string[];
  /** The tail sections — removals, permanents, layout — already formatted. */
  readonly tail: readonly { readonly title: string; readonly lines: readonly string[] }[];
}

/** The widest label in a block, so one block's values line up with each other
 *  (not with the next block's: a column that spans unrelated facts reads as a
 *  table with a meaning it does not have). */
function labelWidth(rows: readonly StatusRow[]): number {
  return rows.reduce((w, r) => Math.max(w, r.label.length), 0);
}

/**
 * `counterparts status` — the census, on a terminal.
 *
 * The 2026-09-20 rule stands and is what the blocks are ordered by: the numbers
 * a person came for come first, the prose follows, and `--layout` is last
 * because the person who wants it will ask. What this arm changes is the shape
 * only — four labelled headings and a column of counts, instead of two lines
 * 120 characters wide that a narrow terminal folds into nonsense.
 */
export function printStatusReport(io: Io, env: UiEnv, view: StatusView): void {
  const u = ui(io, env);
  if (!laidOut(u)) {
    for (const line of view.plain) io.out(line);
    return;
  }
  /** `prefix + text`, folded with a hanging indent when this console folds.
   *  A console that only asked for COLOUR keeps one logical line per item —
   *  `ui.ts` decides the two separately, and every existing grep depends on it. */
  const emit = (prefix: string, text: string, hanging: number): string[] =>
    u.wraps ? fold(prefix, text, u.width, hanging) : [`${prefix}${text}`];

  /** An aside: dim, two spaces in, folded to the same two spaces. */
  const aside = (text: string): void => {
    for (const line of emit("  ", text, 2)) io.out(u.paint.dim(line));
  };

  io.out(`${u.paint.dim("Store:")} ${u.paint.cyan(view.dir)}`);
  for (const block of view.blocks) {
    if (block.rows.length === 0) continue;
    u.blank();
    u.heading(block.title);
    // One column per BLOCK, not one for the page: a column that spanned the
    // census and the dates would read as a table with a meaning it does not have.
    const width = labelWidth(block.rows) + 3;
    for (const row of block.rows) {
      const prefix = `  ${row.label.padEnd(width)}`;
      if (row.verbatim === true) io.out(`${prefix}${row.value}`);
      else for (const line of emit(prefix, row.value, 2 + width)) io.out(line);
    }
    for (const note of block.notes ?? []) aside(note);
  }
  if (view.notes.length > 0) {
    u.blank();
    for (const note of view.notes) aside(note);
  }
  for (const section of view.tail) {
    u.blank();
    u.heading(section.title);
    for (const line of section.lines) io.out(line);
  }
}

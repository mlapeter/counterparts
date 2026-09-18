/**
 * `counterparts self-page` — the owner's door to the written page.
 *
 * The page is the prose the wake now leads with, and constitution 6 says the
 * owner owns the data, in prose they can read and hand-edit in any editor. This
 * is the console half of that: read it, write it whole from a file or from
 * stdin, list what it used to say, and print any one of those versions.
 *
 * **Rendering only.** Every rule about the page — the caps, the gate battery,
 * the durable row, the refusals — lives on the one core seam
 * (`core/self/index.ts#revisePage`), and this file decides nothing of its own.
 * A console that re-implemented a cap would be a second cap.
 *
 * **Reading is allowed under observer; writing is not.** The write refuses at
 * the seam, in the sentence every other write refuses in, which is why
 * `self-page` is not on `OWNER_OPS` — see the note there. An instrument must be
 * able to answer "what does the page say", because that is the first question
 * anyone asks when the wake looks wrong.
 */
import { readFileSync } from "node:fs";

import type { Counterpart } from "../../core/counterpart.js";
import { PAGE_TEMPLATE, pageSections } from "../../core/self/index.js";
import type { SelfPage } from "../../core/self/index.js";

/** What a read prints when the store holds no page. Honest, and not a page. */
export const NO_PAGE_LINES: readonly string[] = [
  "No page has been written here yet — still forming.",
  "",
  "A page is written by a woken session (the `self_page` tool), by the nightly",
  "writer, or by you:",
  "",
  "  counterparts self-page --write --file <path> --reason \"why\"",
  "  … | counterparts self-page --write --stdin --reason \"why\"",
  "",
  "A blank page to start from:",
  "",
  ...PAGE_TEMPLATE.trimEnd().split("\n").map((l) => `  ${l}`),
];

export function pageLines(page: SelfPage, stale: boolean, versions: number): string[] {
  const parts = pageSections(page.body);
  const when = page.revisedOn === "" ? "an unrecorded date" : page.revisedOn;
  const head = [
    `Who I am — ${page.bytes} bytes, version ${page.version}, last revised ${when}` +
      `${page.by === null ? "" : ` by ${page.by}`}${stale ? " — STALE" : ""}.`,
    ...(page.reason === null ? [] : [`Last change: ${page.reason}`]),
    ...(versions === 0
      ? ["No earlier versions yet."]
      : [`${versions} earlier version${versions === 1 ? "" : "s"} — 'self-page --versions'.`]),
    ...(parts.headed ? [] : ["(No `## Core` / `## Lately` headings — printed as it stands.)"]),
    "",
  ];
  return [...head, ...page.body.split("\n")];
}

export function versionLines(
  versions: readonly { seq: number; reason: string; day: number; body: string | null }[],
): string[] {
  if (versions.length === 0) return ["No earlier versions: the page has been written once, or not at all."];
  return [
    `${versions.length} earlier version${versions.length === 1 ? "" : "s"}, newest first.`,
    "",
    ...versions.map(
      (v) =>
        `  ${String(v.seq).padStart(4)}  lived day ${String(v.day).padStart(4)}  ` +
        `${String(v.body === null ? "unreadable" : `${v.body.length} chars`).padEnd(12)} ${v.reason}`,
    ),
    "",
    "One of them in full: 'self-page --version <seq>'.",
  ];
}

/** The body a write is given: a file, or standard input. Never a flag value —
 *  a page on the command line is a page in shell history. */
export function bodyFrom(
  flags: { file?: string | boolean | undefined; stdin?: string | boolean | undefined },
  readStdin: () => string,
): { body: string } | { error: string } {
  const from = typeof flags.file === "string" ? flags.file : null;
  const stdin = flags.stdin === true || typeof flags.stdin === "string";
  if (from !== null && stdin) {
    return { error: "--file and --stdin both name where the page comes from; pass one." };
  }
  if (from === null && !stdin) {
    return { error: "--write needs the page: --file <path>, or --stdin." };
  }
  if (from !== null) {
    try {
      return { body: readFileSync(from, "utf8") };
    } catch (err) {
      return { error: `could not read ${from}: ${String((err as Error).message ?? err)}` };
    }
  }
  return { body: readStdin() };
}

export interface WrittenLines {
  readonly lines: string[];
  readonly ok: boolean;
}

/** What the console says about a write, accepted or not. */
export function writeLines(
  written: ReturnType<Counterpart["revisePage"]>,
  wakeCap: number,
): WrittenLines {
  if (!written.written) {
    const detail =
      written.reason === "observer"
        ? "this console is in observer stance: an instrument reads the page and does not change it."
        : written.reason === "too-large"
          ? `the page is ${written.bytes} bytes, past the hard limit. Refused rather than cut — what gets cut at write time is the only copy.`
          : written.reason === "empty"
            ? "a page has to say something."
            : `the gate battery turned it away${written.gate === null ? "" : ` (${written.gate.gate}: ${written.gate.reason})`}.`;
    return { lines: [`refused: ${detail}`], ok: false };
  }
  return {
    lines: [
      `${written.reason === "created" ? "Wrote" : "Revised"} the page — ${written.bytes} bytes, version ${written.version}.`,
      ...(written.warning === null
        ? []
        : [
            `warning: past the wake's ${wakeCap}-byte cap, so the wake will show a cut of it with a marker. The page itself is kept whole.`,
          ]),
      // The briefing phase is cadenced once per LIVED day, so "the next
      // boundary" is not the whole truth: a boundary that has already rendered
      // today renders nothing, and the page waits. `rebrief` is the lever.
      "It reaches the wake at the next boundary that re-renders it — once per lived day. To put it there now: counterparts rebrief.",
    ],
    ok: true,
  };
}

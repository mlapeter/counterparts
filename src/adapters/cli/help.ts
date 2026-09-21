/**
 * `adapters/cli/help.ts` — the console's map, and the one rule that shapes it.
 *
 * ── The finding ─────────────────────────────────────────────────────────────
 *
 * New-user findings #4 (2026-09-21), in the owner's words: "running help command
 * after installing to verify is clunky, it spits out a ton of help commands with
 * very verbose summarys, basically a wall of text." `counterparts --help` was 129
 * lines of dense paragraphs, and it is the SECOND thing a stranger types — the
 * "did that install work?" check. A wall of text is a bad answer to that
 * question whatever it says.
 *
 * ── The split ───────────────────────────────────────────────────────────────
 *
 * Two pages now, and each answers exactly one question:
 *
 *   - **`counterparts --help` / `help` / no arguments** → this file's
 *     `shortHelp()`: one line of what this is, then every command grouped by
 *     what a person came to do, ONE short line each, and where to go for more.
 *   - **`counterparts help <command>` / `<command> --help`** →
 *     `commands.ts#commandHelp`: that command's blurb, its invocation, the
 *     paragraphs below, and every flag it takes with a sentence each.
 *
 * NOTHING WAS DELETED to make the short page short. Every sentence the old
 * `usage()` carried is either in `COMMAND_BLURB`, in `FLAG_HELP` (so it prints
 * beside the flag it is about), or in `COMMAND_DETAIL` below — the table this
 * file exists to hold. `test/help.test.ts` walks a list of phrases out of the
 * old page and asserts each one still prints somewhere a reader can ask for it.
 *
 * ── Two rules for whoever adds a command next ───────────────────────────────
 *
 *   1. **Every command has a short line here and a page there.**
 *      `test/help.test.ts` walks `COMMANDS` and fails on a command that has
 *      neither, so a command cannot be added without help for it.
 *   2. **The short line is SHORT**: `SHORT_LIMIT` characters of description,
 *      mechanized by the same test. The long version has a place to live.
 *
 * ── No value import from `commands.ts` ──────────────────────────────────────
 *
 * `commands.ts` imports this file, so this one imports nothing but TYPES back
 * (erased at compile time; the same stance `ui.ts` takes). The tables here are
 * keyed by plain strings for that reason, and the totality check that ties them
 * to `COMMANDS` lives in the test, where both sides can be named at once.
 */

/** The longest a short line's DESCRIPTION may be. Mechanized in the test. */
export const SHORT_LIMIT = 60;

/** Where the description starts, after two spaces of indent and the name.
 *  Wide enough that `backfill-claims` — the longest name that fits — still gets
 *  two spaces after it; `repair-merged-beliefs` does not fit and takes its own
 *  line, the shape the old page already used for it. */
const NAME_COLUMN = 17;

/**
 * COMMANDS THIS CONSOLE DOES NOT DISPATCH YET, listed anyway.
 *
 * `wire`, `unwire` and `uninstall` are being built in parallel (new-user
 * findings #1 and #6; the 0.2 install flow's piece A+B). They are listed here so
 * the map a person reads is the map of the console they are about to have, and
 * the coordinator reconciles the wording with the builder who owns them at
 * merge. `test/help.test.ts` holds this list to `COMMANDS` in both directions:
 * a name listed and not dispatched must be HERE, and a name here that HAS
 * arrived must be taken out.
 */
export const PENDING_COMMANDS: readonly string[] = ["wire", "unwire", "uninstall"];

/** One heading and the commands under it, in the order they are printed. */
export interface HelpGroup {
  readonly title: string;
  readonly commands: readonly string[];
}

/**
 * WHAT EACH COMMAND IS, in one line a person can scan.
 *
 * Not a second copy of `COMMAND_BLURB` — a different job. The blurb is the lede
 * of a page somebody has already asked for and can be a sentence long; this is
 * a row in a list of two dozen, and its whole value is that the eye can cross it
 * without stopping.
 */
export const SHORT: Record<string, string> = {
  // ── everyday ──
  status: "What is held, what left, what was removed",
  doctor: "Is the background half alive? Worst first, with fixes",
  recall: "Ask memory a question",
  note: "Remember something, deliberately",
  "self-page": "The written page every session wakes with",
  fired: "Which mechanisms have fired, and which have not",
  // ── setup ──
  install: "Cold start: the store, the config, the credentials",
  wire: "Connect Claude Code to this memory",
  unwire: "Disconnect Claude Code",
  uninstall: "Remove Counterparts from this machine; memory is kept",
  credentials: "Put an API key where the background half reads it",
  scope: "Which directories this memory is for",
  init: "Just a store — a second one, or a scratch one",
  // ── your data ──
  export: "A portable copy, encrypted unless you say otherwise",
  backup: "A snapshot of the prose and the database",
  remove: "Delete one memory for good. Dry run unless --confirm",
  "start-fresh": "Park this store and begin again on a blank one",
  // ── advanced ──
  verify: "Census of the cache against canonical state",
  rebrief: "Re-render and republish the wake bundle now",
  "migrate-cache": "Convert the cache's vectors to float32, in place",
  "backfill-claims": "Give unclaimed authored memories the claimed floor",
  "repair-dates": "Give migrated memories their true learned date",
  "repair-merged-beliefs": "Put back beliefs the dedup pass archived as duplicates",
  "probe-oq4": "Footnotes delivered, and how many were expanded later",
  // `help` is real, dispatched, and printed in the footer rather than in a
  // group: a list of commands whose last entry is "the command that prints this
  // list" reads as a joke at the reader's expense.
  help: "What it does, and every flag it takes",
};

/**
 * THE GROUPS, and they are about the PERSON rather than the architecture.
 *
 * "Everyday" is what somebody does with a memory; "Setup" is the half-hour they
 * spend once; "Your data" is every door out of the store, together, because a
 * person who wants to leave should not have to read the whole page to find out
 * they can; "Advanced" is the maintenance shelf, listed in full — a command that
 * exists and is not written down is a command nobody can ask for.
 */
export const GROUPS: readonly HelpGroup[] = [
  { title: "Everyday", commands: ["status", "doctor", "recall", "note", "self-page", "fired"] },
  {
    title: "Setup",
    commands: ["install", "wire", "unwire", "uninstall", "credentials", "scope", "init"],
  },
  { title: "Your data", commands: ["export", "backup", "remove", "start-fresh"] },
  {
    title: "Advanced",
    commands: [
      "verify",
      "rebrief",
      "migrate-cache",
      "backfill-claims",
      "repair-dates",
      "repair-merged-beliefs",
      "probe-oq4",
    ],
  },
];

/** `  name            description`, with an over-long name on its own line —
 *  the shape the old page already used for `repair-merged-beliefs`. */
function shortLine(name: string): string[] {
  const text = SHORT[name] ?? "";
  if (name.length >= NAME_COLUMN) return [`  ${name}`, `  ${" ".repeat(NAME_COLUMN)}${text}`];
  return [`  ${name.padEnd(NAME_COLUMN)}${text}`];
}

/**
 * The whole console in about forty lines — what `counterparts`, `--help` and
 * `help` all print.
 *
 * The first line is load-bearing in two places: `tools/install-loop/run.sh`
 * greps it to decide whether the install produced a working console at all, and
 * `test/cli.test.ts` asserts it for both `--help` and a bare invocation. The
 * phrase is "the owner's console".
 */
export function shortHelp(): string {
  const lines: string[] = [
    "counterparts — the owner's console for a Counterparts memory store.",
  ];
  for (const group of GROUPS) {
    lines.push("", group.title);
    for (const name of group.commands) lines.push(...shortLine(name));
  }
  lines.push(
    "",
    "Everywhere: --dir <path>   --config <path>   --observer",
    "",
    `counterparts help <command>   ${SHORT["help"] ?? ""}`,
    "Docs: docs/QUICKSTART.md, shipped with the package.",
  );
  return lines.join("\n");
}

/**
 * THE PARAGRAPHS THE OLD `usage()` CARRIED AND NO BLURB OR FLAG SENTENCE DOES.
 *
 * Moved, not rewritten: each entry below is the sentence the 129-line page had,
 * minus whatever `COMMAND_BLURB[command]` or `FLAG_HELP[flag]` already says, so
 * that a reader who asks for one command's page gets everything the old page
 * told them about it and nothing twice. A command absent from this table is one
 * whose blurb and flags already said it all.
 *
 * Pre-wrapped, like the page it came from: these are printed verbatim, so what
 * is written here is what a reader sees at any width.
 */
export const COMMAND_DETAIL: Record<string, readonly string[]> = {
  install: [
    "--dir moves the STORE only. --config <absolute path> moves the CONFIG, the",
    "credentials beside it and the default store beneath it, and the lines this",
    "command prints then carry it.",
  ],
  init: [
    "No host config, no credentials file, nothing under ~/.counterparts/ — that",
    "is what install is for.",
  ],
  verify: [
    "--rebuild refuses while the cache holds embeddings this console has no",
    "embedder to recompute, unless --drop-vectors says to lose them or",
    "--keep-vectors says to leave every one of them where it is.",
  ],
  "migrate-cache": [
    "--apply needs the store NAMED by --dir — never the default, and never",
    "resolved from COUNTERPARTS_DATA_DIR — and asks unless --yes.",
  ],
  "repair-dates": [
    "It reads the evidence each row already holds: an engram-era id that is a",
    "millisecond timestamp, a v1 date field, a session reference, a source path.",
    "It prints counts by confidence and a sample of the proposed dates.",
    "--apply needs the store NAMED by --dir, never resolved for it: this is the",
    "one owner operation that rewrites thousands of canonical documents.",
  ],
  credentials: [
    "The value never touches your shell history and is never printed back.",
  ],
  rebrief: [
    "It advances no sleep marker and runs no other sleep phase.",
    "",
    "It needs an injection ceiling, and says which of these gave it one:",
    "--budget <bytes>, else the config named by --config / $COUNTERPARTS_CONFIG,",
    "else <dir>/../claude-code.json (beside the store), else",
    "~/.counterparts/claude-code.json (where the hooks read). Never a config",
    "INSIDE the data dir — that store stops opening (§5 G11).",
  ],
  "probe-oq4": [
    "recall CONTRACT §7. The footnote header is the one string the probe varies",
    "(recall/render.ts).",
  ],
  fired: [
    "One line each, SILENT FIRST: when it last fired, how many times in the last",
    "7 days, what it turned away, and — for the ones nothing durable records —",
    "which row would fix that.",
  ],
  "self-page": [
    "With no flags it prints the page, its size, its version and the date it was",
    "last revised, and says when that has gone stale. A page written here reaches",
    "the wake at the next boundary (or 'rebrief').",
  ],
  scope: [
    "With a mode flag it writes <config dir>/scopes.json; with none it says what",
    "the directory resolves to and which entry decided.",
  ],
  help: [
    "With no command it prints the short map — the same page `counterparts",
    "--help` and a bare `counterparts` print. With one, that command's own page:",
    "`counterparts help doctor` and `counterparts doctor --help` are the same",
    "page. It opens no store and reads no configuration.",
  ],
  // WIRING, UNINSTALL: placeholders. The builder who owns those commands
  // replaces these two entries with the real text, and the coordinator
  // reconciles at merge (see `PENDING_COMMANDS`).
  wire: [
    "It edits the host's own settings: it shows what it will add, backs the file",
    "up first, and merges beside any hooks already there.",
  ],
  unwire: [
    "It takes out what `wire` put in and leaves everything else in the file",
    "alone. Your memory is not touched.",
  ],
  uninstall: [
    "It unwires the host, then says how to remove the package — a program cannot",
    "cleanly delete itself. ~/.counterparts is left exactly where it is unless",
    "you say otherwise.",
  ],
};

/**
 * The console-wide facts the old page's footer carried, printed at the foot of
 * every command's page.
 *
 * They belong on a page about ONE command because they are true of that command:
 * whether it runs under observer, and whether it will ask before it acts, are
 * questions a reader has while looking at exactly that page.
 */
export const CONSOLE_FOOTER: readonly string[] = [
  "Any other flag is refused before the store is opened.",
  "Owner operations never run under observer, and removal is the only one that",
  "asks for a human (CONTRACT §5 G12: owner-in-the-loop is a short, named list).",
];

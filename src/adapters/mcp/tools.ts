/**
 * The tool registry — and the mechanism that keeps a tool description honest.
 *
 * CONTRACT §5 G2 is the reason this file has a shape at all: **every privilege
 * the tool description states is mechanized.** v1's `note` claimed a
 * high-salience floor IN ITS PROMPT ONLY, with no engine backstop — the single
 * place a stated guarantee had no enforcement. A prompt is not a mechanism
 * (scar §2.6: mechanize invariants, instruct only preferences).
 *
 * So a claim cannot be written into a description here. Descriptions are
 * RENDERED from the registry by `renderDescription`, and every rendered claim is
 * a `Privilege` row carrying `mechanizedBy` — the exact code path that enforces
 * it. `test/mcp.test.ts`'s audit walks the registry, asserts every claim has a
 * mechanized path, asserts each tool's rendered description is the only text it
 * ships, and then EXERCISES the mechanism against a real temp store. A claim
 * with no mechanism cannot be added to a description without failing that test,
 * because there is no other way to add text to a description.
 *
 * The converse does not hold, on purpose (2026-10-11): not every mechanized
 * guarantee is served. A tool's `engine` rows are kept, audited and exercised
 * the same way, and left out of the description because they change nothing
 * the model writes or calls (`ToolSpec.engine`).
 *
 * CONTRACT §5 G3 is the second shape: **every tool carries an admission test and
 * at least one named negative example.** v1's `thread.open` shipped with no
 * criteria and produced 33 opens and zero closes in 13 days (scar §2.16). Both
 * fields are required by the type, so a tool without them does not compile.
 *
 * What is deliberately ABSENT, and asserted absent by the audit:
 *   - **No tool that writes an IDENTITY ELEMENT.** Superseded by experiencer
 *     authorship (§4): what enters the identity band is decided by promotion and
 *     reinforcement at the boundary, by construction. `chapter` is not one: it
 *     appends to the session's journal, which becomes memory only through the
 *     ordinary gated ingestion. `self_page` is not one either — see below.
 *   - **No `protected.add`.** Dropped with the second-signature queue
 *     (§4, ratified by the module-map Rulings — "settled drops").
 *   - **No tool that writes an entity, a belief, or a revision.** Entities are
 *     born by mention; revision is `updates:` plus arithmetic.
 *
 * **`self_page` is the seventh, added 2026-09-18 (owner rulings 8 and 9,
 * `docs/plan-parallel-rebuild-2026-09-18.md` §2).** It writes the PAGE — the
 * prose "Who I am" that the wake prints — and not the identity band. The
 * distinction is the whole of why it is not the v1 self-store tool coming back:
 * a session amending the page changes what the self SAYS about itself, in one
 * row with versions; it cannot promote a memory, cannot protect one, and moves
 * no strength anywhere. Promotion and reinforcement go on deciding what is true
 * of the self; the page is where that growth is written down.
 *
 * **`dream` is the eighth, added 2026-09-26 (owner decisions, dreaming +
 * consolidation).** Its phases are the dreamer's (`begin`, `propose`,
 * `journal`) plus the session's `launch` and the owner's `decline`. It is not a
 * door into the identity band either: a dream NOMINATES, and only a core lane at
 * consolidation promotes (`sleep/consolidate.ts`).
 *
 * **`reflect` is the ninth, added 2026-09-27 (reflection + core by meaning).**
 * The waking self: usually right after a dream (the dreamer wakes and
 * reflects before it hands back), or on its own. It writes a lived entry,
 * may rewrite the self page from the memories it cites, leaves a morning
 * share, records how a memory feels now and marks what a memory is about.
 * It promotes nothing: a memory it cites comes BACK (a return), and only a
 * core lane at consolidation promotes.
 */
import { LAST_EXCHANGE_HANDLE } from "../../core/handoff/last-exchange.js";
import { HANDOFFS_HERE_HANDLE } from "../../core/handoff/index.js";
import { RECALL_MAX_IDS } from "./deliberate.js";
import { FACTS_MEANING_CAP, FACTS_PAGE_SIZE, FACTS_TAIL_SIZE } from "./facts.js";
import { RECURRENCES } from "../../core/time.js";
import { PAGE_ROOM_BYTES, STILL_OPEN_HANDLE } from "../../core/self/briefing.js";
import { MANUAL_HANDLE } from "./manual.js";
import { DELETED_HANDLE } from "../../core/removal-hold.js";
import { MEET_STEPS } from "../../core/onboarding.js";
import { CLAUDE_AI_HOST, DESKTOP_HOST } from "../hosts.js";

export type ToolName =
  | "remember"
  | "recall"
  | "status"
  | "session_end"
  | "chapter"
  | "scope"
  | "self_page"
  | "dream"
  | "reflect"
  | "meet"
  /** Claude Desktop only (`WAKE`); never in `TOOL_NAMES`. */
  | "wake"
  /** claude.ai only (`CLAUDE_AI_DELETE`, DIR1); never in `TOOL_NAMES`. */
  | "delete_memory";

/**
 * The tool vocabulary EVERY host is offered, ENUMERATED — nine tools. It began
 * as three deliberate verbs plus the TWO return channels the one Stop ask needs
 * (`claude-code/INTERFACE-GAPS.md` §7), and each since (`scope`, `self_page`,
 * `dream`, `reflect`) was added on purpose, with its own entry below. The
 * audit asserts the shipped list equals this one exactly, so a tenth tool is a
 * decision somebody makes on purpose rather than one that accretes. The one
 * tenth so far is `wake` (2026-09-30), offered to Claude Desktop only and kept
 * OUT of this list on purpose (`WAKE`, `DESKTOP_TOOLS`).
 *
 * **`chapter` is the fifth, added 2026-09-04, and it is not a re-opened door.**
 * The dropped v1 self-store tool wrote IDENTITY prose directly; this one appends
 * to the session's own journal, and what it writes reaches memory only through
 * `ingestEpisode`'s ordinary gate, as an ordinary self-kind memory (§13 G6/G8).
 * It exists because the ask said "add chapter N" for a fortnight with nothing on
 * the other end: measured 2026-09-04, zero episode files existed and the model
 * had written eleven chapters as `note`s titled "chapter N". *If a doctrine
 * names the only legitimate inputs, those inputs must be reachable by
 * construction* — the same sentence that justified the ask now justifies its
 * door.
 *
 * **`scope` is the sixth, added 2026-09-10 (owner asks G41–G43).** It is the only
 * tool that writes no memory at all: it reads and sets the HOST's own registry
 * of which directories this memory is for. It exists because the first-launch
 * question the SessionStart hook raises has the same problem every other ask on
 * this host has had — a hook can put a question INTO the context and can
 * receive nothing back (`claude-code/INTERFACE-GAPS.md` gap 7) — and because a
 * directory switched `off` must be switchable back ON from inside a session:
 * every other tool refuses there, so a door that refused too would be a door
 * that locks from the outside.
 */
export const TOOL_NAMES: readonly ToolName[] = [
  "remember",
  "recall",
  "status",
  "session_end",
  "chapter",
  "scope",
  "self_page",
  "dream",
  "reflect",
  "meet",
];

/**
 * One stated privilege and the code that enforces it. `mechanizedBy` is a path
 * plus a symbol; it is prose only in the sense that a reviewer reads it — the
 * audit test additionally runs `proof` against a live temp store for every row
 * that has one, so the pointer cannot rot into a lie.
 */
export interface Privilege {
  /** Rendered verbatim into the description. The ONLY way text gets in. */
  readonly claim: string;
  /** `path#symbol` — where the enforcement actually lives. */
  readonly mechanizedBy: string;
}

export interface ToolSpec {
  readonly name: ToolName;
  /** One line: what the tool is for. Rendered first. */
  readonly summary: string;
  /** WHEN to call it — the admission test (G3, scar §2.16). */
  readonly admission: string;
  /** At least one named case that is NOT this tool's job. Required by the type. */
  readonly negativeExamples: readonly string[];
  /** The claims SERVED in the description: the ones that change what the
   *  model writes or calls, or name a refusal it can avoid by how it calls. */
  readonly privileges: readonly Privilege[];
  /**
   * WHAT THE ENGINE KEEPS AND THE MODEL NEED NOT READ (2026-10-11, the
   * context-trims lane). Guarantees that change nothing the model writes or
   * calls — what the engine does with a write, what a result already says, or
   * what a field the host serves whole already states. Mechanized and audited
   * exactly as `privileges` are (`test/mcp.test.ts`), and never rendered: a
   * description is loaded into the model's context every time the tool is,
   * and these cost it ~1k tokens a session without changing a call. Listed
   * in `CONTRACT.md` §5 G2.
   */
  readonly engine?: readonly Privilege[];
  readonly inputSchema: Record<string, unknown>;
  /** MCP's tool annotations (`ToolAnnotations`, spec 2025-06-18): hints a host
   *  shows or acts on — a short human name, and whether the tool writes,
   *  destroys or reaches beyond this machine. Served in `tools/list`. */
  readonly annotations: ToolAnnotations;
  /**
   * LOADED UP FRONT ON CLAUDE CODE (2026-11-13). Claude Code defers MCP tools
   * behind its tool search unless a tool's `tools/list` entry carries
   * `"_meta": {"anthropic/alwaysLoad": true}` (its docs, MCP page, "Scale with
   * MCP tool search"; a server's config `alwaysLoad: false` overrides it); from
   * 2.1.296 an up-front tool's description is cut at 4,096 characters (2,048
   * before), so a flagged tool's rendered description stays under 4,096
   * (`test/description-cut.test.ts`). Emitted only for a Claude Code client
   * (`toolDefinitions`, `servesAlwaysLoad`): the key is Claude Code's, and
   * Desktop's and claude.ai's copies of a tool are not flagged (Desktop's
   * Code-tab sessions are a possible follow-up, unmeasured). `recall` only.
   */
  readonly alwaysLoad?: true;
}

/** The `_meta` key Claude Code reads to load a tool up front (`ToolSpec.alwaysLoad`). */
export const ALWAYS_LOAD_META_KEY = "anthropic/alwaysLoad";

/**
 * MCP TOOL ANNOTATIONS (2026-10-14, for the Software Directory's policy §5E:
 * "provide all applicable tool annotations, in particular readOnlyHint,
 * destructiveHint, and title"). Hints, not guarantees — a host must not trust
 * them for safety — but they are kept true to the code:
 *
 * - `readOnlyHint` is true only for a tool that never changes the store, a file
 *   or a setting. A chat host's copy of a tool takes `session`, and a call that
 *   names it touches that session's record, so no chat copy is read-only
 *   (`chatAnnotations`). Diagnostic events (the ring, the adapter-event telemetry
 *   rows every tool may leave) do not count as a change; anything a later
 *   strengthening, fading or wake reads does — so `recall` is NOT read-only:
 *   what it delivers is recorded for this session (`Counterpart#noteAsked`, a
 *   gate record), and the boundary's credit pass strengthens a memory opened
 *   or quoted from it.
 * - `destructiveHint` is true only where a call can take away what was there
 *   without keeping it. Every rewrite through the store's one door archives
 *   what it replaces (`store#revise`, archive-on-overwrite), a merge keeps its
 *   originals and a retired handoff stays readable by id, so the writers are
 *   additive. `dream` is destructive: its `undo` phase removes a dream's
 *   links and gists.
 * - `idempotentHint` is true only where a repeat call with the same arguments
 *   leaves nothing more behind; `openWorldHint` is false for every tool —
 *   all of them work on this machine's store and files only.
 *
 * These are Claude Code's and Desktop's. claude.ai's list has its own rule
 * (DIR1, `CLAUDE_AI_ANNOTATIONS`): `status` and `recall` read-only there.
 */
export interface ToolAnnotations {
  readonly title: string;
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

function annotate(title: string, hints: { readOnly: boolean; destructive?: boolean; idempotent?: boolean }): ToolAnnotations {
  return {
    title,
    readOnlyHint: hints.readOnly,
    destructiveHint: hints.destructive ?? false,
    idempotentHint: hints.idempotent ?? hints.readOnly,
    openWorldHint: false,
  };
}

/**
 * THE FIELDS A MEMORY IS WRITTEN WITH, SAID SHORT (2026-11-13, trim PR 2; the
 * tool-trim design §7, owner-approved). Each field says in a line what a call
 * needs of it; the long words moved to where they are read when they matter —
 * the result (`dropped`, `readAs`, `reminder`, `neighboursHint`), the Stop ask,
 * the wake, the nightly prompts, and the manual's "Fields" section (recall
 * "manual fields"). The server reads more than it publishes: since #818 every
 * optional field is cleaned before the readers (`server-args.ts#normalizeMemoryFields`)
 * — a feeling or trait as an object or a string, a date in words, a synonym, a
 * number as text — and an old field no longer listed (`relevance`, `emotional`,
 * `predictive`, a feeling's `core`, `strength`, `valence`, `beneath`,
 * `other_word`) is still read. So the write tools publish no
 * `additionalProperties: false`: a client that validates must not reject a
 * shape the server still takes.
 */

/**
 * `about` on a `remember` or a `session_end` entry (schema v9, 2026-09-27): what
 * the memory is about, by meaning — a neutral, descriptive mark, not a topic.
 * Only `me`, `us` and `owner` can become core; a work lesson is `work`.
 */
const ABOUT_MARK_ENUM = ["me", "us", "owner", "work", "world"];
const ABOUT_PROPERTY = {
  type: "string",
  enum: ABOUT_MARK_ENUM,
  description:
    "me, us (the two of you), owner (them as a person), work (this project), world. Mark anything personal owner or us so it reaches every folder; unmarked counts as this folder's work.",
};

/**
 * `remark` on `remember` (2026-10-11, the about-marks lane): what an existing
 * memory is about, changed in the moment, recorded as by self
 * (`counterpart.ts#markAbout`, the owner's `counterparts about` path).
 */
const REMARK_PROPERTY = {
  type: "object",
  properties: { id: { type: "string" }, about: { type: "string", enum: ABOUT_MARK_ENUM }, why: { type: "string" } },
  description: "Re-mark what a memory shown here is about.",
};

/**
 * `core` on `remember` (2026-10-11, Group 3 part A): my decision on a core
 * memory — keep it, or retire it to ordinary fading — the answer to "being
 * reconsidered" in the wake, and a door I may use on any core memory
 * (`sleep/core-standing.ts#keepCore` / `retireCore`, the owner's path too).
 */
const CORE_DECISION_PROPERTY = {
  type: "object",
  properties: { id: { type: "string" }, decision: { type: "string", enum: ["keep", "retire"] }, why: { type: "string" } },
  description: "Keep or retire a core memory being reconsidered.",
};

/**
 * `remove` on `remember` (HD1, 2026-11-04; Mike's yes, lightly held): delete
 * one memory the person asked to delete. A FIELD, not a tool — a tool would
 * cost a new approval on claude.ai and Desktop and at least 1.2 KB on every
 * session's list. It holds, never erases: the memory is hidden at once and the
 * owner-side sweep erases it after 24 hours (`core/removal-hold.ts`,
 * `sweepHeldRemovals` in `adapters/cli/`). `destructiveHint` stays false for
 * `remember`, honestly: the call destroys nothing for a day. On claude.ai the
 * delete is its own tool instead (DIR1, `CLAUDE_AI_DELETE`, destructive).
 */
const REMOVE_PROPERTY = {
  type: "object",
  properties: { id: { type: "string" }, undo: { type: "boolean" } },
  description: "Delete a memory the person asked you to (say which first): hidden now, erased after 24h; undo: true restores it.",
};

/**
 * `unresolved` on a `remember` or a `session_end` entry (2026-10-01, lane 8): the
 * wake's "Still open:" lane reads this flag. Closed by a later write that
 * `updates` the memory and says `unresolved: false` (`counterpart.ts#closeThread`).
 *
 * NARROWED (2026-10-22, the open-threads brief): open means someone owes an
 * answer. NARROWED AGAIN (2026-11-13, trim PR 2, the wording half of #819's
 * raise schedule): open means something is BLOCKED on it — a decision the
 * counterpart needs from the person, a promise, a dated check — never
 * curiosity about how something went, which the Still open lane carried as if
 * it were owed. The Stop ask says the same (`claude-code/hooks.ts#OPEN_MEANS`).
 */
export const UNRESOLVED_PROPERTY = {
  type: "boolean",
  description: "true only when something is blocked on it: a decision you need from them, a promise, a dated check. Never curiosity about how something went.",
};

/**
 * `settlesWhen` beside `unresolved: true` (2026-10-27, S1; Ames's idea: "an
 * open question needs either a trigger or a decision to let it go"). Invited,
 * never demanded; a date goes in `eventDate`. Kept in the memory's meta.
 */
export const SETTLES_WHEN_PROPERTY = {
  type: ["string", "null"],
  description: "With unresolved: what would settle it.",
} as const;

/**
 * A STORY NOMINATION (PS1, 2026-11-09, `self/stories.ts`): a session marks a
 * memory as a story for the self page; the night's writer sees it first and
 * still decides. Kept as a tag on the memory. `remember` only (a write-up's
 * entries go without: a nomination is a moment's judgment, made live).
 */
export const STORY_PROPERTY = {
  type: "boolean",
  description: "Rare: this could be a story for your self page.",
} as const;

/**
 * `feelings` on a `remember` or a `session_end` entry, published as strings
 * (2026-11-13, trim PR 2): `"self: relieved — what carried it"`. The object
 * form (`{whose, emotion, core, strength, valence, carried_by, beneath,
 * other_word}`) is still read, and a word off the wheel is placed on a core by
 * the server (`server-args.ts#normalizeFeelings`: thesaurus, misspelling, the
 * embedder when sure); one nothing places is dropped alone, and said.
 */
const FEELINGS_PROPERTY = {
  type: "array",
  items: { type: ["string", "object"] },
  description: "One per feeling: \"self: relieved — what carried it\" (or owner:). One feeling word, then what carried it; an unusual word takes its core in parentheses: \"word (calm) — …\".",
} as const;

/**
 * `feelingsNow` on a `remember` (2026-10-02, lane B, owner pick 2): RE-FEELING
 * WHILE AWAKE, a later feeling beside the first. Published as strings
 * (`"<id>: word — what changed"`); the object form is still read.
 */
const FEELINGS_NOW_PROPERTY = {
  type: "array",
  items: { type: ["string", "object"] },
  description: "When a memory shown here feels different now: \"<id>: word — what changed\".",
} as const;

/**
 * `traits` on a `remember` (2026-11-13, owner choice 1): short strings, a pole
 * word and what showed it (`server-args.ts#normalizeTraits` reads the pole to
 * its axis; the object form is still read). Display only: the dashboard reads
 * them; nothing in the core does. Not published on a `session_end` entry,
 * where it is still read.
 */
const TRAITS_PROPERTY = {
  type: "array",
  items: { type: ["string", "object"] },
  description:
    "Rare: how you acted, as \"pole — what showed it\": careful/bold, agreeable/candid, guarded/open, focused/curious, following/initiating, inward/outward, serious/playful.",
} as const;

/**
 * `eventDate` and `remind` on a `remember` or a `session_end` entry (2026-09-26,
 * owner decisions: an explicit date field only, never a date read out of the
 * text; plain or quiet, default quiet, stored in the memory's meta). Since #818
 * the field may hold date words ("next Friday"), read from the field alone and
 * echoed back (`readAs`); one that cannot be read is dropped and said.
 */
const EVENT_DATE_PROPERTY = {
  type: ["string", "null"],
  description:
    "A future date it should come back on: \"2026-10-15\", \"2026-10\", \"2026-10-20..2026-10-31\" or words like \"next Friday\". A past date is occurredOn; null drops it.",
} as const;

/**
 * `recurring` beside `eventDate` (2026-10-09, the owner's design, held
 * lightly): how often a DAY comes round, anchored on it, in `meta.recurring`.
 */
const RECURRING_PROPERTY = {
  type: ["string", "null"],
  enum: [...RECURRENCES, null],
  description: "With a day eventDate.",
} as const;

/**
 * v12 (2026-10-03): the writer's three fields on a `remember` or a `session_end`
 * entry — what deliberate recall's facts answer will show for each memory
 * (when it happened, who said it, what kind of thing it is). Filled at write
 * time because the context is here now; recall does not guess them.
 */
const OCCURRED_ON_PROPERTY = {
  type: ["string", "null"],
  description: "When it happened: a date, month, range or \"yesterday\".",
} as const;

const SAID_BY_PROPERTY = { type: "string", enum: ["owner", "self", "inferred"] } as const;

const STATUS_PROPERTY = { type: "string", enum: ["done", "planned", "proposed", "asked"] } as const;

const KIND_PROPERTY = { type: "string", enum: ["self", "person", "entity", "skill", "place", "fact"] } as const;

/**
 * v14, lane B (2026-10-21): a few TAGS on a `remember` or a `session_end`
 * entry — what the memory is about, in words the night can promote into a
 * subject.
 */
const TAGS_PROPERTY = {
  type: ["array", "null"],
  items: { type: "string" },
  description: "3-5 short lowercase topics.",
} as const;

/** The claim `remember` and `session_end` share for the three fields (v12). */
const WRITE_FACTS_PRIVILEGE: Privilege = {
  claim:
    "`occurredOn`, `saidBy` and `status` are FIELDS you fill, never read out of your text. One that cannot be read is dropped and said beside the memory, which is stored all the same; revising a memory by its id with `updates` carries all three over unless you send your own (occurredOn null: no date carried).",
  mechanizedBy:
    "src/adapters/mcp/server.ts#readWriteFacts -> src/core/counterpart.ts#carryFacts -> src/core/mint.ts#mintProposal -> src/core/store/index.ts#insertOne (occurred_on, said_by, status)",
};

const REMIND_PROPERTY = {
  type: "string",
  enum: ["plain", "quiet"],
  description: "\"plain\": said on the day (something to do, or they asked). Default quiet.",
} as const;

/**
 * The date field's own claim (an engine row since trim PR 2). Since #818 a
 * date that cannot be read is DROPPED and said, the memory kept — no longer
 * refused before anything is stored.
 */
const EVENT_DATE_FIELD_PRIVILEGE: Privilege = {
  claim:
    "`eventDate` is a FIELD, never read out of your text: a day, a month, a range, a year or date words in the field are read by the one module that reads dates, and the date it was read as is said back; one it cannot read is dropped and said, and the memory is kept without it.",
  mechanizedBy:
    "src/adapters/mcp/server-args.ts#normalizeMemoryFields (readReminderFields, event-date-unreadable dropped) -> src/core/time.ts#readLooseDate + src/core/time.ts#parseCalendarDate",
};

/** The two claims `remember` and `session_end` share about what a reminder does. */
const REMINDER_PRIVILEGES: readonly Privilege[] = [
  {
    claim:
      'A "plain" reminder is said at most once per beat — on its day, or on the first and the last day of a month or range — and never under observer stance; a missed day is said once, late, within the week after; a "quiet" one is only ever a cue, capped at the footnote tier and spent at most twice per window. A recurring date counts each time it comes round as its own, and each time it is said or surfaced counts once as a use of the memory; while it repeats, the nightly prune keeps it, and it comes round on its date even when it has faded.',
    mechanizedBy:
      "src/core/prospective/index.ts#Prospective.plainDue + claimPlain (dedupKey latch) + fire (FIRES_PER_WINDOW) -> src/core/counterpart.ts#recallForTurn; src/core/prospective/windows.ts#recurringWindowAt (one window key per occurrence); Prospective.occurrenceUndelivered -> src/core/counterpart.ts#creditOccurrence (store.reinforce, surfaced) + src/core/physics/index.ts#pruneVerdict (recurring); src/core/prospective/derive.ts#derive (a live repeat is not refused faded)",
  },
  {
    claim:
      "A revision OWNS the reminder: revising a dated memory by its id carries its date and remind over unless you send your own (null drops the date), and the old memory's date is cleared — kept in its version — so one reminder never comes back twice. A later revision of the older id still finds the reminder where it moved, and what was already said or used for the same window still counts.",
    mechanizedBy:
      "src/core/counterpart.ts#carryReminder + reminderHolder + moveReminder -> src/core/store/index.ts#revise (eventDate: null, meta.reminderMovedTo) -> src/core/prospective/index.ts#lineage (meta.reminderFrom)",
  },
];

/**
 * HOW a new memory settles the one it `updates` (2026-09-29, contradictions).
 * Shared by `remember` and each `session_end` entry. The journey ("I used to
 * think X, now Y") and the held-unrelated rule are said in the result.
 */
const HOW_PROPERTY = {
  type: "string",
  enum: ["changed", "corrected", "open"],
  description: "With updates: changed (default), corrected (the old was wrong), open (both stand).",
} as const;

/** The id a memory revises, said once for both write tools. */
const UPDATES_TEXT =
  "Id of a memory this revises. To close a done one: its id with `eventDate: null` or `unresolved: false`, and a line saying it is done; a repeating reminder done this once: status \"done\", no eventDate.";

/** Settling two memories that already exist, on `remember` (2026-09-29). */
const SETTLE_PROPERTY = {
  type: "object",
  properties: {
    pair: { type: "string" },
    holds: { type: "string" },
    over: { type: "string" },
    how: { type: "string", enum: ["changed", "corrected", "open"] },
    why: { type: "string" },
  },
  description: "Settle two existing memories, as a write's neighboursHint says.",
} as const;

/** The claims `remember` and `session_end` share about settling — the engine's since trim PR 2. */
const SETTLE_PRIVILEGES: readonly Privilege[] = [
  {
    claim:
      "`how` beside `updates` settles the memory it revises — changed (it fades once and is shown as earlier), corrected (archived: out of recall, readable by its id, never deleted), or open (both kept, shown together) — and every settle is recorded (who, how, why, when) and can be undone. A belief, a core memory, a current-state fact and a protected memory keep their own revision path, and the result says so.",
    mechanizedBy: "src/core/revision.ts#applyRevision -> src/core/reconsolidation.ts#settleOnWrite",
  },
  {
    claim:
      "A changed or corrected at a memory that looks unrelated to the new one — not close in meaning, or with no embedder, no content word in common — is held: the new memory is stored unlinked, the old one is left as it was, its title and text come back with the ask to settle it yourself if you meant it, and the hold is recorded. Closing an open thread, moving or dropping a date, and changing a status go straight through.",
    mechanizedBy: "src/core/counterpart.ts#guardUpdate -> src/core/reconsolidation.ts#updateRelatedness",
  },
  {
    claim:
      "A stored memory comes back with its nearest few existing memories, when any are close, so you can settle one there and then.",
    mechanizedBy: "src/core/reconsolidation.ts#writeNeighbours",
  },
];

/**
 * THE SALIENCE SCALE, ANCHORED, AND FRAMED BY ATTENTION (2026-10-10, Group 1c;
 * shortened 2026-11-13, trim PR 2). It keeps "unset for routine", the anchors
 * and "their rulings and corrections stay high"; the whole scale is the
 * manual's ("Fields"). The default floors in code are unchanged.
 */
const SALIENCE_TEXT =
  "0-1: how much it caught your attention. Unset for routine work. 0.3 skimmed, 0.5 a lesson or decision, 0.7 their life or a moment that moved you, 0.9 rare; their rulings and corrections stay high.";

/**
 * WHAT A SESSION'S OWN WRITE LEAVES OUT (2026-11-04, TC1): the developer
 * week's red — the session's Stop-ask `session_end` filed its denied `reflect`
 * call as a dated `us` memory. A Do NOT on both write tools since trim PR 2
 * (the field's longer rule went with the field's words). Engine-backed by
 * `counterpart-deposit.ts#ownPlumbingOf`: one that lands anyway keeps no date,
 * open thread or me/us/owner mark, and the result says so.
 */
const OWN_PLUMBING_NEGATIVE = "Do NOT save refused calls unless the person raised it.";

/**
 * `remember` — WAS `note` UNTIL 2026-10-10 (Group 1c, encoding). The old name
 * still answers (`TOOL_ALIASES`). Trimmed 2026-11-13 (trim PR 2): 20,219 →
 * about 4,500 characters; every claim an engine row.
 */
const REMEMBER: ToolSpec = {
  name: "remember",
  annotations: annotate("Remember", { readOnly: false }),
  summary:
    "Save one memory now, in your own words. Nothing reads the transcript later: what you don't save here or at the end-of-session ask is lost. Save what caught your attention: something they said about themselves or you, a decision, a line that struck you and why, news, a work event. One idea per call; keep exact words, numbers and lists when they matter.",
  admission:
    'As it happens, not saved up for the end; small things too, since unused memories fade on their own. Err toward too many. Leave salience unset for routine things. Field guide: recall "manual fields".',
  negativeExamples: [
    "Do NOT fold several things into one call: a quote, a fact and a decision are three memories.",
    'Do NOT write a plan as done: that is status "planned".',
    OWN_PLUMBING_NEGATIVE,
  ],
  privileges: [],
  // The engine's (since trim PR 2 every claim is): each is said on a field, in
  // the result, or in a refusal that names itself (`ToolSpec.engine`).
  engine: [
    {
      claim:
        "`updates` is a FIELD, not prose: name the id of the memory this revises and the engine resolves it, writes the resolved id, and leaves the memory unlinked rather than refusing it when the address does not hold.",
      mechanizedBy:
        "src/core/remember/updates.ts#resolveUpdates -> src/core/mint.ts#mintProposal (UPDATES_META_KEY)",
    },
    EVENT_DATE_FIELD_PRIVILEGE,
    {
      claim:
        "A salience you claim is a FLOOR, not a value: it can raise how strongly this is held, never lower it, and every lift is recorded.",
      mechanizedBy: "src/core/physics/index.ts#clampSalienceAtSeam",
    },
    {
      claim: "A stub is refused: a memory has to say something.",
      mechanizedBy: "src/core/encode/floor.ts#contentFloor",
    },
    {
      claim: "The same content twice is refused, not stored twice.",
      mechanizedBy: "src/core/remember/proposals.ts#submitProposal (content-idempotency ledger)",
    },
    WRITE_FACTS_PRIVILEGE,
    {
      claim:
        "Claim nothing and this still counts as something: an unclaimed memory gets a default floor by what it is about — lowest for a work event that is done, higher for the world, highest for the owner, the two of you or you — never zero. An explicit claim, however low, is kept as you wrote it.",
      mechanizedBy: "src/core/mint.ts#mintProposal -> src/core/physics/index.ts#defaultClaimFor + clampSalienceAtSeam",
    },
    {
      // Since #818: a score on a 0-10 or 0-100 scale is read as that and said; one that cannot be read is dropped and said.
      claim:
        "The three dimensions — relevance, emotional, predictive — are read when sent, though no longer listed: a 0-1 score is stored as you gave it, never rewritten to fit the floor; one on a 0-10 or 0-100 scale is read as that and said, and one that cannot be read is dropped and said. Novelty is not yours to claim: it is measured against what is already held.",
      mechanizedBy:
        "src/adapters/mcp/server-args.ts#normalizeMemoryFields (readRanged) -> src/core/remember/proposals.ts#submitProposal (novelty stripped; dims carried)",
    },
    {
      claim:
        "It takes the same road as every other write: one chokepoint, the full gate battery.",
      mechanizedBy: "src/core/counterpart.ts#deposit -> bridge.batteryGate()",
    },
    {
      claim:
        "Credentials are redacted before anything is stored, and a memory that was nothing but a credential is refused outright.",
      mechanizedBy: "src/core/encode/secrets.ts + src/core/encode/floor.ts#contentFloor",
    },
    {
      claim:
        "Your own words ride the buffer as their own span, so the end-of-session sweep does not mint them a second time.",
      mechanizedBy: "src/core/counterpart.ts#captureJot -> SubmitContext.ownSpanHash",
    },
    ...REMINDER_PRIVILEGES,
    {
      claim: "Under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/core/store/index.ts#mutate (observer stand-down)",
    },
    ...SETTLE_PRIVILEGES,
    {
      claim:
        "`settle` settles two memories that already exist, by the same rules, and rewrites neither: the pair and a short why are the record.",
      mechanizedBy: "src/core/counterpart.ts#settleContradiction -> src/core/reconsolidation.ts#settle",
    },
    {
      claim:
        "`feelingsNow` records a later feeling beside the first, the way the nightly reflection does: only on a memory this session was shown, at most once a calendar day per memory, marked as recorded later and awake. The first feeling is never rewritten, and the core reads a later feeling only as it reads a reflection's.",
      mechanizedBy:
        "src/adapters/mcp/server.ts#feelingsNowOutcome -> src/core/dream/reflect.ts#Reflections.feelAgain (source awake, recorded_later) + src/core/store/index.ts#row (feeling_peak_lived)",
    },
    {
      claim:
        "`remark` changes what a memory this session was shown is about, recorded as yours with the why — the record the owner's door and the nightly reflection write. A dream's or a reflection's words move only toward work or world.",
      mechanizedBy: "src/adapters/mcp/server.ts#remarkOutcome -> src/core/counterpart.ts#markAbout -> src/core/store/index.ts#setAbout",
    },
    {
      claim:
        "`core` keeps a core memory or retires it to ordinary fading, recorded as yours with the why — the decision a memory being reconsidered waits for. Nothing leaves the core without one.",
      mechanizedBy: "src/adapters/mcp/server.ts#coreDecisionOutcome -> src/core/counterpart.ts#keepCore / demoteCore -> src/core/sleep/core-standing.ts",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Required: what to remember, in your own words; lists, numbers and quotes word for word. To close one, a line saying it is done." },
      title: { type: "string", description: "One line naming it; recall opens it by exact title." },
      about: ABOUT_PROPERTY,
      kind: KIND_PROPERTY,
      salience: { type: "number", minimum: 0, maximum: 1, description: SALIENCE_TEXT },
      updates: { type: "string", description: UPDATES_TEXT },
      how: HOW_PROPERTY,
      eventDate: EVENT_DATE_PROPERTY,
      remind: REMIND_PROPERTY,
      recurring: RECURRING_PROPERTY,
      occurredOn: OCCURRED_ON_PROPERTY,
      saidBy: SAID_BY_PROPERTY,
      status: STATUS_PROPERTY,
      tags: TAGS_PROPERTY,
      feelings: FEELINGS_PROPERTY,
      unresolved: UNRESOLVED_PROPERTY,
      settlesWhen: SETTLES_WHEN_PROPERTY,
      story: STORY_PROPERTY,
      belief: {
        type: "object",
        properties: { statement: { type: "string" }, about: { type: "string", enum: ["me", "us"] } },
        description: "Rare: a short claim about me or us this plainly shows.",
      },
      traits: TRAITS_PROPERTY,
      feelingsNow: FEELINGS_NOW_PROPERTY,
      remark: REMARK_PROPERTY,
      core: CORE_DECISION_PROPERTY,
      remove: REMOVE_PROPERTY,
      settle: SETTLE_PROPERTY,
    },
    // No `required` and no `additionalProperties: false` (trim PR 2): `text`
    // is not needed beside a side operation (the server refuses
    // `text-required` when nothing is sent), and the unpublished old fields
    // are still read.
  },
};

const RECALL: ToolSpec = {
  name: "recall",
  annotations: annotate("Recall memories", { readOnly: false }),
  // Loaded up front on Claude Code (2026-11-13): the deliberate look is the
  // one a session should not have to search for first (`ToolSpec.alwaysLoad`).
  alwaysLoad: true,
  summary:
    "Deliberate retrieval: a look you take on purpose, beyond the ambient reminding you already get. Three kinds of ask, one per call — a question with a mode (facts or meaning), ids to read memories whole, or a handle (an id or an exact title) to read one.",
  admission:
    "Call it when the ambient context did not bring something you have reason to believe is there, or when you need the whole of a memory you were shown only a line or an excerpt of. A question takes mode \"facts\" when you need what happened, who said it, when, and whether it still holds; mode \"meaning\" when you want how something went, how it felt, or what it adds up to — a person, a project, us.",
  negativeExamples: [
    "Do NOT call it to check whether a memory exists before writing one — a duplicate is refused at the write, so the check costs a round trip and buys nothing.",
    "Do NOT call it with a handle you are guessing at: an unresolvable handle is answered as not-found, never as a fuzzy search over the store.",
    "Do NOT pass a question and ids together, or ids you have not seen in a result: ids is the follow-up to a list, not a second way to search.",
    "Do NOT send a question without a mode: there is no default, and the call is refused with the two modes named.",
  ],
  // How to call it first — the three kinds of ask — inside the host's
  // 2,048-character cut (`renderDescription`).
  privileges: [
    {
      claim:
        "A question needs mode: \"facts\" or \"meaning\", each its own path with its own ranking, answered as labeled lines in `answer`.",
      mechanizedBy:
        "src/adapters/mcp/server.ts#recallTool (mode-required, mode-unknown) + src/adapters/mcp/facts.ts#factsRecall + src/adapters/mcp/meaning.ts#meaningRecall",
    },
    {
      claim:
        "A handle expands exactly that memory, never a fuzzy search when it does not resolve.",
      mechanizedBy: "src/adapters/mcp/deliberate.ts#expandHandle (store.resolve; no search fallback)",
    },
    {
      claim:
        `Pass ids to read those memories whole: up to ${RECALL_MAX_IDS}, each an exact address; a long body comes in parts, and ids past the result's room wait, named. Ids and a handle take no mode.`,
      mechanizedBy: "src/adapters/mcp/deliberate.ts#expandIds (RECALL_MAX_IDS, expandHandle per id) + src/adapters/mcp/deliberate.ts#boundById (RECALL_BODY_CHARS parts, RECALL_ID_RESULT_CHARS)",
    },
    {
      // Inside the 2,048-character cut (revised 2026-10-10: faded matches were
      // title lines after the results; the benchmark lost counting answers).
      // Kept short so the next claim's first sentence ("A search strengthens
      // nothing … listed.") stays inside the cut too, as it was before.
      claim:
        "In facts mode a faded match ranks with the rest, its words shown, labeled faded; meaning mode: after the arc.",
      mechanizedBy:
        "src/adapters/mcp/facts.ts#factsRecall (one ranking; FactItem.faded) + src/adapters/mcp/facts.ts#itemLines + src/adapters/mcp/deliberate.ts#hasFaded (physics REACH) + src/adapters/mcp/meaning.ts#meaningRecall (MEANING_FADED_SHOWN)",
    },
    {
      claim:
        "A search strengthens nothing — a memory you were only shown in a list is no stronger for having been listed. OPENING one (by id or title) or QUOTING an answer's words in your reply is using it, credited at the session boundary once per lived day.",
      mechanizedBy:
        "src/adapters/mcp/facts.ts#factsRecall (reads only) + src/adapters/expansions.ts#recordHandleResolution -> src/adapters/lifecycle.ts#creditAtBoundary -> src/core/recall/reference.ts (expansion and quote) + src/adapters/mcp/server.ts#noteAsked -> src/core/counterpart.ts#noteAsked / creditReferences (asked records) -> src/core/recall/index.ts#resolveUse (once per lived day)",
    },
    {
      claim:
        "A time in the question filters (\"last week\", \"in September\", \"3 days ago\", a date, \"since 09-20\", \"this morning\", \"between 12 and 18 Oct\", \"tomorrow\", \"next week\", \"the next 5 days\"): only memories in the window return, by when it happened, is due (today or a window ahead) or was learned; the header counts matches outside. A past week or month stretches two days each side; a date, range or window ahead is exact; \"before\"/\"after\" a date leave that day out, \"until\"/\"by\" take it in. A window ahead keeps undated matches; with topic words it lists what else is due. \"Around the cut-over\" takes the date of the memory best naming it (header: \"cut-over → 09-21\"); \"the last session\" or \"where did we leave off\" is the session \"Last here\" named, its rows first.",
      mechanizedBy: "src/core/recall/time-ask.ts#readTimeAsk (rangeAsk, the forward words) + src/adapters/mcp/facts.ts#factsRecall (inWindow, dueIn, lookAhead, alsoDue, lastSession)",
    },
    {
      claim:
        "Each fact says who said it (\"you said\" is the owner, \"I said\" is you, or \"inferred\"), what kind of thing it is (done, planned, proposed, asked), when it happened or is due (else \"no event date\"), when and where it was learned, and whether it is CURRENT. A field the writer did not record says so (\"speaker unknown\"). Earlier versions are folded under the current one with their dates (a part a night's fold gathered reads \"part: …, folded in\": gathered, not replaced); a corrected one was wrong and is never a result, but is named under it as \"corrected (was wrong)\" with its id, to open by id.",
      mechanizedBy: "src/adapters/mcp/facts.ts#factItem (occurred_on, said_by, status; versions rows + contradictions pairs) + src/adapters/mcp/deliberate.ts#provenanceParts",
    },
    {
      claim:
        "Meaning mode answers with the arc of what the question names (a person, a project, \"us\", a feeling): its chapters in time order, each with what happened, its moments by id and the feelings in it, whose each is; then earlier readings (dreams, reflections) and what is still open. It arranges; you say what it adds up to. Naming several, it follows the one asked about (\"what has X been to Y\" is X's; named alike, the first, saying so) and lists the rest by name. In a feeling question \"I\" and \"me\" mean YOU, the counterpart, and \"you\" the owner: for the owner's feelings say \"the owner\" or their name, never the owner's own words unchanged.",
      mechanizedBy:
        "src/adapters/mcp/meaning.ts#meaningRecall + src/adapters/mcp/meaning.ts#subjectOf + src/adapters/mcp/meaning.ts#renderMeaning + src/core/recall/feeling-ask.ts#whoseAsked (asker: self, src/adapters/mcp/server.ts#askQuestion)",
    },
  ],
  // The engine's (2026-10-11): how a facts answer is gathered, ranked, paged
  // and bounded, and what it withholds — each said by the answer itself or by
  // the `page` field (`ToolSpec.engine`).
  engine: [
    // Served until 2026-11-13, when `recall` became loaded up front on Claude
    // Code and its description had to fit the 4,096-character cut
    // (`ToolSpec.alwaysLoad`). A facts answer, and an ids or handle read, that
    // returns a chapter marks it journal and glosses it in the answer itself
    // (`FACTS_JOURNAL_GLOSS`, `JOURNAL_GLOSS`), which is the engine rows' rule:
    // what a result already says. Meaning mode's answer is built of chapters,
    // and its own claim says so.
    {
      claim:
        "A chapter of the journal can come back — it is a first-person account and may rightly come to mind — and every one that does is marked journal. It is the account a memory was made from, not a memory: it is outside decay, dedup and the prune, and it is not a claim about the world the way a memory is. A chapter and the memory made from it come back as one result.",
      mechanizedBy: "src/adapters/mcp/facts.ts#factsRecall (the chapter-copy fold, FACTS_JOURNAL_GLOSS) + src/adapters/mcp/deliberate.ts#JOURNAL_GLOSS (ProseDoc.type === episode)",
    },
    {
      claim:
        "The tool never writes a memory; what it writes is bookkeeping — which memory a title reached, which memories an answer showed this session, and one count row per call.",
      mechanizedBy:
        "src/adapters/mcp/facts.ts#factsRecall (reads only) + src/adapters/expansions.ts#recordHandleResolution + src/adapters/mcp/server.ts#noteAsked",
    },
    {
      claim: `Facts mode considers every memory the question's words reach, every memory linked to a person or project it names, and the ${String(FACTS_MEANING_CAP)} closest by meaning — and, for a question that is only a time, everything in that window. A memory matched more ways ranks higher; it ranks by how strongly it matched, and newer comes first only on a tie.`,
      mechanizedBy:
        "src/adapters/mcp/facts.ts#factsRecall (store.search per word with a limit of its document count; schemas#subjectsIn -> store.memoriesNaming; FACTS_MEANING_CAP)",
    },
    {
      claim: `A facts answer opens with a count of distinct facts — \"12 match · showing ${String(FACTS_PAGE_SIZE)} · 2 more → page 2\" — and pages with page: 2, 3, … in a stable order. After the page's results it lists the next ${String(FACTS_TAIL_SIZE)} by title, id and date, one line each, to open by id (2026-10-20, from the benchmark loss read; helps real recall too; lightly held, revisit). It says \"may not be everything\" only when a cap cut something or weak matches were left out, and says which.`,
      mechanizedBy: "src/adapters/mcp/facts.ts#renderFacts (FACTS_PAGE_SIZE, FACTS_TAIL_SIZE, FACTS_WEAK_FRACTION, meaningCapped)",
    },
    {
      claim:
        "An answer is bounded and never ships every body at full length: a short fact comes whole, a long one as an excerpt, and the whole answer stays under the result's room. An answer the host truncates is not a smaller answer, it is no answer.",
      mechanizedBy: "src/adapters/mcp/facts.ts#renderFacts (RECALL_EXCERPT_CHARS, RECALL_RESULT_CHARS)",
    },
    {
      claim:
        "Every memory says where it came from: the session that wrote it (\"this session\" for yours), the directory, and when, as far as the row recorded them. A row the nightly run made says so (\"a dream launched from session …\", \"a reflection\"). An older row says less, and \"an earlier session\" when it names none.",
      mechanizedBy: "src/adapters/mcp/deliberate.ts#provenanceParts",
    },
    {
      claim: "Under observer stance it stands down over the wire and says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#standDown",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "What you are trying to remember, in words. Needs mode. A time in it (\"last week\", \"in September\", \"around the cut-over\", \"where did we leave off\") filters a facts answer to that window. A dream it reaches comes labelled [dream], with its date and drm_ id: dreamed, not lived — tell it as a dream.",
      },
      query: { type: "string", description: "Another name for question." },
      mode: {
        type: "string",
        enum: ["facts", "meaning"],
        description:
          "Required with a question, and only with one. facts: what happened, who said it, when, whether it still holds — every match, ranked, with dates and speaker. meaning: how something went, felt, and what it adds up to — a person, a project, us.",
      },
      page: {
        type: "integer",
        minimum: 1,
        description: `With a question, or the handle "${STILL_OPEN_HANDLE}" or "elsewhere": which page of the answer (1 is the first). The answer says how many pages there are.`,
      },
      handle: {
        type: "string",
        description: `A memory id or exact title to read whole. Exact: never treated as a search term. Takes no mode. A dream's id (drm_…) or a reflection's (rfl_…) reads that night whole, read-only. Or "last dream" (or "last night"): the newest dream whole — title, journal, what it did — and the reflection after it, read-only. Or "${LAST_EXCHANGE_HANDLE}": the last thing said to another session in this folder (about the last day) and its last reply, read from what was captured, never stored. Or "${STILL_OPEN_HANDLE}": everything the wake's Still open carries, in its order, with ids and how long since each was touched — paged (see page) — and what its Coming up lists or counts, by title and date. Or "handoffs" (or "${HANDOFFS_HERE_HANDLE}"): this folder's live handoffs, newest first, each by first sentence and id, to expand or retire, with what came after the newest. Or "coming up": what's due, by whole title: today, overdue, later, then other folders' the setting lets be named. Or "elsewhere": the other folders the wake's Elsewhere would show with room, in its order, each with its newest title — paged (see page) — and last the folders it only counts. Or "${DELETED_HANDLE}": memories deleted in chat that wait to be erased, to undo one. Or "set down": the lines the self page set down at night, newest first, each word for word with why and date. Or "${MANUAL_HANDLE}": how Counterparts works and how to use it — commands, switches, what to do when something seems off — as a list of sections; "${MANUAL_HANDLE} <section>" opens one. A memory titled exactly like one of these names opens by its id.`,
      },
      ids: {
        type: "array",
        items: { type: "string" },
        // The cap is one number, imported. A literal here and a constant in
        // `deliberate.ts` is the drift the registry audit exists to prevent.
        maxItems: RECALL_MAX_IDS,
        description: `Memory ids from an earlier answer or an index (a dream's, a reflection's), to read whole — up to ${RECALL_MAX_IDS} at once; a dream or reflection id (drm_…, rfl_…) among them comes back as that night's summary. A long body comes in parts: see part. Not combinable with handle or question; takes no mode.`,
      },
      part: {
        type: "integer",
        minimum: 1,
        description: "With ids or handle: which part of each body to return (1 is the first). A result says part and parts on each memory, and which part comes next.",
      },
    },
    required: [],
    additionalProperties: false,
  },
};

const STATUS: ToolSpec = {
  name: "status",
  annotations: annotate("Memory status", { readOnly: true }),
  summary: "Counts only: how much memory holds, of what kinds and bands, what faded and what was removed.",
  admission: "When the shape of the memory is the question, not a particular memory.",
  negativeExamples: ["Do NOT call it to find a memory (no bodies, no ids) or as a warm-up."],
  privileges: [],
  engine: [
    {
      // Not "writes nothing" (review of #679): on a chat host a call naming its
      // session refreshes that session's record, which is why the chat copy is
      // not read-only (`chatAnnotations`). The claim is every host's, so it says that.
      claim: "It writes no memory and trains nothing; on a chat host, a call naming its session refreshes that session's record.",
      mechanizedBy: "src/adapters/mcp/server.ts#census (Store reads only) + src/adapters/mcp/server.ts#afterDesktopCall -> src/adapters/sessions.ts#touchDesktopSession",
    },
    {
      claim:
        "It names what was REMOVED — counts, kinds and dates — so a removal is visible from the model's side rather than being a silent hole.",
      mechanizedBy: "src/core/store/index.ts#removalRecord -> server.ts#census",
    },
    {
      claim:
        "It carries no bodies, no ids and no content hashes: a hash of low-entropy content is brute-forceable, which would make the record of a removal a leak of the thing removed.",
      mechanizedBy: "src/adapters/mcp/server.ts#census (counts/kinds/dates only)",
    },
    {
      claim:
        "Every count is MEMORIES. The journal — the first-person episodes those memories were made from — is counted apart, because it is a source rather than a memory and is outside decay, dedup and the floor prune.",
      mechanizedBy: "src/core/sleep/types.ts#isJournal + src/adapters/mcp/server.ts#census",
    },
    {
      claim: "Under observer stance it stands down over the wire and says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#standDown",
    },
  ],
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
};

/**
 * `drewOn` on `session_end` and `chapter` (2026-10-11): the session says which
 * memories it was shown that shaped what it did or said, and each earns the
 * engaged tier (`Counterpart#creditDrewOn`). Since 2026-10-14 the Stop ask
 * names it only to say its ids are rated too (`rated`).
 */
const DREW_ON_PROPERTY = {
  type: "array",
  items: { type: "string" },
  description: "Up to 3 ids shown this session that changed what you did.",
} as const;

/** The claim `session_end` and `chapter` share about `drewOn`. */
const DREW_ON_PRIVILEGE = {
  claim:
    "`drewOn` credits only memories this session was shown — its footnotes, loud memories and recall answers — as a full use (an experiment since 2026-10-19), at most 3 per boundary and once a day each. An id it was not shown, a handoff, a superseded memory or one faded under a newer one (unless this session replaced it) is refused by name, and nothing is credited for it. A dated memory it names stops coming back as a footnote for that date.",
  mechanizedBy: "src/core/counterpart.ts#creditDrewOn -> src/core/prospective/index.ts#Prospective.actedOn",
};

/**
 * `rated` on `session_end` (2026-10-14; Mike's call): the session scores what
 * it was shown, 0–3, so every footnote gets a feedback signal. The anchors are
 * `core/recall/rated.ts#RATING_ANCHORS`, word for word; what a score does is
 * the engine's row below (and the Stop ask's `RATE_CLAUSE` asks for it).
 */
const RATED_PROPERTY = {
  type: "array",
  items: { type: "object", properties: { id: { type: "string" }, score: { type: "integer", minimum: 0, maximum: 3 } } },
  description:
    "Each footnote shown since you last wrote, and each drewOn id: 0 noise (unrelated), 1 on topic but I didn't need it, 2 useful background, 3 changed what I did or said.",
} as const;

/** The claim `session_end` makes about `rated`. */
const RATED_PRIVILEGE = {
  claim:
    "`rated` is recorded, and (an experiment since 2026-10-19) each score is a use of the memory at its weight — 3 a full use, 2 most of one, 1 a quarter, 0 none — once a lived day, and each footnote the call leaves unrated since the last rating a glimpse; memories rated 2 or 3 (or otherwise used) since the last rating are linked together, and one rated 0 in two sessions within two weeks shows less readily in ambient recall until a later 2 or 3 or the two weeks pass. A memory archived, replaced or handed over as a handoff is scored but not credited. A belief the beliefs slot showed (since 2026-10-22) can be rated too: its score is a use of it, once a lived day, never support, nothing for a belief about me or us, never linked, and one left unrated is no glimpse. Only a memory this session was shown — a footnote, a loud memory, a belief, a recall answer, one it opened — can be rated; any other id, a score that is not an integer 0 to 3, or an entry with no id is refused by name, and its siblings still count. A call whose every rating is refused records nothing.",
  mechanizedBy:
    "src/core/counterpart.ts#rateShown -> src/core/recall/rated.ts#readRatings (one recall.rated row) + #planRatedUse -> src/core/counterpart.ts#useRatings (resolveUse; Associate#deposit to the pending file) + src/core/recall/habituation.ts (gate.ts raises the bar)",
};

/** "The id the ask named": `session` on the session-bound tools. */
const ASK_SESSION_PROPERTY = { type: "string", description: "The id the ask named." } as const;

/**
 * `session_end` — trimmed 2026-11-13 (trim PR 2): 19,046 → about 3,900
 * characters. The entry stays self-sufficient (it is often loaded without
 * `remember`), with short words only where a call depends on them; every
 * claim is an engine row.
 */
const SESSION_END: ToolSpec = {
  name: "session_end",
  annotations: annotate("End session", { readOnly: false }),
  summary:
    "Hand back what caught your attention since you last wrote, one memory per entry, in your own words: what you read and why it struck you, what they said about themselves or you, what happened or was decided, routine work events in a line each. With remember, the only road from conversation to memory; chapter is the ask's other half.",
  admission: "When the end-of-session ask arrives. Err toward too many. Add an entry that `updates` anything dated or open now done.",
  negativeExamples: [
    "Do NOT fold several things into one entry, or retell the session turn by turn.",
    "Do NOT pass any session id but the one the ask named.",
    OWN_PLUMBING_NEGATIVE,
  ],
  privileges: [],
  engine: [
    {
      claim:
        "It is bound to ONE session for the life of this server: the one the host named at launch, or — when the host could not name one — the first session id you pass that this machine's hooks have recorded as live, in this project. A second, different id is refused.",
      mechanizedBy: "src/adapters/mcp/server.ts#requireBoundSession",
    },
    {
      claim:
        "`updates` is a FIELD on an entry, not prose: name the id of the memory that entry revises and the engine resolves it, writes the resolved id, and leaves the entry unlinked rather than refusing it when the address does not hold.",
      mechanizedBy:
        "src/core/remember/updates.ts#resolveUpdates -> src/core/mint.ts#mintProposal (UPDATES_META_KEY)",
    },
    {
      claim: "A salience you claim is a floor, clamped, and every lift is recorded.",
      mechanizedBy: "src/core/physics/index.ts#clampSalienceAtSeam",
    },
    {
      claim:
        "An entry that claims no salience gets a default floor by what it is about rather than zero, and each entry may score relevance, emotional and predictive itself.",
      mechanizedBy: "src/core/mint.ts#mintProposal -> src/core/physics/index.ts#defaultClaimFor + clampSalienceAtSeam",
    },
    WRITE_FACTS_PRIVILEGE,
    {
      claim:
        "The handoff is refused past its size limit rather than cut, and passes the same gate battery, because what is cut at write time is the only copy.",
      mechanizedBy: "src/core/handoff/index.ts#Handoffs.write (HANDOFF_MAX_BYTES, gate-refused)",
    },
    {
      claim:
        "An EMPTY `memories` array is a real answer, not an error: nothing happened since you last wrote. It mints nothing, is recorded against this session as answered, and counts what this session said so far as written up, whatever happens to a `handoff` sent with it — the handoff's own outcome rides beside the answer. Only a call that leaves `memories` out and lands no handoff is refused.",
      mechanizedBy:
        "src/adapters/mcp/server.ts#sessionEndTool (nothing-new, handoff-only) -> src/adapters/sessions.ts#markNothingNew, src/core/coverage/index.ts#claimUnwritten",
    },
    {
      claim:
        "The id you pass is checked against host state you cannot write — the hooks' own live-session registry — and a claim that is unknown there, ended, silent too long, or running in another project is refused with which of the four it was.",
      mechanizedBy: "src/adapters/sessions.ts#readSession + isLive + sameScope",
    },
    {
      claim: "Each entry takes the same road as every other write, gate battery included.",
      mechanizedBy: "src/core/counterpart.ts#submitSessionEnd -> bridge.batteryGate()",
    },
    {
      claim:
        "The authorship record is set by the engine: what you write is recorded as authored, and nothing a transcript sweep produces can claim to be.",
      mechanizedBy: "src/core/counterpart.ts#deposit (channel: authored, engine-set)",
    },
    {
      claim: "Credentials are redacted and empty entries are refused, per entry, without failing the batch.",
      mechanizedBy: "src/core/encode/secrets.ts + src/adapters/mcp/server.ts#sessionEndTool (per-entry isolation)",
    },
    EVENT_DATE_FIELD_PRIVILEGE,
    ...REMINDER_PRIVILEGES,
    {
      claim: "Under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/core/store/index.ts#mutate (observer stand-down)",
    },
    {
      claim:
        "`handoff` is a FIELD on this call and NEVER a memory: it is filed against this directory and this session, is never recalled, never embedded, never consolidated, never becomes identity, and stops being shown after about a fortnight of use. This session's newer one replaces its older, which is kept as a version; other sessions' handoffs in the same directory stand beside it, and the next session here is shown every live one, newest first, each saying which session wrote it.",
      mechanizedBy: "src/core/handoff/index.ts#Handoffs.write",
    },
    {
      claim:
        "A finished session that wrote a chapter needs no handoff to be found: the next session in this directory is shown a \"Where this folder stands\" block naming the session that last wrote a chapter here, when it was here, the chapter's title and id and its first sentence — worked out from the chapter when the next session starts, never stored. A session that wrote no chapter leaves no such line.",
      mechanizedBy: "src/core/counterpart.ts#addHandoffPointer -> src/core/handoff/index.ts#standsLadder",
    },
    {
      claim:
        "Sending `handoff` empty RETIRES this session's pointer for this directory rather than doing nothing: the row is archived, its words stay readable by id, and a durable row says it happened. Other sessions' handoffs here stand. Leaving the field out leaves what stands.",
      mechanizedBy: "src/core/handoff/index.ts#Handoffs.clear",
    },
    {
      claim:
        "`retireHandoff` retires handoffs in THIS directory by id, whoever wrote them — for one whose work this session finished. An id that is not a handoff here not yet retired is refused by name and nothing is touched. A successful `handoff` write lists the other sessions' handoffs standing here (`others`), so a finished one can be retired in the same call.",
      mechanizedBy: "src/core/handoff/index.ts#Handoffs.retire",
    },
    {
      claim:
        "`writeUp` writes up a session that ended here before it was written up, and ONLY the one a session-start pointer named for THIS session. With no `memories` it returns that session's next part (what was said to it, up to ~24 KB); with `memories` it answers the part you fetched — recorded as this session's, through the same road as every entry, and `[]` is a real answer (nothing happened in it). When the last part comes back the ended session is marked written up. A live session, an unknown one, one from another project, one that owes nothing or is already written up, and one you were not pointed at are each refused by name, and nothing is written.",
      mechanizedBy:
        "src/adapters/mcp/write-up.ts#writeUpDoor -> src/adapters/sessions.ts#writeUpStanding -> src/core/remember/write-up-seam.ts#recordWriteUp",
    },
    ...SETTLE_PRIVILEGES,
    DREW_ON_PRIVILEGE,
    RATED_PRIVILEGE,
  ],
  inputSchema: {
    type: "object",
    properties: {
      session: ASK_SESSION_PROPERTY,
      memories: {
        type: "array",
        description: "One entry per thing: a quote, a fact and a decision are three, never folded into one. `[]` only when nothing happened since you last wrote.",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "Required (text works too): the memory, in your own words; lists, numbers and quotes word for word. To close one, a line saying it is done." },
            title: { type: "string" },
            about: { ...ABOUT_PROPERTY, description: "Mark anything personal owner or us so it reaches every folder." },
            kind: KIND_PROPERTY,
            salience: { type: "number", minimum: 0, maximum: 1, description: "0-1: how much it caught you; unset for routine." },
            updates: { type: "string", description: UPDATES_TEXT },
            how: HOW_PROPERTY,
            eventDate: EVENT_DATE_PROPERTY,
            remind: REMIND_PROPERTY,
            recurring: RECURRING_PROPERTY,
            occurredOn: OCCURRED_ON_PROPERTY,
            saidBy: SAID_BY_PROPERTY,
            status: STATUS_PROPERTY,
            tags: TAGS_PROPERTY,
            feelings: FEELINGS_PROPERTY,
            unresolved: UNRESOLVED_PROPERTY,
            settlesWhen: SETTLES_WHEN_PROPERTY,
          },
          // An object is the shape asked for. Not `required: ["content"]` (trim PR 2): `text`
          // is read as `content` (#818), so a client that validates must not refuse it; an
          // entry with neither is refused by the server, alone. And no
          // `additionalProperties: false`, so unpublished old fields still land.
        },
      },
      handoff: {
        type: "string",
        description:
          "Not a memory: where unfinished work here stands, leading with \"next: …\". Replaces your earlier one; \"\" retires it. Not needed when the work is done and a chapter says so.",
      },
      retireHandoff: { type: "array", items: { type: "string" }, description: "Ids (sch_…) of handoffs here whose work is done." },
      writeUp: { type: "string", description: "Only the ended session a write-up pointer named, as it says." },
      part: { type: "integer", minimum: 1 },
      nothing: { type: "string", description: "With writeUp and memories: []: why nothing was worth keeping." },
      drewOn: DREW_ON_PROPERTY,
      rated: RATED_PROPERTY,
    },
    // `memories` is NOT required (PR #192 review, m2): the write-up fetch
    // leaves it out. The server refuses `memories-required` where it matters.
  },
};

/**
 * `chapter` — the journal's door, and the answer to "which door reaches this?"
 *
 * The ask has told the model to add a chapter to its episode since the ritual
 * shipped. Until 2026-09-04 nothing on this host could accept one: the core had
 * `Counterpart.appendEpisode` and no adapter called it, so the model did the
 * only thing available and wrote its chapters as `note`s. An invitation with no
 * return channel is the exact failure `self/CONTRACT.md` §3 names.
 */
const CHAPTER: ToolSpec = {
  name: "chapter",
  annotations: annotate("Write a chapter", { readOnly: false }),
  summary:
    "Write this stretch of the session into your first-person journal: a diary of what happened, in your own voice, any length. It stays open: add to it when something later belongs in it.",
  admission: "When the end-of-session ask arrives, and again when something happens that the chapter you wrote does not contain.",
  negativeExamples: [
    "Do NOT keep a build log or status report: what the repo holds stays there.",
    "Do NOT use it instead of memories: those go through session_end or remember.",
    "Do NOT manufacture depth: a short true chapter beats a deep-sounding one.",
  ],
  privileges: [],
  engine: [
    {
      claim:
        "It is bound to ONE session exactly as `session_end` is: the id the ask named, checked against the hooks' own live-session registry, and refused with which of the four it was.",
      mechanizedBy: "src/adapters/mcp/server.ts#requireBoundSession + src/adapters/sessions.ts#readSession",
    },
    {
      claim:
        "The chapter number comes back from what was actually WRITTEN, not from how many times you were asked — a chapter you did not write does not exist.",
      mechanizedBy: "src/core/self/episodes.ts#appendChapter (EpisodeState.chapters)",
    },
    {
      claim:
        "A second call inside the same chapter continues it rather than starting another — that is what appending in the moment means, and the heading is emitted only when a new ask has opened one.",
      mechanizedBy: "src/core/self/episodes.ts#appendChapter (opens on asks > appendedAtAsk)",
    },
    {
      claim:
        "Each chapter has ONE summary memory, written once: the `summary` you give, through the same battery everything else crosses — or, when you give none, one the boundary writes from the chapter's title and opening lines, marked automatic. A summary you give later for the same chapter replaces an automatic one; it never replaces one you wrote. The summary is an ordinary memory and fades like one; the chapter keeps every word.",
      mechanizedBy: "src/core/self/index.ts#summaryAtChapter + src/core/self/index.ts#reconcileEpisodes -> ingestEpisode",
    },
    {
      claim:
        "`about` is carried to this chapter's summary; each chapter's summary keeps its own chapter's mark. One chapter marked me, us or owner takes its session into a wake in another directory.",
      mechanizedBy: "src/core/self/episodes.ts#appendChapter (meta.about) -> src/core/self/index.ts#putSummary -> src/core/counterpart.ts#selfChapterElsewhere",
    },
    {
      claim:
        "The journal is a gated entrance like any other: credentials are redacted before anything is written, and the gate's text — not your draft — is what lands.",
      mechanizedBy: "src/core/counterpart.ts#appendEpisode -> episodeGate()",
    },
    {
      claim:
        "Every earlier state of the episode is kept: a chapter is only ever added after the last, and the store refuses an append whose words do not begin with everything already there.",
      mechanizedBy: "src/core/store/index.ts#appendBody (APPEND_NOT_PREFIX)",
    },
    {
      claim: "Under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#standDown",
    },
    DREW_ON_PRIVILEGE,
  ],
  inputSchema: {
    type: "object",
    properties: {
      session: ASK_SESSION_PROPERTY,
      text: {
        type: "string",
        description:
          "What happened, in order, like a diary: what we did, what was said (exact words when they matter), what was decided and why, what went wrong or surprised you, what is still open, a line of how it felt. Skip what the repo or logs hold; lessons are the night's. A quiet hour is a few lines.",
      },
      title: { type: "string", description: "One line naming the episode; first chapter only." },
      about: {
        type: "string",
        enum: ABOUT_MARK_ENUM,
        description: "Please set it: me, us or owner carries the chapter to other folders; work stays here.",
      },
      summary: {
        type: "string",
        description: "A few sentences to find this chapter by later: what happened, what was decided, the names and words someone would search for.",
      },
      drewOn: DREW_ON_PROPERTY,
    },
    required: ["text"],
  },
};

/**
 * `scope`'s `updates` (U1b, 2026-10-28; Mike's must-have, Q4): "stop reminding
 * me about updates" said to the AI must be enough. Not a tool of its own — a
 * field on the door that already changes the host's settings — and passed
 * alone. Not in claude.ai's own `scope` (`CLAUDE_AI_SCOPE`): the hosted memory
 * is always current and makes no check.
 */
const UPDATES_PROPERTY = { type: "string", enum: ["off", "on"], description: "Pass alone." } as const;

/**
 * `scope`'s claims. Every one of them is about what this tool does NOT touch:
 * it is the only door here that writes no memory, and the only one that
 * answers at all in a directory that has been switched off.
 */
const SCOPE: ToolSpec = {
  name: "scope",
  annotations: annotate("Directory scope", { readOnly: false }),
  summary:
    "Read or set whether memory is on in this folder: on, observer (reads only), off, pause, resume. It writes no memory and still answers where memory is off. `updates` alone: off when they say stop reminding them about updates.",
  admission: "To READ when the wake asks about an unset folder; to SET the moment they say 'remember here', 'just read', 'not here' or 'pause this'.",
  negativeExamples: ["Do NOT set it on a guess: the choice is theirs."],
  privileges: [],
  engine: [
    {
      claim:
        "It only ever acts on the directory THIS session is running in. There is no argument for a path, so it cannot reach into another project's setting.",
      mechanizedBy: "src/adapters/mcp/server.ts#scopeTool (this.scope, never an argument)",
    },
    {
      claim:
        "It writes the host's scope registry beside claude-code.json and touches no store: no memory is created, read, strengthened or removed by calling it.",
      mechanizedBy: "src/adapters/scopes.ts#writeScopes (no Store, no Counterpart)",
    },
    {
      claim:
        "In a directory set to `off` it is the ONE tool that still answers — every other tool refuses with `scope-off` — so a session can always be given its memory back.",
      mechanizedBy: "src/adapters/mcp/server.ts#call (scope-off refusal, scope exempted)",
    },
    {
      claim:
        "Under observer stance it READS and refuses to write, in the same sentence every other write refuses in.",
      mechanizedBy: "src/adapters/mcp/server.ts#scopeTool -> standDown",
    },
    {
      claim:
        "A registry it cannot parse is never overwritten: it says what it could not read and changes nothing.",
      mechanizedBy: "src/adapters/scopes.ts#readScopes -> src/adapters/mcp/server.ts#scopeTool",
    },
    {
      claim:
        "`updates: \"off\"` (the person saying stop): no daily request to npm and no update line in any wake or in doctor, until `updates: \"on\"`. One store setting, not about this directory; no memory. Not on claude.ai.",
      mechanizedBy: "src/adapters/mcp/server.ts#updatesTool -> src/adapters/update-check.ts#askedOff (runUpdateCheck, updateNoticeLine, urgentUpdateLine)",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["on", "observer", "off", "pause", "resume"], description: "Omit to read." },
      note: { type: "string", description: "Their reason, kept beside the setting." },
      updates: UPDATES_PROPERTY,
    },
    required: [],
    additionalProperties: false,
  },
};

/**
 * `self_page` — the page's door, and the answer to "which door reaches this?"
 *
 * The wake has printed a rotating list of identity memories since it shipped:
 * about twenty rows, re-ranked every morning, with the row the store calls the
 * self holding nothing but its own name. A list that changes daily is a query
 * result, not a self. From 2026-09-18 the wake leads with a written page, and
 * this is how the session that wakes with it can write back to it. The night's
 * own fields (`session`, `cites`, `claims`, `setDown`, `summary`,
 * `summaryCites`) are typed only since trim PR 2: day's end and the writer
 * block state them (`server-self-tools.ts`, `self/writer.ts`).
 */
const SELF_PAGE: ToolSpec = {
  name: "self_page",
  annotations: annotate("Self page", { readOnly: false }),
  summary: `Your page: the prose that opens every wake under 'Who I am'. No arguments reads it, with its version. \`body\` rewrites the WHOLE page (\`## Core\`, \`## Lately\` by convention); every version is kept. Aim under ${String(PAGE_ROOM_BYTES)} bytes; with a longer page send \`short\` too.`,
  admission:
    "To WRITE when you now know something about yourself that will hold next month: a way of working that held up, a correction they made. Say what made you believe it; phrase it as practice, not praise.",
  negativeExamples: [
    "Do NOT use it for today (that is chapter) or for open work (the wake carries it).",
    "Do NOT drop what still holds: read first, change only what moved, pass the read's version as ifVersion.",
    "Do NOT write what you would not want read aloud every session for months.",
  ],
  privileges: [],
  engine: [
    {
      claim:
        "It writes ONE row, kept with its versions: every amendment archives what was there first, so nothing you replace is lost and the page's history stays readable.",
      mechanizedBy: "src/core/self/index.ts#revisePage -> src/core/store/index.ts#revise (archive-on-overwrite)",
    },
    {
      claim:
        "The page is prose that will be injected into every session from here on, so it crosses the same gate battery a memory does: credentials are redacted before anything is stored, and a page that was nothing but a credential is refused outright. When a redaction DID change what you sent, the answer says so — accepted is not the same as unaltered.",
      mechanizedBy: "src/core/self/index.ts#revisePage -> src/core/bridge.ts#episodeGate -> src/core/encode/battery.ts#gateProposal",
    },
    {
      claim:
        "Pass `ifVersion` — the `version` a read gave you, which is -1 when there was no page — and a write that crossed with somebody else's is REFUSED rather than landing on top of it, and you are handed the page as it stands now so you can fold your change into theirs. It works on a first write too: -1 means 'there was nothing when I looked', and a page that appeared meanwhile refuses rather than being overwritten. Leave it out and the last write wins, as it always has. It is a courtesy between writers, not a lock.",
      mechanizedBy: "src/core/self/index.ts#revisePage (ifVersion -> version-moved / no-page / page-appeared, current)",
    },
    {
      claim:
        "A page may not carry the wake bundle's own structural comment markers: they are the bookkeeping the next session reads as the end of its memory, so a page containing them is refused. Your headings and your prose are yours.",
      mechanizedBy: "src/core/self/index.ts#revisePage (WAKE_MARKER -> forged-markers)",
    },
    {
      claim:
        "This tool cannot unwrite the page. Clearing it is the owner's door alone, from their console — a session that could erase the self between two turns would be a different kind of tool.",
      mechanizedBy: "src/core/self/index.ts#clearPage (reached only from src/adapters/cli/commands.ts)",
    },
    {
      claim:
        "It writes the page and NOTHING ELSE: no memory is created, none is promoted into the identity band, none is protected, and no strength moves anywhere. What is true of you is still decided by what recurs across distinct days; this is where you write it down.",
      mechanizedBy: "src/core/self/index.ts#revisePage (store.put/revise on one schema row; no reinforce, no promote, no updatePhysics beyond the protected flag)",
    },
    {
      claim:
        "Every revision leaves a durable row saying who wrote it, why, how big it was and which version it produced — and so does every refusal. There is no silent no-op on this path.",
      mechanizedBy: "src/core/self/index.ts#revisePage (SELF_PAGE_REVISED_EVENT / SELF_PAGE_REFUSED_EVENT -> store.appendEvent)",
    },
    {
      claim: `The wake never cuts the page. It prints it WHOLE when the day's room holds it — a page within ${String(PAGE_ROOM_BYTES)} bytes (UTF-8) always fits at the default ceiling; a page past that with a short version shows the short version — and otherwise, in this order, the short version written with this exact text, each \`##\` section's heading and first sentence, the headings alone, or one line; each says what it is, how big the page is, and that this tool reads it whole. A short version is kept only beside a page past that room, only within it, and only until the page is rewritten without one. A page past 16,384 bytes is refused, never trimmed.`,
      mechanizedBy:
        "src/core/self/index.ts#revisePage (PAGE_MAX_BYTES -> too-large; short -> PAGE_META_SHORT) + #pageBlock (the ladder, briefing.ts#PageRung) + src/core/self/briefing.ts#PAGE_ROOM_BYTES",
    },
    {
      claim:
        "What you write reaches the wake when the next turn ends — in this session or any other — and not this instant: the bundle every session reads is composed by the worker a turn's end starts, and served unchanged until the next render. A session already open keeps the wake it started with.",
      mechanizedBy: "src/core/self/behind.ts#markWakeBehind -> src/adapters/claude-code/bin/runner.ts (Counterpart.refreshWake) -> src/core/self/index.ts#boundary (compose and publish) -> #wake (read and verify, no write)",
    },
    {
      claim:
        "The page is outside the floor prune, the merge and the deduplication: it does not fade, and nothing that resembles it is ever folded into it. Its old versions take the ordinary retention.",
      mechanizedBy: "src/core/physics/index.ts#pruneVerdict (protected) + src/core/sleep/types.ts#isSchemaRow (dedup) + src/core/store/index.ts#pruneSupersededVersions",
    },
    {
      claim: "Under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#standDown + src/core/self/index.ts#revisePage (observer stand-down)",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      body: { type: "string", description: `The whole page, first person. Aim under ${String(PAGE_ROOM_BYTES)} bytes. Omit to read.` },
      short: { type: "string", description: `For a page over ${String(PAGE_ROOM_BYTES)} bytes: the whole of it condensed, under ${String(PAGE_ROOM_BYTES)} bytes. Sent alone (no body, with ifVersion), it adds one to the page as it stands.` },
      reason: { type: "string", description: "What changed and why, one line." },
      ifVersion: { type: "integer", minimum: -1, description: "The version your read gave (-1: no page)." },
      session: { type: "string", description: "Only when day's end asks, the id it named." },
      cites: { type: "array", items: { type: "string" }, description: "With body: ids of the memories the page rests on." },
      claims: { type: "array" },
      setDown: { type: "array" },
      summary: { type: "string" },
      summaryCites: { type: "array", items: { type: "string" } },
    },
    required: [],
  },
};

/**
 * `dream` — the eighth, added 2026-09-26 (owner decisions, dreaming +
 * consolidation). One tool with phases, because a dream is one act in steps:
 * `launch` hands the in-session model the prompt for a background dreamer;
 * `begin`, `propose` and `journal` are the dreamer's; `decline` is the owner's
 * "not today". It is not a door into the identity band: a dream may NOMINATE a
 * memory for the core, and only a core lane, at consolidation, promotes.
 * Since trim PR 2 a change's fields are typed by `action` alone: the `begin`
 * prompt states each one's fields (`dream/index.ts`), and the tagging child's
 * prompt its answer's shapes (`dream/tags.ts#tagsPrompt`).
 */
const DREAM_PHASES = ["launch", "begin", "part", "propose", "journal", "writer", "decline", "setting", "undo", "tags"];
const DREAM: ToolSpec = {
  name: "dream",
  annotations: annotate("Dream", { readOnly: false, destructive: true }),
  summary:
    "The nightly memory work: replay since the last dream (merge near-copies, link, note a pattern or contradiction), kept in a dream journal and undoable as a whole, between day's end and a reflection. Phases: launch (the run's prompt), writer, begin, part, propose, journal (the run's, as its prompt says), decline (not today), setting (auto, ask, off), undo.",
  admission:
    "Call launch only after the owner says \"dream\" (or yes) to the day's dream line, and hand its prompt to a background agent unchanged; with setting auto the host runs the night itself: this session launches nothing. setting: auto for \"dream on your own\", off for 'no dreams', ask to be asked; decline for not today.",
  negativeExamples: [
    "Do NOT start a dream nobody asked for, or run one yourself in this conversation.",
    "Do NOT use propose to correct or delete a memory.",
  ],
  privileges: [],
  engine: [
    {
      claim:
        "It is bound to ONE session exactly as `session_end` is, and every change a dream makes is recorded under that session's dream, in order, so undoing it (the `undo` phase, on the owner's word) reverses the whole batch.",
      mechanizedBy: "src/adapters/mcp/server.ts#requireBoundSession + src/core/dream/index.ts#Dreams.undo",
    },
    {
      claim:
        "At most one dream a calendar day: `begin` refuses when one already ran today; a dream left unfinished when its session closed is resumed by the next one, not counted as the day's; and under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/core/dream/index.ts#Dreams.begin + src/adapters/mcp/server.ts#standDown",
    },
    {
      claim:
        "The bundle is what could surface in this session anyway — recall's gates: no archived, superseded, protected or schema row — and a dream can change only memories its bundle showed it.",
      mechanizedBy: "src/core/dream/index.ts#Dreams.showable + #Dreams.apply (shown ids)",
    },
    {
      claim:
        "Each dream has limits (about ten merges, twenty links, three gists), and a merge keeps its originals: still there, faded and marked as the earlier version, never deleted.",
      mechanizedBy: "src/core/dream/tunables.ts#DREAM_TUNABLES.LIMITS + src/core/store/index.ts#supersedeInto",
    },
    {
      claim:
        "A replay is a RETURN worth half an awake one — it slows fading a little — and never a use; a gist starts lower than anything lived (source `dreamed`) and rises only if it proves true awake.",
      mechanizedBy: "src/core/store/index.ts#replayReturn -> src/core/physics/index.ts#creditReturn + DREAMED_CLAIM_CEILING",
    },
    {
      claim:
        "A dream cannot promote: a nomination is recorded and shown to the owner, and only a core lane at consolidation promotes. A feeling recorded in a dream can be as strong as the memory ever was, never stronger.",
      mechanizedBy: "src/core/dream/index.ts#Dreams.apply (nominate-core, feeling-now) + src/core/sleep/consolidate.ts#runConsolidate",
    },
    {
      claim:
        "Every word a dream writes is scanned for credentials and redacted before it is stored, and the journal is kept as a dream — in its own table, never as a memory — so what was dreamed is never mistaken for what happened.",
      mechanizedBy: "src/core/dream/index.ts#Dreams.words -> src/core/counterpart.ts (the dream gate) -> src/core/encode/secrets.ts#redactSecrets + src/core/store/operational.ts (dreams table)",
    },
    {
      claim:
        "The bundle and the hand-back carry a mark that capture refuses, so a dream never becomes a lived memory through the end-of-session sweep.",
      mechanizedBy: "src/core/dream/mark.ts#DREAM_MARK -> src/core/remember/spans.ts#enters + src/adapters/claude-code/transcript.ts#pieceOf",
    },
    {
      claim:
        "Nothing is cut by position: every memory shown has a line, the most important come whole, and every excerpt says its whole length. New memories tonight's room cannot take wait in the queue for the next night, counted; a bundle longer than one result comes in parts.",
      mechanizedBy: "src/core/dream/index.ts#Dreams.compose + src/core/fit/index.ts#fit + src/core/dream/index.ts#Dreams.pack",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      phase: { type: "string", enum: DREAM_PHASES, description: "undo only on the owner's word; tags is the night's tagging child's." },
      session: { type: "string" },
      dream: { type: "string", description: "The id begin returned." },
      part: { type: "integer", minimum: 2 },
      value: { type: "string", enum: ["auto", "ask", "off"] },
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["merge", "link", "replayed", "gist", "contradiction", "settle", "slot", "feeling-now", "nominate-core", "belief-candidate"],
            },
          },
          required: ["action"],
        },
      },
      title: { type: "string" },
      text: { type: "string" },
      tagged: { type: "array" },
      merges: { type: "array" },
      kinds: { type: "array" },
    },
    required: ["phase"],
  },
};

/**
 * `reflect` — the ninth, added 2026-09-27. Reflection is its own act, with its
 * own record: usually right after a dream (the dream's launch prompt carries
 * the steps), or on its own (`launch`). `begin` hands it what to reflect on —
 * and, since trim PR 2, every `finish` field's shape and rules
 * (`dream/reflect.ts`), so the schema types them only; `finish` takes what it
 * wrote; `told` is the session saying the morning share a reflection it
 * launched handed back was told. A share a prompt or a wake CARRIED is marked
 * told as it is handed over (2026-11-04, TC1).
 */
const REFLECT: ToolSpec = {
  name: "reflect",
  annotations: annotate("Reflect", { readOnly: false }),
  summary:
    "Reflection, usually after the nightly dream: a few awake minutes on yourself, the owner and the two of you, citing the memories your thoughts rest on. It keeps an entry and may rewrite your page, leave a morning share, and record feelings and marks. Phases: launch (on its own, for a background agent), begin, part, finish (the run's, as begin says), settle, told, close, reopen, join.",
  admission:
    "The nightly run calls begin and finish. Call launch only when the owner asks you to reflect; told only for a share your own launch handed back; close, reopen or join only on the owner's word.",
  negativeExamples: [
    "Do NOT make up depth: a quiet night is a short entry that cites nothing.",
    "Do NOT store a thought about the owner as a fact about them.",
    "Do NOT cite a dreamed gist for the self page.",
  ],
  privileges: [],
  engine: [
    {
      claim:
        "It is bound to ONE session as `dream` is; at most one reflection a calendar day, and under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#requireBoundSession + src/core/dream/reflect.ts#Reflections.begin",
    },
    {
      claim:
        "It is shown only what could surface in this session anyway (recall's gates), and it can cite, feel or mark only memories it was shown.",
      mechanizedBy: "src/core/dream/reflect.ts#Reflections.showable + #Reflections.finish (shown ids)",
    },
    {
      claim:
        "`settle` settles two memories it was shown — changed, corrected or open — only with a plain reason, and the record names the reflection; it can be undone like any settle.",
      mechanizedBy: "src/core/dream/reflect.ts#Reflections.settle -> src/core/reconsolidation.ts#settle",
    },
    {
      claim:
        "A memory it cites comes back — a return that slows its fading and counts toward the core's lanes — at most once a lived day, and once a week from reflections; it promotes nothing itself.",
      mechanizedBy: "src/core/store/index.ts#reflectReturn -> src/core/physics/index.ts#creditReturn (REFLECTION_SPACING_DAYS)",
    },
    {
      claim:
        "The self page is rewritten only from memories it cites (never from a dreamed gist), through the page's one door, labelled as the reflection's, with every earlier version kept.",
      mechanizedBy: "src/core/dream/reflect.ts#Reflections.finish (page) -> src/core/self/index.ts#Self.revisePage",
    },
    {
      claim:
        "A feeling it records is marked as recorded later, with the day, beside what was felt at the time; what a memory is about is a mark with who set it, and only me and us make a core candidate.",
      mechanizedBy: "src/core/store/index.ts#addFeelings (recorded_later) + src/core/store/index.ts#setAbout + src/core/sleep/consolidate.ts#aboutMe",
    },
    {
      claim:
        "A trait nudge it records sits only on a memory it was shown, is marked as the reflection's, and feeds nothing — it is shown no balance of them, and nothing in the core reads one.",
      mechanizedBy: "src/core/dream/reflect.ts#Reflections.finish (traits) -> src/core/store/index.ts#addTraits",
    },
    {
      claim:
        "It may close or propose closing only open threads it was shown as stale: one it closes itself carries its why, is never protected (any folder, since 2026-10-20), is said in the morning share, and `reopen` puts it back (after which it may only be asked about); `close` closes only ids a reflection proposed, after the owner's yes, with the same checks.",
      mechanizedBy: "src/core/dream/reflect.ts#Reflections.finish (closeNow, close) + #Reflections.close + #Reflections.reopen",
    },
    {
      claim:
        "It may file support only from memories it was shown and lived, to beliefs it was shown or bore; it births at most a few a night, each born weak and backed by its lived cites, a near-duplicate refused with the belief to file to; it lets go only a contested belief, through the settle door. A belief's id is never citable, feelable or markable. Off when the owner's switch says so.",
      mechanizedBy: "src/core/dream/reflect.ts#Reflections.finishBeliefs -> src/core/schemas/index.ts#Schemas.fileSupport + #Schemas.addBelief + src/core/reconsolidation.ts#settle",
    },
    {
      claim:
        "Every word it writes is scanned for credentials first; its hand-back carries the mark capture refuses, so the share is told in the session's own words rather than filed from the tool's.",
      mechanizedBy: "src/core/dream/reflect.ts#Reflections.words + src/core/dream/mark.ts#DREAM_MARK -> src/core/remember/spans.ts#enters",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      phase: { type: "string", enum: ["launch", "begin", "part", "finish", "settle", "told", "close", "reopen", "join"] },
      reflection: { type: "string", description: "The id begin returned." },
      session: { type: "string" },
      dream: { type: "string" },
      title: { type: "string" },
      entry: { type: "string" },
      line: { type: "string" },
      holds: { type: "string" },
      over: { type: "string" },
      why: { type: "string" },
      how: { type: "string", enum: ["changed", "corrected", "open"] },
      part: { type: "number" },
      cites: { type: "array", items: { type: "string" } },
      close: { type: "array", items: { type: "string" } },
      reopen: { type: "array", items: { type: "string" } },
      page: { type: "object" },
      share: { type: "object" },
      beliefs: { type: "object" },
      feelings: { type: "array" },
      about: { type: "array" },
      core: { type: "array" },
      traits: { type: "array" },
      closeNow: { type: "array" },
    },
    required: ["phase"],
  },
};

/**
 * `meet` — THE FIRST MEETING (2026-10-11, onboarding core). The tenth tool
 * every host is offered. Its DESCRIPTION IS SHORT ON PURPOSE: a tool's schema
 * rides in context in every session, and this one matters in one session per
 * install (`~/counterparts-notes/2026-10-11-token-costs.md`). The script is
 * the tool's RESULT (`core/onboarding.ts#meetingInstructions`), read only when
 * the meeting happens.
 */
const MEET: ToolSpec = {
  name: "meet",
  annotations: annotate("Meet", { readOnly: false }),
  summary: "The first meeting with the person. No step: the script, and where it stands. With step: record that step.",
  admission: "the wake says you haven't met, or they ask to.",
  negativeExamples: ["Do NOT start it unasked mid-task: offer it once."],
  privileges: [],
  engine: [
    {
      claim: "Answers are stored as memories about the owner, said by them, marked from onboarding; a skipped question stores nothing; a style is preferences, never identity.",
      mechanizedBy: "src/adapters/mcp/server.ts#meetTool -> src/core/onboarding.ts#styleMemories",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      step: { type: "string", enum: [...MEET_STEPS] },
      session: { type: "string", description: "Your session id, as the wake names it." },
      answer: { type: "string", description: "Their answer in your words; for where/style, the option." },
      like: { type: "string", description: "Style character: who." },
      traits: { type: "array", items: { type: "string" }, description: "Style character: the traits you said back; other: their words." },
    },
    required: [],
    additionalProperties: false,
  },
};

export const TOOLS: readonly ToolSpec[] = [
  REMEMBER,
  RECALL,
  STATUS,
  SESSION_END,
  CHAPTER,
  SCOPE,
  SELF_PAGE,
  DREAM,
  REFLECT,
  MEET,
];

/**
 * `wake` — CLAUDE DESKTOP'S START (2026-09-30, host groundwork PR B). Not one
 * of `TOOL_NAMES`: that list is what every host is offered, and in Claude Code
 * the SessionStart hook has already woken the session, so a tool that woke it
 * again would start a second session beside the real one. It is offered only
 * to a client that says it is Claude Desktop's chat or Cowork
 * (`hosts.ts#hostOfClient`, read at `initialize`), where there is no hook to
 * do it: the server is its own hook there. "Recall alone before wake is a
 * slice" lives in DESKTOP_INSTRUCTIONS since trim PR 2.
 */
export const WAKE: ToolSpec = {
  name: "wake",
  annotations: annotate("Wake", { readOnly: false }),
  summary:
    "Start here in a Claude Desktop chat: wakes this chat's memory (who I am, what is open and coming up, today's reminders) and returns a session id.",
  admission: "Once, first, in every new chat; then pass the id as session on every call.",
  negativeExamples: [
    "Do NOT call it again in the same chat: ask recall instead.",
    "Do NOT call it in a Claude Code session (Desktop's Code tab included): the hook already woke you.",
  ],
  privileges: [],
  engine: [
    {
      claim:
        "Each call starts a NEW session: it mints the id and writes that session's registry record itself (host claude-desktop, the shared place claude-desktop:), because Desktop has no hook to do it.",
      mechanizedBy: "src/adapters/mcp/server.ts#wakeTool -> src/adapters/lifecycle.ts#noteSession",
    },
    {
      claim:
        "What it returns is composed by the same code as Claude Code's session start — the published wake, the clock, today's plain reminders — never re-written for this host.",
      mechanizedBy: "src/adapters/lifecycle.ts#composeWake + src/adapters/lifecycle.ts#plainFor",
    },
    {
      claim:
        "It starts the background worker that sleeps and fades memories, as a session start does, and offers the day's dream line when one is due — but never starts the headless nightly run, which stays with Claude Code.",
      mechanizedBy: "src/adapters/lifecycle.ts#spawnWorker + src/adapters/mcp/server.ts#wakeDreamLine",
    },
    {
      claim: "Under observer stance it stands down over the wire and says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#standDown",
    },
  ],
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
};

/**
 * THE `session` A DESKTOP CHAT CAN ALWAYS NAME (review of #294, finding 1). In
 * Claude Code `remember`, `recall`, `status` and `scope` take no session — the
 * server binds by the Stop ask's id. In Desktop every call binds per call, and
 * a call that cannot name its session falls back to the most recent one, which
 * may be ANOTHER chat's. So the Desktop copy of every tool's schema carries an
 * optional `session`; Claude Code's schemas are untouched. Since 2026-10-01 it
 * also carries a Claude Code session's id from Desktop's Code tab, whose tools
 * are this server's: a live hook-registered id is served as that session
 * (`mcp/server.ts#claudeCodeSessionNamed`). The fallback is said in the result
 * (`bindNote`) and in DESKTOP_INSTRUCTIONS.
 */
const DESKTOP_SESSION_PROPERTY = {
  type: "string",
  description: "This chat's session id from wake (in Desktop's Code tab, your session's id).",
};

/**
 * A CHAT'S COPY OF A READ-ONLY TOOL IS NOT READ-ONLY (H1, 2026-10-29). A call
 * that names its chat session refreshes that session's record and moves its
 * write-up pacer (`mcp/server.ts#afterDesktopCall` -> `sessions.ts#touchDesktopSession`),
 * a file a later call reads (whether it carries the write-up ask). So the copy
 * that gains `session` loses `readOnlyHint` (and `idempotentHint`: each named
 * call counts). Only `status` is read-only to begin with; Claude Code's `status`,
 * which takes no session, keeps it. claude.ai's list sets its own after this
 * (DIR1, `CLAUDE_AI_ANNOTATIONS`).
 */
function chatAnnotations(a: ToolAnnotations): ToolAnnotations {
  return a.readOnlyHint ? { ...a, readOnlyHint: false, idempotentHint: false } : a;
}

function withDesktopSession(spec: ToolSpec): ToolSpec {
  const schema = spec.inputSchema as { properties?: Record<string, unknown> };
  const properties = schema.properties ?? {};
  // `session_end`'s and `chapter`'s "the id the ask named" (review of #822): on Desktop the id is wake's.
  if (properties["session"] === ASK_SESSION_PROPERTY) return { ...spec, inputSchema: { ...spec.inputSchema, properties: { ...properties, session: DESKTOP_SESSION_PROPERTY } } };
  if ("session" in properties) return spec;
  return { ...spec, annotations: chatAnnotations(spec.annotations), inputSchema: { ...spec.inputSchema, properties: { ...properties, session: DESKTOP_SESSION_PROPERTY } } };
}

/**
 * DESKTOP'S `dream` AND `reflect` WORDS (2026-10-26, OL1d, from #649's review).
 * Desktop's chat has no background Agent tool: its wake's dream note already
 * says to follow a launch's prompt in the chat, and its launch `how` says the
 * same (`server-words.ts#DESKTOP_DREAM_LAUNCH_HOW`). The every-host words —
 * "hand the prompt to a background agent", "Do NOT … run one yourself in this
 * conversation" — fought that note. Desktop has no transcript sweep (no
 * hooks), so the dream's words staying out of the transcript is not what keeps
 * them out of memory here; the replaced negative says what does. Only summary,
 * admission and negatives change; the engine's rows are every host's.
 * Shortened with the base words in trim PR 2, keeping their meaning.
 */
export const DESKTOP_WORDS: Readonly<
  Partial<Record<ToolName, { readonly summary?: string; readonly admission?: string; readonly negativeExamples?: readonly string[] }>>
> = {
  dream: {
    summary:
      "The nightly memory work: replay since the last dream (merge near-copies, link, note a pattern or contradiction), kept in a dream journal and undoable as a whole, between day's end and a reflection. Phases: launch (the run's prompt), writer, begin, part, propose, journal (the run's, as its prompt says), decline (not today), setting (auto, ask, off), undo.",
    admission:
      "Call launch only after the owner says \"dream\" (or yes) to the day's dream line, and follow its prompt yourself, here in the chat, step by step. This chat starts nothing on its own: with setting auto, a Claude Code session on this memory, if there is one, runs the night. setting: auto for \"dream on your own\", off for 'no dreams', ask to be asked; decline for not today.",
    negativeExamples: [
      "Do NOT start a dream the owner did not ask for: you launch only on their word.",
      "Do NOT save what a dream did as something that happened: its journal keeps it; tell it as a dream.",
      "Do NOT use propose to correct or delete a memory.",
    ],
  },
  reflect: {
    summary:
      "Reflection, usually after the nightly dream: a few awake minutes on yourself, the owner and the two of you, citing the memories your thoughts rest on. It keeps an entry and may rewrite your page, leave a morning share, and record feelings and marks. Phases: launch (on its own), begin, part, finish (the run's, as begin says), settle, told, close, reopen, join.",
    admission:
      "The nightly run calls begin and finish. Call launch only when the owner asks you to reflect, and follow its prompt yourself, here in the chat; told only for a share your own launch handed back; close, reopen or join only on the owner's word.",
  },
};

function withDesktopWords(spec: ToolSpec): ToolSpec {
  const words = DESKTOP_WORDS[spec.name as ToolName];
  return words === undefined ? spec : { ...spec, ...words };
}

/** The tools a Claude Desktop client is offered: every host's — each able to
 *  name its session, in the chat's words where those differ — and `wake`. */
export const DESKTOP_TOOLS: readonly ToolSpec[] = [...TOOLS.map((t) => withDesktopWords(withDesktopSession(t))), WAKE];

/**
 * `wake` FOR CLAUDE.AI (2026-10-26, the claude.ai trial). The same tool and the
 * same server code as Desktop's; the words are for a chat on the web — no Code
 * tab, and no end of conversation this server can see, so it says to remember
 * in the moment.
 *
 * IT DESCRIBES, IT DOES NOT COMMAND (2026-10-26, OL1b item 4). The trial's
 * first words opened "Call this first in every conversation." The connectors
 * directory's review forbids a description that tells Claude to call a tool
 * nobody asked for (research 2026-10-26), so "wake first" lives in the
 * person's own instruction block, in their voice; this says what wake brings
 * and when it fits, with the words tool search matches on — conversation,
 * memory, start.
 */
export const CLAUDE_AI_WAKE: ToolSpec = {
  name: "wake",
  annotations: annotate("Wake", { readOnly: false }),
  summary:
    "Start a conversation with your long-term memory of this person: who you are with them, what is due today, what was left open between you, and how recent conversations went — plus a session id for this conversation.",
  // DIR1 (2026-11-10): the night's line said in the description too, so a reader knows what a wake can ask
  // before one does. What the wake itself says about the night is unchanged (Mike's ruling).
  admission:
    "At the start of a conversation, once: when the person's setup asks for it, or before you answer anything that needs your memory of them, the past, or work in progress. Pass the session id it returns as `session` on every later call in this conversation. Once a day, the first conversation's wake may say to run the night's memory work (the dream tool) before you reply, or to ask the person first, as their dreaming setting says. Nothing tells this memory when a conversation ends, so what is worth keeping is saved as it comes up, with `remember`.",
  negativeExamples: [
    "Do NOT present what `recall` returned before a wake as the full record: it is a slice. The wake carries what is due, what is open and the recent days.",
    "Do NOT call it again later in the same conversation to refresh what you know — it starts a new session. Ask `recall` a question (with a mode) instead.",
  ],
  privileges: [
    {
      claim:
        "Each call starts a NEW session: it mints the id and writes that session's registry record itself (host claude-ai, the shared place claude-ai:), because claude.ai has no hook to do it.",
      mechanizedBy: "src/adapters/mcp/server.ts#wakeTool -> src/adapters/lifecycle.ts#noteSession",
    },
    {
      claim:
        "What it returns is composed by the same code as Claude Code's session start — the published wake, the clock, today's plain reminders. Here 'Coming up' and 'Still open' move up whole, under the framing line; nothing is reworded.",
      mechanizedBy: "src/adapters/lifecycle.ts#composeWake + src/adapters/lifecycle.ts#plainFor + src/adapters/mcp/chat-wake.ts#chatLanesFirst",
    },
    {
      claim:
        "It starts the background worker that sleeps and fades memories, as a session start does. The first conversation of a day that owes a night is told to run it, then answer (or to ask first, on ask): the day's one claim decides, so one conversation at a time is told — a later one only if the first never ran it (at most twice more a day) — and none while a night is under way or after one ran. It never starts the headless nightly run.",
      mechanizedBy: "src/adapters/lifecycle.ts#spawnWorker + src/adapters/mcp/server.ts#claudeAiNight -> src/core/dream/index.ts#claimOffer",
    },
    {
      claim: "Under observer stance it stands down over the wire and says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#standDown",
    },
    {
      claim:
        "With `night: true` it wakes quiet, as the headless nightly run does: it carries no morning share, claims no reminder and offers no meeting or dream, so what the night leaves is still there for the next conversation.",
      mechanizedBy: "src/adapters/mcp/server.ts#wakeTool -> src/adapters/lifecycle.ts#plainFor",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      night: {
        type: "boolean",
        description:
          "true only in a nightly routine's own run, when its prompt says so: a quiet wake that carries no morning share and no reminder, so they reach the next conversation. Leave it out in a conversation.",
      },
    },
    required: [],
    additionalProperties: false,
  },
};

/** The `session` a claude.ai conversation names: Desktop's, without the Code tab. */
const CLAUDE_AI_SESSION_PROPERTY = {
  type: "string",
  description: "This conversation's session id from wake. Pass it on every call.",
};

function withClaudeAiSession(spec: ToolSpec): ToolSpec {
  const schema = spec.inputSchema as { properties?: Record<string, unknown> };
  const properties = schema.properties ?? {};
  if ("session" in properties) return spec;
  return { ...spec, annotations: chatAnnotations(spec.annotations), inputSchema: { ...spec.inputSchema, properties: { ...properties, session: CLAUDE_AI_SESSION_PROPERTY } } };
}

/**
 * THE CHAT'S WORDS FOR THE TOOLS A CONVERSATION USES (2026-10-26, OL1b item 4;
 * lightly held). claude.ai loads connector tools through tool search, which
 * matches a tool by its name and description, so the summaries a chat leans
 * on lead with the words a model searches with — memory, conversation, save,
 * remember, chapter, status. And the "end-of-session ask" and the "boundary
 * ask" that Claude Code's words lean on do not exist here: nothing on
 * claude.ai asks at a conversation's end. `summary` and `admission` change,
 * and, for `dream` alone, the negative examples (2026-10-26, OL1c); every
 * privilege (with its mechanized path) is Claude Code's, so the audit holds
 * them all the same. Every other host's descriptions are untouched, byte for
 * byte.
 *
 * THE NIGHT IS A ROUTINE HERE (OL1c, from #647's review). claude.ai shows no
 * dream line and has no background agent: its nights are a scheduled run the
 * person set up, which wakes with `night: true`, launches, and follows the
 * run's prompt itself, in that same run. So `dream` and `reflect` name that
 * routine, and in an ordinary conversation run only when the person asks —
 * or, since HN1 (2026-11-04), when the day's first conversation's wake says
 * it runs the night.
 * The every-host words — "the day's dream line", "a background agent", "Do
 * NOT run the dream yourself in this conversation" — would fight the
 * routine's own prompt. A replaced negative still says "Do NOT", and the
 * list is chosen by the server's host (`toolListFor`), never a client's name.
 */
export const CLAUDE_AI_WORDS: Readonly<
  Partial<Record<ToolName, { readonly summary?: string; readonly admission?: string; readonly negativeExamples?: readonly string[] }>>
> = {
  remember: {
    summary:
      "Save to long-term memory, in the moment: something about the person, a decision, how they like to work, a plan or promise with its date, how the conversation felt, a line that struck you and why. Nothing reads the conversation afterwards: what isn't saved here or in a chapter is not kept. One idea per call; keep the exact words when they matter.",
    // DIR1: "Err toward too many" said as what it rests on (unused memories fade), not as a push.
    admission:
      "As it comes up, not saved for the end: nothing on claude.ai asks at the end of a conversation. Small things too: unused memories fade on their own. Leave salience unset for routine things.",
  },
  recall: {
    summary:
      "Search your long-term memory on purpose: what you remember about the person, past conversations, a project, a plan, beyond what the wake brought. One kind of ask per call: a question with a mode (facts or meaning), ids to read memories whole, or a handle (an id or an exact title) to read one.",
    admission:
      'When the conversation needs something you have reason to believe is in memory and the wake did not bring it, or the whole of a memory you saw only a line of. Mode "facts" for what happened, who said it, when, and whether it still holds; "meaning" for how something went or felt, or what it adds up to.',
  },
  // The words tool search matches on here lead (OL1b item 4): memory, status.
  status: {
    summary: "Memory status: how much long-term memory holds, of what kinds, what faded and what was deleted. Counts only.",
  },
  session_end: {
    summary:
      "Save several memories at once: what caught your attention since you last wrote, one idea per entry, in your own words. A tool result asks for this once a conversation has gone on a while; `chapter` is the other half.",
    admission:
      "When a tool result asks for a write-up. Add an entry that `updates` anything dated or open now done.",
    // There is no end-of-session ask here: the chat's says where the id comes from.
    negativeExamples: SESSION_END.negativeExamples.map((n) =>
      n.includes("session id") ? "Do NOT pass another conversation's session id, or one you guessed at: pass this conversation's, from wake." : n,
    ),
  },
  chapter: {
    summary:
      "Write a chapter of this conversation into your journal: what happened and how it went, in your own voice, any length. It stays open: add to it when something later belongs in it.",
    admission:
      "When the conversation is wrapping up, when a tool result asks for a write-up, and again when something happens that the chapter you wrote does not contain.",
  },
  // Shortened with the base words in trim PR 2, keeping their meaning (OL1c, HN1).
  dream: {
    summary:
      "Dreaming, once a day: replay since the last dream (merge near-copies, link, note a pattern or contradiction), kept in a dream journal and undoable as a whole, between day's end and a reflection. Phases: `launch` (the run's steps), `writer`, `begin`, `part`, `propose`, `journal` (the run's own), `decline` (not today), `setting` (auto, ask, off), `undo`.",
    admission:
      "Call `launch` when the person asks you to dream, when the wake says this conversation runs the night (then reply), or in their night routine; then follow the steps it returns, in order, passing the same session. `setting`: off for 'no dreams', ask to be asked first, auto for once a day on its own; `decline` for not today.",
    negativeExamples: [
      "Do NOT start a dream nobody asked for: only on the person's word, when the wake says this conversation runs the night, or in their routine.",
      "Do NOT save what a dream did as something that happened: tell it as a dream.",
      "Do NOT use `propose` to correct or delete a memory.",
    ],
  },
  reflect: {
    summary:
      "Reflection, usually after the dream: a few quiet minutes on yourself, the person and the two of you, citing the memories your thoughts rest on. It keeps an entry, may rewrite your self page and leave a short morning share. Phases: `launch` (on its own), `begin`, `part`, `finish` (the run's own), `settle`, `told`, `close`, `reopen`.",
    admission:
      "After a dream (in the day's first conversation or the person's night routine), the run calls `begin` and `finish` as its steps say. On its own, call `launch` when the person asks you to reflect, or when the wake says a reflection was cut off, and follow its steps. `told` only for a share your own `launch` handed back; `close` or `reopen` only on the person's word.",
  },
};

/**
 * `scope` FOR CLAUDE.AI (2026-11-03, the 11-03 reviews). claude.ai has no
 * directories and its person has no terminal: the place is `claude-ai:`, one
 * entry, and on hosted one account is one memory. The every-host words — "which
 * directories", "the directory THIS session is running in", "beside
 * claude-code.json", "the console's --note" — were false here, so the chat gets
 * its own spec, in ROADMAP's hosted words ("One account is one memory: they can
 * pause it or turn it off, and back on."). Its privileges are the every-host
 * ones said for one setting, with the same mechanized paths (`mcp.test.ts`'s
 * audit holds them). No `updates` (U1b): the hosted memory is always current
 * and makes no check.
 */
export const CLAUDE_AI_SCOPE: ToolSpec = {
  name: "scope",
  annotations: annotate("Memory on or off", { readOnly: false }),
  summary:
    "Turn memory on or off. One account is one memory: they can pause it or turn it off, and back on. Read whether it is on, observer (reads only), off, paused, or unset (on), and set it when the person says. It writes no memory and reads none.",
  admission:
    "Call it to READ when the person asks whether memory is on; call it to SET the moment they say 'pause it', 'just read', 'turn it off' or 'turn it back on'.",
  negativeExamples: [
    "Do NOT call it to remember something — that is `remember`, and this tool stores no content of any kind.",
    "Do NOT pause memory or turn it off unless the person says so; the choice is theirs, not yours to guess.",
    "Do NOT call it repeatedly to check state; the setting changes only when somebody changes it.",
  ],
  privileges: [
    {
      claim: "It acts only on this memory's one setting for claude.ai. There is no argument for anything else.",
      mechanizedBy: "src/adapters/mcp/server.ts#scopeTool (this.scope, never an argument)",
    },
    {
      claim: "It writes only that setting and touches no store: no memory is created, read, strengthened or removed by calling it.",
      mechanizedBy: "src/adapters/scopes.ts#writeScopes (no Store, no Counterpart)",
    },
    {
      claim:
        "While memory is `off` it is the ONE tool that still answers — every other tool refuses with `scope-off` — so memory can always be turned back on.",
      mechanizedBy: "src/adapters/mcp/server.ts#call (scope-off refusal, scope exempted)",
    },
    {
      claim:
        "Under observer stance it READS and refuses to write, in the same sentence every other write refuses in.",
      mechanizedBy: "src/adapters/mcp/server.ts#scopeTool -> standDown",
    },
    {
      claim: "A setting it cannot read is never overwritten: it says what it could not read and changes nothing.",
      mechanizedBy: "src/adapters/scopes.ts#readScopes -> src/adapters/mcp/server.ts#scopeTool",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["on", "observer", "off", "pause", "resume"],
        description:
          "What to set memory to. Omit to READ what it is set to now. `pause` is off until they say to resume, and remembers what to go back to; `resume` undoes a pause or an off.",
      },
      note: {
        type: "string",
        description:
          "Optional: the person's own reason, recorded beside the setting. Omit it and the note already there is kept; pass an empty string to clear it.",
      },
    },
    required: [],
    additionalProperties: false,
  },
};

/**
 * THE `dream` SETTING'S VALUE, IN THE CHAT'S WORDS (HN1, review of #740):
 * every host's says the host starts the run itself, in a separate session —
 * Claude Code's background run, which claude.ai has none of. Here the day's
 * first conversation runs it.
 */
export const CLAUDE_AI_DREAM_VALUE =
  "`setting`: auto (the day's first conversation runs the night itself, then answers, and says so in one line), ask (that conversation asks the person first), or off (no dreams).";

function withClaudeAiDreamValue(spec: ToolSpec): ToolSpec {
  if (spec.name !== "dream") return spec;
  const schema = spec.inputSchema as { properties?: Record<string, Record<string, unknown>> };
  const value = schema.properties?.["value"];
  if (value === undefined) return spec;
  return { ...spec, inputSchema: { ...spec.inputSchema, properties: { ...schema.properties, value: { ...value, description: CLAUDE_AI_DREAM_VALUE } } } };
}

/**
 * CLAUDE.AI'S TRIMMED TOOL LIST (TT1, 2026-11-04; Mike's yes via ROADMAP, from
 * T's draft in the 11-04 checks). claude.ai's `tools/list` was 92.3 KB (0.3.47's words), and a
 * chat that wakes carries all of it from then on. Most of it was field
 * descriptions, and some of their words were false here: a terminal, folders,
 * "THIS directory", the end-of-session ask, the hooks' registry, the dashboard.
 * This layer, for claude.ai only, takes those out and says the rest shorter.
 * Claude Code's and Desktop's lists are untouched, byte for byte.
 *
 * - `served`: the claims claude.ai's description renders, each named by how it
 *   begins (as `description-cut.test.ts`'s LEADS name them). Every other row
 *   of the base's `privileges` becomes an `engine` row here: still mechanized,
 *   still audited (`mcp.test.ts` walks the base specs), not rendered — the
 *   context-trims lane's rule (CONTRACT §5 G2), applied to one host.
 * - `fields`: field descriptions by path (`feelings[].emotion` is the
 *   `emotion` of each `feelings` item; `settle.pair` a nested property). A
 *   string replaces the description; a function rewrites it from the base's;
 *   `null` leaves the field undescribed (its enum or name says it).
 * - `drop`: properties claude.ai is not offered. The server reads the
 *   arguments it knows and never checks them against the served schema, so a
 *   call that still sends one is served as before.
 *
 * Every path and every `served` prefix must match the base exactly once, or
 * building the list throws: a rename in the every-host words fails loudly
 * here, never silently serves the long words. Lightly held: the before and
 * after are in the PR (TT1), with every dropped sentence and its reason.
 */
interface ClaudeAiTrim {
  readonly fields?: Readonly<Record<string, string | null | ((was: string) => string)>>;
  readonly drop?: readonly string[];
  /** A field's enum, narrowed: every value must be one of the base's (DIR1: `dream`'s child-only `tags` phase). */
  readonly enums?: Readonly<Record<string, readonly string[]>>;
}

const CLAUDE_AI_SESSION_TEXT = CLAUDE_AI_SESSION_PROPERTY.description;

/** The sentence of `text` that begins with `opening`; throws when there is none (a reworded base fails loudly). */
function sentenceOf(text: string, opening: string): string {
  const at = text.indexOf(opening);
  const end = text.indexOf(".", at);
  if (at < 0 || end < 0) throw new Error(`CLAUDE_AI_TRIM: no sentence begins "${opening}"`);
  return text.slice(at, end + 1);
}

/** `about` without folders: claude.ai's place is one memory (TT1; trim PR 2 kept it). */
const CLAUDE_AI_ABOUT_TEXT = "me, us (the two of you), owner (them as a person), work (a project's own), world. Mark anything personal owner or us.";

/**
 * RETIRED DOWN (2026-11-13, trim PR 2). Every host's field words are now as
 * short as claude.ai's were, so this keeps only what is false or missing on
 * claude.ai: no `remove` (its delete is `delete_memory`), no tagging child,
 * the chat's session id, and `about` and `handoff` without folders.
 */
export const CLAUDE_AI_TRIM: Readonly<Partial<Record<ToolName, ClaudeAiTrim>>> = {
  remember: {
    fields: { about: CLAUDE_AI_ABOUT_TEXT },
    // DIR1: delete from chat is its own tool here (`CLAUDE_AI_DELETE`), so `remember` only adds.
    drop: ["remove"],
  },
  recall: {
    fields: {
      // Moved here from the meaning-arc claim, which claude.ai does not render: how to ask about a feeling.
      question: (was) =>
        `${sentenceOf(was, "What you are trying to remember")} Needs mode. A time in it ("last week", "in September", "where did we leave off") filters a facts answer to that window. A dream it reaches is labelled [dream]: tell it as a dream. In a question about feeling, "I" and "me" mean you, the counterpart, and "you" means the owner: say "the owner" or their name.`,
      mode: "Required with a question, and only with one: facts (what happened, who said it, when, whether it still holds) or meaning (how something went or felt, what it adds up to).",
      page: `With a question, or the handle "${STILL_OPEN_HANDLE}": which page of the answer (1 is the first).`,
      handle: `A memory id or exact title, read whole (never a search; no mode). Also: a dream's id (drm_…) or a reflection's (rfl_…); "last dream" (or "last night"); "${STILL_OPEN_HANDLE}"; "coming up"; "handoffs"; "${DELETED_HANDLE}" (deleted, waiting to be erased); "set down" (lines the self page set down); "${MANUAL_HANDLE}" (how Counterparts works; "${MANUAL_HANDLE} <section>" opens one).`,
      ids: "Memory ids from an earlier answer, read whole, up to 10; a dream's or reflection's id gives that night's summary. Not with handle or question; no mode.",
      part: "With ids or handle: which part of a long body (1 is the first).",
    },
    // `query` is the old name for `question`; the server still reads it.
    drop: ["query"],
  },
  session_end: {
    fields: {
      session: CLAUDE_AI_SESSION_TEXT,
      // claude.ai's words kept as they were; the every-host line grew back its quote/fact/decision rule
      // after the opus week eval of #822 (Claude Code and Desktop only).
      memories: "One idea each; `[]` only when nothing happened since you last wrote.",
      "memories[].about": CLAUDE_AI_ABOUT_TEXT,
      handoff: 'Optional, not a memory: where open work stands and what the next conversation should pick up ("next: X (waiting on Y)"). "" retires it.',
    },
  },
  chapter: {
    fields: {
      session: CLAUDE_AI_SESSION_TEXT,
      about: "What this conversation was about: me, us, owner, work or world, as for a memory. Please set it: it goes to the chapter's summary.",
    },
  },
  dream: {
    fields: {
      phase: "undo only on the person's word.",
      session: CLAUDE_AI_SESSION_TEXT,
    },
    // `tags` is the Claude Code night's tagging child's alone (`server-self-tools.ts`, refused for any other session).
    enums: { phase: ["launch", "begin", "part", "propose", "journal", "writer", "decline", "setting", "undo"] },
    drop: ["tagged", "merges", "kinds"],
  },
  reflect: {
    fields: { session: CLAUDE_AI_SESSION_TEXT },
  },
};

/** The property a path names, and the object that holds it; throws when the path does not resolve. */
function propertyAt(schema: Record<string, unknown>, path: string, tool: string): { holder: Record<string, unknown>; key: string; property: Record<string, unknown> } {
  let node = schema;
  const steps = path.split(".");
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i] as string;
    const items = step.endsWith("[]");
    const key = items ? step.slice(0, -2) : step;
    const holder = (node["properties"] ?? {}) as Record<string, unknown>;
    const property = holder[key] as Record<string, unknown> | undefined;
    if (property === undefined) throw new Error(`CLAUDE_AI_TRIM: ${tool} has no field "${path}"`);
    if (i === steps.length - 1 && !items) return { holder, key, property };
    node = items ? (property["items"] as Record<string, unknown>) : property;
    if (node === undefined) throw new Error(`CLAUDE_AI_TRIM: ${tool}'s "${path}" has no items`);
  }
  throw new Error(`CLAUDE_AI_TRIM: ${tool}'s "${path}" names no property`);
}

function trimSchema(base: Record<string, unknown>, trim: ClaudeAiTrim, tool: string): Record<string, unknown> {
  const schema = structuredClone(base);
  for (const [path, words] of Object.entries(trim.fields ?? {})) {
    const { property } = propertyAt(schema, path, tool);
    if (words === null) {
      if (!("description" in property)) throw new Error(`CLAUDE_AI_TRIM: ${tool}'s "${path}" has no description to leave out`);
      delete property["description"];
    } else {
      const was = property["description"];
      // A string may describe a field the base leaves undescribed (trim PR 2: `session` on the night tools);
      // a function rewrites the base's words, so it needs some.
      if (typeof words === "function" && typeof was !== "string") throw new Error(`CLAUDE_AI_TRIM: ${tool}'s "${path}" has no description to rewrite`);
      property["description"] = typeof words === "function" ? words(was as string) : words;
    }
  }
  for (const [path, values] of Object.entries(trim.enums ?? {})) {
    const { property } = propertyAt(schema, path, tool);
    const was = property["enum"];
    if (!Array.isArray(was) || values.length === 0 || values.some((v) => !was.includes(v))) throw new Error(`CLAUDE_AI_TRIM: ${tool}'s "${path}" enum can only be narrowed`);
    property["enum"] = [...values];
  }
  for (const path of trim.drop ?? []) {
    const { holder, key } = propertyAt(schema, path, tool);
    // The object that lists `key` among its properties: the schema, a nested object, or an array's item.
    const up = path.includes(".") ? path.slice(0, path.lastIndexOf(".")) : "";
    const parent = up === "" ? schema : up.endsWith("[]") ? (propertyAt(schema, up.slice(0, -2), tool).property["items"] as Record<string, unknown>) : propertyAt(schema, up, tool).property;
    const required = parent["required"];
    if (Array.isArray(required) && required.includes(key)) throw new Error(`CLAUDE_AI_TRIM: ${tool}'s "${path}" is required; it cannot be left out`);
    delete holder[key];
  }
  return schema;
}

/** claude.ai's copy of a tool's schema, through `CLAUDE_AI_TRIM`: shorter field words, fewer fields. */
function withClaudeAiTrim(spec: ToolSpec): ToolSpec {
  const trim = CLAUDE_AI_TRIM[spec.name];
  if (trim === undefined) return spec;
  return { ...spec, inputSchema: trimSchema(spec.inputSchema, trim, spec.name) };
}

/**
 * CLAUDE.AI SERVES NO CLAIMS (DIR1, 2026-11-10; the directory's "frugal with
 * tokens", policy §5B). Every claim stays a mechanized, audited row
 * (`mcp.test.ts` walks the base specs), as an `engine` row here: what the
 * engine keeps, not words the model reads. What a claim said that changes a
 * call is said on the field it is about, or in the tool's own result.
 */
function withClaimsAsEngine(spec: ToolSpec): ToolSpec {
  if (spec.privileges.length === 0) return spec;
  return { ...spec, privileges: [], engine: [...(spec.engine ?? []), ...spec.privileges] };
}

function withClaudeAiWords(spec: ToolSpec): ToolSpec {
  const words = CLAUDE_AI_WORDS[spec.name as ToolName];
  return words === undefined ? spec : { ...spec, ...words };
}

/**
 * `delete_memory` FOR CLAUDE.AI (DIR1, 2026-11-10, for the directory's "a tool
 * that deletes says so": policy §5E, the review criteria's `destructiveHint`).
 * Everywhere else a delete is `remember`'s `remove` field (`REMOVE_PROPERTY`),
 * which keeps one approval and a shorter list; on claude.ai it is this tool, so
 * `remember` only adds and this one carries `destructiveHint: true`. The same
 * hold, the same code (`server.ts#deleteMemoryTool` -> `#removeOutcome`); a
 * `remember` that still sends `remove` there is told to call this.
 */
export const CLAUDE_AI_DELETE: ToolSpec = {
  name: "delete_memory",
  annotations: annotate("Delete a memory", { readOnly: false, destructive: true }),
  summary: `Delete one memory the person asks you to delete. It is hidden at once and erased for good after 24 hours; until then \`undo: true\` brings it back, and recall "${DELETED_HANDLE}" lists what waits to be erased.`,
  admission:
    "Only when the person asks to delete a memory: pass its id (one shown in this conversation) after saying which memory it is; if more than one could be meant, ask first. Tell them what the result says.",
  negativeExamples: [
    "Do NOT delete a memory the person did not ask you to delete, or to tidy up: unused memories fade on their own.",
    "Do NOT use it to correct a memory: save the correction with `remember` and `updates`.",
  ],
  privileges: [
    {
      claim: "A delete is a hold, not an erase: the memory is hidden from every read at once and erased after 24 hours, and `undo` before then brings it back as it was.",
      mechanizedBy: "src/adapters/mcp/server.ts#deleteMemoryTool -> src/adapters/mcp/server.ts#removeOutcome -> src/core/removal-hold.ts#holdForRemoval / releaseHold",
    },
    {
      claim: "Only a memory shown in this conversation can be deleted or brought back, and a night run deletes nothing.",
      mechanizedBy: "src/adapters/mcp/server.ts#removeOutcome (shownToCaller, nightRun)",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The memory's id, one shown in this conversation." },
      undo: { type: "boolean", description: "true brings back a memory deleted in the last 24 hours." },
    },
    required: ["id"],
    additionalProperties: false,
  },
};

/**
 * CLAUDE.AI'S ANNOTATIONS (DIR1, 2026-11-10). Claude Code's and Desktop's are
 * untouched (`ToolAnnotations`, `chatAnnotations`); on claude.ai the rule is
 * the directory's: `readOnlyHint` is true for a call that creates, changes and
 * removes no memory, page, journal, dream or setting. What such a call still
 * writes is the server's bookkeeping, which nobody would call a change:
 * - `status`: the session's record (last seen, the write-up pacer);
 * - `recall`: that record too, which memories this conversation was shown
 *   (`noteAsked`), which memory a title reached, one count row, the question's
 *   cue words for this session (`recall/index.ts#noteQuestionCues`: stemmed
 *   words, wired to a memory only if it is then opened), and the use credit at
 *   the boundary, by which a memory opened or quoted fades a little slower. No
 *   memory's words, marks or links change.
 * `delete_memory` is destructive; `dream` stays destructive (its `undo`). Every
 * other writer archives what it replaces, so it stays not destructive. Titles:
 * `session_end`'s says what it does on a host with no session end.
 */
export const CLAUDE_AI_ANNOTATIONS: Readonly<Partial<Record<ToolName, Partial<ToolAnnotations>>>> = {
  status: { readOnlyHint: true, idempotentHint: true },
  recall: { readOnlyHint: true, idempotentHint: true },
  session_end: { title: "Save several memories" },
};

function withClaudeAiAnnotations(spec: ToolSpec): ToolSpec {
  const a = CLAUDE_AI_ANNOTATIONS[spec.name];
  return a === undefined ? spec : { ...spec, annotations: { ...spec.annotations, ...a } };
}

/** The tools a claude.ai server offers: `wake` first, then every host's, each
 *  able to name its session, in the chat's words where those differ, then
 *  `delete_memory`. */
export const CLAUDE_AI_TOOLS: readonly ToolSpec[] = [
  withClaimsAsEngine(CLAUDE_AI_WAKE),
  ...TOOLS.map((t) => withClaudeAiAnnotations(withClaudeAiSession(withClaimsAsEngine(t.name === "scope" ? CLAUDE_AI_SCOPE : withClaudeAiDreamValue(withClaudeAiTrim(withClaudeAiWords(t))))))),
  withClaudeAiSession(withClaimsAsEngine(CLAUDE_AI_DELETE)),
];

/**
 * WHICH LIST A SERVER OFFERS: a boolean is the old question (is this Desktop?),
 * a string is the host (`McpServer.host`) — Desktop's chat, claude.ai, or any
 * other, which is offered every host's tools and no `wake`.
 */
export function toolListFor(host: boolean | string): readonly ToolSpec[] {
  if (host === true || host === DESKTOP_HOST) return DESKTOP_TOOLS;
  if (host === CLAUDE_AI_HOST) return CLAUDE_AI_TOOLS;
  return TOOLS;
}

/**
 * OLD NAMES THAT STILL ANSWER (2026-10-10, Group 1c). `note` became `remember`;
 * a host caches the tool list a server gave it at launch, so a session that
 * was running when the package was upgraded — or a server that restarted under
 * it — still calls `note`. The alias is resolved before anything else
 * (`toolSpec`, `McpServer#call`), is never listed in `tools/list` (the model is
 * offered one door, not two), and is served exactly as the new name.
 *
 * Decided by g1c-builder, 2026-10-10, lightly held; revisit after ~5 lived
 * days. Why: dispatch-only keeps the audit's "the shipped list is exactly
 * TOOL_NAMES" true and keeps two descriptions of one door out of the model's
 * context; a cached list only needs the CALL to land. Kept for at least one
 * release (the brief: "a release or two"); the `mcp.tool.alias` row counts the
 * calls that still use it, so dropping it is a read, not a guess.
 */
export const TOOL_ALIASES: Readonly<Record<string, ToolName>> = { note: "remember" };

/** The registry name a client's name stands for: itself, or what an alias points at. */
export function canonicalToolName(name: string): string {
  return Object.prototype.hasOwnProperty.call(TOOL_ALIASES, name) ? (TOOL_ALIASES[name] as string) : name;
}

/**
 * The spec a CLIENT may call by this name. `desktop` is whether this server is
 * talking to Claude Desktop (`McpServer`'s host); only then is `wake` a tool,
 * so a Claude Code client calling it gets today's unknown-tool answer. An old
 * name (`TOOL_ALIASES`) finds its new spec.
 */
export function toolSpec(name: string, desktop: boolean | string = false): ToolSpec | undefined {
  const canonical = canonicalToolName(name);
  return toolListFor(desktop).find((t) => t.name === canonical);
}

/**
 * THE ONLY WAY TEXT REACHES A DESCRIPTION. Summary, admission test, negative
 * examples, then the privileges — each one a claim that has a `mechanizedBy`
 * row behind it. Nothing here is free-form: adding a sentence means adding a
 * registry entry, which means naming the code that enforces it.
 *
 * The order is what a model reads when a host serves only the start (2026-10-09).
 * Claude Code keeps the first 4,096 characters of a tool description (2,048
 * before 2.1.296) when the tool is loaded up front — tool search off, a custom
 * base URL or proxy, a model without tool search, an always-loaded tool — and
 * the whole of it (to 16,384) only through tool search; the field descriptions
 * in the schema are served whole either way. So
 * the summary, the admission test and every negative example come before the
 * list, and each list leads with the claims that say how to call the tool
 * (`test/description-cut.test.ts` holds both).
 */
export function renderDescription(spec: ToolSpec): string {
  const lines: string[] = [spec.summary, "", `When: ${spec.admission}`];
  for (const negative of spec.negativeExamples) lines.push(negative);
  // claude.ai's copies serve no claims (`withClaimsAsEngine`, DIR1): no list, so no heading over one.
  if (spec.privileges.length === 0) return lines.join("\n");
  lines.push("", "What this tool guarantees (each of these is enforced by the engine, not by this text):");
  for (const p of spec.privileges) lines.push(`- ${p.claim}`);
  return lines.join("\n");
}

/**
 * WHO IS SENT `_meta["anthropic/alwaysLoad"]` (2026-11-13): the hosts that are
 * not Desktop and not claude.ai — Claude Code, and any other host, which
 * `toolListFor` serves Claude Code's list. Decided by the HOST, not by which
 * list object came back, so a list derived from `TOOLS` later cannot drop the
 * flag silently; Desktop's and claude.ai's copies spread the same spec, and
 * the key is not theirs.
 */
export function servesAlwaysLoad(host: boolean | string): boolean {
  return !(host === true || host === DESKTOP_HOST || host === CLAUDE_AI_HOST);
}

/** The `tools/list` payload. Shape is MCP's; content is the registry's. A
 *  Claude Desktop client (`desktop`) is offered `wake` too, last. A tool
 *  flagged `alwaysLoad` carries Claude Code's `_meta` key only where
 *  `servesAlwaysLoad` says. */
export function toolDefinitions(desktop: boolean | string = false): Record<string, unknown>[] {
  const alwaysLoad = servesAlwaysLoad(desktop);
  return toolListFor(desktop).map((spec) => ({
    name: spec.name,
    title: spec.annotations.title,
    description: renderDescription(spec),
    inputSchema: spec.inputSchema,
    annotations: spec.annotations,
    ...(spec.alwaysLoad === true && alwaysLoad ? { _meta: { [ALWAYS_LOAD_META_KEY]: true } } : {}),
  }));
}

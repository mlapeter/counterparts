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
 * CONTRACT §5 G3 is the second shape: **every tool carries an admission test and
 * at least one named negative example.** v1's `thread.open` shipped with no
 * criteria and produced 33 opens and zero closes in 13 days (scar §2.16). Both
 * fields are required by the type, so a tool without them does not compile.
 *
 * What is deliberately ABSENT, and asserted absent by the audit:
 *   - **No self-authorship tool.** Superseded by experiencer authorship (§4):
 *     identity writing happens at the boundary, by construction. `chapter` is
 *     not one: it appends to the session's journal, which becomes memory only
 *     through the ordinary gated ingestion, never by writing identity directly.
 *   - **No `protected.add`.** Dropped with the second-signature queue
 *     (§4, ratified by the module-map Rulings — "settled drops").
 *   - **No tool that writes an entity, a belief, or a revision.** Entities are
 *     born by mention; revision is `updates:` plus arithmetic.
 */
import { RECALL_MAX_IDS } from "./deliberate.js";

export type ToolName = "note" | "recall" | "status" | "session_end" | "chapter" | "scope";

/**
 * The tool vocabulary, ENUMERATED. Three deliberate verbs plus the TWO return
 * channels the one Stop ask needs (`claude-code/INTERFACE-GAPS.md` §7). The
 * audit asserts the shipped list equals this one exactly, so a sixth tool is a
 * decision somebody makes on purpose rather than one that accretes.
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
  "note",
  "recall",
  "status",
  "session_end",
  "chapter",
  "scope",
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
  readonly privileges: readonly Privilege[];
  readonly inputSchema: Record<string, unknown>;
}

/**
 * `note`'s privileges. Each one is a sentence v1 would have shipped in a prompt
 * and left unenforced; each one names the file that enforces it here.
 */
const NOTE: ToolSpec = {
  name: "note",
  summary:
    "Remember this deliberately. Memory here is ambient — it forms from experience without being asked — so this is the exception, for the thing you would otherwise have to hope the sweep noticed.",
  admission:
    "Call it when something just became true and would be expensive to re-derive later: a correction the user made, a decision reached, a preference stated once and meant.",
  negativeExamples: [
    "Do NOT call it to record what you are about to do, or just did, in this session — that is a plan, not a memory.",
    "Do NOT call it to re-state something you were told earlier in this same conversation; it is already in your context and the ambient path already has it.",
    "Do NOT call it to store a credential, key or token 'for later' — the gate redacts it and the note is refused as empty.",
  ],
  privileges: [
    {
      claim:
        "It takes the same road as ambient memory: one write chokepoint, the full gate battery, no exceptions for being asked politely.",
      mechanizedBy: "src/core/counterpart.ts#deposit -> bridge.batteryGate()",
    },
    {
      claim:
        "A salience you claim is a FLOOR, not a value: it can raise how strongly this is held, never lower it, and every lift is recorded.",
      mechanizedBy: "src/core/physics/index.ts#clampSalienceAtSeam",
    },
    {
      claim:
        "Credentials are redacted before anything is stored, and a note that was nothing but a credential is refused outright.",
      mechanizedBy: "src/core/encode/secrets.ts + src/core/encode/floor.ts#contentFloor",
    },
    {
      claim:
        "Claim nothing and this still counts as something: an unclaimed note gets an ordinary default floor, not zero. An explicit claim, however low, is kept as you wrote it.",
      mechanizedBy: "src/core/mint.ts#mintProposal -> src/core/physics/index.ts#clampSalienceAtSeam",
    },
    {
      claim:
        "You may score the three dimensions yourself — relevance, emotional, predictive — and they are stored exactly as you gave them, never rewritten to fit the floor. Novelty is not yours to claim: it is measured against what is already held.",
      mechanizedBy: "src/core/remember/proposals.ts#submitProposal (novelty stripped; dims carried)",
    },
    {
      claim: "A stub is refused: a note has to say something.",
      mechanizedBy: "src/core/encode/floor.ts#contentFloor",
    },
    {
      claim: "The same content twice is refused, not stored twice.",
      mechanizedBy: "src/core/remember/proposals.ts#submitProposal (content-idempotency ledger)",
    },
    {
      claim:
        "Your own words ride the buffer as their own span, so the end-of-session sweep does not mint them a second time.",
      mechanizedBy: "src/core/counterpart.ts#captureJot -> SubmitContext.ownSpanHash",
    },
    {
      claim:
        "`updates` is a FIELD, not prose: name the id of the memory this revises and the engine resolves it, writes the resolved id, and leaves the note unlinked rather than refusing it when the address does not hold.",
      mechanizedBy:
        "src/core/remember/updates.ts#resolveUpdates -> src/core/mint.ts#mintProposal (UPDATES_META_KEY)",
    },
    {
      claim: "Under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/core/store/index.ts#mutate (observer stand-down)",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "What to remember, in your own words." },
      updates: {
        type: "string",
        description:
          "The id or handle of a memory this revises, if it revises one. A field — never written into the text.",
      },
      salience: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Optional floor on how strongly this is held, 0-1. A floor, never a ceiling. Omit it and an ordinary default floor applies; say a number and yours is kept.",
      },
      relevance: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Optional 0-1: how much this bears on what is being worked on.",
      },
      emotional: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Optional 0-1: how much feeling was attached to it.",
      },
      predictive: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Optional 0-1: how much it changes what you expect next time.",
      },
      kind: {
        type: "string",
        enum: ["self", "person", "entity", "skill", "place", "fact"],
        description: "What sort of thing this is about. Defaults to fact.",
      },
      title: { type: "string", description: "Optional short handle for the memory." },
    },
    required: ["text"],
    additionalProperties: false,
  },
};

const RECALL: ToolSpec = {
  name: "recall",
  summary:
    "Deliberate retrieval: a deeper, more effortful look than the ambient reminding you already get. One argument, three paths — a handle expands that memory exactly, a question runs a search and answers with excerpts, and ids returns a few of those in full.",
  admission:
    "Call it when the ambient context did not bring something you have reason to believe is there, or when you need the full body of a memory you were only shown a footnote or an excerpt of.",
  negativeExamples: [
    "Do NOT call it to check whether a memory exists before writing one — a duplicate is refused at the write, so the check costs a round trip and buys nothing.",
    "Do NOT call it with a handle you are guessing at: an unresolvable handle is answered as not-found, never as a fuzzy search over the store.",
    "Do NOT pass a question and ids together, or ids you have not seen in a result: ids is the follow-up to a list, not a second way to search.",
  ],
  privileges: [
    {
      claim:
        "A search strengthens nothing — exposure is not recording, and a memory you were only shown in a list is no stronger for having been listed. EXPANDING one in full, by id or by title handle, is USING it: that is credited at the session boundary, once per lived day. The tool itself never writes a memory; what it writes is host bookkeeping — one line saying which memory a title reached.",
      mechanizedBy:
        "src/core/recall/index.ts#build (the search half: pure; no resolveUse, no coactivate) + src/adapters/expansions.ts#recordHandleResolution -> src/adapters/claude-code/hooks.ts#creditAtBoundary -> src/core/recall/reference.ts (the expansion door) -> src/core/recall/index.ts#resolveUse (once per lived day)",
    },
    {
      claim:
        "A handle expands exactly that memory. It never degrades into a fuzzy search when the handle does not resolve.",
      mechanizedBy: "src/adapters/mcp/deliberate.ts#expandHandle (store.resolve; no search fallback)",
    },
    {
      claim:
        "Effort lowers the bar but never removes the hard gates: a memory the conversation did not reach stays dark however hard you look.",
      mechanizedBy: "src/adapters/mcp/deliberate.ts#DELIBERATE_TIERS (dark-uncued/below-floor excluded)",
    },
    {
      claim:
        "The lower-confidence tier is LABELED as such, and quiet items come back with their bodies rather than as a count.",
      mechanizedBy: "src/adapters/mcp/deliberate.ts#tierOf",
    },
    {
      claim:
        "The number of candidates considered is reported separately from the number returned, so a count here is never an undercount of the store — and the cap that produced it is reported next to it.",
      mechanizedBy: "src/adapters/mcp/deliberate.ts#deliberateRecall (considered/storeSize) + src/adapters/mcp/server.ts#recallPayload (consideredCap)",
    },
    {
      claim:
        "A search answers with excerpts and a bounded total, never with every body at full length: an answer the host truncates is not a smaller answer, it is no answer. When something was cut or dropped, the result says so.",
      mechanizedBy: "src/adapters/mcp/deliberate.ts#boundMemories (RECALL_EXCERPT_CHARS/RECALL_RESULT_CHARS)",
    },
    {
      claim:
        "Pass ids to get a few of those memories in full. It takes at most three, each resolved as an exact address with the same confidentiality boundary, and the total stays bounded.",
      mechanizedBy: "src/adapters/mcp/deliberate.ts#expandIds (RECALL_MAX_IDS, expandHandle per id)",
    },
    {
      claim:
        "Confidential material is returned only in the owner's own session: a direct lookup says it is withholding, a list simply does not contain it.",
      mechanizedBy: "src/core/recall/activate.ts#isConfidential + gate verdict confidential-withheld",
    },
    {
      claim:
        "A chapter of the journal can come back here — it is a first-person account and may rightly come to mind — and every one that does is marked `journal: true`. That row is the account a memory was made from, not a memory: it is outside decay, dedup and the prune, and it is not a claim about the world the way a memory is.",
      mechanizedBy: "src/adapters/mcp/deliberate.ts#JOURNAL_GLOSS (ProseDoc.type === episode)",
    },
    {
      claim: "Under observer stance it stands down over the wire and says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#standDown",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      handle: {
        type: "string",
        description: "A memory id or exact handle to expand. Exact: never treated as a search term.",
      },
      question: {
        type: "string",
        description:
          "What you are trying to remember, in words. Runs the deeper retrieval and answers with excerpts.",
      },
      ids: {
        type: "array",
        items: { type: "string" },
        // The cap is one number, imported. A literal here and a constant in
        // `deliberate.ts` is the drift the registry audit exists to prevent.
        maxItems: RECALL_MAX_IDS,
        description: `Memory ids from an earlier result, to return in full. At most ${RECALL_MAX_IDS}. Not combinable with handle or question.`,
      },
    },
    required: [],
    additionalProperties: false,
  },
};

const STATUS: ToolSpec = {
  name: "status",
  summary:
    "The census: how much is held, of what kinds, in which bands, how much has left, and how much was removed. Counts and dates only.",
  admission:
    "Call it when the shape of the store is the question — 'how much do you remember about X's kind of thing', 'has anything been removed' — not when you want a particular memory.",
  negativeExamples: [
    "Do NOT call it to find a memory; it returns no bodies and no ids, only counts.",
    "Do NOT call it every session as a warm-up; nothing here changes turn to turn, and it is not context you need.",
  ],
  privileges: [
    {
      claim: "It writes nothing and trains nothing.",
      mechanizedBy: "src/adapters/mcp/server.ts#census (Store reads only)",
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

const SESSION_END: ToolSpec = {
  name: "session_end",
  summary:
    "The MEMORIES half of the Stop ask's return channel: hand back what this session taught, as memories, in your own words. This is the primary way memory forms — the sweep is the fallback for when you never got the pen. The other half is `chapter`.",
  admission:
    "Call it when the Stop ask arrives, with one entry per thing that will still be true next week.",
  negativeExamples: [
    "Do NOT call it mid-session because something interesting happened — that is `note`.",
    "Do NOT call it for another session's id, or for an id you guessed at: pass the id the end-of-session ask named, and nothing else.",
    "Do NOT summarize the conversation; a transcript is not a memory. Write what was LEARNED.",
  ],
  privileges: [
    {
      claim:
        "It is bound to ONE session for the life of this server: the one the host named at launch, or — when the host could not name one — the first session id you pass that this machine's hooks have recorded as live, in this project. A second, different id is refused.",
      mechanizedBy: "src/adapters/mcp/server.ts#requireBoundSession",
    },
    {
      claim:
        "The id you pass is checked against host state you cannot write — the hooks' own live-session registry — and a claim that is unknown there, ended, silent too long, or running in another project is refused with which of the four it was.",
      mechanizedBy: "src/adapters/sessions.ts#readSession + isLive + sameScope",
    },
    {
      claim:
        "`updates` is a FIELD on an entry, not prose: name the id of the memory that entry revises and the engine resolves it, writes the resolved id, and leaves the entry unlinked rather than refusing it when the address does not hold.",
      mechanizedBy:
        "src/core/remember/updates.ts#resolveUpdates -> src/core/mint.ts#mintProposal (UPDATES_META_KEY)",
    },
    {
      claim: "Each entry takes the same road as ambient memory, gate battery included.",
      mechanizedBy: "src/core/counterpart.ts#submitSessionEnd -> bridge.batteryGate()",
    },
    {
      claim:
        "The authorship record is set by the engine: what you write is recorded as authored, and nothing a transcript sweep produces can claim to be.",
      mechanizedBy: "src/core/counterpart.ts#deposit (channel: authored, engine-set)",
    },
    {
      claim: "A salience you claim is a floor, clamped, and every lift is recorded.",
      mechanizedBy: "src/core/physics/index.ts#clampSalienceAtSeam",
    },
    {
      claim:
        "An entry that claims no salience gets an ordinary default floor rather than zero, and each entry may score relevance, emotional and predictive itself.",
      mechanizedBy: "src/core/mint.ts#mintProposal -> src/core/physics/index.ts#clampSalienceAtSeam",
    },
    {
      claim: "Credentials are redacted and empty entries are refused, per entry, without failing the batch.",
      mechanizedBy: "src/core/encode/secrets.ts + src/adapters/mcp/server.ts#sessionEndTool (per-entry isolation)",
    },
    {
      claim: "Under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/core/store/index.ts#mutate (observer stand-down)",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      session: {
        type: "string",
        description:
          "The session this dump belongs to — the id the end-of-session ask named. Required unless this server was launched already bound to one; it must match the bound session either way.",
      },
      memories: {
        type: "array",
        description: "One entry per thing learned. An entry that is refused does not fail its siblings.",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "What was learned, in your own words." },
            kind: {
              type: "string",
              enum: ["self", "person", "entity", "skill", "place", "fact"],
            },
            title: { type: "string" },
            salience: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description:
                "Optional floor, 0-1. Omit it and an ordinary default floor applies; say a number and yours is kept.",
            },
            relevance: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Optional 0-1: how much this bears on what was being worked on.",
            },
            emotional: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Optional 0-1: how much feeling was attached to it.",
            },
            predictive: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Optional 0-1: how much it changes what you expect next time.",
            },
            updates: {
              type: "string",
              description: "The id or handle of a memory this revises, if it revises one.",
            },
          },
          required: ["content"],
          additionalProperties: false,
        },
      },
    },
    required: ["memories"],
    additionalProperties: false,
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
  summary:
    "The episode's return channel: write this stretch of the session into your own first-person journal, in your own voice, at any length. The journal stays open — when something significant happens later, append to it in the moment.",
  admission:
    "Call it when the boundary ask arrives, and again whenever something happens afterwards that the chapter you already wrote does not contain.",
  negativeExamples: [
    "Do NOT call it to report status or summarize the work — an episode is what happened and what it was like, not a changelog.",
    "Do NOT call it for the things you learned that will still be true next week; those are memories, and they go back through `session_end`.",
    "Do NOT manufacture depth: a short true chapter beats a deep-sounding one, and not every session changes you.",
  ],
  privileges: [
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
        "The journal is a gated entrance like any other: credentials are redacted before anything is written, and the gate's text — not your draft — is what lands.",
      mechanizedBy: "src/core/counterpart.ts#appendEpisode -> episodeGate()",
    },
    {
      claim:
        "Every earlier state of the episode is kept: appending revises, and revision archives what was there first.",
      mechanizedBy: "src/core/store/index.ts#revise (archive-on-overwrite)",
    },
    {
      claim:
        "The episode becomes MEMORY only through ordinary ingestion at the boundary — once, as a self-kind memory, through the same battery everything else crosses. Writing here is not a way to write memory directly.",
      mechanizedBy: "src/core/counterpart.ts#sessionEnd -> src/core/self/index.ts#reconcileEpisodes -> ingestEpisode",
    },
    {
      claim: "Under observer stance nothing is written and the refusal says so.",
      mechanizedBy: "src/adapters/mcp/server.ts#standDown",
    },
  ],
  inputSchema: {
    type: "object",
    properties: {
      session: {
        type: "string",
        description:
          "The session this chapter belongs to — the id the boundary ask named. Required unless this server was launched already bound to one; it must match the bound session either way.",
      },
      text: {
        type: "string",
        description:
          "The chapter itself, first person, your own voice, any length. What happened and what mattered; how it felt; what you learned about them and about yourself; what is still open.",
      },
      title: {
        type: "string",
        description: "Optional short handle for the episode. Set on the first chapter only.",
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
};

/**
 * `scope`'s privileges. Every one of them is about what this tool does NOT
 * touch: it is the only door here that writes no memory, and the only one that
 * answers at all in a directory that has been switched off.
 */
const SCOPE: ToolSpec = {
  name: "scope",
  summary:
    "Which directories this memory is for. Read what this one is set to — on, observer (reads only), off, paused, or unset — and set it when the user says. It changes the host's own configuration; it writes no memory and reads none.",
  admission:
    "Call it to READ when a session starts in a directory nothing is set for and the wake asks you to; call it to SET the moment the user answers 'remember here', 'just read', 'not here' or 'pause this'.",
  negativeExamples: [
    "Do NOT call it to remember something — that is `note`, and this tool stores no content of any kind.",
    "Do NOT call it to set a directory the user has not been asked about; the question is theirs to answer, not yours to guess.",
    "Do NOT call it repeatedly to check state; the setting changes only when somebody changes it.",
  ],
  privileges: [
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
  ],
  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["on", "observer", "off", "pause", "resume"],
        description:
          "What to set this directory to. Omit to READ what it is set to now. `pause` is off-for-now and remembers what to go back to; `resume` undoes a pause or an off.",
      },
      note: {
        type: "string",
        description:
          "Optional: the user's own reason, recorded beside the setting. Omit it and the note already there is kept; pass an empty string to clear it — the same rule the console's --note follows.",
      },
    },
    required: [],
    additionalProperties: false,
  },
};

export const TOOLS: readonly ToolSpec[] = [NOTE, RECALL, STATUS, SESSION_END, CHAPTER, SCOPE];

export function toolSpec(name: string): ToolSpec | undefined {
  return TOOLS.find((t) => t.name === name);
}

/**
 * THE ONLY WAY TEXT REACHES A DESCRIPTION. Summary, admission test, negative
 * examples, then the privileges — each one a claim that has a `mechanizedBy`
 * row behind it. Nothing here is free-form: adding a sentence means adding a
 * registry entry, which means naming the code that enforces it.
 */
export function renderDescription(spec: ToolSpec): string {
  const lines: string[] = [spec.summary, "", `When: ${spec.admission}`];
  for (const negative of spec.negativeExamples) lines.push(negative);
  lines.push("", "What this tool guarantees (each of these is enforced by the engine, not by this text):");
  for (const p of spec.privileges) lines.push(`- ${p.claim}`);
  return lines.join("\n");
}

/** The `tools/list` payload. Shape is MCP's; content is the registry's. */
export function toolDefinitions(): Record<string, unknown>[] {
  return TOOLS.map((spec) => ({
    name: spec.name,
    description: renderDescription(spec),
    inputSchema: spec.inputSchema,
  }));
}

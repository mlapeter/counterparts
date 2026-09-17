/**
 * The MCP server: messages in, tool results out, one brain underneath.
 *
 * **It composes, it does not re-wire** (CLAUDE.md, `counterpart.ts`'s header).
 * Every durable thing this file does goes through a `Counterpart` method —
 * `captureJot`, `submitJot`, `submitSessionEnd` — so the gate battery, the
 * engine-set authorship channel, the `updates:` resolution and the observer
 * stand-down all ride along without this adapter knowing they exist. The MCP
 * tools are therefore two more entrances on `claude-code/INTERFACE-GAPS.md`
 * §4's table, and they inherit its coverage rather than needing their own.
 *
 * **The three refusals that live HERE**, because no core module can know them:
 *
 *   1. **The bound session.** `session_end` is the return channel for ONE
 *      session's Stop ask (`claude-code/INTERFACE-GAPS.md` §7). `chapter` binds
 *      by the same rules, through the same one code path. A server
 *      launched for session A may not accept session B's dump, and a server
 *      bound to nothing may not accept a bare claim — "unbound" is a refusal,
 *      not a wildcard. A host that lets a model pick the session id it writes
 *      under has handed the model the ability to write into another session's
 *      day.
 *
 *      **The lazy bind, added 2026-09-04.** Measured on the live host: Claude
 *      Code registers an MCP server from a STATIC config (command, args, env),
 *      so `--session` never arrives and every dump for the whole run was
 *      refused `no-bound-session`. So a server launched without one may bind
 *      ONCE, from the model's claim, and only when the claim is CORROBORATED by
 *      host state the model cannot write: `adapters/sessions.ts`'s registry,
 *      written by the hooks, must hold that id, it must be live, and its scope
 *      must be this server's scope. The first valid claim binds for the
 *      process's lifetime; a second, different id is refused exactly as it
 *      always was. The explicit `--session` path is unchanged and still wins:
 *      a server told which session it is never consults the registry.
 *   2. **Stand-down over the wire** (§5 G5, scar E7/§2.4). Under observer every
 *      tool returns a result that SAYS it stood down, plus telemetry. A silent
 *      no-op would be indistinguishable from a broken server, which is the
 *      exact failure §2.4 records.
 *   3. **Owner-scoped confidentiality** (§5 G6). The host is the only thing
 *      that knows whose session this is; it says so at construction, and the
 *      value travels into `Recall`'s own owner logic rather than being
 *      re-derived from anything the model can influence.
 *
 * Telemetry is content-by-reference throughout: ids, counts, tiers, reasons.
 * No body text, no question text, no note text ever reaches an event.
 */
import type { ChapterResult, Counterpart, DepositResult } from "../../core/counterpart.js";
import type { SemanticSource } from "../../core/recall/index.js";
import { AUTHOR_DIMENSIONS } from "../../core/remember/index.js";
import type { Band, Kind } from "../../core/types.js";
import { recordHandleResolution } from "../expansions.js";
import {
  lookupScope,
  readScopes,
  ownEntry,
  resumeTarget,
  setScope,
  stanceOfMode,
  writeScopes,
} from "../scopes.js";
import type { ScopeMode, ScopeRegistry, ScopeVerdict } from "../scopes.js";
import { SESSION_TTL_MS, canonicalScope, isLive, readSession, sameScope } from "../sessions.js";
import {
  JOURNAL_GLOSS,
  RECALL_BODY_CHARS,
  RECALL_EXCERPT_CHARS,
  RECALL_MAX_IDS,
  RECALL_RESULT_CHARS,
  boundMemories,
  deliberateRecall,
} from "./deliberate.js";
import type { DeliberateResult } from "./deliberate.js";
import {
  ERROR_CODES,
  failure,
  negotiateVersion,
  success,
} from "./protocol.js";
import type { Id, Request, Response } from "./protocol.js";
import { TOOL_NAMES, toolDefinitions, toolSpec } from "./tools.js";
import type { ToolName } from "./tools.js";

export const SERVER_NAME = "counterparts";
/**
 * What `initialize` tells the client it is talking to. It is the PACKAGE's
 * version, and `test/mcp.test.ts` reads `package.json` and asserts the two are
 * the same string — a literal here that drifted would make the one number a
 * client can see about this server a lie, and the handshake is exactly where a
 * host decides whether to trust what follows. Read from a constant rather than
 * from disk so the server opens no file to answer its first message.
 */
export const SERVER_VERSION = "0.1.0";

/** Telemetry: ids, counts, reasons, flags. NEVER body text (store §5 G10). */
export interface McpEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

export interface McpServerOptions {
  counterpart: Counterpart;
  /**
   * The ONE session this server may deposit under, when the host can say so at
   * launch. Absent ⇒ the lazy bind (`requireBoundSession`) is the only way in.
   */
  session?: string;
  /**
   * The project this server's sessions belong to. Defaults to `process.cwd()`,
   * which is MEASURED to be the project directory on this host: `lsof` on four
   * running servers, 2026-09-04, showed each one's cwd was the directory its
   * session ran in. The store's dir is the last resort, and it is a bad scope —
   * every memory authored through this server carried the store path as
   * `origin_scope` for the whole run because it was the only default.
   */
  scope?: string;
  /** Is this the owner's own session? Withholding is the safe direction. */
  owner?: boolean;
  /**
   * The embedder, for ONE purpose: embedding a deliberate question in line.
   *
   * The ruling of 2026-09-04 splits the two paths — the ambient hot path may not
   * embed (it has a 1200 ms budget and a person mid-sentence), the deliberate
   * ask may (someone typed a question and is waiting). This is that half.
   *
   * The server never sees a credential: the ENTRY POINT loads the file the
   * package's own config names and hands over an opened embedder or null
   * (`bin/serve.ts`), exactly as `bin/hook.ts` does for the hook adapter. Null
   * degrades the ask to lexical-only and the result SAYS so.
   */
  embedder?: QuestionEmbedder | null;
  /**
   * Where the hooks' live-session registry lives. Defaults to the store's own
   * data dir — the one path both adapters resolve independently and agree on.
   */
  registryDir?: string;
  /** **CAL.** Liveness window for a lazily-bound claim (`adapters/sessions.ts`). */
  sessionTtlMs?: number;
  /**
   * THE SCOPE REGISTRY this server consults — `<config dir>/scopes.json`,
   * resolved by the entry point from the same `--config` rule everything else
   * uses (`bin/serve.ts`). Absent means "nobody told us", which reads as `unset`
   * and behaves exactly as this server always has.
   *
   * It is read PER CALL rather than pinned at construction, and deliberately:
   * the file is a few hundred bytes, and a session whose directory was switched
   * back on — from the console in another terminal, or by this server's own
   * `scope` tool — must get its memory back without the host restarting the
   * process. The launch stderr line is the one thing computed once.
   */
  scopesFile?: string;
  onEvent?: (e: McpEvent) => void;
  now?: () => number;
}

/** The narrow face of `claude-code/embed-client.ts`'s `LiveEmbedder` this
 *  adapter needs — structural, so `mcp/` imports no other adapter. */
export interface QuestionEmbedder {
  vector(text: string): Promise<number[] | null>;
}

/** MCP's tool-result shape. A refusal is a RESULT, never a JSON-RPC error. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

const EVENT_RING = 200;

/**
 * THE SCOPE THE HOST OFFERED, or null when it offered none.
 *
 * In order: what the launch declared (`--scope` / `COUNTERPARTS_SCOPE`), then
 * `CLAUDE_PROJECT_DIR`, then this process's working directory.
 *
 * **`CLAUDE_PROJECT_DIR` is second, and it is what makes the two adapters agree
 * without either one telling the other.** The host documents it as the project
 * root where the session started, exports it to hook processes AND to stdio MCP
 * servers, and keeps it put when the agent enters a worktree or runs `cd` — so
 * the hooks' `sessionScope` and this resolve the same string from the same
 * variable. What the server's own working directory is, this host does not
 * document at all: `lsof` on four running servers measured it as the session's
 * directory on 2026-09-04, and a measurement is what it remains. It stays as the
 * fallback it has always been.
 *
 * CANONICAL, because the scope is not only compared — it is the KEY. Span
 * streams, cursors and coverage files are named from a hash of this exact string
 * (`remember/spans.ts#keyFor`), so a deposit whose scope says `/tmp/x` claims
 * coverage in a different directory from spans captured under `/private/tmp/x`.
 * `sameScope` was already canonicalising for the BIND; this makes the filing
 * agree too.
 */
export function hostScope(
  declared: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { scope: string; source: Exclude<ScopeSource, "store"> } | null {
  if (declared !== undefined && declared.length > 0) {
    return { scope: canonicalScope(declared), source: "flag" };
  }
  const projectDir = env["CLAUDE_PROJECT_DIR"];
  if (typeof projectDir === "string" && projectDir.length > 0) {
    return { scope: canonicalScope(projectDir), source: "project" };
  }
  try {
    const cwd = process.cwd();
    if (cwd.length > 0) return { scope: canonicalScope(cwd), source: "cwd" };
  } catch {
    /* no working directory — the caller falls through to the store's own dir */
  }
  return null;
}

/**
 * The scope default: whatever the host offered, and — only if it offered
 * nothing at all — the store's own dir.
 *
 * The last resort is a bad answer and is kept only because a server with no
 * scope at all cannot deposit: from 2026-09-03 it was the ONLY answer, so every
 * memory authored through this server was stamped with the store path instead of
 * the project. `process.cwd()` can throw (a deleted working directory), which is
 * the one case the fallback is actually for.
 */
export function resolveScope(
  declared: string | undefined,
  storeDir: string,
  env: NodeJS.ProcessEnv = process.env,
): { scope: string; source: ScopeSource } {
  return hostScope(declared, env) ?? { scope: storeDir, source: "store" };
}

/** How this server learned which project it is serving. Reported at startup. */
export type ScopeSource = "flag" | "project" | "cwd" | "store";

/** The kind enum, for a refusal that names it (session_end). Derived from
 *  `Kind` so that adding a kind without listing it here fails `tsc`. */
const KIND_SET: Record<Kind, true> = { self: true, person: true, entity: true, skill: true, place: true, fact: true };
const MEMORY_KINDS = Object.keys(KIND_SET) as readonly Kind[];

export class McpServer {
  readonly counterpart: Counterpart;
  /** The session the HOST named at launch, if it could. Never changes. */
  readonly launchedSession: string | null;
  readonly scope: string;
  readonly scopeSource: ScopeSource;
  readonly owner: boolean;
  /** One predicate, one definition: the store's (observer-mode G7). */
  readonly observer: boolean;

  private readonly embedder: QuestionEmbedder | null;
  private readonly registryDir: string;
  private readonly scopesFile: string | null;
  private readonly sessionTtlMs: number;
  private readonly onEvent: ((e: McpEvent) => void) | undefined;
  private readonly nowFn: () => number;
  private readonly ring: McpEvent[] = [];
  private initialized = false;
  /** The lazy bind's result: null until a claim is corroborated, then frozen. */
  private lazySession: string | null = null;

  constructor(opts: McpServerOptions) {
    this.counterpart = opts.counterpart;
    this.launchedSession =
      opts.session !== undefined && opts.session.length > 0 ? opts.session : null;
    const scope = resolveScope(opts.scope, opts.counterpart.store.dir);
    this.scope = scope.scope;
    this.scopeSource = scope.source;
    this.registryDir = opts.registryDir ?? opts.counterpart.store.dir;
    this.scopesFile =
      opts.scopesFile !== undefined && opts.scopesFile.length > 0 ? opts.scopesFile : null;
    this.sessionTtlMs = opts.sessionTtlMs ?? SESSION_TTL_MS;
    this.observer = opts.counterpart.observer;
    // An observer is a non-owner regardless of what the host claimed
    // (observer-mode G7): an instrument reading somebody's store is not them.
    this.owner = opts.owner === true && !this.observer;
    // An instrument opens no sockets, whatever the host handed it (scar E7).
    this.embedder = this.observer ? null : opts.embedder ?? null;
    this.onEvent = opts.onEvent;
    this.nowFn = opts.now ?? ((): number => Date.now());
    // LAST in the constructor — `emit` needs `nowFn`. A scope nobody chose is
    // the bug this run measured, so which default won is on the record from the
    // first event rather than inferable only from the memories it stamped.
    this.emit("mcp.scope", undefined, {
      scope: this.scope,
      source: this.scopeSource,
      boundSession: this.launchedSession !== null,
    });
  }

  /** The session this server may deposit under: the host's, else the bound claim. */
  get session(): string | null {
    return this.launchedSession ?? this.lazySession;
  }

  events(name?: string): McpEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  // ── the wire ───────────────────────────────────────────────────────────────

  /**
   * One request in, one response out — or `null` for a notification, which is
   * answered with nothing at all.
   */
  async handle(request: Request): Promise<Response | null> {
    const id = request.id;
    const params = request.params ?? {};

    switch (request.method) {
      case "initialize": {
        if (id === undefined) return null;
        this.initialized = true;
        const version = negotiateVersion(params["protocolVersion"]);
        this.emit("mcp.initialize", undefined, {
          protocolVersion: version,
          observer: this.observer,
          owner: this.owner,
          boundSession: this.session !== null,
        });
        return success(id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });
      }
      case "notifications/initialized":
      case "initialized":
        this.initialized = true;
        return null;
      case "ping":
        return id === undefined ? null : success(id, {});
      case "tools/list": {
        if (id === undefined) return null;
        this.emit("mcp.tools.list", undefined, { tools: TOOL_NAMES.length });
        return success(id, { tools: toolDefinitions() });
      }
      case "tools/call": {
        if (id === undefined) return null;
        return this.callFromParams(id, params);
      }
      default:
        if (id === undefined) return null;
        return failure(id, ERROR_CODES.METHOD_NOT_FOUND, `unknown method: ${request.method}`);
    }
  }

  private async callFromParams(id: Id, params: Record<string, unknown>): Promise<Response> {
    const name = params["name"];
    if (typeof name !== "string") {
      return failure(id, ERROR_CODES.INVALID_PARAMS, "tools/call requires a string name");
    }
    if (toolSpec(name) === undefined) {
      // An unknown TOOL is a protocol fault (the client called something that
      // does not exist); an unusable ARGUMENT is the tool's own answer.
      return failure(id, ERROR_CODES.METHOD_NOT_FOUND, `unknown tool: ${name}`);
    }
    const args = params["arguments"];
    if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
      return failure(id, ERROR_CODES.INVALID_PARAMS, "arguments must be an object");
    }
    const result = await this.call(name, (args as Record<string, unknown>) ?? {});
    return success(id, result as unknown as Record<string, unknown>);
  }

  // ── the tools ──────────────────────────────────────────────────────────────

  /** Direct tool invocation, transport-free. The wire calls this; so do tests. */
  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    // THE SCOPE GATE, BEFORE EVERYTHING — before the observer stand-down and
    // before any session bind. A directory somebody switched `off` gets no
    // deposits, no reads and no census, and the refusal is NAMED (`scope-off`)
    // so it is not mistaken for a broken server, an unbound session or a
    // stand-down. The one exception is `scope` itself: every other tool
    // refusing there means a door that refused too would lock from the outside,
    // and turning a directory back on from inside the session that wants it is
    // the whole point of the tool.
    if (name !== "scope") {
      const verdict = this.scopeVerdict();
      if (stanceOfMode(verdict.mode) === "off") return this.refuseScopeOff(name, verdict);
    }
    switch (name) {
      case "note":
        return this.noteTool(args);
      case "recall":
        return await this.recallTool(args);
      case "status":
        return this.statusTool();
      case "session_end":
        return this.sessionEndTool(args);
      case "chapter":
        return this.chapterTool(args);
      case "scope":
        return this.scopeTool(args);
      default:
        return this.refuse(name, "unknown-tool", { tool: name });
    }
  }

  // ── the scope registry ─────────────────────────────────────────────────────

  /**
   * What `<config dir>/scopes.json` says about THIS server's directory, read
   * fresh. Absent registry, absent file, unreadable file: all `unset`, which is
   * on — the same fail direction the hooks take, and for the same reason (a
   * tool may not fail on host trivia).
   */
  private scopeVerdict(): ScopeVerdict {
    if (this.scopesFile === null) return { mode: "unset", matched: null, entry: null };
    return lookupScope(readScopes(this.scopesFile).registry, this.scope);
  }

  /** The named refusal every tool but `scope` gets in a directory set `off`. */
  private refuseScopeOff(tool: string, verdict: ScopeVerdict): ToolResult {
    this.emit("mcp.scope.off", undefined, { tool, matched: verdict.matched, mode: verdict.mode });
    return this.refuse(tool, "scope-off", {
      scope: this.scope,
      ...(verdict.matched === null ? {} : { setBy: verdict.matched }),
      detail:
        verdict.mode === "paused"
          ? "Counterparts is paused for this directory. Nothing is recorded or read here until it is resumed — call `scope` with mode `resume`, or run `counterparts scope . --resume`."
          : "Counterparts is off for this directory. Nothing is recorded or read here — call `scope` with mode `on`, or run `counterparts scope . --on`.",
    });
  }

  /**
   * `scope` — read, or set, what this directory is for (owner asks G41–G43).
   *
   * The path is `this.scope` and there is no argument for one: a model that
   * could name the directory could switch off a project it is not in. Reading
   * is allowed in every stance, including observer and `off`, because "why did
   * this session record nothing" must always be answerable; writing refuses
   * under observer exactly as every other write does.
   */
  private scopeTool(args: Record<string, unknown>): ToolResult {
    const mode = args["mode"];
    const file = this.scopesFile;
    const verdict = this.scopeVerdict();
    const read = file === null ? null : readScopes(file);

    if (mode === undefined) {
      this.emit("mcp.scope.read", undefined, { mode: verdict.mode, matched: verdict.matched });
      return this.result(
        {
          scope: this.scope,
          mode: verdict.mode,
          stance: stanceOfMode(verdict.mode),
          ...(verdict.matched === null ? {} : { setBy: verdict.matched }),
          ...(verdict.entry?.since === undefined ? {} : { since: verdict.entry.since }),
          ...(verdict.entry?.note === undefined ? {} : { note: verdict.entry.note }),
          ...(verdict.mode === "paused" ? { resumesTo: resumeTarget(verdict.entry) } : {}),
          ...(file === null ? {} : { registry: file }),
          // A registry in trouble is never silent, on any surface that has a
          // reader (#92 review, F2): entries nobody can honour read as unset,
          // which is ON, and this is the one place a model can see that.
          ...(read === null || read.error === null ? {} : { registryError: read.error }),
          ...(read === null || read.refused.length === 0
            ? {}
            : { registryRefused: read.refused.map((r) => `${r.key} (${r.detail})`) }),
          detail:
            verdict.mode === "unset"
              ? "Nothing is set for this directory or any parent, so it is on by default. Ask the user before setting it."
              : "This is what the host's scope registry says about this directory.",
        },
        false,
      );
    }

    if (typeof mode !== "string" || !["on", "observer", "off", "pause", "resume"].includes(mode)) {
      return this.refuse("scope", "mode-unusable", {
        detail: "`mode` takes on, observer, off, pause or resume — or omit it to read the setting.",
      });
    }
    if (this.observer) return this.standDown("scope");
    if (file === null) {
      return this.refuse("scope", "no-registry", {
        detail:
          "This server was launched without a scope registry to write, so it can only read. Use `counterparts scope <path> --on|--observer|--off` instead.",
      });
    }
    if (read !== null && read.error !== null) {
      return this.refuse("scope", "registry-unreadable", {
        registry: file,
        detail: `The registry could not be read — ${read.error}. Nothing was changed; a person has to fix it (\`counterparts scope <path> --off --force\` replaces it).`,
      });
    }
    // ENTRIES THIS READ REFUSED (#92 review, F2). The file parses, so this tool
    // COULD write — and a write rewrites the whole file from what parsed, which
    // would silently delete another directory's `off`. A model may not make that
    // trade on somebody's behalf: it refuses, names them, and leaves it to the
    // person at the console (`counterparts scope <path> --off --force`).
    if (read !== null && read.refused.length > 0) {
      return this.refuse("scope", "registry-partly-unreadable", {
        registry: file,
        refused: read.refused.map((r) => `${r.key} (${r.detail})`),
        detail: `${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in this registry could not be read, and every write rewrites the whole file — so writing here would drop ${read.refused.length === 1 ? "it" : "them"}. Nothing was changed. Tell the user; fixing the file, or \`counterparts scope <path> --<mode> --force\`, is a person's call.`,
      });
    }

    let target: ScopeMode;
    if (mode === "resume") {
      const own = ownEntry(read?.registry ?? null, this.scope);
      if (own === null) {
        return this.refuse("scope", "nothing-to-resume", {
          detail:
            verdict.entry === null
              ? "Nothing is set for this directory, so it is already on."
              : `Nothing is set for this directory itself — it inherits ${verdict.matched ?? "?"}. Set this one directly instead.`,
        });
      }
      target = resumeTarget(own);
    } else {
      target = mode === "pause" ? "paused" : (mode as ScopeMode);
    }

    // ONE function for the change, applied to the registry this call read and —
    // if the file moved under it — to what is there now (#92 review, F3). The
    // other writer is the console `scope` command, in another process.
    const apply = (from: ScopeRegistry | null): ScopeRegistry =>
      setScope(from, this.scope, target, {
        at: new Date(this.nowFn()).toISOString(),
        // ONE RULE FOR THE NOTE ON BOTH SURFACES (#92 review, F5): an omitted
        // note CARRIES what is there, an empty string CLEARS it. The filter here
        // used to drop `""` as though it had not been given, so the console
        // cleared a note and this tool silently kept it — the same two words
        // meaning different things depending on which door you used.
        ...(typeof args["note"] === "string" ? { note: args["note"] } : {}),
      });
    const next = apply(read?.registry ?? null);
    try {
      if (read === null) writeScopes(file, next);
      else writeScopes(file, next, { basedOn: read, reapply: apply });
    } catch (err) {
      return this.refuse("scope", "registry-unwritable", {
        registry: file,
        detail: `The registry could not be written (${err instanceof Error ? err.message : String(err)}). Nothing was changed.`,
      });
    }
    this.emit("mcp.scope.set", undefined, { mode: target, scope: this.scope });
    return this.result(
      {
        set: true,
        scope: this.scope,
        mode: target,
        stance: stanceOfMode(target),
        registry: file,
        detail:
          target === "off" || target === "paused"
            ? "This directory is no longer recorded or read. The hooks will produce nothing here and every other tool will refuse until it is turned back on — including in a new session, which is the point."
            : // WHAT TURNING IT BACK ON ACTUALLY DOES, said exactly (#92 review,
              // F1). It is not "the next session": the hooks act at their next
              // boundary in THIS one. What they do not do is reach back — a
              // session that started outside the memory has its first boundary
              // move the read cursor past everything already said, recording
              // none of it, so the stretch that ran while this directory was
              // off or paused stays out of the memory for good.
              "Recorded. This takes effect for the tools immediately, and for the hooks at their next boundary in this session. Nothing said before now is recorded — the conversation that happened while this directory was off or paused is passed over, not collected — and remembering starts from here.",
      },
      false,
    );
  }

  /**
   * `note` — deliberate remembering, the ambient exception (constitution 8).
   *
   * Two steps, and the ORDER is the point: the words ride the buffer as their
   * own span first, then the deposit claims that span by hash. Without the
   * claim the end-of-session sweep would find the jot's own text sitting in the
   * buffer and mint it a second time, so the deliberate note would cost two
   * memories — which is how a "remember this" channel becomes a duplication
   * engine.
   */
  private async noteTool(args: Record<string, unknown>): Promise<ToolResult> {
    if (this.observer) return this.standDown("note");
    const text = args["text"];
    if (typeof text !== "string" || text.trim().length === 0) {
      return this.refuse("note", "text-required", {});
    }
    const salience = args["salience"];
    if (salience !== undefined && (typeof salience !== "number" || !Number.isFinite(salience))) {
      return this.refuse("note", "salience-not-a-number", {});
    }
    const dims = readDimensions(args);
    if (dims === null) {
      return this.refuse("note", "dimension-out-of-range", {
        detail: "relevance, emotional and predictive are each a number from 0 to 1.",
      });
    }
    const session = this.session ?? "mcp";

    const captured = this.counterpart.captureJot({ session, scope: this.scope, text });
    const ownSpanHash = captured.spans[0]?.hash ?? null;

    const draft: Record<string, unknown> = { content: text };
    if (typeof args["kind"] === "string") draft["kind"] = args["kind"];
    if (typeof args["title"] === "string") draft["title"] = args["title"];
    // `updates` travels as a FIELD, exactly as it does on a `session_end` entry
    // (added 2026-09-04: the Stop ask told the model to write `updates: <id>`
    // and this tool had nowhere to put it, so four notes landed as prose with no
    // link). The declaration is resolved downstream — `remember/updates.ts`
    // validates it, `mint.ts` writes the RESOLVED id — and one that resolves to
    // nothing lands unlinked rather than refusing the note.
    if (typeof args["updates"] === "string") draft["updates"] = args["updates"];
    if (salience !== undefined) draft["claimed"] = salience;
    if (Object.keys(dims).length > 0) draft["salience"] = dims;

    const deposit = await this.counterpart.submitJot(draft, {
      session,
      scope: this.scope,
      ownSpanHash,
    });
    return this.depositResult("note", deposit);
  }

  /**
   * `recall` — the deeper look. Deposits no memory and touches no physics; see
   * `deliberate.ts`. The ONE thing it writes is host state: a handle path that
   * was answered leaves a line in `adapters/expansions.ts`'s resolution log, so
   * the boundary's credit pass can tell which memory a TITLE reached
   * (`noteHandleResolution`, and `mcp/INTERFACE-GAPS` §9).
   */
  private async recallTool(args: Record<string, unknown>): Promise<ToolResult> {
    if (this.observer) return this.standDown("recall");
    const handle = args["handle"];
    const question = args["question"];
    const ids = args["ids"];
    if (handle !== undefined && typeof handle !== "string") {
      return this.refuse("recall", "handle-not-a-string", {});
    }
    if (question !== undefined && typeof question !== "string") {
      return this.refuse("recall", "question-not-a-string", {});
    }
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((v) => typeof v !== "string"))) {
      return this.refuse("recall", "ids-not-a-string-array", {});
    }
    const askedIds = ((ids as string[] | undefined) ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
    // IN LINE, and only for a question: the handle and `ids` paths are exact
    // addresses and embedding them would buy nothing but a round trip. A refusal
    // is a NAME, not a narrower answer — `deliberateRecall` degrades to lexical
    // and says which.
    const asked = typeof question === "string" && question.trim().length > 0;
    const embedded = asked ? await this.embedQuestion(question) : { vector: null, semantic: "none" as SemanticSource };
    const result = deliberateRecall(
      this.counterpart,
      {
        ...(typeof handle === "string" ? { handle } : {}),
        ...(typeof question === "string" ? { question } : {}),
        ...(askedIds.length > 0 ? { ids: askedIds } : {}),
      },
      {
        sessionId: this.session ?? "mcp",
        owner: this.owner,
        vector: embedded.vector,
        semantic: embedded.semantic,
      },
    );
    const resolved = this.noteHandleResolution(handle, result);
    const payload = this.recallPayload(result);
    this.emit("mcp.recall", undefined, {
      path: result.path,
      reason: result.reason,
      // G50: did this call earn credit that `reference.ts` could not have given
      // it on its own? Ring-only, like every other number on this row.
      handleResolved: resolved,
      semantic: result.semantic,
      returned: result.memories.length,
      considered: result.considered,
      storeSize: result.storeSize,
      owner: this.owner,
      // Scar §2.4: a budget gets an event when it is APPROACHED, not only when
      // it blows. The three overflowed calls of 2026-09-04 emitted nothing.
      chars: payload["chars"] as number,
      truncated: payload["truncated"] === true,
      droppedForBudget: (payload["droppedForBudget"] as number | undefined) ?? 0,
    });
    const bad =
      result.reason === "no-argument" ||
      result.reason === "both-arguments" ||
      result.reason === "handle-unknown" ||
      result.reason === "ids-too-many" ||
      result.reason === "handle-confidential-withheld";
    return this.result(payload, bad);
  }

  /**
   * THE HANDLE-EXPANSION CREDIT SEAM (LAUNCH-STATUS G50), the tool half.
   *
   * A deliberate expansion BY TITLE read the whole memory and earned nothing:
   * the boundary's credit pass takes its expansions from the transcript, and
   * `recall/reference.ts` credits literal `mem_…` addresses only — a title is
   * counted `unresolvedHandles` and credits nothing, because that module
   * resolves nothing fuzzily and must not start. The resolution belongs to
   * whoever performed it, which is this tool, so this tool records it
   * (`adapters/expansions.ts`) and the hook translates the transcript's own
   * handle with it.
   *
   * EVERY OUTCOME OF THIS PATH IS RECORDED, and the refusals are recorded as
   * `null` — a shadow that translates nothing and, being the newest answer,
   * overrides an earlier resolution of the same handle IN THE SAME PROJECT.
   * That is not tidiness, it is §5 G6: the log is keyed by the handle, because
   * RESOLUTION is deterministic, but a REFUSAL is not. The owner's own session
   * resolves a confidential title; a stranger's session asking the same title
   * is told nothing. `handle-unknown` and `handle-ambiguous` shadow for the same
   * reason — a title since renamed away, or gone ambiguous, must not go on
   * crediting the memory it used to name.
   *
   * **THE SHADOW IS NOT THE CONFIDENTIALITY BOUNDARY, and the first draft of
   * this method said it was.** A shadow only exists where an answer was given.
   * Three askings get no answer and leave no shadow — a call that never reached
   * `expandHandle`, a `{ handle, question }` the dispatcher refuses as
   * `both-arguments` before this path exists, and a refusal whose write failed
   * (`recordHandleResolution` returns false; it may not throw at a tool). Each
   * of those still puts the title in the transcript, so each still reaches a
   * boundary looking for a translation. What stops them is the SCOPE recorded on
   * every line, which `readHandleResolutions` filters on: another project's
   * resolution cannot answer this project's handle. `scope` is therefore
   * load-bearing here, not forensics.
   *
   * Filtering also retires the price the first draft accepted — a stranger's
   * refusal between the owner's call and the owner's Stop costing the owner the
   * credit — because that shadow now carries the stranger's scope.
   *
   * The `ids` path is out of scope: those are literal addresses the credit pass
   * already sees, and a per-id account of what each resolved to is `perId`'s
   * job, not this one's.
   *
   * Never throws and never changes the answer. A write that FAILED is not
   * symmetrical, though, and the asymmetry is worth naming: a lost RESOLUTION
   * costs credit (safe), a lost REFUSAL leaves an older resolution standing
   * where a shadow should have been (not safe). Across projects the scope filter
   * makes that moot — the older resolution belongs to a directory the next
   * boundary is not in. Within one project directory it is the residual this
   * seam is known to carry.
   */
  private noteHandleResolution(handle: unknown, result: DeliberateResult): boolean {
    if (typeof handle !== "string" || handle.trim().length === 0) return false;
    if (result.path !== "handle") return false;
    const id = resolvedIdOf(result);
    if (id === undefined) return false;
    const written = recordHandleResolution(this.registryDir, {
      handle,
      id,
      scope: this.scope,
      at: this.nowFn(),
    });
    return written && id !== null;
  }

  /**
   * One embedding call, and every way it can decline, by name. The credential
   * itself never appears here — `openEmbedder` was handed one at the entry point
   * and this file only ever sees vectors or null.
   */
  private async embedQuestion(
    question: string,
  ): Promise<{ vector: number[] | null; semantic: SemanticSource }> {
    if (this.embedder === null) return { vector: null, semantic: "embedder-off" };
    try {
      const vector = await this.embedder.vector(question);
      return vector === null || vector.length === 0
        ? { vector: null, semantic: "embed-failed" }
        : { vector, semantic: "in-line" };
    } catch {
      return { vector: null, semantic: "embed-failed" };
    }
  }

  /**
   * The payload, BOUNDED. A list answers "which memories" and ships excerpts;
   * an address (`handle`, or `ids`) answers "what did it say" and ships as much
   * body as the total budget allows. See `deliberate.ts`'s size constants for
   * the measurement that set them.
   */
  private recallPayload(result: DeliberateResult): Record<string, unknown> {
    const byAddress = result.path === "handle";
    const bounded = boundMemories(
      result.memories,
      byAddress ? RECALL_BODY_CHARS : RECALL_EXCERPT_CHARS,
    );
    return {
      path: result.path,
      reason: result.reason,
      /** Said out loud, never inferred from a thinner answer: when the semantic
       *  channel could not run, the asker is told which channel answered. */
      semantic: result.semantic,
      /** The two numbers §9.1 G3 exists for: a count here is never a top-K. */
      considered: result.considered,
      /** `considered` is `MAX_CANDIDATES`, and saying so is the difference
       *  between a bound and a census (§9.1 G3). Read from the recall instance
       *  in force, not the module default, or a calibration override would be
       *  invisible in the one place the number is explained. */
      consideredCap: this.counterpart.recall.tunables.MAX_CANDIDATES,
      storeSize: result.storeSize,
      returned: bounded.memories.length,
      chars: bounded.chars,
      truncated: bounded.truncated,
      ...(bounded.droppedForBudget > 0 ? { droppedForBudget: bounded.droppedForBudget } : {}),
      ...(bounded.truncated || bounded.droppedForBudget > 0
        ? {
            budget: `Result bounded to ${RECALL_RESULT_CHARS} characters (${RECALL_EXCERPT_CHARS} per memory in a list, ${RECALL_BODY_CHARS} when asked for by id). Ask again with ids: [...] for up to ${RECALL_MAX_IDS} full bodies.`,
          }
        : {}),
      ...(result.ambiguous.length > 0 ? { ambiguous: [...result.ambiguous] } : {}),
      ...(result.perId === undefined ? {} : { perId: result.perId.map((p) => ({ ...p })) }),
      ...(result.reason === "ids-too-many"
        ? { refused: `At most ${RECALL_MAX_IDS} ids per call. Effort is not enumeration.` }
        : {}),
      ...(result.reason === "handle-confidential-withheld"
        ? {
            withheld:
              "That memory is marked confidential and this is not the owner's own session. It exists; it is not being shown.",
          }
        : {}),
      memories: bounded.memories.map((m) => ({ ...m })),
      /** The label the ruling of 2026-09-04 put on every delivered chapter,
       *  glossed once here so `journal: true` on a row is not a bare boolean the
       *  reader has to guess the meaning of (`deliberate.ts#JOURNAL_GLOSS`).
       *  CONDITIONAL, like `budget`, `refused` and `withheld` beside it: 207
       *  bytes explaining a flag that is not on any row is the wire budget spent
       *  on a word nobody read. */
      ...(bounded.memories.some((m) => m.journal) ? { journal: JOURNAL_GLOSS } : {}),
      tiers: {
        vivid: "came clearly to mind",
        quiet: "quietly available — the ambient path would have footnoted this",
        dim: "reached only because you asked deliberately; lower confidence, and labeled so",
      },
    };
  }

  /**
   * `status` — the census (§5 G7). Counts, kinds, bands, dates. No ids, no
   * bodies, and NO CONTENT HASHES: a hash of low-entropy content is
   * brute-forceable, so a hash in the record of a removal is a leak of the
   * thing removed (scar §2.20).
   *
   * The symmetry counters are the useful minimum CONTRACT §7 OQ2 names —
   * created versus exited per kind. They are the numbers that made v1's
   * pathologies visible; a store census on its own never did.
   */
  private statusTool(): ToolResult {
    if (this.observer) return this.standDown("status");
    const census = this.census();
    this.emit("mcp.status", undefined, {
      live: census["live"] as number,
      removed: (census["removed"] as Record<string, unknown>)["count"] as number,
    });
    return this.result(census, false);
  }

  private census(): Record<string, unknown> {
    const store = this.counterpart.store;
    const kinds: Kind[] = ["self", "person", "entity", "skill", "place", "fact"];
    const bands: Band[] = ["episodic", "semantic", "identity"];

    const denied = new Set(store.deniedIds());
    const created: Record<string, number> = {};
    const exited: Record<string, number> = {};
    const byBand: Record<string, number> = {};
    let live = 0;
    let archived = 0;
    let superseded = 0;
    // Journal entries, counted APART. An episode is the source a memory was
    // made from, not a memory: it is outside every sleep phase
    // (`sleep/types.ts#isJournal`), so counting it among the memories would
    // report as "held" a row that neither decays nor exits. Reported rather
    // than dropped, because a number that quietly excludes something is the
    // kind of census §16 forbids.
    let journal = 0;

    for (const kind of kinds) {
      const ids = store.list({ kind });
      let born = 0;
      let gone = 0;
      for (const id of ids) {
        const row = store.row(id);
        if (row === undefined) continue;
        if (row.type === "episode") {
          if (row.archived === 0 && !denied.has(id)) journal += 1;
          continue;
        }
        born += 1;
        if (denied.has(id)) {
          gone += 1;
          continue;
        }
        if (row.archived === 1) {
          gone += 1;
          archived += 1;
          continue;
        }
        if (row.superseded_by !== null) {
          gone += 1;
          superseded += 1;
          continue;
        }
        live += 1;
        byBand[row.band] = (byBand[row.band] ?? 0) + 1;
      }
      created[kind] = born;
      exited[kind] = gone;
    }
    for (const band of bands) byBand[band] = byBand[band] ?? 0;

    // Removals: counts, kinds, dates. Never an id — the enumeration of what was
    // removed is the CLI's owner-side surface, not the model's.
    const dates = new Set<string>();
    const removedKinds: Record<string, number> = {};
    const removedIds = new Set<string>();
    for (const row of store.removalRecord()) {
      if (row.stage !== "complete") continue;
      removedIds.add(row.memory_id);
      dates.add(new Date(row.at).toISOString().slice(0, 10));
      const kind = store.row(row.memory_id)?.kind ?? "unknown";
      removedKinds[kind] = (removedKinds[kind] ?? 0) + 1;
    }

    return {
      live,
      archived,
      superseded,
      journal,
      byKind: created,
      byBand,
      /** OQ2's symmetry counters: born versus left, per kind. */
      symmetry: { created, exited },
      removed: {
        count: removedIds.size,
        kinds: removedKinds,
        dates: [...dates].sort(),
        note: "Counts, kinds and dates only. No ids, no bodies, no hashes.",
      },
      counts: "Every number above is MEMORIES. `journal` is the first-person episodes those memories were made from: it is the source, not a memory, and it neither decays nor is pruned.",
      clock: {
        livedDay: store.livedDay(),
        lastActiveDate: store.getMeta("lastActiveDate") ?? null,
      },
      stance: { observer: this.observer, owner: this.owner },
    };
  }

  /**
   * `session_end` — the MEMORIES half of the Stop ask's return channel.
   *
   * Per-entry failure isolation (scar E1): one refused entry announces itself
   * and its siblings still land. A single bad item failing the whole dump is
   * how a session's memory becomes all-or-nothing at exactly the moment there
   * is no second chance to write it.
   */
  private async sessionEndTool(args: Record<string, unknown>): Promise<ToolResult> {
    if (this.observer) return this.standDown("session_end");
    const bound = this.requireBoundSession(args["session"], "session_end");
    if (bound !== null) return bound;

    const raw = args["memories"];
    if (!Array.isArray(raw) || raw.length === 0) {
      return this.refuse("session_end", "memories-required", {});
    }
    const session = this.session as string;
    const entries: Record<string, unknown>[] = [];
    for (const item of raw) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        entries.push({ content: "" });
        continue;
      }
      const rec = item as Record<string, unknown>;
      const draft: Record<string, unknown> = { content: rec["content"] };
      if (typeof rec["kind"] === "string") draft["kind"] = rec["kind"];
      if (typeof rec["title"] === "string") draft["title"] = rec["title"];
      if (typeof rec["updates"] === "string") draft["updates"] = rec["updates"];
      if (rec["salience"] !== undefined) draft["claimed"] = rec["salience"];
      // A bad dimension does NOT fail the batch and is not silently dropped:
      // the dimensions ride into the draft and `remember/intake` refuses that
      // one entry as malformed, which is this tool's per-entry isolation rule.
      const entryDims = readDimensions(rec) ?? pickDimensions(rec);
      if (Object.keys(entryDims).length > 0) draft["salience"] = entryDims;
      entries.push(draft);
    }

    const outcomes: Record<string, unknown>[] = [];
    let deposited = 0;
    for (const draft of entries) {
      let result: DepositResult;
      try {
        result = await this.counterpart.submitSessionEnd(draft, {
          session,
          scope: this.scope,
        });
      } catch (err) {
        // Isolation, not a lost dump: this entry failed, the rest still run.
        outcomes.push({ stored: false, reason: "threw", detail: String((err as Error).message ?? err) });
        continue;
      }
      if (result.deposited) deposited += 1;
      // A refusal names what to fix. `malformed` alone sent the author back to
      // guess (IMPROVEMENTS U11: a kind outside the enum came back as a bare
      // "malformed"); intake's own reason rides out, and an unknown kind lists
      // the kinds that exist.
      const malformed = result.malformed ?? null;
      outcomes.push({
        stored: result.deposited,
        reason: result.reason,
        ...(result.memoryId === null ? {} : { id: result.memoryId }),
        ...(result.gate === null ? {} : { gate: result.gate }),
        ...(malformed === null ? {} : { malformed }),
        ...(malformed === "KIND_UNKNOWN" ? { kinds: [...MEMORY_KINDS] } : {}),
      });
    }
    this.emit("mcp.session_end", session, {
      entries: entries.length,
      deposited,
      refused: entries.length - deposited,
    });
    return this.result(
      {
        session,
        entries: entries.length,
        deposited,
        refused: entries.length - deposited,
        outcomes,
      },
      deposited === 0,
    );
  }

  /**
   * `chapter` — the journal's door (self/CONTRACT §3: *which door reaches this?*).
   *
   * It composes, like everything else here: `Counterpart.appendEpisode` runs the
   * gate, `self/` decides whether this append opens a chapter or continues the
   * one already open, and the number that comes back is the number the store
   * WROTE. The ask reads the same counter, so the two sides cannot drift the way
   * they did for a fortnight — the model wrote eleven chapters as notes while
   * the hook's count said seven.
   */
  private async chapterTool(args: Record<string, unknown>): Promise<ToolResult> {
    if (this.observer) return this.standDown("chapter");
    const bound = this.requireBoundSession(args["session"], "chapter");
    if (bound !== null) return bound;

    const text = args["text"];
    if (typeof text !== "string" || text.trim().length === 0) {
      return this.refuse("chapter", "text-required", {
        detail: "A chapter has to say something. Nothing worth writing is a real answer — say nothing at all instead.",
      });
    }
    const session = this.session as string;
    const title = args["title"];
    let written: ChapterResult;
    try {
      written = this.counterpart.appendEpisode(session, text, {
        ...(typeof title === "string" && title.length > 0 ? { title } : {}),
      });
    } catch (err) {
      // A journal that throws must not look like a journal that refused.
      return this.refuse("chapter", "threw", { detail: String((err as Error).message ?? err) });
    }
    this.emit("mcp.chapter", written.episodeId ?? undefined, {
      session,
      stored: written.appended,
      reason: written.reason,
      chapter: written.chapter,
      created: written.created,
    });
    return this.result(
      {
        stored: written.appended,
        reason: written.reason,
        session,
        episodeId: written.episodeId,
        // From the STORE, never from the ask count.
        chapter: written.chapter,
        created: written.created,
        ...(written.gate === null ? {} : { gate: written.gate }),
      },
      !written.appended,
    );
  }

  /**
   * The bound-session refusal, and the ONE way a server binds itself.
   *
   * Three states, in order:
   *
   *   1. **The host said so at launch** (`--session`). Unchanged and preferred:
   *      the registry is never consulted, and a claim for another id is refused.
   *   2. **Already bound** — by launch or by an earlier claim. The bind is for
   *      the process's lifetime, so a second, DIFFERENT id is refused with the
   *      reason that says why.
   *   3. **Unbound.** The claim must name an id (never inferred — see the
   *      CONTRACT's residual risk: two live sessions in one directory are
   *      distinguishable only by the id the ask named), and that id must be in
   *      the hooks' registry, live, and in THIS server's scope. Every refusal
   *      says which of the four it was, because a model that cannot tell
   *      "unknown id" from "wrong project" cannot do anything about either.
   */
  private requireBoundSession(claimed: unknown, tool: ToolName): ToolResult | null {
    const bound = this.session;
    if (bound !== null) {
      if (claimed !== undefined && claimed !== bound) {
        this.emit("mcp.session.mismatch", undefined, {
          bound: true,
          source: this.launchedSession !== null ? "launch" : "registry",
        });
        return this.refuse(tool, "session-mismatch", {
          detail:
            "This server is already bound to a different session, for the life of the process. A dump belongs to the session that lived it.",
        });
      }
      return null;
    }

    if (typeof claimed !== "string" || claimed.length === 0) {
      this.emit("mcp.session.unbound", undefined, { reason: "no-claim" });
      return this.refuse(tool, "session-required", {
        detail:
          "This server was launched without a session. Pass `session` — the session id the end-of-session ask named — and it will bind to it.",
      });
    }

    const record = readSession(this.registryDir, claimed);
    if (record === null) {
      this.emit("mcp.session.unbound", undefined, { reason: "unknown" });
      return this.refuse(tool, "session-unknown", {
        detail:
          "No live session by that id has been recorded by this host's hooks. Use the id the end-of-session ask named, exactly.",
      });
    }
    if (!isLive(record, this.nowFn(), this.sessionTtlMs)) {
      this.emit("mcp.session.unbound", undefined, {
        reason: record.endedAt === null ? "stale" : "ended",
      });
      return this.refuse(tool, "session-not-live", {
        detail:
          "That session has ended or has been silent too long to still be writing its own day. Its memories belong to the sweep now.",
      });
    }
    if (!sameScope(record.scope, this.scope)) {
      this.emit("mcp.session.unbound", undefined, { reason: "scope-mismatch" });
      return this.refuse(tool, "scope-mismatch", {
        detail:
          "That session is running in a different project than this server. A dump belongs to the project that lived it.",
      });
    }

    this.lazySession = claimed;
    this.emit("mcp.session.bound", claimed, { source: "registry", scope: this.scope });
    return null;
  }

  // ── result shapes ──────────────────────────────────────────────────────────

  private depositResult(tool: string, deposit: DepositResult): ToolResult {
    this.emit(`mcp.${tool}`, deposit.memoryId ?? undefined, {
      stored: deposit.deposited,
      reason: deposit.reason,
      gate: deposit.gate,
      covers: deposit.covers.length,
    });
    const lifted = deposit.mint?.lifted ?? false;
    return this.result(
      {
        stored: deposit.deposited,
        reason: deposit.reason,
        ...(deposit.memoryId === null ? {} : { id: deposit.memoryId }),
        ...(deposit.gate === null ? {} : { gate: deposit.gate }),
        ...(lifted ? { salienceLifted: true } : {}),
      },
      !deposit.deposited,
    );
  }

  /**
   * The stand-down (§5 G5, scars E7/§2.4). It is loud on purpose: a tool that
   * returned nothing under observer would be indistinguishable from a tool that
   * crashed, and v1 shipped exactly that ambiguity.
   */
  private standDown(tool: string): ToolResult {
    this.emit("mcp.observer.standdown", undefined, { tool });
    return this.result(
      {
        stoodDown: true,
        tool,
        stance: "observer",
        reason:
          "This session is an observer: it reads the store as an instrument and changes nothing in it. The tool did not run.",
      },
      true,
    );
  }

  private refuse(
    tool: string,
    reason: string,
    extra: Record<string, unknown>,
  ): ToolResult {
    this.emit("mcp.refused", undefined, { tool, reason });
    return this.result({ stored: false, tool, reason, ...extra }, true);
  }

  private result(payload: Record<string, unknown>, isError: boolean): ToolResult {
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
      ...(isError ? { isError: true } : {}),
    };
  }

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const event: McpEvent = { at: this.nowFn(), name };
    if (ref !== undefined) event.ref = ref;
    if (data !== undefined) event.data = data;
    this.ring.push(event);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    this.onEvent?.(event);
  }

  /** True once a client has completed the handshake. Host trivia, checkable. */
  ready(): boolean {
    return this.initialized;
  }
}

/**
 * What one handle-path answer should leave in the resolution log, as a TOTAL
 * table over the reasons that path can produce:
 *
 *   an id       — it expanded, and this is what it reached
 *   `null`      — it was asked and answered with nothing (the shadow)
 *   `undefined` — not this path's outcome at all; record nothing
 *
 * Total on purpose. A new handle-path reason added without a line here records
 * nothing rather than guessing, which fails in the under-credit direction.
 */
function resolvedIdOf(result: DeliberateResult): string | null | undefined {
  switch (result.reason) {
    case "expanded":
      return result.memories.length === 1 ? (result.memories[0]?.id ?? null) : undefined;
    case "handle-unknown":
    case "handle-ambiguous":
    case "handle-confidential-withheld":
      return null;
    default:
      return undefined;
  }
}

/**
 * The three dimensions an author may claim, off the wire. `null` means "one of
 * them was present and unusable" — a refusal, not a silent drop, because a
 * dimension that quietly vanishes is worse than one that was never offered:
 * both leave a 0 in the row and only one of them tells anybody.
 *
 * `novelty` is deliberately not readable here. It is prediction error, computed
 * at encoding against the store's own context; an author claiming it is exactly
 * the door PR-3 closed in `remember/proposals.ts`.
 */
function readDimensions(rec: Record<string, unknown>): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const dim of AUTHOR_DIMENSIONS) {
    const v = rec[dim];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return null;
    out[dim] = v;
  }
  return out;
}

/** The unvalidated read, used only where the refusal must be per-entry: the
 *  values ride to `remember/intake`, which refuses that entry by name. */
function pickDimensions(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const dim of AUTHOR_DIMENSIONS) {
    if (rec[dim] !== undefined) out[dim] = rec[dim];
  }
  return out;
}

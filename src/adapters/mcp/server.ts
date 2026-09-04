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
 *      session's authorship ask (`claude-code/INTERFACE-GAPS.md` §7). A server
 *      launched for session A may not accept session B's dump, and a server
 *      launched with no session may not accept anyone's — "unbound" is a
 *      refusal, not a wildcard. A host that lets a model pick the session id it
 *      writes under has handed the model the ability to write into another
 *      session's day.
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
import type { Counterpart, DepositResult } from "../../core/counterpart.js";
import type { SemanticSource } from "../../core/recall/index.js";
import type { Band, Kind } from "../../core/types.js";
import { deliberateRecall } from "./deliberate.js";
import type { DeliberateResult } from "./deliberate.js";
import {
  ERROR_CODES,
  failure,
  negotiateVersion,
  success,
} from "./protocol.js";
import type { Id, Request, Response } from "./protocol.js";
import { TOOL_NAMES, toolDefinitions, toolSpec } from "./tools.js";

export const SERVER_NAME = "counterparts";
export const SERVER_VERSION = "0.0.0";

/** Telemetry: ids, counts, reasons, flags. NEVER body text (store §5 G10). */
export interface McpEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

export interface McpServerOptions {
  counterpart: Counterpart;
  /** The ONE session this server may deposit under. Absent ⇒ `session_end` refuses. */
  session?: string;
  /** The project/scope this session belongs to. Defaults to the store's dir. */
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

export class McpServer {
  readonly counterpart: Counterpart;
  readonly session: string | null;
  readonly scope: string;
  readonly owner: boolean;
  /** One predicate, one definition: the store's (observer-mode G7). */
  readonly observer: boolean;

  private readonly embedder: QuestionEmbedder | null;
  private readonly onEvent: ((e: McpEvent) => void) | undefined;
  private readonly nowFn: () => number;
  private readonly ring: McpEvent[] = [];
  private initialized = false;

  constructor(opts: McpServerOptions) {
    this.counterpart = opts.counterpart;
    this.session = opts.session !== undefined && opts.session.length > 0 ? opts.session : null;
    this.scope = opts.scope ?? opts.counterpart.store.dir;
    this.observer = opts.counterpart.observer;
    // An observer is a non-owner regardless of what the host claimed
    // (observer-mode G7): an instrument reading somebody's store is not them.
    this.owner = opts.owner === true && !this.observer;
    // An instrument opens no sockets, whatever the host handed it (scar E7).
    this.embedder = this.observer ? null : opts.embedder ?? null;
    this.onEvent = opts.onEvent;
    this.nowFn = opts.now ?? ((): number => Date.now());
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
    switch (name) {
      case "note":
        return this.noteTool(args);
      case "recall":
        return await this.recallTool(args);
      case "status":
        return this.statusTool();
      case "session_end":
        return this.sessionEndTool(args);
      default:
        return this.refuse(name, "unknown-tool", { tool: name });
    }
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
    const session = this.session ?? "mcp";

    const captured = this.counterpart.captureJot({ session, scope: this.scope, text });
    const ownSpanHash = captured.spans[0]?.hash ?? null;

    const draft: Record<string, unknown> = { content: text };
    if (typeof args["kind"] === "string") draft["kind"] = args["kind"];
    if (typeof args["title"] === "string") draft["title"] = args["title"];
    if (salience !== undefined) draft["claimed"] = salience;

    const deposit = await this.counterpart.submitJot(draft, {
      session,
      scope: this.scope,
      ownSpanHash,
    });
    return this.depositResult("note", deposit);
  }

  /** `recall` — the deeper look. Writes nothing; see `deliberate.ts`. */
  private async recallTool(args: Record<string, unknown>): Promise<ToolResult> {
    if (this.observer) return this.standDown("recall");
    const handle = args["handle"];
    const question = args["question"];
    if (handle !== undefined && typeof handle !== "string") {
      return this.refuse("recall", "handle-not-a-string", {});
    }
    if (question !== undefined && typeof question !== "string") {
      return this.refuse("recall", "question-not-a-string", {});
    }
    // IN LINE, and only for a question: the handle path is an exact address and
    // embedding it would buy nothing but a round trip. A refusal is a NAME, not
    // a narrower answer — `deliberateRecall` degrades to lexical and says which.
    const asked = typeof question === "string" && question.trim().length > 0;
    const embedded = asked ? await this.embedQuestion(question) : { vector: null, semantic: "none" as SemanticSource };
    const result = deliberateRecall(
      this.counterpart,
      {
        ...(typeof handle === "string" ? { handle } : {}),
        ...(typeof question === "string" ? { question } : {}),
      },
      {
        sessionId: this.session ?? "mcp",
        owner: this.owner,
        vector: embedded.vector,
        semantic: embedded.semantic,
      },
    );
    this.emit("mcp.recall", undefined, {
      path: result.path,
      reason: result.reason,
      semantic: result.semantic,
      returned: result.memories.length,
      considered: result.considered,
      storeSize: result.storeSize,
      owner: this.owner,
    });
    const payload = this.recallPayload(result);
    const bad =
      result.reason === "no-argument" ||
      result.reason === "both-arguments" ||
      result.reason === "handle-unknown" ||
      result.reason === "handle-confidential-withheld";
    return this.result(payload, bad);
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

  private recallPayload(result: DeliberateResult): Record<string, unknown> {
    return {
      path: result.path,
      reason: result.reason,
      /** Said out loud, never inferred from a thinner answer: when the semantic
       *  channel could not run, the asker is told which channel answered. */
      semantic: result.semantic,
      /** The two numbers §9.1 G3 exists for: a count here is never a top-K. */
      considered: result.considered,
      storeSize: result.storeSize,
      returned: result.memories.length,
      ...(result.ambiguous.length > 0 ? { ambiguous: [...result.ambiguous] } : {}),
      ...(result.reason === "handle-confidential-withheld"
        ? {
            withheld:
              "That memory is marked confidential and this is not the owner's own session. It exists; it is not being shown.",
          }
        : {}),
      memories: result.memories.map((m) => ({
        id: m.id,
        tier: m.tier,
        kind: m.kind,
        title: m.title,
        body: m.body,
        ...(m.admittedUnder === undefined ? {} : { admittedUnder: m.admittedUnder }),
      })),
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

    for (const kind of kinds) {
      const ids = store.list({ kind });
      created[kind] = ids.length;
      let gone = 0;
      for (const id of ids) {
        const row = store.row(id);
        if (row === undefined) continue;
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
      clock: {
        livedDay: store.livedDay(),
        lastActiveDate: store.getMeta("lastActiveDate") ?? null,
      },
      stance: { observer: this.observer, owner: this.owner },
    };
  }

  /**
   * `session_end` — the authorship ask's return channel.
   *
   * Per-entry failure isolation (scar E1): one refused entry announces itself
   * and its siblings still land. A single bad item failing the whole dump is
   * how a session's memory becomes all-or-nothing at exactly the moment there
   * is no second chance to write it.
   */
  private async sessionEndTool(args: Record<string, unknown>): Promise<ToolResult> {
    if (this.observer) return this.standDown("session_end");
    const bound = this.requireBoundSession(args["session"]);
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
      outcomes.push({
        stored: result.deposited,
        reason: result.reason,
        ...(result.memoryId === null ? {} : { id: result.memoryId }),
        ...(result.gate === null ? {} : { gate: result.gate }),
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
   * The bound-session refusal. Unbound is a REFUSAL, not a wildcard: a server
   * launched without a session has no day to write into, and accepting one the
   * model names would let it write into somebody else's.
   */
  private requireBoundSession(claimed: unknown): ToolResult | null {
    if (this.session === null) {
      this.emit("mcp.session.unbound", undefined, {});
      return this.refuse("session_end", "no-bound-session", {
        detail: "This server was launched without a session; there is no day to write into.",
      });
    }
    if (claimed !== undefined && claimed !== this.session) {
      this.emit("mcp.session.mismatch", undefined, { bound: true });
      return this.refuse("session_end", "session-mismatch", {
        detail: "This server is bound to a different session. A dump belongs to the session that lived it.",
      });
    }
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

/**
 * `adapters/mcp/` — the deliberate tools, over the wire.
 *
 * The dependency direction is one-way and asserted by a test: the core imports
 * NOTHING from this directory (CONTRACT §5 G9, constitution line 5). Everything
 * exported here is host-shaped; everything imported from `../../core/` is
 * host-agnostic.
 */
export {
  ERROR_CODES,
  FrameReader,
  JSONRPC_VERSION,
  LATEST_PROTOCOL_VERSION,
  PROTOCOL_VERSIONS,
  encodeMessage,
  failure,
  isNotification,
  negotiateVersion,
  parseLine,
  success,
} from "./protocol.js";
export type { ErrorResponse, Id, ParsedLine, Request, Response, SuccessResponse } from "./protocol.js";

export { TOOLS, TOOL_NAMES, renderDescription, toolDefinitions, toolSpec } from "./tools.js";
export type { Privilege, ToolName, ToolSpec } from "./tools.js";

export {
  DELIBERATE_DIM_CAP,
  DELIBERATE_TIERS,
  HARD_GATES,
  answerQuestion,
  deliberateRecall,
  expandHandle,
  tierOf,
} from "./deliberate.js";
export type {
  DeliberateInput,
  DeliberateOptions,
  DeliberateReason,
  DeliberateResult,
  Recalled,
  Tier,
} from "./deliberate.js";

export { McpServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
export type { McpEvent, McpServerOptions, QuestionEmbedder, ToolResult } from "./server.js";

export { serveStdio } from "./stdio.js";
export type { StdioOptions } from "./stdio.js";

import { Counterpart } from "../../core/counterpart.js";
import { McpServer } from "./server.js";
import type { McpServerOptions } from "./server.js";

export interface OpenServerOptions extends Omit<McpServerOptions, "counterpart"> {
  /** Where the memory lives. Defaults to the store's own resolution. */
  dir?: string;
  observer?: boolean;
}

/**
 * Open a brain and wrap it in the tools. The host facts — the data dir, whose
 * session this is, which session id the deposits belong to — travel as
 * ARGUMENTS, never as ambient state this file reads for itself (scar §2.13).
 */
export function openServer(opts: OpenServerOptions = {}): McpServer {
  const counterpart = Counterpart.open({
    ...(opts.dir === undefined ? {} : { dir: opts.dir }),
    ...(opts.observer === undefined ? {} : { observer: opts.observer }),
    ...(opts.owner === undefined ? {} : { owner: opts.owner }),
  });
  return new McpServer({
    counterpart,
    ...(opts.session === undefined ? {} : { session: opts.session }),
    ...(opts.scope === undefined ? {} : { scope: opts.scope }),
    ...(opts.owner === undefined ? {} : { owner: opts.owner }),
    // The embedder is the ENTRY POINT's to open, because the credential is:
    // this file composes, it does not read a key (server.ts's header).
    ...(opts.embedder === undefined ? {} : { embedder: opts.embedder }),
    ...(opts.onEvent === undefined ? {} : { onEvent: opts.onEvent }),
    ...(opts.now === undefined ? {} : { now: opts.now }),
  });
}

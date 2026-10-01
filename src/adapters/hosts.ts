/**
 * WHICH HOST A SESSION LIVES IN, AND THE FEW SENTENCES THAT DEPEND ON IT.
 *
 * Until 2026-09-30 there was one host, and its UI text sat wherever it was
 * first needed: "Run /mcp and Reconnect" in `sessions.ts`, and inside two MCP
 * refusals that end with it. That sentence is Claude Code's — `/mcp` is its
 * slash command — and a tool result read in Claude Desktop's chat, which has no
 * such command, would tell the model to ask the person for something that does
 * not exist. So the words a result says ABOUT THE HOST are looked up here, by
 * host, and nowhere else.
 *
 * Two things this file keeps:
 *
 *   **A record with no host is Claude Code's.** Every session record written
 *   before this field existed was written by Claude Code's hooks, so
 *   `DEFAULT_HOST` is what an absent `host` reads as (`sessions.ts#hostOf`),
 *   and what a process that was told nothing writes as.
 *
 *   **Claude Code's words do not move.** Its entry is the text those callers
 *   printed before this table existed, byte for byte; the exported constants
 *   that name it (`sessions.ts#RECONNECT_REMEDY`,
 *   `mcp/server.ts#STALE_SERVER_REFUSAL`) are built from it and compare equal.
 *
 * A host name is a short token, checked like a session's entrypoint, so a
 * record written by a newer build naming a host this build has no words for
 * still reads — and speaks with the default host's words. It sits beside
 * `sessions.ts` for the same reason that file does: every adapter needs it, and
 * no adapter may import another.
 */

/** The host every record without one belongs to: the launch host. */
export const DEFAULT_HOST = "claude-code";

/** A host name as a record keeps it: short, one lowercase token. */
export function isHostName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,47}$/.test(value);
}

/**
 * CLAUDE DESKTOP'S CHAT (2026-09-30, PR B of the host groundwork). One MCP
 * server per app, shared by every chat; no hooks, no conversation id on the
 * wire, no transcript. The server is its own "hook" there: a `wake` tool mints
 * the session, and a call that names none binds to the most recent live one
 * (`mcp/server.ts`). Cowork (local agent mode) is treated the same for now.
 */
export const DESKTOP_HOST = "claude-desktop";

/**
 * THE ONE PLACE EVERY DESKTOP CHAT SHARES (owner, 2026-09-30: one pseudo-scope
 * for now, per-Project only if real use calls for it). Not a directory: it
 * never goes through `resolve` or `realpath` (`isPseudoScope`), so every
 * process spells it the same whatever its working directory.
 */
export const DESKTOP_SCOPE = "claude-desktop:";

/**
 * THE ENTRYPOINT CLAUDE CODE REPORTS IN DESKTOP'S CODE TAB — measured
 * 2026-10-01: a Code-tab session's registry record carried
 * `"entrypoint":"claude-desktop"` (from `CLAUDE_CODE_ENTRYPOINT`). The hooks
 * add the Code-tab wake line for it; Desktop's MCP server serves a named
 * Claude Code session only when its record says it (mcp CONTRACT G21).
 */
export const CODE_TAB_ENTRYPOINT = "claude-desktop";

/**
 * A SCOPE THAT IS A NAME, NOT A PATH — `claude-desktop:`, or a later
 * `claude-desktop:<something>`. A lowercase host-shaped token of two or more
 * characters, then a colon, and no path separator anywhere: no absolute path,
 * relative path or Windows drive (`c:`) reads as one. `sessions.ts#canonicalScope`
 * and `scopes.ts#canonicalScopePath` hand it back unchanged — resolved against a
 * working directory it would be a different string in every process.
 */
export function isPseudoScope(scope: string): boolean {
  return /^[a-z][a-z0-9._-]+:[^/\\]*$/.test(scope);
}

/**
 * WHICH HOST AN MCP CLIENT IS, from the `clientInfo.name` it sends at
 * `initialize` — the one signal a server has about who is talking to it, and
 * the one that holds when Desktop's config entry is ALSO loaded by Desktop's
 * Code tab (there the client is Claude Code, and the answer is null). Measured
 * 2026-09-30 (desktop-chat design §10): `claude-ai` for chat, and
 * `local-agent-mode-<entry name>` for Cowork. Anything else — Claude Code, any
 * other client, no name at all — is null: today's behaviour, unchanged.
 */
/**
 * THE BELT UNDER THE CLIENT'S NAME: what Claude Code exports to every process it
 * starts, stdio MCP servers included (`claude-code/night-run.ts#HOST_SESSION_ENV`
 * strips the same three from a child for the same reason). A server whose
 * environment carries any of them was started BY Claude Code — Desktop's Code
 * tab included — whatever name its client sends, and keeps Claude Code's
 * behaviour: the Code tab's client name was never measured, and a Code-tab
 * server turned into Desktop's would file every call that names no session
 * under the most recent Desktop chat, and serve the session's own id only as
 * Desktop's server does (mcp CONTRACT G21). (Measured 2026-10-01: the Code
 * tab's own server does stay Claude Code's — but the counterparts tools its
 * model calls are Desktop's server, which is why G21 exists.)
 * Returns the variable that said so, or null.
 */
export const CLAUDE_CODE_ENV_MARKERS = ["CLAUDE_PROJECT_DIR", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"] as const;

export function claudeCodeEnvMarker(env: Readonly<Record<string, string | undefined>>): string | null {
  for (const name of CLAUDE_CODE_ENV_MARKERS) {
    const value = env[name];
    if (typeof value === "string" && value.length > 0) return name;
  }
  return null;
}

export function hostOfClient(clientName: unknown): string | null {
  if (typeof clientName !== "string") return null;
  if (clientName === "claude-ai" || clientName.startsWith("local-agent-mode-")) return DESKTOP_HOST;
  return null;
}

/**
 * A "NO FOLDER" SCRATCH WORKSPACE OF DESKTOP'S CODE TAB (2026-09-30, brief item
 * 10). A Code-tab session started without a folder runs in a directory Desktop
 * makes for it and deletes with the session —
 * `~/Library/Application Support/Claude/scratch-workspaces/<id>/<id>/scratch-<date>-<hex>`,
 * the shape seen in Claude Code's own project list on 2026-09-30 — so asking
 * the first-launch scope question there would leave a `scopes.json` entry for
 * a folder that is about to vanish. The hooks skip the question inside one;
 * everything else runs there as in any directory.
 */
export function isDesktopScratchWorkspace(dir: string): boolean {
  return /\/Library\/Application Support\/Claude\/scratch-workspaces(\/|$)/.test(dir);
}

/** The sentences a tool result or a notice says about the host it is read in. */
export interface HostWording {
  /**
   * How to load a newer build into this host's connection to the MCP server —
   * the whole sentence, ending a line that already said what changed
   * ("Counterparts was updated. <this>").
   */
  readonly reconnect: string;
  /**
   * The same step as the first of two, when doing it may not be enough
   * ("<this>; if that does not help, run `counterparts doctor`.").
   */
  readonly reconnectFirst: string;
  /**
   * What switching this place OFF (or pausing it) does, as the `scope` tool's
   * result says it — the host's machinery named in the host's terms.
   */
  readonly scopeOff: string;
  /** What switching it back ON does, the same way. */
  readonly scopeOn: string;
  /** Every other tool's refusal while this place is OFF, and the way back on. */
  readonly offRefusal: string;
  /** The same while it is PAUSED. */
  readonly pausedRefusal: string;
}

/**
 * THE TABLE. Claude Code's and Claude Desktop's; a host added later brings its
 * own entry, and `wordingFor` gives any host without one the default host's words.
 */
export const HOST_WORDING: Readonly<Record<string, HostWording>> = {
  [DEFAULT_HOST]: {
    reconnect: "Run /mcp and Reconnect to load it.",
    reconnectFirst: "Run /mcp and Reconnect",
    scopeOff:
      "This directory is no longer recorded or read. The hooks will produce nothing here and every other tool will refuse until it is turned back on — including in a new session, which is the point.",
    // WHAT TURNING IT BACK ON ACTUALLY DOES, said exactly (#92 review, F1). It
    // is not "the next session": the hooks act at their next boundary in THIS
    // one. What they do not do is reach back — a session that started outside
    // the memory has its first boundary move the read cursor past everything
    // already said, recording none of it, so the stretch that ran while this
    // directory was off or paused stays out of the memory for good.
    scopeOn:
      "Recorded. This takes effect for the tools immediately, and for the hooks at their next boundary in this session. Nothing said before now is recorded — the conversation that happened while this directory was off or paused is passed over, not collected — and remembering starts from here.",
    offRefusal:
      "Counterparts is off for this directory. Nothing is recorded or read here — call `scope` with mode `on`, or run `counterparts scope . --on`.",
    pausedRefusal:
      "Counterparts is paused for this directory. Nothing is recorded or read here until it is resumed — call `scope` with mode `resume`, or run `counterparts scope . --resume`.",
  },
  // Desktop has no `/mcp` and no hooks: the one server every chat talks to is
  // started with the app, so a newer build loads when the app does.
  [DESKTOP_HOST]: {
    reconnect: "Quit and reopen Claude Desktop to load it.",
    reconnectFirst: "Quit and reopen Claude Desktop",
    scopeOff:
      "Claude Desktop's chats are no longer recorded or read. Every other tool will refuse until it is turned back on — including in a new chat, which is the point.",
    scopeOn:
      "Recorded. This takes effect immediately, for every tool in every Claude Desktop chat. Nothing is collected from before now: Desktop chat keeps no transcript here, so only what is written through the tools is remembered.",
    offRefusal:
      "Counterparts is off for Claude Desktop's chats. Nothing is recorded or read here — call `scope` with mode `on`, or run `counterparts scope claude-desktop: --on`.",
    pausedRefusal:
      "Counterparts is paused for Claude Desktop's chats. Nothing is recorded or read here until it is resumed — call `scope` with mode `resume`, or run `counterparts scope claude-desktop: --resume`.",
  },
};

/** The words for `host`, or the default host's when it has none of its own. */
export function wordingFor(host: string = DEFAULT_HOST): HostWording {
  return HOST_WORDING[host] ?? (HOST_WORDING[DEFAULT_HOST] as HostWording);
}

/**
 * WHO UPGRADES A STORE ON AN OLDER SCHEMA, in the words of the hosts that use
 * it (2026-10-01). A read-only door — the console, the dashboard — meets such a
 * store and says the first writer will copy and upgrade it. "The next Claude
 * Code session" is false for a person with only Claude Desktop, where that
 * writer is Desktop's memory server as it starts. `hosts` is the set the
 * store's session registry has seen (`sessions.ts#hostsSeen`); with both, or
 * neither known, the words name both.
 *
 *   - `who` is the subject of "… copies it and upgrades it";
 *   - `open` is what to do for it to happen, lower case, imperative.
 */
export function upgradeWords(hosts: ReadonlySet<string>): { readonly who: string; readonly open: string } {
  const code = hosts.has(DEFAULT_HOST);
  const desk = hosts.has(DESKTOP_HOST);
  if (desk && !code) {
    return { who: "Claude Desktop's memory server", open: "open Claude Desktop (quit and reopen it if it is running)" };
  }
  if (code && !desk) return { who: "the next Claude Code session", open: "start a Claude Code session" };
  return {
    who: "the next session, in Claude Code or Claude Desktop,",
    open: "start a Claude Code session or open Claude Desktop",
  };
}

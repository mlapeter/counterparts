/**
 * OLDER WINDOWS AFTER AN UPGRADE, said once by the first watched wake that
 * finds them (U1a, 2026-10-27).
 *
 * When a newer Counterparts upgrades the memory, every Claude Code window
 * opened before it keeps running the old code — its MCP server (npm and
 * plugin), and its hooks too (plugin) — and from then on refuses or stands
 * down. Each of those says so in its own window (`update-words.ts`), but only
 * when somebody uses it, and a person returning to a window left open
 * overnight meets a refusal with no warning. The window that opened on the
 * new memory is the one place that can see the others: every running server
 * leaves its build in the session registry (`sessions.ts#readServerRecords`),
 * so the believed-live ones (`serverBelieved`) whose schema stamps are older
 * than this code's are the windows to reload.
 *
 * Counted by HOST PROCESS (`hostPid`), not by server: one window can hold
 * more than one record. Claude Desktop's app server (place `claude-desktop:`)
 * is named apart, in its own words. Said once per store version
 * (`STALE_WINDOWS_TOLD_KEY`, claimed with `Store.updateMeta`, so two windows
 * starting together say it once), and only at a start a person is watching —
 * the caller's rule, W1's: not the nightly run, `-p`, a compaction or a
 * resume, which would spend it on nobody. Whoever upgraded the memory (this
 * window, the nightly run, Desktop, the console), the line is the same.
 */
import { CACHE_SCHEMA_VERSION, SCHEMA_VERSION } from "../../core/store/index.js";
import type { Store } from "../../core/store/index.js";
import { DEFAULT_HOST, DESKTOP_HOST, DESKTOP_SCOPE, isPseudoScope, wordingFor } from "../hosts.js";
import type { InstallRoute } from "../plugin.js";
import { pidAlive, readServerRecords, serverBelieved } from "../sessions.js";
import { RELOAD_STEP } from "./doctor-meaning.js";

/** The store version the line was last said for (`<store>.<cache>`). */
export const STALE_WINDOWS_TOLD_KEY = "adapter.update.staleWindows.told";

/** What the line is introduced by, for the model: now, not "when it fits" — the person is about to use those windows. */
export const STALE_WINDOWS_LEAD = "Counterparts — tell your person now:";

export interface StaleWindows {
  /** Distinct host processes running a server older than this code. */
  readonly windows: number;
  /** Claude Desktop's own server is one of them. */
  readonly desktop: boolean;
}

/**
 * The older servers still running against this store, by window. Reads the
 * registry only; never throws (nothing readable is nothing found).
 */
export function staleWindows(input: {
  readonly dataDir: string;
  readonly now: number;
  readonly alive?: (pid: number) => boolean;
  /** A server's own pid, left out (Desktop's wake asks from inside one). */
  readonly selfPid?: number;
}): StaleWindows {
  try {
    const alive = input.alive ?? pidAlive;
    const older = readServerRecords(input.dataDir).filter(
      (r) =>
        r.pid !== input.selfPid &&
        (r.build.storeSchema < SCHEMA_VERSION || r.build.cacheSchema < CACHE_SCHEMA_VERSION) &&
        serverBelieved(r.pid, r.refreshedAt, input.now, alive),
    );
    return {
      windows: new Set(older.filter((r) => !isPseudoScope(r.scope)).map((r) => r.hostPid)).size,
      desktop: older.some((r) => r.scope === DESKTOP_SCOPE),
    };
  } catch {
    return { windows: 0, desktop: false };
  }
}

/** How an older window loads the newer copy, by the route this one came by. */
function windowStep(route: InstallRoute | undefined): string {
  const reconnect = `${wordingFor(DEFAULT_HOST).reconnectFirst.charAt(0).toLowerCase()}${wordingFor(DEFAULT_HOST).reconnectFirst.slice(1)}`;
  if (route === "npm") return reconnect;
  if (route === "plugin") return RELOAD_STEP;
  return `for the plugin, ${RELOAD_STEP}; for an npm install, ${reconnect}`;
}

/** The sentence, from what was found. Pure. */
export function staleWindowsWords(found: StaleWindows, route: InstallRoute | undefined): string | null {
  if (found.windows === 0 && !found.desktop) return null;
  const parts: string[] = [];
  if (found.windows === 1) {
    parts.push(`1 Claude Code window opened before that can't use it until it's reloaded: there, ${windowStep(route)}.`);
  } else if (found.windows > 1) {
    parts.push(`${String(found.windows)} Claude Code windows opened before that can't use it until they're reloaded: in each, ${windowStep(route)}.`);
  }
  if (found.desktop) {
    const quit = wordingFor(DESKTOP_HOST).reconnectFirst;
    parts.push(`Claude Desktop, open since before that, can't use it until you ${quit.charAt(0).toLowerCase()}${quit.slice(1)}.`);
  }
  return `${STALE_WINDOWS_LEAD} "My memory was just upgraded to a newer version. ${parts.join(" ")}"`;
}

/**
 * THE WAKE'S LINE, or null: older servers found, and this store version not
 * told yet — claimed here, so it is said by exactly one wake. The caller
 * decides the start is watched. Never throws: a claim that cannot be written
 * is no line (the next watched wake tries again).
 */
export function staleWindowsLine(input: {
  readonly store: Store;
  readonly route: InstallRoute | undefined;
  readonly now: number;
  readonly alive?: (pid: number) => boolean;
  readonly selfPid?: number;
}): { readonly line: string; readonly found: StaleWindows } | null {
  try {
    const found = staleWindows({
      dataDir: input.store.dir,
      now: input.now,
      ...(input.alive === undefined ? {} : { alive: input.alive }),
      ...(input.selfPid === undefined ? {} : { selfPid: input.selfPid }),
    });
    const line = staleWindowsWords(found, input.route);
    if (line === null) return null;
    const tag = `${String(SCHEMA_VERSION)}.${String(CACHE_SCHEMA_VERSION)}`;
    const claimed = input.store.updateMeta(STALE_WINDOWS_TOLD_KEY, (current) => (current === tag ? undefined : tag));
    return claimed === tag ? { line, found } : null;
  } catch {
    return null;
  }
}

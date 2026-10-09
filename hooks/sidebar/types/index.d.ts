// The sidebar mod's state contract: every value it keeps in `$.state`, under
// the plugin's name. Self-contained (no imports), as a contract must be; the
// hooks module imports these types from here.

export type SidebarMechId =
  | 'salience'
  | 'emotional'
  | 'decay'
  | 'interference'
  | 'retrieval'
  | 'association'
  | 'prospective'
  | 'consolidation'
  | 'dreaming'
  | 'reconsolidation'
  | 'episodic-semantic'
  | 'schema';

/** One row of the ACTIVITY list. */
export type SidebarRow = {
  /** Stable: a dashboard seq, or a live row's own id. */
  id: string;
  mech: SidebarMechId;
  /** The short word on the left (`kept`, `3 recalled`, `dreamed`). */
  word: string;
  /** Milliseconds since the epoch. */
  at: number;
  /** The sentence on the right. */
  text: string;
  /** What opening the row adds. */
  more: string[];
  url: string;
  label: string;
  /** Seen live in this session rather than read from the dashboard. */
  live?: true;
  /** Keys a live row and its later dashboard twin share (`mem:<id>`, `turn:<session>:<n>`). */
  keys?: string[];
};

/** One memory a search found. */
export type SidebarHit = { id: string; title: string; meta: string; excerpt: string };

export type SidebarSearch = {
  query: string;
  status: 'idle' | 'running' | 'done' | 'error';
  /** The answer's first line (`12 match · showing 10 …`). */
  header: string;
  hits: SidebarHit[];
  error: string | null;
};

export type SidebarPulse = { day: number; memories: number; lastSeq: number };

/** What `scope` says this folder is set to, or why it could not be asked. */
export type SidebarScope = {
  /** `on`, `paused`, `off`, `observer`, `unset`; `unknown` before the first read. */
  mode: string;
  error: string | null;
  busy: boolean;
};

export type SidebarMark = { id: string; at: number };

declare module 'claude-code' {
  interface PluginState {
    counterparts: {
      pulse: SidebarPulse | null;
      /** Whether the dashboard answered the last time it was asked. */
      dash: 'unknown' | 'up' | 'down';
      feed: SidebarRow[];
      /** This session's counts for the status line and the rail. */
      counts: { came: number; kept: number };
      /** The mechanism that fired last, and when. */
      firing: SidebarMark | null;
      /** The mechanism the person picked in the legend. */
      sel: SidebarMark | null;
      /** The ACTIVITY row the person opened. */
      openRow: SidebarMark | null;
      search: SidebarSearch;
      scope: SidebarScope;
      /** Claude Code's own memory (MEMORY.md and its prompt section): on unless turned off. */
      claudeMemory: boolean;
      /** Slid to the rail. */
      rail: boolean;
      /** The switch's ends: Powerline half-discs, or half blocks for a font without them. */
      caps: 'round' | 'block';
    };
  }
}

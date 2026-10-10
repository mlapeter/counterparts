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
  /** The row's own mechanism: its word and its colour (a dream's row is Dreaming's). */
  mech: SidebarMechId;
  /**
   * Every mechanism the event proves, `mech` first (a mood-matched recall:
   * Retrieval and Emotion; a dream that merged and wrote a gist: Dreaming,
   * Gist, Interference, Consolidation). Each one pulses and lights.
   */
  mechs: SidebarMechId[];
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
  /**
   * Whose it is: this session's (`here`), the night's or the background's
   * (`night`: dreams, fading, merging), or another session's (`other`, folded
   * into one line, never shown as if it were this one's).
   */
  who: 'here' | 'night' | 'other';
  /** The row in one short line, for the quiet view (`kept · <title>`, `3 came to mind`). */
  line: string;
  /** Keys a live row and its later dashboard twin share (`mem:<id>`, `turn:<session>:<n>`). */
  keys?: string[];
};

/** One memory a search found. */
export type SidebarHit = {
  id: string;
  title: string;
  /** `memory` or `journal`. */
  kind: string;
  /** When it happened, else when it was learned, as `Oct 9`; empty when unknown. */
  date: string;
  /** Who said it, only when that is known (`you said it`, `I said it`, `inferred`). */
  who: string | null;
  /** `memory · Oct 9`, with who said it when known. */
  meta: string;
  excerpt: string;
};

export type SidebarSearch = {
  query: string;
  status: 'idle' | 'running' | 'done' | 'error';
  /** The answer's first line (`12 match · showing 10 …`). */
  header: string;
  /** How many matched in all, from that header; the hits are the page shown. */
  total: number;
  hits: SidebarHit[];
  error: string | null;
};

export type SidebarPulse = { day: number; memories: number; lastSeq: number };

/** What `scope` says this folder is set to, or why it could not be asked. */
export type SidebarScope = {
  /** `on`, `paused`, `off`, `observer`, `unset`; `unknown` before the first read. */
  mode: string;
  /** True when this folder's own entry holds the mode (not an ancestor's, not unset). */
  own: boolean;
  /** The folder whose entry governs here, when one does. */
  setBy: string | null;
  /** This folder, as the server names it. */
  dir: string | null;
  error: string | null;
  busy: boolean;
  /**
   * Why the mode is still `unknown`: `unreadable` (the scope registry file the
   * hooks read could not be found or read: no home folder, a read refused), or
   * null (not tried yet, or read). An unknown mode is never drawn as on.
   */
  unread: 'unreadable' | null;
};

/** A line or two the switch explains itself with, under the switches. */
export type SidebarNote = { text: string; at: number };

export type SidebarMark = { id: string; at: number };

/** The mechanisms that fired last, and when: the newest row's own first, then every other one the same read proved. */
export type SidebarFiring = { ids: SidebarMechId[]; at: number };

declare module 'claude-code' {
  interface PluginState {
    counterparts: {
      pulse: SidebarPulse | null;
      /** Whether the dashboard answered the last time it was asked. */
      dash: 'unknown' | 'up' | 'down';
      feed: SidebarRow[];
      /** This session's counts for the status line and the rail. */
      counts: { came: number; kept: number };
      /** The mechanisms that fired last, and when: the legend lights each. */
      firing: SidebarFiring | null;
      /** The mechanism the person picked in the legend. */
      sel: SidebarMark | null;
      search: SidebarSearch;
      scope: SidebarScope;
      /** Claude Code's own memory (MEMORY.md and its prompt section): on unless turned off. */
      claudeMemory: boolean;
      /**
       * Which of the three the sidebar is in: `full` (the brain, the
       * mechanisms, search, activity), `quiet` (narrow, nothing moving, a
       * compact list) or `hidden` (closed by hand; the status line stays).
       */
      view: 'full' | 'quiet' | 'hidden';
      /** The switch's ends: Powerline half-discs, or half blocks for a font without them. */
      caps: 'round' | 'block';
      /** What the Counterparts switch said about a press it would not act on. */
      switchNote: SidebarNote | null;
      /**
       * The confirm row a press on the Counterparts switch opens before a
       * pause (since 2026-10-09: a press meant for the other switch paused a
       * folder): `dir` is the folder it would pause, `at` when it opened.
       * Only its [Pause] calls the scope tool; [Cancel] or 30 s closes it.
       */
      pauseAsk: { dir: string; at: number } | null;
      /** The quiet view's `◉` lights in this stage colour for a moment after an event. */
      flash: SidebarMark | null;
    };
  }
}

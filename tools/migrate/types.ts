/**
 * `tools/migrate/types.ts` — the v1 shapes as this tool READS them, and the
 * report shapes it emits.
 *
 * These are LEARNED shapes, not imported ones: v1 is a read-only donor
 * (CLAUDE.md), so every structure here was derived from `~/bansai/src/model/`
 * and re-stated. Fields v1 carries that v2 has no home for are still declared —
 * a field that is dropped must be dropped VISIBLY, which means the reader has to
 * see it first.
 */

// ---------------------------------------------------------------------------
// v1 frontmatter dialect
// ---------------------------------------------------------------------------

export type V1Scalar = string | number | boolean;
export type V1Value = V1Scalar | V1Scalar[];
export type V1Frontmatter = Record<string, V1Value>;

// ---------------------------------------------------------------------------
// v1 objects
// ---------------------------------------------------------------------------

/** v1's kind vocabulary. v2's `Kind` uses the same six words — the one place the
 *  two models agree exactly, which is why kind needs no mapping table. */
export const V1_KINDS = ["self", "person", "skill", "fact", "place", "entity"] as const;
export type V1Kind = (typeof V1_KINDS)[number];

export interface V1Emotion {
  subject: string;
  core: string;
  shade: string;
  intensity: number;
}

export interface V1Trace {
  id: string;
  kind: V1Kind;
  scope: string;
  /** `normal` | `sensitive` | `private`. Anything but `normal` must stay withheld. */
  confidentiality: string;
  salience: number;
  gradient: number;
  emotion: V1Emotion | null;
  sessionRef: string;
  createdActiveDay: number;
  body: string;
  title?: string;
  taskState?: boolean;
  aliases?: string[];
  handles?: string[];
  eventDate?: string;
  created?: string;
  occurrences?: number;
  lastReinforcedDay?: string;
  lastDecayedDay?: number;
  archived?: boolean;
  archiveReason?: string;
  mergedInto?: string;
  derivedFrom?: string[];
  /** Unrecognized frontmatter, preserved (v1 §4.2 G6 — the metadata-loss incident). */
  extra: V1Frontmatter;
  /** Path relative to the source dir. Half of this object's import key. */
  relPath: string;
}

export interface V1Episode {
  /** Path relative to the source dir — an episode has no id of its own. */
  relPath: string;
  /** The lived-day stamp in the filename, when it parses as one. */
  date: string | null;
  /** `when:` from the optional frontmatter. */
  when: string | null;
  /** `salience:` from the optional frontmatter, when numeric. */
  salience: number | null;
  body: string;
}

export interface V1CoreItem {
  id: string;
  statement: string;
}
export interface V1CurrentStateItem {
  id: string;
  statement: string;
  timestamp: string;
}
export interface V1RelationshipItem {
  id: string;
  statement: string;
  entity?: string;
}
export interface V1ThreadItem {
  id: string;
  statement: string;
  opened: string;
}
export interface V1BeliefItem {
  id: string;
  statement: string;
  provenance: string[];
  confidence: string;
  /** `active` | `superseded`. A superseded belief arrives archived, never live. */
  status: string;
}
export interface V1SupersededItem {
  old: string;
  replacedBy: string;
  cycleRef: string;
}
export interface V1ArchivedCoreItem {
  elementId: string;
  statement: string;
  reason: string;
  cycleRef: string;
}
export interface V1ProtectedItem {
  id: string;
  statement: string;
  salience: number;
}
export interface V1SelfIndexElement {
  statement: string;
  kind: string;
  warmth: number;
  pointers: string[];
  shelfQuery: string;
  /** The author's permanent-ink flag: "never recompress this". Becomes protected. */
  verbatim?: boolean;
}

export interface V1Schema {
  id: string;
  kind: V1Kind;
  name: string;
  aliases: string[];
  core: V1CoreItem[];
  currentState: V1CurrentStateItem[];
  relationships: V1RelationshipItem[];
  threads: V1ThreadItem[];
  beliefs: V1BeliefItem[];
  superseded: V1SupersededItem[];
  archivedCore: V1ArchivedCoreItem[];
  protected: V1ProtectedItem[];
  selfIndex: V1SelfIndexElement[];
  extra: V1Frontmatter;
  relPath: string;
}

export interface V1Edge {
  src: string;
  dst: string;
  /** semantic | entity | temporal | emotional | thread. No v2 home; counted. */
  type: string;
  weight: number;
  /** Emotional valence, -1..1. No v2 home; counted. */
  valence: number;
  updated: string;
}

export interface V1ProspectiveEntry {
  traceId: string;
  windowKey: string;
  firedDays: string[];
  referenced: boolean;
}

export interface V1LedgerEntry {
  id: string;
  schemaElementRef: string;
  evidenceCount: number;
  cumulativeScore: number;
  status: string;
  closedReason: string | null;
}

export interface V1Meta {
  activeDay: number;
  cycle: number;
  lastSessionDate: string;
}

/** One file the reader could not parse. Reported, never guessed at (§7). */
export interface V1Malformed {
  relPath: string;
  reason: string;
}

export interface V1Store {
  dir: string;
  traces: V1Trace[];
  episodes: V1Episode[];
  schemas: V1Schema[];
  edges: V1Edge[];
  prospective: V1ProspectiveEntry[];
  ledger: V1LedgerEntry[];
  meta: V1Meta;
  /** Present-and-parsed only; nothing from it is applied to v2 (§7). */
  configPresent: boolean;
  malformed: V1Malformed[];
}

// ---------------------------------------------------------------------------
// The report (CONTRACT §5 G10)
// ---------------------------------------------------------------------------

/** Content-by-reference, always: families and counts, never a credential and
 *  never a hash of one (store §16 G9). */
export interface GateSummary {
  bodiesScanned: number;
  /** Bodies the gate changed — a redaction landed. */
  bodiesRedacted: number;
  /** Bodies the battery refused outright; each also appears in `skipped`. */
  bodiesRefused: number;
  /** Fire counts by SECRET FAMILY. The whole telemetry surface of a secret. */
  firesByFamily: Record<string, number>;
  /** Refusal counts by the battery's own reason vocabulary. */
  refusalsByReason: Record<string, number>;
  /** Aliases/handles dropped because they carried a credential shape. */
  namesDropped: number;
}

export interface KindCount {
  read: number;
  imported: number;
  skipped: number;
}

export interface SkipRecord {
  /** Which family of object. */
  what: string;
  /** Source address: `<relPath>#<v1 id>`, or the json key. Never body text. */
  ref: string;
  /** WHY. A skip with an empty reason is a defect, and the suite fails on one. */
  reason: string;
}

export interface ApproximationRecord {
  /** The tunable's name, so the row and the knob share a spelling. */
  name: string;
  applied: number;
  note: string;
}

export interface SourceProof {
  files: number;
  /** Content hashes before the run, keyed by source-relative path. */
  before: Record<string, string>;
  /** After. Equal by guarantee 11. */
  after: Record<string, string>;
  identical: boolean;
  changed: string[];
}

/**
 * What `--apply` actually MOVED, as distinct from what the plan describes.
 * Idempotence is defined on this (§5 G9): a second run's `created` is zero and
 * everything lands in `existing` — "the second run performs no write", which is
 * a checkable fact, unlike byte-equality of a database whose sidecars move on
 * open.
 */
export interface WriteSummary {
  created: number;
  existing: number;
  archived: number;
  entitiesBorn: number;
  elementsAdded: number;
  edges: number;
  prospective: number;
  /** Writes a v2 module refused at apply time; each also appears in `skipped`. */
  refused: number;
}

export interface MigrationReport {
  mode: "dry-run" | "apply";
  source: string;
  target: string;
  /** The v1 clock this store was carried across on. */
  livedDay: number;
  counts: {
    traces: KindCount;
    episodes: KindCount;
    entities: KindCount;
    elements: KindCount;
    /** Element sections that had to land as ordinary memories instead. */
    elementsAsMemories: KindCount;
    edges: KindCount;
    prospective: KindCount;
    ledger: KindCount;
  };
  /** Null on a dry run: nothing was written, and the field says so. */
  writes: WriteSummary | null;
  gate: GateSummary;
  approximations: ApproximationRecord[];
  skipped: SkipRecord[];
  /** Fields that had no v2 home, by name and count. Dropping is loud (§5 G10). */
  dropped: Record<string, number>;
  /** Edge `type` histogram — the typed graph's loss, as a number. */
  edgeTypes: Record<string, number>;
  source_readonly: SourceProof;
  malformed: V1Malformed[];
  /** What the target's cache could not recompute — declared, never assumed. */
  declared: string[];
}

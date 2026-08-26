/**
 * `tools/migrate/read.ts` — the READ-ONLY v1 reader (CONTRACT §5 G11).
 *
 * The source of a migration is the owner's live memory. This module is the only
 * thing in the tool that touches it, and it is read-only three ways, none of them
 * a promise in a comment:
 *
 *   1. It imports exactly three filesystem functions — `readFileSync`,
 *      `readdirSync`, `statSync` — and `test/migrate.test.ts` source-scans this
 *      file and fails the suite on any write API appearing in it.
 *   2. No path under the source directory is ever composed for writing anywhere
 *      in the tool: the planner works in memory and the writer only ever holds
 *      the TARGET's `Store`, whose own `assertSafeDataDir` refuses `~/.bansai`
 *      outright.
 *   3. `manifest()` content-hashes every file, so "the source is byte-identical
 *      after the run" is a checked fact in the report rather than an assurance.
 *
 * The v1 dialects below are LEARNED, not imported (CLAUDE.md: v1 is a read-only
 * donor). Flat-YAML frontmatter — scalars and JSON arrays, no multi-line values —
 * and the `- <visible> <!--{json}-->` item line whose JSON comment is the only
 * authoritative half. A parse this reader cannot make is recorded as malformed
 * and skipped; it is never repaired by guessing (§7).
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join, relative, sep } from "node:path";

import { V1_KINDS } from "./types.js";
import type {
  V1ArchivedCoreItem,
  V1BeliefItem,
  V1CoreItem,
  V1CurrentStateItem,
  V1Edge,
  V1Emotion,
  V1Episode,
  V1Frontmatter,
  V1Kind,
  V1LedgerEntry,
  V1Malformed,
  V1Meta,
  V1ProspectiveEntry,
  V1ProtectedItem,
  V1RelationshipItem,
  V1Schema,
  V1SelfIndexElement,
  V1Store,
  V1SupersededItem,
  V1ThreadItem,
  V1Trace,
  V1Value,
} from "./types.js";

export class MigrateReadError extends Error {
  readonly code: string;
  constructor(code: string, detail: Record<string, unknown> = {}) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "MigrateReadError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// The frontmatter dialect
// ---------------------------------------------------------------------------

const KEY_LINE = /^([A-Za-z0-9_][\w-]*):\s*(.*)$/;
/** Exponent notation included: v1 stringifies values below 1e-6 as "1e-7", and a
 *  reader without the exponent arm silently turns those into strings. */
const NUMBER_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

function parseScalar(raw: string): V1Value {
  const v = raw.trim();
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v;
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1);
  if (v.startsWith("[")) {
    try {
      const arr = JSON.parse(v) as unknown;
      if (Array.isArray(arr)) {
        return arr.filter(
          (x): x is string | number | boolean =>
            typeof x === "string" || typeof x === "number" || typeof x === "boolean",
        );
      }
      return v;
    } catch {
      return v;
    }
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (NUMBER_RE.test(v)) return Number(v);
  return v;
}

/** Split a v1 markdown doc into frontmatter + body. No frontmatter -> `{}`. */
export function parseFrontmatter(md: string): { fm: V1Frontmatter; body: string } {
  const normalized = md.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { fm: {}, body: md };
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return { fm: {}, body: md };
  const header = normalized.slice(4, end);
  const afterClose = normalized.indexOf("\n", end + 1);
  const body = afterClose === -1 ? "" : normalized.slice(afterClose + 1);

  const fm: V1Frontmatter = {};
  for (const line of header.split("\n")) {
    if (line.trim().length === 0) continue;
    const m = KEY_LINE.exec(line);
    if (m === null) continue;
    const key = m[1];
    const raw = m[2];
    if (key === undefined || raw === undefined) continue;
    fm[key] = parseScalar(raw);
  }
  return { fm, body };
}

/** The authoritative half of a section item line, or null. */
export function parseItemLine(line: string): Record<string, unknown> | null {
  const start = line.lastIndexOf("<!--");
  const end = line.lastIndexOf("-->");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(line.slice(start + 4, end).trim()) as unknown;
    return obj !== null && typeof obj === "object" && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Small typed readers
// ---------------------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function kindOf(v: unknown): V1Kind | undefined {
  return typeof v === "string" && (V1_KINDS as readonly string[]).includes(v)
    ? (v as V1Kind)
    : undefined;
}

// ---------------------------------------------------------------------------
// Directory walking — readdir + stat only
// ---------------------------------------------------------------------------

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Recursive list of files under `base`, as source-relative POSIX-ish paths. */
export function listFiles(root: string, sub: string): string[] {
  const base = join(root, sub);
  if (!exists(base)) return [];
  const out: string[] = [];
  const walk = (absDir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue; // v1 skips dotfiles; so do we
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(relative(root, abs).split(sep).join("/"));
    }
  };
  walk(base);
  return out.sort();
}

function readText(root: string, relPath: string): string {
  return readFileSync(join(root, relPath), "utf8");
}

function readJson(root: string, relPath: string, malformed: V1Malformed[]): unknown {
  if (!exists(join(root, relPath))) return undefined;
  try {
    return JSON.parse(readText(root, relPath)) as unknown;
  } catch (err) {
    malformed.push({ relPath, reason: `json-parse: ${(err as Error).message}` });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------

const KNOWN_TRACE_KEYS = new Set([
  "id", "kind", "scope", "confidentiality", "salience", "gradient", "occurrences",
  "last_reinforced", "last_decayed_day", "session_ref", "created_active_day", "created",
  "emotion_subject", "emotion_core", "emotion_shade", "emotion_intensity", "title",
  "task_state", "aliases", "event_date", "handles", "archived", "archive_reason",
  "merged_into", "derived_from",
]);

function emotionFrom(fm: V1Frontmatter): V1Emotion | null {
  const core = str(fm["emotion_core"]);
  if (core === undefined) return null;
  return {
    subject: str(fm["emotion_subject"]) ?? "",
    core,
    shade: str(fm["emotion_shade"]) ?? "",
    intensity: num(fm["emotion_intensity"]) ?? 0,
  };
}

export function readTrace(md: string, relPath: string): V1Trace {
  const { fm, body } = parseFrontmatter(md);
  const id = str(fm["id"]);
  if (id === undefined) throw new MigrateReadError("TRACE_NO_ID", { relPath });
  const kind = kindOf(fm["kind"]);
  if (kind === undefined) throw new MigrateReadError("TRACE_KIND_UNKNOWN", { relPath });

  const extra: V1Frontmatter = {};
  for (const [k, v] of Object.entries(fm)) if (!KNOWN_TRACE_KEYS.has(k)) extra[k] = v;

  const trace: V1Trace = {
    id,
    kind,
    scope: str(fm["scope"]) ?? "global",
    // v1's own parser defaults an absent class to `normal`; so does this one,
    // and every non-normal class survives to v2 (§5 G2).
    confidentiality: str(fm["confidentiality"]) ?? "normal",
    salience: num(fm["salience"]) ?? 0,
    gradient: num(fm["gradient"]) ?? 0,
    emotion: emotionFrom(fm),
    sessionRef: str(fm["session_ref"]) ?? "",
    createdActiveDay: num(fm["created_active_day"]) ?? 0,
    body,
    extra,
    relPath,
  };
  const title = str(fm["title"]);
  if (title !== undefined) trace.title = title;
  if (fm["task_state"] === true) trace.taskState = true;
  const aliases = strArray(fm["aliases"]);
  if (aliases.length > 0) trace.aliases = aliases;
  const handles = strArray(fm["handles"]);
  if (handles.length > 0) trace.handles = handles;
  const eventDate = str(fm["event_date"]);
  if (eventDate !== undefined) trace.eventDate = eventDate;
  const created = str(fm["created"]);
  if (created !== undefined) trace.created = created;
  const occurrences = num(fm["occurrences"]);
  if (occurrences !== undefined) trace.occurrences = occurrences;
  const lastReinforced = str(fm["last_reinforced"]);
  if (lastReinforced !== undefined) trace.lastReinforcedDay = lastReinforced;
  const lastDecayed = num(fm["last_decayed_day"]);
  if (lastDecayed !== undefined) trace.lastDecayedDay = lastDecayed;
  if (fm["archived"] === true) trace.archived = true;
  const archiveReason = str(fm["archive_reason"]);
  if (archiveReason !== undefined) trace.archiveReason = archiveReason;
  const mergedInto = str(fm["merged_into"]);
  if (mergedInto !== undefined) trace.mergedInto = mergedInto;
  const derivedFrom = strArray(fm["derived_from"]);
  if (derivedFrom.length > 0) trace.derivedFrom = derivedFrom;
  return trace;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const KNOWN_SCHEMA_KEYS = new Set([
  "id", "kind", "name", "aliases", "budget_max_elements", "budget_max_bytes",
]);

const HEADINGS: Record<string, keyof V1Schema> = {
  "## Stable core": "core",
  "## Current state": "currentState",
  "## Relationships": "relationships",
  "## Open threads": "threads",
  "## Beliefs": "beliefs",
  "## Superseded": "superseded",
  "## Archived core": "archivedCore",
  "## Protected": "protected",
  "## Self-index": "selfIndex",
};

export function readSchema(md: string, relPath: string): V1Schema {
  const { fm, body } = parseFrontmatter(md);
  const id = str(fm["id"]);
  if (id === undefined) throw new MigrateReadError("SCHEMA_NO_ID", { relPath });
  const kind = kindOf(fm["kind"]);
  if (kind === undefined) throw new MigrateReadError("SCHEMA_KIND_UNKNOWN", { relPath });

  const extra: V1Frontmatter = {};
  for (const [k, v] of Object.entries(fm)) if (!KNOWN_SCHEMA_KEYS.has(k)) extra[k] = v;

  const schema: V1Schema = {
    id,
    kind,
    name: str(fm["name"]) ?? "",
    aliases: strArray(fm["aliases"]),
    core: [],
    currentState: [],
    relationships: [],
    threads: [],
    beliefs: [],
    superseded: [],
    archivedCore: [],
    protected: [],
    selfIndex: [],
    extra,
    relPath,
  };

  let section: keyof V1Schema | null = null;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    const heading = HEADINGS[trimmed];
    if (heading !== undefined) {
      section = heading;
      continue;
    }
    if (section === null || !trimmed.startsWith("- ")) continue;
    const item = parseItemLine(line);
    if (item === null) continue;
    pushSection(schema, section, item);
  }
  return schema;
}

function pushSection(schema: V1Schema, section: keyof V1Schema, item: Record<string, unknown>): void {
  const statement = str(item["statement"]);
  switch (section) {
    case "core": {
      const id = str(item["id"]);
      if (id === undefined || statement === undefined) return;
      schema.core.push({ id, statement } satisfies V1CoreItem);
      return;
    }
    case "currentState": {
      const id = str(item["id"]);
      if (id === undefined || statement === undefined) return;
      schema.currentState.push({
        id,
        statement,
        timestamp: str(item["timestamp"]) ?? "",
      } satisfies V1CurrentStateItem);
      return;
    }
    case "relationships": {
      const id = str(item["id"]);
      if (id === undefined || statement === undefined) return;
      const rel: V1RelationshipItem = { id, statement };
      const entity = str(item["entity"]);
      if (entity !== undefined) rel.entity = entity;
      schema.relationships.push(rel);
      return;
    }
    case "threads": {
      const id = str(item["id"]);
      if (id === undefined || statement === undefined) return;
      schema.threads.push({
        id,
        statement,
        opened: str(item["opened"]) ?? "",
      } satisfies V1ThreadItem);
      return;
    }
    case "beliefs": {
      const id = str(item["id"]);
      if (id === undefined || statement === undefined) return;
      schema.beliefs.push({
        id,
        statement,
        provenance: strArray(item["provenance"]),
        confidence: str(item["confidence"]) ?? "medium",
        status: str(item["status"]) ?? "active",
      } satisfies V1BeliefItem);
      return;
    }
    case "superseded": {
      const old = str(item["old"]);
      if (old === undefined) return;
      schema.superseded.push({
        old,
        replacedBy: str(item["replacedBy"]) ?? "",
        cycleRef: str(item["cycleRef"]) ?? "",
      } satisfies V1SupersededItem);
      return;
    }
    case "archivedCore": {
      if (statement === undefined) return;
      schema.archivedCore.push({
        elementId: str(item["elementId"]) ?? "",
        statement,
        reason: str(item["reason"]) ?? "",
        cycleRef: str(item["cycleRef"]) ?? "",
      } satisfies V1ArchivedCoreItem);
      return;
    }
    case "protected": {
      const id = str(item["id"]);
      if (id === undefined || statement === undefined) return;
      schema.protected.push({
        id,
        statement,
        salience: num(item["salience"]) ?? 0,
      } satisfies V1ProtectedItem);
      return;
    }
    case "selfIndex": {
      if (statement === undefined) return;
      const el: V1SelfIndexElement = {
        statement,
        kind: str(item["kind"]) ?? "",
        warmth: num(item["warmth"]) ?? 0,
        pointers: strArray(item["pointers"]),
        shelfQuery: str(item["shelfQuery"]) ?? "",
      };
      if (item["verbatim"] === true) el.verbatim = true;
      schema.selfIndex.push(el);
      return;
    }
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

const EPISODE_DATE = /^(\d{4}-\d{2}-\d{2})-/;

export function readEpisode(md: string, relPath: string): V1Episode {
  const { fm, body } = parseFrontmatter(md);
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  const m = EPISODE_DATE.exec(name);
  const salience = num(fm["salience"]);
  return {
    relPath,
    date: m?.[1] ?? null,
    when: str(fm["when"]) ?? null,
    salience: salience ?? null,
    body,
  };
}

// ---------------------------------------------------------------------------
// The whole store
// ---------------------------------------------------------------------------

export function readV1(dir: string): V1Store {
  if (!exists(dir)) throw new MigrateReadError("SOURCE_MISSING", { dir });
  const malformed: V1Malformed[] = [];

  const traces: V1Trace[] = [];
  for (const relPath of listFiles(dir, "traces")) {
    if (!relPath.endsWith(".md")) continue;
    try {
      traces.push(readTrace(readText(dir, relPath), relPath));
    } catch (err) {
      malformed.push({ relPath, reason: (err as Error).message });
    }
  }

  const episodes: V1Episode[] = [];
  for (const relPath of listFiles(dir, "episodes")) {
    if (!relPath.endsWith(".md")) continue;
    try {
      episodes.push(readEpisode(readText(dir, relPath), relPath));
    } catch (err) {
      malformed.push({ relPath, reason: (err as Error).message });
    }
  }

  const schemas: V1Schema[] = [];
  for (const relPath of listFiles(dir, "schemas")) {
    if (!relPath.endsWith(".md")) continue;
    try {
      schemas.push(readSchema(readText(dir, relPath), relPath));
    } catch (err) {
      malformed.push({ relPath, reason: (err as Error).message });
    }
  }

  const edges: V1Edge[] = [];
  const rawEdges = readJson(dir, "graph/edges.json", malformed);
  if (Array.isArray(rawEdges)) {
    for (const row of rawEdges) {
      if (row === null || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const src = str(r["src"]);
      const dst = str(r["dst"]);
      if (src === undefined || dst === undefined) continue;
      edges.push({
        src,
        dst,
        type: str(r["type"]) ?? "semantic",
        weight: num(r["weight"]) ?? 0,
        valence: num(r["valence"]) ?? 0,
        updated: str(r["updated"]) ?? "",
      });
    }
  }

  const prospective: V1ProspectiveEntry[] = [];
  const rawProspective = readJson(dir, "prospective.json", malformed);
  if (rawProspective !== null && typeof rawProspective === "object" && !Array.isArray(rawProspective)) {
    for (const [traceId, v] of Object.entries(rawProspective as Record<string, unknown>)) {
      if (v === null || typeof v !== "object") continue;
      const e = v as Record<string, unknown>;
      const windowKey = str(e["windowKey"]);
      if (windowKey === undefined) continue;
      prospective.push({
        traceId,
        windowKey,
        firedDays: strArray(e["firedDays"]),
        referenced: e["referenced"] === true,
      });
    }
  }

  const ledger: V1LedgerEntry[] = [];
  const rawLedger = readJson(dir, "ledger.json", malformed);
  if (rawLedger !== null && typeof rawLedger === "object" && !Array.isArray(rawLedger)) {
    for (const [id, v] of Object.entries(rawLedger as Record<string, unknown>)) {
      if (v === null || typeof v !== "object") continue;
      const e = v as Record<string, unknown>;
      const ref = str(e["schemaElementRef"]);
      if (ref === undefined) continue;
      ledger.push({
        id,
        schemaElementRef: ref,
        evidenceCount: Array.isArray(e["evidence"]) ? e["evidence"].length : 0,
        cumulativeScore: num(e["cumulativeScore"]) ?? 0,
        status: str(e["status"]) ?? "open",
        closedReason: str(e["closedReason"]) ?? null,
      });
    }
  }

  const rawMeta = readJson(dir, "meta.json", malformed);
  const metaObj = (rawMeta !== null && typeof rawMeta === "object" ? rawMeta : {}) as Record<string, unknown>;
  const meta: V1Meta = {
    activeDay: num(metaObj["activeDay"]) ?? 0,
    cycle: num(metaObj["cycle"]) ?? 0,
    lastSessionDate: str(metaObj["lastSessionDate"]) ?? "",
  };

  return {
    dir,
    traces,
    episodes,
    schemas,
    edges,
    prospective,
    ledger,
    meta,
    configPresent: exists(join(dir, "config.json")),
    malformed,
  };
}

// ---------------------------------------------------------------------------
// The read-only proof (§5 G11)
// ---------------------------------------------------------------------------

/** Content hash of every file under `dir`, keyed by source-relative path. */
export function manifest(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (absDir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        const rel = relative(dir, abs).split(sep).join("/");
        try {
          out[rel] = createHash("sha256").update(readFileSync(abs)).digest("hex").slice(0, 16);
        } catch {
          out[rel] = "unreadable";
        }
      }
    }
  };
  if (exists(dir)) walk(dir);
  return out;
}

export function manifestDiff(
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  const changed: string[] = [];
  for (const [path, hash] of Object.entries(before)) {
    if (after[path] !== hash) changed.push(path);
  }
  for (const path of Object.keys(after)) {
    if (before[path] === undefined) changed.push(path);
  }
  return changed.sort();
}

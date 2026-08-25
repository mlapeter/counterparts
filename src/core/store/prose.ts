/**
 * Box 1 — canonical prose. Markdown with YAML frontmatter, editable in any editor.
 *
 * Serialization shape (contract §3, behavioral-spec §4.2 G6–G8):
 *   - human-legible `key: value` frontmatter lines, DERIVED from the payload;
 *   - one authoritative machine payload line (`payload: {...}`) which is the ONLY
 *     thing the parser reads — so a lossy YAML reading can never become the truth;
 *   - the body below the fence, verbatim, and NOT duplicated into the payload:
 *     one source of truth for content, so an owner's body edit is unambiguous.
 *
 * Unrecognized metadata rides in `meta` and survives parse → serialize untouched
 * (G6). A field never used emits no line at all (G8: omitted-when-absent).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { StoreError } from "./errors.js";
import { paths } from "./paths.js";

export type ProseType = "memory" | "episode" | "schema";
export const PROSE_TYPES: readonly ProseType[] = ["memory", "episode", "schema"];

/** Type prefix per family. Ids are immutable, never reused, type-prefixed (G2). */
export const ID_PREFIX: Record<ProseType, string> = {
  memory: "mem",
  episode: "epi",
  schema: "sch",
};

export interface ProseDoc {
  id: string;
  type: ProseType;
  title?: string;
  /** When it happened, at stated precision: `2026`, `2026-08`, or `2026-08-25`. Never rounded. */
  happenedOn?: string;
  /** When it was learned (ISO date). Supersession reasoning needs it. */
  learnedOn: string;
  /** Which lived day it was born on — the decay clock's integer (scar E8). */
  bornDay: number;
  /** Unrecognized / module-specific fields. Survives round-trip untouched (G6). */
  meta: Record<string, unknown>;
  /** The interpretation. This *is* the memory. */
  body: string;
}

/** The one content-address function (contract §3): span, run record, prose all join here. */
export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

const FENCE = "---";
const PAYLOAD_KEY = "payload";

interface Payload {
  id: string;
  type: ProseType;
  title?: string;
  happenedOn?: string;
  learnedOn: string;
  bornDay: number;
  meta: Record<string, unknown>;
}

function toPayload(doc: ProseDoc): Payload {
  const p: Payload = {
    id: doc.id,
    type: doc.type,
    learnedOn: doc.learnedOn,
    bornDay: doc.bornDay,
    meta: doc.meta,
  };
  if (doc.title !== undefined) p.title = doc.title;
  if (doc.happenedOn !== undefined) p.happenedOn = doc.happenedOn;
  return p;
}

/** One human line per present field. Newlines are impossible here: values are scalars. */
function humanLines(p: Payload): string[] {
  const lines = [`id: ${p.id}`, `type: ${p.type}`];
  if (p.title !== undefined) lines.push(`title: ${oneLine(p.title)}`);
  if (p.happenedOn !== undefined) lines.push(`happened: ${p.happenedOn}`);
  lines.push(`learned: ${p.learnedOn}`, `bornDay: ${p.bornDay}`);
  return lines;
}

function oneLine(s: string): string {
  return s.replace(/\r?\n/g, " ");
}

export function serializeProse(doc: ProseDoc): string {
  if (typeof doc.body !== "string") {
    throw new StoreError("PROSE_BODY_INVALID", { id: doc.id, reason: "body-not-string" });
  }
  if (typeof doc.id !== "string" || doc.id.length === 0 || /\s|\//.test(doc.id)) {
    throw new StoreError("ID_MALFORMED", { id: String(doc.id) });
  }
  const payload = toPayload(doc);
  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch (cause) {
    throw new StoreError("PROSE_META_UNSERIALIZABLE", {
      id: doc.id,
      reason: String((cause as Error).message ?? cause),
    });
  }
  if (json === undefined || /[\r\n]/.test(json)) {
    // JSON.stringify escapes newlines; a raw one here would mean the payload could
    // not be read back as a single line. Reject loudly, never truncate (G7).
    throw new StoreError("PROSE_META_UNSERIALIZABLE", { id: doc.id, reason: "payload-not-one-line" });
  }
  // A value JSON silently DROPS (a function, undefined, a symbol) or silently
  // transforms (bigint throws, NaN becomes null) is metadata loss on rewrite —
  // v1's named incident (G6). Refuse it here, before it reaches the disk.
  assertJsonSafe(payload.meta, doc.id, "meta");
  const lines = [...humanLines(payload), `${PAYLOAD_KEY}: ${json}`];
  return `${FENCE}\n${lines.join("\n")}\n${FENCE}\n${doc.body}`;
}

/** Depth-first: every value must survive JSON.stringify → JSON.parse unchanged. */
function assertJsonSafe(value: unknown, id: string, path: string): void {
  const t = typeof value;
  if (value === null || t === "string" || t === "boolean") return;
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new StoreError("PROSE_META_UNSERIALIZABLE", { id, path, reason: "non-finite-number" });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonSafe(v, id, `${path}[${i}]`));
    return;
  }
  if (t === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertJsonSafe(v, id, `${path}.${k}`);
    }
    return;
  }
  throw new StoreError("PROSE_META_UNSERIALIZABLE", { id, path, reason: `type-${t}` });
}

export function parseProse(text: string): ProseDoc {
  if (!text.startsWith(`${FENCE}\n`)) {
    throw new StoreError("PROSE_FRONTMATTER_MISSING", { reason: "no-open-fence" });
  }
  const close = text.indexOf(`\n${FENCE}\n`, FENCE.length);
  if (close === -1) {
    throw new StoreError("PROSE_FRONTMATTER_MISSING", { reason: "no-close-fence" });
  }
  const front = text.slice(FENCE.length + 1, close);
  const body = text.slice(close + FENCE.length + 2);
  const payloadLine = front
    .split("\n")
    .find((l) => l.startsWith(`${PAYLOAD_KEY}: `));
  if (payloadLine === undefined) {
    throw new StoreError("PROSE_PAYLOAD_MISSING", {});
  }
  let payload: Payload;
  try {
    payload = JSON.parse(payloadLine.slice(PAYLOAD_KEY.length + 2)) as Payload;
  } catch (cause) {
    throw new StoreError("PROSE_PAYLOAD_MALFORMED", {
      reason: String((cause as Error).message ?? cause),
    });
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    typeof payload.id !== "string" ||
    payload.id.length === 0 ||
    !PROSE_TYPES.includes(payload.type) ||
    typeof payload.learnedOn !== "string" ||
    typeof payload.bornDay !== "number"
  ) {
    throw new StoreError("PROSE_PAYLOAD_MALFORMED", { reason: "payload-shape" });
  }
  const doc: ProseDoc = {
    id: payload.id,
    type: payload.type,
    learnedOn: payload.learnedOn,
    bornDay: payload.bornDay,
    meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {},
    body,
  };
  if (payload.title !== undefined) doc.title = payload.title;
  if (payload.happenedOn !== undefined) doc.happenedOn = payload.happenedOn;
  return doc;
}

export function readProseFile(path: string, expectId?: string): ProseDoc {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new StoreError("PROSE_FILE_MISSING", { path });
  }
  const doc = parseProse(text);
  if (expectId !== undefined && doc.id !== expectId) {
    // The filename and the payload disagree: an ambiguity, not a repair job.
    throw new StoreError("PROSE_PAYLOAD_MISMATCH", { expected: expectId, found: doc.id });
  }
  return doc;
}

/**
 * Stage a prose file into `tmp/` without publishing it.
 *
 * The temp name carries pid + time + randomness and a `.tmp` suffix, so a
 * crash-leaked stage can never be loaded as a duplicate of the memory it was
 * replacing (§16 G4): the loader only ever reads `*.md` under `prose/`.
 */
export interface Staged {
  readonly tempPath: string;
  readonly finalPath: string;
  readonly text: string;
  readonly hash: string;
}

let stageSeq = 0;

export function stageProse(dir: string, doc: ProseDoc): Staged {
  const text = serializeProse(doc);
  const finalPath = paths.proseFile(dir, doc.type, doc.id);
  const tempPath = `${paths.tmp(dir)}/${doc.id}.${process.pid}.${Date.now()}.${stageSeq++}.${Math.random()
    .toString(36)
    .slice(2, 8)}.tmp`;
  mkdirSync(paths.tmp(dir), { recursive: true });
  writeFileSync(tempPath, text, "utf8");
  return { tempPath, finalPath, text, hash: hashText(text) };
}

/** Publish a staged file. rename(2) is atomic and leaves no residue. */
export function publishStaged(staged: Staged): void {
  mkdirSync(dirname(staged.finalPath), { recursive: true });
  renameSync(staged.tempPath, staged.finalPath);
}

/**
 * Archive-on-overwrite (§16 G4): copy the CURRENT prose to `versions/<id>/` before
 * anything overwrites it, with `wx` so two archivals in the same millisecond cannot
 * silently overwrite each other — v1 found a hard delete inside its own
 * never-destroy mechanism exactly there. Collision bumps the sequence.
 */
export function archivePriorVersion(
  dir: string,
  id: string,
  currentText: string,
  startSeq: number,
): { seq: number; path: string; hash: string } {
  const hash = hashText(currentText);
  mkdirSync(paths.versionsFor(dir, id), { recursive: true });
  for (let seq = startSeq; seq < startSeq + 1000; seq++) {
    const path = paths.versionFile(dir, id, seq, hash);
    try {
      writeFileSync(path, currentText, { encoding: "utf8", flag: "wx" });
      return { seq, path, hash };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new StoreError("ARCHIVE_COLLISION", { id, startSeq });
}

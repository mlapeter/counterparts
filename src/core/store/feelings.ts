/**
 * FEELINGS ON A MEMORY — the `feelings` table's shape and the one check every
 * write of it crosses (schema v7, owner-approved 2026-09-25).
 *
 * One row per feeling. A memory can hold several: mixed feelings are several
 * rows, and the owner's and this self's feelings about the same moment sit side
 * by side, told apart by `whose`. Each names a `core` (one of six) and an
 * `emotion` from the wheel (`core/feelings-wheel.ts`), or `other` with the
 * person's own word kept in `other_word`. `strength` is recorded as felt and
 * never rewritten — softening with time is for a reader to compute. A feeling
 * can sit on top of another on the same memory (`beneath_id`: anger over fear).
 * `carried_by` says briefly what in the moment carried it — the words, what
 * happened — and need not be a statement of feeling.
 *
 * Nothing reads these yet: salience, decay and recall are untouched (the
 * emotion build comes later), and the existing `emotional` dimension and the
 * `meta.feeling` label stay exactly as they were.
 */
import { CORE_EMOTIONS, OTHER_EMOTION, closestKeys, isCoreEmotion, resolveEmotion } from "../feelings-wheel.js";
import type { CoreEmotion } from "../feelings-wheel.js";
import type { Row } from "./db.js";
import { StoreError } from "./errors.js";

/** Whose feeling it is. Two today; the column is TEXT so a person (an entity
 *  id) can join later without a migration. */
export const FEELING_WHOSE = ["owner", "self"] as const;
export type FeelingWhose = (typeof FEELING_WHOSE)[number];

/** `carried_by` is a short pointer at the moment, not a transcript. */
export const CARRIED_BY_MAX_CHARS = 280;
/** The free word kept when the emotion is not on the wheel. */
export const OTHER_WORD_MAX_CHARS = 40;

export interface FeelingInput {
  readonly whose: string;
  readonly core: string;
  /** A wheel key or bare word (`furious`, `fear.inferior`), or `other`. */
  readonly emotion: string;
  /** The person's word, when `emotion` is `other`. */
  readonly otherWord?: string;
  /** 0..1, as recorded. */
  readonly strength: number;
  /** What carried it. May be empty. */
  readonly carriedBy?: string;
  /**
   * The feeling this one sits on top of: an existing feeling's id on the SAME
   * memory, or the index of another input in the same call.
   */
  readonly beneath?: string | number;
}

export interface FeelingRow extends Row {
  id: string;
  memory_id: string;
  whose: string;
  core: string;
  emotion: string;
  other_word: string | null;
  strength: number;
  beneath_id: string | null;
  carried_by: string;
  model: string | null;
  created_at: number;
  updated_at: number;
}

/** A feeling stored as `other`: the word as given, and the wheel keys nearest it. */
export interface FeelingNotice {
  readonly index: number;
  readonly word: string;
  readonly core: CoreEmotion;
  readonly closest: readonly string[];
}

export interface AddFeelingsResult {
  readonly ids: readonly string[];
  readonly notices: readonly FeelingNotice[];
}

/** One input, checked and spelled as it will be stored. `beneath` still unresolved. */
export interface CheckedFeeling {
  readonly whose: FeelingWhose;
  readonly core: CoreEmotion;
  readonly emotion: string;
  readonly otherWord: string | null;
  readonly strength: number;
  readonly carriedBy: string;
  readonly beneath: string | number | null;
}

function invalid(index: number, reason: string, extra: Record<string, string | number> = {}): never {
  throw new StoreError("FEELING_INVALID", { index, reason, ...extra });
}

/**
 * THE CHECK, pure — no store needed, so a door (the MCP tools) can run it
 * BEFORE it mints the memory the feelings belong to, and refuse the whole
 * entry rather than leave a memory whose feelings were dropped. Throws
 * `FEELING_INVALID` naming the input and the reason; returns the checked rows
 * and the `other` notices.
 */
export function checkFeelings(inputs: readonly FeelingInput[]): { rows: CheckedFeeling[]; notices: FeelingNotice[] } {
  const rows: CheckedFeeling[] = [];
  const notices: FeelingNotice[] = [];
  inputs.forEach((f, i) => {
    if (f === null || typeof f !== "object") invalid(i, "not-an-object");
    if (typeof f.whose !== "string" || !(FEELING_WHOSE as readonly string[]).includes(f.whose)) {
      invalid(i, "whose-unknown", { allowed: FEELING_WHOSE.join("|") });
    }
    if (!isCoreEmotion(f.core)) invalid(i, "core-unknown", { allowed: CORE_EMOTIONS.join("|") });
    const core = f.core as CoreEmotion;
    if (typeof f.strength !== "number" || !Number.isFinite(f.strength) || f.strength < 0 || f.strength > 1) {
      invalid(i, "strength-out-of-range");
    }
    const carriedBy = f.carriedBy ?? "";
    if (typeof carriedBy !== "string") invalid(i, "carried-by-not-a-string");
    if (carriedBy.length > CARRIED_BY_MAX_CHARS) invalid(i, "carried-by-too-long", { max: CARRIED_BY_MAX_CHARS });
    if (typeof f.emotion !== "string" || f.emotion.trim().length === 0) invalid(i, "emotion-missing");
    if (f.beneath !== undefined && typeof f.beneath !== "string" && typeof f.beneath !== "number") {
      invalid(i, "beneath-not-an-id-or-index");
    }
    let emotion: string;
    let otherWord: string | null = null;
    if (f.emotion.trim().toLowerCase() === OTHER_EMOTION) {
      const word = (f.otherWord ?? "").trim();
      if (word.length === 0) invalid(i, "other-word-missing");
      emotion = OTHER_EMOTION;
      otherWord = word;
      notices.push({ index: i, word, core, closest: closestKeys(core, word.toLowerCase()) });
    } else {
      const read = resolveEmotion(core, f.emotion);
      if (read.kind === "wrong-core") {
        invalid(i, "emotion-under-another-core", { emotion: read.entry.key, core: read.entry.core });
      }
      if (read.kind === "wheel") {
        emotion = read.entry.key;
      } else {
        // Not on the wheel: kept, as `other`, with the word — and the caller is
        // told the nearest keys so it can rewrite if it meant one of them.
        emotion = OTHER_EMOTION;
        otherWord = read.kind === "other" ? read.word : f.emotion.trim();
        notices.push({ index: i, word: otherWord, core, closest: read.kind === "other" ? read.closest : [] });
      }
    }
    if (otherWord !== null && otherWord.length > OTHER_WORD_MAX_CHARS) {
      invalid(i, "other-word-too-long", { max: OTHER_WORD_MAX_CHARS });
    }
    if (typeof f.beneath === "number") {
      if (!Number.isInteger(f.beneath) || f.beneath < 0 || f.beneath >= inputs.length || f.beneath === i) {
        invalid(i, "beneath-index-out-of-range");
      }
    }
    rows.push({
      whose: f.whose as FeelingWhose,
      core,
      emotion,
      otherWord,
      strength: f.strength,
      carriedBy,
      beneath: f.beneath ?? null,
    });
  });
  // No loop of "this sits on that" inside one call: follow each chain.
  rows.forEach((_, start) => {
    const seen = new Set<number>([start]);
    let at = rows[start]?.beneath;
    while (typeof at === "number") {
      if (seen.has(at)) invalid(start, "beneath-cycle");
      seen.add(at);
      at = rows[at]?.beneath;
    }
  });
  return { rows, notices };
}

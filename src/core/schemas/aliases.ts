/**
 * The alias index — this module's, and the one `recall/` borrows (SEAMS §6).
 *
 * ONE WHOLE-WORD RULE. `occursAsWholeWord` is imported from `encode/words.ts`
 * and there is no second definition here, deliberately and by SEAMS §7 /
 * behavioral-spec §8 G3: birth must test a proposed name by EXACTLY the rule
 * preselection uses, or a name that "was in the span" for one is not for the
 * other. The subtlety that matters is that hyphens and apostrophes are word
 * characters — which is why `self` does not match `self-contained`, v1's
 * measured 21% false-positive rate on the self schema. A copy of that rule here
 * would drift from it in exactly one release.
 *
 * Aliases are first-class and change only through explicit alias operations,
 * never as a side effect of editing prose (§4.2 G4) — which is why this index
 * has `register` / `unregister` and no "sync from body text" path.
 */

import { occursAsWholeWord } from "../encode/words.js";

export interface AliasHit {
  id: string;
  /** The registered term that matched, verbatim as registered. */
  term: string;
  source: "name" | "alias";
}

interface Registered {
  name: string;
  aliases: string[];
}

/**
 * Handles fold to lower case for LOOKUP because the shared whole-word matcher is
 * case-insensitive without an option — an option is how two callers drift apart
 * (words.ts). Keying any other way would make `lookup` and `matchesIn` disagree.
 */
export function handleKey(term: string): string {
  return term.trim().toLowerCase();
}

export class AliasIndex {
  private readonly byKey = new Map<string, Set<string>>();
  private readonly byId = new Map<string, Registered>();

  /** Idempotent: re-registering an id replaces its terms wholesale. */
  register(id: string, name: string, aliases: readonly string[] = []): void {
    this.unregister(id);
    const terms: Registered = { name, aliases: [...aliases] };
    this.byId.set(id, terms);
    for (const term of [name, ...terms.aliases]) {
      const key = handleKey(term);
      if (key.length === 0) continue;
      const set = this.byKey.get(key) ?? new Set<string>();
      set.add(id);
      this.byKey.set(key, set);
    }
  }

  unregister(id: string): void {
    const prior = this.byId.get(id);
    if (prior === undefined) return;
    for (const term of [prior.name, ...prior.aliases]) {
      const key = handleKey(term);
      const set = this.byKey.get(key);
      if (set === undefined) continue;
      set.delete(id);
      if (set.size === 0) this.byKey.delete(key);
    }
    this.byId.delete(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  termsFor(id: string): { name: string; aliases: string[] } | undefined {
    const r = this.byId.get(id);
    return r === undefined ? undefined : { name: r.name, aliases: [...r.aliases] };
  }

  /** Exact handle resolution. Two ids means the handle is ambiguous (§9 G5). */
  lookup(term: string): string[] {
    return [...(this.byKey.get(handleKey(term)) ?? [])].sort();
  }

  /** Handles that resolve to more than one entity — the half recall enforces. */
  ambiguous(): string[] {
    return [...this.byKey.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([key]) => key)
      .sort();
  }

  /**
   * The map `recall/`'s `Turn.aliases` wants, so the caller stops supplying it
   * from thin air (recall/INTERFACE-GAPS §2). Handle -> ids, both halves live.
   */
  map(): ReadonlyMap<string, readonly string[]> {
    const out = new Map<string, readonly string[]>();
    for (const [key, ids] of this.byKey) out.set(key, [...ids].sort());
    return out;
  }

  /**
   * Every registered term occurring in `text` AS A WHOLE WORD, by the one shared
   * definition. This is what birth tests a name with and what preselection's
   * lexical channel tests a slice with — the same function, called twice.
   */
  matchesIn(text: string): AliasHit[] {
    const hits: AliasHit[] = [];
    for (const [id, reg] of this.byId) {
      if (occursAsWholeWord(text, reg.name)) hits.push({ id, term: reg.name, source: "name" });
      for (const alias of reg.aliases) {
        if (occursAsWholeWord(text, alias)) hits.push({ id, term: alias, source: "alias" });
      }
    }
    return hits.sort((a, b) => a.id.localeCompare(b.id) || a.term.localeCompare(b.term));
  }

  size(): number {
    return this.byId.size;
  }
}

// ---------------------------------------------------------------------------
// Collision — exact, and near
// ---------------------------------------------------------------------------

/** Tokens for the near-collision test. Hyphens and apostrophes stay INSIDE a
 *  token, for the same reason they are word characters in words.ts. */
export function nameTokens(name: string): string[] {
  return handleKey(name)
    .replace(/[^\p{L}\p{N}'’-]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export type CollisionKind = "none" | "exact" | "near";

/**
 * "Mike" against "Mike Chen" is a NEAR collision: one name's tokens are wholly
 * contained in the other's. The engine has no evidence that they are the same
 * thing, and silently deciding either way — a second schema, or a wrong merge —
 * is worse than declining and saying so (§14.3). CAL: see tunables.
 */
export function collision(a: string, b: string): CollisionKind {
  const ka = handleKey(a);
  const kb = handleKey(b);
  if (ka.length === 0 || kb.length === 0) return "none";
  if (ka === kb) return "exact";
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return "none";
  const sa = new Set(ta);
  const sb = new Set(tb);
  const aInB = ta.every((t) => sb.has(t));
  const bInA = tb.every((t) => sa.has(t));
  return aInB || bInA ? "near" : "none";
}

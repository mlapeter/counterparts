/**
 * The observer predicate — ONE definition, and it imports nothing.
 *
 * `docs/observer-mode.md` G2: the predicate module imports nothing that can mutate,
 * so a dashboard, a probe, or a replay scorer can report the same truth without
 * acquiring the ability to change anything. G5: fail toward standing down — an
 * unreadable stance resolves to observer, never to "encode anyway".
 *
 * It lives here because the store seam is the only consumer today. When a second
 * core module needs it, MOVE this file to `src/core/observer.ts` — it has no
 * imports, so hoisting is a move, not a rewrite, and the "one definition" property
 * survives it.
 */
export interface Stance {
  /** Absent means "ordinary session". A non-boolean value is unreadable ⇒ observer. */
  observer?: boolean;
}

export function isObserver(stance: unknown): boolean {
  if (stance === null || typeof stance !== "object") return true;
  const value = (stance as { observer?: unknown }).observer;
  if (value === undefined) return false;
  if (typeof value !== "boolean") return true;
  return value;
}

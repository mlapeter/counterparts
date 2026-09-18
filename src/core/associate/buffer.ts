/**
 * The delta buffer — **the declared durability exemption** (§10 G6, contract G11).
 *
 * Per-turn co-activation deltas accumulate in fast mutable state and batch-flush
 * at the boundary. A crash therefore loses at most one session's reinforcement,
 * **never a memory**: everything in here is an increment to learned structure that
 * the next co-activation will re-earn, and nothing in here is the only copy of
 * anything. That is the whole content of the exemption, and this file plus
 * `associate/CONTRACT.md` §5 G11 are the ONLY places it may be declared — a second
 * module that buffers non-reconstructible state fails review.
 *
 * On a host whose credit pass and boundary are different processes the pass
 * drains this buffer to a file instead of publishing from it (`pending.ts`), so
 * what dies with that process is the pass in flight rather than the session's
 * reinforcement. The exemption is unchanged: the file holds the same
 * re-earnable increments, and the buffer is still where they accumulate.
 *
 * The drain is where at-most-once is decided, so it is a method with one job:
 *
 *   **`drain()` SWAPS the map, it does not clear it in place.** The returned batch
 *   is exactly what was read, and a delta that arrives during the flush lands in
 *   the fresh map and survives to the next one (§10 G5 — a concurrent arrival is
 *   never deleted unflushed).
 *
 * The caller's ordering — drain FIRST, publish SECOND, and never restore on a
 * failed publish — is what makes a crash drop one flush's deltas rather than
 * double-apply them. See index.ts.
 */
import { pairKey } from "./edges.js";
import type { PairDelta } from "./edges.js";

export class DeltaBuffer {
  private pairs = new Map<string, PairDelta>();

  /** Accumulate one unordered pair's delta. Ordering of (a, b) never matters. */
  add(a: string, b: string, delta: number): void {
    if (delta <= 0 || a === b) return;
    const key = pairKey(a, b);
    const have = this.pairs.get(key);
    if (have === undefined) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      this.pairs.set(key, { a: lo, b: hi, delta });
      return;
    }
    this.pairs.set(key, { a: have.a, b: have.b, delta: have.delta + delta });
  }

  get size(): number {
    return this.pairs.size;
  }

  /** A read-only look at what is pending. Copies — the caller cannot mutate it. */
  pending(): PairDelta[] {
    return [...this.pairs.values()].map((p) => ({ ...p }));
  }

  /**
   * Take everything buffered, atomically with respect to this process: the map is
   * replaced, so what comes back is closed and what arrives next is separate.
   */
  drain(): PairDelta[] {
    const taken = this.pairs;
    this.pairs = new Map<string, PairDelta>();
    return [...taken.values()];
  }
}

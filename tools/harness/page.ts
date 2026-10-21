/**
 * THE SELF PAGE AT A RUN'S END (2026-10-21, `harness compare`): its version,
 * size and what its claims rest on (lane 2's trace, stored with the text), for
 * the record, read by the run's own build through the public seam. The words
 * go only to a file the caller names (`--page-out`), never into the record:
 * on the owner's snapshot they are his counterpart's page.
 */
import { writeFileSync } from "node:fs";

import { Counterpart } from "../../src/core/counterpart.js";

export interface PageReading {
  readonly version: number;
  readonly bytes: number;
  readonly lines: number;
  readonly by: string | null;
  /** The distinct memories the page rests on; null when no trace was written with this text. */
  readonly cites: number | null;
  /** Claims the writer sent cites for; null when it sent cites for the whole page only, or none. */
  readonly claims: number | null;
  /** Of those, the claims with nothing behind them. */
  readonly uncited: number | null;
}

/** Read the page, or say why it couldn't be: a failed reading never costs the run its record. */
export function pageReading(dir: string, pageOut?: string): PageReading | { readonly error: string } | null {
  try {
    return readPage(dir, pageOut);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Read the page of the store in `dir`; null when it has none. Writes its words to `pageOut` when named. */
function readPage(dir: string, pageOut?: string): PageReading | null {
  const counterpart = Counterpart.open({ dir });
  try {
    const page = counterpart.selfPage();
    if (pageOut !== undefined) writeFileSync(pageOut, page?.body ?? "");
    if (page === null) return null;
    const claims = page.trace?.claims ?? null;
    return {
      version: page.version,
      bytes: page.bytes,
      lines: page.body.split("\n").length,
      by: page.by ?? null,
      cites: page.trace === null ? null : new Set(page.trace.cites).size,
      claims: claims === null ? null : claims.length,
      uncited: claims === null ? null : claims.filter((c) => c.cites.length === 0).length,
    };
  } finally {
    counterpart.close();
  }
}

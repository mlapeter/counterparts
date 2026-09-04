/**
 * `tools/parallel/assignment.ts` — the primacy assignment file, read ONCE.
 *
 * CONTRACT §5 G3 stands on there being ONE resolver: v1's `src/ab.ts` and v2's
 * `primacy.ts` both read the same field of the same file at every hook, and the
 * instrument must not become a third opinion about what that field means. So
 * this asks `primacy.ts` — through `readAssignmentAs`, which sets the directory
 * variable around the call and restores it — and returns the raw `override`
 * string for `record.ts` to cross-check the operator's `--primacy` against.
 *
 * It returns the OVERRIDE, not a verdict. Turning `"bansai"` into `v1` is
 * `record.ts`'s job, in the one place that also knows what the operator
 * claimed; a second copy of that mapping here is exactly the drift §5 G3 names.
 *
 * Nothing here writes, and nothing here resolves a home directory.
 */
import { dirname } from "node:path";

import { readAssignmentAs } from "./readers.js";

/**
 * The assignment file's `override`, as the hooks would read it — or null when
 * the file is missing, unparsable, or carries no override at all.
 *
 * `assignmentFile` is the PATH TO THE FILE, because that is what an operator
 * types at `--assignment`; `primacy.ts` resolves its own filename inside the
 * directory, so the directory is what it is handed.
 */
export function primacyFromAssignment(assignmentFile: string): string | null {
  return primacyReading(dirname(assignmentFile)).override;
}

/** What the assignment DIRECTORY says, with the reason when it says nothing. */
export interface PrimacyReading {
  /** The raw `override`, or null when there is none to read. */
  readonly override: string | null;
  /** The file `primacy.ts` resolved — the one both hooks read. */
  readonly path: string;
  readonly healthy: boolean;
  /** `assignmentHealth`'s own word for why, when it is not healthy. */
  readonly reason: string | null;
}

/**
 * The assignment reading, taken from the DIRECTORY the hooks resolve.
 *
 * The daily used to take this only when the operator passed `--assignment`, so
 * the routine command line — the one in PARALLEL-RUN-STATUS — never took it at
 * all, and the cross-check that exists to catch a stale `run.json.primacy`
 * was opt-in on the one path that never opted in. The bin now reads the
 * directory it already knows (`--ab-dir`, defaulted like every other live
 * path), and an UNREAD assignment is reported rather than passed over: a guard
 * that quietly does not run is worse than no guard (§5 G3, G13).
 */
export function primacyReading(abDir: string): PrimacyReading {
  const reading = readAssignmentAs({ name: "instrument", abDir });
  return {
    override: reading.health.override ?? null,
    path: reading.path,
    healthy: reading.health.healthy,
    reason: reading.health.reason ?? null,
  };
}

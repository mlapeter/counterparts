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
  const reading = readAssignmentAs({
    name: "instrument",
    abDir: dirname(assignmentFile),
  });
  return reading.health.override ?? null;
}

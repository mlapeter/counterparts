/**
 * THE ONE LIVE PATH THAT MUST BE SAID OUT LOUD.
 *
 * THE FINDING (the #80 reviewer, carried as LAUNCH-STATUS G39): the three bins
 * of this instrument default `--v2-data-dir` to `~/.counterparts`, so a command
 * line that names nothing still names the owner's live memory — "writes a live
 * path by naming nothing". The tool writes only its run directory, and that is
 * true and beside the point: the path is a GUARD INPUT, checked for overlap
 * against the run dir (`writer.ts#RunDir.open`) and, in the daily and the
 * preflight, READ. A guard whose subject was chosen by a default is a guard
 * nobody agreed to.
 *
 * WHY THE DEFAULT STAYS. The alternative was to make the flag REQUIRED, and
 * this tool's own test says why not: *"the bins carry the real defaults on
 * purpose … the run directory's overlap guard needs the live stores NAMED to
 * refuse a run dir inside one, and a default that has to be typed is a guard
 * that is sometimes skipped"* (`test/parallel.test.ts`, and the same sentence
 * in `test/store.test.ts`'s allow-list). A required flag makes the overlap
 * check optional in practice — the operator who omits it gets a usage error and
 * the operator who is in a hurry gets a habit of passing a path that silences
 * it. Requiring it would also break the restart line documented in
 * `tools/parallel/README.md` and `docs/HANDOFF.md`, which passes no
 * `--v2-data-dir` at all.
 *
 * WHAT REPLACES THE SILENCE — the guard's own doctrine, at a third door.
 * `store/paths.ts` states it: the explicit-dir guard is OFF by default so an
 * installed host behaves exactly as before, and ON wherever this repo's tooling
 * and its agent shells run, where it turns "the path nobody named" into a
 * refusal by name. `config-path.ts#implicitConfigRefusal` is already the same
 * variable at a second door. This is the third:
 *
 *   - ALWAYS, when the flag was not typed: one stderr line naming the resolved
 *     live path the run is being guarded against. Silence was the actual defect
 *     — a default is only dangerous when nobody can see it in the transcript.
 *   - ARMED (`COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1|true|on`): REFUSED, exit 2,
 *     naming the flag. This is every agent shell in this repo and the loop, so
 *     the class of process that must never point at `~/.counterparts` by
 *     accident is exactly the class that cannot.
 *   - MALFORMED: refused too, with the guard's own sentence
 *     (`explicitDirMalformedRefusal`) — junk is a question this will not answer,
 *     and it is answered identically here and in the store so the two doors do
 *     not teach different lessons.
 *
 * WHY ONLY `--v2-data-dir`. `--v1-dir` and `--engram-dir` default to `~/.bansai`
 * and `~/.claude-engram`, which are on `store/paths.ts#FORBIDDEN_ROOT_NAMES`:
 * every store-open path in the product refuses them by realpath, independently
 * of any variable, so a silent default there cannot become an opened store.
 * `~/.counterparts` is deliberately NOT on that list — the store has to be able
 * to open its own default — which is the whole reason the explicit-dir guard
 * exists, and the reason v2's is the one path here that a default leaves
 * uncovered. `--ab-dir` is the assignment file both hooks read, not a store, and
 * it already answers to `MEMORY_AB_DIR`. They keep their defaults, unchanged.
 *
 * This module resolves no paths and reads no home (`test/parallel.test.ts`:
 * only `bin/` may import `node:os`) — it is handed the string the bin already
 * built, and returns sentences.
 */
import {
  REQUIRE_EXPLICIT_DIR_ENV,
  explicitDirMalformedRefusal,
  explicitDirSetting,
} from "../../src/core/store/paths.js";

export const V2_DATA_DIR_FLAG = "--v2-data-dir";

/** The v2 path this invocation will use, and whether a human typed it. */
export interface V2DataDirChoice {
  readonly dir: string;
  /** True when `--v2-data-dir` appeared on the command line. */
  readonly named: boolean;
}

/**
 * The refusal, or null when the default may stand. Pure: no filesystem, no
 * home, no exit — the bin owns the exit code, this owns the sentence.
 */
export function v2DataDirRefusal(
  choice: V2DataDirChoice,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (choice.named) return null;
  const setting = explicitDirSetting(env);
  if (!setting.armed) {
    // Junk gets the GUARD'S OWN sentence, verbatim, so the store door and this
    // one do not teach two different lessons about the same variable. `off`
    // means off here as it does there: a guard whose `=0` refused would trip
    // the shell of the person it protects (the #80 review's owner ruling).
    return setting.malformed === null ? null : explicitDirMalformedRefusal(setting.malformed);
  }
  return (
    `REFUSED — ${REQUIRE_EXPLICIT_DIR_ENV}=${setting.value} and no ${V2_DATA_DIR_FLAG} was given, so this ` +
    `run would have been guarded against the built-in default, ${choice.dir} — on a machine with an ` +
    `install, somebody's live memory. Name it: ${V2_DATA_DIR_FLAG} <dir>.`
  );
}

/**
 * The line an UNNAMED default always earns, whether or not the guard is armed.
 * Null once the flag was typed: a path the operator wrote needs no announcing.
 */
export function v2DataDirNotice(choice: V2DataDirChoice): string | null {
  if (choice.named) return null;
  return (
    `NOTE — no ${V2_DATA_DIR_FLAG}: guarding this run against the built-in default, ${choice.dir}. ` +
    `Pass ${V2_DATA_DIR_FLAG} <dir> to say which store you mean (${REQUIRE_EXPLICIT_DIR_ENV}=1 refuses this default outright).`
  );
}

/**
 * The whole of it, for a bin: what to say on stderr, and whether to stop. Three
 * bins share this rather than three copies of the same four lines, because
 * three copies of a guard is how two of them end up saying different things.
 * The bin owns the exit code (2, as every other named refusal in this tool) and
 * calls this BEFORE `RunDir.open` — a refusal must cost nothing, resolve
 * nothing and create nothing.
 */
export function v2DataDirGate(
  choice: V2DataDirChoice,
  env: Record<string, string | undefined> = process.env,
): { readonly lines: readonly string[]; readonly refused: boolean } {
  const refusal = v2DataDirRefusal(choice, env);
  if (refusal !== null) return { lines: [refusal], refused: true };
  const notice = v2DataDirNotice(choice);
  return { lines: notice === null ? [] : [notice], refused: false };
}

/**
 * The slot detector's provisional cut, set for a test's scope (2026-10-19).
 *
 * Since 2026-10-19 a slot proposal makes no cut (`SLOT_FADE` 1, flag only: an
 * experiment, check ~10-22). The live store still holds proposals made with a
 * cut on their trail, and a revert puts the cut back, so the cut's
 * arithmetic (lifted by a confirmation, put back by a withdrawal or an undo)
 * stays proven: tests of it run under `useSlotFade(LEGACY_SLOT_FADE)`.
 * `CONTRADICTION_TUNABLES` is readonly by type only; this is the one place a
 * test writes to it, and every write is put back after the test.
 */
import { afterEach, beforeEach } from "bun:test";

import { CONTRADICTION_TUNABLES } from "../src/core/reconsolidation.js";

/** `SLOT_FADE` before the 2026-10-19 experiment: the cut a revert restores. */
export const LEGACY_SLOT_FADE = 0.8;

const tunables = CONTRADICTION_TUNABLES as unknown as { SLOT_FADE: number };

/** Set `SLOT_FADE`, returning what it was. */
export function setSlotFade(factor: number): number {
  const prior = tunables.SLOT_FADE;
  tunables.SLOT_FADE = factor;
  return prior;
}

/** Every test in the calling scope runs at `factor`, put back after each. */
export function useSlotFade(factor: number): void {
  let prior: number | undefined;
  beforeEach(() => {
    prior = setSlotFade(factor);
  });
  afterEach(() => {
    if (prior !== undefined) setSlotFade(prior);
  });
}

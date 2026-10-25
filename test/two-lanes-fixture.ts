/**
 * THE TWO LANES, PINNED (2026-10-24, E2). Since `physics.CORE_DOOR_SUPPORT`
 * the core's door is one support arc (physics §5.3); the describes that
 * document the fast and slow lanes it replaced — kept as lineage, and as the
 * proof that the switch off is still them — call this to run with the door
 * off. The door itself is `test/core-door-support.test.ts`'s. (Since the
 * shadow became the default the lanes decide unpinned too; pinned "off",
 * these run with no shadow beside them.)
 */
import { afterAll, beforeAll } from "bun:test";

import { TUNABLES as PHYSICS } from "../src/core/physics/index.js";
import type { CoreDoorMode } from "../src/core/physics/index.js";

export function withTwoLanes(): void {
  withCoreDoor("off");
}

/** Run a describe with the core door at `mode` (E2: "on" for the describes about the support door deciding). */
export function withCoreDoor(mode: CoreDoorMode): void {
  let was = PHYSICS.CORE_DOOR_SUPPORT;
  beforeAll(() => {
    was = PHYSICS.CORE_DOOR_SUPPORT;
    (PHYSICS as { CORE_DOOR_SUPPORT: CoreDoorMode | boolean }).CORE_DOOR_SUPPORT = mode;
  });
  afterAll(() => {
    (PHYSICS as { CORE_DOOR_SUPPORT: CoreDoorMode | boolean }).CORE_DOOR_SUPPORT = was;
  });
}

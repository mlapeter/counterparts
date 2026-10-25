/**
 * THE TWO LANES, PINNED (2026-10-24, E2). Since `physics.CORE_DOOR_SUPPORT`
 * the core's door is one support arc (physics §5.3); the describes that
 * document the fast and slow lanes it replaced — kept as lineage, and as the
 * proof that the switch off is still them — call this to run with the door
 * off. The door itself is `test/core-door-support.test.ts`'s.
 */
import { afterAll, beforeAll } from "bun:test";

import { TUNABLES as PHYSICS } from "../src/core/physics/index.js";

export function withTwoLanes(): void {
  let was = PHYSICS.CORE_DOOR_SUPPORT;
  beforeAll(() => {
    was = PHYSICS.CORE_DOOR_SUPPORT;
    (PHYSICS as { CORE_DOOR_SUPPORT: boolean }).CORE_DOOR_SUPPORT = false;
  });
  afterAll(() => {
    (PHYSICS as { CORE_DOOR_SUPPORT: boolean }).CORE_DOOR_SUPPORT = was;
  });
}

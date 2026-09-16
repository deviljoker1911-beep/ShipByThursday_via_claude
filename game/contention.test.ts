import { test } from "node:test";
import assert from "node:assert/strict";

import { commandGather, createWorld, resourceTilesNear, spawn, tick } from "./world.ts";
import type { World } from "./types.ts";

const DT = 1 / 30;
const run = (w: World, s: number) => {
  for (let i = 0; i < Math.round(s / DT); i++) tick(w, DT);
};

test("a crowd of villagers on one small patch keeps working", () => {
  // Regression from play: villagers competing for the one free spot beside a
  // bush would give up and stand idle, carrying a single berry, while the
  // patch still had plenty left.
  for (const seed of [43, 7, 19, 88]) {
    const w = createWorld(seed);
    const tc = [...w.entities.values()].find((e) => e.owner === 0 && e.kind === "towncenter")!;
    const patch = resourceTilesNear(w.map, "food", tc.x, tc.y, 1, 14)[0];
    assert.ok(patch, `seed ${seed}: no food near the start`);

    const crowd = [...w.entities.values()].filter((e) => e.owner === 0 && e.kind === "villager");
    for (let i = 0; i < 4; i++) crowd.push(spawn(w, "villager", 0, tc.x + 2, tc.y + 2 + i * 0.3));
    // Everyone told to work the very same tile.
    for (const v of crowd) commandGather(w, v, patch.x, patch.y);

    run(w, 60);
    const idle = crowd.filter((v) => v.state?.name === "idle");
    assert.equal(
      idle.length,
      0,
      `seed ${seed}: ${idle.length} of ${crowd.length} villagers gave up on a patch with food left`,
    );
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { createWorld, spawn, tick, commandMove, commandGather, commandAttack,
         enqueueTraining, nearestResourceTile, canPlaceBuilding, commandBuild } from "./world.ts";
import { resetAi, tickAi } from "./ai.ts";
import { findPath } from "./pathfind.ts";
import { generateMap, passable, terrainAt } from "./map.ts";
import { screenToTile, tileToScreen } from "./iso.ts";
import { TERRAIN_IDS, type Entity, type World } from "./types.ts";
import { UNITS } from "./config.ts";

const DT = 1 / 30;

/** Run the simulation for `seconds` of game time, AI optional. */
function run(world: World, seconds: number, withAi = false) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    tick(world, DT);
    if (withAi) tickAi(world, DT);
  }
}

function playerUnits(world: World, kind?: string): Entity[] {
  return [...world.entities.values()].filter(
    (e) => e.owner === 0 && (!kind || e.kind === kind),
  );
}

test("isometric projection round-trips exactly", () => {
  const cam = { ox: 137, oy: -42, zoom: 1.35 };
  for (const [x, y] of [[0, 0], [12, 7], [55, 3], [23.4, 41.8]]) {
    const { sx, sy } = tileToScreen(x, y, cam);
    const back = screenToTile(sx, sy, cam);
    assert.ok(Math.abs(back.x - x) < 1e-9, `x ${back.x} != ${x}`);
    assert.ok(Math.abs(back.y - y) < 1e-9, `y ${back.y} != ${y}`);
  }
});

test("every start has open ground and reachable wood and gold", () => {
  // Generation is random; a start that can't gather is unplayable, so this
  // needs to hold across many seeds, not just a lucky one.
  for (let seed = 0; seed < 40; seed++) {
    const { map, starts } = generateMap(56, seed);
    for (const s of starts) {
      assert.ok(passable(map, s.x, s.y), `seed ${seed}: start not passable`);
      const wood = nearestResourceTile(map, "wood", s.x, s.y, 14);
      const gold = nearestResourceTile(map, "gold", s.x, s.y, 16);
      assert.ok(wood, `seed ${seed}: no wood near start`);
      assert.ok(gold, `seed ${seed}: no gold near start`);
    }
  }
});

test("pathfinding reaches an open goal and never routes through water", () => {
  const { map } = generateMap(56, 7);
  // Find two open tiles far apart.
  let a = null, b = null;
  for (let y = 2; y < 54 && !a; y++) for (let x = 2; x < 54 && !a; x++) if (passable(map, x, y)) a = { x, y };
  for (let y = 53; y > 2 && !b; y--) for (let x = 53; x > 2 && !b; x--) if (passable(map, x, y)) b = { x, y };
  assert.ok(a && b);

  const path = findPath(map, a!.x, a!.y, b!.x, b!.y);
  assert.ok(path.length > 0, "no path produced");
  for (const step of path) {
    assert.notEqual(terrainAt(map, step.x, step.y), TERRAIN_IDS.water, "path crosses water");
    assert.ok(passable(map, step.x, step.y), "path crosses impassable tile");
  }
  // Steps must be adjacent — a path that teleports is worse than no path.
  let prev = a!;
  for (const step of path) {
    assert.ok(
      Math.abs(step.x - prev.x) <= 1 && Math.abs(step.y - prev.y) <= 1,
      "path has a gap",
    );
    prev = step;
  }
});

test("an unreachable goal still returns a path toward it", () => {
  // Walking at a tree should approach the tree, not leave the unit frozen.
  const { map, starts } = generateMap(56, 3);
  const s = starts[0];
  const tree = nearestResourceTile(map, "wood", s.x, s.y, 14)!;
  const path = findPath(map, s.x, s.y, tree.x, tree.y);
  assert.ok(path.length > 0, "gave up instead of approaching");
  const end = path[path.length - 1];
  const before = Math.hypot(s.x - tree.x, s.y - tree.y);
  const after = Math.hypot(end.x - tree.x, end.y - tree.y);
  assert.ok(after < before, "path did not get closer to the target");
});

test("a villager gathers wood and banks it at the town centre", () => {
  const world = createWorld(11);
  const villager = playerUnits(world, "villager")[0];
  const tile = nearestResourceTile(world.map, "wood", villager.x, villager.y)!;
  const startWood = world.players[0].wood;

  commandGather(world, villager, tile.x, tile.y);
  run(world, 60);

  assert.ok(
    world.players[0].wood > startWood,
    `wood did not increase (${startWood} -> ${world.players[0].wood})`,
  );
});

test("units move to where they were sent", () => {
  const world = createWorld(5);
  const v = playerUnits(world, "villager")[0];
  // Pick an open tile a few steps away.
  let goal = null;
  for (let r = 4; r < 10 && !goal; r++) {
    for (let d = -r; d <= r && !goal; d++) {
      const x = Math.round(v.x) + d;
      const y = Math.round(v.y) + r;
      if (passable(world.map, x, y)) goal = { x, y };
    }
  }
  assert.ok(goal, "no open tile found to walk to");

  commandMove(world, v, goal!.x, goal!.y);
  run(world, 20);
  const dist = Math.hypot(v.x - goal!.x, v.y - goal!.y);
  assert.ok(dist < 1.5, `unit stopped ${dist.toFixed(2)} tiles short`);
});

test("training costs resources, respects the population cap, and produces a unit", () => {
  const world = createWorld(21);
  const tc = [...world.entities.values()].find((e) => e.owner === 0 && e.kind === "towncenter")!;
  const foodBefore = world.players[0].food;

  assert.equal(enqueueTraining(world, tc, "villager"), null, "queueing was refused");
  assert.equal(world.players[0].food, foodBefore - UNITS.villager.cost.food!, "food not deducted");

  const before = playerUnits(world, "villager").length;
  run(world, UNITS.villager.trainTime + 2);
  assert.equal(playerUnits(world, "villager").length, before + 1, "no villager appeared");

  // Population cap starts at 8 with one town centre; fill it and expect refusal.
  for (let i = 0; i < 20; i++) enqueueTraining(world, tc, "villager");
  run(world, 90);
  const p = world.players[0];
  assert.ok(p.pop <= p.popCap, `pop ${p.pop} exceeded cap ${p.popCap}`);
});

test("combat kills, and the loser is removed from the world", () => {
  const world = createWorld(31);
  const attacker = spawn(world, "spearman", 0, 20, 20);
  const victim = spawn(world, "villager", 1, 20.5, 20);
  const id = victim.id;

  commandAttack(world, attacker, id);
  run(world, 30);

  assert.equal(world.entities.has(id), false, "victim survived a 30s beating");
});

test("destroying the last town centre ends the match", () => {
  const world = createWorld(41);
  const enemyTc = [...world.entities.values()].find(
    (e) => e.owner === 1 && e.kind === "towncenter",
  )!;
  assert.equal(world.outcome, "playing");

  // Stand a squad next to it rather than walking them across the map.
  for (let i = 0; i < 8; i++) {
    const s = spawn(world, "spearman", 0, enemyTc.x + 2 + i * 0.1, enemyTc.y + 2);
    commandAttack(world, s, enemyTc.id);
  }
  run(world, 120);

  assert.equal(world.outcome, "won", "match did not resolve");
});

test("the AI actually develops: it gathers, builds and trains", () => {
  const world = createWorld(51);
  resetAi();
  const before = {
    units: [...world.entities.values()].filter((e) => e.owner === 1).length,
    wood: world.players[1].wood,
  };

  run(world, 180, true);

  const after = [...world.entities.values()].filter((e) => e.owner === 1);
  const buildings = after.filter((e) => e.kind !== "villager" && e.kind !== "spearman" && e.kind !== "archer");

  assert.ok(after.length > before.units, `AI did not grow (${before.units} -> ${after.length})`);
  assert.ok(buildings.length > 1, "AI never constructed anything beyond its town centre");
});

test("buildings cannot be placed on water, trees, or on top of each other", () => {
  const world = createWorld(61);
  const tc = [...world.entities.values()].find((e) => e.owner === 0 && e.kind === "towncenter")!;

  assert.equal(
    canPlaceBuilding(world, "house", Math.round(tc.x), Math.round(tc.y)),
    false,
    "allowed a house on top of the town centre",
  );

  // Find water and a tree and confirm both are refused.
  let water = null, tree = null;
  for (let y = 0; y < world.map.height && (!water || !tree); y++) {
    for (let x = 0; x < world.map.width && (!water || !tree); x++) {
      const t = terrainAt(world.map, x, y);
      if (!water && t === TERRAIN_IDS.water) water = { x, y };
      if (!tree && t === TERRAIN_IDS.forest) tree = { x, y };
    }
  }
  assert.equal(canPlaceBuilding(world, "house", water!.x, water!.y), false, "allowed building on water");
  assert.equal(canPlaceBuilding(world, "house", tree!.x, tree!.y), false, "allowed building on a tree");
});

test("a construction site finishes when a villager works it", () => {
  const world = createWorld(71);
  const v = playerUnits(world, "villager")[0];
  // Find a legal spot near the villager.
  let spot = null;
  for (let r = 3; r < 9 && !spot; r++) {
    for (let d = -r; d <= r && !spot; d++) {
      const x = Math.round(v.x) + d;
      const y = Math.round(v.y) + r;
      if (canPlaceBuilding(world, "house", x, y)) spot = { x, y };
    }
  }
  assert.ok(spot, "nowhere to build near the start");

  const site = spawn(world, "house", 0, spot!.x, spot!.y, 0.01);
  commandBuild(world, v, site.id);
  run(world, 60);

  assert.equal(site.progress, 1, `house stuck at ${((site.progress ?? 0) * 100).toFixed(0)}%`);
  assert.ok(world.players[0].popCap > 8, "finished house did not raise the population cap");
});

test("the gather loop sustains across many round trips", () => {
  // The single-delivery test above passes even when a villager banks once and
  // then wedges. Both freeze bugs found during the build looked exactly like
  // that, so this asserts the loop keeps running, and keeps running at a
  // sensible rate.
  const world = createWorld(11);
  const v = playerUnits(world, "villager")[0];
  const tile = nearestResourceTile(world.map, "wood", v.x, v.y)!;
  commandGather(world, v, tile.x, tile.y);

  run(world, 20);
  const early = world.players[0].wood;
  run(world, 60);
  const late = world.players[0].wood;

  assert.ok(early > 300, `no wood banked in the first 20s (${early})`);
  assert.ok(
    late > early + 20,
    `gathering stalled after the first trips (${early} -> ${late})`,
  );
  assert.notEqual(v.state?.name, "idle", "villager gave up while wood remained");
});

test("villagers keep working across seeds, not just a lucky layout", () => {
  // Terrain is random, and both freezes only appeared on particular geometry.
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
    const world = createWorld(seed);
    for (const v of playerUnits(world, "villager")) {
      const tile = nearestResourceTile(world.map, "wood", v.x, v.y);
      if (tile) commandGather(world, v, tile.x, tile.y);
    }
    run(world, 45);
    assert.ok(
      world.players[0].wood > 300,
      `seed ${seed}: four villagers banked nothing in 45s`,
    );
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { createWorld, spawn, tick, commandAttack, commandAttackMove, commandGather,
         commandMove, commandRepair, commandStop, queueOrder, nearestResourceTile,
         distanceTo } from "./world.ts";
import { generateMap, isConnected, passable } from "./map.ts";
import { damageFrom, maxHp, UNITS } from "./config.ts";
import { TERRAIN_IDS, type Entity, type World } from "./types.ts";

const DT = 1 / 30;
const run = (w: World, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) tick(w, DT);
};

test("both starts are always connected by land", () => {
  // This is the check that matters most in the whole suite. Forests are
  // impassable and dense enough to partition the map, and when they do, no
  // army can ever reach the enemy — every match runs forever with the town
  // centres untouched. It is completely invisible from a screenshot.
  for (let seed = 0; seed < 60; seed++) {
    const { map, starts } = generateMap(56, seed);
    assert.ok(
      isConnected(map, starts[0], starts[1]),
      `seed ${seed}: the two bases cannot reach each other`,
    );
  }
});

test("the counter triangle actually decides fights", () => {
  // A counter the player cannot feel is a rounding error, not a mechanic.
  const beats = (a: "spearman" | "archer" | "rider", b: "spearman" | "archer" | "rider") =>
    damageFrom(a, b) > damageFrom(b, a);

  assert.ok(beats("spearman", "rider"), "spearmen should beat riders");
  assert.ok(beats("rider", "archer"), "riders should beat archers");
  assert.ok(beats("archer", "spearman"), "archers should beat spearmen");

  // And it should hold in a real fight, not just on paper.
  const world = createWorld(5);
  const spear = spawn(world, "spearman", 0, 20, 20);
  const rider = spawn(world, "rider", 1, 20.6, 20);
  commandAttack(world, spear, rider.id);
  commandAttack(world, rider, spear.id);
  run(world, 40);
  assert.equal(world.entities.has(rider.id), false, "the rider survived a spearman");
  assert.ok(world.entities.has(spear.id), "the spearman died to its own counter");
});

test("armour never makes a target invulnerable", () => {
  // Every attacker must be able to hurt everything, or a matchup reads as
  // broken rather than merely bad.
  for (const attacker of ["villager", "spearman", "archer", "rider"] as const) {
    for (const target of ["towncenter", "tower", "rider", "archer"] as const) {
      assert.ok(damageFrom(attacker, target) >= 1, `${attacker} cannot hurt ${target}`);
    }
  }
});

test("food and stone can actually be gathered", () => {
  // Stone shipped as terrain that was drawn on screen and could never be
  // collected, and food had no terrain source at all — villagers starved.
  for (const resource of ["food", "stone", "wood", "gold"] as const) {
    const world = createWorld(17);
    const v = [...world.entities.values()].find(
      (e) => e.owner === 0 && e.kind === "villager",
    )!;
    const tile = nearestResourceTile(world.map, resource, v.x, v.y, 28);
    assert.ok(tile, `no ${resource} anywhere near the start`);
    const before = world.players[0][resource];
    commandGather(world, v, tile!.x, tile!.y);
    run(world, 70);
    assert.ok(
      world.players[0][resource] > before,
      `${resource} never reached the stockpile (${before} -> ${world.players[0][resource]})`,
    );
  }
});

test("a watchtower defends itself without being told to", () => {
  const world = createWorld(23);
  const tower = spawn(world, "tower", 0, 25, 25, 1);
  const attacker = spawn(world, "spearman", 1, 27, 25);
  commandAttack(world, attacker, tower.id);
  run(world, 60);
  assert.equal(world.entities.has(attacker.id), false, "the tower never fired back");
  assert.ok(world.entities.has(tower.id), "the tower lost to a single spearman");
});

test("attack-move engages what it meets instead of walking past", () => {
  const world = createWorld(29);

  // Stand everything on ground that is definitely walkable. Spawning into a
  // forest leaves the unit unable to move and the test proves nothing.
  let lane: { x: number; y: number }[] = [];
  outer: for (let y = 2; y < world.map.height - 2; y++) {
    lane = [];
    for (let x = 2; x < world.map.width - 2; x++) {
      if (passable(world.map, x, y)) lane.push({ x, y });
      else lane = [];
      if (lane.length >= 14) break outer;
    }
  }
  assert.ok(lane.length >= 14, "no clear run of open ground on this map");

  const soldier = spawn(world, "spearman", 0, lane[0].x, lane[0].y);
  const victim = spawn(world, "villager", 1, lane[5].x, lane[5].y);

  // Sent well beyond the enemy; a plain move order would march straight by.
  commandAttackMove(world, soldier, lane[13].x, lane[13].y);
  run(world, 60);
  assert.equal(world.entities.has(victim.id), false, "it ignored an enemy on the way");
});

test("queued orders run in sequence", () => {
  const world = createWorld(31);
  const v = [...world.entities.values()].find(
    (e) => e.owner === 0 && e.kind === "villager",
  )!;
  const open: { x: number; y: number }[] = [];
  for (let r = 3; r < 8 && open.length < 2; r++) {
    const x = Math.round(v.x) + r;
    const y = Math.round(v.y);
    if (passable(world.map, x, y)) open.push({ x, y });
  }
  assert.ok(open.length >= 1, "no open ground near the start");

  commandMove(world, v, open[0].x, open[0].y);
  queueOrder(world, v, { name: "moving", tx: Math.round(v.x), ty: Math.round(v.y) });
  const origin = { x: v.x, y: v.y };

  run(world, 30);
  // It should have gone out and come back.
  assert.ok(
    Math.hypot(v.x - origin.x, v.y - origin.y) < 2,
    "the queued return order never ran",
  );
});

test("stop cancels the current order and the queue with it", () => {
  const world = createWorld(37);
  const v = [...world.entities.values()].find(
    (e) => e.owner === 0 && e.kind === "villager",
  )!;
  commandMove(world, v, v.x + 6, v.y);
  queueOrder(world, v, { name: "moving", tx: v.x + 12, ty: v.y });
  commandStop(v);
  const at = { x: v.x, y: v.y };
  run(world, 10);
  assert.ok(Math.hypot(v.x - at.x, v.y - at.y) < 0.6, "it kept moving after stop");
  assert.equal(v.state?.name, "idle");
});

test("villagers repair damaged buildings", () => {
  const world = createWorld(41);
  const v = [...world.entities.values()].find(
    (e) => e.owner === 0 && e.kind === "villager",
  )!;
  const tc = [...world.entities.values()].find(
    (e) => e.owner === 0 && e.kind === "towncenter",
  )!;
  tc.hp = 300;
  commandRepair(world, v, tc.id);
  run(world, 20);
  assert.ok(tc.hp > 300, `repair did nothing (still ${Math.round(tc.hp)})`);
  assert.ok(tc.hp <= maxHp("towncenter"), "repair overshot maximum health");
});

test("a scout sees further than the soldiers it scouts for", () => {
  assert.ok(UNITS.scout.sight > UNITS.spearman.sight);
  assert.ok(UNITS.scout.speed > UNITS.spearman.speed);
});

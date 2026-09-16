import { test } from "node:test";
import assert from "node:assert/strict";

import {
  backToWork,
  cancelTraining,
  commandPatrol,
  createWorld,
  enqueueTraining,
  setRally,
  soundAlarm,
  spawn,
  tick,
} from "./world.ts";
import { canSee, knownEnemyBuildings, tileExplored, tileVisible, updateVision } from "./fog.ts";
import { commandGroup, formationSlots } from "./formation.ts";
import { issueContextOrder, resolveTarget } from "./orders.ts";
import { passable } from "./map.ts";
import { UNITS, damageFrom } from "./config.ts";
import type { Entity, Owner, World } from "./types.ts";

const DT = 1 / 30;
const run = (w: World, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) tick(w, DT);
};
const own = (w: World, o: Owner, kind?: string) =>
  [...w.entities.values()].filter((e) => e.owner === o && (!kind || e.kind === kind));
const tc = (w: World, o: Owner) => own(w, o, "towncenter")[0];

/**
 * An open run of tiles, well away from both bases.
 *
 * Town centres shoot now, so a test unit placed near one simply dies and the
 * test ends up measuring the tower rather than the thing under test.
 */
function openRow(w: World, length: number): { x: number; y: number }[] {
  const bases = [...w.entities.values()].filter((e) => e.kind === "towncenter");
  const safe = (x: number, y: number) => bases.every((b) => Math.hypot(b.x - x, b.y - y) > 14);
  for (let y = 3; y < w.map.height - 3; y++) {
    let run: { x: number; y: number }[] = [];
    for (let x = 3; x < w.map.width - 3; x++) {
      if (passable(w.map, x, y) && safe(x, y)) run.push({ x, y });
      else run = [];
      if (run.length >= length) return run;
    }
  }
  throw new Error("no open row away from the bases");
}

// ---------------------------------------------------------------- fog

test("fog: the enemy base starts hidden, your own starts visible", () => {
  const w = createWorld(3);
  const mine = tc(w, 0);
  const theirs = tc(w, 1);
  assert.ok(tileVisible(w, 0, mine.x, mine.y), "own town centre not visible");
  assert.equal(tileExplored(w, 0, theirs.x, theirs.y), false, "enemy base visible from turn one");
  assert.equal(canSee(w, 0, theirs), false);
});

test("fog: scouting reveals, and a building stays remembered after you leave", () => {
  const w = createWorld(3);
  const theirs = tc(w, 1);
  const scout = spawn(w, "scout", 0, theirs.x - 4, theirs.y + 4);
  updateVision(w, true);
  assert.ok(canSee(w, 0, theirs), "a scout next to the base did not see it");
  assert.ok(knownEnemyBuildings(w, 0).some((g) => g.id === theirs.id), "no ghost recorded");

  // Walk away (teleport, for the test) and confirm the memory persists.
  scout.x = 5;
  scout.y = 5;
  updateVision(w, true);
  assert.equal(canSee(w, 0, theirs), false, "still visible after leaving");
  assert.ok(tileExplored(w, 0, theirs.x, theirs.y), "explored state was lost");
  assert.ok(
    knownEnemyBuildings(w, 0).some((g) => g.id === theirs.id),
    "the remembered building was forgotten",
  );
});

test("fog: a destroyed building is only forgotten once someone looks", () => {
  const w = createWorld(5);
  const theirs = spawn(w, "house", 1, 28, 28, 1);
  const eye = spawn(w, "scout", 0, 26, 26);
  updateVision(w, true);
  assert.ok(knownEnemyBuildings(w, 0).some((g) => g.id === theirs.id));

  eye.x = 5;
  eye.y = 50;
  updateVision(w, true);
  w.entities.delete(theirs.id);
  updateVision(w, true);
  assert.ok(
    knownEnemyBuildings(w, 0).some((g) => g.id === theirs.id),
    "fog leaked the building's destruction",
  );

  eye.x = 26;
  eye.y = 26;
  updateVision(w, true);
  assert.equal(
    knownEnemyBuildings(w, 0).some((g) => g.id === theirs.id),
    false,
    "looking again did not clear the ghost",
  );
});

test("fog: enemies you can't see can't be clicked", () => {
  const w = createWorld(7);
  const theirs = tc(w, 1);
  const target = resolveTarget(w, 0, theirs.x, theirs.y);
  assert.notEqual(target.kind, "entity", "clicking into fog revealed the enemy town centre");
});

// ---------------------------------------------------------------- formations

test("formations: one slot per unit, none stacked", () => {
  for (const f of ["line", "box", "column", "spread"] as const) {
    for (const n of [2, 5, 9, 20]) {
      const slots = formationSlots(n, f, { x: 1, y: 0.3 });
      assert.equal(slots.length, n, `${f}/${n}: wrong slot count`);
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const d = Math.hypot(slots[i].dx - slots[j].dx, slots[i].dy - slots[j].dy);
          assert.ok(d > 0.5, `${f}/${n}: slots ${i} and ${j} overlap`);
        }
      }
    }
  }
});

test("formations: the group is centred on the click", () => {
  const slots = formationSlots(12, "box", { x: 0, y: 1 });
  const cx = slots.reduce((a, s) => a + s.dx, 0) / slots.length;
  const cy = slots.reduce((a, s) => a + s.dy, 0) / slots.length;
  assert.ok(Math.hypot(cx, cy) < 0.6, `formation centroid is ${Math.hypot(cx, cy).toFixed(2)} off`);
});

test("formations: a mixed army arrives together, spearmen ahead of archers", () => {
  const w = createWorld(11);
  const row = openRow(w, 12);
  const units: Entity[] = [];
  for (let i = 0; i < 4; i++) units.push(spawn(w, "archer", 0, row[i].x, row[i].y));
  for (let i = 4; i < 8; i++) units.push(spawn(w, "spearman", 0, row[i].x, row[i].y));
  for (let i = 8; i < 10; i++) units.push(spawn(w, "rider", 0, row[i].x, row[i].y));

  // Somewhere well away, on open ground.
  const dest = openRow(w, 3)[1];
  const far = { x: w.map.width - 1 - dest.x, y: w.map.height - 1 - dest.y };
  const goal = passable(w.map, far.x, far.y) ? far : dest;

  commandGroup(w, units, { tx: goal.x, ty: goal.y, formation: "line", attack: false, queue: false });

  // Riders are much faster; with matched speeds they must not arrive alone.
  const speeds = units.map((u) => (u.state?.name === "moving" ? u.state.speed : undefined));
  const riderCaps = units
    .map((u, i) => ({ u, s: speeds[i] }))
    .filter(({ u }) => u.kind === "rider")
    .map(({ s }) => s ?? UNITS.rider.speed);
  assert.ok(
    riderCaps.every((s) => s < UNITS.rider.speed),
    "riders were not slowed to the group's pace",
  );

  run(w, 60);
  const dists = units.map((u) => Math.hypot(u.x - goal.x, u.y - goal.y));
  assert.ok(Math.max(...dists) < 6, `army scattered on arrival (max ${Math.max(...dists).toFixed(1)})`);
});

// ---------------------------------------------------------------- orders

test("orders: right-clicking forage puts villagers to work, spread over the patch", () => {
  const w = createWorld(13);
  const villagers = own(w, 0, "villager");
  const home = tc(w, 0);
  // Find forage near the base.
  let spot: { x: number; y: number } | null = null;
  for (let r = 1; r < 12 && !spot; r++) {
    for (let dy = -r; dy <= r && !spot; dy++) {
      for (let dx = -r; dx <= r && !spot; dx++) {
        const t = resolveTarget(w, 0, Math.round(home.x) + dx, Math.round(home.y) + dy);
        if (t.kind === "resource" && w.map.terrain[t.y * w.map.width + t.x] === 5) spot = t;
      }
    }
  }
  assert.ok(spot, "no explored forage near the start");

  const result = issueContextOrder(w, 0, villagers.map((v) => v.id), { kind: "resource", ...spot! }, {
    formation: "line",
    queue: false,
  });
  assert.equal(result?.order, "gather");
  assert.ok(villagers.every((v) => v.state?.name === "gathering"), "not everyone went to work");
  const tiles = new Set(
    villagers.map((v) => (v.state?.name === "gathering" ? `${v.state.tileX},${v.state.tileY}` : "")),
  );
  assert.ok(tiles.size > 1, "all villagers were sent to the same single tile");
});

test("orders: right-clicking a visible enemy attacks it", () => {
  const w = createWorld(17);
  const row = openRow(w, 6);
  const soldier = spawn(w, "spearman", 0, row[0].x, row[0].y);
  const foe = spawn(w, "archer", 1, row[3].x, row[3].y);
  updateVision(w, true);
  const target = resolveTarget(w, 0, foe.x, foe.y);
  assert.equal(target.kind, "entity");
  const result = issueContextOrder(w, 0, [soldier.id], target, { formation: "line", queue: false });
  assert.equal(result?.order, "attack");
  assert.equal(soldier.state?.name, "attacking");
});

test("orders: with only a building selected, right-click sets its rally point", () => {
  const w = createWorld(19);
  const home = tc(w, 0);
  const result = issueContextOrder(w, 0, [home.id], { kind: "ground", x: 20, y: 30 }, {
    formation: "line",
    queue: false,
  });
  assert.equal(result?.order, "rally");
  assert.deepEqual(home.rally, { x: 20, y: 30 });
});

test("orders: a rally point on a resource sends new villagers to work it", () => {
  const w = createWorld(23);
  const home = tc(w, 0);
  const vs = own(w, 0, "villager");
  // Use a villager's current workable neighbourhood: any wood near the base.
  let wood: { x: number; y: number } | null = null;
  outer: for (let r = 2; r < 14; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(home.x) + dx;
        const y = Math.round(home.y) + dy;
        if (w.map.terrain[y * w.map.width + x] === 1 && w.map.amount[y * w.map.width + x] > 0) {
          wood = { x, y };
          break outer;
        }
      }
    }
  }
  assert.ok(wood && vs.length);
  setRally(home, wood!.x, wood!.y);
  enqueueTraining(w, home, "villager");
  run(w, UNITS.villager.trainTime + 1);
  const fresh = own(w, 0, "villager").find((v) => !vs.includes(v))!;
  assert.ok(fresh, "no villager was trained");
  assert.equal(fresh.state?.name, "gathering", "the new villager ignored the rally point");
});

test("orders: shift-click queues instead of replacing", () => {
  const w = createWorld(29);
  const row = openRow(w, 10);
  const u = spawn(w, "spearman", 0, row[0].x, row[0].y);
  issueContextOrder(w, 0, [u.id], { kind: "ground", x: row[5].x, y: row[5].y }, { formation: "line", queue: false });
  issueContextOrder(w, 0, [u.id], { kind: "ground", x: row[9].x, y: row[9].y }, { formation: "line", queue: true });
  assert.equal(u.orders?.length, 1, "the second order replaced the first");
  run(w, 30);
  assert.ok(Math.hypot(u.x - row[9].x, u.y - row[9].y) < 1.5, "the queued order never ran");
});

// ---------------------------------------------------------------- commands

test("patrol walks back and forth", () => {
  const w = createWorld(31);
  const row = openRow(w, 10);
  const u = spawn(w, "spearman", 0, row[0].x, row[0].y);
  commandPatrol(w, u, row[8].x, row[8].y);
  let reachedB = false;
  let returnedA = false;
  for (let i = 0; i < 60 / DT; i++) {
    tick(w, DT);
    if (Math.hypot(u.x - row[8].x, u.y - row[8].y) < 0.6) reachedB = true;
    if (reachedB && Math.hypot(u.x - row[0].x, u.y - row[0].y) < 0.6) returnedA = true;
  }
  assert.ok(reachedB && returnedA, `patrol didn't complete a loop (B=${reachedB}, back=${returnedA})`);
  assert.equal(u.state?.name, "patrol", "patrol stopped by itself");
});

test("cancelling training refunds the cost", () => {
  const w = createWorld(37);
  const home = tc(w, 0);
  const before = w.players[0].food;
  enqueueTraining(w, home, "villager");
  assert.equal(w.players[0].food, before - UNITS.villager.cost.food!);
  assert.ok(cancelTraining(w, home, 0));
  assert.equal(w.players[0].food, before, "refund was wrong");
  assert.equal(home.queue?.length, 0);
});

test("stone is actually charged for a watchtower", () => {
  // canAfford and pay once only knew about food, wood and gold.
  const w = createWorld(41);
  w.players[0].wood = 1000;
  w.players[0].stone = 10;
  const { canAfford } = requireWorld();
  assert.equal(canAfford(w, 0, { wood: 40, stone: 100 }), false, "a tower was affordable with 10 stone");
});

function requireWorld() {
  // Imported lazily to keep this file's import list focused on Phase 2.
  return worldModule;
}
import * as worldModule from "./world.ts";

test("the alarm pulls villagers to safety, and back to work resumes their jobs", () => {
  const w = createWorld(43);
  const vs = own(w, 0, "villager");
  run(w, 3);
  // Put everyone to work first.
  for (const v of vs) {
    const tiles = worldModule.nearestResourceTile(w.map, "wood", v.x, v.y, 20)!;
    worldModule.commandGather(w, v, tiles.x, tiles.y);
  }
  run(w, 5);
  const count = soundAlarm(w, 0);
  assert.equal(count, vs.length);
  run(w, 20);
  const home = tc(w, 0);
  assert.ok(
    vs.every((v) => worldModule.distanceTo(home, v.x, v.y) < 3),
    "villagers didn't reach the town centre",
  );
  const resumed = backToWork(w, 0);
  assert.ok(resumed > 0, "back to work resumed nobody");
  assert.ok(vs.some((v) => v.state?.name === "gathering"));
});

test("a town centre shoots raiders, and arrows barely scratch buildings", () => {
  const w = createWorld(47);
  const home = tc(w, 0);
  const raider = spawn(w, "spearman", 1, home.x + 3, home.y);
  run(w, 90);
  assert.equal(w.entities.has(raider.id), false, "a lone spearman survived a town centre's arrows");

  assert.ok(
    damageFrom("archer", "towncenter") * 3 < damageFrom("spearman", "towncenter"),
    "archers are nearly as good at razing as melee",
  );
});

test("combat order doesn't favour whoever spawned first", () => {
  // Two identical spearmen trading blows reach lethal damage on the same tick.
  // Resolving hits one at a time let whoever was processed first kill the
  // other before it could swing back — measured, the same side won 23 of 24
  // such duels. With simultaneous resolution the only fair outcome for a
  // perfect mirror is that neither side is favoured.
  let olderWins = 0;
  let youngerWins = 0;
  for (let t = 0; t < 24; t++) {
    const w = createWorld(53);
    for (const e of [...w.entities.values()]) if (e.kind !== "towncenter") w.entities.delete(e.id);
    const row = openRow(w, 4);
    const older = spawn(w, "spearman", 0, row[1].x, row[1].y);
    const younger = spawn(w, "spearman", 1, row[2].x, row[2].y);
    for (let i = 0; i < t; i++) tick(w, DT);
    worldModule.commandAttack(w, older, younger.id);
    worldModule.commandAttack(w, younger, older.id);
    run(w, 30);
    const o = w.entities.has(older.id);
    const y = w.entities.has(younger.id);
    if (o && !y) olderWins++;
    if (y && !o) youngerWins++;
  }
  assert.ok(
    Math.abs(olderWins - youngerWins) <= 2,
    `mirror duels favoured one side: older ${olderWins}, younger ${youngerWins}`,
  );
});

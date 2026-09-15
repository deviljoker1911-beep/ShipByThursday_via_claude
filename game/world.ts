import {
  BUILDINGS,
  CARRY_CAPACITY,
  GATHER_RATE,
  HARD_POP_CAP,
  STARTING,
  STARTING_POP_CAP,
  UNITS,
  isBuilding,
  isUnit,
  maxHp,
} from "./config.ts";
import { generateMap, idx, inBounds, passable, terrainAt } from "./map.ts";
import { findPath } from "./pathfind.ts";
import {
  TERRAIN_IDS,
  type BuildingKind,
  type Entity,
  type EntityKind,
  type GameMap,
  type Owner,
  type Resource,
  type UnitKind,
  type World,
} from "./types.ts";

/** Terrain id -> what gathering it yields. */
const RESOURCE_OF: Record<number, Resource | undefined> = {
  [TERRAIN_IDS.forest]: "wood",
  [TERRAIN_IDS.gold]: "gold",
  [TERRAIN_IDS.stone]: undefined,
};

export function createWorld(seed = Date.now()): World {
  const { map, starts } = generateMap(56, seed);

  const world: World = {
    map,
    entities: new Map(),
    players: {
      0: { owner: 0, ...STARTING, pop: 0, popCap: STARTING_POP_CAP },
      1: { owner: 1, ...STARTING, pop: 0, popCap: STARTING_POP_CAP },
    },
    nextId: 1,
    time: 0,
    outcome: "playing",
    notices: [],
  };

  for (const owner of [0, 1] as Owner[]) {
    const s = starts[owner];
    spawn(world, "towncenter", owner, s.x, s.y, 1);
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      spawn(
        world,
        "villager",
        owner,
        s.x + Math.cos(angle) * 2.6,
        s.y + Math.sin(angle) * 2.6,
      );
    }
  }

  recomputePop(world);
  return world;
}

export function spawn(
  world: World,
  kind: EntityKind,
  owner: Owner,
  x: number,
  y: number,
  progress = 1,
): Entity {
  const e: Entity = {
    id: world.nextId++,
    kind,
    owner,
    x,
    y,
    hp: isBuilding(kind) ? maxHp(kind) * (progress < 1 ? 0.15 : 1) : maxHp(kind),
  };
  if (isBuilding(kind)) {
    e.progress = progress;
    e.queue = [];
  } else {
    e.state = { name: "idle" };
    e.attackCd = 0;
    e.gatherCd = 0;
  }
  world.entities.set(e.id, e);
  return e;
}

/** Top-left tile of a building's footprint. */
export function footprint(e: Entity): { x0: number; y0: number; size: number } {
  const size = isBuilding(e.kind) ? BUILDINGS[e.kind as BuildingKind].size : 1;
  return { x0: Math.round(e.x - (size - 1) / 2), y0: Math.round(e.y - (size - 1) / 2), size };
}

/**
 * Distance from a point to an entity's edge, not its centre.
 *
 * This matters more than it sounds. A 3x3 town centre extends 1.5 tiles from
 * its centre, and its footprint is impassable — so a villager standing right
 * against it is 2.0 tiles from the centre and physically cannot get closer.
 * Any "am I close enough?" test measured against the centre will therefore
 * never be satisfied, and the unit waits beside the building forever.
 */
export function distanceTo(e: Entity, x: number, y: number): number {
  if (!isBuilding(e.kind)) return Math.hypot(e.x - x, e.y - y);
  const { x0, y0, size } = footprint(e);
  // Nearest point on the footprint rectangle; zero when the point is inside.
  const nx = Math.max(x0 - 0.5, Math.min(x, x0 + size - 0.5));
  const ny = Math.max(y0 - 0.5, Math.min(y, y0 + size - 0.5));
  return Math.hypot(nx - x, ny - y);
}

export function occupiesTile(e: Entity, x: number, y: number): boolean {
  if (!isBuilding(e.kind)) return false;
  const { x0, y0, size } = footprint(e);
  return x >= x0 && y >= y0 && x < x0 + size && y < y0 + size;
}

/** Tiles blocked by buildings, rebuilt when a building is added or destroyed. */
export function buildingBlocker(world: World) {
  const blocked = new Set<number>();
  for (const e of world.entities.values()) {
    if (!isBuilding(e.kind)) continue;
    const { x0, y0, size } = footprint(e);
    for (let y = y0; y < y0 + size; y++) {
      for (let x = x0; x < x0 + size; x++) {
        blocked.add(y * world.map.width + x);
      }
    }
  }
  return { has: (x: number, y: number) => blocked.has(y * world.map.width + x) };
}

export function canPlaceBuilding(
  world: World,
  kind: BuildingKind,
  tx: number,
  ty: number,
): boolean {
  const size = BUILDINGS[kind].size;
  const x0 = Math.round(tx - (size - 1) / 2);
  const y0 = Math.round(ty - (size - 1) / 2);
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      if (!inBounds(world.map, x, y) || !passable(world.map, x, y)) return false;
      for (const e of world.entities.values()) {
        if (occupiesTile(e, x, y)) return false;
      }
    }
  }
  return true;
}

export function canAfford(world: World, owner: Owner, cost: Partial<Record<Resource, number>>) {
  const p = world.players[owner];
  return (
    (cost.food ?? 0) <= p.food && (cost.wood ?? 0) <= p.wood && (cost.gold ?? 0) <= p.gold
  );
}

export function pay(world: World, owner: Owner, cost: Partial<Record<Resource, number>>) {
  const p = world.players[owner];
  p.food -= cost.food ?? 0;
  p.wood -= cost.wood ?? 0;
  p.gold -= cost.gold ?? 0;
}

export function recomputePop(world: World) {
  for (const owner of [0, 1] as Owner[]) {
    let pop = 0;
    let cap = 0;
    for (const e of world.entities.values()) {
      if (e.owner !== owner) continue;
      if (isUnit(e.kind)) pop += UNITS[e.kind as UnitKind].pop;
      else if (e.progress === 1) cap += BUILDINGS[e.kind as BuildingKind].popBonus ?? 0;
    }
    world.players[owner].pop = pop;
    world.players[owner].popCap = Math.min(cap, HARD_POP_CAP);
  }
}

export function notify(world: World, text: string) {
  world.notices.push({ text, at: world.time });
  if (world.notices.length > 4) world.notices.shift();
}

function nearestDropOff(world: World, e: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const other of world.entities.values()) {
    if (other.owner !== e.owner || !isBuilding(other.kind)) continue;
    if (other.progress !== 1) continue;
    if (!BUILDINGS[other.kind as BuildingKind].dropOff) continue;
    const d = distanceTo(other, e.x, e.y);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

/** Closest tile of the given resource, searched outward in rings. */
export function nearestResourceTile(
  map: GameMap,
  resource: Resource,
  fromX: number,
  fromY: number,
  maxRadius = 18,
): { x: number; y: number } | null {
  const wanted = resource === "wood" ? TERRAIN_IDS.forest : TERRAIN_IDS.gold;
  const cx = Math.round(fromX);
  const cy = Math.round(fromY);
  for (let r = 1; r < maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!inBounds(map, x, y)) continue;
        if (terrainAt(map, x, y) === wanted && map.amount[idx(map, x, y)] > 0) {
          return { x, y };
        }
      }
    }
  }
  return null;
}

export function entityAt(world: World, tx: number, ty: number): Entity | null {
  for (const e of world.entities.values()) {
    if (isBuilding(e.kind)) {
      if (occupiesTile(e, Math.round(tx), Math.round(ty))) return e;
    } else {
      const r = UNITS[e.kind as UnitKind].radius + 0.25;
      if (Math.hypot(e.x - tx, e.y - ty) <= r) return e;
    }
  }
  return null;
}

// ---------------------------------------------------------------- commands

export function commandMove(world: World, e: Entity, tx: number, ty: number) {
  if (!isUnit(e.kind)) return;
  e.state = { name: "moving", tx, ty };
  e.path = findPath(world.map, e.x, e.y, tx, ty, buildingBlocker(world));
}

export function commandGather(world: World, e: Entity, tileX: number, tileY: number) {
  if (e.kind !== "villager") return;
  const t = terrainAt(world.map, tileX, tileY);
  const resource = RESOURCE_OF[t];
  if (!resource || world.map.amount[idx(world.map, tileX, tileY)] <= 0) return;
  e.state = { name: "gathering", tileX, tileY, resource };
  e.path = findPath(world.map, e.x, e.y, tileX, tileY, buildingBlocker(world));
}

export function commandAttack(world: World, e: Entity, targetId: number) {
  if (!isUnit(e.kind)) return;
  e.state = { name: "attacking", targetId };
  const t = world.entities.get(targetId);
  if (t) e.path = findPath(world.map, e.x, e.y, t.x, t.y, buildingBlocker(world));
}

export function commandBuild(world: World, e: Entity, targetId: number) {
  if (e.kind !== "villager") return;
  const t = world.entities.get(targetId);
  if (!t) return;
  e.state = { name: "building", targetId };
  e.path = findPath(world.map, e.x, e.y, t.x, t.y, buildingBlocker(world));
}

export function enqueueTraining(world: World, building: Entity, kind: UnitKind): string | null {
  if (!isBuilding(building.kind) || building.progress !== 1) return "Still under construction.";
  if (!BUILDINGS[building.kind as BuildingKind].trains.includes(kind)) return null;
  const spec = UNITS[kind];
  const p = world.players[building.owner];
  if (p.pop + (building.queue?.length ?? 0) >= p.popCap) return "Need more houses.";
  if (!canAfford(world, building.owner, spec.cost)) return "Not enough resources.";
  pay(world, building.owner, spec.cost);
  building.queue!.push({ kind, remaining: spec.trainTime });
  return null;
}

// ---------------------------------------------------------------- simulation

const SEPARATION = 0.55;

export function tick(world: World, dt: number) {
  if (world.outcome !== "playing") return;
  world.time += dt;

  for (const e of [...world.entities.values()]) {
    if (isBuilding(e.kind)) tickBuilding(world, e, dt);
    else tickUnit(world, e, dt);
  }

  separate(world);
  recomputePop(world);
  checkOutcome(world);
}

function tickBuilding(world: World, e: Entity, dt: number) {
  const spec = BUILDINGS[e.kind as BuildingKind];

  if (spec.foodPerSecond && e.progress === 1) {
    world.players[e.owner].food += spec.foodPerSecond * dt;
  }

  if (e.progress !== 1 || !e.queue?.length) return;

  const head = e.queue[0];
  head.remaining -= dt;
  if (head.remaining > 0) return;

  e.queue.shift();
  const { x0, y0, size } = footprint(e);
  // Spawn just outside the footprint so the new unit isn't stuck inside it.
  const spot = findFreeTileNear(world, x0 + size / 2, y0 + size + 0.5);
  const unit = spawn(world, head.kind, e.owner, spot.x, spot.y);
  if (e.rally) commandMove(world, unit, e.rally.x, e.rally.y);
}

function findFreeTileNear(world: World, x: number, y: number) {
  const blocker = buildingBlocker(world);
  for (let r = 0; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = Math.round(x) + dx;
        const ty = Math.round(y) + dy;
        if (passable(world.map, tx, ty) && !blocker.has(tx, ty)) return { x: tx, y: ty };
      }
    }
  }
  return { x: Math.round(x), y: Math.round(y) };
}

function stepAlongPath(world: World, e: Entity, speed: number, dt: number): boolean {
  if (!e.path || e.path.length === 0) return true;
  let budget = speed * dt;
  while (budget > 0 && e.path.length > 0) {
    const next = e.path[0];
    const dx = next.x - e.x;
    const dy = next.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      e.x = next.x;
      e.y = next.y;
      budget -= d;
      e.path.shift();
    } else {
      e.x += (dx / d) * budget;
      e.y += (dy / d) * budget;
      budget = 0;
    }
  }
  return e.path.length === 0;
}

function tickUnit(world: World, e: Entity, dt: number) {
  const spec = UNITS[e.kind as UnitKind];
  e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);
  e.gatherCd = Math.max(0, (e.gatherCd ?? 0) - dt);

  const state = e.state ?? { name: "idle" };

  switch (state.name) {
    case "idle":
      autoAcquire(world, e, spec.range);
      break;

    case "moving":
      if (stepAlongPath(world, e, spec.speed, dt)) e.state = { name: "idle" };
      break;

    case "gathering": {
      const tileAmount = world.map.amount[idx(world.map, state.tileX, state.tileY)];
      if (tileAmount <= 0) {
        // Exhausted — find more of the same rather than standing idle.
        const next = nearestResourceTile(world.map, state.resource, e.x, e.y);
        if (next) commandGather(world, e, next.x, next.y);
        else e.state = { name: "idle" };
        break;
      }
      // Adjacency is the right test, not a radius. The resource tile is
      // impassable, so a villager can only ever stand on a neighbouring tile —
      // which is up to ~1.4 away diagonally, and further once you account for
      // it being pushed off-centre by the separation pass. A euclidean
      // threshold tight enough to mean "touching" is one a villager can fail
      // to satisfy with nowhere closer to stand, and it then waits forever.
      const adjacent =
        Math.abs(Math.round(e.x) - state.tileX) <= 1 &&
        Math.abs(Math.round(e.y) - state.tileY) <= 1;

      if (!adjacent) {
        const arrived = stepAlongPath(world, e, spec.speed, dt);
        // Path spent and still not adjacent: this is as close as the terrain
        // allows. Look for another tile rather than standing here forever.
        if (arrived) {
          const next = nearestResourceTile(world.map, state.resource, e.x, e.y);
          if (next && (next.x !== state.tileX || next.y !== state.tileY)) {
            commandGather(world, e, next.x, next.y);
          } else {
            e.state = { name: "idle" };
          }
        }
        break;
      }
      e.path = [];
      if (e.gatherCd! > 0) break;
      e.gatherCd = 1 / GATHER_RATE;
      const carried = e.carrying;
      if (carried && carried.resource !== state.resource) e.carrying = undefined;
      e.carrying = {
        resource: state.resource,
        amount: (e.carrying?.amount ?? 0) + 1,
      };
      world.map.amount[idx(world.map, state.tileX, state.tileY)] = Math.max(
        0,
        tileAmount - 1,
      );
      if (world.map.amount[idx(world.map, state.tileX, state.tileY)] === 0) {
        // Felled trees become walkable ground.
        world.map.terrain[idx(world.map, state.tileX, state.tileY)] = TERRAIN_IDS.grass;
      }
      if (e.carrying.amount >= CARRY_CAPACITY) {
        const drop = nearestDropOff(world, e);
        if (drop) {
          e.state = { name: "returning", resource: state.resource };
          e.path = findPath(world.map, e.x, e.y, drop.x, drop.y, buildingBlocker(world));
          // Remember where we were working so we can come back.
          e.workTile = { x: state.tileX, y: state.tileY };
        }
      }
      break;
    }

    case "returning": {
      const drop = nearestDropOff(world, e);
      if (!drop) {
        e.state = { name: "idle" };
        break;
      }
      if (distanceTo(drop, e.x, e.y) > 1.2) {
        if (!e.path?.length) {
          e.path = findPath(world.map, e.x, e.y, drop.x, drop.y, buildingBlocker(world));
        }
        stepAlongPath(world, e, spec.speed, dt);
        break;
      }
      if (e.carrying) {
        world.players[e.owner][e.carrying.resource] += e.carrying.amount;
        e.carrying = undefined;
      }
      // Back to the tile we were working, if it still has anything.
      const back = e.workTile;
      if (back && world.map.amount[idx(world.map, back.x, back.y)] > 0) {
        commandGather(world, e, back.x, back.y);
      } else {
        const next = nearestResourceTile(world.map, state.resource, e.x, e.y);
        if (next) commandGather(world, e, next.x, next.y);
        else e.state = { name: "idle" };
      }
      break;
    }

    case "building": {
      const target = world.entities.get(state.targetId);
      if (!target || target.progress === 1) {
        e.state = { name: "idle" };
        break;
      }
      if (distanceTo(target, e.x, e.y) > 1.2) {
        stepAlongPath(world, e, spec.speed, dt);
        break;
      }
      e.path = [];
      const spec2 = BUILDINGS[target.kind as BuildingKind];
      target.progress = Math.min(1, (target.progress ?? 0) + dt / spec2.buildTime);
      target.hp = spec2.hp * (0.15 + 0.85 * target.progress);
      if (target.progress >= 1) {
        target.hp = spec2.hp;
        e.state = { name: "idle" };
      }
      break;
    }

    case "attacking": {
      const target = world.entities.get(state.targetId);
      if (!target) {
        e.state = { name: "idle" };
        break;
      }
      const reach = spec.range;
      const d = distanceTo(target, e.x, e.y);
      if (d > reach) {
        if (!e.path?.length) {
          e.path = findPath(world.map, e.x, e.y, target.x, target.y, buildingBlocker(world));
        }
        stepAlongPath(world, e, spec.speed, dt);
        break;
      }
      e.path = [];
      if (e.attackCd! > 0) break;
      e.attackCd = spec.attackSpeed;
      target.hp -= spec.attack;
      if (target.hp <= 0) {
        world.entities.delete(target.id);
        e.state = { name: "idle" };
      }
      break;
    }
  }
}

/** Idle military units defend themselves rather than being shot at passively. */
function autoAcquire(world: World, e: Entity, range: number) {
  if (e.kind === "villager") return;
  const searchRange = Math.max(range, 5);
  let best: Entity | null = null;
  let bestD = searchRange;
  for (const other of world.entities.values()) {
    if (other.owner === e.owner) continue;
    const d = distanceTo(other, e.x, e.y);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  if (best) e.state = { name: "attacking", targetId: best.id };
}

/**
 * Push overlapping units apart.
 *
 * Without this, a group given one move order converges on an identical point
 * and stacks into what looks like a single unit.
 */
function separate(world: World) {
  const units = [...world.entities.values()].filter((e) => isUnit(e.kind));
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i];
      const b = units[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= SEPARATION || d === 0) continue;
      const push = (SEPARATION - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      if (passable(world.map, Math.round(a.x - nx * push), Math.round(a.y - ny * push))) {
        a.x -= nx * push;
        a.y -= ny * push;
      }
      if (passable(world.map, Math.round(b.x + nx * push), Math.round(b.y + ny * push))) {
        b.x += nx * push;
        b.y += ny * push;
      }
    }
  }
}

function checkOutcome(world: World) {
  let playerTc = 0;
  let aiTc = 0;
  for (const e of world.entities.values()) {
    if (e.kind !== "towncenter") continue;
    if (e.owner === 0) playerTc++;
    else aiTc++;
  }
  if (playerTc === 0) world.outcome = "lost";
  else if (aiTc === 0) world.outcome = "won";
}

import {
  BUILDINGS,
  CARRY_CAPACITY,
  GATHER_RATE,
  HARD_POP_CAP,
  REPAIR_RATE,
  STARTING,
  STARTING_POP_CAP,
  UNITS,
  attackRangeOf,
  attackSpeedOf,
  damageFrom,
  isArmed,
  isBuilding,
  isUnit,
  maxHp,
  sightOf,
} from "./config.ts";
import { generateMap, idx, inBounds, passable, terrainAt } from "./map.ts";
import { findPath } from "./pathfind.ts";
import { updateVision } from "./fog.ts";
import {
  TERRAIN_IDS,
  type BuildingKind,
  type Entity,
  type EntityKind,
  type GameMap,
  type Owner,
  type Resource,
  type UnitKind,
  type MatchStats,
  type UnitState,
  type Vision,
  type World,
} from "./types.ts";

/** Terrain id -> what gathering it yields. */
const RESOURCE_OF: Record<number, Resource | undefined> = {
  [TERRAIN_IDS.forest]: "wood",
  [TERRAIN_IDS.gold]: "gold",
  [TERRAIN_IDS.stone]: "stone",
  [TERRAIN_IDS.forage]: "food",
};

/** Terrain that yields a given resource, for "find me more of this". */
const TERRAIN_FOR: Record<Resource, number | null> = {
  wood: TERRAIN_IDS.forest,
  gold: TERRAIN_IDS.gold,
  stone: TERRAIN_IDS.stone,
  food: TERRAIN_IDS.forage,
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
    rngState: (seed ^ 0x9e3779b9) >>> 0,
    outcome: "playing",
    notices: [],
    effects: [],
    buildingVersion: 0,
    terrainVersion: 0,
    starts,
    stats: { 0: blankStats(), 1: blankStats() },
    vision: {
      0: blankVision(map.width * map.height),
      1: blankVision(map.width * map.height),
    },
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
  updateVision(world, true);
  return world;
}

function blankStats(): MatchStats {
  return {
    gathered: { food: 0, wood: 0, gold: 0, stone: 0 },
    unitsTrained: 0,
    unitsLost: 0,
    buildingsBuilt: 0,
    buildingsLost: 0,
    kills: 0,
  };
}

function blankVision(size: number): Vision {
  return {
    explored: new Uint8Array(size),
    visible: new Uint8Array(size),
    ghosts: new Map(),
    nextUpdate: 0,
  };
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
    e.attackCd = 0;
  } else {
    e.state = { name: "idle" };
    e.attackCd = 0;
    e.gatherCd = 0;
  }
  world.entities.set(e.id, e);
  if (isBuilding(kind)) world.buildingVersion++;
  return e;
}

/** The one way anything leaves the world, so bookkeeping can't be skipped. */
export function removeEntity(world: World, e: Entity, killer?: Entity) {
  if (!world.entities.delete(e.id)) return;
  if (isBuilding(e.kind)) world.buildingVersion++;
  const loser = world.stats[e.owner];
  if (isBuilding(e.kind)) loser.buildingsLost++;
  else loser.unitsLost++;
  if (killer && killer.owner !== e.owner) world.stats[killer.owner].kills++;
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

/**
 * Tiles blocked by buildings.
 *
 * Cached against a version counter bumped whenever a building appears or is
 * destroyed. It used to be rebuilt from scratch on every path request, which
 * meant a twenty-unit move order rebuilt it twenty times in one click.
 */
const blockerCache = new WeakMap<World, { version: number; has: (x: number, y: number) => boolean }>();

export function buildingBlocker(world: World) {
  const cached = blockerCache.get(world);
  if (cached && cached.version === world.buildingVersion) return cached;
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
  const result = {
    version: world.buildingVersion,
    has: (x: number, y: number) => blocked.has(y * world.map.width + x),
  };
  blockerCache.set(world, result);
  return result;
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

const RESOURCES: Resource[] = ["food", "wood", "gold", "stone"];

/**
 * Iterates every resource rather than naming them, because naming them is how
 * stone got left out: the first version checked food, wood and gold only, so
 * watchtowers were free of the one resource that was supposed to gate them.
 */
export function canAfford(world: World, owner: Owner, cost: Partial<Record<Resource, number>>) {
  const p = world.players[owner];
  return RESOURCES.every((r) => (cost[r] ?? 0) <= p[r]);
}

export function pay(world: World, owner: Owner, cost: Partial<Record<Resource, number>>) {
  const p = world.players[owner];
  for (const r of RESOURCES) p[r] -= cost[r] ?? 0;
}

export function refund(world: World, owner: Owner, cost: Partial<Record<Resource, number>>) {
  const p = world.players[owner];
  for (const r of RESOURCES) p[r] += cost[r] ?? 0;
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

/**
 * The simulation's only source of randomness.
 *
 * Advances the world's stored state, so a run is reproducible from its seed.
 */
export function rand(world: World): number {
  let a = (world.rngState + 0x6d2b79f5) >>> 0;
  world.rngState = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function emit(world: World, effect: World["effects"][number]) {
  // Presentation only. Capped so a long headless run can't grow unboundedly —
  // the tests run thousands of ticks with no renderer draining this.
  if (world.effects.length > 400) world.effects.shift();
  world.effects.push(effect);
}

/**
 * Finish the current order and start the next queued one.
 *
 * Shift-clicking appends to `orders`; without this a queue would silently
 * evaporate the moment a unit completed its first task.
 */
export function nextOrder(world: World, e: Entity) {
  const queued = e.orders?.shift();
  if (!queued) {
    e.state = { name: "idle" };
    return;
  }
  applyState(world, e, queued);
}

/** Start a state, computing whatever path it needs. */
export function applyState(world: World, e: Entity, state: UnitState) {
  switch (state.name) {
    case "moving":
    case "attackMove":
      e.state = state;
      e.path = finishAt(
        world,
        findPath(world.map, e.x, e.y, state.tx, state.ty, buildingBlocker(world)),
        state.tx,
        state.ty,
      );
      break;
    case "patrol": {
      e.state = state;
      const tx = state.toB ? state.bx : state.ax;
      const ty = state.toB ? state.by : state.ay;
      e.path = findPath(world.map, e.x, e.y, tx, ty, buildingBlocker(world));
      break;
    }
    case "gathering":
      commandGather(world, e, state.tileX, state.tileY);
      break;
    case "attacking":
      commandAttack(world, e, state.targetId);
      break;
    case "building":
      commandBuild(world, e, state.targetId);
      break;
    case "repairing":
      commandRepair(world, e, state.targetId);
      break;
    default:
      e.state = { name: "idle" };
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
  const wanted = TERRAIN_FOR[resource];
  if (wanted === null) return null;
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

/**
 * Ask for a new path, at most every so often.
 *
 * Returns "unreachable" when A* produced nothing, which every caller must treat
 * as a reason to give up — standing still waiting for a path that will never
 * exist is the freeze this codebase has now hit five times.
 */
export function repath(
  world: World,
  e: Entity,
  tx: number,
  ty: number,
  target?: Entity,
  reach = 1.0,
): "ok" | "cooldown" | "unreachable" {
  if ((e.repathAt ?? 0) > world.time) return "cooldown";
  e.repathAt = world.time + 0.6;
  e.path = target
    ? pathTo(world, e, target, reach)
    : findPath(world.map, e.x, e.y, tx, ty, buildingBlocker(world));
  return e.path.length > 0 ? "ok" : "unreachable";
}

/** Distinct tiles of a resource near a point, nearest first. */
export function resourceTilesNear(
  map: GameMap,
  resource: Resource,
  fromX: number,
  fromY: number,
  count: number,
  maxRadius = 10,
): { x: number; y: number }[] {
  const wanted = TERRAIN_FOR[resource];
  const found: { x: number; y: number }[] = [];
  if (wanted === null) return found;
  const cx = Math.round(fromX);
  const cy = Math.round(fromY);
  for (let r = 0; r < maxRadius && found.length < count; r++) {
    for (let dy = -r; dy <= r && found.length < count; dy++) {
      for (let dx = -r; dx <= r && found.length < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!inBounds(map, x, y)) continue;
        if (terrainAt(map, x, y) === wanted && map.amount[idx(map, x, y)] > 0) {
          found.push({ x, y });
        }
      }
    }
  }
  return found;
}

export function resourceAt(map: GameMap, x: number, y: number): Resource | null {
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (!inBounds(map, tx, ty) || map.amount[idx(map, tx, ty)] <= 0) return null;
  return RESOURCE_OF[terrainAt(map, tx, ty)] ?? null;
}

export function setRally(building: Entity, x: number, y: number) {
  if (!isBuilding(building.kind)) return;
  building.rally = { x, y };
}

/**
 * New units head for the rally point — and a rally point on a resource means
 * "go and work it", which is what makes rallying villagers worth doing.
 */
function sendToRally(world: World, unit: Entity, rally: { x: number; y: number }) {
  const resource = resourceAt(world.map, rally.x, rally.y);
  if (resource && unit.kind === "villager") {
    const tile = nearestResourceTile(world.map, resource, rally.x, rally.y, 6) ?? {
      x: Math.round(rally.x),
      y: Math.round(rally.y),
    };
    commandGather(world, unit, tile.x, tile.y);
    return;
  }
  commandMove(world, unit, rally.x, rally.y);
}

/** Remove a queued unit and give its cost back. */
export function cancelTraining(world: World, building: Entity, index: number): boolean {
  const item = building.queue?.[index];
  if (!item) return false;
  building.queue!.splice(index, 1);
  refund(world, building.owner, UNITS[item.kind].cost);
  return true;
}

/**
 * Ring the alarm: every villager runs for the nearest defended building.
 *
 * Returns how many villagers responded. Their work tile is kept, so
 * `backToWork` can send them straight back once the raid is over.
 */
export function soundAlarm(world: World, owner: Owner, near?: { x: number; y: number }, radius = Infinity): number {
  // Buildings only. `isArmed` is true for every unit, and the first version
  // used it alone — so each villager "fled" to the nearest villager, usually
  // itself, and the alarm silently did nothing.
  const shelters = [...world.entities.values()].filter(
    (e) => e.owner === owner && isBuilding(e.kind) && (e.progress ?? 1) === 1 && isArmed(e.kind),
  );
  if (shelters.length === 0) return 0;
  let count = 0;
  for (const v of world.entities.values()) {
    if (v.owner !== owner || v.kind !== "villager") continue;
    if (near && Math.hypot(v.x - near.x, v.y - near.y) > radius) continue;
    let best = shelters[0];
    for (const s of shelters) {
      if (distanceTo(s, v.x, v.y) < distanceTo(best, v.x, v.y)) best = s;
    }
    if (v.state?.name === "gathering") v.workTile = { x: v.state.tileX, y: v.state.tileY };
    commandMove(world, v, best.x, best.y);
    count++;
  }
  return count;
}

/** Send idle villagers back to whatever they were gathering before the alarm. */
export function backToWork(world: World, owner: Owner): number {
  let count = 0;
  for (const v of world.entities.values()) {
    if (v.owner !== owner || v.kind !== "villager" || v.state?.name !== "idle") continue;
    const tile = v.workTile;
    if (!tile || !resourceAt(world.map, tile.x, tile.y)) continue;
    commandGather(world, v, tile.x, tile.y);
    count++;
  }
  return count;
}

export function commandPatrol(world: World, e: Entity, bx: number, by: number) {
  if (!isUnit(e.kind)) return;
  e.orders = [];
  applyState(world, e, { name: "patrol", ax: e.x, ay: e.y, bx, by, toB: true });
}

// ---------------------------------------------------------------- commands

export function commandMove(world: World, e: Entity, tx: number, ty: number) {
  if (!isUnit(e.kind)) return;
  e.orders = [];
  applyState(world, e, { name: "moving", tx, ty });
}

/**
 * Walk toward a point, engaging anything hostile encountered on the way.
 *
 * This is the command an army actually wants: a plain move order marches
 * troops past an enemy they are standing next to, which reads as the units
 * being broken rather than obedient.
 */
export function commandAttackMove(world: World, e: Entity, tx: number, ty: number) {
  if (!isUnit(e.kind)) return;
  e.orders = [];
  e.state = { name: "attackMove", tx, ty };
  e.path = findPath(world.map, e.x, e.y, tx, ty, buildingBlocker(world));
}

export function commandStop(e: Entity) {
  if (!isUnit(e.kind)) return;
  e.orders = [];
  e.path = [];
  e.state = { name: "idle" };
}

export function commandRepair(world: World, e: Entity, targetId: number) {
  if (e.kind !== "villager") return;
  const t = world.entities.get(targetId);
  if (!t || !isBuilding(t.kind)) return;
  e.state = { name: "repairing", targetId };
  e.path = pathTo(world, e, t, 1.0);
}

/** Append an order instead of replacing the current one (shift-click). */
export function queueOrder(world: World, e: Entity, state: UnitState) {
  if (!isUnit(e.kind)) return;
  if (!e.orders) e.orders = [];
  if (e.state?.name === "idle") applyState(world, e, state);
  else e.orders.push(state);
}

export function commandGather(world: World, e: Entity, tileX: number, tileY: number) {
  if (e.kind !== "villager") return;
  const t = terrainAt(world.map, tileX, tileY);
  const resource = RESOURCE_OF[t];
  if (!resource || world.map.amount[idx(world.map, tileX, tileY)] <= 0) return;
  e.state = { name: "gathering", tileX, tileY, resource };
  // Same test the gathering state uses to decide it has arrived, so the path
  // and the arrival check can never disagree.
  e.path = findPath(world.map, e.x, e.y, tileX, tileY, buildingBlocker(world), (x, y) =>
    Math.max(Math.abs(x - tileX), Math.abs(y - tileY)) <= 1,
  );
}

/** A path that ends within `reach` of an entity's edge. */
export function pathTo(world: World, e: Entity, target: Entity, reach: number) {
  return findPath(world.map, e.x, e.y, target.x, target.y, buildingBlocker(world), (x, y) =>
    distanceTo(target, x, y) <= reach,
  );
}

export function commandAttack(world: World, e: Entity, targetId: number) {
  if (!isUnit(e.kind)) return;
  e.state = { name: "attacking", targetId };
  const t = world.entities.get(targetId);
  if (t) e.path = pathTo(world, e, t, attackReach(e));
}

/** How close a path needs to get before an attacker can swing or shoot. */
function attackReach(e: Entity): number {
  return Math.max(0.8, attackRangeOf(e.kind) - 0.4);
}

export function commandBuild(world: World, e: Entity, targetId: number) {
  if (e.kind !== "villager") return;
  const t = world.entities.get(targetId);
  if (!t) return;
  e.state = { name: "building", targetId };
  e.path = pathTo(world, e, t, 1.0);
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

  pendingHits = [];
  for (const e of [...world.entities.values()]) {
    if (isBuilding(e.kind)) tickBuilding(world, e, dt);
    else tickUnit(world, e, dt);
  }
  // Every swing this tick lands together; see resolveHits.
  resolveHits(world);

  separate(world);
  recomputePop(world);
  updateVision(world);
  world.effects = world.effects.filter((fx) => world.time - fx.t < fx.life);
  checkOutcome(world);
}

function tickBuilding(world: World, e: Entity, dt: number) {
  const spec = BUILDINGS[e.kind as BuildingKind];

  if (spec.foodPerSecond && e.progress === 1) {
    world.players[e.owner].food += spec.foodPerSecond * dt;
  }

  // Defensive buildings engage on their own — a tower that needed orders
  // would be a worse house.
  if (e.progress === 1 && isArmed(e.kind)) {
    e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);
    const foe = nearestEnemy(world, e, attackRangeOf(e.kind));
    if (foe && e.attackCd === 0) {
      e.attackCd = attackSpeedOf(e.kind);
      // One arrow, plus one for every villager sheltering beside it — up to
      // five. That is what gives the alarm teeth: a town centre with its
      // workers pulled in is a real defence rather than a slow death.
      const arrows = 1 + Math.min(5, shelteredAt(world, e));
      const foes = enemiesInRange(world, e, attackRangeOf(e.kind)).slice(0, arrows);
      for (let i = 0; i < arrows; i++) strike(world, e, foes[i % foes.length] ?? foe);
    }
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
  world.stats[e.owner].unitsTrained++;
  if (e.rally) sendToRally(world, unit, e.rally);
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

/** Intermediate waypoints count as reached within this distance. */
const WAYPOINT_SLACK = 0.45;

/**
 * Advance along the current path. Returns true when the path is used up.
 *
 * Intermediate waypoints only need to be *approached*, not touched. Requiring
 * an exact hit meant four units sharing one waypoint in a narrow pass each
 * crept 0.07 tiles toward it per tick while separation pushed them 0.27 away —
 * they jittered on the spot for good.
 */
function stepAlongPath(world: World, e: Entity, speed: number, dt: number): boolean {
  if (!e.path || e.path.length === 0) return true;
  let budget = speed * dt;
  while (budget > 0 && e.path.length > 0) {
    const next = e.path[0];
    const dx = next.x - e.x;
    const dy = next.y - e.y;
    const d = Math.hypot(dx, dy);
    if (e.path.length > 1 && d <= WAYPOINT_SLACK) {
      e.path.shift();
      continue;
    }
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

/** Per-unit progress tracking for the stuck detector. */
const progress = new WeakMap<Entity, { path: unknown; best: number; since: number }>();

/**
 * Follow a path to a destination, and notice when that has stopped working.
 *
 * "arrived" also covers being close enough to the destination; "stuck" means
 * no real progress for three seconds. Every freeze this codebase has had was
 * a unit waiting for something that would never happen, and each was fixed
 * individually. This is the general backstop: a unit that has stopped getting
 * closer stops trying.
 */
function followPath(
  world: World,
  e: Entity,
  tx: number,
  ty: number,
  speed: number,
  dt: number,
): "moving" | "arrived" | "stuck" {
  const done = stepAlongPath(world, e, speed, dt);
  const remaining = Math.hypot(tx - e.x, ty - e.y);
  if (done || remaining < 0.3) {
    // Clear what's left, or separation still treats the unit as travelling
    // and it never steps aside for anyone.
    e.path = [];
    return "arrived";
  }

  let p = progress.get(e);
  if (!p || p.path !== e.path) {
    p = { path: e.path, best: remaining, since: world.time };
    progress.set(e, p);
  }
  if (remaining < p.best - 0.1) {
    p.best = remaining;
    p.since = world.time;
  } else if (world.time - p.since > 3) {
    progress.delete(e);
    e.path = [];
    return "stuck";
  }
  return "moving";
}

/**
 * End a path at the exact point asked for, not the tile it rounds to.
 *
 * A formation's slots are under a tile apart, so two of them can round to the
 * same tile — and then two units share one final waypoint and only one of them
 * can ever stand on it.
 */
export function finishAt(world: World, path: { x: number; y: number }[], tx: number, ty: number) {
  if (!passable(world.map, Math.round(tx), Math.round(ty))) return path;
  if (buildingBlocker(world).has(Math.round(tx), Math.round(ty))) return path;
  const last = path[path.length - 1];
  if (last && last.x === Math.round(tx) && last.y === Math.round(ty)) {
    path[path.length - 1] = { x: tx, y: ty };
  } else if (path.length > 0 || Math.hypot(tx - Math.round(tx), ty - Math.round(ty)) > 0) {
    path.push({ x: tx, y: ty });
  }
  return path;
}

function tickUnit(world: World, e: Entity, dt: number) {
  const spec = UNITS[e.kind as UnitKind];
  e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);
  e.gatherCd = Math.max(0, (e.gatherCd ?? 0) - dt);

  const state = e.state ?? { name: "idle" };

  switch (state.name) {
    case "idle":
      if (e.orders?.length) {
        nextOrder(world, e);
        break;
      }
      autoAcquire(world, e, spec.sight);
      break;

    case "moving":
      if (followPath(world, e, state.tx, state.ty, Math.min(spec.speed, state.speed ?? Infinity), dt) !== "moving") {
        nextOrder(world, e);
      }
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
        if (arrived) {
          if ((e.repathAt ?? 0) > world.time) break;
          e.repathAt = world.time + 0.4;
          // Path spent and still not beside the tile. Usually that's another
          // villager standing in the only free spot, not an unreachable
          // resource. Measured in play: one of four villagers on a forage
          // patch went idle within thirty seconds exactly this way. So try
          // again, then try a different tile in the patch, and only give up
          // after repeated failures.
          e.gatherRetries = (e.gatherRetries ?? 0) + 1;
          const same = (t: { x: number; y: number }) => t.x === state.tileX && t.y === state.tileY;
          const tiles = resourceTilesNear(world.map, state.resource, e.x, e.y, 8, 12);
          const pick = e.gatherRetries <= 1
            ? tiles.find(same) ?? tiles[0]
            : tiles[(e.gatherRetries - 1) % Math.max(1, tiles.length)];
          if (pick && e.gatherRetries <= 6) {
            commandGather(world, e, pick.x, pick.y);
          } else {
            e.gatherRetries = 0;
            e.state = { name: "idle" };
          }
        }
        break;
      }
      e.gatherRetries = 0;
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
        world.terrainVersion++;
      }
      if (e.carrying.amount >= CARRY_CAPACITY) {
        const drop = nearestDropOff(world, e);
        if (drop) {
          e.state = { name: "returning", resource: state.resource };
          e.path = pathTo(world, e, drop, 1.0);
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
        if (!e.path?.length && repath(world, e, drop.x, drop.y, drop) === "unreachable") {
          // Nowhere to deliver. Keep the load and stop, rather than recomputing
          // an impossible path thirty times a second.
          e.state = { name: "idle" };
          break;
        }
        stepAlongPath(world, e, spec.speed, dt);
        break;
      }
      if (e.carrying) {
        world.players[e.owner][e.carrying.resource] += e.carrying.amount;
        world.stats[e.owner].gathered[e.carrying.resource] += e.carrying.amount;
        emit(world, {
          kind: "deposit",
          x: drop.x,
          y: drop.y,
          t: world.time,
          life: 1.1,
          owner: e.owner,
          text: `+${e.carrying.amount}`,
          resource: e.carrying.resource,
        });
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
        nextOrder(world, e);
        break;
      }
      if (distanceTo(target, e.x, e.y) > 1.2) {
        // Same failure mode as gathering: if the path runs out and we are
        // still short, standing here achieves nothing and the site is never
        // finished. Give up so whoever issued the order can reassign.
        if (stepAlongPath(world, e, spec.speed, dt) && distanceTo(target, e.x, e.y) > 1.2) {
          nextOrder(world, e);
        }
        break;
      }
      e.path = [];
      const spec2 = BUILDINGS[target.kind as BuildingKind];
      target.progress = Math.min(1, (target.progress ?? 0) + dt / spec2.buildTime);
      target.hp = spec2.hp * (0.15 + 0.85 * target.progress);
      if (target.progress >= 1) {
        target.hp = spec2.hp;
        world.stats[target.owner].buildingsBuilt++;
        emit(world, {
          kind: "complete",
          x: target.x,
          y: target.y,
          t: world.time,
          life: 1.2,
          owner: target.owner,
        });
        nextOrder(world, e);
      }
      break;
    }

    case "attacking": {
      const target = world.entities.get(state.targetId);
      if (!target) {
        nextOrder(world, e);
        break;
      }
      const reach = attackRangeOf(e.kind);
      const d = distanceTo(target, e.x, e.y);
      if (d > reach) {
        if (!e.path?.length && repath(world, e, target.x, target.y, target, attackReach(e)) === "unreachable") {
          nextOrder(world, e);
          break;
        }
        stepAlongPath(world, e, spec.speed, dt);
        break;
      }
      e.path = [];
      if (e.attackCd! > 0) break;
      e.attackCd = spec.attackSpeed;
      strike(world, e, target);
      break;
    }

    case "repairing": {
      const target = world.entities.get(state.targetId);
      if (!target || !isBuilding(target.kind)) {
        nextOrder(world, e);
        break;
      }
      const full = maxHp(target.kind);
      if (target.hp >= full) {
        nextOrder(world, e);
        break;
      }
      if (distanceTo(target, e.x, e.y) > 1.2) {
        if (!e.path?.length && repath(world, e, target.x, target.y, target) === "unreachable") {
          nextOrder(world, e);
          break;
        }
        if (stepAlongPath(world, e, spec.speed, dt) && distanceTo(target, e.x, e.y) > 1.2) {
          nextOrder(world, e);
        }
        break;
      }
      e.path = [];
      const rate = full / BUILDINGS[target.kind as BuildingKind].buildTime;
      target.hp = Math.min(full, target.hp + rate * REPAIR_RATE * dt);
      break;
    }

    case "attackMove": {
      // Engage anything hostile within sight; otherwise keep marching.
      const foe = nearestEnemy(world, e, spec.sight);
      if (foe) {
        // Remember the destination so the unit resumes after the fight.
        e.orders = [{ name: "attackMove", tx: state.tx, ty: state.ty }, ...(e.orders ?? [])];
        commandAttackKeepQueue(world, e, foe.id);
        break;
      }
      if (followPath(world, e, state.tx, state.ty, Math.min(spec.speed, state.speed ?? Infinity), dt) !== "moving") {
        nextOrder(world, e);
      }
      break;
    }

    case "patrol": {
      const foe = nearestEnemy(world, e, spec.sight);
      if (foe) {
        e.orders = [{ ...state }, ...(e.orders ?? [])];
        commandAttackKeepQueue(world, e, foe.id);
        break;
      }
      const legX = state.toB ? state.bx : state.ax;
      const legY = state.toB ? state.by : state.ay;
      if (followPath(world, e, legX, legY, spec.speed, dt) !== "moving") {
        // Turn round at each end. A leg that can't be walked at all still
        // flips, so a blocked patrol oscillates visibly instead of freezing.
        applyState(world, e, { ...state, toB: !state.toB });
      }
      break;
    }
  }
}

/**
 * Swings taken this tick, resolved together once every entity has acted.
 *
 * Resolving each hit the moment it's thrown means whoever is processed first
 * on the deciding tick kills the other before it can swing back. Measured
 * with mirror duels, that decided the fight 23 times in 24 — first for player
 * 0, and, after merely alternating the processing order, for whoever happened
 * to land on the right parity. Simultaneous resolution removes the order from
 * the outcome entirely: a unit that dies this tick still gets its swing.
 */
let pendingHits: { attacker: Entity; target: Entity }[] = [];

/**
 * Throw one attack. Damage lands at the end of the tick.
 *
 * Ranged attackers emit a projectile the renderer animates; the damage itself
 * never waits on the animation, so the simulation stays deterministic and
 * independent of whether anything is drawing.
 */
function strike(world: World, attacker: Entity, target: Entity) {
  if (attackRangeOf(attacker.kind) > 2) {
    emit(world, {
      kind: "projectile",
      x: attacker.x,
      y: attacker.y,
      tx: target.x,
      ty: target.y,
      t: world.time,
      life: 0.28,
      owner: attacker.owner,
    });
  }
  pendingHits.push({ attacker, target });
}

function resolveHits(world: World) {
  const hits = pendingHits;
  pendingHits = [];
  const killer = new Map<number, Entity>();

  for (const { attacker, target } of hits) {
    if (!world.entities.has(target.id)) continue;
    target.hp -= damageFrom(attacker.kind, target.kind);
    killer.set(target.id, attacker);
    emit(world, {
      kind: "impact",
      x: target.x,
      y: target.y,
      t: world.time,
      life: 0.22,
      owner: target.owner,
      targetKind: target.kind,
    });
  }

  for (const [id, by] of killer) {
    const target = world.entities.get(id);
    if (!target || target.hp > 0) continue;
    emit(world, {
      kind: "death",
      x: target.x,
      y: target.y,
      t: world.time,
      life: 0.6,
      owner: target.owner,
    });
    removeEntity(world, target, by);
  }
}

/** Attack without clearing the order queue, so attack-move can resume. */
function commandAttackKeepQueue(world: World, e: Entity, targetId: number) {
  e.state = { name: "attacking", targetId };
  const t = world.entities.get(targetId);
  if (t) e.path = pathTo(world, e, t, attackReach(e));
}

/** Closest hostile entity within `range`, measured to its edge. */
export function nearestEnemy(world: World, e: Entity, range: number): Entity | null {
  let best: Entity | null = null;
  let bestD = range;
  for (const other of world.entities.values()) {
    if (other.owner === e.owner) continue;
    const d = distanceTo(other, e.x, e.y);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

function shelteredAt(world: World, b: Entity): number {
  let n = 0;
  for (const v of world.entities.values()) {
    if (v.owner !== b.owner || v.kind !== "villager" || v.state?.name !== "idle") continue;
    if (distanceTo(b, v.x, v.y) <= 1.3) n++;
  }
  return n;
}

function enemiesInRange(world: World, e: Entity, range: number): Entity[] {
  return [...world.entities.values()]
    .filter((o) => o.owner !== e.owner && distanceTo(o, e.x, e.y) <= range)
    .sort((a, b) => distanceTo(a, e.x, e.y) - distanceTo(b, e.x, e.y));
}

/**
 * Idle military units defend themselves rather than being shot at passively.
 *
 * Villagers and scouts are excluded: a villager that charges a raiding party
 * is a villager you have lost, and a scout that stops to fight stops scouting.
 */
function autoAcquire(world: World, e: Entity, range: number) {
  if (e.kind === "villager" || e.kind === "scout") return;
  const foe = nearestEnemy(world, e, Math.max(range, 5));
  if (foe) e.state = { name: "attacking", targetId: foe.id };
}

/**
 * Push overlapping units apart.
 *
 * Without this, a group given one move order converges on an identical point
 * and stacks into what looks like a single unit.
 */
function separate(world: World) {
  const units = [...world.entities.values()].filter((e) => isUnit(e.kind));
  const busy = (e: Entity) => (e.path?.length ?? 0) > 0;
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i];
      const b = units[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= SEPARATION || d === 0) continue;
      const overlap = SEPARATION - d;
      const nx = dx / d;
      const ny = dy / d;
      // A unit on its way somewhere shouldn't be shoved back by one standing
      // still; the idle one steps aside. Two of a kind share the push. The
      // push is also softer than a full overlap correction, so a unit moving
      // through a crowd still makes headway.
      const aShare = busy(a) === busy(b) ? 0.35 : busy(a) ? 0.1 : 0.6;
      const bShare = busy(a) === busy(b) ? 0.35 : busy(b) ? 0.1 : 0.6;
      const ax = a.x - nx * overlap * aShare;
      const ay = a.y - ny * overlap * aShare;
      const bx = b.x + nx * overlap * bShare;
      const by = b.y + ny * overlap * bShare;
      if (passable(world.map, Math.round(ax), Math.round(ay))) {
        a.x = ax;
        a.y = ay;
      }
      if (passable(world.map, Math.round(bx), Math.round(by))) {
        b.x = bx;
        b.y = by;
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

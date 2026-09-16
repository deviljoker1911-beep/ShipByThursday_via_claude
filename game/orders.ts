import { BUILDINGS, UNITS, isBuilding, isUnit, maxHp } from "./config.ts";
import { canSee, knownEnemyBuildings, tileExplored } from "./fog.ts";
import { commandGroup } from "./formation.ts";
import {
  applyState,
  commandAttack,
  commandBuild,
  commandGather,
  commandPatrol,
  commandRepair,
  entityAt,
  occupiesTile,
  queueOrder,
  resourceAt,
  resourceTilesNear,
  setRally,
} from "./world.ts";
import type { BuildingKind, Entity, Formation, Owner, UnitState, World } from "./types.ts";

/**
 * Turning a click into an order.
 *
 * Kept out of the React layer on purpose: "what does right-clicking this
 * mean for this selection?" is game logic, and it deserves the same headless
 * tests as the rules. The input layer only has to say where the click landed.
 */

export type ClickTarget =
  | { kind: "entity"; entity: Entity }
  /** A remembered enemy building the player can't currently see. */
  | { kind: "ghost"; x: number; y: number }
  | { kind: "resource"; x: number; y: number }
  | { kind: "ground"; x: number; y: number };

/**
 * What is under the cursor, as far as this player is allowed to know.
 *
 * Enemies in fog are not targetable — clicking where you think an army is
 * should not reveal whether it's there.
 */
export function resolveTarget(world: World, owner: Owner, x: number, y: number): ClickTarget {
  const hit = entityAt(world, x, y);
  if (hit && canSee(world, owner, hit)) return { kind: "entity", entity: hit };

  const tx = Math.round(x);
  const ty = Math.round(y);
  for (const ghost of knownEnemyBuildings(world, owner)) {
    const size = BUILDINGS[ghost.kind].size;
    const x0 = Math.round(ghost.x - (size - 1) / 2);
    const y0 = Math.round(ghost.y - (size - 1) / 2);
    if (tx >= x0 && ty >= y0 && tx < x0 + size && ty < y0 + size) {
      return { kind: "ghost", x: ghost.x, y: ghost.y };
    }
  }

  if (tileExplored(world, owner, x, y) && resourceAt(world.map, x, y)) {
    return { kind: "resource", x: tx, y: ty };
  }
  return { kind: "ground", x, y };
}

export type OrderKind = "move" | "attack" | "gather" | "build" | "rally";

export interface OrderOptions {
  formation: Formation;
  /** Shift held: append instead of replace. */
  queue: boolean;
  /** An explicit command mode (attack-move, patrol) overrides the context. */
  mode?: "attackMove" | "patrol";
}

/**
 * Issue the order a right-click (or a tap, on touch) means.
 *
 * Returns what kind of order it turned out to be, so the input layer can show
 * the matching confirmation marker — or null if nothing sensible applied.
 */
export function issueContextOrder(
  world: World,
  owner: Owner,
  selectedIds: Iterable<number>,
  target: ClickTarget,
  opts: OrderOptions,
): { order: OrderKind; x: number; y: number } | null {
  const selected = [...selectedIds]
    .map((id) => world.entities.get(id))
    .filter((e): e is Entity => !!e && e.owner === owner);
  const units = selected.filter((e) => isUnit(e.kind));
  const buildings = selected.filter((e) => isBuilding(e.kind));

  const at = target.kind === "entity" ? { x: target.entity.x, y: target.entity.y } : target;

  // A building on its own: right-click sets where its units go.
  if (units.length === 0) {
    if (buildings.length === 0) return null;
    for (const b of buildings) setRally(b, at.x, at.y);
    return { order: "rally", x: at.x, y: at.y };
  }

  if (opts.mode === "patrol") {
    for (const u of units) commandPatrol(world, u, at.x, at.y);
    return { order: "attack", x: at.x, y: at.y };
  }

  if (opts.mode === "attackMove") {
    commandGroup(world, units, { tx: at.x, ty: at.y, formation: opts.formation, attack: true, queue: opts.queue });
    return { order: "attack", x: at.x, y: at.y };
  }

  switch (target.kind) {
    case "entity": {
      const e = target.entity;
      if (e.owner !== owner) {
        for (const u of units) {
          if (opts.queue) queueOrder(world, u, { name: "attacking", targetId: e.id });
          else commandAttack(world, u, e.id);
        }
        return { order: "attack", x: e.x, y: e.y };
      }
      if (isBuilding(e.kind)) return orderOnOwnBuilding(world, units, e, opts);
      // Right-clicking one of your own units: go to it.
      commandGroup(world, units, { tx: e.x, ty: e.y, formation: opts.formation, attack: false, queue: opts.queue });
      return { order: "move", x: e.x, y: e.y };
    }

    case "ghost":
      commandGroup(world, units, { tx: target.x, ty: target.y, formation: opts.formation, attack: true, queue: opts.queue });
      return { order: "attack", x: target.x, y: target.y };

    case "resource": {
      const villagers = units.filter((u) => u.kind === "villager");
      const others = units.filter((u) => u.kind !== "villager");
      if (villagers.length) gatherSpread(world, villagers, target.x, target.y, opts.queue);
      if (others.length) {
        commandGroup(world, others, { tx: target.x, ty: target.y, formation: opts.formation, attack: false, queue: opts.queue });
      }
      return { order: villagers.length ? "gather" : "move", x: target.x, y: target.y };
    }

    case "ground":
      commandGroup(world, units, { tx: target.x, ty: target.y, formation: opts.formation, attack: false, queue: opts.queue });
      return { order: "move", x: target.x, y: target.y };
  }
}

function orderOnOwnBuilding(
  world: World,
  units: Entity[],
  b: Entity,
  opts: OrderOptions,
): { order: OrderKind; x: number; y: number } {
  const villagers = units.filter((u) => u.kind === "villager");
  const others = units.filter((u) => u.kind !== "villager");
  const unfinished = (b.progress ?? 1) < 1;
  const damaged = b.hp < maxHp(b.kind);
  const dropOff = BUILDINGS[b.kind as BuildingKind].dropOff === true;

  for (const v of villagers) {
    if (unfinished) {
      if (opts.queue) queueOrder(world, v, { name: "building", targetId: b.id });
      else commandBuild(world, v, b.id);
    } else if (damaged) {
      if (opts.queue) queueOrder(world, v, { name: "repairing", targetId: b.id });
      else commandRepair(world, v, b.id);
    } else if (dropOff && v.carrying) {
      // Bank what it's holding, then go back to work.
      v.orders = [];
      applyState(world, v, { name: "moving", tx: b.x, ty: b.y });
      v.state = { name: "returning", resource: v.carrying.resource };
    } else {
      const s: UnitState = { name: "moving", tx: b.x, ty: b.y };
      if (opts.queue) queueOrder(world, v, s);
      else applyState(world, v, s);
    }
  }
  if (others.length) {
    commandGroup(world, others, { tx: b.x, ty: b.y, formation: opts.formation, attack: false, queue: opts.queue });
  }
  return {
    order: villagers.length && (unfinished || damaged) ? "build" : "move",
    x: b.x,
    y: b.y,
  };
}

/**
 * Put a group of villagers to work on a resource patch, one tile each.
 *
 * Sending ten villagers to the single tile that was clicked makes nine of
 * them queue behind the first. Spreading them over the patch is what a player
 * meant.
 */
function gatherSpread(world: World, villagers: Entity[], x: number, y: number, queue: boolean) {
  const resource = resourceAt(world.map, x, y);
  if (!resource) return;
  const tiles = resourceTilesNear(world.map, resource, x, y, villagers.length);
  if (tiles.length === 0) return;
  villagers.forEach((v, i) => {
    const tile = tiles[i % tiles.length];
    if (queue) {
      queueOrder(world, v, { name: "gathering", tileX: tile.x, tileY: tile.y, resource });
    } else {
      v.orders = [];
      commandGather(world, v, tile.x, tile.y);
    }
  });
}

/** For hover feedback: what would a right-click here do? */
export function previewOrder(
  world: World,
  owner: Owner,
  selectedIds: Iterable<number>,
  target: ClickTarget,
): OrderKind | null {
  const selected = [...selectedIds]
    .map((id) => world.entities.get(id))
    .filter((e): e is Entity => !!e && e.owner === owner);
  if (selected.length === 0) return null;
  const hasUnits = selected.some((e) => isUnit(e.kind));
  const hasVillagers = selected.some((e) => e.kind === "villager");
  if (!hasUnits) return "rally";

  switch (target.kind) {
    case "entity":
      if (target.entity.owner !== owner) return "attack";
      if (isBuilding(target.entity.kind)) {
        const e = target.entity;
        if (hasVillagers && ((e.progress ?? 1) < 1 || e.hp < maxHp(e.kind))) return "build";
      }
      return "move";
    case "ghost":
      return "attack";
    case "resource":
      return hasVillagers ? "gather" : "move";
    case "ground":
      return "move";
  }
}

/** True if the tile is covered by one of the player's own buildings. */
export function ownBuildingAt(world: World, owner: Owner, x: number, y: number): Entity | null {
  for (const e of world.entities.values()) {
    if (e.owner === owner && isBuilding(e.kind) && occupiesTile(e, Math.round(x), Math.round(y))) {
      return e;
    }
  }
  return null;
}

/** Everything the player owns of one kind, for double-click selection. */
export function allOfKind(world: World, owner: Owner, kind: string): Entity[] {
  return [...world.entities.values()].filter((e) => e.owner === owner && e.kind === kind);
}

export function unitLabel(kind: string): string {
  if (kind in UNITS) return UNITS[kind as keyof typeof UNITS].name;
  if (kind in BUILDINGS) return BUILDINGS[kind as BuildingKind].name;
  return kind;
}

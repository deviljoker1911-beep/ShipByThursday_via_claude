import { BUILDINGS, isBuilding, sightOf } from "./config.ts";
import { idx, inBounds } from "./map.ts";
import type { BuildingKind, Entity, Ghost, Owner, World } from "./types.ts";

/**
 * Fog of war.
 *
 * Three states per tile, per player: never seen, seen before, in sight now.
 * Enemy units are only known while in sight; enemy buildings leave a ghost —
 * their last-seen state — once they drop out of it.
 *
 * This is part of the simulation, not the renderer. The AI plans from it, and
 * what a player may target depends on it, so it has to be deterministic and
 * testable headlessly like everything else.
 */

/** Recomputing vision every tick is wasted work; five times a second is plenty. */
export const VISION_INTERVAL = 0.2;

/** Offsets within a disc, cached per radius (in half-tile steps). */
const discs = new Map<number, Int16Array>();

function disc(radius: number): Int16Array {
  const key = Math.round(radius * 2);
  let cached = discs.get(key);
  if (cached) return cached;
  const r = key / 2;
  const out: number[] = [];
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy <= r * r) out.push(dx, dy);
    }
  }
  cached = Int16Array.from(out);
  discs.set(key, cached);
  return cached;
}

function stamp(world: World, owner: Owner, cx: number, cy: number, radius: number) {
  const v = world.vision[owner];
  const map = world.map;
  const offsets = disc(radius);
  for (let i = 0; i < offsets.length; i += 2) {
    const x = cx + offsets[i];
    const y = cy + offsets[i + 1];
    if (!inBounds(map, x, y)) continue;
    const k = idx(map, x, y);
    v.visible[k] = 1;
    v.explored[k] = 1;
  }
}

/** Sight is reduced while a building is still a foundation. */
function effectiveSight(e: Entity): number {
  const base = sightOf(e.kind);
  return isBuilding(e.kind) && (e.progress ?? 1) < 1 ? Math.min(base, 4) : base;
}

export function updateVision(world: World, force = false) {
  for (const owner of [0, 1] as Owner[]) {
    const v = world.vision[owner];
    if (!force && world.time < v.nextUpdate) continue;
    v.nextUpdate = world.time + VISION_INTERVAL;
    v.visible.fill(0);

    // A dozen villagers on one tile would stamp the same disc a dozen times.
    const stamped = new Set<number>();
    for (const e of world.entities.values()) {
      if (e.owner !== owner) continue;
      const cx = Math.round(e.x);
      const cy = Math.round(e.y);
      const sight = effectiveSight(e);
      const key = (cy * world.map.width + cx) * 64 + Math.round(sight * 2);
      if (stamped.has(key)) continue;
      stamped.add(key);
      stamp(world, owner, cx, cy, sight);
    }

    refreshGhosts(world, owner);
  }
}

function refreshGhosts(world: World, owner: Owner) {
  const v = world.vision[owner];

  // Record what is visible now.
  for (const e of world.entities.values()) {
    if (e.owner === owner || !isBuilding(e.kind)) continue;
    if (!buildingVisible(world, owner, e)) continue;
    v.ghosts.set(e.id, {
      id: e.id,
      kind: e.kind as BuildingKind,
      owner: e.owner,
      x: e.x,
      y: e.y,
      progress: e.progress ?? 1,
    });
  }

  // Forget ghosts whose spot is in sight but whose building is gone. Until
  // someone looks, a destroyed building stays on the map as it was last seen —
  // that is the point of fog, and what makes scouting worth doing.
  for (const [id, ghost] of v.ghosts) {
    if (world.entities.has(id)) continue;
    if (tileVisible(world, owner, ghost.x, ghost.y)) v.ghosts.delete(id);
  }
}

export function tileVisible(world: World, owner: Owner, x: number, y: number): boolean {
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (!inBounds(world.map, tx, ty)) return false;
  return world.vision[owner].visible[idx(world.map, tx, ty)] === 1;
}

export function tileExplored(world: World, owner: Owner, x: number, y: number): boolean {
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (!inBounds(world.map, tx, ty)) return false;
  return world.vision[owner].explored[idx(world.map, tx, ty)] === 1;
}

function buildingVisible(world: World, owner: Owner, e: Entity): boolean {
  // Any tile of the footprint in sight counts; a big building half behind the
  // fog line is still plainly visible.
  const size = BUILDINGS[e.kind as BuildingKind].size;
  const x0 = Math.round(e.x - (size - 1) / 2);
  const y0 = Math.round(e.y - (size - 1) / 2);
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      if (tileVisible(world, owner, x, y)) return true;
    }
  }
  return false;
}

/** Whether `owner` can currently see this entity. Own entities always count. */
export function canSee(world: World, owner: Owner, e: Entity): boolean {
  if (e.owner === owner) return true;
  return isBuilding(e.kind) ? buildingVisible(world, owner, e) : tileVisible(world, owner, e.x, e.y);
}

/** Enemy entities `owner` can see right now. */
export function visibleEnemies(world: World, owner: Owner): Entity[] {
  const out: Entity[] = [];
  for (const e of world.entities.values()) {
    if (e.owner !== owner && canSee(world, owner, e)) out.push(e);
  }
  return out;
}

/** Enemy buildings `owner` knows about — seen now, or remembered. */
export function knownEnemyBuildings(world: World, owner: Owner): Ghost[] {
  return [...world.vision[owner].ghosts.values()];
}

/** Fraction of the map a player has ever seen. Used by the AI and the stats screen. */
export function exploredFraction(world: World, owner: Owner): number {
  const e = world.vision[owner].explored;
  let n = 0;
  for (let i = 0; i < e.length; i++) n += e[i];
  return n / e.length;
}

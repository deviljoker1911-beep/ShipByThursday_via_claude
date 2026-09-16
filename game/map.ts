import { TERRAIN_IDS, type GameMap, type Terrain } from "./types.ts";

/**
 * Map generation.
 *
 * Deterministic from a seed so a match can be reproduced — useful when a bug
 * only shows up on one layout. Resources are placed in clusters rather than
 * scattered, because scattered resources make villagers walk constantly and
 * the early game feel dead.
 */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const RESOURCE_AMOUNT: Partial<Record<Terrain, number>> = {
  forest: 120,
  gold: 260,
  stone: 200,
  forage: 150,
};

export function idx(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function terrainAt(map: GameMap, x: number, y: number): number {
  if (!inBounds(map, x, y)) return TERRAIN_IDS.water;
  return map.terrain[idx(map, x, y)];
}

/** Whether a unit can stand here. Buildings are tracked separately. */
export function passable(map: GameMap, x: number, y: number): boolean {
  const t = terrainAt(map, x, y);
  return t === TERRAIN_IDS.grass;
}

/**
 * Tiles that later terrain must not overwrite: the lanes and the start area.
 *
 * Order used to decide what survived — a lane carved after a gold deposit
 * simply erased it, which on some seeds left both starts with no gold at all.
 * Protecting the lanes and placing resources around them removes the ordering
 * problem entirely.
 */
let protectedTiles: Uint8Array | null = null;
/** The start clearing alone — never overwritten, even by guaranteed resources. */
let startTiles: Uint8Array | null = null;
/**
 * While set, every tile blob() places is claimed, so a later deposit can't
 * land on it. Guaranteed resources are placed in sequence, and without this
 * the forage placed after the gold would happily overwrite the gold.
 */
let claimPlaced = false;

function blob(
  map: GameMap,
  cx: number,
  cy: number,
  radius: number,
  terrain: Terrain,
  rand: () => number,
) {
  const id = TERRAIN_IDS[terrain];
  const amount = RESOURCE_AMOUNT[terrain] ?? 0;
  for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
      if (!inBounds(map, x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      // Fuzzy edge, so clusters don't read as perfect circles.
      if (d > radius * (0.72 + rand() * 0.45)) continue;
      if (protectedTiles?.[idx(map, x, y)]) continue;
      if (claimPlaced) {
        if (protectedTiles) protectedTiles[idx(map, x, y)] = 1;
        if (startTiles) startTiles[idx(map, x, y)] = 1;
      }
      map.terrain[idx(map, x, y)] = id;
      map.amount[idx(map, x, y)] = amount;
    }
  }
}

function clearArea(map: GameMap, cx: number, cy: number, r: number) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!inBounds(map, x, y)) continue;
      map.terrain[idx(map, x, y)] = TERRAIN_IDS.grass;
      map.amount[idx(map, x, y)] = 0;
      if (protectedTiles) protectedTiles[idx(map, x, y)] = 1;
      if (startTiles) startTiles[idx(map, x, y)] = 1;
    }
  }
}

export interface GeneratedMap {
  map: GameMap;
  /** Where each player's town centre goes. */
  starts: { x: number; y: number }[];
}


/**
 * Tiles reachable on foot from a point.
 *
 * Forests and water are impassable, and dense forest blobs will happily carve
 * the map into isolated pockets. A map whose two bases cannot reach each other
 * is not a hard map — no army can ever attack, and the match cannot end. This
 * is the check that catches it.
 */
export function reachableFrom(map: GameMap, sx: number, sy: number): Set<number> {
  const seen = new Set<number>();
  const start = idx(map, Math.round(sx), Math.round(sy));
  if (!passable(map, Math.round(sx), Math.round(sy))) return seen;
  const queue: number[] = [start];
  seen.add(start);
  while (queue.length) {
    const cur = queue.pop()!;
    const x = cur % map.width;
    const y = (cur - x) / map.width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(map, nx, ny) || !passable(map, nx, ny)) continue;
        const k = idx(map, nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push(k);
      }
    }
  }
  return seen;
}

export function isConnected(
  map: GameMap,
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return reachableFrom(map, a.x, a.y).has(idx(map, Math.round(b.x), Math.round(b.y)));
}

/**
 * Clear a walkable lane between two points.
 *
 * The jitter matters: a dead-straight corridor reads as a developer tool,
 * while a wandering one reads as a valley. Lanes of differing widths are also
 * what produce chokepoints — the narrow ones are worth defending, which is
 * geography creating a strategic decision rather than a menu doing it.
 */
function carveLane(
  map: GameMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
  rand: () => number,
) {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 1.5);
  let driftX = 0;
  let driftY = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Drift wanders slowly and is pulled back toward the line, so the lane
    // meanders without ever straying far enough to miss its destination.
    driftX = driftX * 0.94 + (rand() - 0.5) * 1.6;
    driftY = driftY * 0.94 + (rand() - 0.5) * 1.6;
    const cx = from.x + (to.x - from.x) * t + driftX;
    const cy = from.y + (to.y - from.y) * t + driftY;
    const r = width * (0.7 + rand() * 0.6);
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        // Never breach the border, or units walk off the edge of the world.
        if (x < 1 || y < 1 || x >= map.width - 1 || y >= map.height - 1) continue;
        if (Math.hypot(x - cx, y - cy) > r) continue;
        map.terrain[idx(map, x, y)] = TERRAIN_IDS.grass;
        map.amount[idx(map, x, y)] = 0;
        if (protectedTiles) protectedTiles[idx(map, x, y)] = 1;
      }
    }
  }
}

/**
 * Make the map point-symmetric by copying one half onto the other.
 *
 * Tile (x, y) mirrors to (W-1-x, H-1-y), which in row-major order is simply
 * index N-1-k. The top half is kept and rotated onto the bottom half.
 *
 * Fairness has to be structural. The first version mirrored only gold and
 * stone, while forests, forage and the "guaranteed" start resources were
 * placed independently — and the same offsets that pointed toward the centre
 * for one start pointed into the water border for the other.
 */
function mirror(map: GameMap) {
  const n = map.terrain.length;
  for (let k = 0; k < n / 2; k++) {
    map.terrain[n - 1 - k] = map.terrain[k];
    map.amount[n - 1 - k] = map.amount[k];
  }
}

/**
 * Protect every tile of a resource near a point.
 *
 * A guarantee can be met by a deposit that was already there, not only by one
 * placed for it — and an unclaimed deposit is still fair game for whatever is
 * placed next. That is how seed 10 lost its gold: satisfied by a random
 * deposit, then overwritten by the guaranteed forage.
 */
function claimNear(map: GameMap, at: { x: number; y: number }, terrain: Terrain, r: number) {
  const id = TERRAIN_IDS[terrain];
  for (let y = Math.floor(at.y - r); y <= at.y + r; y++) {
    for (let x = Math.floor(at.x - r); x <= at.x + r; x++) {
      if (!inBounds(map, x, y) || Math.hypot(x - at.x, y - at.y) > r) continue;
      const k = idx(map, x, y);
      if (map.terrain[k] !== id) continue;
      if (protectedTiles) protectedTiles[k] = 1;
      if (startTiles) startTiles[k] = 1;
    }
  }
}

function countNear(map: GameMap, at: { x: number; y: number }, terrain: Terrain, r: number): number {
  const id = TERRAIN_IDS[terrain];
  let n = 0;
  for (let y = Math.floor(at.y - r); y <= at.y + r; y++) {
    for (let x = Math.floor(at.x - r); x <= at.x + r; x++) {
      if (!inBounds(map, x, y) || Math.hypot(x - at.x, y - at.y) > r) continue;
      if (map.terrain[idx(map, x, y)] === id) n++;
    }
  }
  return n;
}

/** A straight corridor. Straight, so a corridor between mirrored points is itself symmetric. */
function carveStraight(
  map: GameMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
) {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = from.x + (to.x - from.x) * t;
    const cy = from.y + (to.y - from.y) * t;
    for (let y = Math.floor(cy - width); y <= cy + width; y++) {
      for (let x = Math.floor(cx - width); x <= cx + width; x++) {
        if (x < 1 || y < 1 || x >= map.width - 1 || y >= map.height - 1) continue;
        if (Math.hypot(x - cx, y - cy) > width) continue;
        map.terrain[idx(map, x, y)] = TERRAIN_IDS.grass;
        map.amount[idx(map, x, y)] = 0;
      }
    }
  }
}

export function generateMap(size = 56, seed = Date.now()): GeneratedMap {
  const rand = mulberry32(seed);
  const map: GameMap = {
    width: size,
    height: size,
    terrain: new Uint8Array(size * size),
    amount: new Uint16Array(size * size),
  };

  // Starts are exact mirror images of each other. Start 1 sits in the half
  // that is kept; start 0 is its reflection.
  const inset = Math.floor(size * 0.16);
  const kept = { x: size - 1 - inset, y: inset };
  const starts = [{ x: size - 1 - kept.x, y: size - 1 - kept.y }, kept];

  protectedTiles = new Uint8Array(size * size);
  startTiles = new Uint8Array(size * size);

  // Reserve the border before anything is placed. It is painted with water at
  // the end, and deposits that landed on it were silently erased then — after
  // the start-resource check had already counted them as present. One seed in
  // fifty ended with no stone near either base because of exactly that.
  for (let i = 0; i < size; i++) {
    for (const k of [idx(map, i, 0), idx(map, i, size - 1), idx(map, 0, i), idx(map, size - 1, i)]) {
      protectedTiles[k] = 1;
      startTiles[k] = 1;
    }
  }

  // Structure first: the start area and the lanes. Everything placed after
  // this flows around them.
  const s = kept;
  clearArea(map, s.x, s.y, 4);
  // Lanes to the centre and round both flanks. Mirroring completes each one
  // on the other side. The narrow flanks are worth defending and the centre
  // is worth contesting — geography creating decisions, authored by nobody.
  const mid = { x: (size - 1) / 2, y: (size - 1) / 2 };
  carveLane(map, kept, mid, 2.6, rand);
  carveLane(map, kept, { x: size * 0.25, y: size * 0.2 }, 1.5, rand);
  carveLane(map, { x: size * 0.25, y: size * 0.2 }, { x: size * 0.12, y: size * 0.45 }, 1.5, rand);
  carveLane(map, kept, { x: size * 0.85, y: size * 0.45 }, 1.5, rand);

  // Then the wild map. Only the top half matters; the bottom is overwritten
  // by its reflection.
  for (let i = 0; i < Math.floor(size * 0.22); i++) {
    blob(map, rand() * size, rand() * size, 1.3 + rand() * 1.4, "forage", rand);
  }
  for (let i = 0; i < Math.floor(size * 0.7); i++) {
    blob(map, rand() * size, rand() * size, 2 + rand() * 3.5, "forest", rand);
  }
  for (let i = 0; i < 5; i++) {
    blob(map, rand() * size, rand() * size * 0.5, 1.4 + rand(), "gold", rand);
  }
  for (let i = 0; i < 3; i++) {
    blob(map, rand() * size, rand() * size * 0.5, 1.3, "stone", rand);
  }
  // A lake for interest, off the centre line so it can't wall the map.
  blob(map, rand() * size * 0.3, rand() * size * 0.3, 2.5 + rand() * 2, "water", rand);

  // Guaranteed resources around the start — verified, not assumed. Each is
  // tried at successive angles until enough of it actually landed within
  // reach, because a start without trees or gold isn't a hard opening, it's
  // an unplayable one.
  const guaranteed: [Terrain, number, number][] = [
    ["forest", 2.6, 14],
    ["gold", 1.6, 5],
    ["forage", 1.8, 6],
    ["stone", 1.3, 3],
  ];
  // The backstop corridor, if it's ever needed, runs from this start straight
  // at the centre. Guaranteed resources keep out of that bearing so the
  // backstop can never erase them.
  const corridor = Math.atan2(mid.y - s.y, mid.x - s.x);
  const clearOfCorridor = (angle: number) => {
    const d = Math.abs(Math.atan2(Math.sin(angle - corridor), Math.cos(angle - corridor)));
    return d > 0.45;
  };

  const tryPlace = (terrain: Terrain, radius: number, minTiles: number) => {
    const base = rand() * Math.PI * 2;
    for (let a = 0; a < 16 && countNear(map, s, terrain, 9) < minTiles; a++) {
      const angle = base + (a * Math.PI * 2) / 16;
      if (!clearOfCorridor(angle)) continue;
      const dist = 5.2 + rand() * 1.6;
      const cx = s.x + Math.cos(angle) * dist;
      const cy = s.y + Math.sin(angle) * dist;
      // Stay inside the kept half, clear of the border.
      if (cy < 2 || cy > size / 2 - 3 || cx < 2 || cx > size - 3) continue;
      blob(map, cx, cy, radius, terrain, rand);
    }
  };

  claimPlaced = true;
  for (const [terrain, radius, minTiles] of guaranteed) {
    // First around the lanes...
    tryPlace(terrain, radius, minTiles);
    if (countNear(map, s, terrain, 9) >= minTiles) {
      claimNear(map, s, terrain, 9);
      continue;
    }
    // ...and if the lanes left no room, over their edges. The start clearing
    // stays sacred, and the lanes are wide enough to survive a small deposit
    // at one side. Measured, lanes alone left no room on about 1 map in 70.
    const union: Uint8Array | null = protectedTiles;
    protectedTiles = startTiles;
    tryPlace(terrain, radius, minTiles);
    protectedTiles = union;
    claimNear(map, s, terrain, 9);
  }
  claimPlaced = false;

  // Border of water, so units can't wander off the edge.
  for (let i = 0; i < size; i++) {
    for (const [x, y] of [[i, 0], [i, size - 1], [0, i], [size - 1, i]] as const) {
      map.terrain[idx(map, x, y)] = TERRAIN_IDS.water;
      map.amount[idx(map, x, y)] = 0;
    }
  }

  mirror(map);
  protectedTiles = null;
  startTiles = null;

  // Belt and braces: if the halves still don't join, a straight corridor
  // through the centre is symmetric by construction.
  if (!isConnected(map, starts[0], starts[1])) {
    carveStraight(map, starts[0], starts[1], 2.2);
  }

  return { map, starts };
}

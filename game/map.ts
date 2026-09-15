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

  // Players start on opposite corners of the diagonal, which in isometric
  // projection reads as left and right rather than top and bottom.
  const inset = Math.floor(size * 0.16);
  const starts = [
    { x: inset, y: size - inset },
    { x: size - inset, y: inset },
  ];

  // Forage: the early food supply. Scattered, so expanding toward it is a
  // real decision rather than a formality.
  for (let i = 0; i < Math.floor(size * 0.22); i++) {
    blob(map, rand() * size, rand() * size, 1.3 + rand() * 1.4, "forage", rand);
  }

  // Forests: many small clusters.
  for (let i = 0; i < Math.floor(size * 0.7); i++) {
    blob(map, rand() * size, rand() * size, 2 + rand() * 3.5, "forest", rand);
  }

  // Gold and stone: fewer, and mirrored so neither player is starved.
  for (let i = 0; i < 5; i++) {
    const x = rand() * size;
    const y = rand() * size;
    blob(map, x, y, 1.4 + rand(), "gold", rand);
    blob(map, size - x, size - y, 1.4 + rand(), "gold", rand);
  }
  for (let i = 0; i < 3; i++) {
    const x = rand() * size;
    const y = rand() * size;
    blob(map, x, y, 1.3, "stone", rand);
    blob(map, size - x, size - y, 1.3, "stone", rand);
  }

  // A lake or two for visual interest, kept away from the middle so they can't
  // wall the map in half.
  for (let i = 0; i < 2; i++) {
    const x = rand() < 0.5 ? rand() * size * 0.3 : size - rand() * size * 0.3;
    const y = rand() < 0.5 ? rand() * size * 0.3 : size - rand() * size * 0.3;
    blob(map, x, y, 2.5 + rand() * 2, "water", rand);
  }

  // Each start needs open ground, plus guaranteed wood and gold within reach —
  // a start with no nearby trees is unplayable, not a challenge.
  for (const s of starts) {
    clearArea(map, s.x, s.y, 4);
    blob(map, s.x + 6, s.y - 1, 2.6, "forest", rand);
    blob(map, s.x - 1, s.y + 6, 2.2, "forest", rand);
    blob(map, s.x + 5, s.y + 5, 1.5, "gold", rand);
    // Guaranteed food within reach. A start that can't feed itself isn't a
    // hard opening, it's a dead one.
    blob(map, s.x - 5, s.y + 1, 1.8, "forage", rand);
    blob(map, s.x + 1, s.y - 5, 1.6, "forage", rand);
    blob(map, s.x + 7, s.y + 2, 1.2, "stone", rand);
    clearArea(map, s.x, s.y, 3);
  }

  // Three lanes between the bases: a wide central road and two narrower
  // flanking passes. Besides guaranteeing the map is playable at all, this is
  // what gives it shape — the narrow flanks are defensible, the centre is
  // contested, and neither of those had to be authored by hand.
  const mid = { x: size / 2, y: size / 2 };
  carveLane(map, starts[0], mid, 2.6, rand);
  carveLane(map, mid, starts[1], 2.6, rand);
  carveLane(map, starts[0], { x: size * 0.22, y: size * 0.22 }, 1.5, rand);
  carveLane(map, { x: size * 0.22, y: size * 0.22 }, starts[1], 1.5, rand);
  carveLane(map, starts[0], { x: size * 0.78, y: size * 0.78 }, 1.5, rand);
  carveLane(map, { x: size * 0.78, y: size * 0.78 }, starts[1], 1.5, rand);

  // Border of water, so units can't wander off the edge.
  for (let i = 0; i < size; i++) {
    for (const [x, y] of [[i, 0], [i, size - 1], [0, i], [size - 1, i]] as const) {
      map.terrain[idx(map, x, y)] = TERRAIN_IDS.water;
      map.amount[idx(map, x, y)] = 0;
    }
  }

  // Belt and braces: if the lanes still didn't join the two starts — a lake
  // dropped across a pass, say — force a direct corridor. A map that fails
  // this is unplayable, so it is not something to leave to chance.
  if (!isConnected(map, starts[0], starts[1])) {
    carveLane(map, starts[0], starts[1], 2.2, rand);
  }

  return { map, starts };
}

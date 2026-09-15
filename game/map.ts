import { TERRAIN_IDS, type GameMap, type Terrain } from "./types.ts";

/**
 * Map generation.
 *
 * Deterministic from a seed so a match can be reproduced — useful when a bug
 * only shows up on one layout. Resources are placed in clusters rather than
 * scattered, because scattered resources make villagers walk constantly and
 * the early game feel dead.
 */

function mulberry32(seed: number) {
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
    clearArea(map, s.x, s.y, 3);
  }

  // Border of water, so units can't wander off the edge.
  for (let i = 0; i < size; i++) {
    for (const [x, y] of [[i, 0], [i, size - 1], [0, i], [size - 1, i]] as const) {
      map.terrain[idx(map, x, y)] = TERRAIN_IDS.water;
      map.amount[idx(map, x, y)] = 0;
    }
  }

  return { map, starts };
}

import { BUILDINGS, isBuilding } from "./config.ts";
import { canSee } from "./fog.ts";
import { idx } from "./map.ts";
import { TERRAIN_IDS, type BuildingKind, type World } from "./types.ts";

/**
 * Minimap.
 *
 * Drawn as a diamond so it matches the orientation of the main view: north on
 * the minimap is the same direction as up-the-screen in the world. A square
 * minimap for an isometric game makes every glance a mental rotation.
 */

const TERRAIN_RGB: Record<number, [number, number, number]> = {
  [TERRAIN_IDS.grass]: [74, 107, 58],
  [TERRAIN_IDS.forest]: [38, 66, 34],
  [TERRAIN_IDS.gold]: [196, 160, 64],
  [TERRAIN_IDS.water]: [42, 74, 99],
  [TERRAIN_IDS.stone]: [140, 138, 132],
  [TERRAIN_IDS.forage]: [150, 70, 50],
};

export const PLAYER_RGB = ["#f0923f", "#6f8fe0"];

export interface MinimapLayout {
  width: number;
  height: number;
  /** Pixels per tile along each iso axis. */
  k: number;
}

export function layoutFor(mapSize: number, width: number): MinimapLayout {
  const k = width / (2 * mapSize);
  return { width, height: mapSize * k, k };
}

/** Tile position to minimap pixel. */
export function toMini(layout: MinimapLayout, x: number, y: number) {
  return {
    mx: (x - y) * layout.k + layout.width / 2,
    my: (x + y) * (layout.k / 2),
  };
}

/** Minimap pixel to tile position — the exact inverse of `toMini`. */
export function fromMini(layout: MinimapLayout, mx: number, my: number) {
  const a = (mx - layout.width / 2) / layout.k; // x - y
  const b = (my * 2) / layout.k; // x + y
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/**
 * Terrain, fogged, one pixel per tile. Rebuilt only when terrain or
 * exploration changes, then drawn with a transform each frame.
 */
export class TerrainLayer {
  private canvas: HTMLCanvasElement | null = null;
  private key = "";

  get(world: World, owner: 0 | 1): HTMLCanvasElement {
    const v = world.vision[owner];
    // Cheap change detection: terrain version plus a coarse exploration and
    // visibility checksum, refreshed at the vision cadence.
    const key = `${world.terrainVersion}:${v.nextUpdate.toFixed(1)}`;
    if (this.canvas && key === this.key) return this.canvas;
    this.key = key;

    const { width, height } = world.map;
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const ctx = this.canvas.getContext("2d")!;
    const img = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const k = idx(world.map, x, y);
        const o = k * 4;
        if (!v.explored[k]) {
          img.data[o + 3] = 0; // unexplored: transparent over the dark panel
          continue;
        }
        const t = world.map.amount[k] > 0 || world.map.terrain[k] === TERRAIN_IDS.water
          ? world.map.terrain[k]
          : TERRAIN_IDS.grass;
        const [r, g, b] = TERRAIN_RGB[t] ?? TERRAIN_RGB[0];
        const dim = v.visible[k] ? 1 : 0.55;
        img.data[o] = r * dim;
        img.data[o + 1] = g * dim;
        img.data[o + 2] = b * dim;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return this.canvas;
  }
}

function vision0Explored(world: World, owner: 0 | 1, at: { x: number; y: number }): boolean {
  return world.vision[owner].explored[idx(world.map, Math.round(at.x), Math.round(at.y))] === 1;
}

export interface MinimapDrawOptions {
  owner: 0 | 1;
  /** Device pixel ratio; the context is expected to be scaled by it already. */
  dpr: number;
  selected: Set<number>;
  viewCorners: { x: number; y: number }[];
  alerts: { x: number; y: number; age: number }[];
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  world: World,
  layout: MinimapLayout,
  terrain: HTMLCanvasElement,
  opts: MinimapDrawOptions,
) {
  const { k } = layout;
  ctx.clearRect(0, 0, layout.width, layout.height);

  // The terrain image is in tile space; this transform turns tile axes into
  // the minimap's diamond axes.
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const d = opts.dpr;
  ctx.setTransform(k * d, (k / 2) * d, -k * d, (k / 2) * d, (layout.width / 2) * d, 0);
  ctx.drawImage(terrain, 0, 0);
  ctx.restore();

  // The map's outline, always. An unexplored minimap is otherwise an empty
  // box, which tells a new player nothing about the shape of the world or
  // how much of it is still out there.
  const w = world.map.width;
  const corners = [
    toMini(layout, 0, 0),
    toMini(layout, w, 0),
    toMini(layout, w, w),
    toMini(layout, 0, w),
  ];
  ctx.strokeStyle = "rgba(201,160,106,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.mx, c.my) : ctx.lineTo(c.mx, c.my)));
  ctx.closePath();
  ctx.stroke();

  // Where the enemy must be: starting positions are public knowledge.
  const theirs = world.starts[opts.owner === 0 ? 1 : 0];
  if (theirs && !vision0Explored(world, opts.owner, theirs)) {
    const { mx, my } = toMini(layout, theirs.x, theirs.y);
    ctx.fillStyle = "rgba(111,143,224,0.55)";
    ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("?", mx, my + 3);
  }

  const vision = world.vision[opts.owner];

  // Remembered enemy buildings the player can't currently see.
  for (const ghost of vision.ghosts.values()) {
    const live = world.entities.get(ghost.id);
    if (live && canSee(world, opts.owner, live)) continue;
    const { mx, my } = toMini(layout, ghost.x, ghost.y);
    const s = Math.max(2, BUILDINGS[ghost.kind].size * k * 0.9);
    ctx.strokeStyle = PLAYER_RGB[ghost.owner];
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - s / 2, my - s / 4, s, s / 2);
  }

  for (const e of world.entities.values()) {
    if (!canSee(world, opts.owner, e)) continue;
    const { mx, my } = toMini(layout, e.x, e.y);
    const selected = opts.selected.has(e.id);
    ctx.fillStyle = selected ? "#fff4e0" : PLAYER_RGB[e.owner];
    if (isBuilding(e.kind)) {
      const s = Math.max(3, BUILDINGS[e.kind as BuildingKind].size * k);
      ctx.fillRect(mx - s / 2, my - s / 4, s, s / 2);
    } else {
      const s = Math.max(2, k * 1.1);
      ctx.fillRect(mx - s / 2, my - s / 2, s, s);
    }
  }

  // Where the camera is looking.
  ctx.strokeStyle = "rgba(255,244,224,0.9)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  opts.viewCorners.forEach((c, i) => {
    const { mx, my } = toMini(layout, c.x, c.y);
    if (i === 0) ctx.moveTo(mx, my);
    else ctx.lineTo(mx, my);
  });
  ctx.closePath();
  ctx.stroke();

  // Attack pings: an expanding ring, so an alert is findable at a glance.
  for (const a of opts.alerts) {
    const { mx, my } = toMini(layout, a.x, a.y);
    const t = a.age % 1;
    ctx.strokeStyle = `rgba(255,90,70,${1 - t})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mx, my, 3 + t * 9, 0, Math.PI * 2);
    ctx.stroke();
  }
}

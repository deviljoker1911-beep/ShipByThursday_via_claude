import { BUILDINGS, UNITS, isBuilding, isUnit, maxHp } from "./config.ts";
import { TILE_H, TILE_W, depth, tileToScreen, type Camera } from "./iso.ts";
import { idx, inBounds, terrainAt } from "./map.ts";
import { footprint } from "./world.ts";
import { TERRAIN_IDS, type Entity, type World } from "./types.ts";

/**
 * Canvas renderer.
 *
 * Everything is drawn with vector shapes rather than sprites — no art pipeline
 * to build, and it scales cleanly to any device pixel ratio. Draw order is
 * painter's algorithm on (x + y), which is what makes an isometric scene
 * overlap correctly.
 */

const COLORS = {
  grass: ["#4a6b3a", "#547a42"],
  forest: ["#2d4a28", "#33542d"],
  gold: ["#8a6d2f", "#a07f38"],
  water: ["#2a4a63", "#31566f"],
  stone: ["#5c5b56", "#6a6963"],
} as const;

const PLAYER_COLORS: Record<number, { body: string; trim: string }> = {
  0: { body: "#e8873c", trim: "#ffcb8e" },
  1: { body: "#5b7fd4", trim: "#a9c0f5" },
};

function terrainName(id: number): keyof typeof COLORS {
  if (id === TERRAIN_IDS.forest) return "forest";
  if (id === TERRAIN_IDS.gold) return "gold";
  if (id === TERRAIN_IDS.water) return "water";
  if (id === TERRAIN_IDS.stone) return "stone";
  return "grass";
}

function diamond(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number) {
  const hw = (TILE_W / 2) * zoom;
  const hh = (TILE_H / 2) * zoom;
  ctx.beginPath();
  ctx.moveTo(sx, sy - hh);
  ctx.lineTo(sx + hw, sy);
  ctx.lineTo(sx, sy + hh);
  ctx.lineTo(sx - hw, sy);
  ctx.closePath();
}

export interface RenderOptions {
  selected: Set<number>;
  hoverTile: { x: number; y: number } | null;
  placing: { kind: keyof typeof BUILDINGS; valid: boolean } | null;
  dragBox: { x0: number; y0: number; x1: number; y1: number } | null;
}

export function render(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  view: { width: number; height: number },
  opts: RenderOptions,
) {
  ctx.fillStyle = "#14120f";
  ctx.fillRect(0, 0, view.width, view.height);

  drawTerrain(ctx, world, cam, view);

  // Painter's algorithm: back to front along the isometric diagonal.
  const drawables = [...world.entities.values()].sort(
    (a, b) => depth(a.x, a.y) - depth(b.x, b.y),
  );
  for (const e of drawables) {
    if (isBuilding(e.kind)) drawBuilding(ctx, e, cam, opts.selected.has(e.id));
    else drawUnit(ctx, e, cam, opts.selected.has(e.id));
  }

  if (opts.placing && opts.hoverTile) {
    drawPlacementGhost(ctx, world, cam, opts.placing, opts.hoverTile);
  }

  if (opts.dragBox) {
    const { x0, y0, x1, y1 } = opts.dragBox;
    ctx.strokeStyle = "#e8873c";
    ctx.lineWidth = 1.5;
    ctx.fillStyle = "rgba(232,135,60,0.12)";
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
}

function drawTerrain(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  view: { width: number; height: number },
) {
  const { map } = world;
  // Only draw tiles whose diamond can intersect the viewport.
  const margin = 3;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const { sx, sy } = tileToScreen(x, y, cam);
      if (
        sx < -TILE_W * cam.zoom * margin ||
        sx > view.width + TILE_W * cam.zoom * margin ||
        sy < -TILE_H * cam.zoom * margin ||
        sy > view.height + TILE_H * cam.zoom * margin
      ) {
        continue;
      }

      const id = terrainAt(map, x, y);
      const name = terrainName(id);
      const shade = (x * 7 + y * 13) % 2;
      ctx.fillStyle = COLORS[name][shade];
      diamond(ctx, sx, sy, cam.zoom);
      ctx.fill();

      if (name === "forest" && map.amount[idx(map, x, y)] > 0) {
        drawTree(ctx, sx, sy, cam.zoom);
      } else if (name === "gold" && map.amount[idx(map, x, y)] > 0) {
        drawOre(ctx, sx, sy, cam.zoom, "#e8c46a");
      } else if (name === "stone") {
        drawOre(ctx, sx, sy, cam.zoom, "#9d9c96");
      }
    }
  }
}

function drawTree(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number) {
  const h = 26 * zoom;
  ctx.fillStyle = "#3b2a1c";
  ctx.fillRect(sx - 1.5 * zoom, sy - h * 0.35, 3 * zoom, h * 0.35);
  ctx.fillStyle = "#3f6b33";
  ctx.beginPath();
  ctx.moveTo(sx, sy - h);
  ctx.lineTo(sx + 9 * zoom, sy - h * 0.3);
  ctx.lineTo(sx - 9 * zoom, sy - h * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#4b8040";
  ctx.beginPath();
  ctx.moveTo(sx, sy - h * 1.15);
  ctx.lineTo(sx + 6.5 * zoom, sy - h * 0.55);
  ctx.lineTo(sx - 6.5 * zoom, sy - h * 0.55);
  ctx.closePath();
  ctx.fill();
}

function drawOre(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  zoom: number,
  color: string,
) {
  ctx.fillStyle = color;
  for (const [dx, dy, r] of [
    [-4, -2, 3.5],
    [3, -4, 3],
    [1, 0, 4],
  ] as const) {
    ctx.beginPath();
    ctx.arc(sx + dx * zoom, sy + dy * zoom, r * zoom, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  e: Entity,
  cam: Camera,
  selected: boolean,
) {
  const { sx, sy } = tileToScreen(e.x, e.y, cam);
  const z = cam.zoom;
  const colors = PLAYER_COLORS[e.owner];
  const spec = UNITS[e.kind as keyof typeof UNITS];

  if (selected) {
    ctx.strokeStyle = "#ffd9a8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 11 * z, 6 * z, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Ground shadow anchors the figure to the tile.
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(sx, sy, 7 * z, 3.5 * z, 0, 0, Math.PI * 2);
  ctx.fill();

  const h = (e.kind === "villager" ? 15 : 18) * z;
  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.moveTo(sx, sy - h);
  ctx.lineTo(sx + 5 * z, sy - 2 * z);
  ctx.lineTo(sx - 5 * z, sy - 2 * z);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = colors.trim;
  ctx.beginPath();
  ctx.arc(sx, sy - h - 3 * z, 3.4 * z, 0, Math.PI * 2);
  ctx.fill();

  // Spear or bow, so the two military units read differently at a glance.
  if (e.kind === "spearman") {
    ctx.strokeStyle = "#d8cbb4";
    ctx.lineWidth = 1.6 * z;
    ctx.beginPath();
    ctx.moveTo(sx + 6 * z, sy - h * 1.3);
    ctx.lineTo(sx + 6 * z, sy + 1 * z);
    ctx.stroke();
  } else if (e.kind === "archer") {
    ctx.strokeStyle = "#c9a76a";
    ctx.lineWidth = 1.5 * z;
    ctx.beginPath();
    ctx.arc(sx + 6 * z, sy - h * 0.6, 5 * z, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  }

  if (e.carrying?.amount) {
    ctx.fillStyle = e.carrying.resource === "wood" ? "#8a5a2b" : "#e8c46a";
    ctx.fillRect(sx - 3 * z, sy - h - 9 * z, 6 * z, 4 * z);
  }

  if (e.hp < spec.hp) drawHealthBar(ctx, sx, sy - h - 10 * z, e.hp / spec.hp, z, 18);
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  e: Entity,
  cam: Camera,
  selected: boolean,
) {
  const { size } = footprint(e);
  const { sx, sy } = tileToScreen(e.x, e.y, cam);
  const z = cam.zoom;
  const colors = PLAYER_COLORS[e.owner];
  const spec = BUILDINGS[e.kind as keyof typeof BUILDINGS];

  const hw = (TILE_W / 2) * size * z;
  const hh = (TILE_H / 2) * size * z;
  const wallH = (e.kind === "house" ? 22 : e.kind === "farm" ? 4 : 34) * z;
  const progress = e.progress ?? 1;

  if (selected) {
    ctx.strokeStyle = "#ffd9a8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy - hh);
    ctx.lineTo(sx + hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx - hw, sy);
    ctx.closePath();
    ctx.stroke();
  }

  // Base footprint.
  ctx.fillStyle = e.kind === "farm" ? "#7a6433" : "#3a332c";
  ctx.beginPath();
  ctx.moveTo(sx, sy - hh);
  ctx.lineTo(sx + hw, sy);
  ctx.lineTo(sx, sy + hh);
  ctx.lineTo(sx - hw, sy);
  ctx.closePath();
  ctx.fill();

  if (e.kind === "farm") {
    ctx.strokeStyle = "#9c8143";
    ctx.lineWidth = 1 * z;
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      ctx.beginPath();
      ctx.moveTo(sx - hw + hw * t, sy - hh * t);
      ctx.lineTo(sx + hw * t, sy + hh - hh * t);
      ctx.stroke();
    }
  } else {
    // Two visible walls plus a roof, built up to `progress`.
    const h = wallH * progress;
    ctx.fillStyle = shade(colors.body, -0.45);
    ctx.beginPath();
    ctx.moveTo(sx - hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx, sy + hh - h);
    ctx.lineTo(sx - hw, sy - h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = shade(colors.body, -0.25);
    ctx.beginPath();
    ctx.moveTo(sx + hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx, sy + hh - h);
    ctx.lineTo(sx + hw, sy - h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = colors.body;
    ctx.beginPath();
    ctx.moveTo(sx, sy - hh - h);
    ctx.lineTo(sx + hw, sy - h);
    ctx.lineTo(sx, sy + hh - h);
    ctx.lineTo(sx - hw, sy - h);
    ctx.closePath();
    ctx.fill();
  }

  if (progress < 1) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.moveTo(sx, sy - hh);
    ctx.lineTo(sx + hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx - hw, sy);
    ctx.closePath();
    ctx.fill();
    drawHealthBar(ctx, sx, sy - hh - 8 * z, progress, z, 28, "#6fa8dc");
  } else if (e.hp < spec.hp) {
    drawHealthBar(ctx, sx, sy - hh - wallH - 8 * z, e.hp / spec.hp, z, 28);
  }

  if (e.queue?.length) {
    const head = e.queue[0];
    const total = UNITS[head.kind].trainTime;
    drawHealthBar(
      ctx,
      sx,
      sy - hh - wallH - 15 * z,
      1 - head.remaining / total,
      z,
      28,
      "#e8c46a",
    );
  }
}

function drawHealthBar(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  frac: number,
  zoom: number,
  width = 18,
  color = "#6ecf7b",
) {
  const w = width * zoom;
  const h = 3.5 * zoom;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(sx - w / 2, sy, w, h);
  ctx.fillStyle = frac > 0.5 ? color : frac > 0.25 ? "#e8c46a" : "#e06b5a";
  ctx.fillRect(sx - w / 2, sy, w * Math.max(0, Math.min(1, frac)), h);
}

function drawPlacementGhost(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  placing: { kind: keyof typeof BUILDINGS; valid: boolean },
  hover: { x: number; y: number },
) {
  const size = BUILDINGS[placing.kind].size;
  const x0 = Math.round(hover.x - (size - 1) / 2);
  const y0 = Math.round(hover.y - (size - 1) / 2);
  ctx.globalAlpha = 0.5;
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const { sx, sy } = tileToScreen(x, y, cam);
      ctx.fillStyle = placing.valid ? "#6ecf7b" : "#e06b5a";
      diamond(ctx, sx, sy, cam.zoom);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** Lighten or darken a hex colour by `amount` in [-1, 1]. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const f = (c: number) =>
    Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Fit the camera so a player's start is centred on screen. */
export function centerOn(
  cam: Camera,
  x: number,
  y: number,
  view: { width: number; height: number },
) {
  cam.ox = view.width / 2 - (x - y) * (TILE_W / 2) * cam.zoom;
  cam.oy = view.height / 2 - (x + y) * (TILE_H / 2) * cam.zoom;
}

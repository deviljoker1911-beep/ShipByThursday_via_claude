import { BUILDINGS, UNITS, isBuilding, maxHp } from "./config.ts";
import { TILE_H, TILE_W, depth, tileToScreen, type Camera } from "./iso.ts";
import { idx, inBounds, terrainAt } from "./map.ts";
import { canSee } from "./fog.ts";
import { footprint } from "./world.ts";
import {
  TERRAIN_IDS,
  type BuildingKind,
  type Effect,
  type Entity,
  type Ghost,
  type Owner,
  type Resource,
  type World,
} from "./types.ts";

/**
 * Canvas renderer.
 *
 * A pure reader of simulation state: it never changes the world, so the rules
 * stay testable without it and the renderer could be replaced wholesale.
 *
 * Everything is vector shapes rather than sprites — no art pipeline, and it
 * scales cleanly to any pixel ratio. Draw order is painter's algorithm on
 * (x + y), which is what makes an isometric scene overlap correctly.
 */

const COLORS = {
  grass: ["#4a6b3a", "#547a42"],
  forest: ["#2d4a28", "#33542d"],
  gold: ["#8a6d2f", "#a07f38"],
  water: ["#2a4a63", "#31566f"],
  stone: ["#5c5b56", "#6a6963"],
  forage: ["#4f6b36", "#58763d"],
} as const;

const PLAYER_COLORS: Record<number, { body: string; trim: string }> = {
  0: { body: "#e8873c", trim: "#ffcb8e" },
  1: { body: "#5b7fd4", trim: "#a9c0f5" },
};

const CARRY_COLORS: Record<Resource, string> = {
  food: "#d0553d",
  wood: "#8a5a2b",
  gold: "#e8c46a",
  stone: "#b3b1aa",
};

function terrainName(id: number): keyof typeof COLORS {
  if (id === TERRAIN_IDS.forest) return "forest";
  if (id === TERRAIN_IDS.gold) return "gold";
  if (id === TERRAIN_IDS.water) return "water";
  if (id === TERRAIN_IDS.stone) return "stone";
  if (id === TERRAIN_IDS.forage) return "forage";
  return "grass";
}

function diamond(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, scale = 1) {
  const hw = (TILE_W / 2) * zoom * scale;
  const hh = (TILE_H / 2) * zoom * scale;
  ctx.beginPath();
  ctx.moveTo(sx, sy - hh);
  ctx.lineTo(sx + hw, sy);
  ctx.lineTo(sx, sy + hh);
  ctx.lineTo(sx - hw, sy);
  ctx.closePath();
}

/**
 * How tall each building's walls are drawn, in pixels at zoom 1.
 *
 * Exported because click hit-testing has to match it exactly; a second copy
 * would drift the first time either was tuned.
 */
export function wallHeight(kind: string): number {
  switch (kind) {
    case "farm":
      return 4;
    case "house":
      return 22;
    case "storehouse":
      return 24;
    case "tower":
      return 52; // tall and narrow, so it reads as a tower at a glance
    default:
      return 34;
  }
}

export interface Hover {
  x: number;
  y: number;
  entityId: number | null;
  resource: boolean;
}

export interface RenderOptions {
  /** Whose eyes the scene is seen through. */
  owner: Owner;
  selected: Set<number>;
  hover: Hover | null;
  placing: { kind: BuildingKind; valid: boolean; x: number; y: number } | null;
  dragBox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Mode cursor tint for the hovered tile (attack-move, patrol). */
  modeTint: string | null;
}

export function render(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  view: { width: number; height: number },
  opts: RenderOptions,
) {
  ctx.fillStyle = "#0e0c0a";
  ctx.fillRect(0, 0, view.width, view.height);

  drawTerrain(ctx, world, cam, view, opts.owner);

  if (opts.hover?.resource) {
    const { sx, sy } = tileToScreen(Math.round(opts.hover.x), Math.round(opts.hover.y), cam);
    ctx.strokeStyle = "rgba(255,226,140,0.85)";
    ctx.lineWidth = 1.5;
    diamond(ctx, sx, sy, cam.zoom, 0.92);
    ctx.stroke();
  }

  if (opts.modeTint && opts.hover) {
    const { sx, sy } = tileToScreen(Math.round(opts.hover.x), Math.round(opts.hover.y), cam);
    ctx.strokeStyle = opts.modeTint;
    ctx.lineWidth = 1.5;
    diamond(ctx, sx, sy, cam.zoom, 0.8);
    ctx.stroke();
  }

  drawOrderLines(ctx, world, cam, opts);

  // Remembered buildings, then everything actually in sight, back to front.
  const ghosts = visibleGhosts(world, opts.owner);
  const visible = [...world.entities.values()].filter((e) => canSee(world, opts.owner, e));
  const drawables: (Entity | Ghost)[] = [...ghosts, ...visible].sort(
    (a, b) => depth(a.x, a.y) - depth(b.x, b.y),
  );
  const hoverId = opts.hover?.entityId ?? null;
  for (const d of drawables) {
    if (!("hp" in d)) {
      drawGhost(ctx, d, cam);
      continue;
    }
    const e = d as Entity;
    const selected = opts.selected.has(e.id);
    const hovered = hoverId === e.id;
    const showBar = selected || hovered || e.hp < maxHp(e.kind);
    if (hovered && !selected) drawHoverRing(ctx, e, cam, e.owner === opts.owner);
    if (isBuilding(e.kind)) drawBuilding(ctx, e, cam, selected, showBar);
    else drawUnit(ctx, e, cam, selected, showBar);
  }

  drawRally(ctx, world, cam, opts);
  drawEffects(ctx, world, cam, opts.owner);

  if (opts.placing) {
    drawPlacementGhost(ctx, cam, opts.placing, { x: opts.placing.x, y: opts.placing.y });
  }

  if (opts.dragBox) {
    const { x0, y0, x1, y1 } = opts.dragBox;
    ctx.strokeStyle = "#e8873c";
    ctx.lineWidth = 1.5;
    ctx.fillStyle = "rgba(232,135,60,0.12)";
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
}

function visibleGhosts(world: World, owner: Owner): Ghost[] {
  const out: Ghost[] = [];
  for (const g of world.vision[owner].ghosts.values()) {
    const live = world.entities.get(g.id);
    if (live && canSee(world, owner, live)) continue;
    out.push(g);
  }
  return out;
}

function drawTerrain(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  view: { width: number; height: number },
  owner: Owner,
) {
  const { map } = world;
  const vision = world.vision[owner];
  const marginX = TILE_W * cam.zoom * 2;
  const marginY = TILE_H * cam.zoom * 3;
  const deco: { x: number; y: number; sx: number; sy: number; name: string; lit: boolean }[] = [];

  // Ground first, with the fog laid over each tile as it's drawn.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const { sx, sy } = tileToScreen(x, y, cam);
      if (sx < -marginX || sx > view.width + marginX || sy < -marginY || sy > view.height + marginY) {
        continue;
      }
      const k = idx(map, x, y);
      if (!vision.explored[k]) continue; // never seen: leave it dark

      const name = terrainName(terrainAt(map, x, y));
      const shadeIx = (x * 7 + y * 13) % 2;
      const ground = name === "forest" || name === "forage" || name === "gold" || name === "stone"
        ? map.amount[k] > 0 ? COLORS[name][shadeIx] : COLORS.grass[shadeIx]
        : COLORS[name][shadeIx];
      ctx.fillStyle = ground;
      diamond(ctx, sx, sy, cam.zoom);
      ctx.fill();

      const lit = vision.visible[k] === 1;
      if (!lit) {
        ctx.fillStyle = "rgba(8,7,6,0.5)";
        ctx.fill();
      }
      if (map.amount[k] > 0 && name !== "grass" && name !== "water") {
        deco.push({ x, y, sx, sy, name, lit });
      }
    }
  }

  // Then trees, bushes and ore on top, dimmed where it's fogged.
  for (const d of deco) {
    ctx.globalAlpha = d.lit ? 1 : 0.5;
    if (d.name === "forest") drawTree(ctx, d.sx, d.sy, cam.zoom);
    else if (d.name === "gold") drawOre(ctx, d.sx, d.sy, cam.zoom, "#e8c46a");
    else if (d.name === "stone") drawOre(ctx, d.sx, d.sy, cam.zoom, "#9d9c96");
    else if (d.name === "forage") drawBush(ctx, d.sx, d.sy, cam.zoom);
  }
  ctx.globalAlpha = 1;
}

function drawGhost(ctx: CanvasRenderingContext2D, g: Ghost, cam: Camera) {
  // Last-known state, faded — clearly information, not presence.
  const fake: Entity = { id: g.id, kind: g.kind, owner: g.owner, x: g.x, y: g.y, hp: 1, progress: g.progress };
  ctx.globalAlpha = 0.45;
  drawBuilding(ctx, fake, cam, false, false);
  ctx.globalAlpha = 1;
}

function drawHoverRing(ctx: CanvasRenderingContext2D, e: Entity, cam: Camera, friendly: boolean) {
  const { sx, sy } = tileToScreen(e.x, e.y, cam);
  ctx.strokeStyle = friendly ? "rgba(255,244,224,0.7)" : "rgba(255,110,90,0.9)";
  ctx.lineWidth = 1.5;
  if (isBuilding(e.kind)) {
    diamond(ctx, sx, sy, cam.zoom, footprint(e).size * 1.04);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(sx, sy, 11 * cam.zoom, 6 * cam.zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * Where selected units are going, and what they're attacking.
 *
 * The single most useful answer to "did my order register?" is seeing the
 * order: a line to the destination, dots for queued waypoints, a red tether
 * to the target.
 */
function drawOrderLines(ctx: CanvasRenderingContext2D, world: World, cam: Camera, opts: RenderOptions) {
  let drawn = 0;
  ctx.save();
  ctx.lineWidth = 1;
  for (const id of opts.selected) {
    if (drawn++ > 40) break;
    const e = world.entities.get(id);
    if (!e || e.owner !== opts.owner || isBuilding(e.kind) || !e.state) continue;
    const from = tileToScreen(e.x, e.y, cam);
    const st = e.state;

    if (st.name === "attacking") {
      const t = world.entities.get(st.targetId);
      if (t && canSee(world, opts.owner, t)) {
        const to = tileToScreen(t.x, t.y, cam);
        ctx.strokeStyle = "rgba(255,95,70,0.55)";
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(from.sx, from.sy);
        ctx.lineTo(to.sx, to.sy);
        ctx.stroke();
      }
    }

    const points: { x: number; y: number }[] = [];
    if (st.name === "moving" || st.name === "attackMove") points.push({ x: st.tx, y: st.ty });
    if (st.name === "patrol") points.push({ x: st.bx, y: st.by }, { x: st.ax, y: st.ay });
    for (const o of e.orders ?? []) {
      if (o.name === "moving" || o.name === "attackMove") points.push({ x: o.tx, y: o.ty });
    }
    if (points.length === 0) continue;

    const hostile = st.name === "attackMove" || st.name === "patrol";
    ctx.strokeStyle = hostile ? "rgba(255,120,90,0.35)" : "rgba(160,230,160,0.35)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(from.sx, from.sy);
    for (const p of points) {
      const s = tileToScreen(p.x, p.y, cam);
      ctx.lineTo(s.sx, s.sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = hostile ? "rgba(255,120,90,0.7)" : "rgba(160,230,160,0.7)";
    for (const p of points) {
      const s = tileToScreen(p.x, p.y, cam);
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, 2.2 * cam.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawRally(ctx: CanvasRenderingContext2D, world: World, cam: Camera, opts: RenderOptions) {
  for (const id of opts.selected) {
    const b = world.entities.get(id);
    if (!b || !isBuilding(b.kind) || !b.rally || b.owner !== opts.owner) continue;
    const from = tileToScreen(b.x, b.y, cam);
    const to = tileToScreen(b.rally.x, b.rally.y, cam);
    ctx.strokeStyle = "rgba(255,226,140,0.5)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(from.sx, from.sy);
    ctx.lineTo(to.sx, to.sy);
    ctx.stroke();
    ctx.setLineDash([]);
    const z = cam.zoom;
    ctx.fillStyle = "#3b2a1c";
    ctx.fillRect(to.sx - 0.8 * z, to.sy - 16 * z, 1.6 * z, 16 * z);
    ctx.fillStyle = PLAYER_COLORS[b.owner].body;
    ctx.beginPath();
    ctx.moveTo(to.sx + 0.8 * z, to.sy - 16 * z);
    ctx.lineTo(to.sx + 9 * z, to.sy - 13 * z);
    ctx.lineTo(to.sx + 0.8 * z, to.sy - 10 * z);
    ctx.closePath();
    ctx.fill();
  }
}

const MARKER_COLORS: Record<string, string> = {
  move: "120,220,120",
  attack: "255,95,70",
  gather: "255,215,110",
  build: "120,180,255",
  rally: "255,215,110",
};

/**
 * Short-lived feedback. Restrained on purpose: each effect answers a question
 * ("did that hit?", "did my villager deliver?") and then gets out of the way.
 */
function drawEffects(ctx: CanvasRenderingContext2D, world: World, cam: Camera, owner: Owner) {
  const now = world.time;
  const z = cam.zoom;
  for (const fx of world.effects) {
    const p = Math.max(0, Math.min(1, (now - fx.t) / fx.life));
    if (!effectVisible(world, owner, fx)) continue;

    switch (fx.kind) {
      case "projectile": {
        const x = fx.x + (fx.tx - fx.x) * p;
        const y = fx.y + (fx.ty - fx.y) * p;
        const s = tileToScreen(x, y, cam);
        const arc = Math.sin(p * Math.PI) * 14 * z;
        const back = tileToScreen(x - (fx.tx - fx.x) * 0.06, y - (fx.ty - fx.y) * 0.06, cam);
        ctx.strokeStyle = "#f3e6c8";
        ctx.lineWidth = 1.3 * z;
        ctx.beginPath();
        ctx.moveTo(back.sx, back.sy - arc - 10 * z);
        ctx.lineTo(s.sx, s.sy - arc - 10 * z);
        ctx.stroke();
        break;
      }
      case "impact": {
        const s = tileToScreen(fx.x, fx.y, cam);
        ctx.fillStyle = `rgba(255,235,200,${0.8 * (1 - p)})`;
        ctx.beginPath();
        ctx.arc(s.sx, s.sy - 10 * z, (3 + p * 5) * z, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "death": {
        const s = tileToScreen(fx.x, fx.y, cam);
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = PLAYER_COLORS[fx.owner].body;
        ctx.beginPath();
        ctx.ellipse(s.sx, s.sy, 8 * z, 3 * z, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(120,110,100,0.6)";
        ctx.beginPath();
        ctx.arc(s.sx, s.sy - (6 + p * 10) * z, (4 + p * 6) * z, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case "marker": {
        const s = tileToScreen(fx.x, fx.y, cam);
        const rgb = MARKER_COLORS[fx.order] ?? MARKER_COLORS.move;
        ctx.strokeStyle = `rgba(${rgb},${1 - p})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(s.sx, s.sy, (14 - p * 8) * z, (7 - p * 4) * z, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (fx.order === "attack") {
          const r = 5 * z;
          ctx.beginPath();
          ctx.moveTo(s.sx - r, s.sy - r / 2);
          ctx.lineTo(s.sx + r, s.sy + r / 2);
          ctx.moveTo(s.sx + r, s.sy - r / 2);
          ctx.lineTo(s.sx - r, s.sy + r / 2);
          ctx.stroke();
        }
        break;
      }
      case "deposit": {
        if (fx.owner !== owner) break;
        const s = tileToScreen(fx.x, fx.y, cam);
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = CARRY_COLORS[fx.resource];
        ctx.font = `600 ${Math.round(11 * Math.max(0.8, z))}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(fx.text, s.sx, s.sy - (30 + p * 18) * z);
        ctx.globalAlpha = 1;
        break;
      }
      case "complete": {
        const s = tileToScreen(fx.x, fx.y, cam);
        ctx.strokeStyle = `rgba(255,226,140,${1 - p})`;
        ctx.lineWidth = 2;
        diamond(ctx, s.sx, s.sy, z, 1.5 + p * 2);
        ctx.stroke();
        break;
      }
    }
  }
}

/** Effects in the fog stay hidden — a flash in the dark would give away a fight. */
function effectVisible(world: World, owner: Owner, fx: Effect): boolean {
  const tx = Math.round(fx.x);
  const ty = Math.round(fx.y);
  if (!inBounds(world.map, tx, ty)) return false;
  if (fx.kind === "marker") return true;
  return world.vision[owner].visible[idx(world.map, tx, ty)] === 1;
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

/** Forage bushes — the early food supply, and the only red on the map. */
function drawBush(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number) {
  ctx.fillStyle = "#35542c";
  ctx.beginPath();
  ctx.ellipse(sx, sy - 4 * zoom, 9 * zoom, 6 * zoom, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c2472f";
  for (const [dx, dy] of [
    [-4, -5],
    [2, -7],
    [4, -3],
    [-1, -2],
  ] as const) {
    ctx.beginPath();
    ctx.arc(sx + dx * zoom, sy + dy * zoom, 1.7 * zoom, 0, Math.PI * 2);
    ctx.fill();
  }
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
  showBar: boolean,
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

  const mounted = e.kind === "rider" || e.kind === "scout";
  if (mounted) {
    // A horse under the rider. Cavalry has to read as cavalry at a glance:
    // the counter triangle is useless if you can't tell who's who.
    ctx.fillStyle = e.kind === "rider" ? "#6b4a2e" : "#8a6a48";
    ctx.beginPath();
    ctx.ellipse(sx, sy - 5 * z, 9 * z, 4.2 * z, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(sx + 6 * z, sy - 12 * z, 3 * z, 6 * z);
    ctx.fillRect(sx - 7 * z, sy - 3 * z, 1.6 * z, 4 * z);
    ctx.fillRect(sx + 5 * z, sy - 3 * z, 1.6 * z, 4 * z);
  }
  const lift = mounted ? 7 * z : 0;
  const h = (e.kind === "villager" ? 15 : mounted ? 13 : 18) * z;
  ctx.save();
  ctx.translate(0, -lift);
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
  } else if (e.kind === "rider") {
    ctx.strokeStyle = "#d8cbb4";
    ctx.lineWidth = 1.4 * z;
    ctx.beginPath();
    ctx.moveTo(sx - 2 * z, sy - h * 0.6);
    ctx.lineTo(sx + 13 * z, sy - h * 1.1);
    ctx.stroke();
  } else if (e.kind === "scout") {
    ctx.fillStyle = colors.trim;
    ctx.fillRect(sx - 1 * z, sy - h - 14 * z, 1.2 * z, 9 * z);
    ctx.fillRect(sx, sy - h - 14 * z, 5 * z, 3 * z);
  }

  if (e.carrying?.amount) {
    ctx.fillStyle = CARRY_COLORS[e.carrying.resource];
    ctx.fillRect(sx - 3 * z, sy - h - 9 * z, 6 * z, 4 * z);
  }
  ctx.restore();

  if (showBar) drawHealthBar(ctx, sx, sy - h - lift - 10 * z, e.hp / spec.hp, z, 18);
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  e: Entity,
  cam: Camera,
  selected: boolean,
  showBar: boolean,
) {
  const { size } = footprint(e);
  const { sx, sy } = tileToScreen(e.x, e.y, cam);
  const z = cam.zoom;
  const colors = PLAYER_COLORS[e.owner];
  const spec = BUILDINGS[e.kind as keyof typeof BUILDINGS];

  const hw = (TILE_W / 2) * size * z;
  const hh = (TILE_H / 2) * size * z;
  const wallH = wallHeight(e.kind) * z;
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
  } else if (showBar) {
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
  cam: Camera,
  placing: { kind: BuildingKind; valid: boolean },
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


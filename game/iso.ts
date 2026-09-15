/**
 * Isometric projection.
 *
 * Tiles are diamonds. A tile at (x, y) projects to a screen point at the
 * diamond's centre; the two transforms below are exact inverses, which matters
 * because every click has to map back to a tile.
 */

export const TILE_W = 64;
export const TILE_H = 32;

export interface Camera {
  /** Screen-space offset of tile (0,0). */
  ox: number;
  oy: number;
  zoom: number;
}

export function tileToScreen(x: number, y: number, cam: Camera) {
  return {
    sx: ((x - y) * (TILE_W / 2)) * cam.zoom + cam.ox,
    sy: ((x + y) * (TILE_H / 2)) * cam.zoom + cam.oy,
  };
}

export function screenToTile(sx: number, sy: number, cam: Camera) {
  const px = (sx - cam.ox) / cam.zoom;
  const py = (sy - cam.oy) / cam.zoom;
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  return {
    x: (px / hw + py / hh) / 2,
    y: (py / hh - px / hw) / 2,
  };
}

/** Painter's order: things further "back" (smaller x+y) draw first. */
export function depth(x: number, y: number): number {
  return x + y;
}

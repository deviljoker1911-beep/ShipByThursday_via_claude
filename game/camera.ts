import { TILE_H, TILE_W, screenToTile, tileToScreen, type Camera } from "./iso.ts";

/**
 * Camera behaviour.
 *
 * Direct, not floaty: pans move exactly as far as the input says. Cinematic
 * easing feels lovely in a trailer and sluggish in a fight.
 */

export const ZOOM_MIN = 0.45;
export const ZOOM_MAX = 2.2;

export interface View {
  width: number;
  height: number;
}

/** Put a tile at the centre of the screen. */
export function centerOn(cam: Camera, x: number, y: number, view: View) {
  cam.ox = view.width / 2 - (x - y) * (TILE_W / 2) * cam.zoom;
  cam.oy = view.height / 2 - (x + y) * (TILE_H / 2) * cam.zoom;
}

/** The tile currently under the middle of the screen. */
export function centerTile(cam: Camera, view: View) {
  return screenToTile(view.width / 2, view.height / 2, cam);
}

/**
 * Keep the view over the map.
 *
 * Clamped on the tile at the centre of the screen, so the player can always
 * pan far enough to see the map's corners but never off into the void.
 */
export function clampCamera(cam: Camera, view: View, mapW: number, mapH: number) {
  const c = centerTile(cam, view);
  const x = Math.max(0, Math.min(mapW - 1, c.x));
  const y = Math.max(0, Math.min(mapH - 1, c.y));
  if (x !== c.x || y !== c.y) centerOn(cam, x, y, view);
}

export function panBy(cam: Camera, dx: number, dy: number) {
  cam.ox += dx;
  cam.oy += dy;
}

/** Zoom so the point under (sx, sy) stays exactly where it is on screen. */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number) {
  const before = screenToTile(sx, sy, cam);
  cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * factor));
  const after = tileToScreen(before.x, before.y, cam);
  cam.ox += sx - after.sx;
  cam.oy += sy - after.sy;
}

/**
 * Pan velocity from the pointer's distance to the screen edge.
 *
 * A narrow band, so aiming at a unit near the edge doesn't send the camera
 * away — and only for a real mouse inside the window.
 */
export function edgePan(
  px: number,
  py: number,
  view: View,
  band = 10,
  speed = 900,
): { vx: number; vy: number } {
  let vx = 0;
  let vy = 0;
  if (px <= band) vx = speed;
  else if (px >= view.width - band) vx = -speed;
  if (py <= band) vy = speed;
  else if (py >= view.height - band) vy = -speed;
  return { vx, vy };
}

/** The four screen corners as tile positions — the minimap's view outline. */
export function viewCorners(cam: Camera, view: View) {
  return [
    screenToTile(0, 0, cam),
    screenToTile(view.width, 0, cam),
    screenToTile(view.width, view.height, cam),
    screenToTile(0, view.height, cam),
  ];
}

import { inBounds, passable } from "./map.ts";
import type { GameMap } from "./types.ts";

/**
 * A* on the tile grid, 8-directional.
 *
 * Two RTS-specific details matter here:
 *
 * 1. Diagonal moves are forbidden when both orthogonal neighbours are blocked,
 *    otherwise units slip through the corner between two trees.
 * 2. An unreachable goal returns the path to the closest reachable tile rather
 *    than nothing. Right-clicking a tree should walk you to the tree, not
 *    leave the unit standing still looking broken.
 */

const SQRT2 = Math.SQRT2;

/** Bounds the worst case so a blocked goal can't stall a frame. */
const MAX_EXPANSIONS = 6000;

interface Blocked {
  /** Extra impassable tiles (building footprints). */
  has(x: number, y: number): boolean;
}

/** A tiny binary heap; a sorted array is too slow once paths get long. */
class Heap {
  private items: number[] = [];
  private score: number[] = [];

  get size() {
    return this.items.length;
  }

  push(item: number, score: number) {
    this.items.push(item);
    this.score.push(score);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.score[parent] <= this.score[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastScore = this.score.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem;
      this.score[0] = lastScore;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < this.items.length && this.score[l] < this.score[best]) best = l;
        if (r < this.items.length && this.score[r] < this.score[best]) best = r;
        if (best === i) break;
        this.swap(best, i);
        i = best;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.score[a], this.score[b]] = [this.score[b], this.score[a]];
  }
}

function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax > ay ? ax - ay + SQRT2 * ay : ay - ax + SQRT2 * ax;
}

/**
 * `near`, when given, marks tiles that are as good as the goal — standing
 * next to a tree, beside a building, in bow range of a target.
 *
 * It matters a great deal for speed. Those goals are usually impassable, so a
 * search for the goal tile itself can never succeed: A* floods every
 * reachable tile on the map before settling for the closest one. Profiled,
 * that made pathfinding over half of all simulation time, most of it spent
 * finding the spot next to a bush.
 */
export function findPath(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  blocked?: Blocked,
  near?: (x: number, y: number) => boolean,
): { x: number; y: number }[] {
  const startX = Math.round(sx);
  const startY = Math.round(sy);
  const goalX = Math.round(gx);
  const goalY = Math.round(gy);

  if (startX === goalX && startY === goalY) return [];

  // With no explicit notion of "near enough", an impassable goal tile is
  // reached by standing beside it.
  const goalBlocked = !(
    inBounds(map, goalX, goalY) &&
    passable(map, goalX, goalY) &&
    !blocked?.has(goalX, goalY)
  );
  const accept =
    near ??
    (goalBlocked
      ? (x: number, y: number) => Math.max(Math.abs(x - goalX), Math.abs(y - goalY)) <= 1
      : null);
  if (accept?.(startX, startY)) return [];

  const W = map.width;
  const open = new Heap();
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();

  const key = (x: number, y: number) => y * W + x;
  const walkable = (x: number, y: number) =>
    inBounds(map, x, y) && passable(map, x, y) && !blocked?.has(x, y);

  const startKey = key(startX, startY);
  gScore.set(startKey, 0);
  open.push(startKey, octile(goalX - startX, goalY - startY));

  // If the goal itself is blocked (a tree, a building), settle for the nearest
  // tile we actually reached.
  let bestKey = startKey;
  let bestH = octile(goalX - startX, goalY - startY);
  let expansions = 0;

  while (open.size > 0 && expansions < MAX_EXPANSIONS) {
    const current = open.pop();
    if (closed.has(current)) continue;
    closed.add(current);
    expansions++;

    const cx = current % W;
    const cy = (current - cx) / W;

    if ((cx === goalX && cy === goalY) || accept?.(cx, cy)) {
      bestKey = current;
      bestH = 0;
      break;
    }

    const h = octile(goalX - cx, goalY - cy);
    if (h < bestH) {
      bestH = h;
      bestKey = current;
    }

    const g = gScore.get(current)!;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!walkable(nx, ny)) continue;

        // No cutting corners between two blocked orthogonals.
        if (dx !== 0 && dy !== 0) {
          if (!walkable(cx + dx, cy) || !walkable(cx, cy + dy)) continue;
        }

        const nKey = key(nx, ny);
        if (closed.has(nKey)) continue;

        const step = dx !== 0 && dy !== 0 ? SQRT2 : 1;
        const tentative = g + step;
        const known = gScore.get(nKey);
        if (known !== undefined && known <= tentative) continue;

        gScore.set(nKey, tentative);
        cameFrom.set(nKey, current);
        open.push(nKey, tentative + octile(goalX - nx, goalY - ny));
      }
    }
  }

  // Walk the parent chain back and reverse it.
  const path: { x: number; y: number }[] = [];
  let cursor = bestKey;
  while (cursor !== startKey) {
    const x = cursor % W;
    const y = (cursor - x) / W;
    path.push({ x, y });
    const parent = cameFrom.get(cursor);
    if (parent === undefined) break;
    cursor = parent;
  }
  path.reverse();
  return path;
}

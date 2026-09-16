import { UNITS, isUnit } from "./config.ts";
import { passable } from "./map.ts";
import {
  applyState,
  buildingBlocker,
  finishAt,
  queueOrder,
} from "./world.ts";
import { findPath } from "./pathfind.ts";
import type { Entity, Formation, UnitKind, UnitState, World } from "./types.ts";

/**
 * Group movement.
 *
 * Without this, twenty selected units given one order all path to the same
 * tile, arrive in a heap, and get shoved apart by separation. With it, a
 * selection moves like an army: a shape at the destination, the fighting line
 * in front, the archers behind it, and everyone arriving together instead of
 * the riders turning up alone and dying.
 */

export const FORMATIONS: Formation[] = ["line", "box", "column", "spread"];

const SPACING = 0.95;

/**
 * Who stands where. Lower ranks take the front rows.
 *
 * Spearmen hold the front because they're what stops a charge; archers go last
 * because they're what a charge is trying to reach.
 */
const RANK: Record<UnitKind, number> = {
  spearman: 0,
  rider: 1,
  villager: 2,
  scout: 2,
  archer: 3,
};

function columnsFor(formation: Formation, n: number): number {
  switch (formation) {
    case "line":
      return Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n) * 2.2)));
    case "column":
      return Math.min(n, 2);
    case "box":
    case "spread":
      return Math.max(1, Math.ceil(Math.sqrt(n)));
  }
}

/**
 * Offsets for `n` slots around a target, in rows from front to back.
 *
 * `facing` is the direction of travel. The formation is centred on the target
 * rather than having its front line at it, which is what players expect when
 * they click where they want the army to be.
 */
export function formationSlots(
  n: number,
  formation: Formation,
  facing: { x: number; y: number },
): { dx: number; dy: number; row: number }[] {
  const len = Math.hypot(facing.x, facing.y) || 1;
  const fx = facing.x / len;
  const fy = facing.y / len;
  // Right-hand axis, perpendicular to travel.
  const rx = -fy;
  const ry = fx;

  const spacing = formation === "spread" ? SPACING * 2 : SPACING;
  const cols = columnsFor(formation, n);
  const rows = Math.ceil(n / cols);
  const slots: { dx: number; dy: number; row: number }[] = [];

  for (let row = 0; row < rows; row++) {
    const inRow = Math.min(cols, n - row * cols);
    for (let col = 0; col < inRow; col++) {
      // Centre each row, including a short last row.
      const lateral = (col - (inRow - 1) / 2) * spacing;
      // Row 0 is the front; later rows fall back. Centre the block on target.
      const forward = ((rows - 1) / 2 - row) * spacing;
      slots.push({
        dx: fx * forward + rx * lateral,
        dy: fy * forward + ry * lateral,
        row,
      });
    }
  }
  return slots;
}

export interface GroupOrder {
  tx: number;
  ty: number;
  formation: Formation;
  /** Attack-move rather than a plain move. */
  attack: boolean;
  /** Append to each unit's queue instead of replacing its orders. */
  queue: boolean;
}

/**
 * Move a group to a point in formation.
 *
 * Speeds are matched so everyone arrives at once: each unit is capped at the
 * pace that gets it to its slot in the time the slowest-to-arrive unit needs.
 * A pack that starts together therefore moves together, and a straggler far
 * behind sets the pace for the rest instead of being abandoned.
 */
export function commandGroup(world: World, units: Entity[], order: GroupOrder) {
  const movers = units.filter((u) => isUnit(u.kind));
  if (movers.length === 0) return;

  if (movers.length === 1) {
    const state: UnitState = order.attack
      ? { name: "attackMove", tx: order.tx, ty: order.ty }
      : { name: "moving", tx: order.tx, ty: order.ty };
    issue(world, movers[0], state, order.queue);
    return;
  }

  const cx = movers.reduce((a, u) => a + u.x, 0) / movers.length;
  const cy = movers.reduce((a, u) => a + u.y, 0) / movers.length;
  const facing = { x: order.tx - cx, y: order.ty - cy };
  const slots = formationSlots(movers.length, order.formation, facing);

  // Fill front rows with front-line units, then within each row assign left
  // to right by where units currently stand, so paths don't cross.
  const rankOf = (u: Entity) => RANK[u.kind as UnitKind];
  const ordered = [...movers].sort((a, b) => rankOf(a) - rankOf(b));
  const len = Math.hypot(facing.x, facing.y) || 1;
  const rx = -facing.y / len;
  const ry = facing.x / len;
  const lateral = (x: number, y: number) => (x - cx) * rx + (y - cy) * ry;

  const assignments: { unit: Entity; x: number; y: number }[] = [];
  let cursor = 0;
  const rowCount = Math.max(...slots.map((s) => s.row)) + 1;
  for (let row = 0; row < rowCount; row++) {
    const rowSlots = slots
      .filter((s) => s.row === row)
      .sort((a, b) => a.dx * rx + a.dy * ry - (b.dx * rx + b.dy * ry));
    const rowUnits = ordered
      .slice(cursor, cursor + rowSlots.length)
      .sort((a, b) => lateral(a.x, a.y) - lateral(b.x, b.y));
    cursor += rowSlots.length;
    rowSlots.forEach((slot, i) => {
      assignments.push({
        unit: rowUnits[i],
        ...settle(world, order.tx + slot.dx, order.ty + slot.dy),
      });
    });
  }

  // Path everyone, then match speeds from the resulting path lengths.
  const blocker = buildingBlocker(world);
  const plans = assignments.map((a) => {
    const path = finishAt(world, findPath(world.map, a.unit.x, a.unit.y, a.x, a.y, blocker), a.x, a.y);
    let length = 0;
    let px = a.unit.x;
    let py = a.unit.y;
    for (const step of path) {
      length += Math.hypot(step.x - px, step.y - py);
      px = step.x;
      py = step.y;
    }
    return { ...a, path, length, speed: UNITS[a.unit.kind as UnitKind].speed };
  });

  const eta = Math.max(...plans.map((p) => p.length / p.speed));
  const matchSpeeds = eta > 1.5; // not worth it for a short shuffle

  for (const p of plans) {
    const capped = matchSpeeds
      ? Math.max(p.speed * 0.3, Math.min(p.speed, p.length / eta))
      : undefined;
    const state: UnitState = order.attack
      ? { name: "attackMove", tx: p.x, ty: p.y, speed: capped }
      : { name: "moving", tx: p.x, ty: p.y, speed: capped };
    if (order.queue) {
      queueOrder(world, p.unit, state);
    } else {
      p.unit.orders = [];
      p.unit.state = state;
      p.unit.path = p.path;
    }
  }
}

function issue(world: World, unit: Entity, state: UnitState, queue: boolean) {
  if (queue) {
    queueOrder(world, unit, state);
  } else {
    unit.orders = [];
    applyState(world, unit, state);
  }
}

/** Nudge a slot onto walkable ground if it landed in a tree or a lake. */
function settle(world: World, x: number, y: number): { x: number; y: number } {
  const tx = Math.round(x);
  const ty = Math.round(y);
  if (passable(world.map, tx, ty)) return { x, y };
  for (let r = 1; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (passable(world.map, tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy };
      }
    }
  }
  return { x, y };
}

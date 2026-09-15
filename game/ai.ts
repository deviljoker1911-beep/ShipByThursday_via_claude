import { BUILDINGS, UNITS, isBuilding, isUnit } from "./config.ts";
import { nearestResourceTile } from "./world.ts";
import {
  canAfford,
  canPlaceBuilding,
  commandAttack,
  commandBuild,
  commandGather,
  enqueueTraining,
  pay,
  spawn,
} from "./world.ts";
import type { BuildingKind, Entity, World } from "./types.ts";

/**
 * The opponent.
 *
 * Deliberately legible rather than clever: it economises early, expands
 * housing when capped, and attacks in waves once it has a band worth
 * committing. It cheats at nothing — same costs, same build times, same
 * gather rates as the player.
 */

interface AiMemory {
  nextThink: number;
  nextAttack: number;
  wave: number;
}

const memory: AiMemory = { nextThink: 0, nextAttack: 75, wave: 0 };

export function resetAi() {
  memory.nextThink = 0;
  memory.nextAttack = 75;
  memory.wave = 0;
}

function own(world: World): Entity[] {
  return [...world.entities.values()].filter((e) => e.owner === 1);
}

export function tickAi(world: World, dt: number) {
  if (world.outcome !== "playing") return;
  memory.nextThink -= dt;
  if (memory.nextThink > 0) return;
  memory.nextThink = 1.2;

  const mine = own(world);
  const tc = mine.find((e) => e.kind === "towncenter");
  if (!tc) return;

  const villagers = mine.filter((e) => e.kind === "villager");
  const soldiers = mine.filter((e) => e.kind === "spearman" || e.kind === "archer");
  const barracks = mine.filter((e) => e.kind === "barracks" && e.progress === 1);
  const player = world.players[1];

  // Idle villagers always go back to work; an idle economy is how an AI loses
  // without ever being fought.
  for (const v of villagers) {
    if (v.state?.name !== "idle") continue;
    const wantWood = player.wood < player.gold * 1.6;
    const target = nearestResourceTile(world.map, wantWood ? "wood" : "gold", v.x, v.y);
    if (target) commandGather(world, v, target.x, target.y);
  }

  // Housing before it's actually capped, since building takes time.
  if (player.pop >= player.popCap - 2 && canAfford(world, 1, BUILDINGS.house.cost)) {
    placeBuilding(world, tc, "house", villagers);
  }

  // Economy first, then military production.
  if (villagers.length < 10) {
    enqueueTraining(world, tc, "villager");
  }

  if (barracks.length === 0 && villagers.length >= 5) {
    if (canAfford(world, 1, BUILDINGS.barracks.cost)) {
      placeBuilding(world, tc, "barracks", villagers);
    }
  }

  for (const b of barracks) {
    if ((b.queue?.length ?? 0) >= 2) continue;
    const kind = Math.random() < 0.55 ? "spearman" : "archer";
    enqueueTraining(world, b, kind);
  }

  // Attack in waves, each larger than the last.
  memory.nextAttack -= 1.2;
  const needed = 4 + memory.wave * 2;
  if (memory.nextAttack <= 0 && soldiers.length >= needed) {
    const targets = [...world.entities.values()].filter((e) => e.owner === 0);
    const tcTarget =
      targets.find((e) => e.kind === "towncenter") ?? targets[0];
    if (tcTarget) {
      for (const s of soldiers) commandAttack(world, s, tcTarget.id);
      memory.wave++;
      memory.nextAttack = 90;
    }
  }
}

function placeBuilding(
  world: World,
  near: Entity,
  kind: BuildingKind,
  villagers: Entity[],
) {
  if (villagers.length === 0) return;
  for (let attempt = 0; attempt < 24; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 4 + Math.random() * 5;
    const x = Math.round(near.x + Math.cos(angle) * dist);
    const y = Math.round(near.y + Math.sin(angle) * dist);
    if (!canPlaceBuilding(world, kind, x, y)) continue;
    pay(world, 1, BUILDINGS[kind].cost);
    const site = spawn(world, kind, 1, x, y, 0.01);
    // Two builders so it doesn't crawl.
    for (const v of villagers.slice(0, 2)) commandBuild(world, v, site.id);
    return;
  }
}

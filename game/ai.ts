import { BUILDINGS, UNITS, isBuilding, maxHp } from "./config.ts";
import {
  canAfford,
  canPlaceBuilding,
  commandAttack,
  commandAttackMove,
  commandBuild,
  commandGather,
  commandMove,
  commandRepair,
  distanceTo,
  soundAlarm,
  rand,
  enqueueTraining,
  nearestResourceTile,
  pay,
  spawn,
} from "./world.ts";
import type { ArmourClass } from "./config.ts";
import { knownEnemyBuildings, tileExplored, visibleEnemies } from "./fog.ts";
import { commandGroup } from "./formation.ts";
import type { BuildingKind, Entity, Owner, Resource, UnitKind, World } from "./types.ts";

/**
 * The opponent.
 *
 * Deliberately legible rather than clever. It should look like someone is
 * playing: economising early, reacting when attacked, rebuilding what it
 * loses, and choosing units that answer what it has seen. It cheats at
 * nothing — same costs, same build times, same gather rates, same population
 * rules as the player.
 */

interface AiMemory {
  nextThink: number;
  nextAttack: number;
  wave: number;
  /** Enemy composition last observed, by armour class. */
  seen: Record<ArmourClass, number>;
  scoutId: number | null;
  scoutTarget: { x: number; y: number } | null;
  /** Whether the scout has been to the enemy's starting position yet. */
  scoutedStart: boolean;
  /**
   * Where enemy villagers were last seen working. Under fog the AI can't raid
   * what it can't see, so it raids where it last saw them — which is exactly
   * what a human does.
   */
  workerSightings: { x: number; y: number; at: number }[];
  /** Set while hostiles are near our own buildings. */
  defending: boolean;
}

function blankMemory(): AiMemory {
  return {
    nextThink: 0,
    nextAttack: 70,
    wave: 0,
    seen: { infantry: 0, ranged: 0, cavalry: 0, building: 0 },
    scoutId: null,
    scoutTarget: null,
    scoutedStart: false,
    workerSightings: [],
    defending: false,
  };
}

/**
 * One memory per side.
 *
 * Keyed by owner rather than held as a singleton so the same brain can play
 * both seats — which is what makes a full automated match possible, and is
 * also the only honest way to check the AI is a real opponent rather than
 * something that only works against a passive player.
 */
const memories = new Map<Owner, AiMemory>();

function mem(owner: Owner): AiMemory {
  let m = memories.get(owner);
  if (!m) {
    m = blankMemory();
    memories.set(owner, m);
  }
  return m;
}

export function resetAi() {
  memories.clear();
}

/**
 * What the AI is allowed to know: enemies currently in its sight.
 *
 * Nothing else. The AI plays under the same fog as the player — it finds the
 * enemy base by scouting it, and attacks what it has seen or remembers.
 */
function perceive(world: World, owner: Owner): Entity[] {
  return visibleEnemies(world, owner);
}

function mine(world: World, owner: Owner): Entity[] {
  return [...world.entities.values()].filter((e) => e.owner === owner);
}

export function tickAi(world: World, dt: number, owner: Owner = 1) {
  if (world.outcome !== "playing") return;
  const memory = mem(owner);
  memory.nextThink -= dt;
  memory.nextAttack -= dt;
  if (memory.nextThink > 0) return;
  memory.nextThink = 1.1;

  const own = mine(world, owner);
  const tc = own.find((e) => e.kind === "towncenter");
  if (!tc) return;

  const villagers = own.filter((e) => e.kind === "villager");
  const army = own.filter(
    (e) => e.kind === "spearman" || e.kind === "archer" || e.kind === "rider",
  );
  const buildings = own.filter((e) => isBuilding(e.kind));
  const barracks = buildings.filter((b) => b.kind === "barracks" && b.progress === 1);
  const p = world.players[owner];

  observe(world, owner, memory);
  defendIfAttacked(world, own, army, buildings, owner, memory);
  // While a raid is on, sheltering villagers arrive idle; putting them back to
  // work here would march them straight back into it.
  if (!memory.defending) {
    staffConstruction(world, villagers, buildings);
    keepVillagersWorking(world, villagers, p);
  }
  repairDamage(world, villagers, buildings);
  manageConstruction(world, tc, villagers, buildings, p, owner, memory);
  manageProduction(world, tc, barracks, villagers, owner, memory);
  manageScout(world, own, tc, owner, memory);
  if (!memory.defending) considerAttack(world, army, owner, memory);
}

/** Note the enemy's composition so unit choices can answer it. */
function observe(world: World, owner: Owner, memory: AiMemory) {
  const seen: Record<ArmourClass, number> = {
    infantry: 0,
    ranged: 0,
    cavalry: 0,
    building: 0,
  };
  for (const e of perceive(world, owner)) {
    if (isBuilding(e.kind)) {
      seen.building++;
    } else if (e.kind === "villager") {
      memory.workerSightings.push({ x: e.x, y: e.y, at: world.time });
    } else if (e.kind === "scout") {
      // Deliberately ignored. Counting a lone scout as "cavalry" once made the
      // AI build nothing but spearmen against an army of archers, which
      // counter spearmen — every unit it trained died on arrival.
      continue;
    } else {
      seen[UNITS[e.kind as UnitKind].armourClass]++;
    }
  }
  // Under fog, a glimpse is all you get. Keep what was seen and let it fade,
  // rather than forgetting an army the moment it steps out of sight.
  for (const k of Object.keys(seen) as ArmourClass[]) {
    memory.seen[k] = Math.max(memory.seen[k] * 0.97, seen[k]);
  }
  memory.workerSightings = memory.workerSightings
    .filter((w) => world.time - w.at < 90)
    .slice(-12);
}

/**
 * Make sure every unfinished site has someone working on it.
 *
 * Builders drop their job for all sorts of reasons — the site got walled in,
 * the villager was killed, a path expired. Without this a paid-for site sits
 * at 1% forever; and when that site is a house, the population cap never
 * rises and the entire economy stops with it.
 */
function staffConstruction(world: World, villagers: Entity[], buildings: Entity[]) {
  const sites = buildings.filter((b) => (b.progress ?? 1) < 1);
  if (sites.length === 0) return;

  for (const site of sites) {
    const working = villagers.filter(
      (v) => v.state?.name === "building" && v.state.targetId === site.id,
    ).length;
    if (working >= 2) continue;

    const free = villagers
      .filter((v) => v.state?.name === "idle" || v.state?.name === "gathering")
      .sort((a, b) => distanceTo(site, a.x, a.y) - distanceTo(site, b.x, b.y))
      .slice(0, 2 - working);
    for (const v of free) commandBuild(world, v, site.id);
  }
}

/**
 * Keep the workforce matched to what the economy needs.
 *
 * Assigning only *idle* villagers is not enough: a gatherer carries on with
 * the same resource forever, so whatever was assigned in the first minute
 * stays assigned all match. Measured, that left one AI mining stone and wood
 * with food stuck under 45 — it could never afford a single soldier. So each
 * think, idle villagers go where they're most needed, and one busy villager is
 * moved from the most over-staffed resource to the most under-staffed.
 */
const SHARE: Record<Resource, number> = { food: 0.42, wood: 0.33, gold: 0.17, stone: 0.08 };

function keepVillagersWorking(world: World, villagers: Entity[], p: World["players"][Owner]) {
  if (villagers.length === 0) return;

  const working = (r: Resource) =>
    villagers.filter(
      (v) =>
        (v.state?.name === "gathering" || v.state?.name === "returning") &&
        v.state.resource === r,
    );

  // A big stockpile means that resource needs fewer hands right now.
  const want = (r: Resource) => {
    const glut = p[r] > 450 ? 0.4 : p[r] > 250 ? 0.75 : 1;
    return SHARE[r] * glut;
  };
  const resources: Resource[] = ["food", "wood", "gold", "stone"];
  const totalWant = resources.reduce((acc, r) => acc + want(r), 0);
  const gap = (r: Resource) =>
    (want(r) / totalWant) * villagers.length - working(r).length;
  const neediest = () => [...resources].sort((a, b) => gap(b) - gap(a))[0];

  for (const v of villagers.filter((v) => v.state?.name === "idle")) {
    assign(world, v, neediest());
  }

  // One reassignment per think keeps the economy responsive without the
  // whole workforce sloshing back and forth.
  const short = neediest();
  const surplus = [...resources].sort((a, b) => gap(a) - gap(b))[0];
  if (gap(short) >= 1 && gap(surplus) <= -1) {
    const mover = working(surplus).find((v) => !v.carrying || v.carrying.amount < 3);
    if (mover) assign(world, mover, short);
  }
}

function assign(world: World, v: Entity, want: Resource) {
  const tile = nearestResourceTile(world.map, want, v.x, v.y, 26);
  if (tile) {
    v.orders = [];
    commandGather(world, v, tile.x, tile.y);
    return;
  }
  // Nothing of that kind in reach; take anything rather than stand still.
  for (const alt of ["wood", "gold", "food", "stone"] as Resource[]) {
    const any = nearestResourceTile(world.map, alt, v.x, v.y, 30);
    if (any) {
      v.orders = [];
      commandGather(world, v, any.x, any.y);
      return;
    }
  }
}

/** Pull the army home when hostiles reach our buildings. */
function defendIfAttacked(
  world: World,
  own: Entity[],
  army: Entity[],
  buildings: Entity[],
  owner: Owner,
  memory: AiMemory,
) {
  // What counts as an attack matters enormously.
  //
  // Treating any hostile near a building as an emergency means a single
  // wandering scout pins the entire army at home — and because both sides
  // scout, neither ever attacks and the match never resolves. Worse, the army
  // is sent to chase a scout that is faster than all of it.
  //
  // So: a raid is two or more actual combat units, or a building visibly
  // taking damage. One fast rider passing by is not an invasion.
  const raiders: Entity[] = [];
  for (const foe of perceive(world, owner)) {
    if (foe.kind !== "spearman" && foe.kind !== "archer" && foe.kind !== "rider") continue;
    if (buildings.some((b) => distanceTo(b, foe.x, foe.y) < 11)) raiders.push(foe);
  }
  const hurt = buildings.find((b) => (b.progress ?? 1) === 1 && b.hp < maxHp(b.kind) * 0.95);

  memory.defending = raiders.length >= 2 || (raiders.length >= 1 && hurt !== undefined);
  if (!memory.defending) return;

  const target = raiders[0];

  // Outnumbered: get the workers out of the way first. Villagers left
  // gathering beside a raiding party are the whole early game, lost.
  if (army.length < raiders.length * 1.5) {
    soundAlarm(world, owner, { x: target.x, y: target.y }, 14);
  }

  for (const s of army) {
    if (s.state?.name === "attacking") continue;
    commandAttack(world, s, target.id);
  }
}

/** Patch up damaged buildings between attacks. */
function repairDamage(world: World, villagers: Entity[], buildings: Entity[]) {
  const hurt = buildings.find(
    (b) => b.progress === 1 && b.hp < maxHp(b.kind) * 0.7,
  );
  if (!hurt) return;
  const free = villagers.find(
    (v) => v.state?.name === "gathering" || v.state?.name === "idle",
  );
  if (free) commandRepair(world, free, hurt.id);
}

function manageConstruction(
  world: World,
  tc: Entity,
  villagers: Entity[],
  buildings: Entity[],
  p: World["players"][Owner],
  owner: Owner,
  memory: AiMemory,
) {
  const done = (kind: BuildingKind) =>
    buildings.filter((b) => b.kind === kind).length;

  // Two sites at a time. Anything more and villagers are spread too thin to
  // finish any of them, while the resources are already spent.
  const inProgress = buildings.filter((b) => (b.progress ?? 1) < 1).length;
  if (inProgress >= 2) return;

  // Population already paid for but not yet standing.
  //
  // This has to be counted, because the cap only rises when a building
  // completes. Judging "am I capped?" on completed buildings alone means the
  // AI places another house every think-tick for the entire ten seconds the
  // first one takes to build — it buries itself in housing and never reaches
  // the branch that builds a barracks.
  const pending = buildings
    .filter((b) => (b.progress ?? 1) < 1)
    .reduce((sum, b) => sum + (BUILDINGS[b.kind as BuildingKind].popBonus ?? 0), 0);

  if (p.pop >= p.popCap + pending - 3 && canAfford(world, owner, BUILDINGS.house.cost)) {
    place(world, tc, "house", villagers, 4, 9, owner);
    return;
  }
  // Farms give food that never runs out, which matters once nearby game is gone.
  // Farms are the food that doesn't run out; lean on them once forage is gone.
  const forageLeft = nearestResourceTile(world.map, "food", tc.x, tc.y, 14) !== null;
  const farmTarget = forageLeft ? 2 : 5;
  if (done("farm") < farmTarget && villagers.length >= 6 && canAfford(world, owner, BUILDINGS.farm.cost)) {
    place(world, tc, "farm", villagers, 3, 6, owner);
    return;
  }
  if (done("barracks") === 0 && villagers.length >= 5) {
    if (canAfford(world, owner, BUILDINGS.barracks.cost)) {
      place(world, tc, "barracks", villagers, 5, 9, owner);
    }
    return;
  }
  // A second barracks once the economy can sustain two production lines.
  if (done("barracks") === 1 && villagers.length >= 12 && p.wood > 260) {
    place(world, tc, "barracks", villagers, 5, 10, owner);
    return;
  }
  // Towers once there's stone and a reason — either we've been hit, or we're
  // far enough along that a raid is coming.
  if (
    done("tower") < 2 &&
    (memory.defending || memory.wave >= 1) &&
    canAfford(world, owner, BUILDINGS.tower.cost)
  ) {
    place(world, tc, "tower", villagers, 4, 7, owner);
  }
}

function manageProduction(
  world: World,
  tc: Entity,
  barracks: Entity[],
  villagers: Entity[],
  owner: Owner,
  memory: AiMemory,
) {
  // Economy first, and keep replacing losses — an AI that stops making
  // villagers after a raid never recovers.
  if (villagers.length < 14 && (tc.queue?.length ?? 0) < 2) {
    enqueueTraining(world, tc, "villager");
  }

  for (const b of barracks) {
    if ((b.queue?.length ?? 0) >= 2) continue;
    enqueueTraining(world, b, counterUnit(memory));
  }
}

/**
 * Pick the unit that answers what the enemy actually fields.
 *
 * With nothing seen yet it defaults to spearmen: the cheapest unit that isn't
 * badly beaten by anything, which is the right hedge under uncertainty.
 */
function counterUnit(memory: AiMemory): UnitKind {
  const { infantry, ranged, cavalry } = memory.seen;
  if (cavalry > infantry && cavalry > ranged) return "spearman";
  if (ranged > infantry && ranged >= cavalry) return "rider";
  if (infantry > 0) return "archer";
  return "spearman";
}

/** Keep one scout alive and moving, so the AI has seen the map it fights on. */
function manageScout(world: World, own: Entity[], tc: Entity, owner: Owner, memory: AiMemory) {
  const scout = memory.scoutId ? world.entities.get(memory.scoutId) : null;

  if (!scout) {
    memory.scoutId = null;
    const existing = own.find((e) => e.kind === "scout");
    if (existing) {
      memory.scoutId = existing.id;
    } else if (world.time > 25 && canAfford(world, owner, UNITS.scout.cost)) {
      enqueueTraining(world, tc, "scout");
    }
    return;
  }

  if (scout.state?.name !== "idle" && memory.scoutTarget) return;

  // First, where the enemy must have started — starting positions are public
  // on a two-player map. After that, somewhere not yet seen. A scout sent to
  // random points spends most of its life re-seeing its own base.
  const enemyStart = world.starts[owner === 0 ? 1 : 0];
  if (!memory.scoutedStart && enemyStart) {
    memory.scoutedStart = true;
    memory.scoutTarget = enemyStart;
  } else {
    memory.scoutTarget = unexploredSpot(world, owner);
  }
  // A plain move, not attack-move: a scout that stops to fight stops scouting.
  commandMove(world, scout, memory.scoutTarget.x, memory.scoutTarget.y);
}

function unexploredSpot(world: World, owner: Owner): { x: number; y: number } {
  const m = world.map;
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = 3 + Math.floor(rand(world) * (m.width - 6));
    const y = 3 + Math.floor(rand(world) * (m.height - 6));
    if (!tileExplored(world, owner, x, y)) return { x, y };
  }
  return { x: 3 + rand(world) * (m.width - 6), y: 3 + rand(world) * (m.height - 6) };
}

/** Commit when the army is worth committing, in waves that grow. */
function considerAttack(world: World, army: Entity[], owner: Owner, memory: AiMemory) {
  // Capped deliberately. An ever-growing threshold means both sides keep
  // massing and neither commits, which is how a match runs past the hour with
  // two full armies standing in their own bases.
  const needed = Math.min(5 + memory.wave * 2, 13);
  const idleArmy = army.filter((s) => s.state?.name === "idle").length;
  // If most of the army is standing around and it's big enough, go now —
  // waiting out a timer with twenty idle soldiers looks like indecision.
  const impatient = idleArmy >= needed && idleArmy >= army.length * 0.6;
  if ((memory.nextAttack > 0 && !impatient) || army.length < needed) return;

  // Objectives must be *static*. Sending a wave at a villager means sending it
  // after something that walks away, so the army chases one worker around the
  // map, the wave timer resets, and the enemy base is never actually attacked.
  // That single choice is the difference between a match that ends and one
  // that grinds on past the hour mark.
  // Buildings the AI has seen — now or before. Under fog, that is the only
  // list it has; it cannot aim at a base it has never found.
  const structures = knownEnemyBuildings(world, owner);
  // March at the town centre, not at the nearest useful building.
  //
  // Targeting the barracks seems smarter — it's the thing making the enemy
  // army — but the enemy rebuilds it, so there is always another barracks on
  // the perimeter and the push never gets past the outskirts. Measured over a
  // 30-minute match, town centre HP never moved from full and no attacker ever
  // came within eight tiles of one. Attack-move already makes the army fight
  // whatever stands in the way, so aiming at the base gets both: the perimeter
  // battle *and* an actual conclusion.
  const objective =
    structures.find((e) => e.kind === "towncenter") ??
    structures.find((e) => e.kind === "barracks") ??
    structures[0] ??
    // Nothing found yet (the scout died, say): march on the enemy's start.
    // Without this fallback a blind AI never attacks at all.
    world.starts[owner === 0 ? 1 : 0];
  if (!objective) return;

  // Alternate between razing the base and raiding the economy.
  //
  // Straight pushes alone produce an equilibrium: both sides lose armies at
  // the same rate and rebuild from untouched economies, so the match never
  // ends. Killing villagers is what actually decides real matches, because it
  // is the only damage the enemy cannot replace at full speed.
  //
  // (Flanking routes were tried here first and measurably hurt — splitting the
  // approach added travel time and weakened every push. Resolution rate fell
  // from 4 seeds in 8 to 2.)
  const sightings = memory.workerSightings;
  const raid = memory.wave % 3 !== 0 && sightings.length >= 2;
  const aim = raid ? sightings[Math.floor(rand(world) * sightings.length)] : objective;

  commandGroup(world, army, {
    tx: aim.x,
    ty: aim.y,
    formation: "line",
    attack: true,
    queue: false,
  });
  memory.wave++;
  memory.nextAttack = 55;
}

function place(
  world: World,
  near: Entity,
  kind: BuildingKind,
  villagers: Entity[],
  minDist: number,
  maxDist: number,
  owner: Owner,
) {
  if (villagers.length === 0) return;
  for (let attempt = 0; attempt < 30; attempt++) {
    const angle = rand(world) * Math.PI * 2;
    const dist = minDist + rand(world) * (maxDist - minDist);
    const x = Math.round(near.x + Math.cos(angle) * dist);
    const y = Math.round(near.y + Math.sin(angle) * dist);
    if (!canPlaceBuilding(world, kind, x, y)) continue;
    pay(world, owner, BUILDINGS[kind].cost);
    const site = spawn(world, kind, owner, x, y, 0.01);
    // Two builders so it doesn't crawl.
    const builders = villagers
      .filter((v) => v.state?.name !== "building")
      .slice(0, 2);
    for (const v of builders) commandBuild(world, v, site.id);
    return;
  }
}

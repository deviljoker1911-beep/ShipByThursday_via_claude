import type { BuildingKind, EntityKind, Resource, UnitKind } from "./types.ts";

/**
 * Balance lives here so it can be tuned in one place.
 *
 * Numbers are deliberately fast: a match should resolve in ten to twenty
 * minutes, not the forty a genre-standard game expects.
 */

/**
 * What a unit counts as when it's being hit.
 *
 * Counters are expressed as attacker bonuses against an armour class rather
 * than as a hardcoded unit-vs-unit table, so adding a unit doesn't mean
 * editing every other unit's stats.
 */
export type ArmourClass = "infantry" | "ranged" | "cavalry" | "building";

export interface UnitSpec {
  name: string;
  /** One line the HUD shows so the player learns counters without a manual. */
  role: string;
  hp: number;
  speed: number; // tiles per second
  attack: number;
  /** Flat reduction applied to incoming damage. */
  armour: number;
  armourClass: ArmourClass;
  /** Extra damage against particular armour classes — the counter system. */
  bonusVs?: Partial<Record<ArmourClass, number>>;
  range: number; // tiles
  attackSpeed: number; // seconds between swings
  /** How far it notices enemies, and how far it sees for fog purposes. */
  sight: number;
  cost: Partial<Record<Resource, number>>;
  trainTime: number; // seconds
  pop: number;
  radius: number; // tiles, for collision and hit-testing
}

export interface BuildingSpec {
  name: string;
  role: string;
  hp: number;
  armour: number;
  size: number; // footprint in tiles (square)
  sight: number;
  cost: Partial<Record<Resource, number>>;
  buildTime: number; // seconds of villager work
  trains: UnitKind[];
  popBonus?: number;
  dropOff?: boolean;
  foodPerSecond?: number;
  /** Defensive buildings shoot back. */
  attack?: number;
  range?: number;
  attackSpeed?: number;
  bonusVs?: Partial<Record<ArmourClass, number>>;
}

/**
 * The counter triangle.
 *
 *   Spearmen  beat  Riders    (braced spears stop a charge)
 *   Riders    beat  Archers   (closing distance fast)
 *   Archers   beat  Spearmen  (outranging slow infantry)
 *
 * Each bonus is large enough to decide a fight — roughly doubling effective
 * damage — because a counter the player can't feel isn't a counter, it's a
 * rounding error.
 */
export const UNITS: Record<UnitKind, UnitSpec> = {
  villager: {
    name: "Villager",
    role: "Gathers, builds, repairs. Can fight, badly.",
    hp: 45,
    speed: 2.4,
    attack: 3,
    armour: 0,
    armourClass: "infantry",
    range: 0.9,
    attackSpeed: 1.2,
    sight: 6,
    cost: { food: 50 },
    trainTime: 6,
    pop: 1,
    radius: 0.3,
  },
  spearman: {
    name: "Spearman",
    role: "Beats riders. Loses to archers.",
    hp: 85,
    speed: 2.0,
    attack: 8,
    armour: 1,
    armourClass: "infantry",
    bonusVs: { cavalry: 11, building: 4 },
    range: 0.9,
    attackSpeed: 1.1,
    sight: 7,
    cost: { food: 45, wood: 20 },
    trainTime: 9,
    pop: 1,
    radius: 0.34,
  },
  archer: {
    name: "Archer",
    role: "Beats spearmen. Loses to riders.",
    hp: 48,
    speed: 2.2,
    attack: 6,
    armour: 0,
    armourClass: "ranged",
    bonusVs: { infantry: 6 },
    range: 4.6,
    attackSpeed: 1.4,
    sight: 8,
    cost: { wood: 45, gold: 25 },
    trainTime: 11,
    pop: 1,
    radius: 0.32,
  },
  rider: {
    name: "Rider",
    role: "Fast. Beats archers. Loses to spearmen.",
    hp: 105,
    speed: 3.5,
    attack: 9,
    armour: 1,
    armourClass: "cavalry",
    bonusVs: { ranged: 9, building: 6 },
    range: 0.9,
    attackSpeed: 1.2,
    sight: 9,
    cost: { food: 60, gold: 30 },
    trainTime: 13,
    pop: 1,
    radius: 0.38,
  },
  scout: {
    name: "Scout",
    role: "Sees far, fights poorly. For finding the enemy.",
    hp: 60,
    speed: 4.0,
    attack: 3,
    armour: 0,
    armourClass: "cavalry",
    range: 0.9,
    attackSpeed: 1.5,
    sight: 13,
    cost: { food: 40 },
    trainTime: 7,
    pop: 1,
    radius: 0.34,
  },
};

export const BUILDINGS: Record<BuildingKind, BuildingSpec> = {
  towncenter: {
    name: "Town Centre",
    role: "Trains villagers. Drop-off point. Lose it and you lose.",
    // Measured: at 900 HP and armour 2, six melee units razed it in about
    // sixteen seconds, and a passive player lost at 2:37. It has to survive
    // long enough for a player to notice and respond.
    hp: 1800,
    armour: 3,
    size: 3,
    sight: 11,
    cost: { wood: 300 },
    buildTime: 40,
    trains: ["villager", "scout"],
    popBonus: 8,
    dropOff: true,
    // A town centre that can't defend itself makes an early rush unanswerable:
    // measured, five soldiers at minute two killed all thirteen of a
    // defender's villagers inside sixty seconds. Modest arrows give the
    // defender a place to retreat to, which turns a rush into a decision.
    attack: 6,
    range: 6,
    attackSpeed: 2,
  },
  house: {
    name: "House",
    role: "Raises the population cap by 6.",
    hp: 190,
    armour: 0,
    size: 2,
    sight: 5,
    cost: { wood: 30 },
    buildTime: 10,
    trains: [],
    popBonus: 6,
  },
  barracks: {
    name: "Barracks",
    role: "Trains spearmen, archers and riders.",
    hp: 520,
    armour: 1,
    size: 3,
    sight: 7,
    cost: { wood: 120 },
    buildTime: 22,
    trains: ["spearman", "archer", "rider"],
  },
  farm: {
    name: "Farm",
    role: "A steady trickle of food. Never runs out.",
    hp: 110,
    armour: 0,
    size: 2,
    sight: 3,
    cost: { wood: 55 },
    buildTime: 12,
    trains: [],
    foodPerSecond: 0.75,
  },
  storehouse: {
    name: "Storehouse",
    role: "Drop-off point. Build it beside distant resources.",
    hp: 320,
    armour: 1,
    size: 2,
    sight: 6,
    cost: { wood: 80 },
    buildTime: 15,
    trains: [],
    dropOff: true,
  },
  tower: {
    name: "Watchtower",
    role: "Shoots attackers and sees far. Costs stone.",
    hp: 540,
    armour: 3,
    size: 2,
    sight: 12,
    cost: { wood: 40, stone: 100 },
    buildTime: 20,
    trains: [],
    attack: 13,
    range: 6.5,
    attackSpeed: 1.5,
    bonusVs: { cavalry: 5 },
  },
};

export function isBuilding(kind: EntityKind): kind is BuildingKind {
  return kind in BUILDINGS;
}

export function isUnit(kind: EntityKind): kind is UnitKind {
  return kind in UNITS;
}

export function maxHp(kind: EntityKind): number {
  return isBuilding(kind) ? BUILDINGS[kind as BuildingKind].hp : UNITS[kind as UnitKind].hp;
}

export function armourOf(kind: EntityKind): number {
  return isBuilding(kind)
    ? BUILDINGS[kind as BuildingKind].armour
    : UNITS[kind as UnitKind].armour;
}

export function armourClassOf(kind: EntityKind): ArmourClass {
  return isBuilding(kind) ? "building" : UNITS[kind as UnitKind].armourClass;
}

export function sightOf(kind: EntityKind): number {
  return isBuilding(kind)
    ? BUILDINGS[kind as BuildingKind].sight
    : UNITS[kind as UnitKind].sight;
}

/**
 * Damage one entity deals to another, counters and armour included.
 *
 * Always at least 1, so a heavily-armoured target is a bad matchup rather than
 * an invincible one — a unit that can never hurt anything reads as broken.
 */
export function damageFrom(attackerKind: EntityKind, targetKind: EntityKind): number {
  const spec = isBuilding(attackerKind)
    ? BUILDINGS[attackerKind as BuildingKind]
    : UNITS[attackerKind as UnitKind];
  const base = (isBuilding(attackerKind) ? spec.attack ?? 0 : (spec as UnitSpec).attack) ?? 0;
  const bonus = spec.bonusVs?.[armourClassOf(targetKind)] ?? 0;
  const raw = Math.max(1, base + bonus - armourOf(targetKind));
  // Arrows barely scratch stone and timber. Without this, a mass of archers
  // — already the best unit against infantry — also razed a town centre in
  // under thirty seconds, and nothing else was worth building. Buildings are
  // for melee to break.
  if (attackRangeOf(attackerKind) > 2 && isBuilding(targetKind)) {
    return Math.max(1, Math.round(raw * 0.25));
  }
  return raw;
}

export function attackRangeOf(kind: EntityKind): number {
  return isBuilding(kind)
    ? BUILDINGS[kind as BuildingKind].range ?? 0
    : UNITS[kind as UnitKind].range;
}

export function attackSpeedOf(kind: EntityKind): number {
  return isBuilding(kind)
    ? BUILDINGS[kind as BuildingKind].attackSpeed ?? 2
    : UNITS[kind as UnitKind].attackSpeed;
}

/** Can this thing shoot at all? */
export function isArmed(kind: EntityKind): boolean {
  return isBuilding(kind) ? (BUILDINGS[kind as BuildingKind].attack ?? 0) > 0 : true;
}

export const CARRY_CAPACITY = 10;
export const GATHER_RATE = 1.4;
export const STARTING = { food: 320, wood: 320, gold: 120, stone: 80 };
export const STARTING_POP_CAP = 10;
export const HARD_POP_CAP = 70;
/** Villagers repair buildings at this fraction of their build rate. */
export const REPAIR_RATE = 0.7;

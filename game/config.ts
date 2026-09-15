import type { BuildingKind, EntityKind, Resource, UnitKind } from "./types.ts";

/**
 * Balance lives here so it can be tuned in one place.
 *
 * Numbers are deliberately fast: a full match should resolve in a few minutes,
 * not the forty a genre-standard game expects. Gather rates and train times are
 * roughly 3x a classic RTS.
 */

export interface UnitSpec {
  name: string;
  hp: number;
  speed: number; // tiles per second
  attack: number;
  range: number; // tiles
  attackSpeed: number; // seconds between swings
  cost: Partial<Record<Resource, number>>;
  trainTime: number; // seconds
  pop: number;
  radius: number; // tiles, for collision and hit-testing
}

export interface BuildingSpec {
  name: string;
  hp: number;
  size: number; // footprint in tiles (square)
  cost: Partial<Record<Resource, number>>;
  buildTime: number; // seconds of villager work
  /** What this building can train. */
  trains: UnitKind[];
  /** Adds to population cap. */
  popBonus?: number;
  /** Villagers can drop resources here. */
  dropOff?: boolean;
  /** Slowly generates food (farms). */
  foodPerSecond?: number;
}

export const UNITS: Record<UnitKind, UnitSpec> = {
  villager: {
    name: "Villager",
    hp: 40,
    speed: 2.4,
    attack: 3,
    range: 0.8,
    attackSpeed: 1.2,
    cost: { food: 50 },
    trainTime: 6,
    pop: 1,
    radius: 0.3,
  },
  spearman: {
    name: "Spearman",
    hp: 75,
    speed: 2.1,
    attack: 9,
    range: 0.9,
    attackSpeed: 1.1,
    cost: { food: 45, wood: 20 },
    trainTime: 9,
    pop: 1,
    radius: 0.34,
  },
  archer: {
    name: "Archer",
    hp: 50,
    speed: 2.3,
    attack: 7,
    range: 4.5,
    attackSpeed: 1.4,
    cost: { wood: 45, gold: 25 },
    trainTime: 11,
    pop: 1,
    radius: 0.32,
  },
};

export const BUILDINGS: Record<BuildingKind, BuildingSpec> = {
  towncenter: {
    name: "Town Centre",
    hp: 900,
    size: 3,
    cost: { wood: 300 },
    buildTime: 40,
    trains: ["villager"],
    popBonus: 8,
    dropOff: true,
  },
  house: {
    name: "House",
    hp: 180,
    size: 2,
    cost: { wood: 30 },
    buildTime: 10,
    trains: [],
    popBonus: 6,
  },
  barracks: {
    name: "Barracks",
    hp: 500,
    size: 3,
    cost: { wood: 120 },
    buildTime: 22,
    trains: ["spearman", "archer"],
  },
  farm: {
    name: "Farm",
    hp: 100,
    size: 2,
    cost: { wood: 55 },
    buildTime: 12,
    trains: [],
    foodPerSecond: 0.55,
  },
};

export function isBuilding(kind: EntityKind): kind is BuildingKind {
  return kind in BUILDINGS;
}

export function isUnit(kind: EntityKind): kind is UnitKind {
  return kind in UNITS;
}

export function maxHp(kind: EntityKind): number {
  return isBuilding(kind) ? BUILDINGS[kind].hp : UNITS[kind as UnitKind].hp;
}

/** How much a villager carries before returning to a drop-off. */
export const CARRY_CAPACITY = 10;
/** Resource units gathered per second. */
export const GATHER_RATE = 1.4;
/** Starting stockpile. */
export const STARTING = { food: 300, wood: 300, gold: 120 };
export const STARTING_POP_CAP = 8;
export const HARD_POP_CAP = 60;

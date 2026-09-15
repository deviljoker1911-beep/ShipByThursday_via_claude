/** Core model. Tile coordinates are floats; units move smoothly between tiles. */

export type Terrain = "grass" | "forest" | "gold" | "water" | "stone" | "forage";

export type Resource = "food" | "wood" | "gold" | "stone";

export type UnitKind = "villager" | "spearman" | "archer" | "rider" | "scout";
export type BuildingKind =
  | "towncenter"
  | "house"
  | "barracks"
  | "farm"
  | "storehouse"
  | "tower";
export type EntityKind = UnitKind | BuildingKind;

/** 0 is the human player, 1 is the AI. */
export type Owner = 0 | 1;

export type UnitState =
  | { name: "idle" }
  | { name: "moving"; tx: number; ty: number }
  | { name: "gathering"; tileX: number; tileY: number; resource: Resource }
  | { name: "returning"; resource: Resource }
  | { name: "building"; targetId: number }
  | { name: "repairing"; targetId: number }
  /** Walk to a point, but stop and engage anything hostile on the way. */
  | { name: "attackMove"; tx: number; ty: number }
  | { name: "attacking"; targetId: number };

export interface Entity {
  id: number;
  kind: EntityKind;
  owner: Owner;
  /** Centre position in tile units. */
  x: number;
  y: number;
  hp: number;
  /** Units only. */
  path?: { x: number; y: number }[];
  state?: UnitState;
  carrying?: { resource: Resource; amount: number };
  /** Cooldown timers in seconds. */
  attackCd?: number;
  gatherCd?: number;
  /** Buildings only: 0..1, below 1 means still under construction. */
  progress?: number;
  /** Buildings only: training queue with remaining seconds on the head item. */
  queue?: { kind: UnitKind; remaining: number }[];
  /** Rally point for trained units (buildings). */
  rally?: { x: number; y: number };
  /** Queued follow-up orders (shift-click). */
  orders?: UnitState[];
  /** Tile a villager was gathering from, so it can resume after banking. */
  workTile?: { x: number; y: number };
}

export interface Player {
  owner: Owner;
  food: number;
  wood: number;
  gold: number;
  stone: number;
  /** Population currently used and the cap from houses. */
  pop: number;
  popCap: number;
}

export interface GameMap {
  width: number;
  height: number;
  /** Row-major, length width*height. */
  terrain: Uint8Array;
  /** Remaining resource amount per tile, 0 where none. */
  amount: Uint16Array;
}

export interface World {
  map: GameMap;
  entities: Map<number, Entity>;
  players: Record<Owner, Player>;
  nextId: number;
  /** Seconds since the match began. */
  time: number;
  /**
   * Seeded RNG state for everything inside the simulation.
   *
   * Held as a plain number rather than a closure so a world can be
   * serialised — and so the same seed replays exactly, which is what makes a
   * bug reproducible and is the precondition for replays or lockstep play.
   * Nothing in the simulation may call Math.random().
   */
  rngState: number;
  outcome: "playing" | "won" | "lost";
  /** Transient notices for the HUD. */
  notices: { text: string; at: number }[];
  /** Short-lived visual events the renderer consumes; never read by the sim. */
  effects: Effect[];
}

/**
 * Presentation-only events.
 *
 * The simulation emits these and never reads them back, so the renderer stays
 * a pure consumer of state and the rules remain testable headlessly.
 */
export type Effect =
  | { kind: "projectile"; x: number; y: number; tx: number; ty: number; t: number; life: number; owner: Owner }
  | { kind: "impact"; x: number; y: number; t: number; life: number }
  | { kind: "marker"; x: number; y: number; t: number; life: number; hostile: boolean }
  | { kind: "death"; x: number; y: number; t: number; life: number; owner: Owner };

export const TERRAIN_IDS: Record<Terrain, number> = {
  grass: 0,
  forest: 1,
  gold: 2,
  water: 3,
  stone: 4,
  forage: 5,
};

export const TERRAIN_BY_ID: Terrain[] = [
  "grass",
  "forest",
  "gold",
  "water",
  "stone",
  "forage",
];

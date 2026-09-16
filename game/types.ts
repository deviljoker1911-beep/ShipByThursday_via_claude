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

/** How a group arranges itself when given one order. */
export type Formation = "line" | "box" | "column" | "spread";

export type UnitState =
  | { name: "idle" }
  /**
   * `speed` caps a unit below its natural pace so a group moving in
   * formation arrives together instead of stringing out by unit type.
   */
  | { name: "moving"; tx: number; ty: number; speed?: number }
  | { name: "gathering"; tileX: number; tileY: number; resource: Resource }
  | { name: "returning"; resource: Resource }
  | { name: "building"; targetId: number }
  | { name: "repairing"; targetId: number }
  /** Walk to a point, but stop and engage anything hostile on the way. */
  | { name: "attackMove"; tx: number; ty: number; speed?: number }
  /** Walk back and forth between two points, engaging anything seen. */
  | { name: "patrol"; ax: number; ay: number; bx: number; by: number; toB: boolean }
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
  /**
   * Earliest time this unit may request a new path.
   *
   * Several states used to re-run A* on every tick whenever their path was
   * empty. Against an unreachable target that is both a CPU storm and a unit
   * frozen in place; the cooldown bounds the first and the give-up paths
   * handle the second.
   */
  repathAt?: number;
}

export interface MatchStats {
  gathered: Record<Resource, number>;
  unitsTrained: number;
  unitsLost: number;
  buildingsBuilt: number;
  buildingsLost: number;
  kills: number;
}

/** What an enemy building looked like when a player last saw it. */
export interface Ghost {
  id: number;
  kind: BuildingKind;
  owner: Owner;
  x: number;
  y: number;
  progress: number;
}

/**
 * One player's knowledge of the map.
 *
 * Lives in the simulation rather than the renderer because it is gameplay,
 * not decoration: the AI plans from it, and what a player can target depends
 * on it.
 */
export interface Vision {
  /** 1 once a tile has ever been seen. */
  explored: Uint8Array;
  /** 1 while a tile is currently in sight. */
  visible: Uint8Array;
  /** Last-known enemy buildings, kept after they drop out of sight. */
  ghosts: Map<number, Ghost>;
  /** Vision is recomputed on an interval, not every tick. */
  nextUpdate: number;
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
  /** Bumped when a building appears or disappears; keys the path blocker cache. */
  buildingVersion: number;
  /** Bumped when terrain changes (a tree felled); keys the minimap cache. */
  terrainVersion: number;
  /** Starting positions. Public map knowledge, as in most RTS games. */
  starts: { x: number; y: number }[];
  stats: Record<Owner, MatchStats>;
  vision: Record<Owner, Vision>;
}

/**
 * Presentation-only events.
 *
 * The simulation emits these and never reads them back, so the renderer stays
 * a pure consumer of state and the rules remain testable headlessly.
 */
interface EffectBase {
  x: number;
  y: number;
  /** World time the effect started. */
  t: number;
  /** Seconds it lasts. */
  life: number;
}

export type Effect =
  | (EffectBase & { kind: "projectile"; tx: number; ty: number; owner: Owner })
  /** `owner` is the side that was hit — what "you are under attack" keys on. */
  | (EffectBase & { kind: "impact"; owner: Owner })
  /** Order confirmation. Emitted by the input layer, not the rules. */
  | (EffectBase & { kind: "marker"; order: "move" | "attack" | "gather" | "build" | "rally" })
  | (EffectBase & { kind: "death"; owner: Owner })
  | (EffectBase & { kind: "deposit"; owner: Owner; text: string; resource: Resource })
  | (EffectBase & { kind: "complete"; owner: Owner });

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

import { BUILDINGS, UNITS, armourOf, attackRangeOf, isBuilding, isUnit, maxHp } from "./config.ts";
import { canSee, knownEnemyBuildings } from "./fog.ts";
import { canAfford } from "./world.ts";
import type { BuildingKind, Entity, Formation, Owner, Resource, UnitKind, World } from "./types.ts";

/**
 * What the HUD shows, computed from the world.
 *
 * Pure functions, no React: the command card is game logic ("can I train an
 * archer right now, and if not, why not?"), and it's tested like the rules.
 */

export type Mode =
  | { kind: "normal" }
  | { kind: "attackMove" }
  | { kind: "patrol" }
  | { kind: "place"; building: BuildingKind };

export interface CommandButton {
  id: string;
  label: string;
  hotkey: string;
  cost?: Partial<Record<Resource, number>>;
  enabled: boolean;
  active?: boolean;
  /** Why it's disabled, in words a new player understands. */
  why?: string;
  title: string;
  body: string;
  group: "action" | "build" | "train";
}

export const BUILD_KEYS: [BuildingKind, string][] = [
  ["house", "Q"],
  ["farm", "W"],
  ["storehouse", "E"],
  ["barracks", "R"],
  ["tower", "T"],
  ["towncenter", "Y"],
];
export const TRAIN_KEYS = ["Q", "W", "E", "R"];

const RES_NAME: Record<Resource, string> = { food: "food", wood: "wood", gold: "gold", stone: "stone" };

function shortfall(world: World, owner: Owner, cost: Partial<Record<Resource, number>>): string | undefined {
  const p = world.players[owner];
  const missing = (Object.keys(cost) as Resource[])
    .filter((r) => (cost[r] ?? 0) > p[r])
    .map((r) => `${Math.ceil((cost[r] ?? 0) - p[r])} ${RES_NAME[r]}`);
  return missing.length ? `Need ${missing.join(" and ")} more.` : undefined;
}

export function ownSelection(world: World, owner: Owner, selected: Iterable<number>): Entity[] {
  return [...selected]
    .map((id) => world.entities.get(id))
    .filter((e): e is Entity => !!e && e.owner === owner);
}

export function commandCard(
  world: World,
  owner: Owner,
  selected: Iterable<number>,
  mode: Mode,
  formation: Formation,
): CommandButton[] {
  const sel = ownSelection(world, owner, selected);
  const units = sel.filter((e) => isUnit(e.kind));
  const buildings = sel.filter((e) => isBuilding(e.kind));
  const out: CommandButton[] = [];

  if (units.length > 0) {
    out.push(
      {
        id: "act:attackMove",
        label: "Attack-move",
        hotkey: "A",
        enabled: true,
        active: mode.kind === "attackMove",
        title: "Attack-move",
        body: "Walk to a point and fight anything met on the way. What an army usually wants.",
        group: "action",
      },
      {
        id: "act:stop",
        label: "Stop",
        hotkey: "S",
        enabled: true,
        title: "Stop",
        body: "Drop the current order and any queued ones.",
        group: "action",
      },
      {
        id: "act:patrol",
        label: "Patrol",
        hotkey: "P",
        enabled: true,
        active: mode.kind === "patrol",
        title: "Patrol",
        body: "Walk back and forth between here and a point, engaging anything that shows up.",
        group: "action",
      },
    );
    if (units.length > 1) {
      out.push({
        id: "act:formation",
        label: `Formation: ${formation}`,
        hotkey: "F",
        enabled: true,
        title: "Change formation",
        body: "Line, box, column or spread. Spearmen always take the front, archers the back.",
        group: "action",
      });
    }
  }

  if (units.some((u) => u.kind === "villager")) {
    for (const [kind, key] of BUILD_KEYS) {
      const spec = BUILDINGS[kind];
      const why = shortfall(world, owner, spec.cost);
      out.push({
        id: `build:${kind}`,
        label: spec.name,
        hotkey: key,
        cost: spec.cost,
        enabled: !why,
        why,
        active: mode.kind === "place" && mode.building === kind,
        title: spec.name,
        body: spec.role,
        group: "build",
      });
    }
  }

  // Training: only when the selection is buildings alone, so a mixed click
  // doesn't show a card that changes with every unit that walks in and out.
  if (units.length === 0 && buildings.length > 0) {
    const ready = buildings.filter((b) => (b.progress ?? 1) === 1);
    const kinds = new Set<UnitKind>();
    for (const b of ready) for (const k of BUILDINGS[b.kind as BuildingKind].trains) kinds.add(k);
    const p = world.players[owner];
    [...kinds].forEach((kind, i) => {
      const spec = UNITS[kind];
      const queued = ready.reduce((a, b) => a + (b.queue?.length ?? 0), 0);
      let why = shortfall(world, owner, spec.cost);
      if (!why && p.pop + queued >= p.popCap) why = "Not enough room — build a House.";
      out.push({
        id: `train:${kind}`,
        label: spec.name,
        hotkey: TRAIN_KEYS[i] ?? "",
        cost: spec.cost,
        enabled: !why,
        why,
        title: spec.name,
        body: spec.role,
        group: "train",
      });
    });
  }

  return out;
}

export interface QueueItem {
  kind: UnitKind;
  label: string;
  progress: number;
}

export interface Selection {
  kind: "none" | "single" | "multi";
  /** The selected entity's kind, for single selections. */
  entityKind?: string;
  enemy: boolean;
  title: string;
  role: string;
  hp?: number;
  maxHp?: number;
  status?: string;
  progress?: number;
  queue?: QueueItem[];
  stats?: { label: string; value: string }[];
  groups?: { kind: string; label: string; count: number; hpFrac: number }[];
  count: number;
}

function statusOf(world: World, e: Entity): string {
  const st = e.state;
  if (!st) return "";
  const name = (id: number) => {
    const t = world.entities.get(id);
    return t ? labelOf(t.kind) : "target";
  };
  switch (st.name) {
    case "idle":
      return e.kind === "villager" ? "Idle — needs work" : "Idle";
    case "moving":
      return "Moving";
    case "gathering":
      return `Gathering ${st.resource}${e.carrying ? ` (${e.carrying.amount}/10)` : ""}`;
    case "returning":
      return `Carrying ${e.carrying?.amount ?? 0} ${st.resource} home`;
    case "building":
      return `Building ${name(st.targetId)}`;
    case "repairing":
      return `Repairing ${name(st.targetId)}`;
    case "attacking":
      return `Attacking ${name(st.targetId)}`;
    case "attackMove":
      return "Attack-moving";
    case "patrol":
      return "Patrolling";
  }
}

export function labelOf(kind: string): string {
  if (kind in UNITS) return UNITS[kind as UnitKind].name;
  if (kind in BUILDINGS) return BUILDINGS[kind as BuildingKind].name;
  return kind;
}

export function describeSelection(world: World, owner: Owner, selected: Iterable<number>): Selection {
  const all = [...selected]
    .map((id) => world.entities.get(id))
    .filter((e): e is Entity => !!e && canSee(world, owner, e));
  if (all.length === 0) return { kind: "none", enemy: false, title: "", role: "", count: 0 };

  if (all.length === 1) {
    const e = all[0];
    const building = isBuilding(e.kind);
    const role = building ? BUILDINGS[e.kind as BuildingKind].role : UNITS[e.kind as UnitKind].role;
    const stats: { label: string; value: string }[] = [];
    if (!building) {
      const u = UNITS[e.kind as UnitKind];
      stats.push(
        { label: "Attack", value: String(u.attack) },
        { label: "Armour", value: String(armourOf(e.kind)) },
        { label: "Range", value: u.range > 2 ? String(u.range) : "melee" },
        { label: "Speed", value: u.speed.toFixed(1) },
      );
    } else if (attackRangeOf(e.kind) > 0) {
      stats.push(
        { label: "Attack", value: String(BUILDINGS[e.kind as BuildingKind].attack) },
        { label: "Range", value: String(attackRangeOf(e.kind)) },
      );
    }
    return {
      kind: "single",
      entityKind: e.kind,
      enemy: e.owner !== owner,
      title: labelOf(e.kind),
      role,
      hp: Math.max(0, Math.round(e.hp)),
      maxHp: maxHp(e.kind),
      status: building
        ? (e.progress ?? 1) < 1
          ? "Under construction"
          : e.queue?.length
            ? `Training ${labelOf(e.queue[0].kind)}`
            : ""
        : statusOf(world, e),
      progress: building && (e.progress ?? 1) < 1 ? e.progress : undefined,
      queue: e.owner === owner
        ? (e.queue ?? []).map((q, i) => ({
            kind: q.kind,
            label: labelOf(q.kind),
            progress: i === 0 ? 1 - q.remaining / UNITS[q.kind].trainTime : 0,
          }))
        : undefined,
      stats,
      count: 1,
    };
  }

  const byKind = new Map<string, Entity[]>();
  for (const e of all) {
    if (!byKind.has(e.kind)) byKind.set(e.kind, []);
    byKind.get(e.kind)!.push(e);
  }
  return {
    kind: "multi",
    enemy: all.every((e) => e.owner !== owner),
    title: `${all.length} selected`,
    role: "",
    groups: [...byKind].map(([kind, list]) => ({
      kind,
      label: labelOf(kind),
      count: list.length,
      hpFrac: list.reduce((a, e) => a + e.hp / maxHp(e.kind), 0) / list.length,
    })),
    count: all.length,
  };
}

export interface Objective {
  label: string;
  hint: string;
  done: boolean;
}

/**
 * The first five minutes, as a checklist.
 *
 * Every item completes from what the player actually does, never from a
 * button labelled "got it" — so the list is also a quiet measure of whether
 * the opening is teachable.
 */
export function objectives(world: World, owner: Owner): Objective[] {
  const mine = [...world.entities.values()].filter((e) => e.owner === owner);
  const working = mine.filter(
    (e) => e.kind === "villager" && ["gathering", "returning", "building"].includes(e.state?.name ?? ""),
  ).length;
  const villagers = mine.filter((e) => e.kind === "villager").length;
  const has = (k: BuildingKind) => mine.some((e) => e.kind === k && (e.progress ?? 1) === 1);
  const army = mine.filter((e) => e.kind === "spearman" || e.kind === "archer" || e.kind === "rider").length;
  const stats = world.stats[owner];
  const foundBase = knownEnemyBuildings(world, owner).some((g) => g.kind === "towncenter");

  return [
    {
      label: "Put your villagers to work",
      hint: "Select them, then order them onto a bush, tree or ore (right-click, or tap on a touch screen).",
      done: working >= 4 || stats.gathered.food + stats.gathered.wood > 60,
    },
    {
      label: "Train more villagers",
      hint: "Select the Town Centre and train a Villager (Q). More workers, faster everything.",
      done: villagers >= 7 || stats.unitsTrained >= 3,
    },
    {
      label: "Build a House",
      hint: "Select a villager, choose House (Q), and place it on open ground. Each holds 6 more.",
      done: has("house"),
    },
    {
      label: "Build a Barracks",
      hint: "With a villager selected, choose Barracks (R). It trains spearmen, archers and riders.",
      done: has("barracks"),
    },
    {
      label: "Raise an army of five",
      hint: "Spearmen beat riders, riders beat archers, archers beat spearmen.",
      done: army >= 5,
    },
    {
      label: "Find the enemy base",
      hint: "Train a Scout from the Town Centre and send it exploring.",
      done: foundBase,
    },
    {
      label: "Destroy the enemy Town Centre",
      hint: "Send your army with Attack-move (A). Melee breaks buildings; arrows barely scratch them.",
      done: world.outcome === "won",
    },
  ];
}

export interface Verdict {
  headline: string;
  reasons: string[];
}

/** A few plain sentences on why the match went the way it did. */
export function verdict(world: World, owner: Owner): Verdict {
  const me = world.stats[owner];
  const them = world.stats[owner === 0 ? 1 : 0];
  const total = (s: typeof me) => s.gathered.food + s.gathered.wood + s.gathered.gold + s.gathered.stone;
  const reasons: string[] = [];

  const g1 = total(me);
  const g2 = total(them);
  if (g1 > g2 * 1.2) reasons.push(`You gathered ${Math.round((g1 / Math.max(1, g2) - 1) * 100)}% more than they did.`);
  else if (g2 > g1 * 1.2) reasons.push(`They gathered ${Math.round((g2 / Math.max(1, g1) - 1) * 100)}% more than you did.`);
  else reasons.push("Your economies were close.");

  if (me.kills > them.kills * 1.3) reasons.push(`You won the fights: ${me.kills} kills to ${them.kills}.`);
  else if (them.kills > me.kills * 1.3) reasons.push(`They won the fights: ${them.kills} kills to ${me.kills}.`);

  if (me.unitsTrained > them.unitsTrained * 1.3) reasons.push(`You out-produced them, ${me.unitsTrained} units to ${them.unitsTrained}.`);
  else if (them.unitsTrained > me.unitsTrained * 1.3) reasons.push(`They out-produced you, ${them.unitsTrained} units to ${me.unitsTrained}.`);

  if (me.buildingsLost > 3) reasons.push(`You lost ${me.buildingsLost} buildings.`);

  const won = world.outcome === "won";
  return {
    headline: won ? "The valley is yours" : "Your hold has fallen",
    reasons,
  };
}

export { canAfford };

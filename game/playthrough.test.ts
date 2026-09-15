import { test } from "node:test";
import assert from "node:assert/strict";

import { createWorld, tick } from "./world.ts";
import { resetAi, tickAi } from "./ai.ts";
import { isBuilding } from "./config.ts";
import type { Entity, Owner, World } from "./types.ts";

/**
 * A complete match, played by the AI on both sides.
 *
 * This is the test that answers "is this actually a game?" — everything else
 * checks one mechanism in isolation. Running the same brain in both seats is
 * also the only honest way to know the opponent works against someone who
 * fights back, rather than only against a player who stands still.
 */

const DT = 1 / 30;

function side(world: World, owner: Owner): Entity[] {
  return [...world.entities.values()].filter((e) => e.owner === owner);
}

interface Snapshot {
  minute: number;
  villagers: number[];
  army: number[];
  buildings: number[];
}

function snapshot(world: World, minute: number): Snapshot {
  const count = (o: Owner, pred: (e: Entity) => boolean) =>
    side(world, o).filter(pred).length;
  const isArmy = (e: Entity) =>
    e.kind === "spearman" || e.kind === "archer" || e.kind === "rider";
  return {
    minute,
    villagers: [
      count(0, (e) => e.kind === "villager"),
      count(1, (e) => e.kind === "villager"),
    ],
    army: [count(0, isArmy), count(1, isArmy)],
    buildings: [count(0, (e) => isBuilding(e.kind)), count(1, (e) => isBuilding(e.kind))],
  };
}

/** Play out a match, sampling once a minute. */
function playMatch(seed: number, maxMinutes: number) {
  const world = createWorld(seed);
  resetAi();
  const timeline: Snapshot[] = [];
  const stepsPerMinute = Math.round(60 / DT);

  for (let minute = 0; minute < maxMinutes; minute++) {
    for (let i = 0; i < stepsPerMinute; i++) {
      tick(world, DT);
      tickAi(world, DT, 0);
      tickAi(world, DT, 1);
      if (world.outcome !== "playing") break;
    }
    timeline.push(snapshot(world, minute + 1));
    if (world.outcome !== "playing") break;
  }
  return { world, timeline };
}

function render(timeline: Snapshot[]): string {
  return timeline
    .map(
      (s) =>
        `  ${String(s.minute).padStart(2)}m  vil ${s.villagers.join("/")}  army ${s.army.join(
          "/",
        )}  bld ${s.buildings.join("/")}`,
    )
    .join("\n");
}

test("a full match develops, fights, and costs both sides something", () => {
  const { world, timeline } = playMatch(1234, 30);
  const report = render(timeline);

  // Measure peaks, not the final frame.
  //
  // Checking the last snapshot punishes success: a decisive win means the
  // loser's economy has been destroyed, so "both sides still have villagers at
  // the end" fails precisely on the matches that worked best.
  const peak = (pick: (s: Snapshot) => number[]) =>
    timeline.reduce(
      (m, s) => [Math.max(m[0], pick(s)[0]), Math.max(m[1], pick(s)[1])],
      [0, 0],
    );

  const peakVil = peak((s) => s.villagers);
  const peakArmy = peak((s) => s.army);
  const peakBld = peak((s) => s.buildings);

  assert.ok(
    peakVil[0] > 8 && peakVil[1] > 8,
    `an economy never developed (peaks ${peakVil.join("/")}):\n${report}`,
  );
  assert.ok(
    peakBld[0] > 3 && peakBld[1] > 3,
    `a side never built anything (peaks ${peakBld.join("/")}):\n${report}`,
  );
  assert.ok(
    peakArmy[0] >= 4 && peakArmy[1] >= 4,
    `a side never fielded an army (peaks ${peakArmy.join("/")}):\n${report}`,
  );

  const armyFell = timeline.some(
    (s, i) =>
      i > 0 && (s.army[0] < timeline[i - 1].army[0] || s.army[1] < timeline[i - 1].army[1]),
  );
  assert.ok(armyFell, `no unit ever died — the sides never met:\n${report}`);

  console.log(`\nMatch timeline (player/AI):\n${report}\n  outcome: ${world.outcome}`);
});

test("matches actually reach a winner, across a spread of maps", () => {
  // The bar is deliberately "most", not "all". Two identical brains on a
  // symmetric map can legitimately reach a stalemate — that is what equal
  // opponents do. What must not happen is what used to: *every* match running
  // forever because the two bases were on unconnected islands and no army
  // could ever arrive.
  const seeds = [1234, 99, 3, 42, 777, 555];
  const results = seeds.map((seed) => {
    const { world, timeline } = playMatch(seed, 45);
    return { seed, outcome: world.outcome, minutes: timeline.length };
  });

  const decided = results.filter((r) => r.outcome !== "playing");
  const summary = results
    .map((r) => `  seed ${String(r.seed).padStart(4)}: ${r.outcome} after ${r.minutes}m`)
    .join("\n");

  assert.ok(
    decided.length >= seeds.length / 2,
    `only ${decided.length}/${seeds.length} matches resolved:\n${summary}`,
  );
  console.log(`\nResolution across maps:\n${summary}`);
});

test("matches differ by seed rather than replaying the same script", () => {
  // If every map produced an identical match, the game would have exactly one
  // strategy and no reason to play twice.
  const a = playMatch(7, 8);
  const b = playMatch(99, 8);

  const shape = (r: ReturnType<typeof playMatch>) =>
    r.timeline.map((s) => `${s.villagers.join(",")}|${s.army.join(",")}`).join(";");

  assert.notEqual(shape(a), shape(b), "two different seeds produced identical matches");
});

test("the same seed replays identically", () => {
  // Determinism is what makes a bug reproducible, and is the precondition for
  // replays or any future networked play. Nothing in the simulation may reach
  // for Math.random().
  const a = playMatch(2024, 6);
  const b = playMatch(2024, 6);

  const shape = (r: ReturnType<typeof playMatch>) =>
    r.timeline.map((s) => `${s.villagers.join(",")}|${s.buildings.join(",")}`).join(";");

  assert.equal(shape(a), shape(b), "same seed diverged between runs");
});

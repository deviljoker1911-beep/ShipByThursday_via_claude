import { test } from "node:test";
import assert from "node:assert/strict";

import { createWorld, enqueueTraining, spawn } from "./world.ts";
import { commandCard, describeSelection, objectives, verdict } from "./hud.ts";
import type { World } from "./types.ts";

const mine = (w: World, kind: string) =>
  [...w.entities.values()].filter((e) => e.owner === 0 && e.kind === kind);

test("command card: villagers get build options, with an honest reason when unaffordable", () => {
  const w = createWorld(2);
  const v = mine(w, "villager")[0];
  w.players[0].stone = 0;
  const card = commandCard(w, 0, [v.id], { kind: "normal" }, "line");
  const tower = card.find((c) => c.id === "build:tower");
  assert.ok(tower, "no tower button for a villager");
  assert.equal(tower!.enabled, false);
  assert.match(tower!.why ?? "", /stone/, "the disabled reason didn't mention stone");
  assert.ok(card.find((c) => c.id === "build:house")?.enabled, "a house should be affordable at the start");
});

test("command card: a town centre offers villagers, and says when there's no room", () => {
  const w = createWorld(2);
  const tc = mine(w, "towncenter")[0];
  let card = commandCard(w, 0, [tc.id], { kind: "normal" }, "line");
  assert.ok(card.find((c) => c.id === "train:villager")?.enabled);

  w.players[0].food = 10_000;
  for (let i = 0; i < 12; i++) enqueueTraining(w, tc, "villager");
  card = commandCard(w, 0, [tc.id], { kind: "normal" }, "line");
  const why = card.find((c) => c.id === "train:villager")?.why ?? "";
  assert.match(why, /House/, `a full population should point at houses, got "${why}"`);
});

test("command card: soldiers get orders, not build or train options", () => {
  const w = createWorld(2);
  const s = spawn(w, "spearman", 0, 20, 20);
  const s2 = spawn(w, "archer", 0, 21, 20);
  const card = commandCard(w, 0, [s.id, s2.id], { kind: "normal" }, "line");
  const ids = card.map((c) => c.id);
  assert.ok(ids.includes("act:attackMove") && ids.includes("act:stop") && ids.includes("act:formation"));
  assert.ok(!ids.some((id) => id.startsWith("build:") || id.startsWith("train:")));
});

test("selection panel describes one unit, and groups many", () => {
  const w = createWorld(2);
  const v = mine(w, "villager");
  const one = describeSelection(w, 0, [v[0].id]);
  assert.equal(one.kind, "single");
  assert.equal(one.entityKind, "villager");
  assert.ok(one.role.length > 0 && one.stats && one.stats.length > 0);

  const many = describeSelection(w, 0, v.map((e) => e.id));
  assert.equal(many.kind, "multi");
  assert.equal(many.groups?.[0].count, v.length);
});

test("the enemy can't be inspected through fog", () => {
  const w = createWorld(2);
  const theirs = [...w.entities.values()].find((e) => e.owner === 1)!;
  assert.equal(describeSelection(w, 0, [theirs.id]).kind, "none");
});

test("objectives start at the first step and are all open", () => {
  const w = createWorld(2);
  const list = objectives(w, 0);
  assert.ok(list.length >= 5);
  assert.equal(list.filter((o) => o.done).length, 0, "an objective was complete before the player did anything");
  assert.ok(list.every((o) => o.hint.length > 10), "an objective has no usable hint");
});

test("the end-of-match verdict gives reasons, not just a result", () => {
  const w = createWorld(2);
  w.outcome = "lost";
  w.stats[1].gathered.wood = 2000;
  w.stats[1].kills = 30;
  w.stats[0].kills = 5;
  const v = verdict(w, 0);
  assert.ok(v.reasons.some((r) => /gathered/.test(r)));
  assert.ok(v.reasons.some((r) => /fights/.test(r)));
});

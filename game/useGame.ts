"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BUILDINGS, UNITS, isBuilding, isUnit } from "./config.ts";
import { screenToTile, tileToScreen, type Camera } from "./iso.ts";
import { centerOn, render } from "./render.ts";
import { resetAi, tickAi } from "./ai.ts";
import {
  canAfford,
  canPlaceBuilding,
  commandAttack,
  commandBuild,
  commandGather,
  commandMove,
  createWorld,
  enqueueTraining,
  entityAt,
  notify,
  pay,
  spawn,
  tick,
} from "./world.ts";
import { terrainAt } from "./map.ts";
import { TERRAIN_IDS, type BuildingKind, type Entity, type UnitKind, type World } from "./types.ts";

/**
 * Glue between React and the simulation.
 *
 * The world is deliberately kept in a ref, not React state: it mutates ~60
 * times a second and re-rendering the tree at that rate would be pointless.
 * React only sees a small HUD snapshot, published a few times a second.
 */

const TICK = 1 / 30;

export interface Hud {
  food: number;
  wood: number;
  gold: number;
  pop: number;
  popCap: number;
  time: number;
  outcome: World["outcome"];
  selection: { kind: string; count: number; ids: number[] }[];
  canTrain: { kind: UnitKind; from: number; affordable: boolean }[];
  notices: string[];
}

const EMPTY_HUD: Hud = {
  food: 0,
  wood: 0,
  gold: 0,
  pop: 0,
  popCap: 0,
  time: 0,
  outcome: "playing",
  selection: [],
  canTrain: [],
  notices: [],
};

export function useGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<World | null>(null);
  const camRef = useRef<Camera>({ ox: 0, oy: 0, zoom: 1 });
  const selectedRef = useRef<Set<number>>(new Set());
  const placingRef = useRef<BuildingKind | null>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [placing, setPlacing] = useState<BuildingKind | null>(null);

  const publishHud = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const p = world.players[0];
    const selected = [...selectedRef.current]
      .map((id) => world.entities.get(id))
      .filter((e): e is Entity => !!e);

    const byKind = new Map<string, number[]>();
    for (const e of selected) {
      if (!byKind.has(e.kind)) byKind.set(e.kind, []);
      byKind.get(e.kind)!.push(e.id);
    }

    const canTrain: Hud["canTrain"] = [];
    for (const e of selected) {
      if (!isBuilding(e.kind) || e.progress !== 1) continue;
      for (const kind of BUILDINGS[e.kind as BuildingKind].trains) {
        if (canTrain.some((c) => c.kind === kind)) continue;
        canTrain.push({ kind, from: e.id, affordable: canAfford(world, 0, UNITS[kind].cost) });
      }
    }

    setHud({
      food: Math.floor(p.food),
      wood: Math.floor(p.wood),
      gold: Math.floor(p.gold),
      pop: p.pop,
      popCap: p.popCap,
      time: world.time,
      outcome: world.outcome,
      selection: [...byKind].map(([kind, ids]) => ({ kind, count: ids.length, ids })),
      canTrain,
      notices: world.notices
        .filter((n) => world.time - n.at < 4)
        .map((n) => n.text),
    });
  }, []);

  const newGame = useCallback(() => {
    const world = createWorld();
    worldRef.current = world;
    selectedRef.current = new Set();
    placingRef.current = null;
    setPlacing(null);
    resetAi();
    const canvas = canvasRef.current;
    if (canvas) {
      const tc = [...world.entities.values()].find(
        (e) => e.owner === 0 && e.kind === "towncenter",
      );
      camRef.current.zoom = 1;
      if (tc) {
        centerOn(camRef.current, tc.x, tc.y, {
          width: canvas.clientWidth,
          height: canvas.clientHeight,
        });
      }
    }
    publishHud();
  }, [publishHud]);

  // ---------------------------------------------------------------- loop
  useEffect(() => {
    newGame();
    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    let hudTimer = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const canvas = canvasRef.current;
      const world = worldRef.current;
      if (!canvas || !world) return;

      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      // Fixed-step simulation, so behaviour doesn't change with framerate.
      accumulator += dt;
      let steps = 0;
      while (accumulator >= TICK && steps < 5) {
        tick(world, TICK);
        tickAi(world, TICK);
        accumulator -= TICK;
        steps++;
      }

      // Keyboard edge panning.
      const cam = camRef.current;
      const panSpeed = 700 * dt;
      if (keysRef.current.has("ArrowLeft") || keysRef.current.has("a")) cam.ox += panSpeed;
      if (keysRef.current.has("ArrowRight") || keysRef.current.has("d")) cam.ox -= panSpeed;
      if (keysRef.current.has("ArrowUp") || keysRef.current.has("w")) cam.oy += panSpeed;
      if (keysRef.current.has("ArrowDown") || keysRef.current.has("s")) cam.oy -= panSpeed;

      // Keep the backing store matched to CSS size and DPR.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const placingKind = placingRef.current;
      render(ctx, world, cam, { width: w, height: h }, {
        selected: selectedRef.current,
        hoverTile: hoverRef.current,
        placing:
          placingKind && hoverRef.current
            ? {
                kind: placingKind,
                valid: canPlaceBuilding(
                  world,
                  placingKind,
                  Math.round(hoverRef.current.x),
                  Math.round(hoverRef.current.y),
                ),
              }
            : null,
        dragBox: dragRef.current,
      });

      hudTimer += dt;
      if (hudTimer > 0.15) {
        hudTimer = 0;
        publishHud();
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [newGame, publishHud]);

  // ---------------------------------------------------------------- keys
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
      if (e.key === "Escape") {
        placingRef.current = null;
        setPlacing(null);
      }
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ---------------------------------------------------------------- input
  const localPoint = (ev: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };

  const onPointerDown = useCallback((ev: React.PointerEvent<HTMLCanvasElement>) => {
    const world = worldRef.current;
    if (!world) return;
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(ev.pointerId);
    const p = localPoint(ev);

    // Right button (or two-finger) pans; left selects or issues orders.
    if (ev.button === 2 || ev.button === 1) {
      panRef.current = { x: p.x, y: p.y };
      return;
    }

    const tile = screenToTile(p.x, p.y, camRef.current);

    // Placing a building consumes the click.
    const placingKind = placingRef.current;
    if (placingKind) {
      const tx = Math.round(tile.x);
      const ty = Math.round(tile.y);
      if (canPlaceBuilding(world, placingKind, tx, ty)) {
        const spec = BUILDINGS[placingKind];
        if (canAfford(world, 0, spec.cost)) {
          pay(world, 0, spec.cost);
          const site = spawn(world, placingKind, 0, tx, ty, 0.01);
          const builders = [...selectedRef.current]
            .map((id) => world.entities.get(id))
            .filter((e): e is Entity => !!e && e.kind === "villager");
          if (builders.length === 0) {
            notify(world, "No villager selected — the site will sit unbuilt.");
          }
          for (const b of builders) commandBuild(world, b, site.id);
        } else {
          notify(world, "Not enough resources.");
        }
      } else {
        notify(world, "Can't build there.");
      }
      if (!ev.shiftKey) {
        placingRef.current = null;
        setPlacing(null);
      }
      return;
    }

    dragRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }, []);

  const onPointerMove = useCallback((ev: React.PointerEvent<HTMLCanvasElement>) => {
    const p = localPoint(ev);
    hoverRef.current = screenToTile(p.x, p.y, camRef.current);

    if (panRef.current) {
      camRef.current.ox += p.x - panRef.current.x;
      camRef.current.oy += p.y - panRef.current.y;
      panRef.current = { x: p.x, y: p.y };
      return;
    }
    if (dragRef.current) {
      dragRef.current.x1 = p.x;
      dragRef.current.y1 = p.y;
    }
  }, []);

  const onPointerUp = useCallback(
    (ev: React.PointerEvent<HTMLCanvasElement>) => {
      const world = worldRef.current;
      if (!world) return;
      const canvas = canvasRef.current!;
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);

      if (panRef.current) {
        panRef.current = null;
        return;
      }

      const box = dragRef.current;
      dragRef.current = null;
      if (!box) return;

      const p = localPoint(ev);
      const dragged = Math.hypot(p.x - box.x0, p.y - box.y0) > 6;

      if (dragged) {
        // Marquee: select own units whose screen position falls inside.
        const x0 = Math.min(box.x0, p.x);
        const x1 = Math.max(box.x0, p.x);
        const y0 = Math.min(box.y0, p.y);
        const y1 = Math.max(box.y0, p.y);
        const next = ev.shiftKey ? new Set(selectedRef.current) : new Set<number>();
        for (const e of world.entities.values()) {
          if (e.owner !== 0 || !isUnit(e.kind)) continue;
          const { sx, sy } = tileToScreen(e.x, e.y, camRef.current);
          if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) next.add(e.id);
        }
        selectedRef.current = next;
        publishHud();
        return;
      }

      const tile = screenToTile(p.x, p.y, camRef.current);
      const hit = entityAt(world, tile.x, tile.y);
      const selected = [...selectedRef.current]
        .map((id) => world.entities.get(id))
        .filter((e): e is Entity => !!e && e.owner === 0 && isUnit(e.kind));

      // With own units selected, a click on something is an order, not a
      // reselection — that's the interaction people expect from the genre.
      if (selected.length > 0 && hit && hit.owner === 1) {
        for (const u of selected) commandAttack(world, u, hit.id);
        return;
      }
      if (selected.length > 0 && hit && hit.owner === 0 && isBuilding(hit.kind)) {
        if (hit.progress !== 1) {
          for (const u of selected) if (u.kind === "villager") commandBuild(world, u, hit.id);
          return;
        }
      }
      if (selected.length > 0 && !hit) {
        const t = terrainAt(world.map, Math.round(tile.x), Math.round(tile.y));
        const gatherable = t === TERRAIN_IDS.forest || t === TERRAIN_IDS.gold;
        for (const u of selected) {
          if (gatherable && u.kind === "villager") {
            commandGather(world, u, Math.round(tile.x), Math.round(tile.y));
          } else {
            commandMove(world, u, tile.x, tile.y);
          }
        }
        return;
      }

      // Otherwise it's a selection.
      const next = ev.shiftKey ? new Set(selectedRef.current) : new Set<number>();
      if (hit && hit.owner === 0) next.add(hit.id);
      selectedRef.current = next;
      publishHud();
    },
    [publishHud],
  );

  const onWheel = useCallback((ev: React.WheelEvent<HTMLCanvasElement>) => {
    const cam = camRef.current;
    const p = localPoint(ev);
    const before = screenToTile(p.x, p.y, cam);
    cam.zoom = Math.max(0.45, Math.min(2.2, cam.zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
    const after = screenToTile(p.x, p.y, cam);
    // Keep the tile under the cursor fixed while zooming.
    const { sx: bx, sy: by } = tileToScreen(before.x, before.y, cam);
    const { sx: ax, sy: ay } = tileToScreen(after.x, after.y, cam);
    cam.ox += ax - bx;
    cam.oy += ay - by;
  }, []);

  // ---------------------------------------------------------------- actions
  const train = useCallback(
    (buildingId: number, kind: UnitKind) => {
      const world = worldRef.current;
      if (!world) return;
      const b = world.entities.get(buildingId);
      if (!b) return;
      const err = enqueueTraining(world, b, kind);
      if (err) notify(world, err);
      publishHud();
    },
    [publishHud],
  );

  const startPlacing = useCallback((kind: BuildingKind) => {
    placingRef.current = kind;
    setPlacing(kind);
  }, []);

  const selectAllVillagers = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const next = new Set<number>();
    for (const e of world.entities.values()) {
      if (e.owner === 0 && e.kind === "villager") next.add(e.id);
    }
    selectedRef.current = next;
    publishHud();
  }, [publishHud]);

  const selectAllMilitary = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const next = new Set<number>();
    for (const e of world.entities.values()) {
      if (e.owner === 0 && (e.kind === "spearman" || e.kind === "archer")) next.add(e.id);
    }
    selectedRef.current = next;
    publishHud();
  }, [publishHud]);

  const focusTownCentre = useCallback(() => {
    const world = worldRef.current;
    const canvas = canvasRef.current;
    if (!world || !canvas) return;
    const tc = [...world.entities.values()].find(
      (e) => e.owner === 0 && e.kind === "towncenter",
    );
    if (!tc) return;
    centerOn(camRef.current, tc.x, tc.y, {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    });
    selectedRef.current = new Set([tc.id]);
    publishHud();
  }, [publishHud]);

  return {
    canvasRef,
    hud,
    placing,
    newGame,
    train,
    startPlacing,
    selectAllVillagers,
    selectAllMilitary,
    focusTownCentre,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onWheel },
  };
}

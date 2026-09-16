"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Camera } from "./iso.ts";
import { centerOn, centerTile, viewCorners } from "./camera.ts";
import { render } from "./render.ts";
import { resetAi, tickAi, type Difficulty } from "./ai.ts";
import { createWorld, spawn, tick } from "./world.ts";
import { InputController } from "./input.ts";
import {
  commandCard,
  describeSelection,
  objectives,
  verdict,
  type CommandButton,
  type Mode,
  type Objective,
  type Selection,
  type Verdict,
} from "./hud.ts";
import type { Formation, MatchStats, World } from "./types.ts";

/**
 * Glue between React and the simulation.
 *
 * The world lives in a ref, not React state: it changes thirty times a second
 * and re-rendering the component tree at that rate would buy nothing. React
 * sees a small snapshot, published a few times a second or when the player
 * does something.
 */

const TICK = 1 / 30;
const OWNER = 0 as const;

export interface Alert {
  text: string;
  x: number;
  y: number;
  at: number;
}

export interface Hud {
  /** False until the player has pressed Begin; the clock doesn't run before. */
  started: boolean;
  difficulty: Difficulty;
  food: number;
  wood: number;
  gold: number;
  stone: number;
  pop: number;
  popCap: number;
  time: number;
  outcome: World["outcome"];
  paused: boolean;
  idleVillagers: number;
  selection: Selection;
  commands: CommandButton[];
  mode: Mode;
  formation: Formation;
  groups: { n: number; count: number }[];
  notices: string[];
  alerts: Alert[];
  objectives: Objective[];
  end: { verdict: Verdict; me: MatchStats; them: MatchStats } | null;
}

const EMPTY: Hud = {
  started: false,
  difficulty: "normal",
  food: 0,
  wood: 0,
  gold: 0,
  stone: 0,
  pop: 0,
  popCap: 0,
  time: 0,
  outcome: "playing",
  paused: false,
  idleVillagers: 0,
  selection: { kind: "none", enemy: false, title: "", role: "", count: 0 },
  commands: [],
  mode: { kind: "normal" },
  formation: "line",
  groups: [],
  notices: [],
  alerts: [],
  objectives: [],
  end: null,
};

export function useGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<World>(null as unknown as World);
  const camRef = useRef<Camera>({ ox: 0, oy: 0, zoom: 1 });
  const pausedRef = useRef(true);
  const startedRef = useRef(false);
  const difficultyRef = useRef<Difficulty>("normal");
  const alertsRef = useRef<Alert[]>([]);
  const dirtyRef = useRef(true);
  const [hud, setHud] = useState<Hud>(EMPTY);

  const view = useCallback(() => {
    const c = canvasRef.current;
    return { width: c?.clientWidth ?? 800, height: c?.clientHeight ?? 600 };
  }, []);

  const inputRef = useRef<InputController | null>(null);
  if (!inputRef.current) {
    worldRef.current = createWorld();
    inputRef.current = new InputController({
      world: () => worldRef.current,
      cam: camRef.current,
      view,
      owner: OWNER,
      changed: () => {
        dirtyRef.current = true;
      },
      togglePause: () => {
        if (!startedRef.current) return;
        pausedRef.current = !pausedRef.current;
        dirtyRef.current = true;
      },
      canvas: () => canvasRef.current,
    });
  }
  const input = inputRef.current;

  const publish = useCallback(() => {
    const world = worldRef.current;
    const p = world.players[OWNER];
    const mine = [...world.entities.values()].filter((e) => e.owner === OWNER);
    const done = world.outcome !== "playing";
    setHud({
      started: startedRef.current,
      difficulty: difficultyRef.current,
      food: Math.floor(p.food),
      wood: Math.floor(p.wood),
      gold: Math.floor(p.gold),
      stone: Math.floor(p.stone),
      pop: p.pop,
      popCap: p.popCap,
      time: world.time,
      outcome: world.outcome,
      paused: pausedRef.current,
      idleVillagers: mine.filter((e) => e.kind === "villager" && e.state?.name === "idle").length,
      selection: describeSelection(world, OWNER, input.selected),
      commands: commandCard(world, OWNER, input.selected, input.mode, input.formation),
      mode: input.mode,
      formation: input.formation,
      groups: [...input.groups]
        .map(([n, ids]) => ({ n, count: ids.filter((id) => world.entities.has(id)).length }))
        .filter((g) => g.count > 0)
        .sort((a, b) => a.n - b.n),
      notices: world.notices.filter((n) => world.time - n.at < 4).map((n) => n.text),
      alerts: alertsRef.current.filter((a) => world.time - a.at < 6),
      objectives: objectives(world, OWNER),
      end: done
        ? { verdict: verdict(world, OWNER), me: world.stats[OWNER], them: world.stats[1] }
        : null,
    });
  }, [input]);

  const newGame = useCallback((difficulty: Difficulty = difficultyRef.current, begin = true) => {
    difficultyRef.current = difficulty;
    worldRef.current = createWorld();
    resetAi({ 1: difficulty });
    alertsRef.current = [];
    startedRef.current = begin;
    pausedRef.current = !begin;
    input.selected.clear();
    input.groups.clear();
    input.mode = { kind: "normal" };
    input.lastAlert = null;
    camRef.current.zoom = 1;
    const tc = [...worldRef.current.entities.values()].find(
      (e) => e.owner === OWNER && e.kind === "towncenter",
    );
    if (tc) centerOn(camRef.current, tc.x, tc.y, view());
    dirtyRef.current = true;
    publish();
  }, [input, publish, view]);

  /**
   * "You are under attack", at most every few seconds per place — enough to
   * notice a raid, never enough to become noise.
   */
  const scanAlerts = useCallback(() => {
    const world = worldRef.current;
    for (const fx of world.effects) {
      if (fx.kind !== "impact" || fx.owner !== OWNER || fx.t < world.time - 0.2) continue;
      const recent = alertsRef.current.find(
        (a) => world.time - a.at < 10 && Math.hypot(a.x - fx.x, a.y - fx.y) < 12,
      );
      if (recent) continue;
      const hitTile = [...world.entities.values()].find(
        (e) => e.owner === OWNER && Math.hypot(e.x - fx.x, e.y - fx.y) < 0.8,
      );
      const text =
        hitTile?.kind === "villager"
          ? "Your villagers are under attack"
          : hitTile && hitTile.kind in { towncenter: 1, house: 1, barracks: 1, farm: 1, storehouse: 1, tower: 1 }
            ? "Your base is under attack"
            : "Your army is under attack";
      alertsRef.current = [...alertsRef.current.slice(-5), { text, x: fx.x, y: fx.y, at: world.time }];
      input.lastAlert = { x: fx.x, y: fx.y };
      dirtyRef.current = true;
    }
  }, [input]);

  // ------------------------------------------------------------ loop
  useEffect(() => {
    // Build the world straight away so the start screen has a living map
    // behind it, but hold the clock until the player chooses to begin.
    newGame("normal", false);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hudTimer = 0;
    let lastView = view();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const world = worldRef.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      if (!pausedRef.current && world.outcome === "playing") {
        acc += dt;
        let steps = 0;
        while (acc >= TICK && steps < 5) {
          tick(world, TICK);
          tickAi(world, TICK, 1);
          acc -= TICK;
          steps++;
        }
        scanAlerts();
      }
      // Hold the centre tile steady whenever the view changes size. This is
      // what keeps the start centred — the first frame can run before the
      // stylesheet has stretched the canvas past its 300×150 default — and it
      // is also what a resized window or a rotated phone needs.
      const size = view();
      if (size.width !== lastView.width || size.height !== lastView.height) {
        const c = centerTile(camRef.current, lastView);
        centerOn(camRef.current, c.x, c.y, size);
        lastView = size;
      }

      input.update(dt);

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
      render(ctx, world, camRef.current, { width: w, height: h }, {
        owner: OWNER,
        selected: input.selected,
        hover: input.hover,
        placing: input.placementPreview(),
        dragBox: input.dragBox,
        modeTint: input.modeTint(),
      });

      hudTimer += dt;
      if (dirtyRef.current || hudTimer > 0.15) {
        hudTimer = 0;
        dirtyRef.current = false;
        publish();
      }
    };
    raf = requestAnimationFrame(frame);

    // Nothing on the keyboard should reach the game before it has begun.
    const onKeyDown = (ev: KeyboardEvent) => {
      if (startedRef.current) input.keyDown(ev);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", input.keyUp);
    window.addEventListener("pointermove", input.trackMouse);
    document.documentElement.addEventListener("mouseleave", input.mouseLeftWindow);
    const onBlur = () => input.mouseLeftWindow();
    window.addEventListener("blur", onBlur);

    // Wheel must be non-passive to stop the page itself from scrolling.
    const canvas = canvasRef.current;
    canvas?.addEventListener("wheel", input.wheel, { passive: false });

    // A development-only handle for driving the simulation from the console
    // and from automated checks. Stripped from production builds.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __emberhold: unknown }).__emberhold = {
        world: () => worldRef.current,
        input,
        spawn: (kind: Parameters<typeof spawn>[1], owner: 0 | 1, x: number, y: number) =>
          spawn(worldRef.current, kind, owner, x, y),
        camera: camRef.current,
        advance(seconds: number) {
          const world = worldRef.current;
          for (let i = 0; i < Math.round(seconds / TICK); i++) {
            tick(world, TICK);
            tickAi(world, TICK, 1);
          }
          scanAlerts();
          dirtyRef.current = true;
        },
      };
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", input.keyUp);
      window.removeEventListener("pointermove", input.trackMouse);
      document.documentElement.removeEventListener("mouseleave", input.mouseLeftWindow);
      window.removeEventListener("blur", onBlur);
      canvas?.removeEventListener("wheel", input.wheel);
    };
  }, [input, newGame, publish, scanAlerts]);

  const togglePause = useCallback(() => {
    if (!startedRef.current) return;
    pausedRef.current = !pausedRef.current;
    dirtyRef.current = true;
  }, []);

  const begin = useCallback(
    (difficulty: Difficulty) => {
      // A fresh world for the chosen level, so the AI's plan starts at zero.
      newGame(difficulty, true);
    },
    [newGame],
  );

  // A minimap needs the live world and camera, not a React snapshot.
  const minimapSource = useCallback(
    () => ({
      world: worldRef.current,
      corners: viewCorners(camRef.current, view()),
      selected: input.selected,
      alerts: alertsRef.current
        .filter((a) => worldRef.current.time - a.at < 6)
        .map((a) => ({ x: a.x, y: a.y, age: worldRef.current.time - a.at })),
    }),
    [input, view],
  );

  const touched = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  return {
    canvasRef,
    hud,
    input,
    newGame,
    begin,
    togglePause,
    minimapSource,
    touched,
  };
}

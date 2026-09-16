import { BUILDINGS, isBuilding, isUnit, maxHp } from "./config.ts";
import { TILE_H, TILE_W, depth, screenToTile, tileToScreen, type Camera } from "./iso.ts";
import { clampCamera, centerOn, edgePan, panBy, zoomAt, type View } from "./camera.ts";
import { canSee } from "./fog.ts";
import { FORMATIONS } from "./formation.ts";
import { BUILD_KEYS, TRAIN_KEYS, commandCard, ownSelection, type Mode } from "./hud.ts";
import { issueContextOrder, previewOrder, resolveTarget, type ClickTarget, type OrderKind } from "./orders.ts";
import { wallHeight, type Hover } from "./render.ts";
import {
  backToWork,
  canAfford,
  canPlaceBuilding,
  cancelTraining,
  commandBuild,
  commandStop,
  emit,
  enqueueTraining,
  footprint,
  notify,
  pay,
  soundAlarm,
  spawn,
} from "./world.ts";
import type { BuildingKind, Entity, Formation, Owner, UnitKind, World } from "./types.ts";

/**
 * Everything the player does with a mouse, a keyboard or a finger.
 *
 * The desktop model is the genre's: left-click selects, right-click orders.
 * Touch has no right button, so there a tap on your own unit selects it and a
 * tap anywhere else, with something selected, is the order.
 *
 * This layer decides *what* was meant and hands it to `orders.ts`; it never
 * reaches into unit state itself.
 */

export interface InputDeps {
  world: () => World;
  cam: Camera;
  view: () => View;
  owner: Owner;
  /** Selection, mode or groups changed — the HUD should refresh. */
  changed: () => void;
  togglePause: () => void;
  canvas: () => HTMLCanvasElement | null;
}

interface Pointer {
  id: number;
  type: string;
  button: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startT: number;
}

const DRAG_THRESHOLD = 6;
const TOUCH_DRAG_THRESHOLD = 12;
const LONG_PRESS_MS = 380;
const DOUBLE_MS = 320;

// Small SVG cursors. Data URIs are permitted by the page's CSP.
const svgCursor = (body: string, x = 12, y = 12) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>${body}</svg>`,
  )}") ${x} ${y}, crosshair`;
const CURSORS = {
  attack: svgCursor(
    "<path d='M4 4l16 16M20 4L4 20' stroke='%23000' stroke-width='5' stroke-linecap='round'/><path d='M4 4l16 16M20 4L4 20' stroke='%23ff5a46' stroke-width='2.5' stroke-linecap='round'/>".replace(/%23/g, "#"),
  ),
  gather: svgCursor(
    "<path d='M5 19L15 9' stroke='#000' stroke-width='5' stroke-linecap='round'/><path d='M5 19L15 9' stroke='#c9a06a' stroke-width='2.5' stroke-linecap='round'/><path d='M9 5c5-2 9 1 11 5' fill='none' stroke='#000' stroke-width='5' stroke-linecap='round'/><path d='M9 5c5-2 9 1 11 5' fill='none' stroke='#e6e1d6' stroke-width='2.5' stroke-linecap='round'/>",
  ),
  build: svgCursor(
    "<path d='M6 18L14 10' stroke='#000' stroke-width='5' stroke-linecap='round'/><path d='M6 18L14 10' stroke='#c9a06a' stroke-width='2.5' stroke-linecap='round'/><rect x='11' y='3' width='10' height='7' rx='1.5' transform='rotate(45 16 6.5)' fill='#e6e1d6' stroke='#000' stroke-width='1.5'/>",
  ),
  move: svgCursor(
    "<circle cx='12' cy='12' r='6' fill='none' stroke='#000' stroke-width='4'/><circle cx='12' cy='12' r='6' fill='none' stroke='#8fe08f' stroke-width='2'/>",
  ),
};

export class InputController {
  selected = new Set<number>();
  mode: Mode = { kind: "normal" };
  formation: Formation = "line";
  groups = new Map<number, number[]>();
  hover: Hover | null = null;
  dragBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Last "under attack" location, for the jump-to-alert key. */
  lastAlert: { x: number; y: number } | null = null;

  private pointers = new Map<number, Pointer>();
  private gesture: "none" | "pan" | "marquee" | "pinch" = "none";
  private pinch: { dist: number; cx: number; cy: number } | null = null;
  private longPress: ReturnType<typeof setTimeout> | null = null;
  private keys = new Set<string>();
  private mouse: { x: number; y: number; inside: boolean } = { x: 0, y: 0, inside: false };
  private lastClick: { t: number; kind: string | null; x: number; y: number } | null = null;
  private lastGroupRecall: { n: number; t: number } | null = null;
  private idleCursor = 0;

  constructor(private deps: InputDeps) {}

  private get world() {
    return this.deps.world();
  }

  // ------------------------------------------------------------ picking

  /**
   * The entity under a screen point, frontmost first.
   *
   * Hit-testing in screen space rather than by tile: a unit's body is drawn
   * well above the tile it stands on, and clicking its head should select it,
   * not the empty tile behind it.
   */
  pick(sx: number, sy: number): Entity | null {
    const { cam } = this.deps;
    const owner = this.deps.owner;
    const candidates = [...this.world.entities.values()]
      .filter((e) => canSee(this.world, owner, e))
      .sort((a, b) => depth(b.x, b.y) - depth(a.x, a.y));
    const z = cam.zoom;

    // Units first. They're small, so a click on one is deliberate — and a
    // villager standing by a town centre shouldn't lose to the building.
    for (const e of candidates) {
      if (isBuilding(e.kind)) continue;
      const p = tileToScreen(e.x, e.y, cam);
      const bodyY = p.sy - 9 * z;
      if (Math.abs(sx - p.sx) <= 9 * z && Math.abs(sy - bodyY) <= 14 * z) return e;
    }

    for (const e of candidates) {
      if (!isBuilding(e.kind)) continue;
      const p = tileToScreen(e.x, e.y, cam);
      const size = footprint(e).size;
      const hw = (TILE_W / 2) * size * z;
      const hh = (TILE_H / 2) * size * z;
      const wall = wallHeight(e.kind) * z * (e.progress ?? 1);
      // The true outline of an isometric box: between the lower edge of the
      // base diamond and the upper edge of the roof diamond. A bounding
      // rectangle also claims the empty space above the roof's corners —
      // exactly where a unit standing beside the building appears.
      const u = Math.abs(sx - p.sx) / hw;
      if (u > 1) continue;
      const slack = hh * (1 - u);
      if (sy <= p.sy + slack && sy >= p.sy - wall - slack) return e;
    }
    return null;
  }

  private targetAt(sx: number, sy: number): ClickTarget {
    const hit = this.pick(sx, sy);
    if (hit) return { kind: "entity", entity: hit };
    const t = screenToTile(sx, sy, this.deps.cam);
    const resolved = resolveTarget(this.world, this.deps.owner, t.x, t.y);
    // Tile-based entity hits are already covered by the screen-space pick.
    return resolved.kind === "entity" ? { kind: "ground", x: t.x, y: t.y } : resolved;
  }

  // ------------------------------------------------------------ selection

  select(ids: Iterable<number>, additive = false) {
    if (!additive) this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.pruneSelection();
    this.deps.changed();
  }

  deselect() {
    this.selected.clear();
    this.mode = { kind: "normal" };
    this.deps.changed();
  }

  /**
   * Drop anything dead, and never mix your own things with an enemy's.
   * Inspecting an enemy is single-select only.
   */
  pruneSelection() {
    for (const id of [...this.selected]) {
      const e = this.world.entities.get(id);
      if (!e || !canSee(this.world, this.deps.owner, e)) this.selected.delete(id);
    }
    const ownCount = [...this.selected].filter(
      (id) => this.world.entities.get(id)?.owner === this.deps.owner,
    ).length;
    if (ownCount > 0) {
      for (const id of [...this.selected]) {
        if (this.world.entities.get(id)?.owner !== this.deps.owner) this.selected.delete(id);
      }
    } else if (this.selected.size > 1) {
      const first = [...this.selected][0];
      this.selected = new Set([first]);
    }
  }

  private selectBox(box: { x0: number; y0: number; x1: number; y1: number }, additive: boolean) {
    const x0 = Math.min(box.x0, box.x1);
    const x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1);
    const y1 = Math.max(box.y0, box.y1);
    const inside = (e: Entity) => {
      const p = tileToScreen(e.x, e.y, this.deps.cam);
      const by = p.sy - 8 * this.deps.cam.zoom;
      return p.sx >= x0 && p.sx <= x1 && by >= y0 && by <= y1;
    };
    const mine = [...this.world.entities.values()].filter((e) => e.owner === this.deps.owner);
    // Units win over buildings: dragging across your base to grab the army
    // shouldn't also grab the barracks.
    let picked = mine.filter((e) => isUnit(e.kind) && inside(e));
    if (picked.length === 0) picked = mine.filter((e) => isBuilding(e.kind) && inside(e)).slice(0, 1);
    this.select(
      picked.map((e) => e.id),
      additive,
    );
  }

  /** Everything of one kind that's on screen — double-click or ctrl-click. */
  private selectKindOnScreen(kind: string) {
    const view = this.deps.view();
    const ids = [...this.world.entities.values()]
      .filter((e) => e.owner === this.deps.owner && e.kind === kind)
      .filter((e) => {
        const p = tileToScreen(e.x, e.y, this.deps.cam);
        return p.sx >= 0 && p.sx <= view.width && p.sy >= 0 && p.sy <= view.height;
      })
      .map((e) => e.id);
    this.select(ids);
  }

  private clickSelect(sx: number, sy: number, shift: boolean, ctrl: boolean) {
    const hit = this.pick(sx, sy);
    const now = performance.now();
    const double =
      !!hit &&
      !!this.lastClick &&
      now - this.lastClick.t < DOUBLE_MS &&
      this.lastClick.kind === hit.kind &&
      Math.hypot(sx - this.lastClick.x, sy - this.lastClick.y) < 12;
    this.lastClick = { t: now, kind: hit?.kind ?? null, x: sx, y: sy };

    if (!hit) {
      if (!shift) this.deselect();
      return;
    }
    if (hit.owner !== this.deps.owner) {
      this.select([hit.id]); // inspect
      return;
    }
    if (double || ctrl) {
      this.selectKindOnScreen(hit.kind);
      return;
    }
    if (shift && this.selected.has(hit.id)) {
      this.selected.delete(hit.id);
      this.deps.changed();
      return;
    }
    this.select([hit.id], shift);
  }

  // ------------------------------------------------------------ orders

  private marker(order: OrderKind, x: number, y: number) {
    emit(this.world, { kind: "marker", order, x, y, t: this.world.time, life: 0.7 });
  }

  /** The context order: right-click on desktop, tap on touch. */
  private order(sx: number, sy: number, shift: boolean) {
    const target = this.targetAt(sx, sy);
    const result = issueContextOrder(this.world, this.deps.owner, this.selected, target, {
      formation: this.formation,
      queue: shift,
    });
    if (result) this.marker(result.order, result.x, result.y);
  }

  private executeMode(sx: number, sy: number, shift: boolean) {
    const mode = this.mode;
    const tile = screenToTile(sx, sy, this.deps.cam);
    if (mode.kind === "attackMove" || mode.kind === "patrol") {
      const result = issueContextOrder(
        this.world,
        this.deps.owner,
        this.selected,
        this.targetAt(sx, sy),
        { formation: this.formation, queue: shift, mode: mode.kind },
      );
      if (result) this.marker(result.order, result.x, result.y);
    } else if (mode.kind === "place") {
      this.place(mode.building, tile.x, tile.y);
    }
    // Shift keeps the mode, so several houses can be placed in a row.
    if (!shift) this.mode = { kind: "normal" };
    this.deps.changed();
  }

  private place(kind: BuildingKind, x: number, y: number) {
    const w = this.world;
    const tx = Math.round(x);
    const ty = Math.round(y);
    const builders = ownSelection(w, this.deps.owner, this.selected).filter((e) => e.kind === "villager");
    if (builders.length === 0) {
      notify(w, "Select a villager to build with.");
      return;
    }
    if (!canPlaceBuilding(w, kind, tx, ty)) {
      notify(w, "Can't build there — it needs clear, open ground.");
      return;
    }
    const spec = BUILDINGS[kind];
    if (!canAfford(w, this.deps.owner, spec.cost)) {
      notify(w, `Not enough resources for a ${spec.name}.`);
      return;
    }
    pay(w, this.deps.owner, spec.cost);
    const site = spawn(w, kind, this.deps.owner, tx, ty, 0.01);
    for (const b of builders) commandBuild(w, b, site.id);
    this.marker("build", tx, ty);
  }

  // ------------------------------------------------------------ actions (HUD)

  run(id: string) {
    const [group, arg] = id.split(":");
    const w = this.world;
    if (group === "build") {
      const kind = arg as BuildingKind;
      const card = commandCard(w, this.deps.owner, this.selected, this.mode, this.formation);
      const button = card.find((b) => b.id === id);
      if (button && !button.enabled) {
        notify(w, button.why ?? "Can't build that right now.");
        return;
      }
      this.mode =
        this.mode.kind === "place" && this.mode.building === kind
          ? { kind: "normal" }
          : { kind: "place", building: kind };
    } else if (group === "train") {
      this.train(arg as UnitKind);
    } else if (group === "act") {
      if (arg === "attackMove") this.mode = this.mode.kind === "attackMove" ? { kind: "normal" } : { kind: "attackMove" };
      if (arg === "patrol") this.mode = this.mode.kind === "patrol" ? { kind: "normal" } : { kind: "patrol" };
      if (arg === "stop") for (const e of ownSelection(w, this.deps.owner, this.selected)) commandStop(e);
      if (arg === "formation") this.cycleFormation();
    }
    this.deps.changed();
  }

  /** Queue at whichever selected building has the shortest queue. */
  train(kind: UnitKind) {
    const w = this.world;
    const producers = ownSelection(w, this.deps.owner, this.selected)
      .filter((e) => isBuilding(e.kind) && (e.progress ?? 1) === 1)
      .filter((e) => BUILDINGS[e.kind as BuildingKind].trains.includes(kind))
      .sort((a, b) => (a.queue?.length ?? 0) - (b.queue?.length ?? 0));
    if (producers.length === 0) return;
    const err = enqueueTraining(w, producers[0], kind);
    if (err) notify(w, err);
    this.deps.changed();
  }

  cancelQueue(index: number) {
    const b = ownSelection(this.world, this.deps.owner, this.selected).find((e) => isBuilding(e.kind));
    if (b) cancelTraining(this.world, b, index);
    this.deps.changed();
  }

  cycleFormation() {
    const i = FORMATIONS.indexOf(this.formation);
    this.formation = FORMATIONS[(i + 1) % FORMATIONS.length];
    this.deps.changed();
  }

  selectIdleVillager() {
    const idle = [...this.world.entities.values()].filter(
      (e) => e.owner === this.deps.owner && e.kind === "villager" && e.state?.name === "idle",
    );
    if (idle.length === 0) {
      notify(this.world, "No idle villagers.");
      return;
    }
    this.idleCursor = (this.idleCursor + 1) % idle.length;
    const v = idle[this.idleCursor];
    this.select([v.id]);
    centerOn(this.deps.cam, v.x, v.y, this.deps.view());
  }

  selectArmy() {
    const ids = [...this.world.entities.values()]
      .filter((e) => e.owner === this.deps.owner && (e.kind === "spearman" || e.kind === "archer" || e.kind === "rider"))
      .map((e) => e.id);
    this.select(ids);
  }

  focusTownCentre() {
    const tc = [...this.world.entities.values()].find(
      (e) => e.owner === this.deps.owner && e.kind === "towncenter",
    );
    if (!tc) return;
    this.select([tc.id]);
    centerOn(this.deps.cam, tc.x, tc.y, this.deps.view());
  }

  centerOnSelection() {
    const sel = [...this.selected].map((id) => this.world.entities.get(id)).filter((e): e is Entity => !!e);
    if (sel.length) {
      const x = sel.reduce((a, e) => a + e.x, 0) / sel.length;
      const y = sel.reduce((a, e) => a + e.y, 0) / sel.length;
      centerOn(this.deps.cam, x, y, this.deps.view());
    } else if (this.lastAlert) {
      centerOn(this.deps.cam, this.lastAlert.x, this.lastAlert.y, this.deps.view());
    }
  }

  jumpToAlert() {
    if (this.lastAlert) centerOn(this.deps.cam, this.lastAlert.x, this.lastAlert.y, this.deps.view());
  }

  alarm() {
    const n = soundAlarm(this.world, this.deps.owner);
    notify(this.world, n ? `${n} villagers sheltering.` : "No villagers to shelter.");
  }

  resumeWork() {
    const n = backToWork(this.world, this.deps.owner);
    notify(this.world, n ? `${n} villagers back to work.` : "Nobody to send back.");
  }

  assignGroup(n: number) {
    const ids = ownSelection(this.world, this.deps.owner, this.selected).map((e) => e.id);
    if (ids.length === 0) return;
    this.groups.set(n, ids);
    notify(this.world, `Group ${n} set (${ids.length}).`);
    this.deps.changed();
  }

  recallGroup(n: number) {
    const ids = (this.groups.get(n) ?? []).filter((id) => this.world.entities.has(id));
    this.groups.set(n, ids);
    if (ids.length === 0) return;
    const now = performance.now();
    const again = this.lastGroupRecall?.n === n && now - this.lastGroupRecall.t < 400;
    this.lastGroupRecall = { n, t: now };
    this.select(ids);
    if (again) this.centerOnSelection();
  }

  /** Minimap: left moves the camera there, right orders the selection there. */
  minimapCenter(x: number, y: number) {
    centerOn(this.deps.cam, x, y, this.deps.view());
  }

  minimapOrder(x: number, y: number, shift: boolean) {
    const target = resolveTarget(this.world, this.deps.owner, x, y);
    const result = issueContextOrder(this.world, this.deps.owner, this.selected, target, {
      formation: this.formation,
      queue: shift,
      mode: this.mode.kind === "attackMove" || this.mode.kind === "patrol" ? this.mode.kind : undefined,
    });
    if (result) this.marker(result.order, result.x, result.y);
    if (!shift && this.mode.kind !== "place") this.mode = { kind: "normal" };
    this.deps.changed();
  }

  // ------------------------------------------------------------ pointer events

  private local(ev: PointerEvent | WheelEvent) {
    const canvas = this.deps.canvas();
    const rect = canvas!.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  pointerDown = (ev: PointerEvent) => {
    const canvas = this.deps.canvas();
    if (!canvas) return;
    canvas.setPointerCapture(ev.pointerId);
    const p = this.local(ev);
    const ptr: Pointer = {
      id: ev.pointerId,
      type: ev.pointerType,
      button: ev.button,
      x: p.x,
      y: p.y,
      startX: p.x,
      startY: p.y,
      startT: performance.now(),
    };
    this.pointers.set(ev.pointerId, ptr);

    if (ev.pointerType === "touch") {
      if (this.pointers.size === 2) {
        this.cancelLongPress();
        this.dragBox = null;
        this.gesture = "pinch";
        this.pinch = this.pinchState();
      } else if (this.pointers.size === 1) {
        this.gesture = "none";
        // Hold still to start a selection box; drag straight away to pan.
        this.longPress = setTimeout(() => {
          this.gesture = "marquee";
          this.dragBox = { x0: ptr.x, y0: ptr.y, x1: ptr.x, y1: ptr.y };
        }, LONG_PRESS_MS);
      }
      return;
    }

    if (ev.button === 1) this.gesture = "pan";
  };

  pointerMove = (ev: PointerEvent) => {
    const p = this.local(ev);
    if (ev.pointerType !== "touch") this.updateHover(p.x, p.y);
    const ptr = this.pointers.get(ev.pointerId);
    if (!ptr) return;
    const dx = p.x - ptr.x;
    const dy = p.y - ptr.y;
    ptr.x = p.x;
    ptr.y = p.y;
    const moved = Math.hypot(p.x - ptr.startX, p.y - ptr.startY);

    if (ptr.type === "touch") {
      if (this.gesture === "pinch" && this.pinch) {
        const next = this.pinchState();
        if (next && this.pinch.dist > 0) {
          panBy(this.deps.cam, next.cx - this.pinch.cx, next.cy - this.pinch.cy);
          zoomAt(this.deps.cam, next.cx, next.cy, next.dist / this.pinch.dist);
        }
        this.pinch = next;
        return;
      }
      if (this.gesture === "marquee" && this.dragBox) {
        this.dragBox.x1 = p.x;
        this.dragBox.y1 = p.y;
        return;
      }
      if (moved > TOUCH_DRAG_THRESHOLD) {
        this.cancelLongPress();
        this.gesture = "pan";
      }
      if (this.gesture === "pan") panBy(this.deps.cam, dx, dy);
      return;
    }

    // Mouse / pen.
    if (this.gesture === "pan") {
      panBy(this.deps.cam, dx, dy);
      return;
    }
    if (ptr.button === 2 && moved > DRAG_THRESHOLD) {
      // Right-drag pans: kinder to trackpads, and it never issues an order.
      this.gesture = "pan";
      return;
    }
    if (ptr.button === 0 && this.mode.kind === "normal" && moved > DRAG_THRESHOLD) {
      this.gesture = "marquee";
      this.dragBox = { x0: ptr.startX, y0: ptr.startY, x1: p.x, y1: p.y };
    }
  };

  pointerUp = (ev: PointerEvent) => {
    const canvas = this.deps.canvas();
    if (canvas?.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    const ptr = this.pointers.get(ev.pointerId);
    this.pointers.delete(ev.pointerId);
    if (!ptr) return;
    const shift = ev.shiftKey;

    if (ptr.type === "touch") {
      this.cancelLongPress();
      if (this.gesture === "pinch") {
        if (this.pointers.size < 2) this.gesture = this.pointers.size === 1 ? "pan" : "none";
        this.pinch = null;
        return;
      }
      if (this.gesture === "marquee" && this.dragBox) {
        this.selectBox(this.dragBox, false);
        this.dragBox = null;
        this.gesture = "none";
        return;
      }
      if (this.gesture === "pan") {
        this.gesture = "none";
        return;
      }
      this.tap(ptr.x, ptr.y);
      return;
    }

    const wasGesture = this.gesture;
    this.gesture = "none";
    if (wasGesture === "pan") return;

    if (ptr.button === 0) {
      if (wasGesture === "marquee" && this.dragBox) {
        this.selectBox(this.dragBox, shift);
        this.dragBox = null;
        return;
      }
      if (this.mode.kind !== "normal") this.executeMode(ptr.x, ptr.y, shift);
      else this.clickSelect(ptr.x, ptr.y, shift, ev.ctrlKey || ev.metaKey);
    } else if (ptr.button === 2) {
      if (this.mode.kind !== "normal") {
        // Right-click cancels a pending mode, as in most RTS games.
        this.mode = { kind: "normal" };
        this.deps.changed();
        return;
      }
      this.order(ptr.x, ptr.y, shift);
    }
  };

  pointerCancel = (ev: PointerEvent) => {
    this.pointers.delete(ev.pointerId);
    this.cancelLongPress();
    this.gesture = "none";
    this.dragBox = null;
    this.pinch = null;
  };

  /** A touch tap: select your own, otherwise order what's selected. */
  private tap(sx: number, sy: number) {
    if (this.mode.kind !== "normal") {
      this.executeMode(sx, sy, false);
      return;
    }
    const hit = this.pick(sx, sy);
    const hasOwn = ownSelection(this.world, this.deps.owner, this.selected).length > 0;
    if (hit && hit.owner === this.deps.owner) {
      const own = ownSelection(this.world, this.deps.owner, this.selected);
      const orderable = own.some((e) => isUnit(e.kind));
      // With villagers selected, tapping your own unfinished or damaged
      // building means "work on it", not "select it".
      const worksOnIt =
        orderable &&
        isBuilding(hit.kind) &&
        own.some((e) => e.kind === "villager") &&
        ((hit.progress ?? 1) < 1 || hit.hp < maxHp(hit.kind));
      if (worksOnIt) {
        this.order(sx, sy, false);
        return;
      }
      this.clickSelect(sx, sy, false, false);
      return;
    }
    if (hasOwn) {
      this.order(sx, sy, false);
      return;
    }
    this.clickSelect(sx, sy, false, false);
  }

  private pinchState() {
    const pts = [...this.pointers.values()].filter((p) => p.type === "touch").slice(0, 2);
    if (pts.length < 2) return null;
    return {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
    };
  }

  private cancelLongPress() {
    if (this.longPress) clearTimeout(this.longPress);
    this.longPress = null;
  }

  /**
   * Scroll wheel: zoom for a mouse, pan for a trackpad, zoom for a pinch.
   *
   * A trackpad's two-finger scroll arrives as small or horizontal wheel
   * deltas, and a pinch arrives with ctrlKey set; a mouse wheel moves in big
   * vertical notches. Treating everything as zoom makes trackpads miserable.
   */
  wheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const p = this.local(ev);
    if (ev.ctrlKey) {
      zoomAt(this.deps.cam, p.x, p.y, Math.exp(-ev.deltaY * 0.01));
      return;
    }
    const trackpad = ev.deltaMode === 0 && (Math.abs(ev.deltaX) > 0.5 || Math.abs(ev.deltaY) < 40);
    if (trackpad) {
      panBy(this.deps.cam, -ev.deltaX, -ev.deltaY);
      return;
    }
    zoomAt(this.deps.cam, p.x, p.y, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  // ------------------------------------------------------------ keyboard

  keyDown = (ev: KeyboardEvent) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    this.keys.add(ev.key);
    const key = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
    const w = this.world;

    // Control groups use the physical digit key, so Shift or Option layouts
    // that change the character still work.
    const digit = /^Digit([1-9])$/.exec(ev.code);
    if (digit) {
      const n = Number(digit[1]);
      if (ev.ctrlKey || ev.altKey) {
        ev.preventDefault();
        this.assignGroup(n);
      } else if (!ev.metaKey) {
        this.recallGroup(n);
      }
      return;
    }
    if (ev.metaKey || ev.ctrlKey) return; // leave browser shortcuts alone

    if (key === "Escape") {
      if (this.mode.kind !== "normal") this.mode = { kind: "normal" };
      else this.deselect();
      this.deps.changed();
      return;
    }
    if (key === "F3" || key === "Pause") {
      ev.preventDefault();
      this.deps.togglePause();
      return;
    }
    if (key === ".") return this.selectIdleVillager();
    if (key === "H") return this.focusTownCentre();
    if (key === " ") {
      ev.preventDefault();
      return this.centerOnSelection();
    }
    if (key === "B") return ev.shiftKey ? this.resumeWork() : this.alarm();
    if (key === "+" || key === "=") return zoomAt(this.deps.cam, this.deps.view().width / 2, this.deps.view().height / 2, 1.15);
    if (key === "-" || key === "_") return zoomAt(this.deps.cam, this.deps.view().width / 2, this.deps.view().height / 2, 1 / 1.15);

    const own = ownSelection(w, this.deps.owner, this.selected);
    const units = own.filter((e) => isUnit(e.kind));
    const buildingsOnly = units.length === 0 && own.some((e) => isBuilding(e.kind));

    if (units.length > 0) {
      if (key === "A") return this.run("act:attackMove");
      if (key === "S") return this.run("act:stop");
      if (key === "P") return this.run("act:patrol");
      if (key === "F") return this.run("act:formation");
      if (own.some((e) => e.kind === "villager")) {
        const build = BUILD_KEYS.find(([, k]) => k === key);
        if (build) return this.run(`build:${build[0]}`);
      }
    }
    if (buildingsOnly) {
      const card = commandCard(w, this.deps.owner, this.selected, this.mode, this.formation).filter(
        (b) => b.group === "train",
      );
      const i = TRAIN_KEYS.indexOf(key);
      if (i >= 0 && card[i]) return this.run(card[i].id);
      if (key === "Backspace" || key === "Delete") {
        const b = own.find((e) => isBuilding(e.kind));
        const last = (b?.queue?.length ?? 0) - 1;
        if (last >= 0) this.cancelQueue(last);
      }
    }
  };

  keyUp = (ev: KeyboardEvent) => {
    this.keys.delete(ev.key);
  };

  trackMouse = (ev: PointerEvent) => {
    if (ev.pointerType !== "mouse") return;
    const canvas = this.deps.canvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this.mouse = { x: ev.clientX - rect.left, y: ev.clientY - rect.top, inside: true };
  };

  mouseLeftWindow = () => {
    this.mouse.inside = false;
  };

  // ------------------------------------------------------------ per frame

  update(dt: number) {
    const cam = this.deps.cam;
    const view = this.deps.view();
    const speed = 780 * dt;
    if (this.keys.has("ArrowLeft")) cam.ox += speed;
    if (this.keys.has("ArrowRight")) cam.ox -= speed;
    if (this.keys.has("ArrowUp")) cam.oy += speed;
    if (this.keys.has("ArrowDown")) cam.oy -= speed;

    if (
      this.mouse.inside &&
      this.gesture === "none" &&
      typeof document !== "undefined" &&
      document.hasFocus()
    ) {
      const { vx, vy } = edgePan(this.mouse.x, this.mouse.y, view);
      cam.ox += vx * dt;
      cam.oy += vy * dt;
    }

    clampCamera(cam, view, this.world.map.width, this.world.map.height);
    this.pruneSelection();

    // The camera moves under a still mouse, so hover is refreshed every frame.
    if (this.mouse.inside) this.updateHover(this.mouse.x, this.mouse.y);
  }

  private updateHover(sx: number, sy: number) {
    const t = screenToTile(sx, sy, this.deps.cam);
    const hit = this.pick(sx, sy);
    const target = hit ? null : resolveTarget(this.world, this.deps.owner, t.x, t.y);
    this.hover = {
      x: t.x,
      y: t.y,
      entityId: hit?.id ?? null,
      resource: target?.kind === "resource",
    };
    const canvas = this.deps.canvas();
    if (canvas) canvas.style.cursor = this.cursorFor(hit, target);
  }

  private cursorFor(hit: Entity | null, target: ClickTarget | null): string {
    if (this.mode.kind === "attackMove" || this.mode.kind === "patrol") return CURSORS.attack;
    if (this.mode.kind === "place") return "crosshair";
    const t: ClickTarget | null = hit ? { kind: "entity", entity: hit } : target;
    if (!t) return "default";
    const intent = previewOrder(this.world, this.deps.owner, this.selected, t);
    if (hit && hit.owner === this.deps.owner && intent !== "build") return "pointer";
    switch (intent) {
      case "attack":
        return CURSORS.attack;
      case "gather":
        return CURSORS.gather;
      case "build":
        return CURSORS.build;
      case "move":
        return CURSORS.move;
      default:
        return hit ? "pointer" : "default";
    }
  }

  placementPreview(): { kind: BuildingKind; valid: boolean; x: number; y: number } | null {
    if (this.mode.kind !== "place" || !this.hover) return null;
    const x = Math.round(this.hover.x);
    const y = Math.round(this.hover.y);
    return {
      kind: this.mode.building,
      x,
      y,
      valid:
        canPlaceBuilding(this.world, this.mode.building, x, y) &&
        canAfford(this.world, this.deps.owner, BUILDINGS[this.mode.building].cost),
    };
  }

  modeTint(): string | null {
    if (this.mode.kind === "attackMove") return "rgba(255,95,70,0.8)";
    if (this.mode.kind === "patrol") return "rgba(255,190,90,0.8)";
    return null;
  }
}

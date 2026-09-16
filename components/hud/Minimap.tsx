"use client";

import { useEffect, useRef } from "react";
import { TerrainLayer, drawMinimap, fromMini, layoutFor } from "@/game/minimap";
import type { InputController } from "@/game/input";
import type { World } from "@/game/types";

interface Source {
  world: World;
  corners: { x: number; y: number }[];
  selected: Set<number>;
  alerts: { x: number; y: number; age: number }[];
}

/**
 * Left-drag moves the camera; right-click sends the selection. It redraws on
 * its own animation frame from the live world rather than through React.
 */
export function Minimap({
  source,
  input,
  width,
  onChange,
}: {
  source: () => Source;
  input: InputController;
  width: number;
  onChange: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const layer = useRef(new TerrainLayer());
  const dragging = useRef(false);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = ref.current;
      if (!canvas) return;
      const s = source();
      const layout = layoutFor(s.world.map.width, width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(layout.width * dpr);
      const h = Math.round(layout.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMinimap(ctx, s.world, layout, layer.current.get(s.world, 0), {
        owner: 0,
        dpr,
        selected: s.selected,
        viewCorners: s.corners,
        alerts: s.alerts,
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [source, width]);

  const toTile = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const s = source();
    const layout = layoutFor(s.world.map.width, width);
    return fromMini(layout, ev.clientX - rect.left, ev.clientY - rect.top);
  };

  const height = layoutFor(source().world.map.width, width).height;

  return (
    <canvas
      ref={ref}
      style={{ width, height }}
      className="block cursor-pointer touch-none"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(ev) => {
        ev.stopPropagation();
        const t = toTile(ev);
        if (ev.button === 2) {
          input.minimapOrder(t.x, t.y, ev.shiftKey);
          onChange();
          return;
        }
        dragging.current = true;
        ev.currentTarget.setPointerCapture(ev.pointerId);
        input.minimapCenter(t.x, t.y);
      }}
      onPointerMove={(ev) => {
        if (!dragging.current) return;
        const t = toTile(ev);
        input.minimapCenter(t.x, t.y);
      }}
      onPointerUp={(ev) => {
        dragging.current = false;
        if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
          ev.currentTarget.releasePointerCapture(ev.pointerId);
        }
      }}
    />
  );
}

"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/game/useGame";
import { Minimap } from "@/components/hud/Minimap";
import {
  CommandCard,
  Groups,
  Objectives,
  QuickActions,
  SelectionPanel,
  Toasts,
  TopBar,
  frame,
} from "@/components/hud/Panels";
import { EndScreen, Menu, PausedBadge, StartScreen } from "@/components/hud/Overlays";

function useMedia(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const q = window.matchMedia(query);
    const update = () => setMatch(q.matches);
    update();
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, [query]);
  return match;
}

export default function Page() {
  const { canvasRef, hud, input, newGame, begin, togglePause, minimapSource, touched } = useGame();
  const [menu, setMenu] = useState(false);
  // A phone held sideways is wide but very short, so compact mode keys on
  // height as well as width — otherwise the HUD takes half the screen.
  const compact = useMedia("(max-width: 640px), (max-height: 520px)");
  const touch = useMedia("(pointer: coarse)");

  // Opening the menu pauses; closing it resumes only if it paused.
  const openMenu = () => {
    if (hud.started && !hud.paused) togglePause();
    setMenu(true);
  };
  const closeMenu = () => {
    if (hud.started && hud.paused) togglePause();
    setMenu(false);
  };

  const run = (id: string) => {
    input.run(id);
    touched();
  };

  const modeLabel =
    hud.mode.kind === "attackMove"
      ? "Attack-move: click a destination · right-click to cancel"
      : hud.mode.kind === "patrol"
        ? "Patrol: click the far end · right-click to cancel"
        : hud.mode.kind === "place"
          ? "Place the building · Shift to place several · right-click to cancel"
          : null;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0e0c0a] select-none">
      <canvas
        ref={canvasRef}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => input.pointerDown(e.nativeEvent)}
        onPointerMove={(e) => input.pointerMove(e.nativeEvent)}
        onPointerUp={(e) => {
          input.pointerUp(e.nativeEvent);
          touched();
        }}
        onPointerCancel={(e) => input.pointerCancel(e.nativeEvent)}
      />

      {/* Top: resources */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-2">
        <div className="w-full max-w-4xl">
          <TopBar
            hud={hud}
            onIdle={() => {
              input.selectIdleVillager();
              touched();
            }}
            onPause={togglePause}
            onMenu={openMenu}
          />
        </div>
      </div>

      {/* Left: objectives */}
      <div className={`pointer-events-none absolute left-2 z-10 ${compact ? "top-11" : "top-14"}`}>
        <Objectives items={hud.objectives} compact={compact} />
      </div>

      {/* Centre: alerts, notices, and the active mode */}
      <div className="pointer-events-none absolute inset-x-0 top-12 z-10 flex flex-col items-center gap-1 px-2 sm:top-14">
        <Toasts
          notices={hud.notices}
          alerts={hud.alerts}
          onAlert={() => {
            input.jumpToAlert();
            touched();
          }}
        />
        {modeLabel && (
          <span className="rounded-md bg-[#3a2410]/90 px-3 py-1 text-[12px] text-[#ffcf96]">{modeLabel}</span>
        )}
      </div>

      {/* Bottom: minimap · selection · commands */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 p-1.5 sm:p-2">
        <Groups
          groups={hud.groups}
          onRecall={(n) => {
            input.recallGroup(n);
            touched();
          }}
        />
        <div
          className={`pointer-events-auto flex items-stretch gap-2 overflow-x-auto rounded-lg ${frame} ${
            compact ? "max-h-[118px] p-1" : "p-1.5"
          }`}
        >
          <div className="flex shrink-0 flex-col gap-1.5">
            <div className="rounded border border-[#3a2f25] bg-black/50 p-1">
              <Minimap source={minimapSource} input={input} width={compact ? 104 : 176} onChange={touched} />
            </div>
            <QuickActions
              compact={compact}
              onArmy={() => {
                input.selectArmy();
                touched();
              }}
              onTown={() => {
                input.focusTownCentre();
                touched();
              }}
              onAlarm={() => input.alarm()}
              onWork={() => input.resumeWork()}
            />
          </div>

          <div className="min-w-[180px] flex-1 border-l border-[#3a2f25]">
            <SelectionPanel
              touch={touch}
              selection={hud.selection}
              onCancel={(i) => {
                input.cancelQueue(i);
                touched();
              }}
              onDeselect={() => {
                input.deselect();
                touched();
              }}
            />
          </div>

          {hud.commands.length > 0 && (
            <div className="shrink-0 border-l border-[#3a2f25]">
              <CommandCard commands={hud.commands} onRun={run} />
            </div>
          )}
        </div>
      </div>

      {hud.started && hud.paused && !menu && hud.outcome === "playing" && <PausedBadge />}
      {!hud.started && !menu && <StartScreen onBegin={begin} onHelp={() => setMenu(true)} />}
      {menu && (
        <Menu
          onResume={closeMenu}
          onRestart={() => {
            setMenu(false);
            newGame(hud.difficulty);
          }}
        />
      )}
      <EndScreen hud={hud} onRestart={() => newGame(hud.difficulty)} />

      <div className="pointer-events-none absolute inset-0 z-50 hidden items-center justify-center bg-black/85 p-8 text-center portrait:max-sm:flex">
        <p className="font-serif text-lg text-[#f2dcc0]">
          Turn your phone sideways — Emberhold plays in landscape.
        </p>
      </div>
    </div>
  );
}

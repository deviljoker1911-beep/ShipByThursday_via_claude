"use client";

import { BUILDINGS, UNITS } from "@/game/config";
import { useGame } from "@/game/useGame";
import type { BuildingKind, UnitKind } from "@/game/types";

const BUILD_ORDER: BuildingKind[] = ["house", "farm", "barracks", "towncenter"];

function cost(c: Partial<Record<string, number>>) {
  return Object.entries(c)
    .map(([r, n]) => `${n}${r[0].toUpperCase()}`)
    .join(" ");
}

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Page() {
  const {
    canvasRef,
    hud,
    placing,
    newGame,
    train,
    startPlacing,
    selectAllVillagers,
    selectAllMilitary,
    focusTownCentre,
    handlers,
  } = useGame();

  const capped = hud.pop >= hud.popCap;

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        onContextMenu={(e) => e.preventDefault()}
        {...handlers}
      />

      {/* Resources */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center gap-x-4 gap-y-1 bg-gradient-to-b from-black/75 to-transparent px-3 py-2 text-[13px] sm:px-4 sm:text-sm">
        <span className="font-semibold tracking-tight text-[#f2ece5]">Emberhold</span>
        <Stat label="Food" value={hud.food} color="#e0705a" />
        <Stat label="Wood" value={hud.wood} color="#b08050" />
        <Stat label="Gold" value={hud.gold} color="#e8c46a" />
        <span className={capped ? "text-[#e0705a]" : "text-(--color-muted)"}>
          Pop <span className="font-mono text-[#f2ece5]">{hud.pop}/{hud.popCap}</span>
        </span>
        <span className="ml-auto font-mono text-(--color-muted)">{clock(hud.time)}</span>
      </div>

      {/* Notices */}
      {hud.notices.length > 0 && (
        <div className="pointer-events-none absolute top-12 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1">
          {hud.notices.map((n, i) => (
            <span
              key={i}
              className="rounded-md bg-black/75 px-3 py-1.5 text-xs text-[#e8a488]"
            >
              {n}
            </span>
          ))}
        </div>
      )}

      {placing && (
        <div className="pointer-events-none absolute top-12 left-1/2 -translate-x-1/2 rounded-md bg-black/75 px-3 py-1.5 text-xs text-(--color-body)">
          Placing {BUILDINGS[placing].name} — click a spot, Esc to cancel
        </div>
      )}

      {/* Command bar */}
      <div className="absolute inset-x-0 bottom-0 border-t border-(--color-edge) bg-(--color-panel)/95 backdrop-blur">
        <div className="flex items-stretch gap-2 overflow-x-auto px-2 py-2 sm:px-3">
          <div className="flex shrink-0 flex-col gap-1">
            <span className="text-[10px] tracking-[0.12em] text-[#5f574f] uppercase">
              Select
            </span>
            <div className="flex gap-1">
              <Chip onClick={selectAllVillagers}>Villagers</Chip>
              <Chip onClick={selectAllMilitary}>Army</Chip>
              <Chip onClick={focusTownCentre}>Centre</Chip>
            </div>
          </div>

          <div className="w-px shrink-0 bg-(--color-edge)" />

          <div className="flex shrink-0 flex-col gap-1">
            <span className="text-[10px] tracking-[0.12em] text-[#5f574f] uppercase">
              Build <span className="normal-case opacity-70">(select a villager)</span>
            </span>
            <div className="flex gap-1">
              {BUILD_ORDER.map((kind) => (
                <Chip
                  key={kind}
                  active={placing === kind}
                  onClick={() => startPlacing(kind)}
                  sub={cost(BUILDINGS[kind].cost)}
                >
                  {BUILDINGS[kind].name}
                </Chip>
              ))}
            </div>
          </div>

          {hud.canTrain.length > 0 && (
            <>
              <div className="w-px shrink-0 bg-(--color-edge)" />
              <div className="flex shrink-0 flex-col gap-1">
                <span className="text-[10px] tracking-[0.12em] text-[#5f574f] uppercase">
                  Train
                </span>
                <div className="flex gap-1">
                  {hud.canTrain.map((t) => (
                    <Chip
                      key={t.kind}
                      disabled={!t.affordable}
                      onClick={() => train(t.from, t.kind)}
                      sub={cost(UNITS[t.kind].cost)}
                    >
                      {UNITS[t.kind].name}
                    </Chip>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="ml-auto flex shrink-0 items-end">
            <span className="px-2 pb-1 text-[11px] text-(--color-muted)">
              {hud.selection.length === 0
                ? "Drag to select · right-drag to pan"
                : hud.selection
                    .map((s) => `${s.count}× ${labelFor(s.kind)}`)
                    .join(", ")}
            </span>
          </div>
        </div>
      </div>

      {hud.outcome !== "playing" && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 p-6">
          <div className="max-w-sm rounded-2xl border border-(--color-edge) bg-(--color-panel) p-6 text-center">
            <h2 className="text-2xl font-semibold text-[#f7f2ec]">
              {hud.outcome === "won" ? "The valley is yours" : "Your hold has fallen"}
            </h2>
            <p className="mt-2 text-sm text-(--color-muted)">
              {hud.outcome === "won"
                ? `Enemy town centre destroyed in ${clock(hud.time)}.`
                : `You lost your town centre after ${clock(hud.time)}.`}
            </p>
            <button
              onClick={newGame}
              className="mt-5 rounded-lg bg-(--color-ember) px-5 py-2.5 text-sm font-medium text-[#1a0d03] transition-opacity hover:opacity-90"
            >
              Play again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function labelFor(kind: string) {
  if (kind in UNITS) return UNITS[kind as UnitKind].name;
  if (kind in BUILDINGS) return BUILDINGS[kind as BuildingKind].name;
  return kind;
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className="text-(--color-muted)">
      <span style={{ color }}>{label}</span>{" "}
      <span className="font-mono text-[#f2ece5]">{value}</span>
    </span>
  );
}

function Chip({
  children,
  sub,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  sub?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-w-16 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
        active
          ? "border-(--color-ember) bg-[#e8873c18] text-(--color-ember)"
          : "border-(--color-edge) text-(--color-body) hover:border-[#4a443d]"
      } disabled:cursor-not-allowed disabled:opacity-35`}
    >
      <span className="block text-[12px] leading-tight whitespace-nowrap">{children}</span>
      {sub && (
        <span className="block font-mono text-[9px] leading-tight text-[#5f574f]">{sub}</span>
      )}
    </button>
  );
}

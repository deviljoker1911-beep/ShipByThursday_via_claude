"use client";

import { useState } from "react";
import type { Alert, Hud } from "@/game/useGame";
import type { CommandButton, Objective, Selection } from "@/game/hud";
import { Cost, Portrait, ResourceIcon } from "./icons";

/** Shared frame: dark timber with a warm edge, so the HUD reads as part of the world. */
export const frame =
  "border border-[#4a3b2c] bg-[linear-gradient(180deg,#221b15_0%,#17120e_100%)] shadow-[inset_0_1px_0_rgba(255,220,170,0.07),0_4px_18px_rgba(0,0,0,0.45)]";

export function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ top bar

export function TopBar({
  hud,
  onIdle,
  onPause,
  onMenu,
}: {
  hud: Hud;
  onIdle: () => void;
  onPause: () => void;
  onMenu: () => void;
}) {
  const capped = hud.pop >= hud.popCap;
  const items = [
    { key: "food", value: hud.food, label: "Food" },
    { key: "wood", value: hud.wood, label: "Wood" },
    { key: "gold", value: hud.gold, label: "Gold" },
    { key: "stone", value: hud.stone, label: "Stone" },
  ] as const;
  return (
    <div className={`pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-b-lg px-3 py-1.5 sm:gap-x-5 sm:px-4 ${frame}`}>
      <span className="hidden font-serif text-[15px] font-semibold tracking-wide text-[#f2dcc0] sm:inline">
        Emberhold
      </span>
      {items.map(({ key, value, label }) => {
        const Icon = ResourceIcon[key];
        return (
          <span key={key} className="flex items-center gap-1.5" title={label}>
            <Icon size={15} />
            <span className="font-mono text-[13px] tabular-nums text-[#f5ece0]">{value}</span>
          </span>
        );
      })}
      <span
        className={`flex items-center gap-1.5 ${capped ? "text-[#ff8a70]" : ""}`}
        title={capped ? "Population full — build a House" : "Population"}
      >
        <ResourceIcon.pop size={15} />
        <span className="font-mono text-[13px] tabular-nums text-[#f5ece0]">
          {hud.pop}/{hud.popCap}
        </span>
        {capped && <span className="text-[11px] text-[#ff8a70]">full</span>}
      </span>

      <button
        onClick={onIdle}
        disabled={hud.idleVillagers === 0}
        title="Select the next idle villager (.)"
        className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
          hud.idleVillagers > 0
            ? "border-[#c9873c] bg-[#3a2410] text-[#ffcf96] hover:bg-[#4a2e14]"
            : "border-[#3a2f25] text-[#6d6053]"
        }`}
      >
        Idle <span className="font-mono">{hud.idleVillagers}</span>
      </button>

      <span className="ml-auto flex items-center gap-2">
        <span className="font-mono text-[12px] tabular-nums text-[#b3a594]">{clock(hud.time)}</span>
        <button
          onClick={onPause}
          title="Pause (F3)"
          className="rounded border border-[#4a3b2c] px-2 py-0.5 text-[11px] text-[#d9c8b2] hover:bg-[#2b221a]"
        >
          {hud.paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={onMenu}
          className="rounded border border-[#4a3b2c] px-2 py-0.5 text-[11px] text-[#d9c8b2] hover:bg-[#2b221a]"
        >
          Menu
        </button>
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ objectives

export function Objectives({ items, compact = false }: { items: Objective[]; compact?: boolean }) {
  const [open, setOpen] = useState(true);
  const next = items.find((o) => !o.done);
  const doneCount = items.filter((o) => o.done).length;
  if (!next) return null;

  // On a small screen: just the current step, one line, tap for the hint.
  if (compact) {
    return (
      <button
        onClick={() => setOpen((v) => !v)}
        className={`pointer-events-auto max-w-[58vw] rounded-md px-2 py-1 text-left ${frame}`}
      >
        <span className="block truncate text-[11px] text-[#f5e6d2]">
          <span className="text-[#8d7f6f]">{doneCount + 1}/{items.length}</span> {next.label}
        </span>
        {open && <span className="mt-0.5 block text-[10.5px] leading-snug text-[#b3a594]">{next.hint}</span>}
      </button>
    );
  }
  return (
    <div className={`pointer-events-auto w-64 max-w-[70vw] rounded-lg ${frame}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left"
      >
        <span className="font-serif text-[12px] tracking-wide text-[#f2dcc0]">
          Objectives <span className="font-sans text-[#8d7f6f]">{doneCount}/{items.length}</span>
        </span>
        <span className="text-[10px] text-[#8d7f6f]">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <ol className="space-y-1.5 border-t border-[#3a2f25] px-3 py-2">
          {items.map((o) => {
            const current = o === next;
            return (
              <li key={o.label} className="flex gap-2 text-[11.5px] leading-snug">
                <span
                  className={`mt-[3px] size-2.5 shrink-0 rounded-full border ${
                    o.done
                      ? "border-[#7cc27c] bg-[#7cc27c]"
                      : current
                        ? "border-[#e8a45a] bg-transparent"
                        : "border-[#5b4e41]"
                  }`}
                />
                <span>
                  <span className={o.done ? "text-[#7d8f74] line-through" : current ? "text-[#f5e6d2]" : "text-[#8d7f6f]"}>
                    {o.label}
                  </span>
                  {current && <span className="mt-0.5 block text-[11px] text-[#b3a594]">{o.hint}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ toasts

export function Toasts({
  notices,
  alerts,
  onAlert,
}: {
  notices: string[];
  alerts: Alert[];
  onAlert: () => void;
}) {
  const latest = alerts[alerts.length - 1];
  return (
    <div className="pointer-events-none flex flex-col items-center gap-1">
      {latest && (
        <button
          onClick={onAlert}
          className="pointer-events-auto animate-pulse rounded-md border border-[#7a2d22] bg-[#2a0f0b]/90 px-3 py-1 text-[12px] font-medium text-[#ffb3a3]"
          title="Jump there (Space)"
        >
          {latest.text} — view
        </button>
      )}
      {notices.slice(-2).map((n, i) => (
        <span key={`${n}-${i}`} className="rounded-md bg-black/70 px-3 py-1 text-[12px] text-[#f0dcc4]">
          {n}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ selection

export function SelectionPanel({
  selection,
  onCancel,
  onDeselect,
  touch = false,
}: {
  selection: Selection;
  onCancel: (index: number) => void;
  onDeselect: () => void;
  touch?: boolean;
}) {
  if (selection.kind === "none") {
    return (
      <div className="flex h-full items-center px-3 text-[11.5px] leading-relaxed text-[#8d7f6f]">
        {touch ? (
          <span>Tap a unit to select it, then tap the map to order it. Hold and drag to box-select.</span>
        ) : (
          <span>
            Drag to select · right-click to order · <kbd className="text-[#c9b8a3]">.</kbd> idle villager ·{" "}
            <kbd className="text-[#c9b8a3]">H</kbd> town centre
          </span>
        )}
      </div>
    );
  }

  if (selection.kind === "multi") {
    return (
      <div className="flex h-full min-w-0 flex-col gap-1.5 px-2 py-1.5">
        <div className="flex items-center justify-between">
          <span className="font-serif text-[13px] text-[#f2dcc0]">{selection.title}</span>
          <button onClick={onDeselect} className="px-1 text-[11px] text-[#8d7f6f] hover:text-[#f2dcc0]">
            clear
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {selection.groups!.map((g) => (
            <div
              key={g.kind}
              className="relative flex items-center rounded border border-[#3a2f25] bg-black/30 pr-1.5"
              title={`${g.count} × ${g.label}`}
            >
              <Portrait kind={g.kind} owner={selection.enemy ? 1 : 0} size={30} />
              <span className="font-mono text-[12px] text-[#f5ece0]">×{g.count}</span>
              <span
                className="absolute bottom-0 left-0 h-[3px] rounded-b bg-[#6ecf7b]"
                style={{ width: `${Math.round(g.hpFrac * 100)}%` }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const hpFrac = (selection.hp ?? 0) / (selection.maxHp ?? 1);
  return (
    <div className="flex h-full min-w-0 gap-2.5 px-2 py-1.5">
      <div className="flex shrink-0 flex-col items-center gap-1">
        <div className="rounded border border-[#3a2f25] bg-black/30">
          <Portrait kind={selection.entityKind ?? "villager"} owner={selection.enemy ? 1 : 0} size={46} />
        </div>
        <div className="h-1.5 w-12 overflow-hidden rounded bg-black/60">
          <div
            className="h-full"
            style={{
              width: `${Math.round(hpFrac * 100)}%`,
              background: hpFrac > 0.5 ? "#6ecf7b" : hpFrac > 0.25 ? "#e8c46a" : "#e06b5a",
            }}
          />
        </div>
        <span className="font-mono text-[10px] tabular-nums text-[#b3a594]">
          {selection.hp}/{selection.maxHp}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-serif text-[14px] text-[#f2dcc0]">{selection.title}</span>
          {selection.enemy && <span className="text-[10px] uppercase tracking-wider text-[#ff8a70]">enemy</span>}
        </div>
        <p className="text-[11px] leading-snug text-[#b3a594]">{selection.role}</p>
        {selection.status && <p className="mt-0.5 text-[11px] text-[#e8c79a]">{selection.status}</p>}
        {selection.progress !== undefined && (
          <div className="mt-1 h-1.5 w-full max-w-40 overflow-hidden rounded bg-black/60">
            <div className="h-full bg-[#6fa8dc]" style={{ width: `${Math.round(selection.progress * 100)}%` }} />
          </div>
        )}
        {selection.stats && selection.stats.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-3 text-[10.5px] text-[#8d7f6f]">
            {selection.stats.map((s) => (
              <span key={s.label}>
                {s.label} <span className="font-mono text-[#d9c8b2]">{s.value}</span>
              </span>
            ))}
          </div>
        )}
        {selection.queue && selection.queue.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {selection.queue.map((q, i) => (
              <button
                key={i}
                onClick={() => onCancel(i)}
                title={`${q.label} — click to cancel and refund`}
                className="relative overflow-hidden rounded border border-[#3a2f25] bg-black/40 hover:border-[#a8503c]"
              >
                <Portrait kind={q.kind} owner={0} size={24} />
                {i === 0 && (
                  <span
                    className="absolute bottom-0 left-0 h-[3px] bg-[#e8c46a]"
                    style={{ width: `${Math.round(q.progress * 100)}%` }}
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ commands

export function CommandCard({
  commands,
  onRun,
}: {
  commands: CommandButton[];
  onRun: (id: string) => void;
}) {
  const [tip, setTip] = useState<CommandButton | null>(null);
  if (commands.length === 0) return null;
  const groups: CommandButton["group"][] = ["action", "build", "train"];

  return (
    <div className="relative flex h-full flex-col justify-center gap-1 px-2 py-1.5">
      {groups.map((g) => {
        const list = commands.filter((c) => c.group === g);
        if (list.length === 0) return null;
        return (
          <div key={g} className="flex flex-wrap gap-1">
            {list.map((c) => (
              <button
                key={c.id}
                onClick={() => onRun(c.id)}
                onPointerEnter={(e) => e.pointerType === "mouse" && setTip(c)}
                onPointerLeave={() => setTip(null)}
                aria-disabled={!c.enabled}
                className={`relative min-w-[64px] rounded border py-1 pr-5 pl-2 text-left transition-colors max-sm:pr-2 ${
                  c.active
                    ? "border-[#e8a45a] bg-[#4a2e14]"
                    : c.enabled
                      ? "border-[#4a3b2c] bg-[#221a13] hover:border-[#8a6a48] hover:bg-[#2c2219]"
                      : "border-[#2e261e] bg-[#15110d] opacity-55"
                }`}
              >
                <span className="block text-[11.5px] leading-tight text-[#f2e6d6]">{c.label}</span>
                {c.cost && (
                  <span className="mt-0.5 block text-[10px] text-[#b3a594]">
                    <Cost cost={c.cost} />
                  </span>
                )}
                {c.hotkey && (
                  <span className="absolute top-0.5 right-1 hidden font-mono text-[9px] text-[#8d7f6f] sm:block">
                    {c.hotkey}
                  </span>
                )}
              </button>
            ))}
          </div>
        );
      })}

      {tip && (
        <div className={`pointer-events-none absolute right-2 bottom-full mb-2 w-64 rounded-lg p-2.5 ${frame}`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-serif text-[13px] text-[#f2dcc0]">{tip.title}</span>
            {tip.hotkey && <kbd className="font-mono text-[11px] text-[#e8a45a]">{tip.hotkey}</kbd>}
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-[#c9b8a3]">{tip.body}</p>
          {tip.cost && (
            <div className="mt-1.5 text-[11px] text-[#d9c8b2]">
              <Cost cost={tip.cost} />
            </div>
          )}
          {tip.why && <p className="mt-1.5 text-[11px] text-[#ff9a80]">{tip.why}</p>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ quick actions

export function QuickActions({
  onArmy,
  onTown,
  onAlarm,
  onWork,
  compact = false,
}: {
  onArmy: () => void;
  onTown: () => void;
  onAlarm: () => void;
  onWork: () => void;
  compact?: boolean;
}) {
  const b = `rounded border border-[#4a3b2c] bg-[#1d1611] text-[#d9c8b2] hover:border-[#8a6a48] ${
    compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]"
  }`;
  return (
    <div className="flex flex-wrap gap-1">
      <button className={b} onClick={onArmy} title="Select every soldier">
        Army
      </button>
      <button className={b} onClick={onTown} title="Select the Town Centre (H)">
        Town
      </button>
      <button className={b} onClick={onAlarm} title="All villagers run for shelter (B)">
        Alarm
      </button>
      <button className={b} onClick={onWork} title="Sheltered villagers go back to work (Shift+B)">
        Work
      </button>
    </div>
  );
}

export function Groups({ groups, onRecall }: { groups: { n: number; count: number }[]; onRecall: (n: number) => void }) {
  if (groups.length === 0) return null;
  return (
    <div className="pointer-events-auto flex gap-1">
      {groups.map((g) => (
        <button
          key={g.n}
          onClick={() => onRecall(g.n)}
          className={`rounded px-2 py-0.5 text-[11px] text-[#f2e6d6] ${frame}`}
          title={`Group ${g.n} (${g.count}) — press ${g.n}, twice to jump`}
        >
          <span className="font-mono text-[#e8a45a]">{g.n}</span> ·{g.count}
        </button>
      ))}
    </div>
  );
}

"use client";

import type { Hud } from "@/game/useGame";
import type { Difficulty } from "@/game/ai";
import { clock, frame } from "./Panels";

const SHORTCUTS: [string, string][] = [
  ["Left-click / drag", "Select · box-select"],
  ["Right-click", "Move, gather, attack, build — whatever fits the target"],
  ["Shift + right-click", "Queue the order after the current one"],
  ["Double-click", "Select every unit of that type on screen"],
  ["A · S · P · F", "Attack-move · Stop · Patrol · Formation"],
  ["Q W E R T Y", "Build (villagers) or train (buildings)"],
  ["Ctrl/Alt + 1–9, 1–9", "Set / recall a control group (twice to jump)"],
  [".", "Next idle villager"],
  ["H · Space", "Town Centre · jump to selection or last alert"],
  ["B · Shift+B", "Alarm (shelter villagers) · back to work"],
  ["Arrows / screen edge", "Move the camera"],
  ["Wheel · pinch", "Zoom (two-finger swipe pans on a trackpad)"],
  ["Esc · F3", "Cancel / deselect · pause"],
];

const TOUCH: [string, string][] = [
  ["Tap your unit", "Select it (double-tap: all of that type)"],
  ["Tap anywhere else", "Order the selection there"],
  ["Hold, then drag", "Box-select"],
  ["Drag · pinch", "Move the camera · zoom"],
];

export function Menu({
  onResume,
  onRestart,
}: {
  onResume: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/70 p-4">
      <div className={`max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl p-5 ${frame}`}>
        <h2 className="font-serif text-2xl text-[#f2dcc0]">Emberhold</h2>
        <p className="mt-1 text-[13px] text-[#b3a594]">
          Destroy the enemy Town Centre before they destroy yours.
        </p>

        <h3 className="mt-5 text-[11px] uppercase tracking-[0.14em] text-[#8d7f6f]">How fights are won</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[#d9c8b2]">
          <b className="text-[#f2dcc0]">Spearmen</b> beat riders.{" "}
          <b className="text-[#f2dcc0]">Riders</b> beat archers.{" "}
          <b className="text-[#f2dcc0]">Archers</b> beat spearmen. Arrows barely scratch buildings — bring
          melee to break a base. Your Town Centre and Watchtowers shoot back; ring the alarm and your
          villagers run to them.
        </p>

        <h3 className="mt-5 text-[11px] uppercase tracking-[0.14em] text-[#8d7f6f]">Controls</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-[#e8a45a]">{k}</dt>
              <dd className="text-[#d9c8b2]">{v}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-4 text-[11px] uppercase tracking-[0.14em] text-[#8d7f6f]">On a touch screen</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
          {TOUCH.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-[#e8a45a]">{k}</dt>
              <dd className="text-[#d9c8b2]">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex gap-2">
          <button
            onClick={onResume}
            className="rounded-lg bg-[#e8873c] px-4 py-2 text-sm font-medium text-[#1a0d03] hover:opacity-90"
          >
            Resume
          </button>
          <button
            onClick={onRestart}
            className="rounded-lg border border-[#4a3b2c] px-4 py-2 text-sm text-[#d9c8b2] hover:bg-[#2b221a]"
          >
            New match
          </button>
        </div>
      </div>
    </div>
  );
}

export function PausedBadge() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/3 z-10 text-center">
      <span className={`rounded-lg px-4 py-2 font-serif text-xl tracking-widest text-[#f2dcc0] ${frame}`}>
        PAUSED
      </span>
    </div>
  );
}

export function EndScreen({ hud, onRestart }: { hud: Hud; onRestart: () => void }) {
  if (!hud.end) return null;
  const { verdict, me, them } = hud.end;
  const won = hud.outcome === "won";
  const total = (s: typeof me) => s.gathered.food + s.gathered.wood + s.gathered.gold + s.gathered.stone;
  const rows: [string, number, number][] = [
    ["Resources gathered", total(me), total(them)],
    ["Units trained", me.unitsTrained, them.unitsTrained],
    ["Units lost", me.unitsLost, them.unitsLost],
    ["Enemies killed", me.kills, them.kills],
    ["Buildings built", me.buildingsBuilt, them.buildingsBuilt],
    ["Buildings lost", me.buildingsLost, them.buildingsLost],
  ];
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/80 p-3">
      <div className={`max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-xl p-5 text-center sm:p-6 ${frame}`}>
        <p className={`text-[11px] uppercase tracking-[0.2em] ${won ? "text-[#8fe08f]" : "text-[#ff8a70]"}`}>
          {won ? "Victory" : "Defeat"} · {clock(hud.time)}
        </p>
        <h2 className="mt-1 font-serif text-3xl text-[#f2dcc0]">{verdict.headline}</h2>
        <ul className="mt-3 space-y-1 text-[13px] text-[#d9c8b2]">
          {verdict.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <table className="mx-auto mt-5 w-full text-[12.5px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-[#8d7f6f]">
              <th className="pb-1 text-left font-normal" />
              <th className="pb-1 text-right font-normal text-[#e8873c]">You</th>
              <th className="pb-1 text-right font-normal text-[#6f8fe0]">Them</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, a, b]) => (
              <tr key={label} className="border-t border-[#2e261e]">
                <td className="py-1 text-left text-[#b3a594]">{label}</td>
                <td className="py-1 text-right font-mono tabular-nums text-[#f5ece0]">{a}</td>
                <td className="py-1 text-right font-mono tabular-nums text-[#f5ece0]">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={onRestart}
          className="mt-6 rounded-lg bg-[#e8873c] px-5 py-2.5 text-sm font-medium text-[#1a0d03] hover:opacity-90"
        >
          Play again
        </button>
      </div>
    </div>
  );
}

const LEVELS: { id: Difficulty; name: string; blurb: string }[] = [
  { id: "easy", name: "Easy", blurb: "First attack around nine minutes. Room to learn." },
  { id: "normal", name: "Normal", blurb: "First attack around five and a half minutes." },
  { id: "hard", name: "Hard", blurb: "Raids from minute three, and bigger armies after." },
];

/**
 * The first thing a player sees. The map is already alive behind it, but the
 * clock doesn't start until they choose to begin.
 */
export function StartScreen({
  onBegin,
  onHelp,
}: {
  onBegin: (d: Difficulty) => void;
  onHelp: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-[radial-gradient(ellipse_at_center,rgba(14,12,10,0.55)_0%,rgba(14,12,10,0.92)_70%)] p-3">
      <div className={`max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-xl p-5 sm:p-6 ${frame}`}>
        <p className="text-[11px] uppercase tracking-[0.24em] text-[#c9873c]">A small real-time strategy game</p>
        <h1 className="mt-1 font-serif text-4xl text-[#f2dcc0]">Emberhold</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[#d9c8b2]">
          Two holds, one valley. Gather food, wood, gold and stone; build houses and a barracks;
          raise an army that counters theirs. <b className="text-[#f2dcc0]">Destroy the enemy Town Centre</b>{" "}
          before they destroy yours.
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[#9c8e7e]">
          The objectives panel walks you through the opening. The enemy plays by your rules — same
          costs, same rates, no cheating — and has to scout to find you.
        </p>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              onClick={() => onBegin(l.id)}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                l.id === "normal"
                  ? "border-[#e8873c] bg-[#3a2410] hover:bg-[#4a2e14]"
                  : "border-[#4a3b2c] bg-[#1d1611] hover:border-[#8a6a48]"
              }`}
            >
              <span className="block font-serif text-[15px] text-[#f2dcc0]">{l.name}</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-[#b3a594]">{l.blurb}</span>
            </button>
          ))}
        </div>

        <button onClick={onHelp} className="mt-4 text-[12px] text-[#b3a594] underline underline-offset-4 hover:text-[#f2dcc0]">
          Controls and how fights are won
        </button>
      </div>
    </div>
  );
}

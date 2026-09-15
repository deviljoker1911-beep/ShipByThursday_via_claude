"use client";

import { useState } from "react";
import { BOTS } from "@/lib/bots";
import { MODELS } from "@/lib/models";
import type { Settings } from "@/lib/storage";

export function SettingsPanel({
  settings,
  onChange,
  onClose,
  onReset,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    onChange({ ...settings, [k]: v });

  const toggleBot = (id: string) => {
    const has = settings.roster.includes(id);
    if (has && settings.roster.length === 1) return; // never empty the room
    if (!has && settings.roster.length >= 6) return; // past six it's unreadable
    set("roster", has ? settings.roster.filter((b) => b !== id) : [...settings.roster, id]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8">
      <div className="w-full max-w-lg rounded-2xl border border-(--color-edge) bg-(--color-surface) p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#f2ece5]">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-(--color-muted) transition-colors hover:text-[#f2ece5]"
          >
            Close
          </button>
        </div>

        <label className="mb-1.5 block text-[11px] font-medium tracking-[0.12em] text-[#5f574f] uppercase">
          Anthropic API key
        </label>
        <div className="flex gap-2">
          <input
            type={showKey ? "text" : "password"}
            value={settings.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
            placeholder="sk-ant-..."
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-(--color-edge) bg-(--color-ink) px-3 py-2.5 font-mono text-[13px] text-[#f2ece5] outline-none focus:border-(--color-ember)"
          />
          <button
            onClick={() => setShowKey((v) => !v)}
            className="shrink-0 rounded-lg border border-(--color-edge) px-3 text-xs text-(--color-muted) transition-colors hover:text-[#f2ece5]"
          >
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[#5f574f]">
          Stored in this browser only and sent only to api.anthropic.com. There is
          no server in this app that could receive it.{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="text-(--color-muted) underline underline-offset-2 hover:text-(--color-ember)"
          >
            Get a key
          </a>
          . A Claude Pro or Max subscription does not include API access — it&rsquo;s
          billed separately.
        </p>

        <label className="mt-6 mb-1.5 block text-[11px] font-medium tracking-[0.12em] text-[#5f574f] uppercase">
          Model
        </label>
        <div className="space-y-1.5">
          {MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => set("modelId", m.id)}
              className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                settings.modelId === m.id
                  ? "border-(--color-ember) bg-[#e8873c11]"
                  : "border-(--color-edge) hover:border-[#3d3835]"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-[#f2ece5]">{m.label}</span>
                <span className="font-mono text-[11px] text-[#5f574f]">
                  ${m.inPrice}/${m.outPrice} per Mtok
                </span>
              </div>
              <p className="mt-0.5 text-xs text-(--color-muted)">{m.blurb}</p>
            </button>
          ))}
        </div>

        <label className="mt-6 mb-1.5 block text-[11px] font-medium tracking-[0.12em] text-[#5f574f] uppercase">
          Effort
        </label>
        <div className="flex gap-1.5">
          {(["low", "medium", "high"] as const).map((e) => (
            <button
              key={e}
              onClick={() => set("effort", e)}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs capitalize transition-colors ${
                settings.effort === e
                  ? "border-(--color-ember) text-(--color-ember)"
                  : "border-(--color-edge) text-(--color-muted) hover:text-[#f2ece5]"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[#5f574f]">
          How hard the bots think before answering. Higher is better on real
          decisions and costs more.
        </p>

        <label className="mt-6 mb-1.5 block text-[11px] font-medium tracking-[0.12em] text-[#5f574f] uppercase">
          Who&rsquo;s in the room
        </label>
        <div className="space-y-1.5">
          {BOTS.map((b) => {
            const on = settings.roster.includes(b.id);
            return (
              <button
                key={b.id}
                onClick={() => toggleBot(b.id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  on ? "border-[#3d3835] bg-[#1c1917]" : "border-(--color-edge) opacity-50"
                }`}
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                  style={{ background: `${b.accent}22`, color: b.accent }}
                >
                  {b.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-[13px] text-[#f2ece5]">{b.name}</span>
                  <span className="ml-1.5 text-[11px] text-[#5f574f]">{b.role}</span>
                  <span className="block truncate text-[11px] text-(--color-muted)">
                    {b.tagline}
                  </span>
                </span>
                <span className="text-[11px] text-[#5f574f]">{on ? "in" : "out"}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-[#5f574f]">
          Between one and six. More voices means more disagreement and a bigger
          bill per exchange.
        </p>

        <label className="mt-6 mb-1.5 block text-[11px] font-medium tracking-[0.12em] text-[#5f574f] uppercase">
          Handoff limit
        </label>
        <input
          type="range"
          min={1}
          max={12}
          value={settings.maxBotTurns}
          onChange={(e) => set("maxBotTurns", Number(e.target.value))}
          className="w-full accent-(--color-ember)"
        />
        <p className="mt-1 text-xs text-[#5f574f]">
          Stop after {settings.maxBotTurns} bot turn{settings.maxBotTurns === 1 ? "" : "s"} per
          message. This is the ceiling on what one exchange can cost you.
        </p>

        <label className="mt-6 mb-1.5 block text-[11px] font-medium tracking-[0.12em] text-[#5f574f] uppercase">
          GitHub token <span className="normal-case opacity-60">(optional)</span>
        </label>
        <input
          type="password"
          value={settings.githubToken}
          onChange={(e) => set("githubToken", e.target.value)}
          placeholder="ghp_..."
          spellCheck={false}
          className="w-full rounded-lg border border-(--color-edge) bg-(--color-ink) px-3 py-2.5 font-mono text-[13px] text-[#f2ece5] outline-none focus:border-(--color-ember)"
        />
        <p className="mt-2 text-xs text-[#5f574f]">
          Only used by Kai&rsquo;s repo reader. Raises GitHub&rsquo;s anonymous limit
          from 60 requests an hour to 5,000. A token with no scopes is enough.
        </p>

        <button
          onClick={onReset}
          className="mt-8 w-full rounded-lg border border-[#5c2e22] px-3 py-2.5 text-xs text-[#e8a488] transition-colors hover:bg-[#1d110c]"
        >
          Erase everything stored in this browser
        </button>
      </div>
    </div>
  );
}

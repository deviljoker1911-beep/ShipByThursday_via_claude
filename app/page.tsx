"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runRoom, type Turn } from "@/lib/agent";
import { getBot } from "@/lib/bots";
import { setGitHubToken } from "@/lib/github";
import { estimateCost, formatCost, ZERO_USAGE, type Usage } from "@/lib/models";
import {
  DEFAULT_SETTINGS,
  clearAll,
  loadSettings,
  loadSpend,
  loadTranscript,
  saveSettings,
  saveSpend,
  saveTranscript,
  type Settings,
} from "@/lib/storage";
import { SettingsPanel } from "@/components/Settings";
import { Composer } from "@/components/Composer";
import { BotMessage, HandoffNote, HumanMessage, ToolNote } from "@/components/Message";
import { Welcome } from "@/components/Welcome";
import { VerifyPanel } from "@/components/Verify";

/** What's happening right now, above the committed transcript. */
interface Live {
  botId: string;
  text: string;
  tool: string | null;
}

export default function Galaxy() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [spend, setSpend] = useState(0);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [ready, setReady] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Hydrate from the browser after mount — localStorage doesn't exist during SSR.
  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    setTranscript(loadTranscript());
    setSpend(loadSpend());
    setGitHubToken(s.githubToken || null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) saveSettings(settings);
    setGitHubToken(settings.githubToken || null);
  }, [settings, ready]);

  useEffect(() => {
    if (ready) saveTranscript(transcript);
  }, [transcript, ready]);

  useEffect(() => {
    if (ready) saveSpend(spend);
  }, [spend, ready]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript, live]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setLive(null);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!settings.apiKey.trim()) {
      setShowSettings(true);
      return;
    }

    setError(null);
    setInput("");

    const withHuman: Turn[] = [...transcript, { kind: "human", text }];
    setTranscript(withHuman);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    // The room opens with whoever is listed first, and afterwards whoever last
    // held the floor picks it back up.
    const lastSpeaker = [...withHuman]
      .reverse()
      .find((t): t is Extract<Turn, { kind: "bot" }> => t.kind === "bot");
    const startBotId =
      lastSpeaker && settings.roster.includes(lastSpeaker.botId)
        ? lastSpeaker.botId
        : settings.roster[0];

    // Accumulates locally: React state updates are async, and a handoff can
    // fire several times before a render lands.
    let working = withHuman;
    let turnUsage: Usage = ZERO_USAGE;

    try {
      for await (const event of runRoom({
        apiKey: settings.apiKey.trim(),
        modelId: settings.modelId,
        effort: settings.effort,
        roster: settings.roster,
        transcript: withHuman,
        startBotId,
        maxBotTurns: settings.maxBotTurns,
        signal: controller.signal,
      })) {
        switch (event.type) {
          case "bot_start":
            setLive({ botId: event.botId, text: "", tool: null });
            break;
          case "text":
            setLive((l) =>
              l ? { ...l, text: l.text + event.delta, tool: null } : l,
            );
            break;
          case "tool":
            setLive((l) => (l ? { ...l, tool: event.detail } : l));
            break;
          case "bot_end":
            if (event.text) {
              working = [...working, { kind: "bot", botId: event.botId, text: event.text }];
              setTranscript(working);
            }
            setLive(null);
            break;
          case "handoff":
            working = [
              ...working,
              { kind: "handoff", from: event.from, to: event.to, brief: event.brief },
            ];
            setTranscript(working);
            break;
          case "usage":
            turnUsage = event.usage;
            break;
          case "error":
            setError(event.message);
            break;
          case "done":
            if (event.reason === "turn_limit") {
              setError(
                `Stopped after ${settings.maxBotTurns} handoffs — the room was still going. Raise the limit in Settings if that was too early.`,
              );
            }
            break;
        }
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setSpend((s) => s + estimateCost(turnUsage, settings.modelId));
      setBusy(false);
      setLive(null);
      abortRef.current = null;
    }
  }, [input, busy, settings, transcript]);

  const reset = () => {
    stop();
    clearAll();
    setSettings(DEFAULT_SETTINGS);
    setTranscript([]);
    setSpend(0);
    setError(null);
    setShowSettings(false);
  };

  const roomBots = settings.roster.map(getBot).filter(Boolean);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-(--color-edge) px-4 py-3 sm:px-6">
        <span className="text-sm font-semibold tracking-tight text-[#f2ece5]">Galaxy</span>

        <div className="ml-1 flex -space-x-1.5">
          {roomBots.map((b) => (
            <span
              key={b!.id}
              title={`${b!.name} · ${b!.role}`}
              className="flex size-6 items-center justify-center rounded-full border-2 border-(--color-ink) text-[10px] font-semibold"
              style={{ background: `${b!.accent}28`, color: b!.accent }}
            >
              {b!.name.slice(0, 1)}
            </span>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 text-[11px] text-[#5f574f]">
          <span className="hidden font-mono sm:inline" title="Estimated spend on your key">
            {formatCost(spend)}
          </span>
          {transcript.length > 0 && (
            <button
              onClick={() => {
                stop();
                setTranscript([]);
                setError(null);
              }}
              className="rounded-md border border-(--color-edge) px-2 py-1 transition-colors hover:text-[#f2ece5]"
            >
              New room
            </button>
          )}
          <button
            onClick={() => setShowVerify(true)}
            title="Prove the bots' tools actually execute"
            className="rounded-md border border-(--color-edge) px-2 py-1 transition-colors hover:text-[#f2ece5]"
          >
            Verify
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-md border border-(--color-edge) px-2 py-1 transition-colors hover:text-[#f2ece5]"
          >
            Settings
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {ready && transcript.length === 0 && !live && (
            <Welcome
              hasKey={Boolean(settings.apiKey.trim())}
              onOpenSettings={() => setShowSettings(true)}
              onPick={(prompt) => setInput(prompt)}
            />
          )}

          {transcript.map((turn, i) =>
            turn.kind === "human" ? (
              <HumanMessage key={i} text={turn.text} />
            ) : turn.kind === "bot" ? (
              <BotMessage key={i} botId={turn.botId} text={turn.text} />
            ) : (
              <HandoffNote key={i} from={turn.from} to={turn.to} brief={turn.brief} />
            ),
          )}

          {live && live.text && (
            <BotMessage botId={live.botId} text={live.text} streaming />
          )}
          {live && !live.text && (
            <ToolNote botId={live.botId} detail={live.tool ?? "thinking"} />
          )}
          {live && live.text && live.tool && (
            <ToolNote botId={live.botId} detail={live.tool} />
          )}

          {error && (
            <p className="rounded-lg border border-[#5c2e22] bg-[#1d110c] px-4 py-3 text-sm text-[#e8a488]">
              {error}
            </p>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      <Composer
        value={input}
        onChange={setInput}
        onSend={send}
        onStop={stop}
        busy={busy}
        disabled={!ready}
        placeholder={
          settings.apiKey.trim()
            ? `Message ${roomBots.map((b) => b!.name).join(", ")}…`
            : "Add your API key in Settings to begin…"
        }
      />

      {showVerify && (
        <VerifyPanel
          apiKey={settings.apiKey}
          modelId={settings.modelId}
          effort={settings.effort}
          onClose={() => setShowVerify(false)}
          onSpend={(usd) => setSpend((s) => s + usd)}
        />
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
          onReset={reset}
        />
      )}
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { getBot } from "@/lib/bots";
import { estimateCost, formatCost, ZERO_USAGE, addUsage, type Usage } from "@/lib/models";
import {
  PROBES,
  makeClient,
  runHandoffProbe,
  type ProbeResult,
  type ProbeStatus,
} from "@/lib/verify";

const BLANK: Record<string, ProbeResult> = {};

function StatusDot({ status }: { status: ProbeStatus }) {
  const color =
    status === "pass"
      ? "#34d399"
      : status === "fail"
        ? "#f87171"
        : status === "error"
          ? "#fbbf24"
          : status === "running"
            ? "#e8873c"
            : "#3d3835";
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${status === "running" ? "animate-pulse" : ""}`}
      style={{ background: color }}
    />
  );
}

export function VerifyPanel({
  apiKey,
  modelId,
  effort,
  onClose,
  onSpend,
}: {
  apiKey: string;
  modelId: string;
  effort: "low" | "medium" | "high";
  onClose: () => void;
  onSpend: (usd: number) => void;
}) {
  const [results, setResults] = useState<Record<string, ProbeResult>>(BLANK);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const all = [
    ...PROBES.map((p) => ({ id: p.id, label: p.label, what: p.what, botId: p.botId })),
    {
      id: "handoff",
      label: "Work is really handed between bots",
      what: "Watches the event stream for a genuine control transfer, not a promise to transfer.",
      botId: "founder",
    },
  ];

  async function runAll() {
    if (!apiKey.trim()) return;
    setRunning(true);
    setResults(BLANK);

    const controller = new AbortController();
    abortRef.current = controller;
    const client = makeClient(apiKey.trim());
    let total: Usage = ZERO_USAGE;

    for (const probe of PROBES) {
      if (controller.signal.aborted) break;
      setResults((r) => ({
        ...r,
        [probe.id]: {
          id: probe.id,
          label: probe.label,
          what: probe.what,
          botId: probe.botId,
          status: "running",
          verdict: "",
          answer: "",
          toolsUsed: [],
          usage: ZERO_USAGE,
        },
      }));
      try {
        const partial = await probe.run({ client, modelId, signal: controller.signal });
        total = addUsage(total, partial.usage);
        setResults((r) => ({
          ...r,
          [probe.id]: { id: probe.id, label: probe.label, what: probe.what, botId: probe.botId, ...partial },
        }));
      } catch (err) {
        if (controller.signal.aborted) break;
        setResults((r) => ({
          ...r,
          [probe.id]: {
            id: probe.id,
            label: probe.label,
            what: probe.what,
            botId: probe.botId,
            status: "error",
            verdict: err instanceof Error ? err.message : "Unknown failure.",
            answer: "",
            toolsUsed: [],
            usage: ZERO_USAGE,
          },
        }));
      }
    }

    if (!controller.signal.aborted) {
      setResults((r) => ({
        ...r,
        handoff: {
          id: "handoff",
          label: "Work is really handed between bots",
          what: "Watches the event stream for a genuine control transfer.",
          botId: "founder",
          status: "running",
          verdict: "",
          answer: "",
          toolsUsed: [],
          usage: ZERO_USAGE,
        },
      }));
      const handoff = await runHandoffProbe({
        apiKey: apiKey.trim(),
        modelId,
        effort,
        signal: controller.signal,
      });
      total = addUsage(total, handoff.usage);
      setResults((r) => ({ ...r, handoff }));
    }

    onSpend(estimateCost(total, modelId));
    setRunning(false);
    abortRef.current = null;
  }

  const done = Object.values(results).filter((r) => r.status !== "running");
  const passed = done.filter((r) => r.status === "pass").length;
  const spent = Object.values(results).reduce(
    (acc, r) => acc + estimateCost(r.usage, modelId),
    0,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-(--color-edge) bg-(--color-surface) p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[#f2ece5]">Capability check</h2>
            <p className="mt-1 text-xs leading-relaxed text-(--color-muted)">
              Proves each bot&rsquo;s tools genuinely execute, by asking for answers
              that cannot be guessed and checking them against independently
              established truth.
            </p>
          </div>
          <button
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
            className="shrink-0 rounded-lg px-2 py-1 text-sm text-(--color-muted) transition-colors hover:text-[#f2ece5]"
          >
            Close
          </button>
        </div>

        <p className="mb-5 rounded-lg border border-(--color-edge) bg-(--color-ink) px-3 py-2.5 text-xs leading-relaxed text-[#8a827a]">
          <strong className="text-[#cfc8c0]">What this cannot tell you.</strong> Whether
          a bot&rsquo;s judgment is any good. A persona is a prompt, not a
          credential — there is no test for taste. This checks capability only:
          does the tool run, and is the result real.
        </p>

        <div className="space-y-2">
          {all.map((probe) => {
            const r = results[probe.id];
            const status: ProbeStatus = r?.status ?? "pending";
            const bot = getBot(probe.botId);
            const isOpen = open === probe.id;

            return (
              <div
                key={probe.id}
                className="rounded-lg border border-(--color-edge) bg-(--color-ink)"
              >
                <button
                  onClick={() => setOpen(isOpen ? null : probe.id)}
                  className="flex w-full items-start gap-3 px-3.5 py-3 text-left"
                >
                  <span className="mt-1.5">
                    <StatusDot status={status} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[13px] font-medium text-[#f2ece5]">
                        {probe.label}
                      </span>
                      {bot && (
                        <span className="text-[11px]" style={{ color: bot.accent }}>
                          {bot.name}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-[#5f574f]">
                      {r?.verdict || probe.what}
                    </span>
                  </span>
                  <span className="mt-0.5 shrink-0 text-[10px] tracking-wider text-[#5f574f] uppercase">
                    {status === "pending" ? "" : status}
                  </span>
                </button>

                {isOpen && r && (r.answer || r.expected) && (
                  <div className="space-y-2.5 border-t border-(--color-edge) px-3.5 py-3 text-[11px]">
                    {r.toolsUsed.length > 0 && (
                      <div>
                        <span className="text-[#5f574f]">Tools that actually fired: </span>
                        <span className="font-mono text-[#cfc8c0]">
                          {r.toolsUsed.join(", ")}
                        </span>
                      </div>
                    )}
                    {r.expected && (
                      <div>
                        <span className="text-[#5f574f]">Expected: </span>
                        <span className="font-mono break-all text-[#cfc8c0]">
                          {r.expected}
                        </span>
                      </div>
                    )}
                    {r.answer && (
                      <div>
                        <span className="block text-[#5f574f]">It answered:</span>
                        <pre className="mt-1 max-h-48 overflow-auto rounded border border-(--color-edge) bg-(--color-surface) p-2 font-mono text-[11px] whitespace-pre-wrap text-[#cfc8c0]">
                          {r.answer}
                        </pre>
                      </div>
                    )}
                    {r.checkYourself && (
                      <div>
                        <span className="text-[#5f574f]">Check it yourself: </span>
                        <span className="font-mono break-all text-[#8a827a]">
                          {r.checkYourself}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={running ? () => abortRef.current?.abort() : runAll}
            disabled={!apiKey.trim()}
            className="rounded-lg bg-(--color-ember) px-4 py-2.5 text-sm font-medium text-[#1a0d03] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {running ? "Stop" : done.length ? "Run again" : "Run the checks"}
          </button>
          <span className="text-xs text-[#5f574f]">
            {!apiKey.trim()
              ? "Add your API key first."
              : done.length
                ? `${passed} of ${done.length} passed · ${formatCost(spent)} of your credit`
                : "Five live calls on your key. Costs a few cents."}
          </span>
        </div>
      </div>
    </div>
  );
}

"use client";

import Markdown from "react-markdown";
import { getBot } from "@/lib/bots";

function Avatar({ name, accent }: { name: string; accent: string }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      style={{ background: `${accent}22`, color: accent }}
    >
      {name.slice(0, 1)}
    </span>
  );
}

export function HumanMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#26221f] px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-[#f2ece5]">
        {text}
      </div>
    </div>
  );
}

export function BotMessage({
  botId,
  text,
  streaming,
}: {
  botId: string;
  text: string;
  streaming?: boolean;
}) {
  const bot = getBot(botId);
  if (!bot) return null;

  return (
    <div className="flex gap-3">
      <Avatar name={bot.name} accent={bot.accent} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-[13px] font-semibold" style={{ color: bot.accent }}>
            {bot.name}
          </span>
          <span className="text-[11px] text-[#5f574f]">{bot.role}</span>
        </div>
        <div className={`chat ${streaming ? "chat-streaming" : ""}`}>
          <Markdown>{text}</Markdown>
        </div>
      </div>
    </div>
  );
}

/** A bot passing work to another — rendered as a rail, not a message. */
export function HandoffNote({
  from,
  to,
  brief,
}: {
  from: string;
  to: string;
  brief: string;
}) {
  const a = getBot(from);
  const b = getBot(to);
  if (!a || !b) return null;

  return (
    <div className="flex gap-3 pl-10">
      <div className="min-w-0 flex-1 border-l-2 pl-3" style={{ borderColor: `${b.accent}55` }}>
        <div className="mb-0.5 text-[11px] tracking-wide text-[#5f574f]">
          <span style={{ color: a.accent }}>{a.name}</span>
          <span className="mx-1.5">→</span>
          <span style={{ color: b.accent }}>{b.name}</span>
        </div>
        <p className="text-[13px] leading-relaxed text-(--color-muted)">{brief}</p>
      </div>
    </div>
  );
}

export function ToolNote({ botId, detail }: { botId: string; detail: string }) {
  const bot = getBot(botId);
  return (
    <div className="flex items-center gap-2 pl-10 text-[12px] text-[#5f574f]">
      <span
        className="size-1.5 animate-pulse rounded-full"
        style={{ background: bot?.accent ?? "#8a827a" }}
      />
      {detail}…
    </div>
  );
}

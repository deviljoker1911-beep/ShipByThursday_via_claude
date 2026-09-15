"use client";

import { useEffect, useRef } from "react";

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the content instead of scrolling inside a fixed box.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  return (
    <div className="border-t border-(--color-edge) bg-(--color-ink)/95 px-4 py-3 backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          className="max-h-50 min-w-0 flex-1 resize-none rounded-xl border border-(--color-edge) bg-(--color-surface) px-4 py-3 text-[15px] leading-relaxed text-[#f2ece5] outline-none transition-colors placeholder:text-[#5f574f] focus:border-(--color-ember) disabled:opacity-50"
        />
        {busy ? (
          <button
            onClick={onStop}
            className="shrink-0 rounded-xl border border-(--color-edge) px-4 py-3 text-sm text-(--color-muted) transition-colors hover:border-(--color-ember) hover:text-(--color-ember)"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={disabled || !value.trim()}
            className="shrink-0 rounded-xl bg-(--color-ember) px-5 py-3 text-sm font-medium text-[#1a0d03] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}

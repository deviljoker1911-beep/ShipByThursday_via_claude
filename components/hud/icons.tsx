import type { ReactNode } from "react";

/**
 * Inline SVG glyphs. No emoji — they render differently on every platform,
 * and a resource bar where "wood" changes shape between phones is noise.
 */

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      {children}
    </svg>
  );
}

export const ResourceIcon = {
  food: ({ size }: { size?: number }) => (
    <Svg size={size}>
      <circle cx="6" cy="9" r="3" fill="#d0553d" />
      <circle cx="10" cy="10" r="2.6" fill="#b8432f" />
      <circle cx="8.5" cy="6" r="2.4" fill="#e0664c" />
      <path d="M8 3.5 L9.5 1.5" stroke="#5f8a3a" strokeWidth="1.3" strokeLinecap="round" />
    </Svg>
  ),
  wood: ({ size }: { size?: number }) => (
    <Svg size={size}>
      <rect x="1.5" y="5" width="13" height="6" rx="3" fill="#8a5a2b" />
      <ellipse cx="13" cy="8" rx="2" ry="3" fill="#c9965a" />
      <ellipse cx="13" cy="8" rx="0.9" ry="1.4" fill="#8a5a2b" />
    </Svg>
  ),
  gold: ({ size }: { size?: number }) => (
    <Svg size={size}>
      <path d="M2 11 L5 5 L10 4 L14 8 L12 12 L5 13 Z" fill="#e8c46a" />
      <path d="M5 5 L10 4 L9 8 Z" fill="#fbe29a" />
    </Svg>
  ),
  stone: ({ size }: { size?: number }) => (
    <Svg size={size}>
      <path d="M2 12 L3.5 6 L8 3.5 L13 5.5 L14 11 L9 13.5 Z" fill="#a9a7a0" />
      <path d="M3.5 6 L8 3.5 L8.5 8 Z" fill="#c8c6bf" />
    </Svg>
  ),
  pop: ({ size }: { size?: number }) => (
    <Svg size={size}>
      <circle cx="8" cy="4.5" r="2.5" fill="#e6dccf" />
      <path d="M3.5 14 C3.5 9 12.5 9 12.5 14 Z" fill="#e6dccf" />
    </Svg>
  ),
};

const OWNER_COLOURS = [
  { body: "#e8873c", trim: "#ffcb8e" },
  { body: "#5b7fd4", trim: "#a9c0f5" },
];

/** A small drawing of a unit or building, in its owner's colours. */
export function Portrait({ kind, owner, size = 40 }: { kind: string; owner: number; size?: number }) {
  const c = OWNER_COLOURS[owner] ?? OWNER_COLOURS[0];
  const unit = (extra: ReactNode, mounted = false) => (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <ellipse cx="20" cy="34" rx="11" ry="3" fill="rgba(0,0,0,0.35)" />
      {mounted && (
        <g>
          <ellipse cx="19" cy="27" rx="12" ry="5.5" fill="#6b4a2e" />
          <rect x="27" y="17" width="4" height="9" fill="#6b4a2e" />
          <rect x="10" y="30" width="2" height="5" fill="#6b4a2e" />
          <rect x="26" y="30" width="2" height="5" fill="#6b4a2e" />
        </g>
      )}
      <g transform={mounted ? "translate(0,-8)" : undefined}>
        <path d="M20 10 L27 32 L13 32 Z" fill={c.body} />
        <circle cx="20" cy="8" r="4.5" fill={c.trim} />
        {extra}
      </g>
    </svg>
  );
  switch (kind) {
    case "villager":
      return unit(<rect x="25" y="20" width="7" height="4" rx="1" fill="#8a5a2b" />);
    case "spearman":
      return unit(<path d="M29 4 L29 36" stroke="#d8cbb4" strokeWidth="2" />);
    case "archer":
      return unit(<path d="M27 12 A8 9 0 0 1 27 30" fill="none" stroke="#c9a76a" strokeWidth="2" />);
    case "rider":
      return unit(<path d="M16 22 L36 8" stroke="#d8cbb4" strokeWidth="2" />, true);
    case "scout":
      return unit(
        <g>
          <rect x="19" y="-4" width="1.6" height="10" fill={c.trim} />
          <rect x="20.5" y="-4" width="6" height="4" fill={c.trim} />
        </g>,
        true,
      );
    default: {
      const tall = kind === "tower" ? 24 : kind === "house" ? 10 : kind === "farm" ? 2 : 15;
      return (
        <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
          <path d={`M20 ${22 - tall} L36 ${28 - tall} L20 ${34 - tall} L4 ${28 - tall} Z`} fill={c.body} />
          <path d={`M4 ${28 - tall} L20 ${34 - tall} L20 34 L4 28 Z`} fill={c.body} opacity="0.55" />
          <path d={`M36 ${28 - tall} L20 ${34 - tall} L20 34 L36 28 Z`} fill={c.body} opacity="0.75" />
          {kind === "farm" && <path d="M8 27 L20 33 M13 24 L27 31 M20 22 L32 28" stroke="#9c8143" strokeWidth="1.5" />}
        </svg>
      );
    }
  }
}

export function Cost({ cost }: { cost?: Partial<Record<string, number>> }) {
  if (!cost) return null;
  const order = ["food", "wood", "gold", "stone"] as const;
  return (
    <span className="flex items-center gap-1.5">
      {order
        .filter((r) => cost[r])
        .map((r) => {
          const Icon = ResourceIcon[r];
          return (
            <span key={r} className="flex items-center gap-0.5 font-mono tabular-nums">
              <Icon size={11} />
              {cost[r]}
            </span>
          );
        })}
    </span>
  );
}

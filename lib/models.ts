/**
 * Model catalogue.
 *
 * Prices are USD per million tokens and drive the running cost estimate. This
 * is a bring-your-own-key product — the user is spending their own money on
 * every turn, so showing the number is not optional.
 */

export interface ModelSpec {
  id: string;
  label: string;
  blurb: string;
  inPrice: number;
  outPrice: number;
  /** Older models need `budget_tokens`; these take `thinking: {type:"adaptive"}`. */
  adaptiveThinking: boolean;
  /** `output_config.effort` is rejected on some models. */
  effort: boolean;
  /**
   * The 2026 web tools carry built-in dynamic filtering. Models without them
   * fall back to the basic variants.
   */
  modernWebTools: boolean;
}

export const MODELS: ModelSpec[] = [
  {
    id: "claude-opus-5",
    label: "Opus 5",
    blurb: "Best judgment. The one to use when the room is deciding something.",
    inPrice: 5,
    outPrice: 25,
    adaptiveThinking: true,
    effort: true,
    modernWebTools: true,
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    blurb: "Most of the quality at 40% of the price. A good default for long rooms.",
    inPrice: 2,
    outPrice: 10,
    adaptiveThinking: true,
    effort: true,
    modernWebTools: true,
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    blurb: "Cheapest and fastest. Fine for chatty rooms, weaker at hard calls.",
    inPrice: 1,
    outPrice: 5,
    adaptiveThinking: false,
    effort: false,
    modernWebTools: false,
  },
];

export const DEFAULT_MODEL = "claude-opus-5";

export function getModel(id: string): ModelSpec {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

/** Cached reads bill at roughly a tenth of the input rate. */
export function estimateCost(usage: Usage, modelId: string): number {
  const m = getModel(modelId);
  return (
    (usage.inputTokens * m.inPrice) / 1_000_000 +
    (usage.cacheReadTokens * m.inPrice * 0.1) / 1_000_000 +
    (usage.outputTokens * m.outPrice) / 1_000_000
  );
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(2)}`;
}

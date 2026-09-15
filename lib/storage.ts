import type { Turn } from "./agent";
import { DEFAULT_MODEL } from "./models";
import { DEFAULT_ROOM } from "./bots";

/**
 * Everything lives in the user's own browser. There is no server in this
 * product — no account, no database, nothing to breach. The API key in
 * particular is never transmitted anywhere except api.anthropic.com.
 *
 * Every access is guarded: localStorage throws in private windows and when
 * site data is blocked, and a storage failure must never take down the app.
 */

const KEY_PREFIX = "galaxy.";

export interface Settings {
  apiKey: string;
  githubToken: string;
  modelId: string;
  effort: "low" | "medium" | "high";
  roster: string[];
  maxBotTurns: number;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  githubToken: "",
  modelId: DEFAULT_MODEL,
  effort: "medium",
  roster: DEFAULT_ROOM,
  maxBotTurns: 6,
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage blocked. The session still works in memory.
  }
}

export function loadSettings(): Settings {
  const stored = read<Partial<Settings>>("settings", {});
  // Merge rather than replace, so a settings shape added later doesn't wipe
  // what a returning user already had.
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  if (!Array.isArray(merged.roster) || merged.roster.length === 0) {
    merged.roster = DEFAULT_ROOM;
  }
  return merged;
}

export function saveSettings(settings: Settings): void {
  write("settings", settings);
}

export function loadTranscript(): Turn[] {
  const turns = read<Turn[]>("transcript", []);
  return Array.isArray(turns) ? turns : [];
}

export function saveTranscript(transcript: Turn[]): void {
  write("transcript", transcript);
}

export function loadSpend(): number {
  const value = read<number>("spend", 0);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function saveSpend(usd: number): void {
  write("spend", usd);
}

export function clearAll(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of ["settings", "transcript", "spend"]) {
      window.localStorage.removeItem(KEY_PREFIX + key);
    }
  } catch {
    // Nothing we can do; the caller resets in-memory state regardless.
  }
}

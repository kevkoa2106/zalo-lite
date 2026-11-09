// App settings kept in <data folder>/settings.json (not in the message database: that one opens only after login,
// and "remember my login" has to be known before it).
import { readFileSync, writeFileSync } from "node:fs";

export type Settings = {
  remember: boolean; // keep the login on disk so the next start signs in by itself
  cachePerChat: number; // newest messages kept per conversation
};

export const CACHE_CHOICES = [1000, 3000, 5000];
export const DEFAULTS: Settings = { remember: true, cachePerChat: 3000 };

/** Keep only known keys with valid values; anything else keeps the value in `base`. */
export function sanitize(raw: unknown, base: Settings = DEFAULTS): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    remember: typeof r.remember === "boolean" ? r.remember : base.remember,
    cachePerChat: CACHE_CHOICES.includes(Number(r.cachePerChat)) ? Number(r.cachePerChat) : base.cachePerChat,
  };
}

export function loadSettings(file: string): Settings {
  try {
    return sanitize(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(file: string, s: Settings) {
  writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
}

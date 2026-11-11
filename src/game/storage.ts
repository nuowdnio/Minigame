import { DEFAULT_SETTINGS, type Settings } from '../config/defaults';

const SETTINGS_KEY = 'fpv-racer.settings.v1';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Gespeicherte Werte über die Standardwerte legen (fehlende Felder bleiben Standard). */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isObject(base) || !isObject(override)) {
    return (override === undefined || typeof override !== typeof base ? base : override) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(base as Record<string, unknown>)) {
    out[key] = deepMerge((base as Record<string, unknown>)[key], override[key]);
  }
  return out as T;
}

/** Wurden schon einmal Einstellungen gespeichert? */
export function hasSavedSettings(): boolean {
  try {
    return localStorage.getItem(SETTINGS_KEY) !== null;
  } catch {
    return false;
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    const merged = deepMerge(structuredClone(DEFAULT_SETTINGS), parsed);
    // Freie Schlüssel (Rates je Modell) übernehmen, deepMerge kennt nur die Standard-Schlüssel
    if (parsed && typeof parsed.rateProfiles === 'object' && parsed.rateProfiles) {
      merged.rateProfiles = parsed.rateProfiles;
    }
    return merged;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

/**
 * Response defaults for the LAN API server, editable from its screen.
 *
 * They exist because a client that sends only `messages` would otherwise inherit
 * whatever we hardcoded: that is how API answers ended mid-sentence (−1024
 * tokens) while the same prompt in the app finished — the app's own default is
 * −1, i.e. until EOS.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ApiServerDefaults {
  /** −1 = until EOS, matching the app's own default. */
  maxTokens: number;
  temperature: number;
}

const KEYS = {
  maxTokens: 'apiServer.maxTokens',
  temperature: 'apiServer.temperature',
} as const;

export const DEFAULT_API_SERVER_DEFAULTS: ApiServerDefaults = {
  maxTokens: -1,
  temperature: 0.7,
};

let cached: ApiServerDefaults = {...DEFAULT_API_SERVER_DEFAULTS};

export function getDefaults(): ApiServerDefaults {
  return {...cached};
}

function parseNumber(value: string | null, fallback: number): number {
  if (value == null || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Called once at start-up; until it resolves the built-in defaults apply. */
export async function loadDefaults(): Promise<ApiServerDefaults> {
  try {
    const [maxTokens, temperature] = await Promise.all([
      AsyncStorage.getItem(KEYS.maxTokens),
      AsyncStorage.getItem(KEYS.temperature),
    ]);
    cached = {
      maxTokens: Math.trunc(
        parseNumber(maxTokens, DEFAULT_API_SERVER_DEFAULTS.maxTokens),
      ),
      temperature: parseNumber(
        temperature,
        DEFAULT_API_SERVER_DEFAULTS.temperature,
      ),
    };
  } catch {
    // Keep the in-memory defaults; the screen shows them either way.
  }
  return getDefaults();
}

export async function setDefaults(
  patch: Partial<ApiServerDefaults>,
): Promise<ApiServerDefaults> {
  cached = {
    maxTokens:
      patch.maxTokens !== undefined
        ? Math.trunc(patch.maxTokens)
        : cached.maxTokens,
    temperature:
      patch.temperature !== undefined ? patch.temperature : cached.temperature,
  };
  try {
    await Promise.all([
      AsyncStorage.setItem(KEYS.maxTokens, String(cached.maxTokens)),
      AsyncStorage.setItem(KEYS.temperature, String(cached.temperature)),
    ]);
  } catch {
    // Persisting is best-effort; the value still applies to this session.
  }
  return getDefaults();
}

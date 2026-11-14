// Per-device UI preferences in localStorage. Storage can be unavailable
// (private mode, blocked site data), so every access is wrapped and the app
// works with the defaults.

const PREFIX = "daily:";

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Ignore: the preference just won't be remembered on this device.
  }
}

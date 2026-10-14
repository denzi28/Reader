// A very light vibration where a tap should feel like something: the bar of places, the plus, switches, a page turning.
// Phones that can vibrate from a web page (Android) do; an iPhone's Safari cannot, so there nothing happens.
const KEY = 'reader.haptics';

export const hapticsSupported = typeof navigator !== 'undefined'
  && typeof navigator.vibrate === 'function'
  && !/iPad|iPhone|iPod/.test(navigator.userAgent)
  && typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

let on: boolean | null = null;

export function hapticsOn(): boolean {
  if (!hapticsSupported) return false;
  if (on === null) {
    try { on = localStorage.getItem(KEY) !== '0'; } catch { on = true; }
  }
  return on;
}

export function setHaptics(value: boolean) {
  on = value;
  try { localStorage.setItem(KEY, value ? '1' : '0'); } catch { /* ignore */ }
  if (value) feel('light');
}

const PATTERNS = { light: 7, page: 5, medium: 12, done: [8, 50, 12] } as const;

/** A short buzz; `light` for a tap, `page` for turning a page, `medium` for switches, `done` for something finished. */
export function feel(kind: keyof typeof PATTERNS = 'light') {
  if (!hapticsOn()) return;
  try { navigator.vibrate(PATTERNS[kind] as number | number[]); } catch { /* ignore */ }
}

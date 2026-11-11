// Fast mode, for old tablets and phones: no animation, no blur behind the bars, lighter shadows, and pages drawn
// with fewer pixels. It is on by itself where the device says it has little memory or few cores, and anyone can
// switch it in the menu.
import { useSyncExternalStore } from 'react';

const KEY = 'reader.fast';

/** A device that will struggle: 2 GB of memory or less, or one or two processor cores. */
function weakDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const n = navigator as Navigator & { deviceMemory?: number };
  return (n.deviceMemory ?? 8) <= 2 || (n.hardwareConcurrency ?? 8) <= 2;
}

let on: boolean | null = null;
const listeners = new Set<() => void>();

export function fastOn(): boolean {
  if (on === null) {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
    on = saved === '1' ? true : saved === '0' ? false : weakDevice();
  }
  return on;
}

/** Puts the choice on the page, where the stylesheet reads it. Called once as the app starts. */
export function applyFast() {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute('data-fast', fastOn());
}

export function setFast(value: boolean) {
  on = value;
  try { localStorage.setItem(KEY, value ? '1' : '0'); } catch { /* ignore */ }
  applyFast();
  listeners.forEach((fn) => fn());
}

export function useFast(): boolean {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, fastOn, () => false);
}

/** True when things should not move: fast mode, or the device asks for less motion. */
export const calm = () => fastOn() || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** How many canvas pixels to draw per screen pixel: the screen's own density up to `cap`, and at most 1.5 in fast mode. */
export const pixelRatio = (cap: number) => Math.min(window.devicePixelRatio || 1, fastOn() ? Math.min(cap, 1.5) : cap);

// How the book reader looks: kept on this device, the same for every book.
import { useCallback, useEffect, useState } from 'react';

export type BookTheme = 'auto' | 'paper' | 'sepia' | 'mist' | 'night';
export type BookFont = 'serif' | 'sans' | 'classic' | 'mono';
export type Spacing = 'tight' | 'normal' | 'roomy';
export type Margins = 'narrow' | 'medium' | 'wide';
export type Flow = 'pages' | 'scroll';
export type Spread = 'one' | 'two';

export interface BookSettings {
  theme: BookTheme;
  font: BookFont;
  /** Letter size in pixels. */
  size: number;
  spacing: Spacing;
  margins: Margins;
  flow: Flow;
  /** On a wide screen: one page, or two side by side. */
  spread: Spread;
}

export const DEFAULTS: BookSettings = { theme: 'auto', font: 'serif', size: 18, spacing: 'normal', margins: 'medium', flow: 'pages', spread: 'two' };
export const SIZE_RANGE: [number, number] = [14, 32];

const KEY = 'reader.book';

function read(): BookSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<BookSettings>;
    const out = { ...DEFAULTS, ...raw };
    out.size = Math.min(SIZE_RANGE[1], Math.max(SIZE_RANGE[0], Number(out.size) || DEFAULTS.size));
    return out;
  } catch {
    return DEFAULTS;
  }
}

const listeners = new Set<(s: BookSettings) => void>();
let current: BookSettings | null = null;

export function useBookSettings(): [BookSettings, (change: Partial<BookSettings>) => void] {
  const [settings, setSettings] = useState<BookSettings>(() => (current ??= read()));
  useEffect(() => {
    listeners.add(setSettings);
    return () => void listeners.delete(setSettings);
  }, []);
  const change = useCallback((patch: Partial<BookSettings>) => {
    const next = { ...(current ?? read()), ...patch };
    current = next;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    listeners.forEach((fn) => fn(next));
  }, []);
  return [settings, change];
}

export const FONT_STACKS: Record<BookFont, string> = {
  serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  classic: "Baskerville, 'Baskerville Old Face', 'Hoefler Text', Garamond, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
};
export const LINE_HEIGHT: Record<Spacing, number> = { tight: 1.42, normal: 1.62, roomy: 1.86 };
/** Fraction of the width kept free at each side (single column). */
export const MARGIN: Record<Margins, number> = { narrow: 0.045, medium: 0.075, wide: 0.12 };

export const HIGHLIGHTS = {
  yellow: 'rgba(255, 210, 70, 0.55)',
  green: 'rgba(120, 200, 150, 0.5)',
  pink: 'rgba(240, 150, 160, 0.5)',
  blue: 'rgba(120, 170, 235, 0.5)',
} as const;
export type HighlightColor = keyof typeof HIGHLIGHTS;
export const HIGHLIGHT_NAMES = Object.keys(HIGHLIGHTS) as HighlightColor[];

// What the reader chose in the pen, highlighter, eraser and note menus, kept between visits.
import { BRUSH_SIZES, HIGHLIGHT_COLORS, PEN_COLORS, TEXT_SIZES } from './ink';

export interface ToolPrefs {
  penColor: string;
  hlColor: string;
  /** Brush widths as fractions of the page width. */
  penSize: number;
  hlSize: number;
  textSize: number;
  eraserMode: 'stroke' | 'area';
  /** The eraser's reach, as a fraction of the page width. */
  eraserSize: number;
  /** Rub out only highlighter. */
  eraserOnlyHl: boolean;
}

export const DEFAULT_PREFS: ToolPrefs = {
  penColor: PEN_COLORS[0],
  hlColor: HIGHLIGHT_COLORS[0],
  penSize: BRUSH_SIZES.pen[1],
  hlSize: BRUSH_SIZES.highlighter[1],
  textSize: TEXT_SIZES[1],
  eraserMode: 'stroke',
  eraserSize: 0.012,
  eraserOnlyHl: false,
};

const KEY = 'reader.tools.prefs';

const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export function loadPrefs(): ToolPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ToolPrefs> | null;
    if (!raw) return DEFAULT_PREFS;
    const d = DEFAULT_PREFS;
    return {
      penColor: typeof raw.penColor === 'string' ? raw.penColor : d.penColor,
      hlColor: typeof raw.hlColor === 'string' ? raw.hlColor : d.hlColor,
      penSize: num(raw.penSize, d.penSize, 0.0005, 0.03),
      hlSize: num(raw.hlSize, d.hlSize, 0.004, 0.08),
      textSize: num(raw.textSize, d.textSize, 0.008, 0.1),
      eraserMode: raw.eraserMode === 'area' ? 'area' : 'stroke',
      eraserSize: num(raw.eraserSize, d.eraserSize, 0.004, 0.06),
      eraserOnlyHl: raw.eraserOnlyHl === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: ToolPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

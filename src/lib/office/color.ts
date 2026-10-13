export type RGB = [number, number, number];

export const BLACK: RGB = [0, 0, 0];
export const WHITE: RGB = [1, 1, 1];

export function hex(value: string | null | undefined): RGB | undefined {
  if (!value) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function toHsl([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): RGB {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/** Lighter / darker, the way Office's lumMod, lumOff, tint and shade ask for it (fractions). */
export function adjust(c: RGB, mods: { lumMod?: number; lumOff?: number; tint?: number; shade?: number }): RGB {
  let out = c;
  if (mods.lumMod !== undefined || mods.lumOff !== undefined) {
    const [h, s, l] = toHsl(c);
    out = fromHsl([h, s, Math.min(1, Math.max(0, l * (mods.lumMod ?? 1) + (mods.lumOff ?? 0)))]);
  }
  if (mods.tint !== undefined) out = out.map((v) => 1 - (1 - v) * mods.tint!) as RGB;
  if (mods.shade !== undefined) out = out.map((v) => v * mods.shade!) as RGB;
  return out;
}

/** Word's named highlight colours. */
export const HIGHLIGHTS: Record<string, RGB> = {
  yellow: [1, 1, 0], green: [0, 1, 0], cyan: [0, 1, 1], magenta: [1, 0, 1], blue: [0, 0, 1], red: [1, 0, 0],
  darkBlue: [0, 0, 0.55], darkCyan: [0, 0.55, 0.55], darkGreen: [0, 0.4, 0], darkMagenta: [0.55, 0, 0.55],
  darkRed: [0.55, 0, 0], darkYellow: [0.5, 0.5, 0], darkGray: [0.5, 0.5, 0.5], lightGray: [0.83, 0.83, 0.83], black: [0, 0, 0],
};

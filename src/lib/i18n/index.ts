import { trLibrary } from './tr-library';
import { trViewer } from './tr-viewer';
import { trBook } from './tr-book';

export type Lang = 'en' | 'tr';
const KEY = 'reader.lang';

const detect = (): Lang => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'tr') return saved;
  } catch { /* ignore */ }
  const nav = typeof navigator !== 'undefined' ? navigator.languages?.[0] ?? navigator.language ?? '' : '';
  return nav.toLowerCase().startsWith('tr') ? 'tr' : 'en';
};

/** The language this page load runs in: changing it reloads the page, so nothing has to re-render. */
export const lang: Lang = detect();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

const tr: Record<string, string> = { ...trLibrary, ...trViewer, ...trBook };
/** English strings met while running in Turkish that have no translation (for the tests). */
export const missing = new Set<string>();
if (typeof window !== 'undefined') (window as unknown as { __i18nMissing: Set<string> }).__i18nMissing = missing;

/**
 * The text for the interface. The English text is the key; `{name}` marks a value to put in.
 * With no translation the English shows, so a missing line is never a blank.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  let out = text;
  if (lang === 'tr') {
    const hit = tr[text];
    if (hit === undefined) missing.add(text);
    else out = hit;
  }
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** "3 pages": Turkish does not change the noun after a number, English does. */
export function count(n: number, one: string, many: string): string {
  return `${n} ${t(n === 1 ? one : many)}`;
}

export function setLang(next: Lang) {
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  location.reload();
}

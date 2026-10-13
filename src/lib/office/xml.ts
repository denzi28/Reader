// Reading the XML inside Office files: small helpers that ignore namespace prefixes.
export type El = Element;

export function parseXml(text: string): El {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ''), 'application/xml');
  const root = doc.documentElement;
  if (!root || root.localName === 'parsererror' || doc.getElementsByTagName('parsererror').length) {
    throw new Error('A part of this file could not be read.');
  }
  return root;
}

/** The element children, optionally only those with this local name. */
export function kids(el: El | null | undefined, name?: string): El[] {
  if (!el) return [];
  const out: El[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (!name || c.localName === name) out.push(c);
  return out;
}

export const kid = (el: El | null | undefined, name: string): El | null => {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
  return null;
};

/** Follows a path of child names (`path(el, 'pPr', 'jc')`). */
export function path(el: El | null | undefined, ...names: string[]): El | null {
  let cur: El | null | undefined = el;
  for (const n of names) {
    cur = kid(cur, n);
    if (!cur) return null;
  }
  return cur ?? null;
}

/** An attribute by its local name, whatever its prefix. */
export function at(el: El | null | undefined, name: string): string | null {
  if (!el) return null;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.localName === name) return a.value;
  }
  return null;
}

export const num = (el: El | null | undefined, name: string): number | null => {
  const v = at(el, name);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** `<w:b/>` and `<w:b w:val="0"/>`: on unless switched off. */
export function flag(el: El | null | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = at(el, 'val');
  if (v === null) return true;
  return !['0', 'false', 'off', 'none'].includes(v.toLowerCase());
}

/** The `r:id` of an element (a relationship), not a plain `id` beside it. */
export function relId(el: El | null | undefined): string | null {
  if (!el) return null;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.localName === 'id' && a.namespaceURI?.endsWith('/relationships')) return a.value;
  }
  return null;
}

// Matching for the library search: ignores case and accents, and treats the
// Turkish dotted and dotless i alike, so "ders notlari" finds "Ders notları"
// and "is" finds "İş".

/** One character, folded: lower case, no accents, ı and İ as i. */
function foldChar(c: string) {
  if (c === 'ı' || c === 'İ' || c === 'I') return 'i';
  return c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Folds `text` and remembers which original character each folded one came from. */
function foldWithMap(text: string) {
  let folded = '';
  const from: number[] = [];
  let i = 0;
  for (const c of text) {
    const f = foldChar(c);
    folded += f;
    for (let k = 0; k < f.length; k++) from.push(i);
    i += c.length;
  }
  from.push(i);
  return { folded, from };
}

/** The words of a query, folded; empty when there is nothing to search for. */
export function searchTerms(query: string): string[] {
  return foldWithMap(query).folded.split(/\s+/).filter(Boolean);
}

/**
 * Where each term appears in `text` (as [start, end) offsets into `text`), or
 * null unless every term appears.
 */
export function matchRanges(text: string, terms: string[]): [number, number][] | null {
  if (!terms.length) return null;
  const { folded, from } = foldWithMap(text);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    const at = folded.indexOf(term);
    if (at < 0) return null;
    ranges.push([from[at], from[at + term.length - 1] + 1]);
  }
  // Sorted and merged, ready to mark up.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

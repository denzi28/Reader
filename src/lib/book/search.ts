import { blockText, type BookIndex } from './model';

export interface Hit {
  b: number;
  o: number;
  before: string;
  match: string;
  after: string;
}

/** Every place a word or phrase appears in the book (ignoring case), up to a limit. */
export function searchBook(ix: BookIndex, term: string, limit = 300): Hit[] {
  const needle = term.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits: Hit[] = [];
  for (let b = 0; b < ix.blocks.length && hits.length < limit; b++) {
    const text = blockText(ix.blocks[b]);
    if (!text) continue;
    const lower = text.toLowerCase();
    for (let i = lower.indexOf(needle); i >= 0 && hits.length < limit; i = lower.indexOf(needle, i + needle.length)) {
      hits.push({
        b,
        o: i,
        before: text.slice(Math.max(0, i - 36), i),
        match: text.slice(i, i + needle.length),
        after: text.slice(i + needle.length, i + needle.length + 60),
      });
    }
  }
  return hits;
}

// The fonts put into converted PDFs. Standard PDF fonts cannot show ğ, ş, ı, İ and the like,
// so real font files are embedded: small, renamed copies of Carlito, Liberation Serif and Liberation
// Mono (free, metric-compatible with Calibri, Times New Roman and Courier New; see public/fonts and
// scripts/make-office-fonts.py). They are fetched from the app when first needed.
import type { PDFDocument, PDFFont } from 'pdf-lib';

export type Family = 'sans' | 'serif' | 'mono';

const FILES: Record<Family, { base: string; names: [string, string, string, string] }> = {
  sans: { base: 'ReaderSans', names: ['ReaderSans-Regular', 'ReaderSans-Bold', 'ReaderSans-Italic', 'ReaderSans-BoldItalic'] },
  serif: { base: 'ReaderSerif', names: ['ReaderSerif-Regular', 'ReaderSerif-Bold', 'ReaderSerif-Italic', 'ReaderSerif-BoldItalic'] },
  mono: { base: 'ReaderMono', names: ['ReaderMono-Regular', 'ReaderMono-Bold', 'ReaderMono-Italic', 'ReaderMono-BoldItalic'] },
};

/** Which family a font name from the document should be set in. */
export function familyOf(name: string | null | undefined): Family | undefined {
  if (!name) return undefined;
  if (/courier|consolas|mono|menlo|lucida console|source code|fixed/i.test(name)) return 'mono';
  if (/times|georgia|cambria|garamond|palatino|book antiqua|bookman|century|serif(?!.*sans)|minion|baskerville|didot|caladea|tinos/i.test(name) && !/sans/i.test(name)) return 'serif';
  return 'sans';
}

export interface Face {
  font: PDFFont;
  has: Set<number>;
}

/** Characters that look alike enough to stand in for ones a font lacks. */
const SUBSTITUTE: Record<number, string> = {
  0xa0: ' ', 0x2002: ' ', 0x2003: ' ', 0x2009: ' ', 0x202f: ' ', 0x2011: '-', 0x2010: '-', 0x2212: '-',
  0xad: '', 0x200b: '', 0x200c: '', 0x200d: '', 0xfeff: '', 0x2060: '', 0x200e: '', 0x200f: '',
  0xf0b7: '•', 0xf0a7: '▪', 0xf0d8: '›', 0xf0fc: '✓',
};

export class FontBook {
  private faces = new Map<string, Face>();

  constructor(private doc: PDFDocument) {}

  private key = (f: Family, bold: boolean, italic: boolean) => `${f}:${bold ? 'b' : ''}${italic ? 'i' : ''}`;

  /** Brings in every style of the families a document uses (once). */
  async load(families: Iterable<Family>) {
    const { default: fontkit } = await import('@pdf-lib/fontkit');
    this.doc.registerFontkit(fontkit);
    const wanted = new Set<Family>(['sans', ...families]);
    const jobs: Promise<void>[] = [];
    for (const family of wanted) {
      const { base, names } = FILES[family];
      names.forEach((file, i) => {
        const k = this.key(family, i === 1 || i === 3, i === 2 || i === 3);
        if (this.faces.has(k)) return;
        jobs.push((async () => {
          const res = await fetch(`/fonts/${file}.ttf`);
          if (!res.ok) throw new Error('A font needed to convert this file could not be loaded. Check your connection and try again.');
          const bytes = new Uint8Array(await res.arrayBuffer());
          // A fixed name keeps the same file converting to the same PDF every time.
          const font = await this.doc.embedFont(bytes, { subset: true, customName: `AAAA${family === 'sans' ? 'S' : family === 'serif' ? 'R' : 'M'}${'ABCD'[i]}+${base}-${['Regular', 'Bold', 'Italic', 'BoldItalic'][i]}` });
          this.faces.set(k, { font, has: new Set(font.getCharacterSet()) });
        })());
      });
    }
    await Promise.all(jobs);
  }

  get(family: Family, bold = false, italic = false): Face {
    return this.faces.get(this.key(family, bold, italic)) ?? this.faces.get(this.key('sans', bold, italic))!;
  }

  /** The text with anything the font cannot show swapped for something it can. */
  clean(text: string, face: Face): string {
    let out = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp === 9 || cp === 10) { out += ch; continue; }
      if (cp < 32) continue;
      if (face.has.has(cp)) { out += ch; continue; }
      const sub = SUBSTITUTE[cp];
      out += sub !== undefined ? sub : '?';
    }
    return out;
  }
}

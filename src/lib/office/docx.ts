// Word (.docx) → PDF: the text with its headings, emphasis, lists, tables and pictures, laid out on pages.
import { BLACK, HIGHLIGHTS, hex, type RGB } from './color';
import type { Ctx } from './ctx';
import { familyOf, type Family } from './fonts';
import type { Pack } from './pack';
import { type Block, defaultPara, type Para, Pager, type Run, type Table, type TCell, type TRow } from './render';
import { at, flag, kid, kids, num, path, type El } from './xml';

const TWIP = 1 / 20;
const EMU = 1 / 12700;

interface PProps {
  align?: Para['align'];
  before?: number;
  after?: number;
  left?: number;
  right?: number;
  first?: number;
  lineMult?: number;
  keepNext?: boolean;
  pageBreakBefore?: boolean;
  contextual?: boolean;
  numId?: number;
  ilvl?: number;
}
interface RProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: RGB | null; // null: automatic
  size?: number;
  family?: Family;
  script?: 'sup' | 'sub' | null;
  caps?: boolean;
  bg?: RGB;
  hidden?: boolean;
}
interface Style {
  id: string;
  type: string;
  basedOn?: string;
  name: string;
  p: PProps;
  r: RProps;
  isDefault: boolean;
}

function parsePPr(el: El | null): PProps {
  const out: PProps = {};
  if (!el) return out;
  const jc = at(kid(el, 'jc'), 'val');
  if (jc) out.align = jc === 'center' ? 'c' : jc === 'right' || jc === 'end' ? 'r' : jc === 'both' || jc === 'distribute' ? 'j' : 'l';
  const sp = kid(el, 'spacing');
  if (sp) {
    const b = num(sp, 'before');
    const a = num(sp, 'after');
    if (b !== null) out.before = b * TWIP;
    if (a !== null) out.after = a * TWIP;
    const line = num(sp, 'line');
    if (line !== null) {
      const rule = at(sp, 'lineRule') ?? 'auto';
      // "auto" is in 240ths of a line; fixed heights are turned into a multiple of the usual line.
      out.lineMult = rule === 'auto' ? line / 240 : undefined;
      if (rule !== 'auto') out.lineMult = Math.max(0.8, Math.min(3, (line * TWIP) / (11 * 1.22)));
    }
  }
  const ind = kid(el, 'ind');
  if (ind) {
    const left = num(ind, 'left') ?? num(ind, 'start');
    const right = num(ind, 'right') ?? num(ind, 'end');
    const first = num(ind, 'firstLine');
    const hang = num(ind, 'hanging');
    if (left !== null) out.left = left * TWIP;
    if (right !== null) out.right = right * TWIP;
    if (hang !== null) out.first = -hang * TWIP;
    else if (first !== null) out.first = first * TWIP;
  }
  if (flag(kid(el, 'keepNext'))) out.keepNext = true;
  if (flag(kid(el, 'pageBreakBefore'))) out.pageBreakBefore = true;
  const ctxSp = flag(kid(el, 'contextualSpacing'));
  if (ctxSp !== undefined) out.contextual = ctxSp;
  const numPr = kid(el, 'numPr');
  if (numPr) {
    const id = num(kid(numPr, 'numId'), 'val');
    const lvl = num(kid(numPr, 'ilvl'), 'val');
    if (id !== null) out.numId = id;
    if (lvl !== null) out.ilvl = lvl;
  }
  return out;
}

function parseRPr(el: El | null): RProps {
  const out: RProps = {};
  if (!el) return out;
  const b = flag(kid(el, 'b'));
  if (b !== undefined) out.bold = b;
  const i = flag(kid(el, 'i'));
  if (i !== undefined) out.italic = i;
  const u = kid(el, 'u');
  if (u) out.underline = (at(u, 'val') ?? 'single') !== 'none';
  const s = flag(kid(el, 'strike')) ?? flag(kid(el, 'dstrike'));
  if (s !== undefined) out.strike = s;
  const col = kid(el, 'color');
  if (col) {
    const v = at(col, 'val');
    out.color = !v || v === 'auto' ? null : hex(v) ?? undefined;
  }
  const sz = num(kid(el, 'sz'), 'val');
  if (sz !== null) out.size = sz / 2;
  const fonts = kid(el, 'rFonts');
  if (fonts) {
    const name = at(fonts, 'ascii') ?? at(fonts, 'hAnsi') ?? at(fonts, 'cs');
    const fam = familyOf(name);
    if (fam) out.family = fam;
  }
  const va = at(kid(el, 'vertAlign'), 'val');
  if (va) out.script = va === 'superscript' ? 'sup' : va === 'subscript' ? 'sub' : null;
  const caps = flag(kid(el, 'caps')) ?? flag(kid(el, 'smallCaps'));
  if (caps !== undefined) out.caps = caps;
  const hl = at(kid(el, 'highlight'), 'val');
  if (hl && HIGHLIGHTS[hl]) out.bg = HIGHLIGHTS[hl];
  const shd = kid(el, 'shd');
  if (shd) out.bg = hex(at(shd, 'fill')) ?? out.bg;
  if (flag(kid(el, 'vanish'))) out.hidden = true;
  return out;
}

const merge = <T extends object>(...parts: (T | undefined)[]): T => Object.assign({}, ...parts.map((p) => (p ? Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) : {}))) as T;

class Styles {
  private map = new Map<string, Style>();
  defaultP: PProps = {};
  defaultR: RProps = { size: 11 };
  normal?: string;

  constructor(root: El | null) {
    const dd = kid(root, 'docDefaults');
    this.defaultP = parsePPr(path(dd, 'pPrDefault', 'pPr'));
    this.defaultR = merge<RProps>({ size: 11 }, parseRPr(path(dd, 'rPrDefault', 'rPr')));
    for (const s of kids(root, 'style')) {
      const id = at(s, 'styleId');
      if (!id) continue;
      const isDefault = at(s, 'default') === '1' || at(s, 'default') === 'true';
      const type = at(s, 'type') ?? 'paragraph';
      this.map.set(id, {
        id, type, name: at(kid(s, 'name'), 'val') ?? id, basedOn: at(kid(s, 'basedOn'), 'val') ?? undefined,
        p: parsePPr(kid(s, 'pPr')), r: parseRPr(kid(s, 'rPr')), isDefault,
      });
      if (isDefault && type === 'paragraph') this.normal = id;
    }
  }

  private chain(id: string | undefined): Style[] {
    const out: Style[] = [];
    const seen = new Set<string>();
    for (let cur = id ? this.map.get(id) : undefined; cur && !seen.has(cur.id); cur = cur.basedOn ? this.map.get(cur.basedOn) : undefined) {
      seen.add(cur.id);
      out.unshift(cur);
    }
    return out;
  }

  /** What a paragraph in style `id` looks like (a table's style, when inside one, comes before the paragraph's own). */
  para(id: string | undefined, table?: { p: PProps; r: RProps } | null): { p: PProps; r: RProps } {
    const chain = this.chain(id ?? this.normal);
    return {
      p: merge<PProps>(this.defaultP, table?.p, ...chain.map((s) => s.p)),
      r: merge<RProps>(this.defaultR, table?.r, ...chain.map((s) => s.r)),
    };
  }

  char(id: string | undefined): RProps {
    return merge<RProps>(...this.chain(id).map((s) => s.r));
  }

  /** Properties a table style gives its paragraphs, and whether it draws a grid. */
  table(id: string | undefined): { p: PProps; r: RProps; grid: boolean } {
    const chain = this.chain(id);
    return {
      p: merge<PProps>(...chain.map((s) => s.p)),
      r: merge<RProps>(...chain.map((s) => s.r)),
      grid: chain.some((s) => /grid/i.test(s.name) || /grid/i.test(s.id)),
    };
  }
}

// ---- lists ----------------------------------------------------------------
interface Level { fmt: string; text: string; left?: number; first?: number; start: number }

class Numbering {
  private abstract = new Map<number, Map<number, Level>>();
  private nums = new Map<number, number>();
  private counters = new Map<number, number[]>();

  constructor(root: El | null) {
    for (const a of kids(root, 'abstractNum')) {
      const id = num(a, 'abstractNumId');
      if (id === null) continue;
      const levels = new Map<number, Level>();
      for (const l of kids(a, 'lvl')) {
        const ilvl = num(l, 'ilvl') ?? 0;
        const ind = parsePPr(kid(l, 'pPr'));
        levels.set(ilvl, {
          fmt: at(kid(l, 'numFmt'), 'val') ?? 'decimal',
          text: at(kid(l, 'lvlText'), 'val') ?? '',
          left: ind.left, first: ind.first, start: num(kid(l, 'start'), 'val') ?? 1,
        });
      }
      this.abstract.set(id, levels);
    }
    for (const n of kids(root, 'num')) {
      const id = num(n, 'numId');
      const a = num(kid(n, 'abstractNumId'), 'val');
      if (id !== null && a !== null) this.nums.set(id, a);
    }
  }

  level(numId: number, ilvl: number): Level | undefined {
    return this.abstract.get(this.nums.get(numId) ?? -1)?.get(ilvl);
  }

  /** The label of the next item in list `numId` at `ilvl` ("•", "3.", "b)"…), and its indents. */
  next(numId: number, ilvl: number): { label: string; left: number; first: number } | null {
    const lvl = this.level(numId, ilvl);
    if (!lvl) return null;
    const count = this.counters.get(numId) ?? [];
    count[ilvl] = (count[ilvl] ?? lvl.start - 1) + 1;
    count.length = ilvl + 1; // a new item at this level restarts the ones below it
    this.counters.set(numId, count);
    const left = lvl.left ?? 36 * (ilvl + 1);
    const first = lvl.first ?? -18;
    if (lvl.fmt === 'none') return { label: '', left, first };
    if (lvl.fmt === 'bullet') {
      const t = lvl.text;
      const label = t === 'o' ? '◦' : t === '§' || t === '' ? '▪' : t === '' || !t || t.charCodeAt(0) > 0xe000 ? '•' : t;
      return { label, left, first };
    }
    const label = lvl.text.replace(/%(\d)/g, (_, d) => {
      const l = Number(d) - 1;
      const lv = this.level(numId, l);
      const v = count[l] ?? lv?.start ?? 1;
      return formatNumber(v, lv?.fmt ?? 'decimal');
    });
    return { label, left, first };
  }
}

function formatNumber(n: number, fmt: string): string {
  const letters = (v: number) => {
    let s = '';
    for (let k = v; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
    return s;
  };
  const roman = (v: number) => {
    const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let s = '';
    for (const [k, r] of t) while (v >= k) { s += r; v -= k; }
    return s;
  };
  switch (fmt) {
    case 'lowerLetter': return letters(n);
    case 'upperLetter': return letters(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'decimalZero': return String(n).padStart(2, '0');
    default: return String(n);
  }
}

// ---- the document ---------------------------------------------------------
export async function docxToPdf(pack: Pack, ctx: Ctx): Promise<void> {
  const rootRels = relsOfRoot(pack);
  const main = [...rootRels.values()].find((r) => /officeDocument$/.test(r.type))?.target ?? 'word/document.xml';
  const root = pack.doc(main);
  if (!root) throw new Error('This Word file has no document in it.');
  const dir = main.slice(0, main.lastIndexOf('/') + 1);
  const rels = pack.rels(main);
  const styles = new Styles(pack.doc(`${dir}styles.xml`));
  const numbering = new Numbering(pack.doc(`${dir}numbering.xml`));
  const body = kid(root, 'body');

  // Page and margins from the last section.
  const sect = kid(body, 'sectPr');
  const pgSz = kid(sect, 'pgSz');
  const pgMar = kid(sect, 'pgMar');
  let pw = (num(pgSz, 'w') ?? 11906) * TWIP;
  let ph = (num(pgSz, 'h') ?? 16838) * TWIP;
  if (at(pgSz, 'orient') === 'landscape' && pw < ph) [pw, ph] = [ph, pw];
  const margins = {
    top: Math.max(24, (num(pgMar, 'top') ?? 1440) * TWIP),
    right: Math.max(24, (num(pgMar, 'right') ?? 1440) * TWIP),
    bottom: Math.max(24, (num(pgMar, 'bottom') ?? 1440) * TWIP),
    left: Math.max(24, (num(pgMar, 'left') ?? 1440) * TWIP),
  };
  const contentW = pw - margins.left - margins.right;

  const families = new Set<Family>();
  const note = (f?: Family) => { if (f) families.add(f); };
  // Footnotes are gathered and set after the text, numbered in the order they are mentioned.
  const footnotePart = [...rels.values()].find((r) => /\/footnotes$/.test(r.type))?.target;
  const footnotes = new Map<string, El>();
  for (const f of kids(footnotePart ? pack.doc(footnotePart) : null, 'footnote')) {
    const id = at(f, 'id');
    if (id !== null && num(f, 'id')! > 0) footnotes.set(id, f);
  }
  const cited: El[] = [];
  note(styles.defaultR.family);

  // ---- paragraphs
  const picsOf = async (run: El): Promise<{ bytes: Uint8Array; w: number; h: number; crop?: { l: number; t: number; r: number; b: number } }[]> => {
    const out: { bytes: Uint8Array; w: number; h: number; crop?: { l: number; t: number; r: number; b: number } }[] = [];
    const walk = (el: El) => {
      for (const c of kids(el)) {
        if (c.localName === 'drawing') {
          const ext = path(kid(c, 'inline') ?? kid(c, 'anchor'), 'extent');
          const cx = num(ext, 'cx');
          const cy = num(ext, 'cy');
          const blip = c.getElementsByTagNameNS('*', 'blip')[0];
          const rid = blip ? at(blip, 'embed') : null;
          const target = rid ? rels.get(rid)?.target : undefined;
          const bytes = target ? pack.bytes(target) : undefined;
          if (bytes && cx && cy) {
            const src = c.getElementsByTagNameNS('*', 'srcRect')[0];
            const crop = src ? { l: (num(src, 'l') ?? 0) / 100000, t: (num(src, 't') ?? 0) / 100000, r: (num(src, 'r') ?? 0) / 100000, b: (num(src, 'b') ?? 0) / 100000 } : undefined;
            out.push({ bytes, w: cx * EMU, h: cy * EMU, crop: crop && (crop.l || crop.t || crop.r || crop.b) ? crop : undefined });
          }
        } else if (c.localName === 'pict') {
          const data = c.getElementsByTagNameNS('*', 'imagedata')[0];
          const rid = data ? at(data, 'id') : null;
          const target = rid ? rels.get(rid)?.target : undefined;
          const bytes = target ? pack.bytes(target) : undefined;
          if (bytes) out.push({ bytes, w: 0, h: 0 });
        } else if (c.localName !== 'txbxContent') walk(c);
      }
    };
    walk(run);
    return out;
  };

  const buildPara = async (p: El, inherit: { p: PProps; r: RProps } | null, into: Block[]) => {
    const style = styles.para(at(kid(kid(p, 'pPr'), 'pStyle'), 'val') ?? undefined, inherit);
    const direct = parsePPr(kid(p, 'pPr'));
    const props = merge<PProps>(style.p, direct);
    const baseR = style.r;
    const paraFamily = baseR.family ?? styles.defaultR.family ?? 'sans';
    note(paraFamily);

    let label: string | undefined;
    let left = props.left ?? 0;
    let first = props.first ?? 0;
    if (props.numId) {
      const n = numbering.next(props.numId, props.ilvl ?? 0);
      if (n && n.label) {
        label = n.label;
        left = direct.left ?? (props.left && props.left > 0 ? props.left : n.left);
        first = direct.first ?? n.first;
      }
    }
    const size = baseR.size ?? 11;
    const mk = (): Para => defaultPara({
      size, family: paraFamily, color: baseR.color ?? BLACK, align: props.align ?? 'l',
      before: props.before ?? 0, after: props.after ?? 0, left, first, right: props.right ?? 0,
      lineMult: props.lineMult ?? 1, keepNext: props.keepNext, pageBreakBefore: props.pageBreakBefore,
    });
    const styleKey = at(kid(kid(p, 'pPr'), 'pStyle'), 'val') ?? '';
    let para = mk();
    para.bullet = label;
    const pics: { bytes: Uint8Array; w: number; h: number; crop?: { l: number; t: number; r: number; b: number } }[] = [];
    const flush = (breakAfter: boolean) => {
      para.breakAfter = breakAfter;
      into.push(para);
      para = mk();
      para.before = 0;
      para.pageBreakBefore = false;
      para.bullet = undefined;
      para.left = left;
      para.first = 0;
    };

    const runOf = (r: El): void => {
      const rp = merge<RProps>(baseR, styles.char(at(kid(kid(r, 'rPr'), 'rStyle'), 'val') ?? undefined), parseRPr(kid(r, 'rPr')));
      if (rp.hidden) return;
      const base: Run = {
        text: '',
        bold: rp.bold, italic: rp.italic, underline: rp.underline, strike: rp.strike,
        color: rp.color ?? undefined, size: rp.size !== size ? rp.size : undefined,
        family: rp.family && rp.family !== paraFamily ? rp.family : undefined, script: rp.script ?? undefined, bg: rp.bg,
      };
      note(base.family);
      const add = (text: string) => {
        if (!text) return;
        const t = rp.caps ? text.toUpperCase() : text;
        const last = para.runs[para.runs.length - 1];
        if (last && JSON.stringify({ ...last, text: '' }) === JSON.stringify({ ...base, text: '' })) last.text += t;
        else para.runs.push({ ...base, text: t });
      };
      for (const c of kids(r)) {
        switch (c.localName) {
          case 't': add(c.textContent ?? ''); break;
          case 'tab': add('\t'); break;
          case 'br': case 'cr':
            if (at(c, 'type') === 'page') flush(true);
            else add('\n');
            break;
          case 'noBreakHyphen': add('-'); break;
          case 'footnoteReference': {
            const f = footnotes.get(at(c, 'id') ?? '');
            if (f) { cited.push(f); para.runs.push({ ...base, text: String(cited.length), script: 'sup' }); }
            break;
          }
          case 'sym': { const ch = at(c, 'char'); if (ch) add(String.fromCodePoint(parseInt(ch, 16) & 0xffff)); break; }
          default: break;
        }
      }
    };

    const walk = (el: El) => {
      for (const c of kids(el)) {
        switch (c.localName) {
          case 'r': runOf(c); break;
          case 'hyperlink': case 'smartTag': case 'ins': case 'fldSimple': case 'sdt': case 'sdtContent': case 'customXml': walk(c); break;
          default: break;
        }
      }
    };
    walk(p);
    for (const r of p.getElementsByTagNameNS('*', 'r')) {
      if (r.getElementsByTagNameNS('*', 'drawing').length || r.getElementsByTagNameNS('*', 'pict').length) {
        // pictures that are not inside a text box belong to this paragraph
        let inBox = false;
        for (let a = r.parentElement; a && a !== p; a = a.parentElement) if (a.localName === 'txbxContent') inBox = true;
        if (!inBox) pics.push(...(await picsOf(r)));
      }
    }
    const hasText = para.runs.some((r) => r.text.trim());
    if (hasText || !pics.length) {
      para.styleKey = styleKey;
      para.contextual = props.contextual;
      // Paragraphs of one style that ask for it sit together with no space between.
      const before = into[into.length - 1];
      if (before?.kind === 'p' && para.contextual && before.contextual && before.styleKey === styleKey) {
        before.after = 0;
        para.before = 0;
      }
      into.push(para);
    }
    for (const pic of pics) {
      const e = await ctx.image(pic.bytes, pic.crop);
      if (!e) continue;
      const w = pic.w || e.w;
      const h = pic.h || e.h;
      into.push({ kind: 'img', image: e.image, w, h, align: props.align === 'c' ? 'c' : props.align === 'r' ? 'r' : 'l', before: hasText ? 2 : para.before, after: 4 });
    }
  };

  const buildTable = async (t: El): Promise<Table> => {
    const tblPr = kid(t, 'tblPr');
    const tstyle = styles.table(at(kid(tblPr, 'tblStyle'), 'val') ?? undefined);
    const borders = kid(tblPr, 'tblBorders');
    const edge = (n: string) => { const e = kid(borders, n); const v = at(e, 'val'); return !!e && !!v && v !== 'nil' && v !== 'none'; };
    const border = !!borders ? ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].some(edge) : tstyle.grid;
    const gridEl = kid(t, 'tblGrid');
    let cols = kids(gridEl, 'gridCol').map((g) => (num(g, 'w') ?? 0) * TWIP);
    const rows: TRow[] = [];
    for (const tr of kids(t, 'tr')) {
      const row: TRow = { cells: [], header: !!flag(path(tr, 'trPr', 'tblHeader')) };
      const h = num(path(tr, 'trPr', 'trHeight'), 'val');
      if (h) row.minH = h * TWIP;
      for (const tc of kids(tr, 'tc')) {
        const pr = kid(tc, 'tcPr');
        const span = num(kid(pr, 'gridSpan'), 'val') ?? 1;
        const merged = kid(pr, 'vMerge');
        const cell: TCell = { blocks: [], span, bg: hex(at(kid(pr, 'shd'), 'fill')) ?? undefined };
        const cb = kid(pr, 'tcBorders');
        if (cb) {
          const side = (n: string) => { const e = kid(cb, n); const v = at(e, 'val'); return !!e && !!v && v !== 'nil' && v !== 'none'; };
          const first = kids(cb).find((e) => { const v = at(e, 'val'); return v && v !== 'nil' && v !== 'none'; });
          cell.edges = {
            t: side('top'), b: side('bottom'), l: side('left') || side('start'), r: side('right') || side('end'),
            color: hex(at(first, 'color')) ?? [0.3, 0.3, 0.3], w: Math.max(0.4, (num(first, 'sz') ?? 4) / 8),
          };
        }
        const va = at(kid(pr, 'vAlign'), 'val');
        if (va) cell.vAlign = va === 'center' ? 'c' : va === 'bottom' ? 'b' : 't';
        if (!(merged && !at(merged, 'val'))) await buildBlocks(tc, cell.blocks, tstyle);
        row.cells.push(cell);
      }
      rows.push(row);
    }
    const nCols = Math.max(cols.length, ...rows.map((r) => r.cells.reduce((a, c) => a + c.span, 0)), 1);
    if (cols.length < nCols || cols.every((c) => c <= 0)) cols = Array.from({ length: nCols }, () => contentW / nCols);
    const mar = kid(tblPr, 'tblCellMar');
    const padX = Math.max(1, (num(kid(mar, 'left') ?? kid(mar, 'start'), 'w') ?? 100) * TWIP);
    const padY = Math.max(0.5, (num(kid(mar, 'top'), 'w') ?? 40) * TWIP);
    return { kind: 'table', cols, rows, border, padX, padY, before: 2, after: 6 };
  };

  async function buildBlocks(parent: El, into: Block[], tableStyle: { p: PProps; r: RProps } | null) {
    for (const c of kids(parent)) {
      if (c.localName === 'p') await buildPara(c, tableStyle, into);
      else if (c.localName === 'tbl') into.push(await buildTable(c));
      else if (c.localName === 'sdt') await buildBlocks(kid(c, 'sdtContent') ?? c, into, tableStyle);
      else if (c.localName === 'ins' || c.localName === 'customXml') await buildBlocks(c, into, tableStyle);
    }
  }

  const blocks: Block[] = [];
  if (body) await buildBlocks(body, blocks, null);

  if (cited.length) {
    blocks.push(defaultPara({ size: 4, after: 2, runs: [{ text: '' }] }));
    for (let i = 0; i < cited.length; i++) {
      const part: Block[] = [];
      await buildBlocks(cited[i], part, null);
      const first = part.find((b): b is Para => b.kind === 'p');
      if (first) { first.runs.unshift({ text: `${i + 1} `, script: 'sup' }); first.size = Math.min(first.size, 9); first.runs.forEach((r) => { r.size = r.size ? Math.min(r.size, 9) : undefined; }); }
      for (const b of part) if (b.kind === 'p') { b.size = Math.min(b.size, 9); b.after = 2; b.before = 0; }
      blocks.push(...part);
    }
  }

  await ctx.fonts.load(families);
  const pager = new Pager(() => ctx.doc.addPage([pw, ph]), pw, ph, margins, ctx.fonts);
  pager.start();
  pager.placeBlocks(blocks);
}

function relsOfRoot(pack: Pack) {
  const out = new Map<string, { target: string; type: string }>();
  const root = pack.doc('_rels/.rels');
  for (const r of kids(root, 'Relationship')) {
    const id = at(r, 'Id');
    const target = at(r, 'Target');
    if (id && target) out.set(id, { target: target.replace(/^\//, ''), type: at(r, 'Type') ?? '' });
  }
  return out;
}

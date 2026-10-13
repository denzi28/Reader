// OpenDocument (LibreOffice, Google Docs exports): text (.odt), spreadsheets (.ods), presentations (.odp).
import { rgb } from 'pdf-lib';
import { BLACK, hex, WHITE, type RGB } from './color';
import type { Ctx } from './ctx';
import { familyOf, type Family } from './fonts';
import type { Pack } from './pack';
import { type Atom, type Block, defaultPara, Pager, paraAtoms, type Para, type Run, type Table, type TCell } from './render';
import { type Grid, type GridCell, renderGrids } from './sheets';
import { at, kid, kids, num, type El } from './xml';

// ---- lengths and styles ---------------------------------------------------------
function len(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|pc|px|em)?$/.exec(v.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'cm': return n * 28.3465;
    case 'mm': return n * 2.83465;
    case 'in': return n * 72;
    case 'pc': return n * 12;
    case 'px': return n * 0.75;
    default: return n;
  }
}
const pct = (v: string | null | undefined) => (v && v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : undefined);
const color = (v: string | null | undefined): RGB | undefined => (v && v !== 'transparent' ? hex(v) : undefined);

interface OStyle {
  family: string;
  parent?: string;
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean;
  color?: RGB; size?: number; sizePct?: number; font?: Family; script?: 'sup' | 'sub' | null; bg?: RGB;
  align?: Para['align']; left?: number; right?: number; indent?: number; before?: number; after?: number;
  pageBreak?: boolean; keepNext?: boolean; lineMult?: number;
  colWidth?: number; cellBg?: RGB; border?: boolean; vAlign?: string;
  fill?: RGB | null; stroke?: RGB | null; strokeW?: number; hidden?: boolean;
}

function readStyle(el: El, fontFaces: Map<string, string>): OStyle {
  const st: OStyle = { family: at(el, 'family') ?? 'paragraph', parent: at(el, 'parent-style-name') ?? undefined };
  const t = kid(el, 'text-properties');
  if (t) {
    const w = at(t, 'font-weight'); if (w) st.bold = w === 'bold' || Number(w) >= 600;
    const i = at(t, 'font-style'); if (i) st.italic = i === 'italic' || i === 'oblique';
    const u = at(t, 'text-underline-style'); if (u) st.underline = u !== 'none';
    const s = at(t, 'text-line-through-style'); if (s) st.strike = s !== 'none';
    st.color = color(at(t, 'color'));
    const sz = at(t, 'font-size');
    if (sz) { const p = pct(sz); if (p !== undefined) st.sizePct = p; else st.size = len(sz); }
    const fam = at(t, 'font-family') ?? fontFaces.get(at(t, 'font-name') ?? '');
    if (fam) st.font = familyOf(fam.replace(/['"]/g, ''));
    const pos = at(t, 'text-position');
    if (pos) { const first = parseFloat(pos); st.script = pos.startsWith('super') || first > 0 ? 'sup' : pos.startsWith('sub') || first < 0 ? 'sub' : null; }
    st.bg = color(at(t, 'background-color'));
    if (at(t, 'display') === 'none') st.hidden = true;
  }
  const p = kid(el, 'paragraph-properties');
  if (p) {
    const a = at(p, 'text-align');
    if (a) st.align = a === 'center' ? 'c' : a === 'end' || a === 'right' ? 'r' : a === 'justify' ? 'j' : 'l';
    st.left = len(at(p, 'margin-left')); st.right = len(at(p, 'margin-right')); st.indent = len(at(p, 'text-indent'));
    st.before = len(at(p, 'margin-top')); st.after = len(at(p, 'margin-bottom'));
    st.pageBreak = at(p, 'break-before') === 'page';
    st.keepNext = at(p, 'keep-with-next') === 'always';
    const lh = at(p, 'line-height'); if (lh) { const q = pct(lh); if (q) st.lineMult = q; }
    st.bg = st.bg ?? undefined;
    const pb = color(at(p, 'background-color')); if (pb && st.cellBg === undefined) st.cellBg = pb;
  }
  const c = kid(el, 'table-cell-properties');
  if (c) {
    st.cellBg = color(at(c, 'background-color')) ?? st.cellBg;
    const b = ['border', 'border-top', 'border-bottom', 'border-left', 'border-right'].map((n) => at(c, n)).find((v) => v && v !== 'none' && !/^0(\.0+)?(cm|pt|in|mm)\s/.test(v));
    st.border = !!b;
    st.vAlign = at(c, 'vertical-align') ?? undefined;
  }
  const col = kid(el, 'table-column-properties');
  if (col) st.colWidth = len(at(col, 'column-width'));
  const g = kid(el, 'graphic-properties');
  if (g) {
    const f = at(g, 'fill');
    st.fill = f === 'none' ? null : f === 'solid' ? color(at(g, 'fill-color')) ?? null : undefined;
    const sk = at(g, 'stroke');
    st.stroke = sk === 'none' ? null : sk ? color(at(g, 'stroke-color')) ?? BLACK : undefined;
    st.strokeW = len(at(g, 'stroke-width'));
  }
  return st;
}

class Styles {
  private map = new Map<string, OStyle>();
  private defaults = new Map<string, OStyle>();
  private lists = new Map<string, Map<number, { numbered: boolean; char?: string; fmt?: string; start: number; left?: number; hang?: number }>>();
  fontFaces = new Map<string, string>();

  constructor(roots: (El | null)[]) {
    for (const r of roots) for (const f of kids(kid(r, 'font-face-decls'), 'font-face')) {
      const n = at(f, 'name'); const fam = at(f, 'font-family');
      if (n && fam) this.fontFaces.set(n, fam);
    }
    for (const r of roots) {
      for (const holder of [kid(r, 'styles'), kid(r, 'automatic-styles')]) {
        for (const s of kids(holder)) {
          const name = at(s, 'name');
          if (s.localName === 'default-style') { const fam = at(s, 'family') ?? ''; this.defaults.set(fam, readStyle(s, this.fontFaces)); }
          else if (s.localName === 'style' && name) this.map.set(name, readStyle(s, this.fontFaces));
          else if (s.localName === 'list-style' && name) {
            const lv = new Map<number, { numbered: boolean; char?: string; fmt?: string; start: number; left?: number; hang?: number }>();
            for (const l of kids(s)) {
              const level = (num(l, 'level') ?? 1) - 1;
              const lp = kid(l, 'list-level-properties');
              lv.set(level, {
                numbered: l.localName === 'list-level-style-number',
                char: at(l, 'bullet-char') ?? undefined, fmt: at(l, 'num-format') ?? undefined, start: num(l, 'start-value') ?? 1,
                left: len(at(lp, 'space-before')), hang: len(at(lp, 'min-label-width')),
              });
            }
            this.lists.set(name, lv);
          }
        }
      }
    }
  }

  list(name: string | null | undefined, level: number) {
    return name ? this.lists.get(name)?.get(level) : undefined;
  }

  /** The style's properties with its parents' underneath (and the family default under them all). */
  resolve(name: string | null | undefined, family: string): OStyle {
    const chain: OStyle[] = [];
    const seen = new Set<string>();
    for (let n = name ?? undefined; n && !seen.has(n); ) {
      seen.add(n);
      const s = this.map.get(n);
      if (!s) break;
      chain.unshift(s);
      n = s.parent;
    }
    const base = this.defaults.get(family);
    const out: OStyle = { family };
    let size: number | undefined;
    for (const s of [base, ...chain]) {
      if (!s) continue;
      for (const [k, v] of Object.entries(s)) if (v !== undefined && k !== 'size' && k !== 'sizePct' && k !== 'parent') (out as unknown as Record<string, unknown>)[k] = v;
      if (s.size !== undefined) size = s.size;
      else if (s.sizePct !== undefined && size !== undefined) size *= s.sizePct;
      else if (s.sizePct !== undefined) size = 12 * s.sizePct;
    }
    out.size = size;
    return out;
  }
}

// ---- text -------------------------------------------------------------------------
interface Env {
  ctx: Ctx;
  pack: Pack;
  styles: Styles;
  families: Set<Family>;
  notes: El[];
  /** Numbering of the lists that carry on from an earlier one, by list style. */
  counters?: Map<string, number[]>;
}

function textRuns(el: El, env: Env, base: OStyle, out: Run[], paraSize: number): void {
  const push = (text: string, st: OStyle) => {
    if (!text) return;
    if (st.hidden) return;
    const fam = st.font;
    if (fam) env.families.add(fam);
    const size = st.size ?? paraSize;
    out.push({
      text, bold: st.bold, italic: st.italic, underline: st.underline, strike: st.strike, color: st.color,
      size: size !== paraSize ? size : undefined, family: fam, script: st.script ?? undefined, bg: st.bg,
    });
  };
  const walk = (node: Node, st: OStyle) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        // XML whitespace runs count as one space, as in the document
        push((c.nodeValue ?? '').replace(/[ \t\r\n]+/g, ' '), st);
        continue;
      }
      if (c.nodeType !== 1) continue;
      const e = c as El;
      switch (e.localName) {
        case 'span': {
          const s = env.styles.resolve(at(e, 'style-name'), 'text');
          walk(e, { ...st, ...Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== undefined && k !== 'family')) } as OStyle);
          break;
        }
        case 'a': walk(e, { ...st, underline: true, color: st.color ?? [0.1, 0.3, 0.7] }); break;
        case 's': push(' '.repeat(num(e, 'c') ?? 1), st); break;
        case 'tab': push('\t', st); break;
        case 'line-break': push('\n', st); break;
        case 'note': {
          env.notes.push(e);
          push(String(env.notes.length), { ...st, script: 'sup' });
          break;
        }
        case 'bookmark': case 'bookmark-start': case 'bookmark-end': case 'annotation': case 'note-body': case 'tracked-changes': break;
        default: walk(e, st);
      }
    }
  };
  walk(el, base);
}

function paraOf(el: El, env: Env, over: Partial<Para> = {}): Para {
  const ps = env.styles.resolve(at(el, 'style-name'), 'paragraph');
  const size = ps.size ?? 12;
  const fam = ps.font ?? 'sans';
  env.families.add(fam);
  const runs: Run[] = [];
  textRuns(el, env, ps, runs, size);
  return defaultPara({
    runs, size, family: fam, color: ps.color ?? BLACK, align: ps.align ?? 'l', before: ps.before ?? 0, after: ps.after ?? 0,
    left: ps.left ?? 0, first: ps.indent ?? 0, right: ps.right ?? 0, lineMult: ps.lineMult ?? 1, keepNext: ps.keepNext, pageBreakBefore: ps.pageBreak, ...over,
  });
}

async function imageOf(frame: El, env: Env): Promise<{ image: import('pdf-lib').PDFImage; w: number; h: number } | null> {
  const img = kid(frame, 'image');
  const href = at(img, 'href');
  const bytes = href ? env.pack.bytes(href.replace(/^\.\//, '')) : undefined;
  if (!bytes) return null;
  const e = await env.ctx.image(bytes);
  if (!e) return null;
  const w = len(at(frame, 'width')) ?? e.w;
  const h = len(at(frame, 'height')) ?? e.h;
  return { image: e.image, w, h };
}

const A4 = { w: 595.28, h: 841.89 };

async function blocksOf(parent: El, env: Env, into: Block[], inList: { name: string | null; depth: number; counters: number[] } | null): Promise<void> {
  for (const c of kids(parent)) {
    switch (c.localName) {
      case 'p': case 'h': {
        const p = paraOf(c, env, c.localName === 'h' ? { keepNext: true } : {});
        // pictures in a paragraph follow it
        const frames = [...c.getElementsByTagNameNS('*', 'frame')];
        if (inList) {
          const lv = env.styles.list(inList.name, inList.depth);
          const n = (inList.counters[inList.depth] = (inList.counters[inList.depth] ?? (lv?.start ?? 1) - 1) + 1);
          inList.counters.length = inList.depth + 1;
          const hang = Math.max(14, lv?.hang ?? 18);
          p.left = (inList.depth + 1) * 18 + 6;
          p.first = -hang;
          p.bullet = lv?.numbered ? `${n}.` : lv?.char && lv.char.charCodeAt(0) < 0xe000 ? lv.char : inList.depth ? '◦' : '•';
        }
        if (p.runs.some((r) => r.text.trim()) || !frames.length) into.push(p);
        for (const f of frames) {
          const im = await imageOf(f, env);
          if (im) into.push({ kind: 'img', image: im.image, w: im.w, h: im.h, align: 'l', before: 2, after: 4 });
        }
        break;
      }
      case 'list': {
        const name = at(c, 'style-name') ?? inList?.name ?? null;
        let counters: number[] = inList ? inList.counters : [];
        if (!inList) {
          env.counters ??= new Map();
          const carry = at(c, 'continue-numbering') === 'true' || at(c, 'continue-list') !== null;
          counters = carry ? env.counters.get(name ?? '') ?? [] : [];
          env.counters.set(name ?? '', counters);
        }
        const state = { name, depth: inList ? inList.depth + 1 : 0, counters };
        for (const item of kids(c, 'list-item')) await blocksOf(item, env, into, state);
        break;
      }
      case 'section': case 'list-item': await blocksOf(c, env, into, inList); break;
      case 'table': into.push(await tableOf(c, env)); break;
      default: break;
    }
  }
}

async function tableOf(t: El, env: Env): Promise<Table> {
  const cols: number[] = [];
  const walkCols = (parent: El) => {
    for (const c of kids(parent)) {
      if (c.localName === 'table-column') {
        const w = env.styles.resolve(at(c, 'style-name'), 'table-column').colWidth ?? 80;
        for (let k = 0; k < Math.min(num(c, 'number-columns-repeated') ?? 1, 60); k++) cols.push(w);
      } else if (c.localName === 'table-columns' || c.localName === 'table-header-columns') walkCols(c);
    }
  };
  walkCols(t);
  const rows: Table['rows'] = [];
  let border = false;
  const walkRows = async (parent: El, header: boolean) => {
    for (const r of kids(parent)) {
      if (r.localName === 'table-header-rows') await walkRows(r, true);
      else if (r.localName === 'table-row-group') await walkRows(r, header);
      else if (r.localName === 'table-row') {
        const cells: TCell[] = [];
        for (const c of kids(r)) {
          if (c.localName !== 'table-cell' && c.localName !== 'covered-table-cell') continue;
          if (c.localName === 'covered-table-cell') continue;
          const st = env.styles.resolve(at(c, 'style-name'), 'table-cell');
          border = border || !!st.border;
          const blocks: Block[] = [];
          await blocksOf(c, env, blocks, null);
          const cell: TCell = { blocks, span: num(c, 'number-columns-spanned') ?? 1, bg: st.cellBg };
          if (st.vAlign) cell.vAlign = st.vAlign === 'middle' ? 'c' : st.vAlign === 'bottom' ? 'b' : 't';
          for (let k = 0; k < Math.min(num(c, 'number-columns-repeated') ?? 1, 20); k++) cells.push(k ? { ...cell, blocks: [] } : cell);
        }
        rows.push({ cells, header });
      }
    }
  };
  await walkRows(t, false);
  const n = Math.max(cols.length, ...rows.map((r) => r.cells.reduce((a, c) => a + c.span, 0)), 1);
  while (cols.length < n) cols.push(80);
  return { kind: 'table', cols, rows, border, padX: 5, padY: 2, before: 2, after: 6 };
}

function pageGeometry(styles: (El | null)[]): { w: number; h: number; m: { top: number; right: number; bottom: number; left: number } } {
  for (const r of styles) {
    const lay = kid(kid(r, 'automatic-styles'), 'page-layout');
    const pr = kid(lay, 'page-layout-properties');
    if (pr) {
      return {
        w: len(at(pr, 'page-width')) ?? A4.w, h: len(at(pr, 'page-height')) ?? A4.h,
        m: { top: len(at(pr, 'margin-top')) ?? 56, right: len(at(pr, 'margin-right')) ?? 56, bottom: len(at(pr, 'margin-bottom')) ?? 56, left: len(at(pr, 'margin-left')) ?? 56 },
      };
    }
  }
  return { w: A4.w, h: A4.h, m: { top: 56, right: 56, bottom: 56, left: 56 } };
}

function open(pack: Pack) {
  const content = pack.doc('content.xml');
  const styleDoc = pack.doc('styles.xml');
  if (!content) throw new Error('This file has no content in it.');
  return { content, styleDoc, styles: new Styles([styleDoc, content]) };
}

// ---- text documents ------------------------------------------------------------------
export async function odtToPdf(pack: Pack, ctx: Ctx): Promise<void> {
  const { content, styleDoc, styles } = open(pack);
  const env: Env = { ctx, pack, styles, families: new Set<Family>(['sans']), notes: [] };
  const blocks: Block[] = [];
  await blocksOf(kid(kid(content, 'body'), 'text') ?? content, env, blocks, null);
  // Footnotes go after the text, numbered.
  for (let i = 0; i < env.notes.length; i++) {
    const part: Block[] = [];
    await blocksOf(kid(env.notes[i], 'note-body') ?? env.notes[i], env, part, null);
    const first = part.find((b): b is Para => b.kind === 'p');
    if (first) first.runs.unshift({ text: `${i + 1} `, script: 'sup' });
    for (const b of part) if (b.kind === 'p') { b.size = Math.min(b.size, 9); b.after = 2; b.before = 0; b.runs.forEach((r) => { if (r.size) r.size = Math.min(r.size, 9); }); }
    if (i === 0) blocks.push(defaultPara({ size: 4, after: 2, runs: [{ text: '' }] }));
    blocks.push(...part);
  }
  await ctx.fonts.load(env.families);
  const g = pageGeometry([styleDoc, content]);
  const pager = new Pager(() => ctx.doc.addPage([g.w, g.h]), g.w, g.h, g.m, ctx.fonts);
  pager.start();
  pager.placeBlocks(blocks);
}

// ---- spreadsheets --------------------------------------------------------------------
export async function odsToPdf(pack: Pack, ctx: Ctx): Promise<void> {
  const { content, styles } = open(pack);
  const sheet = kid(kid(content, 'body'), 'spreadsheet');
  const grids: Grid[] = [];
  for (const t of kids(sheet, 'table')) {
    const cells = new Map<number, Map<number, GridCell>>();
    const widths: number[] = [];
    const hiddenCol = new Set<number>();
    let c0 = 0;
    for (const col of kids(t)) {
      const walk = (e: El) => {
        const w = (styles.resolve(at(e, 'style-name'), 'table-column').colWidth ?? 48) / 5.7;
        const hid = at(e, 'visibility') === 'collapse';
        for (let k = 0; k < Math.min(num(e, 'number-columns-repeated') ?? 1, 200); k++) { widths[c0] = w; if (hid) hiddenCol.add(c0); c0++; }
      };
      if (col.localName === 'table-column') walk(col);
      else if (col.localName === 'table-columns' || col.localName === 'table-header-columns') for (const e of kids(col, 'table-column')) walk(e);
    }
    const spans = new Map<string, number>();
    const covered = new Set<string>();
    const rowHeight = new Map<number, number>();
    let minC = Infinity, maxC = -1, minR = Infinity, maxR = -1;
    let r = 0;
    const doRow = (row: El) => {
      const repeat = Math.min(num(row, 'number-rows-repeated') ?? 1, 5);
      let colNo = 0;
      const line = new Map<number, GridCell>();
      for (const c of kids(row)) {
        if (c.localName !== 'table-cell' && c.localName !== 'covered-table-cell') continue;
        const times = Math.min(num(c, 'number-columns-repeated') ?? 1, 200);
        const text = kids(c, 'p').map((p) => kids(p).length || p.textContent ? (p.textContent ?? '') : '').join('\n');
        if (c.localName === 'covered-table-cell') { colNo += times; continue; }
        const st = styles.resolve(at(c, 'style-name'), 'table-cell');
        const type = at(c, 'value-type');
        const isNum = type === 'float' || type === 'percentage' || type === 'currency' || type === 'date' || type === 'time';
        if (text || st.cellBg) {
          for (let k = 0; k < times && colNo + k < 200; k++) {
            line.set(colNo + k, { text, isNum, isText: !isNum, xf: { bold: st.bold, italic: st.italic, color: st.color, size: st.size, fill: st.cellBg, align: st.align === 'c' ? 'center' : st.align === 'r' ? 'right' : st.align === 'j' ? 'left' : undefined, vAlign: st.vAlign, wrap: false } });
            if (text) { minC = Math.min(minC, colNo + k); maxC = Math.max(maxC, colNo + k); }
          }
        }
        const cs = num(c, 'number-columns-spanned');
        const rs = num(c, 'number-rows-spanned');
        if ((cs || rs) && text) {
          spans.set(`${r}:${colNo}`, cs ?? 1);
          for (let rr = 0; rr < (rs ?? 1); rr++) for (let cc = 0; cc < (cs ?? 1); cc++) if (rr || cc) covered.add(`${r + rr}:${colNo + cc}`);
        }
        colNo += times;
      }
      for (let k = 0; k < repeat; k++) {
        if (line.size && r < 20000) { cells.set(r, new Map(line)); minR = Math.min(minR, r); maxR = Math.max(maxR, r); }
        r++;
      }
    };
    const walkRows = (parent: El) => {
      for (const e of kids(parent)) {
        if (e.localName === 'table-row') doRow(e);
        else if (e.localName === 'table-rows' || e.localName === 'table-header-rows' || e.localName === 'table-row-group') walkRows(e);
      }
    };
    walkRows(t);
    if (maxC < 0) continue;
    grids.push({ name: at(t, 'name') ?? 'Sheet', cells, minC, maxC, minR, maxR, widths, defW: 8.43, hiddenCol, spans, covered, rowHeight });
  }
  if (!grids.length) throw new Error('This file has no sheets to show.');
  await renderGrids(grids, ctx);
}

// ---- presentations -----------------------------------------------------------------------
export async function odpToPdf(pack: Pack, ctx: Ctx): Promise<void> {
  const { content, styleDoc, styles } = open(pack);
  const env: Env = { ctx, pack, styles, families: new Set<Family>(['sans', 'serif', 'mono']), notes: [] };
  const g = pageGeometry([styleDoc, content]);
  const pw = g.w;
  const ph = g.h;
  const pres = kid(kid(content, 'body'), 'presentation');
  await ctx.fonts.load(env.families);
  for (const slide of kids(pres, 'page')) {
    const page = ctx.doc.addPage([pw, ph]);
    const drawShapes = async (parent: El) => {
      for (const s of kids(parent)) {
        if (s.localName === 'g') { await drawShapes(s); continue; }
        if (!['frame', 'custom-shape', 'rect', 'ellipse', 'line', 'connector'].includes(s.localName)) continue;
        const x = len(at(s, 'x')) ?? 0;
        const y = len(at(s, 'y')) ?? 0;
        const w = len(at(s, 'width')) ?? 0;
        const h = len(at(s, 'height')) ?? 0;
        const st = styles.resolve(at(s, 'style-name'), 'graphic');
        if (s.localName === 'line' || s.localName === 'connector') {
          const x1 = len(at(s, 'x1')) ?? x; const y1 = len(at(s, 'y1')) ?? y; const x2 = len(at(s, 'x2')) ?? x + w; const y2 = len(at(s, 'y2')) ?? y + h;
          const c = st.stroke ?? [0.3, 0.3, 0.3];
          page.drawLine({ start: { x: x1, y: ph - y1 }, end: { x: x2, y: ph - y2 }, thickness: Math.max(0.5, st.strokeW ?? 1), color: rgb(c[0], c[1], c[2]) });
          continue;
        }
        if (s.localName !== 'frame' && w > 0 && h > 0 && (st.fill || st.stroke)) {
          const path = s.localName === 'ellipse' ? `M0 ${h / 2} A${w / 2} ${h / 2} 0 1 1 ${w} ${h / 2} A${w / 2} ${h / 2} 0 1 1 0 ${h / 2} Z` : `M0 0 L${w} 0 L${w} ${h} L0 ${h} Z`;
          page.drawSvgPath(path, { x, y: ph - y, color: st.fill ? rgb(st.fill[0], st.fill[1], st.fill[2]) : undefined, borderColor: st.stroke ? rgb(st.stroke[0], st.stroke[1], st.stroke[2]) : undefined, borderWidth: st.stroke ? Math.max(0.5, st.strokeW ?? 1) : undefined });
        }
        const img = kid(s, 'image');
        if (s.localName === 'frame' && img) {
          const im = await imageOf(s, env);
          if (im && w > 0 && h > 0) page.drawImage(im.image, { x, y: ph - y - h, width: w, height: h });
          continue;
        }
        const box = kid(s, 'text-box') ?? (s.localName === 'frame' ? null : s);
        if (!box || w <= 0) continue;
        const atoms: Atom[] = [];
        const blocks: Block[] = [];
        await blocksOf(box, env, blocks, null);
        for (const b of blocks) if (b.kind === 'p') {
          if (st.fill && b.color === BLACK && st.fill[0] + st.fill[1] + st.fill[2] < 1.2) b.color = WHITE;
          atoms.push(...paraAtoms(b, Math.max(w - 14, 10), ctx.fonts));
        }
        const total = atoms.reduce((a, b, i) => a + (i ? b.pre : 0) + b.h + b.post, 0);
        let yy = y + 5;
        if (st.vAlign === 'middle') yy = y + (h - total) / 2;
        atoms.forEach((a, i) => { if (i) yy += a.pre; a.draw({ page, pageH: ph }, x + 7, yy); yy += a.h + a.post; });
      }
    };
    await drawShapes(slide);
  }
  if (ctx.doc.getPageCount() === 0) throw new Error('This presentation has no slides in it.');
}

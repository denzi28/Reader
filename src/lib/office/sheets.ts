// Drawing spreadsheets: each sheet's cells as a table with a light grid. Wide sheets go landscape,
// shrink a little, and are split by columns if they still do not fit. Every spreadsheet format
// (Excel, OpenDocument, old .xls, CSV) is first turned into these grids.
import { rgb } from 'pdf-lib';
import { BLACK, type RGB } from './color';
import type { Ctx } from './ctx';
import { defaultPara, paraAtoms, type Atom, type Para } from './render';

export interface Style {
  bold?: boolean;
  italic?: boolean;
  color?: RGB;
  size?: number;
  fill?: RGB;
  align?: string;
  vAlign?: string;
  wrap?: boolean;
}
export interface GridCell { text: string; xf: Style; isNum: boolean; isText: boolean }
export interface Grid {
  name: string;
  /** Cells by row then column (zero-based). */
  cells: Map<number, Map<number, GridCell>>;
  minC: number; maxC: number; minR: number; maxR: number;
  /** Column widths in characters; missing ones use `defW`. */
  widths: number[];
  defW: number;
  hiddenCol: Set<number>;
  /** Columns spanned by a merged cell, by "row:col" of its top-left corner, and the cells it covers. */
  spans: Map<string, number>;
  covered: Set<string>;
  /** Heights set by hand, in points. */
  rowHeight: Map<number, number>;
}

export async function renderGrids(sheets: Grid[], ctx: Ctx): Promise<void> {
  await ctx.fonts.load(['sans']);
  for (const sheet of sheets) {
    const { cells, minC, maxC, minR, maxR, widths, defW, hiddenCol, spans, covered, rowHeight } = sheet;
    const colIdx: number[] = [];
    for (let c = minC; c <= maxC; c++) if (!hiddenCol.has(c)) colIdx.push(c);
    const widthPt = (c: number) => (widths[c] ?? defW) * 5.7;
    const total = colIdx.reduce((s, c) => s + widthPt(c), 0);
    const M = 36;
    const portraitW = 595.28 - 2 * M;
    const landscape = total * 0.92 > portraitW;
    const pageW = landscape ? 841.89 : 595.28;
    const pageH = landscape ? 595.28 : 841.89;
    const avail = pageW - 2 * M;
    // Shrinks to fit when it takes only a little; beyond that the columns are split over pages.
    let scale = 0.92;
    if (total * scale > avail) scale = Math.max(0.72, avail / total);
    const groups: number[][] = [];
    let cur: number[] = [];
    let used = 0;
    for (const c of colIdx) {
      const w = widthPt(c) * scale;
      if (cur.length && used + w > avail) { groups.push(cur); cur = []; used = 0; }
      cur.push(c); used += w;
    }
    if (cur.length) groups.push(cur);

    const padX = 3;
    const padY = 1.8;
    // Long runs of empty rows are cut short.
    const rows: number[] = [];
    let gap = 0;
    for (let r = minR; r <= maxR; r++) {
      gap = cells.get(r)?.size ? 0 : gap + 1;
      if (gap <= 3) rows.push(r);
    }

    for (const group of groups) {
      let page = ctx.doc.addPage([pageW, pageH]);
      let y = M;
      if (sheets.length > 1 || groups.length > 1) {
        const title = defaultPara({ size: 12, color: BLACK, runs: [{ text: groups.length > 1 ? `${sheet.name} (columns ${groups.indexOf(group) + 1} of ${groups.length})` : sheet.name, bold: true }] });
        const atom = paraAtoms(title, avail, ctx.fonts)[0];
        atom.draw({ page, pageH }, M, y);
        y += atom.h + 8;
      }
      const xs: number[] = [];
      group.reduce((acc, c) => { xs.push(acc); return acc + widthPt(c) * scale; }, 0);
      for (const r of rows) {
        const line = cells.get(r);
        // What goes in each cell of this row, measured.
        interface Placed { x: number; w: number; cell: GridCell | undefined; atoms: Atom[]; h: number }
        const placed: Placed[] = [];
        for (let gi = 0; gi < group.length; gi++) {
          const c = group[gi];
          const cell = line?.get(c);
          if (covered.has(`${r}:${c}`)) continue;
          let w = widthPt(c) * scale;
          const colSpan = spans.get(`${r}:${c}`) ?? 1;
          for (let k = 1; k < colSpan && gi + k < group.length; k++) w += widthPt(group[gi + k]) * scale;
          const align = cell?.xf.align && cell.xf.align !== 'general' ? cell.xf.align : cell?.isNum ? 'right' : 'left';
          const para: Para = defaultPara({
            size: Math.min(14, Math.max(6, (cell?.xf.size ?? 11) * scale * 0.95)), color: cell?.xf.color ?? BLACK,
            align: align === 'center' ? 'c' : align === 'right' ? 'r' : 'l',
            runs: cell?.text ? [{ text: cell.text, bold: cell.xf.bold, italic: cell.xf.italic }] : [],
          });
          // A number or date that is too wide for its column is shown smaller rather than broken up.
          if (cell?.text && cell.isNum) {
            const face = ctx.fonts.get('sans', !!cell.xf.bold, !!cell.xf.italic);
            const need = face.font.widthOfTextAtSize(ctx.fonts.clean(cell.text, face), para.size);
            const room = w - 2 * padX;
            if (need > room) para.size = Math.max(5, (para.size * room) / need);
          }
          // Text that is not set to wrap runs on into the empty cells beside it.
          if (cell?.text && !cell.xf.wrap && !cell.isNum && para.align === 'l') {
            const face = ctx.fonts.get('sans', !!cell.xf.bold, !!cell.xf.italic);
            const need = face.font.widthOfTextAtSize(ctx.fonts.clean(cell.text, face).replace(/\n/g, ' '), para.size) + 2 * padX;
            let k = 1;
            while (w < need && gi + k < group.length && !line?.get(group[gi + k])?.text && !covered.has(`${r}:${group[gi + k]}`)) { w += widthPt(group[gi + k]) * scale; k++; }
            gi += k - 1;
          }
          const atoms = cell?.text ? paraAtoms(para, Math.max(w - 2 * padX, 8), ctx.fonts) : [];
          placed.push({ x: xs[group.indexOf(c)] ?? 0, w, cell, atoms, h: atoms.reduce((s, a) => s + a.h, 0) });
        }
        const custom = (rowHeight.get(r) ?? 0) * scale;
        const rowH = Math.max(custom, 12 * scale + 2 * padY, ...placed.map((p) => p.h + 2 * padY));
        if (y + rowH > pageH - M && y > M + 1) {
          page = ctx.doc.addPage([pageW, pageH]);
          y = M;
        }
        for (const p of placed) {
          const x = M + p.x;
          if (p.cell?.xf.fill) page.drawRectangle({ x, y: pageH - y - rowH, width: p.w, height: rowH, color: rgb(p.cell.xf.fill[0], p.cell.xf.fill[1], p.cell.xf.fill[2]) });
          page.drawRectangle({ x, y: pageH - y - rowH, width: p.w, height: rowH, borderColor: rgb(0.82, 0.82, 0.82), borderWidth: 0.35 });
          let yy = y + padY;
          const free = rowH - 2 * padY - p.h;
          if (p.cell?.xf.vAlign === 'center') yy += free / 2;
          else if (!p.cell?.xf.vAlign || p.cell.xf.vAlign === 'bottom') yy += Math.max(0, free);
          for (const a of p.atoms) {
            a.draw({ page, pageH }, x + padX, yy);
            yy += a.h;
          }
        }
        y += rowH;
      }
    }
  }
}

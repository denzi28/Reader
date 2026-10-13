// Excel (.xlsx) → PDF: each sheet's cells as a table, a light grid, numbers and dates shown the way
// the sheet formats them. Wide sheets go landscape, shrink a little, and are split by columns if
// they still do not fit.
import { hex, type RGB } from './color';
import type { Ctx } from './ctx';
import type { Pack } from './pack';
import { type Grid, type GridCell, renderGrids } from './sheets';
import { at, flag, kid, kids, num, relId, type El } from './xml';

const MAX_ROWS = 20000;
const MAX_COLS = 200;

interface Xf {
  numFmtId: number;
  bold?: boolean;
  italic?: boolean;
  color?: RGB;
  size?: number;
  fill?: RGB;
  align?: string;
  vAlign?: string;
  wrap?: boolean;
}

// ---- number formats ---------------------------------------------------------
export const BUILTIN: Record<number, string> = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 14: 'DATE', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'DATETIME', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const stripLiterals = (code: string) => code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '').replace(/_./g, '');
export const isDateCode = (code: string) => code === 'DATE' || code === 'DATETIME' || /[ymdhs]/i.test(stripLiterals(code)) && !/^[#0?.,%\s$€£₺()+-]*$/.test(stripLiterals(code));

export function general(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const s = String(Number(v.toPrecision(10)));
  return s.includes('e') ? v.toExponential(4).replace(/\.?0+e/, 'e') : s;
}

export function dateText(serial: number, code: string, date1904: boolean): string {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = Math.round(serial * 86400000);
  const d = new Date(base + ms);
  if (code === 'DATE') return d.toLocaleDateString(undefined, { timeZone: 'UTC' });
  if (code === 'DATETIME') return d.toLocaleString(undefined, { timeZone: 'UTC' });
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const pm = /AM\/PM|A\/P/i.test(code);
  const hours = d.getUTCHours();
  let out = '';
  const src = code.split(';')[0];
  const re = /"([^"]*)"|\[[^\]]*\]|\\(.)|(yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P)|(.)/gi;
  let m: RegExpExecArray | null;
  const toks: { t: string; lit: boolean }[] = [];
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) toks.push({ t: m[1], lit: true });
    else if (m[2] !== undefined) toks.push({ t: m[2], lit: true });
    else if (m[3]) toks.push({ t: m[3], lit: false });
    else if (m[4] !== undefined) toks.push({ t: m[4], lit: true });
  }
  toks.forEach((tk, i) => {
    if (tk.lit) { out += tk.t; return; }
    const l = tk.t.toLowerCase();
    // "m" after hours or before seconds means minutes, otherwise months.
    const prev = toks.slice(0, i).reverse().find((x) => !x.lit);
    const next = toks.slice(i + 1).find((x) => !x.lit);
    const minute = (l === 'm' || l === 'mm') && ((prev && /^h/i.test(prev.t)) || (next && /^s/i.test(next.t)));
    if (minute) out += l === 'm' ? String(d.getUTCMinutes()) : p(d.getUTCMinutes());
    else switch (l) {
      case 'yyyy': out += p(d.getUTCFullYear(), 4); break;
      case 'yy': out += p(d.getUTCFullYear() % 100); break;
      case 'mmmm': out += MONTHS[d.getUTCMonth()]; break;
      case 'mmm': out += MONTHS[d.getUTCMonth()].slice(0, 3); break;
      case 'mm': out += p(d.getUTCMonth() + 1); break;
      case 'm': out += String(d.getUTCMonth() + 1); break;
      case 'dddd': out += DAYS[d.getUTCDay()]; break;
      case 'ddd': out += DAYS[d.getUTCDay()].slice(0, 3); break;
      case 'dd': out += p(d.getUTCDate()); break;
      case 'd': out += String(d.getUTCDate()); break;
      case 'hh': out += p(pm ? hours % 12 || 12 : hours); break;
      case 'h': out += String(pm ? hours % 12 || 12 : hours); break;
      case 'ss': out += p(d.getUTCSeconds()); break;
      case 's': out += String(d.getUTCSeconds()); break;
      case 'am/pm': out += hours < 12 ? 'AM' : 'PM'; break;
      case 'a/p': out += hours < 12 ? 'A' : 'P'; break;
      default: out += tk.t;
    }
  });
  return out;
}

export function numberText(v: number, code: string): string {
  const sections = code.split(';');
  let sec = sections[0];
  let neg = false;
  if (v < 0) {
    if (sections.length > 1) sec = sections[1];
    else neg = true;
  }
  const value = Math.abs(v);
  // Literal text and currency symbols around the number.
  const literal = (s: string) => s.replace(/\[\$([^\]-]*)[^\]]*\]/g, '$1').replace(/\[[^\]]*\]/g, '').replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1').replace(/_./g, ' ').replace(/\*./g, '');
  const spec = /[#0?][#0?,.]*/.exec(sec.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, ''));
  if (!spec) return sec ? literal(sec) : general(v);
  const whole = spec[0];
  const percent = /%/.test(sec);
  const scaled = percent ? value * 100 : value;
  const dot = whole.indexOf('.');
  const decimals = dot >= 0 ? whole.length - dot - 1 : 0;
  const optional = dot >= 0 ? (whole.slice(dot + 1).match(/#/g) ?? []).length : 0;
  const thousands = whole.includes(',') && whole.slice(0, dot >= 0 ? dot : undefined).includes(',');
  let body = scaled.toFixed(decimals);
  if (optional) body = body.replace(new RegExp(`\\.?0{0,${optional}}$`), '');
  if (thousands) {
    const [i, f] = body.split('.');
    body = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
  }
  const idx = sec.search(/[#0?]/);
  const before = literal(sec.slice(0, idx));
  const end = sec.length - [...sec].reverse().join('').search(/[#0?]/);
  const after = literal(sec.slice(end));
  return `${neg ? '-' : ''}${before}${body}${after}`.replace(/%%/g, '%');
}

// ---- the workbook ------------------------------------------------------------
export async function xlsxToPdf(pack: Pack, ctx: Ctx): Promise<void> {
  const rootRels = pack.rels('xl/workbook.xml');
  const wb = pack.doc('xl/workbook.xml');
  if (!wb) throw new Error('This Excel file has no workbook in it.');
  const epoch = at(kid(wb, 'workbookPr'), 'date1904');
  const date1904 = epoch === '1' || epoch === 'true';

  // Shared strings
  const strings: string[] = [];
  for (const si of kids(pack.doc('xl/sharedStrings.xml'), 'si')) {
    let t = '';
    const walk = (el: El) => { for (const c of kids(el)) { if (c.localName === 't') t += c.textContent ?? ''; else if (c.localName === 'r') walk(c); } };
    walk(si);
    strings.push(t);
  }

  // Styles
  const styles = pack.doc('xl/styles.xml');
  const formats = new Map<number, string>();
  for (const f of kids(kid(styles, 'numFmts'), 'numFmt')) {
    const id = num(f, 'numFmtId');
    const code = at(f, 'formatCode');
    if (id !== null && code) formats.set(id, code);
  }
  const fonts = kids(kid(styles, 'fonts'), 'font').map((f) => ({
    bold: flag(kid(f, 'b')), italic: flag(kid(f, 'i')), size: num(kid(f, 'sz'), 'val') ?? undefined,
    color: hex((at(kid(f, 'color'), 'rgb') ?? '').slice(-6)) ?? undefined,
  }));
  const fills = kids(kid(styles, 'fills'), 'fill').map((f) => {
    const pf = kid(f, 'patternFill');
    if (at(pf, 'patternType') !== 'solid') return undefined;
    return hex((at(kid(pf, 'fgColor'), 'rgb') ?? '').slice(-6)) ?? undefined;
  });
  const xfs: Xf[] = kids(kid(styles, 'cellXfs'), 'xf').map((x) => {
    const font = fonts[num(x, 'fontId') ?? 0];
    const al = kid(x, 'alignment');
    return {
      numFmtId: num(x, 'numFmtId') ?? 0, bold: font?.bold, italic: font?.italic, color: font?.color, size: font?.size,
      fill: fills[num(x, 'fillId') ?? 0], align: at(al, 'horizontal') ?? undefined, vAlign: at(al, 'vertical') ?? undefined, wrap: at(al, 'wrapText') === '1' || at(al, 'wrapText') === 'true',
    };
  });

  const sheets: { name: string; part: string }[] = [];
  for (const s of kids(kid(wb, 'sheets'), 'sheet')) {
    if (at(s, 'state') === 'hidden' || at(s, 'state') === 'veryHidden') continue;
    const rid = relId(s);
    const target = rid ? rootRels.get(rid)?.target : undefined;
    if (target && pack.has(target)) sheets.push({ name: at(s, 'name') ?? 'Sheet', part: target });
  }
  if (!sheets.length) throw new Error('This Excel file has no sheets to show.');

  const grids: Grid[] = [];
  const colLetters = (ref: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) return null;
    let c = 0;
    for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
    return { col: c - 1, row: Number(m[2]) - 1 };
  };

  for (const sheet of sheets) {
    const root = pack.doc(sheet.part);
    if (!root) continue;
    const cells = new Map<number, Map<number, GridCell>>();
    let minC = Infinity, maxC = -1, minR = Infinity, maxR = -1;
    for (const row of kids(kid(root, 'sheetData'), 'row')) {
      if (at(row, 'hidden') === '1' || at(row, 'hidden') === 'true') continue;
      let auto = 0;
      const rIndex = (num(row, 'r') ?? 0) - 1;
      for (const c of kids(row, 'c')) {
        const pos = colLetters(at(c, 'r') ?? '') ?? { col: auto, row: rIndex };
        auto = pos.col + 1;
        if (pos.row >= MAX_ROWS || pos.col >= MAX_COLS) continue;
        const t = at(c, 't');
        const vEl = kid(c, 'v');
        let raw = vEl?.textContent ?? '';
        const xf = xfs[num(c, 's') ?? 0] ?? { numFmtId: 0 };
        let text = '';
        let isNum = false;
        if (t === 's') text = strings[Number(raw)] ?? '';
        else if (t === 'inlineStr') { text = kids(kid(c, 'is')).map((x) => (x.localName === 't' ? x.textContent ?? '' : kids(x, 't').map((y) => y.textContent).join(''))).join(''); }
        else if (t === 'str' || t === 'e') text = raw;
        else if (t === 'b') text = raw === '1' ? 'TRUE' : 'FALSE';
        else if (raw !== '') {
          const v = Number(raw);
          if (Number.isFinite(v)) {
            isNum = true;
            const code = formats.get(xf.numFmtId) ?? BUILTIN[xf.numFmtId];
            if (code && code !== 'General' && isDateCode(code)) text = dateText(v, code, date1904);
            else if (code && code !== 'General') text = numberText(v, code);
            else text = general(v);
          } else text = raw;
        }
        raw = '';
        if (!text && !xf.fill) continue;
        if (!cells.has(pos.row)) cells.set(pos.row, new Map());
        cells.get(pos.row)!.set(pos.col, { text, xf, isNum, isText: !isNum });
        if (text) {
          minC = Math.min(minC, pos.col); maxC = Math.max(maxC, pos.col);
          minR = Math.min(minR, pos.row); maxR = Math.max(maxR, pos.row);
        }
      }
    }
    if (maxC < 0) continue; // an empty sheet

    // Column widths
    const widths: number[] = [];
    const defW = num(kid(root, 'sheetFormatPr'), 'defaultColWidth') ?? 8.43;
    for (let c = minC; c <= maxC; c++) widths[c] = defW;
    const hiddenCol = new Set<number>();
    for (const col of kids(kid(root, 'cols'), 'col')) {
      const a = (num(col, 'min') ?? 1) - 1;
      const b = Math.min((num(col, 'max') ?? a + 1) - 1, maxC);
      for (let c = Math.max(a, minC); c <= b; c++) {
        widths[c] = num(col, 'width') ?? defW;
        if (at(col, 'hidden') === '1' || at(col, 'hidden') === 'true') hiddenCol.add(c);
      }
    }
    // Merged ranges (across only; they are blank below)
    const spans = new Map<string, number>();
    const covered = new Set<string>();
    for (const m of kids(kid(root, 'mergeCells'), 'mergeCell')) {
      const [a, b] = (at(m, 'ref') ?? '').split(':');
      const p = colLetters(a); const q = colLetters(b ?? a);
      if (!p || !q) continue;
      spans.set(`${p.row}:${p.col}`, q.col - p.col + 1);
      for (let r = p.row; r <= q.row; r++) for (let c = p.col; c <= q.col; c++) if (r !== p.row || c !== p.col) covered.add(`${r}:${c}`);
    }
    const rowHeight = new Map<number, number>();
    for (const row of kids(kid(root, 'sheetData'), 'row')) {
      const h = num(row, 'ht');
      if (h && at(row, 'customHeight') !== '0') rowHeight.set((num(row, 'r') ?? 1) - 1, h);
    }

    grids.push({ name: sheet.name, cells, minC, maxC, minR, maxR, widths, defW, hiddenCol, spans, covered, rowHeight });
  }
  await renderGrids(grids, ctx);
}

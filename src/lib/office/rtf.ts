// Rich Text Format (.rtf): text with bold/italic/underline, sizes, colours, alignment and indents.
import type { RGB } from './color';
import type { Ctx } from './ctx';
import { familyOf, type Family } from './fonts';
import { type Block, defaultPara, Pager, type Para, type Run, type Table, type TCell } from './render';

interface State {
  bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  size: number; color: number; font: number; script: 'sup' | 'sub' | null;
  skip: boolean; uc: number;
}

const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf',
  'listtable', 'listoverridetable', 'generator', 'fldinst', 'footnote', 'object', 'themedata', 'colorschememapping', 'datastore', 'latentstyles',
  'rsidtbl', 'xmlnstbl', 'pgdsctbl', 'revtbl', 'private', 'bkmkstart', 'bkmkend', 'shpinst', 'shprslt', 'nonshppict', 'pn', 'pntext', 'pntxta', 'pntxtb',
]);

const STYLE_WORDS = new Set(['b', 'i', 'ul', 'uld', 'uldb', 'ulw', 'ulnone', 'strike', 'striked', 'super', 'sub', 'nosupersub', 'plain', 'f']);

export async function rtfToPdf(bytes: Uint8Array, ctx: Ctx): Promise<void> {
  const src = new TextDecoder('latin1').decode(bytes);
  let codepage = 'windows-1252';
  const cp = /\\ansicpg(\d+)/.exec(src.slice(0, 600));
  if (cp) codepage = `windows-${cp[1]}`;
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(codepage); } catch { decoder = new TextDecoder('windows-1252'); }

  const colors: RGB[] = []; // index 0 is the "automatic" entry, which the table leaves empty
  const fontFamily = new Map<number, Family>();
  const blocks: Block[] = [];
  const families = new Set<Family>(['sans']);
  let page = { w: 11906, h: 16838, l: 1800, r: 1800, t: 1440, b: 1440 };

  let state: State = { bold: false, italic: false, underline: false, strike: false, size: 22, color: 0, font: 0, script: null, skip: false, uc: 1 };
  const stack: State[] = [];
  let runs: Run[] = [];
  let text = '';
  const p = { align: 'l' as Para['align'], left: 0, first: 0, right: 0, before: 0, after: 0 };
  let colorBuild: { r?: number; g?: number; b?: number } | null = null;
  let fontEntry: { idx: number; name: string; level: number } | null = null;
  let fontTableLevel: number | null = null;
  // Tables: a row collects its cells (each a few paragraphs) until \row; rows in a run make one table.
  let row: { cells: TCell[]; bounds: number[]; border: boolean } | null = null;
  let cell: Block[] = [];
  let sink: Block[] = blocks;
  const closeCell = () => {
    if (runs.length || text) endPara();
    row?.cells.push({ blocks: cell, span: 1 });
    cell = [];
    sink = row ? cell : blocks;
  };

  const flushText = () => {
    if (!text) return;
    const fam = fontFamily.get(state.font);
    if (fam) families.add(fam);
    runs.push({
      text, bold: state.bold || undefined, italic: state.italic || undefined, underline: state.underline || undefined, strike: state.strike || undefined,
      size: state.size / 2, color: state.color > 0 ? colors[state.color] : undefined, family: fam, script: state.script ?? undefined,
    });
    text = '';
  };
  const endPara = () => {
    flushText();
    const size = runs.length ? Math.max(...runs.map((r) => r.size ?? 11)) : state.size / 2;
    sink.push(defaultPara({
      runs, size, align: p.align, left: p.left, first: p.first, right: p.right, before: p.before, after: p.after || 2,
    }));
    runs = [];
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '{') { flushText(); stack.push({ ...state }); i++; continue; }
    if (ch === '}') {
      if (fontEntry && stack.length === fontEntry.level) { fontFamily.set(fontEntry.idx, familyOf(fontEntry.name) ?? 'sans'); fontEntry = null; }
      if (colorBuild) colorBuild = null;
      flushText();
      state = stack.pop() ?? state;
      if (fontTableLevel !== null && stack.length < fontTableLevel) fontTableLevel = null;
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') { i++; continue; }
    if (ch !== '\\') {
      // plain text (or the name inside the font / colour tables)
      let j = i;
      while (j < n && src[j] !== '\\' && src[j] !== '{' && src[j] !== '}' && src[j] !== '\r' && src[j] !== '\n') j++;
      const chunk = src.slice(i, j);
      i = j;
      if (fontEntry || fontTableLevel !== null) { if (fontEntry && !state.skip) fontEntry.name += chunk.replace(/;.*$/, ''); continue; }
      if (colorBuild !== null) {
        // each ';' ends one colour
        for (const c of chunk) if (c === ';') { colors.push([(colorBuild.r ?? 0) / 255, (colorBuild.g ?? 0) / 255, (colorBuild.b ?? 0) / 255]); colorBuild = {}; }
        continue;
      }
      if (state.skip) continue;
      // the text is in the document's code page; bytes above 0x7f are decoded as it says
      text += /[\x80-\xff]/.test(chunk) ? decoder.decode(Uint8Array.from(chunk, (c) => c.charCodeAt(0))) : chunk;
      continue;
    }
    // a control word or symbol
    i++;
    const c = src[i];
    if (c === '\\' || c === '{' || c === '}') { if (!state.skip) text += c; i++; continue; }
    if (c === '\'') {
      const code = parseInt(src.slice(i + 1, i + 3), 16);
      i += 3;
      if (!state.skip && fontTableLevel === null && !Number.isNaN(code)) text += decoder.decode(Uint8Array.of(code));
      continue;
    }
    if (c === '*') { state.skip = true; i++; continue; }
    if (c === '~') { if (!state.skip) text += ' '; i++; continue; }
    if (c === '-' || c === '_') { if (!state.skip) text += c === '_' ? '-' : ''; i++; continue; }
    if (!/[a-zA-Z]/.test(c ?? '')) { i++; continue; }
    let j = i;
    while (j < n && /[a-zA-Z]/.test(src[j])) j++;
    const word = src.slice(i, j);
    let k = j;
    if (src[k] === '-') k++;
    while (k < n && /[0-9]/.test(src[k])) k++;
    const param = k > j ? parseInt(src.slice(j, k), 10) : null;
    i = src[k] === ' ' ? k + 1 : k;

    if (SKIP_DESTINATIONS.has(word) && word !== 'fonttbl' && word !== 'colortbl') { state.skip = true; continue; }
    if (word === 'fonttbl') { fontTableLevel = stack.length; continue; }
    if (word === 'colortbl') { colorBuild = {}; continue; }
    if (colorBuild) {
      if (word === 'red') colorBuild.r = param ?? 0;
      else if (word === 'green') colorBuild.g = param ?? 0;
      else if (word === 'blue') colorBuild.b = param ?? 0;
      continue;
    }
    if (word === 'f' && param !== null) {
      if (fontTableLevel !== null) fontEntry = { idx: param, name: '', level: stack.length }; // an entry of the font table
      else state.font = param; // a font switch in the text
      continue;
    }
    if (state.skip) continue;
    if (STYLE_WORDS.has(word)) flushText();
    switch (word) {
      case 'ansicpg': case 'deff': case 'rtf': case 'ansi': case 'mac': case 'pc': case 'pca': case 'fcharset': case 'fnil': case 'froman': case 'fswiss': case 'fmodern': case 'fscript': case 'fdecor': case 'ftech': case 'fbidi': case 'fprq': break;
      case 'uc': state.uc = param ?? 1; break;
      case 'u': {
        if (fontTableLevel !== null) break;
        const v = (param ?? 63) < 0 ? (param ?? 63) + 65536 : param ?? 63;
        text += String.fromCharCode(v);
        // the plain stand-in that follows is skipped
        for (let s = 0; s < state.uc; s++) {
          if (src[i] === '\\' && src[i + 1] === '\'') i += 4; else if (i < n && src[i] !== '\\' && src[i] !== '{' && src[i] !== '}') i++;
        }
        break;
      }
      case 'par': case 'sect': endPara(); break;
      case 'pard': p.align = 'l'; p.left = 0; p.first = 0; p.right = 0; p.before = 0; p.after = 0; break;
      case 'plain': state.bold = state.italic = state.underline = state.strike = false; state.script = null; state.size = 22; state.color = 0; break;
      case 'ql': p.align = 'l'; break;
      case 'qc': p.align = 'c'; break;
      case 'qr': p.align = 'r'; break;
      case 'qj': p.align = 'j'; break;
      case 'li': p.left = (param ?? 0) / 20; break;
      case 'ri': p.right = (param ?? 0) / 20; break;
      case 'fi': p.first = (param ?? 0) / 20; break;
      case 'sb': p.before = (param ?? 0) / 20; break;
      case 'sa': p.after = (param ?? 0) / 20; break;
      case 'b': state.bold = param !== 0; break;
      case 'i': state.italic = param !== 0; break;
      case 'ul': case 'uld': case 'uldb': case 'ulw': state.underline = param !== 0; break;
      case 'ulnone': state.underline = false; break;
      case 'strike': case 'striked': state.strike = param !== 0; break;
      case 'fs': flushText(); state.size = param ?? 22; break;
      case 'cf': flushText(); state.color = param ?? 0; break;
      case 'super': state.script = 'sup'; break;
      case 'sub': state.script = 'sub'; break;
      case 'nosupersub': state.script = null; break;
      case 'tab': text += '\t'; break;
      case 'line': text += '\n'; break;
      case 'emdash': text += '—'; break;
      case 'endash': text += '–'; break;
      case 'bullet': text += '•'; break;
      case 'lquote': text += '‘'; break;
      case 'rquote': text += '’'; break;
      case 'ldblquote': text += '“'; break;
      case 'rdblquote': text += '”'; break;
      case 'page': endPara(); break;
      case 'trowd': row = { cells: [], bounds: [], border: false }; cell = []; sink = cell; break;
      case 'cellx': row?.bounds.push((param ?? 0) / 20); break;
      case 'clbrdrt': case 'clbrdrb': case 'clbrdrl': case 'clbrdrr': if (row) row.border = true; break;
      case 'cell': if (row) closeCell(); else text += '\t'; break;
      case 'row': {
        if (!row) break;
        if (runs.length || text) closeCell();
        const widths = row.bounds.map((b, k) => Math.max(20, b - (row!.bounds[k - 1] ?? 0)));
        const prev = blocks[blocks.length - 1];
        const tr = { cells: row.cells };
        if (prev?.kind === 'table' && prev.cols.length === widths.length) prev.rows.push(tr);
        else blocks.push({ kind: 'table', cols: widths.length ? widths : row.cells.map(() => 100), rows: [tr], border: row.border, padX: 5, padY: 2, before: 2, after: 6 } satisfies Table);
        row = null; cell = []; sink = blocks;
        break;
      }
      case 'paperw': page.w = param ?? page.w; break;
      case 'paperh': page.h = param ?? page.h; break;
      case 'margl': page.l = param ?? page.l; break;
      case 'margr': page.r = param ?? page.r; break;
      case 'margt': page.t = param ?? page.t; break;
      case 'margb': page.b = param ?? page.b; break;
      default: break;
    }
  }
  endPara();
  // Trailing empty paragraphs add nothing.
  while (blocks.length && blocks[blocks.length - 1].kind === 'p' && !(blocks[blocks.length - 1] as Para).runs.some((r) => r.text.trim())) blocks.pop();
  if (!blocks.length) throw new Error('This RTF file has nothing in it.');

  await ctx.fonts.load(families);
  const w = Math.max(200, page.w / 20);
  const h = Math.max(200, page.h / 20);
  const pager = new Pager(() => ctx.doc.addPage([w, h]), w, h, { top: Math.max(24, page.t / 20), right: Math.max(24, page.r / 20), bottom: Math.max(24, page.b / 20), left: Math.max(24, page.l / 20) }, ctx.fonts);
  pager.start();
  pager.placeBlocks(blocks);
}

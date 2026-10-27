// Plain text, Markdown and CSV/TSV files.
import type { RGB } from './color';
import type { Ctx } from './ctx';
import { type Grid, type GridCell, renderGrids } from './sheets';
import type { PDFImage } from 'pdf-lib';
import { type Block, defaultPara, Pager, type Run } from './render';

/** Text from a file: UTF-8, or Windows Turkish/Western when it is not valid UTF-8. */
export async function readText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1254').decode(bytes);
  }
  return text.replace(/^﻿/, '');
}

const A4 = [595.28, 841.89] as const;
const MARGINS = { top: 54, right: 54, bottom: 54, left: 54 };

async function lay(ctx: Ctx, blocks: Block[]) {
  await ctx.fonts.load(['sans', 'mono']);
  const pager = new Pager(() => ctx.doc.addPage([...A4]), A4[0], A4[1], MARGINS, ctx.fonts);
  pager.start();
  pager.placeBlocks(blocks);
}

/** Text as it is typed: every line is a line. */
export async function plainToPdf(text: string, ctx: Ctx, mono: boolean): Promise<void> {
  const blocks: Block[] = text.replace(/\r\n?/g, '\n').split('\n').map((line) =>
    defaultPara({ size: mono ? 9.5 : 11, family: mono ? 'mono' : 'sans', runs: line ? [{ text: line.replace(/\t/g, '    ') }] : [], after: mono ? 0 : 3, lineMult: mono ? 1.05 : 1.1 }));
  await lay(ctx, blocks);
}

/** `**bold**`, `*italic*` and `` `code` `` in a line. */
function inline(text: string, base: Partial<Run> = {}): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) runs.push({ ...base, text: text.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith('**') || t.startsWith('__')) runs.push({ ...base, text: t.slice(2, -2), bold: true });
    else if (t.startsWith('`')) runs.push({ ...base, text: t.slice(1, -1), family: 'mono' });
    else if (t.startsWith('[')) { const mm = /\[([^\]]+)\]/.exec(t)!; runs.push({ ...base, text: mm[1], underline: true, color: [0.1, 0.3, 0.7] as RGB }); }
    else runs.push({ ...base, text: t.slice(1, -1), italic: true });
    last = m.index! + t.length;
  }
  if (last < text.length) runs.push({ ...base, text: text.slice(last) });
  return runs;
}

/** A picture kept inside a note (a data address) as something the PDF can hold; null when it cannot be read. */
async function embedPicture(ctx: Ctx, src: string): Promise<PDFImage | null> {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(src);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const mime = m[1].toLowerCase();
    if (mime === 'image/jpeg' || mime === 'image/jpg') return await ctx.doc.embedJpg(bytes);
    if (mime === 'image/png') return await ctx.doc.embedPng(bytes);
    // GIF, WebP and the like are redrawn as PNG.
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    return png ? await ctx.doc.embedPng(new Uint8Array(await png.arrayBuffer())) : null;
  } catch {
    return null;
  }
}

/** The width of the writing column of a typed note on screen, in pixels: a picture's saved width is measured against it. */
const NOTE_COLUMN_PX = 660;

/** Markdown: headings, lists, quotes, code blocks, rules, pictures and emphasis. */
export async function markdownToPdf(text: string, ctx: Ctx): Promise<void> {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const SIZES = [24, 20, 16, 14, 12, 11];
  const listItems = new WeakSet<Block>();
  let code: string[] | null = null;
  // A note's empty paragraphs are saved as blank lines in pairs; one blank line only separates two paragraphs.
  let blank = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!code && !line.trim()) { blank++; continue; }
    if (!code && blank > 2 && blocks.length) {
      for (let k = Math.floor((blank - 1) / 2); k > 0; k--) blocks.push(defaultPara({ after: 7, runs: [] }));
    }
    if (!code) blank = 0;
    if (/^\s*```/.test(line)) {
      if (code) {
        code.forEach((c) => blocks.push(defaultPara({ size: 9.5, family: 'mono', left: 10, runs: c ? [{ text: c }] : [], lineMult: 1.05, color: [0.15, 0.15, 0.2] as RGB })));
        blocks.push(defaultPara({ size: 4 }));
        code = null;
      } else code = [];
      continue;
    }
    if (code) { code.push(line.replace(/\t/g, '    ')); continue; }
    let m: RegExpExecArray | null;
    if ((m = /^\s*!\[[^\]]*\]\((\S+?)(?:\s+"([^"]*)")?\)\s*$/.exec(line))) {
      const image = await embedPicture(ctx, m[1]);
      if (image) {
        const saved = /^leafpage:w=(\d+)$/.exec(m[2] ?? '');
        const px = Math.min(saved ? Number(saved[1]) : image.width, NOTE_COLUMN_PX);
        const column = A4[0] - MARGINS.left - MARGINS.right;
        let w = (px / NOTE_COLUMN_PX) * column;
        let h = w * (image.height / image.width);
        const room = A4[1] - MARGINS.top - MARGINS.bottom - 8;
        if (h > room) { w *= room / h; h = room; }
        blocks.push({ kind: 'img', image, w, h, align: 'l', before: 4, after: 8 });
      }
    } else if ((m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line))) {
      const level = m[1].length;
      blocks.push(defaultPara({ size: SIZES[level - 1], before: level === 1 ? 6 : 10, after: 4, keepNext: true, runs: inline(m[2], { bold: true }) as Run[] }));
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(defaultPara({ size: 6, after: 6, runs: [{ text: '' }] }));
    } else if ((m = /^(\s*)([-*+])\s+(.*)$/.exec(line))) {
      const depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2);
      const todo = /^\[( |x|X)\]\s+(.*)$/.exec(m[3]);
      // The fonts have no ☐ or ☑, so an open box is □ and a done one is ▪ with its words struck through.
      if (todo) {
        const done = todo[1] !== ' ';
        const b = defaultPara({ left: 22 + depth * 16, first: -18, bullet: done ? '▪' : '□', after: 2, runs: inline(todo[2], done ? { strike: true, color: [0.45, 0.45, 0.5] as RGB } : {}) });
        listItems.add(b);
        blocks.push(b);
      } else {
        const b = defaultPara({ left: 18 + depth * 16, first: -12, bullet: depth ? '◦' : '•', after: 2, runs: inline(m[3]) });
        listItems.add(b);
        blocks.push(b);
      }
    } else if ((m = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line))) {
      const depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2);
      const b = defaultPara({ left: 22 + depth * 16, first: -18, bullet: `${m[2]}.`, after: 2, runs: inline(m[3]) });
      listItems.add(b);
      blocks.push(b);
    } else if ((m = /^\s*>\s?(.*)$/.exec(line))) {
      blocks.push(defaultPara({ left: 14, after: 3, color: [0.35, 0.35, 0.4] as RGB, runs: inline(m[1], { italic: true }) }));
    } else {
      // consecutive lines of a paragraph are joined, except where a line ends in two spaces or a backslash: that is a line break
      const hard = (l: string) => / {2,}$|\\$/.test(l);
      let para = line.trim().replace(/\\$/, '');
      let br = hard(line);
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(\s*([-*+]|\d+[.)])\s|#{1,6}\s|\s*>|\s*```)/.test(lines[i + 1])) {
        const next = lines[++i];
        para += (br ? '\n' : ' ') + next.trim().replace(/\\$/, '');
        br = hard(next);
      }
      blocks.push(defaultPara({ after: 7, runs: inline(para) }));
    }
  }
  if (code) code.forEach((c) => blocks.push(defaultPara({ size: 9.5, family: 'mono', left: 10, runs: c ? [{ text: c }] : [] })));
  // Whatever follows a list starts a little below its last item.
  blocks.forEach((b, k) => { if (listItems.has(b) && blocks[k + 1] && !listItems.has(blocks[k + 1])) (b as { after: number }).after = 8; });
  await lay(ctx, blocks);
}

/** Splits CSV text into rows of fields (quotes, doubled quotes, line breaks inside quotes). */
export function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"' && !field) quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
      if (rows.length > 20000) return rows;
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export async function csvToPdf(text: string, name: string, ctx: Ctx, tab: boolean): Promise<void> {
  const firstLine = text.slice(0, text.search(/\r|\n|$/));
  const delim = tab ? '\t' : [',', ';', '\t', '|'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows = parseCsv(text, delim);
  const cells = new Map<number, Map<number, GridCell>>();
  let maxC = 0;
  const widths: number[] = [];
  rows.forEach((r, ri) => {
    const line = new Map<number, GridCell>();
    r.slice(0, 200).forEach((v, ci) => {
      const t = v.trim();
      if (!t) return;
      const isNum = /^-?\d+([.,]\d+)?%?$/.test(t);
      line.set(ci, { text: t, isNum, isText: !isNum, xf: ri === 0 ? { bold: true, fill: [0.92, 0.92, 0.94] } : {} });
      maxC = Math.max(maxC, ci);
      widths[ci] = Math.min(40, Math.max(widths[ci] ?? 6, t.length * 1.1 + 2));
    });
    if (line.size) cells.set(ri, line);
  });
  if (!cells.size) throw new Error('This file has nothing in it.');
  const grid: Grid = {
    name, cells, minC: 0, maxC, minR: 0, maxR: rows.length - 1, widths, defW: 8.43, hiddenCol: new Set(), spans: new Map(), covered: new Set(), rowHeight: new Map(),
  };
  await renderGrids([grid], ctx);
}


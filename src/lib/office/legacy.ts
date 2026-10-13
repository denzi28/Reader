// The old binary Office formats (.doc, .xls, .ppt, 1997–2003). Text and numbers are read out of them;
// fonts, colours and layout of Word and PowerPoint files are not (Excel's number formats are).
import type { Ctx } from './ctx';
import type { Family } from './fonts';
import { type Block, defaultPara, Pager, paraAtoms, type Atom } from './render';
import { type Grid, type GridCell, renderGrids } from './sheets';
import { BUILTIN, dateText, general, isDateCode, numberText } from './xlsx';

async function streams(bytes: Uint8Array) {
  const mod = await import('cfb');
  const CFB = (mod as unknown as { default?: typeof import('cfb') }).default ?? (mod as unknown as typeof import('cfb'));
  let cf;
  try { cf = CFB.read(bytes, { type: 'array' }); } catch { throw new Error('This file could not be opened. It may be damaged or password-protected.'); }
  return (name: string): Uint8Array | null => {
    const e = CFB.find(cf, name) ?? CFB.find(cf, `/${name}`);
    const c = e?.content as unknown;
    return c ? (c instanceof Uint8Array ? c : Uint8Array.from(c as number[])) : null;
  };
}

const u16 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8);
const u32 = (d: Uint8Array, o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const f64 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset + o, 8).getFloat64(0, true);
const latin = (d: Uint8Array) => new TextDecoder('windows-1252').decode(d);
const utf16 = (d: Uint8Array) => new TextDecoder('utf-16le').decode(d);

// ---- .xls ------------------------------------------------------------------------------------
interface Rec { type: number; data: Uint8Array; pos: number }

function* records(wb: Uint8Array, from = 0): Generator<Rec> {
  let o = from;
  while (o + 4 <= wb.length) {
    const type = u16(wb, o);
    const len = u16(wb, o + 2);
    yield { type, data: wb.subarray(o + 4, o + 4 + len), pos: o };
    o += 4 + len;
  }
}

/** A string that may continue into following CONTINUE records (where its flag byte repeats). */
class Chunks {
  private i = 0;
  private o = 0;
  constructor(private parts: Uint8Array[]) {}
  get done() { return this.i >= this.parts.length; }
  private fix() { while (this.i < this.parts.length && this.o >= this.parts[this.i].length) { this.i++; this.o = 0; } }
  byte(): number { this.fix(); return this.i < this.parts.length ? this.parts[this.i][this.o++] : 0; }
  u16() { const a = this.byte(); return a | (this.byte() << 8); }
  u32() { const a = this.u16(); return (a | (this.u16() << 16)) >>> 0; }
  skip(n: number) { for (let k = 0; k < n; k++) this.byte(); }
  /** At the start of a chunk? (a string's characters that run on have a new flag byte first.) */
  get atChunkStart() { this.fix(); return this.o === 0 && this.i > 0; }
  string(): string {
    const cch = this.u16();
    const flags = this.byte();
    let wide = (flags & 1) !== 0;
    const rich = (flags & 8) !== 0 ? this.u16() : 0;
    const ext = (flags & 4) !== 0 ? this.u32() : 0;
    let s = '';
    for (let k = 0; k < cch; k++) {
      if (this.atChunkStart) wide = (this.byte() & 1) !== 0;
      s += String.fromCharCode(wide ? this.u16() : this.byte());
    }
    this.skip(rich * 4 + ext);
    return s;
  }
}

function rk(v: number): number {
  const integer = (v & 2) !== 0;
  let n: number;
  if (integer) n = (v >> 2);
  else {
    const b = new DataView(new ArrayBuffer(8));
    b.setUint32(4, (v & 0xfffffffc) >>> 0, true);
    n = b.getFloat64(0, true);
  }
  return v & 1 ? n / 100 : n;
}

export async function xlsToPdf(bytes: Uint8Array, ctx: Ctx): Promise<void> {
  const get = await streams(bytes);
  const wb = get('Workbook') ?? get('Book');
  if (!wb) throw new Error('This does not look like an Excel file.');

  // ---- the workbook part: sheets, strings, formats, styles
  const sheets: { name: string; offset: number }[] = [];
  const sst: string[] = [];
  const formats = new Map<number, string>();
  const xfs: { fmt: number; align: number; font: number }[] = [];
  const fonts: { size: number; bold: boolean; italic: boolean }[] = [];
  let date1904 = false;
  const list = [...records(wb)];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.type === 0x0085) {
      const d = r.data;
      const state = d[4];
      const kind = d[5];
      const cch = d[6];
      const wide = (d[7] & 1) !== 0;
      const name = wide ? utf16(d.subarray(8, 8 + cch * 2)) : latin(d.subarray(8, 8 + cch));
      if (state === 0 && kind === 0) sheets.push({ name, offset: u32(d, 0) });
    } else if (r.type === 0x00fc) {
      const parts = [r.data.subarray(8)];
      while (list[i + 1]?.type === 0x003c) parts.push(list[++i].data);
      const ch = new Chunks(parts);
      const total = u32(r.data, 4);
      for (let k = 0; k < total && !ch.done; k++) sst.push(ch.string());
    } else if (r.type === 0x041e) {
      formats.set(u16(r.data, 0), new Chunks([r.data.subarray(2)]).string());
    } else if (r.type === 0x00e0) {
      xfs.push({ font: u16(r.data, 0), fmt: u16(r.data, 2), align: r.data[6] & 7 });
    } else if (r.type === 0x0031) {
      fonts.push({ size: u16(r.data, 0) / 20, italic: (u16(r.data, 2) & 2) !== 0, bold: u16(r.data, 6) >= 700 });
    } else if (r.type === 0x0022) date1904 = u16(r.data, 0) === 1;
  }
  if (!sheets.length) throw new Error('This Excel file has no sheets to show.');

  const text = (v: number, fmtId: number) => {
    const code = formats.get(fmtId) ?? BUILTIN[fmtId];
    if (code && code !== 'General' && isDateCode(code)) return dateText(v, code, date1904);
    if (code && code !== 'General') return numberText(v, code);
    return general(v);
  };

  const grids: Grid[] = [];
  for (const sh of sheets) {
    const cells = new Map<number, Map<number, GridCell>>();
    const widths: number[] = [];
    const hiddenCol = new Set<number>();
    const spans = new Map<string, number>();
    const covered = new Set<string>();
    let minC = Infinity, maxC = -1, minR = Infinity, maxR = -1;
    let pendingString: { r: number; c: number; xf: number } | null = null;
    const put = (r: number, c: number, xfi: number, t: string, isNum: boolean) => {
      if (!t || r >= 20000 || c >= 200) return;
      const xf = xfs[xfi];
      const f = xf ? fonts[xf.font >= 4 ? xf.font - 1 : xf.font] : undefined;
      if (!cells.has(r)) cells.set(r, new Map());
      cells.get(r)!.set(c, {
        text: t, isNum, isText: !isNum,
        xf: { bold: f?.bold, italic: f?.italic, align: xf?.align === 1 ? 'left' : xf?.align === 2 ? 'center' : xf?.align === 3 ? 'right' : undefined },
      });
      minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    };
    let depth = 0;
    for (const r of records(wb, sh.offset)) {
      const d = r.data;
      if (r.type === 0x0809) { depth++; continue; }
      if (r.type === 0x000a) { if (--depth <= 0) break; continue; }
      if (depth !== 1) continue;
      switch (r.type) {
        case 0x00fd: { const s = sst[u32(d, 6)]; if (s !== undefined) put(u16(d, 0), u16(d, 2), u16(d, 4), s, false); break; }
        case 0x0204: put(u16(d, 0), u16(d, 2), u16(d, 4), new Chunks([d.subarray(6)]).string(), false); break;
        case 0x0203: { const v = f64(d, 6); put(u16(d, 0), u16(d, 2), u16(d, 4), text(v, xfs[u16(d, 4)]?.fmt ?? 0), true); break; }
        case 0x027e: { const v = rk(u32(d, 6)); put(u16(d, 0), u16(d, 2), u16(d, 4), text(v, xfs[u16(d, 4)]?.fmt ?? 0), true); break; }
        case 0x00bd: {
          const row = u16(d, 0);
          const first = u16(d, 2);
          const last = u16(d, d.length - 2);
          for (let c = first, o = 4; c <= last; c++, o += 6) { const xfi = u16(d, o); put(row, c, xfi, text(rk(u32(d, o + 2)), xfs[xfi]?.fmt ?? 0), true); }
          break;
        }
        case 0x0006: {
          const row = u16(d, 0), col = u16(d, 2), xfi = u16(d, 4);
          if (d[12] === 0xff && d[13] === 0xff) {
            if (d[6] === 0) pendingString = { r: row, c: col, xf: xfi };
            else if (d[6] === 1) put(row, col, xfi, d[8] ? 'TRUE' : 'FALSE', false);
          } else put(row, col, xfi, text(f64(d, 6), xfs[xfi]?.fmt ?? 0), true);
          break;
        }
        case 0x0207: if (pendingString) { put(pendingString.r, pendingString.c, pendingString.xf, new Chunks([d]).string(), false); pendingString = null; } break;
        case 0x0205: if (!d[7]) put(u16(d, 0), u16(d, 2), u16(d, 4), d[6] ? 'TRUE' : 'FALSE', false); break;
        case 0x007d: {
          const a = u16(d, 0), b = Math.min(u16(d, 2), 255);
          for (let c = a; c <= b; c++) { widths[c] = u16(d, 4) / 256; if (u16(d, 8) & 1) hiddenCol.add(c); }
          break;
        }
        case 0x00e5: {
          const n = u16(d, 0);
          for (let k = 0; k < n; k++) {
            const o = 2 + k * 8;
            const r0 = u16(d, o), r1 = u16(d, o + 2), c0 = u16(d, o + 4), c1 = u16(d, o + 6);
            spans.set(`${r0}:${c0}`, c1 - c0 + 1);
            for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) if (rr !== r0 || cc !== c0) covered.add(`${rr}:${cc}`);
          }
          break;
        }
        default: break;
      }
    }
    if (maxC < 0) continue;
    grids.push({ name: sh.name, cells, minC, maxC, minR, maxR, widths, defW: 8.43, hiddenCol, spans, covered, rowHeight: new Map() });
  }
  if (!grids.length) throw new Error('This Excel file has no data in it.');
  await renderGrids(grids, ctx);
}

// ---- .doc -------------------------------------------------------------------------------------
export async function docToPdf(bytes: Uint8Array, ctx: Ctx): Promise<void> {
  const get = await streams(bytes);
  const word = get('WordDocument');
  if (!word || u16(word, 0) !== 0xa5ec) throw new Error('This does not look like a Word file.');
  const flags = u16(word, 0x0a);
  if (flags & 0x0100) throw new Error('This Word file is password-protected.');
  const table = get(flags & 0x0200 ? '1Table' : '0Table');
  if (!table) throw new Error('This Word file could not be read.');
  const ccpText = u32(word, 0x4c);
  const fcClx = u32(word, 0x1a2);
  const lcbClx = u32(word, 0x1a6);
  let o = fcClx;
  const end = fcClx + lcbClx;
  while (o < end && table[o] === 1) o += 3 + u16(table, o + 1); // formatting changes are skipped
  if (table[o] !== 2) throw new Error('This Word file could not be read.');
  const plcLen = u32(table, o + 1);
  const plc = o + 5;
  const pieces = (plcLen - 4) / 12;
  let text = '';
  for (let k = 0; k < pieces; k++) {
    const cp0 = u32(table, plc + k * 4);
    const cp1 = u32(table, plc + (k + 1) * 4);
    const fc = u32(table, plc + (pieces + 1) * 4 + k * 8 + 2);
    const compressed = (fc & 0x40000000) !== 0;
    const n = Math.min(cp1, ccpText) - cp0;
    if (n <= 0) break;
    if (compressed) { const a = (fc & 0x3fffffff) >>> 1; text += latin(word.subarray(a, a + n)); }
    else text += utf16(word.subarray(fc, fc + n * 2));
  }
  // Fields keep their shown result; picture, drawing and field marks go.
  let out = '';
  let hidden = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c === 0x13) { hidden++; continue; }
    if (c === 0x14) { if (hidden) hidden--; continue; }
    if (c === 0x15) continue;
    if (hidden) continue;
    out += c === 0x07 ? '\t' : c === 0x0b ? '\n' : c === 0x01 || c === 0x08 || c < 9 && c !== 0 ? '' : ch;
  }
  const paras = out.replace(/\t\t(?=\r|$)/g, '').split(/\r/);
  const blocks: Block[] = paras.map((p) => defaultPara({ size: 11, after: 6, lineMult: 1.1, runs: p.replace(/\f/g, '') ? [{ text: p.replace(/\f/g, '') }] : [], pageBreakBefore: p.startsWith('\f') ? true : undefined }));
  if (!blocks.some((b) => b.kind === 'p' && b.runs.length)) throw new Error('This Word file has no text in it.');
  await ctx.fonts.load(['sans']);
  const pager = new Pager(() => ctx.doc.addPage([595.28, 841.89]), 595.28, 841.89, { top: 72, right: 72, bottom: 72, left: 72 }, ctx.fonts);
  pager.start();
  pager.placeBlocks(blocks);
}

// ---- .ppt -------------------------------------------------------------------------------------
export async function pptToPdf(bytes: Uint8Array, ctx: Ctx): Promise<void> {
  const get = await streams(bytes);
  const ppt = get('PowerPoint Document');
  if (!ppt) throw new Error('This does not look like a PowerPoint file.');
  let slideW = 720;
  let slideH = 540;
  interface Slide { items: { kind: number; text: string }[] }
  const slides: Slide[] = [];
  let cur: Slide | null = null;
  let lastKind = 1;
  let inSlides = false;
  const walk = (from: number, to: number) => {
    let o = from;
    while (o + 8 <= to) {
      const ver = ppt[o] & 0x0f;
      const inst = (u16(ppt, o) >> 4) & 0x0fff;
      const type = u16(ppt, o + 2);
      const len = u32(ppt, o + 4);
      const body = o + 8;
      if (type === 1001 && len >= 8) { slideW = u32(ppt, body) / 8; slideH = u32(ppt, body + 4) / 8; }
      if (ver === 0x0f) {
        if (type === 4080) { inSlides = inst === 0; if (inSlides) walk(body, body + len); inSlides = false; }
        else if (type === 1000 || type === 1033) walk(body, Math.min(body + len, to));
      } else if (inSlides) {
        if (type === 1011) { cur = { items: [] }; slides.push(cur); }
        else if (type === 3999) lastKind = u32(ppt, body);
        else if (type === 4000 && cur) cur.items.push({ kind: lastKind, text: utf16(ppt.subarray(body, body + len)) });
        else if (type === 4008 && cur) cur.items.push({ kind: lastKind, text: latin(ppt.subarray(body, body + len)) });
      }
      o = body + len;
    }
  };
  walk(0, ppt.length);
  // Text boxes drawn on the slides themselves (how LibreOffice and newer PowerPoints keep it).
  const deep = (from: number, to: number, into: Slide) => {
    let o = from;
    let kind = 1;
    while (o + 8 <= to) {
      const ver = ppt[o] & 0x0f;
      const type = u16(ppt, o + 2);
      const len = u32(ppt, o + 4);
      const body = o + 8;
      if (ver === 0x0f) deep(body, Math.min(body + len, to), into);
      else if (type === 3999) kind = u32(ppt, body);
      else if (type === 4000) into.items.push({ kind, text: utf16(ppt.subarray(body, body + len)) });
      else if (type === 4008) into.items.push({ kind, text: latin(ppt.subarray(body, body + len)) });
      o = body + len;
    }
  };
  const drawn: Slide[] = [];
  for (let o = 0; o + 8 <= ppt.length;) {
    const type = u16(ppt, o + 2);
    const len = u32(ppt, o + 4);
    if (type === 1006) { const sl: Slide = { items: [] }; deep(o + 8, o + 8 + len, sl); drawn.push(sl); }
    o += 8 + len;
  }
  const listed = slides.splice(0, slides.length);
  slides.push(...(drawn.some((d) => d.items.length) ? drawn : listed));
  if (!slides.some((sl) => sl.items.some((it) => it.text.trim()))) throw new Error('This PowerPoint file has no text on its slides.');
  await ctx.fonts.load(['sans'] as Family[]);
  for (const s of slides) {
    const page = ctx.doc.addPage([slideW, slideH]);
    const margin = slideW * 0.06;
    const width = slideW - 2 * margin;
    let y = slideH * 0.06;
    const draw = (atoms: Atom[], x: number) => { atoms.forEach((a, i) => { if (i) y += a.pre; a.draw({ page, pageH: slideH }, x, y); y += a.h + a.post; }); };
    const titles = s.items.filter((it) => it.kind === 0 || it.kind === 6);
    const rest = s.items.filter((it) => it.kind !== 0 && it.kind !== 6);
    const fit = (size: number) => Math.max(10, Math.min(size, slideH / 18));
    for (const t of titles) {
      draw(paraAtoms(defaultPara({ size: fit(34), runs: [{ text: t.text.replace(/[\r\v]+/g, ' ').trim(), bold: true }], align: 'c', after: 10 }), width, ctx.fonts), margin);
    }
    y = Math.max(y, slideH * 0.26);
    for (const t of rest) {
      for (const line of t.text.split(/[\r\v]/).filter((l) => l.trim())) {
        const lead = /^\t+/.exec(line)?.[0].length ?? 0;
        draw(paraAtoms(defaultPara({ size: fit(22 - lead * 2), runs: [{ text: line.trim() }], left: 22 + lead * 20, first: -16, bullet: lead ? '–' : '•', after: 5 }), width, ctx.fonts), margin);
      }
    }
  }
}

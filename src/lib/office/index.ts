// Documents of other kinds (Word, Excel, PowerPoint, OpenDocument, RTF, text, CSV, pictures, and the
// old Office formats) are turned into PDFs right on the device, so the rest of the app (reading,
// ink, notes, sync) treats them like any other document.
import { Pack } from './pack';
import { t as tl } from '../i18n';

import { EXT, type OfficeKind } from '../fileTypes';

export type { OfficeKind };

const NOT_YET: Record<string, string> = { heic: tl('HEIC pictures'), heif: tl('HEIC pictures'), epub: tl('EPUB books'), pages: tl('Pages documents'), numbers: tl('Numbers sheets'), key: tl('Keynote presentations'), xlsb: tl('Excel binary workbooks'), html: tl('Web pages'), htm: tl('Web pages') };

const extension = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';

/** What kind of document this is, going by its name (and, for pictures, its type). */
export function officeKind(file: { name: string; type?: string }): OfficeKind | null {
  const k = EXT[extension(file.name)];
  if (k) return k;
  if (file.type?.startsWith('image/') && /^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(file.type)) return 'image';
  return null;
}

/** A readable explanation when the file is a format that cannot be opened (null when it is just unknown). */
export function unsupportedReason(file: { name: string }): string | null {
  const what = NOT_YET[extension(file.name)];
  if (!what) return null;
  return tl('{what} cannot be opened yet. Save or export it as a PDF (or a Word, Excel or PowerPoint file) and add that instead.', { what });
}

const LABEL: Partial<Record<OfficeKind, string>> = {
  docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', odt: tl('OpenDocument text'), ods: tl('OpenDocument spreadsheet'), odp: tl('OpenDocument presentation'),
  rtf: 'RTF', doc: 'Word', xls: 'Excel', ppt: 'PowerPoint',
};

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;
const isCfb = (b: Uint8Array) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

/** Makes a PDF out of the file. The same file always gives the same PDF. */
export async function convertOffice(file: File): Promise<File> {
  const kind = officeKind(file);
  if (!kind) throw new Error(tl('This kind of file cannot be opened.'));
  const base = file.name.replace(/\.[^.]+$/, '') || 'Document';
  const { makeCtx } = await import('./ctx');
  const ctx = await makeCtx(base);
  const invalid = () => new Error(LABEL[kind] ? tl('This does not look like a valid {kind} file.', { kind: LABEL[kind]! }) : tl('This does not look like a valid file.'));

  if (kind === 'image') {
    await (await import('./images')).imageToPdf(file, ctx);
  } else if (kind === 'text' || kind === 'code' || kind === 'markdown' || kind === 'csv' || kind === 'tsv') {
    const t = await import('./text');
    const text = await t.readText(file);
    if (!text.trim()) throw new Error(tl('This file has nothing in it.'));
    if (kind === 'markdown') await t.markdownToPdf(text, ctx);
    else if (kind === 'csv' || kind === 'tsv') await t.csvToPdf(text, base, ctx, kind === 'tsv');
    else await t.plainToPdf(text, ctx, kind === 'code');
  } else {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (kind === 'rtf') {
      if (!new TextDecoder('latin1').decode(bytes.slice(0, 8)).startsWith('{\\rtf')) throw invalid();
      await (await import('./rtf')).rtfToPdf(bytes, ctx);
    } else if (kind === 'doc' || kind === 'xls' || kind === 'ppt') {
      if (!isCfb(bytes)) throw invalid();
      const legacy = await import('./legacy');
      if (kind === 'doc') await legacy.docToPdf(bytes, ctx);
      else if (kind === 'xls') await legacy.xlsToPdf(bytes, ctx);
      else await legacy.pptToPdf(bytes, ctx);
    } else {
      if (!isZip(bytes)) throw invalid();
      const pack = new Pack(bytes);
      if (kind === 'docx') await (await import('./docx')).docxToPdf(pack, ctx);
      else if (kind === 'xlsx') await (await import('./xlsx')).xlsxToPdf(pack, ctx);
      else if (kind === 'pptx') await (await import('./pptx')).pptxToPdf(pack, ctx);
      else {
        const odf = await import('./odf');
        if (kind === 'odt') await odf.odtToPdf(pack, ctx);
        else if (kind === 'ods') await odf.odsToPdf(pack, ctx);
        else await odf.odpToPdf(pack, ctx);
      }
    }
  }
  if (ctx.doc.getPageCount() === 0) ctx.doc.addPage([595.28, 841.89]);
  const out = await ctx.doc.save({ useObjectStreams: true });
  return new File([out as BlobPart], `${base}.pdf`, { type: 'application/pdf' });
}

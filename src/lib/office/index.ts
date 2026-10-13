// Word, Excel and PowerPoint files are turned into PDFs right on the device, so the rest of the
// app (reading, ink, notes, sync) treats them like any other document.
import { Pack } from './pack';

export type OfficeKind = 'docx' | 'xlsx' | 'pptx';

const MODERN: Record<string, OfficeKind> = {
  docx: 'docx', docm: 'docx', dotx: 'docx', dotm: 'docx',
  xlsx: 'xlsx', xlsm: 'xlsx', xltx: 'xlsx', xltm: 'xlsx',
  pptx: 'pptx', pptm: 'pptx', potx: 'pptx', potm: 'pptx', ppsx: 'pptx', ppsm: 'pptx',
};
const OLD: Record<string, string> = { doc: 'Word', xls: 'Excel', ppt: 'PowerPoint', odt: 'OpenDocument', ods: 'OpenDocument', odp: 'OpenDocument', rtf: 'Rich Text' };

const extension = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';

/** What kind of Office file this is, going by its name. */
export function officeKind(file: { name: string }): OfficeKind | null {
  return MODERN[extension(file.name)] ?? null;
}

/** A readable explanation when the file is a format that cannot be opened (null when it is just unknown). */
export function unsupportedReason(file: { name: string }): string | null {
  const old = OLD[extension(file.name)];
  if (!old) return null;
  return old === 'OpenDocument' || old === 'Rich Text'
    ? `${old} files cannot be opened yet. Save it as a PDF or as a Word, Excel or PowerPoint file (.docx, .xlsx, .pptx) and add that instead.`
    : `This is an old ${old} format. Open it in ${old} and use Save As to keep it as a ${extension(file.name) === 'doc' ? '.docx' : extension(file.name) === 'xls' ? '.xlsx' : '.pptx'} file, then add that.`;
}

/** Makes a PDF out of an Office file. The same file always gives the same PDF. */
export async function convertOffice(file: File): Promise<File> {
  const kind = officeKind(file);
  if (!kind) throw new Error('This kind of file cannot be opened.');
  const base = file.name.replace(/\.[^.]+$/, '') || 'Document';
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`This does not look like a valid ${kind === 'docx' ? 'Word' : kind === 'xlsx' ? 'Excel' : 'PowerPoint'} file.`);
  }
  const pack = new Pack(bytes);
  const { makeCtx } = await import('./ctx');
  const ctx = await makeCtx(base);
  if (kind === 'docx') await (await import('./docx')).docxToPdf(pack, ctx);
  else if (kind === 'xlsx') await (await import('./xlsx')).xlsxToPdf(pack, ctx);
  else await (await import('./pptx')).pptxToPdf(pack, ctx);
  if (ctx.doc.getPageCount() === 0) ctx.doc.addPage([595.28, 841.89]);
  const out = await ctx.doc.save({ useObjectStreams: true });
  return new File([out as BlobPart], `${base}.pdf`, { type: 'application/pdf' });
}

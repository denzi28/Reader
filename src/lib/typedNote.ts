import { fileId } from './hash';
import { t } from './i18n';
import { assertRoom } from './plan';
import { getDocFile, getMeta, markPdfChanged, patchMeta, putDocFile, requestPersistence, saveDoc } from './storage';
import type { DocMeta } from './types';

/** A typed note is Markdown text, kept in the same slot as a PDF and sent to Drive like one. */
export const NOTE_TYPE = 'text/markdown';

export const wordCount = (md: string) => (md.replace(/!\[[^\]]*\]\([^)]*\)|<img[^>]*>/g, ' ').match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;

/** The first lines of a note in plain words, for lists. */
export const previewOf = (md: string) =>
  md.replace(/<img[^>]*>|!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/^\s{0,3}(#{1,6}|[-*+]|>|\d+\.)\s+(\[[ xX]\]\s+)?/gm, '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);

/** Makes an empty typed note, filed in `folder`. */
export async function createTypedNote(name: string, folder?: string, attached?: DocMeta['attached']): Promise<DocMeta> {
  if (!attached) await assertRoom(); // the free plan keeps a few documents (a note made for a page is not counted)
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  const id = await fileId(seed.buffer);
  const now = Date.now();
  const text = '';
  const meta: DocMeta = {
    id,
    name: name.trim() || t('Untitled note'),
    kind: 'note',
    size: 0,
    pages: 1,
    words: 0,
    preview: '',
    addedAt: now,
    openedAt: now,
    lastPage: 0,
    folder,
    ...(attached ? { attached } : {}),
    thumb: await noteThumbnail(name, text).catch(() => undefined),
  };
  await saveDoc(meta, new Blob([text], { type: NOTE_TYPE }));
  requestPersistence();
  return meta;
}

export async function readNote(id: string): Promise<string | null> {
  const file = await getDocFile(id);
  return file ? file.text() : null;
}

/** Keeps the words (and, for the shelf, the count and a fresh picture of the first lines). */
export async function saveNote(id: string, markdown: string, options: { thumb?: boolean } = {}) {
  const meta = await getMeta(id);
  if (!meta || meta.deleted) return;
  // Only words that really changed are sent again: a note just opened and closed must not look edited to sync.
  const before = await getDocFile(id);
  const changed = !before || (await before.text()) !== markdown;
  const patch: Partial<DocMeta> = {};
  if (changed) {
    await putDocFile(id, new Blob([markdown], { type: NOTE_TYPE }));
    await markPdfChanged(id); // before the change is announced, so sync sends the file with it
    Object.assign(patch, { size: new Blob([markdown]).size, words: wordCount(markdown), preview: previewOf(markdown) });
  } else if (!options.thumb || meta.thumb) {
    return; // nothing new to keep
  }
  if (options.thumb) patch.thumb = await noteThumbnail(meta.name, markdown).catch(() => meta.thumb);
  await patchMeta(id, patch);
}

/** The shelf picture of a note: a sheet of paper with its title and first lines. */
export async function noteThumbnail(title: string, markdown: string): Promise<Blob> {
  const W = 240;
  const H = 320;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#fffaf0';
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#2b241a';
  c.font = '700 19px Inter, system-ui, sans-serif';
  c.textBaseline = 'top';
  let y = 22;
  const wrap = (text: string, max: number, lines: number) => {
    const words = text.split(/\s+/);
    const out: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (c.measureText(next).width > max && line) { out.push(line); line = w; } else line = next;
      if (out.length >= lines) break;
    }
    if (line && out.length < lines) out.push(line);
    return out;
  };
  for (const line of wrap(title || t('Untitled note'), W - 40, 2)) { c.fillText(line, 20, y); y += 25; }
  y += 8;
  c.fillStyle = '#6a5c45';
  c.font = '400 12.5px Inter, system-ui, sans-serif';
  const plain = markdown
    .replace(/<img[^>]*>|!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|>|\d+\.)\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/[*_`~]/g, '');
  const paragraphs = plain.split(/\n+/).filter((p) => p.trim());
  for (const p of paragraphs) {
    for (const line of wrap(p, W - 40, 3)) {
      if (y > H - 24) break;
      c.fillText(line, 20, y);
      y += 17;
    }
    y += 5;
    if (y > H - 24) break;
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no thumbnail'))), 'image/jpeg', 0.85));
}

/** Two devices typed in the same note: the other version becomes a note of its own, so nothing is lost. */
export async function keepOtherVersion(id: string, theirs: string, mine: string) {
  if (!theirs.trim() || theirs === mine) return;
  const meta = await getMeta(id);
  if (!meta) return;
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  const copy = await fileId(seed.buffer);
  const now = Date.now();
  const name = t('{name} (other device)', { name: meta.name });
  await saveDoc(
    { id: copy, name, kind: 'note', size: new Blob([theirs]).size, pages: 1, words: wordCount(theirs), addedAt: now, openedAt: now, lastPage: 0, folder: meta.folder, thumb: await noteThumbnail(name, theirs).catch(() => undefined) },
    new Blob([theirs], { type: NOTE_TYPE }),
  );
}

/** The shelf picture again (after the note was renamed, say). */
export async function refreshNoteThumb(id: string) {
  const meta = await getMeta(id);
  const text = await readNote(id);
  if (!meta || text === null) return;
  await patchMeta(id, { thumb: await noteThumbnail(meta.name, text).catch(() => meta.thumb) });
}

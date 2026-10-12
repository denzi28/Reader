import { createStore, del, get, getMany, keys, set } from 'idb-keyval';
import type { DocInk, DocMeta } from './types';

const store = createStore('reader', 'keyval');

const metaKey = (id: string) => `meta:${id}`;
const fileKey = (id: string) => `file:${id}`;
const inkKey = (id: string) => `ink:${id}`;

export async function listDocs(): Promise<DocMeta[]> {
  const all = await keys<string>(store);
  const metaKeys = all.filter((k) => k.startsWith('meta:'));
  const metas = (await getMany<DocMeta | undefined>(metaKeys, store)).filter(
    (m): m is DocMeta => Boolean(m),
  );
  return metas.sort((a, b) => b.openedAt - a.openedAt);
}

export function getMeta(id: string) {
  return get<DocMeta>(metaKey(id), store);
}

export async function saveDoc(meta: DocMeta, file: Blob) {
  await set(fileKey(meta.id), file, store);
  await set(metaKey(meta.id), meta, store);
}

export async function patchMeta(id: string, patch: Partial<DocMeta>) {
  const current = await getMeta(id);
  if (current) await set(metaKey(id), { ...current, ...patch }, store);
}

export function getDocFile(id: string) {
  return get<Blob>(fileKey(id), store);
}

export async function deleteDoc(id: string) {
  await Promise.all([
    del(metaKey(id), store),
    del(fileKey(id), store),
    del(inkKey(id), store),
  ]);
}

export async function loadInk(id: string): Promise<DocInk> {
  return (await get<DocInk>(inkKey(id), store)) ?? {};
}

export function saveInk(id: string, ink: DocInk) {
  const nonEmpty: DocInk = {};
  for (const [page, strokes] of Object.entries(ink)) {
    if (strokes.length) nonEmpty[Number(page)] = strokes;
  }
  return set(inkKey(id), nonEmpty, store);
}

/** Ask the browser not to evict our data under storage pressure. */
export function requestPersistence() {
  void navigator.storage?.persist?.();
}

import { createStore, del, get, getMany, keys, set } from 'idb-keyval';
import { applyEdit, inkFromLog, logFromInk, mergeLogs } from './inkLog';
import type { DocInk, DocMeta, InkLog, Stroke } from './types';

const store = createStore('reader', 'keyval');

const metaKey = (id: string) => `meta:${id}`;
const fileKey = (id: string) => `file:${id}`;
const legacyInkKey = (id: string) => `ink:${id}`;
const logKey = (id: string) => `inklog:${id}`;

// ---- change notifications (sync listens to these) ---------------------
type ChangeKind = 'meta' | 'ink';
const listeners = new Set<(id: string, kind: ChangeKind) => void>();
export function onLocalChange(fn: (id: string, kind: ChangeKind) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = (id: string, kind: ChangeKind) => listeners.forEach((fn) => fn(id, kind));

// ---- documents --------------------------------------------------------
/** Every document record, including deletion markers; newest first. */
export async function listAllMeta(): Promise<DocMeta[]> {
  const all = await keys<string>(store);
  const metaKeys = all.filter((k) => k.startsWith('meta:'));
  const metas = (await getMany<DocMeta | undefined>(metaKeys, store)).filter(
    (m): m is DocMeta => Boolean(m),
  );
  return metas.sort((a, b) => b.openedAt - a.openedAt);
}

export async function listDocs(): Promise<DocMeta[]> {
  return (await listAllMeta()).filter((m) => !m.deleted);
}

export function getMeta(id: string) {
  return get<DocMeta>(metaKey(id), store);
}

export async function saveDoc(meta: DocMeta, file: Blob) {
  await set(fileKey(meta.id), file, store);
  await set(metaKey(meta.id), { updatedAt: Date.now(), ...meta }, store);
  notify(meta.id, 'meta');
}

/** A change the user made; it is stamped so it wins over older copies. */
export async function patchMeta(id: string, patch: Partial<DocMeta>) {
  const current = await getMeta(id);
  if (!current) return;
  await set(metaKey(id), { ...current, ...patch, updatedAt: Date.now() }, store);
  notify(id, 'meta');
}

/** Writes a record as-is (used by sync; never triggers another sync). */
export function putMeta(meta: DocMeta) {
  return set(metaKey(meta.id), meta, store);
}

export function getDocFile(id: string) {
  return get<Blob>(fileKey(id), store);
}

export function putDocFile(id: string, file: Blob) {
  return set(fileKey(id), file, store);
}

/** Removes a document's data but keeps a marker, so sync removes it everywhere. */
export async function deleteDoc(id: string) {
  const current = await getMeta(id);
  dropInkCache(id);
  await Promise.all([del(fileKey(id), store), del(logKey(id), store), del(legacyInkKey(id), store)]);
  if (current) {
    await set(metaKey(id), { ...current, thumb: undefined, deleted: true, updatedAt: Date.now() }, store);
    notify(id, 'meta');
  }
}

/** Applies a deletion that came from another device. */
export async function wipeDoc(id: string, marker: DocMeta) {
  dropInkCache(id);
  await Promise.all([del(fileKey(id), store), del(logKey(id), store), del(legacyInkKey(id), store)]);
  await set(metaKey(id), { ...marker, thumb: undefined, deleted: true }, store);
}

// ---- ink ----------------------------------------------------------------
// Each document's ink log is cached in memory and written back shortly after
// a change, so drawing never waits on the database.
const inkCache = new Map<string, { log: InkLog; timer: number }>();

async function cachedLog(id: string) {
  let entry = inkCache.get(id);
  if (!entry) {
    let log = await get<InkLog>(logKey(id), store);
    if (!log) {
      const legacy = await get<DocInk>(legacyInkKey(id), store);
      log = legacy ? logFromInk(legacy) : {};
    }
    entry = inkCache.get(id) ?? { log, timer: 0 }; // another call may have won
    inkCache.set(id, entry);
  }
  return entry;
}

/** Forgets a document's cached ink, cancelling a write that would revive it. */
function dropInkCache(id: string) {
  clearTimeout(inkCache.get(id)?.timer);
  inkCache.delete(id);
}

function scheduleWrite(id: string) {
  const entry = inkCache.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = window.setTimeout(() => {
    entry.timer = 0;
    void set(logKey(id), entry.log, store);
  }, 300);
}

function flushInk() {
  inkCache.forEach((entry, id) => {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = 0;
      void set(logKey(id), entry.log, store);
    }
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushInk);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushInk();
  });
}

export async function loadInk(id: string): Promise<DocInk> {
  return inkFromLog((await cachedLog(id)).log);
}

export async function getInkLog(id: string): Promise<InkLog> {
  return (await cachedLog(id)).log;
}

/** Records a stroke drawn, erased, undone or redone on one page. */
export async function recordInkEdit(id: string, page: number, prev: Stroke[], next: Stroke[]) {
  const entry = await cachedLog(id);
  applyEdit(entry.log, page, prev, next, Date.now());
  scheduleWrite(id);
  notify(id, 'ink');
}

/** Folds in another device's log. Returns the new ink if anything changed. */
export async function mergeInk(id: string, remote: InkLog): Promise<DocInk | null> {
  const entry = await cachedLog(id);
  const { log, changed } = mergeLogs(entry.log, remote);
  if (!changed) return null;
  entry.log = log;
  scheduleWrite(id);
  return inkFromLog(log);
}

// ---- sync bookkeeping -------------------------------------------------
/** What this device last saw in Drive and last sent there, per document. */
export interface SyncRecord {
  metaSeen?: string;
  metaPushed?: number;
  inkSeen?: string;
  inkPushed?: number;
  thumbSeen?: string;
}
const syncKey = (id: string) => `sync:${id}`;

export async function getSyncRecord(id: string): Promise<SyncRecord> {
  return (await get<SyncRecord>(syncKey(id), store)) ?? {};
}

export function putSyncRecord(id: string, rec: SyncRecord) {
  return set(syncKey(id), rec, store);
}

export async function clearSyncRecords() {
  const all = await keys<string>(store);
  await Promise.all(all.filter((k) => k.startsWith('sync:')).map((k) => del(k, store)));
}

/** Ask the browser not to evict our data under storage pressure. */
export function requestPersistence() {
  void navigator.storage?.persist?.();
}

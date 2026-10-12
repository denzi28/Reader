import { clear, createStore, del, get, getMany, keys, set, update, type UseStore } from 'idb-keyval';
import { cleanFolderName, mergeFolderLogs } from './folders';
import { applyEdit, inkFromLog, logFromInk, mergeLogs } from './inkLog';
import type { DocInk, DocMeta, Folder, FolderLog, InkLog, Stroke } from './types';

// ---- one separate library per account ---------------------------------
// Every Google account gets its own database on the device, and so does use
// without an account ("guest"). Documents, ink and sync records never cross
// between them, so signing in as someone else never shows or uploads the
// previous person's documents.
const GUEST_SPACE = 'reader';
const guestStore = createStore(GUEST_SPACE, 'keyval');
let space = GUEST_SPACE;
let store: UseStore = guestStore;

/** The database name for an account (a hash of its email, not the email). */
export function accountSpace(email: string | undefined) {
  const text = (email ?? 'unknown').trim().toLowerCase();
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b + text.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `reader-${a.toString(16)}${b.toString(16)}`;
}

export const currentSpace = () => space;

/** Switches to another account's library (null: no account). True if it changed. */
export function switchSpace(name: string | null) {
  const next = name ?? GUEST_SPACE;
  if (next === space) return false;
  flushInk();
  inkCache.clear();
  space = next;
  store = next === GUEST_SPACE ? guestStore : createStore(next, 'keyval');
  return true;
}

/** Removes everything the current account keeps on this device. */
export async function clearSpace() {
  inkCache.forEach((e) => clearTimeout(e.timer));
  inkCache.clear();
  await clear(store);
}

const metaKey = (id: string) => `meta:${id}`;
const fileKey = (id: string) => `file:${id}`;
const legacyInkKey = (id: string) => `ink:${id}`;
const logKey = (id: string) => `inklog:${id}`;
const sizesKey = (id: string) => `sizes:${id}`;
const FOLDERS_KEY = 'folders';

// ---- change notifications (sync listens to these) ---------------------
type ChangeKind = 'meta' | 'ink' | 'folders';
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
  // One read-and-write step, so two quick changes (say, the page being read
  // and the time it was opened) can't overwrite each other.
  if (!(await getMeta(id))) return; // (update would otherwise store an empty record)
  await update<DocMeta>(metaKey(id), (current) => ({ ...current!, ...patch, updatedAt: Date.now() }), store);
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
  await Promise.all([fileKey(id), logKey(id), legacyInkKey(id), sizesKey(id)].map((k) => del(k, store)));
  if (current) {
    await set(metaKey(id), { ...current, thumb: undefined, deleted: true, updatedAt: Date.now() }, store);
    notify(id, 'meta');
  }
}

/** Applies a deletion that came from another device. */
export async function wipeDoc(id: string, marker: DocMeta) {
  dropInkCache(id);
  await Promise.all([fileKey(id), logKey(id), legacyInkKey(id), sizesKey(id)].map((k) => del(k, store)));
  await set(metaKey(id), { ...marker, thumb: undefined, deleted: true }, store);
}

// ---- page sizes (this device only; they let a document lay out at once) ----
export function getPageSizes(id: string) {
  return get<{ w: number; h: number }[]>(sizesKey(id), store);
}

export function putPageSizes(id: string, sizes: { w: number; h: number }[]) {
  return set(sizesKey(id), sizes, store);
}

// ---- folders ------------------------------------------------------------
export async function getFolderLog(): Promise<FolderLog> {
  return (await get<FolderLog>(FOLDERS_KEY, store)) ?? {};
}

function editFolders(edit: (log: FolderLog) => FolderLog) {
  return update<FolderLog>(FOLDERS_KEY, (log) => edit(log ?? {}), store);
}

export async function createFolder(name: string): Promise<Folder> {
  const now = Date.now();
  const folder: Folder = {
    id: `f${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    name: cleanFolderName(name) || 'Untitled folder',
    createdAt: now,
    updatedAt: now,
  };
  await editFolders((log) => ({ ...log, [folder.id]: folder }));
  notify(FOLDERS_KEY, 'folders');
  return folder;
}

export async function renameFolder(id: string, name: string) {
  const clean = cleanFolderName(name);
  if (!clean) return;
  await editFolders((log) =>
    log[id] ? { ...log, [id]: { ...log[id], name: clean, updatedAt: Date.now() } } : log);
  notify(FOLDERS_KEY, 'folders');
}

/** Removes a folder. Its documents stay, back on the shelf. */
export async function deleteFolder(id: string) {
  await editFolders((log) =>
    log[id] ? { ...log, [id]: { ...log[id], deleted: 1, updatedAt: Date.now() } } : log);
  notify(FOLDERS_KEY, 'folders');
}

/** Folds in another device's folders (used by sync). True if anything changed. */
export async function mergeFolders(remote: FolderLog) {
  let changed = false;
  await editFolders((log) => {
    const merged = mergeFolderLogs(log, remote);
    changed = merged.changed;
    return merged.log;
  });
  return changed;
}

/** Files documents in a folder (null: back on the shelf). */
export async function moveDocs(ids: string[], folder: string | null) {
  for (const id of ids) await patchMeta(id, { folder: folder ?? undefined });
}

// ---- ink ----------------------------------------------------------------
// Each document's ink log is cached in memory and written back shortly after
// a change, so drawing never waits on the database.
const inkCache = new Map<string, { log: InkLog; timer: number; store: UseStore }>();

async function cachedLog(id: string) {
  let entry = inkCache.get(id);
  if (!entry) {
    let log = await get<InkLog>(logKey(id), store);
    if (!log) {
      const legacy = await get<DocInk>(legacyInkKey(id), store);
      log = legacy ? logFromInk(legacy) : {};
    }
    entry = inkCache.get(id) ?? { log, timer: 0, store }; // another call may have won
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
    void set(logKey(id), entry.log, entry.store);
  }, 300);
}

function flushInk() {
  inkCache.forEach((entry, id) => {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = 0;
      void set(logKey(id), entry.log, entry.store);
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

// ---- bringing documents made without an account into one -----------------
export async function guestDocs(): Promise<DocMeta[]> {
  if (space === GUEST_SPACE) return [];
  const all = await keys<string>(guestStore);
  const metas = await getMany<DocMeta | undefined>(all.filter((k) => k.startsWith('meta:')), guestStore);
  return metas.filter((m): m is DocMeta => Boolean(m && !m.deleted));
}

/** Moves the guest library into the signed-in account (merging what both have). */
export async function adoptGuestDocs() {
  if (space === GUEST_SPACE) return 0;
  const docs = await guestDocs();
  // Their folders come along, stamped now so they are sent to Drive.
  const guestFolders = await get<FolderLog>(FOLDERS_KEY, guestStore);
  if (guestFolders) {
    const now = Date.now();
    const fresh: FolderLog = {};
    for (const f of Object.values(guestFolders)) fresh[f.id] = { ...f, updatedAt: now };
    await mergeFolders(fresh);
    await del(FOLDERS_KEY, guestStore);
    notify(FOLDERS_KEY, 'folders');
  }
  for (const g of docs) {
    const id = g.id;
    const [file, gLog, gLegacy, mine] = await Promise.all([
      get<Blob>(fileKey(id), guestStore),
      get<InkLog>(logKey(id), guestStore),
      get<DocInk>(legacyInkKey(id), guestStore),
      getMeta(id),
    ]);
    if (file && !(await getDocFile(id))) await set(fileKey(id), file, store);
    const meta: DocMeta = mine && !mine.deleted
      ? { ...mine, cloudOnly: mine.cloudOnly && !file, thumb: mine.thumb ?? g.thumb }
      : { ...g, cloudOnly: false, updatedAt: Date.now() };
    await set(metaKey(id), meta, store);
    const log = gLog ?? (gLegacy ? logFromInk(gLegacy) : null);
    if (log) await mergeInk(id, log);
    await Promise.all(
      [metaKey(id), fileKey(id), logKey(id), legacyInkKey(id), syncKey(id)].map((k) => del(k, guestStore)),
    );
    notify(id, 'meta');
    notify(id, 'ink');
  }
  flushInk();
  return docs.length;
}

/** Ask the browser not to evict our data under storage pressure. */
export function requestPersistence() {
  void navigator.storage?.persist?.();
}

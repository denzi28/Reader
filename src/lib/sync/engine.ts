// Keeps this device's library in step with the user's Google Drive.
//
// Each document lives in Drive's hidden app folder as up to four files:
//   meta-<id>.json   name, page count, last page read (newest copy wins)
//   ink-<id>.json    the ink log (merged stroke by stroke, never overwritten)
//   pdf-<id>.pdf     the document itself (uploaded once; downloaded on demand)
//   thumb-<id>.jpg   the cover shown on the shelf
// <id> is a hash of the PDF's contents, so the same file matches everywhere.
// The folders are one more file, folders.json, merged folder by folder; each
// document's record says which folder it is in.

import { t as tl } from '../i18n';
import { foldersAhead, latestFolderChange, mergeFolderLogs } from '../folders';
import { hasNewer, latestChange } from '../inkLog';
import * as storage from '../storage';
import { forgetPlan, FREE_AUTO_SYNC_MS, openPaywall, planInfo, refreshPlan } from '../plan';
import type { DocMeta, FolderLog, InkLog } from '../types';
import * as drive from './drive';
import {
  type Account,
  authMode,
  forgetToken,
  getAccessToken,
  initAuth,
  requestToken,
  signOutEverywhere,
  startSignIn,
  syncConfigured,
} from './google';

export type SyncState = 'off' | 'idle' | 'syncing' | 'reauth' | 'offline' | 'error';

export interface SyncStatus {
  available: boolean;
  /** False until we know whether the user is signed in. */
  ready: boolean;
  connected: boolean;
  state: SyncState;
  email?: string;
  name?: string;
  picture?: string;
  lastSyncedAt?: number;
  message?: string;
  /** Goes up whenever sync changed what is on the shelf. */
  libraryVersion: number;
  /** The free plan syncs on another device, not this one. */
  limited?: 'device';
}

const ACCOUNT_KEY = 'reader.drive.account';
const FOLDERS_FILE = 'folders.json';
const NAME = /^(meta|ink|pdf|thumb)-([A-Za-z0-9]+)\.(json|pdf|jpg)$/;
type Kind = 'meta' | 'ink' | 'pdf' | 'thumb';
interface Group {
  meta?: drive.RemoteFile;
  ink?: drive.RemoteFile;
  pdf?: drive.RemoteFile;
  thumb?: drive.RemoteFile;
  extras: { kind: Kind; file: drive.RemoteFile }[];
}

/** The signed-in account, remembered so the shelf shows it straight away. */
function readAccount(): Account | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as Account;
    } catch {
      return { email: raw || undefined }; // stored by an earlier version
    }
  } catch {
    return null;
  }
}

function writeAccount(a: Account | null) {
  try {
    if (a) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a));
    else localStorage.removeItem(ACCOUNT_KEY);
  } catch { /* ignore */ }
}

const saved = syncConfigured ? readAccount() : null;
// Open the right library before anything reads it.
storage.switchSpace(saved ? storage.accountSpace(saved.email) : null);
let status: SyncStatus = {
  available: syncConfigured,
  ready: !syncConfigured,
  connected: saved !== null,
  state: saved ? 'idle' : 'off',
  ...saved,
  libraryVersion: 0,
};

// ---- subscriptions ----------------------------------------------------
const statusListeners = new Set<(s: SyncStatus) => void>();
const inkListeners = new Map<string, Set<() => void>>();
const pdfListeners = new Map<string, Set<() => void>>();

export function getStatus() {
  return status;
}

export function subscribe(fn: (s: SyncStatus) => void) {
  statusListeners.add(fn);
  return () => void statusListeners.delete(fn);
}

/** Called when another device's ink for this document was merged in. */
export function onRemoteInk(id: string, fn: () => void) {
  const set = inkListeners.get(id) ?? new Set();
  set.add(fn);
  inkListeners.set(id, set);
  return () => void set.delete(fn);
}

/** Called when another device changed this document's PDF (a page was added) and this device now has it. */
export function onRemotePdf(id: string, fn: () => void) {
  const set = pdfListeners.get(id) ?? new Set();
  set.add(fn);
  pdfListeners.set(id, set);
  return () => void set.delete(fn);
}

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((fn) => fn(status));
}

// The shelf redraws when sync changes it, but not for every one of a hundred
// documents arriving together: at once, then at most every quarter second.
let shelfTimer = 0;
let shelfPending = false;
function shelfChanged() {
  if (shelfTimer) {
    shelfPending = true;
    return;
  }
  setStatus({ libraryVersion: status.libraryVersion + 1 });
  shelfTimer = window.setTimeout(() => {
    shelfTimer = 0;
    if (shelfPending) {
      shelfPending = false;
      shelfChanged();
    }
  }, 250);
}

interface Task {
  /** Lower runs first. */
  priority: number;
  run: (add: (task: Task) => void) => Promise<void>;
}

/**
 * Runs tasks `limit` at a time, the most urgent first; a task can add more.
 * Stops starting new ones after a failure, and rejects with it.
 */
function runTasks(initial: Task[], limit: number) {
  const queue = [...initial];
  let active = 0;
  let failed = false;
  return new Promise<void>((resolve, reject) => {
    const add = (task: Task) => queue.push(task);
    const pump = () => {
      if (failed) return;
      if (!queue.length && !active) return resolve();
      while (active < limit && queue.length) {
        let best = 0;
        for (let i = 1; i < queue.length; i++) if (queue[i].priority < queue[best].priority) best = i;
        const [task] = queue.splice(best, 1);
        active++;
        task.run(add).then(
          () => { active--; pump(); },
          (err) => { failed = true; reject(err); },
        );
      }
    };
    pump();
  });
}

/** Shows (and syncs) the library of this account, or the guest library. */
function enterAccount(account: Account | null) {
  return exclusive(async () => {
    if (storage.switchSpace(account ? storage.accountSpace(account.email) : null)) {
      pendingDocs.forEach((t) => clearTimeout(t));
      pendingDocs.clear();
      shelfChanged();
    }
  });
}

// ---- one sync at a time -----------------------------------------------
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

let authRetried = false;
let retryTimer = 0;
function fail(err: unknown) {
  if (err instanceof drive.CancelledError) return; // stopped on purpose
  console.warn('Sync failed:', err);
  if (err instanceof drive.TimeoutError) {
    setStatus({ state: 'offline', message: err.message });
    clearTimeout(retryTimer);
    retryTimer = window.setTimeout(() => void syncAll(), 30_000);
    return;
  }
  if (err instanceof drive.AuthError) {
    forgetToken(false);
    if (authMode() === 'server' && !authRetried) {
      // The token was refused early; fetch a fresh one and try again once.
      authRetried = true;
      setTimeout(() => void syncAll(), 300);
      return;
    }
    needReauth();
  } else if (!navigator.onLine || err instanceof TypeError) {
    setStatus({ state: 'offline', message: tl('Offline. Changes will sync when you are back online.') });
  } else {
    setStatus({ state: 'error', message: err instanceof Error ? err.message : tl('Sync failed.') });
  }
}

// When access runs out, renew it on the user's next click (browsers only let
// the Google window open in response to one). Its window closes by itself.
let reauthArmed = false;
function needReauth() {
  if (authMode() === 'server') {
    // Access was revoked or the session ended: only signing in again helps.
    setStatus({ state: 'reauth', message: tl('Sign in with Google again to keep syncing.') });
    return;
  }
  setStatus({ state: 'reauth', message: tl('Tap anywhere to reconnect Google Drive.') });
  if (reauthArmed) return;
  reauthArmed = true;
  document.addEventListener(
    'click',
    () => {
      reauthArmed = false;
      void reconnect();
    },
    { capture: true, once: true },
  );
}

async function token(): Promise<string | null> {
  const t = await getAccessToken();
  if (!t) needReauth();
  return t;
}

function synced() {
  authRetried = false;
  setStatus({ state: 'idle', lastSyncedAt: Date.now(), message: undefined });
  try { localStorage.setItem(LAST_SYNC_KEY, String(Date.now())); } catch { /* ignore */ }
}

// ---- what the plan allows -------------------------------------------------
const LAST_SYNC_KEY = 'reader.lastsync';
function lastSyncAt() {
  try { return Number(localStorage.getItem(LAST_SYNC_KEY)) || 0; } catch { return 0; }
}

/**
 * Premium and the trial sync everything, all the time. The free plan syncs on one
 * device only, and by itself only now and then (the rest is by hand).
 */
function allowed(auto: boolean): boolean {
  const info = planInfo();
  const limited = info.state === 'free' && !info.syncHere ? 'device' : undefined;
  if (status.limited !== limited) setStatus({ limited });
  if (info.state !== 'free') return true;
  if (limited) return false;
  return !auto || Date.now() - lastSyncAt() >= FREE_AUTO_SYNC_MS;
}

// ---- connecting -------------------------------------------------------
/** Signs in with Google. In server mode this leaves the page and comes back. */
export async function connect() {
  if (authMode() === 'server') {
    startSignIn(status.email);
    return;
  }
  setStatus({ state: 'syncing', message: undefined });
  try {
    const t = await requestToken(status.email);
    const me = await drive.whoAmI(t);
    await enterAccount({ email: me.email });
    writeAccount({ email: me.email, name: me.name });
    setStatus({ connected: true, email: me.email, name: me.name });
    await syncAll();
  } catch (err) {
    setStatus({
      state: status.connected ? 'error' : 'off',
      message: err instanceof Error ? err.message : tl('Could not connect to Google Drive.'),
    });
    throw err;
  }
}

async function reconnect() {
  try {
    await requestToken(status.email);
    await syncAll();
  } catch (err) {
    setStatus({ state: 'reauth', message: err instanceof Error ? err.message : undefined });
  }
}

/**
 * Signs out on this device. The account's documents are removed from the
 * device (they stay in its Google Drive) and the guest library is shown.
 */
export async function disconnect() {
  // Not connected any more: syncs already queued see this and stop at once,
  // then the one running is cancelled, so nothing is left to wait behind.
  setStatus({ connected: false, state: 'off', limited: undefined });
  forgetPlan();
  drive.cancelAll();
  clearTimeout(retryTimer);
  if (authMode() === 'server') await signOutEverywhere();
  else forgetToken(true);
  writeAccount(null);
  let done = false;
  const leave = async () => {
    if (done) return;
    done = true;
    await storage.clearSpace();
    storage.switchSpace(null);
    pendingDocs.forEach((t) => clearTimeout(t));
    pendingDocs.clear();
    shelfChanged();
  };
  // Normally after the running sync stops; if that hangs, leave anyway.
  await Promise.race([exclusive(leave), new Promise((r) => setTimeout(r, 4000)).then(leave)]);
  setStatus({
    connected: false,
    state: 'off',
    email: undefined,
    name: undefined,
    picture: undefined,
    message: undefined,
  });
}

// ---- syncing ----------------------------------------------------------
function groupFiles(files: drive.RemoteFile[]) {
  const groups = new Map<string, Group>();
  const newest = [...files].sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1));
  for (const f of newest) {
    const m = NAME.exec(f.name);
    if (!m) continue;
    const kind = m[1] as Kind;
    const g = groups.get(m[2]) ?? { extras: [] };
    if (g[kind]) g.extras.push({ kind, file: f }); // a duplicate from a race
    else g[kind] = f;
    groups.set(m[2], g);
  }
  return groups;
}

const EPUB_TYPE = 'application/epub+zip';

const stamp = (m: DocMeta) => m.updatedAt ?? m.openedAt ?? 0;

function forCloud(m: DocMeta) {
  const { thumb: _thumb, cloudOnly: _cloudOnly, ...rest } = m;
  return rest;
}

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' });

async function putJson(t: string, existing: drive.RemoteFile | undefined, name: string, value: unknown) {
  return existing ? drive.updateFile(t, existing.id, json(value)) : drive.createFile(t, name, json(value));
}

/** One document's sync, in steps that can run for many documents at once. */
interface Staged {
  id: string;
  rec: storage.SyncRecord;
  g: Group;
  meta: DocMeta;
  forceInk: boolean;
}

async function syncOne(t: string, id: string, group: Group | undefined, local: DocMeta | undefined) {
  const staged = await syncRecord(t, id, group, local);
  if (!staged) return;
  await syncCover(t, staged);
  await syncContent(t, staged);
}

/** Step 1: the record (name, page, folder...), so the shelf can show it. */
async function syncRecord(
  t: string,
  id: string,
  group: Group | undefined,
  local: DocMeta | undefined,
): Promise<Staged | null> {
  const rec = await storage.getSyncRecord(id);
  const g: Group = group ?? { extras: [] };

  // Duplicates appear if two devices create the same file at once. Keep
  // their ink, then remove them.
  let forceInk = false;
  for (const { kind, file } of g.extras) {
    if (kind === 'ink') {
      if (await storage.mergeInk(id, await drive.downloadJson<InkLog>(t, file.id))) emitInk(id);
      forceInk = true;
    }
    await drive.deleteFile(t, file.id);
  }

  // ---- record (newest wins) ----
  let meta = local;
  if (g.meta && g.meta.modifiedTime !== rec.metaSeen) {
    const remote = await drive.downloadJson<DocMeta>(t, g.meta.id);
    rec.metaSeen = g.meta.modifiedTime;
    if (!meta || stamp(remote) > stamp(meta)) {
      if (remote.deleted) {
        await storage.wipeDoc(id, remote);
        meta = { ...remote, deleted: true };
      } else {
        const hasFile = Boolean(await storage.getDocFile(id));
        meta = { ...remote, thumb: meta?.thumb, cloudOnly: !hasFile };
        await storage.putMeta(meta);
      }
      rec.metaPushed = stamp(remote);
      shelfChanged();
    }
  }
  if (!meta) {
    await storage.putSyncRecord(id, rec);
    return null;
  }

  if (meta.deleted) {
    for (const f of [g.pdf, g.ink, g.thumb]) if (f) await drive.deleteFile(t, f.id);
    if (g.meta && stamp(meta) > (rec.metaPushed ?? 0)) {
      const f = await putJson(t, g.meta, `meta-${id}.json`, forCloud(meta));
      rec.metaSeen = f.modifiedTime;
      rec.metaPushed = stamp(meta);
    }
    await storage.putSyncRecord(id, rec);
    return null;
  }

  if (!g.meta || stamp(meta) > (rec.metaPushed ?? 0)) {
    const f = await putJson(t, g.meta, `meta-${id}.json`, forCloud(meta));
    rec.metaSeen = f.modifiedTime;
    rec.metaPushed = stamp(meta);
  }
  await storage.putSyncRecord(id, rec);
  return { id, rec, g, meta, forceInk };
}

/** Step 2: the cover, sent or fetched. */
async function syncCover(t: string, s: Staged) {
  const { id, rec, g } = s;
  if (!g.thumb && s.meta.thumb) {
    await drive.createFile(t, `thumb-${id}.jpg`, new Blob([s.meta.thumb], { type: 'image/jpeg' }));
  } else if (g.thumb && !s.meta.thumb && rec.thumbSeen !== g.thumb.modifiedTime) {
    const thumb = await drive.downloadBlob(t, g.thumb.id);
    // Re-read the record: the reader may have changed it meanwhile.
    const latest = (await storage.getMeta(id)) ?? s.meta;
    s.meta = { ...latest, thumb };
    await storage.putMeta(s.meta);
    rec.thumbSeen = g.thumb.modifiedTime;
    await storage.putSyncRecord(id, rec);
    shelfChanged();
  }
}

async function pageCountOf(blob: Blob): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  return (await PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false })).getPageCount();
}

/** Takes another device's longer PDF as this one's, and makes the record say so. */
async function adoptRemotePdf(id: string, blob: Blob) {
  if ((await storage.getMeta(id))?.kind === 'epub') {
    await storage.putDocFile(id, new Blob([blob], { type: EPUB_TYPE }));
    return;
  }
  const file = new Blob([blob], { type: 'application/pdf' });
  await storage.putDocFile(id, file);
  const pages = await pageCountOf(file).catch(() => 0);
  const meta = await storage.getMeta(id);
  if (meta && pages && (meta.pages !== pages || meta.size !== file.size)) await storage.patchMeta(id, { pages, size: file.size });
  pdfListeners.get(id)?.forEach((fn) => fn());
}

/** Step 3: the PDF (sent once) and the ink, merged stroke by stroke. */
async function syncContent(t: string, s: Staged) {
  const { id, rec, g, forceInk } = s;
  if (!g.pdf) {
    const file = await storage.getDocFile(id);
    if (file) {
      // (An ePub book is kept in the same slot; its record says what it is.)
      const f = await drive.createFile(t, `pdf-${id}.pdf`, new Blob([file], { type: file.type || 'application/pdf' }));
      rec.pdfSeen = f.modifiedTime;
      rec.pdfDirty = false;
    }
  } else if (rec.pdfDirty) {
    // A page was added here: the copy in Drive is replaced.
    const file = await storage.getDocFile(id);
    if (file) {
      let send = true;
      if (rec.pdfSeen && g.pdf.modifiedTime !== rec.pdfSeen) {
        // Another device changed it meanwhile. Pages added on both sides are blank copies of
        // each other, so the longer file has everything: it is kept, here and in Drive.
        const remote = await drive.downloadBlob(t, g.pdf.id);
        if ((await pageCountOf(remote)) >= (await pageCountOf(file))) {
          await adoptRemotePdf(id, remote);
          rec.pdfSeen = g.pdf.modifiedTime;
          send = false;
        }
      }
      if (send) {
        const f = await drive.updateFile(t, g.pdf.id, new Blob([file], { type: file.type || 'application/pdf' }));
        rec.pdfSeen = f.modifiedTime;
      }
      rec.pdfDirty = false;
    }
  } else if (rec.pdfSeen && g.pdf.modifiedTime !== rec.pdfSeen) {
    // Another device replaced it. A copy kept here is brought up to date.
    if (await storage.getDocFile(id)) {
      await adoptRemotePdf(id, await drive.downloadBlob(t, g.pdf.id));
    }
    rec.pdfSeen = g.pdf.modifiedTime;
  } else if (!rec.pdfSeen) {
    rec.pdfSeen = g.pdf.modifiedTime; // first time this device looks: whatever is there is current
  }

  // ---- ink (merged stroke by stroke) ----
  // Nothing new on either side: leave the ink unread (most documents, most syncs).
  const unchangedRemote = g.ink ? !forceInk && g.ink.modifiedTime === rec.inkSeen : true;
  if (unchangedRemote) {
    const localStamp = (await storage.getInkStamps([id])).get(id) ?? 0;
    if (g.ink ? localStamp <= (rec.inkPushed ?? 0) : localStamp === 0) return;
  }
  let remoteLog: InkLog | null = null;
  if (g.ink && (forceInk || g.ink.modifiedTime !== rec.inkSeen)) {
    remoteLog = await drive.downloadJson<InkLog>(t, g.ink.id);
    rec.inkSeen = g.ink.modifiedTime;
    if (await storage.mergeInk(id, remoteLog)) emitInk(id);
  }
  const log = await storage.getInkLog(id);
  const upload = remoteLog
    ? hasNewer(log, remoteLog)
    : g.ink
      ? latestChange(log) > (rec.inkPushed ?? 0)
      : Object.keys(log).length > 0;
  if (upload) {
    const f = await putJson(t, g.ink, `ink-${id}.json`, log);
    rec.inkSeen = f.modifiedTime;
  }
  rec.inkPushed = latestChange(log);
  await storage.putSyncRecord(id, rec);
}

/** Brings the folder list up to date; `files` is (at least) every folders.json. */
async function syncFolders(t: string, files: drive.RemoteFile[]) {
  const copies = files
    .filter((f) => f.name === FOLDERS_FILE)
    .sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1));
  const [main, ...dupes] = copies; // dupes come from two devices racing
  const rec = await storage.getSyncRecord('folders');
  let remote: FolderLog | null = null;
  if (main && (dupes.length > 0 || main.modifiedTime !== rec.metaSeen)) {
    remote = {};
    for (const f of copies) remote = mergeFolderLogs(remote, await drive.downloadJson<FolderLog>(t, f.id)).log;
    rec.metaSeen = main.modifiedTime;
    if (await storage.mergeFolders(remote)) shelfChanged();
  }
  const local = await storage.getFolderLog();
  const upload = remote
    ? dupes.length > 0 || foldersAhead(local, remote)
    : main
      ? latestFolderChange(local) > (rec.metaPushed ?? 0)
      : Object.keys(local).length > 0;
  if (upload) {
    const f = await putJson(t, main, FOLDERS_FILE, local);
    rec.metaSeen = f.modifiedTime;
  }
  for (const d of dupes) await drive.deleteFile(t, d.id);
  rec.metaPushed = latestFolderChange(local);
  await storage.putSyncRecord('folders', rec);
}

/** Brings just the folder list up to date. */
function syncFolderList() {
  return exclusive(async () => {
    if (!status.connected) return;
    try {
      const t = await token();
      if (!t) return;
      setStatus({ state: 'syncing', message: undefined });
      await syncFolders(t, await drive.listFiles(t, 'folders'));
      synced();
    } catch (err) {
      fail(err);
    }
  });
}

function emitInk(id: string) {
  inkListeners.get(id)?.forEach((fn) => fn());
}

/** Brings every document on this device and in Drive up to date. */
export function syncAll(options: { auto?: boolean } = {}) {
  return exclusive(async () => {
    if (!status.connected) return;
    if (!allowed(Boolean(options.auto))) {
      // Someone pressed Sync now on a device the free plan does not sync: say why.
      if (!options.auto && status.limited) openPaywall('sync');
      return;
    }
    try {
      const t = await token();
      if (!t) return;
      setStatus({ state: 'syncing', message: undefined });
      const files = await drive.listFiles(t);
      await syncFolders(t, files);
      const groups = groupFiles(files);
      // Documents kept on this device only are left out of syncing altogether.
      const all = await storage.listAllMeta();
      const keep = new Set(all.filter((m) => m.localOnly).map((m) => m.id));
      const locals = new Map(all.filter((m) => !m.localOnly).map((m) => [m.id, m]));
      const ids = [...new Set([...groups.keys(), ...locals.keys()])].filter((id) => !keep.has(id));
      // Many documents at once. Every record comes first (so the shelf fills
      // straight away), then covers, then ink and uploads.
      let done = 0;
      const steps: Task[] = ids.map((id) => ({
        priority: 0,
        run: async (add) => {
          if (!status.connected) return;
          const s = await syncRecord(t, id, groups.get(id), locals.get(id));
          if (ids.length > 1) setStatus({ message: tl('Syncing document {done} of {total}', { done: ++done, total: ids.length }) });
          if (!s) return;
          add({ priority: 1, run: async () => { if (status.connected) await syncCover(t, s); } });
          add({ priority: 2, run: async () => { if (status.connected) await syncContent(t, s); } });
        },
      }));
      await runTasks(steps, 12);
      if (!status.connected) return;
      synced();
    } catch (err) {
      fail(err);
    }
  });
}

/** Brings one document up to date (cheaper than syncAll). */
export function syncDoc(id: string) {
  return exclusive(async () => {
    if (!status.connected) return;
    if (!allowed(true)) return;
    try {
      const t = await token();
      if (!t) return;
      setStatus({ state: 'syncing', message: undefined });
      const local = await storage.getMeta(id);
      if (local?.localOnly) return synced();
      const groups = groupFiles(await drive.listFiles(t, id));
      await syncOne(t, id, groups.get(id), local);
      synced();
    } catch (err) {
      fail(err);
    }
  });
}

// ---- downloading documents ------------------------------------------------
const downloads = new Map<string, Promise<void>>();
const progress = new Map<string, number>();
const progressListeners = new Set<() => void>();

/** How far along each running download is (0 to 1), by document id. */
export function downloadProgress(): ReadonlyMap<string, number> {
  return progress;
}

export function onDownloadProgress(fn: () => void) {
  progressListeners.add(fn);
  return () => void progressListeners.delete(fn);
}

function setProgress(id: string, fraction: number | null) {
  if (fraction === null) progress.delete(id);
  else progress.set(id, fraction);
  progressListeners.forEach((fn) => fn());
}

/**
 * Downloads a document that so far exists only in Drive. It runs at once,
 * not queued behind a sync, since someone is waiting to read it.
 */
export function downloadPdf(id: string) {
  let run = downloads.get(id);
  if (!run) {
    run = fetchPdf(id).finally(() => {
      downloads.delete(id);
      setProgress(id, null);
    });
    downloads.set(id, run);
  }
  return run;
}

async function fetchPdf(id: string) {
  if (await storage.getDocFile(id)) {
    // Already here (a sync can mark it cloud-only just as a download ends).
    const meta = await storage.getMeta(id);
    if (meta?.cloudOnly) await storage.putMeta({ ...meta, cloudOnly: false });
    shelfChanged();
    return;
  }
  const t = await getAccessToken();
  if (!t) {
    needReauth();
    throw new Error(tl('Sign in with Google to download this document.'));
  }
  setProgress(id, 0);
  const files = await drive.listFiles(t, id);
  const pdf = files.find((f) => f.name === `pdf-${id}.pdf`);
  if (!pdf) throw new Error(tl('This document is no longer in your Google Drive.'));
  const blob = await drive.downloadWithProgress(t, pdf, (f) => setProgress(id, f));
  const wanted = await storage.getMeta(id);
  await storage.putDocFile(id, new Blob([blob], { type: wanted?.kind === 'epub' ? EPUB_TYPE : 'application/pdf' }));
  const meta = await storage.getMeta(id);
  if (meta) await storage.putMeta({ ...meta, cloudOnly: false });
  shelfChanged();
}

// ---- when to sync -----------------------------------------------------
const pendingDocs = new Map<string, number>();
storage.onLocalChange((id, kind) => {
  if (!status.connected) return;
  clearTimeout(pendingDocs.get(id));
  pendingDocs.set(
    id,
    window.setTimeout(() => {
      pendingDocs.delete(id);
      void (kind === 'folders' ? syncFolderList() : syncDoc(id));
    }, kind === 'folders' ? 1200 : 2500),
  );
});

let lastAll = 0;
function syncAllSoon() {
  if (!status.connected || Date.now() - lastAll < 20_000) return;
  lastAll = Date.now();
  void syncAll({ auto: true });
}

if (typeof window !== 'undefined' && syncConfigured) {
  let planAt = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // The plan is asked for again now and then (a purchase made in the app, the trial ending).
    if (status.connected && Date.now() - planAt > 20 * 60_000) { planAt = Date.now(); void refreshPlan(); }
    syncAllSoon();
  });
  window.addEventListener('online', () => {
    lastAll = 0;
    syncAllSoon();
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') syncAllSoon();
  }, 120_000);
  void initAuth().then(async ({ mode, account }) => {
    if (mode === 'server') {
      // The session cookie is the truth: signed in there means signed in here.
      await enterAccount(account);
      writeAccount(account);
      setStatus({
        ready: true,
        connected: account !== null,
        state: account ? 'idle' : 'off',
        email: account?.email,
        name: account?.name,
        picture: account?.picture,
      });
    } else {
      setStatus({ ready: true });
    }
    if (account) await refreshPlan();
    syncAllSoon(); // start-up sync, if signed in
  });
}

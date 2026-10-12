// Keeps this device's library in step with the user's Google Drive.
//
// Each document lives in Drive's hidden app folder as up to four files:
//   meta-<id>.json   name, page count, last page read (newest copy wins)
//   ink-<id>.json    the ink log (merged stroke by stroke, never overwritten)
//   pdf-<id>.pdf     the document itself (uploaded once; downloaded on demand)
//   thumb-<id>.jpg   the cover shown on the shelf
// <id> is a hash of the PDF's contents, so the same file matches everywhere.

import { hasNewer, latestChange } from '../inkLog';
import * as storage from '../storage';
import type { DocMeta, InkLog } from '../types';
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
}

const ACCOUNT_KEY = 'reader.drive.account';
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

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((fn) => fn(status));
}

const shelfChanged = () => setStatus({ libraryVersion: status.libraryVersion + 1 });

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
function fail(err: unknown) {
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
    setStatus({ state: 'offline', message: 'Offline. Changes will sync when you are back online.' });
  } else {
    setStatus({ state: 'error', message: err instanceof Error ? err.message : 'Sync failed.' });
  }
}

// When access runs out, renew it on the user's next click (browsers only let
// the Google window open in response to one). Its window closes by itself.
let reauthArmed = false;
function needReauth() {
  if (authMode() === 'server') {
    // Access was revoked or the session ended: only signing in again helps.
    setStatus({ state: 'reauth', message: 'Sign in with Google again to keep syncing.' });
    return;
  }
  setStatus({ state: 'reauth', message: 'Tap anywhere to reconnect Google Drive.' });
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
  setStatus({ state: 'idle', lastSyncedAt: Date.now() });
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
      message: err instanceof Error ? err.message : 'Could not connect to Google Drive.',
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
  if (authMode() === 'server') await signOutEverywhere();
  else forgetToken(true);
  writeAccount(null);
  await exclusive(async () => {
    await storage.clearSpace();
    storage.switchSpace(null);
    pendingDocs.forEach((t) => clearTimeout(t));
    pendingDocs.clear();
    shelfChanged();
  });
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

const stamp = (m: DocMeta) => m.updatedAt ?? m.openedAt ?? 0;

function forCloud(m: DocMeta) {
  const { thumb: _thumb, cloudOnly: _cloudOnly, ...rest } = m;
  return rest;
}

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' });

async function putJson(t: string, existing: drive.RemoteFile | undefined, name: string, value: unknown) {
  return existing ? drive.updateFile(t, existing.id, json(value)) : drive.createFile(t, name, json(value));
}

async function syncOne(t: string, id: string, group: Group | undefined, local: DocMeta | undefined) {
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
  if (!meta) return storage.putSyncRecord(id, rec);

  if (meta.deleted) {
    for (const f of [g.pdf, g.ink, g.thumb]) if (f) await drive.deleteFile(t, f.id);
    if (g.meta && stamp(meta) > (rec.metaPushed ?? 0)) {
      const f = await putJson(t, g.meta, `meta-${id}.json`, forCloud(meta));
      rec.metaSeen = f.modifiedTime;
      rec.metaPushed = stamp(meta);
    }
    return storage.putSyncRecord(id, rec);
  }

  if (!g.meta || stamp(meta) > (rec.metaPushed ?? 0)) {
    const f = await putJson(t, g.meta, `meta-${id}.json`, forCloud(meta));
    rec.metaSeen = f.modifiedTime;
    rec.metaPushed = stamp(meta);
  }

  // ---- the PDF and its cover ----
  if (!g.pdf) {
    const file = await storage.getDocFile(id);
    if (file) await drive.createFile(t, `pdf-${id}.pdf`, new Blob([file], { type: 'application/pdf' }));
  }
  if (!g.thumb && meta.thumb) {
    await drive.createFile(t, `thumb-${id}.jpg`, new Blob([meta.thumb], { type: 'image/jpeg' }));
  } else if (g.thumb && !meta.thumb && rec.thumbSeen !== g.thumb.modifiedTime) {
    const thumb = await drive.downloadBlob(t, g.thumb.id);
    meta = { ...meta, thumb };
    await storage.putMeta(meta);
    rec.thumbSeen = g.thumb.modifiedTime;
    shelfChanged();
  }

  // ---- ink (merged stroke by stroke) ----
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

function emitInk(id: string) {
  inkListeners.get(id)?.forEach((fn) => fn());
}

/** Brings every document on this device and in Drive up to date. */
export function syncAll() {
  return exclusive(async () => {
    if (!status.connected) return;
    try {
      const t = await token();
      if (!t) return;
      setStatus({ state: 'syncing', message: undefined });
      const groups = groupFiles(await drive.listFiles(t));
      const locals = new Map((await storage.listAllMeta()).map((m) => [m.id, m]));
      for (const id of new Set([...groups.keys(), ...locals.keys()])) {
        await syncOne(t, id, groups.get(id), locals.get(id));
      }
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
    try {
      const t = await token();
      if (!t) return;
      setStatus({ state: 'syncing', message: undefined });
      const groups = groupFiles(await drive.listFiles(t, id));
      await syncOne(t, id, groups.get(id), await storage.getMeta(id));
      synced();
    } catch (err) {
      fail(err);
    }
  });
}

/** Downloads a document that so far exists only in Drive. */
export function downloadPdf(id: string) {
  return exclusive(async () => {
    const t = await getAccessToken();
    if (!t) {
      needReauth();
      throw new Error('Sign in with Google to download this document.');
    }
    const files = await drive.listFiles(t, id);
    const pdf = files.find((f) => f.name === `pdf-${id}.pdf`);
    if (!pdf) throw new Error('This document is no longer in your Google Drive.');
    const blob = await drive.downloadBlob(t, pdf.id);
    await storage.putDocFile(id, new Blob([blob], { type: 'application/pdf' }));
    const meta = await storage.getMeta(id);
    if (meta) await storage.putMeta({ ...meta, cloudOnly: false });
    shelfChanged();
  });
}

// ---- when to sync -----------------------------------------------------
const pendingDocs = new Map<string, number>();
storage.onLocalChange((id) => {
  if (!status.connected) return;
  clearTimeout(pendingDocs.get(id));
  pendingDocs.set(
    id,
    window.setTimeout(() => {
      pendingDocs.delete(id);
      void syncDoc(id);
    }, 2500),
  );
});

let lastAll = 0;
function syncAllSoon() {
  if (!status.connected || Date.now() - lastAll < 20_000) return;
  lastAll = Date.now();
  void syncAll();
}

if (typeof window !== 'undefined' && syncConfigured) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncAllSoon();
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
    syncAllSoon(); // start-up sync, if signed in
  });
}

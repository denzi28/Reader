import type { Folder, FolderLog } from './types';

export const MAX_FOLDER_NAME = 80;

/** Folder colours, by name (the stylesheet gives each a day and a night shade). */
export const FOLDER_COLORS = ['amber', 'blue', 'green', 'red', 'purple', 'teal', 'gold'] as const;
export type FolderColor = (typeof FOLDER_COLORS)[number];
export const folderColor = (c: string | undefined): FolderColor =>
  (FOLDER_COLORS as readonly string[]).includes(c ?? '') ? (c as FolderColor) : 'amber';

/** Folders still in use, in natural name order ("Week 2" before "Week 10"). */
export function liveFolders(log: FolderLog): Folder[] {
  return Object.values(log)
    .filter((f) => !f.deleted)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

/** Folds `remote` into `local`, keeping the newer copy of each folder. */
export function mergeFolderLogs(local: FolderLog, remote: FolderLog) {
  const log: FolderLog = { ...local };
  let changed = false;
  for (const [id, f] of Object.entries(remote)) {
    if (!f || typeof f.updatedAt !== 'number') continue;
    if (!log[id] || f.updatedAt > log[id].updatedAt) {
      log[id] = f;
      changed = true;
    }
  }
  return { log, changed };
}

/** Does `local` hold anything `remote` lacks or has an older copy of? */
export function foldersAhead(local: FolderLog, remote: FolderLog) {
  return Object.entries(local).some(([id, f]) => !remote[id] || f.updatedAt > remote[id].updatedAt);
}

export const latestFolderChange = (log: FolderLog) =>
  Object.values(log).reduce((max, f) => Math.max(max, f.updatedAt), 0);

export const cleanFolderName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME);

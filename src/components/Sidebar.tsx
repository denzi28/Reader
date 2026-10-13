import type { DragEvent, ReactNode } from 'react';
import { folderColor } from '../lib/folders';
import type { Folder } from '../lib/types';
import { BooksIcon, FolderPlusIcon, MarkIcon, MoonIcon, SparkIcon, SunIcon } from './icons';
import { InstallChip } from './PwaBits';
import { SyncControl } from './SyncControl';

export type SideTab = 'shelf' | 'notes' | 'tools';

type DropHandlers = {
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
};

/** The desktop library's left column: where to go, the folders, and the account. */
export function Sidebar({
  tab, folder, folders, counts, total, creating, newFolder, dropOn, dropTarget, dark, onTheme, onTab, onFolder, onCreate,
}: {
  tab: SideTab;
  /** The open folder, if any. */
  folder: string | null;
  folders: Folder[];
  counts: Map<string, number>;
  total: number;
  creating: boolean;
  /** The field that names a new folder (shown in the list while creating). */
  newFolder: ReactNode;
  dropOn: string | null;
  dropTarget: (id: string | null) => DropHandlers;
  dark: boolean;
  onTheme: () => void;
  onTab: (t: SideTab) => void;
  onFolder: (id: string) => void;
  onCreate: () => void;
}) {
  const nav = (id: SideTab, icon: ReactNode, label: string, extra?: ReactNode) => (
    <button
      className={`nv${tab === id && !folder ? ' on' : ''}${id === 'shelf' && dropOn === 'shelf' ? ' drop' : ''}`}
      onClick={() => onTab(id)}
      aria-current={tab === id && !folder ? 'page' : undefined}
      {...(id === 'shelf' ? dropTarget(null) : {})}
    >
      {icon}
      <span>{label}</span>
      {extra}
    </button>
  );
  return (
    <aside className="side" aria-label="Library">
      <h1 className="brand">The Reader</h1>
      <nav className="side-nav">
        {nav('shelf', <BooksIcon />, 'Library', <small>{total}</small>)}
        {nav('notes', <MarkIcon />, 'Notes')}
        {nav('tools', <SparkIcon />, 'PDF tools')}
      </nav>
      <div className="side-head">
        <span>Folders</span>
        <button className="side-add" onClick={onCreate} disabled={creating} aria-label="New folder" title="New folder"><FolderPlusIcon /></button>
      </div>
      <nav className="side-folders" aria-label="Folders">
        {folders.map((f) => (
          <button
            key={f.id}
            className={`nv c-${folderColor(f.color)}${folder === f.id ? ' on' : ''}${dropOn === f.id ? ' drop' : ''}`}
            onClick={() => onFolder(f.id)}
            aria-current={folder === f.id ? 'page' : undefined}
            {...dropTarget(f.id)}
          >
            <i className="side-dot" aria-hidden="true" />
            <span>{f.name}</span>
            <small>{counts.get(f.id) ?? 0}</small>
          </button>
        ))}
        {creating && <div className="nv nv-new"><i className="side-dot" aria-hidden="true" />{newFolder}</div>}
        {folders.length === 0 && !creating && <p className="side-empty">Folders group your documents by course or client.</p>}
      </nav>
      <div className="side-foot">
        <InstallChip />
        <div className="side-account">
          <SyncControl />
          <button className="icon-button" onClick={onTheme} aria-label={dark ? 'Switch to day paper' : 'Switch to night paper'} title={dark ? 'Day paper' : 'Night paper'}>
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
        <div className="side-links"><a href="/privacy.html">Privacy</a><span aria-hidden="true">·</span><a href="/terms.html">Terms</a></div>
      </div>
    </aside>
  );
}

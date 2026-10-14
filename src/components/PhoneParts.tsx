import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { DocMeta } from '../lib/types';
import {
  BooksIcon, ChevronIcon, DownloadIcon, FolderMoveIcon, FolderPlusIcon, MarkIcon, MoonIcon, PlusIcon, ShieldIcon,
  ToolsIcon, StarIcon, SunIcon, TrashIcon, UploadIcon, UserIcon, PencilIcon,
} from './icons';
import { useSyncStatus } from '../lib/sync/useSync';
import { InstallChip } from './PwaBits';
import { PlanCard } from './Paywall';
import { AccountCard } from './SyncControl';
import { TOOLS, type ToolId } from './toolList';

export type PhoneTab = 'shelf' | 'notes' | 'tools' | 'me';

/** The bar at the bottom of the phone's library: four places and the plus in the middle. */
export function PhoneNav({ tab, onTab, onAdd }: { tab: PhoneTab; onTab: (t: PhoneTab) => void; onAdd: () => void }) {
  const sync = useSyncStatus();
  // Me is where the account lives: a dot says when syncing needs attention.
  const attention = sync.connected && (sync.state === 'reauth' || sync.state === 'error');
  const item = (id: PhoneTab, label: string, icon: React.ReactNode) => (
    <button key={id} className={`pn-item${tab === id ? ' on' : ''}`} onClick={() => onTab(id)} aria-current={tab === id ? 'page' : undefined}>
      <span className="pn-pill">{icon}{id === 'me' && attention && <i className="pn-dot" aria-label="Sync needs attention" />}</span>
      {label}
    </button>
  );
  // In the body, not inside the page: the page's entrance animation would otherwise be what "fixed" means to it.
  return createPortal(
    <nav className="phone-nav" aria-label="Main">
      {item('shelf', 'Library', <BooksIcon />)}
      {item('notes', 'Notes', <MarkIcon />)}
      <button className="pn-plus" onClick={onAdd} aria-label="Add" aria-haspopup="dialog"><PlusIcon /></button>
      {item('tools', 'Tools', <ToolsIcon />)}
      {item('me', 'Me', <UserIcon />)}
    </nav>,
    document.body,
  );
}

/** A sheet rising from the bottom, closed by its backdrop, the grab bar or Escape. */
function Sheet({ title, onClose, children, label }: { title?: string; onClose: () => void; children: React.ReactNode; label: string }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="phone-sheet-wrap" role="dialog" aria-modal="true" aria-label={label}>
      <div className="phone-scrim" onClick={onClose} />
      <div className="phone-sheet">
        <button className="phone-grab" onClick={onClose} aria-label="Close" />
        {title && <h3 className="phone-sheet-title">{title}</h3>}
        {children}
      </div>
    </div>,
    document.body,
  );
}

function Row({ icon, title, sub, onClick, danger, label }: { icon: React.ReactNode; title: string; sub?: string; onClick: () => void; danger?: boolean; label?: string }) {
  return (
    <button className={`sheet-row${danger ? ' danger' : ''}`} onClick={onClick} aria-label={label}>
      <span className="sheet-row-icon">{icon}</span>
      <span className="sheet-row-text">
        <span className="sheet-row-title">{title}</span>
        {sub && <span className="sheet-row-sub">{sub}</span>}
      </span>
      <span className="sheet-row-go" aria-hidden="true"><ChevronIcon /></span>
    </button>
  );
}

/** What the plus adds: files, a note, a folder. */
export function AddSheet({ onFiles, onNote, onFolder, onClose }: { onFiles: () => void; onNote: () => void; onFolder?: () => void; onClose: () => void }) {
  return (
    <Sheet title="Add something" onClose={onClose} label="Add something">
      <Row icon={<UploadIcon />} title="Add files" sub="PDF, Office files, text, pictures" onClick={onFiles} />
      <Row icon={<PencilIcon />} title="New note" sub="Blank, lined, squared or dotted paper" onClick={onNote} label="New note" />
      {onFolder && <Row icon={<FolderPlusIcon />} title="New folder" sub="Group notes by course or client" onClick={onFolder} />}
    </Sheet>
  );
}

/** The actions of one document (the three dots on its card). */
export function BookSheet({ doc, canMove, onStar, onMove, onDownload, onRemove, onClose }: {
  doc: DocMeta;
  canMove: boolean;
  onStar: () => void;
  onMove: () => void;
  onDownload: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={doc.name} onClose={onClose} label={`${doc.name}: actions`}>
      <Row icon={<StarIcon />} title={doc.starred ? 'Remove the star' : 'Star'} onClick={onStar} />
      {canMove && <Row icon={<FolderMoveIcon />} title="Move to a folder" onClick={onMove} />}
      <Row icon={<DownloadIcon />} title="Download" onClick={onDownload} />
      <Row icon={<TrashIcon />} title="Remove from this device" onClick={onRemove} danger />
    </Sheet>
  );
}

/** The PDF tools as a plain list. */
export function ToolsPage({ onPick }: { onPick: (id: ToolId) => void }) {
  return (
    <section className="phone-page" aria-label="PDF tools">
      <p className="phone-note"><ShieldIcon /> Done on your device. Your files are never uploaded.</p>
      <ul className="tool-list">
        {TOOLS.map(({ id, title, blurb, color, Icon }) => (
          <li key={id}>
            <button className={`tool-row c-${color}`} onClick={() => onPick(id)}>
              <span className="tool-row-icon"><Icon /></span>
              <span className="tool-row-text">
                <span className="tool-row-title">{title}</span>
                <span className="tool-row-blurb">{blurb}</span>
              </span>
              <span className="sheet-row-go" aria-hidden="true"><ChevronIcon /></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Account, night paper, installing the app, and the small print. */
export function MePage({ dark, onTheme, docCount }: { dark: boolean; onTheme: () => void; docCount: number }) {
  return (
    <section className="phone-page" aria-label="Me">
      <AccountCard />
      <PlanCard docCount={docCount} />
      <div className="me-card me-list">
        <button className="me-row" onClick={onTheme} role="switch" aria-checked={dark}>
          <span className="me-row-icon">{dark ? <SunIcon /> : <MoonIcon />}</span>
          <span className="me-row-text">
            <span className="me-row-title">Night paper</span>
            <span className="me-row-sub">Easier on the eyes in the dark</span>
          </span>
          <span className={`switch${dark ? ' on' : ''}`} aria-hidden="true" />
        </button>
        <div className="me-row me-install"><InstallChip /></div>
        <a className="me-row" href="/privacy.html"><span className="me-row-icon"><ShieldIcon /></span><span className="me-row-text"><span className="me-row-title">Privacy</span></span><span className="sheet-row-go"><ChevronIcon /></span></a>
        <a className="me-row" href="/terms.html"><span className="me-row-icon"><ShieldIcon /></span><span className="me-row-text"><span className="me-row-title">Terms</span></span><span className="sheet-row-go"><ChevronIcon /></span></a>
      </div>
    </section>
  );
}

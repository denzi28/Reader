import { useEffect, useRef, useState } from 'react';
import { useLiquidBar } from '../lib/liquid';
import { createPortal } from 'react-dom';
import type { DocMeta } from '../lib/types';
import {
  BooksIcon, CheckIcon, ChevronIcon, DownloadIcon, FolderMoveIcon, FolderPlusIcon, MarkIcon, MoonIcon, PlusIcon, ShieldIcon,
  ToolsIcon, StarIcon, SunIcon, TrashIcon, UploadIcon, UserIcon, PencilIcon,
} from './icons';
import { useSyncStatus } from '../lib/sync/useSync';
import { InstallChip } from './PwaBits';
import { PlanCard } from './Paywall';
import { AccountCard } from './SyncControl';
import { TOOLS, type ToolId } from './toolList';
import { Cover } from './Cover';
import { ToolArt } from './ToolArt';

export type PhoneTab = 'shelf' | 'notes' | 'tools' | 'me';

/** The bar at the bottom of the phone's library: four places and the plus in the middle. */
export function PhoneNav({ tab, onTab, onAdd }: { tab: PhoneTab; onTab: (t: PhoneTab) => void; onAdd: () => void }) {
  const sync = useSyncStatus();
  const bar = useRef<HTMLElement>(null);
  useLiquidBar(bar, '.pn-item', tab);
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
    <nav className="phone-nav" aria-label="Main" ref={bar}>
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

const STEPS: Record<ToolId, string[]> = {
  merge: ['Add the PDFs', 'Put them in order', 'Download the one file'],
  split: ['Choose a document', 'Set how to cut it', 'Download the pieces'],
  crop: ['Choose a document', 'Drag the frame', 'Download the result'],
  edit: ['Choose a document', 'Reorder, rotate, delete', 'Download the result'],
};
const DETAIL: Record<ToolId, string> = {
  merge: 'Put several PDFs in the order you want, and get one file.',
  split: 'Cut a PDF into parts, or pull out just the pages you need.',
  crop: 'Trim the margins off every page, or only some of them.',
  edit: 'Reorder, rotate, delete or add pages in one document.',
};

const recent = (docs: DocMeta[]) =>
  docs.filter((d) => d.kind !== 'epub' && !d.attached).sort((a, b) => b.openedAt - a.openedAt).slice(0, 10);

function DocCover({ d, on, onClick }: { d: DocMeta; on?: boolean; onClick: () => void }) {
  return (
    <button className={`tw-doc${on ? ' on' : ''}`} onClick={onClick} aria-pressed={on === undefined ? undefined : on}>
      <span className="tw-cover"><Cover meta={d} />{on && <span className="tw-check"><CheckIcon /></span>}</span>
      <span className="tw-name">{d.name}</span>
    </button>
  );
}

/** The PDF tools: on a computer a list with the chosen tool open beside it, on a phone a grid of cards. */
export function ToolsPage({ phone, docs, onPick }: { phone: boolean; docs: DocMeta[]; onPick: (id: ToolId, start?: DocMeta[]) => void }) {
  return phone ? <PhoneTools docs={docs} onPick={onPick} /> : <Workbench docs={docs} onPick={onPick} />;
}

const Privacy = () => <p className="tools-privacy"><ShieldIcon /> Done on your device · never uploaded</p>;

function Workbench({ docs, onPick }: { docs: DocMeta[]; onPick: (id: ToolId, start?: DocMeta[]) => void }) {
  const [id, setId] = useState<ToolId>('merge');
  const [chosen, setChosen] = useState<string[]>([]);
  const meta = TOOLS.find((t) => t.id === id)!;
  const list = recent(docs);
  const pickTool = (next: ToolId) => { setId(next); setChosen([]); };
  const toggle = (d: DocMeta) => setChosen((c) => (c.includes(d.id) ? c.filter((x) => x !== d.id) : [...c, d.id]));
  const chosenDocs = chosen.flatMap((x) => list.filter((d) => d.id === x));
  return (
    <section className="workbench" aria-label="PDF tools">
      <div className="tools-intro">
        <p>Pick a tool on the left; its details open right here.</p>
        <Privacy />
      </div>
      <div className="wb-grid">
        <ul className="wb-list" role="tablist" aria-orientation="vertical" aria-label="Tools">
          {TOOLS.map((t) => (
            <li key={t.id}>
              <button
                role="tab"
                id={`wb-tab-${t.id}`}
                aria-selected={id === t.id}
                aria-controls="wb-panel"
                className={`wb-item c-${t.color}${id === t.id ? ' on' : ''}`}
                onClick={() => pickTool(t.id)}
              >
                <span className="wb-icon"><t.Icon /></span>
                <span className="wb-text"><b>{t.title}</b><small>{t.blurb}</small></span>
              </button>
            </li>
          ))}
        </ul>
        <div className={`wb-panel c-${meta.color}`} id="wb-panel" role="tabpanel" aria-labelledby={`wb-tab-${id}`} key={id}>
          <header className="wb-head">
            <div>
              <span className="wb-icon big"><meta.Icon /></span>
              <h2>{meta.title}</h2>
              <p>{DETAIL[id]}</p>
            </div>
            <ToolArt id={id} />
          </header>
          <div className="wb-start">
            <strong>{id === 'merge' ? 'Choose the PDFs to join' : 'Choose a PDF to work on'}</strong>
            <span>from your library below, or from this device</span>
            <button className="chip-button chip-primary" onClick={() => onPick(id, id === 'merge' ? chosenDocs : undefined)}>
              {id === 'merge' && chosenDocs.length ? `Start with ${chosenDocs.length} ${chosenDocs.length === 1 ? 'PDF' : 'PDFs'}` : 'Choose files'}
            </button>
          </div>
          <ol className="wb-steps">
            {STEPS[id].map((t, i) => <li key={t}><i>{i + 1}</i>{t}</li>)}
          </ol>
          {list.length > 0 && (
            <>
              <h3 className="wb-label">From your library</h3>
              <div className="wb-docs">
                {list.map((d) => (
                  <DocCover
                    key={d.id}
                    d={d}
                    on={id === 'merge' ? chosen.includes(d.id) : undefined}
                    onClick={() => (id === 'merge' ? toggle(d) : onPick(id, [d]))}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function PhoneTools({ docs, onPick }: { docs: DocMeta[]; onPick: (id: ToolId, start?: DocMeta[]) => void }) {
  const [doc, setDoc] = useState<DocMeta | null>(null);
  const list = recent(docs);
  return (
    <section className="phone-page tools-phone" aria-label="PDF tools">
      <Privacy />
      <div className="tp-grid">
        {TOOLS.map(({ id, title, blurb, color, Icon }, i) => (
          <button key={id} className={`tp-card c-${color}`} style={{ ['--i' as string]: i }} onClick={() => onPick(id)}>
            <span className="tp-icon"><Icon /></span>
            <ToolArt id={id} />
            <span className="tp-title">{title}</span>
            <span className="tp-blurb">{blurb}</span>
          </button>
        ))}
      </div>
      {list.length > 0 && (
        <>
          <h3 className="wb-label">Start from a document</h3>
          <div className="tp-docs">
            {list.map((d) => <DocCover key={d.id} d={d} onClick={() => setDoc(d)} />)}
          </div>
        </>
      )}
      {doc && (
        <Sheet title={doc.name} onClose={() => setDoc(null)} label={`${doc.name}: choose a tool`}>
          {TOOLS.map(({ id, title, blurb, color, Icon }) => (
            <button key={id} className={`tool-row sheet-tool c-${color}`} onClick={() => { const d = doc; setDoc(null); onPick(id, [d]); }}>
              <span className="tool-row-icon"><Icon /></span>
              <span className="tool-row-text"><span className="tool-row-title">{title}</span><span className="tool-row-blurb">{blurb}</span></span>
              <span className="sheet-row-go" aria-hidden="true"><ChevronIcon /></span>
            </button>
          ))}
        </Sheet>
      )}
    </section>
  );
}

/** Account, night paper, installing the app, and the small print. */
export function MePage({ dark, onTheme, docCount }: { dark: boolean; onTheme: () => void; docCount: number }) {
  return (
    <section className="phone-page" aria-label="Me">
      <AccountCard />
      <InstallChip card />
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
        <a className="me-row" href="/privacy.html"><span className="me-row-icon"><ShieldIcon /></span><span className="me-row-text"><span className="me-row-title">Privacy</span></span><span className="sheet-row-go"><ChevronIcon /></span></a>
        <a className="me-row" href="/terms.html"><span className="me-row-icon"><ShieldIcon /></span><span className="me-row-text"><span className="me-row-title">Terms</span></span><span className="sheet-row-go"><ChevronIcon /></span></a>
      </div>
    </section>
  );
}

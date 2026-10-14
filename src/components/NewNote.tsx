import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NoteKind, NotebookSpec, Paper } from '../lib/notebookSpec';
import { t } from '../lib/i18n';
import { CloseIcon } from './icons';

const PAPERS: { id: Paper; label: string }[] = [
  { id: 'blank', label: t('Blank') },
  { id: 'lined', label: t('Lined') },
  { id: 'grid', label: t('Squared') },
  { id: 'dotted', label: t('Dotted') },
];

/** A little picture of each kind of paper. */
function Swatch({ paper }: { paper: Paper }) {
  const lines = Array.from({ length: 6 }, (_, i) => 12 + i * 8);
  return (
    <svg viewBox="0 0 44 56" aria-hidden="true" className="paper-art">
      <rect x="1" y="1" width="42" height="54" rx="3" className="paper-sheet" />
      {paper === 'lined' && (
        <>
          {lines.map((y) => <path key={y} d={`M1 ${y}H43`} className="paper-rule" />)}
          <path d="M9 1V55" className="paper-margin" />
        </>
      )}
      {paper === 'grid' && (
        <>
          {[11, 21, 31].map((x) => <path key={x} d={`M${x} 1V55`} className="paper-rule" />)}
          {[11, 21, 31, 41].map((y) => <path key={y} d={`M1 ${y}H43`} className="paper-rule" />)}
        </>
      )}
      {paper === 'dotted' &&
        [11, 22, 33].flatMap((x) => [12, 22, 32, 42].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.1" className="paper-dot" />))}
    </svg>
  );
}

const PenArt = () => (
  <svg viewBox="0 0 64 50" aria-hidden="true" className="kind-art">
    <rect x="6" y="3" width="36" height="44" rx="4" className="ka-sheet" />
    <path d="M6 15h36M6 24h36M6 33h36" className="ka-rule" />
    <path d="M12 33c6-8 10 4 16-4s9 2 13-3" className="ka-ink" />
    <path d="M44 40l14-26 4 2-14 26-6 2z" className="ka-pen" />
  </svg>
);
const KeysArt = () => (
  <svg viewBox="0 0 64 50" aria-hidden="true" className="kind-art">
    <rect x="6" y="3" width="36" height="44" rx="4" className="ka-sheet" />
    <path d="M13 12h22" className="ka-title" />
    <path d="M13 21h22M13 28h22M13 35h14" className="ka-line" />
    <rect x="40" y="30" width="22" height="14" rx="3" className="ka-keys" />
    <path d="M44 35h2M48 35h2M52 35h2M56 35h2M45 39h12" className="ka-key" />
  </svg>
);

/** Asks what a new note should be: a notebook to write on with the pen, or a doc to type. */
export function NewNote({ busy, error, dedicated, onCreate, onClose }: {
  busy: boolean;
  error: string | null;
  /** The document and page this note is for, if it is for one. */
  dedicated?: { name: string; page: number };
  onCreate: (spec: NotebookSpec, kind: NoteKind) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [paper, setPaper] = useState<Paper>('lined');
  const [kind, setKind] = useState<NoteKind>('notebook');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const fallback = dedicated ? t('{name} · p. {page}', { name: dedicated.name, page: dedicated.page }) : t('Untitled note');
  const go = () => onCreate({ name: name.trim() || fallback, paper, landscape: false, pages: 1 }, dedicated ? 'notebook' : kind);
  const typed = !dedicated && kind === 'doc';

  return createPortal(
    <div className="tool-menu" role="dialog" aria-modal="true" aria-label={t('New note')}>
      <div className="tool-menu-backdrop" onClick={onClose} />
      <div className="tool-menu-sheet newnote">
        <header className="tool-menu-head">
          <div>
            <h2>{t('New note')}</h2>
            <p>{dedicated ? t('An empty notebook that goes with one page.') : t('Choose how you want to write.')}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}><CloseIcon /></button>
        </header>

        {dedicated && (
          <p className="dedicated" role="note">
            <b>{t('Dedicated to')}</b>
            <span>{dedicated.name}</span>
            <em>{t('page {page}', { page: dedicated.page })}</em>
          </p>
        )}
        {!dedicated && (
          <div className="kinds" role="radiogroup" aria-label={t('Kind of note')}>
            <button role="radio" aria-checked={kind === 'notebook'} className={`kind${kind === 'notebook' ? ' on' : ''}`} onClick={() => setKind('notebook')}>
              <span className="kind-pic"><PenArt /></span>
              <b>{t('Notebook')}</b>
              <small>{t('Write and draw with the pen on paper.')}</small>
            </button>
            <button role="radio" aria-checked={kind === 'doc'} className={`kind${kind === 'doc' ? ' on' : ''}`} onClick={() => setKind('doc')}>
              <span className="kind-pic"><KeysArt /></span>
              <b>{t('Doc')}</b>
              <small>{t('Type with the keyboard: headings, lists, checkboxes.')}</small>
            </button>
          </div>
        )}
        <label className="tool-field">
          <span>{t('Name')}</span>
          <input ref={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={fallback} maxLength={120}
            onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
        </label>

        {!typed && (
          <>
        <h3 className="tool-label">{t('Paper')}</h3>
          <div className="papers" role="radiogroup" aria-label={t('Paper')}>
            {PAPERS.map((p) => (
              <button key={p.id} role="radio" aria-checked={paper === p.id} className={`paper${paper === p.id ? ' on' : ''}`} onClick={() => setPaper(p.id)}>
                <Swatch paper={p.id} />
                <span>{p.label}</span>
              </button>
            ))}
          </div>

        <p className="tool-hint">{dedicated
            ? t('It starts with one page; a button at the end adds the next one whenever you need it. Pages are always upright, so every note lines up with the others. It shows in the corner of that page, and that page shows in the corner of the note.')
            : t('It starts with one page; a button at the end adds the next one whenever you need it. Pages are always upright, so every note lines up with the others.')}</p>
          </>
        )}
        {typed && <p className="tool-hint">{t('A doc grows as you type. It is kept as plain text you can open anywhere.')}</p>}
        {error && <p className="tool-error" role="alert">{error}</p>}
        <button className="button newnote-go" disabled={busy} onClick={go}>{busy ? t('Making it…') : t('Create note')}</button>
      </div>
    </div>,
    document.body,
  );
}

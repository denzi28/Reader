import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_NOTEBOOK_PAGES, type NotebookSpec, type Paper } from '../lib/notebookSpec';
import { CloseIcon } from './icons';

const PAPERS: { id: Paper; label: string }[] = [
  { id: 'blank', label: 'Blank' },
  { id: 'lined', label: 'Lined' },
  { id: 'grid', label: 'Squared' },
  { id: 'dotted', label: 'Dotted' },
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

/** Asks what a new notebook should be like. */
export function NewNote({ busy, error, dedicated, onCreate, onClose }: {
  busy: boolean;
  error: string | null;
  /** The document and page this note is for, if it is for one. */
  dedicated?: { name: string; page: number };
  onCreate: (spec: NotebookSpec) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [paper, setPaper] = useState<Paper>('lined');
  const [landscape, setLandscape] = useState(false);
  const [pages, setPages] = useState(dedicated ? 3 : 10);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const fallback = dedicated ? `${dedicated.name} · p. ${dedicated.page}` : 'Untitled note';
  const go = () => onCreate({ name: name.trim() || fallback, paper, landscape, pages });

  return createPortal(
    <div className="tool-menu" role="dialog" aria-modal="true" aria-label="New note">
      <div className="tool-menu-backdrop" onClick={onClose} />
      <div className="tool-menu-sheet newnote">
        <header className="tool-menu-head">
          <div>
            <h2>New note</h2>
            <p>{dedicated ? 'An empty notebook that goes with one page.' : 'An empty notebook to write on with the pen.'}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </header>

        {dedicated && (
          <p className="dedicated" role="note">
            <b>Dedicated to</b>
            <span>{dedicated.name}</span>
            <em>page {dedicated.page}</em>
          </p>
        )}
        <label className="tool-field">
          <span>Name</span>
          <input ref={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={fallback} maxLength={120}
            onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
        </label>

        <h3 className="tool-label">Paper</h3>
        <div className="papers" role="radiogroup" aria-label="Paper">
          {PAPERS.map((p) => (
            <button key={p.id} role="radio" aria-checked={paper === p.id} className={`paper${paper === p.id ? ' on' : ''}`} onClick={() => setPaper(p.id)}>
              <Swatch paper={p.id} />
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        <div className="newnote-row">
          <div className="segmented small" role="radiogroup" aria-label="Page shape">
            {([[false, 'Portrait'], [true, 'Landscape']] as const).map(([v, text]) => (
              <button key={text} role="radio" aria-checked={landscape === v} className={landscape === v ? 'on' : ''} onClick={() => setLandscape(v)}>{text}</button>
            ))}
          </div>
          <div className="stepper">
            <button className="icon-button" onClick={() => setPages((n) => Math.max(1, n - 1))} aria-label="Fewer pages">−</button>
            <label>
              <span className="sr-only">Pages</span>
              <input type="number" min={1} max={MAX_NOTEBOOK_PAGES} value={pages}
                onChange={(e) => setPages(Math.max(1, Math.min(MAX_NOTEBOOK_PAGES, Math.floor(Number(e.target.value)) || 1)))} />
            </label>
            <span className="stepper-unit">{pages === 1 ? 'page' : 'pages'}</span>
            <button className="icon-button" onClick={() => setPages((n) => Math.min(MAX_NOTEBOOK_PAGES, n + 1))} aria-label="More pages">+</button>
          </div>
        </div>
        <p className="tool-hint">{dedicated ? 'It shows in the corner of that page, and that page shows in the corner of the note. ' : ''}Pages can't be added to a note later, so make as many as you may need.</p>
        {error && <p className="tool-error" role="alert">{error}</p>}
        <button className="button newnote-go" disabled={busy} onClick={go}>{busy ? 'Making it…' : 'Create note'}</button>
      </div>
    </div>,
    document.body,
  );
}

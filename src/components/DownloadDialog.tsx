import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDocFile, loadInk } from '../lib/storage';
import { downloadPdf } from '../lib/sync/engine';
import type { DocMeta } from '../lib/types';
import { CloseIcon, DownloadIcon } from './icons';
import { BookLoader } from './BookLoader';

const fileName = (name: string, suffix = '', ext = 'pdf') => `${name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Document'}${suffix}.${ext}`;

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Saves a document to the device: as it is, or with everything written on it. */
export function DownloadDialog({ doc, onClose }: { doc: DocMeta; onClose: () => void }) {
  const [marks, setMarks] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    void loadInk(doc.id).then((ink) => { if (!gone) setMarks(Object.values(ink).reduce((n, list) => n + list.length, 0)); });
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => { gone = true; window.removeEventListener('keydown', key); };
  }, [doc.id, onClose]);

  const run = async (withNotes: boolean) => {
    setError(null);
    try {
      let file = await getDocFile(doc.id);
      if (!file) {
        setBusy('Bringing it down from Google Drive…');
        await downloadPdf(doc.id);
        file = await getDocFile(doc.id);
      }
      if (!file) throw new Error('This document is not on this device yet.');
      if (!withNotes) {
        save(file, fileName(doc.name, '', epub ? 'epub' : 'pdf'));
      } else {
        setBusy('Putting your notes on the pages…');
        const [{ pdfWithNotes }, ink] = await Promise.all([import('../lib/exportPdf'), loadInk(doc.id)]);
        const bytes = await pdfWithNotes(file, ink);
        save(new Blob([bytes as BlobPart], { type: 'application/pdf' }), fileName(doc.name, ' (with notes)'));
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'It could not be saved.');
      setBusy(null);
    }
  };

  const none = marks === 0;
  const epub = doc.kind === 'epub';
  // A note you made yourself is its writing: the blank paper alone is not what anyone wants.
  const blankOnly = Boolean(doc.notebook);
  return createPortal(
    <div className="tool-menu" role="dialog" aria-modal="true" aria-label={`Download ${doc.name}`}>
      <div className="tool-menu-backdrop" onClick={busy ? undefined : onClose} />
      <div className="tool-menu-sheet newnote">
        <header className="tool-menu-head">
          <div>
            <h2>Download</h2>
            <p>{doc.name}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close" disabled={!!busy}><CloseIcon /></button>
        </header>
        {busy ? (
          <div className="download-busy" role="status">
            <BookLoader size={34} label={busy} />
            <p>{busy}</p>
          </div>
        ) : (
          <div className="download-options">
            {!epub && <button className="download-option" disabled={none || marks === null} onClick={() => void run(true)}>
              <span className="download-icon"><DownloadIcon /></span>
              <span>
                <strong>{blankOnly ? 'The note as a PDF' : 'With my notes'}</strong>
                <small>{none ? 'Nothing is written on it yet.' : 'Your pen, highlights and typed notes are drawn onto the pages.'}</small>
              </span>
            </button>}
            {!blankOnly && (
              <button className="download-option" onClick={() => void run(false)}>
                <span className="download-icon plain"><DownloadIcon /></span>
                <span>
                  <strong>{epub ? 'The book (ePub)' : 'Original PDF'}</strong>
                  <small>{epub ? 'The book file, exactly as it was added.' : 'Exactly as it was added, without your notes.'}</small>
                </span>
              </button>
            )}
          </div>
        )}
        {error && <p className="tool-error" role="alert">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}

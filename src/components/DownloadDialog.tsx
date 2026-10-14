import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../lib/i18n';
import { getDocFile, loadInk } from '../lib/storage';
import { downloadPdf } from '../lib/sync/engine';
import type { DocMeta } from '../lib/types';
import { CloseIcon, DownloadIcon } from './icons';
import { BookLoader } from './BookLoader';

const fileName = (name: string, suffix = '', ext = 'pdf') => `${name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || t('Document')}${suffix}.${ext}`;

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
        setBusy(t('Bringing it down from Google Drive…'));
        await downloadPdf(doc.id);
        file = await getDocFile(doc.id);
      }
      if (!file) throw new Error(t('This document is not on this device yet.'));
      if (!withNotes) {
        save(file, fileName(doc.name, '', epub ? 'epub' : 'pdf'));
      } else {
        setBusy(t('Putting your notes on the pages…'));
        const [{ pdfWithNotes }, ink] = await Promise.all([import('../lib/exportPdf'), loadInk(doc.id)]);
        const bytes = await pdfWithNotes(file, ink);
        save(new Blob([bytes as BlobPart], { type: 'application/pdf' }), fileName(doc.name, t(' (with notes)')));
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('It could not be saved.'));
      setBusy(null);
    }
  };

  /** A typed note goes out as Markdown text, or as a PDF of its words (pictures are left out of the PDF). */
  const runNote = async (as: 'md' | 'pdf') => {
    setError(null);
    try {
      let file = await getDocFile(doc.id);
      if (!file) {
        setBusy(t('Bringing it down from Google Drive…'));
        await downloadPdf(doc.id);
        file = await getDocFile(doc.id);
      }
      if (!file) throw new Error(t('This document is not on this device yet.'));
      if (as === 'md') {
        save(new Blob([await file.text()], { type: 'text/markdown' }), fileName(doc.name, '', 'md'));
      } else {
        setBusy(t('Making the PDF…'));
        const text = (await file.text()).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^(\s*[-*+]\s+)\[ \]/gm, '$1☐').replace(/^(\s*[-*+]\s+)\[[xX]\]/gm, '$1☑');
        const { convertOffice } = await import('../lib/office');
        const pdf = await convertOffice(new File([`# ${doc.name}\n\n${text}`], `${doc.name}.md`, { type: 'text/markdown' }));
        save(pdf, fileName(doc.name));
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('It could not be saved.'));
      setBusy(null);
    }
  };

  const none = marks === 0;
  const epub = doc.kind === 'epub';
  // A note you made yourself is its writing: the blank paper alone is not what anyone wants.
  const blankOnly = Boolean(doc.notebook);
  return createPortal(
    <div className="tool-menu" role="dialog" aria-modal="true" aria-label={t('Download {name}', { name: doc.name })}>
      <div className="tool-menu-backdrop" onClick={busy ? undefined : onClose} />
      <div className="tool-menu-sheet newnote">
        <header className="tool-menu-head">
          <div>
            <h2>{t('Download')}</h2>
            <p>{doc.name}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')} disabled={!!busy}><CloseIcon /></button>
        </header>
        {busy ? (
          <div className="download-busy" role="status">
            <BookLoader size={34} label={busy} />
            <p>{busy}</p>
          </div>
        ) : doc.kind === 'note' ? (
          <div className="download-options">
            <button className="download-option" onClick={() => void runNote('md')}>
              <span className="download-icon"><DownloadIcon /></span>
              <span>
                <strong>{t('Text (Markdown)')}</strong>
                <small>{t('The note as plain text, with its pictures. Opens in any notes app.')}</small>
              </span>
            </button>
            <button className="download-option" onClick={() => void runNote('pdf')}>
              <span className="download-icon plain"><DownloadIcon /></span>
              <span>
                <strong>{t('PDF')}</strong>
                <small>{t('The words, headings and lists on pages. Pictures are left out.')}</small>
              </span>
            </button>
          </div>
        ) : (
          <div className="download-options">
            {!epub && <button className="download-option" disabled={none || marks === null} onClick={() => void run(true)}>
              <span className="download-icon"><DownloadIcon /></span>
              <span>
                <strong>{blankOnly ? t('The note as a PDF') : t('With my notes')}</strong>
                <small>{none ? t('Nothing is written on it yet.') : t('Your pen, highlights and typed notes are drawn onto the pages.')}</small>
              </span>
            </button>}
            {!blankOnly && (
              <button className="download-option" onClick={() => void run(false)}>
                <span className="download-icon plain"><DownloadIcon /></span>
                <span>
                  <strong>{epub ? t('The book (ePub)') : t('Original PDF')}</strong>
                  <small>{epub ? t('The book file, exactly as it was added.') : t('Exactly as it was added, without your notes.')}</small>
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

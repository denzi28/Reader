import { lazy, Suspense, useEffect, useState } from 'react';
import { BookLoader } from './BookLoader';
import { t } from '../lib/i18n';
import { getMeta, patchMeta } from '../lib/storage';
import { usePhone } from '../lib/usePhone';
import type { DocMeta } from '../lib/types';

// Each reader is a large download of its own; only the one in use is fetched.
const Viewer = lazy(() => import('./Viewer').then((m) => ({ default: m.Viewer })));
const NoteEditor = lazy(() => import('./NoteEditor').then((m) => ({ default: m.NoteEditor })));
const BookReader = lazy(() => import('./BookReader').then((m) => ({ default: m.BookReader })));

export type DocView = 'book' | 'pdf';

const opening = (
  <div className="viewer-loading loading" role="status">
    <BookLoader size={46} label={t('Opening your document')} />
    <span>{t('Opening your document…')}</span>
  </div>
);

interface Props {
  docId: string;
  startPage?: number;
  /** Asked for by whoever opened it (the book on a card, the switch in the reader); else the document's own habit. */
  view?: DocView;
  dark: boolean;
  onTheme: () => void;
  onClose: () => void;
  onOpen: (id: string, page?: number) => void;
  onView: (view: DocView) => void;
}

/** Opens a document in the reader it asks for: the PDF reader, or book mode (always for an ePub). */
export function DocScreen({ docId, startPage, view, dark, onTheme, onClose, onOpen, onView }: Props) {
  const [meta, setMeta] = useState<DocMeta | null | undefined>(undefined);
  const phone = usePhone();
  useEffect(() => {
    let on = true;
    void getMeta(docId).then((m) => { if (on) setMeta(m ?? null); });
    return () => { on = false; };
  }, [docId]);
  if (meta === undefined) return opening;

  // A typed note opens in the editor.
  if (meta?.kind === 'note') {
    return (
      <Suspense fallback={opening}>
        <NoteEditor docId={docId} dark={dark} onTheme={onTheme} onClose={onClose} onOpen={onOpen} phone={phone} />
      </Suspense>
    );
  }
  const epub = meta?.kind === 'epub';
  const mode: DocView = epub ? 'book' : view ?? (meta?.view === 'book' ? 'book' : 'pdf');
  return (
    <Suspense fallback={opening}>
      {mode === 'book' ? (
        <BookReader
          docId={docId}
          startPage={startPage}
          dark={dark}
          onTheme={onTheme}
          onClose={onClose}
          onPdf={epub ? undefined : () => { void patchMeta(docId, { view: undefined }); onView('pdf'); }}
        />
      ) : (
        <Viewer docId={docId} startPage={startPage} dark={dark} onTheme={onTheme} onClose={onClose} onOpen={onOpen} onBook={() => onView('book')} />
      )}
    </Suspense>
  );
}

import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { drawStrokes } from '../lib/ink';
import { acquirePdf, releasePdf, renderPagePreview } from '../lib/pdf';
import { getDocFile, loadInk } from '../lib/storage';
import type { DocMeta } from '../lib/types';
import { Cover } from './Cover';
import { CloseIcon } from './icons';

/**
 * A small page in the corner of the reader: the note made for the page being read,
 * or the page a note was made for. Tapping it brings that document to the screen
 * (and the one being read moves to the corner in turn).
 */
export function LinkCard({ doc, page, label, sub, onOpen, onHide }: {
  doc: DocMeta;
  page: number;
  label: string;
  sub: string;
  onOpen: () => void;
  onHide: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const typed = doc.kind === 'note';
  useEffect(() => {
    const c = canvas.current;
    if (!c || typed) return;
    let gone = false;
    let held = false;
    setDrawn(false);
    (async () => {
      const [pdf, ink] = await Promise.all([
        acquirePdf(doc.id, () => getDocFile(doc.id)).then((d) => { held = true; return d; }),
        loadInk(doc.id),
      ]);
      if (gone || !pdf) return;
      await renderPagePreview(pdf, Math.min(page, pdf.numPages - 1), c, 240);
      const ctx = c.getContext('2d');
      if (gone || !ctx) return;
      const strokes = (ink[page] ?? []).map((s) => ({ ...s, size: Math.max(s.size, 1.5 / c.width) }));
      drawStrokes(ctx, strokes, c.width, false);
      setDrawn(true);
    })().catch(() => undefined);
    return () => {
      gone = true;
      if (held) releasePdf(doc.id);
    };
  }, [doc.id, page, doc.updatedAt, typed]);

  return (
    <div className="link-card">
      <button className="link-card-open" onClick={onOpen} aria-label={t('{label}, {sub}: open it', { label, sub })} title={`${label} · ${sub}`}>
        <span className={`link-card-page${typed ? ' typed' : ''}`}>
          {typed ? (
            // A typed note has no page to draw: its first lines stand in for one.
            <span className="link-card-words">{doc.preview}</span>
          ) : (
            <>
              <canvas ref={canvas} className={drawn ? 'on' : ''} aria-hidden="true" />
              {!drawn && <span className="link-card-fallback"><Cover meta={doc} /></span>}
            </>
          )}
        </span>
        <span className="link-card-text">
          <strong>{label}</strong>
          <span>{sub}</span>
        </span>
      </button>
      <button className="link-card-hide" onClick={onHide} aria-label={t('Hide {label}', { label })}><CloseIcon /></button>
    </div>
  );
}

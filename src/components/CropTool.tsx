import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { cropChange, type PageMove } from '../lib/carryNotes';
import { pageSize } from '../lib/pdf';
import { loadInk } from '../lib/storage';
import { cropPdf, type Margins, parseRanges } from '../lib/pdfOps';
import { BackIcon, ArrowIcon } from './icons';
import { BigFileNotice, Busy, drawPage, errorText, fileOf, Notice, PickOne, plural, Shell, usePdf, type ToolContext, type ToolDoc } from './toolKit';

const MIN = 0.08; // the crop keeps at least this much of the page, each way
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const HANDLES = ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'] as const;

export function CropTool({ ctx, onClose }: { ctx: ToolContext; onClose: () => void }) {
  const [doc, setDoc] = useState<ToolDoc | null>(ctx.start?.[0] ?? null);
  if (!doc) return <PickOne ctx={ctx} tool="crop" onPick={setDoc} onClose={onClose} />;
  return <CropEditor ctx={ctx} doc={doc} onBack={() => setDoc(null)} onClose={onClose} />;
}

function CropEditor({ ctx, doc, onBack, onClose }: { ctx: ToolContext; doc: ToolDoc; onBack: () => void; onClose: () => void }) {
  const { pdf, error: loadError } = usePdf(doc);
  const [cur, setCur] = useState(0);
  const [m, setM] = useState<Margins>({ l: 0.06, t: 0.06, r: 0.06, b: 0.06 });
  const [scope, setScope] = useState<'all' | 'some'>('all');
  const [rangeText, setRangeText] = useState('');
  const [busy, setBusy] = useState<{ label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawn, setDrawn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: string; x: number; y: number; start: Margins; w: number; h: number } | null>(null);

  // The page being cropped, drawn large.
  useEffect(() => {
    const c = canvas.current;
    if (!pdf || !c) return;
    let gone = false;
    setDrawn(false);
    void drawPage(pdf, cur, c, 800).then(() => { if (!gone) setDrawn(true); }).catch(() => undefined);
    return () => { gone = true; };
  }, [pdf, cur]);

  const begin = (kind: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = stage.current!.getBoundingClientRect();
    drag.current = { kind, x: e.clientX, y: e.clientY, start: m, w: box.width, h: box.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / d.w;
    const dy = (e.clientY - d.y) / d.h;
    const s = d.start;
    const next = { ...s };
    if (d.kind === 'move') {
      const sx = clamp(dx, -s.l, s.r);
      const sy = clamp(dy, -s.t, s.b);
      next.l = s.l + sx; next.r = s.r - sx; next.t = s.t + sy; next.b = s.b - sy;
    } else {
      if (d.kind.includes('l')) next.l = clamp(s.l + dx, 0, 1 - s.r - MIN);
      if (d.kind.includes('r')) next.r = clamp(s.r - dx, 0, 1 - next.l - MIN);
      if (d.kind.includes('t')) next.t = clamp(s.t + dy, 0, 1 - s.b - MIN);
      if (d.kind.includes('b')) next.b = clamp(s.b - dy, 0, 1 - next.t - MIN);
    }
    setM(next);
  };
  const end = () => { drag.current = null; };

  /** Finds the printed area of the page shown and crops to it. */
  const autoTrim = () => {
    const c = canvas.current;
    if (!c || !c.width) return;
    const scale = 300 / c.width;
    const small = document.createElement('canvas');
    small.width = 300;
    small.height = Math.max(1, Math.round(c.height * scale));
    const g = small.getContext('2d', { willReadFrequently: true })!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, small.width, small.height);
    g.drawImage(c, 0, 0, small.width, small.height);
    const { data, width, height } = g.getImageData(0, 0, small.width, small.height);
    let x0 = width, x1 = -1, y0 = height, y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] > 20 && (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235)) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return; // a blank page
    const pad = 0.012;
    setM({
      l: clamp(x0 / width - pad, 0, 0.9), t: clamp(y0 / height - pad, 0, 0.9),
      r: clamp(1 - (x1 + 1) / width - pad, 0, 0.9), b: clamp(1 - (y1 + 1) / height - pad, 0, 0.9),
    });
  };

  const only = useMemo(() => {
    if (scope === 'all') return { set: undefined as Set<number> | undefined, problem: null as string | null };
    if (!rangeText.trim()) return { set: new Set<number>(), problem: null };
    try {
      return { set: new Set(parseRanges(rangeText, doc.pages).flat()), problem: null };
    } catch (err) {
      return { set: new Set<number>(), problem: errorText(err) };
    }
  }, [scope, rangeText, doc.pages]);
  const count = scope === 'all' ? doc.pages : only.set!.size;

  const run = async () => {
    setError(null);
    setBusy({ label: t('Cropping…') });
    try {
      const bytes = await cropPdf(await fileOf(doc), m, only.set);
      // Where each mark of the original lands on the cut pages, in case the notes are brought along.
      const moves: PageMove[] = [];
      if (pdf && !doc.temp) {
        const ink = await loadInk(doc.id);
        for (const key of Object.keys(ink)) {
          const p = Number(key);
          const cut = !only.set || only.set.has(p);
          const size = cut ? await pageSize(pdf, p) : null;
          moves.push({ from: p, to: p, change: size ? cropChange(m, size.h / size.w) : undefined });
        }
      }
      ctx.finish({
        title: t('Cropped {pages}', { pages: plural(count, 'page', 'pages') }),
        outputs: [{ name: t('{name} (cropped)', { name: doc.name }), bytes, pages: doc.pages, folder: ctx.folderOf(doc), sources: moves.length ? [{ docId: doc.id, moves }] : [] }],
      });
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  const kept = { w: Math.round((1 - m.l - m.r) * 100), h: Math.round((1 - m.t - m.b) * 100) };
  const edge = (m.l + m.r + m.t + m.b) === 0;

  return (
    <Shell title={t('Crop')} subtitle={`${doc.name} · ${plural(doc.pages, 'page', 'pages')}`} color="sage" onBack={onBack} onClose={onClose}
      footer={<button className="button" disabled={!!busy || edge || (scope === 'some' && (!count || !!only.problem))} onClick={() => void run()}>
        {edge ? t('Drag the frame to choose what to keep') : t('Crop {pages}', { pages: plural(count, 'page', 'pages') })}
      </button>}>
      <BigFileNotice bytes={doc.size} />
      {busy && <Busy label={busy.label} />}
      {(error || loadError) && <Notice>{error ?? loadError}</Notice>}

      <div className="crop-pager">
        <button className="icon-button" disabled={cur === 0} onClick={() => setCur(cur - 1)} aria-label={t('Previous page')}><BackIcon /></button>
        <span>{t('Page {a} of {b}', { a: cur + 1, b: doc.pages })}</span>
        <button className="icon-button" disabled={cur >= doc.pages - 1} onClick={() => setCur(cur + 1)} aria-label={t('Next page')}><span className="turn"><ArrowIcon /></span></button>
      </div>

      <div className={`crop-stage${drawn ? ' ready' : ''}`} ref={stage}>
        <canvas ref={canvas} />
        {drawn && (
          <div className="crop-mask" aria-hidden="true">
            <div className="crop-hole" style={{ left: `${m.l * 100}%`, top: `${m.t * 100}%`, right: `${m.r * 100}%`, bottom: `${m.b * 100}%` }} />
          </div>
        )}
        {drawn && (
          <div
            className="crop-rect"
            style={{ left: `${m.l * 100}%`, top: `${m.t * 100}%`, right: `${m.r * 100}%`, bottom: `${m.b * 100}%` }}
            onPointerDown={begin('move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            role="group"
            aria-label={t('Crop frame')}
          >
            {HANDLES.map((h) => (
              <span key={h} className={`crop-handle h-${h}`} data-handle={h} onPointerDown={begin(h)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
            ))}
          </div>
        )}
        {!drawn && <span className="peek-loading" />}
      </div>

      <div className="crop-controls">
        <button className="chip-button" onClick={autoTrim} disabled={!drawn}>{t('Trim to content')}</button>
        <button className="chip-button" onClick={() => setM({ l: 0, t: 0, r: 0, b: 0 })}>{t('Reset')}</button>
        <span className="tool-hint">{t('Keeps {w}% × {h}% of the page', { w: kept.w, h: kept.h })}</span>
      </div>

      <section className="tool-section">
        <h3 className="tool-label">{t('Crop')}</h3>
        <div className="segmented" role="tablist" aria-label={t('Pages to crop')}>
          <button role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>{t('All pages')}</button>
          <button role="tab" aria-selected={scope === 'some'} className={scope === 'some' ? 'on' : ''} onClick={() => setScope('some')}>{t('Only some pages')}</button>
        </div>
        {scope === 'some' && (
          <label className="tool-field">
            <span>{t('Pages to crop')}</span>
            <input value={rangeText} onChange={(e) => setRangeText(e.target.value)} placeholder={t('1-3, 5 (of {n})', { n: doc.pages })} autoComplete="off" spellCheck={false} />
            {only.problem && <Notice>{only.problem}</Notice>}
          </label>
        )}
        <p className="tool-hint">{t('The same frame is used on every chosen page, as a share of each page, so pages of different sizes are cut evenly.')}</p>
      </section>
    </Shell>
  );
}

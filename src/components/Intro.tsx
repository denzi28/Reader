import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../lib/i18n';
import { feel } from '../lib/haptics';
import { CloseIcon } from './icons';

const KEY = 'reader.intro';
export const introSeen = () => {
  try { return localStorage.getItem(KEY) === '1'; } catch { return true; }
};
export const markIntroSeen = () => {
  try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
};

/** Small pictures for each step, drawn from the same pages and strokes as the rest of the app. */
function Page({ x, y, w = 40, h = 52, tilt = 0 }: { x: number; y: number; w?: number; h?: number; tilt?: number }) {
  return (
    <g transform={tilt ? `rotate(${tilt} ${x + w / 2} ${y + h / 2})` : undefined}>
      <rect x={x} y={y} width={w} height={h} rx="4" className="art-page" />
      <path className="art-line" d={`M${x + 7} ${y + 12}h${w - 14}M${x + 7} ${y + 20}h${w - 14}M${x + 7} ${y + 28}h${w - 22}`} />
    </g>
  );
}
const Pic = ({ n }: { n: number }) => (
  <svg className="tool-art intro-art" viewBox="0 0 220 120" aria-hidden="true" focusable="false">
    {n === 0 && (
      <>
        <Page x={50} y={22} tilt={-8} /><Page x={110} y={22} tilt={7} /><Page x={80} y={14} />
        <circle cx="168" cy="86" r="17" className="intro-dot" />
        <path d="M168 78v16M160 86h16" className="intro-plus" />
      </>
    )}
    {n === 1 && (
      <>
        <Page x={26} y={30} />
        <path className="art-trail" d="M78 60h30" strokeDasharray="1 6" /><path className="art-head" d="M104 54l8 6-8 6" />
        <rect x="126" y="24" width="68" height="64" rx="5" className="art-page" />
        <path d="M160 24v64" className="art-line" />
        <path className="art-line" d="M133 38h20M133 46h20M133 54h14M168 38h20M168 46h20M168 54h14M168 62h18" />
      </>
    )}
    {n === 2 && (
      <>
        <Page x={34} y={20} w={64} h={80} />
        <rect x="42" y="48" width="48" height="9" rx="2" className="intro-hl" />
        <path d="M44 84c8-12 14 6 22-4s12 4 22-4" className="intro-ink" />
        <rect x="116" y="26" width="70" height="68" rx="6" className="art-page" />
        <rect x="124" y="36" width="22" height="5" rx="2.5" className="intro-title" />
        <rect x="124" y="50" width="9" height="9" rx="2.5" className="intro-check" /><path className="art-line" d="M139 55h38" />
        <rect x="124" y="66" width="9" height="9" rx="2.5" className="art-box" /><path className="art-line" d="M139 71h30" />
      </>
    )}
    {n === 3 && (
      <>
        <rect x="26" y="40" width="46" height="62" rx="8" className="art-page" /><rect x="33" y="50" width="32" height="38" rx="3" className="art-line-fill" />
        <rect x="124" y="46" width="76" height="50" rx="5" className="art-page" /><path d="M116 100h92l-6 8h-80z" className="art-page" />
        <path d="M96 36c-9 0-14 6-13 12-7 1-10 8-4 12 3 3 8 3 10 3h26c8 0 13-5 11-12-1-4-6-6-9-5-2-6-9-10-21-10z" className="intro-cloud" />
        <path d="M95 52l6 6 11-12" className="intro-tick" />
      </>
    )}
  </svg>
);

const STEPS = () => [
  { color: 'terra', title: t('Add your first document'), text: t('PDFs, ePub books, Word, Excel, PowerPoint, text and pictures. Drop files in, or tap Add. Scanned pages can be read into text.') },
  { color: 'sage', title: t('Read it your way'), text: t('Open a PDF as it is, or turn it into a book: clean text you can resize, with a page that turns. A button on every cover switches.') },
  { color: 'mustard', title: t('Mark it, write beside it'), text: t('Pen, highlighter and typed notes right on the page. Make a Notebook to draw in, or a Doc to type in, even for a single page.') },
  { color: 'plum', title: t('Yours, everywhere'), text: t('Sign in with Google and everything is kept in your own Drive: the same library on your phone, tablet and computer. It works with no connection, too.') },
];

/** A short tour for someone new: four steps, skippable at any time, shown once. */
export function Intro({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const steps = STEPS();
  const last = step === steps.length - 1;
  const card = useRef<HTMLDivElement>(null);
  const finish = () => { markIntroSeen(); onClose(); };
  useEffect(() => {
    card.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') setStep((s) => Math.min(steps.length - 1, s + 1));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const s = steps[step];
  return createPortal(
    <div className="intro-wrap" role="dialog" aria-modal="true" aria-label={t('A short tour')}>
      <div className="intro-scrim" onClick={finish} />
      <div className={`intro-card c-${s.color}`} ref={card} tabIndex={-1}>
        <button className="icon-button intro-x" onClick={finish} aria-label={t('Skip the tour')}><CloseIcon /></button>
        <div className="intro-pic" key={step}><Pic n={step} /></div>
        <h2 key={`t${step}`}>{s.title}</h2>
        <p key={`p${step}`}>{s.text}</p>
        <div className="intro-dots" role="tablist" aria-label={t('Steps')}>
          {steps.map((_, i) => <button key={i} role="tab" aria-selected={i === step} aria-label={t('Step {n} of {total}', { n: i + 1, total: steps.length })} className={i === step ? 'on' : ''} onClick={() => setStep(i)} />)}
        </div>
        <div className="intro-actions">
          {!last ? <button className="intro-skip" onClick={finish}>{t('Skip')}</button> : <span />}
          <button className="button intro-next" onClick={() => { feel('light'); if (last) finish(); else setStep(step + 1); }}>
            {last ? t('Get started') : t('Next')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

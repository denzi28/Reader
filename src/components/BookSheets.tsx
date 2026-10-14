import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '../lib/i18n';
import { searchBook } from '../lib/book/search';
import { chapterTitle, sliceText, type Book, type BookIndex, type Pos } from '../lib/book/model';
import {
  FONT_STACKS, HIGHLIGHT_NAMES, HIGHLIGHTS, SIZE_RANGE, WARMTH_RANGE, type BookFont, type BookSettings, type BookTheme, type HighlightColor,
} from '../lib/book/settings';
import type { BookMark } from '../lib/types';
import { CheckIcon, FileIcon, SearchIcon, TrashIcon, CloseIcon } from './icons';

/** A panel over the book: a sheet from the bottom on a phone, a card or a drawer beside it on a computer. */
export function BookSheet({ kind, label, onClose, children }: { kind: 'pop' | 'drawer'; label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <>
      <div className="bk-dim" onClick={onClose} aria-hidden="true" />
      <div className={`bk-panel bk-panel-${kind}`} role="dialog" aria-label={label}>
        <div className="bk-grab" aria-hidden="true" />
        {children}
      </div>
    </>
  );
}

const THEMES: { id: Exclude<BookTheme, 'auto'>; label: string }[] = [
  { id: 'paper', label: t('Paper') }, { id: 'sepia', label: t('Sepia') }, { id: 'mist', label: t('Mist') }, { id: 'night', label: t('Night') },
];
const HIGHLIGHT_LABEL: Record<HighlightColor, string> = {
  yellow: t('Yellow highlight'), green: t('Green highlight'), pink: t('Pink highlight'), blue: t('Blue highlight'),
};
const FONTS: { id: BookFont; label: string }[] = [
  { id: 'serif', label: t('Serif') }, { id: 'sans', label: t('Sans') }, { id: 'classic', label: t('Classic') }, { id: 'mono', label: t('Mono') },
];

function Seg<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="bk-seg" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} onClick={() => onPick(id)}>{text}</button>
      ))}
    </div>
  );
}

export function ReadingPanel({ settings, change, themeNow, wide, onPdf, imageOnly, zoom }: {
  settings: BookSettings;
  change: (c: Partial<BookSettings>) => void;
  /** The theme in force (so "auto" shows as the one it picked). */
  themeNow: Exclude<BookTheme, 'auto'>;
  /** A screen wide enough for two pages. */
  wide: boolean;
  onPdf?: () => void;
  /** Showing the PDF's own pages (not text): only the colours, the layout and eye comfort apply. */
  imageOnly?: boolean;
  /** The PDF's pages can be zoomed (only with `imageOnly`). */
  zoom?: { value: number; min: number; max: number; onChange: (v: number) => void; onFitPage: () => void; onFitWidth: () => void };
}) {
  return (
    <div className="bk-reading">
      <h3 className="bk-panel-title">{t('Reading')}</h3>
      <div className="bk-themes" role="radiogroup" aria-label={t('Page colour')}>
        {THEMES.map((th) => (
          <button key={th.id} role="radio" aria-checked={themeNow === th.id} aria-label={th.label} title={th.label}
            className={`bk-theme bk-t-${th.id}${themeNow === th.id ? ' on' : ''}`} onClick={() => change({ theme: th.id })}>Aa</button>
        ))}
      </div>
      {!imageOnly && (
        <>
      <div className="bk-lab">{t('Typeface')}</div>
      <div className="bk-fonts" role="radiogroup" aria-label={t('Typeface')}>
        {FONTS.map((f) => (
          <button key={f.id} role="radio" aria-checked={settings.font === f.id} className={settings.font === f.id ? 'on' : ''}
            style={{ fontFamily: FONT_STACKS[f.id], fontStyle: f.id === 'classic' ? 'italic' : undefined }} onClick={() => change({ font: f.id })}>{f.label}</button>
        ))}
      </div>
      <div className="bk-lab">{t('Size')}</div>
      <div className="bk-sizer">
        <span className="bk-a1" aria-hidden="true">A</span>
        <input type="range" className="bk-range" min={SIZE_RANGE[0]} max={SIZE_RANGE[1]} step={1} value={settings.size} aria-label={t('Text size')}
          onChange={(e) => change({ size: Number(e.target.value) })} />
        <span className="bk-a2" aria-hidden="true">A</span>
      </div>
      <div className="bk-lab">{t('Spacing')}</div>
      <Seg label={t('Line spacing')} value={settings.spacing} options={[['tight', t('Tight')], ['normal', t('Normal')], ['roomy', t('Roomy')]]} onPick={(spacing) => change({ spacing })} />
      <div className="bk-lab">{t('Margins')}</div>
      <Seg label={t('Margins')} value={settings.margins} options={[['narrow', t('Narrow')], ['medium', t('Medium')], ['wide', t('Wide')]]} onPick={(margins) => change({ margins })} />
        </>
      )}
      {imageOnly && zoom && (
        <>
          <div className="bk-lab">{t('Zoom · {n}%', { n: Math.round(zoom.value * 100) })}</div>
          <div className="bk-sizer">
            <span className="bk-a1" aria-hidden="true">−</span>
            <input type="range" className="bk-range" min={Math.round(Math.log(zoom.min) * 100)} max={Math.round(Math.log(zoom.max) * 100)} step={1}
              value={Math.round(Math.log(zoom.value) * 100)} aria-label={t('Zoom')} onChange={(e) => zoom.onChange(Math.exp(Number(e.target.value) / 100))} />
            <span className="bk-a1" aria-hidden="true">+</span>
          </div>
          <div className="bk-fits">
            <button className="chip-button" onClick={zoom.onFitPage}>{t('Whole page')}</button>
            <button className="chip-button" onClick={zoom.onFitWidth}>{t('Page width')}</button>
          </div>
        </>
      )}
      <div className="bk-lab">{wide || imageOnly ? t('Layout') : t('Turning pages')}</div>
      {wide ? (
        <Seg label={t('Layout')} value={settings.flow === 'scroll' ? 'scroll' : settings.spread}
          options={[['one', t('One page')], ['two', t('Two pages')], ['scroll', t('Scroll')]]}
          onPick={(v) => (v === 'scroll' ? change({ flow: 'scroll' }) : change({ flow: 'pages', spread: v }))} />
      ) : (
        <Seg label={t('Turning pages')} value={settings.flow} options={[['pages', t('Pages')], ['scroll', t('Scroll')]]} onPick={(flow) => change({ flow })} />
      )}
      <div className="bk-lab">{t('Eye comfort')}</div>
      <div className="bk-comfort">
        <label className="bk-switch">
          <span>{t('Warm filter')}<small>{t('Less blue light for night reading')}</small></span>
          <input type="checkbox" role="switch" checked={settings.comfort} onChange={(e) => change({ comfort: e.target.checked })} />
          <i aria-hidden="true" />
        </label>
        <div className="bk-sizer">
          <span className="bk-a1" aria-hidden="true">{t('Soft')}</span>
          <input type="range" className="bk-range" min={WARMTH_RANGE[0]} max={WARMTH_RANGE[1]} step={1} value={settings.warmth} disabled={!settings.comfort}
            aria-label={t('Filter strength')} onChange={(e) => change({ warmth: Number(e.target.value) })} />
          <span className="bk-a1" aria-hidden="true">{t('Warm')}</span>
        </div>
      </div>
      {onPdf && (
        <button className="bk-tog" onClick={onPdf}>
          <span>{t('Back to the original PDF')}<small>{t('Keeps the layout, figures and your pen marks')}</small></span>
          <FileIcon />
        </button>
      )}
    </div>
  );
}

type Tab = 'contents' | 'marks' | 'search';

export function ContentsPanel({ tab, onTab, book, ix, currentToc, marks, onGo, onDeleteMark, onEditNote, term, onTerm }: {
  tab: Tab;
  onTab: (t: Tab) => void;
  book: Book;
  ix: BookIndex;
  currentToc: number;
  marks: Record<string, BookMark>;
  onGo: (pos: Pos) => void;
  onDeleteMark: (id: string) => void;
  onEditNote: (id: string) => void;
  term: string;
  onTerm: (t: string) => void;
}) {
  const hits = useMemo(() => (tab === 'search' ? searchBook(ix, term) : []), [tab, ix, term]);
  const list = useMemo(
    () => Object.entries(marks).sort(([, a], [, b]) => a.a[0] - b.a[0] || a.a[1] - b.a[1]),
    [marks],
  );
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (tab === 'search') input.current?.focus(); }, [tab]);
  const current = useRef<HTMLLIElement>(null);
  useEffect(() => { if (tab === 'contents') current.current?.scrollIntoView({ block: 'center' }); }, [tab]);
  return (
    <div className="bk-contents">
      <div className="bk-tabs" role="tablist">
        {([['contents', t('Contents')], ['marks', list.length ? t('Marks · {n}', { n: list.length }) : t('Marks')], ['search', t('Search')]] as [Tab, string][]).map(([id, text]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => onTab(id)}>{text}</button>
        ))}
      </div>
      <div className="bk-tabbody">
        {tab === 'contents' && (
          <ul className="bk-toc">
            {book.toc.map((entry, i) => {
              const b = ix.first[entry.c] + entry.b;
              return (
                <li key={i} ref={i === currentToc ? current : undefined} className={`lvl-${Math.min(entry.level, 2)}${i === currentToc ? ' on' : ''}`}>
                  <button onClick={() => onGo({ b, o: 0 })} aria-current={i === currentToc ? 'location' : undefined}>
                    <span>{entry.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {tab === 'marks' && (list.length === 0 ? (
          <p className="bk-empty">{t('Select some words to highlight them, add a note, or tap the bookmark to keep your place.')}</p>
        ) : (
          <ul className="bk-marks">
            {list.map(([id, m]) => (
              <li key={id} className={m.k === 'bm' ? 'bm' : undefined}>
                <button className="bk-mark-go" onClick={() => onGo({ b: m.a[0], o: m.a[1] })}>
                  {m.k === 'bm' ? <b className="bk-mark-kind">{t('Bookmark')}</b> : (
                    <span className="bk-quote" style={{ ['--hl' as string]: HIGHLIGHTS[(m.c as HighlightColor) in HIGHLIGHTS ? (m.c as HighlightColor) : 'yellow'] }}>{m.q}</span>
                  )}
                  {m.k === 'bm' && m.q && <span className="bk-bm-line">{m.q}</span>}
                  {m.n && <span className="bk-note">{m.n}</span>}
                  <small>{chapterTitle(book, ix, m.a[0])}</small>
                </button>
                <span className="bk-mark-acts">
                  {m.k === 'hl' && <button aria-label={t('Edit note')} onClick={() => onEditNote(id)}>{m.n ? t('Edit') : t('Note')}</button>}
                  <button aria-label={t('Remove')} onClick={() => onDeleteMark(id)}><TrashIcon /></button>
                </span>
              </li>
            ))}
          </ul>
        ))}
        {tab === 'search' && (
          <>
            <label className="bk-find">
              <SearchIcon />
              <input ref={input} type="search" value={term} onChange={(e) => onTerm(e.target.value)} placeholder={t('Search this book')} aria-label={t('Search this book')} autoComplete="off" spellCheck={false} />
              {term && <button type="button" aria-label={t('Clear')} onClick={() => onTerm('')}><CloseIcon /></button>}
            </label>
            {term.trim().length >= 2 && <p className="bk-count">{hits.length === 0 ? t('Nothing found.') : t('{n} found', { n: `${hits.length}${hits.length >= 300 ? '+' : ''}` })}</p>}
            <ul className="bk-hits">
              {hits.map((h, i) => (
                <li key={i}>
                  <button onClick={() => onGo({ b: h.b, o: h.o })}>
                    <span>{h.before.length >= 36 ? '…' : ''}{h.before}<mark>{h.match}</mark>{h.after}</span>
                    <small>{chapterTitle(book, ix, h.b)}</small>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/** The little bar over a selection (to highlight it) or over a highlight (to change it). */
export function MarkBar({ rect, area, mode, color, hasNote, onColor, onNote, onCopy, onRemove }: {
  rect: { left: number; right: number; top: number; bottom: number };
  area: { width: number; height: number };
  mode: 'select' | 'mark';
  color?: HighlightColor;
  hasNote?: boolean;
  onColor: (c: HighlightColor) => void;
  onNote: () => void;
  onCopy?: () => void;
  onRemove?: () => void;
}) {
  const w = mode === 'select' ? 300 : 280;
  const above = rect.top > 76;
  const left = Math.min(Math.max(8, (rect.left + rect.right) / 2 - w / 2), Math.max(8, area.width - w - 8));
  const top = above ? rect.top - 54 : rect.bottom + 12;
  return (
    <div className={`bk-markbar ${above ? 'above' : 'below'}`} style={{ left, top }} role="toolbar" aria-label={mode === 'select' ? t('Highlight') : t('Highlight options')}
      onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}>
      {HIGHLIGHT_NAMES.map((c) => (
        <button key={c} className={`bk-dot${color === c ? ' on' : ''}`} style={{ ['--hl' as string]: HIGHLIGHTS[c] }} aria-label={HIGHLIGHT_LABEL[c]} onClick={() => onColor(c)}>
          {color === c && <CheckIcon />}
        </button>
      ))}
      <button className="bk-bar-btn" onClick={onNote}>{hasNote ? t('Note') : t('Add note')}</button>
      {onCopy && <button className="bk-bar-btn" onClick={onCopy}>{t('Copy')}</button>}
      {onRemove && <button className="bk-bar-btn bk-bar-icon" aria-label={t('Remove highlight')} onClick={onRemove}><TrashIcon /></button>}
    </div>
  );
}

export function NoteEditor({ quote, value, onSave, onCancel }: { quote: string; value: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  return (
    <>
      <div className="bk-dim" onClick={onCancel} aria-hidden="true" />
      <div className="bk-note-editor" role="dialog" aria-label={t('Note')}>
        {quote && <blockquote>{quote.length > 160 ? `${quote.slice(0, 160)}…` : quote}</blockquote>}
        <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Write a note…')} rows={4} aria-label={t('Note')} />
        <div className="bk-note-actions">
          <button className="chip-button" onClick={onCancel}>{t('Cancel')}</button>
          <button className="button button-small" onClick={() => onSave(text.trim())}>{t('Save')}</button>
        </div>
      </div>
    </>
  );
}

export { sliceText };

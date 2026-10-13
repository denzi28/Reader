import { useState } from 'react';
import { usePhone } from '../lib/usePhone';
import {
  BRUSH_RANGE, BRUSH_SIZES, displayColor, HIGHLIGHT_COLORS, PEN_COLORS, TEXT_RANGE, TEXT_SIZES,
} from '../lib/ink';
import type { ToolPrefs } from '../lib/toolPrefs';
import type { Tool } from '../lib/types';
import {
  EraserIcon, HandIcon, HighlighterIcon, LassoIcon, MinusIcon,
  MoreHIcon, PenIcon, PlusIcon, RedoIcon, SelectAllIcon, TextNoteIcon, TrashIcon, UndoIcon,
} from './icons';

interface Props {
  tool: Tool;
  onTool: (t: Tool) => void;
  prefs: ToolPrefs;
  onPrefs: (change: Partial<ToolPrefs>) => void;
  /** The menu of the chosen tool is shown above the bar. */
  panel: boolean;
  onPanel: (open: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  /** Zoom by a factor (1.2 is a step in, 1/1.2 a step out). */
  onZoomBy: (factor: number) => void;
  dark: boolean;
  /** Clears every mark on the page being read. */
  onClearPage: () => void;
  onSelectAll: () => void;
}

const TOOLS: { id: Tool; label: string; hint: string; icon: () => React.JSX.Element; key: string }[] = [
  { id: 'hand', label: 'Read', hint: 'Read and scroll (H)', icon: HandIcon, key: 'h' },
  { id: 'pen', label: 'Pen', hint: 'Pen (P)', icon: PenIcon, key: 'p' },
  { id: 'highlighter', label: 'Highlighter', hint: 'Highlighter (L). Hold still for a straight line', icon: HighlighterIcon, key: 'l' },
  { id: 'eraser', label: 'Eraser', hint: 'Eraser (E)', icon: EraserIcon, key: 'e' },
  { id: 'select', label: 'Select', hint: 'Select, move and resize notes (S)', icon: LassoIcon, key: 's' },
  { id: 'text', label: 'Text note', hint: 'Type a note on the page (T)', icon: TextNoteIcon, key: 't' },
];

const pct = (v: number, [lo, hi]: [number, number]) => Math.round(((v - lo) / (hi - lo)) * 100);
const at = (p: number, [lo, hi]: [number, number]) => lo + (p / 100) * (hi - lo);

function Swatches({ colors, value, dark, onPick }: { colors: string[]; value: string; dark: boolean; onPick: (c: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Colour">
      {colors.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          className={`swatch${c === value ? ' on' : ''}`}
          style={{ ['--c' as string]: displayColor(c, dark) }}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

/** Thickness: three presets and a slider between them, with a line showing the result. */
function Thickness({ label, value, range, presets, color, line, onChange }: {
  label: string;
  value: number;
  range: [number, number];
  presets: [number, number, number];
  color: string;
  /** What the preview draws: a stroke, or letters. */
  line: 'pen' | 'highlighter' | 'text';
  onChange: (v: number) => void;
}) {
  return (
    <div className="thickness">
      <div className="sizes" role="radiogroup" aria-label={label}>
        {presets.map((v, i) => (
          <button
            key={i}
            role="radio"
            aria-checked={Math.abs(value - v) < (range[1] - range[0]) * 0.02}
            aria-label={['Fine', 'Medium', 'Broad'][i]}
            className={`size${Math.abs(value - v) < (range[1] - range[0]) * 0.02 ? ' on' : ''}`}
            onClick={() => onChange(v)}
          >
            <i style={{ width: 6 + i * 5, height: 6 + i * 5 }} />
          </button>
        ))}
      </div>
      <input
        className="range"
        type="range"
        min={0}
        max={100}
        value={pct(value, range)}
        aria-label={label}
        onChange={(e) => onChange(at(Number(e.target.value), range))}
      />
      <span className="preview" aria-hidden="true">
        {line === 'text' ? (
          <b style={{ color, fontSize: 10 + pct(value, range) * 0.2 }}>Aa</b>
        ) : (
          <i style={{ background: color, height: Math.max(2, ((value - range[0]) / (range[1] - range[0])) * 16 + 2), opacity: line === 'highlighter' ? 0.55 : 1 }} />
        )}
      </span>
    </div>
  );
}

function Panel(p: Props) {
  const { prefs, onPrefs, dark } = p;
  if (p.tool === 'pen') {
    return (
      <>
        <Swatches colors={PEN_COLORS} value={prefs.penColor} dark={dark} onPick={(c) => onPrefs({ penColor: c })} />
        <Thickness label="Pen thickness" value={prefs.penSize} range={BRUSH_RANGE.pen} presets={BRUSH_SIZES.pen}
          color={displayColor(prefs.penColor, dark)} line="pen" onChange={(v) => onPrefs({ penSize: v })} />
      </>
    );
  }
  if (p.tool === 'highlighter') {
    return (
      <>
        <Swatches colors={HIGHLIGHT_COLORS} value={prefs.hlColor} dark={dark} onPick={(c) => onPrefs({ hlColor: c })} />
        <Thickness label="Highlighter thickness" value={prefs.hlSize} range={BRUSH_RANGE.highlighter} presets={BRUSH_SIZES.highlighter}
          color={displayColor(prefs.hlColor, dark)} line="highlighter" onChange={(v) => onPrefs({ hlSize: v })} />
        <p className="panel-hint">Hold still while you drag to make a straight line.</p>
      </>
    );
  }
  if (p.tool === 'text') {
    return (
      <>
        <Swatches colors={PEN_COLORS} value={prefs.penColor} dark={dark} onPick={(c) => onPrefs({ penColor: c })} />
        <Thickness label="Text size" value={prefs.textSize} range={TEXT_RANGE} presets={TEXT_SIZES}
          color={displayColor(prefs.penColor, dark)} line="text" onChange={(v) => onPrefs({ textSize: v })} />
        <p className="panel-hint">Tap the page to type a note. Tap a note to edit it.</p>
      </>
    );
  }
  if (p.tool === 'eraser') {
    return (
      <>
        <div className="segmented small" role="radiogroup" aria-label="Eraser kind">
          {([['stroke', 'Stroke eraser'], ['area', 'Area eraser']] as const).map(([id, text]) => (
            <button key={id} role="radio" aria-checked={prefs.eraserMode === id} className={prefs.eraserMode === id ? 'on' : ''}
              onClick={() => onPrefs({ eraserMode: id })}>{text}</button>
          ))}
        </div>
        <label className="panel-row">
          <span>Size</span>
          <input className="range" type="range" min={0} max={100} aria-label="Eraser size"
            value={pct(prefs.eraserSize, [0.004, 0.06])} onChange={(e) => onPrefs({ eraserSize: at(Number(e.target.value), [0.004, 0.06]) })} />
        </label>
        <label className="panel-row toggle">
          <span>Erase only highlighter</span>
          <input type="checkbox" role="switch" checked={prefs.eraserOnlyHl} onChange={(e) => onPrefs({ eraserOnlyHl: e.target.checked })} />
          <i aria-hidden="true" />
        </label>
        <button className="panel-action danger" onClick={p.onClearPage}><TrashIcon /> Erase everything on this page</button>
      </>
    );
  }
  if (p.tool === 'select') {
    return (
      <>
        <p className="panel-hint">Draw a loop around your notes to select them, or tap one. Drag to move, use the corners to resize.</p>
        <button className="panel-action" onClick={p.onSelectAll}><SelectAllIcon /> Select everything on this page</button>
      </>
    );
  }
  return null;
}

/** On a phone the bar keeps the four tools in constant use; selecting, typing and zooming wait behind a "more" button. */
const PRIMARY: Tool[] = ['hand', 'pen', 'highlighter', 'eraser'];

export function Toolbar(p: Props) {
  const phone = usePhone();
  const [more, setMore] = useState(false);
  const open = p.panel && p.tool !== 'hand';
  const dots: Partial<Record<Tool, string>> = { pen: p.prefs.penColor, highlighter: p.prefs.hlColor, text: p.prefs.penColor };
  const shown = phone ? TOOLS.filter((t) => PRIMARY.includes(t.id)) : TOOLS;
  const moreActive = p.tool === 'select' || p.tool === 'text';
  return (
    <div className={`toolbar-wrap${phone ? ' phone-tray' : ' dock'}`}>
      <div className={`options${open ? ' open' : ''}`} aria-hidden={!open} role="group" aria-label={`${TOOLS.find((t) => t.id === p.tool)?.label} options`}>
        {open && <Panel {...p} />}
      </div>

      {phone && more && (
        <>
          <div className="more-scrim" onClick={() => setMore(false)} />
          <div className="morepop" role="menu" aria-label="More tools">
            {TOOLS.filter((t) => !PRIMARY.includes(t.id)).map(({ id, icon: Ico }) => (
              <button key={id} role="menuitemradio" aria-checked={p.tool === id} className={`morepop-item${p.tool === id ? ' on' : ''}`}
                onClick={() => { setMore(false); p.onTool(id); }}>
                <Ico /><span>{id === 'select' ? 'Select' : 'Type a note'}</span>
              </button>
            ))}
            <div className="morepop-zoom" role="group" aria-label="Zoom">
              <button className="tool" onClick={() => p.onZoomBy(1 / 1.2)} aria-label="Zoom out"><MinusIcon /></button>
              <span className="zoom-label">{Math.round(p.zoom * 100)}%</span>
              <button className="tool" onClick={() => p.onZoomBy(1.2)} aria-label="Zoom in"><PlusIcon /></button>
            </div>
          </div>
        </>
      )}

      <div className="toolbar" role="toolbar" aria-label="Reader tools">
        <div className="group">
          {shown.map(({ id, label, hint, icon: Ico }) => (
            <button
              key={id}
              className={`tool${p.tool === id ? ' on' : ''}`}
              // The chosen tool opens and closes its own menu; any other becomes the chosen one.
              onClick={() => { setMore(false); if (p.tool === id && id !== 'hand') p.onPanel(!p.panel); else p.onTool(id); }}
              aria-pressed={p.tool === id}
              aria-label={label}
              title={hint}
            >
              <Ico />
              {dots[id] && <span className="tool-dot" style={{ background: displayColor(dots[id]!, p.dark) }} />}
            </button>
          ))}
          {phone && (
            <button className={`tool${moreActive || more ? ' on' : ''}`} onClick={() => setMore((v) => !v)} aria-expanded={more} aria-haspopup="menu" aria-label="More tools" title="Select, type a note, zoom">
              <MoreHIcon />
            </button>
          )}
        </div>
        <span className="sep" />
        <div className="group">
          <button className="tool" onClick={p.onUndo} disabled={!p.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
            <UndoIcon />
          </button>
          <button className="tool" onClick={p.onRedo} disabled={!p.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <RedoIcon />
          </button>
        </div>
        {!phone && (
          <>
            <span className="sep zoom-sep" />
            <div className="group zoom">
              <button className="tool" onClick={() => p.onZoomBy(1 / 1.2)} aria-label="Zoom out" title="Zoom out">
                <MinusIcon />
              </button>
              <span className="zoom-label">{Math.round(p.zoom * 100)}%</span>
              <button className="tool" onClick={() => p.onZoomBy(1.2)} aria-label="Zoom in" title="Zoom in">
                <PlusIcon />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

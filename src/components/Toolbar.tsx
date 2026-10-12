import { displayColor, HIGHLIGHT_COLORS, PEN_COLORS } from '../lib/ink';
import type { Tool } from '../lib/types';
import {
  EraserIcon, HighlighterIcon, MinusIcon,
  PenIcon, PlusIcon, RedoIcon, UndoIcon,
} from './icons';

interface Props {
  tool: Tool;
  onTool: (t: Tool) => void;
  penColor: string;
  hlColor: string;
  onPenColor: (c: string) => void;
  onHlColor: (c: string) => void;
  sizeIdx: number;
  onSize: (i: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoom: (z: number) => void;
  dark: boolean;
}

const TOOLS: { id: Tool; label: string; hint?: string; icon: () => React.JSX.Element }[] = [
  { id: 'pen', label: 'Pen', icon: PenIcon },
  { id: 'highlighter', label: 'Highlighter', hint: 'Highlighter (hold still for a straight line)', icon: HighlighterIcon },
  { id: 'eraser', label: 'Eraser', icon: EraserIcon },
];

export function Toolbar(p: Props) {
  const inking = p.tool === 'pen' || p.tool === 'highlighter';
  const colors = p.tool === 'highlighter' ? HIGHLIGHT_COLORS : PEN_COLORS;
  const color = p.tool === 'highlighter' ? p.hlColor : p.penColor;
  const setColor = p.tool === 'highlighter' ? p.onHlColor : p.onPenColor;

  return (
    <div className="toolbar-wrap">
      <div className={`options${inking ? ' open' : ''}`} aria-hidden={!inking}>
        {inking && (
          <div className="swatches" role="radiogroup" aria-label="Colour">
            {colors.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={c === color}
                aria-label={c}
                className={`swatch${c === color ? ' on' : ''}`}
                style={{ ['--c' as string]: displayColor(c, p.dark) }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        )}
        {inking && (
          <div className="sizes" role="radiogroup" aria-label="Brush size">
            {[0, 1, 2].map((i) => (
              <button
                key={i}
                role="radio"
                aria-checked={p.sizeIdx === i}
                aria-label={['Fine', 'Medium', 'Broad'][i]}
                className={`size${p.sizeIdx === i ? ' on' : ''}`}
                onClick={() => p.onSize(i)}
              >
                <i style={{ width: 6 + i * 5, height: 6 + i * 5 }} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="toolbar" role="toolbar" aria-label="Reader tools">
        <div className="group">
          {TOOLS.map(({ id, label, hint, icon: Ico }) => (
            <button
              key={id}
              className={`tool${p.tool === id ? ' on' : ''}`}
              onClick={() => p.onTool(p.tool === id ? 'hand' : id)}
              aria-pressed={p.tool === id}
              aria-label={label}
              title={hint ?? label}
            >
              <Ico />
              {(id === 'pen' || id === 'highlighter') && (
                <span
                  className="tool-dot"
                  style={{ background: displayColor(id === 'pen' ? p.penColor : p.hlColor, p.dark) }}
                />
              )}
            </button>
          ))}
        </div>
        <span className="sep" />
        <div className="group">
          <button className="tool" onClick={p.onUndo} disabled={!p.canUndo} aria-label="Undo" title="Undo">
            <UndoIcon />
          </button>
          <button className="tool" onClick={p.onRedo} disabled={!p.canRedo} aria-label="Redo" title="Redo">
            <RedoIcon />
          </button>
        </div>
        <span className="sep" />
        <div className="group zoom">
          <button className="tool" onClick={() => p.onZoom(p.zoom / 1.2)} aria-label="Zoom out" title="Zoom out">
            <MinusIcon />
          </button>
          <span className="zoom-label">{Math.round(p.zoom * 100)}%</span>
          <button className="tool" onClick={() => p.onZoom(p.zoom * 1.2)} aria-label="Zoom in" title="Zoom in">
            <PlusIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

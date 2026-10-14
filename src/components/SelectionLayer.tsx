import { useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { displayColor, HIGHLIGHT_COLORS, PEN_COLORS } from '../lib/ink';
import { IDENTITY, simPoint, type Box, type Sim } from '../lib/inkOps';
import type { PointerHub } from '../lib/pointerHub';
import { CopyIcon, PasteIcon, PencilIcon, ScissorsIcon, StyleIcon, TrashIcon } from './icons';

/** What the buttons over a selection can do; the viewer carries them out. */
export interface SelectionApi {
  cut: (page: number, ids: string[]) => void;
  copy: (page: number, ids: string[]) => void;
  paste: (page: number) => void;
  remove: (page: number, ids: string[]) => void;
  /** Colour and/or one of the three thicknesses (0 fine, 1 medium, 2 broad). */
  style: (page: number, ids: string[], change: { color?: string; size?: 0 | 1 | 2 }) => void;
  canPaste: boolean;
}

interface Props {
  page: number;
  ids: string[];
  box: Box;
  /** CSS width of the page: the unit of `box`. */
  width: number;
  /** Rotating makes no sense for typed notes, which stay upright. */
  canTurn: boolean;
  /** The one typed note selected, if that is all there is: it can be edited. */
  onEdit?: () => void;
  /** Which kind of palette the style menu offers. */
  highlighter: boolean;
  dark: boolean;
  hub: PointerHub;
  api: SelectionApi;
  /** While being dragged, the selection's change so far (null once it is dropped). */
  onLive: (sim: Sim | null) => void;
  onDone: (sim: Sim) => void;
}

type Corner = 'nw' | 'ne' | 'se' | 'sw';
const CORNERS: Corner[] = ['nw', 'ne', 'se', 'sw'];
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

const corner = (b: Box, c: Corner): [number, number] => [
  c === 'nw' || c === 'sw' ? b.x : b.x + b.w,
  c === 'nw' || c === 'ne' ? b.y : b.y + b.h,
];
const opposite = (c: Corner): Corner => ({ nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' } as const)[c];

/** The box, frame handles and buttons drawn over what is selected. */
export function SelectionLayer(p: Props) {
  const { box, width } = p;
  const root = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<Sim | null>(null);
  const [styling, setStyling] = useState(false);
  const gesture = useRef<{
    kind: 'move' | 'scale' | 'turn';
    id: number;
    x0: number;
    y0: number;
    corner?: Corner;
    sim: Sim;
  } | null>(null);

  const pageRect = () => root.current!.parentElement!.getBoundingClientRect();
  const norm = (e: React.PointerEvent): [number, number] => {
    const r = pageRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width];
  };

  const stop = (apply: boolean) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (p.hub.cancelStroke === cancel) p.hub.cancelStroke = null;
    setLive(null);
    p.onLive(null);
    if (apply && (g.sim.dx || g.sim.dy || g.sim.turn || g.sim.scale !== 1)) p.onDone(g.sim);
  };
  const cancel = () => stop(false);

  const begin = (e: React.PointerEvent, kind: 'move' | 'scale' | 'turn', c?: Corner) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (p.hub.gesture) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x0, y0] = norm(e);
    gesture.current = { kind, id: e.pointerId, x0, y0, corner: c, sim: IDENTITY };
    p.hub.cancelStroke = cancel;
    setStyling(false);
  };

  const move = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const [x, y] = norm(e);
    let sim: Sim;
    if (g.kind === 'move') {
      sim = { ...IDENTITY, dx: x - g.x0, dy: y - g.y0 };
    } else if (g.kind === 'scale') {
      const [px, py] = corner(box, opposite(g.corner!));
      const [hx, hy] = corner(box, g.corner!);
      const vx = hx - px;
      const vy = hy - py;
      const along = ((x - px) * vx + (y - py) * vy) / (vx * vx + vy * vy || 1);
      sim = { ...IDENTITY, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, along)), px, py };
    } else {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      let turn = Math.atan2(y - cy, x - cx) - Math.atan2(g.y0 - cy, g.x0 - cx);
      // A light pull to every 15 degrees makes upright easy to find.
      const step = Math.PI / 12;
      const near = Math.round(turn / step) * step;
      if (Math.abs(turn - near) < 0.05) turn = near;
      sim = { ...IDENTITY, turn, px: cx, py: cy };
    }
    g.sim = sim;
    setLive(sim);
    p.onLive(sim);
  };

  const up = (e: React.PointerEvent, apply: boolean) => {
    if (gesture.current?.id === e.pointerId) stop(apply);
  };
  const handlers = (kind: 'move' | 'scale' | 'turn', c?: Corner) => ({
    onPointerDown: (e: React.PointerEvent) => begin(e, kind, c),
    onPointerMove: move,
    onPointerUp: (e: React.PointerEvent) => up(e, true),
    onPointerCancel: (e: React.PointerEvent) => up(e, false),
  });

  // Where the frame is drawn while it is being dragged.
  let shown = box;
  let turnDeg = 0;
  if (live) {
    if (gesture.current?.kind === 'turn') {
      turnDeg = (live.turn * 180) / Math.PI;
    } else {
      const pts = (['nw', 'ne', 'se', 'sw'] as Corner[]).map((c) => simPoint(live, ...corner(box, c)));
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      shown = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
  }
  const frame = {
    left: shown.x * width,
    top: shown.y * width,
    width: shown.w * width,
    height: shown.h * width,
  };
  const below = frame.top < (p.canTurn ? 104 : 60);

  return (
    <div ref={root} className="sel-layer" aria-label={t('Selected notes')}>
      <div className="sel-frame" style={{ ...frame, transform: turnDeg ? `rotate(${turnDeg}deg)` : undefined }}>
        <div className="sel-body" {...handlers('move')} />
        {CORNERS.map((c) => (
          <span
            key={c}
            className={`sel-handle ${c}`}
            role="button"
            aria-label={{ nw: t('Resize from the top left corner'), ne: t('Resize from the top right corner'), se: t('Resize from the bottom right corner'), sw: t('Resize from the bottom left corner') }[c]}
            {...handlers('scale', c)}
          />
        ))}
        {p.canTurn && <span className="sel-turn" role="button" aria-label={t('Rotate')} {...handlers('turn')} />}
      </div>

      {!live && (
        <div
          className={`sel-menu${below ? ' below' : ''}${p.canTurn ? ' turnable' : ''}`}
          style={{ left: Math.min(Math.max(frame.left + frame.width / 2, 130), Math.max(130, width - 130)), top: below ? frame.top + frame.height : frame.top }}
          role="toolbar"
          aria-label={t('Selection')}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button onClick={() => p.api.cut(p.page, p.ids)}><ScissorsIcon /><span>{t('Cut')}</span></button>
          <button onClick={() => p.api.copy(p.page, p.ids)}><CopyIcon /><span>{t('Copy')}</span></button>
          {p.api.canPaste && <button onClick={() => p.api.paste(p.page)}><PasteIcon /><span>{t('Paste')}</span></button>}
          <button onClick={() => p.api.remove(p.page, p.ids)}><TrashIcon /><span>{t('Delete')}</span></button>
          {p.onEdit && <button onClick={p.onEdit}><PencilIcon /><span>{t('Edit')}</span></button>}
          <button aria-expanded={styling} onClick={() => setStyling((v) => !v)}><StyleIcon /><span>{t('Style')}</span></button>
          {styling && (
            <div className="sel-style">
              <div className="swatches" role="radiogroup" aria-label={t('Colour')}>
                {(p.highlighter ? HIGHLIGHT_COLORS : PEN_COLORS).map((c) => (
                  <button key={c} role="radio" aria-checked={false} aria-label={c} className="swatch"
                    style={{ ['--c' as string]: displayColor(c, p.dark) }} onClick={() => p.api.style(p.page, p.ids, { color: c })} />
                ))}
              </div>
              <div className="sizes" role="group" aria-label={t('Thickness')}>
                {[0, 1, 2].map((i) => (
                  <button key={i} className="size" aria-label={[t('Fine'), t('Medium'), t('Broad')][i]}
                    onClick={() => p.api.style(p.page, p.ids, { size: i as 0 | 1 | 2 })}>
                    <i style={{ width: 6 + i * 5, height: 6 + i * 5 }} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


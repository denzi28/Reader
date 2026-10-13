import { useLayoutEffect, useRef, type ReactNode } from 'react';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

const KEY = 'reader.cards.corner';
export function loadCorner(): Corner {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'tl' || v === 'tr' || v === 'bl' || v === 'br') return v;
  } catch { /* storage unavailable */ }
  return 'tr';
}
export function saveCorner(c: Corner) {
  try { localStorage.setItem(KEY, c); } catch { /* ignore */ }
}

const MOVE = 8; // px before a press becomes a drag

/**
 * The corner cards. Drag them anywhere and let go: they settle in the nearest
 * corner, which is remembered. A press that doesn't move is a tap on a card.
 */
export function LinkStack({ corner, onCorner, label, children }: {
  corner: Corner;
  onCorner: (c: Corner) => void;
  label: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean; card: HTMLElement } | null>(null);
  const swallow = useRef(false);
  /** Where the stack was let go, so that it can glide from there to its corner. */
  const from = useRef<DOMRect | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    const was = from.current;
    from.current = null;
    if (!el || !was) return;
    const now = el.getBoundingClientRect();
    el.style.transition = 'none';
    el.style.transform = `translate(${was.left - now.left}px, ${was.top - now.top}px)`;
    void el.offsetWidth;
    el.style.transition = 'transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.1)';
    el.style.transform = '';
  }, [corner]);

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const card = (e.target as HTMLElement).closest<HTMLElement>('.link-card-open');
    if (!card) return; // the little × is an ordinary button
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, card };
    swallow.current = false;
    // Held from the first touch, so a mouse that leaves the card mid-drag is still followed.
    box.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = box.current;
    if (!d || d.id !== e.pointerId || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < MOVE) return;
      d.moved = true;
      el.classList.add('dragging');
    }
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const onUp = (e: React.PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    const el = box.current;
    if (!d || d.id !== e.pointerId || !el) return;
    drag.current = null;
    if (!d.moved) {
      // A tap. The captured pointer sends its click to the stack, so the card is pressed here.
      if (!cancelled) d.card.click();
      return;
    }
    swallow.current = true; // the click that follows a drag is not a tap on a card
    setTimeout(() => { swallow.current = false; }, 60);
    el.classList.remove('dragging');
    const r = el.getBoundingClientRect();
    const next: Corner = cancelled
      ? corner
      : `${e.clientY < innerHeight / 2 ? 't' : 'b'}${e.clientX < innerWidth / 2 ? 'l' : 'r'}` as Corner;
    if (next === corner) {
      // Back where it was: glide home.
      el.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1)';
      el.style.transform = '';
      return;
    }
    from.current = r;
    saveCorner(next);
    onCorner(next);
  };

  return (
    <div
      ref={box}
      className={`link-stack corner-${corner}`}
      aria-label={label}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={(e) => onUp(e, false)}
      onPointerCancel={(e) => onUp(e, true)}
      onClickCapture={(e) => { if (swallow.current) { e.stopPropagation(); e.preventDefault(); } }}
    >
      {children}
    </div>
  );
}

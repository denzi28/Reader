// "Liquid glass" for controls: a light that follows the pointer, a press that squashes and springs back,
// a glass bead that stretches toward the tab it moves to (and follows a finger or a mouse dragged along
// the bar), and a small glow where a finger lands. Works the same for a mouse, a finger and a pen.
import { useLayoutEffect, type RefObject } from 'react';

/** Controls that get the light and the press (the bars of tabs have their own). */
const CONTROLS = '.icon-button, .tool, .bk-icon, .bk-tool, .nav-tool, .pn-item, .pn-plus, .top-tabs button, .account-btn, .tool-btn, .install-go, .install-x, .wb-item';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let started = false;

/** Listens once for the whole page, so no control needs to know about it. */
export function startLiquid() {
  if (started || typeof window === 'undefined') return;
  started = true;
  let frame = 0;
  let last: PointerEvent | null = null;
  // The light follows a mouse over a control (a finger has no hover).
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    last = e;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const t = (last?.target as Element | null)?.closest?.(CONTROLS) as HTMLElement | null;
      if (!t || !last) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', `${last.clientX - r.left}px`);
      t.style.setProperty('--my', `${last.clientY - r.top}px`);
    });
  }, { passive: true });

  // A finger leaves a soft glow where it lands. (In the body, not inside the control: React owns the control.)
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || reduced()) return;
    if (!(e.target as Element | null)?.closest?.(CONTROLS)) return;
    const d = document.createElement('div');
    d.className = 'lq-tap';
    d.style.left = `${e.clientX}px`;
    d.style.top = `${e.clientY}px`;
    document.body.appendChild(d);
    d.addEventListener('animationend', () => d.remove(), { once: true });
  }, { passive: true });

  // Icons pop when pressed and let go: a little overshoot, like a drop settling.
  window.addEventListener('click', (e) => {
    if (reduced()) return;
    const t = (e.target as Element | null)?.closest?.(CONTROLS) as HTMLElement | null;
    const icon = t?.querySelector('svg');
    if (!t || !icon || (t as HTMLButtonElement).disabled) return;
    const plus = t.classList.contains('pn-plus');
    icon.animate(
      plus
        ? [{ transform: 'rotate(-90deg) scale(0.7)' }, { transform: 'rotate(14deg) scale(1.2)', offset: 0.6 }, { transform: 'rotate(0) scale(1)' }]
        : [{ transform: 'scale(0.72) rotate(-10deg)' }, { transform: 'scale(1.22) rotate(5deg)', offset: 0.55 }, { transform: 'scale(1) rotate(0)' }],
      { duration: 560, easing: 'cubic-bezier(0.3, 1.4, 0.5, 1)' },
    );
  }, { passive: true });
}

/**
 * A bar of tabs with a glass bead under the current one. When the current one changes the bead's front edge
 * runs ahead and the back edge follows, so it stretches and settles with a little spring. Pressing squashes it;
 * dragging along the bar carries it, and letting go picks the tab it is over. `items` finds the tabs.
 */
export function useLiquidBar(ref: RefObject<HTMLElement | null>, items: string, watch: unknown) {
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    let pill = bar.querySelector<HTMLElement>(':scope > .lq-pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'lq-pill';
      pill.setAttribute('aria-hidden', 'true');
      bar.prepend(pill);
    }
    const bead = pill;
    const list = () => Array.from(bar.querySelectorAll<HTMLElement>(items));
    const current = () => list().findIndex((el) => el.classList.contains('on') || el.getAttribute('aria-current') === 'page');
    const box = (el: HTMLElement) => ({ l: el.offsetLeft, r: bar.clientWidth - el.offsetLeft - el.offsetWidth });
    const set = (l: number, r: number) => { bead.style.left = `${l}px`; bead.style.right = `${r}px`; };
    let at = -1;

    const place = (animate: boolean) => {
      const i = current();
      const els = list();
      if (i < 0 || !els[i]) { bead.style.opacity = '0'; return; }
      bead.style.opacity = '1';
      const to = box(els[i]);
      const first = at < 0 || bead.style.left === '';
      if (first || !animate || reduced()) { bead.style.transition = 'none'; set(to.l, to.r); void bead.offsetWidth; bead.style.transition = ''; at = i; return; }
      const from = parseFloat(bead.style.left);
      const right = to.l > from; // moving right: the right edge leads
      bead.style.transition = `${right ? 'right' : 'left'} 0.34s cubic-bezier(0.3, 1.45, 0.5, 1), ${right ? 'left' : 'right'} 0.5s cubic-bezier(0.3, 1.05, 0.4, 1), transform 0.35s cubic-bezier(0.3, 1.6, 0.5, 1), box-shadow 0.3s`;
      set(to.l, to.r);
      at = i;
    };
    place(false);
    // (a window that turns or resizes: the bead just goes to its place)
    const ro = new ResizeObserver(() => place(false));
    ro.observe(bar);
    void document.fonts?.ready.then(() => place(false));

    // ---- press and drag
    let down = false;
    let moved = false;
    let startX = 0;
    let quiet = 0;
    const nearest = (x: number) => {
      let best = 0;
      let dist = Infinity;
      list().forEach((el, k) => { const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - x); if (d < dist) { dist = d; best = k; } });
      return best;
    };
    const clear = () => { list().forEach((el) => el.classList.remove('lq-press', 'lq-hot')); bead.classList.remove('lq-squash', 'lq-drag'); };
    const onDown = (e: PointerEvent) => {
      if (e.button > 0 || !(e.target as Element).closest(items)) return;
      down = true; moved = false; startX = e.clientX;
      (e.target as Element).closest<HTMLElement>(items)?.classList.add('lq-press');
      bead.classList.add('lq-squash');
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      if (!moved && Math.abs(e.clientX - startX) < 6) return;
      moved = true;
      bead.classList.remove('lq-squash'); bead.classList.add('lq-drag');
      list().forEach((el) => el.classList.remove('lq-press'));
      const els = list();
      const base = bar.getBoundingClientRect();
      const x = e.clientX - base.left;
      const w = (els[Math.max(0, current())] ?? els[0]).offsetWidth;
      const l = Math.max(2, Math.min(bar.clientWidth - w - 2, x - w / 2));
      bead.style.transition = 'transform 0.3s cubic-bezier(0.3, 1.6, 0.5, 1), box-shadow 0.3s, left 0.09s linear, right 0.09s linear';
      set(l, bar.clientWidth - l - w);
      const n = nearest(x);
      els.forEach((el, k) => el.classList.toggle('lq-hot', k === n));
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      down = false;
      const wasMoved = moved;
      const x = e.clientX - bar.getBoundingClientRect().left;
      clear();
      if (!wasMoved) return; // a plain tap: the control's own click does the rest
      const n = nearest(x);
      const els = list();
      if (n !== current()) els[n]?.click(); // the page moves; the bead is carried to it by the change
      else place(true);
      // (and the click the browser sends after a drag is not a tap on the tab the drag began on)
      window.clearTimeout(quiet);
      quiet = window.setTimeout(() => { quiet = 0; }, 80);
    };
    // the click that follows a drag is not a tap on the tab it started on
    const onClick = (e: MouseEvent) => { if (quiet) { e.stopPropagation(); e.preventDefault(); } };
    const onPlace = () => place(true);
    bar.addEventListener('lq-place', onPlace);
    bar.addEventListener('pointerdown', onDown);
    bar.addEventListener('click', onClick, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      ro.disconnect();
      bar.removeEventListener('lq-place', onPlace);
      bar.removeEventListener('pointerdown', onDown);
      bar.removeEventListener('click', onClick, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.clearTimeout(quiet);
      bead.remove();
    };
  }, [ref, items]);

  // the current tab changed: the bead goes to it
  useLayoutEffect(() => {
    const bar = ref.current;
    const bead = bar?.querySelector<HTMLElement>(':scope > .lq-pill');
    if (!bar || !bead) return;
    bar.dispatchEvent(new CustomEvent('lq-place'));
  }, [ref, watch]);
}

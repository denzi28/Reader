/**
 * While a drawing tool is active the ink layer owns touch input, so a finger
 * can't scroll natively. This gives it the same drag-and-fling feel by hand.
 */
export function createTouchPan(getScroller: () => HTMLElement | null) {
  let active = false;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let vx = 0;
  let vy = 0;
  let raf = 0;

  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };

  return {
    start(e: PointerEvent) {
      stop();
      active = true;
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = e.timeStamp;
      vx = vy = 0;
    },
    move(e: PointerEvent) {
      const el = getScroller();
      if (!active || !el) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      const dt = Math.max(1, e.timeStamp - lastT);
      el.scrollLeft -= dx;
      el.scrollTop -= dy;
      // Smooth the velocity so one jittery sample doesn't launch the page.
      vx = vx * 0.6 + (-dx / dt) * 0.4;
      vy = vy * 0.6 + (-dy / dt) * 0.4;
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = e.timeStamp;
    },
    end(e: PointerEvent) {
      const el = getScroller();
      if (!active || !el) return;
      active = false;
      if (e.timeStamp - lastT > 80) return; // finger rested before lifting
      let last = performance.now();
      const step = (now: number) => {
        const dt = now - last;
        last = now;
        el.scrollLeft += vx * dt;
        el.scrollTop += vy * dt;
        const decay = Math.pow(0.994, dt);
        vx *= decay;
        vy *= decay;
        if (Math.hypot(vx, vy) > 0.02) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    },
    cancel: stop,
  };
}

export type TouchPan = ReturnType<typeof createTouchPan>;

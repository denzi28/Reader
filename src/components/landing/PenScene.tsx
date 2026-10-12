import { useEffect, useRef, type CSSProperties } from 'react';

// The scene is drawn in the front page's own units and scaled with --k.
export const PAGE_W = 132;
export const PAGE_H = 164;
const LINES = [96, 78, 100, 66, 92, 84];
export const WAVE = 'M20 128 C 34 118, 44 138, 58 128 S 82 118, 94 128 S 108 136, 114 126';
export const WRITE_AT = 1650; // ms after the page appears
export const WRITE_FOR = 1100;

export const delay = (s: number) => ({ '--d': `${s}s` }) as CSSProperties;

export function PageLines({ animate = true }: { animate?: boolean }) {
  return (
    <>
      <rect className={animate ? 'scene-title' : 'art-title'} x="18" y="16" width="62" height="7" rx="3.5" />
      {LINES.map((w, i) => (
        <rect
          key={i}
          className={animate ? 'scene-line' : 'art-line'}
          style={animate ? delay(0.75 + i * 0.07) : undefined}
          x="18"
          y={36 + i * 13}
          width={w}
          height="4"
          rx="2"
        />
      ))}
    </>
  );
}

export function PenIcon() {
  return (
    <svg viewBox="0 0 32 32">
      <path className="pen-body" d="M5 27 7.2 20 22.6 4.6a2.6 2.6 0 0 1 3.7 3.7L10.9 23.7z" />
      <path className="pen-band" d="m19.9 7.3 4.8 4.8" />
      <path className="pen-tip" d="M5 27 7.2 20l3.7 3.7z" />
    </svg>
  );
}

/**
 * Pages fan out, lines appear, a highlighter marks one and a pen writes on
 * the page. The pen is moved along the very curve it draws (scaled to the
 * page's size on screen), so its tip always meets the ink.
 */
export function PenScene({ k = 1 }: { k?: number }) {
  const wave = useRef<SVGPathElement>(null);
  const pen = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const path = wave.current;
    const nib = pen.current;
    const front = page.current;
    if (!path || !nib || !front) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      path.style.strokeDashoffset = '0';
      nib.style.opacity = '0';
      return;
    }
    path.style.strokeDashoffset = `${length}`;
    const start = performance.now() + WRITE_AT;
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    let raf = 0;
    const frame = (now: number) => {
      const scale = front.clientWidth / PAGE_W;
      const t = clamp((now - start) / WRITE_FOR);
      const drawn = length * ease(t);
      path.style.strokeDashoffset = `${length - drawn}`;
      const tip = path.getPointAtLength(drawn);
      const arrive = clamp((now - (start - 350)) / 350);
      const leave = clamp((now - (start + WRITE_FOR + 120)) / 450);
      nib.style.opacity = `${arrive * (1 - leave)}`;
      nib.style.transform = `translate(${(tip.x + leave * 14) * scale}px, ${(tip.y - (1 - arrive) * 12 - leave * 18) * scale}px)`;
      if (leave < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="scene" style={{ '--k': k } as CSSProperties} aria-hidden="true">
      <span className="scene-page back-left" />
      <span className="scene-page back-right" />
      <div className="scene-page front" ref={page}>
        <svg viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} width="100%" height="100%">
          <PageLines />
          <rect className="scene-highlight" x="15" y="58.5" width="106" height="11" rx="2" />
          <path ref={wave} className="scene-ink" d={WAVE} />
        </svg>
        <div ref={pen} className="scene-pen">
          <PenIcon />
        </div>
      </div>
    </div>
  );
}

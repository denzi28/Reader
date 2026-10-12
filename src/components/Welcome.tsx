import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { GoogleButton } from './SyncControl';

interface Props {
  onSkip: () => void;
}

// The opening scene, in the top page's own pixels (it is drawn at this size).
const PAGE_W = 132;
const PAGE_H = 164;
const LINES = [96, 78, 100, 66, 92, 84];
const WAVE = 'M20 128 C 34 118, 44 138, 58 128 S 82 118, 94 128 S 108 136, 114 126';
const WRITE_AT = 1650; // ms after the screen appears
const WRITE_FOR = 1100;

const delay = (s: number) => ({ '--d': `${s}s` }) as CSSProperties;

/**
 * Pages fan out, lines appear, a highlighter marks one and a pen writes on
 * the page: what the app is for, in two seconds. The pen is moved along the
 * very curve it draws, so its tip always meets the ink.
 */
function PenScene() {
  const wave = useRef<SVGPathElement>(null);
  const pen = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const path = wave.current;
    const nib = pen.current;
    if (!path || !nib) return;
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
      const t = clamp((now - start) / WRITE_FOR);
      const drawn = length * ease(t);
      path.style.strokeDashoffset = `${length - drawn}`;
      const tip = path.getPointAtLength(drawn);
      const arrive = clamp((now - (start - 350)) / 350); // pen comes down
      const leave = clamp((now - (start + WRITE_FOR + 120)) / 450); // and lifts away
      nib.style.opacity = `${arrive * (1 - leave)}`;
      nib.style.transform = `translate(${tip.x + leave * 14}px, ${tip.y - (1 - arrive) * 12 - leave * 18}px)`;
      if (leave < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="scene" aria-hidden="true">
      <span className="scene-page back-left" />
      <span className="scene-page back-right" />
      <div className="scene-page front">
        <svg viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} width={PAGE_W} height={PAGE_H}>
          <rect className="scene-title" x="18" y="16" width="62" height="7" rx="3.5" />
          {LINES.map((w, i) => (
            <rect
              key={i}
              className="scene-line"
              style={delay(0.75 + i * 0.07)}
              x="18"
              y={36 + i * 13}
              width={w}
              height="4"
              rx="2"
            />
          ))}
          <rect className="scene-highlight" x="15" y="58.5" width="106" height="11" rx="2" />
          <path ref={wave} className="scene-ink" d={WAVE} />
        </svg>
        <div ref={pen} className="scene-pen">
          <svg viewBox="0 0 32 32" width="32" height="32">
            <path className="pen-body" d="M5 27 7.2 20 22.6 4.6a2.6 2.6 0 0 1 3.7 3.7L10.9 23.7z" />
            <path className="pen-band" d="m19.9 7.3 4.8 4.8" />
            <path className="pen-tip" d="M5 27 7.2 20l3.7 3.7z" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/** First screen for someone not signed in: sign in with Google, or carry on without. */
export function Welcome({ onSkip }: Props) {
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="welcome">
      <div className="welcome-glow" aria-hidden="true" />
      <div className="welcome-card">
        <PenScene />
        <h1 className="brand reveal" style={delay(0.45)}>The Reader</h1>
        <p className="welcome-lead reveal" style={delay(0.6)}>
          Read, mark up and keep your documents, on every device.
        </p>
        <ul className="welcome-points">
          <li className="reveal" style={delay(0.75)}>Draw and highlight right on the page</li>
          <li className="reveal" style={delay(0.85)}>Your library and notes follow you through your own Google Drive</li>
          <li className="reveal" style={delay(0.95)}>Sign in once and stay signed in</li>
        </ul>
        <div className="welcome-cta reveal" style={delay(1.1)}>
          <GoogleButton label="Continue with Google" onError={setError} />
        </div>
        {error && <p className="welcome-error" role="alert">{error}</p>}
        <button className="link welcome-skip reveal" style={delay(1.2)} onClick={onSkip}>
          Use without an account
        </button>
        <p className="welcome-legal reveal" style={delay(1.3)}>
          By continuing you agree to the <a href="/terms.html">Terms</a> and{' '}
          <a href="/privacy.html">Privacy Policy</a>.
        </p>
      </div>
    </main>
  );
}

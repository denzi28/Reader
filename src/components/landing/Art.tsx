import { useEffect, useRef, type CSSProperties } from 'react';
import { PAGE_H, PAGE_W, PageLines, PenIcon, WAVE, WRITE_AT, WRITE_FOR } from './PenScene';

/** A phone beside the hero page: the same line appears on it, then a sync tick. */
export function PhoneMirror() {
  const appearAt = (WRITE_AT + WRITE_FOR + 350) / 1000;
  return (
    <div className="phone-mirror" style={{ '--d': `${appearAt}s` } as CSSProperties} aria-hidden="true">
      <div className="phone-screen">
        <svg viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} width="100%" height="100%">
          <PageLines animate={false} />
          <rect className="art-highlight" x="15" y="58.5" width="106" height="11" rx="2" />
          <path className="mirror-ink" d={WAVE} pathLength={1} />
        </svg>
      </div>
      <span className="sync-tick">
        <svg viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.25 8.5z" /><path className="tick" d="m9.2 13.4 2 2 3.8-4" /></svg>
      </span>
    </div>
  );
}

/** Ink section: the app's own toolbar, the pen picked, a line drawn with pressure. */
export function InkArt() {
  return (
    <div className="art art-ink" aria-hidden="true">
      <div className="art-page">
        <svg viewBox="0 0 240 170" width="100%" height="100%">
          <rect className="art-title" x="22" y="20" width="96" height="8" rx="4" />
          {[150, 176, 120, 168, 140, 96].map((w, i) => (
            <rect key={i} className="art-line" x="22" y={42 + i * 15} width={w} height="5" rx="2.5" />
          ))}
          <rect className="ink-mark" x="18" y="70" width="168" height="14" rx="3" />
          <path className="ink-pressure" d="M30 150 C 60 128, 80 160, 110 142 S 160 124, 210 140" pathLength={1} />
          <path className="ink-circle" d="M196 46 c 18 -4 26 10 18 20 c -9 11 -32 6 -30 -8 c 1 -7 7 -11 14 -12" pathLength={1} />
        </svg>
      </div>
      <div className="art-toolbar">
        <span className="tb-tool on"><PenIcon /></span>
        <span className="tb-tool">
          <svg viewBox="0 0 24 24"><path d="M9 15l-3 3-2 .5.5-2 3-3" /><path d="M14 4.5l5.5 5.5-8 8L6 12.5z" /></svg>
        </span>
        <span className="tb-tool">
          <svg viewBox="0 0 24 24"><path d="M7 21h12" /><path d="M5.5 14.5l8-8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8z" /></svg>
        </span>
        <span className="tb-sep" />
        <span className="tb-swatch" style={{ background: '#1f1a14' }} />
        <span className="tb-swatch on" style={{ background: '#25489b' }} />
        <span className="tb-swatch" style={{ background: '#b3261e' }} />
      </div>
    </div>
  );
}

/** Sync section: drawn on the phone, carried through the cloud, there on the laptop. */
export function SyncArt() {
  const host = useRef<HTMLDivElement>(null);
  const travel = useRef<SVGAnimateMotionElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          travel.current?.beginElementAt(1.0);
        }
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="art art-sync" ref={host} aria-hidden="true">
      <svg viewBox="0 0 400 250" width="100%" height="100%">
        {/* laptop */}
        <rect className="dev-frame" x="168" y="34" width="208" height="138" rx="10" />
        <rect className="dev-screen" x="178" y="44" width="188" height="118" rx="3" />
        <path className="dev-frame" d="M146 180h252l-12 14H158z" />
        <g transform="translate(222 52) scale(0.62)">
          <rect className="mini-page" width={PAGE_W} height={PAGE_H} rx="3" />
          <PageLines animate={false} />
          <path className="sync-ink laptop" d={WAVE} pathLength={1} />
        </g>
        {/* phone */}
        <rect className="dev-frame" x="24" y="70" width="96" height="166" rx="16" />
        <rect className="dev-screen" x="31" y="82" width="82" height="142" rx="6" />
        <g transform="translate(36 90) scale(0.56)">
          <rect className="mini-page" width={PAGE_W} height={PAGE_H} rx="3" />
          <PageLines animate={false} />
          <path className="sync-ink phone" d={WAVE} pathLength={1} />
        </g>
        {/* through the cloud */}
        <path id="sync-arc" className="sync-arc" d="M96 72 C 120 6, 210 0, 250 40" />
        <g className="sync-cloud" transform="translate(150 6)">
          <path d="M9 30a8 8 0 0 1-1-15.9A11 11 0 0 1 30 13a7.6 7.6 0 0 1-.5 15.2z" />
        </g>
        <circle className="sync-dot" r="5">
          <animateMotion ref={travel} begin="indefinite" dur="0.8s" fill="freeze" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.2 1">
            <mpath href="#sync-arc" />
          </animateMotion>
        </circle>
        <g className="sync-badge-art" transform="translate(352 30)">
          <circle r="13" />
          <path d="m-5.5 0.5 3.6 3.6 7-7.4" />
        </g>
      </svg>
    </div>
  );
}

/** Privacy section: a folder in your own Drive, locked. */
export function PrivacyArt() {
  return (
    <div className="art art-privacy" aria-hidden="true">
      <svg viewBox="0 0 260 210" width="100%" height="100%">
        <path className="folder-back" d="M30 52a10 10 0 0 1 10-10h56l16 16h108a10 10 0 0 1 10 10v104a10 10 0 0 1-10 10H40a10 10 0 0 1-10-10z" />
        <g className="folder-docs">
          <rect x="62" y="44" width="64" height="80" rx="4" transform="rotate(-8 94 84)" />
          <rect x="104" y="38" width="64" height="80" rx="4" transform="rotate(5 136 78)" />
        </g>
        <path className="folder-front" d="M30 84a10 10 0 0 1 10-10h180a10 10 0 0 1 10 10v88a10 10 0 0 1-10 10H40a10 10 0 0 1-10-10z" />
        <g className="lock" transform="translate(130 128)">
          <path className="lock-shackle" d="M-14 -6v-10a14 14 0 0 1 28 0v10" />
          <rect className="lock-body" x="-22" y="-8" width="44" height="34" rx="7" />
          <circle className="lock-hole" cy="6" r="4.5" />
        </g>
      </svg>
      <span className="only-you">Only you</span>
    </div>
  );
}

/**
 * The Leafpage logo: the name with an ivy vine woven through it. The vine goes behind some letters and
 * in front of others (two layers, the front one clipped and haloed), so it reads as growing through the word.
 * Everything is drawn on a grid where the word is 68 units high and 330 wide, and sized in `em`, so the logo
 * scales with the font size around it.
 */
const W = 330;
const MID = 62;
const AMP = 25;
const WAVES = 1.5;
const PHASE = -0.6;
const LEAF = 2.2;
const IVY = 'M0 0C-4 0-5.2-4-2.6-5.6C-3.6-8-1.2-9.4 0-11.6C1.2-9.4 3.6-8 2.6-5.6C5.2-4 4 0 0 0Z';
const VEIN = 'M0 -.6V-8.6M0 -3.8L-2.2 -5.6M0 -3.8L2.2 -5.6';

const r = (n: number) => Math.round(n * 10) / 10;
const Y = (x: number) => MID + AMP * Math.sin((x / W) * Math.PI * 2 * WAVES + PHASE);
const slope = (x: number) => (Y(x + 1) - Y(x - 1)) / 2;

const STEM = (() => {
  let d = `M-6 ${r(Y(-6))}`;
  for (let x = -3; x <= W + 8; x += 3) d += `L${r(x)} ${r(Y(x))}`;
  return d;
})();

const LEAVES = (() => {
  const out: { transform: string; tone: 1 | 2 }[] = [];
  let i = 0;
  for (let x = 16; x < W - 6; x += 28, i++) {
    const side = i % 2 ? 1 : -1;
    const turn = (Math.atan2(slope(x), 1) * 180) / Math.PI + side * 58 + 90;
    out.push({ transform: `translate(${r(x)} ${r(Y(x))}) rotate(${r(turn)}) scale(${LEAF})`, tone: i % 2 ? 2 : 1 });
  }
  const ex = W + 8;
  out.push({ transform: `translate(${ex + 6} ${r(Y(ex) - 12)}) rotate(-30) scale(1.1)`, tone: 1 });
  return out;
})();

const CURL = `M${W + 8} ${r(Y(W + 8))}c8 0 12 -8 6 -12c-5 -3 -10 2 -6 6`;

// Every other half wave runs in front of the letters.
const HALF = W / (WAVES * 2);
const FRONT = [0, 2].map((k) => r(k * HALF - 4 + HALF * 0.3));

function Vine({ front }: { front?: boolean }) {
  return (
    <svg className={`wm-vine${front ? ' front' : ''}`} viewBox={`0 0 ${W} 116`} aria-hidden="true" focusable="false">
      {front && (
        <defs>
          <clipPath id="wm-front">
            {FRONT.map((x) => <rect key={x} x={x} y="-20" width={r(HALF)} height="160" />)}
          </clipPath>
        </defs>
      )}
      <g clipPath={front ? 'url(#wm-front)' : undefined}>
        {front && <path className="wm-halo" d={STEM} />}
        <path className="wm-stem" d={STEM} />
        <path className="wm-stem thin" d={CURL} />
        {LEAVES.map((l, i) => (
          <g key={i} transform={l.transform}>
            <path className={`wm-leaf t${l.tone}`} d={IVY} />
            <path className="wm-vein" d={VEIN} />
          </g>
        ))}
      </g>
    </svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`.trim()}>
      <Vine />
      <span className="wm-text">Leafpage</span>
      <Vine front />
    </span>
  );
}

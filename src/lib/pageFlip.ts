// A page turn: one leaf of the book swings round its spine in 3D. The leaf is cut into narrow strips hinged
// one to the next, so it bends as it turns (the free edge trails), is lit by how each strip is angled, and
// throws a soft shadow on the page it uncovers.

export interface Box { left: number; top: number; width: number; height: number }

/** Makes strip `slice` (of `slices`) of one side of the leaf: an element that will be sized to the strip. */
export type StripMaker = (slice: number, slices: number) => HTMLElement;

export interface FlipSpec {
  /** A positioned element the turn is drawn in (its children are left alone). */
  host: HTMLElement;
  /** Where the leaf lies on the right, and how big it is, in the host's coordinates. */
  leaf: Box;
  /** The paper the turn can throw shadows on (the page or pages), in the host's coordinates. */
  area: Box;
  /** What shows on the leaf while it lies on the right (front), and while it lies on the left, once turned (back). */
  front: StripMaker;
  back: StripMaker;
  /** Forward: lies on the right, ends on the left. Backward: the other way round. */
  forward: boolean;
  /** How many strips the leaf is cut into (1 is a stiff leaf). */
  slices?: number;
  /** A picture of the page the leaf lands on (forward) or leaves (backward), kept until the turn is done. */
  cover?: { box: Box; node: HTMLElement };
  duration?: number;
}

const place = (el: HTMLElement, b: Box) => {
  el.style.position = 'absolute';
  el.style.left = `${b.left}px`;
  el.style.top = `${b.top}px`;
  el.style.width = `${b.width}px`;
  el.style.height = `${b.height}px`;
};

const RAD = Math.PI / 180;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Tilting a strip away from the viewer darkens it; the most when it is edge-on. */
const dim = (deg: number) => 0.04 + 0.42 * (1 - Math.pow(Math.abs(Math.cos(deg * RAD)), 0.8));

/** Runs the turn; resolves when it is over (and everything it added is gone again). */
export function flipLeaf(spec: FlipSpec): Promise<void> {
  const { host, leaf, area, forward, cover } = spec;
  const S = Math.max(1, Math.round(spec.slices ?? 8));
  const duration = spec.duration ?? 760;
  const sw = leaf.width / S;
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:absolute;inset:0;z-index:5;pointer-events:none;perspective:${Math.round(leaf.width * 4.5)}px;perspective-origin:${Math.round(leaf.left)}px 50%;`;
  if (cover) {
    const c = document.createElement('div');
    place(c, cover.box);
    cover.node.style.cssText += ';width:100%;height:100%;display:block;margin:0;';
    c.appendChild(cover.node);
    wrap.appendChild(c);
  }

  // The shadow on the paper: a soft band at the free edge of the leaf, kept inside the paper.
  const field = document.createElement('div');
  place(field, area);
  field.style.overflow = 'hidden';
  const cast = document.createElement('i');
  const castW = Math.round(leaf.width * 0.28);
  cast.style.cssText = `position:absolute;top:0;bottom:0;width:${castW}px;opacity:0;will-change:transform,opacity;`;
  field.appendChild(cast);
  wrap.appendChild(field);

  // The strips: each is hinged on the right edge of the one before.
  const strips: { el: HTMLElement; shadeA: HTMLElement; shadeB: HTMLElement }[] = [];
  let parent: HTMLElement = wrap;
  for (let i = 0; i < S; i++) {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;top:0;height:${leaf.height}px;width:${sw + (i < S - 1 ? 0.6 : 0)}px;transform-origin:left center;transform-style:preserve-3d;`;
    el.style.left = `${i === 0 ? leaf.left : sw}px`;
    if (i === 0) el.style.top = `${leaf.top}px`; else el.style.top = '0px';
    const side = (maker: StripMaker, k: number, back: boolean) => {
      const f = document.createElement('div');
      f.style.cssText = 'position:absolute;inset:0;overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden;';
      if (back) f.style.transform = 'rotateY(180deg)';
      const content = maker(k, S);
      content.style.cssText += ';width:100%;height:100%;display:block;margin:0;box-shadow:none;border-radius:0;';
      f.appendChild(content);
      const shade = document.createElement('i');
      shade.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;background:rgb(34,20,4);';
      f.appendChild(shade);
      el.appendChild(f);
      return shade;
    };
    // (seen from behind, the strip nearest the spine is the one furthest from it on the back page)
    const shadeA = side(spec.front, i, false);
    const shadeB = side(spec.back, S - 1 - i, true);
    parent.appendChild(el);
    strips.push({ el, shadeA, shadeB });
    parent = el;
  }

  host.appendChild(wrap);

  const BEND = S > 1 ? 40 : 0;
  const castSide = { right: '' as string, left: '' as string };
  castSide.right = 'linear-gradient(90deg, rgba(25,14,2,.5), rgba(25,14,2,.18) 45%, rgba(25,14,2,0))';
  castSide.left = 'linear-gradient(270deg, rgba(25,14,2,.5), rgba(25,14,2,.18) 45%, rgba(25,14,2,0))';
  let shown = '';

  /** One moment of the turn: `q` is how far on it is (0 to 1). */
  const frame = (q: number) => {
    const theta = forward ? -180 * q : -180 * (1 - q);
    // The free edge trails the spine, most in the middle of the turn.
    const delta = (forward ? 1 : -1) * (BEND * Math.sin(Math.PI * q)) / S;
    let x = leaf.left;
    let phi = theta;
    strips.forEach((s, i) => {
      s.el.style.transform = `rotateY(${i === 0 ? theta : delta}deg)`;
      if (i > 0) phi += delta;
      const d = dim(phi);
      s.shadeA.style.opacity = String(d);
      s.shadeB.style.opacity = String(d);
      x += sw * Math.cos(phi * RAD);
    });
    // The shadow falls beyond the free edge, on whichever page the leaf is over.
    const spine = leaf.left;
    const over = x >= spine ? 'right' : 'left';
    if (over !== shown) { cast.style.background = castSide[over]; shown = over; }
    const lift = Math.abs(Math.sin(theta * RAD));
    cast.style.opacity = String(Math.min(1, lift * 1.15));
    const at = (over === 'right' ? x : x - castW) - area.left;
    cast.style.transform = `translateX(${at}px)`;
  };
  frame(0);

  return new Promise<void>((resolve) => {
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      frame(ease(t));
      if (t < 1) requestAnimationFrame(tick);
      else { wrap.remove(); resolve(); }
    };
    requestAnimationFrame(tick);
  });
}

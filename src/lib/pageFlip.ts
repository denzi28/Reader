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
  /** Two pages side by side: how wide the shadow in the middle of the book is on each side of it (px). */
  gutter?: number;
  /**
   * Draw the turn over the screen (fixed to where `host` is now), cut off at the edges of this element, instead of
   * inside `host`: then the turn adds nothing to what `host` scrolls, so no scrollbar comes and goes under it.
   */
  clipTo?: HTMLElement;
  duration?: number;
}

const place = (el: HTMLElement, b: Box) => {
  el.style.position = 'absolute';
  el.style.left = `${b.left}px`;
  el.style.top = `${b.top}px`;
  el.style.width = `${b.width}px`;
  el.style.height = `${b.height}px`;
};

/** The soft shadow a book has where its pages meet, for the half that belongs to one page. `edge` is the side it hugs. */
const gutterShade = (width: number, edge: 'left' | 'right') => {
  const i = document.createElement('i');
  const dir = edge === 'left' ? '90deg' : '270deg';
  i.style.cssText = `position:absolute;top:0;bottom:0;${edge}:0;width:${width}px;pointer-events:none;background:linear-gradient(${dir}, rgba(60,40,10,.2), rgba(60,40,10,.1) 12%, rgba(60,40,10,0));`;
  return i;
};

const RAD = Math.PI / 180;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Tilting a strip away from the viewer darkens it; the most when it is edge-on. */
const dim = (deg: number) => 0.46 * (1 - Math.pow(Math.abs(Math.cos(deg * RAD)), 0.8));

/** Runs the turn; resolves when it is over (and everything it added is gone again). */
export function flipLeaf(spec: FlipSpec): Promise<void> {
  const { host, leaf, area, forward, cover } = spec;
  const S = Math.max(1, Math.round(spec.slices ?? 8));
  const duration = spec.duration ?? 760;
  const sw = leaf.width / S;
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:absolute;inset:0;z-index:5;pointer-events:none;perspective:${Math.round(leaf.width * 4.5)}px;perspective-origin:${Math.round(leaf.left)}px 50%;`;
  if (spec.clipTo) {
    const h = host.getBoundingClientRect();
    const c = spec.clipTo.getBoundingClientRect();
    const cl = c.left + spec.clipTo.clientLeft;
    const ct = c.top + spec.clipTo.clientTop;
    const cr = cl + spec.clipTo.clientWidth;
    const cb = ct + spec.clipTo.clientHeight;
    wrap.style.inset = 'auto';
    wrap.style.position = 'fixed';
    wrap.style.left = `${h.left}px`;
    wrap.style.top = `${h.top}px`;
    wrap.style.width = `${h.width}px`;
    wrap.style.height = `${h.height}px`;
    wrap.style.clipPath = `inset(${Math.max(0, ct - h.top)}px ${Math.max(0, h.right - cr)}px ${Math.max(0, h.bottom - cb)}px ${Math.max(0, cl - h.left)}px)`;
  }
  if (cover) {
    const c = document.createElement('div');
    place(c, cover.box);
    cover.node.style.cssText += ';width:100%;height:100%;display:block;margin:0;';
    c.appendChild(cover.node);
    // (the page it replaces had the shadow of the middle of the book on it)
    if (spec.gutter) c.appendChild(gutterShade(spec.gutter, cover.box.left < leaf.left ? 'right' : 'left'));
    wrap.appendChild(c);
  }

  // The shadow on the paper: a soft band at the free edge of the leaf, kept inside the paper.
  const field = document.createElement('div');
  place(field, area);
  field.style.overflow = 'hidden';
  const castW = Math.round(leaf.width * 0.28);
  // One shadow for each side of the spine, so that when the leaf crosses it the shadow fades from one to the other.
  const makeCast = (dir: string) => {
    const el = document.createElement('i');
    el.style.cssText = `position:absolute;top:0;bottom:0;width:${castW}px;opacity:0;will-change:transform,opacity;background:linear-gradient(${dir}, rgba(25,14,2,.5), rgba(25,14,2,.18) 45%, rgba(25,14,2,0));`;
    field.appendChild(el);
    return el;
  };
  const castRight = makeCast('90deg');
  const castLeft = makeCast('270deg');
  wrap.appendChild(field);

  // The strips: each is hinged on the right edge of the one before.
  const strips: { el: HTMLElement; shadeA: HTMLElement; shadeB: HTMLElement; lightA: HTMLElement; lightB: HTMLElement }[] = [];
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
      // The side of the leaf at the spine carries its share of the shadow in the middle of the book.
      if (spec.gutter && k === (back ? S - 1 : 0)) f.appendChild(gutterShade(spec.gutter, back ? 'right' : 'left'));
      const shade = document.createElement('i');
      shade.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;background:rgb(34,20,4);';
      f.appendChild(shade);
      const light = document.createElement('i');
      light.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;background:linear-gradient(100deg, rgba(255,250,235,0), rgb(255,250,235) 55%, rgba(255,250,235,0));mix-blend-mode:soft-light;';
      f.appendChild(light);
      el.appendChild(f);
      return { shade, light };
    };
    // (seen from behind, the strip nearest the spine is the one furthest from it on the back page)
    const a = side(spec.front, i, false);
    const b = side(spec.back, S - 1 - i, true);
    parent.appendChild(el);
    strips.push({ el, shadeA: a.shade, shadeB: b.shade, lightA: a.light, lightB: b.light });
    parent = el;
  }

  host.appendChild(wrap);

  const BEND = S > 1 ? 40 : 0;

  const glow = { right: 0, left: 0 };
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
      // A sheen where the paper faces the light: a strip tilted about 55° catches it.
      const a = Math.abs(phi) > 90 ? 180 - Math.abs(phi) : Math.abs(phi);
      const sheen = a > 20 && a < 90 ? 0.55 * Math.sin(((a - 20) / 70) * Math.PI) : 0;
      s.lightA.style.opacity = String(sheen);
      s.lightB.style.opacity = String(sheen);
      x += sw * Math.cos(phi * RAD);
    });
    // The shadow falls beyond the free edge, on whichever page the leaf is over; it grows with how far the
    // edge is from the spine, so it is nothing at the very moment the leaf stands on its edge.
    const spine = leaf.left;
    const reach = Math.max(1, leaf.width * 0.45);
    const lift = Math.abs(Math.sin(theta * RAD));
    // (and it eases toward that, so a quick swing never makes it jump)
    const toward = (now: number, target: number) => now + (target - now) * 0.3;
    glow.right = toward(glow.right, x > spine ? Math.min(1, (x - spine) / reach) * lift : 0);
    glow.left = toward(glow.left, x < spine ? Math.min(1, (spine - x) / reach) * lift : 0);
    castRight.style.opacity = String(glow.right);
    castLeft.style.opacity = String(glow.left);
    castRight.style.transform = `translateX(${x - area.left}px)`;
    castLeft.style.transform = `translateX(${x - castW - area.left}px)`;
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

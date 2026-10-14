// A page turn: one leaf of the book swings round its spine in 3D, the new page coming out from under it.

export interface Box { left: number; top: number; width: number; height: number }

export interface FlipSpec {
  /** A positioned element the turn is drawn in (its children are left alone). */
  host: HTMLElement;
  /** Where the leaf lies on the right, and how big it is, in the host's coordinates. */
  leaf: Box;
  /** What shows on the leaf while it lies on the right, and while it lies on the left (once turned). */
  front: HTMLElement;
  back: HTMLElement;
  /** Forward: lies on the right, ends on the left. Backward: the other way round. */
  forward: boolean;
  /** A picture of the page the leaf lands on (forward), or leaves (backward), kept until the turn is done. */
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

const face = (content: HTMLElement, back: boolean, shade: string) => {
  const f = document.createElement('div');
  f.style.cssText = 'position:absolute;inset:0;overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden;';
  if (back) f.style.transform = 'rotateY(180deg)';
  content.style.cssText += ';width:100%;height:100%;display:block;margin:0;';
  f.appendChild(content);
  const s = document.createElement('i');
  s.style.cssText = `position:absolute;inset:0;pointer-events:none;opacity:0;background:${shade};`;
  f.appendChild(s);
  return { f, s };
};

/** Runs the turn; resolves when it is over (and everything it added is gone again). */
export function flipLeaf(spec: FlipSpec): Promise<void> {
  const { host, leaf, front, back, forward, cover } = spec;
  const duration = spec.duration ?? 620;
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:absolute;inset:0;z-index:5;pointer-events:none;perspective:${Math.round(leaf.width * 5)}px;perspective-origin:${Math.round(leaf.left)}px 50%;`;
  if (cover) {
    const c = document.createElement('div');
    place(c, cover.box);
    cover.node.style.cssText += ';width:100%;height:100%;display:block;margin:0;';
    c.appendChild(cover.node);
    wrap.appendChild(c);
  }
  const el = document.createElement('div');
  place(el, leaf);
  el.style.transformOrigin = 'left center';
  el.style.transformStyle = 'preserve-3d';
  // The spine side of each face is the darker one, and a face darkens as it turns away from the light.
  const a = face(front, false, 'linear-gradient(90deg, rgba(40,25,5,.38), rgba(40,25,5,.1) 45%, rgba(40,25,5,0))');
  const b = face(back, true, 'linear-gradient(270deg, rgba(40,25,5,.38), rgba(40,25,5,.1) 45%, rgba(40,25,5,0))');
  el.append(a.f, b.f);
  wrap.appendChild(el);
  host.appendChild(wrap);

  const from = forward ? 0 : -180;
  const to = forward ? -180 : 0;
  const timing: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(.45,.05,.2,1)', fill: 'both' };
  const swing = el.animate([{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }], timing);
  // Light: the front side goes dark as it turns edge-on, the back side comes out of the dark.
  const dim = (on: boolean) => (on ? [{ opacity: 0 }, { opacity: 0.9, offset: 0.5 }, { opacity: 0.9 }] : [{ opacity: 0.9 }, { opacity: 0.9, offset: 0.5 }, { opacity: 0 }]);
  a.s.animate(dim(forward), { ...timing, easing: 'linear' });
  b.s.animate(dim(!forward), { ...timing, easing: 'linear' });
  return new Promise<void>((resolve) => {
    const done = () => { wrap.remove(); resolve(); };
    swing.onfinish = done;
    swing.oncancel = done;
  });
}

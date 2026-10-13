// Finding places in the drawn book: from a point on screen or a selection to a position, and back.
import type { Pos } from './model';

const num = (v: string | undefined) => (v === undefined ? NaN : Number(v));

/** A place in the book from a spot in the DOM (a text node and a character in it). */
export function pointOf(node: Node, offset: number): Pos | null {
  const el = node.nodeType === 3 ? node.parentElement : (node as Element);
  const block = el?.closest<HTMLElement>('[data-b]');
  if (!el || !block) return null;
  const b = num(block.dataset.b);
  if (Number.isNaN(b)) return null;
  const seg = el.closest<HTMLElement>('[data-o]');
  if (seg && node.nodeType === 3) {
    const o = num(seg.dataset.o);
    if (!Number.isNaN(o)) return { b, o: o + offset };
  }
  // A container (the block itself): the start or the end of it.
  return { b, o: offset <= 0 ? 0 : num(block.dataset.len) || 0 };
}

export function posFromPoint(x: number, y: number): Pos | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? pointOf(p.offsetNode, p.offset) : null;
  }
  const r = doc.caretRangeFromPoint?.(x, y);
  return r ? pointOf(r.startContainer, r.startOffset) : null;
}

/** The first place visible near the top-left of an area (the line there). */
export function posNear(area: DOMRect, dx = 6): Pos | null {
  for (let dy = 8; dy < 90; dy += 9) {
    const p = posFromPoint(area.left + dx, area.top + dy);
    if (p) return p;
  }
  return null;
}

/** Where a character of a block is on screen (the block itself when it has no text). */
export function rectOfPos(root: ParentNode, pos: Pos): DOMRect | null {
  const block = root.querySelector<HTMLElement>(`[data-b="${pos.b}"]`);
  if (!block) return null;
  if (pos.o > 0) {
    const segs = block.querySelectorAll<HTMLElement>('[data-o]');
    let hit: HTMLElement | null = null;
    for (const s of segs) {
      if (num(s.dataset.o) <= pos.o) hit = s; else break;
    }
    const text = hit?.firstChild;
    if (hit && text && text.nodeType === 3) {
      const range = document.createRange();
      const at = Math.min(pos.o - num(hit.dataset.o), (text.nodeValue ?? '').length);
      range.setStart(text, at);
      range.setEnd(text, Math.min((text.nodeValue ?? '').length, at + 1));
      const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
      if (r && (r.width || r.height)) return r;
    }
  }
  return block.getClientRects()[0] ?? block.getBoundingClientRect();
}

export interface Picked {
  a: Pos;
  z: Pos;
  text: string;
  rect: DOMRect;
}

/** What is selected inside `root`, as a place in the book. */
export function pickedSelection(root: Element): Picked | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  let a = pointOf(range.startContainer, range.startOffset);
  let z = pointOf(range.endContainer, range.endOffset);
  if (!a || !z) return null;
  if (a.b > z.b || (a.b === z.b && a.o > z.o)) [a, z] = [z, a];
  if (a.b === z.b && z.o <= a.o) return null;
  const rects = range.getClientRects();
  const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  return { a, z, text: range.toString().replace(/\s+/g, ' ').trim(), rect };
}

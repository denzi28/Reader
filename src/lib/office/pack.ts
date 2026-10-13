// An Office file is a zip of XML parts and media; this opens one and follows its relationships.
import { unzipSync, strFromU8 } from 'fflate';
import { kids, parseXml, at, type El } from './xml';

export const MAX_PART = 60 * 1024 * 1024;

export class Pack {
  private files: Record<string, Uint8Array>;
  private xml = new Map<string, El | null>();

  constructor(bytes: Uint8Array) {
    try {
      // Only the parts that are text or pictures we can use are inflated.
      this.files = unzipSync(bytes, { filter: (f) => f.originalSize <= MAX_PART && !/\.(bin|ttf|otf|fntdata|mp3|mp4|wav|mov|avi|wmv)$/i.test(f.name) });
    } catch {
      throw new Error('This file could not be opened. It may be damaged or password-protected.');
    }
  }

  has(name: string) {
    return name in this.files;
  }

  names() {
    return Object.keys(this.files);
  }

  bytes(name: string): Uint8Array | undefined {
    return this.files[name];
  }

  text(name: string): string | undefined {
    const b = this.files[name];
    return b ? strFromU8(b) : undefined;
  }

  /** A part as parsed XML (null when it is missing). */
  doc(name: string): El | null {
    if (this.xml.has(name)) return this.xml.get(name)!;
    const t = this.text(name);
    const el = t ? parseXml(t) : null;
    this.xml.set(name, el);
    return el;
  }

  /** The relationships of a part: id → absolute name in the package. */
  rels(part: string): Map<string, { target: string; type: string }> {
    const dir = part.slice(0, part.lastIndexOf('/') + 1);
    const file = `${dir}_rels/${part.slice(dir.length)}.rels`;
    const out = new Map<string, { target: string; type: string }>();
    const root = this.doc(file);
    for (const r of kids(root, 'Relationship')) {
      const id = at(r, 'Id');
      let target = at(r, 'Target');
      if (!id || !target || at(r, 'TargetMode') === 'External') continue;
      target = target.startsWith('/') ? target.slice(1) : resolve(dir, target);
      out.set(id, { target, type: at(r, 'Type') ?? '' });
    }
    return out;
  }
}

/** `../media/a.png` seen from `ppt/slides/` is `ppt/media/a.png`. */
export function resolve(dir: string, target: string) {
  const parts = dir.split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

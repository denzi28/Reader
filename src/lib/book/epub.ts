// Opening an ePub: a zip of XHTML chapters, a package file (order, title, cover) and a contents list.
import { strFromU8, unzipSync } from 'fflate';
import { at, kid, kids, parseXml, type El } from '../office/xml';
import { countWords, type Block, type Book, type Chapter, type Run, type TocEntry } from './model';
import { t } from '../i18n';

export const BOOK_VERSION = 1;
const MAX_PART = 40 * 1024 * 1024;

export interface Epub {
  book: Book;
  /** A picture inside the book as an address the page can show (made on first use). */
  image(src: string): string | undefined;
  cover?: Blob;
  words: number;
  dispose(): void;
}

/** True when these bytes start like a zip that declares itself an ePub. */
export function looksLikeEpub(head: Uint8Array) {
  if (head[0] !== 0x50 || head[1] !== 0x4b) return false;
  // The first file of an ePub is "mimetype", stored uncompressed, so its text is in the first bytes.
  return new TextDecoder('latin1').decode(head.subarray(0, 200)).includes('application/epub+zip');
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' };
const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

function resolvePath(base: string, href: string): string {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return base;
  const parts = (clean.startsWith('/') ? clean.slice(1) : base.slice(0, base.lastIndexOf('/') + 1) + clean).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

interface Item { id: string; href: string; type: string; props: string }

const text = (el: El | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

// ---- turning one chapter's markup into paragraphs ---------------------------
const SKIP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'noscript', 'template', 'audio', 'video', 'canvas', 'object', 'iframe', 'map', 'button', 'select', 'input', 'textarea']);
const TEXTY = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'dt', 'dd', 'pre', 'figcaption', 'summary', 'caption', 'address']);
const CONTAINERS = new Set(['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'blockquote', 'ul', 'ol', 'dl', 'figure', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'body', 'nav', 'details', 'fieldset', 'form', 'center', 'td', 'th', 'html', 'hgroup', 'colgroup']);
const isBlockTag = (n: string) => TEXTY.has(n) || CONTAINERS.has(n) || n === 'hr';

interface Walk {
  blocks: Block[];
  anchors: Map<string, number>;
  runs: Run[];
  quote: boolean;
  center: boolean;
  pre: boolean;
  firstHeading?: string;
  image: (src: string) => string;
}

function flush(w: Walk, kind: { h?: 1 | 2 | 3; n?: boolean } = {}) {
  const runs = w.runs;
  w.runs = [];
  if (!runs.length) return;
  // Collapse whitespace across runs; a line break survives as "\n".
  const out: Run[] = [];
  let x = '';
  let space = true;
  for (const [t, f] of runs) {
    let piece = '';
    for (const ch of t) {
      if (ch === '\u0001') { piece = piece.replace(/ $/, '') + '\n'; space = true; continue; }
      if (w.pre ? ch === '\n' : /\s/.test(ch)) {
        if (w.pre && ch === '\n') { piece += '\n'; space = true; continue; }
        if (!space) { piece += ' '; space = true; }
        continue;
      }
      piece += ch === ' ' ? ' ' : ch;
      space = false;
    }
    if (!piece) continue;
    x += piece;
    const last = out[out.length - 1];
    if (last && last[1] === f) last[0] += piece; else out.push([piece, f]);
  }
  const trimmed = x.replace(/[ \n]+$/, '');
  if (!trimmed) return;
  if (trimmed.length < x.length) {
    const last = out[out.length - 1];
    last[0] = last[0].slice(0, last[0].length - (x.length - trimmed.length));
    if (!last[0]) out.pop();
  }
  if (kind.h) {
    w.blocks.push({ t: 'h', x: trimmed.replace(/\n/g, ' '), l: kind.h });
    w.firstHeading ??= trimmed.replace(/\n/g, ' ');
    return;
  }
  const block: Block = { t: 'p', x: trimmed };
  if (out.some(([, f]) => f)) block.r = out;
  if (w.quote) block.q = 1;
  if (w.center) block.c = 1;
  if (kind.n || w.pre) block.n = 1;
  w.blocks.push(block);
}

function inline(node: Node, flags: number, w: Walk) {
  if (node.nodeType === 3) {
    const t = node.nodeValue ?? '';
    if (t) w.runs.push([t, flags]);
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const name = el.localName.toLowerCase();
  if (SKIP.has(name)) return;
  const id = el.getAttribute('id');
  if (id && !w.anchors.has(id)) w.anchors.set(id, w.blocks.length);
  if (hidden(el)) return;
  if (name === 'br') { w.runs.push(['\u0001', flags]); return; }
  if (name === 'img' || name === 'image' || name === 'svg') { picture(el, w); return; }
  let f = flags;
  if (['em', 'i', 'cite', 'dfn', 'var'].includes(name)) f |= 1;
  else if (['b', 'strong'].includes(name)) f |= 2;
  for (let c = el.firstChild; c; c = c.nextSibling) inline(c, f, w);
}

function hidden(el: Element) {
  if (el.hasAttribute('hidden')) return true;
  const style = el.getAttribute('style') ?? '';
  if (/display\s*:\s*none/i.test(style)) return true;
  const type = el.getAttribute('epub:type') ?? el.getAttribute('type') ?? '';
  return /pagebreak|page-list|landmarks/.test(type) || el.getAttribute('role') === 'doc-pagebreak';
}

function picture(el: Element, w: Walk) {
  let href: string | null = null;
  if (el.localName === 'svg') {
    const inner = el.querySelector('image');
    href = inner?.getAttribute('xlink:href') ?? inner?.getAttribute('href') ?? null;
  } else {
    href = el.getAttribute('src') ?? el.getAttribute('xlink:href') ?? el.getAttribute('href');
  }
  if (!href || href.startsWith('data:')) {
    if (href) { flush(w); w.blocks.push({ t: 'i', src: href, alt: el.getAttribute('alt') ?? undefined }); }
    return;
  }
  const small = Number(el.getAttribute('width') ?? 999);
  if (small > 0 && small <= 16) return; // ornaments and spacers
  flush(w);
  w.blocks.push({ t: 'i', src: w.image(href), alt: el.getAttribute('alt') || undefined });
}

const hasBlockInside = (el: Element) => {
  for (const d of el.querySelectorAll('*')) if (isBlockTag(d.localName.toLowerCase()) && d.localName.toLowerCase() !== 'li') return true;
  return false;
};

function block(el: Element, w: Walk, listState: { ordered: boolean; n: number } | null) {
  const name = el.localName.toLowerCase();
  if (SKIP.has(name) || hidden(el)) return;
  const id = el.getAttribute('id');
  if (id && !w.anchors.has(id)) w.anchors.set(id, w.blocks.length + (w.runs.length ? 1 : 0));
  if (name === 'hr') { flush(w); w.blocks.push({ t: 'r' }); return; }
  const cls = `${el.getAttribute('class') ?? ''} ${el.getAttribute('style') ?? ''}`;
  const saved = { quote: w.quote, center: w.center, pre: w.pre };
  if (name === 'blockquote') w.quote = true;
  if (/(^|[\s;:])center(d)?\b/i.test(cls) && /center/.test(cls)) w.center = true;
  if (name === 'pre') w.pre = true;
  try {
    if (/^h[1-6]$/.test(name)) {
      flush(w);
      const level = Number(name[1]);
      for (let c = el.firstChild; c; c = c.nextSibling) inline(c, 0, w);
      flush(w, { h: (level > 3 ? 3 : level) as 1 | 2 | 3 });
      return;
    }
    if (name === 'ul' || name === 'ol') {
      flush(w);
      const state = { ordered: name === 'ol', n: 0 };
      for (let c = el.firstElementChild; c; c = c.nextElementSibling) block(c, w, state);
      return;
    }
    if (name === 'li' && !hasBlockInside(el)) {
      flush(w);
      if (listState) {
        listState.n++;
        w.runs.push([listState.ordered ? `${listState.n}. ` : '• ', 0]);
      }
      for (let c = el.firstChild; c; c = c.nextSibling) inline(c, 0, w);
      flush(w, { n: true });
      return;
    }
    if (name === 'tr') {
      flush(w);
      const cells = kidsOf(el).filter((c) => /^t[dh]$/i.test(c.localName)).map((c) => text(c)).filter(Boolean);
      if (cells.length) { w.runs.push([cells.join('  ·  '), 0]); flush(w, { n: true }); }
      return;
    }
    if (TEXTY.has(name) && !hasBlockInside(el)) {
      flush(w);
      for (let c = el.firstChild; c; c = c.nextSibling) inline(c, 0, w);
      flush(w);
      return;
    }
    // A container, or text-like element holding blocks: its children in turn.
    flush(w);
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && isBlockTag((c as Element).localName.toLowerCase())) {
        flush(w);
        block(c as Element, w, null);
        flush(w);
      } else inline(c, 0, w);
    }
    flush(w);
  } finally {
    w.quote = saved.quote; w.center = saved.center; w.pre = saved.pre;
  }
}

const kidsOf = (el: Element) => Array.from(el.children);

function chapterBlocks(html: string, image: (src: string) => string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const w: Walk = { blocks: [], anchors: new Map(), runs: [], quote: false, center: false, pre: false, image };
  const body = doc.body;
  if (body) block(body, w, null);
  flush(w);
  return { blocks: w.blocks, anchors: w.anchors, heading: w.firstHeading, title: doc.title?.trim() };
}

// ---- the table of contents ---------------------------------------------------
interface RawToc { title: string; level: number; href: string }

function navToc(nav: El, base: string): RawToc[] {
  const out: RawToc[] = [];
  const walkList = (ol: El, level: number) => {
    for (const li of kids(ol, 'li')) {
      const a = kid(li, 'a') ?? kid(li, 'span');
      const href = a ? at(a, 'href') : null;
      const title = text(a);
      if (title && href) out.push({ title, level, href: resolvePath(base, href) + (href.includes('#') ? '#' + href.split('#')[1] : '') });
      const sub = kid(li, 'ol');
      if (sub) walkList(sub, level + 1);
    }
  };
  const ol = kid(nav, 'ol');
  if (ol) walkList(ol, 0);
  return out;
}

function ncxToc(root: El, base: string): RawToc[] {
  const out: RawToc[] = [];
  const walkPoints = (parent: El, level: number) => {
    for (const p of kids(parent, 'navPoint')) {
      const title = text(kid(kid(p, 'navLabel'), 'text'));
      const src = at(kid(p, 'content'), 'src');
      if (title && src) out.push({ title, level, href: resolvePath(base, src) + (src.includes('#') ? '#' + src.split('#')[1] : '') });
      walkPoints(p, level + 1);
    }
  };
  const map = kid(root, 'navMap');
  if (map) walkPoints(map, 0);
  return out;
}

// ---- the book ----------------------------------------------------------------
export async function readEpub(file: Blob): Promise<Epub> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.originalSize <= MAX_PART && !/\.(ttf|otf|woff2?|mp3|mp4|m4a|ogg|wav|mov)$/i.test(f.name) });
  } catch {
    throw new Error(t('This book could not be opened. It may be damaged.'));
  }
  const get = (name: string) => files[name] ?? files[decode(name)];
  const str = (name: string) => { const b = get(name); return b ? strFromU8(b) : undefined; };

  const enc = str('META-INF/encryption.xml');
  if (enc && /EncryptedData/.test(enc) && !/idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/.test(enc)) {
    throw new Error(t('This book is protected (DRM) and cannot be opened here.'));
  }
  const container = str('META-INF/container.xml');
  if (!container) throw new Error(t('This does not look like an ePub book.'));
  const rootPath = at(kid(kid(parseXml(container), 'rootfiles'), 'rootfile'), 'full-path');
  const opfText = rootPath ? str(rootPath) : undefined;
  if (!rootPath || !opfText) throw new Error(t('This book has no readable contents.'));
  const opf = parseXml(opfText);

  const meta = kid(opf, 'metadata');
  const find = (name: string) => kids(meta).filter((e) => e.localName === name).map(text).find(Boolean);
  const title = find('title');
  const author = find('creator');
  const lang = find('language');

  const items = new Map<string, Item>();
  for (const it of kids(kid(opf, 'manifest'), 'item')) {
    const id = at(it, 'id');
    const href = at(it, 'href');
    if (id && href) items.set(id, { id, href: resolvePath(rootPath, href), type: at(it, 'media-type') ?? '', props: at(it, 'properties') ?? '' });
  }
  const spineEl = kid(opf, 'spine');
  const spine = kids(spineEl, 'itemref')
    .filter((r) => at(r, 'linear') !== 'no')
    .map((r) => items.get(at(r, 'idref') ?? ''))
    .filter((i): i is Item => Boolean(i));

  // The contents list: EPUB 3 navigation file, else the older NCX.
  let rawToc: RawToc[] = [];
  const navItem = [...items.values()].find((i) => i.props.split(/\s+/).includes('nav'));
  if (navItem) {
    const t = str(navItem.href);
    if (t) {
      const doc = new DOMParser().parseFromString(t, 'application/xhtml+xml');
      const navs = Array.from(doc.getElementsByTagName('nav'));
      const toc = navs.find((n) => /toc/.test(n.getAttribute('epub:type') ?? '')) ?? navs[0];
      if (toc) rawToc = navToc(toc, navItem.href);
    }
  }
  if (!rawToc.length) {
    const ncxId = spineEl ? at(spineEl, 'toc') : null;
    const ncx = (ncxId && items.get(ncxId)) || [...items.values()].find((i) => i.type === 'application/x-dtbncx+xml');
    const t = ncx ? str(ncx.href) : undefined;
    if (ncx && t) { try { rawToc = ncxToc(parseXml(t), ncx.href); } catch { /* no contents list */ } }
  }

  // Pictures: made into addresses on first use.
  const urls = new Map<string, string>();
  const imageFor = (from: string) => (src: string) => (src.startsWith('data:') ? src : resolvePath(from, src));
  const image = (src: string): string | undefined => {
    if (src.startsWith('data:') || /^https?:/.test(src)) return src;
    const have = urls.get(src);
    if (have) return have;
    const data = get(src);
    if (!data) return undefined;
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[extOf(src)] ?? 'application/octet-stream' }));
    urls.set(src, url);
    return url;
  };

  const chapters: Chapter[] = [];
  const anchorsBy: Map<string, number>[] = [];
  const chapterOfPath = new Map<string, number>();
  const pending: { path: string; index: number }[] = [];
  let words = 0;
  let n = 0;
  for (const item of spine) {
    const html = str(item.href);
    if (!html) continue;
    const { blocks, anchors, heading, title: docTitle } = chapterBlocks(html, imageFor(item.href));
    if (!blocks.length) { pending.push({ path: item.href, index: chapters.length }); continue; }
    n++;
    const fromToc = rawToc.find((t) => t.href === item.href)?.title;
    const generic = (t?: string) => (t && !/^(untitled|document|index|part\d*)$/i.test(t) ? t : undefined);
    chapters.push({ title: fromToc ?? heading ?? generic(docTitle) ?? t('Section {n}', { n }), blocks });
    anchorsBy.push(anchors);
    chapterOfPath.set(item.href, chapters.length - 1);
    for (const p of pending.splice(0)) chapterOfPath.set(p.path, chapters.length - 1);
    for (const b of blocks) words += b.t === 'p' || b.t === 'h' ? countWords(b.x) : 0;
  }
  if (!chapters.length) throw new Error(t('This book has no text to read.'));

  const toc: TocEntry[] = [];
  const seen = new Set<string>();
  for (const t of rawToc) {
    const [path, frag] = t.href.split('#');
    const c = chapterOfPath.get(path);
    if (c === undefined) continue;
    const b = Math.min(frag ? anchorsBy[c].get(frag) ?? 0 : 0, Math.max(0, chapters[c].blocks.length - 1));
    const key = `${c}:${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    toc.push({ title: t.title, level: t.level, c, b });
  }
  if (!toc.length) chapters.forEach((ch, c) => toc.push({ title: ch.title, level: 0, c, b: 0 }));
  toc.sort((a, b) => a.c - b.c || a.b - b.b);

  let cover: Blob | undefined;
  const coverMeta = kids(meta, 'meta').find((m) => at(m, 'name') === 'cover');
  const coverItem = [...items.values()].find((i) => i.props.split(/\s+/).includes('cover-image')) ?? (coverMeta ? items.get(at(coverMeta, 'content') ?? '') : undefined);
  if (coverItem && /^image\//.test(coverItem.type) && get(coverItem.href)) {
    cover = new Blob([get(coverItem.href) as BlobPart], { type: coverItem.type });
  }

  const book: Book = { v: BOOK_VERSION, title: title || t('Untitled book'), author, lang, chapters, toc };
  // Pictures are addressed by their place in the book; the page asks for the real address when it draws one.
  return {
    book,
    image,
    cover,
    words,
    dispose() { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); },
  };
}

// PowerPoint (.pptx) → PDF: one page per slide, shapes where the slide puts them: text (with the
// sizes, colours and bullets that come down from the layout and master), pictures, tables,
// simple shapes and lines.
import { rgb, type PDFPage } from 'pdf-lib';
import { adjust, BLACK, hex, WHITE, type RGB } from './color';
import type { Ctx } from './ctx';
import { familyOf, type Family } from './fonts';
import type { Pack } from './pack';
import { defaultPara, paraAtoms, type Atom, type Para, type Run } from './render';
import { at, kid, kids, num, path, relId, type El } from './xml';

const EMU = 1 / 12700;

// ---- theme ----------------------------------------------------------------------
interface Theme {
  colors: Record<string, RGB>;
  map: Record<string, string>;
  major?: string;
  minor?: string;
  /** Text style the theme gives drawn shapes (usually: centred). */
  shapeLst?: El | null;
}

function readTheme(pack: Pack, themePart: string | undefined, master: El | null): Theme {
  const colors: Record<string, RGB> = {};
  const root = themePart ? pack.doc(themePart) : null;
  const scheme = path(root, 'themeElements', 'clrScheme');
  for (const c of kids(scheme)) {
    const k = kid(c, 'srgbClr') ?? kid(c, 'sysClr');
    const v = k ? (k.localName === 'sysClr' ? at(k, 'lastClr') : at(k, 'val')) : null;
    const col = hex(v);
    if (col) colors[c.localName] = col;
  }
  const map: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
  const cm = kid(master, 'clrMap');
  if (cm) for (let i = 0; i < cm.attributes.length; i++) map[cm.attributes[i].localName] = cm.attributes[i].value;
  const fonts = path(root, 'themeElements', 'fontScheme');
  return {
    colors, map,
    major: at(path(fonts, 'majorFont', 'latin'), 'typeface') ?? undefined,
    minor: at(path(fonts, 'minorFont', 'latin'), 'typeface') ?? undefined,
    shapeLst: path(root, 'objectDefaults', 'spDef', 'lstStyle'),
  };
}

const PRESET: Record<string, RGB> = { black: BLACK, white: WHITE, red: [1, 0, 0], green: [0, 0.5, 0], blue: [0, 0, 1], yellow: [1, 1, 0], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5] };

/** The colour inside an element like `<a:solidFill>` or a run's colour holder. */
function colorIn(el: El | null | undefined, theme: Theme): RGB | undefined {
  const c = kids(el).find((k) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr'].includes(k.localName));
  if (!c) return undefined;
  let base: RGB | undefined;
  const val = at(c, 'val');
  if (c.localName === 'srgbClr') base = hex(val);
  else if (c.localName === 'sysClr') base = hex(at(c, 'lastClr')) ?? (val === 'window' ? WHITE : BLACK);
  else if (c.localName === 'prstClr') base = PRESET[val ?? ''];
  else if (c.localName === 'schemeClr') {
    const name = val ?? '';
    base = theme.colors[theme.map[name] ?? name] ?? (name === 'phClr' ? undefined : undefined);
  }
  if (!base) return undefined;
  const mods: Parameters<typeof adjust>[1] = {};
  for (const m of kids(c)) {
    const v = (num(m, 'val') ?? 100000) / 100000;
    if (m.localName === 'lumMod') mods.lumMod = v;
    else if (m.localName === 'lumOff') mods.lumOff = v;
    else if (m.localName === 'tint') mods.tint = v;
    else if (m.localName === 'shade') mods.shade = v;
  }
  return adjust(base, mods);
}

/** A shape's fill: a colour, null for "no fill", undefined when it says nothing. */
function fillOf(spPr: El | null | undefined, theme: Theme): RGB | null | undefined {
  if (!spPr) return undefined;
  if (kid(spPr, 'noFill')) return null;
  const solid = kid(spPr, 'solidFill');
  if (solid) return colorIn(solid, theme);
  const grad = kid(spPr, 'gradFill');
  if (grad) return colorIn(kid(kid(grad, 'gsLst'), 'gs'), theme);
  return undefined;
}

// ---- text styles --------------------------------------------------------------------
interface RP { sz?: number; b?: boolean; i?: boolean; u?: boolean; strike?: boolean; color?: RGB; family?: Family; baseline?: number }
interface LP {
  marL?: number; indent?: number; algn?: Para['align'];
  bu?: { kind: 'none' } | { kind: 'char'; char: string } | { kind: 'num'; type: string };
  spcBef?: { pts?: number; pct?: number }; spcAft?: { pts?: number; pct?: number }; lnPct?: number; lnPts?: number;
  rp: RP;
}

function fontFamily(face: string | null | undefined, theme: Theme): Family | undefined {
  if (!face) return undefined;
  if (face === '+mj-lt') return familyOf(theme.major);
  if (face === '+mn-lt') return familyOf(theme.minor);
  if (face.startsWith('+')) return undefined;
  return familyOf(face);
}

function rpOf(el: El | null | undefined, theme: Theme): RP {
  const out: RP = {};
  if (!el) return out;
  const sz = num(el, 'sz');
  if (sz !== null) out.sz = sz / 100;
  const b = at(el, 'b'); if (b !== null) out.b = b === '1' || b === 'true';
  const i = at(el, 'i'); if (i !== null) out.i = i === '1' || i === 'true';
  const u = at(el, 'u'); if (u !== null) out.u = u !== 'none';
  const s = at(el, 'strike'); if (s !== null) out.strike = s !== 'noStrike';
  const bl = num(el, 'baseline'); if (bl !== null) out.baseline = bl;
  const sf = kid(el, 'solidFill');
  if (sf) out.color = colorIn(sf, theme);
  const fam = fontFamily(at(kid(el, 'latin'), 'typeface'), theme);
  if (fam) out.family = fam;
  return out;
}

const mergeObj = <T extends object>(...parts: (T | undefined)[]): T => {
  const out: Record<string, unknown> = {};
  for (const p of parts) if (p) for (const [k, v] of Object.entries(p)) if (v !== undefined) out[k] = v;
  return out as T;
};

function lpOf(el: El | null | undefined, theme: Theme): LP {
  const out: LP = { rp: {} };
  if (!el) return out;
  const marL = num(el, 'marL'); if (marL !== null) out.marL = marL * EMU;
  const ind = num(el, 'indent'); if (ind !== null) out.indent = ind * EMU;
  const al = at(el, 'algn');
  if (al) out.algn = al === 'ctr' ? 'c' : al === 'r' ? 'r' : al === 'just' || al === 'justLow' ? 'j' : 'l';
  if (kid(el, 'buNone')) out.bu = { kind: 'none' };
  const bc = kid(el, 'buChar');
  if (bc) out.bu = { kind: 'char', char: at(bc, 'char') ?? '•' };
  const ba = kid(el, 'buAutoNum');
  if (ba) out.bu = { kind: 'num', type: at(ba, 'type') ?? 'arabicPeriod' };
  const sp = (n: string) => {
    const e = kid(el, n);
    if (!e) return undefined;
    const pts = num(kid(e, 'spcPts'), 'val');
    const pct = num(kid(e, 'spcPct'), 'val');
    return pts !== null ? { pts: pts / 100 } : pct !== null ? { pct: pct / 100000 } : undefined;
  };
  out.spcBef = sp('spcBef');
  out.spcAft = sp('spcAft');
  const ln = kid(el, 'lnSpc');
  if (ln) {
    const pct = num(kid(ln, 'spcPct'), 'val');
    const pts = num(kid(ln, 'spcPts'), 'val');
    if (pct !== null) out.lnPct = pct / 100000;
    else if (pts !== null) out.lnPts = pts / 100;
  }
  out.rp = rpOf(kid(el, 'defRPr'), theme);
  return out;
}

const mergeLP = (...parts: (LP | undefined)[]): LP => {
  const out = mergeObj<LP>(...parts);
  out.rp = mergeObj<RP>(...parts.map((p) => p?.rp));
  return out;
};

function levelOf(list: El | null | undefined, lvl: number, theme: Theme): LP | undefined {
  const e = kid(list, `lvl${lvl + 1}pPr`);
  return e ? lpOf(e, theme) : undefined;
}

// ---- shapes -----------------------------------------------------------------------------
interface Box { x: number; y: number; w: number; h: number }
interface Transform { sx: number; sy: number; dx: number; dy: number }

interface PartCtx {
  part: string;
  rels: Map<string, { target: string; type: string }>;
}

interface Inherited {
  type?: string;
  idx?: string;
  box?: Box;
  bodyPr?: El | null;
  lst?: El | null;
}

const phOf = (sp: El): { type?: string; idx?: string } | null => {
  const ph = path(sp, 'nvSpPr', 'nvPr', 'ph') ?? path(sp, 'nvPicPr', 'nvPr', 'ph') ?? path(sp, 'nvGraphicFramePr', 'nvPr', 'ph');
  return ph ? { type: at(ph, 'type') ?? undefined, idx: at(ph, 'idx') ?? undefined } : null;
};

function xfrmBox(xfrm: El | null | undefined): Box | undefined {
  const off = kid(xfrm, 'off');
  const ext = kid(xfrm, 'ext');
  if (!off || !ext) return undefined;
  return { x: (num(off, 'x') ?? 0) * EMU, y: (num(off, 'y') ?? 0) * EMU, w: (num(ext, 'cx') ?? 0) * EMU, h: (num(ext, 'cy') ?? 0) * EMU };
}

const sameTitle = (t?: string) => t === 'title' || t === 'ctrTitle';

export async function pptxToPdf(pack: Pack, ctx: Ctx): Promise<void> {
  const presRels = pack.rels('ppt/presentation.xml');
  const pres = pack.doc('ppt/presentation.xml');
  if (!pres) throw new Error('This PowerPoint file has no slides in it.');
  const size = kid(pres, 'sldSz');
  const pageW = ((num(size, 'cx') ?? 9144000) * EMU);
  const pageH = ((num(size, 'cy') ?? 6858000) * EMU);
  const defaultText = kid(pres, 'defaultTextStyle');

  const slideParts: string[] = [];
  for (const s of kids(kid(pres, 'sldIdLst'), 'sldId')) {
    const target = presRels.get(relId(s) ?? '')?.target;
    if (target && pack.has(target)) slideParts.push(target);
  }
  if (!slideParts.length) throw new Error('This PowerPoint file has no slides in it.');

  const families = new Set<Family>();
  // Decks tend to use one or two typefaces; all three are cheap, so they are all loaded.
  families.add('sans'); families.add('serif'); families.add('mono');
  await ctx.fonts.load(families);

  const themeCache = new Map<string, Theme>();

  for (const slidePart of slideParts) {
    const slide = pack.doc(slidePart);
    if (!slide || at(slide, 'show') === '0') continue;
    const slideRels = pack.rels(slidePart);
    const layoutPart = [...slideRels.values()].find((r) => /slideLayout$/.test(r.type))?.target;
    const layout = layoutPart ? pack.doc(layoutPart) : null;
    const layoutRels = layoutPart ? pack.rels(layoutPart) : new Map();
    const masterPart = [...layoutRels.values()].find((r: { type: string }) => /slideMaster$/.test(r.type))?.target;
    const master = masterPart ? pack.doc(masterPart) : null;
    const masterRels = masterPart ? pack.rels(masterPart) : new Map();
    const themePart = ([...masterRels.values()] as { type: string; target: string }[]).find((r) => /theme$/.test(r.type))?.target;
    const themeKey = themePart ?? '';
    let theme = themeCache.get(themeKey);
    if (!theme) { theme = readTheme(pack, themePart, master); themeCache.set(themeKey, theme); }
    const th = theme;

    // Placeholders on the layout and master, found by type or number.
    const inherit = (root: El | null): Inherited[] => {
      const out: Inherited[] = [];
      for (const sp of kids(path(root, 'cSld', 'spTree'), 'sp')) {
        const ph = phOf(sp);
        if (!ph) continue;
        out.push({ ...ph, box: xfrmBox(path(sp, 'spPr', 'xfrm')), bodyPr: path(sp, 'txBody', 'bodyPr'), lst: path(sp, 'txBody', 'lstStyle') });
      }
      return out;
    };
    const layoutPh = inherit(layout);
    const masterPh = inherit(master);
    const findPh = (list: Inherited[], ph: { type?: string; idx?: string }) =>
      list.find((p) => ph.idx && p.idx === ph.idx && (!ph.type || !p.type || p.type === ph.type))
      ?? list.find((p) => ph.type && (p.type === ph.type || (sameTitle(p.type) && sameTitle(ph.type))))
      ?? (ph.idx && !ph.type ? list.find((p) => p.type === 'body') : undefined);

    const page = ctx.doc.addPage([pageW, pageH]);

    // Background: slide, else layout, else master.
    const bgOf = (root: El | null): RGB | undefined => {
      const bg = path(root, 'cSld', 'bg');
      if (!bg) return undefined;
      const pr = kid(bg, 'bgPr');
      if (pr) { const f = fillOf(pr, th); return f ?? undefined; }
      return colorIn(kid(bg, 'bgRef'), th);
    };
    const bg = bgOf(slide) ?? bgOf(layout) ?? bgOf(master);
    if (bg && (bg[0] < 0.995 || bg[1] < 0.995 || bg[2] < 0.995)) page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: rgb(...bg) });

    const identity: Transform = { sx: 1, sy: 1, dx: 0, dy: 0 };
    const draw = async (tree: El | null, part: PartCtx, tf: Transform, onlyDecor: boolean) => {
      for (const node of kids(tree)) {
        if (node.localName === 'AlternateContent') {
          const pick = kid(node, 'Fallback') ?? kid(node, 'Choice');
          for (const sub of kids(pick)) await drawNode(sub, part, tf, onlyDecor);
          continue;
        }
        await drawNode(node, part, tf, onlyDecor);
      }
    };

    const place = (b: Box, tf: Transform): Box => ({ x: tf.dx + b.x * tf.sx, y: tf.dy + b.y * tf.sy, w: b.w * tf.sx, h: b.h * tf.sy });

    const drawNode = async (n: El, part: PartCtx, tf: Transform, onlyDecor: boolean): Promise<void> => {
      const name = n.localName;
      if (name === 'grpSp') {
        const pr = kid(n, 'grpSpPr');
        const xf = kid(pr, 'xfrm');
        const off = kid(xf, 'off'); const ext = kid(xf, 'ext'); const cho = kid(xf, 'chOff'); const che = kid(xf, 'chExt');
        let inner = tf;
        if (off && ext && cho && che) {
          const cw = (num(che, 'cx') ?? 1) || 1;
          const ch = (num(che, 'cy') ?? 1) || 1;
          const sx = ((num(ext, 'cx') ?? cw) / cw) * tf.sx;
          const sy = ((num(ext, 'cy') ?? ch) / ch) * tf.sy;
          inner = { sx, sy, dx: tf.dx + ((num(off, 'x') ?? 0) * EMU) * tf.sx - (num(cho, 'x') ?? 0) * EMU * sx, dy: tf.dy + ((num(off, 'y') ?? 0) * EMU) * tf.sy - (num(cho, 'y') ?? 0) * EMU * sy };
        }
        await draw(n, part, inner, onlyDecor);
        return;
      }
      const ph = phOf(n);
      if (onlyDecor && ph) return;
      if (name === 'sp' || name === 'cxnSp') await shape(n, tf, ph);
      else if (name === 'pic') await picture(n, part, tf, ph);
      else if (name === 'graphicFrame') await frame(n, tf, ph);
    };

    const boxFor = (n: El, spPr: El | null, ph: { type?: string; idx?: string } | null, tf: Transform): { box: Box; lay?: Inherited; mas?: Inherited } => {
      const lay = ph ? findPh(layoutPh, ph) : undefined;
      const mas = ph ? findPh(masterPh, ph) : undefined;
      const own = xfrmBox(kid(spPr, 'xfrm') ?? kid(n, 'xfrm'));
      const raw = own ?? lay?.box ?? mas?.box ?? { x: 0, y: 0, w: 0, h: 0 };
      return { box: place(raw, own ? tf : identity), lay, mas };
    };

    const drawPath = (pg: PDFPage, box: Box, d: string, fill: RGB | null | undefined, line: { w: number; color: RGB } | null) => {
      pg.drawSvgPath(d, { x: box.x, y: pageH - box.y, color: fill ? rgb(...fill) : undefined, borderColor: line ? rgb(...line.color) : undefined, borderWidth: line?.w });
    };

    const geometry = (prst: string, b: Box): string | null => {
      const { w, h } = b;
      switch (prst) {
        case 'rect': case 'flowChartProcess': case 'snip1Rect': case 'snip2SameRect': case 'plaque': return `M0 0 L${w} 0 L${w} ${h} L0 ${h} Z`;
        case 'roundRect': case 'round1Rect': case 'round2SameRect': {
          const r = Math.min(w, h) * 0.16;
          return `M${r} 0 L${w - r} 0 A${r} ${r} 0 0 1 ${w} ${r} L${w} ${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} L${r} ${h} A${r} ${r} 0 0 1 0 ${h - r} L0 ${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
        }
        case 'ellipse': return `M0 ${h / 2} A${w / 2} ${h / 2} 0 1 1 ${w} ${h / 2} A${w / 2} ${h / 2} 0 1 1 0 ${h / 2} Z`;
        case 'triangle': return `M${w / 2} 0 L${w} ${h} L0 ${h} Z`;
        case 'diamond': return `M${w / 2} 0 L${w} ${h / 2} L${w / 2} ${h} L0 ${h / 2} Z`;
        case 'rightArrow': return `M0 ${h * 0.25} L${w * 0.6} ${h * 0.25} L${w * 0.6} 0 L${w} ${h / 2} L${w * 0.6} ${h} L${w * 0.6} ${h * 0.75} L0 ${h * 0.75} Z`;
        case 'leftArrow': return `M${w} ${h * 0.25} L${w * 0.4} ${h * 0.25} L${w * 0.4} 0 L0 ${h / 2} L${w * 0.4} ${h} L${w * 0.4} ${h * 0.75} L${w} ${h * 0.75} Z`;
        case 'homePlate': case 'pentagon': return `M0 0 L${w * 0.8} 0 L${w} ${h / 2} L${w * 0.8} ${h} L0 ${h} Z`;
        case 'chevron': return `M0 0 L${w * 0.75} 0 L${w} ${h / 2} L${w * 0.75} ${h} L0 ${h} L${w * 0.25} ${h / 2} Z`;
        case 'parallelogram': return `M${w * 0.2} 0 L${w} 0 L${w * 0.8} ${h} L0 ${h} Z`;
        case 'hexagon': return `M${w * 0.25} 0 L${w * 0.75} 0 L${w} ${h / 2} L${w * 0.75} ${h} L${w * 0.25} ${h} L0 ${h / 2} Z`;
        default: return null;
      }
    };

    const shape = async (n: El, tf: Transform, ph: { type?: string; idx?: string } | null) => {
      const spPr = kid(n, 'spPr');
      const { box, lay, mas } = boxFor(n, spPr, ph, tf);
      const prst = at(kid(spPr, 'prstGeom'), 'prst') ?? (kid(spPr, 'custGeom') ? 'custom' : ph ? 'rect' : 'rect');
      // Colours a shape takes from the theme through its style (fill, outline, text).
      const style = kid(n, 'style');
      const styled = (name: string) => { const r = kid(style, name); return r && (num(r, 'idx') ?? 0) > 0 ? colorIn(r, th) : undefined; };
      const own = fillOf(spPr, th);
      const fill = own !== undefined ? own : styled('fillRef');
      const ln = kid(spPr, 'ln');
      const lw = (num(ln, 'w') ?? 12700) * EMU * tf.sx;
      const lineColor = ln ? (kid(ln, 'noFill') ? undefined : colorIn(kid(ln, 'solidFill'), th) ?? styled('lnRef')) : styled('lnRef');
      const line = lineColor ? { w: Math.max(0.25, lw), color: lineColor } : null;
      if (n.localName === 'cxnSp' || prst === 'line' || prst === 'straightConnector1') {
        const xf = kid(spPr, 'xfrm');
        const fh = at(xf, 'flipH') === '1'; const fv = at(xf, 'flipV') === '1';
        const lc = lineColor ?? [0.3, 0.3, 0.3] as RGB;
        page.drawLine({ start: { x: box.x + (fh ? box.w : 0), y: pageH - (box.y + (fv ? box.h : 0)) }, end: { x: box.x + (fh ? 0 : box.w), y: pageH - (box.y + (fv ? 0 : box.h)) }, thickness: Math.max(0.5, lw), color: rgb(...lc) });
        return;
      }
      if ((fill || line) && box.w > 0 && box.h > 0) {
        const d = geometry(prst, box);
        if (d) drawPath(page, box, d, fill, line);
      }
      const tx = kid(n, 'txBody');
      if (!tx || box.w <= 0) return;
      const textColor = colorIn(kid(style, 'fontRef'), th);
      await text(tx, box, ph, lay, mas, tf, textColor, !ph && at(path(n, 'nvSpPr', 'cNvSpPr'), 'txBox') !== '1');
    };

    const text = async (tx: El, box: Box, ph: { type?: string; idx?: string } | null, lay: Inherited | undefined, mas: Inherited | undefined, tf: Transform, styleColor?: RGB, drawn = false) => {
      const bodyPr = kid(tx, 'bodyPr');
      const bp = (name: string) => at(bodyPr, name) ?? at(lay?.bodyPr, name) ?? at(mas?.bodyPr, name);
      const inset = (name: string, def: number) => { const v = bp(name); return (v !== null ? Number(v) : def) * EMU * tf.sx; };
      const padL = inset('lIns', 91440); const padR = inset('rIns', 91440);
      const padT = inset('tIns', 45720) ; const padB = inset('bIns', 45720);
      const anchor = bp('anchor') ?? 't';
      const fontScale = (num(kid(bodyPr, 'normAutofit'), 'fontScale') ?? 100000) / 100000;
      const shrinkOnOverflow = !!kid(bodyPr, 'normAutofit') && num(kid(bodyPr, 'normAutofit'), 'fontScale') === null;

      // The text style that applies: master styles, then master/layout placeholders, then the shape's own.
      const styleList = kid(kid(master, 'txStyles'), sameTitle(ph?.type) ? 'titleStyle' : ph ? 'bodyStyle' : 'otherStyle');
      const own = kid(tx, 'lstStyle');
      const counters: number[] = [];
      const paras: Para[] = [];
      const build = (scale: number) => {
        paras.length = 0;
        counters.length = 0;
        for (const p of kids(tx, 'p')) {
          const pPr = kid(p, 'pPr');
          const lvl = Math.min(8, num(pPr, 'lvl') ?? 0);
          const lp = mergeLP(
            ph ? undefined : levelOf(defaultText, lvl, th),
            drawn ? levelOf(th.shapeLst, lvl, th) : undefined,
            levelOf(styleList, lvl, th), levelOf(mas?.lst, lvl, th), levelOf(lay?.lst, lvl, th), levelOf(own, lvl, th), lpOf(pPr, th),
          );
          const baseRp = lp.rp;
          const baseSize = (baseRp.sz ?? 18) * fontScale * scale;
          const defaultColor = baseRp.color ?? styleColor ?? th.colors[th.map.tx1 ?? 'dk1'] ?? BLACK;
          let label: string | undefined;
          let left = (lp.marL ?? 0) * tf.sx;
          let first = (lp.indent ?? 0) * tf.sx;
          if (lp.bu && lp.bu.kind !== 'none') {
            if (lp.bu.kind === 'char') {
              const ch = lp.bu.char;
              label = ch === '§' ? '▪' : ch === 'Ø' ? '➢' : ch === 'ü' ? '✓' : ch === 'o' ? '◦' : ch.charCodeAt(0) > 0xe000 ? '•' : ch;
              counters.length = lvl + 1;
            } else {
              counters.length = lvl + 1;
              counters[lvl] = (counters[lvl] ?? 0) + 1;
              const v = counters[lvl];
              const t = lp.bu.type;
              const sym = t.startsWith('alphaLc') ? String.fromCharCode(96 + ((v - 1) % 26) + 1) : t.startsWith('alphaUc') ? String.fromCharCode(64 + ((v - 1) % 26) + 1) : t.startsWith('roman') ? roman(v, t.startsWith('romanUc')) : String(v);
              label = t.endsWith('ParenR') ? `${sym})` : t.endsWith('ParenBoth') ? `(${sym})` : `${sym}.`;
            }
            if (left === 0 && first === 0) { left = 18 * tf.sx; first = -18 * tf.sx; }
          } else counters.length = Math.min(counters.length, lvl);
          const runs: Run[] = [];
          for (const r of kids(p)) {
            if (r.localName !== 'r' && r.localName !== 'br' && r.localName !== 'fld') continue;
            if (r.localName === 'br') { runs.push({ text: '\n' }); continue; }
            const rp = mergeObj<RP>(baseRp, rpOf(kid(r, 'rPr'), th));
            const sz = (rp.sz ?? 18) * fontScale * scale;
            runs.push({
              text: kid(r, 't')?.textContent ?? '', bold: rp.b, italic: rp.i, underline: rp.u, strike: rp.strike, color: rp.color,
              size: sz !== baseSize ? sz : undefined, family: rp.family,
              script: rp.baseline ? (rp.baseline > 0 ? 'sup' : 'sub') : undefined,
            });
          }
          const size = baseSize;
          const lineMult = lp.lnPct ?? (lp.lnPts ? Math.max(0.8, lp.lnPts / (size * 1.22)) : 1);
          const sp = (s: LP['spcBef']) => (s?.pts !== undefined ? s.pts : s?.pct !== undefined ? s.pct * size * 1.2 : 0);
          paras.push(defaultPara({
            runs, size: Math.max(4, size), family: baseRp.family ?? fontFamily('+mn-lt', th) ?? 'sans', color: defaultColor,
            align: lp.algn ?? 'l', before: sp(lp.spcBef), after: sp(lp.spcAft), left, first, lineMult, bullet: label,
          }));
        }
      };
      const width = Math.max(box.w - padL - padR, 10);
      const layoutAll = (): Atom[] => paras.flatMap((p) => paraAtoms(p, width, ctx.fonts));
      build(1);
      let atoms = layoutAll();
      const heightOf = (a: Atom[]) => a.reduce((s, x, i) => s + (i ? x.pre : 0) + x.h + x.post, 0);
      let total = heightOf(atoms);
      const room = box.h - padT - padB;
      if (shrinkOnOverflow && room > 0 && total > room) {
        for (let k = 0; k < 3 && total > room; k++) {
          build(Math.max(0.5, Math.sqrt(room / total) * 0.97 * (k === 0 ? 1 : 0.95)));
          atoms = layoutAll();
          total = heightOf(atoms);
        }
      }
      let y = box.y + padT + (anchor === 'ctr' ? (room - total) / 2 : anchor === 'b' ? room - total : 0);
      atoms.forEach((a, i) => {
        if (i) y += a.pre;
        a.draw({ page, pageH }, box.x + padL, y);
        y += a.h + a.post;
      });
    };

    const picture = async (n: El, part: PartCtx, tf: Transform, ph: { type?: string; idx?: string } | null) => {
      const spPr = kid(n, 'spPr');
      const { box } = boxFor(n, spPr, ph, tf);
      const blip = kid(kid(n, 'blipFill'), 'blip');
      const rid = at(blip, 'embed');
      const target = rid ? part.rels.get(rid)?.target : undefined;
      const bytes = target ? pack.bytes(target) : undefined;
      if (!bytes || box.w <= 0 || box.h <= 0) return;
      const src = kid(kid(n, 'blipFill'), 'srcRect');
      const crop = src ? { l: (num(src, 'l') ?? 0) / 100000, t: (num(src, 't') ?? 0) / 100000, r: (num(src, 'r') ?? 0) / 100000, b: (num(src, 'b') ?? 0) / 100000 } : undefined;
      const e = await ctx.image(bytes, crop && (crop.l || crop.t || crop.r || crop.b) ? crop : undefined);
      if (e) page.drawImage(e.image, { x: box.x, y: pageH - box.y - box.h, width: box.w, height: box.h });
    };

    const frame = async (n: El, tf: Transform, ph: { type?: string; idx?: string } | null) => {
      const raw = xfrmBox(kid(n, 'xfrm'));
      const lay = ph ? findPh(layoutPh, ph) : undefined;
      const box = place(raw ?? lay?.box ?? { x: 0, y: 0, w: 0, h: 0 }, raw ? tf : identity);
      const data = kid(kid(n, 'graphic'), 'graphicData');
      const tbl = kid(data, 'tbl');
      if (!tbl) {
        // Charts and diagrams are not drawn; a quiet box says so.
        if (box.w > 0 && box.h > 0) {
          page.drawRectangle({ x: box.x, y: pageH - box.y - box.h, width: box.w, height: box.h, borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.75 });
          const label = /chart/i.test(at(data, 'uri') ?? '') ? 'Chart' : 'Diagram';
          const f = ctx.fonts.get('sans');
          const tw = f.font.widthOfTextAtSize(label, 12);
          page.drawText(label, { x: box.x + (box.w - tw) / 2, y: pageH - box.y - box.h / 2 - 4, size: 12, font: f.font, color: rgb(0.55, 0.55, 0.55) });
        }
        return;
      }
      const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => (num(g, 'w') ?? 0) * EMU * tf.sx);
      const total = cols.reduce((a, b) => a + b, 0) || 1;
      const k = box.w > 0 ? box.w / total : 1;
      const colW = cols.map((c) => c * k);
      const pr = kid(tbl, 'tblPr');
      const firstRow = at(pr, 'firstRow') === '1';
      const band = at(pr, 'bandRow') === '1';
      const accent = th.colors.accent1 ?? [0.27, 0.45, 0.77];
      let y = box.y;
      let rowIndex = 0;
      for (const tr of kids(tbl, 'tr')) {
        const rowMin = (num(tr, 'h') ?? 0) * EMU * tf.sy;
        interface C { x: number; w: number; atoms: Atom[]; fill?: RGB | null; h: number }
        const cells: C[] = [];
        let col = 0;
        for (const tc of kids(tr, 'tc')) {
          const span = num(tc, 'gridSpan') ?? 1;
          if (at(tc, 'hMerge') === '1' || at(tc, 'vMerge') === '1') { col += 1; continue; }
          const w = colW.slice(col, col + span).reduce((a, b) => a + b, 0);
          const x = box.x + colW.slice(0, col).reduce((a, b) => a + b, 0);
          col += span;
          const header = firstRow && rowIndex === 0;
          const explicit = fillOf(kid(tc, 'tcPr'), th);
          const fill = explicit !== undefined ? explicit : header ? accent : band && rowIndex % 2 === 1 ? adjust(accent, { lumMod: 0.2, lumOff: 0.8 }) : band ? adjust(accent, { lumMod: 0.4, lumOff: 0.6 }) : null;
          const tx = kid(tc, 'txBody');
          const atoms: Atom[] = [];
          for (const p of kids(tx, 'p')) {
            const pPr = kid(p, 'pPr');
            const lp = mergeLP(levelOf(defaultText, num(pPr, 'lvl') ?? 0, th), lpOf(pPr, th));
            const size = (lp.rp.sz ?? 14) * tf.sx;
            const runs: Run[] = [];
            for (const r of kids(p)) {
              if (r.localName === 'br') { runs.push({ text: '\n' }); continue; }
              if (r.localName !== 'r' && r.localName !== 'fld') continue;
              const rp = mergeObj<RP>(lp.rp, rpOf(kid(r, 'rPr'), th));
              runs.push({ text: kid(r, 't')?.textContent ?? '', bold: rp.b ?? (header ? true : undefined), italic: rp.i, underline: rp.u, color: rp.color ?? (header && explicit === undefined ? WHITE : undefined), size: rp.sz ? rp.sz * tf.sx : undefined, family: rp.family });
            }
            atoms.push(...paraAtoms(defaultPara({ runs, size, color: lp.rp.color ?? (header && explicit === undefined ? WHITE : th.colors[th.map.tx1 ?? 'dk1'] ?? BLACK), align: lp.algn ?? 'l', family: lp.rp.family ?? 'sans' }), Math.max(w - 14.4 * tf.sx, 10), ctx.fonts));
          }
          cells.push({ x, w, atoms, fill, h: atoms.reduce((s, a) => s + a.h, 0) });
        }
        const rowH = Math.max(rowMin, ...cells.map((c) => c.h + 7.2 * tf.sy));
        for (const c of cells) {
          if (c.fill) page.drawRectangle({ x: c.x, y: pageH - y - rowH, width: c.w, height: rowH, color: rgb(...c.fill) });
          page.drawRectangle({ x: c.x, y: pageH - y - rowH, width: c.w, height: rowH, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
          let yy = y + 3.6 * tf.sy;
          for (const a of c.atoms) { a.draw({ page, pageH }, c.x + 7.2 * tf.sx, yy); yy += a.h; }
        }
        y += rowH;
        rowIndex++;
      }
    };

    // Master and layout decoration first (logos, bars), then the slide itself.
    const showMaster = at(layout, 'showMasterSp') !== '0';
    if (master && showMaster) await draw(path(master, 'cSld', 'spTree'), { part: masterPart!, rels: masterRels }, identity, true);
    if (layout) await draw(path(layout, 'cSld', 'spTree'), { part: layoutPart!, rels: layoutRels }, identity, true);
    await draw(path(slide, 'cSld', 'spTree'), { part: slidePart, rels: slideRels }, identity, false);
  }
}

function roman(n: number, upper: boolean): string {
  const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [k, r] of t) while (n >= k) { s += r; n -= k; }
  return upper ? s.toUpperCase() : s;
}

import { memo, type CSSProperties } from 'react';
import type { Block, Run } from '../lib/book/model';
import { HIGHLIGHTS, type HighlightColor } from '../lib/book/settings';

export interface MarkRange {
  id: string;
  start: number;
  end: number;
  color: HighlightColor;
  note: boolean;
}

interface Segment {
  text: string;
  o: number;
  flags: number;
  mark?: MarkRange;
  found?: boolean;
}

function segments(x: string, runs: Run[] | undefined, marks: MarkRange[] | undefined, term: string): Segment[] {
  const cuts = new Set<number>([0, x.length]);
  const flagAt: [number, number, number][] = [];
  let at = 0;
  for (const [t, f] of runs ?? [[x, 0] as Run]) {
    flagAt.push([at, at + t.length, f]);
    cuts.add(at);
    at += t.length;
  }
  marks?.forEach((m) => { cuts.add(Math.max(0, m.start)); cuts.add(Math.min(x.length, m.end)); });
  const found: [number, number][] = [];
  if (term) {
    const lower = x.toLowerCase();
    for (let i = lower.indexOf(term); i >= 0; i = lower.indexOf(term, i + term.length)) {
      found.push([i, i + term.length]);
      cuts.add(i);
      cuts.add(i + term.length);
    }
  }
  const points = [...cuts].filter((c) => c >= 0 && c <= x.length).sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const flags = flagAt.find(([s, e]) => start >= s && start < e)?.[2] ?? 0;
    const mark = marks ? [...marks].reverse().find((m) => start >= m.start && end <= m.end) : undefined;
    out.push({ text: x.slice(start, end), o: start, flags, mark, found: found.some(([s, e]) => start >= s && end <= e) });
  }
  return out;
}

function Text({ x, runs, marks, term }: { x: string; runs?: Run[]; marks?: MarkRange[]; term: string }) {
  if (!marks && !term && !runs) return <span data-o={0}>{x}</span>;
  return (
    <>
      {segments(x, runs, marks, term).map((s) => {
        const cls = [s.flags & 1 ? 'bk-i' : '', s.flags & 2 ? 'bk-b' : '', s.mark ? `bk-hl${s.mark.note ? ' bk-noted' : ''}` : '', s.found ? 'bk-found' : ''].filter(Boolean).join(' ');
        const style = s.mark ? ({ ['--hl' as string]: HIGHLIGHTS[s.mark.color] } as CSSProperties) : undefined;
        return <span key={s.o} data-o={s.o} data-m={s.mark?.id} className={cls || undefined} style={style}>{s.text}</span>;
      })}
    </>
  );
}

interface Props {
  block: Block;
  index: number;
  marks?: MarkRange[];
  term: string;
  image: (src: string) => string | undefined;
  onImage: () => void;
}

/** One paragraph, heading or picture of the book. */
export const BlockView = memo(function BlockView({ block, index, marks, term, image, onImage }: Props) {
  if (block.t === 'p') {
    const cls = `bk-p${block.q ? ' bk-q' : ''}${block.c ? ' bk-c' : ''}${block.n ? ' bk-n' : ''}`;
    return (
      <p className={cls} data-b={index} data-len={block.x.length}>
        <Text x={block.x} runs={block.r} marks={marks} term={term} />
      </p>
    );
  }
  if (block.t === 'h') {
    const Tag = (`h${block.l + 1}`) as 'h2' | 'h3' | 'h4';
    return (
      <Tag className={`bk-h bk-h${block.l}`} data-b={index} data-len={block.x.length}>
        <Text x={block.x} marks={marks} term={term} />
      </Tag>
    );
  }
  if (block.t === 'i') {
    const src = image(block.src);
    return (
      <figure className="bk-fig" data-b={index} data-len={0}>
        {src && <img src={src} alt={block.alt ?? ''} draggable={false} onLoad={onImage} onError={onImage} />}
      </figure>
    );
  }
  return <p className="bk-r" data-b={index} data-len={0} aria-hidden="true">* * *</p>;
});

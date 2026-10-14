import type { ToolId } from './toolList';

/** A small page, the motif every picture here is drawn from. */
function Page({ x, y, w = 34, h = 44, turn }: { x: number; y: number; w?: number; h?: number; turn?: string }) {
  return (
    <g transform={turn}>
      <rect x={x} y={y} width={w} height={h} rx="4" className="art-page" />
      <path className="art-line" d={`M${x + 6} ${y + 10}h${w - 12}M${x + 6} ${y + 17}h${w - 12}M${x + 6} ${y + 24}h${w - 18}`} />
    </g>
  );
}

const Arrow = ({ x, y, len }: { x: number; y: number; len: number }) => (
  <>
    <path className="art-trail" d={`M${x} ${y}h${len}`} strokeDasharray="1 6" />
    <path className="art-head" d={`M${x + len - 4} ${y - 6}l8 6-8 6`} />
  </>
);

/** A small picture of what a tool does, in the tool's colour (`--fc`). */
export function ToolArt({ id }: { id: ToolId }) {
  return (
    <svg className="tool-art" viewBox="0 0 220 100" aria-hidden="true" focusable="false">
      {id === 'merge' && (
        <>
          <Page x={8} y={8} /><Page x={34} y={24} /><Page x={60} y={40} />
          <Arrow x={104} y={52} len={46} />
          <Page x={166} y={24} w={40} h={52} />
        </>
      )}
      {id === 'split' && (
        <>
          <Page x={30} y={22} w={44} h={56} />
          <path className="art-cut" d="M52 12v76" strokeDasharray="4 4" />
          <Arrow x={100} y={50} len={30} />
          <Page x={146} y={18} w={26} h={40} /><Page x={178} y={42} w={26} h={40} />
        </>
      )}
      {id === 'crop' && (
        <>
          <rect x="62" y="8" width="64" height="84" rx="5" className="art-page" />
          <path className="art-line" d="M72 22h44M72 31h44M72 40h44M72 49h30M72 58h44M72 67h38" />
          <path className="art-corner" d="M70 28v-12h12M118 28v-12h-12M70 72v12h12M118 72v12h-12" />
          <Arrow x={146} y={50} len={24} />
          <rect x="182" y="26" width="26" height="48" rx="3" className="art-page" />
        </>
      )}
      {id === 'edit' && (
        <>
          <Page x={12} y={22} /><Page x={60} y={22} turn="rotate(10 77 44)" /><Page x={110} y={22} />
          <path className="art-trail" d="M158 34c18-14 34-6 38 6" />
          <path className="art-head" d="M190 36l7 5-9 3" />
          <path className="art-trail" d="M158 62c18 14 34 6 38-6" strokeDasharray="1 5" />
        </>
      )}
    </svg>
  );
}

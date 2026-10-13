import { delay } from './PenScene';

/** Four tiny looping pictures, one per PDF tool. Pure SVG + CSS, no images to load. */
function MergeArt() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="ta ta-merge">
      <rect className="ta-page ta-a" x="5" y="6" width="13" height="19" rx="2" />
      <rect className="ta-page ta-b" x="14" y="7" width="13" height="19" rx="2" />
      <path className="ta-line ta-l1" d="M9 12h5M9 16h5" />
      <path className="ta-line ta-l2" d="M18 13h5M18 17h5" />
    </svg>
  );
}

function SplitArt() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="ta ta-split">
      <path className="ta-page ta-half-l" d="M8 6h8v20H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      <path className="ta-page ta-half-r" d="M16 6h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-8z" />
      <path className="ta-cut" d="M16 3v26" />
      <path className="ta-line" d="M9.5 12h4M9.5 16h4M18.5 12h4M18.5 16h4" />
    </svg>
  );
}

function CropArt() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="ta ta-crop">
      <rect className="ta-page" x="5" y="4" width="22" height="24" rx="2" />
      <path className="ta-line" d="M10 11h12M10 16h12M10 21h8" />
      <g className="ta-frame">
        <rect x="5" y="4" width="22" height="24" rx="1" />
        <path d="M5 9V4h5M22 4h5v5M27 23v5h-5M10 28H5v-5" />
      </g>
    </svg>
  );
}

function EditArt() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="ta ta-edit">
      <g className="ta-turn">
        <rect className="ta-page" x="9" y="5" width="14" height="19" rx="2" />
        <path className="ta-line" d="M12.5 10h7M12.5 14h7M12.5 18h4" />
      </g>
      <g className="ta-plus">
        <circle cx="25" cy="25" r="5" />
        <path d="M25 22.6v4.8M22.6 25h4.8" />
      </g>
    </svg>
  );
}

const CHIPS = [
  { name: 'Merge', colour: 'c-blue', art: <MergeArt /> },
  { name: 'Split', colour: 'c-red', art: <SplitArt /> },
  { name: 'Crop', colour: 'c-green', art: <CropArt /> },
  { name: 'Edit', colour: 'c-purple', art: <EditArt /> },
];

/** Sits beside the brand on the landing page: what the PDF tools are, before anyone signs in. */
export function ToolChips({ onTry }: { onTry: () => void }) {
  return (
    <div className="nav-tools" role="group" aria-label="Free PDF tools">
      <span className="nav-tools-label">PDF tools</span>
      {CHIPS.map((c, i) => (
        <button
          key={c.name}
          className={`nav-tool ${c.colour}`}
          style={delay(0.35 + i * 0.12)}
          onClick={onTry}
          aria-label={`${c.name} PDFs, no account needed`}
          title={`${c.name} PDFs: free, on your device, no account needed`}
        >
          {c.art}
          <span>{c.name}</span>
        </button>
      ))}
    </div>
  );
}

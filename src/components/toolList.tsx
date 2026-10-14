import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon, CropIcon, EditPagesIcon, MergeIcon, ToolsIcon, SplitIcon } from './icons';

export type ToolId = 'merge' | 'split' | 'crop' | 'edit';

export const TOOLS: {
  id: ToolId;
  title: string;
  blurb: string;
  color: string;
  Icon: () => React.JSX.Element;
}[] = [
  { id: 'merge', title: 'Merge', blurb: 'Combine several PDFs into one', color: 'blue', Icon: MergeIcon },
  { id: 'split', title: 'Split', blurb: 'Cut a PDF apart, or pull out pages', color: 'red', Icon: SplitIcon },
  { id: 'crop', title: 'Crop', blurb: 'Trim the margins off every page', color: 'green', Icon: CropIcon },
  { id: 'edit', title: 'Edit pages', blurb: 'Reorder, rotate, delete or add pages', color: 'purple', Icon: EditPagesIcon },
];

/** The four tools to choose from: a dialog on desktop, a sheet from the bottom on phones. */
export function ToolMenu({ onPick, onClose }: { onPick: (id: ToolId) => void; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="tool-menu" role="dialog" aria-modal="true" aria-label="PDF tools">
      <div className="tool-menu-backdrop" onClick={onClose} />
      <div className="tool-menu-sheet">
        <header className="tool-menu-head">
          <span className="tool-menu-spark"><ToolsIcon /></span>
          <div>
            <h2>PDF tools</h2>
            <p>Done on your device. Your files are never uploaded.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </header>
        <div className="tool-cards">
          {TOOLS.map(({ id, title, blurb, color, Icon }, i) => (
            <button
              key={id}
              className={`tool-card c-${color}`}
              style={{ ['--i' as string]: i }}
              onClick={() => onPick(id)}
            >
              <span className="tool-card-icon"><Icon /></span>
              <span className="tool-card-title">{title}</span>
              <span className="tool-card-blurb">{blurb}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { useRef, useState } from 'react';
import { turnChange, type PageMove } from '../lib/carryNotes';
import { pageSize } from '../lib/pdf';
import { arrangePdf } from '../lib/pdfOps';
import { ArrowIcon, BackIcon, CopyIcon, PlusIcon, RotateLeftIcon, RotateRightIcon, TrashIcon } from './icons';
import { Busy, errorText, fileOf, Notice, PageThumb, PickOne, plural, Shell, usePdf, type ToolContext, type ToolDoc } from './toolKit';

interface Step {
  key: number;
  from: number | null;
  turn: number;
  removed: boolean;
}

export function OrganizeTool({ ctx, onClose }: { ctx: ToolContext; onClose: () => void }) {
  const [doc, setDoc] = useState<ToolDoc | null>(null);
  if (!doc) return <PickOne ctx={ctx} tool="edit" onPick={setDoc} onClose={onClose} />;
  return <Organizer ctx={ctx} doc={doc} onBack={() => setDoc(null)} onClose={onClose} />;
}

function Organizer({ ctx, doc, onBack, onClose }: { ctx: ToolContext; doc: ToolDoc; onBack: () => void; onClose: () => void }) {
  const { pdf, error: loadError } = usePdf(doc);
  const keys = useRef(doc.pages);
  const fresh = (): Step[] => Array.from({ length: doc.pages }, (_, i) => ({ key: i, from: i, turn: 0, removed: false }));
  const [steps, setSteps] = useState<Step[]>(fresh);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kept = steps.filter((s) => !s.removed);
  const edited = steps.length !== doc.pages || steps.some((s, i) => s.removed || s.turn || s.from !== i);
  const patch = (key: number, f: (s: Step) => Step) => setSteps((cur) => cur.map((s) => (s.key === key ? f(s) : s)));
  const turn = (key: number, by: number) => patch(key, (s) => ({ ...s, turn: (((s.turn + by) % 360) + 360) % 360 }));
  const move = (index: number, by: number) => setSteps((cur) => {
    const j = index + by;
    if (j < 0 || j >= cur.length) return cur;
    const next = [...cur];
    [next[index], next[j]] = [next[j], next[index]];
    return next;
  });
  const duplicate = (index: number) => setSteps((cur) => {
    const next = [...cur];
    next.splice(index + 1, 0, { ...cur[index], key: keys.current++, removed: false });
    return next;
  });
  const addBlank = () => setSteps((cur) => [...cur, { key: keys.current++, from: null, turn: 0, removed: false }]);

  const run = async () => {
    setError(null);
    setBusy('Building the new document…');
    try {
      const bytes = await arrangePdf(await fileOf(doc), kept.map((s) => ({ from: s.from, turn: s.turn })));
      // Each kept page would take its notes along (a copied page gets its own copy), turned with the page.
      const moves: PageMove[] = [];
      if (pdf && !doc.temp) {
        for (const [to, s] of kept.entries()) {
          if (s.from === null) continue;
          const size = await pageSize(pdf, s.from);
          moves.push({ from: s.from, to, change: s.turn ? turnChange(s.turn, size.h / size.w) : undefined });
        }
      }
      ctx.finish({
        title: `Your edited copy has ${plural(kept.length, 'page', 'pages')}`,
        outputs: [{ name: name.trim() || `${doc.name} (edited)`, bytes, pages: kept.length, folder: ctx.folderOf(doc), sources: moves.length ? [{ docId: doc.id, moves }] : [] }],
      });
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  return (
    <Shell title="Edit pages" subtitle={`${doc.name} · ${plural(kept.length, 'page', 'pages')}`} color="purple" onBack={onBack} onClose={onClose}
      footer={<button className="button" disabled={!!busy || !kept.length || !edited} onClick={() => void run()}>
        {!edited ? 'Rotate, move or delete pages to begin' : !kept.length ? 'Keep at least one page' : `Make a new PDF with ${plural(kept.length, 'page', 'pages')}`}
      </button>}>
      {busy && <Busy label={busy} />}
      {(error || loadError) && <Notice>{error ?? loadError}</Notice>}

      <div className="tool-bar">
        <span className="tool-hint">Your original stays as it is; this makes a new PDF.</span>
        <span className="tool-bar-actions">
          <button className="chip-button" onClick={() => setSteps((cur) => cur.map((s) => ({ ...s, turn: (s.turn + 90) % 360 })))}><RotateRightIcon /> Rotate all</button>
          <button className="chip-button" onClick={addBlank}><PlusIcon /> Blank page</button>
          <button className="link" onClick={() => setSteps(fresh())} disabled={!edited}>Reset</button>
        </span>
      </div>

      <ul className="page-grid organize">
        {steps.map((s, i) => (
          <li key={s.key}>
            <div className={`page-tile org${s.removed ? ' removed' : ''}`}>
              <span className="page-tile-img">
                {s.from === null ? <span className="blank-page">Blank</span> : <PageThumb pdf={pdf} page={s.from} turn={s.turn} />}
              </span>
              <span className="page-tile-num">{i + 1}</span>
              <span className="org-move">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move page ${i + 1} earlier`}><BackIcon /></button>
                <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label={`Move page ${i + 1} later`}><ArrowIcon /></button>
              </span>
              {s.removed && <span className="org-removed">Deleted</span>}
              <span className="org-tools">
                <button onClick={() => turn(s.key, -90)} aria-label={`Rotate page ${i + 1} left`}><RotateLeftIcon /></button>
                <button onClick={() => turn(s.key, 90)} aria-label={`Rotate page ${i + 1} right`}><RotateRightIcon /></button>
                <button onClick={() => duplicate(i)} aria-label={`Duplicate page ${i + 1}`}><CopyIcon /></button>
                <button className={s.removed ? 'on' : 'danger'} onClick={() => patch(s.key, (x) => ({ ...x, removed: !x.removed }))} aria-label={s.removed ? `Restore page ${i + 1}` : `Delete page ${i + 1}`}>
                  {s.removed ? <RotateLeftIcon /> : <TrashIcon />}
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>

      {edited && (
        <label className="tool-field">
          <span>Name of the new document</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${doc.name} (edited)`} maxLength={120} />
        </label>
      )}
    </Shell>
  );
}

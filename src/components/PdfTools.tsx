import { useEffect, useMemo, useRef, useState } from 'react';
import { importPdf } from '../lib/importPdf';
import { t } from '../lib/i18n';
import { openPaywall, PlanLimit } from '../lib/plan';
import { movedStrokes, type PageMove } from '../lib/carryNotes';
import { mergePdfs, pageCount, parseRanges, splitPdf } from '../lib/pdfOps';
import { createFolder, getMarkCounts, loadInk, recordInkEdit } from '../lib/storage';
import { makeZip } from '../lib/zip';
import type { DocMeta } from '../lib/types';
import { CropTool } from './CropTool';
import { Cover } from './Cover';
import { ArrowIcon, CheckIcon, CloseIcon, CloudOffIcon, DownloadIcon, FileIcon, FolderIcon, MarkIcon, PlusIcon, ToolsIcon, UploadIcon } from './icons';
import { GoogleButton } from './SyncControl';
import { OrganizeTool } from './OrganizeTool';
import { TOOLS, type ToolId } from './toolList';
import {
  Busy, cleanName, DocList, errorText, fileOf, Notice, NotesAsk, type OutputSpec, PageThumb, PickOne, plural,
  SaveOption, Shell, usePdf, type ToolContext, type ToolDoc,
} from './toolKit';

interface Props {
  tool: ToolId;
  docs: DocMeta[];
  folderOf: (d: DocMeta) => string | null;
  onClose: () => void;
  /** Signed in to Google: saved files sync, unless kept on the device. */
  signedIn: boolean;
  /** Shown before sign-in: files come from the device and can only be downloaded. */
  guest?: boolean;
  /** Documents to start from, chosen on the tools page. */
  start?: DocMeta[];
  /** The library changed (documents or folders were added). */
  onChanged: () => void;
  onOpen: (id: string) => void;
}

interface Finished {
  title: string;
  outputs: OutputSpec[];
}

/** The documents the tools work on, and the screens they go through. */
export default function PdfTools({ tool, docs, folderOf, onClose, signedIn, guest, start, onChanged, onOpen }: Props) {
  const [finished, setFinished] = useState<Finished | null>(null);
  const ctx: ToolContext = useMemo(() => ({ docs, folderOf, guest, start, finish: setFinished }), [docs, folderOf, guest, start]);
  if (finished) {
    return <Ready tool={tool} finished={finished} signedIn={signedIn} guest={guest} onClose={onClose} onChanged={onChanged} onOpen={onOpen} />;
  }
  return tool === 'merge' ? <MergeTool ctx={ctx} onClose={onClose} />
    : tool === 'split' ? <SplitTool ctx={ctx} onClose={onClose} />
    : tool === 'crop' ? <CropTool ctx={ctx} onClose={onClose} />
    : <OrganizeTool ctx={ctx} onClose={onClose} />;
}

// ---- the finished PDFs: download them, and choose whether to keep them --------------------------
const LOCAL_KEY = 'reader.tools.local';
const size = (bytes: number) => (bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Then = { kind: 'none' } | { kind: 'download'; index: number } | { kind: 'zip' } | { kind: 'open'; index: number };
type Dialog = null | { step: 'save' | 'notes' | 'discard'; then: Then };

interface Row {
  spec: OutputSpec;
  saved?: DocMeta;
  carried?: number;
  downloaded?: boolean;
}

function Ready({ tool, finished, signedIn, guest, onClose, onChanged, onOpen }: {
  tool: ToolId;
  finished: Finished;
  signedIn: boolean;
  guest?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onOpen: (id: string) => void;
}) {
  const meta = TOOLS.find((x) => x.id === tool)!;
  const [rows, setRows] = useState<Row[]>(() => finished.outputs.map((spec) => ({ spec })));
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const [marks, setMarks] = useState(0);
  const [localOn, setLocalOn] = useState(() => {
    try { return localStorage.getItem(LOCAL_KEY) === '1'; } catch { return false; }
  });
  const localOnly = signedIn && localOn;
  const setLocal = (v: boolean) => {
    setLocalOn(v);
    try { localStorage.setItem(LOCAL_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  };
  const many = rows.length > 1;
  const unsaved = rows.filter((r) => !r.saved);
  
  // How many marks the originals hold, for asking whether they should come along.
  useEffect(() => {
    const ids = [...new Set(finished.outputs.flatMap((o) => o.sources.map((s) => s.docId)))];
    let gone = false;
    void getMarkCounts(ids).then((m) => { if (!gone) setMarks([...m.values()].reduce((a, b) => a + b, 0)); });
    return () => { gone = true; };
  }, [finished]);

  const toBlob = (r: Row) => new Blob([r.spec.bytes as BlobPart], { type: 'application/pdf' });
  const fileName = (r: Row) => `${cleanName(r.spec.name)}.pdf`;
  const markDownloaded = (indexes: number[]) => setRows((cur) => cur.map((r, i) => (indexes.includes(i) ? { ...r, downloaded: true } : r)));

  const perform = (then: Then, list: Row[]) => {
    if (then.kind === 'download') {
      saveFile(toBlob(list[then.index]), fileName(list[then.index]));
      markDownloaded([then.index]);
    } else if (then.kind === 'zip') {
      saveFile(makeZip(list.map((r) => ({ name: fileName(r), bytes: r.spec.bytes }))), `${cleanName(finished.outputs[0].newFolder ?? finished.title)}.zip`);
      markDownloaded(list.map((_, i) => i));
    } else if (then.kind === 'open') {
      const saved = list[then.index].saved;
      if (saved) onOpen(saved.id);
    }
  };

  /** Puts every unsaved file in the library, with its notes if asked. */
  const save = async (bring: boolean, then: Then) => {
    setDialog(null);
    setError(null);
    setBusy(t('Saving…'));
    try {
      const folders = new Map<string, string>();
      const next = [...rows];
      for (const [i, row] of next.entries()) {
        if (row.saved) continue;
        let folder = row.spec.folder;
        if (row.spec.newFolder) {
          if (!folders.has(row.spec.newFolder)) folders.set(row.spec.newFolder, (await createFolder(row.spec.newFolder)).id);
          folder = folders.get(row.spec.newFolder)!;
        }
        const file = new File([row.spec.bytes as BlobPart], fileName(row), { type: 'application/pdf' });
        const saved = await importPdf(file, folder ?? undefined, { localOnly });
        let carried = 0;
        if (bring) {
          for (const src of row.spec.sources) {
            const ink = await loadInk(src.docId);
            for (const { page, strokes } of movedStrokes(ink, src.moves as PageMove[])) {
              await recordInkEdit(saved.id, page, [], strokes);
              carried += strokes.length;
            }
          }
        }
        next[i] = { ...row, saved, carried };
      }
      setRows(next);
      onChanged();
      setBusy(null);
      perform(then, next);
    } catch (err) {
      if (err instanceof PlanLimit) openPaywall('docs');
      setError(errorText(err));
      setBusy(null);
    }
  };

  /** Starts an action; files not yet kept raise the "save to your account?" question first. */
  const act = (then: Then) => {
    if (guest) {
      if (then.kind === 'download' || then.kind === 'zip') perform(then, rows);
      return;
    }
    const needsSave = then.kind === 'open' ? !rows[then.index].saved : unsaved.length > 0 && !declined && then.kind !== 'none';
    if (then.kind === 'none' && unsaved.length === 0) return;
    if (then.kind === 'none' || needsSave) setDialog({ step: 'save', then });
    else perform(then, rows);
  };
  const answer = (yes: boolean, then: Then) => {
    if (!yes) {
      setDeclined(true);
      setDialog(null);
      perform(then, rows);
    } else if (marks > 0) {
      setDialog({ step: 'notes', then });
    } else {
      void save(false, then);
    }
  };

  const leave = () => {
    if (rows.some((r) => !r.saved && !r.downloaded)) setDialog({ step: 'discard', then: { kind: 'none' } });
    else onClose();
  };

  const then = dialog?.then;
  const downloads = then && (then.kind === 'download' || then.kind === 'zip');

  return (
    <Shell title={many ? t('Your new PDFs') : t('Your new PDF')} subtitle={finished.title} color={meta.color} onClose={leave}
      footer={<button className="button" onClick={leave}>{guest ? t('Done') : t('Back to library')}</button>}>
      {busy && <Busy label={busy} />}
      {error && <Notice>{error}</Notice>}

      <div className="tool-done">
        <span className="tool-done-check"><CheckIcon /></span>
        <h3>{finished.title}</h3>
        <ul className="tool-done-list">
          {rows.map((r, i) => (
            <li key={i}>
              <span className="docrow-cover">{r.saved ? <Cover meta={r.saved} /> : <span className="cover-fallback"><FileIcon /></span>}</span>
              <span className="docrow-text">
                <span className="docrow-name">{r.spec.name}</span>
                <span className="docrow-meta">{plural(r.spec.pages, 'page', 'pages')} · {size(r.spec.bytes.length)}</span>
                {r.saved && (
                  <span className="docrow-status">
                    {r.saved.localOnly ? <CloudOffIcon /> : <CheckIcon />}
                    {r.saved.localOnly ? t('Saved on this device only') : signedIn ? t('Saved to your account') : t('Saved to your library')}
                    {!!r.carried && <> · <MarkIcon /> {t('{marks} came along', { marks: plural(r.carried, 'mark', 'marks') })}</>}
                  </span>
                )}
              </span>
              <button className="chip-button" onClick={() => act({ kind: 'download', index: i })} aria-label={t('Download {name}', { name: r.spec.name })}>
                <DownloadIcon /> {t('Download')}
              </button>
              {guest ? null : (
                <button className="chip-button chip-primary" onClick={() => act({ kind: 'open', index: i })} aria-label={t('Open {name}', { name: r.spec.name })}>
                  {t('Open')} <ArrowIcon />
                </button>
              )}
            </li>
          ))}
        </ul>
        {many && (
          <button className="chip-button" onClick={() => act({ kind: 'zip' })}>
            <DownloadIcon /> {t('Download all as one ZIP')}
          </button>
        )}
        {!guest && rows[0].spec.newFolder && unsaved.length > 0 && (
          <p className="tool-done-folder"><FolderIcon /> {t('They will go in a new folder, “{name}”', { name: rows[0].spec.newFolder })}</p>
        )}
        {guest && (
          <div className="keep-card">
            <div>
              <strong>{many ? t('Download them now') : t('Download it now')}</strong>
              <p>{many ? t('Nothing is kept here, so save them to your device.') : t('Nothing is kept here, so save it to your device.')}</p>
            </div>
          </div>
        )}
        {!guest && unsaved.length > 0 && (
          <div className="keep-card">
            <div>
              <strong>{t('Not saved yet')}</strong>
              <p>{signedIn
                ? many ? t('Keep these in your account to read them here, mark them up and find them on your other devices.') : t('Keep this in your account to read it here, mark it up and find it on your other devices.')
                : many ? t('Keep these in your library to read them here, mark them up and find them on your other devices.') : t('Keep this in your library to read it here, mark it up and find it on your other devices.')}</p>
            </div>
            <button className="button button-small" onClick={() => act({ kind: 'none' })}>{signedIn ? t('Save to your account') : t('Save to your library')}</button>
          </div>
        )}
        <Promo guest={guest} />
        {/* Room for an advertisement (AdSense) later. */}
        <div className="ad-slot" aria-hidden="true" />
      </div>

      {dialog?.step === 'save' && then && (
        <div className="tool-busy tool-ask" role="alertdialog" aria-label={signedIn ? t('Save to your account?') : t('Save to your library?')}>
          <div className="tool-ask-card">
            <span className="tool-ask-icon save"><CheckIcon /></span>
            <h3>{signedIn ? t('Save to your account?') : t('Save to your library?')}</h3>
            <p>
              {signedIn
                ? many ? t('Add the new PDFs to your account, so they are on all your devices.') : t('Add the new PDF to your account, so it is on all your devices.')
                : many ? t('Add the new PDFs to your library on this device.') : t('Add the new PDF to your library on this device.')}
            </p>
            <SaveOption signedIn={signedIn} localOnly={localOnly} onChange={setLocal} />
            <button className="button" onClick={() => answer(true, then)}>
              {then.kind === 'open' ? t('Save and open') : downloads ? t('Yes, save and download') : t('Yes, save')}
            </button>
            {downloads && <button className="chip-button" onClick={() => answer(false, then)}>{t('No, just download')}</button>}
            <button className="link" onClick={() => setDialog(null)}>{t('Cancel')}</button>
          </div>
        </div>
      )}
      {dialog?.step === 'notes' && then && (
        <NotesAsk marks={marks} plural={many} onChoose={(b) => void save(b, then)} onCancel={() => setDialog({ step: 'save', then })} />
      )}
      {dialog?.step === 'discard' && (
        <div className="tool-busy tool-ask" role="alertdialog" aria-label={many ? t('Leave without keeping them?') : t('Leave without keeping it?')}>
          <div className="tool-ask-card">
            <span className="tool-ask-icon warn"><CloseIcon /></span>
            <h3>{many ? t('Leave without keeping them?') : t('Leave without keeping it?')}</h3>
            <p>{many ? t('The new PDFs have not been saved or downloaded. They will be lost.') : t('The new PDF has not been saved or downloaded. It will be lost.')}</p>
            <button className="button" onClick={() => setDialog(null)}>{t('Stay')}</button>
            <button className="chip-button" onClick={onClose}>{t('Leave without saving')}</button>
          </div>
        </div>
      )}
    </Shell>
  );
}

/** A light word about the site, shown under finished files. */
function Promo({ guest }: { guest?: boolean }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const data = { title: 'Leafpage', text: t('A PDF reader that feels like paper: write on your pages, keep everything in your own Google Drive.'), url: location.origin };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(location.origin);
        setCopied(true);
      }
    } catch { /* cancelled */ }
  };
  return (
    <aside className="promo">
      <span className="promo-mark"><ToolsIcon /></span>
      <div className="promo-text">
        <strong>{guest ? t('Like it? There is more in Leafpage.') : t('Like Leafpage? Tell a friend.')}</strong>
        <p>
          {guest
            ? t('Write on your PDFs with a pen and highlighter, and find them on every device, kept in your own Google Drive.')
            : t('A PDF reader that feels like paper, free to use.')}
        </p>
      </div>
      {guest ? <GoogleButton label={t('Continue with Google')} /> : <button className="chip-button" onClick={() => void share()}>{copied ? t('Link copied') : t('Share')}</button>}
    </aside>
  );
}

// ---- merge ---------------------------------------------------------------------
interface Item {
  key: string;
  name: string;
  pages?: number;
  doc?: DocMeta;
  blob?: Blob;
}

function MergeTool({ ctx, onClose }: { ctx: ToolContext; onClose: () => void }) {
  const [items, setItems] = useState<Item[]>(() => (ctx.start ?? []).map((d) => ({ key: d.id, name: d.name, pages: d.pages, doc: d })));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<{ label: string; fraction?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const taken = new Set(items.flatMap((i) => (i.doc ? [i.doc.id] : [])));
  const available = ctx.docs.filter((d) => !taken.has(d.id));
  const total = items.reduce((n, i) => n + (i.pages ?? 0), 0);
  const suggested = items.length ? t('{name} + {n} more', { name: items[0].name, n: items.length - 1 }) : t('Merged document');
  const shownName = name || (items.length > 1 ? suggested : t('Merged document'));

  const add = (d: DocMeta) => setItems((cur) => [...cur, { key: d.id, name: d.name, pages: d.pages, doc: d }]);
  const move = (i: number, by: number) => setItems((cur) => {
    const next = [...cur];
    const j = i + by;
    if (j < 0 || j >= next.length) return cur;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const addFiles = (files: FileList | null) => {
    for (const file of [...(files ?? [])]) {
      const key = `f${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      setItems((cur) => [...cur, { key, name: file.name.replace(/\.pdf$/i, ''), blob: file }]);
      void pageCount(file).then((pages) => setItems((cur) => cur.map((x) => (x.key === key ? { ...x, pages } : x)))).catch(() => undefined);
    }
  };

  const run = async () => {
    setError(null);
    setBusy({ label: t('Reading your documents…') });
    try {
      const sources = [];
      for (const i of items) sources.push({ blob: i.blob ?? (await fileOf(i.doc!)), name: i.name });
      const { bytes, counts } = await mergePdfs(sources, (done, all) => setBusy({ label: t('Joining {done} of {all}…', { done, all }), fraction: done / all }));
      const folders = new Set(items.map((i) => (i.doc ? ctx.folderOf(i.doc) : null)));
      const folder = folders.size === 1 ? [...folders][0] : null;
      // Where each page of each library document lands, in case the notes are brought along.
      let offset = 0;
      const from: OutputSpec['sources'] = [];
      for (const [i, it] of items.entries()) {
        if (it.doc) from.push({ docId: it.doc.id, moves: Array.from({ length: counts[i] }, (_, p) => ({ from: p, to: offset + p })) });
        offset += counts[i];
      }
      ctx.finish({
        title: t('Merged {n} documents into one', { n: items.length }),
        outputs: [{ name: shownName, bytes, pages: offset, folder, sources: from }],
      });
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  return (
    <Shell
      title={t('Merge PDFs')}
      subtitle={t('Documents are joined in the order below')}
      color="terra"
      onClose={onClose}
      footer={
        <button className="button" disabled={items.length < 2 || !!busy} onClick={() => void run()}>
          {items.length < 2 ? t('Choose at least two documents') : total ? t('Merge {n} documents · {pages}', { n: items.length, pages: plural(total, 'page', 'pages') }) : t('Merge {n} documents', { n: items.length })}
        </button>
      }
    >
      {busy && <Busy {...busy} />}
      {error && <Notice>{error}</Notice>}

      <button className="chip-button pick-device pick-top" onClick={() => input.current?.click()}>
        <UploadIcon /> {t('Add files from this device')}
      </button>
      <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />

      <section className="tool-section">
        <h3 className="tool-label">{t('Order')}</h3>
        {items.length === 0 ? (
          <p className="empty-note">{ctx.guest ? t('Add PDFs from your device below. They are joined top to bottom.') : t('Tap documents below to add them. They are joined top to bottom.')}</p>
        ) : (
          <ol className="merge-order">
            {items.map((it, i) => (
              <li key={it.key} className="merge-item">
                <span className="merge-num">{i + 1}</span>
                <span className="docrow-cover">{it.doc ? <Cover meta={it.doc} /> : <span className="cover-fallback"><UploadIcon /></span>}</span>
                <span className="docrow-text">
                  <span className="docrow-name">{it.name}</span>
                  <span className="docrow-meta">{it.pages ? plural(it.pages, 'page', 'pages') : t('from this device')}</span>
                </span>
                <button className="icon-button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('Move {name} up in the order', { name: it.name })}><span className="flip"><ArrowIcon /></span></button>
                <button className="icon-button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={t('Move {name} down in the order', { name: it.name })}><span className="down"><ArrowIcon /></span></button>
                <button className="icon-button" onClick={() => setItems((cur) => cur.filter((x) => x.key !== it.key))} aria-label={t('Take {name} out of the list', { name: it.name })}><CloseIcon /></button>
              </li>
            ))}
          </ol>
        )}
        {items.length > 1 && (
          <label className="tool-field">
            <span>{t('Name of the new document')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} maxLength={120} />
          </label>
        )}
      </section>

      <section className="tool-section">
        <h3 className="tool-label">{t('From your library')}</h3>
        {!ctx.guest && <DocList docs={available} onPick={add} empty={ctx.docs.length ? t('Everything is already in the list.') : t('Add a PDF to your library first.')} badge={() => <span className="docrow-plus"><PlusIcon /></span>} />}
      </section>
    </Shell>
  );
}

// ---- split ---------------------------------------------------------------------
type SplitMode = 'ranges' | 'every' | 'extract';

function SplitTool({ ctx, onClose }: { ctx: ToolContext; onClose: () => void }) {
  const [doc, setDoc] = useState<ToolDoc | null>(ctx.start?.[0] ?? null);
  if (!doc) return <PickOne ctx={ctx} tool="split" onPick={setDoc} onClose={onClose} />;
  return <SplitOptions ctx={ctx} doc={doc} onBack={() => setDoc(null)} onClose={onClose} />;
}

function SplitOptions({ ctx, doc, onBack, onClose }: { ctx: ToolContext; doc: ToolDoc; onBack: () => void; onClose: () => void }) {
  const { pdf, error: loadError } = usePdf(doc);
  const [mode, setMode] = useState<SplitMode>('ranges');
  const [text, setText] = useState('');
  const [every, setEvery] = useState(1);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<{ label: string; fraction?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pages = doc.pages;

  // What the current settings would make.
  const plan = useMemo(() => {
    try {
      if (mode === 'ranges') {
        if (!text.trim()) return { groups: [] as number[][], problem: null as string | null };
        return { groups: parseRanges(text, pages), problem: null };
      }
      if (mode === 'every') {
        const n = Math.max(1, Math.min(pages, Math.floor(every) || 1));
        const groups: number[][] = [];
        for (let s = 0; s < pages; s += n) groups.push(Array.from({ length: Math.min(n, pages - s) }, (_, k) => s + k));
        return { groups, problem: null };
      }
      return { groups: picked.size ? [[...picked].sort((a, b) => a - b)] : [], problem: null };
    } catch (err) {
      return { groups: [], problem: errorText(err) };
    }
  }, [mode, text, every, picked, pages]);

  const label = (g: number[]) =>
    mode === 'extract' ? t('{name} (selected pages)', { name: doc.name })
      : g.length === 1 ? t('{name} (page {n})', { name: doc.name, n: g[0] + 1 })
      : t('{name} (pages {a}-{b})', { name: doc.name, a: g[0] + 1, b: g[g.length - 1] + 1 });

  const run = async () => {
    setError(null);
    setBusy({ label: t('Reading the document…') });
    try {
      const blob = await fileOf(doc);
      const parts = await splitPdf(blob, plan.groups, (done, all) => setBusy({ label: t('Cutting {done} of {all}…', { done, all }), fraction: done / all }));
      const several = parts.length > 1;
      ctx.finish({
        title: several ? t('Split into {n} PDFs', { n: parts.length }) : t('Pulled out {pages}', { pages: plural(plan.groups[0].length, 'page', 'pages') }),
        outputs: parts.map((bytes, i) => ({
          name: label(plan.groups[i]),
          bytes,
          pages: plan.groups[i].length,
          folder: several ? null : ctx.folderOf(doc),
          newFolder: several ? t('{name} (split)', { name: doc.name }) : undefined,
          sources: doc.temp ? [] : [{ docId: doc.id, moves: plan.groups[i].map((from, to) => ({ from, to })) }],
        })),
      });
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  const files = plan.groups.length;
  const cta = !files ? (mode === 'extract' ? t('Tap the pages to pull out') : t('Set how to split')) : mode === 'extract' ? t('Extract {pages}', { pages: plural(picked.size, 'page', 'pages') }) : t('Split into {files}', { files: plural(files, 'file', 'files') });

  return (
    <Shell title={t('Split')} subtitle={`${doc.name} · ${plural(pages, 'page', 'pages')}`} color="mustard" onBack={onBack} onClose={onClose}
      footer={<button className="button" disabled={!files || !!busy} onClick={() => void run()}>{cta}</button>}>
      {busy && <Busy {...busy} />}
      {(error || loadError) && <Notice>{error ?? loadError}</Notice>}

      <div className="segmented" role="tablist" aria-label={t('How to split')}>
        {([['ranges', t('Page ranges')], ['every', t('Every N pages')], ['extract', t('Pick pages')]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? 'on' : ''} onClick={() => setMode(id)}>{label}</button>
        ))}
      </div>

      {mode === 'ranges' && (
        <section className="tool-section">
          <label className="tool-field">
            <span>{t('Pages for each new document, separated by commas')}</span>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="1-3, 5, 8-10" inputMode="text" autoComplete="off" spellCheck={false} />
          </label>
          {plan.problem ? <Notice>{plan.problem}</Notice> : files > 0 && <p className="tool-hint">{t('{docs} will be made: {list}', { docs: plural(files, 'document', 'documents'), list: plan.groups.map((g) => (g.length === 1 ? t('p. {n}', { n: g[0] + 1 }) : t('pp. {a}–{b}', { a: g[0] + 1, b: g[g.length - 1] + 1 }))).join(' · ') })}</p>}
        </section>
      )}

      {mode === 'every' && (
        <section className="tool-section">
          <div className="stepper">
            <button className="icon-button" onClick={() => setEvery((n) => Math.max(1, n - 1))} aria-label={t('Fewer pages')}>−</button>
            <label>
              <span className="sr-only">{t('Pages in each document')}</span>
              <input type="number" min={1} max={pages} value={every} onChange={(e) => setEvery(Number(e.target.value))} />
            </label>
            <span className="stepper-unit">{every === 1 ? t('page in each') : t('pages in each')}</span>
            <button className="icon-button" onClick={() => setEvery((n) => Math.min(pages, n + 1))} aria-label={t('More pages')}>+</button>
          </div>
          <p className="tool-hint">{files > 0 && t('{docs} will be made.', { docs: plural(files, 'document', 'documents') })}</p>
        </section>
      )}

      {mode === 'extract' ? (
        <section className="tool-section">
          <div className="tool-bar">
            <span className="tool-hint">{t('{pages} selected', { pages: plural(picked.size, 'page', 'pages') })}</span>
            <span className="tool-bar-actions">
              <button className="link" onClick={() => setPicked(new Set(Array.from({ length: pages }, (_, i) => i)))}>{t('All')}</button>
              <button className="link" onClick={() => setPicked(new Set())}>{t('None')}</button>
            </span>
          </div>
          <ul className="page-grid">
            {Array.from({ length: pages }, (_, i) => (
              <li key={i}>
                <button className={`page-tile${picked.has(i) ? ' on' : ''}`} aria-pressed={picked.has(i)} aria-label={t('Page {n}', { n: i + 1 })}
                  onClick={() => setPicked((cur) => { const next = new Set(cur); if (!next.delete(i)) next.add(i); return next; })}>
                  <span className="page-tile-img"><PageThumb pdf={pdf} page={i} /></span>
                  <span className="page-tile-num">{i + 1}</span>
                  {picked.has(i) && <span className="page-tile-check"><CheckIcon /></span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="tool-section">
          <p className="tool-hint">{files > 0 ? t('Each colour is one new document.') : t('Every page of the document, so you can see where to cut.')}</p>
          <ul className="page-grid split-preview" aria-label={t('Pages and the documents they go into')}>
            {Array.from({ length: pages }, (_, i) => {
              const owners = plan.groups.flatMap((g, n) => (g.includes(i) ? [n] : []));
              const first = owners[0];
              const startsNew = first !== undefined && plan.groups[first][0] === i && i > 0;
              return (
                <li key={i} className={`split-cell${first === undefined ? (files ? ' unused' : '') : ` g${first % 6} used`}${startsNew ? ' starts' : ''}`}>
                  <span className="page-tile">
                    <span className="page-tile-img"><PageThumb pdf={pdf} page={i} /></span>
                    <span className="page-tile-num">{i + 1}</span>
                    {first !== undefined && <span className="split-badge" aria-label={owners.length === 1 ? t('Goes into document {list}', { list: owners[0] + 1 }) : t('Goes into documents {list}', { list: owners.map((n) => n + 1).join(', ') })}>{owners.map((n) => n + 1).join('·')}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Shell>
  );
}

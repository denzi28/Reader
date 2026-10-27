import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { isPicture, pictureForNote } from '../lib/noteImages';
import { filterSlash, SlashCommands, slashItems, type SlashState } from '../lib/noteSlash';
import { getMeta, patchMeta } from '../lib/storage';
import { onRemotePdf } from '../lib/sync/engine';
import { readNote, refreshNoteThumb, saveNote, wordCount } from '../lib/typedNote';
import type { DocMeta } from '../lib/types';
import { BackIcon, ImageIcon, MoonIcon, SunIcon } from './icons';
import { LinkCard } from './LinkCard';
import { LinkStack, loadCorner, type Corner } from './LinkStack';

/** The width of a picture is kept in the Markdown as the picture's title, so the note stays plain, portable text. */
const WIDTH = /^leafpage:w=(\d+)$/;
const NoteImage = Image.extend({
  parseMarkdown: (token, helpers) => {
    const m = WIDTH.exec(token.title ?? '');
    return helpers.createNode('image', { src: token.href, alt: token.text, title: m ? null : token.title, width: m ? Number(m[1]) : null });
  },
  renderMarkdown: (node) => {
    const { src = '', alt = '', title, width } = (node.attrs ?? {}) as { src?: string; alt?: string; title?: string; width?: number };
    const tag = width ? `leafpage:w=${Math.round(width)}` : title;
    return tag ? `![${alt ?? ''}](${src} "${tag}")` : `![${alt ?? ''}](${src})`;
  },
});

const SAVE_AFTER = 700;
const THUMB_EVERY = 20_000;

function Tool({ on, label, onClick, children, disabled }: { on?: boolean; label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    // mousedown is held back so the text keeps its selection while a button is pressed
    <button className={`nt-tool${on ? ' on' : ''}`} aria-label={label} title={label} aria-pressed={on} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

function Toolbar({ editor, onPicture, phone }: { editor: Editor; onPicture: () => void; phone: boolean }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), strike: e.isActive('strike'),
      h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }),
      bullets: e.isActive('bulletList'), numbers: e.isActive('orderedList'), todo: e.isActive('taskList'), quote: e.isActive('blockquote'),
      undo: e.can().undo(), redo: e.can().redo(),
    }),
  });
  const heading = s.h1 ? 1 : s.h2 ? 2 : s.h3 ? 3 : 0;
  return (
    <div className={`nt-bar${phone ? ' phone' : ''}`} role="region" aria-label={t('Formatting')}>
     <div className="nt-tools" role="toolbar" aria-label={t('Formatting')}>
      <Tool on={s.bold} label={t('Bold')} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></Tool>
      <Tool on={s.italic} label={t('Italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i className="serif">I</i></Tool>
      {!phone && <Tool on={s.strike} label={t('Strikethrough')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></Tool>}
      <span className="nt-sep" />
      <Tool on={heading > 0} label={t('Heading')} onClick={() => { const next = heading === 0 ? 1 : heading === 1 ? 2 : heading === 2 ? 3 : 0; if (next) editor.chain().focus().setHeading({ level: next as 1 | 2 | 3 }).run(); else editor.chain().focus().setParagraph().run(); }}>
        <span className="nt-h">H{heading || ''}</span>
      </Tool>
      <Tool on={s.bullets} label={t('Bulleted list')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</Tool>
      <Tool on={s.numbers} label={t('Numbered list')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</Tool>
      <Tool on={s.todo} label={t('To-do list')} onClick={() => editor.chain().focus().toggleTaskList().run()}>☑</Tool>
      <Tool on={s.quote} label={t('Quote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</Tool>
      <Tool label={t('Picture')} onClick={onPicture}><ImageIcon /></Tool>
      <span className="nt-sep" />
      <Tool label={t('Undo')} disabled={!s.undo} onClick={() => editor.chain().focus().undo().run()}>↶</Tool>
      <Tool label={t('Redo')} disabled={!s.redo} onClick={() => editor.chain().focus().redo().run()}>↷</Tool>
     </div>
    </div>
  );
}

/** A typed note: write with the keyboard (headings, lists, to-dos, pictures); it is saved as Markdown as you go. */
export function NoteEditor({ docId, dark, onTheme, onClose, onOpen, phone }: { docId: string; dark: boolean; onTheme: () => void; onClose: () => void; onOpen: (id: string, page?: number) => void; phone: boolean }) {
  const [meta, setMeta] = useState<DocMeta | null | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<'saved' | 'saving'>('saved');
  const [words, setWords] = useState(0);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [target, setTarget] = useState<DocMeta | null>(null);
  const [cardCorner, setCardCorner] = useState<Corner>(loadCorner);
  const [cardHidden, setCardHidden] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const timer = useRef<number>(0);
  const lastThumb = useRef(0);
  const editorRef = useRef<Editor | null>(null);

  const pickPicture = useCallback(() => fileInput.current?.click(), []);
  const host = useMemo(() => ({ items: () => slashItems(pickPicture), onState: setSlash }), [pickPicture]);

  const save = useCallback(async (thumb = false) => {
    const e = editorRef.current;
    if (!e || (!dirty.current && !thumb)) return;
    const wasDirty = dirty.current;
    dirty.current = false;
    try {
      if (wasDirty) await saveNote(docId, e.getMarkdown(), { thumb: thumb || Date.now() - lastThumb.current > THUMB_EVERY });
      else await saveNote(docId, e.getMarkdown(), { thumb: true });
      if (thumb || Date.now() - lastThumb.current > THUMB_EVERY) lastThumb.current = Date.now();
      setStatus('saved');
    } catch {
      dirty.current = true;
      setProblem(t('The note could not be saved on this device.'));
    }
  }, [docId]);

  const addPictures = useCallback(async (files: File[], at?: number) => {
    const e = editorRef.current;
    if (!e) return;
    for (const file of files.filter(isPicture)) {
      try {
        const pic = await pictureForNote(file);
        const width = Math.min(pic.width, 640);
        const content = { type: 'image', attrs: { src: pic.src, alt: file.name.replace(/\.[^.]+$/, ''), width } };
        // A picture stays selected once it is in; the next one goes after it, not over it.
        const sel = e.state.selection as { node?: unknown; to: number };
        const pos = at ?? (sel.node ? sel.to : undefined);
        if (pos !== undefined) e.chain().focus().insertContentAt(pos, content).run();
        else e.chain().focus().insertContent(content).run();
      } catch {
        setProblem(t('That picture could not be added.'));
      }
    }
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false, heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      NoteImage.configure({ allowBase64: true, resize: { enabled: true, directions: ['bottom-right', 'bottom-left'], minWidth: 80, alwaysPreserveAspectRatio: true } }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? t('Heading') : t("Type '/' for blocks, or just start writing")) }),
      Markdown,
      SlashCommands.configure({ host }),
    ],
    content: '',
    editorProps: {
      attributes: { class: 'nt-prose', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('Note text') },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter(isPicture);
        if (!files.length) return false;
        void addPictures(files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter(isPicture);
        if (!files.length) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void addPictures(files, at);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      dirty.current = true;
      setStatus('saving');
      setWords(wordCount(e.getText()));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), SAVE_AFTER);
    },
  });
  editorRef.current = editor;

  // Open: the words come from the library.
  useEffect(() => {
    let on = true;
    void (async () => {
      const m = (await getMeta(docId)) ?? null;
      const text = (await readNote(docId)) ?? '';
      if (!on) return;
      setMeta(m);
      setTitle(m?.name ?? '');
      if (m?.attached) setTarget((await getMeta(m.attached.doc)) ?? null);
      setWords(m?.words ?? 0);
      editorRef.current?.commands.setContent(text, { contentType: 'markdown', emitUpdate: false });
    })();
    return () => { on = false; };
  }, [docId, editor]);

  // Another device changed the note: it is shown here unless there is typing here not yet saved.
  useEffect(() => onRemotePdf(docId, () => {
    if (dirty.current) return;
    void readNote(docId).then((text) => editorRef.current?.commands.setContent(text ?? '', { contentType: 'markdown', emitUpdate: false }));
  }), [docId]);

  // Whatever leaves the page, the words are kept.
  useEffect(() => {
    const flush = () => { window.clearTimeout(timer.current); void save(); };
    const hide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hide);
      window.clearTimeout(timer.current);
      void save(true);
    };
  }, [save]);

  // The name of the note.
  const renameTimer = useRef<number>(0);
  const rename = (v: string) => {
    setTitle(v);
    window.clearTimeout(renameTimer.current);
    renameTimer.current = window.setTimeout(() => { void patchMeta(docId, { name: v.trim() || t('Untitled note') }).then(() => refreshNoteThumb(docId)); }, 500);
  };
  useEffect(() => () => window.clearTimeout(renameTimer.current), []);

  // On a phone the bar rides above the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => document.documentElement.style.setProperty('--nt-kb', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); document.documentElement.style.removeProperty('--nt-kb'); };
  }, []);

  const close = async () => {
    window.clearTimeout(timer.current);
    await save(true);
    onClose();
  };

  if (meta === null) {
    return (
      <div className="nt" role="alert"><p className="nt-gone">{t('This note is not on this device.')}</p><button className="chip-button" onClick={onClose}>{t('Back')}</button></div>
    );
  }
  return (
    <div className={`nt${phone ? ' phone' : ''}`}>
      <header className="nt-top">
        <button className="icon-button" onClick={() => void close()} aria-label={t('Back to library')} title={t('Back')}><BackIcon /></button>
        <input className="nt-title" value={title} onChange={(e) => rename(e.target.value)} placeholder={t('Untitled note')} maxLength={120} aria-label={t('Name of the note')}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor?.commands.focus('start'); } }} />
        <span className="nt-status" role="status">{status === 'saving' ? t('Saving…') : words ? t('{n} words · saved', { n: words }) : t('Saved')}</span>
        <button className="icon-button" onClick={onTheme} aria-label={dark ? t('Switch to day paper') : t('Switch to night paper')}>{dark ? <SunIcon /> : <MoonIcon />}</button>
      </header>
      {meta?.attached && (
        <button className="nt-for" onClick={() => onOpen(meta.attached!.doc, meta.attached!.page)} title={t('Go to that page')}>
          {t('Dedicated to {name} · page {n}', { name: target?.name ?? meta.attached.name, n: meta.attached.page + 1 })}
        </button>
      )}
      {editor && !phone && <Toolbar editor={editor} onPicture={pickPicture} phone={false} />}
      <main className="nt-scroll" onClick={(e) => { if (e.target === e.currentTarget) editor?.commands.focus('end'); }}>
        <div className="nt-page">
          <EditorContent editor={editor} />
        </div>
      </main>
      {editor && phone && <Toolbar editor={editor} onPicture={pickPicture} phone />}
      {meta?.attached && target && !cardHidden && (
        <LinkStack corner={cardCorner} onCorner={setCardCorner} label={t('The page this note is for')}>
          <LinkCard doc={target} page={meta.attached.page} label={target.name} sub={t('page {n}', { n: meta.attached.page + 1 })}
            onOpen={() => onOpen(target.id, meta.attached!.page)} onHide={() => setCardHidden(true)} />
        </LinkStack>
      )}
      {slash && slash.items.length > 0 && <SlashMenu state={slash} />}
      {problem && <p className="nt-problem" role="alert" onClick={() => setProblem(null)}>{problem}</p>}
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { void addPictures([...(e.target.files ?? [])]); e.target.value = ''; }} />
    </div>
  );
}

function SlashMenu({ state }: { state: SlashState }) {
  const { rect, items, index, command } = state;
  const width = 270;
  const left = rect ? Math.min(Math.max(8, rect.left), window.innerWidth - width - 8) : 16;
  const below = rect ? window.innerHeight - rect.bottom : 300;
  const top = rect ? (below > 280 ? rect.bottom + 6 : Math.max(8, rect.top - 6 - Math.min(items.length * 46 + 12, 300))) : 80;
  return (
    <div className="nt-slash" role="listbox" aria-label={t('Blocks')} style={{ left, top, width }} onMouseDown={(e) => e.preventDefault()}>
      {items.map((it, i) => (
        <button key={it.id} role="option" aria-selected={i === index} className={i === index ? 'on' : ''} onClick={() => command(it)}>
          <i>{it.icon}</i>
          <span>{it.title}</span>
          <small>{it.hint}</small>
        </button>
      ))}
    </div>
  );
}

export { filterSlash };

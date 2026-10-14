import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { t } from './i18n';
// (these bring in the editor commands the menu uses)
import type {} from '@tiptap/starter-kit';
import type {} from '@tiptap/extension-task-list';

export interface SlashItem {
  id: string;
  title: string;
  hint: string;
  icon: string;
  /** Words that find it: typing /head finds the headings, in either language. */
  keys: string[];
  run: (editor: Editor, range: Range) => void;
}

const chain = (e: Editor, r: Range) => e.chain().focus().deleteRange(r);

export function slashItems(pickImage: () => void): SlashItem[] {
  return [
    { id: 'text', title: t('Text'), hint: t('Plain paragraph'), icon: 'T', keys: ['text', 'paragraph', 'p', 'yazi', 'yazı', 'metin'], run: (e, r) => chain(e, r).setParagraph().run() },
    { id: 'h1', title: t('Heading 1'), hint: '#', icon: 'H1', keys: ['head', 'heading', 'h1', 'title', 'baslik', 'başlık', 'buyuk', 'büyük'], run: (e, r) => chain(e, r).setHeading({ level: 1 }).run() },
    { id: 'h2', title: t('Heading 2'), hint: '##', icon: 'H2', keys: ['head', 'heading', 'h2', 'subheading', 'baslik', 'başlık', 'orta'], run: (e, r) => chain(e, r).setHeading({ level: 2 }).run() },
    { id: 'h3', title: t('Heading 3'), hint: '###', icon: 'H3', keys: ['head', 'heading', 'h3', 'baslik', 'başlık', 'kucuk', 'küçük'], run: (e, r) => chain(e, r).setHeading({ level: 3 }).run() },
    { id: 'bullets', title: t('Bulleted list'), hint: '-', icon: '•', keys: ['bullet', 'list', 'ul', 'liste', 'madde'], run: (e, r) => chain(e, r).toggleBulletList().run() },
    { id: 'numbers', title: t('Numbered list'), hint: '1.', icon: '1.', keys: ['number', 'numbered', 'list', 'ol', 'liste', 'numara', 'sayi', 'sayı'], run: (e, r) => chain(e, r).toggleOrderedList().run() },
    { id: 'todo', title: t('To-do list'), hint: '[]', icon: '☑', keys: ['todo', 'to-do', 'task', 'check', 'checkbox', 'yapilacak', 'yapılacak', 'gorev', 'görev', 'kutu'], run: (e, r) => chain(e, r).toggleTaskList().run() },
    { id: 'quote', title: t('Quote'), hint: '>', icon: '❝', keys: ['quote', 'blockquote', 'alinti', 'alıntı'], run: (e, r) => chain(e, r).toggleBlockquote().run() },
    { id: 'code', title: t('Code'), hint: '```', icon: '</>', keys: ['code', 'kod', 'snippet'], run: (e, r) => chain(e, r).toggleCodeBlock().run() },
    { id: 'divider', title: t('Divider'), hint: '---', icon: '―', keys: ['divider', 'line', 'rule', 'hr', 'ayrac', 'ayraç', 'cizgi', 'çizgi'], run: (e, r) => chain(e, r).setHorizontalRule().run() },
    { id: 'image', title: t('Picture'), hint: t('From your device'), icon: '▣', keys: ['image', 'picture', 'photo', 'img', 'resim', 'gorsel', 'görsel', 'foto', 'fotograf', 'fotoğraf'], run: (e, r) => { chain(e, r).run(); pickImage(); } },
  ];
}

export const filterSlash = (items: SlashItem[], query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.title.toLowerCase().includes(q) || i.keys.some((k) => k.startsWith(q) || (q.length > 2 && k.includes(q))));
};

/** What the page needs to draw the menu. */
export interface SlashState {
  items: SlashItem[];
  index: number;
  rect: DOMRect | null;
  command: (item: SlashItem) => void;
}

export interface SlashHost {
  items: () => SlashItem[];
  onState: (state: SlashState | null) => void;
}

/** Typing "/" in a line opens a menu of blocks that narrows as more is typed (/head, /list, /pic…). */
export const SlashCommands = Extension.create<{ host: SlashHost | null }>({
  name: 'slashCommands',
  addOptions: () => ({ host: null }),
  addProseMirrorPlugins() {
    const host = this.options.host;
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        allowedPrefixes: [' ', '\n'],
        items: ({ query }) => filterSlash(host?.items() ?? [], query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let index = 0;
          let last: SuggestionProps<SlashItem, SlashItem> | null = null;
          const push = (p: SuggestionProps<SlashItem, SlashItem>) => {
            last = p;
            if (index >= p.items.length) index = 0;
            host?.onState({ items: p.items, index, rect: p.clientRect?.() ?? null, command: (item) => p.command(item) });
          };
          return {
            onStart: (p) => { index = 0; push(p); },
            onUpdate: (p) => push(p),
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              if (!last || !last.items.length) return false;
              if (event.key === 'ArrowDown') { index = (index + 1) % last.items.length; push(last); return true; }
              if (event.key === 'ArrowUp') { index = (index - 1 + last.items.length) % last.items.length; push(last); return true; }
              if (event.key === 'Enter' || event.key === 'Tab') { last.command(last.items[index]); return true; }
              return false;
            },
            onExit: () => host?.onState(null),
          };
        },
      }),
    ];
  },
});

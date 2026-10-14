export type InkTool = 'pen' | 'highlighter';
/** What the reader's hand does: read, draw, erase, select (lasso) or type a note. */
export type Tool = 'hand' | InkTool | 'eraser' | 'select' | 'text';

/** x and y are normalised by the page's width, so ink survives any zoom level. */
export type InkPoint = [x: number, y: number, pressure: number];

export interface Stroke {
  id: string;
  /** Drawn ink, or a typed note ('text'). */
  tool: InkTool | 'text';
  color: string;
  /** Brush width as a fraction of the page width (for a typed note, its letter size). */
  size: number;
  /** A typed note has one point: its top-left corner. */
  points: InkPoint[];
  /** Typed notes: the words, and the width of the box they wrap in (fraction of page width). */
  text?: string;
  w?: number;
}

/** Zero-based page index -> strokes on that page. */
export type DocInk = Record<number, Stroke[]>;

export interface DocMeta {
  id: string;
  name: string;
  size: number;
  pages: number;
  addedAt: number;
  openedAt: number;
  /** Zero-based index of the page the reader was last looking at. */
  lastPage: number;
  thumb?: Blob;
  /** When a synced field last changed; the newer copy wins between devices. */
  updatedAt?: number;
  /** Removed by the user. Kept as a marker so sync deletes it everywhere. */
  deleted?: boolean;
  /** Known from Drive, but the PDF itself isn't on this device yet. */
  cloudOnly?: boolean;
  /** The folder it is filed in; none (or a removed folder) means the shelf. */
  folder?: string;
  /** Starred by the user, to keep it at the top of the shelf. */
  starred?: boolean;
  /** Kept on this device only: never sent to Google Drive. */
  localOnly?: boolean;
  /** Made here as an empty notebook to write on; it opens with the pen in hand. */
  notebook?: boolean;
  /** A note made for one page of a document: it shows beside that page, and that page shows beside it. */
  attached?: { doc: string; page: number; name: string };
  /** 'epub' when the file is an ePub book, 'note' for a typed note (Markdown text); a PDF otherwise. */
  kind?: 'epub' | 'note';
  /** A typed note: its words, and its first lines, for the card on the shelf. */
  words?: number;
  preview?: string;
  /** Who wrote it (books). */
  author?: string;
  /** Where the reader was in book mode: block number (over the whole book) and a character in it. */
  bookPos?: { b: number; o: number };
  /** Last read in book mode, so it opens that way again. */
  view?: 'book';
}

/** A highlight (with an optional note) or a bookmark in book mode. */
export interface BookMark {
  k: 'hl' | 'bm';
  /** Start: block number and character. */
  a: [block: number, offset: number];
  /** End of a highlight. */
  z?: [block: number, offset: number];
  /** Highlight colour name. */
  c?: string;
  /** The reader's note on it. */
  n?: string;
  /** The words highlighted (or the line a bookmark sits on), to find the place again. */
  q?: string;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  /** One of FOLDER_COLORS. */
  color?: string;
  /** When it was created, renamed, recoloured or removed; the newer copy wins. */
  updatedAt: number;
  /** Removed by the user; kept as a marker so sync removes it everywhere. */
  deleted?: 1;
}

/** Every folder by id, removed ones included, so devices can merge. */
export type FolderLog = Record<string, Folder>;

/**
 * The latest state of one stroke. A document's ink is a log of these, keyed by
 * stroke id, so two devices merge by keeping the newer entry for each stroke.
 */
export interface InkEntry {
  /** Page index. */
  p: number;
  /** When the stroke was first drawn, for drawing order. */
  c: number;
  /** When this entry last changed. */
  t: number;
  /** 1 when the stroke was erased (its points are then dropped). */
  d?: 1;
  s?: Stroke;
  /** A book-mode highlight or bookmark kept in the same log, so it syncs the same way. */
  m?: BookMark;
}

export type InkLog = Record<string, InkEntry>;

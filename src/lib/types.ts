export type InkTool = 'pen' | 'highlighter';
export type Tool = 'hand' | InkTool | 'eraser';

/** x and y are normalised by the page's width, so ink survives any zoom level. */
export type InkPoint = [x: number, y: number, pressure: number];

export interface Stroke {
  id: string;
  tool: InkTool;
  color: string;
  /** Brush width as a fraction of the page width. */
  size: number;
  points: InkPoint[];
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
}

export type InkLog = Record<string, InkEntry>;

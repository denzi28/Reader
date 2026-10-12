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
}

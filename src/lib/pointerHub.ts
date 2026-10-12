/** Shared between the viewer's two-finger gestures and each page's ink layer. */
export interface PointerHub {
  /** Timestamp of the last pen or mouse event, for palm rejection. */
  lastPenAt: number;
  /** True while two fingers are scrolling or zooming; pages must not draw. */
  gesture: boolean;
  /** Throws away the stroke in progress, if there is one. */
  cancelStroke: (() => void) | null;
  /**
   * One screen-sized canvas the stroke in progress is drawn on. Its size never
   * depends on zoom, so drawing stays cheap however far a page is zoomed in.
   */
  overlay: HTMLCanvasElement | null;
}

/** Touches this soon after a pen event are taken to be the writer's palm. */
export const PALM_WINDOW_MS = 600;

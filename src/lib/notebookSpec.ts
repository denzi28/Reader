export type Paper = 'blank' | 'lined' | 'grid' | 'dotted';

/** What a new notebook is like. */
export interface NotebookSpec {
  name: string;
  paper: Paper;
  landscape: boolean;
  pages: number;
}

export const MAX_NOTEBOOK_PAGES = 200;

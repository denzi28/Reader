export type Paper = 'blank' | 'lined' | 'grid' | 'dotted';

/** What a new notebook is like. */
export interface NotebookSpec {
  name: string;
  paper: Paper;
  landscape: boolean;
  pages: number;
}

/** A new note is either a notebook to write on with the pen, or a doc to type. */
export type NoteKind = 'notebook' | 'doc';

export const MAX_NOTEBOOK_PAGES = 200;

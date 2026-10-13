import { patchMeta } from './storage';
import type { NotebookSpec } from './notebookSpec';
import type { DocMeta } from './types';

/** Makes an empty notebook, filed in `folder`, and optionally dedicated to a page of a document. */
export async function createNotebook(
  spec: NotebookSpec,
  options: { folder?: string; attached?: DocMeta['attached'] } = {},
): Promise<DocMeta> {
  const [{ makeNotebook }, { importPdf }] = await Promise.all([import('./blankPdf'), import('./importPdf')]);
  const file = await makeNotebook(spec);
  const made = await importPdf(file, options.folder, { unmetered: Boolean(options.attached) });
  const change: Partial<DocMeta> = { notebook: true };
  if (options.attached) change.attached = options.attached;
  await patchMeta(made.id, change);
  return { ...made, ...change };
}

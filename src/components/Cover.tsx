import type { DocMeta } from '../lib/types';
import { FileIcon } from './icons';

// Each shelf refresh reads the covers afresh from storage; keeping one picture
// address per cover means the browser decodes each cover only once.
const coverUrls = new Map<string, string>();
function coverUrl(meta: DocMeta) {
  const thumb = meta.thumb;
  if (!thumb) return undefined;
  const key = `${meta.id}:${thumb.size}:${thumb.type}`;
  let url = coverUrls.get(key);
  if (!url) {
    url = URL.createObjectURL(thumb);
    coverUrls.set(key, url);
  }
  return url;
}

export function Cover({ meta }: { meta: DocMeta }) {
  const url = coverUrl(meta);
  return url ? (
    <img src={url} alt="" draggable={false} decoding="async" loading="lazy" />
  ) : (
    <span className="cover-fallback"><FileIcon /></span>
  );
}

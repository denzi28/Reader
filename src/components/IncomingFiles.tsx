import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../lib/i18n';
import { dropIncoming, type Incoming, listIncoming, takeIncoming } from '../lib/shareInbox';
import { CloseIcon } from './icons';

interface Props {
  onImport: (files: File[], into: string | null) => Promise<void>;
}

/** Files sent to Leafpage ("Share" on Android, "Open with" on a computer): asks whether to keep them in the library. */
export function IncomingFiles({ onImport }: Props) {
  const [items, setItems] = useState<Incoming[]>([]);
  const [saving, setSaving] = useState(false);

  const look = useCallback(() => { void listIncoming().then(setItems).catch(() => undefined); }, []);
  useEffect(() => {
    look();
    window.addEventListener('leafpage:incoming', look);
    return () => window.removeEventListener('leafpage:incoming', look);
  }, [look]);

  // The address the share arrives on carries no information of its own; tidy it.
  useEffect(() => {
    if (new URLSearchParams(location.search).has('shared')) history.replaceState(history.state, '', location.pathname);
  }, []);

  if (!items.length) return null;
  const save = async () => {
    setSaving(true);
    try {
      await onImport(await takeIncoming(items), null);
    } finally {
      setSaving(false);
      setItems([]);
    }
  };
  const later = () => { void dropIncoming(items); setItems([]); };

  const names = items.slice(0, 3).map((i) => i.name);
  return createPortal(
    <div className="tool-menu" role="dialog" aria-modal="true" aria-label={t('Save to your library?')}>
      <div className="tool-menu-backdrop" onClick={saving ? undefined : later} />
      <div className="tool-menu-sheet newnote">
        <header className="tool-menu-head">
          <div>
            <h2>{items.length === 1 ? t('Save this file to your library?') : t('Save these {n} files to your library?', { n: items.length })}</h2>
            <p>{names.join(' · ')}{items.length > 3 ? ` · ${t('and {n} more', { n: items.length - 3 })}` : ''}</p>
          </div>
          <button className="icon-button" onClick={later} aria-label={t('Close')} disabled={saving}><CloseIcon /></button>
        </header>
        <button className="button newnote-go" onClick={() => void save()} disabled={saving}>{saving ? t('Adding…') : t('Save to my library')}</button>
        <button className="chip-button newnote-go" onClick={later} disabled={saving}>{t('Not now')}</button>
      </div>
    </div>,
    document.body,
  );
}

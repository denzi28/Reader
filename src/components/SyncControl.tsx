import { useEffect, useRef, useState } from 'react';
import { connect, disconnect, syncAll, type SyncStatus } from '../lib/sync/engine';
import { preloadGoogle } from '../lib/sync/google';
import { useSyncStatus } from '../lib/sync/useSync';
import { AlertIcon, CloudIcon, SyncIcon } from './icons';

const LABEL: Record<SyncStatus['state'], string> = {
  off: 'Sync with Google Drive',
  idle: 'Synced',
  syncing: 'Syncing…',
  reauth: 'Reconnect',
  offline: 'Offline',
  error: 'Sync problem',
};

function ago(ts?: number) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
}

function StateIcon({ state }: { state: SyncStatus['state'] }) {
  if (state === 'syncing') return <span className="spin"><SyncIcon /></span>;
  if (state === 'reauth' || state === 'error') return <AlertIcon />;
  return <CloudIcon />;
}

/** The shelf's Google Drive button: connect, show progress, sync now, disconnect. */
export function SyncControl() {
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(preloadGoogle, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  if (!status.available) return null;

  if (!status.connected) {
    return (
      <div className="sync">
        <button
          className="sync-connect"
          onClick={() => {
            setError(null);
            connect().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
          }}
          disabled={status.state === 'syncing'}
        >
          <StateIcon state={status.state} />
          {status.state === 'syncing' ? 'Connecting…' : LABEL.off}
        </button>
        {error && <p className="sync-error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="sync" ref={box}>
      <button
        className={`sync-chip state-${status.state}`}
        onClick={() => (status.state === 'reauth' ? void connect().catch(() => undefined) : setOpen((v) => !v))}
        aria-expanded={open}
        title={status.message ?? (status.lastSyncedAt ? `Last synced ${ago(status.lastSyncedAt)}` : '')}
      >
        <StateIcon state={status.state} />
        {LABEL[status.state]}
      </button>
      {open && (
        <div className="sync-menu" role="menu">
          <p className="sync-account">
            Google Drive{status.email ? <><br /><strong>{status.email}</strong></> : null}
          </p>
          {status.message && <p className="sync-note">{status.message}</p>}
          {status.lastSyncedAt && <p className="sync-note">Last synced {ago(status.lastSyncedAt)}</p>}
          <button role="menuitem" onClick={() => { setOpen(false); void syncAll(); }}>Sync now</button>
          <button
            role="menuitem"
            onClick={() => {
              if (window.confirm('Stop syncing on this device? Your documents stay here and in Drive.')) {
                setOpen(false);
                void disconnect();
              }
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

/** A small status mark for the reader's top bar. */
export function SyncBadge() {
  const status = useSyncStatus();
  if (!status.available || !status.connected) return null;
  const label = status.message ?? LABEL[status.state];
  return (
    <button
      className={`icon-button sync-badge state-${status.state}`}
      aria-label={`Google Drive: ${label}`}
      title={label}
      onClick={() => {
        if (status.state === 'reauth') void connect().catch(() => undefined);
        else void syncAll();
      }}
    >
      <StateIcon state={status.state} />
    </button>
  );
}

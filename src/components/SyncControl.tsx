import { useEffect, useRef, useState } from 'react';
import { connect, disconnect, getStatus, syncAll, type SyncStatus } from '../lib/sync/engine';
import { authMode, preloadGoogle } from '../lib/sync/google';
import { useSyncStatus } from '../lib/sync/useSync';
import { InstallChip } from './PwaBits';
import { PlanCard } from './Paywall';
import { AlertIcon, CloudIcon, MoonIcon, SunIcon, SyncIcon, UserIcon } from './icons';

const LABEL: Record<SyncStatus['state'], string> = {
  off: 'Sign in with Google',
  idle: 'Synced',
  syncing: 'Syncing…',
  reauth: 'Sign in again',
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

/** Google's "G", in its own colours, as its sign-in guidelines ask. */
export function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function GoogleButton({ label = 'Sign in with Google', onError }: { label?: string; onError?: (m: string) => void }) {
  const status = useSyncStatus();
  const [opening, setOpening] = useState(false);
  useEffect(preloadGoogle, []);
  // Coming back with the browser's Back button restores the page as it was.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setOpening(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  return (
    <button
      className={`google-btn${opening ? ' opening' : ''}`}
      disabled={opening || (status.state === 'syncing' && !status.connected)}
      onClick={() => {
        setOpening(true);
        connect()
          .then(() => {
            // Server sign-in leaves the page; the popup kind is done here.
            if (authMode() === 'browser') setOpening(false);
          })
          .catch((err: unknown) => {
            setOpening(false);
            onError?.(err instanceof Error ? err.message : String(err));
          });
      }}
    >
      {opening ? <span className="btn-spinner" aria-hidden="true" /> : <GoogleG />}
      <span>{opening ? 'Opening Google…' : label}</span>
    </button>
  );
}

function Avatar({ status }: { status: SyncStatus }) {
  const [broken, setBroken] = useState(false);
  const initial = (status.name || status.email || '?').trim().charAt(0).toUpperCase();
  if (status.picture && !broken) {
    return (
      <img
        className="avatar"
        src={status.picture}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return <span className="avatar avatar-initial" aria-hidden="true">{initial}</span>;
}

/** The shelf's account button: sign in, then sync progress, sync now, sign out. */
function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/**
 * The account button at the end of the desktop top bar: the picture (or a person while signed out), and a menu
 * with who is signed in, syncing, the paper colour, the plan and the legal links.
 */
export function AccountMenu({ dark, onTheme, docCount }: { dark: boolean; onTheme: () => void; docCount: number }) {
  const status = useSyncStatus();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [open]);

  const signedIn = status.available && status.ready && status.connected;
  const dot = !online ? 'off' : status.state === 'reauth' || status.state === 'error' ? 'warn' : 'on';
  const dotLabel = { on: 'Online', off: 'Offline', warn: 'Needs attention' }[dot];
  const syncNote = status.limited
    ? 'Free plan: sync runs on your other device.'
    : status.message ?? (status.state === 'idle' && status.lastSyncedAt ? `Synced ${ago(status.lastSyncedAt)}` : LABEL[status.state]);

  return (
    <div className="account" ref={box}>
      <button
        className="account-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={signedIn ? `${status.name || status.email || 'Account'}: ${LABEL[status.state]}` : 'Account and settings'}
      >
        {signedIn ? (
          <span className="avatar-wrap">
            <Avatar status={status} />
            <i className={`presence ${dot}`} role="img" aria-label={dotLabel} />
          </span>
        ) : <span className="account-guest"><UserIcon /></span>}
      </button>
      {open && (
        <div className="account-menu" role="menu">
          {signedIn ? (
            <>
              <div className="account-who">
                <strong>{status.name || status.email}</strong>
                {status.name && status.email && <span>{status.email}</span>}
              </div>
              <button
                role="menuitem"
                className="account-row"
                onClick={() => { setOpen(false); if (status.state === 'reauth') void connect().catch(() => undefined); else void syncAll(); }}
              >
                <span className={`account-sync state-${status.state}`}><StateIcon state={status.state} />{syncNote}</span>
                <em>{status.state === 'reauth' ? 'Sign in' : 'Sync now'}</em>
              </button>
            </>
          ) : status.available && status.ready ? (
            <div className="account-signin">
              <p>Keep your documents and notes in your own Google Drive, and open them on any device.</p>
              <GoogleButton onError={setError} />
              {error && <p className="sync-error" role="alert">{error}</p>}
            </div>
          ) : null}
          <button role="menuitem" className="account-row" onClick={onTheme}>
            <span className="account-sync">{dark ? <SunIcon /> : <MoonIcon />}{dark ? 'Day paper' : 'Night paper'}</span>
            <i className={`account-switch${dark ? ' on' : ''}`} aria-hidden="true" />
          </button>
          <InstallChip />
          <PlanCard docCount={docCount} compact />
          <div className="account-foot">
            <a href="/privacy.html">Privacy</a><span aria-hidden="true">·</span><a href="/terms.html">Terms</a>
            {signedIn && (
              <button
                className="link"
                onClick={async () => {
                  setOpen(false);
                  await Promise.race([syncAll(), new Promise((r) => setTimeout(r, 3000))]);
                  const ok = window.confirm(
                    getStatus().state === 'idle'
                      ? 'Sign out on this device? Your documents will be removed from this device. They stay in your Google Drive and come back when you sign in again.'
                      : 'Some changes have not reached your Google Drive yet and will be lost if you sign out now. Sign out anyway?',
                  );
                  if (ok) void disconnect();
                }}
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The account on the Me page: who is signed in, how syncing is going, sync now and sign out (or the sign-in button). */
export function AccountCard() {
  const status = useSyncStatus();
  const [error, setError] = useState<string | null>(null);
  if (!status.available || !status.ready) return null;
  if (!status.connected) {
    return (
      <section className="me-card" aria-label="Account">
        <h2 className="me-title">Keep your devices in step</h2>
        <p className="me-sub">Sign in with Google to keep your documents and notes in your own Drive, and open them on any device.</p>
        <GoogleButton onError={setError} />
        {error && <p className="sync-error" role="alert">{error}</p>}
      </section>
    );
  }
  return (
    <section className="me-card" aria-label="Account">
      <div className="me-account">
        <Avatar status={status} />
        <div className="me-who">
          <strong>{status.name || status.email}</strong>
          {status.name && status.email && <span>{status.email}</span>}
          <span className={`me-state state-${status.state}`}>
            <StateIcon state={status.state} />
            {status.limited ? 'Free plan: sync runs on another device' : status.message ?? (status.state === 'idle' && status.lastSyncedAt ? `Synced ${ago(status.lastSyncedAt)}` : LABEL[status.state])}
          </span>
        </div>
      </div>
      <div className="me-actions">
        <button className="button button-small" onClick={() => (status.state === 'reauth' ? void connect().catch(() => undefined) : void syncAll())}>
          {status.state === 'reauth' ? 'Sign in again' : 'Sync now'}
        </button>
        <button
          className="link"
          onClick={async () => {
            await Promise.race([syncAll(), new Promise((r) => setTimeout(r, 3000))]);
            const ok = window.confirm(
              getStatus().state === 'idle'
                ? 'Sign out on this device? Your documents will be removed from this device. They stay in your Google Drive and come back when you sign in again.'
                : 'Some changes have not reached your Google Drive yet and will be lost if you sign out now. Sign out anyway?',
            );
            if (ok) void disconnect();
          }}
        >
          Sign out
        </button>
      </div>
    </section>
  );
}

/** One row of the reading screen's menu: the sync state, and a tap to sync now. */
export function SyncRow({ onDone }: { onDone: () => void }) {
  const status = useSyncStatus();
  if (!status.available || !status.connected) return null;
  const label = status.message ?? LABEL[status.state];
  return (
    <button
      role="menuitem"
      className="vmenu-item"
      onClick={() => {
        onDone();
        if (status.state === 'reauth') void connect().catch(() => undefined);
        else void syncAll();
      }}
    >
      <StateIcon state={status.state} />
      <span>{label}</span>
      {status.state === 'idle' && status.lastSyncedAt && <small>{ago(status.lastSyncedAt)}</small>}
    </button>
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

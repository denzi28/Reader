import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Library } from './components/Library';
import { Viewer } from './components/Viewer';
import { Welcome } from './components/Welcome';
import { importPdf } from './lib/importPdf';
import { useSyncStatus } from './lib/sync/useSync';

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('reader.theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage unavailable */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const SKIP_KEY = 'reader.welcome.skipped';

const AUTH_ERRORS: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled.',
  drive_scope: 'Google Drive access is needed to sync. Please allow it when signing in.',
};

/** Reads (and removes) what Google's sign-in left in the address bar. */
function takeAuthResult(): string | null {
  const params = new URLSearchParams(location.search);
  const error = params.get('auth_error');
  if (!error && !params.has('signed_in')) return null;
  history.replaceState(history.state, '', location.pathname);
  return error ? AUTH_ERRORS[error] ?? 'Google sign-in did not finish. Please try again.' : null;
}

function readSkipped() {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

/** Crossfades between screens where the browser supports it. */
function transition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (doc.startViewTransition && !reduced) doc.startViewTransition(() => flushSync(update));
  else update();
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [docId, setDocId] = useState<string | null>(() => history.state?.doc ?? null);
  // The folder open on the shelf; kept in the history so Back leaves it.
  const [folder, setFolder] = useState<string | null>(() => history.state?.folder ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(takeAuthResult);
  const [skipped, setSkipped] = useState(readSkipped);
  const sync = useSyncStatus();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#1b1712' : '#efe6d2');
    try { localStorage.setItem('reader.theme', theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    const onPop = () => transition(() => {
      setDocId(history.state?.doc ?? null);
      setFolder(history.state?.folder ?? null);
    });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback((id: string) => {
    history.pushState({ doc: id, folder: history.state?.folder ?? null }, '');
    transition(() => setDocId(id));
  }, []);

  const openFolder = useCallback((id: string | null) => {
    if (id) {
      history.pushState({ folder: id }, '');
      transition(() => setFolder(id));
    } else if (history.state?.folder && !history.state?.doc) {
      history.back();
    } else {
      transition(() => setFolder(null));
    }
  }, []);

  const close = useCallback(() => {
    if (history.state?.doc) history.back();
    else transition(() => setDocId(null));
  }, []);

  /** Adds files to the library (into `into`); one file opens straight away. */
  const importFiles = useCallback(async (files: File[], into: string | null) => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    let last: string | null = null;
    let reason = '';
    for (const file of files) {
      try {
        last = (await importPdf(file, into ?? undefined)).id;
      } catch (err) {
        failed.push(file.name);
        reason = err instanceof Error ? err.message : 'Something went wrong adding that file.';
      }
    }
    setBusy(false);
    if (files.length === 1 && last) open(last);
    else if (failed.length === 1 && files.length === 1) setError(reason);
    else if (failed.length) setError(`${failed.length} of ${files.length} files could not be added (${failed.join(', ')}). ${reason}`);
  }, [open]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const skip = () => {
    try { localStorage.setItem(SKIP_KEY, '1'); } catch { /* ignore */ }
    transition(() => setSkipped(true));
  };

  if (!docId && sync.available && sync.ready && !sync.connected && !skipped) {
    return <Welcome onSkip={skip} dark={theme === 'dark'} onTheme={toggleTheme} />;
  }

  return docId ? (
    <Viewer key={docId} docId={docId} dark={theme === 'dark'} onTheme={toggleTheme} onClose={close} />
  ) : (
    <Library
      dark={theme === 'dark'}
      onTheme={toggleTheme}
      onOpen={open}
      onImport={importFiles}
      folder={folder}
      onFolder={openFolder}
      busy={busy}
      error={error}
      onDismissError={() => setError(null)}
    />
  );
}

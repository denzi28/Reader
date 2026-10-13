import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Library } from './components/Library';
import { GuestTools } from './components/GuestTools';
import type { ToolId } from './components/toolList';
import { Welcome } from './components/Welcome';
import { useSyncStatus } from './lib/sync/useSync';

// The reader and the PDF engine are a large download of their own; the
// shelf and welcome page show without waiting for them (the shelf fetches
// them in the background).
const Viewer = lazy(() => import('./components/Viewer').then((m) => ({ default: m.Viewer })));
const opening = (
  <div className="viewer-loading loading" role="status">
    <span className="loading-page" />
    <span>Opening your document…</span>
  </div>
);

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('reader.theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage unavailable */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

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
  // The tools-only page for someone not signed in; a step in the history, so Back leaves it.
  const [guestTools, setGuestTools] = useState<boolean>(() => !!history.state?.tools);
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
      setGuestTools(!!history.state?.tools);
    });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback((id: string, page?: number) => {
    history.pushState({ doc: id, folder: history.state?.folder ?? null, page }, '');
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
    const { importPdf } = await import('./lib/importPdf');
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

  // A tool picked on the welcome page opens at once, on top of the tools page, so Back peels both off.
  const openGuestTools = (tool?: ToolId) => {
    history.pushState({ tools: 1 }, '');
    if (tool) history.pushState({ tools: 1, tool: 1, toolId: tool }, '');
    transition(() => setGuestTools(true));
  };
  const closeGuestTools = () => {
    if (history.state?.tools) history.back();
    else transition(() => setGuestTools(false));
  };

  // The library is for signed-in people; everyone else gets the welcome page and the tools.
  if (!docId && sync.available && sync.ready && !sync.connected) {
    return guestTools
      ? <GuestTools dark={theme === 'dark'} onTheme={toggleTheme} onBack={closeGuestTools} />
      : <Welcome onTools={openGuestTools} dark={theme === 'dark'} onTheme={toggleTheme} />;
  }

  return docId ? (
    <Suspense fallback={opening}>
      <Viewer
        key={docId}
        docId={docId}
        startPage={history.state?.page}
        dark={theme === 'dark'}
        onTheme={toggleTheme}
        onClose={close}
      />
    </Suspense>
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

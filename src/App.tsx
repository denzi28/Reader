import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Library } from './components/Library';
import { DocScreen, type DocView } from './components/DocScreen';
import { GuestTools } from './components/GuestTools';
import type { ToolId } from './components/toolList';
import { Welcome } from './components/Welcome';
import { PaywallHost } from './components/Paywall';
import { openPaywall, PlanLimit } from './lib/plan';
import { useSyncStatus } from './lib/sync/useSync';

// The readers and the PDF engine are a large download of their own; the
// shelf and welcome page show without waiting for them (the shelf fetches
// them in the background).

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
  // How the open document is being read: as a PDF, as a book, or as it was last time (unset).
  const [view, setView] = useState<DocView | undefined>(() => history.state?.view);
  // The folder open on the shelf; kept in the history so Back leaves it.
  const [folder, setFolder] = useState<string | null>(() => history.state?.folder ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(takeAuthResult);
  // The tools-only page for someone not signed in; a step in the history, so Back leaves it.
  const [guestTools, setGuestTools] = useState<boolean>(() => !!history.state?.tools);
  const sync = useSyncStatus();

  // While a document is open the browser must not zoom the whole site (a pinch that
  // starts on a dialog or the bars); the pages have their own zoom.
  useEffect(() => {
    document.documentElement.classList.toggle('reading', docId !== null);
    return () => document.documentElement.classList.remove('reading');
  }, [docId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#1b1712' : '#efe6d2');
    try { localStorage.setItem('reader.theme', theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    const onPop = () => transition(() => {
      setDocId(history.state?.doc ?? null);
      setView(history.state?.view);
      setFolder(history.state?.folder ?? null);
      setGuestTools(!!history.state?.tools);
    });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback((id: string, page?: number, as?: DocView) => {
    // A page asked for (a note's page, say) is a page of the PDF.
    const how = as ?? (page !== undefined ? 'pdf' : undefined);
    history.pushState({ doc: id, folder: history.state?.folder ?? null, page, view: how }, '');
    transition(() => { setView(how); setDocId(id); });
  }, []);

  /** Switches the open document between the PDF and book mode, in place (Back still leaves the document). */
  const switchView = useCallback((as: DocView) => {
    history.replaceState({ ...history.state, view: as, page: undefined }, '');
    transition(() => setView(as));
  }, []);

  /**
   * Goes from one open document to another (a note and the page it is for) in
   * place: the history entry is replaced, so the back arrow still leads to the
   * shelf however many times the two have been swapped.
   */
  const swap = useCallback((id: string, page?: number) => {
    const how = page !== undefined ? 'pdf' : undefined;
    history.replaceState({ doc: id, folder: history.state?.folder ?? null, page, view: how }, '');
    transition(() => { setView(how); setDocId(id); });
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
    let full = false;
    for (const file of files) {
      try {
        last = (await importPdf(file, into ?? undefined)).id;
      } catch (err) {
        if (err instanceof PlanLimit) { full = true; break; } // the free plan is full: the paywall says so

        failed.push(file.name);
        reason = err instanceof Error ? err.message : 'Something went wrong adding that file.';
      }
    }
    setBusy(false);
    if (full) openPaywall('docs');
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

  return (
    <>
      {docId ? (
    <DocScreen
      key={docId}
      docId={docId}
      startPage={history.state?.page}
      view={view}
      dark={theme === 'dark'}
      onTheme={toggleTheme}
      onClose={close}
      onOpen={swap}
      onView={switchView}
    />
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
      )}
      <PaywallHost />
    </>
  );
}

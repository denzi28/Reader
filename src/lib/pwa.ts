// Making the app installable and usable with no connection: the service worker's
// registration, "a new version is ready", and the browser's install prompt.
import { useEffect, useState } from 'react';
import { addIncoming } from './shareInbox';

type Listener = () => void;

// ---- the service worker ---------------------------------------------------
let waiting: ServiceWorker | null = null;
const updateListeners = new Set<Listener>();

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const watch = (worker: ServiceWorker | null) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          // Installed while another version is running: it waits for the reader's say-so.
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = worker;
            updateListeners.forEach((fn) => fn());
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) {
        waiting = reg.waiting;
        updateListeners.forEach((fn) => fn());
      }
      reg.addEventListener('updatefound', () => watch(reg.installing));
      // Look for a new version now and then while the app stays open.
      setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);
    }).catch(() => undefined);
    // The first ever install takes control quietly; only a switch from one version to the next reloads.
    let reloading = false;
    const hadController = navigator.serviceWorker.controller !== null;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return;
      reloading = true;
      location.reload();
    });
  });
}

/** True while a new version is downloaded and waiting. */
export function useUpdate() {
  const [ready, setReady] = useState(waiting !== null);
  useEffect(() => {
    const fn = () => setReady(true);
    updateListeners.add(fn);
    return () => void updateListeners.delete(fn);
  }, []);
  return { ready, apply: () => waiting?.postMessage('skip-waiting') };
}

// ---- installing ------------------------------------------------------------
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let prompt: InstallPrompt | null = null;
const installListeners = new Set<Listener>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e as InstallPrompt;
    installListeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    prompt = null;
    installListeners.forEach((fn) => fn());
  });
}

const standalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
const onIos = () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);

/** What the app can offer about installing: a one-tap prompt (Chrome, Edge, Android) or, on iPhone, the steps. */
export function useInstall() {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    installListeners.add(fn);
    return () => void installListeners.delete(fn);
  }, []);
  const installed = standalone();
  return {
    canPrompt: !installed && prompt !== null,
    iosSteps: !installed && prompt === null && onIos(),
    async install() {
      const p = prompt;
      if (!p) return;
      await p.prompt();
      await p.userChoice;
      prompt = null;
      installListeners.forEach((fn) => fn());
    },
  };
}

// ---- files opened with Leafpage ---------------------------------------------
interface LaunchParams { files: { getFile: () => Promise<File> }[] }

/** On a computer, a PDF opened "with Leafpage" arrives through the browser's launch queue: it joins the inbox like a shared file. */
export function listenForLaunchFiles() {
  const q = (window as unknown as { launchQueue?: { setConsumer: (fn: (p: LaunchParams) => void) => void } }).launchQueue;
  if (!q) return;
  q.setConsumer((params) => {
    void Promise.all(params.files.map((h) => h.getFile())).then(addIncoming).catch(() => undefined);
  });
}

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useInstall, useUpdate } from '../lib/pwa';
import { CloseIcon, DownloadIcon } from './icons';

const DISMISSED = 'reader.install.dismissed';
const wasDismissed = () => {
  try { return localStorage.getItem(DISMISSED) === '1'; } catch { return false; }
};

/** "A new version is ready": the old one keeps running until the reader says reload. */
export function UpdateToast() {
  const { ready, apply } = useUpdate();
  if (!ready) return null;
  return createPortal(
    <div className="update-toast" role="status">
      <span>A new version is ready.</span>
      <button className="chip-button chip-primary" onClick={apply}>Reload</button>
    </div>,
    document.body,
  );
}

/** Offers to put the app on the home screen: one tap where the browser allows it, the steps on an iPhone. */
export function InstallChip({ card }: { card?: boolean } = {}) {
  const { canPrompt, iosSteps, install } = useInstall();
  const [hidden, setHidden] = useState(wasDismissed);
  const [steps, setSteps] = useState(false);
  if (hidden || (!canPrompt && !iosSteps)) return null;
  const dismiss = () => {
    try { localStorage.setItem(DISMISSED, '1'); } catch { /* ignore */ }
    setHidden(true);
  };
  return (
    <>
      {card ? (
        <div className="install-card">
          <span className="install-card-icon"><DownloadIcon /></span>
          <span className="install-card-text">
            <b>Install The Reader</b>
            <small>Works offline, opens like an app.</small>
          </span>
          <button className="install-go" onClick={() => (canPrompt ? void install() : setSteps(true))}>Install</button>
          <button className="install-x" onClick={dismiss} aria-label="Hide the install suggestion"><CloseIcon /></button>
        </div>
      ) : (
      <span className="install-chip">
        <button onClick={() => (canPrompt ? void install() : setSteps(true))} title="Add The Reader to your home screen; it then works with no connection">
          <DownloadIcon />
          <span>Install app</span>
        </button>
        <button className="install-x" onClick={dismiss} aria-label="Hide the install suggestion"><CloseIcon /></button>
      </span>
      )}
      {steps && createPortal(
        <div className="tool-menu" role="dialog" aria-modal="true" aria-label="Add to Home Screen">
          <div className="tool-menu-backdrop" onClick={() => setSteps(false)} />
          <div className="tool-menu-sheet newnote">
            <header className="tool-menu-head">
              <div>
                <h2>Add to Home Screen</h2>
                <p>It then opens like an app, and works with no connection.</p>
              </div>
              <button className="icon-button" onClick={() => setSteps(false)} aria-label="Close"><CloseIcon /></button>
            </header>
            <ol className="install-steps">
              <li>Tap the <b>Share</b> button in Safari's toolbar.</li>
              <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
              <li>Tap <b>Add</b>.</li>
            </ol>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

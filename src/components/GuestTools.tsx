import { lazy, Suspense, useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import { BackIcon, LeafMark, MoonIcon, SunIcon } from './icons';
import { TOOLS, type ToolId } from './toolList';
import { GoogleButton, LangButton } from './SyncControl';

const PdfTools = lazy(() => import('./PdfTools'));
const noFolder = () => null;
const nothing = () => undefined;

interface Props {
  dark: boolean;
  onTheme: () => void;
  /** Back to the welcome page. */
  onBack: () => void;
}

/**
 * The PDF tools on their own, for someone who has not signed in: pick a file from the
 * device, change it, download it. There is no library here; that is behind sign-in.
 */
export function GuestTools({ dark, onTheme, onBack }: Props) {
  const [tool, setTool] = useState<ToolId | null>(() => (history.state?.tool ? history.state.toolId ?? null : null));
  const [error, setError] = useState<string | null>(null);

  // Opening a tool is a step in the history, so Back closes it before leaving the page.
  useEffect(() => {
    const onPop = () => { if (!history.state?.tool) setTool(null); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const open = (id: ToolId) => {
    history.pushState({ ...history.state, tool: 1, toolId: id }, '');
    setTool(id);
  };
  const close = () => {
    setTool(null);
    if (history.state?.tool) history.back();
  };

  return (
    <div className="guest-tools">
      <header className="guest-bar">
        <button className="guest-back" onClick={onBack} aria-label={t('Back to the welcome page')}>
          <BackIcon />
          <LeafMark /><span>Leafpage</span>
        </button>
        <div className="guest-bar-actions">
          <LangButton />
          <button className="icon-button" onClick={onTheme} aria-label={dark ? t('Switch to day paper') : t('Switch to night paper')}>
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <main className="guest-main">
        <p className="eyebrow">{t('Free PDF tools')}</p>
        <h1>{t('What would you like to do?')}</h1>
        <p className="guest-lead">
          {t('Everything happens on your device. Your files are never uploaded, and you do not need an account.')}
        </p>
        <div className="tool-cards guest-cards">
          {TOOLS.map(({ id, title, blurb, color, Icon }, i) => (
            <button key={id} className={`tool-card c-${color}`} style={{ ['--i' as string]: i }} onClick={() => open(id)}>
              <span className="tool-card-icon"><Icon /></span>
              <span className="tool-card-title">{title}</span>
              <span className="tool-card-blurb">{blurb}</span>
            </button>
          ))}
        </div>

        <section className="guest-signin">
          <div>
            <h2>{t('Want a library of your own?')}</h2>
            <p>{t('Sign in to read and mark up PDFs, keep the ones you make here, and find them on every device.')}</p>
          </div>
          <GoogleButton label={t('Continue with Google')} onError={setError} />
        </section>
        {error && <p className="welcome-error" role="alert">{error}</p>}
      </main>

      {tool && (
        <Suspense fallback={<div className="workspace"><div className="tool-backdrop" /><div className="tool-sheet"><div className="note-loading" /></div></div>}>
          <PdfTools tool={tool} guest signedIn={false} docs={[]} folderOf={noFolder} onClose={close} onChanged={nothing} onOpen={nothing} />
        </Suspense>
      )}
    </div>
  );
}

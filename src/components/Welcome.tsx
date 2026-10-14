import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../lib/i18n';
import { MoonIcon, SunIcon } from './icons';
import { InkArt, PhoneMirror, PrivacyArt, SyncArt } from './landing/Art';
import { delay, PenScene } from './landing/PenScene';
import { ToolChips } from './landing/ToolChips';
import type { ToolId } from './toolList';
import { GoogleButton, LangButton } from './SyncControl';

interface Props {
  /** Opens the tools-only page, straight into one tool when given (the library itself is behind sign-in). */
  onTools: (tool?: ToolId) => void;
  dark: boolean;
  onTheme: () => void;
}

/** Adds `in` to each [data-reveal] element the first time it scrolls into view. */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const els = root.current?.querySelectorAll<HTMLElement>('[data-reveal]') ?? [];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.3, rootMargin: '0px 0px -8% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return root;
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="6" y="4" width="18" height="24" rx="2.5" className="logo-back" transform="rotate(-8 15 16)" />
      <rect x="8" y="4" width="18" height="24" rx="2.5" className="logo-page" />
      <path className="logo-line" d="M12 11h10M12 15h10M12 19h6" />
      <path className="logo-ink" d="M11.5 23.5c2-1.6 3.4 1.6 5.4 0s3.4 1.4 5.2-.2" />
    </svg>
  );
}

function SignIn({ label, onError }: { label: string; onError: (m: string) => void }) {
  return <GoogleButton label={label} onError={onError} />;
}

function Section({ eyebrow, title, children, art, flip }: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  art: ReactNode;
  flip?: boolean;
}) {
  return (
    <section className={`feature${flip ? ' flip' : ''}`} data-reveal>
      <div className="feature-text">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {children}
      </div>
      <div className="feature-art">{art}</div>
    </section>
  );
}

/** The landing page for someone not signed in. */
export function Welcome({ onTools, dark, onTheme }: Props) {
  const [error, setError] = useState<string | null>(null);
  const root = useReveal();

  return (
    <div className="landing" ref={root}>
      <div className="landing-glow" aria-hidden="true" />

      <header className="landing-nav">
        <span className="landing-brand"><Logo /> The Reader</span>
        <ToolChips onTry={onTools} />
        <div className="landing-nav-actions">
          <button className="link nav-link" onClick={() => onTools()}>{t('Try the PDF tools')}</button>
          <LangButton />
          <button
            className="icon-button"
            onClick={onTheme}
            aria-label={dark ? t('Switch to day paper') : t('Switch to night paper')}
          >
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-text">
            <p className="eyebrow reveal" style={delay(0.2)}>{t('A reader that feels like paper')}</p>
            <h1 className="hero-title reveal" style={delay(0.35)}>
              {t('Read it.')}<br />
              <span className="hl">{t('Mark it.')}</span><br />
              {t('Keep it.')}
            </h1>
            <p className="hero-lead reveal" style={delay(0.55)}>
              {t('Draw and highlight right on your PDFs. Your library and every note follow you to your phone, tablet and computer, kept in your own Google Drive.')}
            </p>
            <div className="hero-cta reveal" style={delay(0.75)}>
              <SignIn label={t('Continue with Google')} onError={setError} />
              <button className="link hero-skip" onClick={() => onTools()}>{t('Try the PDF tools, no account')}</button>
            </div>
            {error && <p className="welcome-error" role="alert">{error}</p>}
            <p className="hero-note reveal" style={delay(0.9)}>
              {t('No ads. No servers holding your files. Sign in once and stay signed in.')}
            </p>
          </div>
          <div className="hero-art">
            <PenScene k={2} />
            <PhoneMirror />
          </div>
          <a className="scroll-hint" href="#ink" aria-label={t('See more')}>
            <span />
          </a>
        </section>

        <div id="ink" />
        <Section eyebrow={t('Ink that feels like ink')} title={t('Write on the page, not around it.')} art={<InkArt />}>
          <p>
            {t('A pen that follows your stylus pressure, a highlighter that holds a straight line, an eraser and undo. Two fingers scroll and zoom while you write, and a resting palm leaves no marks.')}
          </p>
        </Section>

        <Section
          eyebrow={t('Everywhere you are')}
          title={t('Pick up where you left off.')}
          art={<SyncArt />}
          flip
        >
          <p>
            {t('Mark a page on your phone and it is there on your laptop: the document, every stroke and the page you were on. Draw on two devices at once and nothing is lost.')}
          </p>
        </Section>

        <Section eyebrow={t('Yours alone')} title={t('Your files stay in your Drive.')} art={<PrivacyArt />}>
          <ul className="checks">
            <li>{t('Everything is kept in a private folder in your own Google Drive.')}</li>
            <li>{t('The Reader can see that folder and nothing else in your Drive.')}</li>
            <li>{t('No servers of ours hold your documents, no one reads them, and there are no ads.')}</li>
          </ul>
        </Section>

        <section className="tiles" data-reveal>
          {[
            [t('Night paper'), t('A warm, lamp-lit dark theme. Your ink changes colour to stay readable.')],
            [t('Big PDFs, smooth'), t('Only the pages on screen are drawn, so long books scroll like short ones.')],
            [t('Remembers your page'), t('Open a document anywhere and land where you stopped reading.')],
            [t('Signed in for good'), t('One tap with Google, then it stays out of your way.')],
          ].map(([title, text], i) => (
            <div className="tile" key={title} style={delay(0.08 * i)}>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </section>

        <section className="final" data-reveal>
          <h2>{t('Your next page is waiting.')}</h2>
          <div className="hero-cta">
            <SignIn label={t('Continue with Google')} onError={setError} />
            <button className="link hero-skip" onClick={() => onTools()}>{t('Try the PDF tools, no account')}</button>
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <span className="landing-brand small"><Logo /> The Reader</span>
        <nav>
          <a href="/privacy.html">{t('Privacy')}</a>
          <a href="/terms.html">{t('Terms')}</a>
        </nav>
        <p>{t('By continuing you agree to the Terms and Privacy Policy.')}</p>
      </footer>
    </div>
  );
}

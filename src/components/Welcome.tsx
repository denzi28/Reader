import { useState } from 'react';
import { GoogleButton } from './SyncControl';

interface Props {
  onSkip: () => void;
}

/** First screen for someone not signed in: sign in with Google, or carry on without. */
export function Welcome({ onSkip }: Props) {
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="welcome">
      <div className="welcome-card">
        <div className="welcome-pages" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1 className="brand">The Reader</h1>
        <p className="welcome-lead">Read, mark up and keep your documents, on every device.</p>
        <ul className="welcome-points">
          <li>Draw and highlight right on the page</li>
          <li>Your library and notes follow you through your own Google Drive</li>
          <li>Sign in once and stay signed in</li>
        </ul>
        <GoogleButton label="Continue with Google" onError={setError} />
        {error && <p className="welcome-error" role="alert">{error}</p>}
        <button className="link welcome-skip" onClick={onSkip}>
          Use without an account
        </button>
        <p className="welcome-legal">
          By continuing you agree to the <a href="/terms.html">Terms</a> and{' '}
          <a href="/privacy.html">Privacy Policy</a>.
        </p>
      </div>
    </main>
  );
}

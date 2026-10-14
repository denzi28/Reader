import { t } from '../lib/i18n';
import { PLAY_URL } from '../lib/appGate';
import { Wordmark } from './Wordmark';

/** Shown instead of the app, in a browser, once the app is on Google Play. */
export function AppGate() {
  return (
    <main className="gate" aria-label={t('Get the app')}>
      <Wordmark />
      <div className="gate-card">
        <img src="/icons/icon-192.png" alt="" width="96" height="96" />
        <h1>{t('Get the Leafpage app')}</h1>
        <p>{t('Leafpage now lives in the Google Play app. Install it to read, write and keep your library in your own Drive.')}</p>
        <a className="button gate-go" href={PLAY_URL} rel="noopener">{t('Get it on Google Play')}</a>
        <p className="gate-note"><a href="/privacy.html">{t('Privacy')}</a> · <a href="/terms.html">{t('Terms')}</a></p>
      </div>
    </main>
  );
}

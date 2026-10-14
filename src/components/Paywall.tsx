import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  closePaywall, FREE_DOCS, openPaywall, planInfo, STORES, useThisDeviceForSync, usePaywall, usePlan, type PaywallReason,
} from '../lib/plan';
import { count, t } from '../lib/i18n';
import { syncAll } from '../lib/sync/engine';
import { CheckIcon, CloseIcon, SparkIcon } from './icons';

const PERKS = [
  t('No limit on documents'),
  t('Automatic sync on all your devices'),
];

const LEAD: Record<PaywallReason, { title: string; text: string }> = {
  docs: { title: t('Your free library is full'), text: t('The free plan keeps {n} documents. Everything you have stays; to add more, remove one or go Premium.', { n: FREE_DOCS }) },
  sync: { title: t('Sync runs on another device'), text: t('The free plan syncs on one device, by hand. Premium syncs every device by itself.') },
  me: { title: t('Leafpage Premium'), text: t('Reading, pen, highlights, book mode, PDF tools and reading scanned pages stay free.') },
};

/** The sheet that explains Premium. It is bought in the app, through Google Play or the App Store, never here. */
export function PaywallHost() {
  const reason = usePaywall();
  const info = usePlan();
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  useEffect(() => {
    if (!reason) return;
    setMoveError(null);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closePaywall(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [reason]);
  if (!reason || info.state === 'open') return null;

  const lead = LEAD[reason];
  const stores = [
    STORES.play && { href: STORES.play, label: t('Get it on Google Play') },
    STORES.apple && { href: STORES.apple, label: t('Download on the App Store') },
  ].filter(Boolean) as { href: string; label: string }[];
  const useHere = async () => {
    setMoving(true);
    setMoveError(null);
    const ok = await useThisDeviceForSync();
    setMoving(false);
    if (!ok) { setMoveError(t('The sync device can be changed once a day.')); return; }
    closePaywall();
    void syncAll();
  };

  return createPortal(
    <div className="tool-menu" role="dialog" aria-modal="true" aria-label={t('Premium')}>
      <div className="tool-menu-backdrop" onClick={closePaywall} />
      <div className="tool-menu-sheet newnote paywall">
        <header className="tool-menu-head">
          <div>
            <h2>{lead.title}</h2>
            <p>{lead.text}</p>
          </div>
          <button className="icon-button" onClick={closePaywall} aria-label={t('Close')}><CloseIcon /></button>
        </header>
        {info.state === 'trial' && (
          <p className="paywall-trial"><SparkIcon /> {t('Your trial: {days} left, everything unlocked.', { days: count(info.trialDaysLeft, 'day', 'days') })}</p>
        )}
        {info.state === 'premium' && <p className="paywall-trial"><CheckIcon /> {t('You have Premium. Thank you.')}</p>}
        {info.state !== 'premium' && (
          <>
            <ul className="paywall-perks">
              {PERKS.map((p) => <li key={p}><CheckIcon />{p}</li>)}
            </ul>
            <p className="paywall-buy">{stores.length === 1 && STORES.apple ? t('Premium is bought in the app, through the App Store.') : t('Premium is bought in the app, through Google Play or the App Store.')}</p>
            <div className="paywall-actions">
              {stores.length > 0 ? stores.map((s) => (
                <a key={s.href} className="button" href={s.href} target="_blank" rel="noreferrer">{s.label}</a>
              )) : <p className="paywall-soon">{t('The app is on its way. Premium will be here as soon as it is listed.')}</p>}
              {reason === 'sync' && planInfo().state === 'free' && (
                <button className="chip-button" onClick={() => void useHere()} disabled={moving}>{t('Sync on this device instead')}</button>
              )}
              <button className="chip-button" onClick={closePaywall}>{t('Not now')}</button>
            </div>
            {moveError && <p className="tool-error" role="alert">{moveError}</p>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Where someone stands: the trial's days, the free plan's room, or Premium. Nothing when nothing is limited. */
export function PlanCard({ docCount, compact = false }: { docCount: number; compact?: boolean }) {
  const info = usePlan();
  if (info.state === 'open') return null;
  const free = info.state === 'free';
  const title = info.state === 'trial' ? t('Premium trial') : info.state === 'premium' ? t('Premium') : t('Free plan');
  const line = info.state === 'trial'
    ? t('{days} left, everything unlocked', { days: count(info.trialDaysLeft, 'day', 'days') })
    : info.state === 'premium'
      ? t('Unlimited documents, sync on every device')
      : info.syncHere
        ? t('{used} of {max} documents', { used: Math.min(docCount, FREE_DOCS), max: FREE_DOCS })
        : t('{used} of {max} documents · sync is on another device', { used: Math.min(docCount, FREE_DOCS), max: FREE_DOCS });
  return (
    <section className={`plan-card${compact ? ' compact' : ''} plan-${info.state}`} aria-label={t('Your plan')}>
      <span className="plan-icon" aria-hidden="true"><SparkIcon /></span>
      <span className="plan-text"><strong>{title}</strong><small>{line}</small></span>
      {info.state !== 'premium' && (
        <button className={free ? 'button button-small' : 'chip-button'} onClick={() => openPaywall('me')}>{free ? t('Get Premium') : t('Details')}</button>
      )}
    </section>
  );
}

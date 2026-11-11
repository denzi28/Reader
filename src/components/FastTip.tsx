import { useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../lib/i18n';
import { fastOn, fastTipSeen, markFastTipSeen, weakDevice } from '../lib/fastMode';
import { BoltIcon, CloseIcon } from './icons';

/** Shown once, in the library: there is a fast mode now. "Show me" goes to its switch; the cross puts the note away. */
export function FastTip({ onShow }: { onShow: () => void }) {
  const [open, setOpen] = useState(() => !fastTipSeen() && !fastOn());
  if (!open) return null;
  const done = () => { markFastTipSeen(); setOpen(false); };
  return createPortal(
    <div className="update-toast fast-tip" role="status">
      <span className="fast-tip-icon"><BoltIcon /></span>
      <span className="fast-tip-text">
        <strong>{t('New: Fast mode')}</strong>
        <small>{weakDevice() ? t('Recommended for this device: it turns off animations and blur so everything runs smoother.') : t('If the app feels slow on your device, it turns off animations and blur.')}</small>
      </span>
      <button className="chip-button chip-primary" onClick={() => { done(); onShow(); }}>{t('Show me')}</button>
      <button className="icon-button fast-tip-x" onClick={done} aria-label={t('Close')}><CloseIcon /></button>
    </div>,
    document.body,
  );
}

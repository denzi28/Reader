import { useEffect, useState } from 'react';

/** The width below which the app uses its phone layout (bottom bar, slim reading bars). */
const PHONE = '(max-width: 640px)';

export const isPhone = () => typeof matchMedia !== 'undefined' && matchMedia(PHONE).matches;

export function usePhone() {
  const [phone, setPhone] = useState(isPhone);
  useEffect(() => {
    const mq = matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/** A phone turned sideways: wide enough for the desktop layout, but too short for its bars to fit. */
const COMPACT = '(pointer: coarse) and (min-width: 641px) and (max-height: 500px)';

export const isCompact = () => typeof matchMedia !== 'undefined' && matchMedia(COMPACT).matches;

export function useCompact() {
  const [compact, setCompact] = useState(isCompact);
  useEffect(() => {
    const mq = matchMedia(COMPACT);
    const on = () => setCompact(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

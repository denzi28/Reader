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

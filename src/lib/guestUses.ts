// Someone who has not signed in may use the PDF tools a couple of times; after that, signing in is asked for.
// It is counted on this device (a browser can clear it), which is enough for an invitation to sign in.
export const GUEST_USES = 2;
const KEY = 'reader.guestUses';

export function usedGuestUses(): number {
  try { return Math.max(0, Number(localStorage.getItem(KEY)) || 0); } catch { return 0; }
}

export function addGuestUse(): number {
  const next = usedGuestUses() + 1;
  try { localStorage.setItem(KEY, String(next)); } catch { /* ignore */ }
  return next;
}

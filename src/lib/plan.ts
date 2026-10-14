// The plan someone is on: a trial of everything, Premium, or the free plan.
// Premium is bought only through Google Play or the App Store (see the README);
// this decides what each plan may do. Nothing is limited unless the server says
// enforcement is on (PAYWALL_ENFORCED), so it can be switched on once the apps exist.
import { useEffect, useState } from 'react';
import { t } from './i18n';
import { listDocs } from './storage';

export const FREE_DOCS = 5;
/** On the free plan the one syncing device syncs by itself at most this often; the rest is by hand. */
export const FREE_AUTO_SYNC_MS = 6 * 3600_000;

export interface Plan {
  enforced: boolean;
  trialDays: number;
  trialStarted: number;
  premiumUntil: number | null;
  /** True when this device may sync on the free plan. */
  syncHere: boolean;
  /** When the sync device was last chosen. */
  syncMovedAt: number | null;
}

export type PlanState = 'open' | 'trial' | 'premium' | 'free';

const PLAN_KEY = 'reader.plan';
const DEVICE_KEY = 'reader.device';
const DAY = 86_400_000;

interface Stored extends Plan { /** Server time minus this device's clock when it was fetched. */ skew: number }

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

let current: Stored | null = typeof localStorage === 'undefined' ? null : readStored();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

/** A name for this browser, so the free plan can tell devices apart. */
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'no-storage-device';
  }
}

function keep(next: Stored | null) {
  current = next;
  try {
    if (next) localStorage.setItem(PLAN_KEY, JSON.stringify(next));
    else localStorage.removeItem(PLAN_KEY);
  } catch { /* storage unavailable */ }
  changed();
}

interface Answer extends Plan { now?: number }

function take(a: Answer | null) {
  if (!a || !a.enforced) { keep(null); return; }
  keep({ ...a, skew: typeof a.now === 'number' ? a.now - Date.now() : 0 });
}

/** Asks the server for this person's plan (a person who is signed out has none). */
export async function refreshPlan(): Promise<void> {
  try {
    const res = await fetch(`/api/auth/plan?device=${encodeURIComponent(deviceId())}`, { credentials: 'include' });
    if (res.status === 401) { keep(null); return; }
    if (!res.ok) return; // keep what is known
    take((await res.json()) as Answer);
  } catch { /* offline: keep what is known */ }
}

export function forgetPlan() {
  keep(null);
}

/** Makes this device the one that syncs on the free plan. Returns false when it was moved too recently. */
export async function useThisDeviceForSync(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/plan-move', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Reader': '1' },
      body: JSON.stringify({ device: deviceId() }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as Answer & { moved: boolean };
    take(body);
    return body.moved;
  } catch {
    return false;
  }
}

export interface PlanInfo {
  state: PlanState;
  /** Days of the trial left (rounded up), when on it. */
  trialDaysLeft: number;
  /** Premium until (ms), when it has an end. */
  premiumUntil: number | null;
  syncHere: boolean;
  /** When the free plan's sync device can next be changed (ms), if it cannot be now. */
  moveAgainAt: number | null;
}

export function planInfo(p: Stored | null = current): PlanInfo {
  if (!p || !p.enforced) return { state: 'open', trialDaysLeft: 0, premiumUntil: null, syncHere: true, moveAgainAt: null };
  const now = Date.now() + p.skew;
  const trialEnd = p.trialStarted + p.trialDays * DAY;
  const moveAgainAt = p.syncMovedAt && p.syncMovedAt + DAY > now ? p.syncMovedAt + DAY - p.skew : null;
  if (p.premiumUntil && p.premiumUntil > now) return { state: 'premium', trialDaysLeft: 0, premiumUntil: p.premiumUntil, syncHere: true, moveAgainAt };
  if (now < trialEnd) return { state: 'trial', trialDaysLeft: Math.max(1, Math.ceil((trialEnd - now) / DAY)), premiumUntil: null, syncHere: true, moveAgainAt };
  return { state: 'free', trialDaysLeft: 0, premiumUntil: null, syncHere: p.syncHere, moveAgainAt };
}

/** Can the library take another document? */
export async function roomForDocs(adding = 1): Promise<{ ok: boolean; have: number; allowed: number }> {
  const info = planInfo();
  if (info.state !== 'free') return { ok: true, have: 0, allowed: Infinity };
  // Notes made for a page belong to their document and are not counted.
  const have = (await listDocs()).filter((d) => !d.attached).length;
  return { ok: have + adding <= FREE_DOCS, have, allowed: Math.max(0, FREE_DOCS - have) };
}

export class PlanLimit extends Error {
  constructor(message = t('The free plan keeps {n} documents. Premium has no limit.', { n: FREE_DOCS })) {
    super(message);
    this.name = 'PlanLimit';
  }
}

/** Throws a PlanLimit when the free plan is full. */
export async function assertRoom() {
  if (!(await roomForDocs(1)).ok) throw new PlanLimit();
}

export function usePlan(): PlanInfo {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    listeners.add(on);
    return () => void listeners.delete(on);
  }, []);
  return planInfo();
}

// ---- the paywall sheet --------------------------------------------------------
export type PaywallReason = 'docs' | 'sync' | 'me';
let paywall: PaywallReason | null = null;
const paywallListeners = new Set<() => void>();
export function openPaywall(reason: PaywallReason) {
  paywall = reason;
  paywallListeners.forEach((fn) => fn());
}
export function closePaywall() {
  paywall = null;
  paywallListeners.forEach((fn) => fn());
}
export function usePaywall(): PaywallReason | null {
  const [value, setValue] = useState(paywall);
  useEffect(() => {
    const on = () => setValue(paywall);
    paywallListeners.add(on);
    return () => void paywallListeners.delete(on);
  }, []);
  return value;
}

/** Where Premium can be bought (set when the apps are listed). */
export const STORES = {
  play: (import.meta.env.VITE_PLAY_URL as string | undefined) || '',
  apple: (import.meta.env.VITE_APPSTORE_URL as string | undefined) || '',
};

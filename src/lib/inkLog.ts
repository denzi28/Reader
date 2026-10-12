import type { DocInk, InkLog, Stroke } from './types';

/** Turns the log into what the viewer draws: live strokes by page, in order. */
export function inkFromLog(log: InkLog): DocInk {
  const live = Object.entries(log)
    .filter(([, e]) => !e.d && e.s)
    .sort(([ia, a], [ib, b]) => a.c - b.c || (ia < ib ? -1 : 1));
  const ink: DocInk = {};
  for (const [, e] of live) (ink[e.p] ??= []).push(e.s!);
  return ink;
}

/** Builds a log for ink saved before syncing existed. */
export function logFromInk(ink: DocInk): InkLog {
  const log: InkLog = {};
  let order = 0;
  for (const [page, strokes] of Object.entries(ink)) {
    for (const s of strokes) log[s.id] = { p: Number(page), c: order++, t: 1, s };
  }
  return log;
}

/** Records one page edit (a stroke drawn, erased, undone or redone). */
export function applyEdit(log: InkLog, page: number, prev: Stroke[], next: Stroke[], now: number) {
  const before = new Set(prev.map((s) => s.id));
  const after = new Set(next.map((s) => s.id));
  for (const s of next) {
    if (before.has(s.id)) continue;
    log[s.id] = { p: page, c: log[s.id]?.c ?? now, t: now, s };
  }
  for (const s of prev) {
    if (after.has(s.id)) continue;
    log[s.id] = { p: page, c: log[s.id]?.c ?? now, t: now, d: 1 };
  }
}

/** Newer entry wins per stroke. Returns the merged log and whether `a` changed. */
export function mergeLogs(a: InkLog, b: InkLog): { log: InkLog; changed: boolean } {
  const log: InkLog = { ...a };
  let changed = false;
  for (const [id, e] of Object.entries(b)) {
    const mine = log[id];
    if (!mine || e.t > mine.t) {
      log[id] = e;
      changed = true;
    }
  }
  return { log, changed };
}

/** True when `a` holds something `b` lacks or has older. */
export function hasNewer(a: InkLog, b: InkLog) {
  return Object.entries(a).some(([id, e]) => !b[id] || e.t > b[id].t);
}

export const latestChange = (log: InkLog) =>
  Object.values(log).reduce((max, e) => Math.max(max, e.t), 0);

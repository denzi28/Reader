// Pages are drawn one at a time, nearest the page being read first. Drawing
// several at once only made each of them slower (they share one PDF worker),
// so the page on screen used to wait for its neighbours to finish too.

interface Job {
  index: number;
  run: () => Promise<unknown>;
}

const waiting = new Set<Job>();
let running = 0;
let focus = 0;
const LIMIT = 1;

/** The page being read; waiting pages closest to it are drawn first. */
export function setRenderFocus(page: number) {
  focus = page;
}

function pump() {
  while (running < LIMIT && waiting.size) {
    let next: Job | null = null;
    for (const job of waiting) {
      if (!next || Math.abs(job.index - focus) < Math.abs(next.index - focus)) next = job;
    }
    waiting.delete(next!);
    running++;
    // A page that never finishes must not hold up every page after it.
    const timeout = new Promise((r) => setTimeout(r, 15_000));
    void Promise.race([next!.run(), timeout]).catch(() => undefined).finally(() => {
      running--;
      pump();
    });
  }
}

/** Queues drawing page `index`. `cancel` drops it if it has not started yet. */
export function queueRender(index: number, run: () => Promise<unknown>) {
  const job: Job = { index, run };
  waiting.add(job);
  queueMicrotask(pump); // let every page that appears this frame join first
  return { cancel: () => waiting.delete(job) };
}

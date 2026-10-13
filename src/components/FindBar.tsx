import { useEffect, useRef, useState } from 'react';
import { type FindMatch, Finder } from '../lib/find';
import { ChevronIcon, CloseIcon, ListIcon } from './icons';

/**
 * Finding words in the open document: a box, the number of matches, a step to the
 * next and the one before, and (if wanted) every match with the words around it.
 */
export function FindBar({ finder, startPage, onState, onClose }: {
  finder: Finder;
  startPage: number;
  /** The matches so far and the one being shown, for the pages to mark. */
  onState: (matches: FindMatch[], active: FindMatch | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<FindMatch[]>([]);
  const [active, setActive] = useState<FindMatch | null>(null);
  const [done, setDone] = useState(0);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  // Bumped when pages have been read from their pictures, so the search runs again.
  const [round, setRound] = useState(0);
  const stopReading = useRef(false);
  const [showList, setShowList] = useState(() => window.innerWidth > 760);
  const box = useRef<HTMLInputElement>(null);
  const activeRef = useRef<FindMatch | null>(null);
  activeRef.current = active;

  useEffect(() => { box.current?.focus(); box.current?.select(); }, []);
  // Leaving the bar clears the marks.
  useEffect(() => () => onState([], null), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { stopReading.current = true; }, []);

  useEffect(() => {
    const q = query.trim();
    // Whatever was found for the earlier words no longer counts.
    setActive(null);
    setMatches([]);
    setDone(0);
    onState([], null);
    if (q.length < 2) return;
    let stopped = false;
    const timer = setTimeout(() => {
      void finder.search(q, startPage, (found, n) => {
        if (stopped) return;
        setMatches(found);
        setDone(n);
        // The first match at or after the page being read is the one shown first.
        const keep = activeRef.current && found.includes(activeRef.current) ? activeRef.current : null;
        const first = keep ?? found.find((m) => m.page >= startPage) ?? found[0] ?? null;
        setActive(first);
        onState(found, first);
      }, () => stopped);
    }, 220);
    return () => { stopped = true; clearTimeout(timer); };
  }, [query, finder, round]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (by: number) => {
    if (!matches.length) return;
    const i = active ? matches.indexOf(active) : -1;
    const next = matches[(i + by + matches.length) % matches.length];
    setActive(next);
    onState(matches, next);
  };
  const choose = (m: FindMatch) => {
    setActive(m);
    onState(matches, m);
  };
  const readPages = async () => {
    const pages = finder.emptyPages();
    if (!pages.length || reading) return;
    stopReading.current = false;
    setReadFailed(false);
    setReading({ done: 0, total: pages.length });
    try {
      await finder.recognise(pages, (done, total) => setReading({ done, total }), () => stopReading.current);
    } catch {
      setReadFailed(true);
    }
    setReading(null);
    setRound((r) => r + 1);
  };
  const scanning = query.trim().length >= 2 && done < finder.pageCount;
  const index = active ? matches.indexOf(active) + 1 : 0;
  const empty = finder.emptyPages().length;

  return (
    <div className="findbar" role="search" aria-label="Find in this document">
      <div className="findbar-row">
        <input
          ref={box}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find in this document"
          aria-label="Find in this document"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
            else if (e.key === 'Escape') onClose();
          }}
        />
        <span className="findbar-count" aria-live="polite">
          {query.trim().length < 2 ? '' : matches.length ? `${index} of ${matches.length}${scanning ? '+' : ''}` : scanning ? `Searching ${done}/${finder.pageCount}…` : 'No matches'}
        </span>
        <button className="icon-button" onClick={() => step(-1)} disabled={!matches.length} aria-label="Previous match" title="Previous (Shift+Enter)"><span className="up"><ChevronIcon /></span></button>
        <button className="icon-button" onClick={() => step(1)} disabled={!matches.length} aria-label="Next match" title="Next (Enter)"><span className="down"><ChevronIcon /></span></button>
        <button className={`icon-button${showList ? ' on' : ''}`} onClick={() => setShowList((v) => !v)} aria-pressed={showList} aria-label="List of matches" title="List of matches"><ListIcon /></button>
        <button className="icon-button" onClick={onClose} aria-label="Close find" title="Close (Esc)"><CloseIcon /></button>
      </div>
      {scanning && matches.length > 0 && <p className="findbar-note">Still reading the rest of the pages ({done}/{finder.pageCount})…</p>}
      {reading ? (
        <p className="findbar-note">
          Reading scanned pages… {reading.done}/{reading.total}
          <button className="findbar-link" onClick={() => { stopReading.current = true; }}>Stop</button>
        </p>
      ) : !scanning && query.trim().length >= 2 && (empty > 0 || readFailed) ? (
        <p className="findbar-note">
          {readFailed
            ? 'Could not read the pages. '
            : `${empty} ${empty === 1 ? 'page has' : 'pages have'} no text to search. `}
          {empty > 0 && <button className="findbar-link" onClick={() => void readPages()}>{readFailed ? 'Try again' : 'Recognise text'}</button>}
        </p>
      ) : null}
      {showList && matches.length > 0 && (
        <ol className="findbar-list">
          {matches.slice(0, 300).map((m, i) => (
            <li key={i}>
              <button className={m === active ? 'on' : ''} onClick={() => choose(m)}>
                <span className="findbar-page">p. {m.page + 1}</span>
                <span className="findbar-snippet">{m.before} <mark>{m.hit}</mark> {m.after}</span>
              </button>
            </li>
          ))}
          {matches.length > 300 && <li className="findbar-more">… and {matches.length - 300} more. Keep stepping with the arrows.</li>}
        </ol>
      )}
    </div>
  );
}

/** A little open book whose pages keep turning: shown wherever something is on its way. */
export function BookLoader({ size = 44, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <span className="bookload" role="img" aria-label={label} style={{ ['--bs' as string]: `${size}px` }}>
      <span className="bookload-back" />
      <span className="bookload-stack" />
      {[0, 1, 2, 3].map((n) => (
        <span key={n} className="bookload-leaf" style={{ ['--n' as string]: n }} />
      ))}
    </span>
  );
}

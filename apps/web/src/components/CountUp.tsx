import { useEffect, useState } from 'react';

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A number that counts up from 0 when it appears (ease-out). With reduced motion it just shows the value. */
export function CountUp({ value, format = (n: number) => Math.round(n).toLocaleString(), ms = 1200, delay = 250 }: { value: number; format?: (n: number) => string; ms?: number; delay?: number }) {
  const [shown, setShown] = useState(() => (reduced() ? value : 0));
  useEffect(() => {
    if (reduced()) { setShown(value); return; }
    let raf = 0, t0 = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / ms);
      setShown(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    const start = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => { clearTimeout(start); cancelAnimationFrame(raf); };
  }, [value, ms, delay]);
  return <span className="tabular-nums">{format(shown)}</span>;
}

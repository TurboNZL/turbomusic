import { useLayoutEffect, useState } from 'react';

/** How far a floating panel must sit above the screen's bottom edge to clear whatever is docked there (player bar, tab bar, dock). Measured at once, then kept up to date. */
export function useBottomOffset(active: boolean, gap = 12): number {
  const [bottom, setBottom] = useState(16);
  useLayoutEffect(() => {
    if (!active) return;
    const measure = () => {
      let top = window.innerHeight;
      for (const el of document.querySelectorAll('.bt-player, .bt-tabbar, .bt-dock')) { const r = el.getBoundingClientRect(); if (r.height > 0 && r.bottom > 0 && r.top < top) top = r.top; }
      setBottom(Math.max(8, Math.round(window.innerHeight - top + gap)));
    };
    measure(); const t = setInterval(measure, 400); window.addEventListener('resize', measure);
    return () => { clearInterval(t); window.removeEventListener('resize', measure); };
  }, [active, gap]);
  return bottom;
}

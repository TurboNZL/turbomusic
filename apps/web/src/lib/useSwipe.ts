import { useCallback, useRef } from 'react';
import { haptic } from './haptics.ts';

export type SwipeDir = -1 | 1;
export interface SwipeOpts {
  /** which way counts: both, or only to the right (a card that can only be accepted) */
  dirs: 'both' | 'right';
  onCommit: (dir: SwipeDir) => void;
  /** called when a swipe starts to be recognised, so the page can leave a preview alone and not treat the end of the drag as a tap */
  onStart?: () => void;
}

const SPRING = 'transform 420ms cubic-bezier(.34,1.56,.64,1)';
const FLING = 'transform 280ms cubic-bezier(.3,.6,.4,1), opacity 280ms ease-out';

/**
 * Tinder-style swipe for one card: the card follows the finger (a little lift and a tilt around a point below it, so it swings like a
 * card held at the bottom edge), shows how close it is to being chosen through the CSS variables --sw-l and --sw-r (0 to 1, for stamps),
 * and on release either flies off in the direction it was thrown or springs back. All of it is written straight to the element, never
 * through React state, so it stays at the screen's frame rate.
 */
export function useSwipe({ dirs, onCommit, onStart }: SwipeOpts) {
  const st = useRef<{ x: number; y: number; w: number; locked: boolean; moves: { x: number; t: number }[]; passed: boolean; id: number } | null>(null);
  const swallow = useRef(false);
  const cb = useRef({ onCommit, onStart }); cb.current = { onCommit, onStart };

  const apply = (el: HTMLElement, dx: number, dy: number, w: number) => {
    // rubber band against the side that does not count
    const x = dirs === 'right' && dx < 0 ? dx * 0.18 : dx;
    const lift = Math.max(-46, Math.min(46, dy * 0.32));
    el.style.transition = 'none';
    el.style.transform = `translate3d(${x}px, ${lift}px, 0) rotate(${(x / w) * 16}deg)`;
    const p = Math.min(1, Math.abs(x) / (w * 0.32));
    el.style.setProperty('--sw-r', x > 0 ? String(p) : '0');
    el.style.setProperty('--sw-l', x < 0 ? String(p) : '0');
  };
  const reset = (el: HTMLElement) => {
    el.style.transition = SPRING;
    el.style.transform = 'translate3d(0,0,0) rotate(0deg)';
    el.style.setProperty('--sw-r', '0'); el.style.setProperty('--sw-l', '0');
    const done = () => { el.style.transition = ''; el.style.transform = ''; el.removeEventListener('transitionend', done); };
    el.addEventListener('transitionend', done);
  };

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button > 0 || (e.target as Element).closest('a, button, input, select, textarea')) return;
    st.current = { x: e.clientX, y: e.clientY, w: e.currentTarget.offsetWidth || 300, locked: false, moves: [{ x: e.clientX, t: performance.now() }], passed: false, id: e.pointerId };
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = st.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { st.current = null; return; } // the page is being scrolled
      if (Math.abs(dx) < 8) return;
      s.locked = true; cb.current.onStart?.();
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const now = performance.now();
    s.moves.push({ x: e.clientX, t: now }); while (s.moves.length > 2 && now - s.moves[0].t > 90) s.moves.shift();
    apply(e.currentTarget, dx, dy, s.w);
    const over = Math.abs(dx) >= Math.min(110, s.w * 0.3) && (dirs === 'both' || dx > 0);
    if (over !== s.passed) { s.passed = over; if (over) haptic('tick'); } // a tick when it is far enough that letting go picks it
  }, [dirs]); // eslint-disable-line react-hooks/exhaustive-deps
  const end = useCallback((e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    const s = st.current;
    if (!s || s.id !== e.pointerId) return;
    st.current = null;
    if (!s.locked) return;
    swallow.current = true; setTimeout(() => { swallow.current = false; }, 0); // the click that ends a drag is not a tap on the card
    const el = e.currentTarget;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    const first = s.moves[0], last = s.moves[s.moves.length - 1];
    const v = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0; // px per ms over the last ~90 ms
    const dir: number = Math.abs(v) > 0.55 && Math.abs(dx) > 36 ? Math.sign(v) : Math.sign(dx);
    const far = Math.abs(dx) >= Math.min(110, s.w * 0.3), thrown = Math.abs(v) > 0.55 && Math.abs(dx) > 36 && Math.sign(v) === Math.sign(dx);
    const ok = !cancelled && (far || thrown) && dir !== 0 && (dirs === 'both' || dir > 0);
    if (!ok) { reset(el); return; }
    // fly off the way it was thrown, carrying its speed
    const dist = window.innerWidth * 1.2 * dir;
    el.style.transition = FLING;
    el.style.transform = `translate3d(${dist}px, ${Math.max(-80, Math.min(80, dy * 0.5))}px, 0) rotate(${dir * 28}deg)`;
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    haptic('confirm');
    cb.current.onCommit(dir as SwipeDir);
  }, [dirs]);

  return {
    bind: { onPointerDown, onPointerMove, onPointerUp: (e: React.PointerEvent<HTMLElement>) => end(e, false), onPointerCancel: (e: React.PointerEvent<HTMLElement>) => end(e, true) },
    /** true for the click that ends a drag */
    swallowClick: () => swallow.current,
  };
}

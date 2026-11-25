import { useCallback, useRef } from 'react';
import { haptic } from './haptics.ts';

/** 1 = right or up, -1 = left or down (what a two-way card like Love / Meh maps its answers to) */
export type SwipeDir = -1 | 1;
const dirOf = (dx: number, dy: number): SwipeDir => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 1 : -1) : dy < 0 ? 1 : -1);
export interface SwipeOpts {
  /** any direction counts ('both': sideways, up, down, diagonal), or only dragging to the right */
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
  const st = useRef<{ x: number; y: number; w: number; locked: boolean; moves: { x: number; y: number; t: number }[]; passed: boolean; id: number } | null>(null);
  const swallow = useRef(false);
  const cb = useRef({ onCommit, onStart }); cb.current = { onCommit, onStart };

  const apply = (el: HTMLElement, dx: number, dy: number, w: number) => {
    // rubber band against the side that does not count (right-only cards)
    const x = dirs === 'right' && dx < 0 ? dx * 0.18 : dx, y = dirs === 'right' ? dy * 0.3 : dy;
    el.style.transition = 'none';
    el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${(x / w) * 16}deg)`;
    const p = Math.min(1, Math.hypot(x, y) / (w * 0.32));
    const d = dirOf(x, y);
    el.style.setProperty('--sw-r', d > 0 ? String(p) : '0');
    el.style.setProperty('--sw-l', d < 0 ? String(p) : '0');
  };
  const reset = (el: HTMLElement) => {
    el.style.transition = SPRING;
    el.style.transform = 'translate3d(0,0,0) rotate(0deg)';
    el.style.setProperty('--sw-r', '0'); el.style.setProperty('--sw-l', '0');
    const done = () => { el.style.transition = ''; el.style.transform = ''; el.style.zIndex = ''; el.removeEventListener('transitionend', done); };
    el.addEventListener('transitionend', done);
  };

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button > 0 || (e.target as Element).closest('a, button, input, select, textarea')) return;
    st.current = { x: e.clientX, y: e.clientY, w: e.currentTarget.offsetWidth || 300, locked: false, moves: [{ x: e.clientX, y: e.clientY, t: performance.now() }], passed: false, id: e.pointerId };
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = st.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.locked) {
      if (Math.hypot(dx, dy) < 8) return; // not a drag yet (the card's touch-action is none, so the page never scrolls from a card)
      s.locked = true; cb.current.onStart?.();
      e.currentTarget.style.zIndex = '40'; // above its neighbour: a card dragged across the other one must not slide behind it (it looked like it hit a wall)
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const now = performance.now();
    s.moves.push({ x: e.clientX, y: e.clientY, t: now }); while (s.moves.length > 2 && now - s.moves[0].t > 90) s.moves.shift();
    apply(e.currentTarget, dx, dy, s.w);
    const over = Math.hypot(dx, dy) >= Math.min(110, s.w * 0.3) && (dirs === 'both' || dx > 0);
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
    const dt = Math.max(1, last.t - first.t);
    const vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt; // px per ms over the last ~90 ms
    const dist = Math.hypot(dx, dy), speed = Math.hypot(vx, vy);
    const far = dist >= Math.min(110, s.w * 0.3), thrown = speed > 0.55 && dist > 36;
    const ok = !cancelled && (far || thrown) && (dirs === 'both' || dx > 0);
    if (!ok) { reset(el); return; }
    // fly off the way it was dragged or thrown, whichever way that is
    const ux = thrown ? vx / speed : dx / (dist || 1), uy = thrown ? vy / speed : dy / (dist || 1);
    const reach = Math.max(window.innerWidth, window.innerHeight) * 1.3;
    el.style.transition = FLING;
    el.style.transform = `translate3d(${ux * reach}px, ${uy * reach}px, 0) rotate(${Math.sign(ux || 1) * 28}deg)`;
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    haptic('confirm');
    cb.current.onCommit(dirOf(dx, dy));
  }, [dirs]);

  return {
    bind: { onPointerDown, onPointerMove, onPointerUp: (e: React.PointerEvent<HTMLElement>) => end(e, false), onPointerCancel: (e: React.PointerEvent<HTMLElement>) => end(e, true) },
    /** true for the click that ends a drag */
    swallowClick: () => swallow.current,
  };
}

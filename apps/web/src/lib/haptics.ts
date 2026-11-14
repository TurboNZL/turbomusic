import { useStore } from './store.ts';

/**
 * Vibration feedback. In the Android app the phone's own haptic engine is used (`TurboMusicAndroid.haptic`: respects the system
 * "touch feedback" setting and needs no permission); elsewhere `navigator.vibrate` where the browser has it (phones, not
 * desktops or iOS). Presses on buttons, links, tabs, rows and switches tick lightly by themselves (`startHaptics`); the
 * important moments (a vote, a long press) ask for a stronger one.
 */
export type HapticKind = 'tap' | 'tick' | 'confirm' | 'reject' | 'heavy';
interface HapticBridge { haptic?(kind: string): void }
const bridge = () => (window as unknown as { TurboMusicAndroid?: HapticBridge }).TurboMusicAndroid;
const PATTERNS: Record<HapticKind, number | number[]> = { tap: 8, tick: 4, confirm: [12, 30, 18], reject: [24, 40, 24], heavy: 28 };

let last = 0;
export function haptic(kind: HapticKind = 'tap') {
  if (!useStore.getState().settings.haptics) return;
  const now = performance.now();
  if (now - last < 25) return; // one press can fire several listeners
  last = now;
  try {
    const b = bridge();
    if (b?.haptic) b.haptic(kind);
    else if (typeof navigator.vibrate === 'function') navigator.vibrate(PATTERNS[kind]);
  } catch { /* no vibrator, or blocked */ }
}

const PRESSABLE = 'button, a[href], summary, [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="switch"], input[type="checkbox"], input[type="radio"], label, .bt-nav, .bt-row, .bt-tile, [data-haptic]';

/**
 * Light feedback when a control is really pressed. The tick comes with the `click` the browser fires only for a completed tap:
 * resting a finger on a button, scrolling a list that starts on a row, or dragging away from a control never clicks, so none of those buzz.
 * Call once at start-up.
 */
export function startHaptics() {
  let touch = false;
  document.addEventListener('pointerdown', (e) => { touch = e.pointerType !== 'mouse'; }, { capture: true, passive: true });
  document.addEventListener('click', (e) => {
    if (!touch || !(e.target instanceof Element)) return;
    touch = false;
    const hit = e.target.closest(PRESSABLE);
    if (!hit || (hit as HTMLButtonElement).disabled) return;
    haptic(hit.closest('[data-haptic="none"]') ? 'tick' : 'tap');
  }, { capture: true, passive: true });
  // sliders tick as the value steps
  document.addEventListener('input', (e) => { if (e.target instanceof HTMLInputElement && e.target.type === 'range') haptic('tick'); }, { capture: true, passive: true });
  // a long press that opens a menu
  document.addEventListener('contextmenu', (e) => { if ((e as PointerEvent).pointerType !== 'mouse') haptic('heavy'); }, { capture: true, passive: true });
}

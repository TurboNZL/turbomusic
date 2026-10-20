/**
 * The arithmetic of a crossfade, kept apart from the player so it can be tested. The player (lib/player.ts) owns two <audio> elements:
 * the one playing and a spare. A few seconds before the end it loads the next track into the spare, and when the time comes both
 * run together while their volumes follow an equal-power curve (the sum of the two loudnesses stays level, so there is no dip).
 */

/** Volumes (0..1, before the user's volume) of the outgoing and incoming track `progress` (0..1) of the way through a fade. */
export function fadeGains(progress: number): { out: number; in: number } {
  const p = Math.min(1, Math.max(0, progress));
  return { out: Math.cos((p * Math.PI) / 2), in: Math.sin((p * Math.PI) / 2) };
}

/** The shortest fade there is; anything below counts as a cut. */
export const MIN_FADE_SEC = 0.05;

/**
 * The stops of the crossfade sliders: finest where a small gap is being closed (0.05 s up to half a second), then a tenth up to 2 s, then a
 * quarter, then half seconds up to the longest fade. One slider position is one stop, so the short lengths can be told apart.
 */
export function fadeStops(max: number): number[] {
  const out: number[] = [];
  const add = (from: number, to: number, step: number) => { for (let n = Math.round(from / step); n * step <= to + 1e-9; n++) { const v = Math.round(n * step * 100) / 100; if (v <= max && (!out.length || v > out[out.length - 1])) out.push(v); } };
  add(0, 0.5, 0.05); add(0.6, 2, 0.1); add(2.25, 5, 0.25); add(5.5, max, 0.5);
  return out;
}
/** The stop nearest to a length. */
export function nearestStop(stops: number[], sec: number): number {
  let best = 0;
  for (let i = 1; i < stops.length; i++) if (Math.abs(stops[i] - sec) < Math.abs(stops[best] - sec)) best = i;
  return best;
}
/** "off", "0.3 s", "2.25 s", "8 s" */
export const fadeLabel = (sec: number) => (sec > 0 ? `${Math.round(sec * 100) / 100} s` : 'off');

/** Seconds before the end at which the spare is loaded (a download may be needed first). */
export const PREPARE_AHEAD_SEC = 6;
/** Fades never start earlier than this much before the end plus the timer's slack (the player reports about four times a second). */
export const TRIGGER_SLACK_SEC = 0.3;

/**
 * How long the fade really lasts: what was asked, but never more than a third of the playing track (a 20 s sketch cannot give away
 * 12 s) and never more than is left of it. 0 means: do not crossfade this change.
 */
export function fadeLength(wantedSec: number, durationSec: number, remainingSec: number): number {
  if (!(wantedSec > 0) || !Number.isFinite(durationSec) || durationSec <= 0 || !Number.isFinite(remainingSec)) return 0;
  const len = Math.min(wantedSec, durationSec / 3, Math.max(0, remainingSec));
  return len >= MIN_FADE_SEC ? len : 0;
}

/**
 * A rule can place the fade earlier than the end of the track (see `crossfadeShiftSec` in core). Never more than a third of the track
 * (a short track must not be cut off right after it starts).
 */
export const clampShift = (shiftSec: number, durationSec: number) => (shiftSec > 0 && Number.isFinite(durationSec) && durationSec > 0 ? Math.min(shiftSec, durationSec / 3) : 0);

/** Is it time to load the next track into the spare? `shiftSec` is how much earlier than the end the fade is placed. */
export const shouldPrepare = (wantedSec: number, remainingSec: number, shiftSec = 0) => wantedSec > 0 && remainingSec <= wantedSec + shiftSec + PREPARE_AHEAD_SEC;
/** Is it time to start the fade? */
export const shouldFade = (wantedSec: number, remainingSec: number, shiftSec = 0) => wantedSec > 0 && remainingSec <= wantedSec + shiftSec + TRIGGER_SLACK_SEC;

/** The windows (seconds across the whole picture) the alignment picture can show, centred on the end of the first song: fine, medium, wide. */
export const ALIGN_WINDOWS: readonly number[] = [3, 8, 26];
/** The smallest window that holds a fade placed `shiftSec` early (its far edge is `shiftSec + fadeSec` before the end) with room to spare. */
export function windowFor(fadeSec: number, shiftSec: number): number {
  const reach = (shiftSec + fadeSec) * 1.2;
  return ALIGN_WINDOWS.find((w) => reach <= w / 2) ?? ALIGN_WINDOWS[ALIGN_WINDOWS.length - 1];
}
/** New shift after dragging the fade `dxPx` to the right (later) over a picture `widthPx` wide showing `windowSec`: left = earlier = more shift, in hundredths of a second. */
export function shiftFromDrag(startShift: number, dxPx: number, widthPx: number, maxShift: number, windowSec: number = ALIGN_WINDOWS[2]): number {
  if (!(widthPx > 0)) return startShift;
  const next = startShift - (dxPx / widthPx) * windowSec;
  return Math.round(Math.min(maxShift, Math.max(0, next)) * 100) / 100;
}
/** A shift moved by `delta` seconds, clamped and rounded to hundredths (for the buttons and keys). */
export const nudgeShift = (shift: number, delta: number, maxShift: number) => Math.round(Math.min(maxShift, Math.max(0, shift + delta)) * 100) / 100;

/**
 * Milliseconds to wait before the fade must start, when it is close enough to be worth a timer (the player reports its time only about four
 * times a second, which is too coarse to place a short fade or close a small gap). null = not yet / no timer needed.
 */
export function fadeDelayMs(wantedSec: number, remainingSec: number, shiftSec: number, rate = 1): number | null {
  if (!(wantedSec > 0)) return null;
  const until = (remainingSec - (wantedSec + shiftSec)) / (rate > 0 ? rate : 1);
  return until > 0 && until <= 1.5 ? Math.round(until * 1000) : until <= 0 ? 0 : null;
}

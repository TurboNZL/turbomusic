import { describe, expect, it } from 'vitest';
import { fadeGains, fadeLabel, fadeLength, fadeStops, nearestStop, shouldFade, shouldPrepare } from '../src/lib/crossfadeMath.ts';

describe('crossfade arithmetic', () => {
  it('keeps the total power level through the fade', () => {
    for (let p = 0; p <= 1; p += 0.1) { const g = fadeGains(p); expect(g.out ** 2 + g.in ** 2).toBeCloseTo(1, 10); }
    expect(fadeGains(0)).toEqual({ out: 1, in: 0 });
    expect(fadeGains(1).out).toBeCloseTo(0, 10);
    expect(fadeGains(1).in).toBeCloseTo(1, 10);
    expect(fadeGains(-3).in).toBe(0); expect(fadeGains(9).in).toBeCloseTo(1, 10);
  });
  it('never gives away more than a third of the playing track or more than is left', () => {
    expect(fadeLength(5, 200, 5.2)).toBe(5);
    expect(fadeLength(12, 20, 12)).toBeCloseTo(20 / 3, 10);
    expect(fadeLength(8, 200, 4.9)).toBe(4.9);
    expect(fadeLength(0, 200, 5)).toBe(0);
    expect(fadeLength(5, Number.NaN, 5)).toBe(0);
    expect(fadeLength(5, 200, 0.03)).toBe(0); // nothing worth fading
    expect(fadeLength(0.3, 200, 5)).toBe(0.3); // short fades are real fades
  });
  it('prepares the spare before the fade starts', () => {
    expect(shouldPrepare(4, 11)).toBe(false);
    expect(shouldPrepare(4, 9.9)).toBe(true);
    expect(shouldFade(4, 4.2)).toBe(true);
    expect(shouldFade(4, 5)).toBe(false);
    expect(shouldFade(0, 0)).toBe(false);
  });
  it('has fine stops for short fades and coarser ones for long fades', () => {
    const stops = fadeStops(12);
    expect(stops[0]).toBe(0); expect(stops[1]).toBe(0.05); expect(stops[2]).toBe(0.1); expect(stops[stops.length - 1]).toBe(12);
    expect(stops).toContain(0.3); expect(stops).toContain(0.35); expect(stops).toContain(0.6); expect(stops).toContain(2); expect(stops).toContain(2.25); expect(stops).toContain(5); expect(stops).toContain(5.5);
    expect(stops).not.toContain(0.55); expect(stops).not.toContain(2.05); expect(stops).not.toContain(2.1); expect(stops).not.toContain(5.25);
    expect([...stops].sort((a, b) => a - b)).toEqual(stops);
    expect(new Set(stops).size).toBe(stops.length);
    expect(nearestStop(stops, 0.31)).toBe(stops.indexOf(0.3));
    expect(nearestStop(stops, 99)).toBe(stops.length - 1);
    expect(fadeLabel(0)).toBe('off'); expect(fadeLabel(2.25)).toBe('2.25 s'); expect(fadeLabel(8)).toBe('8 s');
  });
});

import { ALIGN_WINDOWS, clampShift, fadeDelayMs, nudgeShift, shiftFromDrag, windowFor } from '../src/lib/crossfadeMath.ts';
describe('a fade placed earlier than the end', () => {
  it('starts later by the shift: it must begin that much sooner', () => {
    expect(shouldFade(4, 6.2, 2)).toBe(true);   // 4 s fade + 2 s earlier: it starts 6 s before the end
    expect(shouldFade(4, 6.4, 2)).toBe(false);
    expect(shouldPrepare(4, 12.1, 2)).toBe(false);
    expect(shouldPrepare(4, 11.9, 2)).toBe(true);
  });
  it('never takes more than a third of a short track', () => {
    expect(clampShift(10, 30)).toBe(10);
    expect(clampShift(10, 21)).toBe(7);
    expect(clampShift(0, 200)).toBe(0);
    expect(clampShift(5, Number.NaN)).toBe(0);
  });
  it('turns a drag into a shift: left = earlier, clamped, in tenths', () => {
    const w = 260; // 10 px per second
    expect(ALIGN_WINDOWS).toEqual([3, 8, 26]);
    expect(shiftFromDrag(0, -25, w, 12)).toBe(2.5);
    expect(shiftFromDrag(3, 20, w, 12)).toBe(1);
    expect(shiftFromDrag(0, 40, w, 12)).toBe(0);
    expect(shiftFromDrag(2, -500, w, 12)).toBe(12);
    expect(shiftFromDrag(2, -14.3, w, 12)).toBe(3.43);
    expect(shiftFromDrag(0, -10, 300, 12, 3)).toBe(0.1); // the fine window: 100 px per second
    expect(nudgeShift(0.05, -0.1, 12)).toBe(0); expect(nudgeShift(0.1, 0.01, 12)).toBe(0.11);
    expect(windowFor(0.3, 0)).toBe(3); expect(windowFor(2, 1)).toBe(8); expect(windowFor(8, 4)).toBe(26);
    expect(shiftFromDrag(2, -50, 0, 12)).toBe(2);
  });
  it('times the start of a fade instead of waiting for the next report', () => {
    expect(fadeDelayMs(4, 9, 0)).toBe(null);       // 5 s away
    expect(fadeDelayMs(4, 4.5, 0)).toBe(500);
    expect(fadeDelayMs(4, 5.2, 2)).toBe(0);        // the 6 s point has passed: start now
  });
});

import { describe, expect, it } from 'vitest';
import { editionFor, EDITION_YEARS } from '../src/lib/wrappedEditions.ts';

describe('Wrapped editions', () => {
  it('every known year has its own screens, and always opens and closes the same way', () => {
    for (const y of EDITION_YEARS) { const e = editionFor(y); expect(e.slides[0]).toBe('intro'); expect(e.slides.at(-1)).toBe('summary'); expect(new Set(e.slides).size).toBe(e.slides.length); expect(e.palette.length).toBeGreaterThan(0); }
  });
  it('years are not all the 2025 format', () => {
    expect(editionFor(2019).slides).toContain('decades');
    expect(editionFor(2019).slides).not.toContain('race');
    expect(editionFor(2022).slides).toContain('personality');
    expect(editionFor(2024).slides).toContain('phases');
    expect(editionFor(2016).slides).not.toContain('personality');
    expect(editionFor(2025).slides.length).toBeGreaterThan(editionFor(2018).slides.length);
  });
  it('years after the last known one carry the newest format, and before 2016 it is the plain Year in Music', () => {
    expect(editionFor(2031).slides).toEqual(editionFor(2025).slides);
    expect(editionFor(2012).name).toBe('Year in Music');
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_WIDGET, widgetUrl } from '../src/lib/widgetUrl.ts';

describe('widgetUrl', () => {
  it('carries only the token for the defaults', () => {
    expect(widgetUrl('http://pi:47813/', 'tok', { ...DEFAULT_WIDGET, glow: false })).toBe('http://pi:47813/widget?token=tok');
  });
  it('adds just the options that differ', () => {
    const u = new URL(widgetUrl('http://pi:47813', 'a b', { ...DEFAULT_WIDGET, skin: 'discord', cover: 'vinyl', blur: true, accent: '#ff0000', songChange: 10, hidePaused: true, scale: 1.5, progress: false, idle: 'brb' }));
    expect(u.searchParams.get('token')).toBe('a b');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ skin: 'discord', cover: 'vinyl', glow: '1', blur: '1', accent: 'ff0000', songchange: '10', hide: 'paused', scale: '1.5', progress: '0', idle: 'brb' });
  });
});

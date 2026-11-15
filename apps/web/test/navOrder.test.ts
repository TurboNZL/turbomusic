import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER, DEFAULT_PHONE_TABS, MAX_PHONE_TABS, move, orderNav, phoneTabs } from '../src/lib/navOrder.ts';

const nav = DEFAULT_ORDER.map((to) => ({ to }));
describe('navigation order', () => {
  it('keeps the default without a saved order and follows a saved one', () => {
    expect(orderNav(nav, undefined)).toEqual(nav);
    expect(orderNav(nav, ['/settings', '/', '/albums']).slice(0, 3).map((n) => n.to)).toEqual(['/settings', '/', '/albums']);
  });
  it('puts a page the saved order never saw after the page before it, and drops pages that are gone', () => {
    const saved = DEFAULT_ORDER.filter((to) => to !== '/notes' && to !== '/queue').concat('/gone');
    const out = orderNav(nav, saved).map((n) => n.to);
    expect(out.includes('/gone')).toBe(false);
    expect(out.indexOf('/queue')).toBe(out.indexOf('/playlists') + 1);
    expect(out.indexOf('/notes')).toBe(out.indexOf('/queue') + 1);
    expect(out).toHaveLength(nav.length);
  });
  it('chooses the phone tabs, never Settings and never more than the bar holds', () => {
    expect([...phoneTabs(DEFAULT_ORDER, undefined)]).toEqual(DEFAULT_PHONE_TABS);
    expect(phoneTabs(DEFAULT_ORDER, ['/settings', '/stats', '/notes']).has('/settings')).toBe(false);
    expect(phoneTabs(DEFAULT_ORDER, DEFAULT_ORDER).size).toBeLessThanOrEqual(MAX_PHONE_TABS);
  });
  it('moves one place and stops at the ends', () => {
    expect(move(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(move(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
});

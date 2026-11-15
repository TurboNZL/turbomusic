/**
 * The order of the pages in the navigation (the side bar, the top bar, the dock and the phone's bottom bar) and which of them sit in the
 * phone's bottom bar (the rest are under "More"). Both are the user's choice, kept per device.
 */
export const DEFAULT_ORDER = ['/', '/albums', '/singles', '/eras', '/artists', '/tracks', '/vote', '/playlists', '/queue', '/notes', '/discover', '/stats', '/health', '/settings'];
/** the bottom bar of a phone: up to this many pages, then More */
export const MAX_PHONE_TABS = 5;
export const DEFAULT_PHONE_TABS = ['/', '/albums', '/artists', '/tracks', '/vote'];

/** `items` in the saved order; pages that were saved but no longer exist are dropped and new pages go where the default order has them (after the page before them). */
export function orderNav<T extends { to: string }>(items: T[], saved: string[] | undefined): T[] {
  if (!saved?.length) return items;
  const pos = new Map(saved.map((to, i) => [to, i]));
  const out = items.filter((n) => pos.has(n.to)).sort((a, b) => pos.get(a.to)! - pos.get(b.to)!);
  for (const n of items) {
    if (pos.has(n.to)) continue;
    // a page the saved list has never seen (added in an update): after the page that precedes it in the default order, else at the end
    const before = DEFAULT_ORDER[DEFAULT_ORDER.indexOf(n.to) - 1];
    const at = out.findIndex((x) => x.to === before);
    out.splice(at >= 0 ? at + 1 : out.length, 0, n);
  }
  return out;
}

/** The pages in the phone's bottom bar: the saved choice (at most MAX_PHONE_TABS, only pages that exist), else the default. Settings is never in the bar: it has its own button in More. */
export function phoneTabs(valid: string[], saved: string[] | undefined): Set<string> {
  const pick = (saved?.length ? saved : DEFAULT_PHONE_TABS).filter((to) => valid.includes(to) && to !== '/settings').slice(0, MAX_PHONE_TABS);
  return new Set(pick.length ? pick : DEFAULT_PHONE_TABS);
}

/** Move `to` one place up or down in `order`. */
export function move(order: string[], to: string, by: -1 | 1): string[] {
  const i = order.indexOf(to), j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

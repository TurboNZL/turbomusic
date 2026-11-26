import { RotateCcw } from 'lucide-react';
import { Sortable } from './Sortable.tsx';
import { useStore } from '../lib/store.ts';
import { NAV_BASE } from './Layout.tsx';
import { MAX_PHONE_TABS, orderNav, phoneTabs } from '../lib/navOrder.ts';
import { cn } from '../lib/cn.ts';

/** Settings > Appearance: put the pages in the order you use them, and choose which ones are tabs on a phone (the rest are under More). */
export function NavOrderCard() {
  const { settings, updateSettings } = useStore();
  const items = orderNav(NAV_BASE, settings.navOrder);
  const order = items.map((n) => n.to);
  const tabs = phoneTabs(order, settings.phoneTabs);
  const full = tabs.size >= MAX_PHONE_TABS;
  const setOrder = (next: string[]) => updateSettings({ navOrder: next });
  const toggleTab = (to: string) => {
    const next = new Set(tabs);
    if (next.has(to)) next.delete(to); else next.add(to);
    updateSettings({ phoneTabs: order.filter((x) => next.has(x)) }); // kept in the order of the pages, so the bar reads like the list
  };
  const byTo = new Map(items.map((n) => [n.to, n]));
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Drag the grip to put the pages in the order you use them (the side bar, top bar, dock and phone follow it). Tick the phone to keep a page as a tab in the phone's bottom bar: up to {MAX_PHONE_TABS}, the rest are under More.</p>
      <Sortable items={order} keyOf={(to) => to} onReorder={setOrder} className="divide-y divide-line/60 overflow-hidden rounded-theme border border-line" rowClass="bg-surface"
        render={(to, { handle }) => {
          const { label, icon: Icon } = byTo.get(to)!;
          const locked = to === '/settings' || (!tabs.has(to) && full);
          return (
            <div className="flex items-center gap-2 px-2 py-1 text-sm">
              {handle}<Icon size={15} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate">{label}</span>
              <button type="button" role="switch" aria-checked={tabs.has(to)} disabled={locked} onClick={() => toggleTab(to)} title={to === '/settings' ? 'Settings is always under More on a phone' : tabs.has(to) ? 'A tab in the phone bar (click to move it under More)' : full ? `The phone bar is full (${MAX_PHONE_TABS})` : 'Show as a tab in the phone bar'}
                className={cn('chip !gap-1 !px-2 !py-0.5 text-[11px] disabled:opacity-40', tabs.has(to) ? 'border border-accent text-accent' : 'border border-line text-muted')}>{tabs.has(to) ? 'Phone tab' : 'More'}</button>
            </div>);
        }} />
      <button className="btn !py-1 text-sm" disabled={!settings.navOrder && !settings.phoneTabs} onClick={() => updateSettings({ navOrder: undefined, phoneTabs: undefined })}><RotateCcw size={14} />Back to the usual order</button>
    </div>
  );
}

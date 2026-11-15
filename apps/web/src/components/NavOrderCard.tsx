import { ArrowDown, ArrowUp, RotateCcw, Smartphone } from 'lucide-react';
import { useStore } from '../lib/store.ts';
import { NAV_BASE } from './Layout.tsx';
import { MAX_PHONE_TABS, move, orderNav, phoneTabs } from '../lib/navOrder.ts';
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
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Put the pages in the order you use them. The side bar, top bar and dock follow it, and so do the tabs on a phone: tick up to {MAX_PHONE_TABS} to keep in the bottom bar; the rest are under More.</p>
      <ul className="divide-y divide-line/60 rounded-theme border border-line">
        {items.map(({ to, label, icon: Icon }, i) => (
          <li key={to} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <Icon size={16} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate">{label}</span>
            <label className={cn('flex items-center gap-1.5 text-xs', to === '/settings' || (!tabs.has(to) && full) ? 'opacity-40' : 'text-muted')} title={to === '/settings' ? 'Settings is always under More on a phone' : 'Show as a tab in the bottom bar of a phone'}>
              <input type="checkbox" checked={tabs.has(to)} disabled={to === '/settings' || (!tabs.has(to) && full)} onChange={() => toggleTab(to)} /><Smartphone size={13} />
            </label>
            <button className="p-1 text-muted hover:text-fg disabled:opacity-30" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => setOrder(move(order, to, -1))}><ArrowUp size={15} /></button>
            <button className="p-1 text-muted hover:text-fg disabled:opacity-30" aria-label={`Move ${label} down`} disabled={i === items.length - 1} onClick={() => setOrder(move(order, to, 1))}><ArrowDown size={15} /></button>
          </li>))}
      </ul>
      <button className="btn" disabled={!settings.navOrder && !settings.phoneTabs} onClick={() => updateSettings({ navOrder: undefined, phoneTabs: undefined })}><RotateCcw size={15} />Back to the usual order</button>
    </div>
  );
}

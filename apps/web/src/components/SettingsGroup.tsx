import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn.ts';

/**
 * One block of a long settings tab: an icon, a title and a one-line summary on top, the controls below with room around them.
 * `collapsible` folds it to just the header (the summary stays), so a tab with five of these reads as five lines, not a wall.
 */
export function SettingsGroup({ icon, title, hint, children, collapsible = false, defaultOpen = true, badge }: { icon: ReactNode; title: string; hint?: ReactNode; children: ReactNode; collapsible?: boolean; defaultOpen?: boolean; badge?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const head = (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-theme bg-accent/15 text-accent" aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{title}</h3>{badge}</div>{hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}</div>
      {collapsible && <ChevronDown size={16} className={cn('mt-2 shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden />}
    </div>
  );
  return (
    <section className="space-y-4 rounded-theme border border-line p-4 sm:p-5">
      {collapsible ? <button type="button" className="block w-full text-left" aria-expanded={open} onClick={() => setOpen(!open)}>{head}</button> : head}
      {(!collapsible || open) && <div className="space-y-4 text-sm sm:pl-12">{children}</div>}
    </section>
  );
}

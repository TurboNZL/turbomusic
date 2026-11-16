import { Pause, Play, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Track } from '../lib/derive.ts';
import type { PreviewState } from '../lib/usePreviews.ts';
import { ArtistLinks } from './ArtistLinks.tsx';
import { Cover } from './Cover.tsx';
import { cn } from '../lib/cn.ts';

/**
 * A track as the Rank page shows it, small: the cover is the preview button (tap it, or the card, to hear 15 s from the middle), with
 * the title, the artist and a line saying whether the preview is ready. `children` are the buttons that answer the question.
 */
export function PreviewCard({ t, preview, badge, accent, children }: { t: Track; preview: PreviewState; badge?: ReactNode; accent?: boolean; children?: ReactNode }) {
  const on = preview.playing === t.id;
  return (
    // the whole card previews (like the Rank page); only the buttons, links and inputs on it keep their own clicks
    <div data-selected={on || undefined} className={cn('card bt-sel flex min-w-0 flex-col gap-2 p-3', t.file && 'cursor-pointer', accent && 'ring-1 ring-accent/40')}
      onClick={(e) => { if (t.file && !(e.target as HTMLElement).closest('a, button, input, select, textarea')) preview.toggle(t); }}>
      <button type="button" disabled={!t.file} aria-pressed={on} aria-label={`${on ? 'Stop preview of' : 'Preview'} ${t.title}`} onClick={() => preview.toggle(t)}
        className="relative mx-auto block aspect-square w-full max-w-[9.5rem] disabled:cursor-default">
        <Cover hash={t.cover} seed={t.albumTitle ?? t.title} className="h-full w-full" />
        {on && <span className="absolute inset-0 flex items-center justify-center rounded-theme bg-black/40 text-white"><Volume2 className="animate-pulse" size={24} /></span>}
        {badge && <span className="chip absolute left-1 top-1 bg-black/70 text-white">{badge}</span>}
      </button>
      <div className="min-w-0 text-center">
        <div className="truncate text-sm font-semibold" title={t.title}>{t.title}</div>
        <div className="truncate text-xs text-muted"><ArtistLinks leads={t.leads} featured={t.featured} /></div>
        <div className="mt-0.5 text-[11px] text-muted" aria-hidden>
          {!t.file ? 'No audio yet' : on ? <span className="inline-flex items-center gap-1"><Pause size={10} />Tap to stop</span>
            : <span className="inline-flex items-center gap-1"><Play size={10} />Tap the card: 15 s</span>}
        </div>
      </div>
      {children && <div className="mt-auto flex flex-col gap-1.5">{children}</div>}
    </div>
  );
}

import { Check, Pause, Play, ThumbsDown, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Track } from '../lib/derive.ts';
import type { PreviewState } from '../lib/usePreviews.ts';
import { ArtistLinks } from './ArtistLinks.tsx';
import { Cover } from './Cover.tsx';
import { cn } from '../lib/cn.ts';
import { useMenu } from './Menu.tsx';
import { useTrackMenuItems } from './TrackMenu.tsx';
import { usePlayer } from '../lib/player.ts';

/**
 * A track as the Rank page shows it, small: the cover is the preview button (tap it, or the card, to hear 15 s from the middle), with
 * the title, the artist and a line saying whether the preview is ready. `children` are the buttons that answer the question.
 */
/** `fx` plays the answer's animation on the card (the same motion as the Rank page): chosen, passed over, or a draw */
export function PreviewCard({ t, preview, badge, accent, fx, children }: { t: Track; preview: PreviewState; badge?: ReactNode; accent?: boolean; fx?: 'win' | 'lose' | 'equal' | 'down' | null; children?: ReactNode }) {
  const on = preview.playing === t.id;
  // right-click (or press and hold) opens the track's usual menu; the artist's name is plain text here so a stray tap never leaves the page
  const menu = useMenu();
  const items = useTrackMenuItems();
  const play = usePlayer((st) => st.play);
  return (
    // the whole card previews (like the Rank page); only the buttons, links and inputs on it keep their own clicks
    <div data-selected={on || undefined} className={cn('card bt-sel flex min-w-0 flex-col gap-2 p-3', t.file && 'cursor-pointer', accent && 'ring-1 ring-accent/40', fx === 'win' && 'bt-vote-win', (fx === 'lose' || fx === 'down') && 'bt-vote-lose', fx === 'equal' && 'bt-vote-equal', fx && 'pointer-events-none')}
      onContextMenu={menu.onContextMenu(items(t, () => play(t.id, [t.id], { type: 'search', id: 'Sharpen' })), t.title)}
      onClick={(e) => { if (!fx && t.file && !(e.target as HTMLElement).closest('a, button, input, select, textarea')) preview.toggle(t); }}>
      <button type="button" disabled={!t.file} aria-pressed={on} aria-label={`${on ? 'Stop preview of' : 'Preview'} ${t.title}`} onClick={() => preview.toggle(t)}
        className="relative mx-auto block aspect-square w-full max-w-[9.5rem] disabled:cursor-default">
        <Cover hash={t.cover} seed={t.albumTitle ?? t.title} className="h-full w-full" />
        {on && <span className="absolute inset-0 flex items-center justify-center rounded-theme bg-black/40 text-white"><Volume2 className="animate-pulse" size={24} /></span>}
        {fx === 'win' && <span className="absolute inset-0 flex items-center justify-center rounded-theme bg-accent/45 text-accent-fg"><Check className="bt-vote-check" size={36} strokeWidth={3} /></span>}
        {fx === 'down' && <span className="absolute inset-0 flex items-center justify-center rounded-theme bg-black/50 text-white"><ThumbsDown className="bt-vote-check" size={30} /></span>}
        {/* inset by the theme's corner radius, so a round look does not push the label into the curve */}
        {badge && <span className="chip absolute bg-black/70 text-white" style={{ left: 'calc(var(--radius, 8px) * 0.4 + 4px)', top: 'calc(var(--radius, 8px) * 0.4 + 4px)' }}>{badge}</span>}
      </button>
      <div className="min-w-0 text-center">
        <div className="truncate text-sm font-semibold" title={t.title}>{t.title}</div>
        <div className="truncate text-xs text-muted"><ArtistLinks leads={t.leads} featured={t.featured} plain /></div>
        <div className="mt-0.5 text-[11px] text-muted" aria-hidden>
          {!t.file ? 'No audio yet' : on ? <span className="inline-flex items-center gap-1"><Pause size={10} />Tap to stop</span>
            : <span className="inline-flex items-center gap-1"><Play size={10} />Tap the card: 15 s</span>}
        </div>
      </div>
      {children && <div className="mt-auto flex flex-col gap-1.5">{children}</div>}
      {menu.element}
    </div>
  );
}

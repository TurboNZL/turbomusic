import { useState, type ReactNode } from 'react';
import { BarChart3, Check, Play, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react';
import type { Track } from '../lib/derive.ts';
import { cn } from '../lib/cn.ts';
import { useSwipe, type SwipeDir } from '../lib/useSwipe.ts';
import { ArtistLinks } from './ArtistLinks.tsx';
import { Cover } from './Cover.tsx';

export type CardFx = 'win' | 'lose' | 'equal' | 'down' | null;

/** What a swipe on a card means: the words stamped on it as it is dragged, and which ways count. */
export interface SwipeSpec { dirs: 'both' | 'right'; right: string; left?: string; tone?: 'pick' | 'bad'; onSwipe: (dir: SwipeDir) => void }

/**
 * The one card every ranking question uses (head to head, best of three or four, odd one out, the top-10% line, gut check), so they all look
 * and behave the same: the cover is as large as the card allows with the title and artist small beneath it and one small button; tapping the
 * card previews 15 s; with `swipe` it can be dragged like a card (see `useSwipe`) and stamped with what the swipe will do.
 * The card sizes itself to the box it is in (container query units), so a parent only has to give it a height.
 */
export function RankCard({ t, playing, onPreview, badge, fx, swipe, action, onMenu, onStats, compact = false, accent = false, className }: {
  t: Track; playing: boolean; onPreview: () => void; badge?: ReactNode; fx?: CardFx; swipe?: SwipeSpec | null; action?: ReactNode;
  onMenu?: (e: React.MouseEvent) => void; onStats?: () => void; compact?: boolean; accent?: boolean; className?: string;
}) {
  const [flung, setFlung] = useState(false); // a card that flew off has its own motion: the win animation must not fight it
  const sw = useSwipe({ dirs: swipe?.dirs ?? 'right', onCommit: (d) => { setFlung(true); swipe?.onSwipe(d); } });
  const bad = swipe?.tone === 'bad';
  return (
    <div role="button" tabIndex={0} aria-pressed={playing} aria-label={`${playing ? 'Stop preview of' : 'Preview'} ${t.title}`} onContextMenu={onMenu}
      onClick={(e) => { if (sw.swallowClick() || fx || (e.target as Element).closest('a, button, input')) return; onPreview(); }}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (!fx) onPreview(); } }}
      {...(swipe ? sw.bind : {})}
      style={{ touchAction: swipe ? 'none' : undefined, transformOrigin: '50% 115%', willChange: swipe ? 'transform' : undefined, ['--band' as string]: compact ? '2.1rem' : '3rem' }}
      data-selected={playing || undefined}
      className={cn('card bt-sel vote-card relative min-h-0 min-w-0 cursor-pointer select-none overflow-hidden [container-type:size]', !t.file && 'cursor-default', accent && 'ring-1 ring-accent/40',
        fx === 'win' && !flung && 'bt-vote-win', (fx === 'lose' || fx === 'down') && 'bt-vote-lose', fx === 'equal' && 'bt-vote-equal', className)}>
      {/* the cover's own colours, blurred, fill what the square leaves */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-40" aria-hidden><Cover hash={t.cover} seed={t.albumTitle ?? t.title} className="absolute left-1/2 top-1/2 !w-[170%] -translate-x-1/2 -translate-y-1/2 blur-2xl" radius="0" /></div>
      <div className="rk-body">
        <div className="rk-coverbox">
          <div className="rk-cover relative">
            <Cover hash={t.cover} seed={t.albumTitle ?? t.title} className="h-full w-full">
            {!playing && t.file && <span className="absolute inset-0 flex items-center justify-center text-white/0 transition-colors" aria-hidden><span className="grid h-10 w-10 place-items-center rounded-full bg-black/35 text-white/80 backdrop-blur-sm"><Play size={18} fill="currentColor" /></span></span>}
            {playing && <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white"><Volume2 className="animate-pulse" size={28} /></span>}
            {(fx === 'win') && <span className="absolute inset-0 flex items-center justify-center bg-accent/45 text-accent-fg"><Check className="bt-vote-check" size={44} strokeWidth={3} /></span>}
            {fx === 'down' && <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white"><ThumbsDown className="bt-vote-check" size={34} /></span>}
            </Cover>
            {badge && <span className="chip absolute bg-black/70 text-[11px] text-white" style={{ left: 'calc(var(--radius, 8px) * 0.4 + 4px)', top: 'calc(var(--radius, 8px) * 0.4 + 4px)' }}>{badge}</span>}
            {onStats && <button type="button" className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white/90 hover:bg-black/70" title="Stats" aria-label={`Stats for ${t.title}`} onClick={(e) => { e.stopPropagation(); onStats(); }}><BarChart3 size={14} /></button>}
            {swipe && <>
              <Stamp side="r" tone={bad ? 'bad' : 'pick'}>{swipe.right}</Stamp>
              {(swipe.dirs === 'both') && <Stamp side="l" tone={bad ? 'bad' : swipe.left && swipe.left !== swipe.right ? 'meh' : 'pick'}>{swipe.left ?? swipe.right}</Stamp>}
            </>}
          </div>
        </div>
        <div className="rk-text">
          <div className="rk-names min-w-0 flex-1 leading-tight">
            <div className="rk-title truncate text-[13px] font-semibold" title={t.title}>{t.title}</div>
            {!compact && <div className="rk-sub truncate text-[11px] text-muted"><ArtistLinks leads={t.leads} featured={t.featured} plain />{t.albumTitle && ` · ${t.albumTitle}`}</div>}
          </div>
          {action}
        </div>
      </div>
    </div>
  );
}

/** The word that fades in on a card as it is dragged towards a side (--sw-r / --sw-l are set by useSwipe). */
function Stamp({ side, tone, children }: { side: 'l' | 'r'; tone: 'pick' | 'bad' | 'meh'; children: ReactNode }) {
  const Icon = tone === 'bad' || tone === 'meh' ? ThumbsDown : children === 'LOVE' ? ThumbsUp : Check;
  return (
    <span aria-hidden className={cn('pointer-events-none absolute top-[36%] flex items-center gap-1 rounded-theme border-2 px-2 py-0.5 text-sm font-extrabold uppercase tracking-wider',
      side === 'r' ? 'left-3' : 'right-3',
      tone === 'pick' ? 'border-accent bg-black/45 text-accent' : tone === 'bad' ? 'border-bad bg-black/45 text-bad' : 'border-white/80 bg-black/45 text-white')}
      style={{ opacity: `var(--sw-${side}, 0)`, transform: `scale(calc(0.8 + var(--sw-${side}, 0) * 0.3)) rotate(${side === 'r' ? -12 : 12}deg)` }}><Icon size={14} strokeWidth={3} />{children}</span>
  );
}

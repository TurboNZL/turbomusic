import { Star } from 'lucide-react';
import type { Track } from '../lib/derive.ts';
import { cn } from '../lib/cn.ts';

/** Same behaviour as the original: '?' until rated, #rank for 10-star tracks, colour by band. */
export function Rating({ track, size = 'md' }: { track: Track; size?: 'sm' | 'md' | 'lg' }) {
  const r = track.effectiveRating;
  const unrated = r < 0.001;
  const label = unrated && track.comparisons < 3 ? '?' : track.tenStarRank ? `#${track.tenStarRank}` : r.toFixed(1);
  const color = unrated ? 'text-muted' : track.tenStarRank ? 'text-top' : r >= 7 ? 'text-good' : r >= 4 ? 'text-warn' : 'text-bad';
  return (
    <span title={`${track.comparisons} comparisons · score ${Math.round(track.elo)}${track.thumbs ? ` · ${track.thumbs > 0 ? '+' : ''}${track.thumbs} thumbs` : ''}`}
      className={cn('inline-flex items-center gap-1 rounded-full border border-line bg-surface font-bold tabular-nums', color,
        size === 'sm' && 'h-6 px-2 text-[10px]', size === 'md' && 'h-7 px-2.5 text-xs', size === 'lg' && 'h-8 px-3 text-sm')}>
      <Star size={size === 'sm' ? 10 : 12} fill="currentColor" className="opacity-60" />
      {label}
      {track.comparisons > 0 && <span className="ml-0.5 font-mono text-[10px] font-normal text-muted">{track.comparisons}</span>}
    </span>
  );
}

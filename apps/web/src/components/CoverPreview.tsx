import { Info, Maximize2, Volume2 } from 'lucide-react';
import { usePlaybackView } from '../lib/connect.ts';
import { usePlayer } from '../lib/player.ts';
import { cn, fmtTime } from '../lib/cn.ts';
import type { Track } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { usePopups } from '../lib/popups.ts';
import { ArtistLinks } from './ArtistLinks.tsx';
import { Cover } from './Cover.tsx';
import { Popover } from './Popover.tsx';
import { Rating } from './Rating.tsx';
import { RateBlock } from './RateBlock.tsx';

/**
 * The now-playing card: the cover enlarged, grown out of the small one in the player bar (the UI style's own
 * pop-up animation). On a phone it is centred above the bar and also carries the thumbs and memories, which the
 * narrow bar has no room for.
 */
export function CoverPreview({ anchor, track }: { anchor: HTMLElement | null; track?: Track }) {
  const open = usePopups((s) => s.coverOpen);
  const close = usePopups((s) => s.closeCover);
  const edit = useEditor((s) => s.open);
  const v = usePlaybackView();
  const pct = (x: number, max: number) => ({ '--p': `${max > 0 ? Math.min(100, (x / max) * 100) : 0}%` }) as React.CSSProperties;
  return (
    <Popover open={open && !!track} anchor={anchor} onClose={close} label="Now playing" className="w-[min(22rem,calc(100vw-1.5rem))] p-3">
      {track && <div className="flex flex-col gap-3">
        <Cover hash={track.cover} seed={track.albumTitle ?? track.title} className="mx-auto w-full max-w-[19rem]" />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold">{track.title}</div>
            <div className="truncate text-sm text-muted"><ArtistLinks leads={track.leads} featured={track.featured} className="hover:underline" />{track.albumTitle && ` · ${track.albumTitle}`}</div>
            <div className="mt-2 flex items-center gap-2"><Rating track={track} /><button type="button" className="btn btn-ghost !p-1.5" title="Track info" aria-label="Track info" onClick={() => { close(); edit({ kind: 'track-details', id: track.id }); }}><Info size={16} /></button>
              <button type="button" className="btn btn-ghost !p-1.5" title="Now playing: cover and lyrics (F11 for full screen)" aria-label="Full screen now playing" onClick={() => usePopups.getState().setNow(true)}><Maximize2 size={16} /></button></div>
          </div>
          <RateBlock track={track} />
        </div>
        {/* the bar has no room for these on a phone */}
        <div className="flex flex-col gap-2 md:hidden">
          <div className="flex items-center gap-2 text-xs tabular-nums text-muted">
            <span className="w-9 text-right">{fmtTime(v.time)}</span>
            <input type="range" aria-label="Seek" className="bt-range bt-hit flex-1" style={pct(v.time, v.duration)} min={0} max={v.duration || 1} step={0.1} value={v.time} onChange={(e) => v.seek(Number(e.target.value))} />
            <span className="w-9">{fmtTime(v.duration)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Volume2 size={16} className="shrink-0 text-muted" />
            <input type="range" aria-label="Volume" className="bt-range bt-hit flex-1" style={pct(v.volume, 1)} min={0} max={1} step={0.01} value={v.volume} onChange={(e) => v.setVolume(Number(e.target.value))} />
          </div>
        </div>
      </div>}
    </Popover>
  );
}

import { Disc3, User } from 'lucide-react';
import { useLibrary } from '../lib/derive.ts';
import { useFileUrl } from '../lib/files.ts';
import { defaultImage } from '../lib/profile.ts';
import { cn } from '../lib/cn.ts';
import { useStaticRender } from '../lib/staticRender.ts';

/** Deterministic gradient so cover-less items still look distinct and stable. */
function gradient(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `linear-gradient(135deg, hsl(${h % 360} 45% 38%), hsl(${(h * 7) % 360} 50% 22%))`;
}

export function Cover({ hash, seed, kind = 'album', className, radius }: { hash: string | null | undefined; seed: string; kind?: 'album' | 'artist'; className?: string; /** a corner radius of its own (the phone player bar's cover follows the bar's roundness) */ radius?: string }) {
  const Icon = kind === 'artist' ? User : Disc3;
  const fallback = defaultImage(useLibrary(), kind === 'artist' ? 'defaultArtistImage' : 'defaultAlbumCover');
  const url = useFileUrl(hash || fallback);
  const still = useStaticRender(); // the copy that becomes a picture must load every image now, not when scrolled near
  return (
    <div data-kind={kind} className={cn('bt-cover relative aspect-square overflow-hidden bg-raised', kind === 'artist' ? 'rounded-full' : 'rounded-theme', className)}
      // a round look's big corner radius must not turn a small cover into a circle: never more than a fifth of the cover's size
      style={{ ...(kind === 'album' ? { borderRadius: radius ?? 'min(var(--radius, 0.5rem), 22%)' } : null), ...(url ? null : { backgroundImage: gradient(seed) }) }}>
      {url
        ? <img src={url} alt="" loading={still ? 'eager' : 'lazy'} className="h-full w-full object-cover" />
        : <Icon className="absolute inset-0 m-auto h-1/3 w-1/3 text-white/40" strokeWidth={1.25} />}
    </div>
  );
}

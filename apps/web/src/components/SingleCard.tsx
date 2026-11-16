import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import { statsPath } from '../lib/entityStats.ts';
import { canPlay } from '../lib/spotifyPlayer.ts';
import type { Track } from '../lib/derive.ts';
import { usePlayer } from '../lib/player.ts';
import { useEditor } from '../lib/editor.ts';
import { Cover } from './Cover.tsx';
import { ArtistLinks } from './ArtistLinks.tsx';
import { Rating } from './Rating.tsx';
import { useMenu } from './Menu.tsx';
import { useTrackMenuItems } from './TrackMenu.tsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2024-05-17 -> 17 May 2024; a year or a month alone is shown as far as it goes. */
export function fmtDate(d: string): string {
  const [y, m, day] = d.split('-');
  return [day && Number(day) ? String(Number(day)) : '', m && MONTHS[Number(m) - 1] ? MONTHS[Number(m) - 1] : '', y].filter(Boolean).join(' ');
}

type MenuApi = ReturnType<typeof useMenu>;
/** One single as a cover tile. The parent owns the shared context menu (`menu`, `itemsFor`) and the list that Play queues (`ids`). */
export function SingleTile({ t, ids, menu, itemsFor }: { t: Track; ids: string[]; menu: MenuApi; itemsFor: ReturnType<typeof useTrackMenuItems> }) {
  const play = usePlayer((s) => s.play);
  const edit = useEditor((s) => s.open);
  const run = () => play(t.id, ids, { type: 'search', id: 'Singles' });
  return (
    <div className="bt-tile group" onContextMenu={(e) => menu.onContextMenu(itemsFor(t, run), `Actions for ${t.title}`, t.id)(e)}>
      <div className="relative">
        <Link to={statsPath('track', t.id)} aria-label={`Open ${t.title}`} className="block"><Cover hash={t.cover} seed={t.title} className="transition-transform group-hover:scale-[1.02]" /></Link>
        <button className="btn btn-accent absolute bottom-2 right-2 !rounded-full !p-2.5 opacity-0 shadow-lg transition-opacity focus-visible:opacity-100 group-hover:opacity-100" disabled={!t.file}
          aria-label={`Play ${t.title}`} title={t.file ? 'Play' : 'No audio file yet'} onClick={run}><Play size={16} fill="currentColor" /></button>
      </div>
      <Link to={statsPath('track', t.id)} className="bt-cap-t mt-2 block w-full truncate text-left text-sm font-medium hover:underline" title="Open this single (its stats: it has no album page)">{t.title}</Link>
      <div className="bt-cap flex items-center justify-between gap-2 text-xs text-muted"><span className="truncate"><ArtistLinks leads={t.leads} featured={t.featured} /></span><Rating track={t} size="sm" /></div>
      <div className="bt-cap truncate text-xs text-muted" title={t.releaseDate ? `Released ${t.releaseDate}` : 'No release date yet'}>{t.releaseDate ? fmtDate(t.releaseDate) : <button className="hover:text-fg hover:underline" onClick={() => edit({ kind: 'track', id: t.id })}>No date</button>}</div>
    </div>
  );
}

/** A track that is not on an album, shown as a cover card. Click plays it; right-click or ⋯ has the usual track menu. */
export function SingleGrid({ tracks }: { tracks: Track[] }) {
  const menu = useMenu();
  const itemsFor = useTrackMenuItems();
  const ids = tracks.filter(canPlay).map((t) => t.id);
  return (
    <>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(var(--grid-min), 1fr))' }}>
        {tracks.map((t) => <SingleTile key={t.id} t={t} ids={ids} menu={menu} itemsFor={itemsFor} />)}
      </div>
      {menu.element}
    </>
  );
}

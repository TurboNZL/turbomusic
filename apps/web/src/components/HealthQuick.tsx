import { useState } from 'react';
import { Check } from 'lucide-react';
import type { HealthCheck, HealthItem } from '../lib/health.ts';
import { useLibrary } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { useEditor } from '../lib/editor.ts';
import { TagInput } from './forms.tsx';

type Quick = NonNullable<HealthCheck['quick']>;
const LINK: Record<string, string> = { youtubeMusicUrl: 'Paste a YouTube Music link', spotifyUrl: 'Paste a Spotify link', geniusUrl: 'Paste a Genius link' };

/** One row that can be fixed right there: a date, genres or a link. The row leaves the list as soon as the check passes. */
function QuickRow({ item, quick }: { item: HealthItem; quick: Quick }) {
  const lib = useLibrary();
  const { patch, put } = useStore();
  const edit = useEditor((s) => s.open);
  const [value, setValue] = useState('');
  const [genres, setGenres] = useState<string[]>([]);
  const ensureGenres = (names: string[]) => { const known = new Set(lib.genres.map((g) => g.name.toLowerCase())); for (const n of names) if (!known.has(n.toLowerCase())) { put('genres', { name: n }); known.add(n.toLowerCase()); } };
  const save = () => {
    const v = value.trim();
    if (quick === 'release-date' && v) patch('releases', item.id, { releaseDate: v });
    else if (quick === 'single-date' && v) patch('tracks', item.id, { releaseDate: v });
    else if (quick === 'album-genre' && genres.length) { ensureGenres(genres); patch('albums', item.id, { genres }); }
    else if (quick === 'track-genre' && genres.length) { ensureGenres(genres); patch('tracks', item.id, { genres, syncWithAlbumCredits: false }); }
    else if (LINK[quick] && v) patch('tracks', item.id, { [quick]: v });
  };
  const isGenre = quick === 'album-genre' || quick === 'track-genre';
  const ready = isGenre ? genres.length > 0 : !!value.trim();
  const kind = item.kind === 'track' || item.kind === 'album' || item.kind === 'release' ? item.kind : null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
      <button className="min-w-0 flex-1 basis-48 truncate text-left hover:underline" title="Open the full editor" onClick={() => kind && edit({ kind, id: item.id })}>{item.label}{item.detail && <span className="text-xs text-muted"> · {item.detail}</span>}</button>
      {(quick === 'release-date' || quick === 'single-date') && <input type="date" className="input !w-40 !py-1 text-xs" aria-label="Release date" value={value} onChange={(e) => setValue(e.target.value)} />}
      {isGenre && <div className="w-64 max-w-full"><TagInput value={genres} onChange={setGenres} suggestions={lib.genres.map((g) => g.name)} placeholder="Genre, press Enter" /></div>}
      {LINK[quick] && <input className="input !w-72 max-w-full !py-1 text-xs" placeholder={LINK[quick]} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />}
      {quick === 'youtubeMusicUrl' && item.albumId && <button className="btn btn-ghost !py-1 text-xs" title="This album is not on YouTube Music: move it to its own list" onClick={() => patch('albums', item.albumId!, { noYoutube: true })}>Album not on YouTube Music</button>}
      <button className="btn btn-accent !py-1 text-xs" disabled={!ready} onClick={save}><Check size={13} />Save</button>
    </div>
  );
}

/** The rows of a check that can be fixed in place, 40 at a time. */
export function QuickFix({ check }: { check: HealthCheck }) {
  const [shown, setShown] = useState(40);
  if (!check.quick) return null;
  return (
    <div className="max-h-[28rem] divide-y divide-line/60 overflow-y-auto">
      {check.items.slice(0, shown).map((i) => <QuickRow key={`${i.kind}${i.id}`} item={i} quick={check.quick!} />)}
      {check.items.length > shown && <div className="px-4 py-2"><button className="btn btn-ghost text-xs" onClick={() => setShown(shown + 40)}>Show 40 more ({check.items.length - shown} left)</button></div>}
    </div>
  );
}

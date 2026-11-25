import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { ArtistData, Credit } from '@turbomusic/core';
import { Modal } from './forms.tsx';
import { useLibrary } from '../lib/derive.ts';
import type { Library } from '../lib/library.ts';
import { useStore } from '../lib/store.ts';
import { matchArtist, splitFeaturing } from '../lib/autofill.ts';
import { FEATURED_ROLE, LEAD_ROLE } from '../lib/defaults.ts';
import { parseYtmListing } from '../lib/ytmListing.ts';

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Writes what a listing says into the songs it was matched to: each song's own lead artists, "(feat. …)" moved into Featured artist
 * credits and out of the title, and the song stops following the album's credits. Artists that do not exist yet are created once.
 * A song whose listing names no artist is left alone. Returns how many songs were changed.
 */
export function applyListedCredits(lib: Library, put: (t: 'artists', d: ArtistData) => string, patch: (t: 'tracks', id: string, d: Record<string, unknown>) => void,
  pairs: { l: { title: string; leads: string[]; featured: string[] }; track: { id: string; allGenres: string[] } }[]): number {
  const made = new Map<string, string>();
  const artist = (n: string) => { const k = fold(n); let id = made.get(k) ?? matchArtist(lib.artists, n)?.id; if (!id) id = put('artists', { name: n.trim(), image: null } satisfies ArtistData); made.set(k, id); return id; };
  let n = 0;
  for (const { l, track } of pairs) {
    const credits: Credit[] = [...l.leads.map((x) => ({ artistId: artist(x), role: [LEAD_ROLE] })), ...l.featured.map((x) => ({ artistId: artist(x), role: [FEATURED_ROLE] }))];
    if (!credits.some((c) => c.role.includes(LEAD_ROLE))) continue; // no artist line for it: leave the track alone
    patch('tracks', track.id, { title: l.title, credits, genres: track.allGenres, syncWithAlbumCredits: false });
    n++;
  }
  return n;
}

/**
 * Album ⋯ > "Fix artists from a pasted list": for soundtracks and compilations, where every song has its own artist but the import gave
 * them all the album's. Paste the track list copied from YouTube Music; each song is matched by title and gets its own lead artists,
 * with "(feat. …)" moved into Featured artist credits. Nothing is written until Apply.
 */
export function PasteCreditsDialog({ albumId, onClose }: { albumId: string; onClose: () => void }) {
  const lib = useLibrary();
  const { put, patch } = useStore();
  const album = lib.albumById.get(albumId);
  const [text, setText] = useState('');
  const [done, setDone] = useState<number | null>(null);
  const listed = useMemo(() => parseYtmListing(text), [text]);
  const rows = useMemo(() => {
    if (!album) return [];
    const mine = album.trackIds.flatMap((id) => lib.trackById.get(id) ?? []);
    const used = new Set<string>();
    const byTitle = listed.map((l) => { const t = mine.find((x) => !used.has(x.id) && fold(splitFeaturing(x.title).title) === fold(l.title)); if (t) used.add(t.id); return t; });
    // when every title was left unmatched but the counts agree, trust the order
    const byOrder = listed.length === mine.length && byTitle.every((t) => !t);
    return listed.map((l, i) => ({ l, track: byOrder ? mine[i] : byTitle[i] }));
  }, [listed, album, lib]);
  if (!album) return null;
  const ok = rows.filter((r) => r.track);

  function apply() { setDone(applyListedCredits(lib, put, patch, ok.flatMap((r) => (r.track ? [{ l: r.l, track: r.track }] : [])))); }
  return (
    <Modal title={`Fix artists from a pasted list: ${album.title}`} onClose={onClose} wide
      footer={done !== null ? <button className="btn btn-accent ml-auto" onClick={onClose}>Done</button> : <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-accent ml-auto" disabled={!ok.length} onClick={apply}><Check size={15} />Apply to {ok.length} songs</button></>}>
      <p className="text-sm text-muted">On YouTube Music open the album, select its whole track list, copy it and paste it here. Each song gets its own lead artists; “(feat. …)” becomes Featured artists and leaves the title. The songs stop following the album’s credits.</p>
      <textarea className="input h-32 font-mono text-xs" placeholder="Paste the track list here" value={text} onChange={(e) => setText(e.target.value)} />
      {done !== null && <div className="rounded-theme bg-good/10 p-3 text-sm text-good" role="status">Updated {done} songs.</div>}
      {listed.length > 0 && done === null && <div className="max-h-72 divide-y divide-line/60 overflow-y-auto rounded-theme border border-line text-sm">
        {rows.map(({ l, track }, i) => (
          <div key={i} className="px-3 py-1.5"><div className={track ? 'font-medium' : 'font-medium text-warn'}>{l.title}{!track && ' · no song of the album matches'}</div>
            <div className="text-xs text-muted">{l.leads.join(', ') || 'no artist found'}{l.featured.length ? ` · feat. ${l.featured.join(', ')}` : ''}</div></div>))}
      </div>}
    </Modal>
  );
}

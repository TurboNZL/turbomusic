import { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, ListPlus, Loader2, Play, Sparkles } from 'lucide-react';
import type { SpotifyImportTrack } from '../lib/api.ts';
import { useLibrary } from '../lib/derive.ts';
import { api, useStore } from '../lib/store.ts';
import { mergeSuggestions, tasteSeeds, type Suggestion } from '../lib/recommend.ts';
import { useSpotifyLink } from '../lib/spotifyPlayer.ts';
import { leadCredit, newTrackData } from '../lib/defaults.ts';
import { logJournal } from '../lib/journal.ts';

const KEY = 'turbomusic.discover';
const load = (): { at: number; list: Suggestion[] } | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * "More like what you rate highly". Spotify's own recommendations are closed to new apps, so: your votes pick the seed artists, MusicBrainz and
 * ListenBrainz (open data) name similar artists, and Spotify search finds tracks to hear or add. Nothing is added to your library unless you press Add.
 */
export function SimilarArtists() {
  const lib = useLibrary();
  const { put } = useStore();
  const configured = useStore((s) => !!s.settings.token);
  const signedIn = useSpotifyLink((s) => s.signedIn);
  const deviceId = useStore((s) => s.settings.spotifyDeviceId);
  const [saved] = useState(load);
  const [list, setList] = useState<Suggestion[]>(saved?.list ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noData, setNoData] = useState<string[]>([]);
  const [tracks, setTracks] = useState<Record<string, SpotifyImportTrack[] | 'loading' | string>>({});
  const stop = useRef(false);
  const seeds = useMemo(() => tasteSeeds(lib), [lib]);
  useEffect(() => () => { stop.current = true; }, []);

  async function find() {
    stop.current = false; setError(null); setNoData([]);
    const similar: { name: string; mbid: string; score: number }[][] = [];
    try {
      for (const [i, s] of seeds.entries()) {
        if (stop.current) return;
        setBusy(`Looking up artists like ${s.name}… ${i + 1}/${seeds.length}`);
        similar.push((await api().similarArtists(s.name)).artists);
        await sleep(1100); // MusicBrainz asks for one request a second
      }
      setNoData(seeds.filter((_, i) => !similar[i]?.length).map((s) => s.name));
      const merged = mergeSuggestions(seeds, similar, lib.artists.map((a) => a.name));
      setList(merged);
      try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), list: merged })); } catch { /* storage blocked */ }
      if (!merged.length) setError('Nothing came back. The open services may be busy or not know these artists; try again later.');
    } catch (e) { setError((e as Error).message === 'Failed to fetch' ? 'Cannot reach the server.' : (e as Error).message); }
    finally { setBusy(null); }
  }

  async function listen(s: Suggestion) {
    setTracks((t) => ({ ...t, [s.mbid]: 'loading' }));
    try { const r = await api().spotifySearch(`artist:"${s.name}"`); setTracks((t) => ({ ...t, [s.mbid]: r.tracks.filter((x) => x.artists.some((a) => a.toLowerCase() === s.name.toLowerCase())).slice(0, 5) })); }
    catch (e) { setTracks((t) => ({ ...t, [s.mbid]: (e as Error).message })); }
  }
  async function playOnSpotify(t: SpotifyImportTrack) {
    try { await api().spotifyPlay([t.uri], deviceId); } catch (e) { setError((e as Error).message); }
  }
  function add(s: Suggestion, t: SpotifyImportTrack) {
    const have = lib.artists.find((a) => a.name.toLowerCase() === s.name.toLowerCase());
    const aid = have?.id ?? put('artists', { name: s.name, image: null });
    put('tracks', newTrackData({ title: t.title, credits: leadCredit(aid), spotifyUrl: `https://open.spotify.com/track/${t.id}`, albums: [] }));
    logJournal('add', `Added from Discover: ${t.title}`, s.name);
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted">Artists like the ones you rate highest, from open listening data. Spotify's own recommendations are not available to new apps, so your votes do the choosing.</p></div>
      <section className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Sparkles size={16} className="text-accent" />Your taste</h2>
        {seeds.length ? <div className="flex flex-wrap gap-1.5">{seeds.map((s) => <span key={s.name} className="chip">{s.name}</span>)}</div>
          : <p className="text-sm text-muted">Vote on more tracks first (Rank): artists whose tracks have at least 3 comparisons each and rate well become the seeds (up to 8; the best-rated ones come first).</p>}
        <div className="flex flex-wrap items-center gap-2"><button className="btn btn-accent" disabled={!configured || !seeds.length || !!busy} onClick={() => void find()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Compass size={15} />}Find artists like these</button>
          {busy && <button className="btn" onClick={() => { stop.current = true; setBusy(null); }}>Stop</button>}
          {saved && !busy && <span className="text-xs text-muted">last run {new Date(saved.at).toLocaleDateString()}</span>}</div>
        {busy && <div className="text-sm text-muted" role="status">{busy}</div>}
        {!configured && <div className="text-xs text-muted">Needs your server (Settings).</div>}
        {noData.length > 0 && !busy && <div className="text-xs text-muted">The open data has nothing for {noData.join(', ')} (no match on MusicBrainz, or too few listeners on ListenBrainz); the others were used.</div>}
        {error && <div className="rounded-theme bg-bad/15 p-3 text-sm text-bad">{error}</div>}
      </section>
      {list.length > 0 && <section className="space-y-2">
        {list.map((s) => {
          const t = tracks[s.mbid];
          return (
            <div key={s.mbid} className="card space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><div className="font-semibold">{s.name}</div><div className="truncate text-xs text-muted">because you rate {s.because.slice(0, 3).join(', ')}{s.because.length > 3 ? ` and ${s.because.length - 3} more` : ''}</div></div>
                <button className="btn" disabled={!signedIn || t === 'loading'} title={signedIn ? 'Find some of their tracks on Spotify' : 'Sign in to Spotify in Settings to hear them'} onClick={() => void listen(s)}>{t === 'loading' ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}Hear</button></div>
              {typeof t === 'string' && t !== 'loading' && <div className="text-sm text-bad">{t}</div>}
              {Array.isArray(t) && (t.length ? <ul className="divide-y divide-line/50">{t.map((x) => (
                <li key={x.id} className="flex items-center gap-2 py-1.5 text-sm"><span className="min-w-0 flex-1 truncate">{x.title}<span className="text-muted"> · {x.album}</span></span>
                  <button className="btn btn-ghost !p-1.5" disabled={!deviceId} title={deviceId ? 'Play on your Spotify device' : 'Choose a Spotify device in Settings'} aria-label={`Play ${x.title}`} onClick={() => void playOnSpotify(x)}><Play size={14} /></button>
                  <button className="btn btn-ghost !p-1.5" title="Add to your library as a single (find its YouTube link later in Health)" aria-label={`Add ${x.title}`} onClick={() => add(s, x)}><ListPlus size={14} /></button></li>))}</ul>
                : <div className="text-sm text-muted">Spotify found nothing by that name.</div>)}
            </div>);
        })}
      </section>}
    </div>
  );
}

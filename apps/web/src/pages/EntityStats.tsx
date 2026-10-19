import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Clock, ExternalLink, Pencil, Play, Shuffle, SkipForward, Star, Swords, Music2, StickyNote } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { useLibraryLive, type Track } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { usePlayer } from '../lib/player.ts';
import { useStore } from '../lib/store.ts';
import { canPlay } from '../lib/spotifyPlayer.ts';
import { entityStats, entityTrackIds, isStatsKind, type StatsKind } from '../lib/entityStats.ts';
import { loadFilter } from '../lib/statsFilter.ts';
import { hourLabel, timeSeries } from '../lib/listenStats.ts';
import { trackInfo } from '../lib/trackinfo.ts';
import { trackPath } from '../lib/trackPath.ts';
import { fmtBytes, plural } from '../lib/cn.ts';
import { PlaylistCover } from '../components/PlaylistCover.tsx';
import { Cover } from '../components/Cover.tsx';
import { Rating } from '../components/Rating.tsx';
import { ArtistLinks } from '../components/ArtistLinks.tsx';
import { Area, Bars, Calendar, fmtHours, Heatgrid, Kpi, Panel, RankList } from '../components/charts.tsx';
import { EditorFor } from '../components/EditorHost.tsx';
import { InlineModals } from '../components/forms.tsx';
import { TrackHistory, fmtListened } from '../components/TrackHistory.tsx';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, h) => hourLabel(h));
const KIND_LABEL: Record<StatsKind, string> = { track: 'Track', artist: 'Artist', album: 'Album', era: 'Era', playlist: 'Playlist' };

/** Where the entity's normal page is. */
const pageOf = (kind: StatsKind, id: string, t?: Track) => kind === 'track' ? (t ? trackPath(t) : '/tracks') : kind === 'playlist' ? `/playlists/${id}` : `/${kind === 'artist' ? 'artists' : kind === 'album' ? 'albums' : 'eras'}/${id}`;

/**
 * The stats page of one track, artist, album, era or playlist: the same numbers as the info popup and more (charts, history, rating spread),
 * with the entity's editor drawn in the page (pencil) instead of as a popup.
 */
export function EntityStatsPage() {
  const { kind: k, id = '' } = useParams();
  const lib = useLibraryLive();
  const play = usePlayer((s) => s.play);
  const edit = useEditor((s) => s.open);
  const cache = useStore((s) => s.audioCache);
  const [editing, setEditing] = useState(false);
  const kind = isStatsKind(k) ? k : null;
  const ids = kind ? entityTrackIds(lib, kind, id) : null;
  // plays shorter than the shortest length chosen on the Stats page (30 s by default) do not count here either
  const minMs = useMemo(() => loadFilter().minMs, []);
  const stats = useMemo(() => (ids ? entityStats(lib, ids, minMs) : null), [lib, ids, minMs]);
  if (!kind || !ids || !stats) return <div className="text-muted">Nothing to show stats for. <Link className="underline" to="/stats">Stats</Link></div>;

  const track = kind === 'track' ? lib.trackById.get(id) : undefined;
  const album = kind === 'album' ? lib.albumById.get(id) : undefined;
  const artist = kind === 'artist' ? lib.artistById.get(id) : undefined;
  const era = kind === 'era' ? lib.eraById.get(id) : undefined;
  const playlist = kind === 'playlist' ? lib.playlists.find((p) => p.id === id) : undefined;
  const title = track?.title ?? album?.title ?? artist?.name ?? era?.name ?? playlist?.name ?? '';
  const l = stats.listen;
  const playable = stats.tracks.filter(canPlay).map((t) => t.id);
  const info = track ? trackInfo(lib, id) : null;
  const rateRows = (list: Track[]) => list.map((t) => ({ key: t.id, label: t.title, sub: t.artistName, value: t.effectiveRating, to: trackPath(t) }));
  const playRows = [...stats.playsByTrack.entries()].sort((a, b) => b[1].plays - a[1].plays || b[1].ms - a[1].ms).slice(0, 10)
    .flatMap(([tid, v]) => { const t = lib.trackById.get(tid); return t ? [{ key: tid, label: t.title, sub: t.artistName, value: v.plays, extra: fmtHours(v.ms), to: trackPath(t) }] : []; });

  const { unit, points: series } = timeSeries(l, {});
  const daily = unit === 'day';
  const peak = l.byHour.indexOf(Math.max(...l.byHour));
  const stat = (label: string, value: string) => <div className="rounded-theme bg-raised px-3 py-2"><div className="text-[11px] uppercase tracking-wider text-muted">{label}</div><div className="text-sm font-semibold tabular-nums">{value}</div></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        {kind === 'playlist' && playlist ? <PlaylistCover playlist={playlist} className="w-32 shrink-0 sm:w-40" />
          : <Cover kind={kind === 'artist' ? 'artist' : undefined} hash={track?.cover ?? album?.cover ?? artist?.image ?? era?.cover ?? null} seed={title} className="w-32 shrink-0 sm:w-40" />}
        <div className="min-w-0 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted">{KIND_LABEL[kind]} stats</div>
          <h1 className="text-3xl font-bold leading-tight">{title}</h1>
          <div className="text-sm text-muted">
            {track && <><ArtistLinks leads={track.leads} featured={track.featured} />{track.albumTitle && <> · {track.albumTitle}</>}</>}
            {album && <><ArtistLinks leads={album.leads} /> · {plural(album.trackIds.length, 'track')}</>}
            {(artist || era || playlist) && plural(ids.length, 'track')}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button className="btn btn-accent" disabled={!playable.length} onClick={() => play(playable[0], playable, { type: 'search', id: null })}><Play size={16} fill="currentColor" />Play</button>
            {kind !== 'track' && <button className="btn" disabled={!playable.length} onClick={() => { const s = shuffleWithRules(playable, lib.rules); play(s[0], s, { type: 'search', id: null }); }}><Shuffle size={15} />Shuffle</button>}
            <button className={editing ? 'btn btn-accent' : 'btn'} aria-pressed={editing} onClick={() => setEditing((e) => !e)}><Pencil size={15} />{editing ? 'Close editor' : 'Edit'}</button>
            {kind !== 'artist' && <button className="btn btn-ghost" onClick={() => edit({ kind: 'new-note', id: `${kind}:${id}` })}><StickyNote size={15} />Note</button>}
            <Link className="btn btn-ghost" to={pageOf(kind, id, track)}><ExternalLink size={15} />Open page</Link>
          </div>
        </div>
      </div>

      {editing && <InlineModals.Provider value><EditorFor target={{ kind, id }} close={() => setEditing(false)} /></InlineModals.Provider>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<Music2 size={13} />} label="Plays" value={l.plays.toLocaleString()} sub={l.lastTs ? `last ${new Date(l.lastTs).toLocaleDateString()}${minMs ? ` · plays of ${Math.round(minMs / 1000)} s or more` : ''}` : 'never played here'} />
        <Kpi icon={<Clock size={13} />} label="Time listened" value={fmtHours(l.ms)} sub={l.firstTs ? `since ${new Date(l.firstTs).toLocaleDateString()}` : undefined} />
        <Kpi icon={<SkipForward size={13} />} label="Skips" value={l.skips.toLocaleString()} sub={`${Math.round(l.skipRate * 100)}% of plays`} />
        <Kpi icon={<Swords size={13} />} label="Votes" value={`${stats.votes.wins} – ${stats.votes.losses}`} sub={`won – lost${stats.votes.draws ? `, ${stats.votes.draws} equal` : ''}`} />
      </div>

      {track && info && (
        <Panel title="This track" right={<Rating track={track} size="lg" />}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stat('Elo', Math.round(track.elo).toString())}{stat('Vote rating', track.rating.toFixed(2))}{stat('Manual rating', track.initialRating != null ? String(track.initialRating) : '—')}{stat('Comparisons', String(track.comparisons))}
            {stat('Memories', String(track.memories ?? 0))}{stat(track.albumId ? 'Album released' : 'Released', track.releaseDate ?? '—')}{stat('Average play', info.plays ? fmtListened(info.secondsListened / info.plays) : '—')}{stat('Genres', track.genres.join(', ') || '—')}
          </div>
          <p className="text-xs text-muted">{track.comparisons < 3 ? `Needs ${3 - track.comparisons} more comparison${3 - track.comparisons === 1 ? '' : 's'} before the vote rating is used. ` : ''}
            {track.file ? `Audio on the server${track.file in cache ? ', saved on this device' : ''} (${track.file.slice(0, 8)}…${cache[track.file] ? `, ${fmtBytes(cache[track.file].size)}` : ''})` : 'No audio file'}{track.bitrate && ` · ${track.bitrate}`}</p>
        </Panel>)}

      {!track && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Ratings" right={<span className="text-xs text-muted">{stats.rating.rated} of {plural(ids.length, 'track')} rated</span>}>
            <div className="flex items-baseline gap-3"><span className="flex items-center gap-1.5 text-3xl font-bold tabular-nums"><Star size={20} className="text-top" fill="currentColor" />{stats.rating.avg !== null ? stats.rating.avg.toFixed(1) : '–'}</span><span className="text-sm text-muted">average rating · {plural(stats.withAudio, 'track')} with audio</span></div>
            <Bars data={stats.rating.histogram.map((v, i) => ({ label: `${i}`, value: v }))} format={(n) => `${n} track${n === 1 ? '' : 's'}`} height={90} />
          </Panel>
          <Panel title="Highest and lowest rated">
            {stats.rating.best.length ? <RankList rows={rateRows(stats.rating.best)} unit={(n) => n.toFixed(1)} /> : <p className="text-sm text-muted">Nothing rated yet. Rank some of these tracks.</p>}
            {stats.rating.worst.length > 0 && <><div className="pt-1 text-xs uppercase tracking-wider text-muted">Lowest</div><RankList rows={rateRows(stats.rating.worst)} unit={(n) => n.toFixed(1)} /></>}
          </Panel>
          <Panel title="Most played tracks">{playRows.length ? <RankList rows={playRows} /> : <p className="text-sm text-muted">No plays yet.</p>}</Panel>
          {kind === 'artist' && <Panel title="Most played albums">{l.topAlbums.length ? <RankList rows={l.topAlbums.slice(0, 10).map((r) => ({ key: r.key, label: r.label, value: r.plays, extra: fmtHours(r.ms) }))} /> : <p className="text-sm text-muted">No plays yet.</p>}</Panel>}
        </div>)}

      {l.plays > 0 ? (
        <>
          <Panel title="Listening over time" right={<span className="text-xs text-muted">{daily ? 'time per day' : 'time per month'}</span>}>
            <Area data={series} format={fmtHours} />
            <p className="text-sm text-muted">{l.daysActive.toLocaleString()} active day{l.daysActive === 1 ? '' : 's'}, longest streak {l.longestStreak.days} d{l.skips ? `, ${l.skips} skipped` : ''}.</p>
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Time of day" right={<span className="text-xs text-muted">busiest hour: {peak}:00</span>}><Bars data={l.byHour.map((v, h) => ({ label: h % 3 === 0 ? hourLabel(h) : '', full: hourLabel(h), value: v }))} format={fmtHours} highlight={peak} /></Panel>
            <Panel title="Day of the week"><Bars data={l.byWeekday.map((v, i) => ({ label: WEEKDAYS[i], value: v }))} format={(n) => `${n.toLocaleString()} plays`} highlight={l.byWeekday.indexOf(Math.max(...l.byWeekday))} /></Panel>
          </div>
          <Panel title="Listening clock" right={<span className="text-xs text-muted">plays by weekday and hour</span>}><Heatgrid cells={l.clock} rows={WEEKDAYS} cols={HOURS} /></Panel>
          <Panel title="Calendar" right={<span className="text-xs text-muted">the last 12 months</span>}><Calendar byDay={l.byDay} format={fmtHours} /></Panel>
        </>
      ) : <p className="text-sm text-muted">No plays of {kind === 'track' ? 'this track' : 'these tracks'} yet, so there are no listening charts. Play something and they fill in.</p>}

      {info && <Panel title="History"><TrackHistory info={info} track={track ?? {}} /></Panel>}
    </div>
  );
}

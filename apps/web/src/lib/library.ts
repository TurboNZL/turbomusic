import { leadArtistId, leadArtistIds, hasLead, isFeatured } from './defaults.ts';
import { albumCover, coverPool } from './covers.ts';
import { balancedRatings, replayVotes, type AlbumData, type Credit, type ArtistData, type PlaylistData, type PlaybackRule, type ReleaseData, type SyncRecord, type TrackData, type VoteData, type GenreData, type GroupData, type NoteData, type ProfileData, type PlaybackLogData, type RoleCategoryData, type TimelineData, type EraData, type NoteCategoryData, type ReleaseNameData, type MemoryLogData } from '@turbomusic/core';

export type Row<T> = T & { id: string };

export interface Lead { id: string; name: string }

export interface Track extends Omit<Row<TrackData>, 'artistId'> {
  /** derived from the credits (first Lead artist); never stored */
  artistId: string;
  /** every Lead artist, for individual links */
  leads: Lead[];
  /** artists credited as "Featured artist" who are not leads: shown after the leads ("A feat. X") */
  featured: Lead[];
  elo: number; comparisons: number;
  /** 0-10 from the votes (unfloored by comparisons); see effectiveRating */
  rating: number;
  /** what the UI should show as the rating (needs >=3 comparisons, else the manual initial rating) */
  effectiveRating: number;
  /** 1-based rank among 10-star tracks, else null */
  tenStarRank: number | null;
  artistName: string;
  albumId: string | null;
  albumTitle: string | null;
  /** the track's own cover, else its album's */
  cover: string | null;
  /** every era this track is in: its album's, plus its own for a single */
  eraIds: string[];
  /** when its album came out (default release's date), "YYYY", "YYYY-MM" or "YYYY-MM-DD"; null if unknown */
  releaseDate: string | null;
  allGenres: string[];
}

/** An era is a collection; these are what is in it, legacy single-era fields folded in. Albums' tracks are in it through their album. */
export type Era = Row<EraData> & { albumIds: string[]; trackIds: string[]; playlistIds: string[] };

export interface Library {
  tracks: Track[];
  trackById: Map<string, Track>;
  artists: Row<ArtistData>[];
  artistById: Map<string, Row<ArtistData>>;
  eras: Era[];
  eraById: Map<string, Era>;
  /** tracks that are not on any album */
  singles: Track[];
  albums: (Omit<Row<AlbumData>, 'artistId'> & { artistId: string; leads: Lead[]; artistName: string; trackIds: string[]; rating: number | null; /** every era the album is in */ eraIds: string[]; /** the default release's date, else the earliest release date */ releaseDate: string | null; /** every image of the album: uploads, its picked cover and its releases' covers */ coverPool: string[] })[];
  albumById: Map<string, Library['albums'][number]>;
  /** `title` is the release's name, or the album's when it has none (`named` false) */
  releases: (Row<ReleaseData> & { named: boolean })[];
  releaseNames: Row<ReleaseNameData>[];
  playlists: Row<PlaylistData>[];
  genres: Row<GenreData>[];
  roles: Row<RoleCategoryData>[];
  timeline: Row<TimelineData>[];
  /** the notes (stored as `groups`): titled write-ups tied to one or more things */
  groups: Row<GroupData>[];
  noteCategories: Row<NoteCategoryData>[];
  /** the old per-entity notes, kept only so they can be migrated */
  legacyNotes: Row<NoteData>[];
  votes: Row<VoteData>[];
  logs: Row<PlaybackLogData>[];
  /** when each memory was added (only memories added since this was recorded) */
  memoryLogs: Row<MemoryLogData>[];
  profile: Row<ProfileData> | null;
  rules: PlaybackRule[];
}

const live = <T,>(m: Map<string, SyncRecord> | undefined): Row<T>[] => {
  const out: Row<T>[] = [];
  for (const r of m?.values() ?? []) if (!r.deleted) out.push({ ...(r.data as T), id: r.id });
  return out;
};

/** Every lead artist (falls back to a legacy stored artist until it is migrated into the credits). */
const leadsOf = (credits: Credit[], legacy: string | undefined, artistById: Map<string, { name: string }>): Lead[] => {
  const ids = leadArtistIds(credits);
  return (ids.length ? ids : legacy ? [legacy] : []).flatMap((id) => { const n = artistById.get(id)?.name; return n ? [{ id, name: n }] : []; });
};
/** Credits with the role "Featured artist" (and no lead role) as links, in credit order. */
const featuredOf = (credits: Credit[], leads: Lead[], artistById: Map<string, { name: string }>): Lead[] => {
  const seen = new Set(leads.map((l) => l.id)), out: Lead[] = [];
  for (const c of credits) {
    if (!c.artistId || seen.has(c.artistId) || !c.role.some((r) => /^featur/i.test(r.trim()))) continue;
    const n = artistById.get(c.artistId)?.name;
    if (n) { seen.add(c.artistId); out.push({ id: c.artistId, name: n }); }
  }
  return out;
};
const namesOf = (leads: Lead[]) => (leads.length ? leads.map((l) => l.name).join(', ') : 'Unknown artist');

/** Folds the legacy `eraId` of albums and singles into each era's lists, drops ids of things that no longer exist. */
function withMembers(eras: Row<EraData>[], albums: Row<AlbumData>[], tracks: Row<TrackData>[]): Era[] {
  const albumIds = new Set(albums.map((a) => a.id)), trackIds = new Set(tracks.map((t) => t.id));
  return eras.map((e) => ({
    ...e,
    albumIds: [...new Set([...(e.albumIds ?? []), ...albums.filter((a) => a.eraId === e.id).map((a) => a.id)])].filter((id) => albumIds.has(id)),
    trackIds: [...new Set([...(e.trackIds ?? []), ...tracks.filter((t) => t.eraId === e.id).map((t) => t.id)])].filter((id) => trackIds.has(id)),
    playlistIds: [...(e.playlistIds ?? [])],
  }));
}

const by = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));

/** The same library with a fresh play history: logs are the one part that changes on every play, so they are swapped in instead of rebuilding everything. */
export function withLogs(lib: Library, rows: Record<string, Map<string, SyncRecord>>): Library {
  return { ...lib, logs: live<PlaybackLogData>(rows.playbackLogs) };
}

export function buildLibrary(rows: Record<string, Map<string, SyncRecord>>): Library {
  const artists = live<ArtistData>(rows.artists);
  const artistById = by(artists);
  const rawAlbums = live<AlbumData>(rows.albums);
  const rawTracks = live<TrackData>(rows.tracks);
  const votes = live<VoteData>(rows.votes);
  const profile = live<ProfileData>(rows.profiles)[0] ?? null;

  const ranked = replayVotes(votes.map((v) => ({ ...v })), rawTracks.map((t) => t.id));
  const ratings = balancedRatings(ranked, new Map(rawTracks.map((t) => [t.id, t.initialRating])));

  const albumTitles = new Map(rawAlbums.map((a) => [a.id, a.title]));
  const releases = live<ReleaseData>(rows.releases).map((r) => ({ ...r, named: !!r.title?.trim(), title: r.title?.trim() || albumTitles.get(r.albumId) || '' }));
  // the album's cover is its picked one, else its default release's (see covers.ts); everything below sees the derived cover
  const defaultRel = (a: Row<AlbumData>) => { const mine = releases.filter((r) => r.albumId === a.id); return mine.find((r) => r.id === a.defaultReleaseId) ?? [...mine].sort((x, y) => y.trackIds.length - x.trackIds.length)[0]; };
  const coveredAlbums = rawAlbums.map((a) => ({ ...a, cover: albumCover(a, releases.filter((r) => r.albumId === a.id), defaultRel(a)) }));
  const eras = withMembers(live<EraData>(rows.eras), rawAlbums, rawTracks);
  const erasOfAlbum = new Map<string, string[]>(), erasOfTrack = new Map<string, string[]>();
  for (const e of eras) {
    for (const id of e.albumIds) erasOfAlbum.set(id, [...(erasOfAlbum.get(id) ?? []), e.id]);
    for (const id of e.trackIds) erasOfTrack.set(id, [...(erasOfTrack.get(id) ?? []), e.id]);
  }
  const dateOf = (a: Row<AlbumData>) => defaultRel(a)?.releaseDate || releases.filter((r) => r.albumId === a.id && r.releaseDate).map((r) => r.releaseDate!).sort()[0] || null;
  const albumDate = new Map(rawAlbums.map((a) => [a.id, dateOf(a)]));
  // a song's own date is the earliest release it is on (a deluxe edition of 2024 does not make a 2019 song newer); no dated release = its album's date
  const earliestRelease = new Map<string, string>();
  for (const r of releases) {
    if (!r.releaseDate) continue;
    for (const id of r.trackIds ?? []) { const cur = earliestRelease.get(id); if (!cur || r.releaseDate < cur) earliestRelease.set(id, r.releaseDate); }
  }
  const albumOf = new Map<string, Row<AlbumData>>();
  const albumsById = by(coveredAlbums);
  const trackIdsByAlbum = new Map<string, { id: string; order: number }[]>();
  for (const t of rawTracks) {
    for (const link of t.albums ?? []) {
      if (!albumsById.has(link.albumId)) continue;
      if (!albumOf.has(t.id)) albumOf.set(t.id, albumsById.get(link.albumId)!);
      const list = trackIdsByAlbum.get(link.albumId) ?? [];
      list.push({ id: t.id, order: link.order });
      trackIdsByAlbum.set(link.albumId, list);
    }
  }

  const tracks: Track[] = rawTracks.map((t) => {
    const r = ranked.get(t.id)!;
    const rating = ratings.get(t.id) ?? 0;
    const album = albumOf.get(t.id) ?? null;
    const eff = r.comparisons >= 3 && rating > 0.001 ? rating : (t.initialRating ?? 0) > 0.001 ? t.initialRating! : 0;
    const genres = t.syncWithAlbumCredits && album ? album.genres : t.genres;
    // a track that follows its album takes the album's credits (when the album has a lead artist)
    // ...plus the featured artists the track adds itself, so a featuring does not mean giving up the album's credits
    const follows = t.syncWithAlbumCredits && album && hasLead(album.credits ?? []);
    const own = (t.credits ?? []).filter((c) => !c.artistId || !(album?.credits ?? []).some((a) => a.artistId === c.artistId));
    const credits = follows ? [...album!.credits, ...own.filter(isFeatured)] : (t.credits ?? []);
    const artistId = leadArtistId(credits, t.artistId ?? '');
    const leads = leadsOf(credits, t.artistId, artistById);
    return {
      ...t, credits, artistId, leads, featured: featuredOf(credits, leads, artistById), elo: r.elo, comparisons: r.comparisons, rating, effectiveRating: eff, tenStarRank: null,
      artistName: namesOf(leads),
      albumId: album?.id ?? null, albumTitle: album?.title ?? null, cover: t.cover || album?.cover || null,
      releaseDate: album ? earliestRelease.get(t.id) ?? albumDate.get(album.id) ?? null : t.releaseDate || null, // a single keeps its own
      eraIds: [...new Set([...(album ? erasOfAlbum.get(album.id) ?? [] : []), ...(erasOfTrack.get(t.id) ?? [])])],
      allGenres: genres ?? [],
    };
  });
  tenStarRanks(tracks);
  const trackById = by(tracks);

  // Legacy data has album_tracks.order = 0 almost everywhere, but every album has an ordered release,
  // so a track's position comes from the album's default release (else its longest one), then `order`.
  const position = (albumId: string, defaultReleaseId?: string | null) => {
    const mine = releases.filter((r) => r.albumId === albumId);
    const rel = mine.find((r) => r.id === defaultReleaseId) ?? mine.sort((x, y) => y.trackIds.length - x.trackIds.length)[0];
    return new Map((rel?.trackIds ?? []).map((id, i) => [id, i]));
  };

  const albums = coveredAlbums.map((a) => {
    // an explicit order (set when the user reorders/adds by hand) wins over the release tracklist
    const pos = a.trackOrder?.length ? new Map(a.trackOrder.map((id, i) => [id, i])) : position(a.id, a.defaultReleaseId);
    const at = (id: string) => pos.get(id) ?? Number.MAX_SAFE_INTEGER;
    const ids = (trackIdsByAlbum.get(a.id) ?? []).sort((x, y) => at(x.id) - at(y.id) || x.order - y.order).map((x) => x.id);
    const rated = ids.map((id) => trackById.get(id)!.effectiveRating).filter((x) => x > 0);
    const artistId = leadArtistId(a.credits ?? [], a.artistId ?? '');
    const leads = leadsOf(a.credits ?? [], a.artistId, artistById);
    const raw = rawAlbums.find((x) => x.id === a.id)!;
    return { ...a, artistId, leads, artistName: namesOf(leads), trackIds: ids, eraIds: erasOfAlbum.get(a.id) ?? [], releaseDate: albumDate.get(a.id) ?? null, coverPool: coverPool(raw, releases.filter((r) => r.albumId === a.id)),
      // an unrated track counts as 0, so one great track does not make a whole album look great; an album with no rated track at all has no rating
      rating: rated.length ? rated.reduce((s, x) => s + x, 0) / ids.length : null };
  });

  return {
    tracks, trackById, artists, artistById, albums, albumById: by(albums),
    eras: eras, eraById: by(eras), singles: tracks.filter((t) => !t.albumId),
    releases, releaseNames: live<ReleaseNameData>(rows.releaseNames), playlists: live<PlaylistData>(rows.playlists),
    genres: live<GenreData>(rows.genres), roles: live<RoleCategoryData>(rows.roleCategories), timeline: live<TimelineData>(rows.timeline), groups: live<GroupData>(rows.groups), noteCategories: live<NoteCategoryData>(rows.noteCategories), legacyNotes: live<NoteData>(rows.notes),
    votes, logs: live<PlaybackLogData>(rows.playbackLogs), memoryLogs: live<MemoryLogData>(rows.memoryLogs), profile, rules: profile?.playbackRules ?? [],
  };
}

/** 10-star tracks are shown by rank (#1 = highest Elo), as in the original app. */
function tenStarRanks(tracks: Track[]) {
  // like the legacy store, the ranked list is keyed on the (initialRating-floored) rating...
  const top = tracks.filter((t) => t.rating >= 9.9999 && t.comparisons > 0).sort((a, b) => b.elo - a.elo);
  // ...but the badge only shows a rank when the displayed rating is 10 as well
  top.forEach((t, i) => { if (t.effectiveRating >= 9.9999) t.tenStarRank = i + 1; });
}


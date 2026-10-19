import { findDuplicates } from './duplicates.ts';
import { hasLead } from './defaults.ts';
import type { Library } from './library.ts';
import { qualityOf } from './audioCheck.ts';

export type HealthKind = 'album-source' | 'track' | 'album' | 'artist' | 'genre' | 'role' | 'release' | 'noteCategory';
export interface HealthItem { kind: HealthKind; id: string; label: string; /** the album a track is on (for "this album has no YouTube Music link") */ albumId?: string | null; detail?: string; /** items that belong together (duplicates of one song) share a group */ group?: string; /** why a group was listed (duplicates) */ note?: string }
export interface HealthCheck {
  id: string; title: string; why: string; items: HealthItem[];
  /** only for checks that are safe to fix in one click */
  fix?: { label: string; table: 'artists' | 'genres' | 'roleCategories' | 'noteCategories' };
  /** one-click: write a "Lead artist" credit from the stored artistId onto each item */
  addLead?: { label: string };
  /** paste many links at once, album by album */
  bulk?: 'youtubeMusicUrl' | 'spotifyUrl' | 'geniusUrl';
  /** open the tool that looks for YouTube links of the tracks */
  matchLinks?: boolean;
  /** a paste box per album: the YouTube album link that completes it */
  albumLinks?: boolean;
  /** items come in groups of the same thing, each group can be merged into one */
  mergeGroups?: boolean;
  /** a tool that fills in the missing dates by itself */
  autoDates?: boolean;
  /** groups can be marked "not duplicates" (they stop being listed) */
  notDuplicates?: boolean;
  /** each row can be fixed in place (a date, a genre or a link typed on the row itself) */
  quick?: 'release-date' | 'single-date' | 'album-genre' | 'track-genre' | 'youtubeMusicUrl' | 'spotifyUrl' | 'geniusUrl';
  /** each row (an album) can be taken back out of this list */
  unmarkNoYoutube?: boolean;
  /** items can have their dead-link mark cleared */
  clearDead?: boolean;
}

/** Groups of tracks the user said are NOT duplicates are kept in the profile's settings as sorted id lists. */
export const dupeSignature = (ids: string[]) => [...ids].sort().join(',');
export function ignoredDupes(lib: Library): string[] {
  const v = lib.profile?.settings?.notDuplicates;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
/** A group stays hidden while the tracks in it are the ones that were marked (a new look-alike makes it a new group, so it shows up again). */
export const isIgnoredDupe = (ignored: string[], ids: string[]) => ignored.some((sig) => { const s = new Set(sig.split(',')); return ids.every((id) => s.has(id)); });

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** a title without its "(feat. X)" / "[with Y]" credit, so "Solar Eclipse" and "Solar Eclipse (feat. Don Toliver)" are the same song */
export const songKey = (title: string) => norm(title.replace(/[([]\s*(?:feat\.?|ft\.?|featuring|with)\b[^)\]]*[)\]]/gi, ' '));

/** The track's YouTube link was reported gone by the server and has not been changed since. */
export const isDead = (x: { youtubeMusicUrl: string | null; youtubeDead?: { url: string } | null }) => !!x.youtubeDead && x.youtubeDead.url === x.youtubeMusicUrl;

/** Data-quality checks across the whole library (replaces the old "cleanup tasks"). Pure, so it is testable. */
export function computeHealth(lib: Library): HealthCheck[] {
  const t = (x: (typeof lib.tracks)[number], detail?: string): HealthItem => ({ kind: 'track', id: x.id, label: `${x.title} · ${x.artistName}`, detail });

  const usedArtists = new Set<string>();
  for (const x of lib.tracks) { usedArtists.add(x.artistId); x.credits.forEach((c) => usedArtists.add(c.artistId)); (x.storedCredits ?? []).forEach((c) => usedArtists.add(c.artistId)); }
  for (const a of lib.albums) { usedArtists.add(a.artistId); a.credits.forEach((c) => usedArtists.add(c.artistId)); }
  for (const g of lib.groups) g.members.forEach((m) => m.entityType === 'artist' && usedArtists.add(m.entityId));

  const usedGenres = new Set<string>();
  for (const x of lib.tracks) x.genres.forEach((g) => usedGenres.add(g.toLowerCase()));
  for (const a of lib.albums) a.genres.forEach((g) => usedGenres.add(g.toLowerCase()));

  const usedRoles = new Set<string>();
  for (const x of lib.tracks) x.credits.forEach((c) => c.role.forEach((r) => usedRoles.add(r.toLowerCase())));
  for (const a of lib.albums) a.credits.forEach((c) => c.role.forEach((r) => usedRoles.add(r.toLowerCase())));

  const ignored = ignoredDupes(lib);
  const dupeGroups = findDuplicates(lib).filter((g) => !isIgnoredDupe(ignored, g.ids));
  const lowQuality = lib.tracks.filter((x) => x.bitrate && parseInt(x.bitrate) > 0 && parseInt(x.bitrate) < 192);

  const fakes = lib.tracks.filter((x) => { const q = qualityOf(x); return q === 'transcode' || q === 'mismatch'; });
  const noLinkAlbums = new Set(lib.albums.filter((a) => (a as { noYoutube?: boolean }).noYoutube).map((a) => a.id));
  const waiting = lib.albums.filter((a) => (a as { needsSource?: boolean }).needsSource);
  return [
    { id: 'needs-source', title: 'Albums waiting for a YouTube album link', why: 'These came from a Spotify import and only hold the songs you picked. Paste a YouTube Music link of the whole album: it fills in the real tracklist, the cover and the audio, and keeps the songs you already have.', albumLinks: true,
      items: waiting.map((a) => ({ kind: 'album-source' as const, id: a.id, label: `${a.title} · ${a.artistName}`, detail: `${a.trackIds.length} track${a.trackIds.length === 1 ? '' : 's'}` })) },
    { id: 'fake-quality', title: 'Audio that is not what it claims', why: 'The file claims a high bit rate but its sound stops where a lower one would (re-encoded from a worse source), or its stored bit rate is not what the file measures. Run “Check audio quality” above first.',
      items: fakes.map((x) => t(x, qualityOf(x) === 'transcode' ? `claims ${x.audioCheck?.kbps} kbps, content like ${x.audioCheck?.looksLike} (cuts off at ${((x.audioCheck?.cutoffHz ?? 0) / 1000).toFixed(1)} kHz)` : `stored ${x.bitrate}, measures ${x.audioCheck?.kbps} kbps`)) },
    { id: 'no-lead', title: 'No lead artist credit', why: 'The artist comes from the credits: the first credit with the role “Lead artist”. Old records only have it stored separately.',
      addLead: { label: 'Add lead credit from artist' },
      items: [
        ...lib.albums.filter((a) => !hasLead(a.credits ?? [])).map((a) => ({ kind: 'album' as const, id: a.id, label: `${a.title} · ${a.artistName}` })),
        ...lib.tracks.filter((x) => !hasLead(x.credits ?? [])).map((x) => t(x)),
      ] },
    { id: 'dead-links', title: 'Dead YouTube links', why: 'YouTube said these videos are no longer available (removed, private or blocked), so the audio cannot be downloaded from them. Open the track and paste a working link, then download again. The mark goes away by itself once the link changes.', clearDead: true,
      items: lib.tracks.filter(isDead).map((x) => t(x, x.youtubeDead?.reason || 'video unavailable')) },
    { id: 'no-audio', title: 'Tracks without audio', why: 'They cannot be played. Tracks with a YouTube link can be downloaded with “Download missing audio” above.',
      items: lib.tracks.filter((x) => !x.file).map((x) => t(x, isDead(x) ? 'dead YouTube link' : x.youtubeMusicUrl ? 'has a YouTube link' : 'no link either')) },
    { id: 'no-source', title: 'Tracks with no audio and no YouTube link', why: 'Nothing to download from. Add a link in the track editor.',
      items: lib.tracks.filter((x) => !x.file && !x.youtubeMusicUrl).map((x) => t(x)) },
    { id: 'no-youtube', quick: 'youtubeMusicUrl', title: 'Tracks without a YouTube Music link', why: 'The link is what lets the server download (or re-download) the audio. Let the server find the YouTube Music album, paste links by album, or add one in the track editor.', bulk: 'youtubeMusicUrl', matchLinks: true,
      items: lib.tracks.filter((x) => !x.youtubeMusicUrl && !(x.albumId && noLinkAlbums.has(x.albumId))).map((x) => ({ ...t(x, x.file ? 'has audio' : 'no audio'), albumId: x.albumId })) },
    { id: 'no-youtube-album', unmarkNoYoutube: true, title: 'Albums marked as not on YouTube Music', why: 'You said these have no YouTube Music album, so their tracks are left out of “Tracks without a YouTube Music link”. “Put back” returns an album to that list.',
      items: lib.albums.filter((a) => noLinkAlbums.has(a.id)).map((a) => ({ kind: 'album' as const, id: a.id, label: `${a.title} · ${a.artistName}`, detail: `${a.trackIds.length} track${a.trackIds.length === 1 ? '' : 's'}` })) },
    { id: 'no-spotify', quick: 'spotifyUrl', title: 'Tracks without a Spotify link', why: 'Optional, but handy for opening the track elsewhere.', bulk: 'spotifyUrl',
      items: lib.tracks.filter((x) => !x.spotifyUrl).map((x) => t(x)) },
    { id: 'no-genius', quick: 'geniusUrl', title: 'Tracks without a Genius link', why: 'Optional: lyrics and annotations.', bulk: 'geniusUrl',
      items: lib.tracks.filter((x) => !x.geniusUrl).map((x) => t(x)) },
    { id: 'release-no-date', quick: 'release-date', title: 'Releases without a date', why: 'Find them automatically: from another dated release of the same album, or from Spotify, iTunes and MusicBrainz. Or open a release and set the date yourself.', autoDates: true,
      items: lib.releases.filter((r) => !r.releaseDate).map((r) => ({ kind: 'release' as const, id: r.id, label: `${r.title} · ${lib.albumById.get(r.albumId)?.title ?? 'unknown album'}` })) },
    { id: 'single-no-date', quick: 'single-date', title: 'Singles without a date', why: 'A single carries its own release date (an album track takes it from its album). Open the single and fill in the date.',
      items: lib.singles.filter((x) => !x.releaseDate).map((x) => t(x, 'single')) },
    { id: 'album-no-genre', quick: 'album-genre', title: 'Albums without a genre', why: 'Tracks that follow the album take their genres from it.',
      items: lib.albums.filter((a) => !a.genres.length).map((a) => ({ kind: 'album' as const, id: a.id, label: `${a.title} · ${a.artistName}` })) },
    { id: 'no-genre', quick: 'track-genre', title: 'Tracks without a genre', why: 'They will not show up in genre filters or the genre stats.',
      items: lib.tracks.filter((x) => !x.allGenres.length).map((x) => t(x)) },
    { id: 'low-quality', title: 'Low bitrate tracks (under 192 kbps)', why: 'Worth replacing when a better source exists.',
      items: lowQuality.map((x) => t(x, x.bitrate ?? undefined)) },
    { id: 'duplicates', title: 'Possible duplicate tracks', why: 'The same song more than once: a single and the same song on its album, a second artist credit, an accent or "&" spelt differently, a (Remastered) tag, the same Spotify or YouTube song, the same audio file, or a title one typo apart. Each group says why it was listed. “Merge” folds them into one track: it keeps every Spotify link, the votes, plays and memories, and everything that used the others uses the survivor.', mergeGroups: true, notDuplicates: true,
      items: dupeGroups.flatMap((g) => g.ids.flatMap((id) => lib.trackById.get(id) ?? []).map((x) => ({ ...t(x, `${x.albumTitle ?? 'single'} · ${x.comparisons} comparisons${x.file ? ', has audio' : ''}`), group: g.key, note: g.reasons.join(' · ') }))) },
    { id: 'album-no-cover', title: 'Albums without a cover', why: 'Open the album and choose an image.',
      items: lib.albums.filter((a) => !a.cover).map((a) => ({ kind: 'album' as const, id: a.id, label: `${a.title} · ${a.artistName}` })) },
    { id: 'album-empty', title: 'Albums with no tracks', why: 'Probably left over from deleting tracks.',
      items: lib.albums.filter((a) => !a.trackIds.length).map((a) => ({ kind: 'album' as const, id: a.id, label: `${a.title} · ${a.artistName}` })) },
    { id: 'artist-no-image', title: 'Artists without an image', why: 'Artist images were lost with the old uploads folder; add them again.',
      items: lib.artists.filter((a) => !a.image).map((a) => ({ kind: 'artist' as const, id: a.id, label: a.name })) },
    { id: 'artist-unused', title: 'Artists that are not used anywhere', why: 'Not credited on any track or album, not in a bio or note.',
      fix: { label: 'Delete these artists', table: 'artists' },
      items: lib.artists.filter((a) => !usedArtists.has(a.id)).map((a) => ({ kind: 'artist' as const, id: a.id, label: a.name })) },
    { id: 'genre-unused', title: 'Genres that no track or album uses', why: 'Safe to remove; they only clutter the suggestions.',
      fix: { label: 'Delete these genres', table: 'genres' },
      items: lib.genres.filter((g) => !usedGenres.has(g.name.toLowerCase())).map((g) => ({ kind: 'genre' as const, id: g.id, label: g.name })) },
    { id: 'role-unused', title: 'Credit roles that nothing uses', why: 'Checked against every track and album credit, so roles in use are never listed.',
      fix: { label: 'Delete these roles', table: 'roleCategories' },
      items: lib.roles.filter((r) => !usedRoles.has(r.name.toLowerCase())).map((r) => ({ kind: 'role' as const, id: r.id, label: r.name })) },
    { id: 'note-category-unused', title: 'Note categories with no notes', why: 'Categories you made that no note uses any more. Safe to remove.',
      fix: { label: 'Delete these categories', table: 'noteCategories' },
      items: lib.noteCategories.filter((c) => !lib.groups.some((g) => g.categoryId === c.id)).map((c) => ({ kind: 'noteCategory' as const, id: c.id, label: c.name })) },
  ];
}

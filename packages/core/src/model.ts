/**
 * Shapes of `SyncRecord.data` per table. These are the app's canonical entities.
 * Images and audio are referenced by content hash (sha256 hex) and resolved to a
 * URL/blob by each client, never by server-relative path.
 *
 * NOT stored on purpose: a track's elo, comparisons and rating. They are derived from
 * the `votes` log (see elo.ts), which is what makes multi-device voting mergeable.
 */
export interface Credit { artistId: string; role: string[] }
export interface FileRef { hash: string | null }

export interface ArtistData {
  /** left out of the artist lists unless "hidden" is shown (like a hidden album) */
  hidden?: boolean;
  /** the displayed name (the primary alias) */
  name: string; image: string | null;
  /** other names the artist goes by (stage names, spellings, real name); used to recognise them when importing */
  aliases?: string[];
}
/** An era groups albums and singles (Era > Album > Release > Track). Relational bios can be attached to it. */
export interface EraData {
  name: string; description: string | null; cover: string | null;
  /** an era is a collection: it lists what is in it, and things can be in several eras at once */
  albumIds?: string[];
  /** tracks in the era on their own (singles); the tracks of its albums are in it through them */
  trackIds?: string[];
  playlistIds?: string[];
}
export interface AlbumData {
  title: string;
  credits: Credit[];
  /** @deprecated the old single-artist field. Credits (Lead artist) are the only artist now; kept only so old records can be migrated. */
  artistId?: string;
  genres: string[];
  /** the cover the user picked from the pool; only counts when `coverPicked` (old records: when set) */
  cover: string | null;
  /** images uploaded to the album (its pool); the pool also includes the picked cover and every release's cover */
  covers?: string[];
  /** false = inherit the default release's cover. Absent on old records, where a set `cover` counts as picked */
  coverPicked?: boolean;
  /** @deprecated old single-era field; membership now lives in EraData.albumIds. Still read, dropped when the album is saved. */
  eraId?: string | null;
  defaultReleaseId?: string | null;
  /** made by a Spotify import from a few tracks and no source for the whole album: Health asks for a YouTube album link to complete it */
  needsSource?: boolean;
  /** the user marked that this album is not on YouTube Music: Health keeps it out of the main "missing YouTube link" list and shows it in its own */
  noYoutube?: boolean;
  /** from the vault (unreleased, leaked or otherwise unofficial): the artist page lists it apart from the released music */
  vault?: boolean;
  /** the user says nothing more is missing from this album (no tracks to add, no links to find): it is left out of the "to do" lists */
  complete?: boolean;
  /** kept out of the Albums list and of search (unless nothing else matches); still there for the tracks that belong to it */
  hidden?: boolean;
  /** explicit track order (ids); wins over the release tracklist. Set when the user reorders or adds tracks by hand. */
  trackOrder?: string[];
}
/** A reusable name for releases ("Deluxe", "Vinyl", "2026 remaster"), picked or created like an artist's name. */
export interface ReleaseNameData { name: string }
export interface ReleaseData {
  albumId: string;
  /** the release's name; blank means it is called after the album (the library derives the shown title) */
  title: string;
  cover: string | null;
  releaseDate: string | null;
  /** @deprecated release names replaced tags; old values stay in the data and in the tag: filter, but nothing edits them */
  tags?: string[];
  /** ordered */
  trackIds: string[];
  /** a release that stands for a single the song came out as: it has one track, needs no name, is left out of the album's release list and shows on the Singles page (and under the releases of its album) */
  single?: boolean;
  /** the YouTube Music album page this release was read from (or was tied to by hand): "Re-read credits from YouTube Music" uses it */
  youtubeMusicUrl?: string | null;
  /** this edition is from the vault (see AlbumData.vault); an album whose releases are all from the vault counts as one */
  vault?: boolean;
}
export interface TrackData {
  title: string;
  /** a single from the vault (see AlbumData.vault) */
  vault?: boolean;
  /** @deprecated see AlbumData.artistId */
  artistId?: string;
  credits: Credit[];
  /** the track's own cover (a single's artwork); an album track without one shows its album's cover */
  cover?: string | null;
  /** @deprecated old single-era field of a single; membership now lives in EraData.trackIds */
  eraId?: string | null;
  /** only used when syncWithAlbumCredits is false; otherwise genres come from the album */
  genres: string[];
  albums: { albumId: string; order: number }[];
  /** audio content hash; null = no file yet */
  file: string | null;
  initialRating: number | null;
  spotifyUrl: string | null;
  /** a single's release date (YYYY-MM-DD); a track on an album takes its album's date from the default release instead */
  releaseDate?: string | null;
  /** other Spotify links of the same song (a single that later came out on an album has a second one); `spotifyUrl` is the one played */
  spotifyUrls?: string[];
  geniusUrl: string | null;
  youtubeMusicUrl: string | null;
  /** set by the server when YouTube says that link's video is gone (removed, private, blocked); only counts while `url` is still the track's link */
  youtubeDead?: { url: string; reason: string; at: number } | null;
  bitrate: string | null;
  /** what the audio file really measured (server /api/audio/analyze): see Health > Check audio quality */
  audioCheck?: AudioCheck | null;
  bpm: number | null;
  key: string | null;
  memories: number;
  /**
   * Pre-release (leaked, demo, unreleased) version of another track: the id of the released track it is tied to. While tied it keeps its own info and
   * stats, but is hidden from every list, shuffle and ranking (it is not a separate entry); clearing this makes it an ordinary track again.
   */
  preReleaseOf?: string | null;
  /** On the RELEASED track: the id of a tied pre-release whose audio file is used as this track's primary audio. Set by hand, never automatically. */
  primaryAudioFrom?: string | null;
  /**
   * This track is another RECORDING of the song `versionOf` (a remaster, a live take, a radio edit, the music-video audio): it keeps
   * its own audio file and its own place on its own album, but it shares the main version's votes, rating and thumbs, so one song is
   * ranked once. Songs that are simply the same audio on two albums should be merged instead (one track listed on both albums).
   */
  versionOf?: string | null;
  /** how long the song should be, in seconds, according to where it came from (the album's entry on YouTube, or Spotify): lets a download be checked for music-video junk */
  sourceSeconds?: number | null;
  syncWithAlbumCredits: boolean;
  queueRules: Record<string, unknown>;
}
/** The result of measuring a track's audio file. `cutoffHz`: highest frequency with sound; `looksLike`: the bit rate class that points to. */
export interface AudioCheck { /** the file's length in seconds (older checks have none) */ seconds?: number; kbps: number; codec: string; cutoffHz: number; looksLike: number; verdict: 'ok' | 'transcode' | 'unknown'; file: string; at: number }
export interface PlaylistData {
  name: string;
  description: string | null;
  cover: string | null;
  createdAt: number;
  /** 'tracks' (the default, also when missing) lists songs; 'albums' lists whole albums, which play front to back */
  kind?: 'tracks' | 'albums';
  /** the albums of an album playlist, in order */
  albumIds?: string[];
  trackIds: string[];
  /** "Playlist note": why a track is in this playlist, or anything else about it there (track id -> text) */
  trackNotes?: Record<string, string>;
  /** the same for an album playlist: album (or release) id -> why it is there */
  albumNotes?: Record<string, string>;
  /** set when the playlist is kept in step with a Spotify playlist of the owner's account */
  spotify?: SpotifyLinkData;
}
/** The tie between a playlist and its Spotify twin. `base` is what both held at the last sync (track URIs), which tells a removal from a track the other side never had. */
export interface SpotifyLinkData {
  id: string;
  /** which way changes travel: both ways, or only one */
  mode?: 'both' | 'from-spotify' | 'to-spotify';
  syncedAt: number;
  base: string[];
}
export interface GroupMemberData {
  entityType: 'artist' | 'album' | 'track' | 'release' | 'era' | 'playlist';
  entityId: string;
  showOnEntityPage: boolean;
}
/**
 * A note: a titled write-up tied to one or more things (the old "relational bios" and "notes" are the same thing now:
 * a note on one artist is just a note with one link). Stored in the `groups` table.
 */
export interface GroupData {
  /** the title */
  name: string;
  /** the text */
  description: string | null;
  label: string | null;
  /** @deprecated the old fixed type (relationship, collective, ...); replaced by categories. Dropped by the migration. */
  type?: string;
  /** one of the user's own categories (NoteCategoryData), created on the spot like an artist */
  categoryId?: string | null;
  /** at least one */
  members: GroupMemberData[];
  createdAt?: number;
}
export interface NoteCategoryData { name: string }
/** @deprecated the old per-entity notes; migrated into notes (GroupData) by the client */
export interface NoteData {
  entityType: string;
  entityId: string;
  label: string;
  content: string;
  isLinked: boolean;
  createdAt: number;
}
export interface GenreData { name: string }
export interface RoleCategoryData { name: string; isRemovable: boolean }
export interface TimelineData { type: string; title: string; description: string; entityId: string | null; timestamp: number; /** how the entry felt (journal mood id) */ mood?: string | null; /** shown at the top of the journal */ pinned?: boolean }
export interface VoteData {
  trackAId: string; trackBId: string;
  winnerId: string | null; isEqual: boolean;
  /** thumbs up/down on trackAId alone (trackBId is ''); see elo.ts */
  boost?: 1 | -1;
  /** how much this answer counts: 1 = ordinary (the default), 2.5 = "much better" */
  weight?: number;
  /** made by putting several songs in order of preference (the album first-listen ranking): counts less the more the songs are compared otherwise, so a first impression does not outweigh later votes */
  order?: boolean;
  /** a head-to-head between two ALBUMS (trackAId/trackBId are album ids): it ranks albums, and a ranked album lifts the starting Elo of its tracks */
  album?: boolean;
  timestamp: number;
}
/** One memory added to a track (the track's `memories` counter holds the total, including memories from before these were recorded). Deleted when that memory is removed. */
export interface MemoryLogData { trackId: string; timestamp: number }
export interface PlaybackLogData {
  /** '' for a play imported from another service whose track is not in the library (it is matched again whenever the library changes) */
  trackId: string; timestamp: number; duration: number | null;
  /** the track's length in seconds when it was played (lets "pick up where you left off" tell a finished play from a partial one); absent on older plays */
  length?: number | null;
  /** the silent Spotify mirror was streaming this song meanwhile, so Spotify counted this play too: an imported Spotify play of the same song just after it is the same play */
  mirrored?: boolean;
  sourceType: string | null; sourceId: string | null; isSkip: boolean;
  /** set on plays imported from a service's history (Spotify's extended streaming history); `timestamp` is when the play ended, like Spotify's `ts` */
  imported?: 'spotify';
  /** how the service named the play (used when the track is not in the library) */
  name?: string; artist?: string; album?: string;
  /** spotify:track:<id> */
  uri?: string;
  shuffle?: boolean | null; platform?: string | null; reasonStart?: string | null; reasonEnd?: string | null;
  /** which of the owner's accounts an imported play came from ("Old account"): lets a whole account's history be hidden at once */
  account?: string;
  /** the play was found by the server's automatic check of Spotify's recently played (not from an export file): it has no exact length and is dropped when the same play is in an export or in TurboMusic's own log */
  via?: 'api';
  /** left out of every list and statistic, but kept so it can be brought back (the history manager) */
  hidden?: boolean;
}
export interface ProfileData {
  name: string; theme: string; accentColor: string; playbackMode: string;
  settings: Record<string, unknown>;
  playbackRules: import('./queue.ts').PlaybackRule[];
}

import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { balancedRatings, replayVotes, type RecordTable } from '@turbomusic/core';
import type { Store } from './db.ts';
import { filePath } from './files.ts';

/**
 * The library as people can read it. TurboMusic stores audio under its content hash (files/ab/ab12...), which is good for syncing and
 * for never storing a song twice but means nobody can browse it. This module works out `Artist/Album/01 Title.mp3` for every song that has
 * audio, and uses it two ways: a **mirror** (a folder of links to the real files that follows the library) and an **export** (the same
 * tree as an archive with playlists, a CSV and the full data, for taking the library elsewhere). `planLayout` is pure.
 */
interface Row { id: string; data: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any

export interface LayoutItem { trackId: string; hash: string; /** path inside the tree, '/'-separated */ path: string; title: string; artist: string; album: string | null; number: number | null }
export interface LibraryInput { tracks: Row[]; albums: Row[]; artists: Row[]; releases: Row[]; playlists: Row[]; mime: (hash: string) => string | undefined }

const MIME_EXT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm' };
export const extFor = (mime: string | undefined) => (mime && MIME_EXT[mime]) || 'mp3';

/** A name that is safe on Windows, macOS and Linux: no separators or reserved characters, no trailing dots or spaces, not too long. */
export function safeName(s: string, fallback = 'Unknown', max = 80): string {
  const t = s.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  const cut = [...t].slice(0, max).join('').trim();
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cut) ? `_${cut}` : cut || fallback;
}

const leadOf = (credits: any[] | undefined): string | undefined => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const lead = (credits ?? []).find((c) => (c.role ?? []).some((r: string) => r.toLowerCase() === 'lead artist' || r.toLowerCase() === 'lead')) ?? (credits ?? [])[0];
  return lead?.artistId;
};

export function planLayout(input: LibraryInput): LayoutItem[] {
  const artistName = new Map(input.artists.map((a) => [a.id, String(a.data.name ?? '')]));
  const albumById = new Map(input.albums.map((a) => [a.id, a]));
  const releaseTracks = new Map<string, string[]>(); // album id -> the default (else longest) release's tracks
  for (const r of input.releases) {
    const cur = releaseTracks.get(r.data.albumId);
    const mine: string[] = r.data.trackIds ?? [];
    const album = albumById.get(r.data.albumId);
    if (!cur || r.id === album?.data.defaultReleaseId || (album?.data.defaultReleaseId == null && mine.length > cur.length)) releaseTracks.set(r.data.albumId, mine);
  }
  const used = new Set<string>();
  const out: LayoutItem[] = [];
  const order = [...input.tracks].filter((t) => t.data.file).sort((a, b) => String(a.data.title).localeCompare(String(b.data.title)));
  for (const t of order) {
    const link = (t.data.albums ?? [])[0] as { albumId: string; order: number } | undefined;
    const album = link && albumById.get(link.albumId);
    const lead = (t.data.syncWithAlbumCredits && album ? leadOf(album.data.credits) : undefined) ?? leadOf(t.data.credits) ?? (album && leadOf(album.data.credits));
    const artist = (lead && artistName.get(lead)) || 'Unknown artist';
    let number: number | null = null;
    if (album) {
      const list: string[] = album.data.trackOrder ?? releaseTracks.get(album.id) ?? [];
      const i = list.indexOf(t.id);
      number = i >= 0 ? i + 1 : link ? link.order + 1 : null;
    }
    const folder = `${safeName(artist)}/${album ? safeName(album.data.title, 'Untitled album') : 'Singles'}`;
    const ext = extFor(input.mime(t.data.file));
    const base = `${number ? `${String(number).padStart(2, '0')} ` : ''}${safeName(t.data.title, 'Untitled')}`;
    let path = `${folder}/${base}.${ext}`, n = 2;
    while (used.has(path.toLowerCase())) path = `${folder}/${base} (${n++}).${ext}`;
    used.add(path.toLowerCase());
    out.push({ trackId: t.id, hash: t.data.file, path, title: String(t.data.title), artist, album: album ? String(album.data.title) : null, number });
  }
  return out;
}

export function loadInput(store: Store): LibraryInput {
  const rows = (t: RecordTable): Row[] => store.list(t).map((r) => ({ id: r.id, data: r.data }));
  return { tracks: rows('tracks'), albums: rows('albums'), artists: rows('artists'), releases: rows('releases'), playlists: rows('playlists'), mime: (h) => store.fileInfo(h)?.mime };
}

/** An extended M3U playlist whose entries are relative to `from` (the playlists folder). */
export function playlistM3u(name: string, trackIds: string[], items: Map<string, LayoutItem>, from = 'Playlists'): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${name}`];
  for (const id of trackIds) {
    const it = items.get(id);
    if (!it) continue;
    lines.push(`#EXTINF:-1,${it.artist} - ${it.title}`, relative(from, `Music/${it.path}`).split(sep).join('/'));
  }
  return `${lines.join('\n')}\n`;
}

/** Playlists as `.m3u8` texts keyed by file name. Only tracks with audio can be listed. */
export function playlistFiles(input: LibraryInput, items: LayoutItem[]): { name: string; text: string }[] {
  const byId = new Map(items.map((i) => [i.trackId, i]));
  const used = new Set<string>();
  const out: { name: string; text: string }[] = [];
  for (const p of input.playlists) {
    if (p.data.kind === 'albums') {
      const ids = (p.data.albumIds ?? []).flatMap((a: string) => [...(input.releases.find((r) => r.id === a)?.data.trackIds ?? input.albums.find((x) => x.id === a)?.data.trackOrder ?? [])]);
      if (!ids.length) continue;
      p.data = { ...p.data, trackIds: ids };
    }
    let name = `${safeName(p.data.name, 'Playlist')}.m3u8`, n = 2;
    while (used.has(name.toLowerCase())) name = `${safeName(p.data.name, 'Playlist')} (${n++}).m3u8`;
    used.add(name.toLowerCase());
    out.push({ name, text: playlistM3u(p.data.name, p.data.trackIds ?? [], byId) });
  }
  return out;
}

const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** One row per track (with or without audio): the facts a spreadsheet or another player's importer needs. */
export function tracksCsv(store: Store, input: LibraryInput, items: LayoutItem[]): string {
  const votes = store.list('votes').map((v) => v.data as never);
  const ranked = replayVotes(votes.map((v: any) => ({ ...v })), input.tracks.map((t) => t.id)); // eslint-disable-line @typescript-eslint/no-explicit-any
  const rating = balancedRatings(ranked, new Map(input.tracks.map((t) => [t.id, t.data.initialRating])));
  const where = new Map(items.map((i) => [i.trackId, i]));
  const artistName = new Map(input.artists.map((a) => [a.id, String(a.data.name)]));
  const head = ['title', 'artist', 'album', 'track number', 'rating (0-10)', 'comparisons', 'memories', 'genres', 'spotify', 'youtube music', 'path in the readable library'];
  const lines = [head.join(',')];
  for (const t of input.tracks) {
    const it = where.get(t.id);
    const artist = it?.artist ?? (t.data.credits ?? []).map((c: any) => artistName.get(c.artistId)).filter(Boolean)[0] ?? ''; // eslint-disable-line @typescript-eslint/no-explicit-any
    const album = it?.album ?? input.albums.find((a) => a.id === t.data.albums?.[0]?.albumId)?.data.title ?? '';
    lines.push([t.data.title, artist, album, it?.number ?? '', (rating.get(t.id) ?? 0).toFixed(2), ranked.get(t.id)?.comparisons ?? 0, t.data.memories ?? 0, (t.data.genres ?? []).join('; '), t.data.spotifyUrl, t.data.youtubeMusicUrl, it?.path ?? ''].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Every record of the library as one JSON document: the complete, documented copy of the data (audio and pictures are separate files). */
export function libraryJson(store: Store, tables: RecordTable[]): string {
  const out: Record<string, { id: string; data: unknown }[]> = {};
  for (const t of tables) out[t] = store.list(t).map((r) => ({ id: r.id, data: r.data }));
  return JSON.stringify({ format: 'turbomusic-export', version: 1, exportedAt: new Date().toISOString(), note: 'Every table of the TurboMusic library. Audio and pictures are files named by their sha256 hash (the "file" and "cover" fields); the readable library export has them as Artist/Album/Title files.', tables: out }, null, 1);
}

export const README = `TurboMusic library export
=========================

Music/            your songs as Artist/Album/NN Title.ext
Playlists/        one .m3u8 file per playlist (opens in VLC, foobar2000, Jellyfin, most players)
tracks.csv        every song with its rating, genres and links (opens in any spreadsheet)
library.json      every record of the library (artists, albums, releases, tracks, playlists, notes, votes, plays...)

Ratings are worked out from your head-to-head votes (an Elo score scaled to 0-10); library.json has the votes themselves.
`;

// ---------------------------------------------------------------- the mirror

const MARK = '.turbomusic-mirror.json';
export type MirrorMode = 'symlink' | 'hardlink' | 'copy';
export interface MirrorResult { linked: number; removed: number; skipped: number; mode: MirrorMode; root: string }

/**
 * Make `root` hold `Music/Artist/Album/NN Title.ext` links (or hard links, or copies) to the real files, plus `Playlists/*.m3u8`, and
 * remove what an earlier run made that the library no longer wants (only paths this function created, listed in a marker file, are ever
 * deleted). Cheap to run again: files that are already right are left alone.
 */
export function syncMirror(store: Store, dataDir: string, root: string, mode: MirrorMode): MirrorResult {
  const input = loadInput(store);
  const items = planLayout(input);
  mkdirSync(root, { recursive: true });
  const markPath = join(root, MARK);
  let before: string[] = [];
  try { before = (JSON.parse(readFileSync(markPath, 'utf8')) as { paths: string[] }).paths; } catch { /* first run */ }
  const want = new Map<string, string>(); // relative path -> real file
  for (const it of items) want.set(`Music/${it.path}`, filePath(dataDir, it.hash));
  let linked = 0, skipped = 0;
  const made: string[] = [];
  for (const [rel, real] of want) {
    if (!existsSync(real)) { skipped++; continue; }
    const dest = join(root, ...rel.split('/'));
    mkdirSync(dirname(dest), { recursive: true });
    if (isRight(dest, real, mode)) { made.push(rel); continue; }
    rmSync(dest, { force: true });
    try {
      if (mode === 'symlink') symlinkSync(real, dest);
      else if (mode === 'hardlink') linkSync(real, dest);
      else copyFileSync(real, dest);
    } catch {
      // a drive that cannot do links (FAT, some network shares): fall back to a copy rather than leaving a hole
      copyFileSync(real, dest);
    }
    made.push(rel); linked++;
  }
  mkdirSync(join(root, 'Playlists'), { recursive: true });
  for (const p of playlistFiles(input, items)) { writeFileSync(join(root, 'Playlists', p.name), p.text); made.push(`Playlists/${p.name}`); }
  let removed = 0;
  const keep = new Set(made);
  for (const rel of before) if (!keep.has(rel)) { rmSync(join(root, ...rel.split('/')), { force: true }); removed++; pruneEmpty(root, dirname(join(root, ...rel.split('/')))); }
  writeFileSync(markPath, JSON.stringify({ paths: made, at: Date.now(), mode }));
  return { linked, removed, skipped, mode, root };
}

function isRight(dest: string, real: string, mode: MirrorMode): boolean {
  try {
    if (mode === 'symlink') return readFileLink(dest) === real;
    return existsSync(dest);
  } catch { return false; }
}
function readFileLink(p: string): string | null { try { return (readlinkSync(p)); } catch { return null; } }
import { readlinkSync } from 'node:fs';

function pruneEmpty(root: string, dir: string) {
  let d = dir;
  while (d.startsWith(root) && d !== root) {
    try { if (readdirSync(d).length) return; rmdirSync(d); } catch { return; }
    d = dirname(d);
  }
}

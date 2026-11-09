import { lookupAlbumDate } from './dates.ts';
import { ytdlpFailure } from './ytdlpError.ts';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { safeUrl } from './acquire.ts';
import type { Store } from './db.ts';
import { filePath } from './files.ts';

export interface PreviewEntry { id: string; title: string; rawTitle: string; url: string; duration: number | null }
/** `thumbnail` is the best candidate; `thumbnails` lists every candidate best-first so a failing one can be skipped. */
export interface Preview { title: string; artist: string; thumbnail: string | null; thumbnails: string[]; entries: PreviewEntry[]; /** when the album came out, when an exact match was found online */ releaseDate?: string | null }

const NOISE = /\s*[(\[]\s*(official\s*(music\s*)?(video|audio|lyric\s*video|visuali[sz]er)|lyrics?(\s*video)?|audio|visuali[sz]er|hd|hq|explicit)\s*[)\]]\s*/gi;

/** "Artist - Song (Official Audio)" -> "Song". Only strips well-known noise and a leading "Artist - ". */
export function cleanTitle(title: string, artist?: string): string {
  let t = title.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  if (artist) {
    const a = artist.toLowerCase();
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(t);
    if (m && m[1].toLowerCase() === a) t = m[2].trim();
  }
  return t || title.trim();
}

const SQUARE_HOSTS = ['googleusercontent.com', 'ggpht.com'];
const isSquareHost = (u: string) => { try { const h = new URL(u).hostname; return SQUARE_HOSTS.some((x) => h === x || h.endsWith('.' + x)); } catch { return false; } };
/** Google image URLs end in `=w544-h544-...`: ask for a bigger square. */
const upsize = (u: string) => (isSquareHost(u) ? u.replace(/=w\d+-h\d+/, '=w1200-h1200') : u);

/**
 * Every plausible cover for a playlist, best first: real square album art (YouTube Music serves it from Google
 * image hosts), then the playlist's own thumbnails by size, then the first track's, then the standard video
 * thumbnails by id. The caller tries them in order, so one dead link does not lose the cover.
 */
export function coverCandidates(info: any, entries: any[]): string[] {
  const listed = (o: any): string[] => {
    const arr: any[] = Array.isArray(o?.thumbnails) ? o.thumbnails.filter((t: any) => typeof t?.url === 'string') : [];
    // biggest first; when yt-dlp gives no sizes, the later entries are the larger ones
    const ranked = arr.map((t, i) => ({ url: t.url as string, size: (t.width ?? 0) * (t.height ?? 0) || (t.preference ?? 0), i }))
      .sort((a, b) => b.size - a.size || b.i - a.i).map((t) => t.url);
    return [...(typeof o?.thumbnail === 'string' ? [o.thumbnail] : []), ...ranked];
  };
  const own = [...listed(info), ...entries.slice(0, 1).flatMap(listed)];
  const first = entries[0]?.id;
  const byId = first ? ['maxresdefault', 'hq720', 'sddefault', 'hqdefault'].map((n) => `https://i.ytimg.com/vi/${first}/${n}.jpg`) : [];
  const all = [...own, ...byId].filter((u) => safeUrl(u));
  const square = all.filter(isSquareHost);
  return [...new Set([...square, ...all.filter((u) => !isSquareHost(u))].map(upsize))];
}

const plain = (s: string) => s.toLowerCase().replace(/\s*[(\[][^)\]]*[)\]]/g, '').replace(/\s+-\s+(single|ep)$/i, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The square cover from an iTunes Search result list, only when it is clearly the same album: the title matches (ignoring
 * "(Deluxe)", "- Single", punctuation) and the artist matches. A near miss would put the wrong picture on an album, so no match is better.
 */
export function pickItunesArtwork(results: any[], title: string, artist: string): string | null {
  const t = plain(title), a = plain(artist);
  const hit = (Array.isArray(results) ? results : []).find((r) => typeof r?.artworkUrl100 === 'string' && plain(String(r.collectionName ?? '')) === t && (plain(String(r.artistName ?? '')).includes(a) || a.includes(plain(String(r.artistName ?? '')))));
  return hit ? String(hit.artworkUrl100).replace(/\/\d+x\d+(bb)?\.(jpg|png)$/, '/600x600bb.jpg') : null;
}

const cleanArtist = (s: string) => s.replace(/\s*-\s*Topic$/i, '').trim();

/** Turn yt-dlp's `-J --flat-playlist` output into what the review screen needs (pure; tested without yt-dlp). */
export function parsePreview(info: any): Preview {
  const isList = Array.isArray(info?.entries);
  const raw: any[] = (isList ? info.entries : [info]).filter((e: any) => e && e.id);
  const artist = cleanArtist(String(info?.uploader ?? info?.channel ?? info?.artist ?? raw[0]?.uploader ?? raw[0]?.channel ?? '') || 'Unknown artist');
  let title = String(info?.title ?? 'Untitled album').trim();
  if (isList) title = title.replace(/^(album|single|ep)\s*[-–—:]\s*/i, '').trim() || title; // YouTube Music prefixes "Album - "
  const thumbs = coverCandidates(info, raw);
  return {
    title, artist,
    thumbnail: thumbs[0] ?? null, thumbnails: thumbs,
    entries: raw.map((e) => ({
      id: String(e.id), rawTitle: String(e.title ?? ''), title: cleanTitle(String(e.title ?? 'Unknown track'), artist),
      url: e.webpage_url ?? e.url ?? `https://www.youtube.com/watch?v=${e.id}`,
      duration: typeof e.duration === 'number' ? e.duration : null,
    })),
  };
}

const COVER_HOSTS = ['ytimg.com', 'ggpht.com', 'googleusercontent.com', 'mzstatic.com', 'scdn.co', 'dzcdn.net'];
const MAX_COVER = 10 * 1024 * 1024;

export class ImportError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export class Importer {
  private o: { dataDir: string; store: Store; ytdlp?: string; ytdlpArgs?: string[]; fetchImpl?: typeof fetch };
  constructor(o: { dataDir: string; store: Store; ytdlp?: string; ytdlpArgs?: string[]; fetchImpl?: typeof fetch }) { this.o = o; }

  /** Metadata only (no downloads), so the user can review before anything is fetched. */
  async preview(url: unknown): Promise<Preview> {
    const u = safeUrl(url);
    if (!u) throw new ImportError(400, 'That does not look like a web link');
    const out = await this.run(['--flat-playlist', '-J', '--no-warnings', '--', u]);
    let info: unknown;
    try { info = JSON.parse(out); } catch { throw new ImportError(502, 'yt-dlp returned something unreadable'); }
    const p = parsePreview(info);
    if (!p.entries.length) throw new ImportError(404, 'No tracks found at that link');
    // YouTube Music's own square art is the best cover; when yt-dlp does not give it, a verified album match from iTunes
    // (a real square 600 px picture) beats a cropped video frame
    const apple = await this.itunesCover(p.title, p.artist);
    if (apple) {
      const squares = p.thumbnails.filter(isSquareHost);
      p.thumbnails = [...squares, apple, ...p.thumbnails.filter((u) => !isSquareHost(u))];
      p.thumbnail = p.thumbnails[0];
    }
    // when it came out, so the release the import makes starts with a date (exact matches only; never fails the preview)
    p.releaseDate = (await lookupAlbumDate({ album: p.title, artist: p.artist }, { fetchImpl: this.o.fetchImpl }).catch(() => null))?.date ?? null;
    return p;
  }

  /** A cover for exactly this album from iTunes, or null (no match, offline, or a slow answer: never fails the preview). */
  async itunesCover(title: string, artist: string): Promise<string | null> {
    if (!title || !artist || artist === 'Unknown artist') return null;
    try {
      const q = new URLSearchParams({ term: `${artist} ${title}`, entity: 'album', limit: '10' });
      const res = await (this.o.fetchImpl ?? fetch)(`https://itunes.apple.com/search?${q}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      return pickItunesArtwork(((await res.json()) as { results?: any[] }).results ?? [], title, artist);
    } catch { return null; }
  }

  /** Try each candidate in order; returns the first that downloads, with the URL it came from. */
  async fetchFirstCover(urls: unknown): Promise<{ hash: string; url: string }> {
    const list = (Array.isArray(urls) ? urls : []).slice(0, 12);
    if (!list.length) throw new ImportError(400, 'No image links given');
    const why: string[] = [];
    let invalid = 0; // links refused outright (not an allowed host, not https), as opposed to downloads that failed
    for (const url of list) {
      try { return { hash: await this.fetchCover(url), url: String(url) }; }
      catch (e) { if (e instanceof ImportError && e.status === 400) invalid++; let host = String(url); try { host = new URL(host).hostname; } catch { /* keep as is */ } why.push(`${host}: ${(e as Error).message}`); }
    }
    // say what went wrong for the first few links, so a network problem is not reported as "internal error"
    throw new ImportError(invalid === list.length ? 400 : 502, `No cover could be downloaded (${why.slice(0, 3).join('; ')})`);
  }

  /** Fetch an image from a YouTube/Google image host into the file store; returns its hash. */
  async fetchCover(url: unknown): Promise<string> {
    const u = safeUrl(url);
    const host = u ? new URL(u).hostname : '';
    if (!u || !u.startsWith('https://') || !COVER_HOSTS.some((h) => host === h || host.endsWith('.' + h))) throw new ImportError(400, 'Only YouTube, Apple, Spotify and Deezer image links are allowed');
    let res: Response;
    try { res = await (this.o.fetchImpl ?? fetch)(u, { headers: { Accept: 'image/*' }, signal: AbortSignal.timeout(20_000) }); }
    catch (e) { throw new ImportError(502, `could not reach the image host (${(e as Error).cause instanceof Error ? ((e as Error).cause as Error).message : (e as Error).message})`); }
    if (!res.ok) throw new ImportError(502, `Image host said ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) throw new ImportError(502, 'That link is not an image');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_COVER) throw new ImportError(413, 'Image too large');
    const hash = createHash('sha256').update(buf).digest('hex');
    if (!this.o.store.hasFile(hash)) {
      const dest = filePath(this.o.dataDir, hash);
      if (!existsSync(dest)) {
        mkdirSync(join(this.o.dataDir, 'files', hash.slice(0, 2)), { recursive: true });
        const tmp = join(this.o.dataDir, 'tmp', `${hash}.${process.pid}.cover`);
        writeFileSync(tmp, buf);
        renameSync(tmp, dest);
      }
      this.o.store.addFile(hash, buf.length, type.split(';')[0]);
    }
    return hash;
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.o.ytdlp ?? 'yt-dlp', [...(this.o.ytdlpArgs ?? []), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      const timer = setTimeout(() => { child.kill(); reject(new ImportError(504, 'yt-dlp took too long')); }, 90_000);
      child.stdout.on('data', (d) => { out += d; if (out.length > 20_000_000) child.kill(); });
      child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
      child.on('error', (e: NodeJS.ErrnoException) => { clearTimeout(timer); reject(new ImportError(500, e.code === 'ENOENT' ? `yt-dlp not found (${this.o.ytdlp ?? 'yt-dlp'}). Install it or set TURBOMUSIC_YTDLP.` : e.message)); });
      child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new ImportError(502, `yt-dlp failed: ${ytdlpFailure(err) || code}`)); });
    });
  }
}

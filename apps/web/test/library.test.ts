import { describe, expect, it } from 'vitest';
import type { SyncRecord } from '@turbomusic/core';
import { buildLibrary } from '../src/lib/library.ts';
import { centreSquare, contentBox, coverCrop } from '../src/lib/image.ts';
import { createHash, randomBytes } from 'node:crypto';
import { sha256Sync } from '../src/lib/sha256.ts';
import { thumbnailUrls, youtubeId } from '../src/lib/youtube.ts';
import { parseBackup } from '../src/lib/backupFormat.ts';
import { albumCover, coverPicked, coverPool } from '../src/lib/covers.ts';
import { planNoteMigration } from '../src/lib/noteMigration.ts';
import { dateRange, makeChip, matchesAll, ratingTest, splitTyped, trackSubject } from '../src/lib/filters.ts';

import { computeHealth } from '../src/lib/health.ts';
import { assignLinks, linkGroups, looksRight, parseLinks } from '../src/lib/bulkLinks.ts';
import { trackInfo } from '../src/lib/trackinfo.ts';
import { computeStats } from '../src/lib/stats.ts';
import { leadCredit, appendTrack, hasLead, leadArtistId, withLeadFallback, moveTrack, newAlbumData, newTrackData, removeTrack } from '../src/lib/defaults.ts';
import { pickEvictions } from '../src/lib/cachePolicy.ts';
import { defaultDir, sortTracks } from '../src/lib/trackSort.ts';
import { pickPair } from '../src/lib/pairing.ts';

const rec = (table: string, id: string, data: object): SyncRecord => ({ table: table as never, id, updatedAt: 1, deviceId: 'd', deleted: false, data: data as never });
const rows = (...rs: SyncRecord[]) => {
  const out: Record<string, Map<string, SyncRecord>> = Object.fromEntries(
    ['artists', 'eras', 'noteCategories', 'albums', 'releases', 'tracks', 'playlists', 'groups', 'genres', 'roleCategories', 'timeline', 'votes', 'playbackLogs', 'profiles', 'notes'].map((t) => [t, new Map()]));
  for (const r of rs) out[r.table].set(r.id, r);
  return out;
};
const track = (title: string, extra: object = {}) => ({
  title, artistId: 'a', credits: [], genres: [], albums: [{ albumId: 'al', order: 0 }], file: null, initialRating: null,
  syncWithAlbumCredits: true, ...extra });
const vote = (id: string, a: string, b: string, winner: string, t: number) =>
  rec('votes', id, { trackAId: a, trackBId: b, winnerId: winner, isEqual: false, timestamp: t });

describe('buildLibrary', () => {
  const base = [
    rec('artists', 'a', { name: 'Artist', image: null }),
    rec('albums', 'al', { title: 'Album', artistId: 'a', credits: [], genres: ['Hip Hop'], cover: null }),
    rec('tracks', 't1', track('One')), rec('tracks', 't2', track('Two')), rec('tracks', 't3', track('Three')),
  ];

  it('orders album tracks by the release tracklist when album_tracks.order is all 0 (real legacy data)', () => {
    const lib = buildLibrary(rows(...base, rec('releases', 'r', { albumId: 'al', title: 'R', cover: null, releaseDate: null, trackIds: ['t3', 't1', 't2'] })));
    expect(lib.albumById.get('al')!.trackIds).toEqual(['t3', 't1', 't2']);
  });

  it('dates a track by the earliest release it is on, not the album\'s default release', () => {
    const lib = buildLibrary(rows(...base.slice(0, 4),
      rec('albums', 'al', { title: 'Album', artistId: 'a', credits: [], genres: [], cover: null, defaultReleaseId: 'deluxe' }),
      rec('releases', 'orig', { albumId: 'al', title: 'Original', cover: null, releaseDate: '2019-05-01', trackIds: ['t1'] }),
      rec('releases', 'deluxe', { albumId: 'al', title: 'Deluxe', cover: null, releaseDate: '2024-01-01', trackIds: ['t1', 't2'] })));
    expect(lib.trackById.get('t1')!.releaseDate).toBe('2019-05-01'); // on both: the earlier one
    expect(lib.trackById.get('t2')!.releaseDate).toBe('2024-01-01'); // only on the deluxe edition
    expect(lib.albumById.get('al')!.releaseDate).toBe('2024-01-01'); // the album itself still follows its default release
  });

  it('takes genres from the album when the track syncs with it, and from itself otherwise', () => {
    const lib = buildLibrary(rows(...base.slice(0, 3), rec('tracks', 't9', track('Own', { syncWithAlbumCredits: false, genres: ['Jazz'] }))));
    expect(lib.trackById.get('t1')!.allGenres).toEqual(['Hip Hop']);
    expect(lib.trackById.get('t9')!.allGenres).toEqual(['Jazz']);
  });

  it('ignores deleted records', () => {
    const r = rows(...base);
    r.tracks.set('t2', { ...r.tracks.get('t2')!, deleted: true });
    expect(buildLibrary(r).tracks.map((t) => t.id).sort()).toEqual(['t1', 't3']);
  });

  it('an album average counts unrated tracks as 0, and an album with nothing rated has no average', () => {
    const rated = buildLibrary(rows(...base.slice(0, 2), rec('tracks', 't1', track('One', { initialRating: 9 })), rec('tracks', 't2', track('Two')), rec('tracks', 't3', track('Three'))));
    expect(rated.albums[0].rating).toBeCloseTo(3); // (9 + 0 + 0) / 3, not 9
    expect(buildLibrary(rows(...base)).albums[0].rating).toBeNull();
  });

  it('derives rating from votes; shows initialRating until 3 comparisons; ranks 10-star tracks by Elo', () => {
    const vs = [1, 2, 3].map((i) => vote(`v${i}`, 't1', 't2', 't1', i));
    const lib = buildLibrary(rows(...base.slice(0, 3), rec('tracks', 't2', track('Two', { initialRating: 6 })), ...vs));
    const t1 = lib.trackById.get('t1')!, t2 = lib.trackById.get('t2')!;
    expect(t1.comparisons).toBe(3);
    expect(t1.effectiveRating).toBeCloseTo(10);
    expect(t1.tenStarRank).toBe(1);
    expect(t2.rating).toBeLessThan(6); // a typed-in rating is not a floor: the votes decide once there are three
    const few = buildLibrary(rows(...base.slice(0, 3), rec('tracks', 't2', track('Two', { initialRating: 6 })), vote('v', 't1', 't2', 't1', 1)));
    expect(few.trackById.get('t1')!.effectiveRating).toBe(0); // 1 comparison, no initial rating: unrated
    // one comparison: the typed-in 6 still guides it, but the vote already pulls it down a third of the way
    const t2few = few.trackById.get('t2')!;
    expect(t2few.effectiveRating).toBeLessThan(6); expect(t2few.effectiveRating).toBeGreaterThan(3);
    // none: exactly what was typed
    expect(buildLibrary(rows(...base.slice(0, 3), rec('tracks', 't2', track('Two', { initialRating: 6 })))).trackById.get('t2')!.effectiveRating).toBe(6);
  });

  it('the 10/10 line: the named song and everything above it rate 10, the rest stretch to fit under it', () => {
    const vs = [1, 2, 3, 4].flatMap((i) => [vote(`a${i}`, 't1', 't2', 't1', i), vote(`b${i}`, 't2', 't3', 't2', i + 10)]);
    const plain = buildLibrary(rows(...base.slice(0, 3), rec('tracks', 't2', track('Two')), rec('tracks', 't3', track('Three')), ...vs));
    const p2 = plain.trackById.get('t2')!.rating, p3 = plain.trackById.get('t3')!.rating;
    expect(p2).toBeLessThan(10);
    const withLine = buildLibrary(rows(...base.slice(0, 3), rec('tracks', 't2', track('Two')), rec('tracks', 't3', track('Three')), ...vs, rec('profiles', '1', { name: 'p', theme: 'dark', accentColor: '#fff', playbackMode: 'local', settings: { tenLine: 't2' }, playbackRules: [] })));
    expect(withLine.trackById.get('t1')!.rating).toBe(10);
    expect(withLine.trackById.get('t2')!.rating).toBe(10);
    expect(withLine.trackById.get('t3')!.rating).toBeCloseTo(p3 * (9.4 / p2), 5);
    expect(withLine.trackById.get('t3')!.rating).toBeLessThan(9.5);
  });
});

describe('pickPair', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, elo: 1000 + i * 10, comparisons: i }));
  it('needs two tracks and never pairs a track with itself', () => {
    expect(pickPair(mk(1))).toBeNull();
    for (let i = 0; i < 200; i++) { const [a, b] = pickPair(mk(30))!; expect(a.id).not.toBe(b.id); }
  });
  it('prefers least-compared tracks as A', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) { const p = pickPair(mk(100))!; seen.add(p[0].comparisons < 15 || p[1].comparisons < 15 ? 'low' : 'high'); }
    expect(seen.has('low')).toBe(true);
  });
  it('does not immediately repeat the previous pair when it can avoid it', () => {
    const t = mk(3);
    for (let i = 0; i < 100; i++) { const [a, b] = pickPair(t, Math.random, ['t0', 't1'])!; expect([a.id, b.id].sort()).not.toEqual(['t0', 't1']); }
  });
});

describe('computeStats', () => {
  it('totals plays, skips and listening time; ignores logs of deleted tracks in the top list', () => {
    const log = (id: string, trackId: string, duration: number, isSkip: boolean, timestamp: number) =>
      rec('playbackLogs', id, { trackId, timestamp, duration, sourceType: 'album', sourceId: null, isSkip });
    const lib = buildLibrary(rows(
      rec('artists', 'a', { name: 'A', image: null }),
      rec('tracks', 't1', track('One', { albums: [] })), rec('tracks', 't2', track('Two', { albums: [], file: 'h' })),
      log('l1', 't1', 100, false, 1), log('l2', 't1', 20, true, 2), log('l3', 't2', 50, false, 3), log('l4', 'gone', 999, false, 4)));
    const s = computeStats(lib);
    expect(s.plays).toBe(4);
    expect(s.skips).toBe(1);
    expect(s.skipRate).toBe(0.25);
    expect(s.secondsListened).toBe(1169);
    expect(s.topTracks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(s.topTracks[0]).toMatchObject({ seconds: 120, plays: 2 });
    expect(s.recent[0].trackId).toBe('gone');
    expect(s.withAudio).toBe(1);
  });
});

describe('album editing helpers', () => {
  it('moves, removes and appends without mutating', () => {
    const o = ['a', 'b', 'c'];
    expect(moveTrack(o, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveTrack(o, 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moveTrack(o, 0, -1)).toBe(o);
    expect(removeTrack(o, 'b')).toEqual(['a', 'c']);
    expect(appendTrack(o, 'd')).toEqual(['a', 'b', 'c', 'd']);
    expect(appendTrack(o, 'a')).toBe(o);
    expect(o).toEqual(['a', 'b', 'c']);
  });
  it('an explicit trackOrder wins over the release order; unlisted tracks follow', () => {
    const base = [rec('artists', 'a', { name: 'A', image: null }), rec('tracks', 't1', track('One')), rec('tracks', 't2', track('Two')), rec('tracks', 't3', track('Three')),
      rec('releases', 'r', { albumId: 'al', title: 'R', cover: null, releaseDate: null, trackIds: ['t1', 't2', 't3'] })];
    const lib = buildLibrary(rows(...base, rec('albums', 'al', { ...newAlbumData({ title: 'Al', credits: leadCredit('a') }), trackOrder: ['t3', 't1'] })));
    expect(lib.albumById.get('al')!.trackIds).toEqual(['t3', 't1', 't2']);
  });
  it('new tracks/albums are complete records', () => {
    const t = newTrackData({ title: 'x', credits: leadCredit('a') });
    expect(t).toMatchObject({ file: null, albums: [], syncWithAlbumCredits: true, credits: [{ artistId: 'a', role: ['Lead artist'] }] });
    expect(newAlbumData({ title: 'y', credits: leadCredit('a') }).genres).toEqual([]);
  });
});

describe('computeHealth', () => {
  const lib = buildLibrary(rows(
    rec('artists', 'a', { name: 'Used', image: null }), rec('artists', 'z', { name: 'Orphan', image: null }), rec('artists', 'c', { name: 'Credit Only', image: 'h' }),
    rec('albums', 'al', { title: 'Album', artistId: 'a', credits: [], genres: ['Rock'], cover: null }),
    rec('albums', 'empty', { title: 'Empty', artistId: 'a', credits: [], genres: [], cover: 'h' }),
    rec('tracks', 't1', track('Song', { genres: ['Pop'], credits: [{ artistId: 'c', role: ['Producer'] }], bitrate: '128kbps' })),
    rec('tracks', 't2', track('Song!', { albums: [], file: 'f', youtubeMusicUrl: 'u' })),
    rec('genres', 'g1', { name: 'Rock' }), rec('genres', 'g2', { name: 'Pop' }), rec('genres', 'g3', { name: 'Unused' }),
    rec('roleCategories', 'r1', { name: 'Producer', isRemovable: true }), rec('roleCategories', 'r2', { name: 'Lead artist', isRemovable: true }),
  ));
  const by = (id: string) => computeHealth(lib).find((c) => c.id === id)!.items.map((i) => i.id).sort();
  it('finds each kind of problem', () => {
    expect(by('no-audio')).toEqual(['t1']);
    expect(by('no-source')).toEqual(['t1']);
    expect(computeHealth(lib).some((c) => c.id === 'no-album')).toBe(false); // singles are meant to exist
    expect(by('no-genre')).toEqual(['t2']);
    expect(by('low-quality')).toEqual(['t1']);
    expect(by('album-no-cover')).toEqual(['al']);
    expect(by('album-empty')).toEqual(['empty']);
    expect(by('duplicates')).toEqual(['t1', 't2']); // "Song" vs "Song!" normalise the same
  });
  it('never offers something in use for deletion (the legacy cleanup deleted roles that were in use)', () => {
    expect(by('artist-unused')).toEqual(['z']);       // 'c' is only a credit but is still used
    expect(by('genre-unused')).toEqual(['g3']);
    expect(by('role-unused')).toEqual(['r2']);        // 'Producer' is used by a credit
  });
});

describe('backup file', () => {
  const good = { table: 'tracks', id: 'a', updatedAt: 1, deviceId: 'd', deleted: false, data: { title: 'x' } };
  it('reads records and skips broken ones', () => {
    const r = parseBackup(JSON.stringify({ format: 'turbomusic-database', version: 1, records: [good, { table: 'nope', id: 'b' }, 5] }));
    expect(r.records).toHaveLength(1);
    expect(r.skipped).toBe(2);
  });
  it('rejects other JSON and non-JSON', () => {
    expect(() => parseBackup('{"records":[]}')).toThrow(/not a TurboMusic/);
    expect(() => parseBackup('nope')).toThrow(/not valid JSON/);
  });
});

describe('bulk links', () => {
  const lib = buildLibrary(rows(
    rec('artists', 'a', { name: 'A', image: null }),
    rec('albums', 'al', { title: 'Album', credits: [{ artistId: 'a', role: ['Lead artist'] }], genres: [], cover: null, trackOrder: ['t2', 't1', 't3'] }),
    rec('tracks', 't1', track('One', { albums: [{ albumId: 'al', order: 0 }], youtubeMusicUrl: 'https://youtu.be/x' })),
    rec('tracks', 't2', track('Two', { albums: [{ albumId: 'al', order: 0 }] })),
    rec('tracks', 't3', track('Three', { albums: [{ albumId: 'al', order: 0 }] })),
    rec('tracks', 't4', track('Loose', { albums: [] })),
  ));
  it('groups by album in tracklist order, singles last', () => {
    const g = linkGroups(lib, 'youtubeMusicUrl');
    expect(g.map((x) => [x.title, x.tracks.map((t) => t.id)])).toEqual([['Album', ['t2', 't1', 't3']], ['Singles', ['t4']]]);
    expect(linkGroups(lib, 'spotifyUrl')).toHaveLength(2);
  });
  it('maps lines to rows in order and keeps gaps', () => {
    const lines = parseLinks('see https://youtu.be/a ok\n\nhttps://music.youtube.com/watch?v=b\nnot a link');
    expect(lines).toEqual(['https://youtu.be/a', '', 'https://music.youtube.com/watch?v=b', '']);
    const m = assignLinks([{ id: 't2' }, { id: 't3' }, { id: 't4' }], lines);
    expect([...m]).toEqual([['t2', 'https://youtu.be/a'], ['t3', null], ['t4', 'https://music.youtube.com/watch?v=b']]);
  });
  it('flags links for the wrong site', () => {
    expect(looksRight('spotifyUrl', 'https://open.spotify.com/track/1')).toBe(true);
    expect(looksRight('spotifyUrl', 'https://youtu.be/x')).toBe(false);
    expect(looksRight('geniusUrl', 'https://genius.com/Artist-song-lyrics')).toBe(true);
  });
});

describe('youtubeId', () => {
  it('reads the common URL shapes and rejects the rest', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=pAEInY3xPc4')).toBe('pAEInY3xPc4');
    expect(youtubeId('https://music.youtube.com/watch?v=pAEInY3xPc4&list=RDAMVM')).toBe('pAEInY3xPc4');
    expect(youtubeId('https://youtu.be/pAEInY3xPc4?t=3')).toBe('pAEInY3xPc4');
    expect(youtubeId('https://www.youtube.com/shorts/pAEInY3xPc4')).toBe('pAEInY3xPc4');
    for (const bad of [null, undefined, '', 'nope', 'https://example.com/watch?v=pAEInY3xPc4', 'https://www.youtube.com/watch?v=short']) expect(youtubeId(bad)).toBeNull();
    expect(thumbnailUrls('abcdefghijk')[2]).toBe('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  });
});

describe('cover cropping (YouTube thumbnails have black bars)', () => {
  /** w x h image: black, with a coloured rectangle (the picture) at the given box */
  function img(w: number, h: number, pic: { x: number; y: number; w: number; h: number }) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, inside = x >= pic.x && x < pic.x + pic.w && y >= pic.y && y < pic.y + pic.h;
      d[i] = inside ? 200 : 0; d[i + 1] = inside ? 120 : 0; d[i + 2] = inside ? 60 : 0; d[i + 3] = 255;
    }
    return d;
  }
  it('finds the picture inside letterbox and pillarbox bars', () => {
    expect(contentBox(img(480, 360, { x: 0, y: 45, w: 480, h: 270 }), 480, 360)).toEqual({ x: 0, y: 45, w: 480, h: 270 });
    expect(contentBox(img(1280, 720, { x: 280, y: 0, w: 720, h: 720 }), 1280, 720)).toEqual({ x: 280, y: 0, w: 720, h: 720 });
  });
  it('crops album art in a 16:9 frame to exactly the art; keeps images without bars whole', () => {
    expect(coverCrop(img(1280, 720, { x: 280, y: 0, w: 720, h: 720 }), 1280, 720)).toEqual({ x: 280, y: 0, w: 720, h: 720 });
    expect(coverCrop(img(300, 300, { x: 0, y: 0, w: 300, h: 300 }), 300, 300)).toEqual({ x: 0, y: 0, w: 300, h: 300 });
  });
  it('keeps the dark edges of square art in a wide frame (the art is the centred full-height square, not just its bright part)', () => {
    // art 360x360 centred in 640x360, but only the middle 330x330 of it is bright
    expect(coverCrop(img(640, 360, { x: 155, y: 15, w: 330, h: 330 }), 640, 360)).toEqual({ x: 140, y: 0, w: 360, h: 360 });
  });
  it('centre-squares a wide picture, and ignores an all-black or tiny result', () => {
    expect(centreSquare({ x: 0, y: 45, w: 480, h: 270 })).toEqual({ x: 105, y: 45, w: 270, h: 270 });
    const black = new Uint8ClampedArray(400 * 300 * 4).map((_, i) => (i % 4 === 3 ? 255 : 0));
    expect(coverCrop(black, 400, 300)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(coverCrop(img(400, 300, { x: 100, y: 100, w: 20, h: 20 }), 400, 300)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });
});

describe('health: note categories', () => {
  it('lists categories no note uses, never one that is in use', () => {
    const lib = buildLibrary(rows(
      rec('noteCategories', 'used', { name: 'Used' }), rec('noteCategories', 'orphan', { name: 'Orphan' }),
      rec('groups', 'n1', { name: 'A note', description: '', label: null, categoryId: 'used', members: [] }),
    ));
    const c = computeHealth(lib).find((x) => x.id === 'note-category-unused')!;
    expect(c.items.map((x) => x.label)).toEqual(['Orphan']);
    expect(c.fix?.table).toBe('noteCategories');
  });
});

describe('sha256Sync (fallback for insecure origins)', () => {
  it('matches node:crypto for known vectors and every length around the block boundaries', () => {
    expect(sha256Sync(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Sync(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 100_003]) {
      const buf = randomBytes(n);
      expect(sha256Sync(buf)).toBe(createHash('sha256').update(buf).digest('hex'));
    }
  });
});

describe('trackInfo', () => {
  it('counts wins/losses/draws, keeps votes against deleted tracks, and totals plays', () => {
    const lib = buildLibrary(rows(
      rec('artists', 'a', { name: 'A', image: null }), rec('tracks', 't1', track('One')), rec('tracks', 't2', track('Two')),
      vote('v1', 't1', 't2', 't1', 1), vote('v2', 't2', 't1', 't2', 2), rec('votes', 'v3', { trackAId: 't1', trackBId: 'ghost', winnerId: null, isEqual: true, timestamp: 3 }), vote('v4', 'x', 'y', 'x', 4),
      rec('playbackLogs', 'p1', { trackId: 't1', timestamp: 10, duration: 30, sourceType: 'album', sourceId: null, isSkip: false }),
      rec('playbackLogs', 'p2', { trackId: 't1', timestamp: 20, duration: 5, sourceType: 'album', sourceId: null, isSkip: true })));
    const i = trackInfo(lib, 't1');
    expect([i.wins, i.losses, i.draws]).toEqual([1, 1, 1]);
    expect(i.votes.map((v) => v.voteId)).toEqual(['v3', 'v2', 'v1']); // newest first, the unrelated v4 excluded
    expect(i.votes[0]).toMatchObject({ opponent: '(deleted track)', opponentExists: false, result: 'equal' });
    expect(i).toMatchObject({ plays: 2, skips: 1, secondsListened: 35, lastPlayed: 20 });
    expect(i.history.map((h) => [h.logId, h.isSkip, h.seconds])).toEqual([['p2', true, 5], ['p1', false, 30]]); // newest first
  });
});

describe('lead artist from credits', () => {
  const lead = (artistId: string, ...extra: string[]) => ({ artistId, role: ['Lead artist', ...extra] });
  it('picks the first lead credit (case-insensitive), then the stored artistId, then the first credit', () => {
    expect(leadArtistId([{ artistId: 'p', role: ['Producer'] }, { artistId: 'b', role: ['lead ARTIST'] }, lead('c')], 'old')).toBe('b');
    expect(leadArtistId([{ artistId: 'p', role: ['Producer'] }], 'old')).toBe('old');
    expect(leadArtistId([{ artistId: 'p', role: ['Producer'] }], '')).toBe('p');
    expect(leadArtistId([], 'old')).toBe('old');
    expect(hasLead([{ artistId: '', role: ['Lead artist'] }])).toBe(false); // blank editor row
  });
  it('backfills a lead credit for a legacy record that has the artist only in artistId', () => {
    expect(withLeadFallback([], 'a')).toEqual([lead('a')]);
    const kept = [{ artistId: 'a', role: ['Producer'] }, { artistId: 'x', role: ['Writer'] }];
    expect(withLeadFallback(kept, 'a')).toEqual([{ artistId: 'a', role: ['Lead artist', 'Producer'] }, kept[1]]);
    const has = [lead('z')];
    expect(withLeadFallback(has, 'a')).toBe(has);
  });
  const libFor = (albumCredits: object[], t: object) => buildLibrary(rows(
    rec('artists', 'a', { name: 'Old', image: null }), rec('artists', 'b', { name: 'Bee', image: null }), rec('artists', 'c', { name: 'Cee', image: null }),
    rec('albums', 'al', { title: 'Album', artistId: 'a', credits: albumCredits, genres: [], cover: null }), rec('tracks', 't', track('T', t))));
  it('shows every lead artist and follows the album for tracks that sync with it', () => {
    const lib = libFor([lead('b'), lead('c')], {});
    expect(lib.albumById.get('al')).toMatchObject({ artistId: 'b', artistName: 'Bee, Cee' });
    expect(lib.trackById.get('t')).toMatchObject({ artistId: 'b', artistName: 'Bee, Cee' });
  });
  it('keeps a legacy record (no credits) on its stored artist, and a track with its own credits on those', () => {
    expect(libFor([], {}).trackById.get('t')!.artistName).toBe('Old');
    const own = libFor([lead('b')], { syncWithAlbumCredits: false, credits: [lead('c')] });
    expect(own.trackById.get('t')).toMatchObject({ artistId: 'c', artistName: 'Cee' });
  });
  it('flags records with no lead credit in the health check', () => {
    const items = computeHealth(libFor([], {})).find((c) => c.id === 'no-lead')!.items;
    expect(items.map((i) => i.id).sort()).toEqual(['al', 't']);
    expect(computeHealth(libFor([lead('b')], {})).find((c) => c.id === 'no-lead')!.items).toEqual([]);
  });
});

describe('pickEvictions (offline audio)', () => {
  const MB = 1024 * 1024;
  const cache = { old: { size: 10 * MB, at: 1 }, mid: { size: 10 * MB, at: 2 }, new: { size: 10 * MB, at: 3 } };
  it('evicts nothing when the file fits', () => expect(pickEvictions(cache, 10 * MB, 40 * MB)).toEqual([]));
  it('evicts least recently used first, and only as many as needed', () => {
    expect(pickEvictions(cache, 10 * MB, 30 * MB)).toEqual(['old']);
    expect(pickEvictions(cache, 15 * MB, 30 * MB)).toEqual(['old', 'mid']);
  });
  it('never evicts protected files, and returns null (delete nothing) if that leaves no room', () => {
    expect(pickEvictions(cache, 10 * MB, 30 * MB, new Set(['old']))).toEqual(['mid']);
    expect(pickEvictions(cache, 10 * MB, 30 * MB, new Set(['old', 'mid', 'new']))).toBeNull();
    expect(pickEvictions(cache, 50 * MB, 30 * MB)).toBeNull(); // bigger than the whole limit
  });
});

describe('sortTracks', () => {
  const lib = buildLibrary(rows(
    rec('artists', 'a', { name: 'A', image: null }),
    rec('albums', 'al', { title: 'Zed', artistId: 'a', credits: [], genres: [], cover: null }),
    rec('tracks', 't1', track('track 10', { albums: [{ albumId: 'al', order: 0 }] })),
    rec('tracks', 't2', track('Track 2', { albums: [] })),
    rec('tracks', 't3', track('apple', { albums: [{ albumId: 'al', order: 0 }] }))));
  const ids = (k: Parameters<typeof sortTracks>[1], d: 'asc' | 'desc') => sortTracks(lib.tracks, k, d).map((t) => t.id);
  it('sorts titles naturally and case-insensitively, either direction', () => {
    expect(ids('title', 'asc')).toEqual(['t3', 't2', 't1']);
    expect(ids('title', 'desc')).toEqual(['t1', 't2', 't3']);
  });
  it('keeps tracks without an album last in both directions', () => {
    expect(ids('album', 'asc')[2]).toBe('t2');
    expect(ids('album', 'desc')[2]).toBe('t2');
  });
  it('first click goes the natural way for each column', () => { expect(defaultDir('title')).toBe('asc'); expect(defaultDir('rating')).toBe('desc'); });
});

describe('album cover pool', () => {
  const rel = (cover: string | null) => ({ cover });
  it('pools uploads, the picked cover and every release cover once', () => {
    expect(coverPool({ covers: ['u1', 'u2'], cover: 'u2' }, [rel('r1'), rel(null), rel('u1')])).toEqual(['u1', 'u2', 'r1']);
  });
  it('inherits the default release unless a cover was picked', () => {
    expect(albumCover({ coverPicked: false, cover: 'old' }, [rel('a'), rel('b')], rel('b'))).toBe('b');
    expect(albumCover({ coverPicked: true, cover: 'u1' }, [rel('a')], rel('a'))).toBe('u1');
  });
  it('treats an old record (no flag) with a cover as picked, and falls back through the pool', () => {
    expect(coverPicked({ cover: 'x' })).toBe(true);
    expect(coverPicked({ cover: null })).toBe(false);
    expect(albumCover({ cover: 'x' }, [rel('a')], rel('a'))).toBe('x');
    expect(albumCover({ coverPicked: false, covers: ['p'] }, [rel(null)], rel(null))).toBe('p');
    expect(albumCover({}, [], undefined)).toBeNull();
  });
  it('the library shows the derived cover on the album and its tracks', () => {
    const l = buildLibrary(rows(
      rec('albums', 'al', { title: 'A', credits: [{ artistId: 'a', role: ['Lead artist'] }], genres: [], cover: null, covers: ['up'], coverPicked: false, defaultReleaseId: 'r2' }),
      rec('releases', 'r1', { albumId: 'al', title: 'One', cover: 'c1', releaseDate: null, trackIds: ['t'] }),
      rec('releases', 'r2', { albumId: 'al', title: 'Two', cover: 'c2', releaseDate: null, trackIds: ['t'] }),
      rec('tracks', 't', track('T', { albums: [{ albumId: 'al', order: 0 }] })),
    ));
    expect(l.albumById.get('al')!.cover).toBe('c2');
    expect(l.albumById.get('al')!.coverPool).toEqual(['up', 'c1', 'c2']);
    expect(l.trackById.get('t')!.cover).toBe('c2');
  });
});

describe('notes and relational bios are one thing', () => {
  const note = (id: string, label: string) => ({ id, data: { entityType: 'album', entityId: 'al', label, content: 'text', isLinked: false, createdAt: 5 } });
  const bio = (id: string, type: string | undefined, extra: object = {}) => ({ id, data: { name: id, description: null, label: null, type, members: [{ entityType: 'artist' as const, entityId: 'a', showOnEntityPage: true }], ...extra } });
  it('turns an old note into a note with one link, under its own id', () => {
    const p = planNoteMigration([note('n1', 'Liner notes')], [], []);
    expect(p.removeNotes).toEqual(['n1']);
    expect(p.groups[0]).toMatchObject({ id: 'n1', data: { name: 'Liner notes', description: 'text', createdAt: 5, members: [{ entityType: 'album', entityId: 'al', showOnEntityPage: true }] } });
  });
  it('turns a bio type into the note\'s own category, and drops "era" as a kind', () => {
    const p = planNoteMigration([], [bio('b1', 'relationship'), bio('b2', 'relationship'), bio('b3', 'era')], []);
    expect(p.categories).toEqual([{ id: 'cat-relationship', data: { name: 'Relationship' } }]);
    expect(p.groups.map((g) => [g.id, g.data.categoryId, 'type' in g.data])).toEqual([['b1', 'cat-relationship', false], ['b2', 'cat-relationship', false], ['b3', null, false]]);
  });
  it('has nothing left to do once migrated', () => {
    const p = planNoteMigration([], [bio('b1', undefined, { categoryId: 'cat-relationship' })], [{ id: 'cat-relationship', data: { name: 'Relationship' } }]);
    expect(p).toEqual({ categories: [], groups: [], removeNotes: [] });
  });
});

describe('filters', () => {
  const lib = buildLibrary(rows(
    rec('artists', 'a', { name: 'Kendrick Lamar', image: null }), rec('artists', 'b', { name: 'Drake', image: null }),
    rec('eras', 'e1', { name: 'The feud', description: null, cover: null, albumIds: ['al'], trackIds: [], playlistIds: [] }),
    rec('albums', 'al', { title: 'GNX', credits: [{ artistId: 'a', role: ['Lead artist'] }], genres: ['Hip hop'], cover: null, defaultReleaseId: 'r' }),
    rec('releases', 'r', { albumId: 'al', title: 'GNX', cover: null, releaseDate: '2024-11-22', trackIds: ['t1'] }),
    rec('tracks', 't1', track('Squabble Up', { artistId: undefined, albums: [{ albumId: 'al', order: 0 }], file: 'f', memories: 3, credits: [{ artistId: 'a', role: ['Lead artist'] }] })),
    rec('tracks', 't2', track('Loose', { artistId: undefined, albums: [], credits: [{ artistId: 'b', role: ['Lead artist'] }], memories: 9 })),
  ));
  const t1 = trackSubject(lib, lib.trackById.get('t1')!), t2 = trackSubject(lib, lib.trackById.get('t2')!);
  const chip = (key: Parameters<typeof makeChip>[1], text: string) => makeChip(lib, key, text)!;
  it('reads dates as the period they cover', () => {
    expect(dateRange('2019')).toEqual({ from: '2019-01-01', to: '2019-12-31' });
    expect(dateRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(dateRange('2024-02-30')).toBeNull();
    expect(dateRange('last week')).toBeNull();
  });
  it('before and after compare whole periods, and skip what has no date', () => {
    expect(matchesAll([chip('before', '2025')], t1)).toBe(true);
    expect(matchesAll([chip('before', '2024-11')], t1)).toBe(false);
    expect(matchesAll([chip('after', '2024-10')], t1)).toBe(true);
    expect(matchesAll([chip('after', '2024')], t1)).toBe(false); // released within 2024, not after it
    expect(matchesAll([chip('before', '2025')], t2)).toBe(false); // a single with no date never matches a date filter
  });
  it('artist, era, album, has and rating narrow the list, all together', () => {
    expect(chip('artist', 'kendrick')).toMatchObject({ value: 'a', label: 'Kendrick Lamar' });
    expect(matchesAll([chip('artist', 'kendrick')], t1)).toBe(true);
    expect(matchesAll([chip('artist', 'kendrick')], t2)).toBe(false);
    expect(matchesAll([chip('era', 'feud')], t1)).toBe(true);
    expect(matchesAll([chip('era', 'feud')], t2)).toBe(false);
    expect(matchesAll([chip('has', 'audio'), chip('genre', 'hip')], t1)).toBe(true);
    expect(matchesAll([chip('has', 'audio')], t2)).toBe(false);
    expect(matchesAll([chip('has', 'memories')], t2)).toBe(true);
    expect(makeChip(lib, 'has', 'lyrics')).toBeNull();
    expect(makeChip(lib, 'before', 'soon')).toBeNull();
  });
  it('parses rating tests and typed keys', () => {
    expect(ratingTest('>7')!(8)).toBe(true); expect(ratingTest('>7')!(7)).toBe(false);
    expect(ratingTest('7-9')!(9)).toBe(true); expect(ratingTest('8')!(7.6)).toBe(true); expect(ratingTest('lots')).toBeNull();
    expect(splitTyped('Artist: Drake')).toEqual({ key: 'artist', rest: 'Drake' });
    expect(splitTyped('artists')).toBeNull();
  });
  it('sorts by memories and by release date', () => {
    expect(sortTracks(lib.tracks, 'memories', 'desc').map((t) => t.id)).toEqual(['t2', 't1']);
    expect(sortTracks(lib.tracks, 'released', 'desc').map((t) => t.id)).toEqual(['t1', 't2']); // undated last either way
    expect(sortTracks(lib.tracks, 'released', 'asc').map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

describe('other recordings of a song', () => {
  it('share the main version\'s votes and rating, are not asked about twice, and a vote between versions says nothing', () => {
    const vs = [1, 2, 3].map((i) => vote(`w${i}`, 't1', 't2', 't1', i));
    const lib = buildLibrary(rows(rec('artists', 'a', { name: 'Artist', image: null }), rec('tracks', 't1', track('One')), rec('tracks', 't2', track('Two')), rec('tracks', 't3', track('Three', { versionOf: 't1' })), ...vs, vote('same', 't1', 't3', 't1', 9)));
    const main = lib.trackById.get('t1')!, ver = lib.trackById.get('t3')!;
    expect(ver.versionOf).toBe('t1');
    expect(main.versions).toEqual(['t3']);
    expect(ver.comparisons).toBe(main.comparisons); // pooled
    expect(ver.effectiveRating).toBeCloseTo(main.effectiveRating);
    expect(main.comparisons).toBe(3); // the vote between the two versions was dropped
  });
});

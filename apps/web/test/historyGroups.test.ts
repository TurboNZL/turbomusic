import { describe, expect, it } from 'vitest';
import type { PlaybackLogData } from '@turbomusic/core';
import { groupLogs, leaveOut, matchWords, type LogRow } from '../src/lib/historyGroups.ts';
import { dropApiTwins, type Listen } from '../src/lib/listens.ts';

const L = (id: string, o: Partial<PlaybackLogData>): LogRow => ({ id, data: { trackId: '', timestamp: Date.UTC(2024, 5, 1), duration: 100, sourceType: 'spotify', sourceId: null, isSkip: false, imported: 'spotify', name: 'Song', artist: 'A', album: 'Al', ...o } });

describe('history manager groups', () => {
  const rows = [L('1', { artist: 'ASMR Girl', album: 'Rain', duration: 3000, account: 'Old' }), L('2', { artist: 'ASMR Girl', album: 'Rain', duration: 3000, account: 'Old', hidden: true }), L('3', { artist: 'Band', album: 'Hits', duration: 200 }), { id: '4', data: { trackId: 'x', timestamp: 1, duration: 5, sourceType: null, sourceId: null, isSkip: false } as PlaybackLogData }];
  it('groups Spotify plays by artist with the biggest listening time first, ignoring TurboMusic plays', () => {
    const g = groupLogs(rows, 'artist');
    expect(g.map((x) => [x.label, x.plays])).toEqual([['ASMR Girl', 2], ['Band', 1]]);
    expect(g[0].hidden).toBe(false); // one of its two plays is still shown
    expect(groupLogs(rows, 'account').map((x) => x.label)).toEqual(['Old', 'No account named']);
    expect(groupLogs(rows, 'year')[0].label).toBe('2024');
  });
  it('finds plays by words in artist, album or title', () => {
    expect(matchWords(rows, 'asmr, rain')).toEqual(['1', '2']);
    expect(matchWords(rows, '')).toEqual([]);
  });
  it('leaves entries out of an import by word or artist', () => {
    const e = [{ master_metadata_album_artist_name: 'ASMR Girl', master_metadata_track_name: 'a' }, { master_metadata_album_artist_name: 'Band', master_metadata_track_name: 'sleep sounds' }, { master_metadata_album_artist_name: 'Keep', master_metadata_track_name: 'b' }];
    expect(leaveOut(e, { words: 'sleep', artists: new Set(['asmr girl']) }).map((x) => x.master_metadata_album_artist_name)).toEqual(['Keep']);
  });
});

describe('API twins', () => {
  const P = (id: string, ts: number, o: Partial<Listen>): Listen => ({ id, ts, ms: 1000, trackId: 't', artistId: null, albumId: null, title: 'S', artist: 'A', album: '', uri: null, skipped: false, shuffle: null, platform: null, reasonEnd: null, source: 'spotify', ...o });
  it('drops an automatic play that an export or TurboMusic already has, keeps the rest', () => {
    const out = dropApiTwins([P('file', 1_000_000, {}), P('api1', 1_000_000 + 40_000, { viaApi: true }), P('api2', 9_000_000, { viaApi: true }), P('own', 20_000_000, { source: 'turbomusic' }), P('api3', 20_000_000 + 100_000, { viaApi: true })]);
    expect(out.map((l) => l.id)).toEqual(['file', 'api2', 'own']);
  });
});

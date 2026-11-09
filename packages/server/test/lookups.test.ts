import { describe, expect, it } from 'vitest';
import { lookupAlbumGenres, lookupArtistImage, pickDeezerArtist, pickItunesGenre, pickMusicBrainzGenres } from '../src/lookups.ts';

describe('artist picture', () => {
  const data = [
    { name: 'Drake Tribute Band', picture_xl: 'https://cdn-images.dzcdn.net/images/artist/aaa/1000x1000.jpg', nb_fan: 5 },
    { name: 'Drake', picture_xl: 'https://cdn-images.dzcdn.net/images/artist/bbb/1000x1000.jpg', nb_fan: 9000 },
    { name: 'drake', picture_xl: 'https://cdn-images.dzcdn.net/images/artist//1000x1000.jpg', nb_fan: 99999 },
  ];
  it('takes an exact name with a real picture, most fans first, never a placeholder', () => {
    expect(pickDeezerArtist(data, ['Drake'])?.image).toContain('/bbb/');
    expect(pickDeezerArtist(data, ['Someone Else'])).toBeNull();
    expect(pickDeezerArtist(data, ['The Drake'])?.image).toContain('/bbb/'); // "the" is ignored
  });
  it('tries the next name when the first finds nothing', async () => {
    const f = (async (u: string) => new Response(JSON.stringify({ data: String(u).includes('q=Aka') ? data : [] }))) as unknown as typeof fetch;
    expect((await lookupArtistImage(['Nope', 'Aka'], { fetchImpl: f }))).toBeNull(); // names must match the result's name
    expect((await lookupArtistImage(['Drake'], { fetchImpl: (async () => new Response(JSON.stringify({ data }))) as unknown as typeof fetch }))?.source).toBe('deezer');
  });
});

describe('album genres', () => {
  it('reads the iTunes primary genre of an exact match only', () => {
    const r = [{ collectionName: 'Views', artistName: 'Drake', primaryGenreName: 'Hip-Hop/Rap' }, { collectionName: 'Views (Deluxe)', artistName: 'Other', primaryGenreName: 'Pop' }];
    expect(pickItunesGenre(r, 'Views', 'Drake')).toBe('Hip-Hop/Rap');
    expect(pickItunesGenre(r, 'Views', 'Nobody')).toBeNull();
    expect(pickItunesGenre([{ collectionName: 'X', artistName: 'Y', primaryGenreName: 'Music' }], 'X', 'Y')).toBeNull();
  });
  it('keeps MusicBrainz tags given twice or more, best first', () => {
    const json = { 'release-groups': [{ score: 100, title: 'Views', 'artist-credit': [{ name: 'Drake' }], tags: [{ name: 'rap', count: 5 }, { name: 'meh', count: 1 }, { name: 'canadian hip hop', count: 8 }] }] };
    expect(pickMusicBrainzGenres(json, 'Views', 'Drake')).toEqual(['canadian hip hop', 'rap']);
    expect(pickMusicBrainzGenres({ 'release-groups': [{ score: 60, title: 'Views', 'artist-credit': [{ name: 'Drake' }], tags: [{ name: 'rap', count: 5 }] }] }, 'Views', 'Drake')).toEqual([]);
  });
  it('combines both sources without repeats and survives failures', async () => {
    const f = (async (u: string) => String(u).includes('itunes')
      ? new Response(JSON.stringify({ results: [{ collectionName: 'Views', artistName: 'Drake', primaryGenreName: 'Hip-Hop/Rap' }] }))
      : new Response('nope', { status: 503 })) as unknown as typeof fetch;
    expect(await lookupAlbumGenres({ album: 'Views', artist: 'Drake' }, { fetchImpl: f })).toEqual([{ name: 'Hip-Hop/Rap', source: 'itunes' }]);
  });
});
